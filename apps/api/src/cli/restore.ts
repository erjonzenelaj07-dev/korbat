/**
 * The staff command line's recovery (3f design, sections 6.6, 7.16, 7.17 and 8.11, "Recovery and the counts"):
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-export [--after <place>] > file.jsonl
 *   cat <files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js restore-import [<place>:<hash> ...]
 *
 * audit-export is the keeper's download from the server: the rows after a place as JSON lines on standard output, in the
 * console's form (AuditExportLine), and its own copy mark with the audit row copy_marked under the system actor, since its
 * output goes to a file on the server and no browser has to confirm it. It runs on the API's role, as audit-head does.
 *
 * restore-import runs after a restore, as the migrator, in one transaction, with the keeper's files concatenated on
 * standard input, oldest first: every file from the one that holds the restored head's place onward. It checks every
 * line with the chain's canonical text in this program's own code (staff/chain.ts) and nothing of the database's; the
 * lines at or below the restored head are checked and not imported, and the run above it must continue the head. A
 * changed line refuses everything (tail_not_continuous); a hole is reported, and the unbroken run from the head is
 * imported. It writes again the plain records the lost rows describe, with their original times and an imported mark,
 * and one row of restore_gaps for every lost decision and every lost record it can only note; never a decision or a
 * measure: a person takes each lost measure again, under a key, from the console's After a restore screen.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AuditExportLine, GAP_CLASSES, GAP_SITE_CLASSES, MEASURES, type ActionKind, type GapClass } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { insertOrder, postLink, type NewOrderItem } from "../moderation";
import { CHAIN_ZERO_HASH, appendAuditRow, canonicalText, chainHash, exportLines } from "../staff";
import { Refusal, isoOf, refuse, rows } from "./orders";

/** The recovery commands, each with its first line of STAFF_USAGE. */
export const RESTORE_COMMANDS = ["audit-export", "restore-import"] as const;
export type RestoreCommandName = (typeof RESTORE_COMMANDS)[number];

export const RESTORE_USAGE = [
  "  audit-export [--after <place>]         print the audit log's rows after the place (after the command line's own last copy",
  "                                         when left out) as JSON lines, and record the copy; run it in the api service",
  "  restore-import [<place>:<hash> ...] < files   after a restore: check the keeper's files, oldest first, against the restored",
  "                                         head, write the lost records again and list the gaps; as the migrator, with -T",
];

/** A place as the keeper copies it, as audit-verify takes it: at most 15 digits and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;
const PLACE = /^(0|[1-9][0-9]{0,14})$/;

export type RestoreCommand = { command: "audit-export"; after: number | null } | { command: "restore-import"; kept: { seq: number; hash: string }[] };

/** Reads a recovery command's words. */
export function parseRestoreArgs(command: RestoreCommandName, rest: readonly string[]): RestoreCommand {
  if (command === "audit-export") {
    if (rest.length === 0) return { command, after: null };
    if (rest.length === 2 && rest[0] === "--after" && PLACE.test(rest[1]!)) return { command, after: Number(rest[1]) };
    throw new Error(`audit-export: takes --after <place>, a place as audit-head prints it`);
  }
  return {
    command,
    kept: rest.map((arg) => {
      const match = KEPT_PLACE.exec(arg);
      if (!match) throw new Error(`restore-import: not a kept place: ${arg} (a kept place is <chain_seq>:<hash>, as audit-head prints it)`);
      return { seq: Number(match[1]), hash: match[2]! };
    }),
  };
}

// ---------------------------------------------------------------- audit-export

/** What audit-export did: the places it printed and how many rows, or nothing newer. */
export type ExportDone = { from: number; to: number; rows: number } | { from: null; to: null; rows: 0 };

/**
 * audit-export (7.16 step 5, 8.11) on the API's role: the rows after `after` (the command line's own newest copy mark, or
 * 0, when none is given) up to the head as it stands when the command starts, each as one JSON line handed to `write`,
 * oldest first; then, once every line is written, one transaction with the copy mark under the system actor and the
 * audit row copy_marked, last. Nothing newer writes nothing.
 */
