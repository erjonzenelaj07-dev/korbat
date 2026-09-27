import { randomBytes } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PasskeyListResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterVerifyRequest,
  PasskeyRemoveLinkRequest,
  PasskeyRenameRequest,
  PasskeySignInVerifyRequest,
  PasskeyView,
} from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type RequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { MFA_TICKET_TTL_MS, mfaTicketKey, signIn, type DeviceInput, type MfaPending, type MfaTicket, type SignedIn } from "../flows/signin";
import { lockdown } from "../flows/lockdown";
import { notifyAccount } from "../flows/notify";
import { deviceHash, emailHash } from "../identifiers";
import { HOUR, MINUTE, enforceLimit } from "../limits";
import type { AddPasskeyOutcome, PasskeyLimits, PasskeyRow, UserRow } from "../repo";
import type { FactorKind, Session } from "../sessions";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "./challenge";
import {
  authenticationOptions,
  readResponseChallenge,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedAuthentication,
} from "./webauthn";

const DAY = 24 * HOUR;

/** At most this many passkeys on an account at a time (1c design, section 2). */
export const PASSKEY_CAP = 10;
/** At most this many added in any 24 hours, counted from the passkey_added events, so removing one frees no slot of the day. */
export const PASSKEY_ADDITIONS_PER_DAY = 5;
export const PASSKEY_ADDITIONS_WINDOW_MS = DAY;
/** A passkey counts as new for this long: the Security list marks it and offers "This wasn't me" on it. */
export const NEW_PASSKEY_MS = 7 * DAY;
/** How long the remove link in the passkey_added notice works. */
export const PASSKEY_REMOVE_TTL_MS = 7 * DAY;
export const REGISTER_OPTIONS_PER_HOUR = 10;
export const RENAMES_PER_HOUR = 30;
export const REMOVALS_PER_HOUR = 10;
export const NOT_MINE_PER_DAY = 5;
export const REMOVE_LINKS_PER_IP_PER_HOUR = 10;
/** The window the two unauthenticated sign-in limits count over. */
export const SIGNIN_WINDOW_MS = 15 * MINUTE;
export const SIGNIN_OPTIONS_PER_IP = 30;
export const SIGNIN_VERIFY_PER_IP = 20;
/** A passkey sign-in from a device the account has not used: bounded per account, since the assertion carries no session to key by. */
export const SIGNIN_NEW_DEVICE_PER_HOUR = 5;
export const SIGNIN_NEW_DEVICE_PER_DAY = 20;

const LIMITS: PasskeyLimits = { passkeys: PASSKEY_CAP, additions: PASSKEY_ADDITIONS_PER_DAY, windowMs: PASSKEY_ADDITIONS_WINDOW_MS };
const LINK_GONE = "This link has expired or was already used.";

/** The remove link is a bearer credential for 7 days, so the store holds only its hash. */
export const passkeyRemoveKey = (token: string) => `passkey-remove:${sha256Hex(token)}`;

/**
 * What a remove link acts on: the account, the passkey, its creation (epoch milliseconds from the flows' clock, the
 * lockdown's anchor, which holds whether or not the passkey is still there) and the keyed hash of the address the link
 * went to, which the link checks against the account's current address.
 */
export interface PasskeyRemoveToken {
  userId: string;
  passkeyId: string;
  createdAt: number;
  sentTo: string;
}

/** Refuses a session that has not proven enough within the window: level 2 on an account with TOTP unless told level 1, as the route's guard does. */
function requireFresh(deps: AuthDeps, session: Session, level: 1 | 2 = deps.sessions.requiredLevel(session)): void {
  const needed = deps.sessions.reauthNeeded(session, level);
  if (needed) throw new AuthError("reauth_required", 403, undefined, undefined, needed);
}

/**
 * A bound refused, as the app reads it: the reason in the details, and for the daily bound the seconds until the day has
 * a slot again, said in hours in the message (the cap keeps the code's own message).
 */
