import type { Logger } from "pino";
import type { AuthForAccount } from "../auth";
import type { MediaForAccount } from "../media";
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
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
