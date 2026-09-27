import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey } from "../../src/auth/flows/email";
import {
  EMAIL_CHANGE_STARTS_PER_HOUR,
  EMAIL_REVERTS_PER_IP_PER_HOUR,
  EMAIL_REVERT_TTL_MS,
  emailRevertKey,
  revertEmailChange,
  startEmailChange,
  verifyEmailChange,
} from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
/** What the undo's event carries beside the address hashes once the lockdown ran and found nothing else to remove. */
const NOTHING_ELSE = { passkeysRemoved: [], totpCleared: false, passwordCleared: true };

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

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

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Starts a change and returns its flow id with the code from the mail to the new address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startEmailChange(h.deps, session, { email }, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

const REVERT_URL = /^http:\/\/localhost:8081\/email-revert\/([A-Za-z0-9_-]{43})$/;
const LINK_GONE = "This link has expired or was already used.";

/** Moves the account to `email` with the code from its mailbox, and returns the undo link's token from the notice to the old address, if it carried one. */
async function change(h: MemoryFlowHarness, session: Session, email: string): Promise<string | null> {
  const { flowId, code } = await start(h, session, email);
  await verifyEmailChange(h.deps, session, { flowId, code });
  const notice = h.mailer.sent.at(-1)!;
  expect(notice.template).toBe("email_changed");
  const url = notice.data.revertUrl;
  return url === undefined ? null : REVERT_URL.exec(url)![1]!;
}

describe("email change: the start step", () => {
  test("answers the same, in the same time, whether or not the new address already has an account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("taken@korbat.local");
    const startedAt = Date.now();
    const toTaken = await startEmailChange(h.deps, ada.session, { email: "taken@korbat.local" }, h.ctx);
    const elapsed = Date.now() - startedAt;
    const toFree = await startEmailChange(h.deps, ada.session, { email: "free@korbat.local" }, h.ctx);
    expect(Object.keys(toTaken)).toEqual(["flowId"]);
    expect(Object.keys(toFree)).toEqual(["flowId"]);
    expect(toTaken.flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(elapsed).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([
      ["taken@korbat.local", "email_change_code", ["code"]],
      ["free@korbat.local", "email_change_code", ["code"]],
    ]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([
      ["taken@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
      ["free@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
    ]);
    expect(JSON.parse((await h.kv.get(flowKey(toFree.flowId)))!)).toEqual({ userId: ada.user.id, email: "free@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("refuses a disposable domain and the account's current address, in any case, before any mail or limit is touched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "someone@mailinator.com" }, h.ctx))).toMatchObject({ code: "disposable_email", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "Ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(h.mailer.sent).toEqual([]);
    expect(h.codes).toEqual([]);
    // A slip does not delay the account's own sign-in codes: the current address got no cooldown.
    expect(await h.kv.get(`email-cooldown:${emailHash(h.deps.config.authHmacKey, "ada@korbat.local")}`)).toBeNull();
    expect(await h.kv.get(`rl:email-change:${ada.user.id}`)).toBeNull();
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < EMAIL_CHANGE_STARTS_PER_HOUR; i++) await startEmailChange(h.deps, ada.session, { email: `new-${i}@korbat.local` }, h.ctx);
    const refused = await failure(startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(EMAIL_CHANGE_STARTS_PER_HOUR);
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startEmailChange(h.deps, bob.session, { email: "bob-new@korbat.local" }, h.ctx);
    h.advance(HOUR + 1);
    await startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["new-0@korbat.local", "new-1@korbat.local", "new-2@korbat.local", "bob-new@korbat.local", "new-3@korbat.local"]);
  });

  test("a new address waits 60 seconds between codes and gets at most 3 an hour, whoever asks, in the sign-in start's buckets", async () => {
    const h = memoryFlowHarness();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    const target = "shared@korbat.local";
    const hashed = emailHash(h.deps.config.authHmacKey, target);
    await startEmailChange(h.deps, a!.session, { email: target }, h.ctx);
    expect(await failure(startEmailChange(h.deps, b!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: MINUTE / 1000 });
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, b!.session, { email: target }, h.ctx);
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, c!.session, { email: target }, h.ctx);
    expect(await h.kv.get(`rl:email-start:email:${hashed}`)).toBe("3");
    expect(await h.kv.get(`email-cooldown:${hashed}`)).toBe("1");
    h.advance(MINUTE + 1);
    expect(await failure(startEmailChange(h.deps, d!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(3);
    h.advance(HOUR);
    await startEmailChange(h.deps, d!.session, { email: target }, h.ctx);
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(4);
  });
});

describe("email change: the verification step", () => {
  test("a wrong code is invalid_code and counts an attempt; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId: randomToken(), code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("a code older than 10 minutes is code_expired and changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "code_expired", status: 400 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("five wrong codes exhaust the code: too_many_attempts even for the right one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
  });

  test("a flow another account started is invalid_code for this one and costs its owner no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, bob.session, { flowId, code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(bob.user.id)!.email).toBe("bob@korbat.local");
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("an address that belongs to another account, in any case, is email_in_use only now, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("Wanted@korbat.local");
    const { flowId, code } = await start(h, ada.session, "wanted@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.events).toEqual([]);
    // The code was spent on the attempt: the owner starts again rather than retrying it.
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("replaces the address and marks it verified, tells the old address, records both hashes, and keeps the session signed in", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(1000);
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada-new@korbat.local", h.now()]);
    expect(h.mailer.sent.map((m) => [m.to, m.template, m.data])).toEqual([
      ["ada-new@korbat.local", "email_change_code", { code }],
      ["ada@korbat.local", "email_changed", { email: "ada-new@korbat.local", revertUrl: expect.stringMatching(REVERT_URL) }],
    ]);
    const key = h.deps.config.authHmacKey;
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "email_changed", deviceId: ada.session.deviceId, metadata: { from: emailHash(key, "ada@korbat.local"), to: emailHash(key, "ada-new@korbat.local") } },
    ]);
    expect(h.codes[0]!.consumedAt).toEqual(h.now());
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // No revocation tombstone was written for the session that made the change.
    expect(await h.kv.get(`sess:2:${ada.session.sessionId}`)).toBeNull();
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("the notice to the old address is best effort: a mail failure does not undo the change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.mailer.failing = true;
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
  });
});

describe("email change: the undo link sent to the old address", () => {
  test("the notice carries a link good for 24 hours, kept under its hashed token with the old address, the time of the change and the passkey behind the changing session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.advance(1000);
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const raw = (await h.kv.get(emailRevertKey(token)))!;
    expect(emailRevertKey(token)).toBe(`email-revert:${sha256Hex(token)}`);
    expect(JSON.parse(raw)).toEqual({ userId: ada.user.id, oldEmail: "ada@korbat.local", changedAt: h.now().getTime(), passkeyId: null });
    expect(raw).not.toContain(token);
    h.advance(EMAIL_REVERT_TTL_MS - 1);
    expect(await h.kv.get(emailRevertKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(emailRevertKey(token))).toBeNull();

    // A session a passkey started names it, so the undo removes that passkey whatever its age.
    const bob = h.user("bob@korbat.local");
    const passkeyId = h.passkey(bob.user.id);
    const byPasskey = h.session(bob.user.id, { passkeyId });
    const bobsToken = (await change(h, byPasskey, "bob-new@korbat.local"))!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(bobsToken)))!)).toMatchObject({ userId: bob.user.id, passkeyId });
  });

  test("the link moves the account back, signs every session out, records the undo with both hashes, tells the old address and nobody else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The session an attacker got hold of, which makes the change, and the owner's own, which the change leaves alone.
    const owners = h.session(ada.user.id);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    const changedAt = h.now();
    // What the undo hands the lockdown's one transaction: the change as its anchor, and the event to record with it.
    const handed: Parameters<AuthRepo["lockDown"]>[] = [];
    const lockDown = h.deps.repo.lockDown;
    h.deps.repo.lockDown = async (...args) => {
      handed.push(args);
      return lockDown(...args);
    };
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);

    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada@korbat.local", h.now()]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    const key = h.deps.config.authHmacKey;
    const hashes = { from: emailHash(key, "attacker@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true };
    expect(handed).toEqual([
      [
        ada.user.id,
        { now: h.now(), since: new Date(changedAt.getTime() - LOCKDOWN_LOOKBACK_MS), passkeyIds: [], event: { type: "email_changed", deviceId: null, ipHash: h.ctx.ipHash, metadata: hashes } },
      ],
    ]);
    expect(h.events.at(-1)).toEqual({ userId: ada.user.id, type: "email_changed", deviceId: null, metadata: { ...hashes, ...NOTHING_ELSE } });
    // The address the account was moved to is told nothing; the old one gets a short note.
    expect(h.mailer.sent.filter((m) => m.to === "attacker@korbat.local").map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: "ada@korbat.local", template: "email_change_reverted", data: {} });
    // The old address signs in again; the other one no longer belongs to any account.
    expect((await h.deps.repo.findUserByEmail("ada@korbat.local"))?.id).toBe(ada.user.id);
    expect(await h.deps.repo.findUserByEmail("attacker@korbat.local")).toBeUndefined();
  });

  test("the undo also revokes every device of the account, so a sign-in on any of them counts as a new device again", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The device whoever made the change used, and the owner's own; another account's device is not touched.
    h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.devices.filter((d) => d.userId === bob.user.id).map((d) => d.revokedAt)).toEqual([null]);
  });

  test("the password goes whenever it was set, and two-factor turned on more than a day before the change stays", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The owner's own, from before: a password nobody can tell from one an attacker set, and two-factor from just outside the day the lockdown reaches back.
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    withTotp(h, ada.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS + 1);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: "v1:owner", totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect(h.events.at(-1)!.metadata).toMatchObject({ reverted: true, totpCleared: false, passwordCleared: true });
  });

  test("two-factor turned on within the day before the change, or after it, goes with it", async () => {
    const h = memoryFlowHarness();
    const before = h.user("before@korbat.local");
    // Exactly a day before the change: the first moment the lockdown reaches.
    withTotp(h, before.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const beforesToken = (await change(h, before.session, "attacker-1@korbat.local"))!;
    const after = h.user("after@korbat.local");
    const aftersToken = (await change(h, after.session, "attacker-2@korbat.local"))!;
    h.advance(1000);
    Object.assign(h.users.get(after.user.id)!, { totpSecretEnc: "v1:attacker", totpEnabledAt: h.now(), totpLastStep: 42, recoveryCodesHash: ["attacker-code"] });
    h.advance(1000);
    await revertEmailChange(h.deps, { token: beforesToken }, h.ctx);
    await revertEmailChange(h.deps, { token: aftersToken }, h.ctx);
    for (const account of [before, after]) {
      expect(h.users.get(account.user.id), account.user.email).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    }
    expect(h.events.filter((e) => e.metadata.reverted).map((e) => [e.userId, e.metadata.totpCleared])).toEqual([
      [before.user.id, true],
      [after.user.id, true],
    ]);
  });

  test("a passkey added since the day before the change goes, an older one stays, and the passkey that started the changing session goes whatever its age", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const older = h.passkey(ada.user.id, new Date(h.now().getTime() - 1));
    const ownSince = h.passkey(ada.user.id, h.now());
    const named = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const changing = h.session(ada.user.id, { passkeyId: named });
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const token = (await change(h, changing, "attacker@korbat.local"))!;
    h.advance(HOUR);
    const added = h.passkey(ada.user.id);
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.passkeys.map((p) => p.id)).toEqual([older]);
    const removed = h.events.at(-1)!.metadata.passkeysRemoved as string[];
    expect([...removed].sort()).toEqual([ownSince, named, added].sort());
  });

  test("a used link and an expired one are refused and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    await revertEmailChange(h.deps, { token }, h.ctx);
    const used = await failure(revertEmailChange(h.deps, { token }, h.ctx));
    expect(used).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });

    const bob = h.user("bob@korbat.local");
    const late = (await change(h, bob.session, "bob-new@korbat.local"))!;
    h.advance(EMAIL_REVERT_TTL_MS);
    expect(await failure(revertEmailChange(h.deps, { token: late }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(bob.user.id)!.email).toBe("bob-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.mailer.sent.filter((m) => m.template === "email_change_reverted").map((m) => m.to)).toEqual(["ada@korbat.local"]);
  });

  test("the link of an account deleted since is refused before it is spent, and nothing is restored", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const stored = await h.kv.get(emailRevertKey(token));
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    const eventsBefore = h.events.length;
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The checks come first and the link is taken only just before the address is restored: a refusal leaves it to run out with its day.
    expect(await h.kv.get(emailRevertKey(token))).toBe(stored);
  });

  test("two uses of one link at once act once: the address is restored and the lockdown recorded once, and the other use is refused", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(MINUTE);
    const outcomes = await Promise.allSettled([revertEmailChange(h.deps, { token }, h.ctx), revertEmailChange(h.deps, { token }, { ...h.ctx, ipHash: randomToken() })]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!.reason).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", emailVerifiedAt: h.now() });
    expect(h.events.filter((e) => e.metadata.reverted)).toHaveLength(1);
    expect(h.mailer.sent.filter((m) => m.template === "email_change_reverted").map((m) => m.to)).toEqual(["ada@korbat.local"]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("an old address that got another account meanwhile is email_in_use, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.user("Ada@korbat.local");
    const eventsBefore = h.events.length;
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The unique index on the address decides at the restore itself, for which the link was already taken: this one refusal spends it.
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("allows 10 tries an hour per address, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    for (let i = 0; i < EMAIL_REVERTS_PER_IP_PER_HOUR; i++) {
      expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Another address has its own window.
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
  });

  test("an undo whose lockdown fails leaves the address restored and nothing else changed: no session revoked, the password in place, no undo recorded and no note sent", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "set-since", h.now());
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(MINUTE);
    h.faults.add("lockDown");
    await expect(revertEmailChange(h.deps, { token }, h.ctx)).rejects.toThrow(/midway/);
    // The address went back before the lockdown began; the lockdown is one transaction, so none of it landed.
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: "set-since" });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.events.map((e) => [e.type, e.metadata.reverted])).toEqual([["email_changed", undefined]]);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
    // The link was spent by the attempt.
    h.faults.clear();
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
  });

  test("a second change while the link is out sends no second link, so whoever made it holds none; the one link undoes both and clears what was set since the first", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "middle@korbat.local"))!;
    h.advance(MINUTE + 1);
    // Were the middle address sent a link to itself, an attacker who made both changes could use it after the owner used theirs and take the account back.
    expect(await change(h, ada.session, "last@korbat.local")).toBeNull();
    const toMiddle = h.mailer.sent.at(-1)!;
    expect([toMiddle.to, toMiddle.data]).toEqual(["middle@korbat.local", { email: "last@korbat.local" }]);
    await h.deps.repo.setPasswordHash(ada.user.id, "attacker-password", h.now());
    h.advance(1000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    const key = h.deps.config.authHmacKey;
    expect(h.events.at(-1)!.metadata).toEqual({ from: emailHash(key, "last@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true, ...NOTHING_ELSE });

    // Once the link was used, the next change sends one again.
    const owner = h.session(ada.user.id);
    h.advance(HOUR);
    expect(await change(h, owner, "ada-2@korbat.local")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the note to the old address is best effort: a mail failure does not undo the revert", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.mailer.failing = true;
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed", "email_changed"]);
  });
});
