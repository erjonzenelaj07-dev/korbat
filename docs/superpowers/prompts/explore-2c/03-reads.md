# korbat explore (2c) — Task 3 of 6: The Explore reads: the page with its own strict cursor, the author-only status judged with the ranking's own rules, the switch's routes, MeProfile.showInExplore and the export's field, and the In Explore chip on the author's own listed posts

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-28 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend: a Hono API on Node 24, an Expo web app, PostgreSQL 18 and Valkey in Docker Compose. Sub-project 2c adds Explore, a ranked list of recent original posts. Tasks 1 and 2 laid the ground (EXPLORE_V1, the Explore contracts, migration 0011) and wrote the ranking (`refreshExplore` in the social repository and the `explore-refresh` job). This task delivers the reads: the page `GET /api/timeline/explore` with its own cursor, the author's status `GET /api/posts/:id/explore`, the switch `POST`/`DELETE /api/me/explore` with `MeProfile.showInExplore` and the export's field, and `PostView.inExplore` on the author's own listed posts. The design is `docs/superpowers/specs/2026-09-28-explore-2c-design.md` (section 8).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api): the Explore ranking and its job: refreshExplore ranks, in one transaction with statement and lock timeouts, the visible top-level original posts of live authors who show in Explore from the last 48 hours by their distinct eligible approving accounts with gravity decay, at most two per author and 300 places, every number of the formula a parameter; a round within 4.5 minutes of the last writes nothing and only the two newest generations stay; the explore-refresh job runs a round at start, caught, then one every five minutes, and logs only the generation, the counts and the milliseconds`.

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
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/03-reads.md 1
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/explore-fixtures.ts`

```ts
import { sql } from "drizzle-orm";
import pino from "pino";
import { expect } from "vitest";
import type { ExploreFormula, ExplorePage } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createSocialRepo, type ExploreRefresh, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile } from "./social-fixtures";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * The integration suites share one database, so Explore's suites rank as of times in pasts of their own (the ranking
 * suite from 2020, the job suite from 2021, the read suite from 2022, the HTTP suite from 2023): every row another suite
 * writes is dated around the time it runs, after every ranking here, and never enters. Each test ranks in a span of ten
 * days of its own, so no test's posts or engagement fall in another test's 48-hour window either.
 */
export const SPAN = 10 * DAY;

/** Hands out the refresh time of each new test: three days into the next span of ten days from `epoch`. */
export function spans(epoch: number): () => Date {
  let next = 0;
  return () => new Date(epoch + next++ * SPAN + 3 * DAY);
}

export const before = (at: Date, ms: number): Date => new Date(at.getTime() - ms);
export const after = (at: Date, ms: number): Date => new Date(at.getTime() + ms);

/** Accounts created a month before `asOf`: old enough for every like or repost they make around it to count. */
export function accounts(db: Db, asOf: Date, n: number) {
  return Promise.all(Array.from({ length: n }, () => newProfile(db, { createdAt: before(asOf, 30 * DAY) })));
}

/** Each of `users` likes the post at `at`, through the repository. */
export async function likedBy(repo: SocialRepo, postId: string, users: { id: string }[], at: Date): Promise<void> {
  for (const user of users) expect(await repo.like(user.id, postId, at)).toBe(true);
}

/** A top-level post by `author` written at `at` and liked by each of `fans` at `likedAt`; with three fans or more it ranks. */
export async function approvedPost(repo: SocialRepo, author: { id: string }, at: Date, fans: { id: string }[], likedAt: Date): Promise<string> {
  const id = await newPost(repo, author.id, at);
  await likedBy(repo, id, fans, likedAt);
  return id;
}

/** A round that must rank; its answer, whose generation the test reads. */
export async function rank(repo: SocialRepo, asOf: Date, formula?: ExploreFormula): Promise<Extract<ExploreRefresh, { skipped: false }>> {
  const result = await repo.refreshExplore(asOf, formula);
  if (result.skipped) throw new Error("the round skipped");
  return result;
}

/** The posts of a ranking in order, as the refresh wrote them. */
export async function listed(db: Db, generation: number): Promise<string[]> {
  const rows = (await db.execute(sql`select post_id from explore_items where generation = ${generation} order by position`)) as unknown as { post_id: string }[];
  return rows.map((row) => row.post_id);
}

/** The posts of an Explore page, in its order. */
export const pageIds = (page: ExplorePage): string[] => page.items.map((item) => item.post.id);

/**
 * The social module's dependencies on this database, as the flows take them, with a clock the test sets: the author's
 * status judges "now" by it, and a write made through a flow is dated by it.
 */
export function exploreDeps(db: Db) {
  let now = new Date(0);
  const deps: SocialDeps = {
    repo: createSocialRepo(db),
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => now.getTime()),
    log: pino({ level: "silent" }),
    now: () => now,
  };
  return {
    deps,
    repo: deps.repo,
    setNow: (at: Date) => {
      now = at;
    },
  };
}
```

### Create `apps/api/test/integration/http-explore.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExplorePage, ExploreSettingResponse, ExploreStatus, ExportFormat, FlowResponse, MeResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import type { MediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, type Social } from "../../src/social";
import { HOUR, MINUTE, accounts, after, approvedPost, before, listed, pageIds, rank, spans } from "./explore-fixtures";
import { Browser } from "./http-client";
import { newPost } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

/**
 * This suite's past (see explore-fixtures.ts): the social module's clock and its rankings run in 2023, each test in a span
 * of its own. The auth module keeps the real clock, so sessions are fresh and the export's freshness check passes; the
 * accounts that sign up are therefore younger than their posts, which only an engaging account's age would matter for.
 */
const EPOCH = Date.UTC(2023, 0, 1);

