# korbat 1a — Task 18 of 21: Auth end to end over HTTP against Postgres, Redis and Mailpit, with timing checks

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

End-to-end tests drive the whole module over HTTP against real Postgres, Redis and Mailpit: sign-up with codes read from Mailpit, new-device alerts and 'this wasn't me', lockout and its expiry, the full MFA lifecycle, session management behind re-authentication, the age gate, and schema isolation. Timing tests prove that known and unknown emails take the same time.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): architecture test enforcing the auth module boundary; grant-role CLI with audit log entry`.
3. The previous task's last API unit run ended with `Tests  88 passed | 58 skipped (146)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely.
2. Run every command exactly as written, in order, from the repo root.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

### Create `apps/api/test/integration/http-client.ts`

```ts
import { randomInt } from "node:crypto";

/** Anything with Hono's `app.request`. */
export interface RequestApp {
  request(path: string, init?: RequestInit): Response | Promise<Response>;
}

interface FetchInit {
  method?: string;
  json?: unknown;
  /** Web only: send the X-CSRF-Token header (default true). */
  csrf?: boolean;
}

/**
 * A distinct client address per test client, sent as cf-connecting-ip, so per-IP rate limits in one
 * test never affect another.
 */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** A minimal browser: keeps cookies, sends Origin on state changes and echoes the CSRF cookie in X-CSRF-Token. */
export class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: RequestApp,
    private readonly origin: string,
    private readonly ip: string = randomIp(),
  ) {}

  async fetch(path: string, init: FetchInit = {}): Promise<Response> {
    const method = init.method ?? (init.json === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip };
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (method !== "GET") headers.origin = this.origin;
    const csrf = this.cookies.get("__Host-korbat_csrf");
    if (init.csrf !== false && csrf) headers["x-csrf-token"] = csrf;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    const res = await this.app.request(path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split("; ");
      const separator = pair!.indexOf("=");
      const name = pair!.slice(0, separator);
      if (attributes.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, pair!.slice(separator + 1));
    }
    return res;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** A native app: no cookies and no Origin header; sends the bearer token once it has one. */
export class NativeClient {
  token: string | undefined;

  constructor(
    private readonly app: RequestApp,
    private readonly ip: string = randomIp(),
  ) {}

  fetch(path: string, init: Omit<FetchInit, "csrf"> = {}): Response | Promise<Response> {
    const method = init.method ?? (init.json === undefined ? "GET" : "POST");
    const headers: Record<string, string> = { "cf-connecting-ip": this.ip };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";
    return this.app.request(path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  }
}
```

### Create `apps/api/test/integration/http-e2e.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  FlowResponse,
  MeResponse,
  RecoveryCodesResponse,
  SessionResult,
  SessionsResponse,
  SignInResponse,
  TotpSetupResponse,
} from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { hashPassword } from "../../src/auth/passwords";
import { currentStep, hotp } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";
import { codeFrom, inbox, type Inbox } from "./mailpit";

const PASSWORD = "correct horse battery staple";
const SUBJECT = {
  signUp: "Your korbat sign-up code",
  signIn: "Your korbat sign-in code",
  newDevice: "New sign-in to your korbat account",
  locked: "Password sign-in paused on your korbat account",
};

const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;
const newHandle = () => `e_${randomBytes(6).toString("hex")}`;

/** The raw secret from an otpauth:// URI (RFC 4648 base32). */
function secretFromUri(uri: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const encoded = new URL(uri).searchParams.get("secret") ?? "";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of encoded.replace(/=+$/, "")) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * The whole auth module over HTTP with the real Redis store, real SMTP into Mailpit and a clock the
 * tests can move forward (for lockout expiry, the re-auth window and new TOTP steps).
 */
