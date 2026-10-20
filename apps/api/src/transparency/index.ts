/**
 * The transparency module (3d design, sections 4 rows 4 and 5, 5, 7.5, 7.6, 7.7 and 7.14; Tasks 4 and 5): the public
 * figures, the audit head's daily value and the public answers. The only file outside src/transparency/ may import; it
 * reads no session and no table of a person, and the architecture test holds every file of it to the names of
 * @korbat/db's schema/transparency.ts and the audit head.
 *
 *   - the recipients' count: the two calls the auth module's resolveSession makes (forAuth, registered with auth.onSeen
 *     once both modules exist) and the month's close;
 *   - the yearly edition: the daily call of edition_publish() for the last closed year and every earlier year with one;
 *   - the head's daily value (Task 5): the day's row of head_publications, the witness adapter (witness.ts, HEAD_WITNESS)
 *     and the keeper's mail through the auth module's mailKeeper (AuthForTransparency);
 *   - GET /api/public/facts, GET /api/public/transparency and GET /api/public/head;
 *   - one job, `transparency`, every ten minutes under the jobs' shared lock: the month's close each round, and after
 *     MODERATION_DISPATCH_HOUR the editions once a day and the head in each round until the day's value is published and
 *     witnessed, or needs no witness. Each daily part is idempotent by its table's key, so a round after a restart that
 *     runs it again writes nothing.
 */
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AuthForTransparency } from "../auth";
import type { Config } from "../config";
import { createJob, type JobLock } from "../lib/jobs";
import { publishEditions } from "./editions";
import { publishHead, type HeadPass } from "./head";
import { closeMonths, createRecipientCounter, markMonth, type RecipientCounter, type SketchStore } from "./recipients";
import { createTransparencyRepo, type TransparencyRepo } from "./repo";
import { publicFacts, transparencyRoutes } from "./routes";
import { witnessFrom, type WitnessAdapter } from "./witness";

export type { SketchStore } from "./recipients";
export type { HeadPass } from "./head";
export type { WitnessAdapter } from "./witness";
export { publicTransparency } from "./editions";
export { headValue, publicHead } from "./head";
export { isReadRoute, sketchKeys } from "./recipients";
export { witnessFrom } from "./witness";

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
  /**
   * The counts store (3d review H3): a Valkey of its own that writes nothing to disk (COUNTS_URL, Compose's `counts`),
   * for the sketches and the salt alone. Never the shared one, whose append-only file would keep the salt and every
   * value added to a sketch.
   */
  counts: SketchStore;
  /** The auth module's one sender this module needs: the keeper's daily mail to HEAD_KEEPER_MAIL (section 5). */
  auth: AuthForTransparency;
  config: Pick<
    Config,
    "EDGE_PURGE" | "RECIPIENTS_SIGNED_OUT" | "MODERATION_DISPATCH_HOUR" | "HEAD_WITNESS" | "HEAD_WITNESS_URL" | "APP_SITE" | "R1_CLASSIFIER" | "AUTOMATION_R1_ACTS" | "AUTOMATION_DPIA_R1" | "AUTOMATION_DPIA_R1_ACTS"
  > &
    Partial<Pick<Config, "HEAD_KEEPER_MAIL">>;
  logger: Logger;
  /** The clock of the counts and of the job's rounds; tests move it. The head's day is the database's own. */
  now?: () => Date;
  /** The head's witness in place of the one HEAD_WITNESS names; for tests (fakeWitness() is no https address). */
  witness?: WitnessAdapter;
  /** The repository in place of the one over apiDb; for tests (3d review M11: an edition that fails). */
  repo?: TransparencyRepo;
}

/**
 * What one round of the job did: the months it closed, the editions it published once a day, and the head's pass, null
 * when the round ran none (before the dispatch hour, or once the day's value needs nothing more).
 */
export interface TransparencyRound {
  months: string[];
  editions: { year: number; version: number }[] | null;
  head: HeadPass | null;
}

