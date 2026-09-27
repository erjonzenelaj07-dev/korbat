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
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(issued.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(issued.session.sessionId).toBe(sha256Hex(issued.token));
    expect(issued.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.session).toMatchObject({ userId: user.id, deviceId: device.id, role: "user", onboarded: false, mfaEnabled: false });
    // What the session proved and when, its handle for life, and the passkey it started from, if any (1c design, section 7.1).
    expect(resolved?.session).toMatchObject({ factors: { email: clock.ms() }, reauthAt: clock.now(), passkeyId: null });
    expect(resolved?.session.handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolved?.session).toEqual(issued.session);
    expect(await sessions.resolve(`kb1_${"x".repeat(43)}`)).toBeNull();
    // The reauth time is the latest of the factors, whatever order they are given in.
    const two = await sessions.issue(user.id, device.id, { factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 } });
    expect(two.session).toMatchObject({ factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 }, reauthAt: new Date(clock.ms() + 5_000) });
    expect(two.session.handle).not.toBe(issued.session.handle);
  });

  test("revocation takes effect immediately, even while the session is cached", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    // A session is revoked by its handle, the id the list shows; a second revoke finds nothing live.
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    expect(await sessions.resolve(issued.token)).toBeNull();
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(false);
  });

  test("a revoked session stays revoked while a cache fill is in flight, and a foreign revoke leaves the cache alone", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const key = `sess:2:${issued.session.sessionId}`;
    await sessions.resolve(issued.token);
    const other = await newUserWithDevice(repo);
    expect(await sessions.revoke(issued.session.handle, other.user.id)).toBe(false);
    expect(await kv.get(key)).not.toBe("revoked");
    // Revoked by the handle; the tombstone lies where the cached copy does, under the token's hash.
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    expect(await kv.get(key)).toBe("revoked");
    expect(await kv.setIfAbsent(key, "a stale copy", 60_000)).toBe(false);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a session cannot be revoked through another user's account", async () => {
    const { clock, sessions } = setup();
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const issued = await sessions.issue(owner.user.id, owner.device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.handle, other.user.id)).toBe(false);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  test("activity slides the expiry at most once an hour, and the 12-month cap cannot be extended", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
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

  test("rotation replaces the token in place: the handle, factors, reauth time, passkey, device and expiries stay, and the old token stops working at once", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const first = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() - 60_000, totp: clock.ms() } });
    const before = (await repo.findActiveSession(first.session.sessionId, clock.now()))!;
    // Cached, as a session in use is.
    expect(await sessions.resolve(first.token)).not.toBeNull();
    clock.advance(60_000);
    const second = await sessions.rotate(first.session);
    expect(second.token).not.toBe(first.token);
    expect(second.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(second.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    // Only the id, the token's hash, changed; the reauth time did not move, since no factor was proven.
    expect(second.session).toEqual({ ...first.session, sessionId: sha256Hex(second.token) });
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await kv.get(`sess:2:${first.session.sessionId}`)).toBe("revoked");
    expect((await sessions.resolve(second.token))?.session).toEqual(second.session);
    const after = (await repo.findActiveSession(second.session.sessionId, clock.now()))!;
    expect(after).toEqual({ ...before, id: second.session.sessionId });
    // One row, under the new id and the same handle: the list names it by the handle and marks it current by it.
    expect((await sessions.list(user.id, second.session.handle)).map((s) => [s.id, s.current])).toEqual([[first.session.handle, true]]);
  });

  test("a session listed before its token rotated is revoked by the id the list gave: the rotated token stops working, with a tombstone under its hash", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const owners = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const target = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const before = await sessions.list(user.id, owners.session.handle);
    // The ids a client sees are the handles: no token's hash is among them.
    expect(before.map((s) => s.id).sort()).toEqual([owners.session.handle, target.session.handle].sort());
    const listed = before.find((s) => !s.current)!;
    expect(listed.id).toBe(target.session.handle);

    // The listed session re-authenticates before the revoke lands: a factor is written and its token rotates, twice over.
    await sessions.addFactor(target.session.sessionId, "password");
    const once = await sessions.rotate(target.session);
    const twice = await sessions.rotate(once.session);
    expect((await sessions.resolve(twice.token))?.session.handle).toBe(listed.id);

    expect(await sessions.revoke(listed.id, user.id)).toBe(true);
    expect(await sessions.resolve(twice.token)).toBeNull();
    // The tombstone is keyed by the row's id at the moment of the revoke, where a cached copy lies.
    expect(await kv.get(`sess:2:${twice.session.sessionId}`)).toBe("revoked");
    expect((await sessions.list(user.id, owners.session.handle)).map((s) => s.id)).toEqual([owners.session.handle]);
    expect(await sessions.resolve(owners.token)).not.toBeNull();
    expect(await sessions.revoke(listed.id, user.id)).toBe(false);
  });

  test("a session revoked meanwhile cannot be rotated: nothing replaces it", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.handle, user.id)).toBe(true);
    await expect(sessions.rotate(issued.session)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await sessions.list(user.id, issued.session.handle)).toEqual([]);
  });

  test("signing out everywhere revokes every session of the user and lists them first", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const a = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const b = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const listed = await sessions.list(user.id, a.session.handle);
    expect(listed).toHaveLength(2);
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([a.session.handle]);
    expect(listed.filter((s) => !s.current).map((s) => s.id)).toEqual([b.session.handle]);
    expect(await sessions.revokeAll(user.id)).toBe(2);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).toBeNull();
  });

  test("a session is fresh for five minutes after a factor was proven, and a factor written later renews it and can raise its level", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const signedIn = clock.ms();
    const issued = await sessions.issue(user.id, device.id, { factors: { email: signedIn } });
    expect(sessions.isFresh(issued.session)).toBe(true);
    clock.advance(REAUTH_WINDOW_MS + 1_000);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(false);
    await sessions.addFactor(issued.session.sessionId, "password");
    // The cached copy went with the write, so the factor shows at once, with the reauth time following it.
    const renewed = (await sessions.resolve(issued.token))!.session;
    expect(renewed).toMatchObject({ factors: { email: signedIn, password: clock.ms() }, reauthAt: clock.now() });
    expect(sessions.isFresh(renewed)).toBe(true);
    expect(sessions.level(renewed)).toBe(1);
    await sessions.addFactor(issued.session.sessionId, "totp");
    const strong = (await sessions.resolve(issued.token))!.session;
    expect(strong.factors).toEqual({ email: signedIn, password: clock.ms(), totp: clock.ms() });
    expect(sessions.level(strong)).toBe(2);
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
