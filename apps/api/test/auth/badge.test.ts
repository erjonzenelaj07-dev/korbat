import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import {
  BADGE_STARTS_PER_DAY,
  BADGE_STARTS_PER_HOUR,
  BADGE_STARTS_PER_IP_PER_HOUR,
  badgeAttemptsKey,
  badgeKey,
  removeBadge,
  startBadge,
  verifyBadge,
  type PendingBadge,
} from "../../src/auth/flows/badge";
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

/** The development provider with every call counted, so a test can tell how many requests reached it. */
function counting(): { provider: VerificationProvider; calls: { start: number; check: number } } {
  const inner = devProvider();
  const calls = { start: 0, check: 0 };
  return {
    calls,
    provider: {
      start: async (phone) => {
        calls.start += 1;
        return inner.start(phone);
      },
      check: async (reference, code) => {
        calls.check += 1;
        return inner.check(reference, code);
      },
    },
  };
}

const pending = async (h: MemoryFlowHarness, flowId: string) => JSON.parse((await h.kv.get(badgeKey(flowId)))!) as PendingBadge;

/** Starts a verification for the number and returns its flow id. */
async function start(h: MemoryFlowHarness, session: Session, phone = PHONE): Promise<string> {
  return (await startBadge(h.deps, session, { phone }, h.ctx)).flowId;
}

/** Four wrong codes and then the right one: the right one is the fifth attempt, the last the flow allows. */
async function fourWrongThenRight(h: MemoryFlowHarness, session: Session, flowId: string): Promise<void> {
  for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
    expect(await failure(verifyBadge(h.deps, session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
  }
  expect(await verifyBadge(h.deps, session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
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
    expect(await h.kv.get(`rl:badge-start:ip:${h.ctx.ipHash}`)).toBe("1");
    expect(await h.kv.get("rl:badge-start:all")).toBe("1");
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 10 starts an hour from one address, whatever the accounts and numbers, then rate_limited before the provider is asked", async () => {
    const h = memoryFlowHarness();
    const { provider, calls } = counting();
    h.deps.verify = provider;
    // Four accounts, each within its own three an hour, and a new number every time: only the address is shared.
    const accounts = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    for (let i = 0; i < BADGE_STARTS_PER_IP_PER_HOUR; i++) await start(h, accounts[Math.floor(i / BADGE_STARTS_PER_HOUR)]!.session, `+4479111234${String(i).padStart(2, "0")}`);
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR);
    const refused = await failure(start(h, accounts[3]!.session, "+447911123499"));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR);
    // Another address has a window of its own, and this one opens again after the hour.
    await startBadge(h.deps, accounts[3]!.session, { phone: "+447911123498" }, { ...h.ctx, ipHash: randomToken() });
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR + 1);
    h.advance(HOUR + 1);
    await start(h, accounts[0]!.session, "+447911123497");
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR + 2);
  });

  test("allows 200 starts a day on the whole instance, then rate_limited for a day before the provider is asked", async () => {
    const h = memoryFlowHarness();
    const { provider, calls } = counting();
    h.deps.verify = provider;
    // Every start from a fresh account, address and number, so only the instance-wide ceiling is shared.
    const fresh = (i: number) => ({ session: h.user(`crowd-${i}@korbat.local`).session, ctx: { ...h.ctx, ipHash: randomToken() }, phone: `+3361${String(i).padStart(7, "0")}` });
    for (let i = 0; i < BADGE_STARTS_PER_DAY; i++) {
      const { session, ctx, phone } = fresh(i);
      await startBadge(h.deps, session, { phone }, ctx);
    }
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY);
    const next = fresh(BADGE_STARTS_PER_DAY);
    const refused = await failure(startBadge(h.deps, next.session, { phone: next.phone }, next.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (24 * HOUR) / 1000 });
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY);
    // Still closed an hour later, when every per-account, per-address and per-number window has passed; open again after the day.
    h.advance(HOUR + 1);
    expect(await failure(startBadge(h.deps, next.session, { phone: next.phone }, next.ctx))).toMatchObject({ code: "rate_limited" });
    h.advance(23 * HOUR);
    await startBadge(h.deps, next.session, { phone: next.phone }, next.ctx);
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY + 1);
  });

  test("a start refused by the account's own limit does not count against the address or the instance", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < BADGE_STARTS_PER_HOUR; i++) await start(h, ada.session, `+44791112345${i}`);
    for (let i = 0; i < 5; i++) expect(await failure(start(h, ada.session, "+447911123459"))).toMatchObject({ code: "rate_limited" });
    // One account cannot use up the address's or the instance's allowance with starts it was never going to get.
    expect(await h.kv.get(`rl:badge-start:ip:${h.ctx.ipHash}`)).toBe(String(BADGE_STARTS_PER_HOUR));
    expect(await h.kv.get("rl:badge-start:all")).toBe(String(BADGE_STARTS_PER_HOUR));
  });
});

