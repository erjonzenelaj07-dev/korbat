/**
 * The staff command line's records to authorities (3f design, sections 6.5, 7.13, 7.14 and 8.11, "Notifications to
 * authorities" and "Productions and the hand-over"; W.8): what only the operator records, as the migrator, in the migrate
 * service. The API's role holds no grant on these tables, so the console can never learn who was reported to whom; it
 * sees through reports_owed() only that a report is owed, for which case and since when.
 *
 * Every command but `records` is one transaction with the 10-second lock timeout and ends with its audit row under the
 * system actor: notification_recorded (target the record; the steps opened, sent and declined carry their case, seal,
 * duties and kinds; the steps answered and event only the digest of the record's row), production_recorded (target the
 * production; its step and the digest of its row) and address_checked (target the account; whether it matched). A later
 * step names no person in the audit log, which the API reads and the keeper copies off the server: the digest proves the
 * row and `records --verify` recomputes it. notification-sent and notification-declined take the account's row of
 * auth.report_holds first and the record after it, as report_open() does, so that a seal committing beside them either
 * finds the record still owed or finds it closed and opens its own. Every printed line starts with its command's name,
 * but the facts of an account (W.8: "name: value" lines) and the hand-over's list on standard output; a refusal is one
 * sentence ending in "nothing changed", exit 1. No command prints, takes or opens an image, and none sends anything: the
 * operator sends, the command records.
 *
 * 3f Task 6 (sections 6.6, 7.17 step 3 and 8.11): after a restore, a record that the import could only note is entered
 * again with the command that wrote it and `--gap <gap>`: every command here that writes a record takes it, and closes
 * that gap, an open gap of the class record, as imported, in its own transaction, before its own rows; a refusal of the
 * command leaves the gap open.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { sql } from "drizzle-orm";
import {
  HANDOVER_INSTRUMENTS,
  MemberStateCode,
  NOTIFICATION_ANSWERS,
  NOTIFICATION_DUTIES,
  NOTIFICATION_EVENT_KINDS,
  NOTIFICATION_SENT_KINDS,
  NOT_HELD_KINDS,
  RECORDS_NOT_HELD,
  RECORDS_NOT_HELD_VERSION,
  recordDigestOf,
  type NotificationSentKind,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { sealAvatarFiles, sealFiles } from "../media";
import { appendAuditRow } from "../staff";
import { Refusal, UUID, authorityText, flag, freeText, instant, isoOf, orderNamed, refuse, rows } from "./orders";

/** The record commands, each with its first line of STAFF_USAGE. */
export const RECORD_COMMANDS = [
  "records",
  "notification-open",
  "notification-facts",
  "notification-sent",
  "notification-declined",
  "notification-answer",
  "notification-event",
  "production-account",
  "address-check",
  "handover-list",
  "handover-record",
  "handover-destroyed",
] as const;
export type RecordCommandName = (typeof RECORD_COMMANDS)[number];

export const RECORD_USAGE = [
  "  records [--verify]                     list the notifications owed and the hand-over archives not recorded as destroyed;",
  "                                         --verify recomputes each record's digest against its audit row",
  "  notification-open --case <id> --duty <dsa18_1|dsa18_2|tco14_5|voluntary>   open a record for a check that no seal opened",
  "  notification-facts <record>            print the account's handle, address and creation time and its posts, as a production",
  "  notification-sent <record> --authority <name> --channel <text> --duty <duty> ... --state <CC|none> --basis <text>",
  "             --own-reference <text> --kinds <kind,...> --at <instant> --by <name> [--receipt <text>]",
  "                                         record the notification, by kind and never by value; releases the address hold",
  "  notification-declined <record> --reason <text> --by <name>   a check that ended in no; releases the address hold",
  "  notification-answer <record> --their-reference <text> --at <instant> [--answer <not_illegal|illegal|no_assessment|other>]",
  "  notification-event <record> --kind <request|answer|note> --at <instant> --how <text> [--reference <text>]",
  "             [--not-to-person [--until <instant>]]   a later request or answer, and whether the person may not be told",
  "  production-account <order> --handle <handle> --asked <kind,...>   an order to provide information: the three facts, recorded",
  "  address-check --handle <handle> < address   whether the address on standard input is the account's (run with -T)",
  "  handover-list <seal action> --instrument <notification|demand|court_order|seizure> --authority <name> --reference <text>",
  "                                         open a production and list the stored files of that seal's posts",
  "  handover-record <production> --channel <text> --receipt <text> < digests   (or --taken for a seizure; run with -T)",
  "  handover-destroyed <production> --how <text>   every copy outside the store is destroyed",
  "  A <record> and a <production> are their ids, as records prints them; a <seal action> is the seal's ledger row's id.",
  "  After a restore, each command that writes a record also takes --gap <gap>: the gap, of the class record, that the record",
  "  enters again, as the console's After a restore screen lists it.",
];

/** A parsed record command: its name, what it names (none for records, notification-open and address-check), its flags. */
export interface RecordCommand {
  command: RecordCommandName;
  target: string | null;
  positional: string[];
  flags: Map<string, string[]>;
}

/** Flags that take no value. */
const SWITCHES = new Set(["--verify", "--not-to-person", "--taken"]);
/** The commands that name no record, production, seal or order in front of their flags. */
const UNTARGETED = new Set<RecordCommandName>(["records", "notification-open", "address-check"]);

