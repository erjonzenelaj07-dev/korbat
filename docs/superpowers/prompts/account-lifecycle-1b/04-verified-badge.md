# korbat account lifecycle (1b) — Task 4 of 9: The verified badge: a VerificationProvider interface with the development provider and the Vonage Verify v2 adapter, the badge start, verify and remove flows with one number per account through the unique index, the logger scrubbing phone fields, and the runbook's live-check script

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend; its auth module owns accounts and their credentials. This task gives an account the verified badge: proof of holding a phone number, kept only as a keyed hash that a partial unique index holds to one account. The number goes to a `VerificationProvider` for one text and nowhere else: the development provider accepts the code 000000 (refused in production by the configuration guard), the Vonage Verify v2 adapter sends the text through two documented requests, and `VERIFY_PROVIDER=off` hides the feature with `badge_unavailable`. The logger scrubs phone fields, and `scripts/verify-badge.mjs` lets the runbook check live credentials without touching an account. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 3, 7.4, 8, 10 and 13.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): an account moves to a new email address with a code sent there; the start answers alike for free and taken addresses and shares the sign-in start's per-address cooldown and hourly limit, the conflict is reported only at verification from the unique index, the old address is told and every session stays signed in`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/04-verified-badge.md 1
```

Expected: 10 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/badge.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { BADGE_STARTS_PER_HOUR, badgeKey, removeBadge, startBadge, verifyBadge, type PendingBadge } from "../../src/auth/flows/badge";
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

const pending = async (h: MemoryFlowHarness, flowId: string) => JSON.parse((await h.kv.get(badgeKey(flowId)))!) as PendingBadge;

/** Starts a verification for the number and returns its flow id. */
async function start(h: MemoryFlowHarness, session: Session, phone = PHONE): Promise<string> {
  return (await startBadge(h.deps, session, { phone }, h.ctx)).flowId;
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
      attempts: 0,
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
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });
});

describe("badge: the verification step", () => {
  test("a wrong code is invalid_code and counts an attempt; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await pending(h, flowId)).toMatchObject({ attempts: 1, expiresAt: h.now().getTime() + CODE_TTL_MS });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
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
    expect(await failure(verifyBadge(h.deps, bob.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect((await pending(h, flowId)).attempts).toBe(0);
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId: randomToken(), code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
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
    expect((await pending(h, flowId)).attempts).toBe(1);
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.deps.verify = devProvider();
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
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
    expect((await pending(h, flowId)).attempts).toBe(0);
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
```

### Create `apps/api/test/auth/verify-config.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { verificationProviderFrom } from "../../src/auth";
import { DEV_CODE } from "../../src/auth/verify/dev";
import { loadConfig } from "../../src/config";

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

describe("the verification provider VERIFY_PROVIDER names", () => {
  test("off, the default, is no provider, so the badge routes answer badge_unavailable", () => {
    expect(verificationProviderFrom(loadConfig(good))).toBeNull();
    expect(verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "off" }))).toBeNull();
  });

  test("dev is the fixed-code provider", async () => {
    const provider = verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }))!;
    const { reference } = await provider.start("+447911123456");
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await provider.check(reference, DEV_CODE)).toBe("verified");
    expect(await provider.check(reference, "123456")).toBe("invalid_code");
  });

  test("vonage needs both credentials, in development too, and sends them with the brand", async () => {
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    const calls: { url: string; authorization: string | null; body: string }[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return Response.json({ request_id: "ref-1" }, { status: 201 });
    }) as typeof fetch;
    const config = loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret", VERIFY_BRAND: "My korbat" });
    const provider = verificationProviderFrom(config, fetchFn)!;
    expect(await provider.start("+447911123456")).toEqual({ reference: "ref-1" });
    expect(calls).toEqual([
      {
        url: "https://api.nexmo.com/v2/verify",
        authorization: `Basic ${Buffer.from("abcd1234:s3cret").toString("base64")}`,
        body: JSON.stringify({ brand: "My korbat", workflow: [{ channel: "sms", to: "+447911123456" }], code_length: 6 }),
      },
    ]);
  });
});
```

### Create `apps/api/test/auth/vonage.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { VerifyUnavailable } from "../../src/auth/verify/provider";
import { vonageProvider } from "../../src/auth/verify/vonage";

const PHONE = "+447911123456";
const CODE = "123456";
const REFERENCE = "c11d2e44-1f55-4e0e-9a3c-2b1f7d8e9a01";
const CREDENTIALS = { apiKey: "abcd1234", apiSecret: "s3cret-value", brand: "korbat" };
const BASIC = `Basic ${Buffer.from("abcd1234:s3cret-value").toString("base64")}`;

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | null | undefined;
}

/** A fetch that records every request and answers from the queue in order; an Error in the queue is thrown instead. */
function fake(...outcomes: (Response | Error)[]) {
  const calls: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal,
    });
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new Error("the fake fetch has no answer left");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return { fn, calls };
}

/** A fetch that never answers: it rejects with the signal's reason once the adapter's timeout aborts it. */
const waiting = ((_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))) as typeof fetch;

const provider = (fetchFn: typeof fetch, timeoutMs?: number) => vonageProvider({ ...CREDENTIALS, fetch: fetchFn, timeoutMs });
const json = (status: number, body: unknown) => Response.json(body, { status });

/** The VerifyUnavailable a call rejects with; anything else fails the test. */
async function unavailable(promise: Promise<unknown>): Promise<VerifyUnavailable> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof VerifyUnavailable) return err;
    throw err;
  }
  throw new Error("expected VerifyUnavailable");
}

describe("vonage verify: starting a verification", () => {
  test("posts the brand, one SMS workflow to the number and a six-digit code with Basic authentication, and takes the request id as the reference", async () => {
    const f = fake(json(201, { request_id: REFERENCE }));
    expect(await provider(f.fn).start(PHONE)).toEqual({ reference: REFERENCE });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.nexmo.com/v2/verify");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(BASIC);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(call.body!) as { workflow: unknown[] };
    expect(body).toEqual({ brand: "korbat", workflow: [{ channel: "sms", to: PHONE }], code_length: 6 });
    // The number travels in the workflow's `to` field and nowhere else: not the URL, not a header, not another field.
    const { workflow, ...rest } = body;
    expect(JSON.stringify({ url: call.url, headers: call.headers, rest })).not.toContain(PHONE);
    expect(JSON.stringify(workflow).split(PHONE)).toHaveLength(2);
  });

  test("every other answer is VerifyUnavailable: another status, a missing or non-string request id, a body that is not JSON", async () => {
    const answers: [string, Response][] = [
      ["200 instead of 201", json(200, { request_id: REFERENCE })],
      ["422 for a number Vonage refuses", json(422, { title: "Invalid Request", detail: "The number is not valid", instance: "bf0ca0bf" })],
      ["409 for a verification already in progress", json(409, { title: "Conflict", detail: "Concurrent verifications to the same number are not allowed" })],
      ["500", new Response("", { status: 500 })],
      ["201 without a request id", json(201, {})],
      ["201 with a numeric request id", json(201, { request_id: 12345 })],
      ["201 with a body that is not JSON", new Response("<html>gateway</html>", { status: 201, headers: { "content-type": "text/html" } })],
    ];
    for (const [name, res] of answers) {
      const err = await unavailable(provider(fake(res).fn).start(PHONE));
      expect(err.message, name).not.toContain(PHONE);
    }
  });

  test("a fetch that rejects, and one that never answers within the timeout, are VerifyUnavailable with the cause attached", async () => {
    const offline = new TypeError("fetch failed");
    const rejected = await unavailable(provider(fake(offline).fn).start(PHONE));
    expect(rejected.cause).toBe(offline);
    const timedOut = await unavailable(provider(waiting, 20).start(PHONE));
    expect(timedOut.cause).toMatchObject({ name: "TimeoutError" });
    expect(`${rejected.message} ${timedOut.message}`).not.toContain(PHONE);
  });
});

