import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { MATCH_ANSWER_REASONS, UPLOAD_END_REASONS, UPLOAD_ENDS } from "./automation";
import { hex, sha256, sortedJson } from "./canonical";
import {
  ACTION_KINDS,
  DECISION_KEYWORDS,
  MEASURES,
  RELEASE_BASES,
  RELEASE_POSTS_MAX,
  REVEAL_REASON_CATEGORIES,
  RULE_IDS,
  STANDING_DAYS,
  TDB_CATEGORIES,
  TIMED_KINDS,
  UNFOUNDED_MAX,
  compareDecisionActions,
  type ActionKind,
  type DecisionActionParams,
} from "./moderation";
import { AUDIT_EXPORT_MAX, MemberStateCode, ORDER_ACTION_KINDS, ORDER_GROUNDS, OrderCorrectFacts, OrderCorrectedParams, OrderEffectedParams, OrderEventRecordedParams, OrderReference } from "./orders";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
    /**
     * 3f (design, section 10.2): the operator's Member State, a key of STATE_FACTS, and the published contact point, each
     * null while unset. The console's page takes no build argument, so it reads both from here.
     */
    homeState: MemberStateCode.nullable(),
    contactPoint: z.string().nullable(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * A uuid in the one spelling PostgreSQL writes, lower-case hex. A step-up target's id is hashed exactly as sent, but the
 * database finds a uuid by value whatever its case and the audit row records the id as the database returns it: an
 * upper-case spelling would act on the row and leave a record whose target no longer hashes to the confirmed action, which
 * audit-verify would refuse for good. So any other spelling is refused, never changed.
 */
const LowerCaseUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

// The params of the three actions of moderation cases (3c design, section 10). They are written into the audit chain for
// good, so they hold only ids, enums, whole numbers and hex digests, never a free string: every text a decision carries is
// saved first and named here by its salted digest. No member has a transform (a schema that changed a value would have the
// key confirm one text and the record keep another), and the cross-field rules are refinements, which change nothing.
// The database's triggers check every rule again.

/** A case's version or an item's number: a whole number that PostgreSQL's integer holds. */
const Counter = z.number().int().min(0).max(2_147_483_647);

/** The version of the rulebook or of the redress texts: a whole number from 1 that PostgreSQL's smallint holds. */
const TextVersion = z.number().int().min(1).max(32_767);

/**
 * One measure or reversal, in one of two strict shapes (3e design, section 10.4). For every kind but three: its kind and,
 * for an image measure, the image, as a lower-case uuid (an image id's own schema lower-cases, which a param must not).
 */
const PlainAction = z.strictObject({ kind: z.enum(ACTION_KINDS).exclude([...TIMED_KINDS, ...ORDER_ACTION_KINDS]), mediaId: LowerCaseUuid.nullable() });

/**
 * A suspension, a termination or a restriction of reporting: also its days (a whole number from 1 to 30, null on a
 * termination) and whether it is announced with the reply window, so that the key signs both and the database compares
 * both with its ledger row.
 */
const TimedAction = z.strictObject({ kind: z.enum(TIMED_KINDS), mediaId: z.null(), days: z.number().int().min(STANDING_DAYS.min).max(STANDING_DAYS.max).nullable(), announced: z.boolean() });

const DecisionAction = z.union([PlainAction, TimedAction]);

/**
 * 3f (design, section 10.3): the reinstatement after an order, in a third strict shape that signs its ground, one of
 * ORDER_GROUNDS. Only a correction that reverses an order decision holds it, alone; the database checks both. No action
 * entry holds disable_by_order: only the effect of an order (order_effected) writes it.
 */
const ReinstateAction = z.strictObject({ kind: z.literal("reinstate_by_order"), mediaId: z.null(), orderGround: z.enum(ORDER_GROUNDS) });
const CaseDecisionActionEntry = z.union([PlainAction, TimedAction, ReinstateAction]);

const isReversal = (kind: ActionKind) => MEASURES[kind].lifts !== null;

/** The six measures of 3e: each only in a final decision that restricts. */
const MEASURES_OF_3E: readonly ActionKind[] = ["strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting"];

type SignedAction = DecisionActionParams & { days?: number | null; announced?: boolean; orderGround?: string };

/**
 * What is wrong with a decision's list of actions, or nothing: they come in the one order compareDecisionActions gives,
 * without repeats; only an image measure names an image, and it must; at most one of them acts on the post itself
 * (a seal acts on images and may stand beside it), and at most one seals; and a correction or a review lifts, never
 * restricts. And for 3e's kinds: a termination has no days, a suspension and a restriction of reporting have theirs, a
 * restriction of reporting is never announced, and a decision holds at most one suspension or termination.
 */
function actionProblems(actions: readonly SignedAction[], reversalsOnly: boolean): string[] {
  const problems: string[] = [];
  if (actions.some((action, i) => i > 0 && compareDecisionActions(actions[i - 1]!, action) >= 0)) problems.push("the actions are sorted by kind and then by image, without repeats");
  if (actions.some((action) => (MEASURES[action.kind].target === "image") !== (action.mediaId !== null))) problems.push("an image measure names its image, and no other kind names one");
  if (actions.filter((action) => action.kind === "withhold" || action.kind === "remove").length > 1) problems.push("a decision holds at most one measure on the post itself");
  if (actions.filter((action) => action.kind === "seal_media").length > 1) problems.push("a decision holds at most one seal");
  if (reversalsOnly && actions.some((action) => !isReversal(action.kind))) problems.push("a correction or a review holds reversals only");
  const daysWrong = (action: SignedAction) =>
    (action.kind === "terminate" && action.days !== null) || ((action.kind === "suspend" || action.kind === "restrict_reporting") && (action.days === null || action.days === undefined));
  if (actions.some(daysWrong)) problems.push("a termination names no days, a suspension and a restriction of reporting name theirs");
  if (actions.some((action) => action.kind === "restrict_reporting" && action.announced !== false)) problems.push("a restriction of reporting starts at once: it is never announced");
  if (actions.filter((action) => action.kind === "suspend" || action.kind === "terminate").length > 1) problems.push("a decision holds at most one suspension or termination");
  return problems;
}

/** Whether a list of ids is sorted, as text, without repeats. */
const sortedUnique = (ids: readonly string[]) => ids.every((id, i) => i === 0 || ids[i - 1]! < id);

/**
 * POST /api/staff/cases/:case/decisions: a decision taken while deciding (interim), one that decides the case (final) or
 * a correction of either. `stateVersion` is the case's version the console showed, `throughSeq` the last item a final
 * decision answers, and the snapshot is named with the digest the console computed from what it displayed. Two members of
 * 3e are always present (3e design, section 10.4): `unfounded`, the items a decision that found no breach marks
 * "manifestly unfounded" (lower-case uuids, sorted, without repeats; [] when none), and `replaced`, true only on a
 * correction that withdraws an announced suspension that has not started, to make room for another measure. A correction
 * may also keep the decision: the database decides from the corrected decision which of its two uses it is (a reply
 * answered, or a decision's marks withdrawn) and refuses one that is neither.
 */
export const CaseDecidedParams = z
  .strictObject({
    kind: z.enum(["interim", "final", "correction"]),
    stateVersion: Counter,
    throughSeq: Counter,
    reviewsDecisionId: LowerCaseUuid.nullable(),
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.enum(["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]),
    ground: z.enum(["incompatible", "illegal"]).nullable(),
    ruleId: z.enum(RULE_IDS).nullable(),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    categoryKeyword: z.enum(DECISION_KEYWORDS).nullable(),
    actions: z.array(CaseDecisionActionEntry).max(8),
    factsDigest: Sha256Hex.nullable(),
    reasonDigest: Sha256Hex.nullable(),
    legalReferenceDigest: Sha256Hex.nullable(),
    unfounded: z.array(LowerCaseUuid).max(UNFOUNDED_MAX),
    replaced: z.boolean(),
    /**
     * 3d Task 7 (design, sections 7.11 and 10.4, note 26): the reason of an answer without a seal on a case whose match is
     * acting, one of MATCH_ANSWER_REASONS; absent or null on every other decision. decision_holds holds it to the decision
     * and to the case at commit: a final decision that holds no seal_media and considers an item of a program's acting
     * match needs one, and no other decision may carry one. Absent reads as null, so a decision signed before 3d's Task 7
     * hashes as it did.
     */
    matchAnswerReason: z.enum(MATCH_ANSWER_REASONS).nullable().optional(),
  })
  .superRefine((params, ctx) => {
    const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (params.matchAnswerReason != null && !(params.kind === "final" && !params.actions.some((action) => action.kind === "seal_media"))) {
      refuse("matchAnswerReason", "only a final decision that holds no seal names the reason of an answer without a seal");
    }
    const outcomes = { interim: ["restricted"], final: ["restricted", "no_violation", "not_evident"], correction: ["kept", "partly_reversed", "reversed"] } as const;
    if (!(outcomes[params.kind] as readonly string[]).includes(params.outcome)) refuse("outcome", "a decision of this kind does not have this outcome");
    if (params.kind === "interim" && params.throughSeq !== 0) refuse("throughSeq", "a decision taken while deciding answers no item");
    if ((params.kind === "correction") !== (params.reviewsDecisionId !== null)) refuse("reviewsDecisionId", "a correction, and only a correction, names the decision it corrects");
    if (params.categoryKeyword !== null && params.ground !== "illegal") refuse("categoryKeyword", "a keyword goes only with the ground of the law");
    if (params.ground === "illegal" && params.ruleId !== null) refuse("ruleId", "a decision on the law cites no korbat rule");
    if (params.ground === "incompatible" && params.ruleId === null) refuse("ruleId", "a decision on the rules cites its rule");
    if (params.ground === "illegal" && params.legalReferenceDigest === null) refuse("legalReferenceDigest", "a decision on the law names its legal reference");
    if (params.outcome === "restricted" && (params.ground === null || params.factsDigest === null || params.reasonDigest === null)) {
      refuse("outcome", "a restriction carries its ground, its facts and its reason");
    }
    if (params.kind === "correction") {
      if (params.ground !== null || params.ruleId !== null || params.categoryKeyword !== null || params.factsDigest !== null || params.legalReferenceDigest !== null) {
        refuse("kind", "a correction states no ground of its own");
      }
      if (params.reasonDigest === null) refuse("reasonDigest", "a correction carries its reason");
    }
    for (const problem of actionProblems(params.actions, params.kind === "correction")) refuse("actions", problem);
    // 3e's refinements; the triggers check each again.
    if (params.actions.some((action) => MEASURES_OF_3E.includes(action.kind)) && !(params.kind === "final" && params.outcome === "restricted")) {
      refuse("actions", "a measure of 3e is taken only by a final decision that restricts");
    }
    if (params.actions.some((action) => action.kind === "strike") && (params.ground !== "incompatible" || params.ruleId === "R2")) {
      refuse("actions", "a strike goes only with a korbat rule other than R2");
    }
    if (params.outcome === "kept" && params.actions.length > 0) refuse("actions", "a kept correction holds no action");
    if (params.actions.some((action) => action.kind === "overrule") && params.outcome !== "reversed") refuse("actions", "a strike is overruled only with its whole finding: the outcome is reversed");
    if (params.unfounded.length > 0 && !(params.kind === "final" && params.outcome === "no_violation")) refuse("unfounded", "only a final decision that finds no breach marks reports");
    if (!sortedUnique(params.unfounded)) refuse("unfounded", "the marked items are sorted, without repeats");
    if (params.replaced && !(params.kind === "correction" && params.actions.some((action) => action.kind === "lift_suspension"))) {
      refuse("replaced", "only a correction that lifts a suspension withdraws it for another measure");
    }
    // 3f: a reinstatement after an order stands alone in a correction that reverses.
    if (params.actions.some((action) => action.kind === "reinstate_by_order") && !(params.kind === "correction" && params.outcome === "reversed" && params.actions.length === 1)) {
      refuse("actions", "a reinstatement after an order is the one action of a correction that reverses");
    }
  });
export type CaseDecidedParams = z.infer<typeof CaseDecidedParams>;

/**
 * POST /api/staff/decisions/:decision/review: the answer to the author's one appeal of the decision. It keeps the decision
 * or lifts measures of it, never restricts, and always gives its reason. A review withdraws no mark and replaces no
 * measure; it overrules a strike only when it reverses the decision whole.
 */
export const AppealsReviewedParams = z
  .strictObject({
    stateVersion: Counter,
    appealId: LowerCaseUuid,
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.enum(["kept", "partly_reversed", "reversed"]),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    actions: z.array(DecisionAction).max(8),
    reasonDigest: Sha256Hex,
  })
  .superRefine((params, ctx) => {
    for (const problem of actionProblems(params.actions, true)) ctx.addIssue({ code: "custom", path: ["actions"], message: problem });
    if (params.actions.some((action) => action.kind === "overrule") && params.outcome !== "reversed") {
      ctx.addIssue({ code: "custom", path: ["actions"], message: "a strike is overruled only with its whole finding: the outcome is reversed" });
    }
  });
export type AppealsReviewedParams = z.infer<typeof AppealsReviewedParams>;

/** POST /api/staff/items/:item/reveal: why the source of the item is revealed, as a category and the digest of the saved reason. */
export const IdentityRevealedParams = z.strictObject({ reasonCategory: z.enum(REVEAL_REASON_CATEGORIES), reasonDigest: Sha256Hex });
export type IdentityRevealedParams = z.infer<typeof IdentityRevealedParams>;

/**
 * 3f Task 6 (sections 7.16 and 10.3): POST /api/staff/audit/export, the keeper's download of the audit log's tail: the
 * rows after the place `after` (the caller's newest copied place, 0 before the first copy) up to the place `through` (the
 * head the page showed), at most AUDIT_EXPORT_MAX of them. The target is `audit`, with `through` as decimal digits.
 */
export const AuditExportedParams = z
  .strictObject({ after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), through: ChainSeq })
  .refine((p) => p.after < p.through && p.through - p.after <= AUDIT_EXPORT_MAX, { message: `after is below through, and at most ${AUDIT_EXPORT_MAX} places before it`, path: ["through"] });
export type AuditExportedParams = z.infer<typeof AuditExportedParams>;
/** The audit download's target id: the place `through` as decimal digits, without a sign or a leading zero. */
export const AuditThroughId = z.string().regex(/^[1-9][0-9]{0,14}$/, "the place the download ends at, as decimal digits");

/** 3f Task 6 (sections 7.17 step 6 and 10.3): POST /api/staff/restore/gaps/:gap/close, an admin's "Not needed" on a gap. */
export const GapClosedParams = z.strictObject({ disposition: z.literal("not_needed") });
export type GapClosedParams = z.infer<typeof GapClosedParams>;

/**
 * 3d Task 2 (sections 7.2 and 10.4): POST /api/staff/seals/:action/release, an admin's release of a seal for good, by the
 * seal's ledger row. `postIds`: the lowest unreleased posts of the seal, as the page showed them, sorted and without a
 * repeat, at most RELEASE_POSTS_MAX; `basis`; and the recorded leave by its id with its reference as its record holds it
 * (`leaveId`, `theirReference`), set exactly when the basis is `leave`. No param carries an authority's answer: an answer
 * is no ground. `theirReference` is the one string, a reference as 3f binds one; releases_confirmed compares it and
 * `leaveId` with the leave's record at commit, and every other member with the release's row.
 */
export const SealReleasedParams = z
  .strictObject({
    postIds: z.array(LowerCaseUuid).min(1).max(RELEASE_POSTS_MAX),
    basis: z.enum(RELEASE_BASES),
    leaveId: LowerCaseUuid.nullable(),
    theirReference: OrderReference.nullable(),
  })
  .superRefine((params, ctx) => {
    if (!sortedUnique(params.postIds)) ctx.addIssue({ code: "custom", path: ["postIds"], message: "the posts are sorted, without repeats" });
    const leave = params.basis === "leave";
    if (leave !== (params.leaveId !== null) || leave !== (params.theirReference !== null)) {
      ctx.addIssue({ code: "custom", path: ["leaveId"], message: "a release on the ground leave names the recorded leave and its reference, and no other ground does" });
    }
  });
export type SealReleasedParams = z.infer<typeof SealReleasedParams>;

/**
 * 3d Task 7 (design, sections 7.12 step 4 and 10.4): POST /api/staff/uploads/:refusal/end, an admin's end of a held
 * upload's hold, by the refusal's id. `endAs` is one of UPLOAD_ENDS and neither is a default: a request without it is
 * refused. `reason` is one of UPLOAD_END_REASONS exactly when `endAs` is no_report, and null otherwise; upload_hold_end
 * checks both again, and upload_refusals_confirmed holds the end to these params at commit.
 */
export const UploadHoldEndedParams = z
  .strictObject({ endAs: z.enum(UPLOAD_ENDS), reason: z.enum(UPLOAD_END_REASONS).nullable() })
  .refine((params) => (params.endAs === "no_report") === (params.reason !== null), {
    message: "an end as no_report names one of its reasons, and an end as report names none",
    path: ["reason"],
  });
export type UploadHoldEndedParams = z.infer<typeof UploadHoldEndedParams>;

/**
 * 3d Task 7 (design, sections 7.12 step 5 and 10.4): POST /api/staff/uploads/:refusal/release, the release of a held
 * upload ended as report, by the refusal's id: the ground and the recorded leave with its reference as its record holds
 * it, set exactly when the ground is leave. No param carries an authority's answer; releases_confirmed compares these with
 * the release's row at commit.
 */
export const UploadReleasedParams = z
  .strictObject({ basis: z.enum(RELEASE_BASES), leaveId: LowerCaseUuid.nullable(), theirReference: OrderReference.nullable() })
  .superRefine((params, ctx) => {
    const leave = params.basis === "leave";
    if (leave !== (params.leaveId !== null) || leave !== (params.theirReference !== null)) {
      ctx.addIssue({ code: "custom", path: ["leaveId"], message: "a release on the ground leave names the recorded leave and its reference, and no other ground does" });
    }
  });
export type UploadReleasedParams = z.infer<typeof UploadReleasedParams>;

/**
 * 3d Task 6 (design, sections 6.6, 7.9 and 10.4): the params of the system's audit row automated_decided, no step-up's:
 * a program's decision as decision_holds compares it with the decision's row, member for member as CaseDecidedParams, with
 * these values fixed: kind interim, throughSeq 0, no reviewed decision, outcome restricted, ground incompatible, rule R1
 * or R2, no keyword and no text, no mark and no withdrawal, and exactly one measure: a withhold_media of one image under
 * R1, or (Task 7) a seal_media under R2. The case's version, the snapshot, the texts' versions and the category are the
 * transaction's own.
 */
export const AutomatedDecidedParams = z
  .strictObject({
    kind: z.literal("interim"),
    stateVersion: Counter,
    throughSeq: z.literal(0),
    reviewsDecisionId: z.null(),
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.literal("restricted"),
    ground: z.literal("incompatible"),
    ruleId: z.enum(["R1", "R2"]),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    categoryKeyword: z.null(),
    actions: z.tuple([z.union([z.strictObject({ kind: z.literal("withhold_media"), mediaId: LowerCaseUuid }), z.strictObject({ kind: z.literal("seal_media"), mediaId: z.null() })])]),
    factsDigest: z.null(),
    reasonDigest: z.null(),
    legalReferenceDigest: z.null(),
    unfounded: z.tuple([]),
    replaced: z.literal(false),
  })
  .refine((params) => (params.ruleId === "R1") === (params.actions[0].kind === "withhold_media"), {
    message: "a program withholds one image under R1 and seals a post's images under R2",
    path: ["actions"],
  });
export type AutomatedDecidedParams = z.infer<typeof AutomatedDecidedParams>;

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: LowerCaseUuid, params: z.strictObject({}) },
  /** POST /api/staff/cases/:case/decisions: a decision on the case, by the case's id. */
  case_decided: { targetType: "case", targetId: LowerCaseUuid, params: CaseDecidedParams },
  /** POST /api/staff/decisions/:decision/review: the review of the appeal of a decision, by the decision's id. */
  appeals_reviewed: { targetType: "decision", targetId: LowerCaseUuid, params: AppealsReviewedParams },
  /** POST /api/staff/items/:item/reveal: who sent an item, by the item's id. */
  identity_revealed: { targetType: "intake_item", targetId: LowerCaseUuid, params: IdentityRevealedParams },
  /** 3f: POST /api/staff/orders/:order/events: a clock event, a closing, a reopening or an extension, by the order's id. */
  order_event_recorded: { targetType: "order", targetId: LowerCaseUuid, params: OrderEventRecordedParams },
  /** 3f: POST /api/staff/orders/:order/correct under the rule admin: the facts to change, by the order's id. */
  order_corrected: { targetType: "order", targetId: LowerCaseUuid, params: OrderCorrectedParams },
  /** 3f Task 3: POST /api/staff/orders/:order/effect: "Disable for an order" on up to ten of its items, by the order's id. */
  order_effected: { targetType: "order", targetId: LowerCaseUuid, params: OrderEffectedParams },
  /** 3f Task 6: POST /api/staff/restore/gaps/:gap/close: a gap closed as not needed, by the gap's id. */
  gap_closed: { targetType: "restore_gap", targetId: LowerCaseUuid, params: GapClosedParams },
  /** 3f Task 6: POST /api/staff/audit/export: the audit log's tail after one place up to another, by the place it ends at. */
  audit_exported: { targetType: "audit", targetId: AuditThroughId, params: AuditExportedParams },
  /** 3d Task 2: POST /api/staff/seals/:action/release: a release of a seal for good, by the seal's ledger row. */
  seal_released: { targetType: "seal", targetId: LowerCaseUuid, params: SealReleasedParams },
  /** 3d Task 7: POST /api/staff/uploads/:refusal/end: the end of a held upload's hold, by the refusal's id. */
  upload_hold_ended: { targetType: "upload_refusal", targetId: LowerCaseUuid, params: UploadHoldEndedParams },
  /** 3d Task 7: POST /api/staff/uploads/:refusal/release: the release of a held upload, by the refusal's id. */
  upload_released: { targetType: "upload_refusal", targetId: LowerCaseUuid, params: UploadReleasedParams },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [
  stepUpRequest("staff_session_revoked"),
  stepUpRequest("case_decided"),
  stepUpRequest("appeals_reviewed"),
  stepUpRequest("identity_revealed"),
  stepUpRequest("order_event_recorded"),
  stepUpRequest("order_corrected"),
  stepUpRequest("order_effected"),
  stepUpRequest("gap_closed"),
  stepUpRequest("audit_exported"),
  stepUpRequest("seal_released"),
  stepUpRequest("upload_hold_ended"),
  stepUpRequest("upload_released"),
]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/** 3f: POST /api/staff/orders/:order/events: the action's params with the step-up assertion added as `stepUp`. */
export const OrderEventRecordRequest = OrderEventRecordedParams.safeExtend({ stepUp: AuthenticationResponseJSON });
export type OrderEventRecordRequest = z.infer<typeof OrderEventRecordRequest>;

/** 3f Task 3: POST /api/staff/orders/:order/effect: the action's params with the step-up assertion added as `stepUp`. */
export const OrderEffectRequest = OrderEffectedParams.safeExtend({ stepUp: AuthenticationResponseJSON });
export type OrderEffectRequest = z.infer<typeof OrderEffectRequest>;

/**
 * 3f: POST /api/staff/orders/:order/correct (section 10.2): the facts to change and, only where the rule is admin, the
 * step-up of order_corrected, whose params are `{ facts }`. Under entry and caution no key is asked.
 */
export const OrderCorrectRequest = z.strictObject({ facts: OrderCorrectFacts, stepUp: AuthenticationResponseJSON.optional() });
export type OrderCorrectRequest = z.infer<typeof OrderCorrectRequest>;

/** POST /api/staff/items/:item/reveal: the action's params with the step-up assertion added as `stepUp`. */
export const IdentityRevealRequest = IdentityRevealedParams.extend({ stepUp: AuthenticationResponseJSON });
export type IdentityRevealRequest = z.infer<typeof IdentityRevealRequest>;

/**
 * POST /api/staff/cases/:case/decisions: the action's params with the step-up assertion added as `stepUp`. The route
 * answers 201 with the case as it now stands (CaseView), so the console shows what the decision left.
 */
export const CaseDecisionRequest = CaseDecidedParams.extend({ stepUp: AuthenticationResponseJSON });
export type CaseDecisionRequest = z.infer<typeof CaseDecisionRequest>;

/**
 * POST /api/staff/decisions/:decision/review: the action's params with the step-up assertion added as `stepUp`. The
 * route answers 201 with the case as it now stands (CaseView), as a decision's does.
 */
export const AppealReviewRequest = AppealsReviewedParams.extend({ stepUp: AuthenticationResponseJSON });
export type AppealReviewRequest = z.infer<typeof AppealReviewRequest>;

/**
 * 3d Task 2: POST /api/staff/seals/:action/release: the action's params with the step-up assertion added as `stepUp`. The
 * route answers 201 with the seal's case as it now stands (CaseView), as a decision's does.
 */
export const SealReleaseRequest = SealReleasedParams.safeExtend({ stepUp: AuthenticationResponseJSON });
export type SealReleaseRequest = z.infer<typeof SealReleaseRequest>;

/** 3d Task 7: the two requests of Held uploads, each its action's params with the step-up assertion as `stepUp`. */
export const UploadHoldEndRequest = UploadHoldEndedParams.safeExtend({ stepUp: AuthenticationResponseJSON });
export type UploadHoldEndRequest = z.infer<typeof UploadHoldEndRequest>;
export const UploadReleaseRequest = UploadReleasedParams.safeExtend({ stepUp: AuthenticationResponseJSON });
export type UploadReleaseRequest = z.infer<typeof UploadReleaseRequest>;

/**
 * Which ceremony a WebAuthn challenge was issued for: its second byte, in either layout below. A challenge answers only
 * the ceremony it names. The API's codec writes these codes, and the console checks them before it asks for the key, so
 * no challenge of one ceremony is ever signed in another.
 */
export const CHALLENGE_PURPOSES = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 } as const;

