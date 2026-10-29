import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { ALERT_KINDS, AUTOMATION_RULES, EDGE_RULES, mediaPath, type AvatarView, type EdgePurgeView, type MediaKind } from "@korbat/contracts";
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

/**
 * One hold request of an intake: a post whose images the case holds as evidence, or an account whose images are only
 * locked. 2d Task 4 (design, section 7.7): or an account case's hold on the account's current avatar, which its snapshot
 * lists by reference.
 */
export type HoldPair = { caseId: string; postId: string } | { ownerId: string } | { caseId: string; accountId: string };

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

/** 2d Task 3 (design, sections 7.1 and 7.5): an avatar as its readers get it, the two paths of its row's files. */
export const avatarView = (id: string): AvatarView => ({ small: mediaPath(id, "small"), large: mediaPath(id, "large") });

/**
 * 2d Task 3 (design, section 7.4): the kind of row a ready result was made for. The worker marks a ready result of an
 * avatar's job with `avatar: true` (version 3); a result of version 1 or 2, a failed one and an unmarked one are a post's.
 * Both writers of a verdict (finalize here and storeVerdict in match.ts) store a ready result only on a row of this kind.
 */
export function resultKind(result: ResultFile): MediaKind {
  return result.v === 3 && result.status === "ready" && result.avatar === true ? "avatar" : "post";
}

/**
 * 2d Task 3 (design, section 7.4): a ready result whose avatar mark does not match the row's kind (an avatar's result
 * without it, a post's with it, which a worker of another build or a file written around it would leave) fails the upload
 * as processing_failed, rather than store an image as an avatar's squares or the squares as a post's image. Only a row
 * still processing changes; answers whether it did. Through the caller's statement runner: finalize's pool, storeVerdict's
 * savepoint.
 */
export async function failMismatch(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, id: string): Promise<boolean> {
  const rows = (await q.execute(sql`update public.post_media set status = 'failed', error = 'processing_failed' where id = ${id}::uuid and status = 'processing' returning id`)) as unknown as { id: string }[];
  return rows.length === 1;
}

/** 2d Task 3 (7.3): the account's current avatar detached in the caller's transaction; its id, or null when it had none. */
async function detachCurrent(tx: DbTx, accountId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`update post_media set profile_id = null where profile_id = ${accountId}::uuid returning id`)) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

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
  // 2d Task 3 (design, section 7.8): an avatar's row only while it is its live account's picture. A former one that a hold
  // or a freeze keeps is in no export, as a deleted post's kept image is in none; an avatar's upload never set (on no post
  // for at most the sweeper's day) is not the account's picture either.
  or(eq(postMedia.kind, "post"), sql`exists (select 1 from public.profiles o where o.id = ${postMedia.profileId} and o.deleted_at is null)`),
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
 *
 * 2d Task 3: an avatar on no post is kept by post_media_keep while its owner's account case is frozen by a suspect report,
 * the database's account_frozen (0051_avatars, the freeze's account arm). It is read here too, so that the disposal does not
 * take again, round after round, a row the trigger keeps, as it does not for a frozen post. 2d Task 4: and while a seal in
 * force lists it, the database's avatar_sealed (0053_avatar_moderation, the keep trigger's seal arm for an avatar).
 */
