import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTIVITY_DEFAULTS, ACTIVITY_NEWER_CAP, ActivityNewerResponse, ActivitySettings } from "@korbat/contracts";
import { activityPage } from "../../src/activity/flows";
import { activityHarness, type ActivityHarness, type Member } from "./activity-harness";
import { decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";

// Every test signs accounts up over HTTP and some decide on posts with a real staff key: slow on a loaded machine.
vi.setConfig({ testTimeout: 180_000 });

const DAY_MS = 86_400_000;

/**
 * Activity over HTTP (2d design, sections 5.1 to 5.8 and 9.2; section 12.3): each kind written by its act and read on the
 * recipient's list, under the recipient's rules, hidden and shown again as the facts after the act change, grouped by UTC
 * day for follows, with the seen marker, `new` and the newer count. The real app, with every module Activity reads.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Activity over HTTP", () => {
  let h: ActivityHarness;

  beforeAll(async () => {
    h = await activityHarness();
  }, 120_000);
  afterAll(async () => {
    await h?.close();
  }, 120_000);

  const signUp = (hours?: number) => h.signUp(hours);
  const newer = async (m: Member, query = "") => {
    const res = await m.b.fetch(`/api/activity/newer${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ActivityNewerResponse.parse(await res.json()).count;
  };

  test("each kind is written by its act and read on the recipient's list: a reply, a quote, a mention and a follow; a reply that names its parent's author is one reply entry, and the thread's root is not told", async () => {
    const [ada, bob, cat] = [await signUp(), await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const reply = await h.post(bob, `a reply that also names @${ada.handle}`, { replyToId: root.id });
    const quote = await h.post(bob, "a quote", { quoteOfId: root.id });
    const mention = await h.post(bob, `hello @${ada.handle.toUpperCase()}, and @${cat.handle}`);
    expect(await h.relate(bob, ada, "follow")).toBe(200);
    // Cat answers Bob's reply: Bob is told, Ada (the thread's root) is not.
    const deeper = await h.post(cat, "a reply to the reply", { replyToId: reply.id });

    const page = await h.page(ada);
    const day = new Date().toISOString().slice(0, 10);
    expect(h.summary(page.items)).toEqual([`follows:${day}:1:${bob.handle}`, `mention:${mention.id}`, `quote:${quote.id}`, `reply:${reply.id}`]);
    expect(await h.stored(ada.id)).toEqual([
      { kind: "reply", actor: bob.id, post: reply.id },
      { kind: "quote", actor: bob.id, post: quote.id },
      { kind: "mention", actor: bob.id, post: mention.id },
      { kind: "follow", actor: bob.id, post: null },
    ]);
    // A post entry carries the post's view, with its mentions that link for the reader; a group its accounts.
    const mentioned = page.items.find((entry) => entry.type === "post" && entry.kind === "mention");
    expect(mentioned?.type === "post" && mentioned.post.mentions).toEqual([ada.handle, cat.handle]);
    expect(page.items[0]).toMatchObject({ type: "follows", key: `f:${day}`, count: 1, actors: [{ id: bob.id, handle: bob.handle }], new: true });
    expect(page.seenAt).toBeNull();
    expect(page.nextCursor).toBeNull();
    // Times are the database's, to the microsecond, newest first.
    expect(page.items.every((entry, n) => n === 0 || entry.at <= page.items[n - 1]!.at)).toBe(true);
    // Conversations keeps replies, mentions and quotes.
    expect(h.summary((await h.page(ada, { tab: "conversations" })).items)).toEqual([`mention:${mention.id}`, `quote:${quote.id}`, `reply:${reply.id}`]);
    expect(h.summary((await h.page(bob)).items)).toEqual([`reply:${deeper.id}`]);
    expect(h.summary((await h.page(cat)).items)).toEqual([`mention:${mention.id}`]);
  });

  test("the first ten mentions are told, the author and the accounts already told of the post not counted; every live handle up to twenty is stored", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await h.post(ada, "a post to answer");
    // Twelve accounts that never sign in: a mention needs only a live profile.
    const named: { id: string; handle: string }[] = [];
    for (let n = 0; n < 12; n++) {
      const profile = await newProfile(h.apiDb);
      h.made.push(profile.id);
      named.push(profile);
    }
    // The author, the parent's author and a handle nobody holds come first; then the twelve.
    const body = `@${bob.handle} @${ada.handle} @nobody_${Date.now() % 1_000_000} ${named.map((p) => `@${p.handle}`).join(" ")}`;
    const reply = await h.post(bob, body, { replyToId: root.id });
    expect(reply.mentions).toEqual([bob.handle, ada.handle, ...named.map((p) => p.handle)]);
    // Ada is told once, of the reply; the first ten of the twelve of a mention; the last two of nothing; Bob of nothing.
    expect(await h.stored(ada.id)).toEqual([{ kind: "reply", actor: bob.id, post: reply.id }]);
    for (const [n, profile] of named.entries()) expect(await h.stored(profile.id), `mention ${n + 1}`).toEqual(n < 10 ? [{ kind: "mention", actor: bob.id, post: reply.id }] : []);
    expect(await h.stored(bob.id)).toEqual([]);
  });

  test("the recipient's rules: Everyone, Accounts older than 2 days (47 hours refused, 49 passed), Accounts you follow and Off for replies, mentions and quotes, and the follow switch; a rule applies to new acts only", async () => {
    const ada = await signUp();
    const [young, older, stranger, friend, quoter, follower, later] = [await signUp(47), await signUp(49), await signUp(), await signUp(), await signUp(), await signUp(), await signUp()];
    expect(await h.settings(ada, { replies: "older", mentions: "following", quotes: "off", follows: false })).toEqual({ replies: "older", mentions: "following", quotes: "off", follows: false });
    const root = await h.post(ada, "a post of ada's");
    const fromYoung = await h.post(young, "a reply from a new account", { replyToId: root.id });
    const fromOlder = await h.post(older, "a reply from an older one", { replyToId: root.id });
    expect(await h.relate(ada, friend, "follow")).toBe(200);
    const fromStranger = await h.post(stranger, `hello @${ada.handle}`);
    const fromFriend = await h.post(friend, `hello @${ada.handle}`);
    const quoted = await h.post(quoter, "a quote", { quoteOfId: root.id });
    expect(await h.relate(follower, ada, "follow")).toBe(200);
    expect(h.summary((await h.page(ada)).items)).toEqual([`mention:${fromFriend.id}`, `reply:${fromOlder.id}`]);
    // A changed rule brings nothing back, and lets the next act in.
    await h.settings(ada, { replies: "everyone", mentions: "everyone", quotes: "everyone", follows: true });
    expect(await h.relate(later, ada, "follow")).toBe(200);
    const day = new Date().toISOString().slice(0, 10);
    expect(h.summary((await h.page(ada)).items)).toEqual([`follows:${day}:1:${later.handle}`, `mention:${fromFriend.id}`, `reply:${fromOlder.id}`]);
    const stored = (await h.stored(ada.id)).map((row) => row.post);
    for (const post of [fromYoung.id, fromStranger.id, quoted.id]) expect(stored).not.toContain(post);
    // The rules as read back, and the defaults for an account that never changed them.
    expect(ActivitySettings.parse(await (await ada.b.fetch("/api/activity/settings")).json())).toEqual(ACTIVITY_DEFAULTS);
    expect(ActivitySettings.parse(await (await young.b.fetch("/api/activity/settings")).json())).toEqual(ACTIVITY_DEFAULTS);
    for (const bad of [{ ...ACTIVITY_DEFAULTS, replies: "friends" }, { ...ACTIVITY_DEFAULTS, follows: "yes" }, { replies: "everyone" }]) {
      const res = await ada.b.fetch("/api/activity/settings", { method: "PUT", json: bad });
      expect(res.status).toBe(400);
      expect(await h.code(res)).toBe("invalid_request");
    }
  });

  test("a mute writes no new entry and hides the old ones while it stands; an unmute shows them again", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const first = await h.post(bob, "a first reply", { replyToId: root.id });
    expect(await h.relate(ada, bob, "mute")).toBe(200);
    expect((await h.page(ada)).items).toEqual([]);
    const second = await h.post(bob, "a second reply", { replyToId: root.id });
    expect(await h.relate(ada, bob, "mute", false)).toBe(200);
    expect(h.summary((await h.page(ada)).items)).toEqual([`reply:${first.id}`]);
    expect((await h.stored(ada.id)).map((row) => row.post)).toEqual([first.id]);
    expect(second.replyTo?.id).toBe(root.id);
  });

  test("a block either way deletes the pair's entries both ways; an entry a mention wrote while the block was made is hidden while it stands, and shown after an unblock", async () => {
    const [ada, bob, cat] = [await signUp(), await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    await h.post(bob, "a reply", { replyToId: root.id });
    await h.post(ada, `hello @${bob.handle}`);
    await h.post(cat, `hello @${ada.handle}`);
    await h.post(ada, `hello @${cat.handle}`);
    expect((await h.stored(ada.id)).length).toBe(2);
    // Ada blocks Bob: both of their entries go. Cat blocks Ada: theirs go too.
    expect(await h.relate(ada, bob, "block")).toBe(200);
    expect(await h.relate(cat, ada, "block")).toBe(200);
    expect(await h.stored(ada.id)).toEqual([]);
    expect(await h.stored(bob.id)).toEqual([]);
    expect(await h.stored(cat.id)).toEqual([]);

    // 5.6's race: a mention takes no pair lock, so its entry can commit after the block's deletion. The block is written
    // here after the entry, as the migrator, so the entry stays: the list hides it while the block stands.
    const [dan, eve] = [await signUp(), await signUp()];
    const named = await h.post(eve, `hello @${dan.handle}`);
    await h.migrateDb.execute(sql`insert into blocks (blocker_id, blocked_id, created_at) values (${eve.id}::uuid, ${dan.id}::uuid, now())`);
    expect((await h.page(dan)).items).toEqual([]);
    expect((await h.stored(dan.id)).map((row) => row.post)).toEqual([named.id]);
    await h.migrateDb.execute(sql`delete from blocks where blocker_id = ${eve.id}::uuid and blocked_id = ${dan.id}::uuid`);
    expect(h.summary((await h.page(dan)).items)).toEqual([`mention:${named.id}`]);
  });

  test("an unfollow hides the follow's entry, and a follow again writes none: the first one shows again, with its time", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    expect(await h.relate(bob, ada, "follow")).toBe(200);
    const [first] = (await h.page(ada)).items;
    expect(first).toMatchObject({ type: "follows", count: 1 });
    expect(await h.relate(bob, ada, "follow", false)).toBe(200);
    expect((await h.page(ada)).items).toEqual([]);
    expect(await h.relate(bob, ada, "follow")).toBe(200);
    const [again] = (await h.page(ada)).items;
    expect(again).toEqual(first);
    expect(await h.stored(ada.id)).toEqual([{ kind: "follow", actor: bob.id, post: null }]);
  });

  test("a withheld reply is hidden and shown again once restored; a removed and a disabled one are hidden; one its author deletes is gone", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const [withheld, removed, disabled, deleted] = [
      await h.post(bob, "a reply withheld for a while", { replyToId: root.id }),
      await h.post(bob, "a reply removed", { replyToId: root.id }),
      await h.post(bob, "a reply disabled for an order", { replyToId: root.id }),
      await h.post(bob, "a reply its author deletes", { replyToId: root.id }),
    ];
    await decideForTest(h.apiDb, withheld.id, "withheld");
    await decideForTest(h.apiDb, removed.id, "removed");
    // An order's disabling, as the migrator writes the post's state (posts_guard lets only it).
    await h.migrateDb.execute(sql`update posts set state = 'disabled', moderation_level = 'disabled' where id = ${disabled.id}::uuid`);
    expect((await bob.b.fetch(`/api/posts/${deleted.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await h.page(ada)).items).toEqual([]);
    // The deleted reply's entry went with it; the others stay, hidden.
    expect((await h.stored(ada.id)).map((row) => row.post)).toEqual([withheld.id, removed.id, disabled.id]);
    await decideForTest(h.apiDb, withheld.id, "visible");
    expect(h.summary((await h.page(ada)).items)).toEqual([`reply:${withheld.id}`]);
  });

  test("a suspended actor's earlier entries stay, with no label, and its new acts are refused; a suspended recipient still receives entries and reads its list", async () => {
    const [ada, bob, cat] = [await signUp(), await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const earlier = await h.post(bob, "a reply before the suspension", { replyToId: root.id });
    await suspendRowForTest(h.migrateDb, bob.id);
    try {
      expect(h.summary((await h.page(ada)).items)).toEqual([`reply:${earlier.id}`]);
      const refused = await bob.b.fetch("/api/posts", { json: { body: "a reply while suspended", replyToId: root.id } });
      expect(refused.status).toBe(403);
      expect(await h.code(refused)).toBe("account_suspended");
      expect((await bob.b.fetch(`/api/profiles/${ada.handle}/follow`, { method: "POST" })).status).toBe(403);
      expect((await h.stored(ada.id)).length).toBe(1);
    } finally {
      await liftRowForTest(h.migrateDb, bob.id);
    }
    await suspendRowForTest(h.migrateDb, ada.id);
    try {
      const later = await h.post(cat, "a reply to a suspended account", { replyToId: root.id });
      expect(h.summary((await h.page(ada)).items)).toEqual([`reply:${later.id}`, `reply:${earlier.id}`]);
    } finally {
      await liftRowForTest(h.migrateDb, ada.id);
    }
  });

  test("follows are grouped by UTC day, at the newest follow, with the count and the three newest; a page boundary inside a day leaves one group", async () => {
    const ada = await signUp();
    const followers = [await signUp(), await signUp(), await signUp(), await signUp(), await signUp()];
    const replier = await signUp();
    for (const f of followers) expect(await h.relate(f, ada, "follow")).toBe(200);
    const root = await h.post(ada, "a post of ada's");
    const reply = await h.post(replier, "a reply", { replyToId: root.id });
    // Dated as the migrator, which activity_items_insert lets write a time: four follows and the reply on one UTC day three
    // days ago, the reply between them, and one follow the day before.
    const d1 = new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10);
    const d0 = new Date(Date.now() - 4 * DAY_MS).toISOString().slice(0, 10);
    const times: [string, string][] = [
      [followers[0]!.id, `${d1}T08:00:00.000001Z`],
      [followers[1]!.id, `${d1}T09:00:00.000002Z`],
      [followers[2]!.id, `${d1}T12:00:00.000003Z`],
      [followers[3]!.id, `${d1}T23:59:59.999999Z`],
      [followers[4]!.id, `${d0}T09:00:00.000000Z`],
    ];
    for (const [actor, at] of times) await h.migrateDb.execute(sql`update activity_items set created_at = ${at}::timestamptz where recipient_id = ${ada.id}::uuid and actor_id = ${actor}::uuid`);
    await h.migrateDb.execute(sql`update activity_items set created_at = ${`${d1}T11:00:00.000000Z`}::timestamptz where post_id = ${reply.id}::uuid`);
    const group = `follows:${d1}:4:${[followers[3], followers[2], followers[1]].map((f) => f!.handle).join(",")}`;
    const expected = [group, `reply:${reply.id}`, `follows:${d0}:1:${followers[4]!.handle}`];
    expect(h.summary(await h.all(ada))).toEqual(expected);
    const [first] = (await h.page(ada)).items;
    expect(first).toMatchObject({ key: `f:${d1}`, at: `${d1}T23:59:59.999999Z`, count: 4 });
    // A page of one: the group, then the reply that falls between its follows, then the other day; the group once.
    const onePerPage = { ...h.activity.deps, pageSize: 1 };
    const pages: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 5; n++) {
      const got = await activityPage(onePerPage, ada.id, { tab: "all", cursor });
      pages.push(...h.summary(got.items));
      if (got.nextCursor === null) break;
      cursor = got.nextCursor;
    }
    expect(pages).toEqual(expected);
  });

  test("the seen marker moves only forward and never past the clock; `new` reads the stored marker; the newer count counts as the list draws and stops at 21", async () => {
    const [ada, bob] = [await signUp(), await signUp()];
    const root = await h.post(ada, "a post of ada's");
    const first = await h.post(bob, "a first reply", { replyToId: root.id });
    const second = await h.post(bob, "a second reply", { replyToId: root.id });
    const opened = await h.page(ada);
    expect(opened.seenAt).toBeNull();
    expect(opened.items.map((entry) => entry.new)).toEqual([true, true]);
    const [atSecond, atFirst] = opened.items.map((entry) => entry.at) as [string, string];
    expect(h.summary(opened.items)).toEqual([`reply:${second.id}`, `reply:${first.id}`]);
    const seen = (at: string) => ada.b.fetch("/api/activity/seen", { json: { at } });
    expect((await seen(atFirst)).status).toBe(204);
    const afterFirst = await h.page(ada);
    expect(afterFirst.seenAt).toBe(atFirst);
    expect(afterFirst.items.map((entry) => entry.new)).toEqual([true, false]);
    // An older marker, as another device sends it, changes nothing.
    expect((await seen("2001-01-01T00:00:00.000000Z")).status).toBe(204);
    expect((await h.page(ada)).seenAt).toBe(atFirst);
    // A marker ahead of the server's clock stops at the clock.
    expect((await seen("2100-01-01T00:00:00.000000Z")).status).toBe(204);
    const ahead = await h.page(ada);
    expect(ahead.seenAt! > atSecond && ahead.seenAt! < "2100").toBe(true);
    expect(ahead.items.map((entry) => entry.new)).toEqual([false, false]);
    // Only an ActivityTime: a time to the millisecond is not one.
    for (const at of ["2026-10-28T10:00:00.000Z", "yesterday"]) expect((await seen(at)).status).toBe(400);

    expect(await newer(ada)).toBe(2);
    expect(await newer(ada, `?since=${encodeURIComponent(atSecond)}`)).toBe(0);
    expect(await newer(ada, `?since=${encodeURIComponent(atFirst)}`)).toBe(1);
    for (let n = 0; n < ACTIVITY_NEWER_CAP + 1; n++) await h.post(bob, `reply ${n}`, { replyToId: root.id });
    expect(await newer(ada, `?since=${encodeURIComponent(atSecond)}`)).toBe(ACTIVITY_NEWER_CAP);
    expect(await newer(ada, "?tab=conversations")).toBe(ACTIVITY_NEWER_CAP);
    for (const query of ["?since=2026-10-28T10:00:00Z", "?tab=likes"]) expect((await ada.b.fetch(`/api/activity/newer${query}`)).status).toBe(400);
    // A page's cursor is only what the list wrote.
    for (const query of ["?cursor=nonsense", "?tab=likes"]) {
      const res = await ada.b.fetch(`/api/activity${query}`);
      expect(res.status, query).toBe(400);
      expect(await h.code(res)).toBe("invalid_request");
    }
    // Signed out, nothing.
    expect((await h.app.request("/api/activity")).status).toBe(401);
  });

  leavesNoModerationRows(() => h.apiDb);

  test("this file left no row behind: the accounts it made go with what hangs on them, and 2d's tables hold what they held before it", async () => {
    await h.removeMade();
    expect(await h.counts()).toEqual(h.before);
  });
});
