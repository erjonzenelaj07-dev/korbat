import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { AccountDeps } from "../../src/account/context";
import { purgePending } from "../../src/account/purge";
import { mediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { fileAppeal } from "../../src/moderation/appeals";
import { TAKE_DOWN_SETTLE_MS, fileReply, takeDownDue } from "../../src/moderation/standing";
import { terminationsDue } from "../../src/moderation/standing-repo";
import { exportProfile } from "../../src/social/flows/export";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, deciderWorld, terminateForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, ageStandingForTest, decisionParams, gate, untilBlocked, type DecisionInput } from "./moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "./notices-harness";
import { socialHarness, type SocialHarness } from "./social-harness";

// Every termination is a chain of confirmed decisions, each a round of the step-up flow: slow on a loaded machine.
vi.setConfig({ testTimeout: 300_000 });

/**
 * Termination and its take-down (3e design, sections 5 (the lock order, item 5), 6.2 terminations_due and 7.8; section
 * 12.1, invariants 14 and 21): a termination is taken down only once it is final for its author, never during the
 * window, while an appeal waits, while a reply, on time or late, is unanswered, or after a lift; the purge round's step
 * holds the account's profile and then the terminating decision's case before it reads again, so a lift that commits
 * first takes the account out and nothing is mailed; the auth module's take-down mails termination_final once, after its
 * commit, in place of account_deleted; a take-down that fails mails nothing, is counted, and never holds an ordinary
 * deletion of the same round. The terminations are terminateForTest's (moderation-decide.ts); the answers, lifts and
 * reviews are confirmed by this file's own staff keys and mailed through the notices world's auth module.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: termination and its take-down", () => {
  let n: NoticesWorld;
  let world: DeciderWorld;
  let admin: RealStaff;
  /** An admin who takes no part in any case of this file: the reviewer of a termination's appeal. */
  let reviewer: RealStaff;
  let m: MediaHarness;
  let s: SocialHarness;
  let before: Record<string, number>;
  /** The accounts this file's purge rounds may purge: only its own, so a deletion another suite left is never touched here. */
  const mine = new Set<string>();

  beforeAll(async () => {
    n = noticesWorld();
    world = deciderWorld(n.apiDb, { auth: n.authForModeration });
    admin = await world.staff("admin");
    reviewer = await world.staff("admin");
    m = await mediaHarness(n.apiDb);
    s = socialHarness(n.apiDb);
    before = await n.counts();
  }, 300_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await n.cleanUp();
      await world.close();
    } finally {
      m.cleanup();
      await n.close();
    }
  }, 300_000);

  /** The account module's dependencies as the server composes them, its purge reading only this file's deletions. */
  const accountDeps = (overrides: Partial<AccountDeps["auth"]> = {}): AccountDeps => ({
    auth: { ...n.auth.forAccount, pendingPurges: async () => (await n.auth.forAccount.pendingPurges()).filter((id) => mine.has(id)), ...overrides },
    social: { purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within), exportProfile: (userId) => exportProfile(s.deps, userId) },
    media: mediaForAccount(m.deps),
    moderation: n.moderation.forAccount,
    limits: new MemoryStore(),
    log: n.deps.log,
    now: () => new Date(),
  });
  /** An onboarded account of this file. */
  async function account() {
    const made = await n.account();
    mine.add(made.id);
    return made;
  }
  /** A confirmed decision by this file's admin: its id, or a failure that says why none was recorded. */
  async function decided(caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await world.decideAs(admin, caseId, input);
    if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
    return outcome.decisionId;
  }
  const isDue = async (accountId: string) => (await terminationsDue(n.apiDb)).some((row) => row.accountId === accountId);
  /** Ages the account's ledger past the six months of its termination's appeal, as the migrator. */
  const pastTheAppeal = (accountId: string) => ageStandingForTest(world.migrateDb, accountId, "7 months");
  const authDeletedAt = async (id: string) => (await n.authDb.execute<{ deleted_at: Date | null }>(sql`select deleted_at from auth.users where id = ${id}::uuid`))[0]?.deleted_at ?? null;

  test("not due during the window; due once the decision is final for its author; the purge round takes the account down, mails termination_final once and purges it in the same round, and a second round does nothing", async () => {
    const ada = await account();
    const terminated = await terminateForTest(n.apiDb, ada.id);
    expect((await n.moderation.standingFor(ada.id))?.measure).toMatchObject({ decisionId: terminated.decisionId, kind: "terminate", state: "running", days: null, endsAt: null });
    expect(await isDue(ada.id)).toBe(false);
    await pastTheAppeal(ada.id);
    const [due] = (await terminationsDue(n.apiDb)).filter((row) => row.accountId === ada.id);
    expect(due).toMatchObject({ accountId: ada.id, caseId: terminated.caseId });

    const report = await purgePending(accountDeps());
    expect(report).toMatchObject({ terminated: 1, failed: 0 });
    expect(report.purged).toBeGreaterThanOrEqual(1);
    expect(await authDeletedAt(ada.id)).not.toBeNull();
    const [profile] = await n.apiDb.execute<{ deleted: boolean }>(sql`select deleted_at is not null as deleted from profiles where id = ${ada.id}::uuid`);
    expect(profile?.deleted).toBe(true);
    // termination_final, once, in place of account_deleted, with the decision's day and no sentence on sealed images.
    const mails = n.mailer.to(ada.email, "termination_final");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.data).toEqual({ decided: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC$/), imagesSealed: "false" });
    expect(n.mailer.to(ada.email, "account_deleted")).toEqual([]);
    const [event] = await n.authDb.execute<{ metadata: Record<string, unknown> }>(sql`select metadata from auth.auth_events where user_id = ${ada.id}::uuid and type = 'account_deleted'`);
    expect(event?.metadata).toEqual({ terminated: true });
    // The account is gone: no longer due, nothing taken down again, no second mail; the auth module's take-down of an
    // account already marked deleted writes and mails nothing and answers false.
    expect(await isDue(ada.id)).toBe(false);
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 0, failed: 0 });
    expect(await n.auth.forAccount.takeDownTerminated(ada.id, { decidedAt: new Date(), imagesSealed: false })).toBe(false);
    expect(n.mailer.to(ada.email, "termination_final")).toHaveLength(1);
  });

  test("a pending appeal keeps the account out, also past the six months, until a review keeps the decision", async () => {
    const bob = await account();
    const terminated = await terminateForTest(n.apiDb, bob.id);
    await fileAppeal(n.deps, bob.id, terminated.decisionId, {});
    await pastTheAppeal(bob.id);
    expect(await isDue(bob.id)).toBe(false);
    expect((await n.moderation.standingFor(bob.id))?.measure).toMatchObject({ appealPending: true, appealUntil: null });
    // A termination is reviewed by an admin who took no part.
    const outcome = await world.reviewAs(reviewer, terminated.decisionId, { outcome: "kept" });
    expect(typeof outcome).not.toBe("string");
    expect(await isDue(bob.id)).toBe(true);
    // The take-down waits until the decision has been final for a while (TAKE_DOWN_SETTLE_MS): an appeal in flight at a
    // deadline has settled by then. Just after the answer the round leaves it; once that while has passed it takes it down.
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 0, failed: 0 });
    await ageStandingForTest(world.migrateDb, bob.id, `${TAKE_DOWN_SETTLE_MS / 1000 + 1} seconds`);
    // The round takes it down, so no later round of this file meets it again.
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 1, failed: 0 });
  });

  test("a late reply nobody answered keeps a final termination out, and the kept answer to it lets it be due; a lift keeps it out for good", async () => {
    const carl = await account();
    const terminated = await terminateForTest(n.apiDb, carl.id);
    // A reply to a measure taken at once is always late.
    expect(await fileReply(n.deps, carl.id, terminated.decisionId, { statement: "Please look again." })).toMatchObject({ onTime: false });
    await pastTheAppeal(carl.id);
    expect(await isDue(carl.id)).toBe(false);
    await decided(terminated.caseId, { kind: "correction", outcome: "kept", reviewsDecisionId: terminated.decisionId });
    expect(await isDue(carl.id)).toBe(true);
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 1, failed: 0 });
    // The kept answer to a late reply is mailed as reply_answered.
    expect(n.mailer.to(carl.email, "reply_answered").map((mail) => mail.data.outcome)).toEqual(["kept"]);

    const dora = await account();
    const lifted = await terminateForTest(n.apiDb, dora.id);
    await decided(lifted.caseId, { kind: "correction", reviewsDecisionId: lifted.decisionId, actions: [act("lift_suspension")] });
    await pastTheAppeal(dora.id);
    expect(await isDue(dora.id)).toBe(false);
    expect((await n.moderation.standingFor(dora.id))?.measure).toBeNull();
  });

  test("the take-down holds the profile, then the terminating decision, then reads again: a lift that waited at its case commits first, and the take-down then finds the account no longer due and mails nothing", async () => {
    const eve = await account();
    const terminated = await terminateForTest(n.apiDb, eve.id);
    await pastTheAppeal(eve.id);
    expect(await isDue(eve.id)).toBe(true);
    // The lift's params and its confirmation are made first: they read the case and save its reason, which the blocker
    // below would hold back before the lift's own transaction had taken the profile.
    const params = await decisionParams(n.apiDb, admin, terminated.caseId, { kind: "correction", reviewsDecisionId: terminated.decisionId, actions: [act("lift_suspension")] });
    const confirmed = await world.confirm(admin, terminated.caseId, params);
    // A blocker holds the termination's case, so the lift's transaction holds the profile and waits there.
    const release = gate();
    const held = gate();
    const blocker = world.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await tx.execute(sql`select 1 from cases where id = ${terminated.caseId}::uuid for update`);
      held.open();
      await release.opened;
    });
    let lift: Promise<unknown> | null = null;
    let taken: Promise<{ terminated: number; failed: number }> | null = null;
    const called: string[] = [];
    try {
      await held.opened;
      lift = world.moderation.forStaff.decide(admin.session, confirmed, { requestId: `req-${randomUUID()}` });
      await untilBlocked(n.apiDb, "insert into decisions", 60_000);
      // The take-down reads the account as due (the lift has not committed), then waits for the profile the lift holds.
      taken = takeDownDue(n.deps, async (accountId) => {
        called.push(accountId);
        return true;
      });
      await untilBlocked(n.apiDb, "order by id for update", 60_000);
      release.open();
      await blocker;
      expect(typeof (await lift)).not.toBe("string");
      await world.moderation.settle();
      expect(await taken).toMatchObject({ failed: 0 });
      expect(called).not.toContain(eve.id);
      expect(n.mailer.to(eve.email, "termination_final")).toEqual([]);
      expect(await authDeletedAt(eve.id)).toBeNull();
    } finally {
      release.open();
      await blocker.catch(() => undefined);
      await lift?.catch(() => undefined);
      await taken?.catch(() => undefined);
    }
  });

  test("a take-down that fails mails nothing and is counted in failed, the round still purges an ordinary deletion, and the next round takes the account down", async () => {
    const fay = await account();
    await terminateForTest(n.apiDb, fay.id);
    await pastTheAppeal(fay.id);
    const gus = await account();
    // Gus deletes his own account: the take-down of step 1, as 1b's confirmation runs it.
    await n.repo.takeDown(gus.id, new Date(), null);
    const failing = accountDeps({
      takeDownTerminated: async () => {
        throw new Error("the auth pool is down");
      },
    });
    const report = await purgePending(failing);
    expect(report).toMatchObject({ terminated: 0, failed: 1, purged: 1 });
    const [gusProfile] = await n.apiDb.execute<{ deleted: boolean }>(sql`select deleted_at is not null as deleted from profiles where id = ${gus.id}::uuid`);
    expect(gusProfile?.deleted).toBe(true);
    expect(n.mailer.to(fay.email, "termination_final")).toEqual([]);
    expect(await authDeletedAt(fay.id)).toBeNull();
    // The next round, with the auth module up: taken down, mailed once, purged.
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 1, failed: 0, purged: 1 });
    expect(n.mailer.to(fay.email, "termination_final")).toHaveLength(1);
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await closeDecisions();
    await world.moderation.settle();
    await n.cleanUp();
    expect(await n.counts()).toEqual(before);
  });
});
