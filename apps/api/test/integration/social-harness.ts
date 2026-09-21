import pino from "pino";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { MediaForPosts } from "../../src/media";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newProfile, ticker } from "./social-fixtures";

/**
 * Real repository on Postgres, in-memory limits, and a clock the test moves. Every read of the
 * clock by a flow advances it one millisecond, so consecutive actions never share a timestamp and
 * list order in the tests is never left to the tie-breaker.
 */
export function socialHarness(db: Db, options: { media?: MediaForPosts } = {}) {
  const clock = ticker();
  const repo = createSocialRepo(db);
  const deps: SocialDeps = { repo, media: options.media ?? WITHOUT_MEDIA, limits: new MemoryStore(() => clock.now().getTime()), log: pino({ level: "silent" }), now: clock.next };
  return {
    deps,
    repo,
    clock,
    /** An account old enough for every action. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
  };
}

export type SocialHarness = ReturnType<typeof socialHarness>;

/** The error code a flow rejects with, or null when it succeeds. */
export async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
    throw err;
  }
}