/** Splits a command's words into what it names, its positional words and its flags; a flag may repeat (--duty). */
export function parseRecordArgs(command: RecordCommandName, rest: readonly string[]): RecordCommand {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (word.startsWith("--")) {
      if (SWITCHES.has(word)) {
        flags.set(word, [...(flags.get(word) ?? []), ""]);
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined) throw new Error(`${command}: ${word} needs a value`);
      flags.set(word, [...(flags.get(word) ?? []), value]);
      i++;
    } else positional.push(word);
  }
  if (UNTARGETED.has(command)) {
    if (positional.length > 0) throw new Error(`${command}: takes no ${positional[0]}`);
    return { command, target: null, positional, flags };
  }
  const [target, ...others] = positional;
  if (target === undefined) throw new Error(`${command}: name the ${command === "production-account" ? "order, by its id or as <CC>:<reference>" : command.startsWith("handover-list") ? "seal's ledger row by its id" : command.startsWith("handover") ? "production by its id" : "record by its id"}`);
  return { command, target, positional: others, flags };
}

/** What a command reports: its lines on standard output and its notes on standard error, or its one sentence of refusal. */
export type RecordDone = { ok: true; lines: string[]; notes: string[] } | { ok: false; problem: string };

const has = (cmd: RecordCommand, name: string) => cmd.flags.has(name);
/** A free text of at most 200 characters on one line: a person's or a channel's name, a receipt's words. */
function shortText(command: string, name: string, text: string): string {
  const checked = freeText(command, name, text);
  if (Array.from(checked).length > 200) refuse(command, `${name} has more than 200 characters`);
  return checked;
}
/** A list of kinds, comma-separated, each of NOTIFICATION_SENT_KINDS, each once. */
function kindsOf(command: string, name: string, word: string): NotificationSentKind[] {
  const kinds = word.split(",").map((kind) => kind.trim());
  const list = NOTIFICATION_SENT_KINDS as readonly string[];
  if (kinds.some((kind) => !list.includes(kind)) || new Set(kinds).size !== kinds.length) {
    refuse(command, `${name} takes ${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);
  }
  return kinds as NotificationSentKind[];
}
/** An instant that has already happened. */
function pastInstant(command: string, name: string, word: string): Date {
  const at = instant(command, word);
  if (at.getTime() > Date.now()) refuse(command, `${name} is in the future`);
  return at;
}
const HANDLE = /^@?[A-Za-z0-9_]{1,64}$/;
function handleOf(command: string, word: string): string {
  if (!HANDLE.test(word)) refuse(command, `${word} is not a handle`);
  return word.replace(/^@/, "").toLowerCase();
}
function idOf(command: string, what: string, word: string): string {
  const id = word.toLowerCase();
  if (!UUID.test(id)) refuse(command, `${word} is not ${what}'s id`);
  return id;
}

// ---------------------------------------------------------------- digests

/**
 * The digest of a record's row as the database holds it now (10.5): a notification with its events, or a production,
 * printed by PostgreSQL as jsonb in UTC and written in the contracts' canonical JSON. Read in a transaction (a savepoint
 * inside the caller's), whose time zone is UTC, so that a time prints the same whatever the session's setting.
 */
export async function recordDigest(q: Db | DbTx, kind: "notification" | "production", id: string): Promise<string> {
  const row = await q.transaction(async (tx) => {
    await tx.execute(sql`set local timezone to 'UTC'`);
    if (kind === "production") {
      const [found] = await rows<{ production: unknown }>(tx, sql`select to_jsonb(p) as production from public.productions p where p.id = ${id}::uuid`);
      return found === undefined ? null : { production: found.production };
    }
    const [found] = await rows<{ record: unknown; events: unknown }>(
      tx,
      sql`select to_jsonb(n) as record,
                 coalesce((select jsonb_agg(to_jsonb(e) order by e.at, e.id) from public.authority_notification_events e where e.notification_id = n.id), '[]'::jsonb) as events
            from public.authority_notifications n where n.id = ${id}::uuid`,
    );
    return found === undefined ? null : { record: found.record, events: found.events };
  });
  if (row === null) throw new Error(`no ${kind} has the id ${id}`);
  return recordDigestOf(row);
}

const notificationRecorded = (tx: DbTx, id: string, metadata: Record<string, unknown>) =>
  appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "notification_recorded", targetType: "notification", targetId: id, requestId: null, metadata });
const productionRecorded = async (tx: DbTx, id: string, step: "account" | "listed" | "recorded" | "destroyed") =>
  appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "production_recorded", targetType: "production", targetId: id, requestId: null, metadata: { step, digest: await recordDigest(tx, "production", id) } });

// ---------------------------------------------------------------- running

/** Runs one record command as the migrator, in one transaction with the 10-second lock timeout; a refusal changes nothing. */
export async function recordCommand(migrateDb: Db, cmd: RecordCommand, input: () => Promise<Buffer>): Promise<RecordDone> {
  // Standard input is read before the transaction opens: nothing holds a lock while a person types or a pipe drains.
  const stdin = cmd.command === "address-check" || (cmd.command === "handover-record" && !has(cmd, "--taken")) ? await input() : null;
  const notes: string[] = [];
  try {
    const lines = await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      // Task 6: the gap first, under its row lock, so that a command whose own refusal rolls it back leaves it open.
      const gap = has(cmd, "--gap") ? await closeRecordGap(tx, cmd) : null;
      const done = await run(tx, cmd, stdin, notes);
      return gap === null ? done : [...done, `${cmd.command}: gap ${gap} is closed: the record is entered again.`];
    });
    return { ok: true, lines, notes };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}

