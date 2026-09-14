# korbat 1a — Task 13 of 21: Email entry, sign-up, onboarding and sign-in flows

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

The email flow is the single entry point for sign-up and sign-in. Its response is identical, and takes at least 400 ms, whether or not the email has an account. Sign-up checks the 16+ age limit (the date of birth is never stored) and terms acceptance, then onboarding claims a handle through a profile store the auth module does not own. First sign-ins from a new device email an alert with a 'this wasn't me' link.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): sessions with cached resolution, sliding and absolute expiry, rotation, re-auth window; password lockout`.
3. The previous task's last API unit run ended with `Tests  78 passed | 25 skipped (103)`.

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

### Create `apps/api/test/integration/flow-harness.ts`

```ts
import type { Profile } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, ProfileStore, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
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
```

### Create `apps/api/test/integration/auth-flows-signup.test.ts`

```ts
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
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/flows/email' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/auth-flows-signup.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/context.ts`

```ts
import type { AuthErrorCode, Profile } from "@korbat/contracts";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { decodeKey, parseVersionedKey, type VersionedKey } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { Lockout } from "./lockout";
import type { BreachChecker } from "./passwords";
import type { AuthRepo } from "./repo";
import type { Sessions } from "./sessions";
import type { TurnstileVerifier } from "./turnstile";

export interface AuthConfig {
  appOrigin: string;
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  allowedOrigins: string[];
  authHmacKey: Buffer;
  ipHashKey: Buffer;
  totpKey: VersionedKey;
  termsVersion: string;
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    termsVersion: config.TERMS_VERSION,
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  find(id: string): Promise<Profile | null>;
}

export interface AuthDeps {
  repo: AuthRepo;
  kv: KeyValueStore;
  sessions: Sessions;
  lockout: Lockout;
  mailer: Mailer;
  turnstile: TurnstileVerifier;
  breachChecker: BreachChecker;
  profiles: ProfileStore;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

export type AuthErrorStatus = 400 | 401 | 403 | 409 | 429 | 503;

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Request a new code.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Two-factor authentication must be turned on first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** True for a Postgres unique-constraint violation, however deeply the driver error is wrapped. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Create `apps/api/src/auth/limits.ts`

```ts
import { AuthError } from "./context";
import type { KeyValueStore } from "./kv";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

/** Counts one event in a fixed window and rejects once the count exceeds `max`. */
export async function enforceLimit(kv: KeyValueStore, bucket: string, max: number, windowMs: number): Promise<void> {
  const count = await kv.incr(`rl:${bucket}`, windowMs);
  if (count > max) throw new AuthError("rate_limited", 429);
}

/** Resolves only after at least `minMs` of wall-clock time since `startedAt`, so fast and slow paths look alike. */
export async function padResponseTime(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
```

### Create `apps/api/src/auth/flows/signin.ts`

```ts
import type { Platform } from "@korbat/contracts";
import type { AuthDeps, RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { deviceLabel } from "../devices";
import { deviceHash } from "../identifiers";
import type { DeviceRow, UserRow } from "../repo";
import type { IssuedSession } from "../sessions";

export const MFA_TICKET_TTL_MS = 5 * 60 * 1000;
export const NOT_ME_TTL_MS = 24 * 60 * 60 * 1000;

export interface DeviceInput {
  deviceId: string;
  platform: Platform;
}

export interface SignedIn {
  kind: "session";
  issued: IssuedSession;
  platform: Platform;
  mustReenrollMfa: boolean;
}

export interface MfaPending {
  kind: "mfa";
  mfaTicket: string;
}

export interface MfaTicket {
  userId: string;
  deviceId: string;
  platform: Platform;
}

export const mfaTicketKey = (ticket: string) => `mfa-ticket:${sha256Hex(ticket)}`;
export const notMeKey = (token: string) => `not-me:${sha256Hex(token)}`;

/** Registers or refreshes the device, issues a session and records the sign-in. */
export async function signIn(
  deps: AuthDeps,
  user: UserRow,
  device: DeviceInput,
  ctx: RequestContext,
  options: { alertNewDevice: boolean; mustReenrollMfa?: boolean },
): Promise<SignedIn> {
  const hash = deviceHash(deps.config.authHmacKey, device.deviceId);
  let row = await deps.repo.findDevice(user.id, hash);
  if (!row) {
    row = await deps.repo.createDevice({
      userId: user.id,
      deviceHash: hash,
      label: deviceLabel(ctx.userAgent, device.platform),
      platform: device.platform,
      ipHash: ctx.ipHash,
    });
    if (options.alertNewDevice) await alertNewDevice(deps, user, row, ctx);
  } else {
    await deps.repo.touchDevice(row.id, ctx.ipHash, deps.now());
  }
  const issued = await deps.sessions.issue(user.id, row.id);
  await deps.repo.appendEvent({ userId: user.id, type: "signin_success", deviceId: row.id, ipHash: ctx.ipHash });
  return { kind: "session", issued, platform: device.platform, mustReenrollMfa: options.mustReenrollMfa ?? false };
}

/** After a correct first factor: a session, or an MFA ticket when the account has two-factor on. */
export async function firstFactorPassed(deps: AuthDeps, user: UserRow, device: DeviceInput, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  if (user.totpEnabledAt) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true });
}

