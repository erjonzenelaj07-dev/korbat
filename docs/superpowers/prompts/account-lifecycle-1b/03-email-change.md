# korbat account lifecycle (1b) — Task 3 of 9: Email change: a code to the new address with the sign-in start's cooldown and hourly limit, the conflict reported only at verification through the unique index, the old address told, sessions kept

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend; its auth module owns accounts, email codes and sessions. This task lets an account move to a new email address: a code goes to the new address, the start answers alike for a free and a taken address and shares the sign-in start's per-address cooldown and hourly limit, the conflict is reported only at verification from the unique index on the address, the old address is told and every session stays signed in because the owner just proved a credential. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 7.3, 8 and 10.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): an account edits its display name and bio and changes its handle once every 30 days, with every handle it ever had reserved for it in handle_history (onboarding writes the first row); the social module records profile_updated and handle_changed events through the auth module`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/03-email-change.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/email-change.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey } from "../../src/auth/flows/email";
import { EMAIL_CHANGE_STARTS_PER_HOUR, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

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

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Starts a change and returns its flow id with the code from the mail to the new address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startEmailChange(h.deps, session, { email }, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

describe("email change: the start step", () => {
  test("answers the same, in the same time, whether or not the new address already has an account", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("taken@korbat.local");
    const startedAt = Date.now();
    const toTaken = await startEmailChange(h.deps, ada.session, { email: "taken@korbat.local" }, h.ctx);
    const elapsed = Date.now() - startedAt;
    const toFree = await startEmailChange(h.deps, ada.session, { email: "free@korbat.local" }, h.ctx);
    expect(Object.keys(toTaken)).toEqual(["flowId"]);
    expect(Object.keys(toFree)).toEqual(["flowId"]);
    expect(toTaken.flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(elapsed).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([
      ["taken@korbat.local", "email_change_code", ["code"]],
      ["free@korbat.local", "email_change_code", ["code"]],
    ]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([
      ["taken@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
      ["free@korbat.local", "change_email", ada.user.id, h.ctx.ipHash, expiresAt, 0],
    ]);
    expect(JSON.parse((await h.kv.get(flowKey(toFree.flowId)))!)).toEqual({ userId: ada.user.id, email: "free@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("refuses a disposable domain and the account's current address, in any case, before any mail or limit is touched", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "someone@mailinator.com" }, h.ctx))).toMatchObject({ code: "disposable_email", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(await failure(startEmailChange(h.deps, ada.session, { email: "Ada@korbat.local" }, h.ctx))).toMatchObject({ code: "invalid_request", status: 400 });
    expect(h.mailer.sent).toEqual([]);
    expect(h.codes).toEqual([]);
    // A slip does not delay the account's own sign-in codes: the current address got no cooldown.
    expect(await h.kv.get(`email-cooldown:${emailHash(h.deps.config.authHmacKey, "ada@korbat.local")}`)).toBeNull();
    expect(await h.kv.get(`rl:email-change:${ada.user.id}`)).toBeNull();
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < EMAIL_CHANGE_STARTS_PER_HOUR; i++) await startEmailChange(h.deps, ada.session, { email: `new-${i}@korbat.local` }, h.ctx);
    const refused = await failure(startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(EMAIL_CHANGE_STARTS_PER_HOUR);
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startEmailChange(h.deps, bob.session, { email: "bob-new@korbat.local" }, h.ctx);
    h.advance(HOUR + 1);
    await startEmailChange(h.deps, ada.session, { email: "new-3@korbat.local" }, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["new-0@korbat.local", "new-1@korbat.local", "new-2@korbat.local", "bob-new@korbat.local", "new-3@korbat.local"]);
  });

  test("a new address waits 60 seconds between codes and gets at most 3 an hour, whoever asks, in the sign-in start's buckets", async () => {
    const h = memoryFlowHarness();
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    const target = "shared@korbat.local";
    const hashed = emailHash(h.deps.config.authHmacKey, target);
    await startEmailChange(h.deps, a!.session, { email: target }, h.ctx);
    expect(await failure(startEmailChange(h.deps, b!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: MINUTE / 1000 });
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, b!.session, { email: target }, h.ctx);
    h.advance(MINUTE + 1);
    await startEmailChange(h.deps, c!.session, { email: target }, h.ctx);
    expect(await h.kv.get(`rl:email-start:email:${hashed}`)).toBe("3");
    expect(await h.kv.get(`email-cooldown:${hashed}`)).toBe("1");
    h.advance(MINUTE + 1);
    expect(await failure(startEmailChange(h.deps, d!.session, { email: target }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(3);
    h.advance(HOUR);
    await startEmailChange(h.deps, d!.session, { email: target }, h.ctx);
    expect(h.mailer.sent.filter((m) => m.to === target)).toHaveLength(4);
  });
});

describe("email change: the verification step", () => {
  test("a wrong code is invalid_code and counts an attempt; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId: randomToken(), code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("a code older than 10 minutes is code_expired and changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "code_expired", status: 400 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events).toEqual([]);
  });

  test("five wrong codes exhaust the code: too_many_attempts even for the right one", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code: wrong(code) }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
  });

  test("a flow another account started is invalid_code for this one and costs its owner no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, bob.session, { flowId, code }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(bob.user.id)!.email).toBe("bob@korbat.local");
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
  });

  test("an address that belongs to another account, in any case, is email_in_use only now, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.user("Wanted@korbat.local");
    const { flowId, code } = await start(h, ada.session, "wanted@korbat.local");
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.events).toEqual([]);
    // The code was spent on the attempt: the owner starts again rather than retrying it.
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("replaces the address and marks it verified, tells the old address, records both hashes, and keeps the session signed in", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.advance(1000);
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada-new@korbat.local", h.now()]);
    expect(h.mailer.sent.map((m) => [m.to, m.template, m.data])).toEqual([
      ["ada-new@korbat.local", "email_change_code", { code }],
      ["ada@korbat.local", "email_changed", { email: "ada-new@korbat.local" }],
    ]);
    const key = h.deps.config.authHmacKey;
    expect(h.events).toEqual([
      { userId: ada.user.id, type: "email_changed", deviceId: ada.session.deviceId, metadata: { from: emailHash(key, "ada@korbat.local"), to: emailHash(key, "ada-new@korbat.local") } },
    ]);
    expect(h.codes[0]!.consumedAt).toEqual(h.now());
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // No revocation tombstone was written for the session that made the change.
    expect(await h.kv.get(`sess:${ada.session.sessionId}`)).toBeNull();
    expect(await failure(verifyEmailChange(h.deps, ada.session, { flowId, code }))).toMatchObject({ code: "invalid_code" });
  });

  test("the notice to the old address is best effort: a mail failure does not undo the change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada-new@korbat.local");
    h.mailer.failing = true;
    expect(await verifyEmailChange(h.deps, ada.session, { flowId, code })).toEqual({ email: "ada-new@korbat.local" });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["email_change_code"]);
  });
});
```

### Create `apps/api/test/auth/flow-harness.ts`

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { AuthEventType, AuthRepo, EmailCodeRow, UserRow } from "../../src/auth/repo";
import { createSessions, type Session } from "../../src/auth/sessions";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * The auth flows without a database: users and email codes live in memory, and the repository fake
 * holds only the methods the email-change flows call, checked against the real signatures. The
 * key-value store and the mailer are the in-memory ones; the clock moves only when a test says so, so
 * expiries and timestamps compare exactly; and events are kept as the server would write them to
 * auth_events. The integration harness (test/integration/flow-harness.ts) runs flows against the real
 * repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      events.push({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
  } satisfies Pick<AuthRepo, "findUserById" | "createEmailCode" | "findEmailCode" | "addCodeAttempt" | "consumeEmailCode" | "changeEmail" | "appendEvent">;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs never touch the public schema, so there is no profile store to fake.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async () => null,
    },
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** An onboarded account holding a verified address, with a session that just proved a credential, as a route behind requireFreshAuth passes it on. */
    user(email: string): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
      };
      users.set(id, user);
      const session: Session = { sessionId: sha256Hex(randomToken()), userId: id, deviceId: randomUUID(), role: "user", onboarded: true, mfaEnabled: false, reauthAt: now() };
      return { user, session };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/integration/http-auth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { EmailChangeResponse, ErrorEnvelope, FlowResponse, MeResponse, SessionResult, SessionsResponse } from "@korbat/contracts";
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

  test("a script that sends only Sec-Fetch-Mode, as Node's fetch does, keeps its native platform", async () => {
    const headers = { "content-type": "application/json", "sec-fetch-mode": "cors", "cf-connecting-ip": "203.0.113.77" };
    const email = `http-${randomUUID()}@korbat.local`;
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    const start = await post("/api/auth/email/start", { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" });
    const { flowId } = FlowResponse.parse(await start.json());
    await post("/api/auth/email/verify", { flowId, code: mailer.lastCodeFor(email) });
    const complete = await post("/api/auth/signup/complete", { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION });
    expect(complete.status).toBe(200);
    expect(SessionResult.parse(await complete.json()).token).toMatch(/^kb1_/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);
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

  test("changing the email address needs an onboarded, fresh session on both routes; the new address is then verified by its code and shown by /me", async () => {
    const newAddress = `http-moved-${randomUUID()}@korbat.local`;
    const routes = [
      ["/api/auth/email/change/start", { email: newAddress }],
      ["/api/auth/email/change/verify", { flowId: randomToken(), code: "123456" }],
    ] as const;
    for (const [path, body] of routes) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }

    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    for (const [path, body] of routes) {
      const early = await b.fetch(path, { json: body });
      expect(early.status, path).toBe(403);
      expect(await early.json()).toMatchObject({ error: { code: "onboarding_required" } });
    }

    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Mover" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
    for (const [path, body] of routes) {
      const stale = await b.fetch(path, { json: body });
      expect(stale.status, path).toBe(403);
      expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    }
    const { flowId: reauthFlow } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId: reauthFlow, code: mailer.lastCodeFor(email) } })).status).toBe(204);

    const malformed = await b.fetch("/api/auth/email/change/start", { json: { email: "not an address" } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } });
    expect(verified.status).toBe(200);
    expect(EmailChangeResponse.parse(await verified.json())).toEqual({ email: newAddress });
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.email).toBe(newAddress);
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_changed", data: { email: newAddress } });
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

### Replace `apps/api/test/integration/http-e2e.test.ts` (whole file)

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
  emailChangeCode: "Confirm your new korbat email address",
  emailChanged: "Your korbat email address changed",
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

  test("moving the account to a new address: the code goes to the new mailbox, the old address is told, and only the new address signs in", { timeout: 60_000 }, async () => {
    const b = web();
    const { email: oldAddress, box: oldBox } = await signUpAndOnboard(b);
    expect((await b.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);

    // An address that already has an account gets its code like any other; the refusal waits for the code to prove the mailbox.
    const taken = await existingAccount();
    const takenBox = await inbox(taken.email);
    const conflict = await b.fetch("/api/auth/email/change/start", { json: { email: taken.email } });
    expect(conflict.status).toBe(200);
    const conflictFlow = FlowResponse.parse(await conflict.json());
    const conflictCode = codeFrom(await takenBox.next(SUBJECT.emailChangeCode));
    const refused = await b.fetch("/api/auth/email/change/verify", { json: { flowId: conflictFlow.flowId, code: conflictCode } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "email_in_use" } });

    const newAddress = newEmail("moved");
    const newBox = await inbox(newAddress);
    const started = await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const code = codeFrom(await newBox.next(SUBJECT.emailChangeCode));
    const verified = await b.fetch("/api/auth/email/change/verify", { json: { flowId, code } });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ email: newAddress });
    expect(await oldBox.next(SUBJECT.emailChanged)).toContain(newAddress);

    // The session that made the change stays signed in and sees the new address.
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(me.user.email).toBe(newAddress);
    expect((await auth.deps.repo.recentEvents(me.user.id)).map((e) => e.type)).toContain("email_changed");

    const oldSignIn = await passwordSignIn(web(), oldAddress, PASSWORD, randomToken());
    expect(oldSignIn.status).toBe(401);
    expect(await oldSignIn.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    const newSignIn = await passwordSignIn(web(), newAddress, PASSWORD, randomToken());
    expect(newSignIn.status).toBe(200);
    expect(await newSignIn.json()).toEqual({ result: "session", mustReenrollMfa: false });
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
Test Files  1 failed | 27 passed | 24 skipped (52)
Tests  180 passed | 168 skipped (348)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/03-email-change.md 3
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/flows/email-change.ts`

