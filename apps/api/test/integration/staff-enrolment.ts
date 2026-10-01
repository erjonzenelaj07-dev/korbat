import { randomUUID } from "node:crypto";
import type { StaffKeyKind } from "@korbat/contracts";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import type { SoftAuthenticator, SoftFlags } from "../auth/soft-authenticator";
import type { FlowHarness } from "./flow-harness";
import { DEVICE_BOUND } from "./staff-fixtures";

// Kept apart from staff-fixtures.ts, which the suites of the audit record and the schema share: only the suites of the
// enrolment flow need the flow itself.

export interface EnrolOptions {
  name?: string;
  kind?: StaffKeyKind;
  flags?: SoftFlags;
  aaguid?: string;
  transports?: string[];
}

/**
 * A whole enrolment through the auth module's flows, as the console runs it on the harness's console: the options for
 * the link's token, the software authenticator's answer from the console's origin, and the verification. A device-bound,
 * user-verified security key unless told otherwise.
 */
export async function enrolKey(h: FlowHarness, auth: SoftAuthenticator, token: string, options: EnrolOptions = {}) {
  const name = options.name ?? "Blue key";
  const { options: creation } = await enrollOptions(h.deps, { token, name, kind: options.kind ?? "security_key" });
  const response = auth.create({
    rpId: creation.rp.id!,
    challenge: creation.challenge,
    origin: h.deps.config.console!.origin,
    userHandle: Buffer.from(creation.user.id, "base64url"),
    flags: options.flags ?? DEVICE_BOUND,
    aaguid: options.aaguid,
    transports: options.transports ?? ["usb", "nfc"],
  });
  const requestId = `req-${randomUUID()}`;
  const { key } = await enrollVerify(h.deps, { token, name, response }, { ...h.ctx, requestId });
  return { key, credentialId: response.id, requestId };
}
