import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { emailRevertKey, revertEmailChange, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS, lockdown } from "../../src/auth/flows/lockdown";
import { notMe } from "../../src/auth/flows/not-me";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import { createAuthRepo, type AuthEventType, type AuthRepo } from "../../src/auth/repo";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { flowHarness, newTestDevice, newTestEmail, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

/**
 * The lockdown against the real repository (1c design, sections 2 and 7.6), and the two links that run it in
 * this task: the new-device alert's "not me" and the email undo. Passkey rows are written directly, since no
 * flow adds one yet.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the lockdown and the links that run it", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** A passkey of the account created at `createdAt`, as a registration would write it; answers its id. */
  async function newPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }
  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** TOTP on since `enabledAt`, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(h: FlowHarness, userId: string, enabledAt: Date) {
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: ["owner-code"], now: enabledAt });
    await h.deps.sessions.forgetUser(userId);
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("revokes every session and device, clears the password, removes the passkeys from the day before the anchor on and the one named, turns off two-factor from then on, and records it; run again, it finds nothing more", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const bystander = await onboardedUser(h, repo, { password: PASSWORD });
    const anchor = new Date(h.clock.ms() + 3 * DAY);
    const since = new Date(anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
    const kept = await newPasskey(account.user.id, new Date(since.getTime() - 1));
    const named = await newPasskey(account.user.id, new Date(since.getTime() - 10 * DAY));
    const atSince = await newPasskey(account.user.id, since);
    const later = await newPasskey(account.user.id, new Date(anchor.getTime() + HOUR));
    const bystanders = await newPasskey(bystander.user.id, since);
    await withTotp(h, account.user.id, since);
    await withTotp(h, bystander.user.id, since);
    h.clock.advance(4 * DAY);

    const report = await lockdown(h.deps, { userId: account.user.id, anchor, passkeyIds: [named, bystanders], caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect([...report.passkeysRemoved].sort()).toEqual([named, atSince, later].sort());
    expect(report).toMatchObject({ totpCleared: true, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await passkeyIds(bystander.user.id)).toEqual([bystanders]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await h.kv.get(`sess:2:${account.session.sessionId}`)).toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect((await repo.findUserById(bystander.user.id))!).toMatchObject({ totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await h.deps.sessions.resolve(bystander.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toEqual([
      { type: "not_me", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeysRemoved: report.passkeysRemoved, totpCleared: true, passwordCleared: true } },
    ]);

    const again = await lockdown(h.deps, { userId: account.user.id, anchor, caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect(again).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toHaveLength(2);

    // Two-factor from just before the day the lockdown reaches back stays.
    const earlier = await onboardedUser(h, repo);
    await withTotp(h, earlier.user.id, new Date(since.getTime() - 1));
    expect((await lockdown(h.deps, { userId: earlier.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx })).totpCleared).toBe(false);
    expect((await repo.findUserById(earlier.user.id))!.totpEnabledAt).toEqual(new Date(since.getTime() - 1));
  });

  test("the lockdown is one transaction: when its last statement, the event, cannot be written, nothing of it lands, and the next run finds everything still to do", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const passkey = await newPasskey(account.user.id, h.clock.now());
    await withTotp(h, account.user.id, h.clock.now());
    const before = (await repo.findUserById(account.user.id))!;
    h.clock.advance(HOUR);

    // An event type the database does not know: the insert, which comes after every other write, is refused.
    const unknown = "no_such_event" as AuthEventType;
    await expect(lockdown(h.deps, { userId: account.user.id, anchor: h.clock.now(), passkeyIds: [passkey], caller: { type: unknown, deviceId: account.session.deviceId }, ctx: h.ctx })).rejects.toThrow();
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).not.toBeNull();
    expect(await h.kv.get(`sess:2:${account.session.sessionId}`)).not.toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toHaveLength(2);
    expect(await repo.listDevices(account.user.id)).toHaveLength(1);
    expect(await passkeyIds(account.user.id)).toEqual([passkey]);
    expect((await repo.findUserById(account.user.id))!).toEqual(before);
    expect(before).toMatchObject({ passwordHash: expect.stringMatching(/^\$argon2id\$/), totpSecretEnc: expect.stringMatching(/^v1:/), recoveryCodesHash: ["owner-code"] });
    // The sign-in that made the account's session is the one event on record: the refused lockdown left none.
    expect((await eventsOf(account.user.id)).map((e) => e.type)).toEqual(["signin_success"]);

    // The same lockdown with an event the database takes: the rows and the event land together.
    const report = await lockdown(h.deps, { userId: account.user.id, anchor: h.clock.now(), passkeyIds: [passkey], caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect(report).toEqual({ passkeysRemoved: [passkey], totpCleared: true, passwordCleared: true });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    for (const id of [account.session.sessionId, other.session.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect(await passkeyIds(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, passwordChangedAt: h.clock.now(), failedLogins: 0, lockedUntil: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    expect((await eventsOf(account.user.id)).filter((e) => e.type !== "signin_success")).toEqual([
      { type: "not_me", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeysRemoved: [passkey], totpCleared: true, passwordCleared: true } },
    ]);
  });

  test("the alert of a sign-in on a new device stores the sign-in's time and the address, and its link locks the account down anchored there", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const signedInAt = h.clock.ms() + 2 * DAY;
    const since = signedInAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    h.clock.advance(2 * DAY);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    const signedIn = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    expect(signedIn.kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.kv.get(notMeKey(token)))!) as NotMeToken;
    expect(stored).toEqual({
      userId: account.user.id,
      deviceId: (signedIn as { issued: { session: { deviceId: string } } }).issued.session.deviceId,
      signedInAt,
      passkeyId: null,
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
    // Whoever signed in turns two-factor on afterwards.
    h.clock.advance(HOUR);
    await withTotp(h, account.user.id, h.clock.now());
    h.clock.advance(HOUR);

    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpEnabledAt: null });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.metadata])).toEqual([
      [stored.deviceId, { passkeysRemoved: [recent], totpCleared: true, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("a link from before the deploy is anchored a day before it is used: it reaches two days back", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const used = h.clock.ms() + 3 * DAY;
    const since = used - DAY - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const inReach = await newPasskey(account.user.id, new Date(since));
    await withTotp(h, account.user.id, new Date(since));
    const token = randomToken();
    await h.kv.set(notMeKey(token), JSON.stringify({ userId: account.user.id, deviceId: account.session.deviceId }), 4 * DAY);
    h.clock.advance(3 * DAY);
    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => e.metadata)).toEqual([{ passkeysRemoved: [inReach], totpCleared: true, passwordCleared: true }]);
  });

  test("a not-me link after the address changed does nothing but refuse", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    await repo.changeEmail(account.user.id, newTestEmail("moved"), h.clock.now());
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toHaveLength(2);
    expect(await repo.listDevices(account.user.id)).toHaveLength(2);
    expect((await repo.findUserById(account.user.id))!.passwordHash).not.toBeNull();
    expect((await eventsOf(account.user.id)).map((e) => e.type)).not.toContain("not_me");
  });

  test("the email undo is anchored at the change and names the passkey behind the changing session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const owners = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const changedAt = h.clock.ms() + 3 * DAY;
    const since = changedAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    // The passkey that started the changing session is far older than the day the lockdown reaches back.
    const behind = await newPasskey(account.user.id, new Date(since - 10 * DAY));
    await db.update(sessions).set({ passkeyId: behind }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    await withTotp(h, account.user.id, new Date(since - 1));
    h.clock.advance(3 * DAY);
    const changing = (await h.deps.sessions.resolve(account.token))!.session;
    expect(changing.passkeyId).toBe(behind);
    const newAddress = newTestEmail("moved");
    const started = await startEmailChange(h.deps, changing, { email: newAddress }, h.ctx);
    await verifyEmailChange(h.deps, changing, { flowId: started.flowId, code: h.mailer.lastCodeFor(newAddress)! });
    const notice = h.mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: account.email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(token)))!)).toEqual({ userId: account.user.id, oldEmail: account.email, changedAt, passkeyId: behind });

    h.clock.advance(HOUR);
    const added = await newPasskey(account.user.id, h.clock.now());
    h.clock.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ email: account.email, passwordHash: null, totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(owners.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    const key = h.deps.config.authHmacKey;
    const reverted = (await eventsOf(account.user.id)).filter((e) => e.type === "email_changed").at(-1)!;
    expect(reverted).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(reverted.metadata).toMatchObject({ from: emailHash(key, newAddress), to: emailHash(key, account.email), reverted: true, totpCleared: false, passwordCleared: true });
    expect([...((reverted.metadata as { passkeysRemoved: string[] }).passkeysRemoved)].sort()).toEqual([recent, behind, added].sort());
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: account.email, template: "email_change_reverted" });
  });
});