/**
 * The layout of every challenge but the step-up's (1c's codec, 3a design, section 5): version, purpose, expiry (epoch
 * milliseconds, big-endian), nonce, a 16-byte binding (the first 16 bytes of the sha256 of the session's handle or the
 * staff enrolment's id it is bound to, zeros for the two sign-ins), then the first 16 bytes of an HMAC over the 42 bytes
 * before it, 58 bytes sent as unpadded base64url. The API's codec writes it, and the console checks the staff sign-in's
 * and the staff registration's before it asks for the key.
 */
export const CEREMONY_CHALLENGE = {
  bytes: 58,
  encodedLength: 78,
  version: 1,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 16,
  sealAt: 42,
  sealBytes: 16,
} as const;

/**
 * The step-up challenge's layout (3a design, section 5), which the API's codec writes, audit-verify reads back from a
 * stored assertion without the sealing key, and the console checks before it asks for the key: version, purpose, expiry
 * (epoch milliseconds, big-endian), nonce, the full 32-byte binding, then the first 16 bytes of an HMAC over the 58 bytes
 * before it, 74 bytes sent as unpadded base64url. The other ceremonies' challenges are 58 bytes with purposes 1 to 5 and a
 * 16-byte binding (CEREMONY_CHALLENGE), so neither layout is ever read as the other.
 */
