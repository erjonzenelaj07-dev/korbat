# korbat account lifecycle (1b) — Task 8 of 9: Fixes from the adversarial review and the browser walk-through: atomic badge attempts and wider badge-start limits, a one-shot link that undoes an email change, the deletion's first step in one transaction with the file deletions requested before the purge commits, shared locks against writes on a purged account, and the web, contract and export items the review upheld

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. With every feature of sub-project 1b in place, the whole range was put through an adversarial review (six reviewers, one dimension each; every finding then judged by three independent lenses that tried to refute it) and a browser walk-through of the new screens on the rebuilt stack. This task fixes what survived: the badge's attempt count and start limits, a one-shot link that lets the old address undo an email change (the notice had promised a way back that a passwordless owner no longer had), the deletion's first step as one transaction with the purge's file deletions requested before its transaction commits, shared locks so a write in flight cannot land on a purged account, the bio's line separators, the display-name counter, focus after a step change, the export limit's message and the Verified chip's screen-reader label. The stack is rebuilt again and the smoke test rerun. The design is `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, sections 7.3, 7.4, 7.6, 9, 10 and 12, with the amendments in section 16.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): Settings gains a navigation row and two screens: Profile (display name, bio, a handle change with the date the next one is allowed) and Account (email change, the verified badge with what it means and where the number goes, the data export saved as a download, deletion behind a code and the typed handle); posts and profiles show a Verified chip; the terms name the verification provider, the export and the deletion; WEB_BADGE lets a build without a provider leave the badge section out`.

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
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/08-review-fixes.md 1
```

Expected: 20 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/account-takedown.test.ts`

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
    const other = await signIn(h.deps, owner.user, newTestDevice(), h.ctx, { alertNewDevice: false });
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

### Create `apps/api/test/integration/rate-limit-redis.test.ts`

```ts
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, describe, expect, test } from "vitest";
import { RedisStore } from "../../src/middleware/rate-limit";

const enabled = Boolean(process.env.INTEGRATION);
const redis = enabled ? new Redis(process.env.REDIS_URL ?? "redis://localhost:56379") : null;

afterAll(async () => {
  await redis?.quit();
});

/**
 * The Redis limit store against the test database of the Compose Valkey: a hit given back with
 * release lowers the counter under `rl:<key>` by one and leaves its expiry alone, never takes it below
 * zero, and never creates a key that was not there. Every test uses keys of its own.
 */
describe.skipIf(!enabled)("integration: the Redis rate-limit store", () => {
  const WINDOW_MS = 60_000;

  test("release gives one hit back and keeps the window's expiry", async () => {
    const store = new RedisStore(redis!);
    const key = `release-${randomUUID()}`;
    await store.hit(key, WINDOW_MS);
    await store.hit(key, WINDOW_MS);
    const before = await redis!.pttl(`rl:${key}`);
    await store.release(key);
    expect(await redis!.get(`rl:${key}`)).toBe("1");
    const after = await redis!.pttl(`rl:${key}`);
    // The expiry was not touched: it only ran down, and it is still set.
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    const next = await store.hit(key, WINDOW_MS);
    expect(next.count).toBe(2);
    expect(next.resetMs).toBeLessThanOrEqual(before);
  });

  test("release never goes below zero and never creates a key", async () => {
    const store = new RedisStore(redis!);
    const key = `release-${randomUUID()}`;
    await store.release(key);
    expect(await redis!.exists(`rl:${key}`)).toBe(0);
    await store.hit(key, WINDOW_MS);
    await store.release(key);
    await store.release(key);
    expect(await redis!.get(`rl:${key}`)).toBe("0");
    expect(await redis!.pttl(`rl:${key}`)).toBeGreaterThan(0);
    expect((await store.hit(key, WINDOW_MS)).count).toBe(1);
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
    const session: Session = { sessionId: h.currentSession, userId: h.userId, deviceId: randomUUID(), role: "user", onboarded: true, mfaEnabled: false, reauthAt: h.now() };
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
    a.route("/api/account", accountRoutes(h.deps, pass, pass));
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

### Replace `apps/api/test/auth/badge.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import {
  BADGE_STARTS_PER_DAY,
  BADGE_STARTS_PER_HOUR,
  BADGE_STARTS_PER_IP_PER_HOUR,
  badgeAttemptsKey,
  badgeKey,
  removeBadge,
  startBadge,
  verifyBadge,
  type PendingBadge,
} from "../../src/auth/flows/badge";
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

/** The development provider with every call counted, so a test can tell how many requests reached it. */
function counting(): { provider: VerificationProvider; calls: { start: number; check: number } } {
  const inner = devProvider();
  const calls = { start: 0, check: 0 };
  return {
    calls,
    provider: {
      start: async (phone) => {
        calls.start += 1;
        return inner.start(phone);
      },
      check: async (reference, code) => {
        calls.check += 1;
        return inner.check(reference, code);
      },
    },
  };
}

const pending = async (h: MemoryFlowHarness, flowId: string) => JSON.parse((await h.kv.get(badgeKey(flowId)))!) as PendingBadge;

/** Starts a verification for the number and returns its flow id. */
async function start(h: MemoryFlowHarness, session: Session, phone = PHONE): Promise<string> {
  return (await startBadge(h.deps, session, { phone }, h.ctx)).flowId;
}

/** Four wrong codes and then the right one: the right one is the fifth attempt, the last the flow allows. */
async function fourWrongThenRight(h: MemoryFlowHarness, session: Session, flowId: string): Promise<void> {
  for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
    expect(await failure(verifyBadge(h.deps, session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
  }
  expect(await verifyBadge(h.deps, session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
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
    expect(await h.kv.get(`rl:badge-start:ip:${h.ctx.ipHash}`)).toBe("1");
    expect(await h.kv.get("rl:badge-start:all")).toBe("1");
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 10 starts an hour from one address, whatever the accounts and numbers, then rate_limited before the provider is asked", async () => {
    const h = memoryFlowHarness();
    const { provider, calls } = counting();
    h.deps.verify = provider;
    // Four accounts, each within its own three an hour, and a new number every time: only the address is shared.
    const accounts = ["a", "b", "c", "d"].map((name) => h.user(`${name}@korbat.local`));
    for (let i = 0; i < BADGE_STARTS_PER_IP_PER_HOUR; i++) await start(h, accounts[Math.floor(i / BADGE_STARTS_PER_HOUR)]!.session, `+4479111234${String(i).padStart(2, "0")}`);
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR);
    const refused = await failure(start(h, accounts[3]!.session, "+447911123499"));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR);
    // Another address has a window of its own, and this one opens again after the hour.
    await startBadge(h.deps, accounts[3]!.session, { phone: "+447911123498" }, { ...h.ctx, ipHash: randomToken() });
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR + 1);
    h.advance(HOUR + 1);
    await start(h, accounts[0]!.session, "+447911123497");
    expect(calls.start).toBe(BADGE_STARTS_PER_IP_PER_HOUR + 2);
  });

  test("allows 200 starts a day on the whole instance, then rate_limited for a day before the provider is asked", async () => {
    const h = memoryFlowHarness();
    const { provider, calls } = counting();
    h.deps.verify = provider;
    // Every start from a fresh account, address and number, so only the instance-wide ceiling is shared.
    const fresh = (i: number) => ({ session: h.user(`crowd-${i}@korbat.local`).session, ctx: { ...h.ctx, ipHash: randomToken() }, phone: `+3361${String(i).padStart(7, "0")}` });
    for (let i = 0; i < BADGE_STARTS_PER_DAY; i++) {
      const { session, ctx, phone } = fresh(i);
      await startBadge(h.deps, session, { phone }, ctx);
    }
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY);
    const next = fresh(BADGE_STARTS_PER_DAY);
    const refused = await failure(startBadge(h.deps, next.session, { phone: next.phone }, next.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: (24 * HOUR) / 1000 });
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY);
    // Still closed an hour later, when every per-account, per-address and per-number window has passed; open again after the day.
    h.advance(HOUR + 1);
    expect(await failure(startBadge(h.deps, next.session, { phone: next.phone }, next.ctx))).toMatchObject({ code: "rate_limited" });
    h.advance(23 * HOUR);
    await startBadge(h.deps, next.session, { phone: next.phone }, next.ctx);
    expect(calls.start).toBe(BADGE_STARTS_PER_DAY + 1);
  });

  test("a start refused by the account's own limit does not count against the address or the instance", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < BADGE_STARTS_PER_HOUR; i++) await start(h, ada.session, `+44791112345${i}`);
    for (let i = 0; i < 5; i++) expect(await failure(start(h, ada.session, "+447911123459"))).toMatchObject({ code: "rate_limited" });
    // One account cannot use up the address's or the instance's allowance with starts it was never going to get.
    expect(await h.kv.get(`rl:badge-start:ip:${h.ctx.ipHash}`)).toBe(String(BADGE_STARTS_PER_HOUR));
    expect(await h.kv.get("rl:badge-start:all")).toBe(String(BADGE_STARTS_PER_HOUR));
  });
});

describe("badge: the verification step", () => {
  test("a wrong code is invalid_code and leaves the pending verification as it was; the right one still works within the limit", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    const before = await pending(h, flowId);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code", status: 400 });
    // The attempt is counted in a counter of its own; the state is never written back.
    expect(await pending(h, flowId)).toEqual(before);
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBe("1");
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    expect(h.mailer.sent).toEqual([]);
    expect(h.events).toEqual([]);
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("the right code after four wrong ones succeeds", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await fourWrongThenRight(h, ada.session, await start(h, ada.session));
    expect(h.users.get(ada.user.id)!.phoneHash).toBe(phoneHash(h.deps.config.authHmacKey, PHONE));
  });

  test("ten verifications at once with wrong codes: at most five reach the provider, the rest are too_many_attempts", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { provider, calls } = counting();
    h.deps.verify = provider;
    const flowId = await start(h, ada.session);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))));
    expect(calls.check).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
    expect(outcomes.filter((err) => err.code === "invalid_code")).toHaveLength(calls.check);
    expect(outcomes.filter((err) => err.code === "too_many_attempts")).toHaveLength(10 - calls.check);
    // Whatever order they ran in, the flow is spent: even the right code is refused now.
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(calls.check).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
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
    for (let i = 0; i < 10; i++) {
      expect(await failure(verifyBadge(h.deps, bob.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    }
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
    const unknown = randomToken();
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId: unknown, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(unknown))).toBeNull();
    // All five of the owner's attempts are still there.
    await fourWrongThenRight(h, ada.session, flowId);
    expect(h.users.get(bob.user.id)!.phoneHash).toBeNull();
  });

  test("an expired flow is invalid_code and counts no attempt, even while the store still holds its state", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    // A straggler: the state outlives its ten minutes in the store (Redis expires keys lazily), and the flow still treats it as gone.
    const state = await pending(h, flowId);
    await h.kv.set(badgeKey(flowId), JSON.stringify(state), HOUR);
    h.advance(CODE_TTL_MS);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBeNull();
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.advance(1);
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(await h.kv.get(badgeAttemptsKey(flowId))).toBeNull();
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
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
    h.deps.verify = devProvider();
    expect(await verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE })).toEqual({ verified: true });
  });

  test("an attempt the provider could not answer still counts: after it and four wrong codes the right one is too_many_attempts", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const flowId = await start(h, ada.session);
    h.deps.verify = unreachable;
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "verify_unavailable" });
    h.deps.verify = devProvider();
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: WRONG }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(verifyBadge(h.deps, ada.session, { flowId, code: DEV_CODE }))).toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(h.users.get(ada.user.id)!.phoneHash).toBeNull();
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
    // Back on, the flow still has all five attempts.
    h.deps.verify = devProvider();
    await fourWrongThenRight(h, ada.session, flowId);
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

### Replace `apps/api/test/auth/deletion.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { DELETE_STARTS_PER_HOUR, confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
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

  test("a take-down whose transaction fails midway leaves the account live with its sessions, devices and codes, and tells nobody", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.faults.add("takeDown");
    await expect(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" })).rejects.toThrow(/midway/);

    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(await h.deps.repo.findUserById(ada.user.id)).toBeDefined();
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null, null]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBeNull();
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toHaveLength(2);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login", "delete_account"]);
    expect(h.events).toEqual([]);
    // Nobody is told the account is gone while it is not.
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);

    // The code is spent, but the account is its owner's, who can start again and finish.
    h.faults.clear();
    const again = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a cache failure after the take-down does not fail the confirmation: the rows are revoked, the owner is told, and only the tombstones are missing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const set = h.kv.set.bind(h.kv);
    h.kv.set = async () => {
      throw new Error("the cache is unreachable");
    };
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    h.kv.set = set;
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toEqual([]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "account_deleted"]);
    // A cached copy of the session can live out its minute; the revoked row is what every other lookup reads.
    expect(await h.kv.get(`sess:${ada.session.sessionId}`)).toBeNull();
  });
});

