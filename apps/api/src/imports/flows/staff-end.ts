import type { DbTx } from "@korbat/db";
import { ImportError, type ImportDeps } from "../context";
import type { StaffEnd } from "../repo";
import { endFiles } from "./end";

/**
 * An admin's end of a whole import (3b design, section 8.7; decision 30), the imports module's two halves of it. The staff
 * module holds the transaction: it checks the step-up, reads the case's post and the decision through the moderation
 * module, calls `endByStaff` inside its transaction and writes the confirmed audit row last; after the commit it calls
 * `endedByStaff`. The posts then go in import-drive's undo rounds, the person's own path, so freezes, holds and evidence
 * stay right.
 */

/** What the staff module hands over: the import, the case's post, the case and the decision the end rests on, and its rule. */
export interface StaffEndInput {
  id: string;
  postId: string;
  caseId: string;
  decisionId: string;
  ruleId: string;
}

/**
 * The moves of 8.7, in the caller's transaction (repo.endByStaff): not_found for no such import, invalid_request when the
 * case's post is not a post of this import (the end acts only from a case about one of its posts), wrong_state when it was
 * ended by staff already or has nothing to end.
 */
export async function endByStaff(deps: Pick<ImportDeps, "repo">, tx: DbTx, input: StaffEndInput): Promise<StaffEnd> {
  const outcome = await deps.repo.endByStaff(tx, input);
  if (outcome === null) throw new ImportError("not_found");
  if (outcome === "not_of_import") throw new ImportError("invalid_request");
  if (outcome === "wrong_state") throw new ImportError("wrong_state");
  return outcome;
}

/**
 * After the commit: a running import's plan and offset go and its work folder is asked for, so what was not published goes
 * unopened (its prepared images on no post go in import-drive's next round, 7.4); and the person is mailed through the auth
 * module's mailAccount, the rule and that the decision can be appealed (template import_ended_by_staff), never held back
 * by a stop of the address, as a statement is not. A mail that fails is logged: the end stands.
 */
export async function endedByStaff(deps: ImportDeps, end: StaffEnd, basis: { ruleId: string; decisionId: string }): Promise<void> {
  deps.plans.delete(end.id);
  deps.offsets.delete(end.id);
  if (end.from === "preparing" || end.from === "publishing") await endFiles(deps, end.id);
  deps.log.info({ id: end.id, phase: end.to, reason: "by_staff" }, "import: ended by staff");
  try {
    await deps.auth.mailAccount(end.ownerId, { template: "import_ended_by_staff", ruleId: basis.ruleId, decisionId: basis.decisionId });
  } catch (err) {
    deps.log.error({ id: end.id, err }, "import: the person was not mailed about the end of their import");
  }
}
