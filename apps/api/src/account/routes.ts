import { DeleteConfirmRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { stream } from "hono/streaming";
import { clearSessionCookies, type RequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { AccountDeps } from "./context";
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { buildExport, enforceExportLimit, exportFilename, writeExport } from "./flows/export";
import { createZipWriter } from "./zip";

/**
 * The account endpoints, mounted at /api/account. `guard` is the auth module's requireSession: an
 * onboarded account, with CSRF and Origin already checked for cookie sessions. `fresh` is its
 * requireFreshAuth: a credential proven in the last five minutes, which every route here needs on top
 * (1b design, section 10). Errors are the app's to render: AccountError and those of the three modules.
 */
export function accountRoutes(deps: AccountDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** What the auth flows record about a request, as the auth routes build it: the hashed address, never the address. */
  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });

  r.post("/delete/start", guard, fresh, async (c) => c.json(await startDeletion(deps, c.get("session")!, requestContext(c))));

  r.post("/delete/confirm", guard, fresh, validate("json", DeleteConfirmRequest), async (c) => {
    await confirmDeletion(deps, c.get("session")!, c.req.valid("json"));
    // The session behind a web request's cookies is revoked; the browser is told to drop them so it does not keep sending a dead token.
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/export", guard, fresh, async (c) => {
    const session = c.get("session")!;
    // Taken before anything is built or streamed: a stream that fails midway still counts.
    await enforceExportLimit(deps, session.userId);
    const now = deps.now();
    // Built in memory before the first byte goes out, so a failing query is an error response, not a broken download.
    const plan = await buildExport(deps, session.userId, session.sessionId, now);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${exportFilename(plan.json.profile.handle, now)}"`);
    // The archive holds the account's email address; nothing on the way may keep a copy.
    c.header("Cache-Control", "no-store");
    return stream(
      c,
      async (body) => {
        // Hono's write swallows a closed connection; the abort flag is what says the client went away, and then reading on is waste.
        const writer = createZipWriter(async (chunk) => {
          if (body.aborted) throw new Error("the client closed the connection");
          await body.write(chunk);
        });
        await writeExport(writer, plan);
        // After the last chunk: an archive the client did not receive in full is no export.
        await deps.auth.appendEvent(session.userId, "export_created");
      },
      async (err, body) => {
        // The status went out with the first chunk; a failed stream can only be ended and noted here.
        if (body.aborted) c.get("log").warn({ userId: session.userId }, "account export: the client left before the archive was complete");
        else c.get("log").error({ err, userId: session.userId }, "account export: the archive could not be completed");
      },
    );
  });

  return r;
}
