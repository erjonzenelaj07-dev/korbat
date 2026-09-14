import type { OnboardingHandleRequest, Profile, SignupCompleteRequest } from "@korbat/contracts";
import { meetsMinimumAge } from "../age";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { checkHandle } from "../handles";
import { emailHash } from "../identifiers";
import { HOUR } from "../limits";
import type { IssuedSession, Session } from "../sessions";
import { ageBlockKey, signupKey, type PendingSignup } from "./email";
import { signIn, type SignedIn } from "./signin";

export const AGE_BLOCK_MS = 24 * HOUR;

/**
 * Creates the account after a verified sign-up code. Terms and age are checked first; an under-16
 * date of birth stores nothing, blocks this email for 24 hours and ends the flow. Date of birth is
 * never written anywhere.
 */
export async function completeSignup(deps: AuthDeps, input: SignupCompleteRequest, ctx: RequestContext): Promise<SignedIn> {
  const raw = await deps.kv.get(signupKey(input.flowId));
  if (!raw) throw new AuthError("invalid_code", 400);
  const pending = JSON.parse(raw) as PendingSignup;

  if (input.termsVersion !== deps.config.termsVersion) throw new AuthError("terms_required", 400);

  if (!meetsMinimumAge(input.dateOfBirth, deps.now())) {
    await deps.kv.del(signupKey(input.flowId));
    await deps.kv.set(ageBlockKey(emailHash(deps.config.authHmacKey, pending.email)), "1", AGE_BLOCK_MS);
    throw new AuthError("age_requirement", 403);
  }

  if (!(await deps.kv.take(signupKey(input.flowId)))) throw new AuthError("invalid_code", 400);

  let user;
  try {
    user = await deps.repo.createUser({ email: pending.email, termsVersion: input.termsVersion, now: deps.now() });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError("invalid_code", 400, "An account with this email already exists. Sign in instead.");
    throw err;
  }
  await deps.repo.appendEvent({ userId: user.id, type: "signup", ipHash: ctx.ipHash });
  return signIn(deps, user, { deviceId: pending.deviceId, platform: pending.platform }, ctx, { alertNewDevice: false });
}

/** Onboarding: claims a handle, marks the account onboarded and swaps the onboarding session for a full one. */
export async function chooseHandle(
  deps: AuthDeps,
  session: Session,
  input: OnboardingHandleRequest,
): Promise<{ profile: Profile; issued: IssuedSession }> {
  if (session.onboarded) throw new AuthError("handle_taken", 409, "Your profile already exists.");
  const problem = checkHandle(input.handle);
  if (problem) throw new AuthError(problem, 400);
  const created = await deps.profiles.create({ id: session.userId, handle: input.handle, displayName: input.displayName });
  if (!created.ok) throw new AuthError("handle_taken", 409);
  await deps.repo.markOnboarded(session.userId, deps.now());
  const issued = await deps.sessions.rotate(session);
  return { profile: created.profile, issued };
}
