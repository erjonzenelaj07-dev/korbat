import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ORDER_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { rowCounts } from "./moderation-fixtures";
import { ORDER_TABLES } from "./orders-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * The end of a non-disclosure period (3f design, section 2 rows 24 and 46, section 6.2; invariant 4, the function; LAB E
 * on the real code). order_hold_end: the calendar date of the instant in UTC+3, plus hold_days (and hold_extension_days
 * once extended), at 00:00 in UTC-1; never earlier, in any of the eight zones of the lab, than the end of the same weekday
 * six weeks later (Reg. 1182/71 Art. 3), and at most 28 hours later; the same value in any session time zone; an
 * extension adds exactly 42 days. order_hold_until: null without Section C; a removal order's computed end, from its time
 * stamp, else its receipt, else its opening, or the authority's end when earlier; a DSA order's recorded end of any
 * length, and 'infinity' while none is recorded; a hold's recorded end once ended. order_preserve_until: six calendar
 * months in UTC and a day. Every order here is the migrator's, in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: an order's hold and preservation, the functions alone", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    apiDb = createDb(process.env.DATABASE_URL_API!, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(apiDb, ORDER_TABLES);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
  });

  const ZONES = ["Atlantic/Azores", "Europe/Lisbon", "Europe/Dublin", "Europe/Berlin", "Europe/Paris", "Europe/Helsinki", "Europe/Athens", "Asia/Nicosia"];

  test("never early in eight zones of the EU's European territory, and at most 28 hours late: random instants of 2026 to 2030 and every minute around four clock changes and 43 days before them", async () => {
    const zones = sql.raw(`values ${ZONES.map((zone) => `('${zone}')`).join(", ")}`);
    const rows = await apiDb.execute<{ z: string; instants: number; early: number; least_late_h: number; most_late_h: number }>(sql`
      with zones(z) as (${zones}),
      t as (select timestamptz '2026-01-01 00:00+00' + random() * make_interval(days => 1826) as at from generate_series(1, 20000)
            union all select d + make_interval(mins => h) from unnest(array[timestamptz '2026-03-29 00:00+00', '2026-10-25 00:00+00', '2027-03-28 00:00+00', '2027-10-31 00:00+00']) d,
                      generate_series(-180, 1620, 1) h
            union all select (d - 43)::timestamp at time zone 'UTC' + make_interval(mins => h) from unnest(array[date '2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31']) d,
                      generate_series(-180, 1620, 1) h)
      select z, count(*)::int as instants,
             (count(*) filter (where public.order_hold_end(at, false) < (((at at time zone z)::date + 43)::timestamp at time zone z)))::int as early,
             min(extract(epoch from public.order_hold_end(at, false) - (((at at time zone z)::date + 43)::timestamp at time zone z)) / 3600)::float as least_late_h,
             max(extract(epoch from public.order_hold_end(at, false) - (((at at time zone z)::date + 43)::timestamp at time zone z)) / 3600)::float as most_late_h
        from t cross join zones group by z order by z`);
    expect(rows.map((row) => row.z).sort()).toEqual([...ZONES].sort());
    for (const row of rows) {
      expect(row.early, row.z).toBe(0);
      expect(row.least_late_h, row.z).toBeGreaterThanOrEqual(0);
      expect(row.most_late_h, row.z).toBeLessThanOrEqual(28);
    }
  });

  test("the same value in three session time zones, and an extension adds exactly hold_extension_days", async () => {
    const values: string[] = [];
    await rolledBack(apiDb, async (tx) => {
      for (const zone of ["UTC", "Europe/Berlin", "America/New_York"]) {
        await tx.execute(sql`select set_config('timezone', ${zone}, true)`);
        const [row] = await tx.execute<{ end: string }>(sql`select to_char(public.order_hold_end('2026-10-06 21:30+00', false) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as end`);
        values.push(row!.end);
      }
    });
    // The lab's worked instant: the date in UTC+3 is 7 October, plus 43 days is 19 November, at 00:00 in UTC-1.
    expect(values).toEqual(["2026-11-19 01:00", "2026-11-19 01:00", "2026-11-19 01:00"]);
    const [row] = await apiDb.execute<{ least: number; most: number }>(sql`
      select min(extract(epoch from public.order_hold_end(at, true) - public.order_hold_end(at, false)))::float as least,
             max(extract(epoch from public.order_hold_end(at, true) - public.order_hold_end(at, false)))::float as most
        from (select timestamptz '2026-01-01 00:00+00' + random() * make_interval(days => 1826) as at from generate_series(1, 2000)) t`);
    expect([row!.least, row!.most]).toEqual([ORDER_RULES.holdExtensionDays * 86_400, ORDER_RULES.holdExtensionDays * 86_400]);
  });

  /** An order of the migrator's, in the transaction: its kind, Section C and the times the test names. */
  async function order(tx: DbTx, kind: string, sectionC: boolean, times: Record<string, string | boolean | null> = {}): Promise<string> {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into public.legal_orders (id, kind, member_state, authority, reference, channel, section_c, emergency, cross_border, withhold_from_author,
                                       received_at, issued_at, authority_hold_until, hold_extended, hold_ended_at, hold_end_reason, opened_at, opened_via)
      values (gen_random_uuid(), ${kind}, 'DE', 'BKA', ${`H-${Math.random()}`}, 'portal', ${sectionC}::boolean, false, false, ${sectionC}::boolean,
              ${(times.received as string) ?? null}::timestamptz, ${(times.issued as string) ?? null}::timestamptz, ${(times.authority as string) ?? null}::timestamptz,
              ${(times.extended as boolean) ?? false}::boolean, ${(times.ended as string) ?? null}::timestamptz, ${times.ended ? "not_ordered" : null},
              ${(times.opened as string) ?? "2026-10-06T22:00:00Z"}::timestamptz, 'cli')
      returning id`);
    return row!.id;
  }
  const until = async (tx: DbTx, id: string) =>
    (await tx.execute<{ until: string | null }>(sql`select case when public.order_hold_until(${id}::uuid) = 'infinity' then 'infinity' else to_char(public.order_hold_until(${id}::uuid) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') end as until`))[0]!.until;

  test("order_hold_until: by the kind of order, from the time stamp, else the receipt, else the opening; the authority's end when earlier; a DSA order's end of any length or none; the recorded end once ended", async () => {
    await rolledBack(migrateDb, async (tx) => {
      // Without Section C nothing is held.
      expect(await until(tx, await order(tx, "tco_removal", false, { received: "2026-10-06T21:30:00Z" }))).toBeNull();
      // A removal order: from its receipt, never earlier; from its own time stamp once recorded; extended once.
      expect(await until(tx, await order(tx, "tco_removal", true, { received: "2026-10-06T21:30:00Z" }))).toBe("2026-11-19 01:00");
      expect(await until(tx, await order(tx, "tco_removal", true, { received: "2026-10-06T21:30:00Z", issued: "2026-10-05T10:00:00Z" }))).toBe("2026-11-17 01:00");
      expect(await until(tx, await order(tx, "tco_removal", true, { opened: "2026-10-06T22:00:00Z" }))).toBe("2026-11-19 01:00");
      expect(await until(tx, await order(tx, "tco_removal", true, { received: "2026-10-06T21:30:00Z", extended: true }))).toBe("2026-12-31 01:00");
      // The authority's written end counts when it is earlier, never when it is later: the Regulation's period caps it.
      expect(await until(tx, await order(tx, "tco_removal", true, { received: "2026-10-06T21:30:00Z", authority: "2026-10-20T00:00:00Z" }))).toBe("2026-10-20 00:00");
      expect(await until(tx, await order(tx, "tco_removal", true, { received: "2026-10-06T21:30:00Z", authority: "2027-03-01T00:00:00Z" }))).toBe("2026-11-19 01:00");
      // A DSA order: the authority's end, earlier or later than six weeks, and no end while none is recorded; the extension is not its.
      expect(await until(tx, await order(tx, "dsa_art9", true, { received: "2026-10-06T21:30:00Z" }))).toBe("infinity");
      expect(await until(tx, await order(tx, "dsa_art9", true, { received: "2026-10-06T21:30:00Z", authority: "2027-03-01T00:00:00Z" }))).toBe("2027-03-01 00:00");
      expect(await until(tx, await order(tx, "dsa_art10", true, { received: "2026-10-06T21:30:00Z", authority: "2026-10-10T00:00:00Z", extended: true }))).toBe("2026-10-10 00:00");
      // A hold ended from the command line ends at that time, whatever the kind.
      expect(await until(tx, await order(tx, "dsa_art9", true, { received: "2026-10-06T21:30:00Z", ended: "2026-10-08T12:00:00Z" }))).toBe("2026-10-08 12:00");
    });
  });

  test("order_preserve_until: six calendar months in UTC and a day, as appeal_deadline counts months", async () => {
    const rows = await apiDb.execute<{ a: string; b: string }>(sql`
      select to_char(public.order_preserve_until('2026-10-06T21:30:00Z') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as a,
             to_char(public.order_preserve_until('2026-08-31T10:00:00Z') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as b`);
    expect(rows[0]).toEqual({ a: "2027-04-07 21:30", b: "2027-03-01 10:00" });
  });

  test("the functions hold no number of order_rules() and no interval literal; the API role may call each", async () => {
    const functions = await apiDb.execute<{ name: string; definition: string; api: boolean }>(sql`
      select p.proname::text as name, pg_get_functiondef(p.oid) as definition, has_function_privilege('korbat_api', p.oid, 'EXECUTE') as api
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('order_hold_end', 'order_hold_until', 'order_preserve_until') order by 1`);
    expect(functions.map((f) => [f.name, f.api])).toEqual([
      ["order_hold_end", true],
      ["order_hold_until", true],
      ["order_preserve_until", true],
    ]);
    for (const f of functions) {
      expect(f.definition, f.name).not.toMatch(/interval '/i);
      expect(f.definition, f.name).not.toMatch(/[^0-9_a-z](42|43|6) /);
    }
  });

  test("leaves no row behind", async () => {
    expect(await rowCounts(apiDb, ORDER_TABLES)).toEqual(before);
  });
});
