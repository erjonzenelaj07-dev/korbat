import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { StaffStepUpConfirmed } from "../../src/auth";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type HandleChangeResult } from "../../src/social/repo";
import { deciderWorld, type DeciderWorld, type RealStaff } from "../integration/moderation-decide";
import { act, anAccount, decisionParams, ground, intake, removeFixtures } from "../integration/moderation-fixtures";
import { newProfile } from "../integration/social-fixtures";

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
});
