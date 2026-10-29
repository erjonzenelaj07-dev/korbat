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
import { avatarOwner, imagePost } from "../media";
import { appendAuditRow } from "../staff";
import { alertUrgentLane, staffAlert } from "./alerts";
import { authorDecisionView } from "./author";
import { authorDecision } from "./author-repo";
import {
  automatedWaitingAlert,
  cappedSinceLastMeasure,
  insertMatchSignal,
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
 * 7.9, 7.10 and 7.14; Task 6). A signal is a fact about one image on a post: a score at or over the threshold, or (Task 7)
 * a match record. The step turns it into a program's finding and, where the setting allows it, into one
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
  /** 3d Task 7: the finding cites R2, so the urgent alert goes out after the commit. */
  urgent?: boolean;
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

/**
 * 3d Task 7 (design, sections 6.6, 6.7 and 7.9 step 2.2): the ground of a program's finding on a match. A match of a class
 * the source itself lists as child sexual abuse material, acting or not, cites R2 with its default category: lane 0, and
 * suspect by 3c's trigger, so the post is frozen from the commit. A match of any other class cites no rule: the category
 * the Transparency Database gives a notice that names none, lane 2, not suspect, freezing nothing and alerting nobody.
 */
function matchGround(listed: boolean): IntakeGround {
  return listed
    ? { ...R1_GROUND, ruleId: "R2", category: RULE_DEFAULT_CATEGORY.R2 }
    : { ...R1_GROUND, ruleId: null, category: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE" };
}

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
  const postId = await imagePost(deps.apiDb, signal.mediaId);
  // 2d Task 4 (design, section 7.6): a signal on an avatar takes the account branch, with the avatar's owner, whom it never
  // changes, read before the transaction as an image's post is.
  const ownerId = postId === null ? await avatarOwner(deps.apiDb, signal.mediaId) : null;
  const authorId = postId === null ? ownerId : await deps.social.postAuthor(postId);
  let outcome: StepOutcome | null = null;
  for (let attempt = 0; outcome === null; attempt++) {
    try {
      outcome = await deps.apiDb.transaction((tx) => (ownerId !== null ? avatarStepIn(deps, tx, signal, ownerId) : stepIn(deps, tx, signal, postId, authorId)));
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
  // 3d Task 7 (7.9 step 3): a finding citing R2 raises the urgent alert, as any finding citing R2 does. A flag that cites
  // no rule alerts nobody: it stands in the queue and is counted on the home screen.
  if (done.urgent) {
    try {
      await alertUrgentLane(deps);
    } catch (err) {
      deps.log.error({ err }, "moderation: the urgent lane's alert for a program's finding under R2 was not sent; the dispatch round repeats it");
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
  // 3d Task 7: a match's record, read in a statement of its own after the profile's lock, as the signal is: a record
  // erased (or gone) ends the step with nothing written. 3d review H1: a record already marked handled does not, since
  // only a handled signal means a step ran: the record's mark alone may be a conflicting entry's, and the step then
  // writes its case on the marked record.
  const record = signal.kind === "known_match" && signal.matchId !== null ? await deps.media.matchRecord(tx, signal.matchId) : null;
  if (signal.kind === "known_match" && (record === null || record.erased)) throw new AlreadyHandled();

  // Gone: read after the profile's lock, which the author's deletion and the purge take too, so neither can commit meanwhile.
  const post = postId === null ? null : await deps.social.postRef(postId);
  const images = postId === null ? [] : await deps.media.signals(tx, postId);
  const live = locked.length === 1 && !locked[0]!.deleted && post !== null && post.state !== "deleted_by_author" && images.some((image) => image.mediaId === signal.mediaId);
  if (!live || postId === null) {
    await signalHandled(tx, signal.id, "gone");
    // 3d Task 7: the record's own mark too, so the sweep never reads it again; it stays and is erased on its schedule.
    if (record !== null) await deps.media.matchJoined(tx, record.id, null);
    return { handled: "gone", caseId: null, decisionId: null, limit: null };
  }

  const ground = record === null ? R1_GROUND : matchGround(record.listed);
  const recorded = await recordIntakeIn(deps, tx, { ground, live: [{ type: "post", id: postId, position: 1, mediaId: signal.mediaId }] });
  const item = recorded.items[0];
  if (item === undefined || item.caseId === null) throw new Error("a program's finding was stored without a case");
  await joinSignal(tx, signal.id, item.id);
  // 3d Task 7 (review ruling 8): the record is marked handled and names the finding's case, in this transaction; the
  // guard automated_signals_guard has held the finding's rule to the record's class at the join above.
  if (record !== null) await deps.media.matchJoined(tx, record.id, item.caseId);
  const urgent = record !== null && record.listed;

  // The measure: under R1 with AUTOMATION_R1_ACTS on; under R2 with AUTOMATION_R2_ACTS on and only for an acting match,
  // listed and exact (a flag seals nothing, which decision_holds holds at commit whatever this says).
  const acts = record === null ? deps.config.AUTOMATION_R1_ACTS === "on" : deps.config.AUTOMATION_R2_ACTS === "on" && record.acting;
  if (!acts) {
    await signalHandled(tx, signal.id, "finding");
    return { handled: "finding", caseId: item.caseId, decisionId: null, limit: null, urgent };
  }
  try {
    const decisionId = await tx.transaction((sp) => measureIn(deps, sp, { caseId: item.caseId!, postId, signalId: signal.id, mediaId: signal.mediaId, rule: record === null ? "R1" : "R2" }));
    return { handled: "measure", caseId: item.caseId, decisionId, limit: null, urgent };
  } catch (err) {
    const refusal = raisedMessage(err);
    if (refusal === "already_protected") {
      await signalHandled(tx, signal.id, "covered");
      return { handled: "covered", caseId: item.caseId, decisionId: null, limit: null, urgent };
    }
    if (refusal === "automation_capped") {
      const detail = raisedDetail(err);
      const limit = (CAP_LIMITS as readonly string[]).includes(detail ?? "") ? (detail as CapLimit) : null;
      await signalHandled(tx, signal.id, "capped");
      return { handled: "capped", caseId: item.caseId, decisionId: null, limit, urgent };
    }
    throw err;
  }
}

/**
 * 2d Task 4 (design, sections 7.6 and decision 15): the account branch of the step, for a signal on an avatar, in the
 * step's transaction:
 *   1. the owner's profile FOR NO KEY UPDATE, the first lock, then the signal again in a statement of its own (a handled one
 *      ends the run with nothing written), and a match's record as for a post's image;
 *   2. gone, handled `gone`, when the profile is deleted or the avatar is no longer its ready, unerased picture: the program
 *      judges only a picture someone may be shown;
 *   3. the finding, as for a post's image but about the account: its open case or a new one, one intake of the kind
 *      automated, one item about the account, the case's hold on its picture and the account's snapshot, which lists the
 *      picture by reference ("the avatar in its scope"); then the item on the signal;
 *   4. never a measure, whatever AUTOMATION_R1_ACTS says: no program takes a measure on an account. The signal is handled
 *      `finding`;
 *   5. while AUTOMATION_R1_ACTS is on and the signal is a score, R1's hold for review: avatar_review withholds the picture
 *      from everyone but its owner until a person answers the item.
 */
async function avatarStepIn(deps: ModerationDeps, tx: DbTx, signal: SignalRow, ownerId: string): Promise<StepOutcome> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}::text, true)`);
  const locked = await deps.social.lockAccounts(tx, [ownerId], "no key update");
  const current = await signalOf(tx, signal.id);
  if (current === null || current.handledAt !== null) throw new AlreadyHandled();
  const record = signal.kind === "known_match" && signal.matchId !== null ? await deps.media.matchRecord(tx, signal.matchId) : null;
  if (signal.kind === "known_match" && (record === null || record.erased)) throw new AlreadyHandled();

  // Read after the profile's lock, which setAvatar, removeAvatar and the purge take too.
  const pictured = await deps.media.signals(tx, { avatarId: signal.mediaId, ownerId });
  const handle = await accountHandle(tx, ownerId);
  if (locked.length !== 1 || locked[0]!.deleted || pictured.length === 0 || handle === null) {
    await signalHandled(tx, signal.id, "gone");
    if (record !== null) await deps.media.matchJoined(tx, record.id, null);
    return { handled: "gone", caseId: null, decisionId: null, limit: null };
  }

  const ground = record === null ? R1_GROUND : matchGround(record.listed);
  const recorded = await recordIntakeIn(deps, tx, { ground, live: [{ type: "account", id: ownerId, position: 1, namedHandle: handle }] });
  const item = recorded.items[0];
  if (item === undefined || item.caseId === null) throw new Error("a program's finding about an account was stored without a case");
  await joinSignal(tx, signal.id, item.id);
  if (record !== null) await deps.media.matchJoined(tx, record.id, item.caseId);
  await signalHandled(tx, signal.id, "finding");
  if (record === null && deps.config.AUTOMATION_R1_ACTS === "on") {
    await tx.execute(sql`select public.avatar_review(${signal.mediaId}::uuid, ${item.id}::uuid)`);
  }
  return { handled: "finding", caseId: item.caseId, decisionId: null, limit: null, urgent: record !== null && record.listed };
}

/** The account's handle now, as a finding names it, or null when there is no profile. */
async function accountHandle(tx: DbTx, accountId: string): Promise<string | null> {
  const [row] = await tx.execute<{ handle: string }>(sql`select handle from public.profiles where id = ${accountId}::uuid`);
  return row?.handle ?? null;
}

/** What a program's measure is taken on: the finding's case, its post, the signal and the signal's image. */
export interface MeasureInput {
  caseId: string;
  postId: string;
  signalId: string;
  mediaId: string;
  /** 3d Task 7: R2 seals the post's images on a match; R1 (the default) withholds the signal's image on a score. */
  rule?: "R1" | "R2";
}

/**
 * The params of a program's withhold, as the system's audit row carries them (AutomatedDecidedParams, 10.4): the values
 * every program's decision fixes, with the case's version as this transaction reads it after the item joined, the
 * snapshot and the current rulebook and redress versions.
 */
export function automatedParams(input: { stateVersion: number; snapshot: { id: string; digest: string }; mediaId: string; rule?: "R1" | "R2" }): AutomatedDecidedParams {
  const r2 = input.rule === "R2";
  return AutomatedDecidedParams.parse({
    kind: "interim",
    stateVersion: input.stateVersion,
    throughSeq: 0,
    reviewsDecisionId: null,
    snapshotId: input.snapshot.id,
    snapshotDigest: input.snapshot.digest,
    outcome: "restricted",
    ground: "incompatible",
    ruleId: r2 ? "R2" : "R1",
    rulesVersion: RULES_VERSION,
    redressVersion: REDRESS_VERSION,
    category: r2 ? RULE_DEFAULT_CATEGORY.R2 : RULE_DEFAULT_CATEGORY.R1,
    categoryKeyword: null,
    // 3d Task 7: a seal covers every image of the post (3c 6.2), so it names none.
    actions: [r2 ? { kind: "seal_media", mediaId: null } : { kind: "withhold_media", mediaId: input.mediaId }],
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
  const params = automatedParams({ stateVersion, snapshot, mediaId: input.mediaId, rule: input.rule ?? "R1" });
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
  const scoring = r1Threshold(deps.config) !== null;
  const matching = deps.config.MEDIA_MATCH !== "off";
  if (!scoring && !matching) return;
  deps.background.start(async () => {
    for (const image of await deps.media.signals(deps.apiDb, postId)) {
      if (scoring) await scoreSignal(deps, image);
      // 3d Task 7 (7.9, "What starts it"): an image accepted with a flag as an upload, now posted: its record's step.
      if (matching && image.match !== null && !image.match.handled) await matchSignal(deps, { mediaId: image.mediaId, matchId: image.match.id });
    }
  });
}

/**
 * 2d Task 4 (design, section 7.6): ModerationForSocial.avatarSet. setAvatar calls it after its commit. On the module's
 * background, unwaited for, it reads the avatar's score and match record through the media module (signals' avatar
 * form), and a score at or over the threshold, or a match the program is not done with, becomes its signal and its step,
 * which takes the account branch. With the scorer and the matcher off it starts nothing. Setting the same picture again
 * starts no second step: an image has one signal of a kind.
 */
export function avatarSet(deps: ModerationDeps, accountId: string, mediaId: string): void {
  const scoring = r1Threshold(deps.config) !== null;
  const matching = deps.config.MEDIA_MATCH !== "off";
  if (!scoring && !matching) return;
  deps.background.start(async () => {
    for (const image of await deps.media.signals(deps.apiDb, { avatarId: mediaId, ownerId: accountId })) {
      if (scoring) await scoreSignal(deps, image);
      if (matching && image.match !== null && !image.match.handled) await matchSignal(deps, { mediaId: image.mediaId, matchId: image.match.id });
    }
  });
}

/**
 * 3d Task 7 (7.9 step 1, then step 2): a match record of an image on a post becomes its signal and its step. An image that
 * has its match signal already (handled, or a second record of the same image) starts nothing; its record is marked
 * handled in a statement of its own, so the sweep does not find it again. 3d review H1: only a record that no signal
 * names: when the existing signal names this very record, its step (in flight, failed, or another entry's) is the one
 * that marks it, with its case, and a mark here ended that step as "already" for good.
 */
export async function matchSignal(deps: ModerationDeps, image: { mediaId: string; matchId: string }): Promise<StepOutcome | null> {
  const signalId = await insertMatchSignal(deps.apiDb, image);
  if (signalId === null) {
    await deps.apiDb.transaction((tx) => deps.media.matchPassed(tx, image.matchId));
    return null;
  }
  return automatedStep(deps, signalId);
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
 * One round of the job automated-sweep (7.9, 7.14): at most SWEEP_BATCH signals, then at most SWEEP_BATCH images (3d review
 * H1: each read its own batch), each read only while its tool's
 * adapter is not off, so no program opens a finding on a day on which /rules prints its tool as off. First the signals
 * between one minute and SWEEP_HOURS old that no step handled (the module's own read of automated_signals); then, through
 * MediaForCases.unsignalled, the images of posts of the last SWEEP_HOURS whose score is at or over the threshold and that
 * no signal names. Each step in a try of its own. Then the daily alert automated_waiting, written once in 24 hours while a
 * request for a person has waited longer than the published target.
 */
export async function sweepRound(deps: ModerationDeps): Promise<SweepReport> {
  const report: SweepReport = { retried: 0, signalled: 0, failed: 0, waiting: false };
  const threshold = r1Threshold(deps.config);
  // 3d Task 7: the matches' two reads run only while the comparison is on, the scores' only while the scorer is.
  const matching = deps.config.MEDIA_MATCH !== "off";
  if (threshold !== null || matching) {
    const kinds = [...(threshold !== null ? (["r1_score"] as const) : []), ...(matching ? (["known_match"] as const) : [])];
    const pending = await unhandledSignals(deps.apiDb, kinds, SWEEP_HOURS, SWEEP_BATCH);
    for (const signalId of pending) {
      try {
        await automatedStep(deps, signalId);
        report.retried++;
      } catch (err) {
        report.failed++;
        deps.log.error({ err, signalId }, "automated-sweep: a step failed again; the next round tries it");
      }
    }
    // 3d review H1: the second read has a batch of its own, so signals whose step ends with nothing written, or fails,
    // round after round, never starve the read of images and records that no signal names.
    const images = await deps.media.unsignalled(SWEEP_BATCH, { hours: SWEEP_HOURS, r1: threshold === null ? null : { threshold: threshold.threshold }, match: matching });
    for (const image of images) {
      try {
        const outcome = image.kind === "known_match" ? await matchSignal(deps, image) : await scoreSignal(deps, image);
        if (outcome !== null) report.signalled++;
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
 * of it is in force, and which a second text meets as the primary key, answered objection_exists (3d review L10: a stale
 * screen or a second device is told it asked already, never that a person decided). A suspended account
 * may ask: no suspension is read here, as for the reply and the appeal. After the commit, unwaited for, every staff
 * account is alerted at most once in 15 minutes. The answer is the decision as it now reads.
 */
export async function objectToDecision(deps: ModerationDeps, viewer: string, decisionId: string, request: ObjectionRequest): Promise<DecisionView> {
  const facts = await authorDecision(deps.apiDb, viewer, decisionId);
  if (!facts) throw new ModerationError("not_found");
  try {
    await insertObjection(deps.apiDb, decisionId, request.text);
  } catch (err) {
    if (raisedMessage(err) === "objection_not_open") throw new ModerationError("objection_not_open");
    if (violatedUniqueConstraint(err) === "automated_objections_pkey") throw new ModerationError("objection_exists");
    throw err;
  }
  deps.background.start(async () => {
    const waiting = await objectionsWaiting(deps.apiDb);
    await staffAlert(deps, OBJECTION_ALERT_KEY, OBJECTION_ALERT_WINDOW_MS, { template: "automated_objection", facts: { at: deps.now().toISOString(), count: waiting.count } });
  });
  return authorDecisionView(deps, viewer, decisionId);
}
