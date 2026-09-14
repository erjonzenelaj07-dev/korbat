import type { Platform } from "@korbat/contracts";
import type { AuthDeps, RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { deviceLabel } from "../devices";
import { deviceHash } from "../identifiers";
import type { DeviceRow, UserRow } from "../repo";
import type { IssuedSession } from "../sessions";

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

export interface MfaTicket {
  userId: string;
  deviceId: string;
  platform: Platform;
}

export const mfaTicketKey = (ticket: string) => `mfa-ticket:${sha256Hex(ticket)}`;
export const notMeKey = (token: string) => `not-me:${sha256Hex(token)}`;

/** Registers or refreshes the device, issues a session and records the sign-in. */
export async function signIn(
  deps: AuthDeps,
  user: UserRow,
  device: DeviceInput,
  ctx: RequestContext,
  options: { alertNewDevice: boolean; mustReenrollMfa?: boolean },
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
    if (options.alertNewDevice) await alertNewDevice(deps, user, row, ctx);
  } else {
    await deps.repo.touchDevice(row.id, ctx.ipHash, deps.now());
  }
  const issued = await deps.sessions.issue(user.id, row.id);
  await deps.repo.appendEvent({ userId: user.id, type: "signin_success", deviceId: row.id, ipHash: ctx.ipHash });
  return { kind: "session", issued, platform: device.platform, mustReenrollMfa: options.mustReenrollMfa ?? false };
}

/** After a correct first factor: a session, or an MFA ticket when the account has two-factor on. */
export async function firstFactorPassed(deps: AuthDeps, user: UserRow, device: DeviceInput, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  if (user.totpEnabledAt) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true });
}

/** Best effort: a failed alert email is logged but does not block the sign-in. */
async function alertNewDevice(deps: AuthDeps, user: UserRow, device: DeviceRow, ctx: RequestContext): Promise<void> {
  const token = randomToken();
  await deps.kv.set(notMeKey(token), user.id, NOT_ME_TTL_MS);
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
