import type { StaffKeysResponse, StaffMe, StaffRole, StaffSessionsResponse } from "@korbat/contracts";
import type { AuthDeps, StaffRequestContext } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { HOUR, MINUTE } from "../limits";
import type { StaffSessionRow } from "../repo";

/**
 * The staff session store (3a design, sections 2 and 7). Staff sessions live in auth.staff_sessions, apart from the app's
 * sessions, and are read from the database on every request: nothing here caches them, so nothing needs a tombstone, and a
 * revocation, a demotion, a deletion or a suspect key ends a session at its next request. A session lasts 12 hours at most
 * and ends 15 minutes after its person's last action in the console, never after a request the page sent by itself.
 */

/** The idle limit, counted from the last request a person's action started (X-Staff-Activity: 1). */
export const STAFF_IDLE_MS = 15 * MINUTE;
/** The absolute limit, which nothing moves; the database also keeps a row within 12 hours of its creation. */
export const STAFF_ABSOLUTE_MS = 12 * HOUR;

/** A live staff session as requireStaff hands it to the staff routes. Its token is never kept; `sessionId` is its sha256. */
export interface ActiveStaffSession {
  sessionId: string;
  /** The session's random id for life: the console lists and revokes sessions by it, and the audit rows name it. */
  handle: string;
  userId: string;
  /** The staff key that opened the session. */
  keyId: string;
  role: StaffRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  /** The coarse label deviceLabel gave the browser that signed in. */
  browser: string;
}

// The read answers only an account whose role is not user, so the role is a staff role.
const fromRow = (row: StaffSessionRow): ActiveStaffSession => ({
  sessionId: row.id,
  handle: row.handle,
  userId: row.userId,
  keyId: row.keyId,
  role: row.role as StaffRole,
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  idleExpiresAt: row.idleExpiresAt,
  absoluteExpiresAt: row.absoluteExpiresAt,
  browser: row.browser,
});

/** What a sign-in that verified hands the session: the key that signed, its account's role and the counter it reported. */
export interface StaffSessionOpening {
  userId: string;
  keyId: string;
  role: StaffRole;
  newCounter: number;
  browser: string;
}

/**
 * Opens a staff session for a verified sign-in: a new opaque token, whose sha256 alone is stored, 15 minutes idle and
 * 12 hours absolute from the flows' clock. The key's counter rule, the session, its event and its audit row are one
 * transaction (repo.openStaffSession). Null when the key's counter did not move forward or the key was revoked
 * meanwhile, which the sign-in tells apart.
 */
export async function openStaffSession(deps: AuthDeps, opening: StaffSessionOpening, ctx: StaffRequestContext): Promise<{ token: string; session: ActiveStaffSession } | null> {
  const now = deps.now();
  const token = randomToken(32);
  const id = sha256Hex(token);
  const idleExpiresAt = new Date(now.getTime() + STAFF_IDLE_MS);
  const absoluteExpiresAt = new Date(now.getTime() + STAFF_ABSOLUTE_MS);
  const opened = await deps.repo.openStaffSession({
    id,
    userId: opening.userId,
    keyId: opening.keyId,
    newCounter: opening.newCounter,
    now,
    idleExpiresAt,
    absoluteExpiresAt,
    browser: opening.browser,
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
  });
  if (!opened) return null;
  const session: ActiveStaffSession = {
    sessionId: id,
    handle: opened.handle,
    userId: opening.userId,
    keyId: opening.keyId,
    role: opening.role,
    createdAt: now,
    lastUsedAt: now,
    idleExpiresAt,
    absoluteExpiresAt,
    browser: opening.browser,
  };
  return { token, session };
}

/**
 * The live session a staff cookie's token names, or null. `activity` is true for a request its person's action started:
 * only then does the same statement that reads the session move its last use to now and its idle end to 15 minutes from
 * now, never past its absolute end.
 */
export async function resolveStaffSession(deps: AuthDeps, token: string, activity: boolean): Promise<ActiveStaffSession | null> {
  const now = deps.now();
  const row = await deps.repo.resolveStaffSession(sha256Hex(token), now, activity ? new Date(now.getTime() + STAFF_IDLE_MS) : null);
  return row ? fromRow(row) : null;
}

/** Whole seconds until `at` by the flows' clock, never below zero, so the console's idle timer needs no clock of its own. */
function secondsUntil(deps: AuthDeps, at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - deps.now().getTime()) / 1000));
}

/**
 * GET /api/staff/me, and the sign-in's answer: the account's public handle (the console names staff by it), its role, the
 * session's handle (step-up challenges bind to it) and both ends with the seconds left. The handle comes from the profile
 * store, which the API supplies; a staff account always has one, since enrolment needs it, so a missing profile reads as
 * an empty handle rather than an error that would lock its person out.
 */
export async function staffMe(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffMe> {
  const profile = await deps.profiles.find(session.userId);
  return {
    handle: profile?.handle ?? "",
    role: session.role,
    sessionHandle: session.handle,
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    idleSecondsLeft: secondsUntil(deps, session.idleExpiresAt),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    absoluteSecondsLeft: secondsUntil(deps, session.absoluteExpiresAt),
  };
}

/** GET /api/staff/sessions: the person's own live staff sessions, the asking one marked; never another account's. */
export async function listStaffSessions(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffSessionsResponse> {
  const rows = await deps.repo.listStaffSessions(session.userId, deps.now());
  return {
    sessions: rows.map((row) => ({
      handle: row.handle,
      browser: row.browser,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: row.handle === session.handle,
    })),
  };
}

/** GET /api/staff/keys: the person's own live staff keys, by name and dates only. */
export async function listStaffKeys(deps: AuthDeps, session: ActiveStaffSession): Promise<StaffKeysResponse> {
  const rows = await deps.repo.listStaffKeyViews(session.userId);
  return { keys: rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null })) };
}

/**
 * POST /api/staff/signout: ends this session with its staff_signed_out event and audit row, in one transaction. No mail:
 * the person did it themselves. A session another request ended first is gone all the same, so that is no error.
 */
export async function signOutStaff(deps: AuthDeps, session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void> {
  await deps.repo.endStaffSession({ id: session.sessionId, userId: session.userId, keyId: session.keyId, now: deps.now(), ipHash: ctx.ipHash, requestId: ctx.requestId });
}