/**
 * Explore's routes through the real app: 1a sign-up for the accounts that read, cookie sessions with CSRF, the social
 * module on this database with the clock the tests set, and the account module for the export, whose images these
 * accounts do not have.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Explore over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let social: Social;
  let app: App;
  const mailer = new MemoryMailer();
  let clock = new Date(EPOCH);
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    social = createSocial({
      apiDb,
      rateLimitStore,
      logger,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      events: { append: auth.appendEvent },
      now: () => clock,
    });
    const noImages: MediaForAccount = { purgeOwner: async () => [], requestDeletion: async () => undefined, exportImages: async () => [] };
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: noImages,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, account });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await apiDb.execute(sql`delete from explore_runs`);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `explore-${randomUUID()}@korbat.local`;
    const handle = `e${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorOf = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((event) => event.type);

  /** An Explore page through the app, signed out unless a browser is given, checked against the contract and the header every answer carries. */
  async function explore(query: string, b?: Browser): Promise<ExplorePage> {
    const path = `/api/timeline/explore${query}`;
    const res = b ? await b.fetch(path) : await app.request(path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get("cache-control"), path).toBe("no-store");
    return ExplorePage.parse(await res.json());
  }

  /** `n` posts by as many authors, each liked by the same three accounts at one time, and the ranking of them in order. */
  async function ranked(asOf: Date, n: number): Promise<string[]> {
    const authors = await accounts(apiDb, asOf, n);
    const fans = await accounts(apiDb, asOf, 3);
    for (const author of authors) await approvedPost(social.deps.repo, author, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const order = await listed(apiDb, (await rank(social.deps.repo, asOf)).generation);
    expect(order).toHaveLength(n);
    return order;
  }

  test("signed out: one page of at most 20 posts whatever the limit asks, no cursor, the sign-in prompt while more follow, and the ranking's time", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 21);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();

    for (const query of ["?limit=50", "", "?limit=20"]) {
      const page = await explore(query);
      expect(pageIds(page), query).toEqual(order.slice(0, 20));
      expect(page, query).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });
    }
    const five = await explore("?limit=5");
    expect(pageIds(five)).toEqual(order.slice(0, 5));
    expect(five).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });

    // A signed-in reader is not capped, and has a cursor rather than a prompt when more follow.
    const reader = await signUp();
    const all = await explore("?limit=50", reader.b);
    expect(pageIds(all)).toEqual(order);
    expect(all).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });

    // The extra row that decides the prompt is read through the same filters as the page: with the first post withheld,
    // the twenty left are all there is.
    await apiDb.execute(sql`update posts set state = 'withheld' where id = ${order[0]!}::uuid`);
    const rest = await explore("?limit=50");
    expect(pageIds(rest)).toEqual(order.slice(1));
    expect(rest).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });
  });

  test("a signed-out request with a cursor is refused with 401 before anything is read; signed in, the cursor pages on, and every answer is no-store", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 5);
    clock = after(asOf, MINUTE);
    const reader = await signUp();
    const first = await explore("?limit=2", reader.b);
    expect(pageIds(first)).toEqual(order.slice(0, 2));
    expect(first).toMatchObject({ computedAt: asOf.toISOString(), signInForMore: false });
    const cursor = encodeURIComponent(first.nextCursor!);

    // Any cursor, a real one or not, asks for more than the first page, which needs an account.
    for (const query of [`?cursor=${cursor}`, `?limit=2&cursor=${cursor}`, "?cursor=not-a-cursor"]) {
      const refused = await app.request(`/api/timeline/explore${query}`);
      expect(refused.status, query).toBe(401);
      expect(refused.headers.get("cache-control"), query).toBe("no-store");
      expect(await errorOf(refused), query).toMatchObject({ code: "unauthenticated", message: "Sign in to see more of Explore." });
    }

    const second = await explore(`?limit=2&cursor=${cursor}`, reader.b);
    const third = await explore(`?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`, reader.b);
    expect([...pageIds(first), ...pageIds(second), ...pageIds(third)]).toEqual(order);
    expect(third).toMatchObject({ nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Signed in, a cursor that is not one is the request's fault, not a reason to sign in.
    const bad = await reader.b.fetch("/api/timeline/explore?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe("invalid_request");
  });

  test("the status route answers the post's author only: not_found for anyone else and for an unknown post, 401 signed out", async () => {
    const asOf = nextAsOf();
    const [ada, bob] = [await signUp(), await signUp()];
    const fans = await accounts(apiDb, asOf, 3);
    const inExplore = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const quiet = await newPost(social.deps.repo, ada.userId, before(asOf, 2 * HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();
    const statusPath = (id: string) => `/api/posts/${id}/explore`;

    const answered = await ada.b.fetch(statusPath(inExplore));
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    const body = (await answered.json()) as Record<string, unknown>;
    expect(ExploreStatus.parse(body)).toEqual({ status: "listed", computedAt });
    // The reason and the ranking's time, and nothing else: no count, no score.
    expect(Object.keys(body).sort()).toEqual(["computedAt", "status"]);
    expect(await (await ada.b.fetch(statusPath(quiet))).json()).toEqual({ status: "below_threshold", computedAt });

    for (const id of [inExplore, quiet]) {
      const other = await bob.b.fetch(statusPath(id));
      expect(other.status).toBe(404);
      expect((await errorOf(other)).code).toBe("not_found");
      const signedOut = await app.request(statusPath(id));
      expect(signedOut.status).toBe(401);
      expect((await errorOf(signedOut)).code).toBe("unauthenticated");
    }
    const unknown = await ada.b.fetch(statusPath(randomUUID()));
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("not_found");
    expect((await ada.b.fetch(statusPath("not-a-post"))).status).toBe(400);
  });

  test("POST turns the Explore switch on and DELETE off, for an onboarded session and without an event; /api/me reads it, and a listed post leaves at the next read", async () => {
    const asOf = nextAsOf();
    const ada = await signUp();
    const fans = await accounts(apiDb, asOf, 3);
    const id = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const me = async () => MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).profile!;
    const turn = async (method: "POST" | "DELETE") => {
      const res = await ada.b.fetch("/api/me/explore", { method });
      expect(res.status, method).toBe(200);
      return ExploreSettingResponse.parse(await res.json());
    };
    expect((await me()).showInExplore).toBe(true);
    expect(pageIds(await explore(""))).toEqual([id]);
    const events = await eventTypes(ada.userId);

    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect((await me()).showInExplore).toBe(false);
    // At the next read, before any further round.
    expect(pageIds(await explore(""))).toEqual([]);
    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect(await turn("POST")).toEqual({ showInExplore: true });
    expect((await me()).showInExplore).toBe(true);
    expect(await turn("POST")).toEqual({ showInExplore: true });
    // No event records the switch.
    expect(await eventTypes(ada.userId)).toEqual(events);
    // The switch is the author's own: the public profile never shows it.
    const profile = (await (await app.request(`/api/profiles/${ada.handle}`)).json()) as Record<string, unknown>;
    expect(profile.id).toBe(ada.userId);
    expect(profile).not.toHaveProperty("showInExplore");

    const early = await signUp(false);
    for (const method of ["POST", "DELETE"]) {
      const anonymous = await app.request("/api/me/explore", { method });
      expect(anonymous.status, method).toBe(401);
      expect((await errorOf(anonymous)).code, method).toBe("unauthenticated");
      const notOnboarded = await early.b.fetch("/api/me/explore", { method });
      expect(notOnboarded.status, method).toBe(403);
      expect((await errorOf(notOnboarded)).code, method).toBe("onboarding_required");
    }
  });

  test("the data export carries the Explore switch as it stands", async () => {
    const [on, off] = [await signUp(), await signUp()];
    expect((await off.b.fetch("/api/me/explore", { method: "DELETE" })).status).toBe(200);
    const exported = async (b: Browser) => {
      const res = await b.fetch("/api/account/export", { method: "POST" });
      expect(res.status).toBe(200);
      return ExportFormat.parse(JSON.parse(strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))["export.json"]!)));
    };
    expect((await exported(on.b)).profile).toMatchObject({ handle: on.handle, showInExplore: true });
    expect((await exported(off.b)).profile).toMatchObject({ handle: off.handle, showInExplore: false });
  });
});
```

### Create `apps/api/test/integration/social-explore-reads.test.ts`

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

  test("before the first round the page is empty, with no cursor, no time and no sign-in prompt, and the author's status is no_ranking", async () => {
    const asOf = nextAsOf();
    const [author, reader, ...fans] = await accounts(db, asOf, 5);
    // A post that would rank, so only the missing ranking keeps the page empty.
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(await read(null))).toEqual(empty);
    expect(await read(reader!.id)).toEqual(empty);
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
    // Two posts are left for the reader, and a page of two holds both: the filters come before the limit.
    const first = await read(reader!.id, { limit: 2 });
    expect(pageIds(first)).toEqual(order.slice(3));
    expect(first.nextCursor).not.toBeNull();
    expect(await read(reader!.id, { limit: 2, cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Only the reader's own relations count: signed out, and for the accounts on the other side, the ranking is whole.
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

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Deflate, strFromU8, unzipSync } from "fflate";
import { Hono, type MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { ExportedPost } from "../../src/social";
import type { HandleRefRow, PostRefRow } from "../../src/social/repo";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const silent = pino({ level: "silent" });
const KIB64 = 64 * 1024;
const TWO_32 = 0x1_0000_0000;

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
}

/** Opens a file as the media module's checked open answers: the handle with the size it measured, or null for no plain file. */
function openerOf(file: string): OpenFile {
  return async () => {
    let handle: FileHandle;
    try {
      handle = await open(file, "r");
    } catch {
      return null;
    }
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  };
}

/**
 * Collects the archive in memory. Every write takes a turn of the event loop, and a write that
 * starts while another is still pending is remembered: the writer must await each one.
 */
function memorySink() {
  const chunks: Uint8Array[] = [];
  let busy = false;
  let overlapped = false;
  return {
    async write(chunk: Uint8Array): Promise<void> {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunks.push(Uint8Array.from(chunk));
      busy = false;
    },
    bytes: (): Buffer => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/**
 * A stand-in for an opened store file: `size` bytes of `chunk` (zeros unless given), yielded lazily in
 * chunks of its length, failing once `failAfter` chunks were read when asked to. It records how many
 * chunks were read, whether the reading stopped and whether the handle was closed.
 */
function fakeFile(size: number, options: { failAfter?: number; chunk?: Uint8Array } = {}) {
  const chunk = options.chunk ?? new Uint8Array(KIB64);
  const state = { chunks: 0, stopped: false, closed: false };
  const handle = {
    createReadStream({ start = 0, end = size - 1 }: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
      return (async function* () {
        try {
          for (let at = start; at <= end; at += chunk.length) {
            if (options.failAfter !== undefined && state.chunks >= options.failAfter) throw new Error("the disk failed in the middle of the file");
            state.chunks += 1;
            yield at + chunk.length - 1 <= end ? chunk : chunk.subarray(0, end - at + 1);
          }
        } finally {
          state.stopped = true;
        }
      })();
    },
    async close() {
      state.closed = true;
    },
  };
  const opener: OpenFile = async () => ({ handle: handle as unknown as FileHandle, size });
  return { open: opener, state, chunk };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function* piecesOf(...pieces: string[]): AsyncGenerator<string> {
  yield* pieces;
}

/** One central directory entry as a reader finds it. */
interface CentralEntry {
  at: number;
  name: string;
  method: number;
  versionNeeded: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  /** The payload of the ZIP64 extra field (id 0x0001), as 64-bit values, or null without one. */
  zip64: number[] | null;
}

const u64 = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * TWO_32;

/** Every central directory entry in archive order, found by its signature (none of the test data holds it). */
function centralDirectory(archive: Uint8Array, base = 0): CentralEntry[] {
  const bytes = Buffer.from(archive);
  const entries: CentralEntry[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    let zip64: number[] | null = null;
    for (let at = i + 46 + nameLength; at + 4 <= i + 46 + nameLength + extraLength; at += 4 + bytes.readUInt16LE(at + 2)) {
      if (bytes.readUInt16LE(at) !== 0x0001) continue;
      const length = bytes.readUInt16LE(at + 2);
      zip64 = Array.from({ length: length / 8 }, (_, k) => u64(bytes, at + 4 + 8 * k));
    }
    entries.push({
      at: base + i,
      name: bytes.toString("utf8", i + 46, i + 46 + nameLength),
      method: bytes.readUInt16LE(i + 10),
      versionNeeded: bytes.readUInt16LE(i + 6),
      flags: bytes.readUInt16LE(i + 8),
      compressed: bytes.readUInt32LE(i + 20),
      size: bytes.readUInt32LE(i + 24),
      offset: bytes.readUInt32LE(i + 42),
      zip64,
    });
  }
  return entries;
}

/** The end records, read from the archive's last bytes as a reader does: the classic one, then the ZIP64 locator and record when present. */
function endRecords(archive: Uint8Array, base = 0) {
  const bytes = Buffer.from(archive);
  const at = bytes.length - 22;
  expect(bytes.readUInt32LE(at)).toBe(0x06054b50);
  const end = { entriesHere: bytes.readUInt16LE(at + 8), entries: bytes.readUInt16LE(at + 10), size: bytes.readUInt32LE(at + 12), offset: bytes.readUInt32LE(at + 16), comment: bytes.readUInt16LE(at + 20) };
  if (at < 20 || bytes.readUInt32LE(at - 20) !== 0x07064b50) return { end, locator: null, end64: null };
  const locator = { disk: bytes.readUInt32LE(at - 16), offset: u64(bytes, at - 12), disks: bytes.readUInt32LE(at - 4) };
  const r = locator.offset - base;
  expect(bytes.readUInt32LE(r)).toBe(0x06064b50);
  const end64 = {
    at: base + r,
    recordSize: u64(bytes, r + 4),
    versionMadeBy: bytes.readUInt16LE(r + 12),
    versionNeeded: bytes.readUInt16LE(r + 14),
    disk: bytes.readUInt32LE(r + 16),
    directoryDisk: bytes.readUInt32LE(r + 20),
    entriesHere: u64(bytes, r + 24),
    entries: u64(bytes, r + 32),
    size: u64(bytes, r + 40),
    offset: u64(bytes, r + 48),
  };
  return { end, locator, end64 };
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

interface Lists {
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions, one
 * device and two events; a profile with a post carrying two images and a deleted reply, one like, one
 * bookmark, a follow, a block and a mute; and whatever images the test puts in `images`. The social
 * fake hands each list out in pages of the size it is asked for, reading a page only when it is
 * iterated, and records every read in `reads`; a test may add rows to `lists`. `failures` makes the
 * next calls of a module read throw.
 */
function harness() {
  let t = T0;
  const images: { id: string; open: OpenFile }[] = [];
  const userId = randomUUID();
  // Sessions are named by their handles, as the auth module's export lists them; the hash of a token is in no part of the archive.
  const currentSession = randomUUID();
  const otherSession = randomUUID();
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0 };
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const account: AccountExport = {
    account: { id: userId, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
    // Newest first, as the auth module lists them: a plain key never used, added from a device since gone, and a synced one used yesterday.
    passkeys: [
      { name: "Security key", createdAt: new Date(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
      { name: "Laptop", createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
    ],
    sessions: [
      { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
      { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
    events: [
      { type: "signin_success", at: new Date(T0 - DAY_MS) },
      { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
    ],
  };
  const lists: Lists = {
    posts: [
      {
        id: postId,
        body: "two photos",
        createdAt: new Date(T0 - 2 * DAY_MS),
        replyToId: null,
        quoteOfId: null,
        state: "visible",
        deletedAt: null,
        media: [
          { id: imageA, altText: "a harbour at dawn", width: 1600, height: 1200 },
          { id: imageB, altText: "a lighthouse", width: 900, height: 1600 },
        ],
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [] },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
  };
  /** A list in pages of `pageSize`, each read when the one before has been used, as the social module pages its keyset reads. */
  function paged<T>(name: keyof Lists, rows: T[], pageSize: number): AsyncIterable<T[]> {
    return {
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += pageSize) {
          reads.push(name);
          const page = rows.slice(at, at + pageSize);
          if (page.length > 0) yield page;
          if (page.length < pageSize) return;
        }
      },
    };
  }
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: async () => {
        if (failures.exportAccount > 0) {
          failures.exportAccount -= 1;
          throw new Error("the auth pool timed out");
        }
        return account;
      },
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async (_id, pageSize = 1000) => ({
        // The Explore switch is off, not the column's default, so the export is seen to carry what the profile holds.
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false },
        posts: paged("posts", lists.posts, pageSize),
        likes: paged("likes", lists.likes, pageSize),
        reposts: paged("reposts", lists.reposts, pageSize),
        bookmarks: paged("bookmarks", lists.bookmarks, pageSize),
        following: paged("following", lists.following, pageSize),
        blocks: paged("blocks", lists.blocks, pageSize),
        mutes: paged("mutes", lists.mutes, pageSize),
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
    userId,
    currentSession,
    otherSession,
    postId,
    deletedId,
    likedId,
    bookmarkedId,
    imageA,
    imageB,
    images,
    events,
    lists,
    reads,
    failures,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** export.json as a document in memory, built from the harness's rows the way the export describes them, for JSON.stringify to write. */
function expectedDocument(h: Harness, missingMedia: string[] = []) {
  const ref = (row: PostRefRow) => ({ postId: row.postId, at: row.at.toISOString() });
  const other = (row: HandleRefRow) => ({ handle: row.handle, since: row.since.toISOString() });
  return {
    format: "korbat-export-1",
    exportedAt: iso(T0),
    account: {
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    },
    profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
    })),
    likes: h.lists.likes.map(ref),
    reposts: h.lists.reposts.map(ref),
    bookmarks: h.lists.bookmarks.map(ref),
    following: h.lists.following.map(other),
    blocks: h.lists.blocks.map(other),
    mutes: h.lists.mutes.map(other),
    sessions: [
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }],
    events: [
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ],
    missingMedia,
  };
}

/** More rows in every list than a few pages of two hold: text that JSON escapes, a line break inside a body, characters outside ASCII. */
function addManyRows(h: Harness): void {
  const quote = String.fromCharCode(34);
  const newline = String.fromCharCode(10);
  const accented = `caf${String.fromCharCode(0xe9)} ${String.fromCodePoint(0x1f600)}`;
  for (let i = 0; i < 5; i++) {
    h.lists.posts.push({
      id: randomUUID(),
      body: `post ${i}: ${quote}quoted${quote}${newline}second line, ${accented}`,
      createdAt: new Date(T0 - DAY_MS + i),
      replyToId: i % 2 === 0 ? h.postId : null,
      quoteOfId: i === 3 ? h.postId : null,
      state: i === 4 ? "withheld" : "visible",
      deletedAt: null,
      media: i === 1 ? [{ id: randomUUID(), altText: `alt ${accented}`, width: 10, height: 20 }] : [],
    });
  }
  for (let i = 0; i < 6; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 900 + i) });
  for (let i = 0; i < 3; i++) h.lists.reposts.push({ postId: randomUUID(), at: new Date(T0 - 800 + i) });
  for (let i = 0; i < 4; i++) h.lists.bookmarks.push({ postId: randomUUID(), at: new Date(T0 - 700 + i) });
  for (let i = 0; i < 5; i++) h.lists.following.push({ handle: `friend_${i}`, since: new Date(T0 - 600 + i) });
  for (let i = 0; i < 2; i++) h.lists.blocks.push({ handle: `blocked_${i}`, since: new Date(T0 - 500 + i) });
  for (let i = 0; i < 3; i++) h.lists.mutes.push({ handle: `muted_${i}`, since: new Date(T0 - 400 + i) });
}

/** How many reads a list of `rows` takes in pages of `size`: full pages, then the short (maybe empty) one that says it is over. */
const readsFor = (rows: number, size: number) => Math.floor(rows / size) + 1;

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, lists the passkeys with nothing of their keys, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(JSON.parse((await collect(exportJson(plan))).join("")));
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      // Inside the account, in the auth module's order (newest first), each as the five facts with the times as ISO text.
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    });
    expect(json.sessions).toEqual([
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ]);
    expect(json.devices).toEqual([{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }]);
    expect(json.events).toEqual([
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ]);
    // With the author's Explore switch as the profile holds it (off here); the byte-for-byte tests below place it after the handle history.
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false });
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0]).toEqual({
      id: h.postId,
      body: "two photos",
      createdAt: iso(T0 - 2 * DAY_MS),
      replyToId: null,
      quoteOfId: null,
      state: "visible",
      deletedAt: null,
      media: [
        { id: h.imageA, file: `media/${h.imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: h.imageB, file: `media/${h.imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [] });
    expect(json.likes).toEqual([{ postId: h.likedId, at: iso(T0 - DAY_MS) }]);
    expect(json.reposts).toEqual([]);
    expect(json.bookmarks).toEqual([{ postId: h.bookmarkedId, at: iso(T0 - 500) }]);
    expect(json.following).toEqual([{ handle: "bob", since: iso(T0 - 2 * DAY_MS) }]);
    expect(json.blocks).toEqual([{ handle: "eve", since: iso(T0 - DAY_MS) }]);
    expect(json.mutes).toEqual([{ handle: "carol", since: iso(T0 - 200) }]);
    expect(json.missingMedia).toEqual([]);
    expect(plan.images).toEqual([]);
    // Building the plan records nothing: the event belongs after the last chunk of the stream.
    expect(h.events).toEqual([]);
  });

  test("the images to write are the media module's, and the entry name is media/<id>.webp", async () => {
    const h = harness();
    h.images.push({ id: randomUUID(), open: openerOf(path.join(root, "a")) }, { id: randomUUID(), open: openerOf(path.join(root, "b")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
  });

  test("export.json is read list by list in pages and written piece by piece, byte for byte as JSON.stringify(document, null, 2) writes it", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    // Only the account and the profile's own fields are read up front; the lists wait for the JSON to be written.
    expect(h.reads).toEqual([]);
    const text = (await collect(exportJson(plan))).join("");
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    // Every list was read in pages of two, one page after the other, in the document's order.
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes"];
    expect(h.reads).toEqual(order.flatMap((name) => Array.from({ length: readsFor(h.lists[name].length, 2) }, () => name)));
    // The same account in one page per list is the same text.
    const whole = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect((await collect(exportJson(whole))).join("")).toBe(text);
  });

  test("empty lists and missing images are written as JSON.stringify writes them", async () => {
    const h = harness();
    for (const name of ["posts", "likes", "bookmarks", "following", "blocks", "mutes"] as const) h.lists[name].length = 0;
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 3);
    plan.missingMedia.push(h.imageA, h.imageB);
    expect((await collect(exportJson(plan))).join("")).toBe(JSON.stringify(expectedDocument(h, [h.imageA, h.imageB]), null, 2));
  });

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [] });
    const pieces = await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())));
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(KIB64);
    expect(pieces.join("")).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("the file name carries the handle and the day of the export", () => {
    expect(exportFilename("ada_l", new Date("2026-09-24T23:59:59.000Z"))).toBe("korbat-export-ada_l-2026-09-24.zip");
  });

  test("one export a day: the second is rate_limited with a Retry-After, the next day is allowed again, and a store that fails closes the door", async () => {
    const h = harness();
    await enforceExportLimit(h.deps, h.userId);
    const refused = await enforceExportLimit(h.deps, h.userId).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AccountError);
    expect((refused as AccountError).code).toBe("rate_limited");
    expect((refused as AccountError).status).toBe(429);
    expect((refused as AccountError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as AccountError).retryAfterSeconds).toBeLessThanOrEqual(EXPORT_WINDOW_MS / 1000);
    // Another account is not affected.
    await enforceExportLimit(h.deps, randomUUID());
    h.advance(EXPORT_WINDOW_MS + 1);
    await enforceExportLimit(h.deps, h.userId);

    const failing: AccountDeps = {
      ...h.deps,
      limits: {
        hit: async () => {
          throw new Error("store down");
        },
        release: async () => undefined,
      },
    };
    const down = await enforceExportLimit(failing, h.userId).catch((err: unknown) => err);
    expect(down).toBeInstanceOf(AccountError);
    expect((down as AccountError).code).toBe("service_unavailable");
    expect((down as AccountError).status).toBe(503);
    expect((down as AccountError).retryAfterSeconds).toBe(30);
  });
});

describe("writing the archive", () => {
  test("the archive holds export.json and every image byte for byte, in chunks that are each awaited", async () => {
    const bytesA = randomBytes(200_000);
    const bytesB = Buffer.from("small-webp");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(fileOf(bytesB)) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    expect(sink.overlapped).toBe(false);
    // Two hundred kilobytes do not fit in one read: the image went through several awaited writes.
    expect(sink.count).toBeGreaterThan(3);

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`, `media/${h.imageB}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageB}.webp`]!), bytesB)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(centralDirectory(sink.bytes()).map((entry) => [entry.name, entry.method])).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(path.join(root, randomUUID(), "large.webp")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([h.imageB]);
    // The post still names the entry the image would have had; missingMedia says why it is not there.
    expect(json.posts[0]!.media[1]!.file).toBe(`media/${h.imageB}.webp`);
    expect(plan.missingMedia).toEqual([h.imageB]);
  });

  /** A store with one image whose large variant holds `bytes`, read through the media module's checked open. */
  async function storeWith(id: string, bytes: Uint8Array) {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: silent });
    await files.prepare();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), bytes);
    return files;
  }

  test("an image larger than a variant may be is refused by the checked open and listed under missingMedia like a missing one", async () => {
    const h = harness();
    const files = await storeWith(h.imageA, Buffer.from("planted"));
    // A sparse file of any size could be planted in the store; the checked open refuses anything over the variant limit.
    truncateSync(files.store.image(h.imageA, "large"), MAX_VARIANT_BYTES + 1);
    const kept = await storeWith(h.imageB, Buffer.from("fine"));
    h.images.push({ id: h.imageA, open: () => files.openImage(h.imageA, "large") }, { id: h.imageB, open: () => kept.openImage(h.imageB, "large") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const archive = sink.bytes();
    expect(archive.length).toBeLessThan(MAX_VARIANT_BYTES);
    const unpacked = unzipSync(archive);
    expect(Object.keys(unpacked).sort()).toEqual(["export.json", `media/${h.imageB}.webp`].sort());
    expect(ExportFormat.parse(JSON.parse(strFromU8(unpacked["export.json"]!))).missingMedia).toEqual([h.imageA]);
  });

  test("a file that grows after the checked open is read only to the size the open measured", async () => {
    const h = harness();
    const original = randomBytes(150_000);
    const files = await storeWith(h.imageA, original);
    h.images.push({
      id: h.imageA,
      open: async () => {
        const stored = await files.openImage(h.imageA, "large");
        // Whatever lands in the file after the check is not the checked file's.
        appendFileSync(files.store.image(h.imageA, "large"), randomBytes(100_000));
        return stored;
      },
    });
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), await buildExport(h.deps, h.userId, h.currentSession, h.now()));
    const unpacked = unzipSync(sink.bytes());
    expect(Buffer.compare(Buffer.from(unpacked[`media/${h.imageA}.webp`]!), original)).toBe(0);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON pieces deflated as one text, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const first = JSON.stringify({ kind: "first", filler: "x".repeat(2_000) }, null, 2);
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJsonPieces("first.json", piecesOf(first.slice(0, 700), first.slice(700)));
    expect(await writer.addFile("files/stored.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("last.json", piecesOf('{ "kind": "last" }'));
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(first);
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe('{ "kind": "last" }');
    const directory = centralDirectory(sink.bytes());
    expect(directory.map((entry) => [entry.name, entry.method])).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    // A plain archive has no ZIP64 field or record, and every entry streams its sizes after its data.
    expect(directory.map((entry) => entry.zip64)).toEqual([null, null, null]);
    expect(directory.every((entry) => entry.versionNeeded === 45 && (entry.flags & 0x0008) !== 0)).toBe(true);
    expect(endRecords(sink.bytes()).end64).toBeNull();
    expect(sink.overlapped).toBe(false);
  });

  test("a file the open refuses adds nothing and answers false; a zero-byte file is an entry without data", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", openerOf(path.join(root, randomUUID(), "missing.webp")))).toBe(false);
    expect(await writer.addFile("dir.bin", openerOf(dir))).toBe(false);
    const empty = fakeFile(0);
    expect(await writer.addFile("empty.bin", empty.open)).toBe(true);
    expect(empty.state).toEqual({ chunks: 0, stopped: false, closed: true });
    await writer.addJsonPieces("only.json", piecesOf('{ "ok": true }'));
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["empty.bin", "only.json"]);
    expect(files["empty.bin"]!.length).toBe(0);
    expect(centralDirectory(sink.bytes()).map((entry) => entry.name)).toEqual(["empty.bin", "only.json"]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });

  test("the JSON is fed to the deflate at most 64 KiB at a time, and the event loop turns between two feeds", async () => {
    const push = vi.spyOn(Deflate.prototype, "push");
    const chunks: Uint8Array[] = [];
    const writer = createZipWriter(async (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    // One piece of 300 KiB and ten small ones.
    const big = "y".repeat(300 * 1024);
    let fed: number[];
    try {
      await writer.addJsonPieces("big.json", piecesOf(big, ...Array.from({ length: 10 }, (_, i) => `,${i}`)));
      await writer.end();
      // Read before the spy is restored, which forgets its calls.
      fed = push.mock.calls.map(([chunk]) => chunk.length);
    } finally {
      running = false;
      push.mockRestore();
    }
    expect(Math.max(...fed)).toBeLessThanOrEqual(KIB64);
    expect(fed.filter((length) => length > 0)).toHaveLength(5 + 10);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(strFromU8(unzipSync(Buffer.concat(chunks))["big.json"]!)).toBe(big + Array.from({ length: 10 }, (_, i) => `,${i}`).join(""));
  });

  test("forced ZIP64 on a small archive: it opens and gives back its bytes, and its records say what a ZIP64 reader needs", async () => {
    const stored = randomBytes(5_000);
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { zip64: "always" });
    expect(await writer.addFile("a.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("b.json", piecesOf('{ "b": 1 }'));
    await writer.end();
    const archive = sink.bytes();

    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["a.bin", "b.json"]);
    expect(Buffer.compare(Buffer.from(files["a.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["b.json"]!)).toBe('{ "b": 1 }');

    // Every 32-bit field reads 0xFFFFFFFF and the extra field holds the uncompressed size, the compressed size and the offset, in that order.
    const [a, b] = centralDirectory(archive);
    expect(a).toMatchObject({ name: "a.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0xffffffff, zip64: [5_000, 5_000, 0] });
    expect(b!.zip64![2]).toBe(30 + "a.bin".length + 5_000 + 24);
    expect(b!.zip64![0]).toBe(10);
    // The data descriptor after a.bin's bytes carries 8-byte sizes.
    const descriptor = 30 + "a.bin".length + 5_000;
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect([u64(archive, descriptor + 8), u64(archive, descriptor + 16)]).toEqual([5_000, 5_000]);

    const { end, locator, end64 } = endRecords(archive);
    const directoryOffset = a!.at;
    expect(end64).toEqual({
      at: archive.length - 22 - 20 - 56,
      recordSize: 44,
      versionMadeBy: 45,
      versionNeeded: 45,
      disk: 0,
      directoryDisk: 0,
      entriesHere: 2,
      entries: 2,
      size: end64!.at - directoryOffset,
      offset: directoryOffset,
    });
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    expect(end).toEqual({ entriesHere: 0xffff, entries: 0xffff, size: 0xffffffff, offset: 0xffffffff, comment: 0 });
  });

  test("the writer turns to ZIP64 by itself once an offset passes 4 GiB", async () => {
    const start = TWO_32 - 100;
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { startOffset: start });
    await writer.addFile("a.bin", openerOf(fileOf(Buffer.alloc(50, 1))));
    await writer.addFile("b.bin", openerOf(fileOf(Buffer.alloc(40, 2))));
    await writer.end();
    const archive = sink.bytes();

    const bOffset = start + 30 + 5 + 50 + 16;
    expect(bOffset).toBeGreaterThan(0xffffffff);
    const [a, b] = centralDirectory(archive, start);
    // a.bin starts below 4 GiB and needs nothing; b.bin's offset goes into the extra field alone.
    expect(a).toMatchObject({ name: "a.bin", compressed: 50, size: 50, offset: start, zip64: null });
    expect(b).toMatchObject({ name: "b.bin", compressed: 40, size: 40, offset: 0xffffffff, zip64: [bOffset] });
    // Neither entry reached 4 GiB, so both descriptors keep 4-byte sizes.
    expect(archive.readUInt32LE(30 + 5 + 50)).toBe(0x08074b50);
    expect(archive.readUInt32LE(30 + 5 + 50 + 16)).toBe(0x04034b50);

    const { end, locator, end64 } = endRecords(archive, start);
    expect(end64).toMatchObject({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: a!.at });
    expect(a!.at).toBeGreaterThan(0xffffffff);
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    // Only the directory's offset overflows the classic record.
    expect(end).toEqual({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: 0xffffffff, comment: 0 });
  });

  test("an entry of more than 4 GiB is a ZIP64 entry by itself, without the archive being kept in memory", { timeout: 120_000 }, async () => {
    const huge = fakeFile(TWO_32 + 1);
    // Counts every byte and keeps only what is not the file's own data, with where it starts.
    const kept: { at: number; bytes: Uint8Array }[] = [];
    let written = 0;
    const writer = createZipWriter(async (chunk) => {
      if (chunk.buffer !== huge.chunk.buffer) kept.push({ at: written, bytes: Uint8Array.from(chunk) });
      written += chunk.length;
    });
    expect(await writer.addFile("huge.bin", huge.open)).toBe(true);
    await writer.addJsonPieces("after.json", piecesOf('{ "after": true }'));
    await writer.end();
    expect(huge.state).toEqual({ chunks: TWO_32 / KIB64 + 1, stopped: true, closed: true });

    // Everything after the file's data is kept together: its descriptor, the next entry, the directory and the end records.
    const dataEnd = 30 + "huge.bin".length + TWO_32 + 1;
    const tail = Buffer.concat(kept.filter((piece) => piece.at >= dataEnd).map((piece) => piece.bytes));
    expect(dataEnd + tail.length).toBe(written);
    expect(tail.readUInt32LE(0)).toBe(0x08074b50);
    expect([u64(tail, 8), u64(tail, 16)]).toEqual([TWO_32 + 1, TWO_32 + 1]);
    const [hugeEntry, after] = centralDirectory(tail, dataEnd);
    expect(hugeEntry).toMatchObject({ name: "huge.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0, zip64: [TWO_32 + 1, TWO_32 + 1] });
    expect(after).toMatchObject({ name: "after.json", offset: 0xffffffff, zip64: [dataEnd + 24] });
    const { end, end64 } = endRecords(tail, dataEnd);
    expect(end64).toMatchObject({ entries: 2, offset: hugeEntry!.at });
    expect(end).toMatchObject({ entries: 2, offset: 0xffffffff });
  });
});

describe("the export route", () => {
  /**
   * The account routes on their own, with the session and the logger a request would carry and an error
   * handler that renders AccountError as the app's does; everything else is a 500. The freshness and
   * session guards are passed through: http-account.test.ts covers them on the real app.
   */
  function app(h: Harness, log = silent) {
    const session: Session = {
      sessionId: randomBytes(32).toString("hex"),
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      // The route marks the current session by this, the id the list carries, and not by the token's hash above.
      handle: h.currentSession,
      factors: { email: h.now().getTime() },
      passkeyId: null,
    };
    const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
      await next();
    };
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "test");
      c.set("log", log);
      c.set("session", session);
      c.set("authVia", "cookie");
      await next();
    });
    a.route("/api/account", accountRoutes(h.deps, pass, pass, pass));
    a.onError((err, c) => (err instanceof AccountError ? c.json({ error: { code: err.code } }, err.status) : c.json({ error: { code: "internal" } }, 500)));
    return a;
  }
  const exportOf = (a: Hono<AppEnv>) => a.request("/api/account/export", { method: "POST" });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
  const exported = (h: Harness) => h.events.filter((event) => event.type === "export_created").length;

  test("a complete export streams a valid archive with its headers and records export_created", async () => {
    const h = harness();
    const bytesA = randomBytes(300_000);
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-export-ada-${iso(T0).slice(0, 10)}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    // Recorded once every chunk was taken, before the body ended.
    expect(h.events).toEqual([{ userId: h.userId, type: "export_created", metadata: undefined }]);
  });

  test("a failure before the first byte answers an error and gives the day's export back", async () => {
    const h = harness();
    const a = app(h);
    // The build fails: a pool timeout while the account is read.
    h.failures.exportAccount = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    // The first image cannot even be opened: still nothing sent.
    h.images.push({
      id: h.imageA,
      open: async () => {
        throw new Error("too many open files");
      },
    });
    const unopened = await exportOf(a);
    expect(unopened.status).toBe(500);
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["export.json"]);
    expect(exported(h)).toBe(1);
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a limit store that cannot give the export back is logged, and the build's own error is answered", async () => {
    const h = harness();
    const lines: string[] = [];
    const log = pino({ level: "warn" }, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString("utf8")), done()) }));
    const store = new MemoryStore(() => h.now().getTime());
    h.deps.limits = {
      hit: (key, windowMs) => store.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    h.failures.exportAccount = 1;
    const res = await exportOf(app(h, log));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal");
    expect(lines.map((line) => (JSON.parse(line) as { level: number; msg: string }).level)).toEqual([40]);
    expect(lines[0]).toMatch(/could not be given back/);
  });

  test("an image that fails in the middle of its reading fails the response body, and the day's export stays spent", async () => {
    const h = harness();
    const failing = fakeFile(1_000_000, { failAfter: 3 });
    h.images.push({ id: h.imageA, open: failing.open });
    const a = app(h);
    const res = await exportOf(a);
    // The status went out with the first bytes; what follows can only end the body with an error, never cleanly.
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(failing.state).toMatchObject({ chunks: 3, stopped: true, closed: true });
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a client that goes away stops the file reads", async () => {
    const h = harness();
    // A hundred megabytes, read only as fast as the response is taken.
    const big = fakeFile(100 * 1024 * 1024);
    h.images.push({ id: h.imageA, open: big.open });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(big.state).toMatchObject({ stopped: true, closed: true }));
    expect(big.state.chunks).toBeLessThan(10);
    expect(exported(h)).toBe(0);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type {
  ActiveSessionRow,
  AddPasskeyOutcome,
  AuthEventType,
  AuthRepo,
  DeviceRow,
  EmailCodeRow,
  LockDownInput,
  LockDownOutcome,
  NewPasskey,
  PasskeyLimits,
  PasskeyListRow,
  PasskeyRow,
  SessionListRow,
  UserRow,
} from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me,
 * lockdown and TOTP confirmation flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" and "lockDown" each fail as a transaction that breaks off midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown" | "lockDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      // As the real statement: unconditional, whatever the row held, and the last accepted step starts over.
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash });
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("lockDown")) throw new Error("the lockdown transaction failed midway and was rolled back");
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = input.now;
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = input.now;
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const passkeysRemoved: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.passkeyIds.includes(passkey.id)) {
          passkeysRemoved.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      const row = users.get(userId);
      // As the real read of the locked row: an account that is gone has no two-factor to clear.
      const totpCleared = row !== undefined && row.deletedAt === null && row.totpEnabledAt !== null && row.totpEnabledAt.getTime() >= input.since.getTime();
      if (row) {
        // The password as setPasswordHash clears it, and two-factor as disableTotp turns it off.
        Object.assign(row, { passwordHash: null, passwordChangedAt: input.now, failedLogins: 0, lockedUntil: null });
        if (totpCleared) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
      }
      recordEvent({ userId, type: input.event.type, deviceId: input.event.deviceId, metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true } });
      return { sessionIds: live.map((s) => s.id), passkeysRemoved, totpCleared };
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async listActiveSessions(userId: string, at: Date): Promise<SessionListRow[]> {
      // As the real statement: the user's sessions that are neither revoked nor expired, most recently used first, each with its device's label.
      return sessions
        .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => {
          const device = devices.find((d) => d.id === s.deviceId);
          return { id: s.id, handle: s.handle, deviceLabel: device?.label ?? null, platform: device?.platform ?? "web", createdAt: s.createdAt, lastUsedAt: s.lastUsedAt };
        });
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "enableTotp"
    | "disableTotp"
    | "lockDown"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "listActiveSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it. No flow here changes the
    // Explore switch, which reads as the column's default.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null, showInExplore: true };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false, showInExplore: true },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    // Each session is listed under its handle, the id a rotation keeps; the hash of a token is never listed.
    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions.map((s) => s.id).sort()).toEqual([account.session.handle, second.session.handle, third.session.handle].sort());
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.handle]);

    // The listed session re-authenticates before the revoke lands, so its token rotates: the listed id still names it.
    const rotated = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.issued.token)).not.toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(true);
    expect(await h.deps.sessions.resolve(rotated.issued.token)).toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(false);
    expect(await revokeSession(h.deps, account.session, randomUUID())).toBe(false);
    // Another account's session is not this one's to revoke.
    const stranger = await onboardedUser(h, repo);
    expect(await revokeSession(h.deps, account.session, stranger.session.handle)).toBe(false);
    expect(await h.deps.sessions.resolve(stranger.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "session_revoked")).toEqual([
      { type: "session_revoked", deviceId: account.session.deviceId, ipHash: null, metadata: { handle: second.session.handle } },
    ]);

    // Signing out after a rotation ends the session under its new token.
    const thirdRotated = await h.deps.sessions.rotate(third.session);
    await signOut(h.deps, thirdRotated.session);
    expect(await h.deps.sessions.resolve(thirdRotated.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing but refuse, and is not spent by the refusal.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    for (let i = 0; i < 2; i++) await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    // Once the account is back at the address the alert went to, as the email undo puts it, the link works, once.
    await repo.changeEmail(moved.user.id, moved.email, h.clock.now());
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(await h.deps.sessions.resolve(moved.token)).toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type).filter((type) => type === "not_me")).toHaveLength(1);
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { MeProfile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { signIn } from "../../src/auth/flows/signin";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import { hashPassword } from "../../src/auth/passwords";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/**
 * Handles unique per store, like the real public.profiles index. A new profile has never changed its handle, holds no
 * badge and shows its posts in Explore, as the column's default has it.
 */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, MeProfile>();
  const byId = new Map<string, MeProfile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName, handleChangedAt: null, verified: false, showInExplore: true };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile: { id, handle, displayName } };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async setVerified(id, at) {
      const profile = byId.get(id);
      if (profile) profile.verified = at !== null;
    },
  };
}

