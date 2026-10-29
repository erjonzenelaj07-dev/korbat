import { sql } from "drizzle-orm";
import { AUTOMATION_RULES, MATCH_RETRY_BATCH } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { createJob, type JobLock } from "../lib/jobs";
import type { MatchEvent, MediaDeps } from "./context";
import { failMismatch, resultKind } from "./repo";
import { matchRequest, matchedHash, type MatchAnswer } from "./match-adapter";
import type { HashedUpload, Runner } from "./match-repo";

/**
 * The comparison of an upload with known material (3d design, sections 2 rows 27 to 35, 7.8 and 7.14; Task 7): asking the
 * source once, bounded in time, and storing its answer with the worker's verdict; the record of a match, and for an acting
 * match on an upload that is on no post its refusal and hold, which the database forces; and the job match-retry, which
 * asks again for a check that was not answered or that met the limit on refusals an hour. While MEDIA_MATCH is off no
 * upload has hashes, and nothing here runs.
 *
 * What a match does is the database's: media_matches_insert forces `listed` and `acting`, upload_refusals_insert refuses
 * a record that is not acting (so a flag refuses nothing) and answers refusals_capped over the hour's limit, and
 * upload_refusals_hold holds the image and the uploader's address. After the commit the moderation module is told through
 * media.onMatch: a refusal, for the uploader's notice and the urgent alert; a match on a posted image, for the automated
 * step; an upload over the limit, for matcher_down at once.
 */

/** match-retry's name: its lock is `job:match-retry`. A round a minute after the last one ended (7.14). */
export const MATCH_RETRY_JOB = "match-retry";
export const MATCH_RETRY_INTERVAL_MS = 60_000;

/** The message of an exception a trigger or a function raised as its code (SQLSTATE P0001); null for anything else. */
function raised(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof current === "object" && code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * One question to the source (7.8 step 3.2): the request the adapter's one builder makes of the four hashes and nothing
 * else, bounded at AUTOMATION_RULES.matchTimeoutMs. No answer in time, and any failure of the adapter, is `unanswered`:
 * the upload is accepted and asked about again. A PDQ would be sent only at or over pdqMinQuality; this build has none.
 */
export async function askSource(deps: Pick<MediaDeps, "match" | "log">, hashed: HashedUpload): Promise<MatchAnswer> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<MatchAnswer>((resolve) => {
    timer = setTimeout(() => resolve({ state: "unanswered" }), AUTOMATION_RULES.matchTimeoutMs);
  });
  try {
    return await Promise.race([deps.match.check(matchRequest(hashed.hashes)), late]);
  } catch (err) {
    // The source's error is logged by its kind alone: no hash and no answer reaches a log line.
    deps.log.warn({ id: hashed.mediaId, err: (err as Error)?.name }, "known material: the source did not answer; the upload is accepted and asked about again");
    return { state: "unanswered" };
  } finally {
    clearTimeout(timer);
  }
}

/** What storing a check left: the row's outcome, and what the moderation module is told after the commit. */
export interface StoredCheck {
  /** `none` when another caller finalized the row first and nothing was written. */
  stored: "clear" | "unchecked" | "matched" | "capped" | "none";
  events: MatchEvent[];
}

/**
 * Inside a savepoint: the record of a match and, for an acting match of an upload on no post, its refusal. Answers the
 * event to tell. A refusal's insert that finds the row attached meanwhile (upload_attached, which no route answers) rolls
 * the savepoint back, and the match is stored again as a match on a posted image.
 */
async function storeMatch(deps: Pick<MediaDeps, "matches" | "match">, tx: DbTx, upload: { mediaId: string; ownerId: string; onPost: boolean }, hashed: HashedUpload, answer: Extract<MatchAnswer, { state: "matched" }>): Promise<MatchEvent | null> {
  const record = { mediaId: upload.mediaId, source: deps.match.source!, listVersion: answer.listVersion, hashType: answer.hashType, kind: answer.kind, classification: answer.classification.slice(0, 100), hash: matchedHash(hashed.hashes, answer.hashType) ?? hashed.hashes.sha256 };
  const posted = async (q: Runner): Promise<MatchEvent> => {
    const match = await deps.matches.insertMatch(q, record);
    return { kind: "posted", mediaId: upload.mediaId, matchId: match.id };
  };
  if (upload.onPost) return posted(tx);
  try {
    return await tx.transaction(async (sp) => {
      const match = await deps.matches.insertMatch(sp, record);
      // A flag is accepted like any image: nothing is refused or held, and its record waits for the image to be posted.
      if (!match.acting) return null;
      const refusalId = await deps.matches.insertRefusal(sp, { mediaId: upload.mediaId, ownerId: upload.ownerId, matchId: match.id });
      return { kind: "refused", refusalId } satisfies MatchEvent;
    });
  } catch (err) {
    if (raised(err) !== "upload_attached") throw err;
    return posted(tx);
  }
}