describe.skipIf(!process.env.INTEGRATION)("integration: auth end to end (Postgres, Redis, Mailpit)", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  let offsetMs = 0;
  const now = () => new Date(Date.now() + offsetMs);
  const advance = (ms: number) => {
    offsetMs += ms;
  };

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      // A fresh key prefix per run, so rate-limit counters from earlier runs never interfere.
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async () => false },
      now,
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const web = () => new Browser(app, config.APP_ORIGIN);

  /** An onboarded account created directly in the database, optionally with PASSWORD set. */
  async function existingAccount(options: { password?: boolean } = {}) {
    const email = newEmail("e2e");
    const user = await auth.deps.repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: now() });
    await auth.deps.repo.markOnboarded(user.id, now());
    if (options.password) await auth.deps.repo.setPasswordHash(user.id, await hashPassword(PASSWORD), now());
    return { email, userId: user.id };
  }

  const passwordSignIn = (b: Browser, email: string, password: string, deviceId: string) =>
    b.fetch("/api/auth/password/signin", { json: { email, password, turnstileToken: "ok", deviceId, platform: "web" } });

  async function signInByCode(b: Browser, email: string, box: Inbox, deviceId: string) {
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId, platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    return b.fetch("/api/auth/email/verify", { json: { flowId, code: codeFrom(await box.next(SUBJECT.signIn)) } });
  }

  async function signUpAndOnboard(b: Browser) {
    const email = newEmail("signup");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } });
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const reused = await b.fetch("/api/auth/email/verify", { json: { flowId, code } });
    expect(reused.status).toBe(400);
    const handle = newHandle();
    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "End To End" } });
    expect(onboarded.status).toBe(200);
    return { email, handle, box };
  }

  test("sign-up through onboarding with codes read from Mailpit", async () => {
    const b = web();
    const { email, handle } = await signUpAndOnboard(b);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user).toMatchObject({ email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: false });
    expect(me.profile?.handle).toBe(handle);
  });

  test("sign-in by email code on a new device sends an alert whose link signs out everywhere and removes the password", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const phone = new NativeClient(app);
    const phoneSignIn = await phone.fetch("/api/auth/password/signin", {
      json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" },
    });
    phone.token = SessionResult.parse(await phoneSignIn.json()).token;

    const laptop = web();
    const signedIn = await signInByCode(laptop, email, box, randomToken());
    expect(await signedIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
    const alert = await box.next(SUBJECT.newDevice);
    const token = /\/not-me\/([A-Za-z0-9_-]{43})/.exec(alert)?.[1];
    expect(token).toBeDefined();
    expect((await laptop.fetch("/api/me")).status).toBe(200);
    expect((await phone.fetch("/api/me")).status).toBe(200);

    const stranger = web();
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    const withPassword = await passwordSignIn(web(), email, PASSWORD, randomToken());
    expect(withPassword.status).toBe(401);
    expect(await withPassword.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect((await stranger.fetch("/api/auth/not-me", { json: { token } })).status).toBe(400);
  });

  test("five wrong passwords pause password sign-in and send a notice; email codes still work; the pause lifts after 15 minutes", async () => {
    const { email } = await existingAccount({ password: true });
    const box = await inbox(email);
    const b = web();
    const deviceId = randomToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await passwordSignIn(b, email, "not the right password", deviceId)).status).toBe(401);
    }
    expect(await box.next(SUBJECT.locked)).toContain("15 minutes");

    const whileLocked = await passwordSignIn(b, email, PASSWORD, deviceId);
    expect(whileLocked.status).toBe(401);
    expect(await whileLocked.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    expect(await (await signInByCode(b, email, box, deviceId)).json()).toEqual({ result: "session", mustReenrollMfa: false });

    advance(15 * 60_000 + 1000);
    const afterPause = await passwordSignIn(web(), email, PASSWORD, deviceId);
    expect(afterPause.status).toBe(200);
    expect(await afterPause.json()).toEqual({ result: "session", mustReenrollMfa: false });
  });

  test("MFA: setup, sign-in challenge, replay rejected, recovery code, re-enrolment and disable", { timeout: 60_000 }, async () => {
    const b = web();
    const { email } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(now().getTime()));
    const enrol = async () => {
      const setup = TotpSetupResponse.parse(await (await b.fetch("/api/auth/mfa/totp/setup", { method: "POST" })).json());
      const secret = secretFromUri(setup.otpauthUri);
      const code = totpNow(secret);
      const confirm = await b.fetch("/api/auth/mfa/totp/confirm", { json: { code } });
      expect(confirm.status).toBe(200);
      return { secret, code, recoveryCodes: RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes };
    };
    const signOut = async () => expect((await b.fetch("/api/auth/signout", { method: "POST" })).status).toBe(204);
    const deviceId = randomToken();
    const challenge = async () => {
      const body = SignInResponse.parse(await (await passwordSignIn(b, email, PASSWORD, deviceId)).json());
      if (body.result !== "mfa_required") throw new Error(`expected an MFA challenge, got ${body.result}`);
      return body.mfaTicket;
    };
    const verify = (mfaTicket: string, second: { code: string } | { recoveryCode: string }) => b.fetch("/api/auth/mfa/verify", { json: { mfaTicket, ...second } });

    const first = await enrol();
    await signOut();

    let ticket = await challenge();
    const replay = await verify(ticket, { code: first.code });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "invalid_mfa_code" } });
    advance(30_000);
    expect(await (await verify(ticket, { code: totpNow(first.secret) })).json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    await signOut();

    ticket = await challenge();
    expect(await (await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).json()).toEqual({ result: "session", mustReenrollMfa: true });
    await signOut();
    ticket = await challenge();
    expect((await verify(ticket, { recoveryCode: first.recoveryCodes[0]! })).status).toBe(401);
    advance(30_000);
    expect((await verify(ticket, { code: totpNow(first.secret) })).status).toBe(200);

    const second = await enrol();
    expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
    advance(30_000);
    expect((await b.fetch("/api/auth/mfa/totp/disable", { json: { code: totpNow(second.secret) } })).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("session list, revoking one session, and revoke-all behind re-authentication", async () => {
    const { email } = await existingAccount({ password: true });
    const laptop = web();
    expect((await passwordSignIn(laptop, email, PASSWORD, randomToken())).status).toBe(200);
    const phone = new NativeClient(app);
    const phoneDevice = randomToken();
    const phoneSignIn = async () => {
      const res = await phone.fetch("/api/auth/password/signin", { json: { email, password: PASSWORD, turnstileToken: "ok", deviceId: phoneDevice, platform: "ios" } });
      phone.token = SessionResult.parse(await res.json()).token;
    };
    await phoneSignIn();

    const { sessions } = SessionsResponse.parse(await (await laptop.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(2);
    const other = sessions.find((s) => !s.current)!;
    expect(other.platform).toBe("ios");
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await phone.fetch("/api/me")).status).toBe(401);
    expect((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: "DELETE" })).status).toBe(404);

    await phoneSignIn();
    advance(6 * 60_000);
    const stale = await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    expect((await laptop.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } })).status).toBe(204);
    expect((await laptop.fetch("/api/auth/sessions/revoke-all", { method: "POST" })).status).toBe(204);
    expect((await laptop.fetch("/api/me")).status).toBe(401);
    expect((await phone.fetch("/api/me")).status).toBe(401);
  });

  test("an under-16 sign-up is refused and leaves no account behind", async () => {
    const b = web();
    const email = newEmail("young");
    const box = await inbox(email);
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    const { flowId } = FlowResponse.parse(await start.json());
    const code = codeFrom(await box.next(SUBJECT.signUp));
    expect(await (await b.fetch("/api/auth/email/verify", { json: { flowId, code } })).json()).toEqual({ result: "signup_required" });

    const dateOfBirth = `${now().getUTCFullYear() - 15}-01-01`;
    const refused = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: config.TERMS_VERSION } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "age_requirement" } });
    expect(await auth.deps.repo.findUserByEmail(email)).toBeFalsy();

    const retry = await web().fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(retry.status).toBe(403);
    expect(await retry.json()).toMatchObject({ error: { code: "age_requirement" } });
  });

  test("the API database role cannot read auth events", async () => {
    const failure = await apiDb.execute(sql`select id from auth.auth_events limit 1`).then(
      () => null,
      (err: unknown) => err,
    );
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied/);
  });
});
```

### Create `apps/api/test/integration/http-timing.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Redis from "ioredis";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, redisKv, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { hashPassword } from "../../src/auth/passwords";
import { loadConfig, type Config } from "../../src/config";
import { smtpMailer } from "../../src/mail/smtp";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser } from "./http-client";