describe("badge: the verification step", () => {
  test("a wrong code is invalid_code and leaves the pending verification as it was; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    const before = await pending(h, flowId);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code", status: 400 });
    // The attempt is counted in a counter of its own; the state is never written back.
    expect(await pending(h, flowId)).toEqual(before);
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBe("1");
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("the right code after four wrong ones succeeds", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await fourWrongThenRight(h, ada.session, await start(h, ada.session));
    expect(h.users.get(ada.user.id)!.phoneHash).toBe(phoneHash(h.deps.config.authHmacKey, PHONE));
  });

  test("ten verifications at once with wrong codes: at most five reach the provider, the rest are too_many_attempts", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { provider, calls } = counting();
    h.deps.verify = provider;
    const flowId = await start(h, ada.session);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))));
    expect(calls.check).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
    expect(outcomes.filter((err) => err.code === "invalid_code")).toHaveLength(calls.check);
    expect(outcomes.filter((err) => err.code === "too_many_attempts")).toHaveLength(10 - calls.check);
    // Whatever order they ran in, the flow is spent: even the right code is refused now.
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(calls.check).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
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
    for (let i = 0; i < 10; i++) {
      expect(await failure(verifyBadge(h.deps, bob.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    }
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
    const unknown = randomToken();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId: unknown, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(unknown))).toBeNull();
    // All five of the owner's attempts are still there.
    await fourWrongThenRight(h, ada.session, flowId);
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
  });

  test("an expired flow is invalid_code and counts no attempt, even while the store still holds its state", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    // A straggler: the state outlives its ten minutes in the store (Redis expires keys lazily), and the flow still treats it as gone.
    const state = await pending(h, flowId);
    await h.kv.set(badgeKey(flowId), JSON.stringify(state), HOUR);
    h.advance(CODE_TTL_MS);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBeNull();
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.advance(1);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBeNull();
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
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.deps.verify = devProvider();
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("an attempt the provider could not answer still counts: after it and four wrong codes the right one is too_many_attempts", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.deps.verify = unreachable;
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "verify_unavailable" });
    h.deps.verify = devProvider();
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
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
    // Back on, the flow still has all five attempts.
    h.deps.verify = devProvider();
    await fourWrongThenRight(h, ada.session, flowId);
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

describe("badge: a suspended account (3e design, sections 7.2 and 7.3)", () => {
  test("the start is refused account_suspended before any limit is counted or any code is texted", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const provider = counting();
    h.deps.verify = provider.provider;
    h.suspended.add(ada.user.id);
    expect(await failure(start(h, ada.session))).toMatchObject({ code: "account_suspended", status: 403 });
    expect(provider.calls.start).toBe(0);
    expect(await h.kv.get(`rl:badge-start:${ada.user.id}`)).toBeNull();
  });

  test("a code that is right after the suspension began is refused: the phone hash written a moment before is cleared again, nobody is told and nothing is recorded", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.suspended.add(ada.user.id);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "account_suspended", status: 403 });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.verified.has(ada.user.id)).toBe(false);
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    // Removing a badge stays open to a suspended account: it withdraws a phone hash.
    await removeBadge(h.deps, ada.session);
    expect(h.verified.get(ada.user.id)).toBeNull();
  });
});
