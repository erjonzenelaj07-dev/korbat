import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ALERT_KIND_LIST, CONTACT_DISPOSITIONS, CONTACT_FOLDERS, NOTIFY_ERRORS, ORDER_RULES } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { CHANNEL_TABLES, removeFixtures, rowCounts } from "./moderation-fixtures";
import { closeNotifyFixtures, contactMessageForTest, notifyDb, removeMessages } from "./notify-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The roles hold what section 6.1 grants (3f design, sections 6.1 and 6.7; invariant 12): korbat_notify has USAGE on the
 * schema public, which only the superuser can give and the first migration checks, the grants of its four tables and
 * EXECUTE on order_rules(), and nothing else anywhere; the API role holds exactly its columns; each closed list's CHECK is
 * the contracts' constant; order_rules() is ORDER_RULES, name by name; and the migration's first statement stops a run
 * without the role or without the schema's privilege.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the grants of the contact point and the alert channel", () => {
  let migrateDb: Db;
  let apiDb: Db;
  let before: Record<string, number>;
  const made: string[] = [];
  const profileIds: string[] = [];

  beforeAll(async () => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    apiDb = createDb(process.env.DATABASE_URL_API!, { max: 2 });
    before = await rowCounts(apiDb, CHANNEL_TABLES);
  });
  afterAll(async () => {
    await removeMessages(migrateDb, made);
    await removeFixtures(migrateDb, profileIds);
    await closeNotifyFixtures();
    await Promise.all([closeDb(migrateDb), closeDb(apiDb)]);
  });

  const privileges = async (role: string, table: string) =>
    (await migrateDb.execute<{ p: string }>(sql`
      select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
       where has_table_privilege(${role}, ${`public.${table}`}, p) order by p`)).map((r) => r.p);
  const columnPrivileges = async (role: string, table: string, privilege: string) =>
    (await migrateDb.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = ${table} and has_column_privilege(${role}, ${`public.${table}`}, column_name, ${privilege})
       order by ordinal_position`)).map((r) => r.column_name);

  test("korbat_notify holds USAGE on the schema public, the superuser's grant that the migration checks and cannot make", async () => {
    const [row] = await migrateDb.execute<{ usage: boolean; auth: boolean; create: boolean }>(
      sql`select has_schema_privilege('korbat_notify', 'public', 'USAGE') as usage, has_schema_privilege('korbat_notify', 'auth', 'USAGE') as auth, has_schema_privilege('korbat_notify', 'public', 'CREATE') as create`,
    );
    expect(row).toEqual({ usage: true, auth: false, create: false });
  });

  test("korbat_notify: exactly the table grants of section 6.1", async () => {
    expect(await privileges("korbat_notify", "contact_messages")).toEqual(["SELECT"]);
    expect(await columnPrivileges("korbat_notify", "contact_messages", "INSERT")).toEqual(["folder", "uidvalidity", "uid", "received_at"]);
    expect(await columnPrivileges("korbat_notify", "contact_messages", "UPDATE")).toEqual([]);
    expect(await privileges("korbat_notify", "alert_outbox")).toEqual(["SELECT"]);
    expect(await columnPrivileges("korbat_notify", "alert_outbox", "UPDATE")).toEqual(["pushed_at", "push_attempts"]);
    expect(await columnPrivileges("korbat_notify", "alert_outbox", "INSERT")).toEqual([]);
    for (const table of ["notify_state", "notify_folders"]) expect(await privileges("korbat_notify", table), table).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  test("korbat_notify: nothing on any other table, view, sequence or function, but EXECUTE on order_rules()", async () => {
    const tables = await migrateDb.execute<{ name: string }>(sql`
      select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'auth') and c.relkind in ('r', 'v', 'm', 'p', 'S')
         and c.relname not in ('contact_messages', 'alert_outbox', 'notify_state', 'notify_folders')
         and (has_table_privilege('korbat_notify', c.oid, 'SELECT') or has_table_privilege('korbat_notify', c.oid, 'INSERT') or has_table_privilege('korbat_notify', c.oid, 'UPDATE') or has_table_privilege('korbat_notify', c.oid, 'DELETE')
              or (c.relkind = 'S' and has_sequence_privilege('korbat_notify', c.oid, 'USAGE')))`);
    expect(tables.map((r) => r.name)).toEqual([]);
    const functions = await migrateDb.execute<{ name: string }>(sql`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'auth') and pg_get_userbyid(p.proowner) = 'korbat_migrate' and has_function_privilege('korbat_notify', p.oid, 'EXECUTE')
       order by 1`);
    expect(functions.map((r) => r.name)).toEqual(["order_rules"]);
  });

  test("as korbat_notify, every statement outside its grants is refused", async () => {
    const db = notifyDb();
    for (const statement of [
      sql`select 1 from public.decisions limit 1`,
      sql`select public.alert_steps()`,
      sql`select public.alert_time(now())`,
      sql`update public.alert_outbox set mailed_at = now() where false`,
      sql`update public.contact_messages set disposition = 'referral' where false`,
      sql`delete from public.notify_state where false`,
    ]) {
      expect((await pgError(db.execute(statement)))?.code).toBe("42501");
    }
  });

  test("the API role: reads every table, updates a message's disposition and who set it, writes an alert and its mail's mark, and nothing else", async () => {
    expect(await privileges("korbat_api", "contact_messages")).toEqual(["SELECT"]);
    expect(await columnPrivileges("korbat_api", "contact_messages", "UPDATE")).toEqual(["disposition", "handled_by"]);
    expect(await columnPrivileges("korbat_api", "contact_messages", "INSERT")).toEqual([]);
    expect(await privileges("korbat_api", "alert_outbox")).toEqual(["INSERT", "SELECT"]);
    expect(await columnPrivileges("korbat_api", "alert_outbox", "UPDATE")).toEqual(["mailed_at"]);
    for (const table of ["notify_state", "notify_folders"]) expect(await privileges("korbat_api", table), table).toEqual(["SELECT"]);
    const [execute] = await migrateDb.execute<{ steps: boolean; rules: boolean; time: boolean; alert: boolean }>(sql`
      select has_function_privilege('korbat_api', 'public.alert_steps()', 'EXECUTE') as steps, has_function_privilege('korbat_api', 'public.order_rules()', 'EXECUTE') as rules,
             has_function_privilege('korbat_api', 'public.alert_time(timestamptz)', 'EXECUTE') as time, has_function_privilege('korbat_api', 'public.contact_messages_alert()', 'EXECUTE') as alert`);
    expect(execute).toEqual({ steps: true, rules: true, time: false, alert: false });
    expect((await pgError(apiDb.execute(sql`insert into public.contact_messages (folder, uidvalidity, uid, received_at) values ('inbox', 1, 1, now())`)))?.code).toBe("42501");
    expect((await pgError(apiDb.execute(sql`update public.alert_outbox set pushed_at = now() where false`)))?.code).toBe("42501");
    expect((await pgError(apiDb.execute(sql`update public.notify_state set beat_at = now() where false`)))?.code).toBe("42501");
  });

  test("a disposition is set once, with who set it, and stamped by the database; it never changes (message_handled)", async () => {
    const id = await contactMessageForTest(new Date());
    made.push(id);
    const staff = await newProfile(apiDb);
    profileIds.push(staff.id);
    // Without who set it, a disposition is refused.
    expect((await pgError(apiDb.execute(sql`update public.contact_messages set disposition = 'referral' where id = ${id}::uuid`)))?.message).toBe("invalid_request");
    await apiDb.execute(sql`update public.contact_messages set disposition = 'referral', handled_by = ${staff.id}::uuid where id = ${id}::uuid`);
    const [handled] = await migrateDb.execute<{ disposition: string; handled_at: string | null }>(sql`select disposition, handled_at from public.contact_messages where id = ${id}::uuid`);
    expect(handled!.disposition).toBe("referral");
    expect(handled!.handled_at).not.toBeNull();
    expect((await pgError(apiDb.execute(sql`update public.contact_messages set disposition = 'not_an_order' where id = ${id}::uuid`)))?.message).toBe("message_handled");
    expect((await pgError(apiDb.execute(sql`update public.contact_messages set handled_by = null where id = ${id}::uuid`)))?.message).toBe("message_handled");
  });

  test("an alert's facts are counts and times only: the CHECK refuses a string that is no time, a list, an object, and more than six members", async () => {
    const tryFacts = async (facts: unknown) =>
      (await pgError(rolledBack(migrateDb, async (tx) => {
        await tx.execute(sql`insert into public.alert_outbox (kind, priority, scope, facts) values ('alert_test', 3, 'all', ${JSON.stringify(facts)}::jsonb)`);
      })))?.code ?? null;
    expect(await tryFacts({ at: "2026-10-16T08:00:00.000Z", count: 3 })).toBeNull();
    expect(await tryFacts({ at: "2026-10-16T08:00:00.123456Z" })).toBeNull();
    expect(await tryFacts({ handle: "mod_anna" })).toBe("23514");
    expect(await tryFacts({ at: "2026-10-16 08:00" })).toBe("23514");
    expect(await tryFacts({ list: [1, 2] })).toBe("23514");
    expect(await tryFacts({ nested: { count: 1 } })).toBe("23514");
    expect(await tryFacts({ flag: true })).toBe("23514");
    expect(await tryFacts({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 })).toBe("23514");
    expect(await tryFacts([1])).toBe("23514");
  });

  test("each closed list's CHECK is the contracts' constant, in one spelling", async () => {
    const definition = async (table: string, name: string) =>
      (await migrateDb.execute<{ def: string }>(sql`select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = ${`public.${table}`}::regclass and c.conname = ${name}`))[0]!.def;
    const listed = (def: string) => [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed(await definition("contact_messages", "contact_messages_disposition"))).toEqual([...CONTACT_DISPOSITIONS]);
    expect(listed(await definition("contact_messages", "contact_messages_folder"))).toEqual([...CONTACT_FOLDERS]);
    expect(listed(await definition("notify_folders", "notify_folders_folder"))).toEqual([...CONTACT_FOLDERS]);
    expect(listed(await definition("alert_outbox", "alert_outbox_kind"))).toEqual([...ALERT_KIND_LIST]);
    expect(listed(await definition("notify_state", "notify_state_error"))).toEqual([...NOTIFY_ERRORS]);
  });

  test("order_rules() holds the contracts' ORDER_RULES, name by name", async () => {
    const [row] = await apiDb.execute<Record<string, unknown>>(sql`select * from public.order_rules()`);
    const camel = (name: string) => name.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
    expect(Object.fromEntries(Object.entries(row!).map(([name, value]) => [camel(name), value === null ? null : Number(value)]))).toEqual({ ...ORDER_RULES });
  });

  test("row level security is on for the four tables, with an allow-all policy for each role granted anything", async () => {
    const rows = await migrateDb.execute<{ table: string; rls: boolean; policies: string[] }>(sql`
      select c.relname as table, c.relrowsecurity as rls, array(select p.policyname || ':' || array_to_string(p.roles, ',') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname order by 1) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('contact_messages', 'alert_outbox', 'notify_state', 'notify_folders') order by 1`);
    expect(rows.map((r) => ({ ...r }))).toEqual(
      ["alert_outbox", "contact_messages", "notify_folders", "notify_state"].map((table) => ({ table, rls: true, policies: [`${table}_api_all:korbat_api`, `${table}_notify_all:korbat_notify`] })),
    );
  });

  test("the migration's first statement stops a run without the role or without the schema's USAGE, with one sentence", async () => {
    const file = fileURLToPath(new URL("../../../../packages/db/migrations/0026_messages_alerts.sql", import.meta.url));
    const first = readFileSync(file, "utf8").split("--> statement-breakpoint")[0]!;
    expect(first).toContain("create the role korbat_notify first");
    const run = async (role: string) => (await pgError(rolledBack(migrateDb, async (tx) => void (await tx.execute(sql.raw(first.replaceAll("'korbat_notify'", `'${role}'`)))))))?.message ?? null;
    // The role as it stands: nothing is refused.
    expect(await run("korbat_notify")).toBeNull();
    // A role that does not exist, and one that exists without USAGE on public (the auth role holds none there).
    expect(await run("korbat_notify_missing")).toBe("create the role korbat_notify first");
    expect(await run("korbat_auth")).toBe("create the role korbat_notify first");
  });

  test("leaves no row behind", async () => {
    await removeMessages(migrateDb, made.splice(0));
    await removeFixtures(migrateDb, profileIds.splice(0));
    expect(await rowCounts(apiDb, CHANNEL_TABLES)).toEqual(before);
  });
});
