import type { Platform, Role, SessionInfo } from "@korbat/contracts";
import { AuthError } from "./context";
import { newSessionToken, sha256Hex } from "./crypto";
import type { KeyValueStore } from "./kv";
import type { ActiveSessionRow, AuthRepo } from "./repo";

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CACHE_TTL_MS = 60 * 1000;
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

/**
 * What a session can have proven (1c design, section 2): a first factor at sign-in (an email code, a password, a passkey,
 * or a passkey whose authenticator verified the user), and the second factors the MFA step or a re-authentication adds.
 */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";
/** The factors a session has proven, kind to epoch milliseconds from the flows' clock. */
export type Factors = Partial<Record<FactorKind, number>>;

/** Every kind in one fixed order, so the factors a refusal lists do not depend on how the row stored them. */
const KINDS: readonly FactorKind[] = ["email", "password", "passkey", "passkey_uv", "totp", "recovery"];
/** A first factor on its own is level 1. */
const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
/** A second factor makes level 2 only beside a first one; a user-verified passkey is both at once. */
const SECOND: readonly FactorKind[] = ["totp", "recovery"];

export interface Session {
  /** sha256 of the token; never the token itself. A rotation changes it; `handle` stays. */
  sessionId: string;
  userId: string;
  deviceId: string;
  role: Role;
  onboarded: boolean;
  mfaEnabled: boolean;
  /** The latest of `factors`, as the row keeps it; freshness is read from the factors themselves. */
  reauthAt: Date;
  /** A random id for the session's whole life: the re-authentication limits and the passkey challenges are keyed by it. */
  handle: string;
  factors: Factors;
  /** The passkey that started the session, for the lockdown and the Security list; null after any other sign-in. */
  passkeyId: string | null;
}

/** What a sign-in proved, for the session it issues: its factors and, for a passkey sign-in, the passkey. */
export interface SessionProof {
  factors: Factors;
  passkeyId?: string | null;
}

/**
 * What a reauth_required refusal tells the app: the level the action needs and the factor kinds proven within the
 * window. A type alias, not an interface, so it passes as an AuthError's details as it is.
 */
export type ReauthNeeded = {
  level: 1 | 2;
  have: FactorKind[];
};

export interface IssuedSession {
  token: string;
  session: Session;
  /** Cookie Max-Age matching the idle expiry. */
  maxAgeSeconds: number;
}

interface CachedSession {
  session: Omit<Session, "reauthAt"> & { reauthAt: string };
  absoluteExpiresAt: string;
}