describe("account deletion: the purge's last step", () => {
  test("repeats step 1's rows for an account marked deleted by hand, with tombstones, then anonymises the row; a repeat changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    Object.assign(h.users.get(ada.user.id)!, { passwordHash: "hash", phoneHash: "phone", totpSecretEnc: "v1:secret", totpEnabledAt: h.now(), recoveryCodesHash: ["r"] });
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const bob = h.user("bob@korbat.local");
    // Marked deleted and nothing else, as a take-down that stopped after the mark would leave it.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes).toEqual([]);
    expect(h.users.get(ada.user.id)).toMatchObject({
      email: `deleted:${ada.user.id}`,
      passwordHash: null,
      phoneHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      termsVersion: null,
      purgedAt: h.now(),
    });
    // Nothing is recorded or sent: the event and the notice belong to the confirmation.
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);

    const purged = structuredClone(h.users.get(ada.user.id));
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);
    expect(h.users.get(ada.user.id)).toEqual(purged);
  });

  test("leaves a live account alone", async () => {
    const h = memoryFlowHarness();
    const bob = h.user("bob@korbat.local");
    await finishPurge(h.deps, bob.user.id);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices).toHaveLength(1);
    expect(h.users.get(bob.user.id)).toMatchObject({ email: "bob@korbat.local", deletedAt: null, purgedAt: null });
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
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import type { AuthRepo } from "../../src/auth/repo";
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
  test("the notice carries a link good for 24 hours, kept under its hashed token with the old address and the time of the change", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    h.advance(1000);
    const token = (await change(h, ada.session, "ada-new@korbat.local"))!;
    const raw = (await h.kv.get(emailRevertKey(token)))!;
    expect(emailRevertKey(token)).toBe(`email-revert:${sha256Hex(token)}`);
    expect(JSON.parse(raw)).toEqual({ userId: ada.user.id, oldEmail: "ada@korbat.local", changedAt: h.now().getTime() });
    expect(raw).not.toContain(token);
    h.advance(EMAIL_REVERT_TTL_MS - 1);
    expect(await h.kv.get(emailRevertKey(token))).not.toBeNull();
    h.advance(1);
    expect(await h.kv.get(emailRevertKey(token))).toBeNull();
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
        ipHash: h.ctx.ipHash,
        metadata: { from: emailHash(key, "attacker@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true },
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

  test("a password set after the change goes and two-factor turned on before it stays", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    Object.assign(h.users.get(ada.user.id)!, { totpSecretEnc: "v1:owner", totpEnabledAt: h.now(), recoveryCodesHash: ["owner-code"] });
    h.advance(1000);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(1000);
    await h.deps.repo.setPasswordHash(ada.user.id, "attacker-password", h.now());
    h.advance(1000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: null, totpSecretEnc: "v1:owner", recoveryCodesHash: ["owner-code"] });
  });

  test("a password set before the change stays and two-factor turned on after it goes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    await h.deps.repo.setPasswordHash(ada.user.id, "owner-password", h.now());
    h.advance(1000);
    const token = (await change(h, ada.session, "attacker@korbat.local"))!;
    h.advance(1000);
    Object.assign(h.users.get(ada.user.id)!, { totpSecretEnc: "v1:attacker", totpEnabledAt: h.now(), totpLastStep: 42, recoveryCodesHash: ["attacker-code"] });
    h.advance(1000);
    await revertEmailChange(h.deps, { token }, h.ctx);
    expect(h.users.get(ada.user.id)).toMatchObject({ passwordHash: "owner-password", totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
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
    expect(h.events.at(-1)!.metadata).toEqual({ from: emailHash(key, "last@korbat.local"), to: emailHash(key, "ada@korbat.local"), reverted: true });

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
  revokedAt: Date | null;
}

/**
 * The auth flows without a database: users, email codes, sessions and devices live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge and deletion
 * flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
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
    verified,
    faults,
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

### Replace `apps/api/test/integration/social-repo.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { SocialError } from "../../src/social/context";
import { createSocialRepo, type ListRow, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile, ticker } from "./social-fixtures";

const ids = (rowsList: ListRow[]) => rowsList.map((r) => r.postId);

describe.skipIf(!process.env.INTEGRATION)("integration: social repository", () => {
  let db: Db;
  let repo: SocialRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("counters stay exact when actions repeat and undo", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, ada.id, clock.next());

    expect(await repo.like(bob.id, post, clock.next())).toBe(true);
    expect(await repo.like(bob.id, post, clock.next())).toBe(false);
    expect(await repo.repost(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(false);
    let row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([1, 1]);
    expect(await repo.viewerPostStates(bob.id, [post])).toEqual(new Map([[post, { liked: true, reposted: true, bookmarked: true }]]));

    expect(await repo.unlike(bob.id, post)).toBe(true);
    expect(await repo.unlike(bob.id, post)).toBe(false);
    expect(await repo.unrepost(bob.id, post)).toBe(true);
    expect(await repo.unbookmark(bob.id, post)).toBe(true);
    row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([0, 0]);
    expect((await repo.viewerPostStates(bob.id, [post])).get(post)).toEqual({ liked: false, reposted: false, bookmarked: false });
  });

  test("replies and quotes count on their target, top-level posts on the author", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: root });
    await newPost(repo, ada.id, clock.next(), "quote", { quoteOfId: root });
    const rootRow = (await repo.findPosts([root])).get(root)!;
    expect([rootRow.replyCount, rootRow.quoteCount]).toEqual([1, 1]);
    expect((await repo.findProfiles([ada.id])).get(ada.id)!.postCount).toBe(2);
    expect((await repo.findPosts([reply])).get(reply)!.replyToHandle).toBe(ada.handle);

    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(true);
    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(false);
    expect((await repo.findPosts([root])).get(root)!.replyCount).toBe(0);
    const deleted = (await repo.findPosts([reply])).get(reply)!;
    expect(deleted.state).toBe("deleted_by_author");
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();
  });

  test("blocking removes follows in both directions in one transaction and keeps counts exact", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.follow(bob.id, ada.id, clock.next())).toBe(true);
    let profilesById = await repo.findProfiles([ada.id, bob.id]);
    expect([profilesById.get(ada.id)!.followerCount, profilesById.get(ada.id)!.followingCount]).toEqual([1, 1]);

    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.relation(ada.id, bob.id)).toEqual({ following: false, followedBy: false, blocked: true, blockedBy: false, muted: false });
    expect(await repo.relation(bob.id, ada.id)).toEqual({ following: false, followedBy: false, blocked: false, blockedBy: true, muted: false });
    profilesById = await repo.findProfiles([ada.id, bob.id]);
    for (const p of profilesById.values()) expect([p.followerCount, p.followingCount]).toEqual([0, 0]);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set([ada.id]));
    expect(await repo.unblock(ada.id, bob.id)).toBe(true);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set());
  });

  test("the following timeline pages stably across posts and reposts, and a post reposted twice appears twice", async () => {
    const clock = ticker();
    const [viewer, ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const own = await newPost(repo, viewer.id, clock.next());
    const c1 = await newPost(repo, carol.id, clock.next()); // not followed: appears only through reposts
    await newPost(repo, ada.id, clock.next(), "a reply", { replyToId: a1 });
    await repo.repost(ada.id, c1, clock.next());
    await repo.repost(bob.id, c1, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());

    const all = await repo.followingTimeline(viewer.id, undefined, 10);
    expect(all.map((r) => [r.postId, r.reposterId])).toEqual([
      [b1, null],
      [c1, bob.id],
      [c1, ada.id],
      [own, null],
      [a1, null],
    ]);

    const seen: [string, string | null][] = [];
    let cursor: { t: number; id: string; r?: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rowsPage = await repo.followingTimeline(viewer.id, cursor, 2);
      if (rowsPage.length === 0) break;
      seen.push(...rowsPage.map((r): [string, string | null] => [r.postId, r.reposterId]));
      const last = rowsPage[rowsPage.length - 1]!;
      cursor = { t: last.sortAt.getTime(), id: last.postId, ...(last.reposterId ? { r: last.reposterId } : {}) };
    }
    expect(seen).toEqual(all.map((r) => [r.postId, r.reposterId]));
  });

  test("blocks hide an author in both directions; mutes hide timelines only", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: b1 });

    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);

    await repo.mute(viewer.id, ada.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);
    expect(ids(await repo.profilePosts(ada.id, viewer.id, undefined, 10))).toEqual([a1]);
    await repo.unmute(viewer.id, ada.id);

    // ada blocks the viewer: the viewer no longer sees ada anywhere, and ada no longer sees the viewer.
    await repo.block(ada.id, viewer.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    const v1 = await newPost(repo, viewer.id, clock.next());
    expect(ids(await repo.latestTimeline(ada.id, undefined, 200))).not.toContain(v1);
    expect(ids(await repo.latestTimeline(null, undefined, 200))).toEqual(expect.arrayContaining([a1, v1]));
  });

  test("withheld and removed posts appear only to their author; replies never enter timelines", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    const shown = await newPost(repo, ada.id, clock.next());
    const withheld = await newPost(repo, ada.id, clock.next());
    const removed = await newPost(repo, ada.id, clock.next());
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld}::uuid`);
    await db.execute(sql`update posts set state = 'removed' where id = ${removed}::uuid`);
    await newPost(repo, ada.id, clock.next(), "reply", { replyToId: shown });

    expect(ids(await repo.profilePosts(ada.id, ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.profilePosts(ada.id, bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.profilePosts(ada.id, null, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.latestTimeline(null, undefined, 500))).not.toContain(withheld);
  });

  test("threads: ancestors come root first and stop at the cap, replies page oldest first", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next(), "root");
    let parent = root;
    const chain = [root];
    for (let depth = 1; depth <= 55; depth++) {
      parent = await newPost(repo, ada.id, clock.next(), `level ${depth}`, { replyToId: parent });
      chain.push(parent);
    }
    const leaf = chain[chain.length - 1]!;
    const ancestors = await repo.ancestorIds(leaf);
    expect(ancestors).toHaveLength(50);
    expect(ancestors).toEqual(chain.slice(-51, -1));
    expect(await repo.ancestorIds(chain[3]!)).toEqual(chain.slice(0, 3));

    const replies = await Promise.all([1, 2, 3].map((n) => newPost(repo, ada.id, clock.next(), `r${n}`, { replyToId: root })));
    const first = await repo.replies(root, null, undefined, 2);
    expect(ids(first)).toEqual([chain[1], replies[0]]);
    const last = first[first.length - 1]!;
    const second = await repo.replies(root, null, { t: last.sortAt.getTime(), id: last.postId }, 2);
    expect(ids(second)).toEqual([replies[1], replies[2]]);
  });

  test("likes and bookmarks list newest first and drop posts the viewer may no longer see", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    await repo.like(viewer.id, a1, clock.next());
    await repo.like(viewer.id, b1, clock.next());
    await repo.bookmark(viewer.id, a1, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.block(bob.id, viewer.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.deletePost(a1, ada.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([]);
  });

  test("follower and blocked lists page newest first, and profile lookups are case-insensitive", async () => {
    const clock = ticker();
    const [ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    await repo.follow(carol.id, ada.id, clock.next());
    const firstPage = await repo.followers(ada.id, null, undefined, 1);
    expect(firstPage.map((r) => r.profileId)).toEqual([carol.id]);
    const secondPage = await repo.followers(ada.id, null, { t: firstPage[0]!.sortAt.getTime(), id: firstPage[0]!.profileId }, 1);
    expect(secondPage.map((r) => r.profileId)).toEqual([bob.id]);
    expect((await repo.following(bob.id, null, undefined, 10)).map((r) => r.profileId)).toEqual([ada.id]);
    expect(await repo.followedBy(bob.id, [ada.id, carol.id])).toEqual(new Set([ada.id]));

    await repo.block(ada.id, carol.id, clock.next());
    await repo.mute(ada.id, bob.id, clock.next());
    expect((await repo.blockedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([carol.id]);
    expect((await repo.mutedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([bob.id]);

    const found = await repo.findProfileByHandle(ada.handle.toUpperCase());
    expect(found?.id).toBe(ada.id);
    expect([found?.followerCount, found?.followingCount, found?.postCount]).toEqual([1, 0, 0]);
    expect(await repo.findProfileByHandle("no_such_handle_here")).toBeNull();
  });
});

/**
 * The account purge locks the deleted account's profile row `for update` for its whole transaction; a
 * follow, like, repost or bookmark takes a shared lock on the profile rows it writes about first and
 * refuses a deleted one. These tests hold the locks from a transaction of their own and watch this
 * database's sessions to know when the write under test is waiting, so the interleaving is the same on
 * every run. Nothing here can wait for ever: every connection of the pool gives up a lock wait after 5
 * seconds and a statement after 15, the server ends a transaction left idle for 30 seconds, every lock
 * holder is released in a `finally`, and every test has a time limit.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: social writes racing an account purge", () => {
  let db: Db;
  let repo: SocialRepo;
  const LIMIT = { timeout: 30_000 };

  beforeAll(() => {
    // Startup parameters in the URL become the session's settings on every connection of this pool.
    const url = new URL(loadConfig().DATABASE_URL_API);
    url.searchParams.set("lock_timeout", "5s");
    url.searchParams.set("statement_timeout", "15s");
    url.searchParams.set("idle_in_transaction_session_timeout", "30s");
    // Room for a lock holder, the writes it blocks, a purge and the polling connection at the same time.
    db = createDb(url.toString(), { max: 8 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    // With a deadline, so a connection some failed test left in a transaction cannot keep the suite open.
    await db.$client.end({ timeout: 5 });
  });

  /** Resolves once `n` sessions of this database wait on a lock, or as soon as `watched` settles (a write that never waited). */
  async function untilWaiting(n: number, watched: Promise<unknown>): Promise<void> {
    let settled = false;
    void watched.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 250; i++) {
      const [row] = (await db.execute(
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      )) as unknown as { n: number }[];
      if (row!.n >= n || settled) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`fewer than ${n} sessions waited on a lock`);
  }

  /**
   * A transaction that locks a profile row and holds the lock until `release`. With `purge`, it locks the
   * row as the purge does and marks the profile deleted before it commits, as the purge's last statement
   * does; otherwise it holds a plain shared lock and changes nothing. `finish` releases it and waits for
   * the transaction to end, whichever way it ends; the tests call it in a `finally`.
   */
  function hold(profileId: string, mode: "purge" | "share") {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const locked = new Promise<void>((resolve) => (taken = resolve));
    const done = db.transaction(async (tx) => {
      await tx.execute(mode === "purge" ? sql`select 1 from profiles where id = ${profileId}::uuid for update` : sql`select 1 from profiles where id = ${profileId}::uuid for share`);
      taken();
      await gate;
      if (mode === "purge") await tx.execute(sql`update profiles set deleted_at = now() where id = ${profileId}::uuid`);
    });
    // A holder that failed to take its lock must not leave `locked` waiting.
    done.catch(() => taken());
    const finish = async () => {
      release();
      await done.catch(() => undefined);
    };
    return { locked, release, done, finish };
  }

  /** What a write came to: true or false as the repository answered, or the error code it was refused with. */
  const outcome = (write: Promise<boolean>): Promise<boolean | string> => write.catch((err: unknown) => (err instanceof SocialError ? err.code : Promise.reject(err)));
  const counts = async (id: string) =>
    ((await db.execute(sql`select follower_count, following_count from profiles where id = ${id}::uuid`)) as unknown as { follower_count: number; following_count: number }[])[0]!;
  const followRows = async (from: string, to: string) =>
    ((await db.execute(sql`select count(*)::int as n from follows where follower_id = ${from}::uuid and followee_id = ${to}::uuid`)) as unknown as { n: number }[])[0]!.n;

  test("a follow that waits on a purge holding the followee's row sees the deletion once the purge commits, and is refused", LIMIT, async () => {
    const clock = ticker();
    const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const follow = outcome(repo.follow(ada.id, gone.id, clock.next(), true));
      await untilWaiting(1, follow);
      purge.release();
      await purge.done;
      expect(await follow).toBe("not_found");
    } finally {
      await purge.finish();
    }
    expect(await followRows(ada.id, gone.id)).toBe(0);
    expect(await counts(gone.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect(await counts(ada.id)).toEqual({ follower_count: 0, following_count: 0 });
  });

  test("a like, a repost or a bookmark of a post whose author a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["like", "repost", "bookmark"] as const) {
      const clock = ticker();
      const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
      const post = await newPost(repo, gone.id, clock.next());
      const purge = hold(gone.id, "purge");
      try {
        await purge.locked;
        const write = outcome(
          kind === "like" ? repo.like(ada.id, post, clock.next(), gone.id) : kind === "repost" ? repo.repost(ada.id, post, clock.next(), gone.id) : repo.bookmark(ada.id, post, clock.next()),
        );
        await untilWaiting(1, write);
        purge.release();
        await purge.done;
        expect(await write, kind).toBe("not_found");
      } finally {
        await purge.finish();
      }
      const row = (await repo.findPosts([post])).get(post)!;
      expect([row.likeCount, row.repostCount], kind).toEqual([0, 0]);
      expect((await repo.viewerPostStates(ada.id, [post])).get(post), kind).toEqual({ liked: false, reposted: false, bookmarked: false });
    }
  });

  test("a follow or a like by an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    const clock = ticker();
    const [gone, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, bob.id, clock.next());
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const follow = outcome(repo.follow(gone.id, bob.id, clock.next(), true));
      const like = outcome(repo.like(gone.id, post, clock.next(), bob.id));
      await untilWaiting(2, Promise.all([follow, like]));
      purge.release();
      await purge.done;
      expect([await follow, await like]).toEqual(["not_found", "not_found"]);
    } finally {
      await purge.finish();
    }
    expect(await followRows(gone.id, bob.id)).toBe(0);
    expect(await counts(bob.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect((await repo.findPosts([post])).get(post)!.likeCount).toBe(0);
  });

  test("a follow that holds the followee's row makes the purge wait, and the purge then removes the follow with its counters", LIMIT, async () => {
    const clock = ticker();
    const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
    // A shared lock on the follower's row lets the follow take its locks and write the followee's counter, then
    // stops it at the follower's counter: the follow is in flight, holding the followee's row, when the purge starts.
    const pause = hold(ada.id, "share");
    let purge: Promise<void> | undefined;
    try {
      await pause.locked;
      const follow = outcome(repo.follow(ada.id, gone.id, clock.next(), true));
      await untilWaiting(1, follow);
      purge = repo.purgeProfile(gone.id, clock.next(), async () => undefined);
      await untilWaiting(2, purge);
      pause.release();
      await pause.done;
      expect(await follow).toBe(true);
      await purge;
    } finally {
      await pause.finish();
      await purge?.catch(() => undefined);
    }
    expect(await followRows(ada.id, gone.id)).toBe(0);
    expect(await counts(ada.id)).toEqual({ follower_count: 0, following_count: 0 });
    expect(await counts(gone.id)).toEqual({ follower_count: 0, following_count: 0 });
    const [row] = (await db.execute(sql`select display_name, deleted_at from profiles where id = ${gone.id}::uuid`)) as unknown as { display_name: string; deleted_at: string | null }[];
    expect(row!.display_name).toBe("Deleted account");
    expect(row!.deleted_at).not.toBeNull();
  });

  test("ten accounts following one account at the same moment all land, with the counters exact", LIMIT, async () => {
    const clock = ticker();
    const star = await newProfile(db);
    const fans = await Promise.all(Array.from({ length: 10 }, () => newProfile(db)));
    // Every follow locks the followee's row and then updates its counter; a lock that conflicted with that update would deadlock these.
    const results = await Promise.all(fans.map((fan) => outcome(repo.follow(fan.id, star.id, clock.next(), true))));
    expect(results).toEqual(fans.map(() => true));
    expect(await counts(star.id)).toEqual({ follower_count: 10, following_count: 0 });
  });

  const pairRows = async (table: "blocks" | "mutes", from: string, to: string) =>
    (
      (await db.execute(
        table === "blocks"
          ? sql`select count(*)::int as n from blocks where blocker_id = ${from}::uuid and blocked_id = ${to}::uuid`
          : sql`select count(*)::int as n from mutes where muter_id = ${from}::uuid and muted_id = ${to}::uuid`,
      )) as unknown as { n: number }[]
    )[0]!.n;
  const postsBy = async (author: string) => ((await db.execute(sql`select count(*)::int as n from posts where author_id = ${author}::uuid`)) as unknown as { n: number }[])[0]!.n;

  test("a block or a mute of, or by, an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["block", "mute"] as const) {
      for (const direction of ["of", "by"] as const) {
        const clock = ticker();
        const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
        const [from, to] = direction === "of" ? [ada.id, gone.id] : [gone.id, ada.id];
        const purge = hold(gone.id, "purge");
        try {
          await purge.locked;
          const write = outcome(kind === "block" ? repo.block(from, to, clock.next()) : repo.mute(from, to, clock.next()));
          await untilWaiting(1, write);
          purge.release();
          await purge.done;
          expect(await write, `${kind} ${direction}`).toBe("not_found");
        } finally {
          await purge.finish();
        }
        expect(await pairRows(kind === "block" ? "blocks" : "mutes", from, to), `${kind} ${direction}`).toBe(0);
      }
    }
  });

  test("a post by an account a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    const clock = ticker();
    const gone = await newProfile(db);
    const purge = hold(gone.id, "purge");
    try {
      await purge.locked;
      const write = outcome(newPost(repo, gone.id, clock.next(), "written while the account is purged").then(() => true));
      await untilWaiting(1, write);
      purge.release();
      await purge.done;
      expect(await write).toBe("not_found");
    } finally {
      await purge.finish();
    }
    // No live post is left behind by an account whose purge has already tombstoned everything it had.
    expect(await postsBy(gone.id)).toBe(0);
  });

  test("a reply to or a quote of a post whose author a purge holds waits, sees the deletion and is refused", LIMIT, async () => {
    for (const kind of ["reply", "quote"] as const) {
      const clock = ticker();
      const [ada, gone] = await Promise.all([newProfile(db), newProfile(db)]);
      const target = await newPost(repo, gone.id, clock.next());
      const purge = hold(gone.id, "purge");
      try {
        await purge.locked;
        const write = outcome(
          repo
            .createPost({ authorId: ada.id, body: kind, replyToId: kind === "reply" ? target : null, quoteOfId: kind === "quote" ? target : null, now: clock.next(), lockWith: gone.id })
            .then(() => true),
        );
        await untilWaiting(1, write);
        purge.release();
        await purge.done;
        expect(await write, kind).toBe("post_unavailable");
      } finally {
        await purge.finish();
      }
      expect(await postsBy(ada.id), kind).toBe(0);
      const row = (await repo.findPosts([target])).get(target)!;
      expect([row.replyCount, row.quoteCount], kind).toEqual([0, 0]);
    }
  });

  test("blocks, mutes and replies aimed at one account at the same moment all land, without a deadlock, with the counters exact", LIMIT, async () => {
    const clock = ticker();
    const star = await newProfile(db);
    const post = await newPost(repo, star.id, clock.next());
    const fans = await Promise.all(Array.from({ length: 12 }, () => newProfile(db)));
    // Every fan follows the star and likes the post first, so each block takes a follow and a like off the star's
    // counters while the other writes lock the same rows and write the same counters.
    for (const fan of fans) {
      expect(await repo.follow(fan.id, star.id, clock.next())).toBe(true);
      expect(await repo.like(fan.id, post, clock.next(), star.id)).toBe(true);
    }
    const kinds = fans.map((_, i) => (["block", "mute", "reply"] as const)[i % 3]!);
    const writes = fans.map((fan, i) =>
      kinds[i] === "block"
        ? outcome(repo.block(fan.id, star.id, clock.next()))
        : kinds[i] === "mute"
          ? outcome(repo.mute(fan.id, star.id, clock.next()))
          : outcome(repo.createPost({ authorId: fan.id, body: "a reply", replyToId: post, quoteOfId: null, now: clock.next(), lockWith: star.id }).then(() => true)),
    );
    expect(await Promise.all(writes)).toEqual(fans.map(() => true));
    const blocks = kinds.filter((kind) => kind === "block").length;
    expect(await counts(star.id)).toEqual({ follower_count: fans.length - blocks, following_count: 0 });
    const row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.replyCount]).toEqual([fans.length - blocks, kinds.filter((kind) => kind === "reply").length]);
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
  test("the account lifecycle templates say what happened and what to do if it was not the owner", () => {
    const changeCode = renderTemplate("email_change_code", { code: "654321" });
    expect(changeCode.text).toContain("654321");
    expect(changeCode.text).toContain("10 minutes");
    const changed = renderTemplate("email_changed", { email: "new@example.com", revertUrl: "http://localhost:8081/email-revert/abc" });
    expect(changed.text).toContain("new@example.com");
    expect(changed.text).toMatch(/stays? signed in/);
    expect(changed.text).toContain(
      "If this was not you, open this link within 24 hours to move the account back to this address and sign out every session: http://localhost:8081/email-revert/abc",
    );
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

### Replace `apps/api/test/middleware.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { validate } from "../src/lib/validate";
import { clientIdentity, resolveClientIp } from "../src/auth/client-ip";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  return app;
}

describe("observability", () => {
  test("adds a uuid x-request-id header", async () => {
    const app = base().get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security headers", () => {
  test("sets the hardened header set on every response", async () => {
    const app = base().get("/x", (c) => c.json({}));
    const h = (await app.request("/x")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("cache-control")).toBe("no-store");
  });
});

describe("rateLimit", () => {
  test("allows up to limit then returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const app = base()
      .use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const blocked = await app.request("/x");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()) as { error: { code: string } }).toMatchObject({ error: { code: "rate_limited" } });
    now += 10_001;
    expect((await app.request("/x")).status).toBe(200);
  });
  test("a hit given back with release leaves the count one lower in the same window, and never below zero", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    await store.hit("k", 10_000);
    now += 4_000;
    await store.hit("k", 10_000);
    await store.release("k");
    // One hit left, and the window still ends where the first hit put it: nothing was restarted.
    expect(await store.hit("k", 10_000)).toEqual({ count: 2, resetMs: 6_000 });
    await store.release("k");
    await store.release("k");
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 6_000 });
    // A key that was never hit has nothing to give back, and another key is not touched.
    await store.release("never");
    expect(await store.hit("never", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
    // Once the window is over, a release belongs to no window and the next hit opens a fresh one.
    now += 6_000;
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
  });
  test("a failing store answers 503 with Retry-After instead of letting the request through", async () => {
    const store = {
      hit: async () => {
        throw new Error("redis down");
      },
      release: async () => undefined,
    };
    const app = base().use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" })).get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ error: { code: "service_unavailable" } });
  });
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("client identity", () => {
  const key = Buffer.alloc(32, 1);
  const spoofed = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  const seen = async (trust: "cloudflare" | "caddy" | "none", ipHashKey = key) => {
    const app = base().use(clientIdentity({ trust, ipHashKey })).get("/x", (c) => c.json({ ip: c.get("clientIp"), hash: c.get("clientIpHash") }));
    return (await (await app.request("/x", { headers: spoofed })).json()) as { ip: string; hash: string };
  };
  test("cloudflare mode believes cf-connecting-ip", async () => {
    expect((await seen("cloudflare")).ip).toBe("203.0.113.9");
  });
  test("caddy mode takes the first forwarded entry and ignores cf-connecting-ip", async () => {
    expect((await seen("caddy")).ip).toBe("198.51.100.7");
  });
  test("none mode uses the socket only, so a spoofed header opens no bucket", async () => {
    expect((await seen("none")).ip).toBe("direct");
  });
  test("the hash is keyed and never the address itself", async () => {
    const a = await seen("cloudflare");
    const b = await seen("cloudflare", Buffer.alloc(32, 2));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.ip);
    expect(a.hash).not.toBe(b.hash);
  });
  test("missing headers fall back down the list", () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof resolveClientIp>[0];
    for (const trust of ["cloudflare", "caddy", "none"] as const) expect(resolveClientIp(c, trust)).toBe("direct");
  });
});