export async function auditExport(apiDb: Db, after: number | null, write: (line: string) => Promise<void>): Promise<ExportDone> {
  const [head] = await rows<{ seq: string }>(apiDb, sql`select h.seq::text as seq from public.audit_head h where h.id = 1`);
  const through = Number(head?.seq ?? 0);
  const [own] = await rows<{ place: string }>(apiDb, sql`select m.place::text as place from public.copy_marks m where m.staff_id = ${SYSTEM_ACTOR_ID}::uuid order by m.at desc, m.id desc limit 1`);
  const start = after ?? Number(own?.place ?? 0);
  if (through <= start) return { from: null, to: null, rows: 0 };
  let count = 0;
  for await (const line of exportLines(apiDb, start, through)) {
    await write(JSON.stringify(line));
    count++;
  }
  await apiDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    // The API role inserts these two columns alone; the trigger forces the mark's time.
    await tx.execute(sql`insert into public.copy_marks (staff_id, place) values (${SYSTEM_ACTOR_ID}::uuid, ${through}::bigint)`);
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "copy_marked", targetType: null, targetId: null, requestId: null, metadata: { after: start, through, rows: count } });
  });
  return { from: start + 1, to: through, rows: count };
}

// ---------------------------------------------------------------- restore-import: the lines

/** A line of the keeper's files, read, with its line number on standard input and its metadata as parsed. */
interface TailLine {
  n: number;
  line: AuditExportLine;
  metadata: Record<string, unknown>;
}

/** Every line refused for the same sentence: a changed file, never a missing one. */
const refused = (n: number, head: { seq: number; hash: string }): never => {
  throw new Refusal(`restore-import: refused: line ${n} does not continue the restored head ${head.seq}:${head.hash}; nothing was written`);
};

/**
 * Reads the input's lines (blank lines are skipped) and checks each by itself: it is an AuditExportLine, and its hash
 * recomputes from its own members with the canonical text and the line's prevHash. A line that fails either is a changed
 * file, refused whole. A line repeated exactly (two downloads that overlap) is read once; a place read twice with two
 * hashes is a changed file.
 */
export function readTail(input: Buffer, head: { seq: number; hash: string }): TailLine[] {
  const LF = String.fromCharCode(10);
  const lines: TailLine[] = [];
  const byPlace = new Map<number, string>();
  const text = input.toString("utf8").split(LF);
  for (const [index, raw] of text.entries()) {
    if (raw.trim() === "") continue;
    const n = index + 1;
    let parsed: AuditExportLine;
    let metadata: Record<string, unknown>;
    try {
      parsed = AuditExportLine.parse(JSON.parse(raw));
      metadata = JSON.parse(parsed.metadata) as Record<string, unknown>;
      const recomputed = chainHash(
        parsed.prevHash,
        canonicalText({
          chainVersion: parsed.v,
          chainSeq: parsed.place,
          id: parsed.id,
          createdAt: new Date(parsed.at),
          actorId: parsed.actor,
          action: parsed.action,
          targetType: parsed.targetType,
          targetId: parsed.targetId,
          requestId: parsed.requestId,
          staffSession: parsed.staffSession,
          keyId: parsed.keyId,
          actionHash: parsed.actionHash,
          stepUpText: parsed.stepUp,
          metadataText: parsed.metadata,
        }),
      );
      // A time that does not print back as it was written would hash another text: the line was changed.
      if (recomputed !== parsed.hash || new Date(parsed.at).toISOString() !== parsed.at) return refused(n, head);
    } catch (err) {
      if (err instanceof Refusal) throw err;
      return refused(n, head);
    }
    const seen = byPlace.get(parsed.place);
    if (seen !== undefined) {
      if (seen !== parsed.hash) return refused(n, head);
      continue;
    }
    byPlace.set(parsed.place, parsed.hash);
    lines.push({ n, line: parsed, metadata });
  }
  return lines;
}

/** What the walk found: the lines checked below the head, the run to import, and the hole that ends it, if any. */
export interface Walked {
  checked: number;
  run: TailLine[];
  hole: { after: number; before: number } | null;
}

/**
 * The walk of 7.17 step 2.1 over lines in input order. Every line names the line before it where that line is in the
 * input (a line at the next place with another prevHash, or a line at a place not after the one before, is a changed
 * file); the line at the head's place holds the head's hash; a kept place the input holds holds the hash the keeper
 * noted. Above the head the first line must be the head's next place and name the head's hash (input that begins
 * above that is refused: the lost rows cannot be downloaded again); the run stops at the first line whose place is not
 * the next one, which is the hole the import reports.
 */
