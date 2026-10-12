import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { rowCounts } from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

/**
 * The grants and the one writers of account sanctions (3e design, sections 6.1 and 6.6; invariant 2). Each test reads the
 * catalogue, or runs a write as the API role inside a transaction that is rolled back, so nothing it does is kept.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the grants and the one writers of the standing ledger", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    before = await rowCounts(apiDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** The table privileges a role holds on a table, sorted. */
  const tablePrivileges = async (role: string, table: string) =>
    (
      await apiDb.execute<{ privilege: string }>(sql`
        select p.privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
         where has_table_privilege(${role}, ${table}, p.privilege) order by 1`)
    ).map((row) => row.privilege);
  /** The columns of a table a role may update, sorted. */
  const updatableColumns = async (role: string, table: string) =>
    (
      await apiDb.execute<{ name: string }>(sql`
        select a.attname::text as name from pg_attribute a
         where a.attrelid = ${table}::regclass and a.attnum > 0 and not a.attisdropped and has_column_privilege(${role}, a.attrelid, a.attnum, 'UPDATE') order by 1`)
    ).map((row) => row.name);
  /** What the API role is refused when it runs this statement, in a transaction that is rolled back. */
  async function asApi(statement: (tx: DbTx, profileId: string) => Promise<unknown>): Promise<{ message: string; code: string } | null> {
    let refused: { message: string; code: string } | null = null;
    await rolledBack(apiDb, async (tx) => {
      const profile = await newProfile(tx as unknown as Db);
      refused = await pgError(tx.transaction((sp) => statement(sp, profile.id)));
    });
    return refused;
  }

  describe("profiles: the API writes every column it writes today, and never the three standing_apply derives", () => {
    test("exactly the eleven columns of 6.1 are updatable by the API role", async () => {
      expect(await updatableColumns("korbat_api", "public.profiles")).toEqual(
        ["avatar_path", "bio", "deleted_at", "display_name", "follower_count", "following_count", "handle", "handle_changed_at", "post_count", "show_in_explore", "verified_at"].sort(),
      );
      expect(await tablePrivileges("korbat_api", "public.profiles")).toEqual(["INSERT", "SELECT"]);
    });

    test("an update of each derived column is refused (42501), and an insert's values are forced null", async () => {
      for (const column of ["suspended_from", "suspended_until", "reports_restricted_until"]) {
        const refused = await asApi((tx, id) => tx.execute(sql`update profiles set ${sql.raw(column)} = now() where id = ${id}::uuid`));
        expect(refused?.code, column).toBe("42501");
      }
      // An update of a column the API does write still works beside them.
      expect(await asApi((tx, id) => tx.execute(sql`update profiles set bio = 'a bio' where id = ${id}::uuid`))).toBeNull();
      await rolledBack(apiDb, async (tx) => {
        await tx.execute(
          sql`insert into profiles (id, handle, display_name, suspended_from, suspended_until, reports_restricted_until)
              values (gen_random_uuid(), ${`gr_${Date.now().toString(36)}`}, 'Forced', now(), now() + interval '1 day', now() + interval '1 day')`,
        );
        const [row] = await tx.execute<{ from: string | null; until: string | null; restricted: string | null }>(
          sql`select suspended_from as from, suspended_until as until, reports_restricted_until as restricted from profiles where display_name = 'Forced'`,
        );
        expect(row).toEqual({ from: null, until: null, restricted: null });
      });
    });

    test("the CHECK profiles_suspended holds both ends or neither, the start first, as the migrator too", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const profile = await newProfile(tx as unknown as Db);
        const set = (from: string, until: string) => pgError(tx.transaction((sp) => sp.execute(sql`update profiles set suspended_from = ${sql.raw(from)}, suspended_until = ${sql.raw(until)} where id = ${profile.id}::uuid`)));
        expect((await set("now()", "null"))?.code).toBe("23514");
        expect((await set("now()", "now() - interval '1 day'"))?.code).toBe("23514");
        expect(await set("now()", "'infinity'")).toBeNull();
        expect(await set("null", "null")).toBeNull();
      });
    });
  });

  test("posts: hidden_at, restored_at and explore_from lie outside the API's column grants", async () => {
    const updatable = await updatableColumns("korbat_api", "public.posts");
    for (const column of ["hidden_at", "restored_at", "explore_from"]) {
      expect(updatable, column).not.toContain(column);
      const refused = await asApi(async (tx, id) => {
        const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${id}::uuid, 'a post') returning id`);
        return tx.execute(sql`update posts set ${sql.raw(column)} = now() where id = ${post!.id}::uuid`);
      });
      expect(refused?.code, column).toBe("42501");
    }
  });

  test("handle_history: the API only inserts and reads, and a handle is born unretired", async () => {
    expect(await tablePrivileges("korbat_api", "public.handle_history")).toEqual(["INSERT", "SELECT"]);
    await rolledBack(apiDb, async (tx) => {
      const profile = await newProfile(tx as unknown as Db);
      const handle = `hh_${Date.now().toString(36)}`;
      await tx.execute(sql`insert into handle_history (handle_lower, profile_id, retired_at) values (${handle}, ${profile.id}::uuid, now())`);
      const [row] = await tx.execute<{ retired_at: string | null }>(sql`select retired_at from handle_history where handle_lower = ${handle}`);
      expect(row!.retired_at).toBeNull();
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`update handle_history set retired_at = now() where handle_lower = ${handle}`))))?.code).toBe("42501");
      expect((await pgError(tx.transaction((sp) => sp.execute(sql`delete from handle_history where handle_lower = ${handle}`))))?.code).toBe("42501");
    });
  });

  test("the three new tables: a reply is inserted and read, marks and tallies only read (until the reporting counts' migration)", async () => {
    expect(await tablePrivileges("korbat_api", "public.suspension_replies")).toEqual(["INSERT", "SELECT"]);
    expect(await tablePrivileges("korbat_api", "public.unfounded_marks")).toEqual(["SELECT"]);
    expect(await tablePrivileges("korbat_api", "public.report_tallies")).toEqual(["SELECT"]);
    const policies = await apiDb.execute<{ table: string; name: string; cmd: string }>(
      sql`select tablename::text as table, policyname::text as name, cmd from pg_policies where tablename in ('suspension_replies', 'unfounded_marks', 'report_tallies') order by 1`,
    );
    expect([...policies]).toEqual([
      { table: "report_tallies", name: "report_tallies_api_select", cmd: "SELECT" },
      { table: "suspension_replies", name: "suspension_replies_api_all", cmd: "ALL" },
      { table: "unfounded_marks", name: "unfounded_marks_api_all", cmd: "ALL" },
    ]);
  });

  describe("the functions and views of the standing ledger", () => {
    type Fn = { name: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean; pub: boolean; definition: string };
    const functions = async () =>
      new Map(
        (
          await apiDb.execute<Fn>(sql`
            select p.pronamespace::regnamespace::text || '.' || p.proname as name, p.proowner::regrole::text as owner, p.prosecdef as definer, p.proconfig as config,
                   has_function_privilege('korbat_api', p.oid, 'execute') as api, has_function_privilege('korbat_auth', p.oid, 'execute') as auth,
                   has_function_privilege('public', p.oid, 'execute') as pub, pg_get_functiondef(p.oid) as definition
              from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace) and p.prokind = 'f'`)
        ).map((f) => [f.name, f]),
      );

    test("the migrator owns each new function, with its search path pinned, EXECUTE taken from PUBLIC and given only where 6.2 says", async () => {
      // [definer, EXECUTE for the API role, EXECUTE for the auth role]
      const expected: Record<string, [boolean, boolean, boolean]> = {
        "public.standing_rules": [false, true, false],
        "public.standing_basis_broken_at": [false, true, false],
        "public.standing_apply": [true, false, false],
        "public.strike_due": [true, true, false],
        "public.appeal_informed_at": [false, true, false],
        "public.terminations_due": [true, true, false],
        "auth.account_standing": [true, false, true],
        "public.profiles_standing_insert": [false, false, false],
        "public.handle_history_insert": [false, false, false],
        "public.profiles_handle_guard": [false, false, false],
        "public.suspension_replies_check": [true, false, false],
        "public.suspension_replies_apply": [true, false, false],
        "public.decisions_mail_forward": [false, false, false],
        "public.decisions_mail_standing": [true, false, false],
      };
      const all = await functions();
      for (const [name, [definer, api, auth]] of Object.entries(expected)) {
        const f = all.get(name);
        expect(f, name).toBeDefined();
        expect({ name, owner: f!.owner, definer: f!.definer, config: f!.config, api: f!.api, auth: f!.auth, pub: f!.pub }).toEqual({
          name,
          owner: "korbat_migrate",
          definer,
          config: ["search_path=public, pg_temp"],
          api,
          auth,
          pub: false,
        });
      }
    });

    test("only standing_apply writes the three derived columns of profiles; only the insert trigger forces them null", async () => {
      const writers = [...(await functions()).values()].filter((f) => /(suspended_from|suspended_until|reports_restricted_until) = /.test(f.definition)).map((f) => f.name);
      expect(writers).toEqual(["public.standing_apply"]);
      const forced = [...(await functions()).values()].filter((f) => /NEW[.](suspended_from|suspended_until|reports_restricted_until) :=/.test(f.definition)).map((f) => f.name);
      expect(forced).toEqual(["public.profiles_standing_insert"]);
    });

    test("only decision_actions_apply retires a handle and gives a profile the placeholder; the replies' and marks' answers have their own writers", async () => {
      const all = [...(await functions()).values()];
      const matching = (pattern: RegExp) => all.filter((f) => pattern.test(f.definition)).map((f) => f.name).sort();
      expect(matching(/retired_at = /)).toEqual(["public.decision_actions_apply"]);
      expect(matching(/'retired_' [|][|]/)).toEqual(["public.decision_actions_apply"]);
      expect(matching(/UPDATE public[.]suspension_replies[^;]*answered_by/i)).toEqual(["public.decision_actions_apply", "public.decisions_apply"]);
      expect(matching(/UPDATE public[.]unfounded_marks[^;]*withdrawn_by/i)).toEqual(["public.decisions_apply"]);
      // No function writes a tally or Explore's three columns before the tasks that give them their writers.
      expect(matching(/(INSERT INTO|UPDATE) public[.]report_tallies/i)).toEqual([]);
      expect(matching(/(hidden_at|restored_at|explore_from) = /)).toEqual([]);
    });

    test("every number of 3e comes from standing_rules(): no new function or view holds an interval literal, and decisions_record keeps its caps' two", async () => {
      const all = await functions();
      const fresh = [
        "public.standing_rules",
        "public.standing_basis_broken_at",
        "public.standing_apply",
        "public.strike_due",
        "public.appeal_informed_at",
        "public.terminations_due",
        "auth.account_standing",
        "public.profiles_handle_guard",
        "public.suspension_replies_check",
        "public.suspension_replies_apply",
        "public.decisions_mail_forward",
        "public.decisions_mail_standing",
        "public.decisions_apply",
        "public.decision_actions_check",
        "public.decision_actions_apply",
        "public.decision_holds",
        "public.review_needs_admin",
        "public.appeals_check",
        "public.decision_final_at",
        "public.item_current_outcome",
      ];
      for (const name of fresh) expect(all.get(name)!.definition, name).not.toMatch(/interval '/i);
      expect([...all.get("public.decisions_record")!.definition.matchAll(/interval '/gi)]).toHaveLength(2);
      const views = await apiDb.execute<{ name: string; definition: string; options: string[] | null }>(
        sql`select c.relname::text as name, pg_get_viewdef(c.oid) as definition, c.reloptions as options from pg_class c
             where c.relkind = 'v' and c.relname in ('measures_in_force', 'active_strikes', 'suspension_periods', 'standing_live') order by 1`,
      );
      expect(views.map((v) => v.name)).toEqual(["active_strikes", "measures_in_force", "standing_live", "suspension_periods"]);
      for (const view of views) {
        expect(view.definition, view.name).not.toMatch(/interval '/i);
        expect(view.options, view.name).toEqual(["security_invoker=true"]);
        expect(await tablePrivileges("korbat_api", `public.${view.name}`), view.name).toEqual(["SELECT"]);
      }
    });

    test("the API role cannot run standing_apply, nor ask auth.account_standing; the auth role can ask the latter", async () => {
      expect((await asApi((tx, id) => tx.execute(sql`select public.standing_apply(${id}::uuid)`)))?.code).toBe("42501");
      expect((await asApi((tx, id) => tx.execute(sql`select auth.account_standing(${id}::uuid)`)))?.code).toBe("42501");
      const [row] = await authDb.execute<{ standing: boolean }>(sql`select auth.account_standing(gen_random_uuid()) as standing`);
      expect(row!.standing).toBe(false);
    });

    test("the new triggers, each where and when 6.1 and 6.2 put it", async () => {
      const triggers = await apiDb.execute<{ name: string; definition: string }>(
        sql`select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t
             where not t.tgisinternal and t.tgname in ('profiles_standing_insert', 'handle_history_insert', 'profiles_handle_guard', 'suspension_replies_check',
                                                       'suspension_replies_apply', 'decisions_mail_forward', 'decisions_mail_standing') order by 1`,
      );
      const timing = Object.fromEntries(triggers.map((t) => [t.name, t.definition.replace(/^CREATE TRIGGER [a-z_]+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]));
      expect(timing).toEqual({
        decisions_mail_forward: "BEFORE UPDATE OF author_mail, author_mail_at ON public.decisions FOR EACH ROW",
        decisions_mail_standing: expect.stringMatching(/^AFTER UPDATE OF author_mail ON public[.]decisions FOR EACH ROW WHEN [(].*IS DISTINCT FROM.*[)]$/),
        handle_history_insert: "BEFORE INSERT ON public.handle_history FOR EACH ROW",
        profiles_handle_guard: "BEFORE INSERT OR UPDATE OF handle ON public.profiles FOR EACH ROW",
        profiles_standing_insert: "BEFORE INSERT ON public.profiles FOR EACH ROW",
        suspension_replies_apply: "AFTER INSERT ON public.suspension_replies FOR EACH ROW",
        suspension_replies_check: "BEFORE INSERT ON public.suspension_replies FOR EACH ROW",
      });
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
