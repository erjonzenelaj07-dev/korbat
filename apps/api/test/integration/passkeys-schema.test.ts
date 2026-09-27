import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, devices, passkeys, sessions, users, type Db } from "@korbat/db";
import { isUniqueViolation } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The error a statement ends with, or null when it succeeded. */
const failure = (statement: PromiseLike<unknown>) => Promise.resolve(statement).then(
  () => null,
  (err: unknown) => err,
);

/**
 * Migration 0010 against the real database. Every statement runs as korbat_auth, the role the auth module uses, so
 * each one that passes also shows that the tables' row-level security policies still cover the new columns.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the passkey schema", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 2 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function newSession(userId: string, deviceId: string) {
    const id = sha256Hex(randomToken());
    const now = new Date();
    await repo.createSession({ id, userId, deviceId, now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
    const [row] = await db.select({ handle: sessions.handle, factors: sessions.factors, passkeyId: sessions.passkeyId }).from(sessions).where(eq(sessions.id, id));
    return { id, ...row! };
  }

  async function newPasskey(userId: string, createdDeviceId: string | null) {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdDeviceId }).returning();
    return row!;
  }

  test("a WebAuthn user handle is stored as bytea, read back as the same bytes, and held to one account", async () => {
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    expect(owner.user.webauthnUserId).toBeNull();
    const handle = randomBytes(32);
    const [written] = await db.update(users).set({ webauthnUserId: handle }).where(eq(users.id, owner.user.id)).returning({ webauthnUserId: users.webauthnUserId });
    expect(Buffer.isBuffer(written!.webauthnUserId)).toBe(true);
    expect(written!.webauthnUserId).toEqual(handle);
    // Found by its bytes, as the user handle of an assertion is compared.
    const [found] = await db.select({ id: users.id }).from(users).where(eq(users.webauthnUserId, handle));
    expect(found?.id).toBe(owner.user.id);
    expect(isUniqueViolation(await failure(db.update(users).set({ webauthnUserId: handle }).where(eq(users.id, other.user.id))))).toBe(true);
  });

  test("each session gets its own random handle, empty factors and no passkey, and holds factors as kind to milliseconds", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const one = await newSession(user.id, device.id);
    const two = await newSession(user.id, device.id);
    expect(one.handle).toMatch(UUID_V4);
    expect(two.handle).toMatch(UUID_V4);
    expect(two.handle).not.toBe(one.handle);
    expect(one).toMatchObject({ factors: {}, passkeyId: null });
    expect(isUniqueViolation(await failure(db.update(sessions).set({ handle: one.handle }).where(eq(sessions.id, two.id))))).toBe(true);
    await db.update(sessions).set({ factors: { email: 1_790_000_000_000, totp: 1_790_000_060_000 } }).where(eq(sessions.id, one.id));
    const [row] = await db.select({ factors: sessions.factors }).from(sessions).where(eq(sessions.id, one.id));
    expect(row?.factors).toEqual({ email: 1_790_000_000_000, totp: 1_790_000_060_000 });
  });

  test("a new passkey starts with both flags off, no AAGUID and no suspicion, and its credential id stays unique", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const passkey = await newPasskey(user.id, device.id);
    expect(passkey).toMatchObject({ aaguid: null, backupEligible: false, uvInitialized: false, createdDeviceId: device.id, suspectAt: null });
    const aaguid = randomUUID();
    const suspectAt = new Date();
    const [updated] = await db.update(passkeys).set({ aaguid, backupEligible: true, uvInitialized: true, suspectAt }).where(eq(passkeys.id, passkey.id)).returning();
    expect(updated).toMatchObject({ aaguid, backupEligible: true, uvInitialized: true, suspectAt });
    const copy = db.insert(passkeys).values({ userId: user.id, credentialId: passkey.credentialId, publicKey: "cose-key", name: "Copy" });
    expect(isUniqueViolation(await failure(copy))).toBe(true);
  });

  test("removing a passkey keeps the sessions it started, without it; removing a device keeps the passkeys it added, without it", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const passkey = await newPasskey(user.id, device.id);
    const session = await newSession(user.id, device.id);
    await db.update(sessions).set({ passkeyId: passkey.id }).where(eq(sessions.id, session.id));
    await db.delete(passkeys).where(eq(passkeys.id, passkey.id));
    const [after] = await db.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, session.id));
    expect(after).toEqual({ passkeyId: null, revokedAt: null });

    const kept = await newPasskey(user.id, device.id);
    await db.delete(devices).where(eq(devices.id, device.id));
    const [orphan] = await db.select({ createdDeviceId: passkeys.createdDeviceId }).from(passkeys).where(eq(passkeys.id, kept.id));
    expect(orphan).toEqual({ createdDeviceId: null });
  });

  test("adding, removing and a counter regression of a passkey are recorded as security events", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const types = ["passkey_added", "passkey_removed", "passkey_counter_regression"] as const;
    for (const type of types) await repo.appendEvent({ userId: user.id, type, deviceId: device.id, metadata: { passkeyId: randomUUID() } });
    expect((await repo.eventsSince(user.id, new Date(0))).map((event) => event.type).sort()).toEqual([...types].sort());
  });
});
