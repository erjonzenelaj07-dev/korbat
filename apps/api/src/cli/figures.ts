/**
 * The public figures' commands (3d design, sections 7.5, 7.6 and 8.10, "The public figures and the head"), as the
 * migrator in the migrate service:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js recipients [--months 6]
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year> [--correct]
 *   docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js head-restore-mark [<day>:<value> ...]
 *
 * recipients prints the figure of DSA Art. 24(2) and (3) exactly, for the authority that asks: the stored months of the
 * full months before today, and their average as two bounds, accounts alone and accounts plus the sum of each day's
 * signed-out readers, or "at least" while signed-out readers were not counted. It reads only.
 *
 * edition prints the newest stored version of a year's edition as its page prints it, a line a figure, and reads only.
 * With --correct it computes every table of the year again, as of the same due day, and stores the result as the next
 * version with the reason correction (edition_publish, which only the migrator may ask for that): the one way a table is
 * computed a second time. The older versions stay, and the transaction ends with the edition's audit row.
 *
 * head-restore-mark (Task 5; sections 6.5, 7.3 step 4 and 7.7 step 7), after a restore: it stores the values the keeper's
 * mails hold for the days the restored database lacks, each as a retired row without a place (the mail's day and value
 * are what the command is given); retires every stored value whose place and hash the restored chain no longer holds,
 * and deletes none; and writes today's public restore row from the restored head, naming the newest published value that
 * still fits. The transaction ends with the system's audit row head_restore_marked.
 *
 * No command here sends anything to anyone. This file has no entry point of its own, so both bundles can include it
 * (build.mjs says why that matters).
 */
import { sql } from "drizzle-orm";
import { RECIPIENT_RULES, TRANSPARENCY_RULES, type OrderFigures, type TransparencyFigures } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "../auth";
import { appendAuditRow } from "../staff";
import { describeTcoCounts } from "./counts";
import { Refusal, refuse, rows, type OrderDone } from "./orders";

/** The public figures' commands, each with its first lines of STAFF_USAGE. */
export const FIGURE_COMMANDS = ["recipients", "edition", "head-restore-mark"] as const;
export type FigureCommandName = (typeof FIGURE_COMMANDS)[number];

export const FIGURE_USAGE = [
  `${"  recipients [--months 6]".padEnd(41)}print the average monthly active recipients of the full months before today, exactly, for an`,
  `${"".padEnd(41)}authority that asks (DSA Art. 24(3)), a line a month; read-only; run it in the migrate service`,
  `${"  edition <year> [--correct]".padEnd(41)}print the newest stored version of that year's edition, a line a figure; read-only. With`,
  `${"".padEnd(41)}--correct, compute every table again and store it as the next version; run it in the migrate service`,
  `${"  head-restore-mark [<day>:<value> ...]".padEnd(41)}after a restore: store the keeper's values of the days the restored database lacks,`,
  `${"".padEnd(41)}retire every published value that no longer fits, and record the restore; run it in the migrate service`,
];

/** A keeper's value as the command is given it: the day of the mail and the value it holds. */
export interface KeeperValue {
  day: string;
  value: string;
}

export type FigureCommand =
  | { command: "recipients"; months: number }
  | { command: "edition"; year: number; correct: boolean }
  | { command: "head-restore-mark"; values: KeeperValue[] };

/** A calendar year as the operator types it: four digits, never with a leading zero. */
const YEAR = /^[1-9][0-9]{3}$/;
/** How many full months recipients may average: one to five years of them. */
const MONTHS = /^[1-9][0-9]?$/;

/** A keeper's value as the operator types it: the day, a colon and the value's 64 lower-case hexadecimal characters. */
const KEEPER_VALUE = /^([0-9]{4}-[0-9]{2}-[0-9]{2}):([0-9a-f]{64})$/;
/** Whether a yyyy-mm-dd is a day of the calendar. */
const isDay = (day: string) => !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;

