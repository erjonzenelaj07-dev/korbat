import { connect, rootCertificates, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import type { NotifyError } from "@korbat/contracts";

/**
 * The watcher's IMAP client (3f design, section 2 rows 2 and 3, sections 5 and 7.1), written for this one job on
 * node:tls: LOGIN, EXAMINE, `UID FETCH n:* (UID INTERNALDATE)`, NOOP and LOGOUT, nothing else. It asks for no header, no
 * body, no flag and no envelope, so no line it reads holds a byte an outsider wrote. It reads four kinds of line, each
 * by one anchored expression (readLine): the completion of the command in flight, the folder's UIDVALIDITY after EXAMINE,
 * a FETCH that holds both a UID and an internal date, and BYE. Every other untagged line that holds no literal is
 * ignored: the mailbox is shared with a person's mail app, and a server may send a line nobody asked for at any time
 * (RFC 9051, 2.2.2). A line that announces a literal, a line longer than IMAP_LINE_MAX and a completion that is not for
 * the command in flight are errors, which close the connection.
 *
 * A failure is an ImapFailure with one of NOTIFY_ERRORS' words; the connection is then closed, and the next round logs
 * in again. No regular expression here holds a backslash: a literal bracket or parenthesis is written as a class.
 */

const CRLF = String.fromCharCode(13, 10);
const LF = 10;
const CR = 13;
const QUOTE = '"';
const BACKSLASH = String.fromCharCode(92);

/** The longest line the client reads, in bytes, its end included. A FETCH line of two members is far shorter. */
export const IMAP_LINE_MAX = 4096;
/** How long a command may wait for its completion, and the connection for its greeting, unless the caller says otherwise. */
export const IMAP_TIMEOUT_MS = 30_000;

/** A failure of the client, named by one of the watcher's error words. */
export class ImapFailure extends Error {
  readonly word: NotifyError;
  constructor(word: NotifyError, message: string) {
    super(message);
    this.name = "ImapFailure";
    this.word = word;
  }
}

export interface FetchedMessage {
  uid: number;
  internalDate: Date;
}

/** What one line of an answer is to the client. */
export type ReadLine =
  | { kind: "completion"; status: "OK" | "NO" | "BAD" }
  | { kind: "uidvalidity"; value: number }
  | { kind: "fetch"; uid: number; internalDate: Date }
  | { kind: "bye" }
  | { kind: "ignored" }
  | { kind: "error"; reason: string };

// The anchored expressions, one for each kind of line the client reads.
const TAGGED = /^(a[0-9]+) (OK|NO|BAD)( .*)?$/i;
const UIDVALIDITY = /^[*] OK [[]UIDVALIDITY ([0-9]+)]/i;
const FETCH = /^[*] [0-9]+ FETCH [(](.*)[)]$/i;
const BYE = /^[*] BYE( .*)?$/i;
const UNTAGGED = /^[*] /;
/** A line that ends in {n} or {n+} announces a literal of n bytes: the client asks for none and reads none. */
const LITERAL = /[{][0-9]+[+]?[}]$/;
// The two members of a FETCH, each a word of its own in the list, in either order.
const FETCH_UID = /(^| )UID ([0-9]+)( |$)/i;
const FETCH_DATE = /(^| )INTERNALDATE "([^"]*)"( |$)/i;
const INTERNAL_DATE = /^([ 0-9][0-9])-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An IMAP date-time ("17-Jul-2026 02:44:25 +0200") as an instant, or null for any other form. */
export function parseInternalDate(text: string): Date | null {
  const found = INTERNAL_DATE.exec(text);
  if (!found) return null;
  const [, day, month, year, hour, minute, second, sign, offsetHours, offsetMinutes] = found;
  const local = Date.UTC(Number(year), MONTHS.indexOf(month!), Number(day!.trim()), Number(hour), Number(minute), Number(second));
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000;
  const at = new Date(sign === "+" ? local - offset : local + offset);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** What one line is, while the command tagged `tag` is in flight. */
export function readLine(line: string, tag: string): ReadLine {
  if (LITERAL.test(line)) return { kind: "error", reason: "a literal" };
  const tagged = TAGGED.exec(line);
  if (tagged) {
    if (tagged[1] !== tag) return { kind: "error", reason: "a completion for another command" };
    return { kind: "completion", status: tagged[2]!.toUpperCase() as "OK" | "NO" | "BAD" };
  }
  const validity = UIDVALIDITY.exec(line);
  if (validity) return { kind: "uidvalidity", value: Number(validity[1]) };
  const fetched = FETCH.exec(line);
  if (fetched) {
    const uid = FETCH_UID.exec(fetched[1]!);
    const date = FETCH_DATE.exec(fetched[1]!);
    // A FETCH without both members is the server telling of something else (flags another client changed).
    if (!uid || !date) return { kind: "ignored" };
    const internalDate = parseInternalDate(date[2]!);
    if (internalDate === null) return { kind: "error", reason: "an internal date of no known form" };
    return { kind: "fetch", uid: Number(uid[2]), internalDate };
  }
  if (BYE.test(line)) return { kind: "bye" };
  if (UNTAGGED.test(line)) return { kind: "ignored" };
  return { kind: "error", reason: "a line of no known form" };
}

/** A string as IMAP's quoted string: in quotes, with a backslash before each quote and each backslash. */
export function imapQuoted(value: string): string {
  let out = QUOTE;
  for (const char of value) out += char === QUOTE || char === BACKSLASH ? `${BACKSLASH}${char}` : char;
  return `${out}${QUOTE}`;
}

/** Refuses, naming the setting, a value a quoted string cannot carry: a line break, or any other control character. */
export function checkImapValue(name: string, value: string): void {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) throw new Error(`${name} holds a line break or another control character, which IMAP cannot send: set it again without one`);
  }
}

