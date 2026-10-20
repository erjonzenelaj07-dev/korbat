/**
 * The transparency module (3d design, sections 4 row 4, 5, 7.5, 7.6 and 7.14; Task 4): the public figures and the
 * public answers. The only file outside src/transparency/ may import; it reads no session and no table of a person, and
 * the architecture test holds every file of it to the names of @korbat/db's schema/transparency.ts and the audit head.
 *
 *   - the recipients' count: the two calls the auth module's resolveSession makes (forAuth, registered with auth.onSeen
 *     once both modules exist) and the month's close;
 *   - the yearly edition: the daily call of edition_publish() for the last closed year and every earlier year with one;
 *   - GET /api/public/facts and GET /api/public/transparency;
 *   - one job, `transparency`, every ten minutes under the jobs' shared lock: the month's close each round, and once a
 *     day after MODERATION_DISPATCH_HOUR the editions. Each daily part is idempotent by its table's key, so a round after a
 *     restart that runs it again writes nothing.
 */
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { Config } from "../config";
import { createJob, type JobLock } from "../lib/jobs";
import { publishEditions } from "./editions";
import { closeMonths, createRecipientCounter, type RecipientCounter, type SketchStore } from "./recipients";
import { createTransparencyRepo } from "./repo";
import { publicFacts, transparencyRoutes } from "./routes";

export type { SketchStore } from "./recipients";
export { publicTransparency } from "./editions";
export { isReadRoute, sketchKeys } from "./recipients";

/**
 * What the auth module needs from this one (section 5, `auth.onSeen`): resolveSession calls `seen` when a session
 * resolved and `seenSignedOut` for a GET when none did. Both return at once; neither throws, and a failure of Valkey is
 * swallowed: counting never fails or slows a request.
 */
export type TransparencyForAuth = RecipientCounter;

/** The job's name: its lock is `job:transparency`, and its log lines carry it. */
export const TRANSPARENCY_JOB = "transparency";
/** Ten minutes between the end of one round and the start of the next (7.14). */
export const TRANSPARENCY_ROUND_MS = 10 * 60_000;

export interface CreateTransparencyOptions {
  apiDb: Db;
  /** Valkey, for the sketches and the salt. */
  redis: SketchStore;
  config: Pick<Config, "EDGE_PURGE" | "RECIPIENTS_SIGNED_OUT" | "MODERATION_DISPATCH_HOUR">;
  logger: Logger;
  /** The clock of the counts and of the job's rounds; tests move it. */
  now?: () => Date;
}

/** What one round of the job did: the months it closed, and the editions it published once a day. */
export interface TransparencyRound {
  months: string[];
  editions: { year: number; version: number }[] | null;
}

export function createTransparency(options: CreateTransparencyOptions) {
  const now = options.now ?? (() => new Date());
  const log = options.logger;
  const repo = createTransparencyRepo(options.apiDb);
  const signedOut = options.config.RECIPIENTS_SIGNED_OUT === "on";
  const forAuth: TransparencyForAuth = createRecipientCounter({ store: options.redis, signedOut, log, now });
  // The UTC day of this process's last daily pass: one a day, after the dispatch hour. A restart runs it again, which
  // the editions' key makes harmless.
  let lastDaily: string | null = null;

  async function round(): Promise<TransparencyRound> {
    const at = now();
    const months = await closeMonths({ store: options.redis, repo, signedOut }, at);
    if (months.length > 0) log.info({ job: TRANSPARENCY_JOB, months }, "transparency: the recipients' months were stored");
    const day = at.toISOString().slice(0, 10);
    if (lastDaily === day || at.getUTCHours() < options.config.MODERATION_DISPATCH_HOUR) return { months, editions: null };
    const pass = await publishEditions({ repo, log }, at);
    lastDaily = day;
    return { months, editions: pass.published };
  }

  return {
    /** The interface the auth module calls, registered with auth.onSeen in index.ts. */
    forAuth,
    /** The two public routes, mounted by app.ts at /api before the session's resolution. */
    routes: transparencyRoutes({ repo, facts: publicFacts(options.config) }),
    /** One round of the job, as the timer runs it; for tests. */
    round,
    /** Starts the job `transparency` and returns the function that stops it. */
    startJobs: (lock: JobLock) => createJob({ name: TRANSPARENCY_JOB, intervalMs: TRANSPARENCY_ROUND_MS, lockTtlMs: TRANSPARENCY_ROUND_MS * 2, lock, log, run: round }).start(),
  };
}

export type Transparency = ReturnType<typeof createTransparency>;
