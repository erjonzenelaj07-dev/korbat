import { Readable } from "node:stream";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { MediaId, type MediaSize } from "@korbat/contracts";
import { isMediaId } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { clientIpKey, rateLimit, type RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps } from "./context";
import { remove } from "./flows/remove";
import { serve } from "./flows/serve";
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

const IMAGE_FILE = /^(small|large)\.webp$/;

/**
 * The image files: GET /api/media/<id>/small.webp and /large.webp. The app mounts these before its
 * global rate limit and before session resolution. A timeline page can hold 80 images, so they have
 * their own bucket of 1200 requests a minute per IP, and the session is only resolved when the
 * answer depends on who asks. The names end in .webp because that is what a CDN caches by default.
 */
export function mediaFileRoutes(deps: MediaDeps, options: { resolveSession: MiddlewareHandler<AppEnv>; rateLimitStore: RateLimitStore }) {
  const r = new Hono<AppEnv>();
  const limit = rateLimit({ name: "media", store: options.rateLimitStore, limit: 1200, windowMs: 60_000, key: clientIpKey });

  r.get("/:id/:file", limit, async (c) => {
    const notFound = () => c.json(errorBody("not_found", "Not found.", c.get("requestId")), 404);
    // Only the canonical lowercase id names an image, so every image has exactly one URL and one cache key.
    const id = c.req.param("id");
    const size = IMAGE_FILE.exec(c.req.param("file"))?.[1] as MediaSize | undefined;
    if (!isMediaId(id) || !size) return notFound();

    const served = await serve(deps, {
      id,
      size,
      ifNoneMatch: c.req.header("if-none-match"),
      viewer: async () => {
        await options.resolveSession(c, async () => undefined);
        return c.get("session")?.userId ?? null;
      },
    });
    if (served.kind === "not_found") return notFound();

    c.header("Cache-Control", served.cacheControl);
    c.header("ETag", served.etag);
    if (served.kind === "not_modified") return c.body(null, 304);
    // Always WebP, whatever the bytes are: the store is not trusted, and nosniff plus the API's CSP keep them inert.
    c.header("Content-Type", "image/webp");
    c.header("Content-Length", String(served.file.size));
    return c.body(Readable.toWeb(served.file.handle.createReadStream()) as ReadableStream<Uint8Array>);
  });

  return r;
}
