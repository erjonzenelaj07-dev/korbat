import type { StaffEnrollOptionsRequest, StaffKey } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { ceremonyFailure, creationOptionsFromJSON, registrationResponseToJSON, type CredentialsLike } from "./webauthn";

/**
 * Enrolling a staff key from the link `staff.js enroll` printed (3a design, sections 7 and 9): options for the key's name
 * and kind, the browser's registration, then the verify with the same token and name. A refusal never spends the link,
 * so the person can try another key until it expires.
 */

/**
 * The browser's Signal API, where it has it (Chrome and Edge 132+, Safari 26): a static method of PublicKeyCredential
 * that asks the password manager to drop a credential the relying party does not keep.
 */
export interface SignalApi {
  signalUnknownCredential?(options: { rpId: string; credentialId: string }): Promise<void>;
}

/**
 * How a refused key leaves the person's password manager: "signalled" when the browser was asked to drop it, "by-hand"
 * when the person must delete it themselves, "none" when nothing was made that needs dropping.
 */
export type Cleanup = "none" | "signalled" | "by-hand";

export type EnrollResult = { ok: true; key: StaffKey } | { ok: false; code: string; status: number; cleanup: Cleanup };

/** The two refusals that mean the browser made and kept a credential the console will never accept. */
const KEPT_BUT_REFUSED = new Set(["staff_key_not_device_bound", "staff_key_not_user_verified"]);

const failure = (err: unknown, cleanup: Cleanup = "none"): EnrollResult => {
  const known = err instanceof ApiError ? err : ceremonyFailure(err);
  return { ok: false, code: known.code, status: known.status, cleanup };
};

/**
 * Asks the password manager to drop a refused credential, but only when the enrolment options said the console's relying
 * party ID is not the app's (rpShared false). In development both are localhost, and WebKit's bugs 322267 and 302624
 * show the call deleting other passkeys of the same relying party, so there it is never made. Where the browser lacks the
 * call, or it fails, the person is told to delete the entry by hand.
 */
async function dropRefused(signal: SignalApi | undefined, rpShared: boolean, rpId: string | undefined, credentialId: string): Promise<Cleanup> {
  if (rpShared || rpId === undefined || typeof signal?.signalUnknownCredential !== "function") return "by-hand";
  try {
    await signal.signalUnknownCredential({ rpId, credentialId });
    return "signalled";
  } catch {
    return "by-hand";
  }
}

export async function enrollKey(deps: { api: StaffApi; credentials: CredentialsLike; signal: SignalApi | undefined }, input: StaffEnrollOptionsRequest): Promise<EnrollResult> {
  let rpShared: boolean;
  let options: Record<string, unknown>;
  let publicKey: PublicKeyCredentialCreationOptions;
  try {
    // Every request here is marked: the person pressed a button. No session exists yet, so nothing moves.
    const answer = await deps.api.enrollOptions(input, { activity: true });
    rpShared = answer.rpShared;
    options = answer.options;
    publicKey = creationOptionsFromJSON(options);
  } catch (err) {
    return failure(err);
  }

  let response;
  try {
    response = registrationResponseToJSON(await deps.credentials.create({ publicKey }));
  } catch (err) {
    return failure(err);
  }

  try {
    const { key } = await deps.api.enrollVerify({ token: input.token, name: input.name, response }, { activity: true });
    return { ok: true, key };
  } catch (err) {
    if (err instanceof ApiError && KEPT_BUT_REFUSED.has(err.code)) {
      const rp = options.rp as { id?: unknown } | undefined;
      return failure(err, await dropRefused(deps.signal, rpShared, typeof rp?.id === "string" ? rp.id : undefined, response.id));
    }
    return failure(err);
  }
}
