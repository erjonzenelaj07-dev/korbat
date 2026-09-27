import { describe, expect, test } from "vitest";
import { LOCKDOWN_LOOKBACK_MS, lockdown } from "../../src/auth/flows/lockdown";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it, with the harness's own values. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

describe("the lockdown (1c design, sections 2 and 7.6)", () => {
  test("revokes every session and device with tombstones, clears the password, and records the caller's event with what it did", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.advance(HOUR);
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), caller: { type: "not_me", deviceId: ada.session.deviceId }, ctx: h.ctx });
    expect(report).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, passwordChangedAt: h.now() });
    // Another account is not touched.
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === bob.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "not_me", deviceId: ada.session.deviceId, metadata: { passkeysRemoved: [], totpCleared: false, passwordCleared: true } },
    ]);
  });

  test("removes the passkeys created at or after the day before the anchor, and any it is told to name, and leaves the rest and other accounts' alone", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const since = new Date(h.now().getTime() + 6 * HOUR);
    const anchor = new Date(since.getTime() + LOCKDOWN_LOOKBACK_MS);
    const kept = [h.passkey(ada.user.id, new Date(since.getTime() - 1)), h.passkey(bob.user.id, since), h.passkey(bob.user.id, new Date(anchor.getTime() + HOUR))];
    // Old enough to stay, but named by the caller (the passkey that started the session in question).
    const named = h.passkey(ada.user.id, new Date(since.getTime() - 3 * DAY));
    const removed = [h.passkey(ada.user.id, since), h.passkey(ada.user.id, new Date(anchor.getTime() + HOUR)), named];
    h.advance(3 * DAY);
    const report = await lockdown(h.deps, { userId: ada.user.id, anchor, passkeyIds: [named], caller: { type: "not_me" }, ctx: h.ctx });
    expect([...report.passkeysRemoved].sort()).toEqual([...removed].sort());
    expect(h.passkeys.map((p) => p.id).sort()).toEqual([...kept].sort());
    expect(h.events.at(-1)!.metadata.passkeysRemoved).toEqual(report.passkeysRemoved);
    // A named passkey of another account is not the caller's to remove.
    const stray = h.passkey(bob.user.id, new Date(since.getTime() - 3 * DAY));
    const again = await lockdown(h.deps, { userId: ada.user.id, anchor, passkeyIds: [stray], caller: { type: "not_me" }, ctx: h.ctx });
    expect(again.passkeysRemoved).toEqual([]);
    expect(h.passkeys.map((p) => p.id)).toContain(stray);
  });

  test("turns two-factor off when it was enabled at or after the day before the anchor, and keeps it when it was enabled earlier", async () => {
    const h = memoryFlowHarness();
    const since = h.now();
    const anchor = new Date(since.getTime() + LOCKDOWN_LOOKBACK_MS);
    const earlier = h.user("earlier@korbat.local");
    withTotp(h, earlier.user.id, new Date(since.getTime() - 1));
    const atSince = h.user("at-since@korbat.local");
    withTotp(h, atSince.user.id, since);
    const later = h.user("later@korbat.local");
    withTotp(h, later.user.id, new Date(anchor.getTime() + MINUTE));
    const never = h.user("never@korbat.local");
    h.advance(2 * DAY);
    const run = (userId: string) => lockdown(h.deps, { userId, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect((await run(earlier.user.id)).totpCleared).toBe(false);
    expect(h.users.get(earlier.user.id)).toMatchObject({ totpSecretEnc: "v1:owner", totpEnabledAt: new Date(since.getTime() - 1), totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect((await run(atSince.user.id)).totpCleared).toBe(true);
    expect(h.users.get(atSince.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    expect((await run(later.user.id)).totpCleared).toBe(true);
    expect(h.users.get(later.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null });
    expect((await run(never.user.id)).totpCleared).toBe(false);
    expect(h.events.map((e) => [e.userId, e.metadata.totpCleared])).toEqual([
      [earlier.user.id, false],
      [atSince.user.id, true],
      [later.user.id, true],
      [never.user.id, false],
    ]);
  });

  test("the caller's own metadata is kept beside the lockdown's, with the request's address hash and no device unless the caller names one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const appended: Parameters<AuthRepo["appendEvent"]>[0][] = [];
    const append = h.deps.repo.appendEvent;
    h.deps.repo.appendEvent = async (input) => {
      appended.push(input);
      await append(input);
    };
    await lockdown(h.deps, { userId: ada.user.id, anchor: h.now(), caller: { type: "email_changed", metadata: { from: "a", to: "b", reverted: true } }, ctx: h.ctx });
    expect(appended).toEqual([
      {
        userId: ada.user.id,
        type: "email_changed",
        deviceId: null,
        ipHash: h.ctx.ipHash,
        metadata: { from: "a", to: "b", reverted: true, passkeysRemoved: [], totpCleared: false, passwordCleared: true },
      },
    ]);
  });

  test("run again, it changes nothing more: the first revocation times stay, and the second event says nothing was left to remove", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    withTotp(h, ada.user.id, h.now());
    h.passkey(ada.user.id);
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.advance(HOUR);
    const anchor = h.now();
    const first = await lockdown(h.deps, { userId: ada.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect(first).toMatchObject({ totpCleared: true, passwordCleared: true });
    expect(first.passkeysRemoved).toHaveLength(1);
    const firstRun = h.now();
    h.advance(MINUTE);
    const second = await lockdown(h.deps, { userId: ada.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx });
    expect(second).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([firstRun]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([firstRun]);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null });
    expect(h.passkeys).toEqual([]);
    expect(h.events.map((e) => e.metadata)).toEqual([
      { passkeysRemoved: first.passkeysRemoved, totpCleared: true, passwordCleared: true },
      { passkeysRemoved: [], totpCleared: false, passwordCleared: true },
    ]);
  });
});
