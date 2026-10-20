import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  AUTOMATION_RULES,
  AutomatedDecidedParams,
  CAP_LIMITS,
  R1_TEST_THRESHOLD,
  RULE_DEFAULT_CATEGORY,
  SWEEP_BATCH,
  SWEEP_HOURS,
  type CapLimit,
  type DecisionView,
  type ObjectionRequest,
  type SignalHandled,
} from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import { SYSTEM_ACTOR_ID } from "../auth";
import { createJob, type JobLock } from "../lib/jobs";
import { isDeadlock, isLockNotAvailable } from "../lib/lock-bounds";
import { imagePost } from "../media";
import { appendAuditRow } from "../staff";
import { staffAlert } from "./alerts";
import { authorDecisionView } from "./author";
import { authorDecision } from "./author-repo";
import {
  automatedWaitingAlert,
  cappedSinceLastMeasure,
  insertObjection,
  insertScoreSignal,
  insertSystemDecision,
  joinSignal,
  objectionsWaiting,
  signalHandled,
  signalOf,
  unhandledSignals,
  type SignalRow,
} from "./automated-repo";
import { snapshotIn } from "./cases";
import { ModerationError, type ModerationDeps } from "./context";
import { isStartOver, recordIntakeIn, type IntakeGround } from "./intake";
import { caseById, insertAction, isSerializationFailure, raisedDetail, raisedMessage, violatedUniqueConstraint } from "./repo";
import { sendStatement } from "./statement";

/**
 * The automated step, its sweep and "Ask for a person" (3d design, sections 2 rows 14 to 25, 5 "The lock order", 6.6,
 * 7.9, 7.10 and 7.14; Task 6). A signal is a fact about one image on a post: a score at or over the threshold (and, from
 * Task 7, a match record). The step turns it into a program's finding and, where the setting allows it, into one
 * protective measure, a decision without a decider that is always interim, holds exactly that measure, and stands only
 * with the system's audit row and its signal (decision_holds at commit). It never runs inside the transaction that made
 * the post or stored the signal's fact: it is a deciding transaction of its own, which takes the author's profile first,
 * as every deciding transaction does. So an image can be public for seconds before a measure.
 *
 * The program never has the last word: its measure lasts until a person decides the case or lifts it, its author is told
 * at once and can ask for a person, and four limits (counted by rule, and two on what waits for a person) stop it from
 * taking new measures, never from opening findings, when nobody answers. No score is ever logged, printed or answered.
 */

/** How often the step's transaction is run again after a deadlock, a lock timeout or a case that closed under it, as an intake is. */
const RETRIES = 3;
/** The longest one run of the step waits for a lock, as an intake waits. */
const LOCK_TIMEOUT_MS = 10_000;

/** The sweep's name: its lock is `job:automated-sweep`. A round a minute after the last one ended (7.14). */
export const AUTOMATED_SWEEP_JOB = "automated-sweep";
export const AUTOMATED_SWEEP_INTERVAL_MS = 60_000;

/** The alert automation_capped goes at most once an hour, under this key of the limit store (7.9 step 3). */
export const CAPPED_ALERT_KEY = "automation-capped";
export const CAPPED_ALERT_WINDOW_MS = 60 * 60_000;
/** The alert automated_objection goes at most once in 15 minutes (7.10 step 3). */
export const OBJECTION_ALERT_KEY = "automated-objection";
export const OBJECTION_ALERT_WINDOW_MS = 15 * 60_000;

/**
 * The threshold a score is compared with, and its version, as R1_CLASSIFIER has it (section 5, "The threshold while only
 * the test adapter exists"): none while the scorer is off; the test scorer's own 0.5 under version 0 under `test`; and
 * the owner's measured threshold for a real classifier, which no build of 3d carries, and which opens nothing while it
 * is null. Null means that no score opens anything.
 */