export const TEST_TERMS = "draft-test";
export const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Real auth repository (Postgres) with an in-memory key-value store, mailer and profile store, a fake
 * clock shared by all of them, Turnstile that fails only for the token "fail", and a breach checker
 * that flags passwords containing "breached". A suite whose profiles live in the public schema (the
 * deletion flow compares the typed handle with the profile's) passes the real profile store instead.
 */
export function flowHarness(repo: AuthRepo, options: { profiles?: ProfileStore } = {}) {
  const clock = fakeClock();
  const kv = new MemoryKv(clock.ms);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo,
    kv,
    mailer,
    config,
    now: clock.now,
    sessions: createSessions({ repo, kv, now: clock.now }),
    lockout: createLockout({ repo, kv, now: clock.now }),
    turnstile: { verify: async (token) => token !== "fail" },
    breachChecker: { isBreached: async (password) => password.includes("breached") },
    profiles: options.profiles ?? memoryProfiles(),
    verify: devProvider(),
    log: pino({ level: "silent" }),
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: CHROME_WINDOWS };
  return { deps, clock, kv, mailer, ctx };
}

export type FlowHarness = ReturnType<typeof flowHarness>;

export const newTestEmail = (prefix = "flow") => `${prefix}-${randomUUID()}@korbat.local`;
export const newTestDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
export const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** An onboarded account, optionally with a password, signed in on one web device. */
export async function onboardedUser(h: FlowHarness, repo: AuthRepo, options: { password?: string } = {}) {
  const email = newTestEmail("account");
  const created = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
  await repo.markOnboarded(created.id, new Date());
  if (options.password) await repo.setPasswordHash(created.id, await hashPassword(options.password), new Date());
  const user = (await repo.findUserById(created.id))!;
  const device = newTestDevice();
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
  return { email, user, device, session: signed.issued.session, token: signed.issued.token };
}

