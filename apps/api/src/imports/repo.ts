import { sql, type SQL } from "drizzle-orm";
import { IMPORT_RULES, type ImportChoice, type ImportFailure, type ImportImageSkip, type ImportScanFacts, type ImportSource, type ImportStatus } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { WRITE_CLOCK, closingJudgment, liveNotSuspended } from "../lib/standing";
import { ImportError } from "./context";

/**
 * Every statement on import_jobs, import_picks and import_keys (3b design, sections 6.1 and 9.1), on the korbat_api pool.
 * The triggers of migration 0043 judge each write: import_jobs_insert forces a new import's columns, import_jobs_guard
 * lets each column change only by the move of section 4.1 that names it, and import_picks_guard takes a pick only while
 * its import is ready. Every move below is one UPDATE that names the state it leaves, so a move that lost a race to
 * another (a cancel and the drive, two requests of one upload) changes nothing and is answered as such.
 */

/** The five active states of 4.1, which import_jobs_one_active counts. */
const ACTIVE = sql`('uploading', 'scanning', 'ready', 'preparing', 'publishing')`;
/** The states in which an import has ended for good, or is being removed: its picks are of no further use (7.5 step 7). */
const ENDED = sql`('done', 'stopped', 'undoing', 'undone', 'failed', 'cancelled', 'expired')`;

/** The columns an import's view and its flows read, with bigint and date columns in forms the driver hands over as they are. */
const COLUMNS = sql`j.id, j.owner_id, j.source::text as source, j.status::text as status, j.declared_bytes::float8 as declared_bytes,
  j.received_bytes::float8 as received_bytes, j.created_at, j.uploaded_at, j.scanned_at, j.confirmed_at, j.ended_at, j.failure,
  j.stop_reason, j.staff_rule_id, to_char(j.refused_at_original, 'YYYY-MM-DD') as refused_at_original, j.refused_words, j.scan,
  j.choice, j.posts_published, j.images_kept, j.images_left_out, j.posts_removed, j.images, j.images_left_out_by, j.staff_decision_id, j.stated_at`;

/**
 * The move out of ready (whichever it is) keeps the counts and fromRef and leaves the month table, the samples, the pages
 * and the count of posts skipped as not public behind (decision 25), as import_jobs_guard requires of it.
 */
const CUT_SCAN = sql`jsonb_set(j.scan || jsonb_build_object('months', '[]'::jsonb, 'samples', '[]'::jsonb, 'pages', '[]'::jsonb),
  '{skipped}', coalesce(j.scan -> 'skipped', '{}'::jsonb) - 'not_public')`;

/**
 * 3b Task 5: images_left_out_by with these counts added, reason by reason (`add` a jsonb object of counts); the guard of
 * 0047 holds every count to growing and their sum to images_left_out, which the same statement raises by as many.
 */
const ADD_BY = (add: SQL): SQL => sql`j.images_left_out_by || (select coalesce(jsonb_object_agg(a.key, coalesce((j.images_left_out_by ->> a.key)::int, 0) + a.value::int), '{}'::jsonb)
  from jsonb_each_text(${add}) a)`;

/** A fixed key of pg_advisory_xact_lock: every creation takes it, so the site's count of active uploads is read and kept by one at a time (4.2 step 3). */
const SITE_LOCK = sql`hashtext('korbat:import_jobs:site_active')`;

export interface ImportRow {
  id: string;
  ownerId: string;
  source: ImportSource;
  status: ImportStatus;
  declaredBytes: number;
  receivedBytes: number;
  createdAt: Date;
  uploadedAt: Date | null;
  scannedAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  failure: ImportFailure | null;
  stopReason: string | null;
  staffRuleId: string | null;
  refusedAtOriginal: string | null;
  refusedWords: string | null;
  /** ImportScanFacts as the drive wrote it; the view parses it before it shows a member. */
  scan: unknown;
  choice: unknown;
  postsPublished: number;
  imagesKept: number;
  imagesLeftOut: number;
  postsRemoved: number;
  /** Whether the import brings images, decided at its creation (migration 0046). */
  images: boolean;
  /** 3b Task 5 (migration 0047): the images the preparation left out, by reason. */
  imagesLeftOutBy: Partial<Record<ImportImageSkip, number>>;
  /** 3b Task 6 (migration 0048): the decision an admin's end of the import rests on, set with staffRuleId. */
  staffDecisionId: string | null;
  /** When the person made the statement, with the confirmation (the data export lists it, 11.2). */
  statedAt: Date | null;
}

/** 3b Task 6: an import that publishes (7.5 step 5), as the publisher reads it. */
export interface PublishingImport {
  id: string;
  ownerId: string;
  source: ImportSource;
  /** The 32 bytes the post and image ids are derived from (6.5). */
  seed: Buffer;
  choice: unknown;
  scan: unknown;
  createdAt: Date;
  /** Lines of posts.jsonl handled so far. */
  postCursor: number;
}

