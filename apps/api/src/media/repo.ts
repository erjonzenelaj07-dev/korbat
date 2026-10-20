import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { ALERT_KINDS, AUTOMATION_RULES, EDGE_RULES, mediaPath, type EdgePurgeView } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { WRITE_CLOCK, closingJudgment, liveNotSuspended } from "../lib/standing";
import { MediaError, type PostImage } from "./context";
import type { ReceivedHashes } from "./files";

/**
 * Every SQL statement on post_media lives in this module's repository, on the korbat_api pool, and so does every
 * statement on media_holds, a case's evidence holds on image rows (3c design, section 5).
 *
 * Two rules of the database shape what is written here (3c design, section 6.1). The trigger post_media_keep decides for
 * every delete whether a row goes: it skips a row a hold retains and every row of a frozen post, so no delete below
 * filters for either, and each answers only the ids of the rows that are really gone, which are the only files a caller
 * may ask the worker to delete. And every statement that locks or deletes several image rows takes them in id order, so
 * that no two transactions ever lock one post's images in opposite orders.
 */

export interface MediaRow {
  id: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  postId: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: Date;
  /** The image's own moderation state, which only a migrator-owned function writes. A sealed image is shown to nobody. */
  moderationState: "visible" | "withheld" | "removed" | "sealed";
}

/** One hold request of an intake: a post whose images the case holds as evidence, or an account whose images are only locked. */
export type HoldPair = { caseId: string; postId: string } | { ownerId: string };

/** An image as a case's snapshot lists it. The alt text is null for an image whose content was erased. */
export interface HeldImage {
  id: string;
  alt: string | null;
  width: number;
  height: number;
}

/** What a case about a post or an account reaches: counts, a day and a time, never an id, an alt text or a file. */
export interface CaseReach {
  /** The posts the case reaches that have image rows. */
  posts: number;
  images: number;
  sealed: number;
  /** The images korbat's server would still give to some reader. */
  served: number;
  /** The creation day, in UTC, of the newest post with image rows. */
  newestPostOn: string | null;
  /** When the newest post with a served image was created. */
  newestServedAt: Date | null;
}

/** Ids as one uuid[] parameter. */
const uuidArray = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** 3d Task 7: no row of upload_refusals names the image. A held or refused upload is in no reader and no export. */
const NOT_REFUSED = sql`not exists (select 1 from public.upload_refusals r where r.media_id = ${postMedia.id})`;

/**
 * An image the data export hands its owner: ready, in a state its author still sees (a sealed image is exported to
 * nobody, and a state this reader has not been taught is left out), not erased, and either on no post or on a post that
 * is neither deleted, nor disabled for an authority's order, nor erased. A row that a case or a freeze kept after its
 * post was deleted is in no export. The query it is used in joins posts by the image's post.
 *
 * 3f (design, W.7 and 7.10): an order disables the post and leaves its images' own states as they were, so the post's
 * state is the only mark; the export leaves the files out as it leaves the post out, held notice or told.
 */
const EXPORTABLE = and(
  eq(postMedia.status, "ready"),
  inArray(postMedia.moderationState, ["visible", "withheld", "removed"]),
  isNull(postMedia.erasedAt),
  or(isNull(postMedia.postId), and(ne(posts.state, "deleted_by_author"), ne(posts.state, "disabled"), isNull(posts.erasedAt))),
  // 3d Task 7 (design, sections 5 and 7.8 step 5; review ruling 5): an image that a refusal names, whatever the hold's end,
  // is in no export for as long as its row lives.
  NOT_REFUSED,
);

/**
 * A row the disposal may take (3c design, section 7.9): nothing retains it (no hold stands, and its post is not frozen),
 * and its post is deleted, its owner is purged, or its post's content or its own was erased. `m` is the image row, `p`
 * its post when it has one, `o` its owner's profile. The freeze is read here only to keep kept rows out of a batch: for
 * each row that is deleted, post_media_keep decides.
 *
 * The marks and the freeze are one condition, a CASE that reads the freeze only for a row that carries a mark. As two
 * conditions the planner made the freeze the filter of the scan of post_media, since it names that table alone, and
 * called it for every attached image row in the table before any mark was tested: several index probes a row, seconds
 * for a table of thousands, however few rows were disposable. A CASE is evaluated in the order it is written, and this
 * one names all three tables, so it runs where they are joined.
 */
const DISPOSABLE = sql`(m.hold_until is null or m.hold_until <= now())
  and case when (p.state = 'deleted_by_author' or o.deleted_at is not null or p.erased_at is not null or m.erased_at is not null)
           then (m.post_id is null or not public.post_frozen(m.post_id))
           else false end`;

const columns = {
  id: postMedia.id,
  ownerId: postMedia.ownerId,
  status: postMedia.status,
  error: postMedia.error,
  postId: postMedia.postId,
  width: postMedia.width,
  height: postMedia.height,
  blurhash: postMedia.blurhash,
  createdAt: postMedia.createdAt,
  moderationState: postMedia.moderationState,
};

