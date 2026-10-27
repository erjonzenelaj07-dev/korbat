import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ExploreStatus, IMPORT_RULES, ImportView, PostPage, PostView, ProfileView, STANDING_RULES, ThreadResponse, TimelinePage, type ImportChoice, type ImportedPost } from "@korbat/contracts";
import { importPostId } from "../../src/imports/plan";
import { caseStanding } from "../../src/moderation/standing";
import { ALL, importsHarness, line, type ImportsHarness } from "./imports-harness";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";

vi.setConfig({ testTimeout: 180_000 });

const HOUR = 3_600_000;
const ELLIPSIS = String.fromCharCode(0x2026);
const NL = String.fromCharCode(10);
/** The archive's date of line n: an hour after the one before, from 2018 on, so refs run in the archive's order. */
const hourly = (n: number): string => new Date(Date.UTC(2018, 0, 1) + n * HOUR).toISOString().replace(/[.][0-9]+Z$/, "Z");
/** A line of the given month (YYYY-MM), on its third day. */
const inMonth = (ref: number, month: string, over: Partial<ImportedPost> = {}) => line(ref, { at: `${month}-03T12:00:00Z`, ...over });
/** A thread line: the account's own reply to its line `parent`. */
const thread = (ref: number, parent: number, over: Partial<ImportedPost> = {}) => line(ref, { kind: "thread", parent, at: hourly(ref), ...over });

