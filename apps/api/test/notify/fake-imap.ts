import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer, type Server, type TLSSocket } from "node:tls";

/**
 * A stand-in for the contact point's mail host (3f design, section 12, `fakeImap`): an IMAP server on node:tls that
 * answers from a script and records every command it was sent. Its answers hold the lines a real server sends, not only
 * the ones the client asks for: EXAMINE's whole answer with the validity number in its untagged OK, and, where the
 * script says so, unrequested lines (`* 3 EXISTS`, `* 2 FETCH (FLAGS (...))`) inside a command's answer, as a person's
 * mail app reading the same mailbox makes a server send them.
 *
 * It has a second caller, scripts/dev-mailbox.mjs, the development mailbox, which loads this file with Node's own type
 * stripping. So it is written in the TypeScript that stripping can erase (no enum, no parameter property), and imports
 * nothing but Node's own modules. Its certificate is made here too, with a small DER writer: Node can make a key but not
 * a certificate, and a dependency for one test's certificate would be a dependency of the whole repository.
 */

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
const QUOTE = '"';
const BACKSLASH = String.fromCharCode(92);

// ---------------------------------------------------------------- a self-signed certificate, written as DER

/** A DER element: its tag, then its length, then its content. */
function der(tag: number, content: Buffer): Buffer {
  const length = content.length;
  if (length < 128) return Buffer.concat([Buffer.from([tag, length]), content]);
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.concat([Buffer.from([tag, 128 + bytes.length, ...bytes]), content]);
}
const sequence = (...items: Buffer[]) => der(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => der(0x31, Buffer.concat(items));
const explicit = (n: number, item: Buffer) => der(0xa0 + n, item);
const utf8String = (text: string) => der(0x0c, Buffer.from(text, "utf8"));
const octetString = (content: Buffer) => der(0x04, content);
const bitString = (content: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), content]));
const booleanTrue = () => der(0x01, Buffer.from([0xff]));

