import { MEASURES, type AppealRow } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { APPEAL_WORDS, describeError, RELEASE_WORDS, STANDING_WORDS } from "../messages";
import { CaseLink } from "../nav";
import { parseCaseId, type CaseId } from "../router";
import { dateTime, Loaded, type Loadable } from "../ui";

/**
 * The appeals screen (3c design, sections 7.7 and 8): the appeals no review has answered yet, newest first, each with
 * its case, the decision it appeals, the end of that decision's appeal window, and whether the reading person may
 * review it. It shows no statement: what an appellant wrote is read on the case's page, whose read is logged and
 * counted. Everything a row shows is a time, a rule's id, a measure's label or one of the console's own sentences.
 */

/** What the decision of a row did, in the composer's labels for its measures. */
const actionsOf = (row: AppealRow): string => row.actions.map((kind) => MEASURES[kind].label).join(", ");

/** The marks of a row: whether this person may review it, whether its review is an admin's, and whether nobody may review it now. */
export function marksOf(row: AppealRow): string[] {
  const marks: string[] = [row.mayReview ? APPEAL_WORDS.mayReview : APPEAL_WORDS.mayNotReview];
  if (row.needsAdmin) marks.push(APPEAL_WORDS.needsAdmin);
  if (row.reviewer !== "available") marks.push(APPEAL_WORDS.reviewer[row.reviewer]);
  return marks;
}

export interface AppealsViewProps {
  rows: Loadable<AppealRow[]>;
  /** Whether the API named a further page. */
  more: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  onOpenCase(id: CaseId): void;
}

export function AppealsView({ rows, more, loadingMore, onLoadMore, onOpenCase }: AppealsViewProps) {
  return (
    <section aria-labelledby="appeals-title">
      <h2 id="appeals-title">Appeals</h2>
      <p className="hint">{`${APPEAL_WORDS.reviewerRule} ${APPEAL_WORDS.statementOnCase}`}</p>
      {/* 3e Task 4 (8.5): [appeals.order] */}
      <p className="hint">{STANDING_WORDS.appealsOrder}</p>
      <Loaded
        value={rows}
        render={(list) =>
          list.length === 0 ? (
            <p>No appeal waits.</p>
          ) : (
            <div className="scroll">
              <table className="queue">
                <caption className="visually-hidden">Appeals that wait for a review</caption>
                <thead>
                  <tr>
                    <th scope="col">Filed</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Its appeal window ends</th>
                    <th scope="col">Review</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => {
                    const id = parseCaseId(row.caseId);
                    return (
                      <tr key={row.id}>
                        <td>
                          <time dateTime={row.filedAt}>{dateTime(row.filedAt)}</time>
                        </td>
                        <td>
                          {`Decided ${dateTime(row.decidedAt)}, ${row.legal ? "on the law" : `under ${row.ruleId ?? "a rule"}`}: ${actionsOf(row)}`}
                        </td>
                        <td>
                          <time dateTime={row.deadline}>{dateTime(row.deadline)}</time>
                        </td>
                        <td>
                          {[...(row.standingFirst ? [`${STANDING_WORDS.appealsFirst}.`] : []), ...marksOf(row)].join(" ")}
                          {/* 3d Task 2 [appeals.released] (8.7): the appeal of a seal whose posts were released stays open. */}
                          {row.released ? <p className="notice">{RELEASE_WORDS.appealReleased(dateTime(row.released.at), row.released.basis)}</p> : null}
                        </td>
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
    </section>
  );
}

/**
 * Reads the list from its start through as many pages as the screen shows, one after the other. Each read is its
 * person's own: the screen is opened, or "Load more" clicked; the list never reads itself again on a timer.
 */
export async function readAppeals(api: StaffApi, pages: number): Promise<{ rows: AppealRow[]; next: string | null }> {
  const rows: AppealRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < Math.max(1, pages); page++) {
    const answer = await api.appeals(cursor, { activity: true });
    rows.push(...answer.appeals);
    cursor = answer.nextCursor;
    if (cursor === null) break;
  }
  return { rows, next: cursor };
}

export function Appeals({ api, onOpenCase }: { api: StaffApi; onOpenCase(id: CaseId): void }) {
  const [rows, setRows] = useState<Loadable<AppealRow[]>>({ state: "loading" });
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    readAppeals(api, 1).then(
      (answer) => {
        if (!alive.current) return;
        setRows({ state: "ready", value: answer.rows });
        setNext(answer.next);
      },
      (err: unknown) => alive.current && setRows({ state: "failed", message: describeError(err) }),
    );
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen; the API client never changes while the page lives.
  }, [api]);

  const loadMore = async () => {
    if (next === null || rows.state !== "ready") return;
    setLoadingMore(true);
    try {
      const answer = await api.appeals(next, { activity: true });
      if (!alive.current) return;
      setRows({ state: "ready", value: [...rows.value, ...answer.appeals] });
      setNext(answer.nextCursor);
    } catch (err) {
      if (alive.current) setRows({ state: "failed", message: describeError(err) });
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  return <AppealsView rows={rows} more={next !== null} loadingMore={loadingMore} onLoadMore={() => void loadMore()} onOpenCase={onOpenCase} />;
}