async function run(tx: DbTx, cmd: RecordCommand, stdin: Buffer | null, notes: string[]): Promise<string[]> {
  switch (cmd.command) {
    case "records":
      return records(tx, cmd);
    case "notification-open":
      return notificationOpen(tx, cmd);
    case "notification-facts":
      return notificationFacts(tx, cmd);
    case "notification-sent":
    case "notification-declined":
      return notificationClosed(tx, cmd);
    case "notification-answer":
      return notificationAnswer(tx, cmd);
    case "notification-event":
      return notificationEvent(tx, cmd);
    case "production-account":
      return productionAccount(tx, cmd);
    case "address-check":
      return addressCheck(tx, cmd, stdin!);
    case "handover-list":
      return handoverList(tx, cmd, notes);
    case "handover-record":
      return handoverRecord(tx, cmd, stdin);
    case "handover-destroyed":
      return handoverDestroyed(tx, cmd);
  }
}

// ---------------------------------------------------------------- a record entered again after a restore (Task 6)

/** The commands that enter no record, and so take no --gap. */
const NO_GAP = new Set<RecordCommandName>(["records", "address-check"]);

/**
 * --gap <gap> (8.11): closes an open gap of the class record as imported, as the migrator, and writes nothing else of
 * the row: "<command>: gap <id> is not an open gap of the class record; nothing changed" for any other gap. Answers the
 * gap's id, for the command's last line.
 */
async function closeRecordGap(tx: DbTx, cmd: RecordCommand): Promise<string> {
  const c = cmd.command;
  if (NO_GAP.has(c)) refuse(c, "takes no --gap: it enters no record");
  const word = flag(cmd, "--gap")!;
  const gap = word.toLowerCase();
  if (!UUID.test(gap)) refuse(c, `gap ${word} is not an open gap of the class record`);
  const [found] = await rows<{ id: string }>(tx, sql`select g.id from public.restore_gaps g where g.id = ${gap}::uuid and g.class = 'record' and g.closed_at is null for update`);
  if (found === undefined) refuse(c, `gap ${gap} is not an open gap of the class record`);
  await tx.execute(sql`update public.restore_gaps set closed_at = now(), disposition = 'imported' where id = ${gap}::uuid`);
  return gap;
}

// ---------------------------------------------------------------- records

interface OwedLine {
  id: string;
  case_id: string | null;
  duties: string[];
  since: string;
  held_until: string | null;
}

/**
 * records: the owed notifications, each with its case, duties, since when and until when the account's address is
 * held, and the hand-overs whose copies are not recorded as destroyed. Reads only, writes no audit row. With --verify
 * it recomputes each record's newest audit row from the record's row (the digest, or the facts of an opened, sent or
 * declined step) and fails naming the first that differs: a record changed around the command line.
 */
async function records(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const owed = await rows<OwedLine>(
    tx,
    sql`select n.id, n.case_id, n.duties, ${isoOf("n.opened_at")} as since, ${isoOf("auth.address_held_until(n.account_id)")} as held_until
          from public.authority_notifications n where n.state = 'owed' order by n.opened_at, n.id`,
  );
  const archives = await rows<{ id: string; instrument: string; delivered: string | null }>(
    tx,
    sql`select p.id, p.instrument, ${isoOf("p.delivered_at")} as delivered from public.productions p
         where p.files is not null and p.destroyed_at is null order by p.opened_at, p.id`,
  );
  const lines = [`${c}: ${owed.length} notifications owed, ${archives.length} archives not recorded as destroyed.`];
  for (const row of owed) {
    lines.push(
      `${c}: ${row.id}: case ${row.case_id ?? "none"}, duties ${row.duties.length === 0 ? "none" : row.duties.join(",")}, owed since ${row.since}, ` +
        (row.held_until === null ? "address not held" : `address held until ${row.held_until}`),
    );
  }
  for (const row of archives) lines.push(`${c}: production ${row.id}: ${row.instrument}, ${row.delivered === null ? "not delivered yet" : `delivered ${row.delivered}`}, not recorded as destroyed`);
  if (!has(cmd, "--verify")) return lines;

  let checked = 0;
  const notifications = await rows<{ id: string; place: number; metadata: Record<string, unknown>; case_id: string | null; seal_action_id: string | null; duties: string[]; sent_kinds: string[] | null }>(
    tx,
    sql`select n.id, a.chain_seq::int as place, a.metadata, n.case_id, n.seal_action_id, n.duties, n.sent_kinds
          from public.authority_notifications n
          join lateral (select l.chain_seq, l.metadata from public.audit_log l
                         where l.action = 'notification_recorded' and l.target_id = n.id::text order by l.chain_seq desc limit 1) a on true
         order by n.opened_at, n.id`,
  );
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const row of notifications) {
    const m = row.metadata;
    const holds =
      typeof m.digest === "string"
        ? m.digest === (await recordDigest(tx, "notification", row.id))
        : same(m.caseId, row.case_id) && same(m.sealActionId, row.seal_action_id) && same(m.duties, row.duties) && (m.step === "opened" || same(m.sentKinds, row.sent_kinds));
    if (!holds) throw new Refusal(`${c}: notification ${row.id} differs from its audit row at place ${row.place}`);
    checked++;
  }
  const productions = await rows<{ id: string; place: number; digest: string | null }>(
    tx,
    sql`select p.id, a.chain_seq::int as place, a.metadata ->> 'digest' as digest
          from public.productions p
          join lateral (select l.chain_seq, l.metadata from public.audit_log l
                         where l.action = 'production_recorded' and l.target_id = p.id::text order by l.chain_seq desc limit 1) a on true
         order by p.opened_at, p.id`,
  );
  for (const row of productions) {
    if (row.digest !== (await recordDigest(tx, "production", row.id))) throw new Refusal(`${c}: production ${row.id} differs from its audit row at place ${row.place}`);
    checked++;
  }
  lines.push(`${c}: --verify: ${checked} records recompute to their newest audit row.`);
  return lines;
}