```ts
import type { EmailChangeResponse, EmailChangeStartRequest, EmailChangeVerifyRequest } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, MIN_START_RESPONSE_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { notifyAccount } from "./notify";

export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;

/** The change a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingEmailChange {
  userId: string;
  email: string;
}

/**
 * Sends a code to the address the account wants to move to. The answer, the mail and the time taken
 * are the same whether or not that address already has an account: the conflict is reported only at
 * verification, once the code has proved that the requester holds the mailbox, so this step tells
 * nobody which addresses are registered.
 */
export async function startEmailChange(deps: AuthDeps, session: Session, input: EmailChangeStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const startedAt = Date.now();
  try {
    if (isDisposableEmail(input.email)) throw new AuthError("disposable_email", 400);
    const user = await deps.repo.findUserById(session.userId);
    if (!user) throw new AuthError("invalid_credentials", 401);
    // Refused before any limit is touched, so a slip does not put the account's own address on the cooldown its sign-in codes share.
    if (user.email.toLowerCase() === input.email.toLowerCase()) throw new AuthError("invalid_request", 400, "That is already your email address.");
    await enforceLimit(deps.kv, `email-change:${user.id}`, EMAIL_CHANGE_STARTS_PER_HOUR, HOUR);
    // The new address gets the sign-in start's cooldown and hourly limit, in the same buckets, so asking
    // for a change cannot send an address more codes than asking to sign in could.
    const hashedEmail = emailHash(deps.config.authHmacKey, input.email);
    if (!(await deps.kv.setIfAbsent(`email-cooldown:${hashedEmail}`, "1", MINUTE))) throw new AuthError("rate_limited", 429, undefined, MINUTE / 1000);
    await enforceLimit(deps.kv, `email-start:email:${hashedEmail}`, 3, HOUR);

    const flowId = randomToken();
    const code = newEmailCode();
    await deps.repo.createEmailCode({
      flowId,
      email: input.email,
      userId: user.id,
      purpose: "change_email",
      codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
      expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
      ipHash: ctx.ipHash,
    });
    const pending: PendingEmailChange = { userId: user.id, email: input.email };
    await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
    await sendCode(deps, { to: input.email, template: "email_change_code", data: { code } });
    return { flowId };
  } finally {
    await padResponseTime(startedAt, MIN_START_RESPONSE_MS);
  }
}

/**
 * Moves the account to the new address once its code is right. The unique index on the address
 * decides conflicts, so an address that got an account after the code went out is email_in_use here.
 * The old address is told; every session stays signed in, because the owner just proved a credential.
 */
export async function verifyEmailChange(deps: AuthDeps, session: Session, input: EmailChangeVerifyRequest): Promise<EmailChangeResponse> {
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's change, or from any other flow, is no code at all. The row carries
  // the owner, so this is settled before an attempt is counted: nobody can spend another account's attempts.
  if (row?.purpose !== "change_email" || row.userId !== session.userId) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  const raw = await deps.kv.take(flowKey(input.flowId));
  if (!raw) throw new AuthError("code_expired", 400);
  const pending = JSON.parse(raw) as PendingEmailChange;

  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  try {
    await deps.repo.changeEmail(user.id, pending.email, deps.now());
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // Hashes only: the event log never holds an address.
  await deps.repo.appendEvent({
    userId: user.id,
    type: "email_changed",
    deviceId: session.deviceId,
    metadata: { from: emailHash(deps.config.authHmacKey, user.email), to: emailHash(deps.config.authHmacKey, pending.email) },
  });
  await notifyAccount(deps, user.email, "email_changed", { email: pending.email });
  return { email: pending.email };
}
```

