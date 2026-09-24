# korbat audit fixes — Task 6 of 11: A reply's parent author is hidden with the parent; blocking retracts reposts and likes both ways; pair locks close the race between a block and a follow, like, repost, reply or quote; hidden posts answer with their state before a block; disguising characters are refused; follower pages filter before the limit; a failing limit store is a 503; ids are canonical; daily upload caps; four indexes

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous, harassment-aware social platform. Its social module enforces blocks in every query. The audit found gaps: a reply named its parent's author even when that author blocked the viewer, blocking left the blocked account's reposts and likes in place, a follow or like could land in the moment a block was being written, a blocker probing ids could learn which hidden posts belonged to whom, invisible direction and spacing characters passed the text rules, follower pages were cut before blocked accounts were removed, a failing rate-limit store became a 500, and a forged cursor could crash a request. This task fixes each with a test, adds daily upload caps, and adds the indexes the reviews asked for. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 6.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api): background jobs run under a refreshed lock without overlapping; the auth janitor purges dead codes, old sessions, device address hashes after 30 days and security events after 90 through a migrator-owned function; the sweeper refuses to delete many images without a row unless forced; store entries are inspected before being opened, never blocking`.
3. The previous task's last API unit run ended with `Tests  163 passed | 152 skipped (315)`.

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
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/06-social-fixes.md 1
```

Expected: 8 lines starting with `wrote`, one for each file below.

### Replace `packages/contracts/test/social.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AltText,
  CreatePostRequest,
  DisplayName,
  HandleParam,
  PostBody,
  PostId,
  PostView,
  ProfileListItem,
  ProfileView,
  SocialErrorCode,
  ThreadResponse,
  TimelineItem,
  TimelinePage,
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
  });
  test("the error codes are exactly the five social ones", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
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

### Replace `apps/api/test/social/cursor.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { SocialError } from "../../src/social/context";
import { MAX_CURSOR_TIME, decodeCursor, encodeCursor } from "../../src/social/cursor";

const id = "00000000-0000-4000-8000-000000000001";
const reposter = "00000000-0000-4000-8000-000000000002";

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
```

### Replace `apps/api/test/social/limits.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { SocialError } from "../../src/social/context";
import { enforceWriteLimit } from "../../src/social/limits";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";

const user = "00000000-0000-4000-8000-000000000001";

function harness(accountAgeMs: number) {
  let t = 1_789_000_000_000;
  const store = new MemoryStore(() => t);
  const createdAt = new Date(t - accountAgeMs);
  const now = () => new Date(t);
  return { store, createdAt, now, advance: (ms: number) => { t += ms; } };
}

async function code(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof SocialError) return err.code;
    throw err;
  }
}

describe("write limits", () => {
  test("a new account gets five posts an hour, then rate_limited with a Retry-After", async () => {
    const h = harness(HOUR_MS);
    for (let i = 0; i < 5; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    const err = await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect((err as SocialError).code).toBe("rate_limited");
    expect((err as SocialError).status).toBe(429);
    expect((err as SocialError).retryAfterSeconds).toBeGreaterThan(0);
    h.advance(HOUR_MS + 1);
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBeNull();
  });
  test("an established account gets thirty posts an hour", async () => {
    const h = harness(3 * DAY_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBe("rate_limited");
  });
  test("reposts and quotes are account_too_new before 48 hours, and quotes then count as posts", async () => {
    const young = harness(47 * HOUR_MS);
    expect(await code(enforceWriteLimit(young.store, user, "repost", young.createdAt, young.now()))).toBe("account_too_new");
    expect(await code(enforceWriteLimit(young.store, user, "quote", young.createdAt, young.now()))).toBe("account_too_new");
    const old = harness(49 * HOUR_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(old.store, user, "quote", old.createdAt, old.now());
    expect(await code(enforceWriteLimit(old.store, user, "post", old.createdAt, old.now()))).toBe("rate_limited");
  });
  test("a store that fails refuses the write with service_unavailable and a 30-second Retry-After", async () => {
    const failing = {
      hit: async () => {
        throw new Error("connection lost");
      },
    };
    const err = await enforceWriteLimit(failing, user, "post", new Date(0), new Date()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "service_unavailable", status: 503, retryAfterSeconds: 30 });
  });
  test("follows stop at 400 a day even when each hour stays under 50", async () => {
    const h = harness(10 * DAY_MS);
    for (let hour = 0; hour < 8; hour++) {
      for (let i = 0; i < 50; i++) await enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now());
      h.advance(HOUR_MS + 1);
    }
    expect(await code(enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now()))).toBe("rate_limited");
    expect(await code(enforceWriteLimit(h.store, user, "like", h.createdAt, h.now()))).toBeNull();
  });
});
```

### Replace `apps/api/test/social/tiers.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { DAY_MS, HOUR_MS, NEW_ACCOUNT_MS, REPOST_MIN_AGE_MS, isNewAccount, limitsFor, mayRepostOrQuote } from "../../src/social/tiers";

describe("account tiers", () => {
  test("the low tier ends exactly at 24 hours", () => {
    expect(isNewAccount(NEW_ACCOUNT_MS - 1)).toBe(true);
    expect(isNewAccount(NEW_ACCOUNT_MS)).toBe(false);
    expect(limitsFor("post", 0)).toEqual([{ bucket: "post", max: 5, windowMs: HOUR_MS }]);
    expect(limitsFor("post", NEW_ACCOUNT_MS)).toEqual([{ bucket: "post", max: 30, windowMs: HOUR_MS }]);
    expect(limitsFor("reply", 0)[0]!.max).toBe(20);
    expect(limitsFor("reply", NEW_ACCOUNT_MS)[0]!.max).toBe(60);
  });
  test("reposts and quotes open at 48 hours, and quotes share the post bucket", () => {
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS - 1)).toBe(false);
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS)).toBe(true);
    expect(limitsFor("quote", 3 * DAY_MS)).toEqual(limitsFor("post", 3 * DAY_MS));
    expect(limitsFor("repost", 3 * DAY_MS)).toEqual([{ bucket: "repost", max: 30, windowMs: HOUR_MS }]);
  });
  test("image uploads: 20 an hour and 60 a day in the first day, 120 an hour and 500 a day afterwards", () => {
    expect(limitsFor("upload", 0)).toEqual([
      { bucket: "upload", max: 20, windowMs: HOUR_MS },
      { bucket: "upload-day", max: 60, windowMs: DAY_MS },
    ]);
    expect(limitsFor("upload", NEW_ACCOUNT_MS)).toEqual([
      { bucket: "upload", max: 120, windowMs: HOUR_MS },
      { bucket: "upload-day", max: 500, windowMs: DAY_MS },
    ]);
  });
  test("engagement and graph limits do not depend on age, and follows have two windows", () => {
    for (const age of [0, 10 * DAY_MS]) {
      expect(limitsFor("like", age)[0]!.max).toBe(100);
      expect(limitsFor("bookmark", age)[0]!.max).toBe(100);
      expect(limitsFor("block", age)[0]!.max).toBe(30);
      expect(limitsFor("mute", age)[0]!.max).toBe(30);
      expect(limitsFor("follow", age)).toEqual([
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ]);
    }
  });
});
```

### Replace `apps/api/test/middleware.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { validate } from "../src/lib/validate";
import { clientIdentity, resolveClientIp } from "../src/auth/client-ip";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  return app;
}

