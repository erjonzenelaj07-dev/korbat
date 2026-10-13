import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CaseDecidedParams } from "@korbat/contracts";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { isDeadlock } from "../../src/lib/lock-bounds";
import type { ModerationDeps } from "../../src/moderation";
import { insertionOrder, recordConfirmed } from "../../src/moderation/decide";
import { caseTarget, insertAction, insertDecision, insertMarks } from "../../src/moderation/repo";
import { onceMoreOnDeadlock } from "../../src/social/flows/posts";
import { createSocialRepo, type HandleChangeResult } from "../../src/social/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "../integration/moderation-decide";
import { act, anAccount, aPost, decisionParams, ground, intake, newPostRow, removeFixtures, timed } from "../integration/moderation-fixtures";
import { newPost, newProfile } from "../integration/social-fixtures";

/**
 * The labs of account sanctions on the real code (3e design, section 12.3), run by hand as contention.lab.ts is, on a
 * quiet machine, with their numbers recorded in the report of the task that runs them. Task 2 creates the file with lab
 * E; each later task of 3e adds the labs of its own code.
 *
 * Lab E: the retiring decision against a handle change back to the judged handle. Each account had the handle a case's
 * snapshot judged, then changed it, so the judged handle is in its history and its own to take back. For the first half
 * of the accounts, a retirement through the decide route's own code (a real confirmation by a staff key, made ready
 * first) and the social repository's changeHandle back to the judged handle are fired together; the other half are only
 * retired. It passes when no account is left holding a retired handle: a change that came second is refused (the claim
 * statement, or the guard under a race), and one that came first gets the placeholder from the retirement's
 * compare-and-set. It records the retirements committed, the refusals, the race winners given the placeholder, the
 * decisions' times and how busy the machine was. What it commits is removed at the end, but the audit rows of its
 * confirmed decisions, which are the record (as every committed decision's are), and the staff accounts' rows in the
 * auth schema, as the integration suites leave theirs.
 *
 * From apps/api, with the scratch stack's data services up and the test database migrated:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts
 *
 * LAB_E_ACCOUNTS sets the number of accounts (60 unless set, as the design's LAB E); LAB_OUT the file of the lines.
 *
 * Task 3 adds labs B1 and B5, B2 and B4, B6 and B7 (3e design, section 12.3), on the real code: the repository's own
 * functions as the writers and suspensions at once through the decide route's code. B2 and B4 run the two old orders,
 * which are copied into this file (oldPurge, decideWithOldLock) and never a switch in the code. Each records the
 * deadlocks the database detected over its run (pg_stat_database), the second tries of the flows and of the purge job,
 * and the decisions' times. LAB_B_SUBJECTS sets the subjects of B1 to B5 (36 unless set), LAB_B6_ACCOUNTS and
 * LAB_B7_ACCOUNTS the accounts of B6 and B7 (30 each unless set).
 */

/** Where the measurements go, one line of JSON each: the file LAB_OUT names, or lab-standing.jsonl in the repository's .data folder (the lab runs from apps/api). */
const OUT = process.env.LAB_OUT ?? path.resolve(process.cwd(), "../../.data/lab-standing.jsonl");
function line(name: string, result: Record<string, unknown>): void {
  const text = JSON.stringify({ name, at: new Date().toISOString(), ...result });
  mkdirSync(path.dirname(OUT), { recursive: true });
  appendFileSync(OUT, text + String.fromCharCode(10));
  console.log(`LAB ${text}`);
}

/** The share of processor time that was not idle over this many milliseconds, across all cores: how loaded the machine is. */
async function busy(ms = 1500): Promise<number> {
  const read = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, all: sum.all + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle }), { idle: 0, all: 0 });
  const before = read();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = read();
  return Math.round((1 - (after.idle - before.idle) / Math.max(1, after.all - before.all)) * 100);
}

/** The value at a share of the sorted list, or null for none. */
const percentile = (sorted: readonly number[], share: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!);

/** At most this many decisions of one staff account in an hour (0016's decision_cap, as moderation_limits holds it by default). */
const DECISIONS_PER_STAFF = 50;
/** How many races run at once. */
const BATCH = 6;
/** How many rounds of its job a purge gets in labs B4, B5 and B7 before it counts as lost. */
const PURGE_ROUNDS = 5;

/**
 * 3c's account purge (B4): its own row, then every post of the account, then the counters, the follows and the profile,
 * with no counterpart's profile row taken first. Copied from the purge as 3c built it, without the media rows.
 */
