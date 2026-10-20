/**
 * The public figures' commands (3d design, sections 7.5, 7.6 and 8.10, "The public figures and the head"), as the
 * migrator in the migrate service:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js recipients [--months 6]
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year> [--correct]
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
 * No command here sends anything to anyone. This file has no entry point of its own, so both bundles can include it
 * (build.mjs says why that matters).
 */
import { sql } from "drizzle-orm";
import { RECIPIENT_RULES, TRANSPARENCY_RULES, type OrderFigures, type TransparencyFigures } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { describeTcoCounts } from "./counts";
import { Refusal, refuse, rows, type OrderDone } from "./orders";

/** The public figures' commands, each with its first lines of STAFF_USAGE. */
export const FIGURE_COMMANDS = ["recipients", "edition"] as const;
export type FigureCommandName = (typeof FIGURE_COMMANDS)[number];

export const FIGURE_USAGE = [
  `${"  recipients [--months 6]".padEnd(41)}print the average monthly active recipients of the full months before today, exactly, for an`,
  `${"".padEnd(41)}authority that asks (DSA Art. 24(3)), a line a month; read-only; run it in the migrate service`,
  `${"  edition <year> [--correct]".padEnd(41)}print the newest stored version of that year's edition, a line a figure; read-only. With`,
  `${"".padEnd(41)}--correct, compute every table again and store it as the next version; run it in the migrate service`,
];

export type FigureCommand = { command: "recipients"; months: number } | { command: "edition"; year: number; correct: boolean };

/** A calendar year as the operator types it: four digits, never with a leading zero. */
const YEAR = /^[1-9][0-9]{3}$/;
/** How many full months recipients may average: one to five years of them. */
const MONTHS = /^[1-9][0-9]?$/;

/** Reads a figure command's words. */
export function parseFigureArgs(command: FigureCommandName, rest: readonly string[]): FigureCommand {
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