describe("observability", () => {
  test("adds a uuid x-request-id header", async () => {
    const app = base().get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security headers", () => {
  test("sets the hardened header set on every response", async () => {
    const app = base().get("/x", (c) => c.json({}));
    const h = (await app.request("/x")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("cache-control")).toBe("no-store");
  });
});

describe("rateLimit", () => {
  test("allows up to limit then returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const app = base()
      .use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const blocked = await app.request("/x");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()) as { error: { code: string } }).toMatchObject({ error: { code: "rate_limited" } });
    now += 10_001;
    expect((await app.request("/x")).status).toBe(200);
  });
  test("a failing store answers 503 with Retry-After instead of letting the request through", async () => {
    const store = {
      hit: async () => {
        throw new Error("redis down");
      },
    };
    const app = base().use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" })).get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ error: { code: "service_unavailable" } });
  });
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("client identity", () => {
  const key = Buffer.alloc(32, 1);
  const spoofed = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  const seen = async (trust: "cloudflare" | "caddy" | "none", ipHashKey = key) => {
    const app = base().use(clientIdentity({ trust, ipHashKey })).get("/x", (c) => c.json({ ip: c.get("clientIp"), hash: c.get("clientIpHash") }));
    return (await (await app.request("/x", { headers: spoofed })).json()) as { ip: string; hash: string };
  };
  test("cloudflare mode believes cf-connecting-ip", async () => {
    expect((await seen("cloudflare")).ip).toBe("203.0.113.9");
  });
  test("caddy mode takes the first forwarded entry and ignores cf-connecting-ip", async () => {
    expect((await seen("caddy")).ip).toBe("198.51.100.7");
  });
  test("none mode uses the socket only, so a spoofed header opens no bucket", async () => {
    expect((await seen("none")).ip).toBe("direct");
  });
  test("the hash is keyed and never the address itself", async () => {
    const a = await seen("cloudflare");
    const b = await seen("cloudflare", Buffer.alloc(32, 2));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.ip);
    expect(a.hash).not.toBe(b.hash);
  });
  test("missing headers fall back down the list", () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof resolveClientIp>[0];
    for (const trust of ["cloudflare", "caddy", "none"] as const) expect(resolveClientIp(c, trust)).toBe("direct");
  });
});