export function walkTail(lines: readonly TailLine[], head: { seq: number; hash: string }, kept: readonly { seq: number; hash: string }[]): Walked {
  for (const place of kept) {
    const found = lines.find((entry) => entry.line.place === place.seq);
    if (found !== undefined && found.line.hash !== place.hash) refused(found.n, head);
  }
  let checked = 0;
  const run: TailLine[] = [];
  let hole: Walked["hole"] = null;
  let prev: TailLine | null = null;
  for (const entry of lines) {
    const { line } = entry;
    if (prev !== null) {
      if (line.place <= prev.line.place) refused(entry.n, head);
      if (line.place === prev.line.place + 1 && line.prevHash !== prev.line.hash) refused(entry.n, head);
    }
    if (line.place <= head.seq) {
      if (line.place === head.seq && line.hash !== head.hash) refused(entry.n, head);
      checked++;
    } else if (hole === null) {
      const last = run[run.length - 1];
      if (last === undefined) {
        // The first line above the head continues it, or the input is refused whole.
        if (line.place !== head.seq + 1 || line.prevHash !== (head.seq === 0 ? CHAIN_ZERO_HASH : head.hash)) refused(entry.n, head);
        run.push(entry);
      } else if (line.place === last.line.place + 1) run.push(entry);
      else hole = { after: last.line.place, before: line.place };
    }
    prev = entry;
  }
  return { checked, run, hole };
}

// ---------------------------------------------------------------- restore-import: what a lost row writes again

/** What the import wrote again, for its lines and its audit row. */
interface Counts {
  orders: number;
  items: number;
  events: number;
  notifications: number;
  productions: number;
}

/** One gap as the import wrote it, for the printed list. */
interface WrittenGap {
  class: GapClass;
  place: number;
  targetType: string | null;
  targetId: string | null;
  actedAt: string;
  open: boolean;
}

/** The class of a lost decision (6.6): by the measures its signed actions hold, and for a seal by the decision's kind. */
export function decisionClass(params: { kind?: unknown; actions?: unknown }): GapClass {
  const kinds = Array.isArray(params.actions) ? params.actions.map((action) => (action as { kind?: unknown }).kind).filter((kind): kind is ActionKind => typeof kind === "string" && kind in MEASURES) : [];
  const measures = kinds.filter((kind) => MEASURES[kind].lifts === null);
  if (measures.includes("seal_media")) return params.kind === "interim" ? "seal_interim" : "seal_final";
  if (measures.some((kind) => kind === "suspend" || kind === "terminate")) return "standing";
  if (measures.length > 0) return "restriction";
  if (kinds.length > 0) return "reversal";
  return "no_measure";
}

/** The columns a correction of an order's record changes, by the member names its audit row carries. */
const CORRECTED_COLUMNS: Record<string, string> = {
  kind: "kind",
  memberState: "member_state",
  authority: "authority",
  reference: "reference",
  channel: "channel",
  sectionC: "section_c",
  emergency: "emergency",
  withholdFromAuthor: "withhold_from_author",
  crossBorder: "cross_border",
};

/** The writer of one import, in its transaction: the gaps it writes and what it wrote again. */
class Importer {
  readonly counts: Counts = { orders: 0, items: 0, events: 0, notifications: 0, productions: 0 };
  readonly gaps: WrittenGap[] = [];
  constructor(
    private readonly tx: DbTx,
    private readonly importId: string,
    private readonly appOrigin: string | null,
  ) {}

  /** One gap of the lost row: open for a decision or a record it could only note, closed as imported for one it wrote again. */
  async gap(entry: TailLine, cls: GapClass, open: boolean, target: { type: string | null; id: string | null } = { type: entry.line.targetType, id: entry.line.targetId }): Promise<void> {
    const { line } = entry;
    await this.tx.execute(sql`
      insert into public.restore_gaps (import_id, place, hash, action, target_type, target_id, metadata, acted_at, imported_at, class, closed_at, disposition)
      values (${this.importId}::uuid, ${line.place}::bigint, ${line.hash}, ${line.action}, ${target.type}, ${target.id}, ${line.metadata}::jsonb,
              ${line.at}::timestamptz, now(), ${cls}, ${open ? null : sql`now()`}, ${open ? null : "imported"})`);
    this.gaps.push({ class: cls, place: line.place, targetType: target.type, targetId: target.id, actedAt: line.at, open });
  }

  /** A staff account by its id when the restored database holds its profile, else null: a profile is a foreign key. */
  private async staff(id: string): Promise<string | null> {
    if (id === SYSTEM_ACTOR_ID) return null;
    const [row] = await rows<{ id: string }>(this.tx, sql`select p.id from public.profiles p where p.id = ${id}::uuid`);
    return row?.id ?? null;
  }

