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
