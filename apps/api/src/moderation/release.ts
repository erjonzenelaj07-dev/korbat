import {
  AUTHOR_NOTICES_PAGE_SIZE,
  RELEASE_NOTICE_POSTS_MAX,
  RELEASE_POSTS_MAX,
  RETENTION,
  SealReleasedParams,
  type AuthorNoticesPage,
  type ReleaseNoticeView,
  type SealRelease,
} from "@korbat/contracts";
import { sql } from "drizzle-orm";
import type { AccountMailResult, ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import { staffAlert } from "./alerts";
import { decodeListCursor, encodeListCursor } from "./author";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { RETRY_MARGIN_MS } from "./decide";
import { appendConfirmedAudit, iso, raisedMessage, rows, type Runner } from "./repo";

/**
 * The release (3d design, sections 6.2, 7.2, 7.14 and 9.6): the one-way end of korbat's keeping of the images of a seal
 * for good, on a leave or an instruction to destroy that the command line recorded, by an admin's confirmed action. The
 * database decides whether it can stand (seal_release, and releases_confirmed at commit); this file reads the release
 * block a case shows, runs the confirmed action's transaction, tells every staff account, and sends the author's notice
 * at once or, while a hold on telling stands, in the dispatch round that finds the last hold ended. It names no image
 * row: the release erases them inside the database's function, and the media module's disposal drops them.
 */

/** A time as ISO text in UTC, to the microsecond, for a list's cursor. */
const microsOf = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

interface FactsRow {
  reported: boolean;
  their_reference: string | null;
  answer: SealRelease["answer"];
  answered_at: string | null;
  handed_over_at: string | null;
  quarantined: boolean;
  preserved: boolean;
  leave_id: string | null;
  leave_from: "authority" | "court" | null;
  leave_reference: string | null;
  leave_received_on: string | null;
  leave_untold: boolean | null;
  leave_untold_until: string | null;
  tell_held: boolean;
}

/**
 * CaseDecision.release (sections 7.2, 8.5 and 10.3) for each of these seals for good in force, keyed by the seal's
 * ledger row: the facts of release_facts, the lowest RELEASE_POSTS_MAX posts of the seal not yet released (which the
 * params the key signs must name), how many more remain, silence_days, and the seal's newest release with its posts and
 * their image rows as the seal counted them.
 */
export async function releaseBlocks(q: Runner, actionIds: readonly string[]): Promise<Map<string, SealRelease>> {
  const blocks = new Map<string, SealRelease>();
  if (actionIds.length === 0) return blocks;
  const [rules] = await rows<{ silence_days: number | null }>(q, sql`select r.silence_days from public.release_rules() r`);
  for (const actionId of actionIds) {
    const [f] = await rows<FactsRow>(
      q,
      sql`select f.reported, f.their_reference, f.answer, ${iso("f.answered_at")} as answered_at, ${iso("f.handed_over_at")} as handed_over_at,
                 f.quarantined, f.preserved, f.leave_id, f.leave_from, f.leave_reference, to_char(f.leave_received_on, 'YYYY-MM-DD') as leave_received_on,
                 f.leave_untold, ${iso("f.leave_untold_until")} as leave_untold_until, f.tell_held
            from public.release_facts(${actionId}::uuid) f`,
    );
    const open = await rows<{ post_id: string }>(
      q,
      sql`select s.post_id from public.seal_posts s
           where s.action_id = ${actionId}::uuid and not exists (select 1 from public.release_posts r where r.post_id = s.post_id)
           order by s.post_id`,
    );
    const [newest] = await rows<{ released_at: string; basis: "leave" | "period"; backups_clear_at: string; held: boolean }>(
      q,
      sql`select ${iso("r.released_at")} as released_at, r.basis, ${iso("r.backups_clear_at")} as backups_clear_at, r.author_notice = 'held' as held
            from public.releases r where r.seal_action_id = ${actionId}::uuid order by r.released_at desc, r.id desc limit 1`,
    );
    const [released] = await rows<{ posts: number; images: number }>(
      q,
      sql`select count(*)::int as posts, coalesce(sum(s.images), 0)::int as images
            from public.seal_posts s join public.release_posts r on r.post_id = s.post_id where s.action_id = ${actionId}::uuid`,
    );
    const postIds = open.slice(0, RELEASE_POSTS_MAX).map((row) => row.post_id);
    blocks.set(actionId, {
      reported: f!.reported,
      theirReference: f!.their_reference,
      answer: f!.answer,
      answeredAt: f!.answered_at,
      handedOverAt: f!.handed_over_at,
      quarantined: f!.quarantined,
      preserved: f!.preserved,
      leave:
        f!.leave_id === null
          ? null
          : { id: f!.leave_id, from: f!.leave_from!, reference: f!.leave_reference!, receivedOn: f!.leave_received_on!, untold: f!.leave_untold === true, untoldUntil: f!.leave_untold_until },
      tellHeld: f!.tell_held,
      postIds,
      remaining: open.length - postIds.length,
      silenceDays: rules!.silence_days,
      releasedAt: newest?.released_at ?? null,
      basis: newest?.basis ?? null,
      backupsClearAt: newest?.backups_clear_at ?? null,
      noticeHeld: newest === undefined ? null : newest.held,
      releasedPosts: released!.posts,
      releasedImages: released!.images,
    });
  }
  return blocks;
}

/** The locks a release may wait for: the subject's profile, the case, the leave, the admin's auth row, the image rows and the audit head. */
const RELEASE_WAITS = 6;

/** What a release that committed answers: the seal's case, which the route answers as it now stands. */
export type ReleaseOutcome = { caseId: string; releaseId: string } | "ended" | "late";

/**
 * POST /api/staff/seals/:action/release, once its step-up verified (section 7.2): one transaction on the API's pool,
 * built as recordConfirmed builds a decision's. Every lock wait is bounded by what is left of the challenge; the subject's
 * profile FOR NO KEY UPDATE first, as in every deciding transaction; then seal_release, which takes the seal's case and
 * checks everything in the database's order; last the confirmed audit row seal_released on the seal, with the params as
 * the key confirmed them and the release's id, which releases_confirmed holds the row to at commit. "ended" and "late"
 * as for a decision; once more after a deadlock while the challenge has time. After the commit, unwaited for: the alert
 * seal_released to every staff account and the author's notice, unless it was born held.
 */
export async function releaseSeal(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<ReleaseOutcome> {
  // A confirmation of anything else never releases: a wiring fault, not a refusal.
  if (confirmed.action !== "seal_released" || confirmed.target.type !== "seal" || confirmed.keyId !== session.keyId) throw new Error("a seal is released only with the step-up that confirmed it");
  const params = SealReleasedParams.parse(confirmed.params);
  const actionId = confirmed.target.id;
  // A ledger row never changes: its subject and its case are read before the transaction, as decide reads a post's author.
  const [seal] = await rows<{ subject: string; case_id: string }>(
    deps.apiDb,
    sql`select a.subject_account_id as subject, d.case_id from public.decision_actions a join public.decisions d on d.id = a.decision_id
         where a.id = ${actionId}::uuid and a.kind::text = 'seal_media'`,
  );
  if (seal === undefined) throw new ModerationError("not_found");
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<{ releaseId: string } | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, RELEASE_WAITS))) return "late";
        await deps.social.lockAccounts(tx, [seal.subject], "no key update");
        const [row] = await rows<{ id: string }>(tx, sql`select public.seal_release(${actionId}::uuid, ${params.basis}, ${params.leaveId}::uuid, ${session.userId}::uuid) as id`);
        await appendConfirmedAudit(tx, {
          actorId: session.userId,
          keyId: confirmed.keyId,
          action: "seal_released",
          targetType: "seal",
          targetId: actionId,
          metadata: { params: confirmed.params, releaseId: row!.id },
          staffSession: session.handle,
          actionHash: confirmed.actionHash,
          stepUp: confirmed.assertion,
          requestId: ctx.requestId,
          expiresAt: confirmed.expiresAt,
        });
        return { releaseId: row!.id };
      });
      if (outcome === "late") return "late";
      deps.background.start(() => afterRelease(deps, outcome.releaseId, params.postIds.length));
      return { caseId: seal.case_id, releaseId: outcome.releaseId };
    } catch (err) {
      const refusal = raisedMessage(err);
      if (refusal === "staff_confirmation_ended") return "ended";
      if (refusal === "staff_confirmation_late") return "late";
      if (refusal !== null && isModerationErrorCode(refusal)) throw new ModerationError(refusal);
      if (!isDeadlock(err) && !isBoundReached(err)) throw err;
      if (attempt > 1 || confirmed.expiresAt.getTime() - deps.now().getTime() <= RETRY_MARGIN_MS) return "late";
    }
  }
}

