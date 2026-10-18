import { sql } from "drizzle-orm";
import {
  OVERVIEW_LIST_MAX,
  QUEUE_PAGE_SIZE,
  RETENTION,
  SEAL_LIST_MAX,
  SOURCE_LABELS,
  SUSPECT_EARLIER_MONTHS,
  reporterLabel,
  type CaseDecision,
  type CaseDecisionAction,
  type CaseHistoryEntry,
  type CaseItem,
  type CaseSnapshot,
  type CaseTarget,
  type CaseView,
  type ErasureOverdue,
  type FindingRequest,
  type FindingResponse,
  type MediaSize,
  type QueuePage,
  type QueueRow,
  type SourceSummary,
  type StaffOverview,
  type StaffSnapshotTaken,
  type StaffTextDraft,
  type StandingBasis,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { ActiveStaffSession, NotifierFacts } from "../auth";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import type { StoredFile } from "../media";
import { alertUrgentLane, channelHealth, staffAlert } from "./alerts";
import { ModerationError, type ModerationDeps } from "./context";
import { liveTarget, recordIntake, storeSnapshot, type IntakeGround, type LiveTarget, type NamedTarget, type SnapshotContent } from "./intake";
import { accountLink, parseLink, postLink } from "./links";
import { contactOverview } from "./orders";
import { authorStanding, caseStanding, strikeDue } from "./standing";
import { caseReplies, repliesWaiting, standingColumns, standingOnDecisions, strikeAccounts, unansweredReplies, type ReplyColumns } from "./standing-repo";

import {
  appealCounts,
  caseActions,
  caseAppeals,
  caseById,
  caseDecisions,
  caseHistory,
  caseItems,
  caseSnapshots,
  caseStaffTexts,
  casesOpenedToday,
  dailyLimits,
  earlierAnswers,
  findingsOpenedToday,
  handleOf,
  imagesOpenedOn,
  insertAccess,
  interimSealsInForce,
  lateErasures,
  liveAccount,
  livePost,
  mailAndReleaseCounts,
  openByLane,
  ownDrafts,
  queueRows,
  recentProtectionLifted,
  recentReveals,
  recentSealsDeclined,
  reporterFacts,
  sealCovers,
  snapshotListsImage,
  snapshotTime,
  staffCaseConflict,
  staffToday,
  suspicionOf,
  type CaseItemRow,
  type CaseRow,
  type QueueCursor,
  type ReporterFacts,
  type SnapshotRead,
} from "./repo";

/** A reply as the case page shows it: its text while korbat keeps it, which an erasure blanks. */
const replyOf = (reply: ReplyColumns | undefined): CaseDecisionAction["reply"] =>
  reply === undefined ? null : { filedAt: reply.filedAt, onTime: reply.onTime, text: reply.erasedAt === null ? reply.text : null, answeredAt: reply.answeredAt, answeredBy: reply.answeredBy };

/**
 * The queue and the case, for staff (3c design, section 7.3): the overview the home screen shows, the queue, the case
 * answer, the one door to a case's images, a fresh snapshot, and a moderator's own finding. Every read of a case is
 * written to the access log and counts against the day's limit; none of it needs the key.
 */

// ---------------------------------------------------------------- the day, and the bands of a reporter's summary

/** How many seconds are left to midnight UTC, at least one: what a refusal at a daily limit tells the console to wait. */
export function secondsToUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** The same moment `months` calendar months later in UTC; a day the target month lacks becomes that month's last day. */
function monthsAfter(at: Date, months: number): Date {
  const month = at.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(at.getUTCFullYear(), month, Math.min(at.getUTCDate(), lastDay), at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
}

/** A reporter's account age as a band: under one month, one to twelve months (both ends included), or over twelve. */
export function accountAgeBand(createdAt: Date, now: Date): NonNullable<SourceSummary["accountAge"]> {
  if (now.getTime() < monthsAfter(createdAt, 1).getTime()) return "under_1_month";
  return now.getTime() <= monthsAfter(createdAt, 12).getTime() ? "1_to_12_months" : "over_12_months";
}

/** How many items a reporter filed, the one being read included, as a band. */
export function itemsFiledBand(filed: number): NonNullable<SourceSummary["itemsFiled"]> {
  if (filed <= 1) return "1";
  return filed <= 9 ? "2_to_9" : "10_or_more";
}

/** The share of a reporter's decided items that were acted on, as a band; exactly half is "half or more". */
export function actedOnBand(decided: number, actedOn: number): NonNullable<SourceSummary["actedOn"]> {
  if (decided <= 0) return "none_decided";
  if (actedOn <= 0) return "none";
  return actedOn * 2 < decided ? "under_half" : "half_or_more";
}

/** How many of a reporter's items were answered while nobody could open the images, as a band; they are counted apart from the decided ones. */
export function answeredUnseenBand(unseen: number): NonNullable<SourceSummary["answeredUnseen"]> {
  if (unseen <= 0) return "none";
  if (unseen === 1) return "1";
  return unseen <= 9 ? "2_to_9" : "10_or_more";
}

/**
 * Each reporter's place among the reporters of one case, from 0, in the order of each one's first item in the case: the
 * letter the case page gives them. Given per case, so one person's letter on one case says nothing about another.
 */
export function reporterIndexes(reportersInItemOrder: readonly (string | null)[]): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const reporter of reportersInItemOrder) if (reporter !== null && !indexes.has(reporter)) indexes.set(reporter, indexes.size);
  return indexes;
}

