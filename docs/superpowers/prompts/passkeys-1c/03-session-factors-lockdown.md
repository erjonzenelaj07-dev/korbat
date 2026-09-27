# korbat passkeys (1c) — Task 3 of 9: Session factors and the lockdown: the factors and the method recorded at every sign-in, freshness and the level read from them, strong freshness (level 2 on an account with TOTP) on the seven routes the design lists with the refusal naming the level and the factors held, in-place token rotation for every caller, re-authentication limits keyed by the session handle and the IP hash plus a recovery-code method, TOTP setup bound to the session handle and disable with an empty body, and the lockdown routine behind the new-device not-me link and the email-change undo

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task builds the session model and the lockdown the passkey tasks need, and moves 1a's and 1b's flows onto them: every sign-in records the factors it proved and its method; freshness and the level (1 or 2) are read from the factors; the seven routes the design lists need level 2 on an account with TOTP through requireStrongFreshAuth, and a refusal says which level it needs and which factors the session has; every re-authentication rotates the token in place (the handle, factors and device stay); the re-authentication limits are keyed by the session's handle and the IP hash, and a recovery code is a re-authentication method; TOTP setup is bound to the session's handle, confirm needs no freshness of its own, and disable takes an empty body; the lockdown routine (every session and device revoked, the password cleared, passkeys and TOTP set up in the day before the anchor removed) now stands behind the new-device not-me link and the email-change undo, each checking the address the link went to. No passkey route yet.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api): the passkey core: stateless HMAC-sealed challenges (purpose, expiry, nonce, session binding) that are spent once through the key-value store; one wrapper around SimpleWebAuthn 14 that pins the algorithms, accepts only the none and self-attested packed formats, caps the credential id, keeps known transports only and leaves the counter rule to the flows; readResponseChallenge; and a software authenticator for the tests`.

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
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/03-session-factors-lockdown.md 1
```

Expected: 28 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/auth/lockdown.test.ts`

```ts
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
```

### Create `apps/api/test/auth/not-me.test.ts`

```ts
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
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
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

  test("after the account's address changed, the link does nothing but refuse, and is spent; a change of case alone is no change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.passkey(ada.user.id);
    const key = h.deps.config.authHmacKey;
    const stale = await link(h, { userId: ada.user.id, deviceId: ada.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "ada@korbat.local") });
    await h.deps.repo.changeEmail(ada.user.id, "attacker@korbat.local", h.now());
    h.advance(HOUR);
    expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([null]);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "attacker@korbat.local", passwordHash: "owner-password" });
    expect(h.passkeys).toHaveLength(1);
    expect(h.events).toEqual([]);
    // Taken once: a second try finds nothing, so nobody can wait for the address to come back and use it then.
    expect(await failure(notMe(h.deps, { token: stale }, h.ctx))).toMatchObject({ code: "invalid_code", message: LINK_GONE });

    const bob = h.user("bob@korbat.local");
    const fine = await link(h, { userId: bob.user.id, deviceId: bob.session.deviceId, signedInAt: h.now().getTime(), passkeyId: null, sentTo: emailHash(key, "bob@korbat.local") });
    await h.deps.repo.changeEmail(bob.user.id, "Bob@korbat.local", h.now());
    await notMe(h.deps, { token: fine }, h.ctx);
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
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
```

### Create `apps/api/test/auth/sessions.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, test } from "vitest";
import type { AuthDeps } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { requireFreshAuth, requireStrongFreshAuth } from "../../src/auth/middleware";
import type { AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, createSessions, type Factors, type Session, type Sessions } from "../../src/auth/sessions";
import type { AppEnv } from "../../src/env";

const T0 = 1_789_000_000_000;
const MINUTE = 60_000;

/** The freshness rules read nothing but the session and the clock: no row is ever read or written here. */
function setup(start = T0) {
  let t = start;
  const sessions = createSessions({ repo: {} as AuthRepo, kv: new MemoryKv(() => t), now: () => new Date(t) });
  return {
    sessions,
    advance(ms: number) {
      t += ms;
    },
  };
}

/** A resolved session of an account with or without TOTP, holding exactly the given factors. */
function session(factors: Factors, mfaEnabled = false): Session {
  const times = Object.values(factors);
  return {
    sessionId: sha256Hex(randomToken()),
    userId: randomUUID(),
    deviceId: randomUUID(),
    role: "user",
    onboarded: true,
    mfaEnabled,
    reauthAt: new Date(times.length > 0 ? Math.max(...times) : 0),
    handle: randomUUID(),
    factors,
    passkeyId: null,
  };
}

describe("session factors: freshness and level (1c design, sections 2 and 7.1)", () => {
  test("fresh means any factor within the window; a factor older than five minutes does not count, whatever reauthAt says", () => {
    const { sessions, advance } = setup();
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    expect(sessions.isFresh(session({}))).toBe(false);
    advance(REAUTH_WINDOW_MS);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    advance(1);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(false);
    expect(sessions.isFresh(session({ email: T0, totp: T0 + MINUTE }))).toBe(true);
    // The column follows the factors, never the other way round: a reauthAt of its own proves nothing.
    expect(sessions.isFresh({ ...session({ email: T0 }), reauthAt: new Date(T0 + REAUTH_WINDOW_MS + 1) })).toBe(false);
    // A shorter window applies to every factor alike.
    const recent = session({ email: T0 + REAUTH_WINDOW_MS - MINUTE });
    expect(sessions.isFresh(recent)).toBe(true);
    expect(sessions.isFresh(recent, MINUTE)).toBe(false);
  });

  test("the level rule: a user-verified passkey, or a TOTP or recovery code together with an email code, a password or a passkey, is level 2", () => {
    const { sessions } = setup();
    const levelTwo: Factors[] = [{ email: T0, totp: T0 }, { password: T0, recovery: T0 }, { passkey_uv: T0 }, { passkey: T0, totp: T0 }, { email: T0, recovery: T0, password: T0 }];
    for (const factors of levelTwo) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(2);
    const levelOne: Factors[] = [{ totp: T0, recovery: T0 }, { email: T0 }, { password: T0 }, { passkey: T0 }, { email: T0, password: T0, passkey: T0 }, {}];
    for (const factors of levelOne) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(1);
  });

  test("a factor older than five minutes counts towards no level, and the factors in time are listed by kind", () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0, totp: T0 + 2 * MINUTE });
    expect(sessions.recentFactors(s)).toEqual(["email", "totp"]);
    expect(sessions.level(s)).toBe(2);
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.recentFactors(s)).toEqual(["totp"]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(true);
    advance(2 * MINUTE);
    expect(sessions.recentFactors(s)).toEqual([]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(false);
  });

  test("an account with TOTP needs level 2 and one without needs level 1; a refusal names the level and the factors proven in time", () => {
    const { sessions, advance } = setup();
    expect(sessions.requiredLevel(session({ email: T0 }, true))).toBe(2);
    expect(sessions.requiredLevel(session({ email: T0 }, false))).toBe(1);
    const onlyEmail = session({ email: T0 }, true);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toBeNull();
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: ["email"] });
    expect(sessions.reauthNeeded(session({ email: T0, totp: T0 }, true), 2)).toBeNull();
    expect(sessions.reauthNeeded(session({ totp: T0, recovery: T0 }, true), 2)).toEqual({ level: 2, have: ["totp", "recovery"] });
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toEqual({ level: 1, have: [] });
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: [] });
  });
});

describe("the freshness middlewares", () => {
  /** One guard on one route, with the session a request would carry, or none. */
  function app(guard: MiddlewareHandler<AppEnv>, current: Session | null) {
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "req-1");
      c.set("session", current);
      c.set("authVia", "cookie");
      await next();
    });
    a.get("/x", guard, (c) => c.text("ok"));
    return a;
  }
  const deps = (sessions: Sessions) => ({ sessions }) as unknown as AuthDeps;

  test("requireFreshAuth asks for level 1 and, refusing, says which factors the session has in time", async () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0 }, true);
    expect((await app(requireFreshAuth(deps(sessions)), s).request("/x")).status).toBe(200);
    advance(REAUTH_WINDOW_MS + 1);
    const refused = await app(requireFreshAuth(deps(sessions)), s).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: { code: "reauth_required", message: "Confirm it's you to continue.", requestId: "req-1", details: { level: 1, have: [] } },
    });
    // A window of the caller's own, in seconds, as the social module's handle change could ask for.
    expect((await app(requireFreshAuth(deps(sessions), 10 * 60), s).request("/x")).status).toBe(200);
  });

  test("requireStrongFreshAuth asks for level 2 on an account with TOTP and for level 1 otherwise", async () => {
    const { sessions } = setup();
    const strong = requireStrongFreshAuth(deps(sessions));
    const refused = await app(strong, session({ email: T0 }, true)).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 2, have: ["email"] } } });
    expect((await app(strong, session({ totp: T0, recovery: T0 }, true)).request("/x")).status).toBe(403);
    expect((await app(strong, session({ email: T0, totp: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ password: T0, recovery: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ passkey_uv: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ email: T0 }, false)).request("/x")).status).toBe(200);
    const stale = await app(strong, session({}, false)).request("/x");
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 1, have: [] } } });
  });

  test("both answer 401 without a session", async () => {
    const { sessions } = setup();
    for (const guard of [requireFreshAuth(deps(sessions)), requireStrongFreshAuth(deps(sessions))]) {
      const res = await app(guard, null).request("/x");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
  });
});
```

### Create `apps/api/test/integration/auth-lockdown.test.ts`

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, passkeys, sessions, type Db } from "@korbat/db";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { startEmail, verifyEmail } from "../../src/auth/flows/email";
import { emailRevertKey, revertEmailChange, startEmailChange, verifyEmailChange } from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS, lockdown } from "../../src/auth/flows/lockdown";
import { notMe } from "../../src/auth/flows/not-me";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR } from "../../src/auth/limits";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { flowHarness, newTestDevice, newTestEmail, onboardedUser, type FlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

/**
 * The lockdown against the real repository (1c design, sections 2 and 7.6), and the two links that run it in
 * this task: the new-device alert's "not me" and the email undo. Passkey rows are written directly, since no
 * flow adds one yet.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the lockdown and the links that run it", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** A passkey of the account created at `createdAt`, as a registration would write it; answers its id. */
  async function newPasskey(userId: string, createdAt: Date): Promise<string> {
    const [row] = await db.insert(passkeys).values({ userId, credentialId: randomToken(), publicKey: "cose-key", name: "Passkey", createdAt }).returning({ id: passkeys.id });
    return row!.id;
  }
  const passkeyIds = async (userId: string) => (await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId))).map((row) => row.id).sort();

  /** TOTP on since `enabledAt`, as the confirm step leaves it; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(h: FlowHarness, userId: string, enabledAt: Date) {
    await repo.enableTotp(userId, { secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey), recoveryCodesHash: ["owner-code"], now: enabledAt });
    await h.deps.sessions.forgetUser(userId);
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("revokes every session and device, clears the password, removes the passkeys from the day before the anchor on and the one named, turns off two-factor from then on, and records it; run again, it finds nothing more", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const bystander = await onboardedUser(h, repo, { password: PASSWORD });
    const anchor = new Date(h.clock.ms() + 3 * DAY);
    const since = new Date(anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
    const kept = await newPasskey(account.user.id, new Date(since.getTime() - 1));
    const named = await newPasskey(account.user.id, new Date(since.getTime() - 10 * DAY));
    const atSince = await newPasskey(account.user.id, since);
    const later = await newPasskey(account.user.id, new Date(anchor.getTime() + HOUR));
    const bystanders = await newPasskey(bystander.user.id, since);
    await withTotp(h, account.user.id, since);
    await withTotp(h, bystander.user.id, since);
    h.clock.advance(4 * DAY);

    const report = await lockdown(h.deps, { userId: account.user.id, anchor, passkeyIds: [named, bystanders], caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect([...report.passkeysRemoved].sort()).toEqual([named, atSince, later].sort());
    expect(report).toMatchObject({ totpCleared: true, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect(await passkeyIds(bystander.user.id)).toEqual([bystanders]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await h.kv.get(`sess:${account.session.sessionId}`)).toBe("revoked");
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] });
    expect((await repo.findUserById(bystander.user.id))!).toMatchObject({ totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await h.deps.sessions.resolve(bystander.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toEqual([
      { type: "not_me", deviceId: account.session.deviceId, ipHash: h.ctx.ipHash, metadata: { passkeysRemoved: report.passkeysRemoved, totpCleared: true, passwordCleared: true } },
    ]);

    const again = await lockdown(h.deps, { userId: account.user.id, anchor, caller: { type: "not_me", deviceId: account.session.deviceId }, ctx: h.ctx });
    expect(again).toEqual({ passkeysRemoved: [], totpCleared: false, passwordCleared: true });
    expect(await passkeyIds(account.user.id)).toEqual([kept]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me")).toHaveLength(2);

    // Two-factor from just before the day the lockdown reaches back stays.
    const earlier = await onboardedUser(h, repo);
    await withTotp(h, earlier.user.id, new Date(since.getTime() - 1));
    expect((await lockdown(h.deps, { userId: earlier.user.id, anchor, caller: { type: "not_me" }, ctx: h.ctx })).totpCleared).toBe(false);
    expect((await repo.findUserById(earlier.user.id))!.totpEnabledAt).toEqual(new Date(since.getTime() - 1));
  });

  test("the alert of a sign-in on a new device stores the sign-in's time and the address, and its link locks the account down anchored there", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const signedInAt = h.clock.ms() + 2 * DAY;
    const since = signedInAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    h.clock.advance(2 * DAY);
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    const signedIn = await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx);
    expect(signedIn.kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    const stored = JSON.parse((await h.kv.get(notMeKey(token)))!) as NotMeToken;
    expect(stored).toEqual({
      userId: account.user.id,
      deviceId: (signedIn as { issued: { session: { deviceId: string } } }).issued.session.deviceId,
      signedInAt,
      passkeyId: null,
      sentTo: emailHash(h.deps.config.authHmacKey, account.email),
    });
    // Whoever signed in turns two-factor on afterwards.
    h.clock.advance(HOUR);
    await withTotp(h, account.user.id, h.clock.now());
    h.clock.advance(HOUR);

    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ passwordHash: null, totpEnabledAt: null });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toEqual([]);
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.metadata])).toEqual([
      [stored.deviceId, { passkeysRemoved: [recent], totpCleared: true, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("a link from before the deploy is anchored a day before it is used: it reaches two days back", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const used = h.clock.ms() + 3 * DAY;
    const since = used - DAY - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const inReach = await newPasskey(account.user.id, new Date(since));
    await withTotp(h, account.user.id, new Date(since));
    const token = randomToken();
    await h.kv.set(notMeKey(token), JSON.stringify({ userId: account.user.id, deviceId: account.session.deviceId }), 4 * DAY);
    h.clock.advance(3 * DAY);
    await notMe(h.deps, { token }, h.ctx);
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "not_me").map((e) => e.metadata)).toEqual([{ passkeysRemoved: [inReach], totpCleared: true, passwordCleared: true }]);
  });

  test("a not-me link after the address changed does nothing but refuse", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const { flowId } = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    expect((await verifyEmail(h.deps, { flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).kind).toBe("session");
    const url = h.mailer.sent.find((m) => m.template === "new_device")!.data.notMeUrl!;
    const token = url.slice(url.lastIndexOf("/") + 1);
    await repo.changeEmail(account.user.id, newTestEmail("moved"), h.clock.now());
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await repo.listActiveSessions(account.user.id, h.clock.now())).toHaveLength(2);
    expect(await repo.listDevices(account.user.id)).toHaveLength(2);
    expect((await repo.findUserById(account.user.id))!.passwordHash).not.toBeNull();
    expect((await eventsOf(account.user.id)).map((e) => e.type)).not.toContain("not_me");
  });

  test("the email undo is anchored at the change and names the passkey behind the changing session", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const owners = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const changedAt = h.clock.ms() + 3 * DAY;
    const since = changedAt - LOCKDOWN_LOOKBACK_MS;
    const older = await newPasskey(account.user.id, new Date(since - 1));
    const recent = await newPasskey(account.user.id, new Date(since));
    // The passkey that started the changing session is far older than the day the lockdown reaches back.
    const behind = await newPasskey(account.user.id, new Date(since - 10 * DAY));
    await db.update(sessions).set({ passkeyId: behind }).where(eq(sessions.id, account.session.sessionId));
    await h.deps.sessions.forgetUser(account.user.id);
    await withTotp(h, account.user.id, new Date(since - 1));
    h.clock.advance(3 * DAY);
    const changing = (await h.deps.sessions.resolve(account.token))!.session;
    expect(changing.passkeyId).toBe(behind);
    const newAddress = newTestEmail("moved");
    const started = await startEmailChange(h.deps, changing, { email: newAddress }, h.ctx);
    await verifyEmailChange(h.deps, changing, { flowId: started.flowId, code: h.mailer.lastCodeFor(newAddress)! });
    const notice = h.mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: account.email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl!)![1]!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(token)))!)).toEqual({ userId: account.user.id, oldEmail: account.email, changedAt, passkeyId: behind });

    h.clock.advance(HOUR);
    const added = await newPasskey(account.user.id, h.clock.now());
    h.clock.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ email: account.email, passwordHash: null, totpSecretEnc: expect.stringMatching(/^v1:/) });
    expect(await passkeyIds(account.user.id)).toEqual([older]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(owners.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    const key = h.deps.config.authHmacKey;
    const reverted = (await eventsOf(account.user.id)).filter((e) => e.type === "email_changed").at(-1)!;
    expect(reverted).toMatchObject({ deviceId: null, ipHash: h.ctx.ipHash });
    expect(reverted.metadata).toMatchObject({ from: emailHash(key, newAddress), to: emailHash(key, account.email), reverted: true, totpCleared: false, passwordCleared: true });
    expect([...((reverted.metadata as { passkeysRemoved: string[] }).passkeysRemoved)].sort()).toEqual([recent, behind, added].sort());
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: account.email, template: "email_change_reverted" });
  });
});
```

### Create `apps/api/test/integration/http-reauth.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ReauthResponse, RecoveryCodesResponse, SessionResult, TotpSetupResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { encrypt, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { currentStep, hotp, newTotpSecret } from "../../src/auth/totp";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const PASSWORD = "correct horse battery staple";
const newHandle = () => `r${randomBytes(4).toString("hex")}`;
const newEmail = (prefix: string) => `${prefix}-${randomUUID()}@korbat.local`;

/**
 * The level-2 routes of the 1c design (section 10) and the re-authentication answer over HTTP: the four
 * modules wired as the server wires them, cookie and bearer sessions, and TOTP put on accounts directly.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: strong freshness and re-authentication over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-reauth-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in, onboarded web account: its session proved the sign-up's email code and nothing else. */
  async function signUp() {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = newEmail("reauth");
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  /** TOTP on, as the confirm step leaves it, with recovery codes; the session cache is dropped so mfaEnabled shows. */
  async function withTotp(userId: string) {
    const secret = newTotpSecret();
    const codes = newRecoveryCodes();
    await auth.deps.repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(secret), auth.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(auth.deps.config.authHmacKey, code)),
      now: new Date(),
    });
    await auth.deps.sessions.forgetUser(userId);
    return { secret, codes };
  }
  const totpNow = (secret: Uint8Array) => hotp(secret, currentStep(Date.now()));
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const post = (b: Browser, route: string, body: unknown) => (body === undefined ? b.fetch(route, { method: "POST" }) : b.fetch(route, { json: body }));

  /** Every level-2 route of section 10 that exists before the passkey routes, with a body that passes validation. */
  const strongRoutes = (handle: string): [string, unknown][] => [
    ["/api/auth/mfa/totp/setup", undefined],
    ["/api/auth/mfa/recovery-codes/regenerate", undefined],
    ["/api/auth/password/set", { password: PASSWORD }],
    ["/api/auth/email/change/start", { email: newEmail("moved") }],
    ["/api/account/delete/start", undefined],
    ["/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle }],
    ["/api/auth/mfa/totp/disable", {}],
  ];

  test("on an account with TOTP, a session that proved only its email code is refused level 2 by every strong route, keeps its level-1 routes, and passes after a TOTP re-authentication", { timeout: 60_000 }, async () => {
    const { b, handle } = await signUp();
    const { secret } = await withTotp((MeResponse.parse(await (await b.fetch("/api/me")).json())).user.id);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    for (const [route, body] of strongRoutes(handle)) {
      const refused = await post(b, route, body);
      expect(refused.status, route).toBe(403);
      expect(await error(refused), route).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["email"] } });
    }
    // Level 1 stays what it was: past the guard, these answer for their own reasons.
    const verify = await b.fetch("/api/auth/email/change/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(verify.status).toBe(400);
    expect((await error(verify)).code).toBe("invalid_code");
    expect((await b.fetch(`/api/auth/sessions/${"0".repeat(64)}`, { method: "DELETE" })).status).toBe(404);
    expect((await b.fetch("/api/account/export", { method: "POST" })).status).toBe(200);

    const before = b.cookie("__Host-korbat_session")!;
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "totp", code: totpNow(secret) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body.
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 2 });
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${before}` } })).status).toBe(401);
    expect((await b.fetch("/api/me")).status).toBe(200);

    const setup = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(setup.status).toBe(200);
    TotpSetupResponse.parse(await setup.json());
    const regenerated = await post(b, "/api/auth/mfa/recovery-codes/regenerate", undefined);
    expect(regenerated.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await regenerated.json()).recoveryCodes).toHaveLength(10);
    const set = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    const change = await post(b, "/api/auth/email/change/start", { email: newEmail("moved") });
    expect(change.status).toBe(200);
    FlowResponse.parse(await change.json());
    const deletion = await post(b, "/api/account/delete/start", undefined);
    expect(deletion.status).toBe(200);
    FlowResponse.parse(await deletion.json());
    const confirm = await post(b, "/api/account/delete/confirm", { flowId: randomToken(), code: "123456", handle });
    expect(confirm.status).toBe(400);
    expect((await error(confirm)).code).toBe("invalid_code");
    // Last, since it changes what the account needs: no code in the body, the re-authentication spent it.
    expect((await post(b, "/api/auth/mfa/totp/disable", {})).status).toBe(204);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(false);
  });

  test("an account without TOTP passes every strong route with its email code alone, and its re-authentication answers level 1", { timeout: 60_000 }, async () => {
    const { b, email, handle } = await signUp();
    const expected: Record<string, number> = {
      "/api/auth/mfa/totp/setup": 200,
      "/api/auth/mfa/recovery-codes/regenerate": 400,
      "/api/auth/password/set": 200,
      "/api/auth/email/change/start": 200,
      "/api/account/delete/start": 200,
      "/api/account/delete/confirm": 400,
      "/api/auth/mfa/totp/disable": 400,
    };
    for (const [route, body] of strongRoutes(handle)) {
      const res = await post(b, route, body);
      expect(res.status, route).toBe(expected[route]);
      if (res.status === 400) expect((await error(res)).code, route).toMatch(/^(mfa_required|invalid_code)$/);
    }
    await makeStale(b);
    const refused = await post(b, "/api/auth/password/set", { password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toMatchObject({ code: "reauth_required", details: { level: 1, have: [] } });
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(ReauthResponse.parse(await reauth.json())).toEqual({ level: 1 });
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
  });

  test("a native session gets the rotated token in the answer's body, and the old one stops working at once", async () => {
    const native = new NativeClient(app);
    const email = newEmail("native");
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    native.token = ((await (await native.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Phone User" } })).json()) as { token: string }).token;
    const before = native.token!;
    const start = FlowResponse.parse(await (await native.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await native.fetch("/api/auth/reauth", { json: { method: "email", flowId: start.flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    expect(reauth.headers.getSetCookie()).toHaveLength(0);
    const body = ReauthResponse.parse(await reauth.json());
    expect(body).toEqual({ level: 1, token: expect.stringMatching(/^kb1_[A-Za-z0-9_-]{43}$/) });
    expect(body.token).not.toBe(before);
    expect((await native.fetch("/api/me")).status).toBe(401);
    native.token = body.token;
    expect((await native.fetch("/api/me")).status).toBe(200);
  });

  test("a recovery code re-authenticates over HTTP: level 2 after a password, the code normalised, the answer asking for re-enrolment", { timeout: 60_000 }, async () => {
    const { b, userId } = await signUp();
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(200);
    const { codes } = await withTotp(userId);
    await makeStale(b);
    const wrong = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: "abcd-ef23-gh45" } });
    expect(wrong.status).toBe(401);
    expect((await error(wrong)).code).toBe("invalid_mfa_code");
    const byPassword = await b.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(ReauthResponse.parse(await byPassword.json())).toEqual({ level: 1 });
    const byCode = await b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: ` ${codes[0]!.toUpperCase()} ` } });
    expect(byCode.status).toBe(200);
    expect(ReauthResponse.parse(await byCode.json())).toEqual({ level: 2, mustReenrollMfa: true });
    expect(mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([(await auth.deps.repo.findUserById(userId))!.email]);
    // Without TOTP there is no recovery code to check.
    const plain = await signUp();
    const refused = await plain.b.fetch("/api/auth/reauth", { json: { method: "recovery", recoveryCode: codes[1] } });
    expect(refused.status).toBe(400);
    expect((await error(refused)).code).toBe("mfa_required");
  });

  test("TOTP confirm needs no freshness: a session gone stale since the setup still confirms with the pending secret, and the code it proved counts as a factor", { timeout: 60_000 }, async () => {
    const { b } = await signUp();
    const setup = TotpSetupResponse.parse(await (await post(b, "/api/auth/mfa/totp/setup", undefined)).json());
    const encoded = new URL(setup.otpauthUri).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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
    const secret = Uint8Array.from(bytes);
    await makeStale(b);
    expect((await post(b, "/api/auth/password/set", { password: PASSWORD })).status).toBe(403);
    const before = b.cookie("__Host-korbat_session")!;
    const confirm = await post(b, "/api/auth/mfa/totp/confirm", { code: totpNow(secret) });
    expect(confirm.status).toBe(200);
    expect(RecoveryCodesResponse.parse(await confirm.json()).recoveryCodes).toHaveLength(10);
    expect(b.cookie("__Host-korbat_session")).not.toBe(before);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.mfaEnabled).toBe(true);
    // The code proved the new secret, so the session holds `totp` alone: level 1, and a strong route says what is missing.
    const again = await post(b, "/api/auth/mfa/totp/setup", undefined);
    expect(again.status).toBe(403);
    expect(await error(again)).toMatchObject({ code: "reauth_required", details: { level: 2, have: ["totp"] } });
  });
});
```

### Replace `apps/api/test/account/deletion.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { DbTx } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { PURGE_INTERVAL_MS, createPurgeJob, purgePending } from "../../src/account/purge";
import { AuthError, type Session } from "../../src/auth";
import type { RequestContext } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryJobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";