describe("validate", () => {
  test("returns 400 envelope with field details", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: "no" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { properties?: Record<string, unknown> } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.properties).toHaveProperty("n");
  });
  test("passes valid input through", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: 4 }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ n: 4 });
  });
});
```

### Replace `apps/api/test/integration/social-flows-posts.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { PostView, ThreadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: post and engagement flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };

  test("posts, replies and quotes come back as views that pass the contract", async () => {
    const ada = await h.established();
    const root = await post(ada.id, "first");
    expect(PostView.parse(root)).toMatchObject({ body: "first", replyTo: null, quoteOf: null, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: false, reposted: false, bookmarked: false } });
    expect(root.author).toEqual({ id: ada.id, handle: ada.handle, displayName: expect.any(String), verified: false });

    const reply = await post(ada.id, "second", { replyToId: root.id });
    expect(reply.replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    const quote = await post(ada.id, "third", { quoteOfId: root.id });
    expect(quote.quoteOf).toMatchObject({ id: root.id, body: "first", quoteOf: null });
    const quoteOfQuote = await post(ada.id, "fourth", { quoteOfId: quote.id });
    expect(quoteOfQuote.quoteOf).toMatchObject({ id: quote.id, quoteOf: null });
    expect(PostView.parse(quoteOfQuote).quoteOf).not.toHaveProperty("author.email");
    expect((await getPost(h.deps, null, root.id)).viewer).toBeUndefined();
    expect((await getPost(h.deps, ada.id, root.id)).counts).toEqual({ likes: 0, reposts: 0, replies: 1, quotes: 1 });
  });

  test("replying to or quoting a post you may not see is post_unavailable, and blocked when you blocked its author", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "target");
    await h.repo.deletePost(target.id, ada.id, h.clock.next());
    expect(await rejection(post(bob.id, "late", { replyToId: target.id }))).toBe("post_unavailable");

    const withheld = await post(ada.id, "withheld");
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld.id}::uuid`);
    expect(await rejection(post(bob.id, "reply", { quoteOfId: withheld.id }))).toBe("post_unavailable");
    expect(await rejection(post(ada.id, "own reply", { replyToId: withheld.id }))).toBeNull();

    const visible = await post(ada.id, "visible");
    await h.repo.block(ada.id, bob.id, h.clock.next());
    expect(await rejection(post(bob.id, "reply", { replyToId: visible.id }))).toBe("post_unavailable");
    await h.repo.block(carol.id, ada.id, h.clock.next());
    expect(await rejection(post(carol.id, "quote", { quoteOfId: visible.id }))).toBe("blocked");
  });

  test("write limits: a new account gets five posts an hour and no quotes before 48 hours", async () => {
    const [young, ada] = await Promise.all([h.fresh(), h.established()]);
    const target = await post(ada.id, "quotable");
    for (let i = 0; i < 5; i++) expect(await rejection(post(young.id, `post ${i}`))).toBeNull();
    expect(await rejection(post(young.id, "one too many"))).toBe("rate_limited");
    expect(await rejection(post(young.id, "reply still fine", { replyToId: target.id }))).toBeNull();
    expect(await rejection(post(young.id, "quote", { quoteOfId: target.id }))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "repost", true))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "like", true))).toBeNull();
  });

  test("deletion: author only, blanks the body, and leaves tombstones as ancestor and quote", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const reply = await post(bob.id, "reply", { replyToId: root.id });
    const quote = await post(bob.id, "quote", { quoteOfId: root.id });
    expect(await rejection(deletePost(h.deps, bob.id, root.id))).toBe("not_author");
    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(deletePost(h.deps, carol.id, root.id))).toBe("not_found");

    await deletePost(h.deps, ada.id, root.id);
    await deletePost(h.deps, ada.id, root.id);
    expect(await rejection(getPost(h.deps, ada.id, root.id))).toBe("not_found");
    const viewed = await thread(h.deps, null, reply.id, { limit: 20 });
    expect(viewed.ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await getPost(h.deps, null, quote.id)).quoteOf).toEqual({ id: root.id, deleted: true });
    const [row] = (await db.execute(sql`select body, state from posts where id = ${root.id}::uuid`)) as unknown as { body: string; state: string }[];
    expect(row).toEqual({ body: "", state: "deleted_by_author" });
  });

  test("threads: ancestors root first with unavailable tombstones, replies page oldest first", async () => {
    const [ada, bob, viewer] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const mid = await post(bob.id, "mid", { replyToId: root.id });
    const leaf = await post(ada.id, "leaf", { replyToId: mid.id });
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push(await post(bob.id, `r${i}`, { replyToId: leaf.id }));
    const hidden = await post(ada.id, "hidden reply", { replyToId: leaf.id });
    await db.execute(sql`update posts set state = 'removed' where id = ${hidden.id}::uuid`);

    const first = ThreadResponse.parse(await thread(h.deps, viewer.id, leaf.id, { limit: 2 }));
    expect(first.ancestors.map((a) => a.id)).toEqual([root.id, mid.id]);
    expect(first.replies.items.map((r) => r.body)).toEqual(["r0", "r1"]);
    expect(first.replies.nextCursor).not.toBeNull();
    const second = await thread(h.deps, viewer.id, leaf.id, { limit: 2, cursor: first.replies.nextCursor! });
    expect(second.replies.items.map((r) => r.body)).toEqual(["r2"]);
    expect(second.replies.nextCursor).toBeNull();

    await h.repo.block(bob.id, viewer.id, h.clock.next());
    const blockedView = await thread(h.deps, viewer.id, leaf.id, { limit: 20 });
    expect(blockedView.ancestors).toEqual([expect.objectContaining({ id: root.id, body: "root" }), { id: mid.id, unavailable: true }]);
    expect(blockedView.replies.items).toEqual([]);
    expect((await thread(h.deps, ada.id, leaf.id, { limit: 20 })).replies.items.map((r) => r.body)).toEqual(["r0", "r1", "r2", "hidden reply"]);
  });

  test("a reply names its parent's author only to viewers who could open the parent", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const reply = await post(carol.id, "reply", { replyToId: root.id });
    expect((await getPost(h.deps, bob.id, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    await h.repo.block(ada.id, bob.id, h.clock.next());
    expect((await getPost(h.deps, bob.id, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: null });
    expect((await getPost(h.deps, carol.id, reply.id)).replyTo?.authorHandle).toBe(ada.handle);
    await db.execute(sql`update posts set state = 'removed' where id = ${root.id}::uuid`);
    expect((await getPost(h.deps, null, reply.id)).replyTo).toEqual({ id: root.id, authorHandle: null });
    expect((await getPost(h.deps, ada.id, reply.id)).replyTo?.authorHandle).toBe(ada.handle);
  });

  test("a hidden post answers with its state before revealing a block, and an undo works across a block", async () => {
    const [ada, viewer] = await Promise.all([h.established(), h.established()]);
    const target = await post(ada.id, "engage");
    await setEngagement(h.deps, viewer.id, target.id, "bookmark", true);
    const withheld = await post(ada.id, "withheld");
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld.id}::uuid`);
    await h.repo.block(viewer.id, ada.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, viewer.id, withheld.id, "like", true))).toBe("not_found");
    expect(await rejection(setEngagement(h.deps, viewer.id, target.id, "like", true))).toBe("blocked");
    expect((await setEngagement(h.deps, viewer.id, target.id, "bookmark", false)).viewer.bookmarked).toBe(false);
  });

  test("likes, reposts and bookmarks are idempotent, honour blocks in both directions, and undo without limits", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "engage");
    expect(await setEngagement(h.deps, bob.id, target.id, "like", true)).toEqual({ counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: true, reposted: false, bookmarked: false } });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", true)).counts.likes).toBe(1);
    expect((await setEngagement(h.deps, bob.id, target.id, "bookmark", true)).counts).toEqual({ likes: 1, reposts: 0, replies: 0, quotes: 0 });
    expect((await setEngagement(h.deps, bob.id, target.id, "repost", true)).viewer).toEqual({ liked: true, reposted: true, bookmarked: true });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).counts.likes).toBe(0);
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).viewer.liked).toBe(false);

    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, carol.id, target.id, "like", true))).toBe("not_found");
    await h.repo.block(bob.id, ada.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, bob.id, target.id, "like", true))).toBe("blocked");
    expect((await setEngagement(h.deps, bob.id, target.id, "repost", false)).viewer.reposted).toBe(false);
  });
});
```

### Replace `apps/api/test/integration/social-flows-graph.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProfilePage, ProfileView, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "../../src/social/flows/graph";
import { createPost, getPost } from "../../src/social/flows/posts";
import { followers, following, profile } from "../../src/social/flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: graph, profile and timeline flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };
  const page = { limit: 20 };

  test("follow and unfollow keep counts, refuse yourself, and are directional across a block", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    expect(await setFollow(h.deps, ada.id, bob.handle, true)).toEqual({ following: true, followerCount: 1 });
    expect(await setFollow(h.deps, ada.id, `@${bob.handle.toUpperCase()}`, true)).toEqual({ following: true, followerCount: 1 });
    expect(await rejection(setFollow(h.deps, ada.id, ada.handle, true))).toBe("self_target");
    expect(await rejection(setFollow(h.deps, ada.id, "nobody_here_404", true))).toBe("not_found");

    const view = ProfileView.parse(await profile(h.deps, ada.id, bob.handle));
    expect(view.counts).toEqual({ posts: 0, followers: 1, following: 0 });
    expect(view.viewer).toEqual({ following: true, followedBy: false, blocked: false, muted: false });
    expect((await profile(h.deps, null, bob.handle)).viewer).toBeUndefined();
    expect((await profile(h.deps, bob.id, bob.handle)).viewer).toBeUndefined();

    await setBlock(h.deps, carol.id, ada.handle, true);
    expect(await rejection(setFollow(h.deps, ada.id, carol.handle, true))).toBe("not_found");
    expect(await rejection(setFollow(h.deps, carol.id, ada.handle, true))).toBe("blocked");
    expect(await setFollow(h.deps, ada.id, bob.handle, false)).toEqual({ following: false, followerCount: 0 });
  });

  test("blocking hides the profile both ways, removes follows, and unblocking restores visibility only", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, ada.id, bob.handle, true);
    await setFollow(h.deps, bob.id, ada.handle, true);
    expect(await setBlock(h.deps, ada.id, bob.handle, true)).toEqual({ blocked: true });
    expect(await rejection(profile(h.deps, ada.id, bob.handle))).toBe("not_found");
    expect(await rejection(profile(h.deps, bob.id, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, null, ada.handle)).counts.followers).toBe(0);
    expect((await blockedList(h.deps, ada.id, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect(await rejection(setBlock(h.deps, ada.id, ada.handle, true))).toBe("self_target");

    expect(await setBlock(h.deps, ada.id, bob.handle, false)).toEqual({ blocked: false });
    expect((await profile(h.deps, bob.id, ada.handle)).viewer).toEqual({ following: false, followedBy: false, blocked: false, muted: false });
    expect((await blockedList(h.deps, ada.id, page)).items).toEqual([]);
  });

  test("blocking retracts the pair's reposts and likes of each other's posts, both ways; a third account's stay", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const a1 = await post(ada.id, "by ada");
    const b1 = await post(bob.id, "by bob");
    for (const [who, target, kind] of [[bob, a1, "repost"], [bob, a1, "like"], [ada, b1, "like"], [carol, a1, "like"]] as const) {
      h.clock.next();
      await setEngagement(h.deps, who.id, target.id, kind, true);
    }
    await setBlock(h.deps, ada.id, bob.handle, true);
    expect((await getPost(h.deps, null, a1.id)).counts).toMatchObject({ reposts: 0, likes: 1 });
    expect((await getPost(h.deps, null, b1.id)).counts.likes).toBe(0);
    expect((await profilePosts(h.deps, carol.id, bob.handle, page)).items.map((i) => i.kind)).toEqual(["post"]);
    expect((await getPost(h.deps, carol.id, a1.id)).viewer?.liked).toBe(true);
  });

  test("block and mute towards an account that blocks you are not_found; your own mute or block can still be undone", async () => {
    const [viewer, carol] = await Promise.all([h.established(), h.established()]);
    await setMute(h.deps, viewer.id, carol.handle, true);
    await setBlock(h.deps, carol.id, viewer.handle, true);
    expect(await rejection(setBlock(h.deps, viewer.id, carol.handle, true))).toBe("not_found");
    expect(await rejection(setMute(h.deps, viewer.id, carol.handle, true))).toBe("not_found");
    expect(await setMute(h.deps, viewer.id, carol.handle, false)).toEqual({ muted: false });
    await setBlock(h.deps, carol.id, viewer.handle, false);
    await setBlock(h.deps, viewer.id, carol.handle, true);
    // The rule cuts both ways: once the viewer blocks carol, carol's block towards the viewer is not_found too.
    expect(await rejection(setBlock(h.deps, carol.id, viewer.handle, true))).toBe("not_found");
    expect(await setBlock(h.deps, viewer.id, carol.handle, false)).toEqual({ blocked: false });
  });

  test("a follow cannot land across a concurrent block", async () => {
    for (let i = 0; i < 8; i++) {
      const [ada, bob] = await Promise.all([h.established(), h.established()]);
      const [followed, blocked] = await Promise.allSettled([setFollow(h.deps, bob.id, ada.handle, true), setBlock(h.deps, ada.id, bob.handle, true)]);
      expect(blocked.status).toBe("fulfilled");
      expect(followed.status === "fulfilled" || (followed.reason as { code: string }).code === "not_found").toBe(true);
      expect((await h.repo.relation(bob.id, ada.id)).following).toBe(false);
      expect((await h.repo.findProfiles([ada.id])).get(ada.id)!.followerCount).toBe(0);
    }
  });

  test("mutes are silent, listed for their owner, and hide timelines only", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const a1 = await post(ada.id, "muted soon");
    expect(await setMute(h.deps, viewer.id, ada.handle, true)).toEqual({ muted: true });
    expect((await profile(h.deps, viewer.id, ada.handle)).viewer?.muted).toBe(true);
    expect((await profile(h.deps, ada.id, viewer.handle)).viewer).toEqual({ following: false, followedBy: true, blocked: false, muted: false });
    expect((await mutedList(h.deps, viewer.id, page)).items.map((i) => i.id)).toEqual([ada.id]);
    expect((await followingTimeline(h.deps, viewer.id, page)).items).toEqual([]);
    expect((await profilePosts(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
    expect(await setMute(h.deps, viewer.id, ada.handle, false)).toEqual({ muted: false });
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("follower and following lists need a viewer, mark who the viewer follows, and hide blocked accounts", async () => {
    const [viewer, ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established(), h.established()]);
    await setFollow(h.deps, bob.id, ada.handle, true);
    await setFollow(h.deps, carol.id, ada.handle, true);
    await setFollow(h.deps, viewer.id, bob.handle, true);
    const list = ProfilePage.parse(await followers(h.deps, viewer.id, ada.handle, page));
    expect(list.items.map((i) => [i.handle, i.viewerFollows])).toEqual([
      [carol.handle, false],
      [bob.handle, true],
    ]);
    expect((await following(h.deps, viewer.id, bob.handle, page)).items.map((i) => i.handle)).toEqual([ada.handle]);

    await setBlock(h.deps, carol.id, viewer.handle, true);
    expect((await followers(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    // The blocked account is left out before the page is cut, so a page of one is bob, not an empty page with a cursor.
    expect((await followers(h.deps, viewer.id, ada.handle, { limit: 1 })).items.map((i) => i.handle)).toEqual([bob.handle]);
    const one = await followers(h.deps, ada.id, ada.handle, { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).not.toBeNull();
    expect((await followers(h.deps, ada.id, ada.handle, { limit: 1, cursor: one.nextCursor! })).items.map((i) => i.handle)).toEqual([bob.handle]);
  });

  test("timelines: following carries reposts with the reposter, latest is public, profiles split posts and replies", async () => {
    const [viewer, ada, bob] = await Promise.all([h.established(), h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const b1 = await post(bob.id, "from bob");
    const a1 = await post(ada.id, "from ada");
    await post(ada.id, "a reply", { replyToId: b1.id });
    h.clock.next();
    await setEngagement(h.deps, ada.id, b1.id, "repost", true);

    const feed = TimelinePage.parse(await followingTimeline(h.deps, viewer.id, page));
    expect(feed.items.map((i) => (i.kind === "repost" ? ["repost", i.post.id, i.repostedBy.handle] : ["post", i.post.id]))).toEqual([
      ["repost", b1.id, ada.handle],
      ["post", a1.id],
    ]);
    expect(feed.items[0]!.post.viewer).toEqual({ liked: false, reposted: false, bookmarked: false });

    const latest = TimelinePage.parse(await latestTimeline(h.deps, null, { limit: 50 }));
    expect(latest.items.map((i) => i.post.id)).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect(latest.items.every((i) => i.kind === "post" && i.post.viewer === undefined)).toBe(true);

    expect((await profilePosts(h.deps, null, ada.handle, page)).items.map((i) => i.kind)).toEqual(["repost", "post"]);
    expect((await profileReplies(h.deps, null, ada.handle, page)).items.map((i) => i.body)).toEqual(["a reply"]);
    await setBlock(h.deps, bob.id, viewer.handle, true);
    expect(await rejection(profilePosts(h.deps, viewer.id, bob.handle, page))).toBe("not_found");
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("likes and bookmarks are private pages, newest first, with cursors", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    const posts = [];
    for (let i = 0; i < 3; i++) posts.push(await post(ada.id, `p${i}`));
    for (const p of posts) {
      h.clock.next();
      await setEngagement(h.deps, viewer.id, p.id, "like", true);
    }
    h.clock.next();
    await setEngagement(h.deps, viewer.id, posts[1]!.id, "bookmark", true);
    const first = await likedPosts(h.deps, viewer.id, { limit: 2 });
    expect(first.items.map((p) => p.body)).toEqual(["p2", "p1"]);
    const second = await likedPosts(h.deps, viewer.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((p) => p.body)).toEqual(["p0"]);
    expect(second.nextCursor).toBeNull();
    expect((await bookmarkedPosts(h.deps, viewer.id, page)).items.map((p) => p.body)).toEqual(["p1"]);
    expect(await rejection(likedPosts(h.deps, viewer.id, { limit: 2, cursor: "not-a-cursor" }))).toBe("invalid_request");
  });
});
```

### Replace `apps/api/test/integration/social-repo.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type ListRow, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile, ticker } from "./social-fixtures";

const ids = (rowsList: ListRow[]) => rowsList.map((r) => r.postId);

describe.skipIf(!process.env.INTEGRATION)("integration: social repository", () => {
  let db: Db;
  let repo: SocialRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("counters stay exact when actions repeat and undo", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, ada.id, clock.next());

    expect(await repo.like(bob.id, post, clock.next())).toBe(true);
    expect(await repo.like(bob.id, post, clock.next())).toBe(false);
    expect(await repo.repost(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(false);
    let row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([1, 1]);
    expect(await repo.viewerPostStates(bob.id, [post])).toEqual(new Map([[post, { liked: true, reposted: true, bookmarked: true }]]));

    expect(await repo.unlike(bob.id, post)).toBe(true);
    expect(await repo.unlike(bob.id, post)).toBe(false);
    expect(await repo.unrepost(bob.id, post)).toBe(true);
    expect(await repo.unbookmark(bob.id, post)).toBe(true);
    row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([0, 0]);
    expect((await repo.viewerPostStates(bob.id, [post])).get(post)).toEqual({ liked: false, reposted: false, bookmarked: false });
  });

  test("replies and quotes count on their target, top-level posts on the author", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: root });
    await newPost(repo, ada.id, clock.next(), "quote", { quoteOfId: root });
    const rootRow = (await repo.findPosts([root])).get(root)!;
    expect([rootRow.replyCount, rootRow.quoteCount]).toEqual([1, 1]);
    expect((await repo.findProfiles([ada.id])).get(ada.id)!.postCount).toBe(2);
    expect((await repo.findPosts([reply])).get(reply)!.replyToHandle).toBe(ada.handle);

    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(true);
    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(false);
    expect((await repo.findPosts([root])).get(root)!.replyCount).toBe(0);
    const deleted = (await repo.findPosts([reply])).get(reply)!;
    expect(deleted.state).toBe("deleted_by_author");
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();
  });

  test("blocking removes follows in both directions in one transaction and keeps counts exact", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.follow(bob.id, ada.id, clock.next())).toBe(true);
    let profilesById = await repo.findProfiles([ada.id, bob.id]);
    expect([profilesById.get(ada.id)!.followerCount, profilesById.get(ada.id)!.followingCount]).toEqual([1, 1]);

    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.relation(ada.id, bob.id)).toEqual({ following: false, followedBy: false, blocked: true, blockedBy: false, muted: false });
    expect(await repo.relation(bob.id, ada.id)).toEqual({ following: false, followedBy: false, blocked: false, blockedBy: true, muted: false });
    profilesById = await repo.findProfiles([ada.id, bob.id]);
    for (const p of profilesById.values()) expect([p.followerCount, p.followingCount]).toEqual([0, 0]);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set([ada.id]));
    expect(await repo.unblock(ada.id, bob.id)).toBe(true);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set());
  });

  test("the following timeline pages stably across posts and reposts, and a post reposted twice appears twice", async () => {
    const clock = ticker();
    const [viewer, ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const own = await newPost(repo, viewer.id, clock.next());
    const c1 = await newPost(repo, carol.id, clock.next()); // not followed: appears only through reposts
    await newPost(repo, ada.id, clock.next(), "a reply", { replyToId: a1 });
    await repo.repost(ada.id, c1, clock.next());
    await repo.repost(bob.id, c1, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());

    const all = await repo.followingTimeline(viewer.id, undefined, 10);
    expect(all.map((r) => [r.postId, r.reposterId])).toEqual([
      [b1, null],
      [c1, bob.id],
      [c1, ada.id],
      [own, null],
      [a1, null],
    ]);

    const seen: [string, string | null][] = [];
    let cursor: { t: number; id: string; r?: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rowsPage = await repo.followingTimeline(viewer.id, cursor, 2);
      if (rowsPage.length === 0) break;
      seen.push(...rowsPage.map((r): [string, string | null] => [r.postId, r.reposterId]));
      const last = rowsPage[rowsPage.length - 1]!;
      cursor = { t: last.sortAt.getTime(), id: last.postId, ...(last.reposterId ? { r: last.reposterId } : {}) };
    }
    expect(seen).toEqual(all.map((r) => [r.postId, r.reposterId]));
  });

  test("blocks hide an author in both directions; mutes hide timelines only", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: b1 });

    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);

    await repo.mute(viewer.id, ada.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);
    expect(ids(await repo.profilePosts(ada.id, viewer.id, undefined, 10))).toEqual([a1]);
    await repo.unmute(viewer.id, ada.id);

    // ada blocks the viewer: the viewer no longer sees ada anywhere, and ada no longer sees the viewer.
    await repo.block(ada.id, viewer.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    const v1 = await newPost(repo, viewer.id, clock.next());
    expect(ids(await repo.latestTimeline(ada.id, undefined, 200))).not.toContain(v1);
    expect(ids(await repo.latestTimeline(null, undefined, 200))).toEqual(expect.arrayContaining([a1, v1]));
  });

  test("withheld and removed posts appear only to their author; replies never enter timelines", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    const shown = await newPost(repo, ada.id, clock.next());
    const withheld = await newPost(repo, ada.id, clock.next());
    const removed = await newPost(repo, ada.id, clock.next());
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld}::uuid`);
    await db.execute(sql`update posts set state = 'removed' where id = ${removed}::uuid`);
    await newPost(repo, ada.id, clock.next(), "reply", { replyToId: shown });

    expect(ids(await repo.profilePosts(ada.id, ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.profilePosts(ada.id, bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.profilePosts(ada.id, null, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.latestTimeline(null, undefined, 500))).not.toContain(withheld);
  });

  test("threads: ancestors come root first and stop at the cap, replies page oldest first", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next(), "root");
    let parent = root;
    const chain = [root];
    for (let depth = 1; depth <= 55; depth++) {
      parent = await newPost(repo, ada.id, clock.next(), `level ${depth}`, { replyToId: parent });
      chain.push(parent);
    }
    const leaf = chain[chain.length - 1]!;
    const ancestors = await repo.ancestorIds(leaf);
    expect(ancestors).toHaveLength(50);
    expect(ancestors).toEqual(chain.slice(-51, -1));
    expect(await repo.ancestorIds(chain[3]!)).toEqual(chain.slice(0, 3));

    const replies = await Promise.all([1, 2, 3].map((n) => newPost(repo, ada.id, clock.next(), `r${n}`, { replyToId: root })));
    const first = await repo.replies(root, null, undefined, 2);
    expect(ids(first)).toEqual([chain[1], replies[0]]);
    const last = first[first.length - 1]!;
    const second = await repo.replies(root, null, { t: last.sortAt.getTime(), id: last.postId }, 2);
    expect(ids(second)).toEqual([replies[1], replies[2]]);
  });

  test("likes and bookmarks list newest first and drop posts the viewer may no longer see", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    await repo.like(viewer.id, a1, clock.next());
    await repo.like(viewer.id, b1, clock.next());
    await repo.bookmark(viewer.id, a1, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.block(bob.id, viewer.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.deletePost(a1, ada.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([]);
  });

  test("follower and blocked lists page newest first, and profile lookups are case-insensitive", async () => {
    const clock = ticker();
    const [ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    await repo.follow(carol.id, ada.id, clock.next());
    const firstPage = await repo.followers(ada.id, null, undefined, 1);
    expect(firstPage.map((r) => r.profileId)).toEqual([carol.id]);
    const secondPage = await repo.followers(ada.id, null, { t: firstPage[0]!.sortAt.getTime(), id: firstPage[0]!.profileId }, 1);
    expect(secondPage.map((r) => r.profileId)).toEqual([bob.id]);
    expect((await repo.following(bob.id, null, undefined, 10)).map((r) => r.profileId)).toEqual([ada.id]);
    expect(await repo.followedBy(bob.id, [ada.id, carol.id])).toEqual(new Set([ada.id]));

    await repo.block(ada.id, carol.id, clock.next());
    await repo.mute(ada.id, bob.id, clock.next());
    expect((await repo.blockedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([carol.id]);
    expect((await repo.mutedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([bob.id]);

    const found = await repo.findProfileByHandle(ada.handle.toUpperCase());
    expect(found?.id).toBe(ada.id);
    expect([found?.followerCount, found?.followingCount, found?.postCount]).toEqual([1, 0, 0]);
    expect(await repo.findProfileByHandle("no_such_handle_here")).toBeNull();
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/contracts test; pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/social.test.ts (17 tests | 4 failed) 34ms
Test Files  1 failed | 3 passed (4)
Tests  4 failed | 44 passed (48)
❯ test/middleware.test.ts (12 tests | 1 failed) 110ms
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/06-social-fixes.md 3
```

