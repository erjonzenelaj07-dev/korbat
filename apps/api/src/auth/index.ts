/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type {
  DeleteConfirmRequest,
  DeleteStartResponse,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInVerifyRequest,
  StaffStepUpAction,
  StaffStepUpOptionsRequest,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Context, MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion, takeDownTerminated } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import {
  accountReportMailStopped,
  confirmNotifier,
  findNotifierContacts,
  forgetNotifierAfter,
  mailAccount,
  mailNotifier,
  mailNotifierUpdates,
  mailStaff,
  notifierFacts,
  notifierMailTokenMatches,
  notifierName,
  overdueContacts,
  resumeAccountReportMail,
  stopNotifier,
  storeNotifierContact,
  type AccountMailResult,
  type AccountMessage,
  type NotifierFacts,
  type NotifierMailResult,
  type NotifierMessage,
  type NotifierUpdatePart,
  type NotifierUpdateResult,
  type StaffMessage,
} from "./flows/notifiers";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { me } from "./flows/account";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import type { PublicKeyCredentialRequestOptionsJSON } from "./passkeys/webauthn";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { requireStaff } from "./staff/middleware";
import { listStaffKeys, listStaffSessions, signOutStaff, staffMe, type ActiveStaffSession } from "./staff/sessions";
import { signInOptions, signInVerify, type StaffSignedIn } from "./staff/signin";
import { requireStaffStepUp, revokeStaffSession, stepUpOptions, type StaffStepUpConfirmed } from "./staff/step-up";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type {
  AccountMailResult,
  AccountMessage,
  AccountUpdateMessage,
  DecisionMessage,
  NoticeReceivedMessage,
  NotifierFacts,
  NotifierMailResult,
  NotifierMessage,
  NotifierUpdatePart,
  NotifierUpdateResult,
  StaffAlertKind,
  StaffAlertMessage,
  StaffMessage,
} from "./flows/notifiers";
/** One line of the daily update, which the moderation module composes and this module mails: the mailer's own type. */
export type { NoticeUpdateLine } from "../mail/mailer";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffStepUpConfirmed } from "./staff/step-up";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, handleRefusal, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole, type RoleGranted } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
/**
 * The staff module's sign-in and sign-out routes set and clear the staff cookies (3a design, section 5); their names and
 * attributes stay this module's, and requireStaff is their only reader.
 */
export { clearStaffCookies, setStaffCookies } from "./staff/cookies";
/** `staff.js revoke`, from the server's command line only, as grant-role's grantRole is. */
export { revokeStaffKeys } from "./staff/revoke";

/**
 * `staff.js access-request <email>`, from the server's command line only (3c design, section 7.13): the notifier contacts
 * that gave this address, each with the name it gave, read on the auth pool with the keys of the API's configuration.
 * Only this module can find a contact by its address or open its name; the caller gets ids and names, never an address.
 */
export function notifierContactsFor(authDb: Db, config: Config, email: string): Promise<{ id: string; name: string | null }[]> {
  return findNotifierContacts({ repo: createAuthRepo(authDb), config: authConfigFrom(config) }, email);
}
/**
 * audit-verify's check of a step-up assertion an audit row stored, against the public key, origin and relying party ID
 * recorded on its key (3a design, section 7, Command line): the WebAuthn library stays behind the wrapper, and the check
 * needs no server secret.
 */
export { verifyRecordedAssertion, type RecordedAssertion } from "./passkeys/webauthn";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /**
   * Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a
   * no-op when it already is. 3f: `held` while the account's address is held for a report (the credentials are gone).
   */
  finishPurge(userId: string): Promise<"purged" | "held" | "none">;
  /**
   * 3e (design, sections 5 and 7.8): the take-down of an account whose termination is final, as the system: the account
   * marked deleted and every session revoked in one transaction, then termination_final to the address read before it,
   * after that commit and best effort. True only for the take-down it made; false, with nothing written or sent, for an
   * account already marked deleted.
   */
  takeDownTerminated(userId: string, facts: { decidedAt: Date; imagesSealed: boolean }): Promise<boolean>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * What the staff module needs from this one (3a design, section 5): the credential side of the staff routes, which the
 * staff module mounts behind its gate. Staff keys, staff sessions and enrolments are credentials, so their flows and
 * tables stay here, and the staff module reaches them only through this interface.
 */