const T0 = 1_789_000_000_000;

interface LogLine {
  level: number;
  msg: string;
  userId?: string;
  purged?: number;
  failed?: number;
}

/**
 * The deletion flows and the purge job on stateful fakes of the three module interfaces: the auth
 * fake knows one account whose handle is "ada" and keeps deleted_at and purged_at per account; the
 * social fake keeps which profiles were purged and can be told to fail once for an account, before its
 * transaction does anything or at its commit (which puts back the image rows the transaction took, as a
 * rollback would); the media fake holds image ids per owner and hands them out once. Every call is
 * logged in order, the commit of the social purge's transaction included, and the transaction it opens
 * is a sentinel the media fake must be handed.
 */
function harness() {
  let t = T0;
  const calls: string[] = [];
  const lines: LogLine[] = [];
  const users = new Map<string, { deletedAt: Date | null; purgedAt: Date | null }>();
  const purgedProfiles = new Map<string, Date>();
  const failing = new Set<string>();
  const failingCommit = new Set<string>();
  const images = new Map<string, string[]>();
  const requested: string[][] = [];
  const started: { session: Session; ctx: RequestContext }[] = [];
  const tx = { sentinel: randomUUID() } as unknown as DbTx;
  const seenTx: unknown[] = [];
  const deps: AccountDeps = {
    auth: {
      startDeletion: async (session, ctx) => {
        calls.push("auth.startDeletion");
        started.push({ session, ctx });
        return { flowId: `flow-${session.userId}` };
      },
      confirmDeletion: async (session, input) => {
        calls.push("auth.confirmDeletion");
        if (input.handle.toLowerCase() !== "ada") throw new AuthError("invalid_request", 400, "handle_mismatch");
        const user = users.get(session.userId);
        if (!user || user.deletedAt) throw new AuthError("invalid_credentials", 401);
        user.deletedAt = new Date(t);
      },
      pendingPurges: async () => {
        calls.push("auth.pendingPurges");
        return [...users].filter(([, user]) => user.deletedAt && !user.purgedAt).map(([id]) => id);
      },
      finishPurge: async (userId) => {
        calls.push("auth.finishPurge");
        const user = users.get(userId);
        // As the real statement: a row already purged, or never deleted, is left alone.
        if (user?.deletedAt && !user.purgedAt) user.purgedAt = new Date(t);
      },
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: async () => undefined,
    },
    social: {
      purgeProfile: async (userId, now, within) => {
        calls.push("social.purgeProfile");
        if (failing.delete(userId)) throw new Error("the social purge failed");
        const rowsBefore = images.get(userId);
        await within(tx);
        if (failingCommit.delete(userId)) {
          calls.push("social.rollback");
          if (rowsBefore) images.set(userId, rowsBefore);
          throw new Error("the social purge's commit failed");
        }
        calls.push("social.commit");
        if (!purgedProfiles.has(userId)) purgedProfiles.set(userId, now);
      },
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: async (within, ownerId) => {
        calls.push("media.purgeOwner");
        seenTx.push(within);
        const ids = images.get(ownerId) ?? [];
        images.delete(ownerId);
        return ids;
      },
      requestDeletion: async (ids) => {
        calls.push(`media.requestDeletion(${ids.length})`);
        requested.push([...ids]);
      },
      exportImages: async () => [],
    },
    limits: new MemoryStore(() => t),
    log: pino({ level: "info" }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(t),
  };
  /** An onboarded account, live unless told otherwise, with a session that just proved a credential. */
  function account(options: { deletedAt?: Date; images?: string[] } = {}): { userId: string; session: Session } {
    const userId = randomUUID();
    users.set(userId, { deletedAt: options.deletedAt ?? null, purgedAt: null });
    if (options.images) images.set(userId, options.images);
    const session: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: new Date(t),
      handle: randomUUID(),
      factors: { email: t },
      passkeyId: null,
    };
    return { userId, session };
  }
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: "test" };
  return {
    deps,
    calls,
    lines,
    users,
    purgedProfiles,
    failing,
    failingCommit,
    images,
    requested,
    started,
    tx,
    seenTx,
    ctx,
    account,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("account deletion: the flows", () => {
  test("the start step hands the session and the request context to the auth module and answers its flow id", async () => {
    const h = harness();
    const ada = h.account();
    expect(await startDeletion(h.deps, ada.session, h.ctx)).toEqual({ flowId: `flow-${ada.userId}` });
    expect(h.started).toEqual([{ session: ada.session, ctx: h.ctx }]);
    expect(h.calls).toEqual(["auth.startDeletion"]);
  });

  test("confirming runs the auth confirmation, then the social purge with the media detach and the file deletion requests inside its transaction, then the auth purge, in that order", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ images: [imageA, imageB] });
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "Ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "media.requestDeletion(2)", "social.commit", "auth.finishPurge"]);
    // The image rows go in the social purge's own transaction, and their files are asked for by id before it commits,
    // so no run can commit the rows away and then stop before asking.
    expect(h.seenTx).toEqual([h.tx]);
    expect(h.requested).toEqual([[imageA, imageB]]);
    expect(h.purgedProfiles.get(ada.userId)).toEqual(h.now());
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: h.now() });
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    expect(h.lines.filter((line) => line.level >= 40)).toEqual([]);
  });

  test("a refused confirmation purges nothing", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    const refused = await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "not_ada" }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AuthError);
    expect((refused as AuthError).message).toBe("handle_mismatch");
    expect(h.calls).toEqual(["auth.confirmDeletion"]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: null, purgedAt: null });
    expect(h.images.get(ada.userId)).toHaveLength(1);
  });

  test("a purge that fails after the confirmation is logged and the confirmation still succeeds; the account stays pending for the job", async () => {
    const h = harness();
    const ada = h.account({ images: [randomUUID()] });
    h.failing.add(ada.userId);
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile"]);
    expect(h.requested).toEqual([]);
    expect(h.users.get(ada.userId)).toEqual({ deletedAt: h.now(), purgedAt: null });
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    const errors = h.lines.filter((line) => line.level >= 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.userId).toBe(ada.userId);
    expect(errors[0]!.msg).toMatch(/purge/);
  });

  test("the purge is safe to repeat: a second run detaches nothing, requests no deletion, and leaves the purged row as it was", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [randomUUID()] });
    await purge(h.deps, ada.userId);
    const first = { ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) };
    expect(first).toEqual({ deletedAt: new Date(T0 - 60_000), purgedAt: h.now(), profilePurgedAt: h.now() });
    h.calls.length = 0;
    h.advance(60_000);
    await purge(h.deps, ada.userId);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(0)", "social.commit", "auth.finishPurge"]);
    expect(h.requested).toEqual([[expect.any(String)], []]);
    expect({ ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) }).toEqual(first);
  });

  test("a purge whose transaction fails at the commit has already asked for the files; the next run finds the rows again and asks for the same ids", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ deletedAt: new Date(T0 - 60_000), images: [imageA, imageB] });
    h.failingCommit.add(ada.userId);
    await expect(purge(h.deps, ada.userId)).rejects.toThrow(/commit/);
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(2)", "social.rollback"]);
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    // The requests are one per id, so asking again for the same ids changes nothing on disk.
    await purge(h.deps, ada.userId);
    expect(h.requested).toEqual([
      [imageA, imageB],
      [imageA, imageB],
    ]);
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
  });
});

