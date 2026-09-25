import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { DELETE_STARTS_PER_HOUR, confirmDeletion, startDeletion } from "../../src/auth/flows/deletion";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey, startEmail } from "../../src/auth/flows/email";
import { passwordSignIn } from "../../src/auth/flows/password";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashPassword } from "../../src/auth/passwords";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

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

/** Starts a deletion and returns its flow id with the code from the mail to the account's address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startDeletion(h.deps, session, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

describe("account deletion: the start step", () => {
  test("mails a code to the account's own address, keeps the pending deletion under the hashed flow id, and changes nothing else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId } = await startDeletion(h.deps, ada.session, h.ctx);
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([["ada@korbat.local", "delete_account_code", ["code"]]]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([["ada@korbat.local", "delete_account", ada.user.id, h.ctx.ipHash, expiresAt, 0]]);
    expect(JSON.parse((await h.kv.get(flowKey(flowId)))!)).toEqual({ userId: ada.user.id });
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < DELETE_STARTS_PER_HOUR; i++) await startDeletion(h.deps, ada.session, h.ctx);
    const refused = await failure(startDeletion(h.deps, ada.session, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(DELETE_STARTS_PER_HOUR);
    expect(await h.kv.get(`rl:delete-start:${ada.user.id}`)).toBe(String(DELETE_STARTS_PER_HOUR + 1));
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startDeletion(h.deps, bob.session, h.ctx);
    h.advance(HOUR + 1);
    await startDeletion(h.deps, ada.session, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["ada@korbat.local", "ada@korbat.local", "ada@korbat.local", "bob@korbat.local", "ada@korbat.local"]);
  });
});

describe("account deletion: the confirmation", () => {
  test("the typed handle must be the account's own, in any case, and is checked before the code, so a slip costs no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local", "ada_l");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const mismatch = await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada_" }));
    expect(mismatch).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events).toEqual([]);
    // The handle compares case-insensitively: what the owner types may differ in case from what they chose.
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ADA_L" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a wrong code is invalid_code and counts an attempt; another account's flow, an unknown flow and an expired code are refused; five wrong codes exhaust it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    // A flow another account started is no code at all for this one, settled before an attempt is counted.
    expect(await failure(confirmDeletion(h.deps, bob.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: randomToken(), code, handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "too_many_attempts", status: 429 });

    const again = await start(h, ada.session, "ada@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" }))).toMatchObject({ code: "code_expired", status: 400 });

    for (const user of [ada, bob]) expect(h.users.get(user.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "delete_account_code"]);
    expect(h.events).toEqual([]);
  });

  test("tells the address, marks the account deleted, revokes every session with a tombstone, deletes devices and codes, records the event, and spends the code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    // A sign-in code out for ada, and one for bob: the account's codes go, nobody else's.
    for (const user of [ada, bob]) {
      await h.deps.repo.createEmailCode({ flowId: randomToken(), email: user.user.email, userId: user.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    }
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.advance(1000);
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });

    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([
      ["ada@korbat.local", "delete_account_code"],
      ["ada@korbat.local", "account_deleted"],
    ]);
    const stored = h.users.get(ada.user.id)!;
    expect(stored.deletedAt).toEqual(h.now());
    // The row is anonymised by the purge, not here: the address and the credentials are still in place for the moment.
    expect([stored.email, stored.purgedAt]).toEqual(["ada@korbat.local", null]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes.map((c) => [c.userId, c.purpose])).toEqual([[bob.user.id, "login"]]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "account_deleted", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // The account is gone for every purpose: the same session cannot confirm again, whatever it sends.
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await failure(startDeletion(h.deps, ada.session, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
  });

  test("the notice is best effort: a mail failure does not stop the deletion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.mailer.failing = true;
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
  });
});

describe("a deleted account is invisible to sign-in", () => {
  test("the sign-in start treats the address as unknown, in the same shape and time; password sign-in is invalid_credentials and records no failure", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const password = "correct horse battery staple";
    h.users.get(ada.user.id)!.passwordHash = await hashPassword(password);
    const device = { deviceId: randomToken(), platform: "web" as const };

    // While the account lives: the start sends a sign-in code, and a wrong password is a recorded failure.
    await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code"]);
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password: "not it", turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);

    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);

    // Past the address's cooldown: the start now answers as for an address without an account, in the same shape and time.
    h.advance(MINUTE + 1);
    const startedAt = Date.now();
    const started = await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect(h.codes.map((c) => [c.purpose, c.userId])).toEqual([["signup", null]]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code", "delete_account_code", "account_deleted", "sign_up_code"]);
    // The right password no longer signs in, and the failure counter and the event log do not move: there is no account to record against.
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password, turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);
  });
});
