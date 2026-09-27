import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { me } from "../../src/auth/flows/account";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { listPasskeys, notMine, passkeyRemoveKey, registerOptions, registerVerify, removeByLink, removePasskey, renamePasskey, type PasskeyRemoveToken } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };
const LINK_GONE = "This link has expired or was already used.";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Passkey registration and management against the real repository (1c design, sections 7.3, 7.5 and 7.6): the rows,
 * the transaction behind the bounds under a race, the foreign key from a session to the passkey that started it, and the
 * two lockdown paths a passkey offers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: passkey registration and management", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** The options of a registration and the browser's answer to them from the software authenticator. */
  async function ceremony(h: FlowHarness, session: Session, auth: SoftAuthenticator, flags: SoftFlags = ALL) {
    const { options } = await registerOptions(h.deps, session, { label: "ada" });
    return auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
  }

  /** A whole registration; answers the stored passkey's view. */
  async function register(h: FlowHarness, session: Session, auth: SoftAuthenticator, name?: string, flags: SoftFlags = ALL) {
    const response = await ceremony(h, session, auth, flags);
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  /** A passkey row written directly, as the cap tests fill an account without spending the day's additions. */
  async function directPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }

  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("registers two passkeys with one user handle, stores their flags and provenance, records and mails each, and lists them newest first", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    const laptop = await register(h, account.session, auth, "Laptop");
    h.clock.advance(MINUTE);
    const plain = await register(h, account.session, auth, undefined, BARE);
    expect(laptop).toMatchObject({ name: "Laptop", synced: true, createdOn: "Chrome on Windows", current: false, isNew: true, suspended: false, lastUsedAt: null });
    expect(plain).toMatchObject({ name: "Passkey on the web", synced: false, createdAt: h.clock.now().toISOString() });

    const user = (await repo.findUserById(account.user.id))!;
    expect(Buffer.isBuffer(user.webauthnUserId)).toBe(true);
    expect(user.webauthnUserId).toHaveLength(32);
    // Both options carried the same handle: it was set once.
    const { options } = await registerOptions(h.deps, account.session, { label: "ada" });
    expect(Buffer.from(options.user.id, "base64url")).toEqual(user.webauthnUserId);
    expect(options.excludeCredentials!.map((c) => c.id).sort()).toHaveLength(2);

    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, account.user.id)).orderBy(passkeys.createdAt);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: laptop.id, name: "Laptop", counter: 0, transports: ["internal", "hybrid"], backedUp: true, backupEligible: true, uvInitialized: true, createdDeviceId: account.session.deviceId, suspectAt: null, lastUsedAt: null });
    expect(rows[0]!.aaguid).toBe("00000000-0000-0000-0000-000000000000");
    expect(rows[0]!.createdAt).toEqual(new Date(h.clock.ms() - MINUTE));
    expect(rows[1]).toMatchObject({ id: plain.id, name: "Passkey on the web", backedUp: false, backupEligible: false, uvInitialized: false, createdAt: h.clock.now() });

    const { passkeys: listed } = await listPasskeys(h.deps, account.session);
    expect(listed.map((p) => p.id)).toEqual([plain.id, laptop.id]);
    expect((await me(h.deps, account.session)).user.passkeys).toBe(2);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toEqual([
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: laptop.id } },
      { type: "passkey_added", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: plain.id } },
    ]);
    const mails = h.mailer.sent.filter((m) => m.template === "passkey_added");
    expect(mails.map((m) => [m.to, m.data.name, m.data.deviceLabel])).toEqual([
      [account.email, "Laptop", "Chrome on Windows"],
      [account.email, "Passkey on the web", "Chrome on Windows"],
    ]);
    const token = /\/passkey-remove\/([A-Za-z0-9_-]{43})$/.exec(mails[1]!.data.removeUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(passkeyRemoveKey(token)))!) as PasskeyRemoveToken).toEqual({
      userId: account.user.id,
      passkeyId: plain.id,
      createdAt: h.clock.ms(),
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
  });

  test("the cap under a race: with nine passkeys, two registrations answered at once get one tenth slot between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    for (let i = 0; i < 9; i++) await directPasskey(account.user.id, h.clock.now());
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(AuthError);
    expect(refused[0]!.reason).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
    expect(await passkeyIds(account.user.id)).toHaveLength(10);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_added")).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options).toMatchObject({ code: "passkey_limit", status: 409, details: { reason: "cap" } });
  });

  test("the daily bound under a race, counted from the events by the database clock: with four additions today, two registrations at once get one fifth between them", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const auth = new SoftAuthenticator();
    // An addition from before yesterday is out of the window, whatever the harness clock says.
    await db.insert(authEvents).values({ userId: account.user.id, type: "passkey_added", deviceId: null, metadata: {}, createdAt: new Date(Date.now() - 25 * HOUR) });
    for (let i = 0; i < 4; i++) await repo.appendEvent({ userId: account.user.id, type: "passkey_added", deviceId: account.session.deviceId, metadata: {} });
    const first = await ceremony(h, account.session, auth);
    const second = await ceremony(h, account.session, auth);
    const outcomes = await Promise.allSettled([registerVerify(h.deps, account.session, { response: first }), registerVerify(h.deps, account.session, { response: second })]);
    const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const daily = refused[0]!.reason as AuthError;
    expect(daily).toBeInstanceOf(AuthError);
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 24 hours." });
    expect(daily.details).toMatchObject({ reason: "daily" });
    // Until the oldest of today's five is a day old: they were all recorded moments ago.
    const retryAfter = (daily.details as { retryAfter: number }).retryAfter;
    expect(retryAfter).toBeGreaterThan(DAY / 1000 - 60);
    expect(retryAfter).toBeLessThanOrEqual(DAY / 1000);
    expect(await passkeyIds(account.user.id)).toHaveLength(1);
    const options = await failure(registerOptions(h.deps, account.session, { label: "ada" }));
    expect(options.details).toMatchObject({ reason: "daily" });
  });

  test("the remove link runs the lockdown anchored at the passkey's creation: the passkey and the ones from the day before it go, every session and device, the password too; it works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const since = h.clock.ms() - LOCKDOWN_LOOKBACK_MS;
    const kept = await directPasskey(account.user.id, new Date(since - 1));
    const earlier = await directPasskey(account.user.id, new Date(since));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    const url = h.mailer.sent.at(-1)!.data.removeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    h.clock.advance(3 * DAY);
    const later = await directPasskey(account.user.id, h.clock.now());

    await removeByLink(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(removed[0]!.metadata).toMatchObject({ passkeyId: added.id, via: "link", totpCleared: false, passwordCleared: true });
    expect([...(removed[0]!.metadata as { passkeysRemoved: string[] }).passkeysRemoved].sort()).toEqual([earlier, added.id, later].sort());
    await expect(removeByLink(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("'not mine' on a passkey of the last 7 days does the same from inside a session, and is recorded with that session's device", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const old = await directPasskey(account.user.id, new Date(h.clock.ms() - 30 * DAY));
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await expect(notMine(h.deps, account.session, old, h.ctx)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });

    await notMine(h.deps, account.session, added.id, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([old]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const removed = (await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed");
    expect(removed).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeyId: added.id, via: "not_mine", passkeysRemoved: [added.id], totpCleared: false, passwordCleared: true } },
    ]);
    expect(h.mailer.sent.filter((m) => m.template === "passkey_removed")).toEqual([]);
  });

  test("removing the passkey that started the current session keeps the session, without it; rename and removal act only on the account's own passkeys", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const bystander = await onboardedUser(h, repo);
    const added = await register(h, account.session, new SoftAuthenticator(), "Laptop");
    await db.update(sessions).set({ passkeyId: added.id }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    expect(session.passkeyId).toBe(added.id);
    expect((await listPasskeys(h.deps, session)).passkeys.map((p) => [p.id, p.current])).toEqual([[added.id, true]]);

    await expect(renamePasskey(h.deps, bystander.session, added.id, { name: "Taken" })).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    await expect(removePasskey(h.deps, bystander.session, added.id)).rejects.toMatchObject({ code: "passkey_not_found", status: 404 });
    expect((await renamePasskey(h.deps, session, added.id, { name: "Work laptop" })).passkey).toMatchObject({ id: added.id, name: "Work laptop", current: true });

    h.clock.advance(MINUTE);
    await removePasskey(h.deps, session, added.id);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    const [row] = await db.select({ passkeyId: sessions.passkeyId, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, account.session.sessionId));
    expect(row).toEqual({ passkeyId: null, revokedAt: null });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "passkey_removed")).toEqual([
      { type: "passkey_removed", deviceId: account.session.deviceId, ipHash: null, metadata: { passkeyId: added.id, via: "settings" } },
    ]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: account.email, template: "passkey_removed", data: { name: "Work laptop", time: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/) } });
    expect(await passkeyIds(bystander.user.id)).toEqual([]);
  });
});