Expected: 18 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/text.ts`

```ts
/**
 * Bidirectional overrides and isolates, the zero-width space, the word joiner and the byte order mark:
 * invisible, and used to disguise text or hide from a search. Joiners that scripts and emoji need
 * (U+200C, U+200D) stay allowed.
 */
export const FORBIDDEN_FORMAT = /[\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF]/u;

/** The characters a reader can see: format characters (joiners, direction marks) do not count. */
export function visibleLength(text: string): number {
  return Array.from(text.replace(/\p{Cf}/gu, "")).length;
}
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, bookmarks, follows, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { SocialError } from "./context";
import type { Cursor } from "./cursor";
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
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

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
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at from profiles`;

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

    /** `other` is the post's author when that is someone else: the pair is locked and a block refused inside the transaction. */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
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
      const inserted = await db.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
      return inserted.length > 0;
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

    /** With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a concurrent block. */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
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
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
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
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
      return inserted.length > 0;
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
 * become tombstones, and tombstones carry no images.
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
    out.set(id, a === "shown" ? { ...base(row), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
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

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Opaque to clients; anything that is not a cursor this module produced is `invalid_request`. */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  const result = Cursor.safeParse(parsed);
  if (!result.success) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  return result.data;
}
```

### Replace `apps/api/src/social/context.ts` (whole file)

