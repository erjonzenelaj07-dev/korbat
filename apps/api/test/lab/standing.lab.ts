import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CaseDecidedParams, EXPLORE_V2, STANDING_RULES } from "@korbat/contracts";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { isDeadlock } from "../../src/lib/lock-bounds";
import type { ModerationDeps } from "../../src/moderation";
import { insertionOrder, recordConfirmed } from "../../src/moderation/decide";
import { caseTarget, insertAction, insertDecision, insertMarks } from "../../src/moderation/repo";
import { fileReply } from "../../src/moderation/standing";
import { onceMoreOnDeadlock } from "../../src/social/flows/posts";
import { createSocialRepo, type HandleChangeResult } from "../../src/social/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "../integration/moderation-decide";
import { act, ageStandingForTest, anAccount, aPost, decisionParams, ground, intake, newPostRow, removeFixtures, timed, type DecisionInput } from "../integration/moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "../integration/notices-harness";
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
 *
 * Task 4 adds labs C1, C2 and D (3e design, section 12.3), in a block of their own below, with the notices world, whose
 * auth module mails each announced suspension's notice so that its start is fixed. Their own comment says what each runs
 * and when it passes; LAB_C_SUBJECTS and LAB_D_SUBJECTS set their accounts. To run only them:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts -t "labs? [CD]"
 *
 * Task 6 adds lab F (3e design, section 12.3) in a block of its own at the end: Explore's round under formula version 1,
 * copied into this file, and under version 2, the repository's own refreshExplore, on the same generated data. Its comment
 * says what it generates and when it passes; LAB_F_POSTS, LAB_F_LIKED_POSTS and LAB_F_ROUNDS set its sizes. To run only it:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts -t "lab F"
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

/**
 * Labs C1, C2 and D (3e design, section 12.3; Task 4), on the real code: announced suspensions of the ladder's first step,
 * each decided through the decide route's own code by a moderator after three strikes, its notice mailed through the
 * notices world's auth module so that its start is fixed, and that start then brought a moment ahead by
 * ageStandingForTest (the migrator moves every time of the account's ledger back, and standing_apply writes the profile's
 * columns again). Every time the labs judge by is the database's clock, read before and after each write.
 *
 * C1: around each start the account writes through the social repository's own functions, back to back (the free loop),
 * and a wave of its writes is fired while a holder has its profile row FOR UPDATE and changes it, from before the start
 * to after it (a writer of the row, as a handle change or standing_apply is). It passes when no write judged at or after a
 * start commits: a free write that began after the start, or a wave write, which the database judges again when it gets
 * the row. It also records a wave behind a holder that only locks the row (as a decision whose measure changes nothing
 * of the profile does): PostgreSQL then judges a locking statement before it waits, so those writes, judged before the
 * start, commit after it, and the lab records how many and how late.
 *
 * C2: the same wave behind the changing holder, with the predicate copied into this file reading now() in place of the
 * clock (lab code, never a switch in the code): writes whose transaction began before the start are admitted although
 * judged after it, which is what the clock rule prevents.
 *
 * D: each account replies through fileReply, the reply route's own function, at a moment from 300 ms before to 300 ms
 * after its start, while it writes back to back. It passes when on_time equals filed_at < start for every reply, no write
 * is refused before a start, none is refused after an on-time reply, and none is admitted at or after the start of a
 * measure whose reply came late.
 *
 * LAB_C_SUBJECTS sets the accounts of C1 and of C2 (25 each unless set, the design's LAB C starts), LAB_D_SUBJECTS those of D
 * (60 unless set, as the design's LAB D).
 */
