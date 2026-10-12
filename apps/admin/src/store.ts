import type { StaffMe } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import type { CaseDraft } from "./compose";
import { createIdleTimer, type Clock, type IdleWarning } from "./idle";
import { messageFor } from "./messages";
import { caseHref, parseRoute, type CaseId, type ConsolePath, type Route } from "./router";

/**
 * The console's state across its screens (3a design, section 9): the address, the session the page holds, and the idle
 * timer's warning. Screens read it through React's useSyncExternalStore and keep their own lists to themselves.
 *
 * Any staff_session_required answer, from any request, the idle timer's reads included, means the API has already
 * cleared both staff cookies: the page then shows sign-in in place, keeping the address, and after the sign-in it shows
 * that address's page again. A GET /api/staff/me that answers 404 means the console is off on this server or was opened
 * at an address other than CONSOLE_ORIGIN (the staff gate answers both the same), and the page says only that.
 */
export type Session =
  | { kind: "checking" }
  | { kind: "signed-in"; me: StaffMe }
  /** Sign-in shows; `ended` when a staff_session_required answer told of a session that ended, which the page says. */
  | { kind: "signed-out"; ended: boolean }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

export interface ConsoleState {
  path: string;
  route: Route;
  session: Session;
  warning: IdleWarning | null;
}

/** The part of window.history the store writes. */
export interface HistoryLike {
  pushState(data: unknown, unused: string, url: string): void;
  replaceState(data: unknown, unused: string, url: string): void;
}

export interface ConsoleStoreDeps {
  api: StaffApi;
  history: HistoryLike;
  clock: Clock;
  /** The address the page opened at. */
  path: string;
}

/**
 * The composer's draft slots, one for each case (3c design, section 8): what its person chose and typed and has not
 * confirmed yet. A session that ends shows sign-in in place of the case's page, which then starts anew; the slot is what
 * brings the draft back after a sign-in by the same handle. It lives in the page's memory only, and is dropped when
 * another handle signs in.
 */
export interface DraftSlots {
  get(caseId: CaseId): CaseDraft | null;
  set(draft: CaseDraft): void;
  clear(caseId: CaseId): void;
}

export type ConsoleStore = ReturnType<typeof createConsoleStore>;

export function createConsoleStore(deps: ConsoleStoreDeps) {
  const { api } = deps;
  let state: ConsoleState = { path: deps.path, route: parseRoute(deps.path), session: { kind: "checking" }, warning: null };
  const listeners = new Set<() => void>();

  const set = (next: Partial<ConsoleState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const idle = createIdleTimer({
    clock: deps.clock,
    // The timer's reads carry no mark: they are the page's own, never its person's.
    readMe: () => api.me({ activity: false }),
    onWarning: (warning) => set({ warning }),
    onMe: (me) => {
      if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
    },
  });

  const go = (path: string, how: "push" | "replace") => {
    if (how === "push") deps.history.pushState(null, "", path);
    else deps.history.replaceState(null, "", path);
    set({ path, route: parseRoute(path) });
  };

  const sessionEnded = (carriedStaffCookie: boolean) => {
    // The page says the session ended when it held one, or when the refused request carried the staff CSRF cookie, which
    // only a sign-in sets: a reload or a new tab after an idle-out. Without either, there was no session to end (never
    // signed in, signed out, or the cookie's 12 hours over), and the page shows plain sign-in.
    const ended = state.session.kind === "signed-in" || carriedStaffCookie || (state.session.kind === "signed-out" && state.session.ended);
    idle.stop();
    set({ session: { kind: "signed-out", ended }, warning: null });
  };

  const slots = new Map<CaseId, CaseDraft>();
  /** The handle the slots' drafts were written under. */
  let draftsOf: string | null = null;
  // Keeping a draft changes nothing a screen reads from the state, so no listener is told.
  const drafts: DraftSlots = {
    get: (caseId) => slots.get(caseId) ?? null,
    set: (draft) => void slots.set(draft.caseId, draft),
    clear: (caseId) => void slots.delete(caseId),
  };
  /**
   * Whose page this is now. Another person at this page never reads what the one before typed: the slots are emptied as
   * soon as the handle is another one, at a sign-in here and at any read of /me (a sign-in in another tab changes whose
   * session the page's cookie names).
   */
  const draftsFor = (handle: string) => {
    if (draftsOf !== null && draftsOf !== handle) slots.clear();
    draftsOf = handle;
  };

  api.hooks.onSessionRequired = sessionEnded;
  api.hooks.onActivity = () => {
    if (state.session.kind === "signed-in") idle.restart();
  };
  // Any /me read, a screen's, the step-up's and the idle timer's alike, keeps the page's session as the cookie names it
  // now, and the draft slots with it.
  api.hooks.onMe = (me) => {
    draftsFor(me.handle);
    if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
  };

  const signedIn = (me: StaffMe) => {
    draftsFor(me.handle);
    set({ session: { kind: "signed-in", me }, warning: null });
    idle.start(me);
    // Sign-in in place keeps the address; only the sign-in page and an enrolment link move on, to the home page.
    if (state.route.name === "signin" || state.route.name === "enroll") go("/", "replace");
  };

  const unavailable = () => {
    idle.stop();
    set({ session: { kind: "unavailable" }, warning: null });
  };

  return {
    api,
    drafts,
    get: (): ConsoleState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Opens the page: an enrolment link needs no session and reads none; every other page reads /me, marked, since
     * opening a page is its person's action.
     */
    async start(): Promise<void> {
      if (state.route.name === "enroll") {
        set({ session: { kind: "signed-out", ended: false } });
        return;
      }
      set({ session: { kind: "checking" } });
      try {
        signedIn(await api.me({ activity: true }));
      } catch (err) {
        if (err instanceof ApiError && err.code === "staff_session_required") return; // the hook showed sign-in
        if (err instanceof ApiError && err.status === 404) return unavailable();
        set({ session: { kind: "failed", message: err instanceof ApiError ? err.message : messageFor("internal") } });
      }
    },

    /** A link inside the console: a new history entry, and the page for it. */
    navigate: (path: ConsolePath) => go(path, "push"),

    /** A link to a case: its address is built from a checked id, and from nothing else. */
    openCase: (id: CaseId) => go(caseHref(id), "push"),

    /** The browser went back or forward. Back to the sign-in page with a live session is home. */
    popped(path: string) {
      set({ path, route: parseRoute(path) });
      if (state.session.kind === "signed-in" && state.route.name === "signin") go("/", "replace");
    },

    signedIn,

    /** The person signed out: the timer stops and the sign-in page shows, at its own address. */
    signedOut() {
      idle.stop();
      set({ session: { kind: "signed-out", ended: false }, warning: null });
      go("/signin", "push");
    },

    unavailable,

    /** "Stay signed in": one marked GET /me. Its success restarts the timer through the activity hook. */
    async stay(): Promise<void> {
      try {
        const me = await api.me({ activity: true });
        if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
      } catch {
        // A 401 has shown sign-in; anything else leaves the warning up, and the timer's own read decides.
      }
    },

    dispose() {
      idle.stop();
      listeners.clear();
      slots.clear();
    },
  };
}
