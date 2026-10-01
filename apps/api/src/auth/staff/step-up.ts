import {
  AuthenticationResponseJSON,
  STAFF_STEP_UP_ACTIONS,
  stepUpActionHash,
  type StaffStepUpAction,
  type StaffStepUpOptionsRequest,
  type StaffStoredAssertion,
} from "@korbat/contracts";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { challengeKey, issueStepUpChallenge, readStepUpChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import type { ActiveStaffSession } from "./sessions";

/**
 * The staff step-up (3a design, section 7, Step-up): a route that changes something asks for a fresh assertion from the
 * session's own staff key, made over a challenge bound to the session's handle and to the action's hash, so it confirms
 * that one action, with those params, in that session, once. The routes live in the staff module; the credential work is
 * here, and every refusal the codec or the wrapper raises is answered staff_step_up_invalid, never a passkey_* code.
 */

/** An action a step-up confirms, as the route will execute it: one of the contracts' step-up actions, its target and params. */
export interface StaffStepUpRequest {
  action: StaffStepUpAction;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * What a verified step-up hands the route that executes the action: the action as confirmed, its hash, the key that
 * signed, and the assertion's three members, which the action's audit row stores for audit-verify.
 */
export interface StaffStepUpConfirmed extends StaffStepUpRequest {
  actionHash: string;
  keyId: string;
  assertion: StaffStoredAssertion;
}

/** Every refusal of a confirmation before or at its signature, a confirmation made for anything else included. */
const stepUpInvalid = () => new AuthError("staff_step_up_invalid", 403);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_step_up_invalid; challenge_expired stays, and the console asks again. */
async function invalidAsStepUp<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw stepUpInvalid();
    throw err;
  }
}

/**
 * Options for confirming one action: a step-up challenge bound to the session's handle and the hash of exactly the
 * `{ action, target, params }` the console sent, user verification required, the console's relying party, and an allow
 * list holding only the session's key. The console checks the binding before it asks for the key. Handing them out
 * stores nothing.
 */
export async function stepUpOptions(deps: AuthDeps, session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // requireStaff read the session with its key live; a key revoked since then ends the session as requireStaff would, and
  // requireStaff clears both cookies on this answer as on its own.
  if (!key || key.revokedAt !== null) throw new AuthError("staff_session_required", 401);
  const actionHash = await stepUpActionHash(request);
  const challenge = issueStepUpChallenge(challengeKey(deps.config.authHmacKey), deps.now(), session.handle, actionHash);
  const options = await authenticationOptions({
    rpId: staffConsole.rpId,
    allow: [{ id: key.credentialId, transports: key.transports }],
    challenge,
    userVerification: "required",
  });
  return { options };
}

/**
 * Verifies a confirmation of `request` in `session`. The action's hash is recomputed from what the route is about to do,
 * and the challenge read from the assertion is checked against the session's handle and that hash, then spent, before
 * anything else runs. The assertion must come from the session's own key, verified against CONSOLE_ORIGIN and
 * CONSOLE_RP_ID alone. A challenge the codec refuses (forged, of another purpose, bound to another session, action,
 * target or params, or spent), an assertion from another key and one the library refuses are all staff_step_up_invalid.
 * Only after the signature are the flags read, each refusal with its own code, as at sign-in; then 1c's counter rule, where
 * a regression revokes the key and every staff session it opened.
 */
