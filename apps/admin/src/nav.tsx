import type { MouseEvent, ReactNode } from "react";
import { caseHref, orderHref, type CaseId, type ConsolePath, type OrderId } from "./router";

/**
 * A link to one of the console's own pages. Its address is one of the constants ConsolePath lists, never built from
 * data; a plain click moves inside the page through the store, any other click (a new tab, a new window) is the
 * browser's, as on any link.
 */
export function NavLink({ to, current = false, onNavigate, children }: { to: ConsolePath; current?: boolean; onNavigate(path: ConsolePath): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };
  return (
    <a href={to} aria-current={current ? "page" : undefined} onClick={follow}>
      {children}
    </a>
  );
}

/**
 * A link to a case's page in the console. Its address is built from a CaseId, which only parseCaseId makes, and from
 * nothing else: an id an answer carries is checked before it can become an address. No link leads into the app.
 */
export function CaseLink({ id, onOpen, children }: { id: CaseId; onOpen(id: CaseId): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <a href={caseHref(id)} onClick={follow}>
      {children}
    </a>
  );
}

/**
 * 3f: a link to an order's page in the console, built as a case's is: from an OrderId, which only parseOrderId makes, and
 * from nothing else.
 */
export function OrderLink({ id, onOpen, children }: { id: OrderId; onOpen(id: OrderId): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <a href={orderHref(id)} onClick={follow}>
      {children}
    </a>
  );
}
