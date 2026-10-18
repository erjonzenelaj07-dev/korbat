import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { IMAP_LINE_MAX, ImapFailure, checkImapValue, imapQuoted, openImap, parseInternalDate, readLine, type ImapOptions } from "../../src/notify/imap";
import { createWatcher, readSettings, type NotifyStore, type OwedPush } from "../../src/notify/main";
import { fakeImap, makeCertificate, parseArguments, type FakeImap, type ImapScript, type ScriptFolder } from "./fake-imap";

/**
 * The watcher parses nothing an outsider wrote (3f design, sections 5, 7.1 and 12.1, invariant 13): against fakeImap, as
 * unit tests, the client sends the five commands and no FETCH that names a header, a body, a flag or an envelope; it
 * reads the four kinds of line it knows, ignores every other untagged line that holds no literal, and ends the round
 * with one of the eight error words on anything else. The loop's part of it runs with a store in memory: the database's
 * own part (the role, the triggers) is the integration file notify-loop.test.ts.
 */

const BACKSLASH = String.fromCharCode(92);
const QUOTE = '"';
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SEEN = `${BACKSLASH}Seen`;

/** One certificate for the whole file: making a key is the slow part of a server. */
const pair = makeCertificate();
const servers: FakeImap[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const at = (iso: string) => new Date(iso);
const folders = (inbox: ScriptFolder, junk: ScriptFolder = { uidValidity: 7, messages: [] }) =>
  new Map<string, ScriptFolder>([
    ["INBOX", inbox],
    ["Junk", junk],
  ]);

async function server(over: Partial<ImapScript> = {}): Promise<FakeImap> {
  const made = await fakeImap({ user: "watcher", password: "secret", folders: folders({ uidValidity: 1, messages: [] }), tls: pair, ...over });
  servers.push(made);
  return made;
}

const optionsFor = (s: FakeImap, over: Partial<ImapOptions> = {}): ImapOptions => ({ host: "localhost", port: s.port, user: "watcher", password: "secret", ca: s.ca, timeoutMs: 2_000, ...over });

/** The word a failing call threw, or null. */
async function word(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof ImapFailure) return err.word;
    throw err;
  }
}

