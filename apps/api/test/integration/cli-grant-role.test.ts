import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: grant-role CLI", () => {
  let authDb: Db;
  let apiDb: Db;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // Only for reading the record back: grant-role itself no longer opens the API's pool.
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  const readHead = async () => (await apiDb.select().from(auditHead))[0]!;

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, kv }, user.email, "moderator");

    expect(result).toEqual({ userId: user.id, previousRole: "user" });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli" }, chainVersion: 1 });
    expect(await readHead()).toMatchObject({ seq: entries[0]!.chainSeq, hash: entries[0]!.hash });
  });

  test("the role change, the sessions it revokes and its audit row are one transaction", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });

    await runGrantRole({ authDb, kv }, user.email, "admin");

    // Every row a transaction writes carries its transaction id in xmin: one id means one transaction, which committed
    // the role, the revocation and the row together or not at all.
    const [account] = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.users where id = ${user.id}`);
    const revoked = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.sessions where user_id = ${user.id}`);
    const [row] = await apiDb.execute<{ xmin: string }>(
      sql`select xmin::text as xmin from public.audit_log where target_id = ${user.id} and action = 'role_granted'`,
    );
    expect(revoked.length).toBe(1);
    expect(revoked[0]!.xmin).toBe(account!.xmin);
    expect(row!.xmin).toBe(account!.xmin);
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, kv: new MemoryKv() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
  });

  test("while an open transaction holds the audit head, it gives up after 10 seconds having changed nothing, and says why", { timeout: 30_000 }, async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    const head = await readHead();

    // What a stalled or hostile API could do: an audit insert whose transaction stays open holds the head until it ends.
    const holder = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const stall = holder
      .transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.insert(auditLog).values({ actorId: SYSTEM_ACTOR_ID, action: "probe_stall" });
        holding();
        await released;
        throw new Error("rolled back on purpose");
      })
      .catch(() => undefined);
    try {
      await held;
      const started = Date.now();
      await expect(runGrantRole({ authDb, kv }, user.email, "moderator")).rejects.toThrow(
        /changed nothing: an open transaction holds the audit head or the account's row.*stop the api service/s,
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    } finally {
      release();
      await stall;
      await closeDb(holder);
    }
    expect((await repo.findUserById(user.id))!.role).toBe("user");
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await readHead()).toEqual(head);
  });
});
