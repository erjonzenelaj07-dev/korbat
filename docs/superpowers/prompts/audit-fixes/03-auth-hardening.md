# korbat audit fixes — Task 3 of 11: Two-factor enrolment and session revocation need fresh authentication; owners are emailed about security changes; hashed flow ids, the two missing limits, browser requests never get bearer tokens, revocation tombstones, rehash-on-login, TOTP key rotation, malformed JSON answered as 400

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform whose account security is hand-rolled on audited primitives inside the API's auth module. The audit found that two-factor authentication could be enrolled, and other sessions revoked, by anyone holding a live session without proving a credential again, which on a platform with no manual recovery locks the owner out for good. This task makes enrolment and per-session revocation need fresh authentication, emails the owner about every security change, revokes the device a 'this wasn't me' link came from, hashes pending sign-up ids in the store, adds two rate limits the design named, treats any browser request as a web session so a script can never obtain a bearer token, makes revocation win over the session cache, re-hashes passwords on sign-in when parameters changed, accepts previous TOTP keys for rotation, and answers malformed JSON with 400. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 3.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `build: esbuild build scripts replace tsup for the API and the worker; the chokidar@4.0.3 trust exclusion leaves with it, and the dead min-release-age line leaves .npmrc`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/03-auth-hardening.md 1
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/limits.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { MemoryKv } from "../../src/auth/kv";
import { enforceLimit } from "../../src/auth/limits";

describe("enforceLimit", () => {
  test("allows max hits in the window, then refuses with the window as Retry-After", async () => {
    let t = 1_000_000;
    const kv = new MemoryKv(() => t);
    for (let i = 0; i < 3; i++) await enforceLimit(kv, "b", 3, 90_000);
    await expect(enforceLimit(kv, "b", 3, 90_000)).rejects.toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 90 });
    t += 90_001;
    await expect(enforceLimit(kv, "b", 3, 90_000)).resolves.toBeUndefined();
  });
});
```

### Replace `apps/api/test/config.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
});
```

### Replace `apps/api/test/mail/templates.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryMailer } from "../../src/mail/memory";
import { renderTemplate } from "../../src/mail/templates";

describe("mail templates", () => {
  test("code emails carry the code and expiry, and no links or images", () => {
    const r = renderTemplate("sign_in_code", { code: "123456" });
    expect(r.subject).toBe("Your korbat sign-in code");
    expect(r.text).toContain("123456");
    expect(r.text).toContain("10 minutes");
    expect(r.html).toContain("123456");
    expect(r.html).not.toMatch(/<img|<a |https?:\/\//);
  });
  test("every template renders and HTML escapes its data", () => {
    const data = { code: "123456", deviceLabel: "<b>Chrome</b> on Windows", notMeUrl: "http://localhost:8081/not-me/abc", minutes: "15", count: "3" };
    for (const template of [
      "sign_in_code",
      "sign_up_code",
      "reauth_code",
      "new_device",
      "account_locked",
      "mfa_enabled",
      "mfa_disabled",
      "password_changed",
      "recovery_codes_regenerated",
      "sessions_revoked_all",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
  });
  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
  });
  test("the memory mailer records messages and finds the latest code per address", async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "111111" } });
    await mailer.send({ to: "a@b.io", template: "sign_in_code", data: { code: "222222" } });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.lastCodeFor("a@b.io")).toBe("222222");
    expect(mailer.lastCodeFor("c@d.io")).toBeUndefined();
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
    totpPreviousKeys: [],
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

