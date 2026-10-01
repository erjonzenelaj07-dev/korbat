import type { MouseEvent, ReactNode } from "react";
import type { ConsolePath } from "./router";

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
