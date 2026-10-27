import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  IMPORT_ACTIVE_STATES,
  IMPORT_FAILURES,
  IMPORT_RULES,
  IMPORT_SOURCE_KINDS,
  IMPORT_STOP_REASONS,
  ImportChoice,
  ImportScanFacts,
  ImportStatus,
  MEDIA_MAX_PER_POST,
  STANDING_RULES,
} from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { actionsOf, anAccount, decideIn, ground, intake, newPostRow, newTestStaff, refusalDetail, rowCounts, staffProfile, timed, type TestStaff } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Most tests here walk imports through several states, each move a round trip, inside one open transaction: on a loaded
// machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/** The twelve states, in the enum's order, and 4.1's arrows: every move the guard allows, and no other. */
const STATES = ImportStatus.options;
type State = (typeof STATES)[number];
const ARROWS: Record<State, readonly State[]> = {
  uploading: ["scanning", "failed", "cancelled", "expired"],
  scanning: ["ready", "failed", "cancelled"],
  ready: ["preparing", "publishing", "cancelled", "expired"],
  preparing: ["publishing", "stopped"],
  publishing: ["done", "stopped"],
  done: ["undoing"],
  stopped: ["undoing"],
  undoing: ["undone"],
  undone: [],
  failed: [],
  cancelled: [],
  expired: [],
};
/** The moves that set ended_at (6.1). */
const ENDS: readonly State[] = ["done", "stopped", "undone", "failed", "cancelled", "expired"];
/** How a test reaches each state from uploading, along the arrows. */
const PATH: Record<State, readonly State[]> = {
  uploading: [],
  scanning: ["scanning"],
  ready: ["scanning", "ready"],
  preparing: ["scanning", "ready", "preparing"],
  publishing: ["scanning", "ready", "publishing"],
  done: ["scanning", "ready", "publishing", "done"],
  stopped: ["scanning", "ready", "publishing", "stopped"],
  undoing: ["scanning", "ready", "publishing", "done", "undoing"],
  undone: ["scanning", "ready", "publishing", "done", "undoing", "undone"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  expired: ["expired"],
};

/** What the intake writes into `scan` at the move into ready: counts, the month table, the samples and the pages. */
const FULL_SCAN = ImportScanFacts.parse({
  posts: 3,
  images: 0,
  skipped: { not_public: 2, repost: 1 },
  imagesSkipped: {},
  cleaned: 0,
  warnings: 0,
  sourceLinks: 0,
  protectedPosts: 0,
  readInPart: false,
  months: [{ month: "2019-03", groups: [[0, 3, 0, 0]] }],
  first: "2019-03",
  last: "2019-03",
  fromRef: 0,
  samples: [{ ref: 2, offset: 400 }],
  pages: [0],
});
/** What the move out of ready leaves of it (6.1, decision 25): the counts and fromRef, without not_public, months, samples or pages. */
const KEPT_SCAN = { ...FULL_SCAN, skipped: { repost: 1 }, months: [], samples: [], pages: [] };
const CHOICE = ImportChoice.parse({ from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" });

const json = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`;
const seed = () => randomBytes(IMPORT_RULES.seedBytes);

/**
 * The SET clause of the move from one state to another, with every column the guard asks of that move: the upload's end
 * and its bytes, the scan's end, the scan in and out of ready, the choice with its statement, time and seed, the seed
 * cleared at the end, a stop's reason, a failure's code, and the end's time. For a pair 4.1 has no arrow for, the same
 * clause is what a caller would try.
 */
function moveSet(from: State, to: State): SQL {
  const parts: SQL[] = [sql`status = ${to}::import_status`];
  if (to === "scanning") parts.push(sql`received_bytes = declared_bytes, uploaded_at = now()`);
  if (from === "scanning") parts.push(sql`scanned_at = now()`);
  if (to === "ready") parts.push(sql`scan = ${json(FULL_SCAN)}`);
  if (from === "ready") parts.push(sql`scan = ${json(KEPT_SCAN)}`);
  if (from === "ready" && (to === "preparing" || to === "publishing")) parts.push(sql`choice = ${json(CHOICE)}, stated_at = now(), confirmed_at = now(), seed = ${seed()}`);
  if (to === "done" || to === "stopped") parts.push(sql`seed = null`);
  if (to === "stopped") parts.push(sql`stop_reason = 'by_author'`);
  if (to === "failed") parts.push(sql`failure = 'unreadable'`);
  if (ENDS.includes(to)) parts.push(sql`ended_at = clock_timestamp()`);
  return sql.join(parts, sql`, `);
}

/** A PostgreSQL error as these tests compare it: its SQLSTATE and its message. */
type PgError = { code: string; message: string };
const asPgError = (err: unknown): PgError => {
  const cause = ((err as { cause?: unknown }).cause ?? err) as { message?: unknown; code?: unknown };
  return { code: String(cause.code ?? ""), message: String(cause.message ?? cause) };
};
/** The guards' refusal (6.1 to 6.3): import_column under SQLSTATE 42501. */
const REFUSED: PgError = { code: "42501", message: "import_column" };
/** A CHECK's refusal, by the constraint's name. */
const check = (name: string) => ({ code: "23514", message: expect.stringContaining(name) });

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
 * Migrations 0043 to 0045 (3b design, sections 6.1 to 6.4 and 6.7; section 12.3) against the real database, as the API
 * role: the columns import_jobs_insert forces, every pair of the twelve states, the set-once and only-grows rules, one
 * active import an account, the three delete rules, the five import columns of posts (set only at insert by a publishing
 * job of the author with the same source, cleared only with a tombstone, a reply only within the job, no quote, the date
 * bounds), an imported image (inserted only with a preparing job of its owner, attached only to its import's post, never
 * without a description), picks only while ready, a key deleted only once its profile is; the grants, row level security,
 * every CHECK's literal and both enums against the contracts, the functions and their triggers; and 0044's
 * decision_actions_check, whose flood count passes over imported posts and which is otherwise 0032's text. Every test runs
 * in a transaction of the API role that is rolled back (the migrator's own, for the one CHECK the guards stand before), so
 * the file commits nothing but the two staff accounts of its setup; its last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the import tables, the import columns, their guards and grants", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  /** The admin who decides the flood test's suspensions. */
  let admin: TestStaff;
  let before: Record<string, number>;
  const IMPORT_TABLES = ["import_jobs", "import_picks", "import_keys"];

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    admin = await newTestStaff(authDb, migrateDb, createAuthRepo(authDb), "admin");
    before = await rowCounts(apiDb, IMPORT_TABLES);
  }, 120_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** A transaction of the API role that is rolled back, with its lock timeout. */
  const asApi = (fn: (tx: DbTx) => Promise<void>) => rolledBack(apiDb, fn);
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);

  /** A new import of the account in uploading, as POST /api/imports inserts it: the id, the owner, the source and the size. */
  async function newJob(tx: DbTx, ownerId: string, source: string = "x", bytes: number = 1000): Promise<string> {
    const id = randomUUID();
    await tx.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes) values (${id}::uuid, ${ownerId}::uuid, ${source}::import_source, ${bytes})`);
    return id;
  }

  /** One move of the import, which must be allowed. */
  async function move(tx: DbTx, id: string, from: State, to: State): Promise<void> {
    await tx.execute(sql`update import_jobs set ${moveSet(from, to)} where id = ${id}::uuid`);
  }

  /**
   * An import in the given state, of a new account unless one is given, reached along the arrows. On the way through
   * publishing it publishes one post's worth of count, so a stopped import may be undone.
   */
  async function jobIn(tx: DbTx, state: State, options: { ownerId?: string; source?: string } = {}): Promise<{ id: string; ownerId: string }> {
    const ownerId = options.ownerId ?? (await profile(tx)).id;
    const id = await newJob(tx, ownerId, options.source);
    let at: State = "uploading";
    for (const next of PATH[state]) {
      if (at === "publishing") await tx.execute(sql`update import_jobs set posts_published = 1 where id = ${id}::uuid`);
      await move(tx, id, at, next);
      at = next;
    }
    return { id, ownerId };
  }

  /** The import's row as the database holds it. */
  async function jobRow(tx: DbTx, id: string): Promise<Record<string, unknown>> {
    const [row] = await tx.execute<Record<string, unknown>>(sql`select * from import_jobs where id = ${id}::uuid`);
    return { ...row! };
  }

  describe("import_jobs: the insert, the moves and the deletes", () => {
    test("an insert gets uploading, its own creation time, zero bytes, counts and cursors, and nothing else it sent but the id, the owner, the source and the size", async () => {
      await asApi(async (tx) => {
        const owner = await profile(tx);
        const id = randomUUID();
        // Every column, each with a value the trigger must not keep.
        await tx.execute(sql`
          insert into import_jobs (id, owner_id, source, status, declared_bytes, received_bytes, created_at, uploaded_at, scanned_at, confirmed_at, ended_at, failure,
                                   stop_reason, staff_ended_at, staff_rule_id, refused_at_original, refused_words, scan, choice, stated_at, seed, post_cursor, image_cursor,
                                   posts_published, images_kept, images_left_out, posts_removed)
          values (${id}::uuid, ${owner.id}::uuid, 'mastodon', 'done', 5000, 5000, '2001-01-01T00:00:00Z', now(), now(), now(), now(), 'unreadable',
                  'by_staff', now(), 'R6', '2019-03-03', 'first words', ${json(FULL_SCAN)}, ${json(CHOICE)}, now(), ${seed()}, 7, 7, 7, 7, 7, 7)`);
        const [row] = await tx.execute<Record<string, unknown>>(sql`select *, created_at >= now() as fresh from import_jobs where id = ${id}::uuid`);
        expect({ ...row, created_at: null }).toEqual({
          id,
          owner_id: owner.id,
          source: "mastodon",
          status: "uploading",
          declared_bytes: "5000",
          received_bytes: "0",
          created_at: null,
          uploaded_at: null,
          scanned_at: null,
          confirmed_at: null,
          ended_at: null,
          failure: null,
          stop_reason: null,
          staff_ended_at: null,
          staff_rule_id: null,
          refused_at_original: null,
          refused_words: null,
          scan: null,
          choice: null,
          stated_at: null,
          seed: null,
          post_cursor: 0,
          image_cursor: 0,
          posts_published: 0,
          images_kept: 0,
          images_left_out: 0,
          posts_removed: 0,
          fresh: true,
        });
      });
    });

    test("an insert for a deleted or a missing profile is refused not_found; the size is between 1 byte and IMPORT_RULES.maxBytes", async () => {
      await asApi(async (tx) => {
        const gone = await profile(tx);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
        const insert = (ownerId: string, bytes: number) => attempt(tx, sql`insert into import_jobs (id, owner_id, source, declared_bytes) values (${randomUUID()}::uuid, ${ownerId}::uuid, 'x', ${bytes})`);
        expect(await insert(gone.id, 1000)).toEqual({ code: "P0001", message: "not_found" });
        expect(await insert(randomUUID(), 1000)).toEqual({ code: "P0001", message: "not_found" });
        const owner = await profile(tx);
        expect(await insert(owner.id, 0)).toMatchObject(check("import_jobs_declared_bytes"));
        expect(await insert(owner.id, IMPORT_RULES.maxBytes + 1)).toMatchObject(check("import_jobs_declared_bytes"));
        expect(await insert(owner.id, 1)).toBeNull();
        expect(await insert(owner.id, IMPORT_RULES.maxBytes)).toBeNull();
      });
    });

    test("every pair of the twelve states: a move along an arrow of 4.1 is allowed, and every other is refused import_column", async () => {
      await asApi(async (tx) => {
        const seen: string[][] = [];
        for (const from of STATES) {
          const { id } = await jobIn(tx, from);
          for (const to of STATES) {
            if (to === from) continue;
            const err = await attempt(tx, sql`update import_jobs set ${moveSet(from, to)} where id = ${id}::uuid`);
            seen.push([from, to, err === null ? "allowed" : `${err.code} ${err.message}`]);
          }
          // An update that keeps the state is no move: a count may grow in any state.
          expect(await attempt(tx, sql`update import_jobs set posts_removed = posts_removed + 1 where id = ${id}::uuid`), from).toBeNull();
        }
        const expected = STATES.flatMap((from) => STATES.filter((to) => to !== from).map((to) => [from, to, ARROWS[from].includes(to) ? "allowed" : "42501 import_column"]));
        expect(seen).toEqual(expected);
        // 132 pairs, 18 arrows.
        expect(seen.filter(([, , outcome]) => outcome === "allowed")).toHaveLength(18);
      });
    });

    test("into undoing only from done, or from stopped with posts published; the move into undone may set the end's time again", async () => {
      await asApi(async (tx) => {
        const owner = await profile(tx);
        const id = await newJob(tx, owner.id);
        for (const [from, to] of [["uploading", "scanning"], ["scanning", "ready"], ["ready", "publishing"], ["publishing", "stopped"]] as const) await move(tx, id, from, to);
        expect(await attempt(tx, sql`update import_jobs set status = 'undoing' where id = ${id}::uuid`)).toEqual(REFUSED);
        const done = await jobIn(tx, "done");
        expect(await attempt(tx, sql`update import_jobs set status = 'undoing' where id = ${done.id}::uuid`)).toBeNull();
        const undoing = await jobIn(tx, "undoing");
        const ended = (await jobRow(tx, undoing.id)).ended_at as string;
        expect(await step(tx, sql`update import_jobs set status = 'undone', ended_at = clock_timestamp() where id = ${undoing.id}::uuid`)).toBeNull();
        expect(new Date((await jobRow(tx, undoing.id)).ended_at as string).getTime()).toBeGreaterThanOrEqual(new Date(ended).getTime());
        // A move into an end without its time is refused.
        const publishing = await jobIn(tx, "publishing");
        expect(await attempt(tx, sql`update import_jobs set status = 'done', seed = null where id = ${publishing.id}::uuid`)).toEqual(REFUSED);
      });
    });

    test("each time is set once, by the move that names it: the upload's end with every byte, the scan's end, the choice with its statement, time and seed, the end", async () => {
      await asApi(async (tx) => {
        const upd = (id: string, set: SQL) => attempt(tx, sql`update import_jobs set ${set} where id = ${id}::uuid`);
        const uploading = await jobIn(tx, "uploading");
        // The upload's end needs every declared byte, and its time.
        expect(await upd(uploading.id, sql`status = 'scanning', received_bytes = declared_bytes - 1, uploaded_at = now()`)).toEqual(REFUSED);
        expect(await upd(uploading.id, sql`status = 'scanning', received_bytes = declared_bytes`)).toEqual(REFUSED);
        // No time is set before its move.
        for (const column of ["uploaded_at", "scanned_at", "confirmed_at", "ended_at", "stated_at"]) {
          expect(await upd(uploading.id, sql`${sql.identifier(column)} = now()`), column).toEqual(REFUSED);
        }
        const scanning = await jobIn(tx, "scanning");
        expect(await upd(scanning.id, sql`uploaded_at = uploaded_at + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(scanning.id, sql`uploaded_at = null`)).toEqual(REFUSED);
        // The move into ready brings the scan, and the move out of scanning its time.
        expect(await upd(scanning.id, sql`status = 'ready', scanned_at = now()`)).toEqual(REFUSED);
        expect(await upd(scanning.id, sql`status = 'ready', scan = ${json(FULL_SCAN)}`)).toEqual(REFUSED);
        expect(await upd(scanning.id, sql`status = 'failed', failure = 'unreadable', ended_at = now()`)).toEqual(REFUSED);
        expect(await upd(scanning.id, sql`scan = ${json(FULL_SCAN)}`)).toEqual(REFUSED);
        const ready = await jobIn(tx, "ready");
        expect(await upd(ready.id, sql`scanned_at = scanned_at + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(ready.id, sql`scan = ${json(KEPT_SCAN)}`)).toEqual(REFUSED);
        // The move out of ready keeps no month table, no samples, no pages and no count of posts that were not public.
        const confirm = (scan: unknown) => sql`status = 'publishing', scan = ${json(scan)}, choice = ${json(CHOICE)}, stated_at = now(), confirmed_at = now(), seed = ${seed()}`;
        expect(await upd(ready.id, confirm(FULL_SCAN))).toEqual(REFUSED);
        expect(await upd(ready.id, confirm({ ...KEPT_SCAN, months: FULL_SCAN.months }))).toEqual(REFUSED);
        expect(await upd(ready.id, confirm({ ...KEPT_SCAN, samples: FULL_SCAN.samples }))).toEqual(REFUSED);
        expect(await upd(ready.id, confirm({ ...KEPT_SCAN, pages: FULL_SCAN.pages }))).toEqual(REFUSED);
        expect(await upd(ready.id, confirm({ ...KEPT_SCAN, skipped: { repost: 1, not_public: 0 } }))).toEqual(REFUSED);
        expect(await upd(ready.id, sql`status = 'cancelled', ended_at = now()`)).toEqual(REFUSED);
        expect(await upd(ready.id, confirm(KEPT_SCAN))).toBeNull();
        // The choice, the statement, the confirmation's time and the seed come together.
        const kept = sql`status = 'publishing', scan = ${json(KEPT_SCAN)}`;
        expect(await upd(ready.id, sql`${kept}, stated_at = now(), confirmed_at = now(), seed = ${seed()}`)).toEqual(REFUSED);
        expect(await upd(ready.id, sql`${kept}, choice = ${json(CHOICE)}, stated_at = now(), seed = ${seed()}`)).toEqual(REFUSED);
        expect(await upd(ready.id, sql`${kept}, choice = ${json(CHOICE)}, stated_at = now(), confirmed_at = now()`)).toEqual(REFUSED);
        expect(await upd(ready.id, sql`${kept}, choice = ${json(CHOICE)}, confirmed_at = now(), seed = ${seed()}`)).toEqual(REFUSED);
        // A cancel from ready makes no choice.
        expect(await upd(ready.id, sql`status = 'cancelled', scan = ${json(KEPT_SCAN)}, ended_at = now(), choice = ${json(CHOICE)}, stated_at = now()`)).toEqual(REFUSED);
        expect(await upd(ready.id, sql`status = 'cancelled', scan = ${json(KEPT_SCAN)}, ended_at = now()`)).toBeNull();
        const publishing = await jobIn(tx, "publishing");
        expect(await upd(publishing.id, sql`choice = ${json({ ...CHOICE, replies: true })}`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`stated_at = now() + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`confirmed_at = now() + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`seed = ${seed()}`)).toEqual(REFUSED);
        // The seed may only be cleared, and it is cleared by the move into done or stopped.
        expect(await upd(publishing.id, sql`seed = null`)).toBeNull();
        expect(await upd(publishing.id, sql`status = 'done', ended_at = now()`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`status = 'stopped', stop_reason = 'by_author', ended_at = now()`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`ended_at = now()`)).toEqual(REFUSED);
        const done = await jobIn(tx, "done");
        expect(await upd(done.id, sql`ended_at = ended_at + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(done.id, sql`ended_at = null`)).toEqual(REFUSED);
        const failed = await jobIn(tx, "failed");
        expect(await upd(failed.id, sql`failure = 'encrypted'`)).toEqual(REFUSED);
        // The id, the owner, the source, the size and the creation time are outside the API role's grants.
        for (const set of [sql`id = ${randomUUID()}::uuid`, sql`owner_id = owner_id`, sql`source = 'bluesky'`, sql`declared_bytes = 2000`, sql`created_at = now()`]) {
          expect(await upd(failed.id, set)).toEqual({ code: "42501", message: "permission denied for table import_jobs" });
        }
      });
    });

    test("a stop's reason is set by the move into stopped and stays; the staff pair and the refused pair are each set once, together, by their own moves", async () => {
      await asApi(async (tx) => {
        const upd = (id: string, set: SQL) => attempt(tx, sql`update import_jobs set ${set} where id = ${id}::uuid`);
        const stop = sql`status = 'stopped', seed = null, ended_at = now()`;
        const publishing = await jobIn(tx, "publishing");
        // Without a reason the CHECK refuses the stop; a reason outside the closed list, or outside stopped, too.
        expect(await upd(publishing.id, stop)).toMatchObject(check("import_jobs_stopped"));
        expect(await upd(publishing.id, sql`${stop}, stop_reason = 'tired'`)).toMatchObject(check("import_jobs_stop_reason"));
        expect(await upd(publishing.id, sql`stop_reason = 'by_author'`)).toEqual(REFUSED);
        // An admin's end names itself with its time and rule, and nothing else does.
        expect(await upd(publishing.id, sql`${stop}, stop_reason = 'by_staff'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`${stop}, stop_reason = 'by_author', staff_ended_at = now(), staff_rule_id = 'R6'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`${stop}, stop_reason = 'by_staff', staff_ended_at = now()`)).toMatchObject(check("import_jobs_staff"));
        expect(await upd(publishing.id, sql`staff_ended_at = now(), staff_rule_id = 'R6'`)).toEqual(REFUSED);
        expect(await step(tx, sql`update import_jobs set ${stop}, stop_reason = 'by_staff', staff_ended_at = now(), staff_rule_id = 'R6' where id = ${publishing.id}::uuid`)).toBeNull();
        expect(await upd(publishing.id, sql`stop_reason = 'by_author'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`staff_rule_id = 'R1'`)).toEqual(REFUSED);
        // It published nothing, so it cannot be undone; once it has, the undo keeps the staff pair as it is.
        expect(await upd(publishing.id, sql`status = 'undoing'`)).toEqual(REFUSED);
        expect(await step(tx, sql`update import_jobs set posts_published = 3 where id = ${publishing.id}::uuid`)).toBeNull();
        expect(await upd(publishing.id, sql`status = 'undoing', staff_ended_at = now() + interval '1 second'`)).toEqual(REFUSED);
        expect(await upd(publishing.id, sql`status = 'undoing'`)).toBeNull();
        // From done, an admin's end is the move into undoing.
        const done = await jobIn(tx, "done");
        expect(await upd(done.id, sql`status = 'undoing', staff_ended_at = now(), staff_rule_id = 'R6'`)).toBeNull();
        expect(await upd(done.id, sql`status = 'undoing', stop_reason = 'by_staff', staff_ended_at = now(), staff_rule_id = 'R6'`)).toEqual(REFUSED);
        // A refused image stops the import with the post's date and first words, at most refusedWordsMax code points, set once.
        const preparing = await jobIn(tx, "preparing");
        const refused = (words: string) => sql`${stop}, stop_reason = 'refused_image', refused_at_original = '2019-03-03', refused_words = ${words}`;
        expect(await upd(preparing.id, sql`${stop}, stop_reason = 'by_author', refused_at_original = '2019-03-03', refused_words = 'words'`)).toEqual(REFUSED);
        expect(await upd(preparing.id, sql`${stop}, stop_reason = 'refused_image', refused_at_original = '2019-03-03'`)).toMatchObject(check("import_jobs_refused"));
        expect(await upd(preparing.id, refused("x".repeat(IMPORT_RULES.refusedWordsMax + 1)))).toMatchObject(check("import_jobs_refused_words"));
        expect(await step(tx, sql`update import_jobs set ${refused("x".repeat(IMPORT_RULES.refusedWordsMax))} where id = ${preparing.id}::uuid`)).toBeNull();
        expect(await upd(preparing.id, sql`refused_words = 'other words'`)).toEqual(REFUSED);
        expect(await upd(preparing.id, sql`refused_at_original = '2019-03-04'`)).toEqual(REFUSED);
      });
    });

    test("the bytes received, the counts and the cursors never go down", async () => {
      await asApi(async (tx) => {
        const upd = (id: string, set: SQL) => attempt(tx, sql`update import_jobs set ${set} where id = ${id}::uuid`);
        const uploading = await jobIn(tx, "uploading");
        expect(await step(tx, sql`update import_jobs set received_bytes = 600 where id = ${uploading.id}::uuid`)).toBeNull();
        expect(await upd(uploading.id, sql`received_bytes = 599`)).toEqual(REFUSED);
        expect(await upd(uploading.id, sql`received_bytes = 1001`)).toMatchObject(check("import_jobs_received_bytes"));
        const publishing = await jobIn(tx, "publishing");
        for (const column of ["post_cursor", "image_cursor", "posts_published", "images_kept", "images_left_out", "posts_removed"]) {
          const name = sql.identifier(column);
          expect(await step(tx, sql`update import_jobs set ${name} = 5 where id = ${publishing.id}::uuid`), column).toBeNull();
          expect(await upd(publishing.id, sql`${name} = 4`), column).toEqual(REFUSED);
          expect(await upd(publishing.id, sql`${name} = 6`), column).toBeNull();
        }
      });
    });

    test("the scan and the choice are objects within their bytes, the seed is 32 bytes, and the statement goes with the choice", async () => {
      await asApi(async (tx) => {
        const scanning = await jobIn(tx, "scanning");
        const toReady = (scan: SQL) => attempt(tx, sql`update import_jobs set status = 'ready', scanned_at = now(), scan = ${scan} where id = ${scanning.id}::uuid`);
        expect(await toReady(sql`'[]'::jsonb`)).toMatchObject(check("import_jobs_scan"));
        // The bytes are those of the jsonb's text form, which writes a space after each colon and comma.
        const padded = (bytes: number) => {
          const base = JSON.stringify({ ...FULL_SCAN, pad: "" }).length + 13;
          return { ...FULL_SCAN, pad: "x".repeat(bytes - base) };
        };
        const [size] = await tx.execute<{ n: number }>(sql`select octet_length(${json(padded(IMPORT_RULES.scanMaxBytes))}::text) as n`);
        const fits = padded(IMPORT_RULES.scanMaxBytes - (size!.n - IMPORT_RULES.scanMaxBytes));
        expect(await toReady(json({ ...fits, pad: `${fits.pad}x` }))).toMatchObject(check("import_jobs_scan"));
        expect(await toReady(json(fits))).toBeNull();
        const ready = await jobIn(tx, "ready");
        const confirm = (choice: SQL, bytes: Buffer) =>
          attempt(tx, sql`update import_jobs set status = 'publishing', scan = ${json(KEPT_SCAN)}, choice = ${choice}, stated_at = now(), confirmed_at = now(), seed = ${bytes} where id = ${ready.id}::uuid`);
        expect(await confirm(json({ ...CHOICE, note: "x".repeat(IMPORT_RULES.choiceMaxBytes) }), seed())).toMatchObject(check("import_jobs_choice"));
        expect(await confirm(sql`'"everything"'::jsonb`, seed())).toMatchObject(check("import_jobs_choice"));
        expect(await confirm(json(CHOICE), randomBytes(IMPORT_RULES.seedBytes - 1))).toMatchObject(check("import_jobs_seed"));
        expect(await confirm(json(CHOICE), seed())).toBeNull();
      });
    });

    test("one active import an account: a second is refused while one is uploading, scanning, ready, preparing or publishing, and taken beside any other", async () => {
      await asApi(async (tx) => {
        const seen: [State, string][] = [];
        for (const state of STATES) {
          const { ownerId } = await jobIn(tx, state);
          const err = await attempt(tx, sql`insert into import_jobs (id, owner_id, source, declared_bytes) values (${randomUUID()}::uuid, ${ownerId}::uuid, 'x', 1000)`);
          seen.push([state, err === null ? "taken" : `${err.code} ${err.message}`]);
        }
        expect(seen).toEqual(STATES.map((state) => [state, (IMPORT_ACTIVE_STATES as readonly string[]).includes(state) ? expect.stringMatching(/^23505 .*import_jobs_one_active/) : "taken"]));
      });
    });

    test("a job row is deleted only once it is neither active nor undoing, or once its owner's profile is deleted; never while a post names it; its picks go with it", async () => {
      await asApi(async (tx) => {
        const seen: [State, string, string][] = [];
        for (const state of STATES) {
          const { id, ownerId } = await jobIn(tx, state);
          const del = sql`delete from import_jobs where id = ${id}::uuid`;
          const err = await attempt(tx, del);
          await tx.execute(sql`update profiles set deleted_at = now() where id = ${ownerId}::uuid`);
          const afterPurge = await attempt(tx, del);
          seen.push([state, err === null ? "deleted" : `${err.code} ${err.message}`, afterPurge === null ? "deleted" : `${afterPurge.code} ${afterPurge.message}`]);
        }
        const kept = [...IMPORT_ACTIVE_STATES, "undoing"] as readonly string[];
        expect(seen).toEqual(STATES.map((state) => [state, kept.includes(state) ? "42501 import_column" : "deleted", "deleted"]));
        // A ready job's picks go with it.
        const ready = await jobIn(tx, "ready");
        await tx.execute(sql`insert into import_picks (import_job_id, ref, left_out) values (${ready.id}::uuid, 0, true), (${ready.id}::uuid, 1, false)`);
        await tx.execute(sql`update import_jobs set ${moveSet("ready", "cancelled")} where id = ${ready.id}::uuid`);
        expect(await step(tx, sql`delete from import_jobs where id = ${ready.id}::uuid`)).toBeNull();
        const [left] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from import_picks where import_job_id = ${ready.id}::uuid`);
        expect(left!.n).toBe(0);
        // A job a post names stays: the foreign key has no on delete clause.
        const publishing = await jobIn(tx, "publishing");
        await importedPost(tx, publishing);
        await tx.execute(sql`update import_jobs set ${moveSet("publishing", "done")} where id = ${publishing.id}::uuid`);
        expect(await attempt(tx, sql`delete from import_jobs where id = ${publishing.id}::uuid`)).toMatchObject({ code: "23503", message: expect.stringContaining("posts_import_job_id_import_jobs_id_fk") });
      });
    });
  });

  /** What an imported post's insert names, as the publisher's batch writes it (6.5); each part can be changed. */
  interface ImportedPostInput {
    id?: string;
    authorId?: string;
    source?: string;
    at?: SQL;
    replyToId?: string | null;
    quoteOfId?: string | null;
    shortened?: boolean | null;
    key?: Buffer | null;
  }
  const orNull = (value: string | null | undefined): SQL => (value === null || value === undefined ? sql`null` : sql`${value}::uuid`);
  /** The insert of one imported post of the job, dated 3 March 2019 unless said, with a fresh key. */
  function importedPostSql(job: { id: string; ownerId: string }, input: ImportedPostInput = {}): SQL {
    const key = input.key === undefined ? randomBytes(IMPORT_RULES.keyBytes) : input.key;
    return sql`
      insert into posts (id, author_id, body, reply_to_id, quote_of_id, import_job_id, import_source, original_created_at, import_shortened, import_key)
      values (${input.id ?? randomUUID()}::uuid, ${input.authorId ?? job.ownerId}::uuid, 'an imported post', ${orNull(input.replyToId)}, ${orNull(input.quoteOfId)}, ${job.id}::uuid,
              ${input.source ?? "x"}::import_source, ${input.at ?? sql`timestamptz '2019-03-03 12:00:00+00'`}, ${input.shortened === undefined ? false : input.shortened}, ${key})`;
  }
  /** One imported post of the job, which must be taken: its id. */
  async function importedPost(tx: DbTx, job: { id: string; ownerId: string }, input: ImportedPostInput = {}): Promise<string> {
    const id = input.id ?? randomUUID();
    await tx.execute(importedPostSql(job, { ...input, id }));
    return id;
  }

  describe("posts: the five import columns", () => {
    test("an imported post is inserted only by a publishing job of its author with the same source, dated from earliestDate to futureDays after the job's creation, never a quote, a reply only within its job", async () => {
      await asApi(async (tx) => {
        const job = await jobIn(tx, "publishing");
        expect(await attempt(tx, importedPostSql(job))).toBeNull();
        const stranger = await profile(tx);
        expect(await attempt(tx, importedPostSql(job, { authorId: stranger.id }))).toEqual(REFUSED);
        expect(await attempt(tx, importedPostSql(job, { source: "mastodon" }))).toEqual(REFUSED);
        for (const state of STATES.filter((s) => s !== "publishing")) {
          const other = await jobIn(tx, state);
          expect(await attempt(tx, importedPostSql(other)), state).toEqual(REFUSED);
        }
        // The date bounds: the first tweet's day at UTC midnight, and futureDays after the import was created.
        const earliest = sql`${`${IMPORT_RULES.earliestDate}T00:00:00Z`}::timestamptz`;
        const latest = sql`(select j.created_at + make_interval(days => ${IMPORT_RULES.futureDays}) from import_jobs j where j.id = ${job.id}::uuid)`;
        expect(await attempt(tx, importedPostSql(job, { at: earliest }))).toBeNull();
        expect(await attempt(tx, importedPostSql(job, { at: sql`${earliest} - interval '1 second'` }))).toEqual(REFUSED);
        expect(await attempt(tx, importedPostSql(job, { at: latest }))).toBeNull();
        expect(await attempt(tx, importedPostSql(job, { at: sql`${latest} + interval '1 second'` }))).toEqual(REFUSED);
        // No quote, of anyone.
        const native = await newPostRow(tx, job.ownerId);
        const own = await importedPost(tx, job);
        expect(await attempt(tx, importedPostSql(job, { quoteOfId: native }))).toEqual(REFUSED);
        expect(await attempt(tx, importedPostSql(job, { quoteOfId: own }))).toEqual(REFUSED);
        // A reply only to a post of the same import: not to a native post, not to another import's post.
        const elsewhere = await jobIn(tx, "publishing");
        const theirs = await importedPost(tx, elsewhere);
        expect(await attempt(tx, importedPostSql(job, { replyToId: native }))).toEqual(REFUSED);
        expect(await attempt(tx, importedPostSql(job, { replyToId: theirs }))).toEqual(REFUSED);
        expect(await attempt(tx, importedPostSql(job, { replyToId: own }))).toBeNull();
        // A thread's parent and its reply in one insert, the parent first: the guard sees the row written before it.
        const parent = randomUUID();
        const child = randomUUID();
        const row = (id: string, replyTo: SQL) => sql`(${id}::uuid, ${job.ownerId}::uuid, 'a thread', ${replyTo}, null, ${job.id}::uuid, 'x', timestamptz '2019-03-03 12:00:00+00', false, ${randomBytes(32)})`;
        expect(
          await attempt(
            tx,
            sql`insert into posts (id, author_id, body, reply_to_id, quote_of_id, import_job_id, import_source, original_created_at, import_shortened, import_key)
                values ${row(parent, sql`null`)}, ${row(child, sql`${parent}::uuid`)}`,
          ),
        ).toBeNull();
      });
    });

    test("the five are all set or all null, and a post is imported once per account while it exists", async () => {
      await asApi(async (tx) => {
        const job = await jobIn(tx, "publishing");
        // A native post naming one of them, and an imported one missing one.
        expect(await attempt(tx, sql`insert into posts (author_id, body, import_key) values (${job.ownerId}::uuid, 'native', ${randomBytes(32)})`)).toMatchObject(check("posts_import_columns"));
        expect(await attempt(tx, importedPostSql(job, { key: null }))).toMatchObject(check("posts_import_columns"));
        expect(await attempt(tx, importedPostSql(job, { shortened: null }))).toMatchObject(check("posts_import_columns"));
        const key = randomBytes(32);
        await importedPost(tx, job, { key });
        expect(await attempt(tx, importedPostSql(job, { key }))).toMatchObject({ code: "23505", message: expect.stringContaining("posts_import_key_idx") });
        // Another account's import may hold the same key: the key is per account (decision 24).
        const other = await jobIn(tx, "publishing");
        expect(await attempt(tx, importedPostSql(other, { key }))).toBeNull();
      });
    });

    test("an update never sets the five, and clears them only all at once, in the statement that tombstones the post or on a tombstone; a counter's update never meets the guard", async () => {
      await asApi(async (tx) => {
        const job = await jobIn(tx, "publishing");
        const post = await importedPost(tx, job);
        const native = await newPostRow(tx, job.ownerId);
        const upd = (id: string, set: SQL) => attempt(tx, sql`update posts set ${set} where id = ${id}::uuid`);
        const none = sql`import_job_id = null, import_source = null, original_created_at = null, import_shortened = null, import_key = null`;
        const tombstone = sql`state = 'deleted_by_author', deleted_at = now(), body = ''`;
        expect(
          await upd(native, sql`import_job_id = ${job.id}::uuid, import_source = 'x', original_created_at = timestamptz '2019-03-03 12:00:00+00', import_shortened = false, import_key = ${randomBytes(32)}`),
        ).toEqual(REFUSED);
        expect(await upd(post, sql`import_shortened = true`)).toEqual(REFUSED);
        expect(await upd(post, sql`import_source = 'mastodon'`)).toEqual(REFUSED);
        expect(await upd(post, none)).toEqual(REFUSED);
        expect(await upd(post, sql`${tombstone}, import_job_id = null, import_source = null, original_created_at = null`)).toEqual(REFUSED);
        expect(await upd(post, sql`like_count = like_count + 1, reply_count = reply_count + 1`)).toBeNull();
        expect(await upd(post, sql`${tombstone}, ${none}`)).toBeNull();
        // A tombstone that kept them (a post an authority's order disabled keeps them until the purge) may clear them later.
        expect(await step(tx, sql`update posts set ${tombstone} where id = ${post}::uuid`)).toBeNull();
        expect(await upd(post, sql`import_shortened = true`)).toEqual(REFUSED);
        expect(await step(tx, sql`update posts set ${none} where id = ${post}::uuid`)).toBeNull();
        expect(await upd(post, sql`import_job_id = ${job.id}::uuid, import_source = 'x', original_created_at = now(), import_shortened = false, import_key = ${randomBytes(32)}`)).toEqual(REFUSED);
        // A native post's tombstone that names the five, as deletePost will, is taken.
        expect(await upd(native, sql`${tombstone}, ${none}`)).toBeNull();
      });
    });
  });

  describe("post_media: an imported image", () => {
    /** An image row as the media repository inserts an upload, ready at once here: the owner, and the import it came from. */
    const imageSql = (ownerId: string, imported: boolean, jobId: string | null) =>
      sql`insert into post_media (owner_id, status, width, height, blurhash, imported, import_job_id)
          values (${ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL', ${imported}, ${orNull(jobId)}) returning id`;
    const image = async (tx: DbTx, ownerId: string, imported: boolean, jobId: string | null) => (await tx.execute<{ id: string }>(imageSql(ownerId, imported, jobId)))[0]!.id;

    test("is inserted only with a preparing job of its owner; a native one names no job", async () => {
      await asApi(async (tx) => {
        const job = await jobIn(tx, "preparing");
        const stranger = await profile(tx);
        expect(await attempt(tx, imageSql(job.ownerId, true, job.id))).toBeNull();
        expect(await attempt(tx, imageSql(job.ownerId, false, null))).toBeNull();
        expect(await attempt(tx, imageSql(stranger.id, true, job.id))).toEqual(REFUSED);
        expect(await attempt(tx, imageSql(job.ownerId, true, null))).toEqual(REFUSED);
        expect(await attempt(tx, imageSql(job.ownerId, false, job.id))).toEqual(REFUSED);
        for (const state of STATES.filter((s) => s !== "preparing")) {
          const other = await jobIn(tx, state);
          expect(await attempt(tx, imageSql(other.ownerId, true, other.id)), state).toEqual(REFUSED);
        }
        // Neither column changes after the insert: the API role holds no UPDATE of them.
        const id = await image(tx, job.ownerId, true, job.id);
        expect(await attempt(tx, sql`update post_media set imported = false where id = ${id}::uuid`)).toEqual({ code: "42501", message: "permission denied for table post_media" });
        expect(await attempt(tx, sql`update post_media set import_job_id = null where id = ${id}::uuid`)).toEqual({ code: "42501", message: "permission denied for table post_media" });
      });
    });

    test("the link's CHECK stands behind the guard: not even the migrator links a native image to a job", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const owner = await profile(tx);
        // The migrator skips the guards and the insert trigger, so it names the state itself.
        const job = await newJob(tx, owner.id);
        expect(await attempt(tx, imageSql(owner.id, false, job))).toMatchObject(check("post_media_import_link"));
        expect(await attempt(tx, imageSql(owner.id, true, job))).toBeNull();
      });
    });

    test("is attached only to a post of its own import, with a description; once its job row goes it is attached nowhere", async () => {
      await asApi(async (tx) => {
        const owner = await profile(tx);
        // An earlier import of the account, done, with a post of its own.
        const earlier = await jobIn(tx, "publishing", { ownerId: owner.id });
        const earlierPost = await importedPost(tx, earlier);
        await move(tx, earlier.id, "publishing", "done");
        const job = await jobIn(tx, "preparing", { ownerId: owner.id });
        const id = await image(tx, owner.id, true, job.id);
        await move(tx, job.id, "preparing", "publishing");
        const post = await importedPost(tx, job);
        const native = await newPostRow(tx, owner.id);
        const attach = (postId: string, alt: SQL) => attempt(tx, sql`update post_media set post_id = ${postId}::uuid, position = 0, alt_text = ${alt} where id = ${id}::uuid`);
        expect(await attach(native, sql`'a description'`)).toEqual(REFUSED);
        expect(await attach(earlierPost, sql`'a description'`)).toEqual(REFUSED);
        expect(await attach(post, sql`null`)).toMatchObject(check("post_media_attached_is_complete"));
        expect(await attach(post, sql`'a description'`)).toBeNull();
        // A native upload still goes onto a native post.
        const upload = await image(tx, owner.id, false, null);
        expect(await attempt(tx, sql`update post_media set post_id = ${native}::uuid, position = 0, alt_text = 'mine' where id = ${upload}::uuid`)).toBeNull();
        // A stopped import's row goes (6.6), and its prepared image keeps imported with no job: nothing attaches it.
        const stopped = await jobIn(tx, "preparing");
        const left = await image(tx, stopped.ownerId, true, stopped.id);
        await move(tx, stopped.id, "preparing", "stopped");
        expect(await step(tx, sql`delete from import_jobs where id = ${stopped.id}::uuid`)).toBeNull();
        const [row] = await tx.execute<{ imported: boolean; import_job_id: string | null }>(sql`select imported, import_job_id from post_media where id = ${left}::uuid`);
        expect({ ...row }).toEqual({ imported: true, import_job_id: null });
        const theirs = await newPostRow(tx, stopped.ownerId);
        expect(await attempt(tx, sql`update post_media set post_id = ${theirs}::uuid, position = 0, alt_text = 'a description' where id = ${left}::uuid`)).toEqual(REFUSED);
      });
    });
  });

  describe("import_picks and import_keys", () => {
    test("picks are written only while their import is ready, each with at most MEDIA_MAX_PER_POST descriptions in altsMaxBytes; they are deleted in any state", async () => {
      await asApi(async (tx) => {
        const ready = await jobIn(tx, "ready");
        const pick = (jobId: string, ref: number, alts: SQL) => sql`insert into import_picks (import_job_id, ref, left_out, alts) values (${jobId}::uuid, ${ref}, false, ${alts})`;
        expect(await step(tx, pick(ready.id, 0, sql`null`))).toBeNull();
        expect(await attempt(tx, sql`update import_picks set left_out = true where import_job_id = ${ready.id}::uuid and ref = 0`)).toBeNull();
        expect(await attempt(tx, pick(ready.id, 1, json(["a", null, "b", "c"])))).toBeNull();
        expect(await attempt(tx, pick(ready.id, 1, json(["a", "b", "c", "d", "e"])))).toMatchObject(check("import_picks_alts"));
        expect(await attempt(tx, pick(ready.id, 1, json({ 0: "a" })))).toMatchObject(check("import_picks_alts"));
        // Four descriptions of 1,000 code points of four bytes each fit: the bound is altsMaxBytes, not 8,192 (Task 1's amendment).
        const wide = String.fromCodePoint(0x1f600).repeat(1000);
        expect(await attempt(tx, pick(ready.id, 1, json([wide, wide, wide, wide])))).toBeNull();
        // The bytes are the jsonb's text form: four strings, their quotes, three separators of two bytes and the brackets.
        const each = (IMPORT_RULES.altsMaxBytes - (2 + 4 * 2 + 3 * 2)) / MEDIA_MAX_PER_POST;
        const [size] = await tx.execute<{ n: number }>(sql`select octet_length(${json(Array.from({ length: 4 }, () => "x".repeat(each)))}::text) as n`);
        expect(size!.n).toBe(IMPORT_RULES.altsMaxBytes);
        expect(await attempt(tx, pick(ready.id, 1, json(["x".repeat(each), "x".repeat(each), "x".repeat(each), "x".repeat(each)])))).toBeNull();
        expect(await attempt(tx, pick(ready.id, 1, json(["x".repeat(each + 1), "x".repeat(each), "x".repeat(each), "x".repeat(each)])))).toMatchObject(check("import_picks_alts"));
        // The job and the line of a pick are outside the API role's grants.
        expect(await attempt(tx, sql`update import_picks set ref = 9 where import_job_id = ${ready.id}::uuid`)).toEqual({ code: "42501", message: "permission denied for table import_picks" });
        // Once the import leaves ready, a pick is neither written nor changed, and may still be deleted.
        await move(tx, ready.id, "ready", "publishing");
        expect(await attempt(tx, pick(ready.id, 2, sql`null`))).toEqual(REFUSED);
        expect(await attempt(tx, sql`update import_picks set left_out = true where import_job_id = ${ready.id}::uuid`)).toEqual(REFUSED);
        expect(await attempt(tx, sql`delete from import_picks where import_job_id = ${ready.id}::uuid`)).toBeNull();
        for (const state of STATES.filter((s) => s !== "ready")) {
          const other = await jobIn(tx, state);
          expect(await attempt(tx, pick(other.id, 0, sql`null`)), state).toEqual(REFUSED);
        }
      });
    });

    test("an import key is keyBytes long, one an account, never updated, and deleted only once its profile is", async () => {
      await asApi(async (tx) => {
        const owner = await profile(tx);
        const insert = (key: Buffer) => sql`insert into import_keys (owner_id, key) values (${owner.id}::uuid, ${key})`;
        expect(await attempt(tx, insert(randomBytes(IMPORT_RULES.keyBytes - 1)))).toMatchObject(check("import_keys_key"));
        expect(await step(tx, insert(randomBytes(IMPORT_RULES.keyBytes)))).toBeNull();
        expect(await attempt(tx, insert(randomBytes(IMPORT_RULES.keyBytes)))).toMatchObject({ code: "23505" });
        expect(await attempt(tx, sql`update import_keys set key = ${randomBytes(32)} where owner_id = ${owner.id}::uuid`)).toEqual({ code: "42501", message: "permission denied for table import_keys" });
        const del = sql`delete from import_keys where owner_id = ${owner.id}::uuid`;
        expect(await attempt(tx, del)).toEqual(REFUSED);
        await tx.execute(sql`update profiles set deleted_at = now() where id = ${owner.id}::uuid`);
        expect(await attempt(tx, del)).toBeNull();
      });
    });
  });

  describe("grants, row level security, the contracts' numbers and lists, the functions", () => {
    /** Which of the four table privileges, TRUNCATE and MAINTAIN a role holds on a public table (moderation-schema's helper). */
    async function tablePrivileges(role: string, table: string): Promise<string[]> {
      const rows = await apiDb.execute<{ privilege: string; held: boolean }>(sql`
        select p as privilege, has_table_privilege(${role}::name, c.oid, p) as held
          from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN']) with ordinality as u(p, place)
         where n.nspname = 'public' and c.relname = ${table}
         order by u.place`);
      expect(rows, table).toHaveLength(6);
      return rows.filter((row) => row.held).map((row) => row.privilege);
    }
    /** The columns of a public table a role may update, by a column grant or the table's. */
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

    test("the API role holds 6.4's grants on the three tables and the five post columns; korbat_auth and korbat_notify hold nothing on them", async () => {
      for (const table of IMPORT_TABLES) expect(await tablePrivileges("korbat_api", table), table).toEqual(["SELECT", "INSERT", "DELETE"]);
      // Every column of import_jobs but the five that never change, all under import_jobs_guard.
      expect(await updatableColumns("korbat_api", "import_jobs")).toEqual([
        "status",
        "received_bytes",
        "uploaded_at",
        "scanned_at",
        "confirmed_at",
        "ended_at",
        "failure",
        "stop_reason",
        "staff_ended_at",
        "staff_rule_id",
        "refused_at_original",
        "refused_words",
        "scan",
        "choice",
        "stated_at",
        "seed",
        "post_cursor",
        "image_cursor",
        "posts_published",
        "images_kept",
        "images_left_out",
        "posts_removed",
      ]);
      expect(await updatableColumns("korbat_api", "import_picks")).toEqual(["left_out", "alts"]);
      expect(await updatableColumns("korbat_api", "import_keys")).toEqual([]);
      expect((await updatableColumns("korbat_api", "posts")).slice(-5)).toEqual(["import_job_id", "import_source", "original_created_at", "import_shortened", "import_key"]);
      // post_media: INSERT names the two new columns; no UPDATE of either.
      expect(await updatableColumns("korbat_api", "post_media")).not.toEqual(expect.arrayContaining(["imported"]));
      expect(await updatableColumns("korbat_api", "post_media")).not.toEqual(expect.arrayContaining(["import_job_id"]));
      expect(await tablePrivileges("korbat_api", "posts")).toEqual(["SELECT", "INSERT"]);
      for (const role of ["korbat_auth", "korbat_notify"]) {
        for (const table of IMPORT_TABLES) {
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
         where n.nspname = 'public' and c.relname in ('import_jobs', 'import_picks', 'import_keys') order by 1`);
      expect(rows.map((r) => ({ ...r }))).toEqual(["import_jobs", "import_keys", "import_picks"].map((table) => ({ table, rls: true, policies: [`${table}_api_all:korbat_api:ALL:true:true`] })));
    });

    test("each CHECK's number and list, each enum and the one-active index are the contracts' IMPORT_RULES and lists", async () => {
      expect(numbers(await checkDefinition("import_jobs", "import_jobs_declared_bytes"))).toEqual([1, IMPORT_RULES.maxBytes]);
      expect(listed(await checkDefinition("import_jobs", "import_jobs_failure"))).toEqual([...IMPORT_FAILURES]);
      expect(listed(await checkDefinition("import_jobs", "import_jobs_stop_reason"))).toEqual([...IMPORT_STOP_REASONS]);
      expect(numbers(await checkDefinition("import_jobs", "import_jobs_refused_words"))).toEqual([IMPORT_RULES.refusedWordsMax]);
      expect(numbers(await checkDefinition("import_jobs", "import_jobs_scan"))).toEqual([IMPORT_RULES.scanMaxBytes]);
      expect(numbers(await checkDefinition("import_jobs", "import_jobs_choice"))).toEqual([IMPORT_RULES.choiceMaxBytes]);
      expect(numbers(await checkDefinition("import_jobs", "import_jobs_seed"))).toEqual([IMPORT_RULES.seedBytes]);
      expect(numbers(await checkDefinition("import_picks", "import_picks_alts"))).toEqual([MEDIA_MAX_PER_POST, IMPORT_RULES.altsMaxBytes]);
      expect(numbers(await checkDefinition("import_keys", "import_keys_key"))).toEqual([IMPORT_RULES.keyBytes]);
      const [enums] = await apiDb.execute<{ sources: string[]; states: string[] }>(
        sql`select enum_range(null::public.import_source)::text[] as sources, enum_range(null::public.import_status)::text[] as states`,
      );
      expect(enums!.sources).toEqual([...IMPORT_SOURCE_KINDS]);
      expect(enums!.states).toEqual([...ImportStatus.options]);
      const [active] = await apiDb.execute<{ definition: string }>(sql`select pg_get_indexdef('public.import_jobs_one_active'::regclass) as definition`);
      expect(active!.definition).toMatch(/^CREATE UNIQUE INDEX import_jobs_one_active ON public[.]import_jobs USING btree [(]owner_id[)] WHERE /);
      expect(listed(active!.definition)).toEqual([...IMPORT_ACTIVE_STATES]);
      // posts_import_guard's two date bounds: earliestDate at UTC midnight, and futureDays after the job's creation.
      const [guard] = await apiDb.execute<{ definition: string }>(sql`select pg_get_functiondef('public.posts_import_guard()'::regprocedure) as definition`);
      expect(guard!.definition).toContain(`timestamptz '${IMPORT_RULES.earliestDate} 00:00:00+00'`);
      expect(guard!.definition).toContain(`make_interval(days => ${IMPORT_RULES.futureDays})`);
    });

    test("the eight functions are the migrator's, plain, with their search path pinned and EXECUTE for nobody; the five triggers of the tables fire before their statements", async () => {
      const names = ["import_jobs_insert", "import_jobs_guard", "import_jobs_delete", "import_picks_guard", "import_keys_delete", "posts_import_guard", "post_media_import_insert", "post_media_import_attach"];
      const rows = await apiDb.execute<{ name: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean; notify: boolean; pub: boolean }>(sql`
        select p.proname::text as name, p.proowner::regrole::text as owner, p.prosecdef as definer, p.proconfig as config,
               has_function_privilege('korbat_api', p.oid, 'execute') as api, has_function_privilege('korbat_auth', p.oid, 'execute') as auth,
               has_function_privilege('korbat_notify', p.oid, 'execute') as notify, has_function_privilege('public', p.oid, 'execute') as pub
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${`{${names.join(",")}}`}::text[]) order by 1`);
      expect(rows.map((row) => ({ ...row }))).toEqual(
        [...names].sort().map((name) => ({ name, owner: "korbat_migrate", definer: false, config: ["search_path=public, pg_temp"], api: false, auth: false, notify: false, pub: false })),
      );
      const triggers = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.import_jobs'::regclass, 'public.import_picks'::regclass, 'public.import_keys'::regclass) order by 1`);
      expect(Object.fromEntries(triggers.map((row) => [row.name, row.definition.replace(/^CREATE TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]))).toEqual({
        import_jobs_delete: "BEFORE DELETE ON public.import_jobs FOR EACH ROW",
        import_jobs_guard: "BEFORE UPDATE ON public.import_jobs FOR EACH ROW",
        import_jobs_insert: "BEFORE INSERT ON public.import_jobs FOR EACH ROW",
        import_keys_delete: "BEFORE DELETE ON public.import_keys FOR EACH ROW",
        import_picks_guard: "BEFORE INSERT OR UPDATE ON public.import_picks FOR EACH ROW",
      });
    });
  });

  describe("0044's decision_actions_check: the flood count passes over imported posts", () => {
    const MIGRATIONS = path.resolve(import.meta.dirname, "../../../../packages/db/migrations");
    /** The function's statement in a migration file, from CREATE OR REPLACE to the end of its body. */
    const functionIn = (tag: string) => {
      const text = readFileSync(path.join(MIGRATIONS, `${tag}.sql`), "utf8");
      const start = text.indexOf('CREATE OR REPLACE FUNCTION "public"."decision_actions_check"()');
      expect(start, tag).toBeGreaterThan(0);
      const end = text.indexOf("END $$;", start);
      expect(end, tag).toBeGreaterThan(start);
      return text.slice(start, end + "END $$;".length);
    };
    /** 0032's flood count (0032_orders_review.sql, line 316), and the one clause 0044 adds to it. */
    const COUNT = "FROM public.posts p WHERE p.author_id = subject AND p.created_at > now() - make_interval(mins => rules.flood_minutes))";
    const COUNTED = "FROM public.posts p WHERE p.author_id = subject AND p.created_at > now() - make_interval(mins => rules.flood_minutes) AND p.import_job_id IS NULL)";

    test("its text is 0032's, byte for byte, with the one clause added to the flood count, and the database runs that text", async () => {
      const before = functionIn("0032_orders_review");
      const after = functionIn("0044_imported_posts");
      expect(before.split(COUNT)).toHaveLength(2);
      expect(after).toBe(before.replace(COUNT, COUNTED));
      const [row] = await apiDb.execute<{ body: string }>(sql`select prosrc as body from pg_proc where oid = 'public.decision_actions_check()'::regprocedure`);
      expect(row!.body).toBe(after.slice(after.indexOf("$$") + 2, after.lastIndexOf("$$")));
    });

    test("STANDING_RULES.floodPosts imported posts in the hour are no floor under a suspension at once, while as many native ones are", async () => {
      await asApi(async (tx) => {
        await staffProfile(tx, admin);
        const job = await jobIn(tx, "publishing");
        // An import published at once: floodPosts posts written now, each with its own key.
        await tx.execute(sql`
          insert into posts (author_id, body, import_job_id, import_source, original_created_at, import_shortened, import_key)
          select ${job.ownerId}::uuid, 'imported ' || g, ${job.id}::uuid, 'x', timestamptz '2019-03-03 12:00:00+00', false, sha256(convert_to(g::text, 'UTF8'))
            from generate_series(1, ${STANDING_RULES.floodPosts}) g`);
        const caseId = async () => (await intake(tx, ground.finding(admin.id, "R6"), anAccount(job.ownerId, "named"))).items[0]!.caseId!;
        const suspend = async () => decideIn(tx, admin, await caseId(), { kind: "final", ruleId: "R6", actions: [timed("suspend", STANDING_RULES.floodDays, false)] });
        expect(await refusalDetail(suspend())).toMatch(/^basis: none fits/);
        for (let i = 0; i < STANDING_RULES.floodPosts; i++) await newPostRow(tx, job.ownerId, { createdAt: sql`now()` });
        const decision = await suspend();
        expect((await actionsOf(tx, decision)).find((action) => action.kind === "suspend")).toMatchObject({ basis: "flood" });
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb, IMPORT_TABLES)).toEqual(before);
  });
});
