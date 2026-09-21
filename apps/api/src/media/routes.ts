import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { MediaId } from "@korbat/contracts";
import type { AppEnv } from "../env";
import { validate } from "../lib/validate";
import type { MediaDeps } from "./context";
import { remove } from "./flows/remove";
import { status } from "./flows/status";
import { upload } from "./flows/upload";

const MediaParam = z.object({ id: MediaId });

/**
 * Upload, status and removal, mounted at /api/media. `guard` is the auth module's requireSession:
 * an onboarded account, with CSRF and Origin already checked for cookie sessions. The upload body
 * is the raw file; it is streamed, never parsed, and no validator may read it first.
 */
export function mediaRoutes(deps: MediaDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.post("/", guard, async (c) => {
    const request = { contentType: c.req.header("content-type"), contentLength: c.req.header("content-length"), body: c.req.raw.body };
    return c.json(await upload(deps, me(c), request), 202);
  });
  r.get("/:id", guard, validate("param", MediaParam), async (c) => c.json(await status(deps, me(c), c.req.valid("param").id)));
  r.delete("/:id", guard, validate("param", MediaParam), async (c) => {
    await remove(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  return r;
}
