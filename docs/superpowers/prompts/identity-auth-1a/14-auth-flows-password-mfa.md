# korbat 1a — Task 14 of 21: Password and MFA flows

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Password sign-in runs the lockout rules and one full argon2 verification on every path. Setting a password needs fresh re-authentication and a passing breach check. TOTP setup holds the new secret encrypted for 10 minutes until a code confirms it; MFA sign-in accepts a TOTP code or a single-use recovery code and caps attempts per ticket.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): enumeration-safe email entry, sign-up with age and terms checks, handle onboarding, new-device alerts`.
3. The previous task's last API unit run ended with `Tests  78 passed | 33 skipped (111)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Create `apps/api/test/integration/auth-flows-mfa.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { decrypt, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "../../src/auth/flows/mfa";
import { passwordSignIn, setPassword } from "../../src/auth/flows/password";
import { BreachCheckUnavailable, hashPassword } from "../../src/auth/passwords";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import {
  currentTotpCode,
  flowHarness,
  newTestDevice,
  newTestEmail,
  onboardedUser,
  wrongCode,
  type FlowHarness,
  type OnboardedUser,
} from "./flow-harness";

const PASSWORD = "correct horse battery staple";

describe.skipIf(!process.env.INTEGRATION)("integration: password and MFA flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  async function enableMfa(h: FlowHarness, account: OnboardedUser) {
    await setupTotp(h.deps, account.session);
    const pending = (await h.kv.get(`totp-pending:${account.user.id}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    return confirmTotp(h.deps, account.session, { code: hotp(secret, currentStep(h.clock.ms())) });
  }

  /** Signs in by email code (after the resend cooldown) and returns the MFA ticket. */
  async function mfaTicketByEmail(h: FlowHarness, account: OnboardedUser) {
    h.clock.advance(61_000);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    const outcome = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    if (outcome.kind !== "mfa") throw new Error(`expected an MFA ticket, got ${outcome.kind}`);
    return outcome.mfaTicket;
  }

  test("password sign-in succeeds; unknown emails, accounts without a password and wrong passwords get the same error", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const withPassword = await onboardedUser(h, repo, { password: PASSWORD });
    const withoutPassword = await onboardedUser(h, repo);
    const attempt = (email: string, password: string, turnstileToken = "ok") =>
      passwordSignIn(h.deps, { email, password, turnstileToken, ...newTestDevice() }, h.ctx);

    expect((await attempt(withPassword.email, PASSWORD)).kind).toBe("session");
    for (const [email, password] of [
      [newTestEmail(), PASSWORD],
      [withoutPassword.email, PASSWORD],
      [withPassword.email, "wrong password entirely"],
    ] as const) {
      await expect(attempt(email, password)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    }
    await expect(attempt(withPassword.email, PASSWORD, "fail")).rejects.toMatchObject({ code: "turnstile_failed" });
  });

  test("five wrong passwords lock password sign-in for 15 minutes and email the owner; email-code sign-in keeps working", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const attempt = (password: string) =>
      passwordSignIn(h.deps, { email: account.email, password, turnstileToken: "ok", ...account.device }, h.ctx);

    for (let i = 0; i < 5; i++) await expect(attempt("wrong password entirely")).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.mailer.sent.filter((m) => m.template === "account_locked")).toHaveLength(1);

    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...account.device }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");

    h.clock.advance(16 * 60_000);
    expect((await attempt(PASSWORD)).kind).toBe("session");
  });

  test("password sign-in timing does not reveal whether an email has an account", { timeout: 120_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const time = async (email: string) => {
      const startedAt = performance.now();
      await passwordSignIn(
        h.deps,
        { email, password: "wrong password entirely", turnstileToken: "ok", ...newTestDevice() },
        { ...h.ctx, ipHash: randomToken() },
      ).catch(() => undefined);
      return performance.now() - startedAt;
    };
    const unknown: number[] = [];
    const known: number[] = [];
    for (let i = 0; i < 10; i++) {
      unknown.push(await time(newTestEmail()));
      known.push(await time(account.email));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(Math.abs(median(unknown) - median(known))).toBeLessThan(50);
  });

  test("setting a password enforces length and breach rules, fails closed when the check is down, and rotates the session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);

    await expect(setPassword(h.deps, account.session, { password: "short" })).rejects.toMatchObject({ code: "password_too_short" });
    await expect(setPassword(h.deps, account.session, { password: "a".repeat(129) })).rejects.toMatchObject({ code: "password_too_long" });
    await expect(setPassword(h.deps, account.session, { password: "breached password 123" })).rejects.toMatchObject({ code: "password_breached" });

    const realChecker = h.deps.breachChecker;
    h.deps.breachChecker = {
      isBreached: async () => {
        throw new BreachCheckUnavailable("offline");
      },
    };
    await expect(setPassword(h.deps, account.session, { password: PASSWORD })).rejects.toMatchObject({ code: "password_check_unavailable", status: 503 });
    h.deps.breachChecker = realChecker;
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();

    const rotated = await setPassword(h.deps, account.session, { password: PASSWORD });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.token)).not.toBeNull();
    await setPassword(h.deps, rotated.session, { password: `${PASSWORD} again` });
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["password_set", "password_changed"]));
  });

  test("MFA setup: a wrong code keeps it off; the right code turns it on, returns 10 recovery codes and rotates the session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const setup = await setupTotp(h.deps, account.session);
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/korbat:account\?secret=/);
    expect(setup.qrSvg.startsWith("<svg")).toBe(true);

    const pending = (await h.kv.get(`totp-pending:${account.user.id}`))!;
    const right = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    await expect(confirmTotp(h.deps, account.session, { code: wrongCode(right) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();

    const confirmed = await confirmTotp(h.deps, account.session, { code: right });
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(confirmed.issued.session.mfaEnabled).toBe(true);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.kv.get(`totp-pending:${account.user.id}`)).toBeNull();
    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.totpSecretEnc).toMatch(/^v1:/);
    expect(stored.recoveryCodesHash).toHaveLength(10);
    expect(stored.recoveryCodesHash).not.toContain(confirmed.recoveryCodes[0]);
  });

  test("MFA sign-in accepts a current code once, rejects a replay, and voids a ticket after five wrong codes", { timeout: 60_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableMfa(h, account);

    const firstTicket = await mfaTicketByEmail(h, account);
    const code = await currentTotpCode(h, repo, account.user.id);
    const signed = await verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx);
    expect(signed.issued.session.mfaEnabled).toBe(true);
    expect(signed.mustReenrollMfa).toBe(false);
    await expect(verifyMfa(h.deps, { mfaTicket: firstTicket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticketByPassword = async () => {
      const outcome = await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx);
      if (outcome.kind !== "mfa") throw new Error("expected an MFA ticket");
      return outcome.mfaTicket;
    };
    await expect(verifyMfa(h.deps, { mfaTicket: await ticketByPassword(), code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const ticket = await ticketByPassword();
    for (let i = 0; i < 5; i++) {
      await expect(verifyMfa(h.deps, { mfaTicket: ticket, code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    }
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "too_many_attempts" });
    await expect(verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
  });

  test("a recovery code signs in once, asks for MFA to be set up again, and cannot be reused", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes } = await enableMfa(h, account);

    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]!.toUpperCase() }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toContain("recovery_code_used");
  });

  test("recovery codes can be regenerated; turning MFA off needs a valid code and is refused for staff", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes, issued } = await enableMfa(h, account);

    const regenerated = await regenerateRecoveryCodes(h.deps, issued.session);
    expect(regenerated).toHaveLength(10);
    expect(regenerated).not.toContain(recoveryCodes[0]);
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });

    await repo.setRole(account.user.id, "moderator");
    const staff = await h.deps.sessions.issue(account.user.id, issued.session.deviceId);
    await expect(disableTotp(h.deps, staff.session, { code: await currentTotpCode(h, repo, account.user.id) })).rejects.toMatchObject({ code: "staff_mfa_required" });

    await repo.setRole(account.user.id, "user");
    const regular = await h.deps.sessions.issue(account.user.id, issued.session.deviceId);
    await expect(disableTotp(h.deps, regular.session, { code: wrongCode(await currentTotpCode(h, repo, account.user.id)) })).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });
    h.clock.advance(30_000);
    await disableTotp(h.deps, regular.session, { code: await currentTotpCode(h, repo, account.user.id) });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();
  });

  test("hashPassword output is accepted by password sign-in on a fresh account", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await repo.setPasswordHash(account.user.id, await hashPassword(PASSWORD), new Date());
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Profile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { signIn } from "../../src/auth/flows/signin";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import { hashPassword } from "../../src/auth/passwords";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { currentStep, hotp } from "../../src/auth/totp";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/** Handles unique per store, like the real public.profiles index. */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, Profile>();
  const byId = new Map<string, Profile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
  };
}

