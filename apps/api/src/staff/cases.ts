import type { CaseDecisionResponse } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { AuthError, type ActiveStaffSession, type AuthForStaff, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import type { ModerationForStaff } from "../moderation";

/**
 * The console's case routes (3c design, sections 5 and 7), a route group the staff routes mount behind the staff gate.
 * Each stands behind requireStaff; one that changes something stands behind requireStaffStepUp as well, which verifies
 * the key's confirmation of exactly what the route is about to do. The handlers only call the moderation module's staff
 * interface and shape the answer: the step-up stays the auth module's, the cases the moderation module's.
 */
export function caseRoutes(auth: AuthForStaff, moderation: ModerationForStaff) {
  const routes = new Hono<AppEnv>();

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
  };

  // A decision on a case: the path's case is the action's target, and the body is the action's params with the assertion
  // as `stepUp`. The decision commits with its audit row or not at all. When the confirming key or account no longer
  // opens anything by then, the session that confirmed has ended, and requireStaff clears both cookies on that answer as
  // on its own; when the challenge's time ran out, the console asks for the key again.
  routes.post(
    "/cases/:case/decisions",
    auth.requireStaff,
    auth.requireStaffStepUp("case_decided", (c) => c.req.param("case")),
    async (c) => {
      const outcome = await moderation.decide(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      const answer: CaseDecisionResponse = { decisionId: outcome.decisionId };
      return c.json(answer, 201);
    },
  );

  return routes;
}
