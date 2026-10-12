import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { hex, sha256, sortedJson } from "./canonical";
import { ACTION_KINDS, DECISION_KEYWORDS, MEASURES, REVEAL_REASON_CATEGORIES, RULE_IDS, TDB_CATEGORIES, compareDecisionActions, type ActionKind, type DecisionActionParams } from "./moderation";
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

/** One measure or reversal: its kind and, for an image measure, the image, as a lower-case uuid (an image id's own schema lower-cases, which a param must not). */
const DecisionAction = z.strictObject({ kind: z.enum(ACTION_KINDS), mediaId: LowerCaseUuid.nullable() });

const isReversal = (kind: ActionKind) => MEASURES[kind].lifts !== null;

/**
 * What is wrong with a decision's list of actions, or nothing: they come in the one order compareDecisionActions gives,
 * without repeats; only an image measure names an image, and it must; at most one of them acts on the post itself
 * (a seal acts on images and may stand beside it), and at most one seals; and a correction or a review lifts, never restricts.
 */
function actionProblems(actions: readonly DecisionActionParams[], reversalsOnly: boolean): string[] {
  const problems: string[] = [];
  if (actions.some((action, i) => i > 0 && compareDecisionActions(actions[i - 1]!, action) >= 0)) problems.push("the actions are sorted by kind and then by image, without repeats");
  if (actions.some((action) => (MEASURES[action.kind].target === "image") !== (action.mediaId !== null))) problems.push("an image measure names its image, and no other kind names one");
  if (actions.filter((action) => action.kind === "withhold" || action.kind === "remove").length > 1) problems.push("a decision holds at most one measure on the post itself");
  if (actions.filter((action) => action.kind === "seal_media").length > 1) problems.push("a decision holds at most one seal");
  if (reversalsOnly && actions.some((action) => !isReversal(action.kind))) problems.push("a correction or a review holds reversals only");
  return problems;
}

/**
 * POST /api/staff/cases/:case/decisions: a decision taken while deciding (interim), one that decides the case (final) or
 * a correction of either. `stateVersion` is the case's version the console showed, `throughSeq` the last item a final
 * decision answers, and the snapshot is named with the digest the console computed from what it displayed.
 */
export const CaseDecidedParams = z
  .strictObject({
    kind: z.enum(["interim", "final", "correction"]),
    stateVersion: Counter,
    throughSeq: Counter,
    reviewsDecisionId: LowerCaseUuid.nullable(),
    snapshotId: LowerCaseUuid,
    snapshotDigest: Sha256Hex,
    outcome: z.enum(["restricted", "no_violation", "not_evident", "partly_reversed", "reversed"]),
    ground: z.enum(["incompatible", "illegal"]).nullable(),
    ruleId: z.enum(RULE_IDS).nullable(),
    rulesVersion: TextVersion,
    redressVersion: TextVersion,
    category: z.enum(TDB_CATEGORIES),
    categoryKeyword: z.enum(DECISION_KEYWORDS).nullable(),
    actions: z.array(DecisionAction).max(8),
    factsDigest: Sha256Hex.nullable(),
    reasonDigest: Sha256Hex.nullable(),
    legalReferenceDigest: Sha256Hex.nullable(),
  })
  .superRefine((params, ctx) => {
    const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    const outcomes = { interim: ["restricted"], final: ["restricted", "no_violation", "not_evident"], correction: ["partly_reversed", "reversed"] } as const;
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
  });
export type CaseDecidedParams = z.infer<typeof CaseDecidedParams>;

/**
 * POST /api/staff/decisions/:decision/review: the answer to the author's one appeal of the decision. It keeps the decision
 * or lifts measures of it, never restricts, and always gives its reason.
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
  });
export type AppealsReviewedParams = z.infer<typeof AppealsReviewedParams>;

/** POST /api/staff/items/:item/reveal: why the source of the item is revealed, as a category and the digest of the saved reason. */
export const IdentityRevealedParams = z.strictObject({ reasonCategory: z.enum(REVEAL_REASON_CATEGORIES), reasonDigest: Sha256Hex });
export type IdentityRevealedParams = z.infer<typeof IdentityRevealedParams>;

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
]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

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
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
