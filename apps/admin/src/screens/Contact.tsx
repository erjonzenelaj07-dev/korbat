import { CONTACT_CLOSE_DISPOSITIONS, DISPOSITION_LABELS, type ContactCloseRequest, type ContactMessage, type ContactPage } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError, ORDER_WORDS } from "../messages";
import { bothTimes, Loaded, UserText, type Loadable } from "../ui";

/**
 * The Contact point screen (3f design, section 8.3): the messages the watcher recorded at the authorities' contact point,
 * newest first, 50 a page with "Load older". korbat records that a message arrived and when, never who sent it or what it
 * says: a person reads each in the mail host's own app. A message nobody handled is closed here as what it turned out to
 * be, one of six words, without a key, since closing restricts nothing and tells nobody; the stale ones an outage left are
 * closed together, one request each. Opening an order from a message is the form of a later task. Every list is a list of
 * blocks, label above value, usable at a phone's width.
 */

type CloseWord = ContactCloseRequest["disposition"];
const W = ORDER_WORDS.contact;

/** The choices of "Close as", each with its hint: radio buttons of one group, a group a message or one for the stale ones. */
function CloseChoices({ group, chosen, disabled, onChoose }: { group: string; chosen: CloseWord | null; disabled: boolean; onChoose(word: CloseWord): void }) {
  return (
    <ul className="choices">
      {CONTACT_CLOSE_DISPOSITIONS.map((word) => (
        <li key={word}>
          <label className="choice">
            <input type="radio" name={group} value={word} checked={chosen === word} disabled={disabled} onChange={() => onChoose(word)} />
            {DISPOSITION_LABELS[word]}
          </label>
          <p className="hint">{W.hints[word]}</p>
        </li>
      ))}
    </ul>
  );
}

/** Who handled a message and when, or that nobody has. */
function Handled({ message }: { message: ContactMessage }) {
  if (message.disposition === null) return <p>{W.notHandled}</p>;
  if (message.disposition === "order") return <p>{W.handledOrder}</p>;
  const label = DISPOSITION_LABELS[message.disposition];
  const at = message.handledAt === null ? "" : bothTimes(message.handledAt);
  if (message.handledBy === null) return <p>{W.handledBySystem(label, at)}</p>;
  return (
    <p>
      {W.handledBefore(label)}
      <UserText>{message.handledBy}</UserText>
      {W.handledAfter(at)}
    </p>
  );
}

export interface ContactViewProps {
  page: Loadable<{ items: ContactMessage[]; nextCursor: string | null }>;
  /** The word chosen for each message, and for the stale ones together (key "stale"). */
  choices: Readonly<Record<string, CloseWord>>;
  /** The id of the message being closed, "stale" while the stale ones are, or null. */
  busy: string | null;
  notice: string | null;
  error: string | null;
  loadingOlder: boolean;
  onChoose(key: string, word: CloseWord): void;
  onClose(id: string): void;
  onCloseStale(): void;
  onLoadOlder(): void;
}