export function r1Threshold(config: Pick<ModerationDeps["config"], "R1_CLASSIFIER">): { threshold: number; thresholdVersion: number } | null {
  if (config.R1_CLASSIFIER === "off") return null;
  if (config.R1_CLASSIFIER === "test") return { threshold: R1_TEST_THRESHOLD.threshold, thresholdVersion: R1_TEST_THRESHOLD.thresholdVersion };
  return AUTOMATION_RULES.r1Threshold === null ? null : { threshold: AUTOMATION_RULES.r1Threshold, thresholdVersion: AUTOMATION_RULES.r1ThresholdVersion };
}

/** What one run of the step did: how it handled the signal ("already" when another run had), and the finding's case and the decision it made, if any. */
export interface StepOutcome {
  handled: SignalHandled | "already";
  caseId: string | null;
  decisionId: string | null;
  /** The limit a refused measure met, for the alert automation_capped. */
  limit: CapLimit | null;
}

/** The ground of a program's finding under R1: rule R1 with its default category, no sender, no text (7.9 step 2.2). */
const R1_GROUND: IntakeGround = {
  kind: "automated",
  channel: "system",
  reporterId: null,
  findingBy: null,
  contactId: null,
  ruleId: "R1",
  allegesIllegal: false,
  csam: false,
  category: RULE_DEFAULT_CATEGORY.R1,
  categoryKeyword: null,
  citedLaw: null,
  explanation: null,
  bonaFide: false,
  automatedProcessing: true,
};

/** Thrown inside the step's transaction to end it with nothing written: another run handled the signal first. */
class AlreadyHandled extends Error {}

/**
 * The step for one signal (7.9 "The step"), in one transaction on the API's pool with a 10-second lock timeout, run again
 * up to three times on a deadlock, a lock timeout or a case that closed under it, as an intake is. The image's post and
 * its author are read before it: an attached image never moves to another post, and a post's author never changes. After
 * the commit, each in a try of its own: the author's statement when a measure was taken, and the alert automation_capped
 * when a limit refused one. Task 6 builds the step of a score; a match record's step is Task 7's.
 */
export async function automatedStep(deps: ModerationDeps, signalId: string): Promise<StepOutcome> {
  const signal = await signalOf(deps.apiDb, signalId);
  if (signal === null || signal.handledAt !== null) return { handled: "already", caseId: null, decisionId: null, limit: null };
  if (signal.kind !== "r1_score") throw new Error("the automated step of a match record is Task 7's");
  const postId = await imagePost(deps.apiDb, signal.mediaId);
  const authorId = postId === null ? null : await deps.social.postAuthor(postId);
  let outcome: StepOutcome | null = null;
  for (let attempt = 0; outcome === null; attempt++) {
    try {
      outcome = await deps.apiDb.transaction((tx) => stepIn(deps, tx, signal, postId, authorId));
    } catch (err) {
      if (err instanceof AlreadyHandled) return { handled: "already", caseId: null, decisionId: null, limit: null };
      const retried = isDeadlock(err) || isLockNotAvailable(err) || isSerializationFailure(err) || isStartOver(err);
      if (!retried || attempt >= RETRIES) throw err;
    }
  }
  const done = outcome;
  if (done.decisionId !== null) {
    try {
      await sendStatement(deps, done.decisionId);
    } catch (err) {
      deps.log.warn({ err, decisionId: done.decisionId }, "moderation: a program's statement was not mailed; it stays pending for the dispatch job");
    }
  }
  if (done.handled === "capped") {
    try {
      await alertCapped(deps, done.limit);
    } catch (err) {
      deps.log.error({ err }, "moderation: the staff accounts were not alerted that a program reached a limit");
    }
  }
  return done;
}