### Replace `apps/api/test/integration/auth-flows-mfa.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { hash } from "@node-rs/argon2";
import { decrypt, parseVersionedKey, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "../../src/auth/flows/mfa";
import { passwordSignIn, setPassword } from "../../src/auth/flows/password";
import { BreachCheckUnavailable, hashPassword, needsRehash } from "../../src/auth/passwords";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS } from "../../src/auth/sessions";
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
    expect(h.mailer.sent.filter((m) => m.template === "password_changed").map((m) => m.to)).toEqual([account.email, account.email]);
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

  test("two-factor setup and confirmation need a fresh session, and the owner is told when it turns on or off", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const stale = (await h.deps.sessions.resolve(account.token))!.session;
    await expect(setupTotp(h.deps, stale)).rejects.toMatchObject({ code: "reauth_required", status: 403 });
    await expect(confirmTotp(h.deps, stale, { code: "000000" })).rejects.toMatchObject({ code: "reauth_required" });

    await h.deps.sessions.markReauth(stale.sessionId);
    const fresh = (await h.deps.sessions.resolve(account.token))!.session;
    const { issued } = await enableMfa(h, { ...account, session: fresh });
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);

    h.clock.advance(30_000);
    await disableTotp(h.deps, issued.session, { code: await currentTotpCode(h, repo, account.user.id) });
    expect(h.mailer.sent.filter((m) => m.template === "mfa_disabled")).toHaveLength(1);
    expect((await h.deps.sessions.resolve(issued.token))!.session.mfaEnabled).toBe(false);
  });

  test("a secret encrypted with a previous key still verifies and is re-encrypted with the current key", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await enableMfa(h, account);
    const v1 = h.deps.config.totpKey;
    const v2 = parseVersionedKey(`v2:${Buffer.alloc(32, 9).toString("base64")}`);
    h.deps.config = { ...h.deps.config, totpKey: v2, totpPreviousKeys: [v1] };

    const before = (await repo.findUserById(account.user.id))!;
    const ticket = await mfaTicketByEmail(h, account);
    const code = hotp(new Uint8Array(decrypt(before.totpSecretEnc!, [v1])), currentStep(h.clock.ms()));
    expect((await verifyMfa(h.deps, { mfaTicket: ticket, code }, h.ctx)).issued.session.mfaEnabled).toBe(true);
    const after = (await repo.findUserById(account.user.id))!;
    expect(after.totpSecretEnc).toMatch(/^v2:/);
    expect(decrypt(after.totpSecretEnc!, [v2])).toEqual(decrypt(before.totpSecretEnc!, [v1]));
  });

  test("a password hashed with older parameters is re-hashed on the next sign-in", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const weak = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    await repo.setPasswordHash(account.user.id, weak, new Date());
    expect(needsRehash(weak)).toBe(true);
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
    const stored = (await repo.findUserById(account.user.id))!.passwordHash!;
    expect(needsRehash(stored)).toBe(false);
    expect(stored).not.toBe(weak);
  });

  test("hashPassword output is accepted by password sign-in on a fresh account", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    await repo.setPasswordHash(account.user.id, await hashPassword(PASSWORD), new Date());
    expect((await passwordSignIn(h.deps, { email: account.email, password: PASSWORD, turnstileToken: "ok", ...account.device }, h.ctx)).kind).toBe("session");
  });
});
```

### Replace `apps/api/test/integration/auth-flows-signup.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { chooseHandle, completeSignup } from "../../src/auth/flows/signup";
import { deviceHash, emailHash } from "../../src/auth/identifiers";
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

  test("finishing a sign-up and choosing a handle are limited to 10 an hour per address and per session", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const { flowId, code } = await start(h, email);
    await verifyEmail(h.deps, { flowId, code }, h.ctx);
    for (let i = 0; i < 10; i++) await h.kv.incr(`rl:signup-complete:ip:${h.ctx.ipHash}`, 3_600_000);
    await expect(completeSignup(h.deps, { flowId, dateOfBirth: "2000-01-01", termsVersion: TEST_TERMS }, h.ctx)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 3600,
    });
    const signedUp = await completeSignup(h.deps, { flowId, dateOfBirth: "2000-01-01", termsVersion: TEST_TERMS }, { ...h.ctx, ipHash: randomToken() });
    for (let i = 0; i < 10; i++) await h.kv.incr(`rl:onboarding-handle:${signedUp.issued.session.sessionId}`, 3_600_000);
    await expect(chooseHandle(h.deps, signedUp.issued.session, { handle: "limited_handle", displayName: "Ada" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("the 'not me' link revokes the device it came from, so its next sign-in is a new device again", async () => {
    const h = flowHarness(repo);
    const email = newEmail();
    const user = await repo.createUser({ email, termsVersion: TEST_TERMS, now: new Date() });
    await repo.markOnboarded(user.id, new Date());
    const device = newDevice();
    const first = await start(h, email, device);
    await verifyEmail(h.deps, { flowId: first.flowId, code: first.code }, h.ctx);
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    await notMe(h.deps, { token: url.slice(url.lastIndexOf("/") + 1) }, h.ctx);
    expect(await repo.findDevice(user.id, deviceHash(h.deps.config.authHmacKey, device.deviceId))).toBeUndefined();
    expect(await repo.listActiveSessions(user.id, h.clock.now())).toHaveLength(0);

    h.clock.advance(61_000);
    const second = await start(h, email, device);
    await verifyEmail(h.deps, { flowId: second.flowId, code: second.code }, h.ctx);
    expect(h.mailer.sent.filter((m) => m.template === "new_device")).toHaveLength(2);
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

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, onboardedUser, wrongCode } from "./flow-harness";

const PASSWORD = "correct horse battery staple";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("re-authenticating with the password or a TOTP code renews the five-minute window; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await repo.enableTotp(account.user.id, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: [], now: new Date() });

    const staleSession = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = (await h.deps.sessions.resolve(account.token))!.session;
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };
    const isFreshNow = async () => h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session);

    let session = await staleSession();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await isFreshNow()).toBe(false);
    await reauthenticate(h.deps, session, { method: "password", password: PASSWORD });
    expect(await isFreshNow()).toBe(true);

    session = await staleSession();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    await reauthenticate(h.deps, session, { method: "totp", code });
    expect(await isFreshNow()).toBe(true);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! })).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! })).rejects.toMatchObject({
      code: "invalid_code",
    });

    await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode });
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode })).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("re-authentication allows five attempts per session every 15 minutes", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    for (let i = 0; i < 5; i++) {
      await expect(reauthenticate(h.deps, account.session, { method: "password", password: "wrong password entirely" })).rejects.toMatchObject({ code: "invalid_credentials" });
    }
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD })).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test" },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId);

    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.sessionId]);

    expect(await revokeSession(h.deps, account.session, second.session.sessionId)).toBe(true);
    expect(await revokeSession(h.deps, account.session, "0".repeat(64))).toBe(false);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();

    await signOut(h.deps, third.session);
    expect(await h.deps.sessions.resolve(third.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' signs out every session, removes the password, and works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const token = randomToken();
    await h.kv.set(notMeKey(token), JSON.stringify({ userId: account.user.id, deviceId: account.session.deviceId }), 60_000);

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toContain("not_me");
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId);
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
```

### Replace `apps/api/test/integration/auth-sessions.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout, LOCK_DURATION_MS } from "../../src/auth/lockout";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, SESSION_IDLE_MS, createSessions } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { fakeClock, newUserWithDevice } from "./auth-fixtures";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.INTEGRATION)("integration: sessions and lockout", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Sessions with a fake clock shared by the cache, so expiry can be tested without waiting. */
  function setup() {
    const clock = fakeClock();
    const kv = new MemoryKv(clock.ms);
    return { clock, kv, sessions: createSessions({ repo, kv, now: clock.now }), lockout: createLockout({ repo, kv, now: clock.now }) };
  }

  test("issued tokens resolve, and only their sha256 identifies the session", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(issued.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(issued.session.sessionId).toBe(sha256Hex(issued.token));
    expect(issued.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.session).toMatchObject({ userId: user.id, deviceId: device.id, role: "user", onboarded: false, mfaEnabled: false });
    expect(await sessions.resolve(`kb1_${"x".repeat(43)}`)).toBeNull();
  });

  test("revocation takes effect immediately, even while the session is cached", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await sessions.revoke(issued.session.sessionId, user.id)).toBe(true);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a revoked session stays revoked while a cache fill is in flight, and a foreign revoke leaves the cache alone", async () => {
    const { kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    const key = `sess:${issued.session.sessionId}`;
    await sessions.resolve(issued.token);
    const other = await newUserWithDevice(repo);
    expect(await sessions.revoke(issued.session.sessionId, other.user.id)).toBe(false);
    expect(await kv.get(key)).not.toBe("revoked");
    expect(await sessions.revoke(issued.session.sessionId, user.id)).toBe(true);
    expect(await kv.get(key)).toBe("revoked");
    expect(await kv.setIfAbsent(key, "a stale copy", 60_000)).toBe(false);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a session cannot be revoked through another user's account", async () => {
    const { sessions } = setup();
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const issued = await sessions.issue(owner.user.id, owner.device.id);
    expect(await sessions.revoke(issued.session.sessionId, other.user.id)).toBe(false);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  test("activity slides the expiry at most once an hour, and the 12-month cap cannot be extended", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    clock.advance(2 * 60 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(true);
    clock.advance(10 * 60 * 1000);
    expect((await sessions.resolve(issued.token))?.slid).toBe(false);
    for (let day = 20; day <= 360; day += 20) {
      clock.advance(20 * DAY);
      expect(await sessions.resolve(issued.token), `day ${day}`).not.toBeNull();
    }
    clock.advance(20 * DAY);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("rotation issues a new token on the same device and revokes the old one", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const first = await sessions.issue(user.id, device.id);
    const second = await sessions.rotate(first.session);
    expect(second.token).not.toBe(first.token);
    expect(second.session.deviceId).toBe(device.id);
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).not.toBeNull();
  });

  test("signing out everywhere revokes every session of the user and lists them first", async () => {
    const { sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const a = await sessions.issue(user.id, device.id);
    const b = await sessions.issue(user.id, device.id);
    const listed = await sessions.list(user.id, a.session.sessionId);
    expect(listed).toHaveLength(2);
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([a.session.sessionId]);
    expect(await sessions.revokeAll(user.id)).toBe(2);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).toBeNull();
  });

  test("re-authentication is fresh for five minutes and can be renewed", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id);
    expect(sessions.isFresh(issued.session)).toBe(true);
    clock.advance(REAUTH_WINDOW_MS + 1_000);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(false);
    await sessions.markReauth(issued.session.sessionId);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(true);
  });

  test("the fifth wrong password in 15 minutes locks password sign-in for 15 minutes", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 1; i <= 4; i++) expect(await lockout.recordFailure(user.id)).toEqual({ failures: i, locked: false });
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 5, locked: true });
    const locked = (await repo.findUserById(user.id))!;
    expect(lockout.isLocked(locked)).toBe(true);
    expect(locked.lockedUntil!.getTime() - clock.ms()).toBe(LOCK_DURATION_MS);
    clock.advance(LOCK_DURATION_MS + 1_000);
    expect(lockout.isLocked(locked)).toBe(false);
  });

  test("a correct password resets the failure count", async () => {
    const { lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    await lockout.recordSuccess(user.id);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
    expect((await repo.findUserById(user.id))!.failedLogins).toBe(1);
  });

  test("failures older than the 15-minute window do not count", async () => {
    const { clock, lockout } = setup();
    const { user } = await newUserWithDevice(repo);
    for (let i = 0; i < 4; i++) await lockout.recordFailure(user.id);
    clock.advance(16 * 60 * 1000);
    expect(await lockout.recordFailure(user.id)).toEqual({ failures: 1, locked: false });
  });
});
```

### Replace `apps/api/test/integration/http-auth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, SessionResult, SessionsResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `h_${randomBytes(6).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: auth over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async (password) => password.includes("breached") },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
    // Routes must be registered before the first request builds the router.
    app.get("/api/test/staff-only", auth.requireSession, auth.requireStaffMfa, (c) => c.text("ok"));
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp(b: Browser, platform: "web" | "ios" = "web") {
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const verify = await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    expect(await verify.json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    return { email, complete };
  }

  test("web sign-up end to end: cookies only, CSRF on state changes, onboarding, me and sessions", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email, complete } = await signUp(b);
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_session="))).toContain("HttpOnly");

    const before = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(before.user).toMatchObject({ email, onboarded: false, hasPassword: false });
    expect(before.profile).toBeNull();

    const firstToken = b.cookie("__Host-korbat_session");
    const handle = newHandle();
    const withoutCsrf = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect(await withoutCsrf.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" } });
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toEqual({ profile: { id: before.user.id, handle, displayName: "Web User" } });
    expect(b.cookie("__Host-korbat_session")).not.toBe(firstToken);

    const after = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(after.user.onboarded).toBe(true);
    expect(after.profile?.handle).toBe(handle);
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);
  });

  test("native clients get the token in the body and never cookies; bearer requests need no CSRF token", async () => {
    const native = new NativeClient(app);
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } });
    const { flowId } = FlowResponse.parse(await start.json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    const complete = await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    const body = SessionResult.parse(await complete.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);

    const onboarded = await app.request("/api/auth/onboarding/handle", {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ handle: newHandle(), displayName: "Phone User" }),
    });
    expect(onboarded.status).toBe(200);
    const { token: rotated } = (await onboarded.json()) as { token?: string };
    expect(rotated).toMatch(/^kb1_/);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${body.token}` } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${rotated}` } })).status).toBe(200);
  });

  test("a browser gets cookies and no token even when it claims a native platform", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { complete } = await signUp(b, "ios");
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().some((c) => c.startsWith("__Host-korbat_session="))).toBe(true);
  });

  test("malformed JSON is a 400 with the error envelope, not a 500", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const res = await b.fetch("/api/auth/email/verify", { raw: { type: "application/json", body: new TextEncoder().encode("{not json") } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("revoking one session needs fresh re-authentication", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
    const revoke = await b.fetch(`/api/auth/sessions/${"0".repeat(64)}`, { method: "DELETE" });
    expect(revoke.status).toBe(403);
    expect(await revoke.json()).toMatchObject({ error: { code: "reauth_required" } });
  });

  test("other origins cannot change state; no session gets 401; unfinished onboarding gets 403", async () => {
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/auth/email/start", { json: { email: "a@b.io", turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const anonymous = await app.request("/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const sessions = await b.fetch("/api/auth/sessions");
    expect(sessions.status).toBe(403);
    expect(await sessions.json()).toMatchObject({ error: { code: "onboarding_required" } });
  });

  test("sensitive routes need fresh re-authentication, which an emailed code provides", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const token = b.cookie("__Host-korbat_session")!;
    const sessionId = sha256Hex(token);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);

    const blocked = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "reauth_required" } });

    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(204);

    const set = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    expect(b.cookie("__Host-korbat_session")).not.toBe(token);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.hasPassword).toBe(true);
  });

  test("staff-only routes require a staff role and MFA", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Staff" } });
    const regular = await b.fetch("/api/test/staff-only");
    expect(regular.status).toBe(403);
    expect(await regular.json()).toMatchObject({ error: { code: "forbidden" } });

    const user = (await auth.deps.repo.findUserByEmail(email))!;
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setRole(user.id, "moderator");
    await auth.deps.kv.del(`sess:${sessionId}`);
    const withoutMfa = await b.fetch("/api/test/staff-only");
    expect(withoutMfa.status).toBe(403);
    expect(await withoutMfa.json()).toMatchObject({ error: { code: "staff_mfa_required" } });

    await auth.deps.repo.enableTotp(user.id, { secretEnc: "v1:unused", recoveryCodesHash: [], now: new Date() });
    await auth.deps.kv.del(`sess:${sessionId}`);
    expect((await b.fetch("/api/test/staff-only")).status).toBe(200);
  });

  test("signing out clears both cookies and ends the session", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const token = b.cookie("__Host-korbat_session")!;
    const signedOut = await b.fetch("/api/auth/signout", { method: "POST" });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
  });

  test("validation and flow errors use the error envelope with the request id", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const invalid = await b.fetch("/api/auth/email/verify", { json: { flowId: "nope", code: "12" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unknown = await b.fetch("/api/auth/email/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(unknown.status).toBe(400);
    const body = ErrorEnvelope.parse(await unknown.json());
    expect(body.error.code).toBe("invalid_code");
    expect(body.error.requestId).toBe(unknown.headers.get("x-request-id"));
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  3 failed | 141 passed | 148 skipped (292)`

