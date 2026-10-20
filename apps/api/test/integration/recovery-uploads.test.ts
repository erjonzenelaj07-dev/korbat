import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../../src/auth";
import { restoreImport } from "../../src/cli/restore";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { createMatchRepo } from "../../src/media/match-repo";
import { exportLines } from "../../src/staff";
import { matchForTest } from "./automation-fixtures";
import { imagePost, newImageRow, refusal, restoreForTest, rowCounts, snapshotForTest } from "./moderation-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const LF = String.fromCharCode(10);

/**
 * A restore and the held uploads (3d review M5, M7 and M15; 3d design, sections 6.7, 7.3 and 8.10), through staff.js
 * release-replay as the operator runs it after restore-import, on the keeper's files. Before the backup: an upload refused
 * and the line of its hold's end, which the restored database holds. Lost with the restore: a refusal of an upload the
 * backup knew as ready (its line upload_refused, which every refusal now writes), and for a third upload its refusal, its
 * hold's end as Report and its release. The replay passes over the line the restored database holds in silence and exits
 * 0 when nothing is owed (M15); holds again the upload whose refusal the restore lost, so its attach is refused (M7); and
 * takes the third upload's lines in place order, so the release, the last of them, leaves its image row disposable (M5).
 * The lost lines of the third upload's end and release are written as the route writes them (the API's own flows are
 * other files' tests); the refusals are real inserts, whose trigger writes their audit rows. The file restores the
 * database it found.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a restore and the replay of held uploads (3d review)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let found: string;
  let before: Record<string, number>;
  let appOrigin: string;
  let backup: string;
  let ownerId: string;
  let postId: string;
  const tail: string[] = [];
  /** Before the backup: its refusal, and the line of its hold's end, both in the restored database. */
  const kept = { refusalId: "", mediaId: "" };
  /** Lost: the refusal of an upload the backup knew as ready. */
  const lostRefusal = { refusalId: "", mediaId: "" };
  /** Lost: the refusal, the end as Report and the release of a third upload. */
  const released = { refusalId: "", mediaId: "", releaseId: randomUUID(), leaveId: randomUUID() };

  const readHead = async () => Number((await migrateDb.execute<{ seq: string }>(sql`select seq::text as seq from public.audit_head where id = 1`))[0]!.seq);
  const cli = async (args: string[], input = "") => {
    const lines: string[] = [];
    const code = await runStaffCommand(args, { DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) }, async () => Buffer.from(input, "utf8"));
    return { code, lines, text: lines.join(LF) };
  };
  /** An upload on no post, refused on an acting match by the API's role, as finalize refuses one: the refusal's id. */
  async function refuse(mediaId: string): Promise<string> {
    const matchId = await matchForTest(apiDb, mediaId, "acting");
    return createMatchRepo(apiDb).insertRefusal(apiDb, { mediaId, ownerId, matchId });
  }
  /** A line of the chain as the route writes it, as the migrator: the end of a hold, or a held upload's release. */
  const line = (action: string, targetId: string, metadata: Record<string, unknown>) =>
    migrateDb.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata) values (${SYSTEM_ACTOR_ID}::uuid, ${action}, 'upload_refusal', ${targetId}, ${JSON.stringify(metadata)}::jsonb)`);
  const imageOf = async (mediaId: string) =>
    (await migrateDb.execute<{ hold: string | null; erased: boolean; disposable: boolean }>(
      sql`select hold_until::text as hold, erased_at is not null as erased, hold_until <= now() as disposable from public.post_media where id = ${mediaId}::uuid`,
    ))[0];

  beforeAll(async () => {
    const config = loadConfig();
    appOrigin = config.APP_ORIGIN;
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(migrateDb);
    found = await snapshotForTest(migrateDb);
    const p = await imagePost(apiDb, 0);
    ownerId = p.authorId;
    postId = p.postId;
    // Before the backup.
    const from = await readHead();
    kept.mediaId = await newImageRow(apiDb, ownerId, null);
    kept.refusalId = await refuse(kept.mediaId);
    await line("upload_hold_ended", kept.refusalId, { params: { endAs: "report", reason: null }, mediaId: kept.mediaId });
    lostRefusal.mediaId = await newImageRow(apiDb, ownerId, null);
    released.mediaId = await newImageRow(apiDb, ownerId, null);
    backup = await snapshotForTest(migrateDb);
    // The lost work.
    lostRefusal.refusalId = await refuse(lostRefusal.mediaId);
    released.refusalId = await refuse(released.mediaId);
    await line("upload_hold_ended", released.refusalId, { params: { endAs: "report", reason: null }, mediaId: released.mediaId });
    await line("upload_released", released.refusalId, { params: { basis: "leave", leaveId: released.leaveId, theirReference: "4 O 1/26" }, releaseId: released.releaseId, mediaId: released.mediaId });
    for await (const exported of exportLines(apiDb, from, await readHead())) tail.push(JSON.stringify(exported));
  }, 300_000);

  afterAll(async () => {
    await restoreForTest(migrateDb, found);
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  test("review M7: every refusal writes the system's audit row upload_refused on the refusal, naming its image", async () => {
    const written = tail.map((text) => JSON.parse(text) as { action: string; actorId?: string; targetType: string | null; targetId: string | null; metadata: string }).filter((entry) => entry.action === "upload_refused");
    expect(written.map((entry) => [entry.targetType, entry.targetId, (JSON.parse(entry.metadata) as { mediaId: string }).mediaId])).toEqual([
      ["upload_refusal", kept.refusalId, kept.mediaId],
      ["upload_refusal", lostRefusal.refusalId, lostRefusal.mediaId],
      ["upload_refusal", released.refusalId, released.mediaId],
    ]);
  });

  test("review M5, M7 and M15: release-replay passes over the line the restored database holds in silence, holds again the upload whose refusal it lost, and takes a held upload's lines in place order; it exits 0 with nothing owed", async () => {
    await restoreForTest(migrateDb, backup);
    const imported = await restoreImport(migrateDb, [], Buffer.from(tail.map((text) => text + LF).join(""), "utf8"), appOrigin);
    expect(imported.ok).toBe(true);
    // Before the replay the restored database knows both lost uploads as ready, unheld and postable.
    expect(await imageOf(lostRefusal.mediaId)).toMatchObject({ hold: null, erased: false });
    const replayed = await cli(["release-replay"], tail.join(LF));
    // M15: nothing about the upload whose refusal and end the restored database holds; no note; nothing owed.
    expect(replayed.text).not.toContain(kept.refusalId);
    expect(replayed.lines.filter((text) => text.startsWith("err "))).toEqual([]);
    expect(replayed.code).toBe(0);
    // M7: the upload whose refusal the restore lost is held from every post again, with one line.
    expect(replayed.lines.filter((text) => text.includes(lostRefusal.refusalId))).toHaveLength(1);
    expect(await imageOf(lostRefusal.mediaId)).toMatchObject({ hold: "infinity", erased: false });
    expect(await refusal(apiDb.execute(sql`update public.post_media set post_id = ${postId}::uuid, position = 0 where id = ${lostRefusal.mediaId}::uuid`))).toBe("upload_refused");
    // M5: the third upload's refusal, end and release in place order: the release, the last, leaves the row erased and
    // its hold ended, so the disposal takes it and the plan lists its files to destroy.
    expect(await imageOf(released.mediaId)).toEqual({ hold: expect.any(String), erased: true, disposable: true });
    expect((await imageOf(released.mediaId))!.hold).not.toBe("infinity");
    // A second run writes nothing more and owes nothing.
    const again = await cli(["release-replay"], tail.join(LF));
    expect([again.code, again.lines.filter((text) => text.startsWith("err "))]).toEqual([0, []]);
  });

  test("this file left no row behind", async () => {
    await restoreForTest(migrateDb, found);
    found = await snapshotForTest(migrateDb);
    expect(await rowCounts(migrateDb)).toEqual(before);
  });
});