  /** Whether the order is there; and, since a lost row of it is written again, its imported_at, which exempts its old events (0031). */
  private async touch(orderId: string): Promise<boolean> {
    const touched = await rows<{ id: string }>(this.tx, sql`update public.legal_orders set imported_at = coalesce(imported_at, now()) where id = ${orderId}::uuid returning id`);
    return touched.length > 0;
  }

  /** An item's link as the import writes it: the post's address when the lost row named a post, else the link's digest (6.6). */
  private link(item: Record<string, unknown>): NewOrderItem {
    if (typeof item.postId === "string") {
      if (this.appOrigin === null) refuse("restore-import", "APP_ORIGIN must be set for the migrate service, to write an imported item's address");
      return { link: postLink(this.appOrigin!, item.postId), postId: item.postId };
    }
    return { link: `sha256:${String(item.linkSha256)}`, postId: null };
  }

  /** order_opened: the order, its items and its event `opened`, with their original times, through insertOrder; and the event `imported`. */
  async orderOpened(entry: TailLine): Promise<void> {
    const m = entry.metadata;
    const orderId = entry.line.targetId!;
    const [exists] = await rows<{ id: string }>(this.tx, sql`select id from public.legal_orders where id = ${orderId}::uuid`);
    if (exists === undefined) {
      const items = (m.items as Record<string, unknown>[]) ?? [];
      const messageId = typeof m.messageId === "string" ? ((await rows<{ id: string }>(this.tx, sql`select id from public.contact_messages where id = ${m.messageId}::uuid`))[0]?.id ?? null) : null;
      await insertOrder(this.tx, {
        id: orderId,
        kind: m.kind as never,
        memberState: String(m.memberState),
        authority: String(m.authority),
        reference: String(m.reference),
        channel: m.channel as never,
        messageId,
        sectionC: m.sectionC === true,
        emergency: m.emergency === true,
        crossBorder: m.crossBorder === true,
        withholdFromAuthor: m.withholdFromAuthor === true,
        openedBy: await this.staff(entry.line.actor),
        items: items.map((item) => this.link(item)),
        imported: {
          openedAt: new Date(String(m.openedAt)),
          openedVia: m.via === "cli" ? "cli" : "console",
          receivedAt: typeof m.receivedAt === "string" ? new Date(m.receivedAt) : null,
          sentAt: typeof m.sentAt === "string" ? new Date(m.sentAt) : null,
          items: items.map((item) => ({ id: String(item.itemId), position: Number(item.position), addedAt: new Date(String(item.addedAt)) })),
        },
      });
      await this.tx.execute(sql`insert into public.legal_order_events (order_id, kind, at, via) values (${orderId}::uuid, 'imported', now(), 'cli')`);
      this.counts.orders++;
      this.counts.items += items.length;
      this.counts.events += 2;
    }
    await this.gap(entry, "record", false);
  }

  /** order_items_added: the items, with their own ids, positions and times. */
  async itemsAdded(entry: TailLine): Promise<void> {
    const orderId = entry.line.targetId!;
    if (await this.touch(orderId)) {
      for (const item of (entry.metadata.items as Record<string, unknown>[]) ?? []) {
        const { link, postId } = this.link(item);
        await this.tx.execute(sql`
          insert into public.legal_order_items (id, order_id, position, link, post_id, added_at)
          values (${String(item.itemId)}::uuid, ${orderId}::uuid, ${Number(item.position)}::smallint, ${link}, ${postId}::uuid, ${String(item.addedAt)}::timestamptz)
          on conflict do nothing`);
        this.counts.items++;
      }
    }
    await this.gap(entry, "record", false);
  }

