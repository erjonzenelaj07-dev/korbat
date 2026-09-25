import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { BADGE_STARTS_PER_HOUR, badgeKey, removeBadge, startBadge, verifyBadge, type PendingBadge } from "../../src/auth/flows/badge";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS } from "../../src/auth/flows/email";
import { phoneHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import type { Session } from "../../src/auth/sessions";
import { DEV_CODE, devProvider } from "../../src/auth/verify/dev";
import { VerifyUnavailable, type VerificationProvider } from "../../src/auth/verify/provider";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const PHONE = "+447911123456";
const OTHER_PHONE = "+33612345678";
const WRONG = "123456";

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

/** A provider whose check answers as told, for the paths the development provider never takes. */
function answering(outcome: "code_expired" | "invalid_code" | "verified"): VerificationProvider {
  return { start: async () => ({ reference: "fixed-reference" }), check: async () => outcome };
}

/** A provider whose gateway is down. */
const unreachable: VerificationProvider = {
  start: async () => {
    throw new VerifyUnavailable("the gateway answered 503");
  },
  check: async () => {
    throw new VerifyUnavailable("the gateway timed out");
  },
};

const pending = async (h: MemoryFlowHarness, flowId: string) => JSON.parse((await h.kv.get(badgeKey(flowId)))!) as PendingBadge;

/** Starts a verification for the number and returns its flow id. */
async function start(h: MemoryFlowHarness, session: Session, phone = PHONE): Promise<string> {
  return (await startBadge(h.deps, session, { phone }, h.ctx)).flowId;
}

/** Starts and verifies with the development code, so the account holds the badge for the number. */
async function earn(h: MemoryFlowHarness, session: Session, phone = PHONE): Promise<string> {
  const flowId = await start(h, session, phone);
  expect(await verifyBadge(h.deps, session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  return flowId;
}

describe("badge: the start step", () => {
  test("is badge_unavailable, before any limit is counted, when no provider is configured", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.deps.verify = null;
    expect(await failure(startBadge(h.deps, ada.session, { phone: PHONE }, h.ctx))).toMatchObject({ code: "badge_unavailable", status: 404 });
    expect(await h.kv.get(`rl:badge-start:${ada.user.id}`)).toBeNull();
    expect(await h.kv.get(`rl:badge-start:phone:${phoneHash(h.deps.config.authHmacKey, PHONE)}`)).toBeNull();
  });

  test("asks the provider for a code and keeps the pending verification, under the hashed flow id and without the number, for 10 minutes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId } = await startBadge(h.deps, ada.session, { phone: PHONE }, h.ctx);
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = (await h.kv.get(badgeKey(flowId)))!;
    expect(raw).not.toContain(PHONE);
    expect(JSON.parse(raw)).toEqual({
      userId: ada.user.id,
      phoneHash: phoneHash(h.deps.config.authHmacKey, PHONE),
      reference: expect.any(String),
      attempts: 0,
      expiresAt: h.now().getTime() + CODE_TTL_MS,
    });
    // Nothing about the account changes until the code is right, and nobody is told.
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.has(ada.user.id)).toBe(false);
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    h.advance(CODE_TTL_MS + 1);
    expect(await h.kv.get(badgeKey(flowId))).toBeNull();
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < BADGE_STARTS_PER_HOUR; i++) await start(h, ada.session, `+44791112345${i}`);
    expect(await failure(start(h, ada.session, "+447911123459"))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await start(h, bob.session, "+447911123459");
    h.advance(HOUR + 1);
    await start(h, ada.session, "+447911123459");
  });

  test("allows 3 starts an hour per number, whoever asks, then rate_limited until the window passes", async () => {
    const h = memoryFlowHarness();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    await start(h, a!.session);
    await start(h, b!.session);
    await start(h, c!.session);
    expect(await h.kv.get(`rl:badge-start:phone:${phoneHash(h.deps.config.authHmacKey, PHONE)}`)).toBe("3");
    expect(await failure(start(h, d!.session))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Another number is not affected by that one's window.
    await start(h, d!.session, OTHER_PHONE);
    h.advance(HOUR + 1);
    await start(h, d!.session);
  });

  test("an unreachable provider is verify_unavailable, after the limits were counted, and nobody is told", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.deps.verify = unreachable;
    expect(await failure(startBadge(h.deps, ada.session, { phone: PHONE }, h.ctx))).toMatchObject({ code: "verify_unavailable", status: 503 });
    expect(await h.kv.get(`rl:badge-start:${ada.user.id}`)).toBe("1");
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });
});