describe.skipIf(!process.env.INTEGRATION)("lab: announced starts and replies on the real code (Task 4)", () => {
  let n: NoticesWorld;
  let cd: DeciderWorld;
  /** Each staff account decides at most DECISIONS_PER_STAFF a hour: a new one is made when the last is near its cap. */
  const pools = { admin: { members: [] as RealStaff[], used: 0 }, moderator: { members: [] as RealStaff[], used: 0 } };

  beforeAll(() => {
    n = noticesWorld();
    cd = deciderWorld(n.apiDb, { auth: n.authForModeration });
  });
  afterAll(async () => {
    try {
      await n.cleanUp();
      await cd.close();
    } finally {
      await n.close();
    }
  }, 600_000);

  async function staffOf(role: "admin" | "moderator"): Promise<RealStaff> {
    const pool = pools[role];
    if (pool.members.length === 0 || pool.used >= DECISIONS_PER_STAFF - 2) {
      pool.members.push(await cd.staff(role));
      pool.used = 0;
    }
    pool.used++;
    return pool.members.at(-1)!;
  }

  /** Counts each outcome by its name. */
  const tally = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await cd.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`lab C/D: a decision was not recorded (${outcome})`);
    return outcome.decisionId;
  }

  type Subject = { id: string; decisionId: string; third: string; thirdPost: string; followee: string };

  /**
   * An account at the ladder's first step with its announced suspension of 3 days: three strikes (a post made now, an
   * admin's own finding on it under R1 and a final removal, one after another), then an admin's finding on the account and
   * a moderator's final decision with the announced suspension, whose notice the scripted mailer accepts. A third account
   * with a post, and an account to follow, are the other parties of its writes.
   */
  async function subject(repo: ReturnType<typeof createSocialRepo>): Promise<Subject> {
    const account = await n.account();
    for (let i = 0; i < STANDING_RULES.ladderStrikes; i++) {
      const admin = await staffOf("admin");
      const postId = await newPostRow(n.apiDb, account.id, { createdAt: sql`clock_timestamp()`, body: "a post that breaks R1" });
      const caseId = (await intake(n.apiDb, ground.finding(admin.id, "R1"), aPost(postId))).items[0]!.caseId!;
      await decided(admin, caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
    }
    const opener = await staffOf("admin");
    const caseId = (await intake(n.apiDb, ground.finding(opener.id, "R1"), anAccount(account.id, account.handle))).items[0]!.caseId!;
    const decisionId = await decided(await staffOf("moderator"), caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", 3, true)] });
    const third = (await newProfile(n.apiDb)).id;
    const followee = (await newProfile(n.apiDb)).id;
    n.profileIds.push(third, followee);
    const thirdPost = await newPost(repo, third, new Date(), "a third account's post");
    return { id: account.id, decisionId, third, thirdPost, followee };
  }

  /** The database's clock, in epoch milliseconds. */
  async function dbNow(db: Db): Promise<number> {
    const [row] = await db.execute<{ ms: number }>(sql`select extract(epoch from clock_timestamp()) * 1000 as ms`);
    return Number(row!.ms);
  }

  /** How far the database's clock runs ahead of this process's: the middle of a read's round trip. */
  async function clockOffset(db: Db): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = Date.now();
      const at = await dbNow(db);
      samples.push(at - (before + Date.now()) / 2);
    }
    return samples.sort((a, b) => a - b)[2]!;
  }

  /** Waits until the database's clock reads `atMs`, by this process's clock and the offset. */
  const untilDb = (atMs: number, offset: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, atMs - offset - Date.now())));

  /**
   * Brings the account's start `leadMs` ahead of the database's clock: the migrator moves the account's ledger back by the
   * time left to its start, less the lead. Answers the start, in epoch milliseconds and as the database's text (to the
   * microsecond, for the comparisons made in SQL).
   */
  async function bringNear(id: string, leadMs: number): Promise<{ ms: number; text: string }> {
    for (let round = 0; ; round++) {
      const [row] = await cd.migrateDb.execute<{ secs: number | null }>(sql`select extract(epoch from (suspended_from - clock_timestamp()))::float8 as secs from profiles where id = ${id}::uuid`);
      if (row?.secs !== null && row?.secs !== undefined) {
        await ageStandingForTest(cd.migrateDb, id, `${(Number(row.secs) - leadMs / 1000).toFixed(6)} seconds`);
        break;
      }
      // The notice's outcome is recorded after the decision's commit: wait for it.
      if (round >= 50) throw new Error("lab C/D: the announced suspension got no start");
      await cd.moderation.settle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [after] = await cd.migrateDb.execute<{ ms: number; text: string }>(sql`select extract(epoch from suspended_from) * 1000 as ms, suspended_from::text as text from profiles where id = ${id}::uuid`);
    return { ms: Number(after!.ms), text: after!.text };
  }

  /** One of the account's writes through the social repository's own functions, by its number: a post, a reply, a like, a follow, its profile. */
  function realWrite(repo: ReturnType<typeof createSocialRepo>, s: Subject, i: number): () => Promise<unknown> {
    const kind = i % 5;
    if (kind === 0) return () => repo.createPost({ authorId: s.id, body: "a post", replyToId: null, quoteOfId: null, now: new Date() });
    if (kind === 1) return () => repo.createPost({ authorId: s.id, body: "a reply", replyToId: s.thirdPost, quoteOfId: null, now: new Date(), lockWith: s.third });
    if (kind === 2) return () => repo.like(s.id, s.thirdPost, new Date(), s.third).then(() => repo.unlike(s.id, s.thirdPost));
    if (kind === 3) return () => repo.follow(s.id, s.followee, new Date(), true).then(() => repo.unfollow(s.id, s.followee));
    return async () => {
      if (!(await repo.updateProfile(s.id, { bio: `bio ${i}` }))) throw Object.assign(new Error("refused"), { code: "account_suspended" });
    };
  }

  /** A write between two reads of the database's clock: when it was judged lies between them. */
  async function bracketed(db: Db, write: () => Promise<unknown>): Promise<{ t0: number; t1: number; result: string }> {
    const t0 = await dbNow(db);
    const { result } = await outcomeOf(write);
    return { t0, t1: await dbNow(db), result };
  }

  /**
   * A holder of the account's profile row: FOR UPDATE, and a change of the row when `changes` (bio = bio, a new version
   * of the row, as any writer of the row makes), held until the database's clock reads `untilMs`. `locked` resolves once
   * it has the row; `released` with the clock at its commit.
   */
  function hold(db: Db, id: string, untilMs: number, changes: boolean): { locked: Promise<void>; released: Promise<number> } {
    let signal: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => (signal = resolve));
    const released = db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(sql`select 1 from profiles where id = ${id}::uuid for update`);
      if (changes) await tx.execute(sql`update profiles set bio = bio where id = ${id}::uuid`);
      signal();
      await tx.execute(sql`select pg_sleep(greatest(0, ${untilMs / 1000}::float8 - extract(epoch from clock_timestamp())))`);
      return dbNow(tx as unknown as Db);
    });
    return { locked, released };
  }

  /**
   * C2's write: the gate of the social repository's writes copied here with now() in place of the clock (lab code), then
   * the count of the account's posts, as a post's write changes it. It answers whether it was admitted, and when it was
   * judged: the target list is computed again when the database judges the row again after a changing holder.
   */
  async function nowGatedWrite(db: Db, id: string): Promise<{ admitted: boolean; judged: number }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      const [row] = await tx.execute<{ suspended: boolean; judged: number }>(
        sql`select (p.suspended_from is not null and p.suspended_from <= now() and now() < p.suspended_until) as suspended,
                   extract(epoch from clock_timestamp()) * 1000 as judged
              from profiles p where p.id = ${id}::uuid and p.deleted_at is null for key share`,
      );
      if (!row || row.suspended) return { admitted: false, judged: Number(row?.judged ?? 0) };
      await tx.execute(sql`update profiles set post_count = post_count + 1 where id = ${id}::uuid`);
      return { admitted: true, judged: Number(row.judged) };
    });
  }

  /** The accounts' scenes, BATCH at a time. */
  async function inBatches<T>(items: T[], scene: (item: T) => Promise<void>): Promise<void> {
    for (let from = 0; from < items.length; from += BATCH) await Promise.all(items.slice(from, from + BATCH).map(scene));
  }

  /** The free loop: the account's real writes back to back until the database's clock reads `untilMs`, each between two reads of the clock. */
  async function freeLoop(db: Db, repo: ReturnType<typeof createSocialRepo>, s: Subject, untilMs: number) {
    const writes: { t0: number; t1: number; result: string }[] = [];
    for (let i = 0; (await dbNow(db)) < untilMs; i++) writes.push(await bracketed(db, realWrite(repo, s, i)));
    return writes;
  }

  const WAVE = 6;
  const LEAD_MS = 1500;

  test("labs C1 and C2: around an announced start no write judged at or after it commits under the clock; with now() some are", async () => {
    const count = Number(process.env.LAB_C_SUBJECTS ?? 25);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const holderDb = createDb(loadConfig().DATABASE_URL_API, { max: 12 });
    const repo = createSocialRepo(writersDb);
    try {
      const prepareStarted = performance.now();
      const c1: Subject[] = [];
      const c2: Subject[] = [];
      for (let i = 0; i < count; i++) c1.push(await subject(repo));
      for (let i = 0; i < count; i++) c2.push(await subject(repo));
      const prepareMs = Math.round(performance.now() - prepareStarted);
      const offset = await clockOffset(writersDb);
      const busyPercent = await busy();

      const r1 = {
        starts: 0,
        freeWrites: 0,
        freeCommittedBefore: 0,
        freeAdmittedAfterStart: 0,
        freeRefusedBeforeStart: 0,
        freeAcross: 0,
        freeAcrossLatestCommitMs: 0,
        freeOther: {} as Record<string, number>,
        waveWrites: 0,
        waveAdmittedAfterStart: 0,
        waveRefused: {} as Record<string, number>,
        lockOnlyWaveWrites: 0,
        lockOnlyCommittedAfterStart: 0,
        lockOnlyLatestCommitMs: 0,
        lockOnlyRefused: {} as Record<string, number>,
      };
      await inBatches(c1, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        r1.starts++;
        const free = freeLoop(writersDb, repo, s, start.ms + 1000);
        // The wave behind a holder that changes the row, from 400 ms before the start to 300 ms after it.
        await untilDb(start.ms - 400, offset);
        const changing = hold(holderDb, s.id, start.ms + 300, true);
        await changing.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, (_, k) => bracketed(writersDb, realWrite(repo, s, k))));
        await changing.released;
        for (const w of wave) {
          r1.waveWrites++;
          if (w.result === "committed") r1.waveAdmittedAfterStart++;
          else tally(r1.waveRefused, w.result);
        }
        for (const w of await free) {
          r1.freeWrites++;
          if (w.result === "committed") {
            if (w.t0 >= start.ms) r1.freeAdmittedAfterStart++;
            else if (w.t1 < start.ms) r1.freeCommittedBefore++;
            else {
              r1.freeAcross++;
              r1.freeAcrossLatestCommitMs = Math.max(r1.freeAcrossLatestCommitMs, Math.round(w.t1 - start.ms));
            }
          } else if (w.result === "account_suspended" && w.t1 < start.ms) r1.freeRefusedBeforeStart++;
          else if (w.result !== "account_suspended") tally(r1.freeOther, w.result);
        }
      });
      // The wave behind a holder that only locks the row: its writes are judged before they wait (recorded, not asserted).
      // C1's accounts are suspended now, so this runs on half of C2's accounts, whose start is still ahead; C2 then runs
      // on the other half and on as many new accounts.
      const lockOnly = c2.slice(0, Math.max(1, Math.floor(count / 2)));
      await inBatches(lockOnly, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        await untilDb(start.ms - 400, offset);
        const holder = hold(holderDb, s.id, start.ms + 300, false);
        await holder.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, (_, k) => bracketed(writersDb, realWrite(repo, s, k))));
        await holder.released;
        for (const w of wave) {
          r1.lockOnlyWaveWrites++;
          if (w.result === "committed") {
            if (w.t1 >= start.ms) {
              r1.lockOnlyCommittedAfterStart++;
              r1.lockOnlyLatestCommitMs = Math.max(r1.lockOnlyLatestCommitMs, Math.round(w.t1 - start.ms));
            }
          } else tally(r1.lockOnlyRefused, w.result);
        }
      });
      line("lab-C1", { subjects: count, ...r1, prepareMs, clockOffsetMs: Math.round(offset), busyPercent });

      // C2: the wave behind a changing holder, with the predicate reading now(), on accounts whose start is still ahead.
      const fresh: Subject[] = c2.slice(lockOnly.length);
      for (let i = fresh.length; i < count; i++) fresh.push(await subject(repo));
      const r2 = { starts: 0, writes: 0, admittedAfterStart: 0, latestAdmittedAfterStartMs: 0, admittedBefore: 0, refused: 0 };
      await inBatches(fresh, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        r2.starts++;
        await untilDb(start.ms - 400, offset);
        const changing = hold(holderDb, s.id, start.ms + 300, true);
        await changing.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, () => nowGatedWrite(writersDb, s.id)));
        await changing.released;
        for (const w of wave) {
          r2.writes++;
          if (!w.admitted) r2.refused++;
          else if (w.judged >= start.ms) {
            r2.admittedAfterStart++;
            r2.latestAdmittedAfterStartMs = Math.max(r2.latestAdmittedAfterStartMs, Math.round(w.judged - start.ms));
          } else r2.admittedBefore++;
        }
      });
      line("lab-C2", { subjects: fresh.length, ...r2, busyPercent: await busy() });

      expect(r1.starts).toBe(count);
      expect(r1.freeAdmittedAfterStart).toBe(0);
      expect(r1.freeRefusedBeforeStart).toBe(0);
      expect(r1.waveAdmittedAfterStart).toBe(0);
      expect(r1.waveWrites).toBe(count * WAVE);
      expect(r2.admittedAfterStart).toBeGreaterThan(0);
    } finally {
      await Promise.all([closeDb(writersDb), closeDb(holderDb)]);
    }
  }, 1_800_000);

  test("lab D: replies around the start: on_time equals filed_at < start; no write refused before a start or after an on-time reply, none admitted after the start of a late one", async () => {
    const count = Number(process.env.LAB_D_SUBJECTS ?? 60);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const repo = createSocialRepo(writersDb);
    try {
      const subjects: Subject[] = [];
      for (let i = 0; i < count; i++) subjects.push(await subject(repo));
      const offset = await clockOffset(writersDb);
      const busyPercent = await busy();
      const r = {
        replies: 0,
        onTime: 0,
        late: 0,
        mismatches: 0,
        replyErrors: {} as Record<string, number>,
        earliestFiledMs: Number.POSITIVE_INFINITY,
        latestFiledMs: Number.NEGATIVE_INFINITY,
        writes: 0,
        refusedBeforeStart: 0,
        refusedAfterOnTimeReply: 0,
        admittedAfterLateStart: 0,
        across: 0,
        otherOutcomes: {} as Record<string, number>,
      };
      await inBatches(subjects, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        const free = freeLoop(writersDb, repo, s, start.ms + 1000);
        await untilDb(start.ms - 300 + Math.random() * 600, offset);
        try {
          await fileReply(n.deps, s.id, s.decisionId, { statement: "lab D" });
        } catch (err) {
          tally(r.replyErrors, String((err as { code?: unknown }).code ?? "error"));
        }
        const writes = await free;
        const [reply] = await cd.migrateDb.execute<{ on_time: boolean; before: boolean; filed_ms: number }>(
          sql`select on_time, filed_at < ${start.text}::timestamptz as before, extract(epoch from filed_at) * 1000 - ${start.ms}::float8 as filed_ms
                from suspension_replies where account_id = ${s.id}::uuid`,
        );
        if (!reply) return;
        r.replies++;
        if (reply.on_time) r.onTime++;
        else r.late++;
        if (reply.on_time !== reply.before) r.mismatches++;
        r.earliestFiledMs = Math.min(r.earliestFiledMs, Math.round(Number(reply.filed_ms)));
        r.latestFiledMs = Math.max(r.latestFiledMs, Math.round(Number(reply.filed_ms)));
        for (const w of writes) {
          r.writes++;
          const refused = w.result === "account_suspended";
          if (w.result !== "committed" && !refused) tally(r.otherOutcomes, w.result);
          else if (refused && w.t1 < start.ms) r.refusedBeforeStart++;
          else if (refused && reply.on_time) r.refusedAfterOnTimeReply++;
          else if (!refused && !reply.on_time && w.t0 >= start.ms) r.admittedAfterLateStart++;
          else if (w.t0 < start.ms && start.ms <= w.t1) r.across++;
        }
      });
      line("lab-D", { subjects: count, ...r, clockOffsetMs: Math.round(offset), busyPercent });
      expect(r.replies).toBe(count);
      expect(r.mismatches).toBe(0);
      expect(r.refusedBeforeStart).toBe(0);
      expect(r.refusedAfterOnTimeReply).toBe(0);
      expect(r.admittedAfterLateStart).toBe(0);
    } finally {
      await closeDb(writersDb);
    }
  }, 1_800_000);
});

