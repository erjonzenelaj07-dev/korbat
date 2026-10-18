import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { SignalApi } from "./enroll";
import { Layout, Masthead } from "./Layout";
import { describeError } from "./messages";
import { NavLink } from "./nav";
import { parseOrderId, type CaseId, type ConsolePath } from "./router";
import { Appeals } from "./screens/Appeals";
import { Audit } from "./screens/Audit";
import { CaseScreen } from "./screens/Case";
import { Contact } from "./screens/Contact";
import { Enroll } from "./screens/Enroll";
import { Home } from "./screens/Home";
import { Order } from "./screens/Order";
import { Orders, type Opened } from "./screens/Orders";
import { Queue } from "./screens/Queue";
import { Restore, type GapToTake } from "./screens/Restore";
import { SignIn } from "./screens/SignIn";
import { Standing } from "./screens/Standing";
import { Unavailable } from "./screens/Unavailable";
import type { ConsoleStore } from "./store";
import type { CredentialsLike } from "./webauthn";

/**
 * The console's page (3a design, section 9): the screen for the address and the session. An enrolment link needs no
 * session; every other page shows sign-in in place while there is none, at its own address, and its own screen after.
 */
export function App({ store, credentials, signal }: { store: ConsoleStore; credentials: CredentialsLike; signal: SignalApi | undefined }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  // 3f: the order just opened, whose page shows once that it was opened (and, after "I cannot tell", what to do).
  const [opened, setOpened] = useState<{ id: string; unsure: boolean } | null>(null);
  // 3f Task 6: the restore gap a case was opened for from After a restore, which the decision confirmed there closes.
  const [gap, setGap] = useState<(GapToTake & { caseId: CaseId }) | null>(null);
  // Whether an import after a restore ever ran, which shows the entry "After a restore" (8.1); read once a session.
  const [restored, setRestored] = useState(false);
  const { api } = store;
  const { session, route } = state;
  const signedIn = session.kind === "signed-in";
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    // Not the person's own action: no activity mark. A failure only leaves the entry out.
    void api.restore().then(
      (view) => alive && setRestored(view.importedAt !== null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, signedIn]);

  if (session.kind === "unavailable") return <Unavailable />;

  if (route.name === "enroll") {
    return (
      <>
        <Masthead />
        <main>
          <Enroll token={route.token} api={api} credentials={credentials} signal={signal} onUnavailable={store.unavailable} />
        </main>
      </>
    );
  }

  if (session.kind !== "signed-in") {
    return (
      <>
        <Masthead />
        <main>
          {session.kind === "checking" ? <p className="quiet">Loading</p> : null}
          {session.kind === "failed" ? (
            <section className="panel">
              <p role="alert" className="error">
                {session.message}
              </p>
              <button type="button" onClick={() => void store.start()}>
                Try again
              </button>
            </section>
          ) : null}
          {session.kind === "signed-out" ? <SignIn ended={session.ended} api={api} credentials={credentials} onSignedIn={store.signedIn} onUnavailable={store.unavailable} /> : null}
        </main>
      </>
    );
  }

  const signOut = async () => {
    setSignOutError(null);
    try {
      await api.signOut({ activity: true });
      store.signedOut();
    } catch (err) {
      // A session that had already ended has shown sign-in through the 401; any other failure leaves the session as it was.
      if (!(err instanceof ApiError && err.code === "staff_session_required")) setSignOutError(describeError(err));
    }
  };

  /** An order opened from the form: its page, which says once that it was opened. */
  const onOpened = (done: Opened) => {
    const id = parseOrderId(done.view.id);
    if (id === null) return;
    setOpened({ id, unsure: done.unsure });
    store.openOrder(id);
  };

  const navigate = (path: ConsolePath) => {
    setSignOutError(null);
    store.navigate(path);
  };

  return (
    <Layout me={session.me} path={state.path} warning={state.warning} restored={restored} onNavigate={navigate} onSignOut={() => void signOut()} onStay={() => void store.stay()}>
      {signOutError ? (
        <p role="alert" className="error">
          {signOutError}
        </p>
      ) : null}
      {route.name === "home" || route.name === "signin" ? <Home me={session.me} api={api} credentials={credentials} onOpenCase={store.openCase} onNavigate={navigate} onOpenOrder={store.openOrder} /> : null}
      {route.name === "audit" ? <Audit api={api} credentials={credentials} /> : null}
      {route.name === "queue" ? <Queue api={api} onOpenCase={store.openCase} /> : null}
      {/* Keyed by the case: another case's page starts with nothing of this one's. */}
      {route.name === "case" ? (
        <CaseScreen
          key={route.id}
          id={route.id}
          api={api}
          credentials={credentials}
          role={session.me.role}
          drafts={store.drafts}
          onOpenCase={store.openCase}
          onOpenOrder={store.openOrder}
          gap={gap !== null && gap.caseId === route.id ? gap : null}
          onGapTaken={() => setGap(null)}
        />
      ) : null}
      {route.name === "appeals" ? <Appeals api={api} onOpenCase={store.openCase} /> : null}
      {route.name === "standing" ? <Standing api={api} onOpenCase={store.openCase} /> : null}
      {route.name === "contact" ? <Contact api={api} me={session.me} onOpened={onOpened} onOpenOrder={store.openOrder} /> : null}
      {route.name === "orders" ? <Orders api={api} me={session.me} onOpenOrder={store.openOrder} onOpened={onOpened} /> : null}
      {/* Keyed by the order: another order's page starts with nothing of this one's. */}
      {route.name === "order" ? (
        <Order key={route.id} id={route.id} api={api} me={session.me} credentials={credentials} opened={opened !== null && opened.id === route.id ? { unsure: opened.unsure } : null} onOpenCase={store.openCase} />
      ) : null}
      {route.name === "restore" ? (
        <Restore
          api={api}
          credentials={credentials}
          role={session.me.role}
          onOpenCase={(id, taken) => {
            setGap({ ...taken, caseId: id });
            store.openCase(id);
          }}
          onOpenOrder={store.openOrder}
        />
      ) : null}
      {route.name === "unknown" ? (
        <section aria-labelledby="unknown-title">
          <h2 id="unknown-title">No such page</h2>
          <p>There is no page at this address.</p>
          <p>
            <NavLink to="/" onNavigate={navigate}>
              Go to the home page
            </NavLink>
          </p>
        </section>
      ) : null}
    </Layout>
  );
}