function limitReached(bound: { reason: "cap" } | { reason: "daily"; retryAfterSeconds: number }): AuthError {
  if (bound.reason === "cap") return new AuthError("passkey_limit", 409, undefined, undefined, { reason: "cap" });
  const hours = Math.max(1, Math.ceil(bound.retryAfterSeconds / 3600));
  const wait = hours === 1 ? "1 hour" : `${hours} hours`;
  return new AuthError("passkey_limit", 409, `You added ${PASSKEY_ADDITIONS_PER_DAY} passkeys today. You can add another in about ${wait}.`, undefined, {
    reason: "daily",
    retryAfter: bound.retryAfterSeconds,
  });
}

/** Both bounds before the options are handed out, so a full account is told at once; the registration's transaction checks them again. */
async function checkBounds(deps: AuthDeps, userId: string): Promise<void> {
  if ((await deps.repo.countPasskeys(userId)) >= PASSKEY_CAP) throw limitReached({ reason: "cap" });
  const additions = await deps.repo.recentPasskeyAdditions(userId, PASSKEY_ADDITIONS_WINDOW_MS, PASSKEY_ADDITIONS_PER_DAY);
  if (additions.count >= PASSKEY_ADDITIONS_PER_DAY) throw limitReached({ reason: "daily", retryAfterSeconds: additions.retryAfterSeconds });
}

const isNew = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() < NEW_PASSKEY_MS;

/** A passkey as the Security list shows it: nothing of the key itself. */
function view(row: PasskeyRow, createdOn: string | null, session: Session, now: Date): PasskeyView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    synced: row.backedUp,
    createdOn,
    current: session.passkeyId === row.id,
    isNew: isNew(row.createdAt, now),
    suspended: row.suspectAt !== null,
  };
}

/** The name a passkey gets when the owner gives none: after the platform of the device whose session added it. */
function defaultName(platform: string | undefined): string {
  const where = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "the web";
  return `Passkey on ${where}`;
}

/** A time as the passkey notices print it: the date and the minute in UTC, since the reader's zone is unknown. */
function mailTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Options for adding a passkey (1c design, section 7.3): the account's user handle (set now if it never had one), the
 * label the password manager will show, the account's passkeys excluded so an authenticator does not add a second copy,
 * and a registration challenge bound to this session's handle. Needs level 2 on an account with TOTP (the route checks as
 * well): adding a credential is the first thing a stolen session would do.
 */
export async function registerOptions(deps: AuthDeps, session: Session, input: PasskeyRegisterOptionsRequest): Promise<{ options: PublicKeyCredentialCreationOptionsJSON }> {
  requireFresh(deps, session);
  // Counted by the handle: a rotation keeps it, and no other session of the account can spend it.
  await enforceLimit(deps.kv, `passkey-register:${session.handle}`, REGISTER_OPTIONS_PER_HOUR, HOUR);
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await checkBounds(deps, user.id);
  // 32 random bytes, never the account id, set once: a registration racing this one reads the same bytes back.
  const userId = user.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(user.id, randomBytes(32)));
  if (!userId) throw new AuthError("invalid_credentials", 401);
  const held = await deps.repo.listPasskeys(user.id);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "register", deps.now(), session.handle);
  const options = await registrationOptions({
    rp: { id: deps.config.webauthn.rpId, name: deps.config.webauthn.rpName },
    // The label goes to the password manager and nowhere else: korbat keeps nothing of it.
    user: { id: userId, name: input.label, displayName: input.label },
    exclude: held.map((p) => ({ id: p.credentialId, transports: p.transports })),
    challenge,
  });
  return { options };
}

/**
 * Stores the passkey the browser created (1c design, section 7.3). The challenge is read from the response, checked
 * against this session's handle and spent before anything else runs, so it stays spent whatever happens next; it was
 * issued to a strong-fresh session and bound to it, so no second freshness check is needed and a ceremony that outlasts
 * the window still completes. The row and its passkey_added event land in one transaction that checks both bounds
 * again. The session's factors do not change: adding a passkey proves nothing about the session. Then the owner is told,
 * with a one-shot link that runs the lockdown for 7 days, tied to the address it goes to.
 */