```ts
import type { SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialRepo } from "./repo";

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type SocialErrorStatus = 400 | 403 | 404 | 429 | 503;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited and service_unavailable so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export function socialErrorMessage(code: SocialErrorKind): string {
  return MESSAGES[code];
}

/** The account making a request, or null when signed out. Reads accept null; writes never do. */
export type ViewerId = string | null;

/** Posts without images: what the module runs with when no media module is wired, as in the 2a tests. */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
};

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/social/limits.ts` (whole file)

```ts
import type { RateLimitStore } from "../middleware/rate-limit";
import { SocialError } from "./context";
import { limitsFor, mayRepostOrQuote, type WriteAction } from "./tiers";

/**
 * Counts one write for the account and refuses it once a window is full. Reposts and quotes are
 * refused outright while the account is too young. Undo actions never call this.
 */
export async function enforceWriteLimit(
  store: RateLimitStore,
  userId: string,
  action: WriteAction,
  accountCreatedAt: Date,
  now: Date,
): Promise<void> {
  const accountAgeMs = now.getTime() - accountCreatedAt.getTime();
  if ((action === "repost" || action === "quote") && !mayRepostOrQuote(accountAgeMs)) {
    throw new SocialError("account_too_new", 403);
  }
  for (const limit of limitsFor(action, accountAgeMs)) {
    let hit: { count: number; resetMs: number };
    try {
      hit = await store.hit(`social:${limit.bucket}:${userId}`, limit.windowMs);
    } catch {
      // Fails closed: a write that cannot be counted is not made, and the client is told to retry shortly.
      throw new SocialError("service_unavailable", 503, undefined, 30);
    }
    const { count, resetMs } = hit;
    if (count > limit.max) {
      throw new SocialError("rate_limited", 429, undefined, Math.max(1, Math.ceil(resetMs / 1000)));
    }
  }
}
```

### Replace `apps/api/src/social/tiers.ts` (whole file)

```ts
/**
 * Write limits by account age (2a spec, section 6). Sub-project 3 replaces the age check with
 * reputation without changing the buckets or the enforcement.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Accounts younger than this get the low tier. */
export const NEW_ACCOUNT_MS = 24 * HOUR_MS;
/** Reposting and quoting need an account at least this old. */
export const REPOST_MIN_AGE_MS = 48 * HOUR_MS;

export type WriteAction = "post" | "reply" | "quote" | "repost" | "like" | "bookmark" | "follow" | "block" | "mute" | "upload";

export interface WriteLimit {
  /** Counter name; several actions may share one (quotes count as posts). */
  bucket: string;
  max: number;
  windowMs: number;
}

export const isNewAccount = (accountAgeMs: number): boolean => accountAgeMs < NEW_ACCOUNT_MS;
export const mayRepostOrQuote = (accountAgeMs: number): boolean => accountAgeMs >= REPOST_MIN_AGE_MS;

/** Every window an action must stay within. Follows have an hourly and a daily one. */
export function limitsFor(action: WriteAction, accountAgeMs: number): WriteLimit[] {
  const fresh = isNewAccount(accountAgeMs);
  switch (action) {
    case "post":
    case "quote":
      return [{ bucket: "post", max: fresh ? 5 : 30, windowMs: HOUR_MS }];
    case "reply":
      return [{ bucket: "reply", max: fresh ? 20 : 60, windowMs: HOUR_MS }];
    case "repost":
      return [{ bucket: "repost", max: 30, windowMs: HOUR_MS }];
    case "like":
      return [{ bucket: "like", max: 100, windowMs: HOUR_MS }];
    case "bookmark":
      return [{ bucket: "bookmark", max: 100, windowMs: HOUR_MS }];
    case "follow":
      return [
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ];
    case "block":
      return [{ bucket: "block", max: 30, windowMs: HOUR_MS }];
    case "mute":
      return [{ bucket: "mute", max: 30, windowMs: HOUR_MS }];
    // Image uploads (2b). The media module counts them through this table, so every per-account limit lives here.
    case "upload":
      return [
        { bucket: "upload", max: fresh ? 20 : 120, windowMs: HOUR_MS },
        { bucket: "upload-day", max: fresh ? 60 : 500, windowMs: DAY_MS },
      ];
  }
}
```

