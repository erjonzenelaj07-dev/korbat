# korbat account lifecycle (1b) — Task 6 of 9: Account deletion: fresh authentication, an emailed code and the typed handle; sessions revoked with tombstones, posts tombstoned with their images deleted, engagement and graph rows gone with their counters, the profile and auth row anonymised, the handle kept reserved; the account-purge job finishes any deletion left half done; the smoke test walks the lifecycle

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend, its API split into modules that talk through narrow interfaces. This task lets an account delete itself: fresh authentication, a code mailed to the account's own address and the handle typed by the owner. The auth module takes the account down at once (every session revoked with tombstones, devices and codes gone, the row marked deleted, so sign-in treats the address as unknown); the account module's purge then tombstones the posts with their images deleted from the store, removes likes, reposts, bookmarks, follows, blocks and mutes with every counter, anonymises the profile and the auth row and keeps the handle reserved. The `account-purge` job finishes within five minutes any deletion the request left half done, and the smoke test walks the whole lifecycle against the stack. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 5, 6, 7.6, 8, 10 and 11.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(account): a new account module streams a ZIP export of the account (export.json with the account, profile, posts, engagement, graph, sessions, devices and security events, and every uploaded image next to it) once a day behind fresh authentication; fflate 0.8.3 writes the archive entry by entry with back-pressure, and the auth, social and media modules expose their export reads through the account interfaces; the bundle's require shim is aliased so fflate's own createRequire import cannot clash with it`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/06-account-deletion.md 1
```

Expected: 8 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/account/deletion.test.ts`

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
 * social fake keeps which profiles were purged and can be told to fail once for an account; the media
 * fake holds image ids per owner and hands them out once. Every call is logged in order, and the
 * transaction the social purge opens is a sentinel the media fake must be handed.
 */
function harness() {
  let t = T0;
  const calls: string[] = [];
  const lines: LogLine[] = [];
  const users = new Map<string, { deletedAt: Date | null; purgedAt: Date | null }>();
  const purgedProfiles = new Map<string, Date>();
  const failing = new Set<string>();
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
        await within(tx);
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
    const session: Session = { sessionId: sha256Hex(randomToken()), userId, deviceId: randomUUID(), role: "user", onboarded: true, mfaEnabled: false, reauthAt: new Date(t) };
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

  test("confirming runs the auth confirmation, then the social purge with the media detach inside its transaction, then the file deletions, then the auth purge, in that order", async () => {
    const h = harness();
    const [imageA, imageB] = [randomUUID(), randomUUID()];
    const ada = h.account({ images: [imageA, imageB] });
    await confirmDeletion(h.deps, ada.session, { flowId: "f", code: "123456", handle: "Ada" });
    expect(h.calls).toEqual(["auth.confirmDeletion", "social.purgeProfile", "media.purgeOwner", "media.requestDeletion(2)", "auth.finishPurge"]);
    // The image rows go in the social purge's own transaction; their files are asked for afterwards, by id.
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
    expect(h.calls).toEqual(["social.purgeProfile", "media.purgeOwner", "media.requestDeletion(0)", "auth.finishPurge"]);
    expect(h.requested).toEqual([[expect.any(String)], []]);
    expect({ ...h.users.get(ada.userId)!, profilePurgedAt: h.purgedProfiles.get(ada.userId) }).toEqual(first);
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

### Create `apps/api/test/auth/deletion.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { DELETE_STARTS_PER_HOUR, confirmDeletion, startDeletion } from "../../src/auth/flows/deletion";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey, startEmail } from "../../src/auth/flows/email";
import { passwordSignIn } from "../../src/auth/flows/password";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashPassword } from "../../src/auth/passwords";
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