describe("vonage verify: checking a code", () => {
  test("posts the code to the request's own URL with the same authentication, and reads a completed request as verified", async () => {
    const f = fake(json(200, { request_id: REFERENCE, status: "completed" }));
    expect(await provider(f.fn).check(REFERENCE, CODE)).toBe("verified");
    const call = f.calls[0]!;
    expect(call.url).toBe(`https://api.nexmo.com/v2/verify/${REFERENCE}`);
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(BASIC);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(call.body!)).toEqual({ code: CODE });
  });

  test("400 is a wrong code and 410 an expired one, whatever the body says", async () => {
    const wrong = json(400, { title: "Invalid Code", detail: "The code you provided does not match the expected value." });
    expect(await provider(fake(wrong).fn).check(REFERENCE, CODE)).toBe("invalid_code");
    expect(await provider(fake(new Response("", { status: 400 })).fn).check(REFERENCE, CODE)).toBe("invalid_code");
    const expired = json(410, { title: "Invalid Code", detail: "An incorrect code has been provided too many times. Workflow terminated." });
    expect(await provider(fake(expired).fn).check(REFERENCE, CODE)).toBe("code_expired");
    expect(await provider(fake(new Response("", { status: 410 })).fn).check(REFERENCE, CODE)).toBe("code_expired");
  });

  test("every other answer is VerifyUnavailable, and no message holds the code", async () => {
    const answers: [string, Response | Error][] = [
      ["404 for a request that is gone", json(404, { title: "Not Found", detail: "Request was not found or it has been verified already." })],
      ["429", json(429, { title: "Rate Limit Hit" })],
      ["503", new Response("", { status: 503 })],
      ["200 that is not completed", json(200, { request_id: REFERENCE, status: "failed" })],
      ["200 with a body that is not JSON", new Response("<html>gateway</html>", { status: 200 })],
      ["a fetch that rejects", new TypeError("fetch failed")],
    ];
    for (const [name, answer] of answers) {
      const err = await unavailable(provider(fake(answer).fn).check(REFERENCE, CODE));
      expect(err.message, name).not.toContain(CODE);
    }
    const timedOut = await unavailable(provider(waiting, 20).check(REFERENCE, CODE));
    expect(timedOut.cause).toMatchObject({ name: "TimeoutError" });
    expect(timedOut.message).not.toContain(CODE);
  });

  test("the reference is escaped in the URL", async () => {
    const f = fake(json(200, { status: "completed" }));
    await provider(f.fn).check("odd/ref?x", CODE);
    expect(f.calls[0]!.url).toBe("https://api.nexmo.com/v2/verify/odd%2Fref%3Fx");
  });
});
```

### Create `apps/api/test/integration/http-badge.test.ts`

```ts
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BadgeVerifyResponse, ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { phoneHash } from "../../src/auth/identifiers";
import { MemoryKv } from "../../src/auth/kv";
import { DEV_CODE, devProvider } from "../../src/auth/verify/dev";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `b${randomBytes(4).toString("hex")}`;
/** A distinct number per use, so the per-number limit of one test never reaches another. */
const newPhone = () => `+4477${String(randomInt(10_000_000, 100_000_000))}`;