export function createTransparency(options: CreateTransparencyOptions) {
  const now = options.now ?? (() => new Date());
  const log = options.logger;
  const repo = options.repo ?? createTransparencyRepo(options.apiDb);
  const signedOut = options.config.RECIPIENTS_SIGNED_OUT === "on";
  const forAuth: TransparencyForAuth = createRecipientCounter({ store: options.counts, signedOut, log, now });
  // HEAD_WITNESS's adapter; the configuration refused a test adapter on an open site, and the builder refuses it again.
  const witness = options.witness ?? witnessFrom(options.config);
  // 3d review M13: whether a keeper's address is set, so a mail that did not go is owed and retried, and alerted after the day.
  const keeper = options.config.HEAD_KEEPER_MAIL !== undefined && options.config.HEAD_KEEPER_MAIL !== "";
  const head = { repo, witness, mailKeeper: options.auth.mailKeeper, log, keeper };
  // The UTC day of this process's last daily pass of the editions: one a day, after the dispatch hour. A restart runs it
  // again, which the editions' key makes harmless.
  let lastDaily: string | null = null;
  // The day whose first head pass ran (it alone looks for a missed day before), and the day whose value needs nothing
  // more: published, and witnessed or never to be. Until then each round passes again, so a witness that did not answer
  // is asked again in the day's later rounds.
  let headFirst: string | null = null;
  let headDone: string | null = null;

  async function round(): Promise<TransparencyRound> {
    const at = now();
    // 3d review M11: each part of the round in a try of its own, with its own log line, so a counts store that is down or
    // an edition that keeps failing never keeps the day's head value from being published, mailed and alerted on.
    let months: string[] = [];
    try {
      // 3d review M10: the running month's mark, set once, before the close of the months before.
      await markMonth(options.counts, at);
      months = await closeMonths({ store: options.counts, repo, signedOut }, at);
      if (months.length > 0) log.info({ job: TRANSPARENCY_JOB, months }, "transparency: the recipients' months were stored");
    } catch (err) {
      log.error({ err, job: TRANSPARENCY_JOB }, "transparency: the recipients' months were not closed; the next round tries again");
    }
    const day = at.toISOString().slice(0, 10);
    if (at.getUTCHours() < options.config.MODERATION_DISPATCH_HOUR) return { months, editions: null, head: null };
    let editions: TransparencyRound["editions"] = null;
    if (lastDaily !== day) {
      try {
        editions = (await publishEditions({ repo, log }, at)).published;
        lastDaily = day;
      } catch (err) {
        // lastDaily stays as it was: the next round asks again, as every round does until the editions pass once.
        log.error({ err, job: TRANSPARENCY_JOB }, "transparency: the editions were not published; the next round asks again");
      }
    }
    // After the editions, so the day's value covers an edition's audit row written in the same round.
    let pass: HeadPass | null = null;
    if (headDone !== day) {
      try {
        pass = await publishHead(head, { firstOfDay: headFirst !== day });
        headFirst = day;
        if (pass.done) headDone = day;
      } catch (err) {
        log.error({ err, job: TRANSPARENCY_JOB }, "transparency: the head's daily pass failed; the next round passes again");
      }
    }
    return { months, editions, head: pass };
  }

  return {
    /** The interface the auth module calls, registered with auth.onSeen in index.ts. */
    forAuth,
    /** The three public routes, mounted by app.ts at /api before the session's resolution. */
    routes: transparencyRoutes({ repo, facts: publicFacts(options.config) }),
    /** One round of the job, as the timer runs it; for tests. */
    round,
    /** Starts the job `transparency` and returns the function that stops it. */
    startJobs: (lock: JobLock) => createJob({ name: TRANSPARENCY_JOB, intervalMs: TRANSPARENCY_ROUND_MS, lockTtlMs: TRANSPARENCY_ROUND_MS * 2, lock, log, run: round }).start(),
  };
}

export type Transparency = ReturnType<typeof createTransparency>;
