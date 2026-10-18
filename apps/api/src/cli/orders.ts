/**
 * The staff command line's commands for authorities' orders (3f design, section 8.11, "Orders"; section 7.7): what only
 * the operator records, which the console cannot take. staff.ts reads their settings and opens their connection, as the
 * migrator, in the migrate service; this file parses their arguments and does what each does. Every command is one
 * transaction with the 10-second lock timeout, takes the order's row FOR UPDATE, writes its change and its event (via
 * `cli`), and ends with the audit row `order_recorded` (the system actor; target the order; metadata the event and its
 * facts, a text only as its digest). Every line it prints starts with its name, and a refusal is one sentence ending in
 * "nothing changed", exit 1. An instant is written with its offset: on the night the clocks go back a local time names
 * two instants.
 *
 * order-open writes the rows the console's route writes, through the moderation module's insertOrder, and before its
 * audit row the alert order_opened, which the watcher pushes and the alert tick mails: an order opened at the shell is
 * heard like any other. Task 3: order-texts tells the authors of the order's told notices that a notice grew (the mail
 * order_notice_added, sent by the dispatch round), and the hold's commands move or end an order's hold.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  ALERT_KINDS,
  FORBIDDEN_FORMAT,
  HOLD_END_REASONS,
  MemberStateCode,
  ORDER_CHANNELS,
  ORDER_ITEMS_MAX,
  ORDER_KINDS,
  ORDER_RULES,
  ORDER_TEXT_LIMITS,
  OrderAuthority,
  OrderLinkText,
  OrderReference,
  SCRUTINY_OUTCOMES,
  STATE_FACTS,
  textDigest,
  type MemberState,
  type OrderChannel,
  type OrderKind,
  type TellPersonRule,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { insertOrder, orderItemsFor } from "../moderation";
import { appendAuditRow } from "../staff";

/** The order commands, each with its first line of STAFF_USAGE. */
export const ORDER_COMMANDS = [
  "order-open",
  "order-received",
  "order-sent-at",
  "order-due",
  "order-verify",
  "order-issued",
  "order-texts",
  "order-document",
  "order-scrutiny",
  "order-reopen",
  "order-tell-rule",
  "order-told",
  // Task 3: the hold's commands (section 7.10).
  "order-hold-until",
  "order-hold-extend",
  "order-hold-end",
] as const;
export type OrderCommandName = (typeof ORDER_COMMANDS)[number];

export const ORDER_USAGE = [
  "  order-open --kind <kind> --state <CC> --authority <text> --reference <text> --channel <mailbox|portal|post|other>",
  "             [--message <id>] [--received <instant>] [--sent <instant>] [--section-c] [--emergency] [--withhold] --link <url> ...",
  "                                         open an order whose time of receipt the console cannot take; run it in the migrate service",
  "  order-received <order> <instant>       the receipt of an order opened without a message",
  "  order-sent-at <order> <instant>        the sending time the channel states",
  "  order-due <order> <instant|none>       a DSA order's deadline as its text states it",
  "  order-verify <order> --how <text>      the check of the order against the register or the coordinator",
  "  order-issued <order> <instant> [--release]  the order's own date and time",
  "  order-texts <order> --reasons|--redress|--scope < text   the authority's words, read from standard input (run with -T)",
  "  order-document <order> < file          the document's SHA-256 and length; no byte of it is kept (run with -T)",
  "  order-scrutiny <order> requested --by <korbat|author> --at <instant> | decided --outcome <upheld|annulled> --at <instant>",
  "  order-reopen <order> --how <text>      open again an order that was closed by mistake or restored by a court",
  "  order-tell-rule <order> --when <at_effect|never|instant> --basis <text>   when the person an order to provide information names may be told",
  "  order-told <order> --at <instant> --how <text>   that the operator told that person",
  "  order-hold-until <order> <instant|none> --basis <text> --how <text> [--release]   the end of non-disclosure the authority stated",
  "  order-hold-extend <order> --received <instant> --how <text>   a removal order's one extension of non-disclosure, or the check of the console's",
  "  order-hold-end <order> --reason <not_authentic|annulled|released_by_authority|not_ordered> --how <text>   end a hold at once",
  "  An <order> is its id, or <CC>:<reference> while one order of that state has the reference. Every instant has its offset.",
];

/** A parsed order command: its name, the order it names (none for order-open) and its flags and positional words. */
export interface OrderCommand {
  command: OrderCommandName;
  order: string | null;
  positional: string[];
  flags: Map<string, string[]>;
}

/** Flags that take no value. */
const SWITCHES = new Set(["--section-c", "--emergency", "--withhold", "--release", "--reasons", "--redress", "--scope"]);

