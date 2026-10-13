import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { auditVerify } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { ModerationError } from "../../src/moderation/context";
import { casesCalling } from "../../src/moderation/dispatch";
import { recordIntake } from "../../src/moderation/intake";
import { appendConfirmedAudit, insertAction, insertDecision } from "../../src/moderation/repo";
import { fileReply } from "../../src/moderation/standing";
import { deciderWorld, type DeciderWorld, type RealStaff } from "./moderation-decide";
import {
  aPost,
  act,
  appealOf,
  authCaseCounts,
  decisionParams,
  decisionRow,
  gate,
  ground,
  hex64,
  imageStates,
  inForce,
  madeUpConfirmation,
  newImageRow,
  newPostRow,
  postFrozen,
  postRow,
  raised,
  refusal,
  removeFixtures,
  rowCounts,
  untilBlocked,
  type DecisionInput,
} from "./moderation-fixtures";
import { noticesWorld } from "./notices-harness";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Each test makes real, confirmed decisions (a step-up for each) and several hold one transaction open until another
// session waits for it: on a loaded machine that takes far longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/**
 * Decisions that commit, and what races them (3c design, sections 6.2 and 7.5), against the real database. A committed
 * decision's audit row stays for good and audit-verify checks every one, so each decision here is confirmed as the
 * console confirms it: by a staff key on the software authenticator, in a staff session (moderation-decide.ts). The races
 * are made to happen, never waited for: a transaction of the migrator holds the audit chain's head, which stops a decision
 * at its last statement while it holds every lock it took, the other session is started, and the test goes on only once
 * the database reports that session as waiting for a lock. Every test removes what it committed in a `finally`; the audit
 * rows stay, as the record does. The file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: committed decisions and what races them", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  let migrateDb: Db;
  let authDb: Db;
  let admin: RealStaff;
  /** An admin whose key and role these tests take away. */
  let leaving: RealStaff;
  /** A moderator whose key is revoked before a decision of theirs is stored. */
  let revoked: RealStaff;
  /** A moderator with no decision yet, for the cap. */
  let capped: RealStaff;
  /** A moderator whose account is demoted to user and then taken down. */
  let takenDown: RealStaff;
  /** A moderator whose key the real revocation revokes. */
  let ordered: RealStaff;
  /** Two moderators who decide one case at the same moment, and one who seals while a report arrives. */
  let first: RealStaff;
  let second: RealStaff;
  let sealer: RealStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 8 });
    world = deciderWorld(apiDb);
    ({ migrateDb, authDb } = world);
    admin = await world.staff("admin");
    leaving = await world.staff("admin");
    revoked = await world.staff("moderator");
    capped = await world.staff("moderator");
    takenDown = await world.staff("moderator");
    ordered = await world.staff("moderator");
    first = await world.staff("moderator");
    second = await world.staff("moderator");
    sealer = await world.staff("moderator");
    before = await counts();
  }, 120_000);
  afterAll(async () => {
    await world.close();
    await closeDb(apiDb);
  });

  /** How many rows the tables these tests write, and the four auth tables of moderation cases, hold. */
  const counts = async (): Promise<Record<string, number>> => ({ ...(await rowCounts(apiDb)), ...(await authCaseCounts(migrateDb)) });

  /** A committed post with this many images, reported under a rule or on the path for child sexual abuse material, and its open case. Everything is removed after `fn`. */
  async function withReported(fn: (made: { authorId: string; postId: string; mediaIds: string[]; caseId: string }) => Promise<void>, options: { images?: number; by?: "rule" | "csam" } = {}) {
    const [author, reporter] = [await newProfile(apiDb), await newProfile(apiDb)];
    try {
      const postId = await newPostRow(apiDb, author.id);
      const mediaIds: string[] = [];
      for (let position = 0; position < (options.images ?? 0); position++) mediaIds.push(await newImageRow(apiDb, author.id, postId, position));
      const recorded = await recordIntake(world.moderation.deps, { ground: options.by === "csam" ? ground.csam() : ground.rule(reporter.id), live: [aPost(postId)] });
      await fn({ authorId: author.id, postId, mediaIds, caseId: recorded.items[0]!.caseId! });
    } finally {
      await removeFixtures(migrateDb, [author.id, reporter.id]);
    }
  }
  /** A verified confirmation of a decision on the case, and the call that records it: built before anything is held, since a step-up reads and writes rows of its own. */
  async function prepared(member: RealStaff, caseId: string, input: DecisionInput) {
    const confirmed = await world.confirm(member, caseId, await decisionParams(apiDb, member, caseId, input));
    return () => world.moderation.forStaff.decide(member.session, confirmed, { requestId: `req-${randomUUID()}` });
  }
  /** Runs `fn` while a transaction of the migrator holds what this statement locks. `letGo` ends the hold; it ends in any case when `fn` does. */
  async function whileHeld<T>(lock: ReturnType<typeof sql>, fn: (letGo: () => Promise<void>) => Promise<T>): Promise<T> {
    const [held, release] = [gate(), gate()];
    const holder = withLockTimeout(migrateDb, async (tx) => {
      await tx.execute(lock);
      held.open();
      await release.opened;
    });
    await held.opened;
    const letGo = async () => {
      release.open();
      await holder;
    };
    try {
      return await fn(letGo);
    } finally {
      await letGo();
    }
  }
  /** While the audit chain's head is held, a decision stops at its audit row, its last statement, holding every lock it took. */
  const whileHeadHeld = <T>(fn: (letGo: () => Promise<void>) => Promise<T>) => whileHeld(sql`select 1 from public.audit_head where id = 1 for update`, fn);
  /**
   * While the lock under which one person's decisions are counted is held, a decision of theirs stops inside
   * decisions_record: it has locked its case and read its texts, and has written nothing yet.
   */
  const whileCapHeld = <T>(member: RealStaff, fn: (letGo: () => Promise<void>) => Promise<T>) =>
    whileHeld(sql`select pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || ${member.id}::text, 0))`, fn);
  const decisionsOf = async (caseId: string) => (await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from decisions where case_id = ${caseId}::uuid`))[0]!.n;
  /** The moderation module's dependencies over the same pool, counting how often an intake's transaction is run. */
  function counting() {
    let runs = 0;
    const transaction = ((...args: Parameters<Db["transaction"]>) => {
      runs++;
      return apiDb.transaction(...args);
    }) as Db["transaction"];
    return { deps: { ...world.moderation.deps, apiDb: Object.assign(Object.create(apiDb) as Db, { transaction }) }, runs: () => runs };
  }
  /**
   * A direct call of the audit function as korbat_api, for this account and key, with a made-up assertion: only ever
   * inside a transaction that is rolled back, since audit-verify would refuse the row for good.
   */
  const auditCall = (tx: DbTx, member: { id: string; keyId: string }, options: { expires?: number; requestId?: string } = {}) =>
    tx.execute(sql`select public.append_confirmed_audit(${member.id}::uuid, ${member.keyId}::uuid, 'case_decided'::text, 'case', ${randomUUID()}::text, '{"params": {}}'::jsonb, ${randomUUID()}::uuid,
      ${hex64()}::text, '{"signature": "x"}'::jsonb, ${options.requestId ?? "req-direct"}::text, ${options.expires ?? Date.now() + 60_000}::bigint)`);
  /** What that call was refused with, in a transaction of its own (lock waits bounded at 10 seconds) that is rolled back whatever it answered; null when it wrote its row. */
  const auditCallRefusal = (member: { id: string; keyId: string }, options: { expires?: number; requestId?: string } = {}) =>
    pgError(rolledBack(apiDb, async (tx) => void (await auditCall(tx, member, options))));

  test("a confirmed decision commits with its measures and its audit row, and audit-verify accepts the record", async () => {
    await withReported(async ({ postId, caseId }) => {
      const outcome = await world.decideAs(admin, caseId, { kind: "interim", actions: [act("withhold")] });
      expect(outcome).toEqual({ decisionId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      const decisionId = (outcome as { decisionId: string }).decisionId;
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
      const [audit] = await apiDb.execute<Record<string, unknown>>(sql`
        select l.actor_id, l.action, l.target_type, l.target_id, l.key_id, l.staff_session, l.step_up is not null as confirmed, l.metadata ->> 'decisionId' as decision,
               l.chain_seq = (select max(chain_seq) from audit_log) as newest
          from audit_log l where l.metadata ->> 'decisionId' = ${decisionId}`);
      expect({ ...audit! }).toEqual({ actor_id: admin.id, action: "case_decided", target_type: "case", target_id: caseId, key_id: admin.keyId, staff_session: admin.session.handle, confirmed: true, decision: decisionId, newest: true });
      // The whole record, this row included, as the command line checks it.
      const connections = { api: createDb(loadConfig().DATABASE_URL_API, { max: 1 }), auth: createDb(loadConfig().DATABASE_URL_AUTH, { max: 1 }) };
      try {
        expect(await auditVerify(connections, [])).toMatchObject({ ok: true, problems: [], problemCount: 0 });
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
      // A measure cannot be added to it afterwards: a ledger row comes only with its own decision, in that decision's transaction.
      const late = await pgError(withLockTimeout(apiDb, (tx) => tx.execute(sql`insert into decision_actions (decision_id, kind) values (${decisionId}::uuid, 'restore')`)));
      expect(late).toEqual({ code: "P0001", message: "invalid_decision" });
    });
  });

  test("an item that waited for a decision which then closed its case is not stored there: the intake runs again and opens a new case", async () => {
    await withReported(async ({ postId, caseId }) => {
      const sender = await newProfile(apiDb);
      try {
        const decide = await prepared(admin, caseId, { kind: "final", outcome: "no_violation" });
        const counted = counting();
        const [decided, reported] = await whileCapHeld(admin, async (letGo) => {
          const deciding = decide();
          // The decision holds the case's row, still open, and waits to be counted.
          await untilBlocked(apiDb, "insert into decisions");
          const reporting = recordIntake(counted.deps, { ground: ground.rule(sender.id), live: [aPost(postId)] });
          // The report read the open case, and its item now waits for that case's row.
          await untilBlocked(apiDb, "insert into intake_items");
          await letGo();
          return Promise.all([deciding, reporting]);
        });
        expect(decided).toEqual({ decisionId: expect.any(String) });
        const again = reported.items[0]!;
        expect(again.caseId).not.toBe(caseId);
        expect(again.seq).toBe(1);
        // The attach trigger refused the first run's item, and the transaction ran a second time.
        expect(counted.runs()).toBe(2);
        const cases = await apiDb.execute<{ id: string; closed: boolean; intake_seq: number; answered_seq: number }>(
          sql`select id, closed_at is not null as closed, intake_seq, answered_seq from cases where target_id = ${postId}::uuid order by opened_at, closed_at nulls last`,
        );
        expect(cases.map((row) => ({ ...row }))).toEqual([
          { id: caseId, closed: true, intake_seq: 1, answered_seq: 1 },
          { id: again.caseId, closed: false, intake_seq: 1, answered_seq: 0 },
        ]);
        // The new case holds its own copy of the post.
        const [copies] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from evidence_snapshots where case_id = ${again.caseId}::uuid`);
        expect(copies!.n).toBe(1);
      } finally {
        await removeFixtures(migrateDb, [sender.id]);
      }
    });
  });

  test("a key revoked before the decision's audit row ends it: nothing is stored", async () => {
    await withReported(async ({ postId, caseId }) => {
      const decide = await prepared(revoked, caseId, { kind: "interim", actions: [act("withhold")] });
      await authDb.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${revoked.keyId}::uuid`);
      expect(await decide()).toBe("ended");
      expect(await decisionsOf(caseId)).toBe(0);
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
    });
  });

  test("a revocation of the key, a demotion and a take-down of the account all wait for a decision that is being recorded, which commits; the next decision is refused", async () => {
    await withReported(async ({ postId, caseId }) => {
      // A final decision under R5, which only an admin takes.
      const decide = await prepared(leaving, caseId, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      const decided = await whileHeadHeld(async (letGo) => {
        const deciding = decide();
        await untilBlocked(apiDb, "append_confirmed_audit");
        // Both rows are held by the decision until it commits: none of the three statements can slip in before it.
        const revoking = withLockTimeout(authDb, (tx) => tx.execute(sql`update auth.staff_keys set revoked_at = now() where id = ${leaving.keyId}::uuid`));
        await untilBlocked(authDb, "update auth.staff_keys");
        const demoting = withLockTimeout(authDb, (tx) => tx.execute(sql`update auth.users set role = 'moderator' where id = ${leaving.id}::uuid`));
        await untilBlocked(authDb, "set role = 'moderator'");
        const takingDown = withLockTimeout(authDb, (tx) => tx.execute(sql`update auth.users set deleted_at = now() where id = ${leaving.id}::uuid`));
        await untilBlocked(authDb, "set deleted_at = now()");
        await letGo();
        const outcome = await deciding;
        await Promise.all([revoking, demoting, takingDown]);
        return outcome;
      });
      expect(decided).toEqual({ decisionId: expect.any(String) });
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "removed", level: "removed" });
      // The decision's audit row names the key, which was live when the row was written; both statements then went through.
      const [audit] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where action = 'case_decided' and target_id = ${caseId} and key_id = ${leaving.keyId}::uuid`);
      expect(audit!.n).toBe(1);
      const [now] = await authDb.execute<{ revoked: boolean; role: string; deleted: boolean }>(
        sql`select k.revoked_at is not null as revoked, u.role::text as role, u.deleted_at is not null as deleted from auth.staff_keys k join auth.users u on u.id = k.user_id where k.id = ${leaving.keyId}::uuid`,
      );
      expect({ ...now! }).toEqual({ revoked: true, role: "moderator", deleted: true });
      // Demoted, taken down and without a live key: a correction of that decision, confirmed with what the session still
      // holds, is refused by the role before the account and the key are looked at, and stores nothing.
      const { session, confirmed } = madeUpConfirmation(leaving, caseId, await decisionParams(apiDb, leaving, caseId, { kind: "correction", reviewsDecisionId: (decided as { decisionId: string }).decisionId, actions: [act("restore")] }));
      expect(await refusal(world.moderation.forStaff.decide(session, confirmed, { requestId: "req-refused" }))).toBe("admin_required");
      expect(await decisionsOf(caseId)).toBe(1);
    });
  });

  test("a challenge that has run out, or runs out while the decision waits, is answered late and stores nothing", async () => {
    await withReported(async ({ caseId }) => {
      const params = await decisionParams(apiDb, admin, caseId, { kind: "interim", actions: [act("withhold")] });
      // These confirmations are made up: a decision that is late writes nothing, so nothing unverifiable can commit.
      const expired = madeUpConfirmation(admin, caseId, params, new Date(Date.now() - 1000));
      expect(await world.moderation.forStaff.decide(expired.session, expired.confirmed, { requestId: "req-late" })).toBe("late");
      const waited = await whileHeadHeld(async () => {
        const closing = madeUpConfirmation(admin, caseId, params, new Date(Date.now() + 3000));
        // Three seconds are left: each lock wait is bounded by a fifteenth of them, and the head is not free in that time.
        return world.moderation.forStaff.decide(closing.session, closing.confirmed, { requestId: "req-late" });
      });
      expect(waited).toBe("late");
      expect(await decisionsOf(caseId)).toBe(0);
    });
  });

  test("the audit function itself: it refuses a challenge past its expiry, an account or a key that is not live staff's own, and any action but the three of moderation cases", async () => {
    await rolledBack(apiDb, async (tx) => {
      const call = (changed: { actor?: string; key?: string; action?: string; expires?: number; stepUp?: string | null } = {}) =>
        pgError(
          tx.transaction((sp: DbTx) =>
            sp.execute(sql`select public.append_confirmed_audit(${changed.actor ?? admin.id}::uuid, ${changed.key ?? admin.keyId}::uuid, ${changed.action ?? "case_decided"}::text, 'case', ${randomUUID()}::text,
              '{"params": {}}'::jsonb, ${admin.session.handle}::uuid, ${hex64()}::text, ${changed.stepUp === undefined ? '{"signature": "x"}' : changed.stepUp}::jsonb, 'req-direct', ${changed.expires ?? Date.now() + 60_000}::bigint)`),
          ),
        );
      const ended = { code: "P0001", message: "staff_confirmation_ended" };
      expect(await call({ expires: Date.now() - 1 })).toEqual({ code: "P0001", message: "staff_confirmation_late" });
      // The revoked moderator's key, another account's live key, an account that is not staff, and one that does not exist.
      expect(await call({ actor: revoked.id, key: revoked.keyId })).toEqual(ended);
      expect(await call({ key: capped.keyId })).toEqual(ended);
      expect(await call({ actor: (await newProfile(tx as unknown as Db)).id })).toEqual(ended);
      expect(await call({ actor: randomUUID(), key: randomUUID() })).toEqual(ended);
      expect((await call({ action: "staff_session_revoked" }))?.message).toMatch(/does not write the action/);
      expect((await call({ stepUp: null }))?.message).toMatch(/needs an actor, a key, a staff session, an action hash, a step-up and an expiry/);
      // With everything in order it writes the row; this one is rolled back, since no key signed it.
      expect(await call()).toBeNull();
    });
  });

  test("a text deleted after the decision read it and before the decision confirmed it: the decision is refused and stores nothing", async () => {
    await withReported(async ({ postId, caseId }) => {
      const params = await decisionParams(apiDb, admin, caseId, { kind: "interim", actions: [act("withhold")] });
      const confirmed = await world.confirm(admin, caseId, params);
      const [held, release] = [gate(), gate()];
      // The decision reads its texts, then waits for the lock under which one person's decisions are counted. The sweep
      // deletes the reason meanwhile, as the migrator here, which alone deletes a text.
      const sweeper = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('korbat.decision_cap:' || ${admin.id}::text, 0))`);
        held.open();
        await release.opened;
        await tx.execute(sql`delete from staff_texts where digest = ${params.reasonDigest!}`);
      });
      await held.opened;
      const deciding = world.moderation.forStaff.decide(admin.session, confirmed, { requestId: "req-swept" }).catch((err: unknown) => err);
      try {
        await untilBlocked(apiDb, "insert into decisions");
      } finally {
        release.open();
        await sweeper;
      }
      const err = await deciding;
      expect(err).toBeInstanceOf(ModerationError);
      expect(err).toMatchObject({ code: "text_not_found" });
      expect(await decisionsOf(caseId)).toBe(0);
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
    });
  });

  test("two decisions of one person at the cap's last place: exactly one commits", async () => {
    await withReported(async (one) => {
      await withReported(async (two) => {
        const input: DecisionInput = { kind: "interim", actions: [act("withhold")] };
        const [first, second] = [await prepared(capped, one.caseId, input), await prepared(capped, two.caseId, input)];
        // The limits' row is the suite's to keep: lowered here to one decision an hour, and put back whatever happens.
        await migrateDb.execute(sql`update moderation_limits set decisions_per_hour = 1 where id = 1`);
        try {
          const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);
          const outcomes = await whileHeadHeld(async (letGo) => {
            // The first decision is counted and written, and waits for the chain's head with the counting lock held.
            const earlier = settled(first());
            await untilBlocked(apiDb, "append_confirmed_audit");
            // The second waits for that lock, inside the insert of its own row.
            const later = settled(second());
            await untilBlocked(apiDb, "insert into decisions");
            await letGo();
            return Promise.all([earlier, later]);
          });
          expect(outcomes[0]).toEqual({ decisionId: expect.any(String) });
          expect(outcomes[1]).toBeInstanceOf(ModerationError);
          expect(outcomes[1]).toMatchObject({ code: "decision_cap" });
          expect([await decisionsOf(one.caseId), await decisionsOf(two.caseId)]).toEqual([1, 0]);
          expect([(await postRow(apiDb, one.postId)).state, (await postRow(apiDb, two.postId)).state]).toEqual(["withheld", "visible"]);
        } finally {
          await migrateDb.execute(sql`update moderation_limits set decisions_per_hour = 60 where id = 1`);
        }
      });
    });
  });

  test("two cases' removals of one post reversed at the same time, in either order, leave it visible", async () => {
    for (const firstToCommit of [0, 1] as const) {
      await withReported(async ({ postId, caseId }) => {
        const removals: { caseId: string; decisionId: string }[] = [];
        const removed = (await world.decideAs(admin, caseId, { kind: "final", actions: [act("remove")] })) as { decisionId: string };
        removals.push({ caseId, decisionId: removed.decisionId });
        // A second case about the same post, by the admin's own finding, with a removal of its own.
        const second = (await recordIntake(world.moderation.deps, { ground: ground.finding(admin.id), live: [aPost(postId)] })).items[0]!.caseId!;
        removals.push({ caseId: second, decisionId: ((await world.decideAs(admin, second, { kind: "final", actions: [act("remove")] })) as { decisionId: string }).decisionId });
        const [early, late] = firstToCommit === 0 ? [removals[0]!, removals[1]!] : [removals[1]!, removals[0]!];
        const restore = (of: { caseId: string; decisionId: string }) => prepared(admin, of.caseId, { kind: "correction", reviewsDecisionId: of.decisionId, actions: [act("restore")] });
        const [reverseEarly, reverseLate] = [await restore(early), await restore(late)];
        const outcomes = await whileHeadHeld(async (letGo) => {
          const one = reverseEarly();
          await untilBlocked(apiDb, "append_confirmed_audit");
          // The second reversal waits for the author's profile row, which every decision about them takes first.
          const two = reverseLate();
          await untilBlocked(apiDb, "from profiles where id = any");
          expect(await postRow(apiDb, postId)).toMatchObject({ state: "removed", level: "removed" });
          await letGo();
          return Promise.all([one, two]);
        });
        expect(outcomes).toEqual([{ decisionId: expect.any(String) }, { decisionId: expect.any(String) }]);
        expect(await postRow(apiDb, postId), String(firstToCommit)).toMatchObject({ state: "visible", level: "visible" });
      });
    }
  });

  test("a seal for good after one taken while deciding: no other session sees the images unsealed in between", async () => {
    await withReported(
      async ({ mediaIds, caseId }) => {
        expect(await world.decideAs(admin, caseId, { kind: "interim", ruleId: "R2", actions: [act("seal_media")] })).toEqual({ decisionId: expect.any(String) });
        expect(await imageStates(apiDb, mediaIds)).toEqual(["sealed", "sealed"]);
        const decide = await prepared(admin, caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        const seen: string[][] = [];
        const outcome = await whileHeadHeld(async (letGo) => {
          const deciding = decide();
          // Inside the decision's transaction the first seal has ended and the second is written; nothing of it is committed.
          await untilBlocked(apiDb, "append_confirmed_audit");
          seen.push(await imageStates(apiDb, mediaIds));
          await letGo();
          return deciding;
        });
        expect(outcome).toEqual({ decisionId: expect.any(String) });
        seen.push(await imageStates(apiDb, mediaIds));
        expect(seen).toEqual([["sealed", "sealed"], ["sealed", "sealed"]]);
        const [list] = await apiDb.execute<{ lists: number }>(sql`select count(*)::int as lists from seal_posts s join decision_actions a on a.id = s.action_id join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid`);
        expect(list!.lists).toBe(2);
      },
      { images: 2, by: "csam" },
    );
  });

  test("a report that arrives while a decision is closing its target's case waits where it opens a case, and opens a new one in the same run", async () => {
    await withReported(async ({ postId, caseId }) => {
      const sender = await newProfile(apiDb);
      try {
        const decide = await prepared(admin, caseId, { kind: "final", outcome: "no_violation" });
        const counted = counting();
        const [decided, reported] = await whileHeadHeld(async (letGo) => {
          const deciding = decide();
          // The decision has closed the case in its own transaction, and waits for the chain's head.
          await untilBlocked(apiDb, "append_confirmed_audit");
          const reporting = recordIntake(counted.deps, { ground: ground.rule(sender.id), live: [aPost(postId)] });
          // The insert that opens a case, or does nothing when one is open, waits for the transaction that is changing
          // the open one.
          await untilBlocked(apiDb, "insert into cases");
          await letGo();
          return Promise.all([deciding, reporting]);
        });
        expect(decided).toEqual({ decisionId: expect.any(String) });
        expect(reported.items[0]!.caseId).not.toBe(caseId);
        expect(reported.items[0]!.seq).toBe(1);
        // No item was refused: the one run stored the report in the new case.
        expect(counted.runs()).toBe(1);
        const cases = await apiDb.execute<{ id: string; closed: boolean; intake_seq: number }>(
          sql`select id, closed_at is not null as closed, intake_seq from cases where target_id = ${postId}::uuid order by opened_at, closed_at nulls last`,
        );
        expect(cases.map((row) => ({ ...row }))).toEqual([
          { id: caseId, closed: true, intake_seq: 1 },
          { id: reported.items[0]!.caseId, closed: false, intake_seq: 1 },
        ]);
      } finally {
        await removeFixtures(migrateDb, [sender.id]);
      }
    });
  });

  test("two moderators deciding one case at the same moment, each in a session of their own: the first commits, and the second, who read the same case, is told that it changed and decides it again as it now stands", async () => {
    await withReported(async ({ postId, caseId }) => {
      // Both opened the case as it stood and confirmed a decision on it with their own key.
      const [withhold, close] = [await prepared(first, caseId, { kind: "interim", actions: [act("withhold")] }), await prepared(second, caseId, { kind: "final", outcome: "no_violation" })];
      const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);
      const outcomes = await whileHeadHeld(async (letGo) => {
        // The first decision is written and waits for the chain's head, holding the case and its subject.
        const earlier = settled(withhold());
        await untilBlocked(apiDb, "append_confirmed_audit");
        // The second waits for the author's profile row, which every decision about them takes first.
        const later = settled(close());
        await untilBlocked(apiDb, "from profiles where id = any");
        await letGo();
        return Promise.all([earlier, later]);
      });
      expect(outcomes[0]).toEqual({ decisionId: expect.any(String) });
      expect(outcomes[1]).toBeInstanceOf(ModerationError);
      expect(outcomes[1]).toMatchObject({ code: "case_changed" });
      // Nothing of the second is stored: no decision, no audit row, and the case is still open and withheld.
      expect(await decisionsOf(caseId)).toBe(1);
      const [audit] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where action = 'case_decided' and target_id = ${caseId}`);
      expect(audit!.n).toBe(1);
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "withheld", level: "withheld" });
      // The second moderator opens the case again and decides it as it now stands: the withhold ends with the case.
      expect(await world.decideAs(second, caseId, { kind: "final", outcome: "no_violation" })).toEqual({ decisionId: expect.any(String) });
      expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      expect(await decisionsOf(caseId)).toBe(2);
    });
  });

  describe("a report of child sexual abuse material that commits while a seal's decision waits for its first lock", () => {
    const SEAL: DecisionInput = { kind: "interim", ruleId: "R2", actions: [act("seal_media")] };
    const settled = <T>(promise: Promise<T>) => promise.then((value) => value as unknown, (err: unknown) => err);

    test("the seal would not be in force for the only report it rests on: the confirmation is refused as case_changed with nothing stored and nothing mailed, and confirmed again it seals, leaves no served image and mails its author once", async () => {
      // A world with the real auth module and a mailer, so that what follows a commit can be seen: the statement's mail.
      const w = noticesWorld();
      const mailing = deciderWorld(w.apiDb, { auth: w.authForModeration });
      try {
        const member = await mailing.staff("moderator");
        const [author, reporter] = [await w.account(), await w.account()];
        const postId = await newPostRow(w.apiDb, author.id);
        const mediaIds = [await newImageRow(w.apiDb, author.id, postId, 0)];
        const caseId = (await recordIntake(w.deps, { ground: ground.rule(reporter.id), live: [aPost(postId)] })).items[0]!.caseId!;
        // The seal is confirmed on the case as it stands, holding a rule report; the report it would rest on arrives while it waits.
        const confirmed = await mailing.confirm(member, caseId, await decisionParams(w.apiDb, member, caseId, SEAL));
        const [refused, reported] = await whileHeld(sql`select 1 from profiles where id = ${author.id}::uuid for no key update`, async (letGo) => {
          // The decision's transaction has begun, which fixes its time, and waits for its first lock: the author's row.
          const deciding = settled(mailing.moderation.forStaff.decide(member.session, confirmed, { requestId: `req-${randomUUID()}` }));
          await untilBlocked(apiDb, "from profiles where id = any");
          const arrived = await recordIntake(w.deps, { ground: ground.csam(), live: [aPost(postId)] });
          await letGo();
          return [await deciding, arrived] as const;
        });
        await mailing.moderation.settle();
        expect(reported.items[0]!.caseId).toBe(caseId);
        // The item arrived after the decision's time, so the seal would not be in force: the decision is not recorded at all.
        expect(refused).toBeInstanceOf(ModerationError);
        expect(refused).toMatchObject({ code: "case_changed" });
        const [stored] = await w.migrateDb.execute<{ decisions: number; actions: number; lists: number; audit: number }>(sql`
          select (select count(*)::int from decisions where case_id = ${caseId}::uuid) as decisions,
                 (select count(*)::int from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = ${caseId}::uuid) as actions,
                 (select count(*)::int from seal_posts s where s.post_id = ${postId}::uuid) as lists,
                 (select count(*)::int from audit_log where action = 'case_decided' and target_id = ${caseId}) as audit`);
        expect({ ...stored! }).toEqual({ decisions: 0, actions: 0, lists: 0, audit: 0 });
        expect(await imageStates(w.apiDb, mediaIds)).toEqual(["visible"]);
        // The post is frozen all the same, through the new item, and nobody was told of a seal that never was.
        expect(await postFrozen(w.apiDb, postId)).toBe(true);
        expect(w.mailer.to(author.email, "moderation_decision")).toEqual([]);
        // Once the item is 15 minutes old the dispatch job repeats the urgent lane's alert for it,
        const later = () => new Date(Date.now() + 16 * 60_000);
        expect(await casesCalling(w.deps, later())).toContain(caseId);

        // until the person reads the case again and confirms again, in a transaction that begins after the item.
        expect(await mailing.decideAs(member, caseId, SEAL)).toEqual({ decisionId: expect.any(String) });
        expect(await inForce(w.apiDb, { caseId })).toEqual(["seal_media"]);
        expect(await imageStates(w.apiDb, mediaIds)).toEqual(["sealed"]);
        expect(await casesCalling(w.deps, later())).not.toContain(caseId);
        expect(w.mailer.to(author.email, "moderation_decision").map((mail) => mail.data.subject)).toEqual(["seal_deciding"]);
      } finally {
        await w.cleanUp();
        await mailing.close();
        await w.close();
      }
    });

    test("on a case that already holds an unanswered report of this kind, the seal is accepted and in force: it rests on the earlier report, and covers the images whatever arrives meanwhile", async () => {
      await withReported(
        async ({ authorId, postId, mediaIds, caseId }) => {
          const decide = await prepared(sealer, caseId, SEAL);
          const [sealed, reported] = await whileHeld(sql`select 1 from profiles where id = ${authorId}::uuid for no key update`, async (letGo) => {
            const deciding = settled(decide());
            await untilBlocked(apiDb, "from profiles where id = any");
            const arrived = await recordIntake(world.moderation.deps, { ground: ground.csam(), live: [aPost(postId)] });
            await letGo();
            return [await deciding, arrived] as const;
          });
          expect(reported.items[0]!.caseId).toBe(caseId);
          expect(sealed).toEqual({ decisionId: expect.any(String) });
          const seal = (sealed as { decisionId: string }).decisionId;
          // The second report arrived after the decision's time; the first one, which the seal was taken for, did not.
          const [order] = await apiDb.execute<{ after: boolean; before: boolean }>(sql`
            select (select max(created_at) from intake_items where case_id = ${caseId}::uuid) > (select decided_at from decisions where id = ${seal}::uuid) as after,
                   (select min(created_at) from intake_items where case_id = ${caseId}::uuid) <= (select decided_at from decisions where id = ${seal}::uuid) as before`);
          expect({ ...order! }).toEqual({ after: true, before: true });
          expect((await decisionRow(apiDb, seal)).suspect).toBe(true);
          expect(await inForce(apiDb, { caseId })).toEqual(["seal_media"]);
          expect(await imageStates(apiDb, mediaIds)).toEqual(["sealed"]);
          expect(await postFrozen(apiDb, postId)).toBe(true);
        },
        { images: 1, by: "csam" },
      );
    });
  });

  describe("the check at COMMIT covers every row of the ledger", () => {
    /**
     * A decision's statements as the API issues them, in one transaction of korbat_api that commits: the subject's lock,
     * the decision's row, its ledger rows and, last, the audit row, confirmed by a real key. `after` runs once the audit row
     * is written. Answers what the transaction was refused with, or null when it committed.
     */
    async function committing(made: { authorId: string; caseId: string }, input: DecisionInput, after: (tx: DbTx, decisionId: string) => Promise<void>) {
      const params = await decisionParams(apiDb, admin, made.caseId, input);
      const confirmed = await world.confirm(admin, made.caseId, params);
      const decisionId = randomUUID();
      const refused = await withLockTimeout(apiDb, async (tx) => {
        await tx.execute(sql`select id from profiles where id = ${made.authorId}::uuid for no key update`);
        await insertDecision(tx, { id: decisionId, caseId: made.caseId, decidedBy: admin.id, params });
        for (const action of params.actions) await insertAction(tx, decisionId, action);
        await appendConfirmedAudit(tx, {
          actorId: admin.id,
          keyId: confirmed.keyId,
          action: "case_decided",
          targetType: "case",
          targetId: made.caseId,
          metadata: { params: confirmed.params, decisionId },
          staffSession: admin.session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: `req-${randomUUID()}`,
          expiresAt: confirmed.expiresAt,
        });
        await after(tx, decisionId);
      }).then(
        () => null,
        (err: unknown) => raised(err),
      );
      return { decisionId, refused };
    }
    const unlisted = { code: "P0001", message: "invalid_decision", detail: "actions: the decision's measures and reversals are not those the audit row's params list." };

    test("a measure added after the check was made to run early is refused: at once while the checks are immediate, and at COMMIT once they are deferred again", async () => {
      await withReported(
        async (made) => {
          const input: DecisionInput = { kind: "interim", actions: [act("withhold")] };
          const further = act("withhold_media", made.mediaIds[0]!);
          let inserted = false;
          // The checks run early and pass. While they stay immediate, the further row's own check runs with its insert.
          const atOnce = await committing(made, input, async (tx, decisionId) => {
            await tx.execute(sql`set constraints all immediate`);
            await insertAction(tx, decisionId, further);
            inserted = true;
          });
          expect(inserted).toBe(false);
          expect(atOnce.refused).toEqual(unlisted);
          // Deferred again, the insert itself passes, and the check it queued refuses the COMMIT.
          const atCommit = await committing(made, input, async (tx, decisionId) => {
            await tx.execute(sql`set constraints all immediate`);
            await tx.execute(sql`set constraints all deferred`);
            await insertAction(tx, decisionId, further);
            inserted = true;
          });
          expect(inserted).toBe(true);
          expect(atCommit.refused).toEqual(unlisted);
          expect(await decisionsOf(made.caseId)).toBe(0);
          expect(await postRow(apiDb, made.postId)).toMatchObject({ state: "visible", level: "visible" });
          expect(await imageStates(apiDb, made.mediaIds)).toEqual(["visible"]);
        },
        { images: 1 },
      );
    });

    test("the same further measure, inserted before the audit row and listed in its params, commits", async () => {
      await withReported(
        async (made) => {
          const { decisionId, refused } = await committing(made, { kind: "interim", actions: [act("withhold"), act("withhold_media", made.mediaIds[0]!)] }, async (tx) => {
            // Made to run early here too: every row is in the params, so the check passes now as it would at COMMIT.
            await tx.execute(sql`set constraints all immediate`);
          });
          expect(refused).toBeNull();
          const actions = await apiDb.execute<{ kind: string }>(sql`select kind from decision_actions where decision_id = ${decisionId}::uuid order by kind::text`);
          expect(actions.map((row) => row.kind)).toEqual(["withhold", "withhold_media"]);
          expect(await postRow(apiDb, made.postId)).toMatchObject({ state: "withheld", level: "withheld" });
          expect(await imageStates(apiDb, made.mediaIds)).toEqual(["withheld"]);
        },
        { images: 1 },
      );
    });
  });

  describe("append_confirmed_audit: the account, the key and the clock", () => {
    const ended = { code: "P0001", message: "staff_confirmation_ended" };

    test("an account demoted to user, and one taken down, is refused while its key is live; a take-down waits for a call that holds the account's row", async () => {
      await withReported(async ({ postId, caseId }) => {
        const decide = await prepared(takenDown, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await auditCallRefusal(takenDown)).toBeNull();
        // Demoted to user: the function's account statement refuses, whatever the key.
        await authDb.execute(sql`update auth.users set role = 'user' where id = ${takenDown.id}::uuid`);
        expect(await auditCallRefusal(takenDown)).toEqual(ended);
        await authDb.execute(sql`update auth.users set role = 'moderator' where id = ${takenDown.id}::uuid`);
        expect(await auditCallRefusal(takenDown)).toBeNull();

        // The function takes the account's row itself (no decision's trigger ran here): a take-down that comes while the
        // call's transaction is open waits for it.
        const [held, release] = [gate(), gate()];
        const calling = rolledBack(apiDb, async (tx) => {
          await auditCall(tx, takenDown);
          held.open();
          await release.opened;
        });
        await held.opened;
        const takingDown = withLockTimeout(authDb, (tx) => tx.execute(sql`update auth.users set deleted_at = now() where id = ${takenDown.id}::uuid`));
        try {
          await untilBlocked(authDb, "update auth.users");
        } finally {
          release.open();
          await calling;
        }
        await takingDown;

        // Taken down first: a direct call is ended, and so is a decision the key confirmed before, which stores nothing.
        expect(await auditCallRefusal(takenDown)).toEqual(ended);
        expect(await decide()).toBe("ended");
        expect(await decisionsOf(caseId)).toBe(0);
        expect(await postRow(apiDb, postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("the call takes the account's row before the key's, as the real revocation does, so the two cannot deadlock in either order", async () => {
      const probe = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(authDb, (tx) => tx.execute(statement)));
      /** Runs a direct call while a transaction of the auth role holds what `lock` takes; `during` runs once the call waits. */
      async function callBehind(lock: ReturnType<typeof sql>, during: () => Promise<void>) {
        const [held, release] = [gate(), gate()];
        const holder = withLockTimeout(authDb, async (tx) => {
          await tx.execute(lock);
          held.open();
          await release.opened;
        });
        await held.opened;
        const calling = auditCallRefusal(ordered);
        try {
          await untilBlocked(apiDb, "append_confirmed_audit");
          await during();
        } finally {
          release.open();
          await holder;
        }
        expect(await calling).toBeNull();
      }
      // The key's row held: the call waits for it, and already holds the account's row.
      await callBehind(sql`select 1 from auth.staff_keys where id = ${ordered.keyId}::uuid for update`, async () => {
        expect((await probe(sql`select 1 from auth.users where id = ${ordered.id}::uuid for update nowait`))?.code).toBe("55P03");
      });
      // The account's row held: the call waits for it, and has not touched the key's row.
      await callBehind(sql`select 1 from auth.users where id = ${ordered.id}::uuid for update`, async () => {
        expect(await probe(sql`select 1 from auth.staff_keys where id = ${ordered.keyId}::uuid for update nowait`)).toBeNull();
      });

      // The real revocation, started while a call holds both rows, waits at its first lock, the account's row: it has not
      // touched the key, which still carries only the call's shared lock.
      const [held, release] = [gate(), gate()];
      const calling = rolledBack(apiDb, async (tx) => {
        await auditCall(tx, ordered);
        held.open();
        await release.opened;
      });
      await held.opened;
      const revoking = createAuthRepo(authDb).revokeStaffKeys({ account: { id: ordered.id }, key: "all", suspect: false, via: "cli", actorId: ordered.id, now: new Date() });
      try {
        await untilBlocked(authDb, "for no key update");
        expect(await probe(sql`select 1 from auth.staff_keys where id = ${ordered.keyId}::uuid for share nowait`)).toBeNull();
      } finally {
        release.open();
        await calling;
      }
      expect(await revoking).toMatchObject({ ok: true });
      // Revoked first: the call is ended at the key.
      expect(await auditCallRefusal(ordered)).toEqual(ended);
    });

    test("a call whose row joins the chain after the challenge's expiry, because it waited for the head, is refused as late and stores nothing", async () => {
      const requestId = `req-late-${randomUUID()}`;
      const expires = Date.now() + 1500;
      const refused = await whileHeadHeld(async (letGo) => {
        const calling = auditCallRefusal(admin, { expires, requestId });
        await untilBlocked(apiDb, "append_confirmed_audit");
        // Held past the expiry: the row is stamped only once its transaction has the head.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, expires - Date.now()) + 500));
        await letGo();
        return calling;
      });
      expect(refused).toEqual({ code: "P0001", message: "staff_confirmation_late" });
      const [stored] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from audit_log where request_id = ${requestId}`);
      expect(stored!.n).toBe(0);
    });
  });

  test("3e: the decide route takes the subject's profile FOR UPDATE first exactly when the decision holds a suspension: a write's shared lock on the account makes it wait, and a lift or a removal does not wait", async () => {
    const account = await newProfile(apiDb);
    const social = world.moderation.deps.social;
    const lockAccounts = social.lockAccounts;
    const modes: string[] = [];
    social.lockAccounts = (tx, ids, mode, live) => {
      modes.push(mode);
      return lockAccounts(tx, ids, mode, live);
    };
    try {
      // The basis of a suspension at once: a final R5 removal of a post of the account.
      const postCase = (await recordIntake(world.moderation.deps, { ground: ground.finding(admin.id, "R5"), live: [aPost(await newPostRow(apiDb, account.id))] })).items[0]!.caseId!;
      const removal = await prepared(admin, postCase, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      const removed = await whileHeld(sql`select 1 from profiles where id = ${account.id}::uuid for key share`, () => removal());
      if (typeof removed === "string") throw new Error(`the removal was not recorded: ${removed}`);
      const accountCase = (await recordIntake(world.moderation.deps, { ground: ground.finding(admin.id, "R5"), live: [{ type: "account", id: account.id, position: 1, namedHandle: account.handle }] })).items[0]!.caseId!;
      const suspension = await prepared(admin, accountCase, { kind: "final", ruleId: "R5", actions: [{ kind: "suspend", mediaId: null, days: 3, announced: false }] });
      const suspended = await whileHeld(sql`select 1 from profiles where id = ${account.id}::uuid for key share`, async (letGo) => {
        const deciding = suspension();
        // FOR UPDATE waits for the shared lock every write about the account holds.
        await untilBlocked(apiDb, "from profiles where id = any");
        await letGo();
        return deciding;
      });
      if (typeof suspended === "string") throw new Error(`the suspension was not recorded: ${suspended}`);
      const lift = await prepared(admin, accountCase, { kind: "correction", reviewsDecisionId: suspended.decisionId, actions: [act("lift_suspension")] });
      const lifted = await whileHeld(sql`select 1 from profiles where id = ${account.id}::uuid for key share`, () => lift());
      expect(typeof lifted).not.toBe("string");
      expect(modes).toEqual(["no key update", "update", "no key update"]);
    } finally {
      social.lockAccounts = lockAccounts;
      await removeFixtures(migrateDb, [account.id]);
    }
  });

  test("3e Task 4: a kept correction and a kept review of an announced suspension with a reply on time take the subject's profile FOR UPDATE first, as the start they fix is derived again under it", async () => {
    // 3e's review (proofs6): the branch of subjectLockMode for an answer to an announced measure (invariant 21).
    const account = await newProfile(apiDb);
    const social = world.moderation.deps.social;
    const lockAccounts = social.lockAccounts;
    const modes: string[] = [];
    social.lockAccounts = (tx, ids, mode, live) => {
      modes.push(mode);
      return lockAccounts(tx, ids, mode, live);
    };
    const decided = async (run: () => Promise<unknown>) => {
      const outcome = await run();
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      return (outcome as { decisionId: string }).decisionId;
    };
    try {
      // The ladder's first step: three strikes, each a final R1 removal of a post made after the one before it was decided.
      for (let i = 0; i < 3; i++) {
        const postId = await newPostRow(apiDb, account.id, { createdAt: sql`clock_timestamp()`, body: "a post that breaks R1" });
        const postCase = (await recordIntake(world.moderation.deps, { ground: ground.finding(admin.id, "R1"), live: [aPost(postId)] })).items[0]!.caseId!;
        await decided(await prepared(admin, postCase, { kind: "final", ruleId: "R1", actions: [act("remove")] }));
      }
      const accountCase = (await recordIntake(world.moderation.deps, { ground: ground.finding(admin.id, "R1"), live: [{ type: "account", id: account.id, position: 1, namedHandle: account.handle }] })).items[0]!.caseId!;
      const announced = await decided(await prepared(admin, accountCase, { kind: "final", ruleId: "R1", actions: [{ kind: "suspend", mediaId: null, days: 3, announced: true }] }));
      // The world mails nothing, so the notice stays owed and the start unfixed: the reply comes before it.
      expect(await fileReply(world.moderation.deps, account.id, announced, { statement: "I reply before the start." })).toMatchObject({ onTime: true });

      const keep = await prepared(admin, accountCase, { kind: "correction", reviewsDecisionId: announced, outcome: "kept" });
      modes.length = 0;
      await decided(keep);
      expect(modes).toEqual(["update"]);

      await appealOf(apiDb, announced, account.id);
      modes.length = 0;
      await decided(() => world.reviewAs(second, announced, { outcome: "kept" }));
      expect(modes).toEqual(["update"]);
    } finally {
      social.lockAccounts = lockAccounts;
      await removeFixtures(migrateDb, [account.id]);
    }
  });

  test("this file left no row behind: the tables it writes, the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    expect(await counts()).toEqual(before);
  });
});
