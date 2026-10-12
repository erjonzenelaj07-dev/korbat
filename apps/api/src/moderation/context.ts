import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { AuthForModeration } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "onboarding_required" | "rate_limited" | "service_unavailable";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
  notice_link_invalid: 422,
  notice_link_offsite: 422,
  human_check_failed: 403,
  staff_cannot_report: 403,
  notice_not_found: 404,
  already_reported: 409,
  case_changed: 409,
  case_closed: 409,
  staff_recused: 403,
  staff_target: 403,
  admin_required: 403,
  decision_cap: 429,
  profile_changed: 409,
  snapshot_mismatch: 409,
  snapshot_erased: 409,
  text_not_found: 409,
  invalid_decision: 422,
  not_found: 404,
  invalid_request: 400,
  onboarding_required: 403,
  rate_limited: 429,
  service_unavailable: 503,
};

// Those of the notice routes, and the first three after them, are written for the person reporting; the rest for staff,
// whose console words them again for the screen. The human check's names no contact address: the API holds none, and the
// app words that code itself.
const MESSAGES: Record<ModerationErrorKind, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "No report matches that reference and link.",
  already_reported: "You already reported this; it is being looked at.",
  case_changed: "The case changed since it was opened. Open it again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused: "You cannot act on this case: you, or an account close to you, are a party to it.",
  staff_target: "A final decision cannot restrict a staff account. Staff are disciplined by demotion.",
  admin_required: "Only an admin can take this decision.",
  decision_cap: "You have reached the limit on decisions for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds.",
  snapshot_erased: "The snapshot was erased. Take a fresh one and decide again.",
  text_not_found: "A text of this decision is not saved, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  // The words requireSession answers with: a route with an optional session refuses such a session itself.
  onboarding_required: "Choose a handle to finish setting up your account.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected failure of a moderation flow. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorKind,
    readonly status: ModerationErrorStatus = STATUS[code],
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ModerationError";
  }
}

export function moderationErrorMessage(code: ModerationErrorKind): string {
  return MESSAGES[code];
}

/** Whether a message the database raised is one of the module's codes, which the triggers raise as their message. */
export function isModerationErrorCode(message: string): message is ModerationErrorCode {
  return ModerationErrorCode.safeParse(message).success;
}

/**
 * The work a request starts and does not wait for: the mails after a report or a notice (3c design, section 7.1, step
 * 5). The answer, which carries the reference and the token, must never wait for a relay. Every task's error is caught
 * and logged here, and the tasks are kept until they end, so that `settle` can wait for them all.
 */
export interface Background {
  start(task: () => Promise<void>): void;
  /** Resolves once every started task has ended, those started meanwhile included. */
  settle(): Promise<void>;
}

export function createBackground(log: Logger): Background {
  const running = new Set<Promise<void>>();
  return {
    start(task) {
      const run = (async () => {
        try {
          await task();
        } catch (err) {
          log.error({ err }, "moderation: a task started after a request failed");
        }
      })();
      running.add(run);
      void run.then(() => running.delete(run));
    },
    async settle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

export interface ModerationDeps {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's interface: the human check, a notifier's contact and every mail. The module never sees an address. */
  auth: AuthForModeration;
  /** The social module's interface: the locks on profile rows and the reads evidence is copied from. */
  social: SocialForModeration;
  /** The media module's interface: an intake's holds on image rows, which this module never names itself. */
  media: MediaForCases;
  /** The shared limit store: what one sender may send, and the throttles of the staff alerts. */
  limits: RateLimitStore;
  /** The tasks requests started and did not wait for. */
  background: Background;
  config: Config;
  log: Logger;
  now: () => Date;
}