Observed on the dry run:

```text
Tests  3 failed | 141 passed | 148 skipped (292)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/03-auth-hardening.md 3
```

Expected: 19 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/flows/notify.ts`

```ts
import type { TemplateName } from "../../mail/mailer";
import type { AuthDeps } from "../context";

/** A notice about a security-relevant change. Best effort: a failed send is logged and never undoes the change. */
export async function notifyAccount(deps: AuthDeps, to: string, template: TemplateName, data: Record<string, string> = {}): Promise<void> {
  try {
    await deps.mailer.send({ to, template, data });
  } catch (err) {
    deps.log.error({ err, template }, "security notice email failed");
  }
}
```

### Replace `apps/api/src/auth/flows/not-me.ts` (whole file)

```ts
import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { HOUR, enforceLimit } from "../limits";
import { notMeKey, type NotMeToken } from "./signin";

/**
 * "This wasn't me" from a new-device email: signs out every session, revokes the device the alert was
 * about (its next sign-in counts as a new device again) and removes the password, so the next sign-in
 * needs the email inbox (and MFA when enabled). The link works once, for 24 hours.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const raw = await deps.kv.take(notMeKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, "This link has expired or was already used.");
  const link: NotMeToken = raw.startsWith("{") ? (JSON.parse(raw) as NotMeToken) : { userId: raw, deviceId: null };
  await deps.sessions.revokeAll(link.userId);
  if (link.deviceId) await deps.repo.revokeDevice(link.deviceId, deps.now());
  await deps.repo.setPasswordHash(link.userId, null, deps.now());
  await deps.repo.appendEvent({ userId: link.userId, type: "not_me", deviceId: link.deviceId, ipHash: ctx.ipHash });
}
```

### Replace `apps/api/src/config.ts` (whole file)

```ts
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(auth.resolveSession);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (media) app.route("/api/media", media.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

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
  /** Keys TOTP_ENC_KEY replaced; still accepted for decryption. */
  totpPreviousKeys: VersionedKey[];
  termsVersion: string;
}

