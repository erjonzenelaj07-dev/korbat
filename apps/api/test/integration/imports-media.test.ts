import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, ImportView, type ImportChoice, type ImportedPost } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import { MATCH_FIXTURES } from "@korbat/media-protocol";
import { IMAGES_SITE_KEY } from "../../src/imports/feeder";
import { importImageId } from "../../src/imports/plan";
import { matchAdapterFrom, type TestMatchAdapter } from "../../src/media";
import { createMediaRepo } from "../../src/media/repo";
import { importsHarness, line, type ImportsHarness } from "./imports-harness";
import { BYTES } from "./media-harness";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Everything, with images: the choice of these tests unless one says otherwise. */
const CHOICE: ImportChoice = { from: null, to: null, replies: false, warnings: false, protected: false, images: true, long: "leave" };
/** A PNG on no list of the test matcher: the signature, then bytes of its own. */
const clear = (n: number) => Uint8Array.from([...MATCH_FIXTURES.flag.slice(0, 8), ...Buffer.from(`a png on no list ${n} ${randomUUID()}`)]);
/** A line with one image of its own, described by its source. */
const withImage = (ref: number, over: Partial<ImportedPost> = {}) => line(ref, { media: [{ file: `${ref}-0.png`, alt: `image ${ref}` }], ...over });

