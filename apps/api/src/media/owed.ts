import type { MediaDeps } from "./context";

/**
 * Deletions that are owed (3c design, sections 7.9 and 7.10, as the review of the built code corrected them). The
 * account's purge and the retention job's disposal delete image rows in a transaction and may ask the worker for the
 * files only after its commit: a row that came back with a failed commit can be frozen by a report the next moment, and
 * the worker deletes whatever a request names. Between the commit and the request the process can stop, and the request
 * itself can fail (a full or read-only uploads volume). So each of the two writes a note for every row it deletes,
 * inside its transaction (files.oweDeletion), and removes it once the request stands. What is left is retried here, by
 * one path for both: the sweeper calls it at every pass, and the disposal before it takes a new batch.
 *
 * A note says only that somebody meant to delete the row. The row decides: while it exists, nothing is asked of the
 * worker, however old the note is.
 */

/**
 * A note this old whose row is still there was written by a transaction that did not commit, and is forgotten. Far longer
 * than any transaction that deletes image rows stays open: a note is never forgotten while its transaction may still
 * commit, since the delete it stands for is not visible to this read until then.
 */
export const OWED_STALE_MS = 60 * 60_000;

/**
 * A deletion owed for longer than this counts among the late erasures of the staff's home screen: one round of the
 * retention job. A request normally follows its commit within the moment, and the sweeper retries every thirty seconds,
 * so one this old means that requests cannot be written.
 */
export const OWED_LATE_MS = 10 * 60_000;

export interface OwedReport {
  /** Requests written now for rows that are gone. */
  requested: number;
  /** Notes forgotten because their row is still there after an hour. */
  forgotten: number;
  /** Deletions still owed after this try: their rows are gone and their request could not be written. */
  owed: number;
}

/**
 * Writes the request for every owed deletion whose row is gone and removes its note; forgets the note of a row that is
 * still there once it is stale; and answers what it did and what is still owed. A row that is gone is gone for good (the
 * delete committed, or this read would still see it), so its files have no owner and the request is right whoever wrote
 * the note. A request that cannot be written is logged once for the pass, with the count and no id, and its notes stay.
 */
export async function requestOwed(deps: Pick<MediaDeps, "repo" | "files" | "log">, now: number): Promise<OwedReport> {
  const notes = await deps.files.owedDeletions(now);
  if (notes.length === 0) return { requested: 0, forgotten: 0, owed: 0 };
  const kept = await deps.repo.existing(notes.map((note) => note.id));
  const stale = notes.filter((note) => kept.has(note.id) && note.ageMs > OWED_STALE_MS).map((note) => note.id);
  const gone = notes.filter((note) => !kept.has(note.id)).map((note) => note.id);
  await deps.files.settleOwed(stale);
  if (gone.length === 0) return { requested: 0, forgotten: stale.length, owed: 0 };
  try {
    await deps.files.requestDeletion(gone);
    await deps.files.settleOwed(gone);
    return { requested: gone.length, forgotten: stale.length, owed: 0 };
  } catch (err) {
    deps.log.error({ err, owed: gone.length }, "media: the files of deleted images could not be requested; the requests stay owed and are tried again");
    return { requested: 0, forgotten: stale.length, owed: gone.length };
  }
}

/** How many deletions have been owed for longer than OWED_LATE_MS: rows that are gone whose files nobody could ask for. */
export async function owedLate(deps: Pick<MediaDeps, "repo" | "files">, now: number): Promise<number> {
  const old = (await deps.files.owedDeletions(now)).filter((note) => note.ageMs > OWED_LATE_MS).map((note) => note.id);
  if (old.length === 0) return 0;
  const kept = await deps.repo.existing(old);
  return old.filter((id) => !kept.has(id)).length;
}