describe("the anchored expressions, one for each kind of line the client reads", () => {
  test("the completion of the command in flight, and of any other command", () => {
    expect(readLine("a3 OK UID FETCH completed", "a3")).toEqual({ kind: "completion", status: "OK" });
    expect(readLine("a3 NO [AUTHENTICATIONFAILED] Invalid credentials", "a3")).toEqual({ kind: "completion", status: "NO" });
    expect(readLine("a3 BAD Unknown command", "a3")).toEqual({ kind: "completion", status: "BAD" });
    expect(readLine("a3 ok done", "a3")).toEqual({ kind: "completion", status: "OK" });
    // A completion that is not for the command in flight.
    expect(readLine("a2 OK LOGIN completed", "a3")).toEqual({ kind: "error", reason: "a completion for another command" });
  });

  test("the folder's validity, in the untagged OK of EXAMINE's answer", () => {
    expect(readLine("* OK [UIDVALIDITY 3857529045] UIDs valid", "a2")).toEqual({ kind: "uidvalidity", value: 3857529045 });
    expect(readLine("* OK [UIDNEXT 4392] Predicted next UID", "a2")).toEqual({ kind: "ignored" });
  });

  test("a FETCH that holds both a UID and an internal date, in either order; one without both is ignored", () => {
    const date = at("2026-07-17T00:44:25.000Z");
    expect(readLine('* 12 FETCH (UID 4827 INTERNALDATE "17-Jul-2026 02:44:25 +0200")', "a4")).toEqual({ kind: "fetch", uid: 4827, internalDate: date });
    expect(readLine('* 12 FETCH (INTERNALDATE "17-Jul-2026 02:44:25 +0200" UID 4827)', "a4")).toEqual({ kind: "fetch", uid: 4827, internalDate: date });
    expect(readLine(`* 2 FETCH (FLAGS (${SEEN}))`, "a4")).toEqual({ kind: "ignored" });
    expect(readLine(`* 2 FETCH (UID 9 FLAGS (${SEEN}))`, "a4")).toEqual({ kind: "ignored" });
  });

  test("every other untagged line that holds no literal is ignored, and BYE is read", () => {
    for (const line of ["* 3 EXISTS", "* 0 RECENT", "* 4 EXPUNGE", `* FLAGS (${SEEN} ${BACKSLASH}Deleted)`, '* LIST () "/" INBOX', "* CAPABILITY IMAP4rev1 IDLE", "* OK [ALERT] Maintenance tonight", "* NO [OVERQUOTA] Nearly full", "* BAD unexpected"]) {
      expect(readLine(line, "a5"), line).toEqual({ kind: "ignored" });
    }
    expect(readLine("* BYE Autologout; idle for too long", "a5")).toEqual({ kind: "bye" });
  });

  test("a line that announces a literal, a continuation, and any line of no known form are errors", () => {
    expect(readLine("* 1 FETCH (UID 2 BODY[HEADER] {342}", "a4")).toEqual({ kind: "error", reason: "a literal" });
    expect(readLine("* 1 FETCH (UID 2 BODY[HEADER] {342+}", "a4")).toEqual({ kind: "error", reason: "a literal" });
    expect(readLine("+ Ready for additional command text", "a4")).toEqual({ kind: "error", reason: "a line of no known form" });
    expect(readLine("hello there", "a4")).toEqual({ kind: "error", reason: "a line of no known form" });
    expect(readLine('* 12 FETCH (UID 4827 INTERNALDATE "yesterday")', "a4")).toEqual({ kind: "error", reason: "an internal date of no known form" });
  });

  test("an internal date as RFC 9051 writes one, the day padded with a space, in any offset", () => {
    expect(parseInternalDate(" 7-Jul-2026 02:44:25 +0200")).toEqual(at("2026-07-07T00:44:25.000Z"));
    expect(parseInternalDate("31-Dec-2026 23:59:59 -0130")).toEqual(at("2027-01-01T01:29:59.000Z"));
    expect(parseInternalDate("17-Jul-2026 02:44:25")).toBeNull();
    expect(parseInternalDate("17-Foo-2026 02:44:25 +0000")).toBeNull();
  });

  test("the two strings the client sends from settings are quoted strings; a value with a line break is refused", () => {
    const hard = `pa${QUOTE}ss ${BACKSLASH}word{3}`;
    expect(imapQuoted(hard)).toBe(`${QUOTE}pa${BACKSLASH}${QUOTE}ss ${BACKSLASH}${BACKSLASH}word{3}${QUOTE}`);
    expect(parseArguments(imapQuoted(hard))).toEqual([hard]);
    expect(() => checkImapValue("NOTIFY_IMAP_PASSWORD", `a${LF}b`)).toThrow(/NOTIFY_IMAP_PASSWORD/);
    expect(() => checkImapValue("NOTIFY_IMAP_JUNK", `a${CR}`)).toThrow(/NOTIFY_IMAP_JUNK/);
    expect(() => checkImapValue("NOTIFY_IMAP_JUNK", "Spam folder")).not.toThrow();
  });
});