export const TEST_TERMS = "draft-test";
export const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

/**
 * Real auth repository (Postgres) with an in-memory key-value store, mailer and profile store, a fake
 * clock shared by all of them, Turnstile that fails only for the token "fail", and a breach checker
 * that flags passwords containing "breached".
 */
export function flowHarness(repo: AuthRepo) {
  const clock = fakeClock();
  const kv = new MemoryKv(clock.ms);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    termsVersion: TEST_TERMS,
  };
  const deps: AuthDeps = {
    repo,
    kv,
    mailer,
    config,
    now: clock.now,
    sessions: createSessions({ repo, kv, now: clock.now }),
    lockout: createLockout({ repo, kv, now: clock.now }),
    turnstile: { verify: async (token) => token !== "fail" },
    breachChecker: { isBreached: async (password) => password.includes("breached") },
    profiles: memoryProfiles(),
    log: pino({ level: "silent" }),
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: CHROME_WINDOWS };
  return { deps, clock, kv, mailer, ctx };
}

export type FlowHarness = ReturnType<typeof flowHarness>;

export const newTestEmail = (prefix = "flow") => `${prefix}-${randomUUID()}@korbat.local`;
export const newTestDevice = () => ({ deviceId: randomToken(), platform: "web" as const });
export const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** An onboarded account, optionally with a password, signed in on one web device. */
export async function onboardedUser(h: FlowHarness, repo: AuthRepo, options: { password?: string } = {}) {
  const email = newTestEmail("account");
  const created = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
  await repo.markOnboarded(created.id, new Date());
  if (options.password) await repo.setPasswordHash(created.id, await hashPassword(options.password), new Date());
  const user = (await repo.findUserById(created.id))!;
  const device = newTestDevice();
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false });
  return { email, user, device, session: signed.issued.session, token: signed.issued.token };
}

