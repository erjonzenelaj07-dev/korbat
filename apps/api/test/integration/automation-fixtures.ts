import { sql } from "drizzle-orm";
import type { SignalKind } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { loadConfig, type Config } from "../../src/config";
import { automatedStep, type StepOutcome } from "../../src/moderation/automated";
import { insertScoreSignal } from "../../src/moderation/automated-repo";
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
 * `signalForTest(media, kind)` (design, section 12): inserts a signal as the API's role, as the step's first statement
 * writes one, and runs the automated step once on it. A score's signal carries `score` (1, over every threshold, unless
 * said) under the test scorer's version 0. Task 7 adds the match's kind.
 */
export async function signalForTest(deps: ModerationDeps, mediaId: string, kind: SignalKind = "r1_score", score = 1): Promise<Signalled> {
  if (kind !== "r1_score") throw new Error("a match's signal is Task 7's");
  const signalId = await insertScoreSignal(deps.apiDb, { mediaId, score, thresholdVersion: 0 });
  if (signalId === null) throw new Error("the image has a score's signal already");
  return { signalId, ...(await automatedStep(deps, signalId)) };
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
  await migrateDb.execute(sql`delete from public.edge_purges where media_id = any(${uuids(mediaIds)})`);
  await migrateDb.execute(
    sql`delete from public.alert_outbox where kind in ('automated_objection', 'automation_capped', 'automated_waiting', 'moderation_urgent') and created_at >= ${alertsSince}::timestamptz`,
  );
}
