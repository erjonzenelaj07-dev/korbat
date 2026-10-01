import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { AuthError, authErrorMessage, type AuthDeps } from "../context";
import { checkStaffCsrf, clearStaffCookies, readStaffCookie } from "./cookies";
import { resolveStaffSession } from "./sessions";

/**
 * The mark the console sends on a request its person's action started (a click, a submitted form, opening a screen), and
 * on no other: only such a request moves the idle end. It governs the console's own requests; it is no defence against a
 * script in the page, which the console's policy and the step-up answer.
 */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Every staff route that needs a session stands behind this, after the staff gate (3a design, section 7, Every staff
 * request). It reads the staff cookie only, never a bearer token or the app's session cookie. A write (anything but GET
 * and HEAD) must carry the x-staff-csrf header equal to the staff CSRF cookie, checked before the session is read, so a
 * refused write moves nothing. The session is then read from the database, joined to its key and its account, and a
 * marked request slides its idle end in the same statement. Without a live session the answer is 401
 * staff_session_required with both staff cookies cleared, which the console answers with its sign-in. A later step that
 * finds the session ended after this read it (the step-up, when the session's key or account went meanwhile) raises the
 * same code, and its answer clears both cookies too.
 */
export function requireStaff(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const ended = () => {
      clearStaffCookies(c);
      return c.json(errorBody("staff_session_required", authErrorMessage("staff_session_required"), c.get("requestId")), 401);
    };
    const token = readStaffCookie(c);
    if (!token) return ended();
    if (!SAFE_METHODS.has(c.req.method) && !checkStaffCsrf(c)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }
    const session = await resolveStaffSession(deps, token, c.req.header(STAFF_ACTIVITY_HEADER) === "1");
    if (!session) return ended();
    c.set("staffSession", session);
    await next();
    // Hono has already answered an error thrown behind this through the app's onError and left it in c.error; the cookies
    // are added to that answer, as ended() adds them to its own.
    if (c.error instanceof AuthError && c.error.code === "staff_session_required") clearStaffCookies(c);
  });
}
