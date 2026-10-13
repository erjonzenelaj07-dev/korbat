import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import type { SocialDeps } from "../../src/social/context";
import { explorePage, exploreStatus, setShowInExplore } from "../../src/social/flows/explore";
import { getPost } from "../../src/social/flows/posts";
import type { SocialRepo } from "../../src/social/repo";
import { HOUR, MINUTE, accounts, after, approvedPost, before, exploreDeps, listed, pageIds, rank, spans } from "./explore-fixtures";
import { closeDecisions, decideForTest, deciderWorld, leavesNoModerationRows, type DeciderWorld, type RealStaff } from "./moderation-decide";
import { act, liftRowForTest, suspendRowForTest, uuids } from "./moderation-fixtures";
import { newPost, newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// Several tests decide through real, confirmed decisions (a staff key's enrolment and sign-in once, then a step-up for
// each): on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 60_000 });

/**
 * This suite's past (see explore-fixtures.ts): its rankings are computed as of times in 2024, each test in a span of its
 * own, so no other suite's posts or engagement are candidates of its rounds. Decisions are made at the real clock, which
 * is where they write Explore's columns; a suspension that a round must meet is written around the round's time.
 */
const EPOCH = Date.UTC(2024, 0, 1);

/** A timestamptz expression as microseconds since the epoch, exactly, as text that BigInt reads; null stays null. The expression is written here, never input. */
const micros = (expression: string): SQL => sql.raw(`(extract(epoch from ${expression}) * 1000000)::bigint::text`);
const big = (value: string | null): bigint | null => (value === null ? null : BigInt(value));

/**
 * Explore under formula version 2 (3e design, sections 6.4 and 7.13; Task 6): invariant 3, that moderation_apply alone
 * writes a post's hidden_at, restored_at and explore_from; invariant 18, that a restored post's window and age resume by
 * exactly the time the ledger says it was hidden; invariant 19, that a suspended account is neither a candidate nor an
 * approver of a round, judged at the round's time, and that the page, the chip and the status judge it at the read's.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Explore under formula version 2 (3e)", () => {
  let apiDb: Db;
  let migrateDb: Db;
  let deps: SocialDeps;
  let repo: SocialRepo;
  let setNow: (at: Date) => void;
  const nextAsOf = spans(EPOCH);
  /** Posts whose Explore columns a test wrote as the migrator: cleared again at the end. */
  const written: string[] = [];
  /**
   * A staff world of this file's own, for a decision decideForTest does not make (a correction alone). Its decisions lie
   * in cases of posts decideForTest decided, which closeDecisions removes; its staff profile goes after them.
   */
  let world: DeciderWorld | null = null;
  let corrector: RealStaff | null = null;

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    ({ deps, repo, setNow } = exploreDeps(apiDb));
  });
  afterAll(async () => {
    try {
      await closeDecisions();
      await world?.close();
      if (written.length > 0) await migrateDb.execute(sql`update posts set hidden_at = null, restored_at = null, explore_from = null where id = any(${uuids(written)})`);
    } finally {
      await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
    }
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await apiDb.execute(sql`delete from explore_runs`);
  });

  /** Writes a suspension into the profile row as the migrator, as standing_apply derives one, from and until the times given (in this suite's past). */
  async function suspendAround(profileId: string, from: Date, until: Date): Promise<void> {
    await migrateDb.execute(sql`update profiles set suspended_from = ${from.toISOString()}::timestamptz, suspended_until = ${until.toISOString()}::timestamptz where id = ${profileId}::uuid`);
  }

  describe("invariant 3: only moderation_apply writes a post's hidden_at, restored_at and explore_from", () => {
    test("of every function the migrator owns, moderation_apply alone writes the three columns, in the statement that moves the level", async () => {
      const all = await migrateDb.execute<{ name: string; definition: string }>(sql`
        select p.pronamespace::regnamespace::text || '.' || p.proname as name, pg_get_functiondef(p.oid) as definition
          from pg_proc p where p.proowner = 'korbat_migrate'::regrole and p.prokind = 'f' order by 1`);
      // A statement that writes one of the columns of posts, as SQL may spell it (as moderation-schema.test.ts's pins read).
      const writes = /(update\s+(only\s+)?|merge\s+into\s+(only\s+)?|insert\s+into\s+)("?public"?\s*[.]\s*)?"?posts"?(?![\w"])[^;]*\bset\b[^;]*"?(hidden_at|restored_at|explore_from)"?\s*=/i;
      expect(all.filter((f) => writes.test(f.definition)).map((f) => f.name)).toEqual(["public.moderation_apply"]);
      // One statement sets the level and the three columns together, so the spans are those of the level.
      const together = /update\s+public[.]posts\s+p\s+set\s+moderation_level\s*=[^;]*hidden_at\s*=[^;]*restored_at\s*=[^;]*explore_from\s*=/i;
      expect(all.filter((f) => together.test(f.definition)).map((f) => f.name)).toEqual(["public.moderation_apply"]);
      // No function reads the clock for a post: the writer's times are now(), the deciding transaction's start.
      expect(all.find((f) => f.name === "public.moderation_apply")!.definition).not.toMatch(/clock_timestamp|statement_timestamp/);
    });

    test("the API role's UPDATE of each column is refused (42501), its INSERT's values are forced null, and the migrator's insert keeps them", async () => {
      const refused: Record<string, string | undefined> = {};
      for (const column of ["hidden_at", "restored_at", "explore_from"]) {
        await rolledBack(apiDb, async (tx) => {
          const author = await newProfile(tx as unknown as Db);
          const [post] = await tx.execute<{ id: string }>(sql`insert into posts (author_id, body) values (${author.id}::uuid, 'a post') returning id`);
          refused[column] = (await pgError(tx.transaction((sp) => sp.execute(sql`update posts set ${sql.raw(column)} = now() where id = ${post!.id}::uuid`))))?.code;
        });
      }
      expect(refused).toEqual({ hidden_at: "42501", restored_at: "42501", explore_from: "42501" });

      const insert = (author: string) => sql`
        insert into posts (author_id, body, hidden_at, restored_at, explore_from) values (${author}::uuid, 'supplied', now() - interval '2 hours', now() - interval '1 hour', now() - interval '30 minutes')
        returning hidden_at is null as hidden_null, restored_at is null as restored_null, explore_from is null as from_null`;
      const nulls: Record<string, unknown> = {};
      await rolledBack(apiDb, async (tx) => {
        const author = await newProfile(tx as unknown as Db);
        const [row] = await tx.execute<Record<string, boolean>>(insert(author.id));
        nulls.api = { ...row! };
      });
      await rolledBack(migrateDb, async (tx) => {
        const author = await newProfile(tx as unknown as Db);
        const [row] = await tx.execute<Record<string, boolean>>(insert(author.id));
        nulls.migrator = { ...row! };
      });
      expect(nulls).toEqual({
        api: { hidden_null: true, restored_null: true, from_null: true },
        migrator: { hidden_null: false, restored_null: false, from_null: false },
      });
    });
  });

  describe("invariant 18: a restored post's window and age resume by exactly the time the ledger says it was hidden", () => {
    /** The post's created_at and Explore columns, in microseconds. */
    async function columns(postId: string) {
      const [row] = await apiDb.execute<{ level: string; created: string; hidden: string | null; restored: string | null; from: string | null }>(sql`
        select moderation_level::text as level, ${micros("created_at")} as created, ${micros("hidden_at")} as hidden, ${micros("restored_at")} as restored, ${micros("explore_from")} as from
          from posts where id = ${postId}::uuid`);
      return { level: row!.level, created: BigInt(row!.created), hidden: big(row!.hidden), restored: big(row!.restored), from: big(row!.from) };
    }
    /** The post's measures and their reversals in the ledger, oldest first: each row's time is its transaction's start. */
    async function ledger(postId: string) {
      const rows = await apiDb.execute<{ id: string; kind: string; at: string; decision_id: string; case_id: string; reverses: string | null }>(sql`
        select x.id, x.kind::text as kind, ${micros("x.created_at")} as at, x.decision_id, d.case_id, x.reverses_action_id as reverses
          from decision_actions x join decisions d on d.id = x.decision_id
         where x.post_id = ${postId}::uuid and x.kind::text in ('withhold', 'remove', 'restore') order by x.created_at, x.id`);
      return rows.map((row) => ({ id: row.id, kind: row.kind, at: BigInt(row.at), decisionId: row.decision_id, caseId: row.case_id, reverses: row.reverses }));
    }
    /** When the case's final decision was taken: what ends an interim measure of that case. */
    async function closedAt(caseId: string): Promise<bigint> {
      const [row] = await apiDb.execute<{ at: string }>(sql`select ${micros("decided_at")} as at from decisions where case_id = ${caseId}::uuid and kind = 'final' order by decided_at limit 1`);
      return BigInt(row!.at);
    }

    test("over two hides and restores across two cases, explore_from - created_at equals the ledger's hidden spans to the microsecond", async () => {
      const asOf = nextAsOf();
      const [author] = await accounts(apiDb, asOf, 1);
      const id = await newPost(repo, author!.id, before(asOf, HOUR));
      expect(await columns(id)).toMatchObject({ level: "visible", hidden: null, restored: null, from: null });

      // First: case 1's interim withhold, ended by the final decision that closes case 1 finding no breach.
      await decideForTest(apiDb, id, "withheld");
      const [withhold] = await ledger(id);
      expect(withhold!.kind).toBe("withhold");
      expect(await columns(id)).toMatchObject({ level: "withheld", hidden: withhold!.at, restored: null, from: null });
      await decideForTest(apiDb, id, "visible");
      const closed = await closedAt(withhold!.caseId);
      const first = closed - withhold!.at;
      expect(first > 0n).toBe(true);
      let now = await columns(id);
      expect(now).toMatchObject({ level: "visible", hidden: withhold!.at, restored: closed });
      expect(now.from! - now.created).toBe(first);

      // Second: case 2's removal, reversed in full by a correction; the time already given back stays.
      await decideForTest(apiDb, id, "removed");
      const remove = (await ledger(id)).find((row) => row.kind === "remove")!;
      expect(remove.caseId).not.toBe(withhold!.caseId);
      now = await columns(id);
      expect(now).toMatchObject({ level: "removed", hidden: remove.at, restored: closed });
      expect(now.from! - now.created).toBe(first);
      await decideForTest(apiDb, id, "visible");
      const restore = (await ledger(id)).find((row) => row.kind === "restore")!;
      expect(restore.reverses).toBe(remove.id);
      now = await columns(id);
      expect(now).toMatchObject({ level: "visible", hidden: remove.at, restored: restore.at });
      expect(now.from! - now.created).toBe(first + (restore.at - remove.at));
    });

    test("a move between withheld and removed in one call of the writer changes none of the three: a removal reversed while another case's withhold stands", async () => {
      const asOf = nextAsOf();
      const [author] = await accounts(apiDb, asOf, 1);
      const id = await newPost(repo, author!.id, before(asOf, HOUR));
      // Case 1: a final removal (with the strike it gives), which closes case 1. Case 2: an interim withhold, which
      // changes no level while the removal stands.
      await decideForTest(apiDb, id, "removed");
      const removed = await columns(id);
      const remove = (await ledger(id)).find((row) => row.kind === "remove")!;
      expect(removed).toMatchObject({ level: "removed", hidden: remove.at, restored: null, from: null });
      await decideForTest(apiDb, id, "withheld");
      expect(await columns(id)).toEqual(removed);
      // A correction of case 1's removal alone, while case 2's withhold stands: the level moves from removed to withheld
      // in one call, and none of the three changes.
      world ??= deciderWorld(apiDb);
      corrector ??= await world.staff("admin");
      const outcome = await world.decideAs(corrector, remove.caseId, { kind: "correction", reviewsDecisionId: remove.decisionId, actions: [act("restore")] });
      expect(typeof outcome).not.toBe("string");
      expect(await columns(id)).toEqual({ ...removed, level: "withheld" });
      // Case 2 closes finding no breach: the post is shown again, given back the whole time since the removal, during
      // which one measure or the other kept it hidden.
      await decideForTest(apiDb, id, "visible");
      const withhold = (await ledger(id)).find((row) => row.kind === "withhold")!;
      const closed = await closedAt(withhold.caseId);
      const now = await columns(id);
      expect(now).toMatchObject({ level: "visible", hidden: remove.at, restored: closed });
      expect(now.from! - now.created).toBe(closed - remove.at);
    });

    test("a removal decided in the case whose interim withhold it ends passes the level through visible inside its own transaction: the spans still sum to the ledger's", async () => {
      const asOf = nextAsOf();
      const [author] = await accounts(apiDb, asOf, 1);
      const id = await newPost(repo, author!.id, before(asOf, HOUR));
      await decideForTest(apiDb, id, "withheld");
      const [withhold] = await ledger(id);
      // The removal joins case 1: its decision first closes the case, which ends the withhold (the level is visible for
      // that instant, which no other transaction sees), and then its removal hides the post again. Both are that
      // transaction's now(), so the span that ended and the one that starts meet at it.
      await decideForTest(apiDb, id, "removed");
      const remove = (await ledger(id)).find((row) => row.kind === "remove")!;
      expect(remove.caseId).toBe(withhold!.caseId);
      let now = await columns(id);
      expect(now).toMatchObject({ level: "removed", hidden: remove.at, restored: remove.at });
      expect(now.from! - now.created).toBe(remove.at - withhold!.at);
      await decideForTest(apiDb, id, "visible");
      const restore = (await ledger(id)).find((row) => row.kind === "restore")!;
      now = await columns(id);
      expect(now).toMatchObject({ level: "visible", hidden: remove.at, restored: restore.at });
      // One hidden span in the ledger, from the withhold to the restore.
      expect(now.from! - now.created).toBe(restore.at - withhold!.at);
    });

    test("a post hidden before the columns existed keeps a null explore_from when it is restored, and so its original age: no backfill", async () => {
      const asOf = nextAsOf();
      const [author] = await accounts(apiDb, asOf, 1);
      const id = await newPost(repo, author!.id, before(asOf, HOUR));
      await decideForTest(apiDb, id, "withheld");
      // As a post withheld before explore_resume has it: no hidden_at (written as the migrator; cleared at the end).
      written.push(id);
      await migrateDb.execute(sql`update posts set hidden_at = null where id = ${id}::uuid`);
      await decideForTest(apiDb, id, "visible");
      const now = await columns(id);
      expect(now).toMatchObject({ level: "visible", hidden: null, from: null });
      expect(now.restored).not.toBeNull();
    });
  });

  describe("invariant 19: a suspended account is neither candidate nor approver, and the reads judge it when they read", () => {
    test("a round leaves out a suspended author's post and a suspended engager's like, judged at the round's time; the same accounts count at times outside the suspension", async () => {
      const asOf = nextAsOf();
      const [author, other, f1, f2, engager] = await accounts(apiDb, asOf, 5);
      const at = before(asOf, 3 * HOUR);
      const likedAt = before(asOf, 150 * MINUTE);
      const own = await approvedPost(repo, author!, at, [f1!, f2!, engager!], likedAt);
      // Its third approving account is the engager, so it ranks only while the engager's like counts.
      const approved = await approvedPost(repo, other!, at, [f1!, f2!, engager!], likedAt);
      // Both suspended for the hour on each side of the round's time, in this suite's past: a write today meets neither.
      await suspendAround(author!.id, before(asOf, HOUR), after(asOf, HOUR));
      await suspendAround(engager!.id, before(asOf, HOUR), after(asOf, HOUR));
      try {
        const earlier = await rank(repo, before(asOf, 2 * HOUR));
        expect(new Set(await listed(apiDb, earlier.generation))).toEqual(new Set([own, approved]));
        const during = await rank(repo, asOf);
        expect(await listed(apiDb, during.generation)).toEqual([]);
        // The author's post is no candidate at all; the other post is one, short of its third approving account.
        expect(during.candidates).toBe(earlier.candidates - 1);
        const later = await rank(repo, after(asOf, 2 * HOUR));
        expect(new Set(await listed(apiDb, later.generation))).toEqual(new Set([own, approved]));
      } finally {
        await Promise.all([liftRowForTest(migrateDb, author!.id), liftRowForTest(migrateDb, engager!.id)]);
      }
    });

    test("the page, the author's chip and the status judge the author at the read's time: a suspension that runs now takes a listed post out until it is lifted", async () => {
      const asOf = nextAsOf();
      const [author, reader, ...fans] = await accounts(apiDb, asOf, 5);
      const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
      expect(await listed(apiDb, (await rank(repo, asOf)).generation)).toEqual([id]);
      setNow(after(asOf, MINUTE));
      const computedAt = asOf.toISOString();
      expect(pageIds(await explorePage(deps, null, { limit: 20 }))).toEqual([id]);
      expect((await getPost(deps, author!.id, id)).inExplore).toBe(true);
      expect(await exploreStatus(deps, author!.id, id)).toEqual({ status: "listed", computedAt });

      // From a minute ago by the database's clock, which the reads judge by; the request's own time here is 2024, which
      // the suspension does not cover, so the status reads the clock too, as the page and the chip do.
      await suspendRowForTest(migrateDb, author!.id);
      try {
        expect(pageIds(await explorePage(deps, null, { limit: 20 }))).toEqual([]);
        expect(pageIds(await explorePage(deps, reader!.id, { limit: 20 }))).toEqual([]);
        expect(pageIds(await explorePage(deps, author!.id, { limit: 20 }))).toEqual([]);
        expect(await getPost(deps, author!.id, id)).not.toHaveProperty("inExplore");
        expect(await exploreStatus(deps, author!.id, id)).toEqual({ status: "suspended", computedAt });
        // A round judges at its own time: as of 2024 the author was not suspended, so a round of that time lists the
        // post again, and the reads, judging today, still leave it out.
        expect(await listed(apiDb, (await rank(repo, asOf, { ...EXPLORE_V2, minGapMinutes: 0 })).generation)).toEqual([id]);
        expect(pageIds(await explorePage(deps, null, { limit: 20 }))).toEqual([]);
      } finally {
        await liftRowForTest(migrateDb, author!.id);
      }
      expect(pageIds(await explorePage(deps, null, { limit: 20 }))).toEqual([id]);
      expect((await getPost(deps, author!.id, id)).inExplore).toBe(true);
      expect(await exploreStatus(deps, author!.id, id)).toEqual({ status: "listed", computedAt });
    });

    test("the status suspended comes after not_visible and before hidden_by_author, also for a listed post", async () => {
      const asOf = nextAsOf();
      const [author, ...fans] = await accounts(apiDb, asOf, 4);
      const at = before(asOf, 2 * HOUR);
      const listedPost = await approvedPost(repo, author!, at, fans, before(asOf, HOUR));
      const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: listedPost });
      const withheld = await newPost(repo, author!.id, at);
      await decideForTest(apiDb, withheld, "withheld");
      await rank(repo, asOf);
      setNow(after(asOf, MINUTE));
      const computedAt = asOf.toISOString();
      await suspendRowForTest(migrateDb, author!.id);
      try {
        const statuses = async () =>
          Object.fromEntries(await Promise.all(([["reply", reply], ["withheld", withheld], ["listed", listedPost]] as const).map(async ([name, id]) => [name, (await exploreStatus(deps, author!.id, id)).status])));
        expect(await statuses()).toEqual({ reply: "reply", withheld: "not_visible", listed: "suspended" });
        // With the switch off as well, the suspension is still the reason given.
        await setShowInExplore(deps, author!.id, false);
        expect(await statuses()).toEqual({ reply: "reply", withheld: "not_visible", listed: "suspended" });
      } finally {
        await liftRowForTest(migrateDb, author!.id);
      }
      expect(await exploreStatus(deps, author!.id, listedPost)).toEqual({ status: "hidden_by_author", computedAt });
    });

    test("the skip rule counts only rankings of version 2: the first round after the change ranks at once, the next waits its gap", async () => {
      const asOf = nextAsOf();
      const [author, ...fans] = await accounts(apiDb, asOf, 4);
      const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
      // The last ranking of version 1, a minute before the round: it would have held a round of version 1 back.
      await apiDb.execute(sql`insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${before(asOf, MINUTE).toISOString()}::timestamptz, 1, 0, 0, 0)`);
      const first = await rank(repo, asOf);
      expect(await listed(apiDb, first.generation)).toEqual([id]);
      expect(await repo.refreshExplore(after(asOf, MINUTE))).toEqual({ skipped: true });
      const formulas = await apiDb.execute<{ formula: number }>(sql`select formula from explore_runs order by generation`);
      expect(formulas.map((row) => row.formula)).toEqual([1, 2]);
    });

    test("any formula version but 2 throws before any SQL, in the round and in the status: no ranking is stored under rules the round did not apply", async () => {
      const asOf = nextAsOf();
      const [author, ...fans] = await accounts(apiDb, asOf, 4);
      const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
      setNow(after(asOf, MINUTE));
      for (const version of [0, 1, 3]) {
        const formula: ExploreFormula = { ...EXPLORE_V2, version };
        await expect(repo.refreshExplore(asOf, formula), String(version)).rejects.toThrow(/version 2/);
        await expect(exploreStatus(deps, author!.id, id, formula), String(version)).rejects.toThrow(/version 2/);
      }
      const [runs] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from explore_runs`);
      expect(runs!.n).toBe(0);
      // The published formula is version 2, and the round and the status work with it.
      expect(EXPLORE_V2.version).toBe(2);
      expect(await listed(apiDb, (await rank(repo, asOf)).generation)).toEqual([id]);
      expect(await exploreStatus(deps, author!.id, id)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
    });
  });

  leavesNoModerationRows(() => apiDb);
});
