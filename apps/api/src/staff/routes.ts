import { StaffEnrollOptionsRequest, StaffEnrollVerifyRequest } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import type { AuthForStaff, StaffRequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Handlers only validate, call the auth module's staff interface and shape the
 * answer. Enrolment is here so far; sign-in, sessions, the audit log and step-up join it with their flows.
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // The client's address is hashed before any flow sees it, and the request's id goes to the audit rows it writes.
  const requestContext = (c: Context<AppEnv>): StaffRequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
    requestId: c.get("requestId"),
  });

  // Enrolment needs no session: the link's one-time token is the credential, until a key is stored with it.
  routes.post("/enroll/options", validate("json", StaffEnrollOptionsRequest), async (c) => c.json(await auth.enrollOptions(c.req.valid("json"))));
  routes.post("/enroll/verify", validate("json", StaffEnrollVerifyRequest), async (c) => c.json(await auth.enrollVerify(c.req.valid("json"), requestContext(c))));

  return routes;
}
