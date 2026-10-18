import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import pino, { type Logger } from "pino";
import { ALERT_RULES, PUSH_KINDS, type AlertKind, type AlertScope, type ContactFolder, type NotifyError } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { ImapFailure, checkImapValue, openImap, type ImapSession } from "./imap";
import { publish, type OwedPush } from "./push";

export type { OwedPush } from "./push";

/**
 * notify, the contact point's watcher (3f design, sections 5 and 7.1): an entry point of the API's image
 * (dist/notify.js) that runs one loop, alone, with its own database role, korbat_notify, and no lock. Every
 * ALERT_RULES.pollSeconds after the last round ended:
 *   1. it reads INBOX and the junk folder over IMAP (imap.ts), read-only, and inserts one row of contact_messages a new
 *      message, each in a transaction of its own with the folder's mark, so the first push never waits for the rest of a
 *      long folder; the database's triggers force the row's times and write the message's first push;
 *   2. it publishes every row of alert_outbox still owed its push (push.ts), oldest first, with no cap on attempts;
 *   3. it beats: notify_state says when it last ran, last read both folders and last published, and the word of its
 *      last failure, which the API's alert tick reads for the channel's health.
 * It reads no header, body or flag of any message, holds no SMTP credential, and imports the contracts and nothing of
 * the API's modules. It stops itself rather than hang: it exits 1 when the database has been unreachable for longer than
 * a round, or when no round has finished for WATCHDOG_MS, and Docker starts it again.
 */

/** No round finished for this long: the process exits, and Docker starts it again. */
export const WATCHDOG_MS = 2 * 60_000;
/** The file whose time the Compose health check reads: written after every round that reached the database. */
export const HEALTH_FILE = join(tmpdir(), "korbat-notify-beat");
/** The example's ntfy token (infra/ntfy/server.yml.example), which production refuses, as the API refuses test keys. */
export const EXAMPLE_PUBLISH_TOKENS: readonly string[] = ["tk_korbatdevpublisher00000000001"];

// ---------------------------------------------------------------- settings

export interface NotifySettings {
  databaseUrl: string;
  production: boolean;
  imap: { host: string; port: number; user: string; password: string; junk: string; ca?: string; timeoutMs?: number };
  push: { url: string; token: string };
}

/**
 * The watcher's settings. No setting of a profiled service is required by Compose (it writes `${NAME:-}`), so the
 * program refuses to start on an empty one, naming it. NOTIFY_IMAP_PORT, NOTIFY_IMAP_CA and NOTIFY_PUSH_URL are for the
 * development mailbox alone, and production refuses them, as it refuses the example's ntfy token.
 */
export function readSettings(env: Record<string, string | undefined>, readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): NotifySettings {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === "") throw new Error(`${name} is not set: notify cannot start without it (infra/.env, README Upgrading)`);
    return value;
  };
  const production = (env.NODE_ENV ?? "production").trim() !== "development" && (env.NODE_ENV ?? "").trim() !== "test";
  const devOnly = (name: string): string | undefined => {
    const value = env[name];
    if (value === undefined || value.trim() === "") return undefined;
    if (production) throw new Error(`${name} is for the development mailbox only and is refused in production`);
    return value.trim();
  };
  const settings: NotifySettings = {
    databaseUrl: required("DATABASE_URL_NOTIFY"),
    production,
    imap: { host: required("NOTIFY_IMAP_HOST").trim(), port: 993, user: required("NOTIFY_IMAP_USER"), password: required("NOTIFY_IMAP_PASSWORD"), junk: required("NOTIFY_IMAP_JUNK") },
    push: { url: "http://ntfy:2586", token: required("NTFY_PUBLISH_TOKEN").trim() },
  };
  for (const name of ["NOTIFY_IMAP_HOST", "NOTIFY_IMAP_USER", "NOTIFY_IMAP_PASSWORD", "NOTIFY_IMAP_JUNK", "NTFY_PUBLISH_TOKEN"]) checkImapValue(name, env[name]!);
  // Compose builds the URL from KORBAT_NOTIFY_DB_PASSWORD, which it does not require: an empty one is that setting missing.
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(settings.databaseUrl);
  } catch {
    throw new Error("DATABASE_URL_NOTIFY is not a PostgreSQL URL");
  }
  if (databaseUrl.password === "") throw new Error("KORBAT_NOTIFY_DB_PASSWORD is not set: notify cannot sign in to the database without it (infra/.env, README Upgrading)");
  if (production && EXAMPLE_PUBLISH_TOKENS.includes(settings.push.token)) throw new Error("NTFY_PUBLISH_TOKEN is the example's token: production needs the publisher's own (README, On call)");
  const port = devOnly("NOTIFY_IMAP_PORT");
  if (port !== undefined) {
    if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("NOTIFY_IMAP_PORT must be a port number");
    settings.imap.port = Number(port);
  }
  const ca = devOnly("NOTIFY_IMAP_CA");
  if (ca !== undefined) settings.imap.ca = readFile(ca);
  const pushUrl = devOnly("NOTIFY_PUSH_URL");
  if (pushUrl !== undefined) {
    if (!/^https?:[/][/][^/]+$/.test(pushUrl)) throw new Error("NOTIFY_PUSH_URL must be an origin such as http://127.0.0.1:2586");
    settings.push.url = pushUrl;
  }
  return settings;
}