/**
 * finalize's transaction for an upload whose check was asked (7.8 step 3.3): the worker's verdict, as repo.finalize writes
 * it, only on a row still processing; its score; the check's state; and for a match its record and, when it acts, its
 * refusal. All of it in a savepoint: when the refusal's insert answers refusals_capped (the hour's limit), the savepoint
 * rolls back, nothing of the match is written and the row stays processing, and the check is recorded as capped. With a
 * 10-second lock timeout.
 */
export async function storeVerdict(deps: Pick<MediaDeps, "matches" | "match">, id: string, result: ResultFile, score: number | null, hashed: HashedUpload, answer: MatchAnswer): Promise<StoredCheck> {
  return deps.matches.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '10000ms', true)`);
    try {
      return await tx.transaction(async (sp): Promise<StoredCheck> => {
        const verdict =
          result.status === "ready"
            ? sql`status = 'ready', width = ${result.width}::int, height = ${result.height}::int, blurhash = ${result.blurhash}, nsfw_score = coalesce(${score}::real, nsfw_score)`
            : sql`status = 'failed', error = ${result.reason}`;
        // 2d Task 3 (design, section 7.4): a ready result only on a row of the kind its mark says; on another, the upload
        // fails (failMismatch) and nothing of the check is written.
        const kind = result.status === "ready" ? sql` and kind::text = ${resultKind(result)}` : sql``;
        const updated = (await sp.execute(sql`update public.post_media set ${verdict} where id = ${id}::uuid and status = 'processing'${kind} returning owner_id, post_id`)) as unknown as { owner_id: string; post_id: string | null }[];
        if (updated.length === 0) {
          if (result.status === "ready") await failMismatch(sp, id);
          return { stored: "none", events: [] };
        }
        if (result.status !== "ready") return { stored: "none", events: [] };
        if (answer.state !== "matched") {
          const state = answer.state === "clear" ? "clear" : "unchecked";
          await deps.matches.setCheck(sp, id, state, answer.state === "clear" ? deps.match.source : null);
          return { stored: state, events: [] };
        }
        await deps.matches.setCheck(sp, id, "matched", deps.match.source);
        const event = await storeMatch(deps, sp, { mediaId: id, ownerId: updated[0]!.owner_id, onPost: updated[0]!.post_id !== null }, hashed, answer);
        return { stored: "matched", events: event === null ? [] : [event] };
      });
    } catch (err) {
      if (raised(err) !== "refusals_capped") throw err;
      // Nothing of the match is written and the row stays processing: not ready, not postable, nobody told.
      await deps.matches.setCheck(tx, id, "capped", deps.match.source);
      return { stored: "capped", events: [{ kind: "capped" }] };
    }
  });
}

/**
 * match-retry's answer for an image that is ready, its first check unanswered (7.8 step 6): clear, the state alone;
 * unanswered, the state again with the attempt's time; matched, the record and, for an acting match of an upload that is
 * still on no post, its refusal, or the record alone for an image on a post, whose automated step the event starts. A
 * refusal over the hour's limit leaves the check unchecked, to be asked again: the upload is ready already.
 */
export async function storeLateAnswer(deps: Pick<MediaDeps, "matches" | "match">, hashed: HashedUpload, answer: MatchAnswer): Promise<StoredCheck> {
  return deps.matches.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '10000ms', true)`);
    // The image row first, then a statement of its own: an attach or a deletion that committed meanwhile is seen.
    await tx.execute(sql`select 1 from public.post_media where id = ${hashed.mediaId}::uuid for no key update`);
    const now = await deps.matches.hashed(tx, hashed.mediaId);
    if (now === null || now.checkState !== "unchecked" || now.status !== "ready") return { stored: "none", events: [] };
    if (answer.state !== "matched") {
      const state = answer.state === "clear" ? "clear" : "unchecked";
      await deps.matches.setCheck(tx, hashed.mediaId, state, answer.state === "clear" ? deps.match.source : null);
      return { stored: state, events: [] };
    }
    try {
      return await tx.transaction(async (sp): Promise<StoredCheck> => {
        await deps.matches.setCheck(sp, hashed.mediaId, "matched", deps.match.source);
        const event = await storeMatch(deps, sp, { mediaId: hashed.mediaId, ownerId: now.ownerId, onPost: now.postId !== null }, hashed, answer);
        return { stored: "matched", events: event === null ? [] : [event] };
      });
    } catch (err) {
      if (raised(err) !== "refusals_capped") throw err;
      await deps.matches.setCheck(tx, hashed.mediaId, "unchecked", null);
      return { stored: "unchecked", events: [{ kind: "capped" }] };
    }
  });
}

