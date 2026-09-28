# korbat explore (2c) — Task 5 of 6: What the review of 2c upheld, fixed: a cursor before any ranking, the signed-out prompt, the ranking's age judged when read with a Refresh button, Home's lists keyed by their reader, the post screen reading its status again on focus, the switch's state across the Privacy tabs, the list's reads in a reader object tested directly, and the one-way mute pinned

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-28 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 2c adds Explore, a ranked list of recent original posts. Tasks 1 to 4 delivered it: the ground, the ranking and its job, the reads, and the web app. An adversarial review of that range (four finders, three refuters with different lenses per finding, a finding kept when two of three uphold it) upheld eight low-severity findings, one in the API's reads, five in the web app and two gaps in the tests; this task fixes them, tests first, with the whole stack rebuilt. The design is `docs/superpowers/specs/2026-09-28-explore-2c-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): Explore in the web app: a third Home tab read from and written to /?tab=, whose list reads one page at a time, says when the ranking was computed, starts again from the new ranking on explore_refreshed without losing or repeating posts and announces it, ends signed out with a sign-in prompt and shows an empty state worded from EXPLORE_V1; How Explore works at /explore/about prints every number of the formula, its version and change log; Settings > Privacy switches the author's posts in and out; the author's post screen says why a post is in Explore or not, and their listed posts carry an In Explore chip; the context column shows Popular now; the terms gain the Explore sentence; the smoke test checks the signed-out Explore page and the ranking's age`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/05-review-fixes.md 1
```

Expected: 2 lines starting with `wrote`, one for each file below.

### Replace `apps/api/test/integration/social-explore-reads.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { EXPLORE_V1, ExplorePage, ExploreStatus, type ExploreFormula, type ExploreStatusKind } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError, type SocialDeps } from "../../src/social/context";
import { encodeExploreCursor } from "../../src/social/cursor";
import { setEngagement } from "../../src/social/flows/engagement";
import { explorePage, exploreStatus, setShowInExplore } from "../../src/social/flows/explore";
import { getPost } from "../../src/social/flows/posts";
import { profilePosts } from "../../src/social/flows/timelines";
import type { SocialRepo } from "../../src/social/repo";
import { DAY, HOUR, MINUTE, accounts, after, approvedPost, before, exploreDeps, likedBy, listed, pageIds, rank, spans } from "./explore-fixtures";
import { newPost, newProfile } from "./social-fixtures";
import { rejection } from "./social-harness";

/** This suite's past (see explore-fixtures.ts): its rankings are computed as of times in 2022, each test in a span of its own. */
const EPOCH = Date.UTC(2022, 0, 1);