describe("validate", () => {
  test("returns 400 envelope with field details", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: "no" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { properties?: Record<string, unknown> } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.properties).toHaveProperty("n");
  });
  test("passes valid input through", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: 4 }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ n: 4 });
  });
});
```

### Replace `apps/api/test/social/limits.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { SocialError } from "../../src/social/context";
import { enforceWriteLimit } from "../../src/social/limits";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";

const user = "00000000-0000-4000-8000-000000000001";

function harness(accountAgeMs: number) {
  let t = 1_789_000_000_000;
  const store = new MemoryStore(() => t);
  const createdAt = new Date(t - accountAgeMs);
  const now = () => new Date(t);
  return { store, createdAt, now, advance: (ms: number) => { t += ms; } };
}

async function code(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof SocialError) return err.code;
    throw err;
  }
}

describe("write limits", () => {
  test("a new account gets five posts an hour, then rate_limited with a Retry-After", async () => {
    const h = harness(HOUR_MS);
    for (let i = 0; i < 5; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    const err = await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect((err as SocialError).code).toBe("rate_limited");
    expect((err as SocialError).status).toBe(429);
    expect((err as SocialError).retryAfterSeconds).toBeGreaterThan(0);
    h.advance(HOUR_MS + 1);
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBeNull();
  });
  test("an established account gets thirty posts an hour", async () => {
    const h = harness(3 * DAY_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(h.store, user, "post", h.createdAt, h.now());
    expect(await code(enforceWriteLimit(h.store, user, "post", h.createdAt, h.now()))).toBe("rate_limited");
  });
  test("reposts and quotes are account_too_new before 48 hours, and quotes then count as posts", async () => {
    const young = harness(47 * HOUR_MS);
    expect(await code(enforceWriteLimit(young.store, user, "repost", young.createdAt, young.now()))).toBe("account_too_new");
    expect(await code(enforceWriteLimit(young.store, user, "quote", young.createdAt, young.now()))).toBe("account_too_new");
    const old = harness(49 * HOUR_MS);
    for (let i = 0; i < 30; i++) await enforceWriteLimit(old.store, user, "quote", old.createdAt, old.now());
    expect(await code(enforceWriteLimit(old.store, user, "post", old.createdAt, old.now()))).toBe("rate_limited");
  });
  test("a store that fails refuses the write with service_unavailable and a 30-second Retry-After", async () => {
    const failing = {
      hit: async () => {
        throw new Error("connection lost");
      },
      release: async () => undefined,
    };
    const err = await enforceWriteLimit(failing, user, "post", new Date(0), new Date()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "service_unavailable", status: 503, retryAfterSeconds: 30 });
  });
  test("follows stop at 400 a day even when each hour stays under 50", async () => {
    const h = harness(10 * DAY_MS);
    for (let hour = 0; hour < 8; hour++) {
      for (let i = 0; i < 50; i++) await enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now());
      h.advance(HOUR_MS + 1);
    }
    expect(await code(enforceWriteLimit(h.store, user, "follow", h.createdAt, h.now()))).toBe("rate_limited");
    expect(await code(enforceWriteLimit(h.store, user, "like", h.createdAt, h.now()))).toBeNull();
  });
});
```

### Replace `apps/app/test/lifecycle.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import EmailRevert from "../src/app/email-revert/[token]";
import { exportMessage } from "../src/app/settings/account";
import { SettingsNav, type SettingsPage } from "../src/components/SettingsNav";
import { VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { exportFilename } from "../src/lib/download";

/**
 * The account-lifecycle screens (1b design, section 9): the row of settings links, the verified badge
 * chip and the export download. The screens themselves need the router and a session, so what can be
 * checked without a browser is rendered on its own or read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** The route parameters the screen under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules), and the row needs only what
// Link does with `asChild`: hand the child its href, which react-native-web renders as a real anchor. A
// screen also reads its route parameters, and could navigate, which a static render never does.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined },
  useLocalSearchParams: () => route.params,
}));
// A screen reads the session only to refresh it after its call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

const PAGES: SettingsPage[] = ["security", "privacy", "profile", "account"];

describe("the settings row", () => {
  test("links every settings screen as a real anchor inside a navigation landmark", () => {
    const out = html(<SettingsNav current="security" />);
    expect(out).toMatch(/<nav\b|role="navigation"/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual(PAGES.map((page) => `/settings/${page}`));
  });

  test("marks the current page and only it", () => {
    for (const page of PAGES) {
      const current = anchors(html(<SettingsNav current={page} />)).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toContain(`href="/settings/${page}"`);
    }
  });

  test("every settings screen shows the row and names itself as the current page", () => {
    const dir = path.join(SRC, "app", "settings");
    const screens = readdirSync(dir).filter((file) => file.endsWith(".tsx") && !file.startsWith("_"));
    expect(screens.sort()).toEqual(PAGES.map((page) => `${page}.tsx`).sort());
    for (const file of screens) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).toContain(`<SettingsNav current="${file.replace(/\.tsx$/, "")}"`);
    }
  });
});

describe("the verified badge chip", () => {
  test("renders its label and names itself for a screen reader, as an image, since ARIA lets no generic element carry a name", () => {
    const out = html(<VerifiedChip />);
    expect(out).toContain("Verified");
    const tag = /<div[^>]*aria-label="verified account"[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain('role="img"');
  });

  test("is what post cards and the profile header show for a verified account", () => {
    for (const file of [path.join("components", "social", "PostCard.tsx"), path.join("app", "u", "[handle]", "index.tsx")]) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source, file).toMatch(/verified \? <VerifiedChip \/> : null/);
    }
  });
});

describe("the export download", () => {
  test("takes its file name from Content-Disposition and falls back to a plain one", () => {
    expect(exportFilename('attachment; filename="korbat-export-alice-2026-09-24.zip"')).toBe("korbat-export-alice-2026-09-24.zip");
    expect(exportFilename(null)).toBe("korbat-export.zip");
    expect(exportFilename("attachment")).toBe("korbat-export.zip");
    // Only the API's own shape of name reaches the browser's download prompt.
    expect(exportFilename('attachment; filename="../evil.zip"')).toBe("korbat-export.zip");
  });
});

describe("the email-revert page, opened from the link in the email-changed notice", () => {
  const LABEL = "Move my account back to this address";
  /** The opening tag of the button whose text is the label, or "" when there is none. */
  const buttonTag = (markup: string): string => {
    const at = markup.indexOf(LABEL);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };

  test("with the link's token it explains what happens and offers the button, which nothing happens without", () => {
    route.params = { token: "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2) };
    const out = html(<EmailRevert />);
    expect(out).toContain(LABEL);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(buttonTag(out)).not.toBe("");
    expect(buttonTag(out)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
  });

  test("with anything else in place of the token it says the link is incomplete and disables the button", () => {
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const out = html(<EmailRevert />);
      expect(out, token).toContain('role="alert"');
      expect(out, token).toMatch(/link is incomplete/);
      expect(buttonTag(out), token).toContain('aria-disabled="true"');
    }
  });

  test("the button posts the token to the undo route and the page then offers Sign in", () => {
    const source = readFileSync(path.join(SRC, "app", "email-revert", "[token].tsx"), "utf8");
    expect(source).toContain('api("/api/auth/email/revert", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });
});

/**
 * The settings screens' own rules, read from their source: the static render cannot press a key or
 * move the focus, so what a keyboard does there is checked in the code that does it.
 */
describe("the settings forms", () => {
  const account = readFileSync(path.join(SRC, "app", "settings", "account.tsx"), "utf8");
  const profile = readFileSync(path.join(SRC, "app", "settings", "profile.tsx"), "utf8");

  /** The body of the function or component `name` declares at the top of the file, up to its closing brace at the start of a line. */
  function block(source: string, name: string): string {
    const from = source.indexOf(`function ${name}(`);
    expect(from, name).toBeGreaterThanOrEqual(0);
    return source.slice(from, source.indexOf("\n}\n", from));
  }

  /** The first statement of the function `name` inside `outer`, comments skipped. */
  function firstStatement(source: string, outer: string, name: string): string {
    const body = block(source, outer);
    const at = body.indexOf(`function ${name}(`);
    expect(at, `${outer} ${name}`).toBeGreaterThanOrEqual(0);
    const lines = body
      .slice(at)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    return lines[0] ?? "";
  }

  test("Enter follows the same rules as the button: every action begins with its button's condition", () => {
    expect(firstStatement(account, "useAction", "act")).toBe("if (busy) return;");
    expect(firstStatement(account, "EmailSection", "start")).toBe("if (email.trim().length === 0) return;");
    expect(firstStatement(account, "EmailSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "BadgeSection", "start")).toBe("if (phone.trim().length === 0) return;");
    expect(firstStatement(account, "BadgeSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "DeleteSection", "confirm")).toBe("if (!CODE.test(code.trim()) || !matches) return;");
    expect(firstStatement(profile, "ProfileForm", "save")).toBe("if (!saved || !ready || busy) return;");
    expect(firstStatement(profile, "HandleSection", "change")).toBe("if (!ready || busy) return;");
  });

  test("the account's own address is refused in its own words, without asking the API", () => {
    const email = block(account, "EmailSection");
    expect(email).toContain("const current = email.trim().toLowerCase() === me.user.email.toLowerCase();");
    expect(email).toContain('<Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />');
    const start = email.slice(email.indexOf("function start("));
    const refusal = start.indexOf('setError("That is already your email address.");');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(start.indexOf('api("/api/auth/email/change/start"'));
  });

  test("the badge section shows only in a build that says on, and every build defaults to off", () => {
    expect(account).toContain('const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";');
    const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");
    expect(read("infra", "compose.yml")).toContain("EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}");
    const dockerfile = read("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_BADGE=off");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac');
    const infraEnv = read("infra", ".env.example");
    expect(infraEnv).toMatch(/^WEB_BADGE=off$/m);
    expect(infraEnv).toMatch(/^API_VERIFY_PROVIDER=off$/m);
    // The development API runs the dev provider, so the development app shows the section.
    expect(read("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_BADGE=on$/m);
    expect(read("apps", "api", ".env.example")).toMatch(/^VERIFY_PROVIDER=dev$/m);
  });

  test("the focus survives a step change: code fields take it, and going back hands it to the section's first control", () => {
    for (const label of ["Code from the email", "Code from the text message"]) {
      const fields = account.split("\n").filter((line) => line.includes(`<Field label="${label}"`));
      expect(fields.length, label).toBeGreaterThan(0);
      for (const field of fields) expect(field, label).toContain(" autoFocus ");
    }
    expect(block(account, "EmailSection")).toContain("useFocusOnReturn(flowId !== null, emailRef);");
    expect(block(account, "EmailSection")).toContain('<Field ref={emailRef} label="New email address"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(verified || flowId !== null, phoneRef);");
    expect(block(account, "BadgeSection")).toContain('<Field ref={phoneRef} label="Phone number"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(!verified, removeRef);");
    expect(block(account, "BadgeSection")).toContain('<Button ref={removeRef} label="Remove badge"');
    expect(block(account, "DeleteSection")).toContain("useFocusOnReturn(flowId !== null, sendRef);");
    expect(block(account, "DeleteSection")).toContain('<Button ref={sendRef} label="Send me a code"');
    const hook = block(account, "useFocusOnReturn");
    expect(hook).toContain("if (!away && wasAway.current) target.current?.focus();");
    // The field and the button hand the ref to the element react-native-web renders, whose focus() moves the browser's focus.
    const ui = readFileSync(path.join(SRC, "components", "ui.tsx"), "utf8");
    expect(block(ui, "Field")).toContain("<TextInput\n        ref={ref}");
    expect(block(ui, "Button")).toContain("<Pressable ref={ref}");
  });

  test("the export's daily limit says when the next export is allowed", () => {
    const limited = (seconds: number) => new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", seconds);
    expect(exportMessage(limited(3600))).toBe("You exported your data today already. You can export again in about an hour.");
    expect(exportMessage(limited(20 * 3600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(limited(20 * 3600 - 600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toBe("Confirm it's you to continue.");
  });

  test("the export says it was downloaded only once the whole body arrived; a body that fails part way is an error", () => {
    const exporting = block(account, "ExportSection");
    const saved = exporting.indexOf("saveBlob(await res.blob(), exportFilename(res.headers.get(\"content-disposition\")));");
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(exporting.indexOf('setDone("Your export was downloaded.");'));
    // A rejected res.blob() leaves the action through useAction, which shows the error and no note.
    expect(exporting).toContain("useAction(run, exportMessage)");
  });
});
```

### Replace `apps/app/vitest.config.mts` (whole file)

```text
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets. `@/` is the app's source folder, as tsconfig.json's
 * paths say, so a test can load a screen that imports its components that way.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
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
  RecoveryCode,
  SignupCompleteRequest,
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
  test("reauth accepts password, totp and email methods only", () => {
    expect(ReauthRequest.safeParse({ method: "password", password: "x" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "totp", code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "email", flowId: flow, code: "000000" }).success).toBe(true);
    expect(ReauthRequest.safeParse({ method: "sms", code: "000000" }).success).toBe(false);
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
    expect(AuthErrorCode.options).toHaveLength(28);
    expect(AuthErrorCode.options).toContain("password_check_unavailable");
    expect(AuthErrorCode.options).toEqual(expect.arrayContaining(["handle_cooldown", "email_in_use", "phone_in_use", "badge_unavailable", "verify_unavailable"]));
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

### Replace `packages/contracts/test/social.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AltText,
  BIO_MAX_LENGTH,
  Bio,
  CreatePostRequest,
  DisplayName,
  HandleChangeRequest,
  HandleParam,
  PostBody,
  PostId,
  PostView,
  ProfileEditRequest,
  ProfileListItem,
  ProfileView,
  SocialErrorCode,
  ThreadResponse,
  TimelineItem,
  TimelinePage,
  normalizePostBody,
  postLength,
  visibleLength,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const counts = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  author,
  body: "hello",
  createdAt: "2026-09-17T10:00:00.000Z",
  state: "visible",
  replyTo: null,
  counts,
  media: [],
  quoteOf: null,
  ...extra,
});

describe("post bodies", () => {
  test("normalization: NFC, CR LF to LF, at most two line breaks, trimmed", () => {
    expect(normalizePostBody("  e\u0301\r\nb\n\n\n\nc  ")).toBe("\u00e9\nb\n\nc");
    expect(PostBody.parse("\n a\r\n\r\nb \n")).toBe("a\n\nb");
  });
  test("tab and line feed are allowed, other control characters are not", () => {
    expect(PostBody.safeParse("a\tb\nc").success).toBe(true);
    expect(PostBody.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(PostBody.safeParse("a\u0085b").success).toBe(false);
  });
  test("length is counted in code points after normalization", () => {
    expect(postLength("\u{1F600}".repeat(3))).toBe(3);
    expect(PostBody.safeParse("\u{1F600}".repeat(1000)).success).toBe(true);
    expect(PostBody.safeParse("\u{1F600}".repeat(1001)).success).toBe(false);
    expect(PostBody.safeParse("   \n  ").success).toBe(false);
  });
  test("a post is a reply or a quote, never both", () => {
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", quoteOfId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2), quoteOfId: id(3) }).success).toBe(false);
  });
});

describe("invisible characters", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);
  test("direction overrides and zero-width spaces are refused in bodies, alt text and display names", () => {
    expect(PostBody.safeParse(`a${rlo}b`).success).toBe(false);
    expect(PostBody.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(AltText.safeParse(`cat${rlo}`).success).toBe(false);
    expect(DisplayName.safeParse(`Ada${zwsp}`).success).toBe(false);
  });
  test("joiners inside emoji stay allowed but do not count as text on their own", () => {
    const family = `${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`;
    expect(PostBody.safeParse(family).success).toBe(true);
    expect(PostBody.safeParse(zwj).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: zwj, media: [] }).success).toBe(false);
    expect(visibleLength(`a${zwj}b`)).toBe(2);
  });
  test("post ids are lowercased", () => {
    expect(PostId.parse("3B241101-E2BB-4255-8CAF-4136C566A962")).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
  });
  test("a reply may point at a parent whose author is hidden from the viewer", () => {
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2), authorHandle: null } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2) } })).success).toBe(false);
  });
});

describe("handles", () => {
  test("handle params strip the @ and lowercase, and reject invalid handles", () => {
    expect(HandleParam.parse(" @Ada_Lovelace ")).toBe("ada_lovelace");
    expect(HandleParam.safeParse("ab").success).toBe(false);
    expect(HandleParam.safeParse("has space").success).toBe(false);
  });
});

describe("post views", () => {
  test("a quote embeds one level and is otherwise a tombstone", () => {
    expect(PostView.safeParse(post(1, { quoteOf: post(2) })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), deleted: true } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), unavailable: true } })).success).toBe(true);
    // The embedded post may not carry its own expanded quote, and a tombstone needs a reason.
    expect(PostView.safeParse(post(1, { quoteOf: post(2, { quoteOf: post(3) }) })).success).toBe(false);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2) } })).success).toBe(false);
  });
  test("deleted is not a post state; deleted posts are tombstones", () => {
    expect(PostView.safeParse(post(1, { state: "deleted_by_author" })).success).toBe(false);
    expect(ThreadResponse.safeParse({ ancestors: [{ id: id(9), deleted: true }, post(2)], post: post(1), replies: { items: [], nextCursor: null } }).success).toBe(true);
  });
  test("timeline items are posts or reposts with the reposter", () => {
    expect(TimelineItem.safeParse({ kind: "post", post: post(1) }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1), repostedBy: author, repostedAt: "2026-09-17T11:00:00.000Z" }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1) }).success).toBe(false);
    expect(TimelinePage.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});