export async function registerVerify(deps: AuthDeps, session: Session, input: PasskeyRegisterVerifyRequest): Promise<{ passkey: PasskeyView }> {
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "register", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const verified = await verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: deps.config.webauthn.origins, rpId: deps.config.webauthn.rpId });
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  const device = await deps.repo.findDeviceById(session.deviceId);
  const name = input.name ?? defaultName(device?.platform);
  let outcome: AddPasskeyOutcome;
  try {
    outcome = await deps.repo.addPasskey(
      {
        userId: user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        aaguid: verified.aaguid,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        uvInitialized: verified.userVerified,
        createdDeviceId: session.deviceId,
        // From the flows' clock, like password_changed_at: the lockdown compares it with flow times.
        createdAt: now,
        name,
      },
      LIMITS,
    );
  } catch (err) {
    // A credential id korbat already holds, whoever's it is: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw new AuthError("passkey_invalid", 401);
    throw err;
  }
  if (!outcome.ok) {
    if (outcome.reason === "gone") throw new AuthError("invalid_credentials", 401);
    throw limitReached(outcome);
  }
  const passkey = outcome.passkey;
  // After the commit, and best effort as every notice is: a failed mail never undoes a registration.
  const token = randomToken();
  const link: PasskeyRemoveToken = { userId: user.id, passkeyId: passkey.id, createdAt: passkey.createdAt.getTime(), sentTo: emailHash(deps.config.authHmacKey, user.email) };
  await deps.kv.set(passkeyRemoveKey(token), JSON.stringify(link), PASSKEY_REMOVE_TTL_MS);
  await notifyAccount(deps, user.email, "passkey_added", {
    name,
    deviceLabel: device?.label ?? "Unknown device",
    time: mailTime(now),
    removeUrl: `${deps.config.appOrigin}/passkey-remove/${token}`,
  });
  return { passkey: view(passkey, device?.label ?? null, session, now) };
}

/** The account's passkeys for the Security screen, newest first (1c design, section 7.5). */
export async function listPasskeys(deps: AuthDeps, session: Session): Promise<PasskeyListResponse> {
  const now = deps.now();
  const rows = await deps.repo.listPasskeys(session.userId);
  return { passkeys: rows.map((row) => view(row, row.createdOn, session, now)) };
}

/** Renames one passkey of the session's account; another account's and an unknown one are not told apart. Thirty an hour per account. */
export async function renamePasskey(deps: AuthDeps, session: Session, id: string, input: PasskeyRenameRequest): Promise<{ passkey: PasskeyView }> {
  await enforceLimit(deps.kv, `passkey-rename:${session.userId}`, RENAMES_PER_HOUR, HOUR);
  if (!(await deps.repo.renamePasskey(id, session.userId, input.name))) throw new AuthError("passkey_not_found", 404);
  const row = await deps.repo.findPasskey(id, session.userId);
  if (!row) throw new AuthError("passkey_not_found", 404);
  return { passkey: view(row, row.createdOn, session, deps.now()) };
}

/**
 * Removes one passkey of the session's account, the last one too (email stays the recovery root), records it and tells
 * the owner. Needs level 2 on an account with TOTP (the route checks as well). The sessions the passkey started keep
 * running: the owner removed a credential, nothing more.
 */
export async function removePasskey(deps: AuthDeps, session: Session, id: string): Promise<void> {
  requireFresh(deps, session);
  await enforceLimit(deps.kv, `passkey-remove:${session.userId}`, REMOVALS_PER_HOUR, HOUR);
  const removed = await deps.repo.deletePasskey(id, session.userId);
  if (!removed) throw new AuthError("passkey_not_found", 404);
  await deps.repo.appendEvent({ userId: session.userId, type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: id, via: "settings" } });
  const user = await deps.repo.findUserById(session.userId);
  if (user) await notifyAccount(deps, user.email, "passkey_removed", { name: removed.name, time: mailTime(deps.now()) });
}

