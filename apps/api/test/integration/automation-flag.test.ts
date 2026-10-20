import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { CaseView, SIGNAL_RULES, type QueueRow } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { ActiveStaffSession } from "../../src/auth";
import { caseView, queue } from "../../src/moderation/cases";
import { caseById } from "../../src/moderation/repo";
import { aPost, ground, hex64, imagePost, intake, moderationDeps } from "./moderation-fixtures";
import { one } from "./retention-fixtures";
import { newProfile } from "./social-fixtures";
import { rolledBack } from "./staff-fixtures";

// Each test records a dozen reports through the intake's own transaction and reads the queue page by page.
vi.setConfig({ testTimeout: 180_000 });

const SR = SIGNAL_RULES;
const SRC = path.resolve(__dirname, "../../src");

/**
 * Row 25 of the 3d design (sections 2 rows 47 and 48, 6.8, 7.13, 8.3, 8.4 and 10.3; Task 8): the flag "possible coordinated
 * reporting" is a hint and nothing more. case_flag answers three counts from rows 3c already keeps, with its own four
 * numbers, which are SIGNAL_RULES'; a signed-out notice is not in it; it goes dark once retention forgets a reporter; the
 * queue carries it and orders the same with it and without; the case answer carries it with each item's count of its
 * reporter's other open items; and the API calls it from those two reads and no third. Every report is recorded through
 * the intake's own statements, and every move of the clock is made as the migrator, in a transaction that is rolled back.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the flag possible coordinated reporting (3d Task 8, row 25)", () => {
  let migrateDb: Db;

  beforeAll(() => {
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
  });
  afterAll(async () => {
    await closeDb(migrateDb);
  });

  /** A post reported under R1 by `n` new signed-in accounts, one report each: the post, its case and the reporters, in order. */
  async function reported(tx: DbTx, n: number, postId?: string): Promise<{ postId: string; caseId: string; reporters: string[] }> {
    const post = postId ?? (await imagePost(tx, 0)).postId;
    const reporters: string[] = [];
    let caseId = "";
    for (let i = 0; i < n; i++) {
      const reporter = await newProfile(tx as unknown as Db);
      reporters.push(reporter.id);
      caseId = (await intake(tx, ground.rule(reporter.id, "R1"), aPost(post))).items[0]!.caseId!;
    }
    return { postId: post, caseId, reporters };
  }
  /** Each of these accounts follows the next, the last the first: every one of them follows another of them. */
  async function linked(tx: DbTx, ids: readonly string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) await tx.execute(sql`insert into public.follows (follower_id, followee_id) values (${ids[i]!}::uuid, ${ids[(i + 1) % ids.length]!}::uuid)`);
  }
  const flagOf = (tx: DbTx, caseId: string) => one<{ coordinated: boolean; items: number; reporters: number }>(tx, sql`select * from public.case_flag(${caseId}::uuid)`);
  /** The smallest number of reporters that is at least the linked share of these many. */
  const half = (n: number) => Math.ceil(n * SR.linkedShare);

  test("case_flag's four numbers are constants of its own, in the function's text, and they are SIGNAL_RULES'", async () => {
    const [row] = await migrateDb.execute<{ definition: string }>(sql`select pg_get_functiondef('public.case_flag(uuid)'::regprocedure) as definition`);
    const found = /SELECT ([0-9]+) AS min_items, ([0-9]+) AS min_reporters, ([0-9]+) AS window_minutes, ([0-9.]+)::numeric AS linked_share/.exec(row!.definition);
    expect(found).not.toBeNull();
    expect({ minItems: Number(found![1]), minReporters: Number(found![2]), windowMinutes: Number(found![3]), linkedShare: Number(found![4]) }).toEqual({ ...SR });
  });

  test("it answers true at minItems reports from minReporters accounts, at least half of them linked, and false one short of each; it answers counts and never a reporter", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const r = await reported(tx, SR.minReporters);
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: false, items: SR.minItems, reporters: SR.minReporters });
      await linked(tx, r.reporters.slice(0, half(SR.minReporters)));
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: true, items: SR.minItems, reporters: SR.minReporters });
      const [shape] = await tx.execute(sql`select * from public.case_flag(${r.caseId}::uuid)`);
      expect(Object.keys(shape!)).toEqual(["coordinated", "items", "reporters"]);
    });
    await rolledBack(migrateDb, async (tx) => {
      // One account short: every one of them linked, and still no flag.
      const r = await reported(tx, SR.minReporters - 1);
      await linked(tx, r.reporters);
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: false, items: SR.minItems - 1, reporters: SR.minReporters - 1 });
    });
    await rolledBack(migrateDb, async (tx) => {
      // Enough accounts, one linked account short of the share.
      const r = await reported(tx, SR.minReporters);
      await linked(tx, r.reporters.slice(0, half(SR.minReporters) - 1));
      expect(await flagOf(tx, r.caseId)).toMatchObject({ coordinated: false, reporters: SR.minReporters });
    });
  });

  test("only reports within one window of windowMinutes count together", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const r = await reported(tx, SR.minReporters);
      await linked(tx, r.reporters);
      const last = (await one<{ id: string }>(tx, sql`select id from public.intake_items where case_id = ${r.caseId}::uuid order by seq desc limit 1`)).id;
      const move = (minutes: number) => tx.execute(sql`update public.intake_items set created_at = (select min(created_at) from public.intake_items where case_id = ${r.caseId}::uuid) + make_interval(mins => ${minutes}::int) where id = ${last}::uuid`);
      await move(SR.windowMinutes + 1);
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: false, items: SR.minItems - 1, reporters: SR.minReporters - 1 });
      await move(SR.windowMinutes - 1);
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: true, items: SR.minItems, reporters: SR.minReporters });
    });
  });

  test("a signed-out notice is not in it, and it goes dark once retention forgets a reporter", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const r = await reported(tx, SR.minReporters - 1);
      await linked(tx, r.reporters);
      // A notice sent without an account: no account, no graph.
      await intake(tx, ground.illegal(null), aPost(r.postId));
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: false, items: SR.minItems - 1, reporters: SR.minReporters - 1 });
    });
    await rolledBack(migrateDb, async (tx) => {
      const r = await reported(tx, SR.minReporters);
      await linked(tx, r.reporters);
      expect((await flagOf(tx, r.caseId)).coordinated).toBe(true);
      // What forget_reporter (C 6.4) does to the items of an account whose deletion it records.
      await tx.execute(sql`update public.intake_items set reporter_account_id = null where reporter_account_id = ${r.reporters[0]!}::uuid`);
      expect(await flagOf(tx, r.caseId)).toEqual({ coordinated: false, items: SR.minItems - 1, reporters: SR.minReporters - 1 });
    });
  });

  test("the queue carries the flag and orders the same with it and without; the case answer carries it, and each item the count of its reporter's other open items", async () => {
    await rolledBack(migrateDb, async (tx) => {
      const deps = moderationDeps(tx);
      const r = await reported(tx, SR.minReporters);
      // Two of the reporters reported another post too: each of their items here names one other open item.
      const other = await reported(tx, 0);
      for (const reporter of r.reporters.slice(0, 2)) await intake(tx, ground.rule(reporter, "R3"), aPost(other.postId));
      const allPages = async (): Promise<QueueRow[]> => {
        const found: QueueRow[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 200; page++) {
          const read = await queue(deps, cursor);
          found.push(...read.cases);
          if (read.nextCursor === null) return found;
          cursor = read.nextCursor;
        }
        throw new Error("the queue holds more than 200 pages");
      };
      const before = await allPages();
      expect(before.find((row) => row.id === r.caseId)!.flag).toBeNull();
      await linked(tx, r.reporters);
      const after = await allPages();
      expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
      expect(after.find((row) => row.id === r.caseId)!.flag).toEqual({ items: SR.minItems, reporters: SR.minReporters });

      const now = new Date();
      const session: ActiveStaffSession = {
        sessionId: hex64(),
        handle: randomUUID(),
        userId: randomUUID(),
        keyId: randomUUID(),
        role: "moderator",
        createdAt: now,
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
        browser: "Firefox on Linux",
      };
      const view = await caseView(deps, session, (await caseById(tx, r.caseId))!);
      expect(CaseView.safeParse(view).success, JSON.stringify(CaseView.safeParse(view).error?.issues)).toBe(true);
      expect(view.flag).toEqual({ items: SR.minItems, reporters: SR.minReporters });
      expect(view.items.map((item) => item.sameSourceOpen)).toEqual([1, 1, 0, 0, 0]);
      // The other case's flag is null, and its items name the first case's as the reporters' other open ones.
      const otherView = await caseView(deps, session, (await caseById(tx, (await one<{ id: string }>(tx, sql`select case_id as id from public.intake_items where target_id = ${other.postId}::uuid limit 1`)).id))!);
      expect(otherView.flag).toBeNull();
      expect(otherView.items.map((item) => item.sameSourceOpen)).toEqual([1, 1]);
    });
  });

  test("the API names case_flag in two reads, the queue's and the case answer's, and in no third", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? files(path.join(dir, name)) : name.endsWith(".ts") ? [path.join(dir, name)] : []));
    const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
    const naming = sources.flatMap(({ file, text }) => [...text.matchAll(/public[.]case_flag[(]/g)].map(() => file));
    expect(naming).toEqual(["moderation/automated-repo.ts", "moderation/automated-repo.ts"]);
    // Each of the two reads is called once, from the queue and from the case answer, both in cases.ts.
    for (const read of ["queueFlags", "caseFlag"]) {
      const callers = sources.flatMap(({ file, text }) => [...text.matchAll(new RegExp(`(?<![A-Za-z])${read}[(]`, "g"))].map(() => file)).filter((file) => file !== "moderation/automated-repo.ts");
      expect(callers, read).toEqual(["moderation/cases.ts"]);
    }
    const cases = sources.find(({ file }) => file === "moderation/cases.ts")!.text;
    const queueBody = cases.slice(cases.indexOf("export async function queue("), cases.indexOf("// ---------------------------------------------------------------- the case answer"));
    expect(queueBody).toContain("queueFlags(");
    // The order is read before the flag: queueRows takes no flag, and nothing sorts the page after it.
    expect(queueBody.indexOf("queueRows(")).toBeLessThan(queueBody.indexOf("queueFlags("));
    expect(queueBody).not.toMatch(/[.]sort[(]/);
  });
});