describe("profiles", () => {
  test("profile views carry counts and an optional viewer relation", () => {
    const base = { id: id(1), handle: "ada", displayName: "Ada", bio: "", verified: true, createdAt: "2026-09-17T10:00:00.000Z", counts: { posts: 1, followers: 2, following: 3 } };
    expect(ProfileView.safeParse(base).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, viewer: { following: true, followedBy: false, blocked: false, muted: false } }).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, counts: { posts: -1, followers: 0, following: 0 } }).success).toBe(false);
    expect(ProfileListItem.safeParse({ ...author, bio: "hi", viewerFollows: true }).success).toBe(true);
  });
  test("the error codes are exactly the five social ones", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
  });
});

describe("profile editing", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);

  test("a bio is trimmed, may be empty, and has at most 160 code points", () => {
    expect(BIO_MAX_LENGTH).toBe(160);
    expect(Bio.parse("  Unpopular opinions, daily.  ")).toBe("Unpopular opinions, daily.");
    expect(Bio.parse("")).toBe("");
    expect(Bio.parse("   ")).toBe("");
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
    const astral = String.fromCodePoint(0x1f600);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
  });

  test("a bio is one line of plain text: no control, direction or zero-width characters; emoji joiners stay", () => {
    expect(Bio.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(10)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(9)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x85)}b`).success).toBe(false);
    // The Unicode line and paragraph separators are line breaks too, though not control characters.
    expect(Bio.safeParse(`a${String.fromCharCode(0x2028)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x2029)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${rlo}b`).success).toBe(false);
    expect(Bio.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(Bio.safeParse(`${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`).success).toBe(true);
  });

  test("a profile edit changes the display name, the bio or both, never nothing", () => {
    expect(ProfileEditRequest.parse({ displayName: " Ada " })).toEqual({ displayName: "Ada" });
    expect(ProfileEditRequest.parse({ bio: "" })).toEqual({ bio: "" });
    expect(ProfileEditRequest.parse({ displayName: "Ada", bio: " hi " })).toEqual({ displayName: "Ada", bio: "hi" });
    expect(ProfileEditRequest.safeParse({}).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "" }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "x".repeat(51) }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ bio: `a${rlo}b` }).success).toBe(false);
  });

  test("a handle change carries the handle as typed, lowercased; the flow decides whether it is valid", () => {
    expect(HandleChangeRequest.parse({ handle: " Ada_Lovelace " })).toEqual({ handle: "ada_lovelace" });
    expect(HandleChangeRequest.safeParse({}).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "" }).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "x".repeat(65) }).success).toBe(false);
  });
});

describe("posts with images", () => {
  const img = (n: number, alt = "an image") => ({ id: id(n), alt });

  test("a post needs text or an image; the body defaults to empty and media to none", () => {
    expect(CreatePostRequest.parse({ body: "hello" })).toEqual({ body: "hello", media: [] });
    expect(CreatePostRequest.parse({ media: [img(1)] })).toEqual({ body: "", media: [img(1)] });
    expect(CreatePostRequest.parse({ body: "  ", media: [img(1)] }).body).toBe("");
    expect(CreatePostRequest.safeParse({}).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "   ", media: [] }).success).toBe(false);
  });

  test("at most four images, each only once, each with a description", () => {
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4), img(5)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1, "  ")] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [{ id: id(1) }] }).success).toBe(false);
    expect(CreatePostRequest.parse({ body: "x", media: [img(1, "  a   cat ")] }).media[0]!.alt).toBe("a cat");
  });

  test("the text rules still hold for a post with images, and replies and quotes may carry images", () => {
    expect(CreatePostRequest.safeParse({ body: "a".repeat(1001), media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "a\u0000b", media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ quoteOfId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), quoteOfId: id(8), media: [img(1)] }).success).toBe(false);
  });
});

```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:  ❯ test/auth.test.ts (17 tests | 1 failed) 82ms
packages/contracts test:  ❯ test/social.test.ts (21 tests | 1 failed) 109ms
packages/contracts test:  Test Files  2 failed | 3 passed (5)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-lifecycle-1b/write_blocks.py docs/superpowers/prompts/account-lifecycle-1b/08-review-fixes.md 3
```

Expected: 28 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/app/email-revert/[token].tsx`

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "email address changed" notice, which goes to the address the account
 * had. The link is the only credential needed, because an account without a password can no longer
 * sign in at that address. Nothing happens until the person confirms.
 */
export default function EmailRevert() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email/revert", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is back at this address</Title>
        <Body>
          Every session is signed out, including any in this browser. Sign in again with a code sent to this address. A password or two-factor authentication set up after the change
          was removed, so set them up again from Security.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Undo the email change</Title>
      <Body>
        If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session,
        including this browser, and remove any password or two-factor authentication set up since the change.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Move my account back to this address" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/api/src/account/flows/deletion.ts` (whole file)

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
 * with the image rows detached and their files asked for inside its transaction; then the auth row's
 * anonymisation. The files are asked for before the commit, not after it: were the process to stop
 * between a commit and the request, a rerun would find no rows left, mark the account purged and
 * leave the files to the sweeper's reconcile pass, which refuses to act on many orphans at once. A
 * request is one empty file per id, so a rerun after a failed commit, which finds the same rows again,
 * asks again for the same ids and changes nothing; the files it asked for belong to an account that is
 * being deleted either way. Every step changes only what is still there, so the purge can run again
 * after a failure, from the request or from the job, and finish what an earlier run left.
 */
export async function purge(deps: AccountDeps, userId: string): Promise<void> {
  await deps.social.purgeProfile(userId, deps.now(), async (tx) => {
    await deps.media.requestDeletion(await deps.media.purgeOwner(tx, userId));
  });
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

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts and the profile are read before the first
 * byte; the profile's lists are read page by page while export.json is written, and the images, each
 * behind the media module's checked open, go first, so `missingMedia` is complete by the time the JSON
 * that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  currentSessionId: string;
  account: AccountExport;
  profile: ProfileExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, and the list of images. The three
 * modules are asked at once. `pageSize` is how many rows of each profile list are read at a time; tests
 * lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSessionId: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId, pageSize), deps.media.exportImages(userId)]);
  return { exportedAt: now, currentSessionId, account, profile, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSessionId })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file); the order of
 * entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
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