export function authConfigFrom(config: Config): AuthConfig {
  return {
    appOrigin: config.APP_ORIGIN,
    allowedOrigins: [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    authHmacKey: decodeKey(config.AUTH_HMAC_KEY),
    ipHashKey: decodeKey(config.IP_HASH_KEY),
    totpKey: parseVersionedKey(config.TOTP_ENC_KEY),
    totpPreviousKeys: config.TOTP_ENC_KEYS_PREVIOUS.map(parseVersionedKey),
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

export function authErrorMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: AuthErrorStatus,
    message: string = MESSAGES[code],
    /** For rate limits: seconds until the window resets, sent as Retry-After. */
    readonly retryAfterSeconds?: number,
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

### Replace `apps/api/src/auth/crypto.ts` (whole file)

```ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_TOKEN_PREFIX = "kb1_";

/** Random bytes as base64url without padding. 32 bytes gives 43 characters. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacHex(key: Buffer, input: string): string {
  return createHmac("sha256", key).update(input).digest("hex");
}

/** Constant-time string comparison that does not throw when lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function decodeKey(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

export interface VersionedKey {
  version: string;
  key: Buffer;
}

/** Parses `v<N>:<base64 of 32 bytes>`. */
export function parseVersionedKey(value: string): VersionedKey {
  const m = /^(v\d+):(.+)$/.exec(value);
  if (!m) throw new Error("encryption key must be versioned, e.g. v1:<base64>");
  const key = Buffer.from(m[2]!, "base64");
  if (key.length !== 32) throw new Error("encryption key must be exactly 32 bytes");
  return { version: m[1]!, key };
}

const IV_BYTES = 12;
/** The full GCM tag. Pinned on both sides so a forged, shorter tag can never be accepted. */
const TAG_BYTES = 16;

/** AES-256-GCM. Output: `<version>:<base64(iv[12] | tag[16] | ciphertext)>`. */
export function encrypt(plain: Buffer, k: VersionedKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${k.version}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decrypt(payload: string, keys: VersionedKey[]): Buffer {
  const m = /^(v\d+):(.+)$/.exec(payload);
  if (!m) throw new Error("malformed ciphertext");
  const k = keys.find((x) => x.version === m[1]);
  if (!k) throw new Error(`no key for version ${m[1]}`);
  const raw = Buffer.from(m[2]!, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", k.key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** The key version a ciphertext was made with, or null when it is not of the expected shape. */
export function payloadVersion(payload: string): string | null {
  return /^(v[0-9]+):/.exec(payload)?.[1] ?? null;
}

/** A session token for the client and the id stored in auth.sessions (its sha256). */
export function newSessionToken(): { token: string; id: string } {
  const token = SESSION_TOKEN_PREFIX + randomToken(32);
  return { token, id: sha256Hex(token) };
}
```

### Replace `apps/api/src/auth/limits.ts` (whole file)

```ts
import { AuthError } from "./context";
import type { KeyValueStore } from "./kv";

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

/** Counts one event in a fixed window and rejects once the count exceeds `max`. */
export async function enforceLimit(kv: KeyValueStore, bucket: string, max: number, windowMs: number): Promise<void> {
  const count = await kv.incr(`rl:${bucket}`, windowMs);
  if (count > max) throw new AuthError("rate_limited", 429, undefined, Math.ceil(windowMs / 1000));
}

/** Resolves only after at least `minMs` of wall-clock time since `startedAt`, so fast and slow paths look alike. */
export async function padResponseTime(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, sessions, userRole, users, type Db } from "@korbat/db";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionListRow {
  id: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    // ------------------------------------------------------------ sessions

    async createSession(input: { id: string; userId: string; deviceId: string; now: Date; expiresAt: Date; absoluteExpiresAt: Date }): Promise<void> {
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    async setReauth(id: string, now: Date): Promise<void> {
      await db.update(sessions).set({ reauthAt: now }).where(eq(sessions.id, id));
    },

    /** Revokes one session of this user. False when it does not belong to the user or is already revoked. */
    async revokeSession(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },
  };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/sessions.ts` (whole file)

```ts
import type { Platform, Role, SessionInfo } from "@korbat/contracts";
import { newSessionToken, sha256Hex } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { ActiveSessionRow, AuthRepo } from "./repo";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface Session {
  /** sha256 of the token; never the token itself. */
  sessionId: string;
  userId: string;
  deviceId: string;
  role: Role;
  onboarded: boolean;
  mfaEnabled: boolean;
  reauthAt: Date;
}

export interface IssuedSession {
  token: string;
  session: Session;
  /** Cookie Max-Age matching the idle expiry. */
  maxAgeSeconds: number;
}

interface CachedSession {
  session: Omit<Session, "reauthAt"> & { reauthAt: string };
  absoluteExpiresAt: string;
}

export function createSessions(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const cacheKey = (sessionId: string) => `sess:${sessionId}`;
  const REVOKED = "revoked";

  const fromRow = (row: ActiveSessionRow): Session => ({
    sessionId: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    role: row.role,
    onboarded: row.onboardedAt !== null,
    mfaEnabled: row.totpEnabledAt !== null,
    reauthAt: row.reauthAt,
  });

  async function forget(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.del(cacheKey(id))));
  }

  /** A tombstone that outlives any cache fill in flight, so a revoked session cannot come back for the cache TTL. */
  async function tombstone(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.set(cacheKey(id), REVOKED, SESSION_CACHE_TTL_MS)));
  }

  /** Drops the cached copy of every live session of the user, after a change to what a session carries. */
  async function forgetUser(userId: string) {
    const rows = await deps.repo.listActiveSessions(userId, now());
    await forget(rows.map((r) => r.id));
  }

  /** A new session; its reauth time is now, because issuing one always follows a fresh credential. */
  async function issue(userId: string, deviceId: string): Promise<IssuedSession> {
    const t = now();
    const { token, id } = newSessionToken();
    await deps.repo.createSession({
      id,
      userId,
      deviceId,
      now: t,
      expiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.getTime() + SESSION_ABSOLUTE_MS),
    });
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) throw new Error("session not found immediately after it was created");
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /**
   * Resolves a token to a live session. Results are cached for 60 seconds; revocation writes a
   * tombstone over the entry and a fill never overwrites one, so it takes effect at once. `slid` is
   * true when the idle expiry was just extended
   * (callers refresh the cookie then).
   */
  async function resolve(token: string): Promise<{ session: Session; slid: boolean } | null> {
    const id = sha256Hex(token);
    const t = now();
    const cached = await deps.kv.get(cacheKey(id));
    if (cached === REVOKED) return null;
    if (cached) {
      const c = JSON.parse(cached) as CachedSession;
      if (new Date(c.absoluteExpiresAt).getTime() > t.getTime()) {
        return { session: { ...c.session, reauthAt: new Date(c.session.reauthAt) }, slid: false };
      }
    }
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) return null;
    let slid = false;
    if (t.getTime() - row.lastUsedAt.getTime() >= SESSION_SLIDE_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(t.getTime() + SESSION_IDLE_MS, row.absoluteExpiresAt.getTime()));
      await deps.repo.slideSession(id, expiresAt, t);
      slid = true;
    }
    const session = fromRow(row);
    const entry: CachedSession = {
      session: { ...session, reauthAt: session.reauthAt.toISOString() },
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
    await deps.kv.setIfAbsent(cacheKey(id), JSON.stringify(entry), SESSION_CACHE_TTL_MS);
    return { session, slid };
  }

  async function revoke(sessionId: string, userId: string): Promise<boolean> {
    const revoked = await deps.repo.revokeSession(sessionId, userId, now());
    if (revoked) await tombstone([sessionId]);
    return revoked;
  }

  async function revokeAll(userId: string): Promise<number> {
    const ids = await deps.repo.revokeAllSessions(userId, now());
    await tombstone(ids);
    return ids.length;
  }

  /** Issues a replacement for `current` on the same device and revokes `current`. */
  async function rotate(current: Session): Promise<IssuedSession> {
    const next = await issue(current.userId, current.deviceId);
    await revoke(current.sessionId, current.userId);
    return next;
  }

  async function markReauth(sessionId: string): Promise<void> {
    await deps.repo.setReauth(sessionId, now());
    await forget([sessionId]);
  }

  function isFresh(session: Session, windowMs: number = REAUTH_WINDOW_MS): boolean {
    return now().getTime() - session.reauthAt.getTime() <= windowMs;
  }

  async function list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await deps.repo.listActiveSessions(userId, now());
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel ?? "Unknown device",
      platform: r.platform as Platform,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      current: r.id === currentSessionId,
    }));
  }

  return { issue, resolve, revoke, revokeAll, rotate, markReauth, forgetUser, isFresh, list };
}

export type Sessions = ReturnType<typeof createSessions>;
```

### Replace `apps/api/src/auth/routes.ts` (whole file)

```ts
import {
  EmailStartRequest,
  EmailVerifyRequest,
  MfaVerifyRequest,
  NotMeRequest,
  OnboardingHandleRequest,
  PasswordSetRequest,
  PasswordSigninRequest,
  ReauthRequest,
  SignupCompleteRequest,
  TotpCodeRequest,
  type Platform,
} from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { clientIp } from "../middleware/rate-limit";
import { AuthError, type AuthDeps, type RequestContext } from "./context";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "./flows/account";
import { startEmail, verifyEmail } from "./flows/email";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { ipHash } from "./identifiers";
import { requireFreshAuth, requireOnboarding, requireSession } from "./middleware";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);

  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: ipHash(deps.config.ipHashKey, clientIp(c)),
    userAgent: c.req.header("user-agent"),
  });
  const currentSession = (c: Context<AppEnv>): Session => c.get("session")!;

  /**
   * Browsers always send Sec-Fetch-Mode and, on state changes, Origin; native apps send neither. A
   * request from a browser is a web session whatever the body says, so it gets cookies, never a token.
   */
  const fromBrowser = (c: Context<AppEnv>): boolean => c.req.header("sec-fetch-mode") !== undefined || c.req.header("origin") !== undefined;
  const asWeb = <T extends { platform: Platform }>(c: Context<AppEnv>, input: T): T => (fromBrowser(c) ? { ...input, platform: "web" } : input);

  /** Web: cookies only, never the token in the body. Native: the bearer token in the body, no cookies. */
  const sessionIssued = (c: Context<AppEnv>, signed: SignedIn) => {
    if (signed.platform === "web") {
      setSessionCookies(c, signed.issued.token, signed.issued.maxAgeSeconds);
      return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa });
    }
    return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa, token: signed.issued.token });
  };

  const firstFactor = (c: Context<AppEnv>, outcome: SignedIn | MfaPending) =>
    outcome.kind === "mfa" ? c.json({ result: "mfa_required" as const, mfaTicket: outcome.mfaTicket }) : sessionIssued(c, outcome);

  /** After a flow rotated the current session: fresh cookies for web, the new token for native. */
  const rotated = (c: Context<AppEnv>, issued: IssuedSession): { token?: string } => {
    if (c.get("authVia") === "cookie") {
      setSessionCookies(c, issued.token, issued.maxAgeSeconds);
      return {};
    }
    return { token: issued.token };
  };

  r.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in auth route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  r.post("/email/start", validate("json", EmailStartRequest), async (c) => c.json(await startEmail(deps, asWeb(c, c.req.valid("json")), requestContext(c))));

  r.post("/email/verify", validate("json", EmailVerifyRequest), async (c) => {
    const outcome = await verifyEmail(deps, c.req.valid("json"), requestContext(c));
    if (outcome.kind === "signup_required") return c.json({ result: "signup_required" as const });
    return firstFactor(c, outcome);
  });

  r.post("/signup/complete", validate("json", SignupCompleteRequest), async (c) =>
    sessionIssued(c, await completeSignup(deps, c.req.valid("json"), requestContext(c))),
  );

  r.post("/onboarding/handle", requireOnboarding, validate("json", OnboardingHandleRequest), async (c) => {
    const { profile, issued } = await chooseHandle(deps, currentSession(c), c.req.valid("json"));
    return c.json({ profile, ...rotated(c, issued) });
  });

  r.post("/password/signin", validate("json", PasswordSigninRequest), async (c) =>
    firstFactor(c, await passwordSignIn(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  r.post("/password/set", requireSession, fresh, validate("json", PasswordSetRequest), async (c) =>
    c.json(rotated(c, await setPassword(deps, currentSession(c), c.req.valid("json")))),
  );

  r.post("/mfa/verify", validate("json", MfaVerifyRequest), async (c) => sessionIssued(c, await verifyMfa(deps, c.req.valid("json"), requestContext(c))));

  r.post("/mfa/totp/setup", requireSession, fresh, async (c) => c.json(await setupTotp(deps, currentSession(c))));

  r.post("/mfa/totp/confirm", requireSession, fresh, validate("json", TotpCodeRequest), async (c) => {
    const { recoveryCodes, issued } = await confirmTotp(deps, currentSession(c), c.req.valid("json"));
    return c.json({ recoveryCodes, ...rotated(c, issued) });
  });

  r.post("/mfa/totp/disable", requireSession, fresh, validate("json", TotpCodeRequest), async (c) => {
    await disableTotp(deps, currentSession(c), c.req.valid("json"));
    return c.body(null, 204);
  });

  r.post("/mfa/recovery-codes/regenerate", requireSession, fresh, async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(deps, currentSession(c)) }));

  r.post("/reauth/email/start", requireOnboarding, async (c) => c.json(await startReauthEmail(deps, currentSession(c), requestContext(c))));

  r.post("/reauth", requireOnboarding, validate("json", ReauthRequest), async (c) => {
    await reauthenticate(deps, currentSession(c), c.req.valid("json"));
    return c.body(null, 204);
  });

  r.get("/sessions", requireSession, async (c) => c.json(await listSessions(deps, currentSession(c))));

  r.delete("/sessions/:id", requireSession, fresh, validate("param", z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) })), async (c) => {
    const revoked = await revokeSession(deps, currentSession(c), c.req.valid("param").id);
    return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
  });

  r.post("/sessions/revoke-all", requireSession, fresh, async (c) => {
    await revokeAllSessions(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/signout", requireOnboarding, async (c) => {
    await signOut(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/not-me", validate("json", NotMeRequest), async (c) => {
    await notMe(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  return r;
}

/** GET /api/me, mounted by the app behind requireOnboarding. */
export function meHandler(deps: AuthDeps) {
  return async (c: Context<AppEnv>) => c.json(await me(deps, c.get("session")!));
}
```

### Replace `apps/api/src/auth/flows/mfa.ts` (whole file)

```ts
import type { MfaVerifyRequest, TotpCodeRequest, TotpSetupResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { decrypt, encrypt, payloadVersion } from "../crypto";
import { MINUTE, enforceLimit } from "../limits";
import { hashRecoveryCode, newRecoveryCodes } from "../recovery-codes";
import type { UserRow } from "../repo";
import type { IssuedSession, Session } from "../sessions";
import { newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../totp";
import { notifyAccount } from "./notify";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type MfaTicket, type SignedIn } from "./signin";

export const TOTP_PENDING_TTL_MS = 10 * MINUTE;
export const MAX_MFA_ATTEMPTS = 5;

export const totpPendingKey = (userId: string) => `totp-pending:${userId}`;

/**
 * The account's TOTP secret. Previous keys are accepted so that TOTP_ENC_KEY can rotate; a secret
 * still encrypted with an earlier key is re-encrypted with the current one as soon as it is read.
 */
export async function storedSecret(deps: AuthDeps, user: UserRow): Promise<Uint8Array> {
  if (!user.totpSecretEnc) throw new AuthError("mfa_required", 400);
  const secret = decrypt(user.totpSecretEnc, [deps.config.totpKey, ...deps.config.totpPreviousKeys]);
  if (payloadVersion(user.totpSecretEnc) !== deps.config.totpKey.version) {
    await deps.repo.setTotpSecretEnc(user.id, encrypt(secret, deps.config.totpKey));
  }
  return new Uint8Array(secret);
}

/** Verifies a TOTP code and claims its time step atomically, so the same code cannot be used twice. */
async function acceptTotp(deps: AuthDeps, user: UserRow, code: string): Promise<boolean> {
  const step = verifyTotp(await storedSecret(deps, user), code, user.totpLastStep, deps.now().getTime());
  return step !== null && (await deps.repo.claimTotpStep(user.id, step));
}

/** Starts setup with a new secret held encrypted for 10 minutes. Needs a fresh session (the route checks as well). */
export async function setupTotp(deps: AuthDeps, session: Session): Promise<TotpSetupResponse> {
  if (!deps.sessions.isFresh(session)) throw new AuthError("reauth_required", 403);
  const secret = newTotpSecret();
  await deps.kv.set(totpPendingKey(session.userId), encrypt(Buffer.from(secret), deps.config.totpKey), TOTP_PENDING_TTL_MS);
  const profile = await deps.profiles.find(session.userId);
  const otpauthUri = totpUri(secret, profile?.handle ?? "account");
  return { otpauthUri, qrSvg: totpQrSvg(otpauthUri) };
}

/** Turns MFA on with the pending secret, issues 10 recovery codes (shown once), rotates the session and tells the owner. */
export async function confirmTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<{ recoveryCodes: string[]; issued: IssuedSession }> {
  if (!deps.sessions.isFresh(session)) throw new AuthError("reauth_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
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
  const issued = await deps.sessions.rotate(session);
  await notifyAccount(deps, user.email, "mfa_enabled");
  return { recoveryCodes, issued };
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

/** Turns MFA off (the route requires fresh auth) and tells the owner. Staff accounts can never turn it off. */
export async function disableTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<void> {
  if (session.role !== "user") throw new AuthError("staff_mfa_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpSecretEnc) throw new AuthError("mfa_required", 400);
  if (!(await acceptTotp(deps, user, input.code))) throw new AuthError("invalid_mfa_code", 400);
  await deps.repo.disableTotp(user.id);
  await deps.sessions.forgetUser(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "mfa_disabled", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "mfa_disabled");
}

/** Replaces all recovery codes (the route requires fresh auth) and tells the owner. The old codes stop working. */
export async function regenerateRecoveryCodes(deps: AuthDeps, session: Session): Promise<string[]> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpEnabledAt) throw new AuthError("mfa_required", 400);
  const recoveryCodes = newRecoveryCodes();
  await deps.repo.setRecoveryCodes(user.id, recoveryCodes.map((code) => hashRecoveryCode(deps.config.authHmacKey, code)));
  await deps.repo.appendEvent({ userId: user.id, type: "recovery_codes_regenerated", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "recovery_codes_regenerated");
  return recoveryCodes;
}
```

### Replace `apps/api/src/auth/flows/reauth.ts` (whole file)

```ts
import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { verifyPassword } from "../passwords";
import type { Session } from "../sessions";
import { verifyTotp } from "../totp";
import { storedSecret } from "./mfa";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, newEmailCode, sendCode } from "./email";

/** Sends a code that can only re-authenticate this account (never sign anyone in). */
export async function startReauthEmail(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<{ flowId: string }> {
  await enforceLimit(deps.kv, `reauth-email:${session.sessionId}`, 3, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "reauth",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  await sendCode(deps, { to: user.email, template: "reauth_code", data: { code } });
  return { flowId };
}

/**
 * Proves possession of a credential again and renews the session's five-minute re-auth window.
 * Five attempts per session every 15 minutes; wrong passwords also count towards the lockout.
 */
export async function reauthenticate(deps: AuthDeps, session: Session, input: ReauthRequest): Promise<void> {
  await enforceLimit(deps.kv, `reauth:${session.sessionId}`, 5, 15 * MINUTE);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);

  switch (input.method) {
    case "password": {
      const usable = user.passwordHash !== null && !deps.lockout.isLocked(user);
      const ok = await verifyPassword(usable ? user.passwordHash : null, input.password);
      if (!ok) {
        if (usable) await deps.lockout.recordFailure(user.id);
        throw new AuthError("invalid_credentials", 401);
      }
      await deps.lockout.recordSuccess(user.id);
      break;
    }
    case "totp": {
      const secret = await storedSecret(deps, user);
      const step = verifyTotp(secret, input.code, user.totpLastStep, deps.now().getTime());
      if (step === null || !(await deps.repo.claimTotpStep(user.id, step))) throw new AuthError("invalid_mfa_code", 401);
      break;
    }
    case "email": {
      const row = await deps.repo.findEmailCode(input.flowId);
      if (row?.purpose !== "reauth" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
      await checkEmailCode(deps, row, input.flowId, input.code);
      break;
    }
  }

  await deps.sessions.markReauth(session.sessionId);
}
```

### Replace `apps/api/src/auth/flows/password.ts` (whole file)

```ts
import type { PasswordSetRequest, PasswordSigninRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { MINUTE, enforceLimit } from "../limits";
import { LOCK_DURATION_MS } from "../lockout";
import { BreachCheckUnavailable, checkPasswordLength, hashPassword, needsRehash, verifyPassword } from "../passwords";
import type { IssuedSession, Session } from "../sessions";
import { notifyAccount } from "./notify";
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
  // A hash made with older parameters is replaced while the password is at hand.
  if (needsRehash(user.passwordHash)) await deps.repo.replacePasswordHash(user.id, await hashPassword(input.password));
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
  const issued = await deps.sessions.rotate(session);
  await notifyAccount(deps, user.email, "password_changed");
  return issued;
}
```

### Replace `apps/api/src/auth/flows/account.ts` (whole file)

```ts
import type { MeResponse, SessionsResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps } from "../context";
import type { Session } from "../sessions";
import { notifyAccount } from "./notify";

/** The signed-in account. The only response in the API that contains the email address. */
export async function me(deps: AuthDeps, session: Session): Promise<MeResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      onboarded: user.onboardedAt !== null,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
    },
    profile: await deps.profiles.find(user.id),
  };
}

export async function listSessions(deps: AuthDeps, session: Session): Promise<SessionsResponse> {
  return { sessions: await deps.sessions.list(session.userId, session.sessionId) };
}

/** Revokes one of the user's own sessions. False when no such live session belongs to them. */
export async function revokeSession(deps: AuthDeps, session: Session, sessionId: string): Promise<boolean> {
  const revoked = await deps.sessions.revoke(sessionId, session.userId);
  if (revoked) await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { sessionId } });
  return revoked;
}

/** Signs out every session of the account, including the current one (the route requires fresh auth). */
export async function revokeAllSessions(deps: AuthDeps, session: Session): Promise<number> {
  const user = await deps.repo.findUserById(session.userId);
  const count = await deps.sessions.revokeAll(session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "sessions_revoked_all", deviceId: session.deviceId, metadata: { count } });
  if (user) await notifyAccount(deps, user.email, "sessions_revoked_all", { count: String(count) });
  return count;
}

export async function signOut(deps: AuthDeps, session: Session): Promise<void> {
  await deps.sessions.revoke(session.sessionId, session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { signOut: true } });
}
```

### Replace `apps/api/src/auth/flows/signin.ts` (whole file)

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

/** What a "this wasn't me" link acts on: the account, and the device the alert was about. */
export interface NotMeToken {
  userId: string;
  deviceId: string | null;
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
  const link: NotMeToken = { userId: user.id, deviceId: device.id };
  await deps.kv.set(notMeKey(token), JSON.stringify(link), NOT_ME_TTL_MS);
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

### Replace `apps/api/src/auth/flows/email.ts` (whole file)

```ts
import { randomInt } from "node:crypto";
import type { EmailStartRequest, EmailVerifyRequest } from "@korbat/contracts";
import { MailUnavailable } from "../../mail/mailer";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { hmacHex, randomToken, safeEqual, sha256Hex } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { EmailCodeRow } from "../repo";
import { firstFactorPassed, type DeviceInput, type MfaPending, type SignedIn } from "./signin";

export const CODE_TTL_MS = 10 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;
export const MIN_START_RESPONSE_MS = 400;

/** A flow id is a bearer credential while its sign-up is pending, so the store holds only its hash. */
export const flowKey = (flowId: string) => `flow:${sha256Hex(flowId)}`;
export const signupKey = (flowId: string) => `signup:${sha256Hex(flowId)}`;
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
    await enforceLimit(deps.kv, `email-start:ip:${ctx.ipHash}`, 10, HOUR);
    // After the per-address limit, so the age block of an address cannot be probed faster than codes could be
    // requested, and before the per-email cooldown, which would otherwise hide the block behind a 429 for a minute.
    if (await deps.kv.get(ageBlockKey(hashedEmail))) throw new AuthError("age_requirement", 403);
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

### Replace `apps/api/src/auth/flows/signup.ts` (whole file)

```ts
import type { OnboardingHandleRequest, Profile, SignupCompleteRequest } from "@korbat/contracts";
import { meetsMinimumAge } from "../age";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { checkHandle } from "../handles";
import { emailHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
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
  await enforceLimit(deps.kv, `signup-complete:ip:${ctx.ipHash}`, 10, HOUR);
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
  await enforceLimit(deps.kv, `onboarding-handle:${session.sessionId}`, 10, HOUR);
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

### Replace `apps/api/src/mail/mailer.ts` (whole file)

```ts
export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /** Throws MailUnavailable when the message could not be handed to the relay. */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}
```

### Replace `apps/api/src/mail/templates.ts` (whole file)

```ts
import type { TemplateName } from "./mailer";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function need(data: Record<string, string>, key: string): string {
  const value = data[key];
  if (value === undefined || value === "") throw new Error(`mail template data is missing "${key}"`);
  return value;
}

/** Plain paragraphs only: no images, no tracking, no anchor tags. URLs appear as text. */
function build(subject: string, paragraphs: string[]): RenderedMail {
  return {
    subject,
    text: `${paragraphs.join("\n\n")}\n`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("")}</body></html>`,
  };
}

export function renderTemplate(template: TemplateName, data: Record<string, string>): RenderedMail {
  switch (template) {
    case "sign_in_code":
      return build("Your korbat sign-in code", [
        `Your sign-in code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to sign in, you can ignore this email; nobody can sign in without the code.",
      ]);
    case "sign_up_code":
      return build("Your korbat sign-up code", [
        `Your sign-up code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not try to create a korbat account, you can ignore this email.",
      ]);
    case "reauth_code":
      return build("Confirm it's you on korbat", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. korbat asks for it before sensitive account changes.",
      ]);
    case "new_device":
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours to sign out every session and remove your password: ${need(data, "notMeUrl")}`,
      ]);
    case "account_locked":
      return build("Password sign-in paused on your korbat account", [
        `After several wrong passwords, password sign-in is paused for ${need(data, "minutes")} minutes.`,
        "You can still sign in with an emailed code. If you did not try to sign in, consider turning on two-factor authentication.",
      ]);
    case "mfa_enabled":
      return build("Two-factor authentication is on for your korbat account", [
        "Two-factor authentication was just turned on for your korbat account, and a new set of recovery codes was issued.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "mfa_disabled":
      return build("Two-factor authentication is off for your korbat account", [
        "Two-factor authentication was just turned off for your korbat account.",
        "If this was you, there is nothing to do. If not, sign in, open Security, turn it back on and sign out everywhere.",
      ]);
    case "password_changed":
      return build("Your korbat password changed", [
        "The password of your korbat account was just set or changed.",
        "If this was you, there is nothing to do. If not, sign in with an emailed code, open Security, set a new password and sign out everywhere.",
      ]);
    case "recovery_codes_regenerated":
      return build("New recovery codes for your korbat account", [
        "A new set of recovery codes was just issued for your korbat account. The old codes no longer work.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "sessions_revoked_all":
      return build("Signed out everywhere on korbat", [
        `Every session of your korbat account was just signed out (${need(data, "count")} in total).`,
        "If this was you, there is nothing to do. If not, sign in and set a new password.",
      ]);
  }
}
```

## Step 4: verify: typecheck

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

## Step 5: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  144 passed | 148 skipped (292)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  144 passed | 148 skipped (292)
```

## Step 6: verify: integration

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml && cd apps/api && pnpm test:integration
```

Expected output contains:

- `Tests  147 passed (147)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  147 passed (147)
```

## Step 7: verify: boundary

```bash
grep -rn "from \"../auth/\|from \"./auth/" apps/api/src --include=*.ts | grep -v "^apps/api/src/auth/" | grep -v "from \"./auth\"" | grep -v "from \"../auth\""; echo boundary-checked
```

Expected output contains:

- `boundary-checked`

Observed on the dry run:

```text
boundary-checked
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/app.ts`
- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/crypto.ts`
- `apps/api/src/auth/flows/account.ts`
- `apps/api/src/auth/flows/email.ts`
- `apps/api/src/auth/flows/mfa.ts`
- `apps/api/src/auth/flows/not-me.ts`
- `apps/api/src/auth/flows/notify.ts`
- `apps/api/src/auth/flows/password.ts`
- `apps/api/src/auth/flows/reauth.ts`
- `apps/api/src/auth/flows/signin.ts`
- `apps/api/src/auth/flows/signup.ts`
- `apps/api/src/auth/limits.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/sessions.ts`
- `apps/api/src/config.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/test/auth/limits.test.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/auth-flows-mfa.test.ts`
- `apps/api/test/integration/auth-flows-signup.test.ts`
- `apps/api/test/integration/auth-sessions.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/mail/templates.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "fix(auth): two-factor enrolment and revoking a session need fresh authentication; owners are emailed when two-factor, the password, recovery codes or every session changes; the not-me link revokes its device; flow ids are hashed in the store; sign-up completion and handle choice are limited; browser requests are web sessions whatever they claim; revocation tombstones outlive cache fills; passwords are re-hashed on sign-in; previous TOTP keys decrypt and re-encrypt; malformed JSON is a 400" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(auth): two-factor enrolment and revoking a session need fresh authentication; owners are emailed when two-factor, the password, recovery codes or every session changes; the not-me link revokes its device; flow ids are hashed in the store; sign-up completion and handle choice are limited; browser requests are web sessions whatever they claim; revocation tombstones outlive cache fills; passwords are re-hashed on sign-in; previous TOTP keys decrypt and re-encrypt; malformed JSON is a 400`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 28>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "boundary": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