describe("the client against fakeImap", () => {
  test("it sends the five commands and no FETCH names a header, a body, a flag or an envelope", async () => {
    const s = await server({ folders: folders({ uidValidity: 41, messages: [{ uid: 3, internalDate: at("2026-10-12T20:00:00.000Z") }] }) });
    const imap = await openImap(optionsFor(s));
    expect(await imap.examine("INBOX")).toBe(41);
    expect(await imap.fetchSince(0)).toEqual([{ uid: 3, internalDate: at("2026-10-12T20:00:00.000Z") }]);
    await imap.noop();
    await imap.logout();
    expect(s.commands.map((c) => c.name)).toEqual(["LOGIN", "EXAMINE", "FETCH", "NOOP", "LOGOUT"]);
    const fetches = s.commands.filter((c) => c.name === "FETCH");
    expect(fetches.map((c) => c.line.slice(c.tag.length + 1))).toEqual(["UID FETCH 1:* (UID INTERNALDATE)"]);
    for (const c of s.commands) expect(c.line).not.toMatch(/BODY|HEADER|FLAGS|ENVELOPE|RFC822|BODYSTRUCTURE|STORE|SELECT /i);
  });

  test("what a real server sends is read or ignored without an error: EXAMINE's whole answer, unasked lines inside a FETCH and a NOOP, and a FETCH's members in both orders", async () => {
    const messages = Array.from({ length: 6 }, (_, i) => ({ uid: 10 + i, internalDate: at(`2026-10-12T20:0${i}:00.000Z`) }));
    const s = await server({
      folders: folders({ uidValidity: 9, messages }),
      fetchOrder: "alternate",
      unasked: { FETCH: ["* 7 EXISTS", `* 2 FETCH (FLAGS (${SEEN}))`, "* 1 RECENT"], NOOP: ["* 8 EXISTS", `* 3 FETCH (FLAGS (${SEEN}))`, "* 2 EXPUNGE"] },
    });
    const imap = await openImap(optionsFor(s));
    expect(await imap.examine("INBOX")).toBe(9);
    expect(await imap.fetchSince(0)).toEqual(messages);
    await imap.noop();
    await imap.logout();
  });

  test("a UID at or below the mark is dropped: n:* always answers the newest message", async () => {
    const s = await server({ folders: folders({ uidValidity: 9, messages: [{ uid: 5, internalDate: at("2026-10-12T20:00:00.000Z") }] }) });
    const imap = await openImap(optionsFor(s));
    await imap.examine("INBOX");
    expect(await imap.fetchSince(5)).toEqual([]);
    expect(s.commands.at(-1)!.args).toBe("6:* (UID INTERNALDATE)");
    imap.close();
  });

  test("a line that announces a literal, a line over the bound and a completion for another command each end it with imap_protocol", async () => {
    const literal = await server({ answer: (c) => (c.name === "FETCH" ? { lines: ["* 1 FETCH (UID 1 BODY[] {12}", `${c.tag} OK done`] } : undefined) });
    let imap = await openImap(optionsFor(literal));
    await imap.examine("INBOX");
    expect(await word(() => imap.fetchSince(0))).toBe("imap_protocol");
    expect(imap.closed).toBe(true);

    const long = await server({ answer: (c) => (c.name === "NOOP" ? { lines: [`* OK ${"x".repeat(IMAP_LINE_MAX)}`, `${c.tag} OK done`] } : undefined) });
    imap = await openImap(optionsFor(long));
    expect(await word(() => imap.noop())).toBe("imap_protocol");
    expect(imap.closed).toBe(true);

    const other = await server({ answer: (c) => (c.name === "NOOP" ? { lines: ["a1 OK something else"] } : undefined) });
    imap = await openImap(optionsFor(other));
    expect(await word(() => imap.noop())).toBe("imap_protocol");
  });

  test("a dropped connection is imap_connect, a host that does not answer imap_timeout, a wrong password imap_login, a folder it cannot open imap_folder", async () => {
    const dropping = await server({ answer: (c) => (c.name === "EXAMINE" ? "drop" : undefined) });
    let imap = await openImap(optionsFor(dropping));
    expect(await word(() => imap.examine("INBOX"))).toBe("imap_connect");

    const hanging = await server({ answer: (c) => (c.name === "EXAMINE" ? "hang" : undefined) });
    imap = await openImap(optionsFor(hanging, { timeoutMs: 300 }));
    expect(await word(() => imap.examine("INBOX"))).toBe("imap_timeout");

    const s = await server();
    expect(await word(() => openImap(optionsFor(s, { password: "wrong" })))).toBe("imap_login");
    imap = await openImap(optionsFor(s));
    expect(await word(() => imap.examine("No such folder"))).toBe("imap_folder");
    imap.close();

    // Nothing listens: the connection itself fails.
    const port = s.port;
    await s.close();
    servers.splice(servers.indexOf(s), 1);
    expect(await word(() => openImap({ host: "localhost", port, user: "watcher", password: "secret", ca: pair.cert, timeoutMs: 2_000 }))).toBe("imap_connect");
  });

  test("a certificate the client does not trust is imap_tls: the roots compiled into Node, and one more only when it is given", async () => {
    const s = await server();
    expect(await word(() => openImap(optionsFor(s, { ca: undefined })))).toBe("imap_tls");
    // Another key's certificate for the same name is not the one the server holds.
    expect(await word(() => openImap(optionsFor(s, { ca: makeCertificate().cert })))).toBe("imap_tls");
    expect(s.commands).toEqual([]);
  });

  test("the password and the junk folder's name, each with a quote, a backslash, a space and a brace, go as quoted strings and arrive as they were", async () => {
    const password = `p${QUOTE}a ${BACKSLASH}s{5}`;
    const junk = `Junk ${QUOTE}mail${QUOTE} ${BACKSLASH}{2}`;
    const s = await server({ password, folders: new Map([["INBOX", { uidValidity: 1, messages: [] }], [junk, { uidValidity: 2, messages: [] }]]) });
    const imap = await openImap(optionsFor(s, { password }));
    expect(await imap.examine(junk)).toBe(2);
    imap.close();
    expect(parseArguments(s.commands[0]!.args)).toEqual(["watcher", password]);
    expect(parseArguments(s.commands[1]!.args)).toEqual([junk]);
  });
});

