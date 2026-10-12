import { OVERVIEW_LIST_MAX, type AuditEntry, type StaffKey, type StaffMe, type StaffOverview, type StaffSession } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { readSignInsAtOpening } from "../signins";
import { revokeSessionWithKey } from "../step-up";
import { clockTime, dateTime, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";
import { counted, LANE_NAMES, waited } from "../words";

/**
 * The runbook's sentence for a count of decisions not released, in the words of the runbook's own bullet (3c design,
 * section 13, Task 12(a)). It is a constant of its own so that the test of the README's runbook can hold the two to the
 * same words: what the home screen tells staff is what the runbook tells the operator.
 */
export const RELEASE_OVERDUE_RUNBOOK =
  "A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for moderation-dispatch and fix it the same day.";

/** The home screen's line when decided items wait for the daily release longer than it ever takes: the count, then the runbook's sentence for it. */
export const releaseOverdue = (n: number): string => `Decisions not released after 26 hours: ${n}. ${RELEASE_OVERDUE_RUNBOOK}`;

/**
 * What every staff member sees of the cases (3c design, section 8): the lanes with their open cases and how long the
 * oldest has waited, the appeals waiting, every reveal of a source in the last 30 days with its staff handle and its
 * case, what each staff account viewed and opened today, the mails that wait or were given up, and the emergency
 * switch. Counts, times, handles and case links only.
 */
export function OverviewView({ overview, now, onOpenCase }: { overview: StaffOverview; now: number; onOpenCase(id: CaseId): void }) {
  const { reveals, mailsWaiting, mailsFailed } = overview;
  const waiting = mailsWaiting.receipts + mailsWaiting.authorMails + mailsWaiting.outcomes;
  const failed = mailsFailed.receipts + mailsFailed.authorMails + mailsFailed.outcomes;
  const mails = (m: StaffOverview["mailsWaiting"]) => `${counted(m.receipts, "receipt", "receipts")}, ${counted(m.authorMails, "statement to an author", "statements to authors")}, ${counted(m.outcomes, "outcome", "outcomes")}`;
  return (
    <>
      <h3>Cases</h3>
      <ul className="lanes">
        {overview.lanes.map((lane) => (
          <li key={lane.lane}>{`${LANE_NAMES[lane.lane]}: ${lane.open === 0 || lane.oldestAt === null ? "no open case" : `${counted(lane.open, "case", "cases")}, oldest ${waited(lane.oldestAt, now)}`}`}</li>
        ))}
      </ul>
      <p>{overview.appealsWaiting === 1 ? "1 appeal waits." : `${overview.appealsWaiting} appeals wait.`}</p>
      <p>{overview.deferUnproven ? "The emergency switch is on: cases whose unanswered items all come from unproven sources are listed after the others of their lane." : "The emergency switch is off."}</p>
      {overview.releaseOverdue > 0 ? (
        <p role="alert" className="error">
          {releaseOverdue(overview.releaseOverdue)}
        </p>
      ) : null}
      {waiting > 0 ? <p className="notice">{`Mails waiting for more than an hour: ${mails(mailsWaiting)}.`}</p> : null}
      {failed > 0 ? <p className="notice">{`Mails given up in the last 30 days: ${mails(mailsFailed)}.`}</p> : null}

      <h3>Sources revealed in the last 30 days</h3>
      <p className="hint">Every staff account's. A reveal nobody expected means someone else holds a staff key: tell the operator.</p>
      {reveals.items.length === 0 ? (
        <p>No source was revealed in the last 30 days.</p>
      ) : (
        <ul className="reveals">
          {reveals.items.map((item, index) => {
            const id = parseCaseId(item.caseId);
            return (
              <li key={`${item.at} ${item.caseId} ${index}`}>
                <time dateTime={item.at}>{dateTime(item.at)}</time> <UserText>{item.handle}</UserText>{" "}
                {id ? (
                  <CaseLink id={id} onOpen={onOpenCase}>
                    the case
                  </CaseLink>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {reveals.total > reveals.items.length ? <p>{`Showing the newest ${OVERVIEW_LIST_MAX} of ${reveals.total}.`}</p> : null}

      <h3>Today, by staff account</h3>
      {overview.imagesToday.length === 0 && overview.findingsToday.length === 0 ? (
        <p>No image was viewed and no finding opened today.</p>
      ) : (
        <ul className="today">
          {overview.imagesToday.map((row) => (
            <li key={`images ${row.handle}`}>
              <UserText>{row.handle}</UserText>
              {`: ${counted(row.count, "image", "images")} viewed`}
            </li>
          ))}
          {overview.findingsToday.map((row) => (
            <li key={`findings ${row.handle}`}>
              <UserText>{row.handle}</UserText>
              {`: ${counted(row.count, "finding", "findings")} opened`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The home screen (3a design, section 9; 3c design, section 8): who is signed in and with which role, the session's
 * absolute end, the cases' overview, every staff account's sign-ins of the last 7 days, the person's own staff sessions
 * with "Sign out that session" confirmed by the key, and the person's keys. Keys are added and revoked only with the
 * command line, so no button here touches them.
 */
export interface HomeViewProps {
  me: StaffMe;
  overview: Loadable<StaffOverview>;
  /** The time the overview's waiting times are counted to. */
  now: number;
  onOpenCase(id: CaseId): void;
  signIns: Loadable<AuditEntry[]>;
  sessions: Loadable<StaffSession[]>;
  keys: Loadable<StaffKey[]>;
  /** The handle of the session whose revocation is under way. */
  revoking: string | null;
  notice: string | null;
  error: string | null;
  onRevoke(handle: string): void;
}

export function HomeView({ me, overview, now, onOpenCase, signIns, sessions, keys, revoking, notice, error, onRevoke }: HomeViewProps) {
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

      <Loaded value={overview} render={(value) => <OverviewView overview={value} now={now} onOpenCase={onOpenCase} />} />

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

/** Where the screen's lists go as each read finishes. */
export interface HomeLists {
  overview(value: Loadable<StaffOverview>): void;
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
  load(alive, set.overview, () => api.overview({ activity: true }));
  readSessions(api, alive, set.sessions);
  load(alive, set.keys, async () => (await api.keys({ activity: true })).keys);
}

export function Home({ me, api, credentials, onOpenCase }: { me: StaffMe; api: StaffApi; credentials: CredentialsLike; onOpenCase(id: CaseId): void }) {
  const [overview, setOverview] = useState<Loadable<StaffOverview>>({ state: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [signIns, setSignIns] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [sessions, setSessions] = useState<Loadable<StaffSession[]>>({ state: "loading" });
  const [keys, setKeys] = useState<Loadable<StaffKey[]>>({ state: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    openHome(api, alive, {
      overview: (value) => {
        setNow(Date.now());
        setOverview(value);
      },
      signIns: setSignIns,
      sessions: setSessions,
      keys: setKeys,
    });
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
      const outcome = await revokeSessionWithKey({ api, credentials }, handle);
      if (!alive.current) return;
      setNotice(outcome === "revoked" ? "That session is signed out." : "That session had already ended.");
      readSessions(api, alive, setSessions);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setRevoking(null);
    }
  };

  return (
    <HomeView me={me} overview={overview} now={now} onOpenCase={onOpenCase} signIns={signIns} sessions={sessions} keys={keys} revoking={revoking} notice={notice} error={error} onRevoke={(handle) => void revoke(handle)} />
  );
}
