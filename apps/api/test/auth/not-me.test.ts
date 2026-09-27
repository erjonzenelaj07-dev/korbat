import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { notMe } from "../../src/auth/flows/not-me";
import { NOT_ME_TTL_MS, notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
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

/** A link as the new-device alert stores it (or as an older alert did, when given less), answering its token. */
async function link(h: MemoryFlowHarness, stored: NotMeToken | string): Promise<string> {
  const token = randomToken();
  await h.kv.set(notMeKey(token), typeof stored === "string" ? stored : JSON.stringify(stored), NOT_ME_TTL_MS);
  return token;
}

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

describe("'This wasn't me' on the lockdown (1c design, section 7.6)", () => {
  test("the link locks the account down anchored at the sign-in it announced: everything set up since the day before goes, and the passkey it names whatever its age", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const owners = h.session(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    // The alerted sign-in was two hours ago; the rows around its anchor are placed in the past, so the link is still within its day.
    const signedInAt = h.now().getTime() - 2 * HOUR;
    const since = signedInAt - LOCKDOWN_LOOKBACK_MS;
    const old = h.passkey(ada.user.id, new Date(since - 1));
    const named = h.passkey(ada.user.id, new Date(since - DAY));
    const recent = h.passkey(ada.user.id, new Date(since));
    withTotp(h, ada.user.id, new Date(signedInAt - HOUR));
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt, passkeyId: named, sentTo: emailHash(key, "Ada@korbat.local") });
    await notMe(h.deps, { token }, h.ctx);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:2:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect(h.passkeys.map((p) => p.id)).toEqual([old]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: expect.arrayContaining([named, recent]), totpCleared: true, passwordCleared: true } },
    ]);
    expect(h.events[0]!.metadata.passkeysRemoved).toHaveLength(2);
    // The link worked once.
    expect(await failure(notMe(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(1);
  });

  test("a link from before the deploy, without a sign-in time or as the bare user id, is anchored a day before it is used and checks no address", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    // Anchored at the moment of use minus the link's 24-hour life, the lockdown reaches two days back: more than a link with its sign-in time would, never less.
    const since = h.now().getTime() - NOT_ME_TTL_MS - LOCKDOWN_LOOKBACK_MS;
    const older = h.passkey(ada.user.id, new Date(since - 1));
    const inReach = h.passkey(ada.user.id, new Date(since));
    withTotp(h, ada.user.id, new Date(since));
    const bobsOlder = h.passkey(bob.user.id, new Date(since - 1));
    withTotp(h, bob.user.id, new Date(since + HOUR));
    const legacy = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId });
    const bare = await link(h, bob.user.id);
    // Both addresses changed since the alerts went out; a link without an address to check works regardless.
    await h.deps.repo.changeEmail(ada.user.id, "ada-moved@korbat.local", h.now());
    await h.deps.repo.changeEmail(bob.user.id, "bob-moved@korbat.local", h.now());

    await notMe(h.deps, { token: legacy }, h.ctx);
    expect(h.passkeys.filter((p) => p.userId === ada.user.id).map((p) => p.id)).toEqual([older]);
    expect(h.users.get(ada.user.id)).toMatchObject({ totpEnabledAt: null, passwordHash: null });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);

    await notMe(h.deps, { token: bare }, h.ctx);
    expect(h.passkeys.filter((p) => p.userId === bob.user.id).map((p) => p.id)).toEqual([bobsOlder]);
    expect(h.users.get(bob.user.id)).toMatchObject({ totpEnabledAt: null });
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [inReach], totpCleared: true, passwordCleared: true } },
      { userId: bob.user.id, type: "not_me", deviceId: null, metadata: { passkeysRemoved: [], totpCleared: true, passwordCleared: true } },
    ]);
  });

  test("while the account's address differs from the one the alert went to, the link does nothing but refuse and is not spent; once the address is back it works, once; a change of case alone is no change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    const added = h.passkey(ada.user.id);
    const key = h.deps.config.authHmacKey;
    const signedInAt = h.now().getTime();
    const stale = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt, passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    const stored = await h.kv.get(notMeKey(stale));
    await h.deps.repo.changeEmail(ada.user.id, "attacker@korbat.local", h.now());
    h.advance(HOUR);
    for (let i = 0; i < 2; i++) expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "attacker@korbat.local", passwordHash: "owner-password" });
    expect(h.passkeys).toHaveLength(1);
    expect(h.events).toEqual([]);
    // Refused, not spent: the link is in the store as it was, for the rest of its day.
    expect(await h.kv.get(notMeKey(stale))).toBe(stored);
    // The address is the owner's again, as the email undo leaves it: the same link now runs the lockdown, anchored at its sign-in.
    await h.deps.repo.changeEmail(ada.user.id, "ada@korbat.local", h.now());
    h.advance(HOUR);
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    expect(h.passkeys).toEqual([]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [added], totpCleared: false, passwordCleared: true } }]);
    // Once: it is spent now.
    expect(await h.kv.get(notMeKey(stale))).toBeNull();
    expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toHaveLength(1);

    const bob = h.user("bob@korbat.local");
    const fine = await link(h, { userId: bob.user.id, deviceId: bob.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "bob@korbat.local") });
    await h.deps.repo.changeEmail(bob.user.id, "Bob@korbat.local", h.now());
    await notMe(h.deps, { token: fine }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("two uses of one link at once act once: one runs the lockdown, the other is refused", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    const outcomes = await Promise.allSettled([notMe(h.deps, { token }, h.ctx), notMe(h.deps, { token }, { ...h.ctx, ipHash: randomToken() })]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!.reason).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.events).toEqual([{ userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [], totpCleared: false, passwordCleared: true } }]);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([h.now()]);
  });

  test("a link of an account that is gone, an unknown link and a used one are refused alike, and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const key = h.deps.config.authHmacKey;
    const token = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    expect(await failure(notMe(h.deps, { token }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toEqual([]);
  });

  test("allows 10 tries an hour per address, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    for (let i = 0; i < 10; i++) expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    expect(await failure(notMe(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(await failure(notMe(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
  });
});