describe.skipIf(!process.env.INTEGRATION)("integration: reading Explore", () => {
  let db: Db;
  let deps: SocialDeps;
  let repo: SocialRepo;
  let setNow: (at: Date) => void;
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    ({ deps, repo, setNow } = exploreDeps(db));
  });
  afterAll(async () => {
    await closeDb(db);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /** A page as a reader asks for it: twenty posts unless the test says otherwise. */
  const read = (viewer: string | null, query: { limit?: number; cursor?: string } = {}) => explorePage(deps, viewer, { limit: 20, ...query });
  const status = (viewer: string, postId: string, formula?: ExploreFormula) => exploreStatus(deps, viewer, postId, formula);
  /** Sets a moderation state as sub-project 3 will; nothing in 2c writes one. */
  const setState = (postId: string, state: "withheld" | "removed") => db.execute(sql`update posts set state = ${state}::post_state where id = ${postId}::uuid`);

  test("before the first round the page is empty, with no cursor, no time and no sign-in prompt, a cursor is not valid, and the author's status is no_ranking", async () => {
    const asOf = nextAsOf();
    const [author, reader, ...fans] = await accounts(db, asOf, 5);
    // A post that would rank, so only the missing ranking keeps the page empty.
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(await read(null))).toEqual(empty);
    expect(await read(reader!.id)).toEqual(empty);
    // No ranking has been written, so no cursor this server made can name one: whatever ranking and post a cursor names,
    // it is not valid (400), never a ranking since pruned (409), which would send the reader to a current one that does not exist.
    for (const cursor of [{ g: 1, id: randomUUID() }, { g: 1, id }, { g: 2_147_483_647, id: randomUUID() }]) {
      const err = await read(reader!.id, { cursor: encodeExploreCursor(cursor) }).catch((caught: unknown) => caught);
      expect(err, JSON.stringify(cursor)).toBeInstanceOf(SocialError);
      expect(err, JSON.stringify(cursor)).toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(await status(author!.id, id)).toEqual({ status: "no_ranking", computedAt: null });
  });

  test("blocks in either direction and mutes, written after the ranking, leave a signed-in reader's pages before the limit", async () => {
    const asOf = nextAsOf();
    const [reader, blocked, blocker, muted, d, e] = await accounts(db, asOf, 6);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // The authors the reader will not see lead the ranking: their posts are as old as the others, with more approving accounts.
    const b1 = await approvedPost(repo, blocked!, at, fans.slice(0, 6), likedAt);
    const r1 = await approvedPost(repo, blocker!, at, fans.slice(0, 5), likedAt);
    const m1 = await approvedPost(repo, muted!, at, fans.slice(0, 4), likedAt);
    const d1 = await approvedPost(repo, d!, at, fans.slice(0, 3), likedAt);
    const e1 = await approvedPost(repo, e!, at, fans.slice(0, 3), likedAt);
    const order = await listed(db, (await rank(repo, asOf)).generation);
    expect(order.slice(0, 3)).toEqual([b1, r1, m1]);
    expect(new Set(order.slice(3))).toEqual(new Set([d1, e1]));
    setNow(after(asOf, MINUTE));

    await repo.block(reader!.id, blocked!.id, deps.now());
    await repo.block(blocker!.id, reader!.id, deps.now());
    await repo.mute(reader!.id, muted!.id, deps.now());
    // A mute whose muter has a post in the ranking: d mutes muted too, which must leave d1 in muted's Explore.
    await repo.mute(d!.id, muted!.id, deps.now());
    // Two posts are left for the reader, and a page of two holds both: the filters come before the limit.
    const first = await read(reader!.id, { limit: 2 });
    expect(pageIds(first)).toEqual(order.slice(3));
    expect(first.nextCursor).not.toBeNull();
    expect(await read(reader!.id, { limit: 2, cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Only the reader's own relations count: signed out, and for the accounts on the other side, the ranking is whole. A
    // mute is its muter's alone, so the muted account still reads the posts of the accounts that mute it, d1 among them,
    // and cannot tell from Explore that it was muted.
    expect(pageIds(await read(null))).toEqual(order);
    expect(pageIds(await read(blocked!.id))).toEqual(order);
    expect(pageIds(await read(blocker!.id))).toEqual(order);
    expect(pageIds(await read(muted!.id))).toEqual(order);
  });

  test("a listed post withheld, removed or deleted after the ranking is gone from the next read, for every reader, its author included", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d, ...fans] = await accounts(db, asOf, 7);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const d1 = await approvedPost(repo, d!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
    setNow(after(asOf, MINUTE));

    await setState(a1, "withheld");
    await setState(b1, "removed");
    expect(await repo.deletePost(c1, c!.id, deps.now())).toBe(true);
    expect(pageIds(await read(null))).toEqual([d1]);
    // Unlike Latest, where an author still sees their own withheld post, Explore leaves it out for its author as well.
    for (const reader of [a!, b!, c!, d!]) expect(pageIds(await read(reader.id)), reader.handle).toEqual([d1]);
    // Only the read changed: the ranking holds the four until the next round.
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
  });

  test("an author who switches Explore off, or whose account is deleted, leaves the next read, before any further round", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    setNow(after(asOf, MINUTE));

    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    // Marked deleted as the purge's last statement marks it, with the post left visible, so only the deletion keeps it out.
    await db.execute(sql`update profiles set deleted_at = ${deps.now().toISOString()}::timestamptz where id = ${b!.id}::uuid`);
    expect(pageIds(await read(null))).toEqual([c1]);
    expect(pageIds(await read(a!.id))).toEqual([c1]);
    expect(pageIds(await read(c!.id))).toEqual([c1]);
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1]));

    // The switch answers as it now stands and is what /me's profile store reads; turning it twice changes nothing more,
    // and an account that is gone, or never was, has no switch to turn.
    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(false);
    expect(await setShowInExplore(deps, a!.id, true)).toEqual({ showInExplore: true });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(true);
    expect(await rejection(setShowInExplore(deps, b!.id, false))).toBe("not_found");
    expect(await rejection(setShowInExplore(deps, randomUUID(), true))).toBe("not_found");
  });

  test("a reader paging through a ranking while a new one lands finishes the one they started, with no repeats and no gaps", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, d, e, f] = await accounts(db, asOf, 7);
    const fans = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // Five posts of one age, in the order of their approving accounts: 7, 6, 5, 4 and 3.
    const five: string[] = [];
    for (const [i, author] of [a!, b!, c!, d!, e!].entries()) five.push(await approvedPost(repo, author, at, fans.slice(0, 7 - i), likedAt));
    // Liked by all eight seven minutes before the first round: too recent for it, counted by the next, five minutes later.
    const f1 = await approvedPost(repo, f!, at, fans, before(asOf, 7 * MINUTE));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual(five);
    setNow(after(asOf, MINUTE));

    const page1 = await read(reader!.id, { limit: 2 });
    expect(pageIds(page1)).toEqual(five.slice(0, 2));
    expect(page1.computedAt).toBe(asOf.toISOString());

    const next = after(asOf, 5 * MINUTE);
    expect(await listed(db, (await rank(repo, next)).generation)).toEqual([f1, ...five]);

    // The pages after the first come from the ranking the reader started, with its time; the newcomer does not break in.
    const page2 = await read(reader!.id, { limit: 2, cursor: page1.nextCursor! });
    const page3 = await read(reader!.id, { limit: 2, cursor: page2.nextCursor! });
    expect([...pageIds(page1), ...pageIds(page2), ...pageIds(page3)]).toEqual(five);
    expect([page2.computedAt, page3.computedAt]).toEqual([asOf.toISOString(), asOf.toISOString()]);
    expect(page3.nextCursor).toBeNull();
    // A reader who starts now gets the new ranking, with its time.
    const fresh = await read(reader!.id);
    expect(pageIds(fresh)).toEqual([f1, ...five]);
    expect(fresh.computedAt).toBe(next.toISOString());
  });

  test("a cursor of a ranking no longer kept is 409 explore_refreshed; one naming a ranking not yet written, or a post outside its ranking, is 400", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, quiet, ...fans] = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const first = await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    await approvedPost(repo, c!, at, fans, likedAt);
    // A post in the window that no ranking holds: nobody approved of it.
    const outside = await newPost(repo, quiet!.id, at);
    await rank(repo, asOf);
    setNow(after(asOf, MINUTE));
    const started = await read(reader!.id, { limit: 1 });
    expect(started.nextCursor).not.toBeNull();

    const g2 = (await rank(repo, after(asOf, 5 * MINUTE))).generation;
    // The ranking before the current one is still kept, so the reader reads on in it.
    expect(pageIds(await read(reader!.id, { limit: 1, cursor: started.nextCursor! }))).toHaveLength(1);
    const g3 = (await rank(repo, after(asOf, 10 * MINUTE))).generation;
    // Now it is gone, and the reader is told so rather than handed another ranking's posts.
    const refreshed = await read(reader!.id, { limit: 1, cursor: started.nextCursor! }).catch((err: unknown) => err);
    expect(refreshed).toBeInstanceOf(SocialError);
    expect(refreshed).toMatchObject({ code: "explore_refreshed", status: 409, message: "Explore was refreshed." });

    const refusedAsInvalid = async (cursor: string, what: string) => {
      const err = await read(reader!.id, { limit: 1, cursor }).catch((caught: unknown) => caught);
      expect(err, what).toBeInstanceOf(SocialError);
      expect(err, what).toMatchObject({ code: "invalid_request", status: 400 });
    };
    // A ranking after the current one has not been written: no cursor this server made can name it.
    await refusedAsInvalid(encodeExploreCursor({ g: g3 + 1, id: first }), "a ranking not yet written");
    // A post the ranking does not hold, whether the post exists or not.
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: outside }), "a post outside the ranking");
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: randomUUID() }), "no such post");
    await refusedAsInvalid("not-a-cursor", "not a cursor");
    // Both rankings kept are read on after any post they hold.
    for (const g of [g2, g3]) {
      const order = await listed(db, g);
      expect(pageIds(await read(reader!.id, { cursor: encodeExploreCursor({ g, id: order[0]! }) }))).toEqual(order.slice(1));
    }
  });

  test("a page cut exactly at the limit carries a cursor naming the ranking and the last post read, and the page after it is empty with no cursor", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    const order = await listed(db, g);
    setNow(after(asOf, MINUTE));

    const full = await read(reader!.id, { limit: 2 });
    expect(ExplorePage.parse(full)).toEqual(full);
    expect(pageIds(full)).toEqual(order);
    // Ordinary post views with their public counts and the reader's own state; nothing but the order tells their place.
    expect(full.items.map((item) => [item.kind, item.post.counts.likes, item.post.viewer])).toEqual(order.map(() => ["post", 3, { liked: false, reposted: false, bookmarked: false }]));
    // The cursor names the ranking and the post read last, and nothing else: no position, no score.
    expect(JSON.parse(Buffer.from(full.nextCursor!, "base64url").toString("utf8"))).toEqual({ g, id: order[1] });
    expect(await read(reader!.id, { limit: 2, cursor: full.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // A page shorter than its limit is the last one: no cursor.
    const short = await read(reader!.id, { limit: 3 });
    expect(pageIds(short)).toEqual(order);
    expect(short.nextCursor).toBeNull();
  });

  test("the status answers the post's author only, with the first reason that applies: reply, quote, not_visible, hidden_by_author, then listed", async () => {
    const asOf = nextAsOf();
    const [author, other, ...fans] = await accounts(db, asOf, 5);
    const at = before(asOf, 2 * HOUR);
    const root = await approvedPost(repo, author!, at, fans, before(asOf, HOUR));
    const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: root });
    const quote = await newPost(repo, author!.id, at, "a quote", { quoteOfId: root });
    // A withheld reply is a reply first: replies never enter, whatever their state.
    const withheldReply = await newPost(repo, author!.id, at, "a withheld reply", { replyToId: root });
    const withheld = await newPost(repo, author!.id, at);
    const removed = await newPost(repo, author!.id, at);
    const deleted = await newPost(repo, author!.id, at);
    await setState(withheldReply, "withheld");
    await setState(withheld, "withheld");
    await setState(removed, "removed");
    expect(await repo.deletePost(deleted, author!.id, before(asOf, 30 * MINUTE))).toBe(true);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([root]);
    setNow(after(asOf, MINUTE));
    const computedAt = asOf.toISOString();

    const expected: [string, ExploreStatusKind][] = [
      [reply, "reply"],
      [withheldReply, "reply"],
      [quote, "quote"],
      [withheld, "not_visible"],
      [removed, "not_visible"],
      [deleted, "not_visible"],
      [root, "listed"],
    ];
    for (const [id, kind] of expected) {
      const answer = await status(author!.id, id);
      expect(answer, kind).toEqual({ status: kind, computedAt });
      // No count and no score: the reason and the ranking's time are all there is.
      expect(Object.keys(ExploreStatus.parse(answer)).sort(), kind).toEqual(["computedAt", "status"]);
    }
    // With the switch off, a post that is visible, even a listed one, says so; the reasons before it still come first.
    await setShowInExplore(deps, author!.id, false);
    expect(await status(author!.id, root)).toEqual({ status: "hidden_by_author", computedAt });
    expect(await status(author!.id, withheld)).toEqual({ status: "not_visible", computedAt });
    expect(await status(author!.id, quote)).toEqual({ status: "quote", computedAt });
    // Anyone but the author, and a post that does not exist, get not_found: nothing tells them what the post is.
    for (const id of [root, reply, quote, withheld, deleted]) expect(await rejection(status(other!.id, id)), id).toBe("not_found");
    expect(await rejection(status(author!.id, randomUUID()))).toBe("not_found");
  });

  test("outside_window comes before the ranking is asked about; no_ranking before the first round; new_since_ranking for a post written after it", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const window = EXPLORE_V1.windowHours * HOUR;
    // Exactly 48 hours old at the request time, which is outside: the window takes posts younger than that.
    const old = await approvedPost(repo, author!, before(asOf, window), fans, before(asOf, window - HOUR));
    const recent = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt: null });
    expect(await status(author!.id, recent)).toEqual({ status: "no_ranking", computedAt: null });

    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([recent]);
    // Written a minute after the ranking and approved of at once.
    const later = await approvedPost(repo, author!, after(asOf, MINUTE), fans, after(asOf, MINUTE));
    setNow(after(asOf, 15 * MINUTE));
    const computedAt = asOf.toISOString();
    expect(await status(author!.id, recent)).toEqual({ status: "listed", computedAt });
    expect(await status(author!.id, later)).toEqual({ status: "new_since_ranking", computedAt });
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt });
  });

  test("below_threshold and pending apply every rule of the ranking, now and at the ranking's time, the 10 minutes of standing included", async () => {
    const asOf = nextAsOf();
    const [author, fan1, fan2, fan3] = await accounts(db, asOf, 4);
    // A day old when it likes: short of the 48 hours an engaging account needs.
    const young = await newProfile(db, { createdAt: before(asOf, DAY) });
    const id = await newPost(repo, author!.id, before(asOf, 2 * HOUR));
    // Two approving accounts, and two likes that never count: the author's own and the young account's.
    await likedBy(repo, id, [fan1!, fan2!, author!, young], before(asOf, HOUR));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    const computedAt = asOf.toISOString();
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });

    // A third approving account likes it now: a like counts once it has stood 10 minutes, for the status as for the refresh.
    await likedBy(repo, id, [fan3!], deps.now());
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });
    // Ten minutes on it counts now, but not at the ranking's time, which came before it: the next refresh considers the post.
    setNow(after(asOf, 11 * MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt });
  });

  test("author_cap and below_cutoff: every rule met at the ranking's time, but the author's other posts, or the list's length, kept the post out", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(db, asOf, 3);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // One age, in the order of their approving accounts: b1 6, a1 5, a2 4, then a3 and c1 with 3 each.
    const b1 = await approvedPost(repo, b!, at, fans.slice(0, 6), likedAt);
    const a1 = await approvedPost(repo, a!, at, fans.slice(0, 5), likedAt);
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 4), likedAt);
    const a3 = await approvedPost(repo, a!, at, fans.slice(0, 3), likedAt);
    const c1 = await approvedPost(repo, c!, at, fans.slice(0, 3), likedAt);
    // Written before the ranking, approved of only after it.
    const a4 = await newPost(repo, a!.id, at);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([b1, a1, a2, c1]);
    await likedBy(repo, a4, fans.slice(0, 3), after(asOf, MINUTE));
    setNow(after(asOf, 11 * MINUTE));
    const computedAt = asOf.toISOString();
    // With the published formula the author's two better posts hold their two places.
    expect(await status(a!.id, a3)).toEqual({ status: "author_cap", computedAt });
    // Met now but not at the ranking's time: pending, whatever places the author holds, since the next refresh decides.
    expect(await status(a!.id, a4)).toEqual({ status: "pending", computedAt });
    expect(await status(c!.id, c1)).toEqual({ status: "listed", computedAt });

    // A formula whose list holds three posts, ranking and judging alike: c1 meets every rule, but the list was full.
    const short: ExploreFormula = { ...EXPLORE_V1, minGapMinutes: 0, listLength: 3 };
    expect(await listed(db, (await rank(repo, asOf, short)).generation)).toEqual([b1, a1, a2]);
    expect(await status(c!.id, c1, short)).toEqual({ status: "below_cutoff", computedAt });
    expect(await status(a!.id, a3, short)).toEqual({ status: "author_cap", computedAt });
    expect(await status(a!.id, a1, short)).toEqual({ status: "listed", computedAt });
  });

  test("a post listed at the ranking's time stays listed until the next round, even once its 48 hours have passed; then it is outside_window", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(db, asOf, 5);
    const window = EXPLORE_V1.windowHours * HOUR;
    // Five minutes short of 48 hours old at the ranking.
    const at = before(asOf, window - 5 * MINUTE);
    const kept = await approvedPost(repo, a!, at, fans, before(asOf, window - HOUR));
    const quiet = await approvedPost(repo, b!, at, fans.slice(0, 2), before(asOf, window - HOUR));
    const first = (await rank(repo, asOf)).generation;
    expect(await listed(db, first)).toEqual([kept]);
    // Ten minutes on, both are past their 48 hours.
    const later = after(asOf, 10 * MINUTE);
    setNow(later);
    expect(await status(a!.id, kept)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
    expect(await status(b!.id, quiet)).toEqual({ status: "outside_window", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([kept]);
    expect((await getPost(deps, a!.id, kept)).inExplore).toBe(true);

    // The next round leaves it out, and the status, the page and the chip follow, though the ranking before still holds it.
    expect(await listed(db, (await rank(repo, later)).generation)).toEqual([]);
    expect(await listed(db, first)).toEqual([kept]);
    expect(await status(a!.id, kept)).toEqual({ status: "outside_window", computedAt: later.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    expect(await getPost(deps, a!.id, kept)).not.toHaveProperty("inExplore");
  });

  test("a post left out because its author had switched Explore off is pending once the switch is back on, and listed after the next round", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(before(asOf, MINUTE));
    await setShowInExplore(deps, author!.id, false);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "hidden_by_author", computedAt: asOf.toISOString() });

    await setShowInExplore(deps, author!.id, true);
    // Every rule is met now and was met at the ranking's time; what kept the post out has gone, so the next refresh considers it.
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    const next = after(asOf, 5 * MINUTE);
    await rank(repo, next);
    expect(await status(author!.id, id)).toEqual({ status: "listed", computedAt: next.toISOString() });
    expect(pageIds(await read(null))).toEqual([id]);
  });

  test("the author's own listed posts carry inExplore wherever they are read, nobody else's view does, and it goes at once when the post is withheld or the switch is turned off", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    // Two approving accounts: not listed.
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 2), likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    // c quotes a1: its embed is a1 as its author sees it, but not a card of its own.
    const quote = await newPost(repo, c!.id, at, "a quote", { quoteOfId: a1 });
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
    setNow(after(asOf, MINUTE));
    const chipped = (items: { post: { id: string; inExplore?: true } }[]) => items.filter((item) => item.post.inExplore === true).map((item) => item.post.id);

    // On the author's own views: the post itself, Explore and their profile's posts.
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);
    expect(await getPost(deps, a!.id, a2)).not.toHaveProperty("inExplore");
    expect(chipped((await read(a!.id)).items)).toEqual([a1]);
    expect(chipped((await profilePosts(deps, a!.id, a!.handle, { limit: 20 })).items)).toEqual([a1]);
    // Nobody else's: another account's, a signed-out reader's, or the author's own post embedded in someone's quote.
    expect(await getPost(deps, b!.id, a1)).not.toHaveProperty("inExplore");
    expect(await getPost(deps, null, a1)).not.toHaveProperty("inExplore");
    expect((await read(null)).items.filter((item) => "inExplore" in item.post)).toEqual([]);
    expect(chipped((await read(b!.id)).items)).toEqual([b1]);
    expect((await getPost(deps, a!.id, quote)).quoteOf).not.toHaveProperty("inExplore");

    // An engagement answer carries the counts and the viewer's own state, not the post: the card keeps its chip through it.
    const liked = await setEngagement(deps, a!.id, a1, "like", true);
    expect(Object.keys(liked).sort()).toEqual(["counts", "viewer"]);
    expect(Object.keys(liked.viewer).sort()).toEqual(["bookmarked", "liked", "reposted"]);
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);

    // Gone at once, before any further round: from a withheld post, and from every post of an author who switched Explore off.
    await setState(a1, "withheld");
    const withheld = await getPost(deps, a!.id, a1);
    expect(withheld.state).toBe("withheld");
    expect(withheld).not.toHaveProperty("inExplore");
    await setShowInExplore(deps, b!.id, false);
    expect(await getPost(deps, b!.id, b1)).not.toHaveProperty("inExplore");
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
  });
});
```

### Replace `apps/app/test/explore.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EXPLORE_V1, ExploreStatusKind, type ExploreFormula, type ExplorePage, type MeResponse, type PostView, type TimelineItem } from "@korbat/contracts";
import ExploreAbout, { ExploreRules } from "../src/app/explore/about";
import Home, { homeListKey, homeTab, homeTabs } from "../src/app/index";
import { ExploreSwitch, useExploreSwitch } from "../src/app/settings/privacy";
import { PopularPosts } from "../src/components/PopularNow";
import { ExploreEmpty, ExploreFooter, ExploreHeader } from "../src/components/social/ExploreList";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError } from "../src/lib/api";
import {
  appendUnseen,
  EXPLORE_REFRESHED_NOTICE,
  exploreEmptyText,
  exploreReader,
  exploreRules,
  exploreStatusText,
  exploreSwitchText,
  rankingAge,
  readPages,
  STALE_AFTER_MS,
  type RankingRead,
} from "../src/lib/explore";
import type { ExploreAnswer } from "../src/lib/social";
import { TERMS_SECTIONS, TERMS_VERSION } from "../src/lib/terms";

/**
 * Explore in the web app (2c design, section 11): the tabs, the list, the formula page, the switch, the status line, the
 * chip, the context column and the terms. The helpers that decide (the tab an address names, the lists' keys, the
 * ranking's age, what a page of a new ranking adds, the list's reads, every sentence and its numbers) are called, the
 * reads with fake answers; the screens and components are server-rendered as lifecycle.test.tsx renders its pages; what a
 * static render cannot show (requests, focus, the order of a save) is read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

// expo-router cannot load in Node (it reaches React Native's own modules): Link with `asChild` hands the child its href,
// which react-native-web renders as a real anchor, a screen reads its parameters and the path, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
// A post card's images and the compose sheet's slide reach native modules that do not load in Node; neither is under test.
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source file of the app, with its path from src in forward slashes. */
function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}

