/**
 * The console's own router (3a design, section 9): four paths and nothing else. The address bar is the only state it
 * reads; the store pushes and replaces history entries itself, so the page needs no routing library.
 */

/** The pages the console links to. A link is only ever one of these constants, never an address built from data. */
export type ConsolePath = "/" | "/audit" | "/signin";

export type Route = { name: "home" } | { name: "audit" } | { name: "signin" } | { name: "enroll"; token: string } | { name: "unknown" };

/**
 * The route an address names. A trailing slash names the same page. An enrolment link's token is kept exactly as written:
 * the enrolment page checks its shape before it sends it anywhere.
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/audit") return { name: "audit" };
  if (path === "/signin") return { name: "signin" };
  const enroll = /^\/enroll\/([^/]+)$/.exec(path);
  if (enroll) return { name: "enroll", token: enroll[1]! };
  return { name: "unknown" };
}