### Replace `apps/api/src/social/flows/posts.ts` (whole file)

```ts
import type { CreatePostRequest, Pagination, PostView, ThreadResponse } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { PostRow, ProfileRow } from "../repo";
import { isTombstone, loadPostViews, pageCursor, postView, postViews } from "../views";
import { postAccess } from "../visibility";

/** The viewer's own profile row; the tiers need its creation time. */
export async function ownProfile(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const profile = (await deps.repo.findProfiles([viewer])).get(viewer);
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/**
 * A post the viewer wants to act on. The post's own state is judged first, so someone probing ids
 * learns nothing about hidden or deleted posts from a block. Then the refusal is directional: when
 * the viewer blocked the author it is `blocked`; when the author blocked the viewer it is
 * `hiddenCode`, which reveals nothing.
 */
export async function targetPost(deps: SocialDeps, viewer: string, id: string, hiddenCode: "not_found" | "post_unavailable" = "not_found"): Promise<PostRow> {
  const hidden = () => new SocialError(hiddenCode, hiddenCode === "not_found" ? 404 : 400);
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw hidden();
  if (postAccess(viewer, row, false) !== "shown") throw hidden();
  if (row.authorId !== viewer) {
    const relation = await deps.repo.relation(viewer, row.authorId);
    if (relation.blocked) throw new SocialError("blocked", 403);
    if (relation.blockedBy) throw hidden();
  }
  return row;
}

export async function createPost(deps: SocialDeps, viewer: string, input: CreatePostRequest): Promise<PostView> {
  const me = await ownProfile(deps, viewer);
  const action = input.replyToId ? "reply" : input.quoteOfId ? "quote" : "post";
  const targetId = input.replyToId ?? input.quoteOfId;
  const target = targetId ? await targetPost(deps, viewer, targetId, "post_unavailable") : null;
  await enforceWriteLimit(deps.limits, viewer, action, me.createdAt, deps.now());
  const id = await deps.repo.createPost({
    authorId: viewer,
    body: input.body,
    replyToId: input.replyToId ?? null,
    quoteOfId: input.quoteOfId ?? null,
    now: deps.now(),
    lockWith: target && target.authorId !== viewer ? target.authorId : null,
    within: (tx, postId) => deps.media.attach(tx, { postId, ownerId: viewer, items: input.media }),
  });
  return (await postView(deps, viewer, id))!;
}

export async function getPost(deps: SocialDeps, viewer: ViewerId, id: string): Promise<PostView> {
  const view = await postView(deps, viewer, id);
  if (!view) throw new SocialError("not_found", 404);
  return view;
}

/** Author only. Deleting twice is a no-op. Someone who may not see the post learns nothing. */
export async function deletePost(deps: SocialDeps, viewer: string, id: string): Promise<void> {
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw new SocialError("not_found", 404);
  if (row.authorId === viewer) {
    // The image rows go with the post, in its transaction. Their files are deleted after the commit: files cannot be rolled back.
    let images: string[] = [];
    await deps.repo.deletePost(id, viewer, deps.now(), async (tx) => {
      images = await deps.media.detachAll(tx, id);
    });
    await deps.media.requestDeletion(images);
    return;
  }
  const blocked = (await deps.repo.blockedEitherWay(viewer, [row.authorId])).has(row.authorId);
  if (postAccess(viewer, row, blocked) !== "shown") throw new SocialError("not_found", 404);
  throw new SocialError("not_author", 403);
}

/** The post, its ancestors root first (tombstones where needed), and a page of direct replies oldest first. */
export async function thread(deps: SocialDeps, viewer: ViewerId, id: string, query: Pagination): Promise<ThreadResponse> {
  const post = await getPost(deps, viewer, id);
  const ancestorIds = await deps.repo.ancestorIds(id);
  const loaded = await loadPostViews(deps, viewer, ancestorIds);
  const ancestors = ancestorIds.map((ancestorId) => loaded.get(ancestorId)!);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await deps.repo.replies(id, viewer, cursor, query.limit);
  const items = await postViews(deps, viewer, rows);
  return { ancestors: ancestors.map((a) => (isTombstone(a) ? a : a)), post, replies: { items, nextCursor: pageCursor(rows, query.limit) } };
}
```

### Replace `apps/api/src/social/flows/engagement.ts` (whole file)

```ts
import type { EngagementResponse } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { enforceWriteLimit } from "../limits";
import { ownProfile, targetPost } from "./posts";

export type EngagementKind = "like" | "repost" | "bookmark";

/**
 * Likes, reposts and bookmarks and their undos. Doing an action twice, or undoing one that was not
 * done, changes nothing and returns the current state. Only the action itself is rate limited, and
 * only the action consults the block relation: an undo removes the viewer's own row, whatever
 * stands between the accounts by then.
 */
export async function setEngagement(deps: SocialDeps, viewer: string, postId: string, kind: EngagementKind, on: boolean): Promise<EngagementResponse> {
  if (on) {
    const target = await targetPost(deps, viewer, postId);
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, kind, me.createdAt, deps.now());
    const other = target.authorId === viewer ? undefined : target.authorId;
    if (kind === "like") await deps.repo.like(viewer, postId, deps.now(), other);
    else if (kind === "repost") await deps.repo.repost(viewer, postId, deps.now(), other);
    else await deps.repo.bookmark(viewer, postId, deps.now());
  } else if (kind === "like") await deps.repo.unlike(viewer, postId);
  else if (kind === "repost") await deps.repo.unrepost(viewer, postId);
  else await deps.repo.unbookmark(viewer, postId);

  const row = (await deps.repo.findPosts([postId])).get(postId);
  if (!row) throw new SocialError("not_found", 404);
  const state = (await deps.repo.viewerPostStates(viewer, [postId])).get(postId)!;
  return { counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount }, viewer: state };
}
```

### Replace `apps/api/src/social/flows/graph.ts` (whole file)

```ts
import type { BlockResponse, FollowResponse, MuteResponse, Pagination, ProfileListItem, ProfilePage } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { ProfileRow, Relation } from "../repo";
import { authorOf, pageCursor } from "../views";
import { ownProfile } from "./posts";
import { lookupProfile } from "./profiles";

/**
 * The account a graph action targets. Never yourself. For an action, an account that blocks the
 * viewer is `not_found`, like every other read or write towards it; undoing the viewer's own block
 * or mute needs no such answer, since the viewer is looking at their own list.
 */
async function target(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<{ profile: ProfileRow; relation: Relation }> {
  const profile = await lookupProfile(deps, handle);
  if (profile.id === viewer) throw new SocialError("self_target", 400);
  const relation = await deps.repo.relation(viewer, profile.id);
  if (on && relation.blockedBy) throw new SocialError("not_found", 404);
  return { profile, relation };
}

/**
 * Follow or unfollow. Following someone you block is `blocked`; someone who blocks you is
 * `not_found`, like every other read or write towards them. Only the follow itself is limited.
 */
export async function setFollow(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<FollowResponse> {
  const { profile, relation } = await target(deps, viewer, handle, on);
  if (relation.blocked) throw new SocialError("blocked", 403);
  if (relation.blockedBy) throw new SocialError("not_found", 404);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "follow", me.createdAt, deps.now());
    await deps.repo.follow(viewer, profile.id, deps.now(), true);
  } else {
    await deps.repo.unfollow(viewer, profile.id);
  }
  const fresh = (await deps.repo.findProfiles([profile.id])).get(profile.id)!;
  return { following: on, followerCount: fresh.followerCount };
}

/** Block or unblock. Blocking removes follows, reposts and likes in both directions; unblocking restores nothing. */
export async function setBlock(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<BlockResponse> {
  const { profile } = await target(deps, viewer, handle, on);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "block", me.createdAt, deps.now());
    await deps.repo.block(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unblock(viewer, profile.id);
  }
  return { blocked: on };
}

/** Mute or unmute. Silent: the muted account is never told and nothing else changes. */
export async function setMute(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<MuteResponse> {
  const { profile } = await target(deps, viewer, handle, on);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "mute", me.createdAt, deps.now());
    await deps.repo.mute(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unmute(viewer, profile.id);
  }
  return { muted: on };
}

async function ownList(deps: SocialDeps, viewer: string, rows: { profileId: string; sortAt: Date }[], limit: number): Promise<ProfilePage> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (row) items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return { items, nextCursor: pageCursor(rows, limit) };
}

/** The viewer's own blocked accounts, newest block first. This is where unblocking starts. */
export async function blockedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.blockedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}

export async function mutedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.mutedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}
```