/**
 * Publishing an import (3b design, sections 4.5 steps 3 and 4, 6.5, 7.5 step 5, 8.5 and 9.2; 12.3's imports-publish.test.ts;
 * Task 6): after the confirmation, import-drive writes the chosen lines in batches through the social module's batch
 * writer, one transaction each judged by 3e's predicate, with derived ids, the archive's date in original_created_at and
 * korbat's time in created_at; the choice, the picks and the keys already imported decide what is written; the import is
 * done at the end of posts.jsonl. The readers: imported posts are on the Imported tab only, newest archive date first,
 * labelled with the archive's day, and in no feed, Explore, Posts or Replies tab; a repost of one still shows.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: publishing an import", () => {
  let h: ImportsHarness;
  beforeAll(async () => {
    h = await importsHarness({ settings: { maxActive: 100 } });
  });
  afterAll(async () => {
    await h?.close();
  });

  /** A round at `at`, with smaller batches when a test says. */
  const drive = (at: Date, batches?: { posts?: number; publish?: number; undo?: number }) => h.imports.drive(at, { orphans: false, ...(batches ? { batches } : {}) });
  const viewOf = async (b: Awaited<ReturnType<ImportsHarness["ready"]>>["b"], id: string) => ImportView.parse(await (await b.fetch(`/api/imports/${id}`)).json());
  /** The import's row as the migrator reads it. */
  async function job(id: string) {
    const [row] = await h.migrateDb.execute<{ status: string; seed: string | null; post_cursor: number; posts_published: number; stop_reason: string | null; ended_at: Date | null }>(
      sql`select status::text as status, encode(seed, 'hex') as seed, post_cursor, posts_published, stop_reason, ended_at from import_jobs where id = ${id}::uuid`,
    );
    return row!;
  }
  /** The import's posts, oldest korbat time first. */
  async function postsOf(id: string) {
    return h.migrateDb.execute<{ id: string; body: string; reply_to_id: string | null; original: string; shortened: boolean; source: string; key: string; state: string; created_at: string }>(
      sql`select id, body, reply_to_id, to_char(original_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as original, import_shortened as shortened,
                 import_source::text as source, encode(import_key, 'hex') as key, state::text as state, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as created_at
            from posts where import_job_id = ${id}::uuid order by created_at, id`,
    );
  }
  const postCount = async (profileId: string) => (await h.migrateDb.execute<{ n: number }>(sql`select post_count as n from profiles where id = ${profileId}::uuid`))[0]!.n;
  const replyCount = async (postId: string) => (await h.migrateDb.execute<{ n: number }>(sql`select reply_count as n from posts where id = ${postId}::uuid`))[0]!.n;
  /** An import of a new account, ready with these lines and confirmed with the choice: publishing, nothing written yet. */
  async function confirmed(lines: readonly ImportedPost[], choice: ImportChoice = ALL) {
    const r = await h.ready(lines);
    const res = await h.confirm(r.b, r.view.id, choice);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const seed = Buffer.from((await job(r.view.id)).seed!, "hex");
    return { ...r, jobId: r.view.id, seed };
  }

  test("batches of batchPosts with derived ids, oldest first, the cursor and the counts; a repeated batch writes nothing twice; at the end, done with the seed cleared and the work folder asked for", async () => {
    const lines = Array.from({ length: 450 }, (_, ref) => line(ref, { at: hourly(ref) }));
    const r = await confirmed(lines);
    expect((await viewOf(r.b, r.jobId)).progress).toMatchObject({ postsTotal: 450, postsPublished: 0, postsLeft: 450 });
    const first = await drive(new Date(), { publish: 2 });
    expect(first.postsPublished).toBe(2 * IMPORT_RULES.batchPosts);
    expect(await job(r.jobId)).toMatchObject({ status: "publishing", post_cursor: 400, posts_published: 400 });
    const midway = await viewOf(r.b, r.jobId);
    expect(midway.progress).toMatchObject({ postsTotal: 450, postsPublished: 400, postsLeft: 50 });
    expect(midway.paused).toBe(false);
    // The same batch again, at a cursor the import has passed: the job's row is no longer there, and nothing is written.
    const again = await h.imports.deps.social.publishImportedBatch(
      { id: r.jobId, ownerId: r.id, source: "mastodon", cursor: 0 },
      { lines: 1, posts: [{ id: importPostId(r.seed, 0), parentId: null, body: "again", originalCreatedAt: hourly(0), shortened: false, key: lines[0]!.key, images: [] }] },
      new Date(),
    );
    expect(again).toEqual({ written: false });
    expect((await postsOf(r.jobId)).length).toBe(400);

    const second = await drive(new Date(Date.now() + 5_000));
    expect([second.postsPublished, second.done]).toEqual([50, 1]);
    const ended = await job(r.jobId);
    expect(ended).toMatchObject({ status: "done", seed: null, post_cursor: 450, posts_published: 450 });
    expect(ended.ended_at).not.toBeNull();
    expect((await h.imports.deps.files.deletionRequests(Date.now())).map((entry) => entry.id)).toContain(r.jobId);
    const written = await postsOf(r.jobId);
    // Every id derived from the seed and the line's ref; korbat's times in the lines' order; the archive's date kept apart.
    expect(written.map((post) => post.id)).toEqual(lines.map((l) => importPostId(r.seed, l.ref)));
    expect(written.map((post) => post.original)).toEqual(lines.map((l) => l.at));
    expect(written.every((post) => post.source === "mastodon" && post.shortened === false && post.state === "visible" && post.reply_to_id === null)).toBe(true);
    expect(written.map((post) => post.key)).toEqual(lines.map((l) => l.key));
    expect(new Set(written.map((post) => post.created_at)).size).toBe(450);
    expect(await postCount(r.id)).toBe(450);
    const done = await viewOf(r.b, r.jobId);
    expect(done.progress).toMatchObject({ postsTotal: 450, postsPublished: 450, postsLeft: 0 });
    expect(done.undoable).toBe(true);
    // A round after the end writes nothing.
    expect((await drive(new Date(Date.now() + 10_000))).postsPublished).toBe(0);
  });

  test("a thread keeps its order in replies and its counters; a thread line whose parent is left out, or was deleted meanwhile, is written as a post of its own", async () => {
    const lines = [line(0, { at: hourly(0), text: "the root" }), thread(1, 0), thread(2, 0), thread(3, 1), line(4, { at: hourly(4) }), thread(5, 4), line(6, { at: hourly(6) })];
    const r = await h.ready(lines);
    // Line 4 is left out post by post, before the confirmation.
    expect((await r.b.fetch(`/api/imports/${r.view.id}/lines/4`, { method: "PUT", json: { leftOut: true, alts: [] } })).status).toBe(200);
    expect((await h.confirm(r.b, r.view.id)).status).toBe(200);
    const seed = Buffer.from((await job(r.view.id)).seed!, "hex");
    const id = (ref: number) => importPostId(seed, ref);
    await drive(new Date(), { posts: 3, publish: 1 });
    const read = ThreadResponse.parse(await (await h.app.request(`/api/posts/${id(0)}/thread`)).json());
    expect(read.replies.items.map((item) => item.id)).toEqual([id(1), id(2)]);
    expect(read.replies.items.every((item) => item.imported !== null && item.replyTo?.id === id(0))).toBe(true);
    expect(await replyCount(id(0))).toBe(2);
    expect(await postCount(r.id)).toBe(1);
    // The author deletes line 1 from its menu: its import columns go with its tombstone, so line 3 can no longer answer it.
    expect((await r.b.fetch(`/api/posts/${id(1)}`, { method: "DELETE" })).status).toBe(204);
    const [gone] = await h.migrateDb.execute<{ job: string | null; key: string | null; state: string }>(sql`select import_job_id as job, import_key as key, state::text as state from posts where id = ${id(1)}::uuid`);
    expect(gone).toEqual({ job: null, key: null, state: "deleted_by_author" });
    expect(await replyCount(id(0))).toBe(1);
    await drive(new Date(Date.now() + 5_000));
    expect((await job(r.view.id)).status).toBe("done");
    const written = new Map((await postsOf(r.view.id)).map((post) => [post.id, post]));
    expect([...written.keys()].sort()).toEqual([id(0), id(2), id(3), id(5), id(6)].sort());
    expect(written.get(id(3))!.reply_to_id).toBeNull();
    expect(written.get(id(5))!.reply_to_id).toBeNull();
    expect(written.get(id(2))!.reply_to_id).toBe(id(0));
    // The root, 3, 5 and 6 are posts of their own; 2 is a reply. Six were published, the deleted one included.
    expect(await postCount(r.id)).toBe(4);
    expect((await job(r.view.id)).posts_published).toBe(6);
  });

  test("the choice: a range of months, replies to others, long posts cut at a space with their mark, warnings and protected posts", async () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const lines = [
      inMonth(0, "2019-01"),
      inMonth(1, "2019-02", { text: words }),
      inMonth(2, "2019-02", { kind: "reply", text: "an answer to someone else" }),
      inMonth(3, "2019-03", { warning: true, text: `Content warning: spoilers${NL}${NL}the end` }),
      inMonth(4, "2019-03", { protected: true }),
      inMonth(5, "2019-04"),
    ];
    const r = await confirmed(lines, { ...ALL, from: "2019-02", to: "2019-03", replies: true, long: "shorten", protected: true });
    await drive(new Date());
    expect((await job(r.jobId)).status).toBe("done");
    const written = new Map((await postsOf(r.jobId)).map((post) => [post.id, post]));
    expect([...written.keys()].sort()).toEqual([importPostId(r.seed, 1), importPostId(r.seed, 2), importPostId(r.seed, 4)].sort());
    const long = written.get(importPostId(r.seed, 1))!;
    expect(long.shortened).toBe(true);
    expect(long.body.endsWith(ELLIPSIS)).toBe(true);
    expect(Array.from(long.body).length).toBeLessThanOrEqual(IMPORT_RULES.shortenTo);
    // Cut at the last space within the first shortenTo - 1 characters: whole words only, then the ellipsis.
    const kept = long.body.slice(0, -1);
    expect(words.startsWith(kept)).toBe(true);
    expect(words[kept.length]).toBe(" ");
    const view = PostView.parse(await (await h.app.request(`/api/posts/${long.id}`)).json());
    expect(view.imported).toEqual({ source: "mastodon", at: "2019-02-03", shortened: true });
    // A reply to someone else is a post of its own, without the link to what it answered.
    expect(written.get(importPostId(r.seed, 2))!.reply_to_id).toBeNull();
  });

  test("an account younger than 30 days publishes at most newAccountMaxPosts, the newest; and an import of that size is no flood under 3e's count", async () => {
    const extra = 3;
    const lines = Array.from({ length: IMPORT_RULES.newAccountMaxPosts + extra }, (_, ref) => line(ref, { at: hourly(ref) }));
    const r = await confirmed(lines);
    expect(ImportView.parse(await (await r.b.fetch(`/api/imports/${r.jobId}`)).json()).scan).toMatchObject({ fromRef: extra, skipped: { new_account_cap: extra } });
    await drive(new Date());
    expect(await job(r.jobId)).toMatchObject({ status: "done", posts_published: IMPORT_RULES.newAccountMaxPosts, post_cursor: lines.length });
    const written = await postsOf(r.jobId);
    expect(written[0]!.id).toBe(importPostId(r.seed, extra));
    expect(written).toHaveLength(IMPORT_RULES.newAccountMaxPosts);
    // 3e's floor under a finding of a spam flood counts native posts only: a thousand imported posts at once are none.
    expect(IMPORT_RULES.newAccountMaxPosts).toBeGreaterThanOrEqual(STANDING_RULES.floodPosts);
    const standing = await caseStanding(h.apiDb, randomUUID(), r.id);
    expect(standing.flood.posts).toBe(0);
    expect(standing.atOnce).not.toContain("flood");
  });

  test("left-out picks are skipped, and so is a line whose key the account's posts carry by the time its batch is written", async () => {
    const lines = [0, 1, 2, 3].map((ref) => line(ref, { at: hourly(ref) }));
    const r = await h.ready(lines);
    expect((await r.b.fetch(`/api/imports/${r.view.id}/lines/1`, { method: "PUT", json: { leftOut: true, alts: [] } })).status).toBe(200);
    // After the intake: a post of another import of the account's carries line 2's key (the migrator writes both).
    const other = randomUUID();
    await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, status, declared_bytes, received_bytes, ended_at, choice, stated_at, confirmed_at)
                                    values (${other}::uuid, ${r.id}::uuid, 'mastodon', 'done', 10, 10, now(), ${JSON.stringify(ALL)}::jsonb, now(), now())`);
    await h.migrateDb.execute(sql`insert into posts (id, author_id, body, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
                                    values (${randomUUID()}::uuid, ${r.id}::uuid, 'already here', now(), ${other}::uuid, 'mastodon', '2018-01-01T02:00:00Z', false, decode(${lines[2]!.key}, 'hex'))`);
    expect((await h.confirm(r.b, r.view.id)).status).toBe(200);
    const seed = Buffer.from((await job(r.view.id)).seed!, "hex");
    await drive(new Date());
    expect((await postsOf(r.view.id)).map((post) => post.id)).toEqual([importPostId(seed, 0), importPostId(seed, 3)]);
    expect(await job(r.view.id)).toMatchObject({ status: "done", posts_published: 2, post_cursor: 4 });
  });

  test("a suspension makes the next batch wait and the import paused; it goes on once the suspension ends, and stops at the 72-hour bound with its published posts kept", async () => {
    const lines = [0, 1, 2].map((ref) => line(ref, { at: hourly(ref) }));
    const r = await confirmed(lines);
    await suspendRowForTest(h.migrateDb, r.id);
    try {
      const waited = await drive(new Date());
      expect(waited.postsPublished).toBe(0);
      expect(await job(r.jobId)).toMatchObject({ status: "publishing", post_cursor: 0 });
      expect((await viewOf(r.b, r.jobId)).paused).toBe(true);
    } finally {
      await liftRowForTest(h.migrateDb, r.id);
    }
    expect((await viewOf(r.b, r.jobId)).paused).toBe(false);
    await drive(new Date(Date.now() + 5_000));
    expect(await job(r.jobId)).toMatchObject({ status: "done", posts_published: 3 });

    const late = await confirmed(lines.map((l) => line(l.ref, { at: l.at, text: `late ${l.ref}` })));
    await drive(new Date(), { posts: 1, publish: 1 });
    await suspendRowForTest(h.migrateDb, late.id);
    try {
      const stopped = await drive(new Date(Date.now() + (IMPORT_RULES.workHours + 1) * HOUR));
      expect(stopped.stoppedLate).toBe(1);
    } finally {
      await liftRowForTest(h.migrateDb, late.id);
    }
    expect(await job(late.jobId)).toMatchObject({ status: "stopped", stop_reason: "time_ran_out", seed: null, posts_published: 1 });
    expect((await postsOf(late.jobId)).map((post) => post.state)).toEqual(["visible"]);
    const view = await viewOf(late.b, late.jobId);
    expect([view.paused, view.progress.postsLeft, view.undoable]).toEqual([false, 0, true]);
  });

  test("the readers: in no feed, Explore, Posts or Replies tab; on the Imported tab, newest archive date first, with the archive's day; a repost still shows; a disabled one is missing", async () => {
    const lines = [line(0, { at: "2019-01-05T08:00:00Z" }), line(1, { at: "2019-03-07T23:59:59Z" }), thread(2, 0, { at: "2019-03-08T00:00:00Z" }), line(3, { at: "2019-06-01T00:00:00Z" })];
    const r = await h.published(lines);
    expect(r.view.status).toBe("done");
    const [first, second, reply, last] = (await postsOf(r.view.id)).map((post) => post.id) as [string, string, string, string];
    const reader = await h.signUp();
    expect((await reader.b.fetch(`/api/profiles/${r.handle}/follow`, { method: "POST" })).status).toBe(200);
    const ids = (page: { items: { post?: { id: string }; id?: string }[] }) => page.items.map((item) => item.post?.id ?? item.id);
    const imported = new Set([first, second, reply, last]);
    const none = (found: (string | undefined)[]) => expect(found.filter((id) => id !== undefined && imported.has(id))).toEqual([]);
    none(ids(TimelinePage.parse(await (await reader.b.fetch("/api/timeline/following?limit=50")).json())));
    none(ids(TimelinePage.parse(await (await r.b.fetch("/api/timeline/following?limit=50")).json())));
    none(ids(TimelinePage.parse(await (await h.app.request("/api/timeline/latest?limit=50")).json())));
    none(ids(TimelinePage.parse(await (await h.app.request(`/api/profiles/${r.handle}/posts?limit=50`)).json())));
    none(ids(PostPage.parse(await (await h.app.request(`/api/profiles/${r.handle}/replies?limit=50`)).json())));
    // The author's own status: an imported post is out of Explore for that reason alone.
    expect(ExploreStatus.parse(await (await r.b.fetch(`/api/posts/${second}/explore`)).json()).status).toBe("imported");

    // The Imported tab: top-level posts only, by the archive's date, newest first, each labelled with its day; signed out too.
    const tab = PostPage.parse(await (await h.app.request(`/api/profiles/${r.handle}/imported`)).json());
    expect(tab.items.map((item) => item.id)).toEqual([last, second, first]);
    expect(tab.items.map((item) => item.imported)).toEqual([
      { source: "mastodon", at: "2019-06-01", shortened: false },
      { source: "mastodon", at: "2019-03-07", shortened: false },
      { source: "mastodon", at: "2019-01-05", shortened: false },
    ]);
    // Pages by the archive's date.
    const one = PostPage.parse(await (await h.app.request(`/api/profiles/${r.handle}/imported?limit=2`)).json());
    expect(one.items.map((item) => item.id)).toEqual([last, second]);
    const two = PostPage.parse(await (await h.app.request(`/api/profiles/${r.handle}/imported?limit=2&cursor=${encodeURIComponent(one.nextCursor!)}`)).json());
    expect(two.items.map((item) => item.id)).toEqual([first]);
    expect(ProfileView.parse(await (await h.app.request(`/api/profiles/${r.handle}`)).json()).hasImported).toBe(true);
    expect(ProfileView.parse(await (await h.app.request(`/api/profiles/${reader.handle}`)).json()).hasImported).toBe(false);
    // A reply of the thread is on the post's page, with the label.
    const page = ThreadResponse.parse(await (await h.app.request(`/api/posts/${first}/thread`)).json());
    expect(page.replies.items.map((item) => [item.id, item.imported?.at])).toEqual([[reply, "2019-03-08"]]);

    // A repost is one deliberate act: it reaches the reposter's followers and the reposter's Posts tab.
    await h.age(reader.id, 8);
    expect((await reader.b.fetch(`/api/posts/${second}/repost`, { method: "POST" })).status).toBe(200);
    const follower = await h.signUp();
    expect((await follower.b.fetch(`/api/profiles/${reader.handle}/follow`, { method: "POST" })).status).toBe(200);
    const feed = TimelinePage.parse(await (await follower.b.fetch("/api/timeline/following?limit=50")).json());
    expect(feed.items.filter((item) => item.kind === "repost").map((item) => [item.post.id, item.post.imported?.at])).toEqual([[second, "2019-03-07"]]);
    const reposts = TimelinePage.parse(await (await h.app.request(`/api/profiles/${reader.handle}/posts`)).json());
    expect(reposts.items.map((item) => item.post.id)).toEqual([second]);

    // Disabled for an order (the migrator writes the level, as giving effect does): missing on every path, the author's too.
    await h.migrateDb.execute(sql`update posts set state = 'disabled', moderation_level = 'disabled' where id = ${first}::uuid`);
    try {
      expect((await h.app.request(`/api/posts/${first}`)).status).toBe(404);
      expect((await r.b.fetch(`/api/posts/${first}`)).status).toBe(404);
      const after = PostPage.parse(await (await r.b.fetch(`/api/profiles/${r.handle}/imported`)).json());
      expect(after.items.map((item) => item.id)).toEqual([last, second]);
    } finally {
      await h.migrateDb.execute(sql`update posts set state = 'visible', moderation_level = 'visible' where id = ${first}::uuid`);
    }
  });

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
