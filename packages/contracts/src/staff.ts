import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
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
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: z.uuid(), params: z.strictObject({}) },
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
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [stepUpRequest("staff_session_revoked")]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

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