### Replace `apps/api/src/account/zip.ts` (whole file)

```ts
import { setImmediate as nextTurn } from "node:timers/promises";
import { crc32 } from "node:zlib";
import { Deflate } from "fflate";
import type { StoredFile } from "../media";

/** Receives the archive's bytes in order. The writer awaits every call, so a slow consumer slows the reading of the files. */
export type ZipSink = (chunk: Uint8Array) => Promise<void>;

/**
 * Opens the file an entry holds: the media module's checked open, which answers null for a file it
 * refuses (missing, not a plain file of the store, larger than a variant may be) and otherwise the open
 * handle with the size it measured. The writer reads exactly that many bytes and closes the handle.
 */
export type OpenFile = () => Promise<StoredFile | null>;

export interface ZipWriter {
  /**
   * A deflated entry whose text arrives in pieces, for export.json: each piece is encoded, fed to the
   * deflate at most 64 KiB at a time, and the event loop gets a turn between two feeds, so a large
   * document never holds the loop and never sits in memory whole.
   */
  addJsonPieces(name: string, pieces: AsyncIterable<string>): Promise<void>;
  /**
   * A stored entry holding the bytes of the file `open` answers, read in chunks up to the size it
   * checked. False, with nothing added, when it answers null. A failure while reading, after the entry
   * began, is thrown: the archive can no longer be completed.
   */
  addFile(name: string, open: OpenFile): Promise<boolean>;
  /** Writes the central directory and the end records. Nothing may be added afterwards. */
  end(): Promise<void>;
}

export interface ZipWriterOptions {
  /** Tests only: "always" writes the ZIP64 fields of every entry and the ZIP64 end records, whatever the sizes. */
  zip64?: "auto" | "always";
  /**
   * Tests only: offsets are counted from here, as if that many bytes had gone before the archive, so a test
   * can see the switch to ZIP64 at 4 GiB without writing 4 GiB. The bytes written are the archive's all the same.
   */
  startOffset?: number;
}

/** How much of a file is read at a time; each chunk becomes one awaited write. */
const CHUNK_BYTES = 64 * 1024;
/** The most the deflate is given at once; the event loop gets a turn after each. */
const PIECE_BYTES = 64 * 1024;

/** The largest value a 32-bit field holds; the value itself means "see the ZIP64 record", so it is ZIP64 already. */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const TWO_32 = 0x1_0000_0000;

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const SIG_END = 0x06054b50;
/** ZIP 4.5: the version that knows ZIP64, needed to read every entry and the archive. */
const VERSION = 45;
/** Bit 3: the CRC and the sizes follow the data in a descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0008 | 0x0800;
const STORED = 0;
const DEFLATED = 8;

interface Entry {
  name: Uint8Array;
  method: typeof STORED | typeof DEFLATED;
  /** Where the local header starts, from the archive's first byte (plus the test offset). */
  offset: number;
  crc: number;
  compressed: number;
  size: number;
  /** Whether the central directory gives it a ZIP64 extra field, which makes the whole archive ZIP64. */
  zip64: boolean;
}

/** A fixed-size record to fill in little-endian. */
function record(length: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** A 64-bit field. The values stay far below 2^53, where a JavaScript number is still exact. */
function setUint64(view: DataView, at: number, value: number): void {
  view.setUint32(at, value % TWO_32, true);
  view.setUint32(at + 4, Math.floor(value / TWO_32), true);
}

/** The MS-DOS date and time every header carries, from the local clock as archivers do; ZIP cannot say a year before 1980. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, at.getFullYear()));
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * A ZIP archive written entry by entry into an async sink. Every entry streams: its local header carries
 * no CRC or sizes (flag bit 3), the data follows, and a data descriptor after it holds the CRC and the
 * sizes, so nothing about an entry has to be known before its first byte goes out. Each chunk is one
 * awaited write, so at most one chunk of input is in flight and back-pressure reaches the file reads.
 *
 * The container is written here rather than by fflate's Zip, which knows no ZIP64: an export whose
 * images pass 4 GiB, or 65,534 entries, would get offsets and a count that wrap, and no reader could open
 * it. fflate still does the deflate, and Node's zlib the CRC-32. ZIP64 (APPNOTE 4.3.9, 4.3.14-4.3.16,
 * 4.5.3) comes in by itself where a value does not fit: an entry whose sizes reach 4 GiB gets 8-byte sizes
 * in its data descriptor; a central directory entry gets a ZIP64 extra field (id 0x0001) holding each size
 * or offset that does not fit, in that order, with 0xFFFFFFFF in the 32-bit field it replaces; and the
 * archive then ends with the ZIP64 end record and its locator before the classic end record, whose
 * fields that do not fit read 0xFFFF or 0xFFFFFFFF.
 */
export function createZipWriter(sink: ZipSink, options: ZipWriterOptions = {}): ZipWriter {
  const always = options.zip64 === "always";
  const { time, date } = dosDateTime(new Date());
  const encoder = new TextEncoder();
  const entries: Entry[] = [];
  let offset = options.startOffset ?? 0;
  /** What the deflate has handed out and the sink has not taken yet: fflate calls back synchronously while it is fed. */
  const queued: Uint8Array[] = [];

  async function write(chunk: Uint8Array): Promise<void> {
    offset += chunk.length;
    await sink(chunk);
  }

  async function drain(): Promise<void> {
    while (queued.length > 0) await write(queued.shift()!);
  }

  /** Writes the entry's local header and returns the entry, to be counted into as its data is written. */
  async function begin(name: string, method: Entry["method"]): Promise<Entry> {
    const entry: Entry = { name: encoder.encode(name), method, offset, crc: 0, compressed: 0, size: 0, zip64: false };
    const { bytes, view } = record(30 + entry.name.length);
    view.setUint32(0, SIG_LOCAL, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, FLAGS, true);
    view.setUint16(8, method, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    // CRC-32, compressed and uncompressed size (14 to 25) stay zero: the data descriptor carries them.
    view.setUint16(26, entry.name.length, true);
    view.setUint16(28, 0, true);
    bytes.set(entry.name, 30);
    await write(bytes);
    return entry;
  }

  /** Writes the data descriptor once the entry's bytes are out, and keeps the entry for the central directory. */
  async function finish(entry: Entry): Promise<void> {
    // 8-byte sizes once the entry is ZIP64 (APPNOTE 4.3.9.2); 4-byte sizes otherwise, as readers that never saw ZIP64 expect.
    const wide = always || entry.size >= MAX32 || entry.compressed >= MAX32;
    const { bytes, view } = record(wide ? 24 : 16);
    view.setUint32(0, SIG_DESCRIPTOR, true);
    view.setUint32(4, entry.crc, true);
    if (wide) {
      setUint64(view, 8, entry.compressed);
      setUint64(view, 16, entry.size);
    } else {
      view.setUint32(8, entry.compressed, true);
      view.setUint32(12, entry.size, true);
    }
    await write(bytes);
    entries.push(entry);
  }

  /** The entry's central directory header, with a ZIP64 extra field for what does not fit in 32 bits. */
  function central(entry: Entry): Uint8Array {
    const sizeOver = always || entry.size >= MAX32;
    const compressedOver = always || entry.compressed >= MAX32;
    const offsetOver = always || entry.offset >= MAX32;
    // The fields of the extra appear only for the 32-bit fields that read 0xFFFFFFFF, always in this order.
    const wide = [...(sizeOver ? [entry.size] : []), ...(compressedOver ? [entry.compressed] : []), ...(offsetOver ? [entry.offset] : [])];
    entry.zip64 = wide.length > 0;
    const extra = wide.length > 0 ? 4 + 8 * wide.length : 0;
    const { bytes, view } = record(46 + entry.name.length + extra);
    view.setUint32(0, SIG_CENTRAL, true);
    view.setUint16(4, VERSION, true);
    view.setUint16(6, VERSION, true);
    view.setUint16(8, FLAGS, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, compressedOver ? MAX32 : entry.compressed, true);
    view.setUint32(24, sizeOver ? MAX32 : entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, extra, true);
    // The comment length, the disk number and both attribute fields (32 to 41) stay zero.
    view.setUint32(42, offsetOver ? MAX32 : entry.offset, true);
    bytes.set(entry.name, 46);
    if (extra > 0) {
      const at = 46 + entry.name.length;
      view.setUint16(at, 0x0001, true);
      view.setUint16(at + 2, extra - 4, true);
      wide.forEach((value, i) => setUint64(view, at + 4 + 8 * i, value));
    }
    return bytes;
  }

  return {
    async addJsonPieces(name, pieces) {
      const entry = await begin(name, DEFLATED);
      const deflate = new Deflate({ level: 6 }, (chunk) => {
        entry.compressed += chunk.length;
        queued.push(chunk);
      });
      for await (const piece of pieces) {
        const bytes = encoder.encode(piece);
        for (let at = 0; at < bytes.length; at += PIECE_BYTES) {
          const part = bytes.subarray(at, at + PIECE_BYTES);
          entry.crc = crc32(part, entry.crc);
          entry.size += part.length;
          deflate.push(part);
          await drain();
          // Deflating is synchronous work on the event loop: every other request gets a turn between two feeds.
          await nextTurn();
        }
      }
      deflate.push(new Uint8Array(0), true);
      await drain();
      await finish(entry);
    },

    async addFile(name, open) {
      // The entry begins only once the file is open and checked: an entry cannot be taken back.
      const stored = await open();
      if (!stored) return false;
      const { handle, size } = stored;
      try {
        const entry = await begin(name, STORED);
        if (size > 0) {
          // Exactly the bytes the checked open measured, so a file that grows after the check adds nothing. The
          // stream closes the handle when it ends, and also when a throw below ends the loop and destroys it.
          const chunks = handle.createReadStream({ start: 0, end: size - 1, highWaterMark: CHUNK_BYTES }) as AsyncIterable<Uint8Array>;
          for await (const chunk of chunks) {
            entry.crc = crc32(chunk, entry.crc);
            entry.size += chunk.length;
            entry.compressed += chunk.length;
            await write(chunk);
          }
        }
        await finish(entry);
        return true;
      } finally {
        // A zero-byte file was never streamed, and a handle the stream closed already is closed again for nothing.
        await handle.close().catch(() => undefined);
      }
    },

    async end() {
      const directoryOffset = offset;
      // The directory goes out in chunks of about the size of a file chunk, not one write per entry.
      let batch: Uint8Array[] = [];
      let batched = 0;
      for (const entry of entries) {
        const header = central(entry);
        batch.push(header);
        batched += header.length;
        if (batched >= CHUNK_BYTES) {
          await write(Buffer.concat(batch));
          batch = [];
          batched = 0;
        }
      }
      if (batch.length > 0) await write(Buffer.concat(batch));
      const directorySize = offset - directoryOffset;
      const count = entries.length;

      const countOver = always || count >= MAX16;
      const sizeOver = always || directorySize >= MAX32;
      const offsetOver = always || directoryOffset >= MAX32;
      const tail: Uint8Array[] = [];
      if (countOver || sizeOver || offsetOver || entries.some((entry) => entry.zip64)) {
        const end64Offset = offset;
        const end64 = record(56);
        end64.view.setUint32(0, SIG_END64, true);
        // The size of the rest of the record, without this field and the signature.
        setUint64(end64.view, 4, 44);
        end64.view.setUint16(12, VERSION, true);
        end64.view.setUint16(14, VERSION, true);
        // This disk and the directory's disk (16 to 23) are disk 0: the archive is never split.
        setUint64(end64.view, 24, count);
        setUint64(end64.view, 32, count);
        setUint64(end64.view, 40, directorySize);
        setUint64(end64.view, 48, directoryOffset);
        const locator = record(20);
        locator.view.setUint32(0, SIG_LOCATOR64, true);
        setUint64(locator.view, 8, end64Offset);
        locator.view.setUint32(16, 1, true);
        tail.push(end64.bytes, locator.bytes);
      }
      const end = record(22);
      end.view.setUint32(0, SIG_END, true);
      end.view.setUint16(8, countOver ? MAX16 : count, true);
      end.view.setUint16(10, countOver ? MAX16 : count, true);
      end.view.setUint32(12, sizeOver ? MAX32 : directorySize, true);
      end.view.setUint32(16, offsetOver ? MAX32 : directoryOffset, true);
      tail.push(end.bytes);
      await write(Buffer.concat(tail));
    },
  };
}
```

