import { AUTHOR_CASES_PAGE_SIZE, mediaPath, type AuthorCasesPage, type DecisionContent, type DecisionView, type PostModeration, type RuleId } from "@korbat/contracts";
import { authorDecision, authorDecisions, chipFacts, type AuthorDecisionFacts } from "./author-repo";
import { ModerationError, type ModerationDeps } from "./context";
import { decisionStatement } from "./statement";

/**
 * What the author of a post or the holder of an account reads about korbat's decisions on it (3c design, sections 7.6 and
 * 10): the list of decisions they were told of, one decision with its statement's data and the content it was made on,
 * and the facts behind the chip on their own post. Everything here is built from the author's queries and the statement's
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
    })),
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > AUTHOR_CASES_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
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
 * GET /api/moderation/decisions/:id: one decision as its author reads it, or not_found: for an id that names no
 * decision, for a decision about someone else, and for one its author was not told of.
 */
export async function authorDecisionView(deps: Pick<ModerationDeps, "apiDb">, viewer: string, decisionId: string): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  const found = await decisionStatement(deps.apiDb, decisionId);
  if (!found) throw new ModerationError("not_found");
  return { id: decisionId, ...found.statement, appealUntil: facts.appealUntil, reversedOn: facts.reversedOn, content: contentOf(facts) };
}

// ---------------------------------------------------------------- the chip

/**
 * ModerationForSocial.authorFacts: for each of these posts that the viewer wrote and that is withheld or removed, the
 * decision its chip names. One query a page, asked only when the viewer wrote some of the page's restricted posts.
 */
export function authorFacts(deps: Pick<ModerationDeps, "apiDb">, viewer: string, postIds: readonly string[]): Promise<Map<string, PostModeration>> {
  return chipFacts(deps.apiDb, viewer, postIds);
}
