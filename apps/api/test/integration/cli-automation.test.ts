import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, SWEEP_HOURS } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { R1_TEST_MODEL } from "@korbat/media-protocol";
import { automationStatus, type AutomationSettings } from "../../src/cli/automation";
import { runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { automationDeps, signalForTest } from "./automation-fixtures";
import { ageCustodyForTest } from "./custody-fixtures";
import { imagePost } from "./moderation-fixtures";
import { rolledBack } from "./staff-fixtures";

vi.setConfig({ testTimeout: 120_000 });

/**
 * staff.js automation-status (3d design, section 8.10; Task 6), in the api service on the API's role: one line for each
 * adapter and its settings, a program's findings today and the use of each of its limits, read in one read-only
 * transaction. The counts are read inside transactions that are rolled back, so the file leaves nothing behind; the
 * command itself is run on the test environment with every adapter off, and once with a setting the API refuses.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js automation-status (3d Task 6)", () => {
  let apiDb: Db;
  // Every 3d setting as the test environment would leave it, made explicit: blank is unset.
  const OFF = {
    EDGE_PURGE: "",
    R1_CLASSIFIER: "",
    AUTOMATION_R1_ACTS: "",
    AUTOMATION_DPIA_R1: "",
    AUTOMATION_DPIA_R1_ACTS: "",
    HEAD_WITNESS: "",
    HEAD_KEEPER_MAIL: "",
    RECIPIENTS_SIGNED_OUT: "",
    // 3d Task 7: the comparison's four settings, blank as unset.
    MEDIA_MATCH: "",
    AUTOMATION_R2_ACTS: "",
    AUTOMATION_DPIA_MATCH: "",
    AUTOMATION_DPIA_MATCH_ACTS: "",
  };
  const run = async (env: Record<string, string>) => {
    const lines: string[] = [];
    const code = await runStaffCommand(["automation-status"], { ...process.env, ...OFF, ...env }, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines };
  };
  const settings = (over: Partial<AutomationSettings> = {}): AutomationSettings => ({
    EDGE_PURGE: "off",
    R1_CLASSIFIER: "off",
    AUTOMATION_R1_ACTS: "off",
    AUTOMATION_DPIA_R1: undefined,
    AUTOMATION_DPIA_R1_ACTS: undefined,
    HEAD_WITNESS: "off",
    HEAD_KEEPER_MAIL: undefined,
    RECIPIENTS_SIGNED_OUT: "on",
    MEDIA_MATCH: "off",
    AUTOMATION_R2_ACTS: "on",
    AUTOMATION_DPIA_MATCH: undefined,
    AUTOMATION_DPIA_MATCH_ACTS: undefined,
    ...over,
  });

  beforeAll(() => {
    apiDb = createDb(loadConfig().DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await closeDb(apiDb);
  });

  test("with every adapter off: eight lines, each the command's, the R1 check off, known material off, no daily mail; nothing written", async () => {
    const [head] = await apiDb.execute<{ seq: string }>(sql`select seq::text as seq from public.audit_head where id = 1`);
    const { code, lines } = await run({});
    expect(code).toBe(0);
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(line).toMatch(/^out automation-status: /);
    expect(lines[0]).toMatch(/^out automation-status: edge purge: off; [0-9]+ purges waiting, [0-9]+ failed in 24 hours[.]$/);
    expect(lines[1]).toBe("out automation-status: R1 check: off, acts off; model none, threshold version 1; impact assessment not set, for its measure not set.");
    // 3d Task 7 (8.10): the comparison, whether its match seals (on by default), its two days, and its counts.
    expect(lines[2]).toMatch(
      new RegExp(`^out automation-status: known material: off, acts on; impact assessment not set, for its measure not set; [0-9]+ uploads unchecked, the oldest since (none|[0-9T:.Z-]+); refusals [0-9]+ of ${AUTOMATION_RULES.refusalsPerHour} this hour[.]$`),
    );
    expect(lines[3]).toMatch(/^out automation-status: head witness: off; last value ([0-9-]{10}|none), witnessed (yes|no); keeper's mail not set: no daily mail is sent[.]$/);
    expect(lines[4]).toBe("out automation-status: signed-out readers: counted.");
    expect(lines[5]).toMatch(new RegExp(`^out automation-status: a program's findings today: [0-9]+ under R1, [0-9]+ under R2, [0-9]+ without a rule; signals the sweep left unhandled after ${SWEEP_HOURS} hours: [0-9]+[.]$`));
    expect(lines[6]).toMatch(
      new RegExp(
        `^out automation-status: a program's decisions under R1: [0-9]+ of ${AUTOMATION_RULES.decisionsPerHour} in the last hour, [0-9]+ of ${AUTOMATION_RULES.decisionsPerDay} in the last 24 hours; under R2: [0-9]+ of ${AUTOMATION_RULES.r2DecisionsPerHour}, [0-9]+ of ${AUTOMATION_RULES.r2DecisionsPerDay}[.]$`,
      ),
    );
    expect(lines[7]).toMatch(
      new RegExp(
        `^out automation-status: a program's measures waiting for a person: under R1 [0-9]+ of ${AUTOMATION_RULES.unansweredMax}, under R2 [0-9]+ of ${AUTOMATION_RULES.unansweredMax}; the oldest unanswered request for a person: (none|[0-9T:.Z-]+) [(]no new measure under either rule once one is older than ${AUTOMATION_RULES.unansweredHours} hours[)][.]$`,
      ),
    );
    // Read-only: the chain did not move.
    const [after] = await apiDb.execute<{ seq: string }>(sql`select seq::text as seq from public.audit_head where id = 1`);
    expect(after!.seq).toBe(head!.seq);
  });

  test("the settings as the server reads them: a test adapter on a closed site, its two days, signed-out readers off, a keeper's mail set; a setting the API refuses is refused with its sentence", async () => {
    const lines = await automationStatus(apiDb, settings({ R1_CLASSIFIER: "test", AUTOMATION_R1_ACTS: "on", AUTOMATION_DPIA_R1: "2026-09-01", AUTOMATION_DPIA_R1_ACTS: "2026-09-02", RECIPIENTS_SIGNED_OUT: "off", HEAD_KEEPER_MAIL: "keeper@korbat.local" }));
    expect(lines[1]).toBe(`automation-status: R1 check: test, acts on; model ${R1_TEST_MODEL}, threshold version 0; impact assessment 2026-09-01, for its measure 2026-09-02.`);
    expect(lines[3]).toMatch(/keeper's mail set[.]$/);
    expect(lines.join(" ")).not.toContain("keeper@korbat.local");
    expect(lines[4]).toBe("automation-status: signed-out readers: not counted.");
    // The API refuses a test adapter while the site is open; so does the command, which prints nothing else.
    const refused = await run({ R1_CLASSIFIER: "test", APP_SITE: "open" });
    expect(refused.code).toBe(1);
    expect(refused.lines).toHaveLength(1);
    expect(refused.lines[0]).toMatch(/^err [^]*R1_CLASSIFIER=test is refused while APP_SITE is open/);
  });

  test("the counts: a program's finding and measure today, its use of R1's caps, its measure waiting and the oldest request for a person", async () => {
    await rolledBack(apiDb, async (tx) => {
      const read = async () => {
        const lines = await automationStatus(tx, settings({ R1_CLASSIFIER: "test", AUTOMATION_R1_ACTS: "on" }));
        const decided = /decisions under R1: ([0-9]+) of [0-9]+ in the last hour, ([0-9]+) of /.exec(lines[6]!)!;
        return {
          lines,
          found: Number(/findings today: ([0-9]+) under R1,/.exec(lines[5]!)![1]),
          hour: Number(decided[1]),
          day: Number(decided[2]),
          waiting: Number(/waiting for a person: under R1 ([0-9]+) of /.exec(lines[7]!)![1]),
          oldest: /request for a person: ([^ ]+) /.exec(lines[7]!)![1],
        };
      };
      const before = await read();
      const p = await imagePost(tx, 1);
      const step = await signalForTest(automationDeps(tx), p.mediaIds[0]!);
      expect(step.handled).toBe("measure");
      await tx.execute(sql`insert into public.automated_objections (decision_id, text) values (${step.decisionId!}::uuid, 'Please have a person look.')`);
      const after = await read();
      expect([after.found, after.hour, after.day, after.waiting]).toEqual([before.found + 1, before.hour + 1, before.day + 1, before.waiting + 1]);
      expect(after.oldest).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
      // No text and no id in any line.
      expect(after.lines.join(" ")).not.toMatch(/Please have a person look|[0-9a-f]{8}-[0-9a-f]{4}/);
    });
  });

  test("a signal older than the sweep's hours, still unhandled, is counted as given up", async () => {
    const migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    try {
      await rolledBack(migrateDb, async (tx) => {
        const count = async () => Number(/signals the sweep left unhandled after [0-9]+ hours: ([0-9]+)[.]/.exec((await automationStatus(tx, settings()))[5]!)![1]);
        const before = await count();
        const p = await imagePost(tx, 1);
        const [signal] = await tx.execute<{ id: string }>(sql`insert into public.automated_signals (kind, media_id, score, threshold_version) values ('r1_score', ${p.mediaIds[0]!}::uuid, 1, 0) returning id`);
        expect(await count()).toBe(before);
        await ageCustodyForTest(tx, { signal: signal!.id }, `${SWEEP_HOURS} hours 1 minute`);
        expect(await count()).toBe(before + 1);
      });
    } finally {
      await closeDb(migrateDb);
    }
  });
});
