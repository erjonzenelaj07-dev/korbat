import { AppealRequest, AuthorCasesQuery, NoticeContactRequest, NoticeReexamineRequest, NoticeRequest, NoticeStatusRequest, ReexamineRequest, ReplyRequest, ReportsQuery } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { fileAppeal } from "./appeals";
import { authorCases, authorDecisionView } from "./author";
import type { ModerationDeps } from "./context";
import { noticeContact, noticeStatus, reexamineNotice, reexamineOwnItem, submitNotice, type NoticeSender } from "./intake";
import { authorNotices, authorRelease } from "./release";
import { reporterList, resumeReportMail } from "./reports";
import { fileReply } from "./standing";

/** A decision's id in the lower case PostgreSQL returns. */
const DecisionParam = z.object({ id: z.uuid().transform((id) => id.toLowerCase()) });
/** An item's id, the same way. */
const ItemParam = z.object({ item: z.uuid().transform((id) => id.toLowerCase()) });
/** 3d Task 2: a release's id, the same way. */
const ReleaseParam = z.object({ release: z.uuid().transform((id) => id.toLowerCase()) });
/** 3d Task 2: a page of the notices after the cursor the API handed out. */
const NoticesQuery = z.strictObject({ cursor: z.string().min(1).max(200).optional() });

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
 * The four routes under `/api/notices` take a request with or without a session. Signed out, such a request passes
 * session resolution with its Origin checked and no CSRF token, since there is no cookie to ride on; signed in from a
 * browser, it carries the token as every cookie request does. The status page's tokens travel in the body of a POST, so
 * no address, and no server log, ever holds one.
 *
 * The nine routes under `/api/moderation` are the signed-in account's own (sections 7.6 and 7.7, and 3e's 7.6 step 9). `guard` is the auth
 * module's requireSession: an onboarded account, with CSRF and Origin already checked for cookie sessions. Each answers
 * only for the session's account: the decisions about it and its appeal of one, and the reports it sent and its request
 * to have one of their items examined again.
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
  // A notifier asks korbat to decide an item of their notice again, with either token, as for the status page.
  r.post("/notices/reexamine", validate("json", NoticeReexamineRequest), async (c) => c.json(await reexamineNotice(deps, c.req.valid("json"), netHash(c)), 201));

  // The decisions about the account that its author was told of, newest first.
  r.get("/moderation/cases", guard, validate("query", AuthorCasesQuery), async (c) => c.json(await authorCases(deps, me(c), c.req.valid("query").cursor)));
  // One of them, with its statement's data and the content it was made on; not_found for anyone but its subject.
  r.get("/moderation/decisions/:id", guard, validate("param", DecisionParam), async (c) => c.json(await authorDecisionView(deps, me(c), c.req.valid("param").id)));
  // The author's appeal of one of them: the database decides whether it is open. It answers the decision as it now reads.
  r.post("/moderation/decisions/:id/appeal", guard, validate("param", DecisionParam), validate("json", AppealRequest), async (c) =>
    c.json(await fileAppeal(deps, me(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  // 3e: the person's one reply to the suspension or termination a decision about them holds: the hearing, never
  // suspended. The database decides whether it is open and whether it came before the start; not_found for anyone but
  // the measure's subject.
  r.post("/moderation/decisions/:id/reply", guard, validate("param", DecisionParam), validate("json", ReplyRequest), async (c) =>
    c.json(await fileReply(deps, me(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  // The reports and notices the account sent, each item as its status page would give it.
  r.get("/moderation/reports", guard, validate("query", ReportsQuery), async (c) => c.json(await reporterList(deps, me(c), c.req.valid("query").cursor)));
  // A re-examination of one of their items, named by the id that list gives.
  r.post("/moderation/items/:item/reexamine", guard, validate("param", ItemParam), validate("json", ReexamineRequest), async (c) =>
    c.json(await reexamineOwnItem(deps, me(c), c.req.valid("param").item, c.req.valid("json")), 201),
  );
  // 3d Task 2 (sections 9.6 and 10.2): the notices about the account's own posts that are not decisions, newest first:
  // the releases of its sealed images, never one whose notice is held. And one of them, for its author alone, not_found
  // for anyone else and while its notice is held.
  r.get("/moderation/notices", guard, validate("query", NoticesQuery), async (c) => c.json(await authorNotices(deps, me(c), c.req.valid("query").cursor)));
  r.get("/moderation/releases/:release", guard, validate("param", ReleaseParam), async (c) => c.json(await authorRelease(deps, me(c), c.req.valid("param").release)));
  // Lifts a stop of korbat's report mails to the account's address; the same answer whether or not there was one.
  r.post("/moderation/report-mail/resume", guard, async (c) => {
    await resumeReportMail(deps, me(c));
    return c.body(null, 204);
  });

  return r;
}