export type OnboardedUser = Awaited<ReturnType<typeof onboardedUser>>;

/** The TOTP code for a user's stored secret at the harness clock. */
export async function currentTotpCode(h: FlowHarness, repo: AuthRepo, userId: string): Promise<string> {
  const user = (await repo.findUserById(userId))!;
  const secret = new Uint8Array(decrypt(user.totpSecretEnc!, [h.deps.config.totpKey]));
  return hotp(secret, currentStep(h.clock.ms()));
}
```

### Replace `apps/api/test/integration/social-flows-profile-edit.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { ProfileView } from "@korbat/contracts";
import { closeDb, createDb, handleHistory, profiles, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { createPost, getPost } from "../../src/social/flows/posts";
import { HANDLE_COOLDOWN_MS, changeHandle, editProfile } from "../../src/social/flows/profile-edit";
import { profile } from "../../src/social/flows/profiles";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `h_${randomBytes(5).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The profile the history reserves a handle for, or null when the handle was never left behind. */
  const reservedBy = async (handle: string) =>
    (await db.select({ profileId: handleHistory.profileId }).from(handleHistory).where(eq(handleHistory.handleLower, handle.toLowerCase())))[0]?.profileId ?? null;

  test("an edit is stored, shown to everyone through the profile flow, and recorded as an event", async () => {
    const ada = await h.established();
    const view = await editProfile(h.deps, ada.id, { displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(view.viewer).toBeUndefined();
    expect(await profile(h.deps, null, ada.handle)).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    expect((await editProfile(h.deps, ada.id, { bio: "" })).bio).toBe("");
    expect(h.events.filter((e) => e.userId === ada.id)).toEqual([
      { userId: ada.id, type: "profile_updated", metadata: undefined },
      { userId: ada.id, type: "profile_updated", metadata: undefined },
    ]);
  });

  test("changing the handle reserves the old one, stamps the change, and existing posts show the new handle at once", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    h.clock.next();
    const root = await createPost(h.deps, ada.id, { body: "by ada", media: [] });
    h.clock.next();
    const reply = await createPost(h.deps, bob.id, { body: "to ada", media: [], replyToId: root.id });
    const to = newHandle();
    const view = await changeHandle(h.deps, ada.id, { handle: to.toUpperCase() });
    expect(ProfileView.parse(view)).toMatchObject({ id: ada.id, handle: to, counts: { posts: 1, followers: 0, following: 0 } });
    expect(view.viewer).toBeUndefined();
    const row = (await h.repo.findProfileById(ada.id))!;
    expect(row.handle).toBe(to);
    expect(row.handleChangedAt).not.toBeNull();
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect((await getPost(h.deps, null, root.id)).author.handle).toBe(to);
    expect((await getPost(h.deps, null, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: to });
    expect(await rejection(profile(h.deps, null, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, bob.id, to)).id).toBe(ada.id);
    expect(h.events).toContainEqual({ userId: ada.id, type: "handle_changed", metadata: { from: ada.handle, to } });
    // What /me reads from the profile store follows the change too, beside the facts the change leaves alone.
    expect(await createProfileStore(db).find(ada.id)).toEqual({
      id: ada.id,
      handle: to,
      displayName: `Profile ${ada.handle}`,
      handleChangedAt: row.handleChangedAt!.toISOString(),
      verified: false,
      showInExplore: true,
    });
    // The Explore switch is read from the row as it stands, like the handle.
    await db.update(profiles).set({ showInExplore: false }).where(eq(profiles.id, ada.id));
    expect((await createProfileStore(db).find(ada.id))!.showInExplore).toBe(false);
  });

  test("a handle another profile holds, in any case, or ever held is handle_taken; the profile itself may go back after the cooldown", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const to = newHandle();
    await changeHandle(h.deps, ada.id, { handle: to });
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to.toUpperCase() }))).toBe("handle_taken");
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: ada.handle }))).toBe("handle_taken");
    expect((await h.repo.findProfileById(bob.id))!.handle).toBe(bob.handle);
    expect(await rejection(changeHandle(h.deps, ada.id, { handle: ada.handle }))).toBe("handle_cooldown");
    h.clock.jump(HANDLE_COOLDOWN_MS);
    expect((await changeHandle(h.deps, ada.id, { handle: ada.handle })).handle).toBe(ada.handle);
    expect(await reservedBy(to)).toBe(ada.id);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    expect(await rejection(changeHandle(h.deps, bob.id, { handle: to }))).toBe("handle_taken");
  });

  test("two accounts racing for the same free handle: exactly one wins and the other is handle_taken", async () => {
    for (let i = 0; i < 6; i++) {
      const [ada, bob] = await Promise.all([h.established(), h.established()]);
      const to = newHandle();
      const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: to }), changeHandle(h.deps, bob.id, { handle: to })]);
      const won = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled");
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0]!.reason as { code: string }).code).toBe("handle_taken");
      const holders = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.handle, to));
      expect(holders.map((r) => r.id)).toEqual([won[0]!.value.id]);
    }
  });

  test("two changes by the same account in flight leave every handle it held in the history", async () => {
    const ada = await h.established();
    const [x, y] = [newHandle(), newHandle()];
    const outcomes = await Promise.allSettled([changeHandle(h.deps, ada.id, { handle: x }), changeHandle(h.deps, ada.id, { handle: y })]);
    // The later one may have read the earlier one's stamp and stopped at the cooldown; otherwise both ran, one after the other, on the locked row.
    const done = outcomes.filter((o): o is PromiseFulfilledResult<ProfileView> => o.status === "fulfilled").map((o) => o.value.handle);
    for (const o of outcomes) if (o.status === "rejected") expect((o.reason as { code: string }).code).toBe("handle_cooldown");
    expect(done.length).toBeGreaterThanOrEqual(1);
    const final = (await h.repo.findProfileById(ada.id))!.handle;
    expect(done).toContain(final);
    expect(await reservedBy(ada.handle)).toBe(ada.id);
    for (const handle of done) if (handle !== final) expect(await reservedBy(handle)).toBe(ada.id);
  });

  test("onboarding writes the handle into the history in the profile's transaction and refuses a handle another profile ever had", async () => {
    const store = createProfileStore(db);
    const ada = await h.established();
    await changeHandle(h.deps, ada.id, { handle: newHandle() });
    const id = randomUUID();
    const handle = newHandle();
    expect(await store.create({ id, handle, displayName: "New" })).toEqual({ ok: true, profile: { id, handle, displayName: "New" } });
    expect(await reservedBy(handle)).toBe(id);
    for (const taken of [ada.handle, ada.handle.toUpperCase(), handle.toUpperCase()]) {
      const late = randomUUID();
      expect(await store.create({ id: late, handle: taken, displayName: "Late" }), taken).toEqual({ ok: false, reason: "handle_taken" });
      expect(await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, late)), taken).toEqual([]);
    }
  });
});
```

### Replace `apps/api/test/social/cursor.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { SocialError } from "../../src/social/context";
import { MAX_CURSOR_TIME, MAX_GENERATION, decodeCursor, decodeExploreCursor, encodeCursor, encodeExploreCursor } from "../../src/social/cursor";

const id = "00000000-0000-4000-8000-000000000001";
const reposter = "00000000-0000-4000-8000-000000000002";

/** Any value as a client could send it: base64url of its JSON. */
const raw = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("cursors", () => {
  test("round-trip with and without a reposter", () => {
    expect(decodeCursor(encodeCursor({ t: 1_789_000_000_123, id }))).toEqual({ t: 1_789_000_000_123, id });
    expect(decodeCursor(encodeCursor({ t: 5, id, r: reposter }))).toEqual({ t: 5, id, r: reposter });
    expect(encodeCursor({ t: 5, id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  test("anything that is not a cursor is invalid_request", () => {
    for (const raw of ["", "not-base64!", Buffer.from("[1,2]").toString("base64url"), Buffer.from('{"t":-1,"id":"x"}').toString("base64url")]) {
      expect(() => decodeCursor(raw), raw).toThrow(SocialError);
      expect(() => decodeCursor(raw), raw).toThrow(/cursor/);
    }
  });
  test("a time beyond what a date can hold is invalid_request, never a crash", () => {
    const raw = Buffer.from(JSON.stringify({ t: 9_000_000_000_000_000, id })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(/cursor/);
    expect(decodeCursor(encodeCursor({ t: MAX_CURSOR_TIME, id })).t).toBe(MAX_CURSOR_TIME);
  });
  test("extra fields are rejected, so clients cannot smuggle filters through the cursor", () => {
    const raw = Buffer.from(JSON.stringify({ t: 5, id, viewer: "someone-else" })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(SocialError);
  });
});

describe("Explore cursors", () => {
  test("round-trip a ranking and the last post read, as base64url of exactly those two in JSON", () => {
    expect(decodeExploreCursor(encodeExploreCursor({ g: 42, id }))).toEqual({ g: 42, id });
    const encoded = encodeExploreCursor({ g: 7, id });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    // The post read last, never a position: the order is all a reader learns.
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({ g: 7, id });
  });

  test("the generation runs from 1 to the largest value of the integer column that numbers the rankings", () => {
    expect(MAX_GENERATION).toBe(2_147_483_647);
    expect(decodeExploreCursor(raw({ g: 1, id }))).toEqual({ g: 1, id });
    expect(decodeExploreCursor(raw({ g: MAX_GENERATION, id }))).toEqual({ g: MAX_GENERATION, id });
    // Out of range, not an integer, or not a number: a forged value is a 400, never a query that overflows.
    for (const g of [0, -1, MAX_GENERATION + 1, 2 ** 53, 1.5, "1", null, true, [1], { g: 1 }]) {
      expect(() => decodeExploreCursor(raw({ g, id })), JSON.stringify(g)).toThrow(SocialError);
    }
  });

  test("a missing or extra field, an id that is not a uuid, and anything that is not a cursor are invalid_request, 400", () => {
    const refusals: [string, unknown][] = [
      ["no generation", { id }],
      ["no post", { g: 1 }],
      ["a position smuggled in", { g: 1, id, position: 3 }],
      ["a time smuggled in", { g: 1, id, t: 5 }],
      ["an id that is not a uuid", { g: 1, id: "not-a-uuid" }],
      ["an array", [1, id]],
      ["null", null],
      ["a string", "g1"],
    ];
    for (const [what, value] of refusals) {
      const err = (() => {
        try {
          decodeExploreCursor(raw(value));
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(err, what).toBeInstanceOf(SocialError);
      expect(err, what).toMatchObject({ code: "invalid_request", status: 400, message: "That page cursor is not valid." });
    }
    for (const text of ["", "not-base64!", Buffer.from("{").toString("base64url")]) {
      expect(() => decodeExploreCursor(text), text).toThrow(/cursor is not valid/);
    }
  });

  test("the two cursors are not interchangeable: each decoder refuses the other's", () => {
    expect(() => decodeExploreCursor(encodeCursor({ t: 5, id }))).toThrow(SocialError);
    expect(() => decodeCursor(encodeExploreCursor({ g: 5, id }))).toThrow(SocialError);
  });
});
```

### Replace `packages/contracts/test/account.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ExportFormat } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"], showInExplore: false },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  // A session is named by its handle, as the session list names it; the token's hash stays on the server.
  sessions: [{ id: id(9), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
};

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = { ...full, account: { ...full.account, passkeys: [] }, posts: [], likes: [], reposts: [], bookmarks: [], following: [], blocks: [], mutes: [], sessions: [], devices: [], events: [], missingMedia: [] };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the profile carries the author's Explore switch, always, as it stands", () => {
    // Part of the format since 2c, beside the handle history: on as well as off, never left out.
    expect(ExportFormat.parse({ ...full, profile: { ...full.profile, showInExplore: true } }).profile.showInExplore).toBe(true);
    expect(ExportFormat.parse(full).profile.showInExplore).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: "off" } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: id(9), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});
```

### Replace `packages/contracts/test/auth.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuthErrorCode,
  BadgeStartRequest,
  BadgeVerifyRequest,
  BadgeVerifyResponse,
  DeleteConfirmRequest,
  DeleteStartResponse,
  DeviceId,
  DisplayName,
  Email,
  EmailChangeResponse,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailVerifyResponse,
  MeProfile,
  MeResponse,
  MfaVerifyRequest,
  OpaqueId,
  Phone,
  ReauthRequest,
  ReauthResponse,
  RecoveryCode,
  SessionInfo,
  SessionsResponse,
  SignupCompleteRequest,
  TotpDisableRequest,
} from "../src/index";

const flow = "a".repeat(43);
const userId = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/** A minimal well-formed authentication assertion, for the passkey re-authentication variant. */
const reauthAssertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: "A".repeat(200), authenticatorData: "A".repeat(50), signature: "A".repeat(96) },
  clientExtensionResults: {},
};

describe("auth primitives", () => {
  test("email is trimmed and lowercased, invalid rejected", () => {
    expect(Email.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(Email.safeParse("not-an-email").success).toBe(false);
    expect(Email.safeParse(`${"a".repeat(250)}@x.io`).success).toBe(false);
  });
  test("opaque ids are exactly 43 base64url characters", () => {
    expect(OpaqueId.safeParse(flow).success).toBe(true);
    expect(OpaqueId.safeParse("a".repeat(42)).success).toBe(false);
    expect(OpaqueId.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });
  test("device ids are 22 to 64 url-safe characters", () => {
    expect(DeviceId.safeParse("x".repeat(22)).success).toBe(true);
    expect(DeviceId.safeParse("x".repeat(21)).success).toBe(false);
    expect(DeviceId.safeParse("x".repeat(65)).success).toBe(false);
  });
  test("recovery codes are normalised to lowercase base32 groups", () => {
    expect(RecoveryCode.parse(" ABCD-EF23-GH45 ")).toBe("abcd-ef23-gh45");
    expect(RecoveryCode.safeParse("abcd-ef01-gh45").success).toBe(false);
  });
  test("display names reject control characters and more than 50 characters", () => {
    expect(DisplayName.parse("  Ada Lovelace ")).toBe("Ada Lovelace");
    expect(DisplayName.safeParse(`bad${String.fromCharCode(7)}name`).success).toBe(false);
    expect(DisplayName.safeParse("x".repeat(51)).success).toBe(false);
  });
  test("phone numbers are E.164 once spaces, hyphens and parentheses are dropped", () => {
    expect(Phone.parse(" +44 7911 123-456 ")).toBe("+447911123456");
    expect(Phone.parse("+1 (415) 555-0132")).toBe("+14155550132");
    expect(Phone.parse("+1234567")).toBe("+1234567");
    expect(Phone.parse(`+${"9".repeat(15)}`)).toBe(`+${"9".repeat(15)}`);
    // No plus, a leading zero, too short, too long, letters, a plus in the middle.
    for (const bad of ["447911123456", "+0447911123456", "+123456", `+${"9".repeat(16)}`, "+44 7911 ext 12", "44+7911123456", ""]) {
      expect(Phone.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("auth requests and responses", () => {
  test("email verify response is discriminated by result", () => {
    expect(EmailVerifyResponse.parse({ result: "signup_required" })).toEqual({ result: "signup_required" });
    expect(EmailVerifyResponse.parse({ result: "mfa_required", mfaTicket: flow }).result).toBe("mfa_required");
    expect(EmailVerifyResponse.safeParse({ result: "session" }).success).toBe(false);
    expect(EmailVerifyResponse.parse({ result: "session", mustReenrollMfa: false })).toEqual({ result: "session", mustReenrollMfa: false });
  });
  test("mfa verify takes exactly one of code or recoveryCode", () => {
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, recoveryCode: "abcd-ef23-gh45" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456", recoveryCode: "abcd-ef23-gh45" }).success).toBe(false);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow }).success).toBe(false);
  });
  test("reauth accepts password, totp, email, recovery and passkey methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    // A recovery code (1c design, section 7.2), normalised as the MFA step normalises it.
    expect(ReauthRequest.parse({ method: "recovery", recoveryCode: " ABCD-EF23-GH45 " })).toEqual({ method: "recovery", recoveryCode: "abcd-ef23-gh45" });
    expect(ReauthRequest.safeParse({ method: "recovery", recoveryCode: "abcd-ef01-gh45" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "recovery", code: "000000" }).success).toBe(false);
    // A passkey re-authentication carries an assertion (1c design, section 7.2); a registration is not one.
    expect(ReauthRequest.safeParse({ method: "passkey", response: reauthAssertion }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "passkey" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "passkey", response: { ...reauthAssertion, response: {} } }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
  });
  test("the reauth answer carries the level reached, the rotated token for native clients and, after a recovery code, the re-enrolment flag", () => {
    expect(ReauthResponse.parse({ level: 1 })).toEqual({ level: 1 });
    expect(ReauthResponse.parse({ level: 2, token: "kb1_x", mustReenrollMfa: true })).toEqual({ level: 2, token: "kb1_x", mustReenrollMfa: true });
    expect(ReauthResponse.safeParse({ level: 3 }).success).toBe(false);
    expect(ReauthResponse.safeParse({ level: "2" }).success).toBe(false);
    expect(ReauthResponse.safeParse({ token: "kb1_x" }).success).toBe(false);
  });
  test("turning TOTP off takes an empty body: the re-authentication already spent the code, and a code sent anyway is dropped", () => {
    expect(TotpDisableRequest.parse({})).toEqual({});
    expect(TotpDisableRequest.parse({ code: "123456" })).toEqual({});
    expect(TotpDisableRequest.safeParse(null).success).toBe(false);
    expect(TotpDisableRequest.safeParse("code").success).toBe(false);
  });
  test("signup completion needs an ISO calendar date", () => {
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "2008-02-29", termsVersion: "draft" }).success).toBe(true);
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "29/02/2008", termsVersion: "draft" }).success).toBe(false);
  });
  test("a listed session is named by its handle, a uuid that stays while its token rotates, and never by the token's hash", () => {
    const session = { id: userId, deviceLabel: "Chrome on Windows", platform: "web", createdAt: "2026-09-24T10:00:00.000Z", lastUsedAt: "2026-09-24T10:05:00.000Z", current: true };
    expect(SessionsResponse.parse({ sessions: [session, { ...session, id: "0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", platform: "ios", current: false }] }).sessions.map((s) => [s.id, s.current])).toEqual([
      [userId, true],
      ["0b0e7c1a-5a53-4f0e-8a3f-2f6f8f5d9c11", false],
    ]);
    // What the list carried before: sha256 of the token, which a rotation replaces, so a listed session could not be revoked after one.
    expect(SessionInfo.safeParse({ ...session, id: "a".repeat(64) }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: "not-a-uuid" }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, id: undefined }).success).toBe(false);
    expect(SessionInfo.safeParse({ ...session, platform: "desktop" }).success).toBe(false);
  });
  test("me response carries email, the count of passkeys and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
    // The count decides whether the app offers a passkey re-authentication and the suggestion card (1c design, section 9), so it is never left out.
    expect(MeResponse.parse({ ...me, user: { ...me.user, passkeys: 3 } }).user.passkeys).toBe(3);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: undefined } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: -1 } }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, user: { ...me.user, passkeys: 1.5 } }).success).toBe(false);
  });
  test("the own profile in the me response says when the handle last changed, whether the badge is held and whether the account's posts show in Explore", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 };
    const profile = { id: userId, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true };
    expect(MeResponse.parse({ user, profile })).toEqual({ user, profile });
    expect(MeProfile.parse({ ...profile, handleChangedAt: "2026-09-24T10:00:00.000Z", verified: true }).verified).toBe(true);
    // The author's own switch (2c design, section 8), off as well as on.
    expect(MeProfile.parse({ ...profile, showInExplore: false }).showInExplore).toBe(false);
    // The three fields are facts the account and privacy screens rely on, so a profile without them is not a valid answer.
    expect(MeResponse.safeParse({ user, profile: { id: userId, handle: "ada", displayName: "Ada" } }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, handleChangedAt: "yesterday" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, verified: "yes" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, showInExplore: undefined }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, showInExplore: "on" }).success).toBe(false);
  });
  test("every documented auth error code exists", () => {
    expect(AuthErrorCode.options).toHaveLength(34);
    expect(AuthErrorCode.options).toContain("password_check_unavailable");
    expect(AuthErrorCode.options).toEqual(expect.arrayContaining(["handle_cooldown", "email_in_use", "phone_in_use", "badge_unavailable", "verify_unavailable"]));
    // Passkeys (1c design, section 8).
    expect(AuthErrorCode.options).toEqual(
      expect.arrayContaining(["passkey_invalid", "passkey_unsupported", "passkey_limit", "passkey_suspended", "passkey_not_found", "challenge_expired"]),
    );
  });
});