/** The body of the function `name` declares at the top of a file, up to its closing brace at the start of a line. */
function block(source: string, name: string): string {
  const from = source.indexOf(`function ${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return source.slice(from, source.indexOf("\n}\n", from));
}

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

/** The text of every link to `href`, in order. */
function linkTexts(markup: string, href: string): string[] {
  const texts: string[] = [];
  for (let at = markup.indexOf(`href="${href}"`); at !== -1; at = markup.indexOf(`href="${href}"`, at + 1)) {
    const start = markup.lastIndexOf("<a ", at);
    const end = markup.indexOf("</a>", at);
    if (start !== -1 && end !== -1) texts.push(markup.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return texts;
}

/** The opening tag of the button whose text is `label`, or "" when there is none. */
function buttonTag(markup: string, label: string): string {
  const at = markup.indexOf(label);
  const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
  return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
}

/** The tabs of the markup's tab list, in order: each one's text and whether it is selected. */
function tabsOf(markup: string): { label: string; selected: boolean }[] {
  return [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({
    label: match[2] ?? "",
    selected: (match[1] ?? "").includes('aria-selected="true"'),
  }));
}

/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const AUTHOR = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
const OTHER = "1e2d3c4b-5a69-4786-9a5b-4c3d2e1f0a9b";
const AT = "2026-09-28T12:05:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: AUTHOR, handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-09-28T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}
// ExplorePage's items are post items only: the contract's refinement narrows the timeline item.
const item = (n: number): ExplorePage["items"][number] => ({ kind: "post", post: post(n) });
const explorePage = (posts: number[], nextCursor: string | null): ExplorePage => ({ items: posts.map(item), nextCursor, computedAt: AT, signInForMore: false });
const ids = (items: TimelineItem[]): string[] => items.map((entry) => entry.post.id);
/** The Date header of an answer carrying the ranking of AT: two and a half minutes after it, by the server's clock. */
const DATE = new Date(Date.parse(AT) + 150_000).toUTCString();
/** When that answer arrived, by the device's clock. */
const RECEIVED = Date.parse(AT) + 151_000;
/** A page of Explore as the app's client answers it: with the answer's Date header and the time it arrived. */
const answer = (posts: number[], nextCursor: string | null, extra: Partial<ExploreAnswer> = {}): ExploreAnswer => ({
  ...explorePage(posts, nextCursor),
  date: DATE,
  receivedAt: RECEIVED,
  ...extra,
});

const ME: MeResponse = {
  user: { id: AUTHOR, email: "ada@example.org", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
  profile: { id: AUTHOR, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true },
};
const signedIn = (showInExplore = true) => ({ status: "signed-in", me: { ...ME, profile: { ...ME.profile!, showInExplore } } });

describe("Home's tabs and their addresses", () => {
  test("an account has Following, Latest and Explore; everyone else Latest and Explore, Latest first as before", () => {
    expect(homeTabs(true)).toEqual(["following", "latest", "explore"]);
    expect(homeTabs(false)).toEqual(["latest", "explore"]);
  });

  test("the tab is the one /?tab= names, and a missing, unknown or unavailable name means the first tab", () => {
    expect(homeTab(undefined, true)).toBe("following");
    expect(homeTab("latest", true)).toBe("latest");
    expect(homeTab("explore", true)).toBe("explore");
    expect(homeTab(undefined, false)).toBe("latest");
    expect(homeTab("explore", false)).toBe("explore");
    // Following needs an account.
    expect(homeTab("following", false)).toBe("latest");
    expect(homeTab("trending", true)).toBe("following");
    expect(homeTab("Explore", true)).toBe("following");
    // A parameter given twice counts once, by its first value.
    expect(homeTab(["explore", "latest"], true)).toBe("explore");
  });

  test("signed in, Home shows the three tabs with the one the address names selected, and Explore's list under them", () => {
    session.state = signedIn();
    route.params = { tab: "explore" };
    const out = html(<Home />);
    expect(out).toContain('role="tablist"');
    expect(tabsOf(out)).toEqual([
      { label: "Following", selected: false },
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    // The list's header, with its link to the rules.
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    route.params = {};
    const following = html(<Home />);
    expect(tabsOf(following).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Following"]);
    expect(linkTexts(following, "/explore/about")).toEqual([]);
  });

  test("signed out, Home shows Latest and Explore, and the prompt under them fits the tab", () => {
    session.state = { status: "signed-out" };
    route.params = {};
    const latest = html(<Home />);
    expect(tabsOf(latest)).toEqual([
      { label: "Latest", selected: true },
      { label: "Explore", selected: false },
    ]);
    expect(latest).toContain("You are reading the latest public posts. Sign in to follow people and post.");
    route.params = { tab: "explore" };
    const explore = html(<Home />);
    expect(tabsOf(explore)).toEqual([
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    expect(explore).toContain("Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.");
    // True whatever the list holds: it neither promises more of Explore, which may not exist, nor says posts are being read
    // over a list that may be empty. Only the list's own footer, shown when more posts exist, offers more of it.
    expect(explore).not.toContain("see more of Explore");
    expect(explore).not.toContain("You are reading");
    route.params = { tab: "following" };
    expect(tabsOf(html(<Home />)).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Latest"]);
    route.params = {};
  });

  test("each list is keyed by its tab, the posts written on Home and its reader, so signing in or out, or another account, reads it again", () => {
    // A list read signed out has no cursor and a sign-in link and was read without any block or mute, and the web keeps a
    // Home mounted under the sign-in screen, which Back shows again once signed in.
    const readers = [homeListKey("explore", 0, null), homeListKey("explore", 0, AUTHOR), homeListKey("explore", 0, OTHER)];
    expect(new Set(readers).size).toBe(3);
    expect(homeListKey("latest", 0, null)).not.toBe(homeListKey("latest", 0, AUTHOR));
    // Another tab and a new post still make a new list.
    expect(homeListKey("latest", 0, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    expect(homeListKey("explore", 1, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    // Both lists take their key from it, with the session's account as the reader.
    const home = block(read("app", "index.tsx"), "Home");
    expect(home).toContain('const viewer = state.status === "signed-in" ? state.me.user.id : null;');
    expect(home.match(/key=\{homeListKey\(current, version, viewer\)\}/g)).toHaveLength(2);
  });

  test("a tab is chosen through the address, every link to a tab names one Home has, and Following's empty text points to Latest and Explore", () => {
    const home = read("app", "index.tsx");
    expect(home).toContain("useLocalSearchParams<{ tab?: string }>()");
    expect(home).toContain("const select = (tab: Tab) => router.setParams({ tab });");
    expect(home).toContain('"Nothing here yet. Follow someone, or switch to Latest or Explore."');
    const links = sourceFiles().flatMap((file) => [...file.text.matchAll(/"\/\?tab=([a-z]+)"/g)].map((match) => ({ file: file.name, tab: match[1] ?? "" })));
    // Popular now and How Explore works lead back to the Explore tab.
    expect(links.map((link) => link.file).sort()).toEqual(["app/explore/about.tsx", "components/PopularNow.tsx"]);
    for (const link of links) expect(homeTab(link.tab, false), link.file).toBe(link.tab);
  });
});

describe("the Explore list", () => {
  test("its header says how long ago the ranking was computed, or since when it had not been when read, offers Refresh once a newer one is due, and links to How Explore works", () => {
    /** A ranking of the given age, read just now: the answer's Date header and the device's clock agree. */
    const readNow = (age: number): RankingRead => {
      const now = Date.now();
      return { computedAt: new Date(now - age).toISOString(), date: new Date(now).toUTCString(), receivedAt: now };
    };
    // Five seconds past the minute: the Date header counts whole seconds.
    const fresh = html(<ExploreHeader ranking={readNow(3 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(fresh).toContain("Updated 3 minutes ago");
    expect(buttonTag(fresh, "Refresh")).toBe("");
    expect(linkTexts(fresh, "/explore/about")).toEqual(["How Explore works"]);
    const due = html(<ExploreHeader ranking={readNow(6 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(due).toContain("Updated 6 minutes ago");
    expect(buttonTag(due, "Refresh")).not.toBe("");
    const stale = html(<ExploreHeader ranking={readNow(20 * 60_000)} onRefresh={() => undefined} />);
    expect(stale).toContain("Explore has not been updated since ");
    expect(stale).not.toContain("Updated ");
    expect(buttonTag(stale, "Refresh")).not.toBe("");
    // Before the first round there is no ranking, no time to show and nothing to read again.
    const none = html(<ExploreHeader ranking={null} onRefresh={() => undefined} />);
    expect(none).not.toMatch(/Updated|updated since|Refresh/);
    expect(linkTexts(none, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("the ranking's age is its age when read, by the answer's Date header, plus the time on screen; only its age when read makes it stale", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    /** The ranking in an answer the server sent `served` ms after computing it, which arrived at the device's `receivedAt`. */
    const ranking = (served: number, receivedAt: number): RankingRead => ({ computedAt, date: new Date(t0 + served).toUTCString(), receivedAt });
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
    // A device clock that agrees with the server's.
    const right = t0 + 190_000;
    expect(rankingAge(ranking(30_000, t0 + 30_000), t0 + 30_000)).toMatchObject({ stale: false, text: "Updated just now" });
    expect(rankingAge(ranking(60_000, t0 + 60_000), t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge(ranking(190_000, right), right)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A device clock 20 minutes fast, then one 20 minutes slow: the age at the read is the server's and the time on screen
    // the device's alone, so neither error counts, and neither warns nor calls the ranking new.
    const fast = right + 20 * 60_000;
    expect(rankingAge(ranking(190_000, fast), fast)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    expect(rankingAge(ranking(190_000, fast), fast + 60_000)).toMatchObject({ stale: false, text: "Updated 4 minutes ago" });
    const slow = right - 20 * 60_000;
    expect(rankingAge(ranking(190_000, slow), slow)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A page left open counts on, and never turns into the warning: the job has written newer rankings meanwhile.
    expect(rankingAge(ranking(190_000, right), right + 20 * 60_000)).toMatchObject({ stale: false, text: "Updated 23 minutes ago" });
    // Over 15 minutes old when the server answered: by then several rounds have failed or been skipped.
    expect(rankingAge(ranking(15 * 60_000, right), right)).toMatchObject({ stale: false, text: "Updated 15 minutes ago" });
    const stale = rankingAge(ranking(15 * 60_000 + 1000, fast), fast);
    expect(stale.stale).toBe(true);
    expect(stale.text).toMatch(/^Explore has not been updated since .+\.$/);
    expect(stale.text).toContain(new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    // Without a Date header the device's clock is all there is.
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 60_000 }, t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 20 * 60_000 }, t0 + 20 * 60_000)).toMatchObject({ stale: true });
    // The header counts whole seconds, so a ranking of the same second is not in the future; and a minute clock that last
    // ticked before the answer arrived adds no time on screen.
    expect(rankingAge({ computedAt: "2026-09-28T12:00:00.800Z", date: new Date(t0).toUTCString(), receivedAt: right }, right - 30_000)).toMatchObject({
      stale: false,
      text: "Updated just now",
    });
    // Days later the date is named too, so the time cannot be read as today's.
    const old = new Date(t0 - 3 * 24 * 3600_000);
    const days = rankingAge({ computedAt: old.toISOString(), date: new Date(t0).toUTCString(), receivedAt: t0 }, t0);
    expect(days.stale).toBe(true);
    expect(days.text).toContain(old.toLocaleDateString());
  });

  test("Refresh is offered once the ranking on screen is as old as EXPLORE_V1's refresh interval, when a newer one should exist", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    // Read a minute after it was computed, then left on screen.
    const read: RankingRead = { computedAt, date: new Date(t0 + 60_000).toUTCString(), receivedAt: t0 + 60_000 };
    expect(EXPLORE_V1.refreshMinutes).toBe(5);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000 - 1000).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000).offerRefresh).toBe(true);
    // A ranking that was stale when read is offered at once.
    expect(rankingAge({ ...read, date: new Date(t0 + 16 * 60_000).toUTCString() }, read.receivedAt)).toMatchObject({ stale: true, offerRefresh: true });
    // The interval is the formula's.
    const slower: ExploreFormula = { ...EXPLORE_V1, refreshMinutes: 10 };
    expect(rankingAge(read, read.receivedAt + 9 * 60_000 - 1000, slower).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 9 * 60_000, slower).offerRefresh).toBe(true);
  });

  test("a page adds only the posts not on screen; another page is read only while one adds nothing and more follow", () => {
    const shown = new Set([id(1), id(2), id(3)]);
    const some = appendUnseen(shown, explorePage([2, 4, 1, 5], "c1"));
    expect(ids(some.added)).toEqual([id(4), id(5)]);
    expect(some).toMatchObject({ nextCursor: "c1", fetchNext: false });
    expect(appendUnseen(shown, explorePage([3, 1], "c2"))).toEqual({ added: [], nextCursor: "c2", fetchNext: true });
    // The ranking ends.
    expect(appendUnseen(shown, explorePage([2], null))).toEqual({ added: [], nextCursor: null, fetchNext: false });
    // A page whose posts the reader's blocks and mutes all took out is not the end while a cursor follows it.
    expect(appendUnseen(shown, explorePage([], "c3"))).toEqual({ added: [], nextCursor: "c3", fetchNext: true });
    // A post is added once, and the set on screen is left as it was.
    expect(ids(appendUnseen(shown, explorePage([6, 6], null)).added)).toEqual([id(6)]);
    expect([...shown]).toEqual([id(1), id(2), id(3)]);
  });

  /** A fake Explore: each cursor (the first page's is "first") answers a page or an error, and every request is recorded. */
  function fakeExplore(answers: Record<string, ExplorePage | Error>) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExplorePage> => {
      calls.push(cursor);
      const answer = answers[cursor ?? "first"];
      if (!answer) throw new Error(`no page for ${cursor ?? "first"}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { fetchPage, calls };
  }
  const refreshed = () => new ApiError(409, "explore_refreshed", "Explore was refreshed.");

  test("Load more reads the next page of the ranking being paged", async () => {
    const fake = fakeExplore({ c1: explorePage([3, 4], "c2") });
    const result = await readPages(fake.fetchPage, "c1", new Set([id(1), id(2)]));
    expect(fake.calls).toEqual(["c1"]);
    expect(ids(result.added)).toEqual([id(3), id(4)]);
    expect(result).toMatchObject({ nextCursor: "c2", refreshed: false });
  });

  test("when the ranking being paged is gone, the new one is read from its first page, keeping only unseen posts, until a page adds some", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([1, 5, 2, 6], "n2") });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(ids(result.added)).toEqual([id(5), id(6)]);
    expect(result).toMatchObject({ nextCursor: "n2", refreshed: true });
    expect(result.last?.computedAt).toBe(AT);
  });

  test("... or until the new ranking ends", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([3], null) });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(result).toMatchObject({ added: [], nextCursor: null, refreshed: true });
  });

  test("any other failure is the list's to show, a first page is never a refresh, and one read is bounded", async () => {
    const failing = fakeExplore({ c1: new ApiError(500, "internal", "Something went wrong on our side. Try again.") });
    await expect(readPages(failing.fetchPage, "c1", new Set())).rejects.toMatchObject({ code: "internal" });
    // Only a cursor names a ranking: the first page is always the current one.
    const first = fakeExplore({ first: refreshed() });
    await expect(readPages(first.fetchPage, undefined, new Set())).rejects.toMatchObject({ code: "explore_refreshed" });
    expect(first.calls).toEqual([undefined]);
    const empty = fakeExplore({ first: explorePage([], "x"), x: explorePage([], "x") });
    const result = await readPages(empty.fetchPage, undefined, new Set(), 3);
    expect(empty.calls).toHaveLength(3);
    expect(result).toMatchObject({ added: [], nextCursor: "x" });
  });

  test("the footer: a polite status line always in the tree, Load more while the ranking has more, and signed out the sign-in link when more exist", () => {
    expect(EXPLORE_REFRESHED_NOTICE).toBe("Explore was refreshed; the posts below come from the new ranking.");
    const quiet = html(<ExploreFooter cursor={null} signInForMore={false} notice={null} error={null} onLoadMore={() => undefined} />);
    const status = /<div[^>]*role="status"[^>]*>/.exec(quiet)?.[0] ?? "";
    expect(status).toContain('aria-live="polite"');
    // It can take the focus when Load more, which had it, leaves the tree.
    expect(status).toContain('tabindex="-1"');
    expect(quiet).not.toContain("Load more");
    expect(linkTexts(quiet, "/signin")).toEqual([]);
    const after = html(<ExploreFooter cursor="n2" signInForMore={false} notice={EXPLORE_REFRESHED_NOTICE} error={null} onLoadMore={() => undefined} />);
    expect(after).toMatch(/role="status"[^>]*><div[^>]*>Explore was refreshed; the posts below come from the new ranking\.<\/div>/);
    expect(buttonTag(after, "Load more")).not.toBe("");
    const signedOut = html(<ExploreFooter cursor={null} signInForMore notice={null} error={null} onLoadMore={() => undefined} />);
    expect(linkTexts(signedOut, "/signin")).toEqual(["Sign in to see more of Explore"]);
  });

  /** A fake Explore answering its requests in order from `script`, each a page or a failure, and recording each cursor. */
  function scripted(script: (ExploreAnswer | Error)[]) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExploreAnswer> => {
      calls.push(cursor);
      const next = script.shift();
      if (!next) throw new Error(`no answer left for ${cursor ?? "first"}`);
      if (next instanceof Error) throw next;
      return next;
    };
    return { fetchPage, calls };
  }

  test("the list's reader lets one read run at a time: a load meanwhile fetches nothing and answers null, and each read answers what the list shows", async () => {
    const calls: (string | undefined)[] = [];
    const held: ((page: ExploreAnswer) => void)[] = [];
    const reader = exploreReader((cursor) => {
      calls.push(cursor);
      return new Promise<ExploreAnswer>((resolve) => held.push(resolve));
    });
    const first = reader.load();
    // Pull to refresh, Refresh or Load more while the first read runs: nothing is fetched and nothing changes on screen.
    expect(await reader.load()).toBeNull();
    expect(await reader.load("c0")).toBeNull();
    expect(calls).toEqual([undefined]);
    held[0]!(answer([1, 2], "c1"));
    const shown = await first;
    expect(ids(shown!.items)).toEqual([id(1), id(2)]);
    expect(shown).toMatchObject({ cursor: "c1", signInForMore: false, refreshed: false });
    // The ranking's time with the Date header and the arrival of the answer that carried it, which the header ages it by.
    expect(shown!.ranking).toEqual({ computedAt: AT, date: DATE, receivedAt: RECEIVED });
    // Once it has answered the next read runs, and a double press of Load more appends its page once.
    const more = reader.load("c1");
    expect(await reader.load("c1")).toBeNull();
    expect(calls).toEqual([undefined, "c1"]);
    held[1]!(answer([3], null));
    expect(await more).toMatchObject({ cursor: null, refreshed: false });
    expect(ids((await more)!.items)).toEqual([id(1), id(2), id(3)]);
  });

  test("after explore_refreshed the reader appends from the current ranking only the posts not already on screen, and goes on from there", async () => {
    const fake = scripted([answer([1, 2], "c1"), refreshed(), answer([2, 1, 5], "n1"), answer([5, 6], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    const after = await reader.load("c1");
    expect(fake.calls).toEqual([undefined, "c1", undefined]);
    // The posts read stay where they are, once each; the new ranking adds what was not on screen, and the list says so.
    expect(ids(after!.items)).toEqual([id(1), id(2), id(5)]);
    expect(after).toMatchObject({ cursor: "n1", refreshed: true });
    // What it added is on screen now as well: a page holding it again adds only the rest.
    const next = await reader.load("n1");
    expect(ids(next!.items)).toEqual([id(1), id(2), id(5), id(6)]);
    expect(next).toMatchObject({ cursor: null, refreshed: false });
  });

  test("a failed read throws, leaves what the list shows as it was and lets the next load run", async () => {
    const offline = () => new ApiError(0, "network", "Cannot reach korbat. Check your connection.");
    const fake = scripted([offline(), answer([1, 2], "c1"), offline(), answer([3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await expect(reader.load()).rejects.toMatchObject({ code: "network" });
    expect(ids((await reader.load())!.items)).toEqual([id(1), id(2)]);
    await expect(reader.load("c1")).rejects.toMatchObject({ code: "network" });
    // Load more again: its page comes below the posts that stayed.
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3)]);
    expect(fake.calls).toEqual([undefined, undefined, "c1", "c1"]);
  });

  test("a load without a cursor starts over: the first page in place of everything on screen, from which Load more goes on", async () => {
    const later = "2026-09-28T12:10:00.000Z";
    const fake = scripted([answer([1, 2], "c1"), answer([3, 4], "c2"), answer([5, 1], "d1", { computedAt: later }), answer([2, 3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3), id(4)]);
    const again = await reader.load();
    expect(ids(again!.items)).toEqual([id(5), id(1)]);
    expect(again).toMatchObject({ cursor: "d1", refreshed: false });
    expect(again!.ranking?.computedAt).toBe(later);
    // The posts shown before it are no longer on screen, so a page holding them adds them like any other.
    expect(ids((await reader.load("d1"))!.items)).toEqual([id(5), id(1), id(2), id(3)]);
  });

  test("a post deleted from the list leaves the reader's list too, even while a read is in flight", async () => {
    let release: ((page: ExploreAnswer) => void) | undefined;
    const reader = exploreReader((cursor) => (cursor === undefined ? Promise.resolve(answer([1, 2], "c1")) : new Promise<ExploreAnswer>((resolve) => (release = resolve))));
    await reader.load();
    const more = reader.load("c1");
    expect(ids(reader.remove(id(2)).items)).toEqual([id(1)]);
    release!(answer([3], null));
    expect(ids((await more)!.items)).toEqual([id(1), id(3)]);
  });

  test("the sign-in flag comes from the last page read, and before the first round there is no ranking to age", async () => {
    const fake = scripted([answer([], null, { computedAt: null }), answer([1], null, { signInForMore: true })]);
    const reader = exploreReader(fake.fetchPage);
    expect(await reader.load()).toMatchObject({ items: [], cursor: null, ranking: null, signInForMore: false });
    expect(await reader.load()).toMatchObject({ cursor: null, ranking: { computedAt: AT }, signInForMore: true });
  });

  test("the list shows what one reader of its own answers, reads the first page again from pull to refresh and Refresh, announces a refresh and keeps the focus", () => {
    const list = block(read("components", "social", "ExploreList.tsx"), "ExploreList");
    const at = (code: string): number => {
      const index = list.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    // Made once with the list, so its state lives and ends with it.
    expect(list).toContain("const [reader] = useState(() => exploreReader(social.explore));");
    // An answer is what the list shows; null, while another read runs, changes nothing.
    expect(at("const answer = await reader.load(after);")).toBeLessThan(at("if (!answer) return;"));
    expect(at("if (!answer) return;")).toBeLessThan(at("setShown(answer);"));
    expect(at("setShown(answer);")).toBeLessThan(at("if (answer.refreshed) {"));
    expect(at("if (answer.refreshed) {")).toBeLessThan(at("setNotice(EXPLORE_REFRESHED_NOTICE);"));
    expect(list).toContain("const remove = (id: string) => setShown(reader.remove(id));");
    // Its posts, Load more's cursor, the ranking's time and the sign-in link all come from the answer.
    for (const wire of [
      "data={shown.items}",
      "<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />",
      "onRefresh={() => refresh(false)}",
      "cursor={shown.cursor}",
      "signInForMore={shown.signInForMore}",
      "if (shown.cursor) void load(shown.cursor);",
      "statusRef={footer}",
      // The empty state is an element, with its own links, not a line of text.
      "<ExploreEmpty onShowLatest={onShowLatest} />",
    ]) {
      expect(list, wire).toContain(wire);
    }
    // After a refresh the focus stays at the footer; after the header's Refresh it goes to the line saying how old the
    // ranking now is, since the button leaves the tree once the ranking is fresh.
    expect(list).toContain("if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();");
    expect(list).toContain("if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();");
  });

  test("the empty state is worded from EXPLORE_V1, links to How Explore works and offers Show Latest", () => {
    expect(exploreEmptyText()).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 3 other accounts, each at least 2 days old, like or repost it in its first 48 hours. Explore is refreshed every 5 minutes.",
    );
    // Every number comes from the formula: another formula words another sentence.
    const other: ExploreFormula = { ...EXPLORE_V1, threshold: 5, engagerMinAgeHours: 72, windowHours: 24, refreshMinutes: 10 };
    expect(exploreEmptyText(other)).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 5 other accounts, each at least 3 days old, like or repost it in its first 24 hours. Explore is refreshed every 10 minutes.",
    );
    expect(exploreEmptyText({ ...EXPLORE_V1, engagerMinAgeHours: 36 })).toContain("each at least 36 hours old");
    expect(exploreEmptyText({ ...EXPLORE_V1, engagerMinAgeHours: 24 })).toContain("each at least 1 day old");
    const out = html(<ExploreEmpty onShowLatest={() => undefined} />);
    expect(out).toContain(exploreEmptyText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    expect(buttonTag(out, "Show Latest")).not.toBe("");
    expect(textOf(html(<ExploreEmpty onShowLatest={() => undefined} formula={other} />))).toContain("at least 5 other accounts");
  });
});

describe("How Explore works", () => {
  test("states every number of the formula from EXPLORE_V1, with the version and the change log", () => {
    const out = textOf(html(<ExploreRules />));
    for (const phrase of [
      "Original posts from the last 48 hours",
      "was at least 2 days old when it liked or reposted",
      "has stood for at least 10 minutes",
      "A post needs at least 3 approving accounts.",
      "divided by (the hours since it was posted + 2) to the power 1.8",
      "Explore holds the 300 posts with the highest scores, with at most 2 posts of one account",
      "A new ranking is computed every 5 minutes, never sooner than 4.5 minutes after the last one.",
      "The newest 2 rankings are kept",
      "Signed out, you see the first 20 posts.",
      "Explore stays empty for about 2 days after it opens",
      "This is version 1 of the formula.",
      "Version 1, 2026-09-28: First version.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
  });

  test("follows the formula it is given: another formula's numbers, version and change log", () => {
    const other: ExploreFormula = {
      ...EXPLORE_V1,
      version: 2,
      windowHours: 72,
      engagerMinAgeHours: 96,
      standingMinutes: 15,
      threshold: 7,
      gravity: 1.5,
      offsetHours: 3,
      perAuthor: 4,
      listLength: 100,
      refreshMinutes: 10,
      minGapMinutes: 9,
      kept: 3,
      signedOutPage: 10,
      changes: [...EXPLORE_V1.changes, { version: 2, date: "2026-12-01", summary: "A later version." }],
    };
    const out = textOf(html(<ExploreRules formula={other} />));
    for (const phrase of [
      "Original posts from the last 72 hours",
      "was at least 4 days old when it liked or reposted",
      "has stood for at least 15 minutes",
      "A post needs at least 7 approving accounts.",
      "(the hours since it was posted + 3) to the power 1.5",
      "Explore holds the 100 posts with the highest scores, with at most 4 posts of one account",
      "every 10 minutes, never sooner than 9 minutes after the last one",
      "The newest 3 rankings are kept",
      "Signed out, you see the first 10 posts.",
      "Explore stays empty for about 4 days after it opens",
      "This is version 2 of the formula.",
      "Version 1, 2026-09-28: First version.",
      "Version 2, 2026-12-01: A later version.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
    for (const phrase of ["48 hours", "2 days", "at least 3 approving", "300 posts", "power 1.8", "version 1 of"]) expect(out, phrase).not.toContain(phrase);
  });

  test("says what takes a post out besides the formula, in the design's words", () => {
    const rule = exploreRules().find((section) => section.title === "What else takes a post out");
    expect(rule?.body).toBe(
      "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator or by the automatic R1 and R2 checks for every list at once; its author's switch or deletion; a block between you and the author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    );
    expect(textOf(html(<ExploreRules />))).toContain(rule!.body);
  });

  test("is a public page with the rules under its title", () => {
    session.state = { status: "signed-out" };
    const out = html(<ExploreAbout />);
    expect(out).toMatch(/<h1[^>]*>How Explore works<\/h1>/);
    expect(textOf(out)).toContain("A post needs at least 3 approving accounts.");
    // Nothing on the page asks who is reading: the rules are the same for everyone, signed in or not.
    expect(read("app", "explore", "about.tsx")).not.toMatch(/Redirect|useSession/);
  });
});

describe("Settings > Privacy: Show my posts in Explore", () => {
  const switchTag = (markup: string): string => /<input[^>]*role="switch"[^>]*>/.exec(markup)?.[0] ?? "";
  /** The switch as Privacy shows it: its state from the hook, which reads the session. */
  function SessionSwitch() {
    return <ExploreSwitch {...useExploreSwitch()} />;
  }

  test("is a switch named Show my posts in Explore, whose state is /api/me's", () => {
    session.state = signedIn(true);
    const on = switchTag(html(<SessionSwitch />));
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('aria-label="Show my posts in Explore"');
    expect(on).toContain('checked=""');
    expect(on).not.toContain("disabled");
    session.state = signedIn(false);
    const off = switchTag(html(<SessionSwitch />));
    expect(off).toContain('aria-label="Show my posts in Explore"');
    expect(off).not.toContain("checked");
  });

  test("shows what it is given: the value being saved, disabled while the save runs, and a failed save's error", () => {
    const saving = switchTag(html(<ExploreSwitch on={false} busy error={null} change={async () => undefined} />));
    expect(saving).not.toContain("checked");
    expect(saving).toContain('disabled=""');
    const failed = html(<ExploreSwitch on busy={false} error="Cannot reach korbat. Check your connection." change={async () => undefined} />);
    expect(switchTag(failed)).toContain('checked=""');
    expect(switchTag(failed)).not.toContain("disabled");
    expect(textOf(failed)).toContain("Cannot reach korbat. Check your connection.");
  });

  test("its one sentence says turning it off takes effect at once and turning it back on at the next refresh", () => {
    expect(exploreSwitchText()).toBe(
      "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at once, and turning it back on takes effect at the next refresh, which comes every 5 minutes.",
    );
    expect(exploreSwitchText({ ...EXPLORE_V1, refreshMinutes: 10 })).toContain("at the next refresh, which comes every 10 minutes.");
    session.state = signedIn(true);
    const out = html(<SessionSwitch />);
    expect(out).toContain(exploreSwitchText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("its state and its save live in Privacy, above the list that the Blocked and Muted tabs remount, so a tab change during a save loses neither", () => {
    const privacy = read("app", "settings", "privacy.tsx");
    const screen = block(privacy, "Privacy");
    expect(screen).toContain("const explore = useExploreSwitch();");
    expect(screen).toContain("<ExploreSwitch {...explore} />");
    // The list stays keyed by the tab, so the old tab's rows never show with the new tab's Unblock or Unmute.
    expect(screen).toContain("key={tab}");
    // The switch in the list's header only shows what it is given: it has no state a remount could reset.
    expect(block(privacy, "ExploreSwitch")).not.toMatch(/useState|useEffect|useSession/);
  });

  test("saves with POST or DELETE /api/me/explore while disabled, puts the switch back with the error on failure, and then refreshes the session", () => {
    expect(read("lib", "social.ts")).toContain('setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),');
    const privacy = read("app", "settings", "privacy.tsx");
    expect(privacy).toContain('<Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)}');
    const change = block(privacy, "useExploreSwitch");
    const at = (code: string): number => {
      const index = change.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (busy) return;")).toBeLessThan(at("setBusy(true);"));
    expect(at("setOn(next);")).toBeLessThan(at("await social.setShowInExplore(next);"));
    expect(at("await social.setShowInExplore(next);")).toBeLessThan(at("await refresh();"));
    expect(at("} catch (err) {")).toBeLessThan(at("setOn(before);"));
    expect(at("setOn(before);")).toBeLessThan(at("setError(errorMessage(err));"));
    expect(at("} finally {")).toBeLessThan(at("setBusy(false);"));
  });
});

describe("the author's status line", () => {
  test("words every status in the formula's words, with EXPLORE_V1's numbers, and nothing for a reply or a quote", () => {
    const expected: Record<ExploreStatusKind, string | null> = {
      reply: null,
      quote: null,
      not_visible: "Not in Explore: posts under review or removed never appear there.",
      hidden_by_author: "Not in Explore: you turned off Show my posts in Explore.",
      listed: "In Explore",
      outside_window: "Not in Explore: posts can appear only in their first 48 hours.",
      no_ranking: "Not in Explore yet: the first ranking has not been computed.",
      new_since_ranking: "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.",
      below_threshold:
        "Not in Explore: fewer than 3 approving accounts. Your own likes, accounts under 2 days old and likes from the last 10 minutes do not count.",
      pending: "Not in Explore yet: the next refresh will consider it.",
      author_cap: "Not in Explore: two of your posts rank above it.",
      below_cutoff: "Not in Explore: it ranks below the 300 posts Explore holds.",
    };
    for (const status of ExploreStatusKind.options) expect(exploreStatusText(status), status).toBe(expected[status]);
  });

  test("takes its numbers from the formula", () => {
    const other: ExploreFormula = { ...EXPLORE_V1, threshold: 5, engagerMinAgeHours: 72, standingMinutes: 15, windowHours: 24, perAuthor: 3, listLength: 100 };
    expect(exploreStatusText("below_threshold", other)).toBe(
      "Not in Explore: fewer than 5 approving accounts. Your own likes, accounts under 3 days old and likes from the last 15 minutes do not count.",
    );
    expect(exploreStatusText("author_cap", other)).toBe("Not in Explore: three of your posts rank above it.");
    expect(exploreStatusText("author_cap", { ...EXPLORE_V1, perAuthor: 1 })).toBe("Not in Explore: one of your posts ranks above it.");
    expect(exploreStatusText("below_cutoff", other)).toBe("Not in Explore: it ranks below the 100 posts Explore holds.");
    expect(exploreStatusText("outside_window", other)).toBe("Not in Explore: posts can appear only in their first 24 hours.");
  });

  test("shows under the author's own top-level post only, never a reply's or a quote's, with links to How Explore works and to the switch", () => {
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain("{mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}");
    expect(thread).toContain(".exploreStatus(id)");
    expect(thread).toContain("exploreStatusText(answer.status)");
    const line = block(thread, "ExploreStatusLine");
    expect(line).toContain('<Link href="/explore/about" asChild>');
    expect(line).toContain('<Link href="/settings/privacy" asChild>');
    expect(read("lib", "social.ts")).toContain("exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),");
  });

  test("the line and the post are read again whenever the screen gains focus, so both follow a change of the switch made through the line's own link", () => {
    // The web keeps the post's screen mounted under Settings > Privacy, and Back shows that same screen again.
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain('import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";');
    // The line asks on every focus, as the sign-in screen's autofill starts on every focus, not once per post.
    const line = block(thread, "ExploreStatusLine");
    expect(line).toMatch(/useFocusEffect\(\s+useCallback\(\(\) => \{[\s\S]*?\.exploreStatus\(id\)[\s\S]*?\}, \[id\]\),\s+\);/);
    expect(line).not.toContain("useEffect(");
    // Another post's line never shows under this one while this one's is read.
    expect(line).toContain("const text = line?.id === id ? line.text : null;");
    // The screen reads its post again on every focus after the first, into the thread on screen and without clearing it,
    // so the card's In Explore chip follows; the first focus is the mount, whose read is the thread's own.
    const screen = block(thread, "Thread");
    const focus = screen.slice(screen.indexOf("useFocusEffect("), screen.indexOf("}, [id]),", screen.indexOf("useFocusEffect(")));
    const at = (code: string): number => {
      const index = focus.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (focusedFor.current !== id) {")).toBeLessThan(at("focusedFor.current = id;"));
    expect(at("focusedFor.current = id;")).toBeLessThan(at(".getPost(id)"));
    expect(at(".getPost(id)")).toBeLessThan(at("setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));"));
    expect(focus).not.toContain("setThread(null)");
    expect(focus).not.toContain("setError(");
  });
});

describe("the In Explore chip", () => {
  test("shows on the author's own card while the post is in Explore, as a link to the post", () => {
    session.state = signedIn();
    const listed = html(<PostCard post={post(7, { inExplore: true })} />);
    expect(linkTexts(listed, `/post/${id(7)}`)).toContain("In Explore");
    expect(html(<PostCard post={post(7)} />)).not.toContain("In Explore");
    // Nobody else's view carries the flag, and a card never shows it on someone else's post.
    const bob = { id: OTHER, handle: "bob", displayName: "Bob", verified: false };
    expect(html(<PostCard post={post(8, { author: bob, inExplore: true })} />)).not.toContain("In Explore");
    session.state = { status: "signed-out" };
    expect(html(<PostCard post={post(7, { inExplore: true })} />)).not.toContain("In Explore");
  });
});

describe("the context column", () => {
  test("Popular now lists posts as links to their threads, an image-only post by its image's description, then a link to Explore", () => {
    const image = { id: id(90), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    const out = html(<PopularPosts posts={[post(1), post(2, { body: "", media: [image] }), post(3)]} />);
    expect(out).toMatch(/<h2[^>]*>Popular now<\/h2>/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual([`/post/${id(1)}`, `/post/${id(2)}`, `/post/${id(3)}`, "/?tab=explore"]);
    expect(linkTexts(out, `/post/${id(1)}`)[0]).toContain("post number 1");
    expect(linkTexts(out, `/post/${id(2)}`)[0]).toContain("Image: A green square");
    expect(linkTexts(out, "/?tab=explore")).toEqual(["More in Explore"]);
  });

  test("sits above the handle box on wide screens and asks Explore for its first three posts", () => {
    expect(read("components", "AppShell.tsx")).toMatch(/<PopularNow \/>\s*<HandleBox \/>/);
    expect(read("lib", "social.ts")).toContain('popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),');
    expect(read("components", "PopularNow.tsx")).toContain(".popular()");
    // The handle box is no longer the only way to find anyone.
    expect(read("components", "HandleBox.tsx")).not.toContain("only discovery tool");
  });
});

describe("the terms", () => {
  test("say that public posts can appear in Explore, where its rules are and how to keep one's posts out, without a new version", () => {
    const sentence =
      "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.";
    expect(TERMS_SECTIONS.filter((section) => section.body.includes(sentence))).toHaveLength(1);
    expect(TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("no screen caches or stores Explore's answers", () => {
  test("the files that ask for Explore keep its answers in component state only: no browser storage, no cache, no module-level variable", () => {
    const callers = sourceFiles().filter((file) => /social\s*\.(explore|popular|exploreStatus)\b/.test(file.text));
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/PopularNow.tsx", "components/social/ExploreList.tsx"]);
    const explore = sourceFiles().filter((file) => [...callers.map((caller) => caller.name), "lib/explore.ts", "app/explore/about.tsx"].includes(file.name));
    expect(explore).toHaveLength(5);
    for (const file of explore) {
      expect(file.text, file.name).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage|caches\./);
      expect(file.text, file.name).not.toMatch(/^(export )?(let|var) /m);
      expect(file.text, file.name).not.toMatch(/^(export )?const \w+ = new (Map|Set|WeakMap)\b/m);
    }
    // What the app keeps in the browser is the device id and the passkey card's Not now, nothing else.
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/passkeys.ts"]);
    // Explore's requests are the client's plain calls, which the API answers no-store.
    const social = read("lib", "social.ts");
    for (const line of social.split("\n").filter((text) => text.includes("/api/timeline/explore") || text.includes("/explore`"))) expect(line).not.toMatch(/cache/i);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/explore.test.tsx (41 tests | 18 failed) 261ms
× a failed read throws, leaves what the list shows as it was and lets the next load run 0ms
× shows what it is given: the value being saved, disabled while the save runs, and a failed save's error 6ms
Test Files  1 failed | 4 passed (5)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/05-review-fixes.md 3
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Replace `apps/api/src/social/flows/explore.ts` (whole file)

```ts
import { EXPLORE_V1, type ExploreFormula, type ExplorePage, type ExploreSettingResponse, type ExploreStatus, type ExploreStatusKind, type Pagination } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeExploreCursor, encodeExploreCursor } from "../cursor";
import { postViews } from "../views";

/**
 * A page of Explore (2c design, section 8): the posts of a ranking in its order, as ordinary post views, with the time the
 * ranking was computed. Without a cursor the current ranking is read; with one, the ranking it names, after the post it
 * names: a ranking not yet written, or a post that ranking does not hold, is not a cursor this module made (400), and a
 * ranking no longer kept is explore_refreshed (409), so the reader starts again from the current one. A signed-out
 * reader gets at most the formula's signed-out page whatever the limit asks, and never a cursor (the route refuses one
 * before this flow); one more row is read through the same filters, and `signInForMore` says whether it came back. The
 * cursor follows the repository's rows, not the views, which the view builder may still drop.
 */
export async function explorePage(deps: SocialDeps, viewer: ViewerId, query: Pagination, formula: ExploreFormula = EXPLORE_V1): Promise<ExplorePage> {
  const cursor = query.cursor ? decodeExploreCursor(query.cursor) : undefined;
  const limit = viewer ? query.limit : Math.min(query.limit, formula.signedOutPage);
  const read = await deps.repo.explorePage(viewer, cursor, viewer ? limit : limit + 1);
  if (cursor) {
    // In this order: every answer comes from one statement, so a round landing in between cannot change which applies.
    // Before the first round there is no current generation, and every generation (they start at 1) is one not yet written.
    if (cursor.g > (read.current ?? 0)) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
    if (!read.ranking) throw new SocialError("explore_refreshed", 409);
    if (read.after === null) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  // Before the first round there is no ranking to read and no time to show.
  if (!read.ranking) return { items: [], nextCursor: null, computedAt: null, signInForMore: false };
  const rows = read.rows.slice(0, limit);
  // A ranking holds posts, never reposts; the ranking's time stands in for the sort time, which a post item never shows.
  const views = await postViews(
    deps,
    viewer,
    rows.map((row) => ({ postId: row.postId, sortAt: read.ranking!.asOf, reposterId: null })),
  );
  const last = rows.at(-1);
  return {
    items: views.map((post) => ({ kind: "post" as const, post })),
    // Signed in, a full page may be followed by more; the cursor names the ranking and the last post read, never a position.
    nextCursor: viewer && last && rows.length === limit ? encodeExploreCursor({ g: read.ranking.generation, id: last.postId }) : null,
    computedAt: read.ranking.asOf.toISOString(),
    signInForMore: viewer === null && read.rows.length > limit,
  };
}

/**
 * Why one of the author's own posts is in Explore or not (2c design, section 8), without any count: anyone else, and a
 * post that does not exist, get not_found. The reasons are tried in the design's order, the first that applies answering;
 * the last four come from one bounded statement about this post alone, which applies every rule of the ranking as of the
 * request time (the standing of engagement included) and again as of the ranking's time. `formula` is the published one
 * unless a test ranks and judges with another.
 */
export async function exploreStatus(deps: SocialDeps, viewer: string, postId: string, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreStatus> {
  const now = deps.now();
  const facts = await deps.repo.exploreFacts(postId, now, formula);
  if (!facts || facts.authorId !== viewer) throw new SocialError("not_found", 404);
  const { ranking } = facts;
  const answer = (status: ExploreStatusKind): ExploreStatus => ({ status, computedAt: ranking ? ranking.asOf.toISOString() : null });
  // Replies and quotes never enter.
  if (facts.reply) return answer("reply");
  if (facts.quote) return answer("quote");
  // Withheld, removed or deleted: out for every reader, its author too.
  if (!facts.visible) return answer("not_visible");
  if (!facts.shown) return answer("hidden_by_author");
  // A listed post stays listed until the next round, even past its window.
  if (ranking?.holdsPost) return answer("listed");
  if (facts.outsideWindow) return answer("outside_window");
  if (!ranking) return answer("no_ranking");
  if (ranking.postIsNewer) return answer("new_since_ranking");
  const judged = await deps.repo.exploreJudgement({ id: postId, authorId: facts.authorId }, now, ranking, formula);
  if (!judged.metNow) return answer("below_threshold");
  // Met now but not at the ranking's time: the next refresh considers it.
  if (!judged.metAtRanking) return answer("pending");
  // The cap keeps an author's best posts: with the author's places full, this one scored below them, and no score is needed to say so.
  if (judged.authorPlaces >= formula.perAuthor) return answer("author_cap");
  if (judged.places >= formula.listLength) return answer("below_cutoff");
  // Met at the ranking's time but left out then for a cause that has since gone, such as the switch turned back on.
  return answer("pending");
}

/**
 * "Show my posts in Explore", on or off (2c design, section 8). Off takes the account's posts out of Explore at the next
 * read; on lets the posts a round left out back in at the next round. Only the global request limit applies and no event
 * is recorded; the answer is the switch as it now stands, so turning it twice is turning it once.
 */
export async function setShowInExplore(deps: SocialDeps, viewer: string, on: boolean): Promise<ExploreSettingResponse> {
  if (!(await deps.repo.setShowInExplore(viewer, on))) throw new SocialError("not_found", 404);
  return { showInExplore: on };
}
```

### Replace `apps/app/src/app/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { ExploreList } from "@/components/social/ExploreList";
import { TimelineList } from "@/components/social/PagedList";
import { Button, Loading } from "@/components/ui";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

export type Tab = "following" | "latest" | "explore";

const LABELS: Record<Tab, string> = { following: "Following", latest: "Latest", explore: "Explore" };

/**
 * What a signed-out reader is told under the tabs: both lists are public, and an account adds the rest. Explore's prompt
 * must be true whatever the list turns out to hold, nothing or all there is, so it promises no more of Explore: the
 * list's own footer offers that, and only when the page says more posts exist.
 */
const SIGNED_OUT_PROMPTS: Record<Exclude<Tab, "following">, string> = {
  latest: "You are reading the latest public posts. Sign in to follow people and post.",
  explore: "Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.",
};

/** Home's tabs in their order (2c design, section 11): Following first for an account, and Latest first for everyone else, who has no Following. */
export function homeTabs(signedIn: boolean): Tab[] {
  return signedIn ? ["following", "latest", "explore"] : ["latest", "explore"];
}

/**
 * The tab the address names (`/?tab=explore`), so another page can link to one; a missing or unknown name, or one the
 * reader does not have (Following, signed out), means the first tab. A parameter given twice counts by its first value.
 */
export function homeTab(param: string | string[] | undefined, signedIn: boolean): Tab {
  const tabs = homeTabs(signedIn);
  const named = Array.isArray(param) ? param[0] : param;
  return tabs.find((tab) => tab === named) ?? tabs[0]!;
}

/**
 * The key of Home's list: another tab, a post written here or another reader (an account's id, or none signed out) mounts
 * a new list, which reads its first page again. The reader is in it because a list read signed out has no cursor, offers
 * a sign-in and was read without any block or mute, and the web keeps a Home mounted under the sign-in screen, which Back
 * shows again once signed in.
 */
export function homeListKey(tab: Tab, version: number, viewer: string | null): string {
  return `${tab}:${version}:${viewer ?? "signed-out"}`;
}

/**
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device.
 */
function PasskeySuggestion({ me }: { me: MeResponse }) {
  const [platform, setPlatform] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(suggestionDismissedAt);
  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPlatform(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestPasskey({ passkeys: me.user.passkeys, platformAuthenticator: platform, dismissedAt, now: Date.now() })) return null;
  return (
    <View className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-50">
        Sign in faster with a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-300">A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.</Text>
      <View className="mt-3 flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={() => router.push("/settings/security?add=1")} className="rounded-lg bg-zinc-50 px-4 py-2">
          <Text className="text-sm font-semibold text-zinc-950">Add a passkey</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2"
        >
          <Text className="text-sm text-zinc-200">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Home: Following, Latest and Explore for a signed-in account; Latest and Explore with a sign-in prompt for everyone else. */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const [version, setVersion] = useState(0);
  const [composing, setComposing] = useState(false);
  const fetchFollowing = useCallback((cursor?: string) => social.following(cursor), []);
  const fetchLatest = useCallback((cursor?: string) => social.latest(cursor), []);

  if (state.status === "loading") {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const signedIn = state.status === "signed-in";
  const viewer = state.status === "signed-in" ? state.me.user.id : null;
  const current = homeTab(param, signedIn);
  // The tab lives in the address, so a reload keeps it and other pages can link to one; setParams changes it in place.
  const select = (tab: Tab) => router.setParams({ tab });
  const inlineComposer = signedIn && width >= 768;
  const posted = () => setVersion((v) => v + 1);

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
      <View className="border-b border-zinc-800 px-4 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          Home
        </Text>
        <View accessibilityRole="tablist" className="mt-3 flex-row">
          {homeTabs(signedIn).map((t) => (
            <Pressable key={t} accessibilityRole="tab" aria-selected={current === t} onPress={() => select(t)} className={`mr-6 border-b-2 pb-2 ${current === t ? "border-zinc-50" : "border-transparent"}`}>
              <Text className={`text-base ${current === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{LABELS[t]}</Text>
            </Pressable>
          ))}
        </View>
        {signedIn ? null : (
          <View className="my-3 rounded-lg bg-zinc-900 px-4 py-3">
            <Text className="text-sm text-zinc-300">{SIGNED_OUT_PROMPTS[current === "explore" ? "explore" : "latest"]}</Text>
            <Button label="Sign in" onPress={() => router.push("/signin")} tone="secondary" />
          </View>
        )}
      </View>
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-zinc-800">
          <Composer onPosted={posted} />
        </View>
      ) : null}
      {current === "explore" ? (
        <ExploreList key={homeListKey(current, version, viewer)} onShowLatest={() => select("latest")} />
      ) : (
        <TimelineList
          key={homeListKey(current, version, viewer)}
          fetchPage={current === "following" ? fetchFollowing : fetchLatest}
          empty={current === "following" ? "Nothing here yet. Follow someone, or switch to Latest or Explore." : "No posts yet."}
        />
      )}
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/post/[id].tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { exploreStatusText } from "@/lib/explore";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="border-b border-zinc-800 px-4 py-3">
        <Text className="text-sm italic text-zinc-400">{item.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
      </View>
    );
  }
  return <PostCard post={item} />;
}

/**
 * The author's line under their own post (2c design, section 11): whether it is in Explore and, if not, which rule keeps
 * it out, in the formula's words and without any count, with the way to the rules and to the switch. Until the answer
 * comes, and if it fails, there is no line: the post is the screen, and the line only explains. It is asked again every
 * time the screen gains focus: the web keeps this screen mounted under the ones it links to, and Back shows it again as
 * it was, so after the switch is turned through the line's own link the line would otherwise still give the old reason.
 */
function ExploreStatusLine({ id }: { id: string }) {
  // The line with the post it was read for: the same post's line stays while it is asked again, and another post's never shows.
  const [line, setLine] = useState<{ id: string; text: string | null } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      social
        .exploreStatus(id)
        .then((answer) => {
          if (!cancelled) setLine({ id, text: exploreStatusText(answer.status) });
        })
        .catch(() => {
          if (!cancelled) setLine(null);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const text = line?.id === id ? line.text : null;
  if (!text) return null;
  return (
    <View className="px-4 pb-2">
      <Text className="text-sm leading-5 text-zinc-300">{text}</Text>
      <View className="mt-1 flex-row flex-wrap gap-x-4">
        <Link href="/explore/about" asChild>
          <Pressable>
            <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
          </Pressable>
        </Link>
        <Link href="/settings/privacy" asChild>
          <Pressable>
            <Text className="text-sm text-zinc-400 underline">Your Explore setting</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

/** A post with the chain it replies to above it and its direct replies below, oldest first. */
export default function Thread() {
  const { id, quote } = useLocalSearchParams<{ id: string; quote?: string }>();
  const { state } = useSession();
  const viewer = state.status === "signed-in" && state.me.user.onboarded ? state.me.user.id : null;
  const signedIn = viewer !== null;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setError(null);
    // The id comes from the address bar; anything but a post id is refused before a request is built from it.
    if (!PostId.safeParse(id).success) {
      setError("That address is not a post.");
      return;
    }
    social
      .thread(id)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  // The screen stays mounted under the ones it links to, and Back shows it again as it was: on every focus after the
  // first, the post is read again into the thread on screen, without clearing it, so its card (the In Explore chip
  // included) follows a change made there. An id's first focus comes with the read above.
  const focusedFor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (focusedFor.current !== id) {
        focusedFor.current = id;
        return undefined;
      }
      // An address that is not a post has its error on screen already, and no request may be built from it.
      if (!PostId.safeParse(id).success) return undefined;
      let cancelled = false;
      social
        .getPost(id)
        .then((post) => {
          if (!cancelled) setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));
        })
        // What is on screen stays: the next focus asks again.
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id]);

  if (error) {
    return (
      <AppShell>
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This post is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
          <Link href="/" replace asChild>
            <Pressable className="mt-6">
              <Text className="text-sm text-zinc-400 underline">Back to the timeline</Text>
            </Pressable>
          </Link>
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const mine = viewer !== null && thread.post.author.id === viewer;
  const header = (
    <View>
      {thread.ancestors.map((item) => (
        <AncestorRow key={item.id} item={item} />
      ))}
      <View className="border-b-2 border-zinc-700">
        <PostCard post={thread.post} onDeleted={() => router.replace("/")} />
        {/* Replies and quotes never enter Explore, so they get no line and no request. */}
        {mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}
        {signedIn ? (
          <View className="flex-row justify-end px-4 pb-2">
            <Pressable accessibilityRole="button" onPress={() => setQuoting(true)}>
              <Text className="text-sm text-zinc-400 underline">Quote this post</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {signedIn ? <Composer replyTo={thread.post} onPosted={() => setVersion((v) => v + 1)} /> : null}
    </View>
  );

  return (
    <AppShell>
      <PostList key={version} fetchPage={fetchReplies} empty="No replies yet." header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => router.push(`/post/${post.id}`)} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/privacy.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Link } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { SettingsNav } from "@/components/SettingsNav";
import { ProfileList } from "@/components/social/ProfileList";
import { ErrorText, Section } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { exploreSwitchText } from "@/lib/explore";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "blocked" | "muted";

/**
 * react-native-web paints the thumb of a switch that is on in its own teal unless `activeThumbColor` names another colour,
 * a prop React Native's types do not know; the light thumb keeps its contrast on the dark track in both states.
 */
const ACTIVE_THUMB = { activeThumbColor: "#fafafa" } as object;

/** "Show my posts in Explore" as useExploreSwitch holds it and ExploreSwitch shows it. */
export interface ExploreSwitchState {
  on: boolean;
  busy: boolean;
  error: string | null;
  change: (next: boolean) => Promise<void>;
}

/**
 * "Show my posts in Explore" (2c design, section 11), on by default: its state and its save. Its state is /api/me's. A
 * change shows at once while it is saved (POST turns it on, DELETE off, as the app's other switches), the switch is
 * disabled until the save and the session's refresh are done, and a failed save puts it back with the error. Privacy
 * calls it, above the list whose header shows the switch: the Blocked and Muted tabs remount that list, and a remount
 * must not lose a save in progress or its error.
 */
export function useExploreSwitch(): ExploreSwitchState {
  const { state, refresh } = useSession();
  // The settings layout lets in only an account with a profile; the type still allows none.
  const stored = state.status === "signed-in" ? (state.me.profile?.showInExplore ?? true) : true;
  const [on, setOn] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follows the session when it changes: after a save here, or a refresh from elsewhere.
  useEffect(() => setOn(stored), [stored]);

  async function change(next: boolean) {
    if (busy) return;
    const before = on;
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      const answer = await social.setShowInExplore(next);
      setOn(answer.showInExplore);
      // /api/me carries the switch, so the session follows the saved state. A failed refresh shows its own screen, so what
      // the catch below sees is a failed save.
      await refresh();
    } catch (err) {
      setOn(before);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { on, busy, error, change };
}

/** The switch, its sentence, a failed save's error and the way to the rules, showing what useExploreSwitch holds. */
export function ExploreSwitch({ on, busy, error, change }: ExploreSwitchState) {
  return (
    <Section title="Explore">
      <View className="mt-3 flex-row items-center justify-between gap-4">
        <Text className="flex-1 text-base text-zinc-50">Show my posts in Explore</Text>
        {/* react-native-web renders a checkbox with the switch role, named by this label and checked while it is on. */}
        <Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)} trackColor={{ false: "#71717a", true: "#059669" }} thumbColor="#fafafa" {...ACTIVE_THUMB} />
      </View>
      <Text className="mt-2 text-sm leading-5 text-zinc-400">{exploreSwitchText()}</Text>
      <ErrorText message={error} />
      <Link href="/explore/about" asChild>
        <Pressable className="mt-3 self-start">
          <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
        </Pressable>
      </Link>
    </Section>
  );
}

function UndoButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        aria-busy={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          onPress()
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
        className="rounded-full border border-zinc-600 px-4 py-1.5"
      >
        <Text className="text-sm text-zinc-200">{label}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Whether your posts show in Explore, then blocked and muted accounts with one-tap undo. This is the only place a block can be lifted. */
export default function Privacy() {
  const [tab, setTab] = useState<Tab>("blocked");
  // Here, not in the list's header, which the tab's key remounts: a save in progress and its error outlive a tab change.
  const explore = useExploreSwitch();
  const fetchBlocks = useCallback((cursor?: string) => social.myBlocks(cursor), []);
  const fetchMutes = useCallback((cursor?: string) => social.myMutes(cursor), []);

  return (
    <AppShell>
      <ProfileList
        key={tab}
        fetchPage={tab === "blocked" ? fetchBlocks : fetchMutes}
        empty={tab === "blocked" ? "You have not blocked anyone." : "You have not muted anyone."}
        header={
          <View className="border-b border-zinc-800 px-4 pt-4">
            <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
              Privacy
            </Text>
            <SettingsNav current="privacy" />
            <ExploreSwitch {...explore} />
            <Text className="mt-6 text-sm leading-5 text-zinc-400">
              A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can
              still read them. A mute only hides an account from your timelines, and they are never told.
            </Text>
            <View accessibilityRole="tablist" className="mt-4 flex-row">
              {(["blocked", "muted"] as Tab[]).map((t) => (
                <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
                  <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "blocked" ? "Blocked" : "Muted"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        action={(item, remove) => (
          <UndoButton
            label={tab === "blocked" ? "Unblock" : "Unmute"}
            onPress={async () => {
              if (tab === "blocked") await social.setBlock(item.handle, false);
              else await social.setMute(item.handle, false);
              remove();
            }}
          />
        )}
      />
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/social/ExploreList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { EXPLORE_REFRESHED_NOTICE, exploreEmptyText, exploreReader, NOTHING_SHOWN, rankingAge, type ExploreShown, type RankingRead } from "@/lib/explore";
import { social } from "@/lib/social";
import { PostCard } from "./PostCard";

/** Reads the clock again every minute, so "Updated N minutes ago" stays true while the screen is open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AboutLink() {
  return (
    <Link href="/explore/about" asChild>
      <Pressable className="py-1">
        <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
      </Pressable>
    </Link>
  );
}

/**
 * Under the tabs: how long ago the ranking on screen was computed, or since when it had not been when it was read; once it
 * is as old as the refresh interval, Refresh, which reads the first page again (pull to refresh does so on a phone, but
 * nothing does on the web); and the link to its rules. The line can take the focus, which the list gives it after Refresh.
 */
export function ExploreHeader({ ranking, onRefresh, lineRef }: { ranking: RankingRead | null; onRefresh: () => void; lineRef?: Ref<View> }) {
  const now = useMinuteClock();
  // Before the first round there is no ranking, no time to show and nothing to read again.
  const age = ranking ? rankingAge(ranking, now) : null;
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-x-4 border-b border-zinc-800 px-4 py-2">
      <View ref={lineRef} tabIndex={-1}>
        {age ? <Text className={`text-sm ${age.stale ? "text-amber-300" : "text-zinc-400"}`}>{age.text}</Text> : null}
      </View>
      <View className="flex-row items-center gap-x-4">
        {age?.offerRefresh ? (
          <Pressable accessibilityRole="button" onPress={onRefresh} className="rounded-lg border border-zinc-700 px-3 py-1">
            <Text className="text-sm text-zinc-200">Refresh</Text>
          </Pressable>
        ) : null}
        <AboutLink />
      </View>
    </View>
  );
}

/** An empty Explore (2c design, section 11): when a post appears there, in the formula's numbers, with the rules and a way on. */
export function ExploreEmpty({ onShowLatest, formula = EXPLORE_V1 }: { onShowLatest: () => void; formula?: ExploreFormula }) {
  return (
    <View className="items-center px-4 py-10">
      <Text className="mb-3 text-center text-base leading-6 text-zinc-400">{exploreEmptyText(formula)}</Text>
      <AboutLink />
      <Pressable accessibilityRole="button" onPress={onShowLatest} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
        <Text className="text-sm text-zinc-200">Show Latest</Text>
      </Pressable>
    </View>
  );
}

/**
 * The end of the list. The status line is always in the tree, so a screen reader hears the refresh notice when it
 * appears, and it can take the focus when Load more, which had it, leaves; then an error beside posts already shown, Load
 * more while the ranking has more, and, for a signed-out reader, who never gets a cursor, the way to see more.
 */
export function ExploreFooter({
  cursor,
  signInForMore,
  notice,
  error,
  onLoadMore,
  statusRef,
}: {
  cursor: string | null;
  signInForMore: boolean;
  notice: string | null;
  error: string | null;
  onLoadMore: () => void;
  statusRef?: Ref<View>;
}) {
  return (
    <View className="items-center py-4">
      <View ref={statusRef} role="status" aria-live="polite" tabIndex={-1}>
        {notice ? <Text className="mb-2 px-4 text-center text-sm text-zinc-300">{notice}</Text> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      {cursor ? (
        <Pressable accessibilityRole="button" onPress={onLoadMore} className="rounded-lg border border-zinc-700 px-4 py-2">
          <Text className="text-sm text-zinc-200">Load more</Text>
        </Pressable>
      ) : null}
      {signInForMore ? (
        <Link href="/signin" asChild>
          <Pressable className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Sign in to see more of Explore</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

/**
 * Explore under Home's tabs (2c design, section 11), on PagedList's pattern. Its reads go through one exploreReader made
 * with the list, which lets one read run at a time and answers what the list shows; the component only puts that on
 * screen. A cursor names the ranking it came from; when a refresh has pruned that ranking, the reader reads the current
 * one from its first page and adds only the posts not on screen, so the posts already read stay where they are, the focus
 * stays at the footer and the status line says what happened. Home remounts the list for another tab, a new post or
 * another reader. The answers live in this component and its reader alone: nothing keeps them once it unmounts.
 */
export function ExploreList({ onShowLatest }: { onShowLatest: () => void }) {
  const [reader] = useState(() => exploreReader(social.explore));
  const [shown, setShown] = useState<ExploreShown>(NOTHING_SHOWN);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [lineFocus, setLineFocus] = useState(0);
  const footer = useRef<View>(null);
  const line = useRef<View>(null);

  const load = useCallback(
    async (after?: string, focusLine = false) => {
      setNotice(null);
      try {
        const answer = await reader.load(after);
        // Another read is in flight: its answer, still to come, is what the list shows, and it ends the refresh.
        if (!answer) return;
        setShown(answer);
        setError(null);
        if (answer.refreshed) {
          setNotice(EXPLORE_REFRESHED_NOTICE);
          setRefreshes((count) => count + 1);
        }
        if (focusLine) setLineFocus((count) => count + 1);
      } catch (err) {
        setError(errorMessage(err));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [reader],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Pull to refresh and the header's Refresh read the first page again, in place of the posts on screen.
  const refresh = (focusLine: boolean) => {
    setRefreshing(true);
    void load(undefined, focusLine);
  };

  // After a refresh the focus stays at the footer: Load more keeps it while the new ranking has more, and when the ranking
  // ended, Load more has left the tree with the focus, so the status line takes it.
  useEffect(() => {
    if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [refreshes]);

  // After the header's Refresh the line saying how old the ranking now is takes the focus: the button leaves the tree
  // once the ranking it read is fresh.
  useEffect(() => {
    if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [lineFocus]);

  const remove = (id: string) => setShown(reader.remove(id));

  return (
    <FlatList
      data={shown.items}
      keyExtractor={(item) => item.post.id}
      renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}
      ListHeaderComponent={<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />}
      refreshing={refreshing}
      onRefresh={() => refresh(false)}
      ListEmptyComponent={
        loading ? null : error ? (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole="alert" className="text-center text-base text-zinc-400">
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ExploreEmpty onShowLatest={onShowLatest} />
        )
      }
      ListFooterComponent={
        <ExploreFooter
          cursor={shown.cursor}
          signInForMore={shown.signInForMore}
          notice={notice}
          error={shown.items.length > 0 ? error : null}
          onLoadMore={() => {
            if (shown.cursor) void load(shown.cursor);
          }}
          statusRef={footer}
        />
      }
    />
  );
}
```

### Replace `apps/app/src/lib/explore.ts` (whole file)

```ts
import { EXPLORE_V1, type ExploreFormula, type ExplorePage, type ExploreStatusKind, type TimelineItem } from "@korbat/contracts";
import { ApiError } from "./api";
import type { ExploreAnswer } from "./social";

/**
 * Explore's texts and the list's decisions (2c design, section 11). Every number in a sentence comes from the formula it
 * is given, EXPLORE_V1 unless a test passes another, so the app says what the refresh does.
 */

/** A ranking older than this when it is read is stale: rounds run every 5 minutes, so by then several have failed or been skipped. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** What the list's status line says once the ranking being paged is gone and the posts below it come from the current one. */
export const EXPLORE_REFRESHED_NOTICE = "Explore was refreshed; the posts below come from the new ranking.";

/** A page of Explore is the API's default of 20 posts, and a ranking holds at most listLength: one read never needs more pages than this. */
export const MAX_PAGES = Math.ceil(EXPLORE_V1.listLength / 20) + 1;

/** "1 minute", "5 minutes". */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Hours as the texts say them: whole days in days ("2 days"), anything else in hours. */
function duration(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small count as a sentence says it ("two of your posts"); anything larger stays in digits. */
function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}

/** When a stale ranking was computed: the time alone on the same day, the date and the time on any other. */
function since(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString()} ${time}`;
}

/**
 * The ranking on screen as the list read it: when it was computed, the Date header of the answer that carried it (the
 * server's clock then, or null when the answer had none) and the device's clock when that answer arrived.
 */
export interface RankingRead {
  computedAt: string;
  date: string | null;
  receivedAt: number;
}

/**
 * How old the ranking was when it was read: by the answer's Date header, the server's own clock, as the smoke test
 * measures it, so a device clock that is fast or slow changes nothing; by the device's clock only when the header is
 * missing. Never below zero: the header counts whole seconds, so a ranking of the same second would seem to be from the future.
 */
function ageAtRead(ranking: RankingRead): number {
  const served = ranking.date === null ? Number.NaN : Date.parse(ranking.date);
  return Math.max(0, (Number.isNaN(served) ? ranking.receivedAt : served) - Date.parse(ranking.computedAt));
}

/**
 * The line under the tabs, and whether to offer Refresh. Whether the ranking is stale is decided by its age when it was
 * read: past 15 minutes the line says since when Explore has not been updated, which the header shows as a warning. A page
 * left open never turns stale, since the job has written newer rankings meanwhile; its minutes go on from the age when
 * read by the time on screen, which the device's clock measures alone. Refresh is offered once the ranking on screen is
 * as old as the refresh interval, when a newer one should exist.
 */
export function rankingAge(ranking: RankingRead, now: number, formula: ExploreFormula = EXPLORE_V1): { stale: boolean; text: string; offerRefresh: boolean } {
  const atRead = ageAtRead(ranking);
  // The minute clock may last have ticked before the answer arrived: then there has been no time on screen yet.
  const age = atRead + Math.max(0, now - ranking.receivedAt);
  const offerRefresh = age >= formula.refreshMinutes * 60_000;
  if (atRead > STALE_AFTER_MS) return { stale: true, text: `Explore has not been updated since ${since(new Date(ranking.computedAt), new Date(now))}.`, offerRefresh };
  const minutes = Math.floor(age / 60_000);
  return { stale: false, text: minutes === 0 ? "Updated just now" : `Updated ${plural(minutes, "minute")} ago`, offerRefresh };
}

/**
 * What one page adds below the posts on screen: its posts not shown yet, in the ranking's order. Within one ranking the
 * pages never overlap, but after a refresh the new ranking holds posts already shown, and a page can also come back empty
 * when the reader's blocks and mutes took out every post on it. So the next page is read only while a page adds nothing
 * and a cursor follows it: the read stops at the first page that adds some, or at the ranking's end.
 */
export function appendUnseen(shown: ReadonlySet<string>, page: Pick<ExplorePage, "items" | "nextCursor">): { added: TimelineItem[]; nextCursor: string | null; fetchNext: boolean } {
  const seen = new Set(shown);
  const added = page.items.filter((item) => {
    if (seen.has(item.post.id)) return false;
    seen.add(item.post.id);
    return true;
  });
  return { added, nextCursor: page.nextCursor, fetchNext: added.length === 0 && page.nextCursor !== null };
}

export interface PagesRead<P extends ExplorePage = ExplorePage> {
  /** The posts to show below those on screen (or in their place, for a read from the first page), in the ranking's order. */
  added: TimelineItem[];
  /** Load more's cursor, null once the ranking has ended. */
  nextCursor: string | null;
  /** The last page read, whose computedAt and signInForMore the list shows; null only when no page came back. */
  last: P | null;
  /** The ranking being paged was gone (explore_refreshed), and what was added comes from the current one. */
  refreshed: boolean;
}

/**
 * One load of the list: pages from `after` on (the first page when it is undefined), as appendUnseen decides. A cursor
 * names the ranking it came from; when that ranking is no longer kept, the API refuses it with explore_refreshed and the
 * read starts again at the current ranking's first page, still skipping every post on screen, as section 11 of the design
 * says. Any other failure is the caller's to show, and one read never goes through more than `maxPages` pages. The pages
 * come back as `fetchPage` answers them, so the last one keeps whatever the client read with it.
 */
export async function readPages<P extends ExplorePage>(
  fetchPage: (cursor?: string) => Promise<P>,
  after: string | undefined,
  shown: ReadonlySet<string>,
  maxPages: number = MAX_PAGES,
): Promise<PagesRead<P>> {
  const seen = new Set(shown);
  const added: TimelineItem[] = [];
  let cursor = after;
  let last: P | null = null;
  let refreshed = false;
  for (let pages = 0; pages < maxPages; pages++) {
    let page: P;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      // Only a cursor names a ranking: the first page is always the current one, so a refusal of it is an ordinary failure.
      if (cursor === undefined || !(err instanceof ApiError && err.code === "explore_refreshed")) throw err;
      refreshed = true;
      cursor = undefined;
      continue;
    }
    const step = appendUnseen(seen, page);
    for (const item of step.added) {
      seen.add(item.post.id);
      added.push(item);
    }
    last = page;
    if (!step.fetchNext) return { added, nextCursor: step.nextCursor, last, refreshed };
    cursor = step.nextCursor ?? undefined;
  }
  // The bound was reached with more to read: Load more carries on from here.
  return { added, nextCursor: cursor ?? null, last, refreshed };
}

/** What the Explore list shows: its posts in order, Load more's cursor, the ranking on screen and, signed out, whether more exist. */
export interface ExploreShown {
  items: TimelineItem[];
  /** Load more's cursor: null once the ranking has ended, and always for a signed-out reader. */
  cursor: string | null;
  /** The ranking on screen as it was read, which the header ages; null before the first round. */
  ranking: RankingRead | null;
  /** Signed out, whether posts follow the page shown, which the list's footer then offers after a sign-in. */
  signInForMore: boolean;
}

/** A list that has read nothing yet. */
export const NOTHING_SHOWN: ExploreShown = { items: [], cursor: null, ranking: null, signInForMore: false };

/**
 * The Explore list's reads (2c design, section 11), made once per list and gone with it: it holds what the list shows and
 * lets one read run at a time, so a double press on Load more cannot append a page twice and a refresh cannot land between
 * the pages of a read. `load()` reads from the first page, in place of everything on screen (the first read, pull to
 * refresh, Refresh); `load(cursor)` reads after that cursor, below the posts on screen, which a page of a new ranking
 * cannot add again (readPages). Either answers what the list shows then, with whether the ranking being paged was gone,
 * or null, having fetched nothing, while another read runs; a failed read throws and leaves what the list shows as it was.
 */
export function exploreReader(fetchPage: (cursor?: string) => Promise<ExploreAnswer>, maxPages: number = MAX_PAGES) {
  let shown = NOTHING_SHOWN;
  let inFlight = false;
  return {
    async load(after?: string): Promise<(ExploreShown & { refreshed: boolean }) | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        const fromStart = after === undefined;
        const result = await readPages(fetchPage, after, new Set(fromStart ? [] : shown.items.map((item) => item.post.id)), maxPages);
        const last = result.last;
        // From the posts on screen now, not when the read began: one may have been deleted from the list meanwhile.
        shown = {
          items: fromStart ? result.added : [...shown.items, ...result.added],
          cursor: result.nextCursor,
          ranking: last === null ? shown.ranking : last.computedAt === null ? null : { computedAt: last.computedAt, date: last.date, receivedAt: last.receivedAt },
          signInForMore: last === null ? shown.signInForMore : last.signInForMore,
        };
        return { ...shown, refreshed: result.refreshed };
      } finally {
        inFlight = false;
      }
    },
    /** Takes a post its author deleted off the list; a read in flight answers without it too. */
    remove(id: string): ExploreShown {
      shown = { ...shown, items: shown.items.filter((item) => item.post.id !== id) };
      return shown;
    },
  };
}

/** The empty list's sentence (2c design, section 11): when a post appears in Explore, and how often it is refreshed. */
export function exploreEmptyText(formula: ExploreFormula = EXPLORE_V1): string {
  return (
    `Nothing to show in Explore right now. A post appears here when at least ${formula.threshold} other accounts, ` +
    `each at least ${duration(formula.engagerMinAgeHours)} old, like or repost it in its first ${plural(formula.windowHours, "hour")}. ` +
    `Explore is refreshed every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The one sentence beside "Show my posts in Explore". Off takes the posts out at the next read. On lets them back at the
 * next refresh (a post still in the current ranking may show again sooner), so the sentence promises no earlier than that.
 */
export function exploreSwitchText(formula: ExploreFormula = EXPLORE_V1): string {
  return (
    "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at " +
    `once, and turning it back on takes effect at the next refresh, which comes every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The author's status line under their own post, in the formula's words and without any count (2c design, sections 8 and
 * 11). Replies and quotes never enter Explore, and their line is left out: null.
 */
export function exploreStatusText(status: ExploreStatusKind, formula: ExploreFormula = EXPLORE_V1): string | null {
  switch (status) {
    case "reply":
    case "quote":
      return null;
    case "not_visible":
      return "Not in Explore: posts under review or removed never appear there.";
    case "hidden_by_author":
      return "Not in Explore: you turned off Show my posts in Explore.";
    case "listed":
      return "In Explore";
    case "outside_window":
      return `Not in Explore: posts can appear only in their first ${plural(formula.windowHours, "hour")}.`;
    case "no_ranking":
      return "Not in Explore yet: the first ranking has not been computed.";
    case "new_since_ranking":
      return "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.";
    case "below_threshold":
      return (
        `Not in Explore: fewer than ${formula.threshold} approving accounts. Your own likes, accounts under ` +
        `${duration(formula.engagerMinAgeHours)} old and likes from the last ${plural(formula.standingMinutes, "minute")} do not count.`
      );
    case "pending":
      return "Not in Explore yet: the next refresh will consider it.";
    case "author_cap":
      // The cap keeps an author's highest-scoring posts, so with the author's places full, those posts ranked above this one.
      return formula.perAuthor === 1 ? "Not in Explore: one of your posts ranks above it." : `Not in Explore: ${numberWord(formula.perAuthor)} of your posts rank above it.`;
    case "below_cutoff":
      return `Not in Explore: it ranks below the ${formula.listLength} posts Explore holds.`;
  }
}

/**
 * How Explore works (2c design, section 11): what is ranked, what counts, the score, the list, the refresh, the cold start,
 * what else takes a post out, and the author's controls, with every number from the formula. The page adds the formula's
 * version and change log.
 */
export function exploreRules(formula: ExploreFormula = EXPLORE_V1): { title: string; body: string }[] {
  const engagerAge = duration(formula.engagerMinAgeHours);
  return [
    {
      title: "What is ranked",
      body:
        `Original posts from the last ${plural(formula.windowHours, "hour")}: posts that are not replies or quotes, by accounts that ` +
        "have not switched Explore off. Replies belong to their threads. Quotes do not enter, because a quote that mocks " +
        "another post would put that post under the mockery on a public page.",
    },
    {
      title: "What counts",
      body:
        "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An " +
        "account that both liked and reposted a post counts once. A like or repost counts when its account still exists, " +
        `was at least ${engagerAge} old when it liked or reposted, and the like or repost has stood for at least ` +
        `${plural(formula.standingMinutes, "minute")}. Replies and quotes do not count, so a pile-on of replies cannot lift a ` +
        "post. Followers, the verified badge and reports are never used.",
    },
    {
      title: "The score",
      body:
        `A post needs at least ${formula.threshold} approving accounts. Its score is the number of approving accounts divided ` +
        `by (the hours since it was posted + ${formula.offsetHours}) to the power ${formula.gravity}, so a newer post needs ` +
        "fewer approving accounts to rank as high as an older one.",
    },
    {
      title: "The list",
      body:
        `Explore holds the ${formula.listLength} posts with the highest scores, with at most ${formula.perAuthor} posts of one ` +
        "account: that account's highest-scoring ones. Posts with equal scores are ordered by their ids. Only the order is " +
        "shown: no score, rank or count.",
    },
    {
      title: "The refresh",
      body:
        `A new ranking is computed every ${plural(formula.refreshMinutes, "minute")}, never sooner than ` +
        `${plural(formula.minGapMinutes, "minute")} after the last one. The newest ${formula.kept} rankings are kept, so you ` +
        "can finish paging through the one you started; once it is gone, the list says so and goes on with the newest one. " +
        `Signed out, you see the first ${formula.signedOutPage} posts.`,
    },
    {
      title: "A new korbat",
      body:
        `Only accounts at least ${engagerAge} old count, so on a new korbat Explore stays empty for about ${engagerAge} after ` +
        `it opens. A like or repost made in an account's first ${engagerAge} never counts, even after the account is older.`,
    },
    {
      title: "What else takes a post out",
      body:
        "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator or by the " +
        "automatic R1 and R2 checks for every list at once; its author's switch or deletion; a block between you and the " +
        "author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    },
    {
      title: "Your posts",
      body:
        "Show my posts in Explore, in Settings > Privacy, keeps your posts out: turning it off takes them out at once, and " +
        "turning it back on takes effect at the next refresh. The page of each of your posts says whether it is in Explore " +
        "and, if not, which rule keeps it out, without counting who liked it.",
    },
  ];
}
```

### Replace `apps/app/src/lib/social.ts` (whole file)

```ts
import {
  BlockResponse,
  EngagementResponse,
  ExplorePage,
  ExploreSettingResponse,
  ExploreStatus,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostId,
  PostPage,
  PostView,
  type ProfileEditRequest,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { z } from "zod";
import { api, apiResponse } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A page of Explore as it arrived: with the answer's Date header, the server's clock when it answered (null when the
 * answer has none), and the device's clock on arrival. The list ages the ranking by the first and counts the time on
 * screen from the second, so the device's clock is never compared with the server's.
 */
export type ExploreAnswer = ExplorePage & { date: string | null; receivedAt: number };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** The signed-in account's own profile as the editing routes answer it: the public view, since /api/me carries no bio. */
const OwnProfileResponse = z.object({ profile: ProfileView });

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(postPath(id), { schema: PostView }),
  deletePost: (id: string) => api(postPath(id), { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`${postPath(id)}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`${postPath(id)}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),
  /** Why the author's own post is in Explore or not, with no count (2c design, section 8); anyone else gets not_found. */
  exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

  following: (cursor?: string) => api(`/api/timeline/following${query(cursor)}`, { schema: TimelinePage }),
  latest: (cursor?: string) => api(`/api/timeline/latest${query(cursor)}`, { schema: TimelinePage }),
  /**
   * A page of Explore (2c design, section 8). Its cursor names the ranking it came from, which a refresh can prune
   * (explore_refreshed); signed out, the first page is all there is, and signInForMore says whether more exist. The web
   * app is served from the API's origin, so the answer's Date header can be read, and it is kept with the page; an API on
   * another origin would hide it from the browser, and the list then ages the ranking by the device's clock.
   */
  explore: async (cursor?: string): Promise<ExploreAnswer> => {
    const res = await apiResponse(`/api/timeline/explore${query(cursor)}`);
    const page = ExplorePage.parse(await res.json());
    return { ...page, date: res.headers.get("date"), receivedAt: Date.now() };
  },
  /** The first three posts of Explore, for the context column's Popular now. */
  popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),

  /** Either field or both; the caller refreshes the session afterwards, so the shell's Profile link follows a new name. */
  editProfile: (edit: ProfileEditRequest) => api("/api/me/profile", { method: "PATCH", json: edit, schema: OwnProfileResponse }),
  /** Needs fresh authentication: the caller runs it through useReauth. */
  changeHandle: (handle: string) => api("/api/me/handle", { json: { handle }, schema: OwnProfileResponse }),
  /** "Show my posts in Explore", on or off, with no body as the other switches; the caller refreshes the session, whose /api/me carries it. */
  setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),
};

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  32 passed (32)
packages/contracts test:       Tests  106 passed (106)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  107 passed (107)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  444 passed | 289 skipped (733)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  287 passed (287)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 9: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 10: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 11: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 12: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 13: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 14: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 15: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 16: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/flows/explore.ts`
- `apps/api/test/integration/social-explore-reads.test.ts`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/post/[id].tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/components/social/ExploreList.tsx`
- `apps/app/src/lib/explore.ts`
- `apps/app/src/lib/social.ts`
- `apps/app/test/explore.test.tsx`

## Step 17: commit

```bash
git add -A
git commit -q -m "fix(api,app): what the review of 2c upheld, fixed: a cursor sent before any ranking exists is 400, as for any generation not yet written; the signed-out Explore prompt promises nothing the list may not hold; the ranking's age is judged when it is read, against the answer's Date header, so a page left open or a fast device clock never shows the stale warning, and a Refresh button reads the newest ranking once the one on screen is five minutes old; Home's lists are keyed by their reader, so a sign-in reads them again; the author's post screen reads its Explore status and post again whenever it gains focus; the Explore switch keeps its saving state and its error across the Blocked and Muted tabs; the list's reads live in a reader object tested directly; a test pins the one-way mute" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(api,app): what the review of 2c upheld, fixed: a cursor sent before any ranking exists is 400, as for any generation not yet written; the signed-out Explore prompt promises nothing the list may not hold; the ranking's age is judged when it is read, against the answer's Date header, so a page left open or a fast device clock never shows the stale warning, and a Refresh button reads the newest ranking once the one on screen is five minutes old; Home's lists are keyed by their reader, so a sign-in reads them again; the author's post screen reads its Explore status and post again whenever it gains focus; the Explore switch keeps its saving state and its error across the Blocked and Muted tabs; the list's reads live in a reader object tested directly; a test pins the one-way mute`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 9>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