/** Starts a deletion and returns its flow id with the code from the mail to the account's address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startDeletion(h.deps, session, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

describe("account deletion: the start step", () => {
  test("mails a code to the account's own address, keeps the pending deletion under the hashed flow id, and changes nothing else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId } = await startDeletion(h.deps, ada.session, h.ctx);
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([["ada@korbat.local", "delete_account_code", ["code"]]]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([["ada@korbat.local", "delete_account", ada.user.id, h.ctx.ipHash, expiresAt, 0]]);
    expect(JSON.parse((await h.kv.get(flowKey(flowId)))!)).toEqual({ userId: ada.user.id });
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < DELETE_STARTS_PER_HOUR; i++) await startDeletion(h.deps, ada.session, h.ctx);
    const refused = await failure(startDeletion(h.deps, ada.session, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(DELETE_STARTS_PER_HOUR);
    expect(await h.kv.get(`rl:delete-start:${ada.user.id}`)).toBe(String(DELETE_STARTS_PER_HOUR + 1));
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startDeletion(h.deps, bob.session, h.ctx);
    h.advance(HOUR + 1);
    await startDeletion(h.deps, ada.session, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["ada@korbat.local", "ada@korbat.local", "ada@korbat.local", "bob@korbat.local", "ada@korbat.local"]);
  });
});

describe("account deletion: the confirmation", () => {
  test("the typed handle must be the account's own, in any case, and is checked before the code, so a slip costs no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local", "ada_l");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const mismatch = await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada_" }));
    expect(mismatch).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events).toEqual([]);
    // The handle compares case-insensitively: what the owner types may differ in case from what they chose.
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ADA_L" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a wrong code is invalid_code and counts an attempt; another account's flow, an unknown flow and an expired code are refused; five wrong codes exhaust it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    // A flow another account started is no code at all for this one, settled before an attempt is counted.
    expect(await failure(confirmDeletion(h.deps, bob.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: randomToken(), code, handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "too_many_attempts", status: 429 });

    const again = await start(h, ada.session, "ada@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" }))).toMatchObject({ code: "code_expired", status: 400 });

    for (const user of [ada, bob]) expect(h.users.get(user.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "delete_account_code"]);
    expect(h.events).toEqual([]);
  });

  test("tells the address, marks the account deleted, revokes every session with a tombstone, deletes devices and codes, records the event, and spends the code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    // A sign-in code out for ada, and one for bob: the account's codes go, nobody else's.
    for (const user of [ada, bob]) {
      await h.deps.repo.createEmailCode({ flowId: randomToken(), email: user.user.email, userId: user.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    }
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.advance(1000);
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });

    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([
      ["ada@korbat.local", "delete_account_code"],
      ["ada@korbat.local", "account_deleted"],
    ]);
    const stored = h.users.get(ada.user.id)!;
    expect(stored.deletedAt).toEqual(h.now());
    // The row is anonymised by the purge, not here: the address and the credentials are still in place for the moment.
    expect([stored.email, stored.purgedAt]).toEqual(["ada@korbat.local", null]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes.map((c) => [c.userId, c.purpose])).toEqual([[bob.user.id, "login"]]);
    expect(h.events).toEqual([{ userId: ada.user.id, type: "account_deleted", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // The account is gone for every purpose: the same session cannot confirm again, whatever it sends.
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await failure(startDeletion(h.deps, ada.session, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
  });

  test("the notice is best effort: a mail failure does not stop the deletion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.mailer.failing = true;
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
  });
});

describe("a deleted account is invisible to sign-in", () => {
  test("the sign-in start treats the address as unknown, in the same shape and time; password sign-in is invalid_credentials and records no failure", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const password = "correct horse battery staple";
    h.users.get(ada.user.id)!.passwordHash = await hashPassword(password);
    const device = { deviceId: randomToken(), platform: "web" as const };

    // While the account lives: the start sends a sign-in code, and a wrong password is a recorded failure.
    await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code"]);
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password: "not it", turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);

    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);

    // Past the address's cooldown: the start now answers as for an address without an account, in the same shape and time.
    h.advance(MINUTE + 1);
    const startedAt = Date.now();
    const started = await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect(h.codes.map((c) => [c.purpose, c.userId])).toEqual([["signup", null]]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code", "delete_account_code", "account_deleted", "sign_up_code"]);
    // The right password no longer signs in, and the failure counter and the event log do not move: there is no account to record against.
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password, turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);
  });
});
```

### Create `apps/api/test/integration/account-deletion.test.ts`

```ts
import { randomBytes } from "node:crypto";
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
    media: {
      purgeOwner: (tx, ownerId) => m.deps.repo.purgeOwner(tx, ownerId),
      requestDeletion: (ids) => m.files.requestDeletion(ids),
      exportImages: async (ownerId) => (await m.deps.repo.readyImages(ownerId)).map((id) => ({ id, path: m.files.store.image(id, "large") })),
    },
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
    const other = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false });
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

### Create `apps/api/test/integration/http-deletion.test.ts`

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
  /** Puts the session's last proof of a credential ten minutes back, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.setReauth(sessionIdOf(b), new Date(Date.now() - 10 * 60_000));
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

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, mediaEntry, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import type { AuthEventType } from "../../src/auth";
import { MemoryStore } from "../../src/middleware/rate-limit";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
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
    bytes: (): Uint8Array => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/** Every entry of the central directory with its compression method (0 stored, 8 deflated), in archive order. */