describe("account lifecycle requests and responses", () => {
  test("an email change starts with an address under the sign-up rules and verifies with a flow id and code", () => {
    expect(EmailChangeStartRequest.parse({ email: " New@Example.COM " })).toEqual({ email: "new@example.com" });
    expect(EmailChangeStartRequest.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(EmailChangeStartRequest.safeParse({}).success).toBe(false);
    expect(EmailChangeVerifyRequest.parse({ flowId: flow, code: "123456" })).toEqual({ flowId: flow, code: "123456" });
    expect(EmailChangeVerifyRequest.safeParse({ flowId: flow, code: "12345" }).success).toBe(false);
    expect(EmailChangeVerifyRequest.safeParse({ flowId: "short", code: "123456" }).success).toBe(false);
    expect(EmailChangeResponse.parse({ email: "new@example.com" })).toEqual({ email: "new@example.com" });
    expect(EmailChangeResponse.safeParse({ email: "nope" }).success).toBe(false);
  });
  test("the undo link of an email change carries one opaque token", () => {
    expect(EmailRevertRequest.parse({ token: flow })).toEqual({ token: flow });
    expect(EmailRevertRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({ token: `${"a".repeat(42)}/` }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({}).success).toBe(false);
  });
  test("the badge starts with a phone number and verifies with a flow id and a six-digit code", () => {
    expect(BadgeStartRequest.parse({ phone: "+44 7911 123456" })).toEqual({ phone: "+447911123456" });
    expect(BadgeStartRequest.safeParse({ phone: "07911123456" }).success).toBe(false);
    expect(BadgeStartRequest.safeParse({}).success).toBe(false);
    expect(BadgeVerifyRequest.parse({ flowId: flow, code: "000000" })).toEqual({ flowId: flow, code: "000000" });
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "abcdef" }).success).toBe(false);
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "0000000" }).success).toBe(false);
    expect(BadgeVerifyResponse.parse({ verified: true })).toEqual({ verified: true });
    expect(BadgeVerifyResponse.safeParse({ verified: false }).success).toBe(false);
  });
  test("deletion starts with a flow id and is confirmed with the code and the typed handle", () => {
    expect(DeleteStartResponse.parse({ flowId: flow })).toEqual({ flowId: flow });
    expect(DeleteStartResponse.safeParse({ flowId: "x" }).success).toBe(false);
    expect(DeleteConfirmRequest.parse({ flowId: flow, code: "123456", handle: " Ada_Lovelace " })).toEqual({ flowId: flow, code: "123456", handle: "ada_lovelace" });
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456", handle: "" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, handle: "ada" }).success).toBe(false);
  });
});
```

### Replace `packages/contracts/test/social.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AltText,
  BIO_MAX_LENGTH,
  Bio,
  CreatePostRequest,
  DisplayName,
  HandleChangeRequest,
  HandleParam,
  PostBody,
  PostId,
  PostView,
  ProfileEditRequest,
  ProfileListItem,
  ProfileView,
  SocialErrorCode,
  ThreadResponse,
  TimelineItem,
  TimelinePage,
  ViewerPostState,
  normalizePostBody,
  postLength,
  visibleLength,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const counts = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  author,
  body: "hello",
  createdAt: "2026-09-17T10:00:00.000Z",
  state: "visible",
  replyTo: null,
  counts,
  media: [],
  quoteOf: null,
  ...extra,
});

describe("post bodies", () => {
  test("normalization: NFC, CR LF to LF, at most two line breaks, trimmed", () => {
    expect(normalizePostBody("  e\u0301\r\nb\n\n\n\nc  ")).toBe("\u00e9\nb\n\nc");
    expect(PostBody.parse("\n a\r\n\r\nb \n")).toBe("a\n\nb");
  });
  test("tab and line feed are allowed, other control characters are not", () => {
    expect(PostBody.safeParse("a\tb\nc").success).toBe(true);
    expect(PostBody.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(PostBody.safeParse("a\u0085b").success).toBe(false);
  });
  test("length is counted in code points after normalization", () => {
    expect(postLength("\u{1F600}".repeat(3))).toBe(3);
    expect(PostBody.safeParse("\u{1F600}".repeat(1000)).success).toBe(true);
    expect(PostBody.safeParse("\u{1F600}".repeat(1001)).success).toBe(false);
    expect(PostBody.safeParse("   \n  ").success).toBe(false);
  });
  test("a post is a reply or a quote, never both", () => {
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", quoteOfId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2), quoteOfId: id(3) }).success).toBe(false);
  });
});

describe("invisible characters", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);
  test("direction overrides and zero-width spaces are refused in bodies, alt text and display names", () => {
    expect(PostBody.safeParse(`a${rlo}b`).success).toBe(false);
    expect(PostBody.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(AltText.safeParse(`cat${rlo}`).success).toBe(false);
    expect(DisplayName.safeParse(`Ada${zwsp}`).success).toBe(false);
  });
  test("joiners inside emoji stay allowed but do not count as text on their own", () => {
    const family = `${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`;
    expect(PostBody.safeParse(family).success).toBe(true);
    expect(PostBody.safeParse(zwj).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: zwj, media: [] }).success).toBe(false);
    expect(visibleLength(`a${zwj}b`)).toBe(2);
  });
  test("post ids are lowercased", () => {
    expect(PostId.parse("3B241101-E2BB-4255-8CAF-4136C566A962")).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
  });
  test("a reply may point at a parent whose author is hidden from the viewer", () => {
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2), authorHandle: null } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2) } })).success).toBe(false);
  });
});

