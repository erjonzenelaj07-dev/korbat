import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MEDIA_SIZES, QUARANTINE_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { AuthForModeration } from "../../src/auth";
import { loadConfig } from "../../src/config";
import { quarantineNames, storedImageName } from "../../src/media";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { lostImageNotices } from "../../src/moderation/dispatch";
import { ageCustodyForTest, planOf, quarantineCount, quarantineRows, removeCustody } from "./custody-fixtures";
import { mediaHarness } from "./media-harness";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { CHANNEL_TABLES, aPost, act, imagePost, moderationDeps, raised, removeDecided, removeFixtures, report, rowCounts } from "./moderation-fixtures";
import { SEAL_FOR_GOOD, SEAL_WHILE_DECIDING, removeRecords, sealActionOf } from "./records-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

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
 * The quarantine's record and plan (3d design, sections 6.1, 7.1 and 10.3; 12.1 rows 14 and 15), on the database: what
 * the plan lists for a seal for good and for a seal taken while deciding, before and after a move and after an
 * unseal_media; what the insert and update triggers force; the CHECKs; the six functions the API's role may call and the
 * table and the plan it may not reach; the count against seal_posts.images; quarantine_due daily from 24 hours; what the
 * owner's status and serve say of an image being restored or lost; and the lost image's notice, once. The seals commit
 * with real keys; every other change is made as the migrator in a transaction that is rolled back, and the last test
 * removes what the file committed.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the quarantine's plan and record (3d Task 1)", () => {
  let world: DeciderWorld;
  let admin: RealStaff;
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;
  let quarantineBefore: number;
  let startedAt: string;
  /** Sealed for good, two images; sealed while deciding, one image; sealed for good, moved, then lifted, one image. */
  let forGood: Sealed;
  let deciding: Sealed;
  let lifted: Sealed;
  const authors: string[] = [];
  const posts: string[] = [];
  const media = () => [...forGood.mediaIds, ...deciding.mediaIds, ...lifted.mediaIds];

  /** A post with images, reported on the path for child sexual abuse material, and sealed by the admin's real key. */
  async function sealed(images: number, how: "final" | "deciding"): Promise<Sealed> {
    const p = await imagePost(apiDb, images);
    authors.push(p.authorId);
    posts.push(p.postId);
    const { caseId } = await report(apiDb, aPost(p.postId), "csam");
    const outcome = await world.decideAs(admin, caseId, how === "final" ? SEAL_FOR_GOOD : SEAL_WHILE_DECIDING);
    if (typeof outcome === "string") throw new Error(`the seal was not recorded (${outcome})`);
    return { ...p, caseId, decisionId: outcome.decisionId, sealActionId: await sealActionOf(migrateDb, outcome.decisionId) };
  }
  /** A file's row as quarantine-record writes it for a move in: the image, its name, a size and a digest. */
  const moved = (q: Db | DbTx, mediaId: string, size: "small" | "large", digest = "a".repeat(64)) =>
    q.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${mediaId}::uuid, ${storedImageName(mediaId, size)}, 1234, ${digest})`);
  const counts = async (q: Db | DbTx) => (await q.execute<{ due_in: number; due_out: number; undestroyed: number; oldest: string | null }>(sql`select due_in, due_out, undestroyed, oldest::text from public.quarantine_counts()`))[0]!;
  const custody = async (q: Db | DbTx, action: string) =>
    ({ ...(await q.execute<Record<string, unknown>>(sql`select files, moved, moved_at is not null as moved_at, to_return, files_left, lost from public.seal_custody(${action}::uuid)`))[0]! });
  const asBool = async (q: Db | DbTx, fn: "media_quarantined" | "media_lost", mediaId: string) =>
    (await q.execute<{ b: boolean }>(sql.raw(`select public.${fn}('${mediaId}'::uuid) as b`)))[0]!.b;

  beforeAll(async () => {
    // Read in beforeAll: a suite without a database is collected and skipped, and its environment is not loaded then.
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    world = deciderWorld(apiDb);
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    // Counted before the admin's profile exists: the last test removes it with the seals.
    before = await rowCounts(apiDb, [...CHANNEL_TABLES]);
    admin = await world.staff("admin");
    quarantineBefore = await quarantineCount(migrateDb);
    startedAt = (await migrateDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    forGood = await sealed(2, "final");
    deciding = await sealed(1, "deciding");
    // The third: sealed for good, its files moved into the quarantine and recorded, then the seal lifted by a correction.
    lifted = await sealed(1, "final");
    for (const size of MEDIA_SIZES) await moved(migrateDb, lifted.mediaIds[0]!, size);
    const unseal = await world.decideAs(admin, lifted.caseId, { kind: "correction", reviewsDecisionId: lifted.decisionId, actions: [act("unseal_media")] });
    if (typeof unseal === "string") throw new Error(`the seal was not lifted (${unseal})`);
  }, 240_000);

  afterAll(async () => {
    await removeCustody(migrateDb, media(), startedAt);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, authors);
    await world.close();
    await Promise.all([closeDb(migrateDb), closeDb(apiDb)]);
  });

  test("the API's role has no right on quarantine_files and cannot run the plan; it may call the six functions, and nothing of them names a file", async () => {
    const [rights] = await migrateDb.execute<Record<string, boolean>>(sql`
      select has_table_privilege('korbat_api', 'public.quarantine_files', 'SELECT') as sel, has_table_privilege('korbat_api', 'public.quarantine_files', 'INSERT') as ins,
             has_table_privilege('korbat_api', 'public.quarantine_files', 'UPDATE') as upd, has_table_privilege('korbat_api', 'public.quarantine_files', 'DELETE') as del,
             has_function_privilege('korbat_api', 'public.quarantine_plan()', 'EXECUTE') as plan,
             has_function_privilege('korbat_api', 'public.quarantine_sealed_for_good(uuid)', 'EXECUTE') as helper1,
             has_function_privilege('korbat_api', 'public.quarantine_lost_told(uuid)', 'EXECUTE') as helper2,
             has_function_privilege('korbat_api', 'public.quarantine_counts()', 'EXECUTE') as counts,
             has_function_privilege('korbat_api', 'public.seal_custody(uuid)', 'EXECUTE') as custody,
             has_function_privilege('korbat_api', 'public.media_quarantined(uuid)', 'EXECUTE') as quarantined,
             has_function_privilege('korbat_api', 'public.media_lost(uuid)', 'EXECUTE') as lost,
             has_function_privilege('korbat_api', 'public.lost_untold(integer)', 'EXECUTE') as untold,
             has_function_privilege('korbat_api', 'public.lost_told(uuid, delivery_state)', 'EXECUTE') as told`);
    expect({ ...rights }).toEqual({ sel: false, ins: false, upd: false, del: false, plan: false, helper1: false, helper2: false, counts: true, custody: true, quarantined: true, lost: true, untold: true, told: true });
    expect(raised(await apiDb.execute(sql`select count(*) from public.quarantine_files`).then(() => null, (err: unknown) => err))?.code).toBe("42501");
    expect(raised(await apiDb.execute(sql`select * from public.quarantine_plan()`).then(() => null, (err: unknown) => err))?.code).toBe("42501");
    // What the six answer: counts, one time and booleans; the column names say so.
    const columns = async (query: ReturnType<typeof sql>) => Object.keys((await apiDb.execute<Record<string, unknown>>(query))[0] ?? {}).sort();
    expect(await columns(sql`select * from public.quarantine_counts()`)).toEqual(["due_in", "due_out", "oldest", "undestroyed"]);
    expect(await columns(sql`select * from public.seal_custody(${forGood.sealActionId}::uuid)`)).toEqual(["files", "files_left", "lost", "moved", "moved_at", "to_return"]);
    expect(await asBool(apiDb, "media_quarantined", forGood.mediaIds[0]!)).toBe(false);
    expect(await asBool(apiDb, "media_lost", forGood.mediaIds[0]!)).toBe(false);
    await apiDb.execute(sql`select public.lost_told(${randomUUID()}::uuid, 'sent')`);
  });

  test("the plan: in for every image of a seal for good, none for a seal taken while deciding; the counts and the seal's custody", async () => {
    await rolledBack(migrateDb, async (tx) => {
      expect(await planOf(tx, [...forGood.mediaIds, ...deciding.mediaIds])).toEqual(forGood.mediaIds.map((id) => `in ${id}`).sort());
      const c = await counts(tx);
      expect(c.due_in).toBeGreaterThanOrEqual(2);
      const [decided] = await tx.execute<{ at: string }>(sql`select decided_at::text as at from public.decisions where id = ${forGood.decisionId}::uuid`);
      expect(new Date(c.oldest!).getTime()).toBeLessThanOrEqual(new Date(decided!.at).getTime());
      expect(await custody(tx, forGood.sealActionId)).toEqual({ files: 4, moved: 0, moved_at: false, to_return: 0, files_left: 0, lost: 0 });
      expect(await custody(tx, deciding.sealActionId)).toEqual({ files: 2, moved: 0, moved_at: false, to_return: 0, files_left: 0, lost: 0 });
    });
  });

  test("the insert forces the record's time, the post, the mark and the ends; an image whose two files are recorded leaves the plan, and a lost file counts as recorded", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const [first, second] = forGood.mediaIds as [string, string];
      // Whatever the insert says of the time, the post, the mark and the ends, the trigger writes the database's.
      await tx.execute(sql`
        insert into public.quarantine_files (media_id, file, post_id, size, sha256, moved_at, returned_at, unknown)
        values (${first}::uuid, ${storedImageName(first, "small")}, ${randomUUID()}::uuid, 10, ${"b".repeat(64)}, '2001-01-01', now(), true)`);
      const [row] = await quarantineRows(tx, [first]);
      const [now] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      expect(row).toMatchObject({ post_id: forGood.postId, unknown: false, returned_at: null, destroyed_at: null, lost_at: null, lost_told: null, moved_at: now!.now });
      expect(await planOf(tx, forGood.mediaIds)).toEqual([`in ${first}`, `in ${second}`].sort());
      await moved(tx, first, "large");
      expect(await planOf(tx, forGood.mediaIds)).toEqual([`in ${second}`]);
      expect(await asBool(tx, "media_quarantined", first)).toBe(true);
      expect(await custody(tx, forGood.sealActionId)).toEqual({ files: 4, moved: 2, moved_at: true, to_return: 0, files_left: 0, lost: 0 });
      // A file found in neither place and recorded as lost (a run with --lost): its row has no digest, and for an image
      // sealed for good its author is owed nothing (lost_told none). Once both files are accounted for, the image leaves the plan.
      await tx.execute(sql`insert into public.quarantine_files (media_id, file, lost_at) values (${second}::uuid, ${storedImageName(second, "small")}, '2001-01-01')`);
      await moved(tx, second, "large");
      const lostRow = (await quarantineRows(tx, [second])).find((r) => r.file.endsWith("small.webp"))!;
      expect(lostRow).toMatchObject({ size: null, sha256: null, lost_at: now!.now, lost_told: "none" });
      expect(await planOf(tx, forGood.mediaIds)).toEqual([]);
      expect(await asBool(tx, "media_lost", second)).toBe(true);
      expect(await custody(tx, forGood.sealActionId)).toEqual({ files: 4, moved: 3, moved_at: true, to_return: 0, files_left: 0, lost: 1 });
    });
  });

  test("the CHECKs: one of the image's two names, a digest and a size together and both over nothing, at most one end, a release only on a destroyed file", async () => {
    const [id, other] = forGood.mediaIds as [string, string];
    const refused = async (query: ReturnType<typeof sql>) => {
      let code: string | undefined;
      await rolledBack(migrateDb, async (tx) => {
        code = raised(await tx.execute(query).then(() => null, (err: unknown) => err))?.code;
      });
      return code;
    };
    expect(await refused(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${id}::uuid, ${storedImageName(other, "small")}, 1, ${"a".repeat(64)})`)).toBe("23514");
    expect(await refused(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${id}::uuid, ${`files/${id.slice(0, 2)}/${id}/medium.webp`}, 1, ${"a".repeat(64)})`)).toBe("23514");
    expect(await refused(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${id}::uuid, ${storedImageName(id, "small")}, 0, ${"a".repeat(64)})`)).toBe("23514");
    expect(await refused(sql`insert into public.quarantine_files (media_id, file, size, sha256) values (${id}::uuid, ${storedImageName(id, "small")}, 1, 'not hex')`)).toBe("23514");
    expect(await refused(sql`insert into public.quarantine_files (media_id, file, size) values (${id}::uuid, ${storedImageName(id, "small")}, 1)`)).toBe("23514");
    expect(await refused(sql`insert into public.quarantine_files (media_id, file) values (${id}::uuid, ${storedImageName(id, "small")})`)).toBe("23514");
    let ends: string | undefined;
    await rolledBack(migrateDb, async (tx) => {
      await moved(tx, id, "small");
      ends = raised(await tx.execute(sql`update public.quarantine_files set returned_at = now(), lost_at = now() where media_id = ${id}::uuid`).then(() => null, (err: unknown) => err))?.code;
    });
    expect(ends).toBe("23514");
    let release: string | undefined;
    await rolledBack(migrateDb, async (tx) => {
      await moved(tx, id, "small");
      release = raised(await tx.execute(sql`update public.quarantine_files set release_id = gen_random_uuid() where media_id = ${id}::uuid`).then(() => null, (err: unknown) => err))?.code;
    });
    expect(release).toBe("23514");
  });

  test("the update keeps a file's identity and the digest it was moved with, and stamps each end and a move again with the record's time", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const id = forGood.mediaIds[0]!;
      const file = storedImageName(id, "small");
      await moved(tx, id, "small", "c".repeat(64));
      await tx.execute(sql`update public.quarantine_files set post_id = gen_random_uuid(), unknown = true, sha256 = ${"d".repeat(64)}, size = 99, returned_at = '2001-01-01' where media_id = ${id}::uuid`);
      const [now] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      expect((await quarantineRows(tx, [id]))[0]).toMatchObject({ file, post_id: forGood.postId, unknown: false, sha256: "c".repeat(64), size: 1234, returned_at: now!.now });
      // Moved again: the row is kept, its return cleared and its move stamped anew.
      await ageCustodyForTest(tx, { media: id }, "1 day");
      await tx.execute(sql`update public.quarantine_files set returned_at = null where media_id = ${id}::uuid`);
      expect((await quarantineRows(tx, [id]))[0]).toMatchObject({ returned_at: null, moved_at: now!.now });
    });
  });

  test("an image of a lifted seal is out until its files are back: being restored for its author, a 404 with an info line for everyone, the counts' oldest from the reversal", async () => {
    const id = lifted.mediaIds[0]!;
    expect(await planOf(migrateDb, [id])).toEqual([`out ${id}`]);
    expect(await custody(apiDb, lifted.sealActionId)).toEqual({ files: 2, moved: 2, moved_at: true, to_return: 2, files_left: 0, lost: 0 });
    expect(await asBool(apiDb, "media_quarantined", id)).toBe(true);
    const c = await counts(apiDb);
    expect(c.due_out).toBeGreaterThanOrEqual(1);
    const h = await mediaHarness(apiDb);
    try {
      const logged: { level: string; msg: string }[] = [];
      const log = { info: (_o: unknown, msg: string) => logged.push({ level: "info", msg }), error: (_o: unknown, msg: string) => logged.push({ level: "error", msg }), warn: () => undefined } as unknown as Logger;
      const deps = { ...h.deps, log };
      expect((await status(deps, lifted.authorId, id))).toMatchObject({ id, status: "ready", restoring: true });
      expect(await serve(deps, { id, size: "small", ifNoneMatch: undefined, viewer: async () => null })).toEqual({ kind: "not_found" });
      expect(logged).toEqual([{ level: "info", msg: "media: a visible image's files are not in the store: being restored, or lost" }]);
      // An image of the post sealed for good says nothing of the kind: it is sealed, and its status holds no blurhash.
      expect(await status(deps, forGood.authorId, forGood.mediaIds[0]!)).toEqual({ id: forGood.mediaIds[0]!, status: "ready", width: 1200, height: 800 });
      // Once its files are back in the store, nothing is said either.
      h.worker.ready(id, { width: 1200, height: 800 });
      expect(await status(deps, lifted.authorId, id)).toEqual({ id, status: "ready", width: 1200, height: 800, blurhash: "L2Eo_P_3jb_3~qoL" });
    } finally {
      h.cleanup();
    }
  });

  test("a file of a lifted seal recorded as lost: the plan lets it go, its status says lost, and its author is mailed image_lost once", async () => {
    const id = lifted.mediaIds[0]!;
    await migrateDb.execute(sql`update public.quarantine_files set lost_at = now() where media_id = ${id}::uuid`);
    expect((await quarantineRows(migrateDb, [id])).map((row) => row.lost_told)).toEqual(["pending", "pending"]);
    expect(await planOf(migrateDb, [id])).toEqual([]);
    expect(await asBool(apiDb, "media_lost", id)).toBe(true);
    expect(await custody(apiDb, lifted.sealActionId)).toEqual({ files: 2, moved: 0, moved_at: false, to_return: 0, files_left: 0, lost: 2 });
    const h = await mediaHarness(apiDb);
    try {
      expect(await status(h.deps, lifted.authorId, id)).toMatchObject({ id, status: "ready", lost: true });
      expect(await status(h.deps, lifted.authorId, id)).not.toHaveProperty("restoring");
    } finally {
      h.cleanup();
    }
    // The dispatch round's notices: one mail for the image, with its post's time, and the outcome recorded; then nothing.
    const sent: { userId: string; message: unknown }[] = [];
    const auth = { mailAccount: async (userId: string, message: unknown) => (sent.push({ userId, message }), "sent") } as unknown as AuthForModeration;
    const deps = moderationDeps(apiDb, { auth });
    const [post] = await apiDb.execute<{ ms: string }>(sql`select floor(extract(epoch from created_at) * 1000)::bigint::text as ms from posts where id = ${lifted.postId}::uuid`);
    expect(await lostImageNotices(deps, new Date())).toBe(1);
    expect(sent).toEqual([{ userId: lifted.authorId, message: { template: "image_lost", postCreatedAt: new Date(Number(post!.ms)) } }]);
    expect((await quarantineRows(migrateDb, [id])).map((row) => row.lost_told)).toEqual(["sent", "sent"]);
    expect(await lostImageNotices(deps, new Date())).toBe(0);
    expect(sent).toHaveLength(1);
    // lost_told changes only from pending.
    await apiDb.execute(sql`select public.lost_told(${id}::uuid, 'failed')`);
    expect((await quarantineRows(migrateDb, [id])).map((row) => row.lost_told)).toEqual(["sent", "sent"]);
  });

  test("a file whose image row is gone is to destroy; a file of an image the database does not know is the operator's, never destroyed or returned; an imported row keeps its time", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const p = await imagePost(tx, 1);
      const id = p.mediaIds[0]!;
      await moved(tx, id, "small");
      // A visible image on a post, not sealed: its file goes back.
      expect(await planOf(tx, [id])).toEqual([`out ${id}`]);
      await tx.execute(sql`delete from post_media where id = ${id}::uuid`);
      expect(await planOf(tx, [id])).toEqual([`destroy ${id}`]);
      // A file the inventory found for an image the database does not know.
      const unknown = randomUUID();
      await moved(tx, unknown, "large");
      expect((await quarantineRows(tx, [unknown]))[0]).toMatchObject({ unknown: true, post_id: null });
      expect(await planOf(tx, [unknown])).toEqual([`operator ${unknown}`]);
      // A row written again after a restore keeps a time that is not after the clock, and only then.
      const imported = randomUUID();
      await tx.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256, moved_at, imported_at, post_id) values (${imported}::uuid, ${storedImageName(imported, "small")}, 5, ${"e".repeat(64)}, '2026-01-02 03:04:05+00', now(), ${p.postId}::uuid)`);
      await tx.execute(sql`insert into public.quarantine_files (media_id, file, size, sha256, moved_at, imported_at) values (${imported}::uuid, ${storedImageName(imported, "large")}, 5, ${"e".repeat(64)}, now() + interval '1 day', now())`);
      const rowsOf = await quarantineRows(tx, [imported]);
      const [now] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      expect(rowsOf.map((r) => [r.file.split("/")[3], r.moved_at, r.post_id])).toEqual([
        ["large.webp", now!.now, null],
        ["small.webp", "2026-01-02 03:04:05+00", p.postId],
      ]);
    });
  });

  test("quarantineNames: a line a file, a post whose rows differ from its seal left out and named, and a post with an erased image row listed", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const mine = (names: Awaited<ReturnType<typeof quarantineNames>>) => names.lines.filter((line) => forGood.mediaIds.includes(line.mediaId));
      const listed = await quarantineNames(tx);
      expect(mine(listed).map((line) => [line.direction, line.mediaId, line.postId, line.files])).toEqual(
        [...forGood.mediaIds].sort().map((id) => ["in", id, forGood.postId, MEDIA_SIZES.map((size) => storedImageName(id, size))]),
      );
      expect(listed.mismatched.map((post) => post.postId)).not.toContain(forGood.postId);
      // One file already moved: only the other is named.
      await moved(tx, forGood.mediaIds[0]!, "small");
      expect(mine(await quarantineNames(tx)).find((line) => line.mediaId === forGood.mediaIds[0])!.files).toEqual([storedImageName(forGood.mediaIds[0]!, "large")]);
      // An image row erased (an R4 redaction before the seal) still counts against the seal, and its files are not listed.
      await tx.execute(sql`update post_media set erased_at = now() where id = ${forGood.mediaIds[1]!}::uuid`);
      const erased = await quarantineNames(tx);
      expect(mine(erased).map((line) => line.mediaId)).toEqual([forGood.mediaIds[0]]);
      expect(erased.mismatched.map((post) => post.postId)).not.toContain(forGood.postId);
      // The seal recorded another number of image rows: the post gets no line and is named.
      await tx.execute(sql`update public.seal_posts set images = 3 where action_id = ${forGood.sealActionId}::uuid`);
      const left = await quarantineNames(tx);
      expect(mine(left)).toEqual([]);
      expect(left.mismatched.filter((post) => post.postId === forGood.postId)).toEqual([{ postId: forGood.postId, rows: 2, images: [3] }]);
    });
  });

  test("quarantine_due: daily from the day the oldest move became due until the move is recorded, with the count and the oldest time", async () => {
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`delete from public.alert_outbox where kind = 'quarantine_due'`);
      const dueRows = async () => (await tx.execute<{ step: number; facts: { count: number; oldestAt: string } }>(sql`select step, facts from public.alert_outbox where kind = 'quarantine_due' order by step`)).map((row) => ({ ...row }));
      // Every move this file made due is younger than the threshold: no alert.
      await tx.execute(sql`select public.alert_steps()`);
      expect(await dueRows()).toEqual([]);
      const almost = `${QUARANTINE_RULES.dueHours - 1} hours`;
      await ageCustodyForTest(tx, { decision: forGood.decisionId }, almost);
      await tx.execute(sql`select public.alert_steps()`);
      expect(await dueRows()).toEqual([]);
      await ageCustodyForTest(tx, { decision: forGood.decisionId }, "2 hours");
      await tx.execute(sql`select public.alert_steps()`);
      const c = await counts(tx);
      const [oldest] = await tx.execute<{ at: string }>(sql`select public.alert_time(oldest) as at from public.quarantine_counts()`);
      expect(await dueRows()).toEqual([{ step: 0, facts: { count: c.due_in + c.due_out, oldestAt: oldest!.at } }]);
      // Daily: not again the same day, again the next.
      await tx.execute(sql`select public.alert_steps()`);
      expect(await dueRows()).toHaveLength(1);
      await ageCustodyForTest(tx, { alerts: "quarantine_due" }, `${QUARANTINE_RULES.dueHours + 1} hours`);
      await tx.execute(sql`select public.alert_steps()`);
      expect((await dueRows()).map((row) => row.step)).toEqual([0, 1]);
      // Once every due move is recorded, the alert stops.
      for (const id of forGood.mediaIds) for (const size of MEDIA_SIZES) await moved(tx, id, size);
      await tx.execute(sql`update public.quarantine_files set returned_at = now() where media_id = ${lifted.mediaIds[0]!}::uuid and lost_at is null`);
      const after = await counts(tx);
      await ageCustodyForTest(tx, { alerts: "quarantine_due" }, `${QUARANTINE_RULES.dueHours + 1} hours`);
      await tx.execute(sql`select public.alert_steps()`);
      expect((await dueRows()).length).toBe(after.due_in + after.due_out === 0 ? 2 : 3);
    });
  });

  test("this file left nothing behind: its seals, cases, records and quarantine rows are removed, and the tables hold what they held before", async () => {
    await removeCustody(migrateDb, media(), startedAt);
    await removeRecords(migrateDb, [...authors, admin.id]);
    await removeDecided(migrateDb, posts, [admin.id]);
    await removeFixtures(migrateDb, authors);
    posts.length = 0;
    authors.length = 0;
    expect(await quarantineCount(migrateDb)).toBe(quarantineBefore);
    expect(await rowCounts(apiDb, [...CHANNEL_TABLES])).toEqual(before);
  });
});