/**
 * "This wasn't me" on a passkey of the last 7 days, the ones the Security list offers it on (1c design, section 7.5):
 * the lockdown anchored at the passkey's creation, naming it, recorded with this session's device. Level 1 is enough,
 * on an account with TOTP too: whoever re-enrolled it from a stolen session holds level 2, and the owner may not.
 * Five a day per account, counted only for a call that will run the lockdown: the bucket is the account's, so were a
 * miss to count, any session of the account, a stolen one too, could spend the owner's five with unknown ids and keep
 * its access. A call that does count signs its own session out with every other.
 */
export async function notMine(deps: AuthDeps, session: Session, id: string, ctx: RequestContext): Promise<void> {
  requireFresh(deps, session, 1);
  // The lookup is by the session's account, so a miss tells the caller nothing about anyone else's passkeys.
  const passkey = await deps.repo.findPasskey(id, session.userId);
  // An older passkey, another account's and an unknown one are not told apart.
  if (!passkey || !isNew(passkey.createdAt, deps.now())) throw new AuthError("passkey_not_found", 404);
  await enforceLimit(deps.kv, `passkey-not-mine:${session.userId}`, NOT_MINE_PER_DAY, DAY);
  await lockdown(deps, {
    userId: session.userId,
    anchor: passkey.createdAt,
    passkeyIds: [passkey.id],
    caller: { type: "passkey_removed", deviceId: session.deviceId, metadata: { passkeyId: passkey.id, via: "not_mine" } },
    ctx,
  });
}

/**
 * The remove link from the passkey_added notice, which needs no session: the link is the credential, and works once.
 * The lockdown runs anchored at the passkey's creation and names it, so the link works whether or not the passkey is
 * still there (1c design, section 7.6). It does nothing but refuse when the account is gone or its address is no longer
 * the one the notice went to: a link mailed to an attacker's address dies when the owner's is restored. A refusal does
 * not spend the link. The owner may open it while an attacker's address change stands, and once the email undo has
 * restored the address this link is the one whose lockdown reaches the day before the passkey, which the undo's may not.
 */
export async function removeByLink(deps: AuthDeps, input: PasskeyRemoveLinkRequest, ctx: RequestContext): Promise<void> {
  await enforceLimit(deps.kv, `passkey-remove-link:ip:${ctx.ipHash}`, REMOVE_LINKS_PER_IP_PER_HOUR, HOUR);
  const key = passkeyRemoveKey(input.token);
  // Read first, so that a refusal leaves the link as it was.
  const raw = await deps.kv.get(key);
  if (!raw) throw new AuthError("invalid_code", 400, LINK_GONE);
  const link = JSON.parse(raw) as PasskeyRemoveToken;
  const user = await deps.repo.findUserById(link.userId);
  if (!user) throw new AuthError("invalid_code", 400, LINK_GONE);
  if (link.sentTo !== emailHash(deps.config.authHmacKey, user.email)) throw new AuthError("invalid_code", 400, LINK_GONE);
  // Taken only now, just before it acts: of two requests with the same link, one gets it and the other is refused.
  if (!(await deps.kv.take(key))) throw new AuthError("invalid_code", 400, LINK_GONE);
  await lockdown(deps, {
    userId: user.id,
    anchor: new Date(link.createdAt),
    passkeyIds: [link.passkeyId],
    caller: { type: "passkey_removed", metadata: { passkeyId: link.passkeyId, via: "link" } },
    ctx,
  });
}

/**
 * Records a verified passkey's use (1c design, sections 2, 7.2 and 7.4): the counter, the use time and the current backup
 * state in one conditional update. When it matches no row after a signature has checked, the counter did not move forward,
 * or a concurrent use took the same step: the passkey is marked suspect, the regression recorded, the owner told best
 * effort, and the attempt refused. A passkey already suspect is caught by the caller before this runs, so this only ever
 * suspends a fresh regression.
 */
