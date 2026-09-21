import type { SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialRepo } from "./repo";

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | "not_found" | "invalid_request" | "rate_limited";
export type SocialErrorStatus = 400 | 403 | 404 | 429;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export function socialErrorMessage(code: SocialErrorKind): string {
  return MESSAGES[code];
}

/** The account making a request, or null when signed out. Reads accept null; writes never do. */
export type ViewerId = string | null;

/** Posts without images: what the module runs with when no media module is wired, as in the 2a tests. */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
};

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