/**
 * What follows a release's commit, each part in a try of its own (section 7.2, after the commit): the alert seal_released
 * to every staff account, the admin who released included, without a throttle (3c gives the milder lifting of a seal
 * the same); then the author's notice, when it was not born held. Never throws.
 */
async function afterRelease(deps: ModerationDeps, releaseId: string, posts: number): Promise<void> {
  try {
    await staffAlert(deps, null, 0, { template: "seal_released", facts: { at: deps.now().toISOString(), posts, uploads: 0 } });
  } catch (err) {
    deps.log.error({ err, releaseId }, "moderation: the staff accounts were not alerted to a release");
  }
  try {
    await sendReleaseNotice(deps, releaseId);
  } catch (err) {
    deps.log.error({ err, releaseId }, "moderation: a release's notice was not sent; the dispatch round sends it");
  }
}

/** A mail's result as the notice's state. A relay that cannot take the mail now throws, and the notice stays pending. */
const NOTICE_STATE: Record<AccountMailResult, "sent" | "suppressed" | "no_address" | "failed"> = {
  sent: "sent",
  suppressed: "suppressed",
  no_address: "no_address",
  refused: "failed",
};

/** The release's author: the seal's subject, or for a replay the author of its posts; null when neither is there. */
const AUTHOR = (alias: string) =>
  sql.raw(`coalesce((select a.subject_account_id from public.decision_actions a where a.id = ${alias}.seal_action_id),
                    (select p.author_id from public.posts p where p.id = any(${alias}.post_ids) order by p.id limit 1))`);

