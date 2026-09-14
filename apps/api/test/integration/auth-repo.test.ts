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