/**
 * Explore's round under formula version 1, as 2c built it and as it ran until 3e's Task 6, copied here (lab F's baseline;
 * never a switch in the code): the candidates by created_at alone with live authors, the engagement with live engagers,
 * the score by the age since created_at, and the same transaction around it as refreshExplore's, writing a ranking of
 * formula 1. It answers the round's counts.
 */
async function roundV1(db: Db, asOf: Date): Promise<{ generation: number; candidates: number; items: number }> {
  // Version 2 keeps every number of version 1 (3e design, section 10.1).
  const f = EXPLORE_V2;
  const at = sql`${asOf.toISOString()}::timestamptz`;
  const since = sql`${at} - (${f.windowHours}::float8 * interval '1 hour')`;
  const settled = sql`${at} - (${f.standingMinutes}::float8 * interval '1 minute')`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '30s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const [run] = await tx.execute<{ generation: number }>(sql`insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${at}, 1, 0, 0, 0) returning generation`);
    const generation = run!.generation;
    const [counts] = await tx.execute<{ candidates: number; items: number }>(sql`
      with c as (
        select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
        where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
          and a.deleted_at is null and a.show_in_explore),
      e as (
        select x.post_id, x.user_id from (
          select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}
          union all
          select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}
        ) x
        join c on c.id = x.post_id
        join profiles u on u.id = x.user_id
        where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - (${f.engagerMinAgeHours}::float8 * interval '1 hour')),
      ap as (select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${f.threshold}),
      s as (
        select c.id as post_id, c.author_id,
          ap.approvers / power(greatest(0, extract(epoch from (${at} - c.created_at))::float8 / 3600) + ${f.offsetHours}::float8, ${f.gravity}::float8) as score
        from ap join c on c.id = ap.post_id),
      r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
      k as (
        select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
        from r where r.author_rank <= ${f.perAuthor} order by position limit ${f.listLength}),
      ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
      select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`);
    await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items} where generation = ${generation}`);
    await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${f.kept}) g)`);
    return { generation, candidates: counts!.candidates, items: counts!.items };
  });
}