export type OnboardedUser = Awaited<ReturnType<typeof onboardedUser>>;

/** The TOTP code for a user's stored secret at the harness clock. */
export async function currentTotpCode(h: FlowHarness, repo: AuthRepo, userId: string): Promise<string> {
  const user = (await repo.findUserById(userId))!;
  const secret = new Uint8Array(decrypt(user.totpSecretEnc!, [h.deps.config.totpKey]));
  return hotp(secret, currentStep(h.clock.ms()));
}
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/auth/flows/mfa'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/flows/mfa' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/auth-flows-mfa.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/flows/password.ts`

```ts
import type { PasswordSetRequest, PasswordSigninRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { MINUTE, enforceLimit } from "../limits";
import { LOCK_DURATION_MS } from "../lockout";
import { BreachCheckUnavailable, checkPasswordLength, hashPassword, verifyPassword } from "../passwords";
import type { IssuedSession, Session } from "../sessions";
import { firstFactorPassed, type MfaPending, type SignedIn } from "./signin";

/**
 * Password sign-in. Unknown emails, accounts without a password, locked accounts and wrong passwords
 * all run one full argon2 verification and return the same `invalid_credentials` error.
 */
export async function passwordSignIn(deps: AuthDeps, input: PasswordSigninRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  if (!(await deps.turnstile.verify(input.turnstileToken))) throw new AuthError("turnstile_failed", 403);
  await enforceLimit(deps.kv, `password-signin:ip:${ctx.ipHash}`, 20, 15 * MINUTE);

  const user = await deps.repo.findUserByEmail(input.email);
  if (!user || !user.passwordHash || deps.lockout.isLocked(user)) {
    await verifyPassword(null, input.password);
    throw new AuthError("invalid_credentials", 401);
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const { locked } = await deps.lockout.recordFailure(user.id);
    await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "password" } });
    if (locked) {
      await deps.repo.appendEvent({ userId: user.id, type: "account_locked", ipHash: ctx.ipHash });
      try {
        await deps.mailer.send({ to: user.email, template: "account_locked", data: { minutes: String(LOCK_DURATION_MS / MINUTE) } });
      } catch (err) {
        deps.log.error({ err, userId: user.id }, "lockout notice email failed");
      }
    }
    throw new AuthError("invalid_credentials", 401);
  }

  await deps.lockout.recordSuccess(user.id);
  return firstFactorPassed(deps, user, { deviceId: input.deviceId, platform: input.platform }, ctx);
}

