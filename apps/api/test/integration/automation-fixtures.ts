import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MatchHashType, MatchKind, SignalKind } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { loadConfig, type Config } from "../../src/config";
import { automatedStep, type StepOutcome } from "../../src/moderation/automated";
import { TEST_LISTED_CLASS, TEST_LIST_VERSION, TEST_SOURCE, TEST_UNLISTED_CLASS } from "../../src/media/match-adapter";
import { createMatchRepo } from "../../src/media/match-repo";
import { insertMatchSignal, insertScoreSignal } from "../../src/moderation/automated-repo";
import type { ModerationDeps } from "../../src/moderation/context";
import { moderationDeps, uuids, type Runner } from "./moderation-fixtures";

/**
 * The automated decision's fixtures (3d design, section 12; Task 6). A test builds the moderation module's dependencies
 * with the settings it needs, on its own configuration, as the tests build every adapter in the process: the scorer `test`
 * (whose threshold is 0.5 under version 0) and, unless said, AUTOMATION_R1_ACTS on. The configuration's refusal of a test
 * adapter on an open site is the configuration's own test; these settings never reach loadConfig.
 */

/** The configuration of a server whose R1 check runs, flagging or (the default here) withholding. */
export function automationConfig(over: Partial<Config> = {}): Config {
  return { ...loadConfig(), R1_CLASSIFIER: "test", AUTOMATION_R1_ACTS: "on", APP_SITE: "closed", ...over };
}

/** The moderation module's dependencies over a pool or a transaction, with automationConfig's settings. */
export function automationDeps(db: Runner, over: Partial<ModerationDeps> = {}, config: Partial<Config> = {}): ModerationDeps {
  return moderationDeps(db, { config: automationConfig(config), ...over });
}

/** A signal the fixture wrote and the step's outcome on it. */
export interface Signalled extends StepOutcome {
  signalId: string;
}

/**
 * 3d Task 7: a match record of an image, as the comparison writes one, as the API's role (its trigger forces `listed` and
 * `acting`): by default an exact SHA-256 match of the test source's listed and acting class, the record that acts.
 * `near` gives a near match of that class (listed, not acting); `other` the class the source does not list (a flag).
 */
export async function matchForTest(db: Runner, mediaId: string, kind: "acting" | "near" | "other" = "acting", hashType: MatchHashType = kind === "near" ? "sha1" : kind === "other" ? "md5" : "sha256"): Promise<string> {
  const matchKind: MatchKind = kind === "near" ? "near" : "exact";
  const record = await createMatchRepo(db as Db).insertMatch(db, {
    mediaId,
    source: TEST_SOURCE,
    listVersion: TEST_LIST_VERSION,
    hashType,
    kind: matchKind,
    classification: kind === "other" ? TEST_UNLISTED_CLASS : TEST_LISTED_CLASS,
    hash: randomBytes(hashType === "md5" ? 16 : hashType === "sha1" ? 20 : 32),
  });
  return record.id;
}

/**
 * `signalForTest(media, kind)` (design, section 12): inserts a signal as the API's role, as the step's first statement
 * writes one, and runs the automated step once on it. A score's signal carries `score` (1, over every threshold, unless
 * said) under the test scorer's version 0. 3d Task 7: a match's signal names a match record, written by matchForTest
 * (the acting kind unless `match` says) unless an id is given.
 */
export async function signalForTest(deps: ModerationDeps, mediaId: string, kind: SignalKind = "r1_score", score = 1, match: { id?: string; kind?: "acting" | "near" | "other" } = {}): Promise<Signalled & { matchId: string | null }> {
  if (kind === "known_match") {
    const matchId = match.id ?? (await matchForTest(deps.apiDb, mediaId, match.kind ?? "acting"));
    const signalId = await insertMatchSignal(deps.apiDb, { mediaId, matchId });
    if (signalId === null) throw new Error("the image has a match's signal already");
    return { signalId, matchId, ...(await automatedStep(deps, signalId)) };
  }
  const signalId = await insertScoreSignal(deps.apiDb, { mediaId, score, thresholdVersion: 0 });
  if (signalId === null) throw new Error("the image has a score's signal already");
  return { signalId, matchId: null, ...(await automatedStep(deps, signalId)) };
}

/** A signal's row as the step left it. */
export async function signalRow(db: Runner, id: string): Promise<{ handled: string | null; handled_at: string | null; decision_id: string | null; intake_item_id: string | null; kind: string; score: number | null }> {
  const [row] = await db.execute<{ handled: string | null; handled_at: string | null; decision_id: string | null; intake_item_id: string | null; kind: string; score: number | null }>(
    sql`select handled, handled_at::text as handled_at, decision_id, intake_item_id, kind, score from public.automated_signals where id = ${id}::uuid`,
  );
  return { ...row! };
}

/** The system's audit row that names a decision, as the chain holds it. */
export async function systemRowOf(db: Runner, decisionId: string): Promise<{ actor_id: string; action: string; target_type: string | null; target_id: string | null; step_up: unknown; key_id: string | null; metadata: Record<string, unknown> } | null> {
  const [row] = await db.execute<{ actor_id: string; action: string; target_type: string | null; target_id: string | null; step_up: unknown; key_id: string | null; metadata: Record<string, unknown> }>(
    sql`select actor_id, action, target_type, target_id, step_up, key_id, metadata from public.audit_log where metadata ->> 'decisionId' = ${decisionId} order by chain_seq desc limit 1`,
  );
  return row ?? null;
}

/**
 * Removes, as the migrator, what a test of the automated decision committed beyond what removeFixtures takes with its
 * profiles: the alert rows of the three kinds (and moderation_urgent) raised since the test began.
 */
export async function removeAutomation(migrateDb: Db | DbTx, alertsSince: string, mediaIds: readonly string[] = []): Promise<void> {
  await migrateDb.execute(sql`delete from public.automated_signals where media_id = any(${uuids(mediaIds)})`);
  // 3d Task 7: the match records of these images, and refusals that name them.
  await migrateDb.execute(sql`delete from public.upload_refusals where media_id = any(${uuids(mediaIds)})`);
  await migrateDb.execute(sql`delete from public.media_matches where media_id = any(${uuids(mediaIds)})`);
  await migrateDb.execute(sql`delete from public.edge_purges where media_id = any(${uuids(mediaIds)})`);
  await migrateDb.execute(
    sql`delete from public.alert_outbox where kind in ('automated_objection', 'automation_capped', 'automated_waiting', 'moderation_urgent', 'moderation_csam_lifted', 'matcher_down', 'hold_ended_unreported', 'seal_released') and created_at >= ${alertsSince}::timestamptz`,
  );
}
