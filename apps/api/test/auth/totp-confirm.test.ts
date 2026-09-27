import { describe, expect, test } from "vitest";
import { decrypt } from "../../src/auth/crypto";
import { confirmTotp, setupTotp, totpPendingKey } from "../../src/auth/flows/mfa";
import { hashRecoveryCode } from "../../src/auth/recovery-codes";
import type { Session } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const SETUP_EXPIRED = "Two-factor setup expired. Start again.";

/** Starts a setup on the session and answers the pending secret as the store holds it, with the code an authenticator app shows for it now. */
async function setup(h: MemoryFlowHarness, session: Session) {
  await setupTotp(h.deps, session);
  const pending = (await h.kv.get(totpPendingKey(session.handle)))!;
  const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
  return { pending, code: hotp(secret, currentStep(h.now().getTime())) };
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("confirming a TOTP setup (1c design, section 2): the pending secret is spent once", () => {
  test("two confirmations of one setup at once turn two-factor on once: one answers with the recovery codes that are stored, the other is refused before it writes anything", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { pending, code } = await setup(h, ada.session);
    // A double submit: both requests carry the same session and the same code. Each read of the pending secret waits for
    // the other, so both hold it before either spends it.
    const get = h.kv.get.bind(h.kv);
    let readers = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === totpPendingKey(ada.session.handle)) {
        if (++readers === 2) release();
        await bothRead;
      }
      return value;
    };
    const outcomes = await Promise.allSettled([confirmTotp(h.deps, ada.session, { code }), confirmTotp(h.deps, ada.session, { code })]);
    h.kv.get = get;
    expect(readers).toBe(2);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmTotp>>> => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect([won.length, lost.length]).toEqual([1, 1]);
    expect(lost[0]!.reason).toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });

    // The codes the one answer shows are the codes the account holds.
    const stored = h.users.get(ada.user.id)!;
    const key = h.deps.config.authHmacKey;
    expect(won[0]!.value.recoveryCodes).toHaveLength(10);
    expect(stored.recoveryCodesHash).toEqual(won[0]!.value.recoveryCodes.map((recoveryCode) => hashRecoveryCode(key, recoveryCode)));
    expect(stored).toMatchObject({ totpSecretEnc: pending, totpEnabledAt: h.now() });
    // The code's step is claimed, so the same code cannot be the second factor of a sign-in.
    expect(stored.totpLastStep).not.toBeNull();
    // Once on the record, once in the owner's mailbox, and one rotation: the session's row is under the token the answer carries.
    expect(h.events).toEqual([{ userId: ada.user.id, type: "mfa_enabled", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([["ada@korbat.local", "mfa_enabled"]]);
    const row = h.sessions.find((s) => s.handle === ada.session.handle)!;
    expect(row.id).toBe(won[0]!.value.issued.session.sessionId);
    expect(row.factors).toEqual({ ...ada.session.factors, totp: h.now().getTime() });
    expect(won[0]!.value.issued.session).toMatchObject({ handle: ada.session.handle, mfaEnabled: true });
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBeNull();
  });

  test("a second confirmation with the same code, after the first, is refused and writes nothing: the codes, the step, the record and the session stay as the first left them", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { code } = await setup(h, ada.session);
    const first = await confirmTotp(h.deps, ada.session, { code });
    const after = structuredClone(h.users.get(ada.user.id)!);
    const row = { ...h.sessions.find((s) => s.handle === ada.session.handle)! };

    for (const session of [ada.session, first.issued.session]) {
      await expect(confirmTotp(h.deps, session, { code })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });
    }
    expect(h.users.get(ada.user.id)).toEqual(after);
    expect(h.sessions.find((s) => s.handle === ada.session.handle)).toEqual(row);
    expect(h.events.map((e) => e.type)).toEqual(["mfa_enabled"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["mfa_enabled"]);
  });

  test("a wrong code does not spend the setup: the right one still confirms it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { pending, code } = await setup(h, ada.session);
    await expect(confirmTotp(h.deps, ada.session, { code: wrong(code) })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: "That authentication code is not valid." });
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBe(pending);
    expect(h.users.get(ada.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null });
    expect(h.events).toEqual([]);
    expect((await confirmTotp(h.deps, ada.session, { code })).recoveryCodes).toHaveLength(10);
    expect(h.users.get(ada.user.id)!.totpSecretEnc).toBe(pending);
  });

  test("a setup replaced between the confirmation's read and its spend is refused: the code proved a secret that is no longer the pending one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { code } = await setup(h, ada.session);
    // The session starts a new setup just after the confirmation read the old one.
    const get = h.kv.get.bind(h.kv);
    h.kv.get = async (key) => {
      const value = await get(key);
      if (key === totpPendingKey(ada.session.handle)) {
        h.kv.get = get;
        await setupTotp(h.deps, ada.session);
      }
      return value;
    };
    await expect(confirmTotp(h.deps, ada.session, { code })).rejects.toMatchObject({ code: "invalid_mfa_code", status: 400, message: SETUP_EXPIRED });
    expect(h.users.get(ada.user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
    expect(h.sessions.find((s) => s.handle === ada.session.handle)!.id).toBe(ada.session.sessionId);
    // The newer secret went with the refusal, so the owner starts the setup again, as the message says.
    expect(await h.kv.get(totpPendingKey(ada.session.handle))).toBeNull();
  });
});