  /**
   * order_corrected: the changed members' new values in one update (the CHECKs hold at each row update, as order_correct
   * writes them), with the withholding and the preservation the order's kind forces; the items it closed; its event.
   */
  async corrected(entry: TailLine): Promise<void> {
    const m = entry.metadata;
    const orderId = entry.line.targetId!;
    if (await this.touch(orderId)) {
      const changed = (m.changed as Record<string, unknown>[]) ?? [];
      const to = (member: string) => changed.find((change) => change.member === member)?.to ?? null;
      // The withholding and the preservation are written in the same statement, from the new values: the CHECK on a
      // removal order holds at each row update, and a column may be set once in one statement.
      const sets = changed
        .filter((change) => typeof change.member === "string" && change.member in CORRECTED_COLUMNS && change.member !== "withholdFromAuthor")
        .map((change) => sql`${sql.raw(CORRECTED_COLUMNS[change.member as string]!)} = ${change.to as string | boolean}`);
      const kind = sql`coalesce(${to("kind") as string | null}::text, kind)`;
      await this.tx.execute(sql`
        update public.legal_orders
           set ${sets.length > 0 ? sql`${sql.join(sets, sql`, `)}, ` : sql``}
               withhold_from_author = coalesce(${to("withholdFromAuthor") as boolean | null}::boolean, withhold_from_author) or ${kind} = 'tco_removal'
                                      or coalesce(${to("sectionC") as boolean | null}::boolean, section_c),
               preserve = ${kind} = 'tco_removal'
         where id = ${orderId}::uuid`);
      for (const change of changed.filter((entry) => entry.member === "closeItems")) {
        await this.tx.execute(sql`update public.legal_order_items set closed_at = ${entry.line.at}::timestamptz, closed_reason = ${String(change.reason)}
                                   where id = ${String(change.itemId)}::uuid and order_id = ${orderId}::uuid and disabled_at is null`);
      }
      await this.event(orderId, { id: typeof m.eventId === "string" ? m.eventId : null, kind: "corrected", ground: String(m.rule), at: entry.line.at, by: await this.staff(entry.line.actor), via: "console" });
    }
    await this.gap(entry, "record", false);
  }

  /** order_event_recorded: the console's event, and what it set on the order (a closing, a reopening, the extension). */
  async consoleEvent(entry: TailLine): Promise<void> {
    const m = entry.metadata;
    const params = (m.params as Record<string, unknown>) ?? {};
    const orderId = entry.line.targetId!;
    if (await this.touch(orderId)) {
      const kind = String(params.kind);
      if (kind === "closed_without_effect") await this.tx.execute(sql`update public.legal_orders set closed_at = ${entry.line.at}::timestamptz where id = ${orderId}::uuid`);
      if (kind === "reopened") await this.tx.execute(sql`update public.legal_orders set closed_at = null where id = ${orderId}::uuid`);
      if (kind === "hold_extended") await this.tx.execute(sql`update public.legal_orders set hold_extended = true where id = ${orderId}::uuid`);
      await this.event(orderId, {
        id: typeof m.eventId === "string" ? m.eventId : null,
        kind,
        ground: typeof params.ground === "string" ? params.ground : null,
        at: entry.line.at,
        effectiveAt: typeof m.effectiveAt === "string" ? m.effectiveAt : null,
        by: await this.staff(entry.line.actor),
        via: "console",
      });
    }
    await this.gap(entry, "record", false);
  }

  /** One event of an order with its original time, as the migrator, whose insert the trigger does not force. */
  private async event(orderId: string, e: { id: string | null; kind: string; ground: string | null; at: string; effectiveAt?: string | null; by: string | null; via: string; itemId?: string | null }): Promise<void> {
    await this.tx.execute(sql`
      insert into public.legal_order_events (id, order_id, item_id, kind, at, effective_at, ground, by_staff, via)
      values (coalesce(${e.id}::uuid, gen_random_uuid()), ${orderId}::uuid, ${e.itemId ?? null}::uuid, ${e.kind}, ${e.at}::timestamptz, ${e.effectiveAt ?? null}::timestamptz,
              ${e.ground}, ${e.by}::uuid, ${e.via})
      on conflict do nothing`);
    this.counts.events++;
  }

