import { randomBytes, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTIVITY_DEFAULTS, ACTIVITY_KINDS, ACTIVITY_REACH, MENTION_STORE_MAX } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { storedImageName } from "../../src/media/files";
import { newImageRow, newPostRow, removeFixtures, rowCounts } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Several tests here hold a transaction open across dozens of statements: on a loaded machine that takes longer than the
// five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/** 2d's three tables (migration 0049_activity), which the row-count test at the end adds to the suites' usual tables. */
const ACTIVITY_TABLES = ["activity_items", "activity_state", "post_mentions"];

/** A PostgreSQL error as these tests compare it: its SQLSTATE and its message. */
type PgError = { code: string; message: string };
const asPgError = (err: unknown): PgError => {
  const cause = ((err as { cause?: unknown }).cause ?? err) as { message?: unknown; code?: unknown };
  return { code: String(cause.code ?? ""), message: String(cause.message ?? cause) };
};
/** activity_state_guard's refusal (6.2): activity_seen under SQLSTATE 42501. */
const SEEN_REFUSED: PgError = { code: "42501", message: "activity_seen" };
/** post_mentions_insert's refusal (6.3): mention_column under SQLSTATE 42501. */
const MENTION_REFUSED: PgError = { code: "42501", message: "mention_column" };
/** A CHECK's refusal, by the constraint's name. */
const check = (name: string) => ({ code: "23514", message: expect.stringContaining(name) });
/** A unique key's refusal, by the index's or the key's name. */
const unique = (name: string) => ({ code: "23505", message: expect.stringContaining(name) });
/** A statement the role's grants refuse. */
const DENIED = { code: "42501", message: expect.stringMatching(/^permission denied/) };

/** One statement in a savepoint whose effect stays: its error, or null. */
async function step(tx: DbTx, statement: SQL): Promise<PgError | null> {
  try {
    await tx.transaction((sp) => sp.execute(statement));
    return null;
  } catch (err) {
    return asPgError(err);
  }
}

/** One statement in a savepoint that is always rolled back: whether the database would take it, and nothing more. */
const UNDO = new Error("undone on purpose");
async function attempt(tx: DbTx, statement: SQL): Promise<PgError | null> {
  try {
    await tx.transaction(async (sp) => {
      await sp.execute(statement);
      throw UNDO;
    });
  } catch (err) {
    if (err === UNDO) return null;
    return asPgError(err);
  }
  throw new Error("the savepoint was not rolled back");
}

