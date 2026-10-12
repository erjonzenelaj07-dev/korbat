import { FINDING_CATEGORIES, FindingRequest, RULE_DEFAULT_CATEGORY, RULE_IDS, type QueueRow, type RuleId, type TdbCategory } from "@korbat/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StaffApi } from "../api";
import { systemClock, type Clock } from "../idle";
import { describeError, FINDING_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { dateTime, Loaded, type Loadable } from "../ui";
import { categoryLabel, counted, LANE_NAMES, waited } from "../words";

/**
 * The queue (3c design, sections 7.3 and 8): open cases by lane and then by age, as the API orders them. Nothing here
 * weighs a case: no count of reports, no standing of a reporter. The page reads the queue again every 60 seconds without
 * the activity mark, so a queue left open never keeps a staff session alive. Beside it, "Open a case" takes a korbat link
 * on the moderator's own finding.
 */

/** How often the queue reads itself again. */
export const QUEUE_REFRESH_MS = 60_000;

/**
 * The screen's reads of the queue, on a clock that is the page's or a test's (as the idle timer's is): one now, marked,
 * since opening the screen is its person's action, and one every QUEUE_REFRESH_MS after it, unmarked, since those are the
 * page's own and must never move the session's idle end. Answers what ends them, for when the screen is left.
 */
export function startQueueReads(clock: Clock, read: (activity: boolean) => void): () => void {
  let handle: unknown = null;
  let ended = false;
  const refresh = () => {
    if (ended) return;
    read(false);
    handle = clock.setTimeout(refresh, QUEUE_REFRESH_MS);
  };
  read(true);
  handle = clock.setTimeout(refresh, QUEUE_REFRESH_MS);
  return () => {
    ended = true;
    clock.clearTimeout(handle);
  };
}

/** What marks a row beyond its lane and age: the console's own words for what its unanswered items are. */
export function marksOf(row: QueueRow): string[] {
  const marks: string[] = [];
  if (row.allegesIllegal) marks.push("notice under Art. 16");
  if (row.suspect) marks.push("CSAM: no images");
  if (row.reexamination) marks.push("re-examination");
  if (row.deferred) marks.push("deferred");
  return marks;
}

export interface FindingFormState {
  link: string;
  ruleId: RuleId;
  category: TdbCategory;
  busy: boolean;
  error: string | null;
}

export interface QueueViewProps {
  rows: Loadable<QueueRow[]>;
  /** Whether the API named a further page. */
  more: boolean;
  loadingMore: boolean;
  /** The time the ages are counted to. */
  now: number;
  finding: FindingFormState;
  onLoadMore(): void;
  onOpenCase(id: CaseId): void;
  onFindingChange(change: Partial<Pick<FindingFormState, "link" | "ruleId" | "category">>): void;
  onFindingSubmit(): void;
}

export function QueueView({ rows, more, loadingMore, now, finding, onLoadMore, onOpenCase, onFindingChange, onFindingSubmit }: QueueViewProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFindingSubmit();
  };
  return (
    <section aria-labelledby="queue-title">
      <h2 id="queue-title">Queue</h2>
      <p className="hint">Open cases by lane, then by how long their oldest unanswered item has waited. Nothing else orders them.</p>
      <Loaded
        value={rows}
        render={(list) =>
          list.length === 0 ? (
            <p>No case is open.</p>
          ) : (
            <div className="scroll">
              <table className="queue">
                <caption className="visually-hidden">Open cases</caption>
                <thead>
                  <tr>
                    <th scope="col">Lane</th>
                    <th scope="col">Waiting</th>
                    <th scope="col">About</th>
                    <th scope="col">Cites</th>
                    <th scope="col">Marks</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const id = parseCaseId(row.id);
                    return (
                      <tr key={row.id}>
                        <td>{LANE_NAMES[row.lane]}</td>
                        <td>
                          <time dateTime={row.oldestOpenAt} title={dateTime(row.oldestOpenAt)}>
                            {waited(row.oldestOpenAt, now)}
                          </time>
                          {`, ${counted(row.openItems, "item", "items")}`}
                        </td>
                        <td>{row.targetType === "post" ? "a post" : "an account"}</td>
                        <td>{[...row.rules, ...row.categories.map(categoryLabel)].join(", ")}</td>
                        <td>{marksOf(row).join(", ")}</td>
                        <td>
                          {id ? (
                            <CaseLink id={id} onOpen={onOpenCase}>
                              Open the case
                            </CaseLink>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      />
      {more ? (
        <button type="button" onClick={onLoadMore} disabled={loadingMore} aria-busy={loadingMore}>
          Load more
        </button>
      ) : null}

      <h3 id="finding-title">Open a case</h3>
      <p className="hint">
        On your own finding: give the korbat link of a post or a profile, the rule it breaks and the category. What you write about it is saved as a text on the case. A finding citing R2 freezes
        the images its case reaches until an admin answers.
      </p>
      <form className="panel" onSubmit={submit} aria-labelledby="finding-title">
        <label htmlFor="finding-link">Link on korbat</label>
        <input id="finding-link" type="text" value={finding.link} maxLength={300} autoComplete="off" spellCheck={false} onChange={(event) => onFindingChange({ link: event.target.value })} />
        <label htmlFor="finding-rule">Rule</label>
        <select id="finding-rule" value={finding.ruleId} onChange={(event) => onFindingChange({ ruleId: event.target.value as RuleId })}>
          {RULE_IDS.map((rule) => (
            <option key={rule} value={rule}>
              {rule}
            </option>
          ))}
        </select>
        <label htmlFor="finding-category">Category</label>
        <select id="finding-category" value={finding.category} onChange={(event) => onFindingChange({ category: event.target.value as TdbCategory })}>
          {FINDING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
        {finding.error ? (
          <p role="alert" className="error">
            {finding.error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={finding.busy} aria-busy={finding.busy}>
            Open a case
          </button>
        </div>
      </form>
    </section>
  );
}

/** The finding a form's values make, or null when the link is no web address of at most 300 characters: the contracts' schema decides. */
export function findingOf(form: Pick<FindingFormState, "link" | "ruleId" | "category">): FindingRequest | null {
  const parsed = FindingRequest.safeParse({ target: { kind: "link", url: form.link.trim() }, ground: "rule", ruleId: form.ruleId, category: form.category });
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the queue from its start through as many pages as the screen shows, one after the other. `activity` says whether
 * a person's action started the read: the screen's opening and "Load more" do, its own refresh every minute does not.
 */
export async function readQueue(api: StaffApi, pages: number, activity: boolean): Promise<{ rows: QueueRow[]; next: string | null }> {
  const rows: QueueRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < Math.max(1, pages); page++) {
    const answer = await api.queue(cursor, { activity });
    rows.push(...answer.cases);
    cursor = answer.nextCursor;
    if (cursor === null) break;
  }
  return { rows, next: cursor };
}

export function Queue({ api, onOpenCase, clock = systemClock }: { api: StaffApi; onOpenCase(id: CaseId): void; clock?: Clock }) {
  const [rows, setRows] = useState<Loadable<QueueRow[]>>({ state: "loading" });
  const [next, setNext] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [finding, setFinding] = useState<FindingFormState>({ link: "", ruleId: "R1", category: RULE_DEFAULT_CATEGORY.R1, busy: false, error: null });
  const alive = useRef(true);
  const shown = useRef(1);

  useEffect(() => {
    alive.current = true;
    const read = (activity: boolean) =>
      readQueue(api, shown.current, activity).then(
        (answer) => {
          if (!alive.current) return;
          setRows({ state: "ready", value: answer.rows });
          setNext(answer.next);
          setNow(Date.now());
        },
        // A refresh that fails leaves the list as it was; only the first read shows its failure.
        (err: unknown) => alive.current && activity && setRows({ state: "failed", message: describeError(err) }),
      );
    const stop = startQueueReads(clock, (activity) => void read(activity));
    return () => {
      alive.current = false;
      stop();
    };
    // Read from the opening of the screen on; neither the API client nor the clock changes while the page lives.
  }, [api, clock]);

  const loadMore = async () => {
    if (next === null || rows.state !== "ready") return;
    setLoadingMore(true);
    try {
      const answer = await api.queue(next, { activity: true });
      if (!alive.current) return;
      shown.current = pages + 1;
      setPages(pages + 1);
      setRows({ state: "ready", value: [...rows.value, ...answer.cases] });
      setNext(answer.nextCursor);
    } catch (err) {
      if (alive.current) setRows({ state: "failed", message: describeError(err) });
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  const openFinding = async () => {
    const request = findingOf(finding);
    if (request === null) {
      setFinding((form) => ({ ...form, error: FINDING_WORDS.invalid_request }));
      return;
    }
    setFinding((form) => ({ ...form, busy: true, error: null }));
    try {
      const answer = await api.openFinding(request, { activity: true });
      const id = parseCaseId(answer.caseId);
      if (!alive.current) return;
      setFinding((form) => ({ ...form, busy: false, link: "" }));
      if (id) onOpenCase(id);
    } catch (err) {
      if (alive.current) setFinding((form) => ({ ...form, busy: false, error: describeError(err, FINDING_WORDS) }));
    }
  };

  return (
    <QueueView
      rows={rows}
      more={next !== null}
      loadingMore={loadingMore}
      now={now}
      finding={finding}
      onLoadMore={() => void loadMore()}
      onOpenCase={onOpenCase}
      // Choosing a rule presets its category; the moderator may still choose another.
      onFindingChange={(change) => setFinding((form) => ({ ...form, ...change, ...(change.ruleId ? { category: RULE_DEFAULT_CATEGORY[change.ruleId] } : {}), error: null }))}
      onFindingSubmit={() => void openFinding()}
    />
  );
}
