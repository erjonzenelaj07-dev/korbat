# korbat 1a — Task 11 of 21: Key-value store and the auth repository

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Short-lived auth state (flows, MFA tickets, rate-limit counters, the session cache) lives behind one key-value interface with Redis and in-memory implementations that pass the same contract tests. Every SQL statement against the auth schema lives in one repository, with atomic single-use updates for codes and TOTP steps.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.
- Pinned by this task: drizzle-orm 0.45.2 (already locked for @korbat/db).

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(mail): mailer interface, plain templates, SMTP adapter; Mailpit in dev compose`.
3. The previous task's last API unit run ended with `Tests  73 passed | 2 skipped (75)`.

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

### Create `apps/api/test/auth/kv-contract.ts`

```ts
import { describe, expect, test } from "vitest";
import type { KeyValueStore } from "../../src/auth/kv";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One behaviour contract, run against every KeyValueStore implementation. */
export function kvContract(label: string, make: () => KeyValueStore, enabled = true) {
  describe.skipIf(!enabled)(`key-value store contract: ${label}`, () => {
    const key = () => `contract:${Math.random().toString(36).slice(2)}`;

    test("set, get and del", async () => {
      const kv = make();
      const k = key();
      expect(await kv.get(k)).toBeNull();
      await kv.set(k, "v", 10_000);
      expect(await kv.get(k)).toBe("v");
      await kv.del(k);
      expect(await kv.get(k)).toBeNull();
    });
    test("values expire after their TTL", async () => {
      const kv = make();
      const k = key();
      await kv.set(k, "v", 60);
      await sleep(150);
      expect(await kv.get(k)).toBeNull();
    });
    test("setIfAbsent writes only once", async () => {
      const kv = make();
      const k = key();
      expect(await kv.setIfAbsent(k, "a", 10_000)).toBe(true);
      expect(await kv.setIfAbsent(k, "b", 10_000)).toBe(false);
      expect(await kv.get(k)).toBe("a");
    });
    test("take returns a value once", async () => {
      const kv = make();
      const k = key();
      await kv.set(k, "once", 10_000);
      expect(await kv.take(k)).toBe("once");
      expect(await kv.take(k)).toBeNull();
    });
    test("incr counts inside a window that starts at the first increment", async () => {
      const kv = make();
      const k = key();
      expect(await kv.incr(k, 150)).toBe(1);
      expect(await kv.incr(k, 150)).toBe(2);
      await sleep(250);
      expect(await kv.incr(k, 150)).toBe(1);
    });
  });
}
```

### Create `apps/api/test/auth/kv.test.ts`

```ts
import { MemoryKv } from "../../src/auth/kv";
import { kvContract } from "./kv-contract";

kvContract("memory", () => new MemoryKv());
```

### Create `apps/api/test/integration/kv-redis.test.ts`

```ts
import Redis from "ioredis";
import { afterAll } from "vitest";
import { redisKv } from "../../src/auth/kv";
import { kvContract } from "../auth/kv-contract";

const enabled = Boolean(process.env.INTEGRATION);
const redis = enabled ? new Redis(process.env.REDIS_URL ?? "redis://localhost:56379") : null;

afterAll(async () => {
  await redis?.quit();
});

kvContract("redis", () => redisKv(redis!, "korbat:test:"), enabled);
```

### Create `apps/api/test/integration/auth-fixtures.ts`

```ts
import { randomUUID } from "node:crypto";
import { randomToken } from "../../src/auth/crypto";
import type { AuthRepo } from "../../src/auth/repo";

/** A fresh user with one web device. Every call uses a unique email, so tests never collide. */
export async function newUserWithDevice(repo: AuthRepo) {
  const user = await repo.createUser({ email: `it-${randomUUID()}@korbat.local`, termsVersion: "test", now: new Date() });
  const device = await repo.createDevice({ userId: user.id, deviceHash: randomToken(), label: "Chrome on Windows", platform: "web", ipHash: null });
  return { user, device };
}