### Replace `apps/api/src/auth/flows/badge.ts` (whole file)

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
/** Per client address, as the sign-up starts limit theirs: one address cannot run many accounts' starts. */
export const BADGE_STARTS_PER_IP_PER_HOUR = 10;
/** On the whole instance: every start is a text the provider bills, so no crowd of fresh accounts can run up the bill. */
export const BADGE_STARTS_PER_DAY = 200;

/** A flow id is a bearer credential while its verification is pending, so the store holds only its hash. */
export const badgeKey = (flowId: string) => `badge:${sha256Hex(flowId)}`;
/** The flow's attempts, counted by the store's atomic counter under the hashed flow id. */
export const badgeAttemptsKey = (flowId: string) => `badge-attempts:${sha256Hex(flowId)}`;

/**
 * The verification a code is out for, kept under the hashed flow id until the code is right or the ten
 * minutes pass. It holds the number only as its keyed hash, which is what the account will store; the
 * number itself went to the provider and nowhere else. The expiry is kept so that a state the store has
 * not dropped yet at the end of its ten minutes is still treated as gone. It is written once and never
 * written back: attempts are counted apart, atomically.
 */
export interface PendingBadge {
  userId: string;
  phoneHash: string;
  reference: string;
  expiresAt: number;
}

/**
 * The configured provider, or badge_unavailable (404) when VERIFY_PROVIDER is off. The web app does not
 * learn this from the answer: its build flag (EXPO_PUBLIC_BADGE, from WEB_BADGE) decides whether the badge
 * section is shown, off by default like the provider.
 */
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
 * phone (verifyBadge), so this step tells nobody which numbers are registered. Every limit is counted
 * before the provider is asked, so a refused start costs no text; the number is never stored.
 */
export async function startBadge(deps: AuthDeps, session: Session, input: BadgeStartRequest, ctx: RequestContext): Promise<{ flowId: string }> {
  const verify = provider(deps);
  const hashed = phoneHash(deps.config.authHmacKey, input.phone);
  // The narrowest bucket first: a start the account's own limit refuses is not counted against the address or the
  // instance, so one account cannot spend their allowance with starts it was never going to get.
  await enforceLimit(deps.kv, `badge-start:${session.userId}`, BADGE_STARTS_PER_HOUR, HOUR);
  await enforceLimit(deps.kv, `badge-start:ip:${ctx.ipHash}`, BADGE_STARTS_PER_IP_PER_HOUR, HOUR);
  // Per number too, whoever asks, so one phone cannot be texted more than three times an hour through many accounts.
  await enforceLimit(deps.kv, `badge-start:phone:${hashed}`, BADGE_STARTS_PER_HOUR, HOUR);
  // The ceiling last, so it counts only starts every other bucket let through.
  await enforceLimit(deps.kv, "badge-start:all", BADGE_STARTS_PER_DAY, 24 * HOUR);
  const { reference } = await verify.start(input.phone).catch(unavailable);
  const flowId = randomToken();
  const pending: PendingBadge = { userId: session.userId, phoneHash: hashed, reference, expiresAt: deps.now().getTime() + CODE_TTL_MS };
  await deps.kv.set(badgeKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  return { flowId };
}

/**
 * Checks the code with the provider. Attempts are counted before the provider is asked, as the email
 * codes count theirs, with the store's atomic counter: concurrent requests each get their own count, so
 * a flow takes at most five codes whatever the provider answers and however many requests arrive at
 * once. On success the account's phone hash is written first (the partial unique index on it decides
 * conflicts, so a number another account verified is phone_in_use here and only here), then the
 * profile's verified_at, and the account is told.
 */
export async function verifyBadge(deps: AuthDeps, session: Session, input: BadgeVerifyRequest): Promise<BadgeVerifyResponse> {
  const verify = provider(deps);
  const key = badgeKey(input.flowId);
  const raw = await deps.kv.get(key);
  const pending = raw ? (JSON.parse(raw) as PendingBadge) : null;
  // A flow another account started, an unknown one and one whose ten minutes passed are all no code at all,
  // settled before an attempt is counted: nobody can spend another account's attempts. The store drops the
  // state itself at the end of the ten minutes; a straggler it still holds is treated like a flow that is gone.
  if (!pending || pending.userId !== session.userId) throw new AuthError("invalid_code", 400);
  if (pending.expiresAt <= deps.now().getTime()) throw new AuthError("invalid_code", 400);
  // The counter's life starts at the first attempt and is never extended; it outlives the state by at most ten minutes.
  const attempts = await deps.kv.incr(badgeAttemptsKey(input.flowId), CODE_TTL_MS);
  if (attempts > MAX_CODE_ATTEMPTS) throw new AuthError("too_many_attempts", 429);

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

### Replace `apps/api/src/auth/flows/deletion.ts` (whole file)

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
 * Writes the cache tombstones of sessions the database has just revoked, so a cached copy cannot serve
 * them for the rest of its minute. Best effort: the rows are revoked whatever happens here, so a failure
 * only lets a cached copy live out that minute, and the account is not left half gone because the cache
 * was unreachable.
 */
async function tombstoneQuietly(deps: AuthDeps, userId: string, sessionIds: readonly string[]): Promise<void> {
  try {
    await deps.sessions.tombstone(sessionIds);
  } catch (err) {
    deps.log.error({ err, userId }, "account deletion: the session tombstones could not be written; the sessions are revoked in the database");
  }
}

/**
 * The auth side of a deletion, step 1 of section 7.6: the typed handle must be the account's own,
 * then the code must be right; then, in one transaction, the account is marked deleted (every lookup
 * treats the row as absent from here, so no request can succeed against it while the purge runs),
 * every session revoked, its devices and codes deleted and the event recorded; then the revoked
 * sessions get their tombstones, so the cache cannot revive one, and the account is told. Nothing
 * after the transaction can fail the request: the account is gone once it commits. The row itself is
 * anonymised by finishPurge, once the account module has purged the other schemas.
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

  const revoked = await deps.repo.takeDown(user.id, deps.now(), session.deviceId);
  await tombstoneQuietly(deps, user.id, revoked);
  // Told once the account is gone, and never before: a take-down that failed leaves the account as it was. The address
  // still belongs to the row until finishPurge; best effort, since no mail failure may keep an account its owner has given up.
  await notifyAccount(deps, user.email, "account_deleted");
}

/**
 * Step 4 of section 7.6, which the purge job runs for every account left half deleted: the rows of
 * step 1 again (sessions still live revoked with their tombstones, devices and codes deleted), for an
 * account marked deleted without the rest, then the row anonymised and marked purged. Both parts change
 * nothing for an account that is live or already purged, so the job can repeat it after any failure.
 */
export async function finishPurge(deps: AuthDeps, userId: string): Promise<void> {
  const revoked = await deps.repo.finishTakeDown(userId, deps.now());
  await tombstoneQuietly(deps, userId, revoked);
  await deps.repo.finishPurge(userId, deps.now());
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
 * What an undo link puts back: the address the account had, and when it left it (epoch milliseconds from
 * the flows' clock, the one passwordChangedAt and totpEnabledAt are written with, so the credential
 * check at the undo compares like with like).
 */
export interface PendingEmailRevert {
  userId: string;
  oldEmail: string;
  changedAt: number;
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
  const revertUrl = await openRevert(deps, { userId: user.id, oldEmail: user.email, changedAt: changedAt.getTime() });
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
 * account meanwhile), every session is signed out, every device revoked, and a password or two-factor
 * set up after the change is removed, so whoever made the change keeps no way in while the owner's own
 * credentials from before stay. The address the account was moved to is told nothing; the old one gets
 * a short note.
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
  const now = deps.now();
  try {
    await deps.repo.changeEmail(user.id, revert.oldEmail, now);
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("email_in_use", 409);
    throw err;
  }
  await deps.sessions.revokeAll(user.id);
  // Whoever made the change signed in from a device the account now knows; revoked, it counts as new at its next sign-in,
  // which mails the owner an alert with a "not me" link. The owner's own devices go too: no one can tell them apart here.
  await deps.repo.revokeDevices(user.id, now);
  // Only what was set after the change can be the work of whoever made it; what the owner had before stays.
  if (user.passwordHash !== null && user.passwordChangedAt !== null && user.passwordChangedAt.getTime() > revert.changedAt) {
    await deps.repo.setPasswordHash(user.id, null, now);
  }
  if (user.totpEnabledAt !== null && user.totpEnabledAt.getTime() > revert.changedAt) await deps.repo.disableTotp(user.id);
  // The link is spent, so the next change may send one again.
  await deps.kv.del(emailRevertOpenKey(user.id));
  await deps.repo.appendEvent({
    userId: user.id,
    type: "email_changed",
    ipHash: ctx.ipHash,
    metadata: { from: emailHash(deps.config.authHmacKey, user.email), to: emailHash(deps.config.authHmacKey, revert.oldEmail), reverted: true },
  });
  await notifyAccount(deps, revert.oldEmail, "email_change_reverted");
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

  return { issue, resolve, revoke, revokeAll, rotate, markReauth, forgetUser, isFresh, list, tombstone };
}

export type Sessions = ReturnType<typeof createSessions>;
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
  | "account_deleted";

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
          ? `If this was not you, open this link within 24 hours to move the account back to this address and sign out every session: ${data.revertUrl}`
          : "If this was not you: the address had already changed less than a day ago, and the link sent then, to the address the account had before, can still move the account back there and sign out every session.",
      ]);
    case "email_change_reverted":
      return build("Your korbat account is back at this address", [
        "Your korbat account is back at this address, moved back from the link sent when its address changed, and every session was signed out.",
        "Sign in with a code sent to this address. A password or two-factor authentication set up after the change was removed; set them up again from Security.",
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
  }
}
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
import { createMediaFiles, type StoredFile } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";
export type { StoredFile } from "./files";
export type { SweepReport } from "./sweeper";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account's images, and the data export. */
export interface MediaForAccount {
  /** Removes every image row of the owner, on a post or not, whatever its state, inside the account purge's transaction; the ids name the files to delete. */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /**
   * Asks the worker to delete the files of these images, whatever their state: an upload still waiting
   * in the uploads volume is removed first, as the sweeper removes one it gives up on, so no worker picks
   * it up after the account is gone (removing is idempotent, and costs nothing for an image whose upload
   * was taken already); then one empty request file per id, so asking twice is asking once. The account
   * purge asks inside its transaction, right after purgeOwner, so the requests are on disk before the rows
   * are gone for good.
   */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /**
   * The account's ready images, on a post or not, each with the checked open of its large variant: the
   * store is written by the worker and not trusted, so a file is read only when it is a plain file of the
   * store's own device no larger than a variant may be, and only up to the size that check measured
   * (null, and the export lists the image as missing, otherwise).
   */
  exportImages(ownerId: string): Promise<{ id: string; open(): Promise<StoredFile | null> }[]>;
}

/** The account module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForAccount(deps: MediaDeps): MediaForAccount {
  return {
    purgeOwner: (tx, ownerId) => deps.repo.purgeOwner(tx, ownerId),
    async requestDeletion(ids) {
      for (const id of ids) await deps.files.discardUpload(id);
      await deps.files.requestDeletion(ids);
    },
    exportImages: async (ownerId) => (await deps.repo.readyImages(ownerId)).map((id) => ({ id, open: () => deps.files.openImage(id, "large") })),
  };
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
  const forAccount = mediaForAccount(deps);
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

### Replace `apps/api/src/middleware/rate-limit.ts` (whole file)

```ts
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type Redis from "ioredis";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count plus ms until the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
  /**
   * Gives one hit back: lowers a positive counter for key by one and leaves its window as it is. Nothing
   * happens to a key without a counter or with none left. For a request that was counted and then failed
   * before it did anything, such as an export whose archive could not be started.
   */
  release(key: string): Promise<void>;
}

