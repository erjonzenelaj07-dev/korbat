import type { StaffMe } from "@korbat/contracts";
import type { StaffApi } from "./api";
import { checkSignInChallenge } from "./challenge";
import { authenticationResponseToJSON, ceremonyFailure, fromBase64url, requestOptionsFromJSON, type CredentialsLike } from "./webauthn";

/**
 * A staff sign-in as the console runs it (3a design, sections 7 and 9): options, the check of their challenge, the
 * browser's prompt, then the verify, which opens a session whatever session the browser held before. Every request is
 * marked: the person pressed a button, though no session may exist yet to move.
 *
 * `onlyCredential` (the base64url id of a credential) narrows the browser's prompt to that one key, whatever the options
 * listed: the enrolment's success page signs in with the key just registered, so the check after each enrolment proves
 * that key opens the console and never passes on an older key the browser chose instead.
 */
export async function signInWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, onlyCredential?: string): Promise<StaffMe> {
  const { options } = await deps.api.signInOptions({ activity: true });
  // Before the key is asked: a challenge that is not a staff sign-in's is never signed.
  checkSignInChallenge(options);
  const publicKey = requestOptionsFromJSON(options);
  if (onlyCredential !== undefined) publicKey.allowCredentials = [{ id: fromBase64url(onlyCredential), type: "public-key" }];
  let credential: unknown;
  try {
    credential = await deps.credentials.get({ publicKey });
  } catch (err) {
    throw ceremonyFailure(err);
  }
  return deps.api.signInVerify({ response: authenticationResponseToJSON(credential) }, { activity: true });
}