/** What one round of lab F answered. */
type LabFRound = { generation: number; candidates: number; items: number };

/**
 * Writes lab F's rows as the migrator (the comment of lab F says what), as of `asOf`, under two display names that mark
 * them; answers the sizes it wrote.
 */
async function labFData(migrateDb: Db, asOf: Date, names: { authors: string; engagers: string; mark: string }, n: { posts: number; likedPosts: number; authors: number; engagers: number; likesPerPost: number }) {
  const at = sql`${asOf.toISOString()}::timestamptz`;
  const since = sql`${at} - (${EXPLORE_V2.windowHours}::float8 * interval '1 hour')`;
  // The accounts, a month old at the round, with handles of twenty characters that nothing else holds.
  for (const [name, count, tag] of [[names.authors, n.authors, "a"], [names.engagers, n.engagers, "e"]] as const) {
    await migrateDb.execute(sql`
      insert into profiles (id, handle, display_name, created_at)
      select gen_random_uuid(), 'lf_' || substr(md5(${names.mark} || ${tag} || g::text), 1, 17), ${name}, ${at} - interval '30 days' from generate_series(1, ${count}::int) g`);
  }
  // One post every so many milliseconds back from the round, over 72 hours, the authors in turn.
  const spacingMs = (72 * 3_600_000) / n.posts;
  await migrateDb.execute(sql`
    with a as (select id, row_number() over (order by id) - 1 as n from profiles where display_name = ${names.authors})
    insert into posts (author_id, body, created_at)
    select a.id, 'lab F', ${at} - (g * ${spacingMs}::float8 * interval '1 millisecond')
      from generate_series(0, ${n.posts}::int - 1) g join a on a.n = g % ${n.authors}::int`);
  // Restored: one post in a hundred of those before the window, hidden from its creation for 30 hours and given that time
  // back, as moderation_apply writes it.
  await migrateDb.execute(sql`
    with old as (
      select p.id, row_number() over (order by p.created_at, p.id) as n from posts p join profiles a on a.id = p.author_id
       where a.display_name = ${names.authors} and p.created_at <= ${since})
    update posts p set hidden_at = p.created_at, restored_at = p.created_at + interval '30 hours', explore_from = p.created_at + interval '30 hours'
      from old where p.id = old.id and old.n % 100 = 0`);
  // Six likes on each of the newest posts, seven minutes apart, each by another engager.
  await migrateDb.execute(sql`
    with p as (
      select p.id, p.created_at, row_number() over (order by p.created_at desc, p.id) - 1 as n from posts p join profiles a on a.id = p.author_id
       where a.display_name = ${names.authors}),
    e as (select id, row_number() over (order by id) - 1 as n from profiles where display_name = ${names.engagers})
    insert into likes (user_id, post_id, created_at)
    select e.id, p.id, p.created_at + ((k + 1) * interval '7 minutes')
      from p cross join generate_series(0, ${n.likesPerPost}::int - 1) k join e on e.n = (p.n * 7 + k * 131) % ${n.engagers}::int
     where p.n < ${n.likedPosts}::int`);
  // One author in twenty and one engager in twenty suspended over the round's time.
  for (const name of [names.authors, names.engagers]) {
    await migrateDb.execute(sql`
      update profiles set suspended_from = ${at} - interval '1 day', suspended_until = ${at} + interval '1 day'
       where id in (select id from (select id, row_number() over (order by id) as n from profiles where display_name = ${name}) s where s.n % 20 = 0)`);
  }
  for (const table of ["profiles", "posts", "likes"]) await migrateDb.execute(sql.raw(`analyze ${table}`));
  const [sizes] = await migrateDb.execute<{ posts: number; likes: number; restored: number; suspendedAuthors: number; suspendedEngagers: number }>(sql`
    select (select count(*)::int from posts p join profiles a on a.id = p.author_id where a.display_name = ${names.authors}) as posts,
           (select count(*)::int from likes l join profiles u on u.id = l.user_id where u.display_name = ${names.engagers}) as likes,
           (select count(*)::int from posts p join profiles a on a.id = p.author_id where a.display_name = ${names.authors} and p.explore_from is not null) as restored,
           (select count(*)::int from profiles where display_name = ${names.authors} and suspended_from is not null) as "suspendedAuthors",
           (select count(*)::int from profiles where display_name = ${names.engagers} and suspended_from is not null) as "suspendedEngagers"`);
  return { ...sizes! };
}

