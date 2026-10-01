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
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
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
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffStepUpConfirmed } from "./staff/step-up";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole } from "./admin";
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
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
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
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
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
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
