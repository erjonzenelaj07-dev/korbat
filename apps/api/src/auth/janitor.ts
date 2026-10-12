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
/** Staff sessions go as the app's sessions do, a month after they were revoked or expired (3a design, section 7). */
export const STAFF_SESSION_RETENTION_MS = 30 * DAY;
/** Enrolment links go as email codes do, a day after they were used or expired; one that can still enrol is never the janitor's. */
export const STAFF_ENROLLMENT_RETENTION_MS = 24 * HOUR;

export interface JanitorReport {
  emailCodes: number;
  sessions: number;
  staffSessions: number;
  staffEnrollments: number;
  deviceIpHashes: number;
  events: number;
  /** Notifier contacts whose day to be forgotten has passed (3c design, section 6.1). */
  notifierContacts: number;
  /** Confirmations of a notifier's address that ran out. */
  notifierConfirmations: number;
}

/**
 * One pass of retention. A plain function of the clock, so tests call it with whatever time they need. Each purge runs
 * in a try of its own: one that throws is logged with its name and counts 0, and the round goes on, so a table that
 * cannot be purged never keeps the others' rows past their time.
 */
export async function janitor(deps: AuthDeps, now: Date): Promise<JanitorReport> {
  const purge = async (name: keyof JanitorReport, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (err) {
      deps.log.error({ err, purge: name }, "auth janitor: purge failed");
      return 0;
    }
  };
  const report: JanitorReport = {
    emailCodes: await purge("emailCodes", () => deps.repo.purgeEmailCodes(new Date(now.getTime() - EMAIL_CODE_RETENTION_MS))),
    sessions: await purge("sessions", () => deps.repo.purgeSessions(new Date(now.getTime() - SESSION_RETENTION_MS))),
    // Staff keys are never deleted: audit-verify checks old confirmations against them, and audit rows name them.
    staffSessions: await purge("staffSessions", () => deps.repo.purgeStaffSessions(new Date(now.getTime() - STAFF_SESSION_RETENTION_MS))),
    staffEnrollments: await purge("staffEnrollments", () => deps.repo.purgeStaffEnrollments(new Date(now.getTime() - STAFF_ENROLLMENT_RETENTION_MS))),
    deviceIpHashes: await purge("deviceIpHashes", () => deps.repo.purgeDeviceIpHashes(new Date(now.getTime() - DEVICE_IP_RETENTION_DAYS * DAY))),
    events: await purge("events", () => deps.repo.purgeEvents(EVENT_RETENTION_DAYS)),
    // A contact goes once its own day has passed, which the moderation module moves while the notice is owed something;
    // a confirmation at the end of its 30 days. Neither has a grace period: the day itself is the published one.
    notifierContacts: await purge("notifierContacts", () => deps.repo.purgeNotifierContacts(now)),
    notifierConfirmations: await purge("notifierConfirmations", () => deps.repo.purgeNotifierConfirmations(now)),
  };
  if (Object.values(report).some((n) => n > 0)) deps.log.info(report, "auth janitor: rows purged");
  return report;
}

/** Runs the pass every ten minutes under the shared lock. */
export function createJanitor(deps: AuthDeps, lock: JobLock) {
  return createJob({ name: "auth-janitor", intervalMs: JANITOR_INTERVAL_MS, lockTtlMs: JANITOR_INTERVAL_MS, lock, log: deps.log, run: () => janitor(deps, deps.now()) });
}