// ---------------------------------------------------------------- the loop's part, with a store in memory

interface StoredMessage {
  folder: "inbox" | "junk";
  uidvalidity: number;
  uid: number;
  receivedAt: Date;
}

/** The watcher's statements, kept in memory: what it inserted, its marks and its beats. */
function memoryStore() {
  const messages: StoredMessage[] = [];
  const marks = new Map<string, { uidvalidity: number; lastUid: number }>();
  const beats: { mailboxOk: boolean; pushOk: boolean; error: string | null }[] = [];
  const store: NotifyStore = {
    async folderMark(folder) {
      return marks.get(folder) ?? null;
    },
    async insertMessage(folder, uidvalidity, uid, receivedAt) {
      // The unique key of folder, validity and UID drops a repeat, as the database's does.
      if (!messages.some((m) => m.folder === folder && m.uidvalidity === uidvalidity && m.uid === uid)) messages.push({ folder, uidvalidity, uid, receivedAt });
      marks.set(folder, { uidvalidity, lastUid: Math.max(uid, marks.get(folder)?.uidvalidity === uidvalidity ? marks.get(folder)!.lastUid : 0) });
    },
    async setMark(folder, uidvalidity, lastUid) {
      marks.set(folder, { uidvalidity, lastUid });
    },
    async owedPushes(): Promise<OwedPush[]> {
      return [];
    },
    async markPushed() {},
    async markFailed() {},
    async beat(state) {
      beats.push(state);
    },
  };
  return { store, messages, marks, beats };
}

const silent = pino({ level: "silent" });

function watcherFor(s: FakeImap, store: NotifyStore, password = "secret") {
  return createWatcher({
    store,
    imap: { host: "localhost", port: s.port, user: "watcher", password, junk: "Junk", ca: s.ca, timeoutMs: 2_000 },
    push: { url: "http://127.0.0.1:9", token: "tk_test" },
    fetch: async () => {
      throw new Error("nothing is owed in these rounds");
    },
    now: () => new Date(),
    log: silent,
  });
}

