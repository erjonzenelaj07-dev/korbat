import { createJob, type JobLock } from "../lib/jobs";
import type { AccountDeps } from "./context";
import { purge } from "./flows/deletion";

/** How often the job looks for deletions left half done (1b design, section 11): nothing stays behind for longer than this. */
export const PURGE_INTERVAL_MS = 5 * 60 * 1000;

export interface PurgeReport {
  purged: number;
  failed: number;
}

/**
 * One round: every account the auth module reports as deleted but not purged is run through the
 * purge, oldest deletion first. A failure is logged with the account and counted; the account stays
 * pending and is tried again next round. A plain function, so tests call it directly.
 */
export async function purgePending(deps: AccountDeps): Promise<PurgeReport> {
  const report: PurgeReport = { purged: 0, failed: 0 };
  for (const userId of await deps.auth.pendingPurges()) {
    try {
      await purge(deps, userId);
      report.purged++;
    } catch (err) {
      report.failed++;
      deps.log.error({ err, userId }, "account purge: the account could not be purged; it stays pending for the next round");
    }
  }
  // As the janitor: a round that did something is logged with its counts, an idle one is not.
  if (report.purged > 0 || report.failed > 0) deps.log.info(report, "account purge: round finished");
  return report;
}

/** Runs the round every five minutes under the shared lock job:account-purge, one instance at a time. */
export function createPurgeJob(deps: AccountDeps, lock: JobLock) {
  return createJob({ name: "account-purge", intervalMs: PURGE_INTERVAL_MS, lockTtlMs: PURGE_INTERVAL_MS, lock, log: deps.log, run: () => purgePending(deps) });
}
