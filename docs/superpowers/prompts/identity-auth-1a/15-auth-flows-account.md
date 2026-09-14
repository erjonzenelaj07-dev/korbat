# korbat 1a — Task 15 of 21: Re-authentication, account, session management, 'not me' and role grants

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-14 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Sensitive changes need re-authentication by password, TOTP or an emailed code. People can list their sessions, revoke one or all, and sign out. The 'this wasn't me' link signs out everywhere and removes the password. Staff roles change only through a server-side function that also revokes every session of the account.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. Only the exact `pnpm add` commands printed below may change dependencies. Never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(auth): password sign-in with lockout, fail-closed password setting, TOTP setup, MFA sign-in, recovery codes`.
3. The previous task's last API unit run ended with `Tests  78 passed | 42 skipped (120)`.

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

### Create `apps/api/test/integration/auth-flows-account.test.ts`

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
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' signs out every session, removes the password, and works once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const token = randomToken();
    await h.kv.set(notMeKey(token), account.user.id, 60_000);

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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module`

Observed on the dry run:

```text
Error: Cannot find module '../../src/auth/admin' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/auth-flows-account.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/auth/flows/reauth.ts`

```ts
import type { ReauthRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { decrypt, randomToken } from "../crypto";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import { verifyPassword } from "../passwords";
import type { Session } from "../sessions";
import { verifyTotp } from "../totp";
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
      if (!user.totpSecretEnc) throw new AuthError("mfa_required", 400);
      const secret = new Uint8Array(decrypt(user.totpSecretEnc, [deps.config.totpKey]));
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

### Create `apps/api/src/auth/flows/account.ts`

```ts
import type { MeResponse, SessionsResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps } from "../context";
import type { Session } from "../sessions";

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
  const count = await deps.sessions.revokeAll(session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "sessions_revoked_all", deviceId: session.deviceId, metadata: { count } });
  return count;
}

export async function signOut(deps: AuthDeps, session: Session): Promise<void> {
  await deps.sessions.revoke(session.sessionId, session.userId);
  await deps.repo.appendEvent({ userId: session.userId, type: "session_revoked", deviceId: session.deviceId, metadata: { signOut: true } });
}
```

### Create `apps/api/src/auth/flows/not-me.ts`

```ts
import type { NotMeRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { HOUR, enforceLimit } from "../limits";
import { notMeKey } from "./signin";

/**
 * "This wasn't me" from a new-device email: signs out every session and removes the password, so the
 * next sign-in needs the email inbox (and MFA when enabled). The link works once, for 24 hours.
 */
export async function notMe(deps: AuthDeps, input: NotMeRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `not-me:ip:${ctx.ipHash}`, 10, HOUR);
  const userId = await deps.kv.take(notMeKey(input.token));
  if (!userId) throw new AuthError("invalid_code", 400, "This link has expired or was already used.");
  await deps.sessions.revokeAll(userId);
  await deps.repo.setPasswordHash(userId, null, deps.now());
  await deps.repo.appendEvent({ userId, type: "not_me", ipHash: ctx.ipHash });
}
```

### Create `apps/api/src/auth/admin.ts`

```ts
import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session of the account is revoked so the new role (and its MFA requirement) applies at once.
 */
export async function grantRole(
  deps: { repo: AuthRepo; sessions: Sessions },
  email: string,
  role: UserRole,
): Promise<{ userId: string; previousRole: UserRole }> {
  const user = await deps.repo.findUserByEmail(email);
  if (!user) throw new Error(`no account for ${email}`);
  await deps.repo.setRole(user.id, role);
  await deps.sessions.revokeAll(user.id);
  return { userId: user.id, previousRole: user.role };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  78 passed | 49 skipped (127)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  78 passed | 49 skipped (127)
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

- `Tests  49 passed (49)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  49 passed (49)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/auth/admin.ts`
- `apps/api/src/auth/flows/account.ts`
- `apps/api/src/auth/flows/not-me.ts`
- `apps/api/src/auth/flows/reauth.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(auth): re-authentication by password, TOTP or email; account and session management; 'this wasn't me'; role grants" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(auth): re-authentication by password, TOTP or email; account and session management; 'this wasn't me'; role grants`.

## Report format (mandatory)

```text
TASK 15 REPORT
Files written: <count, expected 5>
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
