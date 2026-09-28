import { EXPLORE_V1 } from "@korbat/contracts";
import { createJob, type JobLock } from "../lib/jobs";
import type { SocialDeps } from "./context";

/** The job's name; its rounds run under the shared lock job:explore-refresh. */
const NAME = "explore-refresh";

/** A round every refresh interval of the published formula (5 minutes); the lock outlives a crash by as long. */
const INTERVAL_MS = EXPLORE_V1.refreshMinutes * 60_000;

/**
 * The Explore refresh as a job (2c design, section 9): one instance at a time, a round every five minutes, each ranking
 * as of the clock's time. A round that writes a ranking logs one line with its generation, candidates, items and
 * milliseconds, and nothing about any post; a round that skipped, because the newest ranking is younger than the
 * formula's minimum gap, logs nothing.
 */
export function createExploreJob(deps: SocialDeps, lock: JobLock) {
  return createJob({
    name: NAME,
    intervalMs: INTERVAL_MS,
    lockTtlMs: INTERVAL_MS,
    lock,
    log: deps.log,
    run: async () => {
      const result = await deps.repo.refreshExplore(deps.now());
      if (!result.skipped) {
        deps.log.info({ generation: result.generation, candidates: result.candidates, items: result.items, tookMs: result.tookMs }, "explore: ranking refreshed");
      }
    },
  });
}

/**
 * Runs a round at once, so Explore is filled on a new database or after downtime without waiting an interval, then
 * starts the timer, and returns the function that stops it. The timer catches and logs the failures of its own rounds;
 * this first one is caught here and logged the same way, so a failure at start never crashes the process and the timer
 * runs on. A failed round leaves the previous ranking in place.
 */
export function startExplore(deps: SocialDeps, lock: JobLock): () => void {
  const job = createExploreJob(deps, lock);
  void job.round().catch((err: unknown) => deps.log.error({ err, job: NAME }, "job: round failed"));
  return job.start();
}