export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + windowMs });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.resetAt - t };
  }
  async release(key: string) {
    const b = this.buckets.get(key);
    // A window that is over holds nothing to give back; the next hit opens a fresh one either way.
    if (b && b.resetAt > this.now() && b.count > 0) b.count -= 1;
  }
}

const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {c, ttl}
`;

/**
 * Lowers the counter only while it exists and is positive, so a release never creates a key (which would
 * have no expiry) and never goes below zero. DECR keeps the key's expiry, so the window is not extended.
 */
const RELEASE_LUA = `
local c = tonumber(redis.call('GET', KEYS[1]))
if c and c > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

type RedisWithHit = Redis & {
  korbatRateHit(key: string, windowMs: number): Promise<[number, number]>;
  korbatRateRelease(key: string): Promise<number>;
};

export class RedisStore implements RateLimitStore {
  private readonly redis: RedisWithHit;
  constructor(redis: Redis) {
    redis.defineCommand("korbatRateHit", { numberOfKeys: 1, lua: LUA });
    redis.defineCommand("korbatRateRelease", { numberOfKeys: 1, lua: RELEASE_LUA });
    this.redis = redis as RedisWithHit;
  }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = await this.redis.korbatRateHit(`rl:${key}`, windowMs);
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
  async release(key: string) {
    await this.redis.korbatRateRelease(`rl:${key}`);
  }
}

export interface RateLimitOptions {
  name: string;
  store: RateLimitStore;
  limit: number;
  windowMs: number;
  key: (c: Context<AppEnv>) => string;
}

let outageLoggedAt = 0;

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let hit: { count: number; resetMs: number };
    try {
      hit = await opts.store.hit(`${opts.name}:${opts.key(c)}`, opts.windowMs);
    } catch (err) {
      // Fails closed, and says so once a minute rather than once per request.
      if (Date.now() - outageLoggedAt > 60_000) {
        outageLoggedAt = Date.now();
        c.get("log").error({ err, limiter: opts.name }, "rate limit store unavailable; refusing requests");
      }
      c.header("Retry-After", "30");
      return c.json(errorBody("service_unavailable", "Requests cannot be counted right now. Try again shortly.", c.get("requestId")), 503);
    }
    const { count, resetMs } = hit;
    const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
    c.header("RateLimit-Limit", String(opts.limit));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.limit - count)));
    c.header("RateLimit-Reset", String(resetSec));
    if (count > opts.limit) {
      c.header("Retry-After", String(resetSec));
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId")), 429);
    }
    await next();
  });
}

/** The client address the auth module's clientIdentity middleware resolved; "direct" before it ran. */
export function clientIp(c: Context<AppEnv>): string {
  return c.get("clientIp") ?? "direct";
}

/** The keyed hash of that address, shortened: the only form a rate-limit key may hold. */
export function clientIpKey(c: Context<AppEnv>): string {
  return (c.get("clientIpHash") ?? "direct").slice(0, 24);
}
```

### Replace `apps/api/src/social/flows/export.ts` (whole file)

```ts
import type { MediaView } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import type { ExportKey, ExportPage, ExportedPostRow, HandleRefRow, PostRefRow } from "../repo";

/** An image on one of the exported posts, as the media module reports it; the account module names its file in the archive. */
export interface ExportedMedia {
  id: string;
  altText: string;
  width: number;
  height: number;
}

export type ExportedPost = ExportedPostRow & { media: ExportedMedia[] };

/**
 * The social module's part of the data export (1b design, section 7.5): the profile with every handle
 * it ever had, every post it wrote whatever its state, with its images, what it liked, reposted and
 * bookmarked, and the accounts it follows, blocks and mutes by the handle they have now. Times are
 * Dates here; the account module writes them as ISO text.
 *
 * The profile is read at once; each list is read page by page while the account module writes it, so
 * an account with many rows never has them all in memory. A list can be iterated more than once; each
 * iteration reads it again from the start.
 */
export interface ProfileExport {
  profile: { handle: string; displayName: string; bio: string; createdAt: Date; handleHistory: string[] };
  posts: AsyncIterable<ExportedPost[]>;
  likes: AsyncIterable<PostRefRow[]>;
  reposts: AsyncIterable<PostRefRow[]>;
  bookmarks: AsyncIterable<PostRefRow[]>;
  following: AsyncIterable<HandleRefRow[]>;
  blocks: AsyncIterable<HandleRefRow[]>;
  mutes: AsyncIterable<HandleRefRow[]>;
}

/** Rows per page of an export list: one statement each, and at most this many rows of a list in memory at once. */
export const EXPORT_PAGE_SIZE = 1_000;

/**
 * A list read in keyset pages, in (created_at, id) order: each page starts after the key of the last row
 * of the page before, and is read only once that page has been used. The walk ends at a page that is not
 * full.
 */
function paged<T>(read: (after: ExportKey | null) => Promise<ExportPage<T>>): AsyncIterable<T[]> {
  return {
    async *[Symbol.asyncIterator]() {
      let after: ExportKey | null = null;
      do {
        const page: ExportPage<T> = await read(after);
        if (page.rows.length > 0) yield page.rows;
        after = page.next;
      } while (after !== null);
    },
  };
}

/** Each page of posts with its images, fetched from the media module for that page's posts only. */
function withMedia(deps: SocialDeps, pages: AsyncIterable<ExportedPostRow[]>): AsyncIterable<ExportedPost[]> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const rows of pages) {
        const media: Map<string, MediaView[]> = await deps.media.forPosts(rows.map((post) => post.id));
        yield rows.map((post) => ({
          ...post,
          media: (media.get(post.id) ?? []).map((view) => ({ id: view.id, altText: view.alt, width: view.width, height: view.height })),
        }));
      }
    },
  };
}

export async function exportProfile(deps: SocialDeps, userId: string, pageSize: number = EXPORT_PAGE_SIZE): Promise<ProfileExport> {
  const head = await deps.repo.exportHead(userId);
  if (!head) throw new SocialError("not_found", 404);

  // handle_history holds the handle chosen at onboarding and every one later left behind, so the current handle
  // is there only when the account went back to one it had before; the list names every handle, the current one included.
  const handleHistory = [...head.handleHistory];
  const current = head.profile.handle.toLowerCase();
  if (!handleHistory.includes(current)) handleHistory.push(current);

  return {
    profile: { handle: head.profile.handle, displayName: head.profile.displayName, bio: head.profile.bio, createdAt: head.profile.createdAt, handleHistory },
    posts: withMedia(
      deps,
      paged((after) => deps.repo.exportPosts(userId, after, pageSize)),
    ),
    likes: paged((after) => deps.repo.exportPostRefs(userId, "likes", after, pageSize)),
    reposts: paged((after) => deps.repo.exportPostRefs(userId, "reposts", after, pageSize)),
    bookmarks: paged((after) => deps.repo.exportPostRefs(userId, "bookmarks", after, pageSize)),
    following: paged((after) => deps.repo.exportHandleRefs(userId, "follows", after, pageSize)),
    blocks: paged((after) => deps.repo.exportHandleRefs(userId, "blocks", after, pageSize)),
    mutes: paged((after) => deps.repo.exportHandleRefs(userId, "mutes", after, pageSize)),
  };
}
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
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
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
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
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

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
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

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

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
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive).
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
        await lockLive(tx, sql`id = ${input.authorId}::uuid`);
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
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

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
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
        await lockLive(tx, actorAndAuthor(userId, postId));
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
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
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

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it (lockLive).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockLive(tx, sql`id in (${followerId}::uuid, ${followeeId}::uuid)`);
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
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
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
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
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
     * The data export's head: the live profile row and every handle in handle_history for it, in the order they
     * were recorded. Null when there is no live profile. The lists come page by page from the reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; handleHistory: string[] } | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`);
      return { profile: toProfile(r), handleHistory: history.map((row) => row.handle_lower) };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
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
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would).
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

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found"): Promise<void> {
  const found = (await tx.execute(sql`select deleted_at from profiles where ${accounts} for key share`)) as unknown as { deleted_at: string | null }[];
  if (found.some((row) => row.deleted_at !== null)) throw new SocialError(code, code === "not_found" ? 404 : 400);
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

### Replace `apps/app/.env.example` (whole file)

```text
# Used by `pnpm --filter @korbat/app web`. `node scripts/gen-dev-env.mjs` copies this to apps/app/.env.
# Cloudflare's always-pass Turnstile test key; the API on the host uses the matching test secret.
EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
# The dev web server (8081) calls the API on the host directly. The Docker web image leaves this unset
# and calls the API on its own origin through Caddy.
EXPO_PUBLIC_API_URL=http://localhost:3000
# The account settings show the verified badge section only when this is on. The development API runs the dev
# provider (VERIFY_PROVIDER=dev in apps/api/.env.example), so the development app shows it; the web image takes
# WEB_BADGE from infra/.env instead, off by default.
EXPO_PUBLIC_BADGE=on
```

### Replace `apps/app/src/app/settings/account.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type RefObject } from "react";
import { Platform, ScrollView, Text, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { BadgeVerifyResponse, DeleteStartResponse, EmailChangeResponse, FlowResponse, type MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { api, ApiError, apiResponse, errorMessage } from "@/lib/api";
import { exportFilename, saveBlob } from "@/lib/download";
import { useSession } from "@/lib/session";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/**
 * Expo inlines this public value into the web bundle at export time (WEB_BADGE in infra/.env). The
 * badge routes answer badge_unavailable when the API's verification provider is off, and there is no
 * harmless read to probe that with, so the section is shown only by a build that says "on"; the API's
 * provider is off by default, and so is this.
 */
const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";

const CODE = /^\d{6}$/;

/** One request at a time for a section, through the re-authentication hook, with its busy, error and done texts. */
function useAction(run: Run, describe: (err: unknown) => string = errorMessage) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Enter in a field calls the action as the button does, so the button's busy rule is here too: a second Enter while a request is out sends nothing.
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(action);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, done, setDone, act };
}

/**
 * Moves the focus to `target` when `away` turns false after being true: the section went back to the
 * step `target` is in, and the control that had the focus (Start over, Cancel, Change, Verify, Remove
 * badge) left the tree with the step it was in, which would drop the focus to the page body.
 */
function useFocusOnReturn(away: boolean, target: RefObject<{ focus(): void } | null>) {
  const wasAway = useRef(away);
  useEffect(() => {
    if (!away && wasAway.current) target.current?.focus();
    wasAway.current = away;
  }, [away, target]);
}