describe("the purge job", () => {
  test("purges every pending account, counts the ones that failed, and finishes on the next round what failed once", async () => {
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 120_000), images: [randomUUID()] });
    const bob = h.account({ deletedAt: new Date(T0 - 60_000) });
    h.account();
    h.failing.add(ada.userId);

    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 1 });
    expect(h.users.get(ada.userId)!.purgedAt).toBeNull();
    expect(h.users.get(bob.userId)!.purgedAt).toEqual(h.now());
    expect(await h.deps.auth.pendingPurges()).toEqual([ada.userId]);
    // The failure is logged with the account, and the round with its counts.
    expect(h.lines.filter((line) => line.level >= 50).map((line) => line.userId)).toEqual([ada.userId]);
    expect(h.lines.filter((line) => line.purged !== undefined).map((line) => [line.purged, line.failed])).toEqual([[1, 1]]);

    h.advance(PURGE_INTERVAL_MS);
    expect(await purgePending(h.deps)).toEqual({ purged: 1, failed: 0 });
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(h.requested).toEqual([[], [expect.any(String)]]);
    expect(await h.deps.auth.pendingPurges()).toEqual([]);
    // A round with nothing to do reports zeros and logs nothing.
    h.lines.length = 0;
    expect(await purgePending(h.deps)).toEqual({ purged: 0, failed: 0 });
    expect(h.lines).toEqual([]);
  });

  test("runs every five minutes under the lock job:account-purge, and skips a round another instance holds", async () => {
    expect(PURGE_INTERVAL_MS).toBe(5 * 60_000);
    const h = harness();
    const ada = h.account({ deletedAt: new Date(T0 - 60_000) });
    const lock = new MemoryJobLock(() => Date.now());
    const job = createPurgeJob(h.deps, lock);
    await lock.acquire("job:account-purge", "other", 10_000);
    expect(await job.round()).toBe("skipped");
    expect(h.calls).toEqual([]);
    await lock.release("job:account-purge", "other");
    expect(await job.round()).toBe("ran");
    expect(h.users.get(ada.userId)!.purgedAt).toEqual(h.now());
    expect(await lock.acquire("job:account-purge", "other", 10_000)).toBe(true);
  });
});
```

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Deflate, strFromU8, unzipSync } from "fflate";
import { Hono, type MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { ExportedPost } from "../../src/social";
import type { HandleRefRow, PostRefRow } from "../../src/social/repo";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const silent = pino({ level: "silent" });
const KIB64 = 64 * 1024;
const TWO_32 = 0x1_0000_0000;

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
}

/** Opens a file as the media module's checked open answers: the handle with the size it measured, or null for no plain file. */
function openerOf(file: string): OpenFile {
  return async () => {
    let handle: FileHandle;
    try {
      handle = await open(file, "r");
    } catch {
      return null;
    }
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  };
}

/**
 * Collects the archive in memory. Every write takes a turn of the event loop, and a write that
 * starts while another is still pending is remembered: the writer must await each one.
 */
function memorySink() {
  const chunks: Uint8Array[] = [];
  let busy = false;
  let overlapped = false;
  return {
    async write(chunk: Uint8Array): Promise<void> {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunks.push(Uint8Array.from(chunk));
      busy = false;
    },
    bytes: (): Buffer => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/**
 * A stand-in for an opened store file: `size` bytes of `chunk` (zeros unless given), yielded lazily in
 * chunks of its length, failing once `failAfter` chunks were read when asked to. It records how many
 * chunks were read, whether the reading stopped and whether the handle was closed.
 */
function fakeFile(size: number, options: { failAfter?: number; chunk?: Uint8Array } = {}) {
  const chunk = options.chunk ?? new Uint8Array(KIB64);
  const state = { chunks: 0, stopped: false, closed: false };
  const handle = {
    createReadStream({ start = 0, end = size - 1 }: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
      return (async function* () {
        try {
          for (let at = start; at <= end; at += chunk.length) {
            if (options.failAfter !== undefined && state.chunks >= options.failAfter) throw new Error("the disk failed in the middle of the file");
            state.chunks += 1;
            yield at + chunk.length - 1 <= end ? chunk : chunk.subarray(0, end - at + 1);
          }
        } finally {
          state.stopped = true;
        }
      })();
    },
    async close() {
      state.closed = true;
    },
  };
  const opener: OpenFile = async () => ({ handle: handle as unknown as FileHandle, size });
  return { open: opener, state, chunk };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function* piecesOf(...pieces: string[]): AsyncGenerator<string> {
  yield* pieces;
}

/** One central directory entry as a reader finds it. */
interface CentralEntry {
  at: number;
  name: string;
  method: number;
  versionNeeded: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  /** The payload of the ZIP64 extra field (id 0x0001), as 64-bit values, or null without one. */
  zip64: number[] | null;
}

const u64 = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * TWO_32;

/** Every central directory entry in archive order, found by its signature (none of the test data holds it). */
function centralDirectory(archive: Uint8Array, base = 0): CentralEntry[] {
  const bytes = Buffer.from(archive);
  const entries: CentralEntry[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    let zip64: number[] | null = null;
    for (let at = i + 46 + nameLength; at + 4 <= i + 46 + nameLength + extraLength; at += 4 + bytes.readUInt16LE(at + 2)) {
      if (bytes.readUInt16LE(at) !== 0x0001) continue;
      const length = bytes.readUInt16LE(at + 2);
      zip64 = Array.from({ length: length / 8 }, (_, k) => u64(bytes, at + 4 + 8 * k));
    }
    entries.push({
      at: base + i,
      name: bytes.toString("utf8", i + 46, i + 46 + nameLength),
      method: bytes.readUInt16LE(i + 10),
      versionNeeded: bytes.readUInt16LE(i + 6),
      flags: bytes.readUInt16LE(i + 8),
      compressed: bytes.readUInt32LE(i + 20),
      size: bytes.readUInt32LE(i + 24),
      offset: bytes.readUInt32LE(i + 42),
      zip64,
    });
  }
  return entries;
}

/** The end records, read from the archive's last bytes as a reader does: the classic one, then the ZIP64 locator and record when present. */
function endRecords(archive: Uint8Array, base = 0) {
  const bytes = Buffer.from(archive);
  const at = bytes.length - 22;
  expect(bytes.readUInt32LE(at)).toBe(0x06054b50);
  const end = { entriesHere: bytes.readUInt16LE(at + 8), entries: bytes.readUInt16LE(at + 10), size: bytes.readUInt32LE(at + 12), offset: bytes.readUInt32LE(at + 16), comment: bytes.readUInt16LE(at + 20) };
  if (at < 20 || bytes.readUInt32LE(at - 20) !== 0x07064b50) return { end, locator: null, end64: null };
  const locator = { disk: bytes.readUInt32LE(at - 16), offset: u64(bytes, at - 12), disks: bytes.readUInt32LE(at - 4) };
  const r = locator.offset - base;
  expect(bytes.readUInt32LE(r)).toBe(0x06064b50);
  const end64 = {
    at: base + r,
    recordSize: u64(bytes, r + 4),
    versionMadeBy: bytes.readUInt16LE(r + 12),
    versionNeeded: bytes.readUInt16LE(r + 14),
    disk: bytes.readUInt32LE(r + 16),
    directoryDisk: bytes.readUInt32LE(r + 20),
    entriesHere: u64(bytes, r + 24),
    entries: u64(bytes, r + 32),
    size: u64(bytes, r + 40),
    offset: u64(bytes, r + 48),
  };
  return { end, locator, end64 };
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

interface Lists {
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions, one
 * device and two events; a profile with a post carrying two images and a deleted reply, one like, one
 * bookmark, a follow, a block and a mute; and whatever images the test puts in `images`. The social
 * fake hands each list out in pages of the size it is asked for, reading a page only when it is
 * iterated, and records every read in `reads`; a test may add rows to `lists`. `failures` makes the
 * next calls of a module read throw.
 */
function harness() {
  let t = T0;
  const images: { id: string; open: OpenFile }[] = [];
  const userId = randomUUID();
  const currentSession = randomBytes(32).toString("hex");
  const otherSession = randomBytes(32).toString("hex");
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0 };
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const account: AccountExport = {
    account: { id: userId, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
    sessions: [
      { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
      { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
    events: [
      { type: "signin_success", at: new Date(T0 - DAY_MS) },
      { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
    ],
  };
  const lists: Lists = {
    posts: [
      {
        id: postId,
        body: "two photos",
        createdAt: new Date(T0 - 2 * DAY_MS),
        replyToId: null,
        quoteOfId: null,
        state: "visible",
        deletedAt: null,
        media: [
          { id: imageA, altText: "a harbour at dawn", width: 1600, height: 1200 },
          { id: imageB, altText: "a lighthouse", width: 900, height: 1600 },
        ],
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [] },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
  };
  /** A list in pages of `pageSize`, each read when the one before has been used, as the social module pages its keyset reads. */
  function paged<T>(name: keyof Lists, rows: T[], pageSize: number): AsyncIterable<T[]> {
    return {
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += pageSize) {
          reads.push(name);
          const page = rows.slice(at, at + pageSize);
          if (page.length > 0) yield page;
          if (page.length < pageSize) return;
        }
      },
    };
  }
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: async () => {
        if (failures.exportAccount > 0) {
          failures.exportAccount -= 1;
          throw new Error("the auth pool timed out");
        }
        return account;
      },
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async (_id, pageSize = 1000) => ({
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
        posts: paged("posts", lists.posts, pageSize),
        likes: paged("likes", lists.likes, pageSize),
        reposts: paged("reposts", lists.reposts, pageSize),
        bookmarks: paged("bookmarks", lists.bookmarks, pageSize),
        following: paged("following", lists.following, pageSize),
        blocks: paged("blocks", lists.blocks, pageSize),
        mutes: paged("mutes", lists.mutes, pageSize),
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
    userId,
    currentSession,
    otherSession,
    postId,
    deletedId,
    likedId,
    bookmarkedId,
    imageA,
    imageB,
    images,
    events,
    lists,
    reads,
    failures,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** export.json as a document in memory, built from the harness's rows the way the export describes them, for JSON.stringify to write. */
function expectedDocument(h: Harness, missingMedia: string[] = []) {
  const ref = (row: PostRefRow) => ({ postId: row.postId, at: row.at.toISOString() });
  const other = (row: HandleRefRow) => ({ handle: row.handle, since: row.since.toISOString() });
  return {
    format: "korbat-export-1",
    exportedAt: iso(T0),
    account: { id: h.userId, email: "ada@korbat.local", createdAt: iso(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: iso(T0 - 3 * DAY_MS) },
    profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
    })),
    likes: h.lists.likes.map(ref),
    reposts: h.lists.reposts.map(ref),
    bookmarks: h.lists.bookmarks.map(ref),
    following: h.lists.following.map(other),
    blocks: h.lists.blocks.map(other),
    mutes: h.lists.mutes.map(other),
    sessions: [
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }],
    events: [
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ],
    missingMedia,
  };
}

/** More rows in every list than a few pages of two hold: text that JSON escapes, a line break inside a body, characters outside ASCII. */
function addManyRows(h: Harness): void {
  const quote = String.fromCharCode(34);
  const newline = String.fromCharCode(10);
  const accented = `caf${String.fromCharCode(0xe9)} ${String.fromCodePoint(0x1f600)}`;
  for (let i = 0; i < 5; i++) {
    h.lists.posts.push({
      id: randomUUID(),
      body: `post ${i}: ${quote}quoted${quote}${newline}second line, ${accented}`,
      createdAt: new Date(T0 - DAY_MS + i),
      replyToId: i % 2 === 0 ? h.postId : null,
      quoteOfId: i === 3 ? h.postId : null,
      state: i === 4 ? "withheld" : "visible",
      deletedAt: null,
      media: i === 1 ? [{ id: randomUUID(), altText: `alt ${accented}`, width: 10, height: 20 }] : [],
    });
  }
  for (let i = 0; i < 6; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 900 + i) });
  for (let i = 0; i < 3; i++) h.lists.reposts.push({ postId: randomUUID(), at: new Date(T0 - 800 + i) });
  for (let i = 0; i < 4; i++) h.lists.bookmarks.push({ postId: randomUUID(), at: new Date(T0 - 700 + i) });
  for (let i = 0; i < 5; i++) h.lists.following.push({ handle: `friend_${i}`, since: new Date(T0 - 600 + i) });
  for (let i = 0; i < 2; i++) h.lists.blocks.push({ handle: `blocked_${i}`, since: new Date(T0 - 500 + i) });
  for (let i = 0; i < 3; i++) h.lists.mutes.push({ handle: `muted_${i}`, since: new Date(T0 - 400 + i) });
}

/** How many reads a list of `rows` takes in pages of `size`: full pages, then the short (maybe empty) one that says it is over. */
const readsFor = (rows: number, size: number) => Math.floor(rows / size) + 1;

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(JSON.parse((await collect(exportJson(plan))).join("")));
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({ id: h.userId, email: "ada@korbat.local", createdAt: iso(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: iso(T0 - 3 * DAY_MS) });
    expect(json.sessions).toEqual([
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ]);
    expect(json.devices).toEqual([{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }]);
    expect(json.events).toEqual([
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ]);
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] });
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0]).toEqual({
      id: h.postId,
      body: "two photos",
      createdAt: iso(T0 - 2 * DAY_MS),
      replyToId: null,
      quoteOfId: null,
      state: "visible",
      deletedAt: null,
      media: [
        { id: h.imageA, file: `media/${h.imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: h.imageB, file: `media/${h.imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [] });
    expect(json.likes).toEqual([{ postId: h.likedId, at: iso(T0 - DAY_MS) }]);
    expect(json.reposts).toEqual([]);
    expect(json.bookmarks).toEqual([{ postId: h.bookmarkedId, at: iso(T0 - 500) }]);
    expect(json.following).toEqual([{ handle: "bob", since: iso(T0 - 2 * DAY_MS) }]);
    expect(json.blocks).toEqual([{ handle: "eve", since: iso(T0 - DAY_MS) }]);
    expect(json.mutes).toEqual([{ handle: "carol", since: iso(T0 - 200) }]);
    expect(json.missingMedia).toEqual([]);
    expect(plan.images).toEqual([]);
    // Building the plan records nothing: the event belongs after the last chunk of the stream.
    expect(h.events).toEqual([]);
  });

  test("the images to write are the media module's, and the entry name is media/<id>.webp", async () => {
    const h = harness();
    h.images.push({ id: randomUUID(), open: openerOf(path.join(root, "a")) }, { id: randomUUID(), open: openerOf(path.join(root, "b")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
  });

  test("export.json is read list by list in pages and written piece by piece, byte for byte as JSON.stringify(document, null, 2) writes it", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    // Only the account and the profile's own fields are read up front; the lists wait for the JSON to be written.
    expect(h.reads).toEqual([]);
    const text = (await collect(exportJson(plan))).join("");
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    // Every list was read in pages of two, one page after the other, in the document's order.
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes"];
    expect(h.reads).toEqual(order.flatMap((name) => Array.from({ length: readsFor(h.lists[name].length, 2) }, () => name)));
    // The same account in one page per list is the same text.
    const whole = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect((await collect(exportJson(whole))).join("")).toBe(text);
  });

  test("empty lists and missing images are written as JSON.stringify writes them", async () => {
    const h = harness();
    for (const name of ["posts", "likes", "bookmarks", "following", "blocks", "mutes"] as const) h.lists[name].length = 0;
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 3);
    plan.missingMedia.push(h.imageA, h.imageB);
    expect((await collect(exportJson(plan))).join("")).toBe(JSON.stringify(expectedDocument(h, [h.imageA, h.imageB]), null, 2));
  });

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [] });
    const pieces = await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())));
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(KIB64);
    expect(pieces.join("")).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("the file name carries the handle and the day of the export", () => {
    expect(exportFilename("ada_l", new Date("2026-09-24T23:59:59.000Z"))).toBe("korbat-export-ada_l-2026-09-24.zip");
  });

  test("one export a day: the second is rate_limited with a Retry-After, the next day is allowed again, and a store that fails closes the door", async () => {
    const h = harness();
    await enforceExportLimit(h.deps, h.userId);
    const refused = await enforceExportLimit(h.deps, h.userId).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AccountError);
    expect((refused as AccountError).code).toBe("rate_limited");
    expect((refused as AccountError).status).toBe(429);
    expect((refused as AccountError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as AccountError).retryAfterSeconds).toBeLessThanOrEqual(EXPORT_WINDOW_MS / 1000);
    // Another account is not affected.
    await enforceExportLimit(h.deps, randomUUID());
    h.advance(EXPORT_WINDOW_MS + 1);
    await enforceExportLimit(h.deps, h.userId);

    const failing: AccountDeps = {
      ...h.deps,
      limits: {
        hit: async () => {
          throw new Error("store down");
        },
        release: async () => undefined,
      },
    };
    const down = await enforceExportLimit(failing, h.userId).catch((err: unknown) => err);
    expect(down).toBeInstanceOf(AccountError);
    expect((down as AccountError).code).toBe("service_unavailable");
    expect((down as AccountError).status).toBe(503);
    expect((down as AccountError).retryAfterSeconds).toBe(30);
  });
});

describe("writing the archive", () => {
  test("the archive holds export.json and every image byte for byte, in chunks that are each awaited", async () => {
    const bytesA = randomBytes(200_000);
    const bytesB = Buffer.from("small-webp");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(fileOf(bytesB)) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    expect(sink.overlapped).toBe(false);
    // Two hundred kilobytes do not fit in one read: the image went through several awaited writes.
    expect(sink.count).toBeGreaterThan(3);

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`, `media/${h.imageB}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageB}.webp`]!), bytesB)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(centralDirectory(sink.bytes()).map((entry) => [entry.name, entry.method])).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(path.join(root, randomUUID(), "large.webp")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([h.imageB]);
    // The post still names the entry the image would have had; missingMedia says why it is not there.
    expect(json.posts[0]!.media[1]!.file).toBe(`media/${h.imageB}.webp`);
    expect(plan.missingMedia).toEqual([h.imageB]);
  });

  /** A store with one image whose large variant holds `bytes`, read through the media module's checked open. */
  async function storeWith(id: string, bytes: Uint8Array) {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: silent });
    await files.prepare();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), bytes);
    return files;
  }

  test("an image larger than a variant may be is refused by the checked open and listed under missingMedia like a missing one", async () => {
    const h = harness();
    const files = await storeWith(h.imageA, Buffer.from("planted"));
    // A sparse file of any size could be planted in the store; the checked open refuses anything over the variant limit.
    truncateSync(files.store.image(h.imageA, "large"), MAX_VARIANT_BYTES + 1);
    const kept = await storeWith(h.imageB, Buffer.from("fine"));
    h.images.push({ id: h.imageA, open: () => files.openImage(h.imageA, "large") }, { id: h.imageB, open: () => kept.openImage(h.imageB, "large") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const archive = sink.bytes();
    expect(archive.length).toBeLessThan(MAX_VARIANT_BYTES);
    const unpacked = unzipSync(archive);
    expect(Object.keys(unpacked).sort()).toEqual(["export.json", `media/${h.imageB}.webp`].sort());
    expect(ExportFormat.parse(JSON.parse(strFromU8(unpacked["export.json"]!))).missingMedia).toEqual([h.imageA]);
  });

  test("a file that grows after the checked open is read only to the size the open measured", async () => {
    const h = harness();
    const original = randomBytes(150_000);
    const files = await storeWith(h.imageA, original);
    h.images.push({
      id: h.imageA,
      open: async () => {
        const stored = await files.openImage(h.imageA, "large");
        // Whatever lands in the file after the check is not the checked file's.
        appendFileSync(files.store.image(h.imageA, "large"), randomBytes(100_000));
        return stored;
      },
    });
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), await buildExport(h.deps, h.userId, h.currentSession, h.now()));
    const unpacked = unzipSync(sink.bytes());
    expect(Buffer.compare(Buffer.from(unpacked[`media/${h.imageA}.webp`]!), original)).toBe(0);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON pieces deflated as one text, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const first = JSON.stringify({ kind: "first", filler: "x".repeat(2_000) }, null, 2);
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJsonPieces("first.json", piecesOf(first.slice(0, 700), first.slice(700)));
    expect(await writer.addFile("files/stored.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("last.json", piecesOf('{ "kind": "last" }'));
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(first);
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe('{ "kind": "last" }');
    const directory = centralDirectory(sink.bytes());
    expect(directory.map((entry) => [entry.name, entry.method])).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    // A plain archive has no ZIP64 field or record, and every entry streams its sizes after its data.
    expect(directory.map((entry) => entry.zip64)).toEqual([null, null, null]);
    expect(directory.every((entry) => entry.versionNeeded === 45 && (entry.flags & 0x0008) !== 0)).toBe(true);
    expect(endRecords(sink.bytes()).end64).toBeNull();
    expect(sink.overlapped).toBe(false);
  });

  test("a file the open refuses adds nothing and answers false; a zero-byte file is an entry without data", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", openerOf(path.join(root, randomUUID(), "missing.webp")))).toBe(false);
    expect(await writer.addFile("dir.bin", openerOf(dir))).toBe(false);
    const empty = fakeFile(0);
    expect(await writer.addFile("empty.bin", empty.open)).toBe(true);
    expect(empty.state).toEqual({ chunks: 0, stopped: false, closed: true });
    await writer.addJsonPieces("only.json", piecesOf('{ "ok": true }'));
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["empty.bin", "only.json"]);
    expect(files["empty.bin"]!.length).toBe(0);
    expect(centralDirectory(sink.bytes()).map((entry) => entry.name)).toEqual(["empty.bin", "only.json"]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });

  test("the JSON is fed to the deflate at most 64 KiB at a time, and the event loop turns between two feeds", async () => {
    const push = vi.spyOn(Deflate.prototype, "push");
    const chunks: Uint8Array[] = [];
    const writer = createZipWriter(async (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    // One piece of 300 KiB and ten small ones.
    const big = "y".repeat(300 * 1024);
    let fed: number[];
    try {
      await writer.addJsonPieces("big.json", piecesOf(big, ...Array.from({ length: 10 }, (_, i) => `,${i}`)));
      await writer.end();
      // Read before the spy is restored, which forgets its calls.
      fed = push.mock.calls.map(([chunk]) => chunk.length);
    } finally {
      running = false;
      push.mockRestore();
    }
    expect(Math.max(...fed)).toBeLessThanOrEqual(KIB64);
    expect(fed.filter((length) => length > 0)).toHaveLength(5 + 10);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(strFromU8(unzipSync(Buffer.concat(chunks))["big.json"]!)).toBe(big + Array.from({ length: 10 }, (_, i) => `,${i}`).join(""));
  });

  test("forced ZIP64 on a small archive: it opens and gives back its bytes, and its records say what a ZIP64 reader needs", async () => {
    const stored = randomBytes(5_000);
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { zip64: "always" });
    expect(await writer.addFile("a.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("b.json", piecesOf('{ "b": 1 }'));
    await writer.end();
    const archive = sink.bytes();

    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["a.bin", "b.json"]);
    expect(Buffer.compare(Buffer.from(files["a.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["b.json"]!)).toBe('{ "b": 1 }');

    // Every 32-bit field reads 0xFFFFFFFF and the extra field holds the uncompressed size, the compressed size and the offset, in that order.
    const [a, b] = centralDirectory(archive);
    expect(a).toMatchObject({ name: "a.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0xffffffff, zip64: [5_000, 5_000, 0] });
    expect(b!.zip64![2]).toBe(30 + "a.bin".length + 5_000 + 24);
    expect(b!.zip64![0]).toBe(10);
    // The data descriptor after a.bin's bytes carries 8-byte sizes.
    const descriptor = 30 + "a.bin".length + 5_000;
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect([u64(archive, descriptor + 8), u64(archive, descriptor + 16)]).toEqual([5_000, 5_000]);

    const { end, locator, end64 } = endRecords(archive);
    const directoryOffset = a!.at;
    expect(end64).toEqual({
      at: archive.length - 22 - 20 - 56,
      recordSize: 44,
      versionMadeBy: 45,
      versionNeeded: 45,
      disk: 0,
      directoryDisk: 0,
      entriesHere: 2,
      entries: 2,
      size: end64!.at - directoryOffset,
      offset: directoryOffset,
    });
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    expect(end).toEqual({ entriesHere: 0xffff, entries: 0xffff, size: 0xffffffff, offset: 0xffffffff, comment: 0 });
  });

  test("the writer turns to ZIP64 by itself once an offset passes 4 GiB", async () => {
    const start = TWO_32 - 100;
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { startOffset: start });
    await writer.addFile("a.bin", openerOf(fileOf(Buffer.alloc(50, 1))));
    await writer.addFile("b.bin", openerOf(fileOf(Buffer.alloc(40, 2))));
    await writer.end();
    const archive = sink.bytes();

    const bOffset = start + 30 + 5 + 50 + 16;
    expect(bOffset).toBeGreaterThan(0xffffffff);
    const [a, b] = centralDirectory(archive, start);
    // a.bin starts below 4 GiB and needs nothing; b.bin's offset goes into the extra field alone.
    expect(a).toMatchObject({ name: "a.bin", compressed: 50, size: 50, offset: start, zip64: null });
    expect(b).toMatchObject({ name: "b.bin", compressed: 40, size: 40, offset: 0xffffffff, zip64: [bOffset] });
    // Neither entry reached 4 GiB, so both descriptors keep 4-byte sizes.
    expect(archive.readUInt32LE(30 + 5 + 50)).toBe(0x08074b50);
    expect(archive.readUInt32LE(30 + 5 + 50 + 16)).toBe(0x04034b50);

    const { end, locator, end64 } = endRecords(archive, start);
    expect(end64).toMatchObject({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: a!.at });
    expect(a!.at).toBeGreaterThan(0xffffffff);
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    // Only the directory's offset overflows the classic record.
    expect(end).toEqual({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: 0xffffffff, comment: 0 });
  });

  test("an entry of more than 4 GiB is a ZIP64 entry by itself, without the archive being kept in memory", { timeout: 120_000 }, async () => {
    const huge = fakeFile(TWO_32 + 1);
    // Counts every byte and keeps only what is not the file's own data, with where it starts.
    const kept: { at: number; bytes: Uint8Array }[] = [];
    let written = 0;
    const writer = createZipWriter(async (chunk) => {
      if (chunk.buffer !== huge.chunk.buffer) kept.push({ at: written, bytes: Uint8Array.from(chunk) });
      written += chunk.length;
    });
    expect(await writer.addFile("huge.bin", huge.open)).toBe(true);
    await writer.addJsonPieces("after.json", piecesOf('{ "after": true }'));
    await writer.end();
    expect(huge.state).toEqual({ chunks: TWO_32 / KIB64 + 1, stopped: true, closed: true });

    // Everything after the file's data is kept together: its descriptor, the next entry, the directory and the end records.
    const dataEnd = 30 + "huge.bin".length + TWO_32 + 1;
    const tail = Buffer.concat(kept.filter((piece) => piece.at >= dataEnd).map((piece) => piece.bytes));
    expect(dataEnd + tail.length).toBe(written);
    expect(tail.readUInt32LE(0)).toBe(0x08074b50);
    expect([u64(tail, 8), u64(tail, 16)]).toEqual([TWO_32 + 1, TWO_32 + 1]);
    const [hugeEntry, after] = centralDirectory(tail, dataEnd);
    expect(hugeEntry).toMatchObject({ name: "huge.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0, zip64: [TWO_32 + 1, TWO_32 + 1] });
    expect(after).toMatchObject({ name: "after.json", offset: 0xffffffff, zip64: [dataEnd + 24] });
    const { end, end64 } = endRecords(tail, dataEnd);
    expect(end64).toMatchObject({ entries: 2, offset: hugeEntry!.at });
    expect(end).toMatchObject({ entries: 2, offset: 0xffffffff });
  });
});

describe("the export route", () => {
  /**
   * The account routes on their own, with the session and the logger a request would carry and an error
   * handler that renders AccountError as the app's does; everything else is a 500. The freshness and
   * session guards are passed through: http-account.test.ts covers them on the real app.
   */
  function app(h: Harness, log = silent) {
    const session: Session = {
      sessionId: h.currentSession,
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      handle: randomUUID(),
      factors: { email: h.now().getTime() },
      passkeyId: null,
    };
    const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
      await next();
    };
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "test");
      c.set("log", log);
      c.set("session", session);
      c.set("authVia", "cookie");
      await next();
    });
    a.route("/api/account", accountRoutes(h.deps, pass, pass, pass));
    a.onError((err, c) => (err instanceof AccountError ? c.json({ error: { code: err.code } }, err.status) : c.json({ error: { code: "internal" } }, 500)));
    return a;
  }
  const exportOf = (a: Hono<AppEnv>) => a.request("/api/account/export", { method: "POST" });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
  const exported = (h: Harness) => h.events.filter((event) => event.type === "export_created").length;

  test("a complete export streams a valid archive with its headers and records export_created", async () => {
    const h = harness();
    const bytesA = randomBytes(300_000);
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-export-ada-${iso(T0).slice(0, 10)}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    // Recorded once every chunk was taken, before the body ended.
    expect(h.events).toEqual([{ userId: h.userId, type: "export_created", metadata: undefined }]);
  });

  test("a failure before the first byte answers an error and gives the day's export back", async () => {
    const h = harness();
    const a = app(h);
    // The build fails: a pool timeout while the account is read.
    h.failures.exportAccount = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    // The first image cannot even be opened: still nothing sent.
    h.images.push({
      id: h.imageA,
      open: async () => {
        throw new Error("too many open files");
      },
    });
    const unopened = await exportOf(a);
    expect(unopened.status).toBe(500);
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["export.json"]);
    expect(exported(h)).toBe(1);
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a limit store that cannot give the export back is logged, and the build's own error is answered", async () => {
    const h = harness();
    const lines: string[] = [];
    const log = pino({ level: "warn" }, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString("utf8")), done()) }));
    const store = new MemoryStore(() => h.now().getTime());
    h.deps.limits = {
      hit: (key, windowMs) => store.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    h.failures.exportAccount = 1;
    const res = await exportOf(app(h, log));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal");
    expect(lines.map((line) => (JSON.parse(line) as { level: number; msg: string }).level)).toEqual([40]);
    expect(lines[0]).toMatch(/could not be given back/);
  });

  test("an image that fails in the middle of its reading fails the response body, and the day's export stays spent", async () => {
    const h = harness();
    const failing = fakeFile(1_000_000, { failAfter: 3 });
    h.images.push({ id: h.imageA, open: failing.open });
    const a = app(h);
    const res = await exportOf(a);
    // The status went out with the first bytes; what follows can only end the body with an error, never cleanly.
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(failing.state).toMatchObject({ chunks: 3, stopped: true, closed: true });
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a client that goes away stops the file reads", async () => {
    const h = harness();
    // A hundred megabytes, read only as fast as the response is taken.
    const big = fakeFile(100 * 1024 * 1024);
    h.images.push({ id: h.imageA, open: big.open });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(big.state).toMatchObject({ stopped: true, closed: true }));
    expect(big.state.chunks).toBeLessThan(10);
    expect(exported(h)).toBe(0);
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
import { createAccount } from "../src/account";
import { createApp } from "../src/app";
import { AuthError, createAuth } from "../src/auth";
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
  const account = createAccount({
    auth: auth.forAccount,
    social: social.forAccount,
    media: media.forAccount,
    requireSession: auth.requireSession,
    requireFreshAuth: auth.requireFreshAuth(),
    requireStrongFreshAuth: auth.requireStrongFreshAuth(),
    rateLimitStore,
    logger,
  });
  return createApp({ config, logger, rateLimitStore, healthChecks: checks, advisoryChecks, auth, social, media, account });
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
  test("an auth error's details reach the envelope, so the app can ask for what a refusal names", async () => {
    const a = app({});
    a.get("/api/needs-more", () => {
      throw new AuthError("reauth_required", 403, undefined, undefined, { level: 2, have: ["email"] });
    });
    a.get("/api/needs-nothing", () => {
      throw new AuthError("mfa_required", 400);
    });
    const refused = await a.request("/api/needs-more");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["email"] } } });
    const plain = (await (await a.request("/api/needs-nothing")).json()) as { error: Record<string, unknown> };
    expect(plain.error).not.toHaveProperty("details");
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

describe("account routes", () => {
  test("the data export is mounted at /api/account and needs a session", async () => {
    const a = app({});
    const res = await a.request("/api/account/export", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    expect((await a.request("/api/account/export")).status).toBe(404);
  });
});
```

### Replace `apps/api/test/auth/email-change.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey } from "../../src/auth/flows/email";
import {
  EMAIL_CHANGE_STARTS_PER_HOUR,
  EMAIL_REVERTS_PER_IP_PER_HOUR,
  EMAIL_REVERT_TTL_MS,
  emailRevertKey,
  revertEmailChange,
  startEmailChange,
  verifyEmailChange,
} from "../../src/auth/flows/email-change";
import { LOCKDOWN_LOOKBACK_MS } from "../../src/auth/flows/lockdown";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

const DAY = 24 * HOUR;
/** What the undo's event carries beside the address hashes once the lockdown ran and found nothing else to remove. */
const NOTHING_ELSE = { passkeysRemoved: [], totpCleared: false, passwordCleared: true };

/** An account with two-factor on since `enabledAt`, as the confirm step leaves it. */
function withTotp(h: MemoryFlowHarness, userId: string, enabledAt: Date) {
  Object.assign(h.users.get(userId)!, { totpSecretEnc: "v1:owner", totpEnabledAt: enabledAt, totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
}

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

const REVERT_URL = /^http:\/\/localhost:8081\/email-revert\/([A-Za-z0-9_-]{43})$/;
const LINK_GONE = "This link has expired or was already used.";

/** Moves the account to `email` with the code from its mailbox, and returns the undo link's token from the notice to the old address, if it carried one. */
async function change(h: MemoryFlowHarness, session: Session, email: string): Promise<string | null> {
  const { flowId, code } = await start(h, session, email);
  await verifyEmailChange(h.deps, session, { flowId, code });
  const notice = h.mailer.sent.at(-1)!;
  expect(notice.template).toBe("email_changed");
  const url = notice.data.revertUrl;
  return url === undefined ? null : REVERT_URL.exec(url)![1]!;
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
      ["ada@korbat.local", "email_changed", { email: "ada-new@korbat.local", revertUrl: expect.stringMatching(REVERT_URL) }],
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

describe("email change: the undo link sent to the old address", () => {
  test("the notice carries a link good for 24 hours, kept under its hashed token with the old address, the time of the change and the passkey behind the changing session", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.advance(1000);
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const raw = (await h.kv.get(emailRevertKey(token)))!;
    expect(emailRevertKey(token)).toBe(`email-revert:${sha256Hex(token)}`);
    expect(JSON.parse(raw)).toEqual({ userId: ada.user.id, oldEmail: "ada@korbat.local", changedAt: h.now().getTime(), passkeyId: null });
    expect(raw).not.toContain(token);
    h.advance(EMAIL_REVERT_TTL_MS - 1);
    expect(await h.kv.get(emailRevertKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(emailRevertKey(token))).toBeNull();

    // A session a passkey started names it, so the undo removes that passkey whatever its age.
    const bob = h.user("bob@korbat.local");
    const passkeyId = h.passkey(bob.user.id);
    const byPasskey = h.session(bob.user.id, { passkeyId });
    const bobsToken = (await change(h, byPasskey, "bob-new@korbat.local"))!;
    expect(JSON.parse((await h.kv.get(emailRevertKey(bobsToken)))!)).toMatchObject({ userId: bob.user.id, passkeyId });
  });

  test("the link moves the account back, signs every session out, records the undo with both hashes, tells the old address and nobody else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The session an attacker got hold of, which makes the change, and the owner's own, which the change leaves alone.
    const owners = h.session(ada.user.id);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    const appended: Parameters<AuthRepo["appendEvent"]>[0][] = [];
    const append = h.deps.repo.appendEvent;
    h.deps.repo.appendEvent = async (input) => {
      appended.push(input);
      await append(input);
    };
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);

    const stored = h.users.get(ada.user.id)!;
    expect([stored.email, stored.emailVerifiedAt]).toEqual(["ada@korbat.local", h.now()]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, owners.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    const key = h.deps.config.authHmacKey;
    expect(appended).toEqual([
      {
        userId: ada.user.id,
        type: "email_changed",
        deviceId: null,
        ipHash: h.ctx.ipHash,
        metadata: { from: emailHash(key, "attacker@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true, ...NOTHING_ELSE },
      },
    ]);
    // The address the account was moved to is told nothing; the old one gets a short note.
    expect(h.mailer.sent.filter((m) => m.to === "attacker@korbat.local").map((m) => m.template)).toEqual(["email_change_code"]);
    expect(h.mailer.sent.at(-1)).toEqual({ to: "ada@korbat.local", template: "email_change_reverted", data: {} });
    // The old address signs in again; the other one no longer belongs to any account.
    expect((await h.deps.repo.findUserByEmail("ada@korbat.local"))?.id).toBe(ada.user.id);
    expect(await h.deps.repo.findUserByEmail("attacker@korbat.local")).toBeUndefined();
  });

  test("the undo also revokes every device of the account, so a sign-in on any of them counts as a new device again", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The device whoever made the change used, and the owner's own; another account's device is not touched.
    h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(60_000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.devices.filter((d) => d.userId === ada.user.id).map((d) => d.revokedAt)).toEqual([h.now(), h.now()]);
    expect(h.devices.filter((d) => d.userId === bob.user.id).map((d) => d.revokedAt)).toEqual([null]);
  });

  test("the password goes whenever it was set, and two-factor turned on more than a day before the change stays", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    // The owner's own, from before: a password nobody can tell from one an attacker set, and two-factor from just outside the day the lockdown reaches back.
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    withTotp(h, ada.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS + 1);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: "v1:owner", totpLastStep: 7, recoveryCodesHash: ["owner-code"] });
    expect(h.events.at(-1)!.metadata).toMatchObject({ reverted: true, totpCleared: false, passwordCleared: true });
  });

  test("two-factor turned on within the day before the change, or after it, goes with it", async () => {
    const h = memoryFlowHarness();
    const before = h.user("before@korbat.local");
    // Exactly a day before the change: the first moment the lockdown reaches.
    withTotp(h, before.user.id, h.now());
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const beforesToken = (await change(h, before.session, "attacker-1@korbat.local"))!;
    const after = h.user("after@korbat.local");
    const aftersToken = (await change(h, after.session, "attacker-2@korbat.local"))!;
    h.advance(1000);
    Object.assign(h.users.get(after.user.id)!, { totpSecretEnc: "v1:attacker", totpEnabledAt: h.now(), totpLastStep: 42, recoveryCodesHash: ["attacker-code"] });
    h.advance(1000);
    await revertEmailChange(h.deps, { token: beforesToken }, h.ctx);
    await revertEmailChange(h.deps, { token: aftersToken }, h.ctx);
    for (const account of [before, after]) {
      expect(h.users.get(account.user.id), account.user.email).toMatchObject({ passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    }
    expect(h.events.filter((e) => e.metadata.reverted).map((e) => [e.userId, e.metadata.totpCleared])).toEqual([
      [before.user.id, true],
      [after.user.id, true],
    ]);
  });

  test("a passkey added since the day before the change goes, an older one stays, and the passkey that started the changing session goes whatever its age", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const older = h.passkey(ada.user.id, new Date(h.now().getTime() - 1));
    const ownSince = h.passkey(ada.user.id, h.now());
    const named = h.passkey(ada.user.id, new Date(h.now().getTime() - 30 * DAY));
    const changing = h.session(ada.user.id, { passkeyId: named });
    h.advance(LOCKDOWN_LOOKBACK_MS);
    const token = (await change(h, changing, "attacker@korbat.local"))!;
    h.advance(HOUR);
    const added = h.passkey(ada.user.id);
    h.advance(HOUR);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.passkeys.map((p) => p.id)).toEqual([older]);
    const removed = h.events.at(-1)!.metadata.passkeysRemoved as string[];
    expect([...removed].sort()).toEqual([ownSince, named, added].sort());
  });

  test("a used link and an expired one are refused and change nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    await revertEmailChange(h.deps, { token }, h.ctx);
    const used = await failure(revertEmailChange(h.deps, { token }, h.ctx));
    expect(used).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });

    const bob = h.user("bob@korbat.local");
    const late = (await change(h, bob.session, "bob-new@korbat.local"))!;
    h.advance(EMAIL_REVERT_TTL_MS);
    expect(await failure(revertEmailChange(h.deps, { token: late }, h.ctx))).toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(h.users.get(bob.user.id)!.email).toBe("bob-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.mailer.sent.filter((m) => m.template === "email_change_reverted").map((m) => m.to)).toEqual(["ada@korbat.local"]);
  });

  test("an old address that got another account meanwhile is email_in_use, and nothing changes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.user("Ada@korbat.local");
    const eventsBefore = h.events.length;
    expect(await failure(revertEmailChange(h.deps, { token }, h.ctx))).toMatchObject({ code: "email_in_use", status: 409 });
    expect(h.users.get(ada.user.id)!.email).toBe("ada-new@korbat.local");
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.mailer.sent.map((m) => m.template)).not.toContain("email_change_reverted");
  });

  test("allows 10 tries an hour per address, then rate_limited with a Retry-After", async () => {
    const h = memoryFlowHarness();
    for (let i = 0; i < EMAIL_REVERTS_PER_IP_PER_HOUR; i++) {
      expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, h.ctx))).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    // Another address has its own window.
    expect(await failure(revertEmailChange(h.deps, { token: randomToken() }, { ...h.ctx, ipHash: randomToken() }))).toMatchObject({ code: "invalid_code" });
  });

  test("a second change while the link is out sends no second link, so whoever made it holds none; the one link undoes both and clears what was set since the first", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "middle@korbat.local"))!;
    h.advance(MINUTE + 1);
    // Were the middle address sent a link to itself, an attacker who made both changes could use it after the owner used theirs and take the account back.
    expect(await change(h, ada.session, "last@korbat.local")).toBeNull();
    const toMiddle = h.mailer.sent.at(-1)!;
    expect([toMiddle.to, toMiddle.data]).toEqual(["middle@korbat.local", { email: "last@korbat.local" }]);
    await h.deps.repo.setPasswordHash(ada.user.id, "attacker-password", h.now());
    h.advance(1000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ email: "ada@korbat.local", passwordHash: null });
    const key = h.deps.config.authHmacKey;
    expect(h.events.at(-1)!.metadata).toEqual({ from: emailHash(key, "last@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true, ...NOTHING_ELSE });

    // Once the link was used, the next change sends one again.
    const owner = h.session(ada.user.id);
    h.advance(HOUR);
    expect(await change(h, owner, "ada-2@korbat.local")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the note to the old address is best effort: a mail failure does not undo the revert", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    h.mailer.failing = true;
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)!.email).toBe("ada@korbat.local");
    expect(h.events.map((e) => e.type)).toEqual(["email_changed", "email_changed"]);
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
import { createSessions, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/** A session or a device of a user, as the deletion flow revokes and removes them. */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

/** A passkey of a user, as the lockdown removes it: only what its rule reads, the owner and the creation time. */
export interface RecordedPasskey {
  id: string;
  userId: string;
  createdAt: Date;
}

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me and
 * lockdown flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" fails its transaction midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown">();
  /** Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids returned), devices and codes gone. */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
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
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async revokeDevices(userId: string, at: Date): Promise<void> {
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = at;
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const removed: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.ids.includes(passkey.id)) {
          removed.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      return removed;
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
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      events.push({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "revokeDevices"
    | "disableTotp"
    | "deletePasskeys"
    | "setPhoneHash"
    | "appendEvent"
    | "revokeAllSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
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
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null };
      },
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
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({ id: s.sessionId, userId, revokedAt: null });
    devices.push({ id: s.deviceId, userId, revokedAt: null });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /** A passkey of an existing account, created at `createdAt` (now unless given); answers its id. */
    passkey(userId: string, createdAt: Date = now()): string {
      const id = randomUUID();
      passkeys.push({ id, userId, createdAt });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
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
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/auth/messages.test.ts` (whole file)

```ts
import { AuthErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { AuthError, authErrorMessage } from "../../src/auth/context";

describe("auth error messages", () => {
  test("every code the contracts list has a message", () => {
    for (const code of AuthErrorCode.options) expect(authErrorMessage(code).length, code).toBeGreaterThan(10);
  });

  test("the passkey codes answer with the wording of the 1c design (section 9)", () => {
    expect(authErrorMessage("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(authErrorMessage("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    // The cap; the daily bound passes its own message with the hours left (1c design, section 9).
    expect(authErrorMessage("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(authErrorMessage("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(authErrorMessage("passkey_not_found")).toBe("That passkey is gone.");
    expect(authErrorMessage("challenge_expired")).toBe("That took too long. Try again.");
  });

  test("an AuthError carries the message of its code unless the flow gives its own", () => {
    expect(new AuthError("passkey_not_found", 404).message).toBe("That passkey is gone.");
    const daily = new AuthError("passkey_limit", 409, "You added 5 passkeys today. You can add another in about 3 hours.");
    expect(daily).toMatchObject({ code: "passkey_limit", status: 409, message: "You added 5 passkeys today. You can add another in about 3 hours." });
  });

  test("an AuthError can carry details for the app, such as the level a refusal asks for and the factors proven in time", () => {
    const refusal = new AuthError("reauth_required", 403, undefined, undefined, { level: 2, have: ["email"] });
    expect(refusal).toMatchObject({ code: "reauth_required", status: 403, message: "Confirm it's you to continue.", details: { level: 2, have: ["email"] } });
    expect(refusal.retryAfterSeconds).toBeUndefined();
    expect(new AuthError("rate_limited", 429, undefined, 60).details).toBeUndefined();
  });
});
```

### Replace `apps/api/test/integration/account-deletion.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { blocks, bookmarks, closeDb, createDb, follows, handleHistory, likes, mutes, posts, profiles, reposts, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { confirmDeletion, purge, startDeletion } from "../../src/account/flows/deletion";
import { createPurgeJob, purgePending } from "../../src/account/purge";
import { confirmDeletion as authConfirmDeletion, startDeletion as authStartDeletion } from "../../src/auth/flows/deletion";
import { startEmail } from "../../src/auth/flows/email";
import { exportAccount } from "../../src/auth/flows/export";
import { passwordSignIn } from "../../src/auth/flows/password";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryJobLock } from "../../src/lib/jobs";
import { mediaForAccount } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { profile } from "../../src/social/flows/profiles";
import { latestTimeline } from "../../src/social/flows/timelines";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `d_${randomBytes(5).toString("hex")}`;
const PASSWORD = "correct horse battery staple";
const page = { limit: 50 };

/**
 * Account deletion across the three modules on real Postgres: the auth repository behind the auth
 * flows, the social repository's purge, the media repository with both volumes in a temporary
 * directory, composed the way the server composes the account module's dependencies from the module
 * indexes. The auth flows read the handle through the real profile store, as the server wires it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => authStartDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => authConfirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => authRepo.finishPurge(userId, new Date()),
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: (userId) => exportProfile(s.deps, userId),
    },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: mediaForAccount(m.deps),
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /** An auth account with a password, signed in on one device, with a profile of the same id in the public schema, old enough to quote and repost. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: PASSWORD });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    await apiDb.update(profiles).set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) }).where(eq(profiles.id, owner.user.id));
    return { ...owner, handle };
  }

  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0];
  const profileRow = async (id: string) => (await apiDb.select().from(profiles).where(eq(profiles.id, id)))[0]!;
  const postRow = async (id: string) => (await apiDb.select().from(posts).where(eq(posts.id, id)))[0]!;
  const rowCount = async (table: typeof likes | typeof reposts | typeof bookmarks, userId: string) =>
    (await apiDb.select({ n: count() }).from(table).where(eq(table.userId, userId)))[0]!.n;
  const pairCount = async (table: typeof follows | typeof blocks | typeof mutes, id: string) =>
    (await apiDb.select({ n: count() }).from(table).where(sql`${table.fromId} = ${id}::uuid or ${table.toId} = ${id}::uuid`))[0]!.n;
  const image = (id: string, alt: string) => ({ id, alt });

  test("deleting an account with posts, images, engagement and graph rows leaves tombstones, right counters elsewhere, no image rows, an anonymised profile with its handle reserved, and an anonymised auth row", async () => {
    const owner = await account();
    const userId = owner.user.id;
    // The handle left behind stays reserved, and so does the current one.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    await authRepo.setPhoneHash(userId, randomBytes(16).toString("hex"));
    await h.deps.profiles.setVerified(userId, new Date());

    const [bob, carol, dan, eve] = await Promise.all([s.established(), s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    const [imageA, imageB] = [await m.readyImage(userId), await m.readyImage(userId)];
    const root = await createPost(s.deps, userId, { body: "two photos", media: [image(imageA, "a harbour at dawn"), image(imageB, "a lighthouse")] });
    const selfReply = await createPost(s.deps, userId, { body: "my own follow-up", replyToId: root.id, media: [] });
    const replyToBob = await createPost(s.deps, userId, { body: "a reply to bob", replyToId: bobsPost.id, media: [] });
    const quoteOfBob = await createPost(s.deps, userId, { body: "quoting bob", quoteOfId: bobsPost.id, media: [] });
    const earlier = await createPost(s.deps, userId, { body: "deleted before the account", media: [] });
    await deletePost(s.deps, userId, earlier.id);
    const earlierDeletedAt = (await postRow(earlier.id)).deletedAt;
    const bobsReply = await createPost(s.deps, bob.id, { body: "bob replies", replyToId: root.id, media: [] });
    // Engagement: the owner's on bob's post goes with the counters; carol's stays, so the counters come down to one, not to zero.
    for (const who of [userId, carol.id]) expect(await s.repo.like(who, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.like(carol.id, root.id, s.clock.next())).toBe(true);
    // The graph: follows both ways with a bystander on each side, a block each way, a mute each way.
    for (const [from, to] of [
      [userId, bob.id],
      [bob.id, userId],
      [carol.id, userId],
      [carol.id, bob.id],
      [bob.id, carol.id],
    ]) {
      expect(await s.repo.follow(from!, to!, s.clock.next())).toBe(true);
    }
    expect(await s.repo.block(userId, dan.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(eve.id, userId, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(dan.id, userId, s.clock.next())).toBe(true);
    // Uploads on no post, in every state: they go too, files and all.
    const loose = await m.readyImage(userId);
    const processing = (await upload(m.deps, userId, m.jpeg())).id;
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);
    // The upload still in processing has its file waiting in the uploads volume for the worker.
    expect(existsSync(m.files.uploads.upload(processing))).toBe(true);

    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 2, followingCount: 2, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 2 });
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 2, repostCount: 1, replyCount: 1, quoteCount: 1 });
    expect(await profileRow(userId)).toMatchObject({ followerCount: 2, followingCount: 1, postCount: 2 });

    const { flowId } = await startDeletion(deps(), owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    await confirmDeletion(deps(), owner.session, { flowId, code, handle: renamed.toUpperCase() });

    // The auth row: gone for every lookup, anonymised, both sessions dead and tombstoned, no devices or codes, the event recorded, the notice sent.
    expect(await authRepo.findUserById(userId)).toBeUndefined();
    expect(await authRepo.findUserByEmail(owner.email)).toBeUndefined();
    const anonymised = (await authRow(userId))!;
    expect(anonymised.deletedAt).not.toBeNull();
    expect(anonymised.purgedAt).not.toBeNull();
    expect(anonymised).toMatchObject({
      email: `deleted:${userId}`,
      emailVerifiedAt: null,
      passwordHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      phoneHash: null,
      ageConfirmedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
    });
    for (const id of [owner.session.sessionId, other.issued.session.sessionId]) {
      expect(await authRepo.findActiveSession(id, new Date()), id).toBeUndefined();
      expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    }
    expect(await authRepo.listDevices(userId)).toEqual([]);
    expect((await authDb.execute(sql`select count(*)::int as n from auth.email_codes where user_id = ${userId}::uuid`)) as unknown as { n: number }[]).toEqual([{ n: 0 }]);
    expect((await authRepo.recentEvents(userId)).map((e) => e.type)).toContain("account_deleted");
    expect(h.mailer.sent.filter((mail) => mail.to === owner.email).map((mail) => mail.template)).toEqual(["delete_account_code", "account_deleted"]);

    // The profile: not found by either handle, anonymised, its handles still reserved for it.
    expect(await s.repo.findProfileByHandle(renamed)).toBeNull();
    expect(await s.repo.findProfileByHandle(owner.handle)).toBeNull();
    expect(await rejection(profile(s.deps, null, renamed))).toBe("not_found");
    expect(await rejection(exportProfile(s.deps, userId))).toBe("not_found");
    const gone = await profileRow(userId);
    expect(gone).toMatchObject({ handle: renamed, displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0 });
    expect(gone.deletedAt).not.toBeNull();
    expect((await apiDb.select({ handle: handleHistory.handleLower }).from(handleHistory).where(eq(handleHistory.profileId, userId))).map((row) => row.handle).sort()).toEqual([owner.handle, renamed].sort());
    expect(await s.repo.changeHandle(bob.id, renamed, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });
    expect(await s.repo.changeHandle(bob.id, owner.handle, s.clock.next())).toEqual({ ok: false, reason: "handle_taken" });

    // Every post is a tombstone; the one deleted earlier keeps its time; parents and quoted posts count them no more.
    for (const id of [root.id, selfReply.id, replyToBob.id, quoteOfBob.id, earlier.id]) {
      expect(await postRow(id), id).toMatchObject({ state: "deleted_by_author", body: "" });
      expect((await postRow(id)).deletedAt, id).not.toBeNull();
      expect(await rejection(getPost(s.deps, null, id)), id).toBe("not_found");
    }
    expect((await postRow(earlier.id)).deletedAt).toEqual(earlierDeletedAt);
    expect(await postRow(bobsPost.id)).toMatchObject({ likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0 });
    expect((await thread(s.deps, null, bobsReply.id, page)).ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await latestTimeline(s.deps, null, page)).items.map((item) => item.post.id)).not.toContain(root.id);
    expect(await postRow(bobsReply.id)).toMatchObject({ state: "visible", replyToId: root.id });

    // The owner's engagement and graph rows are gone, in both directions, and the other accounts' counters follow.
    for (const table of [likes, reposts, bookmarks]) expect(await rowCount(table, userId)).toBe(0);
    for (const table of [follows, blocks, mutes]) expect(await pairCount(table, userId)).toBe(0);
    expect(await rowCount(likes, carol.id)).toBe(2);
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 1, followingCount: 1, postCount: 1 });
    expect(await profileRow(carol.id)).toMatchObject({ followerCount: 1, followingCount: 1 });
    expect((await s.repo.relation(eve.id, userId)).blocked).toBe(false);
    expect((await s.repo.relation(dan.id, userId)).muted).toBe(false);

    // The image rows are gone whatever their state, and the worker is asked for every file.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(await m.deps.repo.find(id), id).toBeNull();
    expect(await m.deps.repo.readyImages(userId)).toEqual([]);
    expect(await m.files.deletionRequests()).toEqual(expect.arrayContaining([imageA, imageB, loose, processing, failed]));
    // On the disk: every id has its request, and the processing upload's file is gone, so no worker picks it up afterwards.
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.deletion(id)), id).toBe(true);
    for (const id of [imageA, imageB, loose, processing, failed]) expect(existsSync(m.files.uploads.upload(id)), id).toBe(false);
    expect(await authRepo.pendingPurges()).not.toContain(userId);

    // A second purge changes nothing: the rows read the same afterwards, and no further file deletion is asked for.
    const before = { auth: await authRow(userId), profile: gone, bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() };
    await purge(deps(), userId);
    expect({ auth: await authRow(userId), profile: await profileRow(userId), bob: await profileRow(bob.id), bobsPost: await postRow(bobsPost.id), requests: (await m.files.deletionRequests()).sort() }).toEqual(before);
  });

  test("sign-in with a deleted address behaves as for an unknown one before the purge ran, and one round of the job finishes deletions left half done, oldest first", async () => {
    const ghost = await account();
    const later = await account();
    const bob = await s.established();
    const ghostsPost = await createPost(s.deps, ghost.user.id, { body: "left behind", media: [] });
    expect(await s.repo.follow(bob.id, ghost.user.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(ghost.user.id, bob.id, s.clock.next())).toBe(true);
    // Deleted by hand, as a process that died after the auth step leaves them: no purge has run.
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 120_000));
    await authRepo.markDeleted(later.user.id, new Date(Date.now() - 60_000));

    // The start answers as for an address without an account, and the right password no longer signs in.
    const device = newTestDevice();
    const started = await startEmail(h.deps, { email: ghost.email, turnstileToken: "ok", ...device }, h.ctx);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect((await authRepo.findEmailCode(started.flowId))?.purpose).toBe("signup");
    expect(h.mailer.sent.filter((mail) => mail.to === ghost.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect(await rejection(passwordSignIn(h.deps, { email: ghost.email, password: PASSWORD, turnstileToken: "ok", ...device }, h.ctx))).toBe("invalid_credentials");
    expect(await authRepo.findActiveSession(ghost.session.sessionId, new Date())).toBeUndefined();
    // The profile is still there for the moment; the job is what takes it down.
    expect(await s.repo.findProfileByHandle(ghost.handle)).not.toBeNull();

    const pending = await authRepo.pendingPurges();
    expect(pending).toEqual(expect.arrayContaining([ghost.user.id, later.user.id]));
    expect(pending.indexOf(ghost.user.id)).toBeLessThan(pending.indexOf(later.user.id));
    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(2);
    expect(await authRepo.pendingPurges()).toEqual([]);
    for (const user of [ghost, later]) {
      const row = (await authRow(user.user.id))!;
      expect(row.purgedAt, user.handle).not.toBeNull();
      expect(row.email, user.handle).toBe(`deleted:${user.user.id}`);
      expect(await s.repo.findProfileByHandle(user.handle), user.handle).toBeNull();
      expect(await profileRow(user.user.id)).toMatchObject({ displayName: "Deleted account", followerCount: 0, followingCount: 0, postCount: 0 });
    }
    expect(await postRow(ghostsPost.id)).toMatchObject({ state: "deleted_by_author", body: "" });
    expect(await profileRow(bob.id)).toMatchObject({ followerCount: 0, followingCount: 0 });
    // The job as the server runs it: a round under its lock, with nothing left to do.
    expect(await createPurgeJob(deps(), new MemoryJobLock()).round()).toBe("ran");

    // finishPurge twice is once: the second call leaves the row as it was; and it never touches a live account.
    const purged = await authRow(ghost.user.id);
    await authRepo.finishPurge(ghost.user.id, new Date(Date.now() + 1000));
    expect(await authRow(ghost.user.id)).toEqual(purged);
    const alive = await account();
    await authRepo.finishPurge(alive.user.id, new Date());
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, purgedAt: null, deletedAt: null });
    expect(await authRepo.findUserById(alive.user.id)).toBeDefined();
  });
});
```

### Replace `apps/api/test/integration/account-export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, exportJson, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { exportAccount } from "../../src/auth/flows/export";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForAccount } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError } from "../../src/social/context";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost } from "../../src/social/flows/posts";
import { TEST_TERMS, flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { newPost } from "./social-fixtures";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `x_${randomBytes(5).toString("hex")}`;

/** Collects the archive in memory, copying each chunk as the sink of a response would consume it. */
function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk: Uint8Array): Promise<void> => {
      chunks.push(Uint8Array.from(chunk));
    },
    bytes: (): Uint8Array => Buffer.concat(chunks),
  };
}

/**
 * The export across the three modules on real Postgres: the auth repository behind the auth flow,
 * the social repository and flows, and the media repository with both volumes in a temporary
 * directory and the stand-in for the worker. Only the account module's dependencies are composed
 * here, the way the server composes them from the module indexes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export of an account", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo);
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  // The deletion side of the three interfaces is not exercised by the export; account-deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: { purgeProfile: notHere, exportProfile: (userId, pageSize) => exportProfile(s.deps, userId, pageSize) },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: { ...mediaForAccount(m.deps), purgeOwner: notHere, requestDeletion: notHere },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  const collect = async (pieces: AsyncIterable<string>): Promise<string> => {
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  };

  /** An auth account signed in on one device, with a profile of the same id in the public schema. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: "correct horse battery staple" });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    return { ...owner, handle };
  }

  test("an account with real uploads exports an archive whose images are the store's large.webp byte for byte, and whose JSON holds its rows", async () => {
    const owner = await account();
    const userId = owner.user.id;
    // A second live session on the same device, and a third one revoked: only the two live ones are listed.
    const second = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    const revoked = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await h.deps.sessions.revoke(revoked.issued.session.sessionId, userId);
    // The handle left behind is reserved in handle_history; the export lists both.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);

    const [imageA, imageB] = [await m.readyImage(userId, { width: 1600, height: 1200 }), await m.readyImage(userId, { width: 900, height: 1600 })];
    const post = await createPost(s.deps, userId, {
      body: "two photos",
      media: [
        { id: imageA, alt: "a harbour at dawn" },
        { id: imageB, alt: "a lighthouse" },
      ],
    });
    const reply = await createPost(s.deps, userId, { body: "a reply, soon deleted", replyToId: post.id, media: [] });
    await deletePost(s.deps, userId, reply.id);
    // A ready image on no post is still the account's upload; one still processing and one that failed have no file to export.
    const loose = await m.readyImage(userId);
    await upload(m.deps, userId, m.jpeg());
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);

    const [bob, eve, carol] = await Promise.all([s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    expect(await s.repo.like(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(userId, bob.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(userId, eve.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    await authRepo.appendEvent({ userId, type: "profile_updated" });

    const plan = await buildExport(deps(), userId, owner.session.sessionId, new Date());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${imageA}.webp`, `media/${imageB}.webp`, `media/${loose}.webp`].sort());
    for (const id of [imageA, imageB, loose]) {
      expect(Buffer.compare(Buffer.from(files[`media/${id}.webp`]!), readFileSync(m.files.store.image(id, "large"))), id).toBe(0);
    }
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([]);

    expect(json.account).toMatchObject({ id: userId, email: owner.email, role: "user", mfaEnabled: false, hasPassword: true, verified: false, termsVersion: TEST_TERMS });
    expect(json.account.termsAcceptedAt).not.toBeNull();
    expect(json.sessions.map((session) => session.id).sort()).toEqual([owner.session.sessionId, second.issued.session.sessionId].sort());
    expect(json.sessions.find((session) => session.id === owner.session.sessionId)!.current).toBe(true);
    expect(json.sessions.find((session) => session.id === second.issued.session.sessionId)!.current).toBe(false);
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]!.platform).toBe("web");
    // The account's own events, newest first; the sign-ins are among them.
    expect(json.events[0]!.type).toBe("profile_updated");
    expect(json.events.map((event) => event.type)).toContain("signin_success");
    for (let i = 1; i < json.events.length; i++) expect(json.events[i]!.at <= json.events[i - 1]!.at).toBe(true);

    expect(json.profile).toMatchObject({ handle: renamed, displayName: "Owner", bio: "", handleHistory: [owner.handle, renamed] });
    expect(json.posts.map((p) => p.id)).toEqual([post.id, reply.id]);
    expect(json.posts[0]).toMatchObject({
      body: "two photos",
      state: "visible",
      deletedAt: null,
      media: [
        { id: imageA, file: `media/${imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: imageB, file: `media/${imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toMatchObject({ body: "", state: "deleted_by_author", replyToId: post.id, media: [] });
    expect(json.posts[1]!.deletedAt).not.toBeNull();
    expect(json.likes.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.reposts.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.bookmarks.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.following).toEqual([{ handle: bob.handle, since: expect.any(String) }]);
    expect(json.blocks).toEqual([{ handle: eve.handle, since: expect.any(String) }]);
    expect(json.mutes).toEqual([{ handle: carol.handle, since: expect.any(String) }]);
  });

  test("the badge and two-factor are reported as held; an unknown account or profile is refused", async () => {
    const owner = await account();
    await authRepo.setPhoneHash(owner.user.id, sha256Hex(randomToken()));
    await authRepo.enableTotp(owner.user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a"], now: new Date() });
    const exported = await exportAccount(h.deps, owner.user.id);
    expect(exported.account).toMatchObject({ verified: true, mfaEnabled: true, hasPassword: true });

    const unknown = await exportAccount(h.deps, randomUUID()).catch((err: unknown) => err);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((unknown as AuthError).code).toBe("invalid_credentials");
    const nobody = await exportProfile(s.deps, randomUUID()).catch((err: unknown) => err);
    expect(nobody).toBeInstanceOf(SocialError);
    expect((nobody as SocialError).code).toBe("not_found");
    expect(await m.deps.repo.readyImages(randomUUID())).toEqual([]);
  });

  test("export.json read in keyset pages of two is, byte for byte, the document read in pages of a thousand; rows that share a moment are neither lost nor repeated", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, ...others] = await Promise.all(Array.from({ length: 10 }, () => s.established()));
    const posts: string[] = [];
    for (let i = 0; i < 5; i++) posts.push(await newPost(s.repo, userId, s.clock.next(), `post ${i}`));
    const bobsPosts: string[] = [];
    for (let i = 0; i < 5; i++) bobsPosts.push(await newPost(s.repo, bob!.id, s.clock.next(), `bob ${i}`));
    // Five likes at one moment: within it the post id orders them, and a page may end between two of them.
    const moment = s.clock.next();
    for (const post of bobsPosts) expect(await s.repo.like(userId, post, moment)).toBe(true);
    // Three reposts a microsecond apart inside one millisecond, as a database default writes them: a page key cut to the
    // millisecond would read the same rows again or skip some.
    for (const [i, post] of bobsPosts.slice(0, 3).entries()) {
      await apiDb.execute(sql`insert into reposts (user_id, post_id, created_at) values (${userId}::uuid, ${post}::uuid, ${`2026-01-01T00:00:00.12345${i}Z`}::timestamptz)`);
    }
    for (const post of bobsPosts.slice(0, 4)) expect(await s.repo.bookmark(userId, post, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 5)) expect(await s.repo.follow(userId, other.id, moment)).toBe(true);
    for (const other of others.slice(5, 8)) expect(await s.repo.block(userId, other.id, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 3)) expect(await s.repo.mute(userId, other.id, s.clock.next())).toBe(true);

    const now = new Date();
    const paged = await collect(exportJson(await buildExport(deps(), userId, owner.session.sessionId, now, 2)));
    const whole = await collect(exportJson(await buildExport(deps(), userId, owner.session.sessionId, now)));
    expect(paged).toBe(whole);
    expect(paged).toBe(JSON.stringify(JSON.parse(paged), null, 2));
    const json = ExportFormat.parse(JSON.parse(paged));
    expect(json.posts.map((post) => post.id)).toEqual(posts);
    expect(json.likes.map((like) => like.postId)).toEqual([...bobsPosts].sort());
    expect(json.reposts.map((repost) => [repost.postId, repost.at])).toEqual(bobsPosts.slice(0, 3).map((post) => [post, "2026-01-01T00:00:00.123Z"]));
    expect(json.bookmarks.map((bookmark) => bookmark.postId)).toEqual(bobsPosts.slice(0, 4));
    const byId = (list: { id: string; handle: string }[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((profile) => profile.handle);
    expect(json.following.map((ref) => ref.handle)).toEqual(byId(others.slice(0, 5)));
    expect(json.blocks.map((ref) => ref.handle)).toEqual(others.slice(5, 8).map((profile) => profile.handle));
    expect(json.mutes.map((ref) => ref.handle)).toEqual(others.slice(0, 3).map((profile) => profile.handle));
  });
});
```

### Replace `apps/api/test/integration/account-takedown.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, profiles, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { purgePending } from "../../src/account/purge";
import { confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `t_${randomBytes(5).toString("hex")}`;

interface StepOneRows {
  live_sessions: number;
  sessions: number;
  devices: number;
  codes: number;
  events: number;
}

/**
 * Step 1 of an account deletion on real Postgres (1b design, section 7.6): the auth module marks the
 * account deleted, revokes its sessions, deletes its devices and codes and records the event in one
 * transaction, and the purge job's last step (the auth module's finishPurge) does the row side again for
 * an account marked deleted without the rest, as a take-down that stopped after the mark leaves it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: step 1 of an account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb);
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  /** The account module's dependencies as the server composes them, with the auth side's last step through the auth module's own finishPurge. */
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => startDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => confirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => finishPurge(h.deps, userId),
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: (tx, ownerId) => m.deps.repo.purgeOwner(tx, ownerId),
      requestDeletion: (ids) => m.files.requestDeletion(ids),
      exportImages: async () => [],
    },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /** An account with a profile, signed in on two devices, with a code out for it besides whatever the test asks for. */
  async function account() {
    const owner = await onboardedUser(h, authRepo);
    const handle = newHandle();
    expect((await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" })).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, newTestDevice(), h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId: owner.user.id, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    return { ...owner, handle, sessionIds: [owner.session.sessionId, other.issued.session.sessionId] };
  }

  const stepOneRows = async (userId: string): Promise<StepOneRows> =>
    (
      (await authDb.execute(sql`select
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid and revoked_at is null) as live_sessions,
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid) as sessions,
        (select count(*)::int from auth.devices where user_id = ${userId}::uuid) as devices,
        (select count(*)::int from auth.email_codes where user_id = ${userId}::uuid) as codes,
        (select count(*)::int from auth.auth_events where user_id = ${userId}::uuid and type = 'account_deleted') as events`)) as unknown as StepOneRows[]
    )[0]!;
  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0]!;

  test("one confirmation takes every row of step 1 down: the mark, the sessions with their tombstones, the devices, the codes and the event", async () => {
    const owner = await account();
    const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 2, events: 0 });

    await confirmDeletion(h.deps, owner.session, { flowId, code, handle: owner.handle });

    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 1 });
    const row = await authRow(owner.user.id);
    expect(row.deletedAt).not.toBeNull();
    // Only step 1 ran: the purge anonymises the row later.
    expect([row.email, row.purgedAt]).toEqual([owner.email, null]);
    for (const id of owner.sessionIds) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(await authRepo.pendingPurges()).toContain(owner.user.id);
  });

  test("the take-down is one transaction: when its last statement fails, the mark and every row are still as they were", async () => {
    const owner = await account();
    // The event's device column is a uuid, so this device id makes the transaction's last statement fail.
    await expect(authRepo.takeDown(owner.user.id, new Date(), "not-a-uuid")).rejects.toThrow();
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0 });
    expect((await authRow(owner.user.id)).deletedAt).toBeNull();
    expect(await authRepo.findUserById(owner.user.id)).toBeDefined();
    expect(await authRepo.findActiveSession(owner.session.sessionId, new Date())).toBeDefined();
  });

  test("one round of the purge job fully takes down an account marked deleted by hand with its sessions, devices and codes still there", async () => {
    const ghost = await account();
    const alive = await account();
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 60_000));
    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0 });

    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(1);

    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 0 });
    for (const id of ghost.sessionIds) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(await authRow(ghost.user.id)).toMatchObject({ email: `deleted:${ghost.user.id}`, emailVerifiedAt: null, termsVersion: null });
    expect((await authRow(ghost.user.id)).purgedAt).not.toBeNull();
    expect((await apiDb.select().from(profiles).where(eq(profiles.id, ghost.user.id)))[0]).toMatchObject({ displayName: "Deleted account", handle: ghost.handle });
    expect(await authRepo.pendingPurges()).not.toContain(ghost.user.id);

    // A live account is not the job's business: its rows stay as they were.
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0 });
    expect(await authRepo.findActiveSession(alive.session.sessionId, new Date())).toBeDefined();
    // The last step on its own, again or for a live account, changes nothing.
    const purged = await authRow(ghost.user.id);
    await finishPurge(h.deps, ghost.user.id);
    await finishPurge(h.deps, alive.user.id);
    expect(await authRow(ghost.user.id)).toEqual(purged);
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0 });
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, deletedAt: null, purgedAt: null });
  });
});
```

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

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

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
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
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.sessionId]);

    expect(await revokeSession(h.deps, account.session, second.session.sessionId)).toBe(true);
    expect(await revokeSession(h.deps, account.session, "0".repeat(64))).toBe(false);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();

    await signOut(h.deps, third.session);
    expect(await h.deps.sessions.resolve(third.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing, and is spent.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({ userId: account.user.id, previousRole: "user" });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
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
    // The pending secret is kept for the session's handle, which a rotation keeps (1c design, section 2).
    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
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

    const pending = (await h.kv.get(`totp-pending:${account.session.handle}`))!;
    const right = hotp(new Uint8Array(decrypt(pending, [h.deps.config.totpKey])), currentStep(h.clock.ms()));
    await expect(confirmTotp(h.deps, account.session, { code: wrongCode(right) })).rejects.toMatchObject({ code: "invalid_mfa_code" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).toBeNull();

    const confirmed = await confirmTotp(h.deps, account.session, { code: right });
    expect(confirmed.recoveryCodes).toHaveLength(10);
    // The code proved the new secret, so the session gains the totp factor; the token rotates in place and the cached copy knows MFA is on.
    expect(confirmed.issued.session).toMatchObject({
      mfaEnabled: true,
      handle: account.session.handle,
      factors: { ...account.session.factors, totp: h.clock.ms() },
      reauthAt: h.clock.now(),
    });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect((await h.deps.sessions.resolve(confirmed.issued.token))!.session).toEqual(confirmed.issued.session);
    expect(await h.kv.get(`totp-pending:${account.session.handle}`)).toBeNull();
    const stored = (await repo.findUserById(account.user.id))!;
    expect(stored.totpEnabledAt).toEqual(h.clock.now());
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

  test("a recovery code signs in once, asks for MFA to be set up again, is recorded with the device and announced, and cannot be reused", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const { recoveryCodes } = await enableMfa(h, account);

    const signed = await verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]!.toUpperCase() }, h.ctx);
    expect(signed.mustReenrollMfa).toBe(true);
    expect(signed.issued.session.factors).toMatchObject({ email: h.clock.ms(), recovery: h.clock.ms() });
    await expect(verifyMfa(h.deps, { mfaTicket: await mfaTicketByEmail(h, account), recoveryCode: recoveryCodes[0]! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_mfa_code",
    });
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    // The event names the device the session was issued on, as the re-authentication path's does; the owner is told once, whichever path spent the code.
    const used = (await repo.recentEvents(account.user.id)).filter((e) => e.type === "recovery_code_used");
    expect(used.map((e) => e.deviceId)).toEqual([signed.issued.session.deviceId]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("recovery codes can be regenerated; turning MFA off takes no code (the re-authentication spent it), and is refused for staff and for an account without it", async () => {
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
    const staff = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await expect(disableTotp(h.deps, staff.session)).rejects.toMatchObject({ code: "staff_mfa_required" });
    expect((await repo.findUserById(account.user.id))!.totpEnabledAt).not.toBeNull();

    await repo.setRole(account.user.id, "user");
    const regular = await h.deps.sessions.issue(account.user.id, issued.session.deviceId, { factors: { email: h.clock.ms(), totp: h.clock.ms() } });
    await disableTotp(h.deps, regular.session);
    expect((await repo.findUserById(account.user.id))!).toMatchObject({ totpEnabledAt: null, totpSecretEnc: null, recoveryCodesHash: [] });
    expect((await h.deps.sessions.resolve(regular.token))!.session.mfaEnabled).toBe(false);
    await expect(disableTotp(h.deps, regular.session)).rejects.toMatchObject({ code: "mfa_required", status: 400 });
  });

  test("setup needs a fresh session and, once two-factor is on, level 2; confirmation needs only the pending secret, even six minutes later; the owner is told when it turns on or off", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const stale = (await h.deps.sessions.resolve(account.token))!.session;
    await expect(setupTotp(h.deps, stale)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 1, have: [] } });
    // Without a setup there is no pending secret, whatever the code says.
    await expect(confirmTotp(h.deps, stale, { code: "000000" })).rejects.toMatchObject({ code: "invalid_mfa_code", message: "Two-factor setup expired. Start again." });

    await h.deps.sessions.addFactor(stale.sessionId, "email");
    const fresh = (await h.deps.sessions.resolve(account.token))!.session;
    await setupTotp(h.deps, fresh);
    const pending = (await h.kv.get(`totp-pending:${fresh.handle}`))!;
    const secret = new Uint8Array(decrypt(pending, [h.deps.config.totpKey]));
    // Scanning the QR code took a while: the session is no longer fresh, and the confirmation does not care.
    h.clock.advance(6 * 60_000);
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(account.token))!.session)).toBe(false);
    const { issued } = await confirmTotp(h.deps, fresh, { code: hotp(secret, currentStep(h.clock.ms())) });
    expect(issued.session).toMatchObject({ mfaEnabled: true, factors: { ...fresh.factors, totp: h.clock.ms() } });
    expect(h.mailer.sent.filter((m) => m.template === "mfa_enabled").map((m) => m.to)).toEqual([account.email]);

    // Now that the account has TOTP, replacing the secret needs level 2: an email code alone is refused, with a TOTP code beside it accepted.
    const onlyEmail = await h.deps.sessions.issue(account.user.id, fresh.deviceId, { factors: { email: h.clock.ms() } });
    await expect(setupTotp(h.deps, onlyEmail.session)).rejects.toMatchObject({ code: "reauth_required", status: 403, details: { level: 2, have: ["email"] } });
    await h.deps.sessions.addFactor(onlyEmail.session.sessionId, "totp");
    const strong = (await h.deps.sessions.resolve(onlyEmail.token))!.session;
    expect((await setupTotp(h.deps, strong)).otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    await disableTotp(h.deps, issued.session);
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

### Replace `apps/api/test/integration/auth-janitor.test.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { randomToken } from "../../src/auth/crypto";
import { EMAIL_CODE_RETENTION_MS, SESSION_RETENTION_MS, janitor } from "../../src/auth/janitor";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";
import { flowHarness } from "./flow-harness";

