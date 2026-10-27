import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, ImportView, type ImportChoice, type ImportedPost } from "@korbat/contracts";
import { MATCH_FIXTURES } from "@korbat/media-protocol";
import { matchAdapterFrom, type TestMatchAdapter } from "../../src/media";
import { ALL, importsHarness, line, type ImportsHarness } from "./imports-harness";
import { suspectItemOn } from "./moderation-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const HOUR = 3_600_000;
/** The archive's date of line n: an hour after the one before, so refs run in the archive's order. */
const hourly = (n: number): string => new Date(Date.UTC(2018, 0, 1) + n * HOUR).toISOString().replace(/[.][0-9]+Z$/, "Z");
/** A PNG on no list of the test matcher: the signature, then bytes of its own. */
const clear = (n: number) => Uint8Array.from([...MATCH_FIXTURES.flag.slice(0, 8), ...Buffer.from(`a png on no list ${n} ${randomUUID()}`)]);
/** A line with one image of its own, described by its source. */
const withImage = (ref: number, over: Partial<ImportedPost> = {}) => line(ref, { at: hourly(ref), media: [{ file: `${ref}-0.png`, alt: `image ${ref}` }], ...over });

/**
 * Undoing an import (3b design, sections 4.6, 6.5, 6.6, 7.5 step 6 and 9.2; decision 22; 12.3's imports-undo.test.ts;
 * Task 6): "Remove imported posts" moves a done import, or a stopped one with posts, to undoing, and import-drive
 * tombstones its posts in batches through the author's own deletion path: body blanked, import columns cleared, counters
 * fixed, images detached unless a case or a freeze keeps them, their files asked for after the commit. A disabled post is
 * left as it is, with its columns, and the import still ends undone. A single imported post deleted from its menu clears
 * its columns too.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: undoing an import", () => {
  let h: ImportsHarness;
  let adapter: TestMatchAdapter;
  beforeAll(async () => {
    adapter = matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" }) as TestMatchAdapter;
    h = await importsHarness({ settings: { maxActive: 100, images: true }, match: adapter });
  });
  afterAll(async () => {
    await h?.close();
  });

  let clock = Date.now();
  /** A round, each a second after the last. */
  const drive = (batches?: { posts?: number; publish?: number; undo?: number }) => h.imports.drive(new Date((clock += 1_000)), { orphans: false, ...(batches ? { batches } : {}) });
  const undo = (b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"], id: string) => b.fetch(`/api/imports/${id}/undo`, { method: "POST" });
  const refusal = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  async function job(id: string) {
    const [row] = await h.migrateDb.execute<{ status: string; posts_published: number; posts_removed: number; ended_at: Date | null }>(
      sql`select status::text as status, posts_published, posts_removed, ended_at from import_jobs where id = ${id}::uuid`,
    );
    return row!;
  }
  /** Every post the import wrote, by the ids its publisher answered (the import's columns are gone from a tombstone). */
  async function rowsOf(ids: readonly string[]) {
    return h.migrateDb.execute<{ id: string; state: string; body: string; job: string | null; source: string | null; original: string | null; shortened: boolean | null; key: string | null; reply_count: number }>(
      sql`select id, state::text as state, body, import_job_id as job, import_source::text as source, original_created_at::text as original, import_shortened as shortened,
                 encode(import_key, 'hex') as key, reply_count from posts where id = any(string_to_array(${ids.join(",")}, ',')::uuid[]) order by created_at, id`,
    );
  }
  const idsOf = async (jobId: string) => (await h.migrateDb.execute<{ id: string }>(sql`select id from posts where import_job_id = ${jobId}::uuid order by created_at, id`)).map((row) => row.id);
  const postCount = async (profileId: string) => (await h.migrateDb.execute<{ n: number }>(sql`select post_count as n from profiles where id = ${profileId}::uuid`))[0]!.n;
  const imagesOf = async (postIds: readonly string[]) =>
    (await h.migrateDb.execute<{ id: string; post_id: string }>(sql`select id, post_id from post_media where post_id = any(string_to_array(${postIds.join(",")}, ',')::uuid[]) order by id`)).map((row) => ({ ...row }));
  /** Rounds until the import is undone; at most `limit`. */
  async function untilUndone(id: string, batches?: { posts?: number; undo?: number }, limit = 50) {
    let rounds = 0;
    while ((await job(id)).status !== "undone" && rounds < limit) {
      await drive(batches);
      rounds++;
    }
    return rounds;
  }

  /**
   * An import of a new account with images (one a line, each described by its source), the worker answering every one
   * as ready and the test matcher clearing it, driven until done: its posts carry their images.
   */
  async function publishedWithImages(lines: readonly ImportedPost[], images: Record<string, Uint8Array>, choice: ImportChoice = { ...ALL, images: true }) {
    const r = await h.ready(lines, { images });
    expect((await h.confirm(r.b, r.view.id, choice)).status).toBe(200);
    for (let round = 0; round < 30 && (await job(r.view.id)).status !== "done"; round++) {
      for (const id of readdirSync(h.media.deps.files.uploads.incoming)) h.worker.ready(id, { width: 8, height: 8 });
      await drive();
    }
    expect((await job(r.view.id)).status).toBe("done");
    return r;
  }

  test("the route: done, or stopped with posts; anything else wrong_state; someone else's not_found; then undoing, and no second undo", async () => {
    const r = await h.ready([line(0, { at: hourly(0) }), line(1, { at: hourly(1) })]);
    const id = r.view.id;
    expect(await refusal(await undo(r.b, id))).toEqual([409, "wrong_state"]);
    expect((await h.confirm(r.b, id)).status).toBe(200);
    expect(await refusal(await undo(r.b, id))).toEqual([409, "wrong_state"]);
    // Stopped before any post: nothing to remove.
    expect((await r.b.fetch(`/api/imports/${id}/stop`, { method: "POST" })).status).toBe(200);
    expect(await refusal(await undo(r.b, id))).toEqual([409, "wrong_state"]);

    const done = await h.published([line(0, { at: hourly(0), text: "first" }), line(1, { at: hourly(1), text: "second" })]);
    const other = await h.signUp();
    expect(await refusal(await undo(other.b, done.view.id))).toEqual([404, "not_found"]);
    expect(done.view.undoable).toBe(true);
    const res = await undo(done.b, done.view.id);
    expect(res.status).toBe(200);
    expect(ImportView.parse(await res.json())).toMatchObject({ status: "undoing", undoable: false, progress: { postsPublished: 2, postsRemoved: 0 } });
    expect(await refusal(await undo(done.b, done.view.id))).toEqual([409, "wrong_state"]);
    await untilUndone(done.view.id);
    const ended = await job(done.view.id);
    expect(ended).toMatchObject({ status: "undone", posts_published: 2, posts_removed: 2 });
    expect(ended.ended_at).not.toBeNull();
    expect(ImportView.parse(await (await done.b.fetch(`/api/imports/${done.view.id}`)).json())).toMatchObject({ status: "undone", undoable: false, progress: { postsRemoved: 2 } });
  });

  test("the undo tombstones every post in batches through the author's path: bodies blanked, columns cleared, every counter fixed, images detached and their files asked for", async () => {
    const lines = [withImage(0, { text: "root" }), line(1, { kind: "thread", parent: 0, at: hourly(1) }), withImage(2), line(3, { at: hourly(3) }), line(4, { kind: "thread", parent: 3, at: hourly(4) })];
    const r = await publishedWithImages(lines, { "0-0.png": clear(0), "2-0.png": clear(2) });
    const posts = await idsOf(r.view.id);
    expect(posts).toHaveLength(5);
    const images = await imagesOf(posts);
    expect(images).toHaveLength(2);
    // Someone else replies to an imported post and likes one: their reply stays, its parent's tombstone too.
    const reader = await h.signUp();
    const answer = await reader.b.fetch("/api/posts", { json: { body: "an answer", replyToId: posts[3] } });
    expect(answer.status).toBe(201);
    expect((await reader.b.fetch(`/api/posts/${posts[2]}/like`, { method: "POST" })).status).toBe(200);
    expect(await postCount(r.id)).toBe(3);

    expect((await undo(r.b, r.view.id)).status).toBe(200);
    // Two posts a batch, one batch a round: three rounds remove them, and a fourth finds none left.
    const first = await drive({ posts: 2, undo: 1 });
    expect(first.postsRemoved).toBe(2);
    expect((await job(r.view.id)).status).toBe("undoing");
    expect(await untilUndone(r.view.id, { posts: 2, undo: 1 })).toBe(3);
    expect(await job(r.view.id)).toMatchObject({ status: "undone", posts_removed: 5 });
    const after = await rowsOf(posts);
    expect(after.map((row) => [row.state, row.body, row.job, row.source, row.original, row.shortened, row.key])).toEqual(Array.from({ length: 5 }, () => ["deleted_by_author", "", null, null, null, null, null]));
    expect(await postCount(r.id)).toBe(0);
    // The images went with their posts, and their files were asked for after the commit.
    expect(await imagesOf(posts)).toEqual([]);
    const requested = await h.media.deps.files.deletionRequests();
    for (const image of images) expect(requested).toContain(image.id);
    // The reader's answer stands; every reader answers the imported posts as deleted.
    expect((await h.app.request(`/api/posts/${posts[0]}`)).status).toBe(404);
    const answered = (await answer.json()) as { id: string };
    expect((await h.app.request(`/api/posts/${answered.id}`)).status).toBe(200);
    expect((await h.app.request(`/api/posts/${posts[3]}`)).status).toBe(404);
    expect(((await (await h.app.request(`/api/profiles/${r.handle}/imported`)).json()) as { items: unknown[] }).items).toEqual([]);
    // Every key is free again: the same archive can be imported once more.
    expect(await h.imports.deps.social.importedKeys(r.id, lines.map((l) => l.key))).toEqual(new Set());
  });

  test("the images of a frozen post and those a case holds stay; the posts are tombstoned all the same and no file of a kept image is asked for", async () => {
    const lines = [withImage(0), withImage(1), withImage(2)];
    const r = await publishedWithImages(lines, { "0-0.png": clear(0), "1-0.png": clear(1), "2-0.png": clear(2) });
    const [frozen, held, free] = (await idsOf(r.view.id)) as [string, string, string];
    const [frozenImage, heldImage, freeImage] = [(await imagesOf([frozen]))[0]!.id, (await imagesOf([held]))[0]!.id, (await imagesOf([free]))[0]!.id];
    // The freeze of 3c's path for suspected child sexual abuse material, by a suspect item on the post.
    await suspectItemOn(h.migrateDb, "post", frozen);
    // A case's hold on one image (hold_until), as a report under the law places it.
    await h.migrateDb.execute(sql`update post_media set hold_until = now() + interval '1 day' where id = ${heldImage}::uuid`);
    try {
      expect((await undo(r.b, r.view.id)).status).toBe(200);
      await untilUndone(r.view.id);
      expect((await rowsOf([frozen, held, free])).map((row) => row.state)).toEqual(["deleted_by_author", "deleted_by_author", "deleted_by_author"]);
      expect((await imagesOf([frozen, held, free])).map((row) => row.id).sort()).toEqual([frozenImage, heldImage].sort());
      const requested = await h.media.deps.files.deletionRequests();
      expect(requested).toContain(freeImage);
      expect(requested).not.toContain(frozenImage);
      expect(requested).not.toContain(heldImage);
    } finally {
      await h.migrateDb.execute(sql`update post_media set hold_until = null where id = ${heldImage}::uuid`);
    }
  });

  test("disabled posts are left as they are, with their columns, and the import still ends undone, with more than a batch of them", async () => {
    const lines = Array.from({ length: 205 }, (_, ref) => line(ref, { at: hourly(ref) }));
    const r = await h.published(lines);
    expect(r.view.status).toBe("done");
    const posts = await idsOf(r.view.id);
    const disabled = posts.slice(0, 201);
    // Disabled for an order, as giving effect writes it (the migrator writes the level and the state).
    await h.migrateDb.execute(sql`update posts set state = 'disabled', moderation_level = 'disabled' where id = any(string_to_array(${disabled.join(",")}, ',')::uuid[])`);
    expect((await undo(r.b, r.view.id)).status).toBe(200);
    expect(await untilUndone(r.view.id)).toBeLessThanOrEqual(2);
    expect(await job(r.view.id)).toMatchObject({ status: "undone", posts_removed: 4 });
    const kept = await rowsOf(disabled);
    expect(kept.every((row) => row.state === "disabled" && row.job === r.view.id && row.source === "mastodon" && row.key !== null)).toBe(true);
    expect((await rowsOf(posts.slice(201))).map((row) => [row.state, row.job])).toEqual(Array.from({ length: 4 }, () => ["deleted_by_author", null]));
  });

  test("a single imported post deleted from its menu clears its columns, and its key is free again", async () => {
    const lines = [line(0, { at: hourly(0) }), line(1, { at: hourly(1) })];
    const r = await h.published(lines);
    const [first, second] = (await idsOf(r.view.id)) as [string, string];
    expect((await r.b.fetch(`/api/posts/${first}`, { method: "DELETE" })).status).toBe(204);
    expect((await rowsOf([first])).map((row) => [row.state, row.body, row.job, row.source, row.original, row.shortened, row.key])).toEqual([["deleted_by_author", "", null, null, null, null, null]]);
    expect(await h.imports.deps.social.importedKeys(r.id, lines.map((l) => l.key))).toEqual(new Set([lines[1]!.key]));
    expect((await rowsOf([second]))[0]!.job).toBe(r.view.id);
    // The undo then removes what is left.
    expect((await undo(r.b, r.view.id)).status).toBe(200);
    await untilUndone(r.view.id);
    expect(await job(r.view.id)).toMatchObject({ status: "undone", posts_published: 2, posts_removed: 1 });
  });

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