async function recordPasskeyUse(deps: AuthDeps, passkey: Pick<PasskeyRow, "id" | "userId" | "name">, email: string, verified: VerifiedAuthentication, now: Date): Promise<void> {
  if (await deps.repo.claimPasskeyUse(passkey.id, verified.newCounter, verified.backedUp, now)) return;
  await deps.repo.suspectPasskey(passkey.id, now);
  await deps.repo.appendEvent({ userId: passkey.userId, type: "passkey_counter_regression", metadata: { passkeyId: passkey.id } });
  await notifyAccount(deps, email, "passkey_suspect", { name: passkey.name });
  throw new AuthError("passkey_invalid", 401);
}

/** The factor a verified assertion proves: two factors only when the authenticator verified the user and the passkey was registered with UV. */
function passkeyFactor(verified: VerifiedAuthentication, passkey: Pick<PasskeyRow, "uvInitialized">): FactorKind {
  return verified.userVerified && passkey.uvInitialized ? "passkey_uv" : "passkey";
}

/**
 * Options for a passkey sign-in (1c design, section 7.4): an empty allow list, so the options name no account and the
 * browser offers every passkey it holds for the relying party, and a sign-in challenge with no session binding. Handing
 * them out stores nothing beyond the per-IP counter, so it cannot fill the key-value store. Thirty per IP per 15 minutes.
 */
export async function signInOptions(deps: AuthDeps, ctx: RequestContext): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  await enforceLimit(deps.kv, `passkey-signin-options:ip:${ctx.ipHash}`, SIGNIN_OPTIONS_PER_IP, SIGNIN_WINDOW_MS);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "signin", deps.now());
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow: [], challenge });
  return { options };
}

/**
 * Verifies a passkey sign-in (1c design, section 7.4). The challenge is read from the response, checked with no session
 * binding and spent before anything else runs, so a forged, foreign or spent one never reaches the library. The passkey is
 * found by its credential id and its account read: an unknown credential, and a deleted or purged account, are alike
 * passkey_invalid, as is a response without a user handle, or with one that is not this account's: the options named no
 * account, so the response has to (WebAuthn L3, section 7.2, step 6). Only after the signature checks is
 * a suspect passkey passkey_suspended, and only then does the counter write run (a counter that did not move forward
 * suspends the passkey and refuses); the factor is passkey_uv only when the authenticator verified the user and the passkey
 * was registered with UV. A sign-in from a device the account has not used is counted, and only after a verified signature,
 * so nobody but the passkey's holder can spend the new-device allowance. Then, on an account with TOTP, a one-factor
 * passkey (and every staff sign-in) goes to the TOTP step with an MFA ticket; otherwise a session is issued directly, with
 * the new-device alert whose not-me link names the passkey. There is no account lockout.
 */