async function oldPurge(db: Db, id: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
    await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
    await tx.execute(sql`
      update posts set reply_count = greatest(0, reply_count - c.n)
      from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
      where posts.id = c.reply_to_id`);
    await tx.execute(sql`
      update posts set quote_count = greatest(0, quote_count - c.n)
      from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
      where posts.id = c.quote_of_id`);
    await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = ${now.toISOString()}::timestamptz, body = '' where author_id = ${id}::uuid and state <> 'deleted_by_author'`);
    await tx.execute(sql`
      with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
      update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
    await tx.execute(sql`
      with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
      update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
    await tx.execute(sql`delete from bookmarks where user_id = ${id}::uuid`);
    await tx.execute(sql`
      with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
      update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
    await tx.execute(sql`
      with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
      update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
    await tx.execute(sql`delete from blocks where blocker_id = ${id}::uuid or blocked_id = ${id}::uuid`);
    await tx.execute(sql`delete from mutes where muter_id = ${id}::uuid or muted_id = ${id}::uuid`);
    if (row) await tx.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${row.handle.toLowerCase()}, ${id}::uuid, ${now.toISOString()}::timestamptz) on conflict do nothing`);
    await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', avatar_path = null, verified_at = null, follower_count = 0, following_count = 0, post_count = 0, deleted_at = ${now.toISOString()}::timestamptz
                         where id = ${id}::uuid and deleted_at is null`);
  });
}

/**
 * The decide route as it would be with the API's first lock left at FOR NO KEY UPDATE (B2): the route's own code but for
 * the mode, so that the ledger's trigger upgrades the lock to FOR UPDATE behind the case's lock.
 */
async function decideWithOldLock(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }) {
  const params = CaseDecidedParams.parse(confirmed.params);
  const caseId = confirmed.target.id;
  const target = await caseTarget(deps.apiDb, caseId);
  if (!target) throw new Error("lab: the case of a prepared decision is gone");
  const subject = target.type === "account" ? target.id : await deps.social.postAuthor(target.id);
  return recordConfirmed(
    deps,
    session,
    confirmed,
    ctx,
    subject,
    async (tx, decisionId) => {
      await insertDecision(tx, { id: decisionId, caseId, decidedBy: session.userId, params });
      await insertMarks(tx, decisionId, params.unfounded);
      for (const action of insertionOrder(params.actions)) await insertAction(tx, decisionId, action, params.replaced);
    },
    "no key update",
  );
}

/** What one write of the race came to: committed, refused with a code, or an error; with when it started. */
type WriteOutcome = { started: number; result: "committed" | string };

/** A write's outcome: "committed", the code a refusal carried, or "deadlock" for PostgreSQL's 40P01. */
async function outcomeOf(write: () => Promise<unknown>): Promise<WriteOutcome> {
  const started = Date.now();
  try {
    await write();
    return { started, result: "committed" };
  } catch (err) {
    if (isDeadlock(err)) return { started, result: "deadlock" };
    const code = (err as { code?: unknown }).code;
    return { started, result: typeof code === "string" ? code : "error" };
  }
}

/** Waits a random time up to `ms`. */
const jitter = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ms)));

describe.skipIf(!process.env.INTEGRATION)("lab: the standing ledger on the real code", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  const made: string[] = [];

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 16 });
    world = deciderWorld(apiDb);
  });
  afterAll(async () => {
    try {
      await removeFixtures(world.migrateDb, made.splice(0));
      await world.close();
    } finally {
      await closeDb(apiDb);
    }
  }, 600_000);

  test("lab E: retirements through the decide route against changes back to the judged handle leave no account holding a retired handle", async () => {
    const accounts = Number(process.env.LAB_E_ACCOUNTS ?? 60);
    const racing = Math.floor(accounts / 2);
    const repo = createSocialRepo(apiDb);
    const staff: RealStaff[] = [];
    for (let i = 0; i < Math.ceil(accounts / DECISIONS_PER_STAFF); i++) staff.push(await world.staff("moderator"));

    // Each account: its case opened on the handle it holds (the snapshot judges that one), then a change to another, so
    // the judged handle is in its history; then a confirmation of its retirement, made ready before any race starts.
    type Prepared = { id: string; judged: string; member: RealStaff; confirmed: StaffStepUpConfirmed };
    const prepared: Prepared[] = [];
    for (let i = 0; i < accounts; i++) {
      const member = staff[Math.floor(i / DECISIONS_PER_STAFF)]!;
      const profile = await newProfile(apiDb);
      made.push(profile.id);
      const recorded = await intake(apiDb, ground.finding(member.id, "R4"), anAccount(profile.id, profile.handle));
      const caseId = recorded.items[0]!.caseId!;
      const moved = await repo.changeHandle(profile.id, `lab_${randomBytes(6).toString("hex")}`, new Date());
      if (!moved.ok) throw new Error(`lab E: the account could not leave its judged handle (${moved.reason})`);
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R4", actions: [act("retire_handle")] });
      prepared.push({ id: profile.id, judged: profile.handle, member, confirmed: await world.confirm(member, caseId, params) });
    }

    const busyPercent = await busy();
    const decisionMs: number[] = [];
    const counts = { retirements: 0, retirementsFailed: 0, changesRefusedRetired: 0, changesRefusedOther: 0, raceWinners: 0, raceWinnersGivenPlaceholder: 0, changeErrors: 0 };
    const started = performance.now();
    for (let from = 0; from < prepared.length; from += BATCH) {
      await Promise.all(
        prepared.slice(from, from + BATCH).map(async (account, offset) => {
          const index = from + offset;
          const retire = async () => {
            const start = performance.now();
            try {
              const outcome = await world.moderation.forStaff.decide(account.member.session, account.confirmed, { requestId: `lab-${randomUUID()}` });
              decisionMs.push(Math.round(performance.now() - start));
              if (typeof outcome === "string") counts.retirementsFailed++;
              else counts.retirements++;
            } catch {
              counts.retirementsFailed++;
            }
          };
          if (index >= racing) return retire();
          // A jitter of up to 25 ms on the change, so that each side wins some races.
          const change = async (): Promise<HandleChangeResult | "error"> => {
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25)));
            return repo.changeHandle(account.id, account.judged, new Date()).catch(() => "error" as const);
          };
          const [, changed] = await Promise.all([retire(), change()]);
          if (changed === "error") counts.changeErrors++;
          else if (changed.ok) counts.raceWinners++;
          else if (changed.reason === "handle_retired") counts.changesRefusedRetired++;
          else counts.changesRefusedOther++;
        }),
      );
    }
    const elapsedMs = Math.round(performance.now() - started);
    await world.moderation.settle();

    // The outcome: no lab account holds a handle whose row of handle_history is retired, and every race winner got the
    // placeholder of its retirement (the profile holds a handle of the placeholder's form).
    const ids = `{${prepared.map((account) => account.id).join(",")}}`;
    const [held] = await apiDb.execute<{ n: number }>(
      sql`select count(*)::int as n from profiles p where p.id = any(${ids}::uuid[]) and exists (select 1 from handle_history h where h.handle_lower = lower(p.handle) and h.retired_at is not null)`,
    );
    const onPlaceholder = await apiDb.execute<{ id: string }>(sql`select id from profiles where id = any(${ids}::uuid[]) and handle ~ '^retired_[0-9a-f]{12}$'`);
    counts.raceWinnersGivenPlaceholder = onPlaceholder.length;
    const retiredRows = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from handle_history where profile_id = any(${ids}::uuid[]) and retired_at is not null`);
    const sorted = [...decisionMs].sort((a, b) => a - b);
    line("lab-E", {
      accounts,
      racing,
      ...counts,
      retiredHandles: retiredRows[0]!.n,
      profilesHoldingRetiredHandle: held!.n,
      decisionP50Ms: percentile(sorted, 0.5),
      decisionP95Ms: percentile(sorted, 0.95),
      elapsedMs,
      busyPercent,
    });
    expect(held!.n).toBe(0);
    expect(counts.retirements).toBe(accounts);
    expect(counts.changeErrors).toBe(0);
    // Every race ends one of two ways: the change was refused because the handle was retired, or it won and the
    // retirement then gave the profile its placeholder.
    expect(counts.changesRefusedRetired + counts.raceWinners).toBe(racing);
    expect(counts.raceWinnersGivenPlaceholder).toBe(counts.raceWinners);
  }, 1_800_000);
  // ---------------------------------------------------------------- Task 3: labs B1 and B5, B2 and B4, B6 and B7

  /**
   * One account about to be suspended at once, with the accounts around it (labs B1, B2, B4 and B5): its post P, which
   * its three followers have liked and replied to, two third accounts that follow nobody, a post of the first of them,
   * an account the subject follows and unfollows in the race, which writes nothing itself (section 5 leaves a block's
   * order as 3c built it: a block of the subject by an account the subject unfollows at that moment takes the two rows
   * in the other order and can deadlock, which is no part of these labs), the R5 removal a suspension at once rests on
   * (the basis threat), its account case, and the suspension's confirmation by an admin's key, made ready before the
   * race starts.
   */
  interface Scene {
    subject: string;
    post: string;
    followers: string[];
    thirds: string[];
    thirdPost: string;
    followee: string;
    member: RealStaff;
    confirmed: StaffStepUpConfirmed;
  }

  async function scenes(count: number): Promise<Scene[]> {
    const repo = createSocialRepo(apiDb);
    // Two decisions for each scene (the basis's removal and the suspension), at most DECISIONS_PER_STAFF for an admin.
    const admins: RealStaff[] = [];
    for (let i = 0; i < Math.ceil((count * 2) / DECISIONS_PER_STAFF); i++) admins.push(await world.staff("admin"));
    const list: Scene[] = [];
    for (let i = 0; i < count; i++) {
      const member = admins[Math.floor((i * 2) / DECISIONS_PER_STAFF)]!;
      const subject = await newProfile(apiDb);
      const followers = [await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id);
      const thirds = [await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id);
      const followee = (await newProfile(apiDb)).id;
      made.push(subject.id, ...followers, ...thirds, followee);
      const post = await newPost(repo, subject.id, new Date(), "the subject's post");
      const thirdPost = await newPost(repo, thirds[0]!, new Date(), "a third account's post");
      for (const follower of followers) {
        await repo.follow(follower, subject.id, new Date());
        await repo.like(follower, post, new Date(), subject.id);
        await newPost(repo, follower, new Date(), "a follower's reply", { replyToId: post });
      }
      const basis = await newPostRow(apiDb, subject.id, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
      const finding = await intake(apiDb, ground.finding(member.id, "R5"), aPost(basis));
      const removed = await world.decideAs(member, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      if (typeof removed === "string") throw new Error(`lab B: the basis's removal was not recorded (${removed})`);
      const onAccount = await intake(apiDb, ground.finding(member.id, "R5"), anAccount(subject.id, subject.handle));
      const caseId = onAccount.items[0]!.caseId!;
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", 7, false)] });
      list.push({ subject: subject.id, post, followers, thirds, thirdPost, followee, member, confirmed: await world.confirm(member, caseId, params) });
    }
    return list;
  }

  /** How many deadlocks the test database has detected so far, read once every server process has reported its counts (an idle one reports within ten seconds). */
  let deadlockBase: number | null = null;
  async function settledDeadlocks(): Promise<number> {
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const [row] = await apiDb.execute<{ n: number }>(sql`select deadlocks::int as n from pg_stat_database where datname = current_database()`);
    return row!.n;
  }

  /** Counts each outcome by its name. */
  const tally = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  /**
   * A write as a flow runs it: once more on a deadlock (onceMoreOnDeadlock, the real flows' function), with each second
   * try counted.
   */
  function flowWrite<T>(write: () => Promise<T>, counts: { secondTries: number }): () => Promise<T> {
    return () => {
      let tries = 0;
      return onceMoreOnDeadlock(() => {
        if (++tries > 1) counts.secondTries++;
        return write();
      });
    };
  }

  /**
   * A purge as its job runs it: once, and again at each next round while the database chooses it to give way in a
   * deadlock (apps/api/src/account/purge.ts: a pending purge is tried every round until it is done). The lab's rounds
   * follow each other at once, while the other accounts still write; after PURGE_ROUNDS a purge counts as lost.
   */
  async function purgeAsJob(purge: (id: string) => Promise<void>, id: string, counts: { purgeRetries: number; purgesLost: number; purgeErrors: Record<string, number> }): Promise<void> {
    for (let round = 1; round <= PURGE_ROUNDS; round++) {
      try {
        await purge(id);
        return;
      } catch (err) {
        if (isDeadlock(err) && round < PURGE_ROUNDS) {
          counts.purgeRetries++;
          continue;
        }
        counts.purgesLost++;
        tally(counts.purgeErrors, isDeadlock(err) ? "deadlock" : String((err as { code?: unknown }).code ?? "error"));
        return;
      }
    }
  }

  /** Runs each loop's body again and again, a few milliseconds apart, until `main` has ended and `tail` milliseconds more have passed. */
  async function during(loops: (() => Promise<void>)[], main: () => Promise<void>, tail = 250): Promise<void> {
    let stop = false;
    const running = loops.map(async (body) => {
      while (!stop) {
        await body();
        await jitter(8);
      }
    });
    try {
      await main();
      await new Promise((resolve) => setTimeout(resolve, tail));
    } finally {
      stop = true;
      await Promise.all(running);
    }
  }

  type Variant = { name: string; decide: "new" | "old lock"; purge: "new" | "old order" };

  /**
   * Labs B1 and B5 and their counterparts B2 and B4 (3e design, section 12.3): each scene's subject is suspended at once
   * through the decide route's code while it keeps writing (posts, replies, likes, follows, its profile), third accounts
   * reply to, quote and like its post P, follow and unfollow it, and follow and then block and unblock it, its third
   * follower likes P, replies to it and unfollows and follows the subject again, and two of its followers, who liked P
   * and replied to it before the race, are purged by their job (B5's share, which is B4's). The purged followers write
   * nothing during the race: an account is taken down before its purge runs, so no request of its own meets that purge
   * (B5's purged accounts were never a party of its loops; lab B7 runs the accounts around a purged one). A write of the
   * subject that began after its decision returned and still committed is a write inside the suspension. Deadlocks are
   * the database's own count over the run; second tries are the flows' (follow, unfollow, createPost) and the purge job's.
   */
  async function suspensionRace(variant: Variant) {
    const count = Number(process.env.LAB_B_SUBJECTS ?? 36);
    const prepared = await scenes(count);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const repo = createSocialRepo(writersDb);
    const counts = {
      suspensions: 0,
      decisionsLate: 0,
      decisionErrors: {} as Record<string, number>,
      subjectWrites: 0,
      subjectCommittedBefore: 0,
      subjectRefused: {} as Record<string, number>,
      writesInsideSuspension: 0,
      otherWrites: {} as Record<string, number>,
      secondTries: 0,
      purges: 0,
      purgeRetries: 0,
      purgesLost: 0,
      purgeErrors: {} as Record<string, number>,
    };
    const decisionMs: number[] = [];
    try {
      const before = deadlockBase ?? (await settledDeadlocks());
      const busyPercent = await busy();
      const started = performance.now();
      for (let from = 0; from < prepared.length; from += BATCH) {
        await Promise.all(
          prepared.slice(from, from + BATCH).map(async (scene) => {
            const s = scene.subject;
            let returnedAt = Number.POSITIVE_INFINITY;
            const subjectLoop = (() => {
              let i = 0;
              return async () => {
                const kind = i++ % 5;
                const write =
                  kind === 0
                    ? flowWrite(() => repo.createPost({ authorId: s, body: "a post", replyToId: null, quoteOfId: null, now: new Date() }), counts)
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: s, body: "a reply", replyToId: scene.thirdPost, quoteOfId: null, now: new Date(), lockWith: scene.thirds[0]! }), counts)
                      : kind === 2
                        ? () => repo.like(s, scene.thirdPost, new Date(), scene.thirds[0]!)
                        : kind === 3
                          ? flowWrite(() => repo.follow(s, scene.followee, new Date(), true), counts)
                          : async () => {
                              if (!(await repo.updateProfile(s, { bio: `bio ${i}` }))) throw Object.assign(new Error("refused"), { code: "account_suspended" });
                            };
                const outcome = await outcomeOf(write);
                counts.subjectWrites++;
                if (outcome.result === "committed") {
                  if (outcome.started > returnedAt) counts.writesInsideSuspension++;
                  else counts.subjectCommittedBefore++;
                } else tally(counts.subjectRefused, outcome.result);
                // What the subject may still do, so that its next like and follow write again.
                if (kind === 2) await repo.unlike(s, scene.thirdPost).catch(() => undefined);
                if (kind === 3) await repo.unfollow(s, scene.followee).catch(() => undefined);
              };
            })();
            const thirdLoop = (t: string, n: number) => {
              let i = n;
              return async () => {
                const kind = i++ % 5;
                // A block of the subject by an account that follows it writes both counters of the follow it removes, after
                // its lockLive took the subject's row FOR KEY SHARE: with the old first lock, the decision's upgrade waits
                // for that share while the block's counter update waits for the decision (lab B2's followers' counter
                // updates). Blocks get no second try in their flow.
                const write =
                  kind === 0
                    ? flowWrite(() => repo.createPost({ authorId: t, body: "a reply", replyToId: scene.post, quoteOfId: null, now: new Date(), lockWith: s }), counts)
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: t, body: "a quote", replyToId: null, quoteOfId: scene.post, now: new Date(), lockWith: s }), counts)
                      : kind === 2
                        ? () => repo.like(t, scene.post, new Date(), s).then(() => repo.unlike(t, scene.post))
                        : kind === 3
                          ? () => flowWrite(() => repo.follow(t, s, new Date(), true), counts)().then(flowWrite(() => repo.unfollow(t, s), counts))
                          : () => flowWrite(() => repo.follow(t, s, new Date(), true), counts)().then(() => repo.block(t, s, new Date())).then(() => repo.unblock(t, s));
                tally(counts.otherWrites, (await outcomeOf(write)).result);
              };
            };
            // The follower who stays likes P, replies to it, and unfollows and follows the subject again.
            const keeper = scene.followers[2]!;
            const keeperLoop = (() => {
              let i = 0;
              return async () => {
                const kind = i++ % 3;
                const write =
                  kind === 0
                    ? () => repo.like(keeper, scene.post, new Date(), s).then(() => repo.unlike(keeper, scene.post))
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: keeper, body: "a reply", replyToId: scene.post, quoteOfId: null, now: new Date(), lockWith: s }), counts)
                      : () => flowWrite(() => repo.unfollow(keeper, s), counts)().then(flowWrite(() => repo.follow(keeper, s, new Date(), true), counts));
                tally(counts.otherWrites, (await outcomeOf(write)).result);
              };
            })();
            const purge = variant.purge === "new" ? (id: string) => repo.purgeProfile(id, new Date(), async () => undefined) : (id: string) => oldPurge(writersDb, id, new Date());
            const decideOnce = () =>
              variant.decide === "new"
                ? world.moderation.forStaff.decide(scene.member.session, scene.confirmed, { requestId: `lab-${randomUUID()}` })
                : decideWithOldLock(world.moderation.deps, scene.member.session, scene.confirmed, { requestId: `lab-${randomUUID()}` });
            await during(
              [subjectLoop, thirdLoop(scene.thirds[0]!, 0), thirdLoop(scene.thirds[1]!, 2), keeperLoop],
              async () => {
                const purges = scene.followers.slice(0, 2).map(async (f) => {
                  await jitter(400);
                  counts.purges++;
                  await purgeAsJob(purge, f, counts);
                });
                await jitter(300);
                const start = performance.now();
                try {
                  const outcome = await decideOnce();
                  if (typeof outcome === "string") counts.decisionsLate++;
                  else counts.suspensions++;
                } catch (err) {
                  tally(counts.decisionErrors, String((err as { code?: unknown }).code ?? "error"));
                }
                returnedAt = Date.now();
                decisionMs.push(Math.round(performance.now() - start));
                await Promise.all(purges);
              },
            );
          }),
        );
      }
      const elapsedMs = Math.round(performance.now() - started);
      await world.moderation.settle();
      const ids = `{${prepared.map((scene) => scene.subject).join(",")}}`;
      const [running] = await apiDb.execute<{ n: number }>(
        sql`select count(*)::int as n from profiles where id = any(${ids}::uuid[]) and suspended_from is not null and suspended_from <= clock_timestamp() and clock_timestamp() < suspended_until`,
      );
      const after = await settledDeadlocks();
      deadlockBase = after;
      const sorted = [...decisionMs].sort((a, b) => a - b);
      const result = { subjects: count, ...counts, suspensionsRunning: running!.n, deadlocksDetected: after - before, decisionP50Ms: percentile(sorted, 0.5), decisionP95Ms: percentile(sorted, 0.95), decisionMaxMs: sorted.at(-1) ?? null, elapsedMs, busyPercent };
      line(variant.name, result);
      return result;
    } finally {
      await closeDb(writersDb);
    }
  }

  test("labs B1 and B5: suspensions at once under FOR UPDATE with the purge taking its counterparts first: no write inside a suspension, no deadlock", async () => {
    const result = await suspensionRace({ name: "lab-B1-B5", decide: "new", purge: "new" });
    expect(result.writesInsideSuspension).toBe(0);
    expect(result.suspensions).toBe(result.subjects);
    expect(result.suspensionsRunning).toBe(result.subjects);
    expect(result.decisionErrors).toEqual({});
    expect(result.purgesLost).toBe(0);
    expect(result.deadlocksDetected).toBe(0);
  }, 1_800_000);

  test("lab B2: the same with the decision's first lock left at FOR NO KEY UPDATE (the old lock, copied here)", async () => {
    const result = await suspensionRace({ name: "lab-B2", decide: "old lock", purge: "new" });
    // Recorded, not held: B2 shows what the reorder removes. The enforcement holds whatever the lock order.
    expect(result.writesInsideSuspension).toBe(0);
  }, 1_800_000);

  test("lab B4: the same with 3c's purge order (posts first, no counterpart taken first; copied here)", async () => {
    const result = await suspensionRace({ name: "lab-B4", decide: "new", purge: "old order" });
    expect(result.writesInsideSuspension).toBe(0);
  }, 1_800_000);

  test("lab B6: the account's own deletion against its suspension at once: either order, no error, no_effect deleted when the deletion won", async () => {
    const accounts = Number(process.env.LAB_B6_ACCOUNTS ?? 30);
    const repo = createSocialRepo(apiDb);
    const admins: RealStaff[] = [];
    for (let i = 0; i < Math.ceil((accounts * 2) / DECISIONS_PER_STAFF); i++) admins.push(await world.staff("admin"));
    type Prepared = { id: string; member: RealStaff; confirmed: StaffStepUpConfirmed };
    const prepared: Prepared[] = [];
    for (let i = 0; i < accounts; i++) {
      const member = admins[Math.floor((i * 2) / DECISIONS_PER_STAFF)]!;
      const profile = await newProfile(apiDb);
      made.push(profile.id);
      await newPost(repo, profile.id, new Date(), "a post the purge tombstones");
      const basis = await newPostRow(apiDb, profile.id, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
      const finding = await intake(apiDb, ground.finding(member.id, "R5"), aPost(basis));
      const removed = await world.decideAs(member, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      if (typeof removed === "string") throw new Error(`lab B6: the basis's removal was not recorded (${removed})`);
      const onAccount = await intake(apiDb, ground.finding(member.id, "R5"), anAccount(profile.id, profile.handle));
      const caseId = onAccount.items[0]!.caseId!;
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", 7, false)] });
      prepared.push({ id: profile.id, member, confirmed: await world.confirm(member, caseId, params) });
    }
    const before = deadlockBase ?? (await settledDeadlocks());
    const busyPercent = await busy();
    const decisionMs: number[] = [];
    const decisions: string[] = [];
    const counts = { decided: 0, decisionsLate: 0, decisionErrors: {} as Record<string, number>, purged: 0, purgeErrors: {} as Record<string, number> };
    const started = performance.now();
    for (let from = 0; from < prepared.length; from += BATCH) {
      await Promise.all(
        prepared.slice(from, from + BATCH).map(async (account) => {
          const suspend = async () => {
            await jitter(25);
            const start = performance.now();
            try {
              const outcome = await world.moderation.forStaff.decide(account.member.session, account.confirmed, { requestId: `lab-${randomUUID()}` });
              decisionMs.push(Math.round(performance.now() - start));
              if (typeof outcome === "string") counts.decisionsLate++;
              else {
                counts.decided++;
                decisions.push(outcome.decisionId);
              }
            } catch (err) {
              tally(counts.decisionErrors, String((err as { code?: unknown }).code ?? "error"));
            }
          };
          const remove = async () => {
            await jitter(25);
            try {
              await repo.purgeProfile(account.id, new Date(), async () => undefined);
              counts.purged++;
            } catch (err) {
              tally(counts.purgeErrors, isDeadlock(err) ? "deadlock" : String((err as { code?: unknown }).code ?? "error"));
            }
          };
          await Promise.all([suspend(), remove()]);
        }),
      );
    }
    const elapsedMs = Math.round(performance.now() - started);
    await world.moderation.settle();
    const effects = await apiDb.execute<{ no_effect: string | null; n: number }>(
      sql`select no_effect, count(*)::int as n from decision_actions where decision_id = any(${`{${decisions.join(",")}}`}::uuid[]) and kind = 'suspend' group by no_effect`,
    );
    const decidedBeforeDeletion = effects.find((row) => row.no_effect === null)?.n ?? 0;
    const decidedAfterDeletion = effects.find((row) => row.no_effect === "deleted")?.n ?? 0;
    const ids = `{${prepared.map((account) => account.id).join(",")}}`;
    const [deletedRows] = await apiDb.execute<{ n: number; written: number }>(
      sql`select count(*)::int as n, count(*) filter (where suspended_from is not null)::int as written from profiles where id = any(${ids}::uuid[]) and deleted_at is not null`,
    );
    const after = await settledDeadlocks();
    deadlockBase = after;
    const sorted = [...decisionMs].sort((a, b) => a - b);
    line("lab-B6", {
      accounts,
      ...counts,
      decidedBeforeDeletion,
      decidedAfterDeletion,
      otherEffects: effects.filter((row) => row.no_effect !== null && row.no_effect !== "deleted"),
      deletedProfiles: deletedRows!.n,
      deletedProfilesWithSuspensionColumns: deletedRows!.written,
      deadlocksDetected: after - before,
      decisionP50Ms: percentile(sorted, 0.5),
      decisionP95Ms: percentile(sorted, 0.95),
      elapsedMs,
      busyPercent,
    });
    expect(counts.decisionErrors).toEqual({});
    expect(counts.purgeErrors).toEqual({});
    expect(counts.decisionsLate).toBe(0);
    expect(decidedBeforeDeletion + decidedAfterDeletion).toBe(accounts);
    expect(deletedRows!.n).toBe(accounts);
  }, 1_800_000);

  test("lab B7: purged accounts followed, unfollowed, replied to and quoted by lower and higher ids while the purge runs: no error, no purge lost", async () => {
    const groups = Number(process.env.LAB_B7_ACCOUNTS ?? 30);
    const repo = createSocialRepo(apiDb);
    // Each group: four accounts in id order; the purged one, X, is the second, so one account has a lower id than X and
    // two a higher. The lower one and the first higher one follow X and reply to and quote its post; X follows the lower
    // one and the last; the last follows and unfollows X.
    type Group = { x: string; post: string; lower: string; higher: string; last: string };
    const prepared: Group[] = [];
    for (let i = 0; i < groups; i++) {
      const four = [await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id).sort();
      made.push(...four);
      const [lower, x, higher, last] = four as [string, string, string, string];
      const post = await newPost(repo, x, new Date(), "a post of the account to be purged");
      await repo.follow(lower, x, new Date());
      await repo.follow(higher, x, new Date());
      await repo.follow(x, lower, new Date());
      await repo.follow(x, last, new Date());
      prepared.push({ x, post, lower, higher, last });
    }
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const writers = createSocialRepo(writersDb);
    const counts = { requests: {} as Record<string, number>, secondTries: 0, purges: 0, purgeRetries: 0, purgesLost: 0, purgeErrors: {} as Record<string, number> };
    try {
      const before = deadlockBase ?? (await settledDeadlocks());
      const busyPercent = await busy();
      const started = performance.now();
      for (let from = 0; from < prepared.length; from += BATCH) {
        await Promise.all(
          prepared.slice(from, from + BATCH).map(async (group) => {
            const follower = (who: string, n: number) => {
              let i = n;
              return async () => {
                const kind = i++ % 3;
                const write =
                  kind === 0
                    ? () => flowWrite(() => writers.unfollow(who, group.x), counts)().then(flowWrite(() => writers.follow(who, group.x, new Date(), true), counts))
                    : kind === 1
                      ? flowWrite(() => writers.createPost({ authorId: who, body: "a quote", replyToId: null, quoteOfId: group.post, now: new Date(), lockWith: group.x }), counts)
                      : flowWrite(() => writers.createPost({ authorId: who, body: "a reply", replyToId: group.post, quoteOfId: null, now: new Date(), lockWith: group.x }), counts);
                tally(counts.requests, (await outcomeOf(write)).result);
              };
            };
            const toggler = async () => {
              const write = () => flowWrite(() => writers.follow(group.last, group.x, new Date(), true), counts)().then(flowWrite(() => writers.unfollow(group.last, group.x), counts));
              tally(counts.requests, (await outcomeOf(write)).result);
            };
            await during([follower(group.lower, 0), follower(group.higher, 1), toggler], async () => {
              await jitter(300);
              counts.purges++;
              await purgeAsJob((id) => writers.purgeProfile(id, new Date(), async () => undefined), group.x, counts);
            });
          }),
        );
      }
      const elapsedMs = Math.round(performance.now() - started);
      const ids = `{${prepared.map((group) => group.x).join(",")}}`;
      const [live] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = any(${ids}::uuid[]) and deleted_at is null`);
      // What the purge left must be whole: no follow of or by a purged account, and no live post of one.
      const [leftovers] = await apiDb.execute<{ follows: number; posts: number }>(sql`
        select (select count(*)::int from follows where follower_id = any(${ids}::uuid[]) or followee_id = any(${ids}::uuid[])) as follows,
               (select count(*)::int from posts where author_id = any(${ids}::uuid[]) and state <> 'deleted_by_author') as posts`);
      const after = await settledDeadlocks();
      deadlockBase = after;
      const errors = Object.entries(counts.requests).filter(([result]) => !["committed", "not_found", "post_unavailable"].includes(result));
      line("lab-B7", { groups, ...counts, requestErrors: Object.fromEntries(errors), purgedLeftLive: live!.n, followsLeft: leftovers!.follows, livePostsLeft: leftovers!.posts, deadlocksDetected: after - before, elapsedMs, busyPercent });
      expect(errors).toEqual([]);
      expect(counts.purgesLost).toBe(0);
      expect(live!.n).toBe(0);
      expect(leftovers).toEqual({ follows: 0, posts: 0 });
    } finally {
      await closeDb(writersDb);
    }
  }, 1_800_000);
});
