/**
 * The yearly counts (3f design, section 2 row 40, sections 7.18 and 8.11, "Recovery and the counts"):
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js tco-counts <year>
 *
 * Each January the operator prints, for the calendar year before in UTC, the figures that TCO Art. 7(3) and 21(1) ask
 * of a host, and publishes them by hand before 1 March when any is not zero (the README's "The yearly counts"; 3d prints
 * them on the transparency page later). It runs as the migrator, as every command of 3f does, since only the migrator
 * reads the productions; in one read-only transaction at one snapshot, and it writes no audit row: it changes nothing.
 *
 * Every figure is counted from rows, and a figure the rows can no longer give prints "not recorded", never 0, so that a
 * published zero is always a true one. The rows a year's figures rest on are the orders of that year (by their receipt,
 * or by their opening when nobody recorded a receipt), their items by the time each was disabled and their events by
 * the time each took effect; the ledger's decisions by when they were decided; the productions by when each was opened;
 * and the audit log's rows by when each was written. An order's records go three years after its last event, and a
 * production's with it (6.8), while the ledger and the audit log stay: so the order figures are "not recorded" for a year
 * in which the retention job erased the records of a removal order that could have held a row of it, and the authority's
 * accesses for a year whose audit rows name a production that is gone. A message at the contact point is deleted 30 days
 * after it was handled, so the referrals are counted from the audit rows `contact_closed`, which keep the disposition.
 *
 * This file has no entry point of its own, so both bundles can include it (build.mjs says why that matters).
 */
import { sql } from "drizzle-orm";
import { ANNEX3_GROUNDS, ORDER_GROUNDS, type Annex3Ground, type OrderGround } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { Refusal, refuse, rows, type OrderDone } from "./orders";

/** The counting commands, each with its first lines of STAFF_USAGE. */
export const COUNT_COMMANDS = ["tco-counts"] as const;
export type CountCommandName = (typeof COUNT_COMMANDS)[number];

export const COUNT_USAGE = [
  `${"  tco-counts <year>".padEnd(41)}print the figures of TCO Art. 7(3) and 21(1) for that calendar year in UTC, from rows,`,
  `${"".padEnd(41)}and "not recorded" for a figure the rows cannot give; read-only; run it in the migrate service`,
];

export type CountCommand = { command: "tco-counts"; year: number };

/** A calendar year as the operator types it: four digits, never with a leading zero. */
const YEAR = /^[1-9][0-9]{3}$/;

/** Reads a counting command's words. */
export function parseCountArgs(command: CountCommandName, rest: readonly string[]): CountCommand {
  if (rest.length !== 1 || !YEAR.test(rest[0]!)) throw new Error(`${command}: takes one calendar year of four digits, as 2026`);
  return { command, year: Number(rest[0]) };
}

/** The figures of one year; null is a figure the rows can no longer give. */
export interface TcoCounts {
  year: number;
  /** Removal orders received, by issuing state in code order, and how many came from another Member State. */
  received: { total: number; byState: [string, number][]; crossBorder: number } | null;
  /** The items of removal orders disabled in the year. */
  itemsDisabled: number | null;
  /**
   * For each removal order of the year whose every item is disabled or closed and of which at least one was disabled: the
   * minutes from its clock's start to the disabling of its last item, in ascending order, null for an order whose receipt
   * nobody recorded (after the numbers); how many of them were outside the hour (an effect given while the clock was
   * stopped counts as inside, as legal_order_clock judges it); how many of them that judgement cannot be made for; and how
   * many of the year's orders still have an item open.
   */
  minutes: { list: (number | null)[]; outside: number; withoutReceipt: number; open: number } | null;
  /** Annex III sent, by ground. */
  annex3: Record<Annex3Ground, number> | null;
  /** Scrutiny asked for, and its outcomes. */
  scrutiny: { requested: number; annulled: number; upheld: number } | null;
  /** Items reinstated, by ground. */
  reinstated: Record<OrderGround, number> | null;
  /** Accesses to preserved content by an authority: productions of the instrument preserved_access for an authority. */
  authorityAccess: number | null;
  /** Final decisions of korbat's own that restricted something as terrorist content, without an order. */
  terroristWithoutOrder: number;
  /** Messages at the contact point closed as a referral. */
  referralsClosed: number;
}