/**
 * One run of the step's transaction (7.9 step 2):
 *   1. the author's profile FOR NO KEY UPDATE, the first lock as in every deciding transaction; then, in a statement of
 *      its own, the signal again: a handled one ends the run with nothing written (three entries may start the step for
 *      one image at once). No live author, a post its author deleted, or an image gone, erased or on another post: the
 *      signal is handled `gone`, and nothing else is written;
 *   2. the finding, as the body of recordIntake writes a moderator's: the post's open case or a new one, one intake of the
 *      kind automated on the channel system, one item about the post that names the image, the case's hold on the post's
 *      images and its first snapshot; then the item on the signal;
 *   3. a savepoint;
 *   4. the measure, only with AUTOMATION_R1_ACTS=on: a snapshot of the post as it stands when the case's newest differs,
 *      the decision without a decider, its one withhold_media of the image, the signal handled `measure` with the
 *      decision, and last the system's plain audit row automated_decided;
 *   5. a refusal of the measure (already_protected, automation_capped) rolls back to the savepoint: the finding stands and
 *      the signal is handled `covered` or `capped`; without a measure for any other reason it is handled `finding`.
 * At commit decision_holds holds the decision to exactly this shape, or nothing commits.
 */
async function stepIn(deps: ModerationDeps, tx: DbTx, signal: SignalRow, postId: string | null, authorId: string | null): Promise<StepOutcome> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);
  const locked = authorId === null ? [] : await deps.social.lockAccounts(tx, [authorId], "no key update");
  const current = await signalOf(tx, signal.id);
  if (current === null || current.handledAt !== null) throw new AlreadyHandled();

  // Gone: read after the profile's lock, which the author's deletion and the purge take too, so neither can commit meanwhile.
  const post = postId === null ? null : await deps.social.postRef(postId);
  const images = postId === null ? [] : await deps.media.signals(tx, postId);
  const live = locked.length === 1 && !locked[0]!.deleted && post !== null && post.state !== "deleted_by_author" && images.some((image) => image.mediaId === signal.mediaId);
  if (!live || postId === null) {
    await signalHandled(tx, signal.id, "gone");
    return { handled: "gone", caseId: null, decisionId: null, limit: null };
  }

  const recorded = await recordIntakeIn(deps, tx, { ground: R1_GROUND, live: [{ type: "post", id: postId, position: 1, mediaId: signal.mediaId }] });
  const item = recorded.items[0];
  if (item === undefined || item.caseId === null) throw new Error("a program's finding was stored without a case");
  await joinSignal(tx, signal.id, item.id);

  if (deps.config.AUTOMATION_R1_ACTS !== "on") {
    await signalHandled(tx, signal.id, "finding");
    return { handled: "finding", caseId: item.caseId, decisionId: null, limit: null };
  }
  try {
    const decisionId = await tx.transaction((sp) => measureIn(deps, sp, { caseId: item.caseId!, postId, signalId: signal.id, mediaId: signal.mediaId }));
    return { handled: "measure", caseId: item.caseId, decisionId, limit: null };
  } catch (err) {
    const refusal = raisedMessage(err);
    if (refusal === "already_protected") {
      await signalHandled(tx, signal.id, "covered");
      return { handled: "covered", caseId: item.caseId, decisionId: null, limit: null };
    }
    if (refusal === "automation_capped") {
      const detail = raisedDetail(err);
      const limit = (CAP_LIMITS as readonly string[]).includes(detail ?? "") ? (detail as CapLimit) : null;
      await signalHandled(tx, signal.id, "capped");
      return { handled: "capped", caseId: item.caseId, decisionId: null, limit };
    }
    throw err;
  }
}

/** What a program's measure is taken on: the finding's case, its post, the signal and the signal's image. */
export interface MeasureInput {
  caseId: string;
  postId: string;
  signalId: string;
  mediaId: string;
}

/**
 * The params of a program's withhold, as the system's audit row carries them (AutomatedDecidedParams, 10.4): the values
 * every program's decision fixes, with the case's version as this transaction reads it after the item joined, the
 * snapshot and the current rulebook and redress versions.
 */
export function automatedParams(input: { stateVersion: number; snapshot: { id: string; digest: string }; mediaId: string }): AutomatedDecidedParams {
  return AutomatedDecidedParams.parse({
    kind: "interim",
    stateVersion: input.stateVersion,
    throughSeq: 0,
    reviewsDecisionId: null,
    snapshotId: input.snapshot.id,
    snapshotDigest: input.snapshot.digest,
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: RULES_VERSION,
    redressVersion: REDRESS_VERSION,
    category: RULE_DEFAULT_CATEGORY.R1,
    categoryKeyword: null,
    actions: [{ kind: "withhold_media", mediaId: input.mediaId }],
    factsDigest: null,
    reasonDigest: null,
    legalReferenceDigest: null,
    unfounded: [],
    replaced: false,
  });
}

