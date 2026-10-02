import type { AuditEntry } from "@korbat/contracts";
import { useEffect, useMemo, useState } from "react";
import type { StaffApi } from "../api";
import { AUDIT_PAGE_LOADING, createAuditPager, createAuditReader, parsePlace, type AuditPageView } from "../audit-log";
import { dateTimeSeconds, Loaded, UserText, type Loadable } from "../ui";

/**
 * The audit log (3a design, sections 2 and 9): a table, newest first, "Load older", and "Go to place", which opens the
 * page whose newest row is at a place the keeper kept. Until 3d publishes the head, the keeper copies the newest place and
 * hash from here each day and opens the place kept the visit before to check that it still shows the same hash.
 */
export interface AuditViewProps {
  /** Every row read so far, newest first. */
  page: Loadable<AuditEntry[]>;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** The place the page was opened at with Go to place, or null for the newest rows. */
  at: number | null;
  place: string;
  placeError: string | null;
  error: string | null;
  onLoadOlder(): void;
  onPlace(text: string): void;
  onGoToPlace(): void;
  onNewest(): void;
}

const PLACE_RULE = "Enter a place: a whole number from 1.";

/**
 * What the page says about the place it was opened at, once its rows have arrived. The reader answers a place with the
 * page whose newest row is at or before it, and a place beyond the newest row with the newest page, so a first row at
 * another place means there is no row at the place asked for: the clearest sign that rows were removed or the server
 * restored, which the page says rather than naming the page after a place it does not hold.
 */
function placeNotice(at: number | null, page: Loadable<AuditEntry[]>) {
  if (at === null || page.state !== "ready") return null;
  const first = page.value[0]?.seq;
  if (first === at) return <p className="quiet">{`From place ${at}, newest first.`}</p>;
  const nearest = first === undefined ? "The audit log holds no rows." : `The nearest row before it is at place ${first}.`;
  return (
    <p role="alert" className="error">
      {`There is no row at place ${at}. ${nearest} If you kept place ${at}, tell the operator: rows may have been removed, or the server restored from a backup.`}
    </p>
  );
}

export function AuditView({ page, hasOlder, loadingOlder, at, place, placeError, error, onLoadOlder, onPlace, onGoToPlace, onNewest }: AuditViewProps) {
  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title">Audit log</h2>
      <p className="hint">
        Every staff action, newest first. Each row's hash covers every row before it, so a row changed later changes every hash after it. Each day the
        keeper copies the newest place and hash, and opens the place kept on the previous visit with Go to place to check that it still shows the same hash.
      </p>

      <form
        className="place"
        onSubmit={(event) => {
          event.preventDefault();
          onGoToPlace();
        }}
      >
        <label htmlFor="place">Place</label>
        <input
          id="place"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={place}
          aria-invalid={placeError !== null}
          aria-describedby={placeError ? "place-error" : undefined}
          onChange={(event) => onPlace(event.target.value)}
        />
        <button type="submit">Go to place</button>
        {at !== null ? (
          <button type="button" onClick={onNewest}>
            Newest
          </button>
        ) : null}
      </form>
      {placeError ? (
        <p id="place-error" className="error">
          {placeError}
        </p>
      ) : null}
      {placeNotice(at, page)}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <Loaded
        value={page}
        render={(entries) =>
          entries.length === 0 ? (
            <p>The audit log holds no rows.</p>
          ) : (
            <div className="scroll">
              <table className="audit">
                <caption className="visually-hidden">The audit log, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Place</th>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Confirmed action</th>
                    <th scope="col">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.seq}>
                      <td>{entry.seq}</td>
                      <td>
                        <time dateTime={entry.createdAt}>{dateTimeSeconds(entry.createdAt)}</time>
                      </td>
                      <td>{entry.actorHandle === null ? "no handle" : <UserText>{entry.actorHandle}</UserText>}</td>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>
                        {entry.targetType === null ? null : (
                          <>
                            <code>{entry.targetType}</code> <UserText>{entry.targetId ?? ""}</UserText>
                          </>
                        )}
                      </td>
                      <td>{entry.actionHash === null ? null : <code className="hash">{entry.actionHash}</code>}</td>
                      <td>
                        <code className="hash">{entry.hash}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      />
      {hasOlder ? (
        <button type="button" onClick={onLoadOlder} disabled={loadingOlder} aria-busy={loadingOlder}>
          Load older
        </button>
      ) : null}
    </section>
  );
}

export function Audit({ api }: { api: StaffApi }) {
  const reader = useMemo(() => createAuditReader(api), [api]);
  const [view, setView] = useState<AuditPageView>(AUDIT_PAGE_LOADING);
  // Each answer is shown only on the page it was asked for (createAuditPager).
  const pager = useMemo(() => createAuditPager(reader, setView), [reader]);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);

  useEffect(() => {
    void pager.newest();
    return () => pager.stop();
  }, [pager]);

  const goToPlace = () => {
    const target = parsePlace(place);
    if (target === null) {
      setPlaceError(PLACE_RULE);
      return;
    }
    setPlaceError(null);
    void pager.at(target);
  };

  return (
    <AuditView
      page={view.page}
      hasOlder={view.cursor !== null}
      loadingOlder={view.loadingOlder}
      at={view.at}
      place={place}
      placeError={placeError}
      error={view.error}
      onLoadOlder={() => void pager.older()}
      onPlace={setPlace}
      onGoToPlace={goToPlace}
      onNewest={() => void pager.newest()}
    />
  );
}
