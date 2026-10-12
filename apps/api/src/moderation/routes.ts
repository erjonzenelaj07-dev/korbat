import { AuthorCasesQuery, NoticeContactRequest, NoticeRequest, NoticeStatusRequest, ReportsQuery } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { authorCases, authorDecisionView } from "./author";
import type { ModerationDeps } from "./context";
import { noticeContact, noticeStatus, submitNotice, type NoticeSender } from "./intake";
import { reporterList, resumeReportMail } from "./reports";

/** A decision's id in the lower case PostgreSQL returns. */
const DecisionParam = z.object({ id: z.uuid().transform((id) => id.toLowerCase()) });

/**
 * The guard the signed-in routes stand behind when the module is built without the server's: it refuses every request.
 * The server always hands over the auth module's requireSession; a module built without one, as the tests of the staff
 * side build it, must not open a signed-in route to anyone.
 */
export const noSession: MiddlewareHandler<AppEnv> = async (c) => c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);

/**
 * The moderation module's app routes, mounted at `/api` after the global rate limit and session resolution (3c design,
 * section 5). Handlers only validate, call a flow and shape the response; a flow's refusal is a ModerationError, which
 * the app's error handler turns into the shared envelope.
 *
 * The three routes under `/api/notices` take a request with or without a session. Signed out, such a request passes
 * session resolution with its Origin checked and no CSRF token, since there is no cookie to ride on; signed in from a
 * browser, it carries the token as every cookie request does. The status page's tokens travel in the body of a POST, so
 * no address, and no server log, ever holds one.
 *
 * The four routes under `/api/moderation` are the signed-in account's own (section 7.6). `guard` is the auth module's
 * requireSession: an onboarded account, with CSRF and Origin already checked for cookie sessions. Each answers only for
 * the session's account: the decisions about it, and the reports it sent.
 */
export function moderationRoutes(deps: ModerationDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  /** The keyed hash of the client's network, which the client identity middleware set; "direct" where it did not run. */
  const netHash = (c: Context<AppEnv>): string => c.get("clientNetHash") ?? "direct";
  const sender = (c: Context<AppEnv>): NoticeSender => ({ session: c.get("session"), netHash: netHash(c) });
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  // One request is one report or notice: one intake, an item for each target it names.
  r.post("/notices", validate("json", NoticeRequest), async (c) => c.json(await submitNotice(deps, c.req.valid("json"), sender(c)), 201));
  // Where a notice stands, for whoever holds its reference with its own token or with the token of a mail's link.
  r.post("/notices/status", validate("json", NoticeStatusRequest), async (c) => c.json(await noticeStatus(deps, c.req.valid("json"), netHash(c))));
  // The status page's two buttons: a POST each, never a link that acts when it is merely opened.
  r.post("/notices/contact", validate("json", NoticeContactRequest), async (c) => {
    await noticeContact(deps, c.req.valid("json"), netHash(c));
    return c.body(null, 204);
  });

  // The decisions about the account that its author was told of, newest first.
  r.get("/moderation/cases", guard, validate("query", AuthorCasesQuery), async (c) => c.json(await authorCases(deps, me(c), c.req.valid("query").cursor)));
  // One of them, with its statement's data and the content it was made on; not_found for anyone but its subject.
  r.get("/moderation/decisions/:id", guard, validate("param", DecisionParam), async (c) => c.json(await authorDecisionView(deps, me(c), c.req.valid("param").id)));
  // The reports and notices the account sent, each item as its status page would give it.
  r.get("/moderation/reports", guard, validate("query", ReportsQuery), async (c) => c.json(await reporterList(deps, me(c), c.req.valid("query").cursor)));
  // Lifts a stop of korbat's report mails to the account's address; the same answer whether or not there was one.
  r.post("/moderation/report-mail/resume", guard, async (c) => {
    await resumeReportMail(deps, me(c));
    return c.body(null, 204);
  });

  return r;
}
