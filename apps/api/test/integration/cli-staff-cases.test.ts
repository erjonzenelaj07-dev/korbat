import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { STANDING_RULES } from "@korbat/contracts";
import { closeDb, createDb, profiles, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runStaffCommand } from "../../src/cli/staff";
import { accessRequest, accountFacts, changeLink, setLimits, textVerify, type TextProblem } from "../../src/cli/staff-cases";
import { loadConfig } from "../../src/config";
import { ACCESS_WORDS, uuidBefore, type AccountAccessDraft, type ContactsAccessDraft } from "../../src/moderation";
import { newUserWithDevice } from "./auth-fixtures";
import { SPEECH, aPost, act, anAccount, appealOf, authCaseCounts, decideIn, ground, hex64, imagePost, insertIntake, insertItem, intake, newTestStaff, openCase, report, rowCounts, staffProfile, type TestStaff } from "./moderation-fixtures";
import { ageCase, authAccount, one } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { newStaffAccount, rolledBack } from "./staff-fixtures";

// Each test runs dozens of statements inside one open transaction, and text-verify reads whole tables.
vi.setConfig({ testTimeout: 120_000 });

const ORIGIN = "https://korbat.example";

/**
 * The staff command line's commands for moderation cases (3c design, section 7.13), against the real database: link,
 * unlink and the count that keys prints; limits; text-verify; account-facts; and access-request. What a command commits
 * is taken back by the command itself (a link by unlink); everything else runs as the migrator in a transaction that is
 * rolled back, with its audit row. The suites share one database, in which earlier suites left audit rows of decisions
 * they removed again: text-verify reports those, rightly, so each test here looks at the problems about its own rows.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js link, unlink, limits, text-verify, account-facts and access-request", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;
  let beforeAuth: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
    beforeAuth = await authCaseCounts(migrateDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const inWorld = (fn: (tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  /** The command's printed lines, each marked with its stream, and its exit code, for a run that sees `env` alone. */
  async function cli(args: string[], env: Record<string, string>) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines, text: lines.join("\n") };
  }
  const migrateEnv = () => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! });
  const keysEnv = () => ({ DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! });
  /** The audit rows of an action about a target, newest last, as the migrator reads them inside the test's transaction. */
  const auditRows = (q: Db | DbTx, action: string, targetId: string | null) =>
    q.execute<{ actor_id: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; step_up: unknown }>(
      sql`select actor_id, target_type, target_id, metadata, step_up from audit_log where action = ${action} and target_id is not distinct from ${targetId} order by chain_seq`,
    );

  describe("link, unlink and keys", () => {
    test("link records a personal account for a staff account, keys prints how many and never which, and unlink takes it back; each writes one audit row that names only the staff account", async () => {
      const staff = await newStaffAccount(authDb, repo, "moderator");
      const staffHandle = `st_${randomUUID().slice(0, 8)}`;
      await apiDb.insert(profiles).values({ id: staff.user.id, handle: staffHandle, displayName: "Staff" });
      const personal = await newUserWithDevice(repo);
      const handle = `p_${randomUUID().slice(0, 8)}`;
      await apiDb.insert(profiles).values({ id: personal.user.id, handle, displayName: "Personal" });
      try {
        const linked = await cli(["link", staff.user.email.toUpperCase(), `@${handle.toUpperCase()}`], migrateEnv());
        expect(linked.code, linked.text).toBe(0);
        expect(linked.lines).toEqual([`out link: @${handle} is linked to ${staff.user.email}. Update your own record of this staff member's linked handles.`]);
        expect(await one(migrateDb, sql`select count(*)::int as n from auth.staff_personal_accounts where staff_user_id = ${staff.user.id}::uuid and personal_user_id = ${personal.user.id}::uuid`)).toEqual({ n: 1 });
        // The audit row: the server's own, about the staff account, and nothing of the link.
        const added = await auditRows(migrateDb, "staff_link_added", staff.user.id);
        expect(added.map((row) => ({ ...row }))).toEqual([{ actor_id: "00000000-0000-0000-0000-000000000000", target_type: "user", target_id: staff.user.id, metadata: {}, step_up: null }]);
        expect(JSON.stringify(added)).not.toContain(personal.user.id);

        // A second link of the same account changes nothing and says so.
        const again = await cli(["link", staff.user.email, handle], migrateEnv());
        expect(again.code).toBe(1);
        expect(again.lines).toEqual([`err link: @${handle} is already linked to ${staff.user.email}; nothing changed`]);
        expect((await auditRows(migrateDb, "staff_link_added", staff.user.id)).length).toBe(1);

        // keys: the count, on the auth role, and neither the handle nor the id of the linked account.
        const keys = await cli(["keys", staff.user.email], keysEnv());
        expect(keys.code, keys.text).toBe(0);
        expect(keys.lines).toEqual([`out moderator ${staff.user.email} @${staffHandle} (account ${staff.user.id})`, "out   no staff keys", "out   linked personal accounts: 1"]);
        expect(keys.text).not.toContain(handle);
        expect(keys.text).not.toContain(personal.user.id);
        // The auth role is told the count through the one function, and reads nothing of the table itself.
        const counted = await authDb.execute<{ staff_user_id: string; links: number }>(sql`select staff_user_id, links from auth.staff_link_counts() where staff_user_id = ${staff.user.id}::uuid`);
        expect(counted.map((row) => ({ ...row }))).toEqual([{ staff_user_id: staff.user.id, links: 1 }]);
        expect((await authDb.execute(sql`select 1 from auth.staff_personal_accounts`).catch((err: unknown) => String((err as { cause?: unknown }).cause ?? err))).toString()).toMatch(/permission denied/);
      } finally {
        const unlinked = await cli(["unlink", staff.user.email, handle], migrateEnv());
        expect(unlinked.code, unlinked.text).toBe(0);
        expect(unlinked.lines).toEqual([`out unlink: @${handle} is no longer linked to ${staff.user.email}. Update your own record of this staff member's linked handles.`]);
      }
      expect((await auditRows(migrateDb, "staff_link_removed", staff.user.id)).map((row) => ({ ...row }))).toEqual([{ actor_id: "00000000-0000-0000-0000-000000000000", target_type: "user", target_id: staff.user.id, metadata: {}, step_up: null }]);
      const gone = await cli(["unlink", staff.user.email, handle], migrateEnv());
      expect(gone.code).toBe(1);
      expect(gone.lines).toEqual([`err unlink: @${handle} is not linked to ${staff.user.email}; nothing changed`]);
      const none = await cli(["keys", staff.user.email], keysEnv());
      expect(none.lines.at(-1)).toBe("out   linked personal accounts: 0");
    });

    test("link refuses an account that is not staff, a personal account that is staff, deleted or unknown, and the staff account itself, and writes nothing", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const staff = await newProfile(tx as unknown as Db);
        const other = await newProfile(tx as unknown as Db);
        const user = await newProfile(tx as unknown as Db);
        const deleted = await newProfile(tx as unknown as Db);
        await authAccount(tx, staff.id);
        await authAccount(tx, other.id);
        await authAccount(tx, user.id);
        await authAccount(tx, deleted.id, "1 day");
        const email = (id: string) => `retention-${id}@korbat.local`;
        const links = async () => (await one<{ n: number }>(tx, sql`select count(*)::int as n from auth.staff_personal_accounts where staff_user_id in (${staff.id}::uuid, ${other.id}::uuid)`)).n;

        expect(await changeLink(tx, email(staff.id), user.handle, false)).toEqual({ ok: false, problem: `${email(staff.id)} is not staff (its role is user)` });
        await tx.execute(sql`update auth.users set role = 'moderator' where id in (${staff.id}::uuid, ${other.id}::uuid)`);
        expect(await changeLink(tx, email(staff.id), other.handle, false)).toEqual({ ok: false, problem: `@${other.handle} is a staff account (its role is moderator); only a personal account is linked` });
        expect(await changeLink(tx, email(staff.id), deleted.handle, false)).toEqual({ ok: false, problem: `@${deleted.handle} is not a live account` });
        expect(await changeLink(tx, email(staff.id), "nobody_has_this", false)).toEqual({ ok: false, problem: "no account has the handle @nobody_has_this" });
        expect(await changeLink(tx, email(staff.id), staff.handle, false)).toMatchObject({ ok: false });
        expect(await changeLink(tx, "nobody@korbat.local", user.handle, false)).toEqual({ ok: false, problem: "no live account for nobody@korbat.local" });
        expect(await links()).toBe(0);
        expect((await auditRows(tx, "staff_link_added", staff.id)).length).toBe(0);
        // The link that is allowed, and the recusal it is for: the staff account may not decide a case about its own personal account.
        expect(await changeLink(tx, email(staff.id), `@${user.handle}`, false)).toMatchObject({ ok: true });
        expect(await links()).toBe(1);
        const p = await imagePost(tx, 0, user.id);
        const { caseId } = await report(tx, aPost(p.postId));
        expect(await one(tx, sql`select public.staff_case_conflict(${staff.id}::uuid, ${caseId}::uuid, false) as conflict`)).toEqual({ conflict: true });
        expect(await changeLink(tx, email(staff.id), user.handle, true)).toMatchObject({ ok: true });
        expect(await one(tx, sql`select public.staff_case_conflict(${staff.id}::uuid, ${caseId}::uuid, false) as conflict`)).toEqual({ conflict: false });
      });
    });
  });

  describe("limits", () => {
    test("it sets the five numbers with one audit row that carries them, changes nothing when they already are, and works on a database whose row is missing", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const wanted = { decisionsPerHour: 30, decisionsPerDay: 150, caseOpensPerDay: 200, findingsPerDay: 20, revealsPerDay: 5 };
        const row = () => one(tx, sql`select decisions_per_hour as h, decisions_per_day as d, case_opens_per_day as o, findings_per_day as f, reveals_per_day as r from moderation_limits where id = 1`);
        const set = await setLimits(tx, wanted);
        expect(set).toEqual({ ok: true, lines: ["limits: set to 30 decisions an hour, 150 decisions a day, 200 case opens a day, 20 findings a day, 5 reveals a day. Keep these numbers in your own records: a restore brings back the ones of its backup."] });
        expect(await row()).toEqual({ h: 30, d: 150, o: 200, f: 20, r: 5 });
        const written = await auditRows(tx, "moderation_limits_set", null);
        expect(written.at(-1)).toMatchObject({ actor_id: "00000000-0000-0000-0000-000000000000", target_type: null, metadata: wanted, step_up: null });
        const count = written.length;
        expect(await setLimits(tx, wanted)).toEqual({ ok: false, problem: "the limits already are 30 decisions an hour, 150 decisions a day, 200 case opens a day, 20 findings a day, 5 reveals a day; nothing changed" });
        expect((await auditRows(tx, "moderation_limits_set", null)).length).toBe(count);
        // One number differs: the row changes and a second audit row is written.
        expect(await setLimits(tx, { ...wanted, revealsPerDay: 6 })).toMatchObject({ ok: true });
        expect(await row()).toMatchObject({ r: 6 });
        expect((await auditRows(tx, "moderation_limits_set", null)).length).toBe(count + 1);
        // The row gone, as the integration setup's truncate would leave it: the command inserts it.
        await tx.execute(sql`delete from moderation_limits`);
        expect(await setLimits(tx, wanted)).toMatchObject({ ok: true });
        expect(await row()).toEqual({ h: 30, d: 150, o: 200, f: 20, r: 5 });
      });
    });

    test("run with the numbers the row already holds, it exits 1 and says so", async () => {
      const run = await cli(["limits", "60", "300", "400", "50", "10"], migrateEnv());
      expect(run.code).toBe(1);
      expect(run.lines).toEqual(["err limits: the limits already are 60 decisions an hour, 300 decisions a day, 400 case opens a day, 50 findings a day, 10 reveals a day; nothing changed"]);
    });
  });

  describe("text-verify", () => {
    /** The problems text-verify reports about any of these ids, or at any of these places of the audit log. */
    const about = (problems: TextProblem[], ids: readonly string[]) => problems.filter((p) => ids.includes(p.id)).map((p) => `${p.about}: ${p.message}`);
    const placesOf = async (tx: DbTx, decisionIds: readonly string[]) =>
      [...(await tx.execute<{ place: string }>(sql`select chain_seq::text as place from audit_log where metadata ->> 'decisionId' = any(${`{${decisionIds.join(",")}}`}::text[])`))].map((row) => row.place);

    test("it finds nothing wrong with decisions, texts, snapshots, levels, states and seals as the triggers left them, erased ones included", async () => {
      await inWorld(async (tx) => {
        const removed = await imagePost(tx, 2);
        const first = await report(tx, aPost(removed.postId));
        const withheld = await decideIn(tx, mod, first.caseId, { kind: "interim", actions: [act("withhold")] });
        const removal = await decideIn(tx, mod, first.caseId, { kind: "final", actions: [act("remove")] });
        const sealed = await imagePost(tx, 2);
        const suspect = await report(tx, anAccount(sealed.authorId), "csam");
        const seal = await decideIn(tx, mod, suspect.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
        const cleared = await imagePost(tx, 1);
        const third = await report(tx, aPost(cleared.postId));
        const noAction = await decideIn(tx, mod, third.caseId, { kind: "final", outcome: "no_violation" });
        const decisions = [withheld, removal, seal, noAction];
        const [sealAction] = await tx.execute<{ id: string }>(sql`select id from decision_actions where decision_id = ${seal}::uuid`);
        const mine = [...decisions, ...(await placesOf(tx, decisions)), removed.postId, sealed.postId, cleared.postId, ...removed.mediaIds, ...sealed.mediaIds, ...cleared.mediaIds, sealAction!.id];

        const report1 = await textVerify(tx, Number.MAX_SAFE_INTEGER);
        expect(about(report1.problems, mine)).toEqual([]);
        expect(report1.decisions).toBeGreaterThanOrEqual(4);
        expect(report1.seals).toBeGreaterThanOrEqual(1);
        expect(report1.images).toBeGreaterThanOrEqual(5);
        expect(report1.problemCount).toBe(report1.problems.length);
        expect(report1.ok).toBe(report1.problemCount === 0);

        // Retention at work is nothing to report: an erased snapshot and an erased text keep their rows and digests.
        await ageCase(tx, third.caseId, "3 days");
        await tx.execute(sql`select public.erase_case_evidence(${third.caseId}::uuid)`);
        await tx.execute(sql`update staff_texts set text = null, salt = null, erased_at = now() where case_id = ${first.caseId}::uuid and confirmed_at is not null`);
        expect(about((await textVerify(tx, Number.MAX_SAFE_INTEGER)).problems, mine)).toEqual([]);
      });
    });

    test("it reports a decision changed as the migrator, a measure removed, a text and a snapshot that are gone or altered, and a decision with no row or with a row and no decision", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const { caseId } = await report(tx, aPost(p.postId), "illegal");
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ground: "illegal", actions: [act("remove")] });
        const [place] = await placesOf(tx, [removal]);
        const q = await imagePost(tx, 0);
        const other = await report(tx, aPost(q.postId));
        const kept = await decideIn(tx, mod, other.caseId, { kind: "final", outcome: "no_violation" });
        const [keptPlace] = await placesOf(tx, [kept]);
        const mine = [removal, kept, place!, keptPlace!, p.postId];
        const found = async () => about((await textVerify(tx, Number.MAX_SAFE_INTEGER)).problems, mine).sort();
        expect(await found()).toEqual([]);

        // The decision's rule and outcome rewritten: what the key confirmed is no longer what is stored.
        await tx.execute(sql`update decisions set category = 'STATEMENT_CATEGORY_VIOLENCE', through_seq = 0 where id = ${removal}::uuid`);
        expect(await found()).toEqual([`decision: it differs from the audit row at place ${place} that names it: category, throughSeq`]);
        await tx.execute(sql`update decisions set category = ${SPEECH}, through_seq = 1 where id = ${removal}::uuid`);
        expect(await found()).toEqual([]);
        // Its measure taken out of the ledger: the decision no longer holds what its row lists, and the post's level no longer follows.
        await tx.execute(sql`delete from decision_actions where decision_id = ${removal}::uuid`);
        expect(await found()).toEqual([`decision: it differs from the audit row at place ${place} that names it: actions`, "post: its level is stored as removed, and the ledger of measures gives visible"]);
        await tx.execute(sql`select public.moderation_apply(array[${p.postId}]::uuid[], true)`);
        // A text deleted, and a snapshot's content rewritten.
        await tx.execute(sql`delete from staff_texts where digest = (select legal_reference_digest from decisions where id = ${removal}::uuid)`);
        await tx.execute(sql`update evidence_snapshots set body = 'another body' where case_id = ${caseId}::uuid`);
        expect(await found()).toEqual([
          "audit: its legalReferenceDigest names no saved text",
          "audit: the snapshot it names no longer recomputes to its digest",
          `decision: it differs from the audit row at place ${place} that names it: actions`,
        ]);
        // The other decision deleted outright, with what hangs on it: its row in the record now names nothing korbat holds.
        await tx.execute(sql`update intake_items set answered_by = null, outcome = null where answered_by = ${kept}::uuid`);
        await tx.execute(sql`delete from staff_texts where decision_id = ${kept}::uuid`);
        await tx.execute(sql`delete from decisions where id = ${kept}::uuid`);
        expect((await found()).filter((line) => line.includes(String(keptPlace)))).toEqual([`decision: the audit row at place ${keptPlace} names it, and korbat holds no such decision`]);
      });
    });

    test("3e Task 5: a decision that marked reports verifies with its marks, a mark taken out of the record or a row whose list was altered is reported, and a row signed before 3e reads its missing list as none", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const first = await report(tx, aPost(p.postId));
        const second = await intake(tx, ground.rule((await newProfile(tx as unknown as Db)).id, "R1"), aPost(p.postId));
        const items = [first.recorded.items[0]!.id, second.items[0]!.id].sort();
        const marked = await decideIn(tx, mod, first.caseId, { kind: "final", outcome: "no_violation", unfounded: items });
        const q2 = await imagePost(tx, 0);
        const other = await report(tx, aPost(q2.postId));
        const plain = await decideIn(tx, mod, other.caseId, { kind: "final", outcome: "no_violation" });
        const [place, plainPlace] = [(await placesOf(tx, [marked]))[0]!, (await placesOf(tx, [plain]))[0]!];
        const mine = [marked, plain, place, plainPlace];
        const found = async () => about((await textVerify(tx, Number.MAX_SAFE_INTEGER)).problems, mine).sort();
        expect(await found()).toEqual([]);
        // The params signed both marks; one taken out of the record as the migrator is a difference in `unfounded`.
        await tx.execute(sql`delete from unfounded_marks where item_id = ${items[0]!}::uuid`);
        expect(await found()).toEqual([`decision: it differs from the audit row at place ${place} that names it: unfounded`]);
        // A row signed before 3e carries neither member: its missing list reads as no marks, its missing replaced as false.
        await tx.execute(sql`update audit_log set metadata = metadata #- '{params,unfounded}' #- '{params,replaced}' where chain_seq = ${plainPlace}::bigint`);
        expect((await found()).filter((line) => line.includes(String(plainPlace)))).toEqual([]);
        // And such a row beside a decision that holds a mark is reported: what was not signed is not what korbat holds.
        await tx.execute(sql`update audit_log set metadata = metadata #- '{params,unfounded}' where chain_seq = ${place}::bigint`);
        expect(await found()).toEqual([`decision: it differs from the audit row at place ${place} that names it: unfounded`]);
      });
    });

    test("3e Task 7: a mark that korbat's own rules deleted is no difference: its report's day left the frame (the retention job's step) or its sender was forgotten (the account's purge); a mark deleted while korbat still knows its report and sender is", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const senders = [await newProfile(tx as unknown as Db), await newProfile(tx as unknown as Db), await newProfile(tx as unknown as Db)];
        const reports = [];
        for (const sender of senders) reports.push(await intake(tx, ground.rule(sender.id, "R1"), aPost(p.postId)));
        const items = reports.map((recorded) => recorded.items[0]!.id);
        const marked = await decideIn(tx, mod, reports[0]!.items[0]!.caseId!, { kind: "final", outcome: "no_violation", unfounded: items });
        const [place] = await placesOf(tx, [marked]);
        const found = async () => about((await textVerify(tx, Number.MAX_SAFE_INTEGER)).problems, [marked, place!]).sort();
        expect(await found()).toEqual([]);
        // The first report's day leaves the frame: forget_report_counts deletes its mark, as the retention job does.
        await tx.execute(sql`update intakes set received_at = now() - make_interval(days => ${STANDING_RULES.reportFrameDays}::int) where id = ${reports[0]!.intakeId}::uuid`);
        await tx.execute(sql`update unfounded_marks set reported_at = now() - make_interval(days => ${STANDING_RULES.reportFrameDays}::int) where item_id = ${items[0]!}::uuid`);
        await tx.execute(sql`select public.forget_report_counts()`);
        expect(await one(tx, sql`select count(*)::int as n from unfounded_marks where decision_id = ${marked}::uuid`)).toEqual({ n: 2 });
        expect(await found()).toEqual([]);
        // The second sender's account is deleted: its purge forgets who sent the report and deletes the mark with it.
        await authAccount(tx, senders[1]!.id, "0 seconds");
        await tx.execute(sql`select public.forget_reporter(${senders[1]!.id}::uuid)`);
        expect(await one(tx, sql`select count(*)::int as n from unfounded_marks where decision_id = ${marked}::uuid`)).toEqual({ n: 1 });
        expect(await found()).toEqual([]);
        // The third mark taken out by hand, while its report is in the frame and its sender known: that is a difference.
        await tx.execute(sql`delete from unfounded_marks where item_id = ${items[2]!}::uuid`);
        expect(await found()).toEqual([`decision: it differs from the audit row at place ${place} that names it: unfounded`]);
      });
    });

    test("it reports a post whose level the migrator set by hand, an image whose state was set, and a seal in force one of whose listed posts has lost an image row", async () => {
      await inWorld(async (tx) => {
        const removed = await imagePost(tx, 1);
        const first = await report(tx, aPost(removed.postId));
        await decideIn(tx, mod, first.caseId, { kind: "final", actions: [act("remove")] });
        const sealed = await imagePost(tx, 2);
        const suspect = await report(tx, aPost(sealed.postId), "csam");
        const seal = await decideIn(tx, admin, suspect.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        const [sealAction] = await tx.execute<{ id: string }>(sql`select id from decision_actions where decision_id = ${seal}::uuid`);
        const mine = [removed.postId, sealed.postId, ...removed.mediaIds, ...sealed.mediaIds, sealAction!.id];
        const found = async () => about((await textVerify(tx, Number.MAX_SAFE_INTEGER)).problems, mine).sort();
        expect(await found()).toEqual([]);

        // A removed post made visible again by hand, around the one writer of the level.
        await tx.execute(sql`update posts set moderation_level = 'visible', state = 'visible' where id = ${removed.postId}::uuid`);
        expect(await found()).toEqual(["post: its level is stored as visible, and the ledger of measures gives removed"]);
        // The level put right and only the state left: the two must agree unless the author deleted the post.
        await tx.execute(sql`update posts set moderation_level = 'removed' where id = ${removed.postId}::uuid`);
        expect(await found()).toEqual(["post: its state is stored as visible, and its level is removed"]);
        await tx.execute(sql`update posts set state = 'deleted_by_author' where id = ${removed.postId}::uuid`);
        expect(await found()).toEqual([]);

        // A sealed image shown again by hand.
        await tx.execute(sql.raw(`update post_media set moderation_state = 'visible' where id = '${sealed.mediaIds[0]!}'`));
        expect(await found()).toEqual(["image: its state is stored as visible, and the ledger of measures gives sealed"]);
        await tx.execute(sql.raw(`update post_media set moderation_state = 'sealed' where id = '${sealed.mediaIds[0]!}'`));
        // A sealed image row destroyed, which only the owner of the database can do: the keep trigger switched off first.
        await tx.execute(sql.raw("alter table public.post_media disable trigger post_media_keep"));
        await tx.execute(sql.raw(`delete from post_media where id = '${sealed.mediaIds[1]!}'`));
        await tx.execute(sql.raw("alter table public.post_media enable trigger post_media_keep"));
        expect(await found()).toEqual([`seal: it lists post ${sealed.postId} with 2 image rows, and the post has 1 now`]);
      });
    });

    test("the command itself reads on the API's role alone and exits 1 with what it found", async () => {
      // The shared database holds audit rows of decisions that earlier suites removed again, so the run is at fault or clean
      // by what they left; either way it reads, counts and answers, and the exit code follows its first line.
      const run = await cli(["text-verify"], { DATABASE_URL_API: process.env.DATABASE_URL_API! });
      expect(run.lines[0]).toMatch(/^(out text-verify: what the record names is what korbat holds: |err text-verify: FAILED, [0-9]+ problems? in )[0-9]+ confirmed rows, [0-9]+ decisions, [0-9]+ posts, [0-9]+ images and [0-9]+ seals in force/);
      expect(run.code).toBe(run.lines[0]!.startsWith("out ") ? 0 : 1);
    });
  });

  describe("account-facts", () => {
    test("it prints the handle, address and creation time of the case's subject with one audit row, and refuses any other account", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const author = await one<{ handle: string }>(tx, sql`select handle from profiles where id = ${p.authorId}::uuid`);
        const stranger = await newProfile(tx as unknown as Db);
        await authAccount(tx, p.authorId);
        await authAccount(tx, stranger.id);
        const { caseId } = await report(tx, aPost(p.postId), "csam");
        const accountCase = (await report(tx, anAccount(p.authorId, author.handle), "csam")).caseId;

        // Another account, a case that does not exist, a handle nobody has: nothing is read and nothing recorded.
        expect(await accountFacts(tx, stranger.handle, caseId)).toEqual({ ok: false, problem: `@${stranger.handle} is not the subject of case ${caseId}; nothing was read` });
        expect(await accountFacts(tx, author.handle, randomUUID())).toMatchObject({ ok: false, problem: expect.stringMatching(/^no case has the id /) });
        expect(await accountFacts(tx, "nobody_has_this", caseId)).toEqual({ ok: false, problem: "no account has the handle @nobody_has_this" });
        expect((await auditRows(tx, "account_facts_read", p.authorId)).length).toBe(0);
        expect((await auditRows(tx, "account_facts_read", stranger.id)).length).toBe(0);

        // The author of the case's post, then the account of an account case.
        const facts = await accountFacts(tx, `@${author.handle.toUpperCase()}`, caseId);
        expect(facts).toMatchObject({ ok: true });
        const lines = (facts as { lines: string[] }).lines;
        expect(lines.slice(0, 2)).toEqual([`handle: @${author.handle}`, `email: retention-${p.authorId}@korbat.local`]);
        expect(lines[2]).toMatch(/^account created: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
        expect((await auditRows(tx, "account_facts_read", p.authorId)).map((row) => ({ ...row }))).toEqual([{ actor_id: "00000000-0000-0000-0000-000000000000", target_type: "user", target_id: p.authorId, metadata: { caseId }, step_up: null }]);
        expect(await accountFacts(tx, author.handle, accountCase)).toMatchObject({ ok: true });
        expect((await auditRows(tx, "account_facts_read", p.authorId)).map((row) => row.metadata)).toEqual([{ caseId }, { caseId: accountCase }]);
      });
    });
  });

  describe("access-request", () => {
    const noContacts = async () => [];

    test("for a handle: every case with its items' sources and grounds, its snapshots (an erased one without content, a sealed image by id and state), its decisions and appeals; the urgent cases marked; no reporter anywhere; one audit row of counts", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const author = await one<{ handle: string }>(tx, sql`select handle from profiles where id = ${p.authorId}::uuid`);
        // Lane 2, closed without action, and its evidence erased: the snapshot is printed with its day and no content.
        const reporter = await newProfile(tx as unknown as Db);
        const quiet = await intake(tx, ground.illegal(reporter.id), aPost(p.postId));
        const quietCase = quiet.items[0]!.caseId!;
        await decideIn(tx, mod, quietCase, { kind: "final", outcome: "no_violation" });
        await ageCase(tx, quietCase, "3 days");
        await tx.execute(sql`select public.erase_case_evidence(${quietCase}::uuid)`);
        // Lane 0, closed: a report under R5 that an admin answered with a removal, which the author appealed.
        const second = await imagePost(tx, 0, p.authorId);
        const threat = await report(tx, aPost(second.postId), "rule", "R5");
        const removal = await decideIn(tx, admin, threat.caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
        await appealOf(tx, removal, p.authorId, "It was a joke.");
        // Lane 0, open: a report of child sexual abuse material about the account, its images sealed while deciding.
        const suspect = await report(tx, anAccount(p.authorId, author.handle), "csam");
        await decideIn(tx, mod, suspect.caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] });
        // A new look at the first post, in a case of its own: its snapshot lists the two images, now sealed.
        const third = await report(tx, aPost(p.postId));
        // The account's own report about someone else.
        const elsewhere = await imagePost(tx, 0);
        const own = await intake(tx, ground.illegal(p.authorId), aPost(elsewhere.postId));

        const drafted = await accessRequest(tx, ORIGIN, { handle: `@${author.handle.toUpperCase()}` }, noContacts);
        expect(drafted.ok).toBe(true);
        const draft = (drafted as { draft: AccountAccessDraft }).draft;
        const cases = draft.cases as { id: string; authoritiesCheck: string | null; closedAt: string | null; items: Record<string, unknown>[]; snapshots: { id: string; erasedOn: string | null; withheld: boolean; content: { body: string | null; media: Record<string, unknown>[] } | null }[]; decisions: Record<string, unknown>[]; appeals: Record<string, unknown>[] }[];
        const byId = new Map(cases.map((c) => [c.id, c]));
        expect([...byId.keys()].sort()).toEqual([quietCase, threat.caseId, suspect.caseId, third.caseId].sort());

        // The lane-2 case is not marked; the two urgent ones are, the closed one too.
        expect(byId.get(quietCase)!.authoritiesCheck).toBeNull();
        expect(byId.get(third.caseId)!.authoritiesCheck).toBeNull();
        expect(byId.get(threat.caseId)).toMatchObject({ authoritiesCheck: ACCESS_WORDS.authorities, closedAt: expect.any(String) });
        expect(byId.get(suspect.caseId)).toMatchObject({ authoritiesCheck: ACCESS_WORDS.authorities, closedAt: null });
        expect(ACCESS_WORDS.authorities).toBe("check the R2, Art. 18 and order records before sending: an authority may need the person not to be told yet, or national law may restrict access (GDPR Art. 23(1)(d))");

        // Sources as categories, with ground, rule and category.
        expect(byId.get(quietCase)!.items).toEqual([{ source: "a notice under Article 16", ground: "illegal content", rule: null, category: SPEECH, arrivedAt: expect.any(String) }]);
        expect(byId.get(threat.caseId)!.items).toMatchObject([{ source: "a report by another user", ground: "a korbat rule", rule: "R5" }]);
        expect(byId.get(suspect.caseId)!.items).toMatchObject([{ source: "a notice under Article 16", ground: "child sexual abuse material", rule: null }]);

        // The erased snapshot: its day, and no content.
        expect(byId.get(quietCase)!.snapshots).toEqual([{ id: expect.any(String), takenAt: expect.any(String), erasedOn: new Date().toISOString().slice(0, 10), withheld: true, content: null }]);
        // A held snapshot with its content; each sealed image by id and state, and nothing more.
        const shown = byId.get(third.caseId)!.snapshots[0]!;
        expect(shown).toMatchObject({ erasedOn: null, withheld: false, content: { body: "a post" } });
        expect(shown.content!.media).toEqual(p.mediaIds.map((id) => ({ id, state: "sealed" })));
        // The decisions with their statement's data and texts, and the author's own appeal with its statement.
        // 3e: the removal under R5 gave the post its strike, which the draft lists among the decision's measures.
        expect(byId.get(threat.caseId)!.decisions).toMatchObject([{ id: removal, kind: "final", outcome: "restricted", rule: "R5", measures: [{ kind: "remove", image: null, noEffect: null }, { kind: "strike", image: null, noEffect: null }], facts: expect.any(String), reason: expect.any(String), legalReference: null }]);
        expect(byId.get(threat.caseId)!.appeals).toMatchObject([{ decisionId: removal, statement: "It was a joke.", result: null }]);
        expect(byId.get(suspect.caseId)!.decisions).toMatchObject([{ kind: "interim", rule: "R2", measures: [{ kind: "seal_media" }] }]);

        // Under withheld: the identities, counted and never printed, and each text another person wrote, marked.
        expect(draft.withheld.identities).toEqual({ count: 3, reason: "rights of others: GDPR Art. 15(4), recital 63" });
        expect(draft.withheld.texts).toEqual([{ caseId: quietCase, kind: "explanation", text: "It breaks the law.", note: "send only after a person has weighed the writer's rights (C-203/22)" }]);
        const printed = JSON.stringify(draft);
        for (const hidden of [reporter.id, reporter.handle, quiet.intakeId]) expect(printed).not.toContain(hidden);
        // The account's own reports, as it sent them.
        expect(draft.ownReports).toMatchObject([{ ref: own.ref, ground: "illegal content", explanation: "It breaks the law.", items: [{ item: 1, link: `${ORIGIN}/post/${elsewhere.postId}`, shownOutcome: null, reexamination: false }] }]);
        // One audit row: the account, and counts.
        expect((await auditRows(tx, "access_request_drafted", p.authorId)).map((row) => ({ ...row }))).toEqual([{ actor_id: "00000000-0000-0000-0000-000000000000", target_type: "user", target_id: p.authorId, metadata: { cases: 4, contacts: 0 }, step_up: null }]);

        expect(await accessRequest(tx, ORIGIN, { handle: "nobody_has_this" }, noContacts)).toEqual({ ok: false, problem: "no account has the handle @nobody_has_this" });
      });
    });

    test("an R4 removal made final leaves no R4 text in the draft: the snapshots are printed without content and the post's body is gone", async () => {
      await inWorld(async (tx) => {
        const author = await newProfile(tx as unknown as Db);
        const secret = `a home address ${randomUUID()}`;
        const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body, created_at) values (${author.id}::uuid, ${secret}, now() - interval '30 days') returning id`);
        const { caseId } = await report(tx, aPost(post!.id));
        const removal = await decideIn(tx, mod, caseId, { kind: "final", ruleId: "R4", actions: [act("remove")] });
        const draftOf = async () => JSON.stringify(((await accessRequest(tx, ORIGIN, { handle: author.handle }, noContacts)) as { draft: AccountAccessDraft }).draft);
        expect(await draftOf()).toContain(secret);
        await ageCase(tx, caseId, "7 months");
        expect(await one(tx, sql`select public.redact_r4_body(${removal}::uuid) as done`)).toEqual({ done: true });
        const after = await draftOf();
        expect(after).not.toContain(secret);
        expect(after).toContain('"contentErasedOn":"');
      });
    });

    test("for an address: the contacts the auth module found, each with the name it gave and its notices; the audit row names nobody", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 0);
        const named = await newProfile(tx as unknown as Db);
        const contactId = randomUUID();
        const intakeId = await insertIntake(tx, { kind: "user", channel: "signed_out", contactId, allegesIllegal: true, category: SPEECH, explanation: "This post is unlawful.", citedLaw: "Section 5", bonaFide: true, lookupHash: hex64() });
        await insertItem(tx, { intakeId, caseId: await openCase(tx, "post", p.postId), targetId: p.postId, lane: 1 });
        await insertItem(tx, { intakeId, caseId: await openCase(tx, "account", named.id), targetType: "account", targetId: named.id, position: 2, lane: 1, namedHandle: "as_named" });
        const [notice] = await tx.execute<{ ref: string }>(sql`select ref from intakes where id = ${intakeId}::uuid`);
        const asked: string[] = [];
        const drafted = await accessRequest(tx, ORIGIN, { email: "notifier@korbat.local" }, async (email) => {
          asked.push(email);
          return [{ id: contactId, name: "Ann Notifier" }, { id: randomUUID(), name: null }];
        });
        expect(asked).toEqual(["notifier@korbat.local"]);
        const draft = (drafted as { draft: ContactsAccessDraft }).draft;
        expect(draft.contacts).toMatchObject([
          {
            name: "Ann Notifier",
            notices: [
              {
                ref: notice!.ref,
                ground: "illegal content",
                category: SPEECH,
                explanation: "This post is unlawful.",
                citedLaw: "Section 5",
                items: [
                  { item: 1, link: `${ORIGIN}/post/${p.postId}`, shownOutcome: null, reexamination: false },
                  // An account under the handle the notice named, never the one the profile holds.
                  { item: 2, link: `${ORIGIN}/u/as_named`, shownOutcome: null, reexamination: false },
                ],
              },
            ],
          },
          { name: null, notices: [] },
        ]);
        expect(JSON.stringify(draft)).not.toContain(named.handle);
        expect((await auditRows(tx, "access_request_drafted", null)).at(-1)).toMatchObject({ target_type: null, target_id: null, metadata: { cases: 0, contacts: 2 }, step_up: null });
      });
    });

    test("the id before an id: one row is read by its id through a page of one", () => {
      expect(uuidBefore("00000000-0000-0000-0000-000000000001")).toBe("00000000-0000-0000-0000-000000000000");
      expect(uuidBefore("00000000-0000-0000-0000-000000000000")).toBeNull();
      expect(uuidBefore("3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b00")).toBe("3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3aff");
      expect(uuidBefore("3f1c2b1e-8d4a-4c1e-9b2a-000000000000")).toBe("3f1c2b1e-8d4a-4c1e-9b29-ffffffffffff");
      expect(() => uuidBefore("3F1C2B1E-8D4A-4C1E-9B2A-6F0E5D4C3B00")).toThrow(TypeError);
    });
  });

  test("this file left no row behind: the moderation tables and the staff links hold what they held before it", async () => {
    const after = await rowCounts(apiDb);
    // The two accounts of the link test keep their profiles, as every suite's accounts do.
    expect({ ...after, profiles: before.profiles }).toEqual(before);
    expect(after.profiles! - before.profiles!).toBe(2);
    expect(await authCaseCounts(migrateDb)).toEqual(beforeAuth);
    expect(await one(migrateDb, sql`select decisions_per_hour as h, decisions_per_day as d, case_opens_per_day as o, findings_per_day as f, reveals_per_day as r from moderation_limits where id = 1`)).toEqual({ h: 60, d: 300, o: 400, f: 50, r: 10 });
    // The row count above is the public profiles table's: the link test's two profiles are found by their ids' rows.
    expect((await apiDb.select({ id: profiles.id }).from(profiles).where(eq(profiles.handle, "nobody_has_this"))).length).toBe(0);
  });
});