/** A positive INTEGER from its big-endian bytes: a leading zero keeps a high first bit from reading as negative. */
function integer(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  return der(0x02, trimmed[0]! >= 128 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}

/** An OBJECT IDENTIFIER from its dotted form. */
function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    const groups: number[] = [];
    let rest = part;
    do {
      groups.unshift(rest % 128);
      rest = Math.floor(rest / 128);
    } while (rest > 0);
    for (let i = 0; i < groups.length - 1; i++) groups[i] = groups[i]! + 128;
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

/** A UTCTime, which X.509 uses for every year before 2050. */
function utcTime(at: Date): Buffer {
  const two = (n: number) => String(n).padStart(2, "0");
  const text = `${two(at.getUTCFullYear() % 100)}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(text, "ascii"));
}

const ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";

/** A certificate and its key, each as PEM. */
export interface CertificatePair {
  key: string;
  cert: string;
}

/**
 * A self-signed certificate for `localhost` and 127.0.0.1 on a new P-256 key, valid from a day ago for ten years. It is
 * its own authority: a client that adds it to its roots (NOTIFY_IMAP_CA, or a test's `ca`) trusts it, and the name the
 * client checks is in its subjectAltName.
 */
export function makeCertificate(name = "korbat development mailbox"): CertificatePair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Date.now();
  const subject = sequence(set(sequence(oid("2.5.4.3"), utf8String(name))));
  const algorithm = sequence(oid(ECDSA_WITH_SHA256));
  // basicConstraints, critical, cA true: the certificate is the trust anchor it is checked against.
  const basicConstraints = sequence(oid("2.5.29.19"), booleanTrue(), octetString(sequence(booleanTrue())));
  // subjectAltName: dNSName localhost ([2]) and iPAddress 127.0.0.1 ([7]).
  const altNames = sequence(der(0x82, Buffer.from("localhost", "ascii")), der(0x87, Buffer.from([127, 0, 0, 1])));
  const subjectAltName = sequence(oid("2.5.29.17"), octetString(altNames));
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    algorithm,
    subject,
    sequence(utcTime(new Date(now - 24 * 60 * 60_000)), utcTime(new Date(now + 10 * 365 * 24 * 60 * 60_000))),
    subject,
    publicKey.export({ type: "spki", format: "der" }),
    explicit(3, sequence(basicConstraints, subjectAltName)),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certificate = sequence(tbs, algorithm, bitString(signature));
  const lines = certificate.toString("base64").match(/.{1,64}/g)!;
  const cert = ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----", ""].join(LF);
  const key = createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" })).export({ type: "pkcs8", format: "pem" }).toString();
  return { key, cert };
}

// ---------------------------------------------------------------- the server

/** One message of a folder: its UID and its internal date, the time of final delivery. */
export interface ScriptMessage {
  uid: number;
  internalDate: Date;
}

export interface ScriptFolder {
  uidValidity: number;
  messages: ScriptMessage[];
}

/** A command as the server read it: its tag, its name in capitals, and the rest of the line as sent. */
export interface ReceivedCommand {
  tag: string;
  name: string;
  args: string;
  line: string;
}

/** What a script may do in place of a command's normal answer. */
export type ScriptAnswer = { lines: string[] } | "drop" | "hang";

export interface ImapScript {
  /** The one account the server knows. */
  user: string;
  password: string;
  /** The folders by the name a client EXAMINEs. */
  folders: Map<string, ScriptFolder>;
  /** Untagged lines the server sends, unasked, inside the answer of each command of this name, before its completion. */
  unasked?: Partial<Record<string, string[]>>;
  /** The order of a FETCH's two members: the UID first, the date first, or both orders in turn. */
  fetchOrder?: "uid-first" | "date-first" | "alternate";
  /** A command's own answer, when the script wants another than the normal one: raw lines, a dropped connection or silence. */
  answer?: (command: ReceivedCommand) => ScriptAnswer | undefined;
  /** The key and certificate to serve with; a new pair when none is given. */
  tls?: CertificatePair;
  /** The port to listen on, on 127.0.0.1; any free one when none is given. */
  port?: number;
}

export interface FakeImap {
  port: number;
  /** The certificate a client adds to its roots. */
  ca: string;
  /** Every command line the server read, in order, across every connection. */
  commands: ReceivedCommand[];
  /** How many connections were opened. */
  connections(): number;
  /** The script's folders, which a test may change between rounds. */
  folders: Map<string, ScriptFolder>;
  /** Puts a new message into a folder, with the next UID, received now or at the given time. */
  drop(folder: string, at?: Date): ScriptMessage;
  close(): Promise<void>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date as IMAP writes an INTERNALDATE: "17-Jul-2026 02:44:25 +0000", the day padded with a space. */
export function internalDate(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${String(at.getUTCDate()).padStart(2, " ")}-${MONTHS[at.getUTCMonth()]}-${at.getUTCFullYear()} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} +0000`;
}

/** The strings of a command's arguments: each a quoted string, with a backslash before a quote or a backslash, or an atom. */
export function parseArguments(args: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === " ") {
      i++;
      continue;
    }
    if (args[i] === QUOTE) {
      let value = "";
      i++;
      while (i < args.length && args[i] !== QUOTE) {
        if (args[i] === BACKSLASH) i++;
        value += args[i] ?? "";
        i++;
      }
      i++;
      out.push(value);
      continue;
    }
    let atom = "";
    while (i < args.length && args[i] !== " ") atom += args[i++];
    out.push(atom);
  }
  return out;
}

/** The messages a `UID FETCH <from>:*` names: those at or above `from`, and the newest whatever `from` is (RFC 9051). */
function fetched(folder: ScriptFolder, from: number): ScriptMessage[] {
  const sorted = [...folder.messages].sort((a, b) => a.uid - b.uid);
  const named = sorted.filter((m) => m.uid >= from);
  if (named.length === 0 && sorted.length > 0) return [sorted.at(-1)!];
  return named;
}

/**
 * Starts the server. Each connection is greeted, then answers LOGIN, EXAMINE, UID FETCH, NOOP and LOGOUT from the script;
 * any other command is answered BAD. A connection that has not logged in may only log in.
 */
