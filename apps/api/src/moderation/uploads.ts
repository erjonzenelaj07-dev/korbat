import { sql } from "drizzle-orm";
import {
  UPLOADS_PAGE_SIZE,
  UploadHoldEndedParams,
  UploadReleasedParams,
  statementMatchKind,
  type HeldUpload,
  type ObjectionRequest,
  type UploadRefusalView,
  type UploadRelease,
  type UploadsPage,
} from "@korbat/contracts";
import { REDRESS_VERSION, RULES_VERSION, getRedress, getRule, uploadNoticeParagraphs } from "@korbat/rules";
import type { AccountMailResult, ActiveStaffSession, StaffStepUpConfirmed } from "../auth";
import { boundLockWaits, isBoundReached, isDeadlock } from "../lib/lock-bounds";
import type { MatchEvent, RefusalRow } from "../media";
import { alertUrgentLane, staffAlert } from "./alerts";
import { matchSignal } from "./automated";
import { ModerationError, isModerationErrorCode, type ModerationDeps } from "./context";
import { RETRY_MARGIN_MS } from "./decide";
import { sendReleaseNotice } from "./release";
import { appendConfirmedAudit, iso, raisedMessage, rows } from "./repo";

/**
 * A refused upload (3d design, sections 2 rows 35 to 37, 7.8 step 4, 7.12 and 7.15; W.5, W.7 and W.8; Task 7): what
 * follows a refusal the media module stored, the uploader's notice and "Object", and Held uploads with the hold's two ends
 * and the release of a held upload. A held upload is a record of its own, not a case: its rows are the media module's,
 * read and written through MediaForCases, and its end and release are the database's definer functions, held to the
 * admin's confirmed audit row at commit. Nothing here opens, serves or names an image, a hash or a file.
 */

/** The alert matcher_down is written at once at most once an hour, by the first upload over the limit on refusals (7.8). */
export const MATCHER_DOWN_KEY = "matcher-down";
export const MATCHER_DOWN_WINDOW_MS = 60 * 60_000;

/** The notice's paragraphs, rendered from the view with the rule's current title and the current redress (W.5). */
export function uploadNotice(view: UploadRefusalView): string[] {
  const rule = getRule("R2", RULES_VERSION);
  const redress = getRedress(REDRESS_VERSION);
  if (!rule || !redress) throw new Error("the current rulebook or redress texts lack what a refused upload's notice prints");
  return uploadNoticeParagraphs(view, rule.title, redress);
}

/**
 * UploadRefusalView (10.2) of one of the uploader's refusals, or null for anyone else's: the source and the derived kind of
 * match, the objection, whether one is open (7.12's one rule), the end once it is one (an end as no_report only after its
 * delay), the release's time unless its notice is held, and whether a record of a report names the refusal.
 */
export async function refusalView(deps: Pick<ModerationDeps, "apiDb" | "media">, ownerId: string, refusalId: string): Promise<UploadRefusalView | null> {
  const own = await deps.media.refusalOf(ownerId, refusalId);
  if (own === null) return null;
  const [release] =
    own.releaseId === null
      ? []
      : await rows<{ released_at: string }>(deps.apiDb, sql`select ${iso("r.released_at")} as released_at from public.releases r where r.id = ${own.releaseId}::uuid and r.author_notice <> 'held'`);
  // The uploader is told of an end as no_report once its delay has passed and it still stands, never earlier.
  const told = own.endAs === "report" || (own.endAs === "no_report" && own.delayPassed);
  return {
    id: own.id,
    refusedAt: own.refusedAt,
    source: own.source,
    matchKind: statementMatchKind(own.hashType, own.matchKind),
    listedAs: "csam",
    objection: own.objection === null || own.objectedAt === null ? null : { text: own.objection, objectedAt: own.objectedAt },
    mayObject: own.objection === null && own.releaseId === null && own.endAs !== "no_report",
    endedAt: told ? own.endedAt : null,
    endAs: told ? own.endAs : null,
    endReason: told ? own.endReason : null,
    released: release?.released_at ?? null,
    reportKept: own.notificationId !== null,
  };
}

/** How many of the uploader's refusals one read of the export takes. */
const EXPORT_REFUSALS_PAGE = 50;

/**
 * 3d Task 8 (W.10): the export's `uploads`: every refusal of the account's uploads, newest first, each as its notice reads
 * it (UploadRefusalView, through the same view the notice's route answers), so the export says what the notice says and
 * no more: no file, no hash, no classification and no list version.
 */