export interface ImapOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  /** One more trusted certificate, PEM, beside the roots compiled into Node: the development mailbox's only. */
  ca?: string;
  timeoutMs?: number;
}

export interface ImapSession {
  /** Opens a folder read-only and answers its UIDVALIDITY. */
  examine(folder: string): Promise<number>;
  /** The messages above the mark, in UID order: `UID FETCH <last + 1>:* (UID INTERNALDATE)`, a UID at or below the mark dropped. */
  fetchSince(lastUid: number): Promise<FetchedMessage[]>;
  noop(): Promise<void>;
  /** LOGOUT, then the connection closed; never throws. */
  logout(): Promise<void>;
  close(): void;
  readonly closed: boolean;
}

/** A socket's failure as one of the words: a certificate or handshake problem is imap_tls, anything else imap_connect. */
function socketWord(err: unknown): NotifyError {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  const tls = code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("CERT") || code.includes("SELF_SIGNED") || code.includes("VERIFY") || code === "EPROTO";
  return tls ? "imap_tls" : "imap_connect";
}

/**
 * Connects over TLS to the mail host, with the roots compiled into Node (and one more only when given) and the
 * certificate's name checked, reads the greeting and logs in. The user and the password go as quoted strings.
 */
export async function openImap(options: ImapOptions): Promise<ImapSession> {
  checkImapValue("NOTIFY_IMAP_USER", options.user);
  checkImapValue("NOTIFY_IMAP_PASSWORD", options.password);
  const timeoutMs = options.timeoutMs ?? IMAP_TIMEOUT_MS;
  let socket: TLSSocket;
  let closed = false;
  let pending: Buffer = Buffer.alloc(0);
  const lines: string[] = [];
  let failure: ImapFailure | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const fail = (f: ImapFailure) => {
    if (failure === null) failure = f;
    closed = true;
    socket?.destroy();
    notify();
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket?.destroy();
      reject(new ImapFailure("imap_timeout", "the mail host did not answer the connection in time"));
    }, timeoutMs);
    socket = connect({
      host: options.host,
      port: options.port,
      // The name the certificate is checked against; an address is checked against the certificate's addresses.
      servername: isIP(options.host) ? undefined : options.host,
      ca: options.ca === undefined ? undefined : [...rootCertificates, options.ca],
      rejectUnauthorized: true,
    });
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(new ImapFailure(socketWord(err), `the connection to the mail host failed: ${err.message}`));
    });
  });

  socket!.on("data", (chunk: Buffer) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    for (let end = pending.indexOf(LF); end >= 0; end = pending.indexOf(LF)) {
      const raw = pending.subarray(0, end + 1);
      pending = pending.subarray(end + 1);
      if (raw.length > IMAP_LINE_MAX) {
        fail(new ImapFailure("imap_protocol", "the mail host sent a line longer than the client reads"));
        return;
      }
      // A line ends in CRLF; its bytes are ASCII as far as the client reads them, and anything else is ignored or refused by form.
      const body = raw.length >= 2 && raw[raw.length - 2] === CR ? raw.subarray(0, raw.length - 2) : raw.subarray(0, raw.length - 1);
      lines.push(body.toString("latin1"));
    }
    if (pending.length > IMAP_LINE_MAX) {
      fail(new ImapFailure("imap_protocol", "the mail host sent a line longer than the client reads"));
      return;
    }
    notify();
  });
  socket!.on("error", (err) => fail(new ImapFailure("imap_connect", `the connection to the mail host failed: ${err.message}`)));
  socket!.on("close", () => {
    closed = true;
    if (failure === null) failure = new ImapFailure("imap_connect", "the mail host closed the connection");
    notify();
  });

  /** The next line, waiting at most until `deadline`. */
  const next = async (deadline: number): Promise<string> => {
    for (;;) {
      if (lines.length > 0) return lines.shift()!;
      if (failure !== null) throw failure;
      const left = deadline - Date.now();
      if (left <= 0) {
        const late = new ImapFailure("imap_timeout", "the mail host did not answer in time");
        fail(late);
        throw late;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  };

  // The greeting: OK or PREAUTH, or BYE when the host refuses the connection.
  const greeting = await next(Date.now() + timeoutMs);
  if (!/^[*] (OK|PREAUTH)( |$)/i.test(greeting)) {
    fail(new ImapFailure("imap_connect", "the mail host did not greet the client"));
    throw failure!;
  }

  let counter = 0;
  /**
   * Sends one command and reads its answer up to its completion. Each line goes to `onLine` when it is one the command
   * reads; the completion's status is answered. A BYE before the completion means the host is closing the connection.
   */
  const run = async (command: string, onLine: (line: ReadLine) => void, refused: NotifyError): Promise<void> => {
    if (closed) throw failure ?? new ImapFailure("imap_connect", "the connection is closed");
    const tag = `a${++counter}`;
    socket.write(`${tag} ${command}${CRLF}`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const read = readLine(await next(deadline), tag);
      if (read.kind === "error") {
        const f = new ImapFailure("imap_protocol", `the mail host sent ${read.reason}`);
        fail(f);
        throw f;
      }
      if (read.kind === "bye") {
        const f = new ImapFailure("imap_connect", "the mail host ended the session");
        fail(f);
        throw f;
      }
      if (read.kind === "completion") {
        if (read.status !== "OK") {
          const f = new ImapFailure(refused, `the mail host answered ${read.status}`);
          // A refused LOGIN or folder leaves the connection usable, but the round ends: close it and start clean.
          fail(f);
          throw f;
        }
        return;
      }
      onLine(read);
    }
  };

  const session: ImapSession = {
    async examine(folder) {
      checkImapValue("NOTIFY_IMAP_JUNK", folder);
      let validity: number | null = null;
      await run(`EXAMINE ${imapQuoted(folder)}`, (read) => {
        if (read.kind === "uidvalidity") validity = read.value;
      }, "imap_folder");
      if (validity === null) {
        const f = new ImapFailure("imap_protocol", "the mail host named no UIDVALIDITY for the folder");
        fail(f);
        throw f;
      }
      return validity;
    },
    async fetchSince(lastUid) {
      const found: FetchedMessage[] = [];
      await run(`UID FETCH ${lastUid + 1}:* (UID INTERNALDATE)`, (read) => {
        // n:* always answers the newest message, also when n is above it: a UID at or below the mark is dropped.
        if (read.kind === "fetch" && read.uid > lastUid) found.push({ uid: read.uid, internalDate: read.internalDate });
      }, "imap_protocol");
      return found.sort((a, b) => a.uid - b.uid);
    },
    async noop() {
      await run("NOOP", () => undefined, "imap_protocol");
    },
    async logout() {
      if (closed) return;
      try {
        await run("LOGOUT", () => undefined, "imap_protocol");
      } catch {
        // The BYE that answers LOGOUT, or anything else: the connection goes either way.
      }
      session.close();
    },
    close() {
      closed = true;
      socket.destroy();
    },
    get closed() {
      return closed;
    },
  };

  await run(`LOGIN ${imapQuoted(options.user)} ${imapQuoted(options.password)}`, () => undefined, "imap_login");
  return session;
}