const DAY = 24 * 60 * 60_000;

describe.skipIf(!process.env.INTEGRATION)("integration: the auth janitor", () => {
  let db: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it for setup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  test("dead codes, old sessions and stale device address hashes go; live ones stay", async () => {
    const h = flowHarness(repo);
    const { user, device } = await newUserWithDevice(repo);
    const now = h.clock.now();
    const code = (expiresAt: Date) =>
      repo.createEmailCode({ flowId: randomToken(), email: `janitor-${randomToken(6)}@korbat.local`, userId: user.id, purpose: "login", codeHash: "h", expiresAt, ipHash: "x" });
    await code(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS - DAY));
    await code(new Date(now.getTime() + 600_000));

    const old = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });
    await repo.revokeSession(old.session.sessionId, user.id, new Date(now.getTime() - SESSION_RETENTION_MS - DAY));
    const live = await h.deps.sessions.issue(user.id, device.id, { factors: { email: now.getTime() } });

    await repo.touchDevice(device.id, "stale-hash", new Date(now.getTime() - 31 * DAY));
    const { device: recent } = await newUserWithDevice(repo);
    await repo.touchDevice(recent.id, "fresh-hash", now);

    const report = await janitor(h.deps, now);
    expect(report.emailCodes).toBeGreaterThanOrEqual(1);
    expect(report.sessions).toBeGreaterThanOrEqual(1);
    expect(report.deviceIpHashes).toBeGreaterThanOrEqual(1);
    expect(await repo.findActiveSession(live.session.sessionId, now)).toBeDefined();
    expect(await repo.listActiveSessions(user.id, now)).toHaveLength(1);
    const [stale] = (await db.execute(sql`select ip_hash from auth.devices where id = ${device.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(stale?.ip_hash).toBeNull();
    const [fresh] = (await db.execute(sql`select ip_hash from auth.devices where id = ${recent.id}::uuid`)) as unknown as { ip_hash: string | null }[];
    expect(fresh?.ip_hash).toBe("fresh-hash");
  });

  test("events older than 90 days are purged through the function; the role still cannot delete rows itself", async () => {
    const h = flowHarness(repo);
    const { user } = await newUserWithDevice(repo);
    await repo.appendEvent({ userId: user.id, type: "signin_success" });
    await repo.appendEvent({ userId: user.id, type: "signin_failure" });
    await migrateDb.execute(sql`update auth.auth_events set created_at = now() - interval '91 days' where user_id = ${user.id}::uuid and type = 'signin_success'`);

    // Drizzle wraps driver errors ("Failed query: ..."); the Postgres error is the cause.
    const failure = await db.execute(sql`delete from auth.auth_events where user_id = ${user.id}::uuid`).then(() => null, (err: unknown) => err);
    expect(String((failure as { cause?: unknown } | null)?.cause)).toMatch(/permission denied for table auth_events/);
    const report = await janitor(h.deps, h.clock.now());
    expect(report.events).toBeGreaterThanOrEqual(1);
    expect((await repo.recentEvents(user.id)).map((e) => e.type)).toEqual(["signin_failure"]);
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
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(issued.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(issued.session.sessionId).toBe(sha256Hex(issued.token));
    expect(issued.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.session).toMatchObject({ userId: user.id, deviceId: device.id, role: "user", onboarded: false, mfaEnabled: false });
    // What the session proved and when, its handle for life, and the passkey it started from, if any (1c design, section 7.1).
    expect(resolved?.session).toMatchObject({ factors: { email: clock.ms() }, reauthAt: clock.now(), passkeyId: null });
    expect(resolved?.session.handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolved?.session).toEqual(issued.session);
    expect(await sessions.resolve(`kb1_${"x".repeat(43)}`)).toBeNull();
    // The reauth time is the latest of the factors, whatever order they are given in.
    const two = await sessions.issue(user.id, device.id, { factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 } });
    expect(two.session).toMatchObject({ factors: { totp: clock.ms() + 5_000, password: clock.ms() - 5_000 }, reauthAt: new Date(clock.ms() + 5_000) });
    expect(two.session.handle).not.toBe(issued.session.handle);
  });

  test("revocation takes effect immediately, even while the session is cached", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await sessions.revoke(issued.session.sessionId, user.id)).toBe(true);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  test("a revoked session stays revoked while a cache fill is in flight, and a foreign revoke leaves the cache alone", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
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
    const { clock, sessions } = setup();
    const owner = await newUserWithDevice(repo);
    const other = await newUserWithDevice(repo);
    const issued = await sessions.issue(owner.user.id, owner.device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.sessionId, other.user.id)).toBe(false);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  test("activity slides the expiry at most once an hour, and the 12-month cap cannot be extended", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
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

  test("rotation replaces the token in place: the handle, factors, reauth time, passkey, device and expiries stay, and the old token stops working at once", async () => {
    const { clock, kv, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const first = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() - 60_000, totp: clock.ms() } });
    const before = (await repo.findActiveSession(first.session.sessionId, clock.now()))!;
    // Cached, as a session in use is.
    expect(await sessions.resolve(first.token)).not.toBeNull();
    clock.advance(60_000);
    const second = await sessions.rotate(first.session);
    expect(second.token).not.toBe(first.token);
    expect(second.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(second.maxAgeSeconds).toBe(SESSION_IDLE_MS / 1000);
    // Only the id, the token's hash, changed; the reauth time did not move, since no factor was proven.
    expect(second.session).toEqual({ ...first.session, sessionId: sha256Hex(second.token) });
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await kv.get(`sess:${first.session.sessionId}`)).toBe("revoked");
    expect((await sessions.resolve(second.token))?.session).toEqual(second.session);
    const after = (await repo.findActiveSession(second.session.sessionId, clock.now()))!;
    expect(after).toEqual({ ...before, id: second.session.sessionId });
    // One row, under the new id: the list marks it current, and only the new id revokes it.
    expect((await sessions.list(user.id, second.session.sessionId)).map((s) => [s.id, s.current])).toEqual([[second.session.sessionId, true]]);
    expect(await sessions.revoke(first.session.sessionId, user.id)).toBe(false);
    expect(await sessions.revoke(second.session.sessionId, user.id)).toBe(true);
    expect(await sessions.resolve(second.token)).toBeNull();
  });

  test("a session revoked meanwhile cannot be rotated: nothing replaces it", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    expect(await sessions.revoke(issued.session.sessionId, user.id)).toBe(true);
    await expect(sessions.rotate(issued.session)).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await sessions.list(user.id, issued.session.sessionId)).toEqual([]);
  });

  test("signing out everywhere revokes every session of the user and lists them first", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const a = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const b = await sessions.issue(user.id, device.id, { factors: { email: clock.ms() } });
    const listed = await sessions.list(user.id, a.session.sessionId);
    expect(listed).toHaveLength(2);
    expect(listed.filter((s) => s.current).map((s) => s.id)).toEqual([a.session.sessionId]);
    expect(await sessions.revokeAll(user.id)).toBe(2);
    expect(await sessions.resolve(a.token)).toBeNull();
    expect(await sessions.resolve(b.token)).toBeNull();
  });

  test("a session is fresh for five minutes after a factor was proven, and a factor written later renews it and can raise its level", async () => {
    const { clock, sessions } = setup();
    const { user, device } = await newUserWithDevice(repo);
    const signedIn = clock.ms();
    const issued = await sessions.issue(user.id, device.id, { factors: { email: signedIn } });
    expect(sessions.isFresh(issued.session)).toBe(true);
    clock.advance(REAUTH_WINDOW_MS + 1_000);
    expect(sessions.isFresh((await sessions.resolve(issued.token))!.session)).toBe(false);
    await sessions.addFactor(issued.session.sessionId, "password");
    // The cached copy went with the write, so the factor shows at once, with the reauth time following it.
    const renewed = (await sessions.resolve(issued.token))!.session;
    expect(renewed).toMatchObject({ factors: { email: signedIn, password: clock.ms() }, reauthAt: clock.now() });
    expect(sessions.isFresh(renewed)).toBe(true);
    expect(sessions.level(renewed)).toBe(1);
    await sessions.addFactor(issued.session.sessionId, "totp");
    const strong = (await sessions.resolve(issued.token))!.session;
    expect(strong.factors).toEqual({ email: signedIn, password: clock.ms(), totp: clock.ms() });
    expect(sessions.level(strong)).toBe(2);
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

### Replace `apps/api/test/integration/cli-grant-role.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: grant-role CLI", () => {
  let authDb: Db;
  let apiDb: Db;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, apiDb, kv }, user.email, "moderator");

    expect(result).toEqual({ userId: user.id, previousRole: "user" });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli" } });
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, apiDb, kv: new MemoryKv() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
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
 * that flags passwords containing "breached". A suite whose profiles live in the public schema (the
 * deletion flow compares the typed handle with the profile's) passes the real profile store instead.
 */
export function flowHarness(repo: AuthRepo, options: { profiles?: ProfileStore } = {}) {
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
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
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
    profiles: options.profiles ?? memoryProfiles(),
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
  const signed = await signIn(h.deps, user, device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
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

### Replace `apps/api/test/integration/http-account.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExportFormat, FlowResponse, MeResponse, MediaStatusResponse, PostView, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser } from "./http-client";
import { BYTES, fakeWorker } from "./media-harness";

type App = ReturnType<typeof createApp>;

const newHandle = () => `a${randomBytes(4).toString("hex")}`;

/**
 * The export route through the real app: 1a sign-up for the accounts, cookie sessions with CSRF,
 * the auth module's freshness check, an image uploaded over HTTP with the stand-in for the worker
 * on the store directory, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-account-"));
  const worker = fakeWorker(path.join(root, "store"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `export-${randomUUID()}@korbat.local`;
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
  const exportOf = (b: Browser) => b.fetch("/api/account/export", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }
  /** The opposite: the session proved a credential just now. */
  async function makeFresh(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date());
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);

  /** Uploads an image and lets the stand-in worker accept it. */
  async function readyImage(b: Browser): Promise<string> {
    const res = await b.fetch("/api/media", { raw: { type: "image/jpeg", body: BYTES.jpeg } });
    expect(res.status).toBe(202);
    const { id } = UploadResponse.parse(await res.json());
    worker.ready(id, { width: 1200, height: 800 });
    expect(MediaStatusResponse.parse(await (await b.fetch(`/api/media/${id}`)).json()).status).toBe("ready");
    return id;
  }

  test("the export needs an onboarded, fresh session", async () => {
    const anonymous = await app.request("/api/account/export", { method: "POST" });
    expect(anonymous.status).toBe(401);
    expect(await errorCode(anonymous)).toBe("unauthenticated");
    const notOnboarded = await signUp(false);
    const early = await exportOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");
    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await exportOf(stale.b);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("reauth_required");
    // A refusal spends nothing: once fresh again, the day's export is still available.
    await makeFresh(stale.b);
    expect((await exportOf(stale.b)).status).toBe(200);
  });

  test("the archive streams with its headers, holds export.json and the uploaded image, records the event, and comes once a day", async () => {
    const ada = await signUp();
    const image = await readyImage(ada.b);
    const created = await ada.b.fetch("/api/posts", { json: { body: "a photo", media: [{ id: image, alt: "a harbour at dawn" }] } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());

    const res = await exportOf(ada.b);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="korbat-export-${ada.handle}-\\d{4}-\\d{2}-\\d{2}\\.zip"$`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${image}.webp`].sort());
    expect(strFromU8(files[`media/${image}.webp`]!)).toBe(`large-webp-of-${image}`);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.account).toMatchObject({ id: ada.userId, email: ada.email, role: "user", termsVersion: config.TERMS_VERSION });
    expect(json.profile).toMatchObject({ handle: ada.handle, displayName: `User ${ada.handle}`, handleHistory: [ada.handle] });
    expect(json.sessions).toEqual([{ id: sessionIdOf(ada.b), createdAt: expect.any(String), lastUsedAt: expect.any(String), current: true }]);
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0]).toMatchObject({ id: post.id, body: "a photo", media: [{ id: image, file: `media/${image}.webp`, altText: "a harbour at dawn", width: 1200, height: 800 }] });
    expect(json.missingMedia).toEqual([]);
    expect(await eventTypes(ada.userId)).toContain("export_created");

    // The freshness check comes before the daily limit: a stale session is told to re-authenticate, not to wait a day.
    await makeStale(ada.b);
    const stale = await exportOf(ada.b);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    await makeFresh(ada.b);
    const again = await exportOf(ada.b);
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("rate_limited");
    const retryAfter = Number(again.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(24 * 3600);
    expect((await eventTypes(ada.userId)).filter((type) => type === "export_created")).toHaveLength(1);
  });
});
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
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
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
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);

    const blocked = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "reauth_required" } });

    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(200);
    // The level reached; the token rotated into the cookies, never into a browser's body (1c design, section 7.2).
    expect(await reauth.json()).toEqual({ level: 1 });
    const rotated = b.cookie("__Host-korbat_session")!;
    expect(rotated).not.toBe(token);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);

    const set = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    expect(b.cookie("__Host-korbat_session")).not.toBe(rotated);
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
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
    for (const [path, body] of routes) {
      const stale = await b.fetch(path, { json: body });
      expect(stale.status, path).toBe(403);
      expect(await stale.json()).toMatchObject({ error: { code: "reauth_required" } });
    }
    const { flowId: reauthFlow } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    expect((await b.fetch("/api/auth/reauth", { json: { method: "email", flowId: reauthFlow, code: mailer.lastCodeFor(email) } })).status).toBe(200);

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

  test("the undo link of an email change needs no session: a malformed token is 400, the right one 204 with every session signed out, a used one 400", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Undo" } });
    const newAddress = `http-undo-${randomUUID()}@korbat.local`;
    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/email/change/start", { json: { email: newAddress } })).json());
    expect((await b.fetch("/api/auth/email/change/verify", { json: { flowId, code: mailer.lastCodeFor(newAddress) } })).status).toBe(200);
    const notice = mailer.sent.at(-1)!;
    expect(notice).toMatchObject({ to: email, template: "email_changed" });
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})$/.exec(notice.data.revertUrl ?? "")?.[1];
    expect(token).toBeDefined();

    // Opened in a browser that holds no session: the link is the only credential.
    const stranger = new Browser(app, config.APP_ORIGIN);
    for (const body of [{ token: "not-a-token" }, { token: `${token!.slice(1)}/` }, {}]) {
      const malformed = await stranger.fetch("/api/auth/email/revert", { json: body });
      expect(malformed.status, JSON.stringify(body)).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const reverted = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(reverted.status).toBe(204);
    expect(await reverted.text()).toBe("");
    expect((await b.fetch("/api/me")).status).toBe(401);
    expect((await auth.deps.repo.findUserByEmail(email))?.email).toBe(email);
    expect(await auth.deps.repo.findUserByEmail(newAddress)).toBeUndefined();
    expect(mailer.sent.at(-1)).toMatchObject({ to: email, template: "email_change_reverted" });
    const used = await stranger.fetch("/api/auth/email/revert", { json: { token } });
    expect(used.status).toBe(400);
    expect(await used.json()).toMatchObject({ error: { code: "invalid_code" } });
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

### Replace `apps/api/test/integration/http-badge.test.ts` (whole file)

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
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
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

### Replace `apps/api/test/integration/http-deletion.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DeleteStartResponse, ErrorEnvelope, FlowResponse, MeResponse, PostView, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `del${randomBytes(4).toString("hex")}`;

/**
 * The deletion routes through the real app: 1a sign-up for the accounts, cookie and bearer sessions,
 * the auth module's freshness check, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-deletion-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `deletion-${randomUUID()}@korbat.local`;
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

  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const startOf = (b: Browser) => b.fetch("/api/account/delete/start", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionIdOf(b)}`);
  }

  test("both routes need an onboarded, fresh session", async () => {
    const confirmBody = JSON.stringify({ flowId: randomToken(), code: "123456", handle: "nobody" });
    for (const [path, body] of [
      ["/api/account/delete/start", undefined],
      ["/api/account/delete/confirm", confirmBody],
    ] as const) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(anonymous.status, path).toBe(401);
      expect((await error(anonymous)).code, path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(false);
    const early = await startOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    const earlyConfirm = await notOnboarded.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: "nobody" } });
    expect(earlyConfirm.status).toBe(403);
    expect((await error(earlyConfirm)).code).toBe("onboarding_required");

    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await startOf(stale.b);
    expect(refused.status).toBe(403);
    expect((await error(refused)).code).toBe("reauth_required");
    const refusedConfirm = await stale.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: stale.handle } });
    expect(refusedConfirm.status).toBe(403);
    expect((await error(refusedConfirm)).code).toBe("reauth_required");
    // Nothing was sent or changed for a refused start.
    expect(mailer.sent.filter((mail) => mail.to === stale.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect((await stale.b.fetch("/api/me")).status).toBe(200);
  });

  test("the typed handle must be the account's own, then the code must be right", async () => {
    const ada = await signUp();
    const started = await startOf(ada.b);
    expect(started.status).toBe(200);
    const { flowId } = DeleteStartResponse.parse(await started.json());
    const code = mailer.lastCodeFor(ada.email)!;
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code"]);

    const mismatch = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code, handle: "someone_else" } });
    expect(mismatch.status).toBe(400);
    expect(await error(mismatch)).toMatchObject({ code: "invalid_request", message: "handle_mismatch" });
    const wrong = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: String((Number(code) + 1) % 1_000_000).padStart(6, "0"), handle: ada.handle } });
    expect(wrong.status).toBe(400);
    expect((await error(wrong)).code).toBe("invalid_code");
    // Still signed in, still there.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(200);
  });

  test("a web session's deletion answers 204 with both cookies cleared, and leaves nothing of the account reachable", async () => {
    const ada = await signUp();
    const created = await ada.b.fetch("/api/posts", { json: { body: "soon gone" } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    const token = ada.b.cookie("__Host-korbat_session")!;
    const { flowId } = DeleteStartResponse.parse(await (await startOf(ada.b)).json());
    const confirmed = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: mailer.lastCodeFor(ada.email)!, handle: ada.handle.toUpperCase() } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect(ada.b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect((await app.request(`/api/posts/${post.id}`)).status).toBe(404);
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code", "account_deleted"]);
    expect((await auth.deps.repo.recentEvents(ada.userId)).map((e) => e.type)).toContain("account_deleted");
    expect(await auth.deps.repo.pendingPurges()).not.toContain(ada.userId);
  });

  test("a native session gets a plain 204 without cookies, and its token stops working", async () => {
    const native = new NativeClient(app);
    const email = `deletion-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    const onboarded = (await (await native.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Phone User" } })).json()) as { token: string };
    native.token = onboarded.token;

    const started = await native.fetch("/api/account/delete/start", { method: "POST" });
    expect(started.status).toBe(200);
    const deletion = DeleteStartResponse.parse(await started.json());
    const confirmed = await native.fetch("/api/account/delete/confirm", { json: { flowId: deletion.flowId, code: mailer.lastCodeFor(email)!, handle } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie()).toHaveLength(0);
    expect((await native.fetch("/api/me")).status).toBe(401);
    expect((await app.request(`/api/profiles/${handle}`)).status).toBe(404);
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
import { emailHash } from "../../src/auth/identifiers";
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
  emailReverted: "Your korbat account is back at this address",
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
    // No code: the sign-in's password and TOTP code, minutes ago, are the level-2 proof the route asks for (1c design, section 2).
    expect((await b.fetch("/api/auth/mfa/totp/disable", { json: {} })).status).toBe(204);
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
    const reauth = await laptop.fetch("/api/auth/reauth", { json: { method: "password", password: PASSWORD } });
    expect(reauth.status).toBe(200);
    expect(await reauth.json()).toEqual({ level: 1 });
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

  test("an email change undone from the old mailbox: the account moves back, the taker's sessions and password go, and the owner signs in at the old address with a code", { timeout: 60_000 }, async () => {
    const owner = web();
    const { email: oldAddress, box: oldBox } = await signUpAndOnboard(owner);
    const ownerId = MeResponse.parse(await (await owner.fetch("/api/me")).json()).user.id;
    // An address waits a minute between codes, in real time in Redis; the test clears that wait instead of sitting through it.
    const skipCooldown = () => auth.deps.kv.del(`email-cooldown:${emailHash(auth.deps.config.authHmacKey, oldAddress)}`);
    // Someone else gets into the account (here with a code from the owner's mailbox), moves it to an address of their own and sets a password there.
    await skipCooldown();
    const taker = web();
    expect(await (await signInByCode(taker, oldAddress, oldBox, randomToken())).json()).toEqual({ result: "session", mustReenrollMfa: false });
    const takerAddress = newEmail("taker");
    const takerBox = await inbox(takerAddress);
    const started = await taker.fetch("/api/auth/email/change/start", { json: { email: takerAddress } });
    expect(started.status).toBe(200);
    const { flowId } = FlowResponse.parse(await started.json());
    const code = codeFrom(await takerBox.next(SUBJECT.emailChangeCode));
    expect((await taker.fetch("/api/auth/email/change/verify", { json: { flowId, code } })).status).toBe(200);
    expect((await taker.fetch("/api/auth/password/set", { json: { password: PASSWORD } })).status).toBe(200);
    expect((await passwordSignIn(web(), takerAddress, PASSWORD, randomToken())).status).toBe(200);

    // The notice in the old mailbox carries the link; a browser without any session opens it.
    const notice = await oldBox.next(SUBJECT.emailChanged);
    expect(notice).toContain(takerAddress);
    const token = /\/email-revert\/([A-Za-z0-9_-]{43})/.exec(notice)?.[1];
    expect(token).toBeDefined();
    expect((await web().fetch("/api/auth/email/revert", { json: { token } })).status).toBe(204);
    expect(await oldBox.next(SUBJECT.emailReverted)).toMatch(/every session/i);

    // Every session is gone, the taker's and the owner's own, and so is the password set after the change. Every device is
    // revoked too, so the taker's next sign-in on theirs counts as a new device and the owner is told of it.
    expect(await auth.deps.repo.listDevices(ownerId)).toEqual([]);
    expect((await taker.fetch("/api/me")).status).toBe(401);
    expect((await owner.fetch("/api/me")).status).toBe(401);
    for (const address of [takerAddress, oldAddress]) {
      const refused = await passwordSignIn(web(), address, PASSWORD, randomToken());
      expect(refused.status, address).toBe(401);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    }
    // The owner signs in at the old address with a code from the old mailbox.
    await skipCooldown();
    const back = web();
    expect(await (await signInByCode(back, oldAddress, oldBox, randomToken())).json()).toEqual({ result: "session", mustReenrollMfa: false });
    const me = MeResponse.parse(await (await back.fetch("/api/me")).json());
    expect(me.user).toMatchObject({ email: oldAddress, hasPassword: false });
    expect((await auth.deps.repo.recentEvents(me.user.id)).filter((e) => e.type === "email_changed")).toHaveLength(2);
    expect((await web().fetch("/api/auth/email/revert", { json: { token } })).status).toBe(400);
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

### Replace `apps/api/test/integration/http-profile.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `p${randomBytes(4).toString("hex")}`;

/**
 * The profile-editing routes through the real app: 1a sign-up for the accounts, cookie sessions with
 * CSRF, the auth module's freshness check on the handle change, and events written to auth_events
 * through the auth module, wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change over HTTP", () => {
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
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `profile-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The `{ profile }` body of a successful edit or handle change, checked against the contract. */
  const profileOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ProfileView.parse(((await res.json()) as { profile: unknown }).profile);
  };
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const signedOut = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("editing the profile needs an onboarded session; the edit is public at once and recorded", async () => {
    expect((await signedOut("/api/me/profile", "PATCH", { bio: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "too early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const edited = await profileOf(await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { displayName: "Ada Lovelace", bio: "  Analytical engines.  " } }));
    expect(edited).toMatchObject({ id: ada.userId, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(edited.viewer).toBeUndefined();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json())).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    const empty = await ada.b.fetch("/api/me/profile", { method: "PATCH", json: {} });
    expect(empty.status).toBe(400);
    expect(await errorCode(empty)).toBe("invalid_request");
    expect((await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "x".repeat(161) } })).status).toBe(400);
    expect(await eventTypes(ada.userId)).toContain("profile_updated");
  });

  test("changing the handle needs an onboarded, fresh session; /me and the profile routes follow; the cooldown answers with Retry-After", async () => {
    expect((await signedOut("/api/me/handle", "POST", { handle: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/handle", { json: { handle: "too_early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const bob = await signUp();
    const to = newHandle();
    const changed = await profileOf(await ada.b.fetch("/api/me/handle", { json: { handle: to.toUpperCase() } }));
    expect(changed).toMatchObject({ id: ada.userId, handle: to });
    const me = MeResponse.parse(await (await ada.b.fetch("/api/me")).json());
    expect(me.profile).toMatchObject({ id: ada.userId, handle: to, verified: false });
    expect(me.profile!.handleChangedAt).not.toBeNull();
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${to}`)).json()).id).toBe(ada.userId);
    expect(await eventTypes(ada.userId)).toContain("handle_changed");

    const again = await ada.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("handle_cooldown");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(29 * 24 * 3600);

    const refusals = [
      [ada.handle, "handle_taken", 409],
      [to.toUpperCase(), "handle_taken", 409],
      ["admin", "handle_reserved", 400],
      ["ab", "handle_invalid", 400],
      [bob.handle, "invalid_request", 400],
    ] as const;
    for (const [handle, code, status] of refusals) {
      const refused = await bob.b.fetch("/api/me/handle", { json: { handle } });
      expect(refused.status, handle).toBe(status);
      expect(await errorCode(refused), handle).toBe(code);
    }
    expect(MeResponse.parse(await (await bob.b.fetch("/api/me")).json()).profile).toMatchObject({ handle: bob.handle, handleChangedAt: null });
    expect(await eventTypes(bob.userId)).not.toContain("handle_changed");

    await makeStale(bob.b);
    const stale = await bob.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    // Editing the name or the bio needs a session but no fresh proof of a credential.
    expect((await bob.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "still allowed" } })).status).toBe(200);
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
    const data = {
      code: "123456",
      deviceLabel: "<b>Chrome</b> on Windows",
      notMeUrl: "http://localhost:8081/not-me/abc",
      revertUrl: "http://localhost:8081/email-revert/def",
      minutes: "15",
      count: "3",
      email: "new<address>@example.com",
      name: "<i>Work</i> laptop",
      time: "2026-09-25 10:00 UTC",
      removeUrl: "http://localhost:8081/passkey-remove/ghi",
    };
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
      "email_change_code",
      "email_changed",
      "email_change_reverted",
      "badge_verified",
      "badge_removed",
      "delete_account_code",
      "account_deleted",
      "passkey_added",
      "passkey_removed",
      "passkey_suspect",
      "recovery_code_used",
    ] as const) {
      const r = renderTemplate(template, data);
      expect(r.subject.length, template).toBeGreaterThan(5);
      expect(r.text.length, template).toBeGreaterThan(20);
      // Links stay plain text (new_device carries the not-me URL that way); nothing is ever an anchor or an image.
      expect(r.html, template).not.toMatch(/<img|<a /);
    }
    const newDevice = renderTemplate("new_device", data);
    expect(newDevice.html).toContain("&lt;b&gt;Chrome&lt;/b&gt;");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    const emailChanged = renderTemplate("email_changed", data);
    expect(emailChanged.html).toContain("new&lt;address&gt;@example.com");
    expect(emailChanged.text).toContain("new<address>@example.com");
    expect(emailChanged.text).toContain("http://localhost:8081/email-revert/def");
  });
  test("the mails that carry a lockdown link, and the note after one ran, say what the lockdown does (1c design, section 7.6)", () => {
    // The link's page says the same before the owner opens it (Task 7); the mail is where they first read it.
    const lockdownWording = (text: string) => {
      expect(text).toMatch(/signs out every session|every session was signed out/);
      expect(text).toMatch(/removes (your|the) password|password was removed/);
      expect(text).toMatch(/passkey/);
      expect(text).toMatch(/two-factor authentication/);
      expect(text).toMatch(/the day before/);
    };
    const newDevice = renderTemplate("new_device", { deviceLabel: "Chrome on Windows", notMeUrl: "http://localhost:8081/not-me/abc" });
    expect(newDevice.text).toContain("Chrome on Windows");
    expect(newDevice.text).toContain("24 hours");
    expect(newDevice.text).toContain("http://localhost:8081/not-me/abc");
    lockdownWording(newDevice.text);
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("24 hours");
    expect(changed.text).toMatch(/back to this address/);
    expect(changed.text).toContain("http://localhost:8081/email-revert/abc");
    lockdownWording(changed.text);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).not.toMatch(/https?:\/\//);
    lockdownWording(reverted.text);
  });
  test("a recovery code spent at re-authentication is announced, without a link", () => {
    const used = renderTemplate("recovery_code_used", {});
    expect(used.subject).toBe("A recovery code was used on your korbat account");
    expect(used.text).toMatch(/recovery code/);
    expect(used.text).toMatch(/once/);
    expect(used.text).toMatch(/If this was not you/);
    expect(used.text).not.toMatch(/https?:\/\//);
  });
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toMatch(/If this was not you, open this link within 24 hours\./);
    expect(changed.text).toMatch(/: http:\/\/localhost:8081\/email-revert\/abc$/m);
    // A change while an earlier change's link is still out sends no link of its own, and says where the one that works went.
    const again = renderTemplate("email_changed", { email: "new@example.com" });
    expect(again.text).toContain("new@example.com");
    expect(again.text).not.toMatch(/https?:\/\//);
    expect(again.text).toMatch(/less than a day ago/);
    const reverted = renderTemplate("email_change_reverted", {});
    expect(reverted.text).toMatch(/back at this address/);
    expect(reverted.text).toMatch(/every session/i);
    const deleteCode = renderTemplate("delete_account_code", { code: "111222" });
    expect(deleteCode.text).toContain("111222");
    expect(deleteCode.text).toMatch(/delete/i);
    expect(deleteCode.text).toMatch(/revoke|sign out/i);
    expect(renderTemplate("account_deleted", {}).text).toMatch(/cannot be undone/);
    expect(renderTemplate("badge_verified", {}).text).toMatch(/verified/i);
    expect(renderTemplate("badge_removed", {}).text).toMatch(/removed/i);
  });
  test("the passkey templates name the passkey, say what happened and what to do, and never let the name become HTML", () => {
    const name = `<img src=x onerror=alert(1)> "Work" laptop`;
    const removeUrl = "http://localhost:8081/passkey-remove/abc";
    const added = renderTemplate("passkey_added", { name, deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl });
    expect(added.subject).toBe("A passkey was added to your korbat account");
    expect(added.text).toContain(name);
    expect(added.text).toContain("Chrome on Windows");
    expect(added.text).toContain("2026-09-25 10:00 UTC");
    expect(added.text).toContain(removeUrl);
    expect(added.text).toContain("7 days");
    // What the link does (the lockdown of the 1c design, section 7.6), before the owner opens it.
    expect(added.text).toMatch(/removes? (this|the) passkey/);
    expect(added.text).toMatch(/sign(s)? out every session/);
    expect(added.text).toMatch(/password/);
    expect(added.text).toMatch(/two-factor authentication/);
    expect(added.text).toMatch(/the day before/);
    expect(added.html).toContain("&lt;img src=x onerror=alert(1)&gt; &quot;Work&quot; laptop");
    expect(added.html).not.toMatch(/<img|<a /);
    expect(added.html).toContain(removeUrl);

    const removed = renderTemplate("passkey_removed", { name, time: "2026-09-25 11:00 UTC" });
    expect(removed.subject).toBe("A passkey was removed from your korbat account");
    expect(removed.text).toContain(name);
    expect(removed.text).toContain("2026-09-25 11:00 UTC");
    expect(removed.text).not.toMatch(/https?:\/\//);
    expect(removed.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(removed.html).not.toMatch(/<img|<a /);

    const suspect = renderTemplate("passkey_suspect", { name });
    expect(suspect.subject).toBe("A passkey on your korbat account was switched off");
    expect(suspect.text).toContain(name);
    expect(suspect.text).toMatch(/copy/);
    expect(suspect.text).toMatch(/switched (it|that passkey) off/);
    expect(suspect.text).toMatch(/remove it/i);
    expect(suspect.text).toMatch(/add a new one/);
    expect(suspect.text).not.toMatch(/https?:\/\//);
    expect(suspect.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(suspect.html).not.toMatch(/<img|<a /);
  });
  test("missing template data is a programming error", () => {
    expect(() => renderTemplate("sign_in_code", {})).toThrow(/code/);
    expect(() => renderTemplate("passkey_added", { name: "Phone", deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC" })).toThrow(/removeUrl/);
    expect(() => renderTemplate("passkey_added", { deviceLabel: "Chrome on Windows", time: "2026-09-25 10:00 UTC", removeUrl: "http://localhost:8081/passkey-remove/abc" })).toThrow(/name/);
    expect(() => renderTemplate("passkey_removed", { name: "Phone" })).toThrow(/time/);
    expect(() => renderTemplate("passkey_suspect", {})).toThrow(/name/);
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

### Replace `packages/contracts/test/auth.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuthErrorCode,
  BadgeStartRequest,
  BadgeVerifyRequest,
  BadgeVerifyResponse,
  DeleteConfirmRequest,
  DeleteStartResponse,
  DeviceId,
  DisplayName,
  Email,
  EmailChangeResponse,
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailRevertRequest,
  EmailVerifyResponse,
  MeProfile,
  MeResponse,
  MfaVerifyRequest,
  OpaqueId,
  Phone,
  ReauthRequest,
  ReauthResponse,
  RecoveryCode,
  SignupCompleteRequest,
  TotpDisableRequest,
} from "../src/index";

const flow = "a".repeat(43);
const userId = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

describe("auth primitives", () => {
  test("email is trimmed and lowercased, invalid rejected", () => {
    expect(Email.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(Email.safeParse("not-an-email").success).toBe(false);
    expect(Email.safeParse(`${"a".repeat(250)}@x.io`).success).toBe(false);
  });
  test("opaque ids are exactly 43 base64url characters", () => {
    expect(OpaqueId.safeParse(flow).success).toBe(true);
    expect(OpaqueId.safeParse("a".repeat(42)).success).toBe(false);
    expect(OpaqueId.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });
  test("device ids are 22 to 64 url-safe characters", () => {
    expect(DeviceId.safeParse("x".repeat(22)).success).toBe(true);
    expect(DeviceId.safeParse("x".repeat(21)).success).toBe(false);
    expect(DeviceId.safeParse("x".repeat(65)).success).toBe(false);
  });
  test("recovery codes are normalised to lowercase base32 groups", () => {
    expect(RecoveryCode.parse(" ABCD-EF23-GH45 ")).toBe("abcd-ef23-gh45");
    expect(RecoveryCode.safeParse("abcd-ef01-gh45").success).toBe(false);
  });
  test("display names reject control characters and more than 50 characters", () => {
    expect(DisplayName.parse("  Ada Lovelace ")).toBe("Ada Lovelace");
    expect(DisplayName.safeParse(`bad${String.fromCharCode(7)}name`).success).toBe(false);
    expect(DisplayName.safeParse("x".repeat(51)).success).toBe(false);
  });
  test("phone numbers are E.164 once spaces, hyphens and parentheses are dropped", () => {
    expect(Phone.parse(" +44 7911 123-456 ")).toBe("+447911123456");
    expect(Phone.parse("+1 (415) 555-0132")).toBe("+14155550132");
    expect(Phone.parse("+1234567")).toBe("+1234567");
    expect(Phone.parse(`+${"9".repeat(15)}`)).toBe(`+${"9".repeat(15)}`);
    // No plus, a leading zero, too short, too long, letters, a plus in the middle.
    for (const bad of ["447911123456", "+0447911123456", "+123456", `+${"9".repeat(16)}`, "+44 7911 ext 12", "44+7911123456", ""]) {
      expect(Phone.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("auth requests and responses", () => {
  test("email verify response is discriminated by result", () => {
    expect(EmailVerifyResponse.parse({ result: "signup_required" })).toEqual({ result: "signup_required" });
    expect(EmailVerifyResponse.parse({ result: "mfa_required", mfaTicket: flow }).result).toBe("mfa_required");
    expect(EmailVerifyResponse.safeParse({ result: "session" }).success).toBe(false);
    expect(EmailVerifyResponse.parse({ result: "session", mustReenrollMfa: false })).toEqual({ result: "session", mustReenrollMfa: false });
  });
  test("mfa verify takes exactly one of code or recoveryCode", () => {
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, recoveryCode: "abcd-ef23-gh45" }).success).toBe(true);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow, code: "123456", recoveryCode: "abcd-ef23-gh45" }).success).toBe(false);
    expect(MfaVerifyRequest.safeParse({ mfaTicket: flow }).success).toBe(false);
  });
  test("reauth accepts password, totp, email and recovery methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    // A recovery code (1c design, section 7.2), normalised as the MFA step normalises it.
    expect(ReauthRequest.parse({ method: "recovery", recoveryCode: " ABCD-EF23-GH45 " })).toEqual({ method: "recovery", recoveryCode: "abcd-ef23-gh45" });
    expect(ReauthRequest.safeParse({ method: "recovery", recoveryCode: "abcd-ef01-gh45" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "recovery", code: "000000" }).success).toBe(false);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
  });
  test("the reauth answer carries the level reached, the rotated token for native clients and, after a recovery code, the re-enrolment flag", () => {
    expect(ReauthResponse.parse({ level: 1 })).toEqual({ level: 1 });
    expect(ReauthResponse.parse({ level: 2, token: "kb1_x", mustReenrollMfa: true })).toEqual({ level: 2, token: "kb1_x", mustReenrollMfa: true });
    expect(ReauthResponse.safeParse({ level: 3 }).success).toBe(false);
    expect(ReauthResponse.safeParse({ level: "2" }).success).toBe(false);
    expect(ReauthResponse.safeParse({ token: "kb1_x" }).success).toBe(false);
  });
  test("turning TOTP off takes an empty body: the re-authentication already spent the code, and a code sent anyway is dropped", () => {
    expect(TotpDisableRequest.parse({})).toEqual({});
    expect(TotpDisableRequest.parse({ code: "123456" })).toEqual({});
    expect(TotpDisableRequest.safeParse(null).success).toBe(false);
    expect(TotpDisableRequest.safeParse("code").success).toBe(false);
  });
  test("signup completion needs an ISO calendar date", () => {
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "2008-02-29", termsVersion: "draft" }).success).toBe(true);
    expect(SignupCompleteRequest.safeParse({ flowId: flow, dateOfBirth: "29/02/2008", termsVersion: "draft" }).success).toBe(false);
  });
  test("me response carries email and a nullable profile", () => {
    const me = {
      user: { id: userId, email: "a@b.io", role: "user", onboarded: false, mfaEnabled: false, hasPassword: false },
      profile: null,
    };
    expect(MeResponse.parse(me)).toEqual(me);
  });
  test("the own profile in the me response says when the handle last changed and whether the badge is held", () => {
    const user = { id: userId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false };
    const profile = { id: userId, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false };
    expect(MeResponse.parse({ user, profile })).toEqual({ user, profile });
    expect(MeProfile.parse({ ...profile, handleChangedAt: "2026-09-24T10:00:00.000Z", verified: true }).verified).toBe(true);
    // Both fields are facts the account screen relies on, so a profile without them is not a valid answer.
    expect(MeResponse.safeParse({ user, profile: { id: userId, handle: "ada", displayName: "Ada" } }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, handleChangedAt: "yesterday" }).success).toBe(false);
    expect(MeProfile.safeParse({ ...profile, verified: "yes" }).success).toBe(false);
  });
  test("every documented auth error code exists", () => {
    expect(AuthErrorCode.options).toHaveLength(34);
    expect(AuthErrorCode.options).toContain("password_check_unavailable");
    expect(AuthErrorCode.options).toEqual(expect.arrayContaining(["handle_cooldown", "email_in_use", "phone_in_use", "badge_unavailable", "verify_unavailable"]));
    // Passkeys (1c design, section 8).
    expect(AuthErrorCode.options).toEqual(
      expect.arrayContaining(["passkey_invalid", "passkey_unsupported", "passkey_limit", "passkey_suspended", "passkey_not_found", "challenge_expired"]),
    );
  });
});

describe("account lifecycle requests and responses", () => {
  test("an email change starts with an address under the sign-up rules and verifies with a flow id and code", () => {
    expect(EmailChangeStartRequest.parse({ email: " New@Example.COM " })).toEqual({ email: "new@example.com" });
    expect(EmailChangeStartRequest.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(EmailChangeStartRequest.safeParse({}).success).toBe(false);
    expect(EmailChangeVerifyRequest.parse({ flowId: flow, code: "123456" })).toEqual({ flowId: flow, code: "123456" });
    expect(EmailChangeVerifyRequest.safeParse({ flowId: flow, code: "12345" }).success).toBe(false);
    expect(EmailChangeVerifyRequest.safeParse({ flowId: "short", code: "123456" }).success).toBe(false);
    expect(EmailChangeResponse.parse({ email: "new@example.com" })).toEqual({ email: "new@example.com" });
    expect(EmailChangeResponse.safeParse({ email: "nope" }).success).toBe(false);
  });
  test("the undo link of an email change carries one opaque token", () => {
    expect(EmailRevertRequest.parse({ token: flow })).toEqual({ token: flow });
    expect(EmailRevertRequest.safeParse({ token: "a".repeat(42) }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({ token: `${"a".repeat(42)}/` }).success).toBe(false);
    expect(EmailRevertRequest.safeParse({}).success).toBe(false);
  });
  test("the badge starts with a phone number and verifies with a flow id and a six-digit code", () => {
    expect(BadgeStartRequest.parse({ phone: "+44 7911 123456" })).toEqual({ phone: "+447911123456" });
    expect(BadgeStartRequest.safeParse({ phone: "07911123456" }).success).toBe(false);
    expect(BadgeStartRequest.safeParse({}).success).toBe(false);
    expect(BadgeVerifyRequest.parse({ flowId: flow, code: "000000" })).toEqual({ flowId: flow, code: "000000" });
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "abcdef" }).success).toBe(false);
    expect(BadgeVerifyRequest.safeParse({ flowId: flow, code: "0000000" }).success).toBe(false);
    expect(BadgeVerifyResponse.parse({ verified: true })).toEqual({ verified: true });
    expect(BadgeVerifyResponse.safeParse({ verified: false }).success).toBe(false);
  });
  test("deletion starts with a flow id and is confirmed with the code and the typed handle", () => {
    expect(DeleteStartResponse.parse({ flowId: flow })).toEqual({ flowId: flow });
    expect(DeleteStartResponse.safeParse({ flowId: "x" }).success).toBe(false);
    expect(DeleteConfirmRequest.parse({ flowId: flow, code: "123456", handle: " Ada_Lovelace " })).toEqual({ flowId: flow, code: "123456", handle: "ada_lovelace" });
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, code: "123456", handle: "" }).success).toBe(false);
    expect(DeleteConfirmRequest.safeParse({ flowId: flow, handle: "ada" }).success).toBe(false);
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
❯ test/auth/sessions.test.ts (7 tests | 7 failed) 131ms
❯ test/mail/templates.test.ts (8 tests | 4 failed) 31ms
❯ test/app.test.ts (17 tests | 17 failed) 211ms
❯ test/auth/messages.test.ts (4 tests | 1 failed) 31ms
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/03-session-factors-lockdown.md 3
```

Expected: 22 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/auth/flows/lockdown.ts`

```ts
import type { AuthDeps, RequestContext } from "../context";
import { HOUR } from "../limits";
import type { AuthEventType } from "../repo";

/** How far back a lockdown reaches before its anchor (1c design, section 2): a day catches what an attacker set up just before the event the owner noticed. */
export const LOCKDOWN_LOOKBACK_MS = 24 * HOUR;

/** Who ran the lockdown, for the event it records: the event's type, the device it concerns, and the caller's own facts, kept beside the lockdown's. */
export interface LockdownCaller {
  type: AuthEventType;
  deviceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** What one run did, as its event records it. The password is cleared on every run. */
export interface LockdownReport {
  passkeysRemoved: string[];
  totpCleared: boolean;
  passwordCleared: true;
}

/**
 * The one routine behind every undo link (1c design, sections 2 and 7.6): every session revoked with a tombstone, every
 * device revoked (so the next sign-in on any of them is a new device again, and the owner hears of it), the password
 * cleared, the passkeys created at or after the day before the anchor removed, plus any the caller names (the one that
 * signed in, or the one a link is about, whatever its age), and TOTP turned off when it was enabled at or after that
 * day. The anchor is the event the owner is answering: the alerted sign-in, the address change, a passkey's creation.
 * What the owner had from before stays, except the password, which nobody can tell from one an attacker set. Running
 * it again finds nothing more to remove and records that.
 */
export async function lockdown(
  deps: AuthDeps,
  input: { userId: string; anchor: Date; passkeyIds?: readonly string[]; caller: LockdownCaller; ctx: RequestContext },
): Promise<LockdownReport> {
  const now = deps.now();
  const since = new Date(input.anchor.getTime() - LOCKDOWN_LOOKBACK_MS);
  await deps.sessions.revokeAll(input.userId);
  await deps.repo.revokeDevices(input.userId, now);
  await deps.repo.setPasswordHash(input.userId, null, now);
  const passkeysRemoved = await deps.repo.deletePasskeys(input.userId, { since, ids: input.passkeyIds ?? [] });
  // The row is read after the writes above, none of which touch two-factor; an account that is gone has none to clear.
  const user = await deps.repo.findUserById(input.userId);
  const totpCleared = user !== undefined && user.totpEnabledAt !== null && user.totpEnabledAt.getTime() >= since.getTime();
  if (totpCleared) await deps.repo.disableTotp(input.userId);
  const report: LockdownReport = { passkeysRemoved, totpCleared, passwordCleared: true };
  await deps.repo.appendEvent({
    userId: input.userId,
    type: input.caller.type,
    deviceId: input.caller.deviceId ?? null,
    ipHash: input.ctx.ipHash,
    metadata: { ...input.caller.metadata, ...report },
  });
  return report;
}
```

### Replace `apps/api/src/account/index.ts` (whole file)

```ts
/**
 * The only file outside `src/account/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AuthForAccount } from "../auth";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForAccount } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForAccount } from "../social";
