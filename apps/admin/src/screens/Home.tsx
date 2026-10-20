import { ORDER_RULES, OVERVIEW_LIST_MAX, QUARANTINE_RULES, type AuditEntry, type StaffKey, type StaffMe, type StaffOverview, type StaffSession } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { APPEAL_WORDS, CUSTODY_WORDS, describeError, ORDER_WORDS, PROTECTION_LIFTED_WORDS, RECOVERY_WORDS, STANDING_WORDS } from "../messages";
import { CaseLink, NavLink, OrderLink } from "../nav";
import { parseCaseId, parseOrderId, type CaseId, type ConsolePath, type OrderId } from "../router";
import { readSignInsAtOpening } from "../signins";
import { revokeSessionWithKey } from "../step-up";
import { bothTimes, clockTime, dateTime, Loaded, UserText, type Loadable } from "../ui";
import type { ReactNode } from "react";
import type { CredentialsLike } from "../webauthn";
import { counted, LANE_NAMES, waited } from "../words";

/**
 * One of the home screen's lists of the path for child sexual abuse material: each row with its time, its staff handle
 * as text, a link to its case built from a checked id, and the console's own words for what the row is. A list holds at
 * most OVERVIEW_LIST_MAX rows, and says how many there are when there are more.
 */
function StaffList<T extends { at: string; handle: string; caseId: string }>({ title, hint, empty, list, words, onOpenCase }: { title: string; hint: string; empty: string; list: { total: number; items: T[] }; words(item: T): ReactNode; onOpenCase(id: CaseId): void }) {
  return (
    <>
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      {list.items.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul className="reveals">
          {list.items.map((item, index) => {
            const id = parseCaseId(item.caseId);
            return (
              <li key={`${item.at} ${item.caseId} ${index}`}>
                <time dateTime={item.at}>{dateTime(item.at)}</time> <UserText>{item.handle}</UserText>{" "}
                {id ? (
                  <CaseLink id={id} onOpen={onOpenCase}>
                    the case
                  </CaseLink>
                ) : null}{" "}
                {words(item)}
              </li>
            );
          })}
        </ul>
      )}
      {list.total > list.items.length ? <p>{`Showing the newest ${OVERVIEW_LIST_MAX} of ${list.total}.`}</p> : null}
    </>
  );
}

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
 * The runbook's sentence for a count of late erasures, in the words of the runbook's own bullet (3c design, section 13,
 * Task 12(a)), a constant of its own for the same reason as the one above.
 */
export const ERASURE_OVERDUE_RUNBOOK =
  "A count of late erasures names the due rule whose step keeps failing, so evidence, an intake record or a notifier's name and address outlives its published period: read the API log for moderation-retention and for auth janitor: purge failed, and check that API_MODERATION_RETENTION was not left off after a restore (the API logs it at every start).";

/** What each count of late erasures counts, in the order the retention job's steps run; the two last are the image rows and the auth janitor's. */
export const ERASURE_OVERDUE_WORDS: Record<keyof StaffOverview["erasureOverdue"], string> = {
  drafts: "unconfirmed drafts",
  caseEvidence: "closed cases whose evidence is due",
  intakeRecords: "records of reports and notices",
  redactions: "R4 erasures",
  statements: "statements of deleted accounts",
  accessLog: "access log rows",
  images: "image rows nothing retains",
  contacts: "notifiers' contacts and confirmations",
};

/**
 * The home screen's line for what retention is late with by more than a day: each count above zero under its own words,
 * then the runbook's sentence. Null when nothing is late, and then the screen says nothing.
 */
export function erasureOverdue(counts: StaffOverview["erasureOverdue"]): string | null {
  const late = (Object.keys(ERASURE_OVERDUE_WORDS) as (keyof StaffOverview["erasureOverdue"])[]).filter((key) => counts[key] > 0).map((key) => `${ERASURE_OVERDUE_WORDS[key]}: ${counts[key]}`);
  return late.length === 0 ? null : `Erasures more than a day late: ${late.join("; ")}. ${ERASURE_OVERDUE_RUNBOOK}`;
}

/**
 * What every staff member sees of the cases (3c design, section 8): the lanes with their open cases and how long the
 * oldest has waited, the appeals waiting (with those this person may review and those nobody may review now), every reveal of a source in the last 30 days with its staff handle and its
 * case, the decisions that lifted the protection of reported images, the recorded choices not to seal and the seals
 * taken while deciding that are in force, what each staff account viewed and opened today, the mails that wait or were
 * given up, and the emergency switch. Counts, times, handles and case links only.
 */