// ---------------------------------------------------------------- notifications

/** notification-open: a record for a check on content that no seal opened one for (7.13 step 5); no hold. */
async function notificationOpen(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const caseId = idOf(c, "a case", flag(cmd, "--case")!);
  const duty = flag(cmd, "--duty")!;
  if (!(NOTIFICATION_DUTIES as readonly string[]).includes(duty)) refuse(c, "--duty is dsa18_1, dsa18_2, tco14_5 or voluntary");
  const [found] = await rows<{ subject: string | null; first: string | null }>(
    tx,
    sql`select case when k.target_type = 'account' then k.target_id else (select p.author_id from public.posts p where p.id = k.target_id) end as subject,
               (select min(i.created_at) from public.intake_items i where i.case_id = k.id)::text as first
          from public.cases k where k.id = ${caseId}::uuid`,
  );
  if (!found) return refuse(c, `no case has the id ${caseId}`);
  const [made] = await rows<{ id: string; since: string }>(
    tx,
    sql`insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via, first_report_at)
        values ('owed', ${`{${duty}}`}::text[], ${caseId}::uuid, ${found.subject}::uuid, now(), 'cli', ${found.first}::timestamptz)
        returning id, ${isoOf("opened_at")} as since`,
  );
  await notificationRecorded(tx, made!.id, { step: "opened", caseId, sealActionId: null, duties: [duty], sentKinds: null, at: made!.since });
  return [`${c}: record ${made!.id}, owed since ${made!.since}.`];
}

/** The record a command names, under its row lock, or a refusal. */
async function lockRecord(tx: DbTx, command: string, word: string, lock: "update" | "share" = "update") {
  const id = idOf(command, "a record", word);
  await tx.execute(lock === "update" ? sql`select 1 from public.authority_notifications where id = ${id}::uuid for update` : sql`select 1 from public.authority_notifications where id = ${id}::uuid for share`);
  const [row] = await rows<{ id: string; state: string; case_id: string | null; seal_action_id: string | null; account_id: string | null; duties: string[]; opened_via: string }>(
    tx,
    sql`select id, state, case_id, seal_action_id, account_id, duties, opened_via from public.authority_notifications where id = ${id}::uuid`,
  );
  return row ?? refuse(command, `no notification record has the id ${id}`);
}

/** The three facts korbat gives of an account, as W.8's "name: value" lines, and whether its address is still held. */
async function accountFacts(tx: DbTx, accountId: string): Promise<{ lines: string[]; address: boolean }> {
  const [row] = await rows<{ handle: string | null; email: string | null; created_at: string | null; purged: boolean | null }>(
    tx,
    sql`select (select p.handle from public.profiles p where p.id = a.id) as handle, u.email, ${isoOf("u.created_at")} as created_at, u.purged_at is not null as purged
          from (select ${accountId}::uuid as id) a left join auth.users u on u.id = a.id`,
  );
  const purged = row?.purged !== false;
  return {
    lines: [
      `handle: ${row?.handle ? `@${row.handle}` : "not held"}`,
      // A purged account's address is overwritten: what korbat no longer holds, it cannot print.
      `email: ${purged || row?.email == null ? "not held: the account's deletion has overwritten it" : row.email}`,
      `created_at: ${row?.created_at ?? "not held"}`,
    ],
    address: !purged && row?.email != null,
  };
}

/**
 * notification-facts (in place of 3c's account-facts): for an owed record, the account's handle, address and creation
 * time, then the ids and times of the record's posts (the case's post and the posts of the seal that opened it), then
 * W.8's sentence of what korbat does not hold; it records the reading as a production of the instrument notification.
 * The address is read here while the hold keeps it, and nowhere else but production-account.
 */