// ---------------------------------------------------------------- the database's side

/** The watcher's statements, each within the grants of korbat_notify: its four tables and order_rules(), nothing else. */
export interface NotifyStore {
  /** A folder's mark: its validity and the highest UID inserted, or null before the first read. */
  folderMark(folder: ContactFolder): Promise<{ uidvalidity: number | null; lastUid: number | null } | null>;
  /** One message's row and the folder's mark, in one transaction; a message already there is left as it is. */
  insertMessage(folder: ContactFolder, uidvalidity: number, uid: number, receivedAt: Date): Promise<void>;
  /** The folder's mark as the round leaves it, also when the folder held nothing new. */
  setMark(folder: ContactFolder, uidvalidity: number, lastUid: number): Promise<void>;
  /**
   * Every row still owed its push: not pushed, of a kind with a push leg, younger than push_owed_minutes. Priority 5
   * first; within a priority an order's rows and each subject's first ring (step 0) first; then oldest first (3f's
   * review, operations3: a flood of escalations never holds an order's reminder behind it).
   */
  owedPushes(kinds: readonly AlertKind[]): Promise<OwedPush[]>;
  markPushed(id: number): Promise<void>;
  /** One more failed attempt, for the log: no cap. */
  markFailed(id: number): Promise<void>;
  /**
   * The beat: now, and now for the mailbox and the push when the round read both folders and pushed what it owed, or
   * pushed until ntfy's request limit asked it to wait (the channel's check reads a fresh push_ok_at as ntfy answering).
   */
  beat(state: { mailboxOk: boolean; pushOk: boolean; error: NotifyError | null }): Promise<void>;
}

/** A list of words as a PostgreSQL array, for `= any(...)`. The kinds are the contracts' own words: no comma or quote. */
const textArray = (values: readonly string[]) => sql`${`{${values.join(",")}}`}::text[]`;