/**
 * The badge routes through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the
 * auth module's freshness check, the development provider, the real profile store (so /me and the
 * public profile read verified_at) and the unique index on the phone hash.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the verified badge over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  /** The same server with the provider off, as a korbat without an SMS account runs. */
  let appOff: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const shared = { config, logger, authDb, mailer, turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } };
    auth = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb), verify: devProvider() });
    const rateLimitStore = new MemoryStore();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
    const authOff = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb) });
    appOff = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth: authOff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account on the given app, onboarded unless told otherwise. */
  async function signUp(on: App = app, onboard = true) {
    const b = new Browser(on, config.APP_ORIGIN);
    const email = `badge-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** Puts the session's last proof of a credential ten minutes back, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const verifiedOnMe = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).profile!.verified;
  const verifiedInPublic = async (handle: string) => ProfileView.parse(await (await app.request(`/api/profiles/${handle}`)).json()).verified;
  const storedHash = async (userId: string) => (await auth.deps.repo.findUserById(userId))!.phoneHash;
  const mailsTo = (email: string) => mailer.sent.filter((m) => m.to === email).map((m) => m.template);

  /** Starts a verification for the number and returns the flow id. */
  async function start(b: Browser, phone: string) {
    const res = await b.fetch("/api/auth/badge/start", { json: { phone } });
    expect(res.status).toBe(200);
    return FlowResponse.parse(await res.json()).flowId;
  }
  const verify = (b: Browser, flowId: string, code: string) => b.fetch("/api/auth/badge/verify", { json: { flowId, code } });

  test("all three routes need an onboarded, fresh session", async () => {
    const routes = [
      ["POST", "/api/auth/badge/start", { phone: newPhone() }],
      ["POST", "/api/auth/badge/verify", { flowId: randomToken(), code: DEV_CODE }],
      ["DELETE", "/api/auth/badge", undefined],
    ] as const;
    for (const [method, path, body] of routes) {
      const anonymous = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await errorCode(anonymous), path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(app, false);
    for (const [method, path, body] of routes) {
      const early = await notOnboarded.b.fetch(path, { method, json: body });
      expect(early.status, path).toBe(403);
      expect(await errorCode(early), path).toBe("onboarding_required");
    }
    const stale = await signUp();
    await makeStale(stale.b);
    for (const [method, path, body] of routes) {
      const refused = await stale.b.fetch(path, { method, json: body });
      expect(refused.status, path).toBe(403);
      expect(await errorCode(refused), path).toBe("reauth_required");
    }
  });

  test("the development provider end to end: a wrong code, the right one, the badge on /me and the public profile, the notices and events, then removal", async () => {
    const ada = await signUp();
    const phone = newPhone();
    const malformed = await ada.b.fetch("/api/auth/badge/start", { json: { phone: "0044 7911" } });
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("invalid_request");
    const flowId = await start(ada.b, phone);
    const wrong = await verify(ada.b, flowId, "123456");
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("invalid_code");
    expect(await verifiedOnMe(ada.b)).toBe(false);

    const right = await verify(ada.b, flowId, DEV_CODE);
    expect(right.status).toBe(200);
    expect(BadgeVerifyResponse.parse(await right.json())).toEqual({ verified: true });
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedInPublic(ada.handle)).toBe(true);
    expect(await storedHash(ada.userId)).toBe(phoneHash(auth.deps.config.authHmacKey, phone));
    expect(mailsTo(ada.email).at(-1)).toBe("badge_verified");
    expect(await eventTypes(ada.userId)).toContain("badge_verified");
    const replay = await verify(ada.b, flowId, DEV_CODE);
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe("invalid_code");

    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(await verifiedOnMe(ada.b)).toBe(false);
    expect(await verifiedInPublic(ada.handle)).toBe(false);
    expect(await storedHash(ada.userId)).toBeNull();
    expect(mailsTo(ada.email).at(-1)).toBe("badge_removed");
    expect(await eventTypes(ada.userId)).toContain("badge_removed");
    // Removing a badge the account does not hold answers the same and tells nobody.
    const before = mailer.sent.length;
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(mailer.sent).toHaveLength(before);
    // Nothing that left the server carries the number.
    expect(JSON.stringify(mailer.sent)).not.toContain(phone);
  });

  test("one number per account: the second account learns of the conflict only after its code, and the first keeps the badge", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const phone = newPhone();
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    // The start answers alike for a number another account holds: nothing is revealed before the code proves the phone.
    const bobFlow = await start(bob.b, phone);
    const conflict = await verify(bob.b, bobFlow, DEV_CODE);
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("phone_in_use");
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedOnMe(bob.b)).toBe(false);
    expect(await storedHash(bob.userId)).toBeNull();
    expect(await eventTypes(bob.userId)).not.toContain("badge_verified");
    // The holder can verify the same number again without conflict.
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    expect(await verifiedOnMe(ada.b)).toBe(true);
  });

  test("with the provider off the badge routes answer badge_unavailable, and a badge can still be removed", async () => {
    const ada = await signUp(appOff);
    const started = await ada.b.fetch("/api/auth/badge/start", { json: { phone: newPhone() } });
    expect(started.status).toBe(404);
    expect(await errorCode(started)).toBe("badge_unavailable");
    const verified = await ada.b.fetch("/api/auth/badge/verify", { json: { flowId: randomToken(), code: DEV_CODE } });
    expect(verified.status).toBe(404);
    expect(await errorCode(verified)).toBe("badge_unavailable");
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
  });
});
```

### Replace `apps/api/test/app.test.ts` (whole file)

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import pino from "pino";
import { HealthResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { MemoryKv } from "../src/auth/kv";
import { loadConfig } from "../src/config";
import { MemoryMailer } from "../src/mail/memory";
import { createMedia } from "../src/media";
import { MemoryStore } from "../src/middleware/rate-limit";
import { createSocial } from "../src/social";

const key = Buffer.alloc(32, 7).toString("base64");

const config = loadConfig({
  DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
  DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
  REDIS_URL: "redis://localhost:56379",
  KORBAT_VERSION: "9.9.9",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
});

const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-app-test-"));

/** The real app with every module; the database pools are created but never connect in these tests. */
function app(checks: Record<string, () => Promise<void>>, advisoryChecks?: Record<string, () => Promise<void>>) {
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, advisoryChecks, auth, social, media });
}

describe("GET /api/health", () => {
  test("200 ok when all checks pass", async () => {
    const res = await app({ postgres: async () => {}, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "9.9.9", checks: { postgres: "ok", redis: "ok" } });
  });
  test("503 degraded when a check throws", async () => {
    const res = await app({ postgres: async () => { throw new Error("down"); }, redis: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", redis: "ok" });
  });
});

describe("advisory health checks", () => {
  const down = async () => {
    throw new Error("stale heartbeat");
  };
  test("a failing advisory check is reported as degraded, with status 200", async () => {
    const res = await app({ postgres: async () => {} }, { image_worker: down }).request("/api/health");
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ status: "degraded", version: "9.9.9", checks: { postgres: "ok", image_worker: "fail" } });
  });
  test("a failing critical check is still 503, whatever the advisory ones say", async () => {
    const res = await app({ postgres: down }, { image_worker: async () => {} }).request("/api/health");
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json()).checks).toEqual({ postgres: "fail", image_worker: "ok" });
  });
});

describe("caching", () => {
  test("responses are no-store unless the handler set its own Cache-Control", async () => {
    const a = app({});
    a.get("/api/cached", (c) => {
      c.header("Cache-Control", "public, max-age=300");
      return c.text("image bytes");
    });
    expect((await a.request("/api/health")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/nope")).headers.get("cache-control")).toBe("no-store");
    expect((await a.request("/api/cached")).headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("request bodies", () => {
  test("JSON bodies over 64 KiB are refused with 413; the raw upload route is exempt", async () => {
    const a = app({});
    const big = JSON.stringify({ email: "x".repeat(70_000) });
    const refused = await a.request("/api/auth/email/start", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "payload_too_large" } });
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: big });
    expect(upload.status).toBe(401);
  });
});

describe("media routes", () => {
  const id = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
  test("uploading, status and removal need a session", async () => {
    const a = app({});
    const upload = await a.request("/api/media", { method: "POST", headers: { "content-type": "image/jpeg" }, body: "x" });
    expect(upload.status).toBe(401);
    expect(await upload.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request(`/api/media/${id}`)).status).toBe(401);
    expect((await a.request(`/api/media/${id}`, { method: "DELETE" })).status).toBe(401);
  });
  test("image file requests that cannot name an image are not found before any query runs", async () => {
    const a = app({});
    for (const url of ["/api/media/not-an-id/large.webp", `/api/media/${id}/large.png`, `/api/media/${id}/huge.webp`]) {
      const res = await a.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
  });
  test("image files have their own bucket of 1200 a minute, outside the global 300", async () => {
    const a = app({});
    let last = 0;
    for (let i = 0; i < 1201; i++) last = (await a.request("/api/media/not-an-id/large.webp")).status;
    expect(last).toBe(429);
    expect((await a.request("/api/health")).status).toBe(200);
  });
});

describe("routing", () => {
  test("unknown route returns 404 envelope", async () => {
    const res = await app({}).request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
  test("/api/me is 401 without a session", async () => {
    const res = await app({}).request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });
  test("state-changing requests from another origin are refused before any handler runs", async () => {
    const res = await app({}).request("/api/auth/email/start", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "csrf_failed" } });
  });
  test("thrown errors become a 500 envelope without leaking the message", async () => {
    const a = app({});
    a.get("/api/boom", () => { throw new Error("secret detail"); });
    const res = await a.request("/api/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret detail");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "internal" } });
  });
});

