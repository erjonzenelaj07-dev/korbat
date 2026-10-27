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