async function notificationFacts(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const record = await lockRecord(tx, c, cmd.target!, "share");
  if (record.state !== "owed") refuse(c, `record ${record.id} is ${record.state}, not owed`);
  if (record.account_id === null) refuse(c, `record ${record.id} names no account`);
  const facts = await accountFacts(tx, record.account_id!);
  const posts = await rows<{ id: string; created_at: string }>(
    tx,
    sql`select p.id, ${isoOf("p.created_at")} as created_at from public.posts p
         where p.id in (select k.target_id from public.cases k where k.id = ${record.case_id}::uuid and k.target_type = 'post'
                        union select s.post_id from public.seal_posts s where s.action_id = ${record.seal_action_id}::uuid)
         order by p.created_at, p.id`,
  );
  const produced = ["handle", ...(facts.address ? ["address"] : []), "created_at", ...(posts.length > 0 ? ["post_ids", "post_times"] : [])];
  const [made] = await rows<{ id: string }>(
    tx,
    sql`insert into public.productions (instrument, notification_id, seal_action_id, account_id, produced, not_held, opened_at)
        values ('notification', ${record.id}::uuid, ${record.seal_action_id}::uuid, ${record.account_id}::uuid, ${`{${produced.join(",")}}`}::text[],
                ${`{${NOT_HELD_KINDS.join(",")}}`}::text[], now())
        returning id`,
  );
  await productionRecorded(tx, made!.id, "account");
  return [
    ...facts.lines,
    ...posts.flatMap((post) => [`post_id: ${post.id}`, `post_created_at: ${post.created_at}`]),
    RECORDS_NOT_HELD[RECORDS_NOT_HELD_VERSION],
    `${c}: recorded as production ${made!.id}.`,
  ];
}

/**
 * Releases the account's address hold when no record a seal opened is owed for it any more, as the migrator. Answers
 * whether it released one. The caller holds the hold's row since its first statement.
 */
async function releaseHold(tx: DbTx, accountId: string | null, reason: "sent" | "declined"): Promise<boolean> {
  if (accountId === null) return false;
  const released = await rows<{ user_id: string }>(
    tx,
    sql`update auth.report_holds h set released_at = now(), release_reason = ${reason}
         where h.user_id = ${accountId}::uuid and h.released_at is null
           and not exists (select 1 from public.authority_notifications n where n.account_id = h.user_id and n.state = 'owed' and n.opened_via = 'system')
        returning h.user_id`,
  );
  return released.length > 0;
}

interface SentFacts {
  authority: string;
  channel: string;
  duties: string[];
  state: string | null;
  basis: string;
  own: string;
  kinds: NotificationSentKind[];
  at: Date;
  receipt: string | null;
}

/** notification-sent's flags, each checked before any lock is taken. */
function sentFacts(cmd: RecordCommand): SentFacts {
  const c = cmd.command;
  const duties = cmd.flags.get("--duty") ?? refuse(c, "--duty is required");
  if (duties.some((d) => !(NOTIFICATION_DUTIES as readonly string[]).includes(d)) || new Set(duties).size !== duties.length) refuse(c, "--duty is dsa18_1, dsa18_2, tco14_5 or voluntary, each once");
  const stateWord = flag(cmd, "--state")!;
  const state = stateWord === "none" ? null : MemberStateCode.safeParse(stateWord).success ? stateWord : refuse(c, "--state is a Member State's code or none");
  const receipt = flag(cmd, "--receipt", false);
  return {
    authority: authorityText(c, "--authority", flag(cmd, "--authority")!),
    channel: shortText(c, "--channel", flag(cmd, "--channel")!),
    duties,
    state,
    basis: freeText(c, "--basis", flag(cmd, "--basis")!),
    own: authorityText(c, "--own-reference", flag(cmd, "--own-reference")!),
    kinds: kindsOf(c, "--kinds", flag(cmd, "--kinds")!),
    at: pastInstant(c, "--at", flag(cmd, "--at")!),
    receipt: receipt === null ? null : freeText(c, "--receipt", receipt),
  };
}

/**
 * notification-sent and notification-declined. Each takes the account's row of auth.report_holds first and the record
 * after it (the lock order report_open() keeps), refuses a record that is not owed, closes it with what it records, and
 * releases the address hold when no seal's record of the account stays owed.
 */
async function notificationClosed(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const sent = c === "notification-sent";
  // Every flag is read before a lock is taken: a refusal there leaves the tables untouched and unlocked.
  const by = shortText(c, "--by", flag(cmd, "--by")!);
  const reason = sent ? null : freeText(c, "--reason", flag(cmd, "--reason")!);
  const facts = sent ? sentFacts(cmd) : null;
  const id = idOf(c, "a record", cmd.target!);
  const [named] = await rows<{ account_id: string | null }>(tx, sql`select account_id from public.authority_notifications where id = ${id}::uuid`);
  if (!named) return refuse(c, `no notification record has the id ${id}`);
  // The hold's row first, then the record: report_open() takes them in this order.
  if (named.account_id !== null) await tx.execute(sql`select 1 from auth.report_holds where user_id = ${named.account_id}::uuid for update`);
  const record = await lockRecord(tx, c, id);
  if (record.state !== "owed") refuse(c, `record ${record.id} is ${record.state}, not owed`);
  const [done] =
    facts !== null
      ? await rows<{ at: string }>(
          tx,
          sql`update public.authority_notifications
                 set state = 'sent', duties = ${`{${facts.duties.join(",")}}`}::text[], state_concerned = ${facts.state}, state_basis = ${facts.basis},
                     authority = ${facts.authority}, channel = ${facts.channel}, sent_at = ${facts.at.toISOString()}::timestamptz, receipt = ${facts.receipt},
                     sent_by = ${by}, own_reference = ${facts.own}, sent_kinds = ${`{${facts.kinds.join(",")}}`}::text[], not_kept_version = ${RECORDS_NOT_HELD_VERSION},
                     checked_by = ${by}, checked_at = now(), check_result = true, closed_at = now()
               where id = ${record.id}::uuid returning ${isoOf("sent_at")} as at`,
        )
      : await rows<{ at: string }>(
          tx,
          sql`update public.authority_notifications
                 set state = 'declined', declined_reason = ${reason}, checked_by = ${by}, checked_at = now(), check_result = false, check_reason = ${reason}, closed_at = now()
               where id = ${record.id}::uuid returning ${isoOf("closed_at")} as at`,
        );
  const released = await releaseHold(tx, record.account_id, sent ? "sent" : "declined");
  await notificationRecorded(tx, record.id, {
    step: sent ? "sent" : "declined",
    caseId: record.case_id,
    sealActionId: record.seal_action_id,
    duties: facts?.duties ?? record.duties,
    sentKinds: facts?.kinds ?? null,
    at: done!.at,
  });
  const hold = released ? "The address hold is released." : "No address is held for it.";
  return [sent ? `${c}: record ${record.id} sent to ${facts!.authority} at ${done!.at}. ${hold}` : `${c}: record ${record.id} closed. ${hold}`];
}