/** 3b Task 6 (8.7): what an admin's end of an import did, for what follows its commit. */
export interface StaffEnd {
  id: string;
  ownerId: string;
  /** The state it was in: a running import's work folder and plan go after the commit. */
  from: ImportStatus;
  /** The state it is in now: stopped (nothing was published) or undoing. */
  to: "stopped" | "undoing";
}

/** 3b Task 5: the import the feeder feeds (7.4), as it reads it. */
export interface PreparingImport {
  id: string;
  ownerId: string;
  /** The 32 bytes the image ids are derived from (6.5). */
  seed: Buffer;
  /** ImportChoice and ImportScanFacts as the confirmation wrote them; the feeder parses them. */
  choice: unknown;
  scan: unknown;
  images: boolean;
  createdAt: Date;
  imageCursor: number;
  imagesKept: number;
}

interface RawRow {
  id: string;
  owner_id: string;
  source: ImportSource;
  status: ImportStatus;
  declared_bytes: number;
  received_bytes: number;
  created_at: Date | string;
  uploaded_at: Date | string | null;
  scanned_at: Date | string | null;
  confirmed_at: Date | string | null;
  ended_at: Date | string | null;
  failure: ImportFailure | null;
  stop_reason: string | null;
  staff_rule_id: string | null;
  refused_at_original: string | null;
  refused_words: string | null;
  scan: unknown;
  choice: unknown;
  posts_published: number;
  images_kept: number;
  images_left_out: number;
  posts_removed: number;
  images: boolean;
  images_left_out_by: Partial<Record<ImportImageSkip, number>> | null;
  staff_decision_id: string | null;
  stated_at: Date | string | null;
}

const time = (value: Date | string | null): Date | null => (value === null ? null : new Date(value));

function toRow(raw: RawRow): ImportRow {
  return {
    id: raw.id,
    ownerId: raw.owner_id,
    source: raw.source,
    status: raw.status,
    declaredBytes: Number(raw.declared_bytes),
    receivedBytes: Number(raw.received_bytes),
    createdAt: new Date(raw.created_at),
    uploadedAt: time(raw.uploaded_at),
    scannedAt: time(raw.scanned_at),
    confirmedAt: time(raw.confirmed_at),
    endedAt: time(raw.ended_at),
    failure: raw.failure,
    stopReason: raw.stop_reason,
    staffRuleId: raw.staff_rule_id,
    refusedAtOriginal: raw.refused_at_original,
    refusedWords: raw.refused_words,
    scan: raw.scan,
    choice: raw.choice,
    postsPublished: raw.posts_published,
    imagesKept: raw.images_kept,
    imagesLeftOut: raw.images_left_out,
    postsRemoved: raw.posts_removed,
    images: raw.images,
    imagesLeftOutBy: raw.images_left_out_by ?? {},
    staffDecisionId: raw.staff_decision_id,
    statedAt: time(raw.stated_at),
  };
}

/** What the creating statement read, in the order 4.2 step 3 answers its refusals. */
export interface CreateFacts {
  /** The profile row exists, is not deleted and its suspension does not run, by 3e's predicate in the locking statement. */
  live: boolean;
  /** The profile is at least minAccountAgeDays old. */
  aged: boolean;
  /** The account has an import in an active state. */
  active: boolean;
  /** Published imports confirmed in the last seven days, and when the oldest of them leaves the window. */
  week: number;
  weekFreesAt: Date | null;
  /** Imports in uploading or scanning on the site, read under the site's lock. */
  site: number;
  /** The row was inserted. */
  created: boolean;
}

export interface CreateInput {
  id: string;
  ownerId: string;
  source: ImportSource;
  bytes: number;
  images: boolean;
  /** The auth module's answer: the account's address was verified (4.2 step 3). */
  verified: boolean;
  maxActive: number;
  /** A fresh account import key of 32 random bytes, kept only when the account has none (5.4). */
  key: Buffer;
}

/** One pick as import_picks holds it, with the line's facts of migration 0046. */
export interface PickRow {
  ref: number;
  leftOut: boolean;
  alts: (string | null)[] | null;
  month: string;
  marks: number;
  described: number;
}

