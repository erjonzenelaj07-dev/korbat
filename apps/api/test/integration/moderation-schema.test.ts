import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  ACTION_KINDS,
  AUTOMATION_RULES,
  CHECK_STATES,
  CSAM_KEYWORDS,
  DECISION_KEYWORDS,
  EDGE_PURGE_CAUSES,
  EDGE_PURGE_OUTCOMES,
  MATCH_ANSWER_REASONS,
  MATCH_HASH_TYPES,
  MATCH_KINDS,
  MEASURES,
  NOTICE_LIMITS,
  ORDER_ACTION_KINDS,
  RULE_IDS,
  SIGNAL_HANDLED,
  SIGNAL_KINDS,
  TDB_CATEGORIES,
  UPLOAD_END_REASONS,
  UPLOAD_ENDS,
  appealDeadline,
  textDigest,
} from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { TEXT_DIGEST_VECTORS } from "../../../../packages/contracts/test/digest-vectors";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MATCH_ACTING, MATCH_LISTED } from "../../src/media/match-adapter";
import {
  MINORS,
  SPEECH,
  TC,
  aPost,
  decideIn,
  hex64,
  imagePost,
  insertIntake,
  newImageRow,
  newPostRow,
  newRef,
  newTestStaff,
  openCase,
  report,
  rowCounts,
  staffProfile,
  type IntakeInput,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack, withLockTimeout } from "./staff-fixtures";

// Most tests here issue dozens of statements, each a round trip, and several hold a transaction open across them: on a
// loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/** The public tables migration 0015 creates, and what the API role holds on each beside SELECT. */
const APPEND_ONLY = ["cases", "decision_actions", "appeals", "staff_texts", "evidence_snapshots", "case_access_log", "media_holds"];
const COLUMN_UPDATES: Record<string, string[]> = {
  intakes: ["receipt", "receipt_sent_at"],
  intake_items: ["outcome_mail"],
  decisions: ["author_mail", "author_mail_at"],
  // 3b (0044_imported_posts): the five import columns, which posts_import_guard lets an update only clear, all at once,
  // with the post's tombstone. 2d (0050_post_options): hide_counts, its author's switch over the like and repost counts.
  posts: ["body", "state", "deleted_at", "like_count", "repost_count", "reply_count", "quote_count", "import_job_id", "import_source", "original_created_at", "import_shortened", "import_key", "hide_counts"],
  post_media: ["status", "error", "post_id", "position", "width", "height", "blurhash", "alt_text", "nsfw_score"],
};
const READ_ONLY = ["moderation_limits", "seal_posts"];

