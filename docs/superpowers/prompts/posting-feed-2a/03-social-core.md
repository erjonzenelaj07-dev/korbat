# korbat 2a — Task 3 of 13: Social module core: errors, keyset cursors, account tiers, write limits and the visibility rule

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The pure core of the social module: the error type the HTTP layer maps to the error envelope, keyset cursors that clients treat as opaque, the account-age tiers with the spec's limit numbers, per-account write limits on the existing rate-limit store, and the one visibility rule every read applies (moderation states only for their author, blocks in either direction hide everything, deleted posts become tombstones only where structure needs them).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db): counters on posts and profiles, deleted_at on posts, per-account engagement and quote indexes`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Create `apps/api/test/social/cursor.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { SocialError } from "../../src/social/context";
import { decodeCursor, encodeCursor } from "../../src/social/cursor";

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
  test("extra fields are rejected, so clients cannot smuggle filters through the cursor", () => {
    const raw = Buffer.from(JSON.stringify({ t: 5, id, viewer: "someone-else" })).toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(SocialError);
  });
});
```

### Create `apps/api/test/social/tiers.test.ts`

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

### Create `apps/api/test/social/limits.test.ts`

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

### Create `apps/api/test/social/visibility.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { postAccess, tombstone, type StoredPostState } from "../../src/social/visibility";

const author = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const post = (state: StoredPostState) => ({ authorId: author, state });

describe("post visibility", () => {
  test("a visible post is shown to everyone who is not blocked", () => {
    for (const viewer of [null, other, author]) expect(postAccess(viewer, post("visible"), false), String(viewer)).toBe("shown");
  });
  test("withheld and removed posts are shown only to their author", () => {
    for (const state of ["withheld", "removed"] as const) {
      expect(postAccess(author, post(state), false), state).toBe("shown");
      expect(postAccess(other, post(state), false), state).toBe("hidden");
      expect(postAccess(null, post(state), false), state).toBe("hidden");
    }
  });
  test("a deleted post is a deleted tombstone for everyone, the author included", () => {
    for (const viewer of [null, other, author]) expect(postAccess(viewer, post("deleted_by_author"), false), String(viewer)).toBe("deleted");
    expect(tombstone("x", "deleted")).toEqual({ id: "x", deleted: true });
  });
  test("a block in either direction hides everything, even the reason a post is gone", () => {
    for (const state of ["visible", "withheld", "removed", "deleted_by_author"] as const) {
      expect(postAccess(other, post(state), true), state).toBe("hidden");
    }
    expect(tombstone("x", "hidden")).toEqual({ id: "x", unavailable: true });
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Test Files  4 failed`
- `Cannot find module '../../src/social/`

Observed on the dry run:

```text
Test Files  4 failed | 17 passed | 12 skipped (33)
Error: Cannot find module '../../src/social/context' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/social/cursor.test.ts
Error: Cannot find module '../../src/social/context' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/social/limits.test.ts
Error: Cannot find module '../../src/social/tiers' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/social/tiers.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/social/context.ts`

```ts
import type { SocialErrorCode } from "@korbat/contracts";

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | "not_found" | "invalid_request" | "rate_limited";
export type SocialErrorStatus = 400 | 403 | 404 | 429;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
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
```

### Create `apps/api/src/social/cursor.ts`

```ts
import { z } from "zod";
import { SocialError } from "./context";

/**
 * A keyset cursor: the sort time in epoch milliseconds, the post id, and for repost items the
 * reposter id. Every timestamp the repository writes has millisecond precision (it passes the
 * clock's Date instead of relying on the database default), so the cursor round-trips exactly.
 */
const Cursor = z.strictObject({
  t: z.number().int().nonnegative(),
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

### Create `apps/api/src/social/tiers.ts`

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

export type WriteAction = "post" | "reply" | "quote" | "repost" | "like" | "bookmark" | "follow" | "block" | "mute";

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
  }
}
```

### Create `apps/api/src/social/limits.ts`

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
    const { count, resetMs } = await store.hit(`social:${limit.bucket}:${userId}`, limit.windowMs);
    if (count > limit.max) {
      throw new SocialError("rate_limited", 429, undefined, Math.max(1, Math.ceil(resetMs / 1000)));
    }
  }
}
```

### Create `apps/api/src/social/visibility.ts`

```ts
import type { Tombstone } from "@korbat/contracts";
import type { ViewerId } from "./context";

export type StoredPostState = "visible" | "withheld" | "removed" | "deleted_by_author";

/**
 * shown: the viewer gets the post. hidden: the viewer may not see it (a block, or moderation state
 * on someone else's post). deleted: the author removed it. Hidden and deleted posts are omitted
 * from lists and become tombstones only where structure needs them.
 */
export type PostAccess = "shown" | "hidden" | "deleted";

/**
 * The one rule every read applies (2a spec, section 4). A block in either direction hides
 * everything, even a deleted post's tombstone reason. The author sees their own withheld and
 * removed posts; nobody else does.
 */
export function postAccess(viewer: ViewerId, post: { authorId: string; state: StoredPostState }, blockedEitherWay: boolean): PostAccess {
  if (blockedEitherWay) return "hidden";
  if (post.state === "deleted_by_author") return "deleted";
  if (post.state === "visible") return "shown";
  return viewer !== null && viewer === post.authorId ? "shown" : "hidden";
}

export function tombstone(id: string, access: Exclude<PostAccess, "shown">): Tombstone {
  return access === "deleted" ? { id, deleted: true } : { id, unavailable: true };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  102 passed | 67 skipped (169)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  102 passed | 67 skipped (169)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/context.ts`
- `apps/api/src/social/cursor.ts`
- `apps/api/src/social/limits.ts`
- `apps/api/src/social/tiers.ts`
- `apps/api/src/social/visibility.ts`
- `apps/api/test/social/cursor.test.ts`
- `apps/api/test/social/limits.test.ts`
- `apps/api/test/social/tiers.test.ts`
- `apps/api/test/social/visibility.test.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "feat(social): error type, keyset cursors, age tiers, per-account write limits, post visibility rule" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): error type, keyset cursors, age tiers, per-account write limits, post visibility rule`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 9>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