/**
 * The view of a release that releaseNoticeParagraphs reads (ReleaseNoticeView), read for anyone or for its author alone
 * with `owner`; null for a release that is not there, not the owner's, or (unless `held` is allowed) whose notice is held.
 * `images` is the image rows the release erased, as the seals counted them (seal_posts.images, which nothing changes).
 */
export async function releaseView(q: Runner, releaseId: string, options: { owner?: string; allowHeld?: boolean } = {}): Promise<(ReleaseNoticeView & { authorId: string | null }) | null> {
  const [row] = await rows<{ id: string; basis: "leave" | "period"; released_at: string; backups_clear_at: string; upload: boolean; post_ids: string[]; author_id: string | null; held: boolean; seal_decision: string | null; images: number }>(
    q,
    sql`select r.id, r.basis, ${iso("r.released_at")} as released_at, ${iso("r.backups_clear_at")} as backups_clear_at, r.upload_refusal_id is not null as upload,
               r.post_ids::text[] as post_ids, ${AUTHOR("r")} as author_id, r.author_notice = 'held' as held,
               coalesce((select a.decision_id from public.decision_actions a where a.id = r.seal_action_id),
                        (select a.decision_id from public.seal_posts s join public.decision_actions a on a.id = s.action_id
                          where s.post_id = any(r.post_ids) order by a.created_at desc, a.id limit 1)) as seal_decision,
               coalesce((select sum(x.images) from (select max(s.images) as images from public.seal_posts s where s.post_id = any(r.post_ids) group by s.post_id) x), 0)::int as images
          from public.releases r where r.id = ${releaseId}::uuid`,
  );
  if (row === undefined) return null;
  if (options.owner !== undefined && row.author_id !== options.owner) return null;
  if (row.held && !options.allowHeld) return null;
  const posts = await rows<{ id: string; created_at: string }>(
    q,
    sql`select p.id, ${iso("p.created_at")} as created_at from public.posts p where p.id = any(${`{${row.post_ids.join(",")}}`}::uuid[]) order by p.created_at, p.id limit ${RELEASE_NOTICE_POSTS_MAX}`,
  );
  return {
    id: row.id,
    basis: row.basis,
    releasedAt: row.released_at,
    backupsClearAt: row.backups_clear_at,
    upload: row.upload,
    posts: posts.map((post) => ({ id: post.id, createdAt: post.created_at })),
    postCount: row.post_ids.length,
    images: row.images,
    sealDecisionId: row.seal_decision,
    authorId: row.author_id,
  };
}