import type { AccountDeps } from "./context";
import { createPurgeJob } from "./purge";
import { accountRoutes } from "./routes";

export { AccountError } from "./context";
export type { AccountDeps } from "./context";

export interface CreateAccountOptions {
  /** The other modules' interfaces for this one, as their index files hand them out: auth.forAccount, social.forAccount, media.forAccount. */
  auth: AuthForAccount;
  social: SocialForAccount;
  media: MediaForAccount;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which the export needs. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's requireStrongFreshAuth: level 2 on an account with TOTP, which starting and confirming a deletion need (1c design, section 10). */
  requireStrongFreshAuth: MiddlewareHandler<AppEnv>;
  /** The daily export limit shares the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  now?: () => Date;
}

export function createAccount(options: CreateAccountOptions) {
  const deps: AccountDeps = {
    auth: options.auth,
    social: options.social,
    media: options.media,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return {
    deps,
    routes: accountRoutes(deps, options.requireSession, options.requireFreshAuth, options.requireStrongFreshAuth),
    /** Starts the purge job (deletions left half done, every five minutes under the shared lock) and returns the function that stops it. */
    startPurge: (lock: JobLock) => createPurgeJob(deps, lock).start(),
  };
}

export type Account = ReturnType<typeof createAccount>;
```

### Replace `apps/api/src/account/routes.ts` (whole file)

```ts
import { DeleteConfirmRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { clearSessionCookies, type RequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { AccountDeps } from "./context";
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { buildExport, enforceExportLimit, exportFilename, giveBackExport, writeExport, type ExportPlan } from "./flows/export";
import { createZipWriter } from "./zip";

/**
 * The account endpoints, mounted at /api/account. `guard` is the auth module's requireSession: an
 * onboarded account, with CSRF and Origin already checked for cookie sessions. `fresh` is its
 * requireFreshAuth: a credential proven in the last five minutes, which the export needs on top
 * (1b design, section 10). `strong` is its requireStrongFreshAuth: level 2 on an account with TOTP,
 * which starting and confirming a deletion need (1c design, section 10). Errors are the app's to
 * render: AccountError and those of the three modules.
 */
export function accountRoutes(deps: AccountDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>, strong: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** What the auth flows record about a request, as the auth routes build it: the hashed address, never the address. */
  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });

  r.post("/delete/start", guard, strong, async (c) => c.json(await startDeletion(deps, c.get("session")!, requestContext(c))));

  r.post("/delete/confirm", guard, strong, validate("json", DeleteConfirmRequest), async (c) => {
    await confirmDeletion(deps, c.get("session")!, c.req.valid("json"));
    // The session behind a web request's cookies is revoked; the browser is told to drop them so it does not keep sending a dead token.
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/export", guard, fresh, async (c) => {
    const session = c.get("session")!;
    const log = c.get("log");
    // Taken before anything is built or streamed; given back below when the export fails before its first byte.
    await enforceExportLimit(deps, session.userId);
    const now = deps.now();

    // The body is a stream this handler writes itself, so a failure after the first byte can fail it: the
    // connection then drops before the final chunk, and the client sees a broken download, never a short
    // archive that ends cleanly.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const body = writable.getWriter();
    let started = false;
    let clientLeft = false;
    let plan: ExportPlan | undefined;
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => (begin = resolve));
    const archive = (async () => {
      plan = await buildExport(deps, session.userId, session.sessionId, now);
      const writer = createZipWriter(async (chunk) => {
        if (!started) {
          started = true;
          begin();
        }
        try {
          // Resolves once the client's side has taken the chunk: a slow client slows the file reads.
          await body.write(chunk);
        } catch (err) {
          // Only a client that went away fails a write; reading on would be waste.
          clientLeft = true;
          throw err;
        }
      });
      await writeExport(writer, plan);
      // Every chunk is on its way: the export happened. Recorded before the body ends, so whoever read the whole body
      // finds the event; a failure to record it is logged and does not spoil a complete download.
      await deps.auth.appendEvent(session.userId, "export_created").catch((err: unknown) => log.error({ err, userId: session.userId }, "account export: the export_created event could not be recorded"));
      await body.close();
    })();

    try {
      // Until the first chunk the export can still fail as a plain error response.
      await Promise.race([begun, archive]);
    } catch (err) {
      // Nothing was sent, so nothing was exported: the day's export goes back before the error is answered.
      await giveBackExport(deps, session.userId, log);
      throw err;
    }
    // From here the failure of the archive can only fail the body; as the design says, the day's export stays spent.
    archive.catch(async (err: unknown) => {
      await body.abort(err).catch(() => undefined);
      if (clientLeft) log.warn({ userId: session.userId }, "account export: the client left before the archive was complete");
      else log.error({ err, userId: session.userId }, "account export: the archive could not be completed");
    });

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${exportFilename(plan!.profile.profile.handle, now)}"`);
    // The archive holds the account's email address; nothing on the way may keep a copy.
    c.header("Cache-Control", "no-store");
    return c.body(readable, 200);
  });

  return r;
}
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";

