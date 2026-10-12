import { staffTextProblem, textDigest, type StaffTextDraft, type StaffTextSaveRequest, type StaffTextSaved, type StaffTextsResponse } from "@korbat/contracts";
import type { ActiveStaffSession } from "../auth";
import { refuseRecused } from "./cases";
import { ModerationError, type ModerationDeps } from "./context";
import { countOrRefuse } from "./intake";
import { quotesUser } from "./overlap";
import { caseById, insertStaffText, ownDraftByDigest, ownDrafts, theirTexts, violatedUniqueConstraint } from "./repo";

/**
 * The saved texts (3c design, section 7.4): every free text a decision, a review or a reveal carries is saved first,
 * without the key, salted and digested by the console. The confirming params then carry only its digest, so the audit
 * chain never holds a typed text, and a text can be erased while its digest stays. Saving changes nothing a user sees: a
 * text enters the record only through a confirmed decision or reveal that names its digest. A note and a recorded choice
 * not to seal are complete when saved.
 */

/** How many texts one staff account may save in a minute. */
export const TEXT_SAVES_PER_MINUTE = 60;

/** The case, after the recusal check; not_found when no case has the id. */
async function caseForTexts(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<void> {
  await refuseRecused(deps, session, caseId);
  if (!(await caseById(deps.apiDb, caseId))) throw new ModerationError("not_found");
}

/**
 * POST /api/staff/cases/:case/texts. The server stores the text as it was written or refuses it, and never changes it. In
 * this order:
 *   1. the recusal check, and the limit of saves a minute for one staff account;
 *   2. no text is saved empty, whatever its kind (invalid_request): a text of nothing, or of white space alone, says
 *      nothing, and a reveal's reason, a decision's facts or a recorded choice not to seal must say something to be one;
 *   3. what a text must be (text_invalid): well formed, no control character but the line feed, no invisible direction
 *      or spacing character, at most 5000 UTF-16 units;
 *   4. the overlap check, for every kind but a note and a recorded choice not to seal (text_quotes_user): staff
 *      paraphrase what a reporter, a notifier or an appellant wrote on this case, and never quote it;
 *   5. the digest, recomputed here from the salt and the text (text_invalid when it differs from the request's);
 *   6. the row, whose own CHECK holds text, salt and digest together.
 * The same text saved again with the same salt by the same person answers the row already stored.
 */
export async function saveText(deps: Pick<ModerationDeps, "apiDb" | "limits">, session: ActiveStaffSession, caseId: string, request: StaffTextSaveRequest): Promise<StaffTextSaved> {
  await caseForTexts(deps, session, caseId);
  await countOrRefuse(deps, `staff-text:${session.userId}`, 60_000, TEXT_SAVES_PER_MINUTE);

  if (request.text.trim() === "") throw new ModerationError("invalid_request");
  if (staffTextProblem(request.text) !== null) throw new ModerationError("text_invalid");
  if (quotesUser(request.kind, request.text, await theirTexts(deps.apiDb, caseId))) throw new ModerationError("text_quotes_user");
  if ((await textDigest(request.salt, request.text)) !== request.digest) throw new ModerationError("text_invalid");

  const row = { caseId, authorId: session.userId, kind: request.kind, text: request.text, salt: request.salt, digest: request.digest };
  try {
    // A transaction of its own: a refused insert then undoes nothing but itself, whatever the caller runs this inside.
    const id = await deps.apiDb.transaction((tx) => insertStaffText(tx, row));
    return { id, digest: request.digest };
  } catch (err) {
    if (violatedUniqueConstraint(err) !== "staff_texts_digest_unique") throw err;
    // A digest is stored once. The person's own draft of this kind on this case is the same save sent again; anything
    // else that holds the digest is not theirs to name.
    const own = await ownDraftByDigest(deps.apiDb, row);
    if (own === null) throw new ModerationError("text_invalid");
    return { id: own, digest: request.digest };
  }
}

/**
 * GET /api/staff/cases/:case/texts: the person's own drafts on the case, with their salts, so a draft survives a reload
 * or a sign-in. The console recomputes each digest and drops one that does not match.
 */
export async function ownTexts(deps: Pick<ModerationDeps, "apiDb">, session: ActiveStaffSession, caseId: string): Promise<StaffTextsResponse> {
  await caseForTexts(deps, session, caseId);
  return { texts: (await ownDrafts(deps.apiDb, caseId, session.userId)) as StaffTextDraft[] };
}