export async function fakeImap(script: ImapScript): Promise<FakeImap> {
  const pair = script.tls ?? makeCertificate();
  const commands: ReceivedCommand[] = [];
  const sockets = new Set<TLSSocket>();
  let opened = 0;
  let alternate = false;

  const server: Server = createServer({ key: pair.key, cert: pair.cert }, (socket) => {
    opened++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = "";
    let loggedIn = false;
    let selected: ScriptFolder | null = null;
    const send = (lines: string[]) => {
      if (!socket.destroyed) socket.write(lines.map((line) => `${line}${CRLF}`).join(""));
    };
    send(["* OK [CAPABILITY IMAP4rev1] korbat test mailbox ready"]);

    const handle = (line: string) => {
      const space = line.indexOf(" ");
      const tag = space < 0 ? line : line.slice(0, space);
      const rest = space < 0 ? "" : line.slice(space + 1);
      const uid = /^UID FETCH /i.test(rest);
      const name = uid ? "FETCH" : (rest.split(" ")[0] ?? "").toUpperCase();
      const args = uid ? rest.slice("UID FETCH ".length) : rest.slice(name.length + 1);
      const command: ReceivedCommand = { tag, name, args, line };
      commands.push(command);
      const own = script.answer?.(command);
      if (own === "drop") {
        socket.destroy();
        return;
      }
      if (own === "hang") return;
      const unasked = script.unasked?.[name] ?? [];
      if (own !== undefined) {
        send([...unasked, ...own.lines]);
        return;
      }
      if (name === "LOGIN") {
        const [user, password] = parseArguments(args);
        loggedIn = user === script.user && password === script.password;
        send([...unasked, loggedIn ? `${tag} OK LOGIN completed` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`]);
        return;
      }
      if (name === "LOGOUT") {
        send(["* BYE korbat test mailbox logging out", `${tag} OK LOGOUT completed`]);
        socket.end();
        return;
      }
      if (!loggedIn) {
        send([`${tag} BAD Not authenticated`]);
        return;
      }
      if (name === "EXAMINE") {
        const [folderName] = parseArguments(args);
        const folder = script.folders.get(folderName ?? "");
        if (!folder) {
          selected = null;
          send([`${tag} NO [NONEXISTENT] Unknown Mailbox: ${folderName ?? ""}`]);
          return;
        }
        selected = folder;
        const next = folder.messages.reduce((max, m) => Math.max(max, m.uid), 0) + 1;
        // EXAMINE's whole answer, as a real server sends it: the flags, the counts, the validity, the next UID.
        send([
          "* FLAGS (" + BACKSLASH + "Answered " + BACKSLASH + "Flagged " + BACKSLASH + "Deleted " + BACKSLASH + "Seen " + BACKSLASH + "Draft)",
          "* OK [PERMANENTFLAGS ()] Read-only mailbox.",
          `* ${folder.messages.length} EXISTS`,
          "* 0 RECENT",
          `* OK [UIDVALIDITY ${folder.uidValidity}] UIDs valid`,
          `* OK [UIDNEXT ${next}] Predicted next UID`,
          ...unasked,
          `${tag} OK [READ-ONLY] EXAMINE completed`,
        ]);
        return;
      }
      if (name === "FETCH") {
        if (!selected) {
          send([`${tag} BAD No mailbox selected`]);
          return;
        }
        const range = /^([0-9]+):[*] [(]UID INTERNALDATE[)]$/i.exec(args);
        if (!range) {
          send([`${tag} BAD This test server answers only UID FETCH n:* (UID INTERNALDATE)`]);
          return;
        }
        const sorted = [...selected.messages].sort((a, b) => a.uid - b.uid);
        const lines = fetched(selected, Number(range[1])).map((m) => {
          const seq = sorted.indexOf(m) + 1;
          const order = script.fetchOrder ?? "uid-first";
          const uidFirst = order === "uid-first" || (order === "alternate" && (alternate = !alternate));
          const date = `INTERNALDATE "${internalDate(m.internalDate)}"`;
          return uidFirst ? `* ${seq} FETCH (UID ${m.uid} ${date})` : `* ${seq} FETCH (${date} UID ${m.uid})`;
        });
        // The unasked lines come in the middle of the answer, as a server interleaves them.
        const half = Math.floor(lines.length / 2);
        send([...lines.slice(0, half), ...unasked, ...lines.slice(half), `${tag} OK UID FETCH completed`]);
        return;
      }
      if (name === "NOOP") {
        send([...unasked, `${tag} OK NOOP completed`]);
        return;
      }
      send([`${tag} BAD Unknown command`]);
    };

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf(CRLF); end >= 0; end = buffer.indexOf(CRLF)) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + CRLF.length);
        handle(line);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(script.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    ca: pair.cert,
    commands,
    connections: () => opened,
    folders: script.folders,
    drop(folderName, at = new Date()) {
      const folder = script.folders.get(folderName);
      if (!folder) throw new Error(`the script has no folder ${folderName}`);
      const message = { uid: folder.messages.reduce((max, m) => Math.max(max, m.uid), 0) + 1, internalDate: at };
      folder.messages.push(message);
      return message;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