/** JSON requests are small; the one raw upload route counts its own bytes and is exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

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
  /** The account lifecycle (the data export). Optional for the same reason; the server always wires it. */
  account?: Account;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(auth.clientIdentity);
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  const jsonBodies = bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large", (c as typeof c & { get(key: "requestId"): string }).get("requestId")), 413),
  });
  app.use((c, next) => (c.req.method === "POST" && c.req.path === "/api/media" ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  app.use(auth.resolveSession);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  app.get("/api/me", auth.requireOnboarding, auth.me);
  if (media) app.route("/api/media", media.routes);
  if (account) app.route("/api/account", account.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // The account routes render nothing themselves: their own errors and those of the three modules they call all land here.
    if (err instanceof AccountError) {
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
  /** The relying party passkeys are bound to; see WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME in config.ts. */
  webauthn: {
    rpId: string;
    rpName: string;
    /** The origins a ceremony's clientDataJSON may name. */
    origins: string[];
  };
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
    webauthn: {
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      // A passkey ceremony run from a development origin (Expo's dev server, say) is accepted outside production only:
      // in production the web app is served from APP_ORIGIN, and no other origin may use its passkeys.
      origins: config.NODE_ENV === "production" ? [config.APP_ORIGIN] : [config.APP_ORIGIN, ...config.TRUSTED_ORIGINS],
    },
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
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  // The cap of 10; the flow passes its own message, with the hours left, for the bound of 5 a day.
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
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
    /**
     * What the app needs beyond the code, sent as the envelope's `details`: for reauth_required, the level the action
     * asks for and the factor kinds the session proved in time (1c design, section 7.1).
     */
    readonly details?: Record<string, unknown>,
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

### Replace `apps/api/src/auth/flows/email-change.ts` (whole file)

```ts
import type { EmailChangeResponse, EmailChangeStartRequest, EmailChangeVerifyRequest, EmailRevertRequest } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { isDisposableEmail } from "../disposable";
import { emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit, padResponseTime } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, MIN_START_RESPONSE_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { lockdown } from "./lockdown";
import { notifyAccount } from "./notify";

export const EMAIL_CHANGE_STARTS_PER_HOUR = 3;
/** How long the old address can undo a change, as long as the new-device "not me" link works. */
export const EMAIL_REVERT_TTL_MS = 24 * HOUR;
export const EMAIL_REVERTS_PER_IP_PER_HOUR = 10;

/** The undo link is a bearer credential for a day, so the store holds only its hash. */
export const emailRevertKey = (token: string) => `email-revert:${sha256Hex(token)}`;
/** Present while an account's undo link is out; see openRevert. */
export const emailRevertOpenKey = (userId: string) => `email-revert-open:${userId}`;

/** The change a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingEmailChange {
  userId: string;
  email: string;
}

/**
 * What an undo link puts back: the address the account had, when it left it (epoch milliseconds from the
 * flows' clock, the one passwordChangedAt, totpEnabledAt and a passkey's createdAt are written with, so the
 * lockdown at the undo compares like with like), and the passkey behind the session that made the change,
 * which the lockdown removes whatever its age.
 */
export interface PendingEmailRevert {
  userId: string;
  oldEmail: string;
  changedAt: number;
  passkeyId: string | null;
}

const LINK_GONE = "This link has expired or was already used.";

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
 * Every session stays signed in, because the owner just proved a credential. The old address is told,
 * with a link that undoes the change for 24 hours (revertEmailChange): an account without a password
 * signs in only by a code to its address, so once the address is someone else's, the old one could not
 * sign in to change it back.
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
  const changedAt = deps.now();
  try {
    await deps.repo.changeEmail(user.id, pending.email, changedAt);
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
  const revertUrl = await openRevert(deps, { userId: user.id, oldEmail: user.email, changedAt: changedAt.getTime(), passkeyId: session.passkeyId });
  await notifyAccount(deps, user.email, "email_changed", revertUrl === null ? { email: pending.email } : { email: pending.email, revertUrl });
  return { email: pending.email };
}

/**
 * Mints the undo link for a change, or none. One link per account at a time: the first change opens a
 * day in which later changes get no link of their own, and the one link, used, goes back to the address
 * before that first change. A link per change would undo nothing: someone who took the account and
 * changed the address twice would hold the link sent to the address in the middle, one of their own,
 * and could use it after the owner used theirs to move the account back to it.
 */
async function openRevert(deps: AuthDeps, revert: PendingEmailRevert): Promise<string | null> {
  if (!(await deps.kv.setIfAbsent(emailRevertOpenKey(revert.userId), "1", EMAIL_REVERT_TTL_MS))) return null;
  const token = randomToken();
  await deps.kv.set(emailRevertKey(token), JSON.stringify(revert), EMAIL_REVERT_TTL_MS);
  return `${deps.config.appOrigin}/email-revert/${token}`;
}

/**
 * The undo link from the email_changed notice, which needs no session: the link is the credential, and
 * works once. The account goes back to the old address (email_in_use when that address got another
 * account meanwhile), then the lockdown runs anchored at the change (1c design, section 7.6): every
 * session signed out, every device revoked, the password removed, the passkeys added since the day
 * before the change and the one behind the changing session removed, and two-factor set up since then
 * turned off, so whoever made the change keeps no way in. What the owner set up earlier stays, except
 * the password, which nobody can tell from one an attacker set. The address the account was moved to
 * is told nothing; the old one gets a short note.
 */
export async function revertEmailChange(deps: AuthDeps, input: EmailRevertRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `email-revert:ip:${ctx.ipHash}`, EMAIL_REVERTS_PER_IP_PER_HOUR, HOUR);
  // Taken, not read: two requests with the same link cannot both act on it.
  const raw = await deps.kv.take(emailRevertKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const revert = JSON.parse(raw) as PendingEmailRevert;
  // An account deleted since has nothing left to move back.
  const user = await deps.repo.findUserById(revert.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  try {
    await deps.repo.changeEmail(user.id, revert.oldEmail, deps.now());
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  // The lockdown records the undo itself: the event log holds hashes only, never an address.
  const key = deps.config.authHmacKey;
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(revert.changedAt),
    passkeyIds: revert.passkeyId ? [revert.passkeyId] : [],
    caller: { type: "email_changed", metadata: { from: emailHash(key, user.email), to: emailHash(key, revert.oldEmail), reverted: true } },
    ctx,
  });
  // The link is spent, so the next change may send one again.
  await deps.kv.del(emailRevertOpenKey(user.id));
  await notifyAccount(deps, revert.oldEmail, "email_change_reverted");
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
  // The code proved the address just now: the session's email factor, at the flows' clock.
  return firstFactorPassed(deps, user, parsed, ctx, { factors: { email: deps.now().getTime() }, method: "email" });
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
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { newTotpSecret, totpQrSvg, totpUri, verifyTotp } from "../totp";
import { notifyAccount } from "./notify";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type MfaTicket, type SignedIn } from "./signin";

export const TOTP_PENDING_TTL_MS = 10 * MINUTE;
export const MAX_MFA_ATTEMPTS = 5;

/** The pending secret of a setup, kept for the session's handle (1c design, section 2): a rotation keeps the handle, and no other session can confirm it. */
export const totpPendingKey = (handle: string) => `totp-pending:${handle}`;

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

/**
 * Starts setup with a new secret held encrypted for 10 minutes under the session's handle. Needs a fresh session, at
 * level 2 once the account has TOTP, since setup replaces the secret and the recovery codes (the route checks as well).
 */
export async function setupTotp(deps: AuthDeps, session: Session): Promise<TotpSetupResponse> {
  const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session));
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
  const secret = newTotpSecret();
  await deps.kv.set(totpPendingKey(session.handle), encrypt(Buffer.from(secret), deps.config.totpKey), TOTP_PENDING_TTL_MS);
  const profile = await deps.profiles.find(session.userId);
  const otpauthUri = totpUri(secret, profile?.handle ?? "account");
  return { otpauthUri, qrSvg: totpQrSvg(otpauthUri) };
}

/**
 * Turns MFA on with the pending secret its setup stored for this session's handle: no freshness check of its own, so
 * scanning the QR code cannot run the window out. Issues 10 recovery codes (shown once), writes the totp factor (the
 * code proved the new secret), drops every cached copy of the account's sessions so mfaEnabled is right, rotates the
 * token in place and tells the owner.
 */
export async function confirmTotp(deps: AuthDeps, session: Session, input: TotpCodeRequest): Promise<{ recoveryCodes: string[]; issued: IssuedSession }> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const pending = await deps.kv.get(totpPendingKey(session.handle));
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
  await deps.kv.del(totpPendingKey(session.handle));
  await deps.repo.appendEvent({ userId: session.userId, type: "mfa_enabled", deviceId: session.deviceId });
  await deps.sessions.addFactor(session.sessionId, "totp");
  await deps.sessions.forgetUser(session.userId);
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
  let second: FactorKind;
  if ("code" in input) {
    if (!(await acceptTotp(deps, user, input.code))) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "totp" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    second = "totp";
  } else {
    const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
    if (!consumed) {
      await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
      throw new AuthError("invalid_mfa_code", 401);
    }
    mustReenrollMfa = true;
    second = "recovery";
  }

  if (!(await deps.kv.take(key))) throw new AuthError("invalid_mfa_code", 401);
  // The second factor joins the first step's, from the ticket, at this step's clock.
  const signed = await signIn(deps, user, { deviceId: ticket.deviceId, platform: ticket.platform }, ctx, {
    alertNewDevice: true,
    mustReenrollMfa,
    factors: { ...ticket.factors, [second]: deps.now().getTime() },
    method: ticket.method,
    passkeyId: ticket.passkeyId,
  });
  if (second === "recovery") {
    // Recorded with the device the session was issued on, whose row a first sign-in creates only in signIn (the ticket
    // holds the app's device id, not the row), and announced as the re-authentication path announces it: a code spent is
    // one fewer of ten, whichever path spent it.
    await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: signed.issued.session.deviceId, ipHash: ctx.ipHash });
    await notifyAccount(deps, user.email, "recovery_code_used");
  }
  return signed;
}

/**
 * Turns MFA off and tells the owner. No code: the route needs level 2, so a TOTP or recovery code was proven minutes ago
 * (1c design, section 2). Staff accounts can never turn it off.
 */
export async function disableTotp(deps: AuthDeps, session: Session): Promise<void> {
  if (session.role !== "user") throw new AuthError("staff_mfa_required", 403);
  const user = await deps.repo.findUserById(session.userId);
  if (!user?.totpSecretEnc) throw new AuthError("mfa_required", 400);
  await deps.repo.disableTotp(user.id);
  await deps.sessions.forgetUser(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "mfa_disabled", deviceId: session.deviceId });
  await notifyAccount(deps, user.email, "mfa_disabled");
}

/** Replaces all recovery codes (the route requires strong fresh auth) and tells the owner. The old codes stop working. */
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

### Replace `apps/api/src/auth/flows/not-me.ts` (whole file)

```ts
import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { emailHash } from "../identifiers";
import { HOUR, enforceLimit } from "../limits";
import { lockdown } from "./lockdown";
import { NOT_ME_TTL_MS, notMeKey, type NotMeToken } from "./signin";

const LINK_GONE = "This link has expired or was already used.";

/**
 * "This wasn't me" from a new-device email: the lockdown (1c design, section 7.6) anchored at the sign-in the alert
 * announced, naming the passkey that signed in, if one did. The link is taken once, for 24 hours, and does nothing but
 * refuse when the account is gone or its address is no longer the one the alert went to: a link mailed to an attacker's
 * address dies when the owner's is restored. A link from before 1c (no sign-in time, or the bare user id) is anchored
 * at its use minus its 24-hour life, so it removes more, never less, and checks no address.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const raw = await deps.kv.take(notMeKey(input.token));
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link: NotMeToken = raw.startsWith("{") ? (JSON.parse(raw) as NotMeToken) : { userId: raw, deviceId: null };
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== undefined && link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  const anchor = link.signedInAt === undefined ? new Date(deps.now().getTime() - NOT_ME_TTL_MS) : new Date(link.signedInAt);
  await lockdown(deps, { userId: user.id, anchor, passkeyIds: link.passkeyId ? [link.passkeyId] : [], caller: { type: "not_me", deviceId: link.deviceId }, ctx });
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
  return firstFactorPassed(deps, user, { deviceId: input.deviceId, platform: input.platform }, ctx, { factors: { password: deps.now().getTime() }, method: "password" });
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

### Replace `apps/api/src/auth/flows/reauth.ts` (whole file)

```ts
import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { verifyPassword } from "../passwords";
import { hashRecoveryCode } from "../recovery-codes";
import type { FactorKind, IssuedSession, Session } from "../sessions";
import { verifyTotp } from "../totp";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, newEmailCode, sendCode } from "./email";
import { storedSecret } from "./mfa";
import { notifyAccount } from "./notify";

/** What a re-authentication leaves: the level the session holds now, its rotated token, and after a recovery code the call to set MFA up again. */
export interface Reauthenticated {
  level: 1 | 2;
  issued: IssuedSession;
  mustReenrollMfa: boolean;
}

/**
 * Sends a code that can only re-authenticate this account (never sign anyone in). Three an hour per session, counted by
 * the handle: a rotation keeps it, so rotating resets nothing, and no other session of the account can spend it.
 */
export async function startReauthEmail(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<{ flowId: string }> {
  await enforceLimit(deps.kv, `reauth-email:${session.handle}`, 3, HOUR);
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
 * Proves a credential again (1c design, sections 7.1 and 7.2): the factor is written at the flows' clock, so freshness
 * and the level follow from the factors, and the token rotates in place, so a copy of the old token stops working.
 * Five tries per session every 15 minutes, counted at every verification and by the session's handle, and thirty per
 * address; wrong passwords also count towards the lockout.
 */
export async function reauthenticate(deps: AuthDeps, session: Session, input: ReauthRequest, ctx: RequestContext): Promise<Reauthenticated> {
  await enforceLimit(deps.kv, `reauth:${session.handle}`, 5, 15 * MINUTE);
  await enforceLimit(deps.kv, `reauth:ip:${ctx.ipHash}`, 30, 15 * MINUTE);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);

  let kind: FactorKind;
  let mustReenrollMfa = false;
  switch (input.method) {
    case "password": {
      const usable = user.passwordHash !== null && !deps.lockout.isLocked(user);
      const ok = await verifyPassword(usable ? user.passwordHash : null, input.password);
      if (!ok) {
        if (usable) await deps.lockout.recordFailure(user.id);
        throw new AuthError("invalid_credentials", 401);
      }
      await deps.lockout.recordSuccess(user.id);
      kind = "password";
      break;
    }
    case "totp": {
      const secret = await storedSecret(deps, user);
      const step = verifyTotp(secret, input.code, user.totpLastStep, deps.now().getTime());
      if (step === null || !(await deps.repo.claimTotpStep(user.id, step))) throw new AuthError("invalid_mfa_code", 401);
      kind = "totp";
      break;
    }
    case "email": {
      const row = await deps.repo.findEmailCode(input.flowId);
      if (row?.purpose !== "reauth" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
      await checkEmailCode(deps, row, input.flowId, input.code);
      kind = "email";
      break;
    }
    case "recovery": {
      // Only an account with TOTP holds recovery codes, and each works once (1c design, section 7.2).
      if (!user.totpEnabledAt) throw new AuthError("mfa_required", 400);
      const consumed = await deps.repo.consumeRecoveryCodeHash(user.id, hashRecoveryCode(deps.config.authHmacKey, input.recoveryCode));
      if (!consumed) {
        await deps.repo.appendEvent({ userId: user.id, type: "signin_failure", ipHash: ctx.ipHash, metadata: { method: "recovery_code" } });
        throw new AuthError("invalid_mfa_code", 401);
      }
      await deps.repo.appendEvent({ userId: user.id, type: "recovery_code_used", deviceId: session.deviceId, ipHash: ctx.ipHash });
      // A code spent is one fewer of ten; the owner hears of it as of every other change to their credentials.
      await notifyAccount(deps, user.email, "recovery_code_used");
      mustReenrollMfa = true;
      kind = "recovery";
      break;
    }
  }

  await deps.sessions.addFactor(session.sessionId, kind);
  const issued = await deps.sessions.rotate(session);
  return { level: deps.sessions.level(issued.session), issued, mustReenrollMfa };
}
```

### Replace `apps/api/src/auth/flows/signin.ts` (whole file)

```ts
import type { Platform } from "@korbat/contracts";
import type { AuthDeps, RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { deviceLabel } from "../devices";
import { deviceHash, emailHash } from "../identifiers";
import type { DeviceRow, UserRow } from "../repo";
import type { Factors, IssuedSession } from "../sessions";

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

/** How the first factor was proven, recorded on signin_success. */
export type SignInMethod = "email" | "password" | "passkey";

/**
 * What a sign-in proved (1c design, section 7.1): its factors at the flows' clock, the method for the event, and the
 * passkey, when one signed in. The session it issues carries all three.
 */
export interface SignInProof {
  factors: Factors;
  method: SignInMethod;
  passkeyId?: string | null;
}

/** The first step's proof, kept until the MFA step adds its own. */
export interface MfaTicket extends SignInProof {
  userId: string;
  deviceId: string;
  platform: Platform;
}

/**
 * What a "this wasn't me" link acts on: the account, the device the alert was about, the sign-in's time (the lockdown's
 * anchor), the passkey that signed in, if one did, and the keyed hash of the address the alert went to, which the link
 * checks against the account's current address. Links from before 1c carry the first two only, or the bare user id.
 */
export interface NotMeToken {
  userId: string;
  deviceId: string | null;
  signedInAt?: number;
  passkeyId?: string | null;
  sentTo?: string;
}

export const mfaTicketKey = (ticket: string) => `mfa-ticket:${sha256Hex(ticket)}`;
export const notMeKey = (token: string) => `not-me:${sha256Hex(token)}`;

/** Registers or refreshes the device, issues a session holding what was proven, and records the sign-in with its method. */
export async function signIn(
  deps: AuthDeps,
  user: UserRow,
  device: DeviceInput,
  ctx: RequestContext,
  options: SignInProof & { alertNewDevice: boolean; mustReenrollMfa?: boolean },
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
    if (options.alertNewDevice) await alertNewDevice(deps, user, row, ctx, options);
  } else {
    await deps.repo.touchDevice(row.id, ctx.ipHash, deps.now());
  }
  const issued = await deps.sessions.issue(user.id, row.id, { factors: options.factors, passkeyId: options.passkeyId });
  await deps.repo.appendEvent({ userId: user.id, type: "signin_success", deviceId: row.id, ipHash: ctx.ipHash, metadata: { method: options.method } });
  return { kind: "session", issued, platform: device.platform, mustReenrollMfa: options.mustReenrollMfa ?? false };
}

/** After a correct first factor: a session, or an MFA ticket carrying the proof when the account has two-factor on. */
export async function firstFactorPassed(deps: AuthDeps, user: UserRow, device: DeviceInput, ctx: RequestContext, proof: SignInProof): Promise<SignedIn | MfaPending> {
  if (user.totpEnabledAt) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/** Best effort: a failed alert email is logged but does not block the sign-in. */
async function alertNewDevice(deps: AuthDeps, user: UserRow, device: DeviceRow, ctx: RequestContext, proof: SignInProof): Promise<void> {
  const token = randomToken();
  // The sign-in's time from the flows' clock, as the lockdown compares it with the rows' own times.
  const link: NotMeToken = {
    userId: user.id,
    deviceId: device.id,
    signedInAt: deps.now().getTime(),
    passkeyId: proof.passkeyId ?? null,
    sentTo: emailHash(deps.config.authHmacKey, user.email),
  };
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
  // The sign-up code proved the address: the first session's email factor, at the flows' clock.
  return signIn(deps, user, { deviceId: pending.deviceId, platform: pending.platform }, ctx, { alertNewDevice: false, factors: { email: deps.now().getTime() }, method: "email" });
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

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

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
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/middleware.ts` (whole file)

```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { authErrorMessage, type AuthDeps } from "./context";
import { bearerToken, checkCsrf, readSessionCookie, refreshSessionCookies } from "./cookies";
import { SESSION_IDLE_MS, type ReauthNeeded } from "./sessions";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs on every request. Refuses state-changing requests whose Origin is not allowed, resolves the
 * session from a bearer token (native) or the `__Host-` cookie (web), and requires the CSRF token on
 * cookie-authenticated state changes. Sets `session` and `authVia` on the context.
 */
export function resolveSession(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("session", null);
    c.set("authVia", null);
    const stateChanging = !SAFE_METHODS.has(c.req.method);
    const origin = c.req.header("origin");
    if (stateChanging && origin && !deps.config.allowedOrigins.includes(origin)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }

    const bearer = bearerToken(c);
    const token = bearer ?? readSessionCookie(c);
    if (token) {
      const resolved = await deps.sessions.resolve(token);
      if (resolved) {
        if (!bearer && stateChanging && !checkCsrf(c, deps.config.allowedOrigins)) {
          return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
        }
        c.set("session", resolved.session);
        c.set("authVia", bearer ? "bearer" : "cookie");
        if (resolved.slid && !bearer) refreshSessionCookies(c, token, Math.floor(SESSION_IDLE_MS / 1000));
      }
    }
    await next();
  });
}

/** Any signed-in session, including one whose account has not chosen a handle yet. */
export const requireOnboarding = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  await next();
});

/** A signed-in session whose account has finished onboarding. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  if (!session.onboarded) return c.json(errorBody("onboarding_required", authErrorMessage("onboarding_required"), c.get("requestId")), 403);
  await next();
});

/** The refusal both freshness guards answer: the level the route asks for and the factors proven in time, so the app can ask for what is missing. */
const reauthRequired = (c: Context<AppEnv>, needed: ReauthNeeded) => c.json(errorBody("reauth_required", authErrorMessage("reauth_required"), c.get("requestId"), needed), 403);

/** The session proved a factor within the last `maxAgeSeconds` (300, five minutes, by default): level 1. */
export function requireFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, 1, windowMs);
    if (needed) return reauthRequired(c, needed);
    await next();
  });
}

