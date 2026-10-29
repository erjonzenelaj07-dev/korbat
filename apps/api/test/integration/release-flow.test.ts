import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEDIA_SIZES, RELEASE_POSTS_MAX, type SealReleasedParams } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AuthForModeration } from "../../src/auth";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { STAFF_USAGE, runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { storedImageName } from "../../src/media";
import { createMediaRepo } from "../../src/media/repo";
import { WITHOUT_MEDIA } from "../../src/social/context";
import { getPost } from "../../src/social/flows/posts";
import { ModerationError } from "../../src/moderation";
import { appealsList } from "../../src/moderation/appeals";
import { overview } from "../../src/moderation/cases";
import { authorNotices, authorRelease, releaseNotices, releaseSeal } from "../../src/moderation/release";
import { deciderWorld, linkedAdmin, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, appealOf, imagePost, postFrozen, refusal, removeDecided, removeFixtures, report } from "./moderation-fixtures";
import { SEAL_FOR_GOOD, removeRecords, sealActionOf } from "./records-fixtures";
import { moveForTest, releaseCounts, releasesOf, removeReleases, reportForTest, sealRecord } from "./release-fixtures";
import { socialHarness } from "./social-harness";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);

/** A sealed post of this file: its author, its images, its case, the sealing decision and its seal's ledger row. */
interface Sealed {
  authorId: string;
  postId: string;
  mediaIds: string[];
  caseId: string;
  decisionId: string;
  sealActionId: string;
}

