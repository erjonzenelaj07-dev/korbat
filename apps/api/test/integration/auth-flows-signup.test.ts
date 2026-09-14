import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { chooseHandle, completeSignup } from "../../src/auth/flows/signup";
import { emailHash } from "../../src/auth/identifiers";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { TEST_TERMS, flowHarness, type FlowHarness } from "./flow-harness";

const newEmail = () => `flow-${randomUUID()}@korbat.local`;
const newDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe.skipIf(!process.env.INTEGRATION)("integration: email entry, sign-up and onboarding flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function start(h: FlowHarness, email: string, device = newDevice()) {
    const { flowId } = await startEmail(h.deps, { email, turnstileToken: "ok", ...device }, h.ctx);
    return { flowId, code: h.mailer.lastCodeFor(email)!, device };
  }

  test("the email step looks the same for new and existing accounts and takes at least 400 ms", async () => {
    const h = flowHarness(repo);
    const existing = newEmail();
    await repo.createUser({ email: existing, termsVersion: TEST_TERMS, now: new Date() });
    const startedAt = Date.now();
    const a = await startEmail(h.deps, { email: existing, turnstileToken: "ok", ...newDevice() }, h.ctx);
    const elapsed = Date.now() - startedAt;
    const b = await startEmail(h.deps, { email: newEmail(), turnstileToken: "ok", ...newDevice() }, h.ctx);
    expect(Object.keys(a)).toEqual(["flowId"]);
    expect(Object.keys(b)).toEqual(["flowId"]);
    expect(elapsed).toBeGreaterThanOrEqual(390);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code", "sign_up_code"]);
  });

  test("Turnstile failures, disposable domains and age-blocked emails are refused before any email is sent", async () => {
    const h = flowHarness(repo);
    const blocked = newEmail();
    await h.kv.set(`age-block:${emailHash(h.deps.config.authHmacKey, blocked)}`, "1", 60_000);
    await expect(startEmail(h.deps, { email: newEmail(), turnstileToken: "fail", ...newDevice() }, h.ctx)).rejects.toMatchObject({ code: "turnstile_failed" });
    await expect(startEmail(h.deps, { email: "someone@mailinator.com", turnstileToken: "ok", ...newDevice() }, h.ctx)).rejects.toMatchObject({ code: "disposable_email" });
    await expect(startEmail(h.deps, { email: blocked, turnstileToken: "ok", ...newDevice() }, h.ctx)).rejects.toMatchObject({ code: "age_requirement" });
    expect(h.mailer.sent).toHaveLength(0);
  });

  test("resends wait 60 seconds and one email gets at most 3 codes an hour", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    await start(h, email);
    await expect(start(h, email)).rejects.toMatchObject({ code: "rate_limited" });
    h.clock.advance(61_000);
    await start(h, email);
    h.clock.advance(61_000);
    await start(h, email);
    h.clock.advance(61_000);
    await expect(start(h, email)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("codes allow five attempts, expire after 10 minutes and work only once", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });

    const first = await start(h, email);
    for (let i = 0; i < 5; i++) {
      await expect(verifyEmail(h.deps, { flowId: first.flowId, code: wrong(first.code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(verifyEmail(h.deps, { flowId: first.flowId, code: first.code }, h.ctx)).rejects.toMatchObject({ code: "too_many_attempts" });

    h.clock.advance(61_000);
    const second = await start(h, email);
    h.clock.advance(11 * 60_000);
    await expect(verifyEmail(h.deps, { flowId: second.flowId, code: second.code }, h.ctx)).rejects.toMatchObject({ code: "code_expired" });

    h.clock.advance(61_000);
    const third = await start(h, email);
    expect((await verifyEmail(h.deps, { flowId: third.flowId, code: third.code }, h.ctx)).kind).toBe("session");
    await expect(verifyEmail(h.deps, { flowId: third.flowId, code: third.code }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("sign-up checks terms and age, and an under-16 date of birth stores nothing and blocks the email", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const { flowId, code, device } = await start(h, email);
    expect(await verifyEmail(h.deps, { flowId, code }, h.ctx)).toEqual({ kind: "signup_required" });
    await expect(completeSignup(h.deps, { flowId, dateOfBirth: "2000-01-01", termsVersion: "old-terms" }, h.ctx)).rejects.toMatchObject({ code: "terms_required" });
    const fifteenYearsOld = `${h.clock.now().getUTCFullYear() - 15}-01-01`;
    await expect(completeSignup(h.deps, { flowId, dateOfBirth: fifteenYearsOld, termsVersion: TEST_TERMS }, h.ctx)).rejects.toMatchObject({ code: "age_requirement" });
    expect(await repo.findUserByEmail(email)).toBeUndefined();
    await expect(completeSignup(h.deps, { flowId, dateOfBirth: "2000-01-01", termsVersion: TEST_TERMS }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
    h.clock.advance(61_000);
    await expect(startEmail(h.deps, { email, turnstileToken: "ok", ...device }, h.ctx)).rejects.toMatchObject({ code: "age_requirement" });
  });

  test("a finished sign-up gets an onboarding session; choosing a handle completes onboarding and rotates it", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const { flowId, code } = await start(h, email);
    await verifyEmail(h.deps, { flowId, code }, h.ctx);
    const signedUp = await completeSignup(h.deps, { flowId, dateOfBirth: "2000-01-01", termsVersion: TEST_TERMS }, h.ctx);
    expect(signedUp.issued.session).toMatchObject({ onboarded: false, mfaEnabled: false });
    expect(signedUp.platform).toBe("web");
    expect(h.mailer.sent.filter((m) => m.template === "new_device")).toHaveLength(0);

    const user = (await repo.findUserByEmail(email))!;
    expect(user.ageConfirmedAt).not.toBeNull();
    expect(user.termsVersion).toBe(TEST_TERMS);
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["signup", "signin_success"]));

    await expect(chooseHandle(h.deps, signedUp.issued.session, { handle: "ab", displayName: "Ada" })).rejects.toMatchObject({ code: "handle_invalid" });
    await expect(chooseHandle(h.deps, signedUp.issued.session, { handle: "admin", displayName: "Ada" })).rejects.toMatchObject({ code: "handle_reserved" });
    await h.deps.profiles.create({ id: randomUUID(), handle: "taken_one", displayName: "Someone" });
    await expect(chooseHandle(h.deps, signedUp.issued.session, { handle: "taken_one", displayName: "Ada" })).rejects.toMatchObject({ code: "handle_taken" });

    const done = await chooseHandle(h.deps, signedUp.issued.session, { handle: "ada_lovelace", displayName: "Ada Lovelace" });
    expect(done.profile).toEqual({ id: user.id, handle: "ada_lovelace", displayName: "Ada Lovelace" });
    expect(done.issued.session.onboarded).toBe(true);
    expect(await h.deps.sessions.resolve(signedUp.issued.token)).toBeNull();
    await expect(chooseHandle(h.deps, done.issued.session, { handle: "ada_again", displayName: "Ada" })).rejects.toMatchObject({ code: "handle_taken" });
  });

  test("the first sign-in from a device sends an alert with a 'not me' link; a known device does not", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const user = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
    await repo.markOnboarded(user.id, new Date());
    const device = newDevice();

    const first = await start(h, email, device);
    expect((await verifyEmail(h.deps, { flowId: first.flowId, code: first.code }, h.ctx)).kind).toBe("session");
    const alerts = h.mailer.sent.filter((m) => m.template === "new_device");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.data.deviceLabel).toBe("Chrome on Windows");
    expect(alerts[0]!.data.notMeUrl).toMatch(/^http:\/\/localhost:8081\/not-me\/[A-Za-z0-9_-]{43}$/);

    h.clock.advance(61_000);
    const second = await start(h, email, device);
    await verifyEmail(h.deps, { flowId: second.flowId, code: second.code }, h.ctx);
    expect(h.mailer.sent.filter((m) => m.template === "new_device")).toHaveLength(1);
  });

  test("an account with MFA gets a ticket, not a session", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const user = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
    await repo.enableTotp(user.id, { secretEnc: "v1:unused", recoveryCodesHash: [], now: new Date() });
    const { flowId, code } = await start(h, email);
    const outcome = await verifyEmail(h.deps, { flowId, code }, h.ctx);
    expect(outcome.kind).toBe("mfa");
    expect((outcome as { mfaTicket: string }).mfaTicket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await repo.listActiveSessions(user.id, new Date())).toHaveLength(0);
  });
});