function centralDirectory(archive: Uint8Array): [string, number][] {
  const bytes = Buffer.from(archive);
  const entries: [string, number][] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    entries.push([bytes.toString("utf8", i + 46, i + 46 + nameLength), bytes.readUInt16LE(i + 10)]);
  }
  return entries;
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions,
 * one device and two events; a profile with a post carrying two images and a deleted reply, one
 * like, one bookmark, a follow, a block and a mute; and whatever images the test puts in `images`.
 */
function harness() {
  let t = T0;
  const images: { id: string; path: string }[] = [];
  const userId = randomUUID();
  const currentSession = randomBytes(32).toString("hex");
  const otherSession = randomBytes(32).toString("hex");
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: async (id) => ({
        account: { id, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
        sessions: [
          { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
          { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
        ],
        devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
        events: [
          { type: "signin_success", at: new Date(T0 - DAY_MS) },
          { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
        ],
      }),
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async () => ({
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
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
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    limits: new MemoryStore(() => t),
    log: pino({ level: "silent" }),
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
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(plan.json);
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
    h.images.push({ id: randomUUID(), path: path.join(root, "a") }, { id: randomUUID(), path: path.join(root, "b") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
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
    h.images.push({ id: h.imageA, path: fileOf(bytesA) }, { id: h.imageB, path: fileOf(bytesB) });
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
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.posts[0]!.media.map((m) => m.file)).toEqual([`media/${h.imageA}.webp`, `media/${h.imageB}.webp`]);
    expect(json.missingMedia).toEqual([]);
    expect(centralDirectory(sink.bytes())).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, path: fileOf(bytesA) }, { id: h.imageB, path: path.join(root, randomUUID(), "large.webp") });
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
    expect(plan.json.missingMedia).toEqual([h.imageB]);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON deflated with two-space indentation, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const file = fileOf(stored);
    const first = { kind: "first", filler: "x".repeat(2_000) };
    const last = { kind: "last" };
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJson("first.json", first);
    expect(await writer.addFile("files/stored.bin", file)).toBe(true);
    await writer.addJson("last.json", last);
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(JSON.stringify(first, null, 2));
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe(JSON.stringify(last, null, 2));
    expect(centralDirectory(sink.bytes())).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    expect(sink.overlapped).toBe(false);
  });

  test("a file that cannot be opened adds nothing and answers false; a directory in its place counts as no file", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", path.join(root, randomUUID(), "missing.webp"))).toBe(false);
    expect(await writer.addFile("dir.bin", dir)).toBe(false);
    await writer.addJson("only.json", { ok: true });
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["only.json"]);
    expect(centralDirectory(sink.bytes())).toEqual([["only.json", 8]]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
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

/** A session or a device of a user, as the deletion flow revokes and removes them. */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

export interface RecordedDevice {
  id: string;
  userId: string;
}

/**
 * The auth flows without a database: users, email codes, sessions and devices live in memory, and the
 * repository fake holds only the methods the email-change, badge and deletion flows call (and the
 * lookups the sign-in starts make), checked against the real signatures. The key-value store and the
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
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
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
    async deleteDevices(userId: string): Promise<void> {
      for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    },
    async deleteEmailCodes(userId: string): Promise<void> {
      for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
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
    | "setPhoneHash"
    | "appendEvent"
    | "revokeAllSessions"
    | "markDeleted"
    | "deleteDevices"
    | "deleteEmailCodes"
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
  /** A live session on a device of its own, both recorded as the deletion flow will find them; its reauth time is now, as behind requireFreshAuth. */
  const session = (userId: string): Session => {
    const s: Session = { sessionId: sha256Hex(randomToken()), userId, deviceId: randomUUID(), role: "user", onboarded: true, mfaEnabled: false, reauthAt: now() };
    sessions.push({ id: s.sessionId, userId, revokedAt: null });
    devices.push({ id: s.deviceId, userId });
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
    verified,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
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
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/integration/account-export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { exportAccount } from "../../src/auth/flows/export";
import { signIn } from "../../src/auth/flows/signin";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError } from "../../src/social/context";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost } from "../../src/social/flows/posts";
import { TEST_TERMS, flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
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
    social: { purgeProfile: notHere, exportProfile: (userId) => exportProfile(s.deps, userId) },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async (ownerId) => (await m.deps.repo.readyImages(ownerId)).map((id) => ({ id, path: m.files.store.image(id, "large") })) },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

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
    const second = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false });
    const revoked = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false });
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