/** Splits a command's words into its order, its positional words and its flags; a flag may repeat (--link). */
export function parseOrderArgs(command: OrderCommandName, rest: readonly string[]): OrderCommand {
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
  if (command === "order-open") return { command, order: null, positional, flags };
  const [order, ...others] = positional;
  if (order === undefined) throw new Error(`${command}: name the order, by its id or as <CC>:<reference>`);
  return { command, order, positional: others, flags };
}

/** What a command reports: its lines, or its one sentence of refusal. */
export type OrderDone = { ok: true; lines: string[] } | { ok: false; problem: string };

/** The settings a command reads beside the migrator's URL: order-open needs both, order-tell-rule reads the home state. */
export interface OrderSettings {
  homeState: string | null;
  appOrigin: string | null;
}

/** A refusal: one sentence, then "nothing changed". */
class Refusal extends Error {}
const refuse = (command: string, why: string): never => {
  throw new Refusal(`${command}: ${why}; nothing changed`);
};

/** An instant with its offset (2026-10-10T01:00:12Z, 2026-10-10T03:00:12+02:00); a time without one names two on a night the clocks go back. */
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
function instant(command: string, word: string | undefined): Date {
  if (word === undefined || !INSTANT.test(word) || Number.isNaN(Date.parse(word))) return refuse(command, `${word ?? "nothing"} is not an instant with an offset`);
  return new Date(word);
}

/** The one value of a flag, or a refusal naming it. */
function flag(cmd: OrderCommand, name: string, required = true): string | null {
  const values = cmd.flags.get(name);
  if (values === undefined || values.length === 0) return required ? refuse(cmd.command, `${name} is required`) : null;
  if (values.length > 1) return refuse(cmd.command, `${name} is given more than once`);
  return values[0]!;
}

/** Whether a text holds a control character: C0, DEL or C1; `allowLineFeed` lets the line feed through. */
function hasControl(text: string, allowLineFeed: boolean): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0)!;
    if (allowLineFeed && code === 10) return false;
    return code < 32 || (code >= 127 && code < 160);
  });
}

/** A free text of the command line (--how, --basis): about the act and never about the person, one line, at most 500 characters. */
function freeText(command: string, name: string, text: string): string {
  if (!(text as string & { isWellFormed(): boolean }).isWellFormed() || hasControl(text, false) || FORBIDDEN_FORMAT.test(text) || text.trim() === "") {
    return refuse(command, `${name} is one line of text without control or invisible characters`);
  }
  if (Array.from(text).length > ORDER_TEXT_LIMITS.short) return refuse(command, `${name} has more than ${ORDER_TEXT_LIMITS.short} characters`);
  return text;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const rows = async <T>(q: Db | DbTx, query: ReturnType<typeof sql>): Promise<T[]> => (await q.execute(query)) as unknown as T[];
const isoOf = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The order a command names, by its id or as <CC>:<reference>; order_ambiguous when several orders of the state share the reference. */
async function orderNamed(tx: DbTx, command: string, name: string): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)) {
    const [found] = await rows<{ id: string }>(tx, sql`select id from public.legal_orders where id = ${name}::uuid`);
    return found?.id ?? refuse(command, `no order has the id ${name}`);
  }
  const at = name.indexOf(":");
  const state = name.slice(0, at);
  if (at < 0 || !/^[A-Z]{2}$/.test(state)) return refuse(command, `${name} is neither an order's id nor <CC>:<reference>`);
  const found = await rows<{ id: string; authority: string }>(
    tx,
    sql`select id, authority from public.legal_orders where member_state = ${state} and reference = ${name.slice(at + 1)} order by opened_at, id`,
  );
  if (found.length === 0) return refuse(command, `no order of ${state} has this reference`);
  if (found.length > 1) {
    throw new Refusal(
      [`order_ambiguous: ${found.length} orders of ${state} have this reference; name one by its id:`, ...found.map((row) => `  ${row.id} ${JSON.stringify(row.authority)}`), "nothing changed"].join(String.fromCharCode(10)),
    );
  }
  return found[0]!.id;
}

/** The facts of an order a command reads after its lock. */
interface Locked {
  id: string;
  kind: OrderKind;
  sectionC: boolean;
  receivedAt: string | null;
  sentAt: string | null;
  openedAt: string;
  closedAt: string | null;
  holdEndedAt: string | null;
  released: boolean;
  tellPerson: TellPersonRule | null;
  tellPersonAt: string | null;
}

