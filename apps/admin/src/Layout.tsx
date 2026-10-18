import type { StaffMe } from "@korbat/contracts";
import type { ReactNode } from "react";
import type { IdleWarning } from "./idle";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { clockTime, UserText } from "./ui";

/**
 * The idle timer's warnings (3a design, section 9), in a live region that is always on the page, so a warning is
 * announced when it appears. Before the idle end, "Stay signed in" sends one marked GET /api/staff/me; before the
 * absolute end there is no button, since nothing moves it.
 */
export function IdleNotice({ warning, onStay }: { warning: IdleWarning | null; onStay(): void }) {
  return (
    <div role="status" aria-live="polite" className={warning === null ? "idle" : "idle warning"}>
      {warning?.kind === "idle" ? (
        <>
          <p>Your staff session ends in 2 minutes.</p>
          <button type="button" onClick={onStay}>
            Stay signed in
          </button>
        </>
      ) : null}
      {warning?.kind === "absolute" ? <p>{`Your staff session ends at ${clockTime(warning.endsAt)}. Sign in again with your staff key then.`}</p> : null}
    </div>
  );
}

/** The console's name, alone: the frame of the pages shown without a session. */
export function Masthead() {
  return (
    <header className="masthead">
      <h1>korbat staff console</h1>
    </header>
  );
}

/** The frame of every page behind a session: who is signed in, the console's pages, sign-out and the idle warnings. */
export function Layout({
  me,
  path,
  warning,
  restored = false,
  onNavigate,
  onSignOut,
  onStay,
  children,
}: {
  me: StaffMe;
  path: string;
  warning: IdleWarning | null;
  /** 3f Task 6: an import after a restore ran, so "After a restore" is shown (8.1). */
  restored?: boolean;
  onNavigate(path: ConsolePath): void;
  onSignOut(): void;
  onStay(): void;
  children: ReactNode;
}) {
  return (
    <>
      <header className="masthead">
        <h1>korbat staff console</h1>
        <nav aria-label="Console">
          <NavLink to="/" current={path === "/"} onNavigate={onNavigate}>
            Home
          </NavLink>
          {/* 3f: directly after Home, before the queue: at night it is what the person needs. */}
          <NavLink to="/contact" current={path === "/contact"} onNavigate={onNavigate}>
            Contact point
          </NavLink>
          <NavLink to="/orders" current={path === "/orders" || path.startsWith("/orders/")} onNavigate={onNavigate}>
            Orders
          </NavLink>
          {/* 3f Task 6: once an import after a restore ran, beside the orders, whose disablings it takes again first. */}
          {restored ? (
            <NavLink to="/restore" current={path === "/restore"} onNavigate={onNavigate}>
              After a restore
            </NavLink>
          ) : null}
          <NavLink to="/queue" current={path === "/queue"} onNavigate={onNavigate}>
            Queue
          </NavLink>
          <NavLink to="/appeals" current={path === "/appeals"} onNavigate={onNavigate}>
            Appeals
          </NavLink>
          <NavLink to="/standing" current={path === "/standing"} onNavigate={onNavigate}>
            Standing
          </NavLink>
          <NavLink to="/audit" current={path === "/audit"} onNavigate={onNavigate}>
            Audit log
          </NavLink>
        </nav>
        <p className="who">
          <UserText>{me.handle}</UserText>, {me.role}
        </p>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <IdleNotice warning={warning} onStay={onStay} />
      <main>{children}</main>
    </>
  );
}