export async function exportedUploads(deps: Pick<ModerationDeps, "apiDb" | "media">, ownerId: string): Promise<UploadRefusalView[]> {
  const exported: UploadRefusalView[] = [];
  let after: { at: string; id: string } | null = null;
  for (;;) {
    const page: { id: string; at: string; key: string }[] = await deps.media.refusalsOf(ownerId, after, EXPORT_REFUSALS_PAGE);
    for (const refusal of page) {
      const view = await refusalView(deps, ownerId, refusal.id);
      // A refusal the page has just named is the owner's, unless its record was erased in between: then it names nobody.
      if (view !== null) exported.push(view);
    }
    const last = page.at(-1);
    if (page.length < EXPORT_REFUSALS_PAGE || last === undefined) return exported;
    after = { at: last.key, id: last.id };
  }
}

/** GET /api/moderation/uploads/:refusal: the notice's view for its uploader alone; not_found for anyone else. */
export async function authorUpload(deps: Pick<ModerationDeps, "apiDb" | "media">, viewer: string, refusalId: string): Promise<UploadRefusalView> {
  const view = await refusalView(deps, viewer, refusalId);
  if (view === null) throw new ModerationError("not_found");
  return view;
}

/**
 * POST /api/moderation/uploads/:refusal/objection (7.12 step 2): the uploader's one objection, open while the refusal has
 * none, is not released and did not end as no_report; objection_not_open when it changed no row of theirs, not_found for
 * anyone else's. A suspended account may object: no suspension is read here, as for "Ask for a person" (E 7.3). After the
 * commit, unwaited for, the urgent alert counts it among the held uploads. The answer is the notice's view as it now reads.
 */
export async function objectToUpload(deps: ModerationDeps, viewer: string, refusalId: string, request: ObjectionRequest): Promise<UploadRefusalView> {
  const outcome = await deps.media.objectToRefusal(viewer, refusalId, request.text);
  if (outcome === "not_found") throw new ModerationError("not_found");
  if (outcome === "not_open") throw new ModerationError("objection_not_open");
  deps.background.start(async () => {
    await alertUrgentLane(deps);
  });
  return authorUpload(deps, viewer, refusalId);
}

/** A mail's result as a notice's state. */
const NOTICE_STATE: Record<AccountMailResult, "sent" | "suppressed" | "no_address" | "failed"> = { sent: "sent", suppressed: "suppressed", no_address: "no_address", refused: "failed" };

/**
 * The uploader's notice of one refusal (7.12 step 1, W.8 upload_refused): its paragraphs as they stand, mailed through the
 * auth module, and the result recorded, which changes only a notice still pending. A refusal that names nobody any more is
 * `none`. A relay that cannot take the mail throws, and the notice stays pending for the dispatch round.
 */
export async function sendRefusalNotice(deps: Pick<ModerationDeps, "apiDb" | "auth" | "media">, refusal: { id: string; ownerId: string | null }): Promise<boolean> {
  if (refusal.ownerId === null) {
    await deps.media.refusalTold(refusal.id, "none");
    return false;
  }
  const view = await refusalView(deps, refusal.ownerId, refusal.id);
  if (view === null) {
    await deps.media.refusalTold(refusal.id, "none");
    return false;
  }
  const state = NOTICE_STATE[await deps.auth.mailAccount(refusal.ownerId, { template: "upload_refused", paragraphs: uploadNotice(view) })];
  await deps.media.refusalTold(refusal.id, state);
  return state === "sent";
}

/** The notice that a hold ended as no_report was lifted (W.8 upload_hold_lifted): the end's paragraph alone. */
async function sendLiftedNotice(deps: Pick<ModerationDeps, "apiDb" | "auth" | "media">, refusal: { id: string; ownerId: string | null }): Promise<boolean> {
  const view = refusal.ownerId === null ? null : await refusalView(deps, refusal.ownerId, refusal.id);
  if (refusal.ownerId === null || view === null || view.endAs !== "no_report") {
    await deps.media.liftedTold(refusal.id, "none");
    return false;
  }
  const ended = uploadNotice(view).filter((paragraph) => paragraph.startsWith("An admin ended the hold"));
  const state = NOTICE_STATE[await deps.auth.mailAccount(refusal.ownerId, { template: "upload_hold_lifted", paragraphs: ended })];
  await deps.media.liftedTold(refusal.id, state);
  return state === "sent";
}

/** How many refusals' notices one dispatch round takes at most of each kind. */
const NOTICES_PER_ROUND = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The dispatch round's notices of refused uploads (7.14): every refusal's notice the send after its commit left (older
 * than `due`), and every notice that a hold was lifted whose delay has passed; each given up after the give-up days of 3c,
 * counted from the refusal or from the end. Each row in a try of its own, logged by its id. Answers how many were sent.
 */
