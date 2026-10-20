/**
 * What a program may do (3d design, sections 2 rows 14 to 25, 6.6, 7.9 and 10.1; Task 6): the numbers of the automated
 * decision, mirrored from the database's automation_rules(), which a database test holds member for column; the closed
 * lists of a signal and of a cap's limit, each the CHECK of its column or the detail its refusal carries; and the sweep's
 * batch. It imports nothing, so every other module of the contracts can read it while it loads.
 */

/**
 * The mirror of automation_rules() (section 6.6's table). The caps are counted by rule: R1's decisions an hour and a day,
 * and R2's apart, so a burst of scores never uses up the seals of known matches (row 18). `unansweredMax` measures of a
 * program under one rule in force stop new ones under that rule, and a request for a person older than
 * `unansweredHours` stops new ones under either. `r1Threshold` is null until the owner's build task measures one (row
 * 23): while it is null no score opens anything. `objectionTargetHours` is the published target of an answer to "Ask for
 * a person" (row 25), never a time after which a measure ends. The rest are the numbers of known material (rows 33 to 37),
 * which its task reads.
 */
export const AUTOMATION_RULES: {
  readonly decisionsPerHour: number;
  readonly decisionsPerDay: number;
  readonly r2DecisionsPerHour: number;
  readonly r2DecisionsPerDay: number;
  readonly unansweredMax: number;
  readonly unansweredHours: number;
  readonly refusalsPerHour: number;
  readonly noReportHours: number;
  readonly r1Threshold: number | null;
  readonly r1ThresholdVersion: number;
  readonly objectionTargetHours: number;
  readonly matchTimeoutMs: number;
  readonly matchRetryHours: number;
  readonly matcherDownMinutes: number;
  readonly pdqMinQuality: number;
  readonly matchKeepDays: number;
} = {
  decisionsPerHour: 20,
  decisionsPerDay: 100,
  r2DecisionsPerHour: 20,
  r2DecisionsPerDay: 100,
  unansweredMax: 20,
  unansweredHours: 72,
  refusalsPerHour: 20,
  noReportHours: 24,
  r1Threshold: null,
  r1ThresholdVersion: 1,
  objectionTargetHours: 24,
  matchTimeoutMs: 3000,
  matchRetryHours: 24,
  matcherDownMinutes: 15,
  pdqMinQuality: 50,
  matchKeepDays: 180,
};

/**
 * The test scorer's own threshold and its version (section 5, "The threshold while only the test adapter exists"): under
 * R1_CLASSIFIER=test the API compares a score with 0.5 and records the threshold version 0, so the suite exercises the
 * whole path and no stored signal can be mistaken for one of a real model, whose versions start at 1.
 */
export const R1_TEST_THRESHOLD = { threshold: 0.5, thresholdVersion: 0 } as const;

/** The kinds of a signal (automated_signals.kind): a score at or over the threshold, or a match record (Task 7). */
export const SIGNAL_KINDS = ["r1_score", "known_match"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * What the step did with a signal (automated_signals.handled): a finding without a measure; a finding and its measure;
 * a finding whose measure a cap or a limit refused; a finding whose measure another measure already stood for; or
 * nothing, since the image, its post or its author left first.
 */
export const SIGNAL_HANDLED = ["finding", "measure", "capped", "covered", "gone"] as const;
export type SignalHandled = (typeof SIGNAL_HANDLED)[number];

/**
 * The limit a refusal automation_capped met, its detail and the fact of the alert automation_capped: the hour's or the
 * day's decisions of a program under one rule, its measures under one rule left unanswered, or a request for a person
 * that has waited too long.
 */
export const CAP_LIMITS = ["hour", "day", "unanswered", "waiting"] as const;
export type CapLimit = (typeof CAP_LIMITS)[number];

/** How many signals one round of the sweep takes at most, and how far back it looks (section 7.9). */
export const SWEEP_BATCH = 20;
export const SWEEP_HOURS = 24;

// ---------------------------------------------------------------- known material (3d design, sections 2 rows 26 to 37, 6.7, 7.8 and 10.1; Task 7)

/** How many unanswered or capped checks one round of the job match-retry asks again at most (7.8 step 6). */
export const MATCH_RETRY_BATCH = 20;

/**
 * The state of an upload's comparison (media_hashes.check_state): waiting for its first answer; answered clear or
 * matched; unanswered in time, so the upload was accepted and the check is asked again for matchRetryHours; or an acting
 * match over the limit on refusals an hour, so the upload waits unposted, untold and unrefused until the check is asked
 * again.
 */
export const CHECK_STATES = ["pending", "clear", "matched", "unchecked", "capped"] as const;
export type MatchCheckState = (typeof CHECK_STATES)[number];

/** The hash a match rests on (media_matches.hash_type): three cryptographic hashes of the bytes as received, or PDQ. */
export const MATCH_HASH_TYPES = ["sha256", "sha1", "md5", "pdq"] as const;
export type MatchHashType = (typeof MATCH_HASH_TYPES)[number];

/** The kind of match as the source reports it (media_matches.match_kind). Only `exact` acts, and only of a listed class. */
export const MATCH_KINDS = ["exact", "near"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

/** How an admin ends a held upload's hold (upload_refusals.end_as): neither is a default, and the console preselects neither. */
export const UPLOAD_ENDS = ["report", "no_report"] as const;
export type UploadEnd = (typeof UPLOAD_ENDS)[number];

/** The reason of an end as no_report (upload_refusals.end_reason), a closed list. */
export const UPLOAD_END_REASONS = ["source_withdrew", "counsel_no_duty", "other"] as const;
export type UploadEndReason = (typeof UPLOAD_END_REASONS)[number];

/** The console's words for each reason of an end as no_report (8.6), held to the list by a test. */
export const UPLOAD_END_REASON_LABELS: Record<UploadEndReason, string> = {
  source_withdrew: "The source withdrew or corrected its entry",
  counsel_no_duty: "Counsel: no duty to report this",
  other: "Another reason, written in the operator's notes",
};

/**
 * The reason of an admin's answer without a seal on a case whose match is acting (decisions.match_answer_reason, note
 * 26): it puts an image with an exact match back before everyone with nobody having looked.
 */
export const MATCH_ANSWER_REASONS = ["source_withdrew", "counsel", "other"] as const;
export type MatchAnswerReason = (typeof MATCH_ANSWER_REASONS)[number];

/** The console's words for each reason (8.4), held to the list by a test. */
export const MATCH_ANSWER_REASON_LABELS: Record<MatchAnswerReason, string> = {
  source_withdrew: "The source withdrew or corrected its entry",
  counsel: "Counsel's advice, written in the operator's notes",
  other: "Another reason, written in the operator's notes",
};

/**
 * The statement's `matchKind`, derived and never copied (W.3): `exact` only for an exact match of a cryptographic hash of
 * the file's bytes, `near` for every match of a perceptual hash whatever the source called it, since an equal perceptual
 * hash says that two pictures look alike, not that two files are the same.
 */
export function statementMatchKind(hashType: MatchHashType, matchKind: MatchKind): MatchKind {
  return hashType !== "pdq" && matchKind === "exact" ? "exact" : "near";
}
