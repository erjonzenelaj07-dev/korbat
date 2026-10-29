import type { Logger } from "pino";
import { createJob, type JobLock } from "../lib/jobs";
import type { ActivityRepo } from "./repo";

/** The job's name: its rounds run under the shared lock job:activity-retention, and its log line carries it. */
export const RETENTION_JOB = "activity-retention";
/** A round every hour (5.10). */
export const RETENTION_INTERVAL_MS = 60 * 60_000;
/** How long the lock outlives a crash; a round is refreshed every half of it while it runs. */
const RETENTION_LOCK_MS = 15 * 60_000;
/** Entries one statement deletes (5.10), so no round holds a long lock on the table. */
export const RETENTION_BATCH = 5_000;

/**
 * The job activity-retention (2d design, sections 5.10 and 11.1; decision 11): under a Valkey lock, one instance at a time,
 * every hour, it deletes the entries written more than ACTIVITY_KEEP_DAYS ago, a batch at a time by id until a batch
 * comes back short, and logs only how many went, never an id, an account or a time. The seen marker, the rules and the
 * mentions have no retention of their own: they live as long as the account and its posts. `batch` is a test's to lower.
 */
export function createRetentionJob(deps: { repo: ActivityRepo; log: Logger }, lock: JobLock, batch: number = RETENTION_BATCH) {
  return createJob({
    name: RETENTION_JOB,
    intervalMs: RETENTION_INTERVAL_MS,
    lockTtlMs: RETENTION_LOCK_MS,
    lock,
    log: deps.log,
    run: async () => {
      let deleted = 0;
      for (;;) {
        const gone = await deps.repo.deleteExpired(batch);
        deleted += gone;
        if (gone < batch) break;
      }
      if (deleted > 0) deps.log.info({ job: RETENTION_JOB, deleted }, "activity: old entries deleted");
    },
  });
}
