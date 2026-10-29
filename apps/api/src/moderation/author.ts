import {
  ACTIVITY_KEEP_DAYS,
  AUTHOR_CASES_PAGE_SIZE,
  MEASURES,
  mediaPath,
  type ActivityEntry,
  type ActivityPlace,
  type AuthorCasesPage,
  type DecisionAppeal,
  type DecisionContent,
  type DecisionStatement,
  type DecisionView,
  type ExportFormat,
  type OrderTexts,
  type PostModeration,
  type RuleId,
} from "@korbat/contracts";
import { activityDecisions, activityLost, activitySince, askPersonOf, authorDecision, authorDecisions, chipFacts, type AuthorAppealFacts, type AuthorDecisionFacts, type AuthorDecisionRow } from "./author-repo";
import { objectionOf } from "./automated-repo";
import { ModerationError, type ModerationDeps } from "./context";
import { activityReleases } from "./release";
import { decisionStatement } from "./statement";
import { orderNoticeOf } from "./statement-repo";
import { decisionStandingView, reportingStandingView } from "./standing";
import { activeStrikesOf } from "./standing-repo";

/**
 * What the author of a post or the holder of an account reads about korbat's decisions on it (3c design, sections 7.6 and
 * 10): the list of decisions they were told of, one decision with its statement's data and the content it was made on,
 * the same decisions as their export lists them (section 7.11), and the facts behind the chip on their own post.
 * Everything here is built from the author's queries and the statement's
 * data, neither of which can reach a report: an author learns the source of a decision as a category, and nothing else
 * about who reported or how often.
 */

// ---------------------------------------------------------------- page cursors

const CURSOR_TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where a page of one of the app's moderation lists starts: after the row with this time (to the microsecond, as text) and id. */
export interface ListCursor {
  at: string;
  id: string;
}

/** A list's cursor: the last row's sort key as an opaque word. */
export const encodeListCursor = (cursor: ListCursor): string => Buffer.from(JSON.stringify([cursor.at, cursor.id]), "utf8").toString("base64url");

/** Reads a cursor back; anything this module did not write is refused, never guessed at. */
export function decodeListCursor(cursor: string): ListCursor {
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ModerationError("invalid_request");
  }
  if (!Array.isArray(parts) || parts.length !== 2) throw new ModerationError("invalid_request");
  const [at, id] = parts as unknown[];
  if (typeof at !== "string" || !CURSOR_TIME.test(at) || typeof id !== "string" || !CURSOR_ID.test(id)) throw new ModerationError("invalid_request");
  return { at, id };
}

// ---------------------------------------------------------------- Activity (2d)

/** A moderation entry of Activity as this module answers it; the activity module adds `new`, which only it can judge. */
export type ModerationActivityEntry = Omit<Extract<ActivityEntry, { type: "moderation" }>, "new">;

/**
 * The kinds of 3e's measures of an account's standing and their reversals (a strike, a suspension, a termination, a
 * retired handle, the reporting measures, and what lifts each), read from MEASURES: a decision about an account that holds
 * one is about the account, any other decision about an account is about its profile (its display name or bio).
 */
const STANDING_KINDS = Object.entries(MEASURES)
  .filter(([, spec]) => spec.target === "account" || spec.target === "handle" || spec.target === "reporting")
  .map(([kind]) => kind);

/** The largest and the smallest id, which no row has: a bound that keeps every row at a time, or none. */
const ID_MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ID_MIN = "00000000-0000-0000-0000-000000000000";

/**
 * Where a source whose keys are `prefix:` and an id starts, in its own (time, id) order, for Activity's place (at, key):
 * the rows whose key is below the place's. At the place's time a row's key is below it exactly when the prefix is lower,
 * or when it is the same and the id is lower; so the bound keeps every row at that time, none of them, or those below
 * the place's own id. Keys are compared code unit by code unit, as the activity module and the "C" collation do.
 */
