import { createJob, type JobLock } from "../lib/jobs";
import type { AuthDeps } from "./context";
import { HOUR, MINUTE } from "./limits";

const DAY = 24 * HOUR;

export const JANITOR_INTERVAL_MS = 10 * MINUTE;
/** A code is dead ten minutes after it was sent; the row goes a day later. */
export const EMAIL_CODE_RETENTION_MS = 24 * HOUR;
/** Revoked and expired sessions stay listed nowhere; the rows go after a month. */
export const SESSION_RETENTION_MS = 30 * DAY;
/** The design's IP-hash purge (section 3b): a device keeps its address hash for 30 days after it was last seen. */
export const DEVICE_IP_RETENTION_DAYS = 30;
/** The security log is kept for 90 days. */
export const EVENT_RETENTION_DAYS = 90;

export interface JanitorReport {
  emailCodes: number;
  sessions: number;
  deviceIpHashes: number;
  events: number;
}

/** One pass of retention. A plain function of the clock, so tests call it with whatever time they need. */
export async function janitor(deps: AuthDeps, now: Date): Promise<JanitorReport> {
  const report: JanitorReport = {
    emailCodes: await deps.repo.purgeEmailCodes(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS)),
    sessions: await deps.repo.purgeSessions(new Date(now.getTime() - SESSION_RETENTION_MS)),
    deviceIpHashes: await deps.repo.purgeDeviceIpHashes(new Date(now.getTime() - DEVICE_IP_RETENTION_DAYS * DAY)),
    events: await deps.repo.purgeEvents(EVENT_RETENTION_DAYS),
  };
  if (Object.values(report).some((n) => n > 0)) deps.log.info(report, "auth janitor: rows purged");
  return report;
}

/** Runs the pass every ten minutes under the shared lock. */
export function createJanitor(deps: AuthDeps, lock: JobLock) {
  return createJob({ name: "auth-janitor", intervalMs: JANITOR_INTERVAL_MS, lockTtlMs: JANITOR_INTERVAL_MS, lock, log: deps.log, run: () => janitor(deps, deps.now()) });
}
