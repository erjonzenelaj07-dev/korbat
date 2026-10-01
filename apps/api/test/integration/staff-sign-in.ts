import { randomUUID } from "node:crypto";
import type { AuthenticationResponseJSON } from "@korbat/contracts";
import { signInOptions, signInVerify } from "../../src/auth/staff/signin";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import { DEVICE_BOUND } from "./staff-fixtures";
import type { StaffFlowHarness } from "./staff-enrolment";

// The staff sign-in through the auth module's flows, for the suites that sign in without HTTP; kept apart from
// staff-enrolment.ts, which the enrolment suites share.

export interface AssertOptions {
  flags?: SoftFlags;
  /** The signature counter the authenticator reports; 1 unless given, past the 0 a new key starts at. */
  counter?: number;
  /** As SoftGetInput's: absent, the handle given at creation; null, none; otherwise these bytes. */
  userHandle?: Uint8Array | null;
  /** The origin and relying party ID the browser signs for; the harness's console unless given. */
  origin?: string;
  rpId?: string;
  /** A challenge of the test's own, in place of fresh sign-in options. */
  challenge?: string;
}

/** The software authenticator's answer to fresh staff sign-in options, as the console's page gets it. */
export async function staffAssertion(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, options: AssertOptions = {}): Promise<AuthenticationResponseJSON> {
  const challenge = options.challenge ?? (await signInOptions(h.deps)).options.challenge;
  return auth.get({
    credentialId,
    rpId: options.rpId ?? h.deps.config.console!.rpId,
    challenge,
    origin: options.origin ?? h.deps.config.console!.origin,
    flags: options.flags ?? DEVICE_BOUND,
    counter: options.counter ?? 1,
    userHandle: options.userHandle,
  });
}

/** A whole staff sign-in: the options, the authenticator's answer and the verification, from the harness's address unless told another. */
export async function signInKey(h: StaffFlowHarness, auth: SoftAuthenticator, credentialId: string, options: AssertOptions & { ipHash?: string } = {}) {
  const response = await staffAssertion(h, auth, credentialId, options);
  const requestId = `req-${randomUUID()}`;
  const signedIn = await signInVerify(h.deps, { response }, { ...h.ctx, ...(options.ipHash ? { ipHash: options.ipHash } : {}), requestId });
  return { ...signedIn, requestId, response };
}
