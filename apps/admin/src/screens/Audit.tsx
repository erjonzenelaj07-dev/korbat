import type { AuditEntry, AuditPage } from "@korbat/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { createAuditReader, parsePlace } from "../audit-log";
import { describeError } from "../messages";
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
      {at !== null ? <p className="quiet">{`From place ${at}, newest first.`}</p> : null}
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
  const [page, setPage] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  /** Shows one page from its start: the newest rows, or those from a place. */
  const open = async (read: () => Promise<AuditPage>, opened: number | null) => {
    setPage({ state: "loading" });
    setError(null);
    try {
      const answer = await read();
      if (!alive.current) return;
      setPage({ state: "ready", value: answer.entries });
      setCursor(answer.nextCursor);
      setAt(opened);
    } catch (err) {
      if (alive.current) setPage({ state: "failed", message: describeError(err) });
    }
  };

  useEffect(() => {
    alive.current = true;
    void open(reader.newest, null);
    return () => {
      alive.current = false;
    };
  }, [reader]);

  const loadOlder = async () => {
    if (cursor === null) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const answer = await reader.older(cursor);
      if (!alive.current) return;
      setPage((current) => ({ state: "ready", value: [...(current.state === "ready" ? current.value : []), ...answer.entries] }));
      setCursor(answer.nextCursor);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  };

  const goToPlace = () => {
    const target = parsePlace(place);
    if (target === null) {
      setPlaceError(PLACE_RULE);
      return;
    }
    setPlaceError(null);
    void open(() => reader.at(target), target);
  };

  return (
    <AuditView
      page={page}
      hasOlder={cursor !== null}
      loadingOlder={loadingOlder}
      at={at}
      place={place}
      placeError={placeError}
      error={error}
      onLoadOlder={() => void loadOlder()}
      onPlace={setPlace}
      onGoToPlace={goToPlace}
      onNewest={() => void open(reader.newest, null)}
    />
  );
}
