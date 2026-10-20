import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { AuthForModeration } from "../auth";
import type { Config } from "../config";
import type { MediaForCases } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises; 3e's account_suspended is the social module's code, shared. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "onboarding_required" | "rate_limited" | "service_unavailable" | "account_suspended";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
  notice_link_invalid: 422,
  notice_link_offsite: 422,
  human_check_failed: 403,
  staff_cannot_report: 403,
  notice_not_found: 404,
  already_reported: 409,
  appeal_not_open: 422,
  appeal_exists: 409,
  reexamination_not_open: 422,
  reexamination_exists: 409,
  case_changed: 409,
  case_closed: 409,
  staff_recused: 403,
  staff_target: 403,
  admin_required: 403,
  reviewer_conflict: 403,
  decision_cap: 429,
  profile_changed: 409,
  snapshot_mismatch: 409,
  snapshot_erased: 409,
  text_not_found: 409,
  invalid_decision: 422,
  text_invalid: 422,
  text_quotes_user: 422,
  image_refused: 404,
  reveal_refused: 422,
  // 3e (design, section 10.5).
  reporting_restricted: 403,
  reply_not_open: 422,
  strike_mismatch: 409,
  standing_conflict: 409,
  ground_not_established: 422,
  // 3f (design, section 10.6).
  message_handled: 409,
  order_needs_message: 422,
  order_exists: 409,
  order_closed: 409,
  order_event_refused: 422,
  already_released: 409,
  // Task 3 (giving effect).
  order_changed: 409,
  order_not_verified: 422,
  order_cap: 429,
  not_appealable: 422,
  // 3f Task 6 (section 10.6).
  gap_mismatch: 409,
  copy_mismatch: 409,
  // 3d Task 2 (section 10.7): the release's refusals, in the order seal_release checks them, and its check at commit.
  release_not_open: 409,
  release_not_reported: 422,
  release_not_quarantined: 422,
  release_preserved: 422,
  release_no_leave: 422,
  release_period_unset: 422,
  release_period_running: 422,
  release_mismatch: 409,
  not_found: 404,
  invalid_request: 400,
  onboarding_required: 403,
  rate_limited: 429,
  service_unavailable: 503,
  account_suspended: 403,
};

// Those of the notice routes, of the appeal and of the re-examination are written for the person reporting or reported; the
// rest for staff, whose console words them again for the screen. A recusal's words never say whether the conflict concerns the case's
// subject or someone who reported. The human check's names no contact address: the API holds none, and the
// app words that code itself.
const MESSAGES: Record<ModerationErrorKind, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "No report matches that reference and link.",
  already_reported: "You already reported this; it is being looked at.",
  // One answer for every appeal that is not open: the decision cannot be appealed, its time has passed, or nothing of it is in force.
  appeal_not_open: "This decision cannot be appealed now.",
  appeal_exists: "You have already appealed this decision.",
  reexamination_not_open: "A re-examination cannot be asked for this item now.",
  reexamination_exists: "A re-examination of this item has already been asked for.",
  case_changed: "The case changed since it was opened. Open it again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused: "You cannot act on this case: you, or an account close to you, are a party to it.",
  staff_target: "A final decision cannot restrict a staff account. Staff are disciplined by demotion.",
  admin_required: "Only an admin can take this decision.",
  reviewer_conflict: "You cannot review this appeal: you took part in its case.",
  decision_cap: "You have reached the limit on decisions for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds.",
  snapshot_erased: "The snapshot was erased. Take a fresh one and decide again.",
  text_not_found: "A text of this decision is not saved, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  text_invalid: "This text cannot be saved as it is: it is too long, holds a character that cannot be kept, or does not match its digest.",
  text_quotes_user: "This text quotes what someone wrote about this case. Describe it in your own words.",
  // One answer for every image that is not shown, whatever the reason: sealed, frozen, erased, or not of this case.
  image_refused: "That image is not shown.",
  reveal_refused: "Nobody can be revealed for this item.",
  // 3e: one sentence each, for the person or for staff as the code concerns them; the console and the app word them again.
  reporting_restricted: "Your reports under korbat's rules are restricted for now. Notices of illegal content stay open to you.",
  reply_not_open: "This measure takes no reply: it has ended, was lifted, or has a reply already.",
  strike_mismatch: "The strike rule changed for this post since the case was read. Read it again and decide again.",
  standing_conflict: "A suspension or termination of this account already stands and has not ended.",
  ground_not_established: "No termination can rest on a report of images that korbat has not assessed.",
  // 3f: for staff; the console words them again.
  message_handled: "That message was already handled.",
  order_needs_message: "Pick the message this came in.",
  order_exists: "An order of this authority with this reference is already recorded.",
  order_closed: "This order is closed.",
  order_event_refused: "That cannot be recorded now: the order is not in that state.",
  already_released: "The author's notice of this order was already released, or its hold was ended.",
  order_changed: "The order is not what was confirmed: read it again.",
  order_not_verified: "This order is given effect only after it is verified, or by an admin as urgent.",
  order_cap: "This staff account has given effect to as many order items as one account may in 24 hours.",
  not_appealable: "korbat's appeal does not apply to this: it is not korbat's decision.",
  gap_mismatch: "That gap is closed already, or this decision does not take again what it lost.",
  copy_mismatch: "That place does not hold that hash, or your newest confirmed download did not release it.",
  release_not_open: "This seal cannot be released: it is not a seal for good in force, or its posts are released already.",
  release_not_reported: "No report of this seal to an authority is recorded.",
  release_not_quarantined: "Not every file of this seal is recorded as moved to the quarantine.",
  release_preserved: "A post of this seal is preserved for an authority's order.",
  release_no_leave: "No leave or instruction to destroy is recorded for this.",
  release_period_unset: "korbat has set no period after which sealed images are released.",
  release_period_running: "The period has not ended, the author was not told the day in time, or an objection is unanswered.",
  release_mismatch: "The seal, the record of the report or the recorded leave is no longer what was confirmed.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  // The words requireSession answers with: a route with an optional session refuses such a session itself.
  onboarding_required: "Choose a handle to finish setting up your account.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  // 3e (design, section 7.9 step 7): a report under a rule by an account whose suspension runs, in the social module's words.
  account_suspended: "Your account is suspended, so you cannot do this now.",
};

/** An expected failure of a moderation flow. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorKind,
    readonly status: ModerationErrorStatus = STATUS[code],
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
    /** 3f: the one refusal that carries a member, order_exists, names the order that stands (section 10.6). */
    readonly details?: unknown,
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