export const STAFF_STEP_UP_CHALLENGE = {
  bytes: 74,
  encodedLength: 99,
  version: 1,
  purpose: CHALLENGE_PURPOSES.staff_step_up,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 32,
  sealAt: 58,
  sealBytes: 16,
} as const;

/** What a step-up confirms: an action, its target and its params, as the route will execute them, or as an audit row records them. */
export interface StaffStepUpActionInput {
  action: string;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * The text an action's hash is taken over (3a design, section 7, Step-up): the sorted JSON of `{ action, target: { type,
 * id }, params }`. The step-up options take it from what the console sent, requireStaffStepUp from what the route is about
 * to do, audit-verify from the row's action, target and `metadata.params`, and the console from what it chose.
 */
export function stepUpActionText(input: StaffStepUpActionInput): string {
  return sortedJson({ action: input.action, target: { type: input.target.type, id: input.target.id }, params: input.params });
}

/**
 * The text a step-up challenge's binding is the sha256 of: the staff session's handle, a newline and the action's hash. A
 * confirmation made in one session, or for one action, therefore binds nothing else.
 */
export function stepUpBindingText(sessionHandle: string, actionHash: string): string {
  return `${sessionHandle}\n${actionHash}`;
}

/** The action's hash: the lower-case hex sha256 of stepUpActionText's UTF-8 bytes. */
export async function stepUpActionHash(input: StaffStepUpActionInput): Promise<string> {
  return hex(await sha256(stepUpActionText(input)));
}

/** The step-up challenge's binding: all 32 bytes of the sha256 of stepUpBindingText's UTF-8 bytes. */
export async function stepUpBinding(sessionHandle: string, actionHash: string): Promise<Uint8Array> {
  return sha256(stepUpBindingText(sessionHandle, actionHash));
}

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
  /** 3f Task 6 (8.7): the staff key a step-up confirmed the row with, by its id alone; null without a step-up. */
  keyId: z.uuid().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. 3f Task 6
 * (8.7, 10.2): `copy` is the caller's own newest copied place (`lastPlace`), null before their first copy, from which the
 * console's "Download since my last copy" starts.
 */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable(), copy: z.object({ lastPlace: ChainSeq.nullable() }) });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({
    cursor: ChainSeqParam.optional(),
    at: ChainSeqParam.optional(),
    action: z.enum(["staff_sign_in"]).optional(),
    // 3f Task 6 (8.7, "What one key confirmed"): only the rows a step-up of this key confirmed, in the period from `from`
    // to `to` (two instants, either open), for when a key may have been in someone else's hands.
    key: LowerCaseUuid.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] })
  .refine((query) => query.from === undefined || query.to === undefined || Date.parse(query.from) <= Date.parse(query.to), { message: "the period ends after it begins", path: ["to"] })
  .refine((query) => query.key !== undefined || (query.from === undefined && query.to === undefined), { message: "a period is asked with a key", path: ["key"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;

/**
 * 3f Task 6 (sections 7.16 and 10.5): one line of the audit download, one JSON object a line. Its members are the chain's
 * canonical text and the two hashes: `metadata` and `stepUp` are the stored jsonb as PostgreSQL prints it, as strings, so
 * that staff.js restore-import (or anyone) recomputes each hash off the server with the canonical text, and nothing of the
 * database's. `stepUp` is null without one.
 */
export const AuditExportLine = z.strictObject({
  v: z.number().int().positive(),
  place: ChainSeq,
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  at: z.iso.datetime(),
  actor: z.uuid(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  requestId: z.string().nullable(),
  staffSession: z.uuid().nullable(),
  keyId: z.uuid().nullable(),
  actionHash: Sha256Hex.nullable(),
  stepUp: z.string().nullable(),
  metadata: z.string(),
  prevHash: Sha256Hex,
  hash: Sha256Hex,
});
export type AuditExportLine = z.infer<typeof AuditExportLine>;

/** POST /api/staff/audit/export: the download's params with the step-up assertion as `stepUp`. */
export const AuditExportRequest = AuditExportedParams.extend({ stepUp: AuthenticationResponseJSON.optional() });

/**
 * 3f Task 6 (sections 7.16 and 10.2): POST /api/staff/audit/export/mark, the keeper's confirmation that the console holds
 * the whole file: its last line's place and hash. No key: it shows nothing, and it can only say "I hold it" of a file a
 * key released.
 */
export const AuditMarkRequest = z.strictObject({ through: ChainSeq, hash: Sha256Hex });
export type AuditMarkRequest = z.infer<typeof AuditMarkRequest>;
