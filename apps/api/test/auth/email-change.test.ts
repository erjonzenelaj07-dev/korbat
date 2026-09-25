import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey } from "../../src/auth/flows/email";
import { EMAIL_CHANGE_STARTS_PER_HOUR, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
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

/** Starts a change and returns its flow id with the code from the mail to the new address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startEmailChange(h.deps, session, { email }, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
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
      ["ada@korbat.local", "email_changed", { email: "ada-new@korbat.local" }],
    ]);
    const key = h.deps.config.authHmacKey;
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "email_changed", deviceId: ada.session.deviceId, metadata: { from: emailHash(key, "ada@korbat.local"), to: emailHash(key, "ada-new@korbat.local") } },
    ]);
    expect(h.codes[0]!.consumedAt).toEqual(h.now());
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // No revocation tombstone was written for the session that made the change.
    expect(await h.kv.get(`sess:${ada.session.sessionId}`)).toBeNull();
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
