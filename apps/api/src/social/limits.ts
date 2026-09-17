import type { RateLimitStore } from "../middleware/rate-limit";
import { SocialError } from "./context";
import { limitsFor, mayRepostOrQuote, type WriteAction } from "./tiers";

/**
 * Counts one write for the account and refuses it once a window is full. Reposts and quotes are
 * refused outright while the account is too young. Undo actions never call this.
 */
export async function enforceWriteLimit(
  store: RateLimitStore,
  userId: string,
  action: WriteAction,
  accountCreatedAt: Date,
  now: Date,
): Promise<void> {
  const accountAgeMs = now.getTime() - accountCreatedAt.getTime();
  if ((action === "repost" || action === "quote") && !mayRepostOrQuote(accountAgeMs)) {
    throw new SocialError("account_too_new", 403);
  }
  for (const limit of limitsFor(action, accountAgeMs)) {
    const { count, resetMs } = await store.hit(`social:${limit.bucket}:${userId}`, limit.windowMs);
    if (count > limit.max) {
      throw new SocialError("rate_limited", 429, undefined, Math.max(1, Math.ceil(resetMs / 1000)));
    }
  }
}