const ROUNDS = 20;
const MAX_MEDIAN_DIFFERENCE_MS = 50;
const PASSWORD = "correct horse battery staple";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Whether an email has an account must not show in response times (1a spec, section 10). Known and
 * unknown requests alternate, each from its own client address, so rate limits and drift affect both
 * sides alike.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: response timing does not reveal accounts", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let redis: Redis;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: redisKv(redis, `korbat:test:${randomUUID()}:`),
      mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
  });
  afterAll(async () => {
    await Promise.allSettled([closeDb(authDb), closeDb(apiDb), redis.quit()]);
  });

  const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;

  async function knownAccounts(passwordHash: string | null): Promise<string[]> {
    const emails: string[] = [];
    for (let i = 0; i <= ROUNDS; i++) {
      const email = newEmail("timing-known");
      const user = await auth.deps.repo.createUser({ email, termsVersion: config.TERMS_VERSION, now: new Date() });
      if (passwordHash) await auth.deps.repo.setPasswordHash(user.id, passwordHash, new Date());
      emails.push(email);
    }
    return emails;
  }

  /** Runs one warm-up pair, then ROUNDS alternating pairs; returns the median of each side. */
  async function compare(send: (email: string) => Promise<Response>, known: string[], expectedStatus: number) {
    const timed = async (email: string) => {
      const started = performance.now();
      const res = await send(email);
      await res.arrayBuffer();
      expect(res.status).toBe(expectedStatus);
      return performance.now() - started;
    };
    await timed(known[ROUNDS]!);
    await timed(newEmail("timing-warmup"));
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      knownMs.push(await timed(known[i]!));
      unknownMs.push(await timed(newEmail("timing-unknown")));
    }
    return { known: median(knownMs), unknown: median(unknownMs) };
  }

  test("email/start: known and unknown emails differ by less than 50 ms on the median of 20 requests", { timeout: 120_000 }, async () => {
    const known = await knownAccounts(null);
    const result = await compare(
      (email) => new Browser(app, config.APP_ORIGIN).fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } }),
      known,
      200,
    );
    expect(Math.abs(result.known - result.unknown), `median known ${result.known.toFixed(1)} ms, unknown ${result.unknown.toFixed(1)} ms`).toBeLessThan(MAX_MEDIAN_DIFFERENCE_MS);
  });

  test("password/signin: known and unknown emails differ by less than 50 ms on the median of 20 requests", { timeout: 120_000 }, async () => {
    const known = await knownAccounts(await hashPassword(PASSWORD));
    const result = await compare(
      (email) =>
        new Browser(app, config.APP_ORIGIN).fetch("/api/auth/password/signin", {
          json: { email, password: "not the right password", turnstileToken: "ok", deviceId: randomToken(), platform: "web" },
        }),
      known,
      401,
    );
    expect(Math.abs(result.known - result.unknown), `median known ${result.known.toFixed(1)} ms, unknown ${result.unknown.toFixed(1)} ms`).toBeLessThan(MAX_MEDIAN_DIFFERENCE_MS);
  });
});
```

### Replace `apps/api/test/integration/mailpit.ts` (whole file)

```ts
/** Reads messages from the local Mailpit HTTP API (infra/compose.dev.yml). Test helper only. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:58025";

interface MessageSummary {
  ID: string;
  Subject: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Messages to one address, newest first. */