export async function refusalNotices(deps: ModerationDeps, now: Date, due: Date, giveUpDays: number, logUnsent: (err: unknown, ids: Record<string, string>) => void): Promise<number> {
  let sent = 0;
  for (const refusal of await deps.media.refusalsUntold(NOTICES_PER_ROUND)) {
    if (Date.parse(refusal.refusedAt) >= due.getTime()) continue;
    try {
      if (now.getTime() - Date.parse(refusal.refusedAt) > giveUpDays * DAY_MS) {
        await deps.media.refusalTold(refusal.id, "failed");
        deps.log.warn({ kind: "upload_refused", id: refusal.id }, "moderation: mail given up");
        continue;
      }
      if (await sendRefusalNotice(deps, refusal)) sent++;
    } catch (err) {
      logUnsent(err, { refusalId: refusal.id });
    }
  }
  for (const refusal of await deps.media.liftedUntold(NOTICES_PER_ROUND)) {
    try {
      if (now.getTime() - Date.parse(refusal.endedAt) > giveUpDays * DAY_MS) {
        await deps.media.liftedTold(refusal.id, "failed");
        deps.log.warn({ kind: "upload_hold_lifted", id: refusal.id }, "moderation: mail given up");
        continue;
      }
      if (await sendLiftedNotice(deps, refusal)) sent++;
    } catch (err) {
      logUnsent(err, { refusalId: refusal.id });
    }
  }
  return sent;
}

/**
 * media.onMatch's handler (section 5, 7.8 step 4, 7.9): after the commit that stored a refusal, the uploader's notice and
 * the urgent alert, whose count now includes the held uploads; after the commit that stored a match of an image on a post,
 * the automated step; and for the first upload of an hour over the limit on refusals, matcher_down at once with its facts.
 * Each in a try of its own: a lost call is found by the dispatch round or the automated sweep.
 */
export function matchedHandler(deps: ModerationDeps): (event: MatchEvent) => Promise<void> {
  return async (event) => {
    if (event.kind === "refused") {
      try {
        const [subject] = [await deps.media.refusalSubject(deps.apiDb, event.refusalId)];
        if (subject) await sendRefusalNotice(deps, { id: event.refusalId, ownerId: subject.ownerId });
      } catch (err) {
        deps.log.warn({ err, refusalId: event.refusalId }, "moderation: a refused upload's notice was not mailed; it stays pending for the dispatch job");
      }
      try {
        await alertUrgentLane(deps);
      } catch (err) {
        deps.log.error({ err, refusalId: event.refusalId }, "moderation: the urgent alert for a held upload was not sent; the dispatch round repeats it");
      }
      return;
    }
    if (event.kind === "posted") {
      await matchSignal(deps, { mediaId: event.mediaId, matchId: event.matchId });
      return;
    }
    const counts = await deps.media.checkCounts();
    await staffAlert(deps, MATCHER_DOWN_KEY, MATCHER_DOWN_WINDOW_MS, {
      template: "matcher_down",
      facts: { since: counts.oldestUnchecked ?? deps.now().toISOString(), count: counts.unchecked, refusalsCapped: counts.capped },
    });
  };
}

// ---------------------------------------------------------------- Held uploads (7.12 steps 3 to 5, 8.6)

type FactsRow = {
  reported: boolean;
  their_reference: string | null;
  answer: UploadRelease["answer"];
  answered_at: string | null;
  handed_over_at: string | null;
  quarantined: boolean;
  leave_id: string | null;
  leave_from: "authority" | "court" | null;
  leave_reference: string | null;
  leave_received_on: string | null;
  leave_untold: boolean | null;
  leave_untold_until: string | null;
  tell_held: boolean;
};