/**
 * The author's notice of one release, if it is pending: in a transaction that holds the release's row FOR UPDATE while
 * the mail is sent, so the send after the commit and the dispatch round never both send it. The mail's result is the
 * notice's state; a relay that could not take it leaves it pending for the next round. Answers whether it was sent.
 */
export async function sendReleaseNotice(deps: Pick<ModerationDeps, "apiDb" | "auth">, releaseId: string): Promise<boolean> {
  return deps.apiDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [locked] = await rows<{ id: string }>(tx, sql`select r.id from public.releases r where r.id = ${releaseId}::uuid and r.author_notice = 'pending' for update`);
    if (locked === undefined) return false;
    const view = await releaseView(tx, releaseId, { allowHeld: false });
    if (view === null || view.authorId === null) {
      await tx.execute(sql`update public.releases set author_notice = 'none', author_notice_at = now() where id = ${releaseId}::uuid`);
      return false;
    }
    const { authorId, ...notice } = view;
    const state = NOTICE_STATE[await deps.auth.mailAccount(authorId, { template: "release_notice", view: notice })];
    await tx.execute(sql`update public.releases set author_notice = ${state}, author_notice_at = now() where id = ${releaseId}::uuid`);
    return state === "sent";
  });
}

/** How many releases' notices one round takes at most. */
const RELEASE_NOTICES_PER_ROUND = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The dispatch round's releases (sections 7.2 and 7.14): first every held notice whose release the author may now be
 * told of (release_tellable) moves to pending, in the round that finds the last hold ended and never before, and is
 * mailed at once; then every pending notice the send after its commit left (older than `due`) is mailed, or given up
 * after the give-up days of 3c, counted from when it became pending. A row that fails is logged and left as it was.
 * Answers how many were sent.
 */
export async function releaseNotices(deps: ModerationDeps, now: Date, due: Date, logUnsent: (err: unknown, ids: Record<string, string>) => void): Promise<number> {
  let sent = 0;
  const held = await rows<{ id: string }>(deps.apiDb, sql`select r.id from public.releases r where r.author_notice = 'held' order by r.released_at, r.id limit ${RELEASE_NOTICES_PER_ROUND}`);
  for (const { id } of held) {
    try {
      const moved = await rows<{ id: string }>(
        deps.apiDb,
        sql`update public.releases set author_notice = 'pending', author_notice_at = now()
             where id = ${id}::uuid and author_notice = 'held' and public.release_tellable(id) returning id`,
      );
      if (moved.length > 0 && (await sendReleaseNotice(deps, id))) sent++;
    } catch (err) {
      logUnsent(err, { releaseId: id });
    }
  }
  const pending = await rows<{ id: string; since: string }>(
    deps.apiDb,
    sql`select r.id, ${iso("coalesce(r.author_notice_at, r.released_at)")} as since from public.releases r
         where r.author_notice = 'pending' and coalesce(r.author_notice_at, r.released_at) < ${due.toISOString()}::timestamptz
         order by r.released_at, r.id limit ${RELEASE_NOTICES_PER_ROUND}`,
  );
  for (const { id, since } of pending) {
    try {
      if (now.getTime() - Date.parse(since) > RETENTION.mailGiveUpDays * DAY_MS) {
        await deps.apiDb.execute(sql`update public.releases set author_notice = 'failed', author_notice_at = now() where id = ${id}::uuid and author_notice = 'pending'`);
        deps.log.warn({ kind: "release_notice", id }, "moderation: mail given up");
        continue;
      }
      if (await sendReleaseNotice(deps, id)) sent++;
    } catch (err) {
      logUnsent(err, { releaseId: id });
    }
  }
  return sent;
}

