# korbat account sanctions (3e) — Task 6 of 8: Explore version 2: the migration explore_resume (moderation_apply and posts_guard replaced), EXPLORE_V2 in place of EXPLORE_V1, the round's three fragments with the predicate and explore_from, the skip rule, explorePage and listedInExplore, the status suspended, and the app's texts and change log.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-12 and 2026-10-13 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 6 of sub-project 3e (account sanctions), designed in docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md, follows section 13's Task 6 with sections 6.4 (the migration explore_resume, numbered 0023 here), 7.13 (Explore's round under formula version 2), 9.7 (the app's texts), 10.1 (EXPLORE_V2) and 12.1 rows 3, 18 and 19 with lab F of 12.3. It comes after the restriction of reporting (Task 5) and before retention, export, terms and records (Task 7, the last batch end), which also rewords the README's mention of EXPLORE_V1.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db,contracts,rules,api,admin,app): the restriction of reporting: migration 0022_reporting_counts adds unfounded_marks_check, which takes a mark only from its own final no-breach decision on a signed-in rule report it answered and forces the reporter, the report and the times, then grants the API INSERT on marks; unfounded_marks_recheck runs decision_holds again after any later mark; report_tallies_count counts each signed-in rule report once on its UTC day; the view reporting_record counts reports and marked reports in the frame; forget_reporter also deletes an account's marks and tallies; the routes take warn_reporting, restrict_reporting, lift_reporting and the signed marks, and a kept correction withdraws a decision's marks; a restricted reporter's rule report is refused reporting_restricted; the case answer, /me, the Standing screen, the statement, two mails, the console's composer and the app read and word the counts, the marks, the warning, the restriction and its end with its warning`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/account-sanctions-3e/write_blocks.py docs/superpowers/prompts/account-sanctions-3e/06-explore-version-2.md 1
```

Expected: 14 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/standing-explore.test.ts`

```ts
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
```

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5, 3c design section 5). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/** Modules that may only be entered through their index file. */
const MODULES = ["auth", "social", "media", "account", "staff", "moderation"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");
const insideModeration = (path: string) => path.startsWith("moderation/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    // Each encryption key with the list of the keys it replaced: after a rotation those still open what was stored before it.
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|TOTP_ENC_KEYS_PREVIOUS|NOTIFIER_ENC_KEY|NOTIFIER_ENC_KEYS_PREVIOUS|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5). The moderation module owns the moderation tables on
    // the same role: a notifier's contact and the staff links live in the auth schema, out of its reach (3c design, section 5).
    if (insideSocial(path) || insideMedia(path) || insideStaff(path) || insideModeration(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables; the moderation module likewise. Any mention counts, so a renamed,
    // namespace or dynamic import is caught as surely as a named one.
    if (insideStaff(path) || insideModeration(path)) {
      const module = insideStaff(path) ? "staff" : "moderation";
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the ${module} module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

/**
 * The source pins of the freeze (3c design, sections 6.1 and 6.5). The freeze of the path for suspected child sexual abuse
 * material holds only while every path of a kind passes one gate, so who may name what is pinned here, beside the
 * database's own pins of who names the predicate there:
 *   - `post_frozen` is named only in the media repository and the moderation repository, and `frozen_for` nowhere in the
 *     API: no other file decides by itself what is frozen;
 *   - a delete of `post_media` is written only in the media repository, whose every delete the keep trigger judges and
 *     whose every answer names only rows that are gone;
 *   - `requestDeletion` (asking the worker to delete an image's files) and `openImage` (opening an image file of the
 *     store) are named in a pinned list of files, each a pinned number of times, comments included: a new caller of
 *     either fails the test until whoever adds it has checked it against the gates and listed it.
 */
const POST_FROZEN_ALLOWED = new Set(["media/repo.ts", "moderation/repo.ts"]);
const POST_MEDIA_DELETE_ALLOWED = new Set(["media/repo.ts"]);
const POST_MEDIA_DELETE = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?post_media\b|\btruncate\b[^;`]*\bpost_media\b|\.delete\(\s*postMedia\b/i;

function findFreezeViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bfrozen_for\b/.test(source)) violations.push(`${path}: names frozen_for, which only the database's own functions name`);
    if (/\bpost_frozen\b/.test(source) && !POST_FROZEN_ALLOWED.has(path)) violations.push(`${path}: names post_frozen, which only the media and moderation repositories may`);
    if (POST_MEDIA_DELETE.test(source) && !POST_MEDIA_DELETE_ALLOWED.has(path)) violations.push(`${path}: deletes from post_media, which only the media repository may`);
  }
  return violations;
}

/** Every file that names `name` as a whole word, with how often, comments included. */
function mentions(files: SourceFile[], name: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const { path, source } of files) {
    // Cut at every word boundary: a whole word is then a piece of its own.
    const count = source.split(/\b/).filter((piece) => piece === name).length;
    if (count > 0) found[path] = count;
  }
  return found;
}

/**
 * Where `requestDeletion` is named. A deletion request names an id that a delete of post_media answered, an upload that
 * failed before it could be put on a post, or a file that has no row: the files module writes the request; the upload's
 * removal, the sweeper, the author's deletion (after its commit), the account's purge (after its commit) and the
 * disposal's caller (after its commit) ask for it through the module's interfaces; and the one retry of what the purge
 * and the disposal owe asks for it only for a row that is gone.
 */
const REQUEST_DELETION = {
  "account/flows/deletion.ts": 1,
  "media/cases.ts": 4,
  "media/context.ts": 2,
  "media/files.ts": 1,
  "media/flows/remove.ts": 1,
  "media/index.ts": 5,
  // The retry of owed deletions, which asks only for ids whose row it found gone.
  "media/owed.ts": 1,
  "media/sweeper.ts": 2,
  // The retention job, which asks for a batch's files after the commit of the transaction that deleted their rows.
  "moderation/retention.ts": 1,
  "social/context.ts": 1,
  "social/flows/posts.ts": 1,
};

/**
 * Where `openImage` is named: the files module, which opens a file of the store under its checks, and its three callers,
 * each behind its own reader's rule: serve (gate S), the export's open (which reads the row again) and the staff's image
 * (gate V).
 */
const OPEN_IMAGE = {
  "media/cases.ts": 1,
  "media/files.ts": 1,
  "media/flows/serve.ts": 1,
  "media/index.ts": 1,
};

describe("the freeze's source pins", () => {
  test("apps/api/src names post_frozen only in the two repositories, frozen_for nowhere, and deletes from post_media only in the media repository", () => {
    expect(findFreezeViolations(loadSources())).toEqual([]);
    // The media repository does name the predicate and does delete: the pins are about a file that exists.
    const repo = loadSources().find((file) => file.path === "media/repo.ts")!;
    expect(repo.source).toMatch(/\bpost_frozen\b/);
    expect(POST_MEDIA_DELETE.test(repo.source)).toBe(true);
  });

  test("catches the predicate named outside the two repositories, and its core named anywhere", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "sql`select public.post_frozen(m.post_id) as frozen from post_media m`" },
      { path: "moderation/repo.ts", source: "sql`select not public.post_frozen(${postId}::uuid) as images_allowed`" },
      { path: "moderation/cases.ts", source: "const [row] = await tx.execute(sql`select public.post_frozen(${postId}::uuid) as frozen`);" },
      { path: "media/flows/serve.ts", source: "const frozen = await db.execute(sql`select post_frozen(${postId})`);" },
      { path: "staff/cases.ts", source: "await db.execute(sql`select public.frozen_for(${postId}::uuid, ${authorId}::uuid)`);" },
      { path: "media/repo.ts", source: "sql`select public.frozen_for(m.post_id, m.owner_id) from post_media m`" },
      // Another word that only contains the name is not the name.
      { path: "social/views.ts", source: "const post_frozen_label = 1; const unfrozen_for_now = 2;" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "moderation/cases.ts: names post_frozen, which only the media and moderation repositories may",
      "media/flows/serve.ts: names post_frozen, which only the media and moderation repositories may",
      "staff/cases.ts: names frozen_for, which only the database's own functions name",
      "media/repo.ts: names frozen_for, which only the database's own functions name",
    ]);
  });

  test("catches a delete of post_media outside the media repository, in SQL and through the query builder", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`);\nawait db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/sweeper.ts", source: "await db.execute(sql`delete from post_media where post_id is null and created_at < ${before}`);" },
      { path: "media/flows/remove.ts", source: "await deps.db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/cases.ts", source: 'await tx.execute(sql`DELETE FROM "public"."post_media" WHERE "id" = ${id}`);' },
      { path: "media/index.ts", source: "await tx.execute(sql`truncate table post_media cascade`);" },
      // Reading and updating image rows, and deleting something else, is not a delete of image rows.
      { path: "media/flows/status.ts", source: "await db.update(postMedia).set({ status }).where(eq(postMedia.id, id));\nawait db.delete(posts).where(eq(posts.id, id));\nconst rows = await db.execute(sql`select id from post_media`);" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "media/sweeper.ts: deletes from post_media, which only the media repository may",
      "media/flows/remove.ts: deletes from post_media, which only the media repository may",
      "media/cases.ts: deletes from post_media, which only the media repository may",
      "media/index.ts: deletes from post_media, which only the media repository may",
    ]);
  });

  test("requestDeletion and openImage are named in exactly the pinned files, each the pinned number of times", () => {
    expect(mentions(loadSources(), "requestDeletion")).toEqual(REQUEST_DELETION);
    expect(mentions(loadSources(), "openImage")).toEqual(OPEN_IMAGE);
  });

  test("catches a new caller of either, in a file of the list and in one outside it", () => {
    const real = loadSources();
    // A second request in the purge's flow, and a first one in a file that had none.
    const withCallers = real
      .map((file) => (file.path === "account/flows/deletion.ts" ? { ...file, source: `${file.source}\nawait deps.media.requestDeletion(kept);` } : file))
      .concat([{ path: "moderation/decide.ts", source: "await deps.media.requestDeletion(ids);" }]);
    expect(mentions(withCallers, "requestDeletion")).not.toEqual(REQUEST_DELETION);
    expect(mentions(withCallers, "requestDeletion")).toMatchObject({ "account/flows/deletion.ts": 2, "moderation/decide.ts": 1 });
    // A fourth opener of the store's files.
    const withOpener = real.concat([{ path: "staff/cases.ts", source: 'const file = await files.openImage(id, "large");' }]);
    expect(mentions(withOpener, "openImage")).not.toEqual(OPEN_IMAGE);
    // A name that only contains the word is not counted.
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "requestDeletion")).toEqual({});
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "openImage")).toEqual({});
  });
});

/**
 * The source pins of account sanctions (3e design, sections 11 and 12.2; invariant 23): no write of an account is added
 * without the one predicate.
 *   - The predicate's three fragments, exported by lib/standing.ts (`liveNotSuspended`, and the two halves that a locking
 *     statement answers separately, `suspendedAt` and `reportsRestrictedAt`), are named in a pinned list of files, each a
 *     pinned number of times, comments included, as REQUEST_DELETION is: whoever adds a write on behalf of an account adds
 *     its site to the list, and the auth module never names one.
 *   - The profile's three derived columns are named in apps/api/src only in lib/standing.ts, social/repo.ts's
 *     lockAccounts and the moderation module's standing-repo.ts, in SQL or by drizzle's names: no other file decides by
 *     itself whether an account is suspended. Their one writer is the database's standing_apply (the function pin of 6.6).
 */
const STANDING_PREDICATE = {
  // social/repo.ts, 3e Task 6: Explore's round applies the predicate to the candidates' authors and to the engagers at the
  // round's time, and the page and the chip to the authors at the read's (explorePage, listedInExplore).
  liveNotSuspended: { "lib/standing.ts": 1, "media/repo.ts": 2, "profiles/store.ts": 3, "social/repo.ts": 6 },
  // social/repo.ts, 3e Task 6: the author's Explore status reads whether the author is suspended (exploreFacts).
  suspendedAt: { "lib/standing.ts": 2, "social/repo.ts": 7 },
  reportsRestrictedAt: { "lib/standing.ts": 1, "social/repo.ts": 2 },
};
const STANDING_COLUMNS_ALLOWED = new Set(["lib/standing.ts", "social/repo.ts", "moderation/standing-repo.ts"]);
const STANDING_COLUMNS = ["suspended_from", "suspended_until", "reports_restricted_until", "suspendedFrom", "suspendedUntil", "reportsRestrictedUntil"];
/** Whether a file names one of the derived columns as a whole word, by the same cut as `mentions`. */
const namesStandingColumn = (file: SourceFile): boolean => STANDING_COLUMNS.some((name) => mentions([file], name)[file.path] !== undefined);

function findStandingViolations(files: SourceFile[]): string[] {
  return files.filter((file) => namesStandingColumn(file) && !STANDING_COLUMNS_ALLOWED.has(file.path)).map(({ path }) => `${path}: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may`);
}

describe("the source pins of account sanctions (3e)", () => {
  test("the predicate's fragments are named in exactly the pinned files, each the pinned number of times; the auth module names none", () => {
    for (const [name, pinned] of Object.entries(STANDING_PREDICATE)) expect(mentions(loadSources(), name), name).toEqual(pinned);
    // The auth module names none: no file of it is in any of the pinned lists.
    for (const pinned of Object.values(STANDING_PREDICATE)) expect(Object.keys(pinned).filter((path) => path.startsWith("auth/"))).toEqual([]);
  });

  test("catches a new write that names the predicate, in a pinned file and in one outside the list", () => {
    const real = loadSources();
    const withWrites = real
      .map((file) => (file.path === "media/repo.ts" ? { ...file, source: file.source + String.fromCharCode(10) + 'sql`update post_media set alt = null where ${liveNotSuspended("p", WRITE_CLOCK)}`;' } : file))
      .concat([{ path: "moderation/texts.ts", source: 'await tx.execute(sql`select 1 from profiles p where ${suspendedAt("p", WRITE_CLOCK)}`);' }]);
    expect(mentions(withWrites, "liveNotSuspended")).not.toEqual(STANDING_PREDICATE.liveNotSuspended);
    expect(mentions(withWrites, "liveNotSuspended")).toMatchObject({ "media/repo.ts": 3 });
    expect(mentions(withWrites, "suspendedAt")).toMatchObject({ "moderation/texts.ts": 1 });
    expect(mentions(withWrites, "suspendedAt")).not.toEqual(STANDING_PREDICATE.suspendedAt);
  });

  test("the three derived columns are named only in lib/standing.ts, social/repo.ts and moderation/standing-repo.ts, and lib/standing.ts does name them", () => {
    expect(findStandingViolations(loadSources())).toEqual([]);
    expect(namesStandingColumn(loadSources().find((file) => file.path === "lib/standing.ts")!)).toBe(true);
  });

  test("catches a derived column named elsewhere, in SQL and by drizzle's name", () => {
    const files: SourceFile[] = [
      { path: "lib/standing.ts", source: "sql`(${p}.suspended_from is not null and ${p}.suspended_from <= ${at} and ${at} < ${p}.suspended_until)`" },
      { path: "moderation/standing-repo.ts", source: "sql`select reports_restricted_until from profiles`" },
      { path: "social/flows/posts.ts", source: "const [row] = await db.execute(sql`select suspended_until from profiles where id = ${viewer}::uuid`);" },
      { path: "media/repo.ts", source: "await db.select({ until: profiles.suspendedUntil }).from(profiles);" },
      { path: "auth/flows/badge.ts", source: "if (profile.reportsRestrictedUntil) return;" },
      // A word that only contains the name is not the name.
      { path: "social/views.ts", source: "const unsuspended_from_now = 1;" },
    ];
    expect(findStandingViolations(files)).toEqual([
      "social/flows/posts.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "media/repo.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "auth/flows/badge.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
    ]);
  });
});

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("moderation/index.ts");
    expect(paths).toContain("cli/staff.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
      { path: "staff/cases.ts", source: `import { ModerationError, type ModerationForStaff } from "../moderation";` },
      { path: "index.ts", source: `import { createModeration } from "./moderation";\nimport { socialForModeration } from "./social";` },
      { path: "moderation/repo.ts", source: `import { cases, decisions, evidenceSnapshots, intakes, type Db, type DbTx } from "@korbat/db";\nimport { ModerationError } from "./context";` },
      { path: "moderation/decide.ts", source: `import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";\nimport { boundLockWaits } from "../lib/lock-bounds";\nimport type { SocialForModeration } from "../social";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead", "cases", "decisions", "evidenceSnapshots", "intakes"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The key a notifier's name and address are encrypted under is the auth module's too: the moderation module, which
      // names contacts by their ids, never sees it.
      { path: "moderation/intake.ts", source: `const key = deps.config.NOTIFIER_ENC_KEY;` },
      // The keys a key replaced are guarded as the key is: a contact is never encrypted again, so after a rotation they are
      // the only keys of every contact stored before it. The TOTP key's earlier keys likewise.
      { path: "moderation/context.ts", source: `const older = config.NOTIFIER_ENC_KEYS_PREVIOUS;` },
      { path: "staff/routes.ts", source: `const older = config.TOTP_ENC_KEYS_PREVIOUS;` },
      // A longer name that only contains a key's name is not the key; config.ts and the auth module may name every key.
      { path: "lib/names.ts", source: `const MY_NOTIFIER_ENC_KEY_NAME = 1; const NOTIFIER_ENC_KEYS = 2; const TOTP_ENC_KEYS_PREVIOUSLY = 3;` },
      { path: "config.ts", source: `NOTIFIER_ENC_KEY: versionedKey, NOTIFIER_ENC_KEYS_PREVIOUS: z.string(), TOTP_ENC_KEYS_PREVIOUS: z.string(),` },
      { path: "auth/context.ts", source: `notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY), notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "moderation/intake.ts: references an auth key",
      "moderation/context.ts: references an auth key",
      "staff/routes.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches a deep import into the moderation module, from outside it and from another module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { decide } from "./moderation/decide";\nimport { createModeration } from "./moderation";` },
      { path: "staff/cases.ts", source: `import { ModerationError } from "../moderation/context";` },
      { path: "social/views.ts", source: `import { authorFacts } from "../moderation/repo";` },
      { path: "cli/staff.ts", source: `const { recordIntake } = await import("../moderation/intake");` },
      { path: "moderation/decide.ts", source: `import { ModerationError } from "./context";\nimport { insertDecision } from "./repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./moderation/decide, which is inside the moderation module (use ./moderation)",
      "staff/cases.ts: imports ../moderation/context, which is inside the moderation module (use ./moderation)",
      "social/views.ts: imports ../moderation/repo, which is inside the moderation module (use ./moderation)",
      "cli/staff.ts: imports ../moderation/intake, which is inside the moderation module (use ./moderation)",
    ]);
  });

  test("catches the moderation module reaching into another module, naming post_media, or opening the auth pool", () => {
    const files: SourceFile[] = [
      { path: "moderation/intake.ts", source: `import { createSocialRepo } from "../social/repo";` },
      { path: "moderation/decide.ts", source: `import { verifyStepUp } from "../auth/staff/step-up";` },
      { path: "moderation/repo.ts", source: `import { cases, postMedia, type Db } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: "const rows = await tx.execute(sql`select id from post_media where post_id = ${postId}`);" },
      { path: "moderation/context.ts", source: `export interface ModerationDeps { authDb: Db }` },
    ];
    expect(findViolations(files, new Set(["cases", "postMedia"]), new Set())).toEqual([
      "moderation/intake.ts: imports ../social/repo, which is inside the social module (use ./social)",
      "moderation/decide.ts: imports ../auth/staff/step-up, which is inside the auth module (use ./auth)",
      "moderation/repo.ts: references post_media, which only the media module may touch",
      "moderation/cases.ts: references post_media, which only the media module may touch",
      "moderation/context.ts: references the auth database pool",
    ]);
  });

  test("catches auth-schema imports inside the moderation module, and the auth module's repository or session store", () => {
    const files: SourceFile[] = [
      { path: "moderation/repo.ts", source: `import { decisions, notifierContacts, type Db } from "@korbat/db";` },
      { path: "moderation/decide.ts", source: `import type { staffPersonalAccounts as links, users } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: `import * as db from "@korbat/db";` },
      { path: "moderation/intake.ts", source: `import { createAuthRepo } from "../auth";` },
      { path: "moderation/reveal.ts", source: `const { createSessions } = await import("../auth");` },
    ];
    expect(findViolations(files, new Set(["decisions"]), new Set(["notifierContacts", "staffPersonalAccounts", "users"]))).toEqual([
      "moderation/repo.ts: imports auth-schema notifierContacts from @korbat/db",
      "moderation/decide.ts: imports auth-schema staffPersonalAccounts from @korbat/db",
      "moderation/decide.ts: imports auth-schema users from @korbat/db",
      "moderation/cases.ts: namespace import of @korbat/db (import public-schema names explicitly)",
      "moderation/intake.ts: uses the auth module's createAuthRepo (the moderation module goes through the auth module's interface)",
      "moderation/reveal.ts: uses the auth module's createSessions (the moderation module goes through the auth module's interface)",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});
```

### Replace `apps/api/test/integration/http-explore.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ErrorEnvelope, ExplorePage, ExploreSettingResponse, ExploreStatus, ExportFormat, FlowResponse, MeResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import type { MediaForAccount } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, type Social } from "../../src/social";
import { HOUR, MINUTE, accounts, after, approvedPost, before, listed, pageIds, rank, spans } from "./explore-fixtures";
import { Browser } from "./http-client";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { newPost } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

/**
 * This suite's past (see explore-fixtures.ts): the social module's clock and its rankings run in 2023, each test in a span
 * of its own. The auth module keeps the real clock, so sessions are fresh and the export's freshness check passes; the
 * accounts that sign up are therefore younger than their posts, which only an engaging account's age would matter for.
 */
const EPOCH = Date.UTC(2023, 0, 1);

/**
 * Explore's routes through the real app: 1a sign-up for the accounts that read, cookie sessions with CSRF, the social
 * module on this database with the clock the tests set, and the account module for the export, whose images these
 * accounts do not have.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: Explore over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let social: Social;
  let app: App;
  const mailer = new MemoryMailer();
  let clock = new Date(EPOCH);
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    social = createSocial({
      apiDb,
      rateLimitStore,
      logger,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      events: { append: auth.appendEvent },
      now: () => clock,
    });
    const noImages: MediaForAccount = { purgeOwner: async () => [], requestDeletion: async () => undefined, exportImages: async () => [] };
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: noImages,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, account });
  });
  afterAll(async () => {
    await closeDecisions();
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await apiDb.execute(sql`delete from explore_runs`);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `explore-${randomUUID()}@korbat.local`;
    const handle = `e${randomBytes(4).toString("hex")}`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorOf = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((event) => event.type);

  /** An Explore page through the app, signed out unless a browser is given, checked against the contract and the header every answer carries. */
  async function explore(query: string, b?: Browser): Promise<ExplorePage> {
    const path = `/api/timeline/explore${query}`;
    const res = b ? await b.fetch(path) : await app.request(path);
    expect(res.status, path).toBe(200);
    expect(res.headers.get("cache-control"), path).toBe("no-store");
    return ExplorePage.parse(await res.json());
  }

  /** `n` posts by as many authors, each liked by the same three accounts at one time, and the ranking of them in order. */
  async function ranked(asOf: Date, n: number): Promise<string[]> {
    const authors = await accounts(apiDb, asOf, n);
    const fans = await accounts(apiDb, asOf, 3);
    for (const author of authors) await approvedPost(social.deps.repo, author, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const order = await listed(apiDb, (await rank(social.deps.repo, asOf)).generation);
    expect(order).toHaveLength(n);
    return order;
  }

  test("signed out: one page of at most 20 posts whatever the limit asks, no cursor, the sign-in prompt while more follow, and the ranking's time", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 21);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();

    for (const query of ["?limit=50", "", "?limit=20"]) {
      const page = await explore(query);
      expect(pageIds(page), query).toEqual(order.slice(0, 20));
      expect(page, query).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });
    }
    const five = await explore("?limit=5");
    expect(pageIds(five)).toEqual(order.slice(0, 5));
    expect(five).toMatchObject({ nextCursor: null, computedAt, signInForMore: true });

    // A signed-in reader is not capped, and has a cursor rather than a prompt when more follow.
    const reader = await signUp();
    const all = await explore("?limit=50", reader.b);
    expect(pageIds(all)).toEqual(order);
    expect(all).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });

    // The extra row that decides the prompt is read through the same filters as the page: with the first post withheld,
    // the twenty left are all there is.
    await decideForTest(apiDb, order[0]!, "withheld");
    const rest = await explore("?limit=50");
    expect(pageIds(rest)).toEqual(order.slice(1));
    expect(rest).toMatchObject({ nextCursor: null, computedAt, signInForMore: false });
    // The withheld state comes from a real, confirmed decision: a staff key's enrolment, a sign-in, a step-up and the decision.
  }, 30_000);

  test("a signed-out request with a cursor is refused with 401 before anything is read; signed in, the cursor pages on, and every answer is no-store", async () => {
    const asOf = nextAsOf();
    const order = await ranked(asOf, 5);
    clock = after(asOf, MINUTE);
    const reader = await signUp();
    const first = await explore("?limit=2", reader.b);
    expect(pageIds(first)).toEqual(order.slice(0, 2));
    expect(first).toMatchObject({ computedAt: asOf.toISOString(), signInForMore: false });
    const cursor = encodeURIComponent(first.nextCursor!);

    // Any cursor, a real one or not, asks for more than the first page, which needs an account.
    for (const query of [`?cursor=${cursor}`, `?limit=2&cursor=${cursor}`, "?cursor=not-a-cursor"]) {
      const refused = await app.request(`/api/timeline/explore${query}`);
      expect(refused.status, query).toBe(401);
      expect(refused.headers.get("cache-control"), query).toBe("no-store");
      expect(await errorOf(refused), query).toMatchObject({ code: "unauthenticated", message: "Sign in to see more of Explore." });
    }

    const second = await explore(`?limit=2&cursor=${cursor}`, reader.b);
    const third = await explore(`?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`, reader.b);
    expect([...pageIds(first), ...pageIds(second), ...pageIds(third)]).toEqual(order);
    expect(third).toMatchObject({ nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Signed in, a cursor that is not one is the request's fault, not a reason to sign in.
    const bad = await reader.b.fetch("/api/timeline/explore?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe("invalid_request");
  });

  test("the status route answers the post's author only: not_found for anyone else and for an unknown post, 401 signed out", async () => {
    const asOf = nextAsOf();
    const [ada, bob] = [await signUp(), await signUp()];
    const fans = await accounts(apiDb, asOf, 3);
    const inExplore = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    const quiet = await newPost(social.deps.repo, ada.userId, before(asOf, 2 * HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();
    const statusPath = (id: string) => `/api/posts/${id}/explore`;

    const answered = await ada.b.fetch(statusPath(inExplore));
    expect(answered.status).toBe(200);
    expect(answered.headers.get("cache-control")).toBe("no-store");
    const body = (await answered.json()) as Record<string, unknown>;
    expect(ExploreStatus.parse(body)).toEqual({ status: "listed", computedAt });
    // The reason and the ranking's time, and nothing else: no count, no score.
    expect(Object.keys(body).sort()).toEqual(["computedAt", "status"]);
    expect(await (await ada.b.fetch(statusPath(quiet))).json()).toEqual({ status: "below_threshold", computedAt });

    for (const id of [inExplore, quiet]) {
      const other = await bob.b.fetch(statusPath(id));
      expect(other.status).toBe(404);
      expect((await errorOf(other)).code).toBe("not_found");
      const signedOut = await app.request(statusPath(id));
      expect(signedOut.status).toBe(401);
      expect((await errorOf(signedOut)).code).toBe("unauthenticated");
    }
    const unknown = await ada.b.fetch(statusPath(randomUUID()));
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe("not_found");
    expect((await ada.b.fetch(statusPath("not-a-post"))).status).toBe(400);
  });

  test("a suspended author (3e): the status route answers suspended, and the page and the author's chip leave the listed post at the next read, before any round", async () => {
    const asOf = nextAsOf();
    const ada = await signUp();
    const fans = await accounts(apiDb, asOf, 3);
    const id = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const computedAt = asOf.toISOString();
    const statusOf = async () => ExploreStatus.parse(await (await ada.b.fetch(`/api/posts/${id}/explore`)).json());
    const chip = async () => ((await (await ada.b.fetch(`/api/posts/${id}`)).json()) as { inExplore?: boolean }).inExplore;
    expect(await statusOf()).toEqual({ status: "listed", computedAt });
    expect(pageIds(await explore(""))).toEqual([id]);
    expect(await chip()).toBe(true);
    const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    try {
      // Suspended from a minute ago by the database's clock, which the reads judge by; the ranking of 2023 judged the
      // author at its own time and listed the post. The status is a read, which a suspended account may make.
      await suspendRowForTest(migrateDb, ada.userId);
      expect(await statusOf()).toEqual({ status: "suspended", computedAt });
      expect(pageIds(await explore(""))).toEqual([]);
      expect(pageIds(await explore("", ada.b))).toEqual([]);
      expect(await chip()).toBeUndefined();
    } finally {
      await liftRowForTest(migrateDb, ada.userId);
      await closeDb(migrateDb);
    }
    // Lifted, the post is back at the next read: the ranking still holds it.
    expect(pageIds(await explore(""))).toEqual([id]);
    expect(await statusOf()).toEqual({ status: "listed", computedAt });
    expect(await chip()).toBe(true);
  });

  test("POST turns the Explore switch on and DELETE off, for an onboarded session and without an event; /api/me reads it, and a listed post leaves at the next read", async () => {
    const asOf = nextAsOf();
    const ada = await signUp();
    const fans = await accounts(apiDb, asOf, 3);
    const id = await approvedPost(social.deps.repo, { id: ada.userId }, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    await rank(social.deps.repo, asOf);
    clock = after(asOf, MINUTE);
    const me = async () => MeResponse.parse(await (await ada.b.fetch("/api/me")).json()).profile!;
    const turn = async (method: "POST" | "DELETE") => {
      const res = await ada.b.fetch("/api/me/explore", { method });
      expect(res.status, method).toBe(200);
      return ExploreSettingResponse.parse(await res.json());
    };
    expect((await me()).showInExplore).toBe(true);
    expect(pageIds(await explore(""))).toEqual([id]);
    const events = await eventTypes(ada.userId);

    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect((await me()).showInExplore).toBe(false);
    // At the next read, before any further round.
    expect(pageIds(await explore(""))).toEqual([]);
    expect(await turn("DELETE")).toEqual({ showInExplore: false });
    expect(await turn("POST")).toEqual({ showInExplore: true });
    expect((await me()).showInExplore).toBe(true);
    expect(await turn("POST")).toEqual({ showInExplore: true });
    // No event records the switch.
    expect(await eventTypes(ada.userId)).toEqual(events);
    // The switch is the author's own: the public profile never shows it.
    const profile = (await (await app.request(`/api/profiles/${ada.handle}`)).json()) as Record<string, unknown>;
    expect(profile.id).toBe(ada.userId);
    expect(profile).not.toHaveProperty("showInExplore");

    const early = await signUp(false);
    for (const method of ["POST", "DELETE"]) {
      const anonymous = await app.request("/api/me/explore", { method });
      expect(anonymous.status, method).toBe(401);
      expect((await errorOf(anonymous)).code, method).toBe("unauthenticated");
      const notOnboarded = await early.b.fetch("/api/me/explore", { method });
      expect(notOnboarded.status, method).toBe(403);
      expect((await errorOf(notOnboarded)).code, method).toBe("onboarding_required");
    }
  });

  test("the data export carries the Explore switch as it stands", async () => {
    const [on, off] = [await signUp(), await signUp()];
    expect((await off.b.fetch("/api/me/explore", { method: "DELETE" })).status).toBe(200);
    const exported = async (b: Browser) => {
      const res = await b.fetch("/api/account/export", { method: "POST" });
      expect(res.status).toBe(200);
      return ExportFormat.parse(JSON.parse(strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))["export.json"]!)));
    };
    expect((await exported(on.b)).profile).toMatchObject({ handle: on.handle, showInExplore: true });
    expect((await exported(off.b)).profile).toMatchObject({ handle: off.handle, showInExplore: false });
  });

  leavesNoModerationRows(() => apiDb);
});
```

### Replace `apps/api/test/integration/moderation-apply.test.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  aPost,
  act,
  actionsOf,
  csamNotice,
  decideIn,
  decisionRow,
  imagePost,
  imageStates,
  insertItem,
  newImageRow,
  newPostRow,
  newTestStaff,
  openCase,
  postRow,
  readCase,
  refusal,
  report,
  rowCounts,
  ruleReport,
  staffProfile,
  uuids,
  type TestStaff,
} from "./moderation-fixtures";
import { newProfile } from "./social-fixtures";
import { pgError, rolledBack } from "./staff-fixtures";

// The generated sequences run some two and a half thousand ledger steps in the database, each with a derivation, and the named
// cases dozens of statements inside one open transaction: on a loaded machine that takes far longer than the five seconds
// a test gets by default.
vi.setConfig({ testTimeout: 120_000 });

// ---------------------------------------------------------------- the reference implementation

/**
 * One thing that arrives at the ledger of one post. The post has two images and is reached by three cases: case 1 is an
 * earlier case about it that is closed, case 2 the open case about it, case 3 the open case about its author's account.
 * Cases 2 and 3 each hold a suspect item from the start, case 2 an ordinary one too.
 */
type Arrival =
  | { op: "measure"; c: 1 | 2; d: "interim" | "final"; k: "withhold" | "remove" | "withhold_media" | "remove_media"; img?: 0 | 1; key: string }
  | { op: "seal"; c: 2 | 3; d: "interim" | "final"; key: string }
  /** A reversal of the measure or seal with this key. */
  | { op: "lift"; key: string }
  /** The case's unanswered items are answered and it closes. */
  | { op: "close"; c: 2 | 3 }
  /** The case's suspect items are answered; another item may keep it open. */
  | { op: "answer"; c: 2 | 3 }
  /** A new suspect item joins the case, unless it is closed. */
  | { op: "suspect"; c: 2 | 3 }
  | { op: "erase" }
  | { op: "erase_image"; img: 0 | 1 }
  /** The author deletes the post. */
  | { op: "delete" };

interface Derived {
  level: string;
  state: string;
  images: string[];
  /**
   * Explore's three columns, which the same statement as the level writes (3e design, section 6.4): whether hidden_at
   * and restored_at are set, and explore_from's distance from created_at in microseconds, null while it is unset. Every
   * arrival of a sequence runs in the test's one transaction, whose now() never moves, so every span here is 0; the
   * spans themselves are standing-explore.test.ts's, over decisions that each commit.
   */
  hidden: boolean;
  restored: boolean;
  exploreShift: number | null;
}

/** A step's fields in one fixed order, so a step read from the database and one from the reference compare as text. */
const canonical = (step: Derived): string => JSON.stringify([step.level, step.state, step.images, step.hidden, step.restored, step.exploreShift]);

/**
 * What the post's level, its state and its two images' states must be after each arrival, computed here from the rules
 * alone (3c design, section 6.2): a measure is in force when no reversal names it and, if it was taken while deciding,
 * while its case is open, or for a seal while its case holds an unanswered suspect item that arrived no later than the
 * seal's decision. The level is the strongest post measure in force, removed also once the content was erased; the state
 * mirrors it unless the author deleted the post; an image is sealed while a seal in force lists its post, else removed,
 * withheld or visible by its own measures, removed also once it was erased. Time is the arrival's place in the sequence;
 * what the cases held from the start is at time 0.
 */
function reference(sequence: readonly Arrival[]): Derived[] {
  const cases: Record<number, { closed: boolean; items: { at: number; suspect: boolean; answered: boolean }[] }> = {
    1: { closed: true, items: [] },
    2: { closed: false, items: [{ at: 0, suspect: true, answered: false }, { at: 0, suspect: false, answered: false }] },
    3: { closed: false, items: [{ at: 0, suspect: true, answered: false }] },
  };
  const ledger: { key: string; c: number; d: string; k: string; img: number | null; at: number; lifted: boolean }[] = [];
  let erased = false;
  let deleted = false;
  const erasedImages = [false, false];
  // Explore's columns: set when the level leaves visible (hidden_at) and when it comes back to it (restored_at and
  // explore_from, which grows by the span just ended: 0 inside one transaction); a move between withheld and removed sets none.
  let previous = "visible";
  let hidden = false;
  let restored = false;
  let exploreShift: number | null = null;
  const inForce = (m: (typeof ledger)[number]) =>
    !m.lifted && (m.d !== "interim" || (m.k === "seal_media" ? cases[m.c]!.items.some((item) => item.suspect && !item.answered && item.at <= m.at) : !cases[m.c]!.closed));
  const out: Derived[] = [];
  sequence.forEach((arrival, index) => {
    const at = index + 1;
    if (arrival.op === "measure") ledger.push({ key: arrival.key, c: arrival.c, d: arrival.d, k: arrival.k, img: arrival.img ?? null, at, lifted: false });
    else if (arrival.op === "seal") ledger.push({ key: arrival.key, c: arrival.c, d: arrival.d, k: "seal_media", img: null, at, lifted: false });
    else if (arrival.op === "lift") ledger.find((m) => m.key === arrival.key)!.lifted = true;
    else if (arrival.op === "close") {
      for (const item of cases[arrival.c]!.items) item.answered = true;
      cases[arrival.c]!.closed = true;
    } else if (arrival.op === "answer") {
      for (const item of cases[arrival.c]!.items) if (item.suspect) item.answered = true;
    } else if (arrival.op === "suspect") {
      if (!cases[arrival.c]!.closed) cases[arrival.c]!.items.push({ at, suspect: true, answered: false });
    } else if (arrival.op === "erase") erased = true;
    else if (arrival.op === "erase_image") erasedImages[arrival.img] = true;
    else deleted = true;

    const standing = ledger.filter(inForce);
    const level = erased || standing.some((m) => m.k === "remove") ? "removed" : standing.some((m) => m.k === "withhold") ? "withheld" : "visible";
    const sealed = standing.some((m) => m.k === "seal_media");
    const images = [0, 1].map((img) =>
      sealed
        ? "sealed"
        : erasedImages[img] || standing.some((m) => m.k === "remove_media" && m.img === img)
          ? "removed"
          : standing.some((m) => m.k === "withhold_media" && m.img === img)
            ? "withheld"
            : "visible",
    );
    if (previous === "visible" && level !== "visible") hidden = true;
    if (previous !== "visible" && level === "visible") {
      restored = true;
      // The span that just ended is added to it; inside one transaction that span is 0.
      exploreShift = exploreShift ?? 0;
    }
    previous = level;
    out.push({ level, state: deleted ? "deleted_by_author" : level, images, hidden, restored, exploreShift });
  });
  return out;
}

/** Every order of these arrivals in which a reversal comes after what it lifts. */
function orders(arrivals: readonly Arrival[]): Arrival[][] {
  const all: Arrival[][] = [];
  const walk = (taken: Arrival[], left: Arrival[]) => {
    if (left.length === 0) return void all.push(taken);
    left.forEach((next, index) => {
      if (next.op === "lift" && !taken.some((earlier) => (earlier.op === "measure" || earlier.op === "seal") && earlier.key === next.key)) return;
      walk([...taken, next], [...left.slice(0, index), ...left.slice(index + 1)]);
    });
  };
  walk([], [...arrivals]);
  return all;
}

/** A seeded generator of numbers from 0 up to 1, so the generated sequences are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sequence of this many arrivals drawn from everything that can arrive, each reversal after its measure. */
function drawn(random: () => number, length: number): Arrival[] {
  const pick = <T>(of: readonly T[]): T => of[Math.floor(random() * of.length)]!;
  const sequence: Arrival[] = [];
  const liftable: string[] = [];
  let suspects = 0;
  while (sequence.length < length) {
    const key = `m${sequence.length}`;
    const kind = pick(["measure", "measure", "measure", "seal", "lift", "lift", "close", "answer", "suspect", "erase", "erase_image", "delete"] as const);
    if (kind === "measure") {
      const k = pick(["withhold", "remove", "withhold_media", "remove_media"] as const);
      const image = k === "withhold_media" || k === "remove_media" ? { img: pick([0, 1] as const) } : {};
      sequence.push({ op: "measure", c: pick([1, 2] as const), d: k === "withhold" || k === "withhold_media" ? "interim" : pick(["interim", "final"] as const), k, ...image, key });
      liftable.push(key);
    } else if (kind === "seal") {
      sequence.push({ op: "seal", c: pick([2, 3] as const), d: pick(["interim", "final"] as const), key });
      liftable.push(key);
    } else if (kind === "lift") {
      if (liftable.length === 0) continue;
      sequence.push({ op: "lift", key: liftable.splice(Math.floor(random() * liftable.length), 1)[0]! });
    } else if (kind === "suspect") {
      // The replay holds four spare notices for the items that arrive.
      if (suspects === 4) continue;
      suspects++;
      sequence.push({ op: "suspect", c: pick([2, 3] as const) });
    } else if (kind === "close" || kind === "answer") sequence.push({ op: kind, c: pick([2, 3] as const) });
    else if (kind === "erase_image") sequence.push({ op: "erase_image", img: pick([0, 1] as const) });
    else sequence.push({ op: kind });
  }
  return sequence;
}

/**
 * The replay, as a function of the test's own session: it applies each sequence's arrivals to the ledger as rows, calls
 * public.moderation_apply after each and notes what the post and its images then are, and undoes the sequence before the
 * next (a block that ends in an exception rolls its writes back, while what it noted in a variable stays). It writes the
 * ledger's rows itself, with their times, so it needs the triggers of decisions and decision_actions switched off: only
 * the migrator can do that, and only inside the transaction the test rolls back.
 */
const REPLAY = `
create function pg_temp.replay(p_post uuid, p_images uuid[], p_author uuid, p_staff uuid, p_cases uuid[], p_snapshots uuid[], p_answers uuid[], p_intakes uuid[], p_base timestamptz, p_sequences jsonb)
returns jsonb language plpgsql as $fn$
declare
  results jsonb := '[]'::jsonb;
  steps jsonb;
  seq jsonb;
  arrival jsonb;
  op text;
  n integer;
  tick integer;
  spare integer;
  stamp timestamptz;
  keys jsonb;
  made uuid;
  row_id uuid;
  target uuid;
begin
  for seq in select t.value from jsonb_array_elements(p_sequences) with ordinality as t(value, place) order by t.place loop
    steps := '[]'::jsonb;
    begin
      keys := '{}'::jsonb;
      tick := 0;
      spare := 0;
      for arrival in select t.value from jsonb_array_elements(seq) with ordinality as t(value, place) order by t.place loop
        tick := tick + 1;
        stamp := p_base + make_interval(secs => tick);
        op := arrival ->> 'op';
        n := (arrival ->> 'c')::integer;
        if op in ('measure', 'seal') then
          insert into public.decisions (case_id, kind, seen_state_version, through_seq, outcome, ground, rule_id, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                                        facts_digest, reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
          values (p_cases[n], (arrival ->> 'd')::public.decision_kind, 0, 0, 'restricted', 'incompatible', 'R1', 2, 1, 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'report', p_snapshots[n], repeat('a', 64),
                  repeat('b', 64), repeat('c', 64), p_staff, stamp, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), stamp, false, false, false)
          returning id into made;
          insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, created_at)
          values (made, (case when op = 'seal' then 'seal_media' else arrival ->> 'k' end)::public.action_kind,
                  case when (arrival ->> 'img') is not null then p_images[(arrival ->> 'img')::integer + 1] end, p_author,
                  case when op = 'measure' then p_post end, stamp)
          returning id into row_id;
          if op = 'seal' then
            insert into public.seal_posts (action_id, post_id, images) values (row_id, p_post, cardinality(p_images));
          end if;
          keys := keys || jsonb_build_object(arrival ->> 'key', row_id);
        elsif op = 'lift' then
          target := (keys ->> (arrival ->> 'key'))::uuid;
          insert into public.decisions (case_id, kind, reviews_decision_id, seen_state_version, through_seq, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest,
                                        reason_digest, decided_by, decided_at, xact, puid, informed_at, suspect, needs_admin, ended_interim)
          select x.case_id, 'correction', x.id, 0, 0, 'reversed', 2, 1, x.category, 'report', x.snapshot_id, x.snapshot_digest,
                 repeat('d', 64), p_staff, stamp, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), stamp, false, false, false
            from public.decisions x join public.decision_actions y on y.decision_id = x.id where y.id = target
          returning id into made;
          insert into public.decision_actions (decision_id, kind, media_id, subject_account_id, post_id, reverses_action_id, created_at)
          select made, (case when y.kind = 'seal_media' then 'unseal_media' when y.kind in ('withhold', 'remove') then 'restore' else 'restore_media' end)::public.action_kind,
                 y.media_id, y.subject_account_id, y.post_id, y.id, stamp
            from public.decision_actions y where y.id = target;
        elsif op = 'close' then
          update public.intake_items i set answered_by = p_answers[n], outcome = 'no_violation' where i.case_id = p_cases[n] and i.answered_by is null;
          update public.cases k set closed_at = coalesce(k.closed_at, stamp), answered_seq = k.intake_seq where k.id = p_cases[n];
        elsif op = 'answer' then
          update public.intake_items i set answered_by = p_answers[n], outcome = 'no_violation' where i.case_id = p_cases[n] and i.suspect and i.answered_by is null;
        elsif op = 'suspect' then
          if exists (select 1 from public.cases k where k.id = p_cases[n] and k.closed_at is null) then
            spare := spare + 1;
            insert into public.intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle)
            select p_intakes[spare], k.id, k.target_type, k.target_id, 1, 0, case when k.target_type = 'account' then 'named' end from public.cases k where k.id = p_cases[n]
            returning id into row_id;
            update public.intake_items i set created_at = stamp where i.id = row_id;
          end if;
        elsif op = 'erase' then
          update public.posts p set erased_at = stamp where p.id = p_post;
        elsif op = 'erase_image' then
          update public.post_media m set erased_at = stamp where m.id = p_images[(arrival ->> 'img')::integer + 1];
        elsif op = 'delete' then
          update public.posts p set state = 'deleted_by_author', body = '', deleted_at = stamp where p.id = p_post and p.state <> 'deleted_by_author';
        else
          raise exception 'the replay does not know the arrival %', op;
        end if;
        perform public.moderation_apply(array[p_post], true);
        steps := steps || (
          select jsonb_build_object('level', p.moderation_level, 'state', p.state,
                                    'images', (select jsonb_agg(m.moderation_state order by m.position) from public.post_media m where m.post_id = p.id),
                                    'hidden', p.hidden_at is not null, 'restored', p.restored_at is not null,
                                    'exploreShift', (extract(epoch from p.explore_from - p.created_at) * 1000000)::bigint)
            from public.posts p where p.id = p_post);
      end loop;
      raise exception 'undo' using errcode = 'KB001';
    exception when sqlstate 'KB001' then
      null;
    end;
    results := results || jsonb_build_array(steps);
  end loop;
  return results;
end $fn$`;

/**
 * The derivation and the posts' guard (3c design, section 6.2, property P1) against the real database. First
 * public.moderation_apply against the reference implementation above, over generated sequences of measures, reversals,
 * closures, answers and erasures on one post across three cases, in every order of arrival: after each arrival the
 * post's level, its state and each image's state are what the rules alone give, and where nothing in a set depends on
 * time every order ends the same. Then the named cases, by real decisions through the moderation module's decide, which
 * show that the triggers call the derivation where they must. Then the guard that leaves the moderation columns of posts
 * to it. Every test runs inside one transaction that is rolled back; the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the derivation of a post's level and its images' states, and the posts' guard", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mod: TestStaff;
  let admin: TestStaff;
  let before: Record<string, number>;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mod = await newTestStaff(authDb, migrateDb, repo, "moderator");
    admin = await newTestStaff(authDb, migrateDb, repo, "admin");
    before = await rowCounts(apiDb);
  }, 60_000);
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** One test's world: a transaction of the given pool that is rolled back, with both staff members' profiles in it. */
  const inWorld = (fn: (tx: DbTx) => Promise<void>, db: Db = apiDb) =>
    rolledBack(db, async (tx) => {
      await staffProfile(tx, mod);
      await staffProfile(tx, admin);
      await fn(tx);
    });
  const profile = (tx: DbTx) => newProfile(tx as unknown as Db);
  /** The error of one statement inside a transaction, which stays usable: the statement runs in a savepoint. */
  const run = (tx: DbTx, statement: ReturnType<typeof sql>) => pgError(tx.transaction((sp) => sp.execute(statement)));
  const authorDeletes = (tx: DbTx, postId: string) => tx.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${postId}::uuid`);
  const removal = { kind: "final", actions: [act("remove")] } as const;
  const restore = (reviewsDecisionId: string) => ({ kind: "correction", reviewsDecisionId, actions: [act("restore")] }) as const;

  describe("moderation_apply against the reference implementation", () => {
    /**
     * The post with its two images, the three cases with their items, a snapshot and an answering decision for each case,
     * and four spare notices, in a transaction of the migrator; then the replay over the sequences, and what it noted.
     */
    async function replayed(sequences: readonly (readonly Arrival[])[]): Promise<Derived[][]> {
      let results: Derived[][] = [];
      await rolledBack(migrateDb, async (tx) => {
        const [author, staff, reporter] = [await profile(tx), await profile(tx), await profile(tx)];
        const postId = await newPostRow(tx, author.id);
        const images = [await newImageRow(tx, author.id, postId, 0), await newImageRow(tx, author.id, postId, 1)];
        const earlier = await openCase(tx, "post", postId);
        await tx.execute(sql`update cases set closed_at = now() - interval '2 days' where id = ${earlier}::uuid`);
        const cases = [earlier, await openCase(tx, "post", postId), await openCase(tx, "account", author.id)];
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId: cases[1]!, targetId: postId, lane: 0 });
        await insertItem(tx, { intakeId: await ruleReport(tx, reporter.id), caseId: cases[1]!, targetId: postId });
        await insertItem(tx, { intakeId: await csamNotice(tx), caseId: cases[2]!, targetType: "account", targetId: author.id, lane: 0, namedHandle: author.handle });
        // Everything the cases hold from the start is a day old; each arrival is a second later than the one before.
        const [{ base }] = (await tx.execute<{ base: string }>(sql`select (now() - interval '1 day')::text as base`)) as unknown as [{ base: string }];
        await tx.execute(sql`update intake_items set created_at = ${base}::timestamptz where case_id = any(${uuids(cases)})`);
        const spares = [await csamNotice(tx), await csamNotice(tx), await csamNotice(tx), await csamNotice(tx)];
        const snapshots: string[] = [];
        for (const [index, caseId] of cases.entries()) {
          const [row] = await tx.execute<{ id: string }>(sql`
            insert into evidence_snapshots (case_id, target_type, target_id, author_handle, digest)
            values (${caseId}::uuid, ${index === 2 ? "account" : "post"}::moderation_target, ${index === 2 ? author.id : postId}::uuid, 'author', ${"e".repeat(64)}) returning id`);
          snapshots.push(row!.id);
        }
        // From here on the ledger is written by hand: the decision triggers would refuse rows that no decision made.
        await tx.execute(sql`alter table public.decisions disable trigger user`);
        await tx.execute(sql`alter table public.decision_actions disable trigger user`);
        const answers: string[] = [];
        for (const [index, caseId] of cases.entries()) {
          const [row] = await tx.execute<{ id: string }>(sql`
            insert into decisions (case_id, kind, seen_state_version, through_seq, outcome, rules_version, redress_version, category, source, snapshot_id, snapshot_digest, decided_by, decided_at, xact,
                                   puid, informed_at, suspect, needs_admin, ended_interim)
            values (${caseId}::uuid, 'final', 0, 0, 'no_violation', 2, 1, 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'report', ${snapshots[index]!}::uuid, ${"e".repeat(64)}, ${staff.id}::uuid,
                    ${base}::timestamptz, pg_current_xact_id(), replace(gen_random_uuid()::text, '-', ''), ${base}::timestamptz, false, false, false)
            returning id`);
          answers.push(row!.id);
        }
        await tx.execute(sql.raw(REPLAY));
        const [row] = await tx.execute<{ results: Derived[][] }>(sql`
          select pg_temp.replay(${postId}::uuid, ${uuids(images)}, ${author.id}::uuid, ${staff.id}::uuid, ${uuids(cases)}, ${uuids(snapshots)}, ${uuids(answers)}, ${uuids(spares)},
                                ${base}::timestamptz, ${JSON.stringify(sequences)}::text::jsonb) as results`);
        results = row!.results;
        // The replay undid every sequence: the ledger holds nothing but the three answering decisions.
        const [left] = await tx.execute<{ decisions: number; actions: number }>(
          sql`select (select count(*)::int from decisions where case_id = any(${uuids(cases)})) as decisions, (select count(*)::int from decision_actions where subject_account_id = ${author.id}::uuid) as actions`,
        );
        expect({ ...left! }).toEqual({ decisions: 3, actions: 0 });
      });
      return results;
    }

    /** Runs every sequence and holds each step to the reference; answers the last step of each. */
    async function held(sequences: readonly (readonly Arrival[])[]): Promise<Derived[]> {
      const results = await replayed(sequences);
      expect(results).toHaveLength(sequences.length);
      sequences.forEach((sequence, index) => {
        const expected = reference(sequence);
        if (results[index]!.map(canonical).join() !== expected.map(canonical).join()) {
          // The whole sequence, so a failure can be replayed by hand.
          expect({ sequence, derived: results[index] }).toEqual({ sequence, derived: expected });
        }
      });
      return results.map((steps) => steps[steps.length - 1]!);
    }

    test("the reference itself: the strongest measure in force, a closed case's interim measure not in force, a seal over everything", () => {
      const steps = reference([
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r" },
        { op: "seal", c: 3, d: "interim", key: "s" },
        { op: "lift", key: "r" },
        { op: "answer", c: 3 },
        { op: "measure", c: 2, d: "final", k: "remove_media", img: 1, key: "i" },
        { op: "close", c: 2 },
        { op: "delete" },
      ]);
      expect(steps.map((step) => `${step.state}/${step.level} ${step.images.join(",")}`)).toEqual([
        "withheld/withheld visible,visible",
        "removed/removed visible,visible",
        "removed/removed sealed,sealed",
        "withheld/withheld sealed,sealed",
        "withheld/withheld visible,visible",
        "withheld/withheld visible,removed",
        "visible/visible visible,removed",
        "deleted_by_author/visible visible,removed",
      ]);
      // Explore's columns: hidden_at from the first step, which takes the post out of view; the moves between withheld and
      // removed set nothing; restored_at and explore_from when the case's closure gives the post back; deletion, nothing.
      const hiddenOnly = { hidden: true, restored: false, exploreShift: null };
      const given = { hidden: true, restored: true, exploreShift: 0 };
      expect(steps.map(({ hidden, restored, exploreShift }) => ({ hidden, restored, exploreShift }))).toEqual([hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, hiddenOnly, given, given]);
    });

    /** The distinct ends of the sequences, by level, state and images; Explore's columns depend on the path, not only on the end. */
    const ends = (results: Derived[]) =>
      [...new Set(results.map(({ level, state, images }) => JSON.stringify({ level, state, images })))].map((end) => JSON.parse(end) as Pick<Derived, "level" | "state" | "images">);

    test("a removal from an earlier case with its reversal, and a withhold and an image's removal from the open case with its closure, in every order of arrival: each step is the reference's, and every order ends the same", async () => {
      const sequences = orders([
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w2" },
        { op: "close", c: 2 },
        { op: "measure", c: 2, d: "final", k: "remove_media", img: 0, key: "i2" },
      ]);
      expect(sequences).toHaveLength(60);
      // Nothing here depends on time: whatever the order, the image's removal is all that is left.
      expect(ends(await held(sequences))).toEqual([{ level: "visible", state: "visible", images: ["removed", "visible"] }]);
    });

    test("image measures from two cases, a reversal, a closure and an erased image, in every order of arrival", async () => {
      const sequences = orders([
        { op: "measure", c: 1, d: "final", k: "remove_media", img: 0, key: "i1" },
        { op: "lift", key: "i1" },
        { op: "measure", c: 2, d: "interim", k: "withhold_media", img: 0, key: "j2" },
        { op: "measure", c: 2, d: "interim", k: "withhold_media", img: 1, key: "k2" },
        { op: "erase_image", img: 1 },
      ]);
      expect(sequences).toHaveLength(60);
      // The open case's withhold of the first image stands; the second image was erased, which outranks its withhold.
      expect(ends(await held(sequences))).toEqual([{ level: "visible", state: "visible", images: ["withheld", "removed"] }]);
    });

    test("two cases' removals with both reversals and the author's deletion, and an erasure against a reversal, in every order of arrival", async () => {
      const removals = orders([
        { op: "measure", c: 2, d: "final", k: "remove", key: "r2" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "lift", key: "r2" },
        { op: "delete" },
      ]);
      expect(removals).toHaveLength(30);
      expect(ends(await held(removals))).toEqual([{ level: "visible", state: "deleted_by_author", images: ["visible", "visible"] }]);
      // With the post's content erased, no reversal and no closure brings it back.
      const erased = orders([
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
        { op: "lift", key: "r1" },
        { op: "erase" },
        { op: "measure", c: 2, d: "interim", k: "withhold", key: "w2" },
        { op: "close", c: 2 },
      ]);
      expect(erased).toHaveLength(60);
      expect(ends(await held(erased))).toEqual([{ level: "removed", state: "removed", images: ["visible", "visible"] }]);
    });

    test("a seal taken while deciding, the answer to its suspect item, a later suspect item, and a seal for good with its lifting, in every order of arrival", async () => {
      const sequences = orders([
        { op: "seal", c: 2, d: "interim", key: "s2" },
        { op: "answer", c: 2 },
        { op: "suspect", c: 2 },
        { op: "seal", c: 3, d: "final", key: "s3" },
        { op: "lift", key: "s3" },
      ]);
      expect(sequences).toHaveLength(60);
      const results = await held(sequences);
      // The images end sealed only where the seal taken while deciding was taken after the later suspect item arrived and
      // that item was not answered since: an item that arrives after a seal's decision never brings the seal back.
      const sealed = sequences.filter((_, index) => results[index]!.images[0] === "sealed");
      expect(sealed).toHaveLength(10);
      for (const sequence of sealed) {
        const place = (wanted: (arrival: Arrival) => boolean) => sequence.findIndex(wanted);
        const [answer, suspect, seal] = [place((a) => a.op === "answer"), place((a) => a.op === "suspect"), place((a) => a.op === "seal" && a.c === 2)];
        expect(answer < suspect && suspect < seal, JSON.stringify(sequence)).toBe(true);
      }
      expect(ends(results).map((end) => end.level)).toEqual(expect.arrayContaining(["visible"]));
    });

    test("an account's seal taken while deciding, its case's closure, a seal for good with its lifting, and a removal of the post, in every order of arrival", async () => {
      const sequences = orders([
        { op: "seal", c: 3, d: "interim", key: "s3" },
        { op: "close", c: 3 },
        { op: "seal", c: 3, d: "final", key: "f3" },
        { op: "lift", key: "f3" },
        { op: "measure", c: 1, d: "final", k: "remove", key: "r1" },
      ]);
      expect(sequences).toHaveLength(60);
      // Every seal has ended or was lifted; the removal stands, and the images are not sealed whatever the post's level.
      expect(ends(await held(sequences))).toEqual([{ level: "removed", state: "removed", images: ["visible", "visible"] }]);
    });

    test("eighty drawn sequences of ten arrivals from everything that can arrive", async () => {
      const random = seeded(20261004);
      const sequences = Array.from({ length: 80 }, () => drawn(random, 10));
      const results = await held(sequences);
      // The draw reaches every level and every image state, so the comparison was not over one corner.
      expect(new Set(results.map((end) => end.level))).toEqual(new Set(["visible", "withheld", "removed"]));
      expect(new Set(results.flatMap((end) => end.images))).toEqual(new Set(["visible", "withheld", "removed", "sealed"]));
      expect(results.some((end) => end.state === "deleted_by_author")).toBe(true);
      // And Explore's columns in each of their states: never hidden, hidden and not given back, and given back.
      expect(new Set(results.map((end) => `${end.hidden}/${end.restored}`))).toEqual(new Set(["false/false", "true/false", "true/true"]));
    });
  });

  describe("the named cases, by real decisions", () => {
    test("case 2's interim withhold stays when case 1's removal of the post is reversed: the post ends withheld", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const first = await report(tx, aPost(p.postId));
        const removed = await decideIn(tx, mod, first.caseId, removal);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        const second = await report(tx, aPost(p.postId));
        expect(second.caseId).not.toBe(first.caseId);
        const withheld = await decideIn(tx, mod, second.caseId, { kind: "interim", actions: [act("withhold")] });
        expect((await actionsOf(tx, withheld))[0]!.no_effect).toBe("already");
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        await decideIn(tx, mod, first.caseId, restore(removed));
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });
        // And the withhold ends with its case.
        await decideIn(tx, mod, second.caseId, { kind: "final", outcome: "no_violation" });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
      });
    });

    test("two cases' removals: either reversed leaves the post removed, both reversed leave it visible, in either order", async () => {
      await inWorld(async (tx) => {
        for (const order of ["first", "second"] as const) {
          const p = await imagePost(tx);
          const one = await report(tx, aPost(p.postId));
          const removedOne = await decideIn(tx, mod, one.caseId, removal);
          const two = await report(tx, aPost(p.postId));
          const removedTwo = await decideIn(tx, mod, two.caseId, removal);
          expect((await actionsOf(tx, removedTwo))[0]!.no_effect).toBe("already");
          const [early, late] = order === "first" ? [[one.caseId, removedOne], [two.caseId, removedTwo]] : [[two.caseId, removedTwo], [one.caseId, removedOne]];
          await decideIn(tx, mod, early![0]!, restore(early![1]!));
          expect(await postRow(tx, p.postId), order).toMatchObject({ state: "removed", level: "removed" });
          await decideIn(tx, mod, late![0]!, restore(late![1]!));
          expect(await postRow(tx, p.postId), order).toMatchObject({ state: "visible", level: "visible" });
        }
      });
    });

    test("a lifted seal while another case's removal of the post is in force leaves the post removed and its images not sealed", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const rule = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, rule.caseId, removal);
        const suspect = await report(tx, aPost(p.postId), "csam");
        const seal = await decideIn(tx, admin, suspect.caseId, { kind: "final", ruleId: "R2", actions: [act("seal_media")] });
        // Sealed whatever the post's level.
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["sealed", "sealed"]);
        await decideIn(tx, admin, suspect.caseId, { kind: "correction", reviewsDecisionId: seal, actions: [act("unseal_media")] });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "removed", level: "removed" });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
      });
    });

    test("an interim withhold stays while a final decision leaves its case open, and ends when the case closes, with no restore", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        await report(tx, aPost(p.postId));
        const partial = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation", throughSeq: 1 });
        expect(await readCase(tx, caseId)).toMatchObject({ answered_seq: 1, intake_seq: 2, closed_at: null });
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });
        expect(await decisionRow(tx, partial)).toMatchObject({ ended_interim: false, author_mail: "none" });
        const closing = await decideIn(tx, mod, caseId, { kind: "final", outcome: "no_violation" });
        expect((await readCase(tx, caseId)).closed_at).not.toBeNull();
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
        expect(await actionsOf(tx, closing)).toEqual([]);
        // The author was told of the withhold, so they are told that it ended.
        expect(await decisionRow(tx, closing)).toMatchObject({ ended_interim: true, author_mail: "pending" });
      });
    });

    test("a deleted post's state stays deleted_by_author while its level follows the ledger", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        const { caseId } = await report(tx, aPost(p.postId));
        await authorDeletes(tx, p.postId);
        const removed = await decideIn(tx, mod, caseId, removal);
        expect((await actionsOf(tx, removed))[0]!.no_effect).toBe("deleted");
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "removed" });
        await decideIn(tx, mod, caseId, restore(removed));
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "visible" });
      });
    });

    test("erased content keeps a post, and an erased image, removed after every reversal", async () => {
      // As the migrator: only its erasure, which a later migration brings, writes the erasure times.
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const { caseId } = await report(tx, aPost(p.postId));
        const removed = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove"), act("remove_media", p.mediaIds[0]!), act("remove_media", p.mediaIds[1]!)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["removed", "removed"]);
        await tx.execute(sql`update posts set erased_at = now() where id = ${p.postId}::uuid`);
        await tx.execute(sql`update post_media set erased_at = now() where id = ${p.mediaIds[0]!}::uuid`);
        await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removed, actions: [act("restore"), act("restore_media", p.mediaIds[0]!), act("restore_media", p.mediaIds[1]!)] });
        expect(await postRow(tx, p.postId)).toEqual({ state: "removed", level: "removed", erased: true });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["removed", "visible"]);
      }, migrateDb);
    });

    test("image measures: a withheld image ends with its case, a removed one stays until it is reversed, and the post's own level never moves", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 2);
        const [one, two] = p.mediaIds as [string, string];
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold_media", one)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["withheld", "visible"]);
        const removed = await decideIn(tx, mod, caseId, { kind: "final", actions: [act("remove_media", two)] });
        // The case closed: what was withheld while deciding is visible again, and the removal stands.
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "removed"]);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "visible", level: "visible" });
        await decideIn(tx, mod, caseId, { kind: "correction", reviewsDecisionId: removed, actions: [act("restore_media", two)] });
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible", "visible"]);
      });
    });
  });

  describe("the posts' guard", () => {
    const guarded = { code: "42501", message: "moderation_column" };

    test("the API role moves a post's state only to the author's deletion: every other write of state, level or erasure is refused", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        expect(await run(tx, sql`update posts set state = 'withheld' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed', body = '' where id = ${p.postId}::uuid`)).toEqual(guarded);
        // The level and the erasure time are not the API role's to write at all.
        expect(await run(tx, sql`update posts set moderation_level = 'removed' where id = ${p.postId}::uuid`)).toMatchObject({ code: "42501" });
        expect(await run(tx, sql`update posts set erased_at = now() where id = ${p.postId}::uuid`)).toMatchObject({ code: "42501" });
        expect(await postRow(tx, p.postId)).toEqual({ state: "visible", level: "visible", erased: false });

        // A post a decision withheld or removed is not brought back by a write either.
        const { caseId } = await report(tx, aPost(p.postId));
        await decideIn(tx, mod, caseId, { kind: "interim", actions: [act("withhold")] });
        expect(await run(tx, sql`update posts set state = 'visible' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await run(tx, sql`update posts set state = 'removed' where id = ${p.postId}::uuid`)).toEqual(guarded);
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "withheld", level: "withheld" });

        // What the API writes on a post still passes on a withheld one: a counter, a statement that names the state
        // without changing it, and the author's deletion.
        expect(await run(tx, sql`update posts set like_count = like_count + 1, reply_count = reply_count + 1 where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = state, like_count = like_count + 1 where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${p.postId}::uuid`)).toBeNull();
        expect(await postRow(tx, p.postId)).toMatchObject({ state: "deleted_by_author", level: "withheld" });
      });
    });

    test("the API role inserts a post only as visible, at level visible and unerased, and with Explore's three columns forced null", async () => {
      await inWorld(async (tx) => {
        const author = await profile(tx);
        const insert = (columns: string, values: string) => run(tx, sql`insert into posts (author_id, body${sql.raw(columns)}) values (${author.id}::uuid, 'a post'${sql.raw(values)})`);
        for (const state of ["withheld", "removed", "deleted_by_author"]) expect(await insert(", state", `, '${state}'`), state).toEqual(guarded);
        for (const level of ["withheld", "removed"]) expect(await insert(", moderation_level", `, '${level}'`), level).toMatchObject({ code: "42501" });
        expect(await insert(", erased_at", ", now()")).toMatchObject({ code: "42501" });
        expect(await insert(", state", ", 'visible'")).toBeNull();
        expect(await insert("", "")).toBeNull();
        // 3e (explore_resume): whatever the insert supplies for hidden_at, restored_at and explore_from, the row holds null.
        const [row] = await tx.execute<{ hidden: string | null; restored: string | null; from: string | null }>(sql`
          insert into posts (author_id, body, hidden_at, restored_at, explore_from) values (${author.id}::uuid, 'forced', now() - interval '1 day', now(), now() - interval '1 hour')
          returning hidden_at as hidden, restored_at as restored, explore_from as from`);
        expect(row).toEqual({ hidden: null, restored: null, from: null });
      });
    });

    test("a post never leaves deleted_by_author, for the migrator either; everything else the migrator may write", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx);
        expect(await run(tx, sql`update posts set state = 'removed', moderation_level = 'removed', erased_at = now() where id = ${p.postId}::uuid`)).toBeNull();
        expect(await run(tx, sql`update posts set state = 'visible', moderation_level = 'visible', erased_at = null where id = ${p.postId}::uuid`)).toBeNull();
        await authorDeletes(tx, p.postId);
        for (const state of ["visible", "withheld", "removed"]) {
          expect(await run(tx, sql`update posts set state = ${state}::post_state where id = ${p.postId}::uuid`), state).toEqual(guarded);
        }
        // The level of a deleted post still follows the ledger.
        expect(await run(tx, sql`update posts set moderation_level = 'removed' where id = ${p.postId}::uuid`)).toBeNull();
        const author = await profile(tx);
        expect(await run(tx, sql`insert into posts (author_id, body, state, moderation_level) values (${author.id}::uuid, 'restored', 'removed', 'removed')`)).toBeNull();
        // The migrator's insert keeps Explore's three columns as given (3e, explore_resume), as a restore of a copy needs.
        const [row] = await tx.execute<{ kept: boolean }>(sql`
          insert into posts (author_id, body, hidden_at, restored_at, explore_from) values (${author.id}::uuid, 'restored', now() - interval '1 day', now(), now() - interval '1 hour')
          returning hidden_at = now() - interval '1 day' and restored_at = now() and explore_from = now() - interval '1 hour' as kept`);
        expect(row!.kept).toBe(true);
      }, migrateDb);
    });

    test("the API role can call neither the writer of the moderation columns nor what only it calls, and writes no seal's list", async () => {
      await inWorld(async (tx) => {
        const p = await imagePost(tx, 1);
        const denied = (name: string) => expect.objectContaining({ code: "42501", message: expect.stringMatching(new RegExp(`permission denied for function ${name}`)) });
        expect(await run(tx, sql`select public.moderation_apply(${uuids([p.postId])}, true)`)).toEqual(denied("moderation_apply"));
        expect(await run(tx, sql`select public.item_current_outcome(${p.postId}::uuid, now())`)).toEqual(denied("item_current_outcome"));
        expect(await run(tx, sql`select public.account_is_staff(${p.authorId}::uuid)`)).toEqual(denied("account_is_staff"));
        expect(await run(tx, sql`select public.staff_party_conflict(${mod.id}::uuid, ${uuids([p.authorId])}, null)`)).toEqual(denied("staff_party_conflict"));
        expect(await run(tx, sql`insert into seal_posts (action_id, post_id, images) values (gen_random_uuid(), ${p.postId}::uuid, 1)`)).toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table seal_posts/) });
        expect(await refusal(tx.transaction((sp) => sp.execute(sql`update post_media set moderation_state = 'sealed' where id = ${p.mediaIds[0]!}::uuid`)))).toMatch(/^42501 /);
        expect(await imageStates(tx, p.mediaIds)).toEqual(["visible"]);
      });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Replace `apps/api/test/integration/moderation-fixtures.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";
import pino from "pino";
import {
  RULE_DEFAULT_CATEGORY,
  TIMED_KINDS,
  compareDecisionActions,
  textDigest,
  type ActionKind,
  type AppealsReviewedParams,
  type CaseDecidedParams,
  type RuleId,
  type TdbCategory,
  type TimedKind,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { REDRESS_VERSION, RULES_VERSION } from "@korbat/rules";
import type { ActiveStaffSession, AuthForModeration, StaffStepUpConfirmed } from "../../src/auth";
import type { AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { mediaForCases, type MediaForCases } from "../../src/media";
import { createMediaFiles } from "../../src/media/files";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { review } from "../../src/moderation/appeals";
import { ModerationError, createBackground, isModerationErrorCode, type Background, type ModerationDeps } from "../../src/moderation/context";
import { decide } from "../../src/moderation/decide";
import { recordIntake, type IntakeGround, type IntakeRecorded, type LiveTarget } from "../../src/moderation/intake";
import { socialForModeration } from "../../src/social";
import { newProfile } from "./social-fixtures";
import { newStaffKey } from "./staff-fixtures";

/**
 * Rows for the database tests of the moderation tables (3c design, sections 6.1 and 6.2), written as SQL the way the
 * intake transaction writes them: an insert names only what the API supplies, and the triggers of migrations 0015 and
 * 0016 force the rest. The helpers take a pool or a transaction, so a test chooses the role and whether anything commits.
 * The suites share one database, so a test leaves nothing behind: it runs inside a transaction that is rolled back, or,
 * where a second session must see its rows, it commits them and removes them again with removeFixtures.
 */
export type Runner = Db | DbTx;
export type TargetType = "post" | "account";

export const TC = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";
export const MINORS = "STATEMENT_CATEGORY_PROTECTION_OF_MINORS";
export const SPEECH = "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH";

/** 32 random bytes as lower-case hex: a salt, a digest's stand-in or a token's hash. */
export const hex64 = () => randomBytes(32).toString("hex");

/** A public reference as the API makes it: N- and ten base32 characters. */
export function newRef(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return `N-${Array.from(randomBytes(10), (byte) => alphabet[byte % 32]).join("")}`;
}

/** Null as SQL, any other value as a parameter. */
const orNull = (value: string | null | undefined, cast: string): SQL => (value === null || value === undefined ? sql`null` : sql`${value}::${sql.raw(cast)}`);

/** Ids as one uuid[] parameter. */
export const uuids = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;

/**
 * A post row straight in the table: these tests need the row, not the flow and its counters. It is dated a month back.
 * The suites share one database, and others read the public Latest timeline from its newest post down and Explore's
 * 48-hour window: a visible post dated now would stand among theirs, and dozens of them push theirs off the first page.
 */
export async function newPostRow(db: Runner, authorId: string, options: { quoteOfId?: string; replyToId?: string; body?: string; createdAt?: SQL } = {}): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into posts (author_id, body, quote_of_id, reply_to_id, created_at)
        values (${authorId}::uuid, ${options.body ?? "a post"}, ${orNull(options.quoteOfId, "uuid")}, ${orNull(options.replyToId, "uuid")}, ${options.createdAt ?? sql`now() - interval '30 days'`})
        returning id`,
  );
  return row!.id;
}

/**
 * A ready image of the account, on the post when one is given. The row is inserted on no post, which is the only way the
 * database takes one, and then attached with one update of post_id, position and alt text, as the media repository's
 * attach does.
 */
export async function newImageRow(db: Runner, ownerId: string, postId: string | null, position = 0): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`insert into post_media (owner_id, status, width, height, blurhash) values (${ownerId}::uuid, 'ready', 1200, 800, 'L2Eo_P_3jb_3~qoL') returning id`,
  );
  if (postId) await db.execute(sql`update post_media set post_id = ${postId}::uuid, position = ${position}, alt_text = ${`image ${position + 1}`} where id = ${row!.id}::uuid`);
  return row!.id;
}

export interface IntakeInput {
  kind?: "user" | "finding";
  channel?: "signed_in" | "signed_out" | "staff";
  reporterId?: string | null;
  findingBy?: string | null;
  contactId?: string | null;
  ruleId?: string | null;
  allegesIllegal?: boolean;
  csam?: boolean;
  category?: string;
  categoryKeyword?: string | null;
  citedLaw?: string | null;
  explanation?: string | null;
  bonaFide?: boolean;
  lookupHash?: string | null;
  ref?: string;
}

/** Inserts an intake with the ground's columns, as step 4.2 of the intake transaction does, and answers its id. */
export async function insertIntake(db: Runner, input: IntakeInput): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into intakes (kind, ref, lookup_hash, channel, reporter_id, finding_by, contact_id, rule_id, alleges_illegal, csam, category, category_keyword, cited_law, explanation, bona_fide)
    values (${input.kind ?? "user"}::intake_kind, ${input.ref ?? newRef()}, ${orNull(input.lookupHash, "text")}, ${input.channel ?? "signed_in"}::intake_channel,
            ${orNull(input.reporterId, "uuid")}, ${orNull(input.findingBy, "uuid")}, ${orNull(input.contactId, "uuid")}, ${orNull(input.ruleId, "text")},
            ${input.allegesIllegal ?? false}, ${input.csam ?? false}, ${input.category ?? TC}, ${orNull(input.categoryKeyword, "text")},
            ${orNull(input.citedLaw, "text")}, ${orNull(input.explanation, "text")}, ${input.bonaFide ?? false})
    returning id`);
  return row!.id;
}

/** A signed-in report under a korbat rule. */
export const ruleReport = (db: Runner, reporterId: string, ruleId = "R1") => insertIntake(db, { kind: "user", channel: "signed_in", reporterId, ruleId, category: TC });

/** A signed-in notice that the target is illegal, with its explanation and good-faith statement. */
export const illegalNotice = (db: Runner, reporterId: string) =>
  insertIntake(db, { kind: "user", channel: "signed_in", reporterId, allegesIllegal: true, category: SPEECH, explanation: "It breaks the law.", bonaFide: true });

/** A notice on the path for child sexual abuse material: signed out, no account, no contact, only the token's hash. */
export const csamNotice = (db: Runner) => insertIntake(db, { kind: "user", channel: "signed_out", csam: true, allegesIllegal: true, category: MINORS, lookupHash: hex64() });

/** A moderator's own finding under a rule. */
export const findingBy = (db: Runner, staffId: string, ruleId: string, category = TC) => insertIntake(db, { kind: "finding", channel: "staff", findingBy: staffId, ruleId, category });

/**
 * The target's open case, opened when there is none: the insert that does nothing on a conflict and the read of the
 * open case, as step 4.3 of the intake transaction runs them.
 */
export async function openCase(db: Runner, targetType: TargetType, targetId: string): Promise<string> {
  await db.execute(sql`insert into cases (target_type, target_id) values (${targetType}::moderation_target, ${targetId}::uuid) on conflict (target_type, target_id) where closed_at is null do nothing`);
  const [row] = await db.execute<{ id: string }>(sql`select id from cases where target_type = ${targetType}::moderation_target and target_id = ${targetId}::uuid and closed_at is null`);
  if (!row) throw new Error("the target has no open case");
  return row.id;
}

/** An item as the database stores it, with the columns these tests read. A raw read hands every time over as PostgreSQL's text. */
export interface ItemRow {
  id: string;
  intake_id: string;
  position: number;
  target_type: TargetType;
  target_id: string;
  named_handle: string | null;
  case_id: string | null;
  seq: number | null;
  lane: number;
  reporter_account_id: string | null;
  alleges_illegal: boolean;
  suspect: boolean;
  created_at: string;
  outcome: string | null;
  answered_by: string | null;
  outcome_sent_at: string | null;
  shown_outcome: string | null;
  revision_pending_at: string | null;
  revised_sent_at: string | null;
  outcome_mail: string;
  reexamines_item_id: string | null;
  statement: string | null;
  erased_at: string | null;
}

export interface ItemInput {
  intakeId: string;
  caseId: string | null;
  targetType?: TargetType;
  targetId: string;
  position?: number;
  lane?: number;
  namedHandle?: string | null;
  outcome?: string | null;
  reexaminesItemId?: string | null;
  /** Further columns and their values as SQL, for the tests that supply what the trigger forces. */
  extra?: Record<string, SQL>;
  /** A comment the statement carries, by which a test finds the session that runs it. */
  marker?: string;
}

/** Inserts one item and answers the row as the attach trigger left it. */
export async function insertItem(db: Runner, input: ItemInput): Promise<ItemRow> {
  const extra = Object.entries(input.extra ?? {});
  const names = extra.map(([name]) => sql.raw(`, ${name}`));
  const values = extra.map(([, value]) => sql`, ${value}`);
  const [row] = await db.execute<ItemRow & Record<string, unknown>>(sql`
    insert ${sql.raw(input.marker ? `/* ${input.marker} */` : "")} into intake_items (intake_id, case_id, target_type, target_id, position, lane, named_handle, outcome, reexamines_item_id${sql.join(names, sql``)})
    values (${input.intakeId}::uuid, ${orNull(input.caseId, "uuid")}, ${input.targetType ?? "post"}::moderation_target, ${input.targetId}::uuid, ${input.position ?? 1}, ${input.lane ?? 2},
            ${orNull(input.namedHandle, "text")}, ${orNull(input.outcome, "item_outcome")}, ${orNull(input.reexaminesItemId, "uuid")}${sql.join(values, sql``)})
    returning *`);
  return row!;
}

/** A case's derived columns. */
export interface CaseRow {
  id: string;
  lane: number;
  intake_seq: number;
  answered_seq: number;
  state_version: number;
  opened_at: string;
  oldest_open_at: string | null;
  last_decided_at: string | null;
  closed_at: string | null;
}

export async function readCase(db: Runner, id: string): Promise<CaseRow> {
  const [row] = await db.execute<CaseRow & Record<string, unknown>>(sql`select * from cases where id = ${id}::uuid`);
  return row!;
}

/** The items of a case, in the order they attached. */
export async function itemsOf(db: Runner, caseId: string): Promise<ItemRow[]> {
  const rows = await db.execute<ItemRow & Record<string, unknown>>(sql`select * from intake_items where case_id = ${caseId}::uuid order by seq`);
  return [...rows];
}

/**
 * A whole suspect intake on one target, as a notice on the CSAM path leaves it: the intake, the target's open case and
 * the item in lane 0. From its commit on, every post the case reaches is frozen.
 */
export async function suspectItemOn(db: Runner, targetType: TargetType, targetId: string, namedHandle: string | null = null): Promise<{ intakeId: string; caseId: string; item: ItemRow }> {
  const intakeId = await csamNotice(db);
  const caseId = await openCase(db, targetType, targetId);
  const item = await insertItem(db, { intakeId, caseId, targetType, targetId, lane: 0, namedHandle: targetType === "account" ? (namedHandle ?? "named") : null });
  return { intakeId, caseId, item };
}

/** Whether the post is frozen, as the role of the runner reads it. */
export async function postFrozen(db: Runner, postId: string): Promise<boolean> {
  const [row] = await db.execute<{ frozen: boolean }>(sql`select public.post_frozen(${postId}::uuid) as frozen`);
  return row!.frozen;
}

// ---------------------------------------------------------------- the moderation module on a pool or a transaction

/**
 * The tasks a request starts after its commit, for the module over a transaction: kept until `settle`, which runs them
 * one after the other. Over a pool they run at once, as on the server. Over a transaction they would share the test's
 * one connection with the test's own statements, and the transaction in which a mail's result is recorded (a savepoint
 * there) would open and roll back among the test's own savepoints. A test that reads what such a task did settles first.
 */
function deferredBackground(log: pino.Logger): Background {
  const queued: (() => Promise<void>)[] = [];
  const running = createBackground(log);
  return {
    start: (task) => void queued.push(task),
    async settle() {
      while (queued.length > 0) {
        running.start(queued.shift()!);
        await running.settle();
      }
    },
  };
}

/**
 * The moderation module's dependencies over a pool, or over a transaction that the test rolls back: the module opens its
 * own transactions on what it is given, which on a transaction are savepoints, so the intake and the decision run their
 * real statements and nothing commits.
 */
export function moderationDeps(db: Runner, overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  const log = pino({ level: "silent" });
  // A transaction can be rolled back; a pool cannot.
  const overTransaction = "rollback" in db;
  return {
    apiDb: db as Db,
    auth: noAuthForModeration(),
    social: socialForModeration(db as Db),
    media: casesMedia(db),
    limits: new MemoryStore(),
    background: overTransaction ? deferredBackground(log) : createBackground(log),
    config: loadConfig(),
    log,
    now: () => new Date(),
    ...overrides,
  };
}

/**
 * The auth module's interface for a test that stores no contact and sends no mail: every member throws, so a flow that
 * reaches one fails its test instead of passing by accident. A test of the notice routes passes the real interface. One
 * member answers: every read of the staff overview asks how many contacts the janitor is late with, and here none is.
 */
export function noAuthForModeration(): AuthForModeration {
  return new Proxy({} as AuthForModeration, {
    get: (_target, member) =>
      typeof member !== "string" || member === "then"
        ? undefined
        : member === "overdueContacts"
          ? async () => 0
          : () => {
            throw new Error(`this test built the moderation module without the auth module, and ${member} was called`);
          },
  });
}

/** The folders that casesMedia made in this test process, removed when the process ends. */
const caseVolumes = new Set<string>();
process.once("exit", () => {
  for (const root of caseVolumes) rmSync(root, { recursive: true, force: true });
});

/**
 * The media module's interface for cases over a pool or a transaction, as the server hands it to the moderation module.
 * Its volumes are folders that nothing creates: the database tests lock, hold and count image rows and never open a
 * file, and a test that does builds the interface over a store of its own. One thing is written all the same: the
 * disposal deletes no row whose files it cannot note as owed, so the first time an interface made here is asked to note
 * or to request a deletion, the two directories of deletion requests are created under a folder of that interface's
 * own. What one test wrote there is never read through another test's interface.
 */
export function casesMedia(db: Runner): MediaForCases {
  const log = pino({ level: "silent" });
  const root = path.join(tmpdir(), "korbat-test-case-volumes", randomUUID());
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log });
  /** The write, with the two directories made before the first one. */
  const writing = (write: (ids: readonly string[]) => Promise<void>) => async (ids: readonly string[]) => {
    if (!caseVolumes.has(root)) {
      for (const dir of [files.uploads.deletions, files.uploads.owed]) mkdirSync(dir, { recursive: true });
      caseVolumes.add(root);
    }
    await write(ids);
  };
  return mediaForCases({ repo: createMediaRepo(db as Db), files: { ...files, oweDeletion: writing(files.oweDeletion), requestDeletion: writing(files.requestDeletion) }, log });
}

const NO_GROUND = { reporterId: null, findingBy: null, contactId: null, ruleId: null, allegesIllegal: false, csam: false, categoryKeyword: null, citedLaw: null, explanation: null, bonaFide: false } as const;

/** What an intake alleges and who sent it, for each way a report arrives. */
export const ground = {
  /** A signed-in report under a korbat rule. */
  rule: (reporterId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_in", reporterId, ruleId, category: TC }),
  /** A notice that the target is illegal: signed in, or signed out without a contact when no reporter is given. */
  illegal: (reporterId: string | null, category: TdbCategory = SPEECH): IntakeGround => ({
    ...NO_GROUND,
    kind: "user",
    channel: reporterId === null ? "signed_out" : "signed_in",
    reporterId,
    allegesIllegal: true,
    category,
    explanation: "It breaks the law.",
    bonaFide: true,
  }),
  /** A notice on the path for child sexual abuse material: no account, no contact. */
  csam: (): IntakeGround => ({ ...NO_GROUND, kind: "user", channel: "signed_out", allegesIllegal: true, csam: true, category: MINORS }),
  /** A moderator's own finding under a rule; citing R2 it is suspect. */
  finding: (staffId: string, ruleId: RuleId = "R1"): IntakeGround => ({ ...NO_GROUND, kind: "finding", channel: "staff", findingBy: staffId, ruleId, category: RULE_DEFAULT_CATEGORY[ruleId] }),
};

/** One intake through the module's own transaction. A single target gets position 1. */
export function intake(db: Runner, ground: IntakeGround, targets: LiveTarget | readonly LiveTarget[]): Promise<IntakeRecorded> {
  const live = Array.isArray(targets) ? (targets as readonly LiveTarget[]) : [targets as LiveTarget];
  return recordIntake(moderationDeps(db), { ground, live });
}

/** A post as an intake's first target. */
export const aPost = (id: string, position = 1): LiveTarget => ({ type: "post", id, position });
/** An account as an intake's first target, named by a handle. */
export const anAccount = (id: string, namedHandle = "named", position = 1): LiveTarget => ({ type: "account", id, position, namedHandle });

/** An author (a new profile unless one is given) and a post of theirs with this many images. */
export async function imagePost(db: Runner, images = 0, authorId?: string, options: { quoteOfId?: string; replyToId?: string } = {}): Promise<{ authorId: string; postId: string; mediaIds: string[] }> {
  const owner = authorId ?? (await newProfile(db as Db)).id;
  const postId = await newPostRow(db, owner, options);
  const mediaIds: string[] = [];
  for (let position = 0; position < images; position++) mediaIds.push(await newImageRow(db, owner, postId, position));
  return { authorId: owner, postId, mediaIds };
}

/**
 * One report about the target by someone new, into the target's open case (opened when there is none): under a rule, as
 * a notice of illegality, or on the path for child sexual abuse material, which records no sender.
 */
export async function report(db: Runner, target: LiveTarget, by: "rule" | "illegal" | "csam" = "rule", rule: RuleId = "R1"): Promise<{ caseId: string; recorded: IntakeRecorded }> {
  const sender = by === "csam" ? null : (await newProfile(db as Db)).id;
  const recorded = await intake(db, by === "csam" ? ground.csam() : by === "illegal" ? ground.illegal(sender) : ground.rule(sender!, rule), target);
  return { caseId: recorded.items.find((item) => item.position === target.position)!.caseId!, recorded };
}

// ---------------------------------------------------------------- staff and decisions

/** A staff account as the database tests need it: its id, a live staff key of its own and its role. It has no profile until a test gives it one. */
export interface TestStaff {
  id: string;
  keyId: string;
  role: "moderator" | "admin";
}

/**
 * A live staff account with one live key, committed on the auth side: the decision triggers read the account's role and
 * the audit function its key, in the auth schema, which a transaction of the API role cannot write. The key's public key
 * is a placeholder: no test that commits an audit row signs with it.
 */
export async function newTestStaff(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator"): Promise<TestStaff> {
  const { user, key } = await newStaffKey(authDb, migrateDb, repo, role);
  return { id: user.id, keyId: key.id, role };
}

/** The staff account's profile row, which a decision, a finding and a staff text refer to. Its handle is random. */
export async function staffProfile(db: Runner, staff: { id: string }): Promise<void> {
  await db.execute(sql`insert into profiles (id, handle, display_name) values (${staff.id}::uuid, ${`st_${randomBytes(5).toString("hex")}`}, 'Staff')`);
}

/** Saves a staff text on a case as the console will: a fresh salt, and the digest of the salt and the text. Answers the digest. */
export async function saveText(db: Runner, caseId: string, authorId: string, kind: string, text = `a ${kind} text ${randomUUID()}`): Promise<string> {
  const salt = hex64();
  const digest = await textDigest(salt, text);
  await db.execute(sql`insert into staff_texts (case_id, author_id, kind, text, salt, digest) values (${caseId}::uuid, ${authorId}::uuid, ${kind}::staff_text_kind, ${text}, ${salt}, ${digest})`);
  return digest;
}

/** The case's newest snapshot, as a decision names it. */
export async function newestSnapshot(db: Runner, caseId: string): Promise<{ id: string; digest: string }> {
  const [row] = await db.execute<{ id: string; digest: string }>(sql`select id, digest from evidence_snapshots where case_id = ${caseId}::uuid order by taken_at desc, id desc limit 1`);
  if (!row) throw new Error("the case holds no snapshot");
  return { id: row.id, digest: row.digest };
}

/** What a test says about a decision; everything left out is filled in from the case as the console would. */
export interface DecisionInput {
  /** `interim` unless said. */
  kind?: "interim" | "final" | "correction";
  /** `restricted` for an interim or final decision, `reversed` for a correction, unless said. */
  outcome?: CaseDecidedParams["outcome"];
  /** For a restriction `incompatible` unless said; else none. */
  ground?: "incompatible" | "illegal" | null;
  /** R1 for the ground `incompatible` unless said. */
  ruleId?: RuleId | null;
  category?: TdbCategory;
  categoryKeyword?: "KEYWORD_TERRORIST_CONTENT" | null;
  /** A suspension's, a termination's and a restriction of reporting's days and whether it is announced go with it. */
  actions?: readonly { kind: ActionKind; mediaId?: string | null; days?: number | null; announced?: boolean }[];
  /** For a final decision the case's newest item unless said. */
  throughSeq?: number;
  /** The case's version now unless said. */
  stateVersion?: number;
  reviewsDecisionId?: string | null;
  snapshotId?: string;
  snapshotDigest?: string;
  /** Each text is saved fresh where the decision needs one, unless a digest (or null) is given. */
  factsDigest?: string | null;
  reasonDigest?: string | null;
  legalReferenceDigest?: string | null;
  rulesVersion?: number;
  redressVersion?: number;
  /**
   * 3e (design, section 12): a final restriction signs the strike the database computes (strike_due, asked with leave_out
   * null, as the console asks it), and a correction that reverses a decision whole signs the overruling of its strike.
   * `strike` and `overrule` set either by hand, for the tests of the database's refusals; left out, the fixture asks.
   */
  strike?: boolean;
  overrule?: boolean;
  /** The items the decision marks "manifestly unfounded"; [] unless said. */
  unfounded?: readonly string[];
  /** Whether a correction withdraws an announced measure for another; false unless said. */
  replaced?: boolean;
}

/** A measure on the post, the account's field or the case's images; an image measure with its image. */
export const act = (kind: ActionKind, mediaId: string | null = null) => ({ kind, mediaId });

/** A suspension, a termination or a restriction of reporting with its days (null for a termination) and whether it is announced. */
export const timed = (kind: "suspend" | "terminate" | "restrict_reporting", days: number | null, announced: boolean) => ({ kind, mediaId: null, days, announced });

/** An action entry in the shape the params sign: the three timed kinds carry their days and whether they are announced. */
function signedAction(action: { kind: ActionKind; mediaId?: string | null; days?: number | null; announced?: boolean }): CaseDecidedParams["actions"][number] {
  if ((TIMED_KINDS as readonly string[]).includes(action.kind)) {
    return { kind: action.kind as TimedKind, mediaId: null, days: action.days ?? null, announced: action.announced ?? false };
  }
  return { kind: action.kind as Exclude<ActionKind, TimedKind>, mediaId: action.mediaId ?? null };
}

/**
 * Whether the database gives a strike to a final restriction of this case on this ground and rule that answers the
 * items through `throughSeq`: strike_due with leave_out null, asked with the suspicion the decision will rest on (an
 * answered item that is suspect), as the console asks it with the case answer's strikeDue.
 */
export async function strikeDueFor(db: Runner, caseId: string, ground: "incompatible" | "illegal" | null, ruleId: string | null, throughSeq: number): Promise<boolean> {
  const [row] = await db.execute<{ due: boolean }>(
    sql`select public.strike_due(${caseId}::uuid, ${ground}::decision_ground, ${ruleId}::text,
                 exists (select 1 from intake_items i join cases c on c.id = i.case_id
                          where i.case_id = ${caseId}::uuid and i.suspect and i.seq > c.answered_seq and i.seq <= ${throughSeq}::int), null) as due`,
  );
  return row?.due ?? false;
}

/** Whether a decision holds a strike that no overruling reversed: a correction or a review that reverses it whole signs its overruling. */
export async function holdsStandingStrike(db: Runner, decisionId: string): Promise<boolean> {
  const [row] = await db.execute<{ held: boolean }>(
    sql`select exists (select 1 from decision_actions a where a.decision_id = ${decisionId}::uuid and a.kind = 'strike'
                         and not exists (select 1 from decision_actions r where r.reverses_action_id = a.id)) as held`,
  );
  return row?.held ?? false;
}

/**
 * The params of a decision on the case as the console builds them: the case's version, the range a final decision
 * answers, the newest snapshot with its digest, the digests of freshly saved texts, the actions in their one order with
 * the strike or the overruling the database expects, and 3e's two members.
 */
export async function decisionParams(db: Runner, staff: { id: string }, caseId: string, input: DecisionInput = {}): Promise<CaseDecidedParams> {
  const kind = input.kind ?? "interim";
  const outcome = input.outcome ?? (kind === "correction" ? "reversed" : "restricted");
  const groundOf = input.ground !== undefined ? input.ground : outcome === "restricted" ? "incompatible" : null;
  const ruleId = input.ruleId !== undefined ? input.ruleId : groundOf === "incompatible" ? "R1" : null;
  const current = await readCase(db, caseId);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, caseId);
  let category: TdbCategory = input.category ?? (ruleId !== null ? RULE_DEFAULT_CATEGORY[ruleId] : groundOf === "illegal" ? SPEECH : TC);
  let rulesVersion = input.rulesVersion ?? RULES_VERSION;
  if (kind === "correction" && input.reviewsDecisionId) {
    // A correction carries the category and the rules version of the decision it corrects.
    const [corrected] = await db.execute<{ category: TdbCategory; rules_version: number }>(sql`select category, rules_version from decisions where id = ${input.reviewsDecisionId}::uuid`);
    category = input.category ?? corrected?.category ?? category;
    rulesVersion = input.rulesVersion ?? corrected?.rules_version ?? rulesVersion;
  }
  const throughSeq = input.throughSeq ?? (kind === "final" ? current.intake_seq : 0);
  const actions = (input.actions ?? []).map(signedAction);
  // The strike of a final restriction, exactly when the database gives one; the overruling of a full reversal's strike.
  const strike = input.strike ?? (kind === "final" && outcome === "restricted" && (await strikeDueFor(db, caseId, groundOf, ruleId, throughSeq)));
  if (strike && !actions.some((action) => action.kind === "strike")) actions.push({ kind: "strike", mediaId: null });
  const overrule = input.overrule ?? (kind === "correction" && outcome === "reversed" && !!input.reviewsDecisionId && (await holdsStandingStrike(db, input.reviewsDecisionId)));
  if (overrule && !actions.some((action) => action.kind === "overrule")) actions.push({ kind: "overrule", mediaId: null });
  const text = async (given: string | null | undefined, needed: boolean, textKind: string) => (given !== undefined ? given : needed ? await saveText(db, caseId, staff.id, textKind) : null);
  return {
    kind,
    stateVersion: input.stateVersion ?? current.state_version,
    throughSeq,
    reviewsDecisionId: input.reviewsDecisionId ?? null,
    snapshotId: input.snapshotId ?? snapshot.id,
    snapshotDigest: input.snapshotDigest ?? snapshot.digest,
    outcome,
    ground: groundOf,
    ruleId,
    rulesVersion,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category,
    categoryKeyword: input.categoryKeyword ?? null,
    actions: actions.sort(compareDecisionActions),
    factsDigest: await text(input.factsDigest, outcome === "restricted", "facts"),
    reasonDigest: await text(input.reasonDigest, outcome === "restricted" || kind === "correction", kind === "correction" ? "review_reason" : "reason"),
    legalReferenceDigest: await text(input.legalReferenceDigest, groundOf === "illegal", "legal_reference"),
    unfounded: [...(input.unfounded ?? [])].sort(),
    replaced: input.replaced ?? false,
  };
}

/**
 * A staff session and a confirmation as the staff routes hand them to the moderation module, made up: the hash and the
 * assertion are placeholders that audit-verify would refuse, so the audit row they lead to is only ever written inside a
 * transaction that is rolled back. A decision that commits is confirmed with a real key (moderation-decide.ts).
 */
export function madeUpConfirmation(staff: TestStaff, caseId: string, params: CaseDecidedParams, expiresAt = new Date(Date.now() + 10 * 60_000)): { session: ActiveStaffSession; confirmed: StaffStepUpConfirmed } {
  const now = new Date();
  return {
    session: {
      sessionId: hex64(),
      handle: randomUUID(),
      userId: staff.id,
      keyId: staff.keyId,
      role: staff.role,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    },
    confirmed: {
      action: "case_decided",
      target: { type: "case", id: caseId },
      params,
      actionHash: hex64(),
      keyId: staff.keyId,
      assertion: { authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" },
      expiresAt,
    },
  };
}

/** What the database raised, however deeply the driver wrapped it: its SQLSTATE, message and detail. */
export function raised(err: unknown): { code: string; message: string; detail: string | null } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && typeof (current as { code?: unknown }).code === "string" && /^[0-9A-Z]{5}$/.test((current as { code: string }).code)) {
      const found = current as { code: string; message?: unknown; detail?: unknown };
      return { code: found.code, message: String(found.message ?? ""), detail: typeof found.detail === "string" ? found.detail : null };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * A decision inside a transaction that the test rolls back, through the module's own decide: the decision's row, its
 * measures and its audit row, with a made-up confirmation of exactly these params. The deferred check, which a real
 * decision meets at its commit, is made to run right after, inside the same savepoint, so a decision it refuses leaves
 * nothing behind and a later decision of the test is checked alone. Answers the decision's id; a refusal is thrown as the
 * module throws it, with the detail the database gave.
 */
export async function decideWith(tx: DbTx, staff: TestStaff, caseId: string, params: CaseDecidedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, caseId, params);
  try {
    return await tx.transaction(async (sp) => {
      // The fixtures lift the routes' list of kinds (3e design, section 7.1 item 2): the database's rules are tested below the routes.
      const outcome = await decide(moderationDeps(sp), session, confirmed, { requestId: `req-${randomUUID()}` }, { allKinds: true });
      if (typeof outcome === "string") throw new Error(`the decision was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    // The check at commit raises its code as the triggers do; decide maps the same code when a real commit fails.
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the case as the console would build them. */
export async function decideIn(tx: DbTx, staff: TestStaff, caseId: string, input: DecisionInput = {}): Promise<string> {
  return decideWith(tx, staff, caseId, await decisionParams(tx, staff, caseId, input));
}

// ---------------------------------------------------------------- appeals and reviews

/**
 * The author's appeal of a decision, as the appeal route inserts it: the decision, the appellant and, when one is given,
 * the statement with a salt and a digest. The trigger of migration 0017 decides whether it is open. Answers its id.
 */
export async function appealOf(db: Runner, decisionId: string, appellantId: string, statement?: string): Promise<string> {
  const salt = statement === undefined ? null : hex64();
  const digest = statement === undefined || salt === null ? null : await textDigest(salt, statement);
  const [row] = await db.execute<{ id: string }>(
    sql`insert into appeals (decision_id, appellant_account_id, statement, statement_salt, statement_digest)
        values (${decisionId}::uuid, ${appellantId}::uuid, ${orNull(statement, "text")}, ${orNull(salt, "text")}, ${orNull(digest, "text")}) returning id`,
  );
  return row!.id;
}

/** An appeal's row as the triggers left it. */
export interface AppealRow {
  id: string;
  decision_id: string;
  appellant_account_id: string;
  statement: string | null;
  answered_by: string | null;
  result: string | null;
  answered_at: string | null;
  erased_at: string | null;
}

export async function appealRow(db: Runner, id: string): Promise<AppealRow> {
  const [row] = await db.execute<AppealRow & Record<string, unknown>>(sql`select * from appeals where id = ${id}::uuid`);
  return row!;
}

/** What a test says about a review; everything left out is filled in from the reviewed decision and its case as the console would. */
export interface ReviewInput {
  /** `kept` without reversals, `reversed` with them, unless said. */
  outcome?: AppealsReviewedParams["outcome"];
  actions?: readonly { kind: ActionKind; mediaId?: string | null }[];
  stateVersion?: number;
  /** The reviewed decision's pending appeal unless said. */
  appealId?: string;
  snapshotId?: string;
  snapshotDigest?: string;
  /** A fresh review reason is saved unless a digest is given. */
  reasonDigest?: string;
  rulesVersion?: number;
  redressVersion?: number;
  category?: TdbCategory;
  /** 3e: a review that reverses the decision whole signs the overruling of its strike unless said. */
  overrule?: boolean;
}

/**
 * The params of a review of the decision as the console builds them: the case's version, the decision's pending appeal,
 * the newest snapshot with its digest, the reviewed decision's category and rules version, the digest of a freshly
 * saved review reason, and the reversals in their one order.
 */
export async function reviewParams(db: Runner, staff: { id: string }, decisionId: string, input: ReviewInput = {}): Promise<AppealsReviewedParams> {
  const [reviewed] = await db.execute<{ case_id: string; category: TdbCategory; rules_version: number; appeal_id: string | null }>(
    sql`select d.case_id, d.category, d.rules_version, (select a.id from appeals a where a.decision_id = d.id and a.answered_by is null) as appeal_id from decisions d where d.id = ${decisionId}::uuid`,
  );
  if (!reviewed) throw new Error("the review names a decision that does not exist");
  const current = await readCase(db, reviewed.case_id);
  const snapshot = input.snapshotId !== undefined && input.snapshotDigest !== undefined ? { id: input.snapshotId, digest: input.snapshotDigest } : await newestSnapshot(db, reviewed.case_id);
  const actions = (input.actions ?? []).map(signedAction);
  const outcome = input.outcome ?? (actions.length > 0 ? "reversed" : "kept");
  // A strike falls only with its whole finding: a review that reverses the decision overrules the strike it gave.
  const overrule = input.overrule ?? (outcome === "reversed" && (await holdsStandingStrike(db, decisionId)));
  if (overrule && !actions.some((action) => action.kind === "overrule")) actions.push({ kind: "overrule", mediaId: null });
  actions.sort(compareDecisionActions);
  return {
    stateVersion: input.stateVersion ?? current.state_version,
    // A review without a pending appeal is built all the same, so that a test can see who refuses it.
    appealId: input.appealId ?? reviewed.appeal_id ?? randomUUID(),
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.digest,
    outcome,
    rulesVersion: input.rulesVersion ?? reviewed.rules_version,
    redressVersion: input.redressVersion ?? REDRESS_VERSION,
    category: input.category ?? reviewed.category,
    actions,
    reasonDigest: input.reasonDigest ?? (await saveText(db, reviewed.case_id, staff.id, "review_reason")),
  };
}

/**
 * A review inside a transaction that the test rolls back, through the module's own review, with a made-up confirmation
 * of exactly these params, and its check at commit made to run right after, as decideWith does for a decision. Answers
 * the review's id; a refusal is thrown as the module throws it, with the detail the database gave.
 */
export async function reviewWith(tx: DbTx, staff: TestStaff, decisionId: string, params: AppealsReviewedParams): Promise<string> {
  const { session, confirmed } = madeUpConfirmation(staff, decisionId, params as unknown as CaseDecidedParams);
  const asReview: StaffStepUpConfirmed = { ...confirmed, action: "appeals_reviewed", target: { type: "decision", id: decisionId }, params };
  try {
    return await tx.transaction(async (sp) => {
      const outcome = await review(moderationDeps(sp), session, asReview, { requestId: `req-${randomUUID()}` }, { allKinds: true });
      if (typeof outcome === "string") throw new Error(`the review was not recorded: ${outcome}`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck immediate`);
      await sp.execute(sql`set constraints public.decisions_check, public.decision_actions_recheck deferred`);
      return outcome.decisionId;
    });
  } catch (err) {
    const refused = raised(err);
    if (!(err instanceof ModerationError) && refused?.code === "P0001" && isModerationErrorCode(refused.message)) {
      throw Object.assign(new ModerationError(refused.message), { detail: refused.detail });
    }
    throw err;
  }
}

/** The same, with the params filled in from the reviewed decision as the console would build them. */
export async function reviewIn(tx: DbTx, staff: TestStaff, decisionId: string, input: ReviewInput = {}): Promise<string> {
  return reviewWith(tx, staff, decisionId, await reviewParams(tx, staff, decisionId, input));
}

/** The code a flow or a statement was refused with, or null when it went through: a module's error code, or what the database raised. */
export async function refusal(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err instanceof ModerationError) return err.code;
    const fromDatabase = raised(err);
    if (fromDatabase) return fromDatabase.code === "P0001" ? fromDatabase.message : `${fromDatabase.code} ${fromDatabase.message}`;
    if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
    throw err;
  }
}

/** The detail a refusal at commit names: the member of the audit row, or the rule, that did not hold. */
export async function refusalDetail(promise: PromiseLike<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { detail?: string | null }).detail ?? raised(err)?.detail ?? null;
  }
}

/** A decision's row as the triggers left it, with the columns these tests read. */
export interface DecisionRow {
  id: string;
  case_id: string;
  kind: string;
  outcome: string;
  ground: string | null;
  rule_id: string | null;
  through_seq: number;
  answers_from_seq: number | null;
  source: string;
  suspect: boolean;
  unseen: boolean;
  needs_admin: boolean;
  ended_interim: boolean;
  author_mail: string;
  decided_by: string;
  automated_detection: boolean;
  automated_decision: string;
  territorial_scope: string;
  puid: string;
  redacted_at: string | null;
}

export async function decisionRow(db: Runner, id: string): Promise<DecisionRow> {
  const [row] = await db.execute<DecisionRow & Record<string, unknown>>(sql`select * from decisions where id = ${id}::uuid`);
  return row!;
}

/** A ledger row as the triggers left it. actionsOf answers a decision's rows in the order its params list them: by kind as a word, then by image. */
export interface ActionRow {
  id: string;
  decision_id: string;
  kind: ActionKind;
  media_id: string | null;
  subject_account_id: string;
  post_id: string | null;
  reverses_action_id: string | null;
  no_effect: string | null;
}

export async function actionsOf(db: Runner, decisionId: string): Promise<ActionRow[]> {
  const rows = await db.execute<ActionRow & Record<string, unknown>>(sql`select * from decision_actions where decision_id = ${decisionId}::uuid order by kind::text, media_id`);
  return [...rows];
}

/** A post's state, its level and whether its content was erased. */
export async function postRow(db: Runner, id: string): Promise<{ state: string; level: string; erased: boolean }> {
  const [row] = await db.execute<{ state: string; level: string; erased: boolean }>(sql`select state, moderation_level as level, erased_at is not null as erased from posts where id = ${id}::uuid`);
  return { ...row! };
}

/** Each image's moderation state, in the order asked. */
export async function imageStates(db: Runner, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string; state: string }>(sql`select id, moderation_state as state from post_media where id = any(${uuids(ids)})`);
  const byId = new Map([...rows].map((row) => [row.id, row.state]));
  return ids.map((id) => byId.get(id) ?? "missing");
}

/** The measures in force that the view names, as "kind" or "kind:image", sorted. */
export async function inForce(db: Runner, where: { caseId?: string; postId?: string }): Promise<string[]> {
  const rows = await db.execute<{ kind: string; media_id: string | null }>(
    sql`select kind, media_id from measures_in_force where ${where.caseId ? sql`case_id = ${where.caseId}::uuid` : sql`post_id = ${where.postId!}::uuid`} order by kind::text, media_id`,
  );
  return [...rows].map((row) => (row.media_id ? `${row.kind}:${row.media_id}` : row.kind));
}

/**
 * Deletes these cases with everything that hangs on them, and these intakes with their items, in the order the keep
 * trigger and the foreign keys ask for (removeFixtures says why). Both ids are uuid[] parameters.
 */
async function removeCasesIn(tx: DbTx, caseIds: SQL, intakeIds: SQL): Promise<void> {
  // 3e: the marks and the replies go first; a mark names an item, a reply its measure and its answering decision.
  await tx.execute(sql`delete from unfounded_marks where intake_id = any(${intakeIds}) or item_id in (select i.id from intake_items i where i.case_id = any(${caseIds}))
                         or decision_id in (select d.id from decisions d where d.case_id = any(${caseIds})) or withdrawn_by in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from suspension_replies where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))
                         or answered_by in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from intake_items where case_id = any(${caseIds}) or intake_id = any(${intakeIds})`);
  await tx.execute(sql`update media_holds set released_at = now() where case_id = any(${caseIds}) and released_at is null`);
  await tx.execute(sql`delete from media_holds where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from seal_posts where action_id in (select a.id from decision_actions a join decisions d on d.id = a.decision_id where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decision_actions where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from staff_texts where case_id = any(${caseIds})`);
  // An answered appeal and its review name each other: the answer is taken off the appeal, the reviews go, then the
  // appeals, then the decisions they appealed.
  await tx.execute(sql`update appeals set answered_by = null, result = null, answered_at = null where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds}) and kind = 'review'`);
  await tx.execute(sql`delete from appeals where decision_id in (select d.id from decisions d where d.case_id = any(${caseIds}))`);
  await tx.execute(sql`delete from decisions where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from evidence_snapshots where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from case_access_log where case_id = any(${caseIds})`);
  await tx.execute(sql`delete from cases where id = any(${caseIds})`);
  await untally(tx, intakeIds);
  await tx.execute(sql`delete from intakes where id = any(${intakeIds})`);
}

/**
 * Takes back what report_tallies_count added for these intakes before they are deleted (3e Task 5): every signed-in
 * report under a rule added 1 to its sender's tally of the UTC day it was received, and the API cannot write the table,
 * so a suite's cleanup lowers each such row by the intakes it deletes, as the migrator, and deletes a row that reaches
 * none. A sender whose profile goes too loses its rows outright (removeFixtures). `intakeIds` is a uuid[] parameter.
 */
export async function untally(tx: DbTx, intakeIds: SQL): Promise<void> {
  await tx.execute(sql`
    with counted as (
      select n.reporter_id as account_id, (n.received_at at time zone 'UTC')::date as day, count(*)::int as n from intakes n
       where n.id = any(${intakeIds}) and n.kind = 'user' and n.reporter_id is not null and not n.alleges_illegal and not n.csam
       group by 1, 2
    )
    update report_tallies t set reports = t.reports - c.n from counted c where t.account_id = c.account_id and t.day = c.day`);
  await tx.execute(sql`delete from report_tallies where reports <= 0`);
}

/**
 * Removes, as the migrator, what decisions about these posts left: the posts' cases with everything that hangs on them,
 * the findings of these staff accounts, and those accounts' profiles. The posts themselves stay, as their suites leave
 * them, and their levels are derived again, so none keeps a level that no decision gives it any more. 3e: the cases of
 * `accountIds` (those suspendForTest suspended) go too, with the accounts' replies, and their standing is derived again.
 */
export async function removeDecided(migrateDb: Db, postIds: readonly string[], staffIds: readonly string[], accountIds: readonly string[] = []): Promise<void> {
  if (postIds.length === 0 && staffIds.length === 0 && accountIds.length === 0) return;
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(
      sql`select id from cases where (target_type = 'post' and target_id = any(${uuids(postIds)})) or (target_type = 'account' and target_id = any(${uuids(accountIds)}))`,
    );
    await tx.execute(sql`delete from suspension_replies where account_id = any(${uuids(accountIds)})`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.finding_by = any(${uuids(staffIds)})`);
    await removeCasesIn(tx, caseIds, uuids(intakes.map((row) => row.id)));
    await tx.execute(sql`select public.moderation_apply(${uuids(postIds)}, true)`);
    // And their authors' standing, which a decision removed with its case may have held.
    await tx.execute(sql`select public.standing_apply(p.author_id) from posts p where p.id = any(${uuids(postIds)})`);
    await tx.execute(sql`select public.standing_apply(a.id) from unnest(${uuids(accountIds)}) as a(id)`);
    await tx.execute(sql`delete from profiles where id = any(${uuids(staffIds)})`);
  });
}

/**
 * Removes, as the migrator, everything a test committed about these profiles. Only a test whose second session must see
 * its rows commits them, and it calls this in a `finally`. The order is the one the keep trigger and the foreign keys
 * ask for: the items first (an unanswered suspect item freezes every image its case reaches, and the database then keeps
 * those rows against every delete); the holds released and then deleted (a release takes the image's hold_until back; a
 * delete of the hold's row would not); the seals' lists, the ledger and the texts before the decisions that own them, and
 * the decisions before the snapshots they name; access rows; the cases; the intakes of the items and of these reporters
 * and finders; then the image rows, the posts and the profiles. The audit rows of committed decisions stay: they are the
 * record, and audit-verify still accepts them.
 */
export async function removeFixtures(migrateDb: Db, profileIds: readonly string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const profiles = uuids(profileIds);
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const cases = await tx.execute<{ id: string }>(sql`
      select c.id from cases c
       where (c.target_type = 'account' and c.target_id = any(${profiles}))
          or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = any(${profiles})))`);
    const caseIds = uuids(cases.map((row) => row.id));
    const intakes = await tx.execute<{ id: string }>(sql`
      select distinct i.intake_id as id from intake_items i where i.case_id = any(${caseIds})
      union select n.id from intakes n where n.reporter_id = any(${profiles}) or n.finding_by = any(${profiles})`);
    const intakeIds = uuids(intakes.map((row) => row.id));
    // 3e: what these accounts hold in the tables of account sanctions, before their cases and their profiles.
    await tx.execute(sql`delete from unfounded_marks where account_id = any(${profiles})`);
    await tx.execute(sql`delete from report_tallies where account_id = any(${profiles})`);
    await tx.execute(sql`delete from suspension_replies where account_id = any(${profiles})`);
    await removeCasesIn(tx, caseIds, intakeIds);
    await tx.execute(sql`delete from post_media where owner_id = any(${profiles})`);
    await tx.execute(sql`delete from posts where author_id = any(${profiles})`);
    await tx.execute(sql`delete from profiles where id = any(${profiles})`);
  });
}

/** How many rows each table that these suites write holds. A suite reads it before its first test and after its last. */
export async function rowCounts(db: Runner): Promise<Record<string, number>> {
  const tables = ["cases", "intakes", "intake_items", "media_holds", "evidence_snapshots", "staff_texts", "case_access_log", "decisions", "decision_actions", "seal_posts", "appeals", "suspension_replies", "unfounded_marks", "report_tallies", "post_media", "posts", "profiles"];
  const columns = tables.map((table) => `(select count(*)::int from public.${table}) as ${table}`).join(", ");
  const [row] = await db.execute<Record<string, number>>(sql.raw(`select ${columns}`));
  return { ...row! };
}

/** The same for the moderation tables alone: what a suite that keeps its own posts and profiles is held to. */
export async function moderationCounts(db: Runner): Promise<Record<string, number>> {
  const kept = new Set(["post_media", "posts", "profiles"]);
  return Object.fromEntries(Object.entries(await rowCounts(db)).filter(([table]) => !kept.has(table)));
}

/**
 * How many rows the four auth tables of moderation cases hold (migration 0015: a notifier's contacts, confirmations and
 * stops, and the links of staff accounts to personal ones), read as the migrator: no other role may read all four.
 */
export async function authCaseCounts(migrateDb: Db): Promise<Record<string, number>> {
  const [row] = await migrateDb.execute<Record<string, number>>(
    sql`select (select count(*)::int from auth.notifier_contacts) as notifier_contacts, (select count(*)::int from auth.notifier_confirmations) as notifier_confirmations,
               (select count(*)::int from auth.notifier_suppressions) as notifier_suppressions, (select count(*)::int from auth.staff_personal_accounts) as staff_personal_accounts`,
  );
  return { ...row! };
}

/** A marker for one statement of one test: a word that no other statement holds. */
export const newMarker = () => `race_${randomBytes(6).toString("hex")}`;

/**
 * Resolves once a session is waiting for a lock while it runs a statement that carries the marker. A two-session test
 * waits for this instead of sleeping, so a loaded machine cannot make it read "did not wait" too early. The pool must be
 * of the waiting session's role: a role sees only its own sessions' statements.
 */
export async function untilBlocked(db: Db, marker: string, timeoutMs = 20_000): Promise<void> {
  const pattern = `%${marker}%`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like ${pattern}`,
    );
    if (row!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no session came to wait for a lock with the statement marked ${marker}`);
}

/** A promise with its resolver, for a transaction that stays open until the test lets it end. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * Retires the handle a profile holds as decision_actions_apply does it (3e design, section 6.2), as the migrator and
 * without a decision: its row of handle_history is written when missing and marked retired, and the profile gets a
 * placeholder of the right form and no change time. For the tests of the flows that refuse a retired handle; a real
 * retirement, with its decision, is standing-handles.test.ts's. Answers the handle and the placeholder. It commits.
 */
export async function retireHandleForTest(migrateDb: Db, profileId: string): Promise<{ handle: string; placeholder: string }> {
  const placeholder = `retired_${randomBytes(6).toString("hex")}`;
  return migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [row] = await tx.execute<{ handle: string }>(sql`select lower(handle) as handle from profiles where id = ${profileId}::uuid for update`);
    const handle = row!.handle;
    await tx.execute(sql`insert into handle_history (handle_lower, profile_id) values (${handle}, ${profileId}::uuid) on conflict do nothing`);
    await tx.execute(sql`update handle_history set retired_at = now() where handle_lower = ${handle} and profile_id = ${profileId}::uuid`);
    await tx.execute(sql`update profiles set handle = ${placeholder}, handle_changed_at = null where id = ${profileId}::uuid`);
    return { handle, placeholder };
  });
}

/**
 * Moves an account's standing back in time by the interval (3e design, section 12), as the migrator, and derives its
 * standing again: the only way a test meets a start, an end, an expiry, the frame of 90 days or finality after six
 * months, since the predicate reads the clock, every time is forced by a trigger, and no configuration shortens a number of
 * standing_rules(). It moves the decisions of every case about the account or its posts (their times, their notice
 * mail's time) with their ledger rows (created_at, starts_at, ends_at), the appeals of those decisions, the account's
 * replies, the marks of the reports it sent with those reports' times and its daily tallies of them, and its posts, so that a post made before or after a decision stays so (the
 * strike rule and the second threat compare the two). The interval is PostgreSQL's, such as "91 days". It commits.
 */
export async function ageStandingForTest(migrateDb: Db, accountId: string, interval: string): Promise<void> {
  await migrateDb.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const by = sql`${interval}::interval`;
    const account = sql`${accountId}::uuid`;
    const decisions = sql`(select d.id from decisions d join cases c on c.id = d.case_id
                            where (c.target_type = 'account' and c.target_id = ${account})
                               or (c.target_type = 'post' and c.target_id in (select p.id from posts p where p.author_id = ${account})))`;
    await tx.execute(sql`update decisions set decided_at = decided_at - ${by}, informed_at = informed_at - ${by}, author_mail_at = author_mail_at - ${by} where id in ${decisions}`);
    await tx.execute(sql`update decision_actions set created_at = created_at - ${by}, starts_at = starts_at - ${by}, ends_at = ends_at - ${by} where decision_id in ${decisions}`);
    await tx.execute(sql`update appeals set filed_at = filed_at - ${by}, answered_at = answered_at - ${by} where decision_id in ${decisions}`);
    await tx.execute(sql`update suspension_replies set filed_at = filed_at - ${by}, answered_at = answered_at - ${by}, erased_at = erased_at - ${by} where account_id = ${account}`);
    await tx.execute(sql`update unfounded_marks set reported_at = reported_at - ${by}, marked_at = marked_at - ${by}, withdrawn_at = withdrawn_at - ${by} where account_id = ${account}`);
    // 3e Task 5: the reports the account sent move with their marks, and its tallies by the interval's whole days, so that
    // a report and its mark leave the frame of report_frame_days together. A tally's row is a day, so it is moved by
    // deleting the account's rows and writing them again, which no two rows of one day can meet half way.
    await tx.execute(sql`update intakes set received_at = received_at - ${by} where reporter_id = ${account}`);
    const tallies = await tx.execute<{ day: string; reports: number }>(sql`delete from report_tallies where account_id = ${account} returning day::text as day, reports`);
    for (const tally of tallies) {
      await tx.execute(sql`insert into report_tallies (account_id, day, reports) values (${account}, (${tally.day}::date - date_trunc('day', justify_hours(${by})))::date, ${tally.reports}::int)
                           on conflict (account_id, day) do update set reports = report_tallies.reports + excluded.reports`);
    }
    // 3e Task 6: Explore's three columns of the posts move with them, so that explore_from - created_at still equals the
    // hidden spans the moved ledger gives.
    await tx.execute(sql`update posts set created_at = created_at - ${by}, deleted_at = deleted_at - ${by}, hidden_at = hidden_at - ${by}, restored_at = restored_at - ${by},
                                          explore_from = explore_from - ${by} where author_id = ${account}`);
    await tx.execute(sql`select public.standing_apply(${account})`);
  });
}

/**
 * Writes a suspension into an account's profile row as the migrator, as standing_apply derives one, without a decision:
 * for the tests of the write paths that obey the predicate (3e design, section 7.2), as retireHandleForTest stands in for
 * a retirement. `from` and `until` are PostgreSQL intervals from now (a suspension that runs: "-1 minute" and "1 day");
 * `reportsUntil`, when given, writes a restriction of reporting that ends that far from now. A real suspension, with its
 * decision, is suspendForTest's (moderation-decide.ts). It commits; liftRowForTest clears all three columns.
 */
export async function suspendRowForTest(migrateDb: Db, profileId: string, window: { from?: string; until?: string; reportsUntil?: string } = {}): Promise<void> {
  const from = window.from ?? "-1 minute";
  const until = window.until ?? "1 day";
  await migrateDb.execute(sql`update profiles set suspended_from = clock_timestamp() + ${from}::interval, suspended_until = clock_timestamp() + ${until}::interval,
                                 reports_restricted_until = ${window.reportsUntil === undefined ? null : sql`clock_timestamp() + ${window.reportsUntil}::interval`}
                               where id = ${profileId}::uuid`);
}

/** Clears what suspendRowForTest wrote. */
export async function liftRowForTest(migrateDb: Db, profileId: string): Promise<void> {
  await migrateDb.execute(sql`update profiles set suspended_from = null, suspended_until = null, reports_restricted_until = null where id = ${profileId}::uuid`);
}
```

### Replace `apps/api/test/integration/moderation-schema.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ACTION_KINDS, CSAM_KEYWORDS, DECISION_KEYWORDS, MEASURES, NOTICE_LIMITS, RULE_IDS, TDB_CATEGORIES, appealDeadline, textDigest } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { TEXT_DIGEST_VECTORS } from "../../../../packages/contracts/test/digest-vectors";
import { createAuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
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
  posts: ["body", "state", "deleted_at", "like_count", "repost_count", "reply_count", "quote_count"],
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

    test("posts: UPDATE of the seven columns the API writes, never of the moderation level or the erasure time; no DELETE, no TRUNCATE", async () => {
      expect(await tablePrivileges("korbat_api", "public.posts")).toEqual(["SELECT", "INSERT"]);
      expect((await updatableColumns("korbat_api", "public.posts")).sort()).toEqual([...COLUMN_UPDATES.posts!].sort());
    });

    test("post_media: UPDATE of the nine columns the API writes, never of the moderation state, the hold or the erasure time; DELETE stays, TRUNCATE never", async () => {
      expect(await tablePrivileges("korbat_api", "public.post_media")).toEqual(["SELECT", "INSERT", "DELETE"]);
      expect((await updatableColumns("korbat_api", "public.post_media")).sort()).toEqual([...COLUMN_UPDATES.post_media!].sort());
    });

    test("profiles: SELECT and INSERT, and since 3e UPDATE of the eleven columns the API writes, never DELETE or TRUNCATE", async () => {
      // 3e (design, section 6.1): the table's UPDATE became column grants, so the three derived columns stay the database's.
      expect(await tablePrivileges("korbat_api", "public.profiles")).toEqual(["SELECT", "INSERT"]);
      expect(await updatableColumns("korbat_api", "public.profiles")).toHaveLength(11);
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
      // section 11), and the five of 3e's standing ledger: the constants, a basis, the strike rule, the appeal's start and the terminations due.
      const callable = all.filter((f) => f.owner === "korbat_migrate" && f.api).map((f) => f.name);
      expect(callable).toEqual([
        "public.appeal_deadline",
        "public.appeal_informed_at",
        "public.appeal_reviewer_state",
        "public.append_confirmed_audit",
        "public.case_evidence_due_at",
        "public.decision_final_at",
        "public.delete_access_log",
        "public.erase_case_evidence",
        "public.erase_intake",
        "public.erase_statement_texts",
        "public.forget_reporter",
        "public.frozen_for",
        "public.intake_due_at",
        "public.post_frozen",
        "public.redact_r4_body",
        "public.release_outcomes",
        "public.review_needs_admin",
        "public.snapshot_withheld",
        "public.staff_case_conflict",
        "public.standing_basis_broken_at",
        "public.standing_rules",
        "public.strike_due",
        "public.sweep_staff_texts",
        "public.terminations_due",
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

    test("frozen_for is named only by post_frozen and by the keep trigger's function; post_frozen only by decisions_record, erase_snapshots and redact_r4_body", async () => {
      const all = await functions();
      const naming = (word: RegExp) => all.filter((f) => word.test(f.definition)).map((f) => f.name);
      // Each function's own definition holds its name.
      expect(naming(/\bfrozen_for\b/)).toEqual(["public.frozen_for", "public.post_frozen", "public.post_media_keep"]);
      // One function of 0016 reads the freeze: the one that stores whether a decision was taken while nobody could open the images.
      // And two of 0018: the one function that erases a snapshot (gate E), and the R4 redaction, which waits while its post is frozen.
      expect(naming(/\bpost_frozen\b/)).toEqual(["public.decisions_record", "public.erase_snapshots", "public.post_frozen", "public.redact_r4_body"]);
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
      // Of the three columns of posts, the level and the state are moderation_apply's alone; the erasure mark is the R4 redaction's.
      expect(matching(postColumns)).toEqual(["public.moderation_apply", "public.redact_r4_body"]);
      const written = (table: string, columns: string) =>
        new RegExp(String.raw`(update\s+(only\s+)?|merge\s+into\s+(only\s+)?|insert\s+into\s+)("?public"?\s*[.]\s*)?"?${table}"?(?![\w"])[^;]*\bset\b[^;]*"?(${columns})"?\s*=`, "i");
      const postLevel = written("posts", "moderation_level|state");
      const postErased = written("posts", "erased_at");
      const imageErased = written("post_media", "erased_at");
      const snapshotErased = written("evidence_snapshots", "erased_at");
      expect(matching(postLevel)).toEqual(["public.moderation_apply"]);
      expect(matching(postErased)).toEqual(["public.redact_r4_body"]);
      expect(matching(imageErased)).toEqual(["public.redact_r4_body"]);
      // Gate E: one function writes a snapshot's erasure, no function deletes a snapshot, and that one function is called
      // by the two erasures of 0018 and by nothing else.
      expect(matching(snapshotErased)).toEqual(["public.erase_snapshots"]);
      expect(matching(/delete\s+from\s+(only\s+)?("?public"?\s*[.]\s*)?"?evidence_snapshots"?(?![\w"])/i)).toEqual([]);
      expect(matching(/\berase_snapshots\s*\(/i)).toEqual(["public.erase_case_evidence", "public.erase_snapshots", "public.redact_r4_body"]);
      // The writer is called by the two triggers that follow a stored decision and a stored measure, and by the R4 redaction.
      expect(matching(calls)).toEqual(["public.decision_actions_apply", "public.decisions_apply", "public.moderation_apply", "public.redact_r4_body"]);
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
        post_media_insert: "BEFORE INSERT ON public.post_media FOR EACH ROW",
        post_media_keep: "BEFORE DELETE ON public.post_media FOR EACH ROW",
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
        decisions_apply: "AFTER INSERT ON public.decisions FOR EACH ROW",
        decisions_check: "AFTER INSERT ON public.decisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        // 3e: a statement mail's outcome moves one way, and fixes the start of an announced measure.
        decisions_mail_forward: "BEFORE UPDATE OF author_mail, author_mail_at ON public.decisions FOR EACH ROW",
        decisions_mail_standing: expect.stringMatching(/^AFTER UPDATE OF author_mail ON public[.]decisions FOR EACH ROW WHEN /),
        decisions_record: "BEFORE INSERT ON public.decisions FOR EACH ROW",
        posts_guard_insert: "BEFORE INSERT ON public.posts FOR EACH ROW",
        // Only a statement that names one of the three columns and changes one meets the guard: a counter's update never does.
        posts_guard_update: expect.stringMatching(/^BEFORE UPDATE OF state, moderation_level, erased_at ON public\.posts FOR EACH ROW WHEN \(.*IS DISTINCT FROM.*IS DISTINCT FROM.*IS DISTINCT FROM.*\)$/),
      });
    });

    test("the case's history runs with its reader's rights, and the API role only reads it", async () => {
      const [view] = await apiDb.execute<{ options: string[] | null }>(sql`select c.reloptions as options from pg_class c where c.oid = 'public.case_history'::regclass`);
      expect(view!.options).toEqual(["security_invoker=true"]);
      expect(await tablePrivileges("korbat_api", "public.case_history")).toEqual(["SELECT"]);
      const columns = await apiDb.execute<{ name: string }>(sql`select attname::text as name from pg_attribute where attrelid = 'public.case_history'::regclass and attnum > 0 order by attnum`);
      expect(columns.map((c) => c.name)).toEqual(["case_id", "at", "event", "ref_id", "seq", "intake_kind", "rule_id", "alleges_illegal", "csam", "reexamination", "decision_kind", "outcome", "staff_id", "result"]);
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

    test("the ledger's kinds are the contracts' action kinds, in their order", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.action_kind'::regtype order by e.enumsortorder`);
      expect(rows.map((row) => row.label)).toEqual([...ACTION_KINDS]);
    });

    test("post_state still has its four values: a seal is a state of images", async () => {
      const rows = await apiDb.execute<{ label: string }>(sql`select e.enumlabel::text as label from pg_enum e where e.enumtypid = 'public.post_state'::regtype order by e.enumsortorder`);
      expect(rows.map((row) => row.label)).toEqual(["visible", "withheld", "removed", "deleted_by_author"]);
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
```

### Replace `apps/api/test/integration/social-explore-job.test.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { EXPLORE_V2 } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import type { AppEnv } from "../../src/env";
import { MemoryJobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";
import { createExploreJob } from "../../src/social/explore";
import { leavesNoModerationRows } from "./moderation-decide";
import { newPost, newProfile, ticker } from "./social-fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * As in the ranking suite, the clocks run in a past of their own (2021 here, each test in a span of ten days), so no
 * other suite's rows are ever candidates or engagement for these rounds, and no two tests share a window.
 */
const EPOCH = Date.UTC(2021, 0, 1);
const SPAN = 10 * DAY;

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

interface RunRow {
  generation: number;
  candidates: number;
  items: number;
  tookMs: number;
}

/** The session middleware the job never passes through. */
const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
  await next();
};

/** Polls until `done` holds, for at most `ms`. */
async function until(done: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`still waiting after ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(!process.env.INTEGRATION)("integration: the Explore job", () => {
  let db: Db;
  let spans = 0;

  beforeAll(() => {
    // Startup parameters in the URL become every connection's settings: a lock wait gives up after 20 seconds, four
    // times the refresh's own limit, so a test sees which of the two ended it; a transaction left idle ends after 30.
    const url = new URL(loadConfig().DATABASE_URL_API);
    url.searchParams.set("lock_timeout", "20s");
    url.searchParams.set("idle_in_transaction_session_timeout", "30s");
    db = createDb(url.toString(), { max: 4 });
  });
  afterAll(async () => {
    // With a deadline, so a connection some failed test left in a transaction cannot keep the suite open.
    await db.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /**
   * The social module as the server builds it, on this database, with a clock that starts in a span of its own and a
   * logger that keeps every line without the time, pid and hostname.
   */
  function socialModule() {
    const clock = ticker(EPOCH + spans++ * SPAN);
    const lines: LogLine[] = [];
    const logger = pino({ level: "info", base: null, timestamp: false }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) });
    const social = createSocial({ apiDb: db, rateLimitStore: new MemoryStore(() => clock.now().getTime()), logger, requireSession: pass, requireFreshAuth: pass, now: clock.next });
    return { social, clock, lines };
  }

  /** A post three accounts of a month liked, with the clock moved on past the likes' 10 minutes of standing. */
  async function approvedPost(m: ReturnType<typeof socialModule>): Promise<string> {
    const monthAgo = new Date(m.clock.now().getTime() - 30 * DAY);
    const [author, ...fans] = await Promise.all(Array.from({ length: 4 }, () => newProfile(db, { createdAt: monthAgo })));
    const id = await newPost(m.social.deps.repo, author!.id, m.clock.next());
    for (const fan of fans) expect(await m.social.deps.repo.like(fan.id, id, m.clock.next())).toBe(true);
    m.clock.jump(20 * MINUTE);
    return id;
  }

  async function runs(): Promise<RunRow[]> {
    return (await db.execute(sql`select generation, candidates, items, took_ms as "tookMs" from explore_runs order by generation`)) as unknown as RunRow[];
  }

  /** The formula version of every ranking kept, oldest first. */
  async function formulas(): Promise<number[]> {
    return ((await db.execute(sql`select formula from explore_runs order by generation`)) as unknown as { formula: number }[]).map((row) => row.formula);
  }

  async function listed(generation: number): Promise<string[]> {
    const rows = (await db.execute(sql`select post_id from explore_items where generation = ${generation} order by position`)) as unknown as { post_id: string }[];
    return rows.map((row) => row.post_id);
  }

  const failures = (lines: LogLine[]) => lines.filter((line) => line.level >= 50);

  test("startExplore ranks at once, without waiting for the interval, and logs exactly the round's generation, candidates, items and milliseconds", async () => {
    const m = socialModule();
    const target = await approvedPost(m);
    const stop = m.social.startExplore(new MemoryJobLock());
    try {
      await until(() => m.lines.length > 0, 10_000);
    } finally {
      stop();
    }
    const [run, ...others] = await runs();
    expect(others).toEqual([]);
    expect(run).toEqual({ generation: expect.any(Number), candidates: 1, items: 1, tookMs: expect.any(Number) });
    expect(m.lines).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: run!.generation, candidates: 1, items: 1, tookMs: run!.tookMs }]);
    expect(await listed(run!.generation)).toEqual([target]);
    // The job ranks with the published formula, version 2 (3e design, section 7.13).
    expect(await formulas()).toEqual([2]);
  });

  test("the first round after the formula changed ranks at once: a ranking of version 1 younger than the minimum gap does not hold it back (3e)", async () => {
    const m = socialModule();
    const target = await approvedPost(m);
    // The ranking the last round before the deploy wrote, a minute ago, under version 1.
    await db.execute(sql`insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${new Date(m.clock.now().getTime() - MINUTE).toISOString()}::timestamptz, 1, 0, 0, 0)`);
    const job = createExploreJob(m.social.deps, new MemoryJobLock());
    expect(await job.round()).toBe("ran");
    expect(await formulas()).toEqual([1, 2]);
    const [, current] = await runs();
    expect(await listed(current!.generation)).toEqual([target]);
    // A ranking of version 2 does hold the next round back, as before.
    m.clock.jump(MINUTE);
    expect(await job.round()).toBe("ran");
    expect(await formulas()).toEqual([1, 2]);
  });

  test("the job's rounds follow the minimum gap: one inside it writes and logs nothing, the next one past it ranks again", async () => {
    const m = socialModule();
    const target = await approvedPost(m);
    const job = createExploreJob(m.social.deps, new MemoryJobLock());
    expect(await job.round()).toBe("ran");
    const first = await runs();
    expect(first).toHaveLength(1);

    m.clock.jump(EXPLORE_V2.minGapMinutes * MINUTE - 1_000);
    expect(await job.round()).toBe("ran");
    expect(await runs()).toEqual(first);
    expect(m.lines).toHaveLength(1);

    m.clock.jump(EXPLORE_V2.refreshMinutes * MINUTE);
    expect(await job.round()).toBe("ran");
    const [, second] = await runs();
    expect(second!.generation).toBeGreaterThan(first[0]!.generation);
    expect(await listed(second!.generation)).toEqual([target]);
    expect(m.lines).toHaveLength(2);
    expect(m.lines[1]).toEqual({ level: 30, msg: "explore: ranking refreshed", generation: second!.generation, candidates: 1, items: 1, tookMs: second!.tookMs });
  });

  test(
    "a round that fails keeps the previous ranking: at start it gives up after the refresh's own 5-second lock timeout and its failure is logged as the timer logs one",
    { timeout: 60_000 },
    async () => {
      const m = socialModule();
      const target = await approvedPost(m);
      const lock = new MemoryJobLock();
      expect(await createExploreJob(m.social.deps, lock).round()).toBe("ran");
      const previous = await runs();
      expect(previous).toHaveLength(1);
      m.clock.jump(EXPLORE_V2.refreshMinutes * MINUTE);

      // A transaction holds the listed post's row for update, as a write to it would: the next ranking cannot insert an
      // item referencing that post until it ends, and gives up on its own lock timeout instead.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let taken!: () => void;
      const locked = new Promise<void>((resolve) => (taken = resolve));
      const holder = db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from posts where id = ${target}::uuid for update`);
        taken();
        await gate;
      });
      // A holder that failed to take its lock must not leave the test waiting for it.
      holder.catch(() => taken());
      let stop: () => void = () => undefined;
      let waited = 0;
      try {
        await locked;
        const started = Date.now();
        stop = m.social.startExplore(lock);
        await until(() => failures(m.lines).length > 0, 25_000);
        waited = Date.now() - started;
      } finally {
        stop();
        release();
        await holder.catch(() => undefined);
      }
      // Its own limit of 5 seconds ended the wait, not the connection's 20.
      expect(waited).toBeLessThan(15_000);
      expect(failures(m.lines)).toEqual([
        expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: expect.stringContaining("lock timeout") }) }),
      ]);
      expect(m.lines.filter((line) => line.level < 50)).toEqual([expect.objectContaining({ msg: "explore: ranking refreshed", generation: previous[0]!.generation })]);
      // Nothing of the failed round remains: its run row went with its transaction.
      expect(await runs()).toEqual(previous);
      expect(await listed(previous[0]!.generation)).toEqual([target]);

      // The next round, with nothing in its way, replaces the ranking.
      expect(await createExploreJob(m.social.deps, lock).round()).toBe("ran");
      const [kept, current] = await runs();
      expect(kept).toEqual(previous[0]);
      expect(current!.generation).toBeGreaterThan(previous[0]!.generation);
      expect(await listed(current!.generation)).toEqual([target]);
    },
  );

  leavesNoModerationRows(() => db);
});
```

### Replace `apps/api/test/integration/social-explore-ranking.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { closeDb, createDb, likes, posts, profiles, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type SocialRepo } from "../../src/social/repo";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { newPost, newProfile } from "./social-fixtures";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The integration suites share one database, so these rankings are computed as of times in 2020: every row the other
 * suites write is dated around the time they run, after every refresh here, and never enters. Each test ranks in a span
 * of ten days of its own, so no test's posts or engagement fall in another test's 48-hour window either.
 */
const EPOCH = Date.UTC(2020, 0, 1);
const SPAN = 10 * DAY;

/** The published formula without its minimum gap, for a test that ranks the same rows again at the same time. */
const AGAIN: ExploreFormula = { ...EXPLORE_V2, minGapMinutes: 0 };

/** The score as the published formula states it, for the orders the tests expect. */
const score = (approvers: number, hours: number): number => approvers / Math.pow(Math.max(0, hours) + EXPLORE_V2.offsetHours, EXPLORE_V2.gravity);

interface RunRow {
  generation: number;
  asOf: string;
  formula: number;
  candidates: number;
  items: number;
  tookMs: number;
}

describe.skipIf(!process.env.INTEGRATION)("integration: the Explore ranking", () => {
  let db: Db;
  let repo: SocialRepo;
  let spans = 0;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDecisions();
    await closeDb(db);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its rounds answer.
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /** The refresh time of a test: three days into a span of its own. */
  const nextAsOf = () => new Date(EPOCH + spans++ * SPAN + 3 * DAY);
  const before = (asOf: Date, ms: number) => new Date(asOf.getTime() - ms);
  const after = (asOf: Date, ms: number) => new Date(asOf.getTime() + ms);

  /** Accounts created a month before the refresh: old enough for everything they do in a test to count. */
  const accounts = (asOf: Date, n: number) => Promise.all(Array.from({ length: n }, () => newProfile(db, { createdAt: before(asOf, 30 * DAY) })));

  /** A top-level post, written through the repository at the time given. */
  const post = (author: { id: string }, at: Date) => newPost(repo, author.id, at);

  async function likedBy(postId: string, users: { id: string }[], at: Date): Promise<void> {
    for (const user of users) expect(await repo.like(user.id, postId, at)).toBe(true);
  }

  /** A round that must rank; its answer, whose generation the test reads. */
  async function rank(asOf: Date, formula?: ExploreFormula) {
    const result = await repo.refreshExplore(asOf, formula);
    if (result.skipped) throw new Error("the round skipped");
    return result;
  }

  /** The posts of a ranking in order; its positions must run from 1 without gaps. */
  async function listed(generation: number): Promise<string[]> {
    const rows = (await db.execute(sql`select position, post_id from explore_items where generation = ${generation} order by position`)) as unknown as { position: number; post_id: string }[];
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, i) => i + 1));
    return rows.map((row) => row.post_id);
  }

  async function runs(): Promise<RunRow[]> {
    return (await db.execute(sql`
      select generation, to_char(as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "asOf", formula, candidates, items, took_ms as "tookMs"
      from explore_runs order by generation`)) as unknown as RunRow[];
  }

  test("a round writes a ranking under a new generation with its time, its formula's version and its counts, and answers the same", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const approved = await post(author!, before(asOf, 2 * HOUR));
    // A candidate nobody approved of: counted among the candidates, never ranked.
    await post(author!, before(asOf, HOUR));
    await likedBy(approved, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(result).toEqual({ skipped: false, generation: expect.any(Number), candidates: 2, items: 1, tookMs: expect.any(Number) });
    expect(Number.isInteger(result.tookMs) && result.tookMs >= 0).toBe(true);
    expect(await runs()).toEqual([{ generation: result.generation, asOf: asOf.toISOString(), formula: EXPLORE_V2.version, candidates: 2, items: 1, tookMs: result.tookMs }]);
    expect(await listed(result.generation)).toEqual([approved]);
    const [item] = (await db.execute(sql`select author_id from explore_items where generation = ${result.generation}`)) as unknown as { author_id: string }[];
    expect(item?.author_id).toBe(author!.id);
  });

  test("the window's edges: a post enters from a millisecond after 48 hours before the refresh up to the refresh's own millisecond", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(asOf, 6);
    const window = EXPLORE_V2.windowHours * HOUR;
    const tooOld = await post(a!, before(asOf, window));
    const oldest = await post(b!, before(asOf, window - 1));
    const newest = await post(c!, asOf);
    await likedBy(tooOld, fans, before(asOf, window - HOUR));
    await likedBy(oldest, fans, before(asOf, window - HOUR));
    // Likes dated before the post, as instances whose clocks disagree may date them, so that only the post's own time decides.
    await likedBy(newest, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([newest, oldest]);
    expect(result.candidates).toBe(2);
  });

  test("a post dated after the refresh never enters", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(asOf, 5);
    // Dated a millisecond after the refresh by an instance whose clock runs ahead; its likes carry earlier times, so only the post's own time keeps it out.
    const ahead = await post(a!, after(asOf, 1));
    const onTime = await post(b!, before(asOf, 2 * HOUR));
    await likedBy(ahead, fans, before(asOf, HOUR));
    await likedBy(onTime, fans, before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([onTime]);
    expect(result.candidates).toBe(1);
  });

  test("replies, quotes, withheld, removed and deleted posts, deleted authors and authors who switched Explore off never enter", async () => {
    const asOf = nextAsOf();
    const [author, gone, shy, ...fans] = await accounts(asOf, 6);
    const at = before(asOf, 3 * HOUR);
    const shown = await post(author!, at);
    const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: shown });
    const quote = await newPost(repo, author!.id, at, "a quote", { quoteOfId: shown });
    const withheld = await post(author!, at);
    const removed = await post(author!, at);
    const deleted = await post(author!, at);
    const byGone = await post(gone!, at);
    const byShy = await post(shy!, at);
    for (const id of [shown, reply, quote, withheld, removed, deleted, byGone, byShy]) await likedBy(id, fans, before(asOf, 2 * HOUR));
    await decideForTest(db, withheld, "withheld");
    await decideForTest(db, removed, "removed");
    expect(await repo.deletePost(deleted, author!.id, before(asOf, HOUR))).toBe(true);
    // Marked deleted as the purge's last statement marks it, with the post left visible, so only the author's deletion keeps it out.
    await db.execute(sql`update profiles set deleted_at = ${before(asOf, HOUR).toISOString()}::timestamptz where id = ${gone!.id}::uuid`);
    await db.execute(sql`update profiles set show_in_explore = false where id = ${shy!.id}::uuid`);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([shown]);
    expect(result.candidates).toBe(1);
    // The withheld and removed states come from real, confirmed decisions: a staff key's enrolment, a sign-in, and a step-up for each.
  }, 30_000);

  test("the author's own likes and reposts do not count", async () => {
    const asOf = nextAsOf();
    const [author, other, ...fans] = await accounts(asOf, 4);
    const at = before(asOf, 2 * HOUR);
    const selfish = await post(author!, before(asOf, 3 * HOUR));
    const control = await post(other!, before(asOf, 3 * HOUR));
    await likedBy(selfish, fans, at);
    expect(await repo.like(author!.id, selfish, at)).toBe(true);
    expect(await repo.repost(author!.id, selfish, at)).toBe(true);
    // The same two accounts and the first author, who is someone else here.
    await likedBy(control, [...fans, author!], at);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([control]);
  });

  test("likes and reposts from accounts under 48 hours old at the time do not count, even once the account is older", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(asOf, 5);
    const minAge = EXPLORE_V2.engagerMinAgeHours * HOUR;
    const at = before(asOf, 2 * HOUR);
    // A millisecond short of 48 hours old when it liked, and past 49 hours at the refresh.
    const youngLiker = await newProfile(db, { createdAt: new Date(at.getTime() - minAge + 1) });
    // A day old; its repost is written through the repository, which does not apply the 48-hour gate the flow applies.
    const youngReposter = await newProfile(db, { createdAt: before(asOf, DAY) });
    // Exactly 48 hours old when it liked.
    const justOldEnough = await newProfile(db, { createdAt: new Date(at.getTime() - minAge) });
    const liked = await post(a!, before(asOf, 3 * HOUR));
    const reposted = await post(b!, before(asOf, 3 * HOUR));
    const control = await post(c!, before(asOf, 3 * HOUR));
    await likedBy(liked, [...fans, youngLiker], at);
    await likedBy(reposted, fans, at);
    expect(await repo.repost(youngReposter.id, reposted, at)).toBe(true);
    await likedBy(control, [...fans, justOldEnough], at);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([control]);
  });

  test("likes and reposts from deleted accounts do not count", async () => {
    const asOf = nextAsOf();
    const [author, liker, reposter, ...fans] = await accounts(asOf, 5);
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    await likedBy(target, fans, at);
    expect(await repo.like(liker!.id, target, at)).toBe(true);
    expect(await repo.repost(reposter!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);

    // Marked deleted as the purge's last statement marks them, with their like and repost left in place, so only the deletion keeps them from counting.
    await db.execute(sql`update profiles set deleted_at = ${before(asOf, HOUR).toISOString()}::timestamptz where id in (${liker!.id}::uuid, ${reposter!.id}::uuid)`);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([]);
  });

  test("likes and reposts younger than 10 minutes do not count, and ones exactly 10 minutes old do", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d, late, ...fans] = await accounts(asOf, 7);
    const standing = EXPLORE_V2.standingMinutes * MINUTE;
    const likedInTime = await post(a!, before(asOf, HOUR));
    const repostedInTime = await post(b!, before(asOf, 2 * HOUR));
    const likedLate = await post(c!, before(asOf, HOUR));
    const repostedLate = await post(d!, before(asOf, HOUR));
    for (const id of [likedInTime, repostedInTime, likedLate, repostedLate]) await likedBy(id, fans, before(asOf, 30 * MINUTE));
    expect(await repo.like(late!.id, likedInTime, before(asOf, standing))).toBe(true);
    expect(await repo.repost(late!.id, repostedInTime, before(asOf, standing))).toBe(true);
    expect(await repo.like(late!.id, likedLate, before(asOf, standing - 1))).toBe(true);
    expect(await repo.repost(late!.id, repostedLate, before(asOf, standing - 1))).toBe(true);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([likedInTime, repostedInTime]);
  });

  test("an account that liked and reposted a post counts once", async () => {
    const asOf = nextAsOf();
    const [author, ada, bob, cyd] = await accounts(asOf, 4);
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    for (const user of [ada!, bob!]) {
      expect(await repo.like(user.id, target, at)).toBe(true);
      expect(await repo.repost(user.id, target, at)).toBe(true);
    }
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([]);

    expect(await repo.repost(cyd!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);
  });

  test("three eligible repliers, three eligible quoters and two approving accounts keep a post out", async () => {
    const asOf = nextAsOf();
    const [author, ...others] = await accounts(asOf, 9);
    const [repliers, quoters, approvers] = [others.slice(0, 3), others.slice(3, 6), others.slice(6, 8)];
    const at = before(asOf, 2 * HOUR);
    const target = await post(author!, before(asOf, 3 * HOUR));
    for (const user of repliers) await newPost(repo, user.id, at, "a reply", { replyToId: target });
    for (const user of quoters) await newPost(repo, user.id, at, "a quote", { quoteOfId: target });
    await likedBy(target, approvers, at);

    const first = await rank(asOf, AGAIN);
    expect(await listed(first.generation)).toEqual([]);
    // The replies and quotes are posts in the window too, but never candidates.
    expect(first.candidates).toBe(1);

    // A replier who also likes the post is an approving account like any other: the third.
    expect(await repo.like(repliers[0]!.id, target, at)).toBe(true);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([target]);
  });

  test("the threshold: three approving accounts put a post in, two do not", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(asOf, 5);
    const three = await post(a!, before(asOf, 2 * HOUR));
    const two = await post(b!, before(asOf, 2 * HOUR));
    await likedBy(three, fans, before(asOf, HOUR));
    await likedBy(two, fans.slice(0, 2), before(asOf, HOUR));

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([three]);
    expect(result).toMatchObject({ candidates: 2, items: 1 });
  });

  test("the order is by score, approving accounts over (hours since posted + 2) ^ 1.8, across posts older than 24 hours, a tie going to the higher post id", async () => {
    const asOf = nextAsOf();
    const fans = await accounts(asOf, 20);
    const shapes = [
      { approvers: 3, hours: 1 },
      { approvers: 5, hours: 12 },
      // Older than a day, yet above the 12-hour-old post: it has four times its approving accounts.
      { approvers: 20, hours: 25 },
      // Older than a day, and below it.
      { approvers: 8, hours: 30 },
      // These two tie: as many approving accounts, posted at the same millisecond.
      { approvers: 4, hours: 6 },
      { approvers: 4, hours: 6 },
    ];
    const made: { id: string; score: number }[] = [];
    for (const shape of shapes) {
      const [author] = await accounts(asOf, 1);
      const id = await post(author!, before(asOf, shape.hours * HOUR));
      await likedBy(id, fans.slice(0, shape.approvers), before(asOf, 30 * MINUTE));
      made.push({ id, score: score(shape.approvers, shape.hours) });
    }
    const expected = [...made].sort((x, y) => y.score - x.score || (x.id < y.id ? 1 : -1)).map((p) => p.id);
    expect(expected.indexOf(made[2]!.id)).toBeLessThan(expected.indexOf(made[1]!.id));
    expect(expected.indexOf(made[3]!.id)).toBeGreaterThan(expected.indexOf(made[1]!.id));
    const [tieLow, tieHigh] = [made[4]!.id, made[5]!.id].sort();
    expect(expected.indexOf(tieHigh!)).toBe(expected.indexOf(tieLow!) - 1);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual(expected);
  });

  test("an author with three qualifying posts keeps the best two by score, and the positions close up behind the one left out", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(asOf, 3);
    const fans = await accounts(asOf, 12);
    const approved = async (author: { id: string }, approvers: number, hours: number) => {
      const id = await post(author, before(asOf, hours * HOUR));
      await likedBy(id, fans.slice(0, approvers), before(asOf, 30 * MINUTE));
      return id;
    };
    const a1 = await approved(a!, 5, 1);
    const a2 = await approved(a!, 4, 1);
    // The author's most approved post, but their third by score: 20 hours old.
    await approved(a!, 12, 20);
    const c1 = await approved(c!, 3, 1);
    // Below the author's third post, so it moves up a place when that one is left out.
    const b1 = await approved(b!, 3, 30);

    const result = await rank(asOf);
    expect(await listed(result.generation)).toEqual([a1, a2, c1, b1]);
    expect(result).toMatchObject({ candidates: 5, items: 4 });
  });

  test("a ranking holds at most 300 posts: of 301 qualifying posts, the lowest scoring is left out", async () => {
    const asOf = nextAsOf();
    const fans = await accounts(asOf, 3);
    const n = EXPLORE_V2.listLength + 1;
    // One post by each of 301 authors, so the per-author cap plays no part, written in bulk; each is a second older than
    // the one before, so the scores fall in the order the posts were written.
    const authors = Array.from({ length: n }, () => ({ id: randomUUID(), handle: `x_${randomBytes(6).toString("hex")}`, displayName: "An author", createdAt: before(asOf, 30 * DAY) }));
    await db.insert(profiles).values(authors);
    const written = await db
      .insert(posts)
      .values(authors.map((author, i) => ({ authorId: author.id, body: `post ${i}`, createdAt: before(asOf, HOUR + i * 1000) })))
      .returning({ id: posts.id, authorId: posts.authorId });
    const byAuthor = new Map(written.map((row) => [row.authorId, row.id]));
    const order = authors.map((author) => byAuthor.get(author.id)!);
    await db.insert(likes).values(fans.flatMap((fan) => order.map((postId) => ({ userId: fan.id, postId, createdAt: before(asOf, 30 * MINUTE) }))));

    const result = await rank(asOf);
    expect(result).toMatchObject({ candidates: n, items: EXPLORE_V2.listLength });
    expect(await listed(result.generation)).toEqual(order.slice(0, EXPLORE_V2.listLength));
  });

  test("a round less than 4.5 minutes after the newest ranking writes nothing, and one 4.5 minutes after it ranks", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const target = await post(author!, before(asOf, 2 * HOUR));
    await likedBy(target, fans, before(asOf, HOUR));
    const gap = EXPLORE_V2.minGapMinutes * MINUTE;
    const first = await rank(asOf);
    const written = await runs();

    expect(await repo.refreshExplore(after(asOf, gap - 1))).toEqual({ skipped: true });
    // So does a round of an instance whose clock runs behind: the newest ranking is later than its time.
    expect(await repo.refreshExplore(before(asOf, MINUTE))).toEqual({ skipped: true });
    expect(await runs()).toEqual(written);
    expect(await listed(first.generation)).toEqual([target]);

    const second = await rank(after(asOf, gap));
    expect(second.generation).toBeGreaterThan(first.generation);
    expect((await runs()).map((run) => run.generation)).toEqual([first.generation, second.generation]);
    expect(await listed(second.generation)).toEqual([target]);
  });

  test("only the two newest rankings are kept, the items of an older one going with it", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(asOf, 4);
    const target = await post(author!, before(asOf, 2 * HOUR));
    await likedBy(target, fans, before(asOf, HOUR));
    const itemCounts = async () =>
      (await db.execute(sql`select generation, count(*)::int as n from explore_items group by generation order by generation`)) as unknown as { generation: number; n: number }[];
    const generations = async () => (await runs()).map((run) => run.generation);

    const g1 = (await rank(asOf)).generation;
    const g2 = (await rank(after(asOf, 5 * MINUTE))).generation;
    expect(await generations()).toEqual([g1, g2]);
    const g3 = (await rank(after(asOf, 10 * MINUTE))).generation;
    expect(await generations()).toEqual([g2, g3]);
    expect(await itemCounts()).toEqual([
      { generation: g2, n: 1 },
      { generation: g3, n: 1 },
    ]);

    // A formula that keeps one ranking leaves only the newest.
    const g4 = (await rank(after(asOf, 15 * MINUTE), { ...EXPLORE_V2, kept: 1 })).generation;
    expect(await generations()).toEqual([g4]);
    expect(await itemCounts()).toEqual([{ generation: g4, n: 1 }]);
  });

  test("a round with another threshold, per-author cap and list length follows them, and records its formula's version, 2", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(asOf, 3);
    const fans = await accounts(asOf, 4);
    const approved = async (author: { id: string }, approvers: number, hours: number) => {
      const id = await post(author, before(asOf, hours * HOUR));
      await likedBy(id, fans.slice(0, approvers), before(asOf, 30 * MINUTE));
      return id;
    };
    const a1 = await approved(a!, 4, 2);
    const a2 = await approved(a!, 3, 2);
    const b1 = await approved(b!, 2, 2);
    await approved(c!, 2, 5);
    expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([a1, a2]);

    // Two approving accounts are enough, one post per author, two posts in all: the author's best, then the better of the other two.
    const result = await rank(asOf, { ...AGAIN, threshold: 2, perAuthor: 1, listLength: 2 });
    expect(await listed(result.generation)).toEqual([a1, b1]);
    expect((await runs()).at(-1)).toMatchObject({ generation: result.generation, formula: 2, candidates: 4, items: 2 });
    // Version 2's rules are the only ones the round applies: a formula of any other version is refused before any SQL,
    // so no ranking is stored under a version whose rules it did not apply (3e design, section 7.13).
    const written = await runs();
    for (const version of [1, 3, 9]) await expect(repo.refreshExplore(asOf, { ...AGAIN, version }), String(version)).rejects.toThrow(/version 2/);
    expect(await runs()).toEqual(written);
  });

  /**
   * Version 2 counts a post's window and age from coalesce(explore_from, created_at) (3e design, section 7.13). Only
   * moderation_apply writes explore_from, as created_at plus the time the post spent hidden; these tests set it as the
   * migrator to chosen times, so the arms of the window and the score can be held to the millisecond, and clear it again.
   */
  describe("version 2: the window and the age count from explore_from when moderation hid the post", () => {
    let migrateDb: Db;
    const resumed: string[] = [];
    beforeAll(() => {
      migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    });
    afterAll(async () => {
      try {
        await migrateDb.execute(sql`update posts set hidden_at = null, restored_at = null, explore_from = null where id = any(${`{${resumed.join(",")}}`}::uuid[])`);
      } finally {
        await closeDb(migrateDb);
      }
    });
    /** Writes the post's resume time as moderation_apply would, with the span before it as hidden. */
    async function resume(postId: string, from: Date): Promise<void> {
      resumed.push(postId);
      await migrateDb.execute(sql`update posts set hidden_at = created_at, restored_at = ${from.toISOString()}::timestamptz, explore_from = ${from.toISOString()}::timestamptz where id = ${postId}::uuid`);
    }

    test("the window's two arms: a post past its 48 hours enters while its resume time is inside them, and one whose resume time is past or after the round does not", async () => {
      const asOf = nextAsOf();
      const [a, b, c, d, ...fans] = await accounts(asOf, 7);
      const window = EXPLORE_V2.windowHours * HOUR;
      // Created three days before the round, hidden and given back its time: it resumes a millisecond inside the window.
      const resumedIn = await post(a!, before(asOf, 3 * DAY));
      // Created before the window and resumed exactly at its edge: out, as a post created at the edge is.
      const resumedOut = await post(b!, before(asOf, window + HOUR));
      // Its resume time is after the round's: not yet a candidate.
      const resumedLater = await post(c!, before(asOf, HOUR));
      // Never hidden: the created_at arm, as in version 1.
      const plain = await post(d!, before(asOf, 2 * HOUR));
      for (const id of [resumedIn, resumedOut, resumedLater, plain]) await likedBy(id, fans, before(asOf, HOUR));
      await resume(resumedIn, before(asOf, window - 1));
      await resume(resumedOut, before(asOf, window));
      await resume(resumedLater, after(asOf, 1));

      const result = await rank(asOf);
      expect(new Set(await listed(result.generation))).toEqual(new Set([resumedIn, plain]));
      expect(result.candidates).toBe(2);
    });

    test("the score's age is the time since the resume time: a post restored an hour ago ranks above one of the same approvers posted 10 hours ago", async () => {
      const asOf = nextAsOf();
      const [a, b] = await accounts(asOf, 2);
      const fans = await accounts(asOf, 4);
      // Posted 40 hours ago and hidden until 39 hours later: shown for about an hour in all.
      const restored = await post(a!, before(asOf, 40 * HOUR));
      const older = await post(b!, before(asOf, 10 * HOUR));
      await likedBy(restored, fans, before(asOf, 30 * MINUTE));
      await likedBy(older, fans, before(asOf, 30 * MINUTE));
      // Without a resume time the restored post is the older, and ranks second.
      expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([older, restored]);
      await resume(restored, before(asOf, HOUR));
      expect(score(4, 1)).toBeGreaterThan(score(4, 10));
      expect(await listed((await rank(asOf, AGAIN)).generation)).toEqual([restored, older]);
    });
  });

  test("a round with another window, engager age, standing, gravity and offset follows them", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d] = await accounts(asOf, 4);
    const fans = await accounts(asOf, 6);
    const old = await post(a!, before(asOf, 30 * HOUR));
    await likedBy(old, fans, before(asOf, 29 * HOUR));
    const fresh = await post(b!, before(asOf, HOUR));
    await likedBy(fresh, fans.slice(0, 3), before(asOf, 30 * MINUTE));
    // Two approving accounts, and a like by an account three hours old when it liked, too young for v1.
    const youngFan = await newProfile(db, { createdAt: before(asOf, 4 * HOUR) });
    const byYoung = await post(c!, before(asOf, 2 * HOUR));
    await likedBy(byYoung, [...fans.slice(0, 2), youngFan], before(asOf, HOUR));
    // Two approving accounts, and a like a minute old, too recent for v1.
    const late = await post(d!, before(asOf, 3 * HOUR));
    await likedBy(late, fans.slice(0, 2), before(asOf, HOUR));
    expect(await repo.like(fans[2]!.id, late, before(asOf, MINUTE))).toBe(true);

    const order = async (changes: Partial<ExploreFormula>) => listed((await rank(asOf, { ...AGAIN, ...changes })).generation);
    expect(await order({})).toEqual([fresh, old]);
    expect(await order({ windowHours: 24 })).toEqual([fresh]);
    expect(await order({ engagerMinAgeHours: 2 })).toEqual([fresh, byYoung, old]);
    expect(await order({ standingMinutes: 0 })).toEqual([fresh, late, old]);
    // Without decay the score is the count of approving accounts; with a large offset, age matters little next to it.
    expect(await order({ gravity: 0 })).toEqual([old, fresh]);
    expect(await order({ gravity: 1, offsetHours: 100 })).toEqual([old, fresh]);
    expect(await order({ gravity: 1 })).toEqual([fresh, old]);
  });

  leavesNoModerationRows(() => db);
});
```

### Replace `apps/api/test/integration/social-explore-reads.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V2, ExplorePage, ExploreStatus, type ExploreFormula, type ExploreStatusKind } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError, type SocialDeps } from "../../src/social/context";
import { encodeExploreCursor } from "../../src/social/cursor";
import { setEngagement } from "../../src/social/flows/engagement";
import { explorePage, exploreStatus, setShowInExplore } from "../../src/social/flows/explore";
import { getPost } from "../../src/social/flows/posts";
import { profilePosts } from "../../src/social/flows/timelines";
import type { SocialRepo } from "../../src/social/repo";
import { DAY, HOUR, MINUTE, accounts, after, approvedPost, before, exploreDeps, likedBy, listed, pageIds, rank, spans } from "./explore-fixtures";
import { closeDecisions, decideForTest, leavesNoModerationRows } from "./moderation-decide";
import { newPost, newProfile } from "./social-fixtures";
import { rejection } from "./social-harness";

// Several tests here put posts into a moderation state, each through a real, confirmed decision (a staff key's enrolment
// and sign-in once, then a step-up for each): on a loaded machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/** This suite's past (see explore-fixtures.ts): its rankings are computed as of times in 2022, each test in a span of its own. */
const EPOCH = Date.UTC(2022, 0, 1);

describe.skipIf(!process.env.INTEGRATION)("integration: reading Explore", () => {
  let db: Db;
  let deps: SocialDeps;
  let repo: SocialRepo;
  let setNow: (at: Date) => void;
  const nextAsOf = spans(EPOCH);

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    ({ deps, repo, setNow } = exploreDeps(db));
  });
  afterAll(async () => {
    await closeDecisions();
    await closeDb(db);
  });
  // Every test starts without any ranking (the cascade empties explore_items) and reads the generations its own rounds answer.
  beforeEach(async () => {
    await db.execute(sql`delete from explore_runs`);
  });

  /** A page as a reader asks for it: twenty posts unless the test says otherwise. */
  const read = (viewer: string | null, query: { limit?: number; cursor?: string } = {}) => explorePage(deps, viewer, { limit: 20, ...query });
  const status = (viewer: string, postId: string, formula?: ExploreFormula) => exploreStatus(deps, viewer, postId, formula);
  /** A moderation state comes about only through a decision: a real, confirmed one, since the posts' guard refuses the API role any other write. */
  const setState = (postId: string, state: "withheld" | "removed") => decideForTest(db, postId, state);

  test("before the first round the page is empty, with no cursor, no time and no sign-in prompt, a cursor is not valid, and the author's status is no_ranking", async () => {
    const asOf = nextAsOf();
    const [author, reader, ...fans] = await accounts(db, asOf, 5);
    // A post that would rank, so only the missing ranking keeps the page empty.
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(await read(null))).toEqual(empty);
    expect(await read(reader!.id)).toEqual(empty);
    // No ranking has been written, so no cursor this server made can name one: whatever ranking and post a cursor names,
    // it is not valid (400), never a ranking since pruned (409), which would send the reader to a current one that does not exist.
    for (const cursor of [{ g: 1, id: randomUUID() }, { g: 1, id }, { g: 2_147_483_647, id: randomUUID() }]) {
      const err = await read(reader!.id, { cursor: encodeExploreCursor(cursor) }).catch((caught: unknown) => caught);
      expect(err, JSON.stringify(cursor)).toBeInstanceOf(SocialError);
      expect(err, JSON.stringify(cursor)).toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(await status(author!.id, id)).toEqual({ status: "no_ranking", computedAt: null });
  });

  test("blocks in either direction and mutes, written after the ranking, leave a signed-in reader's pages before the limit", async () => {
    const asOf = nextAsOf();
    const [reader, blocked, blocker, muted, d, e] = await accounts(db, asOf, 6);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // The authors the reader will not see lead the ranking: their posts are as old as the others, with more approving accounts.
    const b1 = await approvedPost(repo, blocked!, at, fans.slice(0, 6), likedAt);
    const r1 = await approvedPost(repo, blocker!, at, fans.slice(0, 5), likedAt);
    const m1 = await approvedPost(repo, muted!, at, fans.slice(0, 4), likedAt);
    const d1 = await approvedPost(repo, d!, at, fans.slice(0, 3), likedAt);
    const e1 = await approvedPost(repo, e!, at, fans.slice(0, 3), likedAt);
    const order = await listed(db, (await rank(repo, asOf)).generation);
    expect(order.slice(0, 3)).toEqual([b1, r1, m1]);
    expect(new Set(order.slice(3))).toEqual(new Set([d1, e1]));
    setNow(after(asOf, MINUTE));

    await repo.block(reader!.id, blocked!.id, deps.now());
    await repo.block(blocker!.id, reader!.id, deps.now());
    await repo.mute(reader!.id, muted!.id, deps.now());
    // A mute whose muter has a post in the ranking: d mutes muted too, which must leave d1 in muted's Explore.
    await repo.mute(d!.id, muted!.id, deps.now());
    // Two posts are left for the reader, and a page of two holds both: the filters come before the limit.
    const first = await read(reader!.id, { limit: 2 });
    expect(pageIds(first)).toEqual(order.slice(3));
    expect(first.nextCursor).not.toBeNull();
    expect(await read(reader!.id, { limit: 2, cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // Only the reader's own relations count: signed out, and for the accounts on the other side, the ranking is whole. A
    // mute is its muter's alone, so the muted account still reads the posts of the accounts that mute it, d1 among them,
    // and cannot tell from Explore that it was muted.
    expect(pageIds(await read(null))).toEqual(order);
    expect(pageIds(await read(blocked!.id))).toEqual(order);
    expect(pageIds(await read(blocker!.id))).toEqual(order);
    expect(pageIds(await read(muted!.id))).toEqual(order);
  });

  test("a listed post withheld, removed or deleted after the ranking is gone from the next read, for every reader, its author included", async () => {
    const asOf = nextAsOf();
    const [a, b, c, d, ...fans] = await accounts(db, asOf, 7);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const d1 = await approvedPost(repo, d!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
    setNow(after(asOf, MINUTE));

    await setState(a1, "withheld");
    await setState(b1, "removed");
    expect(await repo.deletePost(c1, c!.id, deps.now())).toBe(true);
    expect(pageIds(await read(null))).toEqual([d1]);
    // Unlike Latest, where an author still sees their own withheld post, Explore leaves it out for its author as well.
    for (const reader of [a!, b!, c!, d!]) expect(pageIds(await read(reader.id)), reader.handle).toEqual([d1]);
    // Only the read changed: the ranking holds the four until the next round.
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1, d1]));
  });

  test("an author who switches Explore off, or whose account is deleted, leaves the next read, before any further round", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    const c1 = await approvedPost(repo, c!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    setNow(after(asOf, MINUTE));

    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    // Marked deleted as the purge's last statement marks it, with the post left visible, so only the deletion keeps it out.
    await db.execute(sql`update profiles set deleted_at = ${deps.now().toISOString()}::timestamptz where id = ${b!.id}::uuid`);
    expect(pageIds(await read(null))).toEqual([c1]);
    expect(pageIds(await read(a!.id))).toEqual([c1]);
    expect(pageIds(await read(c!.id))).toEqual([c1]);
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1, c1]));

    // The switch answers as it now stands and is what /me's profile store reads; turning it twice changes nothing more,
    // and an account that is gone, or never was, has no switch to turn.
    expect(await setShowInExplore(deps, a!.id, false)).toEqual({ showInExplore: false });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(false);
    expect(await setShowInExplore(deps, a!.id, true)).toEqual({ showInExplore: true });
    expect((await createProfileStore(db).find(a!.id))!.showInExplore).toBe(true);
    expect(await rejection(setShowInExplore(deps, b!.id, false))).toBe("not_found");
    expect(await rejection(setShowInExplore(deps, randomUUID(), true))).toBe("not_found");
  });

  test("a reader paging through a ranking while a new one lands finishes the one they started, with no repeats and no gaps", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, d, e, f] = await accounts(db, asOf, 7);
    const fans = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // Five posts of one age, in the order of their approving accounts: 7, 6, 5, 4 and 3.
    const five: string[] = [];
    for (const [i, author] of [a!, b!, c!, d!, e!].entries()) five.push(await approvedPost(repo, author, at, fans.slice(0, 7 - i), likedAt));
    // Liked by all eight seven minutes before the first round: too recent for it, counted by the next, five minutes later.
    const f1 = await approvedPost(repo, f!, at, fans, before(asOf, 7 * MINUTE));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual(five);
    setNow(after(asOf, MINUTE));

    const page1 = await read(reader!.id, { limit: 2 });
    expect(pageIds(page1)).toEqual(five.slice(0, 2));
    expect(page1.computedAt).toBe(asOf.toISOString());

    const next = after(asOf, 5 * MINUTE);
    expect(await listed(db, (await rank(repo, next)).generation)).toEqual([f1, ...five]);

    // The pages after the first come from the ranking the reader started, with its time; the newcomer does not break in.
    const page2 = await read(reader!.id, { limit: 2, cursor: page1.nextCursor! });
    const page3 = await read(reader!.id, { limit: 2, cursor: page2.nextCursor! });
    expect([...pageIds(page1), ...pageIds(page2), ...pageIds(page3)]).toEqual(five);
    expect([page2.computedAt, page3.computedAt]).toEqual([asOf.toISOString(), asOf.toISOString()]);
    expect(page3.nextCursor).toBeNull();
    // A reader who starts now gets the new ranking, with its time.
    const fresh = await read(reader!.id);
    expect(pageIds(fresh)).toEqual([f1, ...five]);
    expect(fresh.computedAt).toBe(next.toISOString());
  });

  test("a cursor of a ranking no longer kept is 409 explore_refreshed; one naming a ranking not yet written, or a post outside its ranking, is 400", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, c, quiet, ...fans] = await accounts(db, asOf, 8);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const first = await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    await approvedPost(repo, c!, at, fans, likedAt);
    // A post in the window that no ranking holds: nobody approved of it.
    const outside = await newPost(repo, quiet!.id, at);
    await rank(repo, asOf);
    setNow(after(asOf, MINUTE));
    const started = await read(reader!.id, { limit: 1 });
    expect(started.nextCursor).not.toBeNull();

    const g2 = (await rank(repo, after(asOf, 5 * MINUTE))).generation;
    // The ranking before the current one is still kept, so the reader reads on in it.
    expect(pageIds(await read(reader!.id, { limit: 1, cursor: started.nextCursor! }))).toHaveLength(1);
    const g3 = (await rank(repo, after(asOf, 10 * MINUTE))).generation;
    // Now it is gone, and the reader is told so rather than handed another ranking's posts.
    const refreshed = await read(reader!.id, { limit: 1, cursor: started.nextCursor! }).catch((err: unknown) => err);
    expect(refreshed).toBeInstanceOf(SocialError);
    expect(refreshed).toMatchObject({ code: "explore_refreshed", status: 409, message: "Explore was refreshed." });

    const refusedAsInvalid = async (cursor: string, what: string) => {
      const err = await read(reader!.id, { limit: 1, cursor }).catch((caught: unknown) => caught);
      expect(err, what).toBeInstanceOf(SocialError);
      expect(err, what).toMatchObject({ code: "invalid_request", status: 400 });
    };
    // A ranking after the current one has not been written: no cursor this server made can name it.
    await refusedAsInvalid(encodeExploreCursor({ g: g3 + 1, id: first }), "a ranking not yet written");
    // A post the ranking does not hold, whether the post exists or not.
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: outside }), "a post outside the ranking");
    await refusedAsInvalid(encodeExploreCursor({ g: g3, id: randomUUID() }), "no such post");
    await refusedAsInvalid("not-a-cursor", "not a cursor");
    // Both rankings kept are read on after any post they hold.
    for (const g of [g2, g3]) {
      const order = await listed(db, g);
      expect(pageIds(await read(reader!.id, { cursor: encodeExploreCursor({ g, id: order[0]! }) }))).toEqual(order.slice(1));
    }
  });

  test("a page cut exactly at the limit carries a cursor naming the ranking and the last post read, and the page after it is empty with no cursor", async () => {
    const asOf = nextAsOf();
    const [reader, a, b, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    await approvedPost(repo, a!, at, fans, likedAt);
    await approvedPost(repo, b!, at, fans, likedAt);
    const g = (await rank(repo, asOf)).generation;
    const order = await listed(db, g);
    setNow(after(asOf, MINUTE));

    const full = await read(reader!.id, { limit: 2 });
    expect(ExplorePage.parse(full)).toEqual(full);
    expect(pageIds(full)).toEqual(order);
    // Ordinary post views with their public counts and the reader's own state; nothing but the order tells their place.
    expect(full.items.map((item) => [item.kind, item.post.counts.likes, item.post.viewer])).toEqual(order.map(() => ["post", 3, { liked: false, reposted: false, bookmarked: false }]));
    // The cursor names the ranking and the post read last, and nothing else: no position, no score.
    expect(JSON.parse(Buffer.from(full.nextCursor!, "base64url").toString("utf8"))).toEqual({ g, id: order[1] });
    expect(await read(reader!.id, { limit: 2, cursor: full.nextCursor! })).toEqual({ items: [], nextCursor: null, computedAt: asOf.toISOString(), signInForMore: false });
    // A page shorter than its limit is the last one: no cursor.
    const short = await read(reader!.id, { limit: 3 });
    expect(pageIds(short)).toEqual(order);
    expect(short.nextCursor).toBeNull();
  });

  test("the status answers the post's author only, with the first reason that applies: reply, quote, not_visible, hidden_by_author, then listed", async () => {
    const asOf = nextAsOf();
    const [author, other, ...fans] = await accounts(db, asOf, 5);
    const at = before(asOf, 2 * HOUR);
    const root = await approvedPost(repo, author!, at, fans, before(asOf, HOUR));
    const reply = await newPost(repo, author!.id, at, "a reply", { replyToId: root });
    const quote = await newPost(repo, author!.id, at, "a quote", { quoteOfId: root });
    // A withheld reply is a reply first: replies never enter, whatever their state.
    const withheldReply = await newPost(repo, author!.id, at, "a withheld reply", { replyToId: root });
    const withheld = await newPost(repo, author!.id, at);
    const removed = await newPost(repo, author!.id, at);
    const deleted = await newPost(repo, author!.id, at);
    await setState(withheldReply, "withheld");
    await setState(withheld, "withheld");
    await setState(removed, "removed");
    expect(await repo.deletePost(deleted, author!.id, before(asOf, 30 * MINUTE))).toBe(true);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([root]);
    setNow(after(asOf, MINUTE));
    const computedAt = asOf.toISOString();

    const expected: [string, ExploreStatusKind][] = [
      [reply, "reply"],
      [withheldReply, "reply"],
      [quote, "quote"],
      [withheld, "not_visible"],
      [removed, "not_visible"],
      [deleted, "not_visible"],
      [root, "listed"],
    ];
    for (const [id, kind] of expected) {
      const answer = await status(author!.id, id);
      expect(answer, kind).toEqual({ status: kind, computedAt });
      // No count and no score: the reason and the ranking's time are all there is.
      expect(Object.keys(ExploreStatus.parse(answer)).sort(), kind).toEqual(["computedAt", "status"]);
    }
    // With the switch off, a post that is visible, even a listed one, says so; the reasons before it still come first.
    await setShowInExplore(deps, author!.id, false);
    expect(await status(author!.id, root)).toEqual({ status: "hidden_by_author", computedAt });
    expect(await status(author!.id, withheld)).toEqual({ status: "not_visible", computedAt });
    expect(await status(author!.id, quote)).toEqual({ status: "quote", computedAt });
    // Anyone but the author, and a post that does not exist, get not_found: nothing tells them what the post is.
    for (const id of [root, reply, quote, withheld, deleted]) expect(await rejection(status(other!.id, id)), id).toBe("not_found");
    expect(await rejection(status(author!.id, randomUUID()))).toBe("not_found");
  });

  test("outside_window comes before the ranking is asked about; no_ranking before the first round; new_since_ranking for a post written after it", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const window = EXPLORE_V2.windowHours * HOUR;
    // Exactly 48 hours old at the request time, which is outside: the window takes posts younger than that.
    const old = await approvedPost(repo, author!, before(asOf, window), fans, before(asOf, window - HOUR));
    const recent = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(asOf);
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt: null });
    expect(await status(author!.id, recent)).toEqual({ status: "no_ranking", computedAt: null });

    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([recent]);
    // Written a minute after the ranking and approved of at once.
    const later = await approvedPost(repo, author!, after(asOf, MINUTE), fans, after(asOf, MINUTE));
    setNow(after(asOf, 15 * MINUTE));
    const computedAt = asOf.toISOString();
    expect(await status(author!.id, recent)).toEqual({ status: "listed", computedAt });
    expect(await status(author!.id, later)).toEqual({ status: "new_since_ranking", computedAt });
    expect(await status(author!.id, old)).toEqual({ status: "outside_window", computedAt });
  });

  test("below_threshold and pending apply every rule of the ranking, now and at the ranking's time, the 10 minutes of standing included", async () => {
    const asOf = nextAsOf();
    const [author, fan1, fan2, fan3] = await accounts(db, asOf, 4);
    // A day old when it likes: short of the 48 hours an engaging account needs.
    const young = await newProfile(db, { createdAt: before(asOf, DAY) });
    const id = await newPost(repo, author!.id, before(asOf, 2 * HOUR));
    // Two approving accounts, and two likes that never count: the author's own and the young account's.
    await likedBy(repo, id, [fan1!, fan2!, author!, young], before(asOf, HOUR));
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    const computedAt = asOf.toISOString();
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });

    // A third approving account likes it now: a like counts once it has stood 10 minutes, for the status as for the refresh.
    await likedBy(repo, id, [fan3!], deps.now());
    expect(await status(author!.id, id)).toEqual({ status: "below_threshold", computedAt });
    // Ten minutes on it counts now, but not at the ranking's time, which came before it: the next refresh considers the post.
    setNow(after(asOf, 11 * MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt });
  });

  test("author_cap and below_cutoff: every rule met at the ranking's time, but the author's other posts, or the list's length, kept the post out", async () => {
    const asOf = nextAsOf();
    const [a, b, c] = await accounts(db, asOf, 3);
    const fans = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    // One age, in the order of their approving accounts: b1 6, a1 5, a2 4, then a3 and c1 with 3 each.
    const b1 = await approvedPost(repo, b!, at, fans.slice(0, 6), likedAt);
    const a1 = await approvedPost(repo, a!, at, fans.slice(0, 5), likedAt);
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 4), likedAt);
    const a3 = await approvedPost(repo, a!, at, fans.slice(0, 3), likedAt);
    const c1 = await approvedPost(repo, c!, at, fans.slice(0, 3), likedAt);
    // Written before the ranking, approved of only after it.
    const a4 = await newPost(repo, a!.id, at);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([b1, a1, a2, c1]);
    await likedBy(repo, a4, fans.slice(0, 3), after(asOf, MINUTE));
    setNow(after(asOf, 11 * MINUTE));
    const computedAt = asOf.toISOString();
    // With the published formula the author's two better posts hold their two places.
    expect(await status(a!.id, a3)).toEqual({ status: "author_cap", computedAt });
    // Met now but not at the ranking's time: pending, whatever places the author holds, since the next refresh decides.
    expect(await status(a!.id, a4)).toEqual({ status: "pending", computedAt });
    expect(await status(c!.id, c1)).toEqual({ status: "listed", computedAt });

    // A formula whose list holds three posts, ranking and judging alike: c1 meets every rule, but the list was full.
    const short: ExploreFormula = { ...EXPLORE_V2, minGapMinutes: 0, listLength: 3 };
    expect(await listed(db, (await rank(repo, asOf, short)).generation)).toEqual([b1, a1, a2]);
    expect(await status(c!.id, c1, short)).toEqual({ status: "below_cutoff", computedAt });
    expect(await status(a!.id, a3, short)).toEqual({ status: "author_cap", computedAt });
    expect(await status(a!.id, a1, short)).toEqual({ status: "listed", computedAt });
  });

  test("a post listed at the ranking's time stays listed until the next round, even once its 48 hours have passed; then it is outside_window", async () => {
    const asOf = nextAsOf();
    const [a, b, ...fans] = await accounts(db, asOf, 5);
    const window = EXPLORE_V2.windowHours * HOUR;
    // Five minutes short of 48 hours old at the ranking.
    const at = before(asOf, window - 5 * MINUTE);
    const kept = await approvedPost(repo, a!, at, fans, before(asOf, window - HOUR));
    const quiet = await approvedPost(repo, b!, at, fans.slice(0, 2), before(asOf, window - HOUR));
    const first = (await rank(repo, asOf)).generation;
    expect(await listed(db, first)).toEqual([kept]);
    // Ten minutes on, both are past their 48 hours.
    const later = after(asOf, 10 * MINUTE);
    setNow(later);
    expect(await status(a!.id, kept)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
    expect(await status(b!.id, quiet)).toEqual({ status: "outside_window", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([kept]);
    expect((await getPost(deps, a!.id, kept)).inExplore).toBe(true);

    // The next round leaves it out, and the status, the page and the chip follow, though the ranking before still holds it.
    expect(await listed(db, (await rank(repo, later)).generation)).toEqual([]);
    expect(await listed(db, first)).toEqual([kept]);
    expect(await status(a!.id, kept)).toEqual({ status: "outside_window", computedAt: later.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    expect(await getPost(deps, a!.id, kept)).not.toHaveProperty("inExplore");
  });

  test("a post left out because its author had switched Explore off is pending once the switch is back on, and listed after the next round", async () => {
    const asOf = nextAsOf();
    const [author, ...fans] = await accounts(db, asOf, 4);
    const id = await approvedPost(repo, author!, before(asOf, 2 * HOUR), fans, before(asOf, HOUR));
    setNow(before(asOf, MINUTE));
    await setShowInExplore(deps, author!.id, false);
    expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([]);
    setNow(after(asOf, MINUTE));
    expect(await status(author!.id, id)).toEqual({ status: "hidden_by_author", computedAt: asOf.toISOString() });

    await setShowInExplore(deps, author!.id, true);
    // Every rule is met now and was met at the ranking's time; what kept the post out has gone, so the next refresh considers it.
    expect(await status(author!.id, id)).toEqual({ status: "pending", computedAt: asOf.toISOString() });
    expect(pageIds(await read(null))).toEqual([]);
    const next = after(asOf, 5 * MINUTE);
    await rank(repo, next);
    expect(await status(author!.id, id)).toEqual({ status: "listed", computedAt: next.toISOString() });
    expect(pageIds(await read(null))).toEqual([id]);
  });

  test("the author's own listed posts carry inExplore wherever they are read, nobody else's view does, and it goes at once when the post is withheld or the switch is turned off", async () => {
    const asOf = nextAsOf();
    const [a, b, c, ...fans] = await accounts(db, asOf, 6);
    const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
    const a1 = await approvedPost(repo, a!, at, fans, likedAt);
    // Two approving accounts: not listed.
    const a2 = await approvedPost(repo, a!, at, fans.slice(0, 2), likedAt);
    const b1 = await approvedPost(repo, b!, at, fans, likedAt);
    // c quotes a1: its embed is a1 as its author sees it, but not a card of its own.
    const quote = await newPost(repo, c!.id, at, "a quote", { quoteOfId: a1 });
    const g = (await rank(repo, asOf)).generation;
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
    setNow(after(asOf, MINUTE));
    const chipped = (items: { post: { id: string; inExplore?: true } }[]) => items.filter((item) => item.post.inExplore === true).map((item) => item.post.id);

    // On the author's own views: the post itself, Explore and their profile's posts.
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);
    expect(await getPost(deps, a!.id, a2)).not.toHaveProperty("inExplore");
    expect(chipped((await read(a!.id)).items)).toEqual([a1]);
    expect(chipped((await profilePosts(deps, a!.id, a!.handle, { limit: 20 })).items)).toEqual([a1]);
    // Nobody else's: another account's, a signed-out reader's, or the author's own post embedded in someone's quote.
    expect(await getPost(deps, b!.id, a1)).not.toHaveProperty("inExplore");
    expect(await getPost(deps, null, a1)).not.toHaveProperty("inExplore");
    expect((await read(null)).items.filter((item) => "inExplore" in item.post)).toEqual([]);
    expect(chipped((await read(b!.id)).items)).toEqual([b1]);
    expect((await getPost(deps, a!.id, quote)).quoteOf).not.toHaveProperty("inExplore");

    // An engagement answer carries the counts and the viewer's own state, not the post: the card keeps its chip through it.
    const liked = await setEngagement(deps, a!.id, a1, "like", true);
    expect(Object.keys(liked).sort()).toEqual(["counts", "viewer"]);
    expect(Object.keys(liked.viewer).sort()).toEqual(["bookmarked", "liked", "reposted"]);
    expect((await getPost(deps, a!.id, a1)).inExplore).toBe(true);

    // Gone at once, before any further round: from a withheld post, and from every post of an author who switched Explore off.
    await setState(a1, "withheld");
    const withheld = await getPost(deps, a!.id, a1);
    expect(withheld.state).toBe("withheld");
    expect(withheld).not.toHaveProperty("inExplore");
    await setShowInExplore(deps, b!.id, false);
    expect(await getPost(deps, b!.id, b1)).not.toHaveProperty("inExplore");
    expect(new Set(await listed(db, g))).toEqual(new Set([a1, b1]));
  });

  /** Version 2's status (3e design, section 7.13 item 7): the window from explore_from, a restore after the ranking, a ranking of version 1. */
  describe("the status under version 2", () => {
    let migrateDb: Db;
    const resumed: string[] = [];
    beforeAll(() => {
      migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    });
    afterAll(async () => {
      try {
        await migrateDb.execute(sql`update posts set hidden_at = null, restored_at = null, explore_from = null where id = any(${`{${resumed.join(",")}}`}::uuid[])`);
      } finally {
        await closeDb(migrateDb);
      }
    });

    test("outside_window reads the resume time: a post created past its 48 hours whose time moderation gave back is still inside", async () => {
      const asOf = nextAsOf();
      const [author, ...fans] = await accounts(db, asOf, 4);
      const window = EXPLORE_V2.windowHours * HOUR;
      const resumedPost = await approvedPost(repo, author!, before(asOf, window + DAY), fans, before(asOf, HOUR));
      const plain = await approvedPost(repo, author!, before(asOf, window + DAY), fans, before(asOf, HOUR));
      // As moderation_apply writes it, set here as the migrator: hidden for a day, so the post resumes inside its window.
      resumed.push(resumedPost);
      await migrateDb.execute(sql`update posts set hidden_at = created_at, restored_at = created_at + interval '1 day', explore_from = created_at + interval '1 day' + interval '1 hour' where id = ${resumedPost}::uuid`);
      setNow(asOf);
      expect(await status(author!.id, plain)).toEqual({ status: "outside_window", computedAt: null });
      expect(await status(author!.id, resumedPost)).toEqual({ status: "no_ranking", computedAt: null });
      expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([resumedPost]);
      setNow(after(asOf, MINUTE));
      expect(await status(author!.id, resumedPost)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
      expect(await status(author!.id, plain)).toEqual({ status: "outside_window", computedAt: asOf.toISOString() });
    });

    test("a post restored after the ranking's time is pending: the ranking never saw it, whatever the author's places", async () => {
      const asOf = nextAsOf();
      const [a] = await accounts(db, asOf, 1);
      const fans = await accounts(db, asOf, 5);
      const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
      const a1 = await approvedPost(repo, a!, at, fans.slice(0, 5), likedAt);
      const a2 = await approvedPost(repo, a!, at, fans.slice(0, 4), likedAt);
      const a3 = await approvedPost(repo, a!, at, fans.slice(0, 3), likedAt);
      // Withheld before the ranking, and given back after it by a real decision: restored_at is the decision's time.
      await setState(a3, "withheld");
      expect(await listed(db, (await rank(repo, asOf)).generation)).toEqual([a1, a2]);
      await decideForTest(db, a3, "visible");
      setNow(after(asOf, 11 * MINUTE));
      // Met now and at the ranking's time with the author's two places full, it would read author_cap; the next round decides.
      expect(await status(a!.id, a3)).toEqual({ status: "pending", computedAt: asOf.toISOString() });
      expect(await status(a!.id, a1)).toEqual({ status: "listed", computedAt: asOf.toISOString() });
    });

    test("while the newest ranking is of version 1, only now is judged: pending when every rule is met now, else below_threshold", async () => {
      const asOf = nextAsOf();
      const [a] = await accounts(db, asOf, 1);
      const fans = await accounts(db, asOf, 5);
      const [at, likedAt] = [before(asOf, 2 * HOUR), before(asOf, HOUR)];
      const a1 = await approvedPost(repo, a!, at, fans.slice(0, 5), likedAt);
      const a2 = await approvedPost(repo, a!, at, fans.slice(0, 4), likedAt);
      const a3 = await approvedPost(repo, a!, at, fans.slice(0, 3), likedAt);
      const quiet = await approvedPost(repo, a!, at, fans.slice(0, 2), likedAt);
      // The ranking the last round before the deploy wrote, under version 1, holding a1 and a2.
      const [run] = await db.execute<{ generation: number }>(sql`insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${asOf.toISOString()}::timestamptz, 1, 4, 2, 0) returning generation`);
      await db.execute(sql`insert into explore_items (generation, position, post_id, author_id) values (${run!.generation}::int, 1, ${a1}::uuid, ${a!.id}::uuid), (${run!.generation}::int, 2, ${a2}::uuid, ${a!.id}::uuid)`);
      setNow(after(asOf, 11 * MINUTE));
      const computedAt = asOf.toISOString();
      expect(await status(a!.id, a1)).toEqual({ status: "listed", computedAt });
      // Judged at the ranking's time by version 2's rules it would read author_cap; that ranking applied other rules.
      expect(await status(a!.id, a3)).toEqual({ status: "pending", computedAt });
      expect(await status(a!.id, quiet)).toEqual({ status: "below_threshold", computedAt });
    });
  });

  leavesNoModerationRows(() => db);
});
```

### Replace `apps/api/test/integration/standing-grants.test.ts` (whole file)

```ts
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

  test("the three new tables: a reply is inserted and read, a mark is inserted (since the reporting counts' migration, beside its check) and read, tallies only read", async () => {
    expect(await tablePrivileges("korbat_api", "public.suspension_replies")).toEqual(["INSERT", "SELECT"]);
    expect(await tablePrivileges("korbat_api", "public.unfounded_marks")).toEqual(["INSERT", "SELECT"]);
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
        // 3e Task 5, the reporting counts: the check of a mark, its recheck at commit, the one writer of the tallies, and
        // forget_reporter, replaced, which the API runs at an account's purge.
        "public.unfounded_marks_check": [true, false, false],
        "public.unfounded_marks_recheck": [true, false, false],
        "public.report_tallies_count": [true, false, false],
        "public.forget_reporter": [true, true, false],
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
      // Task 5: report_tallies_count is the one writer of a tally; forget_reporter and the retention of a later task
      // only delete. A mark's reporter, report and times are forced by its check alone.
      expect(matching(/(INSERT INTO|UPDATE) public[.]report_tallies/i)).toEqual(["public.report_tallies_count"]);
      expect(matching(/NEW[.](account_id|intake_id|reported_at|marked_at) :=/)).toEqual(["public.unfounded_marks_check"]);
      // Task 6: moderation_apply, the one writer of a post's level, is the one writer of Explore's three columns, in the
      // statement that moves the level; only the posts' guard forces them, null on an insert by any role but the migrator.
      expect(matching(/(hidden_at|restored_at|explore_from) = /)).toEqual(["public.moderation_apply"]);
      expect(matching(/NEW[.](hidden_at|restored_at|explore_from) :=/)).toEqual(["public.posts_guard"]);
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
        // Task 5, the reporting counts.
        "public.unfounded_marks_check",
        "public.unfounded_marks_recheck",
        "public.report_tallies_count",
        "public.forget_reporter",
        // Task 6, Explore's resume rule: the two functions explore_resume replaces.
        "public.moderation_apply",
        "public.posts_guard",
      ];
      for (const name of fresh) expect(all.get(name)!.definition, name).not.toMatch(/interval '/i);
      expect([...all.get("public.decisions_record")!.definition.matchAll(/interval '/gi)]).toHaveLength(2);
      const views = await apiDb.execute<{ name: string; definition: string; options: string[] | null }>(
        sql`select c.relname::text as name, pg_get_viewdef(c.oid) as definition, c.reloptions as options from pg_class c
             where c.relkind = 'v' and c.relname in ('measures_in_force', 'active_strikes', 'suspension_periods', 'standing_live', 'reporting_record') order by 1`,
      );
      expect(views.map((v) => v.name)).toEqual(["active_strikes", "measures_in_force", "reporting_record", "standing_live", "suspension_periods"]);
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
                                                       'suspension_replies_apply', 'decisions_mail_forward', 'decisions_mail_standing',
                                                       'unfounded_marks_check', 'unfounded_marks_recheck', 'report_tallies_count') order by 1`,
      );
      const timing = Object.fromEntries(triggers.map((t) => [t.name, t.definition.replace(/^CREATE (CONSTRAINT )?TRIGGER [a-z_]+ /, "").replace(/ EXECUTE FUNCTION .*$/, "")]));
      expect(timing).toEqual({
        decisions_mail_forward: "BEFORE UPDATE OF author_mail, author_mail_at ON public.decisions FOR EACH ROW",
        decisions_mail_standing: expect.stringMatching(/^AFTER UPDATE OF author_mail ON public[.]decisions FOR EACH ROW WHEN [(].*IS DISTINCT FROM.*[)]$/),
        handle_history_insert: "BEFORE INSERT ON public.handle_history FOR EACH ROW",
        profiles_handle_guard: "BEFORE INSERT OR UPDATE OF handle ON public.profiles FOR EACH ROW",
        profiles_standing_insert: "BEFORE INSERT ON public.profiles FOR EACH ROW",
        suspension_replies_apply: "AFTER INSERT ON public.suspension_replies FOR EACH ROW",
        suspension_replies_check: "BEFORE INSERT ON public.suspension_replies FOR EACH ROW",
        // Task 5: the check of a mark before it is stored, its recheck at commit, and the tally of a report after it is.
        unfounded_marks_check: "BEFORE INSERT ON public.unfounded_marks FOR EACH ROW",
        unfounded_marks_recheck: "AFTER INSERT ON public.unfounded_marks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW",
        report_tallies_count: "AFTER INSERT ON public.intakes FOR EACH ROW",
      });
    });
  });

  test("this file left no row behind", async () => {
    expect(await rowCounts(apiDb)).toEqual(before);
  });
});
```

### Replace `apps/api/test/lab/standing.lab.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CaseDecidedParams, EXPLORE_V2, STANDING_RULES } from "@korbat/contracts";
import type { ActiveStaffSession, StaffStepUpConfirmed } from "../../src/auth";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { isDeadlock } from "../../src/lib/lock-bounds";
import type { ModerationDeps } from "../../src/moderation";
import { insertionOrder, recordConfirmed } from "../../src/moderation/decide";
import { caseTarget, insertAction, insertDecision, insertMarks } from "../../src/moderation/repo";
import { fileReply } from "../../src/moderation/standing";
import { onceMoreOnDeadlock } from "../../src/social/flows/posts";
import { createSocialRepo, type HandleChangeResult } from "../../src/social/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "../integration/moderation-decide";
import { act, ageStandingForTest, anAccount, aPost, decisionParams, ground, intake, newPostRow, removeFixtures, timed, type DecisionInput } from "../integration/moderation-fixtures";
import { noticesWorld, type NoticesWorld } from "../integration/notices-harness";
import { newPost, newProfile } from "../integration/social-fixtures";

/**
 * The labs of account sanctions on the real code (3e design, section 12.3), run by hand as contention.lab.ts is, on a
 * quiet machine, with their numbers recorded in the report of the task that runs them. Task 2 creates the file with lab
 * E; each later task of 3e adds the labs of its own code.
 *
 * Lab E: the retiring decision against a handle change back to the judged handle. Each account had the handle a case's
 * snapshot judged, then changed it, so the judged handle is in its history and its own to take back. For the first half
 * of the accounts, a retirement through the decide route's own code (a real confirmation by a staff key, made ready
 * first) and the social repository's changeHandle back to the judged handle are fired together; the other half are only
 * retired. It passes when no account is left holding a retired handle: a change that came second is refused (the claim
 * statement, or the guard under a race), and one that came first gets the placeholder from the retirement's
 * compare-and-set. It records the retirements committed, the refusals, the race winners given the placeholder, the
 * decisions' times and how busy the machine was. What it commits is removed at the end, but the audit rows of its
 * confirmed decisions, which are the record (as every committed decision's are), and the staff accounts' rows in the
 * auth schema, as the integration suites leave theirs.
 *
 * From apps/api, with the scratch stack's data services up and the test database migrated:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts
 *
 * LAB_E_ACCOUNTS sets the number of accounts (60 unless set, as the design's LAB E); LAB_OUT the file of the lines.
 *
 * Task 3 adds labs B1 and B5, B2 and B4, B6 and B7 (3e design, section 12.3), on the real code: the repository's own
 * functions as the writers and suspensions at once through the decide route's code. B2 and B4 run the two old orders,
 * which are copied into this file (oldPurge, decideWithOldLock) and never a switch in the code. Each records the
 * deadlocks the database detected over its run (pg_stat_database), the second tries of the flows and of the purge job,
 * and the decisions' times. LAB_B_SUBJECTS sets the subjects of B1 to B5 (36 unless set), LAB_B6_ACCOUNTS and
 * LAB_B7_ACCOUNTS the accounts of B6 and B7 (30 each unless set).
 *
 * Task 4 adds labs C1, C2 and D (3e design, section 12.3), in a block of their own below, with the notices world, whose
 * auth module mails each announced suspension's notice so that its start is fixed. Their own comment says what each runs
 * and when it passes; LAB_C_SUBJECTS and LAB_D_SUBJECTS set their accounts. To run only them:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts -t "labs? [CD]"
 *
 * Task 6 adds lab F (3e design, section 12.3) in a block of its own at the end: Explore's round under formula version 1,
 * copied into this file, and under version 2, the repository's own refreshExplore, on the same generated data. Its comment
 * says what it generates and when it passes; LAB_F_POSTS, LAB_F_LIKED_POSTS and LAB_F_ROUNDS set its sizes. To run only it:
 *
 *     node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/standing.lab.ts -t "lab F"
 */

/** Where the measurements go, one line of JSON each: the file LAB_OUT names, or lab-standing.jsonl in the repository's .data folder (the lab runs from apps/api). */
const OUT = process.env.LAB_OUT ?? path.resolve(process.cwd(), "../../.data/lab-standing.jsonl");
function line(name: string, result: Record<string, unknown>): void {
  const text = JSON.stringify({ name, at: new Date().toISOString(), ...result });
  mkdirSync(path.dirname(OUT), { recursive: true });
  appendFileSync(OUT, text + String.fromCharCode(10));
  console.log(`LAB ${text}`);
}

/** The share of processor time that was not idle over this many milliseconds, across all cores: how loaded the machine is. */
async function busy(ms = 1500): Promise<number> {
  const read = () => os.cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, all: sum.all + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle }), { idle: 0, all: 0 });
  const before = read();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const after = read();
  return Math.round((1 - (after.idle - before.idle) / Math.max(1, after.all - before.all)) * 100);
}

/** The value at a share of the sorted list, or null for none. */
const percentile = (sorted: readonly number[], share: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!);

/** At most this many decisions of one staff account in an hour (0016's decision_cap, as moderation_limits holds it by default). */
const DECISIONS_PER_STAFF = 50;
/** How many races run at once. */
const BATCH = 6;
/** How many rounds of its job a purge gets in labs B4, B5 and B7 before it counts as lost. */
const PURGE_ROUNDS = 5;

/**
 * 3c's account purge (B4): its own row, then every post of the account, then the counters, the follows and the profile,
 * with no counterpart's profile row taken first. Copied from the purge as 3c built it, without the media rows.
 */
async function oldPurge(db: Db, id: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
    await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
    await tx.execute(sql`
      update posts set reply_count = greatest(0, reply_count - c.n)
      from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
      where posts.id = c.reply_to_id`);
    await tx.execute(sql`
      update posts set quote_count = greatest(0, quote_count - c.n)
      from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
      where posts.id = c.quote_of_id`);
    await tx.execute(sql`update posts set state = 'deleted_by_author', deleted_at = ${now.toISOString()}::timestamptz, body = '' where author_id = ${id}::uuid and state <> 'deleted_by_author'`);
    await tx.execute(sql`
      with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
      update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
    await tx.execute(sql`
      with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
      update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
    await tx.execute(sql`delete from bookmarks where user_id = ${id}::uuid`);
    await tx.execute(sql`
      with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
      update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
    await tx.execute(sql`
      with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
      update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
    await tx.execute(sql`delete from blocks where blocker_id = ${id}::uuid or blocked_id = ${id}::uuid`);
    await tx.execute(sql`delete from mutes where muter_id = ${id}::uuid or muted_id = ${id}::uuid`);
    if (row) await tx.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${row.handle.toLowerCase()}, ${id}::uuid, ${now.toISOString()}::timestamptz) on conflict do nothing`);
    await tx.execute(sql`update profiles set display_name = 'Deleted account', bio = '', avatar_path = null, verified_at = null, follower_count = 0, following_count = 0, post_count = 0, deleted_at = ${now.toISOString()}::timestamptz
                         where id = ${id}::uuid and deleted_at is null`);
  });
}

/**
 * The decide route as it would be with the API's first lock left at FOR NO KEY UPDATE (B2): the route's own code but for
 * the mode, so that the ledger's trigger upgrades the lock to FOR UPDATE behind the case's lock.
 */
async function decideWithOldLock(deps: ModerationDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }) {
  const params = CaseDecidedParams.parse(confirmed.params);
  const caseId = confirmed.target.id;
  const target = await caseTarget(deps.apiDb, caseId);
  if (!target) throw new Error("lab: the case of a prepared decision is gone");
  const subject = target.type === "account" ? target.id : await deps.social.postAuthor(target.id);
  return recordConfirmed(
    deps,
    session,
    confirmed,
    ctx,
    subject,
    async (tx, decisionId) => {
      await insertDecision(tx, { id: decisionId, caseId, decidedBy: session.userId, params });
      await insertMarks(tx, decisionId, params.unfounded);
      for (const action of insertionOrder(params.actions)) await insertAction(tx, decisionId, action, params.replaced);
    },
    "no key update",
  );
}

/** What one write of the race came to: committed, refused with a code, or an error; with when it started. */
type WriteOutcome = { started: number; result: "committed" | string };

/** A write's outcome: "committed", the code a refusal carried, or "deadlock" for PostgreSQL's 40P01. */
async function outcomeOf(write: () => Promise<unknown>): Promise<WriteOutcome> {
  const started = Date.now();
  try {
    await write();
    return { started, result: "committed" };
  } catch (err) {
    if (isDeadlock(err)) return { started, result: "deadlock" };
    const code = (err as { code?: unknown }).code;
    return { started, result: typeof code === "string" ? code : "error" };
  }
}

/** Waits a random time up to `ms`. */
const jitter = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ms)));

describe.skipIf(!process.env.INTEGRATION)("lab: the standing ledger on the real code", () => {
  let apiDb: Db;
  let world: DeciderWorld;
  const made: string[] = [];

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 16 });
    world = deciderWorld(apiDb);
  });
  afterAll(async () => {
    try {
      await removeFixtures(world.migrateDb, made.splice(0));
      await world.close();
    } finally {
      await closeDb(apiDb);
    }
  }, 600_000);

  test("lab E: retirements through the decide route against changes back to the judged handle leave no account holding a retired handle", async () => {
    const accounts = Number(process.env.LAB_E_ACCOUNTS ?? 60);
    const racing = Math.floor(accounts / 2);
    const repo = createSocialRepo(apiDb);
    const staff: RealStaff[] = [];
    for (let i = 0; i < Math.ceil(accounts / DECISIONS_PER_STAFF); i++) staff.push(await world.staff("moderator"));

    // Each account: its case opened on the handle it holds (the snapshot judges that one), then a change to another, so
    // the judged handle is in its history; then a confirmation of its retirement, made ready before any race starts.
    type Prepared = { id: string; judged: string; member: RealStaff; confirmed: StaffStepUpConfirmed };
    const prepared: Prepared[] = [];
    for (let i = 0; i < accounts; i++) {
      const member = staff[Math.floor(i / DECISIONS_PER_STAFF)]!;
      const profile = await newProfile(apiDb);
      made.push(profile.id);
      const recorded = await intake(apiDb, ground.finding(member.id, "R4"), anAccount(profile.id, profile.handle));
      const caseId = recorded.items[0]!.caseId!;
      const moved = await repo.changeHandle(profile.id, `lab_${randomBytes(6).toString("hex")}`, new Date());
      if (!moved.ok) throw new Error(`lab E: the account could not leave its judged handle (${moved.reason})`);
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R4", actions: [act("retire_handle")] });
      prepared.push({ id: profile.id, judged: profile.handle, member, confirmed: await world.confirm(member, caseId, params) });
    }

    const busyPercent = await busy();
    const decisionMs: number[] = [];
    const counts = { retirements: 0, retirementsFailed: 0, changesRefusedRetired: 0, changesRefusedOther: 0, raceWinners: 0, raceWinnersGivenPlaceholder: 0, changeErrors: 0 };
    const started = performance.now();
    for (let from = 0; from < prepared.length; from += BATCH) {
      await Promise.all(
        prepared.slice(from, from + BATCH).map(async (account, offset) => {
          const index = from + offset;
          const retire = async () => {
            const start = performance.now();
            try {
              const outcome = await world.moderation.forStaff.decide(account.member.session, account.confirmed, { requestId: `lab-${randomUUID()}` });
              decisionMs.push(Math.round(performance.now() - start));
              if (typeof outcome === "string") counts.retirementsFailed++;
              else counts.retirements++;
            } catch {
              counts.retirementsFailed++;
            }
          };
          if (index >= racing) return retire();
          // A jitter of up to 25 ms on the change, so that each side wins some races.
          const change = async (): Promise<HandleChangeResult | "error"> => {
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25)));
            return repo.changeHandle(account.id, account.judged, new Date()).catch(() => "error" as const);
          };
          const [, changed] = await Promise.all([retire(), change()]);
          if (changed === "error") counts.changeErrors++;
          else if (changed.ok) counts.raceWinners++;
          else if (changed.reason === "handle_retired") counts.changesRefusedRetired++;
          else counts.changesRefusedOther++;
        }),
      );
    }
    const elapsedMs = Math.round(performance.now() - started);
    await world.moderation.settle();

    // The outcome: no lab account holds a handle whose row of handle_history is retired, and every race winner got the
    // placeholder of its retirement (the profile holds a handle of the placeholder's form).
    const ids = `{${prepared.map((account) => account.id).join(",")}}`;
    const [held] = await apiDb.execute<{ n: number }>(
      sql`select count(*)::int as n from profiles p where p.id = any(${ids}::uuid[]) and exists (select 1 from handle_history h where h.handle_lower = lower(p.handle) and h.retired_at is not null)`,
    );
    const onPlaceholder = await apiDb.execute<{ id: string }>(sql`select id from profiles where id = any(${ids}::uuid[]) and handle ~ '^retired_[0-9a-f]{12}$'`);
    counts.raceWinnersGivenPlaceholder = onPlaceholder.length;
    const retiredRows = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from handle_history where profile_id = any(${ids}::uuid[]) and retired_at is not null`);
    const sorted = [...decisionMs].sort((a, b) => a - b);
    line("lab-E", {
      accounts,
      racing,
      ...counts,
      retiredHandles: retiredRows[0]!.n,
      profilesHoldingRetiredHandle: held!.n,
      decisionP50Ms: percentile(sorted, 0.5),
      decisionP95Ms: percentile(sorted, 0.95),
      elapsedMs,
      busyPercent,
    });
    expect(held!.n).toBe(0);
    expect(counts.retirements).toBe(accounts);
    expect(counts.changeErrors).toBe(0);
    // Every race ends one of two ways: the change was refused because the handle was retired, or it won and the
    // retirement then gave the profile its placeholder.
    expect(counts.changesRefusedRetired + counts.raceWinners).toBe(racing);
    expect(counts.raceWinnersGivenPlaceholder).toBe(counts.raceWinners);
  }, 1_800_000);
  // ---------------------------------------------------------------- Task 3: labs B1 and B5, B2 and B4, B6 and B7

  /**
   * One account about to be suspended at once, with the accounts around it (labs B1, B2, B4 and B5): its post P, which
   * its three followers have liked and replied to, two third accounts that follow nobody, a post of the first of them,
   * an account the subject follows and unfollows in the race, which writes nothing itself (section 5 leaves a block's
   * order as 3c built it: a block of the subject by an account the subject unfollows at that moment takes the two rows
   * in the other order and can deadlock, which is no part of these labs), the R5 removal a suspension at once rests on
   * (the basis threat), its account case, and the suspension's confirmation by an admin's key, made ready before the
   * race starts.
   */
  interface Scene {
    subject: string;
    post: string;
    followers: string[];
    thirds: string[];
    thirdPost: string;
    followee: string;
    member: RealStaff;
    confirmed: StaffStepUpConfirmed;
  }

  async function scenes(count: number): Promise<Scene[]> {
    const repo = createSocialRepo(apiDb);
    // Two decisions for each scene (the basis's removal and the suspension), at most DECISIONS_PER_STAFF for an admin.
    const admins: RealStaff[] = [];
    for (let i = 0; i < Math.ceil((count * 2) / DECISIONS_PER_STAFF); i++) admins.push(await world.staff("admin"));
    const list: Scene[] = [];
    for (let i = 0; i < count; i++) {
      const member = admins[Math.floor((i * 2) / DECISIONS_PER_STAFF)]!;
      const subject = await newProfile(apiDb);
      const followers = [await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id);
      const thirds = [await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id);
      const followee = (await newProfile(apiDb)).id;
      made.push(subject.id, ...followers, ...thirds, followee);
      const post = await newPost(repo, subject.id, new Date(), "the subject's post");
      const thirdPost = await newPost(repo, thirds[0]!, new Date(), "a third account's post");
      for (const follower of followers) {
        await repo.follow(follower, subject.id, new Date());
        await repo.like(follower, post, new Date(), subject.id);
        await newPost(repo, follower, new Date(), "a follower's reply", { replyToId: post });
      }
      const basis = await newPostRow(apiDb, subject.id, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
      const finding = await intake(apiDb, ground.finding(member.id, "R5"), aPost(basis));
      const removed = await world.decideAs(member, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      if (typeof removed === "string") throw new Error(`lab B: the basis's removal was not recorded (${removed})`);
      const onAccount = await intake(apiDb, ground.finding(member.id, "R5"), anAccount(subject.id, subject.handle));
      const caseId = onAccount.items[0]!.caseId!;
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", 7, false)] });
      list.push({ subject: subject.id, post, followers, thirds, thirdPost, followee, member, confirmed: await world.confirm(member, caseId, params) });
    }
    return list;
  }

  /** How many deadlocks the test database has detected so far, read once every server process has reported its counts (an idle one reports within ten seconds). */
  let deadlockBase: number | null = null;
  async function settledDeadlocks(): Promise<number> {
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const [row] = await apiDb.execute<{ n: number }>(sql`select deadlocks::int as n from pg_stat_database where datname = current_database()`);
    return row!.n;
  }

  /** Counts each outcome by its name. */
  const tally = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  /**
   * A write as a flow runs it: once more on a deadlock (onceMoreOnDeadlock, the real flows' function), with each second
   * try counted.
   */
  function flowWrite<T>(write: () => Promise<T>, counts: { secondTries: number }): () => Promise<T> {
    return () => {
      let tries = 0;
      return onceMoreOnDeadlock(() => {
        if (++tries > 1) counts.secondTries++;
        return write();
      });
    };
  }

  /**
   * A purge as its job runs it: once, and again at each next round while the database chooses it to give way in a
   * deadlock (apps/api/src/account/purge.ts: a pending purge is tried every round until it is done). The lab's rounds
   * follow each other at once, while the other accounts still write; after PURGE_ROUNDS a purge counts as lost.
   */
  async function purgeAsJob(purge: (id: string) => Promise<void>, id: string, counts: { purgeRetries: number; purgesLost: number; purgeErrors: Record<string, number> }): Promise<void> {
    for (let round = 1; round <= PURGE_ROUNDS; round++) {
      try {
        await purge(id);
        return;
      } catch (err) {
        if (isDeadlock(err) && round < PURGE_ROUNDS) {
          counts.purgeRetries++;
          continue;
        }
        counts.purgesLost++;
        tally(counts.purgeErrors, isDeadlock(err) ? "deadlock" : String((err as { code?: unknown }).code ?? "error"));
        return;
      }
    }
  }

  /** Runs each loop's body again and again, a few milliseconds apart, until `main` has ended and `tail` milliseconds more have passed. */
  async function during(loops: (() => Promise<void>)[], main: () => Promise<void>, tail = 250): Promise<void> {
    let stop = false;
    const running = loops.map(async (body) => {
      while (!stop) {
        await body();
        await jitter(8);
      }
    });
    try {
      await main();
      await new Promise((resolve) => setTimeout(resolve, tail));
    } finally {
      stop = true;
      await Promise.all(running);
    }
  }

  type Variant = { name: string; decide: "new" | "old lock"; purge: "new" | "old order" };

  /**
   * Labs B1 and B5 and their counterparts B2 and B4 (3e design, section 12.3): each scene's subject is suspended at once
   * through the decide route's code while it keeps writing (posts, replies, likes, follows, its profile), third accounts
   * reply to, quote and like its post P, follow and unfollow it, and follow and then block and unblock it, its third
   * follower likes P, replies to it and unfollows and follows the subject again, and two of its followers, who liked P
   * and replied to it before the race, are purged by their job (B5's share, which is B4's). The purged followers write
   * nothing during the race: an account is taken down before its purge runs, so no request of its own meets that purge
   * (B5's purged accounts were never a party of its loops; lab B7 runs the accounts around a purged one). A write of the
   * subject that began after its decision returned and still committed is a write inside the suspension. Deadlocks are
   * the database's own count over the run; second tries are the flows' (follow, unfollow, createPost) and the purge job's.
   */
  async function suspensionRace(variant: Variant) {
    const count = Number(process.env.LAB_B_SUBJECTS ?? 36);
    const prepared = await scenes(count);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const repo = createSocialRepo(writersDb);
    const counts = {
      suspensions: 0,
      decisionsLate: 0,
      decisionErrors: {} as Record<string, number>,
      subjectWrites: 0,
      subjectCommittedBefore: 0,
      subjectRefused: {} as Record<string, number>,
      writesInsideSuspension: 0,
      otherWrites: {} as Record<string, number>,
      secondTries: 0,
      purges: 0,
      purgeRetries: 0,
      purgesLost: 0,
      purgeErrors: {} as Record<string, number>,
    };
    const decisionMs: number[] = [];
    try {
      const before = deadlockBase ?? (await settledDeadlocks());
      const busyPercent = await busy();
      const started = performance.now();
      for (let from = 0; from < prepared.length; from += BATCH) {
        await Promise.all(
          prepared.slice(from, from + BATCH).map(async (scene) => {
            const s = scene.subject;
            let returnedAt = Number.POSITIVE_INFINITY;
            const subjectLoop = (() => {
              let i = 0;
              return async () => {
                const kind = i++ % 5;
                const write =
                  kind === 0
                    ? flowWrite(() => repo.createPost({ authorId: s, body: "a post", replyToId: null, quoteOfId: null, now: new Date() }), counts)
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: s, body: "a reply", replyToId: scene.thirdPost, quoteOfId: null, now: new Date(), lockWith: scene.thirds[0]! }), counts)
                      : kind === 2
                        ? () => repo.like(s, scene.thirdPost, new Date(), scene.thirds[0]!)
                        : kind === 3
                          ? flowWrite(() => repo.follow(s, scene.followee, new Date(), true), counts)
                          : async () => {
                              if (!(await repo.updateProfile(s, { bio: `bio ${i}` }))) throw Object.assign(new Error("refused"), { code: "account_suspended" });
                            };
                const outcome = await outcomeOf(write);
                counts.subjectWrites++;
                if (outcome.result === "committed") {
                  if (outcome.started > returnedAt) counts.writesInsideSuspension++;
                  else counts.subjectCommittedBefore++;
                } else tally(counts.subjectRefused, outcome.result);
                // What the subject may still do, so that its next like and follow write again.
                if (kind === 2) await repo.unlike(s, scene.thirdPost).catch(() => undefined);
                if (kind === 3) await repo.unfollow(s, scene.followee).catch(() => undefined);
              };
            })();
            const thirdLoop = (t: string, n: number) => {
              let i = n;
              return async () => {
                const kind = i++ % 5;
                // A block of the subject by an account that follows it writes both counters of the follow it removes, after
                // its lockLive took the subject's row FOR KEY SHARE: with the old first lock, the decision's upgrade waits
                // for that share while the block's counter update waits for the decision (lab B2's followers' counter
                // updates). Blocks get no second try in their flow.
                const write =
                  kind === 0
                    ? flowWrite(() => repo.createPost({ authorId: t, body: "a reply", replyToId: scene.post, quoteOfId: null, now: new Date(), lockWith: s }), counts)
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: t, body: "a quote", replyToId: null, quoteOfId: scene.post, now: new Date(), lockWith: s }), counts)
                      : kind === 2
                        ? () => repo.like(t, scene.post, new Date(), s).then(() => repo.unlike(t, scene.post))
                        : kind === 3
                          ? () => flowWrite(() => repo.follow(t, s, new Date(), true), counts)().then(flowWrite(() => repo.unfollow(t, s), counts))
                          : () => flowWrite(() => repo.follow(t, s, new Date(), true), counts)().then(() => repo.block(t, s, new Date())).then(() => repo.unblock(t, s));
                tally(counts.otherWrites, (await outcomeOf(write)).result);
              };
            };
            // The follower who stays likes P, replies to it, and unfollows and follows the subject again.
            const keeper = scene.followers[2]!;
            const keeperLoop = (() => {
              let i = 0;
              return async () => {
                const kind = i++ % 3;
                const write =
                  kind === 0
                    ? () => repo.like(keeper, scene.post, new Date(), s).then(() => repo.unlike(keeper, scene.post))
                    : kind === 1
                      ? flowWrite(() => repo.createPost({ authorId: keeper, body: "a reply", replyToId: scene.post, quoteOfId: null, now: new Date(), lockWith: s }), counts)
                      : () => flowWrite(() => repo.unfollow(keeper, s), counts)().then(flowWrite(() => repo.follow(keeper, s, new Date(), true), counts));
                tally(counts.otherWrites, (await outcomeOf(write)).result);
              };
            })();
            const purge = variant.purge === "new" ? (id: string) => repo.purgeProfile(id, new Date(), async () => undefined) : (id: string) => oldPurge(writersDb, id, new Date());
            const decideOnce = () =>
              variant.decide === "new"
                ? world.moderation.forStaff.decide(scene.member.session, scene.confirmed, { requestId: `lab-${randomUUID()}` })
                : decideWithOldLock(world.moderation.deps, scene.member.session, scene.confirmed, { requestId: `lab-${randomUUID()}` });
            await during(
              [subjectLoop, thirdLoop(scene.thirds[0]!, 0), thirdLoop(scene.thirds[1]!, 2), keeperLoop],
              async () => {
                const purges = scene.followers.slice(0, 2).map(async (f) => {
                  await jitter(400);
                  counts.purges++;
                  await purgeAsJob(purge, f, counts);
                });
                await jitter(300);
                const start = performance.now();
                try {
                  const outcome = await decideOnce();
                  if (typeof outcome === "string") counts.decisionsLate++;
                  else counts.suspensions++;
                } catch (err) {
                  tally(counts.decisionErrors, String((err as { code?: unknown }).code ?? "error"));
                }
                returnedAt = Date.now();
                decisionMs.push(Math.round(performance.now() - start));
                await Promise.all(purges);
              },
            );
          }),
        );
      }
      const elapsedMs = Math.round(performance.now() - started);
      await world.moderation.settle();
      const ids = `{${prepared.map((scene) => scene.subject).join(",")}}`;
      const [running] = await apiDb.execute<{ n: number }>(
        sql`select count(*)::int as n from profiles where id = any(${ids}::uuid[]) and suspended_from is not null and suspended_from <= clock_timestamp() and clock_timestamp() < suspended_until`,
      );
      const after = await settledDeadlocks();
      deadlockBase = after;
      const sorted = [...decisionMs].sort((a, b) => a - b);
      const result = { subjects: count, ...counts, suspensionsRunning: running!.n, deadlocksDetected: after - before, decisionP50Ms: percentile(sorted, 0.5), decisionP95Ms: percentile(sorted, 0.95), decisionMaxMs: sorted.at(-1) ?? null, elapsedMs, busyPercent };
      line(variant.name, result);
      return result;
    } finally {
      await closeDb(writersDb);
    }
  }

  test("labs B1 and B5: suspensions at once under FOR UPDATE with the purge taking its counterparts first: no write inside a suspension, no deadlock", async () => {
    const result = await suspensionRace({ name: "lab-B1-B5", decide: "new", purge: "new" });
    expect(result.writesInsideSuspension).toBe(0);
    expect(result.suspensions).toBe(result.subjects);
    expect(result.suspensionsRunning).toBe(result.subjects);
    expect(result.decisionErrors).toEqual({});
    expect(result.purgesLost).toBe(0);
    expect(result.deadlocksDetected).toBe(0);
  }, 1_800_000);

  test("lab B2: the same with the decision's first lock left at FOR NO KEY UPDATE (the old lock, copied here)", async () => {
    const result = await suspensionRace({ name: "lab-B2", decide: "old lock", purge: "new" });
    // Recorded, not held: B2 shows what the reorder removes. The enforcement holds whatever the lock order.
    expect(result.writesInsideSuspension).toBe(0);
  }, 1_800_000);

  test("lab B4: the same with 3c's purge order (posts first, no counterpart taken first; copied here)", async () => {
    const result = await suspensionRace({ name: "lab-B4", decide: "new", purge: "old order" });
    expect(result.writesInsideSuspension).toBe(0);
  }, 1_800_000);

  test("lab B6: the account's own deletion against its suspension at once: either order, no error, no_effect deleted when the deletion won", async () => {
    const accounts = Number(process.env.LAB_B6_ACCOUNTS ?? 30);
    const repo = createSocialRepo(apiDb);
    const admins: RealStaff[] = [];
    for (let i = 0; i < Math.ceil((accounts * 2) / DECISIONS_PER_STAFF); i++) admins.push(await world.staff("admin"));
    type Prepared = { id: string; member: RealStaff; confirmed: StaffStepUpConfirmed };
    const prepared: Prepared[] = [];
    for (let i = 0; i < accounts; i++) {
      const member = admins[Math.floor((i * 2) / DECISIONS_PER_STAFF)]!;
      const profile = await newProfile(apiDb);
      made.push(profile.id);
      await newPost(repo, profile.id, new Date(), "a post the purge tombstones");
      const basis = await newPostRow(apiDb, profile.id, { createdAt: sql`clock_timestamp()`, body: "a post with a direct threat" });
      const finding = await intake(apiDb, ground.finding(member.id, "R5"), aPost(basis));
      const removed = await world.decideAs(member, finding.items[0]!.caseId!, { kind: "final", ruleId: "R5", actions: [act("remove")] });
      if (typeof removed === "string") throw new Error(`lab B6: the basis's removal was not recorded (${removed})`);
      const onAccount = await intake(apiDb, ground.finding(member.id, "R5"), anAccount(profile.id, profile.handle));
      const caseId = onAccount.items[0]!.caseId!;
      const params = await decisionParams(apiDb, member, caseId, { kind: "final", ruleId: "R5", actions: [timed("suspend", 7, false)] });
      prepared.push({ id: profile.id, member, confirmed: await world.confirm(member, caseId, params) });
    }
    const before = deadlockBase ?? (await settledDeadlocks());
    const busyPercent = await busy();
    const decisionMs: number[] = [];
    const decisions: string[] = [];
    const counts = { decided: 0, decisionsLate: 0, decisionErrors: {} as Record<string, number>, purged: 0, purgeErrors: {} as Record<string, number> };
    const started = performance.now();
    for (let from = 0; from < prepared.length; from += BATCH) {
      await Promise.all(
        prepared.slice(from, from + BATCH).map(async (account) => {
          const suspend = async () => {
            await jitter(25);
            const start = performance.now();
            try {
              const outcome = await world.moderation.forStaff.decide(account.member.session, account.confirmed, { requestId: `lab-${randomUUID()}` });
              decisionMs.push(Math.round(performance.now() - start));
              if (typeof outcome === "string") counts.decisionsLate++;
              else {
                counts.decided++;
                decisions.push(outcome.decisionId);
              }
            } catch (err) {
              tally(counts.decisionErrors, String((err as { code?: unknown }).code ?? "error"));
            }
          };
          const remove = async () => {
            await jitter(25);
            try {
              await repo.purgeProfile(account.id, new Date(), async () => undefined);
              counts.purged++;
            } catch (err) {
              tally(counts.purgeErrors, isDeadlock(err) ? "deadlock" : String((err as { code?: unknown }).code ?? "error"));
            }
          };
          await Promise.all([suspend(), remove()]);
        }),
      );
    }
    const elapsedMs = Math.round(performance.now() - started);
    await world.moderation.settle();
    const effects = await apiDb.execute<{ no_effect: string | null; n: number }>(
      sql`select no_effect, count(*)::int as n from decision_actions where decision_id = any(${`{${decisions.join(",")}}`}::uuid[]) and kind = 'suspend' group by no_effect`,
    );
    const decidedBeforeDeletion = effects.find((row) => row.no_effect === null)?.n ?? 0;
    const decidedAfterDeletion = effects.find((row) => row.no_effect === "deleted")?.n ?? 0;
    const ids = `{${prepared.map((account) => account.id).join(",")}}`;
    const [deletedRows] = await apiDb.execute<{ n: number; written: number }>(
      sql`select count(*)::int as n, count(*) filter (where suspended_from is not null)::int as written from profiles where id = any(${ids}::uuid[]) and deleted_at is not null`,
    );
    const after = await settledDeadlocks();
    deadlockBase = after;
    const sorted = [...decisionMs].sort((a, b) => a - b);
    line("lab-B6", {
      accounts,
      ...counts,
      decidedBeforeDeletion,
      decidedAfterDeletion,
      otherEffects: effects.filter((row) => row.no_effect !== null && row.no_effect !== "deleted"),
      deletedProfiles: deletedRows!.n,
      deletedProfilesWithSuspensionColumns: deletedRows!.written,
      deadlocksDetected: after - before,
      decisionP50Ms: percentile(sorted, 0.5),
      decisionP95Ms: percentile(sorted, 0.95),
      elapsedMs,
      busyPercent,
    });
    expect(counts.decisionErrors).toEqual({});
    expect(counts.purgeErrors).toEqual({});
    expect(counts.decisionsLate).toBe(0);
    expect(decidedBeforeDeletion + decidedAfterDeletion).toBe(accounts);
    expect(deletedRows!.n).toBe(accounts);
  }, 1_800_000);

  test("lab B7: purged accounts followed, unfollowed, replied to and quoted by lower and higher ids while the purge runs: no error, no purge lost", async () => {
    const groups = Number(process.env.LAB_B7_ACCOUNTS ?? 30);
    const repo = createSocialRepo(apiDb);
    // Each group: four accounts in id order; the purged one, X, is the second, so one account has a lower id than X and
    // two a higher. The lower one and the first higher one follow X and reply to and quote its post; X follows the lower
    // one and the last; the last follows and unfollows X.
    type Group = { x: string; post: string; lower: string; higher: string; last: string };
    const prepared: Group[] = [];
    for (let i = 0; i < groups; i++) {
      const four = [await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb), await newProfile(apiDb)].map((profile) => profile.id).sort();
      made.push(...four);
      const [lower, x, higher, last] = four as [string, string, string, string];
      const post = await newPost(repo, x, new Date(), "a post of the account to be purged");
      await repo.follow(lower, x, new Date());
      await repo.follow(higher, x, new Date());
      await repo.follow(x, lower, new Date());
      await repo.follow(x, last, new Date());
      prepared.push({ x, post, lower, higher, last });
    }
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const writers = createSocialRepo(writersDb);
    const counts = { requests: {} as Record<string, number>, secondTries: 0, purges: 0, purgeRetries: 0, purgesLost: 0, purgeErrors: {} as Record<string, number> };
    try {
      const before = deadlockBase ?? (await settledDeadlocks());
      const busyPercent = await busy();
      const started = performance.now();
      for (let from = 0; from < prepared.length; from += BATCH) {
        await Promise.all(
          prepared.slice(from, from + BATCH).map(async (group) => {
            const follower = (who: string, n: number) => {
              let i = n;
              return async () => {
                const kind = i++ % 3;
                const write =
                  kind === 0
                    ? () => flowWrite(() => writers.unfollow(who, group.x), counts)().then(flowWrite(() => writers.follow(who, group.x, new Date(), true), counts))
                    : kind === 1
                      ? flowWrite(() => writers.createPost({ authorId: who, body: "a quote", replyToId: null, quoteOfId: group.post, now: new Date(), lockWith: group.x }), counts)
                      : flowWrite(() => writers.createPost({ authorId: who, body: "a reply", replyToId: group.post, quoteOfId: null, now: new Date(), lockWith: group.x }), counts);
                tally(counts.requests, (await outcomeOf(write)).result);
              };
            };
            const toggler = async () => {
              const write = () => flowWrite(() => writers.follow(group.last, group.x, new Date(), true), counts)().then(flowWrite(() => writers.unfollow(group.last, group.x), counts));
              tally(counts.requests, (await outcomeOf(write)).result);
            };
            await during([follower(group.lower, 0), follower(group.higher, 1), toggler], async () => {
              await jitter(300);
              counts.purges++;
              await purgeAsJob((id) => writers.purgeProfile(id, new Date(), async () => undefined), group.x, counts);
            });
          }),
        );
      }
      const elapsedMs = Math.round(performance.now() - started);
      const ids = `{${prepared.map((group) => group.x).join(",")}}`;
      const [live] = await apiDb.execute<{ n: number }>(sql`select count(*)::int as n from profiles where id = any(${ids}::uuid[]) and deleted_at is null`);
      // What the purge left must be whole: no follow of or by a purged account, and no live post of one.
      const [leftovers] = await apiDb.execute<{ follows: number; posts: number }>(sql`
        select (select count(*)::int from follows where follower_id = any(${ids}::uuid[]) or followee_id = any(${ids}::uuid[])) as follows,
               (select count(*)::int from posts where author_id = any(${ids}::uuid[]) and state <> 'deleted_by_author') as posts`);
      const after = await settledDeadlocks();
      deadlockBase = after;
      const errors = Object.entries(counts.requests).filter(([result]) => !["committed", "not_found", "post_unavailable"].includes(result));
      line("lab-B7", { groups, ...counts, requestErrors: Object.fromEntries(errors), purgedLeftLive: live!.n, followsLeft: leftovers!.follows, livePostsLeft: leftovers!.posts, deadlocksDetected: after - before, elapsedMs, busyPercent });
      expect(errors).toEqual([]);
      expect(counts.purgesLost).toBe(0);
      expect(live!.n).toBe(0);
      expect(leftovers).toEqual({ follows: 0, posts: 0 });
    } finally {
      await closeDb(writersDb);
    }
  }, 1_800_000);
});

/**
 * Labs C1, C2 and D (3e design, section 12.3; Task 4), on the real code: announced suspensions of the ladder's first step,
 * each decided through the decide route's own code by a moderator after three strikes, its notice mailed through the
 * notices world's auth module so that its start is fixed, and that start then brought a moment ahead by
 * ageStandingForTest (the migrator moves every time of the account's ledger back, and standing_apply writes the profile's
 * columns again). Every time the labs judge by is the database's clock, read before and after each write.
 *
 * C1: around each start the account writes through the social repository's own functions, back to back (the free loop),
 * and a wave of its writes is fired while a holder has its profile row FOR UPDATE and changes it, from before the start
 * to after it (a writer of the row, as a handle change or standing_apply is). It passes when no write judged at or after a
 * start commits: a free write that began after the start, or a wave write, which the database judges again when it gets
 * the row. It also records a wave behind a holder that only locks the row (as a decision whose measure changes nothing
 * of the profile does): PostgreSQL then judges a locking statement before it waits, so those writes, judged before the
 * start, commit after it, and the lab records how many and how late.
 *
 * C2: the same wave behind the changing holder, with the predicate copied into this file reading now() in place of the
 * clock (lab code, never a switch in the code): writes whose transaction began before the start are admitted although
 * judged after it, which is what the clock rule prevents.
 *
 * D: each account replies through fileReply, the reply route's own function, at a moment from 300 ms before to 300 ms
 * after its start, while it writes back to back. It passes when on_time equals filed_at < start for every reply, no write
 * is refused before a start, none is refused after an on-time reply, and none is admitted at or after the start of a
 * measure whose reply came late.
 *
 * LAB_C_SUBJECTS sets the accounts of C1 and of C2 (25 each unless set, the design's LAB C starts), LAB_D_SUBJECTS those of D
 * (60 unless set, as the design's LAB D).
 */
describe.skipIf(!process.env.INTEGRATION)("lab: announced starts and replies on the real code (Task 4)", () => {
  let n: NoticesWorld;
  let cd: DeciderWorld;
  /** Each staff account decides at most DECISIONS_PER_STAFF a hour: a new one is made when the last is near its cap. */
  const pools = { admin: { members: [] as RealStaff[], used: 0 }, moderator: { members: [] as RealStaff[], used: 0 } };

  beforeAll(() => {
    n = noticesWorld();
    cd = deciderWorld(n.apiDb, { auth: n.authForModeration });
  });
  afterAll(async () => {
    try {
      await n.cleanUp();
      await cd.close();
    } finally {
      await n.close();
    }
  }, 600_000);

  async function staffOf(role: "admin" | "moderator"): Promise<RealStaff> {
    const pool = pools[role];
    if (pool.members.length === 0 || pool.used >= DECISIONS_PER_STAFF - 2) {
      pool.members.push(await cd.staff(role));
      pool.used = 0;
    }
    pool.used++;
    return pool.members.at(-1)!;
  }

  /** Counts each outcome by its name. */
  const tally = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  async function decided(member: RealStaff, caseId: string, input: DecisionInput): Promise<string> {
    const outcome = await cd.decideAs(member, caseId, input);
    if (typeof outcome === "string") throw new Error(`lab C/D: a decision was not recorded (${outcome})`);
    return outcome.decisionId;
  }

  type Subject = { id: string; decisionId: string; third: string; thirdPost: string; followee: string };

  /**
   * An account at the ladder's first step with its announced suspension of 3 days: three strikes (a post made now, an
   * admin's own finding on it under R1 and a final removal, one after another), then an admin's finding on the account and
   * a moderator's final decision with the announced suspension, whose notice the scripted mailer accepts. A third account
   * with a post, and an account to follow, are the other parties of its writes.
   */
  async function subject(repo: ReturnType<typeof createSocialRepo>): Promise<Subject> {
    const account = await n.account();
    for (let i = 0; i < STANDING_RULES.ladderStrikes; i++) {
      const admin = await staffOf("admin");
      const postId = await newPostRow(n.apiDb, account.id, { createdAt: sql`clock_timestamp()`, body: "a post that breaks R1" });
      const caseId = (await intake(n.apiDb, ground.finding(admin.id, "R1"), aPost(postId))).items[0]!.caseId!;
      await decided(admin, caseId, { kind: "final", ruleId: "R1", actions: [act("remove")] });
    }
    const opener = await staffOf("admin");
    const caseId = (await intake(n.apiDb, ground.finding(opener.id, "R1"), anAccount(account.id, account.handle))).items[0]!.caseId!;
    const decisionId = await decided(await staffOf("moderator"), caseId, { kind: "final", ruleId: "R1", actions: [timed("suspend", 3, true)] });
    const third = (await newProfile(n.apiDb)).id;
    const followee = (await newProfile(n.apiDb)).id;
    n.profileIds.push(third, followee);
    const thirdPost = await newPost(repo, third, new Date(), "a third account's post");
    return { id: account.id, decisionId, third, thirdPost, followee };
  }

  /** The database's clock, in epoch milliseconds. */
  async function dbNow(db: Db): Promise<number> {
    const [row] = await db.execute<{ ms: number }>(sql`select extract(epoch from clock_timestamp()) * 1000 as ms`);
    return Number(row!.ms);
  }

  /** How far the database's clock runs ahead of this process's: the middle of a read's round trip. */
  async function clockOffset(db: Db): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = Date.now();
      const at = await dbNow(db);
      samples.push(at - (before + Date.now()) / 2);
    }
    return samples.sort((a, b) => a - b)[2]!;
  }

  /** Waits until the database's clock reads `atMs`, by this process's clock and the offset. */
  const untilDb = (atMs: number, offset: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, atMs - offset - Date.now())));

  /**
   * Brings the account's start `leadMs` ahead of the database's clock: the migrator moves the account's ledger back by the
   * time left to its start, less the lead. Answers the start, in epoch milliseconds and as the database's text (to the
   * microsecond, for the comparisons made in SQL).
   */
  async function bringNear(id: string, leadMs: number): Promise<{ ms: number; text: string }> {
    for (let round = 0; ; round++) {
      const [row] = await cd.migrateDb.execute<{ secs: number | null }>(sql`select extract(epoch from (suspended_from - clock_timestamp()))::float8 as secs from profiles where id = ${id}::uuid`);
      if (row?.secs !== null && row?.secs !== undefined) {
        await ageStandingForTest(cd.migrateDb, id, `${(Number(row.secs) - leadMs / 1000).toFixed(6)} seconds`);
        break;
      }
      // The notice's outcome is recorded after the decision's commit: wait for it.
      if (round >= 50) throw new Error("lab C/D: the announced suspension got no start");
      await cd.moderation.settle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [after] = await cd.migrateDb.execute<{ ms: number; text: string }>(sql`select extract(epoch from suspended_from) * 1000 as ms, suspended_from::text as text from profiles where id = ${id}::uuid`);
    return { ms: Number(after!.ms), text: after!.text };
  }

  /** One of the account's writes through the social repository's own functions, by its number: a post, a reply, a like, a follow, its profile. */
  function realWrite(repo: ReturnType<typeof createSocialRepo>, s: Subject, i: number): () => Promise<unknown> {
    const kind = i % 5;
    if (kind === 0) return () => repo.createPost({ authorId: s.id, body: "a post", replyToId: null, quoteOfId: null, now: new Date() });
    if (kind === 1) return () => repo.createPost({ authorId: s.id, body: "a reply", replyToId: s.thirdPost, quoteOfId: null, now: new Date(), lockWith: s.third });
    if (kind === 2) return () => repo.like(s.id, s.thirdPost, new Date(), s.third).then(() => repo.unlike(s.id, s.thirdPost));
    if (kind === 3) return () => repo.follow(s.id, s.followee, new Date(), true).then(() => repo.unfollow(s.id, s.followee));
    return async () => {
      if (!(await repo.updateProfile(s.id, { bio: `bio ${i}` }))) throw Object.assign(new Error("refused"), { code: "account_suspended" });
    };
  }

  /** A write between two reads of the database's clock: when it was judged lies between them. */
  async function bracketed(db: Db, write: () => Promise<unknown>): Promise<{ t0: number; t1: number; result: string }> {
    const t0 = await dbNow(db);
    const { result } = await outcomeOf(write);
    return { t0, t1: await dbNow(db), result };
  }

  /**
   * A holder of the account's profile row: FOR UPDATE, and a change of the row when `changes` (bio = bio, a new version
   * of the row, as any writer of the row makes), held until the database's clock reads `untilMs`. `locked` resolves once
   * it has the row; `released` with the clock at its commit.
   */
  function hold(db: Db, id: string, untilMs: number, changes: boolean): { locked: Promise<void>; released: Promise<number> } {
    let signal: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => (signal = resolve));
    const released = db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(sql`select 1 from profiles where id = ${id}::uuid for update`);
      if (changes) await tx.execute(sql`update profiles set bio = bio where id = ${id}::uuid`);
      signal();
      await tx.execute(sql`select pg_sleep(greatest(0, ${untilMs / 1000}::float8 - extract(epoch from clock_timestamp())))`);
      return dbNow(tx as unknown as Db);
    });
    return { locked, released };
  }

  /**
   * C2's write: the gate of the social repository's writes copied here with now() in place of the clock (lab code), then
   * the count of the account's posts, as a post's write changes it. It answers whether it was admitted, and when it was
   * judged: the target list is computed again when the database judges the row again after a changing holder.
   */
  async function nowGatedWrite(db: Db, id: string): Promise<{ admitted: boolean; judged: number }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      const [row] = await tx.execute<{ suspended: boolean; judged: number }>(
        sql`select (p.suspended_from is not null and p.suspended_from <= now() and now() < p.suspended_until) as suspended,
                   extract(epoch from clock_timestamp()) * 1000 as judged
              from profiles p where p.id = ${id}::uuid and p.deleted_at is null for key share`,
      );
      if (!row || row.suspended) return { admitted: false, judged: Number(row?.judged ?? 0) };
      await tx.execute(sql`update profiles set post_count = post_count + 1 where id = ${id}::uuid`);
      return { admitted: true, judged: Number(row.judged) };
    });
  }

  /** The accounts' scenes, BATCH at a time. */
  async function inBatches<T>(items: T[], scene: (item: T) => Promise<void>): Promise<void> {
    for (let from = 0; from < items.length; from += BATCH) await Promise.all(items.slice(from, from + BATCH).map(scene));
  }

  /** The free loop: the account's real writes back to back until the database's clock reads `untilMs`, each between two reads of the clock. */
  async function freeLoop(db: Db, repo: ReturnType<typeof createSocialRepo>, s: Subject, untilMs: number) {
    const writes: { t0: number; t1: number; result: string }[] = [];
    for (let i = 0; (await dbNow(db)) < untilMs; i++) writes.push(await bracketed(db, realWrite(repo, s, i)));
    return writes;
  }

  const WAVE = 6;
  const LEAD_MS = 1500;

  test("labs C1 and C2: around an announced start no write judged at or after it commits under the clock; with now() some are", async () => {
    const count = Number(process.env.LAB_C_SUBJECTS ?? 25);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const holderDb = createDb(loadConfig().DATABASE_URL_API, { max: 12 });
    const repo = createSocialRepo(writersDb);
    try {
      const prepareStarted = performance.now();
      const c1: Subject[] = [];
      const c2: Subject[] = [];
      for (let i = 0; i < count; i++) c1.push(await subject(repo));
      for (let i = 0; i < count; i++) c2.push(await subject(repo));
      const prepareMs = Math.round(performance.now() - prepareStarted);
      const offset = await clockOffset(writersDb);
      const busyPercent = await busy();

      const r1 = {
        starts: 0,
        freeWrites: 0,
        freeCommittedBefore: 0,
        freeAdmittedAfterStart: 0,
        freeRefusedBeforeStart: 0,
        freeAcross: 0,
        freeAcrossLatestCommitMs: 0,
        freeOther: {} as Record<string, number>,
        waveWrites: 0,
        waveAdmittedAfterStart: 0,
        waveRefused: {} as Record<string, number>,
        lockOnlyWaveWrites: 0,
        lockOnlyCommittedAfterStart: 0,
        lockOnlyLatestCommitMs: 0,
        lockOnlyRefused: {} as Record<string, number>,
      };
      await inBatches(c1, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        r1.starts++;
        const free = freeLoop(writersDb, repo, s, start.ms + 1000);
        // The wave behind a holder that changes the row, from 400 ms before the start to 300 ms after it.
        await untilDb(start.ms - 400, offset);
        const changing = hold(holderDb, s.id, start.ms + 300, true);
        await changing.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, (_, k) => bracketed(writersDb, realWrite(repo, s, k))));
        await changing.released;
        for (const w of wave) {
          r1.waveWrites++;
          if (w.result === "committed") r1.waveAdmittedAfterStart++;
          else tally(r1.waveRefused, w.result);
        }
        for (const w of await free) {
          r1.freeWrites++;
          if (w.result === "committed") {
            if (w.t0 >= start.ms) r1.freeAdmittedAfterStart++;
            else if (w.t1 < start.ms) r1.freeCommittedBefore++;
            else {
              r1.freeAcross++;
              r1.freeAcrossLatestCommitMs = Math.max(r1.freeAcrossLatestCommitMs, Math.round(w.t1 - start.ms));
            }
          } else if (w.result === "account_suspended" && w.t1 < start.ms) r1.freeRefusedBeforeStart++;
          else if (w.result !== "account_suspended") tally(r1.freeOther, w.result);
        }
      });
      // The wave behind a holder that only locks the row: its writes are judged before they wait (recorded, not asserted).
      // C1's accounts are suspended now, so this runs on half of C2's accounts, whose start is still ahead; C2 then runs
      // on the other half and on as many new accounts.
      const lockOnly = c2.slice(0, Math.max(1, Math.floor(count / 2)));
      await inBatches(lockOnly, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        await untilDb(start.ms - 400, offset);
        const holder = hold(holderDb, s.id, start.ms + 300, false);
        await holder.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, (_, k) => bracketed(writersDb, realWrite(repo, s, k))));
        await holder.released;
        for (const w of wave) {
          r1.lockOnlyWaveWrites++;
          if (w.result === "committed") {
            if (w.t1 >= start.ms) {
              r1.lockOnlyCommittedAfterStart++;
              r1.lockOnlyLatestCommitMs = Math.max(r1.lockOnlyLatestCommitMs, Math.round(w.t1 - start.ms));
            }
          } else tally(r1.lockOnlyRefused, w.result);
        }
      });
      line("lab-C1", { subjects: count, ...r1, prepareMs, clockOffsetMs: Math.round(offset), busyPercent });

      // C2: the wave behind a changing holder, with the predicate reading now(), on accounts whose start is still ahead.
      const fresh: Subject[] = c2.slice(lockOnly.length);
      for (let i = fresh.length; i < count; i++) fresh.push(await subject(repo));
      const r2 = { starts: 0, writes: 0, admittedAfterStart: 0, latestAdmittedAfterStartMs: 0, admittedBefore: 0, refused: 0 };
      await inBatches(fresh, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        r2.starts++;
        await untilDb(start.ms - 400, offset);
        const changing = hold(holderDb, s.id, start.ms + 300, true);
        await changing.locked;
        const wave = await Promise.all(Array.from({ length: WAVE }, () => nowGatedWrite(writersDb, s.id)));
        await changing.released;
        for (const w of wave) {
          r2.writes++;
          if (!w.admitted) r2.refused++;
          else if (w.judged >= start.ms) {
            r2.admittedAfterStart++;
            r2.latestAdmittedAfterStartMs = Math.max(r2.latestAdmittedAfterStartMs, Math.round(w.judged - start.ms));
          } else r2.admittedBefore++;
        }
      });
      line("lab-C2", { subjects: fresh.length, ...r2, busyPercent: await busy() });

      expect(r1.starts).toBe(count);
      expect(r1.freeAdmittedAfterStart).toBe(0);
      expect(r1.freeRefusedBeforeStart).toBe(0);
      expect(r1.waveAdmittedAfterStart).toBe(0);
      expect(r1.waveWrites).toBe(count * WAVE);
      expect(r2.admittedAfterStart).toBeGreaterThan(0);
    } finally {
      await Promise.all([closeDb(writersDb), closeDb(holderDb)]);
    }
  }, 1_800_000);

  test("lab D: replies around the start: on_time equals filed_at < start; no write refused before a start or after an on-time reply, none admitted after the start of a late one", async () => {
    const count = Number(process.env.LAB_D_SUBJECTS ?? 60);
    const writersDb = createDb(loadConfig().DATABASE_URL_API, { max: 24 });
    const repo = createSocialRepo(writersDb);
    try {
      const subjects: Subject[] = [];
      for (let i = 0; i < count; i++) subjects.push(await subject(repo));
      const offset = await clockOffset(writersDb);
      const busyPercent = await busy();
      const r = {
        replies: 0,
        onTime: 0,
        late: 0,
        mismatches: 0,
        replyErrors: {} as Record<string, number>,
        earliestFiledMs: Number.POSITIVE_INFINITY,
        latestFiledMs: Number.NEGATIVE_INFINITY,
        writes: 0,
        refusedBeforeStart: 0,
        refusedAfterOnTimeReply: 0,
        admittedAfterLateStart: 0,
        across: 0,
        otherOutcomes: {} as Record<string, number>,
      };
      await inBatches(subjects, async (s) => {
        const start = await bringNear(s.id, LEAD_MS);
        const free = freeLoop(writersDb, repo, s, start.ms + 1000);
        await untilDb(start.ms - 300 + Math.random() * 600, offset);
        try {
          await fileReply(n.deps, s.id, s.decisionId, { statement: "lab D" });
        } catch (err) {
          tally(r.replyErrors, String((err as { code?: unknown }).code ?? "error"));
        }
        const writes = await free;
        const [reply] = await cd.migrateDb.execute<{ on_time: boolean; before: boolean; filed_ms: number }>(
          sql`select on_time, filed_at < ${start.text}::timestamptz as before, extract(epoch from filed_at) * 1000 - ${start.ms}::float8 as filed_ms
                from suspension_replies where account_id = ${s.id}::uuid`,
        );
        if (!reply) return;
        r.replies++;
        if (reply.on_time) r.onTime++;
        else r.late++;
        if (reply.on_time !== reply.before) r.mismatches++;
        r.earliestFiledMs = Math.min(r.earliestFiledMs, Math.round(Number(reply.filed_ms)));
        r.latestFiledMs = Math.max(r.latestFiledMs, Math.round(Number(reply.filed_ms)));
        for (const w of writes) {
          r.writes++;
          const refused = w.result === "account_suspended";
          if (w.result !== "committed" && !refused) tally(r.otherOutcomes, w.result);
          else if (refused && w.t1 < start.ms) r.refusedBeforeStart++;
          else if (refused && reply.on_time) r.refusedAfterOnTimeReply++;
          else if (!refused && !reply.on_time && w.t0 >= start.ms) r.admittedAfterLateStart++;
          else if (w.t0 < start.ms && start.ms <= w.t1) r.across++;
        }
      });
      line("lab-D", { subjects: count, ...r, clockOffsetMs: Math.round(offset), busyPercent });
      expect(r.replies).toBe(count);
      expect(r.mismatches).toBe(0);
      expect(r.refusedBeforeStart).toBe(0);
      expect(r.refusedAfterOnTimeReply).toBe(0);
      expect(r.admittedAfterLateStart).toBe(0);
    } finally {
      await closeDb(writersDb);
    }
  }, 1_800_000);
});

/**
 * Explore's round under formula version 1, as 2c built it and as it ran until 3e's Task 6, copied here (lab F's baseline;
 * never a switch in the code): the candidates by created_at alone with live authors, the engagement with live engagers,
 * the score by the age since created_at, and the same transaction around it as refreshExplore's, writing a ranking of
 * formula 1. It answers the round's counts.
 */
async function roundV1(db: Db, asOf: Date): Promise<{ generation: number; candidates: number; items: number }> {
  // Version 2 keeps every number of version 1 (3e design, section 10.1).
  const f = EXPLORE_V2;
  const at = sql`${asOf.toISOString()}::timestamptz`;
  const since = sql`${at} - (${f.windowHours}::float8 * interval '1 hour')`;
  const settled = sql`${at} - (${f.standingMinutes}::float8 * interval '1 minute')`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '30s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const [run] = await tx.execute<{ generation: number }>(sql`insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${at}, 1, 0, 0, 0) returning generation`);
    const generation = run!.generation;
    const [counts] = await tx.execute<{ candidates: number; items: number }>(sql`
      with c as (
        select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
        where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
          and a.deleted_at is null and a.show_in_explore),
      e as (
        select x.post_id, x.user_id from (
          select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}
          union all
          select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}
        ) x
        join c on c.id = x.post_id
        join profiles u on u.id = x.user_id
        where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - (${f.engagerMinAgeHours}::float8 * interval '1 hour')),
      ap as (select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${f.threshold}),
      s as (
        select c.id as post_id, c.author_id,
          ap.approvers / power(greatest(0, extract(epoch from (${at} - c.created_at))::float8 / 3600) + ${f.offsetHours}::float8, ${f.gravity}::float8) as score
        from ap join c on c.id = ap.post_id),
      r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
      k as (
        select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
        from r where r.author_rank <= ${f.perAuthor} order by position limit ${f.listLength}),
      ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
      select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`);
    await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items} where generation = ${generation}`);
    await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${f.kept}) g)`);
    return { generation, candidates: counts!.candidates, items: counts!.items };
  });
}

/** What one round of lab F answered. */
type LabFRound = { generation: number; candidates: number; items: number };

/**
 * Writes lab F's rows as the migrator (the comment of lab F says what), as of `asOf`, under two display names that mark
 * them; answers the sizes it wrote.
 */
async function labFData(migrateDb: Db, asOf: Date, names: { authors: string; engagers: string; mark: string }, n: { posts: number; likedPosts: number; authors: number; engagers: number; likesPerPost: number }) {
  const at = sql`${asOf.toISOString()}::timestamptz`;
  const since = sql`${at} - (${EXPLORE_V2.windowHours}::float8 * interval '1 hour')`;
  // The accounts, a month old at the round, with handles of twenty characters that nothing else holds.
  for (const [name, count, tag] of [[names.authors, n.authors, "a"], [names.engagers, n.engagers, "e"]] as const) {
    await migrateDb.execute(sql`
      insert into profiles (id, handle, display_name, created_at)
      select gen_random_uuid(), 'lf_' || substr(md5(${names.mark} || ${tag} || g::text), 1, 17), ${name}, ${at} - interval '30 days' from generate_series(1, ${count}::int) g`);
  }
  // One post every so many milliseconds back from the round, over 72 hours, the authors in turn.
  const spacingMs = (72 * 3_600_000) / n.posts;
  await migrateDb.execute(sql`
    with a as (select id, row_number() over (order by id) - 1 as n from profiles where display_name = ${names.authors})
    insert into posts (author_id, body, created_at)
    select a.id, 'lab F', ${at} - (g * ${spacingMs}::float8 * interval '1 millisecond')
      from generate_series(0, ${n.posts}::int - 1) g join a on a.n = g % ${n.authors}::int`);
  // Restored: one post in a hundred of those before the window, hidden from its creation for 30 hours and given that time
  // back, as moderation_apply writes it.
  await migrateDb.execute(sql`
    with old as (
      select p.id, row_number() over (order by p.created_at, p.id) as n from posts p join profiles a on a.id = p.author_id
       where a.display_name = ${names.authors} and p.created_at <= ${since})
    update posts p set hidden_at = p.created_at, restored_at = p.created_at + interval '30 hours', explore_from = p.created_at + interval '30 hours'
      from old where p.id = old.id and old.n % 100 = 0`);
  // Six likes on each of the newest posts, seven minutes apart, each by another engager.
  await migrateDb.execute(sql`
    with p as (
      select p.id, p.created_at, row_number() over (order by p.created_at desc, p.id) - 1 as n from posts p join profiles a on a.id = p.author_id
       where a.display_name = ${names.authors}),
    e as (select id, row_number() over (order by id) - 1 as n from profiles where display_name = ${names.engagers})
    insert into likes (user_id, post_id, created_at)
    select e.id, p.id, p.created_at + ((k + 1) * interval '7 minutes')
      from p cross join generate_series(0, ${n.likesPerPost}::int - 1) k join e on e.n = (p.n * 7 + k * 131) % ${n.engagers}::int
     where p.n < ${n.likedPosts}::int`);
  // One author in twenty and one engager in twenty suspended over the round's time.
  for (const name of [names.authors, names.engagers]) {
    await migrateDb.execute(sql`
      update profiles set suspended_from = ${at} - interval '1 day', suspended_until = ${at} + interval '1 day'
       where id in (select id from (select id, row_number() over (order by id) as n from profiles where display_name = ${name}) s where s.n % 20 = 0)`);
  }
  for (const table of ["profiles", "posts", "likes"]) await migrateDb.execute(sql.raw(`analyze ${table}`));
  const [sizes] = await migrateDb.execute<{ posts: number; likes: number; restored: number; suspendedAuthors: number; suspendedEngagers: number }>(sql`
    select (select count(*)::int from posts p join profiles a on a.id = p.author_id where a.display_name = ${names.authors}) as posts,
           (select count(*)::int from likes l join profiles u on u.id = l.user_id where u.display_name = ${names.engagers}) as likes,
           (select count(*)::int from posts p join profiles a on a.id = p.author_id where a.display_name = ${names.authors} and p.explore_from is not null) as restored,
           (select count(*)::int from profiles where display_name = ${names.authors} and suspended_from is not null) as "suspendedAuthors",
           (select count(*)::int from profiles where display_name = ${names.engagers} and suspended_from is not null) as "suspendedEngagers"`);
  return { ...sizes! };
}

/**
 * Lab F (3e design, section 12.3; Task 6): Explore's round on generated data, under version 1 (roundV1 above) and under
 * version 2 (the repository's own refreshExplore), in turns on the same rows, as of one time in 2019, a past no suite
 * ranks in. As the migrator it writes LAB_F_POSTS posts (60,000 unless set) by 3,000 authors, one every 4.32 seconds
 * back from the round over 72 hours, so a third lie before the window; 1,000 engaging accounts; six likes on each of the
 * newest LAB_F_LIKED_POSTS posts (50,100 unless set: 300,600 likes, the design's LAB F); one author in twenty and one
 * engager in twenty suspended over the round's time; and one post in a hundred of those before the window hidden for 30
 * hours and given its time back (labFData). Each version then ranks LAB_F_ROUNDS times (5 unless set), after one round
 * each to warm up. It passes when both medians are of the same order (neither more than three times the other), when
 * version 2 ranks no suspended author, and when restored posts are among its candidates. It records the sizes, each
 * version's times, medians and counts, and how busy the machine was. What it wrote is deleted at the end, with every
 * ranking.
 */
describe.skipIf(!process.env.INTEGRATION)("lab: Explore's round under formula versions 1 and 2 (Task 6)", () => {
  test("lab F: the round's statement under version 1 (copied here) and version 2 on the same generated data: the same order of cost", async () => {
    const n = { posts: Number(process.env.LAB_F_POSTS ?? 60_000), likedPosts: Number(process.env.LAB_F_LIKED_POSTS ?? 50_100), authors: 3_000, engagers: 1_000, likesPerPost: 6 };
    const rounds = Number(process.env.LAB_F_ROUNDS ?? 5);
    const asOf = new Date(Date.UTC(2019, 5, 1, 12));
    const at = sql`${asOf.toISOString()}::timestamptz`;
    const since = sql`${at} - (${EXPLORE_V2.windowHours}::float8 * interval '1 hour')`;
    const mark = randomBytes(4).toString("hex");
    const names = { authors: `lab F author ${mark}`, engagers: `lab F engager ${mark}`, mark };
    const apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 2 });
    const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    const repo = createSocialRepo(apiDb);
    try {
      await apiDb.execute(sql`delete from explore_runs`);
      const sizes = await labFData(migrateDb, asOf, names, n);
      const busyPercent = await busy();
      // A round of each version in turn, the first of each to warm up; version 2 with no minimum gap, so every round ranks.
      const again = { ...EXPLORE_V2, minGapMinutes: 0 };
      const times = { v1: [] as number[], v2: [] as number[] };
      let v1: LabFRound | null = null;
      let v2: LabFRound | null = null;
      for (let i = 0; i <= rounds; i++) {
        let started = performance.now();
        v1 = await roundV1(apiDb, asOf);
        const v1Ms = performance.now() - started;
        started = performance.now();
        const ranked = await repo.refreshExplore(asOf, again);
        const v2Ms = performance.now() - started;
        if (ranked.skipped) throw new Error("lab F: a round of version 2 skipped");
        v2 = { generation: ranked.generation, candidates: ranked.candidates, items: ranked.items };
        if (i === 0) continue;
        times.v1.push(v1Ms);
        times.v2.push(v2Ms);
      }
      const median = (list: number[]) => Math.round(percentile([...list].sort((x, y) => x - y), 0.5)!);
      const [v1Median, v2Median] = [median(times.v1), median(times.v2)];
      // Version 2's newest ranking holds no post of a suspended author; the restored posts it could count as candidates.
      const [check] = await migrateDb.execute<{ suspendedItems: number; restoredCandidates: number }>(sql`
        select (select count(*)::int from explore_items i join profiles a on a.id = i.author_id
                 where i.generation = ${v2!.generation}::int and a.suspended_from <= ${at} and ${at} < a.suspended_until) as "suspendedItems",
               (select count(*)::int from posts p join profiles a on a.id = p.author_id
                 where a.display_name = ${names.authors} and p.explore_from is not null and p.created_at <= ${since} and p.explore_from > ${since} and p.explore_from <= ${at}
                   and not (a.suspended_from is not null and a.suspended_from <= ${at} and ${at} < a.suspended_until)) as "restoredCandidates"`);
      line("lab-F", {
        ...sizes,
        authors: n.authors,
        engagers: n.engagers,
        rounds,
        v1MedianMs: v1Median,
        v2MedianMs: v2Median,
        ratio: Math.round((v2Median / Math.max(1, v1Median)) * 100) / 100,
        v1Ms: times.v1.map(Math.round),
        v2Ms: times.v2.map(Math.round),
        v1: { candidates: v1!.candidates, items: v1!.items },
        v2: { candidates: v2!.candidates, items: v2!.items },
        ...check!,
        busyPercent,
      });
      expect(sizes.posts).toBe(n.posts);
      expect(sizes.likes).toBe(n.likedPosts * n.likesPerPost);
      expect(v2Median).toBeLessThan(3 * v1Median);
      expect(v1Median).toBeLessThan(3 * v2Median);
      expect(check!.suspendedItems).toBe(0);
      expect(check!.restoredCandidates).toBeGreaterThan(0);
    } finally {
      try {
        await apiDb.execute(sql`delete from explore_runs`);
        await migrateDb.execute(sql`delete from likes where user_id in (select id from profiles where display_name = ${names.engagers})`);
        await migrateDb.execute(sql`delete from posts where author_id in (select id from profiles where display_name = ${names.authors})`);
        await migrateDb.execute(sql`delete from profiles where display_name in (${names.authors}, ${names.engagers})`);
      } finally {
        await Promise.all([closeDb(apiDb), closeDb(migrateDb)]);
      }
    }
  }, 1_800_000);
});
```

### Replace `apps/api/test/social/explore-job.test.ts` (whole file)

```ts
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EXPLORE_V2 } from "@korbat/contracts";
import { MemoryJobLock, type JobLock } from "../../src/lib/jobs";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createExploreJob, startExplore } from "../../src/social/explore";
import type { ExploreRefresh, SocialRepo } from "../../src/social/repo";

const MINUTE = 60_000;
/** The refresh interval of the published formula: five minutes. */
const INTERVAL = EXPLORE_V2.refreshMinutes * MINUTE;

interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

/**
 * The Explore job on a fake repository, under fake timers: each round takes the next answer from a queue (an Error is
 * thrown, an empty queue answers skipped) and records the time it was asked to rank as of. The logger keeps every line
 * without the time, pid and hostname, so a line holds only its level, its message and what the job logged. The lock
 * records the key and hold time of every acquisition.
 */
function harness() {
  const answers: (ExploreRefresh | Error)[] = [];
  const asked: number[] = [];
  const lines: LogLine[] = [];
  const holds: { key: string; ttlMs: number }[] = [];
  const repo = {
    async refreshExplore(asOf: Date): Promise<ExploreRefresh> {
      asked.push(asOf.getTime());
      const answer = answers.shift() ?? { skipped: true };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  } satisfies Pick<SocialRepo, "refreshExplore">;
  const deps: SocialDeps = {
    repo: repo as unknown as SocialRepo,
    media: WITHOUT_MEDIA,
    limits: new MemoryStore(() => Date.now()),
    log: pino({ level: "info", base: null, timestamp: false }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    now: () => new Date(),
  };
  const memory = new MemoryJobLock(() => Date.now());
  const lock: JobLock = {
    acquire: (key, token, ttlMs) => (holds.push({ key, ttlMs }), memory.acquire(key, token, ttlMs)),
    refresh: (key, token, ttlMs) => memory.refresh(key, token, ttlMs),
    release: (key, token) => memory.release(key, token),
  };
  return { deps, answers, asked, lines, holds, lock };
}

const ranked = (generation: number): ExploreRefresh => ({ skipped: false, generation, candidates: 10 + generation, items: generation, tookMs: 100 + generation });

describe("the Explore job", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("starts with a round at once, then runs one every five minutes, each ranking as of its own time, until stopped", async () => {
    const h = harness();
    const start = Date.now();
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(h.asked).toEqual([start]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.asked).toEqual([start, start + INTERVAL]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toEqual([start, start + INTERVAL, start + 2 * INTERVAL]);
    stop();
    await vi.advanceTimersByTimeAsync(3 * INTERVAL);
    expect(h.asked).toHaveLength(3);
  });

  test("every round holds the shared lock job:explore-refresh for five minutes, and skips while another instance holds it", async () => {
    const h = harness();
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.holds).toEqual([{ key: "job:explore-refresh", ttlMs: INTERVAL }]);
    await h.lock.acquire("job:explore-refresh", "another instance", INTERVAL);
    expect(await job.round()).toBe("skipped");
    expect(h.asked).toHaveLength(1);
    await h.lock.release("job:explore-refresh", "another instance");
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
  });

  test("a round that ranks logs one line with exactly its generation, candidates, items and milliseconds; a skipped round logs nothing", async () => {
    const h = harness();
    h.answers.push(ranked(7), { skipped: true });
    const job = createExploreJob(h.deps, h.lock);
    expect(await job.round()).toBe("ran");
    expect(h.lines).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 7, candidates: 17, items: 7, tookMs: 107 }]);
    expect(await job.round()).toBe("ran");
    expect(h.asked).toHaveLength(2);
    expect(h.lines).toHaveLength(1);
  });

  test("a failed round at start is logged as the timer logs one, and the timer runs on; so does a failed timer round", async () => {
    const h = harness();
    h.answers.push(new Error("the database is unreachable"), ranked(1), new Error("the statement timed out"), ranked(2));
    const stop = startExplore(h.deps, h.lock);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.asked).toHaveLength(1);
    expect(h.lines).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the database is unreachable" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(2);
    expect(h.lines.slice(1)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 1, candidates: 11, items: 1, tookMs: 101 }]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.lines.slice(2)).toEqual([
      expect.objectContaining({ level: 50, msg: "job: round failed", job: "explore-refresh", err: expect.objectContaining({ message: "the statement timed out" }) }),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(h.asked).toHaveLength(4);
    expect(h.lines.slice(3)).toEqual([{ level: 30, msg: "explore: ranking refreshed", generation: 2, candidates: 12, items: 2, tookMs: 102 }]);
    stop();
  });
});
```

### Replace `apps/app/test/explore.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EXPLORE_V2, ExploreStatusKind, type ExploreFormula, type ExplorePage, type MeResponse, type PostView, type TimelineItem } from "@korbat/contracts";
import ExploreAbout, { ExploreRules } from "../src/app/explore/about";
import Home, { homeListKey, homeTab, homeTabs } from "../src/app/index";
import { ExploreSwitch, useExploreSwitch } from "../src/app/settings/privacy";
import { PopularPosts } from "../src/components/PopularNow";
import { ExploreEmpty, ExploreFooter, ExploreHeader } from "../src/components/social/ExploreList";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError } from "../src/lib/api";
import {
  appendUnseen,
  EXPLORE_REFRESHED_NOTICE,
  exploreEmptyText,
  exploreReader,
  exploreRules,
  exploreStatusText,
  exploreSwitchText,
  rankingAge,
  readPages,
  STALE_AFTER_MS,
  type RankingRead,
} from "../src/lib/explore";
import type { ExploreAnswer } from "../src/lib/social";
import { TERMS_SECTIONS, TERMS_VERSION } from "../src/lib/terms";

/**
 * Explore in the web app (2c design, section 11): the tabs, the list, the formula page, the switch, the status line, the
 * chip, the context column and the terms. The helpers that decide (the tab an address names, the lists' keys, the
 * ranking's age, what a page of a new ranking adds, the list's reads, every sentence and its numbers) are called, the
 * reads with fake answers; the screens and components are server-rendered as lifecycle.test.tsx renders its pages; what a
 * static render cannot show (requests, focus, the order of a save) is read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

// expo-router cannot load in Node (it reaches React Native's own modules): Link with `asChild` hands the child its href,
// which react-native-web renders as a real anchor, a screen reads its parameters and the path, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
// A post card's images and the compose sheet's slide reach native modules that do not load in Node; neither is under test.
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source file of the app, with its path from src in forward slashes. */
function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}

/** The body of the function `name` declares at the top of a file, up to its closing brace at the start of a line. */
function block(source: string, name: string): string {
  const from = source.indexOf(`function ${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return source.slice(from, source.indexOf("\n}\n", from));
}

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

/** The text of every link to `href`, in order. */
function linkTexts(markup: string, href: string): string[] {
  const texts: string[] = [];
  for (let at = markup.indexOf(`href="${href}"`); at !== -1; at = markup.indexOf(`href="${href}"`, at + 1)) {
    const start = markup.lastIndexOf("<a ", at);
    const end = markup.indexOf("</a>", at);
    if (start !== -1 && end !== -1) texts.push(markup.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return texts;
}

/** The opening tag of the button whose text is `label`, or "" when there is none. */
function buttonTag(markup: string, label: string): string {
  const at = markup.indexOf(label);
  const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
  return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
}

/** The tabs of the markup's tab list, in order: each one's text and whether it is selected. */
function tabsOf(markup: string): { label: string; selected: boolean }[] {
  return [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({
    label: match[2] ?? "",
    selected: (match[1] ?? "").includes('aria-selected="true"'),
  }));
}

/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const AUTHOR = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
const OTHER = "1e2d3c4b-5a69-4786-9a5b-4c3d2e1f0a9b";
const AT = "2026-09-28T12:05:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: AUTHOR, handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-09-28T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}
// ExplorePage's items are post items only: the contract's refinement narrows the timeline item.
const item = (n: number): ExplorePage["items"][number] => ({ kind: "post", post: post(n) });
const explorePage = (posts: number[], nextCursor: string | null): ExplorePage => ({ items: posts.map(item), nextCursor, computedAt: AT, signInForMore: false });
const ids = (items: TimelineItem[]): string[] => items.map((entry) => entry.post.id);
/** The Date header of an answer carrying the ranking of AT: two and a half minutes after it, by the server's clock. */
const DATE = new Date(Date.parse(AT) + 150_000).toUTCString();
/** When that answer arrived, by the device's clock. */
const RECEIVED = Date.parse(AT) + 151_000;
/** A page of Explore as the app's client answers it: with the answer's Date header and the time it arrived. */
const answer = (posts: number[], nextCursor: string | null, extra: Partial<ExploreAnswer> = {}): ExploreAnswer => ({
  ...explorePage(posts, nextCursor),
  date: DATE,
  receivedAt: RECEIVED,
  ...extra,
});

const ME: MeResponse = {
  user: { id: AUTHOR, email: "ada@example.org", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
  profile: { id: AUTHOR, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true },
  standing: null,
};
const signedIn = (showInExplore = true) => ({ status: "signed-in", me: { ...ME, profile: { ...ME.profile!, showInExplore } } });

describe("Home's tabs and their addresses", () => {
  test("an account has Following, Latest and Explore; everyone else Latest and Explore, Latest first as before", () => {
    expect(homeTabs(true)).toEqual(["following", "latest", "explore"]);
    expect(homeTabs(false)).toEqual(["latest", "explore"]);
  });

  test("the tab is the one /?tab= names, and a missing, unknown or unavailable name means the first tab", () => {
    expect(homeTab(undefined, true)).toBe("following");
    expect(homeTab("latest", true)).toBe("latest");
    expect(homeTab("explore", true)).toBe("explore");
    expect(homeTab(undefined, false)).toBe("latest");
    expect(homeTab("explore", false)).toBe("explore");
    // Following needs an account.
    expect(homeTab("following", false)).toBe("latest");
    expect(homeTab("trending", true)).toBe("following");
    expect(homeTab("Explore", true)).toBe("following");
    // A parameter given twice counts once, by its first value.
    expect(homeTab(["explore", "latest"], true)).toBe("explore");
  });

  test("signed in, Home shows the three tabs with the one the address names selected, and Explore's list under them", () => {
    session.state = signedIn();
    route.params = { tab: "explore" };
    const out = html(<Home />);
    expect(out).toContain('role="tablist"');
    expect(tabsOf(out)).toEqual([
      { label: "Following", selected: false },
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    // The list's header, with its link to the rules.
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    route.params = {};
    const following = html(<Home />);
    expect(tabsOf(following).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Following"]);
    expect(linkTexts(following, "/explore/about")).toEqual([]);
  });

  test("signed out, Home shows Latest and Explore, and the prompt under them fits the tab", () => {
    session.state = { status: "signed-out" };
    route.params = {};
    const latest = html(<Home />);
    expect(tabsOf(latest)).toEqual([
      { label: "Latest", selected: true },
      { label: "Explore", selected: false },
    ]);
    expect(latest).toContain("You are reading the latest public posts. Sign in to follow people and post.");
    route.params = { tab: "explore" };
    const explore = html(<Home />);
    expect(tabsOf(explore)).toEqual([
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    expect(explore).toContain("Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.");
    // True whatever the list holds: it neither promises more of Explore, which may not exist, nor says posts are being read
    // over a list that may be empty. Only the list's own footer, shown when more posts exist, offers more of it.
    expect(explore).not.toContain("see more of Explore");
    expect(explore).not.toContain("You are reading");
    route.params = { tab: "following" };
    expect(tabsOf(html(<Home />)).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Latest"]);
    route.params = {};
  });

  test("each list is keyed by its tab, the posts written on Home and its reader, so signing in or out, or another account, reads it again", () => {
    // A list read signed out has no cursor and a sign-in link and was read without any block or mute, and the web keeps a
    // Home mounted under the sign-in screen, which Back shows again once signed in.
    const readers = [homeListKey("explore", 0, null), homeListKey("explore", 0, AUTHOR), homeListKey("explore", 0, OTHER)];
    expect(new Set(readers).size).toBe(3);
    expect(homeListKey("latest", 0, null)).not.toBe(homeListKey("latest", 0, AUTHOR));
    // Another tab and a new post still make a new list.
    expect(homeListKey("latest", 0, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    expect(homeListKey("explore", 1, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    // Both lists take their key from it, with the session's account as the reader.
    const home = block(read("app", "index.tsx"), "Home");
    expect(home).toContain('const viewer = state.status === "signed-in" ? state.me.user.id : null;');
    expect(home.match(/key=\{homeListKey\(current, version, viewer\)\}/g)).toHaveLength(2);
  });

  test("a tab is chosen through the address, every link to a tab names one Home has, and Following's empty text points to Latest and Explore", () => {
    const home = read("app", "index.tsx");
    expect(home).toContain("useLocalSearchParams<{ tab?: string }>()");
    expect(home).toContain("const select = (tab: Tab) => router.setParams({ tab });");
    expect(home).toContain('"Nothing here yet. Follow someone, or switch to Latest or Explore."');
    const links = sourceFiles().flatMap((file) => [...file.text.matchAll(/"\/\?tab=([a-z]+)"/g)].map((match) => ({ file: file.name, tab: match[1] ?? "" })));
    // Popular now and How Explore works lead back to the Explore tab.
    expect(links.map((link) => link.file).sort()).toEqual(["app/explore/about.tsx", "components/PopularNow.tsx"]);
    for (const link of links) expect(homeTab(link.tab, false), link.file).toBe(link.tab);
  });
});

describe("the Explore list", () => {
  test("its header says how long ago the ranking was computed, or since when it had not been when read, offers Refresh once a newer one is due, and links to How Explore works", () => {
    /** A ranking of the given age, read just now: the answer's Date header and the device's clock agree. */
    const readNow = (age: number): RankingRead => {
      const now = Date.now();
      return { computedAt: new Date(now - age).toISOString(), date: new Date(now).toUTCString(), receivedAt: now };
    };
    // Five seconds past the minute: the Date header counts whole seconds.
    const fresh = html(<ExploreHeader ranking={readNow(3 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(fresh).toContain("Updated 3 minutes ago");
    expect(buttonTag(fresh, "Refresh")).toBe("");
    expect(linkTexts(fresh, "/explore/about")).toEqual(["How Explore works"]);
    const due = html(<ExploreHeader ranking={readNow(6 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(due).toContain("Updated 6 minutes ago");
    expect(buttonTag(due, "Refresh")).not.toBe("");
    const stale = html(<ExploreHeader ranking={readNow(20 * 60_000)} onRefresh={() => undefined} />);
    expect(stale).toContain("Explore has not been updated since ");
    expect(stale).not.toContain("Updated ");
    expect(buttonTag(stale, "Refresh")).not.toBe("");
    // Before the first round there is no ranking, no time to show and nothing to read again.
    const none = html(<ExploreHeader ranking={null} onRefresh={() => undefined} />);
    expect(none).not.toMatch(/Updated|updated since|Refresh/);
    expect(linkTexts(none, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("the ranking's age is its age when read, by the answer's Date header, plus the time on screen; only its age when read makes it stale", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    /** The ranking in an answer the server sent `served` ms after computing it, which arrived at the device's `receivedAt`. */
    const ranking = (served: number, receivedAt: number): RankingRead => ({ computedAt, date: new Date(t0 + served).toUTCString(), receivedAt });
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
    // A device clock that agrees with the server's.
    const right = t0 + 190_000;
    expect(rankingAge(ranking(30_000, t0 + 30_000), t0 + 30_000)).toMatchObject({ stale: false, text: "Updated just now" });
    expect(rankingAge(ranking(60_000, t0 + 60_000), t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge(ranking(190_000, right), right)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A device clock 20 minutes fast, then one 20 minutes slow: the age at the read is the server's and the time on screen
    // the device's alone, so neither error counts, and neither warns nor calls the ranking new.
    const fast = right + 20 * 60_000;
    expect(rankingAge(ranking(190_000, fast), fast)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    expect(rankingAge(ranking(190_000, fast), fast + 60_000)).toMatchObject({ stale: false, text: "Updated 4 minutes ago" });
    const slow = right - 20 * 60_000;
    expect(rankingAge(ranking(190_000, slow), slow)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A page left open counts on, and never turns into the warning: the job has written newer rankings meanwhile.
    expect(rankingAge(ranking(190_000, right), right + 20 * 60_000)).toMatchObject({ stale: false, text: "Updated 23 minutes ago" });
    // Over 15 minutes old when the server answered: by then several rounds have failed or been skipped.
    expect(rankingAge(ranking(15 * 60_000, right), right)).toMatchObject({ stale: false, text: "Updated 15 minutes ago" });
    const stale = rankingAge(ranking(15 * 60_000 + 1000, fast), fast);
    expect(stale.stale).toBe(true);
    expect(stale.text).toMatch(/^Explore has not been updated since .+\.$/);
    expect(stale.text).toContain(new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    // Without a Date header the device's clock is all there is.
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 60_000 }, t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 20 * 60_000 }, t0 + 20 * 60_000)).toMatchObject({ stale: true });
    // The header counts whole seconds, so a ranking of the same second is not in the future; and a minute clock that last
    // ticked before the answer arrived adds no time on screen.
    expect(rankingAge({ computedAt: "2026-09-28T12:00:00.800Z", date: new Date(t0).toUTCString(), receivedAt: right }, right - 30_000)).toMatchObject({
      stale: false,
      text: "Updated just now",
    });
    // Days later the date is named too, so the time cannot be read as today's.
    const old = new Date(t0 - 3 * 24 * 3600_000);
    const days = rankingAge({ computedAt: old.toISOString(), date: new Date(t0).toUTCString(), receivedAt: t0 }, t0);
    expect(days.stale).toBe(true);
    expect(days.text).toContain(old.toLocaleDateString());
  });

  test("Refresh is offered once the ranking on screen is as old as EXPLORE_V2's refresh interval, when a newer one should exist", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    // Read a minute after it was computed, then left on screen.
    const read: RankingRead = { computedAt, date: new Date(t0 + 60_000).toUTCString(), receivedAt: t0 + 60_000 };
    expect(EXPLORE_V2.refreshMinutes).toBe(5);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000 - 1000).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000).offerRefresh).toBe(true);
    // A ranking that was stale when read is offered at once.
    expect(rankingAge({ ...read, date: new Date(t0 + 16 * 60_000).toUTCString() }, read.receivedAt)).toMatchObject({ stale: true, offerRefresh: true });
    // The interval is the formula's.
    const slower: ExploreFormula = { ...EXPLORE_V2, refreshMinutes: 10 };
    expect(rankingAge(read, read.receivedAt + 9 * 60_000 - 1000, slower).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 9 * 60_000, slower).offerRefresh).toBe(true);
  });

  test("a page adds only the posts not on screen; another page is read only while one adds nothing and more follow", () => {
    const shown = new Set([id(1), id(2), id(3)]);
    const some = appendUnseen(shown, explorePage([2, 4, 1, 5], "c1"));
    expect(ids(some.added)).toEqual([id(4), id(5)]);
    expect(some).toMatchObject({ nextCursor: "c1", fetchNext: false });
    expect(appendUnseen(shown, explorePage([3, 1], "c2"))).toEqual({ added: [], nextCursor: "c2", fetchNext: true });
    // The ranking ends.
    expect(appendUnseen(shown, explorePage([2], null))).toEqual({ added: [], nextCursor: null, fetchNext: false });
    // A page whose posts the reader's blocks and mutes all took out is not the end while a cursor follows it.
    expect(appendUnseen(shown, explorePage([], "c3"))).toEqual({ added: [], nextCursor: "c3", fetchNext: true });
    // A post is added once, and the set on screen is left as it was.
    expect(ids(appendUnseen(shown, explorePage([6, 6], null)).added)).toEqual([id(6)]);
    expect([...shown]).toEqual([id(1), id(2), id(3)]);
  });

  /** A fake Explore: each cursor (the first page's is "first") answers a page or an error, and every request is recorded. */
  function fakeExplore(answers: Record<string, ExplorePage | Error>) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExplorePage> => {
      calls.push(cursor);
      const answer = answers[cursor ?? "first"];
      if (!answer) throw new Error(`no page for ${cursor ?? "first"}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { fetchPage, calls };
  }
  const refreshed = () => new ApiError(409, "explore_refreshed", "Explore was refreshed.");

  test("Load more reads the next page of the ranking being paged", async () => {
    const fake = fakeExplore({ c1: explorePage([3, 4], "c2") });
    const result = await readPages(fake.fetchPage, "c1", new Set([id(1), id(2)]));
    expect(fake.calls).toEqual(["c1"]);
    expect(ids(result.added)).toEqual([id(3), id(4)]);
    expect(result).toMatchObject({ nextCursor: "c2", refreshed: false });
  });

  test("when the ranking being paged is gone, the new one is read from its first page, keeping only unseen posts, until a page adds some", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([1, 5, 2, 6], "n2") });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(ids(result.added)).toEqual([id(5), id(6)]);
    expect(result).toMatchObject({ nextCursor: "n2", refreshed: true });
    expect(result.last?.computedAt).toBe(AT);
  });

  test("... or until the new ranking ends", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([3], null) });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(result).toMatchObject({ added: [], nextCursor: null, refreshed: true });
  });

  test("any other failure is the list's to show, a first page is never a refresh, and one read is bounded", async () => {
    const failing = fakeExplore({ c1: new ApiError(500, "internal", "Something went wrong on our side. Try again.") });
    await expect(readPages(failing.fetchPage, "c1", new Set())).rejects.toMatchObject({ code: "internal" });
    // Only a cursor names a ranking: the first page is always the current one.
    const first = fakeExplore({ first: refreshed() });
    await expect(readPages(first.fetchPage, undefined, new Set())).rejects.toMatchObject({ code: "explore_refreshed" });
    expect(first.calls).toEqual([undefined]);
    const empty = fakeExplore({ first: explorePage([], "x"), x: explorePage([], "x") });
    const result = await readPages(empty.fetchPage, undefined, new Set(), 3);
    expect(empty.calls).toHaveLength(3);
    expect(result).toMatchObject({ added: [], nextCursor: "x" });
  });

  test("the footer: a polite status line always in the tree, Load more while the ranking has more, and signed out the sign-in link when more exist", () => {
    expect(EXPLORE_REFRESHED_NOTICE).toBe("Explore was refreshed; the posts below come from the new ranking.");
    const quiet = html(<ExploreFooter cursor={null} signInForMore={false} notice={null} error={null} onLoadMore={() => undefined} />);
    const status = /<div[^>]*role="status"[^>]*>/.exec(quiet)?.[0] ?? "";
    expect(status).toContain('aria-live="polite"');
    // It can take the focus when Load more, which had it, leaves the tree.
    expect(status).toContain('tabindex="-1"');
    expect(quiet).not.toContain("Load more");
    expect(linkTexts(quiet, "/signin")).toEqual([]);
    const after = html(<ExploreFooter cursor="n2" signInForMore={false} notice={EXPLORE_REFRESHED_NOTICE} error={null} onLoadMore={() => undefined} />);
    expect(after).toMatch(/role="status"[^>]*><div[^>]*>Explore was refreshed; the posts below come from the new ranking\.<\/div>/);
    expect(buttonTag(after, "Load more")).not.toBe("");
    const signedOut = html(<ExploreFooter cursor={null} signInForMore notice={null} error={null} onLoadMore={() => undefined} />);
    expect(linkTexts(signedOut, "/signin")).toEqual(["Sign in to see more of Explore"]);
  });

  /** A fake Explore answering its requests in order from `script`, each a page or a failure, and recording each cursor. */
  function scripted(script: (ExploreAnswer | Error)[]) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExploreAnswer> => {
      calls.push(cursor);
      const next = script.shift();
      if (!next) throw new Error(`no answer left for ${cursor ?? "first"}`);
      if (next instanceof Error) throw next;
      return next;
    };
    return { fetchPage, calls };
  }

  test("the list's reader lets one read run at a time: a load meanwhile fetches nothing and answers null, and each read answers what the list shows", async () => {
    const calls: (string | undefined)[] = [];
    const held: ((page: ExploreAnswer) => void)[] = [];
    const reader = exploreReader((cursor) => {
      calls.push(cursor);
      return new Promise<ExploreAnswer>((resolve) => held.push(resolve));
    });
    const first = reader.load();
    // Pull to refresh, Refresh or Load more while the first read runs: nothing is fetched and nothing changes on screen.
    expect(await reader.load()).toBeNull();
    expect(await reader.load("c0")).toBeNull();
    expect(calls).toEqual([undefined]);
    held[0]!(answer([1, 2], "c1"));
    const shown = await first;
    expect(ids(shown!.items)).toEqual([id(1), id(2)]);
    expect(shown).toMatchObject({ cursor: "c1", signInForMore: false, refreshed: false });
    // The ranking's time with the Date header and the arrival of the answer that carried it, which the header ages it by.
    expect(shown!.ranking).toEqual({ computedAt: AT, date: DATE, receivedAt: RECEIVED });
    // Once it has answered the next read runs, and a double press of Load more appends its page once.
    const more = reader.load("c1");
    expect(await reader.load("c1")).toBeNull();
    expect(calls).toEqual([undefined, "c1"]);
    held[1]!(answer([3], null));
    expect(await more).toMatchObject({ cursor: null, refreshed: false });
    expect(ids((await more)!.items)).toEqual([id(1), id(2), id(3)]);
  });

  test("after explore_refreshed the reader appends from the current ranking only the posts not already on screen, and goes on from there", async () => {
    const fake = scripted([answer([1, 2], "c1"), refreshed(), answer([2, 1, 5], "n1"), answer([5, 6], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    const after = await reader.load("c1");
    expect(fake.calls).toEqual([undefined, "c1", undefined]);
    // The posts read stay where they are, once each; the new ranking adds what was not on screen, and the list says so.
    expect(ids(after!.items)).toEqual([id(1), id(2), id(5)]);
    expect(after).toMatchObject({ cursor: "n1", refreshed: true });
    // What it added is on screen now as well: a page holding it again adds only the rest.
    const next = await reader.load("n1");
    expect(ids(next!.items)).toEqual([id(1), id(2), id(5), id(6)]);
    expect(next).toMatchObject({ cursor: null, refreshed: false });
  });

  test("a failed read throws, leaves what the list shows as it was and lets the next load run", async () => {
    const offline = () => new ApiError(0, "network", "Cannot reach korbat. Check your connection.");
    const fake = scripted([offline(), answer([1, 2], "c1"), offline(), answer([3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await expect(reader.load()).rejects.toMatchObject({ code: "network" });
    expect(ids((await reader.load())!.items)).toEqual([id(1), id(2)]);
    await expect(reader.load("c1")).rejects.toMatchObject({ code: "network" });
    // Load more again: its page comes below the posts that stayed.
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3)]);
    expect(fake.calls).toEqual([undefined, undefined, "c1", "c1"]);
  });

  test("a load without a cursor starts over: the first page in place of everything on screen, from which Load more goes on", async () => {
    const later = "2026-09-28T12:10:00.000Z";
    const fake = scripted([answer([1, 2], "c1"), answer([3, 4], "c2"), answer([5, 1], "d1", { computedAt: later }), answer([2, 3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3), id(4)]);
    const again = await reader.load();
    expect(ids(again!.items)).toEqual([id(5), id(1)]);
    expect(again).toMatchObject({ cursor: "d1", refreshed: false });
    expect(again!.ranking?.computedAt).toBe(later);
    // The posts shown before it are no longer on screen, so a page holding them adds them like any other.
    expect(ids((await reader.load("d1"))!.items)).toEqual([id(5), id(1), id(2), id(3)]);
  });

  test("a post deleted from the list leaves the reader's list too, even while a read is in flight", async () => {
    let release: ((page: ExploreAnswer) => void) | undefined;
    const reader = exploreReader((cursor) => (cursor === undefined ? Promise.resolve(answer([1, 2], "c1")) : new Promise<ExploreAnswer>((resolve) => (release = resolve))));
    await reader.load();
    const more = reader.load("c1");
    expect(ids(reader.remove(id(2)).items)).toEqual([id(1)]);
    release!(answer([3], null));
    expect(ids((await more)!.items)).toEqual([id(1), id(3)]);
  });

  test("the sign-in flag comes from the last page read, and before the first round there is no ranking to age", async () => {
    const fake = scripted([answer([], null, { computedAt: null }), answer([1], null, { signInForMore: true })]);
    const reader = exploreReader(fake.fetchPage);
    expect(await reader.load()).toMatchObject({ items: [], cursor: null, ranking: null, signInForMore: false });
    expect(await reader.load()).toMatchObject({ cursor: null, ranking: { computedAt: AT }, signInForMore: true });
  });

  test("the list shows what one reader of its own answers, reads the first page again from pull to refresh and Refresh, announces a refresh and keeps the focus", () => {
    const list = block(read("components", "social", "ExploreList.tsx"), "ExploreList");
    const at = (code: string): number => {
      const index = list.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    // Made once with the list, so its state lives and ends with it.
    expect(list).toContain("const [reader] = useState(() => exploreReader(social.explore));");
    // An answer is what the list shows; null, while another read runs, changes nothing.
    expect(at("const answer = await reader.load(after);")).toBeLessThan(at("if (!answer) return;"));
    expect(at("if (!answer) return;")).toBeLessThan(at("setShown(answer);"));
    expect(at("setShown(answer);")).toBeLessThan(at("if (answer.refreshed) {"));
    expect(at("if (answer.refreshed) {")).toBeLessThan(at("setNotice(EXPLORE_REFRESHED_NOTICE);"));
    expect(list).toContain("const remove = (id: string) => setShown(reader.remove(id));");
    // Its posts, Load more's cursor, the ranking's time and the sign-in link all come from the answer.
    for (const wire of [
      "data={shown.items}",
      "<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />",
      "onRefresh={() => refresh(false)}",
      "cursor={shown.cursor}",
      "signInForMore={shown.signInForMore}",
      "if (shown.cursor) void load(shown.cursor);",
      "statusRef={footer}",
      // The empty state is an element, with its own links, not a line of text.
      "<ExploreEmpty onShowLatest={onShowLatest} />",
    ]) {
      expect(list, wire).toContain(wire);
    }
    // After a refresh the focus stays at the footer; after the header's Refresh it goes to the line saying how old the
    // ranking now is, since the button leaves the tree once the ranking is fresh.
    expect(list).toContain("if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();");
    expect(list).toContain("if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();");
  });

  test("the empty state is worded from EXPLORE_V2, links to How Explore works and offers Show Latest", () => {
    expect(exploreEmptyText()).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 3 other accounts, each at least 2 days old, like or repost it in its first 48 hours. Explore is refreshed every 5 minutes.",
    );
    // Every number comes from the formula: another formula words another sentence.
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, windowHours: 24, refreshMinutes: 10 };
    expect(exploreEmptyText(other)).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 5 other accounts, each at least 3 days old, like or repost it in its first 24 hours. Explore is refreshed every 10 minutes.",
    );
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 36 })).toContain("each at least 36 hours old");
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 24 })).toContain("each at least 1 day old");
    const out = html(<ExploreEmpty onShowLatest={() => undefined} />);
    expect(out).toContain(exploreEmptyText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    expect(buttonTag(out, "Show Latest")).not.toBe("");
    expect(textOf(html(<ExploreEmpty onShowLatest={() => undefined} formula={other} />))).toContain("at least 5 other accounts");
  });
});

describe("How Explore works", () => {
  test("states every number of the formula from EXPLORE_V2, with the version and the change log", () => {
    const out = textOf(html(<ExploreRules />));
    for (const phrase of [
      "Original posts from the last 48 hours",
      "was at least 2 days old when it liked or reposted",
      "has stood for at least 10 minutes",
      "A post needs at least 3 approving accounts.",
      "divided by (the hours it has been shown since it was posted + 2) to the power 1.8",
      "Explore holds the 300 posts with the highest scores, with at most 2 posts of one account",
      "A new ranking is computed every 5 minutes, never sooner than 4.5 minutes after the last one.",
      "The newest 2 rankings are kept",
      "Signed out, you see the first 20 posts.",
      "Explore stays empty for about 2 days after it opens",
      "This is version 2 of the formula.",
      "Version 1, 2026-09-28: First version.",
      // The second entry of the change log, word for word (3e design, section 9.7).
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
  });

  test("version 2's rules in the design's words: what is ranked, what counts and the score name suspension and the time given back (3e)", () => {
    const body = (title: string) => exploreRules().find((section) => section.title === title)?.body;
    expect(body("What is ranked")).toBe(
      "Original posts from the last 48 hours: posts that are not replies or quotes, by accounts that have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    );
    expect(body("What counts")).toBe(
      "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An account that both liked and reposted a post counts once. A like or repost counts when its account still exists, is not suspended when the ranking is computed, was at least 2 days old when it liked or reposted, and the like or repost has stood for at least 10 minutes. Replies and quotes do not count, so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    );
    expect(body("The score")).toBe(
      "A post needs at least 3 approving accounts. Its score is the number of approving accounts divided by (the hours it has been shown since it was posted + 2) to the power 1.8, so a newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and then restored gets that time back: its window and its age stand still while it is not shown.",
    );
    // Server-rendered on How Explore works, each whole.
    const out = textOf(html(<ExploreRules />));
    for (const title of ["What is ranked", "What counts", "The score"]) expect(out, title).toContain(body(title)!);
  });

  test("follows the formula it is given: another formula's numbers, version and change log", () => {
    const other: ExploreFormula = {
      ...EXPLORE_V2,
      version: 3,
      windowHours: 72,
      engagerMinAgeHours: 96,
      standingMinutes: 15,
      threshold: 7,
      gravity: 1.5,
      offsetHours: 3,
      perAuthor: 4,
      listLength: 100,
      refreshMinutes: 10,
      minGapMinutes: 9,
      kept: 3,
      signedOutPage: 10,
      changes: [...EXPLORE_V2.changes, { version: 3, date: "2026-12-01", summary: "A later version." }],
    };
    const out = textOf(html(<ExploreRules formula={other} />));
    for (const phrase of [
      "Original posts from the last 72 hours",
      "was at least 4 days old when it liked or reposted",
      "has stood for at least 15 minutes",
      "A post needs at least 7 approving accounts.",
      "(the hours it has been shown since it was posted + 3) to the power 1.5",
      "Explore holds the 100 posts with the highest scores, with at most 4 posts of one account",
      "every 10 minutes, never sooner than 9 minutes after the last one",
      "The newest 3 rankings are kept",
      "Signed out, you see the first 10 posts.",
      "Explore stays empty for about 4 days after it opens",
      "This is version 3 of the formula.",
      "Version 1, 2026-09-28: First version.",
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked",
      "Version 3, 2026-12-01: A later version.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
    for (const phrase of ["48 hours", "2 days", "at least 3 approving", "300 posts", "power 1.8", "version 2 of"]) expect(out, phrase).not.toContain(phrase);
  });

  test("says what takes a post out besides the formula, in the design's words: a suspension, never Explore alone, and no longer the automatic checks", () => {
    const rule = exploreRules().find((section) => section.title === "What else takes a post out");
    expect(rule?.body).toBe(
      "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    );
    // Rulebook version 2 has no automatic R1 and R2 checks, so the page names none.
    expect(rule?.body).not.toContain("automatic R1 and R2 checks");
    expect(textOf(html(<ExploreRules />))).toContain(rule!.body);
  });

  test("is a public page with the rules under its title", () => {
    session.state = { status: "signed-out" };
    const out = html(<ExploreAbout />);
    expect(out).toMatch(/<h1[^>]*>How Explore works<\/h1>/);
    expect(textOf(out)).toContain("A post needs at least 3 approving accounts.");
    // Nothing on the page asks who is reading: the rules are the same for everyone, signed in or not.
    expect(read("app", "explore", "about.tsx")).not.toMatch(/Redirect|useSession/);
  });
});

describe("Settings > Privacy: Show my posts in Explore", () => {
  const switchTag = (markup: string): string => /<input[^>]*role="switch"[^>]*>/.exec(markup)?.[0] ?? "";
  /** The switch as Privacy shows it: its state from the hook, which reads the session. */
  function SessionSwitch() {
    return <ExploreSwitch {...useExploreSwitch()} />;
  }

  test("is a switch named Show my posts in Explore, whose state is /api/me's", () => {
    session.state = signedIn(true);
    const on = switchTag(html(<SessionSwitch />));
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('aria-label="Show my posts in Explore"');
    expect(on).toContain('checked=""');
    expect(on).not.toContain("disabled");
    session.state = signedIn(false);
    const off = switchTag(html(<SessionSwitch />));
    expect(off).toContain('aria-label="Show my posts in Explore"');
    expect(off).not.toContain("checked");
  });

  test("shows what it is given: the value being saved, disabled while the save runs, and a failed save's error", () => {
    const saving = switchTag(html(<ExploreSwitch on={false} busy error={null} change={async () => undefined} />));
    expect(saving).not.toContain("checked");
    expect(saving).toContain('disabled=""');
    const failed = html(<ExploreSwitch on busy={false} error="Cannot reach korbat. Check your connection." change={async () => undefined} />);
    expect(switchTag(failed)).toContain('checked=""');
    expect(switchTag(failed)).not.toContain("disabled");
    expect(textOf(failed)).toContain("Cannot reach korbat. Check your connection.");
  });

  test("its one sentence says turning it off takes effect at once and turning it back on at the next refresh", () => {
    expect(exploreSwitchText()).toBe(
      "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at once, and turning it back on takes effect at the next refresh, which comes every 5 minutes.",
    );
    expect(exploreSwitchText({ ...EXPLORE_V2, refreshMinutes: 10 })).toContain("at the next refresh, which comes every 10 minutes.");
    session.state = signedIn(true);
    const out = html(<SessionSwitch />);
    expect(out).toContain(exploreSwitchText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("its state and its save live in Privacy, above the list that the Blocked and Muted tabs remount, so a tab change during a save loses neither", () => {
    const privacy = read("app", "settings", "privacy.tsx");
    const screen = block(privacy, "Privacy");
    expect(screen).toContain("const explore = useExploreSwitch();");
    expect(screen).toContain("<ExploreSwitch {...explore} />");
    // The list stays keyed by the tab, so the old tab's rows never show with the new tab's Unblock or Unmute.
    expect(screen).toContain("key={tab}");
    // The switch in the list's header only shows what it is given: it has no state a remount could reset.
    expect(block(privacy, "ExploreSwitch")).not.toMatch(/useState|useEffect|useSession/);
  });

  test("saves with POST or DELETE /api/me/explore while disabled, puts the switch back with the error on failure, and then refreshes the session", () => {
    expect(read("lib", "social.ts")).toContain('setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),');
    const privacy = read("app", "settings", "privacy.tsx");
    expect(privacy).toContain('<Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)}');
    const change = block(privacy, "useExploreSwitch");
    const at = (code: string): number => {
      const index = change.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (busy) return;")).toBeLessThan(at("setBusy(true);"));
    expect(at("setOn(next);")).toBeLessThan(at("await social.setShowInExplore(next);"));
    expect(at("await social.setShowInExplore(next);")).toBeLessThan(at("await refresh();"));
    expect(at("} catch (err) {")).toBeLessThan(at("setOn(before);"));
    expect(at("setOn(before);")).toBeLessThan(at("setError(errorMessage(err));"));
    expect(at("} finally {")).toBeLessThan(at("setBusy(false);"));
  });
});

describe("the author's status line", () => {
  test("words every status in the formula's words, with EXPLORE_V2's numbers, and nothing for a reply or a quote", () => {
    const expected: Record<ExploreStatusKind, string | null> = {
      reply: null,
      quote: null,
      not_visible: "Not in Explore: posts under review or removed never appear there.",
      // 3e design, section 9.7, word for word.
      suspended:
        "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.",
      hidden_by_author: "Not in Explore: you turned off Show my posts in Explore.",
      listed: "In Explore",
      outside_window: "Not in Explore: posts can appear only in their first 48 hours, not counting time in which korbat's moderation kept them from being shown.",
      no_ranking: "Not in Explore yet: the first ranking has not been computed.",
      new_since_ranking: "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.",
      below_threshold:
        "Not in Explore: fewer than 3 approving accounts. Your own likes, accounts under 2 days old and likes from the last 10 minutes do not count.",
      pending: "Not in Explore yet: the next refresh will consider it.",
      author_cap: "Not in Explore: two of your posts rank above it.",
      below_cutoff: "Not in Explore: it ranks below the 300 posts Explore holds.",
    };
    for (const status of ExploreStatusKind.options) expect(exploreStatusText(status), status).toBe(expected[status]);
  });

  test("takes its numbers from the formula", () => {
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, standingMinutes: 15, windowHours: 24, perAuthor: 3, listLength: 100 };
    expect(exploreStatusText("below_threshold", other)).toBe(
      "Not in Explore: fewer than 5 approving accounts. Your own likes, accounts under 3 days old and likes from the last 15 minutes do not count.",
    );
    expect(exploreStatusText("author_cap", other)).toBe("Not in Explore: three of your posts rank above it.");
    expect(exploreStatusText("author_cap", { ...EXPLORE_V2, perAuthor: 1 })).toBe("Not in Explore: one of your posts ranks above it.");
    expect(exploreStatusText("below_cutoff", other)).toBe("Not in Explore: it ranks below the 100 posts Explore holds.");
    expect(exploreStatusText("outside_window", other)).toBe(
      "Not in Explore: posts can appear only in their first 24 hours, not counting time in which korbat's moderation kept them from being shown.",
    );
  });

  test("shows under the author's own top-level post only, never a reply's or a quote's, with links to How Explore works and to the switch", () => {
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain("{mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}");
    expect(thread).toContain(".exploreStatus(id)");
    expect(thread).toContain("exploreStatusText(answer.status)");
    const line = block(thread, "ExploreStatusLine");
    expect(line).toContain('<Link href="/explore/about" asChild>');
    expect(line).toContain('<Link href="/settings/privacy" asChild>');
    expect(read("lib", "social.ts")).toContain("exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),");
  });

  test("the line and the post are read again whenever the screen gains focus, so both follow a change of the switch made through the line's own link", () => {
    // The web keeps the post's screen mounted under Settings > Privacy, and Back shows that same screen again.
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain('import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";');
    // The line asks on every focus, as the sign-in screen's autofill starts on every focus, not once per post.
    const line = block(thread, "ExploreStatusLine");
    expect(line).toMatch(/useFocusEffect\(\s+useCallback\(\(\) => \{[\s\S]*?\.exploreStatus\(id\)[\s\S]*?\}, \[id\]\),\s+\);/);
    expect(line).not.toContain("useEffect(");
    // Another post's line never shows under this one while this one's is read.
    expect(line).toContain("const text = line?.id === id ? line.text : null;");
    // The screen reads its post again on every focus after the first, into the thread on screen and without clearing it,
    // so the card's In Explore chip follows; the first focus is the mount, whose read is the thread's own.
    const screen = block(thread, "Thread");
    const focus = screen.slice(screen.indexOf("useFocusEffect("), screen.indexOf("}, [id]),", screen.indexOf("useFocusEffect(")));
    const at = (code: string): number => {
      const index = focus.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (focusedFor.current !== id) {")).toBeLessThan(at("focusedFor.current = id;"));
    expect(at("focusedFor.current = id;")).toBeLessThan(at(".getPost(id)"));
    expect(at(".getPost(id)")).toBeLessThan(at("setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));"));
    expect(focus).not.toContain("setThread(null)");
    expect(focus).not.toContain("setError(");
  });
});

describe("the In Explore chip", () => {
  test("shows on the author's own card while the post is in Explore, as a link to the post", () => {
    session.state = signedIn();
    const listed = html(<PostCard post={post(7, { inExplore: true })} />);
    expect(linkTexts(listed, `/post/${id(7)}`)).toContain("In Explore");
    expect(html(<PostCard post={post(7)} />)).not.toContain("In Explore");
    // Nobody else's view carries the flag, and a card never shows it on someone else's post.
    const bob = { id: OTHER, handle: "bob", displayName: "Bob", verified: false };
    expect(html(<PostCard post={post(8, { author: bob, inExplore: true })} />)).not.toContain("In Explore");
    session.state = { status: "signed-out" };
    expect(html(<PostCard post={post(7, { inExplore: true })} />)).not.toContain("In Explore");
  });
});

describe("the context column", () => {
  test("Popular now lists posts as links to their threads, an image-only post by its image's description, then a link to Explore", () => {
    const image = { id: id(90), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    const out = html(<PopularPosts posts={[post(1), post(2, { body: "", media: [image] }), post(3)]} />);
    expect(out).toMatch(/<h2[^>]*>Popular now<\/h2>/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual([`/post/${id(1)}`, `/post/${id(2)}`, `/post/${id(3)}`, "/?tab=explore"]);
    expect(linkTexts(out, `/post/${id(1)}`)[0]).toContain("post number 1");
    expect(linkTexts(out, `/post/${id(2)}`)[0]).toContain("Image: A green square");
    expect(linkTexts(out, "/?tab=explore")).toEqual(["More in Explore"]);
  });

  test("sits above the handle box on wide screens and asks Explore for its first three posts", () => {
    expect(read("components", "AppShell.tsx")).toMatch(/<PopularNow \/>\s*<HandleBox \/>/);
    expect(read("lib", "social.ts")).toContain('popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),');
    expect(read("components", "PopularNow.tsx")).toContain(".popular()");
    // The handle box is no longer the only way to find anyone.
    expect(read("components", "HandleBox.tsx")).not.toContain("only discovery tool");
  });
});

describe("the terms", () => {
  test("say that public posts can appear in Explore, where its rules are and how to keep one's posts out, without a new version", () => {
    const sentence =
      "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.";
    expect(TERMS_SECTIONS.filter((section) => section.body.includes(sentence))).toHaveLength(1);
    expect(TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("no screen caches or stores Explore's answers", () => {
  test("the files that ask for Explore keep its answers in component state only: no browser storage, no cache, no module-level variable", () => {
    const callers = sourceFiles().filter((file) => /social\s*\.(explore|popular|exploreStatus)\b/.test(file.text));
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/PopularNow.tsx", "components/social/ExploreList.tsx"]);
    const explore = sourceFiles().filter((file) => [...callers.map((caller) => caller.name), "lib/explore.ts", "app/explore/about.tsx"].includes(file.name));
    expect(explore).toHaveLength(5);
    for (const file of explore) {
      expect(file.text, file.name).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage|caches\./);
      expect(file.text, file.name).not.toMatch(/^(export )?(let|var) /m);
      expect(file.text, file.name).not.toMatch(/^(export )?const \w+ = new (Map|Set|WeakMap)\b/m);
    }
    // What the app keeps in the browser is the device id and the passkey card's Not now, nothing else.
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/passkeys.ts"]);
    // Explore's requests are the client's plain calls, which the API answers no-store.
    const social = read("lib", "social.ts");
    for (const line of social.split("\n").filter((text) => text.includes("/api/timeline/explore") || text.includes("/explore`"))) expect(line).not.toMatch(/cache/i);
  });
});
```

### Replace `packages/contracts/test/explore.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import * as contracts from "../src/index";
import { EXPLORE_V2, ExplorePage, ExploreSettingResponse, ExploreStatus, ExploreStatusKind, TimelineItem, type ExploreFormula } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  author,
  body: "hello",
  createdAt: "2026-09-28T10:00:00.000Z",
  state: "visible",
  replyTo: null,
  counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
  media: [],
  quoteOf: null,
  ...extra,
});
const at = "2026-09-28T12:05:00.000Z";
const repost = { kind: "repost", post: post(2), repostedBy: author, repostedAt: at };

describe("the Explore formula", () => {
  /** The day formula version 2 reached the repository (3e design, sections 9.7 and 10.1). */
  const V2_DATE = "2026-10-12";

  test("EXPLORE_V2 holds the numbers of the 2c design, section 5, unchanged, version 2 and both entries of the change log", () => {
    expect(EXPLORE_V2).toStrictEqual({
      version: 2,
      windowHours: 48,
      engagerMinAgeHours: 48,
      standingMinutes: 10,
      threshold: 3,
      gravity: 1.8,
      offsetHours: 2,
      perAuthor: 2,
      listLength: 300,
      refreshMinutes: 5,
      minGapMinutes: 4.5,
      kept: 2,
      signedOutPage: 20,
      changes: [
        { version: 1, date: "2026-09-28", summary: "First version." },
        {
          version: 2,
          date: V2_DATE,
          summary:
            "Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
        },
      ],
    });
  });

  test("EXPLORE_V1 is no longer exported: version 2 is the one formula the code ranks and words with", () => {
    expect(Object.keys(contracts)).toContain("EXPLORE_V2");
    expect(Object.keys(contracts)).not.toContain("EXPLORE_V1");
  });

  test("EXPLORE_V2 is frozen all the way down, so nothing at run time can change the published numbers", () => {
    expect(Object.isFrozen(EXPLORE_V2)).toBe(true);
    expect(Object.isFrozen(EXPLORE_V2.changes)).toBe(true);
    for (const change of EXPLORE_V2.changes) expect(Object.isFrozen(change)).toBe(true);
    // Modules run in strict mode, where writing to a frozen object throws instead of failing silently.
    expect(() => {
      (EXPLORE_V2 as { threshold: number }).threshold = 1;
    }).toThrow(TypeError);
    expect(() => {
      (EXPLORE_V2.changes as unknown as unknown[]).push({ version: 3, date: "2026-12-01", summary: "Changed." });
    }).toThrow(TypeError);
    expect(() => {
      (EXPLORE_V2.changes[1] as { summary: string }).summary = "Changed.";
    }).toThrow(TypeError);
    expect(EXPLORE_V2.threshold).toBe(3);
    expect(EXPLORE_V2.changes).toHaveLength(2);
  });

  test("the change log runs oldest first and ends with the formula's own version", () => {
    expect(EXPLORE_V2.changes.map((change) => change.version)).toEqual([1, 2]);
    expect(EXPLORE_V2.changes.at(-1)?.version).toBe(EXPLORE_V2.version);
  });

  test("a formula with other numbers has the same type, so the refresh can take one, and EXPLORE_V2 is untouched", () => {
    const changed: ExploreFormula = { ...EXPLORE_V2, threshold: 5, perAuthor: 1, listLength: 10, minGapMinutes: 0 };
    expect(changed).toMatchObject({ version: 2, threshold: 5, perAuthor: 1, listLength: 10, minGapMinutes: 0, gravity: 1.8 });
    expect(EXPLORE_V2).toMatchObject({ threshold: 3, perAuthor: 2, listLength: 300, minGapMinutes: 4.5 });
  });
});

describe("the Explore page", () => {
  test("carries post items, the cursor, the time the ranking was computed and the sign-in prompt", () => {
    const page = {
      items: [
        { kind: "post", post: post(1) },
        // A signed-in reader's items carry their own like, repost and bookmark flags, as on every list.
        { kind: "post", post: post(3, { viewer: { liked: true, reposted: false, bookmarked: false } }) },
      ],
      // Opaque to the contract: the API's Explore cursor names a ranking and the last post read.
      nextCursor: "opaque-cursor",
      computedAt: at,
      signInForMore: false,
    };
    expect(ExplorePage.parse(page)).toEqual(page);
  });

  test("before the first round it is empty, with no cursor and no time; a signed-out page may end in the sign-in prompt", () => {
    const empty = { items: [], nextCursor: null, computedAt: null, signInForMore: false };
    expect(ExplorePage.parse(empty)).toEqual(empty);
    const signedOut = { items: [{ kind: "post", post: post(1) }], nextCursor: null, computedAt: at, signInForMore: true };
    expect(ExplorePage.parse(signedOut)).toEqual(signedOut);
  });

  test("refuses a repost item, which is a valid timeline item elsewhere: Explore lists original posts only", () => {
    expect(TimelineItem.safeParse(repost).success).toBe(true);
    const base = { nextCursor: null, computedAt: at, signInForMore: false };
    expect(ExplorePage.safeParse({ ...base, items: [repost] }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...base, items: [{ kind: "post", post: post(1) }, repost] }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...base, items: [{ kind: "post" }] }).success).toBe(false);
  });

  test("needs every field, with its type", () => {
    const page = { items: [], nextCursor: null, computedAt: at, signInForMore: false };
    for (const key of Object.keys(page)) {
      const partial: Record<string, unknown> = { ...page };
      delete partial[key];
      expect(ExplorePage.safeParse(partial).success, key).toBe(false);
    }
    expect(ExplorePage.safeParse({ ...page, computedAt: "five minutes ago" }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, computedAt: "2026-09-28" }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, nextCursor: 2 }).success).toBe(false);
    expect(ExplorePage.safeParse({ ...page, signInForMore: "no" }).success).toBe(false);
  });

  test("shows only the order: no score, rank or count beside the items, the cursor, the time and the prompt", () => {
    expect(Object.keys(ExplorePage.shape).sort()).toEqual(["computedAt", "items", "nextCursor", "signInForMore"]);
  });
});

describe("the author's Explore status", () => {
  test("names one of thirteen reasons, in the order the status route tries them: suspended after not_visible (3e)", () => {
    expect(ExploreStatusKind.options).toEqual([
      "reply",
      "quote",
      "not_visible",
      "suspended",
      "hidden_by_author",
      "listed",
      "outside_window",
      "no_ranking",
      "new_since_ranking",
      "below_threshold",
      "pending",
      "author_cap",
      "below_cutoff",
    ]);
  });

  test("carries the status and the time of the ranking it was judged against, which is null before the first round", () => {
    for (const status of ExploreStatusKind.options) {
      expect(ExploreStatus.parse({ status, computedAt: at }), status).toEqual({ status, computedAt: at });
    }
    expect(ExploreStatus.parse({ status: "no_ranking", computedAt: null })).toEqual({ status: "no_ranking", computedAt: null });
  });

  test("refuses an unknown status, a missing field and a time that is not an ISO datetime", () => {
    // No lever acts on Explore alone: moderation reaches it only through the post's state, which is not_visible.
    expect(ExploreStatus.safeParse({ status: "hidden_by_moderator", computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "Listed", computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "listed" }).success).toBe(false);
    expect(ExploreStatus.safeParse({ computedAt: at }).success).toBe(false);
    expect(ExploreStatus.safeParse({ status: "listed", computedAt: "now" }).success).toBe(false);
  });

  test("carries no count: its fields are exactly the status and the time", () => {
    expect(Object.keys(ExploreStatus.shape).sort()).toEqual(["computedAt", "status"]);
  });
});

describe("the author's Explore switch", () => {
  test("answers with the switch's state, on or off", () => {
    expect(ExploreSettingResponse.parse({ showInExplore: true })).toEqual({ showInExplore: true });
    expect(ExploreSettingResponse.parse({ showInExplore: false })).toEqual({ showInExplore: false });
    expect(ExploreSettingResponse.safeParse({}).success).toBe(false);
    expect(ExploreSettingResponse.safeParse({ showInExplore: "on" }).success).toBe(false);
    expect(ExploreSettingResponse.safeParse({ showInExplore: null }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/contracts test:  ❯ test/explore.test.ts (15 tests | 6 failed) 175ms
packages/db test:       Tests  71 passed (71)
packages/contracts test:  Test Files  1 failed | 15 passed (16)
packages/contracts test:       Tests  6 failed | 321 passed (327)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/account-sanctions-3e/write_blocks.py docs/superpowers/prompts/account-sanctions-3e/06-explore-version-2.md 3
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `packages/db/migrations/0023_explore_resume.sql`

```sql
-- Explore's resume rule (3e design, section 6.4; the design names this migration 0022, one lower, since 3c's review added
-- 0019). Written by hand: this migration changes no table. The three columns of posts it gives a writer (hidden_at,
-- restored_at, explore_from) were added by 3e's schema migration, outside the API role's column grants, and nothing has
-- written them yet. It replaces two functions of migration 0016, each stated whole as built there with the changes below
-- and no other. CREATE OR REPLACE keeps each one's owner (the migrator), its grants (EXECUTE taken from PUBLIC in 0016,
-- given to nobody) and its triggers; the pinned search path is part of the definition and is stated again.
--
-- As in 0016 to 0022: every object is named schema-qualified; a trigger function fires for every role all the same; times
-- the database writes are now(), the transaction's start. No statement here names a value that 3e's schema migration added
-- to action_kind, and no interval is typed (enum-literals.test.ts, standing-grants.test.ts).
--
-- moderation_apply, replaced: it stays the one writer of a post's level and becomes the one writer of the three columns,
-- in the same UPDATE that moves the level, and so only when the level really changes. In that UPDATE every SET expression
-- reads the row as it was before the statement, so hidden_at below is the start of the span that ends:
--   * the level leaves visible: hidden_at is now();
--   * the level returns to visible: restored_at is now(), and explore_from is coalesce(explore_from, created_at) plus the
--     span just ended (now() - hidden_at);
--   * the level moves between withheld and removed: none of the three changes.
-- No function reads the clock for a post. now() here is the deciding transaction's start, which is the decided_at of the
-- decision that moved the level and the created_at of its ledger rows, so explore_from is created_at plus the hidden
-- spans the ledger gives: from a measure's row to its reversal's row, or to the decided_at of the final decision that
-- closed the case of an interim measure. The rule is keyed on the level alone, so a seal (which changes no level) moves
-- nothing, and a later measure that joins the level's derivation needs no change here. A post hidden before this
-- migration has no hidden_at: when it is restored, the sum is null, its explore_from stays null and it keeps its original
-- age. No backfill is written: nothing is public before 3e.
--
-- What the derivation itself does is 0016's, unchanged: the measures in force on every case decide the level and the
-- images' states, the result does not depend on the order in which cases, measures and reversals arrive, and an auditor
-- can recompute it. With `levels` it takes the posts first, in id order, then their image rows in id order; without it
-- only the image rows, which is the form a seal uses. posts.state mirrors the level unless the author deleted the post.
-- Nobody may call it: its owner does, from the triggers of the ledger and from the erasure of a later migration.
CREATE OR REPLACE FUNCTION "public"."moderation_apply"(posts uuid[], levels boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ids uuid[];
  derived public.moderation_level[];
BEGIN
  IF moderation_apply.levels THEN
    PERFORM 1 FROM public.posts p WHERE p.id = ANY(moderation_apply.posts) ORDER BY p.id FOR UPDATE;
    SELECT array_agg(p.id),
           array_agg(CASE
             WHEN p.erased_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'remove') THEN 'removed'
             WHEN EXISTS (SELECT 1 FROM public.measures_in_force m WHERE m.post_id = p.id AND m.kind = 'withhold') THEN 'withheld'
             ELSE 'visible' END::public.moderation_level)
      INTO ids, derived
      FROM public.posts p WHERE p.id = ANY(moderation_apply.posts);
    -- The level and Explore's three columns in one statement; each expression reads the row before it.
    UPDATE public.posts p SET moderation_level = v.level,
           hidden_at = CASE WHEN p.moderation_level = 'visible' THEN now() ELSE p.hidden_at END,
           restored_at = CASE WHEN v.level = 'visible' THEN now() ELSE p.restored_at END,
           explore_from = CASE WHEN v.level = 'visible' THEN coalesce(p.explore_from, p.created_at) + (now() - p.hidden_at) ELSE p.explore_from END
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.moderation_level <> v.level;
    UPDATE public.posts p SET state = v.level::text::public.post_state
      FROM unnest(ids, derived) AS v(id, level)
     WHERE p.id = v.id AND p.state <> 'deleted_by_author' AND p.state <> v.level::text::public.post_state;
  END IF;
  PERFORM 1 FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts) ORDER BY m.id FOR NO KEY UPDATE;
  UPDATE public.post_media i SET moderation_state = v.state
    FROM (SELECT m.id,
                 CASE
                   WHEN EXISTS (SELECT 1 FROM public.seal_posts s JOIN public.measures_in_force f ON f.id = s.action_id WHERE s.post_id = m.post_id) THEN 'sealed'
                   WHEN m.erased_at IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'remove_media' AND f.media_id = m.id) THEN 'removed'
                   WHEN EXISTS (SELECT 1 FROM public.measures_in_force f WHERE f.post_id = m.post_id AND f.kind = 'withhold_media' AND f.media_id = m.id) THEN 'withheld'
                   ELSE 'visible' END::public.media_moderation_state AS state
            FROM public.post_media m WHERE m.post_id = ANY(moderation_apply.posts)) v
   WHERE i.id = v.id AND i.moderation_state <> v.state;
END $$;--> statement-breakpoint
-- posts_guard, replaced: on an INSERT by any role but the migrator it also forces Explore's three columns null, whatever
-- the insert supplied, so a post is born never hidden and the API role cannot choose when a post resumes. The migrator's
-- insert keeps them, as it keeps every column. The API role holds no UPDATE grant on the three (0015's column grants leave
-- them out), and the update trigger, which fires only when state, the level or the erasure time changes, does not need
-- them. Everything else is 0016's, unchanged: for every role, the migrator included, a post never leaves
-- deleted_by_author; for every role but the migrator, a post is inserted visible, at level visible and unerased, and an
-- update moves state only to deleted_by_author and never changes the level or the erasure time. The function is plain, so
-- current_user is the role that ran the statement, and inside the migrator-owned definer functions it is the migrator.
CREATE OR REPLACE FUNCTION "public"."posts_guard"() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'korbat_migrate' AND (NEW.state <> 'visible' OR NEW.moderation_level <> 'visible' OR NEW.erased_at IS NOT NULL) THEN
      RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
    END IF;
    IF current_user <> 'korbat_migrate' THEN
      NEW.hidden_at := NULL;
      NEW.restored_at := NULL;
      NEW.explore_from := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'deleted_by_author' AND NEW.state <> 'deleted_by_author' THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'korbat_migrate' AND ((NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'deleted_by_author')
      OR NEW.moderation_level IS DISTINCT FROM OLD.moderation_level OR NEW.erased_at IS DISTINCT FROM OLD.erased_at) THEN
    RAISE EXCEPTION 'moderation_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
```

### Create `packages/db/migrations/meta/0023_snapshot.json`

```json
{
  "id": "87c2d351-6f40-41ef-b19e-8d4fd6512c99",
  "prevId": "ebd1de1a-e978-4644-9501-e2573ce1b7e1",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_confirmations": {
      "name": "notifier_confirmations",
      "schema": "auth",
      "columns": {
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "confirmed_at": {
          "name": "confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_confirmations_auth_all": {
          "name": "notifier_confirmations_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_contacts": {
      "name": "notifier_contacts",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "name_enc": {
          "name": "name_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "email_enc": {
          "name": "email_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "mail_token_enc": {
          "name": "mail_token_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "forget_after": {
          "name": "forget_after",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_contacts_auth_all": {
          "name": "notifier_contacts_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.notifier_suppressions": {
      "name": "notifier_suppressions",
      "schema": "auth",
      "columns": {
        "email_hash": {
          "name": "email_hash",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "notifier_suppressions_auth_all": {
          "name": "notifier_suppressions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "columnsFrom": [
            "created_device_id"
          ],
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "device_id"
          ],
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "passkey_id"
          ],
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_enrollments": {
      "name": "staff_enrollments",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "token_hash": {
          "name": "token_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "used_at": {
          "name": "used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_enrollments_token_hash_idx": {
          "name": "staff_enrollments_token_hash_idx",
          "columns": [
            {
              "expression": "token_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_enrollments_user_idx": {
          "name": "staff_enrollments_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_enrollments_user_id_users_id_fk": {
          "name": "staff_enrollments_user_id_users_id_fk",
          "tableFrom": "staff_enrollments",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_enrollments_auth_all": {
          "name": "staff_enrollments_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_keys": {
      "name": "staff_keys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_keys_credential_idx": {
          "name": "staff_keys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_keys_user_idx": {
          "name": "staff_keys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_keys_user_id_users_id_fk": {
          "name": "staff_keys_user_id_users_id_fk",
          "tableFrom": "staff_keys",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_keys_id_user_id_unique": {
          "name": "staff_keys_id_user_id_unique",
          "columns": [
            "id",
            "user_id"
          ],
          "nullsNotDistinct": false
        }
      },
      "policies": {
        "staff_keys_auth_all": {
          "name": "staff_keys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_keys_suspect_is_revoked": {
          "name": "staff_keys_suspect_is_revoked",
          "value": "\"auth\".\"staff_keys\".\"suspect_at\" is null or \"auth\".\"staff_keys\".\"revoked_at\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_personal_accounts": {
      "name": "staff_personal_accounts",
      "schema": "auth",
      "columns": {
        "staff_user_id": {
          "name": "staff_user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "personal_user_id": {
          "name": "personal_user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "linked_at": {
          "name": "linked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "staff_personal_accounts_staff_user_id_users_id_fk": {
          "name": "staff_personal_accounts_staff_user_id_users_id_fk",
          "tableFrom": "staff_personal_accounts",
          "columnsFrom": [
            "staff_user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "staff_personal_accounts_personal_user_id_users_id_fk": {
          "name": "staff_personal_accounts_personal_user_id_users_id_fk",
          "tableFrom": "staff_personal_accounts",
          "columnsFrom": [
            "personal_user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {
        "staff_personal_accounts_staff_user_id_personal_user_id_pk": {
          "name": "staff_personal_accounts_staff_user_id_personal_user_id_pk",
          "columns": [
            "staff_user_id",
            "personal_user_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "staff_personal_accounts_auth_none": {
          "name": "staff_personal_accounts_auth_none",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "false"
        }
      },
      "checkConstraints": {
        "staff_personal_accounts_differ": {
          "name": "staff_personal_accounts_differ",
          "value": "\"auth\".\"staff_personal_accounts\".\"staff_user_id\" <> \"auth\".\"staff_personal_accounts\".\"personal_user_id\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_sessions": {
      "name": "staff_sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "idle_expires_at": {
          "name": "idle_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "browser": {
          "name": "browser",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "staff_sessions_handle_idx": {
          "name": "staff_sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_sessions_user_idx": {
          "name": "staff_sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_sessions_user_id_users_id_fk": {
          "name": "staff_sessions_user_id_users_id_fk",
          "tableFrom": "staff_sessions",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "staff_sessions_key_user_fk": {
          "name": "staff_sessions_key_user_fk",
          "tableFrom": "staff_sessions",
          "columnsFrom": [
            "key_id",
            "user_id"
          ],
          "tableTo": "staff_keys",
          "schemaTo": "auth",
          "columnsTo": [
            "id",
            "user_id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_sessions_auth_all": {
          "name": "staff_sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_sessions_lifetime": {
          "name": "staff_sessions_lifetime",
          "value": "\"auth\".\"staff_sessions\".\"absolute_expires_at\" <= \"auth\".\"staff_sessions\".\"created_at\" + interval '12 hours' and \"auth\".\"staff_sessions\".\"idle_expires_at\" <= \"auth\".\"staff_sessions\".\"absolute_expires_at\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "isExpression": true,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "phone_hash is not null",
          "concurrently": false
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "webauthn_user_id is not null",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "retired_at": {
          "name": "retired_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "columnsFrom": [
            "profile_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "show_in_explore": {
          "name": "show_in_explore",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        },
        "suspended_from": {
          "name": "suspended_from",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspended_until": {
          "name": "suspended_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reports_restricted_until": {
          "name": "reports_restricted_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "isExpression": true,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        },
        "profiles_suspended": {
          "name": "profiles_suspended",
          "value": "(\"profiles\".\"suspended_from\" is null) = (\"profiles\".\"suspended_until\" is null) and \"profiles\".\"suspended_from\" < \"profiles\".\"suspended_until\""
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "columnsFrom": [
            "blocker_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "columnsFrom": [
            "blocked_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_items": {
      "name": "explore_items",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "explore_items_generation_post_idx": {
          "name": "explore_items_generation_post_idx",
          "columns": [
            {
              "expression": "generation",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "explore_items_generation_explore_runs_generation_fk": {
          "name": "explore_items_generation_explore_runs_generation_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "generation"
          ],
          "tableTo": "explore_runs",
          "columnsTo": [
            "generation"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "explore_items_post_id_posts_id_fk": {
          "name": "explore_items_post_id_posts_id_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "explore_items_author_id_profiles_id_fk": {
          "name": "explore_items_author_id_profiles_id_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "author_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "explore_items_generation_position_pk": {
          "name": "explore_items_generation_position_pk",
          "columns": [
            "generation",
            "position"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "explore_items_api_all": {
          "name": "explore_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_runs": {
      "name": "explore_runs",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "name": "explore_runs_generation_seq",
            "increment": "1",
            "minValue": "1",
            "maxValue": "2147483647",
            "startWith": "1",
            "cache": "1",
            "cycle": false,
            "schema": "public",
            "type": "always"
          }
        },
        "as_of": {
          "name": "as_of",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "formula": {
          "name": "formula",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "candidates": {
          "name": "candidates",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "items": {
          "name": "items",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "took_ms": {
          "name": "took_ms",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "explore_runs_api_all": {
          "name": "explore_runs_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "columnsFrom": [
            "follower_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "columnsFrom": [
            "followee_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "likes_created_brin": {
          "name": "likes_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "brin",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "columnsFrom": [
            "muter_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "columnsFrom": [
            "muted_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "moderation_state": {
          "name": "moderation_state",
          "type": "media_moderation_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "hold_until": {
          "name": "hold_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "columnsFrom": [
            "owner_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "moderation_level": {
          "name": "moderation_level",
          "type": "moderation_level",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "hidden_at": {
          "name": "hidden_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "restored_at": {
          "name": "restored_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "explore_from": {
          "name": "explore_from",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_explore_from_idx": {
          "name": "posts_explore_from_idx",
          "columns": [
            {
              "expression": "explore_from",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "explore_from is not null",
          "concurrently": false
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "author_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "reposts_created_brin": {
          "name": "reposts_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "brin",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.appeals": {
      "name": "appeals",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "appellant_account_id": {
          "name": "appellant_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_salt": {
          "name": "statement_salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_digest": {
          "name": "statement_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "filed_at": {
          "name": "filed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "answered_by": {
          "name": "answered_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "result": {
          "name": "result",
          "type": "appeal_result",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "answered_at": {
          "name": "answered_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "appeals_once": {
          "name": "appeals_once",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "appeals_pending_idx": {
          "name": "appeals_pending_idx",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "answered_by is null",
          "concurrently": false
        },
        "appeals_statement_idx": {
          "name": "appeals_statement_idx",
          "columns": [
            {
              "expression": "decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "statement is not null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "appeals_decision_id_decisions_id_fk": {
          "name": "appeals_decision_id_decisions_id_fk",
          "tableFrom": "appeals",
          "columnsFrom": [
            "decision_id"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "appeals_answered_by_decisions_id_fk": {
          "name": "appeals_answered_by_decisions_id_fk",
          "tableFrom": "appeals",
          "columnsFrom": [
            "answered_by"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "appeals_api_all": {
          "name": "appeals_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "appeals_statement_len": {
          "name": "appeals_statement_len",
          "value": "char_length(\"appeals\".\"statement\") <= 2000"
        },
        "appeals_statement": {
          "name": "appeals_statement",
          "value": "(\"appeals\".\"statement\" is null) = (\"appeals\".\"statement_salt\" is null) and (\"appeals\".\"statement\" is null or (\"appeals\".\"erased_at\" is null and \"appeals\".\"statement_salt\" ~ '^[0-9a-f]{64}$' and \"appeals\".\"statement_digest\" is not null and \"appeals\".\"statement_digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"appeals\".\"statement_salt\", 'hex') || convert_to(\"appeals\".\"statement\", 'UTF8')), 'hex'))) and (\"appeals\".\"statement\" is not null or \"appeals\".\"statement_digest\" is null or \"appeals\".\"erased_at\" is not null) and (\"appeals\".\"statement_digest\" is null or \"appeals\".\"statement_digest\" ~ '^[0-9a-f]{64}$')"
        }
      },
      "isRLSEnabled": true
    },
    "public.case_access_log": {
      "name": "case_access_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigint",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "name": "case_access_log_id_seq",
            "increment": "1",
            "minValue": "1",
            "maxValue": "9223372036854775807",
            "startWith": "1",
            "cache": "1",
            "cycle": false,
            "schema": "public",
            "type": "always"
          }
        },
        "staff_id": {
          "name": "staff_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "access_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "intake_item_id": {
          "name": "intake_item_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "text_id": {
          "name": "text_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "at": {
          "name": "at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "case_access_log_staff_idx": {
          "name": "case_access_log_staff_idx",
          "columns": [
            {
              "expression": "staff_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "case_access_log_case_idx": {
          "name": "case_access_log_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "case_access_log_reveals_idx": {
          "name": "case_access_log_reveals_idx",
          "columns": [
            {
              "expression": "at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "kind = 'identity_revealed'",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "case_access_log_staff_id_profiles_id_fk": {
          "name": "case_access_log_staff_id_profiles_id_fk",
          "tableFrom": "case_access_log",
          "columnsFrom": [
            "staff_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "case_access_log_case_id_cases_id_fk": {
          "name": "case_access_log_case_id_cases_id_fk",
          "tableFrom": "case_access_log",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "case_access_log_api_all": {
          "name": "case_access_log_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.cases": {
      "name": "cases",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "opened_at": {
          "name": "opened_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "lane": {
          "name": "lane",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 2
        },
        "intake_seq": {
          "name": "intake_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "answered_seq": {
          "name": "answered_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "state_version": {
          "name": "state_version",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "oldest_open_at": {
          "name": "oldest_open_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "last_decided_at": {
          "name": "last_decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "closed_at": {
          "name": "closed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "cases_one_open_per_target": {
          "name": "cases_one_open_per_target",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "closed_at is null",
          "concurrently": false
        },
        "cases_queue_idx": {
          "name": "cases_queue_idx",
          "columns": [
            {
              "expression": "lane",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "oldest_open_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "closed_at is null",
          "concurrently": false
        },
        "cases_target_idx": {
          "name": "cases_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "opened_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "cases_api_all": {
          "name": "cases_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "cases_lane": {
          "name": "cases_lane",
          "value": "\"cases\".\"lane\" between 0 and 2"
        },
        "cases_seq_order": {
          "name": "cases_seq_order",
          "value": "\"cases\".\"answered_seq\" <= \"cases\".\"intake_seq\""
        },
        "cases_closed_answered": {
          "name": "cases_closed_answered",
          "value": "\"cases\".\"closed_at\" is null or \"cases\".\"answered_seq\" = \"cases\".\"intake_seq\""
        }
      },
      "isRLSEnabled": true
    },
    "public.decision_actions": {
      "name": "decision_actions",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "action_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "subject_account_id": {
          "name": "subject_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "reverses_action_id": {
          "name": "reverses_action_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "no_effect": {
          "name": "no_effect",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "days": {
          "name": "days",
          "type": "smallint",
          "primaryKey": false,
          "notNull": false
        },
        "announced": {
          "name": "announced",
          "type": "boolean",
          "primaryKey": false,
          "notNull": false
        },
        "basis": {
          "name": "basis",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "rests_on": {
          "name": "rests_on",
          "type": "uuid[]",
          "primaryKey": false,
          "notNull": false
        },
        "starts_at": {
          "name": "starts_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "ends_at": {
          "name": "ends_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "replaced": {
          "name": "replaced",
          "type": "boolean",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "decision_actions_reversed_once": {
          "name": "decision_actions_reversed_once",
          "columns": [
            {
              "expression": "reverses_action_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "reverses_action_id is not null",
          "concurrently": false
        },
        "decision_actions_post_kind_idx": {
          "name": "decision_actions_post_kind_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "kind",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "decision_actions_subject_kind_idx": {
          "name": "decision_actions_subject_kind_idx",
          "columns": [
            {
              "expression": "subject_account_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "kind",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "decision_actions_decision_id_decisions_id_fk": {
          "name": "decision_actions_decision_id_decisions_id_fk",
          "tableFrom": "decision_actions",
          "columnsFrom": [
            "decision_id"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "decision_actions_reverses_action_id_decision_actions_id_fk": {
          "name": "decision_actions_reverses_action_id_decision_actions_id_fk",
          "tableFrom": "decision_actions",
          "columnsFrom": [
            "reverses_action_id"
          ],
          "tableTo": "decision_actions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "decision_actions_once": {
          "name": "decision_actions_once",
          "columns": [
            "decision_id",
            "kind",
            "media_id"
          ],
          "nullsNotDistinct": true
        }
      },
      "policies": {
        "decision_actions_api_all": {
          "name": "decision_actions_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "decision_actions_no_effect": {
          "name": "decision_actions_no_effect",
          "value": "\"decision_actions\".\"no_effect\" in ('already', 'deleted')"
        },
        "decision_actions_days": {
          "name": "decision_actions_days",
          "value": "\"decision_actions\".\"days\" between 1 and 30"
        },
        "decision_actions_basis": {
          "name": "decision_actions_basis",
          "value": "\"decision_actions\".\"basis\" in ('strikes', 'threat', 'terrorist', 'flood', 'protective', 'threat_repeat', 'ladder_end', 'reports')"
        },
        "decision_actions_announced": {
          "name": "decision_actions_announced",
          "value": "\"decision_actions\".\"announced\" is null or \"decision_actions\".\"basis\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "public.decisions": {
      "name": "decisions",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "decision_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "reviews_decision_id": {
          "name": "reviews_decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "appeal_id": {
          "name": "appeal_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "seen_state_version": {
          "name": "seen_state_version",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "through_seq": {
          "name": "through_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "answers_from_seq": {
          "name": "answers_from_seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "outcome": {
          "name": "outcome",
          "type": "decision_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "ground": {
          "name": "ground",
          "type": "decision_ground",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "rules_version": {
          "name": "rules_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "redress_version": {
          "name": "redress_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "category": {
          "name": "category",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "category_keyword": {
          "name": "category_keyword",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "source": {
          "name": "source",
          "type": "decision_source",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "automated_detection": {
          "name": "automated_detection",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "automated_decision": {
          "name": "automated_decision",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "'not_automated'"
        },
        "territorial_scope": {
          "name": "territorial_scope",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "'worldwide'"
        },
        "snapshot_id": {
          "name": "snapshot_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "snapshot_digest": {
          "name": "snapshot_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "facts_digest": {
          "name": "facts_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "reason_digest": {
          "name": "reason_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "legal_reference_digest": {
          "name": "legal_reference_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "decided_by": {
          "name": "decided_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "xact": {
          "name": "xact",
          "type": "xid8",
          "primaryKey": false,
          "notNull": true
        },
        "puid": {
          "name": "puid",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "informed_at": {
          "name": "informed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "suspect": {
          "name": "suspect",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "unseen": {
          "name": "unseen",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "needs_admin": {
          "name": "needs_admin",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "ended_interim": {
          "name": "ended_interim",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "author_mail": {
          "name": "author_mail",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "author_mail_at": {
          "name": "author_mail_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "redacted_at": {
          "name": "redacted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "decisions_case_decided_idx": {
          "name": "decisions_case_decided_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "decisions_decided_by_idx": {
          "name": "decisions_decided_by_idx",
          "columns": [
            {
              "expression": "decided_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "decisions_reviews_idx": {
          "name": "decisions_reviews_idx",
          "columns": [
            {
              "expression": "reviews_decision_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "decisions_appeal_once": {
          "name": "decisions_appeal_once",
          "columns": [
            {
              "expression": "appeal_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "appeal_id is not null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "decisions_case_id_cases_id_fk": {
          "name": "decisions_case_id_cases_id_fk",
          "tableFrom": "decisions",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "decisions_reviews_decision_id_decisions_id_fk": {
          "name": "decisions_reviews_decision_id_decisions_id_fk",
          "tableFrom": "decisions",
          "columnsFrom": [
            "reviews_decision_id"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        },
        "decisions_appeal_id_appeals_id_fk": {
          "name": "decisions_appeal_id_appeals_id_fk",
          "tableFrom": "decisions",
          "columnsFrom": [
            "appeal_id"
          ],
          "tableTo": "appeals",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        },
        "decisions_snapshot_id_evidence_snapshots_id_fk": {
          "name": "decisions_snapshot_id_evidence_snapshots_id_fk",
          "tableFrom": "decisions",
          "columnsFrom": [
            "snapshot_id"
          ],
          "tableTo": "evidence_snapshots",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "decisions_decided_by_profiles_id_fk": {
          "name": "decisions_decided_by_profiles_id_fk",
          "tableFrom": "decisions",
          "columnsFrom": [
            "decided_by"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "decisions_puid_unique": {
          "name": "decisions_puid_unique",
          "columns": [
            "puid"
          ],
          "nullsNotDistinct": false
        }
      },
      "policies": {
        "decisions_api_all": {
          "name": "decisions_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "decisions_rule_id": {
          "name": "decisions_rule_id",
          "value": "\"decisions\".\"rule_id\" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')"
        },
        "decisions_category": {
          "name": "decisions_category",
          "value": "\"decisions\".\"category\" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')"
        },
        "decisions_category_keyword": {
          "name": "decisions_category_keyword",
          "value": "\"decisions\".\"category_keyword\" in ('KEYWORD_TERRORIST_CONTENT')"
        },
        "decisions_automated_decision": {
          "name": "decisions_automated_decision",
          "value": "\"decisions\".\"automated_decision\" in ('fully', 'partially', 'not_automated')"
        },
        "decisions_territorial_scope": {
          "name": "decisions_territorial_scope",
          "value": "\"decisions\".\"territorial_scope\" = 'worldwide'"
        },
        "decisions_review_target": {
          "name": "decisions_review_target",
          "value": "(\"decisions\".\"kind\" in ('review', 'correction')) = (\"decisions\".\"reviews_decision_id\" is not null) and (\"decisions\".\"kind\" = 'review') = (\"decisions\".\"appeal_id\" is not null)"
        },
        "decisions_interim": {
          "name": "decisions_interim",
          "value": "\"decisions\".\"kind\" <> 'interim' or \"decisions\".\"through_seq\" = 0"
        },
        "decisions_ground_rule": {
          "name": "decisions_ground_rule",
          "value": "\"decisions\".\"ground\" is distinct from 'incompatible' or \"decisions\".\"rule_id\" is not null"
        },
        "decisions_ground_law": {
          "name": "decisions_ground_law",
          "value": "\"decisions\".\"ground\" is distinct from 'illegal' or \"decisions\".\"legal_reference_digest\" is not null"
        },
        "decisions_restricted": {
          "name": "decisions_restricted",
          "value": "\"decisions\".\"outcome\" <> 'restricted' or (\"decisions\".\"ground\" is not null and \"decisions\".\"facts_digest\" is not null and \"decisions\".\"reason_digest\" is not null)"
        },
        "decisions_digests": {
          "name": "decisions_digests",
          "value": "(\"decisions\".\"facts_digest\" is null or \"decisions\".\"facts_digest\" ~ '^[0-9a-f]{64}$') and (\"decisions\".\"reason_digest\" is null or \"decisions\".\"reason_digest\" ~ '^[0-9a-f]{64}$') and (\"decisions\".\"legal_reference_digest\" is null or \"decisions\".\"legal_reference_digest\" ~ '^[0-9a-f]{64}$')"
        },
        "decisions_keyword": {
          "name": "decisions_keyword",
          "value": "\"decisions\".\"category_keyword\" is null or \"decisions\".\"ground\" is not distinct from 'illegal'"
        },
        "decisions_law_no_rule": {
          "name": "decisions_law_no_rule",
          "value": "\"decisions\".\"ground\" is distinct from 'illegal' or \"decisions\".\"rule_id\" is null"
        },
        "decisions_reversal_plain": {
          "name": "decisions_reversal_plain",
          "value": "\"decisions\".\"kind\" not in ('review', 'correction') or (\"decisions\".\"ground\" is null and \"decisions\".\"rule_id\" is null and \"decisions\".\"category_keyword\" is null and \"decisions\".\"facts_digest\" is null and \"decisions\".\"legal_reference_digest\" is null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.evidence_snapshots": {
      "name": "evidence_snapshots",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "taken_at": {
          "name": "taken_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "author_handle": {
          "name": "author_handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "post_state": {
          "name": "post_state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "post_created_at": {
          "name": "post_created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "media": {
          "name": "media",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "salt": {
          "name": "salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "digest": {
          "name": "digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "evidence_snapshots_case_taken_idx": {
          "name": "evidence_snapshots_case_taken_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "taken_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "evidence_snapshots_target_idx": {
          "name": "evidence_snapshots_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "evidence_snapshots_unerased_idx": {
          "name": "evidence_snapshots_unerased_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "erased_at is null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "evidence_snapshots_case_id_cases_id_fk": {
          "name": "evidence_snapshots_case_id_cases_id_fk",
          "tableFrom": "evidence_snapshots",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "evidence_snapshots_api_all": {
          "name": "evidence_snapshots_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "evidence_erased": {
          "name": "evidence_erased",
          "value": "\"evidence_snapshots\".\"erased_at\" is null or (\"evidence_snapshots\".\"body\" is null and \"evidence_snapshots\".\"media\" is null and \"evidence_snapshots\".\"display_name\" is null and \"evidence_snapshots\".\"bio\" is null and \"evidence_snapshots\".\"salt\" is null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.intake_items": {
      "name": "intake_items",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "intake_id": {
          "name": "intake_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "moderation_target",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "named_handle": {
          "name": "named_handle",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "seq": {
          "name": "seq",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "lane": {
          "name": "lane",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "reporter_account_id": {
          "name": "reporter_account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "alleges_illegal": {
          "name": "alleges_illegal",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "suspect": {
          "name": "suspect",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "outcome": {
          "name": "outcome",
          "type": "item_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "answered_by": {
          "name": "answered_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "outcome_sent_at": {
          "name": "outcome_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "shown_outcome": {
          "name": "shown_outcome",
          "type": "item_outcome",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "revision_pending_at": {
          "name": "revision_pending_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revised_sent_at": {
          "name": "revised_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "outcome_mail": {
          "name": "outcome_mail",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "reexamines_item_id": {
          "name": "reexamines_item_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_salt": {
          "name": "statement_salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_digest": {
          "name": "statement_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "intake_items_target_once": {
          "name": "intake_items_target_once",
          "columns": [
            {
              "expression": "intake_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "reexamines_item_id is null",
          "concurrently": false
        },
        "intake_items_reexamines_once": {
          "name": "intake_items_reexamines_once",
          "columns": [
            {
              "expression": "reexamines_item_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "reexamines_item_id is not null",
          "concurrently": false
        },
        "intake_items_case_seq_idx": {
          "name": "intake_items_case_seq_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "intake_items_reporter_once": {
          "name": "intake_items_reporter_once",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "reporter_account_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "alleges_illegal",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "reexamines_item_id is null",
          "concurrently": false
        },
        "intake_items_answered_by_idx": {
          "name": "intake_items_answered_by_idx",
          "columns": [
            {
              "expression": "answered_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "intake_items_suspect_open_idx": {
          "name": "intake_items_suspect_open_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "suspect and answered_by is null",
          "concurrently": false
        },
        "intake_items_revision_idx": {
          "name": "intake_items_revision_idx",
          "columns": [
            {
              "expression": "revision_pending_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "revision_pending_at is not null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "intake_items_intake_id_intakes_id_fk": {
          "name": "intake_items_intake_id_intakes_id_fk",
          "tableFrom": "intake_items",
          "columnsFrom": [
            "intake_id"
          ],
          "tableTo": "intakes",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "intake_items_case_id_cases_id_fk": {
          "name": "intake_items_case_id_cases_id_fk",
          "tableFrom": "intake_items",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "intake_items_answered_by_decisions_id_fk": {
          "name": "intake_items_answered_by_decisions_id_fk",
          "tableFrom": "intake_items",
          "columnsFrom": [
            "answered_by"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        },
        "intake_items_reexamines_item_id_intake_items_id_fk": {
          "name": "intake_items_reexamines_item_id_intake_items_id_fk",
          "tableFrom": "intake_items",
          "columnsFrom": [
            "reexamines_item_id"
          ],
          "tableTo": "intake_items",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "intake_items_api_all": {
          "name": "intake_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "intake_items_position": {
          "name": "intake_items_position",
          "value": "\"intake_items\".\"position\" between 1 and 20"
        },
        "intake_items_lane": {
          "name": "intake_items_lane",
          "value": "\"intake_items\".\"lane\" between 0 and 2"
        },
        "intake_items_case": {
          "name": "intake_items_case",
          "value": "(\"intake_items\".\"case_id\" is null) = (\"intake_items\".\"seq\" is null) and (\"intake_items\".\"case_id\" is not null or \"intake_items\".\"outcome\" is not distinct from 'not_available')"
        },
        "intake_items_shown": {
          "name": "intake_items_shown",
          "value": "\"intake_items\".\"shown_outcome\" is null or \"intake_items\".\"outcome_sent_at\" is not null"
        },
        "intake_items_named_handle": {
          "name": "intake_items_named_handle",
          "value": "(\"intake_items\".\"target_type\" = 'account') = (\"intake_items\".\"named_handle\" is not null)"
        },
        "intake_items_statement_len": {
          "name": "intake_items_statement_len",
          "value": "char_length(\"intake_items\".\"statement\") <= 2000"
        },
        "intake_items_statement": {
          "name": "intake_items_statement",
          "value": "(\"intake_items\".\"statement_digest\" is null or \"intake_items\".\"reexamines_item_id\" is not null) and (\"intake_items\".\"statement\" is null) = (\"intake_items\".\"statement_salt\" is null) and (\"intake_items\".\"statement\" is null or (\"intake_items\".\"erased_at\" is null and \"intake_items\".\"statement_salt\" ~ '^[0-9a-f]{64}$' and \"intake_items\".\"statement_digest\" is not null and \"intake_items\".\"statement_digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"intake_items\".\"statement_salt\", 'hex') || convert_to(\"intake_items\".\"statement\", 'UTF8')), 'hex'))) and (\"intake_items\".\"statement\" is not null or \"intake_items\".\"statement_digest\" is null or \"intake_items\".\"erased_at\" is not null) and (\"intake_items\".\"statement_digest\" is null or \"intake_items\".\"statement_digest\" ~ '^[0-9a-f]{64}$')"
        }
      },
      "isRLSEnabled": true
    },
    "public.intakes": {
      "name": "intakes",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "kind": {
          "name": "kind",
          "type": "intake_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "ref": {
          "name": "ref",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "lookup_hash": {
          "name": "lookup_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "channel": {
          "name": "channel",
          "type": "intake_channel",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "reporter_id": {
          "name": "reporter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "finding_by": {
          "name": "finding_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "contact_id": {
          "name": "contact_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alleges_illegal": {
          "name": "alleges_illegal",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "csam": {
          "name": "csam",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "category": {
          "name": "category",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "category_keyword": {
          "name": "category_keyword",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "cited_law": {
          "name": "cited_law",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "explanation": {
          "name": "explanation",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "bona_fide": {
          "name": "bona_fide",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "automated_processing": {
          "name": "automated_processing",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "received_at": {
          "name": "received_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "receipt": {
          "name": "receipt",
          "type": "delivery_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "receipt_sent_at": {
          "name": "receipt_sent_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "intakes_reporter_idx": {
          "name": "intakes_reporter_idx",
          "columns": [
            {
              "expression": "reporter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "intakes_finding_idx": {
          "name": "intakes_finding_idx",
          "columns": [
            {
              "expression": "finding_by",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "intakes_unerased_idx": {
          "name": "intakes_unerased_idx",
          "columns": [
            {
              "expression": "received_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "erased_at is null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "intakes_reporter_id_profiles_id_fk": {
          "name": "intakes_reporter_id_profiles_id_fk",
          "tableFrom": "intakes",
          "columnsFrom": [
            "reporter_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        },
        "intakes_finding_by_profiles_id_fk": {
          "name": "intakes_finding_by_profiles_id_fk",
          "tableFrom": "intakes",
          "columnsFrom": [
            "finding_by"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "intakes_ref_unique": {
          "name": "intakes_ref_unique",
          "columns": [
            "ref"
          ],
          "nullsNotDistinct": false
        },
        "intakes_lookup_hash_unique": {
          "name": "intakes_lookup_hash_unique",
          "columns": [
            "lookup_hash"
          ],
          "nullsNotDistinct": false
        }
      },
      "policies": {
        "intakes_api_all": {
          "name": "intakes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "intakes_ref": {
          "name": "intakes_ref",
          "value": "\"intakes\".\"ref\" ~ '^N-[A-Z2-7]{10}$'"
        },
        "intakes_rule_id": {
          "name": "intakes_rule_id",
          "value": "\"intakes\".\"rule_id\" in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6')"
        },
        "intakes_category": {
          "name": "intakes_category",
          "value": "\"intakes\".\"category\" in ('STATEMENT_CATEGORY_ANIMAL_WELFARE', 'STATEMENT_CATEGORY_CONSUMER_INFORMATION', 'STATEMENT_CATEGORY_CYBER_VIOLENCE', 'STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN', 'STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS', 'STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH', 'STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS', 'STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS', 'STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE', 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC', 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS', 'STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY', 'STATEMENT_CATEGORY_SCAMS_AND_FRAUD', 'STATEMENT_CATEGORY_SELF_HARM', 'STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS', 'STATEMENT_CATEGORY_VIOLENCE')"
        },
        "intakes_category_keyword": {
          "name": "intakes_category_keyword",
          "value": "\"intakes\".\"category_keyword\" in ('KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL', 'KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE', 'KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS')"
        },
        "intakes_cited_law_len": {
          "name": "intakes_cited_law_len",
          "value": "char_length(\"intakes\".\"cited_law\") <= 300"
        },
        "intakes_explanation_len": {
          "name": "intakes_explanation_len",
          "value": "char_length(\"intakes\".\"explanation\") <= 2000"
        },
        "intakes_has_ground": {
          "name": "intakes_has_ground",
          "value": "\"intakes\".\"rule_id\" is not null or \"intakes\".\"alleges_illegal\" or \"intakes\".\"csam\""
        },
        "intakes_illegal_elements": {
          "name": "intakes_illegal_elements",
          "value": "\"intakes\".\"kind\" <> 'user' or not \"intakes\".\"alleges_illegal\" or \"intakes\".\"csam\" or (\"intakes\".\"bona_fide\" and (\"intakes\".\"explanation\" is not null or \"intakes\".\"erased_at\" is not null))"
        },
        "intakes_finding_legal": {
          "name": "intakes_finding_legal",
          "value": "\"intakes\".\"kind\" <> 'finding' or not \"intakes\".\"alleges_illegal\""
        },
        "intakes_illegal_not_tc": {
          "name": "intakes_illegal_not_tc",
          "value": "not \"intakes\".\"alleges_illegal\" or \"intakes\".\"category\" <> 'STATEMENT_CATEGORY_OTHER_VIOLATION_TC'"
        },
        "intakes_csam": {
          "name": "intakes_csam",
          "value": "not \"intakes\".\"csam\" or (\"intakes\".\"category\" = 'STATEMENT_CATEGORY_PROTECTION_OF_MINORS' and \"intakes\".\"reporter_id\" is null and \"intakes\".\"contact_id\" is null)"
        },
        "intakes_contact_signed_out": {
          "name": "intakes_contact_signed_out",
          "value": "\"intakes\".\"contact_id\" is null or \"intakes\".\"channel\" = 'signed_out'"
        },
        "intakes_reporter_signed_in": {
          "name": "intakes_reporter_signed_in",
          "value": "\"intakes\".\"reporter_id\" is null or \"intakes\".\"channel\" = 'signed_in'"
        },
        "intakes_finding": {
          "name": "intakes_finding",
          "value": "(\"intakes\".\"kind\" = 'finding') = (\"intakes\".\"finding_by\" is not null) and (\"intakes\".\"kind\" = 'finding') = (\"intakes\".\"channel\" = 'staff')"
        },
        "intakes_lookup": {
          "name": "intakes_lookup",
          "value": "(\"intakes\".\"lookup_hash\" is not null) = (\"intakes\".\"channel\" = 'signed_out' or \"intakes\".\"csam\")"
        },
        "intakes_erased": {
          "name": "intakes_erased",
          "value": "\"intakes\".\"erased_at\" is null or (\"intakes\".\"explanation\" is null and \"intakes\".\"cited_law\" is null)"
        },
        "intakes_r2_finding_only": {
          "name": "intakes_r2_finding_only",
          "value": "\"intakes\".\"rule_id\" is distinct from 'R2' or \"intakes\".\"kind\" = 'finding'"
        }
      },
      "isRLSEnabled": true
    },
    "public.media_holds": {
      "name": "media_holds",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigint",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "name": "media_holds_id_seq",
            "increment": "1",
            "minValue": "1",
            "maxValue": "9223372036854775807",
            "startWith": "1",
            "cache": "1",
            "cycle": false,
            "schema": "public",
            "type": "always"
          }
        },
        "media_id": {
          "name": "media_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "held_at": {
          "name": "held_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "until": {
          "name": "until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "released_at": {
          "name": "released_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "media_holds_media_idx": {
          "name": "media_holds_media_idx",
          "columns": [
            {
              "expression": "media_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "released_at is null",
          "concurrently": false
        },
        "media_holds_case_idx": {
          "name": "media_holds_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "released_at is null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "media_holds_media_id_post_media_id_fk": {
          "name": "media_holds_media_id_post_media_id_fk",
          "tableFrom": "media_holds",
          "columnsFrom": [
            "media_id"
          ],
          "tableTo": "post_media",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "media_holds_case_id_cases_id_fk": {
          "name": "media_holds_case_id_cases_id_fk",
          "tableFrom": "media_holds",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "media_holds_api_all": {
          "name": "media_holds_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.moderation_limits": {
      "name": "moderation_limits",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "decisions_per_hour": {
          "name": "decisions_per_hour",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "decisions_per_day": {
          "name": "decisions_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "case_opens_per_day": {
          "name": "case_opens_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "findings_per_day": {
          "name": "findings_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "reveals_per_day": {
          "name": "reveals_per_day",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "updated_at": {
          "name": "updated_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "moderation_limits_api_select": {
          "name": "moderation_limits_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "moderation_limits_single_row": {
          "name": "moderation_limits_single_row",
          "value": "\"moderation_limits\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.report_tallies": {
      "name": "report_tallies",
      "schema": "",
      "columns": {
        "account_id": {
          "name": "account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "day": {
          "name": "day",
          "type": "date",
          "primaryKey": false,
          "notNull": true
        },
        "reports": {
          "name": "reports",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {
        "report_tallies_account_id_day_pk": {
          "name": "report_tallies_account_id_day_pk",
          "columns": [
            "account_id",
            "day"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "report_tallies_api_select": {
          "name": "report_tallies_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.seal_posts": {
      "name": "seal_posts",
      "schema": "",
      "columns": {
        "action_id": {
          "name": "action_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "images": {
          "name": "images",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "seal_posts_post_idx": {
          "name": "seal_posts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "seal_posts_action_id_decision_actions_id_fk": {
          "name": "seal_posts_action_id_decision_actions_id_fk",
          "tableFrom": "seal_posts",
          "columnsFrom": [
            "action_id"
          ],
          "tableTo": "decision_actions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {
        "seal_posts_action_id_post_id_pk": {
          "name": "seal_posts_action_id_post_id_pk",
          "columns": [
            "action_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "seal_posts_api_all": {
          "name": "seal_posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "seal_posts_images": {
          "name": "seal_posts_images",
          "value": "\"seal_posts\".\"images\" > 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.staff_texts": {
      "name": "staff_texts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "kind": {
          "name": "kind",
          "type": "staff_text_kind",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "text": {
          "name": "text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "salt": {
          "name": "salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "digest": {
          "name": "digest",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "confirmed_at": {
          "name": "confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_texts_open_idx": {
          "name": "staff_texts_open_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "confirmed_at is null and erased_at is null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_texts_case_id_cases_id_fk": {
          "name": "staff_texts_case_id_cases_id_fk",
          "tableFrom": "staff_texts",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "staff_texts_author_id_profiles_id_fk": {
          "name": "staff_texts_author_id_profiles_id_fk",
          "tableFrom": "staff_texts",
          "columnsFrom": [
            "author_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "staff_texts_decision_id_decisions_id_fk": {
          "name": "staff_texts_decision_id_decisions_id_fk",
          "tableFrom": "staff_texts",
          "columnsFrom": [
            "decision_id"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_texts_digest_unique": {
          "name": "staff_texts_digest_unique",
          "columns": [
            "digest"
          ],
          "nullsNotDistinct": false
        }
      },
      "policies": {
        "staff_texts_api_all": {
          "name": "staff_texts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_texts_text_len": {
          "name": "staff_texts_text_len",
          "value": "char_length(\"staff_texts\".\"text\") <= 5000"
        },
        "staff_texts_digest": {
          "name": "staff_texts_digest",
          "value": "(\"staff_texts\".\"text\" is null) = (\"staff_texts\".\"salt\" is null) and (\"staff_texts\".\"text\" is null) = (\"staff_texts\".\"erased_at\" is not null) and (\"staff_texts\".\"text\" is null or (\"staff_texts\".\"salt\" ~ '^[0-9a-f]{64}$' and \"staff_texts\".\"digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"staff_texts\".\"salt\", 'hex') || convert_to(\"staff_texts\".\"text\", 'UTF8')), 'hex')))"
        }
      },
      "isRLSEnabled": true
    },
    "public.suspension_replies": {
      "name": "suspension_replies",
      "schema": "",
      "columns": {
        "action_id": {
          "name": "action_id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "account_id": {
          "name": "account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_salt": {
          "name": "statement_salt",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "statement_digest": {
          "name": "statement_digest",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "filed_at": {
          "name": "filed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "on_time": {
          "name": "on_time",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true
        },
        "answered_by": {
          "name": "answered_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "answered_at": {
          "name": "answered_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "erased_at": {
          "name": "erased_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "suspension_replies_pending_idx": {
          "name": "suspension_replies_pending_idx",
          "columns": [
            {
              "expression": "filed_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "answered_by is null",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "suspension_replies_action_id_decision_actions_id_fk": {
          "name": "suspension_replies_action_id_decision_actions_id_fk",
          "tableFrom": "suspension_replies",
          "columnsFrom": [
            "action_id"
          ],
          "tableTo": "decision_actions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "suspension_replies_account_id_profiles_id_fk": {
          "name": "suspension_replies_account_id_profiles_id_fk",
          "tableFrom": "suspension_replies",
          "columnsFrom": [
            "account_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "suspension_replies_answered_by_decisions_id_fk": {
          "name": "suspension_replies_answered_by_decisions_id_fk",
          "tableFrom": "suspension_replies",
          "columnsFrom": [
            "answered_by"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "suspension_replies_api_all": {
          "name": "suspension_replies_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "suspension_replies_statement_len": {
          "name": "suspension_replies_statement_len",
          "value": "char_length(\"suspension_replies\".\"statement\") <= 2000"
        },
        "suspension_replies_statement": {
          "name": "suspension_replies_statement",
          "value": "(\"suspension_replies\".\"statement\" is null) = (\"suspension_replies\".\"statement_salt\" is null) and (\"suspension_replies\".\"statement\" is null or (\"suspension_replies\".\"erased_at\" is null and \"suspension_replies\".\"statement_salt\" ~ '^[0-9a-f]{64}$' and \"suspension_replies\".\"statement_digest\" is not null and \"suspension_replies\".\"statement_digest\" = encode(sha256(convert_to('korbat.text.v1', 'UTF8') || decode('0a', 'hex') || decode(\"suspension_replies\".\"statement_salt\", 'hex') || convert_to(\"suspension_replies\".\"statement\", 'UTF8')), 'hex'))) and (\"suspension_replies\".\"statement\" is not null or \"suspension_replies\".\"statement_digest\" is null or \"suspension_replies\".\"erased_at\" is not null) and (\"suspension_replies\".\"statement_digest\" is null or \"suspension_replies\".\"statement_digest\" ~ '^[0-9a-f]{64}$')"
        }
      },
      "isRLSEnabled": true
    },
    "public.unfounded_marks": {
      "name": "unfounded_marks",
      "schema": "",
      "columns": {
        "item_id": {
          "name": "item_id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "decision_id": {
          "name": "decision_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "account_id": {
          "name": "account_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "intake_id": {
          "name": "intake_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "reported_at": {
          "name": "reported_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "marked_at": {
          "name": "marked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "withdrawn_by": {
          "name": "withdrawn_by",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "withdrawn_at": {
          "name": "withdrawn_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "unfounded_marks_account_idx": {
          "name": "unfounded_marks_account_idx",
          "columns": [
            {
              "expression": "account_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "reported_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "unfounded_marks_item_id_intake_items_id_fk": {
          "name": "unfounded_marks_item_id_intake_items_id_fk",
          "tableFrom": "unfounded_marks",
          "columnsFrom": [
            "item_id"
          ],
          "tableTo": "intake_items",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "unfounded_marks_decision_id_decisions_id_fk": {
          "name": "unfounded_marks_decision_id_decisions_id_fk",
          "tableFrom": "unfounded_marks",
          "columnsFrom": [
            "decision_id"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "unfounded_marks_intake_id_intakes_id_fk": {
          "name": "unfounded_marks_intake_id_intakes_id_fk",
          "tableFrom": "unfounded_marks",
          "columnsFrom": [
            "intake_id"
          ],
          "tableTo": "intakes",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        },
        "unfounded_marks_withdrawn_by_decisions_id_fk": {
          "name": "unfounded_marks_withdrawn_by_decisions_id_fk",
          "tableFrom": "unfounded_marks",
          "columnsFrom": [
            "withdrawn_by"
          ],
          "tableTo": "decisions",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "unfounded_marks_api_all": {
          "name": "unfounded_marks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.audit_head": {
      "name": "audit_head",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "seq": {
          "name": "seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_head_api_select": {
          "name": "audit_head_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_head_single_row": {
          "name": "audit_head_single_row",
          "value": "\"audit_head\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "staff_session": {
          "name": "staff_session",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "action_hash": {
          "name": "action_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "step_up": {
          "name": "step_up",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "chain_version": {
          "name": "chain_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "chain_seq": {
          "name": "chain_seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "prev_hash": {
          "name": "prev_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        }
      },
      "indexes": {
        "audit_log_chain_seq_idx": {
          "name": "audit_log_chain_seq_idx",
          "columns": [
            {
              "expression": "chain_seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_log_step_up_complete": {
          "name": "audit_log_step_up_complete",
          "value": "(\"audit_log\".\"action_hash\" is null) = (\"audit_log\".\"step_up\" is null) and (\"audit_log\".\"action_hash\" is null or \"audit_log\".\"key_id\" is not null)"
        }
      },
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression",
        "staff_enrollment_issued",
        "staff_key_added",
        "staff_key_revoked",
        "staff_key_counter_regression",
        "staff_sign_in",
        "staff_signed_out",
        "staff_session_revoked"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_moderation_state": {
      "name": "media_moderation_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "sealed"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.moderation_level": {
      "name": "moderation_level",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    },
    "public.access_kind": {
      "name": "access_kind",
      "schema": "public",
      "values": [
        "case_opened",
        "image_viewed",
        "identity_revealed"
      ]
    },
    "public.action_kind": {
      "name": "action_kind",
      "schema": "public",
      "values": [
        "withhold",
        "remove",
        "seal_media",
        "withhold_media",
        "remove_media",
        "reset_display_name",
        "reset_bio",
        "restore",
        "unseal_media",
        "restore_media",
        "restore_display_name",
        "restore_bio",
        "strike",
        "suspend",
        "terminate",
        "retire_handle",
        "warn_reporting",
        "restrict_reporting",
        "overrule",
        "lift_suspension",
        "unretire_handle",
        "lift_reporting"
      ]
    },
    "public.appeal_result": {
      "name": "appeal_result",
      "schema": "public",
      "values": [
        "kept",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.decision_ground": {
      "name": "decision_ground",
      "schema": "public",
      "values": [
        "incompatible",
        "illegal"
      ]
    },
    "public.decision_kind": {
      "name": "decision_kind",
      "schema": "public",
      "values": [
        "interim",
        "final",
        "review",
        "correction"
      ]
    },
    "public.decision_outcome": {
      "name": "decision_outcome",
      "schema": "public",
      "values": [
        "restricted",
        "no_violation",
        "not_evident",
        "kept",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.decision_source": {
      "name": "decision_source",
      "schema": "public",
      "values": [
        "notice",
        "report",
        "own_initiative"
      ]
    },
    "public.delivery_state": {
      "name": "delivery_state",
      "schema": "public",
      "values": [
        "pending",
        "sent",
        "folded",
        "suppressed",
        "no_address",
        "none",
        "failed"
      ]
    },
    "public.intake_channel": {
      "name": "intake_channel",
      "schema": "public",
      "values": [
        "signed_in",
        "signed_out",
        "staff"
      ]
    },
    "public.intake_kind": {
      "name": "intake_kind",
      "schema": "public",
      "values": [
        "user",
        "finding"
      ]
    },
    "public.item_outcome": {
      "name": "item_outcome",
      "schema": "public",
      "values": [
        "restricted_rule",
        "restricted_legal",
        "no_violation",
        "not_evident",
        "not_available",
        "partly_reversed",
        "reversed"
      ]
    },
    "public.moderation_target": {
      "name": "moderation_target",
      "schema": "public",
      "values": [
        "post",
        "account"
      ]
    },
    "public.staff_text_kind": {
      "name": "staff_text_kind",
      "schema": "public",
      "values": [
        "facts",
        "reason",
        "legal_reference",
        "review_reason",
        "reveal_reason",
        "note",
        "seal_declined"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "views": {},
  "sequences": {},
  "roles": {},
  "policies": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

### Replace `apps/api/src/social/explore.ts` (whole file)

```ts
import { EXPLORE_V2 } from "@korbat/contracts";
import { createJob, type JobLock } from "../lib/jobs";
import type { SocialDeps } from "./context";

/** The job's name; its rounds run under the shared lock job:explore-refresh. */
const NAME = "explore-refresh";

/** A round every refresh interval of the published formula (5 minutes); the lock outlives a crash by as long. */
const INTERVAL_MS = EXPLORE_V2.refreshMinutes * 60_000;

/**
 * The Explore refresh as a job (2c design, section 9): one instance at a time, a round every five minutes, each ranking
 * as of the clock's time. A round that writes a ranking logs one line with its generation, candidates, items and
 * milliseconds, and nothing about any post; a round that skipped, because the newest ranking is younger than the
 * formula's minimum gap, logs nothing.
 */
export function createExploreJob(deps: SocialDeps, lock: JobLock) {
  return createJob({
    name: NAME,
    intervalMs: INTERVAL_MS,
    lockTtlMs: INTERVAL_MS,
    lock,
    log: deps.log,
    run: async () => {
      const result = await deps.repo.refreshExplore(deps.now());
      if (!result.skipped) {
        deps.log.info({ generation: result.generation, candidates: result.candidates, items: result.items, tookMs: result.tookMs }, "explore: ranking refreshed");
      }
    },
  });
}

/**
 * Runs a round at once, so Explore is filled on a new database or after downtime without waiting an interval, then
 * starts the timer, and returns the function that stops it. The timer catches and logs the failures of its own rounds;
 * this first one is caught here and logged the same way, so a failure at start never crashes the process and the timer
 * runs on. A failed round leaves the previous ranking in place.
 */
export function startExplore(deps: SocialDeps, lock: JobLock): () => void {
  const job = createExploreJob(deps, lock);
  void job.round().catch((err: unknown) => deps.log.error({ err, job: NAME }, "job: round failed"));
  return job.start();
}
```

### Replace `apps/api/src/social/flows/explore.ts` (whole file)

```ts
import { EXPLORE_V2, type ExploreFormula, type ExplorePage, type ExploreSettingResponse, type ExploreStatus, type ExploreStatusKind, type Pagination } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeExploreCursor, encodeExploreCursor } from "../cursor";
import { postViews } from "../views";

/**
 * A page of Explore (2c design, section 8): the posts of a ranking in its order, as ordinary post views, with the time the
 * ranking was computed. Without a cursor the current ranking is read; with one, the ranking it names, after the post it
 * names: a ranking not yet written, or a post that ranking does not hold, is not a cursor this module made (400), and a
 * ranking no longer kept is explore_refreshed (409), so the reader starts again from the current one. A signed-out
 * reader gets at most the formula's signed-out page whatever the limit asks, and never a cursor (the route refuses one
 * before this flow); one more row is read through the same filters, and `signInForMore` says whether it came back. The
 * cursor follows the repository's rows, not the views, which the view builder may still drop.
 */
export async function explorePage(deps: SocialDeps, viewer: ViewerId, query: Pagination, formula: ExploreFormula = EXPLORE_V2): Promise<ExplorePage> {
  const cursor = query.cursor ? decodeExploreCursor(query.cursor) : undefined;
  const limit = viewer ? query.limit : Math.min(query.limit, formula.signedOutPage);
  const read = await deps.repo.explorePage(viewer, cursor, viewer ? limit : limit + 1);
  if (cursor) {
    // In this order: every answer comes from one statement, so a round landing in between cannot change which applies.
    // Before the first round there is no current generation, and every generation (they start at 1) is one not yet written.
    if (cursor.g > (read.current ?? 0)) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
    if (!read.ranking) throw new SocialError("explore_refreshed", 409);
    if (read.after === null) throw new SocialError("invalid_request", 400, "That page cursor is not valid.");
  }
  // Before the first round there is no ranking to read and no time to show.
  if (!read.ranking) return { items: [], nextCursor: null, computedAt: null, signInForMore: false };
  const rows = read.rows.slice(0, limit);
  // A ranking holds posts, never reposts; the ranking's time stands in for the sort time, which a post item never shows.
  const views = await postViews(
    deps,
    viewer,
    rows.map((row) => ({ postId: row.postId, sortAt: read.ranking!.asOf, reposterId: null })),
  );
  const last = rows.at(-1);
  return {
    items: views.map((post) => ({ kind: "post" as const, post })),
    // Signed in, a full page may be followed by more; the cursor names the ranking and the last post read, never a position.
    nextCursor: viewer && last && rows.length === limit ? encodeExploreCursor({ g: read.ranking.generation, id: last.postId }) : null,
    computedAt: read.ranking.asOf.toISOString(),
    signInForMore: viewer === null && read.rows.length > limit,
  };
}

/**
 * Why one of the author's own posts is in Explore or not (2c design, section 8), without any count: anyone else, and a
 * post that does not exist, get not_found. The reasons are tried in the design's order, the first that applies answering;
 * the last four come from one bounded statement about this post alone, which applies every rule of the ranking as of the
 * request time (the standing of engagement included) and again as of the ranking's time. `formula` is the published one
 * unless a test ranks and judges with another; one of any version but 2 throws (3e design, section 7.13).
 *
 * 3e (section 7.13 item 7): `suspended` follows not_visible, judged at the database's clock as the page and the chip
 * judge it; the window counts from when moderation last gave the post back its time; a post restored after the ranking's
 * time is pending, since that ranking could not see it; and while the newest ranking is of another formula version only
 * the request time is judged.
 */
export async function exploreStatus(deps: SocialDeps, viewer: string, postId: string, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreStatus> {
  const now = deps.now();
  const facts = await deps.repo.exploreFacts(postId, now, formula);
  if (!facts || facts.authorId !== viewer) throw new SocialError("not_found", 404);
  const { ranking } = facts;
  const answer = (status: ExploreStatusKind): ExploreStatus => ({ status, computedAt: ranking ? ranking.asOf.toISOString() : null });
  // Replies and quotes never enter.
  if (facts.reply) return answer("reply");
  if (facts.quote) return answer("quote");
  // Withheld, removed or deleted: out for every reader, its author too.
  if (!facts.visible) return answer("not_visible");
  // The author's account is suspended now: its posts are out of the page and the chip at this read, listed or not.
  if (facts.suspended) return answer("suspended");
  if (!facts.shown) return answer("hidden_by_author");
  // A listed post stays listed until the next round, even past its window.
  if (ranking?.holdsPost) return answer("listed");
  if (facts.outsideWindow) return answer("outside_window");
  if (!ranking) return answer("no_ranking");
  if (ranking.postIsNewer) return answer("new_since_ranking");
  // Moderation gave the post back after the ranking was computed, which therefore never saw it: the next refresh considers it.
  if (ranking.restoredSince) return answer("pending");
  const judged = await deps.repo.exploreJudgement({ id: postId, authorId: facts.authorId }, now, ranking, formula);
  if (!judged.metNow) return answer("below_threshold");
  // Met now but not at the ranking's time, or the ranking applied another version's rules, which are not judged: the
  // next refresh considers it.
  if (judged.metAtRanking !== true) return answer("pending");
  // The cap keeps an author's best posts: with the author's places full, this one scored below them, and no score is needed to say so.
  if (judged.authorPlaces >= formula.perAuthor) return answer("author_cap");
  if (judged.places >= formula.listLength) return answer("below_cutoff");
  // Met at the ranking's time but left out then for a cause that has since gone, such as the switch turned back on.
  return answer("pending");
}

/**
 * "Show my posts in Explore", on or off (2c design, section 8). Off takes the account's posts out of Explore at the next
 * read; on lets the posts a round left out back in at the next round. Only the global request limit applies and no event
 * is recorded; the answer is the switch as it now stands, so turning it twice is turning it once.
 */
export async function setShowInExplore(deps: SocialDeps, viewer: string, on: boolean): Promise<ExploreSettingResponse> {
  if (!(await deps.repo.setShowInExplore(viewer, on))) throw new SocialError("not_found", 404);
  return { showInExplore: on };
}
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { handleRefusal, isUniqueViolation } from "../auth";
import { WRITE_CLOCK, liveNotSuspended, reportsRestrictedAt, suspendedAt } from "../lib/standing";
import { SocialError } from "./context";
import type { Cursor, ExploreCursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" | "handle_retired" | "handle_reserved" | "account_suspended" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

/** One row of an Explore page: the post, and its place in the ranking, which orders the page and is never answered. */
export interface ExploreRow {
  postId: string;
  position: number;
}

/**
 * What one statement found for a page of Explore: the current generation (null before the first round); the ranking
 * read, the cursor's or else the current one, with its time, when it is kept (null otherwise); the position of the
 * cursor's post in that ranking (null when the ranking does not hold it; 0 without a cursor); and the rows after that
 * position that pass the page's filters, in order, at most the limit asked for.
 */
export interface ExplorePageRead {
  current: number | null;
  ranking: { generation: number; asOf: Date } | null;
  after: number | null;
  rows: ExploreRow[];
}

/**
 * What the author's status needs to know about one post before any judgement: who wrote it, whether it is a reply or a
 * quote, whether it is visible, whether its author is suspended now (3e), whether its author shows in Explore, whether
 * its window has passed at the request time, and the current ranking, if there is one, with its time, its formula's
 * version, whether it holds the post, whether the post was written after it and whether moderation gave the post back
 * after it (3e).
 */
export interface ExploreFacts {
  authorId: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outsideWindow: boolean;
  ranking: { generation: number; asOf: Date; formula: number; holdsPost: boolean; postIsNewer: boolean; restoredSince: boolean } | null;
}

/**
 * The status's judgement of one post: whether it meets every rule of the formula as of the request time and as of the
 * ranking's time (null when the ranking was computed under another version of the formula, whose rules are not judged),
 * and how many places the ranking gives the post's author and holds in all.
 */
export interface ExploreJudgement {
  metNow: boolean;
  metAtRanking: boolean | null;
  authorPlaces: number;
  places: number;
}

/**
 * The modes a profile row is locked in for a moderation case: a decision's on its subject (3e: `update` when it takes or
 * may start a suspension or a termination, section 5's lock order; `no key update` otherwise), and a report's on its sender.
 */
export type AccountLockMode = "update" | "no key update" | "key share";

/** One row lockAccounts locked: whether its account is deleted, and, read in the same statement by the clock, suspended and restricted in its reports. */
export interface LockedAccount {
  id: string;
  deleted: boolean;
  suspended: boolean;
  reportsRestricted: boolean;
}

/** A post as a case's evidence copies it. `body` is empty when the post's content was erased (`erased`). */
export interface CapturedPost {
  id: string;
  authorId: string;
  authorHandle: string;
  body: string;
  state: StoredPostState;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  erased: boolean;
}

/** An account's profile fields as a case's evidence copies them. */
export interface CapturedProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  deleted: boolean;
}

interface RawCapturedPost {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  state: StoredPostState;
  created_at: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  erased: boolean;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A row of the Explore page statement: the page's facts on every row, and a post on each row but a lone one for an empty page. */
interface RawExplorePage {
  current: number | null;
  generation: number | null;
  as_of: string | null;
  after: number | null;
  post_id: string | null;
  position: number | null;
}

interface RawExploreFacts {
  author_id: string;
  reply: boolean;
  quote: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outside_window: boolean;
  generation: number | null;
  as_of: string | null;
  formula: number | null;
  holds_post: boolean;
  newer: boolean | null;
  restored: boolean;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_COLUMNS = sql`id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at`;
const PROFILE_SELECT = sql`select ${PROFILE_COLUMNS} from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

/** Durations built in SQL from the formula's numbers, so each number travels as a parameter. */
const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;

/** The one version of the Explore formula whose rules exploreRules writes (3e design, section 7.13). */
const EXPLORE_RULES_VERSION = 2;

/**
 * The time Explore's reads (the page, the chip and the author's status) judge an author's suspension by (3e design,
 * section 7.13 item 6): the database's clock when the statement reads, the same clock a write is judged by. A round
 * judges by its own time instead (exploreRules).
 */
const READ_CLOCK = WRITE_CLOCK;

/**
 * The rules of one Explore formula as of one time (2c design, section 7; 3e design, section 7.13: version 2), as SQL
 * fragments. The refresh ranks with them and the author's status judges one post with them, so the two cannot disagree;
 * the time and every number of the formula travel as parameters. `post` narrows the candidates and the engagement to one
 * post, which the status reads through that post's own indexes; the rules are the same either way. A formula of any
 * other version throws here, before any SQL, so no ranking is stored under a version whose rules were not applied.
 *
 * Version 2's two rules: an account suspended at the time `asOf` (the round's own time, never the clock) is neither a
 * candidate's author nor an engager, by the one predicate of lib/standing.ts applied to rows the round only reads; and a
 * post's window and age count from coalesce(explore_from, created_at), its `starts_at`, where explore_from is created_at
 * plus every span moderation kept the post hidden, which the database's moderation_apply alone writes.
 */
function exploreRules(asOf: Date, formula: ExploreFormula) {
  if (formula.version !== EXPLORE_RULES_VERSION) {
    throw new Error(`Explore's round applies the rules of formula version ${EXPLORE_RULES_VERSION} only, not version ${formula.version}`);
  }
  const at = sql`${asOf.toISOString()}::timestamptz`;
  // A candidate is younger than the window, and only engagement inside the window counts.
  const since = sql`${at} - ${hours(formula.windowHours)}`;
  // Engagement counts once it has stood this long, so a like made just before a round and undone after it never counts.
  const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
  const onePost = (column: SQL, post?: string): SQL => (post ? sql` and ${column} = ${post}::uuid` : sql.empty());
  /**
   * The one candidate predicate: visible top-level posts that are not quotes, by authors who are live and not suspended
   * at the time and have not switched Explore off, whose starts_at lies in the window up to the time. The window test is
   * written in two arms so that each uses its own index: a post never given back its time by its created_at, a restored
   * one by its explore_from (a partial index holds only those). Later rules about imports belong here.
   */
  const candidates = (post?: string): SQL => sql`
    select p.id, p.author_id, coalesce(p.explore_from, p.created_at) as starts_at from posts p join profiles a on a.id = p.author_id
    where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible'
      and ((p.explore_from is null and p.created_at > ${since} and p.created_at <= ${at}) or (p.explore_from > ${since} and p.explore_from <= ${at}))
      and ${liveNotSuspended("a", at)} and a.show_in_explore${onePost(sql`p.id`, post)}`;
  /**
   * The engagement that counts, read from the candidates `c`: likes and reposts in the window that have stood long enough,
   * by accounts other than the author that are live and not suspended at the time and were old enough when they engaged.
   * The engager is judged at the round, never at the time of the like: a ring's earlier likes stop counting at once.
   */
  const engagement = (post?: string): SQL => sql`
    select x.post_id, x.user_id from (
      select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
      union all
      select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
    ) x
    join c on c.id = x.post_id
    join profiles u on u.id = x.user_id
    where x.user_id <> c.author_id and ${liveNotSuspended("u", at)} and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}`;
  /** The approving accounts per post, read from the engagement `e`: each counted once however it engaged, for the posts that reach the threshold. */
  const approvers = sql`select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}`;
  return {
    at,
    since,
    candidates,
    engagement,
    approvers,
    /**
     * Whether `post` is a candidate that reaches the threshold: the three fragments as the CTEs c, e and ap of a subquery
     * of their own, so one statement can ask at two times.
     */
    met: (post: string): SQL => sql`exists (with c as (${candidates(post)}), e as (${engagement(post)}), ap as (${approvers}) select 1 from ap)`,
  };
}

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive). 3e (design, section 5, the lock order, item 2): the
     * author's row is taken in its own statement, FOR NO KEY UPDATE when its post counter will change (a post or a quote)
     * and FOR KEY SHARE for a reply, with the one predicate on it (account_suspended); the other author's row FOR KEY
     * SHARE: those two modes never wait for each other. A post that both replies and quotes writes two
     * other posts' counters: their rows are taken first, in id order, the order in which a report takes the posts it
     * copies (3c design, section 2, Lock order), so the new post never holds one of them while it waits for the other.
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockActing(tx, input.authorId, input.replyToId ? "key share" : "no key update");
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        if (input.replyToId && input.quoteOfId) await lockPostsInOrder(tx, [input.replyToId, input.quoteOfId]);
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /**
     * Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to
     * delete. `within` runs in the same transaction. The author's profile row is taken first, in the mode the counter
     * update below needs: a decision about the author holds that row before it takes the post, so a deletion that took
     * the post first and the profile second would deadlock with it, and one that takes the profile first waits its turn.
     * Then every post this transaction writes is taken, in id order, before any is written: the post itself and the post
     * it replies to or quotes, whose counter goes down. A report takes the posts it copies for share in that order (3c
     * design, section 2, Lock order), and one of child sexual abuse material about a quoting post reaches the quoted post
     * by itself: a deletion that wrote its own post first and then asked for a quoted post with a lower id would hold
     * what that report asks for next while it waits for what the report holds. The two ids never change, so a plain read
     * names the right rows; only the author's own post is read, so nobody else's request locks anything here.
     */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${authorId}::uuid for no key update`);
        const [own] = (await tx.execute(sql`select reply_to_id, quote_of_id from posts where id = ${id}::uuid and author_id = ${authorId}::uuid`)) as unknown as {
          reply_to_id: string | null;
          quote_of_id: string | null;
        }[];
        if (!own) return false;
        await lockPostsInOrder(tx, [id, own.reply_to_id, own.quote_of_id]);
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     * 3e: the liker is the acting account, refused account_suspended while its suspension runs; the author need only be live.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it. 3e (design, section 5, the lock order, item 2):
     * both rows are taken FOR NO KEY UPDATE, the mode the counter updates need, in one statement ordered by id, before
     * the insert; the follower is the acting account and is refused account_suspended while its suspension runs.
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockPair(tx, followerId, followeeId, followerId);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    /**
     * 3e (design, section 5, the lock order, item 2): both profile rows FOR NO KEY UPDATE in one statement ordered by id,
     * as a follow takes them, before the delete writes their counters. Withdrawing a follow is open to a suspended account.
     */
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockPair(tx, followerId, followeeId, null);
        return removeFollow(tx, followerId, followeeId);
      });
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking of its formula's version is younger than the
     * formula's minimum gap, so at most one ranking lands per interval however many instances run the job or restart. The
     * newest `kept` rankings stay, so a reader paging through the one before the current one can finish; older ones go
     * with their items. A formula of a version other than 2 throws before the transaction (exploreRules).
     *
     * The statement's CTEs: `c` the candidates, `e` the engagement that counts and `ap` the approving accounts per post
     * reaching the threshold, all three the shared rules of `exploreRules`, which the author's status judges with too; `s`
     * the score, approvers over (hours since the post's window started, never negative, + offset) ^ gravity, the window
     * starting at `starts_at` (3e: when moderation last gave the post back its time, else when it was posted); `r` each author's posts numbered
     * by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts within the
     * per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id; `ins` the
     * items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreRefresh> {
      const started = performance.now();
      const rules = exploreRules(asOf, formula);
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        // Only a ranking of this formula's version counts (3e design, section 7.13 item 5), so the first round after a
        // change of version ranks at once rather than leave the old rules' ranking up for another gap.
        const [recent] = (await tx.execute(
          sql`select exists (select 1 from explore_runs where as_of > ${rules.at} - ${minutes(formula.minGapMinutes)} and formula = ${formula.version}) as fresh`,
        )) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${rules.at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (${rules.candidates()}),
          e as (${rules.engagement()}),
          ap as (${rules.approvers}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${rules.at} - c.starts_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
    },

    /**
     * A page of Explore (2c design, section 8), read by one statement, so a round that prunes a ranking between the checks
     * and the page cannot turn one answer into another: the current generation; the ranking read (the cursor's, or else
     * the current one) when it is kept, with its time; the position of the cursor's post in it; and after that position,
     * in order, the items whose post is visible (for every reader, its author too), whose author is live, not suspended
     * when the page is read (3e: by the database's clock, so a suspended author's posts leave at the next read and come
     * back with the next round once the suspension ends) and shows in Explore, and, for a signed-in reader, with no block
     * either way between reader and author and no mute of the author.
     * The filters come before the limit, so a page is full whenever the ranking holds that many posts the reader may see.
     * The statement answers one row per post, or a lone row without one for an empty page; the flow decides what a missing
     * ranking or post means.
     */
    async explorePage(viewer: string | null, cursor: ExploreCursor | undefined, limit: number): Promise<ExplorePageRead> {
      const raw = await rows<RawExplorePage>(sql`
        with cur as (select max(generation) as generation from explore_runs),
        run as (select generation, as_of from explore_runs where generation = ${cursor ? sql`${cursor.g}::int` : sql`(select generation from cur)`}),
        pos as (${cursor ? sql`select position from explore_items where generation = ${cursor.g}::int and post_id = ${cursor.id}::uuid` : sql`select 0 as position`}),
        page as (
          select i.post_id, i.position from explore_items i join posts p on p.id = i.post_id join profiles a on a.id = p.author_id
          where i.generation = (select generation from run) and i.position > (select position from pos)
            and p.state = 'visible' and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore and ${viewer ? otherWelcome(viewer, sql`p.author_id`) : sql`true`}
          order by i.position limit ${limit}
        )
        select cur.generation as current, run.generation, ${iso("run.as_of")} as as_of, pos.position as after, page.post_id, page.position
        from cur left join run on true left join pos on true left join page on true
        order by page.position`);
      const head = raw[0]!;
      return {
        current: head.current,
        ranking: head.generation === null ? null : { generation: head.generation, asOf: new Date(head.as_of!) },
        after: head.after,
        rows: raw.filter((row) => row.post_id !== null).map((row) => ({ postId: row.post_id!, position: row.position! })),
      };
    },

    /**
     * What the author's status needs about one post before any judgement (2c design, section 8), as of `now`: the window is
     * the formula's, through the same rules the refresh ranks with, and counts from the post's starts_at (3e: when
     * moderation last gave it back its time, else when it was posted). Whether the author is suspended is read at the
     * database's clock, as the page and the chip read it, so the status says why the post is not shown now. The ranking
     * comes with its formula's version and whether the post was restored after it. Null when there is no such post.
     */
    async exploreFacts(postId: string, now: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreFacts | null> {
      const rules = exploreRules(now, formula);
      const [r] = await rows<RawExploreFacts>(sql`
        with run as (select generation, as_of, formula from explore_runs order by generation desc limit 1)
        select p.author_id, p.reply_to_id is not null as reply, p.quote_of_id is not null as quote, p.state = 'visible' as visible,
          ${suspendedAt("a", READ_CLOCK)} as suspended, a.show_in_explore as shown, coalesce(p.explore_from, p.created_at) <= ${rules.since} as outside_window,
          run.generation, ${iso("run.as_of")} as as_of, run.formula, p.created_at > run.as_of as newer, coalesce(p.restored_at > run.as_of, false) as restored,
          exists (select 1 from explore_items i where i.generation = run.generation and i.post_id = p.id) as holds_post
        from posts p join profiles a on a.id = p.author_id left join run on true
        where p.id = ${postId}::uuid`);
      if (!r) return null;
      return {
        authorId: r.author_id,
        reply: r.reply,
        quote: r.quote,
        visible: r.visible,
        suspended: r.suspended,
        shown: r.shown,
        outsideWindow: r.outside_window,
        ranking:
          r.generation === null
            ? null
            : { generation: r.generation, asOf: new Date(r.as_of!), formula: r.formula!, holdsPost: r.holds_post, postIsNewer: r.newer!, restoredSince: r.restored },
      };
    },

    /**
     * The status's judgement of one post, from one statement about that post alone and never a ranking: whether it meets
     * every rule of the formula (the candidate predicate, the engagement that counts, the threshold) as of `now` and again
     * as of the ranking's time, through the very fragments the refresh ranks with, and how many places the ranking gives
     * the post's author and holds in all. Each count reads at most the ranking's items. A ranking computed under another
     * version of the formula applied other rules, so only `now` is judged then: metAtRanking is null (3e design, section
     * 7.13 item 7).
     */
    async exploreJudgement(
      post: { id: string; authorId: string },
      now: Date,
      ranking: { generation: number; asOf: Date; formula: number },
      formula: ExploreFormula = EXPLORE_V2,
    ): Promise<ExploreJudgement> {
      const sameRules = ranking.formula === formula.version;
      const [r] = await rows<{ met_now: boolean; met_at_ranking: boolean | null; author_places: number; places: number }>(sql`
        select ${exploreRules(now, formula).met(post.id)} as met_now, ${sameRules ? exploreRules(ranking.asOf, formula).met(post.id) : sql`null::boolean`} as met_at_ranking,
          (select count(*) from explore_items where generation = ${ranking.generation}::int and author_id = ${post.authorId}::uuid)::int as author_places,
          (select count(*) from explore_items where generation = ${ranking.generation}::int)::int as places`);
      return { metNow: r!.met_now, metAtRanking: r!.met_at_ranking, authorPlaces: r!.author_places, places: r!.places };
    },

    /**
     * Of the viewer's own posts given, those the current Explore ranking holds while the viewer's switch is on and the
     * viewer is not suspended when this reads (3e: by the database's clock, as the page reads it): with the visible posts
     * only, which the caller passes, exactly those whose status would be listed, and so the posts that carry the author's
     * chip. One statement for any number of posts.
     */
    async listedInExplore(viewer: string, postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) return new Set();
      const raw = await rows<{ post_id: string }>(sql`
        select i.post_id from explore_items i join profiles a on a.id = i.author_id
        where i.generation = (select max(generation) from explore_runs) and i.post_id = any(${uuidArray(postIds)})
          and i.author_id = ${viewer}::uuid and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore`);
      return new Set(raw.map((r) => r.post_id));
    },

    /** Turns "Show my posts in Explore" on or off. False when there is no such live profile. */
    async setShowInExplore(id: string, on: boolean): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ showInExplore: on })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row, its Explore switch (the owner's, which the profile row the public
     * reads leaves out), and every handle in handle_history for it, in the order they were recorded, with the time korbat
     * retired one that is still retired (3e). Null when there is no live profile. The lists come page by page from the
     * reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; showInExplore: boolean; handleHistory: string[]; retiredHandles: { handle: string; retiredAt: Date }[] } | null> {
      const [r] = await rows<RawProfile & { show_in_explore: boolean }>(sql`select ${PROFILE_COLUMNS}, show_in_explore from profiles where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string; retired_at: string | null }>(
        sql`select handle_lower, ${iso("retired_at")} as retired_at from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`,
      );
      return {
        profile: toProfile(r),
        showInExplore: r.show_in_explore,
        handleHistory: history.map((row) => row.handle_lower),
        retiredHandles: history.flatMap((row) => (row.retired_at === null ? [] : [{ handle: row.handle_lower, retiredAt: new Date(row.retired_at) }])),
      };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /**
     * Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile, and
     * (3e, section 7.2) while its suspension runs: the predicate is part of the update's own WHERE, so the update decides.
     */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), liveNotSuspended("profiles", WRITE_CLOCK)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     *
     * 3e (design, section 7.10): a handle korbat retired is nobody's, its former holder's included, so the claim answers
     * handle_retired before it asks whether the handle is free; a handle of the account's own history counts as free
     * only while it is not retired. The database's guard of handles refuses the same, and a placeholder's form, to a
     * change that lost a race with a retirement or skipped the handle rule; its code is answered alike. The locking
     * statement also answers whether the account's suspension runs (3e, section 7.2), and then nothing is written.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(
            sql`select handle, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${id}::uuid and deleted_at is null for update`,
          )) as unknown as { handle: string; suspended: boolean }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.suspended) return { ok: false, reason: "account_suspended" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from handle_history where handle_lower = ${to} and retired_at is not null) as retired,
                   exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
                     or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { retired: boolean; taken: boolean }[];
          if (claim!.retired) return { ok: false, reason: "handle_retired" };
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        const guarded = handleRefusal(err);
        if (guarded !== null) return { ok: false, reason: guarded };
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ what moderation cases read

    /**
     * Locks these profile rows for the rest of the transaction, in one statement and in id order, so two transactions
     * that lock several accounts never take them in opposite orders. `no key update` is what a decision takes on its
     * subject: two decisions about one account then run one after the other, while the likes and follows of others,
     * which take `key share`, never wait for it. `key share` is what a report takes on its sender. It answers each row
     * found with whether its account is deleted; with `live`, a missing or deleted account is refused (not_found).
     *
     * 3e (design, sections 5 and 7.2): `update` is what a decision takes on its subject when it holds a suspension or a
     * termination, the mode the ledger's trigger takes again: left at `no key update`, the trigger's lock would be an
     * upgrade behind the case's lock, which deadlocks with followers' counter updates. Each row's answer also says whether
     * the account is suspended and whether its reports are restricted, read in the locking statement by the clock, which
     * is what the intake judges a report's sender by.
     */
    async lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live = false): Promise<LockedAccount[]> {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      // The mode is one of three literals of this file, never input.
      const found = (await tx.execute(
        sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended, ${reportsRestrictedAt("profiles", WRITE_CLOCK)} as reports_restricted
              from profiles where id = any(${uuidArray(wanted)}) order by id for ${sql.raw(mode)}`,
      )) as unknown as { id: string; deleted: boolean; suspended: boolean; reports_restricted: boolean }[];
      if (live && (found.length !== wanted.length || found.some((row) => row.deleted))) throw new SocialError("not_found", 404);
      return found.map((row) => ({ id: row.id, deleted: row.deleted, suspended: row.suspended, reportsRestricted: row.reports_restricted }));
    },

    /**
     * A post as a case's evidence copies it, or null when no row has the id: the row is locked `for share`, so the
     * author's deletion comes after the copy or has left its tombstone before it. A post whose content was erased is
     * answered with an empty body, so no copy holds erased text.
     */
    async capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null> {
      const [row] = (await tx.execute(sql`
        select p.id, p.author_id, a.handle as author_handle, p.body, p.state, ${iso("p.created_at")} as created_at, p.reply_to_id, p.quote_of_id,
               p.erased_at is not null as erased
        from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid for share of p`)) as unknown as RawCapturedPost[];
      if (!row) return null;
      return {
        id: row.id,
        authorId: row.author_id,
        authorHandle: row.author_handle,
        body: row.erased ? "" : row.body,
        state: row.state,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        erased: row.erased,
      };
    },

    /** An account's handle, display name and bio as a case's evidence copies them, with whether it is deleted; null when no row has the id. */
    async captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null> {
      const [row] = (await tx.execute(
        sql`select id, handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
      )) as unknown as { id: string; handle: string; display_name: string; bio: string; deleted: boolean }[];
      return row ? { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
    },

    /**
     * The account a handle names, for a report. Without `withDeleted`, only a live profile that holds the handle now: an
     * old handle names nothing, as everywhere else. With it, for a report of child sexual abuse material, also a deleted
     * profile (the purge keeps the handle on the row) and, for a handle no profile holds now, the profile that
     * handle_history records for it: a handle an account has left stays reserved for that account, so it names that
     * account and nobody else.
     */
    async findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null> {
      const lower = handle.toLowerCase();
      const [holder] = await rows<{ id: string; deleted: boolean }>(
        sql`select id, deleted_at is not null as deleted from profiles where lower(handle) = ${lower} and (${withDeleted}::boolean or deleted_at is null)`,
      );
      if (holder || !withDeleted) return holder ? { id: holder.id, deleted: holder.deleted } : null;
      const [former] = await rows<{ id: string; deleted: boolean }>(
        sql`select p.id, p.deleted_at is not null as deleted from handle_history h join profiles p on p.id = h.profile_id where h.handle_lower = ${lower}`,
      );
      return former ? { id: former.id, deleted: former.deleted } : null;
    },

    /** Who wrote a post, or null when no row has the id. */
    async postAuthor(postId: string): Promise<string | null> {
      const [row] = await rows<{ author_id: string }>(sql`select author_id from posts where id = ${postId}::uuid`);
      return row?.author_id ?? null;
    },

    /** A post's author, its state and the post it quotes, or null when no row has the id. Nothing is locked. */
    async postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null> {
      const [row] = await rows<{ author_id: string; state: StoredPostState; quote_of_id: string | null }>(
        sql`select author_id, state, quote_of_id from posts where id = ${postId}::uuid`,
      );
      return row ? { authorId: row.author_id, state: row.state, quoteOfId: row.quote_of_id } : null;
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, as its last act, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would). After the profile row come the row locks of every post of the account, in id order,
     * before any post is written (3c design, section 7.10): a report that holds two of them holds them in that
     * order. What stays unordered are the counters of other accounts' posts that this account replied to, quoted,
     * liked or reposted, which are written after.
     *
     * 3e (design, section 5, the lock order, item 3): right after its own row, the purge takes the rows of every account
     * whose counter it will write (those it follows and its followers) FOR NO KEY UPDATE, in id order, before any post.
     * With the posts first, a decision holding its subject FOR UPDATE, a third account's reply and a follower's purge
     * formed a cycle. An unfollow, a second follow or a quote between the purged account and its own counterparts can
     * still cross it; PostgreSQL detects that, the flows of follow, unfollow and createPost try once more, and the purge
     * is tried again by its job's next round.
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        await tx.execute(sql`
          select p.id from profiles p
           where p.id <> ${id}::uuid
             and p.id in (select followee_id from follows where follower_id = ${id}::uuid union select follower_id from follows where followee_id = ${id}::uuid)
           order by p.id for no key update`);
        // Every post of the account is locked first, in id order, before any of them is written. A report holds the posts it
        // copies for share in that order, and one about a post that quotes or replies to its author's own post holds two
        // posts of this account. The counter statements below write such a quoted or replied-to post, in their scan's
        // order, and the tombstones write the rest: with the locks taken here, in the report's order, the purge either
        // waits at the first post the report holds, holding none itself, or holds them all before the report asks. The
        // deleted posts are locked too: a live post may quote or reply to one, and its counter is written all the same.
        await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        // The tombstones. The rows are this transaction's already, and no post of the account can appear meanwhile: writing
        // one takes a shared lock on the profile row, which this transaction holds for update.
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
        // The media rows go last (3c design, section 7.10): they are the last rows this transaction locks, after every
        // post and profile row it takes, and the requests for their files, which cannot be rolled back, are written as
        // close to the commit as they can be.
        await within(tx);
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/**
 * Takes these posts' rows, in id order and in one statement, in the mode an update of a counter or of the state takes
 * them: what a transaction that writes more than one post does before it writes the first, so that every such
 * transaction and every report that copies the same posts (for share, in id order) meet at the lowest post they share,
 * where the one that comes second holds none of the others yet. An id no post has locks nothing.
 */
async function lockPostsInOrder(tx: Tx, ids: readonly (string | null)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return;
  await tx.execute(sql`select id from posts where id = any(${uuidArray(wanted)}) order by id for no key update`);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 *
 * 3e (design, section 7.2): `acting` is the account that writes (the engager of a like, a repost or a bookmark); the
 * locking statement answers for each row whether its suspension runs, and the write is refused account_suspended when the
 * acting account's does. Any other row need only be live. A block and a mute name no acting account: both stay open.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found", acting: string | null = null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where ${accounts} for key share`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (found.some((row) => row.deleted)) throw new SocialError(code, code === "not_found" ? 404 : 400);
  if (acting !== null && found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
}

/**
 * The author's own row for a new post, in its own statement and in the mode its counter needs (3e design, section 5, the
 * lock order, item 2), with the predicate on it: a deleted author is refused not_found, a suspended one account_suspended.
 */
async function lockActing(tx: Tx, accountId: string, mode: "no key update" | "key share"): Promise<void> {
  // The mode is one of two literals of this file, never input.
  const [row] = (await tx.execute(
    sql`select deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${accountId}::uuid for ${sql.raw(mode)}`,
  )) as unknown as { deleted: boolean; suspended: boolean }[];
  if (!row || row.deleted) throw new SocialError("not_found", 404);
  if (row.suspended) throw new SocialError("account_suspended", 403);
}

/**
 * Both profile rows of a follow or an unfollow FOR NO KEY UPDATE, the mode their counter updates take, in one statement
 * ordered by id (3e design, section 5, the lock order, item 2). A deleted row is refused not_found when `acting` is given
 * (a follow), and the acting account's running suspension account_suspended; an unfollow refuses neither.
 */
async function lockPair(tx: Tx, a: string, b: string, acting: string | null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id in (${a}::uuid, ${b}::uuid) order by id for no key update`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (acting === null) return;
  if (found.some((row) => row.deleted)) throw new SocialError("not_found", 404);
  if (found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, HiddenMedia, MediaView, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { PostImage } from "../media";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, their images through the media module, and the chip's facts through the moderation module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media" | "moderation">;

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

export function authorOf(profile: ProfileRow): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified };
}

/**
 * One image of a post as this viewer gets it (3c design, section 7.10). A visible image is the image. A withheld or
 * removed one stays with its author, who gets it with that state; anyone else gets a placeholder in its place, the same
 * for both states, with nothing of the image in it. A sealed image is that placeholder for every viewer, its author
 * included, who alone is told that it is sealed.
 */
export function mediaFor(viewer: ViewerId, authorId: string, image: PostImage): MediaView | HiddenMedia {
  const own = viewer !== null && viewer === authorId;
  if (image.state === "sealed") return own ? { id: image.id, hidden: true, sealed: true } : { id: image.id, hidden: true };
  const { state, ...view } = image;
  if (state === "visible") return view;
  return own ? { ...view, moderation: state } : { id: image.id, hidden: true };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state, and every post's images, each as this viewer gets it
 * (mediaFor). Ids that resolve to nothing become tombstones, and tombstones carry no images. The
 * viewer's own visible posts that the current Explore ranking holds, while their switch is on, carry
 * the author's chip (2c design, section 8):
 * asked in one query, and only when the viewer wrote some of the posts; a quoted embed never carries it.
 * The viewer's own withheld and removed posts carry the decision behind their state (3c design, section 7.6), which the
 * moderation module names: asked the same way, once for the page and only when the viewer wrote such a post.
 */
export async function loadPostViews({ repo, media, moderation }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].flatMap((row) => (row.replyToAuthorId ? [row.authorId, row.replyToAuthorId] : [row.authorId])))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);
  // A withheld or removed post is never in Explore for anyone, its author included, so only visible ones are asked about.
  // Whether the author is suspended when this reads is listedInExplore's to judge (3e), so the chip goes with the page.
  const own = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && row.state === "visible").map((row) => row.id) : [];
  const inExplore = viewer && own.length > 0 ? await repo.listedInExplore(viewer, own) : new Set<string>();
  // The chip of a withheld or removed post is its author's alone, so only the viewer's own such posts are asked about.
  const restricted = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && (row.state === "withheld" || row.state === "removed")).map((row) => row.id) : [];
  const decisions = viewer && moderation && restricted.length > 0 ? await moderation.authorFacts(viewer, restricted) : null;

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  /** The parent's handle only when the viewer could open the parent; a block either way, or a hidden or deleted parent, gives null. */
  const parentHandle = (row: PostRow): string | null =>
    row.replyToAuthorId && row.replyToState && postAccess(viewer, { authorId: row.replyToAuthorId, state: row.replyToState }, blocked.has(row.replyToAuthorId)) === "shown"
      ? row.replyToHandle
      : null;
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: parentHandle(row) } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    media: (images.get(row.id) ?? []).map((image) => mediaFor(viewer, row.authorId, image)),
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    return a === "shown" ? { ...base(row), quoteOf: null } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    const decision = decisions?.get(id);
    out.set(id, a === "shown" ? { ...base(row), ...(inExplore.has(id) ? { inExplore: true as const } : {}), ...(decision ? { moderation: decision } : {}), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(source: ViewSource, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(source, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  const reposters = await source.repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
```

### Replace `apps/app/src/app/explore/about.tsx` (whole file)

```tsx
import { ScrollView, Text, View } from "react-native";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { TextLink } from "@/components/ui";
import { exploreRules } from "@/lib/explore";

/**
 * Every rule of a formula with its numbers, then its version and dated change log. The page shows EXPLORE_V2, the
 * constant the refresh ranks with, so the published rules are the ones in force; tests pass other formulas.
 */
export function ExploreRules({ formula = EXPLORE_V2 }: { formula?: ExploreFormula }) {
  return (
    <View>
      {exploreRules(formula).map((section) => (
        <View key={section.title} className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
            {section.title}
          </Text>
          <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
        </View>
      ))}
      <View className="mt-8">
        <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
          Version and changes
        </Text>
        <Text className="mt-2 text-base leading-7 text-zinc-300">{`This is version ${formula.version} of the formula.`}</Text>
        {formula.changes.map((change) => (
          <Text key={change.version} className="mt-2 text-base leading-7 text-zinc-300">
            {`Version ${change.version}, ${change.date}: ${change.summary}`}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** How Explore works (2c design, section 11): public, so anyone can hold the order Explore shows to its published rules. */
export default function ExploreAbout() {
  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          How Explore works
        </Text>
        <Text className="mt-2 text-base leading-6 text-zinc-400">
          Explore lists recent posts that other accounts approve of, in an order anyone can check: these are all of its rules and numbers.
        </Text>
        <ExploreRules />
        <TextLink label="Back to Explore" href="/?tab=explore" />
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/social/ExploreList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { EXPLORE_V2, type ExploreFormula } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { EXPLORE_REFRESHED_NOTICE, exploreEmptyText, exploreReader, NOTHING_SHOWN, rankingAge, type ExploreShown, type RankingRead } from "@/lib/explore";
import { social } from "@/lib/social";
import { PostCard } from "./PostCard";

/** Reads the clock again every minute, so "Updated N minutes ago" stays true while the screen is open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AboutLink() {
  return (
    <Link href="/explore/about" asChild>
      <Pressable className="py-1">
        <Text className="text-sm text-zinc-400 underline">How Explore works</Text>
      </Pressable>
    </Link>
  );
}

/**
 * Under the tabs: how long ago the ranking on screen was computed, or since when it had not been when it was read; once it
 * is as old as the refresh interval, Refresh, which reads the first page again (pull to refresh does so on a phone, but
 * nothing does on the web); and the link to its rules. The line can take the focus, which the list gives it after Refresh.
 */
export function ExploreHeader({ ranking, onRefresh, lineRef }: { ranking: RankingRead | null; onRefresh: () => void; lineRef?: Ref<View> }) {
  const now = useMinuteClock();
  // Before the first round there is no ranking, no time to show and nothing to read again.
  const age = ranking ? rankingAge(ranking, now) : null;
  return (
    <View className="flex-row flex-wrap items-center justify-between gap-x-4 border-b border-zinc-800 px-4 py-2">
      <View ref={lineRef} tabIndex={-1}>
        {age ? <Text className={`text-sm ${age.stale ? "text-amber-300" : "text-zinc-400"}`}>{age.text}</Text> : null}
      </View>
      <View className="flex-row items-center gap-x-4">
        {age?.offerRefresh ? (
          <Pressable accessibilityRole="button" onPress={onRefresh} className="rounded-lg border border-zinc-700 px-3 py-1">
            <Text className="text-sm text-zinc-200">Refresh</Text>
          </Pressable>
        ) : null}
        <AboutLink />
      </View>
    </View>
  );
}

/** An empty Explore (2c design, section 11): when a post appears there, in the formula's numbers, with the rules and a way on. */
export function ExploreEmpty({ onShowLatest, formula = EXPLORE_V2 }: { onShowLatest: () => void; formula?: ExploreFormula }) {
  return (
    <View className="items-center px-4 py-10">
      <Text className="mb-3 text-center text-base leading-6 text-zinc-400">{exploreEmptyText(formula)}</Text>
      <AboutLink />
      <Pressable accessibilityRole="button" onPress={onShowLatest} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
        <Text className="text-sm text-zinc-200">Show Latest</Text>
      </Pressable>
    </View>
  );
}

/**
 * The end of the list. The status line is always in the tree, so a screen reader hears the refresh notice when it
 * appears, and it can take the focus when Load more, which had it, leaves; then an error beside posts already shown, Load
 * more while the ranking has more, and, for a signed-out reader, who never gets a cursor, the way to see more.
 */
export function ExploreFooter({
  cursor,
  signInForMore,
  notice,
  error,
  onLoadMore,
  statusRef,
}: {
  cursor: string | null;
  signInForMore: boolean;
  notice: string | null;
  error: string | null;
  onLoadMore: () => void;
  statusRef?: Ref<View>;
}) {
  return (
    <View className="items-center py-4">
      <View ref={statusRef} role="status" aria-live="polite" tabIndex={-1}>
        {notice ? <Text className="mb-2 px-4 text-center text-sm text-zinc-300">{notice}</Text> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      {cursor ? (
        <Pressable accessibilityRole="button" onPress={onLoadMore} className="rounded-lg border border-zinc-700 px-4 py-2">
          <Text className="text-sm text-zinc-200">Load more</Text>
        </Pressable>
      ) : null}
      {signInForMore ? (
        <Link href="/signin" asChild>
          <Pressable className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Sign in to see more of Explore</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

/**
 * Explore under Home's tabs (2c design, section 11), on PagedList's pattern. Its reads go through one exploreReader made
 * with the list, which lets one read run at a time and answers what the list shows; the component only puts that on
 * screen. A cursor names the ranking it came from; when a refresh has pruned that ranking, the reader reads the current
 * one from its first page and adds only the posts not on screen, so the posts already read stay where they are, the focus
 * stays at the footer and the status line says what happened. Home remounts the list for another tab, a new post or
 * another reader. The answers live in this component and its reader alone: nothing keeps them once it unmounts.
 */
export function ExploreList({ onShowLatest }: { onShowLatest: () => void }) {
  const [reader] = useState(() => exploreReader(social.explore));
  const [shown, setShown] = useState<ExploreShown>(NOTHING_SHOWN);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [lineFocus, setLineFocus] = useState(0);
  const footer = useRef<View>(null);
  const line = useRef<View>(null);

  const load = useCallback(
    async (after?: string, focusLine = false) => {
      setNotice(null);
      try {
        const answer = await reader.load(after);
        // Another read is in flight: its answer, still to come, is what the list shows, and it ends the refresh.
        if (!answer) return;
        setShown(answer);
        setError(null);
        if (answer.refreshed) {
          setNotice(EXPLORE_REFRESHED_NOTICE);
          setRefreshes((count) => count + 1);
        }
        if (focusLine) setLineFocus((count) => count + 1);
      } catch (err) {
        setError(errorMessage(err));
      }
      setLoading(false);
      setRefreshing(false);
    },
    [reader],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Pull to refresh and the header's Refresh read the first page again, in place of the posts on screen.
  const refresh = (focusLine: boolean) => {
    setRefreshing(true);
    void load(undefined, focusLine);
  };

  // After a refresh the focus stays at the footer: Load more keeps it while the new ranking has more, and when the ranking
  // ended, Load more has left the tree with the focus, so the status line takes it.
  useEffect(() => {
    if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [refreshes]);

  // After the header's Refresh the line saying how old the ranking now is takes the focus: the button leaves the tree
  // once the ranking it read is fresh.
  useEffect(() => {
    if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [lineFocus]);

  const remove = (id: string) => setShown(reader.remove(id));

  return (
    <FlatList
      data={shown.items}
      keyExtractor={(item) => item.post.id}
      renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}
      ListHeaderComponent={<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />}
      refreshing={refreshing}
      onRefresh={() => refresh(false)}
      ListEmptyComponent={
        loading ? null : error ? (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole="alert" className="text-center text-base text-zinc-400">
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ExploreEmpty onShowLatest={onShowLatest} />
        )
      }
      ListFooterComponent={
        <ExploreFooter
          cursor={shown.cursor}
          signInForMore={shown.signInForMore}
          notice={notice}
          error={shown.items.length > 0 ? error : null}
          onLoadMore={() => {
            if (shown.cursor) void load(shown.cursor);
          }}
          statusRef={footer}
        />
      }
    />
  );
}
```

### Replace `apps/app/src/lib/explore.ts` (whole file)

```ts
import { EXPLORE_V2, type ExploreFormula, type ExplorePage, type ExploreStatusKind, type TimelineItem } from "@korbat/contracts";
import { ApiError } from "./api";
import type { ExploreAnswer } from "./social";

/**
 * Explore's texts and the list's decisions (2c design, section 11). Every number in a sentence comes from the formula it
 * is given, EXPLORE_V2 unless a test passes another, so the app says what the refresh does.
 */

/** A ranking older than this when it is read is stale: rounds run every 5 minutes, so by then several have failed or been skipped. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** What the list's status line says once the ranking being paged is gone and the posts below it come from the current one. */
export const EXPLORE_REFRESHED_NOTICE = "Explore was refreshed; the posts below come from the new ranking.";

/** A page of Explore is the API's default of 20 posts, and a ranking holds at most listLength: one read never needs more pages than this. */
export const MAX_PAGES = Math.ceil(EXPLORE_V2.listLength / 20) + 1;

/** "1 minute", "5 minutes". */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Hours as the texts say them: whole days in days ("2 days"), anything else in hours. */
function duration(hours: number): string {
  return hours > 0 && hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour");
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A small count as a sentence says it ("two of your posts"); anything larger stays in digits. */
function numberWord(count: number): string {
  return WORDS[count] ?? String(count);
}

/** When a stale ranking was computed: the time alone on the same day, the date and the time on any other. */
function since(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString()} ${time}`;
}

/**
 * The ranking on screen as the list read it: when it was computed, the Date header of the answer that carried it (the
 * server's clock then, or null when the answer had none) and the device's clock when that answer arrived.
 */
export interface RankingRead {
  computedAt: string;
  date: string | null;
  receivedAt: number;
}

/**
 * How old the ranking was when it was read: by the answer's Date header, the server's own clock, as the smoke test
 * measures it, so a device clock that is fast or slow changes nothing; by the device's clock only when the header is
 * missing. Never below zero: the header counts whole seconds, so a ranking of the same second would seem to be from the future.
 */
function ageAtRead(ranking: RankingRead): number {
  const served = ranking.date === null ? Number.NaN : Date.parse(ranking.date);
  return Math.max(0, (Number.isNaN(served) ? ranking.receivedAt : served) - Date.parse(ranking.computedAt));
}

/**
 * The line under the tabs, and whether to offer Refresh. Whether the ranking is stale is decided by its age when it was
 * read: past 15 minutes the line says since when Explore has not been updated, which the header shows as a warning. A page
 * left open never turns stale, since the job has written newer rankings meanwhile; its minutes go on from the age when
 * read by the time on screen, which the device's clock measures alone. Refresh is offered once the ranking on screen is
 * as old as the refresh interval, when a newer one should exist.
 */
export function rankingAge(ranking: RankingRead, now: number, formula: ExploreFormula = EXPLORE_V2): { stale: boolean; text: string; offerRefresh: boolean } {
  const atRead = ageAtRead(ranking);
  // The minute clock may last have ticked before the answer arrived: then there has been no time on screen yet.
  const age = atRead + Math.max(0, now - ranking.receivedAt);
  const offerRefresh = age >= formula.refreshMinutes * 60_000;
  if (atRead > STALE_AFTER_MS) return { stale: true, text: `Explore has not been updated since ${since(new Date(ranking.computedAt), new Date(now))}.`, offerRefresh };
  const minutes = Math.floor(age / 60_000);
  return { stale: false, text: minutes === 0 ? "Updated just now" : `Updated ${plural(minutes, "minute")} ago`, offerRefresh };
}

/**
 * What one page adds below the posts on screen: its posts not shown yet, in the ranking's order. Within one ranking the
 * pages never overlap, but after a refresh the new ranking holds posts already shown, and a page can also come back empty
 * when the reader's blocks and mutes took out every post on it. So the next page is read only while a page adds nothing
 * and a cursor follows it: the read stops at the first page that adds some, or at the ranking's end.
 */
export function appendUnseen(shown: ReadonlySet<string>, page: Pick<ExplorePage, "items" | "nextCursor">): { added: TimelineItem[]; nextCursor: string | null; fetchNext: boolean } {
  const seen = new Set(shown);
  const added = page.items.filter((item) => {
    if (seen.has(item.post.id)) return false;
    seen.add(item.post.id);
    return true;
  });
  return { added, nextCursor: page.nextCursor, fetchNext: added.length === 0 && page.nextCursor !== null };
}

export interface PagesRead<P extends ExplorePage = ExplorePage> {
  /** The posts to show below those on screen (or in their place, for a read from the first page), in the ranking's order. */
  added: TimelineItem[];
  /** Load more's cursor, null once the ranking has ended. */
  nextCursor: string | null;
  /** The last page read, whose computedAt and signInForMore the list shows; null only when no page came back. */
  last: P | null;
  /** The ranking being paged was gone (explore_refreshed), and what was added comes from the current one. */
  refreshed: boolean;
}

/**
 * One load of the list: pages from `after` on (the first page when it is undefined), as appendUnseen decides. A cursor
 * names the ranking it came from; when that ranking is no longer kept, the API refuses it with explore_refreshed and the
 * read starts again at the current ranking's first page, still skipping every post on screen, as section 11 of the design
 * says. Any other failure is the caller's to show, and one read never goes through more than `maxPages` pages. The pages
 * come back as `fetchPage` answers them, so the last one keeps whatever the client read with it.
 */
export async function readPages<P extends ExplorePage>(
  fetchPage: (cursor?: string) => Promise<P>,
  after: string | undefined,
  shown: ReadonlySet<string>,
  maxPages: number = MAX_PAGES,
): Promise<PagesRead<P>> {
  const seen = new Set(shown);
  const added: TimelineItem[] = [];
  let cursor = after;
  let last: P | null = null;
  let refreshed = false;
  for (let pages = 0; pages < maxPages; pages++) {
    let page: P;
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      // Only a cursor names a ranking: the first page is always the current one, so a refusal of it is an ordinary failure.
      if (cursor === undefined || !(err instanceof ApiError && err.code === "explore_refreshed")) throw err;
      refreshed = true;
      cursor = undefined;
      continue;
    }
    const step = appendUnseen(seen, page);
    for (const item of step.added) {
      seen.add(item.post.id);
      added.push(item);
    }
    last = page;
    if (!step.fetchNext) return { added, nextCursor: step.nextCursor, last, refreshed };
    cursor = step.nextCursor ?? undefined;
  }
  // The bound was reached with more to read: Load more carries on from here.
  return { added, nextCursor: cursor ?? null, last, refreshed };
}

/** What the Explore list shows: its posts in order, Load more's cursor, the ranking on screen and, signed out, whether more exist. */
export interface ExploreShown {
  items: TimelineItem[];
  /** Load more's cursor: null once the ranking has ended, and always for a signed-out reader. */
  cursor: string | null;
  /** The ranking on screen as it was read, which the header ages; null before the first round. */
  ranking: RankingRead | null;
  /** Signed out, whether posts follow the page shown, which the list's footer then offers after a sign-in. */
  signInForMore: boolean;
}

/** A list that has read nothing yet. */
export const NOTHING_SHOWN: ExploreShown = { items: [], cursor: null, ranking: null, signInForMore: false };

/**
 * The Explore list's reads (2c design, section 11), made once per list and gone with it: it holds what the list shows and
 * lets one read run at a time, so a double press on Load more cannot append a page twice and a refresh cannot land between
 * the pages of a read. `load()` reads from the first page, in place of everything on screen (the first read, pull to
 * refresh, Refresh); `load(cursor)` reads after that cursor, below the posts on screen, which a page of a new ranking
 * cannot add again (readPages). Either answers what the list shows then, with whether the ranking being paged was gone,
 * or null, having fetched nothing, while another read runs; a failed read throws and leaves what the list shows as it was.
 */
export function exploreReader(fetchPage: (cursor?: string) => Promise<ExploreAnswer>, maxPages: number = MAX_PAGES) {
  let shown = NOTHING_SHOWN;
  let inFlight = false;
  return {
    async load(after?: string): Promise<(ExploreShown & { refreshed: boolean }) | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        const fromStart = after === undefined;
        const result = await readPages(fetchPage, after, new Set(fromStart ? [] : shown.items.map((item) => item.post.id)), maxPages);
        const last = result.last;
        // From the posts on screen now, not when the read began: one may have been deleted from the list meanwhile.
        shown = {
          items: fromStart ? result.added : [...shown.items, ...result.added],
          cursor: result.nextCursor,
          ranking: last === null ? shown.ranking : last.computedAt === null ? null : { computedAt: last.computedAt, date: last.date, receivedAt: last.receivedAt },
          signInForMore: last === null ? shown.signInForMore : last.signInForMore,
        };
        return { ...shown, refreshed: result.refreshed };
      } finally {
        inFlight = false;
      }
    },
    /** Takes a post its author deleted off the list; a read in flight answers without it too. */
    remove(id: string): ExploreShown {
      shown = { ...shown, items: shown.items.filter((item) => item.post.id !== id) };
      return shown;
    },
  };
}

/** The empty list's sentence (2c design, section 11): when a post appears in Explore, and how often it is refreshed. */
export function exploreEmptyText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    `Nothing to show in Explore right now. A post appears here when at least ${formula.threshold} other accounts, ` +
    `each at least ${duration(formula.engagerMinAgeHours)} old, like or repost it in its first ${plural(formula.windowHours, "hour")}. ` +
    `Explore is refreshed every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The one sentence beside "Show my posts in Explore". Off takes the posts out at the next read. On lets them back at the
 * next refresh (a post still in the current ranking may show again sooner), so the sentence promises no earlier than that.
 */
export function exploreSwitchText(formula: ExploreFormula = EXPLORE_V2): string {
  return (
    "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at " +
    `once, and turning it back on takes effect at the next refresh, which comes every ${plural(formula.refreshMinutes, "minute")}.`
  );
}

/**
 * The author's status line under their own post, in the formula's words and without any count (2c design, sections 8 and
 * 11). Replies and quotes never enter Explore, and their line is left out: null.
 */
export function exploreStatusText(status: ExploreStatusKind, formula: ExploreFormula = EXPLORE_V2): string | null {
  switch (status) {
    case "reply":
    case "quote":
      return null;
    case "not_visible":
      return "Not in Explore: posts under review or removed never appear there.";
    case "suspended":
      // 3e design, section 9.7: what a suspension does to Explore, by its published rule, and when the post may come back.
      return "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.";
    case "hidden_by_author":
      return "Not in Explore: you turned off Show my posts in Explore.";
    case "listed":
      return "In Explore";
    case "outside_window":
      // Version 2 gives a restored post back the time moderation kept it hidden, so the window says so.
      return `Not in Explore: posts can appear only in their first ${plural(formula.windowHours, "hour")}, not counting time in which korbat's moderation kept them from being shown.`;
    case "no_ranking":
      return "Not in Explore yet: the first ranking has not been computed.";
    case "new_since_ranking":
      return "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.";
    case "below_threshold":
      return (
        `Not in Explore: fewer than ${formula.threshold} approving accounts. Your own likes, accounts under ` +
        `${duration(formula.engagerMinAgeHours)} old and likes from the last ${plural(formula.standingMinutes, "minute")} do not count.`
      );
    case "pending":
      return "Not in Explore yet: the next refresh will consider it.";
    case "author_cap":
      // The cap keeps an author's highest-scoring posts, so with the author's places full, those posts ranked above this one.
      return formula.perAuthor === 1 ? "Not in Explore: one of your posts ranks above it." : `Not in Explore: ${numberWord(formula.perAuthor)} of your posts rank above it.`;
    case "below_cutoff":
      return `Not in Explore: it ranks below the ${formula.listLength} posts Explore holds.`;
  }
}

/**
 * How Explore works (2c design, section 11): what is ranked, what counts, the score, the list, the refresh, the cold start,
 * what else takes a post out, and the author's controls, with every number from the formula. The page adds the formula's
 * version and change log.
 */
export function exploreRules(formula: ExploreFormula = EXPLORE_V2): { title: string; body: string }[] {
  const engagerAge = duration(formula.engagerMinAgeHours);
  return [
    {
      title: "What is ranked",
      body:
        `Original posts from the last ${plural(formula.windowHours, "hour")}: posts that are not replies or quotes, by accounts that ` +
        "have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. " +
        "Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    },
    {
      title: "What counts",
      body:
        "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An " +
        "account that both liked and reposted a post counts once. A like or repost counts when its account still exists, " +
        `is not suspended when the ranking is computed, was at least ${engagerAge} old when it liked or reposted, and the ` +
        `like or repost has stood for at least ${plural(formula.standingMinutes, "minute")}. Replies and quotes do not count, ` +
        "so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    },
    {
      title: "The score",
      body:
        `A post needs at least ${formula.threshold} approving accounts. Its score is the number of approving accounts divided ` +
        `by (the hours it has been shown since it was posted + ${formula.offsetHours}) to the power ${formula.gravity}, so a ` +
        "newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and " +
        "then restored gets that time back: its window and its age stand still while it is not shown.",
    },
    {
      title: "The list",
      body:
        `Explore holds the ${formula.listLength} posts with the highest scores, with at most ${formula.perAuthor} posts of one ` +
        "account: that account's highest-scoring ones. Posts with equal scores are ordered by their ids. Only the order is " +
        "shown: no score, rank or count.",
    },
    {
      title: "The refresh",
      body:
        `A new ranking is computed every ${plural(formula.refreshMinutes, "minute")}, never sooner than ` +
        `${plural(formula.minGapMinutes, "minute")} after the last one. The newest ${formula.kept} rankings are kept, so you ` +
        "can finish paging through the one you started; once it is gone, the list says so and goes on with the newest one. " +
        `Signed out, you see the first ${formula.signedOutPage} posts.`,
    },
    {
      title: "A new korbat",
      body:
        `Only accounts at least ${engagerAge} old count, so on a new korbat Explore stays empty for about ${engagerAge} after ` +
        `it opens. A like or repost made in an account's first ${engagerAge} never counts, even after the account is older.`,
    },
    {
      title: "What else takes a post out",
      body:
        // 3e design, section 9.7: a suspension takes the author's posts out by a published rule, never as a lever on
        // Explore alone; the automatic R1 and R2 checks are gone, since rulebook version 2 has none.
        "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every " +
        "list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops " +
        "everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the " +
        "author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    },
    {
      title: "Your posts",
      body:
        "Show my posts in Explore, in Settings > Privacy, keeps your posts out: turning it off takes them out at once, and " +
        "turning it back on takes effect at the next refresh. The page of each of your posts says whether it is in Explore " +
        "and, if not, which rule keeps it out, without counting who liked it.",
    },
  ];
}
```

### Replace `packages/contracts/src/explore.ts` (whole file)

```ts
import { z } from "zod";
import { TimelineItem, page } from "./social";

/**
 * One version of the Explore formula (2c design, sections 5 and 7). The refresh takes one as an argument and passes
 * its numbers into its SQL, and the web app's texts print them, so the published rules and the ranking cannot
 * disagree. Tests pass copies with other numbers.
 */
export interface ExploreFormula {
  /** Stored with every ranking and printed with the change log. */
  readonly version: number;
  /** A post is a candidate for this many hours after it was created, not counting (from v2) time moderation kept it hidden. */
  readonly windowHours: number;
  /** A like or repost counts only when its account was at least this many hours old when it engaged. */
  readonly engagerMinAgeHours: number;
  /** A like or repost counts only once it has stood this long, so one made just before a refresh and undone after it never counts. */
  readonly standingMinutes: number;
  /** The fewest approving accounts (distinct accounts other than the author that liked or reposted it) a post needs. */
  readonly threshold: number;
  /** The score is approvers / (hours since the post was created, from v2 less the time moderation kept it hidden, + offsetHours) ^ gravity. */
  readonly gravity: number;
  readonly offsetHours: number;
  /** At most this many posts of one author in a ranking. */
  readonly perAuthor: number;
  /** A ranking holds at most this many posts. */
  readonly listLength: number;
  /** How often the job runs a round. */
  readonly refreshMinutes: number;
  /** A round writes nothing while the newest ranking is younger than this, so at most one ranking lands per interval. */
  readonly minGapMinutes: number;
  /** Rankings kept: the current one and the one before, so a reader paging through one has at least minGapMinutes. */
  readonly kept: number;
  /** A signed-out reader gets at most this many posts, and no cursor. */
  readonly signedOutPage: number;
  /** The published change log, oldest first; the last entry is this version. */
  readonly changes: readonly { readonly version: number; readonly date: string; readonly summary: string }[];
}

/**
 * Explore v2 (3e design, sections 7.13 and 10.1), in place of v1, which is no longer exported: the same numbers, two
 * changed rules. Posts of accounts suspended when the ranking is computed are not candidates, and their likes and reposts
 * do not count; a post's window and age count from when moderation last gave it back its time (posts.explore_from, which
 * only the database's moderation_apply writes) or else from when it was posted. The round, the status and the app take
 * this one constant, and the round refuses any other version, so no ranking is stored under rules it did not apply.
 * Frozen all the way down: nothing at run time may change what How Explore works publishes.
 */
export const EXPLORE_V2: ExploreFormula = Object.freeze({
  version: 2,
  windowHours: 48,
  engagerMinAgeHours: 48,
  standingMinutes: 10,
  threshold: 3,
  gravity: 1.8,
  offsetHours: 2,
  perAuthor: 2,
  listLength: 300,
  refreshMinutes: 5,
  minGapMinutes: 4.5,
  kept: 2,
  signedOutPage: 20,
  changes: Object.freeze([
    Object.freeze({ version: 1, date: "2026-09-28", summary: "First version." }),
    // Dated the day the task that builds version 2 reached the repository (3e design, section 10.1), worded as section 9.7.
    Object.freeze({
      version: 2,
      date: "2026-10-12",
      summary:
        "Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
    }),
  ]),
});

/** A timeline item of kind post. Explore ranks original posts only, so a repost item is refused. */
const ExploreItem = TimelineItem.refine((item) => item.kind === "post", { message: "Explore lists posts, not reposts" });

/**
 * A page of Explore. It shows only the order: the items are ordinary post views with their public counts, and no score,
 * rank or count is sent. `computedAt` is when the ranking was computed, null before the first round; `signInForMore`
 * tells a signed-out reader, who gets no cursor, that more posts follow.
 */
export const ExplorePage = page(ExploreItem).extend({ computedAt: z.iso.datetime().nullable(), signInForMore: z.boolean() });
export type ExplorePage = z.infer<typeof ExplorePage>;

/** Why a post is in Explore or not, for its author only; the status route answers the first that applies, in this order. */
export const ExploreStatusKind = z.enum([
  // Replies and quotes never enter.
  "reply",
  "quote",
  // Withheld, removed or deleted.
  "not_visible",
  // The author's account is suspended now (3e): its posts leave Explore at the next read.
  "suspended",
  // The author switched Explore off.
  "hidden_by_author",
  // In the current ranking; a listed post stays listed until the next round, even past its window.
  "listed",
  // Older than the window now, counted (from v2) without the time moderation kept it hidden.
  "outside_window",
  // No round has run yet.
  "no_ranking",
  // Created after the current ranking was computed.
  "new_since_ranking",
  // Fewer approving accounts than the threshold now.
  "below_threshold",
  // The next refresh considers it: the threshold is met now but was not when the ranking was computed, or it was met then
  // and a cause that kept the post out has since gone.
  "pending",
  // The author's other posts filled the per-author cap.
  "author_cap",
  // The list was full.
  "below_cutoff",
]);
export type ExploreStatusKind = z.infer<typeof ExploreStatusKind>;

/**
 * The author's status of one post, with `computedAt` the time of the current ranking (null before the first round). It
 * carries no count, which would let an author work out which accounts liked the post.
 */
export const ExploreStatus = z.object({ status: ExploreStatusKind, computedAt: z.iso.datetime().nullable() });
export type ExploreStatus = z.infer<typeof ExploreStatus>;

/** What turning "Show my posts in Explore" on or off answers. */
export const ExploreSettingResponse = z.object({ showInExplore: z.boolean() });
export type ExploreSettingResponse = z.infer<typeof ExploreSettingResponse>;
```

### Replace `packages/db/migrations/meta/_journal.json` (whole file)

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1789374373025,
      "tag": "0000_parallel_umar",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1789374374757,
      "tag": "0001_grants",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
      "when": 1789388768464,
      "tag": "0002_aspiring_prism",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1789388790249,
      "tag": "0003_auth_events_grants",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1789639555282,
      "tag": "0004_young_bloodscream",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1789976535081,
      "tag": "0005_huge_scarlet_spider",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1789976685374,
      "tag": "0006_nifty_blue_shield",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1790237989056,
      "tag": "0007_auth_purge_events",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1790238603639,
      "tag": "0008_careless_shadowcat",
      "breakpoints": true
    },
    {
      "idx": 9,
      "version": "7",
      "when": 1790241720737,
      "tag": "0009_clever_ezekiel",
      "breakpoints": true
    },
    {
      "idx": 10,
      "version": "7",
      "when": 1790332470171,
      "tag": "0010_free_thunderbolt",
      "breakpoints": true
    },
    {
      "idx": 11,
      "version": "7",
      "when": 1790586983460,
      "tag": "0011_magical_iceman",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": 1790769406818,
      "tag": "0012_aberrant_wendell_vaughn",
      "breakpoints": true
    },
    {
      "idx": 13,
      "version": "7",
      "when": 1790876150318,
      "tag": "0013_forget_revoked_staff_keys",
      "breakpoints": true
    },
    {
      "idx": 14,
      "version": "7",
      "when": 1791059071207,
      "tag": "0014_old_vapor",
      "breakpoints": true
    },
    {
      "idx": 15,
      "version": "7",
      "when": 1791071072064,
      "tag": "0015_greedy_zuras",
      "breakpoints": true
    },
    {
      "idx": 16,
      "version": "7",
      "when": 1791079521491,
      "tag": "0016_decisions_and_ledger",
      "breakpoints": true
    },
    {
      "idx": 17,
      "version": "7",
      "when": 1791554906923,
      "tag": "0017_appeals",
      "breakpoints": true
    },
    {
      "idx": 18,
      "version": "7",
      "when": 1791563173651,
      "tag": "0018_retention",
      "breakpoints": true
    },
    {
      "idx": 19,
      "version": "7",
      "when": 1791578511908,
      "tag": "0019_redaction_scope",
      "breakpoints": true
    },
    {
      "idx": 20,
      "version": "7",
      "when": 1791793244840,
      "tag": "0020_fearless_absorbing_man",
      "breakpoints": true
    },
    {
      "idx": 21,
      "version": "7",
      "when": 1791793290793,
      "tag": "0021_standing_ledger",
      "breakpoints": true
    },
    {
      "idx": 22,
      "version": "7",
      "when": 1791822319659,
      "tag": "0022_reporting_counts",
      "breakpoints": true
    },
    {
      "idx": 23,
      "version": "7",
      "when": 1791827521579,
      "tag": "0023_explore_resume",
      "breakpoints": true
    }
  ]
}
```

### Replace `packages/db/src/schema/content.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, real, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { apiRole, fullAccess, ts } from "./helpers";
import { profiles } from "./identity";

export const postState = pgEnum("post_state", ["visible", "withheld", "removed", "deleted_by_author"]);

/**
 * What moderation derives for a post from the measures in force (3c design, section 6.1): the strongest of them.
 * posts.state mirrors it unless the author deleted the post, so post_state gains no value.
 */
export const moderationLevel = pgEnum("moderation_level", ["visible", "withheld", "removed"]);

/** An image's own moderation state, beside its post's. Only an image is ever sealed: shown to nobody, its author included. */
export const mediaModerationState = pgEnum("media_moderation_state", ["visible", "withheld", "removed", "sealed"]);

/** A counter kept exact by the application: updated in the same transaction as the action it counts. */
const counter = (name: string) => integer(name).notNull().default(0);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    quoteOfId: uuid("quote_of_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    state: postState("state").notNull().default("visible"),
    likeCount: counter("like_count"),
    repostCount: counter("repost_count"),
    /** Replies that are not deleted. */
    replyCount: counter("reply_count"),
    /** Quotes that are not deleted. */
    quoteCount: counter("quote_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Set together with state = 'deleted_by_author'; the body is blanked at the same time. */
    deletedAt: ts("deleted_at"),
    /** Derived from the ledger of measures by a migrator-owned function, the only writer; the API role cannot update it. */
    moderationLevel: moderationLevel("moderation_level").notNull().default("visible"),
    /** Set, one way, when the R4 redaction erased the post's content; written only by a migrator-owned function. */
    erasedAt: ts("erased_at"),
    /**
     * Explore's resume rule (3e design, sections 6.1 and 6.4): when the post last left the level visible, when it last came
     * back, and the time its age and window are counted from after its hidden spans. Outside the API's column grants; a
     * later migration gives them their one writer, moderation_apply.
     */
    hiddenAt: ts("hidden_at"),
    restoredAt: ts("restored_at"),
    exploreFrom: ts("explore_from"),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    /** Explore's restored posts. */
    index("posts_explore_from_idx").on(t.exploreFrom).where(sql`explore_from is not null`),
    index("posts_created_id_idx").on(t.createdAt, t.id),
    /** A thread's replies in order, and every lookup by parent. */
    index("posts_reply_to_created_idx").on(t.replyToId, t.createdAt, t.id),
    /** The public Latest timeline: visible top-level posts and quotes, newest first. */
    index("posts_latest_idx").on(t.createdAt, t.id).where(sql`reply_to_id is null and state = 'visible'`),
    index("posts_quote_of_idx").on(t.quoteOfId),
    check("posts_body_len", sql`char_length(${t.body}) <= 1000`),
    check("posts_counts_nonnegative", sql`${t.likeCount} >= 0 and ${t.repostCount} >= 0 and ${t.replyCount} >= 0 and ${t.quoteCount} >= 0`),
    fullAccess("posts_api_all", apiRole),
  ],
).enableRLS();

/**
 * One Explore ranking (a "generation"), written by the refresh job (2c design, sections 6 and 7). The current ranking
 * is the highest generation; the job also keeps the one before it, so a reader paging through a ranking is not cut
 * off by the next round.
 */
export const exploreRuns = pgTable(
  "explore_runs",
  {
    /** Numbered by the database. One ranking every 5 minutes lasts 20,000 years in an integer. */
    generation: integer("generation").primaryKey().generatedAlwaysAsIdentity(),
    /** The refresh time the round was given; the ranking is computed as of this time. */
    asOf: ts("as_of").notNull(),
    /** The version of the formula the round ranked with (EXPLORE_V2.version in @korbat/contracts; rankings from before 3e hold 1). */
    formula: smallint("formula").notNull(),
    /** Posts that passed the candidate predicate at as_of. */
    candidates: integer("candidates").notNull(),
    /** Posts the ranking holds; their positions run from 1 to this. */
    items: integer("items").notNull(),
    /** How long the round took. */
    tookMs: integer("took_ms").notNull(),
  },
  () => [fullAccess("explore_runs_api_all", apiRole)],
).enableRLS();

/**
 * The posts of one Explore ranking, in order. No score or count is stored: nothing reads them after the insert, and
 * the position is the order. A row goes with its ranking, its post or its author.
 */
export const exploreItems = pgTable(
  "explore_items",
  {
    generation: integer("generation").notNull().references(() => exploreRuns.generation, { onDelete: "cascade" }),
    /** 1 to the ranking's item count, without gaps. */
    position: integer("position").notNull(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    /** The post's author, so an author's places in a ranking are counted without reading the posts. */
    authorId: uuid("author_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.generation, t.position] }),
    /** A post has one place in a ranking. */
    uniqueIndex("explore_items_generation_post_idx").on(t.generation, t.postId),
    fullAccess("explore_items_api_all", apiRole),
  ],
).enableRLS();

/** An upload is processing until the worker's result is in, then ready or failed for good. */
export const mediaStatus = pgEnum("media_status", ["processing", "ready", "failed"]);

/**
 * One uploaded image. The files live on the media-store volume under the row's id; no path is
 * stored. Only the API's media module reads or writes this table.
 */
export const postMedia = pgTable(
  "post_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who uploaded it. Only this account may attach it to a post. */
    ownerId: uuid("owner_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    status: mediaStatus("status").notNull().default("processing"),
    /** Why processing failed: one of the contracts' MediaFailure values. */
    error: text("error"),
    /** Set, together with the position, when the image is attached to a post. */
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    position: integer("position"),
    /** Of the large size, after rotation. Set, together with the blurhash, when processing succeeds. */
    width: integer("width"),
    height: integer("height"),
    blurhash: text("blurhash"),
    altText: text("alt_text"),
    /** Filled by sub-project 3. Empty until then. */
    nsfwScore: real("nsfw_score"),
    createdAt: ts("created_at").notNull().defaultNow(),
    // The three columns below are forced to their defaults at insert and written only by migrator-owned functions; the
    // API role holds no UPDATE on them (migration 0015).
    /** Derived from the ledger of measures, as the post's level is. */
    moderationState: mediaModerationState("moderation_state").notNull().default("visible"),
    /** The latest end of the image's unreleased holds (media_holds): while it lies ahead, every delete skips the row. */
    holdUntil: ts("hold_until"),
    /** Set when an R4 removal of the image became final and its content was erased. */
    erasedAt: ts("erased_at"),
  },
  (t) => [
    uniqueIndex("post_media_post_position_idx").on(t.postId, t.position),
    index("post_media_owner_created_idx").on(t.ownerId, t.createdAt),
    index("post_media_status_created_idx").on(t.status, t.createdAt),
    check("post_media_ready_has_dims", sql`${t.status} <> 'ready' or (${t.width} is not null and ${t.height} is not null and ${t.blurhash} is not null)`),
    check("post_media_attached_is_complete", sql`${t.postId} is null or (${t.status} = 'ready' and ${t.position} between 0 and 3 and ${t.altText} is not null)`),
    check("post_media_alt_len", sql`char_length(${t.altText}) <= 1000`),
    fullAccess("post_media_api_all", apiRole),
  ],
).enableRLS();

/** user -> user relation table (follows, blocks, mutes). */
function userPairTable(name: string, from: string, to: string) {
  return pgTable(
    name,
    {
      fromId: uuid(from).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      toId: uuid(to).notNull().references(() => profiles.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.fromId, t.toId] }),
      /** Pages of either side, newest first, and every lookup by either side. */
      index(`${name}_to_created_idx`).on(t.toId, t.createdAt, t.fromId),
      index(`${name}_from_created_idx`).on(t.fromId, t.createdAt, t.toId),
      check(`${name}_not_self`, sql`${t.fromId} <> ${t.toId}`),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

/**
 * user -> post relation table (likes, reposts, bookmarks). `createdBrin` adds `<name>_created_brin`, a BRIN index on
 * created_at, for the tables whose recent rows the Explore refresh reads (2c design, section 6).
 */
function userPostTable(name: string, options: { createdBrin?: boolean } = {}) {
  return pgTable(
    name,
    {
      userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
      postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
      createdAt: ts("created_at").notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.postId] }),
      index(`${name}_post_idx`).on(t.postId),
      /** Per-account lists (your likes, your bookmarks) and the reposts half of the Following timeline. */
      index(`${name}_user_created_idx`).on(t.userId, t.createdAt),
      // Rows arrive roughly in time order, so a BRIN index of a few kilobytes finds the refresh's window as fast as a
      // btree of many megabytes. Unlikes, blocks and purges let later rows fill old pages and erode that order slowly.
      ...(options.createdBrin ? [index(`${name}_created_brin`).using("brin", t.createdAt)] : []),
      fullAccess(`${name}_api_all`, apiRole),
    ],
  ).enableRLS();
}

export const follows = userPairTable("follows", "follower_id", "followee_id");
export const blocks = userPairTable("blocks", "blocker_id", "blocked_id");
export const mutes = userPairTable("mutes", "muter_id", "muted_id");
export const likes = userPostTable("likes", { createdBrin: true });
export const reposts = userPostTable("reposts", { createdBrin: true });
/** Bookmarks are private and never count towards Explore, so they need no index by time. */
export const bookmarks = userPostTable("bookmarks");
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=20000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  71 passed (71)
packages/contracts test:       Tests  327 passed (327)
packages/media-protocol test:       Tests  21 passed (21)
packages/rules test:       Tests  92 passed (92)
apps/admin test:       Tests  428 passed (428)
apps/worker test:       Tests  45 passed (45)
apps/app test:       Tests  242 passed (242)
apps/api test:       Tests  753 passed | 1283 skipped (2036)
```

## Step 6: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 7: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=24`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=24
```

## Step 8: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 9: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 10: verify: integration-own

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 test/integration/standing-explore.test.ts test/integration/social-explore-ranking.test.ts test/integration/social-explore-reads.test.ts test/integration/social-explore-job.test.ts test/integration/http-explore.test.ts test/integration/moderation-apply.test.ts test/integration/moderation-schema.test.ts test/integration/standing-grants.test.ts
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  156 passed (156)
```

## Step 11: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 12: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/explore.ts`
- `apps/api/src/social/flows/explore.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/integration/http-explore.test.ts`
- `apps/api/test/integration/moderation-apply.test.ts`
- `apps/api/test/integration/moderation-fixtures.ts`
- `apps/api/test/integration/moderation-schema.test.ts`
- `apps/api/test/integration/social-explore-job.test.ts`
- `apps/api/test/integration/social-explore-ranking.test.ts`
- `apps/api/test/integration/social-explore-reads.test.ts`
- `apps/api/test/integration/standing-explore.test.ts`
- `apps/api/test/integration/standing-grants.test.ts`
- `apps/api/test/lab/standing.lab.ts`
- `apps/api/test/social/explore-job.test.ts`
- `apps/app/src/app/explore/about.tsx`
- `apps/app/src/components/social/ExploreList.tsx`
- `apps/app/src/lib/explore.ts`
- `apps/app/test/explore.test.tsx`
- `packages/contracts/src/explore.ts`
- `packages/contracts/test/explore.test.ts`
- `packages/db/migrations/0023_<two random words>.sql`
- `packages/db/migrations/meta/0023_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/src/schema/content.ts`

Allowed difference: drizzle-kit names each generated migration with its number and two random words, so that file's name differs from the dry run. Any name of that shape is correct; do not rename it.

## Step 13: commit

```bash
git add -A
git commit -q -m "feat(db,contracts,api,app): Explore formula version 2: migration 0023_explore_resume makes moderation_apply, the one writer of a post's level, the one writer of posts.hidden_at, restored_at and explore_from in the UPDATE that moves the level, so a restored post's window and age resume by exactly the hidden spans of the ledger, and posts_guard forces the three null on an insert by any role but the migrator; EXPLORE_V2 replaces EXPLORE_V1 with the same numbers and a second entry in the change log; the round leaves out authors and engagers suspended at its own time, counts the window and the score from coalesce(explore_from, created_at) and throws for any other version, and only rankings of version 2 hold a round back; the page, the chip and the status judge the author at the database's clock, and the status gains suspended, reads the window from explore_from, answers pending for a post restored after the ranking and judges only now under a ranking of version 1; How Explore works and the status line say so; lab F runs on the real code" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(db,contracts,api,app): Explore formula version 2: migration 0023_explore_resume makes moderation_apply, the one writer of a post's level, the one writer of posts.hidden_at, restored_at and explore_from in the UPDATE that moves the level, so a restored post's window and age resume by exactly the hidden spans of the ledger, and posts_guard forces the three null on an insert by any role but the migrator; EXPLORE_V2 replaces EXPLORE_V1 with the same numbers and a second entry in the change log; the round leaves out authors and engagers suspended at its own time, counts the window and the score from coalesce(explore_from, created_at) and throws for any other version, and only rankings of version 2 hold a round back; the page, the chip and the status judge the author at the database's clock, and the status gains suspended, reads the window from explore_from, answers pending for a post restored after the ranking and judges only now under a ranking of version 1; How Explore works and the status line say so; lab F runs on the real code`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 26>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "integration-own": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