/** The order's row FOR UPDATE, then what the command reads of it in a statement of its own. */
async function lockOrder(tx: DbTx, command: string, name: string): Promise<Locked> {
  const id = await orderNamed(tx, command, name);
  await tx.execute(sql`select 1 from public.legal_orders where id = ${id}::uuid for update`);
  const [row] = await rows<Record<string, unknown>>(
    tx,
    sql`select o.id, o.kind, o.section_c, ${isoOf("o.received_at")} as received_at, ${isoOf("o.sent_at")} as sent_at, ${isoOf("o.opened_at")} as opened_at,
               ${isoOf("o.closed_at")} as closed_at, ${isoOf("o.hold_ended_at")} as hold_ended_at, o.tell_person, ${isoOf("o.tell_person_at")} as tell_person_at,
               exists (select 1 from public.legal_order_events e where e.order_id = o.id and e.kind = 'notice_released') as released
          from public.legal_orders o where o.id = ${id}::uuid`,
  );
  return {
    id,
    kind: row!.kind as OrderKind,
    sectionC: row!.section_c as boolean,
    receivedAt: row!.received_at as string | null,
    sentAt: row!.sent_at as string | null,
    openedAt: row!.opened_at as string,
    closedAt: row!.closed_at as string | null,
    holdEndedAt: row!.hold_ended_at as string | null,
    released: row!.released as boolean,
    tellPerson: row!.tell_person as TellPersonRule | null,
    tellPersonAt: row!.tell_person_at as string | null,
  };
}

/** The event of a command, via the command line, then its audit row `order_recorded`, last. */
async function recorded(tx: DbTx, orderId: string, event: string, facts: Record<string, unknown>, columns: { ground?: string | null; effectiveAt?: Date | null } = {}): Promise<void> {
  await tx.execute(sql`insert into public.legal_order_events (order_id, kind, ground, effective_at, via)
                       values (${orderId}::uuid, ${event}, ${columns.ground ?? null}, ${columns.effectiveAt?.toISOString() ?? null}::timestamptz, 'cli')`);
  await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "order_recorded", targetType: "order", targetId: orderId, requestId: null, metadata: { event, ...facts } });
}

/** The notice's hold of an order as order-issued prints it: "held until <instant>", "held with no end" or "not held". */
async function holdWords(tx: DbTx, orderId: string): Promise<string> {
  const [row] = await rows<{ until: string | null; infinite: boolean; ahead: boolean }>(
    tx,
    sql`select ${isoOf("h.until")} as until, coalesce(h.until = 'infinity'::timestamptz, false) as infinite, coalesce(h.until > clock_timestamp(), false) as ahead
          from (select public.order_hold_until(${orderId}::uuid) as until) h`,
  );
  if (row!.infinite) return "held with no end";
  return row!.until !== null && row!.ahead ? `held until ${row!.until}` : "not held";
}

/** A removal order's deadline from a start, as the console prints it. */
const deadlineOf = (start: string) => new Date(Date.parse(start) + ORDER_RULES.hourMinutes * 60_000).toISOString();

/** Runs one order command as the migrator, in one transaction with the 10-second lock timeout; a refusal changes nothing. */
export async function orderCommand(migrateDb: Db, cmd: OrderCommand, settings: OrderSettings, input: () => Promise<Buffer>): Promise<OrderDone> {
  // Standard input is read before the transaction opens: nothing holds a lock while a person types or a pipe drains.
  const stdin = cmd.command === "order-texts" || cmd.command === "order-document" ? await input() : null;
  try {
    const lines = await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return run(tx, cmd, settings, stdin);
    });
    return { ok: true, lines };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}

