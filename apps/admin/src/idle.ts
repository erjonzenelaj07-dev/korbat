import type { StaffMe } from "@korbat/contracts";
import { ApiError } from "./api";

/**
 * The console's idle timer (3a design, section 9). The server holds the idle limit: a staff session ends 15 minutes
 * after the last request its person's action started (X-Staff-Activity: 1), never past its 12-hour absolute end. The
 * timer only follows that. It restarts at 15 minutes, or at the time left to the absolute end when that is less, whenever
 * a marked request succeeds. Two minutes before it runs out it reads GET /api/staff/me without the mark: more than two
 * minutes left means the person acted in another tab, and the timer is set from the answer; otherwise it warns. When it
 * runs out it reads /me once more and follows the answer, or the 401 shows sign-in. Its reads are the console's only
 * timed requests, and they never move the idle end themselves.
 */

export const IDLE_MS = 15 * 60_000;
export const WARNING_MS = 2 * 60_000;
/** The least wait before reading /me again once the timer ran out, so a session with a second left is not read in a loop. */
const RECHECK_MS = 1000;
/** When a read fails for a reason other than an ended session, the timer tries again this much later. */
const RETRY_MS = 30_000;

/** The warning on screen: the idle end, which "Stay signed in" moves, or the absolute end, which nothing moves. */
export type IdleWarning = { kind: "idle" } | { kind: "absolute"; endsAt: string };

/** A stopwatch and timers: the page's, or a test's that it moves by hand. Only differences between its readings matter. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface IdleTimerDeps {
  clock: Clock;
  /** GET /api/staff/me without the activity mark. A staff_session_required failure means sign-in is already showing. */
  readMe(): Promise<StaffMe>;
  onWarning(warning: IdleWarning | null): void;
  /** Each answer the timer read, so the page shows the session as the server now sees it. */
  onMe(me: StaffMe): void;
}

export interface IdleTimer {
  /** Sets the timer from a session's answer: at sign-in, and when the page opens on a live session. */
  start(me: StaffMe): void;
  /** A marked request succeeded: 15 minutes again, or what is left to the absolute end. Does nothing while stopped. */
  restart(): void;
  /** The session ended or was signed out: no more reads. */
  stop(): void;
}

const sameWarning = (a: IdleWarning | null, b: IdleWarning | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind === "idle" || (b.kind === "absolute" && a.endsAt === b.endsAt)));

export function createIdleTimer(deps: IdleTimerDeps): IdleTimer {
  let running = false;
  // Both ends on the clock's own scale, set from the server's seconds left, never from the browser's time of day.
  let idleEnd = 0;
  let absoluteEnd = 0;
  let absoluteExpiresAt = "";
  let handle: unknown = null;
  // Every new plan bumps it, so a read that answers after a restart or a stop is ignored rather than undoing it.
  let generation = 0;
  let shown: IdleWarning | null = null;

  const show = (warning: IdleWarning | null) => {
    if (sameWarning(shown, warning)) return;
    shown = warning;
    deps.onWarning(warning);
  };

  const clear = () => {
    if (handle !== null) deps.clock.clearTimeout(handle);
    handle = null;
  };

  const schedule = (ms: number, phase: "warn" | "end") => {
    clear();
    const mine = generation;
    handle = deps.clock.setTimeout(() => {
      handle = null;
      void check(phase, mine);
    }, ms);
  };

  const fromMe = (me: StaffMe) => {
    const now = deps.clock.now();
    idleEnd = now + me.idleSecondsLeft * 1000;
    absoluteEnd = now + me.absoluteSecondsLeft * 1000;
    absoluteExpiresAt = me.absoluteExpiresAt;
  };

  /** Warns or not by the time left, and sets the next read: two minutes before the end, or at the end. */
  const plan = () => {
    generation += 1;
    const now = deps.clock.now();
    const warnAt = idleEnd - WARNING_MS;
    if (now < warnAt) {
      show(null);
      schedule(warnAt - now, "warn");
      return;
    }
    // The idle end never lies past the absolute one; when they meet, the absolute end is the one that comes.
    show(idleEnd >= absoluteEnd ? { kind: "absolute", endsAt: absoluteExpiresAt } : { kind: "idle" });
    schedule(Math.max(idleEnd - now, RECHECK_MS), "end");
  };

  const stop = () => {
    running = false;
    generation += 1;
    clear();
    show(null);
  };

  const check = async (phase: "warn" | "end", mine: number) => {
    let me: StaffMe;
    try {
      me = await deps.readMe();
    } catch (err) {
      if (mine !== generation || !running) return;
      // The API cleared the cookies and the page already shows sign-in, at the same path.
      if (err instanceof ApiError && err.code === "staff_session_required") return stop();
      // Unread for another reason (the network, a server error): go on with what the timer knew.
      if (phase === "warn") return plan();
      generation += 1;
      return schedule(RETRY_MS, "end");
    }
    if (mine !== generation || !running) return;
    deps.onMe(me);
    fromMe(me);
    plan();
  };

  return {
    start(me) {
      running = true;
      fromMe(me);
      plan();
    },
    restart() {
      if (!running) return;
      idleEnd = Math.min(deps.clock.now() + IDLE_MS, absoluteEnd);
      plan();
    },
    stop,
  };
}