/**
 * Step 2.4, inside the step's savepoint: the measure of a score. The snapshot of the post as it stands when the case's
 * newest differs (the snapshot route's own run); the decision's row without a decider; its one ledger row; the signal
 * handled `measure` with its decision; and last the system's plain audit row automated_decided on the case, naming the
 * decision, its one signal and the case's target, with the params decision_holds compares. Answers the decision's id.
 */
export async function measureIn(deps: Pick<ModerationDeps, "social" | "media">, tx: DbTx, input: MeasureInput): Promise<string> {
  const row = await caseById(tx, input.caseId);
  if (row === null) throw new Error("a program's finding names a case that does not exist");
  const snapshot = await snapshotIn(deps, tx, row);
  // The case's version as this transaction reads it after the item joined and the snapshot: what decisions_record compares.
  const stateVersion = (await caseById(tx, input.caseId))!.stateVersion;
  const params = automatedParams({ stateVersion, snapshot, mediaId: input.mediaId });
  const decisionId = randomUUID();
  await insertSystemDecision(tx, { id: decisionId, caseId: input.caseId, params });
  await insertAction(tx, decisionId, params.actions[0]);
  await signalHandled(tx, input.signalId, "measure", decisionId);
  await appendAuditRow(tx, {
    actorId: SYSTEM_ACTOR_ID,
    action: "automated_decided",
    targetType: "case",
    targetId: input.caseId,
    requestId: null,
    metadata: { params, decisionId, signalId: input.signalId, target: { type: "post", id: input.postId } },
  });
  return decisionId;
}

/** The alert automation_capped (7.9 step 3; W.7): the limit met as its fact (1), and the findings that stand without a measure since. */
async function alertCapped(deps: ModerationDeps, limit: CapLimit | null): Promise<void> {
  const count = await cappedSinceLastMeasure(deps.apiDb);
  const fact = limit === null ? {} : { [`limit${limit.charAt(0).toUpperCase()}${limit.slice(1)}`]: 1 };
  await staffAlert(deps, CAPPED_ALERT_KEY, CAPPED_ALERT_WINDOW_MS, { template: "automation_capped", facts: { at: deps.now().toISOString(), count, ...fact } });
}

/**
 * A score at or over the threshold of an image on a post becomes its signal and its step (7.9 step 1, then step 2). A
 * score under it, or one while no threshold applies, does nothing. An image that has its signal already starts nothing:
 * the step of that signal runs or ran, and the sweep finds it if it failed.
 */
export async function scoreSignal(deps: ModerationDeps, image: { mediaId: string; score: number | null }): Promise<StepOutcome | null> {
  const threshold = r1Threshold(deps.config);
  if (threshold === null || image.score === null || image.score < threshold.threshold) return null;
  const signalId = await insertScoreSignal(deps.apiDb, { mediaId: image.mediaId, score: image.score, thresholdVersion: threshold.thresholdVersion });
  return signalId === null ? null : automatedStep(deps, signalId);
}

/**
 * ModerationForSocial.imagesPublished (7.9, "What starts it"): createPost calls it after its commit when the post has
 * images. It starts its task on the module's background and returns at once, so createPost never waits for a deciding
 * transaction; with the scorer off it starts nothing. The task reads the post's images' scores, which the media module
 * stored when the worker's result was taken in, and runs the step of each at or over the threshold, one after the other.
 */
export function imagesPublished(deps: ModerationDeps, postId: string): void {
  if (r1Threshold(deps.config) === null) return;
  deps.background.start(async () => {
    for (const image of await deps.media.signals(deps.apiDb, postId)) await scoreSignal(deps, image);
  });
}

