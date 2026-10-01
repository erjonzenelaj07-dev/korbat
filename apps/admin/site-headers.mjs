// The headers of Caddy's console site (3a design, sections 3 and 8), which the development server sends too, so the
// console runs locally under the same policy as in production.

/**
 * The page's Content Security Policy, measured in console-lab.md with zero reports: scripts, styles, images and requests
 * from the console's own origin only, no plugin, no base, no framing, forms only to itself, and Trusted Types required
 * with no policy allowed, so no HTML or script sink can be used at all.
 */
export const CONSOLE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'";

/** The hashed bundle and stylesheet, which never change under their names. */
export const isHashedPath = (pathname) => pathname.startsWith("/assets/");

/**
 * The headers for a static file at `pathname`. Every answer that is not a hashed file (the page above all) is neither
 * stored nor transformed: no-transform stops Cloudflare injecting scripts the policy would block on every page view.
 */
export function consoleSiteHeaders(pathname) {
  return {
    "Content-Security-Policy": CONSOLE_CSP,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // WebAuthn for the console itself only; no camera, microphone or position for anyone.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    "Cache-Control": isHashedPath(pathname) ? "public, max-age=31536000, immutable" : "no-store, no-transform",
  };
}