describe("badge: the verification step", () => {
  test("a wrong code is invalid_code and counts an attempt; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await pending(h, flowId)).toMatchObject({ attempts: 1, expiresAt: h.now().getTime() + CODE_TTL_MS });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("counting an attempt keeps the flow's original expiry", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.advance(CODE_TTL_MS - 1000);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
    h.advance(1001);
    // The flow ends with its ten minutes, not ten minutes after the last attempt.
    expect(await h.kv.get(badgeKey(flowId))).toBeNull();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
  });

  test("five wrong codes exhaust the flow: too_many_attempts even for the right one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.has(ada.user.id)).toBe(false);
  });

  test("a flow another account started is invalid_code for this one and costs its owner no attempt; so is an unknown flow id", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const flowId = await start(h, ada.session);
    expect(await failure(verifyBadge(h.deps, bob.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect((await pending(h, flowId)).attempts).toBe(0);
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId: randomToken(), code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
  });

  test("a code the provider reports expired is code_expired and ends the flow", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.deps.verify = answering("code_expired");
    const flowId = await start(h, ada.session);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "code_expired", status: 400 });
    expect(await h.kv.get(badgeKey(flowId))).toBeNull();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code" });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
  });

  test("an unreachable provider is verify_unavailable; the flow stays for a retry, its attempt counted", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.deps.verify = unreachable;
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "verify_unavailable", status: 503 });
    expect((await pending(h, flowId)).attempts).toBe(1);
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.deps.verify = devProvider();
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("a number another account verified is phone_in_use only now, and the flow is spent", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    await earn(h, bob.session);
    const flowId = await start(h, ada.session);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "phone_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.has(ada.user.id)).toBe(false);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["bob@korbat.local"]);
    expect(h.events.map((e) => e.userId)).toEqual([bob.user.id]);
    // The provider accepted the code, so the flow is over: the owner starts again with another number.
    expect(await h.kv.get(badgeKey(flowId))).toBeNull();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code" });
    // The account that holds the number keeps its badge.
    expect(h.users.get(bob.user.id)!.phoneHash).toBe(phoneHash(h.deps.config.authHmacKey, PHONE));
  });

  test("writes the hash and the badge, forgets the flow, tells the account and records the event, all without the number", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.advance(1000);
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
    expect(h.users.get(ada.user.id)!.phoneHash).toBe(phoneHash(h.deps.config.authHmacKey, PHONE));
    expect(h.verified.get(ada.user.id)).toEqual(h.now());
    expect(await h.kv.get(badgeKey(flowId))).toBeNull();
    expect(h.mailer.sent).toEqual([{ to: "ada@korbat.local", template: "badge_verified", data: {} }]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "badge_verified", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(JSON.stringify([h.mailer.sent, h.events])).not.toContain(PHONE);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code" });
  });

  test("verifying another number replaces the account's one hash, and the number it holds is no conflict", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await earn(h, ada.session);
    await earn(h, ada.session, OTHER_PHONE);
    expect(h.users.get(ada.user.id)!.phoneHash).toBe(phoneHash(h.deps.config.authHmacKey, OTHER_PHONE));
    await earn(h, ada.session, OTHER_PHONE);
    expect(h.events.map((e) => e.type)).toEqual(["badge_verified", "badge_verified", "badge_verified"]);
  });

  test("the notice is best effort: a mail failure does not undo the badge", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.mailer.failing = true;
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
    expect(h.users.get(ada.user.id)!.phoneHash).not.toBeNull();
    expect(h.events.map((e) => e.type)).toEqual(["badge_verified"]);
    expect(h.mailer.sent).toEqual([]);
  });

  test("is badge_unavailable, without counting an attempt, when no provider is configured", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.deps.verify = null;
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "badge_unavailable", status: 404 });
    expect((await pending(h, flowId)).attempts).toBe(0);
  });
});

describe("badge: removal", () => {
  test("clears the hash and the badge, tells the account and records the event; without a badge it is a silent no-op", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await removeBadge(h.deps, ada.session);
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    await earn(h, ada.session);
    h.advance(1000);
    await removeBadge(h.deps, ada.session);
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.get(ada.user.id)).toBeNull();
    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([
      ["ada@korbat.local", "badge_verified"],
      ["ada@korbat.local", "badge_removed"],
    ]);
    expect(h.events.map((e) => [e.type, e.deviceId, e.metadata])).toEqual([
      ["badge_verified", ada.session.deviceId, {}],
      ["badge_removed", ada.session.deviceId, {}],
    ]);
    await removeBadge(h.deps, ada.session);
    expect(h.mailer.sent).toHaveLength(2);
    expect(h.events).toHaveLength(2);
    // The number is free for another account once the badge is gone.
    const bob = h.user("bob@korbat.local");
    await earn(h, bob.session);
  });

  test("works without a provider, and the notice is best effort", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await earn(h, ada.session);
    h.deps.verify = null;
    h.mailer.failing = true;
    await removeBadge(h.deps, ada.session);
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.get(ada.user.id)).toBeNull();
    expect(h.events.map((e) => e.type)).toEqual(["badge_verified", "badge_removed"]);
  });
});
