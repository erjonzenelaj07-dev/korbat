import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { recordIntake, type IntakeRecorded, type LiveTarget } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { deletePost } from "../../src/social/flows/posts";
import { createSocialRepo } from "../../src/social/repo";
import { aPost, authCaseCounts, gate, ground, moderationDeps, removeFixtures, rowCounts, untilBlocked } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { socialHarness } from "./social-harness";
import { pgError, withLockTimeout } from "./staff-fixtures";

// Each test holds one transaction open until another session waits for it, and one sleeps past the database's deadlock
// check: on a loaded machine that takes far longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 90_000 });

/** Longer than PostgreSQL's deadlock_timeout (one second): a session that has waited this long has made its one check. */
const PAST_THE_DEADLOCK_CHECK_MS = 1_600;

/**
 * The order in which the paths that take two posts take them (3c design, section 2, row Lock order), against the real
 * database. An intake copies every post it reaches under a share lock, in id order, and a report of child sexual abuse
 * material about a post that quotes another reaches both by itself. The author's deletion writes its post and then the
 * counter of the post it quoted or replied to; a new post writes the counters of the post it replies to and of the post
 * it quotes. Each of them takes its posts in id order before it writes one, so none can hold the higher post while it
 * waits for the lower one that an intake holds. The races are made to happen, never waited for: one side is stopped
 * while it holds its first post, the other is started, and the test goes on once the database reports a session as
 * waiting. Every test commits (two sessions must see the rows) and removes what it committed in a `finally`.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: two posts are taken in one order by an intake, a deletion and a new post", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 8 });
    // The migrate role is not part of the API configuration; the test environment carries it, for the fixtures' cleanup.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await counts();
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** How many rows the tables these tests write, and the four auth tables of moderation cases, hold. */
  const counts = async (): Promise<Record<string, number>> => ({ ...(await rowCounts(apiDb)), ...(await authCaseCounts(migrateDb)) });

  /**
   * An author with two committed posts: `lower`, and `higher`, which quotes it or replies to it. The ids are chosen so
   * that the quoted or replied-to post sorts first, which is the half of all pairs where the two paths met in opposite
   * orders: the intake takes `lower` first, and the deletion of `higher` wrote `higher` first.
   */
  async function pair(link: "quote" | "reply") {
    const author = await newProfile(apiDb);
    const [lower, higher] = [randomUUID(), randomUUID()].sort() as [string, string];
    const counter = link === "quote" ? sql`quote_count` : sql`reply_count`;
    const column = link === "quote" ? sql`quote_of_id` : sql`reply_to_id`;
    // Dated a month back, as every fixture post is: other suites read the newest posts of the shared database.
    await apiDb.execute(sql`insert into posts (id, author_id, body, ${counter}, created_at) values (${lower}::uuid, ${author.id}::uuid, 'the earlier post', 1, now() - interval '30 days')`);
    await apiDb.execute(sql`insert into posts (id, author_id, body, ${column}, created_at) values (${higher}::uuid, ${author.id}::uuid, 'the later post', ${lower}::uuid, now() - interval '30 days')`);
    return { author, lower, higher };
  }
  /** The moderation module's dependencies with a social interface that counts each copy of `postId` and, when `stop` is given, stops after the first until it is opened. */
  function countingCopies(postId: string, stop?: { reached: ReturnType<typeof gate>; goOn: ReturnType<typeof gate> }) {
    const social = socialForModeration(apiDb);
    const seen = { copies: 0 };
    const deps = moderationDeps(apiDb, {
      social: {
        ...social,
        capturePost: async (tx, id) => {
          const post = await social.capturePost(tx, id);
          if (id === postId) {
            seen.copies++;
            if (stop && seen.copies === 1) {
              stop.reached.open();
              await stop.goOn.opened;
            }
          }
          return post;
        },
      },
    });
    return { deps, seen };
  }
  /** The social flows' dependencies with a repository that counts the deletions it was asked for. */
  function countingDeletions() {
    const s = socialHarness(apiDb);
    const seen = { deletions: 0 };
    const deps = {
      ...s.deps,
      repo: {
        ...s.repo,
        deletePost: (...args: Parameters<typeof s.repo.deletePost>) => {
          seen.deletions++;
          return s.repo.deletePost(...args);
        },
      },
    };
    return { deps, seen };
  }
  /** Whether another session could take this post's row for share at once: null when it could. */
  const shareNow = (postId: string) => pgError(withLockTimeout(migrateDb, (tx) => tx.execute(sql`select id from posts where id = ${postId}::uuid for share nowait`)));
  /** What both sides left once they committed: the later post is a tombstone, the earlier one's counter is back at zero, and the intake's items stand in a case each. */
  async function expectBothCommitted(made: { lower: string; higher: string }, recorded: IntakeRecorded) {
    const posts = await apiDb.execute<{ id: string; state: string; counted: number }>(
      sql`select id, state, quote_count + reply_count as counted from posts where id in (${made.lower}::uuid, ${made.higher}::uuid) order by id`,
    );
    expect(posts.map((row) => ({ ...row }))).toEqual([
      { id: made.lower, state: "visible", counted: 0 },
      { id: made.higher, state: "deleted_by_author", counted: 0 },
    ]);
    expect(recorded.items.map((item) => item.targetId).sort()).toEqual([made.lower, made.higher]);
    const [stored] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from intake_items where intake_id = ${recorded.intakeId}::uuid and case_id is not null`);
    expect(stored!.n).toBe(2);
  }

  test.each([
    { link: "quote" as const, by: "a report of child sexual abuse material about the quoting post, which reaches the quoted post by itself" },
    { link: "reply" as const, by: "a report that names a reply and the post it replies to" },
  ])("the intake first ($by): the author's deletion waits at the lower post and holds nothing of the higher one, and both commit without either being ended", async ({ link }) => {
    const [made, reporter] = [await pair(link), await newProfile(apiDb)];
    try {
      const stop = { reached: gate(), goOn: gate() };
      const intake = countingCopies(made.lower, stop);
      const deletion = countingDeletions();
      const live: LiveTarget[] = link === "quote" ? [aPost(made.higher)] : [aPost(made.higher, 1), aPost(made.lower, 2)];
      const reporting = recordIntake(intake.deps, { ground: link === "quote" ? ground.csam() : ground.rule(reporter.id), live });
      let deleting: Promise<void> | null = null;
      try {
        // The intake holds the lower post for share and has not asked for the higher one.
        await stop.reached.opened;
        deleting = deletePost(deletion.deps, made.author.id, made.higher);
        // The intake's session is idle; the session that waits for a lock on a statement about posts is the deletion's.
        await untilBlocked(apiDb, "posts");
        // The deletion has not written its own post: a deletion that had would hold it while it waits for the lower
        // one, and the intake, which asks for the higher post next, would wait for it in turn.
        expect(await shareNow(made.higher)).toBeNull();
      } finally {
        stop.goOn.open();
        await Promise.allSettled([reporting, ...(deleting ? [deleting] : [])]);
      }
      await deleting;
      await expectBothCommitted(made, await reporting);
      // The database ended neither transaction: each ran once.
      expect({ copies: intake.seen.copies, deletions: deletion.seen.deletions }).toEqual({ copies: 1, deletions: 1 });
    } finally {
      await removeFixtures(migrateDb, [made.author.id, reporter.id]);
    }
  });

  test("the deletion first, stopped where it takes the quoted post: the report that arrives meanwhile copies both posts and commits, and the deletion then commits without being ended", async () => {
    const made = await pair("quote");
    try {
      const intake = countingCopies(made.lower);
      const deletion = countingDeletions();
      const [held, release] = [gate(), gate()];
      // Another transaction holds the quoted post for share, as a second report that copies it does: the deletion stops
      // at that post, and a share lock keeps no other report from it.
      const holder = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select id from posts where id = ${made.lower}::uuid for share`);
        held.open();
        await release.opened;
      });
      await held.opened;
      const deleting = deletePost(deletion.deps, made.author.id, made.higher);
      let reporting: Promise<IntakeRecorded> | null = null;
      try {
        await untilBlocked(apiDb, "posts");
        reporting = recordIntake(intake.deps, { ground: ground.csam(), live: [aPost(made.higher)] });
        // The report either commits (the deletion holds nothing it needs) or comes to wait for the quoting post that a
        // deletion wrote before it asked for the quoted one.
        await Promise.race([reporting.catch(() => undefined), untilBlocked(apiDb, "for share of p").catch(() => undefined)]);
        // A waiting report has made its one deadlock check by the time the holder lets go, so a deletion that then
        // completes a cycle is the transaction the database ends: the author's delete, which nothing ran again.
        await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEADLOCK_CHECK_MS));
      } finally {
        release.open();
        await holder;
        await Promise.allSettled([deleting, ...(reporting ? [reporting] : [])]);
      }
      await deleting;
      await expectBothCommitted(made, await reporting!);
      expect({ copies: intake.seen.copies, deletions: deletion.seen.deletions }).toEqual({ copies: 1, deletions: 1 });
    } finally {
      await removeFixtures(migrateDb, [made.author.id]);
    }
  });

  test("a new post that replies to one post and quotes another takes the two in id order before it writes either counter", async () => {
    const [author, other] = [await newProfile(apiDb), await newProfile(apiDb)];
    try {
      const [lower, higher] = [randomUUID(), randomUUID()].sort() as [string, string];
      for (const id of [lower, higher]) await apiDb.execute(sql`insert into posts (id, author_id, body, created_at) values (${id}::uuid, ${other.id}::uuid, 'a post', now() - interval '30 days')`);
      const [held, release] = [gate(), gate()];
      // An intake that reaches both posts holds the lower one first.
      const holder = withLockTimeout(migrateDb, async (tx) => {
        await tx.execute(sql`select id from posts where id = ${lower}::uuid for share`);
        held.open();
        await release.opened;
      });
      await held.opened;
      // The reply's counter is written before the quote's: with the higher post as the one replied to, a new post that
      // wrote without an order would hold the higher post while it waits for the lower.
      const creating = createSocialRepo(apiDb).createPost({ authorId: author.id, body: "a reply that quotes", replyToId: higher, quoteOfId: lower, now: new Date(Date.now() - 30 * 24 * 3_600_000) });
      try {
        await untilBlocked(apiDb, "posts");
        expect(await shareNow(higher)).toBeNull();
      } finally {
        release.open();
        await holder;
        await creating.catch(() => undefined);
      }
      const created = await creating;
      const rows = await apiDb.execute<{ id: string; reply_count: number; quote_count: number }>(sql`select id, reply_count, quote_count from posts where id in (${lower}::uuid, ${higher}::uuid) order by id`);
      expect(rows.map((row) => ({ ...row }))).toEqual([
        { id: lower, reply_count: 0, quote_count: 1 },
        { id: higher, reply_count: 1, quote_count: 0 },
      ]);
      expect(typeof created).toBe("string");
    } finally {
      await removeFixtures(migrateDb, [author.id, other.id]);
    }
  });

  test("this file left no row behind: the tables it writes, the moderation tables and the four auth tables of moderation cases hold what they held before it", async () => {
    expect(await counts()).toEqual(before);
  });
});