/**
 * Migrations 0014 to 0017 (3c design, sections 6.1 to 6.3 and 6.5) against the real database: what the API role holds and
 * does not hold, which columns the database forces whatever an insert supplies, the CHECKs against the contracts'
 * constants, who owns and may call each function, and which functions alone name the freeze, write a seal's list and
 * write the moderation columns. Statements run as korbat_api, the role the running API
 * holds, unless a test says otherwise: what it cannot do is what a compromised API cannot do. Every test that writes a
 * row does it inside a transaction that is rolled back, each refused statement in a savepoint of it, so the file leaves
 * the database as it found it; its last test holds it to that.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the moderation tables, their grants and their checks", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  /** A staff account, for the one test here that needs a decision. */
  let mod: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    mod = await newTestStaff(authDb, migrateDb, createAuthRepo(authDb), "moderator");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** Runs one statement as the API role, in a transaction with a lock timeout, and returns its error or null. For statements that write no row. */
  const asApi = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(apiDb, (tx) => tx.execute(statement)));
  const asAuth = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(authDb, (tx) => tx.execute(statement)));
  /** The error of one step inside a transaction, which stays usable: the step runs in a savepoint. */
  const within = (tx: DbTx, fn: (sp: DbTx) => Promise<unknown>) => pgError(tx.transaction(fn));
  const run = (tx: DbTx, statement: ReturnType<typeof sql>) => within(tx, (sp) => sp.execute(statement));
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The digest of a salt and a text as SQL computes it, also for a salt the contracts' textDigest refuses. */
  const sqlDigest = async (db: Db | DbTx, salt: string, text: string) =>
    (await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(${salt}, 'hex') || convert_to(${text}::text, 'UTF8')), 'hex') as digest`))[0]!.digest;

  /**
   * Which of the four table privileges, TRUNCATE and MAINTAIN a role holds on a table, named as schema.table. The table is
   * found in the catalogue by its oid: looking it up by name would need USAGE on its schema, which the API role lacks on auth.
   */
  async function tablePrivileges(role: string, table: string): Promise<string[]> {
    const [schema, name] = table.split(".");
    const rows = await apiDb.execute<{ privilege: string; held: boolean }>(sql`
      select p as privilege, has_table_privilege(${role}::name, c.oid, p) as held
        from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN']) with ordinality as u(p, place)
       where n.nspname = ${schema} and c.relname = ${name}
       order by u.place`);
    expect(rows, table).toHaveLength(6);
    return rows.filter((row) => row.held).map((row) => row.privilege);
  }

  /** The columns of a table a role may update, by a column grant or the table's. */
  async function updatableColumns(role: string, table: string): Promise<string[]> {
    const [schema, name] = table.split(".");
    const rows = await apiDb.execute<{ name: string }>(sql`
      select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${schema} and c.relname = ${name} and a.attnum > 0 and not a.attisdropped and has_column_privilege(${role}::name, a.attrelid, a.attnum, 'UPDATE')
       order by a.attnum`);
    return rows.map((row) => row.name);
  }

  /** One CHECK as the migrated database defines it. */
  async function checkDefinition(table: string, name: string): Promise<string> {
    const [row] = await apiDb.execute<{ definition: string }>(sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = ${`public.${table}`}::regclass and conname = ${name}`);
    expect(row, `${table}.${name}`).toBeDefined();
    return row!.definition;
  }

  describe("what the API role holds", () => {
    test("the append-only tables: SELECT and INSERT, and no column of them can be updated", async () => {
      for (const table of APPEND_ONLY) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT", "INSERT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual([]);
      }
    });

    test("intakes, items and decisions: SELECT, INSERT and UPDATE of their mail columns only; no DELETE and no TRUNCATE", async () => {
      for (const table of ["intakes", "intake_items", "decisions"]) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT", "INSERT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual(COLUMN_UPDATES[table]);
      }
    });

    test("the limits and a seal's list are read only", async () => {
      for (const table of READ_ONLY) {
        expect(await tablePrivileges("korbat_api", `public.${table}`), table).toEqual(["SELECT"]);
        expect(await updatableColumns("korbat_api", `public.${table}`), table).toEqual([]);
      }
      expect(await tablePrivileges("korbat_api", "public.measures_in_force")).toEqual(["SELECT"]);
    });

    test("posts: UPDATE of the thirteen columns the API writes (3b added the five import columns, 2d hide_counts), never of the moderation level or the erasure time; no DELETE, no TRUNCATE", async () => {
      expect(await tablePrivileges("korbat_api", "public.posts")).toEqual(["SELECT", "INSERT"]);
      expect((await updatableColumns("korbat_api", "public.posts")).sort()).toEqual([...COLUMN_UPDATES.posts!].sort());
    });

    test("post_media: UPDATE of the nine columns the API writes, never of the moderation state, the hold or the erasure time; DELETE stays, TRUNCATE never", async () => {
      expect(await tablePrivileges("korbat_api", "public.post_media")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect((await updatableColumns("korbat_api", "public.post_media")).sort()).toEqual([...COLUMN_UPDATES.post_media!].sort());
    });

    test("profiles: SELECT and INSERT, and since 3e UPDATE of the twelve columns the API writes (2d added share_previews), never DELETE or TRUNCATE", async () => {
      // 3e (design, section 6.1): the table's UPDATE became column grants, so the three derived columns stay the database's.
      // 2d (0050_post_options): the link-preview switch is the twelfth.
      expect(await tablePrivileges("korbat_api", "public.profiles")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.profiles")).toHaveLength(12);
    });

    test("it has no access to the auth schema, nor to any of the four new auth tables", async () => {
      const [row] = await apiDb.execute<{ usage: boolean }>(sql`select has_schema_privilege('korbat_api', 'auth', 'usage') as usage`);
      expect(row!.usage).toBe(false);
      for (const table of ["notifier_contacts", "notifier_confirmations", "notifier_suppressions", "staff_personal_accounts"]) {
        expect(await tablePrivileges("korbat_api", `auth.${table}`), table).toEqual([]);
        expect((await asApi(sql`select count(*) from auth.${sql.identifier(table)}`))?.message, table).toMatch(/permission denied for schema auth/);
      }
    });

    test("the statements themselves are refused: updates, deletes and truncates of the moderation tables", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const caseId = await openCase(tx, "post", postId);
        const intakeId = await insertIntake(tx, { reporterId: ada.id, ruleId: "R1" });
        const refused: [ReturnType<typeof sql>, RegExp][] = [
          [sql`update cases set lane = 0 where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`update cases set closed_at = now() where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`delete from cases where id = ${caseId}::uuid`, /permission denied for table cases/],
          [sql`truncate cases cascade`, /permission denied for table/],
          // Without UPDATE on the table no row of it can be locked either, so the API cannot stall a decision by holding a case.
          [sql`select id from cases where id = ${caseId}::uuid for update`, /permission denied for table cases/],
          [sql`select id from cases where id = ${caseId}::uuid for key share`, /permission denied for table cases/],
          [sql`lock table cases in share mode`, /permission denied for table cases/],
          [sql`update intakes set erased_at = now() where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`update intakes set reporter_id = null where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`delete from intakes where id = ${intakeId}::uuid`, /permission denied for table intakes/],
          [sql`update intake_items set outcome_sent_at = now()`, /permission denied for table intake_items/],
          [sql`update intake_items set shown_outcome = 'no_violation'`, /permission denied for table intake_items/],
          [sql`update intake_items set revised_sent_at = now()`, /permission denied for table intake_items/],
          [sql`update intake_items set answered_by = null`, /permission denied for table intake_items/],
          [sql`delete from intake_items`, /permission denied for table intake_items/],
          [sql`update decisions set outcome = 'no_violation'`, /permission denied for table decisions/],
          [sql`delete from decisions`, /permission denied for table decisions/],
          [sql`delete from decision_actions`, /permission denied for table decision_actions/],
          [sql`insert into seal_posts (action_id, post_id, images) values (${randomUUID()}::uuid, ${postId}::uuid, 1)`, /permission denied for table seal_posts/],
          [sql`insert into moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at) values (1, 9, 9, 9, 9, 9, now())`, /permission denied for table moderation_limits/],
          [sql`update moderation_limits set decisions_per_hour = 100000`, /permission denied for table moderation_limits/],
          [sql`delete from moderation_limits`, /permission denied for table moderation_limits/],
          [sql`update staff_texts set text = 'changed'`, /permission denied for table staff_texts/],
          [sql`update evidence_snapshots set body = 'changed'`, /permission denied for table evidence_snapshots/],
          [sql`delete from case_access_log`, /permission denied for table case_access_log/],
          [sql`update media_holds set released_at = now()`, /permission denied for table media_holds/],
          [sql`delete from media_holds`, /permission denied for table media_holds/],
        ];
        for (const [statement, refusal] of refused) expect((await run(tx, statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
        // The granted columns are writable.
        expect(await run(tx, sql`update intakes set receipt = 'sent', receipt_sent_at = now() where id = ${intakeId}::uuid`)).toBeNull();
      });
    });

    test("posts and profiles are never deleted, and the moderation columns of posts and images are never written", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const mediaId = await newImageRow(tx, ada.id, postId);
        const refused: [ReturnType<typeof sql>, RegExp][] = [
          [sql`delete from posts where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`delete from profiles where id = ${ada.id}::uuid`, /permission denied for table profiles/],
          [sql`truncate posts cascade`, /permission denied for table/],
          [sql`truncate profiles cascade`, /permission denied for table/],
          [sql`truncate post_media cascade`, /permission denied for table/],
          [sql`update posts set moderation_level = 'removed' where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update posts set erased_at = now() where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update posts set author_id = ${ada.id}::uuid where id = ${postId}::uuid`, /permission denied for table posts/],
          [sql`update post_media set moderation_state = 'sealed' where id = ${mediaId}::uuid`, /permission denied for table post_media/],
          [sql`update post_media set hold_until = null where id = ${mediaId}::uuid`, /permission denied for table post_media/],
          [sql`update post_media set erased_at = now() where id = ${mediaId}::uuid`, /permission denied for table post_media/],
        ];
        for (const [statement, refusal] of refused) expect((await run(tx, statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
        // What the API writes today still works: a counter, the author's deletion and an upload's verdict.
        expect(await run(tx, sql`update posts set like_count = like_count + 1 where id = ${postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`)).toBeNull();
        const upload = await newImageRow(tx, ada.id, null);
        expect(await run(tx, sql`update post_media set status = 'failed', error = 'processing_failed' where id = ${upload}::uuid`)).toBeNull();
      });
    });

    test("it can neither switch off nor replace a trigger of the moderation tables", async () => {
      const refusals: [ReturnType<typeof sql>, RegExp][] = [
        [sql`alter table public.post_media disable trigger post_media_keep`, /must be owner of table post_media/],
        [sql`alter table public.intake_items disable trigger all`, /must be owner of table intake_items/],
        [sql`drop trigger post_media_guard on public.post_media`, /must be owner of (table|relation) post_media/],
        [sql`create or replace function public.frozen_for(post uuid, author uuid) returns boolean language sql as 'select false'`, /permission denied|must be owner/],
        [sql`drop trigger intake_items_quote on public.intake_items`, /must be owner of (table|relation) intake_items/],
      ];
      for (const [statement, refusal] of refusals) expect((await asApi(statement))?.message, JSON.stringify(statement.queryChunks[0])).toMatch(refusal);
    });
  });

  describe("what the auth role holds on the new auth tables", () => {
    test("a contact is stored, read and deleted, and only its forget_after is ever updated", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.notifier_contacts")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect(await updatableColumns("korbat_auth", "auth.notifier_contacts")).toEqual(["forget_after"]);
      await rolledBack(authDb, async (tx) => {
        const id = randomUUID();
        await tx.execute(sql`insert into auth.notifier_contacts (id, name_enc, email_enc, email_hash, forget_after) values (${id}::uuid, 'v1:n', 'v1:e', ${hex64()}, now() + interval '13 months')`);
        expect(await run(tx, sql`update auth.notifier_contacts set forget_after = now() + interval '6 months' where id = ${id}::uuid`)).toBeNull();
        // Never re-encrypted, renamed or pointed at another address.
        for (const column of ["name_enc", "email_enc", "email_hash", "mail_token_enc", "created_at"]) {
          const err = await run(tx, sql`update auth.notifier_contacts set ${sql.identifier(column)} = null where id = ${id}::uuid`);
          expect(err?.message, column).toMatch(/permission denied for table notifier_contacts/);
        }
        const gone = await tx.execute<{ id: string }>(sql`delete from auth.notifier_contacts where id = ${id}::uuid returning id`);
        expect(gone).toHaveLength(1);
      });
    });

    test("confirmations keep every default privilege; a suppression is inserted, read and deleted, never changed", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.notifier_confirmations")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
      expect(await tablePrivileges("korbat_auth", "auth.notifier_suppressions")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect(await updatableColumns("korbat_auth", "auth.notifier_suppressions")).toEqual([]);
    });

    test("it holds nothing on the staff links, which only the migrator writes and reads", async () => {
      expect(await tablePrivileges("korbat_auth", "auth.staff_personal_accounts")).toEqual([]);
      expect((await asAuth(sql`select count(*) from auth.staff_personal_accounts`))?.message).toMatch(/permission denied for table staff_personal_accounts/);
      expect((await asAuth(sql`insert into auth.staff_personal_accounts (staff_user_id, personal_user_id) values (${randomUUID()}::uuid, ${randomUUID()}::uuid)`))?.message).toMatch(
        /permission denied for table staff_personal_accounts/,
      );
    });
  });

  describe("the functions and who names them", () => {
    type Fn = { name: string; args: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean; pub: boolean; definition: string };
    /** Every function of the public and auth schemas with its definition, as the catalogue holds it. */
    const functions = () =>
      apiDb.execute<Fn>(sql`
        select p.pronamespace::regnamespace::text || '.' || p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.proowner::regrole::text as owner,
               p.prosecdef as definer, p.proconfig as config, has_function_privilege('korbat_api', p.oid, 'execute') as api,
               has_function_privilege('korbat_auth', p.oid, 'execute') as auth, has_function_privilege('public', p.oid, 'execute') as pub,
               pg_get_functiondef(p.oid) as definition
          from pg_proc p
         where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace) and p.prokind = 'f'
         order by 1`);

    /** Every other definition the database holds that could name a function: views, triggers, constraints, index predicates and policies. */
    const otherDefinitions = () =>
      apiDb.execute<{ kind: string; name: string; definition: string }>(sql`
        select 'view' as kind, c.relname::text as name, pg_get_viewdef(c.oid) as definition from pg_class c where c.relkind = 'v' and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'trigger', t.tgname::text, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'constraint', n.conname::text, pg_get_constraintdef(n.oid) from pg_constraint n where n.connamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'index', i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
        union all select 'policy', p.polname::text, coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') from pg_policy p`);

    test("the migrator owns every function of 0015, each with its search path pinned and EXECUTE taken from PUBLIC", async () => {
      const pub = ["search_path=public, pg_temp"];
      // [definer, EXECUTE for the API role]. The few a role calls directly are granted to that role alone; a trigger
      // function fires for every role all the same, and nobody calls it.
      const expected: Record<string, [boolean, boolean]> = {
        appeal_deadline: [false, true],
        case_access_log_insert: [false, false],
        cases_insert: [false, false],
        evidence_snapshots_insert: [false, false],
        frozen_for: [false, true],
        intake_items_attach: [true, false],
        intake_items_quote: [true, false],
        intakes_insert: [false, false],
        media_holds_apply: [true, false],
        media_holds_insert: [false, false],
        post_frozen: [false, true],
        post_media_guard: [false, false],
        post_media_insert: [false, false],
        post_media_keep: [true, false],
        staff_texts_insert: [false, false],
      };
      const names = Object.keys(expected);
      const rows = (await functions()).filter((f) => f.name.startsWith("public.") && names.includes(f.name.slice(7)));
      expect(rows.map((f) => f.name.slice(7)).sort()).toEqual([...names].sort());
      for (const f of rows) {
        const [definer, api] = expected[f.name.slice(7)]!;
        expect({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name: f.name, owner: "korbat_migrate", definer, config: pub, api, auth: false, pub: false });
      }
    });

    test("the migrator owns every function of 0016; the API role may call four of them and no other", async () => {
      const pub = ["search_path=public, pg_temp"];
      // [definer, EXECUTE for the API role, the pinned search path]. The trigger functions fire for every role and nobody
      // calls them; moderation_apply, the one writer of the moderation columns, is called only by its owner's functions.
      const expected: Record<string, [boolean, boolean, string[]]> = {
        account_is_staff: [true, false, ["search_path=auth, pg_temp"]],
        append_confirmed_audit: [true, true, pub],
        decision_actions_apply: [true, false, pub],
        decision_actions_check: [true, false, pub],
        decision_actions_recheck: [true, false, pub],
        decision_holds: [true, false, pub],
        decisions_apply: [true, false, pub],
        decisions_check: [true, false, pub],
        decisions_record: [true, false, pub],
        item_current_outcome: [false, false, pub],
        moderation_apply: [true, false, pub],
        posts_guard: [false, false, pub],
        release_outcomes: [true, true, pub],
        snapshot_withheld: [false, true, pub],
        staff_case_conflict: [true, true, pub],
        staff_party_conflict: [true, false, pub],
      };
      const names = Object.keys(expected);
      const rows = (await functions()).filter((f) => f.name.startsWith("public.") && names.includes(f.name.slice(7)));
      expect(rows.map((f) => f.name.slice(7)).sort()).toEqual([...names].sort());
      for (const f of rows) {
        const [definer, api, config] = expected[f.name.slice(7)]!;
        expect({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name: f.name, owner: "korbat_migrate", definer, config, api, auth: false, pub: false });
      }
      // Every function of the public schema is one of 0015's or 0016's lists, or older than both.
      const callable = (await functions()).filter((f) => f.name.startsWith("public.") && f.api).map((f) => f.name.slice(7));
      expect(callable).toEqual(expect.arrayContaining(["append_confirmed_audit", "release_outcomes", "snapshot_withheld", "staff_case_conflict"]));
      for (const name of ["moderation_apply", "item_current_outcome", "account_is_staff", "staff_party_conflict"]) expect(callable, name).not.toContain(name);
    });

    test("the migrator owns the three functions of 0017; the API role may call the two that answer who reviews, and the three it replaced keep their owner and grants", async () => {
      const pub = ["search_path=public, pg_temp"];
      // [definer, EXECUTE for the API role]. The appeal's trigger function fires for every role and nobody calls it.
      const expected: Record<string, [boolean, boolean]> = {
        appeal_reviewer_state: [true, true],
        appeals_check: [true, false],
        review_needs_admin: [true, true],
        // Replaced by 0017 with CREATE OR REPLACE, which keeps what 0016 gave them.
        decision_actions_apply: [true, false],
        decisions_apply: [true, false],
        decisions_record: [true, false],
      };
      const names = Object.keys(expected);
      const rows = (await functions()).filter((f) => f.name.startsWith("public.") && names.includes(f.name.slice(7)));
      expect(rows.map((f) => f.name.slice(7)).sort()).toEqual([...names].sort());
      for (const f of rows) {
        const [definer, api] = expected[f.name.slice(7)]!;
        expect({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name: f.name, owner: "korbat_migrate", definer, config: pub, api, auth: false, pub: false });
      }
      // The replaced functions are the new ones: a review is accepted, an appeal is answered, and a seal is asked of the view.
      const definition = (name: string) => rows.find((f) => f.name === `public.${name}`)!.definition;
      expect(definition("decisions_record")).toMatch(/reviewer_conflict/);
      expect(definition("decisions_record")).not.toMatch(/waits for the migration/);
      expect(definition("decisions_apply")).toMatch(/UPDATE public\.appeals/);
      expect(definition("decision_actions_apply")).toMatch(/measures_in_force m WHERE m\.id = NEW\.id/);
      // review_needs_admin reads the decision and its ledger, never the freeze.
      expect(definition("review_needs_admin")).not.toMatch(/frozen|intake_items|cases/);
    });

    test("the appeal's trigger is on its table, before the insert", async () => {
      const rows = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.appeals'::regclass order by 1`);
      expect(rows.map((row) => [row.name, row.definition.replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")])).toEqual([["appeals_check", "BEFORE INSERT ON public.appeals FOR EACH ROW"]]);
    });

    test("the migrator owns every function of 0018; the API role may call the due rules and the erasures that check them, never the two gates' own functions", async () => {
      const pub = ["search_path=public, pg_temp"];
      const auth = ["search_path=auth, pg_temp"];
      // [definer, EXECUTE for the API role]. The three due rules are plain and run with their reader's rights. The one
      // function that erases a snapshot (gate E) and the one that releases holds are called only by their owner's functions.
      const expected: Record<string, [boolean, boolean]> = {
        case_evidence_due_at: [false, true],
        decision_final_at: [false, true],
        delete_access_log: [true, true],
        erase_case_evidence: [true, true],
        erase_intake: [true, true],
        erase_snapshots: [true, false],
        erase_statement_texts: [true, true],
        forget_reporter: [true, true],
        intake_due_at: [false, true],
        redact_r4_body: [true, true],
        release_case_holds: [true, false],
        sweep_staff_texts: [true, true],
      };
      const names = Object.keys(expected);
      const all = await functions();
      const rows = all.filter((f) => f.name.startsWith("public.") && names.includes(f.name.slice(7)));
      expect(rows.map((f) => f.name.slice(7)).sort()).toEqual([...names].sort());
      for (const f of rows) {
        const [definer, api] = expected[f.name.slice(7)]!;
        expect({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name: f.name, owner: "korbat_migrate", definer, config: pub, api, auth: false, pub: false });
      }
      // The auth schema's two: the count of links, which the auth role alone may call, and the trigger function nobody calls.
      const authSide = all.filter((f) => f.name === "auth.users_deleted_mark" || f.name === "auth.staff_link_counts");
      expect(authSide.map((f) => ({ name: f.name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }))).toEqual([
        { name: "auth.staff_link_counts", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true, pub: false },
        { name: "auth.users_deleted_mark", owner: "korbat_migrate", definer: false, config: auth, api: false, auth: false, pub: false },
      ]);
      // Everything the API role may call of what the migrator owns, in both schemas, after the last migration of 3c (design,
      // section 11), and the five of 3e's standing ledger: the constants, a basis, the strike rule, the appeal's start and the terminations due;
      // and 3e's two steps of the retention job (0024_standing_retention): a reply's text and the reporting counts; and 3f's
      // two of 0026_messages_alerts: the order rules and the alert tick's time-driven rows.
      const callable = all.filter((f) => f.owner === "korbat_migrate" && f.api).map((f) => f.name);
      expect(callable).toEqual([
        "public.alert_steps",
        "public.appeal_deadline",
        "public.appeal_informed_at",
        "public.appeal_reviewer_state",
        "public.append_confirmed_audit",
        // 3d Task 6 (0038_automated_decisions): the program's numbers, which the step and automation-status read.
        "public.automation_rules",
        // 3d Task 4 (0036_transparency): the one place a count becomes public text, the public figures' constants, and the
        // daily call that stores a due edition; the figures themselves are computed by the migrator's functions alone.
        "public.band",
        "public.case_evidence_due_at",
        // 3d Task 8 (0040_signals_and_retention): the flag, which the queue's and the case answer's reads call, and the
        // retention job's erasure of the automated tools' records, which answers a count.
        "public.case_flag",
        "public.decision_final_at",
        "public.delete_access_log",
        // Task 4 (0029_orders_retention): the retention job's three steps of 3f.
        "public.delete_contact_messages",
        // Task 6 (0031_recovery): the retention step of the restore gaps, which answers a count.
        "public.delete_restore_gaps",
        "public.edition_publish",
        // Task 5 (0030_authority_records): the retention step of the records to authorities, which answers a count.
        "public.erase_authority_records",
        "public.erase_automation_records",
        "public.erase_case_evidence",
        "public.erase_intake",
        "public.erase_order_records",
        "public.erase_reply_statements",
        "public.erase_statement_texts",
        "public.forget_report_counts",
        "public.forget_reporter",
        "public.frozen_for",
        // Task 6: a gap's closing, with the decision that took the measure again or, by an admin, with none.
        "public.gap_close",
        // 3d Task 5 (0037_head_publications): the head's digest, which the insert trigger computes as the API's role.
        "public.head_value",
        "public.intake_due_at",
        // 3d Task 1 (0033_quarantine): the six functions by which the API's role reaches the quarantine, which answer counts,
        // one time and booleans: a lost image's notice owed and told, an image's custody, the home's counts and a seal's.
        "public.lost_told",
        // 2d Task 1 (0049_activity): the lost images whose notice was handled, ids and times only, for Activity's list.
        "public.lost_told_for",
        "public.lost_untold",
        // 3d Task 7 (0039_known_material): the adapter's listed and acting pairs, the end of a held upload's hold, its
        // release and the release block's facts.
        "public.match_acting",
        "public.match_listed",
        "public.media_lost",
        "public.media_quarantined",
        // 3f's Task 2 (0027_orders): the hold and the preservation, and the two writers a key's audit row binds.
        "public.order_correct",
        "public.order_event_record",
        "public.order_hold_end",
        "public.order_hold_until",
        // Task 3 (0028_orders_ledger): the release of held notices, which the dispatch round calls, and the preservation's predicate.
        "public.order_notices_release",
        "public.order_preservation_end",
        "public.order_preserve_until",
        "public.order_records_due",
        "public.order_rules",
        "public.post_frozen",
        "public.post_preserved",
        "public.quarantine_counts",
        "public.redact_r4_body",
        // 3d Task 2 (0034_release): the day of a release by period (which nothing reaches while its period is unset), the
        // release block's facts, the release's constants, whether a release's author may be told, and the release itself.
        "public.release_announce",
        "public.release_facts",
        "public.release_outcomes",
        "public.release_rules",
        "public.release_tellable",
        // Task 5: what the console learns of the records to authorities: a case, a kind and a time for each owed one.
        "public.reports_owed",
        "public.review_needs_admin",
        "public.seal_custody",
        "public.seal_release",
        "public.snapshot_withheld",
        "public.staff_case_conflict",
        "public.standing_basis_broken_at",
        "public.standing_rules",
        "public.strike_due",
        "public.sweep_staff_texts",
        "public.terminations_due",
        "public.transparency_rules",
        "public.upload_hold_end",
        "public.upload_release",
        "public.upload_release_facts",
      ]);
    });

    test("the deletion mark's trigger is on auth.users, before an update that names the mark", async () => {
      const rows = await apiDb.execute<{ definition: string }>(sql`
        select pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relnamespace = 'auth'::regnamespace and c.relname = 'users' and t.tgname = 'users_deleted_mark'`);
      expect(rows.map((row) => row.definition.replace(/^CREATE TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, ""))).toEqual(["BEFORE UPDATE OF deleted_at ON auth.users FOR EACH ROW"]);
    });

    test("every function the migrator owns in the two schemas pins its search path and is closed to PUBLIC", async () => {
      const owned = (await functions()).filter((f) => f.owner === "korbat_migrate");
      expect(owned.length).toBeGreaterThan(15);
      for (const f of owned) {
        expect(f.config?.some((setting) => /^search_path=(public|auth), pg_temp$/.test(setting)), f.name).toBe(true);
        expect(f.pub, f.name).toBe(false);
      }
    });

    test("frozen_for is named only by post_frozen and by the keep trigger's function; post_frozen only by decisions_record, erase_snapshots, redact_r4_body and order_preservation_end", async () => {
      const all = await functions();
      const naming = (word: RegExp) => all.filter((f) => word.test(f.definition)).map((f) => f.name);
      // Each function's own definition holds its name.
      expect(naming(/\bfrozen_for\b/)).toEqual(["public.frozen_for", "public.post_frozen", "public.post_media_keep"]);
      // One function of 0016 reads the freeze: the one that stores whether a decision was taken while nobody could open the images.
      // And two of 0018: the one function that erases a snapshot (gate E), and the R4 redaction, which waits while its post is frozen.
      // And (3f, 0029) the end of an order's preservation, which waits as the redaction does.
      expect(naming(/\bpost_frozen\b/)).toEqual(["public.decisions_record", "public.erase_snapshots", "public.order_preservation_end", "public.post_frozen", "public.redact_r4_body"]);
      // Nor does a view, a trigger, a constraint, an index or a policy name either.
      const others = (await otherDefinitions()).filter((d) => /\b(frozen_for|post_frozen)\b/.test(d.definition));
      expect(others.map((d) => `${d.kind} ${d.name}`)).toEqual([]);
    });

    test("one function writes a seal's list, and one the moderation columns of posts and images", async () => {
      const all = await functions();
      const matching = (statement: RegExp) => all.filter((f) => statement.test(f.definition)).map((f) => f.name);
      // A statement that writes the table, as SQL may spell it: an insert, an update, a delete or a merge, the name bare or
      // schema-qualified, quoted or not; for a column, an update, a merge or an insert that updates on a conflict.
      const sealList = /(insert\s+into|update|delete\s+from|merge\s+into)\s+(only\s+)?("?public"?\s*\.\s*)?"?seal_posts"?(?![\w"])/i;
      const imageState = /(update\s+(only\s+)?|merge\s+into\s+(only\s+)?|insert\s+into\s+)("?public"?\s*\.\s*)?"?post_media"?(?![\w"])[^;]*\bset\b[^;]*"?moderation_state"?\s*=/i;
      const postColumns = /(update\s+(only\s+)?|merge\s+into\s+(only\s+)?|insert\s+into\s+)("?public"?\s*\.\s*)?"?posts"?(?![\w"])[^;]*\bset\b[^;]*"?(moderation_level|state|erased_at)"?\s*=/i;
      const calls = /\bmoderation_apply\s*\(/i;
      expect(matching(sealList)).toEqual(["public.decision_actions_apply"]);
      expect(matching(imageState)).toEqual(["public.moderation_apply"]);
      // Of the three columns of posts, the level and the state are moderation_apply's alone; the erasure mark is the R4
      // redaction's and (3f, 0029) the end of an order's preservation's.
      expect(matching(postColumns)).toEqual(["public.moderation_apply", "public.order_preservation_end", "public.redact_r4_body"]);
      const written = (table: string, columns: string) =>
        new RegExp(String.raw`(update\s+(only\s+)?|merge\s+into\s+(only\s+)?|insert\s+into\s+)("?public"?\s*[.]\s*)?"?${table}"?(?![\w"])[^;]*\bset\b[^;]*"?(${columns})"?\s*=`, "i");
      const postLevel = written("posts", "moderation_level|state");
      const postErased = written("posts", "erased_at");
      const imageErased = written("post_media", "erased_at");
      const snapshotErased = written("evidence_snapshots", "erased_at");
      expect(matching(postLevel)).toEqual(["public.moderation_apply"]);
      expect(matching(postErased)).toEqual(["public.order_preservation_end", "public.redact_r4_body"]);
      // 3d Task 2 (0034_release; C 17, extended): a release and its replay erase the image rows of their posts.
      // 3d Task 7 (0039_known_material): and a held upload's release, its replay, and the replay of a lost end as no_report.
      expect(matching(imageErased)).toEqual([
        "public.order_preservation_end",
        "public.redact_r4_body",
        "public.release_replay",
        "public.seal_release",
        "public.upload_hold_replay",
        "public.upload_release",
        "public.upload_release_replay",
      ]);
      // Gate E: one function writes a snapshot's erasure, no function deletes a snapshot, and that one function is called
      // by the two erasures of 0018 and by nothing else.
      expect(matching(snapshotErased)).toEqual(["public.erase_snapshots"]);
      expect(matching(/delete\s+from\s+(only\s+)?("?public"?\s*[.]\s*)?"?evidence_snapshots"?(?![\w"])/i)).toEqual([]);
      expect(matching(/\berase_snapshots\s*\(/i)).toEqual(["public.erase_case_evidence", "public.erase_snapshots", "public.order_preservation_end", "public.redact_r4_body"]);
      // The writer is called by the two triggers that follow a stored decision and a stored measure, by the R4 redaction,
      // and (3f) by order_correct, whose changed withholding derives the level of its measures' posts again.
      // And (3f, 0029) the end of an order's preservation, by which an erased post is removed for good.
      expect(matching(calls)).toEqual(["public.decision_actions_apply", "public.decisions_apply", "public.moderation_apply", "public.order_correct", "public.order_preservation_end", "public.redact_r4_body"]);
      for (const statement of [
        "UPDATE public.evidence_snapshots s SET erased_at = now(), body = NULL",
        'update only "public"."evidence_snapshots" set "erased_at" = $1',
        "merge into evidence_snapshots s using v on s.id = v.id when matched then update set erased_at = now()",
      ]) {
        expect(snapshotErased.test(statement), statement).toBe(true);
      }
      expect(snapshotErased.test("select 1 from public.evidence_snapshots s where s.erased_at is null; update public.staff_texts t set erased_at = now()")).toBe(false);
      expect(imageErased.test("UPDATE public.post_media m SET erased_at = coalesce(m.erased_at, now())")).toBe(true);
      expect(imageErased.test("UPDATE public.media_holds h SET released_at = now(); select m.erased_at = now() from public.post_media m")).toBe(false);
      expect(postErased.test("UPDATE public.posts p SET body = '', erased_at = now()")).toBe(true);
      expect(postErased.test("UPDATE public.posts p SET moderation_level = v.level WHERE p.erased_at IS NOT NULL")).toBe(false);
      // Each search finds such a statement in every form, and no other statement.
      for (const statement of [
        "INSERT INTO public.seal_posts (action_id, post_id, images)",
        'insert into "public"."seal_posts" (action_id)',
        "update seal_posts s set images = 1",
        'DELETE FROM ONLY "seal_posts" s',
        "merge into public.seal_posts s using listed l on l.post_id = s.post_id",
      ]) {
        expect(sealList.test(statement), statement).toBe(true);
      }
      expect(sealList.test("select 1 from public.seal_posts s; delete from public.seal_posts_kept")).toBe(false);
      for (const statement of [
        "UPDATE public.post_media i SET status = 'ready', moderation_state = v.state",
        'update only "public"."post_media" set "moderation_state" = $1',
        "insert into post_media (id) values ($1) on conflict (id) do update set moderation_state = excluded.moderation_state",
        "merge into public.post_media m using v on m.id = v.id when matched then update set moderation_state = v.state",
      ]) {
        expect(imageState.test(statement), statement).toBe(true);
      }
      expect(imageState.test("UPDATE public.post_media m SET hold_until = latest WHERE m.id = NEW.media_id; SELECT moderation_state = 'x'")).toBe(false);
      expect(imageState.test("insert into public.post_media (owner_id, moderation_state) values ($1, 'visible')")).toBe(false);
      for (const statement of [
        "update posts set body = '', state = 'removed'",
        'UPDATE "public"."posts" p SET "moderation_level" = v.level',
        "insert into public.posts (id) values ($1) on conflict (id) do update set erased_at = now()",
        "merge into posts p using v on p.id = v.id when matched then update set state = v.state",
      ]) {
        expect(postColumns.test(statement), statement).toBe(true);
      }
      expect(postColumns.test("insert into public.posts (author_id, body, state) values ($1, $2, 'visible')")).toBe(false);
      expect(postColumns.test("update public.posts_archive set state = 'removed'")).toBe(false);
    });

    test("no function deletes from post_media: the image rows go only by a statement the keep trigger meets", async () => {
      const deleting = (await functions()).filter((f) => /delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test(f.definition));
      expect(deleting.map((f) => f.name)).toEqual([]);
      // The search finds such a statement where there is one.
      expect(/delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test('DELETE FROM "public"."post_media" WHERE id = $1')).toBe(true);
      expect(/delete\s+from\s+(only\s+)?("?public"?\s*\.\s*)?"?post_media"?\b/i.test("delete from public.post_media m where m.id = x")).toBe(true);
    });

    test("the triggers of 0015 are on their tables, in the timing the design gives", async () => {
      const rows = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.cases'::regclass, 'public.intakes'::regclass, 'public.intake_items'::regclass, 'public.staff_texts'::regclass,
               'public.evidence_snapshots'::regclass, 'public.case_access_log'::regclass, 'public.post_media'::regclass, 'public.media_holds'::regclass)
         order by 1`);
      const timing = Object.fromEntries(rows.map((row) => [row.name, row.definition.replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]));
      expect(timing).toEqual({
        case_access_log_insert: "BEFORE INSERT ON public.case_access_log FOR EACH ROW",
        cases_insert: "BEFORE INSERT ON public.cases FOR EACH ROW",
        evidence_snapshots_insert: "BEFORE INSERT ON public.evidence_snapshots FOR EACH ROW",
        intake_items_attach: "BEFORE INSERT ON public.intake_items FOR EACH ROW",
        intake_items_quote: "AFTER INSERT ON public.intake_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        intakes_insert: "BEFORE INSERT ON public.intakes FOR EACH ROW",
        media_holds_apply: "AFTER INSERT OR UPDATE ON public.media_holds FOR EACH ROW",
        media_holds_insert: "BEFORE INSERT ON public.media_holds FOR EACH ROW",
        post_media_guard: 'BEFORE UPDATE OF post_id, owner_id, alt_text, "position", width, height, blurhash ON public.post_media FOR EACH ROW',
        // 3b (0044_imported_posts): an imported image is attached only to its own import's post; it is inserted only with a
        // preparing job of its owner, and a native one names no job. By name, the import's insert check runs first.
        post_media_import_attach: "BEFORE UPDATE OF post_id ON public.post_media FOR EACH ROW",
        post_media_import_insert: "BEFORE INSERT ON public.post_media FOR EACH ROW",
        post_media_insert: "BEFORE INSERT ON public.post_media FOR EACH ROW",
        post_media_keep: "BEFORE DELETE ON public.post_media FOR EACH ROW",
        // 3d review M12 (0041_review): an image that stops being sealed weighs its lost files' notices again.
        post_media_lost_told: "AFTER UPDATE OF moderation_state ON public.post_media FOR EACH ROW",
        // 3d Task 7 (0039_known_material): a refused upload is attached to no post, whatever the API sends.
        post_media_refused: "BEFORE UPDATE OF post_id ON public.post_media FOR EACH ROW",
        // 3d Task 3 (0035_edge_purges): the edge's outbox row of an image that stops being public, after the statement.
        post_media_purge: "AFTER DELETE OR UPDATE OF moderation_state, erased_at ON public.post_media FOR EACH ROW",
        // 3e's reporting counts (0022_reporting_counts) add the tally of each report after it is stored, on the same table.
        report_tallies_count: "AFTER INSERT ON public.intakes FOR EACH ROW",
        staff_texts_insert: "BEFORE INSERT ON public.staff_texts FOR EACH ROW",
      });
    });

    test("the triggers of 0016 are on their tables, in the timing the design gives", async () => {
      const rows = await apiDb.execute<{ name: string; definition: string }>(sql`
        select t.tgname::text as name, pg_get_triggerdef(t.oid) as definition from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.posts'::regclass, 'public.decisions'::regclass, 'public.decision_actions'::regclass)
         order by 1`);
      const timing = Object.fromEntries(rows.map((row) => [row.name, row.definition.replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]));
      expect(timing).toEqual({
        decision_actions_apply: "AFTER INSERT ON public.decision_actions FOR EACH ROW",
        decision_actions_check: "BEFORE INSERT ON public.decision_actions FOR EACH ROW",
        // The decision's check at commit, queued again by every row of its ledger.
        decision_actions_recheck: "AFTER INSERT ON public.decision_actions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        // 3f Task 5 (0030_authority_records): a seal opens its record to the authorities, after decision_actions_apply.
        decision_actions_report: "AFTER INSERT ON public.decision_actions FOR EACH ROW",
        decisions_apply: "AFTER INSERT ON public.decisions FOR EACH ROW",
        decisions_check: "AFTER INSERT ON public.decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        // 3e: a statement mail's outcome moves one way, and fixes the start of an announced measure.
        decisions_mail_forward: "BEFORE UPDATE OF author_mail, author_mail_at ON public.decisions FOR EACH ROW",
        decisions_mail_standing: expect.stringMatching(/^AFTER UPDATE OF author_mail ON public[.]decisions FOR EACH ROW WHEN /),
        decisions_record: "BEFORE INSERT ON public.decisions FOR EACH ROW",
        posts_guard_insert: "BEFORE INSERT ON public.posts FOR EACH ROW",
        // Only a statement that names one of the three columns and changes one meets the guard: a counter's update never does.
        posts_guard_update: expect.stringMatching(/^BEFORE UPDATE OF state, moderation_level, erased_at ON public\.posts FOR EACH ROW WHEN \(.*IS DISTINCT FROM.*IS DISTINCT FROM.*IS DISTINCT FROM.*\)$/),
        // 3b (0044_imported_posts): only a statement that names one of the five import columns meets the import's guard, so
        // a counter's update (every like) never does; by name it runs after posts_guard_insert.
        posts_import_guard: "BEFORE INSERT OR UPDATE OF import_job_id, import_source, original_created_at, import_shortened, import_key ON public.posts FOR EACH ROW",
        // 2d Task 1 (0049_activity): a post whose erased_at becomes set loses its stored mentions.
        post_mentions_erase: "AFTER UPDATE OF erased_at ON public.posts FOR EACH ROW",
        // 3d Task 3 (0035_edge_purges): one outbox row for each image of a post whose level or state leaves visible.
        posts_purge: "AFTER UPDATE OF moderation_level, state ON public.posts FOR EACH ROW",
      });
    });

    test("the case's history runs with its reader's rights, and the API role only reads it", async () => {
      const [view] = await apiDb.execute<{ options: string[] | null }>(sql`select c.reloptions as options from pg_class c where c.oid = 'public.case_history'::regclass`);
      expect(view!.options).toEqual(["security_invoker=true"]);
      expect(await tablePrivileges("korbat_api", "public.case_history")).toEqual(["SELECT"]);
      const columns = await apiDb.execute<{ name: string }>(sql`select attname::text as name from pg_attribute where attrelid = 'public.case_history'::regclass and attnum > 0 order by attnum`);
      expect(columns.map((c) => c.name)).toEqual(["case_id", "at", "event", "ref_id", "seq", "intake_kind", "rule_id", "alleges_illegal", "csam", "reexamination", "decision_kind", "outcome", "staff_id", "result"]);
    });

    test("3f's writers (0027_orders; design, section 6.7): who writes a decision's informed_at, an order's row, its events, an item's closing and a measure's withholding", async () => {
      const all = await functions();
      const writing = (pattern: RegExp) => all.filter((f) => pattern.test(f.definition)).map((f) => f.name);
      // A decision's informed_at: decisions_record forces it at the insert; order_correct writes it, and only to null; and
      // (Task 3, 0028_orders_ledger) order_notices_release tells a held decision, while the two later writers of a
      // decision's mail (decisions_apply's ended seals, decision_actions_check's step 11) hold a telling on a held post.
      expect(writing(/[^a-z_]informed_at (:)?= /)).toEqual(["public.decision_actions_check", "public.decisions_apply", "public.decisions_record", "public.order_correct", "public.order_notices_release"]);
      expect(all.find((f) => f.name === "public.order_notices_release")!.definition).toContain("SET informed_at = clock_timestamp(), author_mail = 'pending'");
      expect(all.find((f) => f.name === "public.order_correct")!.definition).toMatch(/SET informed_at = NULL, author_mail = 'none'/);
      // An order's row: written by order_event_record and order_correct alone (and the command line, as the migrator).
      // Task 4 (0029_orders_retention): erase_order_records deletes it with its events and items once its records are due.
      expect(writing(/(UPDATE|INSERT INTO|DELETE FROM) public[.]legal_orders /i)).toEqual(["public.erase_order_records", "public.order_correct", "public.order_event_record"]);
      // Task 3: the ledger's events (effect_given, reinstated) and the release's notice_released.
      // Task 4: the end of a preservation's preservation_ended, by the system.
      expect(writing(/INSERT INTO public[.]legal_order_events/i)).toEqual(["public.decision_actions_apply", "public.order_correct", "public.order_event_record", "public.order_notices_release", "public.order_preservation_end"]);
      // An item's closing: order_correct closes it; an effect clears it (decision_actions_apply).
      expect(writing(/closed_reason = /)).toEqual(["public.decision_actions_apply", "public.order_correct"]);
      // An item's preservation (design, section 6.7): set and ended by the ledger (decision_actions_apply) and a correction
      // (order_correct), and ended by time by order_preservation_end (Task 4, 0029) alone.
      expect(writing(/preserve_(until|ended_at) = /)).toEqual(["public.decision_actions_apply", "public.order_correct", "public.order_preservation_end"]);
      expect(writing(/withhold_author = /)).toEqual(["public.order_correct"]);
      // The two definer functions pin public alone and name auth's table in full, as every function the migrator owns does.
      for (const name of ["public.order_correct", "public.order_event_record", "public.legal_order_events_confirmed"]) {
        const f = all.find((found) => found.name === name)!;
        expect([f.definer, f.config], name).toEqual([true, ["search_path=public, pg_temp"]]);
      }
      // No function of 0027 holds an interval literal or a number of order_rules(): each is read from there.
      // Nor any of 0029_orders_retention.
      for (const name of ["public.order_hold_end", "public.order_hold_until", "public.order_preserve_until", "public.order_event_record", "public.order_correct", "public.legal_orders_insert",
                          "public.order_preservation_end", "public.order_records_due", "public.erase_order_records", "public.delete_contact_messages"]) {
        expect(all.find((f) => f.name === name)!.definition, name).not.toMatch(/interval '/i);
      }
      const views = (await otherDefinitions()).filter((d) => d.kind === "view" && d.name === "legal_order_clock");
      expect(views.map((v) => /interval '/i.test(v.definition))).toEqual([false]);
    });

    test("3d Task 3 (0035_edge_purges; design, sections 6.3 and 6.9): only the two trigger functions insert into edge_purges, each a definer that compares through text; the API's role reads, moves four columns and deletes, and inserts nothing; both CHECKs are their constants", async () => {
      const all = await functions();
      // As pg_get_functiondef prints a statement: one space between words, the name schema-qualified or bare.
      const inserting = all.filter((f) => /insert into (only )?(public[.])?"?edge_purges"?[ (]/i.test(f.definition)).map((f) => f.name);
      expect(inserting).toEqual(["public.post_media_purge", "public.posts_purge"]);
      for (const name of ["public.post_media_purge", "public.posts_purge", "public.edge_purges_insert"]) {
        const f = all.find((found) => found.name === name)!;
        expect({ owner: f.owner, definer: f.definer, config: f.config, api: f.api, pub: f.pub }, name).toEqual({
          owner: "korbat_migrate",
          definer: name !== "public.edge_purges_insert",
          config: ["search_path=public, pg_temp"],
          api: false,
          pub: false,
        });
        // Through text, never an enum literal: a level or a state added later is covered without being named.
        expect(f.definition, name).not.toMatch(/'[a-z_]+'::(public[.])?(post_state|moderation_level|media_moderation_state|media_status)/);
      }
      // Neither function takes a lock: no FOR UPDATE, FOR SHARE or LOCK statement.
      for (const name of ["public.post_media_purge", "public.posts_purge"]) expect(all.find((f) => f.name === name)!.definition, name).not.toMatch(/ for (no key )?(update|share)| lock table /i);
      expect(await tablePrivileges("korbat_api", "public.edge_purges")).toEqual(["SELECT", "DELETE"]);
      expect(await updatableColumns("korbat_api", "public.edge_purges")).toEqual(["next_at", "attempts", "outcome", "done_at"]);
      const listed = (definition: string) => [...definition.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect(listed(await checkDefinition("edge_purges", "edge_purges_cause"))).toEqual([...EDGE_PURGE_CAUSES]);
      expect(listed(await checkDefinition("edge_purges", "edge_purges_outcome"))).toEqual([...EDGE_PURGE_OUTCOMES]);
      const [seq] = await apiDb.execute<{ usage: boolean }>(sql`select has_sequence_privilege('korbat_api', 'public.edge_purges_id_seq', 'USAGE') as usage`);
      expect(seq!.usage).toBe(false);
    });

    test("3d Task 6 (0038_automated_decisions; design, section 6.6): automation_rules() is AUTOMATION_RULES; the API's role reads and inserts a signal and sets four columns of it, reads and inserts a request for a person, and calls none of the three trigger functions; both CHECKs of a signal are their constants", async () => {
      const [row] = await apiDb.execute<Record<string, unknown>>(sql`select * from public.automation_rules()`);
      const camel = (name: string) => name.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
      expect(Object.fromEntries(Object.entries(row!).map(([name, value]) => [camel(name), value === null ? null : Number(value)]))).toEqual({ ...AUTOMATION_RULES });
      expect(await tablePrivileges("korbat_api", "public.automated_signals")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.automated_signals")).toEqual(["intake_item_id", "decision_id", "handled_at", "handled"]);
      expect(await tablePrivileges("korbat_api", "public.automated_objections")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.automated_objections")).toEqual([]);
      const all = await functions();
      // The request's trigger is a definer: it reads the measures in force, which the API's role reads too, and refuses as
      // objection_not_open, so no caller learns more than that.
      for (const [name, definer] of [
        ["public.automated_signals_insert", false],
        ["public.automated_signals_guard", false],
        ["public.automated_objections_insert", true],
      ] as const) {
        const f = all.find((found) => found.name === name)!;
        expect({ owner: f.owner, definer: f.definer, config: f.config, api: f.api, pub: f.pub }, name).toEqual({ owner: "korbat_migrate", definer, config: ["search_path=public, pg_temp"], api: false, pub: false });
      }
      const listed = (definition: string) => [...definition.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
      expect(listed(await checkDefinition("automated_signals", "automated_signals_kind"))).toEqual([...SIGNAL_KINDS]);
      expect(listed(await checkDefinition("automated_signals", "automated_signals_handled"))).toEqual([...SIGNAL_HANDLED]);
    });

    test("3d Task 7's tables and functions (0039_known_material; design, section 6.7): the grants, the CHECK lists as the contracts' constants, the adapter's pairs as MATCH_LISTED and MATCH_ACTING, and who owns and may call each function", async () => {
      expect(await tablePrivileges("korbat_api", "public.media_hashes")).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
      expect(await tablePrivileges("korbat_api", "public.media_matches")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.media_matches")).toEqual(["case_id", "handled_at"]);
      expect(await tablePrivileges("korbat_api", "public.upload_refusals")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.upload_refusals")).toEqual(["told", "lifted_told", "objection", "objected_at"]);
      const listed = (definition: string) => [...definition.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
      expect(listed(await checkDefinition("media_hashes", "media_hashes_check_state"))).toEqual([...CHECK_STATES]);
      expect(listed(await checkDefinition("media_matches", "media_matches_hash_type"))).toEqual([...MATCH_HASH_TYPES]);
      expect(listed(await checkDefinition("media_matches", "media_matches_kind"))).toEqual([...MATCH_KINDS]);
      expect(listed(await checkDefinition("upload_refusals", "upload_refusals_end_as"))).toEqual([...UPLOAD_ENDS]);
      expect(listed(await checkDefinition("upload_refusals", "upload_refusals_end_reason"))).toEqual([...UPLOAD_END_REASONS]);
      expect(listed(await checkDefinition("decisions", "decisions_match_answer_reason"))).toEqual([...MATCH_ANSWER_REASONS]);
      // The database's two closed lists of pairs are the adapters' own, pair for pair, and nothing else answers true.
      const pairs = (record: Readonly<Record<string, readonly string[]>>) => Object.entries(record).flatMap(([source, classes]) => classes.map((classification) => [source, classification] as const));
      for (const [source, classification] of pairs(MATCH_LISTED)) {
        expect((await apiDb.execute<{ yes: boolean }>(sql`select public.match_listed(${source}, ${classification}) as yes`))[0]!.yes, classification).toBe(true);
      }
      for (const [source, classification] of pairs(MATCH_ACTING)) {
        expect((await apiDb.execute<{ yes: boolean }>(sql`select public.match_acting(${source}, ${classification}) as yes`))[0]!.yes, classification).toBe(true);
      }
      for (const [source, classification] of [["test", "test_unlisted"], ["other", "test_listed"], ["test", "TEST_LISTED"]] as const) {
        const [row] = await apiDb.execute<{ listed: boolean; acting: boolean }>(sql`select public.match_listed(${source}, ${classification}) as listed, public.match_acting(${source}, ${classification}) as acting`);
        expect(row, `${source} ${classification}`).toEqual({ listed: false, acting: false });
      }
      const all = await functions();
      const pub = ["search_path=public, pg_temp"];
      // [definer, EXECUTE for the API role]: the triggers fire for every role and nobody calls them; the API's role calls the
      // two lists, the end of a hold, the release and its facts.
      const expected: Record<string, [boolean, boolean]> = {
        match_listed: [false, true],
        match_acting: [false, true],
        media_matches_insert: [false, false],
        media_matches_guard: [false, false],
        upload_refusals_insert: [true, false],
        upload_refusals_hold: [true, false],
        upload_refusals_guard: [false, false],
        post_media_refused: [true, false],
        upload_hold_end: [true, true],
        upload_refusals_confirmed: [true, false],
        upload_release_facts: [true, true],
        upload_release: [true, true],
        upload_release_replay: [true, false],
        upload_hold_replay: [true, false],
      };
      for (const [name, [definer, api]] of Object.entries(expected)) {
        const f = all.find((found) => found.name === `public.${name}`)!;
        expect({ name, owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }).toEqual({ name, owner: "korbat_migrate", definer, config: pub, api, auth: false, pub: false });
      }
    });

    test("3d Task 8 (0040_signals_and_retention; design, sections 6.8 and 6.9): case_flag and erase_automation_records are the migrator's definers that the API's role alone may call; the flag is STABLE and named by nothing in the database but itself; the erasure reads its days from automation_rules(), holds no interval literal and writes none of the proof of a release; and no function 3d created holds an interval literal", async () => {
      const all = await functions();
      for (const name of ["public.case_flag", "public.erase_automation_records"]) {
        const f = all.find((found) => found.name === name)!;
        expect({ owner: f.owner, definer: f.definer, config: f.config, api: f.api, auth: f.auth, pub: f.pub }, name).toEqual({ owner: "korbat_migrate", definer: true, config: ["search_path=public, pg_temp"], api: true, auth: false, pub: false });
      }
      const [volatility] = await apiDb.execute<{ v: string }>(sql`select provolatile as v from pg_proc where oid = 'public.case_flag(uuid)'::regprocedure`);
      expect(volatility!.v).toBe("s");
      // No function, view, trigger, constraint, index or policy names the flag but the function itself: no decision reads it.
      expect(all.filter((f) => f.name !== "public.case_flag" && /case_flag/.test(f.definition)).map((f) => f.name)).toEqual([]);
      expect((await otherDefinitions()).filter((d) => /case_flag/.test(d.definition)).map((d) => `${d.kind} ${d.name}`)).toEqual([]);
      const erase = all.find((found) => found.name === "public.erase_automation_records")!.definition;
      expect(erase).toMatch(/FROM public[.]automation_rules[(][)]/);
      expect(erase).toMatch(/match_keep_days/);
      expect(erase).not.toMatch(/interval '/i);
      expect(erase).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM) public[.](releases|release_posts|release_leaves|release_notices|quarantine_files)[ (]/i);
      // Every function the migrations of 3d create (0033 to 0040, and the review's 0041), as distinct from the ones they
      // replace, reads its numbers from its rule function: none holds an interval literal.
      const migrations = path.resolve(__dirname, "../../../../packages/db/migrations");
      const created = ["0033_quarantine", "0034_release", "0035_edge_purges", "0036_transparency", "0037_head_publications", "0038_automated_decisions", "0039_known_material", "0040_signals_and_retention", "0041_review"].flatMap((tag) =>
        [...readFileSync(path.join(migrations, `${tag}.sql`), "utf8").matchAll(/CREATE FUNCTION "public"."([a-z_0-9]+)"/g)].map((m) => `public.${m[1]}`),
      );
      expect(created).toEqual(expect.arrayContaining(["public.case_flag", "public.erase_automation_records", "public.automation_rules", "public.upload_refused_replay", "public.upload_refusals_logged", "public.post_media_lost_told"]));
      // 3d review: every function 0041_review and (Task 10) 0042_review_words replace keeps holding none either.
      const replacedBy = (tag: string) => [...readFileSync(path.join(migrations, `${tag}.sql`), "utf8").matchAll(/CREATE OR REPLACE FUNCTION "public"."([a-z_0-9]+)"/g)].map((m) => `public.${m[1]}`);
      expect(replacedBy("0042_review_words")).toEqual(["public.upload_refusals_guard", "public.transparency_figures"]);
      const replaced = [...replacedBy("0041_review"), ...replacedBy("0042_review_words")];
      expect(replaced.length).toBeGreaterThanOrEqual(12);
      for (const name of replaced) expect(all.find((f) => f.name === name)?.definition, name).not.toMatch(/interval '/i);
      for (const name of created) expect(all.find((f) => f.name === name)?.definition, name).not.toMatch(/interval '/i);
    });

    test("3f Task 5's writers (0030_authority_records; design, section 6.7): only report_open and report_close_unsealed write a hold and a notification record, erase_authority_records deletes them, and none holds a number of order_rules()", async () => {
      const all = await functions();
      const writing = (pattern: RegExp) => all.filter((f) => pattern.test(f.definition)).map((f) => f.name);
      // 3d Task 7 (0039_known_material): a refusal holds its uploader's address as a seal does, and an end of its hold
      // releases it or holds it again.
      expect(writing(/(UPDATE|INSERT INTO) auth[.]report_holds/i)).toEqual(["public.report_close_unsealed", "public.report_open", "public.upload_hold_end", "public.upload_refusals_hold"]);
      expect(writing(/(UPDATE|INSERT INTO) public[.]authority_notifications /i)).toEqual(["public.report_close_unsealed", "public.report_open"]);
      expect(writing(/DELETE FROM (auth[.]report_holds|public[.]authority_notifications|public[.]productions)/i)).toEqual(["public.erase_authority_records"]);
      // report_close_unsealed has its two callers: the final decision that answered a suspect item, and an unseal_media row.
      expect(writing(/report_close_unsealed[(]/).filter((name) => name !== "public.report_close_unsealed")).toEqual(["public.decisions_apply", "public.report_open"]);
      const fns = ["public.report_open", "public.report_close_unsealed", "public.reports_owed", "public.seal_report", "public.erase_authority_records", "public.authority_records_times", "auth.address_held_until", "auth.address_held", "auth.address_hold_final",
        // 3f's review (0032_orders_review): whether the person was told of every seal behind a held address.
        "auth.address_hold_told"];
      for (const name of fns) {
        const f = all.find((found) => found.name === name)!;
        expect([f.owner, f.definer, f.config, f.pub], name).toEqual(["korbat_migrate", true, ["search_path=public, pg_temp"], false]);
        expect(f.definition, name).not.toMatch(/interval '/i);
      }
      // seal_report is executable by nobody yet (3d's release will call it), report_close_unsealed by nobody, the auth
      // module's three reads, and the fourth of 3f's review, by korbat_auth alone.
      for (const name of ["public.seal_report", "public.report_close_unsealed", "public.report_open"]) {
        const f = all.find((found) => found.name === name)!;
        expect([f.api, f.auth], name).toEqual([false, false]);
      }
      for (const name of ["auth.address_held_until", "auth.address_held", "auth.address_hold_final", "auth.address_hold_told"]) {
        const f = all.find((found) => found.name === name)!;
        expect([f.api, f.auth], name).toEqual([false, true]);
      }
      // The trigger fires after decision_actions_apply, by name, on every insert of a ledger row.
      const [trigger] = await apiDb.execute<{ definition: string }>(sql`select pg_get_triggerdef(t.oid) as definition from pg_trigger t where t.tgname = 'decision_actions_report'`);
      expect(trigger!.definition).toMatch(/AFTER INSERT ON public[.]decision_actions FOR EACH ROW EXECUTE FUNCTION (public[.])?report_open[(][)]/);
      expect("decision_actions_apply" < "decision_actions_report").toBe(true);
    });

    test("3f Task 6's writers (0031_recovery; design, sections 6.6 and 6.7): only gap_close and delete_restore_gaps write a gap, a not-needed closing is held to its audit row at commit, a mark's time is forced, and an imported order's old events pass", async () => {
      const all = await functions();
      const writing = (pattern: RegExp) => all.filter((f) => pattern.test(f.definition)).map((f) => f.name);
      // 3d Task 2 (0034_release; design, section 6.2): the replay of a release closes its gap, as the migrator.
      // 3d Task 7 (0039_known_material): an admin's new end of a hold closes its gap, and so do the two replays of a held upload.
      expect(writing(/(UPDATE|INSERT INTO|DELETE FROM) public[.]restore_gaps/i)).toEqual([
        "public.delete_restore_gaps",
        "public.gap_close",
        "public.release_replay",
        "public.upload_hold_end",
        "public.upload_hold_replay",
        "public.upload_release_replay",
      ]);
      expect(writing(/DELETE FROM public[.]copy_marks/i)).toEqual(["public.delete_restore_gaps"]);
      // gap_close is called by the routes alone, never by another function: a decision closes a gap in the API's transaction.
      expect(writing(/gap_close[(]/).filter((name) => name !== "public.gap_close")).toEqual([]);
      for (const name of ["public.gap_close", "public.restore_gaps_confirmed", "public.delete_restore_gaps"]) {
        const f = all.find((found) => found.name === name)!;
        expect([f.owner, f.definer, f.config, f.pub], name).toEqual(["korbat_migrate", true, ["search_path=public, pg_temp"], false]);
        expect(f.definition, name).not.toMatch(/interval '/i);
      }
      const insert = all.find((found) => found.name === "public.copy_marks_insert")!;
      expect([insert.definer, insert.api, insert.pub]).toEqual([false, false, false]);
      expect(insert.definition).toMatch(/NEW[.]at := clock_timestamp[(][)]/);
      expect([all.find((f) => f.name === "public.restore_gaps_confirmed")!.api, all.find((f) => f.name === "public.gap_close")!.api]).toEqual([false, true]);
      const triggers = await apiDb.execute<{ definition: string }>(
        sql`select pg_get_triggerdef(t.oid) as definition from pg_trigger t where t.tgname in ('restore_gaps_confirmed', 'copy_marks_insert') order by t.tgname`,
      );
      expect(triggers.map((t) => t.definition.replace(/ EXECUTE FUNCTION .*$/, ""))).toEqual([
        "CREATE TRIGGER copy_marks_insert BEFORE INSERT ON public.copy_marks FOR EACH ROW",
        "CREATE CONSTRAINT TRIGGER restore_gaps_confirmed AFTER UPDATE ON public.restore_gaps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.disposition = 'not_needed'::text) AND (old.disposition IS DISTINCT FROM 'not_needed'::text)))",
      ]);
      // legal_order_events_confirmed, replaced from 0028's text, returns for an imported order's event dated before its import.
      expect(all.find((f) => f.name === "public.legal_order_events_confirmed")!.definition).toMatch(/o[.]imported_at IS NOT NULL AND NEW[.]at < o[.]imported_at/);
    });

    test("measures_in_force runs with its reader's rights and names exactly the contracts' measures", async () => {
      const [view] = await apiDb.execute<{ options: string[] | null; definition: string }>(sql`select c.reloptions as options, pg_get_viewdef(c.oid) as definition from pg_class c where c.oid = 'public.measures_in_force'::regclass`);
      expect(view!.options).toEqual(["security_invoker=true"]);
      const measures = ACTION_KINDS.filter((kind) => MEASURES[kind].lifts === null);
      // 3e: the view names its kinds as text (enum-literals.test.ts: a value 3e added cannot be an enum literal in the
      // migration that adds it), and the seal's own literal as the enum; both forms are read.
      const named = [...view!.definition.matchAll(/'([a-z_]+)'::(?:action_kind|text)/g)].map((m) => m[1]);
      expect([...new Set(named)].sort()).toEqual([...measures].sort());
      // No value of post_state: a migration that adds one cannot change what "in force" means.
      expect(view!.definition).not.toMatch(/post_state/);
      const columns = await apiDb.execute<{ name: string }>(sql`select attname::text as name from pg_attribute where attrelid = 'public.measures_in_force'::regclass and attnum > 0 order by attnum`);
      expect(columns.map((c) => c.name)).toEqual(["id", "kind", "post_id", "media_id", "subject_account_id", "decision_id", "decision_kind", "case_id"]);
    });
  });

  describe("each CHECK written from a contracts constant holds exactly that constant's values", () => {
    /** The quoted values of one CHECK, as the migrated database defines it. */
    const checkValues = async (table: string, name: string) => [...(await checkDefinition(table, name)).matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
    /** The one number of a length CHECK. */
    async function checkBound(table: string, name: string): Promise<number> {
      const definition = await checkDefinition(table, name);
      const numbers = [...definition.matchAll(/<= (\d+)/g)].map((m) => Number(m[1]));
      expect(numbers, definition).toHaveLength(1);
      return numbers[0]!;
    }

    test("the 16 Transparency Database categories, on intakes and on decisions", async () => {
      expect(await checkValues("intakes", "intakes_category")).toEqual([...TDB_CATEGORIES].sort());
      expect(await checkValues("decisions", "decisions_category")).toEqual([...TDB_CATEGORIES].sort());
    });

    test("the CSAM path's keywords on intakes, and a decision's keywords", async () => {
      const keywords = Object.values(CSAM_KEYWORDS).filter((keyword): keyword is NonNullable<typeof keyword> => keyword !== null);
      expect(await checkValues("intakes", "intakes_category_keyword")).toEqual([...keywords].sort());
      expect(await checkValues("decisions", "decisions_category_keyword")).toEqual([...DECISION_KEYWORDS].sort());
    });

    test("the six rules, on intakes and on decisions", async () => {
      expect(await checkValues("intakes", "intakes_rule_id")).toEqual([...RULE_IDS]);
      expect(await checkValues("decisions", "decisions_rule_id")).toEqual([...RULE_IDS]);
    });

    test("the bounds of a notice's two texts", async () => {
      expect(await checkBound("intakes", "intakes_explanation_len")).toBe(NOTICE_LIMITS.explanationMax);
      expect(await checkBound("intakes", "intakes_cited_law_len")).toBe(NOTICE_LIMITS.citedLawMax);
    });

    test("the ledger's kinds are the contracts' action kinds, in their order, the two of an order's measure last", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.action_kind'::regtype order by e.enumsortorder`);
      // 3f: the migration orders adds them; they joined ACTION_KINDS with the task that gives effect to an order (Task 3).
      expect(rows.map((row) => row.label)).toEqual([...ACTION_KINDS]);
      expect(ACTION_KINDS.slice(-2)).toEqual([...ORDER_ACTION_KINDS]);
    });

    test("post_state has its four values and 3f's disabled: a seal is a state of images, a disabling one of posts", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.post_state'::regtype order by e.enumsortorder`);
      expect(rows.map((row) => row.label)).toEqual(["visible", "withheld", "removed", "deleted_by_author", "disabled"]);
    });

    test("no check lets a row through on a null: the database holds the null-safe forms", async () => {
      // A CHECK passes when its expression is null. These five are written so that it never is. PostgreSQL stores
      // "is not distinct from" as the negation of "is distinct from" and prints it that way.
      expect(await checkDefinition("intake_items", "intake_items_case")).toContain("(NOT (outcome IS DISTINCT FROM 'not_available'::item_outcome))");
      expect(await checkDefinition("decisions", "decisions_keyword")).toContain("(NOT (ground IS DISTINCT FROM 'illegal'::decision_ground))");
      expect(await checkDefinition("intake_items", "intake_items_statement")).toContain("statement_digest IS NOT NULL");
      expect(await checkDefinition("appeals", "appeals_statement")).toContain("statement_digest IS NOT NULL");
      expect(await checkDefinition("staff_texts", "staff_texts_digest")).toContain("salt ~ '^[0-9a-f]{64}$'");
    });
  });

  describe("appeal_deadline", () => {
    test("it equals the contracts' appealDeadline on every month end of two years, a leap year among them, and on the days around them", async () => {
      // The last three days of each month of 2027 and 2028 (2028 has a 29 February) and the first of the next, at three times of day.
      // Both times as the text toISOString writes, so that nothing depends on how the driver reads a timestamp.
      const rows = await apiDb.execute<{ informed: string; deadline: string }>(sql`
        select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as informed, to_char(public.appeal_deadline(t) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deadline
          from generate_series('2027-01-01'::timestamp, '2028-12-01'::timestamp, interval '1 month') month,
               generate_series(-3, 0) shift,
               unnest(array[interval '0 hours', interval '12 hours 30 minutes 15.25 seconds', interval '23 hours 59 minutes 59.999 seconds']) time_of_day,
               lateral (select (month + interval '1 month' + make_interval(days => shift) + time_of_day) at time zone 'UTC' as t) s
         order by 1`);
      expect(rows).toHaveLength(24 * 4 * 3);
      for (const row of rows) expect(appealDeadline(new Date(row.informed)).toISOString(), row.informed).toBe(row.deadline);
      // The set really holds the clamp: 31 August 2027 is due on the leap day.
      const august = rows.find((row) => row.informed === "2027-08-31T00:00:00.000Z");
      expect(august?.deadline).toBe("2028-02-29T00:00:00.000Z");
    });

    test("it does not depend on the session's time zone", async () => {
      const deadlines = await withLockTimeout(apiDb, async (tx) => {
        const read = async () =>
          (await tx.execute<{ d: string }>(sql`select to_char(public.appeal_deadline('2027-08-30T23:30:00Z'::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as d`))[0]!.d;
        // 30 August, 23:30 UTC, is already the 31st at +14 and still the 30th at -7: a deadline computed in the session's zone
        // would differ between the two, and from UTC's 29 February.
        await tx.execute(sql`set local time zone 'Pacific/Kiritimati'`);
        const east = await read();
        await tx.execute(sql`set local time zone 'America/Los_Angeles'`);
        return [east, await read()];
      });
      expect(deadlines).toEqual(["2028-02-29T23:30:00.000Z", "2028-02-29T23:30:00.000Z"]);
    });
  });

  describe("the forced columns ignore what an insert supplies", () => {
    test("a case starts open, in lane 2, at number 0, whatever the insert said, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const targetId = randomUUID();
          const [row] = await tx.execute<Record<string, unknown>>(sql`
            insert into cases (target_type, target_id, opened_at, lane, intake_seq, answered_seq, state_version, oldest_open_at, last_decided_at, closed_at)
            values ('post', ${targetId}::uuid, '2001-01-01T00:00:00Z', 0, 7, 7, 9, '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
            returning *, (opened_at = now()) as opened_now`);
          expect(row).toMatchObject({ target_type: "post", target_id: targetId, lane: 2, intake_seq: 0, answered_seq: 0, state_version: 0, oldest_open_at: null, last_decided_at: null, closed_at: null, opened_now: true });
        });
      }
    });

    test("an intake's times and receipt: pending for a contact, or for a signed-in reporter alleging illegality, else none", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const insert = (input: IntakeInput) =>
          tx.execute<{ receipt: string; receipt_sent_at: string | null; erased_at: string | null; now: boolean }>(sql`
            insert into intakes (kind, ref, lookup_hash, channel, reporter_id, contact_id, rule_id, alleges_illegal, csam, category, explanation, bona_fide, received_at, receipt, receipt_sent_at, erased_at)
            values ('user', ${newRef()}, ${input.lookupHash ?? null}, ${input.channel ?? "signed_in"}::intake_channel, ${input.reporterId ?? null}::uuid, ${input.contactId ?? null}::uuid, ${input.ruleId ?? null},
                    ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${input.explanation ?? null}, ${input.bonaFide ?? false},
                    '2001-01-01T00:00:00Z', 'sent', '2001-01-01T00:00:00Z', null)
            returning receipt, receipt_sent_at, erased_at, (received_at = now()) as now`);
        const cases: [string, IntakeInput, string][] = [
          ["a rule report", { reporterId: ada.id, ruleId: "R1" }, "none"],
          ["a signed-in notice of illegality", { reporterId: ada.id, allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true }, "pending"],
          ["a signed-out notice with a contact", { channel: "signed_out", contactId: randomUUID(), lookupHash: hex64(), allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true }, "pending"],
          ["a signed-out rule report without a contact", { channel: "signed_out", lookupHash: hex64(), ruleId: "R3" }, "none"],
          ["a CSAM notice", { channel: "signed_out", lookupHash: hex64(), csam: true, allegesIllegal: true, category: MINORS }, "none"],
        ];
        for (const [label, input, receipt] of cases) {
          const [row] = await insert(input);
          expect(row, label).toEqual({ receipt, receipt_sent_at: null, erased_at: null, now: true });
        }
      });
    });

    test("a staff text is born unconfirmed, and a snapshot is taken at the transaction's start, to the millisecond", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const caseId = await openCase(tx, "post", postId);
        const salt = hex64();
        const [text] = await tx.execute<Record<string, unknown>>(sql`
          insert into staff_texts (case_id, author_id, kind, text, salt, digest, created_at, decision_id, confirmed_at)
          values (${caseId}::uuid, ${ada.id}::uuid, 'note', 'a note', ${salt}, ${await textDigest(salt, "a note")}, '2001-01-01T00:00:00Z', null, '2001-01-01T00:00:00Z')
          returning decision_id, confirmed_at, (created_at = now()) as now`);
        expect(text).toEqual({ decision_id: null, confirmed_at: null, now: true });

        const [snapshot] = await tx.execute<Record<string, unknown>>(sql`
          insert into evidence_snapshots (case_id, target_type, target_id, taken_at, author_handle, body, salt, digest)
          values (${caseId}::uuid, 'post', ${postId}::uuid, '2001-01-01T00:00:00.123456Z', ${ada.handle}, 'a post', ${hex64()}, ${hex64()})
          returning (taken_at = date_trunc('milliseconds', now())) as at_start, (taken_at = date_trunc('milliseconds', taken_at)) as whole_ms`);
        expect(snapshot).toEqual({ at_start: true, whole_ms: true });

        const [access] = await tx.execute<Record<string, unknown>>(sql`
          insert into case_access_log (staff_id, case_id, kind, at) values (${ada.id}::uuid, ${caseId}::uuid, 'case_opened', '2001-01-01T00:00:00Z') returning (at = now()) as now`);
        expect(access).toEqual({ now: true });
      });
    });

    test("an image row is born visible, unheld and unerased, for the API role and for the migrator", async () => {
      for (const db of [apiDb, migrateDb]) {
        await rolledBack(db, async (tx) => {
          const ada = await profile(tx);
          const [row] = await tx.execute<Record<string, unknown>>(
            sql`insert into post_media (owner_id, status, moderation_state, hold_until, erased_at) values (${ada.id}::uuid, 'processing', 'sealed', 'infinity', now()) returning moderation_state, hold_until, erased_at`,
          );
          expect(row).toEqual({ moderation_state: "visible", hold_until: null, erased_at: null });
        });
      }
    });

    test("a hold is born unreleased, held from the transaction's start", async () => {
      await rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const postId = await newPostRow(tx, ada.id);
        const mediaId = await newImageRow(tx, ada.id, postId);
        const caseId = await openCase(tx, "post", postId);
        const [hold] = await tx.execute<Record<string, unknown>>(sql`
          insert into media_holds (media_id, case_id, held_at, released_at) values (${mediaId}::uuid, ${caseId}::uuid, '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z')
          returning released_at, (held_at = now()) as now`);
        expect(hold).toEqual({ released_at: null, now: true });
      });
    });
  });

  describe("the checks of intakes", () => {
    /** One test's intakes, all in a transaction that is rolled back: each insert in a savepoint, its refusal's message or null. */
    const intakes = (fn: (refusal: (input: IntakeInput) => Promise<string | null>, ada: { id: string }) => Promise<void>) =>
      rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        await fn(async (input) => (await within(tx, (sp) => insertIntake(sp, input)))?.message ?? null, ada);
      });

    test("a ground is needed: a rule, an allegation of illegality or the CSAM path", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id })).toMatch(/intakes_has_ground/);
        expect(await refusal({ reporterId: ada.id, ruleId: "R7" })).toMatch(/intakes_rule_id/);
        expect(await refusal({ reporterId: ada.id, ruleId: "R1" })).toBeNull();
      });
    });

    test("a notice of illegality carries its explanation and its good-faith statement; the CSAM path needs neither", async () => {
      await intakes(async (refusal, ada) => {
        const illegal = { reporterId: ada.id, allegesIllegal: true, category: SPEECH };
        expect(await refusal({ ...illegal })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, explanation: "why" })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, bonaFide: true })).toMatch(/intakes_illegal_elements/);
        expect(await refusal({ ...illegal, explanation: "why", bonaFide: true })).toBeNull();
        // A CSAM intake alleges illegality with neither, and with no keyword (the "abuse" choice) or one of the three.
        const csam = { channel: "signed_out" as const, csam: true, allegesIllegal: true, category: MINORS };
        expect(await refusal({ ...csam, lookupHash: hex64() })).toBeNull();
        expect(await refusal({ ...csam, lookupHash: hex64(), categoryKeyword: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS" })).toBeNull();
        expect(await refusal({ ...csam, lookupHash: hex64(), categoryKeyword: "KEYWORD_TERRORIST_CONTENT" })).toMatch(/intakes_category_keyword/);
      });
    });

    test("the CSAM path stores no account and no contact, and is always about the protection of minors", async () => {
      await intakes(async (refusal, ada) => {
        const csam = { csam: true, allegesIllegal: true, category: MINORS };
        expect(await refusal({ ...csam, channel: "signed_in", reporterId: ada.id, lookupHash: hex64() })).toMatch(/intakes_csam/);
        expect(await refusal({ ...csam, channel: "signed_out", contactId: randomUUID(), lookupHash: hex64() })).toMatch(/intakes_csam/);
        expect(await refusal({ ...csam, channel: "signed_out", category: SPEECH, lookupHash: hex64() })).toMatch(/intakes_csam/);
        // Signed in, it still stores no account: the channel is kept, the reporter is not, and the token's hash is needed.
        expect(await refusal({ ...csam, channel: "signed_in", lookupHash: hex64() })).toBeNull();
        expect(await refusal({ ...csam, channel: "signed_in" })).toMatch(/intakes_lookup/);
      });
    });

    test("a user never reports under R2, signed in or out; a moderator's finding may cite it", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id, ruleId: "R2" })).toMatch(/intakes_r2_finding_only/);
        expect(await refusal({ channel: "signed_out", lookupHash: hex64(), ruleId: "R2" })).toMatch(/intakes_r2_finding_only/);
        expect(await refusal({ kind: "finding", channel: "staff", findingBy: ada.id, ruleId: "R2", category: MINORS })).toBeNull();
      });
    });

    test("a finding names its finder, comes through the staff channel and never alleges illegality", async () => {
      await intakes(async (refusal, ada) => {
        const finding = { kind: "finding" as const, channel: "staff" as const, findingBy: ada.id, ruleId: "R3" };
        expect(await refusal(finding)).toBeNull();
        expect(await refusal({ ...finding, allegesIllegal: true, category: SPEECH, explanation: "why", bonaFide: true })).toMatch(/intakes_finding_legal/);
        expect(await refusal({ ...finding, findingBy: null })).toMatch(/intakes_finding/);
        expect(await refusal({ ...finding, channel: "signed_in" })).toMatch(/intakes_finding/);
        expect(await refusal({ kind: "user", channel: "staff", ruleId: "R3" })).toMatch(/intakes_finding/);
        expect(await refusal({ kind: "user", channel: "signed_in", findingBy: ada.id, ruleId: "R3" })).toMatch(/intakes_finding/);
      });
    });

    test("a contact belongs to a signed-out notice, a reporter to a signed-in one, and a token's hash to a signed-out or CSAM one", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ channel: "signed_in", reporterId: ada.id, contactId: randomUUID(), ruleId: "R1" })).toMatch(/intakes_contact_signed_out/);
        expect(await refusal({ channel: "signed_out", reporterId: ada.id, lookupHash: hex64(), ruleId: "R1" })).toMatch(/intakes_reporter_signed_in/);
        expect(await refusal({ channel: "signed_out", ruleId: "R1" })).toMatch(/intakes_lookup/);
        expect(await refusal({ channel: "signed_in", reporterId: ada.id, lookupHash: hex64(), ruleId: "R1" })).toMatch(/intakes_lookup/);
        const hash = hex64();
        expect(await refusal({ channel: "signed_out", lookupHash: hash, ruleId: "R1" })).toBeNull();
        expect(await refusal({ channel: "signed_out", lookupHash: hash, ruleId: "R1" })).toMatch(/intakes_lookup_hash_unique/);
      });
    });

    test("the category is one of the 16, never the terms-and-conditions one on an allegation of illegality; the texts are bounded; the reference has its form", async () => {
      await intakes(async (refusal, ada) => {
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", category: "STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT" })).toMatch(/intakes_category/);
        expect(await refusal({ reporterId: ada.id, allegesIllegal: true, category: TC, explanation: "why", bonaFide: true })).toMatch(/intakes_illegal_not_tc/);
        const illegal = { reporterId: ada.id, allegesIllegal: true, category: SPEECH, bonaFide: true };
        expect(await refusal({ ...illegal, explanation: "x".repeat(2000), citedLaw: "y".repeat(300) })).toBeNull();
        expect(await refusal({ ...illegal, explanation: "x".repeat(2001) })).toMatch(/intakes_explanation_len/);
        expect(await refusal({ ...illegal, explanation: "why", citedLaw: "y".repeat(301) })).toMatch(/intakes_cited_law_len/);
        for (const ref of ["N-ABCDEFGH2", "n-ABCDEFGHJ2", "N-abcdefghj2", "N-ABCDEFGH01", "N-ABCDEFGHJ23", "X-ABCDEFGHJ2"]) expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref }), ref).toMatch(/intakes_ref/);
        const ref = newRef();
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref })).toBeNull();
        expect(await refusal({ reporterId: ada.id, ruleId: "R1", ref })).toMatch(/intakes_ref_unique/);
      });
    });
  });

  describe("the staff_texts CHECK", () => {
    type Save = (text: string | null, salt: string | null, digest: string, erased?: boolean) => Promise<{ message: string; code: string } | null>;
    /** One test's texts on a case of their own, in a transaction that is rolled back; each insert in a savepoint. */
    const texts = (fn: (save: Save, tx: DbTx) => Promise<void>) =>
      rolledBack(apiDb, async (tx) => {
        const ada = await profile(tx);
        const caseId = await openCase(tx, "post", await newPostRow(tx, ada.id));
        const save: Save = (text, salt, digest, erased = false) =>
          run(tx, sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest, erased_at) values (${caseId}::uuid, ${ada.id}::uuid, 'facts', ${text}, ${salt}, ${digest}, ${erased ? sql`now()` : sql`null`})`);
        await fn(save, tx);
      });

    test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: SQL computes the digest the contracts' textDigest computes", async (_name, vector) => {
      expect(await sqlDigest(apiDb, vector.salt, vector.text)).toBe(vector.digest);
    });

    test("a text is stored with the digest the contracts compute for its salt and itself, and with no other", async () => {
      await texts(async (save) => {
        // Fresh salts: a digest names one text, so a vector's own digest could be stored only once.
        for (const vector of TEXT_DIGEST_VECTORS) {
          const salt = hex64();
          const digest = await textDigest(salt, vector.text);
          expect(await save(vector.text, salt, digest), vector.name).toBeNull();
          // The same text under the digest of another salt, or of another text, is refused.
          expect((await save(vector.text, hex64(), digest))?.message, vector.name).toMatch(/staff_texts_digest/);
          expect((await save(`${vector.text}.`, salt, digest))?.message, vector.name).toMatch(/staff_texts_digest/);
        }
      });
    });

    test("a digest names one text; a text has a salt; only an erased row has neither", async () => {
      await texts(async (save) => {
        const salt = hex64();
        const digest = await textDigest(salt, "a text");
        expect(await save("a text", salt, digest)).toBeNull();
        expect((await save("a text", salt, digest))?.message).toMatch(/staff_texts_digest_unique/);
        expect((await save("a text", null, hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save(null, hex64(), hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save(null, null, hex64()))?.message).toMatch(/staff_texts_digest/);
        expect((await save("a text", hex64(), hex64(), true))?.message).toMatch(/staff_texts_digest/);
        // The erased form: text and salt gone, the digest kept.
        expect(await save(null, null, hex64(), true)).toBeNull();
      });
    });

    test("the salt is 32 bytes as lower-case hex: an empty, a short or an upper-case salt is refused, also with the digest it gives", async () => {
      await texts(async (save, tx) => {
        const salt = hex64();
        // hex decodes either case to the same bytes, so the upper-case spelling has the lower-case salt's digest.
        const upper = salt.toUpperCase();
        expect(await sqlDigest(tx, upper, "a text")).toBe(await textDigest(salt, "a text"));
        for (const malformed of ["", salt.slice(2), upper, `${salt}00`]) {
          const err = await save("a text", malformed, await sqlDigest(tx, malformed, "a text"));
          expect(err, JSON.stringify(malformed)).toMatchObject({ code: "23514", message: expect.stringMatching(/staff_texts_digest/) });
        }
        expect(await save("a text", salt, await textDigest(salt, "a text"))).toBeNull();
      });
    });

    test("a text longer than 5000 characters is refused whatever its digest", async () => {
      await texts(async (save, tx) => {
        const salt = hex64();
        const long = "x".repeat(5001);
        expect((await save(long, salt, await sqlDigest(tx, salt, long)))?.message).toMatch(/staff_texts_text_len/);
      });
    });
  });

  test("a decision's keyword needs the ground of the law: on a decision without a ground, or on a rule, it is refused", async () => {
    // The decision is a real one, on a reported post; the migrator then changes its row, the only role that can, in a
    // transaction that is rolled back.
    await rolledBack(migrateDb, async (tx) => {
      await staffProfile(tx, mod);
      const { postId } = await imagePost(tx);
      const { caseId } = await report(tx, aPost(postId));
      const decisionId = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
      const keyword = DECISION_KEYWORDS[0];
      const set = (changes: ReturnType<typeof sql>) => run(tx, sql`update decisions set ${changes} where id = ${decisionId}::uuid`);
      const refused = { code: "23514", message: expect.stringMatching(/decisions_keyword/) };
      // A null ground is the row a plain comparison let through: its result is null, and a check passes on a null.
      expect(await set(sql`category_keyword = ${keyword}`)).toMatchObject(refused);
      expect(await set(sql`category_keyword = ${keyword}, ground = 'incompatible', rule_id = 'R1'`)).toMatchObject(refused);
      expect(await set(sql`category_keyword = ${keyword}, ground = 'illegal', legal_reference_digest = ${hex64()}`)).toBeNull();
    });
  });

  test("the limits' row is the migration's: 60 decisions an hour and 300 a day, 400 case opens, 50 findings and 10 reveals a day", async () => {
    // The suite's setup leaves this table alone, so the row read here is the one migration 0015 inserted.
    const rows = await apiDb.execute<Record<string, unknown>>(sql`select id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day from moderation_limits`);
    expect(rows.map((row) => ({ ...row }))).toEqual([{ id: 1, decisions_per_hour: 60, decisions_per_day: 300, case_opens_per_day: 400, findings_per_day: 50, reveals_per_day: 10 }]);
    await rolledBack(migrateDb, async (tx) => {
      const err = await run(tx, sql`insert into moderation_limits (id, decisions_per_hour, decisions_per_day, case_opens_per_day, findings_per_day, reveals_per_day, updated_at) values (2, 1, 1, 1, 1, 1, now())`);
      expect(err?.message).toMatch(/moderation_limits_single_row/);
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