export async function verifyStepUp(
  deps: AuthDeps,
  session: ActiveStaffSession,
  request: StaffStepUpRequest,
  stepUp: AuthenticationResponseJSON,
  ctx: StaffRequestContext,
): Promise<StaffStepUpConfirmed> {
  const staffConsole = consoleOf(deps);
  const now = deps.now();
  const actionHash = await stepUpActionHash(request);
  const challenge = await invalidAsStepUp(() => readResponseChallenge(stepUp));
  // Read with a minute of its life to spare, so the audit row written after the steps below is never later than its expiry.
  await invalidAsStepUp(() => readStepUpChallenge(challengeKey(deps.config.authHmacKey), challenge, now, session.handle, actionHash));
  await invalidAsStepUp(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // Only the session's own key confirms, as the options' allow list said; a key revoked since requireStaff read the
  // session confirms nothing either.
  if (!key || key.revokedAt !== null || key.userId !== session.userId || stepUp.id !== key.credentialId) throw stepUpInvalid();
  const verified = await invalidAsStepUp(() =>
    verifyAuthentication({
      response: stepUp,
      expectedChallenge: challenge,
      origins: [staffConsole.origin],
      rpId: staffConsole.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed (3a design, section 2).
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  // False when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!(await deps.repo.recordStaffKeyUse({ keyId: key.id, userId: key.userId, newCounter: verified.newCounter, now }))) {
    return revokeForCounterRegression(deps, key, ctx, "step_up");
  }
  return {
    action: request.action,
    target: { type: request.target.type, id: request.target.id },
    params: request.params,
    actionHash,
    keyId: key.id,
    // Exactly as the browser sent them: audit-verify checks the signature over these bytes.
    assertion: { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
  };
}

/**
 * Stands before every staff route that changes something, behind requireStaff (3a design, section 7, Step-up). The route
 * takes its own body with the assertion added as `stepUp`; the rest of the body is the action's params, validated by the
 * action's own strict schema, and `target` reads the action's target from the request itself (for DELETE
 * /api/staff/sessions/:handle, the path's handle). The action's hash is recomputed from exactly that, so the route executes
 * only what the key confirmed. Without `stepUp` the answer is staff_step_up_required; a malformed body is invalid_request,
 * as the shared validator answers it. The confirmed step-up is left in `staffStepUp` for the route to record.
 */
export function requireStaffStepUp(deps: AuthDeps, action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  const body = spec.params.extend({ stepUp: AuthenticationResponseJSON.optional() });
  const readBody = validate("json", body);
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("staffSession");
    if (!session) throw new Error("requireStaffStepUp runs behind requireStaff");
    const targetId = spec.targetId.safeParse(target(c));
    if (!targetId.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(targetId.error)), 400);
    }
    // The shared validator answers a body its schema refuses; on success it leaves the parsed body on the request.
    const refused = await readBody(c as Parameters<typeof readBody>[0], async () => {});
    if (refused) return refused;
    const { stepUp, ...params } = body.parse((c.req as unknown as { valid(target: "json"): unknown }).valid("json"));
    if (stepUp === undefined) throw new AuthError("staff_step_up_required", 403);
    const ctx: StaffRequestContext = { ipHash: c.get("clientIpHash") ?? "direct", userAgent: c.req.header("user-agent"), requestId: c.get("requestId") };
    c.set("staffStepUp", await verifyStepUp(deps, session, { action, target: { type: spec.targetType, id: targetId.data }, params }, stepUp, ctx));
    await next();
  });
}

/**
 * DELETE /api/staff/sessions/:handle, once its step-up verified: revokes one of the person's own live staff sessions with
 * its staff_session_revoked event and its audit row, which carries the confirmation, in one transaction. False when the
 * handle names no live session of the person's, which writes nothing. When the confirming key or the account no longer
 * opens anything by then, the session that confirmed has ended: staff_session_required, and nothing is revoked. No mail:
 * the person did it themselves, with their key.
 */
export async function revokeStaffSession(deps: AuthDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean> {
  // A confirmation of anything else never revokes a session: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "staff_session_revoked" || confirmed.target.type !== "staff_session" || confirmed.keyId !== session.keyId) {
    throw new Error("a staff session's revocation needs a step-up that confirmed it");
  }
  const outcome = await deps.repo.revokeConfirmedStaffSession({
    userId: session.userId,
    staffSession: session.handle,
    keyId: confirmed.keyId,
    handle: confirmed.target.id,
    actionHash: confirmed.actionHash,
    params: confirmed.params,
    stepUp: confirmed.assertion,
    now: deps.now(),
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
  });
  // requireStaff clears both cookies on this answer, as on its own.
  if (outcome === "ended") throw new AuthError("staff_session_required", 401);
  return outcome === "revoked";
}