describe("the watcher's round, the mailbox's side (row 13)", () => {
  test("the first round reads both folders whole, inserts each message once in UID order with its internal date, marks the folders and beats", async () => {
    const s = await server({
      folders: folders(
        { uidValidity: 50, messages: [{ uid: 2, internalDate: at("2026-10-12T20:02:00.000Z") }, { uid: 1, internalDate: at("2026-10-12T20:01:00.000Z") }] },
        { uidValidity: 60, messages: [{ uid: 8, internalDate: at("2026-10-12T20:08:00.000Z") }] },
      ),
    });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    const report = await w.round();
    expect(report).toMatchObject({ mailboxOk: true, error: null, inserted: 3 });
    expect(m.messages).toEqual([
      { folder: "inbox", uidvalidity: 50, uid: 1, receivedAt: at("2026-10-12T20:01:00.000Z") },
      { folder: "inbox", uidvalidity: 50, uid: 2, receivedAt: at("2026-10-12T20:02:00.000Z") },
      { folder: "junk", uidvalidity: 60, uid: 8, receivedAt: at("2026-10-12T20:08:00.000Z") },
    ]);
    expect(Object.fromEntries(m.marks)).toEqual({ inbox: { uidvalidity: 50, lastUid: 2 }, junk: { uidvalidity: 60, lastUid: 8 } });
    expect(m.beats).toEqual([{ mailboxOk: true, pushOk: true, error: null }]);
    // EXAMINE opens each folder read-only; the junk folder by the name the setting gives.
    expect(s.commands.filter((c) => c.name === "EXAMINE").map((c) => parseArguments(c.args)[0])).toEqual(["INBOX", "Junk"]);
    await w.stop();
  });

  test("the next round keeps the connection with NOOP, asks from the mark and inserts only what is new", async () => {
    const s = await server({ folders: folders({ uidValidity: 50, messages: [{ uid: 1, internalDate: at("2026-10-12T20:01:00.000Z") }] }) });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    await w.round();
    s.drop("INBOX", at("2026-10-12T21:00:00.000Z"));
    expect((await w.round()).inserted).toBe(1);
    expect((await w.round()).inserted).toBe(0);
    expect(s.connections()).toBe(1);
    expect(s.commands.filter((c) => c.name === "LOGIN")).toHaveLength(1);
    expect(s.commands.filter((c) => c.name === "NOOP").length).toBeGreaterThanOrEqual(2);
    expect(s.commands.filter((c) => c.name === "FETCH").map((c) => c.args)).toEqual(["1:* (UID INTERNALDATE)", "1:* (UID INTERNALDATE)", "2:* (UID INTERNALDATE)", "1:* (UID INTERNALDATE)", "3:* (UID INTERNALDATE)", "1:* (UID INTERNALDATE)"]);
    expect(m.messages.map((x) => x.uid)).toEqual([1, 2]);
    await w.stop();
  });

  test("a changed UIDVALIDITY resets the folder's mark: the folder is read whole and every message is a new row", async () => {
    const s = await server({ folders: folders({ uidValidity: 50, messages: [{ uid: 1, internalDate: at("2026-10-12T20:01:00.000Z") }, { uid: 2, internalDate: at("2026-10-12T20:02:00.000Z") }] }) });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    await w.round();
    // The mail host renumbered the folder: the same two messages under a new validity and new UIDs.
    s.folders.set("INBOX", { uidValidity: 51, messages: [{ uid: 1, internalDate: at("2026-10-12T20:01:00.000Z") }, { uid: 2, internalDate: at("2026-10-12T20:02:00.000Z") }] });
    expect((await w.round()).inserted).toBe(2);
    expect(m.messages.map((x) => [x.uidvalidity, x.uid])).toEqual([
      [50, 1],
      [50, 2],
      [51, 1],
      [51, 2],
    ]);
    expect(m.marks.get("inbox")).toEqual({ uidvalidity: 51, lastUid: 2 });
    await w.stop();
  });

  test("a dropped connection is found by the next round's NOOP, and the round logs in again and reads", async () => {
    let dropNoop = false;
    const s = await server({ answer: (c) => (c.name === "NOOP" && dropNoop ? "drop" : undefined) });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    await w.round();
    dropNoop = true;
    s.drop("Junk");
    const report = await w.round();
    dropNoop = false;
    expect(report).toMatchObject({ mailboxOk: true, error: null, inserted: 1 });
    expect(s.connections()).toBe(2);
    await w.stop();
  });

  test("a wrong password is imap_login, tried once a round and never faster; the beat says the mailbox was not read", async () => {
    const s = await server();
    const m = memoryStore();
    const w = watcherFor(s, m.store, "wrong");
    expect(await w.round()).toMatchObject({ mailboxOk: false, error: "imap_login", inserted: 0 });
    expect(await w.round()).toMatchObject({ mailboxOk: false, error: "imap_login" });
    expect(s.commands.filter((c) => c.name === "LOGIN")).toHaveLength(2);
    expect(m.beats.map((b) => [b.mailboxOk, b.error])).toEqual([
      [false, "imap_login"],
      [false, "imap_login"],
    ]);
    await w.stop();
  });

  test("a folder that cannot be opened is imap_folder and the folder does not count as read", async () => {
    const s = await server({ folders: new Map([["INBOX", { uidValidity: 1, messages: [] }]]) });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    expect(await w.round()).toMatchObject({ mailboxOk: false, error: "imap_folder" });
    await w.stop();
  });

  test("a first start on a mailbox with 10,000 old messages reads them all in one round and inserts each once", async () => {
    const old = Date.parse("2026-01-01T00:00:00.000Z");
    const messages = Array.from({ length: 10_000 }, (_, i) => ({ uid: i + 1, internalDate: new Date(old + i * 60_000) }));
    const s = await server({ folders: folders({ uidValidity: 3, messages }) });
    const m = memoryStore();
    const w = watcherFor(s, m.store);
    const report = await w.round();
    expect(report).toMatchObject({ mailboxOk: true, inserted: 10_000 });
    expect(m.messages).toHaveLength(10_000);
    expect(m.messages.at(-1)).toEqual({ folder: "inbox", uidvalidity: 3, uid: 10_000, receivedAt: messages.at(-1)!.internalDate });
    await w.stop();
  }, 60_000);
});