/** Reads a figure command's words. */
export function parseFigureArgs(command: FigureCommandName, rest: readonly string[]): FigureCommand {
  if (command === "head-restore-mark") {
    const usage = "head-restore-mark: takes the keeper's values as <day>:<value>, a day as 2026-10-18 and a value of 64 lower-case hexadecimal characters, each day once, or nothing";
    const values = rest.map((word) => {
      const found = KEEPER_VALUE.exec(word);
      if (found === null || !isDay(found[1]!)) throw new Error(usage);
      return { day: found[1]!, value: found[2]! };
    });
    if (new Set(values.map((entry) => entry.day)).size !== values.length) throw new Error(usage);
    return { command, values };
  }
  if (command === "recipients") {
    if (rest.length === 0) return { command, months: RECIPIENT_RULES.months };
    if (rest.length === 2 && rest[0] === "--months" && MONTHS.test(rest[1]!) && Number(rest[1]) <= 60) return { command, months: Number(rest[1]) };
    throw new Error("recipients: takes nothing, or --months and a number of full months from 1 to 60");
  }
  const [year, ...flags] = rest;
  if (year === undefined || !YEAR.test(year) || flags.length > 1 || (flags.length === 1 && flags[0] !== "--correct")) {
    throw new Error("edition: takes one calendar year of four digits, as 2026, and optionally --correct");
  }
  return { command, year: Number(year), correct: flags.length === 1 };
}

/** The first day of the month `back` months before the instant's own, as yyyy-mm. */
const monthBefore = (at: Date, back: number) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - back, 1)).toISOString().slice(0, 7);

/** The day a year's edition is due, as the pages print a day. */
const dueDay = (year: number) => new Date(Date.UTC(year + 1, TRANSPARENCY_RULES.dueMonth - 1, TRANSPARENCY_RULES.dueDay)).toISOString().slice(0, 10);

/** One stored month as the command reads it. */
interface MonthRow {
  month: string;
  signed_in: number;
  signed_out_days: number | null;
}

/** What recipients prints of the stored months among the `months` full months before `now` (7.5 step 4). */
export function describeRecipients(stored: readonly MonthRow[], months: number, now: Date): string[] {
  const line = (text: string) => `recipients: ${text}`;
  const wanted = Array.from({ length: months }, (_, at) => monthBefore(now, months - at));
  const byMonth = new Map(stored.map((row) => [row.month, row]));
  const found = wanted.flatMap((month) => (byMonth.has(month) ? [byMonth.get(month)!] : []));
  const lines = [line(`method ${RECIPIENT_RULES.method}; the ${months} full months to ${wanted.at(-1)}.`)];
  for (const month of wanted) {
    const row = byMonth.get(month);
    lines.push(line(row === undefined ? `${month}: not recorded` : `${month}: signed in ${row.signed_in}; signed out, summed by day, ${row.signed_out_days ?? "not counted"}`));
  }
  if (found.length < months) lines.push(line(`only ${found.length} full months are recorded.`));
  if (found.length === 0) return [...lines, line("average monthly active recipients: not recorded.")];
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const signedIn = average(found.map((row) => row.signed_in));
  const counted = found.every((row) => row.signed_out_days !== null);
  lines.push(
    counted
      ? line(`average monthly active recipients: between ${Math.round(signedIn)} and ${Math.round(signedIn + average(found.map((row) => row.signed_out_days!)))}.`)
      : line(`average monthly active recipients: at least ${Math.round(signedIn)}; signed-out readers are not counted.`),
  );
  return lines;
}

/** The words of a table's labels on the command line: a rule, the law, the kinds and the results as the ledger names them. */
const LABEL_WORDS: Record<string, string> = {
  law: "the law",
  other: "other",
  rules: "reports under the rules",
  illegal: "notices of illegal content",
  finding: "findings by korbat's moderators",
  automated: "findings by a program",
  action: "action taken",
  no_action: "no action again",
};
const labelOf = (label: string) => LABEL_WORDS[label] ?? label;
const REASON_WORDS = { first: "first", hold_ended: "hold ended", correction: "correction" } as const;

