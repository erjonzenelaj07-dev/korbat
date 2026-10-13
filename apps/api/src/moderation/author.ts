import {
  AUTHOR_CASES_PAGE_SIZE,
  mediaPath,
  type AuthorCasesPage,
  type DecisionAppeal,
  type DecisionContent,
  type DecisionStatement,
  type DecisionView,
  type ExportFormat,
  type PostModeration,
  type RuleId,
} from "@korbat/contracts";
import { authorDecision, authorDecisions, chipFacts, type AuthorAppealFacts, type AuthorDecisionFacts, type AuthorDecisionRow } from "./author-repo";
import { ModerationError, type ModerationDeps } from "./context";
import { decisionStatement } from "./statement";
import { decisionStandingView } from "./standing";
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
export async function authorDecisionView(deps: Pick<ModerationDeps, "apiDb">, viewer: string, decisionId: string): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found) throw new ModerationError("not_found");
  return {
    id: decisionId,
    ...found.statement,
    appealUntil: facts.appealUntil,
    reversedOn: facts.reversedOn,
    content: contentOf(facts),
    appeal: facts.appeal === null ? null : await appealOf(deps, facts.appeal),
    strike: facts.strike,
    // 3e Task 4: where the decision's suspension or termination stands now, beside the statement that never changes.
    standing: await decisionStandingView(deps.apiDb, decisionId),
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
export function exportedDecision(row: Pick<AuthorDecisionRow, "id" | "decidedOn" | "post" | "appeal">, statement: DecisionStatement): ExportedDecision {
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
      exported.push(exportedDecision(row, found.statement));
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