/** Reads the figures of a calendar year in UTC, on the caller's transaction, which reads as the migrator. */
export async function tcoCounts(tx: DbTx, year: number): Promise<TcoCounts> {
  const from = sql`make_timestamptz(${year}::int, 1, 1, 0, 0, 0, 'UTC')`;
  const to = sql`make_timestamptz(${year + 1}::int, 1, 1, 0, 0, 0, 'UTC')`;

  // Whether the retention job erased the records of a removal order that could have held a row of this year: the order
  // was received (or opened) before the year ended, and its last row was at most record_keep_years before its erasure.
  // The audit log keeps both rows that say so, the opening with the order's kind and receipt and the erasure's step.
  const [ordersErased] = await rows<{ erased: boolean }>(
    tx,
    sql`select exists (
          select 1 from public.audit_log r
            join public.audit_log o on o.action = 'order_opened' and o.target_id = r.metadata->>'orderId'
           cross join public.order_rules() k
           where r.action = 'moderation_retention' and r.metadata->>'step' = 'order_records'
             and o.metadata->>'kind' = 'tco_removal'
             and coalesce((o.metadata->>'receivedAt')::timestamptz, o.created_at) < ${to}
             and r.created_at - make_interval(years => k.record_keep_years) >= ${from}) as erased`,
  );

  const orders = await rows<{ member_state: string; cross_border: boolean; items_open: number; finished: boolean; within_hour: boolean | null; minutes: number | null }>(
    tx,
    sql`select o.member_state, o.cross_border, c.items_open,
               (c.items_open = 0 and c.last_effect_at is not null) as finished, c.within_hour,
               floor(extract(epoch from (c.last_effect_at - c.clock_start)) / 60)::int as minutes
          from public.legal_orders o
          join public.legal_order_clock c on c.order_id = o.id
         where o.kind = 'tco_removal' and coalesce(o.received_at, o.opened_at) >= ${from} and coalesce(o.received_at, o.opened_at) < ${to}`,
  );
  const [disabled] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from public.legal_order_items t join public.legal_orders o on o.id = t.order_id
         where o.kind = 'tco_removal' and t.disabled_at >= ${from} and t.disabled_at < ${to}`,
  );
  const events = await rows<{ kind: string; ground: string | null; n: number }>(
    tx,
    sql`select e.kind, e.ground, count(*)::int as n from public.legal_order_events e join public.legal_orders o on o.id = e.order_id
         where o.kind = 'tco_removal' and e.kind in ('annex3_sent', 'scrutiny_requested', 'scrutiny_decided', 'reinstated')
           and coalesce(e.effective_at, e.at) >= ${from} and coalesce(e.effective_at, e.at) < ${to}
         group by e.kind, e.ground`,
  );

  // An authority's access is recorded twice: as its production, which the retention job erases with the order's records,
  // and in the audit row preserved_accessed, which names the production and stays.
  const [access] = await rows<{ n: number; erased: boolean }>(
    tx,
    sql`select (select count(*)::int from public.productions p
                 where p.instrument = 'preserved_access' and p.purpose = 'authority' and p.opened_at >= ${from} and p.opened_at < ${to}) as n,
               exists (select 1 from public.audit_log a
                        where a.action = 'preserved_accessed' and a.metadata->>'purpose' = 'authority' and a.created_at >= ${from} and a.created_at < ${to}
                          and not exists (select 1 from public.productions p where p.id::text = a.metadata->>'productionId')) as erased`,
  );
  // korbat's own final decisions on terrorist content, which the ledger keeps for good; an order's decision is of the kind order.
  const [terrorist] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from public.decisions d
         where d.kind::text = 'final' and d.outcome::text = 'restricted' and d.category_keyword = 'KEYWORD_TERRORIST_CONTENT'
           and d.decided_at >= ${from} and d.decided_at < ${to}`,
  );
  const [referrals] = await rows<{ n: number }>(
    tx,
    sql`select count(*)::int as n from public.audit_log a
         where a.action = 'contact_closed' and a.metadata->>'disposition' = 'referral' and a.created_at >= ${from} and a.created_at < ${to}`,
  );

  const eventCount = (kind: string, ground: string | null = null) =>
    events.filter((row) => row.kind === kind && (ground === null || row.ground === ground)).reduce((sum, row) => sum + row.n, 0);
  const byState = new Map<string, number>();
  for (const order of orders) byState.set(order.member_state, (byState.get(order.member_state) ?? 0) + 1);
  const finished = orders.filter((order) => order.finished);
  const known = finished.filter((order) => order.minutes !== null).map((order) => order.minutes!).sort((a, b) => a - b);
  const erased = ordersErased!.erased;

  return {
    year,
    received: erased
      ? null
      : { total: orders.length, byState: [...byState.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), crossBorder: orders.filter((order) => order.cross_border).length },
    itemsDisabled: erased ? null : disabled!.n,
    minutes: erased
      ? null
      : {
          list: [...known, ...finished.filter((order) => order.minutes === null).map(() => null)],
          outside: finished.filter((order) => order.within_hour === false).length,
          withoutReceipt: finished.filter((order) => order.within_hour === null).length,
          open: orders.filter((order) => order.items_open > 0).length,
        },
    annex3: erased ? null : (Object.fromEntries(ANNEX3_GROUNDS.map((ground) => [ground, eventCount("annex3_sent", ground)])) as Record<Annex3Ground, number>),
    scrutiny: erased ? null : { requested: eventCount("scrutiny_requested"), annulled: eventCount("scrutiny_decided", "annulled"), upheld: eventCount("scrutiny_decided", "upheld") },
    reinstated: erased ? null : (Object.fromEntries(ORDER_GROUNDS.map((ground) => [ground, eventCount("reinstated", ground)])) as Record<OrderGround, number>),
    authorityAccess: access!.erased ? null : access!.n,
    terroristWithoutOrder: terrorist!.n,
    referralsClosed: referrals!.n,
  };
}