/**
 * Sets or changes the password (the route requires fresh re-authentication). Length first, then the
 * breach check, which fails closed: when it cannot run, the password is not saved.
 */
export async function setPassword(deps: AuthDeps, session: Session, input: PasswordSetRequest): Promise<IssuedSession> {
  const lengthProblem = checkPasswordLength(input.password);
  if (lengthProblem) throw new AuthError(lengthProblem, 400);

  let breached: boolean;
  try {
    breached = await deps.breachChecker.isBreached(input.password);
  } catch (err) {
    if (err instanceof BreachCheckUnavailable) throw new AuthError("password_check_unavailable", 503);
    throw err;
  }
  if (breached) throw new AuthError("password_breached", 400);

  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await deps.repo.setPasswordHash(user.id, await hashPassword(input.password), deps.now());
  await deps.repo.appendEvent({ userId: user.id, type: user.passwordHash ? "password_changed" : "password_set", deviceId: session.deviceId });
  return deps.sessions.rotate(session);
}
```

### Create `apps/api/src/auth/flows/mfa.ts`

```ts
import type { MfaVerifyRequest, TotpCodeRequest, TotpSetupResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { decrypt, encrypt } from "../crypto";
import { MINUTE, enforceLimit } from "../limits";
import { hashRecoveryCode, newRecoveryCodes } from "../recovery-codes";
import type { UserRow } from "../repo";
import type { IssuedSession, Session } from "../sessions";
import { newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../totp";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type MfaTicket, type SignedIn } from "./signin";

export const TOTP_PENDING_TTL_MS = 10 * MINUTE;
export const MAX_MFA_ATTEMPTS = 5;

export const totpPendingKey = (userId: string) => `totp-pending:${userId}`;

function storedSecret(deps: AuthDeps, user: UserRow): Uint8Array {
  if (!user.totpSecretEnc) throw new AuthError("mfa_required", 400);
  return new Uint8Array(decrypt(user.totpSecretEnc, [deps.config.totpKey]));
}

/** Verifies a TOTP code and claims its time step atomically, so the same code cannot be used twice. */
async function acceptTotp(deps: AuthDeps, user: UserRow, code: string): Promise<boolean> {
  const step = verifyTotp(storedSecret(deps, user), code, user.totpLastStep, deps.now().getTime());
  return step !== null && (await deps.repo.claimTotpStep(user.id, step));
}

/** Starts setup with a new secret held encrypted for 10 minutes. Replacing an existing secret needs fresh auth. */
export async function setupTotp(deps: AuthDeps, session: Session): Promise<TotpSetupResponse> {
  if (session.mfaEnabled && !deps.sessions.isFresh(session)) throw new AuthError("reauth_required", 403);
  const secret = newTotpSecret();
  await deps.kv.set(totpPendingKey(session.userId), encrypt(Buffer.from(secret), deps.config.totpKey), TOTP_PENDING_TTL_MS);
  const profile = await deps.profiles.find(session.userId);
  const otpauthUri = totpUri(secret, profile?.handle ?? "account");
  return { otpauthUri, qrSvg: totpQrSvg(otpauthUri) };
}

/** Turns MFA on with the pending secret, issues 10 recovery codes (shown once) and rotates the session. */
export async function confirmTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<{ recoveryCodes: string[]; issued: IssuedSession }> {
  if (session.mfaEnabled && !deps.sessions.isFresh(session)) throw new AuthError("reauth_required", 403);
  const pending = await deps.kv.get(totpPendingKey(session.userId));
  if (!pending) throw new AuthError("invalid_mfa_code", 400, "Two-factor setup expired. Start again.");
  const secret = new Uint8Array(decrypt(pending, [deps.config.totpKey]));
  const step = verifyTotp(secret, input.code, null, deps.now().getTime());
  if (step === null) throw new AuthError("invalid_mfa_code", 400);

  const recoveryCodes = newRecoveryCodes();
  await deps.repo.enableTotp(session.userId, {
    secretEnc: pending,
    recoveryCodesHash: recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)),
    now: deps.now(),
  });
  await deps.repo.claimTotpStep(session.userId, step);
  await deps.kv.del(totpPendingKey(session.userId));
  await deps.repo.appendEvent({ userId: session.userId, type: "mfa_enabled", deviceId: session.deviceId });
  return { recoveryCodes, issued: await deps.sessions.rotate(session) };
}