/** A new address gets a code; the account moves to it once the code is entered, and every session stays signed in. */
function EmailSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, setError, done, setDone, act } = useAction(run);
  const emailRef = useRef<TextInput>(null);
  // The code field takes the focus itself (autoFocus); Change and Start over bring the address field back, which takes it here.
  useFocusOnReturn(flowId !== null, emailRef);
  // The API would answer a generic invalid_request for the account's own address; it is refused here in its own words instead.
  const current = email.trim().toLowerCase() === me.user.email.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function start() {
    if (email.trim().length === 0) return;
    if (current) {
      setDone(null);
      setError("That is already your email address.");
      return;
    }
    await act(async () => {
      const flow = await api("/api/auth/email/change/start", { json: { email: email.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      const changed = await api("/api/auth/email/change/verify", { json: { flowId, code: code.trim() }, schema: EmailChangeResponse });
      setFlowId(null);
      setEmail("");
      setCode("");
      setDone(`Your email address is now ${changed.email}.`);
      // The address shown here and on the security screen reads the session.
      await refresh();
    });
  }

  return (
    <View>
      <Body>Your address is {me.user.email}. Sign-in codes and security messages go there, and nobody else sees it.</Body>
      {flowId ? (
        <>
          <Body>We sent a code to {email.trim()}. Enter it to move your account to that address. Every session stays signed in.</Body>
          <Field label="Code from the email" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Change" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={emailRef} label="New email address" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={() => void start()} />
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />
        </>
      )}
    </View>
  );
}

/** The API reuses the email flows' code errors, whose wording points at an email; the badge's code came by text message. */
function badgeMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_code") return "That code is not right. Check the text message.";
  if (err instanceof ApiError && err.code === "code_expired") return "That code has expired. Send a new one.";
  return errorMessage(err);
}

/** Holding the badge, verifying a number, or removing it; each needs fresh authentication. */
function BadgeSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [phone, setPhone] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run, badgeMessage);
  const verified = me.profile?.verified === true;
  const phoneRef = useRef<TextInput>(null);
  const removeRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus). Start over and a removed badge bring the phone field back, and a verified
  // badge brings Remove badge: each takes the focus when its step returns.
  useFocusOnReturn(verified || flowId !== null, phoneRef);
  useFocusOnReturn(!verified, removeRef);

  // Enter in the field calls this as the button does, so the button's condition comes first.
  async function start() {
    if (phone.trim().length === 0) return;
    await act(async () => {
      const flow = await api("/api/auth/badge/start", { json: { phone: phone.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      await api("/api/auth/badge/verify", { json: { flowId, code: code.trim() }, schema: BadgeVerifyResponse });
      setFlowId(null);
      setPhone("");
      setCode("");
      setDone("Your account is now verified.");
      // The chip on posts and the profile, and this section, read the session.
      await refresh();
    });
  }

  const remove = () =>
    act(async () => {
      await api("/api/auth/badge", { method: "DELETE" });
      setDone("The badge was removed.");
      await refresh();
    });

  return (
    <View>
      <Body>
        The Verified badge means you hold a phone number that no other account uses. To check it, the number is handed to the verification provider for one text message; korbat
        keeps it only as a keyed hash, never the number itself.
      </Body>
      {verified ? (
        <>
          <Body>Your account holds the badge.</Body>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button ref={removeRef} label="Remove badge" onPress={() => void remove()} busy={busy} tone="danger" />
        </>
      ) : flowId ? (
        <>
          <Body>We texted a code to {phone.trim()}.</Body>
          <Field label="Code from the text message" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={phoneRef} label="Phone number" autoComplete="tel" inputMode="tel" placeholder="+447911123456" value={phone} onChangeText={setPhone} onSubmitEditing={() => void start()} />
          <Text className="mt-1 text-xs text-zinc-400">International format: a plus sign, the country code and the number, without the leading zero.</Text>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={phone.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The export's own words for its daily limit: the generic "wait a moment" would be wrong for a window of a day. */
export function exportMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "rate_limited" && err.retryAfter) {
    const hours = Math.ceil(err.retryAfter / 3600);
    return hours <= 1 ? "You exported your data today already. You can export again in about an hour." : `You exported your data today already. You can export again in about ${hours} hours.`;
  }
  return errorMessage(err);
}

/**
 * The ZIP comes back as the response body, so the raw response is turned into a file the browser saves;
 * native has no downloads folder to offer. The API fails the body when the archive breaks off part way,
 * so res.blob() rejects and the section shows an error, never the note that the export was downloaded.
 */
function ExportSection({ run }: { run: Run }) {
  const { busy, error, done, setDone, act } = useAction(run, exportMessage);

  const download = () =>
    act(async () => {
      const res = await apiResponse("/api/account/export", { method: "POST" });
      saveBlob(await res.blob(), exportFilename(res.headers.get("content-disposition")));
      setDone("Your export was downloaded.");
    });

  return (
    <View>
      <Body>
        The archive is a ZIP with export.json (your account, profile, posts, likes, reposts, bookmarks, follows, blocks, mutes, sessions, devices and security events) and every
        image you uploaded. It holds your email address, so keep it somewhere private. You can export once a day.
      </Body>
      {Platform.OS === "web" ? (
        <>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Download my data" onPress={() => void download()} busy={busy} />
        </>
      ) : (
        <Body>Export your data from the web app.</Body>
      )}
    </View>
  );
}

/** Deletion needs an emailed code and the handle typed back; the API takes the account down at once and this session with it. */
function DeleteSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, act } = useAction(run);
  const handle = me.profile?.handle ?? "";
  const typedHandle = typed.trim().replace(/^@/, "").toLowerCase();
  // The API compares the typed handle case-insensitively and answers a mismatch as a generic invalid request; the same rule here keeps the button off until it matches.
  const matches = typedHandle.length > 0 && typedHandle === handle.toLowerCase();
  const sendRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus); Cancel brings "Send me a code" back, which takes it here.
  useFocusOnReturn(flowId !== null, sendRef);

  const start = () =>
    act(async () => {
      const flow = await api("/api/account/delete/start", { method: "POST", schema: DeleteStartResponse });
      setCode("");
      setTyped("");
      setFlowId(flow.flowId);
    });

  // The button's condition comes first, as in every other action of this screen.
  async function confirm() {
    if (!CODE.test(code.trim()) || !matches) return;
    await act(async () => {
      await api("/api/account/delete/confirm", { json: { flowId, code: code.trim(), handle: typedHandle } });
      // The API cleared the cookies: the session reloads as signed out, and the home page is public.
      await refresh();
      router.replace("/");
    });
  }

  return (
    <View>
      <Body>
        Deleting your account removes your posts and images, and your likes, reposts, bookmarks, follows, blocks and mutes. Your handle stays reserved, so nobody can take it.
        This cannot be undone.
      </Body>
      {flowId ? (
        <>
          <Body>We emailed a code to {me.user.email}.</Body>
          <Field label="Code from the email" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} />
          <Field label="Type your handle to confirm" autoCapitalize="none" autoComplete="off" placeholder={`@${handle}`} value={typed} onChangeText={setTyped} />
          <ErrorText message={error} />
          <Button label="Delete my account" onPress={() => void confirm()} busy={busy} disabled={!CODE.test(code.trim()) || !matches} tone="danger" />
          <Button
            label="Cancel"
            onPress={() => {
              setFlowId(null);
              setCode("");
              setTyped("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button ref={sendRef} label="Send me a code" onPress={() => void start()} busy={busy} tone="secondary" />
        </>
      )}
    </View>
  );
}

export default function AccountSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Account
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile?.handle}</Text>
        <SettingsNav current="account" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Email address">
          <EmailSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        {BADGE_SHOWN ? (
          <Section title="Verified badge">
            <BadgeSection me={me} run={reauth.run} refresh={refresh} />
          </Section>
        ) : null}
        <Section title="Data export">
          <ExportSection run={reauth.run} />
        </Section>
        <Section title="Delete account">
          <DeleteSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/profile.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { BIO_MAX_LENGTH, postLength, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

/** The DisplayName contract's limit, in the code points the counter shows. */
const DISPLAY_NAME_MAX = 50;
/** The API lets a handle change again this long after the last change (1b design, section 7.2); mirrored so the date shows before a refused attempt. */
const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

function Counter({ length, max }: { length: number; max: number }) {
  return (
    <Text className={`mt-1 text-right text-xs ${length > max ? "text-red-400" : "text-zinc-400"}`}>
      {length}/{max}
    </Text>
  );
}

/** Display name and bio. /api/me carries no bio, so the form starts from the public profile, which has both. */
function ProfileForm({ handle, refresh }: { handle: string; refresh: Refresh }) {
  const [saved, setSaved] = useState<ProfileView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    social
      .profile(handle)
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDisplayName(profile.displayName);
        setBio(profile.bio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const name = displayName.trim();
  const text = bio.trim();
  const nameLength = postLength(name);
  const bioLength = postLength(text);
  const changed = saved !== null && (name !== saved.displayName || text !== saved.bio);
  const ready = changed && nameLength >= 1 && nameLength <= DISPLAY_NAME_MAX && bioLength <= BIO_MAX_LENGTH;

  // Enter in the bio calls this as the button does, so the button's conditions come first: nothing unchanged or invalid is
  // sent, and a second Enter while the first request is out sends nothing.
  async function save() {
    if (!saved || !ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Only what changed is sent: the contract refuses an empty edit, and the server records an event per call.
      const { profile } = await social.editProfile({ ...(name !== saved.displayName ? { displayName: name } : {}), ...(text !== saved.bio ? { bio: text } : {}) });
      setSaved(profile);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setDone("Profile saved.");
      // The shell's Profile link and the profile page read the session, so it follows the new name.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? <ErrorText message={error} /> : <Text className="mt-3 text-sm text-zinc-400">Loading your profile...</Text>;
  }
  return (
    <View>
      <Body>Your display name is shown next to your posts. The bio is one line on your profile.</Body>
      <Field label="Display name" autoComplete="name" value={displayName} onChangeText={setDisplayName} />
      <Counter length={nameLength} max={DISPLAY_NAME_MAX} />
      {/* The Bio contract refuses control characters, which a line break is, so the field stays single-line. */}
      <Field label="Bio" value={bio} onChangeText={setBio} onSubmitEditing={() => void save()} />
      <Counter length={bioLength} max={BIO_MAX_LENGTH} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}

/** The handle and its 30-day rule. The change needs fresh authentication, so it runs through useReauth. */
function HandleSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const current = me.profile?.handle ?? "";
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The moment a handle_cooldown answer named through Retry-After; until one comes, the last change plus 30 days says it.
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const fromLastChange = me.profile?.handleChangedAt ? new Date(me.profile.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS : null;
  const until = refusedUntil ?? fromLastChange;
  const allowedAt = until !== null && until > Date.now() ? new Date(until) : null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const ready = normalized.length > 0 && normalized !== current.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function change() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        const { profile } = await social.changeHandle(normalized);
        setHandle("");
        setRefusedUntil(null);
        setDone(`Your handle is now @${profile.handle}. The old one stays reserved for you.`);
        // The shell's Profile link and this screen's heading read the session.
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_cooldown") setRefusedUntil(err.retryAfter ? Date.now() + err.retryAfter * 1000 : fromLastChange);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Body>Your handle is @{current}. You can change it once every 30 days. Handles you used before stay yours.</Body>
      {allowedAt ? <Text className="mt-2 text-sm text-amber-300">Your next change is allowed on {allowedAt.toLocaleDateString()}.</Text> : null}
      <Field label="New handle" autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} onSubmitEditing={() => void change()} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Change handle" onPress={() => void change()} busy={busy} disabled={!ready} />
    </View>
  );
}

export default function ProfileSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;
  // The settings layout sends an account without a handle to onboarding, so the profile is there; the type still allows null.
  if (!me.profile) return <Loading />;

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Profile
        </Text>
        <Text className="mt-2 text-base text-zinc-400">@{me.profile.handle}</Text>
        <SettingsNav current="profile" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Name and bio">
          <ProfileForm handle={me.profile.handle} refresh={refresh} />
        </Section>
        <Section title="Handle">
          <HandleSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/ui.tsx` (whole file)

```tsx
import type { ReactNode, Ref } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { Link, type Href } from "expo-router";

/** A centred column on the dark background, used by every auth screen. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6 py-10">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="mt-2 text-base leading-6 text-zinc-400">{children}</Text>;
}

/** A titled box on a settings screen; the title is a heading one level under the screen's own. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-xl border border-zinc-800 p-5">
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * The verified badge after a display name: the account proved it holds a phone number that no other
 * account uses. The label says what the one word means to a screen reader. The chip is an image to
 * assistive technology: ARIA forbids naming an element without a role, and screen readers ignore such
 * a name, while an image is announced by it.
 */
export function VerifiedChip() {
  return (
    <View role="img" accessibilityLabel="verified account" className="self-center rounded-full bg-sky-950 px-2 py-0.5">
      <Text className="text-xs font-medium text-sky-300">Verified</Text>
    </View>
  );
}

/** A labelled text field. `ref` reaches the input itself, whose focus() moves the browser's focus to it. */
export function Field({ label, ref, ...input }: { label: string; ref?: Ref<TextInput> } & TextInputProps) {
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor="#a1a1aa"
        className="mt-2 rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-3 text-base text-zinc-50"
        {...input}
      />
    </View>
  );
}

/** A full-width button. `ref` reaches the pressable itself, whose focus() moves the browser's focus to it. */
export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  ref,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  ref?: Ref<View>;
}) {
  const inactive = disabled || busy;
  const surface = inactive ? "bg-zinc-800" : tone === "primary" ? "bg-zinc-50" : tone === "danger" ? "bg-red-600" : "border border-zinc-600";
  const text = inactive ? "text-zinc-400" : tone === "primary" ? "text-zinc-950" : "text-zinc-50";
  return (
    <Pressable ref={ref} accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} className={`mt-6 rounded-lg px-4 py-3 ${surface}`}>
      <Text className={`text-center text-base font-semibold ${text}`}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

/**
 * A small link under a form. It is a real anchor (expo-router's Link), so it opens with Enter, in a
 * new tab with a modifier key, and by every other means a link works. `onPress` runs before the
 * navigation, for a flow that has to forget its state first.
 */
export function TextLink({ label, href, replace = false, onPress }: { label: string; href: Href; replace?: boolean; onPress?: () => void }) {
  return (
    <Link href={href} replace={replace} onPress={onPress} asChild>
      <Pressable className="mt-6">
        <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
      </Pressable>
    </Link>
  );
}

/** The same look for an action that is not a destination, such as switching a form's mode. */
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="mt-6">
      <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="mt-4 text-sm text-red-400">
      {message}
    </Text>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-300">{message}</Text>;
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950">
      <ActivityIndicator color="#fafafa" accessibilityLabel="Loading" />
    </View>
  );
}
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09
# Who checks the phone number behind the verified badge: off turns the badge off, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
# Whether the web app's account settings show the verified badge section: on or off. Set it together with
# API_VERIFY_PROVIDER: off while that is off, on once it is dev or vonage (a section shown without a provider
# answers every Send code with "Verification is not available"). The web image reads it as EXPO_PUBLIC_BADGE,
# which Expo inlines at export time.
WEB_BADGE=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel's public hostname must point at http://caddy:8080.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
# Whether the account settings show the verified badge section (WEB_BADGE in infra/.env): on only when the API's
# verification provider is on, off by default as the provider is. Anything else is refused, so a typo cannot hide or show it.
ARG EXPO_PUBLIC_BADGE=off
RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" npx expo export --platform web

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Port 8080 needs no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on a port it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8080
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app and proxies /api. It runs as its own user on port 8080, sees only the
  # API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
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
]);
export type ReauthRequest = z.infer<typeof ReauthRequest>;

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
 * The signed-in account's own profile, as /me and the profile-editing routes return it: the public facts
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

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { FORBIDDEN_FORMAT, visibleLength } from "./text";

/** Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. */
const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order. Always present, often empty. */
  media: z.array(MediaView),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

export const PostView = z.object({ ...postFields, quoteOf: z.union([QuotedPost, Tombstone]).nullable() });
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
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
packages/contracts test:       Tests  64 passed (64)
packages/db test:       Tests  22 passed (22)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  283 passed | 200 skipped (483)
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
Tests  198 passed (198)
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

## Step 8: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 9: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 10: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 11: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 12: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 13: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 14: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 15: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 16: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/deletion.ts`
- `apps/api/src/account/flows/export.ts`
- `apps/api/src/account/routes.ts`
- `apps/api/src/account/zip.ts`
- `apps/api/src/auth/flows/badge.ts`
- `apps/api/src/auth/flows/deletion.ts`
- `apps/api/src/auth/flows/email-change.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/routes.ts`
- `apps/api/src/auth/sessions.ts`
- `apps/api/src/mail/mailer.ts`
- `apps/api/src/mail/templates.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/middleware/rate-limit.ts`
- `apps/api/src/social/flows/export.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/test/account/deletion.test.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/auth/badge.test.ts`
- `apps/api/test/auth/deletion.test.ts`
- `apps/api/test/auth/email-change.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/integration/account-deletion.test.ts`
- `apps/api/test/integration/account-export.test.ts`
- `apps/api/test/integration/account-takedown.test.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/api/test/integration/http-e2e.test.ts`
- `apps/api/test/integration/rate-limit-redis.test.ts`
- `apps/api/test/integration/social-repo.test.ts`
- `apps/api/test/mail/templates.test.ts`
- `apps/api/test/middleware.test.ts`
- `apps/api/test/social/limits.test.ts`
- `apps/app/.env.example`
- `apps/app/src/app/email-revert/[token].tsx`
- `apps/app/src/app/settings/account.tsx`
- `apps/app/src/app/settings/profile.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/test/lifecycle.test.tsx`
- `apps/app/vitest.config.mts`
- `infra/.env.example`
- `infra/caddy/Dockerfile`
- `infra/compose.yml`
- `packages/contracts/src/auth.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/auth.test.ts`
- `packages/contracts/test/social.test.ts`

## Step 17: commit

```bash
git add -A
git commit -q -m "fix(account): what the review of 1b upheld, fixed: badge attempts are counted atomically and badge starts are limited per IP and instance-wide; a one-shot link lets the old address undo an email change; the deletion's first step is one transaction that the purge repeats, the purge requests its file deletions (pending uploads too) before committing, and every social write takes a key-share lock so none lands on a purged account; the export writes a ZIP64-capable archive, streams export.json in pages, opens images through the media checks, gives the day back on an early failure and breaks the download on a late one; plus the web and contract fixes listed in the 1b design's amendments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(account): what the review of 1b upheld, fixed: badge attempts are counted atomically and badge starts are limited per IP and instance-wide; a one-shot link lets the old address undo an email change; the deletion's first step is one transaction that the purge repeats, the purge requests its file deletions (pending uploads too) before committing, and every social write takes a key-share lock so none lands on a purged account; the export writes a ZIP64-capable archive, streams export.json in pages, opens images through the media checks, gives the day back on an early failure and breaks the download on a late one; plus the web and contract fixes listed in the 1b design's amendments`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 48>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