/**
 * The home screen's appeals line (3c design, section 8): how many wait, how many of them the reading person may review,
 * and how many no staff account may review now.
 */
export function appealsLine(overview: Pick<StaffOverview, "appealsWaiting" | "appealsYouMayReview" | "appealsWithoutReviewer">): string {
  const { appealsWaiting: waiting, appealsYouMayReview: yours, appealsWithoutReviewer: without } = overview;
  if (waiting === 0) return "No appeal waits.";
  const parts = [waiting === 1 ? "1 appeal waits" : `${waiting} appeals wait`, `you may review ${yours === 0 ? "none" : yours}`];
  if (without > 0) parts.push(`${without} ${without === 1 ? "has" : "have"} no possible reviewer now`);
  return `${parts.join("; ")}.`;
}

/**
 * 3e Task 4 (design, section 8.8): the home screen's two lines, each shown when above zero and each a link to its list:
 * the replies waiting, with the oldest one's age, and the accounts at the ladder's number of strikes. Without a way to
 * move between pages (a test's rendering), each is plain text.
 */
function StandingLines({ overview, now, onNavigate }: { overview: StaffOverview; now: number; onNavigate?: (path: ConsolePath) => void }) {
  const { repliesWaiting, strikeAccounts } = overview;
  const line = (text: string, to: ConsolePath) => (onNavigate ? <NavLink to={to} onNavigate={onNavigate}>{text}</NavLink> : text);
  return (
    <>
      {repliesWaiting.count > 0 ? <p>{line(STANDING_WORDS.home.replies(repliesWaiting.count, repliesWaiting.oldestAt === null ? "" : waited(repliesWaiting.oldestAt, now)), "/queue")}</p> : null}
      {strikeAccounts > 0 ? <p>{line(STANDING_WORDS.home.strikes(strikeAccounts), "/standing")}</p> : null}
    </>
  );
}

/**
 * 3f (design, section 8.2): the block "Authorities" above the lanes, each line only while it applies, in the design's
 * order: mail at the contact point that nobody has handled, with a link to Contact point inside its sentence, and the
 * alert channel's state when it is not ok. Without a way to move between pages (a test's rendering), the link is text.
 */
