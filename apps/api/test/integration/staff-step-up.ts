import { randomUUID } from "node:crypto";
import type { AuthenticationResponseJSON, StaffStepUpOptionsRequest } from "@korbat/contracts";
import { resolveStaffSession, type ActiveStaffSession } from "../../src/auth/staff/sessions";
import { revokeStaffSession, stepUpOptions, verifyStepUp } from "../../src/auth/staff/step-up";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import type { StaffFlowHarness } from "./staff-enrolment";
import { DEVICE_BOUND } from "./staff-fixtures";
import { signInKey } from "./staff-sign-in";

// The staff step-up through the auth module's flows, for the suites that confirm an action without HTTP: the step-up
// suite, and the audit-verify suite, whose step-up rows come only from this flow (3a design, section 12).

/** 3a's one step-up action, revoking a staff session by its handle, as the console asks for it. */
export const revokeRequest = (handle: string): StaffStepUpOptionsRequest => ({ action: "staff_session_revoked", target: { type: "staff_session", id: handle }, params: {} });

/** A staff sign-in with the given counter, and the session it opened as requireStaff reads it. */
export async function signedIn(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, counter: number): Promise<{ token: string; session: ActiveStaffSession }> {
  const { token } = await signInKey(h, auth, credentialId, { counter });
  const session = await resolveStaffSession(h.deps, token, false);
  if (!session) throw new Error("the staff session just opened cannot be read");
  return { token, session };
}

export interface StepUpAssertOptions {
  /** The signature counter the authenticator reports. */
  counter: number;
  flags?: SoftFlags;
  /** The origin and relying party ID the browser signs for; the harness's console unless given. */
  origin?: string;
  rpId?: string;
  /** A challenge of the test's own, in place of fresh step-up options for the request. */
  challenge?: string;
}

/** The software authenticator's answer to fresh step-up options for `request` in `session`, signed by `credentialId`. */
export async function stepUpAssertion(
  h: StaffFlowHarness,
  auth: SoftAuthenticator,
  credentialId: string,
  session: ActiveStaffSession,
  request: StaffStepUpOptionsRequest,
  options: StepUpAssertOptions,
): Promise<AuthenticationResponseJSON> {
  const challenge = options.challenge ?? (await stepUpOptions(h.deps, session, request)).options.challenge;
  return auth.get({
    credentialId,
    rpId: options.rpId ?? h.deps.config.console!.rpId,
    challenge,
    origin: options.origin ?? h.deps.config.console!.origin,
    flags: options.flags ?? DEVICE_BOUND,
    counter: options.counter,
  });
}

/**
 * A whole confirmed revocation of the staff session `handle` from `session`, as the route runs it: the options, the
 * authenticator's answer, requireStaffStepUp's verification, then the revocation with its record.
 */
export async function revokeConfirmed(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, session: ActiveStaffSession, handle: string, counter: number) {
  const request = revokeRequest(handle);
  const stepUp = await stepUpAssertion(h, auth, credentialId, session, request, { counter });
  const ctx = { ...h.ctx, requestId: `req-${randomUUID()}` };
  const confirmed = await verifyStepUp(h.deps, session, request, stepUp, ctx);
  const revoked = await revokeStaffSession(h.deps, session, confirmed, ctx);
  return { stepUp, confirmed, revoked, requestId: ctx.requestId };
}