/** The release block of a hold ended as report (8.6, 10.3), read through upload_release_facts and the refusal's release. */
async function releaseBlock(deps: Pick<ModerationDeps, "apiDb">, refusal: RefusalRow): Promise<UploadRelease | null> {
  if (refusal.endAs !== "report") return null;
  const [f] = await rows<FactsRow>(
    deps.apiDb,
    sql`select f.reported, f.their_reference, f.answer, ${iso("f.answered_at")} as answered_at, ${iso("f.handed_over_at")} as handed_over_at, f.quarantined,
               f.leave_id, f.leave_from, f.leave_reference, to_char(f.leave_received_on, 'YYYY-MM-DD') as leave_received_on, f.leave_untold,
               ${iso("f.leave_untold_until")} as leave_untold_until, f.tell_held
          from public.upload_release_facts(${refusal.id}::uuid) f`,
  );
  const [rules] = await rows<{ silence_days: number | null }>(deps.apiDb, sql`select r.silence_days from public.release_rules() r`);
  const [release] =
    refusal.releaseId === null
      ? []
      : await rows<{ released_at: string; basis: "leave" | "period"; backups_clear_at: string; held: boolean }>(
          deps.apiDb,
          sql`select ${iso("r.released_at")} as released_at, r.basis, ${iso("r.backups_clear_at")} as backups_clear_at, r.author_notice = 'held' as held from public.releases r where r.id = ${refusal.releaseId}::uuid`,
        );
  return {
    reported: f!.reported,
    theirReference: f!.their_reference,
    answer: f!.answer,
    answeredAt: f!.answered_at,
    handedOverAt: f!.handed_over_at,
    quarantined: f!.quarantined,
    leave:
      f!.leave_id === null
        ? null
        : { id: f!.leave_id, from: f!.leave_from!, reference: f!.leave_reference!, receivedOn: f!.leave_received_on!, untold: f!.leave_untold === true, untoldUntil: f!.leave_untold_until },
    tellHeld: f!.tell_held,
    silenceDays: rules!.silence_days,
    releasedAt: release?.released_at ?? null,
    basis: release?.basis ?? null,
    backupsClearAt: release?.backups_clear_at ?? null,
    noticeHeld: release === undefined ? null : release.held,
  };
}

async function heldUpload(deps: Pick<ModerationDeps, "apiDb">, refusal: RefusalRow): Promise<HeldUpload> {
  return {
    id: refusal.id,
    refusedAt: refusal.refusedAt,
    match: refusal.match,
    otherRefusals: refusal.otherRefusals,
    uploaderGone: refusal.uploaderGone,
    objection: refusal.objection,
    objectedAt: refusal.objectedAt,
    endedAt: refusal.endedAt,
    endAs: refusal.endAs,
    endReason: refusal.endReason,
    deletesAt: refusal.deletesAt,
    reported: refusal.reported,
    quarantined: refusal.quarantined,
    release: await releaseBlock(deps, refusal),
  };
}

/** Held uploads' cursor: the offset of the page after, as decimal digits. */
const UPLOADS_CURSOR = /^(0|[1-9][0-9]{0,6})$/;

/** GET /api/staff/uploads (7.12 step 3, 10.3): a page of Held uploads in its sections' order. */
export async function heldUploads(deps: Pick<ModerationDeps, "apiDb" | "media">, cursor?: string): Promise<UploadsPage> {
  if (cursor !== undefined && !UPLOADS_CURSOR.test(cursor)) throw new ModerationError("invalid_request");
  const offset = cursor === undefined ? 0 : Number(cursor);
  const found = await deps.media.heldList(offset);
  const page = found.slice(0, UPLOADS_PAGE_SIZE);
  return { uploads: await Promise.all(page.map((refusal) => heldUpload(deps, refusal))), nextCursor: found.length > UPLOADS_PAGE_SIZE ? String(offset + UPLOADS_PAGE_SIZE) : null };
}

/** One held upload as the list shows it, the answer of the hold's end and of a release; not_found when there is none. */
export async function heldUploadOf(deps: Pick<ModerationDeps, "apiDb" | "media">, refusalId: string): Promise<HeldUpload> {
  const refusal = await deps.media.held(refusalId);
  if (refusal === null) throw new ModerationError("not_found");
  return heldUpload(deps, refusal);
}

/** The locks an end or a release may wait for: the uploader's profile, the refusal, the image row, the admin's auth row, the leave and the audit head. */
const HOLD_WAITS = 6;

/**
 * One confirmed transaction of Held uploads (7.12 steps 4 and 5), built as a release's: every lock wait bounded by what is
 * left of the challenge; the uploader's profile FOR NO KEY UPDATE when the refusal still names one; the database's
 * function; and last the confirmed audit row, whose metadata names the refusal's image. "ended" and "late" as for a
 * decision; once more after a deadlock while the challenge has time. A refusal of the database's is its own code.
 */
