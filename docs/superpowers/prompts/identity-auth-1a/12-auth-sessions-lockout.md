# korbat 1a — Task 12 of 21: Sessions and password lockout

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Sessions are opaque random tokens whose SHA-256 is the database key. They slide after 30 idle days, end after 12 months, are cached for 60 seconds, rotate on privilege changes, and carry a five-minute re-authentication window. Password lockout pauses password sign-in after five failures in 15 minutes, without ever blocking email-code sign-in.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): Redis/memory key-value store with a shared contract; auth repository with atomic single-use updates`.
3. The previous task's last API unit run ended with `Tests  78 passed | 15 skipped (93)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Create `apps/api/test/integration/auth-sessions.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout, LOCK_DURATION_MS } from "../../src/auth/lockout";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, SESSION_IDLE_MS, createSessions } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { fakeClock, newUserWithDevice } from "./auth-fixtures";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.INTEGRATION)("integration: sessions and lockout", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Sessions with a fake clock shared by the cache, so expiry can be tested without waiting. */
  function setup() {
    const clock = fakeClock();
    const kv = new MemoryKv(clock.ms);
    return { clock, kv, sessions: createSessions({ repo, kv, now: clock.now }), lockout: createLockout({ repo, kv, now: clock.now }) };
  }

  test("issued tokens resolve, and only their sha256 identifies the session", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(issued.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(issued.session.sessionId).toBe(sha256Hex(issued.token));
    expect(issued.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.session).toMatchObject({ userId: user.id, deviceId: device.id, role: "user", onboarded: false, mfaEnabled: false });
    expect(await sessions.resolve(`kb1_${"x".repeat(43)}`)).toBeNull();
  });

  test("revocation takes effect immediately, even while the session is cached", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await sessions.revoke(issued.session.sessionId, user.id)).toBe(true);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a session cannot be revoked through another user's account", async () => {
    const { sessions } = setup();
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const issued = await sessions.issue(owner.user.id, owner.device.id);
    expect(await sessions.revoke(issued.session.sessionId, other.user.id)).toBe(false);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  test("activity slides the expiry at most once an hour, and the 12-month cap cannot be extended", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    clock.advance(2 * 60 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(true);
    clock.advance(10 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    for (let day = 20; day <= 360; day += 20) {
      clock.advance(20 * DAY);
      expect(await sessions.resolve(issued.token), `day ${day}`).not.toBeNull();
    }
    clock.advance(20 * DAY);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("rotation issues a new token on the same device and revokes the old one", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const first = await sessions.issue(user.id, device.id);
    const second = await sessions.rotate(first.session);
    expect(second.token).not.toBe(first.token);
    expect(second.session.deviceId).toBe(device.id);
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).not.toBeNull();
  });

  test("signing out everywhere revokes every session of the user and lists them first", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const a = await sessions.issue(user.id, device.id);
    const b = await sessions.issue(user.id, device.id);
    const listed = await sessions.list(user.id, a.session.sessionId);
    expect(listed).toHaveLength(2);
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([a.session.sessionId]);
    expect(await sessions.revokeAll(user.id)).toBe(2);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).toBeNull();
  });

  test("re-authentication is fresh for five minutes and can be renewed", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(sessions.isFresh(issued.session)).toBe(true);
    clock.advance(REAUTH_WINDOW_MS + 1_000);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(false);
    await sessions.markReauth(issued.session.sessionId);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(true);
  });

  test("the fifth wrong password in 15 minutes locks password sign-in for 15 minutes", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 1; i <= 4; i++) expect(await lockout.recordFailure(user.id)).toEqual({ failures: i, locked: false });
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 5, locked: true });
    const locked = (await repo.findUserById(user.id))!;
    expect(lockout.isLocked(locked)).toBe(true);
    expect(locked.lockedUntil!.getTime() - clock.ms()).toBe(LOCK_DURATION_MS);
    clock.advance(LOCK_DURATION_MS + 1_000);
    expect(lockout.isLocked(locked)).toBe(false);
  });

  test("a correct password resets the failure count", async () => {
    const { lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    await lockout.recordSuccess(user.id);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
    expect((await repo.findUserById(user.id))!.failedLogins).toBe(1);
  });

  test("failures older than the 15-minute window do not count", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    clock.advance(16 * 60 * 1000);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/lockout'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/lockout' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/auth-sessions.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/sessions.ts`

