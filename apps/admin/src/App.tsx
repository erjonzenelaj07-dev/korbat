import { useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { SignalApi } from "./enroll";
import { Layout, Masthead } from "./Layout";
import { describeError } from "./messages";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { Appeals } from "./screens/Appeals";
import { Audit } from "./screens/Audit";
import { CaseScreen } from "./screens/Case";
import { Contact } from "./screens/Contact";
import { Enroll } from "./screens/Enroll";
import { Home } from "./screens/Home";
import { Queue } from "./screens/Queue";
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
  const { api } = store;
  const { session, route } = state;

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

  const navigate = (path: ConsolePath) => {
    setSignOutError(null);
    store.navigate(path);
  };

  return (
    <Layout me={session.me} path={state.path} warning={state.warning} onNavigate={navigate} onSignOut={() => void signOut()} onStay={() => void store.stay()}>
      {signOutError ? (
        <p role="alert" className="error">
          {signOutError}
        </p>
      ) : null}
      {route.name === "home" || route.name === "signin" ? <Home me={session.me} api={api} credentials={credentials} onOpenCase={store.openCase} onNavigate={navigate} /> : null}
      {route.name === "audit" ? <Audit api={api} /> : null}
      {route.name === "queue" ? <Queue api={api} onOpenCase={store.openCase} /> : null}
      {/* Keyed by the case: another case's page starts with nothing of this one's. */}
      {route.name === "case" ? <CaseScreen key={route.id} id={route.id} api={api} credentials={credentials} role={session.me.role} drafts={store.drafts} onOpenCase={store.openCase} /> : null}
      {route.name === "appeals" ? <Appeals api={api} onOpenCase={store.openCase} /> : null}
      {route.name === "standing" ? <Standing api={api} onOpenCase={store.openCase} /> : null}
      {route.name === "contact" ? <Contact api={api} /> : null}
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