/** Tells the moderation module what a commit stored, each event in a try of its own; a lost call is found by a sweep. */
export async function tellMatched(deps: Pick<MediaDeps, "matched" | "log">, events: readonly MatchEvent[]): Promise<void> {
  const handler = deps.matched.handler;
  if (handler === null) return;
  for (const event of events) {
    try {
      await handler(event);
    } catch (err) {
      deps.log.error({ err, event: event.kind }, "known material: the moderation module was not told of a stored match; its sweep or its dispatch round finds it");
    }
  }
}

/** What one round of match-retry did. */
export interface MatchRetryReport {
  asked: number;
  clear: number;
  matched: number;
  unchecked: number;
  capped: number;
  failed: number;
}

/**
 * One round of match-retry (7.8 step 6, 7.14): with the comparison on, at most MATCH_RETRY_BATCH uploads whose check is
 * unchecked or capped and whose image row is younger than AUTOMATION_RULES.matchRetryHours, oldest first. A capped
 * upload is still processing, with its result in the store: finalize asks again and stores the verdict, or leaves it
 * capped while the hour's count does not allow a refusal. An unchecked one is ready: its late answer is stored as above.
 * Each upload in a try of its own. After matchRetryHours a row stays unchecked for good, and the sweeper's bound fails a
 * capped one.
 */
export async function matchRetryRound(deps: MediaDeps, finalize: (deps: MediaDeps, id: string) => Promise<boolean>): Promise<MatchRetryReport> {
  const report: MatchRetryReport = { asked: 0, clear: 0, matched: 0, unchecked: 0, capped: 0, failed: 0 };
  if (deps.match.mode === "off") return report;
  for (const id of await deps.matches.retryDue(MATCH_RETRY_BATCH, AUTOMATION_RULES.matchRetryHours)) {
    try {
      const hashed = await deps.matches.hashed(deps.matches.db, id);
      if (hashed === null) continue;
      report.asked++;
      if (hashed.checkState === "capped") {
        await finalize(deps, id);
        const after = await deps.matches.hashed(deps.matches.db, id);
        const state = after?.checkState;
        if (state === "matched") report.matched++;
        else if (state === "clear") report.clear++;
        else if (state === "capped") report.capped++;
        else report.unchecked++;
        continue;
      }
      const answer = await askSource(deps, hashed);
      const stored = await storeLateAnswer(deps, hashed, answer);
      if (stored.stored === "matched") report.matched++;
      else if (stored.stored === "clear") report.clear++;
      else report.unchecked++;
      await tellMatched(deps, stored.events);
    } catch (err) {
      report.failed++;
      deps.log.error({ err, id }, "match-retry: an upload's check could not be asked again; the next round tries it");
    }
  }
  return report;
}

/** The job under the shared lock: a round MATCH_RETRY_INTERVAL_MS after the last one ended, on one instance at a time. */
export function createMatchRetryJob(deps: MediaDeps, finalize: (deps: MediaDeps, id: string) => Promise<boolean>, lock: JobLock) {
  return createJob({ name: MATCH_RETRY_JOB, intervalMs: MATCH_RETRY_INTERVAL_MS, lockTtlMs: MATCH_RETRY_INTERVAL_MS * 2, lock, log: deps.log, run: () => matchRetryRound(deps, finalize) });
}