// ---------------------------------------------------------------- recusal

/**
 * Refuses a staff account that is too close to the case's subject: every route that names a case, or an item of one,
 * asks this first, so a refused read writes no access row and does not count against the day's limit. The check never
 * looks at who reported, and its answer reads the same whoever the conflict concerns.
 */
export async function refuseRecused(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<void> {
  if (await staffCaseConflict(deps.apiDb, session.userId, caseId)) throw new ModerationError("staff_recused");
}

/** The case, after the recusal check; not_found when no case has the id. */
async function openableCase(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<CaseRow> {
  await refuseRecused(deps, session, caseId);
  const row = await caseById(deps.apiDb, caseId);
  if (!row) throw new ModerationError("not_found");
  return row;
}

// ---------------------------------------------------------------- the overview

/** The reading person as the review marks ask about them: the session's account, and whether its role is admin. */
export const reviewerOf = (session: ActiveStaffSession) => ({ id: session.userId, admin: session.role === "admin" });

/** How long the overview's late erasures are kept before they are read again. */
export const ERASURE_OVERDUE_TTL_MS = 60_000;

/** The late erasures last read on a pool, and when: one read serves every staff member's home screen for a minute. */
const lateByPool = new WeakMap<object, { at: number; counts: Promise<ErasureOverdue> }>();

/**
 * The overview's erasureOverdue (3c design, section 7.3): one count for each due rule of what a step of the retention
 * job or the auth janitor should have changed more than a day ago and has not. The image rows are the media module's to
 * count and the notifiers' contacts the auth module's, since this module names neither.
 *
 * The counts are read at most once a minute for all staff, and a read in flight is shared: the count of late image rows
 * reads the freeze once for each kept row of a frozen account's deleted posts (seconds at twenty thousand rows), which a
 * home screen must not pay on every load, and both jobs run only every ten minutes, so a count a minute old says the
 * same. A read that failed is not kept.
 */
export function erasureOverdue(deps: Pick<ModerationDeps, "apiDb" | "media" | "auth" | "now">): Promise<ErasureOverdue> {
  const now = deps.now().getTime();
  const kept = lateByPool.get(deps.apiDb);
  if (kept && now >= kept.at && now - kept.at < ERASURE_OVERDUE_TTL_MS) return kept.counts;
  const counts = (async (): Promise<ErasureOverdue> => {
    const late = await lateErasures(deps.apiDb, RETENTION);
    return { ...late, images: await deps.media.overdueDeletions(), contacts: await deps.auth.overdueContacts() };
  })();
  lateByPool.set(deps.apiDb, { at: now, counts });
  counts.catch(() => {
    if (lateByPool.get(deps.apiDb)?.counts === counts) lateByPool.delete(deps.apiDb);
  });
  return counts;
}

/**
 * GET /api/staff/overview: counts, times, staff handles and cases, for every staff member's home screen. One number is
 * the reading person's own: how many of the waiting appeals they may review.
 */
export async function overview(deps: Pick<ModerationDeps, "apiDb" | "config" | "media" | "auth" | "now">, session: ActiveStaffSession): Promise<StaffOverview> {
  const q = deps.apiDb;
  const byLane = await openByLane(q);
  const today = await staffToday(q);
  const mails = await mailAndReleaseCounts(q, RETENTION.mailGiveUpDays);
  const appeals = await appealCounts(q, reviewerOf(session));
  return {
    lanes: ([0, 1, 2] as const).map((lane) => byLane.find((row) => row.lane === lane) ?? { lane, open: 0, oldestAt: null }),
    appealsWaiting: appeals.waiting,
    appealsYouMayReview: appeals.mayReview,
    appealsWithoutReviewer: appeals.withoutReviewer,
    reveals: await recentReveals(q, OVERVIEW_LIST_MAX),
    imagesToday: today.images,
    findingsToday: today.findings,
    mailsWaiting: mails.waiting,
    mailsFailed: mails.failed,
    releaseOverdue: mails.releaseOverdue,
    erasureOverdue: await erasureOverdue(deps),
    deferUnproven: deps.config.MODERATION_DEFER_UNPROVEN === "on",
    // The three lists of the path for child sexual abuse material, which every staff member sees: what lifted the
    // protection of reported images, who chose not to seal, and which seals taken while deciding stand.
    protectionLifted: await recentProtectionLifted(q, OVERVIEW_LIST_MAX),
    sealsDeclined: await recentSealsDeclined(q, OVERVIEW_LIST_MAX),
    interimSeals: await interimSealsInForce(q, OVERVIEW_LIST_MAX),
    // 3e (design, section 8.8): the replies no decision answered, and the accounts at the ladder's number of strikes.
    repliesWaiting: await repliesWaiting(q),
    strikeAccounts: (await strikeAccounts(q, 1)).total,
    // 3f (design, sections 8.2 and 10.2): the contact point's messages nobody has handled, and the alert channel's state,
    // both read fresh.
    contact: await contactOverview(deps),
    alerts: await channelAlerts(deps),
  };
}

/** StaffOverview.alerts: the channel's state as the tick judges it, with the time since when. */
async function channelAlerts(deps: Pick<ModerationDeps, "apiDb" | "config">): Promise<StaffOverview["alerts"]> {
  const health = await channelHealth(deps);
  return { channel: health.channel, since: health.since?.toISOString() ?? null };
}

// ---------------------------------------------------------------- the queue

const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The queue's cursor: the last row's sort key as an opaque word. */
const encodeCursor = (row: QueueCursor): string => Buffer.from(JSON.stringify([row.lane, row.deferred, row.sortAt, row.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
function decodeCursor(cursor: string): QueueCursor {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 4) throw new ModerationError("invalid_request");
  const [lane, deferred, sortAt, id] = parts as unknown[];
  if ((lane !== 0 && lane !== 1 && lane !== 2) || typeof deferred !== "boolean" || typeof sortAt !== "string" || !CURSOR_TIME.test(sortAt) || typeof id !== "string" || !CURSOR_ID.test(id)) {
    throw new ModerationError("invalid_request");
  }
  return { lane, deferred, sortAt, id };
}

/**
 * GET /api/staff/queue: open cases by lane and age, 50 a page. Only under the emergency switch are cases whose unanswered
 * items all come from unproven sources sorted after the others of their lane, never below a less severe lane.
 */
export async function queue(deps: Pick<ModerationDeps, "apiDb" | "config">, cursor?: string): Promise<QueuePage> {
  const after = cursor === undefined ? null : decodeCursor(cursor);
  const found = await queueRows(deps.apiDb, { deferUnproven: deps.config.MODERATION_DEFER_UNPROVEN === "on", after, limit: QUEUE_PAGE_SIZE + 1 });
  const page = found.slice(0, QUEUE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    cases: page.map(
      (row): QueueRow => ({
        id: row.id,
        lane: row.lane,
        targetType: row.targetType,
        openedAt: row.openedAt,
        oldestOpenAt: row.oldestOpenAt,
        openItems: row.openItems,
        rules: row.rules as QueueRow["rules"],
        categories: row.categories as QueueRow["categories"],
        allegesIllegal: row.allegesIllegal,
        suspect: row.suspect,
        reexamination: row.reexamination,
        deferred: row.deferred,
      }),
    ),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > QUEUE_PAGE_SIZE && last ? encodeCursor(last) : null,
    // 3e (design, section 8.5): the first page leads with the replies no decision answered, oldest first, without text.
    replies: after === null ? await unansweredReplies(deps.apiDb, QUEUE_PAGE_SIZE) : [],
  };
}

// ---------------------------------------------------------------- the case answer

/** A snapshot as the case answer carries it: its content unless the database's one predicate withholds it. */
function snapshotView(snapshot: SnapshotRead): CaseSnapshot {
  if (snapshot.withheld || snapshot.salt === null) return { id: snapshot.id, takenAt: snapshot.takenAt, digest: snapshot.digest, withheld: true };
  return {
    id: snapshot.id,
    takenAt: snapshot.takenAt,
    digest: snapshot.digest,
    withheld: false,
    salt: snapshot.salt,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    authorHandle: snapshot.authorHandle,
    postState: snapshot.postState,
    postCreatedAt: snapshot.postCreatedAt,
    replyToId: snapshot.replyToId,
    quoteOfId: snapshot.quoteOfId,
    body: snapshot.body,
    media: snapshot.media,
    displayName: snapshot.displayName,
    bio: snapshot.bio,
    handle: snapshot.handle,
  };
}

const NO_BANDS = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null } as const;
const NO_CONTACT = { named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false } as const;

/**
 * Who sent an item, as a summary that names nobody (3c design, section 7.3). A finding was found by a moderator; a notice
 * on the path for child sexual abuse material is anonymous, whoever sent it; a signed-out notifier is what the auth
 * module says of the contact, never the contact; a signed-in reporter is a letter and four bands, or, once the link to
 * the account is gone, only that.
 */
function sourceOf(item: CaseItemRow, letters: Map<string, number>, reporters: Map<string, ReporterFacts>, contacts: Map<string, NotifierFacts>, now: Date): SourceSummary {
  if (item.intakeKind === "finding") return { kind: "staff", label: SOURCE_LABELS.staff, ...NO_BANDS, ...NO_CONTACT };
  if (item.csam) return { kind: "anonymous", label: SOURCE_LABELS.anonymous, ...NO_BANDS, ...NO_CONTACT };
  if (item.channel === "signed_out") {
    const facts = item.contactId === null ? undefined : contacts.get(item.contactId);
    return {
      kind: "notifier",
      label: SOURCE_LABELS.notifier,
      ...NO_BANDS,
      named: facts?.named ?? false,
      contactGiven: facts?.contactGiven ?? false,
      confirmed: facts?.confirmed ?? false,
      suppressed: facts?.suppressed ?? false,
      // The notice left a contact that the auth module no longer has: never stored, or forgotten since.
      contactLost: item.contactId !== null && !(facts?.found ?? false),
    };
  }
  if (item.reporterAccountId === null) return { kind: "unlinked", label: SOURCE_LABELS.unlinked, ...NO_BANDS, ...NO_CONTACT };
  const facts = reporters.get(item.reporterAccountId);
  return {
    kind: "reporter",
    label: reporterLabel(letters.get(item.reporterAccountId) ?? 0),
    accountAge: facts?.createdAt ? accountAgeBand(facts.createdAt, now) : null,
    itemsFiled: itemsFiledBand(facts?.filed ?? 1),
    actedOn: actedOnBand(facts?.decided ?? 0, facts?.actedOn ?? 0),
    answeredUnseen: answeredUnseenBand(facts?.answeredUnseen ?? 0),
    ...NO_CONTACT,
  };
}

/** Whether an item's source is a signed-in reporter still linked to an account: the only items that get a letter. */
const linkedReporter = (item: CaseItemRow): string | null => (item.intakeKind === "user" && !item.csam && item.channel === "signed_in" ? item.reporterAccountId : null);

/**
 * The case as staff read it: what is, never what its senders are told (the status page keeps a live target from a dead
 * one; this answer does not). It writes nothing: readCase logs the read and holds it to the day's limit.
 */
export async function caseView(deps: Pick<ModerationDeps, "apiDb" | "auth" | "media" | "config" | "now">, session: ActiveStaffSession, row: CaseRow): Promise<CaseView> {
  const q = deps.apiDb;
  const origin = deps.config.APP_ORIGIN;

  // The target as it stands. An account case shows no image: a profile holds none, and the images of its posts are shown
  // only on those posts' own cases.
  let target: CaseTarget;
  let imagesAllowed = false;
  let authorId: string | null;
  if (row.targetType === "post") {
    const post = await livePost(q, row.targetId);
    target = { type: "post", id: row.targetId, link: postLink(origin, row.targetId), authorHandle: post?.authorHandle ?? null, state: post?.state ?? null, level: post?.level ?? null };
    imagesAllowed = post?.imagesAllowed ?? false;
    authorId = post?.authorId ?? null;
  } else {
    const account = await liveAccount(q, row.targetId);
    target = { type: "account", id: row.targetId, handle: account?.handle ?? null, displayName: account?.displayName ?? null, bio: account?.bio ?? null, deleted: account?.deleted ?? false };
    authorId = row.targetId;
  }

  // What the page shows in place of images on the path for child sexual abuse material: counts and days only.
  const marks = await suspicionOf(q, row.id);
  let suspicion: CaseView["suspicion"] = null;
  if (marks.holds) {
    const reach = await deps.media.reach({ type: row.targetType, id: row.targetId });
    const earlier = await earlierAnswers(q, { type: row.targetType, id: row.targetId }, authorId, SUSPECT_EARLIER_MONTHS);
    suspicion = {
      open: marks.open,
      reach: { posts: reach.posts, images: reach.images, sealed: reach.sealed, served: reach.served, newestPostOn: reach.newestPostOn },
      // Only a post's images are ever shown in the console, so only a post's case can say when staff last looked.
      earlier: { target: { ...earlier.target, imagesOpenedOn: row.targetType === "post" ? await imagesOpenedOn(q, row.targetId) : null }, author: earlier.author },
    };
  }

  const itemRows = await caseItems(q, row.id, session.userId);
  const letters = reporterIndexes(itemRows.map(linkedReporter));
  const reporters = await reporterFacts(q, [...letters.keys()]);
  const contactIds = [...new Set(itemRows.flatMap((item) => (item.channel === "signed_out" && !item.csam && item.contactId !== null ? [item.contactId] : [])))];
  const contacts = contactIds.length === 0 ? new Map<string, NotifierFacts>() : await deps.auth.notifierFacts(contactIds);
  const now = deps.now();
  const items = itemRows.map(
    (item): CaseItem => ({
      id: item.id,
      seq: item.seq,
      position: item.position,
      createdAt: item.createdAt,
      lane: item.lane,
      // An account's address is built from the handle as it was named; the target above carries the handle it holds now.
      link: item.targetType === "post" ? postLink(origin, item.targetId) : accountLink(origin, item.namedHandle ?? ""),
      ruleId: item.ruleId as CaseItem["ruleId"],
      allegesIllegal: item.allegesIllegal,
      csam: item.csam,
      category: item.category as CaseItem["category"],
      categoryKeyword: item.categoryKeyword,
      citedLaw: item.citedLaw,
      explanation: item.explanation,
      mediaId: item.mediaId,
      suspect: item.suspect,
      // An item korbat added for a quoted post stands ten positions after the item it was added for.
      quotedByPosition: item.position > 10 ? item.position - 10 : null,
      quotedCaseId: item.quotedCaseId,
      reexaminesPosition: item.reexaminesPosition,
      reexaminesYourDecision: item.reexaminesYourDecision,
      statement: item.statement,
      outcome: item.outcome as CaseItem["outcome"],
      answeredBy: item.answeredBy,
      erased: item.erased,
      source: sourceOf(item, letters, reporters, contacts, now),
      // 3e Task 5: the mark "manifestly unfounded": whether one may be set, and whether it stands or was withdrawn.
      markable: item.markable,
      unfounded: item.unfounded,
      markWithdrawn: item.markWithdrawn,
    }),
  );

  const actions = await caseActions(q, row.id);
  // The columns of 3e of every ledger row of the case, with a standing measure's period as it stands now.
  const columns = await standingColumns(q, row.id);
  // 3e Task 3: the standing measures that rest on each decision of the case, which a review or a correction would end.
  const standingOn = await standingOnDecisions(q, row.id);
  // 3e Task 4: the replies to the case's standing measures, with their texts: read here, in the logged read, and nowhere else.
  const replies = await caseReplies(q, row.id);
  const decisions: CaseDecision[] = [];
  for (const decision of await caseDecisions(q, row.id)) {
    const own: CaseDecision["actions"] = [];
    for (const action of actions.filter((candidate) => candidate.decisionId === decision.id)) {
      const more = columns.get(action.id);
      own.push({
        id: action.id,
        kind: action.kind,
        mediaId: action.mediaId,
        noEffect: action.noEffect,
        inForce: action.inForce,
        reversesActionId: action.reversesActionId,
        liftedBy: action.liftedBy,
        // A seal's list is the database's, written when the seal was recorded: text for the report to the police.
        sealed: action.kind === "seal_media" ? await sealCovers(q, action.id, SEAL_LIST_MAX) : null,
        days: more?.days ?? null,
        announced: more?.announced ?? null,
        basis: (more?.basis ?? null) as CaseDecisionAction["basis"],
        restsOn: more?.restsOn ?? null,
        earliestStart: more?.earliestStart ?? null,
        countsUntil: more?.countsUntil ?? null,
        period: (more?.period ?? null) as CaseDecisionAction["period"],
        restedOnBy: (more?.restedOnBy ?? null) as CaseDecisionAction["restedOnBy"],
        // 3e Task 2: a retirement names the handle it retired; no other row carries the member.
        ...(more?.handle ? { handle: more.handle } : {}),
        reply: replyOf(replies.get(action.id)),
      });
    }
    decisions.push({
      id: decision.id,
      kind: decision.kind,
      outcome: decision.outcome as CaseDecision["outcome"],
      ground: decision.ground as CaseDecision["ground"],
      ruleId: decision.ruleId as CaseDecision["ruleId"],
      rulesVersion: decision.rulesVersion,
      redressVersion: decision.redressVersion,
      category: decision.category as CaseDecision["category"],
      categoryKeyword: decision.categoryKeyword,
      source: decision.source as CaseDecision["source"],
      decidedAt: decision.decidedAt,
      staffHandle: decision.staffHandle,
      throughSeq: decision.throughSeq,
      answersFromSeq: decision.answersFromSeq,
      reviewsDecisionId: decision.reviewsDecisionId,
      snapshotId: decision.snapshotId,
      suspect: decision.suspect,
      unseen: decision.unseen,
      needsAdmin: decision.needsAdmin,
      endedInterim: decision.endedInterim,
      facts: decision.facts,
      reason: decision.reason,
      legalReference: decision.legalReference,
      actions: own,
      ...(standingOn.has(decision.id) ? { standingOn: standingOn.get(decision.id)!.map((entry) => ({ kind: entry.kind, basis: entry.basis as StandingBasis })) } : {}),
    });
  }

  const texts = await caseStaffTexts(q, row.id);
  const staffText = (text: (typeof texts)[number]) => ({ id: text.id, staffHandle: text.staffHandle, createdAt: text.createdAt, text: text.text });
  return {
    id: row.id,
    lane: row.lane,
    stateVersion: row.stateVersion,
    intakeSeq: row.intakeSeq,
    answeredSeq: row.answeredSeq,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    target,
    suspicion,
    imagesAllowed,
    snapshots: (await caseSnapshots(q, row.id)).map(snapshotView),
    items,
    decisions,
    appeals: await caseAppeals(q, row.id, reviewerOf(session)),
    drafts: (await ownDrafts(q, row.id, session.userId)) as StaffTextDraft[],
    notes: texts.filter((text) => text.kind === "note").map(staffText),
    sealsDeclined: texts.filter((text) => text.kind === "seal_declined").map(staffText),
    history: (await caseHistory(q, row.id)) as CaseHistoryEntry[],
    // 3e: on a post case whether a final restriction gives a strike and its author's standing in bands (the author of a
    // post that is gone has none to show); on an account case the account's standing.
    strikeDue: row.targetType === "post" ? await strikeDue(q, row.id) : null,
    authorStanding: row.targetType === "post" && authorId !== null ? await authorStanding(q, authorId) : null,
    standing: row.targetType === "account" ? await caseStanding(q, row.id, row.targetId) : null,
  };
}

/** The alert's key for one staff account's day: its window ends at midnight UTC, so the alert goes once that day. */
const readsKey = (staffId: string) => `moderation-reads:${staffId}`;

/**
 * Tells every staff account, the person's own included, that a staff account reached the day's limit on cases: a stolen
 * key reads at the speed of requests, and this mail is how the others learn of it. Once a day for each account.
 */
async function alertDailyReads(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log" | "now">, staffId: string, limit: number): Promise<void> {
  const handle = (await handleOf(deps.apiDb, staffId)) ?? "unknown";
  await staffAlert(deps, readsKey(staffId), secondsToUtcMidnight(deps.now()) * 1000, { template: "moderation_reads", handle, limit });
}

/**
 * GET /api/staff/cases/:case. In this order: the recusal check; the day's limit, which counts different cases, so a case
 * the person already opened today is never refused and a reload or a decision's answer never meets it; the access row;
 * then the answer. A person at the limit is refused every other case until midnight UTC, with nothing written, and every
 * staff account is told once that day.
 */
export async function readCase(deps: ModerationDeps, session: ActiveStaffSession, caseId: string): Promise<CaseView> {
  const row = await openableCase(deps, session, caseId);
  const limits = await dailyLimits(deps.apiDb);
  const opened = await casesOpenedToday(deps.apiDb, session.userId, caseId);
  if (!opened.thisCase && opened.cases >= limits.caseOpens) {
    deps.background.start(() => alertDailyReads(deps, session.userId, limits.caseOpens));
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }
  await insertAccess(deps.apiDb, { staffId: session.userId, caseId, kind: "case_opened" });
  return caseView(deps, session, row);
}

/**
 * The case as the answer to a decision the person's key has just confirmed on it (3c design, section 7.5, step 4): the
 * read is written to the access log like every read of a case, and it is not held to the day's limit on different
 * cases, which counts openings. A decision's answer is no opening of another case: its person has just acted on this
 * one, and the decision's own caps bound how often that can be. So no committed decision is answered with a refusal.
 */
export async function readDecidedCase(deps: ModerationDeps, session: ActiveStaffSession, caseId: string): Promise<CaseView> {
  const row = await openableCase(deps, session, caseId);
  await insertAccess(deps.apiDb, { staffId: session.userId, caseId, kind: "case_opened" });
  return caseView(deps, session, row);
}

// ---------------------------------------------------------------- images in the console

/**
 * GET /api/staff/cases/:case/media/:media/:size: an image of the case's own post, opened for staff, or image_refused. The
 * media module's one function decides what may be opened at all (gate V: never a sealed or an erased image, never an
 * image of a frozen post, on whatever case, open or closed); this route adds that the image is the case's. In this order:
 *   1. the recusal check and the case, as on every case route; only a post's case shows images;
 *   2. the image is one that a snapshot of the case lists, while that snapshot still holds its content: read from the
 *      module's own evidence, before the media module is asked. An id that names nothing and an id of another post's image
 *      are then refused by the same steps, with no file looked for, so the time an answer takes tells the two apart no
 *      more than the answer does;
 *   3. the media module's answer, and that the image it opened is on the case's own post.
 * Every refusal reads the same, and the file's handle is closed on each refusal after the open. Each view is written to
 * the access log before a byte is sent. The caller streams the file and closes it.
 */
export async function caseImage(deps: Pick<ModerationDeps, "apiDb" | "media">, session: ActiveStaffSession, caseId: string, mediaId: string, size: MediaSize): Promise<StoredFile> {
  const row = await openableCase(deps, session, caseId);
  if (row.targetType !== "post") throw new ModerationError("image_refused");
  // The id in the spelling the database writes, which is the one a snapshot lists its images by.
  const imageId = mediaId.toLowerCase();
  if (!(await snapshotListsImage(deps.apiDb, caseId, imageId))) throw new ModerationError("image_refused");
  const image = await deps.media.staffImage(imageId, size);
  if (!image) throw new ModerationError("image_refused");
  try {
    // The image is of another post than this case's: the same answer as for an image that is not shown at all.
    if (image.postId !== row.targetId) throw new ModerationError("image_refused");
    await insertAccess(deps.apiDb, { staffId: session.userId, caseId, kind: "image_viewed", mediaId: imageId });
  } catch (err) {
    await image.file.handle.close();
    throw err;
  }
  return image.file;
}

// ---------------------------------------------------------------- a fresh snapshot

/** The longest one run of the snapshot route waits for a lock: the post's row or the case's, which a decision holds while it is recorded. */
const SNAPSHOT_LOCK_TIMEOUT_MS = 10_000;

/** Whether a stored snapshot holds exactly what a capture holds now. */
function sameContent(stored: SnapshotRead, live: SnapshotContent): boolean {
  const images = (list: SnapshotContent["media"]) => JSON.stringify((list ?? []).map((image) => [image.id, image.alt, image.width, image.height]));
  return (
    stored.authorHandle === live.authorHandle &&
    stored.postState === live.postState &&
    stored.postCreatedAt === live.postCreatedAt &&
    stored.replyToId === live.replyToId &&
    stored.quoteOfId === live.quoteOfId &&
    stored.body === live.body &&
    (stored.media === null) === (live.media === null) &&
    images(stored.media) === images(live.media) &&
    stored.displayName === live.displayName &&
    stored.bio === live.bio &&
    stored.handle === live.handle
  );
}

/**
 * How often the snapshot's transaction is run again after a deadlock or a lock timeout, as an intake's is: in each run
 * that gave way nothing was written.
 */
const SNAPSHOT_RETRIES = 3;

/**
 * POST /api/staff/cases/:case/snapshots: a fresh snapshot of the target as it stands, taken the intake's way (a post under
 * a share lock with its images under their row locks, held for the case; a tombstone for a deleted post; no content after
 * an erasure), when it differs from the case's newest one or that one is withheld or erased. It answers the new
 * snapshot's id and digest, or the newest one's when nothing differed, never content: the console reads the case again,
 * so every read of a case's content goes through that route's access row and the day's limit. It needs no key: it changes
 * nothing a user sees, and enters the record only through a decision that names it.
 *
 * Its locks come in another order than a decision's. An intake takes its case first, through its item; this route has no
 * row to store before the copy, and the API role, which holds no UPDATE on cases, cannot lock a case's row itself. So the
 * post is locked first, and the case's row only by the foreign key of a hold or of the snapshot's own row. A decision
 * takes the case and then its post: the two can wait for each other, and PostgreSQL then makes one give way. Like an
 * intake, the transaction is run again on a deadlock and on a lock timeout, up to three times, and when the last run
 * fails the same way the answer is case_closed: the case would not hold still, and the person tries again.
 */
export async function takeSnapshot(deps: Pick<ModerationDeps, "apiDb" | "social" | "media">, session: ActiveStaffSession, caseId: string): Promise<StaffSnapshotTaken> {
  const row = await openableCase(deps, session, caseId);
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.apiDb.transaction((tx) => snapshotIn(deps, tx, row));
    } catch (err) {
      if (!isDeadlock(err) && !isLockNotAvailable(err)) throw err;
      if (attempt >= SNAPSHOT_RETRIES) throw new ModerationError("case_closed");
    }
  }
}

/** One run of the snapshot's transaction: the copy of the case's target, compared with the newest snapshot and stored when it differs. */
async function snapshotIn(deps: Pick<ModerationDeps, "social" | "media">, tx: DbTx, row: CaseRow): Promise<StaffSnapshotTaken> {
  const caseId = row.id;
  await tx.execute(sql`select set_config('lock_timeout', ${`${SNAPSHOT_LOCK_TIMEOUT_MS}ms`}::text, true)`);
  // The transaction's start, which the snapshots' trigger stamps and the digest covers.
  const takenAt = await snapshotTime(tx);
  let content: SnapshotContent;
  if (row.targetType === "post") {
    const post = await deps.social.capturePost(tx, row.targetId);
    if (!post) throw new ModerationError("not_found");
    const held = await deps.media.hold(tx, [{ caseId, postId: row.targetId }]);
    content = {
      caseId,
      targetType: "post",
      targetId: row.targetId,
      authorHandle: post.authorHandle,
      postState: post.state,
      postCreatedAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      body: post.body,
      media: held.get(row.targetId) ?? [],
      displayName: null,
      bio: null,
      handle: null,
    };
  } else {
    const profile = await deps.social.captureProfile(tx, row.targetId);
    if (!profile) throw new ModerationError("not_found");
    content = {
      caseId,
      targetType: "account",
      targetId: row.targetId,
      authorHandle: profile.handle,
      postState: null,
      postCreatedAt: null,
      replyToId: null,
      quoteOfId: null,
      body: null,
      media: null,
      displayName: profile.displayName,
      bio: profile.bio,
      handle: profile.handle,
    };
  }
  const [newest] = await caseSnapshots(tx, caseId, true);
  if (newest && !newest.withheld && !newest.erased && sameContent(newest, content)) return { id: newest.id, digest: newest.digest };
  return storeSnapshot(tx, takenAt, content);
}

// ---------------------------------------------------------------- a moderator's own finding

/**
 * POST /api/staff/findings: opens a case, or joins the target's open one, on the moderator's own finding under a rule. It
 * runs the transaction every intake runs. A finding needs no key, but it has lasting effects (holds, possibly the urgent
 * lane; citing R2 it freezes what its case reaches and makes the final decision an admin's), so one staff account opens
 * at most the day's limit of them, counted before anything is written, and the home screen lists each account's count.
 *
 * Which targets are live is the one rule of every intake: citing R2, a post in any state and an account also under a
 * handle it has left; under any other rule, only a post its author has not deleted and an account that holds the handle
 * now. A target with nothing live is not_found, and nothing is written: a finding is never stored as answered at once.
 *
 * The target is resolved first, before the day's count is read: a link that names nothing, or another site, is answered
 * as that on any day, and only a finding that could be opened meets the limit.
 */
export async function openFinding(deps: ModerationDeps, session: ActiveStaffSession, request: FindingRequest): Promise<FindingResponse> {
  const { target } = request;
  let named: NamedTarget;
  if (target.kind === "post") named = { type: "post", id: target.id, mediaId: target.mediaId ?? null };
  else if (target.kind === "account") named = { type: "account", handle: target.handle };
  else {
    const parsed = parseLink(deps.config.APP_ORIGIN, target.url);
    named = parsed.type === "post" ? { type: "post", id: parsed.id, mediaId: null } : parsed;
  }
  const suspect = request.ruleId === "R2";
  const found = await liveTarget(deps, named, suspect);
  if (!found) throw new ModerationError("not_found");

  const limits = await dailyLimits(deps.apiDb);
  if ((await findingsOpenedToday(deps.apiDb, session.userId)) >= limits.findings) {
    throw new ModerationError("rate_limited", 429, undefined, secondsToUtcMidnight(deps.now()));
  }

  // A finding alleges no illegality and holds no text of its own: what the moderator writes is a saved text.
  const ground: IntakeGround = {
    kind: "finding",
    channel: "staff",
    reporterId: null,
    findingBy: session.userId,
    contactId: null,
    ruleId: request.ruleId,
    allegesIllegal: false,
    csam: false,
    category: request.category,
    categoryKeyword: null,
    citedLaw: null,
    explanation: null,
    bonaFide: false,
  };
  const live: LiveTarget = named.type === "post" ? { type: "post", id: found.id, position: 1, mediaId: named.mediaId } : { type: "account", id: found.id, position: 1, namedHandle: named.handle };
  const recorded = await recordIntake(deps, { ground, live: [live] });
  const item = recorded.items.find((candidate) => candidate.position === 1);
  if (!item || item.caseId === null) throw new Error("a finding's item was stored without a case");

  // A finding that puts an item into the urgent lane alerts staff as a notice does, after the commit and unwaited for.
  if (recorded.items.some((candidate) => candidate.caseId !== null && candidate.lane === 0)) {
    deps.background.start(async () => {
      await alertUrgentLane(deps);
    });
  }
  return { caseId: item.caseId };
}