const NOT_RECORDED = "not recorded";

/** The figures as the command prints them: a line a figure, each starting with the command's name (8.11). */
export function describeTcoCounts(counts: TcoCounts): string[] {
  const line = (text: string) => `tco-counts: ${text}`;
  const { received, minutes } = counts;
  const states = received === null ? [] : received.byState.map(([state, n]) => `${state}: ${n}`);
  const receivedText = received === null ? NOT_RECORDED : `${received.total} (${states.length > 0 ? `${states.join(", ")}; ` : ""}from another Member State: ${received.crossBorder})`;
  const minutesText = (() => {
    if (minutes === null) return NOT_RECORDED;
    const list = minutes.list.length === 0 ? "none" : minutes.list.map((m) => (m === null ? NOT_RECORDED : String(m))).join(", ");
    const outside =
      minutes.withoutReceipt > 0 ? `${NOT_RECORDED} (${minutes.withoutReceipt} ${minutes.withoutReceipt === 1 ? "order" : "orders"} without a recorded receipt)` : String(minutes.outside);
    return `${list}; outside the hour: ${outside}; with an item still open: ${minutes.open}`;
  })();
  const byGround = <G extends string>(grounds: readonly G[], figures: Record<G, number> | null) =>
    figures === null ? NOT_RECORDED : grounds.map((ground) => `${ground} ${figures[ground]}`).join(", ");
  const figure = (n: number | null) => (n === null ? NOT_RECORDED : String(n));
  return [
    line(`removal orders received: ${receivedText}`),
    line(`items disabled following a removal order: ${figure(counts.itemsDisabled)}`),
    line(`minutes from the clock's start to the disabling of an order's last item: ${minutesText}`),
    line(`Annex III sent, by ground: ${byGround(ANNEX3_GROUNDS, counts.annex3)}`),
    line(`scrutiny: ${counts.scrutiny === null ? NOT_RECORDED : `requested ${counts.scrutiny.requested}; annulled ${counts.scrutiny.annulled}; upheld ${counts.scrutiny.upheld}`}`),
    line(`reinstated, by ground: ${byGround(ORDER_GROUNDS, counts.reinstated)}`),
    line(`access to preserved content by an authority: ${figure(counts.authorityAccess)}`),
    line(`restricted by korbat as terrorist content without an order: ${counts.terroristWithoutOrder}`),
    line(`referrals closed: ${counts.referralsClosed}`),
  ];
}

/**
 * tco-counts on the migrator's own connection: one transaction at one snapshot, read-only, with the command line's
 * 10-second lock timeout. A year that has not begun has nothing to count and is refused.
 */
export async function countCommand(migrateDb: Db, cmd: CountCommand, now: Date = new Date()): Promise<OrderDone> {
  try {
    if (cmd.year > now.getUTCFullYear()) refuse(cmd.command, `the year ${cmd.year} has not begun`);
    const counts = await migrateDb.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read, read only`);
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return tcoCounts(tx, cmd.year);
    });
    return { ok: true, lines: describeTcoCounts(counts) };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, problem: err.message };
    throw err;
  }
}