export async function signInVerify(deps: AuthDeps, input: PasskeySignInVerifyRequest, ctx: RequestContext): Promise<SignedIn | MfaPending> {
  await enforceLimit(deps.kv, `passkey-signin:ip:${ctx.ipHash}`, SIGNIN_VERIFY_PER_IP, SIGNIN_WINDOW_MS);
  const now = deps.now();
  const challenge = readResponseChallenge(input.response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "signin", now);
  await spendChallenge(deps.kv, challenge, now);

  const passkey = await deps.repo.findPasskeyByCredentialId(input.response.id);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const user = await deps.repo.findUserById(passkey.userId);
  // A deleted or purged account's row is gone from findUserById: its passkey signs nobody in.
  if (!user) throw new AuthError("passkey_invalid", 401);
  // The allow list was empty, so nothing named an account before the ceremony: the response must carry the account's user
  // handle, which every passkey korbat registers returns (they are discoverable). Without one, or on an account that has
  // none, or with another's, the answer is the one every failure before the signature gets. The field stays optional in
  // the contract, which re-authentication shares: there the session names the account and the handle may be absent.
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || user.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(user.webauthnUserId)) {
    throw new AuthError("passkey_invalid", 401);
  }

  const verified = await verifyAuthentication({
    response: input.response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  // After the signature only: an unsigned response can never switch a passkey off or tell one from another.
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);

  const factor = passkeyFactor(verified, passkey);
  const device: DeviceInput = { deviceId: input.deviceId, platform: input.platform };
  if (!(await deps.repo.findDevice(user.id, deviceHash(deps.config.authHmacKey, device.deviceId)))) {
    await enforceLimit(deps.kv, `passkey-signin-new-device:hour:${user.id}`, SIGNIN_NEW_DEVICE_PER_HOUR, HOUR);
    await enforceLimit(deps.kv, `passkey-signin-new-device:day:${user.id}`, SIGNIN_NEW_DEVICE_PER_DAY, DAY);
  }

  const proof = { factors: { [factor]: now.getTime() }, method: "passkey" as const, passkeyId: passkey.id };
  // On an account with TOTP, a one-factor passkey still needs the second factor, and staff always do (1c design, section 2).
  if (user.totpEnabledAt && (factor === "passkey" || user.role !== "user")) {
    const mfaTicket = randomToken();
    const ticket: MfaTicket = { userId: user.id, deviceId: device.deviceId, platform: device.platform, ...proof };
    await deps.kv.set(mfaTicketKey(mfaTicket), JSON.stringify(ticket), MFA_TICKET_TTL_MS);
    return { kind: "mfa", mfaTicket };
  }
  return signIn(deps, user, device, ctx, { alertNewDevice: true, ...proof });
}

/**
 * Options for re-authenticating with a passkey (1c design, section 7.2): the account's passkeys that are not suspect in the
 * allow list, so the browser offers only ones that still work, and a re-authentication challenge bound to this session's
 * handle, which no other session of the account can answer.
 */
export async function reauthOptions(deps: AuthDeps, session: Session): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const held = await deps.repo.listPasskeys(session.userId);
  const allow = held.filter((p) => p.suspectAt === null).map((p) => ({ id: p.credentialId, transports: p.transports }));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "reauth", deps.now(), session.handle);
  const options = await authenticationOptions({ rpId: deps.config.webauthn.rpId, allow, challenge });
  return { options };
}

/**
 * The passkey method of the re-authentication flow (1c design, section 7.2), run from flows/reauth.ts so the buckets,
 * reauth_at, the rotation and the answer stay that flow's. The challenge is read from the response, checked against this
 * session's handle and spent first; the passkey is looked up with the session's user, so another account's and an unknown
 * one are alike passkey_invalid and neither touches a passkey's counter; after the signature checks, a suspect passkey is
 * passkey_suspended, and the counter write applies. Answers the factor proven, passkey_uv or passkey.
 */
export async function reauthenticatePasskey(deps: AuthDeps, session: Session, user: UserRow, response: AuthenticationResponseJSON, now: Date): Promise<FactorKind> {
  const challenge = readResponseChallenge(response);
  readChallenge(challengeKey(deps.config.authHmacKey), challenge, "reauth", now, session.handle);
  await spendChallenge(deps.kv, challenge, now);
  const passkey = await deps.repo.findPasskeyByCredential(response.id, session.userId);
  if (!passkey) throw new AuthError("passkey_invalid", 401);
  const verified = await verifyAuthentication({
    response,
    expectedChallenge: challenge,
    origins: deps.config.webauthn.origins,
    rpId: deps.config.webauthn.rpId,
    credential: { id: passkey.credentialId, publicKey: passkey.publicKey, transports: passkey.transports },
  });
  if (passkey.suspectAt !== null) throw new AuthError("passkey_suspended", 403);
  await recordPasskeyUse(deps, passkey, user.email, verified, now);
  return passkeyFactor(verified, passkey);
}