/**
 * Migration 0049_activity and the grants of 0050_post_options (2d design, sections 6.1 to 6.3, 6.5 and 6.6; section 12.3),
 * against the real database, as the API role unless a test says otherwise: every CHECK and unique key of the three
 * tables, the entry's time activity_items_insert forces, the seen marker activity_state_guard moves only forward and
 * never past the clock, post_mentions_insert's visible and native post, post_mentions_erase, the grants and row level
 * security, both enums and MENTION_STORE_MAX against the contracts, and lost_told_for's rows and callers. Every test runs
 * in a transaction that is rolled back, but the one whose posts the API role must see committed, which removes them, so
 * the file leaves the database as it found it; its last test holds it to that. Task 3 adds the avatar half and Task 4 the
 * moderation half, before that last test.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Activity's tables, mentions, their guards and grants", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb, ACTIVITY_TABLES);
  }, 120_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A transaction of the API role that is rolled back, with its lock timeout. */
  const asApi = (fn: (tx: DbTx) => Promise<void>) => rolledBack(apiDb, fn);
  /** The same as the migrator, whose plain triggers skip it. */
  const asMigrator = (fn: (tx: DbTx) => Promise<void>) => rolledBack(migrateDb, fn);
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);

  /** An entry as createPost and follow insert it (5.3): the database makes the id and the time. */
  const entrySql = (recipientId: string, kind: string, actorId: string, postId: string | null): SQL =>
    sql`insert into activity_items (recipient_id, kind, actor_id, post_id) values (${recipientId}::uuid, ${kind}::activity_kind, ${actorId}::uuid, ${postId}::uuid)`;
  /** A stored mention, as createPost's one insert writes it (4.2). */
  const mentionSql = (postId: string, accountId: string, handle: string, position: number): SQL =>
    sql`insert into post_mentions (post_id, account_id, handle, position) values (${postId}::uuid, ${accountId}::uuid, ${handle}, ${position})`;

  describe("activity_items: its CHECKs, its unique keys and its time", () => {
    test("a reply, a mention or a quote names its post, a follow none; nobody is told of their own act", async () => {
      await asApi(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const post = await newPostRow(tx, bob.id);
        for (const kind of ["reply", "mention", "quote"]) {
          expect(await attempt(tx, entrySql(ada.id, kind, bob.id, post)), kind).toBeNull();
          expect(await attempt(tx, entrySql(ada.id, kind, bob.id, null)), kind).toEqual(check("activity_items_post"));
        }
        expect(await attempt(tx, entrySql(ada.id, "follow", bob.id, null))).toBeNull();
        expect(await attempt(tx, entrySql(ada.id, "follow", bob.id, post))).toEqual(check("activity_items_post"));
        expect(await attempt(tx, entrySql(bob.id, "reply", bob.id, post))).toEqual(check("activity_items_not_self"));
        expect(await attempt(tx, entrySql(bob.id, "follow", bob.id, null))).toEqual(check("activity_items_not_self"));
        // A kind outside the enum is no kind at all.
        expect((await attempt(tx, entrySql(ada.id, "like", bob.id, post)))?.code).toBe("22P02");
      });
    });

    test("one entry per recipient and post, whatever its kind, and one follow entry per pair; another recipient or another post is another entry", async () => {
      await asApi(async (tx) => {
        const [ada, bob, cat] = [await profile(tx), await profile(tx), await profile(tx)];
        const [first, second] = [await newPostRow(tx, bob.id), await newPostRow(tx, bob.id)];
        expect(await step(tx, entrySql(ada.id, "reply", bob.id, first))).toBeNull();
        // A reply that also mentions or quotes its parent's author makes one entry (5.1).
        expect(await attempt(tx, entrySql(ada.id, "mention", bob.id, first))).toEqual(unique("activity_items_post_once"));
        expect(await attempt(tx, entrySql(ada.id, "quote", bob.id, first))).toEqual(unique("activity_items_post_once"));
        expect(await step(tx, entrySql(cat.id, "mention", bob.id, first))).toBeNull();
        expect(await step(tx, entrySql(ada.id, "mention", bob.id, second))).toBeNull();
        // A follow, unfollow and follow again is one entry (5.3); the other way round is another pair.
        expect(await step(tx, entrySql(ada.id, "follow", bob.id, null))).toBeNull();
        expect(await attempt(tx, entrySql(ada.id, "follow", bob.id, null))).toEqual(unique("activity_items_follow_once"));
        expect(await step(tx, entrySql(bob.id, "follow", ada.id, null))).toBeNull();
        expect(await step(tx, entrySql(ada.id, "follow", cat.id, null))).toBeNull();
        const [row] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from activity_items where recipient_id in (${ada.id}::uuid, ${bob.id}::uuid, ${cat.id}::uuid)`);
        expect(row!.n).toBe(6);
      });
    });

    test("activity_items_insert forces the time to now() for the API role, whatever the insert sent; the migrator's insert keeps its own", async () => {
      await asApi(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        for (const at of ["2001-01-01T00:00:00Z", "2999-01-01T00:00:00Z"]) {
          const [row] = await tx.execute<{ forced: boolean; id: string }>(sql`
            insert into activity_items (id, recipient_id, kind, actor_id, created_at) values (gen_random_uuid(), ${ada.id}::uuid, 'follow', ${bob.id}::uuid, ${at}::timestamptz)
            returning created_at = now() as forced, id`);
          expect(row!.forced, at).toBe(true);
          await tx.execute(sql`delete from activity_items where id = ${row!.id}::uuid`);
        }
        // A deletion is the API's (deletePost, block, the purge, the retention job); an update never is.
        await tx.execute(entrySql(ada.id, "follow", bob.id, null));
        expect(await attempt(tx, sql`update activity_items set created_at = now() - interval '91 days' where recipient_id = ${ada.id}::uuid`)).toEqual(DENIED);
        expect(await attempt(tx, sql`delete from activity_items where recipient_id = ${ada.id}::uuid`)).toBeNull();
      });
      await asMigrator(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const [row] = await tx.execute<{ at: string }>(sql`
          insert into activity_items (recipient_id, kind, actor_id, created_at) values (${ada.id}::uuid, 'follow', ${bob.id}::uuid, '2001-01-01T00:00:00Z')
          returning to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as at`);
        expect(row!.at).toBe("2001-01-01");
      });
    });

    test("a post's entries go with its post (on delete cascade), which only the migrator deletes", async () => {
      await asMigrator(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const post = await newPostRow(tx, bob.id);
        await tx.execute(entrySql(ada.id, "reply", bob.id, post));
        await tx.execute(sql`delete from posts where id = ${post}::uuid`);
        const [row] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from activity_items where recipient_id = ${ada.id}::uuid`);
        expect(row!.n).toBe(0);
      });
    });
  });

  describe("activity_state: the defaults and the seen marker", () => {
    test("an account's row holds the defaults of ACTIVITY_DEFAULTS and no marker until the first visit; one row an account", async () => {
      await asApi(async (tx) => {
        const ada = await profile(tx);
        const [row] = await tx.execute<Record<string, unknown>>(sql`insert into activity_state (account_id) values (${ada.id}::uuid) returning *`);
        expect({ ...row }).toEqual({ account_id: ada.id, seen_at: null, ...ACTIVITY_DEFAULTS });
        expect(await attempt(tx, sql`insert into activity_state (account_id) values (${ada.id}::uuid)`)).toEqual(unique("activity_state_pkey"));
        // The rules change freely, each within its type.
        expect(await attempt(tx, sql`update activity_state set replies = 'older', mentions = 'following', quotes = 'off', follows = false where account_id = ${ada.id}::uuid`)).toBeNull();
        expect((await attempt(tx, sql`update activity_state set replies = 'friends' where account_id = ${ada.id}::uuid`))?.code).toBe("22P02");
      });
    });

    test("activity_state_guard: the marker moves forward only, never back, never to null and never past the clock", async () => {
      await asApi(async (tx) => {
        const ada = await profile(tx);
        const set = (at: SQL) => sql`update activity_state set seen_at = ${at} where account_id = ${ada.id}::uuid`;
        // An insert's marker may not be later than now() either.
        expect(await attempt(tx, sql`insert into activity_state (account_id, seen_at) values (${ada.id}::uuid, now() + interval '1 second')`)).toEqual(SEEN_REFUSED);
        expect(await step(tx, sql`insert into activity_state (account_id, seen_at) values (${ada.id}::uuid, now() - interval '1 day')`)).toBeNull();
        expect(await attempt(tx, set(sql`now() - interval '2 days'`))).toEqual(SEEN_REFUSED);
        expect(await attempt(tx, set(sql`now() - interval '1 day' - interval '1 microsecond'`))).toEqual(SEEN_REFUSED);
        expect(await attempt(tx, set(sql`null`))).toEqual(SEEN_REFUSED);
        expect(await attempt(tx, set(sql`now() + interval '1 microsecond'`))).toEqual(SEEN_REFUSED);
        // The same marker, a later one, and now() itself, the transaction's start, which least($at, now()) never passes.
        expect(await step(tx, set(sql`now() - interval '1 day'`))).toBeNull();
        expect(await step(tx, set(sql`now() - interval '1 hour'`))).toBeNull();
        expect(await step(tx, set(sql`now()`))).toBeNull();
        // A change of the rules leaves the marker as it is, and is not held to the clock.
        expect(await step(tx, sql`update activity_state set follows = false where account_id = ${ada.id}::uuid`)).toBeNull();
        const [row] = await tx.execute<{ now: boolean }>(sql`select seen_at = now() as now from activity_state where account_id = ${ada.id}::uuid`);
        expect(row!.now).toBe(true);
      });
    });

    test("the API's write of the marker (5.7): the later of the stored marker and the time sent, never past the clock, from no row or from one", async () => {
      await asApi(async (tx) => {
        const ada = await profile(tx);
        const seen = (at: string) =>
          tx.execute(sql`
            insert into activity_state (account_id, seen_at) values (${ada.id}::uuid, least(${at}::timestamptz, now()))
            on conflict (account_id) do update set seen_at = greatest(activity_state.seen_at, least(${at}::timestamptz, now()))`);
        const stored = async () =>
          (await tx.execute<{ at: string }>(sql`select to_char(seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at from activity_state where account_id = ${ada.id}::uuid`))[0]!.at;
        // Three times before the clock, as Activity writes them: a day ago, a microsecond later, and two days ago.
        const micros = (at: string) => sql.raw(`to_char((${at}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
        const [times] = await tx.execute<{ dayAgo: string; justAfter: string; twoDaysAgo: string }>(sql`
          select ${micros("now() - interval '1 day'")} as "dayAgo", ${micros("now() - interval '1 day' + interval '1 microsecond'")} as "justAfter",
                 ${micros("now() - interval '2 days'")} as "twoDaysAgo"`);
        await seen(times!.dayAgo);
        expect(await stored()).toBe(times!.dayAgo);
        // An older marker sent by another device is ignored; a later one moves it, to the microsecond.
        await seen(times!.twoDaysAgo);
        expect(await stored()).toBe(times!.dayAgo);
        await seen(times!.justAfter);
        expect(await stored()).toBe(times!.justAfter);
        // A time ahead of the server's clock stores the clock.
        await seen("2999-01-01T00:00:00.000000Z");
        const [row] = await tx.execute<{ now: boolean }>(sql`select seen_at = now() as now from activity_state where account_id = ${ada.id}::uuid`);
        expect(row!.now).toBe(true);
      });
    });

    test("account_id never changes: the API role holds no UPDATE of it", async () => {
      await asApi(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        await tx.execute(sql`insert into activity_state (account_id) values (${ada.id}::uuid)`);
        expect(await attempt(tx, sql`update activity_state set account_id = ${bob.id}::uuid where account_id = ${ada.id}::uuid`)).toEqual(DENIED);
        expect(await attempt(tx, sql`delete from activity_state where account_id = ${ada.id}::uuid`)).toBeNull();
      });
    });
  });

  describe("post_mentions: its CHECKs, its keys and its two triggers", () => {
    /** The accounts a post's stored mentions name, by position. */
    const mentioned = async (tx: DbTx, postId: string) =>
      (await tx.execute<{ account_id: string }>(sql`select account_id from post_mentions where post_id = ${postId}::uuid order by position`)).map((row) => row.account_id);

    test("a handle as written, lowercased, of 3 to 20 handle characters; a position from 0 to MENTION_STORE_MAX - 1; one row per account and one per position of a post", async () => {
      await asApi(async (tx) => {
        const [ada, bob, cat] = [await profile(tx), await profile(tx), await profile(tx)];
        const post = await newPostRow(tx, ada.id);
        for (const handle of ["Bob_1", "ab", "a".repeat(21), "@bob", "bob-1", ""]) expect(await attempt(tx, mentionSql(post, bob.id, handle, 0)), handle).toEqual(check("post_mentions_handle"));
        expect(await attempt(tx, mentionSql(post, bob.id, "a".repeat(20), 0))).toBeNull();
        expect(await attempt(tx, mentionSql(post, bob.id, "bob", -1))).toEqual(check("post_mentions_position_range"));
        expect(await attempt(tx, mentionSql(post, bob.id, "bob", MENTION_STORE_MAX))).toEqual(check("post_mentions_position_range"));
        expect(await attempt(tx, mentionSql(post, bob.id, "bob", MENTION_STORE_MAX - 1))).toBeNull();
        expect(await step(tx, mentionSql(post, bob.id, "bob", 0))).toBeNull();
        expect(await attempt(tx, mentionSql(post, bob.id, "bob_again", 1))).toEqual(unique("post_mentions_post_id_account_id_pk"));
        expect(await attempt(tx, mentionSql(post, cat.id, "cat", 0))).toEqual(unique("post_mentions_position"));
        expect(await step(tx, mentionSql(post, cat.id, "cat", 1))).toBeNull();
        // A self-mention is stored (4.2): it links, and never notifies.
        expect(await step(tx, mentionSql(post, ada.id, "ada", 2))).toBeNull();
        expect(await mentioned(tx, post)).toEqual([bob.id, cat.id, ada.id]);
        // Written once and deleted, never updated.
        expect(await attempt(tx, sql`update post_mentions set handle = 'renamed' where post_id = ${post}::uuid`)).toEqual(DENIED);
        expect(await attempt(tx, sql`delete from post_mentions where post_id = ${post}::uuid`)).toBeNull();
      });
    });

    test("post_mentions_insert takes a row of a visible native post across a block either way, since a mention is stored whatever blocks exist; a post that does not exist is refused", async () => {
      await asApi(async (tx) => {
        const [ada, bob, cat] = [await profile(tx), await profile(tx), await profile(tx)];
        // Bob blocks the author; the author blocks Cat.
        await tx.execute(sql`insert into blocks (blocker_id, blocked_id) values (${bob.id}::uuid, ${ada.id}::uuid), (${ada.id}::uuid, ${cat.id}::uuid)`);
        const post = await newPostRow(tx, ada.id);
        expect(await step(tx, mentionSql(post, bob.id, bob.handle, 0))).toBeNull();
        expect(await step(tx, mentionSql(post, cat.id, cat.handle, 1))).toBeNull();
        expect(await mentioned(tx, post)).toEqual([bob.id, cat.id]);
        expect(await attempt(tx, mentionSql(randomUUID(), bob.id, bob.handle, 0))).toEqual(MENTION_REFUSED);
        // A post its author deleted (the API's own tombstone) gains no mention.
        const deleted = await newPostRow(tx, ada.id);
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where id = ${deleted}::uuid`);
        expect(await attempt(tx, mentionSql(deleted, bob.id, bob.handle, 0))).toEqual(MENTION_REFUSED);
      });
    });

    test("post_mentions_insert refuses a row of a withheld, removed or disabled post and of an imported one (the posts and the import written as the migrator)", async () => {
      // The API role must see these posts, and only the migrator writes a post in these states, or an import's post with
      // one statement (posts_guard and 3b's guards skip it): they are committed here and removed at the end.
      const author = await newProfile(migrateDb);
      try {
        const posts: Record<string, string> = {};
        for (const state of ["withheld", "removed", "disabled"]) {
          const [row] = await migrateDb.execute<{ id: string }>(
            sql`insert into posts (author_id, body, state, moderation_level) values (${author.id}::uuid, ${`a ${state} post`}, ${state}::post_state, ${state}::moderation_level) returning id`,
          );
          posts[state] = row!.id;
        }
        // 3b's import (design, section 6.5): a publishing job of the author and one post of it, which names a handle.
        const jobId = randomUUID();
        await migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, status, declared_bytes) values (${jobId}::uuid, ${author.id}::uuid, 'x', 'publishing', 1000)`);
        const [imported] = await migrateDb.execute<{ id: string }>(sql`
          insert into posts (author_id, body, import_job_id, import_source, original_created_at, import_shortened, import_key)
          values (${author.id}::uuid, 'an imported post', ${jobId}::uuid, 'x', timestamptz '2019-03-03 12:00:00+00', false, ${randomBytes(32)}) returning id`);
        posts.imported = imported!.id;
        const visible = await newPostRow(migrateDb, author.id);
        await asApi(async (tx) => {
          const ada = await profile(tx);
          for (const [which, post] of Object.entries(posts)) expect(await attempt(tx, mentionSql(post, ada.id, ada.handle, 0)), which).toEqual(MENTION_REFUSED);
          expect(await attempt(tx, mentionSql(visible, ada.id, ada.handle, 0))).toBeNull();
        });
      } finally {
        await removeFixtures(migrateDb, [author.id]);
      }
    });

    test("post_mentions_erase: when a post's erased_at becomes set its mention rows go, and another post's stay", async () => {
      // The erasures (3c's R4 redaction, 3f's end of preservation, 3d's release) are the migrator's functions; the
      // migrator's own insert of the mentions passes post_mentions_insert.
      await asMigrator(async (tx) => {
        const [ada, bob] = [await profile(tx), await profile(tx)];
        const [erased, kept] = [await newPostRow(tx, ada.id), await newPostRow(tx, ada.id)];
        for (const post of [erased, kept]) await tx.execute(mentionSql(post, bob.id, bob.handle, 0));
        // An update that names erased_at and leaves it null erases nothing.
        await tx.execute(sql`update posts set erased_at = null where id = ${erased}::uuid`);
        expect(await mentioned(tx, erased)).toEqual([bob.id]);
        await tx.execute(sql`update posts set erased_at = now(), body = '' where id = ${erased}::uuid`);
        expect(await mentioned(tx, erased)).toEqual([]);
        expect(await mentioned(tx, kept)).toEqual([bob.id]);
      });
    });
  });

  describe("lost_told_for (6.5): an account's lost images whose notice 3d's dispatch handled, for Activity", () => {
    /** A ready image of the account on a new post of its own. */
    async function imageOnPost(tx: DbTx, ownerId: string): Promise<{ media: string; post: string }> {
      const post = await newPostRow(tx, ownerId);
      return { media: await newImageRow(tx, ownerId, post), post };
    }
    /**
     * A file of the image recorded as lost, its notice in the state quarantine_files_insert gives it (pending for an image
     * on a post, none otherwise). The insert records the loss at the clock's time; the test then dates it, which the
     * update trigger allows for a loss already recorded, so that losses can be ordered within one transaction.
     */
    async function lose(tx: DbTx, media: string, size: "small" | "large", at: string): Promise<void> {
      await tx.execute(sql`insert into quarantine_files (media_id, file, lost_at) values (${media}::uuid, ${storedImageName(media, size)}, now())`);
      await tx.execute(sql`update quarantine_files set lost_at = ${at}::timestamptz where media_id = ${media}::uuid and file = ${storedImageName(media, size)}`);
    }
    /** The dispatch's outcome for the image's pending notices, as 3d's lost_told records it. */
    const told = (tx: DbTx, media: string, outcome: string) => tx.execute(sql`select public.lost_told(${media}::uuid, ${outcome}::delivery_state)`);
    /** The function's rows: the image, its post, whether the post's time is the post's own, and the loss's time. */
    const answer = async (tx: DbTx, ownerId: string, before: string, limit: number) =>
      (
        await tx.execute<{ media_id: string; post_id: string; created: boolean; lost_at: string }>(sql`
          select l.media_id, l.post_id, l.post_created_at = p.created_at as created, to_char(l.lost_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as lost_at
            from public.lost_told_for(${ownerId}::uuid, ${before}::timestamptz, ${limit}) l join posts p on p.id = l.post_id`)
      ).map((row) => ({ ...row }));

    test("one row per image: the earliest loss of its files told, pending and none left out, never a deleted post's, never another account's; before p_before, newest first, at most p_limit", async () => {
      await asMigrator(async (tx) => {
        const [owner, other] = [await profile(tx), await profile(tx)];
        // Both files lost and told: the earlier loss is the image's.
        const both = await imageOnPost(tx, owner.id);
        await lose(tx, both.media, "small", "2001-01-10T00:00:00Z");
        await lose(tx, both.media, "large", "2001-01-08T00:00:00Z");
        await told(tx, both.media, "sent");
        // One file told (its mail suppressed), the other's mail still pending: only the told one counts.
        const half = await imageOnPost(tx, owner.id);
        await lose(tx, half.media, "large", "2001-01-12T00:00:00Z");
        await told(tx, half.media, "suppressed");
        await lose(tx, half.media, "small", "2001-01-09T00:00:00Z");
        // Its mail still pending: no row.
        const pending = await imageOnPost(tx, owner.id);
        await lose(tx, pending.media, "small", "2001-01-11T00:00:00Z");
        // Lost while it was on no post, so no notice was owed (none), and attached afterwards: no row.
        const owedNone = await newImageRow(tx, owner.id, null);
        await lose(tx, owedNone, "small", "2001-01-11T00:00:00Z");
        await told(tx, owedNone, "sent");
        await tx.execute(sql`update post_media set post_id = ${await newPostRow(tx, owner.id)}::uuid, position = 0, alt_text = 'an image' where id = ${owedNone}::uuid`);
        // Told, and then its post deleted by its author: no row.
        const deleted = await imageOnPost(tx, owner.id);
        await lose(tx, deleted.media, "small", "2001-01-11T00:00:00Z");
        await told(tx, deleted.media, "sent");
        await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = now(), body = '' where id = ${deleted.post}::uuid`);
        // An older one whose mail failed, and two lost at one time (as the files of one transaction are), by id.
        const failed = await imageOnPost(tx, owner.id);
        await lose(tx, failed.media, "small", "2001-01-07T00:00:00Z");
        await told(tx, failed.media, "failed");
        const [tieA, tieB] = [await imageOnPost(tx, owner.id), await imageOnPost(tx, owner.id)];
        for (const [image, outcome] of [
          [tieA, "sent"],
          [tieB, "no_address"],
        ] as const) {
          await lose(tx, image.media, "small", "2001-01-06T00:00:00Z");
          await told(tx, image.media, outcome);
        }
        // Another account's told loss.
        const elsewhere = await imageOnPost(tx, other.id);
        await lose(tx, elsewhere.media, "small", "2001-01-11T00:00:00Z");
        await told(tx, elsewhere.media, "sent");

        const row = (image: { media: string; post: string }, at: string) => ({ media_id: image.media, post_id: image.post, created: true, lost_at: at });
        const ties = [tieA, tieB].sort((a, b) => (a.media < b.media ? 1 : -1)).map((image) => row(image, "2001-01-06T00:00:00.000000Z"));
        const all = [row(half, "2001-01-12T00:00:00.000000Z"), row(both, "2001-01-08T00:00:00.000000Z"), row(failed, "2001-01-07T00:00:00.000000Z"), ...ties];
        expect(await answer(tx, owner.id, "infinity", 100)).toEqual(all);
        expect(await answer(tx, other.id, "infinity", 100)).toEqual([row(elsewhere, "2001-01-11T00:00:00.000000Z")]);
        // p_before is strict, to the microsecond.
        expect(await answer(tx, owner.id, "2001-01-08T00:00:00Z", 100)).toEqual(all.slice(2));
        expect(await answer(tx, owner.id, "2001-01-08T00:00:00.000001Z", 100)).toEqual(all.slice(1));
        expect(await answer(tx, owner.id, "2001-01-01T00:00:00Z", 100)).toEqual([]);
        // p_limit, and nothing for a limit below one.
        expect(await answer(tx, owner.id, "infinity", 2)).toEqual(all.slice(0, 2));
        expect(await answer(tx, owner.id, "infinity", 0)).toEqual([]);
        expect(await answer(tx, owner.id, "infinity", -1)).toEqual([]);
      });
    });

    test("never more than 100 rows, whatever p_limit asks", async () => {
      await asMigrator(async (tx) => {
        const owner = await profile(tx);
        // 101 posts with one image each, every image's small file lost and told.
        await tx.execute(sql`insert into posts (author_id, body, created_at) select ${owner.id}::uuid, 'post ' || g, now() - interval '30 days' from generate_series(1, 101) g`);
        await tx.execute(sql`insert into post_media (owner_id, status, width, height, blurhash) select ${owner.id}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL' from generate_series(1, 101)`);
        await tx.execute(sql`
          update post_media m set post_id = pair.post_id, position = 0, alt_text = 'an image'
            from (select i.id as media_id, p.id as post_id
                    from (select id, row_number() over (order by id) as n from post_media where owner_id = ${owner.id}::uuid) i
                    join (select id, row_number() over (order by id) as n from posts where author_id = ${owner.id}::uuid) p on p.n = i.n) pair
           where m.id = pair.media_id`);
        await tx.execute(sql`
          insert into quarantine_files (media_id, file, lost_at)
          select m.id, 'files/' || left(m.id::text, 2) || '/' || m.id::text || '/small.webp', now() from post_media m where m.owner_id = ${owner.id}::uuid`);
        await tx.execute(sql`select public.lost_told(m.id, 'sent') from post_media m where m.owner_id = ${owner.id}::uuid`);
        const [told] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from quarantine_files q join post_media m on m.id = q.media_id where m.owner_id = ${owner.id}::uuid and q.lost_told = 'sent'`);
        expect(told!.n).toBe(101);
        for (const limit of [100, 101, 1000]) expect(await answer(tx, owner.id, "infinity", limit), String(limit)).toHaveLength(100);
      });
    });

    test("a definer the migrator owns, stable, its search path pinned, EXECUTE for the API role alone; it answers ids and times only", async () => {
      const [row] = await apiDb.execute<Record<string, unknown>>(sql`
        select p.proowner::regrole::text as owner, p.prosecdef as definer, p.provolatile as volatility, p.proconfig as config, pg_get_function_result(p.oid) as result,
               has_function_privilege('korbat_api', p.oid, 'execute') as api, has_function_privilege('korbat_auth', p.oid, 'execute') as auth,
               has_function_privilege('korbat_notify', p.oid, 'execute') as notify, has_function_privilege('public', p.oid, 'execute') as pub
          from pg_proc p where p.oid = 'public.lost_told_for(uuid, timestamptz, integer)'::regprocedure`);
      expect({ ...row }).toEqual({
        owner: "korbat_migrate",
        definer: true,
        volatility: "s",
        config: ["search_path=public, pg_temp"],
        result: "TABLE(media_id uuid, post_id uuid, post_created_at timestamp with time zone, lost_at timestamp with time zone)",
        api: true,
        auth: false,
        notify: false,
        pub: false,
      });
      // The API role calls it, and still reads nothing of the quarantine itself.
      expect(await apiDb.execute(sql`select * from public.lost_told_for(${randomUUID()}::uuid, now(), 10)`)).toHaveLength(0);
      const refused = await apiDb.execute(sql`select count(*) from public.quarantine_files`).then(
        () => null,
        (err: unknown) => asPgError(err),
      );
      expect(refused?.code).toBe("42501");
    });
  });

  describe("grants, row level security, the functions and the contracts' lists (6.6, 6.8)", () => {
    /** Which of the four table privileges, TRUNCATE and MAINTAIN a role holds on a public table. */
    async function tablePrivileges(role: string, table: string): Promise<string[]> {
      const rows = await apiDb.execute<{ privilege: string; held: boolean }>(sql`
        select p as privilege, has_table_privilege(${role}::name, c.oid, p) as held
          from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN']) with ordinality as u(p, place)
         where n.nspname = 'public' and c.relname = ${table}
         order by u.place`);
      expect(rows, table).toHaveLength(6);
      return rows.filter((row) => row.held).map((row) => row.privilege);
    }
    /** The columns of a public table a role may update, by a column grant or the table's, in column order. */
    async function updatableColumns(role: string, table: string): Promise<string[]> {
      const rows = await apiDb.execute<{ name: string }>(sql`
        select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = ${table} and a.attnum > 0 and not a.attisdropped and has_column_privilege(${role}::name, a.attrelid, a.attnum, 'UPDATE')
         order by a.attnum`);
      return rows.map((row) => row.name);
    }
    /** One CHECK as the migrated database defines it. */
    async function checkDefinition(table: string, name: string): Promise<string> {
      const [row] = await apiDb.execute<{ definition: string }>(sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = ${`public.${table}`}::regclass and conname = ${name}`);
      expect(row, `${table}.${name}`).toBeDefined();
      return row!.definition;
    }
    const listed = (definition: string) => [...definition.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    const numbers = (definition: string) => [...definition.matchAll(/(?<![a-z_0-9])[0-9]+(?![a-z_0-9])/g)].map((m) => Number(m[0]));

    test("the API role holds 6.6's grants: no UPDATE of activity_items or post_mentions, activity_state's five columns, and the two switches of 0050; korbat_auth and korbat_notify hold nothing", async () => {
      for (const table of ACTIVITY_TABLES) expect(await tablePrivileges("korbat_api", table), table).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect(await updatableColumns("korbat_api", "activity_items")).toEqual([]);
      expect(await updatableColumns("korbat_api", "post_mentions")).toEqual([]);
      expect(await updatableColumns("korbat_api", "activity_state")).toEqual(["seen_at", "replies", "mentions", "quotes", "follows"]);
      // 0050_post_options: the last column of each table, under a column grant of its own.
      expect((await updatableColumns("korbat_api", "posts")).at(-1)).toBe("hide_counts");
      expect((await updatableColumns("korbat_api", "profiles")).at(-1)).toBe("share_previews");
      for (const role of ["korbat_auth", "korbat_notify"]) {
        for (const table of ACTIVITY_TABLES) {
          expect(await tablePrivileges(role, table), `${role} ${table}`).toEqual([]);
          expect(await updatableColumns(role, table), `${role} ${table}`).toEqual([]);
        }
      }
    });

    test("row level security is on for the three tables, with one allow-all policy for the API role each", async () => {
      const rows = await migrateDb.execute<{ table: string; rls: boolean; policies: string[] }>(sql`
        select c.relname::text as table, c.relrowsecurity as rls,
               array(select p.policyname || ':' || array_to_string(p.roles, ',') || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, '')
                       from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname order by 1) as policies
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in ('activity_items', 'activity_state', 'post_mentions') order by 1`);
      expect(rows.map((r) => ({ ...r }))).toEqual(ACTIVITY_TABLES.map((table) => ({ table, rls: true, policies: [`${table}_api_all:korbat_api:ALL:true:true`] })));
    });

    test("each enum, the follow's label and MENTION_STORE_MAX are the contracts' ACTIVITY_KINDS, ACTIVITY_REACH and MENTION_STORE_MAX", async () => {
      const [enums] = await apiDb.execute<{ kinds: string[]; reach: string[] }>(
        sql`select enum_range(null::public.activity_kind)::text[] as kinds, enum_range(null::public.activity_reach)::text[] as reach`,
      );
      expect(enums!.kinds).toEqual([...ACTIVITY_KINDS]);
      expect(enums!.reach).toEqual([...ACTIVITY_REACH]);
      expect(numbers(await checkDefinition("post_mentions", "post_mentions_position_range"))).toEqual([0, MENTION_STORE_MAX - 1]);
      expect(await checkDefinition("post_mentions", "post_mentions_handle")).toBe("CHECK ((handle ~ '^[a-z0-9_]{3,20}$'::text))");
      // The one kind with no post, compared as text in the CHECK and named as a label in the unique index.
      expect(listed(await checkDefinition("activity_items", "activity_items_post"))).toEqual(["follow"]);
      const [follows] = await apiDb.execute<{ definition: string }>(sql`select pg_get_indexdef('public.activity_items_follow_once'::regclass) as definition`);
      expect(follows!.definition).toBe("CREATE UNIQUE INDEX activity_items_follow_once ON public.activity_items USING btree (recipient_id, actor_id) WHERE (kind = 'follow'::activity_kind)");
      expect(ACTIVITY_KINDS).toContain("follow");
    });

    test("the four trigger functions are the migrator's, their search path pinned, EXECUTE for nobody; post_mentions_erase alone a definer; each trigger in its timing", async () => {
      const names = ["activity_items_insert", "activity_state_guard", "post_mentions_insert", "post_mentions_erase"];
      const rows = await apiDb.execute<Record<string, unknown>>(sql`
        select p.proname::text as name, p.proowner::regrole::text as owner, p.prosecdef as definer, p.proconfig as config,
               has_function_privilege('korbat_api', p.oid, 'execute') as api, has_function_privilege('korbat_auth', p.oid, 'execute') as auth,
               has_function_privilege('korbat_notify', p.oid, 'execute') as notify, has_function_privilege('public', p.oid, 'execute') as pub
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${`{${names.join(",")}}`}::text[]) order by 1`);
      expect(rows.map((row) => ({ ...row }))).toEqual(
        [...names].sort().map((name) => ({ name, owner: "korbat_migrate", definer: name === "post_mentions_erase", config: ["search_path=public, pg_temp"], api: false, auth: false, notify: false, pub: false })),
      );
      const triggers = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where not t.tgisinternal and p.proname = any(${`{${names.join(",")}}`}::text[]) order by 1`);
      expect(Object.fromEntries(triggers.map((row) => [row.name, row.definition.replace(/^CREATE TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]))).toEqual({
        activity_items_insert: "BEFORE INSERT ON public.activity_items FOR EACH ROW",
        activity_state_guard: "BEFORE INSERT OR UPDATE ON public.activity_state FOR EACH ROW",
        post_mentions_erase: "AFTER UPDATE OF erased_at ON public.posts FOR EACH ROW",
        post_mentions_insert: "BEFORE INSERT ON public.post_mentions FOR EACH ROW",
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb, ACTIVITY_TABLES)).toEqual(before);
  });
});