/** What one round of the sweep did. */
export interface SweepReport {
  /** Signals a crash or a failed step had left unhandled, run again. */
  retried: number;
  /** Images with a score at or over the threshold and no signal, given one. */
  signalled: number;
  /** Steps that failed again, which the next round tries while the signal is younger than SWEEP_HOURS. */
  failed: number;
  /** Whether the round wrote the daily alert automated_waiting. */
  waiting: boolean;
}

/**
 * One round of the job automated-sweep (7.9, 7.14): at most SWEEP_BATCH signals and images, each read only while its tool's
 * adapter is not off, so no program opens a finding on a day on which /rules prints its tool as off. First the signals
 * between one minute and SWEEP_HOURS old that no step handled (the module's own read of automated_signals); then, through
 * MediaForCases.unsignalled, the images of posts of the last SWEEP_HOURS whose score is at or over the threshold and that
 * no signal names. Each step in a try of its own. Then the daily alert automated_waiting, written once in 24 hours while a
 * request for a person has waited longer than the published target.
 */
export async function sweepRound(deps: ModerationDeps): Promise<SweepReport> {
  const report: SweepReport = { retried: 0, signalled: 0, failed: 0, waiting: false };
  const threshold = r1Threshold(deps.config);
  if (threshold !== null) {
    const pending = await unhandledSignals(deps.apiDb, ["r1_score"], SWEEP_HOURS, SWEEP_BATCH);
    for (const signalId of pending) {
      try {
        await automatedStep(deps, signalId);
        report.retried++;
      } catch (err) {
        report.failed++;
        deps.log.error({ err, signalId }, "automated-sweep: a step failed again; the next round tries it");
      }
    }
    const images = await deps.media.unsignalled(SWEEP_BATCH - pending.length, { hours: SWEEP_HOURS, r1: { threshold: threshold.threshold } });
    for (const image of images) {
      try {
        if ((await scoreSignal(deps, image)) !== null) report.signalled++;
      } catch (err) {
        report.failed++;
        deps.log.error({ err, mediaId: image.mediaId }, "automated-sweep: an image's step failed; its signal stays for the next round");
      }
    }
  }
  try {
    report.waiting = await automatedWaitingAlert(deps.apiDb, AUTOMATION_RULES.objectionTargetHours);
  } catch (err) {
    deps.log.error({ err }, "automated-sweep: the alert of requests for a person waiting could not be written");
  }
  return report;
}

/** The sweep as a job of the shared lock: a round a minute after the last one ended, on one instance at a time. */
export function createAutomatedSweepJob(deps: ModerationDeps, lock: JobLock) {
  return createJob({ name: AUTOMATED_SWEEP_JOB, intervalMs: AUTOMATED_SWEEP_INTERVAL_MS, lockTtlMs: AUTOMATED_SWEEP_INTERVAL_MS, lock, log: deps.log, run: () => sweepRound(deps) });
}

/**
 * POST /api/moderation/decisions/:id/objection, "Ask for a person" (7.10): the decision is read for its subject alone
 * (not_found for anyone else, for a decision that does not exist and for one its author was not told of); one statement
 * inserts the request, which its trigger refuses with objection_not_open unless the decision is a program's and a measure
 * of it is in force, and which a second text meets as the primary key, answered with the same code. A suspended account
 * may ask: no suspension is read here, as for the reply and the appeal. After the commit, unwaited for, every staff
 * account is alerted at most once in 15 minutes. The answer is the decision as it now reads.
 */
export async function objectToDecision(deps: ModerationDeps, viewer: string, decisionId: string, request: ObjectionRequest): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  try {
    await insertObjection(deps.apiDb, decisionId, request.text);
  } catch (err) {
    if (raisedMessage(err) === "objection_not_open" || violatedUniqueConstraint(err) === "automated_objections_pkey") throw new ModerationError("objection_not_open");
    throw err;
  }
  deps.background.start(async () => {
    const waiting = await objectionsWaiting(deps.apiDb);
    await staffAlert(deps, OBJECTION_ALERT_KEY, OBJECTION_ALERT_WINDOW_MS, { template: "automated_objection", facts: { at: deps.now().toISOString(), count: waiting.count } });
  });
  return authorDecisionView(deps, viewer, decisionId);
}