async function run(tx: DbTx, cmd: OrderCommand, settings: OrderSettings, stdin: Buffer | null): Promise<string[]> {
  const c = cmd.command;
  switch (c) {
    case "order-open":
      return open(tx, cmd, settings);
    case "order-received": {
      const order = await lockOrder(tx, c, cmd.order!);
      const at = instant(c, cmd.positional[0]);
      if (order.receivedAt !== null) refuse(c, `the receipt is recorded already (${order.receivedAt})`);
      if (at.getTime() > Date.parse(order.openedAt)) refuse(c, "an order is not received after it was opened");
      await tx.execute(sql`update public.legal_orders set received_at = ${at.toISOString()}::timestamptz where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "received_set", { receivedAt: at.toISOString() });
      if (order.kind !== "tco_removal") return [`${c}: receipt ${at.toISOString()}.`];
      const start = order.sentAt !== null && Date.parse(order.sentAt) < at.getTime() ? order.sentAt : at.toISOString();
      const deadline = deadlineOf(start);
      const late = Math.floor((Date.now() - Date.parse(deadline)) / 60_000);
      return [late > 0 ? `${c}: receipt ${at.toISOString()}; deadline passed ${late} minutes ago.` : `${c}: receipt ${at.toISOString()}; deadline ${deadline}.`];
    }
    case "order-sent-at": {
      const order = await lockOrder(tx, c, cmd.order!);
      const at = instant(c, cmd.positional[0]);
      if (at.getTime() > Date.parse(order.openedAt)) refuse(c, "an order is not sent after it was opened");
      await tx.execute(sql`update public.legal_orders set sent_at = ${at.toISOString()}::timestamptz where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "sent_at_set", { sentAt: at.toISOString() });
      if (order.kind !== "tco_removal") return [`${c}: sent ${at.toISOString()}.`];
      const [clock] = await rows<{ clock_start: string | null }>(tx, sql`select ${isoOf("clock_start")} as clock_start from public.legal_order_clock where order_id = ${order.id}::uuid`);
      return [`${c}: sent ${at.toISOString()}; the clock starts ${clock?.clock_start ?? at.toISOString()}.`];
    }
    case "order-due": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind === "tco_removal") refuse(c, "a removal order's deadline is its hour, from its receipt");
      const word = cmd.positional[0];
      const at = word === "none" ? null : instant(c, word);
      await tx.execute(sql`update public.legal_orders set due_at = ${at?.toISOString() ?? null}::timestamptz where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "due_set", { dueAt: at?.toISOString() ?? null });
      return [at === null ? `${c}: no deadline.` : `${c}: due ${at.toISOString()}.`];
    }
    case "order-verify": {
      const order = await lockOrder(tx, c, cmd.order!);
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      const [row] = await rows<{ verified_at: string; items: number }>(
        tx,
        sql`update public.legal_orders o set verified_at = now(), verified_how = ${how} where o.id = ${order.id}::uuid
            returning ${isoOf("o.verified_at")} as verified_at, (select count(*)::int from public.legal_order_items i where i.order_id = o.id) as items`,
      );
      await recorded(tx, order.id, "verified", { verifiedAt: row!.verified_at, howSha256: sha256(how) });
      return [`${c}: order ${order.id} verified at ${row!.verified_at}: ${row!.items} items compared with the order.`];
    }
    case "order-issued": {
      const order = await lockOrder(tx, c, cmd.order!);
      const at = instant(c, cmd.positional[0]);
      if (at.getTime() > Date.parse(order.receivedAt ?? order.openedAt)) refuse(c, "an order is not issued after it was received");
      if (order.sectionC && (order.released || order.holdEndedAt !== null)) refuse(c, "the author's notice was already released, or its hold was ended");
      // While a notice of the order is held, a time stamp whose computed end is not ahead would release it within minutes,
      // which cannot be taken back: nothing changes then unless --release says that is what the order says.
      const [held] = await rows<{ held: boolean; would_end: string; past: boolean }>(
        tx,
        sql`select (o.section_c and public.order_hold_until(o.id) > clock_timestamp()
                    and exists (select 1 from public.legal_order_items i join public.decisions d on d.order_item_id = i.id where i.order_id = o.id and d.informed_at is null)) as held,
                   ${isoOf("least(public.order_hold_end(x.at, o.hold_extended), o.authority_hold_until)")} as would_end,
                   least(public.order_hold_end(x.at, o.hold_extended), o.authority_hold_until) <= clock_timestamp() as past
              from public.legal_orders o cross join (select ${at.toISOString()}::timestamptz as at) x where o.id = ${order.id}::uuid`,
      );
      if (order.kind === "tco_removal" && held!.held && held!.past && !cmd.flags.has("--release")) {
        throw new Refusal(
          `${c}: with this date the hold would have ended on ${held!.would_end}, and the author would be told at the next dispatch round. Nothing changed; give --release if that is what the order says.`,
        );
      }
      await tx.execute(sql`update public.legal_orders set issued_at = ${at.toISOString()}::timestamptz where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "issued_at_set", { issuedAt: at.toISOString(), release: cmd.flags.has("--release") });
      return [`${c}: issued ${at.toISOString()}; the notice is ${await holdWords(tx, order.id)}.`];
    }
    case "order-texts": {
      const order = await lockOrder(tx, c, cmd.order!);
      const which = (["--reasons", "--redress", "--scope"] as const).filter((name) => cmd.flags.has(name));
      if (which.length !== 1) refuse(c, "give exactly one of --reasons, --redress and --scope");
      const column = which[0]!.slice(2) as "reasons" | "redress" | "scope";
      if (column === "scope" && order.kind === "tco_removal") refuse(c, "a removal order has no territorial scope of its own to record");
      const text = stdin!.toString("utf8").replace(/[ ]*$/, "");
      const max = column === "scope" ? ORDER_TEXT_LIMITS.short : ORDER_TEXT_LIMITS.long;
      if (!(text as string & { isWellFormed(): boolean }).isWellFormed() || hasControl(text, true) || FORBIDDEN_FORMAT.test(text) || text.trim() === "") {
        refuse(c, "the text from standard input holds a control or an invisible character, or no text");
      }
      if (Array.from(text).length > max) refuse(c, `the text has more than ${max} characters`);
      const salt = randomBytes(32).toString("hex");
      const digest = await textDigest(salt, text);
      await tx.execute(
        column === "reasons"
          ? sql`update public.legal_orders set reasons = ${text}, reasons_salt = ${salt}, reasons_digest = ${digest} where id = ${order.id}::uuid`
          : column === "redress"
            ? sql`update public.legal_orders set redress = ${text}, redress_salt = ${salt}, redress_digest = ${digest} where id = ${order.id}::uuid`
            : sql`update public.legal_orders set scope = ${text}, scope_salt = ${salt}, scope_digest = ${digest} where id = ${order.id}::uuid`,
      );
      // Task 3 (section 7.7, step 3): every told order decision of the order is owed its mail again, so that the dispatch
      // round mails order_notice_added: a time limit of the author's runs from receiving the authority's words. The event's
      // time is the recorded instant, which the notice prints; no column holds it a second time.
      const told = await rows<{ id: string }>(
        tx,
        sql`update public.decisions d set author_mail = 'pending'
              from public.legal_order_items i
             where i.order_id = ${order.id}::uuid and d.order_item_id = i.id and d.kind::text = 'order' and d.informed_at is not null and d.author_mail <> 'none'
            returning d.id`,
      );
      const [held] = await rows<{ held: number; until: string | null }>(
        tx,
        sql`select count(*)::int as held, ${isoOf("min(public.order_hold_until(i.order_id))")} as until
              from public.legal_order_items i join public.decisions d on d.order_item_id = i.id
             where i.order_id = ${order.id}::uuid and d.kind::text = 'order' and d.informed_at is null`,
      );
      await recorded(tx, order.id, "texts_recorded", { text: column, digest, authors: told.length });
      const head = `${c}: ${column} recorded (${Array.from(text).length} characters).`;
      if (told.length > 0) return [`${head} ${told.length} authors are sent an email that the notice has grown; the notice shows the text and this time from now.`];
      if (held!.held > 0) return [`${head} The notice is held: it will show the text once it is released, ${held!.until ?? "at a time not recorded yet"}.`];
      return [`${head} No author has been told of this order: the notice shows the text from its first telling.`];
    }
    case "order-document": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (stdin!.length === 0) refuse(c, "standard input held no document");
      const digest = sha256(stdin!);
      await tx.execute(sql`update public.legal_orders set document_sha256 = ${digest}, document_bytes = ${stdin!.length} where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "document_recorded", { documentSha256: digest, documentBytes: stdin!.length });
      return [`${c}: ${digest}, ${stdin!.length} bytes.`];
    }
    case "order-scrutiny": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind !== "tco_removal") refuse(c, "only a removal order from another Member State is put to scrutiny");
      const step = cmd.positional[0];
      const at = instant(c, flag(cmd, "--at")!);
      if (at.getTime() > Date.now()) refuse(c, "--at is in the future");
      if (step === "requested") {
        const by = flag(cmd, "--by")!;
        if (by !== "korbat" && by !== "author") refuse(c, "--by is korbat or author");
        await recorded(tx, order.id, "scrutiny_requested", { by, at: at.toISOString() }, { effectiveAt: at });
        return [`${c}: request recorded.`];
      }
      if (step === "decided") {
        const outcome = flag(cmd, "--outcome")!;
        if (!(SCRUTINY_OUTCOMES as readonly string[]).includes(outcome)) refuse(c, "--outcome is upheld or annulled");
        await recorded(tx, order.id, "scrutiny_decided", { outcome, at: at.toISOString() }, { ground: outcome, effectiveAt: at });
        return [outcome === "annulled" ? `${c}: decided: annulled. An admin reinstates each item on its case, ground scrutiny, at once.` : `${c}: decided: upheld. The order stands.`];
      }
      return refuse(c, "say requested or decided");
    }
    case "order-reopen": {
      const order = await lockOrder(tx, c, cmd.order!);
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      if (order.closedAt === null) refuse(c, "the order is not closed");
      await tx.execute(sql`update public.legal_orders set closed_at = null where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "reopened", { howSha256: sha256(how) });
      return [`${c}: order ${order.id} is open again. Its times are unchanged.`];
    }
    case "order-tell-rule": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind !== "dsa_art10") refuse(c, "only an order to provide information has this rule; a DSA Article 9 order's is its hold (order-hold-until)");
      const when = flag(cmd, "--when", false);
      if (when === null) {
        const fallback = settings.homeState === null ? null : (STATE_FACTS[settings.homeState as MemberState]?.tellPersonDefault ?? null);
        throw new Refusal(`${c}: the home state's default is ${fallback === null ? "not filled in" : fallback}; give --when to record a rule; nothing changed`);
      }
      const basis = freeText(c, "--basis", flag(cmd, "--basis")!);
      const rule: TellPersonRule = when === "at_effect" || when === "never" ? when : "at_instant";
      const at = rule === "at_instant" ? instant(c, when) : null;
      await tx.execute(
        sql`update public.legal_orders set tell_person = ${rule}, tell_person_at = ${at?.toISOString() ?? null}::timestamptz, hold_basis = ${basis} where id = ${order.id}::uuid`,
      );
      await recorded(tx, order.id, "tell_person_set", { rule, at: at?.toISOString() ?? null, basisSha256: sha256(basis) });
      return [`${c}: the person is told ${rule === "at_effect" ? "at effect" : rule === "never" ? "never" : `at ${at!.toISOString()}`}, on the basis recorded.`];
    }
    case "order-hold-until": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind === "dsa_art10") refuse(c, "an order to provide information has no notice of korbat's: its rule for telling the person is order-tell-rule's");
      if (!order.sectionC) refuse(c, "no notice of this order is held");
      if (order.released || order.holdEndedAt !== null) refuse(c, "the author's notice was already released, or its hold was ended");
      const word = cmd.positional[0];
      const at = word === "none" ? null : instant(c, word);
      const basis = freeText(c, "--basis", flag(cmd, "--basis")!);
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      if (order.kind === "tco_removal" && at === null) refuse(c, "a removal order's hold has the Regulation's end: give the authority's instant, or leave its end as computed");
      // The end this record would leave (the lesser of the computed end and the authority's for a removal order; the
      // authority's own for a DSA order), and whether it is no longer ahead: that would release the notice within minutes.
      const [would] = await rows<{ until: string | null; past: boolean; computed: string | null; computed_wins: boolean }>(
        tx,
        sql`select ${isoOf("w.until")} as until, coalesce(w.until <= clock_timestamp(), false) as past, ${isoOf("w.computed")} as computed,
                   coalesce(w.computed < x.at, false) as computed_wins
              from public.legal_orders o
              cross join (select ${at?.toISOString() ?? null}::timestamptz as at) x
              cross join lateral (select case when o.kind = 'tco_removal' then public.order_hold_end(coalesce(o.issued_at, o.received_at, o.opened_at), o.hold_extended) end as computed) c
              cross join lateral (select case when o.kind = 'tco_removal' then least(c.computed, x.at) else x.at end as until, c.computed) w
             where o.id = ${order.id}::uuid`,
      );
      if (would!.until !== null && would!.past && !cmd.flags.has("--release")) {
        throw new Refusal(`${c}: with this end the hold would have ended on ${would!.until}, and the author would be told at the next dispatch round. Nothing changed; give --release if that is what the order says.`);
      }
      await tx.execute(sql`update public.legal_orders set authority_hold_until = ${at?.toISOString() ?? null}::timestamptz, hold_basis = ${basis} where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "hold_until_set", { until: at?.toISOString() ?? null, basisSha256: sha256(basis), howSha256: sha256(how), release: cmd.flags.has("--release") });
      if (at === null) return [`${c}: the notice is held with no end. Every staff account is reminded daily until an end is recorded.`];
      if (order.kind === "tco_removal" && would!.computed_wins) return [`${c}: the computed end ${would!.computed} is earlier and stands.`];
      return [`${c}: the notice is held until ${would!.until}.`];
    }
    case "order-hold-extend": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind !== "tco_removal") refuse(c, "only a removal order's hold is extended once; a DSA order's later time is order-hold-until's");
      if (!order.sectionC) refuse(c, "no notice of this order is held");
      if (order.released || order.holdEndedAt !== null) refuse(c, "the author's notice was already released, or its hold was ended");
      const received = instant(c, flag(cmd, "--received")!);
      if (received.getTime() > Date.now()) refuse(c, "--received is in the future");
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      const [prior] = await rows<{ extended: boolean; console_at: string | null; cli: boolean }>(
        tx,
        sql`select o.hold_extended as extended,
                   ${isoOf("(select max(e.at) from public.legal_order_events e where e.order_id = o.id and e.kind = 'hold_extended' and e.via = 'console')")} as console_at,
                   exists (select 1 from public.legal_order_events e where e.order_id = o.id and e.kind = 'hold_extended' and e.via = 'cli') as cli
              from public.legal_orders o where o.id = ${order.id}::uuid`,
      );
      if (prior!.cli) refuse(c, "the non-disclosure period was already extended once");
      await tx.execute(sql`update public.legal_orders set hold_extended = true where id = ${order.id}::uuid`);
      await recorded(tx, order.id, "hold_extended", { received: received.toISOString(), howSha256: sha256(how), confirms: prior!.console_at }, { effectiveAt: received });
      const until = await holdWords(tx, order.id);
      if (prior!.console_at !== null) return [`${c}: the console's extension of ${prior!.console_at} is confirmed; the notice is ${until}.`];
      return [`${c}: the notice is ${until}. It cannot be extended again.`];
    }
    case "order-hold-end": {
      const order = await lockOrder(tx, c, cmd.order!);
      const reason = flag(cmd, "--reason")!;
      if (!(HOLD_END_REASONS as readonly string[]).includes(reason)) refuse(c, "--reason is not_authentic, annulled, released_by_authority or not_ordered");
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      if (!order.sectionC || order.released || order.holdEndedAt !== null) refuse(c, "no notice of this order is held");
      // An extension the console recorded that turns out not to be the authority's is undone only once the first period
      // has ended: ending the hold before that day would tell early.
      const [first] = await rows<{ ahead: boolean; extended: boolean }>(
        tx,
        sql`select o.hold_extended as extended,
                   coalesce(o.kind = 'tco_removal' and o.hold_extended
                            and least(public.order_hold_end(coalesce(o.issued_at, o.received_at, o.opened_at), false), o.authority_hold_until) > clock_timestamp(), false) as ahead
              from public.legal_orders o where o.id = ${order.id}::uuid`,
      );
      if (reason === "not_ordered" && first!.extended && first!.ahead) refuse(c, "the first period of this extended hold has not ended: ending it now as not ordered would tell early");
      const [ended] = await rows<{ at: string }>(
        tx,
        sql`update public.legal_orders set hold_ended_at = now(), hold_end_reason = ${reason} where id = ${order.id}::uuid returning ${isoOf("hold_ended_at")} as at`,
      );
      await recorded(tx, order.id, "hold_ended", { reason, howSha256: sha256(how) }, { ground: reason });
      return [`${c}: the hold ended at ${ended!.at}. The next dispatch round tells the author, within about 10 minutes.`];
    }
    case "order-told": {
      const order = await lockOrder(tx, c, cmd.order!);
      if (order.kind !== "dsa_art10") refuse(c, "only the person an order to provide information names is told this way");
      if (order.tellPerson === null) refuse(c, "whether the person may be told of this order is not recorded: run staff.js order-tell-rule first");
      if (order.tellPerson === "never") refuse(c, "the rule recorded for this order is that the person is never told");
      if (order.tellPerson === "at_instant" && Date.parse(order.tellPersonAt!) > Date.now()) refuse(c, `the person may be told only from ${order.tellPersonAt}`);
      const at = instant(c, flag(cmd, "--at")!);
      if (at.getTime() > Date.now()) refuse(c, "--at is in the future");
      const how = freeText(c, "--how", flag(cmd, "--how")!);
      await recorded(tx, order.id, "person_told", { at: at.toISOString(), howSha256: sha256(how) }, { effectiveAt: at });
      return [`${c}: recorded at ${at.toISOString()}.`];
    }
  }
}