async function search(to: string): Promise<MessageSummary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const list = (await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()) as { messages: MessageSummary[] };
  return list.messages;
}

async function messageText(id: string): Promise<{ subject: string; text: string }> {
  const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { Subject: string; Text: string };
  return { subject: message.Subject, text: message.Text };
}

/** Waits up to ~5 seconds for the newest message to `to` and returns its plain-text body. */
export async function latestMessageTo(to: string): Promise<{ subject: string; text: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const newest = (await search(to))[0];
    if (newest) return messageText(newest.ID);
    await sleep(250);
  }
  throw new Error(`no email to ${to} arrived in Mailpit`);
}

/**
 * One address's mailbox that hands out each message once. Messages already there when the inbox is
 * opened are ignored.
 */
export async function inbox(to: string) {
  const seen = new Set((await search(to)).map((m) => m.ID));
  return {
    /**
     * Waits up to ~10 seconds for the newest message with this subject that has not been handed out,
     * returns its text, and marks it and every older message as seen.
     */
    async next(subject: string): Promise<string> {
      for (let attempt = 0; attempt < 40; attempt++) {
        const messages = await search(to);
        const index = messages.findIndex((m) => m.Subject === subject && !seen.has(m.ID));
        if (index !== -1) {
          for (const m of messages.slice(index)) seen.add(m.ID);
          return (await messageText(messages[index]!.ID)).text;
        }
        await sleep(250);
      }
      throw new Error(`no new "${subject}" email to ${to} arrived in Mailpit`);
    },
  };
}

export type Inbox = Awaited<ReturnType<typeof inbox>>;

/** The first 6-digit code in a message body. */
export function codeFrom(text: string): string {
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw new Error("no 6-digit code in message");
  return code;
}
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
import { Browser } from "./http-client";

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
    const b = new Browser(app, config.APP_ORIGIN);
    const { complete } = await signUp(b, "ios");
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

## Step 2: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  88 passed | 67 skipped (155)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed | 67 skipped (155)
```

## Step 3: verify: typecheck

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

## Step 4: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  67 passed (67)`

Must not contain:

- `failed`

Allowed difference: The two timing tests compare medians. If only a timing test fails while the machine is busy, run the `timing-repeat` step once before treating it as a STOP condition.

Observed on the dry run:

```text
Tests  67 passed (67)
```

## Step 5: verify: timing-repeat

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm exec vitest run --config vitest.integration.config.ts test/integration/http-timing.test.ts
```

Expected output contains:

- `Tests  2 passed (2)`

Must not contain:

- `failed`

Allowed difference: If this passes after a timing failure in the `integration` step, record both outputs and continue.

Observed on the dry run:

```text
Tests  2 passed (2)
```

## Step 6: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-client.ts`
- `apps/api/test/integration/http-e2e.test.ts`
- `apps/api/test/integration/http-timing.test.ts`
- `apps/api/test/integration/mailpit.ts`

## Step 7: commit

```bash
git add -A
git commit -q -m "test(auth): end-to-end HTTP tests with Redis and Mailpit (lockout, MFA, not-me, sessions, age gate) and response-timing checks" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `test(auth): end-to-end HTTP tests with Redis and Mailpit (lockout, MFA, not-me, sessions, age gate) and response-timing checks`.

## Report format (mandatory)

```text
TASK 18 REPORT
Files written: <count, expected 5>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "timing-repeat": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
