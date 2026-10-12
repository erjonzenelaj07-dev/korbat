import { NoticeContactRequest, NoticeRequest, NoticeStatusRequest } from "@korbat/contracts";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { ModerationDeps } from "./context";
import { noticeContact, noticeStatus, submitNotice, type NoticeSender } from "./intake";

/**
 * The moderation module's app routes, mounted at `/api` after the global rate limit and session resolution (3c design,
 * section 5). Handlers only validate, call a flow and shape the response; a flow's refusal is a ModerationError, which
 * the app's error handler turns into the shared envelope.
 *
 * The three routes under `/api/notices` take a request with or without a session. Signed out, such a request passes
 * session resolution with its Origin checked and no CSRF token, since there is no cookie to ride on; signed in from a
 * browser, it carries the token as every cookie request does. The status page's tokens travel in the body of a POST, so
 * no address, and no server log, ever holds one.
 */
export function moderationRoutes(deps: ModerationDeps) {
  const r = new Hono<AppEnv>();
  /** The keyed hash of the client's network, which the client identity middleware set; "direct" where it did not run. */
  const netHash = (c: Context<AppEnv>): string => c.get("clientNetHash") ?? "direct";
  const sender = (c: Context<AppEnv>): NoticeSender => ({ session: c.get("session"), netHash: netHash(c) });

  // One request is one report or notice: one intake, an item for each target it names.
  r.post("/notices", validate("json", NoticeRequest), async (c) => c.json(await submitNotice(deps, c.req.valid("json"), sender(c)), 201));
  // Where a notice stands, for whoever holds its reference with its own token or with the token of a mail's link.
  r.post("/notices/status", validate("json", NoticeStatusRequest), async (c) => c.json(await noticeStatus(deps, c.req.valid("json"), netHash(c))));
  // The status page's two buttons: a POST each, never a link that acts when it is merely opened.
  r.post("/notices/contact", validate("json", NoticeContactRequest), async (c) => {
    await noticeContact(deps, c.req.valid("json"), netHash(c));
    return c.body(null, 204);
  });

  return r;
}
