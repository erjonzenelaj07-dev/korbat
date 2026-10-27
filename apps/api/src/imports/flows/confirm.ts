import { randomBytes } from "node:crypto";
import { ConfirmImportRequest, IMPORT_RULES, type ImportView } from "@korbat/contracts";
import { enforceImportLimit, ImportError, type ImportDeps } from "../context";
import { chosenTotals } from "../plan";
import { importView, scanOf } from "../view";

/**
 * POST /api/imports/:id/confirm (3b design, sections 4.5 step 1, 8.5, 9.2 and 9.5): the person's choice and statement,
 * counted in import-act. A body without the statement is statement_required (decision 14), any other bad body
 * invalid_request; a suspended account is refused (8.5: a confirmation starts writes), read through the profile store; the
 * import must be ready; `from` and `to` must lie within the scan's months; a choice that holds no post is nothing_chosen.
 * The totals are counted as the app counts them under the choice, from the month table and the picks, before the
 * confirmation cuts the table, and kept as the scan's member `chosen` (the orchestrator's ruling). One UPDATE then writes
 * the state, the choice, the statement's time, confirmed_at, a fresh seed of IMPORT_RULES.seedBytes and the cut scan: the
 * import prepares when it and the choice bring images and the choice holds at least one to feed, and publishes at once
 * otherwise. The picks stay until the import ends; the feeder and the publisher read them.
 */

/** Whether a refused body would be taken but for its statement: then the person did not tick it. */
function lacksStatement(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  if ((body as { statement?: unknown }).statement === true) return false;
  return ConfirmImportRequest.safeParse({ ...body, statement: true }).success;
}

export async function confirmImport(deps: ImportDeps, ownerId: string, id: string, body: unknown): Promise<ImportView> {
  const parsed = ConfirmImportRequest.safeParse(body);
  if (!parsed.success) throw new ImportError(lacksStatement(body) ? "statement_required" : "invalid_request");
  await enforceImportLimit(deps, "import-act", ownerId);
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  // 8.5: the writes a confirmation starts are judged by 3e's predicate where they are written; the confirmation itself is
  // refused while the suspension runs, read as the badge's start reads it.
  if (await deps.profiles.suspended(ownerId)) throw new ImportError("account_suspended");
  const scan = scanOf(row);
  if (row.status !== "ready" || scan === null) throw new ImportError("wrong_state");
  const { choice } = parsed.data;
  // 9.5: a range outside the months the archive has is not a choice the preview offered.
  const within = (month: string | null) => month === null || (scan.first !== null && scan.last !== null && month >= scan.first && month <= scan.last);
  if (!within(choice.from) || !within(choice.to)) throw new ImportError("invalid_request");
  const images = row.images && choice.images;
  const chosen = chosenTotals(scan, await deps.repo.picks(id), choice, images);
  if (chosen.posts === 0) throw new ImportError("nothing_chosen");
  const status = images && chosen.images > 0 ? "preparing" : "publishing";
  const seed = randomBytes(IMPORT_RULES.seedBytes);
  if (!(await deps.repo.confirm({ id, ownerId, status, choice, seed, chosen }))) throw new ImportError("wrong_state");
  deps.log.info({ id, phase: status, posts: chosen.posts, images: chosen.images }, "import: confirmed");
  const confirmed = await deps.repo.find(id, ownerId);
  if (!confirmed) throw new ImportError("not_found");
  return importView(deps, confirmed);
}