/** Best effort: a failed alert email is logged but does not block the sign-in. */
async function alertNewDevice(deps: AuthDeps, user: UserRow, device: DeviceRow, ctx: RequestContext): Promise<void> {
  const token = randomToken();
  await deps.kv.set(notMeKey(token), user.id, NOT_ME_TTL_MS);
  await deps.repo.appendEvent({ userId: user.id, type: "new_device", deviceId: device.id, ipHash: ctx.ipHash });
  try {
    await deps.mailer.send({
      to: user.email,
      template: "new_device",
      data: { deviceLabel: device.label ?? "Unknown device", notMeUrl: `${deps.config.appOrigin}/not-me/${token}` },
    });
  } catch (err) {
    deps.log.error({ err, userId: user.id }, "new-device alert email failed");
  }
}
```

### Create `apps/api/src/auth/flows/email.ts`

```ts
import { randomInt } from "node:crypto";
import type { EmailStartRequest, EmailVerifyRequest } from "@korbat/contracts";
import { MailUnavailable } from "../../mail/mailer";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { hmacHex, randomToken, safeEqual } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { EmailCodeRow } from "../repo";
import { firstFactorPassed, type DeviceInput, type MfaPending, type SignedIn } from "./signin";

export const CODE_TTL_MS = 10 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;
export const MIN_START_RESPONSE_MS = 400;

export const flowKey = (flowId: string) => `flow:${flowId}`;
export const signupKey = (flowId: string) => `signup:${flowId}`;
export const ageBlockKey = (emailHashValue: string) => `age-block:${emailHashValue}`;

export interface PendingSignup extends DeviceInput {
  email: string;
}

export function newEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function emailCodeHash(key: Buffer, flowId: string, code: string): string {
  return hmacHex(key, `email-code:${flowId}:${code}`);
}

export async function sendCode(deps: AuthDeps, message: Parameters<AuthDeps["mailer"]["send"]>[0]): Promise<void> {
  try {
    await deps.mailer.send(message);
  } catch (err) {
    if (err instanceof MailUnavailable) throw new AuthError("mail_unavailable", 503);
    throw err;
  }
}

/**
 * Checks a code against its stored row: not consumed, not expired, within the attempt limit, equal.
 * Consumes it on success so it can never be used again.
 */
export async function checkEmailCode(deps: AuthDeps, row: EmailCodeRow | undefined, flowId: string, code: string): Promise<EmailCodeRow> {
  if (!row || row.consumedAt) throw new AuthError("invalid_code", 400);
  if (row.expiresAt.getTime() <= deps.now().getTime()) throw new AuthError("code_expired", 400);
  const attempts = await deps.repo.addCodeAttempt(row.id);
  if (attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);
  if (!safeEqual(row.codeHash, emailCodeHash(deps.config.authHmacKey, flowId, code))) throw new AuthError("invalid_code", 400);
  if (!(await deps.repo.consumeEmailCode(row.id, deps.now()))) throw new AuthError("invalid_code", 400);
  return row;
}

/**
 * The single entry point for sign-up and sign-in. The response is identical whether or not the
 * email has an account, and always takes at least MIN_START_RESPONSE_MS.
 */
export async function startEmail(deps: AuthDeps, input: EmailStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const startedAt = Date.now();
  try {
    if (!(await deps.turnstile.verify(input.turnstileToken))) throw new AuthError("turnstile_failed", 403);
    if (isDisposableEmail(input.email)) throw new AuthError("disposable_email", 400);
    const hashedEmail = emailHash(deps.config.authHmacKey, input.email);
    if (await deps.kv.get(ageBlockKey(hashedEmail))) throw new AuthError("age_requirement", 403);

    await enforceLimit(deps.kv, `email-start:ip:${ctx.ipHash}`, 10, HOUR);
    if (!(await deps.kv.setIfAbsent(`email-cooldown:${hashedEmail}`, "1", MINUTE))) throw new AuthError("rate_limited", 429);
    await enforceLimit(deps.kv, `email-start:email:${hashedEmail}`, 3, HOUR);

    const user = await deps.repo.findUserByEmail(input.email);
    const flowId = randomToken();
    const code = newEmailCode();
    await deps.repo.createEmailCode({
      flowId,
      email: input.email,
      userId: user?.id ?? null,
      purpose: user ? "login" : "signup",
      codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
      expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
      ipHash: ctx.ipHash,
    });
    const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
    await deps.kv.set(flowKey(flowId), JSON.stringify(device), CODE_TTL_MS);
    await sendCode(deps, { to: input.email, template: user ? "sign_in_code" : "sign_up_code", data: { code } });
    return { flowId };
  } finally {
    await padResponseTime(startedAt, MIN_START_RESPONSE_MS);
  }
}

