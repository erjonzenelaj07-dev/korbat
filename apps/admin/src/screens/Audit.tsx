import { AUDIT_EXPORT_MAX, type AuditEntry } from "@korbat/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { AUDIT_PAGE_LOADING, createAuditPager, createAuditReader, downloadCopy, parseKeyFilter, parsePlace, saveFile, type AuditPageView } from "../audit-log";
import { describeError, RECOVERY_WORDS } from "../messages";
import { exportAuditWithKey } from "../step-up";
import { dateTimeSeconds, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";

const R = RECOVERY_WORDS;

/** 3f Task 6 (8.7): "Download since my last copy", from the reader's own newest copied place. */
export interface CopyProps {
  lastPlace: number | null;
  busy: boolean;
  notice: string | null;
  error: string | null;
  onDownload(): void;
}

/** 3f Task 6 (8.7): "What one key confirmed": a key's id, typed or taken from a row, and a period. */
export interface KeyFilterProps {
  key: string;
  from: string;
  to: string;
  error: string | null;
  /** The key whose rows the page lists now, or null for every row. */
  shown: string | null;
  onChange(field: "key" | "from" | "to", value: string): void;
  onShow(): void;
  onAll(): void;
}

/** The download's block, above the table: what it takes and that the key confirms it, the button, what came of it. */
function CopyBlock({ copy }: { copy: CopyProps }) {
  return (
    <section className="block" aria-labelledby="copy-title">
      <h3 id="copy-title">{R.downloadTitle}</h3>
      <p className="hint">{copy.lastPlace === null ? R.downloadFirst(AUDIT_EXPORT_MAX) : R.download(copy.lastPlace, AUDIT_EXPORT_MAX)}</p>
      <p className="hint">{R.key}</p>
      <div className="actions">
        <button type="button" onClick={copy.onDownload} disabled={copy.busy} aria-busy={copy.busy}>
          {R.downloadButton}
        </button>
      </div>
      {copy.notice ? (
        <p role="status" className="notice">
          {copy.notice}
        </p>
      ) : null}
      {copy.error ? (
        <p role="alert" className="error">
          {copy.error}
        </p>
      ) : null}
    </section>
  );
}

/** The key filter's form: the key's id and the two times, each a field with its label above it. */
function KeyFilterBlock({ filter }: { filter: KeyFilterProps }) {
  return (
    <form
      className="block"
      aria-labelledby="key-title"
      onSubmit={(event) => {
        event.preventDefault();
        filter.onShow();
      }}
    >
      <h3 id="key-title">{R.keyTitle}</h3>
      <p className="hint">{R.keyWhat}</p>
      <div className="field">
        <label htmlFor="key-id">{R.keyField}</label>
        <input id="key-id" type="text" autoComplete="off" spellCheck={false} value={filter.key} onChange={(event) => filter.onChange("key", event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="key-from">{R.keyFrom}</label>
        <input id="key-from" type="text" autoComplete="off" spellCheck={false} value={filter.from} onChange={(event) => filter.onChange("from", event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="key-to">{R.keyTo}</label>
        <input id="key-to" type="text" autoComplete="off" spellCheck={false} value={filter.to} onChange={(event) => filter.onChange("to", event.target.value)} />
      </div>
      {filter.error ? <p className="error">{filter.error}</p> : null}
      <div className="actions">
        <button type="submit">{R.keyShow}</button>
        {filter.shown !== null ? (
          <button type="button" onClick={filter.onAll}>
            {R.keyAll}
          </button>
        ) : null}
      </div>
      {filter.shown !== null ? <p className="quiet">{R.keyShown(filter.shown)}</p> : null}
    </form>
  );
}

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
  /** 3f Task 6: the download of the tail and the key filter, with "This key" beside each confirmed row's key. */
  copy?: CopyProps;
  keyFilter?: KeyFilterProps;
  onThisKey?: (keyId: string) => void;
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

export function AuditView({ page, hasOlder, loadingOlder, at, place, placeError, error, onLoadOlder, onPlace, onGoToPlace, onNewest, copy, keyFilter, onThisKey }: AuditViewProps) {
  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title">Audit log</h2>
      <p className="hint">
        Every staff action, newest first. Each row's hash covers every row before it, so a row changed later changes every hash after it. Each day the
        keeper copies the newest place and hash, and opens the place kept on the previous visit with Go to place to check that it still shows the same hash.
      </p>
      {copy ? <CopyBlock copy={copy} /> : null}

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
      {keyFilter ? <KeyFilterBlock filter={keyFilter} /> : null}
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
                    {onThisKey ? <th scope="col">Key</th> : null}
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
                      {onThisKey ? (
                        <td>
                          {entry.keyId === null ? null : (
                            <>
                              <code>{entry.keyId}</code>{" "}
                              <button type="button" onClick={() => onThisKey(entry.keyId!)}>
                                {R.thisKey}
                              </button>
                            </>
                          )}
                        </td>
                      ) : null}
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

export function Audit({ api, credentials }: { api: StaffApi; credentials?: CredentialsLike }) {
  const reader = useMemo(() => createAuditReader(api), [api]);
  const [view, setView] = useState<AuditPageView>(AUDIT_PAGE_LOADING);
  // Each answer is shown only on the page it was asked for (createAuditPager).
  const pager = useMemo(() => createAuditPager(reader, setView), [reader]);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);
  // 3f Task 6: the download's state, and the key filter's fields.
  const [copying, setCopying] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [fields, setFields] = useState({ key: "", from: "", to: "" });
  const [filterError, setFilterError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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

  /**
   * "Download since my last copy": the newest page is read again for the head and the reader's own newest copied place,
   * then the download is confirmed with the key, checked, saved and marked (downloadCopy). The page is read again after.
   */
  const download = async () => {
    if (copying || credentials === undefined) return;
    setCopying(true);
    setCopyNotice(null);
    setCopyError(null);
    try {
      const newest = await api.audit({}, { activity: true });
      const outcome = await downloadCopy(
        {
          exportAudit: (params) => exportAuditWithKey({ api, credentials }, params),
          markCopy: (body) => api.markCopy(body, { activity: true }),
          save: saveFile,
        },
        newest.copy.lastPlace,
        newest.entries[0]?.seq ?? 0,
      );
      if (!alive.current) return;
      if (outcome.kind === "done") setCopyNotice(R.done(outcome.from, outcome.to, outcome.rows));
      else if (outcome.kind === "none") setCopyNotice(R.none(outcome.lastPlace));
      else setCopyError(R.broken);
      if (outcome.kind === "done") void pager.newest();
    } catch (err) {
      if (alive.current) setCopyError(describeError(err));
    } finally {
      if (alive.current) setCopying(false);
    }
  };

  const showKey = (key: string, from: string, to: string) => {
    const filter = parseKeyFilter(key, from, to);
    if (filter === null) {
      setFilterError(R.keyRule);
      return;
    }
    setFilterError(null);
    void pager.byKey(filter);
  };

  return (
    <AuditView
      copy={credentials === undefined ? undefined : { lastPlace: view.lastPlace ?? null, busy: copying, notice: copyNotice, error: copyError, onDownload: () => void download() }}
      keyFilter={{
        ...fields,
        error: filterError,
        shown: view.filter?.key ?? null,
        onChange: (field, value) => setFields((current) => ({ ...current, [field]: value })),
        onShow: () => showKey(fields.key, fields.from, fields.to),
        onAll: () => {
          setFields({ key: "", from: "", to: "" });
          void pager.newest();
        },
      }}
      onThisKey={(keyId) => {
        setFields((current) => ({ ...current, key: keyId }));
        showKey(keyId, fields.from, fields.to);
      }}
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
