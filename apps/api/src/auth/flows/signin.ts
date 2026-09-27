import type { Platform } from "@korbat/contracts";
import type { AuthDeps, RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { deviceLabel } from "../devices";
import { deviceHash, emailHash } from "../identifiers";
import type { DeviceRow, UserRow } from "../repo";
import type { Factors, IssuedSession } from "../sessions";

export const MFA_TICKET_TTL_MS = 5 * 60 * 1000;
export const NOT_ME_TTL_MS = 24 * 60 * 60 * 1000;

export interface DeviceInput {
  deviceId: string;
  platform: Platform;
}

export interface SignedIn {
  kind: "session";
  issued: IssuedSession;
  platform: Platform;
  mustReenrollMfa: boolean;
}

export interface MfaPending {
  kind: "mfa";
  mfaTicket: string;
}

/** How the first factor was proven, recorded on signin_success. */
export type SignInMethod = "email" | "password" | "passkey";

/**
 * What a sign-in proved (1c design, section 7.1): its factors at the flows' clock, the method for the event, and the
 * passkey, when one signed in. The session it issues carries all three.
 */
export interface SignInProof {
  factors: Factors;
  method: SignInMethod;
  passkeyId?: string | null;
}

/** The first step's proof, kept until the MFA step adds its own. */
export interface MfaTicket extends SignInProof {
  userId: string;
  deviceId: string;
  platform: Platform;
}

/**
 * What a "this wasn't me" link acts on: the account, the device the alert was about, the sign-in's time (the lockdown's
 * anchor), the passkey that signed in, if one did, and the keyed hash of the address the alert went to, which the link
 * checks against the account's current address. Links from before 1c carry the first two only, or the bare user id.
 */
export interface NotMeToken {
  userId: string;
  deviceId: string | null;
  signedInAt?: number;
  passkeyId?: string | null;
  sentTo?: string;
}

export const mfaTicketKey = (ticket: string) => `mfa-ticket:${sha256Hex(ticket)}`;
export const notMeKey = (token: string) => `not-me:${sha256Hex(token)}`;

/** Registers or refreshes the device, issues a session holding what was proven, and records the sign-in with its method. */
export async function signIn(
  deps: AuthDeps,
  user: UserRow,
  device: DeviceInput,
  ctx: RequestContext,
  options: SignInProof & { alertNewDevice: boolean; mustReenrollMfa?: boolean },
): Promise<SignedIn> {
  const hash = deviceHash(deps.config.authHmacKey, device.deviceId);
  let row = await deps.repo.findDevice(user.id, hash);
  if (!row) {
    row = await deps.repo.createDevice({
      userId: user.id,
      deviceHash: hash,
      label: deviceLabel(ctx.userAgent, device.platform),
      platform: device.platform,
      ipHash: ctx.ipHash,
    });
    if (options.alertNewDevice) await alertNewDevice(deps, user, row, ctx, options);
  } else {
    await deps.repo.touchDevice(row.id, ctx.ipHash, deps.now());
  }
  const issued = await deps.sessions.issue(user.id, row.id, { factors: options.factors, passkeyId: options.passkeyId });
  await deps.repo.appendEvent({ userId: user.id, type: "signin_success", deviceId: row.id, ipHash: ctx.ipHash, metadata: { method: options.method } });
  return { kind: "session", issued, platform: device.platform, mustReenrollMfa: options.mustReenrollMfa ?? false };
}

/** After a correct first factor: a session, or an MFA ticket carrying the proof when the account has two-factor on. */
export async function firstFactorPassed(deps: AuthDeps, user: UserRow, device: DeviceInput, ctx: RequestContext, proof: SignInProof): Promise<SignedIn | MfaPending> {
  if (user.totpEnabledAt) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/** Best effort: a failed alert email is logged but does not block the sign-in. */
async function alertNewDevice(deps: AuthDeps, user: UserRow, device: DeviceRow, ctx: RequestContext, proof: SignInProof): Promise<void> {
  const token = randomToken();
  // The sign-in's time from the flows' clock, as the lockdown compares it with the rows' own times.
  const link: NotMeToken = {
    userId: user.id,
    deviceId: device.id,
    signedInAt: deps.now().getTime(),
    passkeyId: proof.passkeyId ?? null,
    sentTo: emailHash(deps.config.authHmacKey, user.email),
  };
  await deps.kv.set(notMeKey(token), JSON.stringify(link), NOT_ME_TTL_MS);
  await deps.repo.appendEvent({ userId: user.id, type: "new_device", deviceId: device.id, ipHash: ctx.ipHash });
  try {
    await deps.mailer.send({
      to: user.email,
      template: "new_device",
      data: { deviceLabel: device.label ?? "Unknown device", notMeUrl: `${deps.config.appOrigin}/not-me/${token}` },
    });
  } catch (err) {
    deps.log.error({ err, userId: user.id }, "new-device alert email failed");
  }
}