/** Verifies a sign-in or sign-up code. Sign-up codes lead to `signup_required`; sign-in codes to a session or MFA. */
export async function verifyEmail(
  deps: AuthDeps,
  input: EmailVerifyRequest,
  ctx: RequestContext,
): Promise<SignedIn | MfaPending | { kind: "signup_required" }> {
  await enforceLimit(deps.kv, `email-verify:ip:${ctx.ipHash}`, 30, HOUR);
  const row = await deps.repo.findEmailCode(input.flowId);
  if (row?.purpose !== "login" && row?.purpose !== "signup") throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);

  const device = await deps.kv.get(flowKey(input.flowId));
  if (!device) throw new AuthError("code_expired", 400);
  const parsed = JSON.parse(device) as DeviceInput;

  if (row.purpose === "signup") {
    const pending: PendingSignup = { email: row.email, ...parsed };
    await deps.kv.set(signupKey(input.flowId), JSON.stringify(pending), CODE_TTL_MS);
    return { kind: "signup_required" };
  }

  const user = row.userId ? await deps.repo.findUserById(row.userId) : undefined;
  if (!user) throw new AuthError("invalid_code", 400);
  return firstFactorPassed(deps, user, parsed, ctx);
}
```

### Create `apps/api/src/auth/flows/signup.ts`

```ts
import type { OnboardingHandleRequest, Profile, SignupCompleteRequest } from "@korbat/contracts";
import { meetsMinimumAge } from "../age";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { checkHandle } from "../handles";
import { emailHash } from "../identifiers";
import { HOUR } from "../limits";
import type { IssuedSession, Session } from "../sessions";
import { ageBlockKey, signupKey, type PendingSignup } from "./email";
import { signIn, type SignedIn } from "./signin";

export const AGE_BLOCK_MS = 24 * HOUR;

/**
 * Creates the account after a verified sign-up code. Terms and age are checked first; an under-16
 * date of birth stores nothing, blocks this email for 24 hours and ends the flow. Date of birth is
 * never written anywhere.
 */
export async function completeSignup(deps: AuthDeps, input: SignupCompleteRequest, ctx: RequestContext): Promise<SignedIn> {
  const raw = await deps.kv.get(signupKey(input.flowId));
  if (!raw) throw new AuthError("invalid_code", 400);
  const pending = JSON.parse(raw) as PendingSignup;

  if (input.termsVersion !== deps.config.termsVersion) throw new AuthError("terms_required", 400);

  if (!meetsMinimumAge(input.dateOfBirth, deps.now())) {
    await deps.kv.del(signupKey(input.flowId));
    await deps.kv.set(ageBlockKey(emailHash(deps.config.authHmacKey, pending.email)), "1", AGE_BLOCK_MS);
    throw new AuthError("age_requirement", 403);
  }

  if (!(await deps.kv.take(signupKey(input.flowId)))) throw new AuthError("invalid_code", 400);

  let user;
  try {
    user = await deps.repo.createUser({ email: pending.email, termsVersion: input.termsVersion, now: deps.now() });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("invalid_code", 400, "An account with this email already exists. Sign in instead.");
    throw err;
  }
  await deps.repo.appendEvent({ userId: user.id, type: "signup", ipHash: ctx.ipHash });
  return signIn(deps, user, { deviceId: pending.deviceId, platform: pending.platform }, ctx, { alertNewDevice: false });
}

/** Onboarding: claims a handle, marks the account onboarded and swaps the onboarding session for a full one. */
export async function chooseHandle(
  deps: AuthDeps,
  session: Session,
  input: OnboardingHandleRequest,
): Promise<{ profile: Profile; issued: IssuedSession }> {
  if (session.onboarded) throw new AuthError("handle_taken", 409, "Your profile already exists.");
  const problem = checkHandle(input.handle);
  if (problem) throw new AuthError(problem, 400);
  const created = await deps.profiles.create({ id: session.userId, handle: input.handle, displayName: input.displayName });
  if (!created.ok) throw new AuthError("handle_taken", 409);
  await deps.repo.markOnboarded(session.userId, deps.now());
  const issued = await deps.sessions.rotate(session);
  return { profile: created.profile, issued };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  78 passed | 33 skipped (111)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  78 passed | 33 skipped (111)
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

- `Tests  33 passed (33)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  33 passed (33)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/email.ts`
- `apps/api/src/auth/flows/signin.ts`
- `apps/api/src/auth/flows/signup.ts`
- `apps/api/src/auth/limits.ts`
- `apps/api/test/integration/auth-flows-signup.test.ts`
- `apps/api/test/integration/flow-harness.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(auth): enumeration-safe email entry, sign-up with age and terms checks, handle onboarding, new-device alerts" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): enumeration-safe email entry, sign-up with age and terms checks, handle onboarding, new-device alerts`.

## Report format (mandatory)

```text
TASK 13 REPORT
Files written: <count, expected 7>
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