describe("social routes", () => {
  test("writes and the Following timeline need a session", async () => {
    const a = app({});
    const post = await a.request("/api/posts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "hi" }) });
    expect(post.status).toBe(401);
    expect(await post.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/timeline/following")).status).toBe(401);
    expect((await a.request("/api/me/bookmarks")).status).toBe(401);
  });
  test("malformed ids and handles are refused before any query runs", async () => {
    const a = app({});
    const post = await a.request("/api/posts/not-a-uuid");
    expect(post.status).toBe(400);
    expect(await post.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect((await a.request("/api/profiles/has%20space")).status).toBe(400);
    expect((await a.request("/api/timeline/latest?limit=500")).status).toBe(400);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { AuthEventType, AuthRepo, EmailCodeRow, UserRow } from "../../src/auth/repo";
import { createSessions, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
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
 * holds only the methods the email-change and badge flows call, checked against the real signatures. The
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
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      events.push({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
  } satisfies Pick<AuthRepo, "findUserById" | "createEmailCode" | "findEmailCode" | "addCodeAttempt" | "consumeEmailCode" | "changeEmail" | "setPhoneHash" | "appendEvent">;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create and read no profile; the badge flows only set and clear verified_at, kept above by account.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async () => null,
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
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
    verified,
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

### Replace `apps/api/test/auth/identifiers.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { deviceHash, emailHash, ipHash, phoneHash } from "../../src/auth/identifiers";

const key = Buffer.alloc(32, 1);

describe("identifier hashes", () => {
  test("are keyed, namespaced and stable", () => {
    expect(deviceHash(key, "abc")).toBe(deviceHash(key, "abc"));
    expect(deviceHash(key, "abc")).not.toBe(ipHash(key, "abc"));
    expect(deviceHash(Buffer.alloc(32, 2), "abc")).not.toBe(deviceHash(key, "abc"));
    expect(ipHash(key, "203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
  });
  test("email hashes ignore case and surrounding whitespace", () => {
    expect(emailHash(key, " Ada@Example.COM ")).toBe(emailHash(key, "ada@example.com"));
  });
  test("phone hashes are keyed and in a namespace of their own", () => {
    expect(phoneHash(key, "+447911123456")).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash(key, "+447911123456")).toBe(phoneHash(key, "+447911123456"));
    expect(phoneHash(key, "+447911123456")).not.toBe(emailHash(key, "+447911123456"));
    expect(phoneHash(Buffer.alloc(32, 2), "+447911123456")).not.toBe(phoneHash(key, "+447911123456"));
  });
});
```

### Replace `apps/api/test/integration/auth-repo.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { isUniqueViolation } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: auth repo", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("users are found by email in any case, and a second account for the same email is rejected", async () => {
    const email = `repo-${randomUUID()}@korbat.local`;
    const user = await repo.createUser({ email, termsVersion: "test", now: new Date() });
    expect(user.role).toBe("user");
    expect(user.emailVerifiedAt).not.toBeNull();
    expect((await repo.findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    await expect(repo.createUser({ email: email.toUpperCase(), termsVersion: "test", now: new Date() })).rejects.toThrow();
  });

  test("an email code counts attempts and can be consumed exactly once", async () => {
    const flowId = randomToken();
    await repo.createEmailCode({
      flowId,
      email: `repo-${randomUUID()}@korbat.local`,
      userId: null,
      purpose: "signup",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 600_000),
      ipHash: null,
    });
    const code = (await repo.findEmailCode(flowId))!;
    expect(await repo.addCodeAttempt(code.id)).toBe(1);
    expect(await repo.addCodeAttempt(code.id)).toBe(2);
    const results = await Promise.all([repo.consumeEmailCode(code.id, new Date()), repo.consumeEmailCode(code.id, new Date())]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("TOTP steps can only be claimed forwards, once, even concurrently", async () => {
    const { user } = await newUserWithDevice(repo);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(true);
    expect(await repo.claimTotpStep(user.id, 100)).toBe(false);
    expect(await repo.claimTotpStep(user.id, 99)).toBe(false);
    const results = await Promise.all([repo.claimTotpStep(user.id, 101), repo.claimTotpStep(user.id, 101)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a recovery code hash is removed once, even under concurrent use", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.enableTotp(user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a", "b", "c"], now: new Date() });
    const results = await Promise.all([repo.consumeRecoveryCodeHash(user.id, "b"), repo.consumeRecoveryCodeHash(user.id, "b")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repo.findUserById(user.id))!.recoveryCodesHash).toEqual(["a", "c"]);
  });

  test("changing the password clears the lockout state", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.setPasswordFailures(user.id, 5, new Date(Date.now() + 900_000));
    await repo.setPasswordHash(user.id, "$argon2id$placeholder", new Date());
    const row = (await repo.findUserById(user.id))!;
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(row.passwordChangedAt).not.toBeNull();
  });

  test("one phone hash per account: the partial unique index refuses a second account's identical hash, and a cleared hash frees it", async () => {
    const first = await newUserWithDevice(repo);
    const second = await newUserWithDevice(repo);
    const hash = sha256Hex(randomToken());
    await repo.setPhoneHash(first.user.id, hash);
    expect((await repo.findUserById(first.user.id))!.phoneHash).toBe(hash);
    const conflict = await repo.setPhoneHash(second.user.id, hash).then(() => null, (err: unknown) => err);
    expect(isUniqueViolation(conflict)).toBe(true);
    expect((await repo.findUserById(second.user.id))!.phoneHash).toBeNull();
    // The holder may write its own hash again; accounts without a number stay out of the index; a cleared hash is free to take.
    await repo.setPhoneHash(first.user.id, hash);
    await repo.setPhoneHash(second.user.id, null);
    await repo.setPhoneHash(first.user.id, null);
    await repo.setPhoneHash(second.user.id, hash);
    expect((await repo.findUserById(first.user.id))!.phoneHash).toBeNull();
    expect((await repo.findUserById(second.user.id))!.phoneHash).toBe(hash);
  });

  test("only live sessions are active, listed and revoked", async () => {
    const { user, device } = await newUserWithDevice(repo);
    const now = new Date();
    const make = async (expiresAt: Date) => {
      const id = sha256Hex(randomToken());
      await repo.createSession({ id, userId: user.id, deviceId: device.id, now, expiresAt, absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
      return id;
    };
    const live = await make(new Date(now.getTime() + 60_000));
    const expired = await make(new Date(now.getTime() - 1_000));
    const revoked = await make(new Date(now.getTime() + 60_000));
    expect(await repo.revokeSession(revoked, user.id, now)).toBe(true);

    expect((await repo.findActiveSession(live, new Date()))?.role).toBe("user");
    expect(await repo.findActiveSession(expired, new Date())).toBeUndefined();
    expect(await repo.findActiveSession(revoked, new Date())).toBeUndefined();
    expect((await repo.listActiveSessions(user.id, new Date())).map((s) => s.id)).toEqual([live]);
    // Sessions that expired without being revoked are revoked too, so nothing stale stays live.
    expect((await repo.revokeAllSessions(user.id, new Date())).sort()).toEqual([live, expired].sort());
    expect(await repo.findActiveSession(live, new Date())).toBeUndefined();
  });

  test("a user cannot revoke another user's session", async () => {
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const now = new Date();
    const id = sha256Hex(randomToken());
    await repo.createSession({ id, userId: owner.user.id, deviceId: owner.device.id, now, expiresAt: new Date(now.getTime() + 60_000), absoluteExpiresAt: new Date(now.getTime() + 86_400_000) });
    expect(await repo.revokeSession(id, other.user.id, now)).toBe(false);
    expect(await repo.findActiveSession(id, new Date())).toBeDefined();
  });

  test("auth events are append-only for the auth role", async () => {
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signup", metadata: { via: "test" } });
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signup"]);
    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
  });
});
```

### Replace `apps/api/test/integration/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { MeProfile } from "@korbat/contracts";
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
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";
import { fakeClock } from "./auth-fixtures";

/** Handles unique per store, like the real public.profiles index. A new profile has never changed its handle and holds no badge. */
export function memoryProfiles(): ProfileStore {
  const byHandle = new Map<string, MeProfile>();
  const byId = new Map<string, MeProfile>();
  return {
    async create({ id, handle, displayName }) {
      if (byHandle.has(handle) || byId.has(id)) return { ok: false, reason: "handle_taken" };
      const profile = { id, handle, displayName, handleChangedAt: null, verified: false };
      byHandle.set(handle, profile);
      byId.set(id, profile);
      return { ok: true, profile: { id, handle, displayName } };
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async setVerified(id, at) {
      const profile = byId.get(id);
      if (profile) profile.verified = at !== null;
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
    trustProxy: "none",
    verifyProvider: "dev",
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
    verify: devProvider(),
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

### Replace `apps/api/test/logger.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { scrub } from "../src/lib/logger";

describe("scrub", () => {
  test("masks emails and IPs inside strings", () => {
    expect(scrub("user a.b+c@example.com from 203.0.113.9")).toBe("user [email] from [ip]");
    expect(scrub("v6 2001:db8:85a3::8a2e:370:7334 and ::1 and fe80::1")).toBe("v6 [ip] and [ip] and [ip]");
  });
  test("leaves timestamps alone", () => {
    expect(scrub("at 2026-09-03T10:30:45Z")).toBe("at 2026-09-03T10:30:45Z");
  });
  test("redacts secret-bearing keys regardless of value", () => {
    expect(scrub({ authorization: "Bearer abc", cookie: "s=1", password: "p", nested: { token: "t" } })).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      password: "[redacted]",
      nested: { token: "[redacted]" },
    });
  });
  test("a phone number is redacted by its key, as is the `to` field the mailer and the verification provider carry", () => {
    expect(scrub({ phone: "+447911123456", to: "+447911123456", workflow: [{ channel: "sms", to: "+447911123456" }], nested: { Phone: "+447911123456" } })).toEqual({
      phone: "[redacted]",
      to: "[redacted]",
      workflow: [{ channel: "sms", to: "[redacted]" }],
      nested: { Phone: "[redacted]" },
    });
  });
  test("an Error's message and stack are both scrubbed", () => {
    const err = new Error("relay rejected bob@example.com from 203.0.113.9");
    const out = scrub(err) as { name: string; message: string; stack: string };
    expect(out.message).toBe("relay rejected [email] from [ip]");
    expect(out.stack).toContain("relay rejected [email] from [ip]");
    expect(out.stack).not.toContain("example.com");
  });
  test("walks arrays and keeps non-strings", () => {
    expect(scrub({ n: 1, ok: true, list: ["x@y.io", 2] })).toEqual({ n: 1, ok: true, list: ["[email]", 2] });
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
❯ test/logger.test.ts (6 tests | 1 failed) 60ms
❯ test/auth/identifiers.test.ts (3 tests | 1 failed) 18ms
Test Files  11 failed | 25 passed | 20 skipped (56)
Tests  2 failed | 180 passed | 138 skipped (320)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/04-verified-badge.md 3
```

Expected: 13 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/flows/badge.ts`

```ts
import type { BadgeStartRequest, BadgeVerifyRequest, BadgeVerifyResponse } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { phoneHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import type { Session } from "../sessions";
import { VerifyUnavailable, type VerificationProvider } from "../verify/provider";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS } from "./email";
import { notifyAccount } from "./notify";

export const BADGE_STARTS_PER_HOUR = 3;

/** A flow id is a bearer credential while its verification is pending, so the store holds only its hash. */
export const badgeKey = (flowId: string) => `badge:${sha256Hex(flowId)}`;

/**
 * The verification a code is out for, kept under the hashed flow id until the code is right, the
 * attempts are spent or the ten minutes pass. It holds the number only as its keyed hash, which is what
 * the account will store; the number itself went to the provider and nowhere else. The expiry is kept so
 * that counting an attempt can write the state back without extending its life.
 */
export interface PendingBadge {
  userId: string;
  phoneHash: string;
  reference: string;
  attempts: number;
  expiresAt: number;
}

/** The configured provider, or badge_unavailable (404) when VERIFY_PROVIDER is off; the app hides the section on that answer. */
function provider(deps: AuthDeps): VerificationProvider {
  if (!deps.verify) throw new AuthError("badge_unavailable", 404);
  return deps.verify;
}

/** A provider that could not be asked is verify_unavailable (503): the user tries again later. Anything else is a bug and stays a 500. */
function unavailable(err: unknown): never {
  if (err instanceof VerifyUnavailable) throw new AuthError("verify_unavailable", 503);
  throw err;
}

/**
 * Has the provider text a code to the number. The answer is the same whether or not another account
 * holds the number: the conflict is reported only once the code has proved that the requester holds the
 * phone (verifyBadge), so this step tells nobody which numbers are registered. The request context is
 * taken like every start flow's; nothing here records the address, and the number is never stored.
 */
export async function startBadge(deps: AuthDeps, session: Session, input: BadgeStartRequest, _ctx: RequestContext): Promise<{ flowId: string }> {
  const verify = provider(deps);
  const hashed = phoneHash(deps.config.authHmacKey, input.phone);
  await enforceLimit(deps.kv, `badge-start:${session.userId}`, BADGE_STARTS_PER_HOUR, HOUR);
  // Per number too, whoever asks, so one phone cannot be texted more than three times an hour through many accounts.
  await enforceLimit(deps.kv, `badge-start:phone:${hashed}`, BADGE_STARTS_PER_HOUR, HOUR);
  const { reference } = await verify.start(input.phone).catch(unavailable);
  const flowId = randomToken();
  const pending: PendingBadge = { userId: session.userId, phoneHash: hashed, reference, attempts: 0, expiresAt: deps.now().getTime() + CODE_TTL_MS };
  await deps.kv.set(badgeKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  return { flowId };
}

/**
 * Checks the code with the provider. Attempts are counted in the store before the provider is asked, as
 * the email codes count theirs, so a flow takes at most five codes whatever the provider answers. On
 * success the account's phone hash is written first (the partial unique index on it decides conflicts,
 * so a number another account verified is phone_in_use here and only here), then the profile's
 * verified_at, and the account is told.
 */
export async function verifyBadge(deps: AuthDeps, session: Session, input: BadgeVerifyRequest): Promise<BadgeVerifyResponse> {
  const verify = provider(deps);
  const key = badgeKey(input.flowId);
  const raw = await deps.kv.get(key);
  const pending = raw ? (JSON.parse(raw) as PendingBadge) : null;
  // A flow another account started, an unknown one and one whose ten minutes passed are all no code at all,
  // settled before an attempt is counted: nobody can spend another account's attempts.
  if (!pending || pending.userId !== session.userId) throw new AuthError("invalid_code", 400);
  // Written back with what is left of the original ten minutes, so an attempt never extends the flow. The
  // store drops the state itself at that moment; a straggler is treated like a flow that is gone.
  const remainingMs = pending.expiresAt - deps.now().getTime();
  if (remainingMs <= 0) throw new AuthError("invalid_code", 400);
  pending.attempts += 1;
  await deps.kv.set(key, JSON.stringify(pending), remainingMs);
  if (pending.attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);

  const outcome = await verify.check(pending.reference, input.code).catch(unavailable);
  if (outcome === "invalid_code") throw new AuthError("invalid_code", 400);
  if (outcome === "code_expired") {
    // The provider has closed the request, so no code can be checked against it any more: the owner starts again.
    await deps.kv.del(key);
    throw new AuthError("code_expired", 400);
  }
  // The code was right and the provider has spent it: whatever happens next, this flow is over.
  await deps.kv.del(key);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  try {
    await deps.repo.setPhoneHash(user.id, pending.phoneHash);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("phone_in_use", 409);
    throw err;
  }
  await deps.profiles.setVerified(user.id, deps.now());
  await notifyAccount(deps, user.email, "badge_verified");
  // No metadata: the event log never holds the number, not even hashed, since the hash leaves the account with the badge.
  await deps.repo.appendEvent({ userId: user.id, type: "badge_verified", deviceId: session.deviceId });
  return { verified: true };
}

/**
 * Drops the badge: the phone hash and verified_at are cleared, the account is told and the event
 * recorded. Without a badge nothing is said or recorded, but both columns are cleared anyway, which also
 * finishes a removal that stopped between its two writes. Works with the provider off, so turning it
 * off strands nobody.
 */
export async function removeBadge(deps: AuthDeps, session: Session): Promise<void> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const held = user.phoneHash !== null;
  await deps.repo.setPhoneHash(user.id, null);
  await deps.profiles.setVerified(user.id, null);
  if (!held) return;
  await notifyAccount(deps, user.email, "badge_removed");
  await deps.repo.appendEvent({ userId: user.id, type: "badge_removed", deviceId: session.deviceId });
}
```

### Create `apps/api/src/auth/verify/dev.ts`

```ts
import { randomToken } from "../crypto";
import type { VerificationProvider } from "./provider";

/** The one code the development provider accepts. */
export const DEV_CODE = "000000";

/**
 * The provider behind VERIFY_PROVIDER=dev: no text is sent, the reference is random, exactly the code
 * 000000 verifies, anything else is a wrong code, and a reference never expires. Because it would hand
 * the badge to anyone who types 000000, the config guard refuses it when NODE_ENV is production
 * (config.ts), like the Turnstile test secret.
 */
export function devProvider(): VerificationProvider {
  return {
    async start() {
      return { reference: randomToken() };
    },
    async check(_reference, code) {
      return code === DEV_CODE ? "verified" : "invalid_code";
    },
  };
}
```

### Create `apps/api/src/auth/verify/provider.ts`

```ts
/** What a check of the code the provider texted came to. */
export type VerificationOutcome = "verified" | "invalid_code" | "code_expired";

/**
 * Proof of holding a phone number, behind the verified badge (1b design, section 7.4). `start` has the
 * provider text a code to the number and returns the provider's reference for it; `check` hands the code
 * the user typed back for that reference. Both throw VerifyUnavailable when the provider could not be
 * asked at all, which the flow answers with verify_unavailable (503) so the user tries again later. The
 * number passes through here and is never kept, logged or put in an error message.
 */
export interface VerificationProvider {
  start(phone: string): Promise<{ reference: string }>;
  check(reference: string, code: string): Promise<VerificationOutcome>;
}

/** The provider could not be reached or did not answer as documented; the cause, when there is one, is attached. */
export class VerifyUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VerifyUnavailable";
  }
}
```

### Create `apps/api/src/auth/verify/vonage.ts`

```ts
import { VerifyUnavailable, type VerificationOutcome, type VerificationProvider } from "./provider";

/** Vonage Verify v2 (developer.vonage.com/en/api/verify.v2). A check goes to this URL with the request id appended. */
const VERIFY_URL = "https://api.nexmo.com/v2/verify";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface VonageOptions {
  apiKey: string;
  apiSecret: string;
  /** The sender name in the text, 1 to 18 characters (VERIFY_BRAND). */
  brand: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The production adapter: one request starts a verification (Vonage texts a six-digit code and answers
 * 201 with a request id, the reference) and one checks the code against it. Written from the API
 * reference and unit-tested against its recorded shapes; the runbook (1b design, section 13) proves it
 * against the live API with real credentials. Every answer outside the documented ones, a network
 * error, a timeout and a malformed body are VerifyUnavailable. The phone number and the code appear in
 * no error message, so nothing here can log them; scripts/verify-badge.mjs repeats these two requests.
 */
export function vonageProvider({ apiKey, apiSecret, brand, fetch: fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: VonageOptions): VerificationProvider {
  const headers = {
    authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    "content-type": "application/json",
  };

  /** One POST under the timeout, as the Turnstile client sends its own; a fetch that rejects (network, abort) is VerifyUnavailable with the cause. */
  async function post(url: string, body: unknown, what: string): Promise<Response> {
    try {
      return await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new VerifyUnavailable(`vonage ${what}: no answer`, { cause: err });
    }
  }

  /** The body as a JSON object, or null when it is anything else. */
  async function json(res: Response): Promise<Record<string, unknown> | null> {
    try {
      const body: unknown = await res.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return {
    async start(phone) {
      const res = await post(VERIFY_URL, { brand, workflow: [{ channel: "sms", to: phone }], code_length: 6 }, "start");
      if (res.status !== 201) throw new VerifyUnavailable(`vonage start answered ${res.status}`);
      const reference = (await json(res))?.request_id;
      if (typeof reference !== "string" || reference === "") throw new VerifyUnavailable("vonage start answered 201 without a request id");
      return { reference };
    },
    async check(reference, code) {
      const res = await post(`${VERIFY_URL}/${encodeURIComponent(reference)}`, { code }, "check");
      // 400 is a wrong code and 410 an expired request (Vonage also ends one after too many wrong codes).
      // A 404 means the request is gone, which the flow cannot tell from a provider fault, so it is not mapped.
      const outcomes: Record<number, VerificationOutcome> = { 400: "invalid_code", 410: "code_expired" };
      const known = outcomes[res.status];
      if (known) return known;
      if (res.status !== 200) throw new VerifyUnavailable(`vonage check answered ${res.status}`);
      if ((await json(res))?.status !== "completed") throw new VerifyUnavailable("vonage check answered 200 without a completed status");
      return "verified";
    },
  };
}
```

### Create `scripts/verify-badge.mjs`

```js
#!/usr/bin/env node
/**
 * Live check of the verification provider behind the verified badge (1b design, section 13, step 3).
 *
 * Reads VERIFY_PROVIDER, VONAGE_API_KEY, VONAGE_API_SECRET and VERIFY_BRAND from apps/api/.env, refuses
 * to run unless the provider is vonage, starts a verification for the number given on the command line
 * with the same two requests the adapter (apps/api/src/auth/verify/vonage.ts) sends, asks for the code
 * from the text on standard input and prints the provider's answer with its status code. No account is
 * touched and nothing is written: the first run proves the credentials, the brand and the route to that
 * country. The requests are repeated here on purpose, so the script needs no build step.
 *
 * Values from .env are never printed.
 *
 * Usage, from the repo root:
 *   node scripts/verify-badge.mjs +447911123456
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY_URL = "https://api.nexmo.com/v2/verify";
const TIMEOUT_MS = 10_000;
/** E.164 as the Phone contract accepts it once spaces, hyphens and parentheses are dropped: a plus and 7 to 15 digits, the first not zero. */
const E164 = /^\+[1-9][0-9]{6,14}$/;
const LINE = /^([A-Z0-9_]+)=(.*)$/;

function usage() {
  console.error("usage: node scripts/verify-badge.mjs <phone number in E.164, such as +447911123456>");
  console.error("Needs VERIFY_PROVIDER=vonage with VONAGE_API_KEY and VONAGE_API_SECRET in apps/api/.env. Touches no account.");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length !== 1) usage();
const phone = argv[0].replace(/[\s()-]/g, "");
if (!E164.test(phone)) usage();

/** apps/api/.env as scripts/gen-dev-env.mjs reads it: NAME=value lines and nothing else, kept in memory only. */
function parse(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}
const envPath = resolve(root, "apps/api/.env");
if (!existsSync(envPath)) stop("apps/api/.env is missing. Run `node scripts/gen-dev-env.mjs`, then set the Vonage values by hand.");
const env = parse(readFileSync(envPath, "utf8"));
/** A value wrapped in double quotes, as MAIL_FROM is, is read without them, the way the API's own loader reads the file. */
const value = (name) => (env.get(name) ?? "").trim().replace(/^"(.*)"$/, "$1");

if ((value("VERIFY_PROVIDER") || "off") !== "vonage") {
  stop("VERIFY_PROVIDER in apps/api/.env is not vonage; this check only runs against vonage. The dev provider needs no check: it accepts 000000.");
}
const apiKey = value("VONAGE_API_KEY");
const apiSecret = value("VONAGE_API_SECRET");
const brand = value("VERIFY_BRAND") || "korbat";
if (!apiKey || !apiSecret) stop("VONAGE_API_KEY and VONAGE_API_SECRET must both be set in apps/api/.env.");
if (brand.length > 18 || /[/{}:$]/.test(brand)) stop("VERIFY_BRAND must be 1 to 18 characters without / { } : or $.");

const headers = {
  authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
  "content-type": "application/json",
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** One POST as the adapter sends it. The status and the body are printed as they came; they never carry the credentials. */
async function post(url, body, what) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err) =>
    stop(`${what}: no answer from ${url} within ${TIMEOUT_MS / 1000} seconds: ${err?.cause?.message ?? err?.message ?? err}`),
  );
  const text = await res.text();
  console.log(`${what}: HTTP ${res.status}${text ? ` ${text}` : ""}`);
  return { status: res.status, body: parseJson(text) };
}

console.log(`Starting a verification for ${phone} with the configured brand...`);
const started = await post(VERIFY_URL, { brand, workflow: [{ channel: "sms", to: phone }], code_length: 6 }, "start");
if (started.status !== 201 || typeof started.body?.request_id !== "string") {
  stop("The adapter answers verify_unavailable to this: the credentials, the brand or the route to that country need attention.");
}
const reference = started.body.request_id;

const rl = createInterface({ input: stdin, output: stdout });
const code = (await rl.question("Code from the text message (6 digits): ")).trim();
rl.close();
if (!/^\d{6}$/.test(code)) stop("A code is six digits; nothing was checked.");

const checked = await post(`${VERIFY_URL}/${encodeURIComponent(reference)}`, { code }, "check");
let meaning;
if (checked.status === 200) meaning = checked.body?.status === "completed" ? "verified" : "verify_unavailable (a 200 without a completed status)";
else if (checked.status === 400) meaning = "invalid_code";
else if (checked.status === 410) meaning = "code_expired";
else meaning = "verify_unavailable (the adapter treats this answer as the provider being unreachable)";
console.log(`The adapter would answer: ${meaning}`);
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
import type { VerificationProvider } from "./verify/provider";

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
  /** Who checks the phone number behind the verified badge; see VERIFY_PROVIDER in config.ts. With `off` the badge routes answer badge_unavailable. */
  verifyProvider: "off" | "dev" | "vonage";
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
    verifyProvider: config.VERIFY_PROVIDER,
  };
}

/** Public profiles live in the public schema, which the auth module cannot reach; the API supplies this. */
export interface ProfileStore {
  create(input: { id: string; handle: string; displayName: string }): Promise<{ ok: true; profile: Profile } | { ok: false; reason: "handle_taken" }>;
  /** The owner's view of their profile, which /me returns: the public facts plus the handle-change date and the badge. */
  find(id: string): Promise<MeProfile | null>;
  /** Sets or clears the badge (profiles.verified_at), which the auth module decides but cannot write itself. */
  setVerified(id: string, at: Date | null): Promise<void>;
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
  /** The phone verification provider behind the badge, or null when VERIFY_PROVIDER is off. */
  verify: VerificationProvider | null;
  config: AuthConfig;
  log: Logger;
  now: () => Date;
}

/** Per-request facts the flows need. The IP is already hashed; the raw address never enters a flow. */
export interface RequestContext {
  ipHash: string;
  userAgent: string | undefined;
}

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

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

### Replace `apps/api/src/auth/identifiers.ts` (whole file)

```ts
import { hmacHex } from "./crypto";

/**
 * Keyed, namespaced hashes for identifiers the server must recognise but never store raw.
 * The namespace prefix keeps a device id, an IP, an email and a phone number that happen to share
 * text from producing the same hash.
 */
export function deviceHash(key: Buffer, deviceId: string): string {
  return hmacHex(key, `device:${deviceId}`);
}

export function ipHash(key: Buffer, ip: string): string {
  return hmacHex(key, `ip:${ip}`);
}

export function emailHash(key: Buffer, email: string): string {
  return hmacHex(key, `email:${email.trim().toLowerCase()}`);
}

/** The number arrives in E.164 already (the Phone contract), so it is hashed as given. */
export function phoneHash(key: Buffer, phone: string): string {
  return hmacHex(key, `phone:${phone}`);
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore } from "./context";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore } from "./context";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes). */
    appendEvent: (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata }),
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
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

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
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
  BadgeStartRequest,
  BadgeVerifyRequest,
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
import { removeBadge, startBadge, verifyBadge } from "./flows/badge";
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

  r.post("/badge/start", requireSession, fresh, validate("json", BadgeStartRequest), async (c) =>
    c.json(await startBadge(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/badge/verify", requireSession, fresh, validate("json", BadgeVerifyRequest), async (c) =>
    c.json(await verifyBadge(deps, currentSession(c), c.req.valid("json"))),
  );

  r.delete("/badge", requireSession, fresh, async (c) => {
    await removeBadge(deps, currentSession(c));
    return c.body(null, 204);
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

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { loadConfig } from "./config";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles: createProfileStore(apiDb),
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
const stopJanitor = auth.startJanitor(jobLock);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/lib/logger.ts` (whole file)

```ts
import pino, { type Logger, type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

export type { Logger };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Full form, compressed form with "::", and leading "::" form. Requires "::" or 8 groups so times like 10:30:45 are untouched.
const IPV6 = /(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})/gi;
// phone, and to (the field Vonage takes the number in, and the mailer its address), keep a phone number out of every log line (1b design, section 10).
const SECRET_KEYS = new Set(["authorization", "cookie", "set-cookie", "password", "token", "secret", "session", "code", "otp", "phone", "to"]);

/** Recursively masks emails, IPs, and secret-bearing keys. Applied to every log line. */
export function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEYS.has(key.toLowerCase())) return "[redacted]";
  if (typeof value === "string") return value.replace(EMAIL, "[email]").replace(IPV6, "[ip]").replace(IPV4, "[ip]");
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object" && !(value instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k);
    return out;
  }
  if (value instanceof Error) return { name: value.name, message: scrub(value.message), stack: value.stack === undefined ? undefined : scrub(value.stack) };
  return value;
}

export function createLogger(level: string, pretty = false): Logger {
  const options: LoggerOptions = {
    level,
    base: undefined,
    formatters: { log: (obj) => scrub(obj) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === "string" ? scrub(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
  // pino-pretty is used as an in-process stream, not a transport: transports spawn a
  // worker thread that needs __dirname, which does not exist inside the bundle.
  return pretty ? pino(options, pinoPretty({ colorize: true })) : pino(options);
}
```

### Replace `apps/api/src/profiles/store.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { handleHistory, profiles, type Db } from "@korbat/db";
import { isUniqueViolation, type ProfileStore } from "../auth";

/**
 * Public profiles through the korbat_api pool. Onboarding writes the profile and the reservation of
 * its handle in one transaction; the unique index on lower(handle) and the primary key of
 * handle_history decide races and refuse a handle another profile holds or ever held.
 */
export function createProfileStore(apiDb: Db): ProfileStore {
  const columns = { id: profiles.id, handle: profiles.handle, displayName: profiles.displayName };
  return {
    async create({ id, handle, displayName }) {
      try {
        const profile = await apiDb.transaction(async (tx) => {
          const [created] = await tx.insert(profiles).values({ id, handle, displayName }).returning(columns);
          // The handle chosen at onboarding is reserved like every later one (1b design, section 6); a row for it under another profile ends the transaction.
          await tx.insert(handleHistory).values({ handleLower: handle.toLowerCase(), profileId: id });
          return created!;
        });
        return { ok: true, profile };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },
    async find(id) {
      const [profile] = await apiDb
        .select({ ...columns, handleChangedAt: profiles.handleChangedAt, verifiedAt: profiles.verifiedAt })
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);
      if (!profile) return null;
      const { handleChangedAt, verifiedAt, ...pub } = profile;
      // The badge is a fact of the profile row (verified_at), read here so the account screen sees it on /me.
      return { ...pub, handleChangedAt: handleChangedAt?.toISOString() ?? null, verified: verifiedAt !== null };
    },
    async setVerified(id, at) {
      await apiDb.update(profiles).set({ verifiedAt: at }).where(eq(profiles.id, id));
    },
  };
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
apps/api test:       Tests  221 passed | 173 skipped (394)
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
Tests  171 passed (171)
```

## Step 7: verify: verify-badge-usage

```bash
node scripts/verify-badge.mjs 2>&1; echo exit=$?
```

Expected output contains:

- `usage: node scripts/verify-badge.mjs`
- `exit=2`

Observed on the dry run:

```text
usage: node scripts/verify-badge.mjs <phone number in E.164, such as +447911123456>
exit=2
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/badge.ts`
- `apps/api/src/auth/identifiers.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/verify/dev.ts`
- `apps/api/src/auth/verify/provider.ts`
- `apps/api/src/auth/verify/vonage.ts`
- `apps/api/src/index.ts`
- `apps/api/src/lib/logger.ts`
- `apps/api/src/profiles/store.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/auth/badge.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/identifiers.test.ts`
- `apps/api/test/auth/verify-config.test.ts`
- `apps/api/test/auth/vonage.test.ts`
- `apps/api/test/integration/auth-repo.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-badge.test.ts`
- `apps/api/test/logger.test.ts`
- `scripts/verify-badge.mjs`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(auth): the verified badge proves a phone number through a VerificationProvider (the development provider accepts 000000, the Vonage Verify v2 adapter sends one text); the number is kept only as a keyed hash that the unique index holds to one account, the badge can be removed, the logger scrubs phone fields, and scripts/verify-badge.mjs checks live credentials without touching an account" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): the verified badge proves a phone number through a VerificationProvider (the development provider accepts 000000, the Vonage Verify v2 adapter sends one text); the number is kept only as a keyed hash that the unique index holds to one account, the badge can be removed, the logger scrubs phone fields, and scripts/verify-badge.mjs checks live credentials without touching an account`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 23>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "verify-badge-usage": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