/** notification-answer: the authority's reference, the day of its answer and its word, on a record that was sent. */
async function notificationAnswer(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const reference = authorityText(c, "--their-reference", flag(cmd, "--their-reference")!);
  const at = pastInstant(c, "--at", flag(cmd, "--at")!);
  const answer = flag(cmd, "--answer", false);
  if (answer !== null && !(NOTIFICATION_ANSWERS as readonly string[]).includes(answer)) refuse(c, "--answer is not_illegal, illegal, no_assessment or other");
  const record = await lockRecord(tx, c, cmd.target!);
  if (record.state !== "sent") refuse(c, `record ${record.id} is ${record.state}: an answer is recorded on a notification that was sent`);
  await tx.execute(sql`update public.authority_notifications set their_reference = ${reference}, answered_at = ${at.toISOString()}::timestamptz, answer = ${answer} where id = ${record.id}::uuid`);
  await notificationRecorded(tx, record.id, { step: "answered", digest: await recordDigest(tx, "notification", record.id) });
  return [`${c}: recorded.`];
}

/** notification-event: a later request or answer about the record's matter, or a note, with "not to the person" and its end. */
async function notificationEvent(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const kind = flag(cmd, "--kind")!;
  if (!(NOTIFICATION_EVENT_KINDS as readonly string[]).includes(kind)) refuse(c, "--kind is request, answer or note");
  const at = pastInstant(c, "--at", flag(cmd, "--at")!);
  const how = freeText(c, "--how", flag(cmd, "--how")!);
  const referenceWord = flag(cmd, "--reference", false);
  const reference = referenceWord === null ? null : authorityText(c, "--reference", referenceWord);
  const notToPerson = has(cmd, "--not-to-person");
  const untilWord = flag(cmd, "--until", false);
  if (untilWord !== null && !notToPerson) refuse(c, "--until is the end of --not-to-person, which is not given");
  const until = untilWord === null ? null : instant(c, untilWord);
  const record = await lockRecord(tx, c, cmd.target!);
  await tx.execute(sql`insert into public.authority_notification_events (notification_id, kind, at, occurred_at, reference, how, not_to_person, not_to_person_until)
                       values (${record.id}::uuid, ${kind}, now(), ${at.toISOString()}::timestamptz, ${reference}, ${how}, ${notToPerson}, ${until?.toISOString() ?? null}::timestamptz)`);
  await notificationRecorded(tx, record.id, { step: "event", digest: await recordDigest(tx, "notification", record.id) });
  const lines = [`${c}: recorded.`];
  if (notToPerson) lines.push(`${c}: until ${until === null ? "further notice" : until.toISOString()}, nothing about this may be told to the person: korbat's access-request draft marks the case.`);
  return lines;
}

/**
 * For access-request (W.8, access.authorityHold): of these cases, those whose notification record carries an event
 * marked "not to the person" with an end that is open or ahead, each with the latest such end as a UTC day (null when
 * one is open). Read as the migrator: the API's role holds no grant on the records.
 */
export async function authorityHoldsFor(q: Db | DbTx, caseIds: readonly string[]): Promise<Map<string, string | null>> {
  if (caseIds.length === 0) return new Map();
  const found = await rows<{ case_id: string; until: string | null }>(
    q,
    sql`select n.case_id,
               case when bool_or(e.not_to_person_until is null) then null else to_char(max(e.not_to_person_until) at time zone 'UTC', 'YYYY-MM-DD') end as until
          from public.authority_notifications n join public.authority_notification_events e on e.notification_id = n.id
         where n.case_id = any(${`{${caseIds.join(",")}}`}::uuid[]) and e.not_to_person and (e.not_to_person_until is null or e.not_to_person_until > now())
         group by n.case_id`,
  );
  return new Map(found.map((row) => [row.case_id, row.until]));
}

// ---------------------------------------------------------------- productions

/** The account a handle names now, or a refusal. */
async function accountNamed(tx: DbTx, command: string, word: string): Promise<string> {
  const handle = handleOf(command, word);
  const [found] = await rows<{ id: string }>(tx, sql`select id from public.profiles where handle = ${handle}`);
  return found?.id ?? refuse(command, `no account has the handle @${handle}`);
}

/**
 * production-account: for an order to provide information (DSA Art. 10), the three facts korbat gives of the account and
 * W.8's sentences, recorded as a production of the instrument dsa_art10 with what the order asked for and what was
 * produced, by kind and never as a text. Refused (tell_rule_missing) until order-tell-rule has recorded whether the
 * person may be told; the production keeps that rule's end as its own "not to the person": an instant, or for good
 * ('infinity') when the person must never be told, so that the record outlives its three years while that runs.
 */
