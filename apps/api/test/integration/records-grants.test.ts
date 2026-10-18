import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  NOTIFICATION_ANSWERS,
  NOTIFICATION_DUTIES,
  NOTIFICATION_EVENT_KINDS,
  NOTIFICATION_OPENED_VIA,
  NOTIFICATION_SENT_KINDS,
  NOTIFICATION_STATES,
  NOT_HELD_KINDS,
  ACCESS_PURPOSES,
  PRODUCED_KINDS,
  PRODUCTION_INSTRUMENTS,
  REPORT_HOLD_RELEASES,
} from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { pgError, rolledBack } from "./staff-fixtures";
import { recordCounts } from "./records-fixtures";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The grants of the records to authorities (3f design, sections 6.5 and 6.7; invariant 12, the records). As korbat_api:
 * no privilege at all on authority_notifications, its events and productions, EXECUTE on seal_report and
 * report_close_unsealed refused, and only reports_owed() and erase_authority_records() callable. As korbat_auth: no
 * privilege on auth.report_holds, and EXECUTE on auth.address_held, auth.address_held_until and auth.address_hold_final
 * alone of 0030's functions, and on auth.address_hold_told of 3f's review (0032). Each closed list's CHECK is its contracts' constant, and the times are forced.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the grants of the records to authorities", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await recordCounts(migrateDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const privileges = async (role: string, table: string) =>
    (await migrateDb.execute<{ p: string }>(sql`
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
       where has_table_privilege(${role}, ${table}, p) order by p`)).map((r) => r.p);
  const columnPrivileges = async (role: string, schema: string, table: string) =>
    (await migrateDb.execute<{ n: number }>(sql`
      select count(*)::int as n from information_schema.columns c, unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
       where c.table_schema = ${schema} and c.table_name = ${table} and has_column_privilege(${role}, ${`${schema}.${table}`}, c.column_name, p)`))[0]!.n;
  const mayExecute = async (role: string, fn: string) =>
    (await migrateDb.execute<{ ok: boolean }>(sql`select has_function_privilege(${role}, ${fn}, 'EXECUTE') as ok`))[0]!.ok;
  const checkValues = async (table: string, name: string) =>
    [...((await migrateDb.execute<{ d: string }>(sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = ${name} and conrelid = ${table}::regclass`))[0]!.d.matchAll(/'([a-z_0-9]+)'/g))].map((m) => m[1]!);

  const FUNCTIONS = [
    "public.report_open()",
    "public.report_close_unsealed(uuid)",
    "public.reports_owed()",
    "public.seal_report(uuid)",
    "public.erase_authority_records()",
    "public.authority_records_times()",
    "auth.address_held_until(uuid)",
    "auth.address_held(uuid)",
    "auth.address_hold_final(uuid)",
    // 3f's review (0032_orders_review): whether the person was told of every seal behind a held address.
    "auth.address_hold_told(uuid)",
  ];

  test("korbat_api holds nothing on the three record tables, column by column too, and reads no row of them", async () => {
    for (const table of ["public.authority_notifications", "public.authority_notification_events", "public.productions"]) {
      expect(await privileges("korbat_api", table)).toEqual([]);
      expect(await columnPrivileges("korbat_api", "public", table.slice("public.".length))).toBe(0);
    }
    expect((await pgError(apiDb.execute(sql`select count(*) from public.authority_notifications`)))?.code).toBe("42501");
    expect((await pgError(apiDb.execute(sql`select count(*) from public.productions`)))?.code).toBe("42501");
    expect((await pgError(apiDb.execute(sql`insert into public.authority_notification_events (notification_id, kind, at, how, not_to_person) values (gen_random_uuid(), 'note', now(), 'x', false)`)))?.code).toBe("42501");
  });

  test("korbat_api may call reports_owed() and erase_authority_records() alone of 0030's functions; seal_report and report_close_unsealed are refused", async () => {
    const callable = [];
    for (const fn of FUNCTIONS) if (await mayExecute("korbat_api", fn)) callable.push(fn);
    expect(callable).toEqual(["public.reports_owed()", "public.erase_authority_records()"]);
    expect((await pgError(apiDb.execute(sql`select * from public.seal_report(gen_random_uuid())`)))?.code).toBe("42501");
    expect((await pgError(apiDb.execute(sql`select public.report_close_unsealed(gen_random_uuid())`)))?.code).toBe("42501");
    // What it may call answers a case, a kind and a time, or a count, and nothing more.
    const owed = await apiDb.execute<Record<string, unknown>>(sql`select * from public.reports_owed() limit 1`);
    for (const row of owed) expect(Object.keys(row).sort()).toEqual(["case_id", "kind", "since"]);
  });

  test("korbat_auth holds nothing on auth.report_holds and may call the auth.address_* reads alone of 0030's functions, and 0032's fourth", async () => {
    expect(await privileges("korbat_auth", "auth.report_holds")).toEqual([]);
    expect(await columnPrivileges("korbat_auth", "auth", "report_holds")).toBe(0);
    expect((await pgError(authDb.execute(sql`select count(*) from auth.report_holds`)))?.code).toBe("42501");
    const callable = [];
    for (const fn of FUNCTIONS) if (await mayExecute("korbat_auth", fn)) callable.push(fn);
    expect(callable).toEqual(["auth.address_held_until(uuid)", "auth.address_held(uuid)", "auth.address_hold_final(uuid)", "auth.address_hold_told(uuid)"]);
    const [row] = await authDb.execute<{ until: string | null; held: boolean; final: boolean; told: boolean }>(
      sql`select auth.address_held_until(gen_random_uuid()) as until, auth.address_held(gen_random_uuid()) as held, auth.address_hold_final(gen_random_uuid()) as final,
                 auth.address_hold_told(gen_random_uuid()) as told`,
    );
    // An account with no seal behind it reads as told: the mail may say what it holds.
    expect({ ...row }).toEqual({ until: null, held: false, final: false, told: true });
    // And nothing of the public record tables.
    expect(await privileges("korbat_auth", "public.authority_notifications")).toEqual([]);
  });

  test("every closed list's CHECK is its contracts' constant", async () => {
    expect(await checkValues("public.authority_notifications", "authority_notifications_state")).toEqual([...NOTIFICATION_STATES]);
    expect(await checkValues("public.authority_notifications", "authority_notifications_duties")).toEqual([...NOTIFICATION_DUTIES]);
    expect(await checkValues("public.authority_notifications", "authority_notifications_sent_kinds")).toEqual([...NOTIFICATION_SENT_KINDS]);
    expect(await checkValues("public.authority_notifications", "authority_notifications_answer")).toEqual([...NOTIFICATION_ANSWERS]);
    expect(await checkValues("public.authority_notifications", "authority_notifications_opened_via")).toEqual([...NOTIFICATION_OPENED_VIA]);
    expect(await checkValues("public.authority_notification_events", "authority_notification_events_kind")).toEqual([...NOTIFICATION_EVENT_KINDS]);
    expect(await checkValues("public.productions", "productions_instrument")).toEqual([...PRODUCTION_INSTRUMENTS]);
    expect(await checkValues("public.productions", "productions_purposes")).toEqual([...ACCESS_PURPOSES]);
    expect(await checkValues("public.productions", "productions_asked")).toEqual([...NOTIFICATION_SENT_KINDS]);
    expect(await checkValues("public.productions", "productions_produced")).toEqual([...PRODUCED_KINDS]);
    expect(await checkValues("public.productions", "productions_not_held")).toEqual([...NOT_HELD_KINDS]);
    expect(await checkValues("auth.report_holds", "report_holds_release_reason")).toEqual([...REPORT_HOLD_RELEASES]);
  });

  test("the times are forced: opened_at and an event's at are the transaction's, unless an imported row supplies one that is not after the clock", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const past = "2024-01-02 03:04:05+00";
      const [plain] = await tx.execute<{ id: string; forced: boolean }>(
        sql`insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via) values ('owed', '{voluntary}', gen_random_uuid(), gen_random_uuid(), ${past}::timestamptz, 'cli')
            returning id, opened_at = now() as forced`,
      );
      expect(plain!.forced).toBe(true);
      const [imported] = await tx.execute<{ id: string; kept: boolean; stamped: boolean }>(
        sql`insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via, imported_at) values ('owed', '{voluntary}', gen_random_uuid(), gen_random_uuid(), ${past}::timestamptz, 'cli', ${past}::timestamptz)
            returning id, opened_at = ${past}::timestamptz as kept, imported_at = now() as stamped`,
      );
      expect({ kept: imported!.kept, stamped: imported!.stamped }).toEqual({ kept: true, stamped: true });
      const [future] = await tx.execute<{ forced: boolean }>(
        sql`insert into public.authority_notifications (state, duties, case_id, account_id, opened_at, opened_via, imported_at) values ('owed', '{voluntary}', gen_random_uuid(), gen_random_uuid(), now() + interval '1 day', 'cli', now())
            returning opened_at = now() as forced`,
      );
      expect(future!.forced).toBe(true);
      // An update keeps the forced time.
      const [moved] = await tx.execute<{ kept: boolean }>(sql`update public.authority_notifications set opened_at = now() where id = ${imported!.id}::uuid returning opened_at = ${past}::timestamptz as kept`);
      expect(moved!.kept).toBe(true);
      // An event's time: the record's import decides.
      const [ev] = await tx.execute<{ forced: boolean }>(
        sql`insert into public.authority_notification_events (notification_id, kind, at, how, not_to_person) values (${plain!.id}::uuid, 'request', ${past}::timestamptz, 'by letter', false) returning at = now() as forced`,
      );
      expect(ev!.forced).toBe(true);
      const [kept] = await tx.execute<{ kept: boolean }>(
        sql`insert into public.authority_notification_events (notification_id, kind, at, how, not_to_person) values (${imported!.id}::uuid, 'request', ${past}::timestamptz, 'by letter', false) returning at = ${past}::timestamptz as kept`,
      );
      expect(kept!.kept).toBe(true);
      const [production] = await tx.execute<{ forced: boolean }>(
        sql`insert into public.productions (instrument, produced, opened_at) values ('demand', '{handle}', ${past}::timestamptz) returning opened_at = now() as forced`,
      );
      expect(production!.forced).toBe(true);
    });
  });

  test("the CHECKs refuse a seal's record without its seal, a sent record without what it sent, a time limit's mark without its mark, and a free value in a list", async () => {
    const refused = async (statement: ReturnType<typeof sql>) => {
      let code: string | undefined;
      await rolledBack(migrateDb, async (tx) => {
        code = (await pgError(tx.execute(statement)))?.code;
      });
      return code;
    };
    expect(await refused(sql`insert into public.authority_notifications (state, opened_at, opened_via) values ('owed', now(), 'system')`)).toBe("23514");
    expect(await refused(sql`insert into public.authority_notifications (state, opened_at, opened_via, duties, closed_at) values ('sent', now(), 'cli', '{voluntary}', now())`)).toBe("23514");
    expect(await refused(sql`insert into public.authority_notifications (state, opened_at, opened_via, duties) values ('owed', now(), 'cli', '{dsa18_3}')`)).toBe("23514");
    expect(await refused(sql`insert into public.authority_notifications (state, opened_at, opened_via, duties, closed_at) values ('declined', now(), 'cli', '{voluntary}', now())`)).toBe("23514");
    expect(await refused(sql`insert into public.productions (instrument, produced, opened_at, asked) values ('demand', '{handle}', now(), '{name}')`)).toBe("23514");
    expect(await refused(sql`insert into public.productions (instrument, produced, opened_at) values ('preserved_access', '{content}', now())`)).toBe("23514");
    expect(await refused(sql`insert into auth.report_holds (user_id, set_at, seal_final, release_reason) values (gen_random_uuid(), now(), false, 'sent')`)).toBe("23514");
  });

  test("leaves no row behind", async () => {
    expect(await recordCounts(migrateDb)).toEqual(before);
  });
});