/** order-open (section 8.11): the rows of insertOrder as the migrator, the alert order_opened, then the audit row. */
async function open(tx: DbTx, cmd: OrderCommand, settings: OrderSettings): Promise<string[]> {
  const c = cmd.command;
  if (settings.homeState === null || settings.appOrigin === null) throw new Refusal(`${c}: HOME_STATE and APP_ORIGIN must be set for the migrate service; nothing changed`);
  if (cmd.positional.length > 0) refuse(c, `${cmd.positional[0]} is not a flag of order-open`);
  const kind = flag(cmd, "--kind")! as OrderKind;
  if (!(ORDER_KINDS as readonly string[]).includes(kind)) refuse(c, "--kind is tco_removal, dsa_art9 or dsa_art10");
  const state = MemberStateCode.safeParse(flag(cmd, "--state"));
  if (!state.success) refuse(c, "--state is the issuing Member State's two-letter code");
  const authority = OrderAuthority.safeParse(flag(cmd, "--authority"));
  if (!authority.success) refuse(c, "--authority is one line of 1 to 200 characters");
  const reference = OrderReference.safeParse(flag(cmd, "--reference"));
  if (!reference.success) refuse(c, "--reference is one line of 1 to 200 characters");
  const channel = flag(cmd, "--channel")! as OrderChannel;
  if (!(ORDER_CHANNELS as readonly string[]).includes(channel)) refuse(c, "--channel is mailbox, portal, post or other");
  const messageId = flag(cmd, "--message", false);
  if (messageId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(messageId)) refuse(c, "--message is a message's id");
  if (messageId !== null && channel !== "mailbox") refuse(c, "an order whose message is listed arrived by mail: --channel mailbox");
  if (messageId !== null && cmd.flags.has("--received")) refuse(c, "a listed message's time of receipt is its own: give --message or --received, not both");
  const receivedWord = flag(cmd, "--received", false);
  const sentWord = flag(cmd, "--sent", false);
  const receivedAt = receivedWord === null ? null : instant(c, receivedWord);
  const sentAt = sentWord === null ? null : instant(c, sentWord);
  const links = cmd.flags.get("--link") ?? [];
  if (kind === "dsa_art10" ? links.length > 0 : links.length === 0) refuse(c, "an order to provide information takes no --link; the other kinds take at least one");
  if (links.length > ORDER_ITEMS_MAX) refuse(c, `an order holds at most ${ORDER_ITEMS_MAX} links`);
  if (links.some((link) => !OrderLinkText.safeParse(link).success)) refuse(c, "a --link is one line of at most 500 characters");
  if (new Set(links).size !== links.length) refuse(c, "a --link is named twice");
  const sectionC = cmd.flags.has("--section-c");
  // --section-c forces --withhold, as the console and the database do; a removal order always withholds.
  const withhold = cmd.flags.has("--withhold") || sectionC || kind === "tco_removal";
  if (messageId !== null && (await rows<{ id: string }>(tx, sql`select id from public.contact_messages where id = ${messageId}::uuid`)).length === 0) {
    refuse(c, `no message has the id ${messageId}`);
  }
  let items;
  try {
    items = await orderItemsFor(tx, settings.appOrigin, links);
  } catch {
    return refuse(c, "two links name the same post");
  }
  const id = randomUUID();
  const crossBorder = state.data !== settings.homeState;
  let inserted;
  try {
    inserted = await tx.transaction(async (inner) =>
      insertOrder(inner, {
        id,
        kind,
        memberState: state.data!,
        authority: authority.data!,
        reference: reference.data!,
        channel,
        messageId,
        sectionC,
        emergency: cmd.flags.has("--emergency"),
        crossBorder,
        withholdFromAuthor: withhold,
        openedBy: null,
        items,
        cli: { receivedAt, sentAt },
      }),
    );
  } catch (err) {
    const code = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    if (code?.code === "23505" && code.constraint_name === "legal_orders_reference_key") return refuse(c, "an order of this authority with this reference is already recorded (order_exists)");
    if (code?.code === "23514") return refuse(c, "a time of receipt or of sending after now is not taken");
    throw err;
  }
  const dueAt = kind === "tco_removal" && inserted.receivedAt !== null ? deadlineOf(inserted.receivedAt.toISOString()) : null;
  const entry = ALERT_KINDS.order_opened;
  const facts = { items: inserted.items.length, ...(dueAt !== null ? { dueAt } : {}), unknown: kind === "tco_removal" && inserted.receivedAt === null ? 1 : 0 };
  await tx.execute(sql`insert into public.alert_outbox (kind, priority, scope, facts, order_id)
                       values ('order_opened', ${entry.priority}::smallint, ${entry.scope}, ${JSON.stringify(facts)}::text::jsonb, ${id}::uuid)`);
  await appendAuditRow(tx, {
    actorId: SYSTEM_ACTOR_ID,
    action: "order_opened",
    targetType: "order",
    targetId: id,
    requestId: null,
    metadata: {
      kind,
      memberState: state.data,
      authority: authority.data,
      reference: reference.data,
      channel: inserted.channel,
      messageId,
      receivedAt: inserted.receivedAt?.toISOString() ?? null,
      sentAt: inserted.sentAt?.toISOString() ?? null,
      openedAt: inserted.openedAt.toISOString(),
      sectionC,
      emergency: cmd.flags.has("--emergency"),
      crossBorder,
      withholdFromAuthor: inserted.withholdFromAuthor,
      via: "cli",
      items: inserted.items.map((item) =>
        item.postId !== null
          ? { itemId: item.id, position: item.position, addedAt: item.addedAt.toISOString(), postId: item.postId }
          : { itemId: item.id, position: item.position, addedAt: item.addedAt.toISOString(), linkSha256: sha256(item.link), linkLength: Array.from(item.link).length },
      ),
    },
  });
  const noPost = inserted.items.filter((item) => item.postId === null).length;
  const head = `${c}: order ${id} opened: ${kind}, ${state.data}, reference ${reference.data}, ${inserted.items.length} items (${noPost} name no post).`;
  if (inserted.receivedAt === null) return [`${head} Receipt not recorded: the console says deadline unknown.`];
  return [dueAt === null ? `${head} Receipt: ${inserted.receivedAt.toISOString()}.` : `${head} Receipt: ${inserted.receivedAt.toISOString()}; deadline ${dueAt}.`];
}