function sourceAfter(place: ActivityPlace, prefix: string): { at: string; id: string } {
  const own = place.key.slice(0, 1);
  return { at: place.at, id: own === prefix ? place.key.slice(2) : own > prefix ? ID_MAX : ID_MIN };
}

/** Whether (at, key) comes before `place` in Activity's order, newest first: a later time, or the same time and a higher key. */
const isBelow = (entry: { at: string; key: string }, place: ActivityPlace | null) =>
  place === null || entry.at < place.at || (entry.at === place.at && entry.key < place.key);

/**
 * 2d (design, section 5.5.2): the moderation entries of `viewer`'s Activity, newest first by (at, key), before `before`
 * when given, at most `limit`, none older than ACTIVITY_KEEP_DAYS by the time the author was told (the list's end
 * sentence is then true of both sources, while Cases keeps the full history). Built only from the reads the author's own
 * screens use, so nothing is listed earlier than the author may be told of it, and nothing the author may not see:
 *   - a decision told to its author (`d:`), the rows of Cases' list by toldToAuthor, at informed_at; its target the post
 *     (with the post's time), the account for a decision holding one of 3e's measures of its standing, else the profile;
 *   - a release of sealed images (`r:`), by the Notices list's rule (never one whose notice is held), at the time that
 *     list shows; its target the account, since a seal's images may span several posts and the release opens by its id;
 *   - a refused upload (`u:`), the media module's refusalsOf as the Notices list reads it; its target the account, since
 *     a refused upload was on no post;
 *   - a lost image (`l:` and the image's id), from lost_told_for, once 3d's dispatch handled its notice; its target the
 *     post, which the entry opens.
 * One statement reads the clock for the 90 days, and every time is to the microsecond. lost_told_for answers rows through
 * the place's time (activityLost), since files lost together share a time, and those at or after the place are dropped
 * here, as every source's are compared with the place again. Each source is asked for `limit` rows; the union is cut to
 * `limit`.
 */
export async function authorActivity(deps: Pick<ModerationDeps, "apiDb" | "media">, viewer: string, before: ActivityPlace | null, limit: number): Promise<ModerationActivityEntry[]> {
  const since = await activitySince(deps.apiDb, ACTIVITY_KEEP_DAYS);
  const [decisions, releases, refusals, lost] = await Promise.all([
    activityDecisions(deps.apiDb, viewer, before, since, STANDING_KINDS, limit),
    activityReleases(deps.apiDb, viewer, before === null ? null : sourceAfter(before, "r"), since, limit),
    deps.media.refusalsOf(viewer, before === null ? null : sourceAfter(before, "u"), limit),
    activityLost(deps.apiDb, viewer, before === null ? null : before.at, since),
  ]);
  const entries: ModerationActivityEntry[] = [
    ...decisions.flatMap((row): ModerationActivityEntry[] => {
      const base = { type: "moderation" as const, kind: "decision" as const, key: `d:${row.id}`, at: row.at, id: row.id };
      if (row.targetType === "post") {
        // A decision about a post names its post and that post's time; a post's row is never deleted, so both are there.
        return row.postCreatedAt === null ? [] : [{ ...base, target: "post", postId: row.targetId, postCreatedAt: row.postCreatedAt }];
      }
      return [{ ...base, target: row.standing ? "account" : "profile", postId: null, postCreatedAt: null }];
    }),
    ...releases.map((row): ModerationActivityEntry => ({ type: "moderation", kind: "release", key: `r:${row.id}`, at: row.at, target: "account", id: row.id, postId: null, postCreatedAt: null })),
    // refusalsOf answers each time to the millisecond as `at` and to the microsecond as `key`, the time Activity keeps.
    ...refusals
      .filter((row) => row.key >= since)
      .map((row): ModerationActivityEntry => ({ type: "moderation", kind: "upload", key: `u:${row.id}`, at: row.key, target: "account", id: row.id, postId: null, postCreatedAt: null })),
    ...lost.map((row): ModerationActivityEntry => ({ type: "moderation", kind: "lost", key: `l:${row.mediaId}`, at: row.at, target: "post", id: row.mediaId, postId: row.postId, postCreatedAt: row.postCreatedAt })),
  ].filter((entry) => isBelow(entry, before));
  entries.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return entries.slice(0, limit);
}

