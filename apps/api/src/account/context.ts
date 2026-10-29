import type { Logger } from "pino";
import type { ActivityForAccount } from "../activity";
import type { AuthForAccount } from "../auth";
import type { ImportsForAccount } from "../imports";
import type { MediaForAccount } from "../media";
import type { ModerationForAccount } from "../moderation";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForAccount } from "../social";

/** The codes this module raises itself; the modules it calls raise their own, which the app's error handler also renders. */
export type AccountErrorKind = "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type AccountErrorStatus = 400 | 404 | 429 | 503;

const MESSAGES: Record<AccountErrorKind, string> = {
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorKind,
    readonly status: AccountErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited and service_unavailable so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export function accountErrorMessage(code: AccountErrorKind): string {
  return MESSAGES[code];
}

/**
 * The account module owns no table: it sequences the other three modules through the interfaces their
 * index files export (1b design, section 5). The limit store is the one every per-account limit uses.
 */
export interface AccountDeps {
  auth: AuthForAccount;
  social: SocialForAccount;
  media: MediaForAccount;
  /**
   * The purge's forgetting of a deleted account's reports, in the moderation module's tables (3c design, section 7.10),
   * the export's moderation member (section 7.11), and (3e, section 7.8) the take-down of the terminated accounts whose
   * termination is final, at the start of each purge round. The server always hands it over; a test of the other steps
   * may leave it out: the purge then skips those steps, and the export writes the member with two empty lists.
   */
  moderation?: ModerationForAccount;
  /**
   * 3b Task 6 (design, sections 4.7 and 11.2): the purge's step for the account's imports and import key, inside the social
   * purge's transaction, with their files after it; and the export's member `imports`. The server always hands it over; a
   * test of the other steps may leave it out: the purge then deletes no import row, and the export's member is empty.
   */
  imports?: ImportsForAccount;
  /**
   * 2d (design, section 11.2): the export's member `activity`, the account's seen marker, rules and received entries. The
   * server always hands it over; a test of the other members may leave it out, and the member is then the defaults with no
   * entry. The purge needs nothing of it: the social module's purge deletes the account's entries, marker and mentions.
   */
  activity?: ActivityForAccount;
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