describe("the watcher's settings", () => {
  const good = {
    DATABASE_URL_NOTIFY: "postgres://korbat_notify:pw@postgres:5432/korbat",
    NOTIFY_IMAP_HOST: "imap.mail.example",
    NOTIFY_IMAP_USER: "contact@korbat.example",
    NOTIFY_IMAP_PASSWORD: "app password",
    NOTIFY_IMAP_JUNK: "Junk",
    NTFY_PUBLISH_TOKEN: "tk_0123456789abcdefghijklmnopqrs",
  };

  test("each required setting is named when it is missing or blank, and a value with a line break is refused", () => {
    expect(readSettings({ ...good, NODE_ENV: "production" })).toMatchObject({ imap: { host: "imap.mail.example", port: 993, junk: "Junk" }, push: { url: "http://ntfy:2586" } });
    for (const name of Object.keys(good)) {
      expect(() => readSettings({ ...good, [name]: undefined }), name).toThrow(new RegExp(name));
      expect(() => readSettings({ ...good, [name]: "  " }), name).toThrow(new RegExp(name));
    }
    expect(() => readSettings({ ...good, NOTIFY_IMAP_PASSWORD: `a${LF}b` })).toThrow(/NOTIFY_IMAP_PASSWORD/);
    // Compose builds the database's URL from a password it does not require: the empty one is named as missing.
    expect(() => readSettings({ ...good, DATABASE_URL_NOTIFY: "postgres://korbat_notify:@postgres:5432/korbat" })).toThrow(/KORBAT_NOTIFY_DB_PASSWORD/);
    expect(() => readSettings({ ...good, NOTIFY_IMAP_JUNK: `Junk${CR}${LF}a1 DELETE INBOX` })).toThrow(/NOTIFY_IMAP_JUNK/);
  });

  test("the development settings are refused in production, and so is the example's token", () => {
    const dev = { NOTIFY_IMAP_PORT: "51993", NOTIFY_IMAP_CA: "/repo/.data/dev-mailbox/ca.pem", NOTIFY_PUSH_URL: "http://127.0.0.1:2586" };
    expect(readSettings({ ...good, ...dev, NODE_ENV: "development" }, () => "PEM")).toMatchObject({ imap: { port: 51993, ca: "PEM" }, push: { url: "http://127.0.0.1:2586" } });
    for (const [name, value] of Object.entries(dev)) {
      expect(() => readSettings({ ...good, [name]: value, NODE_ENV: "production" }, () => "PEM"), name).toThrow(new RegExp(`${name}.*production`));
    }
    expect(() => readSettings({ ...good, NTFY_PUBLISH_TOKEN: "tk_korbatdevpublisher00000000001", NODE_ENV: "production" })).toThrow(/NTFY_PUBLISH_TOKEN/);
    expect(() => readSettings({ ...good, NOTIFY_IMAP_PORT: "993x", NODE_ENV: "development" })).toThrow(/NOTIFY_IMAP_PORT/);
  });
});