/**
 * The release as an admin takes it (3d design, sections 7.2, 7.14, 8.10 and 9.6; 12.1 rows 16 and 18), through the
 * moderation module's own function under real staff keys: the leave recorded by staff.js release-leave, the case answer's
 * release block, the release and its confirmed audit row, the alert seal_released to every staff account, the author's
 * notice at once, or born held while the leave is not to be told and sent by the dispatch round that finds the hold
 * ended, the author's two reads, Home's list and the appeal's mark, the withdrawal of a leave a release rests on refused,
 * release-show, and the destroy line's record taking the release's id. Every mail goes to a recording auth interface.
 * The last test removes what the file made.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the release, as an admin takes it (3d Task 2)", () => {
  let world: DeciderWorld;
  let admin: RealStaff;
  let moderator: RealStaff;
  let apiDb: Db;
  let migrateDb: Db;
  let startedAt: string;
  let releasesBefore: Record<string, number>;
  /** At once: reported, moved, a leave from a court. Held: the same with the leave not to be told. */
  let atOnce: Sealed;
  let held: Sealed;
  const authors: string[] = [];
  const posts: string[] = [];
  const accountMails: { userId: string; template: string }[] = [];
  const staffMails: string[] = [];

  /** The auth module's interface as moderation calls it, recording every mail and taking each. */
  const auth = new Proxy({} as AuthForModeration, {
    get: (_target, member) => {
      if (typeof member !== "string" || member === "then") return undefined;
      if (member === "mailAccount") return async (userId: string, message: { template: string }) => (accountMails.push({ userId, template: message.template }), "sent");
      if (member === "mailStaff") return async (message: { template: string }) => (staffMails.push(message.template), 1);
      if (member === "overdueContacts") return async () => 0;
      return async () => undefined;
    },
  });

  const cli = async (args: string[], input = "") => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input, "utf8"));
    return { code, lines, text: lines.join(LF) };
  };

  async function sealed(): Promise<Sealed> {
    const p = await imagePost(apiDb, 2);
    authors.push(p.authorId);
    posts.push(p.postId);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, SEAL_FOR_GOOD);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    return { ...p, caseId, decisionId: outcome.decisionId, sealActionId: await sealActionOf(migrateDb, outcome.decisionId) };
  }

  /** The release block of the seal's decision, as the console reads the case. */
  const blockOf = async (member: RealStaff, seal: Sealed) => {
    const view = await world.moderation.forStaff.caseView(member.session, seal.caseId);
    return view.decisions.find((decision) => decision.id === seal.decisionId)!;
  };
  /** The release, under the member's real key, with the params the block shows, through the module's own function. */
  async function release(member: RealStaff, seal: Sealed, params?: SealReleasedParams) {
    // The params as an admin's block shows them: a moderator's block has no leave (review ruling M1).
    const block = (await blockOf(admin, seal)).release!;
    const signed: SealReleasedParams = params ?? { postIds: block.postIds, basis: "leave", leaveId: block.leave!.id, theirReference: block.leave!.reference };
    const confirmed = await world.confirmAction(member, { action: "seal_released", target: { type: "seal", id: seal.sealActionId }, params: signed });
    try {
      const outcome = await world.moderation.forStaff.release(member.session, confirmed, { requestId: `req-${randomUUID()}` });
      await world.moderation.settle();
      return outcome;
    } catch (err) {
      if (err instanceof ModerationError) return err.code;
      throw err;
    }
  }
  const dispatchDeps = () => ({ ...world.moderation.deps, auth });
  /** The post's images as a reader's PostView carries them, through the social module's own read and the media module's. */
  async function mediaOf(viewer: string | null, seal: Sealed) {
    const repo = createMediaRepo(apiDb);
    // 2d Task 3: no avatar is set here; WITHOUT_MEDIA's avatar members answer none.
    const social = socialHarness(apiDb, { media: { ...WITHOUT_MEDIA, attach: (tx, input) => repo.attach(tx, input), detachAll: (tx, postId) => repo.detachAll(tx, postId), requestDeletion: async () => undefined, forPosts: (ids) => repo.forPosts(ids) } });
    return (await getPost(social.deps, viewer, seal.postId)).media;
  }
  /** How many of the post's image rows the API's role can delete, in a transaction that is rolled back: none while the post is frozen. */
  async function deletable(seal: Sealed): Promise<number> {
    let deleted = 0;
    await apiDb
      .transaction(async (tx) => {
        deleted = (await tx.execute(sql`delete from post_media where post_id = ${seal.postId}::uuid returning id`)).length;
        throw new Error("rolled back");
      })
      .catch(() => undefined);
    return deleted;
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    startedAt = (await migrateDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    releasesBefore = await releaseCounts(migrateDb);
    world = deciderWorld(apiDb, { auth });
    admin = await world.staff("admin");
    moderator = await world.staff("moderator");
    atOnce = await sealed();
    held = await sealed();
    for (const seal of [atOnce, held]) {
      await reportForTest(migrateDb, seal.sealActionId, { answer: "illegal" });
      await moveForTest(migrateDb, seal.mediaIds);
    }
  }, 300_000);

  afterAll(async () => {
    await migrateDb.execute(sql`delete from public.alert_outbox where created_at >= ${startedAt}::timestamptz`);
    await removeReleases(migrateDb, posts, [atOnce.sealActionId, held.sealActionId], [...atOnce.mediaIds, ...held.mediaIds]);
    await removeRecords(migrateDb, [...authors, admin.id, moderator.id]);
    await removeDecided(migrateDb, posts, [admin.id, moderator.id]);
    await removeFixtures(migrateDb, authors);
    await world.close();
    await Promise.all([closeDb(migrateDb), closeDb(apiDb)]);
  });

  test("release-leave records a leave from the paper, with its audit row, and refuses what it cannot record", async () => {
    for (const command of ["release-leave", "release-show", "release-replay"]) expect(STAFF_USAGE, command).toContain(`  ${command} `);
    const unsealed = await cli(["release-leave", randomUUID(), "--by", "court", "--reference", "4 O 1/26", "--day", "2026-10-01", "--operator", "the operator"]);
    // 3d Task 7: release-leave also takes a held upload's refusal, and says so when the id names neither.
    expect(unsealed.text).toMatch(/^err release-leave: [0-9a-f-]{36} is not the ledger row of a seal for good in force, nor a held upload's refusal; nothing changed$/);
    expect((await cli(["release-leave", atOnce.sealActionId, "--by", "police", "--reference", "x", "--day", "2026-10-01", "--operator", "op"])).text).toBe("err release-leave: --by is authority or court; nothing changed");
    expect((await cli(["release-leave", atOnce.sealActionId, "--by", "court", "--reference", "x", "--day", "2999-01-01", "--operator", "op"])).text).toBe(
      "err release-leave: --day 2999-01-01 is after today: a leave bears the day it was given; nothing changed",
    );
    expect((await cli(["release-leave", atOnce.sealActionId, "--by", "court", "--reference", "x", "--day", "2026-10-01", "--operator", "op", "--until", "2026-12-01T00:00:00Z"])).text).toBe(
      "err release-leave: --until is given only with --untold, or with --end-untold; nothing changed",
    );
    const recorded = await cli(["release-leave", atOnce.sealActionId, "--by", "court", "--reference", "4 O 1/26", "--day", "2026-10-01", "--operator", "the operator"]);
    expect(recorded.code).toBe(0);
    const id = /leave ([0-9a-f-]{36}) recorded/.exec(recorded.text)![1]!;
    expect(recorded.lines).toEqual([
      `out release-leave: leave ${id} recorded for seal ${atOnce.sealActionId}, on the record of its report: from court, reference 4 O 1/26, of 2026-10-01; the person may be told. An admin can now release it on the case.`,
    ]);
    const [audit] = await migrateDb.execute<{ action: string; actor_id: string; target_type: string; target_id: string; metadata: Record<string, unknown> }>(
      sql`select action, actor_id, target_type, target_id, metadata from public.audit_log where action = 'release_leave_recorded' order by chain_seq desc limit 1`,
    );
    expect({ ...audit }).toEqual({
      action: "release_leave_recorded",
      actor_id: SYSTEM_ACTOR_ID,
      target_type: "notification",
      target_id: await sealRecord(migrateDb, atOnce.sealActionId),
      metadata: { leaveId: id, from: "court", reference: "4 O 1/26", receivedOn: "2026-10-01", untold: false, untoldUntil: null },
    });
    // The second seal's leave is not to be told, with an open end.
    const untold = await cli(["release-leave", held.sealActionId, "--by", "authority", "--reference", "AZ 7/26", "--day", "2026-10-02", "--operator", "the operator", "--untold"]);
    expect(untold.text).toMatch(/the person is not to be told, with no end recorded[.] An admin can now release it on the case[.]$/);
  });

  test("the case answer's release block: the facts, the posts the key names, no period; a moderator is refused admin_required", async () => {
    const decision = await blockOf(admin, atOnce);
    expect(decision.release).toMatchObject({ reported: true, answer: "illegal", quarantined: true, preserved: false, tellHeld: false, postIds: [atOnce.postId], remaining: 0, silenceDays: null, releasedAt: null });
    expect(decision.release!.leave).toMatchObject({ from: "court", reference: "4 O 1/26", receivedOn: "2026-10-01", untold: false, untoldUntil: null });
    expect((await blockOf(admin, held)).release).toMatchObject({ tellHeld: true, leave: { untold: true, untoldUntil: null } });
    // Review ruling M1: a moderator's case view carries neither the authority's reference and assessment nor the leave.
    const seen = (await blockOf(moderator, atOnce)).release!;
    expect(Object.keys(seen).filter((key) => ["theirReference", "answer", "answeredAt", "leave"].includes(key))).toEqual([]);
    expect(seen).toMatchObject({ reported: true, quarantined: true, postIds: [atOnce.postId] });
    expect(JSON.stringify(seen)).not.toContain("4 O 1/26");
    expect(await release(moderator, atOnce)).toBe("admin_required");
    expect(RELEASE_POSTS_MAX).toBe(1000);
  });

  test("review M2: an admin linked to the seal's subject is refused the release, staff_recused, before and inside seal_release, and nothing is written", async () => {
    const link = await linkedAdmin(world, apiDb, migrateDb, atOnce.authorId);
    const linked = link.staff;
    try {
      expect(await release(linked, atOnce)).toBe("staff_recused");
      expect(await releasesOf(migrateDb, atOnce.sealActionId)).toEqual([]);
      // The database refuses it too, whatever the API asks first.
      const leaveId = (await blockOf(admin, atOnce)).release!.leave!.id;
      await rolledBack(apiDb, async (tx) => {
        expect(await refusal(tx.transaction((sp) => sp.execute(sql`select public.seal_release(${atOnce.sealActionId}::uuid, 'leave', ${leaveId}::uuid, ${linked.id}::uuid)`)))).toBe("staff_recused");
      });
    } finally {
      await link.unlink();
    }
  });

  test("a release under an admin's key: the record, its confirmed audit row, the alert to every staff account, and the notice at once", async () => {
    const outcome = await release(admin, atOnce);
    expect(outcome).toMatchObject({ caseId: atOnce.caseId });
    const releaseId = (outcome as { releaseId: string }).releaseId;
    const [row] = await releasesOf(migrateDb, atOnce.sealActionId);
    expect(row).toMatchObject({ id: releaseId, post_ids: [atOnce.postId], basis: "leave", author_notice: "sent" });
    const [audit] = await migrateDb.execute<{ actor_id: string; target_type: string; target_id: string; step_up: unknown; metadata: { params: Record<string, unknown>; releaseId: string } }>(
      sql`select actor_id, target_type, target_id, step_up, metadata from public.audit_log where action = 'seal_released' order by chain_seq desc limit 1`,
    );
    expect([audit!.actor_id, audit!.target_type, audit!.target_id, audit!.step_up !== null, audit!.metadata.releaseId]).toEqual([admin.id, "seal", atOnce.sealActionId, true, releaseId]);
    expect(audit!.metadata.params).toMatchObject({ postIds: [atOnce.postId], basis: "leave", theirReference: "4 O 1/26" });
    // Every staff account is alerted, without a throttle: one row of the outbox, its mail claimed.
    const alerts = await migrateDb.execute<{ facts: Record<string, unknown>; mailed: boolean }>(
      sql`select facts, mailed_at is not null as mailed from public.alert_outbox where kind = 'seal_released' and created_at >= ${startedAt}::timestamptz`,
    );
    expect(alerts.map((a) => [a.facts.posts, a.facts.uploads, a.mailed])).toEqual([[1, 0, true]]);
    expect(staffMails).toContain("seal_released");
    expect(accountMails.filter((mail) => mail.template === "release_notice")).toEqual([{ userId: atOnce.authorId, template: "release_notice" }]);
    // The answer: the block reads released, the custody its files left; Home lists the release; the author reads it.
    const decision = await blockOf(admin, atOnce);
    expect(decision.release).toMatchObject({ postIds: [], releasedAt: expect.any(String), basis: "leave", noticeHeld: false, releasedPosts: 1, releasedImages: 2 });
    expect(decision.custody).toMatchObject({ files: 0, filesLeft: 4 });
    const home = await overview(world.moderation.deps, admin.session);
    expect(home.destructive.find((entry) => entry.caseId === atOnce.caseId)).toMatchObject({ kind: "seal_released", refusalId: null });
    expect(home.quarantine.undestroyed).toBeGreaterThanOrEqual(4);
    const notices = await authorNotices(world.moderation.deps, atOnce.authorId);
    expect(notices.notices.map((notice) => notice.id)).toContain(releaseId);
    const view = await authorRelease(world.moderation.deps, atOnce.authorId, releaseId);
    // 3d review L11: no appeal of the sealing decision is filed yet, which its paragraph says.
    expect(view).toMatchObject({ id: releaseId, basis: "leave", upload: false, postCount: 1, images: 2, sealDecisionId: atOnce.decisionId, posts: [{ id: atOnce.postId }], appeal: "none" });
    // Nobody else reads it, and its id names nothing to a stranger.
    await expect(authorRelease(world.moderation.deps, held.authorId, releaseId)).rejects.toMatchObject({ code: "not_found" });
    // A second release of the seal finds every post released; the leave it rests on cannot be withdrawn.
    expect(await release(admin, atOnce, { postIds: [atOnce.postId], basis: "leave", leaveId: decision.release!.leave!.id, theirReference: "4 O 1/26" })).toBe("release_not_open");
    const withdraw = await cli(["release-leave", "--withdraw", decision.release!.leave!.id, "--operator", "the operator"]);
    expect(withdraw.text).toBe(`err release-leave: leave_used: a release already rests on leave ${decision.release!.leave!.id}; nothing changed`);
  });

  test("a waiting appeal of a released seal stays open and is marked with the release", async () => {
    await appealOf(apiDb, atOnce.decisionId, atOnce.authorId);
    const page = await appealsList(world.moderation.deps, admin.session);
    const row = page.appeals.find((appeal) => appeal.decisionId === atOnce.decisionId);
    expect(row?.released).toMatchObject({ basis: "leave", at: expect.any(String) });
    // 3d review L11 (people9): the notice, read again, says that this appeal is still open, as its paragraph then reads.
    const releaseId = (await releasesOf(migrateDb, atOnce.sealActionId))[0]!.id;
    expect((await authorRelease(world.moderation.deps, atOnce.authorId, releaseId)).appeal).toBe("pending");
  });

  test("a release on a leave not to be told is born held: no mail, no list, no read; the dispatch round after the hold ends sends it once", async () => {
    const before = accountMails.length;
    // Review ruling H2: what the post shows under the seal, to its author and to another reader, and that its image rows
    // cannot be deleted; a held release keeps all three until the round that tells its notice.
    const sealedForAuthor = held.mediaIds.map((id) => ({ id, hidden: true, sealed: true }));
    const sealedForOthers = held.mediaIds.map((id) => ({ id, hidden: true }));
    const underTheSeal = async () => {
      expect(await mediaOf(held.authorId, held)).toEqual(sealedForAuthor);
      expect(await mediaOf(atOnce.authorId, held)).toEqual(sealedForOthers);
      expect(await postFrozen(apiDb, held.postId)).toBe(true);
      expect(await deletable(held)).toBe(0);
    };
    await underTheSeal();
    const outcome = await release(admin, held);
    const releaseId = (outcome as { releaseId: string }).releaseId;
    expect((await releasesOf(migrateDb, held.sealActionId))[0]).toMatchObject({ id: releaseId, author_notice: "held" });
    expect(accountMails.length).toBe(before);
    expect((await authorNotices(world.moderation.deps, held.authorId)).notices).toEqual([]);
    await expect(authorRelease(world.moderation.deps, held.authorId, releaseId)).rejects.toMatchObject({ code: "not_found" });
    const due = new Date(Date.now() + 60_000);
    expect(await releaseNotices(dispatchDeps(), new Date(), due, () => undefined)).toBe(0);
    expect((await releasesOf(migrateDb, held.sealActionId))[0]!.author_notice).toBe("held");
    await underTheSeal();
    // The operator ends the hold on telling with the command; the next round moves the notice and sends it, once.
    const leaveId = (await blockOf(admin, held)).release!.leave!.id;
    const ended = await cli(["release-leave", "--end-untold", leaveId, "--until", new Date(Date.now() - 60_000).toISOString()]);
    expect(ended.text).toMatch(new RegExp(`^out release-leave: leave ${leaveId}: the person may be told from [0-9T:.Z-]+[.]$`));
    // Until that round the post still reads as it did under the seal.
    await underTheSeal();
    expect(await releaseNotices(dispatchDeps(), new Date(), due, () => undefined)).toBe(1);
    expect((await releasesOf(migrateDb, held.sealActionId))[0]!.author_notice).toBe("sent");
    // From the round that told it, the release shows everywhere at once: the images are gone and the post is not frozen.
    expect(await mediaOf(held.authorId, held)).toEqual([]);
    expect(await mediaOf(atOnce.authorId, held)).toEqual([]);
    expect(await postFrozen(apiDb, held.postId)).toBe(false);
    expect(accountMails.slice(before)).toEqual([{ userId: held.authorId, template: "release_notice" }]);
    expect(await releaseNotices(dispatchDeps(), new Date(), due, () => undefined)).toBe(0);
    expect((await authorNotices(world.moderation.deps, held.authorId)).notices.map((notice) => notice.id)).toEqual([releaseId]);
  });

  test("review L1: seal_released's alert is written in the release's own transaction: with nothing run after the commit, its row stands", async () => {
    const quiet = await sealed();
    await reportForTest(migrateDb, quiet.sealActionId, { answer: "illegal" });
    await moveForTest(migrateDb, quiet.mediaIds);
    const recorded = await cli(["release-leave", quiet.sealActionId, "--by", "court", "--reference", "5 Q 5/26", "--day", "2026-10-02", "--operator", "op"]);
    const leaveId = /leave ([0-9a-f-]{36}) recorded/.exec(recorded.text)![1]!;
    const rows = async () => (await migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from public.alert_outbox where kind = 'seal_released' and created_at >= ${startedAt}::timestamptz`))[0]!.n;
    const before = await rows();
    const params = { postIds: [quiet.postId], basis: "leave" as const, leaveId, theirReference: "5 Q 5/26" };
    const confirmed = await world.confirmAction(admin, { action: "seal_released", target: { type: "seal", id: quiet.sealActionId }, params });
    // The process stops right after the commit: no task started after it ever runs.
    const halted = { ...world.moderation.deps, auth, background: { start: () => undefined, settle: async () => undefined } };
    const outcome = await releaseSeal(halted, admin.session, confirmed, { requestId: `req-${randomUUID()}` });
    expect(outcome).toMatchObject({ caseId: quiet.caseId });
    expect(await rows()).toBe(before + 1);
    await removeReleases(migrateDb, [quiet.postId], [quiet.sealActionId], quiet.mediaIds);
  });

  test("release-show prints the record; a destroy line's record takes the release's id, and release-show counts it", async () => {
    const [row] = await releasesOf(migrateDb, atOnce.sealActionId);
    const listed = await cli(["quarantine-list"]);
    for (const mediaId of atOnce.mediaIds) for (const size of MEDIA_SIZES) expect(listed.lines).toContain(`out destroy ${mediaId} ${storedImageName(mediaId, size)}`);
    const receipt = atOnce.mediaIds.flatMap((mediaId) => MEDIA_SIZES.map((size) => `destroy ${mediaId} ${storedImageName(mediaId, size)} 1234 ${"b".repeat(64)} quarantine`)).join(LF);
    const recorded = await cli(["quarantine-record"], receipt);
    expect(recorded.lines[0]).toMatch(/^out quarantine-record: 0 files recorded as moved, 0 as returned, 4 as destroyed, 0 as lost, 0 found without a record[.]/);
    const withIds = await migrateDb.execute<{ release_id: string }>(sql`select release_id from public.quarantine_files where media_id = any(${`{${atOnce.mediaIds.join(",")}}`}::uuid[])`);
    expect(withIds.map((r) => r.release_id)).toEqual([row!.id, row!.id, row!.id, row!.id]);
    const shown = await cli(["release-show", row!.id]);
    expect(shown.code).toBe(0);
    expect(shown.lines[0]).toMatch(new RegExp(`^out release-show: release ${row!.id}: ground leave, leave or instruction from court, reference 4 O 1/26, of 2026-10-01, released [0-9T:.Z-]+[.]$`));
    expect(shown.lines[1]).toBe("out release-show: posts 1; image rows erased 2; files destroyed 4 of 4, lost 0.");
    expect(shown.lines.filter((line) => /^out release-show: files[/][0-9a-f]{2}[/]/.test(line))).toHaveLength(4);
    expect(shown.lines.at(-2)).toMatch(/^out release-show: no backup that is deleted on time holds these files after [0-9T:.Z-]+; a backup kept for an authority is destroyed by hand[.]$/);
    expect(shown.lines.at(-1)).toMatch(/^out release-show: author's notice: sent [0-9T:.Z-]+[.]$/);
    // It prints no answer of an authority: the record copies none.
    expect(shown.text).not.toMatch(/illegal|assess/);
    expect((await cli(["release-show", randomUUID()])).text).toMatch(/^err release-show: no release has the id [0-9a-f-]{36}; nothing changed$/);
  });

  test("this file left nothing behind but its audit rows", async () => {
    await migrateDb.execute(sql`delete from public.alert_outbox where created_at >= ${startedAt}::timestamptz`);
    await removeReleases(migrateDb, posts, [atOnce.sealActionId, held.sealActionId], [...atOnce.mediaIds, ...held.mediaIds]);
    expect(await releaseCounts(migrateDb)).toEqual(releasesBefore);
  });
});
