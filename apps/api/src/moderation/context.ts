import { ModerationErrorCode } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { SocialForModeration } from "../social";

/** The moderation codes plus the shared ones the module also raises. */
export type ModerationErrorKind = ModerationErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type ModerationErrorStatus = 400 | 403 | 404 | 409 | 422 | 429 | 503;

/** What each code answers with over HTTP (3c design, section 10). */
const STATUS: Record<ModerationErrorKind, ModerationErrorStatus> = {
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
  rate_limited: 429,
  service_unavailable: 503,
};

// The first three are written for the person reporting; the rest for staff, whose console words them again for the screen.
const MESSAGES: Record<ModerationErrorKind, string> = {
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

export interface ModerationDeps {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The social module's interface: the locks on profile rows and the reads evidence is copied from. */
  social: SocialForModeration;
  config: Config;
  log: Logger;
  now: () => Date;
}
