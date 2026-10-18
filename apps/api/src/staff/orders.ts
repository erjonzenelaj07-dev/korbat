import { ContactCloseRequest, ContactQuery } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { ActiveStaffSession, AuthForStaff } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { ModerationForStaff } from "../moderation";

/** A message's id in a path: a uuid in the lower case the database writes (3f design, section 10.2). */
const MessageParam = z.object({ message: z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" }) });

/**
 * The console's routes of authorities' orders (3f design, sections 5, 7.3 and 10.2), a route group the staff routes mount
 * behind the staff gate. In this task, the contact point: its messages, read, and one closed as what it turned out to be.
 * Each stands behind requireStaff. Closing a message stands without a step-up, by name: it restricts nothing and tells
 * nobody, and its audit row records who closed it. The handlers only call the moderation module's staff interface.
 */
export function orderRoutes(auth: AuthForStaff, moderation: ModerationForStaff) {
  const routes = new Hono<AppEnv>();

  /** The session requireStaff read; a route without it in front is a wiring fault, not a refusal. */
  const staffSession = (c: Context<AppEnv>): ActiveStaffSession => {
    const session = c.get("staffSession");
    if (!session) throw new Error("a staff route ran without requireStaff");
    return session;
  };

  // The messages at the contact point, newest first; the console reads the list again every 20 seconds without the mark.
  routes.get("/contact", auth.requireStaff, validate("query", ContactQuery), async (c) => c.json(await moderation.contact(c.req.valid("query"))));

  // A message closed as what it turned out to be: every disposition but order, which only opening an order sets.
  routes.post("/contact/:message/close", auth.requireStaff, validate("param", MessageParam), validate("json", ContactCloseRequest), async (c) => {
    await moderation.closeContact(staffSession(c), c.req.valid("param").message, c.req.valid("json"), { requestId: c.get("requestId") });
    return c.body(null, 204);
  });

  return routes;
}