// ---------------------------------------------------------------- the list

/** GET /api/moderation/cases: the decisions about the viewer's account that they were told of, newest first, 20 a page. */
export async function authorCases(deps: Pick<ModerationDeps, "apiDb">, viewer: string, cursor?: string): Promise<AuthorCasesPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await authorDecisions(deps.apiDb, viewer, after, AUTHOR_CASES_PAGE_SIZE + 1);
  const page = found.slice(0, AUTHOR_CASES_PAGE_SIZE);
  const last = page.at(-1);
  return {
    decisions: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      outcome: row.outcome as AuthorCasesPage["decisions"][number]["outcome"],
      decidedOn: row.decidedOn,
      post: row.post,
      actions: row.actions,
      endedInterim: row.endedInterim,
      ruleId: row.ruleId as RuleId | null,
      legal: row.legal,
      appealUntil: row.appealUntil,
      reversedOn: row.reversedOn,
      appeal: row.appeal,
      strike: row.strike,
      // 3e Task 5: what a row says of a restriction of reporting and of the measures a reversal ended; absent where none.
      ...(row.reportingDays !== null ? { reportingDays: row.reportingDays } : {}),
      ...(row.endedStanding.length > 0 ? { endedStanding: row.endedStanding } : {}),
      // 3e's review (people7): a suspension's or a termination's own words, and a lift's or a withdrawal's.
      ...(row.standingMeasure !== null ? { standingMeasure: row.standingMeasure } : {}),
      ...(row.liftedStanding !== null ? { liftedStanding: row.liftedStanding } : {}),
      // 3f: an order's notice, or the reinstatement after one, names no rule.
      ...(row.order !== null ? { order: row.order } : {}),
      // 3f's review (people9): an order decision's row shows the day its author was told.
      ...(row.toldOn !== null ? { toldOn: row.toldOn } : {}),
      // 3d Task 6 (section 9.4): a program's decision, whose screen shows [auto.chip].
      byProgram: row.byProgram,
    })),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > AUTHOR_CASES_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
    // The block "Your standing" above the list: the strikes that count now.
    activeStrikes: await activeStrikesOf(deps.apiDb, viewer),
  };
}

// ---------------------------------------------------------------- one decision

/**
 * The content a decision was made on, or the reason it is not shown; the first that applies, in this order (3c design,
 * section 10). The database's one predicate says whether the snapshot's content may be shown at all. Where it may not,
 * an R4 redaction of the post or the account is named before a plain erasure: content that was erased because it
 * doxxed someone is said to be gone for that reason, whichever decision is viewed. A snapshot withheld without being
 * erased is one whose post's content was erased since, which only a redaction does.
 */
function contentOf(facts: AuthorDecisionFacts): DecisionContent {
  if (facts.withheld) {
    if (facts.redacted || !facts.erased || facts.erasedOn === null) return { kind: "r4_redacted" };
    return { kind: "erased", contentErasedOn: facts.erasedOn, postKept: facts.targetType === "post" && !facts.postDeleted && !facts.postErased };
  }
  if (facts.targetType === "account") return { kind: "account", handle: facts.handle, displayName: facts.displayName ?? "", bio: facts.bio ?? "" };
  // A sealed image is shown to nobody, its author included, and an image of a post its author deleted is kept for the
  // case and served to nobody: for either, the answer carries how many there are and nothing of them. Otherwise the
  // author's own image route serves each image, a withheld or removed one too; an image whose description the snapshot
  // does not hold was erased before the copy was taken, and is not listed.
  const imagesHidden = facts.sealed ? "sealed" : facts.postDeleted ? "deleted_by_author" : null;
  const images =
    imagesHidden === null
      ? facts.images.flatMap((image) => (image.alt === null ? [] : [{ id: image.id, alt: image.alt, width: image.width, height: image.height, small: mediaPath(image.id, "small"), large: mediaPath(image.id, "large") }]))
      : [];
  return { kind: "post", body: facts.body ?? "", deletedByAuthor: facts.postDeleted, images, imageCount: facts.images.length, imagesHidden };
}