describe("handles", () => {
  test("handle params strip the @ and lowercase, and reject invalid handles", () => {
    expect(HandleParam.parse(" @Ada_Lovelace ")).toBe("ada_lovelace");
    expect(HandleParam.safeParse("ab").success).toBe(false);
    expect(HandleParam.safeParse("has space").success).toBe(false);
  });
});

describe("post views", () => {
  test("a quote embeds one level and is otherwise a tombstone", () => {
    expect(PostView.safeParse(post(1, { quoteOf: post(2) })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), deleted: true } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), unavailable: true } })).success).toBe(true);
    // The embedded post may not carry its own expanded quote, and a tombstone needs a reason.
    expect(PostView.safeParse(post(1, { quoteOf: post(2, { quoteOf: post(3) }) })).success).toBe(false);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2) } })).success).toBe(false);
  });
  test("deleted is not a post state; deleted posts are tombstones", () => {
    expect(PostView.safeParse(post(1, { state: "deleted_by_author" })).success).toBe(false);
    expect(ThreadResponse.safeParse({ ancestors: [{ id: id(9), deleted: true }, post(2)], post: post(1), replies: { items: [], nextCursor: null } }).success).toBe(true);
  });
  test("the author's Explore chip is set or absent, never false, and an embedded quote does not carry it", () => {
    expect(PostView.parse(post(1, { inExplore: true })).inExplore).toBe(true);
    expect(PostView.parse(post(1))).not.toHaveProperty("inExplore");
    expect(PostView.safeParse(post(1, { inExplore: false })).success).toBe(false);
    expect(PostView.safeParse(post(1, { inExplore: "yes" })).success).toBe(false);
    // The chip is on the post card, not in the viewer's like, repost and bookmark state that an engagement answer replaces.
    expect(Object.keys(ViewerPostState.shape).sort()).toEqual(["bookmarked", "liked", "reposted"]);
    // An embed is not a card of its own: its fields are the quoted post's, without the chip.
    expect(PostView.parse(post(1, { quoteOf: post(2, { inExplore: true }) })).quoteOf).not.toHaveProperty("inExplore");
    expect(TimelineItem.parse({ kind: "post", post: post(1, { inExplore: true }) }).post.inExplore).toBe(true);
  });
  test("timeline items are posts or reposts with the reposter", () => {
    expect(TimelineItem.safeParse({ kind: "post", post: post(1) }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1), repostedBy: author, repostedAt: "2026-09-17T11:00:00.000Z" }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1) }).success).toBe(false);
    expect(TimelinePage.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});

describe("profiles", () => {
  test("profile views carry counts and an optional viewer relation", () => {
    const base = { id: id(1), handle: "ada", displayName: "Ada", bio: "", verified: true, createdAt: "2026-09-17T10:00:00.000Z", counts: { posts: 1, followers: 2, following: 3 } };
    expect(ProfileView.safeParse(base).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, viewer: { following: true, followedBy: false, blocked: false, muted: false } }).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, counts: { posts: -1, followers: 0, following: 0 } }).success).toBe(false);
    expect(ProfileListItem.safeParse({ ...author, bio: "hi", viewerFollows: true }).success).toBe(true);
    // The author's Explore switch is theirs (2c design, section 6): the public profile never carries it.
    expect(Object.keys(ProfileView.shape)).not.toContain("showInExplore");
    expect(ProfileView.parse({ ...base, showInExplore: false })).not.toHaveProperty("showInExplore");
  });
  test("the error codes are exactly the six social ones", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed"]);
  });
});