/** The code a trigger raised (SQLSTATE P0001), or null: drizzle wraps the driver's error as a cause. */
function raisedCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function createMediaRepo(db: Db) {
  return {
    /** 3d Task 7: the pool this repository runs on, from which the statements on the known material's tables are built. */
    pool: db,

    /** When the account was onboarded, which decides its upload tier. */
    async accountCreatedAt(userId: string): Promise<Date | null> {
      const rows = await db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return rows[0]?.createdAt ?? null;
    },

    /** Uploads of this account that are not on a post yet and did not fail. */
    async pendingCount(ownerId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"]), NOT_REFUSED));
      return rows[0]?.count ?? 0;
    },

    /**
     * The upload's row, as one statement that locks its owner's profile row FOR KEY SHARE and inserts only when the one
     * predicate holds (3e design, section 7.2): read in the statement that locks the row, by the clock. No row inserted
     * answers account_suspended, and the caller discards the received file. The statement's lock may wait for a holder
     * that only locks the row, which leaves its judgment as it was before the wait, so the transaction ends with the
     * closing judgment of the owner (3e's review): a deleted or suspended owner then rolls the insert back, answered
     * account_suspended as the statement answers both.
     */
    async insertProcessing(input: { id: string; ownerId: string; now: Date; hashes?: ReceivedHashes | undefined }): Promise<void> {
      await db.transaction(async (tx) => {
        const inserted = await tx.execute(sql`
          with ok as (select p.id from profiles p where p.id = ${input.ownerId}::uuid and ${liveNotSuspended("p", WRITE_CLOCK)} for key share of p)
          insert into post_media (id, owner_id, status, created_at)
          select ${input.id}::uuid, ok.id, 'processing', ${input.now.toISOString()}::timestamptz from ok
          returning id`);
        if (inserted.length === 0) throw new MediaError("account_suspended", 403);
        // 3d Task 7 (design, section 7.8 step 1): with the comparison on, the hashes and the pending check are written in
        // the same transaction, so no image row exists without its hashes.
        if (input.hashes !== undefined) {
          await tx.execute(sql`
            insert into public.media_hashes (media_id, sha256, sha1, md5, check_state)
            values (${input.id}::uuid, ${input.hashes.sha256}::bytea, ${input.hashes.sha1}::bytea, ${input.hashes.md5}::bytea, 'pending')`);
        }
        const judged = await closingJudgment(tx, input.ownerId);
        if (!judged || judged.deleted || judged.suspended) throw new MediaError("account_suspended", 403);
      });
    },

    /**
     * One image row, for its owner's status. Two rules of the readers hold here (3c design, section 7.10): a row that a
     * case or a freeze keeps after its post was deleted, and a row whose content, its own or its post's, was erased, is
     * answered as a row that does not exist, to its owner too, so nothing tells the author that the row was kept; and a
     * sealed image is handed over without its blurhash, which is made from the image.
     */
    async find(id: string): Promise<MediaRow | null> {
      const rows = await db
        .select({ ...columns, erasedAt: postMedia.erasedAt, postState: posts.state, postErasedAt: posts.erasedAt })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      const found = rows[0];
      if (!found || found.postState === "deleted_by_author" || found.erasedAt !== null || found.postErasedAt !== null) return null;
      const { erasedAt: _erasedAt, postState: _postState, postErasedAt: _postErasedAt, ...row } = found;
      return row.moderationState === "sealed" ? { ...row, blurhash: null } : row;
    },

    /**
     * Records the worker's verdict, once. A row that is no longer processing is left as it is. 3d Task 6: with the score
     * the caller kept (from this server's own scorer), in nsfw_score; null leaves the column as it is, null.
     */
    async finalize(id: string, result: ResultFile, score: number | null = null): Promise<boolean> {
      const values =
        result.status === "ready"
          ? { status: "ready" as const, width: result.width, height: result.height, blurhash: result.blurhash, ...(score !== null ? { nsfwScore: score } : {}) }
          : { status: "failed" as const, error: result.reason };
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /**
     * 3d Task 6 (design, section 5, MediaForCases.signals): the ready, unerased images of the post, in position order, each
     * with its score (null when none was stored). It locks nothing. Task 7 adds each one's match record.
     */
    async signals(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, postId: string): Promise<{ mediaId: string; score: number | null }[]> {
      const rows = (await q.execute(sql`
        select m.id, m.nsfw_score from public.post_media m
         where m.post_id = ${postId}::uuid and m.status = 'ready' and m.erased_at is null
         order by m.position, m.id`)) as unknown as { id: string; nsfw_score: number | null }[];
      return rows.map((row) => ({ mediaId: row.id, score: row.nsfw_score === null ? null : Number(row.nsfw_score) }));
    },

    /**
     * 3d Task 6 (design, sections 5 and 7.9, MediaForCases.unsignalled): the sweep's read of images that should have a
     * signal and have none: every ready, unerased image of a post created in the last `hours` hours, the post not deleted
     * by its author, whose score is at or over `threshold` and that no r1_score signal names. The media repository names
     * automated_signals for this one read. At most `limit`, the oldest posts first. Task 7 adds the posted images with a
     * match record not marked handled.
     */
    async unsignalledScores(limit: number, hours: number, threshold: number): Promise<{ mediaId: string; postId: string; score: number }[]> {
      const rows = (await db.execute(sql`
        select m.id, m.post_id, m.nsfw_score from public.post_media m join public.posts p on p.id = m.post_id
         where p.created_at > now() - make_interval(hours => ${hours}::int) and p.state <> 'deleted_by_author'
           and m.status = 'ready' and m.erased_at is null and m.nsfw_score >= ${threshold}::real
           and not exists (select 1 from public.automated_signals s where s.media_id = m.id and s.kind = 'r1_score')
         order by p.created_at, m.id
         limit ${limit}::int`)) as unknown as { id: string; post_id: string; nsfw_score: number }[];
      return rows.map((row) => ({ mediaId: row.id, postId: row.post_id, score: Number(row.nsfw_score) }));
    },

    /**
     * Removes an upload of this account that is not on a post. 3d Task 7 (design, sections 5 and 7.8 step 5): with
     * `keepChecking` (the comparison is on), a row still processing whose check is pending or capped is kept and answered
     * `kept`; the sweeper deletes it once finalize gave it a verdict. A row gate K keeps (a held upload) is `none`.
     */
    async deleteUnattached(id: string, ownerId: string, keepChecking = false): Promise<"deleted" | "kept" | "none"> {
      if (keepChecking) {
        const checking = (await db.execute(sql`
          select 1 from post_media m join public.media_hashes h on h.media_id = m.id
           where m.id = ${id}::uuid and m.owner_id = ${ownerId}::uuid and m.post_id is null and m.status = 'processing'
             and h.check_state in ('pending', 'capped')`)) as unknown as unknown[];
        if (checking.length === 1) return "kept";
      }
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId))).returning({ id: postMedia.id });
      return rows.length === 1 ? "deleted" : "none";
    },

    /**
     * What serving an image file depends on: whether it is ready, its own moderation state, its post's state and author,
     * and whether its content or its post's was erased.
     */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; mediaState: MediaRow["moderationState"]; postState: string | null; authorId: string | null; erased: boolean } | null> {
      const rows = await db
        .select({ status: postMedia.status, mediaState: postMedia.moderationState, postState: posts.state, authorId: posts.authorId, erasedAt: postMedia.erasedAt, postErasedAt: posts.erasedAt })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      const found = rows[0];
      if (!found) return null;
      return { status: found.status, mediaState: found.mediaState, postState: found.postState, authorId: found.authorId, erased: found.erasedAt !== null || found.postErasedAt !== null };
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        let rows: { id: string }[];
        try {
          rows = await tx
            .update(postMedia)
            .set({ postId: input.postId, position, altText: item.alt })
            .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready")))
            .returning({ id: postMedia.id });
        } catch (err) {
          // 3d Task 7 (design, section 7.8 step 5): post_media_refused refuses a refused upload, an erased one and one held
          // for good; the post's transaction rolls back with the media error of that code.
          if (raisedCode(err) === "upload_refused") throw new MediaError("upload_refused", 422);
          throw err;
        }
        if (rows.length !== 1) throw new MediaError("media_unavailable", 400);
      }
    },

    /**
     * Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. The
     * rows are taken in id order, under row locks, with no filter of its own: the keep trigger skips every row a case
     * holds and every row of a frozen post, and RETURNING omits them, so no file of a kept row is asked for. A plain
     * delete by post takes the rows in its scan's order, and deadlocked with an intake that locks the same rows by id.
     */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = (await tx.execute(
        sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /**
     * Removes every image row of the owner, on a post or not, whatever its state, inside the transaction
     * that purges the account, and says which files to delete afterwards (1b design, section 7.6). In id order under
     * row locks and with no filter, as detachAll: the keep trigger decides which rows stay.
     */
    async purgeOwner(tx: DbTx, ownerId: string): Promise<string[]> {
      const rows = (await tx.execute(
        sql`delete from post_media where id in (select id from post_media where owner_id = ${ownerId}::uuid order by id for update) returning id`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /**
     * The images of a page of posts, in one query, in their order on each post, each with its own moderation state:
     * what the state means for a reader is the view builder's to say. A sealed image is its id and its state only:
     * nobody is given its size, its blurhash, its alt text or a path. An image of a deleted post, and one whose content
     * or whose post's was erased, is given to nobody, its owner included, so no view and no export names a row that a
     * case or a freeze kept. A state this reader has not been taught is left out.
     */
    async forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>> {
      const byPost = new Map<string, PostImage[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText, state: postMedia.moderationState })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready"), ne(posts.state, "deleted_by_author"), isNull(postMedia.erasedAt), isNull(posts.erasedAt)))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId) continue;
        let image: PostImage;
        if (row.state === "sealed") image = { id: row.id, state: "sealed" };
        else if (row.state === "visible" || row.state === "withheld" || row.state === "removed") {
          if (row.width === null || row.height === null || row.blurhash === null) continue;
          image = { id: row.id, state: row.state, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        } else {
          // A state added later does not compile until this reader says who is given it.
          const unknown: never = row.state;
          void unknown;
          continue;
        }
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), image]);
      }
      return byPost;
    },

    /**
     * Every image of the account that the data export takes a file for, on a post or not, oldest first: the ready ones
     * the account still sees (EXPORTABLE). A withheld or removed image stays with its author; a sealed image, an image
     * of a deleted post and an erased one are exported to nobody.
     */
    async readyImages(ownerId: string): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(postMedia.ownerId, ownerId), EXPORTABLE))
        .orderBy(postMedia.createdAt, postMedia.id);
      return rows.map((row) => row.id);
    },

    /**
     * Whether readyImages would still list this image of the owner: the export reads the row again when it opens each
     * file, so an image that was sealed, erased or deleted with its post while the archive streams is left out of it.
     */
    async isExportable(ownerId: string, id: string): Promise<boolean> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), EXPORTABLE))
        .limit(1);
      return rows.length === 1;
    },

    /**
     * Uploads that still wait for the worker's verdict. 3d Task 7: not one whose check is capped, which waits for
     * match-retry to ask the source again, so the sweeper's round never asks it every thirty seconds.
     */
    async processingIds(): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .where(and(eq(postMedia.status, "processing"), sql`not exists (select 1 from public.media_hashes h where h.media_id = ${postMedia.id} and h.check_state = 'capped')`))
        .orderBy(postMedia.createdAt);
      return rows.map((row) => row.id);
    },

    /**
     * Fails uploads the worker has not answered since `before`, and says which. 3d Task 7 (design, section 7.8 step 3): a
     * capped upload is exempt while it is younger than AUTOMATION_RULES.matchRetryHours; after that it fails as any.
     */
    async failStale(before: Date): Promise<string[]> {
      const rows = await db
        .update(postMedia)
        .set({ status: "failed", error: "processing_failed" })
        .where(
          and(
            eq(postMedia.status, "processing"),
            lt(postMedia.createdAt, before),
            sql`not exists (select 1 from public.media_hashes h where h.media_id = ${postMedia.id} and h.check_state = 'capped'
                                and ${postMedia.createdAt} > now() - make_interval(hours => ${AUTOMATION_RULES.matchRetryHours}::int))`,
          ),
        )
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** Removes uploads made before `before` that were never put on a post, whatever their state, and says which. */
    async deleteUnattachedBefore(before: Date): Promise<string[]> {
      const rows = await db.delete(postMedia).where(and(isNull(postMedia.postId), lt(postMedia.createdAt, before))).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /**
     * Which of these ids have a row, whatever the row's state: the reconcile pass asks it which stored files belong to
     * no row, so a row that a hold or a freeze keeps must be seen here, or its files would be swept as orphans.
     */
    async existing(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(inArray(postMedia.id, [...ids]));
      return new Set(rows.map((row) => row.id));
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },

    // ------------------------------------------------------------ what moderation cases need

    /**
     * An intake's holds (3c design, sections 5 and 7.1, step 4), inside the intake's transaction. First one statement
     * locks, FOR KEY SHARE and in one id order, every image row the pairs name: the rows of each post and, for an owner
     * pair, every row of that owner that is on a post (an attached row's owner is its post's author, so those are the
     * images of the account's posts). The posts are read there, never locked. The lock is what makes a delete that races
     * the intake wait and then read the intake's committed item; a row whose delete committed first is not returned.
     * Then, for the post pairs only, the case's hold goes on each returned row that has no unreleased hold from that case
     * and is not erased, in id order, which is the order the holds are released in: an owner pair gets no hold, since the
     * images of a frozen post are kept whether a hold stands or not. It answers, for each post pair, the post's images
     * in position order, an erased one without its alt text; an empty list means the images are gone.
     */
    async hold(tx: DbTx, pairs: readonly HoldPair[]): Promise<Map<string, HeldImage[]>> {
      const caseOf = new Map<string, string>();
      const owners: string[] = [];
      for (const pair of pairs) {
        if ("postId" in pair) caseOf.set(pair.postId, pair.caseId);
        else owners.push(pair.ownerId);
      }
      const held = new Map<string, HeldImage[]>([...caseOf.keys()].map((postId) => [postId, []]));
      if (caseOf.size === 0 && owners.length === 0) return held;

      const locked = (await tx.execute(sql`
        select m.id, m.post_id, m.position, m.width, m.height, m.alt_text, (m.erased_at is not null or p.erased_at is not null) as erased
        from post_media m join posts p on p.id = m.post_id
        where m.post_id = any(${uuidArray([...caseOf.keys()])}) or m.owner_id = any(${uuidArray(owners)})
        order by m.id for key share of m`)) as unknown as { id: string; post_id: string; position: number; width: number; height: number; alt_text: string | null; erased: boolean }[];

      // The rows came back in id order; the holds are placed in that order too.
      const toHold = locked.filter((row) => caseOf.has(row.post_id) && !row.erased);
      if (toHold.length > 0) {
        await tx.execute(sql`
          insert into media_holds (media_id, case_id)
          select v.media_id, v.case_id
          from unnest(${uuidArray(toHold.map((row) => row.id))}, ${uuidArray(toHold.map((row) => caseOf.get(row.post_id)!))}) as v(media_id, case_id)
          where not exists (select 1 from media_holds h where h.media_id = v.media_id and h.case_id = v.case_id and h.released_at is null)
          order by v.media_id`);
      }

      for (const row of [...locked].sort((a, b) => a.position - b.position)) {
        held.get(row.post_id)?.push({ id: row.id, alt: row.erased ? null : (row.alt_text ?? ""), width: row.width, height: row.height });
      }
      return held;
    },

    /**
     * What a case about this post or this account reaches (3c design, section 6.1): the post itself, or every post
     * whose author is the account, whatever its state. One statement that locks nothing.
     */
    async reach(target: { type: "post" | "account"; id: string }): Promise<CaseReach> {
      // 3f (design, section 7.10): no reader serves an image of a post disabled for an order, whatever the image's own state.
      const served = sql`m.moderation_state <> 'sealed' and p.state <> 'deleted_by_author' and p.state::text <> 'disabled' and m.erased_at is null and p.erased_at is null`;
      const reached = target.type === "post" ? sql`m.post_id = ${target.id}::uuid` : sql`p.author_id = ${target.id}::uuid`;
      const [row] = (await db.execute(sql`
        select count(distinct m.post_id)::int as posts,
               count(*)::int as images,
               (count(*) filter (where m.moderation_state = 'sealed'))::int as sealed,
               (count(*) filter (where ${served}))::int as served,
               to_char(max(p.created_at) at time zone 'UTC', 'YYYY-MM-DD') as newest_post_on,
               to_char(max(p.created_at) filter (where ${served}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as newest_served_at
        from post_media m join posts p on p.id = m.post_id
        where ${reached}`)) as unknown as { posts: number; images: number; sealed: number; served: number; newest_post_on: string | null; newest_served_at: string | null }[];
      return {
        posts: row!.posts,
        images: row!.images,
        sealed: row!.sealed,
        served: row!.served,
        newestPostOn: row!.newest_post_on,
        newestServedAt: row!.newest_served_at === null ? null : new Date(row!.newest_served_at),
      };
    },

    /**
     * What opening an image for staff depends on, in one query: the row with its post, its size and its own state,
     * whether its content or its post's was erased, and whether its post is frozen now. Null when no row has the id or
     * the image is on no post.
     */
    async staffAccess(id: string): Promise<{ postId: string; status: MediaRow["status"]; width: number | null; height: number | null; mediaState: MediaRow["moderationState"]; erased: boolean; frozen: boolean; matched: boolean } | null> {
      // 3d Task 7 (design, sections 5 and 7.11; review ruling 2): also whether an unerased match record names the image,
      // an acting match or a flag, which shuts gate V for it on every case, whatever was answered.
      const [row] = (await db.execute(sql`
        select m.post_id, m.status, m.width, m.height, m.moderation_state, (m.erased_at is not null or p.erased_at is not null) as erased, public.post_frozen(m.post_id) as frozen,
               exists (select 1 from public.media_matches x where x.media_id = m.id and x.erased_at is null) as matched
        from post_media m join posts p on p.id = m.post_id
        where m.id = ${id}::uuid`)) as unknown as { post_id: string; status: MediaRow["status"]; width: number | null; height: number | null; moderation_state: MediaRow["moderationState"]; erased: boolean; frozen: boolean; matched: boolean }[];
      if (!row) return null;
      return { postId: row.post_id, status: row.status, width: row.width, height: row.height, mediaState: row.moderation_state, erased: row.erased, frozen: row.frozen, matched: row.matched };
    },

    /**
     * A page of the image rows that are on a post, in id order after `afterId` (from the start when it is null): each
     * one's id, its post, its stored moderation state and when its content was erased. It locks nothing and gives nothing
     * of an image itself. The staff command line's text-verify reads every such row through it, a page at a time, to
     * hold the stored states to what the ledger of measures says they must be.
     */
    /**
     * 3f (design, section 7.4): the post an image's address belongs to, or null when no attached image row has the id. An
     * order that names a picture's address names its post; this is a read, and it holds no row.
     */
    async imagePost(q: Pick<Db, "select"> | Pick<DbTx, "select">, mediaId: string): Promise<string | null> {
      const [row] = await q.select({ postId: postMedia.postId }).from(postMedia).where(and(eq(postMedia.id, mediaId), isNotNull(postMedia.postId))).limit(1);
      return row?.postId ?? null;
    },

    /** 3f (design, section 7.5): how many image rows each of these posts holds, for an order's screen; a post with none is left out. */
    async imageCounts(q: Pick<Db, "select"> | Pick<DbTx, "select">, postIds: readonly string[]): Promise<Map<string, number>> {
      if (postIds.length === 0) return new Map();
      const found = await q
        .select({ postId: postMedia.postId, count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(inArray(postMedia.postId, [...postIds]))
        .groupBy(postMedia.postId);
      return new Map(found.map((row) => [row.postId!, row.count]));
    },

    /**
     * 3f (design, sections 5 and 7.11): a post's image rows as staff.js order-access prints them for a preserved post: the
     * id, the pixel size and when the row was made, in position order. The table holds no digest of a file, and no file
     * is opened here.
     */
    async preservedImages(q: Pick<Db, "select"> | Pick<DbTx, "select">, postId: string): Promise<{ id: string; width: number | null; height: number | null; createdAt: Date }[]> {
      return q
        .select({ id: postMedia.id, width: postMedia.width, height: postMedia.height, createdAt: postMedia.createdAt })
        .from(postMedia)
        .where(eq(postMedia.postId, postId))
        .orderBy(postMedia.position, postMedia.id);
    },

    /**
     * 3f (design, section 7.14): for each post a seal lists (seal_posts), the ids of its image rows now, in their order.
     * Read-only, through the caller's transaction; handover-list compares their number with what the seal recorded.
     */
    async sealImageRows(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, sealActionId: string): Promise<{ postId: string; mediaIds: string[] }[]> {
      const found = await q.execute<{ post_id: string; media_id: string | null }>(
        sql`select s.post_id, m.id as media_id from public.seal_posts s left join public.post_media m on m.post_id = s.post_id
             where s.action_id = ${sealActionId}::uuid order by s.post_id, m.position, m.id`,
      );
      const byPost = new Map<string, string[]>();
      for (const row of found) {
        const ids = byPost.get(row.post_id) ?? [];
        if (row.media_id !== null) ids.push(row.media_id);
        byPost.set(row.post_id, ids);
      }
      return [...byPost].map(([postId, mediaIds]) => ({ postId, mediaIds }));
    },

    /**
     * 3d (design, sections 6.1 and 7.1): whether a file of the image is in the quarantine without an end (it is being
     * restored), and whether one is recorded as lost, through the two functions the API's role may call; the table itself
     * is closed to it. Asked only for a visible image whose file is missing from the store.
     */
    async custody(id: string): Promise<{ quarantined: boolean; lost: boolean }> {
      const [row] = (await db.execute(sql`select public.media_quarantined(${id}::uuid) as quarantined, public.media_lost(${id}::uuid) as lost`)) as unknown as { quarantined: boolean; lost: boolean }[];
      return { quarantined: row!.quarantined, lost: row!.lost };
    },

    /**
     * 3d: up to `limit` images whose files the quarantine's record says are lost and whose author is owed the notice
     * (lost_untold), the earliest first, each with its owner and its post's creation time when the image row and the post
     * are still there (null otherwise: nobody is left to tell).
     */
    async lostUntold(limit: number): Promise<{ mediaId: string; lostAt: Date; ownerId: string | null; postCreatedAt: Date | null }[]> {
      const found = (await db.execute(sql`
        select l.media_id, l.lost_at, m.owner_id, p.created_at as post_created_at
          from public.lost_untold(${limit}) l
          left join post_media m on m.id = l.media_id
          left join posts p on p.id = m.post_id
         order by l.lost_at, l.media_id`)) as unknown as { media_id: string; lost_at: Date | string; owner_id: string | null; post_created_at: Date | string | null }[];
      return found.map((row) => ({ mediaId: row.media_id, lostAt: new Date(row.lost_at), ownerId: row.owner_id, postCreatedAt: row.post_created_at === null ? null : new Date(row.post_created_at) }));
    },

    /** 3d: records the outcome of a lost image's notice (lost_told), which changes the image's rows only from pending. */
    async lostTold(mediaId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void> {
      await db.execute(sql`select public.lost_told(${mediaId}::uuid, ${outcome}::delivery_state)`);
    },

    /**
     * 3d (design, sections 6.1, 7.1 and 8.10): quarantine_plan() as staff.js quarantine-list reads it, through the caller's
     * transaction, which reads as the migrator (the function is executable by nobody else). For each image of the plan:
     * its direction, its post (the image row's, or for an image row that is gone the post its quarantine rows recorded),
     * the names of its files whose rows have no end, and of those whose rows are neither returned nor destroyed (a lost
     * file is among them: there is nothing of it to move).
     */
    async quarantinePlan(q: Pick<Db, "execute"> | Pick<DbTx, "execute">): Promise<{ direction: string; mediaId: string; postId: string | null; open: string[]; kept: string[] }[]> {
      const found = (await q.execute(sql`
        select p.direction, p.media_id,
               coalesce(m.post_id, (select min(f.post_id::text)::uuid from public.quarantine_files f where f.media_id = p.media_id)) as post_id,
               coalesce((select array_agg(f.file order by f.file) from public.quarantine_files f
                          where f.media_id = p.media_id and f.returned_at is null and f.destroyed_at is null and f.lost_at is null), '{}') as open,
               coalesce((select array_agg(f.file order by f.file) from public.quarantine_files f
                          where f.media_id = p.media_id and f.returned_at is null and f.destroyed_at is null), '{}') as kept
          from public.quarantine_plan() p
          left join post_media m on m.id = p.media_id
         order by p.direction, p.media_id`)) as unknown as { direction: string; media_id: string; post_id: string | null; open: string[]; kept: string[] }[];
      return found.map((row) => ({ direction: row.direction, mediaId: row.media_id, postId: row.post_id, open: row.open, kept: row.kept }));
    },

    /**
     * 3d: for every post sealed for good (a seal_media in force whose decision is not interim) and not released (Task 2:
     * a released post's rows are erased and then dropped by the disposal, while its seal still lists it), its image rows
     * now, erased or not, and the counts that each such seal recorded for it in seal_posts, which quarantine-list compares.
     * Through the caller's transaction.
     */
    async sealedForGoodCounts(q: Pick<Db, "execute"> | Pick<DbTx, "execute">): Promise<{ postId: string; rows: number; images: number[] }[]> {
      const found = (await q.execute(sql`
        select s.post_id, array_agg(distinct s.images::int) as images,
               (select count(*)::int from post_media m where m.post_id = s.post_id) as rows
          from public.seal_posts s join public.measures_in_force f on f.id = s.action_id
         where f.kind = 'seal_media' and f.decision_kind <> 'interim'
           and not exists (select 1 from public.release_posts r where r.post_id = s.post_id)
         group by s.post_id
         order by s.post_id`)) as unknown as { post_id: string; rows: number; images: number[] }[];
      return found.map((row) => ({ postId: row.post_id, rows: row.rows, images: row.images }));
    },

    /**
     * 3d Task 2 (sections 5 and 8.10): text-verify's first read of the release. The images of the quarantine whose file
     * still lies there (a row without an end), not marked unknown, whose image row is gone and whose post is not released:
     * a file korbat holds of an image it no longer has, which no release accounts for. Through the caller's transaction,
     * which reads as the migrator: quarantine_files is closed to the API's role.
     */
    async quarantineOrphans(q: Pick<Db, "execute"> | Pick<DbTx, "execute">): Promise<{ mediaId: string; postId: string | null }[]> {
      const found = (await q.execute(sql`
        select f.media_id, min(f.post_id::text)::uuid as post_id from public.quarantine_files f
         where f.returned_at is null and f.destroyed_at is null and f.lost_at is null and not f.unknown and f.release_id is null
           and not exists (select 1 from post_media m where m.id = f.media_id)
           and not exists (select 1 from public.release_posts r where r.post_id = f.post_id)
         group by f.media_id order by f.media_id`)) as unknown as { media_id: string; post_id: string | null }[];
      return found.map((row) => ({ mediaId: row.media_id, postId: row.post_id }));
    },

    /**
     * 3d Task 2: text-verify's second read. The released posts that still hold an image row without erased_at: the release
     * erases every row of its posts in its own transaction, and a replay does the same, so such a row means a write around
     * them. Through the caller's transaction; the API's role reads both tables.
     */
    async releasedUnerased(q: Pick<Db, "execute"> | Pick<DbTx, "execute">): Promise<{ postId: string; images: number }[]> {
      const found = (await q.execute(sql`
        select r.post_id, count(*)::int as images from public.release_posts r join post_media m on m.post_id = r.post_id
         where m.erased_at is null group by r.post_id order by r.post_id`)) as unknown as { post_id: string; images: number }[];
      return found.map((row) => ({ postId: row.post_id, images: row.images }));
    },

    // ------------------------------------------------------------ the edge's outbox (3d design, sections 6.3 and 7.4)
    // Only the two triggers of 0035_edge_purges write a row of edge_purges; the API's role reads them, moves the four
    // columns of a purge's progress, and (Task 8) deletes a row done 30 days ago. Every time is the database's.

    /** The adapter is off: every row still owed a purge closes as off at once, and nothing is sent. Answers how many. */
    async edgeOff(): Promise<number> {
      const closed = await db.execute(sql`update public.edge_purges set outcome = 'off', done_at = now() where done_at is null returning id`);
      return closed.length;
    },

    /**
     * The rows one round reads: up to `limit` images whose oldest open row is due now, the oldest first, and every open row
     * of those images, in the order of their images and then of their ids. A row written after this read is not among
     * them, whatever its id, so a round closes no row it did not read.
     */
    async edgeDue(limit: number): Promise<{ id: string; mediaId: string }[]> {
      const rows = await db.execute<{ id: string; media_id: string }>(sql`
        with images as (
          select e.media_id, min(e.id) as first from public.edge_purges e
           where e.done_at is null and e.next_at <= now()
           group by e.media_id
           order by min(e.id)
           limit ${limit})
        select e.id::text as id, e.media_id from public.edge_purges e join images i on i.media_id = e.media_id
         where e.done_at is null
         order by i.first, e.id`);
      return rows.map((row) => ({ id: row.id, mediaId: row.media_id }));
    },

    /** The provider took the purge: these rows, the ones a round read, close as accepted. Answers how many. */
    async edgeAccepted(ids: readonly string[]): Promise<number> {
      const closed = await db.execute(sql`update public.edge_purges set outcome = 'accepted', done_at = now() where id = any(${`{${ids.join(",")}}`}::bigint[]) and done_at is null returning id`);
      return closed.length;
    },

    /**
     * The purge was not taken: each of these rows counts an attempt and is due again EDGE_RULES.backoffSeconds later,
     * doubled for each attempt before, at most EDGE_RULES.backoffMaxSeconds; a row written EDGE_RULES.giveUpHours ago or
     * earlier is given up, as failed. Answers how many were given up and the oldest time among them.
     */
    async edgeFailed(ids: readonly string[]): Promise<{ gaveUp: number; oldestAt: string | null }> {
      const giveUp = sql`e.created_at <= now() - make_interval(hours => ${EDGE_RULES.giveUpHours}::int)`;
      const [row] = await db.execute<{ gave_up: number; oldest_at: string | null }>(sql`
        with failed as (
          update public.edge_purges e
             set attempts = e.attempts + 1,
                 next_at = now() + make_interval(secs => least(${EDGE_RULES.backoffSeconds}::int * power(2, e.attempts), ${EDGE_RULES.backoffMaxSeconds}::int)),
                 outcome = case when ${giveUp} then 'failed' end,
                 done_at = case when ${giveUp} then now() end
           where e.id = any(${`{${ids.join(",")}}`}::bigint[]) and e.done_at is null
          returning e.outcome, e.created_at)
        select (count(*) filter (where outcome = 'failed'))::int as gave_up,
               to_char(min(created_at) filter (where outcome = 'failed') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as oldest_at
          from failed`);
      return { gaveUp: row!.gave_up, oldestAt: row!.oldest_at };
    },

    /**
     * The job's own alert edge_purge_failed (3d design, section 7.14, "Alerts a job writes"): one row of the outbox of
     * alerts with its kind's priority and scope and its facts, counts and times only, under F's daily rule: none while a
     * row of the kind was written in the last 24 hours. F's two legs push and mail it. Answers whether it wrote one.
     */
    async edgeAlert(facts: { count: number; oldestAt: string }): Promise<boolean> {
      const entry = ALERT_KINDS.edge_purge_failed;
      const written = await db.execute(sql`
        insert into public.alert_outbox (kind, priority, scope, facts)
        select 'edge_purge_failed', ${entry.priority}, ${entry.scope}, ${JSON.stringify(facts)}::jsonb
         where not exists (select 1 from public.alert_outbox o where o.kind = 'edge_purge_failed' and o.created_at > now() - make_interval(hours => 24))
        returning id`);
      return written.length > 0;
    },

    /**
     * For each of these images that has an outbox row, in the order given, its newest row as staff read it (3d design,
     * section 10.3): its outcome, or pending while it has none, and when it was done, or written while it is pending. An
     * image with no row never stopped being public and gets no entry.
     */
    async purges(mediaIds: readonly string[]): Promise<EdgePurgeView[]> {
      if (mediaIds.length === 0) return [];
      const rows = await db.execute<{ media_id: string; outcome: EdgePurgeView["outcome"] | null; at: string }>(sql`
        select distinct on (e.media_id) e.media_id, e.outcome, to_char(coalesce(e.done_at, e.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
          from public.edge_purges e
         where e.media_id = any(${uuidArray(mediaIds)})
         order by e.media_id, e.id desc`);
      const newest = new Map(rows.map((row) => [row.media_id, row]));
      return mediaIds.flatMap((id) => {
        const row = newest.get(id);
        return row ? [{ mediaId: id, outcome: row.outcome ?? "pending", at: row.at }] : [];
      });
    },

    /** The same for every image row of these posts, erased or not, by post, in their order on the post: an order's items. */
    async postPurges(postIds: readonly string[]): Promise<Map<string, EdgePurgeView[]>> {
      const byPost = new Map<string, EdgePurgeView[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db.execute<{ post_id: string; media_id: string; outcome: EdgePurgeView["outcome"] | null; at: string }>(sql`
        select m.post_id, m.id as media_id, e.outcome, to_char(coalesce(e.done_at, e.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
          from post_media m
          join lateral (select x.outcome, x.done_at, x.created_at from public.edge_purges x where x.media_id = m.id order by x.id desc limit 1) e on true
         where m.post_id = any(${uuidArray(postIds)})
         order by m.post_id, m.position, m.id`);
      for (const row of rows) byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), { mediaId: row.media_id, outcome: row.outcome ?? "pending", at: row.at }]);
      return byPost;
    },

    async moderationStates(afterId: string | null, limit: number): Promise<{ id: string; postId: string; moderationState: MediaRow["moderationState"]; erasedAt: Date | null }[]> {
      const found = await db
        .select({ id: postMedia.id, postId: postMedia.postId, moderationState: postMedia.moderationState, erasedAt: postMedia.erasedAt })
        .from(postMedia)
        .where(and(isNotNull(postMedia.postId), afterId === null ? undefined : gt(postMedia.id, afterId)))
        .orderBy(postMedia.id)
        .limit(limit);
      return found.map((row) => ({ id: row.id, postId: row.postId!, moderationState: row.moderationState, erasedAt: row.erasedAt }));
    },

    /**
     * Deletes at most `limit` disposable rows (DISPOSABLE), the lowest ids first, inside the caller's transaction, and
     * answers the ids of the rows that are gone, in id order. The candidates are locked in id order inside the delete,
     * so the disposal and an intake's hold never lock one post's images in opposite orders; a candidate that another
     * transaction is making retained is waited for, checked again and skipped, and the batch is filled from the next ids.
     * The keep trigger decides for each row: a report that froze a candidate's post after this statement began is not
     * seen by its filter, and is seen by the trigger.
     *
     * The candidates are a materialized common table expression, which runs once. As a plain sub-select of the delete
     * they could run again for every row the delete looks at, when the planner joins the two by a nested loop: each run
     * skips the rows this statement has deleted already and lets the next ones in, so one call deleted more than its
     * limit (measured: 33 rows under a limit of 25).
     */
    async dropDisposable(tx: DbTx, limit: number): Promise<string[]> {
      const rows = (await tx.execute(sql`
        with batch as materialized (
          select m.id
          from post_media m
          join profiles o on o.id = m.owner_id
          left join posts p on p.id = m.post_id
          where ${DISPOSABLE}
          order by m.id
          limit ${limit}
          for update of m)
        delete from post_media where id in (select id from batch)
        returning id`)) as unknown as { id: string }[];
      return rows.map((row) => row.id).sort();
    },

    /**
     * How many rows the disposal should have taken by now: every disposable row none of whose holds ended, and none of
     * whose marks (its own erasure, its post's deletion or erasure) was set, within the last day. A hold ends when it is
     * released or when its time passes, whichever comes first. A row whose freeze ended within the last day may be
     * counted until the next round takes it: nothing records when a freeze ends.
     */
    async overdueDeletions(): Promise<number> {
      const [row] = (await db.execute(sql`
        select count(*)::int as n
        from post_media m
        join profiles o on o.id = m.owner_id
        left join posts p on p.id = m.post_id
        where ${DISPOSABLE}
          and not exists (select 1 from media_holds h where h.media_id = m.id and least(h.released_at, h.until) > now() - interval '1 day')
          and (m.erased_at is null or m.erased_at <= now() - interval '1 day')
          and (p.deleted_at is null or p.deleted_at <= now() - interval '1 day')
          and (p.erased_at is null or p.erased_at <= now() - interval '1 day')`)) as unknown as { n: number }[];
      return row!.n;
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