/**
 * The author's appeal as their screen shows it (3c design, section 7.7). A pending appeal says whether anyone may review
 * it now and whether its review is an admin's, in the database's own two answers, which name nobody. An answered one
 * carries the statement of the decision that answered it: the review, or the correction that reversed everything before
 * a review came, read as every statement is and so told to the author in the same words as its mail.
 */
async function appealOf(deps: Pick<ModerationDeps, "apiDb">, appeal: AuthorAppealFacts): Promise<DecisionAppeal> {
  if (appeal.answeredBy === null || appeal.result === null || appeal.answeredOn === null) {
    // An appeal that is not answered always has a reviewer state: the database answers null only for an answered one.
    return { state: "pending", filedAt: appeal.filedAt, reviewer: appeal.reviewer ?? "none_eligible", needsAdmin: appeal.needsAdmin };
  }
  const answer = await decisionStatement(deps.apiDb, appeal.answeredBy);
  if (!answer) throw new Error("an appeal is answered by a decision that does not exist");
  return { state: "answered", filedAt: appeal.filedAt, answeredOn: appeal.answeredOn, result: appeal.result, answeredBy: appeal.answeredBy, statement: answer.statement };
}

/**
 * GET /api/moderation/decisions/:id: one decision as its author reads it, or not_found: for an id that names no
 * decision, for a decision about someone else, and for one its author was not told of.
 */
export async function authorDecisionView(deps: Pick<ModerationDeps, "apiDb"> & Partial<Pick<ModerationDeps, "config">>, viewer: string, decisionId: string): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  const found = await decisionStatement(deps.apiDb, decisionId, deps.config?.HOME_STATE ?? null);
  if (!found) throw new ModerationError("not_found");
  // 3f (section 10.4): an order's notice is read fresh, with the authority's words and (Task 4) the day the preservation's
  // end erased the post; the post is never shown while the order's measure stands, nor after that erasure.
  const notice = found.statement.order ? await orderNoticeOf(deps.apiDb, decisionId, deps.config?.HOME_STATE ?? null) : null;
  return {
    id: decisionId,
    ...found.statement,
    appealUntil: facts.appealUntil,
    reversedOn: facts.reversedOn,
    content: facts.orderInForce || facts.toldWhileDisabled || (notice?.erasedOn ?? null) !== null ? null : contentOf(facts),
    ...(notice !== null ? { orderTexts: notice.texts, erasedOn: notice.erasedOn } : {}),
    appeal: facts.appeal === null ? null : await appealOf(deps, facts.appeal),
    strike: facts.strike,
    // 3e Task 4: where the decision's suspension or termination stands now, beside the statement that never changes.
    standing: await decisionStandingView(deps.apiDb, decisionId),
    // 3e Task 5: and where its restriction of reporting stands now.
    reportingStanding: await reportingStandingView(deps.apiDb, decisionId),
    // 3d Task 6 (sections 7.10, 9.4 and 10.2): "Ask for a person" on a program's decision, read fresh; null otherwise.
    askPerson: await askPersonOf(deps.apiDb, decisionId),
  };
}

// ---------------------------------------------------------------- the export's decisions

/** A decision as the account's export lists it. */
export type ExportedDecision = ExportFormat["moderation"]["decisions"][number];

/** How many decisions the export reads at a time: one statement for the page, and then each decision's statement. */
const EXPORT_PAGE_SIZE = 100;

/**
 * One decision as the export writes it (3c design, section 7.11), from the two things its author's screens are built
 * from: its row in the list and its statement's data. So the entry holds what those screens show and nothing they do
 * not: the facts and the reason of a decision that restricted nothing are not in the statement's data, and a text that
 * was erased is null there. A statement names its source as a category; the entry does not carry even that.
 */