```ts
import type { Platform, Role, SessionInfo } from "@korbat/contracts";
import { newSessionToken, sha256Hex } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { ActiveSessionRow, AuthRepo } from "./repo";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface Session {
  /** sha256 of the token; never the token itself. */
  sessionId: string;
  userId: string;
  deviceId: string;
  role: Role;
  onboarded: boolean;
  mfaEnabled: boolean;
  reauthAt: Date;
}

export interface IssuedSession {
  token: string;
  session: Session;
  /** Cookie Max-Age matching the idle expiry. */
  maxAgeSeconds: number;
}

interface CachedSession {
  session: Omit<Session, "reauthAt"> & { reauthAt: string };
  absoluteExpiresAt: string;
}

export function createSessions(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const cacheKey = (sessionId: string) => `sess:${sessionId}`;

  const fromRow = (row: ActiveSessionRow): Session => ({
    sessionId: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    role: row.role,
    onboarded: row.onboardedAt !== null,
    mfaEnabled: row.totpEnabledAt !== null,
    reauthAt: row.reauthAt,
  });

  async function forget(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.del(cacheKey(id))));
  }

  /** A new session; its reauth time is now, because issuing one always follows a fresh credential. */
  async function issue(userId: string, deviceId: string): Promise<IssuedSession> {
    const t = now();
    const { token, id } = newSessionToken();
    await deps.repo.createSession({
      id,
      userId,
      deviceId,
      now: t,
      expiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.getTime() + SESSION_ABSOLUTE_MS),
    });
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) throw new Error("session not found immediately after it was created");
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /**
   * Resolves a token to a live session. Results are cached for 60 seconds; revocation deletes the
   * cache entry, so it takes effect at once. `slid` is true when the idle expiry was just extended
   * (callers refresh the cookie then).
   */
  async function resolve(token: string): Promise<{ session: Session; slid: boolean } | null> {
    const id = sha256Hex(token);
    const t = now();
    const cached = await deps.kv.get(cacheKey(id));
    if (cached) {
      const c = JSON.parse(cached) as CachedSession;
      if (new Date(c.absoluteExpiresAt).getTime() > t.getTime()) {
        return { session: { ...c.session, reauthAt: new Date(c.session.reauthAt) }, slid: false };
      }
    }
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) return null;
    let slid = false;
    if (t.getTime() - row.lastUsedAt.getTime() >= SESSION_SLIDE_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(t.getTime() + SESSION_IDLE_MS, row.absoluteExpiresAt.getTime()));
      await deps.repo.slideSession(id, expiresAt, t);
      slid = true;
    }
    const session = fromRow(row);
    const entry: CachedSession = {
      session: { ...session, reauthAt: session.reauthAt.toISOString() },
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
    await deps.kv.set(cacheKey(id), JSON.stringify(entry), SESSION_CACHE_TTL_MS);
    return { session, slid };
  }

  async function revoke(sessionId: string, userId: string): Promise<boolean> {
    const revoked = await deps.repo.revokeSession(sessionId, userId, now());
    await forget([sessionId]);
    return revoked;
  }

  async function revokeAll(userId: string): Promise<number> {
    const ids = await deps.repo.revokeAllSessions(userId, now());
    await forget(ids);
    return ids.length;
  }

  /** Issues a replacement for `current` on the same device and revokes `current`. */
  async function rotate(current: Session): Promise<IssuedSession> {
    const next = await issue(current.userId, current.deviceId);
    await revoke(current.sessionId, current.userId);
    return next;
  }

  async function markReauth(sessionId: string): Promise<void> {
    await deps.repo.setReauth(sessionId, now());
    await forget([sessionId]);
  }

  function isFresh(session: Session, windowMs: number = REAUTH_WINDOW_MS): boolean {
    return now().getTime() - session.reauthAt.getTime() <= windowMs;
  }

  async function list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await deps.repo.listActiveSessions(userId, now());
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel ?? "Unknown device",
      platform: r.platform as Platform,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      current: r.id === currentSessionId,
    }));
  }

  return { issue, resolve, revoke, revokeAll, rotate, markReauth, isFresh, list };
}

export type Sessions = ReturnType<typeof createSessions>;
```

### Create `apps/api/src/auth/lockout.ts`

```ts
import type { KeyValueStore } from "./kv";
import type { AuthRepo } from "./repo";

export const LOCK_THRESHOLD = 5;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * Password lockout: the fifth wrong password within 15 minutes pauses password sign-in for
 * 15 minutes. It never blocks email-code sign-in, so guessing passwords cannot lock the owner out.
 */
export function createLockout(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const key = (userId: string) => `pw-fail:${userId}`;

  return {
    isLocked(user: { lockedUntil: Date | null }): boolean {
      return user.lockedUntil !== null && user.lockedUntil.getTime() > now().getTime();
    },

    async recordFailure(userId: string): Promise<{ failures: number; locked: boolean }> {
      const failures = await deps.kv.incr(key(userId), LOCK_WINDOW_MS);
      const locked = failures >= LOCK_THRESHOLD;
      await deps.repo.setPasswordFailures(userId, failures, locked ? new Date(now().getTime() + LOCK_DURATION_MS) : null);
      if (locked) await deps.kv.del(key(userId));
      return { failures, locked };
    },

    async recordSuccess(userId: string): Promise<void> {
      await deps.kv.del(key(userId));
      await deps.repo.setPasswordFailures(userId, 0, null);
    },
  };
}

export type Lockout = ReturnType<typeof createLockout>;
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  78 passed | 25 skipped (103)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  78 passed | 25 skipped (103)
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

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  25 passed (25)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  25 passed (25)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/lockout.ts`
- `apps/api/src/auth/sessions.ts`
- `apps/api/test/integration/auth-sessions.test.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(auth): sessions with cached resolution, sliding and absolute expiry, rotation, re-auth window; password lockout" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): sessions with cached resolution, sliding and absolute expiry, rotation, re-auth window; password lockout`.

## Report format (mandatory)

```text
TASK 12 REPORT
Files written: <count, expected 3>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