/** One stored version as edition prints it: a line a figure, each starting with the command's name. */
export function describeEdition(year: number, version: { version: number; published_on: string; reason: keyof typeof REASON_WORDS; figures: TransparencyFigures }): string[] {
  const line = (text: string) => `edition: ${text}`;
  const f = version.figures;
  const table = (title: string, rowsOf: readonly { label: string; count: string }[]) =>
    rowsOf.length === 0 ? [line(`${title}: none`)] : rowsOf.map((row) => line(`${title}, ${labelOf(row.label)}: ${row.count}`));
  const lines = [
    line(`${year}, version ${version.version} of ${version.published_on}, ${REASON_WORDS[version.reason]}.`),
    ...table("restrictions by ground", f.restrictions.byGround),
    line(`restrictions, all: ${f.restrictions.total}`),
    ...table("restrictions by kind of measure", f.restrictions.byMeasure),
    line(`decisions that found no breach: ${f.noBreach}`),
    ...table("reports and notices received", f.intakes),
    ...table("appeals answered", f.appeals),
    ...table("re-examinations answered", f.reexaminations),
    ...table("measures on accounts", f.accountMeasures),
    ...table("findings by a program", f.automated.findings),
    ...table("measures a program took", f.automated.measures),
    ...(f.automated.r1 ? [line(`of ${f.automated.r1.base} findings by a program under rule R1, a person then restricted ${f.automated.r1.restricted}`)] : []),
    ...(f.uploads ? table("uploads not accepted", f.uploads) : []),
    ...(f.orders ? orderLines(year, f.orders) : []),
    line(
      `recipients: ${
        f.recipients === "not recorded" ? "not recorded" : f.recipients.high === undefined ? `at least ${f.recipients.low}; signed-out readers are not counted` : `between ${f.recipients.low} and ${f.recipients.high}`
      }`,
    ),
  ];
  return lines;
}

/** The order section as tco-counts prints its figures, without the issuing state, which the edition does not hold. */
function orderLines(year: number, orders: OrderFigures): string[] {
  const counts = { year, ...orders, received: orders.received === null ? null : { ...orders.received, byState: [] as [string, number][] } };
  return describeTcoCounts(counts).map((text) => text.replace(/^tco-counts: /, "edition: authorities' orders, "));
}

/** A P0001 code a database function raised, or null. */
function raisedCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const found = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (found.code === "P0001" && typeof found.message === "string") return found.message;
    current = found.cause;
  }
  return null;
}

type VersionRow = { version: number; published_on: string; reason: keyof typeof REASON_WORDS; figures: TransparencyFigures };

/** The newest stored version of a year, or null. */
async function newestVersion(tx: DbTx, year: number): Promise<VersionRow | null> {
  const [row] = await rows<VersionRow>(
    tx,
    sql`select version, to_char(published_at at time zone 'UTC', 'YYYY-MM-DD') as published_on, reason, figures
          from public.transparency_editions where year = ${year} order by version desc limit 1`,
  );
  return row ?? null;
}

/**
 * recipients and edition on the migrator's own connection, with the command line's 10-second lock timeout: the reads in
 * one read-only transaction at one snapshot; the correction in a transaction whose last statement is the edition's audit
 * row, which edition_publish writes. A refusal prints `edition: <code>: ...` and changes nothing.
 */