- `Tests  `
- `failed`

Observed on the dry run:

```text
Test Files  3 failed | 32 passed | 28 skipped (63)
Tests  232 passed | 181 skipped (413)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/06-account-deletion.md 3
```

Expected: 13 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/account/flows/deletion.ts`

```ts
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { RequestContext, Session } from "../../auth";
import type { AccountDeps } from "../context";

/** The code goes to the account's own address; that is the auth module's alone (1b design, section 7.6). */
export function startDeletion(deps: AccountDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  return deps.auth.startDeletion(session, ctx);
}

/**
 * Steps 2 to 4 of section 7.6, for an account the auth module has marked deleted: the social purge,
 * with the image rows detached inside its transaction; the file deletions, once that transaction
 * committed, because files cannot be rolled back; then the auth row's anonymisation. Every step
 * changes only what is still there, so the purge can run again after a failure, from the request or
 * from the job, and finish what an earlier run left.
 */
export async function purge(deps: AccountDeps, userId: string): Promise<void> {
  let images: string[] = [];
  await deps.social.purgeProfile(userId, deps.now(), async (tx) => {
    images = await deps.media.purgeOwner(tx, userId);
  });
  await deps.media.requestDeletion(images);
  await deps.auth.finishPurge(userId);
}

/**
 * The auth module checks the handle and the code and takes the account down (step 1); from there the
 * account is gone whatever happens next. The purge runs here so the owner's request answers only once
 * their posts and images are gone (seconds, for a large account). Should it fail, the failure is logged
 * and the request still succeeds: the purge job finishes any deletion left half done within five minutes.
 */
export async function confirmDeletion(deps: AccountDeps, session: Session, input: DeleteConfirmRequest): Promise<void> {
  await deps.auth.confirmDeletion(session, input);
  try {
    await purge(deps, session.userId);
  } catch (err) {
    deps.log.error({ err, userId: session.userId }, "account deletion: the purge failed after the confirmation; the purge job will finish it");
  }
}
```

### Create `apps/api/src/account/purge.ts`

```ts
import { createJob, type JobLock } from "../lib/jobs";
import type { AccountDeps } from "./context";
import { purge } from "./flows/deletion";

/** How often the job looks for deletions left half done (1b design, section 11): nothing stays behind for longer than this. */
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;

export interface PurgeReport {
  purged: number;
  failed: number;
}

/**
 * One round: every account the auth module reports as deleted but not purged is run through the
 * purge, oldest deletion first. A failure is logged with the account and counted; the account stays
 * pending and is tried again next round. A plain function, so tests call it directly.
 */
export async function purgePending(deps: AccountDeps): Promise<PurgeReport> {
  const report: PurgeReport = { purged: 0, failed: 0 };
  for (const userId of await deps.auth.pendingPurges()) {
    try {
      await purge(deps, userId);
      report.purged++;
    } catch (err) {
      report.failed++;
      deps.log.error({ err, userId }, "account purge: the account could not be purged; it stays pending for the next round");
    }
  }
  // As the janitor: a round that did something is logged with its counts, an idle one is not.
  if (report.purged > 0 || report.failed > 0) deps.log.info(report, "account purge: round finished");
  return report;
}

/** Runs the round every five minutes under the shared lock job:account-purge, one instance at a time. */
export function createPurgeJob(deps: AccountDeps, lock: JobLock) {
  return createJob({ name: "account-purge", intervalMs: PURGE_INTERVAL_MS, lockTtlMs: PURGE_INTERVAL_MS, lock, log: deps.log, run: () => purgePending(deps) });
}
```

### Create `apps/api/src/auth/flows/deletion.ts`

```ts
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, enforceLimit } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { notifyAccount } from "./notify";

