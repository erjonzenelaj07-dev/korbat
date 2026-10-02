import { STAFF_STEP_UP_CHALLENGE, StaffStepUpOptionsRequest, stepUpActionHash, stepUpBinding } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { messageFor } from "./messages";
import { authenticationResponseToJSON, ceremonyFailure, fromBase64url, requestOptionsFromJSON, type CredentialsLike } from "./webauthn";

/**
 * The step-up as the console runs it (3a design, sections 7 and 9). Before it asks the key to confirm an action, the page
 * checks the options the API gave it: the challenge must be the 74 bytes of the contracts' step-up layout with the
 * staff_step_up purpose, bound to the sha256 of this session's handle and the hash of exactly the `{ action, target,
 * params }` the page chose, and the allow list must hold one key. Otherwise the key is never asked, so an API under an
 * attacker's control cannot have it sign an action the person did not choose. The check trusts the page, which Caddy
 * serves from its image, not the API.
 */

/** Options that bind something other than the action the person chose; the key was not asked. */
export class StepUpMismatch extends Error {
  readonly code = "step_up_mismatch";
  readonly status = 0;
  constructor() {
    super(messageFor("step_up_mismatch"));
    this.name = "StepUpMismatch";
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks step-up options against this session's handle and the action the page is about to confirm, with the contracts'
 * layout, purpose code, sorted-JSON text and hash, never a copy of them. Throws StepUpMismatch on any difference.
 */
export async function checkStepUpOptions(options: { challenge: string; allowCredentials?: unknown }, sessionHandle: string, action: StaffStepUpOptionsRequest): Promise<void> {
  const layout = STAFF_STEP_UP_CHALLENGE;
  let challenge: Uint8Array;
  try {
    challenge = fromBase64url(options.challenge);
  } catch {
    throw new StepUpMismatch();
  }
  if (challenge.length !== layout.bytes) throw new StepUpMismatch();
  if (challenge[layout.versionAt] !== layout.version || challenge[layout.purposeAt] !== layout.purpose) throw new StepUpMismatch();
  // The binding is recomputed here from what the page chose, so a challenge bound to another action, target, params or
  // session never reaches the key.
  const expected = await stepUpBinding(sessionHandle, await stepUpActionHash(action));
  if (!sameBytes(challenge.subarray(layout.bindingAt, layout.bindingAt + layout.bindingBytes), expected)) throw new StepUpMismatch();
  // Exactly one key, the session's own: an empty list would let the browser offer any key the person holds.
  if (!Array.isArray(options.allowCredentials) || options.allowCredentials.length !== 1) throw new StepUpMismatch();
}

/**
 * The action that revokes one of the person's staff sessions: its handle as the target, in lower case, the one spelling
 * the API accepts for a step-up target (it hashes the id exactly as sent), and no params.
 */
export function sessionRevokeAction(handle: string): StaffStepUpOptionsRequest {
  return StaffStepUpOptionsRequest.parse({ action: "staff_session_revoked", target: { type: "staff_session", id: handle.toLowerCase() }, params: {} });
}

/**
 * "Sign out that session", confirmed by the key: the session's handle read from a marked /me right before, since the API
 * binds the challenge to the session the request's cookie names, which another tab's sign-in may have replaced since the
 * page read its session; then options for exactly this action, asked right before the key (the API reads a step-up
 * challenge only while more than a minute of its ten is left), checked, signed, then sent with the revocation. "gone"
 * when the session had already ended. Every request is marked: the person clicked.
 */
export async function revokeSessionWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, targetHandle: string): Promise<"revoked" | "gone"> {
  const action = sessionRevokeAction(targetHandle);
  const { sessionHandle } = await deps.api.me({ activity: true });
  const { options } = await deps.api.stepUpOptions(action, { activity: true });
  await checkStepUpOptions(options, sessionHandle, action);
  let credential: unknown;
  try {
    credential = await deps.credentials.get({ publicKey: requestOptionsFromJSON(options) });
  } catch (err) {
    throw ceremonyFailure(err);
  }
  const stepUp = authenticationResponseToJSON(credential);
  try {
    await deps.api.revokeSession(action.target.id, { stepUp }, { activity: true });
    return "revoked";
  } catch (err) {
    // The API answers a handle that names no live session of the person's as the app does: 404.
    if (err instanceof ApiError && err.status === 404 && err.code === "not_found") return "gone";
    throw err;
  }
}