export async function figureCommand(migrateDb: Db, cmd: FigureCommand, now: Date = new Date()): Promise<OrderDone> {
  try {
    if (cmd.command === "head-restore-mark") return { ok: true, lines: await headRestoreMark(migrateDb, cmd.values) };
    if (cmd.command === "recipients") {
      const from = `${monthBefore(now, cmd.months)}-01`;
      const to = `${monthBefore(now, 0)}-01`;
      const stored = await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        await tx.execute(sql`set local lock_timeout = '10s'`);
        return rows<MonthRow>(tx, sql`select to_char(month, 'YYYY-MM') as month, signed_in, signed_out_days from public.recipient_months where month >= ${from}::date and month < ${to}::date order by month`);
      });
      return { ok: true, lines: describeRecipients(stored, cmd.months, now) };
    }
    if (!cmd.correct) {
      const newest = await migrateDb.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read, read only`);
        await tx.execute(sql`set local lock_timeout = '10s'`);
        return newestVersion(tx, cmd.year);
      });
      return { ok: true, lines: newest === null ? [`edition: none stored for ${cmd.year}.`] : describeEdition(cmd.year, newest) };
    }
    await migrateDb
      .transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // A correction is stored or refused, never null; its audit row is the transaction's last statement.
        await tx.execute(sql`select public.edition_publish(${cmd.year}::int, 'correction')`);
      })
      .catch((err: unknown) => {
        const code = raisedCode(err);
        if (code === "edition_not_due") throw new Refusal(`edition: edition_not_due: the edition of ${cmd.year} is due on ${dueDay(cmd.year)}; nothing changed`);
        if (code === "invalid_edition") return refuse("edition", `invalid_edition: no edition of ${cmd.year} is stored yet; the job publishes its first version on or after ${dueDay(cmd.year)}`);
        throw err;
      });
    // The version just stored is the year's newest.
    const stored = await migrateDb.transaction((tx) => newestVersion(tx, cmd.year));
    return {
      ok: true,
      lines: [`edition: ${cmd.year}, version ${stored!.version} stored, every table computed again. The page lists version ${stored!.version - 1} as replaced on ${stored!.published_on}.`],
    };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}

/**
 * head-restore-mark (3d design, sections 6.5, 7.3 step 4 and 7.7 step 7), in one transaction as the migrator, whose
 * inserts and updates the head's two triggers leave as written. Every refusal comes before the first write: one restore
 * a day (the restore row's key is the day), no keeper's day after today, and no keeper's value that differs from the one
 * the restored database holds for that day. Then:
 *
 *   1. each keeper's value of a day the database lacks is stored as that day's head row, published and retired at once,
 *      with no place (the mail's place is not asked for: no check needs it, and a value of a day after the backup fits
 *      no restored log anyway); a value the database holds already is counted and left;
 *   2. every stored value, of either kind, whose place and hash the restored chain no longer holds is retired, never
 *      deleted: a place above the restored head, or a place whose hash does not give the value;
 *   3. today's restore row from the restored head, published, naming the newest published head value that still fits,
 *      or none (last_day, which the page prints as [tr.restore]'s day);
 *   4. last, the system's audit row head_restore_marked with the day and the count of values retired.
 */
async function headRestoreMark(migrateDb: Db, values: readonly KeeperValue[]): Promise<string[]> {
  const c = "head-restore-mark";
  return migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [state] = await rows<{ today: string; seq: number; hash: string }>(
      tx,
      sql`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today, a.seq::int as seq, a.hash from public.audit_head a where a.id = 1`,
    );
    const { today, seq, hash } = state!;
    const [marked] = await rows<{ one: number }>(tx, sql`select 1 as one from public.head_publications where kind = 'restore' and day = ${today}::date`);
    if (marked !== undefined) refuse(c, `restore_marked: a restore is recorded for ${today} already`);
    const held: string[] = [];
    for (const { day, value } of values) {
      if (day > today) refuse(c, `invalid_day: ${day} is after today`);
      const [row] = await rows<{ value: string }>(tx, sql`select value from public.head_publications where kind = 'head' and day = ${day}::date`);
      if (row !== undefined && row.value !== value) refuse(c, `head_mismatch: the value of ${day} differs from the one the database holds`);
      if (row !== undefined) held.push(day);
    }
    let stored = 0;
    for (const { day, value } of values) {
      if (held.includes(day)) continue;
      await tx.execute(sql`
        insert into public.head_publications (day, kind, chain_seq, value, witness, published_at, retired_at)
        values (${day}::date, 'head', null, ${value}, 'none', now(), now())`);
      stored++;
    }
    // A value fits while the restored chain holds its place with a hash that gives it: at the head itself, or at a row of
    // the log. A place above the restored head has neither.
    const retired = await tx.execute(sql`
      update public.head_publications h set retired_at = now()
       where h.retired_at is null and h.chain_seq is not null
         and not exists (
           select 1 from public.audit_head a where a.id = 1 and a.seq = h.chain_seq and public.head_value(h.day, a.seq, a.hash) = h.value
           union all
           select 1 from public.audit_log l where l.chain_seq = h.chain_seq and public.head_value(h.day, l.chain_seq, l.hash) = h.value)
      returning 1`);
    const [last] = await rows<{ day: string | null }>(
      tx,
      sql`select to_char(max(h.day), 'YYYY-MM-DD') as day from public.head_publications h where h.kind = 'head' and h.published_at is not null and h.retired_at is null`,
    );
    const lastDay = last?.day ?? null;
    await tx.execute(sql`
      insert into public.head_publications (day, kind, chain_seq, value, witness, published_at, last_day)
      values (${today}::date, 'restore', ${seq}, public.head_value(${today}::date, ${seq}::bigint, ${hash}), 'none', now(), ${lastDay}::date)`);
    const count = stored + retired.length;
    await appendAuditRow(tx, { actorId: SYSTEM_ACTOR_ID, action: "head_restore_marked", targetType: null, targetId: null, requestId: null, metadata: { day: today, retired: count } });
    return [
      ...(values.length > 0 ? [`${c}: ${stored} values of the keeper's mails stored, retired; ${held.length} already held.`] : []),
      `${c}: restore recorded for ${today}. ${lastDay === null ? "No published value still verifies." : `The last published value that still verifies is of ${lastDay}.`} ${count} later values are shown as retired.`,
    ];
  });
}