### Replace `apps/api/src/social/flows/profiles.ts` (whole file)

```ts
import type { Pagination, ProfileListItem, ProfilePage, ProfileView } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import type { ProfileListRow, ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";

/** A profile by handle (a leading @ is tolerated), or not_found. Does not consider the viewer. */
export async function lookupProfile(deps: SocialDeps, handle: string): Promise<ProfileRow> {
  const profile = await deps.repo.findProfileByHandle(handle.replace(/^@/, ""));
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/** A profile the viewer may see: a block in either direction makes it not_found. */
export async function visibleProfile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (viewer && viewer !== profile.id && (await deps.repo.blockedEitherWay(viewer, [profile.id])).size > 0) {
    throw new SocialError("not_found", 404);
  }
  return profile;
}

export async function profile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileView> {
  const target = await visibleProfile(deps, viewer, handle);
  const view: ProfileView = {
    id: target.id,
    handle: target.handle,
    displayName: target.displayName,
    bio: target.bio,
    verified: target.verified,
    createdAt: target.createdAt.toISOString(),
    counts: { posts: target.postCount, followers: target.followerCount, following: target.followingCount },
  };
  if (viewer && viewer !== target.id) {
    const relation = await deps.repo.relation(viewer, target.id);
    view.viewer = { following: relation.following, followedBy: relation.followedBy, blocked: relation.blocked, muted: relation.muted };
  }
  return view;
}

/**
 * Turns list rows into profile items for a signed-in viewer, dropping accounts with a block in
 * either direction and marking which ones the viewer follows.
 */
export async function profileItems(deps: SocialDeps, viewer: string, rows: ProfileListRow[]): Promise<ProfileListItem[]> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, blocked, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.blockedEitherWay(viewer, ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (!row || blocked.has(id)) continue;
    items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return items;
}

export async function followers(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.followers(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

export async function following(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.following(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
```

### Replace `apps/api/src/middleware/rate-limit.ts` (whole file)

```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type Redis from "ioredis";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count plus ms until the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.resetAt - t };
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {c, ttl}
`;

type RedisWithHit = Redis & { korbatRateHit(key: string, windowMs: number): Promise<[number, number]> };

export class RedisStore implements RateLimitStore {
  private readonly redis: RedisWithHit;
  constructor(redis: Redis) {
    redis.defineCommand("korbatRateHit", { numberOfKeys: 1, lua: LUA });
    this.redis = redis as RedisWithHit;
  }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = await this.redis.korbatRateHit(`rl:${key}`, windowMs);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
}

export interface RateLimitOptions {
  name: string;
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  key: (c: Context<AppEnv>) => string;
}

let outageLoggedAt = 0;

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let hit: { count: number; resetMs: number };
    try {
      hit = await opts.store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    } catch (err) {
      // Fails closed, and says so once a minute rather than once per request.
      if (Date.now() - outageLoggedAt > 60_000) {
        outageLoggedAt = Date.now();
        c.get("log").error({ err, limiter: opts.name }, "rate limit store unavailable; refusing requests");
      }
      c.header("Retry-After", "30");
      return c.json(errorBody("service_unavailable", "Requests cannot be counted right now. Try again shortly.", c.get("requestId")), 503);
    }
    const { count, resetMs } = hit;
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    c.header("RateLimit-Reset", String(resetSec));
    if (count > opts.limit) {
      c.header("Retry-After", String(resetSec));
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId")), 429);
    }
    await next();
  });
}

/** The client address the auth module's clientIdentity middleware resolved; "direct" before it ran. */
export function clientIp(c: Context<AppEnv>): string {
  return c.get("clientIp") ?? "direct";
}

/** The keyed hash of that address, shortened: the only form a rate-limit key may hold. */
export function clientIpKey(c: Context<AppEnv>): string {
  return (c.get("clientIpHash") ?? "direct").slice(0, 24);
}
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { FORBIDDEN_FORMAT, visibleLength } from "./text";

/** Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
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

export const PostView = z.object({ ...postFields, quoteOf: z.union([QuotedPost, Tombstone]).nullable() });
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
```

### Replace `packages/contracts/src/media.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

/** Why processing an upload failed. Reported on the status response, not as an HTTP error. */
export const MediaFailure = z.enum(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
export type MediaFailure = z.infer<typeof MediaFailure>;

/** 20 MiB. The API counts bytes while it streams an upload to disk and stops here. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PER_POST = 4;
/** The types an upload may declare. The bytes decide; the declaration is checked and then forgotten. */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export type MediaAcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];
export const ALT_MAX_LENGTH = 1000;

/** A media id in its canonical lowercase form, which is also how it names files on the media volumes. */
export const MediaId = z.uuid().transform((id) => id.toLowerCase());

export const MEDIA_SIZES = ["small", "large"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

/** Where an image file is served. Views carry these paths, so the server can move images without a client change. */
export function mediaPath(id: string, size: MediaSize): string {
  return `/api/media/${id}/${size}.webp`;
}

/** Length in code points, which is what Postgres char_length counts. */
export function altLength(alt: string): number {
  return Array.from(alt).length;
}

/** Unicode NFC, every run of whitespace (line breaks included) to one space, trimmed. The server and the composer use the same rule. */
export function normalizeAltText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const CONTROL = /\p{Cc}/u;

/** An image description as stored: normalized, 1 to 1000 code points, no control characters. */
export const AltText = z
  .string()
  .max(4000)
  .transform(normalizeAltText)
  .refine((alt) => !CONTROL.test(alt), { message: "control characters are not allowed" })
  .refine((alt) => !FORBIDDEN_FORMAT.test(alt), { message: "invisible direction and spacing characters are not allowed" })
  .refine((alt) => altLength(alt) >= 1, { message: "every image needs a description" })
  .refine((alt) => altLength(alt) <= ALT_MAX_LENGTH, { message: `descriptions have at most ${ALT_MAX_LENGTH} characters` });

/** One image of a new post: an upload that is ready, and its description. */
export const MediaAttachment = z.object({ id: MediaId, alt: AltText });
export type MediaAttachment = z.infer<typeof MediaAttachment>;

export const UploadResponse = z.object({ id: MediaId, status: z.literal("processing") });
export type UploadResponse = z.infer<typeof UploadResponse>;

/** The state of one upload, for its owner. Width and height are those of the large size, after rotation. */
export const MediaStatusResponse = z.discriminatedUnion("status", [
  z.object({ id: MediaId, status: z.literal("processing") }),
  z.object({ id: MediaId, status: z.literal("ready"), width: z.number().int().positive(), height: z.number().int().positive(), blurhash: z.string().min(6) }),
  z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
]);
export type MediaStatusResponse = z.infer<typeof MediaStatusResponse>;

/** An image on a post, as every reader gets it. */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
});
export type MediaView = z.infer<typeof MediaView>;
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

export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
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

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
  profile: Profile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;
```

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./auth";
export * from "./media";
export * from "./social";
export * from "./text";
```

### Replace `packages/db/src/schema/content.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

