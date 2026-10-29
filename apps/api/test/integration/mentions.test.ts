import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MENTION_STORE_MAX, PostView } from "@korbat/contracts";
import { profiles, type Db } from "@korbat/db";
import { createSocialRepo } from "../../src/social/repo";
import { activityHarness, type ActivityHarness, type Member } from "./activity-harness";
import { gate, hex64, retireHandleForTest, untilBlocked } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

// Every test signs accounts up over HTTP, and one holds a purge open while a post waits for its lock.
vi.setConfig({ testTimeout: 180_000 });

/**
 * Mentions as data (2d design, sections 4.2 to 4.4; section 12.3): a handle typed in a post is stored with the account that
 * holds it at that moment and links, for each reader, only while that account still holds the handle and no block stands
 * between the reader and it; it is stored whatever blocks exist, and notifies under 5.2's rules. An imported post's text
 * is never read; a deletion, an erasure and a purge take the rows with them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: mentions as data", () => {
  let h: ActivityHarness;

  beforeAll(async () => {
    h = await activityHarness();
  }, 120_000);
  afterAll(async () => {
    await h?.close();
  }, 120_000);

  const signUp = () => h.signUp();
  /** A post's stored mentions as the migrator reads them: the account, the handle as written and the place. */
  const stored = async (postId: string) =>
    (
      await h.migrateDb.execute<{ account_id: string; handle: string; position: number }>(
        sql`select account_id, handle, position from post_mentions where post_id = ${postId}::uuid order by position`,
      )
    ).map((row) => ({ account: row.account_id, handle: row.handle, position: row.position }));
  /** The post as `reader` reads it (signed out without one), or its status when it is not shown. */
  const read = async (postId: string, reader?: Member): Promise<PostView | number> => {
    const res = reader ? await reader.b.fetch(`/api/posts/${postId}`) : await h.app.request(`/api/posts/${postId}`);
    return res.status === 200 ? PostView.parse(await res.json()) : res.status;
  };
  const mentionsFor = async (postId: string, reader?: Member) => {
    const view = await read(postId, reader);
    if (typeof view === "number") throw new Error(`the post answered ${view}`);
    return view.mentions;
  };
  /** A live profile that holds exactly this handle, as only a test makes one. */
  const profileWithHandle = async (handle: string): Promise<string> => {
    const id = randomUUID();
    await (h.apiDb as Db).insert(profiles).values({ id, handle, displayName: `Profile ${handle}` });
    h.made.push(id);
    return id;
  };

  test("a stored mention links while its account holds the handle as written; after a rename and after a retirement it is plain text, and the entry already written stays", async () => {
    const [ada, bob, cat] = [await signUp(), await signUp(), await signUp()];
    const post = await h.post(ada, `thanks @${bob.handle} and @${cat.handle}`);
    expect(post.mentions).toEqual([bob.handle, cat.handle]);
    expect(await stored(post.id)).toEqual([
      { account: bob.id, handle: bob.handle, position: 0 },
      { account: cat.id, handle: cat.handle, position: 1 },
    ]);
    // Signed out, every live mention whose handle is unchanged.
    expect(await mentionsFor(post.id)).toEqual([bob.handle, cat.handle]);
    const renamed = `r${randomBytes(5).toString("hex")}`;
    expect(await createSocialRepo(h.apiDb).changeHandle(bob.id, renamed, new Date())).toEqual({ ok: true, from: bob.handle });
    await retireHandleForTest(h.migrateDb, cat.id);
    for (const reader of [undefined, ada, bob, cat]) expect(await mentionsFor(post.id, reader)).toEqual([]);
    // Nothing stored changed: the account by id and the handle as written; the entries stay.
    expect(await stored(post.id)).toEqual([
      { account: bob.id, handle: bob.handle, position: 0 },
      { account: cat.id, handle: cat.handle, position: 1 },
    ]);
    expect(await h.stored(bob.id)).toEqual([{ kind: "mention", actor: ada.id, post: post.id }]);
    expect(await h.stored(cat.id)).toEqual([{ kind: "mention", actor: ada.id, post: post.id }]);
    // The post's text is never rewritten.
    expect((await read(post.id, ada)) as PostView).toMatchObject({ body: `thanks @${bob.handle} and @${cat.handle}` });
  });

  test("a handle nobody held when the post was written stores nothing, and links nothing once an account claims it", async () => {
    const ada = await signUp();
    const free = `f${randomBytes(5).toString("hex")}`;
    const post = await h.post(ada, `hello @${free}`);
    expect(post.mentions).toEqual([]);
    expect(await stored(post.id)).toEqual([]);
    const claimant = await profileWithHandle(free);
    expect(await mentionsFor(post.id)).toEqual([]);
    expect(await h.stored(claimant)).toEqual([]);
  });

  test("a mention of an account that blocks the author, or that the author blocks, is stored and links for a third reader, is plain text for the author and writes no entry; a reader who blocks the mentioned account reads it plain", async () => {
    const [ada, bob, cat, reader] = [await signUp(), await signUp(), await signUp(), await signUp()];
    expect(await h.relate(bob, ada, "block")).toBe(200);
    expect(await h.relate(ada, cat, "block")).toBe(200);
    const post = await h.post(ada, `@${bob.handle} and @${cat.handle}`);
    expect((await stored(post.id)).map((row) => row.account)).toEqual([bob.id, cat.id]);
    expect(await mentionsFor(post.id, reader)).toEqual([bob.handle, cat.handle]);
    expect(await mentionsFor(post.id)).toEqual([bob.handle, cat.handle]);
    // The author reads both plain; the two blocked accounts are not shown the post at all.
    expect(post.mentions).toEqual([]);
    expect(await mentionsFor(post.id, ada)).toEqual([]);
    expect(await read(post.id, bob)).toBe(404);
    expect(await read(post.id, cat)).toBe(404);
    expect(await h.stored(bob.id)).toEqual([]);
    expect(await h.stored(cat.id)).toEqual([]);
    // A reader who blocks one of them reads that one plain and the other as a link.
    expect(await h.relate(reader, cat, "block")).toBe(200);
    expect(await mentionsFor(post.id, reader)).toEqual([bob.handle]);
  });

  test("the first twenty live handles are stored, in text order, each once whatever its case; the rest stay plain text", async () => {
    const ada = await signUp();
    const named: { id: string; handle: string }[] = [];
    for (let n = 0; n < MENTION_STORE_MAX + 2; n++) {
      const profile = await newProfile(h.apiDb);
      h.made.push(profile.id);
      named.push(profile);
    }
    const body = `@${named[0]!.handle.toUpperCase()} ${named.map((p) => `@${p.handle}`).join(" ")}`;
    const post = await h.post(ada, body);
    const kept = named.slice(0, MENTION_STORE_MAX);
    expect(await stored(post.id)).toEqual(kept.map((p, position) => ({ account: p.id, handle: p.handle, position })));
    expect(post.mentions).toEqual(kept.map((p) => p.handle));
    // The last two are neither stored nor told.
    for (const p of named.slice(MENTION_STORE_MAX)) expect(await h.stored(p.id)).toEqual([]);
  });

  test("an imported post (3b's publishImportedBatch) stores no mention and tells no one, whatever handles its text holds", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const jobId = randomUUID();
    await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, status, declared_bytes) values (${jobId}::uuid, ${ada.id}::uuid, 'x', 'publishing', 1000)`);
    const postId = randomUUID();
    const result = await createSocialRepo(h.apiDb).publishImportedBatch(
      { id: jobId, ownerId: ada.id, source: "x", cursor: 0 },
      { lines: 1, posts: [{ id: postId, parentId: null, body: `an imported post that names @${bob.handle}`, originalCreatedAt: "2019-03-03T12:00:00Z", shortened: false, key: hex64(), images: [] }] },
      new Date(),
      async () => undefined,
    );
    expect(result).toEqual({ written: true, posts: [{ id: postId, images: false }] });
    expect(await stored(postId)).toEqual([]);
    expect(await h.stored(bob.id)).toEqual([]);
    const view = (await read(postId, bob)) as PostView;
    expect(view.imported).toMatchObject({ source: "x" });
    expect(view.mentions).toEqual([]);
  });

  test("a deletion by the author and an erasure remove a post's mentions; the deletion its entries too", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const [deleted, erased] = [await h.post(ada, `@${bob.handle} one`), await h.post(ada, `@${bob.handle} two`)];
    expect((await stored(deleted.id)).length).toBe(1);
    expect((await h.stored(bob.id)).length).toBe(2);
    expect((await ada.b.fetch(`/api/posts/${deleted.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await stored(deleted.id)).toEqual([]);
    expect(await h.stored(bob.id)).toEqual([{ kind: "mention", actor: ada.id, post: erased.id }]);
    // An erasure, as 3c's R4 redaction leaves a post: the body blanked and the post removed (post_mentions_erase).
    await h.migrateDb.execute(sql`update posts set erased_at = now(), body = '', state = 'removed', moderation_level = 'removed' where id = ${erased.id}::uuid`);
    expect(await stored(erased.id)).toEqual([]);
    expect((await h.page(bob)).items).toEqual([]);
  });

  test("a mentioned account purged while the post waits for its row leaves no mention and no entry: the post's lookup reads the row again after the purge and drops it", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const target = await newProfile(h.apiDb);
    h.made.push(target.id);
    const held = gate();
    const repo = createSocialRepo(h.apiDb);
    // The purge holds the account's row FOR UPDATE until the test lets it commit.
    const purging = repo.purgeProfile(target.id, new Date(), async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await held.opened;
    });
    let posting: Promise<PostView> | null = null;
    try {
      // Bob's post names the account; its lookup waits at the row the purge holds.
      posting = h.post(bob, `hello @${target.handle} and @${ada.handle}`);
      await untilBlocked(h.apiDb, "and deleted_at is null order by id for key share");
    } finally {
      held.open();
    }
    await purging;
    const post = await posting!;
    expect(post.mentions).toEqual([ada.handle]);
    expect((await stored(post.id)).map((row) => row.account)).toEqual([ada.id]);
    expect(await h.stored(target.id)).toEqual([]);
    expect(await h.stored(ada.id)).toEqual([{ kind: "mention", actor: bob.id, post: post.id }]);
  });

  test("this file left no row behind: the accounts it made go with what hangs on them, and 2d's tables hold what they held before it", async () => {
    await h.removeMade();
    expect(await h.counts()).toEqual(h.before);
  });
});