export function ContactView({ page, choices, busy, notice, error, loadingOlder, onChoose, onClose, onCloseStale, onLoadOlder }: ContactViewProps) {
  return (
    <section aria-labelledby="contact-title">
      <h2 id="contact-title">{W.title}</h2>
      <p>{W.what}</p>
      <p className="hint">{W.reply}</p>
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
        value={page}
        render={(value) => {
          const stale = value.items.filter((m) => m.stale && m.disposition === null);
          return (
            <>
              {stale.length > 1 ? (
                <fieldset className="stale-together">
                  <legend>{W.staleTogether(stale.length)}</legend>
                  <p className="hint">{W.staleAll(stale.length)}</p>
                  <CloseChoices group="close-stale" chosen={choices.stale ?? null} disabled={busy !== null} onChoose={(word) => onChoose("stale", word)} />
                  <button type="button" onClick={onCloseStale} disabled={busy !== null || choices.stale === undefined} aria-busy={busy === "stale"}>
                    {W.staleButton}
                  </button>
                </fieldset>
              ) : null}
              {value.items.length === 0 ? (
                <p>{W.empty}</p>
              ) : (
                <ul className="blocks messages">
                  {value.items.map((message) => (
                    <li key={message.id} className="block">
                      <p>{W.received(bothTimes(message.receivedAt))}</p>
                      <p>{W.folders[message.folder]}</p>
                      {message.stale ? <p className="notice">{W.stale}</p> : null}
                      <Handled message={message} />
                      {message.disposition === null ? (
                        <fieldset>
                          <legend>{W.closeAs}</legend>
                          <CloseChoices group={`close-${message.id}`} chosen={choices[message.id] ?? null} disabled={busy !== null} onChoose={(word) => onChoose(message.id, word)} />
                          <p className="hint">{W.close}</p>
                          <button type="button" onClick={() => onClose(message.id)} disabled={busy !== null || choices[message.id] === undefined} aria-busy={busy === message.id}>
                            {W.closeButton}
                          </button>
                        </fieldset>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {value.nextCursor !== null ? (
                <button type="button" onClick={onLoadOlder} disabled={loadingOlder} aria-busy={loadingOlder}>
                  {W.loadOlder}
                </button>
              ) : null}
            </>
          );
        }}
      />
    </section>
  );
}

export function Contact({ api }: { api: StaffApi }) {
  const [page, setPage] = useState<Loadable<ContactPage>>({ state: "loading" });
  const [choices, setChoices] = useState<Record<string, CloseWord>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const alive = useRef(true);

  /** The first page, read again: after a close, and when the screen opens (a person's action, so marked). */
  const readFirst = async () => {
    try {
      const value = await api.contact(null, false, { activity: true });
      if (alive.current) setPage({ state: "ready", value });
    } catch (err) {
      if (alive.current) setPage({ state: "failed", message: describeError(err) });
    }
  };

  useEffect(() => {
    alive.current = true;
    void readFirst();
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen; the API client never changes while the page lives.
  }, [api]);

  const close = async (id: string) => {
    const word = choices[id];
    if (word === undefined) return;
    setBusy(id);
    setNotice(null);
    setError(null);
    try {
      await api.closeContact(id, { disposition: word }, { activity: true });
      if (alive.current) setNotice(W.closed(DISPOSITION_LABELS[word]));
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) {
        setBusy(null);
        await readFirst();
      }
    }
  };

  /** The stale messages of the page, closed one request each with the word chosen for them all, then the page read again. */
  const closeStale = async () => {
    const word = choices.stale;
    if (word === undefined || page.state !== "ready") return;
    const stale = page.value.items.filter((m) => m.stale && m.disposition === null);
    setBusy("stale");
    setNotice(null);
    setError(null);
    let closed = 0;
    try {
      for (const message of stale) {
        await api.closeContact(message.id, { disposition: word }, { activity: true });
        closed++;
      }
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) {
        if (closed > 0) setNotice(W.staleClosed(closed));
        setBusy(null);
        await readFirst();
      }
    }
  };

  const loadOlder = async () => {
    if (page.state !== "ready" || page.value.nextCursor === null) return;
    setLoadingOlder(true);
    try {
      const older = await api.contact(page.value.nextCursor, false, { activity: true });
      if (alive.current) setPage({ state: "ready", value: { items: [...page.value.items, ...older.items], nextCursor: older.nextCursor } });
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  };

  return (
    <ContactView
      page={page}
      choices={choices}
      busy={busy}
      notice={notice}
      error={error}
      loadingOlder={loadingOlder}
      onChoose={(key, word) => setChoices((current) => ({ ...current, [key]: word }))}
      onClose={(id) => void close(id)}
      onCloseStale={() => void closeStale()}
      onLoadOlder={() => void loadOlder()}
    />
  );
}