/**
 * Lab F (3e design, section 12.3; Task 6): Explore's round on generated data, under version 1 (roundV1 above) and under
 * version 2 (the repository's own refreshExplore), in turns on the same rows, as of one time in 2019, a past no suite
 * ranks in. As the migrator it writes LAB_F_POSTS posts (60,000 unless set) by 3,000 authors, one every 4.32 seconds
 * back from the round over 72 hours, so a third lie before the window; 1,000 engaging accounts; six likes on each of the
 * newest LAB_F_LIKED_POSTS posts (50,100 unless set: 300,600 likes, the design's LAB F); one author in twenty and one
 * engager in twenty suspended over the round's time; and one post in a hundred of those before the window hidden for 30
 * hours and given its time back (labFData). Each version then ranks LAB_F_ROUNDS times (5 unless set), after one round
 * each to warm up. It passes when both medians are of the same order (neither more than three times the other), when
 * version 2 ranks no suspended author, and when restored posts are among its candidates. It records the sizes, each
 * version's times, medians and counts, and how busy the machine was. What it wrote is deleted at the end, with every
 * ranking.
 */
describe.skipIf(!process.env.INTEGRATION)("lab: Explore's round under formula versions 1 and 2 (Task 6)", () => {
  test("lab F: the round's statement under version 1 (copied here) and version 2 on the same generated data: the same order of cost", async () => {
    const n = { posts: Number(process.env.LAB_F_POSTS ?? 60_000), likedPosts: Number(process.env.LAB_F_LIKED_POSTS ?? 50_100), authors: 3_000, engagers: 1_000, likesPerPost: 6 };
    const rounds = Number(process.env.LAB_F_ROUNDS ?? 5);
    const asOf = new Date(Date.UTC(2019, 5, 1, 12));
    const at = sql`${asOf.toISOString()}::timestamptz`;
    const since = sql`${at} - (${EXPLORE_V2.windowHours}::float8 * interval '1 hour')`;
    const mark = randomBytes(4).toString("hex");
    const names = { authors: `lab F author ${mark}`, engagers: `lab F engager ${mark}`, mark };
    const apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 2 });
    const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createSocialRepo(apiDb);
    try {
      await apiDb.execute(sql`delete from explore_runs`);
      const sizes = await labFData(migrateDb, asOf, names, n);
      const busyPercent = await busy();
      // A round of each version in turn, the first of each to warm up; version 2 with no minimum gap, so every round ranks.
      const again = { ...EXPLORE_V2, minGapMinutes: 0 };
      const times = { v1: [] as number[], v2: [] as number[] };
      let v1: LabFRound | null = null;
      let v2: LabFRound | null = null;
      for (let i = 0; i <= rounds; i++) {
        let started = performance.now();
        v1 = await roundV1(apiDb, asOf);
        const v1Ms = performance.now() - started;
        started = performance.now();
        const ranked = await repo.refreshExplore(asOf, again);
        const v2Ms = performance.now() - started;
        if (ranked.skipped) throw new Error("lab F: a round of version 2 skipped");
        v2 = { generation: ranked.generation, candidates: ranked.candidates, items: ranked.items };
        if (i === 0) continue;
        times.v1.push(v1Ms);
        times.v2.push(v2Ms);
      }
      const median = (list: number[]) => Math.round(percentile([...list].sort((x, y) => x - y), 0.5)!);
      const [v1Median, v2Median] = [median(times.v1), median(times.v2)];
      // Version 2's newest ranking holds no post of a suspended author; the restored posts it could count as candidates.
      const [check] = await migrateDb.execute<{ suspendedItems: number; restoredCandidates: number }>(sql`
        select (select count(*)::int from explore_items i join profiles a on a.id = i.author_id
                 where i.generation = ${v2!.generation}::int and a.suspended_from <= ${at} and ${at} < a.suspended_until) as "suspendedItems",
               (select count(*)::int from posts p join profiles a on a.id = p.author_id
                 where a.display_name = ${names.authors} and p.explore_from is not null and p.created_at <= ${since} and p.explore_from > ${since} and p.explore_from <= ${at}
                   and not (a.suspended_from is not null and a.suspended_from <= ${at} and ${at} < a.suspended_until)) as "restoredCandidates"`);
      line("lab-F", {
        ...sizes,
        authors: n.authors,
        engagers: n.engagers,
        rounds,
        v1MedianMs: v1Median,
        v2MedianMs: v2Median,
        ratio: Math.round((v2Median / Math.max(1, v1Median)) * 100) / 100,
        v1Ms: times.v1.map(Math.round),
        v2Ms: times.v2.map(Math.round),
        v1: { candidates: v1!.candidates, items: v1!.items },
        v2: { candidates: v2!.candidates, items: v2!.items },
        ...check!,
        busyPercent,
      });
      expect(sizes.posts).toBe(n.posts);
      expect(sizes.likes).toBe(n.likedPosts * n.likesPerPost);
      expect(v2Median).toBeLessThan(3 * v1Median);
      expect(v1Median).toBeLessThan(3 * v2Median);
      expect(check!.suspendedItems).toBe(0);
      expect(check!.restoredCandidates).toBeGreaterThan(0);
    } finally {
      try {
        await apiDb.execute(sql`delete from explore_runs`);
        await migrateDb.execute(sql`delete from likes where user_id in (select id from profiles where display_name = ${names.engagers})`);
        await migrateDb.execute(sql`delete from posts where author_id in (select id from profiles where display_name = ${names.authors})`);
        await migrateDb.execute(sql`delete from profiles where display_name in (${names.authors}, ${names.engagers})`);
      } finally {
        await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
      }
    }
  }, 1_800_000);
});
