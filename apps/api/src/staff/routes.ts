import { AuditPageQuery, StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffSignInVerifyRequest, type AuditPage } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { clearStaffCookies, setStaffCookies, type ActiveStaffSession, type AuthForStaff, type StaffRequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Behind it, every route but enrolment and sign-in stands behind requireStaff.
 * Handlers only validate, call the auth module's staff interface or the audit reader, and shape the answer; step-up and
 * the session revocation it confirms join them with their flow.
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff, readAudit: (query: AuditPageQuery) => Promise<AuditPage>) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  // Sign-in needs no session either: the staff key's assertion is the credential. The options take no body.
  routes.post("/signin/options", async (c) => c.json(await auth.signInOptions()));
  routes.post("/signin/verify", validate("json", StaffSignInVerifyRequest), async (c) => {
    const { token, me } = await auth.signInVerify(c.req.valid("json"), requestContext(c));
    // Both staff cookies, set once and never refreshed: they last the session's 12 hours.
    setStaffCookies(c, token);
    return c.json(me);
  });

  routes.get("/me", auth.requireStaff, async (c) => c.json(await auth.me(staffSession(c))));
  routes.get("/sessions", auth.requireStaff, async (c) => c.json(await auth.sessions(staffSession(c))));
  routes.get("/keys", auth.requireStaff, async (c) => c.json(await auth.keys(staffSession(c))));
  // Any staff member reads the whole record; reading is not itself recorded.
  routes.get("/audit", auth.requireStaff, validate("query", AuditPageQuery), async (c) => c.json(await readAudit(c.req.valid("query"))));
  routes.post("/signout", auth.requireStaff, async (c) => {
    await auth.signOut(staffSession(c), requestContext(c));
    clearStaffCookies(c);
    return c.body(null, 204);
  });

  return routes;
}