### Replace `apps/api/src/auth/context.ts` (whole file)

```ts
import type { AuthErrorCode, MeProfile, Profile } from "@korbat/contracts";
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
  /** How the client address is read; see TRUST_PROXY in config.ts. */
  trustProxy: "cloudflare" | "caddy" | "none";
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
    trustProxy: config.TRUST_PROXY,
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date and the badge. */
  find(id: string): Promise<MeProfile | null>;
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

/** The auth codes plus the shared one the module also raises, as the social and media modules do: a well-formed request that asks for nothing, such as the current address as the new one. */
export type AuthErrorKind = AuthErrorCode | "invalid_request";

const MESSAGES: Record<AuthErrorKind, string> = {
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
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  invalid_request: "Some details are missing or invalid.",
};

export function authErrorMessage(code: AuthErrorKind): string {
  return MESSAGES[code];
}

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorKind,
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

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
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

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
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

### Replace `apps/api/src/auth/routes.ts` (whole file)

```ts
import {
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
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
import { AuthError, type AuthDeps, type RequestContext } from "./context";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "./flows/account";
import { startEmail, verifyEmail } from "./flows/email";
import { startEmailChange, verifyEmailChange } from "./flows/email-change";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { requireFreshAuth, requireOnboarding, requireSession } from "./middleware";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);

  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });
  const currentSession = (c: Context<AppEnv>): Session => c.get("session")!;

  /**
   * Browsers send Origin on state changes and the fetch metadata headers Sec-Fetch-Site and Sec-Fetch-Dest
   * on every request; native apps send none of them, and Node's own fetch sends a bare Sec-Fetch-Mode that
   * cannot be removed, which therefore does not count. A request from a browser is a web session whatever
   * the body says, so it gets cookies, never a token.
   */
  const fromBrowser = (c: Context<AppEnv>): boolean =>
    c.req.header("origin") !== undefined || c.req.header("sec-fetch-site") !== undefined || c.req.header("sec-fetch-dest") !== undefined;
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

  r.post("/email/change/start", requireSession, fresh, validate("json", EmailChangeStartRequest), async (c) =>
    c.json(await startEmailChange(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/email/change/verify", requireSession, fresh, validate("json", EmailChangeVerifyRequest), async (c) =>
    c.json(await verifyEmailChange(deps, currentSession(c), c.req.valid("json"))),
  );

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

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  63 passed (63)
packages/db test:       Tests  22 passed (22)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  17 passed (17)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  191 passed | 168 skipped (359)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  166 passed (166)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/email-change.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/test/auth/email-change.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-e2e.test.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(auth): an account moves to a new email address with a code sent there; the start answers alike for free and taken addresses and shares the sign-in start's per-address cooldown and hourly limit, the conflict is reported only at verification from the unique index, the old address is told and every session stays signed in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): an account moves to a new email address with a code sent there; the start answers alike for free and taken addresses and shares the sign-in start's per-address cooldown and hourly limit, the conflict is reported only at verification from the unique index, the old address is told and every session stays signed in`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 8>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