export function createStore(db: Db): NotifyStore {
  return {
    async folderMark(folder) {
      const [row] = await db.execute<{ uidvalidity: string | null; last_uid: string | null }>(sql`select uidvalidity, last_uid from public.notify_folders where folder = ${folder}`);
      return row ? { uidvalidity: row.uidvalidity === null ? null : Number(row.uidvalidity), lastUid: row.last_uid === null ? null : Number(row.last_uid) } : null;
    },
    async insertMessage(folder, uidvalidity, uid, receivedAt) {
      await db.transaction(async (tx) => {
        // The unique key of folder, validity and UID drops a message read twice (a round stopped before its mark).
        await tx.execute(sql`insert into public.contact_messages (folder, uidvalidity, uid, received_at) values (${folder}, ${uidvalidity}, ${uid}, ${receivedAt.toISOString()}) on conflict do nothing`);
        await tx.execute(sql`insert into public.notify_folders (folder, uidvalidity, last_uid) values (${folder}, ${uidvalidity}, ${uid})
          on conflict (folder) do update set uidvalidity = excluded.uidvalidity,
            last_uid = greatest(case when public.notify_folders.uidvalidity = excluded.uidvalidity then public.notify_folders.last_uid else 0 end, excluded.last_uid)`);
      });
    },
    async setMark(folder, uidvalidity, lastUid) {
      await db.execute(sql`insert into public.notify_folders (folder, uidvalidity, last_uid) values (${folder}, ${uidvalidity}, ${lastUid})
        on conflict (folder) do update set uidvalidity = excluded.uidvalidity, last_uid = excluded.last_uid`);
    },
    async owedPushes(kinds) {
      const rows = await db.execute<{ id: string; kind: AlertKind; priority: number; scope: AlertScope; facts: Record<string, number | string> }>(sql`
        select o.id, o.kind, o.priority, o.scope, o.facts from public.alert_outbox o
         where o.pushed_at is null and o.kind = any(${textArray(kinds)})
           and o.created_at > now() - make_interval(mins => (select r.push_owed_minutes from public.order_rules() r))
         order by o.priority desc, (o.order_id is not null) desc, coalesce(o.step = 0, false) desc, o.id`);
      return rows.map((row) => ({ id: Number(row.id), kind: row.kind, priority: row.priority === 5 ? 5 : 3, scope: row.scope, facts: row.facts }));
    },
    async markPushed(id) {
      await db.execute(sql`update public.alert_outbox set pushed_at = now() where id = ${id} and pushed_at is null`);
    },
    async markFailed(id) {
      await db.execute(sql`update public.alert_outbox set push_attempts = push_attempts + 1 where id = ${id}`);
    },
    async beat({ mailboxOk, pushOk, error }) {
      await db.execute(sql`insert into public.notify_state (id, beat_at, mailbox_ok_at, push_ok_at, error)
        values (1, now(), case when ${mailboxOk} then now() end, case when ${pushOk} then now() end, ${error})
        on conflict (id) do update set beat_at = excluded.beat_at,
          mailbox_ok_at = coalesce(excluded.mailbox_ok_at, public.notify_state.mailbox_ok_at),
          push_ok_at = coalesce(excluded.push_ok_at, public.notify_state.push_ok_at),
          error = excluded.error`);
    },
  };
}

// ---------------------------------------------------------------- the round

export interface WatcherDeps {
  store: NotifyStore;
  imap: NotifySettings["imap"];
  push: NotifySettings["push"];
  fetch: typeof fetch;
  now(): Date;
  log: Logger;
}

export interface RoundReport {
  /** Both folders were read. */
  mailboxOk: boolean;
  /** Every publish of the round succeeded, or nothing was owed, or it stopped at ntfy's request limit with none failed. */
  pushOk: boolean;
  /** The word of the round's last failure, or null. */
  error: NotifyError | null;
  /** ntfy's request limit answered 429 and the round published nothing more: the rest wait for the next round. */
  throttled: boolean;
  inserted: number;
  pushed: number;
}

/**
 * The watcher's loop body, holding its IMAP connection from one round to the next. A failure of the mail host or of
 * ntfy is a word in the beat; a failure of the database is thrown, for the caller to judge.
 */