  /**
   * order_recorded: a command line's event, with what the command set on the order, from the facts its audit row holds.
   * A text the command recorded (the reasons, the remedies, the scope, how a check was made, a hold's basis) is named
   * there by its digest alone and stays lost: its event is written, its column is not.
   */
  async cliEvent(entry: TailLine): Promise<void> {
    const m = entry.metadata;
    const orderId = entry.line.targetId!;
    const at = entry.line.at;
    if (await this.touch(orderId)) {
      const set = (assignments: ReturnType<typeof sql>) => this.tx.execute(sql`update public.legal_orders set ${assignments} where id = ${orderId}::uuid`);
      const time = (value: unknown) => (typeof value === "string" ? value : null);
      const event = String(m.event);
      let ground: string | null = null;
      let effectiveAt: string | null = null;
      let itemId: string | null = null;
      switch (event) {
        case "received_set":
          await set(sql`received_at = ${time(m.receivedAt)}::timestamptz`);
          break;
        case "sent_at_set":
          await set(sql`sent_at = ${time(m.sentAt)}::timestamptz`);
          break;
        case "due_set":
          await set(sql`due_at = ${time(m.dueAt)}::timestamptz`);
          break;
        case "verified":
          await set(sql`verified_at = ${time(m.verifiedAt)}::timestamptz`);
          break;
        case "issued_at_set":
          await set(sql`issued_at = ${time(m.issuedAt)}::timestamptz`);
          break;
        case "document_recorded":
          await set(sql`document_sha256 = ${String(m.documentSha256)}, document_bytes = ${Number(m.documentBytes)}::bigint`);
          break;
        case "reopened":
          await set(sql`closed_at = null`);
          break;
        case "tell_person_set":
          await set(sql`tell_person = ${String(m.rule)}, tell_person_at = ${time(m.at)}::timestamptz`);
          break;
        case "hold_until_set":
          await set(sql`authority_hold_until = ${time(m.until)}::timestamptz`);
          break;
        case "hold_extended":
          await set(sql`hold_extended = true`);
          effectiveAt = time(m.received);
          break;
        case "hold_ended":
          ground = String(m.reason);
          await set(sql`hold_ended_at = ${at}::timestamptz, hold_end_reason = ${ground}`);
          break;
        case "scrutiny_requested":
          effectiveAt = time(m.at);
          break;
        case "scrutiny_decided":
          ground = String(m.outcome);
          effectiveAt = time(m.at);
          break;
        case "person_told":
          effectiveAt = time(m.at);
          break;
        case "preservation_extended":
          itemId = String(m.itemId);
          await this.tx.execute(sql`update public.legal_order_items set preserve_until = ${time(m.until)}::timestamptz where id = ${itemId}::uuid and order_id = ${orderId}::uuid`);
          break;
      }
      await this.event(orderId, { id: null, kind: event, ground, at, effectiveAt, by: null, via: "cli", itemId });
    }
    await this.gap(entry, "record", false);
  }

  /**
   * order_effected: one gap of the class order_effect an item, and each item's first disabling and preservation as the
   * lost row dates them (LAB F): an item whose preservation never ended keeps preserve_until, so its post is frozen at once,
   * before any measure is back, and the disabling taken again starts no new period. No decision, no measure.
   */
  async effected(entry: TailLine): Promise<void> {
    const decisionIds = (entry.metadata.decisionIds as Record<string, unknown>) ?? {};
    for (const itemId of Object.keys(decisionIds).sort()) {
      await this.tx.execute(sql`
        update public.legal_order_items i
           set disabled_at = coalesce(i.disabled_at, ${entry.line.at}::timestamptz),
               preserve_until = case when o.preserve and i.preserve_ended_at is null then coalesce(i.preserve_until, public.order_preserve_until(${entry.line.at}::timestamptz)) else i.preserve_until end
          from public.legal_orders o
         where o.id = i.order_id and i.id = ${itemId}::uuid and i.action_id is null`);
      await this.gap(entry, "order_effect", true, { type: "order_item", id: itemId });
    }
  }

  /** case_decided and appeals_reviewed: one open gap, of the class the lost decision's signed actions give it. */
  async decided(entry: TailLine): Promise<void> {
    await this.gap(entry, decisionClass((entry.metadata.params as Record<string, unknown>) ?? {}), true);
  }

  /**
   * notification_recorded: the step `opened` writes the record again, owed, with its original opening and imported_at,
   * its case, its seal and its duties, and its account as the restored case names it; every later step (sent, declined,
   * answered, event), whose row holds too little to write it (an authority, a channel, a reason), is a gap of the class
   * record, which the operator closes by entering it again with its command and --gap.
   */
  async notification(entry: TailLine): Promise<void> {
    const m = entry.metadata;
    if (m.step !== "opened") return this.gap(entry, "record", true);
    const caseId = typeof m.caseId === "string" ? m.caseId : null;
    const seal = typeof m.sealActionId === "string" ? m.sealActionId : null;
    const duties = Array.isArray(m.duties) ? (m.duties as string[]) : [];
    const written = await rows<{ id: string }>(
      this.tx,
      sql`insert into public.authority_notifications (id, state, duties, case_id, seal_action_id, account_id, opened_at, opened_via, imported_at)
          select ${entry.line.targetId}::uuid, 'owed', ${`{${duties.join(",")}}`}::text[], ${caseId}::uuid, ${seal}::uuid,
                 (select case when k.target_type = 'account' then k.target_id else (select p.author_id from public.posts p where p.id = k.target_id) end
                    from public.cases k where k.id = ${caseId}::uuid),
                 ${typeof m.at === "string" ? m.at : entry.line.at}::timestamptz, ${seal === null ? "cli" : "system"}, now()
          on conflict do nothing
          returning id`,
    );
    this.counts.notifications += written.length;
    await this.gap(entry, "record", false);
  }

