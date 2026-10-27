import type { ImportView } from "@korbat/contracts";
import { enforceImportLimit, ImportError, type ImportDeps } from "../context";
import { importView } from "../view";

/**
 * The files of an import that has ended before its posts were chosen, or whose scan the drive has read (3b design,
 * sections 4.8, 6.6 and 7.5): its archive folder and queue marker go at once, and the importer is asked to delete its
 * work folder and to stop scanning it (delete/<id>, which the drive withdraws once it is carried out). Each step is safe
 * to repeat and leaves nothing to undo.
 */
export async function endFiles(deps: Pick<ImportDeps, "files">, id: string): Promise<void> {
  await deps.files.removeArchive(id);
  await deps.files.requestWorkDeletion(id);
}

/**
 * POST /api/imports/:id/cancel (9.2): the person's cancel while the archive uploads, waits for its scan or is previewed;
 * counted in import-act. A suspended account may cancel: it only ends and deletes (8.5).
 */
export async function cancelImport(deps: ImportDeps, ownerId: string, id: string): Promise<ImportView> {
  await enforceImportLimit(deps, "import-act", ownerId);
  if (!(await deps.repo.find(id, ownerId))) throw new ImportError("not_found");
  if (!(await deps.repo.cancel(id, ownerId))) throw new ImportError("wrong_state");
  await endFiles(deps, id);
  deps.log.info({ id, phase: "cancelled" }, "import: cancelled");
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  return importView(deps, row);
}

/**
 * POST /api/imports/:id/stop (3b design, sections 4.6 and 9.2): the person's Stop while the import prepares or publishes,
 * counted in import-act, at once and in one UPDATE (stopped, by_author, the seed cleared, ended_at). Published posts stay;
 * the images prepared and on no post go in import-drive's next round (7.4, the leftovers), and the work folder is asked
 * for here, so what was not published goes unopened. A suspended account may stop: it only ends (8.5).
 */
export async function stopImport(deps: ImportDeps, ownerId: string, id: string): Promise<ImportView> {
  await enforceImportLimit(deps, "import-act", ownerId);
  if (!(await deps.repo.find(id, ownerId))) throw new ImportError("not_found");
  if (!(await deps.repo.stop(id, ownerId))) throw new ImportError("wrong_state");
  deps.plans.delete(id);
  await endFiles(deps, id);
  deps.log.info({ id, phase: "stopped", reason: "by_author" }, "import: stopped");
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  return importView(deps, row);
}

/**
 * POST /api/imports/:id/undo (3b design, sections 4.6, 8.5 and 9.2; decision 22): "Remove imported posts" on a done import,
 * or a stopped one with posts published, counted in import-act: one UPDATE to undoing, and import-drive tombstones the
 * posts in batches through the author's own deletion path. Anything else is wrong_state, someone else's import not_found.
 * A suspended account may undo: it only deletes what the account posted, as the author's deletion allows (8.5).
 */
export async function undoImport(deps: ImportDeps, ownerId: string, id: string): Promise<ImportView> {
  await enforceImportLimit(deps, "import-act", ownerId);
  if (!(await deps.repo.find(id, ownerId))) throw new ImportError("not_found");
  if (!(await deps.repo.toUndoing(id, ownerId))) throw new ImportError("wrong_state");
  deps.log.info({ id, phase: "undoing" }, "import: undo asked");
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  return importView(deps, row);
}
