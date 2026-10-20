/**
 * The console's own router (3a design, section 9; 3c design, section 8): its fixed pages, a case by its id, an enrolment
 * link, and nothing else. The address bar is the only state it reads; the store pushes and replaces history entries
 * itself, so the page needs no routing library.
 */

/** The pages the console links to by name. Such a link is only ever one of these constants, never an address built from data. */
export type ConsolePath = "/" | "/audit" | "/signin" | "/queue" | "/appeals" | "/standing" | "/contact" | "/orders" | "/restore" | "/uploads";

/** A uuid in the one spelling PostgreSQL writes: the only form an id takes in an address the console builds. */
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a text is a lower-case uuid, and nothing else. */
export const isLowerUuid = (text: string): boolean => LOWER_UUID.test(text);

declare const caseIdBrand: unique symbol;
/** A case's id that parseCaseId has checked: the only thing a case's address is ever built from. */
export type CaseId = string & { readonly [caseIdBrand]: true };

/** The case's id when the text is a lower-case uuid; null for anything else, which names no case. */
export function parseCaseId(text: string): CaseId | null {
  return isLowerUuid(text) ? (text as CaseId) : null;
}

/** A case's address in the console: the one address the console builds from a value, and only from a checked id. */
export const caseHref = (id: CaseId): string => `/cases/${id}`;

declare const orderIdBrand: unique symbol;
/** 3f: an order's id that parseOrderId has checked: the only thing an order's address is ever built from. */
export type OrderId = string & { readonly [orderIdBrand]: true };

/** The order's id when the text is a lower-case uuid; null for anything else, which names no order. */
export function parseOrderId(text: string): OrderId | null {
  return isLowerUuid(text) ? (text as OrderId) : null;
}

/** An order's address in the console, built from a checked id alone, as a case's is. */
export const orderHref = (id: OrderId): string => `/orders/${id}`;

export type Route =
  | { name: "home" }
  | { name: "audit" }
  | { name: "signin" }
  | { name: "queue" }
  | { name: "appeals" }
  | { name: "standing" }
  // 3f: the authorities' contact point, the orders and one order.
  | { name: "contact" }
  | { name: "orders" }
  | { name: "order"; id: OrderId }
  // 3f Task 6: what an import after a restore found lost.
  | { name: "restore" }
  // 3d Task 7: Held uploads.
  | { name: "uploads" }
  | { name: "case"; id: CaseId }
  | { name: "enroll"; token: string }
  | { name: "unknown" };

/**
 * The route an address names. A trailing slash names the same page. An enrolment link's token is kept exactly as written:
 * the enrolment page checks its shape before it sends it anywhere.
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/audit") return { name: "audit" };
  if (path === "/signin") return { name: "signin" };
  if (path === "/queue") return { name: "queue" };
  if (path === "/appeals") return { name: "appeals" };
  if (path === "/standing") return { name: "standing" };
  if (path === "/contact") return { name: "contact" };
  if (path === "/orders") return { name: "orders" };
  if (path === "/restore") return { name: "restore" };
  if (path === "/uploads") return { name: "uploads" };
  const order = /^[/]orders[/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path);
  if (order) {
    const id = parseOrderId(order[1]!);
    if (id) return { name: "order", id };
  }
  const found = /^\/cases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(path);
  if (found) {
    const id = parseCaseId(found[1]!);
    if (id) return { name: "case", id };
  }
  const enroll = /^\/enroll\/([^/]+)$/.exec(path);
  if (enroll) return { name: "enroll", token: enroll[1]! };
  return { name: "unknown" };
}