/**
 * Level 2 within the window when the account has TOTP (a second factor beside a first, or a user-verified passkey), and
 * level 1 otherwise: what the routes of the 1c design's section 10 ask for.
 */
export function requireStrongFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session), windowMs);
    if (needed) return reauthRequired(c, needed);
    await next();
  });
}

/** Moderator or admin, with MFA on. Guards every staff route from sub-project 3 onward. */
export const requireStaffMfa = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  if (session.role === "user") return c.json(errorBody("forbidden", "Staff only", c.get("requestId")), 403);
  if (!session.mfaEnabled) return c.json(errorBody("staff_mfa_required", authErrorMessage("staff_mfa_required"), c.get("requestId")), 403);
  await next();
});
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, passkeys, sessions, userRole, users, type Db } from "@korbat/db";

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
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
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

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device and code deleted and the account_deleted event appended. Either all of it
     * lands or none of it does, so a failure leaves a live account with its sessions, never a deleted one with
     * sessions and devices that nothing would remove. Answers the ids of the sessions it revoked, for the cache
     * tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const revoked = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        return revoked;
      });
    },

    /**
     * The rows of step 1 again, for a row marked deleted and not purged yet: a take-down that stopped after the
     * mark, or a session that a sign-in already past its lookup created after it. Nothing for a live or a purged
     * row. The event is not appended again: the confirmation that recorded it is the only one there was.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
        return row ? takeDownRows(tx, userId, now) : [];
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
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

    /** Every device of the user, as revokeDevice revokes one: the next sign-in on any of them counts as a new device. */
    async revokeDevices(userId: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
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
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
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

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
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

    // ------------------------------------------------------------ passkeys

    /**
     * The lockdown's removal (1c design, section 7.6): the user's passkeys created at or after `since`, plus any of theirs
     * the caller names, whatever their age. Answers the ids removed, for the caller's event. A named passkey of another
     * account is not the caller's to remove and stays.
     */
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      const reach = input.ids.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.ids])) : gte(passkeys.createdAt, input.since);
      const rows = await db
        .delete(passkeys)
        .where(and(eq(passkeys.userId, userId), reach))
        .returning({ id: passkeys.id });
      return rows.map((row) => row.id);
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

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, and every code out for the user goes, whatever its purpose, so none can complete a flow for an
 * account that is gone.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  return revoked.map((row) => row.id);
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
  EmailRevertRequest,
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
  TotpDisableRequest,
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
import { revertEmailChange, startEmailChange, verifyEmailChange } from "./flows/email-change";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth } from "./middleware";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);
  // Level 2 on an account with TOTP (1c design, section 10): the routes that replace or remove a credential.
  const strong = requireStrongFreshAuth(deps);

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
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
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

  r.post("/email/change/start", requireSession, strong, validate("json", EmailChangeStartRequest), async (c) =>
    c.json(await startEmailChange(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/email/change/verify", requireSession, fresh, validate("json", EmailChangeVerifyRequest), async (c) =>
    c.json(await verifyEmailChange(deps, currentSession(c), c.req.valid("json"))),
  );

  // The undo link from the email_changed notice: no session, like the not-me link, since the link itself is the credential.
  r.post("/email/revert", validate("json", EmailRevertRequest), async (c) => {
    await revertEmailChange(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

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

  r.post("/password/set", requireSession, strong, validate("json", PasswordSetRequest), async (c) =>
    c.json(rotated(c, await setPassword(deps, currentSession(c), c.req.valid("json")))),
  );

  r.post("/mfa/verify", validate("json", MfaVerifyRequest), async (c) => sessionIssued(c, await verifyMfa(deps, c.req.valid("json"), requestContext(c))));

  r.post("/mfa/totp/setup", requireSession, strong, async (c) => c.json(await setupTotp(deps, currentSession(c))));

  // No freshness check: the pending secret its setup stored for the session is the proof, so scanning the QR code cannot run the window out.
  r.post("/mfa/totp/confirm", requireSession, validate("json", TotpCodeRequest), async (c) => {
    const { recoveryCodes, issued } = await confirmTotp(deps, currentSession(c), c.req.valid("json"));
    return c.json({ recoveryCodes, ...rotated(c, issued) });
  });

  r.post("/mfa/totp/disable", requireSession, strong, validate("json", TotpDisableRequest), async (c) => {
    await disableTotp(deps, currentSession(c));
    return c.body(null, 204);
  });

  r.post("/mfa/recovery-codes/regenerate", requireSession, strong, async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(deps, currentSession(c)) }));

  r.post("/reauth/email/start", requireOnboarding, async (c) => c.json(await startReauthEmail(deps, currentSession(c), requestContext(c))));

  // The level reached and, after a recovery code, the call to set MFA up again; the rotated token as every rotation hands it out.
  r.post("/reauth", requireOnboarding, validate("json", ReauthRequest), async (c) => {
    const { level, issued, mustReenrollMfa } = await reauthenticate(deps, currentSession(c), c.req.valid("json"), requestContext(c));
    return c.json({ level, ...(mustReenrollMfa ? { mustReenrollMfa } : {}), ...rotated(c, issued) });
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

### Replace `apps/api/src/auth/sessions.ts` (whole file)

```ts
import type { Platform, Role, SessionInfo } from "@korbat/contracts";
import { AuthError } from "./context";
import { newSessionToken, sha256Hex } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { ActiveSessionRow, AuthRepo } from "./repo";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * What a session can have proven (1c design, section 2): a first factor at sign-in (an email code, a password, a passkey,
 * or a passkey whose authenticator verified the user), and the second factors the MFA step or a re-authentication adds.
 */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";
/** The factors a session has proven, kind to epoch milliseconds from the flows' clock. */
export type Factors = Partial<Record<FactorKind, number>>;

/** Every kind in one fixed order, so the factors a refusal lists do not depend on how the row stored them. */
const KINDS: readonly FactorKind[] = ["email", "password", "passkey", "passkey_uv", "totp", "recovery"];
/** A first factor on its own is level 1. */
const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
/** A second factor makes level 2 only beside a first one; a user-verified passkey is both at once. */
const SECOND: readonly FactorKind[] = ["totp", "recovery"];

export interface Session {
  /** sha256 of the token; never the token itself. A rotation changes it; `handle` stays. */
  sessionId: string;
  userId: string;
  deviceId: string;
  role: Role;
  onboarded: boolean;
  mfaEnabled: boolean;
  /** The latest of `factors`, as the row keeps it; freshness is read from the factors themselves. */
  reauthAt: Date;
  /** A random id for the session's whole life: the re-authentication limits and the passkey challenges are keyed by it. */
  handle: string;
  factors: Factors;
  /** The passkey that started the session, for the lockdown and the Security list; null after any other sign-in. */
  passkeyId: string | null;
}

/** What a sign-in proved, for the session it issues: its factors and, for a passkey sign-in, the passkey. */
export interface SessionProof {
  factors: Factors;
  passkeyId?: string | null;
}

/**
 * What a reauth_required refusal tells the app: the level the action needs and the factor kinds proven within the
 * window. A type alias, not an interface, so it passes as an AuthError's details as it is.
 */
export type ReauthNeeded = {
  level: 1 | 2;
  have: FactorKind[];
};

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
    handle: row.handle,
    factors: row.factors as Factors,
    passkeyId: row.passkeyId,
  });

  async function forget(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.del(cacheKey(id))));
  }

  /**
   * A tombstone that outlives any cache fill in flight, so a revoked session cannot come back for the cache TTL.
   * Also for sessions revoked in the database by another statement, such as a deletion's take-down.
   */
  async function tombstone(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.set(cacheKey(id), REVOKED, SESSION_CACHE_TTL_MS)));
  }

  /** Drops the cached copy of every live session of the user, after a change to what a session carries. */
  async function forgetUser(userId: string) {
    const rows = await deps.repo.listActiveSessions(userId, now());
    await forget(rows.map((r) => r.id));
  }

  /** A new session holding what its sign-in proved; its reauth time is the latest of those factors. */
  async function issue(userId: string, deviceId: string, proof: SessionProof): Promise<IssuedSession> {
    const t = now();
    const { token, id } = newSessionToken();
    await deps.repo.createSession({
      id,
      userId,
      deviceId,
      now: t,
      expiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.getTime() + SESSION_ABSOLUTE_MS),
      factors: proof.factors,
      passkeyId: proof.passkeyId ?? null,
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

  /**
   * Replaces the token in place (1c design, section 2): only the row's id, the token's hash, changes; its handle,
   * factors, reauth time, passkey, device and expiries stay. The old token stops working at once, so a re-authentication
   * by the owner ends a thief's copy. A session revoked meanwhile gets no replacement.
   */
  async function rotate(current: Session): Promise<IssuedSession> {
    const { token, id } = newSessionToken();
    if (!(await deps.repo.rotateSession(current.sessionId, id))) throw new AuthError("invalid_credentials", 401);
    // The old id may sit in the cache for up to a minute; the tombstone ends the old token now.
    await tombstone([current.sessionId]);
    const row = await deps.repo.findActiveSession(id, now());
    if (!row) throw new AuthError("invalid_credentials", 401);
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /** Records a factor the session just proved, at the flows' clock; the reauth time follows it and the cached copy goes. */
  async function addFactor(sessionId: string, kind: FactorKind): Promise<void> {
    await deps.repo.writeFactor(sessionId, kind, now());
    await forget([sessionId]);
  }

  /** The kinds proven within the window (five minutes by default), in a fixed order; freshness and the level are read from them. */
  function recentFactors(session: Session, windowMs: number = REAUTH_WINDOW_MS): FactorKind[] {
    const t = now().getTime();
    return KINDS.filter((kind) => {
      const at = session.factors[kind];
      return at !== undefined && t - at <= windowMs;
    });
  }

  function isFresh(session: Session, windowMs: number = REAUTH_WINDOW_MS): boolean {
    return recentFactors(session, windowMs).length > 0;
  }

  /** Level 2 when a user-verified passkey, or a second factor beside a first, was proven within the window; level 1 otherwise. */
  function level(session: Session, windowMs: number = REAUTH_WINDOW_MS): 1 | 2 {
    const have = recentFactors(session, windowMs);
    const strong = have.includes("passkey_uv") || (have.some((kind) => SECOND.includes(kind)) && have.some((kind) => FIRST.includes(kind)));
    return strong ? 2 : 1;
  }

  /** The level a sensitive action needs on this account: 2 once it has TOTP, 1 otherwise (1c design, section 2). */
  function requiredLevel(session: Session): 1 | 2 {
    return session.mfaEnabled ? 2 : 1;
  }

  /** Null when the session proved enough within the window; otherwise what the refusal tells the app. */
  function reauthNeeded(session: Session, need: 1 | 2, windowMs: number = REAUTH_WINDOW_MS): ReauthNeeded | null {
    const have = recentFactors(session, windowMs);
    const met = need === 1 ? have.length > 0 : level(session, windowMs) === 2;
    return met ? null : { level: need, have };
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

  return { issue, resolve, revoke, revokeAll, rotate, addFactor, forgetUser, recentFactors, isFresh, level, requiredLevel, reauthNeeded, list, tombstone };
}

export type Sessions = ReturnType<typeof createSessions>;
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
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

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

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
  account,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopJanitor();
  stopPurge();
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
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
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect"
  | "recovery_code_used";

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
      // The link runs the lockdown anchored at this sign-in (1c design, section 7.6): it reaches back a day, so a
      // passkey or two-factor set up just before, from the same stolen session, goes with it.
      return build("New sign-in to your korbat account", [
        `Your account was just signed in from a new device: ${need(data, "deviceLabel")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 24 hours. It signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this sign-in; then you sign in with a code sent to this address: ${need(data, "notMeUrl")}`,
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
    case "email_change_code":
      return build("Confirm your new korbat email address", [
        `Your confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. If you did not ask to move a korbat account to this address, you can ignore this email; nothing changes without the code.",
      ]);
    case "email_changed":
      // The undo link goes with the first change in a day only (flows/email-change.ts); a later change in that day
      // says where the link that works went, because signing in here is no longer possible.
      return build("Your korbat email address changed", [
        `The email address of your korbat account was just changed to ${need(data, "email")}. This address no longer belongs to the account.`,
        "Every session stays signed in. If this was you, there is nothing to do.",
        data.revertUrl
          ? `If this was not you, open this link within 24 hours. It moves the account back to this address, signs out every session, removes the password, and turns off every passkey and two-factor authentication set up since the day before the change; then you sign in with a code sent to this address: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. The password was removed, and every passkey and two-factor authentication set up since the day before the change was turned off; set them up again from Security.",
      ]);
    case "badge_verified":
      return build("Your korbat account is verified", [
        "Your phone number was just confirmed, and your korbat account now shows the verified badge.",
        "korbat keeps only a keyed hash of the number, never the number itself. If this was not you, sign in, open Account, and remove the badge.",
      ]);
    case "badge_removed":
      return build("The verified badge was removed from your korbat account", [
        "The verified badge was just removed from your korbat account, and the phone number behind it was forgotten.",
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your sessions and devices.",
      ]);
    case "delete_account_code":
      return build("Confirm deleting your korbat account", [
        `Someone asked to delete your korbat account. The confirmation code is ${need(data, "code")}.`,
        "It expires in 10 minutes. Deleting the account removes your posts, images and profile for good; nothing happens without the code.",
        "If this was not you, do not enter the code: sign in, open Security, and revoke your other sessions.",
      ]);
    case "account_deleted":
      return build("Your korbat account was deleted", [
        "Your korbat account was deleted as you asked. Your posts, images and profile are gone, and your handle stays reserved so nobody can take it.",
        "This cannot be undone. Thank you for having been part of korbat; you are welcome back with a new account any time.",
      ]);
    case "passkey_added":
      // The link runs the lockdown anchored at the passkey's creation (1c design, section 7.6): it reaches back a day,
      // so a password or two-factor set up just before the passkey, from the same stolen session, goes with it.
      return build("A passkey was added to your korbat account", [
        `A passkey named "${need(data, "name")}" was added to your korbat account from ${need(data, "deviceLabel")} at ${need(data, "time")}.`,
        "If this was you, there is nothing to do.",
        `If this was not you, open this link within 7 days. It removes this passkey, signs out every session, removes your password, and turns off every passkey and two-factor authentication set up since the day before this one was added; then you sign in with a code sent to this address: ${need(data, "removeUrl")}`,
      ]);
    case "passkey_removed":
      return build("A passkey was removed from your korbat account", [
        `The passkey named "${need(data, "name")}" was removed from your korbat account at ${need(data, "time")}. It can no longer sign in.`,
        "If this was you, there is nothing to do. If not, sign in, open Security, and review your passkeys, sessions and devices.",
      ]);
    case "passkey_suspect":
      // A counter that went backwards (1c design, section 2): the signature was right, so someone holds the key, and
      // either the authenticator was cloned or a backup was restored. Only the owner can tell, so the key stays off.
      return build("A passkey on your korbat account was switched off", [
        `A sign-in just used what looks like a copy of your passkey named "${need(data, "name")}", so korbat switched that passkey off. It can no longer sign in.`,
        "Sign in with a code sent to this address, open Security, remove it and add a new one. If you did not try to sign in just now, also review your sessions and devices.",
      ]);
    case "recovery_code_used":
      // A code spent at re-authentication (1c design, section 7.2): each of the ten works once, so the owner should know the count is down.
      return build("A recovery code was used on your korbat account", [
        "A recovery code was just used to confirm it's you on your korbat account. Each code works once; set up two-factor authentication again from Security to get a new set.",
        "If this was not you, sign in, open Security, sign out everywhere and set up two-factor authentication again.",
      ]);
  }
}
```

### Replace `packages/contracts/src/auth.ts` (whole file)

```ts
import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the auth endpoints can put in ErrorEnvelope.error.code. */
export const AuthErrorCode = z.enum([
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "invalid_credentials",
  "mfa_required",
  "invalid_mfa_code",
  "reauth_required",
  "csrf_failed",
  "turnstile_failed",
  "disposable_email",
  "age_requirement",
  "terms_required",
  "handle_taken",
  "handle_invalid",
  "handle_reserved",
  "password_too_short",
  "password_too_long",
  "password_breached",
  "password_check_unavailable",
  "staff_mfa_required",
  "onboarding_required",
  "mail_unavailable",
  "rate_limited",
  "handle_cooldown",
  "email_in_use",
  "phone_in_use",
  "badge_unavailable",
  "verify_unavailable",
  // Passkeys (1c design, sections 8 and 9).
  "passkey_invalid",
  "passkey_unsupported",
  "passkey_limit",
  "passkey_suspended",
  "passkey_not_found",
  "challenge_expired",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

export const Platform = z.enum(["web", "ios", "android"]);
export type Platform = z.infer<typeof Platform>;

export const Role = z.enum(["user", "moderator", "admin"]);
export type Role = z.infer<typeof Role>;

/** Random id created once per app install. The server stores only a keyed hash of it. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** 32 random bytes as base64url without padding: flow ids, MFA tickets, single-use link tokens. */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const EmailCode = z.string().regex(/^\d{6}$/);
export const TotpCode = z.string().regex(/^\d{6}$/);
/**
 * A phone number in E.164 once the spaces, hyphens and parentheses people type are dropped: a plus and
 * 7 to 15 digits, the first not zero. Whether the number exists is the verification provider's call.
 */
export const Phone = z
  .string()
  .trim()
  .max(64)
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{6,14}$/, "phone numbers are written like +447911123456"));
/** The six-digit code the verification provider texts to a phone; the development provider's is 000000. */
export const PhoneCode = z.string().regex(/^\d{6}$/);
export const RecoveryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
/** Handle rules (3-20 of a-z, 0-9, _; reserved names) are enforced by the flow so it can return a specific error code. */
export const HandleInput = z.string().trim().toLowerCase().min(1).max(64);
export const DisplayName = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[^\p{Cc}]+$/u)
  .refine((name) => !FORBIDDEN_FORMAT.test(name), { message: "invisible direction and spacing characters are not allowed" });
export const TurnstileToken = z.string().min(1).max(2048);
/** Length rules (12-128) are enforced by the flow so it can return password_too_short or password_too_long. */
export const PasswordInput = z.string().min(1).max(1024);

/**
 * A new bearer token after the server rotated the session. Present only for native clients; web
 * clients receive fresh cookies instead.
 */
export const RotatedToken = z.string().optional();

// ---------------------------------------------------------------- email entry and sign-up

export const EmailStartRequest = z.object({
  email: Email,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const FlowResponse = z.object({ flowId: OpaqueId });
export type FlowResponse = z.infer<typeof FlowResponse>;

export const EmailVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

/** A session was issued. Native clients get the bearer token in the body; web clients only get cookies. */
export const SessionResult = z.object({
  result: z.literal("session"),
  mustReenrollMfa: z.boolean(),
  token: z.string().optional(),
});
export const MfaRequiredResult = z.object({ result: z.literal("mfa_required"), mfaTicket: OpaqueId });
export const SignupRequiredResult = z.object({ result: z.literal("signup_required") });

export const EmailVerifyResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult, SignupRequiredResult]);
export type EmailVerifyResponse = z.infer<typeof EmailVerifyResponse>;

export const SignInResponse = z.discriminatedUnion("result", [SessionResult, MfaRequiredResult]);
export type SignInResponse = z.infer<typeof SignInResponse>;

export const SignupCompleteRequest = z.object({
  flowId: OpaqueId,
  dateOfBirth: z.iso.date(),
  termsVersion: z.string().min(1).max(64),
});
export type SignupCompleteRequest = z.infer<typeof SignupCompleteRequest>;

export const Profile = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string() });
export type Profile = z.infer<typeof Profile>;

export const OnboardingHandleRequest = z.object({ handle: HandleInput, displayName: DisplayName });
export type OnboardingHandleRequest = z.infer<typeof OnboardingHandleRequest>;

export const OnboardingHandleResponse = z.object({ profile: Profile, token: RotatedToken });
export type OnboardingHandleResponse = z.infer<typeof OnboardingHandleResponse>;

// ---------------------------------------------------------------- password

export const PasswordSigninRequest = z.object({
  email: Email,
  password: PasswordInput,
  turnstileToken: TurnstileToken,
  deviceId: DeviceId,
  platform: Platform,
});
export type PasswordSigninRequest = z.infer<typeof PasswordSigninRequest>;

export const PasswordSetRequest = z.object({ password: PasswordInput });
export type PasswordSetRequest = z.infer<typeof PasswordSetRequest>;

export const PasswordSetResponse = z.object({ token: RotatedToken });
export type PasswordSetResponse = z.infer<typeof PasswordSetResponse>;

// ---------------------------------------------------------------- MFA

export const TotpSetupResponse = z.object({
  otpauthUri: z.string().startsWith("otpauth://totp/"),
  qrSvg: z.string().startsWith("<svg"),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponse>;

export const TotpCodeRequest = z.object({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

/**
 * Turning TOTP off takes no code (1c design, section 2): the route needs a level-2 re-authentication, which already spent
 * the current step. A code a client sends anyway is dropped.
 */
export const TotpDisableRequest = z.object({});
export type TotpDisableRequest = z.infer<typeof TotpDisableRequest>;

export const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10) });
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponse>;

export const TotpConfirmResponse = z.object({ recoveryCodes: z.array(RecoveryCode).length(10), token: RotatedToken });
export type TotpConfirmResponse = z.infer<typeof TotpConfirmResponse>;

/** Exactly one of `code` or `recoveryCode`. */
export const MfaVerifyRequest = z.union([
  z.strictObject({ mfaTicket: OpaqueId, code: TotpCode }),
  z.strictObject({ mfaTicket: OpaqueId, recoveryCode: RecoveryCode }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

// ---------------------------------------------------------------- re-authentication

export const ReauthRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: PasswordInput }),
  z.object({ method: z.literal("totp"), code: TotpCode }),
  z.object({ method: z.literal("email"), flowId: OpaqueId, code: EmailCode }),
  // A recovery code (1c design, section 7.2): only an account with TOTP holds any, and each works once.
  z.object({ method: z.literal("recovery"), recoveryCode: RecoveryCode }),
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

/**
 * What a re-authentication answers (1c design, section 7.2): the level the session holds now (2 when a second factor
 * stands beside a first within the window, or a user-verified passkey does), the rotated token for native clients (web
 * clients get fresh cookies instead), and, after a recovery code, that two-factor authentication should be set up again.
 */
export const ReauthResponse = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  token: RotatedToken,
  mustReenrollMfa: z.boolean().optional(),
});
export type ReauthResponse = z.infer<typeof ReauthResponse>;

// ---------------------------------------------------------------- sessions and account

export const SessionInfo = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  deviceLabel: z.string(),
  platform: Platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const SessionsResponse = z.object({ sessions: z.array(SessionInfo) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;

export const NotMeRequest = z.object({ token: OpaqueId });
export type NotMeRequest = z.infer<typeof NotMeRequest>;

/**
 * The signed-in account's own profile as /me returns it (the profile-editing routes answer the public ProfileView): the public facts
 * plus when the handle last changed (the app shows when the next change is allowed) and whether the
 * verified badge is held.
 */
export const MeProfile = Profile.extend({ handleChangedAt: z.iso.datetime().nullable(), verified: z.boolean() });
export type MeProfile = z.infer<typeof MeProfile>;

export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: Role,
    onboarded: z.boolean(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
  profile: MeProfile.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---------------------------------------------------------------- email change

/** The new address, under the sign-up rules. The flow refuses the current address and disposable ones. */
export const EmailChangeStartRequest = z.object({ email: Email });
export type EmailChangeStartRequest = z.infer<typeof EmailChangeStartRequest>;

export const EmailChangeVerifyRequest = z.object({ flowId: OpaqueId, code: EmailCode });
export type EmailChangeVerifyRequest = z.infer<typeof EmailChangeVerifyRequest>;

/** The address the account now has. */
export const EmailChangeResponse = z.object({ email: z.email() });
export type EmailChangeResponse = z.infer<typeof EmailChangeResponse>;

/**
 * The token from the link the email_changed notice sends to the old address. It is the only credential
 * the undo needs, since a passwordless account cannot sign in at the old address any more.
 */
export const EmailRevertRequest = z.object({ token: OpaqueId });
export type EmailRevertRequest = z.infer<typeof EmailRevertRequest>;

// ---------------------------------------------------------------- verified badge

export const BadgeStartRequest = z.object({ phone: Phone });
export type BadgeStartRequest = z.infer<typeof BadgeStartRequest>;

export const BadgeVerifyRequest = z.object({ flowId: OpaqueId, code: PhoneCode });
export type BadgeVerifyRequest = z.infer<typeof BadgeVerifyRequest>;

export const BadgeVerifyResponse = z.object({ verified: z.literal(true) });
export type BadgeVerifyResponse = z.infer<typeof BadgeVerifyResponse>;

// ---------------------------------------------------------------- account deletion

export const DeleteStartResponse = z.object({ flowId: OpaqueId });
export type DeleteStartResponse = z.infer<typeof DeleteStartResponse>;

/** The emailed code and the account's handle typed by the owner; the flow compares the handle case-insensitively. */
export const DeleteConfirmRequest = z.object({ flowId: OpaqueId, code: EmailCode, handle: HandleInput });
export type DeleteConfirmRequest = z.infer<typeof DeleteConfirmRequest>;
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
packages/contracts test:       Tests  88 passed (88)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  372 passed | 218 skipped (590)
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
Tests  216 passed (216)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/index.ts`
- `apps/api/src/account/routes.ts`
- `apps/api/src/app.ts`
- `apps/api/src/auth/context.ts`
- `apps/api/src/auth/flows/email-change.ts`
- `apps/api/src/auth/flows/email.ts`
- `apps/api/src/auth/flows/lockdown.ts`
- `apps/api/src/auth/flows/mfa.ts`
- `apps/api/src/auth/flows/not-me.ts`
- `apps/api/src/auth/flows/password.ts`
- `apps/api/src/auth/flows/reauth.ts`
- `apps/api/src/auth/flows/signin.ts`
- `apps/api/src/auth/flows/signup.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/middleware.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/sessions.ts`
- `apps/api/src/index.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/test/account/deletion.test.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/auth/email-change.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/auth/lockdown.test.ts`
- `apps/api/test/auth/messages.test.ts`
- `apps/api/test/auth/not-me.test.ts`
- `apps/api/test/auth/sessions.test.ts`
- `apps/api/test/integration/account-deletion.test.ts`
- `apps/api/test/integration/account-export.test.ts`
- `apps/api/test/integration/account-takedown.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/auth-flows-mfa.test.ts`
- `apps/api/test/integration/auth-janitor.test.ts`
- `apps/api/test/integration/auth-lockdown.test.ts`
- `apps/api/test/integration/auth-sessions.test.ts`
- `apps/api/test/integration/cli-grant-role.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-account.test.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-badge.test.ts`
- `apps/api/test/integration/http-deletion.test.ts`
- `apps/api/test/integration/http-e2e.test.ts`
- `apps/api/test/integration/http-profile.test.ts`
- `apps/api/test/integration/http-reauth.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `packages/contracts/src/auth.ts`
- `packages/contracts/test/auth.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): session factors, strong freshness and the lockdown: every sign-in records its factors and method; freshness and the level are read from the factors; the seven credential routes need level 2 on an account with TOTP, and a refusal carries the level and the factors held; every re-authentication rotates the token in place; the re-authentication limits are keyed by the session handle and the IP hash, and a recovery code re-authenticates; TOTP setup is bound to the session handle, confirm needs no freshness of its own and disable takes an empty body; the lockdown routine (sessions, devices, password, passkeys and TOTP from the day before the anchor) stands behind the new-device not-me link and the email-change undo, which check the address the link went to; a used recovery code is mailed to the owner on both paths" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): session factors, strong freshness and the lockdown: every sign-in records its factors and method; freshness and the level are read from the factors; the seven credential routes need level 2 on an account with TOTP, and a refusal carries the level and the factors held; every re-authentication rotates the token in place; the re-authentication limits are keyed by the session handle and the IP hash, and a recovery code re-authenticates; TOTP setup is bound to the session handle, confirm needs no freshness of its own and disable takes an empty body; the lockdown routine (sessions, devices, password, passkeys and TOTP from the day before the anchor) stands behind the new-device not-me link and the email-change undo, which check the address the link went to; a used recovery code is mailed to the owner on both paths`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 50>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
