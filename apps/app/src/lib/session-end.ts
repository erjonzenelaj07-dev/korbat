import { clearAppearance } from "./appearance";
import { clearFeedCache } from "./feed-cache";
import { clearPlaces } from "./reading-place";

/**
 * The session's end (UI design, section 8.8), apart from SessionProvider (lib/session.tsx), which calls these on every
 * change of its state, so the decision is a pure function the tests call without rendering anything.
 */

/** The session's states, as SessionProvider's state names them. */
export type SessionStatus = "loading" | "signed-out" | "signed-in";

/**
 * Whether the session has ended (UI design, section 8.8): the state moved from signed in to signed out (a sign-out here
 * or everywhere, a lockdown page, any 401 the API answered), or the first answer of /api/me is signed out while a reading
 * place is still stored, which means a session revoked, expired or signed out elsewhere while the app was closed.
 */
export function sessionEnded(previous: SessionStatus, next: SessionStatus, stored: boolean): boolean {
  if (next !== "signed-out") return false;
  if (previous === "signed-in") return true;
  return previous === "loading" && stored;
}

/**
 * What the device kept for the session, cleared when it ends, through each store's own function: the appearance (the
 * theme returns to System), every reading place, whatever the account, and the feeds kept in memory. Task 6 adds the
 * drafts. The device id and the passkey card's Not now stay: they belong to the browser, not to an account.
 */
export function clearSessionTraces(): void {
  clearAppearance();
  clearPlaces();
  clearFeedCache();
}