/**
 * GET /api/moderation/notices (sections 9.6 and 10.2): the releases about the viewer's posts, newest first, 20 a page,
 * never one whose notice is held: nothing of the app shows a release while a hold on telling stands.
 */
export async function authorNotices(deps: Pick<ModerationDeps, "apiDb">, viewer: string, cursor?: string): Promise<AuthorNoticesPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await rows<{ id: string; at: string; key: string }>(
    deps.apiDb,
    sql`select r.id, ${iso("r.released_at")} as at, ${microsOf("r.released_at")} as key
          from public.releases r
         where r.author_notice <> 'held' and ${AUTHOR("r")} = ${viewer}::uuid
           and (${after === null} or (r.released_at, r.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
         order by r.released_at desc, r.id desc
         limit ${AUTHOR_NOTICES_PAGE_SIZE + 1}`,
  );
  const page = found.slice(0, AUTHOR_NOTICES_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    notices: page.map((row) => ({ kind: "release" as const, id: row.id, at: row.at })),
    nextCursor: found.length > AUTHOR_NOTICES_PAGE_SIZE && last ? encodeListCursor({ at: last.key, id: last.id }) : null,
  };
}

/** GET /api/moderation/releases/:release: the notice for its author alone, and not_found while it is held or for anyone else. */
export async function authorRelease(deps: Pick<ModerationDeps, "apiDb">, viewer: string, releaseId: string): Promise<ReleaseNoticeView> {
  const view = await releaseView(deps.apiDb, releaseId, { owner: viewer });
  if (view === null) throw new ModerationError("not_found");
  const { authorId: _author, ...notice } = view;
  return notice;
}

/**
 * The appeals' mark (sections 7.2 and 8.7): for each of these decisions whose seal has released posts, the newest
 * release's time and ground, keyed by the decision's id.
 */
export async function releasedSeals(q: Runner, decisionIds: readonly string[]): Promise<Map<string, { at: string; basis: "leave" | "period" }>> {
  const marks = new Map<string, { at: string; basis: "leave" | "period" }>();
  if (decisionIds.length === 0) return marks;
  const found = await rows<{ decision_id: string; at: string; basis: "leave" | "period" }>(
    q,
    sql`select distinct on (a.decision_id) a.decision_id, ${iso("r.released_at")} as at, r.basis
          from public.decision_actions a join public.releases r on r.seal_action_id = a.id
         where a.decision_id = any(${`{${decisionIds.join(",")}}`}::uuid[]) and a.kind::text = 'seal_media'
         order by a.decision_id, r.released_at desc, r.id desc`,
  );
  for (const row of found) marks.set(row.decision_id, { at: row.at, basis: row.basis });
  return marks;
}

/** Home's [home.released] (sections 8.2 and 10.3): the releases of the last DESTRUCTIVE_DAYS, newest first, with their seal's case. */
export async function recentReleases(q: Runner, days: number, max: number): Promise<{ kind: "seal_released"; at: string; caseId: string | null; refusalId: null }[]> {
  const found = await rows<{ at: string; case_id: string | null }>(
    q,
    sql`select ${iso("r.released_at")} as at, d.case_id
          from public.releases r
          left join public.decision_actions a on a.id = r.seal_action_id
          left join public.decisions d on d.id = a.decision_id
         where r.replay_of is null and r.released_at >= now() - make_interval(days => ${days}::int)
         order by r.released_at desc, r.id desc limit ${max}`,
  );
  return found.map((row) => ({ kind: "seal_released" as const, at: row.at, caseId: row.case_id, refusalId: null }));
}