export function createSessions(deps: { repo: AuthRepo; kv: KeyValueStore; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const cacheKey = (sessionId: string) => `sess:${sessionId}`;
  const REVOKED = "revoked";

  const fromRow = (row: ActiveSessionRow): Session => ({
    sessionId: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    role: row.role,
    onboarded: row.onboardedAt !== null,
    mfaEnabled: row.totpEnabledAt !== null,
    reauthAt: row.reauthAt,
    handle: row.handle,
    factors: row.factors as Factors,
    passkeyId: row.passkeyId,
  });

  async function forget(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.del(cacheKey(id))));
  }

  /**
   * A tombstone that outlives any cache fill in flight, so a revoked session cannot come back for the cache TTL.
   * Also for sessions revoked in the database by another statement, such as a deletion's take-down.
   */
  async function tombstone(sessionIds: readonly string[]) {
    await Promise.all(sessionIds.map((id) => deps.kv.set(cacheKey(id), REVOKED, SESSION_CACHE_TTL_MS)));
  }

  /** Drops the cached copy of every live session of the user, after a change to what a session carries. */
  async function forgetUser(userId: string) {
    const rows = await deps.repo.listActiveSessions(userId, now());
    await forget(rows.map((r) => r.id));
  }

  /** A new session holding what its sign-in proved; its reauth time is the latest of those factors. */
  async function issue(userId: string, deviceId: string, proof: SessionProof): Promise<IssuedSession> {
    const t = now();
    const { token, id } = newSessionToken();
    await deps.repo.createSession({
      id,
      userId,
      deviceId,
      now: t,
      expiresAt: new Date(t.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t.getTime() + SESSION_ABSOLUTE_MS),
      factors: proof.factors,
      passkeyId: proof.passkeyId ?? null,
    });
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) throw new Error("session not found immediately after it was created");
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /**
   * Resolves a token to a live session. Results are cached for 60 seconds; revocation writes a
   * tombstone over the entry and a fill never overwrites one, so it takes effect at once. `slid` is
   * true when the idle expiry was just extended
   * (callers refresh the cookie then).
   */
  async function resolve(token: string): Promise<{ session: Session; slid: boolean } | null> {
    const id = sha256Hex(token);
    const t = now();
    const cached = await deps.kv.get(cacheKey(id));
    if (cached === REVOKED) return null;
    if (cached) {
      const c = JSON.parse(cached) as CachedSession;
      if (new Date(c.absoluteExpiresAt).getTime() > t.getTime()) {
        return { session: { ...c.session, reauthAt: new Date(c.session.reauthAt) }, slid: false };
      }
    }
    const row = await deps.repo.findActiveSession(id, t);
    if (!row) return null;
    let slid = false;
    if (t.getTime() - row.lastUsedAt.getTime() >= SESSION_SLIDE_INTERVAL_MS) {
      const expiresAt = new Date(Math.min(t.getTime() + SESSION_IDLE_MS, row.absoluteExpiresAt.getTime()));
      await deps.repo.slideSession(id, expiresAt, t);
      slid = true;
    }
    const session = fromRow(row);
    const entry: CachedSession = {
      session: { ...session, reauthAt: session.reauthAt.toISOString() },
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
    await deps.kv.setIfAbsent(cacheKey(id), JSON.stringify(entry), SESSION_CACHE_TTL_MS);
    return { session, slid };
  }

  async function revoke(sessionId: string, userId: string): Promise<boolean> {
    const revoked = await deps.repo.revokeSession(sessionId, userId, now());
    if (revoked) await tombstone([sessionId]);
    return revoked;
  }

  async function revokeAll(userId: string): Promise<number> {
    const ids = await deps.repo.revokeAllSessions(userId, now());
    await tombstone(ids);
    return ids.length;
  }

  /**
   * Replaces the token in place (1c design, section 2): only the row's id, the token's hash, changes; its handle,
   * factors, reauth time, passkey, device and expiries stay. The old token stops working at once, so a re-authentication
   * by the owner ends a thief's copy. A session revoked meanwhile gets no replacement.
   */
  async function rotate(current: Session): Promise<IssuedSession> {
    const { token, id } = newSessionToken();
    if (!(await deps.repo.rotateSession(current.sessionId, id))) throw new AuthError("invalid_credentials", 401);
    // The old id may sit in the cache for up to a minute; the tombstone ends the old token now.
    await tombstone([current.sessionId]);
    const row = await deps.repo.findActiveSession(id, now());
    if (!row) throw new AuthError("invalid_credentials", 401);
    return { token, session: fromRow(row), maxAgeSeconds: Math.floor(SESSION_IDLE_MS / 1000) };
  }

  /** Records a factor the session just proved, at the flows' clock; the reauth time follows it and the cached copy goes. */
  async function addFactor(sessionId: string, kind: FactorKind): Promise<void> {
    await deps.repo.writeFactor(sessionId, kind, now());
    await forget([sessionId]);
  }

  /** The kinds proven within the window (five minutes by default), in a fixed order; freshness and the level are read from them. */
  function recentFactors(session: Session, windowMs: number = REAUTH_WINDOW_MS): FactorKind[] {
    const t = now().getTime();
    return KINDS.filter((kind) => {
      const at = session.factors[kind];
      return at !== undefined && t - at <= windowMs;
    });
  }

  function isFresh(session: Session, windowMs: number = REAUTH_WINDOW_MS): boolean {
    return recentFactors(session, windowMs).length > 0;
  }

  /** Level 2 when a user-verified passkey, or a second factor beside a first, was proven within the window; level 1 otherwise. */
  function level(session: Session, windowMs: number = REAUTH_WINDOW_MS): 1 | 2 {
    const have = recentFactors(session, windowMs);
    const strong = have.includes("passkey_uv") || (have.some((kind) => SECOND.includes(kind)) && have.some((kind) => FIRST.includes(kind)));
    return strong ? 2 : 1;
  }

  /** The level a sensitive action needs on this account: 2 once it has TOTP, 1 otherwise (1c design, section 2). */
  function requiredLevel(session: Session): 1 | 2 {
    return session.mfaEnabled ? 2 : 1;
  }

  /** Null when the session proved enough within the window; otherwise what the refusal tells the app. */
  function reauthNeeded(session: Session, need: 1 | 2, windowMs: number = REAUTH_WINDOW_MS): ReauthNeeded | null {
    const have = recentFactors(session, windowMs);
    const met = need === 1 ? have.length > 0 : level(session, windowMs) === 2;
    return met ? null : { level: need, have };
  }

  async function list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await deps.repo.listActiveSessions(userId, now());
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel ?? "Unknown device",
      platform: r.platform as Platform,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      current: r.id === currentSessionId,
    }));
  }

  return { issue, resolve, revoke, revokeAll, rotate, addFactor, forgetUser, recentFactors, isFresh, level, requiredLevel, reauthNeeded, list, tombstone };
}

export type Sessions = ReturnType<typeof createSessions>;