export function exportedDecision(
  row: Pick<AuthorDecisionRow, "id" | "decidedOn" | "post" | "appeal">,
  statement: DecisionStatement,
  texts: OrderTexts | null = null,
  erasedOn: string | null = null,
  objection: { text: string; createdAt: string } | null = null,
): ExportedDecision {
  return {
    id: row.id,
    decidedOn: row.decidedOn,
    // The entry of the export's `posts` a decision about a post concerns: a post keeps its row through its deletion.
    postId: row.post?.id ?? null,
    kind: statement.kind,
    outcome: statement.outcome,
    ground: statement.ground,
    ruleId: statement.ruleId,
    rulesVersion: statement.rulesVersion,
    measures: statement.measures.map((measure) => ({ kind: measure.kind, mediaId: measure.mediaId, noEffect: measure.noEffect })),
    reversals: statement.reversals.map((reversal) => ({ kind: reversal.kind, mediaId: reversal.mediaId })),
    facts: statement.facts,
    reason: statement.reason,
    legalReference: statement.legalReference,
    appeal: row.appeal === null ? null : row.appeal === "pending" ? { state: "pending", result: null } : { state: "answered", result: row.appeal },
    // 3f (W.7): an order's notice as its facts, with the authority's words read at the export's time and (Task 4) the day
    // the preservation's end erased the post.
    ...(statement.order ? { order: statement.order, ...(texts ? { orderTexts: texts } : {}), erasedOn } : {}),
    // 3d Task 8 (W.10): what the statement says of automated means, read as the statement reads it (a decision made before
    // 3d: false, not_automated and null), and the text its subject sent with "Ask for a person", with its time.
    automatedDetection: statement.automatedDetection ?? false,
    automatedDecision: statement.automatedDecision ?? "not_automated",
    signal: statement.signal ?? null,
    objection,
  };
}

/**
 * The export's `decisions` (ModerationForAccount.exportFor): every decision about the account that its Cases screen
 * lists, which are those its author was told of, newest first as the screen lists them. Read through the list's own
 * query, a page at a time, and each decision's statement through the statement's own read, so no decision the author was
 * not told of, and nothing a statement does not tell, can be in an export.
 */
export async function exportedDecisions(deps: Pick<ModerationDeps, "apiDb">, accountId: string): Promise<ExportedDecision[]> {
  const exported: ExportedDecision[] = [];
  let after: ListCursor | null = null;
  for (;;) {
    const page: AuthorDecisionRow[] = await authorDecisions(deps.apiDb, accountId, after, EXPORT_PAGE_SIZE);
    for (const row of page) {
      const found = await decisionStatement(deps.apiDb, row.id);
      // A decision is a row for good: one the list has just named has a statement.
      if (!found) throw new Error("a decision in its author's list has no statement");
      const notice = found.statement.order ? await orderNoticeOf(deps.apiDb, row.id, null) : null;
      // 3d Task 8 (W.10): only a program's decision can have been asked about.
      const objection = found.statement.automatedDecision === "fully" ? await objectionOf(deps.apiDb, row.id) : null;
      exported.push(exportedDecision(row, found.statement, notice?.texts ?? null, notice?.erasedOn ?? null, objection));
    }
    const last = page.at(-1);
    // A page that is not full is the last one.
    if (page.length < EXPORT_PAGE_SIZE || !last) return exported;
    after = { at: last.sortAt, id: last.id };
  }
}

// ---------------------------------------------------------------- the chip

/**
 * ModerationForSocial.authorFacts: for each of these posts that the viewer wrote and that is withheld or removed, the
 * decision its chip names. One query a page, asked only when the viewer wrote some of the page's restricted posts.
 */
export function authorFacts(deps: Pick<ModerationDeps, "apiDb">, viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  return chipFacts(deps.apiDb, viewer, postIds);
}