export const DELETE_STARTS_PER_HOUR = 3;

/** The deletion a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingDeletion {
  userId: string;
}

/**
 * Mails the deletion code to the account's own address (1b design, section 7.6): the second of the
 * three guards, after the fresh session the route demands and before the handle the owner types. The
 * code row carries the owner, so no other account can spend it.
 */
export async function startDeletion(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await enforceLimit(deps.kv, `delete-start:${user.id}`, DELETE_STARTS_PER_HOUR, HOUR);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "delete_account",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  const pending: PendingDeletion = { userId: user.id };
  await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  await sendCode(deps, { to: user.email, template: "delete_account_code", data: { code } });
  return { flowId };
}

/**
 * The auth side of a deletion, step 1 of section 7.6: the typed handle must be the account's own,
 * then the code must be right; then the account is told, marked deleted (every lookup treats the row
 * as absent from here, so no request can succeed against it while the purge runs), every session is
 * revoked with a tombstone so the cache cannot revive one, its devices and codes go, and the event is
 * recorded. The row itself is anonymised by finishPurge, once the account module has purged the
 * other schemas.
 */
export async function confirmDeletion(deps: AuthDeps, session: Session, input: DeleteConfirmRequest): Promise<void> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  // The handle is the third guard, compared in any case and checked before the code, so a slip of the fingers costs no attempt on it.
  const profile = await deps.profiles.find(user.id);
  if (!profile || profile.handle.toLowerCase() !== input.handle.toLowerCase()) throw new AuthError("invalid_request", 400, "handle_mismatch");
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's deletion, or from any other flow, is no code at all, settled before an attempt is counted.
  if (row?.purpose !== "delete_account" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  if (!(await deps.kv.take(flowKey(input.flowId)))) throw new AuthError("code_expired", 400);

  // Told first, while the address still belongs to the account; best effort, since no mail failure may keep an account its owner has given up.
  await notifyAccount(deps, user.email, "account_deleted");
  await deps.repo.markDeleted(user.id, deps.now());
  await deps.sessions.revokeAll(user.id);
  // The devices go after the revocation: their session rows go with them by cascade, and the tombstones must be written by then.
  await deps.repo.deleteDevices(user.id);
  await deps.repo.deleteEmailCodes(user.id);
  await deps.repo.appendEvent({ userId: user.id, type: "account_deleted", deviceId: session.deviceId });
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
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which every account route needs. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
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
    routes: accountRoutes(deps, options.requireSession, options.requireFreshAuth),
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
import { stream } from "hono/streaming";
import { clearSessionCookies, type RequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { AccountDeps } from "./context";
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { buildExport, enforceExportLimit, exportFilename, writeExport } from "./flows/export";
import { createZipWriter } from "./zip";

/**
 * The account endpoints, mounted at /api/account. `guard` is the auth module's requireSession: an
 * onboarded account, with CSRF and Origin already checked for cookie sessions. `fresh` is its
 * requireFreshAuth: a credential proven in the last five minutes, which every route here needs on top
 * (1b design, section 10). Errors are the app's to render: AccountError and those of the three modules.
 */
export function accountRoutes(deps: AccountDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** What the auth flows record about a request, as the auth routes build it: the hashed address, never the address. */
  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });

  r.post("/delete/start", guard, fresh, async (c) => c.json(await startDeletion(deps, c.get("session")!, requestContext(c))));

  r.post("/delete/confirm", guard, fresh, validate("json", DeleteConfirmRequest), async (c) => {
    await confirmDeletion(deps, c.get("session")!, c.req.valid("json"));
    // The session behind a web request's cookies is revoked; the browser is told to drop them so it does not keep sending a dead token.
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/export", guard, fresh, async (c) => {
    const session = c.get("session")!;
    // Taken before anything is built or streamed: a stream that fails midway still counts.
    await enforceExportLimit(deps, session.userId);
    const now = deps.now();
    // Built in memory before the first byte goes out, so a failing query is an error response, not a broken download.
    const plan = await buildExport(deps, session.userId, session.sessionId, now);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${exportFilename(plan.json.profile.handle, now)}"`);
    // The archive holds the account's email address; nothing on the way may keep a copy.
    c.header("Cache-Control", "no-store");
    return stream(
      c,
      async (body) => {
        // Hono's write swallows a closed connection; the abort flag is what says the client went away, and then reading on is waste.
        const writer = createZipWriter(async (chunk) => {
          if (body.aborted) throw new Error("the client closed the connection");
          await body.write(chunk);
        });
        await writeExport(writer, plan);
        // After the last chunk: an archive the client did not receive in full is no export.
        await deps.auth.appendEvent(session.userId, "export_created");
      },
      async (err, body) => {
        // The status went out with the first chunk; a failed stream can only be ended and noted here.
        if (body.aborted) c.get("log").warn({ userId: session.userId }, "account export: the client left before the archive was complete");
        else c.get("log").error({ err, userId: session.userId }, "account export: the archive could not be completed");
      },
    );
  });

  return r;
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
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, resolveSession } from "./middleware";
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
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Anonymises the auth row and marks it purged; a no-op when it already is. */
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
    finishPurge: (userId) => repo.finishPurge(userId, now()),
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
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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

    // ------------------------------------------------------------ deletion

    /** The owner confirmed deletion: from now on every lookup above treats the row as absent. Once only; a later call changes nothing. */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /** Every device of the user, and by cascade every session row. The sessions are revoked and tombstoned first, so the cache cannot revive one. */
    async deleteDevices(userId: string): Promise<void> {
      await db.delete(devices).where(eq(devices.userId, userId));
    },

    /** Every code out for the user, whatever its purpose: none may complete a flow for an account that is gone. */
    async deleteEmailCodes(userId: string): Promise<void> {
      await db.delete(emailCodes).where(eq(emailCodes.userId, userId));
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

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
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

export type AuthRepo = ReturnType<typeof createAuthRepo>;
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

### Replace `apps/api/src/media/index.ts` (whole file)

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";
export type { SweepReport } from "./sweeper";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account's images, and the data export. */
export interface MediaForAccount {
  /** Removes every image row of the owner, on a post or not, whatever its state, inside the account purge's transaction; the ids name the files to delete afterwards. */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /** Asks the worker to delete the files of these images, once the transaction committed: files cannot be rolled back. */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /** The account's ready images, on a post or not, each with the absolute path of its large variant in the store; the account module reads the files itself. */
  exportImages(ownerId: string): Promise<{ id: string; path: string }[]>;
}

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  /** See MEDIA_RECONCILE; defaults to `on`. */
  reconcile?: "on" | "off" | "force";
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    reconcileMode: options.reconcile ?? "on",
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  const forAccount: MediaForAccount = {
    purgeOwner: (tx, ownerId) => deps.repo.purgeOwner(tx, ownerId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    exportImages: async (ownerId) => (await deps.repo.readyImages(ownerId)).map((id) => ({ id, path: deps.files.store.image(id, "large") })),
  };
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** The interface the account module uses. */
    forAccount,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the shared job lock, and returns the function that stops it. */
    startSweeper: (lock: JobLock) => createSweeper(deps, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { mediaPath, type MediaView } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { MediaError } from "./context";

/** Every SQL statement on post_media lives in this module's repository, on the korbat_api pool. */

export interface MediaRow {
  id: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  postId: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: Date;
}

const columns = {
  id: postMedia.id,
  ownerId: postMedia.ownerId,
  status: postMedia.status,
  error: postMedia.error,
  postId: postMedia.postId,
  width: postMedia.width,
  height: postMedia.height,
  blurhash: postMedia.blurhash,
  createdAt: postMedia.createdAt,
};

export function createMediaRepo(db: Db) {
  return {
    /** When the account was onboarded, which decides its upload tier. */
    async accountCreatedAt(userId: string): Promise<Date | null> {
      const rows = await db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return rows[0]?.createdAt ?? null;
    },

    /** Uploads of this account that are not on a post yet and did not fail. */
    async pendingCount(ownerId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"])));
      return rows[0]?.count ?? 0;
    },

    async insertProcessing(input: { id: string; ownerId: string; now: Date }): Promise<void> {
      await db.insert(postMedia).values({ id: input.id, ownerId: input.ownerId, status: "processing", createdAt: input.now });
    },

    async find(id: string): Promise<MediaRow | null> {
      const rows = await db.select(columns).from(postMedia).where(eq(postMedia.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Records the worker's verdict, once. A row that is no longer processing is left as it is. */
    async finalize(id: string, result: ResultFile): Promise<boolean> {
      const values = result.status === "ready" ? { status: "ready" as const, width: result.width, height: result.height, blurhash: result.blurhash } : { status: "failed" as const, error: result.reason };
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** Removes an upload of this account that is not on a post. */
    async deleteUnattached(id: string, ownerId: string): Promise<boolean> {
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** What serving an image file depends on: whether it is ready, and its post's state and author. */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; postState: string | null; authorId: string | null } | null> {
      const rows = await db
        .select({ status: postMedia.status, postState: posts.state, authorId: posts.authorId })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        const rows = await tx
          .update(postMedia)
          .set({ postId: input.postId, position, altText: item.alt })
          .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready")))
          .returning({ id: postMedia.id });
        if (rows.length !== 1) throw new MediaError("media_unavailable", 400);
      }
    },

    /** Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.postId, postId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /**
     * Removes every image row of the owner, on a post or not, whatever its state, inside the transaction
     * that purges the account, and says which files to delete afterwards (1b design, section 7.6).
     */
    async purgeOwner(tx: DbTx, ownerId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.ownerId, ownerId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** The images of a page of posts, in one query, in their order on each post. */
    async forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>> {
      const byPost = new Map<string, MediaView[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText })
        .from(postMedia)
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready")))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId || row.width === null || row.height === null || row.blurhash === null) continue;
        const view: MediaView = { id: row.id, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), view]);
      }
      return byPost;
    },

    /** Every ready image of the account, on a post or not, oldest first: the images the data export takes files for. */
    async readyImages(ownerId: string): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), eq(postMedia.status, "ready")))
        .orderBy(postMedia.createdAt, postMedia.id);
      return rows.map((row) => row.id);
    },

    /** Uploads that still wait for the worker's verdict. */
    async processingIds(): Promise<string[]> {
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(eq(postMedia.status, "processing")).orderBy(postMedia.createdAt);
      return rows.map((row) => row.id);
    },

    /** Fails uploads the worker has not answered since `before`, and says which. */
    async failStale(before: Date): Promise<string[]> {
      const rows = await db
        .update(postMedia)
        .set({ status: "failed", error: "processing_failed" })
        .where(and(eq(postMedia.status, "processing"), lt(postMedia.createdAt, before)))
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Removes uploads made before `before` that were never put on a post, whatever their state, and says which. */
    async deleteUnattachedBefore(before: Date): Promise<string[]> {
      const rows = await db.delete(postMedia).where(and(isNull(postMedia.postId), lt(postMedia.createdAt, before))).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Which of these ids have a row. */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(inArray(postMedia.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, for the
   * media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /** The profile, its posts with their images, its engagement and its side of the graph. */
  exportProfile(userId: string): Promise<ProfileExport>;
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId) => exportProfile(deps, userId),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
  };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
import type { Cursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/** Everything the account owns in this module, for the data export, before its posts get their images from the media module. */
export interface ProfileExportRows {
  profile: ProfileRow;
  /** Every handle in handle_history for this profile, in the order they were recorded. */
  handleHistory: string[];
  posts: ExportedPostRow[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. `within` runs in the same transaction. */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /** `other` is the post's author when that is someone else: the pair is locked and a block refused inside the transaction. */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
      return inserted.length > 0;
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /** With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a concurrent block. */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
      return inserted.length > 0;
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * Everything the account owns in this module, for the data export: its live profile row and handle
     * history, every post it wrote whatever its state, what it liked, reposted and bookmarked, and the
     * accounts it follows, blocks and mutes by their current handle (a deleted account keeps its handle).
     * Null when there is no live profile. The images of the posts belong to the media module; the flow
     * adds them. The table and column names below are fixed literals of this file, never input.
     */
    async exportProfile(id: string): Promise<ProfileExportRows | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const refs = async (table: "likes" | "reposts" | "bookmarks"): Promise<PostRefRow[]> =>
        (await rows<{ post_id: string; at: string }>(sql`select post_id, ${iso("created_at")} as at from ${sql.raw(table)} where user_id = ${id}::uuid order by created_at, post_id`)).map((row) => ({
          postId: row.post_id,
          at: new Date(row.at),
        }));
      const handles = async (table: "follows" | "blocks" | "mutes", from: string, to: string): Promise<HandleRefRow[]> =>
        (
          await rows<{ handle: string; since: string }>(sql`
            select p.handle, ${iso("r.created_at")} as since from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to)}
            where r.${sql.raw(from)} = ${id}::uuid order by r.created_at, r.${sql.raw(to)}`)
        ).map((row) => ({ handle: row.handle, since: new Date(row.since) }));
      const [history, authored, likes, reposts, bookmarks, following, blocks, mutes] = await Promise.all([
        rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`),
        rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null }>(sql`
          select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at
          from posts where author_id = ${id}::uuid order by created_at, id`),
        refs("likes"),
        refs("reposts"),
        refs("bookmarks"),
        handles("follows", "follower_id", "followee_id"),
        handles("blocks", "blocker_id", "blocked_id"),
        handles("mutes", "muter_id", "muted_id"),
      ]);
      return {
        profile: toProfile(r),
        handleHistory: history.map((row) => row.handle_lower),
        posts: authored.map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: new Date(row.created_at),
          replyToId: row.reply_to_id,
          quoteOfId: row.quote_of_id,
          state: row.state,
          deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        })),
        likes,
        reposts,
        bookmarks,
        following,
        blocks,
        mutes,
      };
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        await within(tx);
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 3. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 4. /api/me answers for it.
 * 5. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 6. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, and large.webp is served to anyone as a fresh WebP without metadata.
 * 7. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 8. Deleting the post stops the image being served, and its folder leaves the store.
 * 9. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 10. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 11. The grant-role CLI makes it a moderator, and its session stops working.
 * 12. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, downloads its export as a ZIP, posts, and
 *     deletes itself with a code read from Mailpit and its handle typed; afterwards its profile is not
 *     found, its session is gone, and its post has left the Latest timeline.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit. Makes its images with the sharp the worker uses. Tries a Turnstile refusal again for up to a
 * minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 \
 *     --terms draft-2026-09 [--worst-case] -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
if (!base || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --mailpit <url> --terms <version> [--worst-case] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (result.body?.error?.code === "turnstile_failed" && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === "public, max-age=300", served);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const after = await send(large);
  check("its image is no longer served", after.status === 404, `HTTP ${after.status}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session.
 */
async function accountLifecycle() {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);

  await images(token);
  if (worstCase) await worstCaseImages(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  await accountLifecycle();
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
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
apps/api test:       Tests  246 passed | 183 skipped (429)
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
Tests  181 passed (181)
```

## Step 7: verify: smoke-syntax

```bash
node --check scripts/smoke-auth-stack.mjs && echo smoke-syntax=ok
```

Expected output contains:

- `smoke-syntax=ok`

Observed on the dry run:

```text
smoke-syntax=ok
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/deletion.ts`
- `apps/api/src/account/index.ts`
- `apps/api/src/account/purge.ts`
- `apps/api/src/account/routes.ts`
- `apps/api/src/auth/flows/deletion.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/index.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/test/account/deletion.test.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/auth/deletion.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/integration/account-deletion.test.ts`
- `apps/api/test/integration/account-export.test.ts`
- `apps/api/test/integration/flow-harness.ts`
- `apps/api/test/integration/http-deletion.test.ts`
- `scripts/smoke-auth-stack.mjs`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(account): an account deletes itself with fresh authentication, an emailed code and its typed handle; the auth module takes it down at once (sessions revoked with tombstones, devices and codes gone, the row marked), the purge tombstones its posts with their images deleted, removes its likes, reposts, bookmarks, follows, blocks and mutes with every counter, anonymises the profile and the auth row and keeps the handle reserved; the account-purge job finishes any deletion left half done and the smoke test walks the lifecycle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(account): an account deletes itself with fresh authentication, an emailed code and its typed handle; the auth module takes it down at once (sessions revoked with tombstones, devices and codes gone, the row marked), the purge tombstones its posts with their images deleted, removes its likes, reposts, bookmarks, follows, blocks and mutes with every counter, anonymises the profile and the auth row and keeps the handle reserved; the account-purge job finishes any deletion left half done and the smoke test walks the lifecycle`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 21>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "smoke-syntax": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