/** A controllable clock for expiry and window tests. */
export function fakeClock(start: number = Date.now()) {
  let t = start;
  return {
    now: () => new Date(t),
    ms: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}
```

### Create `apps/api/test/integration/auth-repo.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: auth repo", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("users are found by email in any case, and a second account for the same email is rejected", async () => {
    const email = `repo-${randomUUID()}@korbat.local`;
    const user = await repo.createUser({ email, termsVersion: "test", now: new Date() });
    expect(user.role).toBe("user");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await repo.findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    await expect(repo.createUser({ email: email.toUpperCase(), termsVersion: "test", now: new Date() })).rejects.toThrow();
  });

  test("an email code counts attempts and can be consumed exactly once", async () => {
    const flowId = randomToken();
    await repo.createEmailCode({
      flowId,
      email: `repo-${randomUUID()}@korbat.local`,
      userId: null,
      purpose: "signup",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 600_000),
      ipHash: null,
    });
    const code = (await repo.findEmailCode(flowId))!;
    expect(await repo.addCodeAttempt(code.id)).toBe(1);
    expect(await repo.addCodeAttempt(code.id)).toBe(2);
    const results = await Promise.all([repo.consumeEmailCode(code.id, new Date()), repo.consumeEmailCode(code.id, new Date())]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("TOTP steps can only be claimed forwards, once, even concurrently", async () => {
    const { user } = await newUserWithDevice(repo);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(true);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(false);
    expect(await repo.claimTotpStep(user.id, 99)).toBe(false);
    const results = await Promise.all([repo.claimTotpStep(user.id, 101), repo.claimTotpStep(user.id, 101)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a recovery code hash is removed once, even under concurrent use", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.enableTotp(user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a", "b", "c"], now: new Date() });
    const results = await Promise.all([repo.consumeRecoveryCodeHash(user.id, "b"), repo.consumeRecoveryCodeHash(user.id, "b")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repo.findUserById(user.id))!.recoveryCodesHash).toEqual(["a", "c"]);
  });

  test("changing the password clears the lockout state", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.setPasswordFailures(user.id, 5, new Date(Date.now() + 900_000));
    await repo.setPasswordHash(user.id, "$argon2id$placeholder", new Date());
    const row = (await repo.findUserById(user.id))!;
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(row.passwordChangedAt).not.toBeNull();
  });

  test("only live sessions are active, listed and revoked", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const now = new Date();
    const make = async (expiresAt: Date) => {
      const id = sha256Hex(randomToken());
      await repo.createSession({ id, userId: user.id, deviceId: device.id, now, expiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
      return id;
    };
    const live = await make(new Date(now.getTime() + 60_000));
    const expired = await make(new Date(now.getTime() - 1_000));
    const revoked = await make(new Date(now.getTime() + 60_000));
    expect(await repo.revokeSession(revoked, user.id, now)).toBe(true);

    expect((await repo.findActiveSession(live, new Date()))?.role).toBe("user");
    expect(await repo.findActiveSession(expired, new Date())).toBeUndefined();
    expect(await repo.findActiveSession(revoked, new Date())).toBeUndefined();
    expect((await repo.listActiveSessions(user.id, new Date())).map((s) => s.id)).toEqual([live]);
    // Sessions that expired without being revoked are revoked too, so nothing stale stays live.
    expect((await repo.revokeAllSessions(user.id, new Date())).sort()).toEqual([live, expired].sort());
    expect(await repo.findActiveSession(live, new Date())).toBeUndefined();
  });

  test("a user cannot revoke another user's session", async () => {
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const now = new Date();
    const id = sha256Hex(randomToken());
    await repo.createSession({ id, userId: owner.user.id, deviceId: owner.device.id, now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
    expect(await repo.revokeSession(id, other.user.id, now)).toBe(false);
    expect(await repo.findActiveSession(id, new Date())).toBeDefined();
  });

  test("auth events are append-only for the auth role", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signup", metadata: { via: "test" } });
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signup"]);
    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/kv'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/kv' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/auth/kv.test.ts
Error: Cannot find module '../../src/auth/kv' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/kv-redis.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/kv.ts`

```ts
import type Redis from "ioredis";

/** Short-lived auth state: session cache, MFA tickets, pending TOTP secrets, single-use links, failure counters. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Writes only when the key does not exist. Resolves true when it wrote. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Returns the value and deletes the key in one step, so a value can be taken once. */
  take(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Increments a counter; the TTL starts at the first increment and is not extended afterwards. */
  incr(key: string, ttlMs: number): Promise<number>;
}

const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export function redisKv(redis: Redis, prefix = "korbat:auth:"): KeyValueStore {
  const k = (key: string) => prefix + key;
  return {
    get: (key) => redis.get(k(key)),
    async set(key, value, ttlMs) {
      await redis.set(k(key), value, "PX", ttlMs);
    },
    async setIfAbsent(key, value, ttlMs) {
      return (await redis.set(k(key), value, "PX", ttlMs, "NX")) === "OK";
    },
    take: (key) => redis.getdel(k(key)),
    async del(key) {
      await redis.del(k(key));
    },
    async incr(key, ttlMs) {
      return Number(await redis.eval(INCR_WITH_TTL, 1, k(key), ttlMs));
    },
  };
}

/** In-process store with the same semantics, for unit tests. The clock is injectable. */
export class MemoryKv implements KeyValueStore {
  private readonly items = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    return item;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs: number) {
    this.items.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async take(key: string) {
    const item = this.live(key);
    this.items.delete(key);
    return item?.value ?? null;
  }

  async del(key: string) {
    this.items.delete(key);
  }

  async incr(key: string, ttlMs: number) {
    const item = this.live(key);
    if (!item) {
      this.items.set(key, { value: "1", expiresAt: this.now() + ttlMs });
      return 1;
    }
    const next = Number(item.value) + 1;
    item.value = String(next);
    return next;
  }
}
```

### Create `apps/api/src/auth/repo.ts`

```ts
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, sessions, userRole, users, type Db } from "@korbat/db";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionListRow {
  id: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    // ------------------------------------------------------------ sessions

    async createSession(input: { id: string; userId: string; deviceId: string; now: Date; expiresAt: Date; absoluteExpiresAt: Date }): Promise<void> {
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    async setReauth(id: string, now: Date): Promise<void> {
      await db.update(sessions).set({ reauthAt: now }).where(eq(sessions.id, id));
    },

    /** Revokes one session of this user. False when it does not belong to the user or is already revoked. */
    async revokeSession(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

## Step 4: verify: add-drizzle

```bash
pnpm --filter @korbat/api add -E --config.minimum-release-age=0 drizzle-orm@0.45.2 && node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `Done in`
- `0 new package versions since HEAD; all at least 7 days old`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 7.4s using pnpm v10.30.0
0 new package versions since HEAD; all at least 7 days old
```

## Step 5: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  78 passed | 15 skipped (93)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  78 passed | 15 skipped (93)
```

## Step 6: verify: typecheck

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

## Step 7: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  15 passed (15)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  15 passed (15)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/package.json`
- `apps/api/src/auth/kv.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/test/auth/kv-contract.ts`
- `apps/api/test/auth/kv.test.ts`
- `apps/api/test/integration/auth-fixtures.ts`
- `apps/api/test/integration/auth-repo.test.ts`
- `apps/api/test/integration/kv-redis.test.ts`
- `pnpm-lock.yaml`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(auth): Redis/memory key-value store with a shared contract; auth repository with atomic single-use updates" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): Redis/memory key-value store with a shared contract; auth repository with atomic single-use updates`.

## Report format (mandatory)

```text
TASK 11 REPORT
Files written: <count, expected 7>
Failing-test step (the error line): <paste>
Verify "add-drizzle": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
