import { DeleteConfirmRequest } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { clearSessionCookies, type RequestContext } from "../auth";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { AccountDeps } from "./context";
import { confirmDeletion, startDeletion } from "./flows/deletion";
import { buildExport, enforceExportLimit, exportFilename, giveBackExport, writeExport, type ExportPlan } from "./flows/export";
import { createZipWriter } from "./zip";

/**
 * The account endpoints, mounted at /api/account. `guard` is the auth module's requireSession: an
 * onboarded account, with CSRF and Origin already checked for cookie sessions. `fresh` is its
 * requireFreshAuth: a credential proven in the last five minutes, which the export needs on top
 * (1b design, section 10). `strong` is its requireStrongFreshAuth: level 2 on an account with TOTP,
 * which starting and confirming a deletion need (1c design, section 10). Errors are the app's to
 * render: AccountError and those of the three modules.
 */
export function accountRoutes(deps: AccountDeps, guard: MiddlewareHandler<AppEnv>, fresh: MiddlewareHandler<AppEnv>, strong: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();

  /** What the auth flows record about a request, as the auth routes build it: the hashed address, never the address. */
  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });

  r.post("/delete/start", guard, strong, async (c) => c.json(await startDeletion(deps, c.get("session")!, requestContext(c))));

  r.post("/delete/confirm", guard, strong, validate("json", DeleteConfirmRequest), async (c) => {
    await confirmDeletion(deps, c.get("session")!, c.req.valid("json"));
    // The session behind a web request's cookies is revoked; the browser is told to drop them so it does not keep sending a dead token.
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/export", guard, fresh, async (c) => {
    const session = c.get("session")!;
    const log = c.get("log");
    // Taken before anything is built or streamed; given back below when the export fails before its first byte.
    await enforceExportLimit(deps, session.userId);
    const now = deps.now();

    // The body is a stream this handler writes itself, so a failure after the first byte can fail it: the
    // connection then drops before the final chunk, and the client sees a broken download, never a short
    // archive that ends cleanly.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const body = writable.getWriter();
    let started = false;
    let clientLeft = false;
    let plan: ExportPlan | undefined;
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => (begin = resolve));
    const archive = (async () => {
      // By its handle, as the auth module lists the sessions: the hash of the token is no part of the export.
      plan = await buildExport(deps, session.userId, session.handle, now);
      const writer = createZipWriter(async (chunk) => {
        if (!started) {
          started = true;
          begin();
        }
        try {
          // Resolves once the client's side has taken the chunk: a slow client slows the file reads.
          await body.write(chunk);
        } catch (err) {
          // Only a client that went away fails a write; reading on would be waste.
          clientLeft = true;
          throw err;
        }
      });
      await writeExport(writer, plan);
      // Every chunk is on its way: the export happened. Recorded before the body ends, so whoever read the whole body
      // finds the event; a failure to record it is logged and does not spoil a complete download.
      await deps.auth.appendEvent(session.userId, "export_created").catch((err: unknown) => log.error({ err, userId: session.userId }, "account export: the export_created event could not be recorded"));
      await body.close();
    })();

    try {
      // Until the first chunk the export can still fail as a plain error response.
      await Promise.race([begun, archive]);
    } catch (err) {
      // Nothing was sent, so nothing was exported: the day's export goes back before the error is answered.
      await giveBackExport(deps, session.userId, log);
      throw err;
    }
    // From here the failure of the archive can only fail the body; as the design says, the day's export stays spent.
    archive.catch(async (err: unknown) => {
      await body.abort(err).catch(() => undefined);
      if (clientLeft) log.warn({ userId: session.userId }, "account export: the client left before the archive was complete");
      else log.error({ err, userId: session.userId }, "account export: the archive could not be completed");
    });

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${exportFilename(plan!.profile.profile.handle, now)}"`);
    // The archive holds the account's email address; nothing on the way may keep a copy.
    c.header("Cache-Control", "no-store");
    return c.body(readable, 200);
  });

  return r;
}