  /** A production, or an access for an authority, which the import can only note: a gap of the class record. */
  async noted(entry: TailLine): Promise<void> {
    await this.gap(entry, "record", true);
  }

  /**
   * 3d Task 2 (design, sections 6.2 and 7.3 step 1): a lost release of a seal is a gap of the class release, which
   * staff.js release-replay closes: the restored database again treats its images as sealed and kept.
   */
  async released(entry: TailLine): Promise<void> {
    await this.gap(entry, "release", true);
  }

  /**
   * A lost leave (release_leave_recorded): a gap of the class release, which release-leave --gap closes when the operator
   * records it again, under the id its line names; none for a leave that a later line of the copy withdraws (it supported
   * no release), and none where the restored database holds the leave as the line records it (nothing was lost). A line
   * that ended an open hold on telling of a leave the database holds is a gap that release-leave --end-untold --gap closes.
   */
  async leaveRecorded(entry: TailLine, withdrawnLater: ReadonlySet<string>): Promise<void> {
    const leaveId = entry.metadata.leaveId;
    if (typeof leaveId !== "string" || withdrawnLater.has(leaveId)) return;
    const [held] = await rows<{ until: string | null }>(this.tx, sql`select ${isoOf("l.untold_until")} as until from public.release_leaves l where l.id = ${leaveId}::uuid`);
    if (held !== undefined && held.until === (entry.metadata.untoldUntil ?? null)) return;
    await this.gap(entry, "release", true);
  }

  /**
   * A lost withdrawal of a leave (release_leave_withdrawn): a gap of the class release only where the restored database
   * holds the leave and shows it standing, which release-leave --withdraw --gap closes; a leave it does not hold supported
   * no release and is not recorded again.
   */
  async leaveWithdrawn(entry: TailLine): Promise<void> {
    const leaveId = entry.metadata.leaveId;
    if (typeof leaveId !== "string") return;
    const [held] = await rows<{ withdrawn: boolean }>(this.tx, sql`select l.withdrawn_at is not null as withdrawn from public.release_leaves l where l.id = ${leaveId}::uuid`);
    if (held === undefined || held.withdrawn) return;
    await this.gap(entry, "release", true);
  }
}

/** Runs one lost row through the importer, by its action; a row that describes neither a record nor a decision writes nothing. */
async function importLine(importer: Importer, entry: TailLine, withdrawnLater: ReadonlySet<string>): Promise<void> {
  switch (entry.line.action) {
    // 3d Task 2: a release of a seal, a leave recorded and a leave withdrawn, each a gap of the class release.
    case "seal_released":
      return importer.released(entry);
    case "release_leave_recorded":
      return importer.leaveRecorded(entry, withdrawnLater);
    case "release_leave_withdrawn":
      return importer.leaveWithdrawn(entry);
    case "order_opened":
      return importer.orderOpened(entry);
    case "order_items_added":
      return importer.itemsAdded(entry);
    case "order_corrected":
      return importer.corrected(entry);
    case "order_event_recorded":
      return importer.consoleEvent(entry);
    case "order_recorded":
      return importer.cliEvent(entry);
    case "order_effected":
      return importer.effected(entry);
    case "case_decided":
    case "appeals_reviewed":
    // 3d Task 6 (8.7, "A program's lost measure"): a program's decision is lost like a person's, by the class its one
    // measure gives it, a restriction for a withheld image and seal_interim for a seal; a person decides it again.
    case "automated_decided":
      return importer.decided(entry);
    case "notification_recorded":
      return importer.notification(entry);
    case "production_recorded":
      return importer.noted(entry);
    case "preserved_accessed":
      // An access for an authority opened a production of its own (Task 5); an access for a review or a complaint did not.
      if (typeof entry.metadata.productionId === "string") return importer.noted(entry);
      return;
    default:
      // A sign-in, a key's or a session's row, a retention round, a copy, a message closed, a reveal: no record of 3f and
      // no measure. The mailbox and the operator's notes are their record.
      return;
  }
}

/** What restore-import reports: its lines on standard output, or its one sentence of refusal. */
export type ImportDone = { ok: true; lines: string[] } | { ok: false; problem: string };

/**
 * restore-import (7.17 step 2, 8.11), as the migrator, in one transaction with the 10-second lock timeout: reads the
 * restored head, checks the input (readTail, walkTail), writes again what the unbroken run from the head describes and the
 * gaps, and last the audit row restore_imported under the system actor, with the first and last places, the counts by
 * class, the hole and the SHA-256 of the input as given (the files arrive concatenated, so one digest names them all).
 */
