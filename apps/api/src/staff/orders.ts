import { ContactCloseRequest, ContactQuery, OrderCorrectRequest, OrderItemsRequest, OrderOpenRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { AuthError, type ActiveStaffSession, type AuthForStaff, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import type { ModerationForStaff, OrderOutcome } from "../moderation";

/** An id in a path: a uuid in the lower case the database writes (3f design, section 10.2). */
const LowerUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });
const MessageParam = z.object({ message: LowerUuid });
const OrderParam = z.object({ order: LowerUuid });

/**
 * The console's routes of authorities' orders (3f design, sections 5, 7.3 to 7.5 and 10.2), a route group the staff
 * routes mount behind the staff gate. Each stands behind requireStaff. The contact point: its messages, read, and one
 * closed as what it turned out to be. The orders: the list and one order, read; an order opened, with or without a
 * message, and links added, without a key, by name, since a record restricts nothing, copies nothing and tells nobody,
 * and its audit row records who wrote it; a clock event, a closing, a reopening or an extension under the step-up
 * order_event_recorded; a correction without a key under the rules entry and caution, and under the step-up
 * order_corrected under the rule admin. The handlers only call the moderation module's staff interface.
 */
export function orderRoutes(auth: AuthForStaff, moderation: ModerationForStaff) {
  const routes = new Hono<AppEnv>();

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  /** An action's outcome as the answer: the order's view, or the ended session's and the late challenge's refusals, as a decision's. */
  const answer = (c: Context<AppEnv>, outcome: OrderOutcome) => {
    if (outcome === "ended") throw new AuthError("staff_session_required", 401);
    if (outcome === "late") throw new AuthError("challenge_expired", 400);
    return c.json(outcome, 201);
  };

  // The messages at the contact point, newest first; the console reads the list again every 20 seconds without the mark.
  routes.get("/contact", auth.requireStaff, validate("query", ContactQuery), async (c) => c.json(await moderation.contact(c.req.valid("query"))));

  // A message closed as what it turned out to be: every disposition but order, which only opening an order sets.
  routes.post("/contact/:message/close", auth.requireStaff, validate("param", MessageParam), validate("json", ContactCloseRequest), async (c) => {
    await moderation.closeContact(staffSession(c), c.req.valid("param").message, c.req.valid("json"), { requestId: c.get("requestId") });
    return c.body(null, 204);
  });

  // The orders, and one order: the reads write no access row, since they show nothing a signed-out visitor could not open
  // but the order's own facts (section 7.5).
  routes.get("/orders", auth.requireStaff, async (c) => c.json(await moderation.orders()));
  routes.get("/orders/:order", auth.requireStaff, validate("param", OrderParam), async (c) => {
    const view = await moderation.order(staffSession(c), c.req.valid("param").order);
    if (view === null) return c.json(errorBody("not_found", "Not found.", c.get("requestId")), 404);
    return c.json(view);
  });

  // An order opened from the console, by any staff member, without a key: the hour never waits for one (section 7.4).
  routes.post("/orders", auth.requireStaff, validate("json", OrderOpenRequest), async (c) =>
    c.json(await moderation.openOrder(staffSession(c), c.req.valid("json"), { requestId: c.get("requestId") }), 201),
  );

  // More links for an order that is not closed, without a key.
  routes.post("/orders/:order/items", auth.requireStaff, validate("param", OrderParam), validate("json", OrderItemsRequest), async (c) =>
    c.json(await moderation.addOrderItems(staffSession(c), c.req.valid("param").order, c.req.valid("json"), { requestId: c.get("requestId") }), 201),
  );

  // A console event: the path's order is the action's target, and the body the action's params with the assertion as
  // `stepUp`. The event commits with its audit row or not at all.
  routes.post(
    "/orders/:order/events",
    auth.requireStaff,
    validate("param", OrderParam),
    auth.requireStaffStepUp("order_event_recorded", (c) => c.req.param("order")),
    async (c) => {
      const confirmed = c.get("staffStepUp") as StaffStepUpConfirmed | undefined;
      if (!confirmed) throw new Error("an order's event ran without requireStaffStepUp");
      return answer(c, await moderation.recordOrderEvent(staffSession(c), confirmed, { requestId: c.get("requestId") }));
    },
  );

  // "Disable for an order" (section 7.6): the path's order is the action's target, and the body the params of
  // order_effected (the order's facts as shown, `urgent` and the items) with the assertion as `stepUp`. Every decision
  // commits with the one audit row or none does.
  routes.post(
    "/orders/:order/effect",
    auth.requireStaff,
    validate("param", OrderParam),
    auth.requireStaffStepUp("order_effected", (c) => c.req.param("order")),
    async (c) => {
      const confirmed = c.get("staffStepUp") as StaffStepUpConfirmed | undefined;
      if (!confirmed) throw new Error("an order's effect ran without requireStaffStepUp");
      return answer(c, await moderation.giveOrderEffect(staffSession(c), confirmed, { requestId: c.get("requestId") }));
    },
  );

  // A correction: with `stepUp` in the body the step-up of order_corrected checks it first (its params are the body's
  // facts); without it the body is the facts alone, and the database decides the rule. Under the rule admin the key is
  // required: staff_step_up_required, and nothing is kept.
  const stepUpWhenSent: MiddlewareHandler<AppEnv> = async (c, next) => {
    const body: unknown = await c.req.json().catch(() => null);
    const sent = typeof body === "object" && body !== null && "stepUp" in body;
    const guard = sent ? auth.requireStaffStepUp("order_corrected", (ctx) => ctx.req.param("order")) : validate("json", OrderCorrectRequest);
    return guard(c, next);
  };
  routes.post("/orders/:order/correct", auth.requireStaff, validate("param", OrderParam), stepUpWhenSent, async (c) => {
    const confirmed = (c.get("staffStepUp") as StaffStepUpConfirmed | undefined) ?? null;
    const facts = confirmed !== null ? (confirmed.params as { facts: OrderCorrectRequest["facts"] }).facts : (c.req.valid("json" as never) as OrderCorrectRequest).facts;
    const outcome = await moderation.correctOrder(staffSession(c), c.req.valid("param").order, facts, confirmed, { requestId: c.get("requestId") });
    if (outcome === "step_up_required") throw new AuthError("staff_step_up_required", 403);
    return answer(c, outcome);
  });

  return routes;
}
