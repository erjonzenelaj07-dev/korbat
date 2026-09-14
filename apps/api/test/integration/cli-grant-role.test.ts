import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditLog, closeDb, createDb, type Db } from "@korbat/db";
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
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, apiDb, kv }, user.email, "moderator");

    expect(result).toEqual({ userId: user.id, previousRole: "user" });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli" } });
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, apiDb, kv: new MemoryKv() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
  });
});
