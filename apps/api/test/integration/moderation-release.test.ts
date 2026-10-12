import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  aPost,
  act,
  anAccount,
  decideIn,
  ground,
  imagePost,
  insertItem,
  intake,
  newTestStaff,
  newestSnapshot,
  report,
  rowCounts,
  ruleReport,
  saveText,
  staffProfile,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Every test here runs dozens of statements inside one open transaction, each a round trip: on a loaded machine that
// takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * The daily release of outcomes, the one predicate that withholds a snapshot's content, and a case's history (3c design,
 * section 6.2), against the real database. The release takes what was answered before its cut-off, and inside one
 * transaction every time is that transaction's start: so the tests of the release run as the migrator, which dates a
 * decision, a reversal or a pending mark back, inside a transaction that is rolled back. Every cut-off they pass lies at
 * least an hour back, so a release never touches what another suite's decisions left in the shared database minutes ago.
 * The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the release of outcomes, withheld snapshots and a case's history", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with the moderator's profile in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = migrateDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The release with a cut-off this long ago; answers how many items it changed. */
  const release = async (tx: DbTx, ago: string) => (await tx.execute<{ n: number }>(sql`select public.release_outcomes(now() - ${ago}::interval) as n`))[0]!.n;
  /** Dates a decision, with its measures and reversals, back. */
  const decidedAgo = async (tx: DbTx, decisionId: string, ago: string) => {
    await tx.execute(sql`update decisions set decided_at = now() - ${ago}::interval where id = ${decisionId}::uuid`);
    await tx.execute(sql`update decision_actions set created_at = now() - ${ago}::interval where decision_id = ${decisionId}::uuid`);
  };
  /** What an item's sender is shown and owed. */
  const shown = async (tx: DbTx, itemId: string) => {
    const [row] = await tx.execute<{ outcome: string | null; shown: string | null; released: boolean; pending: boolean; revised: boolean; mail: string }>(sql`
      select outcome, shown_outcome as shown, outcome_sent_at is not null as released, revision_pending_at is not null as pending, revised_sent_at is not null as revised, outcome_mail as mail
        from intake_items where id = ${itemId}::uuid`);
    return { ...row! };
  };
  /** A post with a notice of illegality by a signed-in reporter, who is owed a mail about its outcome. */
  async function noticed(tx: DbTx, images = 0) {
    const p = await imagePost(tx, images);
    const { caseId, recorded } = await report(tx, aPost(p.postId), "illegal");
    return { ...p, caseId, itemId: recorded.items[0]!.id };
  }

  describe("release_outcomes", () => {
    test("it releases what was answered before the cut-off, with its outcome as of the cut-off, and leaves the rest for the next one", async () => {
      await inWorld(async (tx) => {
        // Whatever other suites' decisions left releasable in the shared database goes first, so the counts below are this test's own.
        await release(tx, "1 hour");
        // Answered five hours ago, without action.
        const cleared = await noticed(tx);
        await decidedAgo(tx, await decideIn(tx, mod, cleared.caseId, { kind: "final", outcome: "no_violation" }), "5 hours");
        // Answered just now: after every cut-off these releases pass.
        const fresh = await noticed(tx);
        await decideIn(tx, mod, fresh.caseId, { kind: "final", outcome: "no_violation" });
        // A link that named nothing live, answered at intake three hours ago: its own time counts.
        const dead = await insertItem(tx, { intakeId: await ruleReport(tx, (await profile(tx)).id), caseId: null, targetId: randomUUID(), outcome: "not_available" });
        await tx.execute(sql`update intake_items set created_at = now() - interval '3 hours' where id = ${dead.id}::uuid`);
        // Removed five hours ago and restored four hours ago: its sender is told the outcome as it stands at the cut-off.
        const undone = await noticed(tx);
        const removal = await decideIn(tx, mod, undone.caseId, { kind: "final", actions: [act("remove")] });
        await decidedAgo(tx, removal, "5 hours");
        await decidedAgo(tx, await decideIn(tx, mod, undone.caseId, { kind: "correction", reviewsDecisionId: removal, actions: [act("restore")] }), "4 hours");
        await tx.execute(sql`update intake_items set revision_pending_at = now() - interval '4 hours' where id = ${undone.itemId}::uuid`);
        // Removed five hours ago and restored just now: released as it stood, the reversal waits for the next release.
        const late = await noticed(tx);
        const lateRemoval = await decideIn(tx, mod, late.caseId, { kind: "final", actions: [act("remove")] });
        await decidedAgo(tx, lateRemoval, "5 hours");
        await decideIn(tx, mod, late.caseId, { kind: "correction", reviewsDecisionId: lateRemoval, actions: [act("restore")] });

        expect(await shown(tx, cleared.itemId)).toEqual({ outcome: "no_violation", shown: null, released: false, pending: false, revised: false, mail: "pending" });
        expect(await release(tx, "1 hour")).toBe(4);
        expect(await shown(tx, cleared.itemId)).toEqual({ outcome: "no_violation", shown: "no_violation", released: true, pending: false, revised: false, mail: "pending" });
        expect(await shown(tx, dead.id)).toMatchObject({ outcome: "not_available", shown: "not_available", released: true });
        expect(await shown(tx, undone.itemId)).toEqual({ outcome: "restricted_rule", shown: "reversed", released: true, pending: false, revised: false, mail: "pending" });
        expect(await shown(tx, late.itemId)).toEqual({ outcome: "restricted_rule", shown: "restricted_rule", released: true, pending: true, revised: false, mail: "pending" });
        expect(await shown(tx, fresh.itemId)).toEqual({ outcome: "no_violation", shown: null, released: false, pending: false, revised: false, mail: "pending" });
        // The release's time is now, never the cut-off.
        const [times] = await tx.execute<{ now: boolean }>(sql`select outcome_sent_at = now() as now from intake_items where id = ${cleared.itemId}::uuid`);
        expect(times!.now).toBe(true);
        // A second release with the same cut-off changes nothing.
        expect(await release(tx, "1 hour")).toBe(0);
      });
    });

    test("a changed outcome is shown at the release after its reversal, its mail is due again only when what is shown changes, and a sender without a mail gets none", async () => {
      await inWorld(async (tx) => {
        // Whatever other suites' decisions left releasable in the shared database goes first, so the counts below are this test's own.
        await release(tx, "1 hour");
        const p = await noticed(tx, 2);
        // A second sender, under a rule: nobody owes them a mail.
        const second = (await report(tx, aPost(p.postId))).recorded.items[0]!.id;
        const [one, two] = p.mediaIds as [string, string];
        const removal = await decideIn(tx, mod, p.caseId, { kind: "final", actions: [act("remove"), act("remove_media", one), act("remove_media", two)] });
        await decidedAgo(tx, removal, "10 hours");
        expect(await release(tx, "9 hours")).toBe(2);
        expect(await shown(tx, p.itemId)).toMatchObject({ shown: "restricted_rule", pending: false, mail: "pending" });
        expect(await shown(tx, second)).toMatchObject({ shown: "restricted_rule", mail: "none" });
        const sent = () => tx.execute(sql`update intake_items set outcome_mail = 'sent' where id = ${p.itemId}::uuid`);
        /** A correction of the removal that lifts these, dated this long ago with the mark it left on the items. */
        const corrected = async (outcome: "partly_reversed" | "reversed", actions: ReturnType<typeof act>[], ago: string) => {
          await decidedAgo(tx, await decideIn(tx, mod, p.caseId, { kind: "correction", reviewsDecisionId: removal, outcome, actions }), ago);
          await tx.execute(sql`update intake_items set revision_pending_at = now() - ${ago}::interval where answered_by = ${removal}::uuid`);
        };

        // One of three measures lifted eight hours ago: "partly reversed" at the next release, and the mail is due again.
        await sent();
        await corrected("partly_reversed", [act("restore_media", one)], "8 hours");
        expect(await shown(tx, p.itemId)).toMatchObject({ shown: "restricted_rule", pending: true, revised: false, mail: "sent" });
        expect(await release(tx, "7 hours")).toBe(2);
        expect(await shown(tx, p.itemId)).toEqual({ outcome: "restricted_rule", shown: "partly_reversed", released: true, pending: false, revised: true, mail: "pending" });
        expect(await shown(tx, second)).toMatchObject({ shown: "partly_reversed", revised: true, pending: false, mail: "none" });

        // A second measure lifted six hours ago: still "partly reversed", so nothing new is shown and no mail is due.
        await sent();
        await tx.execute(sql`update intake_items set revised_sent_at = now() - interval '7 hours' where answered_by = ${removal}::uuid`);
        await corrected("partly_reversed", [act("restore_media", two)], "6 hours");
        expect(await release(tx, "5 hours")).toBe(2);
        expect(await shown(tx, p.itemId)).toMatchObject({ shown: "partly_reversed", pending: false, mail: "sent" });
        const [unmoved] = await tx.execute<{ kept: boolean }>(sql`select revised_sent_at = now() - interval '7 hours' as kept from intake_items where id = ${p.itemId}::uuid`);
        expect(unmoved!.kept).toBe(true);

        // The last measure lifted three hours ago. A release whose cut-off lies before that changes nothing and keeps the
        // mark; the next one shows "reversed".
        await corrected("reversed", [act("restore")], "3 hours");
        expect(await release(tx, "4 hours")).toBe(0);
        expect(await shown(tx, p.itemId)).toMatchObject({ shown: "partly_reversed", pending: true, mail: "sent" });
        expect(await release(tx, "2 hours")).toBe(2);
        expect(await shown(tx, p.itemId)).toMatchObject({ shown: "reversed", pending: false, revised: true, mail: "pending" });
        expect(await shown(tx, second)).toMatchObject({ shown: "reversed", mail: "none" });
        // The stored outcome is the decision's, for good.
        expect((await shown(tx, p.itemId)).outcome).toBe("restricted_rule");
      });
    });

    test("the cut-off is never in the future; the API role may run the release, and writes neither a release time nor a shown outcome itself", async () => {
      await inWorld(async (tx) => {
        const p = await noticed(tx);
        await decideIn(tx, mod, p.caseId, { kind: "final", outcome: "no_violation" });
        const call = (cutoff: ReturnType<typeof sql>) => pgError(tx.transaction((sp) => sp.execute(sql`select public.release_outcomes(${cutoff})`)));
        const refused = { code: "22023", message: "release_outcomes takes a cut-off that is not in the future" };
        expect(await call(sql`now() + interval '1 second'`)).toEqual(refused);
        expect(await call(sql`'infinity'::timestamptz`)).toEqual(refused);
        expect(await call(sql`null::timestamptz`)).toEqual(refused);
        // The API role runs it. What was answered in this very transaction is not before a cut-off of now.
        expect(await call(sql`now()`)).toBeNull();
        expect(await shown(tx, p.itemId)).toMatchObject({ released: false, shown: null });
        for (const column of ["outcome_sent_at = now()", "shown_outcome = 'reversed'", "revised_sent_at = now()", "revision_pending_at = null", "outcome = 'no_violation'"]) {
          const err = await pgError(tx.transaction((sp) => sp.execute(sql`update intake_items set ${sql.raw(column)} where id = ${p.itemId}::uuid`)));
          expect(err, column).toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table intake_items/) });
        }
        // The mail's state is the API's to write.
        expect(await pgError(tx.transaction((sp) => sp.execute(sql`update intake_items set outcome_mail = 'sent' where id = ${p.itemId}::uuid`)))).toBeNull();
      }, apiDb);
    });
  });

  describe("snapshot_withheld", () => {
    test("a snapshot is withheld when it is erased, or when it holds content of a post whose content was erased since; an id that names none is withheld", async () => {
      await inWorld(async (tx) => {
        const withheld = async (id: string) => (await tx.execute<{ withheld: boolean }>(sql`select public.snapshot_withheld(${id}::uuid) as withheld`))[0]!.withheld;
        expect(await withheld(randomUUID())).toBe(true);

        const p = await imagePost(tx);
        const first = await report(tx, aPost(p.postId));
        const copy = await newestSnapshot(tx, first.caseId);
        expect(await withheld(copy.id)).toBe(false);
        // An account's snapshot holds no post's content.
        const owner = await profile(tx);
        const account = await newestSnapshot(tx, (await report(tx, anAccount(owner.id, owner.handle))).caseId);
        expect(await withheld(account.id)).toBe(false);

        // The post's content is erased: the copy taken before is withheld wherever it would be shown.
        await decideIn(tx, mod, first.caseId, { kind: "final", outcome: "no_violation" });
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${p.postId}::uuid`);
        expect(await withheld(copy.id)).toBe(true);
        expect(await withheld(account.id)).toBe(false);
        // A copy taken after the erasure holds no content, so it is shown as it is.
        const later = await newestSnapshot(tx, (await report(tx, aPost(p.postId))).caseId);
        expect(later.id).not.toBe(copy.id);
        const [held] = await tx.execute<{ body: string | null }>(sql`select body from evidence_snapshots where id = ${later.id}::uuid`);
        expect(held!.body).toBe("");
        expect(await withheld(later.id)).toBe(false);
        // An alt text is content too.
        await tx.execute(sql`update evidence_snapshots set media = '[{"id": "00000000-0000-4000-8000-000000000001", "alt": "what the image shows", "width": 1, "height": 1}]'::jsonb where id = ${later.id}::uuid`);
        expect(await withheld(later.id)).toBe(true);
        await tx.execute(sql`update evidence_snapshots set media = '[{"id": "00000000-0000-4000-8000-000000000001", "alt": null, "width": 1, "height": 1}]'::jsonb where id = ${later.id}::uuid`);
        expect(await withheld(later.id)).toBe(false);

        // An erased snapshot is withheld whatever its post.
        await tx.execute(sql`update evidence_snapshots set erased_at = now(), body = null, media = null, display_name = null, bio = null, salt = null where id = ${account.id}::uuid`);
        expect(await withheld(account.id)).toBe(true);
      });
    });

    test("the API role may ask it", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const copy = await newestSnapshot(tx, (await report(tx, aPost(p.postId))).caseId);
        const [row] = await tx.execute<{ withheld: boolean; none: boolean }>(sql`select public.snapshot_withheld(${copy.id}::uuid) as withheld, public.snapshot_withheld(${randomUUID()}::uuid) as none`);
        expect({ ...row! }).toEqual({ withheld: false, none: true });
      }, apiDb);
    });
  });

  describe("case_history", () => {
    test("one row for each item, snapshot, decision and note of the case, with what each event is about and never a text", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const reporter = await profile(tx);
        const recorded = await intake(tx, ground.rule(reporter.id, "R3"), aPost(p.postId));
        const caseId = recorded.items[0]!.caseId!;
        const notice = (await report(tx, aPost(p.postId), "illegal")).recorded;
        const snapshot = await newestSnapshot(tx, caseId);
        await saveText(tx, caseId, mod.id, "note", "A note that the history must not carry.");
        const interim = await decideIn(tx, mod, caseId, { kind: "interim", ruleId: "R3", actions: [act("withhold")] });
        const final = await decideIn(tx, mod, caseId, { kind: "final", outcome: "not_evident" });
        // Another case's events are not this case's.
        await report(tx, aPost((await imagePost(tx)).postId));

        const rows = await tx.execute<Record<string, unknown>>(sql`
          select event, ref_id, seq, intake_kind, rule_id, alleges_illegal, csam, reexamination, decision_kind, outcome, staff_id, result,
                 date_trunc('milliseconds', at) = date_trunc('milliseconds', now()) as at_now
            from case_history where case_id = ${caseId}::uuid`);
        const none = { seq: null, intake_kind: null, rule_id: null, alleges_illegal: null, csam: null, reexamination: null, decision_kind: null, outcome: null, staff_id: null, result: null, at_now: true };
        const [note] = await tx.execute<{ id: string }>(sql`select id from staff_texts where case_id = ${caseId}::uuid and kind = 'note'`);
        const expected = [
          { ...none, event: "item", ref_id: recorded.items[0]!.id, seq: 1, intake_kind: "user", rule_id: "R3", alleges_illegal: false, csam: false, reexamination: false },
          { ...none, event: "item", ref_id: notice.items[0]!.id, seq: 2, intake_kind: "user", alleges_illegal: true, csam: false, reexamination: false },
          { ...none, event: "snapshot", ref_id: snapshot.id },
          { ...none, event: "note", ref_id: note!.id },
          { ...none, event: "decision", ref_id: interim, decision_kind: "interim", outcome: "restricted", staff_id: mod.id },
          { ...none, event: "decision", ref_id: final, decision_kind: "final", outcome: "not_evident", staff_id: mod.id },
        ];
        const byRef = (a: Record<string, unknown>, b: Record<string, unknown>) => String(a.ref_id).localeCompare(String(b.ref_id));
        expect(rows.map((row) => ({ ...row })).sort(byRef)).toEqual([...expected].sort(byRef));
        // The view has no column that could carry a text.
        const columns = await tx.execute<{ name: string; type: string }>(sql`select attname::text as name, atttypid::regtype::text as type from pg_attribute where attrelid = 'public.case_history'::regclass and attnum > 0`);
        expect(columns.filter((column) => column.type === "text").map((column) => column.name).sort()).toEqual(["event", "rule_id"]);
      }, apiDb);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
