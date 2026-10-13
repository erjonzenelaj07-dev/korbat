import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { AccountDeps } from "../../src/account/context";
import { purgePending } from "../../src/account/purge";
import { takeDownTerminated as takeDownFlow } from "../../src/auth/flows/deletion";
import { mediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { fileAppeal } from "../../src/moderation/appeals";
import { TAKE_DOWN_SETTLE_MS, fileReply, takeDownDue } from "../../src/moderation/standing";
import { lockTerminatingDecision, terminationsDue } from "../../src/moderation/standing-repo";
import { exportProfile } from "../../src/social/flows/export";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, deciderWorld, terminateForTest, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { aPost, act, ageStandingForTest, appealOf, decisionParams, gate, imagePost, report, untilBlocked, type DecisionInput } from "./moderation-fixtures";
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

  // ---------------------------------------------------------------- what the review of the built code added

  /** A termination final for its author long enough for the take-down: past the six months, and past the settling while. */
  async function dueForTakeDown(accountId: string) {
    const terminated = await terminateForTest(n.apiDb, accountId);
    await pastTheAppeal(accountId);
    await ageStandingForTest(world.migrateDb, accountId, `${TAKE_DOWN_SETTLE_MS / 1000 + 1} seconds`);
    return terminated;
  }
  /** What the promise settled with within `ms`, or "still waiting". */
  const within = <T>(ms: number, promise: Promise<T>): Promise<T | "still waiting"> =>
    Promise.race([promise, new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), ms))]);

  test("a reply that waited at the profile behind the take-down is refused once the take-down committed, and nothing of it is stored", async () => {
    // 3e's review (proofs3): the auth row is marked deleted by the take-down; the profile only by the purge after it.
    const hal = await account();
    const terminated = await dueForTakeDown(hal.id);
    const entered = gate();
    const release = gate();
    const taking = takeDownDue(n.deps, async (accountId, facts) => {
      if (accountId !== hal.id) return false;
      entered.open();
      await release.opened;
      return n.auth.forAccount.takeDownTerminated(accountId, facts);
    });
    let replied: Promise<unknown> | null = null;
    try {
      await entered.opened;
      replied = fileReply(n.deps, hal.id, terminated.decisionId, { statement: "Please look again." }).then(
        () => "stored",
        (err: unknown) => String((err as { code?: unknown }).code ?? err),
      );
      await untilBlocked(n.apiDb, "order by id for update", 60_000);
    } finally {
      release.open();
    }
    expect(await taking).toMatchObject({ terminated: 1, failed: 0 });
    expect(await replied).toBe("reply_not_open");
    expect((await n.apiDb.execute(sql`select 1 from suspension_replies where account_id = ${hal.id}::uuid`)).length).toBe(0);
    expect(await authDeletedAt(hal.id)).not.toBeNull();
  });

  test("the take-down against an appeal at its deadline, the appeal first: one in flight holds the terminating decision's row by its foreign key, the take-down waits for it there, reads it and leaves the account", async () => {
    // 3e's review (proofs4). The appeal is filed while its window is open, and stays in flight: its foreign key holds the
    // decision's row FOR KEY SHARE until it commits. Meanwhile the deadline and the settling while pass (the migrator
    // moves the ledger back, which that lock does not hold up), so the take-down finds the account due.
    const ida = await account();
    const terminated = await terminateForTest(n.apiDb, ida.id);
    const held = gate();
    const release = gate();
    const appeal = world.migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await appealOf(tx, terminated.decisionId, ida.id);
      held.open();
      await release.opened;
    });
    const called: string[] = [];
    let taken: Promise<{ terminated: number; failed: number }> | null = null;
    try {
      await held.opened;
      await pastTheAppeal(ida.id);
      await ageStandingForTest(world.migrateDb, ida.id, `${TAKE_DOWN_SETTLE_MS / 1000 + 1} seconds`);
      expect(await isDue(ida.id)).toBe(true);
      taken = takeDownDue(n.deps, async (accountId) => {
        called.push(accountId);
        return false;
      });
      await untilBlocked(n.apiDb, "d.id desc limit 1 for update", 60_000);
    } finally {
      release.open();
      await appeal;
    }
    expect(await taken).toMatchObject({ failed: 0 });
    expect(called).not.toContain(ida.id);
    expect(await isDue(ida.id)).toBe(false);
    expect(await authDeletedAt(ida.id)).toBeNull();
  });

  test("the take-down against an appeal at its deadline, the take-down first: while it holds the terminating decision's row, an appeal filed in time waits for it and lands only after the take-down's transaction ends", async () => {
    const jon = await account();
    const terminated = await terminateForTest(n.apiDb, jon.id);
    const held = gate();
    const release = gate();
    // The take-down's two locks, as takeDownDue takes them, held open: the profile, then the terminating decision's row.
    const holding = n.apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '60s'`);
      await n.deps.social.lockAccounts(tx, [jon.id], "update");
      expect(await lockTerminatingDecision(tx, jon.id, terminated.caseId)).toBe(terminated.decisionId);
      held.open();
      await release.opened;
    });
    let appealing: Promise<unknown> | null = null;
    try {
      await held.opened;
      appealing = fileAppeal(n.deps, jon.id, terminated.decisionId, {});
      // The appeal's check passed (its deadline is months away); its foreign key waits at the decision's row.
      await untilBlocked(n.apiDb, "insert into appeals", 60_000);
    } finally {
      release.open();
      await holding;
    }
    await appealing;
    expect((await n.moderation.standingFor(jon.id))?.measure).toMatchObject({ appealPending: true });
  });

  test("termination_final goes only after the auth module's take-down committed: a take-down that throws there mails nothing; and a termination with a seal of the account's images in force says so", async () => {
    // 3e's review (proofs5).
    const kim = await account();
    const { postId } = await imagePost(n.apiDb, 1, kim.id);
    const sealCase = (await report(n.apiDb, aPost(postId), "csam")).caseId;
    await decided(sealCase, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
    await dueForTakeDown(kim.id);
    // The auth module's own flow, over a repository whose take-down fails after the account's row was read.
    const failing = accountDeps({
      takeDownTerminated: (accountId, facts) =>
        takeDownFlow(
          {
            ...n.auth.deps,
            repo: {
              ...n.auth.deps.repo,
              takeDownTerminated: async () => {
                throw new Error("the auth database refused the take-down");
              },
            },
          },
          accountId,
          facts,
        ),
    });
    expect(await purgePending(failing)).toMatchObject({ terminated: 0, failed: 1 });
    expect(n.mailer.attempts.filter((mail) => mail.to === kim.email && mail.template === "termination_final")).toEqual([]);
    expect(await authDeletedAt(kim.id)).toBeNull();
    expect(await purgePending(accountDeps())).toMatchObject({ terminated: 1, failed: 0 });
    const mails = n.mailer.to(kim.email, "termination_final");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.data.imagesSealed).toBe("true");
  });

  test("the take-down holds no profile while termination_final is mailed: with the relay hanging, the round ends and a like of the account's post goes through; the mail goes once the relay answers", async () => {
    // 3e's review (database3).
    const lou = await account();
    const liker = await account();
    const postId = await s.repo.createPost({ authorId: lou.id, body: "a post others still like", replyToId: null, quoteOfId: null, now: new Date() });
    await dueForTakeDown(lou.id);
    n.mailer.mode = "hang";
    try {
      const taken = await within(30_000, takeDownDue(n.deps, (accountId, facts) => (accountId === lou.id ? n.auth.forAccount.takeDownTerminated(accountId, facts) : Promise.resolve(false))));
      expect(taken).toMatchObject({ terminated: 1, failed: 0 });
      expect(await within(3000, s.repo.like(liker.id, postId, new Date(), lou.id))).toBe(true);
      expect(n.mailer.to(lou.email, "termination_final")).toEqual([]);
    } finally {
      n.mailer.release("deliver");
    }
    for (let round = 0; round < 200 && n.mailer.to(lou.email, "termination_final").length === 0; round++) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(n.mailer.to(lou.email, "termination_final")).toHaveLength(1);
  });

  test("this file left no row behind: what it committed is removed, and the tables hold what they held before it", async () => {
    await closeDecisions();
    await world.moderation.settle();
    await n.cleanUp();
    expect(await n.counts()).toEqual(before);
  });
});