describe("profile editing", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);

  test("a bio is trimmed, may be empty, and has at most 160 code points", () => {
    expect(BIO_MAX_LENGTH).toBe(160);
    expect(Bio.parse("  Unpopular opinions, daily.  ")).toBe("Unpopular opinions, daily.");
    expect(Bio.parse("")).toBe("");
    expect(Bio.parse("   ")).toBe("");
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
    const astral = String.fromCodePoint(0x1f600);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
  });

  test("a bio is one line of plain text: no control, direction or zero-width characters; emoji joiners stay", () => {
    expect(Bio.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(10)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(9)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x85)}b`).success).toBe(false);
    // The Unicode line and paragraph separators are line breaks too, though not control characters.
    expect(Bio.safeParse(`a${String.fromCharCode(0x2028)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x2029)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${rlo}b`).success).toBe(false);
    expect(Bio.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(Bio.safeParse(`${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`).success).toBe(true);
  });

  test("a profile edit changes the display name, the bio or both, never nothing", () => {
    expect(ProfileEditRequest.parse({ displayName: " Ada " })).toEqual({ displayName: "Ada" });
    expect(ProfileEditRequest.parse({ bio: "" })).toEqual({ bio: "" });
    expect(ProfileEditRequest.parse({ displayName: "Ada", bio: " hi " })).toEqual({ displayName: "Ada", bio: "hi" });
    expect(ProfileEditRequest.safeParse({}).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "" }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "x".repeat(51) }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ bio: `a${rlo}b` }).success).toBe(false);
  });

  test("a handle change carries the handle as typed, lowercased; the flow decides whether it is valid", () => {
    expect(HandleChangeRequest.parse({ handle: " Ada_Lovelace " })).toEqual({ handle: "ada_lovelace" });
    expect(HandleChangeRequest.safeParse({}).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "" }).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "x".repeat(65) }).success).toBe(false);
  });
});

describe("posts with images", () => {
  const img = (n: number, alt = "an image") => ({ id: id(n), alt });

  test("a post needs text or an image; the body defaults to empty and media to none", () => {
    expect(CreatePostRequest.parse({ body: "hello" })).toEqual({ body: "hello", media: [] });
    expect(CreatePostRequest.parse({ media: [img(1)] })).toEqual({ body: "", media: [img(1)] });
    expect(CreatePostRequest.parse({ body: "  ", media: [img(1)] }).body).toBe("");
    expect(CreatePostRequest.safeParse({}).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "   ", media: [] }).success).toBe(false);
  });

  test("at most four images, each only once, each with a description", () => {
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4), img(5)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1, "  ")] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [{ id: id(1) }] }).success).toBe(false);
    expect(CreatePostRequest.parse({ body: "x", media: [img(1, "  a   cat ")] }).media[0]!.alt).toBe("a cat");
  });

  test("the text rules still hold for a post with images, and replies and quotes may carry images", () => {
    expect(CreatePostRequest.safeParse({ body: "a".repeat(1001), media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "a\u0000b", media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ quoteOfId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), quoteOfId: id(8), media: [img(1)] }).success).toBe(false);
  });
});

```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/account.test.ts (8 tests | 2 failed) 73ms
packages/contracts test:  ❯ test/auth.test.ts (20 tests | 1 failed) 78ms
packages/contracts test:  ❯ test/social.test.ts (22 tests | 1 failed) 77ms
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/explore-2c/write_blocks.py docs/superpowers/prompts/explore-2c/03-reads.md 3
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/social/flows/explore.ts`

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
    if (read.current !== null && cursor.g > read.current) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
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

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts and the profile are read before the first
 * byte; the profile's lists are read page by page while export.json is written, and the images, each
 * behind the media module's checked open, go first, so `missingMedia` is complete by the time the JSON
 * that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  /** The handle of the session that asked for the export: the id the auth module lists each session under. */
  currentSession: string;
  account: AccountExport;
  profile: ProfileExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, and the list of images. The three
 * modules are asked at once. `currentSession` is the handle of the session asking, which marks its
 * entry among the sessions. `pageSize` is how many rows of each profile list are read at a time; tests
 * lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSession: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId, pageSize), deps.media.exportImages(userId)]);
  return { exportedAt: now, currentSession, account, profile, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
        // Last in the profile, where the format added it (2c); the member order is part of the bytes.
        showInExplore: profile.profile.showInExplore,
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSession })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file); the order of
 * entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

```ts
import type { AuthErrorCode, MeProfile, Profile } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";
import type { VerificationProvider } from "./verify/provider";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  termsVersion: string;
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
    termsVersion: config.TERMS_VERSION,
    trustProxy: config.TRUST_PROXY,
    verifyProvider: config.VERIFY_PROVIDER,
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date, the badge and the Explore switch. */
  find(id: string): Promise<MeProfile | null>;
  /** Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. */
  setVerified(id: string, at: Date | null): Promise<void>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

/** The auth codes plus the shared one the module also raises, as the social and media modules do: a well-formed request that asks for nothing, such as the current address as the new one. */
export type AuthErrorKind = AuthErrorCode | "invalid_request";

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  invalid_request: "Some details are missing or invalid.",
};

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
    /**
     * What the app needs beyond the code, sent as the envelope's `details`: for reauth_required, the level the action
     * asks for and the factor kinds the session proved in time (1c design, section 7.1).
     */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Replace `apps/api/src/profiles/store.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { handleHistory, profiles, type Db } from "@korbat/db";
import { isUniqueViolation, type ProfileStore } from "../auth";

/**
 * Public profiles through the korbat_api pool. Onboarding writes the profile and the reservation of
 * its handle in one transaction; the unique index on lower(handle) and the primary key of
 * handle_history decide races and refuse a handle another profile holds or ever held.
 */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const profile = await apiDb.transaction(async (tx) => {
          const [created] = await tx.insert(profiles).values({ id, handle, displayName }).returning(columns);
          // The handle chosen at onboarding is reserved like every later one (1b design, section 6); a row for it under another profile ends the transaction.
          await tx.insert(handleHistory).values({ handleLower: handle.toLowerCase(), profileId: id });
          return created!;
        });
        return { ok: true, profile };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb
        .select({ ...columns, handleChangedAt: profiles.handleChangedAt, verifiedAt: profiles.verifiedAt, showInExplore: profiles.showInExplore })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!profile) return null;
      const { handleChangedAt, verifiedAt, showInExplore, ...pub } = profile;
      // The badge is a fact of the profile row (verified_at), read here so the account screen sees it on /me; so is the
      // author's Explore switch, which the privacy screen shows and the public profile never carries.
      return { ...pub, handleChangedAt: handleChangedAt?.toISOString() ?? null, verified: verifiedAt !== null, showInExplore };
    },
    async setVerified(id, at) {
      await apiDb.update(profiles).set({ verifiedAt: at }).where(eq(profiles.id, id));
    },
  };
}
```

### Replace `apps/api/src/social/cursor.ts` (whole file)

```ts
import { z } from "zod";
import { SocialError } from "./context";

/**
 * A keyset cursor: the sort time in epoch milliseconds, the post id, and for repost items the
 * reposter id. Every timestamp the repository writes has millisecond precision (it passes the
 * clock's Date instead of relying on the database default), so the cursor round-trips exactly.
 */
/** The largest time a JavaScript Date can hold; anything above it is not a cursor this module produced. */
export const MAX_CURSOR_TIME = 8_640_000_000_000_000;

const Cursor = z.strictObject({
  t: z.number().int().min(0).max(MAX_CURSOR_TIME),
  id: z.uuid(),
  r: z.uuid().optional(),
});
export type Cursor = z.infer<typeof Cursor>;

/** The largest generation explore_runs can number (an integer column), so a forged one can never overflow the query. */
export const MAX_GENERATION = 2_147_483_647;

/**
 * Explore's own cursor (2c design, section 8): the ranking a reader is paging through and the last post they read, never a
 * position, so it tells nothing about a post's place beyond the order already shown. A ranking cannot be paged by time,
 * so the timeline cursor cannot carry it, and neither cursor is accepted for the other.
 */
const ExploreCursor = z.strictObject({
  g: z.number().int().min(1).max(MAX_GENERATION),
  id: z.uuid(),
});
export type ExploreCursor = z.infer<typeof ExploreCursor>;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Opaque to clients; anything that is not a cursor this module produced is `invalid_request`. */
function decode<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  return result.data;
}

export function encodeCursor(cursor: Cursor): string {
  return encode(cursor);
}

export function decodeCursor(raw: string): Cursor {
  return decode(raw, Cursor);
}

export function encodeExploreCursor(cursor: ExploreCursor): string {
  return encode(cursor);
}

export function decodeExploreCursor(raw: string): ExploreCursor {
  return decode(raw, ExploreCursor);
}
```

### Replace `apps/api/src/social/flows/export.ts` (whole file)

```ts
import type { MediaView } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import type { ExportKey, ExportPage, ExportedPostRow, HandleRefRow, PostRefRow } from "../repo";

/** An image on one of the exported posts, as the media module reports it; the account module names its file in the archive. */
export interface ExportedMedia {
  id: string;
  altText: string;
  width: number;
  height: number;
}

export type ExportedPost = ExportedPostRow & { media: ExportedMedia[] };

/**
 * The social module's part of the data export (1b design, section 7.5): the profile with every handle
 * it ever had and its Explore switch (2c design, section 8), every post it wrote whatever its state,
 * with its images, what it liked, reposted and bookmarked, and the accounts it follows, blocks and
 * mutes by the handle they have now. Times are Dates here; the account module writes them as ISO text.
 *
 * The profile is read at once; each list is read page by page while the account module writes it, so
 * an account with many rows never has them all in memory. A list can be iterated more than once; each
 * iteration reads it again from the start.
 */
export interface ProfileExport {
  profile: { handle: string; displayName: string; bio: string; createdAt: Date; handleHistory: string[]; showInExplore: boolean };
  posts: AsyncIterable<ExportedPost[]>;
  likes: AsyncIterable<PostRefRow[]>;
  reposts: AsyncIterable<PostRefRow[]>;
  bookmarks: AsyncIterable<PostRefRow[]>;
  following: AsyncIterable<HandleRefRow[]>;
  blocks: AsyncIterable<HandleRefRow[]>;
  mutes: AsyncIterable<HandleRefRow[]>;
}

/** Rows per page of an export list: one statement each, and at most this many rows of a list in memory at once. */
export const EXPORT_PAGE_SIZE = 1_000;

/**
 * A list read in keyset pages, in (created_at, id) order: each page starts after the key of the last row
 * of the page before, and is read only once that page has been used. The walk ends at a page that is not
 * full.
 */
function paged<T>(read: (after: ExportKey | null) => Promise<ExportPage<T>>): AsyncIterable<T[]> {
  return {
    async *[Symbol.asyncIterator]() {
      let after: ExportKey | null = null;
      do {
        const page: ExportPage<T> = await read(after);
        if (page.rows.length > 0) yield page.rows;
        after = page.next;
      } while (after !== null);
    },
  };
}

/** Each page of posts with its images, fetched from the media module for that page's posts only. */
function withMedia(deps: SocialDeps, pages: AsyncIterable<ExportedPostRow[]>): AsyncIterable<ExportedPost[]> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const rows of pages) {
        const media: Map<string, MediaView[]> = await deps.media.forPosts(rows.map((post) => post.id));
        yield rows.map((post) => ({
          ...post,
          media: (media.get(post.id) ?? []).map((view) => ({ id: view.id, altText: view.alt, width: view.width, height: view.height })),
        }));
      }
    },
  };
}

export async function exportProfile(deps: SocialDeps, userId: string, pageSize: number = EXPORT_PAGE_SIZE): Promise<ProfileExport> {
  const head = await deps.repo.exportHead(userId);
  if (!head) throw new SocialError("not_found", 404);

  // handle_history holds the handle chosen at onboarding and every one later left behind, so the current handle
  // is there only when the account went back to one it had before; the list names every handle, the current one included.
  const handleHistory = [...head.handleHistory];
  const current = head.profile.handle.toLowerCase();
  if (!handleHistory.includes(current)) handleHistory.push(current);

  return {
    profile: {
      handle: head.profile.handle,
      displayName: head.profile.displayName,
      bio: head.profile.bio,
      createdAt: head.profile.createdAt,
      handleHistory,
      showInExplore: head.showInExplore,
    },
    posts: withMedia(
      deps,
      paged((after) => deps.repo.exportPosts(userId, after, pageSize)),
    ),
    likes: paged((after) => deps.repo.exportPostRefs(userId, "likes", after, pageSize)),
    reposts: paged((after) => deps.repo.exportPostRefs(userId, "reposts", after, pageSize)),
    bookmarks: paged((after) => deps.repo.exportPostRefs(userId, "bookmarks", after, pageSize)),
    following: paged((after) => deps.repo.exportHandleRefs(userId, "follows", after, pageSize)),
    blocks: paged((after) => deps.repo.exportHandleRefs(userId, "blocks", after, pageSize)),
    mutes: paged((after) => deps.repo.exportHandleRefs(userId, "mutes", after, pageSize)),
  };
}
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
import type { Cursor, ExploreCursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

/** One row of an Explore page: the post, and its place in the ranking, which orders the page and is never answered. */
export interface ExploreRow {
  postId: string;
  position: number;
}

/**
 * What one statement found for a page of Explore: the current generation (null before the first round); the ranking
 * read, the cursor's or else the current one, with its time, when it is kept (null otherwise); the position of the
 * cursor's post in that ranking (null when the ranking does not hold it; 0 without a cursor); and the rows after that
 * position that pass the page's filters, in order, at most the limit asked for.
 */
export interface ExplorePageRead {
  current: number | null;
  ranking: { generation: number; asOf: Date } | null;
  after: number | null;
  rows: ExploreRow[];
}

/**
 * What the author's status needs to know about one post before any judgement: who wrote it, whether it is a reply or a
 * quote, whether it is visible, whether its author shows in Explore, whether it is older than the window at the request
 * time, and the current ranking, if there is one, with its time, whether it holds the post and whether the post was
 * written after it.
 */
export interface ExploreFacts {
  authorId: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  shown: boolean;
  outsideWindow: boolean;
  ranking: { generation: number; asOf: Date; holdsPost: boolean; postIsNewer: boolean } | null;
}

/**
 * The status's judgement of one post: whether it meets every rule of the formula as of the request time and as of the
 * ranking's time, and how many places the ranking gives the post's author and holds in all.
 */
export interface ExploreJudgement {
  metNow: boolean;
  metAtRanking: boolean;
  authorPlaces: number;
  places: number;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A row of the Explore page statement: the page's facts on every row, and a post on each row but a lone one for an empty page. */
interface RawExplorePage {
  current: number | null;
  generation: number | null;
  as_of: string | null;
  after: number | null;
  post_id: string | null;
  position: number | null;
}

interface RawExploreFacts {
  author_id: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  shown: boolean;
  outside_window: boolean;
  generation: number | null;
  as_of: string | null;
  holds_post: boolean;
  newer: boolean | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_COLUMNS = sql`id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at`;
const PROFILE_SELECT = sql`select ${PROFILE_COLUMNS} from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

/** Durations built in SQL from the formula's numbers, so each number travels as a parameter. */
const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;

/**
 * The rules of one Explore formula as of one time (2c design, section 7), as SQL fragments. The refresh ranks with them
 * and the author's status judges one post with them, so the two cannot disagree; the time and every number of the formula
 * travel as parameters. `post` narrows the candidates and the engagement to one post, which the status reads through that
 * post's own indexes; the rules are the same either way.
 */
function exploreRules(asOf: Date, formula: ExploreFormula) {
  const at = sql`${asOf.toISOString()}::timestamptz`;
  // A candidate is younger than the window, and only engagement inside the window counts.
  const since = sql`${at} - ${hours(formula.windowHours)}`;
  // Engagement counts once it has stood this long, so a like made just before a round and undone after it never counts.
  const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
  const onePost = (column: SQL, post?: string): SQL => (post ? sql` and ${column} = ${post}::uuid` : sql.empty());
  /**
   * The one candidate predicate: visible top-level posts that are not quotes, by live authors who have not switched
   * Explore off, created in the window up to the time. Later rules about imports, suspension and restoration belong here.
   */
  const candidates = (post?: string): SQL => sql`
    select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
    where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
      and a.deleted_at is null and a.show_in_explore${onePost(sql`p.id`, post)}`;
  /**
   * The engagement that counts, read from the candidates `c`: likes and reposts in the window that have stood long enough,
   * by live accounts other than the author that were old enough when they engaged.
   */
  const engagement = (post?: string): SQL => sql`
    select x.post_id, x.user_id from (
      select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
      union all
      select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
    ) x
    join c on c.id = x.post_id
    join profiles u on u.id = x.user_id
    where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}`;
  /** The approving accounts per post, read from the engagement `e`: each counted once however it engaged, for the posts that reach the threshold. */
  const approvers = sql`select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}`;
  return {
    at,
    since,
    candidates,
    engagement,
    approvers,
    /**
     * Whether `post` is a candidate that reaches the threshold: the three fragments as the CTEs c, e and ap of a subquery
     * of their own, so one statement can ask at two times.
     */
    met: (post: string): SQL => sql`exists (with c as (${candidates(post)}), e as (${engagement(post)}), ap as (${approvers}) select 1 from ap)`,
  };
}

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive).
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockLive(tx, sql`id = ${input.authorId}::uuid`);
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. `within` runs in the same transaction. */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it (lockLive).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockLive(tx, sql`id in (${followerId}::uuid, ${followeeId}::uuid)`);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking is younger than the formula's minimum gap, so
     * at most one ranking lands per interval however many instances run the job or restart. The newest `kept` rankings
     * stay, so a reader paging through the one before the current one can finish; older ones go with their items.
     *
     * The statement's CTEs: `c` the candidates, `e` the engagement that counts and `ap` the approving accounts per post
     * reaching the threshold, all three the shared rules of `exploreRules`, which the author's status judges with too; `s`
     * the score, approvers over (hours since posted, never negative, + offset) ^ gravity; `r` each author's posts numbered
     * by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts within the
     * per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id; `ins` the
     * items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreRefresh> {
      const started = performance.now();
      const rules = exploreRules(asOf, formula);
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        const [recent] = (await tx.execute(sql`select exists (select 1 from explore_runs where as_of > ${rules.at} - ${minutes(formula.minGapMinutes)}) as fresh`)) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${rules.at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (${rules.candidates()}),
          e as (${rules.engagement()}),
          ap as (${rules.approvers}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${rules.at} - c.created_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
    },

    /**
     * A page of Explore (2c design, section 8), read by one statement, so a round that prunes a ranking between the checks
     * and the page cannot turn one answer into another: the current generation; the ranking read (the cursor's, or else
     * the current one) when it is kept, with its time; the position of the cursor's post in it; and after that position,
     * in order, the items whose post is visible (for every reader, its author too), whose author is live and shows in
     * Explore, and, for a signed-in reader, with no block either way between reader and author and no mute of the author.
     * The filters come before the limit, so a page is full whenever the ranking holds that many posts the reader may see.
     * The statement answers one row per post, or a lone row without one for an empty page; the flow decides what a missing
     * ranking or post means.
     */
    async explorePage(viewer: string | null, cursor: ExploreCursor | undefined, limit: number): Promise<ExplorePageRead> {
      const raw = await rows<RawExplorePage>(sql`
        with cur as (select max(generation) as generation from explore_runs),
        run as (select generation, as_of from explore_runs where generation = ${cursor ? sql`${cursor.g}::int` : sql`(select generation from cur)`}),
        pos as (${cursor ? sql`select position from explore_items where generation = ${cursor.g}::int and post_id = ${cursor.id}::uuid` : sql`select 0 as position`}),
        page as (
          select i.post_id, i.position from explore_items i join posts p on p.id = i.post_id join profiles a on a.id = p.author_id
          where i.generation = (select generation from run) and i.position > (select position from pos)
            and p.state = 'visible' and a.deleted_at is null and a.show_in_explore and ${viewer ? otherWelcome(viewer, sql`p.author_id`) : sql`true`}
          order by i.position limit ${limit}
        )
        select cur.generation as current, run.generation, ${iso("run.as_of")} as as_of, pos.position as after, page.post_id, page.position
        from cur left join run on true left join pos on true left join page on true
        order by page.position`);
      const head = raw[0]!;
      return {
        current: head.current,
        ranking: head.generation === null ? null : { generation: head.generation, asOf: new Date(head.as_of!) },
        after: head.after,
        rows: raw.filter((row) => row.post_id !== null).map((row) => ({ postId: row.post_id!, position: row.position! })),
      };
    },

    /**
     * What the author's status needs about one post before any judgement (2c design, section 8), as of `now`: the window is
     * the formula's, through the same rules the refresh ranks with. Null when there is no such post.
     */
    async exploreFacts(postId: string, now: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreFacts | null> {
      const rules = exploreRules(now, formula);
      const [r] = await rows<RawExploreFacts>(sql`
        with run as (select generation, as_of from explore_runs order by generation desc limit 1)
        select p.author_id, p.reply_to_id is not null as reply, p.quote_of_id is not null as quote, p.state = 'visible' as visible,
          a.show_in_explore as shown, p.created_at <= ${rules.since} as outside_window,
          run.generation, ${iso("run.as_of")} as as_of, p.created_at > run.as_of as newer,
          exists (select 1 from explore_items i where i.generation = run.generation and i.post_id = p.id) as holds_post
        from posts p join profiles a on a.id = p.author_id left join run on true
        where p.id = ${postId}::uuid`);
      if (!r) return null;
      return {
        authorId: r.author_id,
        reply: r.reply,
        quote: r.quote,
        visible: r.visible,
        shown: r.shown,
        outsideWindow: r.outside_window,
        ranking: r.generation === null ? null : { generation: r.generation, asOf: new Date(r.as_of!), holdsPost: r.holds_post, postIsNewer: r.newer! },
      };
    },

    /**
     * The status's judgement of one post, from one statement about that post alone and never a ranking: whether it meets
     * every rule of the formula (the candidate predicate, the engagement that counts, the threshold) as of `now` and again
     * as of the ranking's time, through the very fragments the refresh ranks with, and how many places the ranking gives
     * the post's author and holds in all. Each count reads at most the ranking's items.
     */
    async exploreJudgement(
      post: { id: string; authorId: string },
      now: Date,
      ranking: { generation: number; asOf: Date },
      formula: ExploreFormula = EXPLORE_V1,
    ): Promise<ExploreJudgement> {
      const [r] = await rows<{ met_now: boolean; met_at_ranking: boolean; author_places: number; places: number }>(sql`
        select ${exploreRules(now, formula).met(post.id)} as met_now, ${exploreRules(ranking.asOf, formula).met(post.id)} as met_at_ranking,
          (select count(*) from explore_items where generation = ${ranking.generation}::int and author_id = ${post.authorId}::uuid)::int as author_places,
          (select count(*) from explore_items where generation = ${ranking.generation}::int)::int as places`);
      return { metNow: r!.met_now, metAtRanking: r!.met_at_ranking, authorPlaces: r!.author_places, places: r!.places };
    },

    /**
     * Of the viewer's own posts given, those the current Explore ranking holds while the viewer's switch is on: with the
     * visible posts only, which the caller passes, exactly those whose status would be listed, and so the posts that carry
     * the author's chip. One statement for any number of posts.
     */
    async listedInExplore(viewer: string, postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) return new Set();
      const raw = await rows<{ post_id: string }>(sql`
        select i.post_id from explore_items i join profiles a on a.id = i.author_id
        where i.generation = (select max(generation) from explore_runs) and i.post_id = any(${uuidArray(postIds)})
          and i.author_id = ${viewer}::uuid and a.deleted_at is null and a.show_in_explore`);
      return new Set(raw.map((r) => r.post_id));
    },

    /** Turns "Show my posts in Explore" on or off. False when there is no such live profile. */
    async setShowInExplore(id: string, on: boolean): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ showInExplore: on })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row, its Explore switch (the owner's, which the profile row the public
     * reads leaves out), and every handle in handle_history for it, in the order they were recorded. Null when there is
     * no live profile. The lists come page by page from the reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; showInExplore: boolean; handleHistory: string[] } | null> {
      const [r] = await rows<RawProfile & { show_in_explore: boolean }>(sql`select ${PROFILE_COLUMNS}, show_in_explore from profiles where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`);
      return { profile: toProfile(r), showInExplore: r.show_in_explore, handleHistory: history.map((row) => row.handle_lower) };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would).
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        await within(tx);
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found"): Promise<void> {
  const found = (await tx.execute(sql`select deleted_at from profiles where ${accounts} for key share`)) as unknown as { deleted_at: string | null }[];
  if (found.some((row) => row.deleted_at !== null)) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/api/src/social/routes.ts` (whole file)

```ts
import { CreatePostRequest, HandleChangeRequest, HandleParam, Pagination, PostId, ProfileEditRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { MediaError } from "../media";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { explorePage, exploreStatus, setShowInExplore } from "./flows/explore";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, thread } from "./flows/posts";
import { changeHandle, editProfile } from "./flows/profile-edit";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/** Signed out, Explore is its first page only (2c design, section 8): a cursor asks for more, which needs an account. */
const EXPLORE_SIGN_IN = "Sign in to see more of Explore.";

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions. `fresh` is its requireFreshAuth: a credential proven
 * in the last five minutes, which a handle change needs on top.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const viewer = (c: Context<AppEnv>): ViewerId => c.get("session")?.userId ?? null;
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.onError((err, c) => {
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // Creating a post attaches its images through the media module, which refuses with its own error type.
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in social route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  // ---------------------------------------------------------------- posts

  r.post("/posts", guard, validate("json", CreatePostRequest), async (c) => c.json(await createPost(deps, me(c), c.req.valid("json")), 201));
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );
  // Why the author's own post is in Explore or not; anyone else gets not_found from the flow.
  r.get("/posts/:id/explore", guard, validate("param", PostParam), async (c) => c.json(await exploreStatus(deps, me(c), c.req.valid("param").id)));

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));
  r.get("/timeline/explore", validate("query", Pagination), async (c) => {
    const query = c.req.valid("query");
    // Refused here, before the flow reads anything: whatever the cursor holds, a signed-out reader gets the first page only.
    if (!viewer(c) && query.cursor) return c.json(errorBody("unauthenticated", EXPLORE_SIGN_IN, c.get("requestId")), 401);
    return c.json(await explorePage(deps, viewer(c), query));
  });

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/followers", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await followers(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/following", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await following(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );

  r.post("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, false)));

  // ---------------------------------------------------------------- the viewer's private lists

  r.get("/me/likes", guard, validate("query", Pagination), async (c) => c.json(await likedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/bookmarks", guard, validate("query", Pagination), async (c) => c.json(await bookmarkedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/blocks", guard, validate("query", Pagination), async (c) => c.json(await blockedList(deps, me(c), c.req.valid("query"))));
  r.get("/me/mutes", guard, validate("query", Pagination), async (c) => c.json(await mutedList(deps, me(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- the viewer's own profile

  r.patch("/me/profile", guard, validate("json", ProfileEditRequest), async (c) => c.json({ profile: await editProfile(deps, me(c), c.req.valid("json")) }));
  r.post("/me/handle", guard, fresh, validate("json", HandleChangeRequest), async (c) => c.json({ profile: await changeHandle(deps, me(c), c.req.valid("json")) }));
  // "Show my posts in Explore": on and off, with no body, as the app's other switches.
  r.post("/me/explore", guard, async (c) => c.json(await setShowInExplore(deps, me(c), true)));
  r.delete("/me/explore", guard, async (c) => c.json(await setShowInExplore(deps, me(c), false)));

  return r;
}
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, and their images through the media module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media">;

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

export function authorOf(profile: ProfileRow): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state, and every post's images. Ids that resolve to nothing
 * become tombstones, and tombstones carry no images. The viewer's own visible posts that the current
 * Explore ranking holds, while their switch is on, carry the author's chip (2c design, section 8):
 * asked in one query, and only when the viewer wrote some of the posts; a quoted embed never carries it.
 */
export async function loadPostViews({ repo, media }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].flatMap((row) => (row.replyToAuthorId ? [row.authorId, row.replyToAuthorId] : [row.authorId])))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);
  // A withheld or removed post is never in Explore for anyone, its author included, so only visible ones are asked about.
  const own = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && row.state === "visible").map((row) => row.id) : [];
  const inExplore = viewer && own.length > 0 ? await repo.listedInExplore(viewer, own) : new Set<string>();

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  /** The parent's handle only when the viewer could open the parent; a block either way, or a hidden or deleted parent, gives null. */
  const parentHandle = (row: PostRow): string | null =>
    row.replyToAuthorId && row.replyToState && postAccess(viewer, { authorId: row.replyToAuthorId, state: row.replyToState }, blocked.has(row.replyToAuthorId)) === "shown"
      ? row.replyToHandle
      : null;
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: parentHandle(row) } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    media: images.get(row.id) ?? [],
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    return a === "shown" ? { ...base(row), quoteOf: null } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    out.set(id, a === "shown" ? { ...base(row), ...(inExplore.has(id) ? { inExplore: true as const } : {}), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(source: ViewSource, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(source, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  const reposters = await source.repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
```

### Replace `packages/contracts/src/account.ts` (whole file)

```ts
import { z } from "zod";
import { Platform, Role } from "./auth";

const at = z.iso.datetime();

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
});

/** A passkey of the account as the export lists it (1c design, section 7.7): what the Security screen shows, and nothing that identifies the key, its id or its authenticator. */
const ExportedPasskey = z.object({
  name: z.string(),
  createdAt: at,
  lastUsedAt: at.nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
    /** The account's passkeys, newest first. Added to korbat-export-1 without a new format name: a reader that does not know the member loses nothing by skipping it. */
    passkeys: z.array(ExportedPasskey),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
    /**
     * "Show my posts in Explore" as it stands (2c design, section 8). Added to korbat-export-1 without a new format name: a
     * reader that does not know the member loses nothing by skipping it.
     */
    showInExplore: z.boolean(),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  /** The live sessions. `id` is the session's handle, as the session list names it; the hash of its token never leaves the server. */
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
```

### Replace `packages/contracts/src/auth.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the auth endpoints can put in ErrorEnvelope.error.code. */
export const AuthErrorCode = z.enum([
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "invalid_credentials",
  "mfa_required",
  "invalid_mfa_code",
  "reauth_required",
  "csrf_failed",
  "turnstile_failed",
  "disposable_email",
  "age_requirement",
  "terms_required",
  "handle_taken",
  "handle_invalid",
  "handle_reserved",
  "password_too_short",
  "password_too_long",
  "password_breached",
  "password_check_unavailable",
  "staff_mfa_required",
  "onboarding_required",
  "mail_unavailable",
  "rate_limited",
  "handle_cooldown",
  "email_in_use",
  "phone_in_use",
  "badge_unavailable",
  "verify_unavailable",
  // Passkeys (1c design, sections 8 and 9).
  "passkey_invalid",
  "passkey_unsupported",
  "passkey_limit",
  "passkey_suspended",
  "passkey_not_found",
  "challenge_expired",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

/** Random id created once per app install. The server stores only a keyed hash of it. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** 32 random bytes as base64url without padding: flow ids, MFA tickets, single-use link tokens. */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const EmailCode = z.string().regex(/^\d{6}$/);
export const TotpCode = z.string().regex(/^\d{6}$/);
/**
 * A phone number in E.164 once the spaces, hyphens and parentheses people type are dropped: a plus and
 * 7 to 15 digits, the first not zero. Whether the number exists is the verification provider's call.
 */
export const Phone = z
  .string()
  .trim()
  .max(64)
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, "phone numbers are written like +447911123456"));
/** The six-digit code the verification provider texts to a phone; the development provider's is 000000. */
export const PhoneCode = z.string().regex(/^\d{6}$/);
export const RecoveryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
/** Handle rules (3-20 of a-z, 0-9, _; reserved names) are enforced by the flow so it can return a specific error code. */
export const HandleInput = z.string().trim().toLowerCase().min(1).max(64);
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), { message: "invisible direction and spacing characters are not allowed" });
export const TurnstileToken = z.string().min(1).max(2048);
/** Length rules (12-128) are enforced by the flow so it can return password_too_short or password_too_long. */
export const PasswordInput = z.string().min(1).max(1024);

/**
 * A new bearer token after the server rotated the session. Present only for native clients; web
 * clients receive fresh cookies instead.
 */
export const RotatedToken = z.string().optional();

// ---------------------------------------------------------------- email entry and sign-up

export const EmailStartRequest = z.object({
  email: Email,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const FlowResponse = z.object({ flowId: OpaqueId });
export type FlowResponse = z.infer<typeof FlowResponse>;

export const EmailVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

/** A session was issued. Native clients get the bearer token in the body; web clients only get cookies. */
export const SessionResult = z.object({
  result: z.literal("session"),
  mustReenrollMfa: z.boolean(),
  token: z.string().optional(),
});
export const MfaRequiredResult = z.object({ result: z.literal("mfa_required"), mfaTicket: OpaqueId });
export const SignupRequiredResult = z.object({ result: z.literal("signup_required") });

export const EmailVerifyResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult, SignupRequiredResult]);
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponse>;

export const SignInResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const SignupCompleteRequest = z.object({
  flowId: OpaqueId,
  dateOfBirth: z.iso.date(),
  termsVersion: z.string().min(1).max(64),
});
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequest>;

export const Profile = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type Profile = z.infer<typeof Profile>;

export const OnboardingHandleRequest = z.object({ handle: HandleInput, displayName: DisplayName });
export type OnboardingHandleRequest = z.infer<typeof OnboardingHandleRequest>;

export const OnboardingHandleResponse = z.object({ profile: Profile, token: RotatedToken });
export type OnboardingHandleResponse = z.infer<typeof OnboardingHandleResponse>;

// ---------------------------------------------------------------- password

export const PasswordSigninRequest = z.object({
  email: Email,
  password: PasswordInput,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type PasswordSigninRequest = z.infer<typeof PasswordSigninRequest>;

export const PasswordSetRequest = z.object({ password: PasswordInput });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;

export const PasswordSetResponse = z.object({ token: RotatedToken });
export type PasswordSetResponse = z.infer<typeof PasswordSetResponse>;

// ---------------------------------------------------------------- MFA

export const TotpSetupResponse = z.object({
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  qrSvg: z.string().startsWith("<svg"),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

/**
 * Turning TOTP off takes no code (1c design, section 2): the route needs a level-2 re-authentication, which already spent
 * the current step. A code a client sends anyway is dropped.
 */
export const TotpDisableRequest = z.object({});
export type TotpDisableRequest = z.infer<typeof TotpDisableRequest>;

export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10) });
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;

export const TotpConfirmResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10), token: RotatedToken });
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponse>;

/** Exactly one of `code` or `recoveryCode`. */
export const MfaVerifyRequest = z.union([
  z.strictObject({ mfaTicket: OpaqueId, code: TotpCode }),
  z.strictObject({ mfaTicket: OpaqueId, recoveryCode: RecoveryCode }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

// ---------------------------------------------------------------- re-authentication

// ReauthRequest lives in passkeys.ts: its `passkey` variant needs AuthenticationResponseJSON, and having auth.ts import
// that would form a cycle (passkeys.ts already imports this file). ReauthResponse stays here, as it names no passkey type.

/**
 * What a re-authentication answers (1c design, section 7.2): the level the session holds now (2 when a second factor
 * stands beside a first within the window, or a user-verified passkey does), the rotated token for native clients (web
 * clients get fresh cookies instead), and, after a recovery code, that two-factor authentication should be set up again.
 */
export const ReauthResponse = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  token: RotatedToken,
  mustReenrollMfa: z.boolean().optional(),
});
export type ReauthResponse = z.infer<typeof ReauthResponse>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  /**
   * The session's handle: a random id it keeps for its whole life, which `DELETE /api/auth/sessions/:id` takes. Never the
   * token's hash, which changes whenever the token rotates (at every re-authentication, for one), so a session listed
   * before a rotation can still be revoked after it.
   */
  id: z.uuid(),
  deviceLabel: z.string(),
  platform: Platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const SessionsResponse = z.object({ sessions: z.array(SessionInfo) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const NotMeRequest = z.object({ token: OpaqueId });
export type NotMeRequest = z.infer<typeof NotMeRequest>;

/**
 * The signed-in account's own profile as /me returns it (the profile-editing routes answer the public ProfileView): the public facts
 * plus when the handle last changed (the app shows when the next change is allowed), whether the
 * verified badge is held, and whether the account's posts show in Explore (2c design, section 8), a
 * switch that is the author's own and never part of the public profile.
 */
export const MeProfile = Profile.extend({ handleChangedAt: z.iso.datetime().nullable(), verified: z.boolean(), showInExplore: z.boolean() });
export type MeProfile = z.infer<typeof MeProfile>;

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    /** How many passkeys the account holds (1c design, section 7.5): above zero the app offers a passkey re-authentication, at zero it suggests adding one. */
    passkeys: z.number().int().nonnegative(),
  }),
  profile: MeProfile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---------------------------------------------------------------- email change

/** The new address, under the sign-up rules. The flow refuses the current address and disposable ones. */
export const EmailChangeStartRequest = z.object({ email: Email });
export type EmailChangeStartRequest = z.infer<typeof EmailChangeStartRequest>;

export const EmailChangeVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailChangeVerifyRequest = z.infer<typeof EmailChangeVerifyRequest>;

/** The address the account now has. */
export const EmailChangeResponse = z.object({ email: z.email() });
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/**
 * The token from the link the email_changed notice sends to the old address. It is the only credential
 * the undo needs, since a passwordless account cannot sign in at the old address any more.
 */
export const EmailRevertRequest = z.object({ token: OpaqueId });
export type EmailRevertRequest = z.infer<typeof EmailRevertRequest>;

// ---------------------------------------------------------------- verified badge

export const BadgeStartRequest = z.object({ phone: Phone });
export type BadgeStartRequest = z.infer<typeof BadgeStartRequest>;

export const BadgeVerifyRequest = z.object({ flowId: OpaqueId, code: PhoneCode });
export type BadgeVerifyRequest = z.infer<typeof BadgeVerifyRequest>;

export const BadgeVerifyResponse = z.object({ verified: z.literal(true) });
export type BadgeVerifyResponse = z.infer<typeof BadgeVerifyResponse>;

// ---------------------------------------------------------------- account deletion

export const DeleteStartResponse = z.object({ flowId: OpaqueId });
export type DeleteStartResponse = z.infer<typeof DeleteStartResponse>;

/** The emailed code and the account's handle typed by the owner; the flow compares the handle case-insensitively. */
export const DeleteConfirmRequest = z.object({ flowId: OpaqueId, code: EmailCode, handle: HandleInput });
export type DeleteConfirmRequest = z.infer<typeof DeleteConfirmRequest>;
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { FORBIDDEN_FORMAT, visibleLength } from "./text";

/**
 * Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited).
 * explore_refreshed (409) refuses a page of an Explore ranking that is no longer kept.
 */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. */
const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order. Always present, often empty. */
  media: z.array(MediaView),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

export const PostView = z.object({
  ...postFields,
  /**
   * The author's "In Explore" chip (2c design, section 8): present, and true, only on the viewer's own post while it is in
   * the current Explore ranking with their switch on. Nobody else's view carries it, nor does a quoted embed. It sits here
   * rather than in `viewer`, which the like, repost and bookmark answers replace.
   */
  inExplore: z.literal(true).optional(),
  quoteOf: z.union([QuotedPost, Tombstone]).nullable(),
});
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
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
packages/contracts test:       Tests  106 passed (106)
packages/db test:       Tests  32 passed (32)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  64 passed (64)
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

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/export.ts`
- `apps/api/src/auth/context.ts`
- `apps/api/src/profiles/store.ts`
- `apps/api/src/social/cursor.ts`
- `apps/api/src/social/flows/explore.ts`
- `apps/api/src/social/flows/export.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/routes.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/explore-fixtures.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-explore.test.ts`
- `apps/api/test/integration/social-explore-reads.test.ts`
- `apps/api/test/integration/social-flows-profile-edit.test.ts`
- `apps/api/test/social/cursor.test.ts`
- `packages/contracts/src/account.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/account.test.ts`
- `packages/contracts/test/auth.test.ts`
- `packages/contracts/test/social.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): the Explore reads: GET /api/timeline/explore reads a ranking in one statement with its own strict {g, id} cursor (a generation not yet written or a post outside it 400, a pruned one 409 explore_refreshed), visible posts of live authors who show in Explore for every reader, blocks both ways and mutes before the limit; signed out, the first 20 posts with signInForMore, and a cursor refused 401; GET /api/posts/:id/explore tells the author alone why a post is in Explore or not, without a count, through the SQL rules the ranking uses; POST and DELETE /api/me/explore set the switch, which /api/me and the export carry; the author's own listed posts carry inExplore" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): the Explore reads: GET /api/timeline/explore reads a ranking in one statement with its own strict {g, id} cursor (a generation not yet written or a post outside it 400, a pruned one 409 explore_refreshed), visible posts of live authors who show in Explore for every reader, blocks both ways and mutes before the limit; signed out, the first 20 posts with signInForMore, and a cursor refused 401; GET /api/posts/:id/explore tells the author alone why a post is in Explore or not, without a count, through the SQL rules the ranking uses; POST and DELETE /api/me/explore set the switch, which /api/me and the export carry; the author's own listed posts carry inExplore`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 24>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