async function confirmedHold<T>(
  deps: ModerationDeps,
  confirmed: StaffStepUpConfirmed,
  refusalId: string,
  run: (tx: Parameters<Parameters<ModerationDeps["apiDb"]["transaction"]>[0]>[0], mediaId: string) => Promise<T>,
): Promise<T | "ended" | "late"> {
  const subject = await deps.media.refusalSubject(deps.apiDb, refusalId);
  if (subject === null) throw new ModerationError("not_found");
  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await deps.apiDb.transaction(async (tx): Promise<T | "late"> => {
        if (!(await boundLockWaits(tx, confirmed.expiresAt, HOLD_WAITS))) return "late";
        if (subject.ownerId !== null) await deps.social.lockAccounts(tx, [subject.ownerId], "no key update");
        return run(tx, subject.mediaId);
      });
      return outcome;
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
 * POST /api/staff/uploads/:refusal/end (7.12 step 4), once its step-up verified: upload_hold_end, then the confirmed audit
 * row upload_hold_ended on the refusal with the params and the image's id, which upload_refusals_confirmed holds the end to
 * at commit. After an end as no_report every staff account is alerted, the admin included, without a throttle
 * (hold_ended_unreported, with when the upload is deleted). The answer is the refusal as Held uploads now shows it.
 */
export async function endHold(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<HeldUpload | "ended" | "late"> {
  if (confirmed.action !== "upload_hold_ended" || confirmed.target.type !== "upload_refusal" || confirmed.keyId !== session.keyId) throw new Error("a hold is ended only with the step-up that confirmed it");
  const params = UploadHoldEndedParams.parse(confirmed.params);
  const refusalId = confirmed.target.id;
  const outcome = await confirmedHold(deps, confirmed, refusalId, async (tx, mediaId) => {
    await tx.execute(sql`select public.upload_hold_end(${refusalId}::uuid, ${params.endAs}, ${params.reason}, ${session.userId}::uuid)`);
    await appendConfirmedAudit(tx, {
      actorId: session.userId,
      keyId: confirmed.keyId,
      action: "upload_hold_ended",
      targetType: "upload_refusal",
      targetId: refusalId,
      metadata: { params: confirmed.params, mediaId },
      staffSession: session.handle,
      actionHash: confirmed.actionHash,
      stepUp: confirmed.assertion,
      requestId: ctx.requestId,
      expiresAt: confirmed.expiresAt,
    });
    return "done" as const;
  });
  if (outcome === "ended" || outcome === "late") return outcome;
  const held = await heldUploadOf(deps, refusalId);
  if (params.endAs === "no_report") {
    deps.background.start(async () => {
      await staffAlert(deps, null, 0, { template: "hold_ended_unreported", facts: { at: deps.now().toISOString(), deletesAt: held.deletesAt ?? deps.now().toISOString() } });
    });
  }
  return held;
}

/**
 * POST /api/staff/uploads/:refusal/release (7.12 step 5): upload_release, then the confirmed audit row upload_released on
 * the refusal with the params, the release's id and the image's id, which releases_confirmed holds the release to at
 * commit. After the commit: seal_released to every staff account, the admin included, without a throttle, and the
 * uploader's notice unless it was born held.
 */
export async function releaseUpload(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<HeldUpload | "ended" | "late"> {
  if (confirmed.action !== "upload_released" || confirmed.target.type !== "upload_refusal" || confirmed.keyId !== session.keyId) throw new Error("a held upload is released only with the step-up that confirmed it");
  const params = UploadReleasedParams.parse(confirmed.params);
  const refusalId = confirmed.target.id;
  const outcome = await confirmedHold(deps, confirmed, refusalId, async (tx, mediaId) => {
    const [row] = await rows<{ id: string }>(tx, sql`select public.upload_release(${refusalId}::uuid, ${params.basis}, ${params.leaveId}::uuid, ${session.userId}::uuid) as id`);
    await appendConfirmedAudit(tx, {
      actorId: session.userId,
      keyId: confirmed.keyId,
      action: "upload_released",
      targetType: "upload_refusal",
      targetId: refusalId,
      metadata: { params: confirmed.params, releaseId: row!.id, mediaId },
      staffSession: session.handle,
      actionHash: confirmed.actionHash,
      stepUp: confirmed.assertion,
      requestId: ctx.requestId,
      expiresAt: confirmed.expiresAt,
    });
    return row!.id;
  });
  if (outcome === "ended" || outcome === "late") return outcome;
  const releaseId = outcome;
  deps.background.start(async () => {
    try {
      await staffAlert(deps, null, 0, { template: "seal_released", facts: { at: deps.now().toISOString(), posts: 0, uploads: 1 } });
    } catch (err) {
      deps.log.error({ err, releaseId }, "moderation: the staff accounts were not alerted to a held upload's release");
    }
    try {
      await sendReleaseNotice(deps, releaseId);
    } catch (err) {
      deps.log.error({ err, releaseId }, "moderation: a held upload's release notice was not sent; the dispatch round sends it");
    }
  });
  return heldUploadOf(deps, refusalId);
}