async function productionAccount(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const asked = kindsOf(c, "--asked", flag(cmd, "--asked")!);
  const handleWord = flag(cmd, "--handle")!;
  const orderId = await orderNamed(tx, c, cmd.target!);
  const [order] = await rows<{ kind: string; tell_person: string | null; authority: string; reference: string }>(
    tx,
    sql`select kind, tell_person, authority, reference from public.legal_orders where id = ${orderId}::uuid for share`,
  );
  if (order!.kind !== "dsa_art10") refuse(c, `order ${orderId} is not an order to provide information`);
  if (order!.tell_person === null) refuse(c, "tell_rule_missing: whether the person may be told of this order is not recorded: run staff.js order-tell-rule first");
  const accountId = await accountNamed(tx, c, handleWord);
  const facts = await accountFacts(tx, accountId);
  if (!facts.address) refuse(c, `the account's address is no longer held: its deletion has overwritten it`);
  const [made] = await rows<{ id: string }>(
    tx,
    sql`insert into public.productions (instrument, order_id, account_id, authority, their_reference, asked, produced, not_held, not_to_person_until, opened_at)
        select 'dsa_art10', o.id, ${accountId}::uuid, o.authority, o.reference, ${`{${asked.join(",")}}`}::text[], '{handle,address,created_at}', ${`{${NOT_HELD_KINDS.join(",")}}`}::text[],
               case o.tell_person when 'never' then 'infinity'::timestamptz when 'at_instant' then o.tell_person_at end, now()
          from public.legal_orders o where o.id = ${orderId}::uuid
        returning id`,
  );
  await productionRecorded(tx, made!.id, "account");
  return [...facts.lines, RECORDS_NOT_HELD[RECORDS_NOT_HELD_VERSION], `${c}: recorded as production ${made!.id}, instrument dsa_art10.`];
}

/**
 * address-check: whether the address read from standard input is the address of the account the handle names, for a
 * person who writes to the contact address about an order's notice (W.9). It prints no address, and its audit row names
 * the account and whether it matched, never the address. The address is compared in lower case, as the account holds it.
 */
async function addressCheck(tx: DbTx, cmd: RecordCommand, stdin: Buffer): Promise<string[]> {
  const c = cmd.command;
  const accountId = await accountNamed(tx, c, flag(cmd, "--handle")!);
  const given = stdin.toString("utf8").trim().toLowerCase();
  if (given === "" || [...given].some((char) => char.codePointAt(0)! <= 32)) refuse(c, "standard input holds no address on one line");
  const [row] = await rows<{ email: string | null; purged: boolean }>(tx, sql`select email, purged_at is not null as purged from auth.users where id = ${accountId}::uuid`);
  const match = row !== undefined && !row.purged && row.email !== null && row.email.toLowerCase() === given;
  await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "address_checked", targetType: "user", targetId: accountId, requestId: null, metadata: { match } });
  return [`${c}: ${match ? "yes" : "no"}`];
}

/**
 * handover-list: opens a production for one seal's files and prints, on standard output, a first line naming the
 * production and then the store's name of every stored size of every image row of that seal's posts, read through the
 * media module's sealFiles. Refused (handover_mismatch) when a post's image rows are not as many as the seal recorded:
 * a row lost or added since, which text-verify reports, and nothing is then handed over. Its note on standard error says
 * how many files of how many posts. 2d Task 4 (design, section 7.7): an account seal's avatars (seal_avatars) are handed
 * over too, their two files each after the posts' files, named by the store's rule, so by the image's id, as a held
 * upload's are; the note counts them.
 */
async function handoverList(tx: DbTx, cmd: RecordCommand, notes: string[]): Promise<string[]> {
  const c = cmd.command;
  const instrument = flag(cmd, "--instrument")!;
  if (!(HANDOVER_INSTRUMENTS as readonly string[]).includes(instrument)) refuse(c, "--instrument is notification, demand, court_order or seizure");
  const authority = authorityText(c, "--authority", flag(cmd, "--authority")!);
  const reference = authorityText(c, "--reference", flag(cmd, "--reference")!);
  const actionId = idOf(c, "a seal's ledger row", cmd.target!);
  const [seal] = await rows<{ subject: string }>(
    tx,
    sql`select subject_account_id as subject from public.decision_actions where id = ${actionId}::uuid and kind::text = 'seal_media'`,
  );
  if (!seal) return refuse(c, `no seal has the ledger row ${actionId}`);
  const listed = await rows<{ post_id: string; images: number }>(tx, sql`select post_id, images from public.seal_posts where action_id = ${actionId}::uuid order by post_id`);
  const files = await sealFiles(tx, actionId);
  const rowsOf = new Map(files.map((post) => [post.postId, post]));
  if (listed.length !== files.length || listed.some((post) => rowsOf.get(post.post_id)?.rows !== post.images)) {
    refuse(c, "handover_mismatch: the image rows of this seal's posts are not what the seal recorded: run staff.js text-verify, and hand nothing over");
  }
  const avatars = await sealAvatarFiles(tx, actionId);
  const names = [...files.flatMap((post) => post.names), ...avatars];
  const [record] = await rows<{ id: string }>(
    tx,
    sql`select id from public.authority_notifications where seal_action_id = ${actionId}::uuid order by opened_at desc, id limit 1`,
  );
  const [made] = await rows<{ id: string }>(
    tx,
    sql`insert into public.productions (instrument, notification_id, seal_action_id, account_id, authority, their_reference, produced, files, opened_at)
        values (${instrument}, ${record?.id ?? null}::uuid, ${actionId}::uuid, ${seal.subject}::uuid, ${authority}, ${reference}, '{files}',
                ${JSON.stringify(names.map((name) => ({ name, bytes: null, sha256: null })))}::jsonb, now())
        returning id`,
  );
  await productionRecorded(tx, made!.id, "listed");
  notes.push(`${c}: production ${made!.id}: ${names.length} files of ${files.length} posts${avatars.length > 0 ? ` and ${avatars.length / 2} profile pictures` : ""}.`);
  return [`production ${made!.id}`, ...names];
}

