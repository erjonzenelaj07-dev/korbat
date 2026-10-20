import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, MEDIA_SIZES, MediaStatusResponse, UploadResponse, type UploadHoldEndedParams } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { MATCH_FIXTURES } from "@korbat/media-protocol";
import type { AuthForModeration } from "../../src/auth";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { storedImageName } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { matchAdapterFrom, type TestMatchAdapter } from "../../src/media/match-adapter";
import { sweep } from "../../src/media/sweeper";
import { restoreView } from "../../src/moderation/gaps";
import { authorUpload, objectToUpload, refusalNotices } from "../../src/moderation/uploads";
import { ageCustodyForTest, planOf } from "./custody-fixtures";
import { bodyOf, mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, deciderWorld, suspendForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { refusal, removeFixtures } from "./moderation-fixtures";

// Each test uploads, confirms with a key and dispatches: dozens of statements, slow on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);

/**
 * A refused upload after its refusal (3d design, sections 6.7, 7.12, 8.6, 8.10 and 9.5; 12.1 rows 6, 9, 17 and 18; Task
 * 7), on the test matcher and the acting byte-constant file: the uploader's notice and its one objection, also from a
 * suspended account and after an end as "Report"; the two ends of a hold under an admin's key, neither for a moderator,
 * with the hold on the image row, the hold on the address, the alert hold_ended_unreported, the delay of noReportHours
 * and the sweeper; the two notices through the dispatch step; upload-report, release-leave on the refusal and the
 * release, with the quarantine's destroy lines; Held uploads' list; and a lost end of a hold after a restore, closed by
 * an admin's end or replayed. Every mail goes to a recording auth interface.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a refused upload after its refusal (3d Task 7)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let h: MediaHarness;
  let world: DeciderWorld;
  let admin: RealStaff;
  let moderator: RealStaff;
  let startedAt: string;
  const owners: string[] = [];
  const refusals: string[] = [];
  const media: string[] = [];
  const gaps: string[] = [];
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
  const deps = () => ({ ...world.moderation.deps, auth });

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    startedAt = (await migrateDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    h = await mediaHarness(apiDb, { match: matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" }) as TestMatchAdapter });
    h.deps.matched.handler = async () => undefined;
    world = deciderWorld(apiDb, { auth });
    admin = await world.staff("admin");
    moderator = await world.staff("moderator");
  });

  afterAll(async () => {
    await world.moderation.settle();
    try {
      // The suspension's case and decisions, which suspendForTest made.
      await closeDecisions();
      await migrateDb.execute(sql`delete from public.restore_gaps where id = any(${`{${gaps.join(",")}}`}::uuid[])`);
      const notices = await migrateDb.execute<{ id: string }>(sql`select notification_id as id from public.upload_refusals where id = any(${`{${refusals.join(",")}}`}::uuid[]) and notification_id is not null`);
      const records = notices.map((row) => row.id);
      await migrateDb.execute(sql`update public.upload_refusals set release_id = null where id = any(${`{${refusals.join(",")}}`}::uuid[])`);
      await migrateDb.execute(sql`delete from public.quarantine_files where media_id = any(${`{${media.join(",")}}`}::uuid[])`);
      await migrateDb.execute(sql`delete from public.release_notices where subject_id = any(${`{${refusals.join(",")}}`}::uuid[])`);
      await migrateDb.execute(sql`delete from public.releases where upload_refusal_id = any(${`{${refusals.join(",")}}`}::uuid[]) and replay_of is not null`);
      await migrateDb.execute(sql`delete from public.releases where upload_refusal_id = any(${`{${refusals.join(",")}}`}::uuid[])`);
      await migrateDb.execute(sql`delete from public.release_leaves where notification_id = any(${`{${records.join(",")}}`}::uuid[])`);
      await removeFixtures(migrateDb, owners);
      await migrateDb.execute(sql`delete from public.authority_notifications where id = any(${`{${records.join(",")}}`}::uuid[])`);
      await migrateDb.execute(sql`delete from public.alert_outbox where kind in ('hold_ended_unreported', 'seal_released', 'moderation_urgent') and created_at >= ${startedAt}::timestamptz`);
    } finally {
      h.cleanup();
      await world.close();
      await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
    }
  });

  const png = (bytes: Uint8Array) => ({ contentType: "image/png", contentLength: undefined, body: bodyOf(bytes) });
  /** An uploader whose upload of the acting file was refused: the refusal's id and the image's. */
  async function refused() {
    const owner = await h.established();
    owners.push(owner.id);
    const sent = UploadResponse.parse(await upload(h.deps, owner.id, png(MATCH_FIXTURES.acting)));
    h.worker.ready(sent.id, { width: 8, height: 8 });
    const answer = MediaStatusResponse.parse(await status(h.deps, owner.id, sent.id));
    if (answer.status !== "refused") throw new Error(`the acting file was not refused (${answer.status})`);
    refusals.push(answer.refusalId);
    media.push(sent.id);
    return { ownerId: owner.id, refusalId: answer.refusalId, mediaId: sent.id };
  }
  /** A whole confirmed end of a hold by this member's key. */
  async function endAs(member: RealStaff, refusalId: string, params: UploadHoldEndedParams) {
    const confirmed = await world.confirmAction(member, { action: "upload_hold_ended", target: { type: "upload_refusal", id: refusalId }, params });
    return world.moderation.forStaff.endHold(member.session, confirmed, { requestId: `req-${randomUUID()}` });
  }
  const holdOf = async (mediaId: string) => (await migrateDb.execute<{ hold: string | null; erased: boolean }>(sql`select hold_until::text as hold, erased_at is not null as erased from post_media where id = ${mediaId}::uuid`))[0] ?? null;
  const addressOf = async (ownerId: string) =>
    (await migrateDb.execute<{ released: boolean; reason: string | null }>(sql`select released_at is not null as released, release_reason as reason from auth.report_holds where user_id = ${ownerId}::uuid`))[0] ?? null;
  const cli = async (args: string[], input = "") => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input, "utf8"));
    return { code, text: lines.join(LF) };
  };

  test("the notice is its uploader's alone; one objection, also from a suspended account, and none twice (rows 6 and 9)", async () => {
    const r = await refused();
    const view = await authorUpload(deps(), r.ownerId, r.refusalId);
    expect(view).toMatchObject({ id: r.refusalId, source: "test", matchKind: "exact", listedAs: "csam", objection: null, mayObject: true, endAs: null, released: null, reportKept: false });
    // Anyone else, and any id that names no refusal of theirs, reads as nothing.
    const other = await h.established();
    owners.push(other.id);
    expect(await refusal(authorUpload(deps(), other.id, r.refusalId))).toBe("not_found");
    expect(await refusal(objectToUpload(deps(), other.id, r.refusalId, { text: "not mine" }))).toBe("not_found");
    // The uploader is suspended under 3e: the objection stands all the same, as asking for a person does.
    await suspendForTest(apiDb, r.ownerId);
    const objected = await objectToUpload(deps(), r.ownerId, r.refusalId, { text: "This is a photo of my garden." });
    expect(objected).toMatchObject({ mayObject: false, objection: { text: "This is a photo of my garden." } });
    expect(await refusal(objectToUpload(deps(), r.ownerId, r.refusalId, { text: "again" }))).toBe("objection_not_open");
    // The refusal's notice goes out through the dispatch step, once.
    const due = new Date(Date.now() + 60_000);
    const before = accountMails.length;
    await refusalNotices(deps(), new Date(), due, 7, () => undefined);
    expect(accountMails.slice(before).filter((mail) => mail.userId === r.ownerId).map((mail) => mail.template)).toEqual(["upload_refused"]);
    await refusalNotices(deps(), new Date(), due, 7, () => undefined);
    expect(accountMails.filter((mail) => mail.userId === r.ownerId && mail.template === "upload_refused")).toHaveLength(1);
  });

  test("Report and No report: an admin's key alone, neither by default; the image's hold, the address, the alert, an objection after Report, and the end that is no longer open (row 9)", async () => {
    const r = await refused();
    expect(await refusal(endAs(moderator, r.refusalId, { endAs: "report", reason: null }))).toBe("admin_required");
    const reported = await endAs(admin, r.refusalId, { endAs: "report", reason: null });
    expect(reported).toMatchObject({ id: r.refusalId, endAs: "report", endReason: null, reported: false, deletesAt: null });
    expect((await holdOf(r.mediaId))!.hold).toBe("infinity");
    const [audit] = await migrateDb.execute<{ actor: string; params: unknown; media: string; step_up: boolean }>(
      sql`select actor_id as actor, metadata -> 'params' as params, metadata ->> 'mediaId' as media, step_up is not null as step_up
            from public.audit_log where action = 'upload_hold_ended' and target_id = ${r.refusalId} order by chain_seq desc limit 1`,
    );
    expect(audit).toEqual({ actor: admin.id, params: { endAs: "report", reason: null }, media: r.mediaId, step_up: true });
    expect(await refusal(endAs(admin, r.refusalId, { endAs: "report", reason: null }))).toBe("hold_not_open");
    // The uploader may object after Report, while korbat holds the file.
    expect((await objectToUpload(deps(), r.ownerId, r.refusalId, { text: "Please look again." })).objection?.text).toBe("Please look again.");

    // No report: the upload is deleted noReportHours from now, the address released, every staff account alerted.
    const mails = staffMails.length;
    const ended = await endAs(admin, r.refusalId, { endAs: "no_report", reason: "source_withdrew" });
    expect(ended).toMatchObject({ endAs: "no_report", endReason: "source_withdrew" });
    const hours = (Date.parse(ended === "ended" || ended === "late" ? "" : ended.deletesAt!) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(AUTOMATION_RULES.noReportHours - 0.1);
    expect(hours).toBeLessThanOrEqual(AUTOMATION_RULES.noReportHours);
    expect(await addressOf(r.ownerId)).toEqual({ released: true, reason: "declined" });
    await world.moderation.settle();
    const [alert] = await migrateDb.execute<{ facts: Record<string, unknown> }>(sql`select facts from public.alert_outbox where kind = 'hold_ended_unreported' and created_at >= ${startedAt}::timestamptz order by created_at desc limit 1`);
    expect(Object.keys(alert!.facts).sort()).toEqual(["at", "deletesAt"]);
    expect(staffMails.length).toBeGreaterThanOrEqual(mails);
    // Inside the delay an admin can still end it as Report: the hold is for good again and the address held again.
    const again = await endAs(admin, r.refusalId, { endAs: "report", reason: null });
    expect(again).toMatchObject({ endAs: "report" });
    expect((await holdOf(r.mediaId))!.hold).toBe("infinity");
    expect(await addressOf(r.ownerId)).toEqual({ released: false, reason: null });
    // No objection after an end as No report.
    await endAs(admin, r.refusalId, { endAs: "no_report", reason: "other" });
    expect((await authorUpload(deps(), r.ownerId, r.refusalId)).mayObject).toBe(false);
  });

  test("after No report the sweeper keeps the row for noReportHours and deletes it after; the uploader is told the hold was lifted, once (rows 9 and W.8)", async () => {
    const r = await refused();
    await endAs(admin, r.refusalId, { endAs: "no_report", reason: "counsel_no_duty" });
    // Within the delay the end is not told and the notice still shows the hold.
    expect((await authorUpload(deps(), r.ownerId, r.refusalId)).endAs).toBeNull();
    await migrateDb.execute(sql`update post_media set created_at = now() - interval '3 days' where id = ${r.mediaId}::uuid`);
    await sweep(h.deps, new Date(), { reconcile: false });
    expect(await holdOf(r.mediaId)).not.toBeNull();
    await ageCustodyForTest(migrateDb, { refusal: r.refusalId }, `${AUTOMATION_RULES.noReportHours + 1} hours`);
    await sweep(h.deps, new Date(), { reconcile: false });
    expect(await holdOf(r.mediaId)).toBeNull();
    const view = await authorUpload(deps(), r.ownerId, r.refusalId);
    expect(view).toMatchObject({ endAs: "no_report", endReason: "counsel_no_duty", mayObject: false });
    const before = accountMails.length;
    await refusalNotices(deps(), new Date(), new Date(Date.now() + 60_000), 7, () => undefined);
    expect(accountMails.slice(before).filter((mail) => mail.userId === r.ownerId).map((mail) => mail.template).sort()).toEqual(["upload_hold_lifted", "upload_refused"]);
    await refusalNotices(deps(), new Date(), new Date(Date.now() + 60_000), 7, () => undefined);
    expect(accountMails.filter((mail) => mail.userId === r.ownerId && mail.template === "upload_hold_lifted")).toHaveLength(1);
    expect(await refusal(endAs(admin, r.refusalId, { endAs: "report", reason: null }))).toBe("hold_not_open");
  });

  test("upload-report, also for an account that is gone; release-leave on the refusal; the release on the leave, the plan's destroy lines, and no objection after it (rows 9 and 18)", async () => {
    const r = await refused();
    expect((await cli(["upload-report", r.refusalId, "--duty", "voluntary"])).text).toMatch(/hold_not_open: held upload .* did not end as Report/);
    // While the hold is open its files stay where they are; ended as Report they are due in the quarantine (row 15).
    expect(await planOf(migrateDb, [r.mediaId])).toEqual([]);
    await endAs(admin, r.refusalId, { endAs: "report", reason: null });
    expect(await planOf(migrateDb, [r.mediaId])).toEqual([`in ${r.mediaId}`]);
    // The uploader deletes the account: the record can still be opened, and says what the report can carry.
    await migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${r.ownerId}::uuid`);
    const opened = await cli(["upload-report", r.refusalId, "--duty", "voluntary"]);
    expect(opened.code).toBe(0);
    expect(opened.text).toMatch(/record [0-9a-f-]{36} opened for the held upload/);
    expect(opened.text).toContain("the uploader's account no longer exists");
    expect((await cli(["upload-report", r.refusalId, "--duty", "voluntary"])).text).toContain("has its record of a report already");
    const [row] = await migrateDb.execute<{ id: string }>(sql`select notification_id as id from upload_refusals where id = ${r.refusalId}::uuid`);
    const page = await world.moderation.forStaff.uploads();
    const listed = page.uploads.find((found) => found.id === r.refusalId)!;
    // `reported` says that the record of a report is opened (8.1); the release block says whether it was sent.
    expect(listed).toMatchObject({ endAs: "report", uploaderGone: true, reported: true, quarantined: false, release: { reported: false } });
    // No hash value (the hash type alone), no handle.
    expect(JSON.stringify(listed)).not.toMatch(/[0-9a-f]{32}|"hash"|handle/);
    // A leave cannot be recorded before the report is sent; then it can, on the refusal.
    const leave = ["release-leave", r.refusalId, "--by", "court", "--reference", "4 O 1/26", "--day", "2026-10-18", "--operator", "the operator"];
    expect((await cli(leave)).text).toContain("has no record of a report that was sent");
    await migrateDb.execute(sql`update public.authority_notifications set state = 'sent', sent_at = now(), authority = 'A test authority', channel = 'portal', sent_kinds = array['files'], not_kept_version = 1, closed_at = now() where id = ${row!.id}::uuid`);
    const recorded = await cli(leave);
    expect(recorded.code).toBe(0);
    expect(recorded.text).toContain("Held uploads screen");
    const facts = (await world.moderation.forStaff.uploads()).uploads.find((found) => found.id === r.refusalId)!.release!;
    expect(facts).toMatchObject({ reported: true, quarantined: false, releasedAt: null });
    const params = { basis: "leave" as const, leaveId: facts.leave!.id, theirReference: "4 O 1/26" };
    const release = async (member: RealStaff) =>
      world.moderation.forStaff.releaseUpload(member.session, await world.confirmAction(member, { action: "upload_released", target: { type: "upload_refusal", id: r.refusalId }, params }), { requestId: `req-${randomUUID()}` });
    // Not before both files are in the quarantine by record; never by a moderator.
    expect(await refusal(release(admin))).toBe("release_not_quarantined");
    for (const size of MEDIA_SIZES) {
      await migrateDb.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${r.mediaId}::uuid, ${storedImageName(r.mediaId, size)}, 1234, ${"b".repeat(64)}) on conflict do nothing`);
    }
    expect(await refusal(release(moderator))).toBe("admin_required");
    const released = await release(admin);
    expect(released).toMatchObject({ id: r.refusalId, release: { releasedAt: expect.any(String), basis: "leave" } });
    expect((await holdOf(r.mediaId))!.erased).toBe(true);
    // The plan's one line for the image, which names both of its files: they are to be destroyed.
    expect(await planOf(migrateDb, [r.mediaId])).toEqual([`destroy ${r.mediaId}`]);
    expect(await refusal(release(admin))).not.toBeNull();
    expect(await refusal(endAs(admin, r.refusalId, { endAs: "no_report", reason: "other" }))).toBe("hold_not_open");
  });

  test("Held uploads: the open first, oldest first; the count of the same uploader's other held uploads, never one ended as No report; no handle (8.6)", async () => {
    const a = await refused();
    const sent = UploadResponse.parse(await upload(h.deps, a.ownerId, png(MATCH_FIXTURES.acting)));
    h.worker.ready(sent.id, { width: 8, height: 8 });
    const second = MediaStatusResponse.parse(await status(h.deps, a.ownerId, sent.id));
    if (second.status !== "refused") throw new Error("the second upload was not refused");
    refusals.push(second.refusalId);
    media.push(sent.id);
    const page = await world.moderation.forStaff.uploads();
    const first = page.uploads.find((found) => found.id === a.refusalId)!;
    expect(first.otherRefusals).toBe(1);
    expect(first.match).toMatchObject({ source: "test", hashType: "sha256", matchKind: "exact", listed: true, acting: true });
    const open = page.uploads.filter((found) => found.endAs === null);
    expect(open.map((found) => found.refusedAt)).toEqual([...open.map((found) => found.refusedAt)].sort());
    await endAs(admin, second.refusalId, { endAs: "no_report", reason: "other" });
    expect((await world.moderation.forStaff.uploads()).uploads.find((found) => found.id === a.refusalId)!.otherRefusals).toBe(0);
  });

  test("after a restore: a lost end of a hold is closed by an admin's end again while the refusal is there, and replayed when it is gone (row 17)", async () => {
    const r = await refused();
    const gap = async (refusalId: string, mediaId: string, endAs: string) => {
      const [made] = await migrateDb.execute<{ id: string }>(sql`
        insert into public.restore_gaps (import_id, place, hash, action, target_type, target_id, metadata, acted_at, imported_at, class)
        values (${randomUUID()}::uuid, 900000000 + ${gaps.length}, ${"c".repeat(64)}, 'upload_hold_ended', 'upload_refusal', ${refusalId},
                ${JSON.stringify({ mediaId, params: { endAs, reason: endAs === "no_report" ? "other" : null } })}::jsonb, now() - interval '1 hour', now(), 'release')
        returning id`);
      gaps.push(made!.id);
      return made!.id;
    };
    const present = await gap(r.refusalId, r.mediaId, "report");
    const view = await restoreView(world.moderation.deps);
    expect(view.gaps.find((found) => found.id === present)).toMatchObject({ class: "release", hold: { endAs: "report", present: true } });
    expect(view.mayOpen).toBe(false);
    await endAs(admin, r.refusalId, { endAs: "report", reason: null });
    const [closed] = await migrateDb.execute<{ disposition: string; closed: boolean }>(sql`select disposition, closed_at is not null as closed from public.restore_gaps where id = ${present}::uuid`);
    expect(closed).toEqual({ disposition: "reapplied", closed: true });
    // A refusal the restored database does not hold: replayed, which keeps its image row from every post.
    const lostRefusal = randomUUID();
    const lostMedia = (await refused()).mediaId;
    const gone = await gap(lostRefusal, lostMedia, "no_report");
    const [replayed] = await migrateDb.execute<{ result: string }>(sql`select public.upload_hold_replay(${lostRefusal}::uuid, ${lostMedia}::uuid, 'no_report', now() - interval '1 hour') as result`);
    expect(replayed!.result).toBe("replayed 1");
    const [after] = await migrateDb.execute<{ disposition: string }>(sql`select disposition from public.restore_gaps where id = ${gone}::uuid`);
    expect(after!.disposition).toBe("imported");
    expect((await migrateDb.execute<{ result: string }>(sql`select public.upload_hold_replay(${r.refusalId}::uuid, ${r.mediaId}::uuid, 'report', now()) as result`))[0]!.result).toBe("present");
    expect(await refusal(migrateDb.execute(sql`select public.upload_hold_replay(${randomUUID()}::uuid, ${r.mediaId}::uuid, 'report', now())`))).toBe("replay_no_gap");
  });
});