/**
 * Imported images (3b design, sections 4.5 step 2, 6.5, 7.4, 8.1 and 8.2; 12.3's imports-media.test.ts; Task 5): the
 * confirmation and the Stop over HTTP; the feeder, which feeds only while no upload of anyone's own waits, at most two
 * images in flight and at the site's pace, through the media module's own receive path; the sweeper and the pending count,
 * which leave imported rows alone; the settling under the test matcher (a clear image kept and attachable to its import's
 * post, a non-acting match left out as flagged with an admin alerted, an unchecked image and one the worker never answers
 * left out after 24 hours); an acting match, which stops the import before any post with 3d's notice and hold; and the
 * work files openWorkFile refuses, from which nothing of the store is copied. The stand-in worker writes the protocol's
 * files and decodes nothing; writeScanOutput stands in for the importer.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: imported images", () => {
  let h: ImportsHarness;
  let adapter: TestMatchAdapter;
  const started = new Date();
  beforeAll(async () => {
    adapter = matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" }) as TestMatchAdapter;
    h = await importsHarness({ settings: { maxActive: 100, images: true }, match: adapter });
  });
  afterAll(async () => {
    try {
      // The alerts this file raised (the flag's, and the urgent lane's for the refused upload) go with it.
      await h?.migrateDb.execute(sql`delete from public.alert_outbox where kind in ('import_image_flagged', 'moderation_urgent') and created_at >= ${started.toISOString()}::timestamptz`);
    } finally {
      await h?.close();
    }
  });

  const refusal = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  const drive = (at: Date = new Date()) => h.imports.drive(at, { orphans: false });
  const confirm = (b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"], id: string, body: unknown) => b.fetch(`/api/imports/${id}/confirm`, { method: "POST", json: body });

  /** The import's row as the migrator reads it. */
  async function job(id: string) {
    const [row] = await h.migrateDb.execute<{
      status: string;
      image_cursor: number;
      images_kept: number;
      images_left_out: number;
      images_left_out_by: Record<string, number>;
      seed: string | null;
      stop_reason: string | null;
      refused_at: string | null;
      refused_words: string | null;
      posts_published: number;
    }>(sql`select status::text as status, image_cursor, images_kept, images_left_out, images_left_out_by, encode(seed, 'hex') as seed, stop_reason,
                  to_char(refused_at_original, 'YYYY-MM-DD') as refused_at, refused_words, posts_published
             from import_jobs where id = ${id}::uuid`);
    return row!;
  }
  /** The import's image rows, oldest first. */
  const rowsOf = async (id: string) =>
    (await h.migrateDb.execute<{ id: string; status: string; post_id: string | null; check_state: string | null }>(
      sql`select m.id, m.status::text as status, m.post_id, h.check_state from post_media m left join media_hashes h on h.media_id = m.id
           where m.import_job_id = ${id}::uuid order by m.created_at, m.id`,
    )).map((row) => ({ ...row }));
  const rowExists = async (mediaId: string) => (await h.migrateDb.execute(sql`select 1 from post_media where id = ${mediaId}::uuid`)).length === 1;
  /** The uploads the stand-in worker would take. */
  const incoming = () => readdirSync(h.media.deps.files.uploads.incoming).sort();
  const parts = () => readdirSync(h.media.deps.files.uploads.tmp).sort();
  /** The worker accepts every upload that waits for it. */
  const answerAll = () => {
    for (const id of incoming()) h.worker.ready(id, { width: 8, height: 8 });
  };
  /** The derived id of the import's image of a line (6.5), from its seed. */
  const imageId = async (jobId: string, ref: number) => importImageId(Buffer.from((await job(jobId)).seed!, "hex"), ref, 0);
  /** The site's pace already used this hour, read as the store counts it and given back. */
  const paceUsed = async () => {
    const { count } = await h.rateLimitStore.hit(IMAGES_SITE_KEY, HOUR);
    await h.rateLimitStore.release(IMAGES_SITE_KEY);
    return count - 1;
  };

  /** An import of a new account, ready with these images, one a line, each described by its source, then confirmed. */
  async function preparing(images: readonly Uint8Array[], over: { lines?: ImportedPost[]; choice?: Partial<ImportChoice> } = {}) {
    const lines = over.lines ?? images.map((_, ref) => withImage(ref));
    const r = await h.ready(lines, { images: Object.fromEntries(images.map((bytes, ref) => [`${ref}-0.png`, bytes])) });
    const res = await confirm(r.b, r.view.id, { choice: { ...CHOICE, ...over.choice }, statement: true });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    return { ...r, view: ImportView.parse(await res.json()) };
  }
  const viewOf = async (r: { b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"] }, id: string) => ImportView.parse(await (await r.b.fetch(`/api/imports/${id}`)).json());
  /** Ends an import that still runs, and deletes its rows on no post in a round, so the next test's feeder starts clean. */
  async function finish(r: { b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"] }, id: string) {
    if (["preparing", "publishing"].includes((await job(id)).status)) expect((await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" })).status).toBe(200);
    await drive();
    expect((await rowsOf(id)).filter((row) => row.post_id === null && row.status !== "ready")).toEqual([]);
  }

  test("confirm and stop over HTTP: each refusal with its code; the confirmation's one UPDATE, publishing at once without images, and the Stop", async () => {
    const r = await h.ready([line(0), line(1, { kind: "reply" }), line(2, { at: "2019-05-02T12:00:00Z" })]);
    const id = r.view.id;
    expect(await refusal(await confirm(r.b, id, { choice: CHOICE, statement: false }))).toEqual([400, "statement_required"]);
    expect(await refusal(await confirm(r.b, id, { choice: CHOICE }))).toEqual([400, "statement_required"]);
    expect(await refusal(await confirm(r.b, id, { choice: { ...CHOICE, long: "cut" }, statement: true }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await confirm(r.b, id, { choice: CHOICE, statement: true, extra: 1 }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await r.b.fetch(`/api/imports/${id}/confirm`, { method: "POST", raw: { type: "application/json", body: new TextEncoder().encode("not json") } }))).toEqual([400, "invalid_request"]);
    // Outside the months the archive has (2019-03 to 2019-05), on either end.
    expect(await refusal(await confirm(r.b, id, { choice: { ...CHOICE, from: "2019-02" }, statement: true }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await confirm(r.b, id, { choice: { ...CHOICE, to: "2019-06" }, statement: true }))).toEqual([400, "invalid_request"]);
    // Within them, but holding no post: April has none, and March's only other post is a reply.
    expect(await refusal(await confirm(r.b, id, { choice: { ...CHOICE, from: "2019-04", to: "2019-04" }, statement: true }))).toEqual([400, "nothing_chosen"]);
    const other = await h.signUp();
    expect(await refusal(await confirm(other.b, id, { choice: CHOICE, statement: true }))).toEqual([404, "not_found"]);
    expect(await refusal(await other.b.fetch(`/api/imports/${id}/stop`, { method: "POST" }))).toEqual([404, "not_found"]);
    expect(await refusal(await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" }))).toEqual([409, "wrong_state"]);
    expect((await job(id)).status).toBe("ready");
  });

  test("a confirmation without images publishes at once: the choice, the statement's time, a seed of 32 bytes, the scan cut down with the chosen totals; then the Stop ends it", async () => {
    const r = await h.ready([line(0), line(1, { kind: "reply" }), line(2, { at: "2019-05-02T12:00:00Z" })]);
    const id = r.view.id;
    const res = await confirm(r.b, id, { choice: CHOICE, statement: true });
    expect(res.status).toBe(200);
    const view = ImportView.parse(await res.json());
    expect(view.status).toBe("publishing");
    expect(view.choice).toEqual(CHOICE);
    // The reply is left out by the choice: two posts, and no image to prepare.
    expect(view.progress).toMatchObject({ postsTotal: 2, imagesTotal: 0, imagesSettled: 0, imagesLeftOut: {} });
    expect(view.scan).toMatchObject({ months: [], chosen: { posts: 2, images: 0 } });
    const [row] = await h.migrateDb.execute<{ seed: number; stated: boolean; confirmed: boolean; scan: { months: unknown[]; samples: unknown[]; pages: unknown[]; chosen: unknown } }>(
      sql`select octet_length(seed) as seed, stated_at is not null as stated, confirmed_at is not null as confirmed, scan from import_jobs where id = ${id}::uuid`,
    );
    expect({ seed: row!.seed, stated: row!.stated, confirmed: row!.confirmed, months: row!.scan.months, samples: row!.scan.samples, pages: row!.scan.pages, chosen: row!.scan.chosen }).toEqual({
      seed: 32,
      stated: true,
      confirmed: true,
      months: [],
      samples: [],
      pages: [],
      chosen: { posts: 2, images: 0 },
    });
    expect(await refusal(await confirm(r.b, id, { choice: CHOICE, statement: true }))).toEqual([409, "wrong_state"]);
    expect(await refusal(await r.b.fetch(`/api/imports/${id}/cancel`, { method: "POST" }))).toEqual([409, "wrong_state"]);
    const stopped = await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(ImportView.parse(await stopped.json())).toMatchObject({ status: "stopped", stopReason: "by_author", refusalId: null, undoable: false });
    expect((await job(id)).seed).toBeNull();
    // The work folder is asked for at once.
    expect(existsSync(h.archives.deletion(id))).toBe(true);
    expect(await refusal(await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" }))).toEqual([409, "wrong_state"]);
  });

  test("the feeder feeds only while no upload of anyone's own waits, at most two in flight, at the site's pace (a store that cannot count feeds nothing); a part a crash left is discarded; the sweeper and pendingCount leave the rows alone; a kept image goes onto its import's post", async () => {
    const images = [clear(0), clear(1), clear(2), clear(3)];
    const r = await preparing(images);
    const id = r.view.id;
    expect(r.view.status).toBe("preparing");
    expect(r.view.progress).toMatchObject({ imagesTotal: 4, postsTotal: 4 });

    // A person's own upload waits for the worker (a file in incoming/ that is no imported image's): nothing is fed.
    const own = path.join(h.media.deps.files.uploads.incoming, randomUUID());
    writeFileSync(own, BYTES.jpeg);
    expect((await drive()).fed).toBe(0);
    rmSync(own);
    // A limit store that cannot count feeds nothing.
    const limits = h.imports.deps.limits;
    h.imports.deps.limits = { hit: async () => Promise.reject(new Error("down")), release: async () => undefined };
    try {
      expect((await drive()).fed).toBe(0);
    } finally {
      h.imports.deps.limits = limits;
    }
    // The site's pace: one image more this hour, then none.
    h.settings.imagesPerHour = (await paceUsed()) + 1;
    try {
      expect((await drive()).fed).toBe(1);
      expect((await drive()).fed).toBe(0);
    } finally {
      h.settings.imagesPerHour = 600;
    }
    expect((await job(id)).image_cursor).toBe(1);

    // A part a crash left under the next image's id is discarded first, and the image's own bytes go to the worker.
    const second = await imageId(id, 1);
    writeFileSync(h.media.deps.files.uploads.part(second), "left by a crash");
    expect((await drive()).fed).toBe(1);
    expect(readFileSync(h.media.deps.files.uploads.upload(second))).toEqual(Buffer.from(images[1]!));
    expect(parts()).toEqual([]);
    // Two in flight: nothing more until the worker answers.
    expect((await drive()).fed).toBe(0);
    const fed = (await rowsOf(id)).map((row) => row.id);
    expect(fed).toEqual([await imageId(id, 0), second]);
    expect(incoming()).toEqual([...fed].sort());
    // Hashed as any upload while the matcher is on.
    expect((await rowsOf(id)).map((row) => row.check_state)).toEqual(["pending", "pending"]);

    // The sweeper's two bounds and the pending count pass over imported rows (tried in a transaction that is rolled back).
    await rolledBack(h.apiDb, async (tx) => {
      const repo = createMediaRepo(tx as unknown as Db);
      expect((await repo.failStale(new Date(Date.now() + 2 * DAY))).filter((media) => fed.includes(media))).toEqual([]);
      expect((await repo.deleteUnattachedBefore(new Date(Date.now() + 2 * DAY))).filter((media) => fed.includes(media))).toEqual([]);
      expect(await repo.pendingCount(r.id)).toBe(0);
    });
    expect((await rowsOf(id)).map((row) => row.status)).toEqual(["processing", "processing"]);

    answerAll();
    const second_round = await drive();
    expect(second_round).toMatchObject({ fed: 2, leftOut: 0 });
    expect((await job(id)).images_kept).toBe(2);
    answerAll();
    // Every image kept and the cursor at the end: the import publishes.
    expect(await drive()).toMatchObject({ fed: 0, publishing: 1 });
    expect(await job(id)).toMatchObject({ status: "publishing", image_cursor: 4, images_kept: 4, images_left_out: 0, images_left_out_by: {} });
    const view = await viewOf(r, id);
    expect(view.progress).toMatchObject({ imagesTotal: 4, imagesSettled: 4, imagesLeftOut: {} });
    const kept = await rowsOf(id);
    expect(kept.map((row) => [row.status, row.check_state, row.post_id])).toEqual(Array.from({ length: 4 }, () => ["ready", "clear", null]));

    // A kept image goes onto a post of its own import with its description, as Task 6's publisher attaches it.
    await rolledBack(h.apiDb, async (tx) => {
      const [post] = await tx.execute<{ id: string }>(sql`
        insert into posts (author_id, body, import_job_id, import_source, original_created_at, import_shortened, import_key)
        values (${r.id}::uuid, 'imported line 0', ${id}::uuid, 'mastodon', '2019-03-01T12:00:00Z', false, ${randomBytes(32)}::bytea) returning id`);
      await h.media.deps.repo.attach(tx, { postId: post!.id, ownerId: r.id, items: [{ id: kept[0]!.id, alt: "image 0" }] });
      const [attached] = await tx.execute<{ post_id: string }>(sql`select post_id from post_media where id = ${kept[0]!.id}::uuid`);
      expect(attached!.post_id).toBe(post!.id);
    });
    await finish(r, id);
    // Stopped while publishing: the kept rows on no post went in the round, and their files were asked for.
    expect(await rowsOf(id)).toEqual([]);
    const requested = await h.media.deps.files.deletionRequests();
    for (const row of kept) expect(requested).toContain(row.id);
  });

  test("with the test matcher: a match that does not act is left out as flagged, never published, its record kept and an admin alerted; an unchecked image and one the worker never answers are left out 24 hours after their rows", async () => {
    adapter.flag = "near";
    const r = await preparing([MATCH_FIXTURES.flag, clear(1), clear(2), clear(3)]);
    const id = r.view.id;
    expect((await drive()).fed).toBe(2);
    const flagged = await imageId(id, 0);
    answerAll();
    const round = await drive();
    expect(round).toMatchObject({ leftOut: 1, flagged: 1, fed: 2 });
    // The flagged row and its file went; its match record stays, as for any upload never posted.
    expect(await rowExists(flagged)).toBe(false);
    expect(await h.media.deps.files.deletionRequests()).toContain(flagged);
    expect(await h.migrateDb.execute(sql`select 1 from media_matches where media_id = ${flagged}::uuid and not acting`)).toHaveLength(1);
    const [alert] = await h.migrateDb.execute<{ facts: Record<string, unknown> }>(
      sql`select facts from public.alert_outbox where kind = 'import_image_flagged' and created_at >= ${started.toISOString()}::timestamptz order by id desc limit 1`,
    );
    expect(alert!.facts).toEqual({ at: expect.any(String), count: 1 });
    expect(await job(id)).toMatchObject({ images_kept: 1, images_left_out: 1, images_left_out_by: { flagged: 1 } });

    // The source answers nothing for the third image; the worker never answers the fourth.
    adapter.silent = true;
    try {
      h.worker.ready(await imageId(id, 2), { width: 8, height: 8 });
      expect(await drive()).toMatchObject({ fed: 0, leftOut: 0, publishing: 0 });
      // The last two rows were written in one round, at one time, so they are compared as a set.
      expect((await rowsOf(id)).map((row) => `${row.status} ${row.check_state}`).sort()).toEqual(["processing pending", "ready clear", "ready unchecked"]);
      // Still within the 24 hours: they wait.
      expect(await drive(new Date(Date.now() + 23 * HOUR))).toMatchObject({ leftOut: 0, publishing: 0 });
      // After them: both are left out as not checked, and the import publishes.
      expect(await drive(new Date(Date.now() + DAY + 60_000))).toMatchObject({ leftOut: 2, publishing: 1 });
    } finally {
      adapter.silent = false;
    }
    expect(await job(id)).toMatchObject({ status: "publishing", images_kept: 1, images_left_out: 3, images_left_out_by: { flagged: 1, not_checked: 2 } });
    expect((await viewOf(r, id)).progress).toMatchObject({ imagesTotal: 4, imagesSettled: 4, imagesLeftOut: { flagged: 1, not_checked: 2 } });
    // The upload the worker never took is gone from incoming/.
    expect(incoming()).toEqual([]);
    await finish(r, id);
  });

  test("an acting match stops the import before any post: 3d's notice and hold, the post's day and first words on the row, the other rows and the work folder deleted, the refusal named in the view", async () => {
    const words = "This is the post whose image korbat refuses, and its words go on for longer than eighty code points in all";
    const r = await preparing([clear(0), MATCH_FIXTURES.acting, clear(2)], {
      lines: [withImage(0), withImage(1, { text: words, at: "2019-03-02T08:30:00Z" }), withImage(2)],
    });
    const id = r.view.id;
    expect((await drive()).fed).toBe(2);
    const [first, refused] = [await imageId(id, 0), await imageId(id, 1)];
    answerAll();
    expect(await drive()).toMatchObject({ refused: 1, fed: 0 });
    const row = await job(id);
    expect(row).toMatchObject({ status: "stopped", stop_reason: "refused_image", seed: null, refused_at: "2019-03-02", posts_published: 0 });
    // At most refusedWordsMax code points, cut at the last space within them.
    expect(row.refused_words).toBe("This is the post whose image korbat refuses, and its words go on for longer");
    expect([...row.refused_words!].length).toBeLessThanOrEqual(80);
    // Nothing of it was published.
    expect(await h.migrateDb.execute(sql`select 1 from posts where import_job_id = ${id}::uuid`)).toHaveLength(0);
    // 3d's hold and notice: the refused upload is held for good, with its refusal; the clear one went with its file.
    const [held] = await h.migrateDb.execute<{ id: string; owner_id: string; hold: boolean }>(
      sql`select u.id, u.owner_id, m.hold_until is not null as hold from upload_refusals u join post_media m on m.id = u.media_id where u.media_id = ${refused}::uuid`,
    );
    expect({ owner: held!.owner_id, hold: held!.hold }).toEqual({ owner: r.id, hold: true });
    expect(await rowExists(first)).toBe(false);
    expect(await h.media.deps.files.deletionRequests()).toContain(first);
    expect(await h.media.deps.files.deletionRequests()).not.toContain(refused);
    await h.moderation.settle();
    expect(h.mailer.sent.some((mail) => mail.to === r.email && mail.template === "upload_refused")).toBe(true);
    // The work folder is asked for, so the archive's other images go unopened.
    expect(existsSync(h.archives.deletion(id))).toBe(true);
    const view = await viewOf(r, id);
    expect(view).toMatchObject({ status: "stopped", stopReason: "refused_image", refusalId: held!.id, refusedAt: "2019-03-02", refusedWords: row.refused_words, undoable: false });
    // Later rounds leave the held row as it is.
    await drive();
    expect(await rowExists(refused)).toBe(true);
  });

  test("a symlinked media folder (a junction on Windows) leading to a folder of the store is refused as missing_file, and nothing of the store is copied", async () => {
    const r = await preparing([clear(0), clear(1), clear(2)]);
    const id = r.view.id;
    expect((await drive()).fed).toBe(2);
    // The planned third image is now behind a link to a folder of the store, which holds a file of that name.
    const planted = path.join(h.media.deps.files.store.files, `planted-${id}`);
    mkdirSync(planted, { recursive: true });
    const stored = clear(99);
    writeFileSync(path.join(planted, "2-0.png"), stored);
    renameSync(h.work.mediaDir(id), path.join(h.root, `elsewhere-${id}`));
    symlinkSync(planted, h.work.mediaDir(id), "junction");
    expect(readFileSync(path.join(h.work.mediaDir(id), "2-0.png"))).toEqual(Buffer.from(stored));
    answerAll();
    expect(await drive()).toMatchObject({ fed: 0, skipped: 1, publishing: 1 });
    const third = await imageId(id, 2);
    expect(await rowExists(third)).toBe(false);
    expect(incoming()).toEqual([]);
    expect(parts()).toEqual([]);
    expect(await job(id)).toMatchObject({ status: "publishing", image_cursor: 3, images_kept: 2, images_left_out: 1, images_left_out_by: { missing_file: 1 } });
    await finish(r, id);
  });

  test("a symlinked image file leading to a file of the store is refused as missing_file, and nothing of it is copied", async (context) => {
    const r = await preparing([clear(0), clear(1), clear(2)]);
    const id = r.view.id;
    expect((await drive()).fed).toBe(2);
    const stored = path.join(h.media.deps.files.store.root, `planted-${id}.png`);
    writeFileSync(stored, clear(98));
    rmSync(h.work.media(id, "2-0.png"));
    try {
      symlinkSync(stored, h.work.media(id, "2-0.png"));
    } catch (err) {
      await finish(r, id);
      // Windows without Developer Mode cannot make a file symlink: the folder's case above stands for it there.
      if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") return context.skip();
      throw err;
    }
    answerAll();
    expect(await drive()).toMatchObject({ fed: 0, skipped: 1 });
    expect(await rowExists(await imageId(id, 2))).toBe(false);
    expect(incoming()).toEqual([]);
    expect(await job(id)).toMatchObject({ images_left_out_by: { missing_file: 1 } });
    await finish(r, id);
  });

  test("an image the sniff refuses is left out as unsupported and never retried; with the comparison off, every image not yet fed is left out as not checked", async () => {
    const r = await preparing([BYTES.pdf, clear(1)]);
    const id = r.view.id;
    expect(await drive()).toMatchObject({ fed: 1, skipped: 1 });
    expect(parts()).toEqual([]);
    answerAll();
    expect(await drive()).toMatchObject({ publishing: 1 });
    expect(await job(id)).toMatchObject({ images_kept: 1, images_left_out_by: { unsupported: 1 } });
    await finish(r, id);

    const off = await preparing([clear(0), clear(1)]);
    const media = h.imports.deps.media;
    h.imports.deps.media = { ...media, matching: false };
    try {
      expect(await drive()).toMatchObject({ fed: 0, skipped: 2, publishing: 1 });
    } finally {
      h.imports.deps.media = media;
    }
    expect(await job(off.view.id)).toMatchObject({ status: "publishing", images_kept: 0, images_left_out: 2, images_left_out_by: { not_checked: 2 } });
    expect(await rowsOf(off.view.id)).toEqual([]);
    await finish(off, off.view.id);
  });

  test("a Stop that commits first leaves no new row; the stopped import's rows on no post go in the next round, with their files, and its plan with them", async () => {
    const r = await preparing([clear(0), clear(1), clear(2)]);
    const id = r.view.id;
    expect((await drive()).fed).toBe(2);
    expect(h.imports.deps.plans.has(id)).toBe(true);
    const fed = (await rowsOf(id)).map((row) => row.id);
    expect((await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" })).status).toBe(200);
    // The feeder's write for the next image, after the Stop's commit: its claim finds the import stopped, and nothing stays.
    const opened = await h.imports.deps.files.openWork(h.work.media(id, "2-0.png"), 1_000_000);
    if (!opened.ok) throw new Error(opened.code);
    const next = importImageId(randomBytes(32), 2, 0);
    try {
      const receipt = await h.imports.deps.media.receive({ id: next, ownerId: r.id, file: opened.file, now: new Date(), importJob: { id, claim: (tx) => h.imports.deps.repo.claimImage(tx, id, r.id, 2) } });
      expect(receipt).toBe("stopped");
    } finally {
      await opened.file.handle.close();
    }
    expect(await rowExists(next)).toBe(false);
    expect(parts()).toEqual([]);
    expect((await job(id)).image_cursor).toBe(2);
    const round = await drive();
    expect(round.leftovers).toBe(2);
    expect(h.imports.deps.plans.has(id)).toBe(false);
    expect(await rowsOf(id)).toEqual([]);
    expect(incoming()).toEqual([]);
    const requested = await h.media.deps.files.deletionRequests();
    for (const media of fed) expect(requested).toContain(media);
  });

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
