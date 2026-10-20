import { rmSync } from "node:fs";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import pino from "pino";
import { createMiddleware } from "hono/factory";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import type { AppEnv } from "../../src/env";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { mediaFileRoutes } from "../../src/media/routes";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, leavesNoModerationRows } from "./moderation-decide";

describe.skipIf(!process.env.INTEGRATION)("integration: serving image files", () => {
  let db: Db;
  let h: MediaHarness;
  let resolved = 0;

  /** Stands in for the auth module: the test names the viewer in a header, and counts how often a session was resolved. */
  const resolveSession = createMiddleware<AppEnv>(async (c, next) => {
    resolved++;
    const userId = c.req.header("x-test-viewer");
    c.set("session", userId ? ({ userId } as AppEnv["Variables"]["session"]) : null);
    await next();
  });
  const app = (deps: MediaDeps) => new Hono<AppEnv>().route("/api/media", mediaFileRoutes(deps, { resolveSession, rateLimitStore: new MemoryStore() }));
  const get = (harness: { deps: MediaDeps }, path: string, headers: Record<string, string> = {}) => app(harness.deps).request(path, { headers });

  /** Every image this file put on a post: hiding or deleting one writes the edge's outbox rows, which the file removes at its end. */
  const made: string[] = [];
  const postWithImages = async (...args: Parameters<MediaHarness["postWithImages"]>) => {
    const posted = await h.postWithImages(...args);
    made.push(...posted.mediaIds);
    return posted;
  };

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = await mediaHarness(db);
  });
  afterAll(async () => {
    h.cleanup();
    // 3d Task 3: the outbox rows this file's images got, by id; the API's role may delete them.
    await db.execute(sql`delete from public.edge_purges where media_id = any(${`{${made.join(",")}}`}::uuid[])`);
    await closeDecisions();
    await closeDb(db);
  });

  test("an image of a visible post is public, cacheable by a browser for a minute and by an edge for five, never stale, and costs no session lookup", async () => {
    const ada = await h.established();
    const { mediaIds } = await postWithImages(ada.id);
    resolved = 0;
    for (const size of ["large", "small"] as const) {
      const res = await get(h, mediaPath(mediaIds[0]!, size));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0");
      expect(res.headers.get("etag")).toBe(`"${mediaIds[0]}-${size}"`);
      const body = await res.text();
      expect(body).toBe(`${size}-webp-of-${mediaIds[0]}`);
      expect(res.headers.get("content-length")).toBe(String(body.length));
    }
    expect(resolved).toBe(0);
  });

  test("a matching If-None-Match answers 304 with the same cache headers and no body", async () => {
    const ada = await h.established();
    const { mediaIds } = await postWithImages(ada.id);
    const etag = `"${mediaIds[0]}-large"`;
    const res = await get(h, mediaPath(mediaIds[0]!, "large"), { "if-none-match": `"something-else", ${etag}` });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0");
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"), { "if-none-match": '"stale"' })).status).toBe(200);
  });

  test("an image that is on no post, is not ready, or does not exist is not found for anyone", async () => {
    const ada = await h.established();
    const unattached = await h.readyImage(ada.id);
    for (const path of [mediaPath(unattached, "large"), mediaPath(h.newId(), "large")]) {
      const res = await get(h, path, { "x-test-viewer": ada.id });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  test("other names under an image id are not found, and nothing is looked up for them", async () => {
    const ada = await h.established();
    const { mediaIds } = await postWithImages(ada.id);
    for (const path of [`/api/media/${mediaIds[0]}/large.png`, `/api/media/${mediaIds[0]}/medium.webp`, `/api/media/${mediaIds[0]}/large.webp.bak`, "/api/media/not-an-id/large.webp", `/api/media/${mediaIds[0]!.toUpperCase()}/large.webp`]) {
      expect((await get(h, path)).status, path).toBe(404);
    }
  });

  test.each(["withheld", "removed"] as const)("images of a %s post reach their author only, and are never cached", async (state) => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const { postId, mediaIds } = await postWithImages(ada.id);
    await h.setPostState(postId, state);
    const path = mediaPath(mediaIds[0]!, "large");

    const own = await get(h, path, { "x-test-viewer": ada.id });
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect(await own.text()).toBe(`large-webp-of-${mediaIds[0]}`);

    expect((await get(h, path, { "x-test-viewer": bob.id })).status).toBe(404);
    expect((await get(h, path)).status).toBe(404);
    const revalidate = await get(h, path, { "x-test-viewer": bob.id, "if-none-match": `"${mediaIds[0]}-large"` });
    expect(revalidate.status).toBe(404);
    // The state comes from a real, confirmed decision: a staff key's enrolment, a sign-in, a step-up and the decision.
  }, 30_000);

  test("images of a deleted post are gone, for the author too", async () => {
    const ada = await h.established();
    const { postId, mediaIds } = await postWithImages(ada.id);
    await h.setPostState(postId, "deleted_by_author");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"), { "x-test-viewer": ada.id })).status).toBe(404);
  });

  test("a ready image whose file is missing is not found", async () => {
    const ada = await h.established();
    const { mediaIds } = await postWithImages(ada.id);
    rmSync(h.files.store.image(mediaIds[0]!, "small"));
    expect((await get(h, mediaPath(mediaIds[0]!, "small"))).status).toBe(404);
    expect((await get(h, mediaPath(mediaIds[0]!, "large"))).status).toBe(200);
  });

  test("a file that is not on the store's own device is never served: that is what a planted symlink resolves to", async () => {
    const ada = await h.established();
    const { mediaIds } = await postWithImages(ada.id);
    const files = createMediaFiles({ uploadsDir: h.files.uploads.root, storeDir: h.files.store.root, log: pino({ level: "silent" }), storeDevice: -1 });
    const res = await get({ deps: { ...h.deps, files } }, mediaPath(mediaIds[0]!, "large"));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("webp-of");
    expect((await get(h, mediaPath(mediaIds[0]!, "large"))).status).toBe(200);
  });

  leavesNoModerationRows(() => db);
});