export interface AuthForStaff {
  /** Registration options for the key an enrolment link's holder is about to create. */
  enrollOptions(input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions>;
  /** Checks the browser's answer and stores the staff key, spending the link; the owner is mailed. */
  enrollVerify(input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse>;
  /** Discoverable-credential options for a staff sign-in. */
  signInOptions(): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /** Checks a staff key's assertion and opens a staff session; the route sets its cookies with setStaffCookies. */
  signInVerify(input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn>;
  /** Stands before every staff route that needs a session: reads it and sets `staffSession` on the context. */
  requireStaff: MiddlewareHandler<AppEnv>;
  /** The session's account and both its ends, with the seconds left. */
  me(session: ActiveStaffSession): Promise<StaffMe>;
  /** The person's own live staff sessions. */
  sessions(session: ActiveStaffSession): Promise<StaffSessionsResponse>;
  /** The person's own live staff keys. */
  keys(session: ActiveStaffSession): Promise<StaffKeysResponse>;
  /** Ends the session, on the record; the route clears its cookies with clearStaffCookies. */
  signOut(session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void>;
  /** Options for confirming one action with the session's key: a challenge bound to the session and to exactly that action. */
  stepUpOptions(session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /**
   * Stands before every staff route that changes something, behind requireStaff: verifies the body's `stepUp` against the
   * action, the target `target` reads from the request and the body's params, and sets `staffStepUp` on the context.
   */
  requireStaffStepUp(action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined): MiddlewareHandler<AppEnv>;
  /** Revokes one of the person's own live staff sessions, on the record with its confirmation; false when the handle names none. */
  revokeSession(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean>;
}

/**
 * What the moderation module needs from this one (3c design, section 5): the human check of a signed-out notice, a
 * signed-out notifier's contact, which is stored here, encrypted, out of the API role's reach, and every mail to an
 * account, a notifier or staff. The moderation module names a contact by the id it chose and an account by its id; it
 * never sees an address or a mail token, and a message is a typed union over the templates, so no caller passes free
 * text. `mailNotifier` and `mailAccount` answer "refused" when the relay refused the recipient for good and throw
 * MailUnavailable for any other failure, so the caller records the one and tries the other again.
 */
export interface AuthForModeration {
  /** Turnstile's answer for the token of a signed-out notice; every failure is false. */
  verifyHuman(token: string): Promise<boolean>;
  /** Stores a signed-out notifier's name and address under the id the notice carries, with a fresh mail token when an address is given. */
  storeNotifierContact(contactId: string, contact: { name?: string; email?: string }): Promise<void>;
  /**
   * Sends a signed-out notifier's receipt, with its page link. "suppressed" for a stopped address, "folded" for a
   * second receipt in 24 hours to an address that is not confirmed, "no_address" for a contact without one, "forgotten"
   * for an id no contact has (it was never stored, or the janitor has deleted it).
   */
  mailNotifier(contactId: string, message: NotifierMessage): Promise<NotifierMailResult>;
  /**
   * Sends a mail to an account's own address, with neither the cap nor a confirmation: the receipt and the daily update
   * of its reports, which a stop of that address holds back ("suppressed"), and the statement of a decision about it,
   * which nothing holds back. "no_address" for a deleted account.
   */
  mailAccount(userId: string, message: AccountMessage): Promise<AccountMailResult>;
  /**
   * The daily update to signed-out notifiers: one notice_update for each address the parts' contacts gave, with every
   * part's lines, every carried receipt and the page link of each other notice. It applies a stop of the address and
   * neither the confirmation nor the cap, answers for each contact, and throws for none: "unavailable" when the relay
   * could not take that address's mail or the contact could not be read.
   */
  mailNotifierUpdates(parts: readonly NotifierUpdatePart[]): Promise<Map<string, NotifierUpdateResult>>;
  /** Sends a staff alert to every live staff account, best effort; answers how many addresses the relay took, and never throws for a failed send. */
  mailStaff(message: StaffMessage): Promise<number>;
  /** For each id, whether a contact has it, whether a name and an address were given, and whether the address is confirmed or stopped. */
  notifierFacts(contactIds: readonly string[]): Promise<Map<string, NotifierFacts>>;
  /** The name a notifier gave, or null: for a confirmed reveal only. */
  notifierName(contactId: string): Promise<string | null>;
  /** Whether the token is the contact's mail token, compared in constant time; false when it has none. */
  notifierMailTokenMatches(contactId: string, token: string): Promise<boolean>;
  /** With the contact's mail token: the address is confirmed for 30 days and any stop of it lifted. False for any other token. */
  confirmNotifier(contactId: string, token: string): Promise<boolean>;
  /** With the contact's mail token: no more report mails to the address. False for any other token. */
  stopNotifier(contactId: string, token: string): Promise<boolean>;
  /** Whether the account's own address said stop. */
  accountReportMailStopped(userId: string): Promise<boolean>;
  /** Lifts a stop of the account's own address; true when there was one. */
  resumeAccountReportMail(userId: string): Promise<boolean>;
  /** Sets the day each of these contacts is forgotten. */
  forgetNotifierAfter(contactIds: readonly string[], at: Date): Promise<void>;
  /** Command line only: the contacts that gave an address, with the names they gave, for an access request. */
  findNotifierContacts(email: string): Promise<{ id: string; name: string | null }[]>;
  /** How many contacts and confirmations should have been removed more than a day ago: a count only. */
  overdueContacts(): Promise<number>;
}

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    takeDownTerminated: (userId, facts) => takeDownTerminated(deps, userId, facts),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  const staffGuard = requireStaff(deps);
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
    signInOptions: () => signInOptions(deps),
    signInVerify: (input, ctx) => signInVerify(deps, input, ctx),
    requireStaff: staffGuard,
    me: (session) => staffMe(deps, session),
    sessions: (session) => listStaffSessions(deps, session),
    keys: (session) => listStaffKeys(deps, session),
    signOut: (session, ctx) => signOutStaff(deps, session, ctx),
    stepUpOptions: (session, request) => stepUpOptions(deps, session, request),
    requireStaffStepUp: (action, target) => requireStaffStepUp(deps, action, target),
    revokeSession: (session, confirmed, ctx) => revokeStaffSession(deps, session, confirmed, ctx),
  };
  const forModeration: AuthForModeration = {
    verifyHuman: (token) => deps.turnstile.verify(token),
    storeNotifierContact: (contactId, contact) => storeNotifierContact(deps, contactId, contact),
    mailNotifier: (contactId, message) => mailNotifier(deps, contactId, message),
    mailAccount: (userId, message) => mailAccount(deps, userId, message),
    mailNotifierUpdates: (parts) => mailNotifierUpdates(deps, parts),
    mailStaff: (message) => mailStaff(deps, message),
    notifierFacts: (contactIds) => notifierFacts(deps, contactIds),
    notifierName: (contactId) => notifierName(deps, contactId),
    notifierMailTokenMatches: (contactId, token) => notifierMailTokenMatches(deps, contactId, token),
    confirmNotifier: (contactId, token) => confirmNotifier(deps, contactId, token),
    stopNotifier: (contactId, token) => stopNotifier(deps, contactId, token),
    accountReportMailStopped: (userId) => accountReportMailStopped(deps, userId),
    resumeAccountReportMail: (userId) => resumeAccountReportMail(deps, userId),
    forgetNotifierAfter: (contactIds, at) => forgetNotifierAfter(deps, contactIds, at),
    findNotifierContacts: (email) => findNotifierContacts(deps, email),
    overdueContacts: () => overdueContacts(deps),
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    /** 3e (design, section 7.12): /api/me's answer without the standing, which the app adds from the moderation module. */
    meFor: (session: Session) => me(deps, session),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** The interface the moderation module uses. */
    forModeration,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it, and its network with it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    /** A staff session from the staff cookie, read from the database at every request (3a design, section 7). */
    requireStaff: staffGuard,
    /** A fresh confirmation by the staff session's key, bound to the action a route is about to execute (3a design, section 7). */
    requireStaffStepUp: forStaff.requireStaffStepUp,
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events, forgotten notifier contacts and their confirmations) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