/** The production a command names, under its row lock, or a refusal. */
async function lockProduction(tx: DbTx, command: string, word: string) {
  const id = idOf(command, "a production", word);
  await tx.execute(sql`select 1 from public.productions where id = ${id}::uuid for update`);
  const [row] = await rows<{ id: string; instrument: string; files: { name: string }[] | null; archive: string | null; delivered: boolean; destroyed: boolean }>(
    tx,
    sql`select id, instrument, files, archive_sha256 as archive, delivered_at is not null as delivered, destroyed_at is not null as destroyed from public.productions where id = ${id}::uuid`,
  );
  return row ?? refuse(command, `no production has the id ${id}`);
}

const DIGEST_LINE = /^([^ ]+) ([0-9]{1,15}) ([0-9a-f]{64})$/;
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/**
 * handover-record: the hand-over program's digests from standard input, a line a file ("<name> <bytes> <sha256>") and
 * then "archive <bytes> <sha256>", stored with the channel and the authority's receipt. Refused unless the names are
 * exactly the list handover-list printed, in its order. A seizure takes --taken and no digests: the record says that
 * the authority took the files.
 */
async function handoverRecord(tx: DbTx, cmd: RecordCommand, stdin: Buffer | null): Promise<string[]> {
  const c = cmd.command;
  const taken = has(cmd, "--taken");
  const channelWord = flag(cmd, "--channel", !taken);
  const receiptWord = flag(cmd, "--receipt", !taken);
  const channel = channelWord === null ? null : shortText(c, "--channel", channelWord);
  const receipt = receiptWord === null ? null : freeText(c, "--receipt", receiptWord);
  const production = await lockProduction(tx, c, cmd.target!);
  if (production.files === null) refuse(c, `production ${production.id} lists no files`);
  if (production.delivered || production.archive !== null) refuse(c, `the hand-over of production ${production.id} is recorded already`);
  const listed = production.files!.map((file) => file.name);
  if (production.instrument === "seizure" || taken) {
    if (production.instrument !== "seizure" || !taken) refuse(c, "--taken is for a seizure, and a seizure takes --taken");
    await tx.execute(sql`update public.productions set channel = ${channel}, receipt = ${receipt}, delivered_at = now(), destroyed_at = now(), destroyed_how = 'taken by the authority' where id = ${production.id}::uuid`);
    await productionRecorded(tx, production.id, "recorded");
    return [`${c}: production ${production.id}: the authority took ${listed.length} files.`];
  }
  const lines = (stdin ?? Buffer.alloc(0))
    .toString("utf8")
    .split(LF)
    .map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line))
    .filter((line) => line !== "");
  const parsed = lines.map((line) => DIGEST_LINE.exec(line));
  if (parsed.some((match) => match === null) || parsed.length < 1 || parsed.at(-1)![1] !== "archive") refuse(c, "standard input is not the hand-over's digests");
  const fileLines = parsed.slice(0, -1).map((match) => ({ name: match![1]!, bytes: Number(match![2]), sha256: match![3]! }));
  if (fileLines.length !== listed.length || fileLines.some((file, i) => file.name !== listed[i])) refuse(c, "the digests do not name exactly the files handover-list printed");
  const archive = parsed.at(-1)![3]!;
  await tx.execute(sql`update public.productions set files = ${JSON.stringify(fileLines)}::jsonb, archive_sha256 = ${archive}, channel = ${channel}, receipt = ${receipt}, delivered_at = now()
                       where id = ${production.id}::uuid`);
  await productionRecorded(tx, production.id, "recorded");
  return [`${c}: production ${production.id}: ${fileLines.length} files, archive ${archive}. Delete every copy once the authority confirms, then run handover-destroyed.`];
}

/** handover-destroyed: every copy outside the store is destroyed, how, and when (now). */
async function handoverDestroyed(tx: DbTx, cmd: RecordCommand): Promise<string[]> {
  const c = cmd.command;
  const how = freeText(c, "--how", flag(cmd, "--how")!);
  const production = await lockProduction(tx, c, cmd.target!);
  if (production.archive === null || production.destroyed) refuse(c, `production ${production.id} has no archive recorded, or its copies are recorded as destroyed`);
  const [done] = await rows<{ at: string }>(
    tx,
    sql`update public.productions set destroyed_at = now(), destroyed_how = ${how} where id = ${production.id}::uuid returning ${isoOf("destroyed_at")} as at`,
  );
  await productionRecorded(tx, production.id, "destroyed");
  return [`${c}: recorded at ${done!.at}.`];
}