const DISPOSABLE = sql`(m.hold_until is null or m.hold_until <= now())
  and case when (p.state = 'deleted_by_author' or o.deleted_at is not null or p.erased_at is not null or m.erased_at is not null)
           then (case when m.post_id is not null then not public.post_frozen(m.post_id)
                      when m.kind = 'avatar' then not public.account_frozen(m.owner_id) and not public.avatar_sealed(m.id)
                      else true end)
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

/**
 * 3b Task 5: thrown inside insertProcessing's transaction when an import's claim found the import no longer preparing at
 * its cursor (a stop, a time limit or an admin's end committed first): nothing of the image is written.
 */
export class ImportMovedOn extends Error {
  constructor() {
    super("import: the import moved on before its image was written");
    this.name = "ImportMovedOn";
  }
}

/** 3b Task 5: one image row of an import that is on no post, as the feeder settles it (3b design, section 7.4 step 5). */
export interface ImportImageRow {
  id: string;
  status: MediaRow["status"];
  /** The check of known material: null when the row has no hashes (it was fed while the comparison was off). */
  check: "pending" | "clear" | "matched" | "unchecked" | "capped" | null;
  /** An upload refusal names the row: the matcher's acting match refused and held it (8.2). */
  refused: boolean;
  createdAt: Date;
}

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

    /**
     * Uploads of this account that are not on a post yet and did not fail. 3b Task 5 (design, section 7.4): never an
     * imported image, which no route of the person's uploaded, so an import of thousands never fills the 20 a person holds.
     */
    async pendingCount(ownerId: string): Promise<number> {
      // 2d Task 3 (design, section 7.2): never an avatar, which is never a post's upload: the current one and a held former
      // one use no slot of the 20.
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"]), eq(postMedia.imported, false), eq(postMedia.kind, "post"), NOT_REFUSED));
      return rows[0]?.count ?? 0;
    },

    /**
     * The upload's row, as one statement that locks its owner's profile row FOR KEY SHARE and inserts only when the one
     * predicate holds (3e design, section 7.2): read in the statement that locks the row, by the clock. No row inserted
     * answers account_suspended, and the caller discards the received file. The statement's lock may wait for a holder
     * that only locks the row, which leaves its judgment as it was before the wait, so the transaction ends with the
     * closing judgment of the owner (3e's review): a deleted or suspended owner then rolls the insert back, answered
     * account_suspended as the statement answers both.
     *
     * 3b Task 5 (design, sections 6.5 and 7.4): with `importJob`, the row is an imported image of that import, written with
     * `imported` true and the job's id in the same statement. The import's `claim` runs first in the transaction: it takes
     * the owner's row FOR KEY SHARE, then the job's row FOR NO KEY UPDATE, and moves the import's image cursor only while the
     * import is still preparing at the cursor the feeder read; when it answers false, ImportMovedOn rolls everything back,
     * so a stop that committed first leaves no new row. The statement below then judges the owner by the one predicate as
     * for any upload (the row it locks is held already), post_media_import_insert checks the job again, and the closing
     * judgment ends the transaction as for any upload.
     */
    async insertProcessing(input: {
      id: string;
      ownerId: string;
      now: Date;
      hashes?: ReceivedHashes | undefined;
      importJob?: { id: string; claim: (tx: DbTx) => Promise<boolean> };
      /** 2d Task 3 (design, sections 6.4 and 7.2): an avatar's upload, with its file's SHA-256 in lowercase hex. */
      avatar?: { sha256: string };
    }): Promise<void> {
      await db.transaction(async (tx) => {
        if (input.importJob !== undefined && !(await input.importJob.claim(tx))) throw new ImportMovedOn();
        const imported = input.importJob !== undefined;
        const kind: MediaKind = input.avatar === undefined ? "post" : "avatar";
        const inserted = await tx.execute(sql`
          with ok as (select p.id from profiles p where p.id = ${input.ownerId}::uuid and ${liveNotSuspended("p", WRITE_CLOCK)} for key share of p)
          insert into post_media (id, owner_id, status, created_at, imported, import_job_id, kind, avatar_sha256)
          select ${input.id}::uuid, ok.id, 'processing', ${input.now.toISOString()}::timestamptz, ${imported}, ${input.importJob?.id ?? null}::uuid, ${kind}::media_kind, ${input.avatar?.sha256 ?? null} from ok
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
      // 2d Task 3 (design, section 7.4): a ready result is stored only on a row of the kind it was made for.
      const kind = result.status === "ready" ? eq(postMedia.kind, resultKind(result)) : undefined;
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"), kind)).returning({ id: postMedia.id });
      if (rows.length === 1 || result.status !== "ready") return rows.length === 1;
      return failMismatch(db, id);
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
     * 2d Task 4 (design, section 7.6): signals' avatar form. The avatar with its score while it is the picture of its
     * owner's live profile, ready and unerased (an empty list otherwise), in the same shape as a post's images: the program
     * judges a picture only while someone may be shown it. It locks nothing.
     */
    async avatarSignals(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, mediaId: string, ownerId: string): Promise<{ mediaId: string; score: number | null }[]> {
      const rows = (await q.execute(sql`
        select m.id, m.nsfw_score from public.post_media m join public.profiles p on p.id = m.profile_id
         where m.id = ${mediaId}::uuid and m.profile_id = ${ownerId}::uuid and m.kind = 'avatar' and m.status = 'ready' and m.erased_at is null and p.deleted_at is null`)) as unknown as { id: string; nsfw_score: number | null }[];
      return rows.map((row) => ({ mediaId: row.id, score: row.nsfw_score === null ? null : Number(row.nsfw_score) }));
    },

    /**
     * 2d Task 4 (design, section 7.6): the owner of an avatar's row, or null when no avatar has the id. The program's step
     * reads it before its transaction, as it reads an image's post, to take the account branch: an avatar's owner never
     * changes. A read that holds no row.
     */
    async avatarOwner(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, mediaId: string): Promise<string | null> {
      const [row] = (await q.execute(sql`select owner_id from public.post_media where id = ${mediaId}::uuid and kind = 'avatar'`)) as unknown as { owner_id: string }[];
      return row?.owner_id ?? null;
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
     * 3d Task 8 (design, sections 2 row 33, 5 and 7.14, the retention job's step tools_off): while the R1 check is off,
     * every stored rating is set null in the caller's transaction, but the rating of an image that an unhandled signal
     * names, which the sweep still puts before a person. The API's role holds UPDATE of the column (0015); answers how many
     * images it changed. The step runs only while R1_CLASSIFIER is off, so "korbat keeps no rating from a time when one
     * did" is true once it has run.
     */
    async forgetScores(tx: Pick<DbTx, "execute">): Promise<number> {
      const rows = await tx.execute<{ id: string }>(sql`
        update public.post_media m set nsfw_score = null
         where m.nsfw_score is not null
           and not exists (select 1 from public.automated_signals s where s.media_id = m.id and s.handled_at is null)
        returning m.id`);
      return rows.length;
    },

    /**
     * 3d Task 8 (design, sections 6.3, 6.10 and 7.14, the retention job's step edge_purges): the outbox rows of the edge
     * done more than EDGE_RULES.keepDays ago, deleted in the caller's transaction; answers how many. A row without an
     * outcome is never taken: the job edge-purge has not finished with it.
     */
    async forgetPurges(tx: Pick<DbTx, "execute">): Promise<number> {
      const rows = await tx.execute<{ id: string }>(sql`
        delete from public.edge_purges e
         where e.done_at is not null and e.done_at < now() - make_interval(days => ${EDGE_RULES.keepDays}::int)
        returning e.id`);
      return rows.length;
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
           where m.id = ${id}::uuid and m.owner_id = ${ownerId}::uuid and m.post_id is null and m.status = 'processing' and m.kind = 'post'
             and h.check_state in ('pending', 'capped')`)) as unknown as unknown[];
        if (checking.length === 1) return "kept";
      }
      // 2d Task 3 (design, section 7.2): never an avatar, which only PUT and DELETE /api/me/avatar set and remove.
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), eq(postMedia.kind, "post"))).returning({ id: postMedia.id });
      return rows.length === 1 ? "deleted" : "none";
    },

    /**
     * What serving an image file depends on: whether it is ready, its own moderation state, its post's state and author,
     * and whether its content or its post's was erased. 2d Task 3 (design, section 7.5): also its kind, the profile it is the
     * avatar of, and whether that profile is deleted, read in the same query through profile_id.
     */
    async fileAccess(id: string): Promise<{
      status: MediaRow["status"];
      mediaState: MediaRow["moderationState"];
      postState: string | null;
      authorId: string | null;
      erased: boolean;
      kind: MediaKind;
      profileId: string | null;
      profileDeleted: boolean;
      /** 2d Task 4: the row's owner, whom serve shows an avatar R1's review withholds (7.5). */
      ownerId: string;
    } | null> {
      const rows = await db
        .select({
          status: postMedia.status,
          mediaState: postMedia.moderationState,
          postState: posts.state,
          authorId: posts.authorId,
          erasedAt: postMedia.erasedAt,
          postErasedAt: posts.erasedAt,
          kind: postMedia.kind,
          profileId: postMedia.profileId,
          profileDeletedAt: profiles.deletedAt,
          ownerId: postMedia.ownerId,
        })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .leftJoin(profiles, eq(profiles.id, postMedia.profileId))
        .where(eq(postMedia.id, id))
        .limit(1);
      const found = rows[0];
      if (!found) return null;
      return {
        status: found.status,
        mediaState: found.mediaState,
        postState: found.postState,
        authorId: found.authorId,
        erased: found.erasedAt !== null || found.postErasedAt !== null,
        kind: found.kind,
        profileId: found.profileId,
        profileDeleted: found.profileDeletedAt !== null,
        ownerId: found.ownerId,
      };
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        let rows: { id: string }[];
        try {
          // 2d Task 3 (design, section 7.2): only a post's upload; an avatar's id gets the error a missing upload gets, never
          // the CHECK post_media_kind_place's 500.
          rows = await tx
            .update(postMedia)
            .set({ postId: input.postId, position, altText: item.alt })
            .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready"), eq(postMedia.kind, "post")))
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
      // 2d Task 3 (decision 29, 7.8): the account's picture that the keep trigger kept (a frozen account case, a hold) stays,
      // detached: it is the picture of no profile from the purge on, and its detach writes the edge's outbox row that its
      // delete would have written. The disposal takes it once nothing keeps it.
      await tx.execute(sql`update post_media set profile_id = null where profile_id = ${ownerId}::uuid`);
      return rows.map((row) => row.id);
    },

    // ------------------------------------------------------------ 2d Task 3: avatars (design, sections 7.3, 7.5 and 7.8)

    /**
     * Steps 2 to 4 of setAvatar (7.3), inside the social module's transaction, which took the account's row through 3e's
     * predicate first. The upload's row is taken FOR NO KEY UPDATE and must be the account's own (not_found otherwise, a
     * missing row too), of kind avatar (not_an_avatar), ready, visible and not erased (avatar_not_ready); then the current
     * avatar, if it is another row, is detached (its outbox row, 6.4) and the upload set, which post_media_refused refuses
     * for a refused or held upload (avatar_not_ready). Answers the new avatar's paths and the detached row's id, which the
     * caller deletes after the commit; setting the current avatar again changes nothing.
     */
    async attachAvatar(tx: DbTx, accountId: string, mediaId: string): Promise<{ avatar: AvatarView; former: string | null }> {
      const [row] = (await tx.execute(sql`
        select owner_id, kind::text as kind, status::text as status, moderation_state::text as state, erased_at is not null as erased, profile_id, avatar_sha256
          from post_media where id = ${mediaId}::uuid for no key update`)) as unknown as { owner_id: string; kind: MediaKind; status: string; state: string; erased: boolean; profile_id: string | null; avatar_sha256: string | null }[];
      if (!row || row.owner_id !== accountId) throw new MediaError("not_found", 404);
      if (row.kind !== "avatar") throw new MediaError("not_an_avatar", 409);
      if (row.status !== "ready" || row.state !== "visible" || row.erased) throw new MediaError("avatar_not_ready", 409);
      if (row.profile_id === accountId) return { avatar: avatarView(mediaId), former: null };
      // 2d Task 4 (design, sections 7.3 step 2 and 7.7): the very picture a moderator reset on this account, the same file by
      // its SHA-256, is refused while the reset's 30 days run; a near copy stays a moderator's call. avatar_resets keeps the
      // hash, so it outlives the reset row. Read after the row's lock, in a statement of its own.
      const [reset] = (await tx.execute(sql`
        select 1 from public.avatar_resets r where r.account_id = ${accountId}::uuid and r.sha256 = ${row.avatar_sha256} and r.until > now() limit 1`)) as unknown as unknown[];
      if (reset !== undefined) throw new MediaError("avatar_reset", 409);
      const former = await detachCurrent(tx, accountId);
      try {
        await tx.execute(sql`update post_media set profile_id = ${accountId}::uuid where id = ${mediaId}::uuid`);
      } catch (err) {
        if (raisedCode(err) === "upload_refused") throw new MediaError("avatar_not_ready", 409);
        throw err;
      }
      return { avatar: avatarView(mediaId), former };
    },

    /**
     * Step 3 of setAvatar and the whole of removeAvatar's write (7.3): the account's current avatar, if any, detached in the
     * caller's transaction (the guard always allows a move to null; the outbox row is the trigger's). Answers its id, for
     * the deletion after the commit, or null.
     */
    detachAvatar: (tx: DbTx, accountId: string): Promise<string | null> => detachCurrent(tx, accountId),

    /**
     * Step 6 of setAvatar and removeAvatar (7.3), after the commit: a former avatar's row deleted, unless it is set again,
     * on a post, or kept by post_media_keep (a hold, a frozen account case; the sweeper deletes it once nothing keeps it).
     * Answers whether it went, so that its files are asked for only then.
     */
    async deleteFormerAvatar(id: string): Promise<boolean> {
      const rows = await db
        .delete(postMedia)
        .where(and(eq(postMedia.id, id), eq(postMedia.kind, "avatar"), isNull(postMedia.profileId), isNull(postMedia.postId)))
        .returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /**
     * The avatars of these profiles as every reader of a view gets them (7.5), in one statement on post_media_avatar_idx:
     * the row set as the profile's picture that serve would serve publicly: ready, visible, not erased, its profile not
     * deleted. A profile without one is absent from the map, and its monogram is drawn. `viewer` is the reader: 2d Task 4
     * (7.6) gives the viewer their own picture while R1's review withholds it (withheld) from everyone else, as serve does;
     * nothing else depends on it, and a sealed picture is given to nobody.
     */
    async avatarsOf(profileIds: readonly string[], viewer: string | null): Promise<Map<string, AvatarView>> {
      const found = new Map<string, AvatarView>();
      if (profileIds.length === 0) return found;
      const own = viewer === null ? sql`false` : sql`(m.moderation_state = 'withheld' and m.profile_id = ${viewer}::uuid)`;
      const rows = (await db.execute(sql`
        select m.profile_id, m.id from post_media m join profiles p on p.id = m.profile_id
         where m.profile_id = any(${uuidArray([...new Set(profileIds)])}) and m.status = 'ready' and (m.moderation_state = 'visible' or ${own})
           and m.erased_at is null and p.deleted_at is null`)) as unknown as { profile_id: string; id: string }[];
      for (const row of rows) found.set(row.profile_id, avatarView(row.id));
      return found;
    },

    /**
     * The account's picture as the data export names it (7.8, 11.2): its id and size while it is set and exportable
     * (EXPORTABLE: ready, a state its owner sees, not erased, not refused), or null. Its file is among readyImages.
     */
    async exportAvatar(ownerId: string): Promise<{ id: string; width: number; height: number } | null> {
      const [row] = await db
        .select({ id: postMedia.id, width: postMedia.width, height: postMedia.height })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(eq(postMedia.profileId, ownerId), eq(postMedia.ownerId, ownerId), EXPORTABLE))
        .limit(1);
      return row && row.width !== null && row.height !== null ? { id: row.id, width: row.width, height: row.height } : null;
    },

    /**
     * The images of a page of posts, in one query, in their order on each post, each with its own moderation state:
     * what the state means for a reader is the view builder's to say. A sealed image is its id and its state only:
     * nobody is given its size, its blurhash, its alt text or a path. An image of a deleted post, and one whose content
     * or whose post's was erased, is given to nobody, its owner included, so no view and no export names a row that a
     * case or a freeze kept. A state this reader has not been taught is left out.
     *
     * 3d review H2: but a release whose author's notice is still held (3d design 9.6) shows nothing yet: the image rows it
     * erased are given as they were under the seal, sealed, until the dispatch round that tells the notice.
     */
    async forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>> {
      const byPost = new Map<string, PostImage[]>();
      if (postIds.length === 0) return byPost;
      const heldRelease = sql`exists (select 1 from public.release_posts r join public.releases x on x.id = r.release_id
        where r.post_id = ${postMedia.postId} and x.author_notice = 'held')`;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText, state: postMedia.moderationState, erased: sql<boolean>`${postMedia.erasedAt} is not null` })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready"), ne(posts.state, "deleted_by_author"), or(isNull(postMedia.erasedAt), heldRelease), isNull(posts.erasedAt)))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId) continue;
        let image: PostImage;
        // An erased row reaches here only under a held release: it reads as the seal it was released from.
        if (row.erased || row.state === "sealed") image = { id: row.id, state: "sealed" };
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
     * capped upload is exempt while it is younger than AUTOMATION_RULES.matchRetryHours; after that it fails as any. 3b
     * Task 5 (design, section 7.4): an imported image of an import whose row still exists is the import's to settle, after
     * IMPORT_RULES.checkHours, and is left alone here.
     */
    async failStale(before: Date): Promise<string[]> {
      const rows = await db
        .update(postMedia)
        .set({ status: "failed", error: "processing_failed" })
        .where(
          and(
            eq(postMedia.status, "processing"),
            lt(postMedia.createdAt, before),
            isNull(postMedia.importJobId),
            sql`not exists (select 1 from public.media_hashes h where h.media_id = ${postMedia.id} and h.check_state = 'capped'
                                and ${postMedia.createdAt} > now() - make_interval(hours => ${AUTOMATION_RULES.matchRetryHours}::int))`,
          ),
        )
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /**
     * Removes uploads made before `before` that were never put on a post, whatever their state, and says which. 3b Task 5
     * (design, section 7.4): an imported image of an import whose row still exists waits for its post or for the import's
     * own cleanup (deleteImportLeftovers), however long the preparation takes.
     */
    async deleteUnattachedBefore(before: Date): Promise<string[]> {
      // 2d Task 3 (design, section 7.8): "on no post and no profile for a day": a current avatar is never swept, an avatar's
      // upload never set goes after a day, and a former one that a hold or a freeze keeps goes once nothing keeps it.
      const rows = await db
        .delete(postMedia)
        .where(and(isNull(postMedia.postId), isNull(postMedia.profileId), lt(postMedia.createdAt, before), isNull(postMedia.importJobId)))
        .returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    // ------------------------------------------------------------ 3b Task 5: what the imports module needs (design, 6.5, 7.4)

    /**
     * An import's image rows that are on no post, deleted in the caller's transaction: the images the feeder left out as
     * they settle, a refusal's other rows (8.2), and the leftovers of an import that has ended (7.4). In id order under row
     * locks and with no filter of its own, as every delete here: the keep trigger leaves a row a hold retains (a refused
     * upload, held for good by upload_refusals_hold) and RETURNING omits it, so only the files of rows that are gone are
     * asked for. With `ids`, only those of the import's rows.
     */
    async deleteImportLeftovers(tx: DbTx, jobId: string, ids?: readonly string[]): Promise<string[]> {
      if (ids !== undefined && ids.length === 0) return [];
      const only = ids === undefined ? sql`` : sql` and id = any(${uuidArray(ids)})`;
      const rows = (await tx.execute(
        sql`delete from post_media where id in (select id from post_media where import_job_id = ${jobId}::uuid and post_id is null${only} order by id for update) returning id`,
      )) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /**
     * An import's image rows on no post, each with what the feeder settles it by (7.4 step 5): its state, its check of known
     * material, whether a refusal names it, and when it was written. In id order; it locks nothing and answers no file, no
     * size and nothing of an image. Task 6's attach reads the kept ones from here: ready, clear, on no post.
     */
    async importRows(jobId: string): Promise<ImportImageRow[]> {
      const rows = (await db.execute(sql`
        select m.id, m.status, h.check_state, exists (select 1 from public.upload_refusals u where u.media_id = m.id) as refused, m.created_at
          from post_media m left join public.media_hashes h on h.media_id = m.id
         where m.import_job_id = ${jobId}::uuid and m.post_id is null
         order by m.id`)) as unknown as { id: string; status: MediaRow["status"]; check_state: ImportImageRow["check"]; refused: boolean; created_at: Date | string }[];
      return rows.map((row) => ({ id: row.id, status: row.status, check: row.check_state, refused: row.refused, createdAt: new Date(row.created_at) }));
    },

    /**
     * The imports that have image rows on no post that no hold retains (post_media_import_unattached_idx, migration 0047):
     * import-drive deletes them for every import that has left preparing and publishing (7.4). A refused row is not
     * answered while its hold stands, so a stopped import's refused image is not asked about every round.
     */
    async importsWithLeftovers(): Promise<string[]> {
      const rows = (await db.execute(sql`
        select distinct m.import_job_id as id from post_media m
         where m.import_job_id is not null and m.post_id is null and (m.hold_until is null or m.hold_until <= now())`)) as unknown as { id: string }[];
      return rows.map((row) => row.id);
    },

    /** The imported images on the site that are still processing; the feeder counts those without a result (7.4 step 2). */
    async importedProcessing(): Promise<string[]> {
      const rows = await db
        .select({ id: postMedia.id })
        .from(postMedia)
        .where(and(eq(postMedia.status, "processing"), eq(postMedia.imported, true)))
        .orderBy(postMedia.createdAt);
      return rows.map((row) => row.id);
    },

    /** Which of these ids are imported images' (7.4 step 1: an upload in incoming/ that is no imported image's waits). */
    async importedAmong(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: postMedia.id }).from(postMedia).where(and(inArray(postMedia.id, [...ids]), eq(postMedia.imported, true)));
      return new Set(rows.map((row) => row.id));
    },

    /**
     * The refusal of an image of this import (8.2), the earliest when two images in flight were refused, for the import's
     * view and its link to the notice; null when none names one. A refused row keeps its import while the import's row
     * exists: its hold keeps the row, and only the job row's deletion sets its import_job_id null.
     */
    async importRefusal(jobId: string): Promise<string | null> {
      const [row] = (await db.execute(sql`
        select u.id from public.upload_refusals u join post_media m on m.id = u.media_id
         where m.import_job_id = ${jobId}::uuid order by u.refused_at, u.id limit 1`)) as unknown as { id: string }[];
      return row?.id ?? null;
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
     *
     * 2d Task 4 (design, section 7.7): a pair `{ caseId, accountId }` locks the account's current avatar in the same
     * statement and id order, places the case's hold on it while it is not erased, and answers it under the account's id as
     * the account snapshot's media, `{ id, alt: null, width, height }` (an empty list when the account has no picture). An
     * owner pair also locks the owner's avatars, so a delete of one that races a suspect report waits and then meets the
     * freeze's account arm.
     */
    async hold(tx: DbTx, pairs: readonly HoldPair[]): Promise<Map<string, HeldImage[]>> {
      const caseOf = new Map<string, string>();
      const owners: string[] = [];
      const avatarCaseOf = new Map<string, string>();
      for (const pair of pairs) {
        if ("postId" in pair) caseOf.set(pair.postId, pair.caseId);
        else if ("accountId" in pair) avatarCaseOf.set(pair.accountId, pair.caseId);
        else owners.push(pair.ownerId);
      }
      const held = new Map<string, HeldImage[]>([...caseOf.keys(), ...avatarCaseOf.keys()].map((id) => [id, []]));
      if (caseOf.size === 0 && owners.length === 0 && avatarCaseOf.size === 0) return held;

      // A left join, so that an avatar (on no post) is read and locked by the same statement as the posts' images.
      const locked = (await tx.execute(sql`
        select m.id, m.post_id, m.profile_id, m.position, m.width, m.height, m.alt_text, (m.erased_at is not null or p.erased_at is not null) as erased
        from post_media m left join posts p on p.id = m.post_id
        where m.post_id = any(${uuidArray([...caseOf.keys()])})
           or (m.owner_id = any(${uuidArray(owners)}) and (m.post_id is not null or m.kind = 'avatar'))
           or m.profile_id = any(${uuidArray([...avatarCaseOf.keys()])})
        order by m.id for key share of m`)) as unknown as { id: string; post_id: string | null; profile_id: string | null; position: number | null; width: number; height: number; alt_text: string | null; erased: boolean }[];

      // The rows came back in id order; the holds are placed in that order too, each row with the case that holds it.
      const holder = (row: (typeof locked)[number]): string | undefined =>
        row.post_id !== null ? caseOf.get(row.post_id) : row.profile_id !== null ? avatarCaseOf.get(row.profile_id) : undefined;
      const toHold = locked.filter((row) => holder(row) !== undefined && !row.erased);
      if (toHold.length > 0) {
        await tx.execute(sql`
          insert into media_holds (media_id, case_id)
          select v.media_id, v.case_id
          from unnest(${uuidArray(toHold.map((row) => row.id))}, ${uuidArray(toHold.map((row) => holder(row)!))}) as v(media_id, case_id)
          where not exists (select 1 from media_holds h where h.media_id = v.media_id and h.case_id = v.case_id and h.released_at is null)
          order by v.media_id`);
      }

      for (const row of locked.filter((r) => r.post_id !== null).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
        held.get(row.post_id!)?.push({ id: row.id, alt: row.erased ? null : (row.alt_text ?? ""), width: row.width, height: row.height });
      }
      // The account's picture, unless it is erased: no reader is shown an erased one.
      for (const row of locked.filter((r) => r.post_id === null && r.profile_id !== null && avatarCaseOf.has(r.profile_id) && !r.erased)) {
        held.get(row.profile_id!)!.push({ id: row.id, alt: null, width: row.width, height: row.height });
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
    async staffAccess(id: string): Promise<{ postId: string | null; ownerId: string; status: MediaRow["status"]; width: number | null; height: number | null; mediaState: MediaRow["moderationState"]; erased: boolean; frozen: boolean; matched: boolean } | null> {
      // 3d Task 7 (design, sections 5 and 7.11; review ruling 2): also whether an unerased match record names the image,
      // an acting match or a flag, which shuts gate V for it on every case, whatever was answered. 2d Task 4 (7.7): an
      // avatar is read too, with its owner and no post; it is frozen while its owner's account case is (account_frozen),
      // which a report of child sexual abuse material about the account makes it, and a sealed one is refused by its state.
      // Every other image on no post (an upload) is answered null, as before.
      const [row] = (await db.execute(sql`
        select m.post_id, m.owner_id, m.status, m.width, m.height, m.moderation_state, (m.erased_at is not null or p.erased_at is not null) as erased,
               case when m.post_id is not null then public.post_frozen(m.post_id) else public.account_frozen(m.owner_id) end as frozen,
               exists (select 1 from public.media_matches x where x.media_id = m.id and x.erased_at is null) as matched
        from post_media m left join posts p on p.id = m.post_id
        where m.id = ${id}::uuid and (m.post_id is not null or m.kind = 'avatar')`)) as unknown as { post_id: string | null; owner_id: string; status: MediaRow["status"]; width: number | null; height: number | null; moderation_state: MediaRow["moderationState"]; erased: boolean; frozen: boolean; matched: boolean }[];
      if (!row) return null;
      return { postId: row.post_id, ownerId: row.owner_id, status: row.status, width: row.width, height: row.height, mediaState: row.moderation_state, erased: row.erased, frozen: row.frozen, matched: row.matched };
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
     * 2d Task 4 (design, section 7.7): the avatars one seal lists (seal_avatars) whose rows are there and not erased, by
     * id. Read-only, through the caller's transaction; handover-list hands over their files with the posts' images.
     */
    async sealAvatarRows(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, sealActionId: string): Promise<string[]> {
      const found = await q.execute<{ media_id: string }>(
        sql`select s.media_id from public.seal_avatars s join public.post_media m on m.id = s.media_id
             where s.action_id = ${sealActionId}::uuid and m.erased_at is null order by s.media_id`,
      );
      return found.map((row) => row.media_id);
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
     * a file korbat holds of an image it no longer has, which no release accounts for. 3d review M6: nor a held upload's
     * whose refusal is released, which is on no post: its release accounts for it. Through the caller's transaction,
     * which reads as the migrator: quarantine_files is closed to the API's role.
     */
    async quarantineOrphans(q: Pick<Db, "execute"> | Pick<DbTx, "execute">): Promise<{ mediaId: string; postId: string | null }[]> {
      const found = (await q.execute(sql`
        select f.media_id, min(f.post_id::text)::uuid as post_id from public.quarantine_files f
         where f.returned_at is null and f.destroyed_at is null and f.lost_at is null and not f.unknown and f.release_id is null
           and not exists (select 1 from post_media m where m.id = f.media_id)
           and not exists (select 1 from public.release_posts r where r.post_id = f.post_id)
           and not exists (select 1 from public.upload_refusals u where u.media_id = f.media_id and u.release_id is not null)
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