/** A counter kept exact by the application: updated in the same transaction as the action it counts. */
const counter = (name: string) => integer(name).notNull().default(0);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    likeCount: counter("like_count"),
    repostCount: counter("repost_count"),
    /** Replies that are not deleted. */
    replyCount: counter("reply_count"),
    /** Quotes that are not deleted. */
    quoteCount: counter("quote_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Set together with state = 'deleted_by_author'; the body is blanked at the same time. */
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    /** A thread's replies in order, and every lookup by parent. */
    index("posts_reply_to_created_idx").on(t.replyToId, t.createdAt, t.id),
    /** The public Latest timeline: visible top-level posts and quotes, newest first. */
    index("posts_latest_idx").on(t.createdAt, t.id).where(sql`reply_to_id is null and state = 'visible'`),
    index("posts_quote_of_idx").on(t.quoteOfId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

/** An upload is processing until the worker's result is in, then ready or failed for good. */
export const mediaStatus = pgEnum("media_status", ["processing", "ready", "failed"]);

/**
 * One uploaded image. The files live on the media-store volume under the row's id; no path is
 * stored. Only the API's media module reads or writes this table.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who uploaded it. Only this account may attach it to a post. */
    ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: mediaStatus("status").notNull().default("processing"),
    /** Why processing failed: one of the contracts' MediaFailure values. */
    error: text("error"),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    /** Filled by sub-project 3. Empty until then. */
    nsfwScore: real("nsfw_score"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    fullAccess("post_media_api_all", apiRole),
  ],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      /** Pages of either side, newest first, and every lookup by either side. */
      index(`${name}_to_created_idx`).on(t.toId, t.createdAt, t.fromId),
      index(`${name}_from_created_idx`).on(t.fromId, t.createdAt, t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/** user -> post relation table (likes, reposts, bookmarks). */
function userPostTable(name: string) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.postId] }),
      index(`${name}_post_idx`).on(t.postId),
      /** Per-account lists (your likes, your bookmarks) and the reposts half of the Following timeline. */
      index(`${name}_user_created_idx`).on(t.userId, t.createdAt),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes");
export const reposts = userPostTable("reposts");
export const bookmarks = userPostTable("bookmarks");
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${author.handle}`)}>
        <Text className="text-base font-semibold text-zinc-50">
          {author.displayName}
          {author.verified ? <Text className="text-sky-400"> ✓</Text> : null}
        </Text>
      </Pressable>
      <Text className="text-sm text-zinc-500">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-500">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${quote.id}`)} className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <AuthorLine author={quote.author} createdAt={quote.createdAt} />
      {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
      <MediaGrid media={quote.media} compact />
    </Pressable>
  );
}

function StateChip({ state }: { state: PostView["state"] }) {
  if (state === "visible") return null;
  const amber = state === "withheld";
  return (
    <View className={`self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`}>
      <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{amber ? "Under review" : "Removed"}</Text>
    </View>
  );
}

/**
 * `active` colours the action. `pressed` tells a screen reader that a toggle is on, and is for
 * toggles whose label stays the same (Like, Repost); Save changes its label instead, which
 * already says so.
 */
function Action({ label, count, active, pressed, activeClass, onPress }: { label: string; count?: number; active?: boolean; pressed?: boolean; activeClass?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" aria-pressed={pressed} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
      <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{label}</Text>
      {count !== undefined && count > 0 ? <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * One post in any list. Actions update the card from the server's answer, so counts never drift
 * from the truth. A signed-out reader is sent to sign in on the first action.
 */
export function PostCard({ post: initial, repostedBy, onDeleted }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPost(initial), [initial]);

  async function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    try {
      const result = await social.engage(post.id, kind, on);
      setPost({ ...post, counts: result.counts, viewer: result.viewer });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    try {
      await social.deletePost(post.id);
      onDeleted?.(post.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-500">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip state={post.state} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-500">
          {post.replyTo.authorHandle ? "Replying to " : "Replying to a post you can't see"}
          {post.replyTo.authorHandle ? (
            <Text className="text-sky-400" onPress={() => router.push(`/u/${post.replyTo!.authorHandle}`)}>
              @{post.replyTo.authorHandle}
            </Text>
          ) : null}
        </Text>
      ) : null}
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/post/${post.id}`)} className="mt-1">
          <RichText body={post.body} />
        </Pressable>
      ) : null}
      <MediaGrid media={post.media} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} pressed={post.viewer?.reposted} activeClass="text-emerald-400" onPress={() => void toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} pressed={post.viewer?.liked} activeClass="text-rose-400" onPress={() => void toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} activeClass="text-sky-400" onPress={() => void toggle("bookmark")} />
        {post.author.id === me ? <Action label="Delete" onPress={() => void remove()} /> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
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
packages/contracts test:       Tests  48 passed (48)
packages/db test:       Tests  18 passed (18)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  9 passed (9)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  166 passed | 157 skipped (323)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `Your SQL migration file`

Must not contain:

- `renamed`

Observed on the dry run:

```text
[✓] Your SQL migration file ➜ migrations\0008_eminent_abomination.sql 🚀
```

## Step 7: verify: migration-counts

```bash
f=$(ls packages/db/migrations/0008_*.sql); echo "file: $f"; echo "created: $(grep -c 'CREATE INDEX' "$f")"; echo "dropped: $(grep -c 'DROP INDEX' "$f")"; echo "partial: $(grep -c "WHERE reply_to_id is null and state = 'visible'" "$f")"
```

Expected output contains:

- `created: 8`
- `dropped: 4`
- `partial: 1`

Observed on the dry run:

```text
created: 8
dropped: 4
partial: 1
```

## Step 8: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=9`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=9
```

## Step 9: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Must not contain:

- `failed`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 10: verify: indexes-live

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat_test -tAc "select string_agg(indexname, ' ' order by indexname) from pg_indexes where schemaname = 'public' and indexname in ('posts_reply_to_created_idx', 'posts_latest_idx', 'follows_to_created_idx', 'follows_from_created_idx', 'posts_reply_to_idx', 'follows_to_idx')"
```

Expected output contains:

- `follows_from_created_idx follows_to_created_idx posts_latest_idx posts_reply_to_created_idx`

Observed on the dry run:

```text
follows_from_created_idx follows_to_created_idx posts_latest_idx posts_reply_to_created_idx
```

## Step 11: verify: integration

```bash
cd apps/api && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  155 passed (155)
```

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/middleware/rate-limit.ts`
- `apps/api/src/social/context.ts`
- `apps/api/src/social/cursor.ts`
- `apps/api/src/social/flows/engagement.ts`
- `apps/api/src/social/flows/graph.ts`
- `apps/api/src/social/flows/posts.ts`
- `apps/api/src/social/flows/profiles.ts`
- `apps/api/src/social/limits.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/tiers.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/integration/social-flows-graph.test.ts`
- `apps/api/test/integration/social-flows-posts.test.ts`
- `apps/api/test/integration/social-repo.test.ts`
- `apps/api/test/middleware.test.ts`
- `apps/api/test/social/cursor.test.ts`
- `apps/api/test/social/limits.test.ts`
- `apps/api/test/social/tiers.test.ts`
- `apps/app/src/components/social/PostCard.tsx`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/media.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/src/text.ts`
- `packages/contracts/test/social.test.ts`
- `packages/db/migrations/0008_<two random words>.sql`
- `packages/db/migrations/meta/0008_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/content.ts`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 13: commit

```bash
git add -A
git commit -q -m "fix(social): a reply names its parent's author only to viewers who could open the parent; blocking retracts the pair's reposts and likes both ways; a pair lock keeps a follow, like, repost, reply or quote from landing across a concurrent block; hidden posts and blocking accounts reveal nothing; bidi overrides and zero-width characters are refused; follower pages filter blocks before the limit; a failing limit store is 503; cursors and ids are bounded and canonical; uploads get a daily cap; thread, list and Latest indexes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(social): a reply names its parent's author only to viewers who could open the parent; blocking retracts the pair's reposts and likes both ways; a pair lock keeps a follow, like, repost, reply or quote from landing across a concurrent block; hidden posts and blocking accounts reveal nothing; bidi overrides and zero-width characters are refused; follower pages filter blocks before the limit; a failing limit store is 503; cursors and ids are bounded and canonical; uploads get a daily cap; thread, list and Latest indexes`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 26>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "migration-counts": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "indexes-live": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
