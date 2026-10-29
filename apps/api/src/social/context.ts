import type { AuthErrorCode, SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import type { AuthEventType } from "../auth";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForSocial } from "../moderation";
import type { SocialRepo } from "./repo";

/** The handle codes onboarding answers with, which a handle change raises too, plus its cooldown and (3e) a retired handle. */
type HandleErrorCode = Extract<AuthErrorCode, "handle_invalid" | "handle_reserved" | "handle_taken" | "handle_cooldown" | "handle_retired">;

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | HandleErrorCode | "not_found" | "invalid_request" | "rate_limited" | "service_unavailable";
export type SocialErrorStatus = 400 | 403 | 404 | 409 | 429 | 503;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  // The page asked for belongs to an Explore ranking that is no longer kept; the app starts again from the current one.
  explore_refreshed: "Explore was refreshed.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  handle_taken: "That handle is taken.",
  handle_cooldown: "Handles can change once every 30 days.",
  // 3e (design, section 9.5): the auth module's words for the same code.
  handle_retired: "That handle was retired by korbat. Nobody can use it.",
  // 3e (design, sections 7.2 and 9.8): a write of an account while its suspension runs; no detail, the app reads /me.
  account_suspended: "Your account is suspended, so you cannot do this now.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited, service_unavailable and handle_cooldown so the response can carry Retry-After. */
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

/**
 * Posts without images: what the module runs with when no media module is wired, as in the 2a tests. 2d Task 3: and without
 * avatars: no upload exists to set (not_found), there is none to remove, and every author is drawn with its monogram.
 */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
  attachAvatar: async () => {
    throw new MediaError("not_found", 404);
  },
  detachAvatar: async () => null,
  dropFormerAvatar: async () => undefined,
  avatarsOf: async () => new Map(),
};

/** Security events about an account go to the auth module's table; this is its appendEvent, as the server wires it. */
export interface SocialEvents {
  append(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /**
   * The decision behind the state of the viewer's own withheld or removed post, for its chip. The moderation module owns
   * the decisions. Absent in the tests of posting alone, whose posts then carry no chip.
   */
  moderation?: ModerationForSocial;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
  /** Records profile and handle changes as security events. Absent in the 2a tests, which record nothing. */
  events?: SocialEvents;
}
