import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
const hardened = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

/**
 * The hardened header set, and 2d's X-Robots-Tag: noindex (design, decision 20 and section 8.2) on every answer of the
 * API, an image file's, a card's, a 404's and an error's included: a search engine that fetches an API path is asked not
 * to index it, as every page that names an account asks. Set after the handler and the error handler have answered, so
 * no answer goes without it.
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await hardened(c, next);
  c.res.headers.set("X-Robots-Tag", "noindex");
});

/**
 * Nothing the API returns may be cached, unless a handler said otherwise itself: image files of visible posts do (3d
 * design, section 7.4). A 404 of the image route stays no-store, so no edge keeps a refusal that would outlive a restored
 * image.
 */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});