export function createWatcher(deps: WatcherDeps) {
  let session: ImapSession | null = null;

  /** Both folders, INBOX and then the junk folder, from each one's mark; answers how many messages it inserted. */
  async function readMailbox(): Promise<number> {
    // NOOP keeps the connection between rounds; a dropped one is found here and opened again in this round.
    if (session !== null && !session.closed) {
      try {
        await session.noop();
      } catch (err) {
        if (!(err instanceof ImapFailure)) throw err;
        session.close();
        session = null;
      }
    }
    if (session === null || session.closed) session = await openImap(deps.imap);
    let inserted = 0;
    const folders: [ContactFolder, string][] = [
      ["inbox", "INBOX"],
      ["junk", deps.imap.junk],
    ];
    for (const [folder, name] of folders) {
      const validity = await session.examine(name);
      const mark = await deps.store.folderMark(folder);
      // A changed (or first) validity resets the mark: the folder is read whole, and its messages are new rows.
      const last = mark !== null && mark.uidvalidity === validity ? (mark.lastUid ?? 0) : 0;
      const messages = await session.fetchSince(last);
      for (const message of messages) {
        await deps.store.insertMessage(folder, validity, message.uid, message.internalDate);
        inserted++;
      }
      await deps.store.setMark(folder, validity, messages.at(-1)?.uid ?? last);
    }
    return inserted;
  }

  async function round(): Promise<RoundReport> {
    let error: NotifyError | null = null;
    let mailboxOk = false;
    let inserted = 0;
    try {
      inserted = await readMailbox();
      mailboxOk = true;
    } catch (err) {
      if (!(err instanceof ImapFailure)) throw err;
      error = err.word;
      deps.log.warn({ error: err.word, reason: err.message }, "notify: the mailbox could not be read this round");
      session?.close();
      session = null;
    }
    let pushOk = true;
    let pushed = 0;
    let throttled = false;
    for (const row of await deps.store.owedPushes(PUSH_KINDS)) {
      const outcome = await publish(deps.fetch, deps.push.url, deps.push.token, row, deps.now());
      if (outcome === "ok") {
        await deps.store.markPushed(row.id);
        pushed++;
      } else if (outcome === "throttled") {
        // 3f's review (operations3): ntfy is up and asks the publisher to wait. The row stays owed with no attempt
        // counted, the beat does not say the push failed, and the round stops here: every later row would be refused
        // too, and one taken after a refill mid-round would go ahead of the rows in front of it.
        throttled = true;
        deps.log.warn({ alert: row.id, kind: row.kind, pushed }, "notify: ntfy's request limit was reached; the rest are published from the next round");
        break;
      } else {
        await deps.store.markFailed(row.id);
        pushOk = false;
        error = outcome;
        deps.log.warn({ error: outcome, alert: row.id, kind: row.kind }, "notify: a push was not taken; it is tried again next round");
      }
    }
    await deps.store.beat({ mailboxOk, pushOk, error });
    return { mailboxOk, pushOk, error, throttled, inserted, pushed };
  }

  /** LOGOUT and the connection closed. */
  async function stop(): Promise<void> {
    const open = session;
    session = null;
    await open?.logout();
  }

  return { round, stop };
}

// ---------------------------------------------------------------- the process

/** Runs the loop until SIGTERM. Never returns. */
export async function runNotify(env: Record<string, string | undefined> = process.env): Promise<void> {
  const settings = readSettings(env);
  const log = pino({ level: env.LOG_LEVEL?.trim() || "info", base: { service: "notify" } });
  const db = createDb(settings.databaseUrl, { max: 2 });
  const watcher = createWatcher({ store: createStore(db), imap: settings.imap, push: settings.push, fetch, now: () => new Date(), log });
  const pollMs = ALERT_RULES.pollSeconds * 1000;
  let lastRoundEnd = Date.now();
  /** When the database first failed a round, or null while it answers. */
  let databaseDownSince: number | null = null;
  let stopping = false;

  // A round that hangs (a socket that never answers, a statement that never returns) is ended by Docker: the watchdog
  // exits, and the container is started again.
  const watchdog = setInterval(() => {
    if (Date.now() - lastRoundEnd > WATCHDOG_MS) {
      log.error("notify: no round has finished for two minutes; exiting so that Docker starts it again");
      process.exit(1);
    }
  }, 10_000);
  watchdog.unref();

  process.once("SIGTERM", () => {
    stopping = true;
    void (async () => {
      await watcher.stop().catch(() => undefined);
      await closeDb(db).catch(() => undefined);
      process.exit(0);
    })();
  });

  log.info({ host: settings.imap.host, port: settings.imap.port }, "notify: started");
  while (!stopping) {
    try {
      const report = await watcher.round();
      databaseDownSince = null;
      writeFileSync(HEALTH_FILE, String(Date.now()));
      if (report.inserted > 0 || report.pushed > 0 || report.error !== null || report.throttled) log.info(report, "notify: round");
    } catch (err) {
      databaseDownSince ??= Date.now();
      log.error({ err }, "notify: a round could not reach the database");
      if (Date.now() - databaseDownSince > pollMs) {
        log.error("notify: the database has been unreachable for longer than a round; exiting so that Docker starts it again");
        process.exit(1);
      }
    }
    lastRoundEnd = Date.now();
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runNotify().catch((err: unknown) => {
    // A setting it cannot start without: one sentence that names it, and exit 1.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