/** SQLSTATE and constraint of a database error, through drizzle's wrapping of the driver's error. */
export function pgError(err: unknown): { code: string; constraint: string | null; message: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof current === "object" && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      const found = current as { constraint_name?: unknown; constraint?: unknown; message?: unknown };
      const constraint = typeof found.constraint_name === "string" ? found.constraint_name : typeof found.constraint === "string" ? found.constraint : null;
      return { code, constraint, message: typeof found.message === "string" ? found.message : "" };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function createImportRepo(db: Db) {
  const rows = async <T>(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, query: SQL): Promise<T[]> => (await q.execute(query)) as unknown as T[];
  const ids = async (query: SQL): Promise<string[]> => (await rows<{ id: string }>(db, query)).map((row) => row.id);

  return {
    /**
     * Creates an import (4.2 step 3, 8.5) in one transaction: the site's lock (pg_advisory_xact_lock on a fixed key, so
     * the count of uploads and scans on the site cannot be passed by two creations at once), then one statement that locks
     * the profile row FOR KEY SHARE, judges it by 3e's predicate by the clock, reads the account's age, its active import,
     * its published imports of the week and the site's count, and inserts the row only when every one allows it. `judge`
     * runs next, inside the transaction, on what the statement read: it throws the refusal in 4.2's order (and makes the
     * checks that are not the database's: the address's limit, the importer's heartbeat, the free space), which rolls
     * the insert back. Then the account's import key, made at its first import and never replaced, and last the closing
     * judgment of the owner (3e's review), which refuses account_suspended for a start that came while it waited.
     */
    async create(input: CreateInput, judge: (facts: CreateFacts) => Promise<void>): Promise<void> {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${SITE_LOCK})`);
          const [found] = await rows<{
            live: boolean;
            aged: boolean;
            active: boolean;
            week: number;
            week_frees_at: Date | string | null;
            site: number;
            created: boolean;
          }>(
            tx,
            sql`
            with me as (
              select p.id, p.created_at, ${liveNotSuspended("p", WRITE_CLOCK)} as live
                from profiles p where p.id = ${input.ownerId}::uuid for key share of p
            ), facts as (
              select me.id, me.live,
                     me.created_at <= clock_timestamp() - make_interval(days => ${IMPORT_RULES.minAccountAgeDays}::int) as aged,
                     exists (select 1 from import_jobs j where j.owner_id = me.id and j.status in ${ACTIVE}) as active,
                     (select count(*)::int from import_jobs j
                       where j.owner_id = me.id and j.confirmed_at > clock_timestamp() - interval '7 days' and j.posts_published > 0) as week,
                     (select min(j.confirmed_at) + interval '7 days' from import_jobs j
                       where j.owner_id = me.id and j.confirmed_at > clock_timestamp() - interval '7 days' and j.posts_published > 0) as week_frees_at,
                     (select count(*)::int from import_jobs j where j.status in ('uploading', 'scanning')) as site
                from me
            ), inserted as (
              insert into import_jobs (id, owner_id, source, declared_bytes, images)
              select ${input.id}::uuid, f.id, ${input.source}::import_source, ${input.bytes}::bigint, ${input.images}
                from facts f
               where f.live and f.aged and ${input.verified} and not f.active and f.week < ${IMPORT_RULES.importsPerWeek}::int and f.site < ${input.maxActive}::int
              returning id
            )
            select f.live, f.aged, f.active, f.week, f.week_frees_at, f.site, exists (select 1 from inserted) as created from facts f`,
          );
          const facts: CreateFacts = found
            ? { live: found.live, aged: found.aged, active: found.active, week: found.week, weekFreesAt: time(found.week_frees_at), site: found.site, created: found.created }
            : { live: false, aged: false, active: false, week: 0, weekFreesAt: null, site: 0, created: false };
          await judge(facts);
          if (!facts.created) throw new Error("import: the create statement inserted nothing and no refusal answered it");
          await tx.execute(sql`insert into import_keys (owner_id, key) values (${input.ownerId}::uuid, ${input.key}::bytea) on conflict (owner_id) do nothing`);
          const judged = await closingJudgment(tx, input.ownerId);
          if (!judged || judged.deleted || judged.suspended) throw new ImportError("account_suspended");
        });
      } catch (err) {
        // A second creation of the account that the statement could not see (it would have waited on the site's lock):
        // the unique index answers it.
        if (pgError(err)?.constraint === "import_jobs_one_active") throw new ImportError("import_active");
        throw err;
      }
    },

    /** A transaction on the module's pool, for a step that writes in the media module's tables too (7.4's leftovers). */
    transaction: <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> => db.transaction(fn),

    /**
     * The confirmation (4.5 step 1, 9.2): ready to preparing or publishing in one UPDATE that writes the state, the choice,
     * the statement's time, confirmed_at, the seed (6.1, set together, once, as import_jobs_guard requires) and the scan
     * cut down as CUT_SCAN cuts it, with the chosen totals added as its member `chosen` (the orchestrator's ruling). False
     * when the import left ready meanwhile.
     */
    async confirm(input: { id: string; ownerId: string; status: "preparing" | "publishing"; choice: ImportChoice; seed: Buffer; chosen: { posts: number; images: number } }): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = ${input.status}::import_status, choice = ${JSON.stringify(input.choice)}::jsonb, stated_at = clock_timestamp(),
                   confirmed_at = clock_timestamp(), seed = ${input.seed}::bytea, scan = ${CUT_SCAN} || jsonb_build_object('chosen', ${JSON.stringify(input.chosen)}::jsonb)
             where j.id = ${input.id}::uuid and j.owner_id = ${input.ownerId}::uuid and j.status = 'ready' returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * The person's Stop (4.6, 9.2): preparing or publishing to stopped (by_author) in one UPDATE, the seed cleared and the
     * end set, as the guard requires of the move. False when the import is in neither state. Published posts stay; the
     * drive deletes the prepared images that are on no post (7.4) and the importer the work folder.
     */
    async stop(id: string, ownerId: string): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'stopped', stop_reason = 'by_author', seed = null, ended_at = clock_timestamp()
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and j.status in ('preparing', 'publishing') returning j.id`,
      );
      return done.length === 1;
    },

    /** The import in preparing confirmed longest ago, which the feeder feeds alone (7.4), with its seed; null when none prepares. */
    async preparing(): Promise<PreparingImport | null> {
      const [found] = await rows<{
        id: string;
        owner_id: string;
        seed: string | null;
        choice: unknown;
        scan: unknown;
        images: boolean;
        created_at: Date | string;
        image_cursor: number;
        images_kept: number;
      }>(
        db,
        sql`select j.id, j.owner_id, encode(j.seed, 'hex') as seed, j.choice, j.scan, j.images, j.created_at, j.image_cursor, j.images_kept
              from import_jobs j where j.status = 'preparing' order by j.confirmed_at, j.id limit 1`,
      );
      if (!found || found.seed === null) return null;
      return {
        id: found.id,
        ownerId: found.owner_id,
        seed: Buffer.from(found.seed, "hex"),
        choice: found.choice,
        scan: found.scan,
        images: found.images,
        createdAt: new Date(found.created_at),
        imageCursor: found.image_cursor,
        imagesKept: found.images_kept,
      };
    },

    /**
     * The feeder's claim on one image (7.4 step 4), inside the media module's transaction that writes the image's row, in
     * 3e's lock order: the owner's profile row FOR KEY SHARE (the row the insert's predicate then judges, already held),
     * then the job's row by an UPDATE that moves image_cursor from `from` (FOR NO KEY UPDATE), only while the import is
     * still preparing and its owner's. False when it is not: the caller rolls back and writes nothing.
     */
    async claimImage(tx: DbTx, jobId: string, ownerId: string, from: number): Promise<boolean> {
      await tx.execute(sql`select 1 from profiles p where p.id = ${ownerId}::uuid for key share of p`);
      const done = await rows<{ id: string }>(
        tx,
        sql`update import_jobs j set image_cursor = j.image_cursor + 1
             where j.id = ${jobId}::uuid and j.owner_id = ${ownerId}::uuid and j.status = 'preparing' and j.image_cursor = ${from}::int returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * Images the feeder leaves out before any row is written (7.4 step 4: a file openWorkFile refuses is missing_file, one
     * the sniff refuses unsupported, one over the cap too_large; with the comparison off, not_checked): the cursor moves
     * past `count` of them from `from`, and images_left_out and the reason's count grow by as many, in one statement, only
     * while the import is still preparing at that cursor. With `reason` null the cursor alone moves: an image whose row
     * was written before. False when the import moved on.
     */
    async skipImages(jobId: string, from: number, count: number, reason: ImportImageSkip | null): Promise<boolean> {
      const added = reason === null ? 0 : count;
      const by = reason === null ? sql`j.images_left_out_by` : sql`${ADD_BY(sql`${JSON.stringify({ [reason]: count })}::jsonb`)}`;
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set image_cursor = j.image_cursor + ${count}::int, images_left_out = j.images_left_out + ${added}::int, images_left_out_by = ${by}
             where j.id = ${jobId}::uuid and j.status = 'preparing' and j.image_cursor = ${from}::int returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * The settling of the feeder's images (7.4 step 5), in one transaction: the job's row FOR NO KEY UPDATE while it is
     * still preparing (else nothing is written and null answers), then `remove` deletes the rows left out through the media
     * module (in its id order, after the job's row, as the feeder's insert takes them), and the rows that went are counted
     * by their reason into images_left_out and images_left_out_by, with images_kept raised to `kept`, the import's ready and
     * clear rows. A row that did not go (a hold keeps it) is not counted and is settled again in a later round.
     */
    async settle(jobId: string, kept: number, leftOut: ReadonlyMap<string, ImportImageSkip>, remove: (tx: DbTx, ids: readonly string[]) => Promise<string[]>): Promise<string[] | null> {
      return db.transaction(async (tx) => {
        const [job] = await rows<{ id: string }>(tx, sql`select j.id from import_jobs j where j.id = ${jobId}::uuid and j.status = 'preparing' for no key update of j`);
        if (!job) return null;
        const gone = leftOut.size === 0 ? [] : await remove(tx, [...leftOut.keys()]);
        const by: Partial<Record<ImportImageSkip, number>> = {};
        for (const id of gone) {
          const reason = leftOut.get(id)!;
          by[reason] = (by[reason] ?? 0) + 1;
        }
        await tx.execute(sql`update import_jobs j set images_kept = greatest(j.images_kept, ${kept}::int), images_left_out = j.images_left_out + ${gone.length}::int,
                                images_left_out_by = ${ADD_BY(sql`${JSON.stringify(by)}::jsonb`)}
                              where j.id = ${jobId}::uuid`);
        return gone;
      });
    },

    /**
     * Every image settled (7.5 step 4): preparing to publishing, once the cursor is at the plan's end, with images_kept set to
     * the kept rows (a count that only grows). False when the import moved on or is not at that cursor.
     */
    async toPublishing(jobId: string, cursor: number, kept: number): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'publishing', images_kept = greatest(j.images_kept, ${kept}::int)
             where j.id = ${jobId}::uuid and j.status = 'preparing' and j.image_cursor = ${cursor}::int returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * A refusal stops the import (8.2 step 1), in one transaction: preparing to stopped (refused_image) with the refused
     * image's post's day and first words when its line could be read again, the seed cleared and the end set; then
     * `remove` deletes its rows on no post through the media module (the refused row stays, held for good by its refusal,
     * which the keep trigger leaves). The ids that went, whose files the caller asks for after the commit; null when the
     * import was no longer preparing and nothing was written.
     */
    async stopRefused(jobId: string, refused: { day: string; words: string } | null, remove: (tx: DbTx) => Promise<string[]>): Promise<string[] | null> {
      return db.transaction(async (tx) => {
        const done = await rows<{ id: string }>(
          tx,
          sql`update import_jobs j set status = 'stopped', stop_reason = 'refused_image', seed = null, ended_at = clock_timestamp(),
                     refused_at_original = ${refused?.day ?? null}::date, refused_words = ${refused?.words ?? null}
               where j.id = ${jobId}::uuid and j.status = 'preparing' returning j.id`,
        );
        if (done.length === 0) return null;
        return remove(tx);
      });
    },

    /** 3b Task 6 (7.5 step 5): every import that publishes, oldest confirmation first, with its seed. */
    async publishing(): Promise<PublishingImport[]> {
      const found = await rows<{ id: string; owner_id: string; source: ImportSource; seed: string | null; choice: unknown; scan: unknown; created_at: Date | string; post_cursor: number }>(
        db,
        sql`select j.id, j.owner_id, j.source::text as source, encode(j.seed, 'hex') as seed, j.choice, j.scan, j.created_at, j.post_cursor
              from import_jobs j where j.status = 'publishing' order by j.confirmed_at, j.id`,
      );
      return found
        .filter((row) => row.seed !== null)
        .map((row) => ({
          id: row.id,
          ownerId: row.owner_id,
          source: row.source,
          seed: Buffer.from(row.seed!, "hex"),
          choice: row.choice,
          scan: row.scan,
          createdAt: new Date(row.created_at),
          postCursor: row.post_cursor,
        }));
    },

    /**
     * 3b Task 6 (4.5 step 4, 7.5 step 5): at the end of posts.jsonl, publishing to done in one UPDATE that clears the seed
     * and sets the end, as import_jobs_guard requires of the move; only at the cursor the publisher reached. False when the
     * import moved on.
     */
    async toDone(id: string, cursor: number): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'done', seed = null, ended_at = clock_timestamp()
             where j.id = ${id}::uuid and j.status = 'publishing' and j.post_cursor = ${cursor}::int returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * 3b Task 6 (4.6, 9.2): the person's undo, done (or stopped with posts published) to undoing in one UPDATE. False when the
     * import is in neither, which the guard would refuse too.
     */
    async toUndoing(id: string, ownerId: string): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'undoing'
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and (j.status = 'done' or (j.status = 'stopped' and j.posts_published > 0)) returning j.id`,
      );
      return done.length === 1;
    },

    /** 3b Task 6 (7.5 step 6): every import that is undoing, oldest end first. */
    async undoing(): Promise<{ id: string; ownerId: string }[]> {
      const found = await rows<{ id: string; owner_id: string }>(db, sql`select j.id, j.owner_id from import_jobs j where j.status = 'undoing' order by j.ended_at, j.id`);
      return found.map((row) => ({ id: row.id, ownerId: row.owner_id }));
    },

    /** 3b Task 6 (7.5 step 6): no post of the import is left that is neither deleted nor disabled: undoing to undone, the end set again. */
    async toUndone(id: string): Promise<boolean> {
      const done = await rows<{ id: string }>(db, sql`update import_jobs j set status = 'undone', ended_at = clock_timestamp() where j.id = ${id}::uuid and j.status = 'undoing' returning j.id`);
      return done.length === 1;
    },

    /**
     * 3b Task 6 (4.7, 6.6): the account's purge, in the social module's transaction, after the profile is marked deleted and
     * every post of the account tombstoned with its import columns cleared: every import row of the account, whatever its
     * state, and its import key, which import_jobs_delete and import_keys_delete allow once the profile is deleted. A post
     * that still named one would fail the delete (23503) and roll the purge back. The ids, whose files the caller asks for
     * after the commit.
     */
    async purgeOwner(tx: DbTx, ownerId: string): Promise<string[]> {
      const gone = await rows<{ id: string }>(tx, sql`delete from import_jobs j where j.owner_id = ${ownerId}::uuid returning j.id`);
      await tx.execute(sql`delete from import_keys k where k.owner_id = ${ownerId}::uuid`);
      return gone.map((row) => row.id);
    },

    /** 3b Task 6 (8.7, the orchestrator's ruling): how many posts an import published (its size on a case), or null when there is no such import. */
    async importSize(id: string): Promise<number | null> {
      const [row] = await rows<{ posts_published: number }>(db, sql`select j.posts_published from import_jobs j where j.id = ${id}::uuid`);
      return row?.posts_published ?? null;
    },

    /**
     * 3b Task 6 (8.7): an admin's end of a whole import, in the staff module's transaction, before its audit row. The
     * import's row FOR UPDATE, then whether `postId` (the case's post) is a post of it: `not_of_import` when it is not;
     * `wrong_state` when the import was ended by staff already or has nothing to end (undoing, undone, or ended before
     * publishing anything); else the moves of 8.7, each one UPDATE that writes what import_jobs_guard requires of it: a
     * running import to stopped (by_staff) with the seed cleared, its end and the staff end's four columns, then, when it
     * published posts, to undoing; a done or stopped one with posts straight to undoing, the four columns in that move.
     * staff_ended_at is the transaction's time, which a restore's gap of a lost end is held to (0048's gap_close). Null
     * when there is no such import.
     */
    async endByStaff(tx: DbTx, input: { id: string; postId: string; caseId: string; decisionId: string; ruleId: string }): Promise<StaffEnd | "not_of_import" | "wrong_state" | null> {
      const [job] = await rows<{ owner_id: string; status: ImportStatus; posts_published: number; staff: boolean }>(
        tx,
        sql`select j.owner_id, j.status::text as status, j.posts_published, j.staff_ended_at is not null as staff from import_jobs j where j.id = ${input.id}::uuid for update of j`,
      );
      if (!job) return null;
      const [named] = await rows<{ id: string }>(tx, sql`select p.id from posts p where p.id = ${input.postId}::uuid and p.import_job_id = ${input.id}::uuid`);
      if (!named) return "not_of_import";
      if (job.staff) return "wrong_state";
      const staff = sql`staff_ended_at = now(), staff_rule_id = ${input.ruleId}, staff_case_id = ${input.caseId}::uuid, staff_decision_id = ${input.decisionId}::uuid`;
      const running = job.status === "preparing" || job.status === "publishing";
      if (running) {
        await tx.execute(sql`update import_jobs set status = 'stopped', stop_reason = 'by_staff', seed = null, ended_at = clock_timestamp(), ${staff} where id = ${input.id}::uuid`);
        if (job.posts_published === 0) return { id: input.id, ownerId: job.owner_id, from: job.status, to: "stopped" };
        await tx.execute(sql`update import_jobs set status = 'undoing' where id = ${input.id}::uuid`);
        return { id: input.id, ownerId: job.owner_id, from: job.status, to: "undoing" };
      }
      if (job.status === "done" || (job.status === "stopped" && job.posts_published > 0)) {
        await tx.execute(sql`update import_jobs set status = 'undoing', ${staff} where id = ${input.id}::uuid`);
        return { id: input.id, ownerId: job.owner_id, from: job.status, to: "undoing" };
      }
      return "wrong_state";
    },

    /** The account's import, or null for an import of anyone else or none. */
    async find(id: string, ownerId: string): Promise<ImportRow | null> {
      const [raw] = await rows<RawRow>(db, sql`select ${COLUMNS} from import_jobs j where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid`);
      return raw ? toRow(raw) : null;
    },

    /** 3b Task 6 (11.2): every import of the account, newest first, for its data export. */
    async exportRows(ownerId: string): Promise<ImportRow[]> {
      const found = await rows<RawRow>(db, sql`select ${COLUMNS} from import_jobs j where j.owner_id = ${ownerId}::uuid order by j.created_at desc, j.id desc`);
      return found.map(toRow);
    },

    /** The account's imports, newest first, at most `limit`. */
    async list(ownerId: string, limit: number): Promise<ImportRow[]> {
      const found = await rows<RawRow>(db, sql`select ${COLUMNS} from import_jobs j where j.owner_id = ${ownerId}::uuid order by j.created_at desc, j.id desc limit ${limit}::int`);
      return found.map(toRow);
    },

    /** The account's import key (5.4), as 64 lowercase hex, for job.json; null when it has none. */
    async accountKey(ownerId: string): Promise<string | null> {
      const [row] = await rows<{ key: string }>(db, sql`select encode(k.key, 'hex') as key from import_keys k where k.owner_id = ${ownerId}::uuid`);
      return row?.key ?? null;
    },

    /**
     * The stored size of an upload moves from `from` to `to` in one statement that requires the old value (7.3): of two
     * requests racing for one offset only one can win. False when the row was not at `from` or no longer uploading.
     */
    async setReceived(id: string, ownerId: string, from: number, to: number): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set received_bytes = ${to}::bigint
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and j.status = 'uploading' and j.received_bytes = ${from}::bigint returning j.id`,
      );
      return done.length === 1;
    },

    /** The last chunk's move: uploading to scanning, the whole archive stored, uploaded_at (7.3). */
    async completeUpload(id: string, ownerId: string, from: number): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'scanning', received_bytes = j.declared_bytes, uploaded_at = clock_timestamp()
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and j.status = 'uploading' and j.received_bytes = ${from}::bigint returning j.id`,
      );
      return done.length === 1;
    },

    /** The first chunk is not an archive of the source (7.3): the upload ends as failed with its code. */
    async failUpload(id: string, ownerId: string, failure: "tar_gz" | "not_an_archive"): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'failed', failure = ${failure}, ended_at = clock_timestamp()
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and j.status = 'uploading' returning j.id`,
      );
      return done.length === 1;
    },

    /**
     * The person's cancel (9.2) from uploading, scanning or ready, in one statement: out of scanning it sets scanned_at,
     * out of ready it cuts the scan down (decision 25), as the guard requires of each. False when the import is in no
     * state a cancel leaves.
     */
    async cancel(id: string, ownerId: string): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'cancelled', ended_at = clock_timestamp(),
                   scanned_at = case when j.status = 'scanning' then clock_timestamp() else j.scanned_at end,
                   scan = case when j.status = 'ready' then ${CUT_SCAN} else j.scan end
             where j.id = ${id}::uuid and j.owner_id = ${ownerId}::uuid and j.status in ('uploading', 'scanning', 'ready') returning j.id`,
      );
      return done.length === 1;
    },

    /** Imports waiting for their scan, with what the intake needs: whether images are on, its creation and when the owner's profile was made. */
    async scanning(): Promise<{ id: string; ownerId: string; images: boolean; createdAt: Date; ownerCreatedAt: Date }[]> {
      const found = await rows<{ id: string; owner_id: string; images: boolean; created_at: Date | string; owner_created_at: Date | string }>(
        db,
        sql`select j.id, j.owner_id, j.images, j.created_at, p.created_at as owner_created_at
              from import_jobs j join profiles p on p.id = j.owner_id where j.status = 'scanning' order by j.created_at, j.id`,
      );
      return found.map((row) => ({ id: row.id, ownerId: row.owner_id, images: row.images, createdAt: new Date(row.created_at), ownerCreatedAt: new Date(row.owner_created_at) }));
    },

    /** A scan's failure (7.5 step 1): scanning to failed, with its code. False when the import left scanning meanwhile. */
    async failScan(id: string, failure: ImportFailure, now: Date): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'failed', failure = ${failure}, scanned_at = ${now.toISOString()}::timestamptz, ended_at = ${now.toISOString()}::timestamptz
             where j.id = ${id}::uuid and j.status = 'scanning' returning j.id`,
      );
      return done.length === 1;
    },

    /** The intake's end (7.5 step 2): scanning to ready, with its numbers. False when the import left scanning meanwhile. */
    async toReady(id: string, scan: ImportScanFacts, now: Date): Promise<boolean> {
      const done = await rows<{ id: string }>(
        db,
        sql`update import_jobs j set status = 'ready', scan = ${JSON.stringify(scan)}::jsonb, scanned_at = ${now.toISOString()}::timestamptz
             where j.id = ${id}::uuid and j.status = 'scanning' returning j.id`,
      );
      return done.length === 1;
    },

    /** 4.8: an upload not complete 24 hours after its creation expires. The ids, whose parts go. */
    expireUploads: (now: Date) =>
      ids(sql`update import_jobs j set status = 'expired', ended_at = ${now.toISOString()}::timestamptz
               where j.status = 'uploading' and j.created_at <= ${now.toISOString()}::timestamptz - make_interval(hours => ${IMPORT_RULES.archiveHours}::int) returning j.id`),

    /**
     * 4.8: a scan not done 45 minutes after the upload ended, or 24 hours after the import was created if that is sooner,
     * fails as scan_timed_out. The ids, whose archive and work folder go.
     */
    timeOutScans: (now: Date) =>
      ids(sql`update import_jobs j set status = 'failed', failure = 'scan_timed_out', scanned_at = ${now.toISOString()}::timestamptz, ended_at = ${now.toISOString()}::timestamptz
               where j.status = 'scanning'
                 and (j.uploaded_at <= ${now.toISOString()}::timestamptz - make_interval(mins => ${IMPORT_RULES.scanMinutes}::int)
                      or j.created_at <= ${now.toISOString()}::timestamptz - make_interval(hours => ${IMPORT_RULES.archiveHours}::int))
               returning j.id`),

    /** 4.8: a preview not confirmed 24 hours after the scan ended expires, its scan cut down. The ids, whose work folder goes. */
    expirePreviews: (now: Date) =>
      ids(sql`update import_jobs j set status = 'expired', ended_at = ${now.toISOString()}::timestamptz, scan = ${CUT_SCAN}
               where j.status = 'ready' and j.scanned_at <= ${now.toISOString()}::timestamptz - make_interval(hours => ${IMPORT_RULES.previewHours}::int)
               returning j.id`),

    /**
     * 4.8: an import that has not finished 72 hours after its scan ended stops (time_ran_out), its seed cleared;
     * published posts stay. The ids, whose work folder goes.
     */
    stopTimedOut: (now: Date) =>
      ids(sql`update import_jobs j set status = 'stopped', stop_reason = 'time_ran_out', seed = null, ended_at = ${now.toISOString()}::timestamptz
               where j.status in ('preparing', 'publishing') and j.scanned_at <= ${now.toISOString()}::timestamptz - make_interval(hours => ${IMPORT_RULES.workHours}::int)
               returning j.id`),

    /**
     * 7.5 step 7: the picks of every import that has ended, and the rows of imports that ended more than 30 days ago and
     * that no post names (a post's import_job_id holds its row, 6.1; the purge clears a deleted post's). A row in an
     * active state or undoing is never one of them, so import_jobs_delete has nothing to refuse.
     */
    async retention(now: Date): Promise<{ picks: number; rows: number }> {
      const picks = await rows<{ ref: number }>(
        db,
        sql`delete from import_picks p using import_jobs j where j.id = p.import_job_id and j.status in ${ENDED} returning p.ref`,
      );
      const gone = await rows<{ id: string }>(
        db,
        sql`delete from import_jobs j
             where j.status in ('done', 'stopped', 'undone', 'failed', 'cancelled', 'expired')
               and j.ended_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${IMPORT_RULES.recordDays}::int)
               and not exists (select 1 from posts p where p.import_job_id = j.id)
            returning j.id`,
      );
      return { picks: picks.length, rows: gone.length };
    },

    /** The state of each of these imports that has a row (7.5 step 8 judges files by it). */
    async statuses(of: readonly string[]): Promise<Map<string, ImportStatus>> {
      if (of.length === 0) return new Map();
      const found = await rows<{ id: string; status: ImportStatus }>(
        db,
        sql`select j.id, j.status::text as status from import_jobs j where j.id = any(string_to_array(${of.join(",")}, ',')::uuid[])`,
      );
      return new Map(found.map((row) => [row.id, row.status]));
    },

    /**
     * A pick (4.4) written or changed: the first write takes the line's facts with it (migration 0046), a later one changes
     * only whether the line is left out and its descriptions. import_picks_guard refuses it unless the import is ready,
     * which the caller answers wrong_state.
     */
    async upsertPick(jobId: string, pick: PickRow): Promise<void> {
      await db.execute(sql`
        insert into import_picks (import_job_id, ref, left_out, alts, month, marks, described)
        values (${jobId}::uuid, ${pick.ref}::int, ${pick.leftOut}, ${pick.alts === null ? null : JSON.stringify(pick.alts)}::jsonb, ${pick.month}, ${pick.marks}::smallint, ${pick.described}::smallint)
        on conflict (import_job_id, ref) do update set left_out = excluded.left_out, alts = excluded.alts`);
    },

    /** The picks of an import, all of them or those of these lines. */
    async picks(jobId: string, refs?: readonly number[]): Promise<PickRow[]> {
      const only = refs === undefined ? sql`` : sql` and p.ref = any(string_to_array(${refs.join(",")}, ',')::int[])`;
      if (refs !== undefined && refs.length === 0) return [];
      const found = await rows<{ ref: number; left_out: boolean; alts: (string | null)[] | null; month: string; marks: number; described: number }>(
        db,
        sql`select p.ref, p.left_out, p.alts, p.month, p.marks, p.described from import_picks p where p.import_job_id = ${jobId}::uuid${only} order by p.ref`,
      );
      return found.map((row) => ({ ref: row.ref, leftOut: row.left_out, alts: row.alts, month: row.month, marks: row.marks, described: row.described }));
    },
  };
}

export type ImportRepo = ReturnType<typeof createImportRepo>;