/**
 * Second factor at sign-in: a TOTP code, or a recovery code (single use; the response then asks the
 * user to set up MFA again). A ticket allows five wrong attempts and issues at most one session.
 */
export async function verifyMfa(deps: AuthDeps, input: MfaVerifyRequest, ctx: RequestContext): Promise<SignedIn> {
  await enforceLimit(deps.kv, `mfa-verify:ip:${ctx.ipHash}`, 20, 15 * MINUTE);
  const key = mfaTicketKey(input.mfaTicket);
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_mfa_code", 401);
  const ticket = JSON.parse(raw) as MfaTicket;

  if ((await deps.kv.incr(`mfa-attempts:${key}`, MFA_TICKET_TTL_MS)) > MAX_MFA_ATTEMPTS) {
    await deps.kv.del(key);
    throw new AuthError("too_many_attempts", 429);
  }

  const user = await deps.repo.findUserById(ticket.userId);
  if (!user?.totpSecretEnc) throw new AuthError("invalid_mfa_code", 401);

  let mustReenrollMfa = false;
  if ("code" in input) {
    if (!(await acceptTotp(deps, user, input.code))) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "totp" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
  } else {
    const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
    if (!consumed) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", ipHash: ctx.ipHash });
    mustReenrollMfa = true;
  }

  if (!(await deps.kv.take(key))) throw new AuthError("invalid_mfa_code", 401);
  return signIn(deps, user, { deviceId: ticket.deviceId, platform: ticket.platform }, ctx, { alertNewDevice: true, mustReenrollMfa });
}

/** Turns MFA off (the route requires fresh auth). Staff accounts can never turn it off. */
export async function disableTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<void> {
  if (session.role !== "user") throw new AuthError("staff_mfa_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpSecretEnc) throw new AuthError("mfa_required", 400);
  if (!(await acceptTotp(deps, user, input.code))) throw new AuthError("invalid_mfa_code", 400);
  await deps.repo.disableTotp(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "mfa_disabled", deviceId: session.deviceId });
}

/** Replaces all recovery codes (the route requires fresh auth). The old codes stop working. */
export async function regenerateRecoveryCodes(deps: AuthDeps, session: Session): Promise<string[]> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpEnabledAt) throw new AuthError("mfa_required", 400);
  const recoveryCodes = newRecoveryCodes();
  await deps.repo.setRecoveryCodes(user.id, recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)));
  await deps.repo.appendEvent({ userId: user.id, type: "recovery_codes_regenerated", deviceId: session.deviceId });
  return recoveryCodes;
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  78 passed | 42 skipped (120)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  78 passed | 42 skipped (120)
```

## Step 5: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  42 passed (42)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  42 passed (42)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/flows/mfa.ts`
- `apps/api/src/auth/flows/password.ts`
- `apps/api/test/integration/auth-flows-mfa.test.ts`
- `apps/api/test/integration/flow-harness.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(auth): password sign-in with lockout, fail-closed password setting, TOTP setup, MFA sign-in, recovery codes" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): password sign-in with lockout, fail-closed password setting, TOTP setup, MFA sign-in, recovery codes`.

## Report format (mandatory)

```text
TASK 14 REPORT
Files written: <count, expected 4>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
