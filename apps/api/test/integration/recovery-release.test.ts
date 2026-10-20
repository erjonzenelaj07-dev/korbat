import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEDIA_SIZES } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AuthForModeration } from "../../src/auth";
import { restoreImport } from "../../src/cli/restore";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { storedImageName } from "../../src/media";
import { restoreView } from "../../src/moderation/gaps";
import { releaseNotices } from "../../src/moderation/release";
import { exportLines } from "../../src/staff";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, imagePost, postFrozen, report, restoreForTest, snapshotForTest } from "./moderation-fixtures";
import { SEAL_FOR_GOOD, sealActionOf } from "./records-fixtures";
import { moveForTest, reportForTest } from "./release-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);

/** A sealed post of this file. */
interface Sealed {
  authorId: string;
  postId: string;
  mediaIds: string[];
  caseId: string;
  sealActionId: string;
}

/**
 * A restore cannot bring a released image back into keeping, and loses none of the release's acts in silence (3d design,
 * sections 6.2, 7.3 and 8.7; 12.1 row 17; LAB D2 to D4 on the built code). Before the backup: two seals for good,
 * reported and moved; a leave for the first, and a leave for the second that is later withdrawn. Then, lost with the
 * restore: the release of the first; a new leave for the second and its release; the withdrawal; and a leave recorded
 * and withdrawn within the lost work. After restoreForTest and restore-import: one gap of the class release for each
 * release, for the lost leave and for the lost withdrawal, none for the leave recorded and withdrawn after the backup;
 * the app's site stays closed. release-replay marks the posts and erases their rows, a seal still standing freezes
 * nothing (D4), and a second run finds them present; the replay of the release whose leave is lost is born held and is
 * told in the dispatch round after release-leave --gap records the leave again under its id; release-leave --withdraw
 * --gap closes the last gap; the list prints the released files to destroy. The file restores the database it found.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a restore and the replay of releases (3d Task 2)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let world: DeciderWorld;
  let admin: RealStaff;
  let found: string;
  let appOrigin: string;
  let head: { seq: number; hash: string };
  let backup: string;
  let tail: string[] = [];
  let first: Sealed;
  let second: Sealed;
  let firstRelease: string;
  let secondRelease: string;
  let lostLeave: string;
  let withdrawnLeave: string;
  const mails: string[] = [];
  const auth = new Proxy({} as AuthForModeration, {
    get: (_target, member) => {
      if (typeof member !== "string" || member === "then") return undefined;
      if (member === "mailAccount") return async (_userId: string, message: { template: string }) => (mails.push(message.template), "sent");
      if (member === "mailStaff") return async () => 1;
      if (member === "overdueContacts") return async () => 0;
      return async () => undefined;
    },
  });

  const readHead = async () => {
    const [row] = await migrateDb.execute<{ seq: string; hash: string }>(sql`select seq::text as seq, hash from public.audit_head where id = 1`);
    return { seq: Number(row!.seq), hash: row!.hash };
  };
  const cli = async (args: string[], input = "") => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input, "utf8"));
    return { code, lines, text: lines.join(LF) };
  };
  const leaveOf = (text: string) => /leave ([0-9a-f-]{36}) recorded/.exec(text)![1]!;
  async function sealed(): Promise<Sealed> {
    const p = await imagePost(apiDb, 2);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, SEAL_FOR_GOOD);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    return { ...p, caseId, sealActionId: await sealActionOf(migrateDb, outcome.decisionId) };
  }
  async function release(seal: Sealed, leaveId: string, reference: string): Promise<string> {
    const params = { postIds: [seal.postId], basis: "leave" as const, leaveId, theirReference: reference };
    const confirmed = await world.confirmAction(admin, { action: "seal_released", target: { type: "seal", id: seal.sealActionId }, params });
    const outcome = await world.moderation.forStaff.release(admin.session, confirmed, { requestId: `req-${randomUUID()}` });
    await world.moderation.settle();
    if (typeof outcome === "string") throw new Error(`the release was not recorded (${outcome})`);
    return outcome.releaseId;
  }
  const releases = async (postId: string) =>
    migrateDb.execute<{ id: string; replay_of: string | null; author_notice: string; leave_id: string | null }>(
      sql`select id, replay_of, author_notice, leave_id from public.releases where ${postId}::uuid = any(post_ids) order by released_at, id`,
    );
  const erased = async (postId: string) => (await migrateDb.execute<{ erased: boolean }>(sql`select erased_at is not null as erased from public.post_media where post_id = ${postId}::uuid`)).map((row) => row.erased);
  const openGaps = async () =>
    (await migrateDb.execute<{ id: string; action: string; leave: string | null; release: string | null }>(
      sql`select id, action, metadata ->> 'leaveId' as leave, metadata ->> 'releaseId' as release from public.restore_gaps where class = 'release' and closed_at is null order by place`,
    )).map((row) => ({ ...row }));

  beforeAll(async () => {
    const config = loadConfig();
    appOrigin = config.APP_ORIGIN;
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    found = await snapshotForTest(migrateDb);
    world = deciderWorld(apiDb, { auth });
    admin = await world.staff("admin");
    // Before the backup.
    first = await sealed();
    second = await sealed();
    for (const seal of [first, second]) {
      await reportForTest(migrateDb, seal.sealActionId, { answer: "illegal" });
      await moveForTest(migrateDb, seal.mediaIds);
    }
    const firstLeave = leaveOf((await cli(["release-leave", first.sealActionId, "--by", "court", "--reference", "1 A 1/26", "--day", "2026-10-01", "--operator", "op"])).text);
    withdrawnLeave = leaveOf((await cli(["release-leave", second.sealActionId, "--by", "authority", "--reference", "WRONG 2", "--day", "2026-10-01", "--operator", "op"])).text);
    await migrateDb.execute(sql`insert into public.audit_log (actor_id, action, metadata) select '00000000-0000-0000-0000-000000000000'::uuid, 'filler', jsonb_build_object('n', n) from generate_series(1, 5) n`);
    head = await readHead();
    backup = await snapshotForTest(migrateDb);
    // The lost work.
    firstRelease = await release(first, firstLeave, "1 A 1/26");
    expect((await cli(["release-leave", "--withdraw", withdrawnLeave, "--operator", "op"])).code).toBe(0);
    lostLeave = leaveOf((await cli(["release-leave", second.sealActionId, "--by", "court", "--reference", "2 B 2/26", "--day", "2026-10-03", "--operator", "op"])).text);
    secondRelease = await release(second, lostLeave, "2 B 2/26");
    const passing = leaveOf((await cli(["release-leave", second.sealActionId, "--by", "court", "--reference", "PASSING", "--day", "2026-10-03", "--operator", "op"])).text);
    expect((await cli(["release-leave", "--withdraw", passing, "--operator", "op"])).code).toBe(0);
    const through = (await readHead()).seq;
    for await (const line of exportLines(apiDb, head.seq - 3, through)) tail.push(JSON.stringify(line));
  }, 300_000);

  afterAll(async () => {
    await restoreForTest(migrateDb, found);
    await world.close({ keepStaff: true });
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  test("restore-import: a gap of the class release for each release, the lost leave and the lost withdrawal; none for a leave recorded and withdrawn after the backup; the site stays closed", async () => {
    await restoreForTest(migrateDb, backup);
    expect(await readHead()).toEqual(head);
    expect(await releases(first.postId)).toEqual([]);
    const done = await restoreImport(migrateDb, [], Buffer.from(tail.map((line) => line + LF).join(""), "utf8"), appOrigin);
    expect(done.ok).toBe(true);
    const gaps = await openGaps();
    expect(gaps.map((gap) => [gap.action, gap.release ?? gap.leave])).toEqual([
      ["seal_released", firstRelease],
      ["release_leave_withdrawn", withdrawnLeave],
      ["release_leave_recorded", lostLeave],
      ["seal_released", secondRelease],
    ]);
    const view = await restoreView({ apiDb });
    expect(view.mayOpen).toBe(false);
    expect(view.retentionMay).toBe(true);
    // Before the replay the restored database counts the images as sealed and kept.
    expect(await erased(first.postId)).toEqual([false, false]);
    expect(await postFrozen(apiDb, first.postId)).toBe(true);
  });

  test("release-replay: the posts marked, the rows erased, the gaps closed; a seal that stands freezes nothing; a second run finds them present; a line no gap names is refused", async () => {
    const replayed = await cli(["release-replay"], tail.join(LF));
    expect(replayed.lines[0]).toBe("out release-replay: 2 releases and 0 ends of a hold in the copy; 0 already present.");
    expect(replayed.lines).toContain(`out release-replay: release ${firstRelease} of ${(JSON.parse(tail.find((line) => line.includes(firstRelease) && line.includes("seal_released"))!) as { at: string }).at}: 1 posts marked released, 2 image rows erased.`);
    expect(replayed.lines.at(-1)).toMatch(/^out release-replay: run the Quarantine steps now, with an inventory first/);
    expect(await erased(first.postId)).toEqual([true, true]);
    expect(await postFrozen(apiDb, first.postId)).toBe(false);
    const [replay] = await releases(first.postId);
    expect(replay).toMatchObject({ replay_of: firstRelease, author_notice: "none" });
    // The second release rests on a leave the restore lost: its replay is held until the leave is recorded again.
    const [heldReplay] = await releases(second.postId);
    expect(heldReplay).toMatchObject({ replay_of: secondRelease, author_notice: "held", leave_id: lostLeave });
    expect((await openGaps()).map((gap) => gap.action)).toEqual(["release_leave_withdrawn", "release_leave_recorded"]);
    const again = await cli(["release-replay"], tail.join(LF));
    expect(again.lines[0]).toBe("out release-replay: 2 releases and 0 ends of a hold in the copy; 2 already present.");
    expect(again.code).toBe(0);
    const [audit] = await migrateDb.execute<{ target_type: string; metadata: Record<string, unknown> }>(sql`select target_type, metadata from public.audit_log where action = 'release_replayed' order by chain_seq desc limit 1`);
    expect(audit).toMatchObject({ target_type: "release", metadata: { replayOf: secondRelease, posts: 1, images: 2, upload: false } });
    // A line that no open gap names is refused, and nothing changes for it.
    const forged = JSON.parse(tail.find((line) => line.includes("seal_released"))!) as { metadata: string };
    forged.metadata = JSON.stringify({ ...(JSON.parse(forged.metadata) as Record<string, unknown>), releaseId: randomUUID() });
    const refused = await cli(["release-replay"], JSON.stringify(forged));
    expect(refused.code).toBe(1);
    expect(refused.text).toMatch(/replay_no_gap/);
  });

  test("release-leave --gap records the lost leave again under its id; the held replay is told in the next dispatch round; --withdraw --gap closes the last gap and the site may open", async () => {
    const gaps = await openGaps();
    const leaveGap = gaps.find((gap) => gap.action === "release_leave_recorded")!;
    const again = await cli(["release-leave", second.sealActionId, "--by", "court", "--reference", "2 B 2/26", "--day", "2026-10-03", "--operator", "op", "--gap", leaveGap.id]);
    expect(again.code).toBe(0);
    expect(again.lines).toEqual([
      `out release-leave: leave ${lostLeave} recorded for seal ${second.sealActionId}, on the record of its report: from court, reference 2 B 2/26, of 2026-10-03; the person may be told. An admin can now release it on the case.`,
      `out release-leave: gap ${leaveGap.id} is closed: the leave is recorded again.`,
    ]);
    const due = new Date(Date.now() + 60_000);
    // The two releases of the lost work mailed their notices at once; the replay of the second is told once more now.
    const sentBefore = mails.length;
    expect(await releaseNotices({ ...world.moderation.deps, auth }, new Date(), due, () => undefined)).toBe(1);
    expect((await releases(second.postId))[0]!.author_notice).toBe("sent");
    expect(mails.slice(sentBefore)).toEqual(["release_notice"]);
    const withdrawGap = (await openGaps()).find((gap) => gap.action === "release_leave_withdrawn")!;
    const withdrawn = await cli(["release-leave", "--withdraw", withdrawnLeave, "--operator", "op", "--gap", withdrawGap.id]);
    expect(withdrawn.code).toBe(0);
    expect(await openGaps()).toEqual([]);
    expect((await restoreView({ apiDb })).mayOpen).toBe(true);
  });

  test("the list after the replay prints the released files under destroy, and the record of a destroy line names the replay", async () => {
    const listed = await cli(["quarantine-list"]);
    for (const seal of [first, second]) for (const mediaId of seal.mediaIds) for (const size of MEDIA_SIZES) expect(listed.lines).toContain(`out destroy ${mediaId} ${storedImageName(mediaId, size)}`);
    const receipt = first.mediaIds.flatMap((mediaId) => MEDIA_SIZES.map((size) => `destroy ${mediaId} ${storedImageName(mediaId, size)} 1234 ${"b".repeat(64)} store`)).join(LF);
    expect((await cli(["quarantine-record"], receipt)).code).toBe(0);
    const [replay] = await releases(first.postId);
    const named = await migrateDb.execute<{ release_id: string }>(sql`select release_id from public.quarantine_files where media_id = any(${`{${first.mediaIds.join(",")}}`}::uuid[])`);
    expect(named.map((row) => row.release_id)).toEqual([replay!.id, replay!.id, replay!.id, replay!.id]);
  });
});