export async function restoreImport(migrateDb: Db, kept: readonly { seq: number; hash: string }[], input: Buffer, appOrigin: string | null): Promise<ImportDone> {
  const c = "restore-import";
  try {
    const lines = await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      const [row] = await rows<{ seq: string; hash: string }>(tx, sql`select h.seq::text as seq, h.hash from public.audit_head h where h.id = 1`);
      const head = { seq: Number(row!.seq), hash: row!.hash };
      const walked = walkTail(readTail(input, head), head, kept);
      const importer = new Importer(tx, randomUUID(), appOrigin);
      // 3d Task 2: a leave that a later line of the copy withdraws gets no gap: it supported no release.
      const withdrawnLater = new Set(walked.run.filter((entry) => entry.line.action === "release_leave_withdrawn").map((entry) => String(entry.metadata.leaveId)));
      for (const entry of walked.run) await importLine(importer, entry, withdrawnLater);
      const first = walked.run[0]?.line.place ?? null;
      const last = walked.run[walked.run.length - 1]?.line.place ?? null;
      const byClass = Object.fromEntries(GAP_CLASSES.map((cls) => [cls, importer.gaps.filter((gap) => gap.class === cls).length]).filter(([, n]) => (n as number) > 0));
      await appendAuditRow(tx, {
        actorId: SYSTEM_ACTOR_ID,
        action: "restore_imported",
        targetType: null,
        targetId: null,
        requestId: null,
        metadata: {
          firstPlace: first,
          lastPlace: last,
          counts: byClass,
          holes: walked.hole === null ? [] : [[walked.hole.after, walked.hole.before]],
          files: [createHash("sha256").update(input).digest("hex")],
        },
      });
      return describeImport(c, head, walked, importer, lastLineAt(input));
    });
    return { ok: true, lines };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}

/** The time of the input's last line: the keeper's last download, after which nothing is in these files. */
function lastLineAt(input: Buffer): string | null {
  const LF = String.fromCharCode(10);
  const text = input.toString("utf8").split(LF).filter((line) => line.trim() !== "");
  try {
    return text.length === 0 ? null : (AuditExportLine.parse(JSON.parse(text[text.length - 1]!)).at as string);
  } catch {
    return null;
  }
}

/** The lines 8.11 prints after an import: what continued the head, what was written again, the gaps in their order, what to do. */
function describeImport(c: string, head: { seq: number; hash: string }, walked: Walked, importer: Importer, lastAt: string | null): string[] {
  const out: string[] = [];
  const first = walked.run[0]?.line.place;
  const last = walked.run[walked.run.length - 1]?.line.place;
  out.push(
    first === undefined
      ? `${c}: the files hold nothing after the head ${head.seq}:${head.hash} (${walked.checked} earlier lines checked, not imported).`
      : `${c}: places ${first} to ${last} continue the head ${head.seq}:${head.hash} (${walked.checked} earlier lines checked, not imported).`,
  );
  const n = importer.counts;
  out.push(`${c}: written again: ${n.orders} orders, ${n.items} items, ${n.events} events, ${n.notifications} notification records, ${n.productions} productions.`);
  const open = importer.gaps.filter((gap) => gap.open).sort((a, b) => GAP_CLASSES.indexOf(a.class) - GAP_CLASSES.indexOf(b.class) || Date.parse(a.actedAt) - Date.parse(b.actedAt) || a.place - b.place);
  out.push(`${c}: gaps, in the order to take them again:`);
  for (const [index, gap] of open.entries()) out.push(`${c}: ${index + 1}. ${gap.class}, ${gap.targetType ?? "no target"} ${gap.targetId ?? ""}`.trimEnd() + `, first done ${gap.actedAt}`);
  if (open.length === 0) out.push(`${c}: none.`);
  const site = open.filter((gap) => GAP_SITE_CLASSES.includes(gap.class)).length;
  out.push(
    site > 0
      ? `${c}: The app's site stays closed until gaps 1 to ${site} are closed on the console's After a restore screen.`
      : `${c}: No order disabling and no seal was lost: the app's site may open once the operator has read the rest.`,
  );
  out.push(`${c}: Not in these files: anything after ${lastAt ?? "the head"}, the keeper's last download. Compare the contact-point mailbox since then with the orders above; open what is missing with order-open.`);
  if (walked.hole !== null) out.push(`${c}: the files hold nothing between place ${walked.hole.after} and place ${walked.hole.before}: what happened there is not imported`);
  return out;
}
