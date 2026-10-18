import {
  AuditExportRequest,
  AuditMarkRequest,
  AuditPageQuery,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffSignInVerifyRequest,
  StaffStepUpOptionsRequest,
  type AuditExportLine,
  type AuditPage,
} from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AuthError, clearStaffCookies, setStaffCookies, type ActiveStaffSession, type AuthForStaff, type StaffRequestContext, type StaffStepUpConfirmed } from "../auth";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import type { ModerationForStaff } from "../moderation";
import { caseRoutes } from "./cases";
import { staffGate } from "./gate";
import { orderRoutes } from "./orders";
import type { ExportOutcome } from "./audit";

/**
 * The record as the staff routes read it (3a design, section 7; 3f Task 6, section 7.16): a page with the reader's own
 * newest copied place, the keeper's confirmed download, its lines, and the mark the console posts once it holds them.
 */
export interface StaffAudit {
  page(query: AuditPageQuery, staffId: string): Promise<AuditPage>;
  export(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }): Promise<ExportOutcome>;
  lines(after: number, through: number): AsyncIterable<AuditExportLine>;
  mark(session: ActiveStaffSession, request: AuditMarkRequest, ctx: { requestId: string }): Promise<"marked" | "mismatch">;
}

/** One line of the download ends with a line feed. */
const LF = String.fromCharCode(10);

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. Behind it, every route but enrolment and sign-in stands behind requireStaff.
 * Handlers only validate, call the auth module's staff interface or the audit reader, and shape the answer. A route that
 * changes something stands behind requireStaffStepUp as well, which verifies the key's confirmation of exactly what the
 * route is about to do; sign-out alone needs none. No route answers a HEAD request (below).
 */
export function staffRoutes(consoleOrigin: string, auth: AuthForStaff, moderation: ModerationForStaff, audit: StaffAudit) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));

  // No staff route answers HEAD. Hono answers a HEAD request with the handlers of the path's GET route and drops the
  // body, so the whole read would run with nothing shown to anyone: a session read and, on a marked request, its idle
  // end moved; a case's read written to the access log and counted against the day's limit; an image's file opened and
  // logged as viewed. The console never sends HEAD. So behind the gate, which every request passes first, and before any
  // route, a HEAD on every path is the unknown route, as any method is on a path that does not take it: no session is
  // read, no row written, no limit counted and no file opened.
  routes.use("*", async (c, next) => (c.req.method === "HEAD" ? c.notFound() : next()));

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

  /** The confirmation requireStaffStepUp verified; a route without it in front is a wiring fault, not a refusal. */
  const confirmedStepUp = (c: Context<AppEnv>): StaffStepUpConfirmed => {
    const confirmed = c.get("staffStepUp");
    if (!confirmed) throw new Error("a staff route that changes something ran without requireStaffStepUp");
    return confirmed;
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
  // Any staff member reads the whole record; reading is not itself recorded. 3f Task 6: the page carries the reader's own
  // newest copied place, from which the console's "Download since my last copy" starts.
  routes.get("/audit", auth.requireStaff, validate("query", AuditPageQuery), async (c) => c.json(await audit.page(c.req.valid("query"), staffSession(c).userId)));

  // 3f Task 6 (sections 6.6 and 7.16): the keeper's download of the audit log's tail, a confirmed action, since a line
  // carries its row's metadata, which the page never shows. The body is the params of audit_exported (`after` and
  // `through`) with the assertion as `stepUp`; the target is the place `through`, read from the body the validator has
  // parsed. One transaction writes the confirmed audit row alone, then the rows stream as JSON lines; no mark is written.
  // After the commit, every staff account is alerted when a staff member other than the caller holds the newest copy.
  routes.post(
    "/audit/export",
    auth.requireStaff,
    validate("json", AuditExportRequest),
    auth.requireStaffStepUp("audit_exported", (c) => {
      const through = (c.req as unknown as { valid(target: "json"): { through?: unknown } }).valid("json").through;
      return typeof through === "number" ? String(through) : undefined;
    }),
    async (c) => {
      const outcome = await audit.export(staffSession(c), confirmedStepUp(c), { requestId: c.get("requestId") });
      if (outcome === "ended") throw new AuthError("staff_session_required", 401);
      if (outcome === "late") throw new AuthError("challenge_expired", 400);
      if (outcome === "beyond_head") return c.json(errorBody("invalid_request", "The download ends after the newest place of the record", c.get("requestId")), 422);
      if (outcome.copyTaken) void moderation.copyTaken({ at: new Date().toISOString(), rows: outcome.rows });
      const iterator = audit.lines(outcome.after, outcome.through)[Symbol.asyncIterator]();
      const encoder = new TextEncoder();
      // Pulled one line at a time: a slow reader holds no page in memory, and a read that fails ends the body short,
      // which the console's check of the lines then finds, and it records nothing.
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(JSON.stringify(next.value) + LF));
        },
        async cancel() {
          await iterator.return?.(undefined);
        },
      });
      c.header("Content-Type", "application/x-ndjson");
      c.header("Cache-Control", "private, no-store");
      c.header("Content-Disposition", `attachment; filename="korbat-audit-${outcome.after + 1}-${outcome.through}.jsonl"`);
      return c.body(body);
    },
  );
  // The keeper's confirmation that the console holds the whole file: no key, since it shows nothing and can only say "I
  // hold it" of a file a key released. 204, or 409 copy_mismatch with nothing written.
  routes.post("/audit/export/mark", auth.requireStaff, validate("json", AuditMarkRequest), async (c) => {
    const marked = await audit.mark(staffSession(c), c.req.valid("json"), { requestId: c.get("requestId") });
    if (marked === "mismatch") return c.json(errorBody("copy_mismatch", "That place does not hold that hash, or your newest confirmed download did not release it", c.get("requestId")), 409);
    return c.body(null, 204);
  });
  routes.post("/signout", auth.requireStaff, async (c) => {
    await auth.signOut(staffSession(c), requestContext(c));
    clearStaffCookies(c);
    return c.body(null, 204);
  });

  // Step-up (3a design, section 7): options for confirming one action, bound to this session and to exactly the
  // { action, target, params } the console sent, which the action's own route then recomputes from what it executes.
  routes.post("/step-up/options", auth.requireStaff, validate("json", StaffStepUpOptionsRequest), async (c) =>
    c.json(await auth.stepUpOptions(staffSession(c), c.req.valid("json"))),
  );
  // One of the person's own staff sessions, revoked with a confirmation by the session's key: the path's handle is the
  // action's target, and the body is the action's params (none) with the assertion as `stepUp`. A handle that names no live
  // session of the person's is the 404 the app's own session revocation answers.
  routes.delete(
    "/sessions/:handle",
    auth.requireStaff,
    validate("param", z.object({ handle: z.uuid() })),
    auth.requireStaffStepUp("staff_session_revoked", (c) => c.req.param("handle")),
    async (c) => {
      const revoked = await auth.revokeSession(staffSession(c), confirmedStepUp(c), requestContext(c));
      return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
    },
  );

  // The console's case routes, behind the gate above like every path here.
  routes.route("/", caseRoutes(auth, moderation));
  // 3f: the routes of authorities' orders, behind the same gate.
  routes.route("/", orderRoutes(auth, moderation));

  return routes;
}
