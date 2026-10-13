import type { StaffMessage } from "../auth";
import type { ModerationDeps } from "./context";
import { urgentWaiting } from "./repo";

/**
 * Staff alerts before the phone channel of sub-project 3f (3c design, section 7.12; 3e moved the channel there): a mail
 * to every live staff account, with counts and times only and never a link or content. The moderation module, which
 * never sees an address, keeps each alert's throttle as one key of the shared limit store.
 */

/** The key and the window of the urgent lane's alert. The dispatch job repeats the alert under the same key. */
export const URGENT_ALERT_KEY = "moderation-urgent";
export const URGENT_ALERT_WINDOW_MS = 15 * 60_000;

/**
 * Sends a staff alert at most once in its key's window: the key is hit, and the mail goes when the count is 1. When no
 * address took the mail the hit is given back, so the next occasion that meets the alert's condition sends it again; a
 * failed give-back is logged. The alert fails open: when the store cannot be reached, the mail goes without a throttle.
 * Answers what happened; it never throws for a failed send, which mailStaff logs.
 */
export async function staffAlert(deps: Pick<ModerationDeps, "auth" | "limits" | "log">, key: string, windowMs: number, message: StaffMessage): Promise<"sent" | "throttled" | "unsent"> {
  let counted = false;
  try {
    const hit = await deps.limits.hit(key, windowMs);
    counted = true;
    if (hit.count > 1) return "throttled";
  } catch (err) {
    deps.log.warn({ err, alert: key }, "moderation alert: the limit store could not be reached; the alert goes without its throttle");
  }
  const accepted = await deps.auth.mailStaff(message);
  if (accepted > 0) return "sent";
  if (counted) {
    await deps.limits.release(key).catch((err: unknown) => deps.log.warn({ err, alert: key }, "moderation alert: the hit of an alert nobody received could not be given back"));
  }
  return "unsent";
}

/**
 * The urgent lane's alert: when an intake has put an item into lane 0, every staff account is told how many cases wait
 * there and since when the oldest does. A notice about a post that quotes another puts two cases into the lane and sends
 * one mail that counts both. Best effort, after the commit and the answer; the dispatch job repeats it while a lane-0
 * item still calls for someone.
 */
export async function alertUrgentLane(deps: Pick<ModerationDeps, "apiDb" | "auth" | "limits" | "log">): Promise<"sent" | "throttled" | "unsent" | "nothing_waiting"> {
  const waiting = await urgentWaiting(deps.apiDb);
  // Decided in the moment between the intake's commit and this read: nothing is left to alert about.
  if (waiting.count === 0 || waiting.oldest === null) return "nothing_waiting";
  return staffAlert(deps, URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, { template: "moderation_urgent", count: waiting.count, oldest: waiting.oldest });
}
