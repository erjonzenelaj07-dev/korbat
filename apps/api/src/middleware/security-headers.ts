import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