export function AuthoritiesLines({
  overview,
  now = Date.now(),
  onNavigate,
  onOpenOrder,
  onOpenCase,
}: {
  overview: StaffOverview;
  now?: number;
  onNavigate?: (path: ConsolePath) => void;
  onOpenOrder?: (id: OrderId) => void;
  onOpenCase?: (id: CaseId) => void;
}) {
  const W = ORDER_WORDS.home;
  const { contact, alerts } = overview;
  const since = alerts.since === null ? "" : bothTimes(alerts.since);
  const lines: ReactNode[] = [];
  if (contact.open > 0 && contact.oldestAt !== null) {
    const words = W.contact(bothTimes(contact.oldestAt), contact.open);
    lines.push(
      <p key="contact" className="error">
        {words.before}
        {onNavigate ? (
          <NavLink to="/contact" onNavigate={onNavigate}>
            {words.link}
          </NavLink>
        ) : (
          words.link
        )}
        {words.after}
      </p>,
    );
  }
  // Task 2: the nearest deadline of a message or of an order with an open item, ahead with its minutes left (a link to
  // Orders), or passed.
  if (contact.dueAt !== null) {
    const due = Date.parse(contact.dueAt);
    if (due > now) {
      const text = ORDER_WORDS.homeClock(bothTimes(contact.dueAt), Math.ceil((due - now) / 60_000));
      lines.push(
        <p key="clock" className="notice">
          {onNavigate ? (
            <NavLink to="/orders" onNavigate={onNavigate}>
              {text}
            </NavLink>
          ) : (
            text
          )}
        </p>,
      );
    } else {
      lines.push(
        <p key="overdue" className="error">
          {ORDER_WORDS.homeOverdue(bothTimes(contact.dueAt))}
        </p>,
      );
    }
  }
  // Task 5: [home.owed], one line a case, each a link built from its checked id; after reportAlertHours the daily alert's
  // sentence too. In the design's order, before [home.unverified].
  for (const owed of overview.reportsOwed.items) {
    const id = parseCaseId(owed.caseId);
    const late = now - Date.parse(owed.since) > ORDER_RULES.reportAlertHours * 3_600_000;
    const words = ORDER_WORDS.homeOwed(bothTimes(owed.since), late);
    lines.push(
      <p key={`owed-${owed.caseId}`} className={late ? "error" : "notice"}>
        {id !== null && onOpenCase !== undefined ? (
          <CaseLink id={id} onOpen={onOpenCase}>
            {words}
          </CaseLink>
        ) : (
          words
        )}
      </p>,
    );
  }
  // Task 3: [home.unverified], each order a link built from its checked id.
  const unverified = overview.ordersUnverified;
  if (unverified.total > 0) {
    lines.push(
      <div key="unverified">
        <p className="notice">{ORDER_WORDS.homeUnverified(unverified.total)}</p>
        <ul className="plain">
          {unverified.items.map((item) => {
            const id = parseOrderId(item.orderId);
            const words = `Given effect at ${bothTimes(item.effectAt)}`;
            return <li key={item.orderId}>{id !== null && onOpenOrder !== undefined ? <OrderLink id={id} onOpen={onOpenOrder}>{words}</OrderLink> : words}</li>;
          })}
        </ul>
      </div>,
    );
  }
  if (alerts.channel === "down") lines.push(<p key="channel" className="error">{W.channel(since)}</p>);
  if (alerts.channel === "mailbox") lines.push(<p key="mailbox" className="error">{W.mailbox(since)}</p>);
  if (alerts.channel === "off") lines.push(<p key="off" className="notice">{W.off}</p>);
  // Task 6 (8.2): [home.copy] while the newest copy of the audit log's tail is older than copyOverdueHours, by its days;
  // and [home.restore] while gaps a restore left are open, a link to After a restore.
  if (overview.copy.overdue) {
    const days = overview.copy.newestAt === null ? null : Math.floor((now - Date.parse(overview.copy.newestAt)) / 86_400_000);
    lines.push(
      <p key="copy" className="notice">
        {days === null ? RECOVERY_WORDS.homeCopyNone : RECOVERY_WORDS.homeCopy(days)}
      </p>,
    );
  }
  if (overview.restore.open > 0) {
    const words = RECOVERY_WORDS.homeRestore(overview.restore.open, overview.restore.measures);
    lines.push(
      <p key="restore" className="error">
        {onNavigate ? (
          <NavLink to="/restore" onNavigate={onNavigate}>
            {words}
          </NavLink>
        ) : (
          words
        )}
      </p>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div role="status" className="authorities">
      <h3>{W.title}</h3>
      {lines}
    </div>
  );
}

/**
 * 3d (design, section 8.2): the block "Sealed files and programs" below "Authorities", each line only while it applies,
 * in the design's order. Task 1: [home.quarantine], while a move of sealed files into the quarantine or back to the image
 * store is due, from the four values of quarantine_counts(); once the oldest due move is older than the alert's threshold
 * it says that every staff account is alerted daily.
 */
export function CustodyLines({ overview, now = Date.now() }: { overview: StaffOverview; now?: number }) {
  const { quarantine } = overview;
  const lines: ReactNode[] = [];
  if ((quarantine.dueIn > 0 || quarantine.dueOut > 0) && quarantine.oldest !== null) {
    const late = now - Date.parse(quarantine.oldest) > QUARANTINE_RULES.dueHours * 3_600_000;
    lines.push(
      <p key="quarantine" className={late ? "error" : "notice"}>
        {CUSTODY_WORDS.homeQuarantine(quarantine.dueIn, quarantine.dueOut, bothTimes(quarantine.oldest))}
        {late ? ` ${CUSTODY_WORDS.homeQuarantineLate}` : ""}
      </p>,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div role="status" className="authorities">
      <h3>{CUSTODY_WORDS.homeTitle}</h3>
      {lines}
    </div>
  );
}

export function OverviewView({
  overview,
  now,
  onOpenCase,
  onNavigate,
  onOpenOrder,
}: {
  overview: StaffOverview;
  now: number;
  onOpenCase(id: CaseId): void;
  onNavigate?: (path: ConsolePath) => void;
  onOpenOrder?: (id: OrderId) => void;
}) {
  const { reveals, mailsWaiting, mailsFailed } = overview;
  const lateErasures = erasureOverdue(overview.erasureOverdue);
  const waiting = mailsWaiting.receipts + mailsWaiting.authorMails + mailsWaiting.outcomes;
  const failed = mailsFailed.receipts + mailsFailed.authorMails + mailsFailed.outcomes;
  const mails = (m: StaffOverview["mailsWaiting"]) => `${counted(m.receipts, "receipt", "receipts")}, ${counted(m.authorMails, "statement to an author", "statements to authors")}, ${counted(m.outcomes, "outcome", "outcomes")}`;
  return (
    <>
      <AuthoritiesLines overview={overview} now={now} onOpenCase={onOpenCase} {...(onNavigate === undefined ? {} : { onNavigate })} {...(onOpenOrder === undefined ? {} : { onOpenOrder })} />
      <CustodyLines overview={overview} now={now} />
      <h3>Cases</h3>
      <ul className="lanes">
        {overview.lanes.map((lane) => (
          <li key={lane.lane}>{`${LANE_NAMES[lane.lane]}: ${lane.open === 0 || lane.oldestAt === null ? "no open case" : `${counted(lane.open, "case", "cases")}, oldest ${waited(lane.oldestAt, now)}`}`}</li>
        ))}
      </ul>
      <p>{appealsLine(overview)}</p>
      {overview.appealsWaiting > 0 ? <p className="hint">{APPEAL_WORDS.reviewerRule}</p> : null}
      <StandingLines overview={overview} now={now} onNavigate={onNavigate} />
      <p>{overview.deferUnproven ? "The emergency switch is on: cases whose unanswered items all come from unproven sources are listed after the others of their lane." : "The emergency switch is off."}</p>
      {overview.releaseOverdue > 0 ? (
        <p role="alert" className="error">
          {releaseOverdue(overview.releaseOverdue)}
        </p>
      ) : null}
      {lateErasures !== null ? (
        <p role="alert" className="error">
          {lateErasures}
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

      <StaffList
        title="Protection of reported images lifted in the last 30 days"
        hint="Every staff account's: each lifted seal, and each admin's answer to a report or finding of child sexual abuse material without a seal. One nobody expected means someone else holds a staff key: tell the operator."
        empty="No decision lifted the protection of reported images in the last 30 days."
        list={overview.protectionLifted}
        words={(item) => PROTECTION_LIFTED_WORDS[item.kind]}
        onOpenCase={onOpenCase}
      />
      <StaffList
        title="Choices not to seal in the last 30 days"
        hint="Every staff account's: each recorded choice not to seal reported images, whose reason is on its case."
        empty="Nobody recorded a choice not to seal in the last 30 days."
        list={overview.sealsDeclined}
        words={() => "Chose not to seal"}
        onOpenCase={onOpenCase}
      />
      <StaffList
        title="Seals taken while deciding that are in force"
        hint="Which images stand sealed until an admin answers, and by whom."
        empty="No seal taken while deciding is in force."
        list={overview.interimSeals}
        words={(item) => `${counted(item.images, "image", "images")} on ${counted(item.posts, "post", "posts")}`}
        onOpenCase={onOpenCase}
      />

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
  /** 3e: a move to one of the console's pages, which the home screen's lines of Task 4 link to. */
  onNavigate?: (path: ConsolePath) => void;
  /** 3f Task 3: the orders of [home.unverified] link to their pages. */
  onOpenOrder?: (id: OrderId) => void;
  signIns: Loadable<AuditEntry[]>;
  sessions: Loadable<StaffSession[]>;
  keys: Loadable<StaffKey[]>;
  /** The handle of the session whose revocation is under way. */
  revoking: string | null;
  notice: string | null;
  error: string | null;
  onRevoke(handle: string): void;
}

export function HomeView({ me, overview, now, onOpenCase, onNavigate, onOpenOrder, signIns, sessions, keys, revoking, notice, error, onRevoke }: HomeViewProps) {
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

      <Loaded
        value={overview}
        render={(value) => <OverviewView overview={value} now={now} onOpenCase={onOpenCase} {...(onNavigate === undefined ? {} : { onNavigate })} {...(onOpenOrder === undefined ? {} : { onOpenOrder })} />}
      />

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

export function Home({
  me,
  api,
  credentials,
  onOpenCase,
  onNavigate,
  onOpenOrder,
}: {
  me: StaffMe;
  api: StaffApi;
  credentials: CredentialsLike;
  onOpenCase(id: CaseId): void;
  onNavigate?: (path: ConsolePath) => void;
  onOpenOrder?: (id: OrderId) => void;
}) {
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
    <HomeView me={me} overview={overview} now={now} onOpenCase={onOpenCase} onNavigate={onNavigate} {...(onOpenOrder === undefined ? {} : { onOpenOrder })} signIns={signIns} sessions={sessions} keys={keys} revoking={revoking} notice={notice} error={error} onRevoke={(handle) => void revoke(handle)} />
  );
}
