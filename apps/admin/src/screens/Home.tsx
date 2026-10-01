import type { AuditEntry, StaffKey, StaffMe, StaffSession } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError } from "../messages";
import { readSignInsAtOpening } from "../signins";
import { revokeSessionWithKey } from "../step-up";
import { clockTime, dateTime, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";

/**
 * The home screen (3a design, section 9): who is signed in and with which role, the session's absolute end, every staff
 * account's sign-ins of the last 7 days, the person's own staff sessions with "Sign out that session" confirmed by the
 * key, and the person's keys. Keys are added and revoked only with the command line, so no button here touches them.
 */
export interface HomeViewProps {
  me: StaffMe;
  signIns: Loadable<AuditEntry[]>;
  sessions: Loadable<StaffSession[]>;
  keys: Loadable<StaffKey[]>;
  /** The handle of the session whose revocation is under way. */
  revoking: string | null;
  notice: string | null;
  error: string | null;
  onRevoke(handle: string): void;
}

export function HomeView({ me, signIns, sessions, keys, revoking, notice, error, onRevoke }: HomeViewProps) {
  return (
    <section aria-labelledby="home-title">
      <h2 id="home-title">Home</h2>
      <p>
        Signed in as <UserText>{me.handle}</UserText>, {me.role}.
      </p>
      <p>{`Signed in until ${clockTime(me.absoluteExpiresAt)}.`}</p>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <h3>Staff sign-ins in the last 7 days</h3>
      <p className="hint">Every staff account's, newest first. A sign-in nobody recognises means someone else holds a staff key: tell the operator.</p>
      <Loaded
        value={signIns}
        render={(list) =>
          list.length === 0 ? (
            <p>No staff sign-ins in the last 7 days.</p>
          ) : (
            <ul className="signins">
              {list.map((entry) => (
                <li key={entry.seq}>
                  <time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time> <UserText>{entry.actorHandle ?? "no handle"}</UserText>
                </li>
              ))}
            </ul>
          )
        }
      />

      <h3>Your staff sessions</h3>
      <p className="hint">Signing out another session asks your staff key to confirm it.</p>
      <Loaded
        value={sessions}
        render={(list) => (
          <table>
            <caption className="visually-hidden">Your staff sessions</caption>
            <thead>
              <tr>
                <th scope="col">Browser</th>
                <th scope="col">Started</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Sign out</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((session) => (
                <tr key={session.handle}>
                  <td>
                    <UserText>{session.browser}</UserText>
                  </td>
                  <td>{dateTime(session.createdAt)}</td>
                  <td>{dateTime(session.lastUsedAt)}</td>
                  <td>
                    {session.current ? (
                      "This session"
                    ) : (
                      <button type="button" onClick={() => onRevoke(session.handle)} disabled={revoking !== null} aria-busy={revoking === session.handle}>
                        Sign out that session
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />

      <h3>Your staff keys</h3>
      <p className="hint">The operator adds and revokes staff keys with the staff command line.</p>
      <Loaded
        value={keys}
        render={(list) => (
          <ul className="keys">
            {list.map((key) => (
              <li key={key.id}>
                <UserText>{key.name}</UserText>
                {`: added ${dateTime(key.createdAt)}, ${key.lastUsedAt === null ? "never used" : `last used ${dateTime(key.lastUsedAt)}`}`}
              </li>
            ))}
          </ul>
        )}
      />

      <p className="later">Cases arrive in sub-project 3c.</p>
    </section>
  );
}

/** Runs one read and hands its outcome to `set`, unless the screen has gone meanwhile. */
function load<T>(alive: { current: boolean }, set: (value: Loadable<T>) => void, read: () => Promise<T>): void {
  read().then(
    (value) => alive.current && set({ state: "ready", value }),
    (err: unknown) => alive.current && set({ state: "failed", message: describeError(err) }),
  );
}

/** The person's staff sessions, marked: the screen reads them when it opens and after a revocation the person asked for. */
function readSessions(api: StaffApi, alive: { current: boolean }, set: (value: Loadable<StaffSession[]>) => void): void {
  load(alive, set, async () => (await api.sessions({ activity: true })).sessions);
}

/** Where the screen's three lists go as each read finishes. */
export interface HomeLists {
  signIns(value: Loadable<AuditEntry[]>): void;
  sessions(value: Loadable<StaffSession[]>): void;
  keys(value: Loadable<StaffKey[]>): void;
}

/**
 * What the screen reads when it opens, every read marked, since opening the screen is its person's action. It takes no
 * session: the sign-ins' 7 days are counted from a /me read now (readSignInsAtOpening), never from the session the page
 * holds, which can be hours old.
 */
export function openHome(api: StaffApi, alive: { current: boolean }, set: HomeLists): void {
  load(alive, set.signIns, () => readSignInsAtOpening(api));
  readSessions(api, alive, set.sessions);
  load(alive, set.keys, async () => (await api.keys({ activity: true })).keys);
}

export function Home({ me, api, credentials }: { me: StaffMe; api: StaffApi; credentials: CredentialsLike }) {
  const [signIns, setSignIns] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [sessions, setSessions] = useState<Loadable<StaffSession[]>>({ state: "loading" });
  const [keys, setKeys] = useState<Loadable<StaffKey[]>>({ state: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    openHome(api, alive, { signIns: setSignIns, sessions: setSessions, keys: setKeys });
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen, never again when the idle timer's reads change `me`; the API client never
    // changes while the page lives.
  }, [api]);

  const revoke = async (handle: string) => {
    setRevoking(handle);
    setNotice(null);
    setError(null);
    try {
      const outcome = await revokeSessionWithKey({ api, credentials }, me.sessionHandle, handle);
      if (!alive.current) return;
      setNotice(outcome === "revoked" ? "That session is signed out." : "That session had already ended.");
      readSessions(api, alive, setSessions);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setRevoking(null);
    }
  };

  return <HomeView me={me} signIns={signIns} sessions={sessions} keys={keys} revoking={revoking} notice={notice} error={error} onRevoke={(handle) => void revoke(handle)} />;
}
