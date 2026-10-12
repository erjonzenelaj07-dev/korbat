import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ModerationError, type ModerationDeps } from "../src/moderation/context";
import { recordIntake, type IntakeGround, type LiveTarget } from "../src/moderation/intake";

/**
 * The order of the intake's transaction (3c design, section 7.1, step 4), without a database: the transaction is a
 * stand-in that records every statement in the order it is issued and answers each as the test scripts it, and the social
 * module is one that records what it is asked to lock and to copy. What the statements do to real rows is in the
 * integration tests; this holds only their order and how often a target's open case is read.
 */

const POST_ONE = "00000000-0000-4000-8000-000000000001";
const POST_TWO = "00000000-0000-4000-8000-000000000002";
/** An account whose id sorts before both posts': a case's kind comes before its id in the one order. */
const ACCOUNT = "00000000-0000-4000-8000-000000000000";
const TAKEN = "2026-10-04T10:00:00.000Z";

const ground: IntakeGround = {
  kind: "user",
  channel: "signed_in",
  reporterId: randomUUID(),
  findingBy: null,
  contactId: null,
  ruleId: "R1",
  allegesIllegal: false,
  csam: false,
  category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
  categoryKeyword: null,
  citedLaw: null,
  explanation: null,
  bonaFide: false,
};

/**
 * The module's dependencies over a recording transaction. `openCases` says what each read of a target's open case
 * answers, in order: a case's id, or null for none; when a target's answers run out, its last one is repeated.
 */
function recording(openCases: Record<string, (string | null)[]>) {
  const dialect = new PgDialect();
  const events: string[] = [];
  const reads: Record<string, number> = {};
  let runs = 0;
  const tx = {
    execute: async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      const statement = text.trim();
      if (statement.startsWith("select set_config('lock_timeout'")) return [];
      if (statement.startsWith("insert into intakes")) return events.push("intake"), [{ id: randomUUID() }];
      if (statement.startsWith("insert into cases")) return events.push(`open ${String(params[0])} ${String(params[1])}`), [];
      if (statement.startsWith("select id from cases")) {
        const target = String(params[1]);
        const answers = openCases[target] ?? [`case-of-${target}`];
        const answer = answers[Math.min(reads[target] ?? 0, answers.length - 1)];
        reads[target] = (reads[target] ?? 0) + 1;
        events.push(`read ${String(params[0])} ${target}`);
        return answer === null || answer === undefined ? [] : [{ id: answer }];
      }
      if (statement.startsWith("insert into intake_items")) return events.push(`item ${String(params[2])} ${String(params[3])} in ${String(params[1])}`), [{ id: randomUUID(), seq: 1 }];
      if (statement.startsWith("select to_char(")) return events.push("time"), [{ at: TAKEN }];
      if (statement.startsWith("select display_name, bio, handle from evidence_snapshots")) return [];
      if (statement.startsWith("insert into evidence_snapshots")) return events.push(`snapshot ${String(params[1])} ${String(params[2])}`), [{ id: randomUUID(), taken_at: TAKEN }];
      throw new Error(`the intake issued a statement this test does not know: ${statement}`);
    },
  };
  const social = {
    lockAccounts: async () => (events.push("lock sender"), []),
    capturePost: async (_tx: unknown, id: string) => (
      events.push(`copy post ${id}`),
      { id, authorId: randomUUID(), authorHandle: "author", body: "a post", state: "visible", createdAt: new Date(TAKEN), replyToId: null, quoteOfId: null, erased: false }
    ),
    captureProfile: async (_tx: unknown, id: string) => (events.push(`copy account ${id}`), { id, handle: "named", displayName: "Named", bio: "", deleted: false }),
  };
  const apiDb = {
    transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => {
      runs++;
      events.push(`run ${runs}`);
      return fn(tx);
    },
  };
  const deps = { apiDb, social, config: {}, log: pino({ level: "silent" }), now: () => new Date() } as unknown as ModerationDeps;
  return { deps, events, runs: () => runs };
}

/** The targets in an order that is not the cases' own: the account first, then the later post, then the earlier one. */
const live: LiveTarget[] = [
  { type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" },
  { type: "post", id: POST_TWO, position: 2 },
  { type: "post", id: POST_ONE, position: 3 },
];

describe("the intake's transaction keeps one order", () => {
  test("every case with its item first, posts before accounts and each kind by id, whatever order the request names them in; only then the copies, in that same order", async () => {
    const world = recording({});
    const recorded = await recordIntake(world.deps, { ground, live });
    expect(world.events).toEqual([
      "run 1",
      "lock sender",
      "intake",
      `open post ${POST_ONE}`,
      `read post ${POST_ONE}`,
      `item post ${POST_ONE} in case-of-${POST_ONE}`,
      `open post ${POST_TWO}`,
      `read post ${POST_TWO}`,
      `item post ${POST_TWO} in case-of-${POST_TWO}`,
      `open account ${ACCOUNT}`,
      `read account ${ACCOUNT}`,
      `item account ${ACCOUNT} in case-of-${ACCOUNT}`,
      // No post is copied, and so none is locked, before the last case is taken.
      "time",
      `copy post ${POST_ONE}`,
      `snapshot post ${POST_ONE}`,
      `copy post ${POST_TWO}`,
      `snapshot post ${POST_TWO}`,
      `copy account ${ACCOUNT}`,
      `snapshot account ${ACCOUNT}`,
    ]);
    // The answer lists the items as the request named them.
    expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([[1, ACCOUNT], [2, POST_TWO], [3, POST_ONE]]);
    // The same request in another order issues the same statements.
    const reversed = recording({});
    await recordIntake(reversed.deps, { ground, live: [...live].reverse() });
    expect(reversed.events).toEqual(world.events);
  });

  test("a target whose open case is read as none twice and found the third time stays in one run: the insert and the read are repeated in the same transaction", async () => {
    const world = recording({ [POST_ONE]: [null, null, "the-new-case"] });
    await recordIntake(world.deps, { ground, live: [{ type: "post", id: POST_ONE, position: 1 }] });
    expect(world.runs()).toBe(1);
    const pair = [`open post ${POST_ONE}`, `read post ${POST_ONE}`];
    expect(world.events).toEqual(["run 1", "lock sender", "intake", ...pair, ...pair, ...pair, `item post ${POST_ONE} in the-new-case`, "time", `copy post ${POST_ONE}`, `snapshot post ${POST_ONE}`]);
  });

  test("three reads that find none start the transaction over, with no item stored without a case; after the fourth run the answer is case_closed", async () => {
    const world = recording({ [POST_TWO]: [null] });
    const err = await recordIntake(world.deps, { ground, live: [{ type: "post", id: POST_ONE, position: 1 }, { type: "post", id: POST_TWO, position: 2 }] }).catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(ModerationError);
    expect(err).toMatchObject({ code: "case_closed", status: 409 });
    expect(world.runs()).toBe(4);
    const pair = [`open post ${POST_TWO}`, `read post ${POST_TWO}`];
    const oneRun = (run: number) => [`run ${run}`, "lock sender", "intake", `open post ${POST_ONE}`, `read post ${POST_ONE}`, `item post ${POST_ONE} in case-of-${POST_ONE}`, ...pair, ...pair, ...pair];
    expect(world.events).toEqual([...oneRun(1), ...oneRun(2), ...oneRun(3), ...oneRun(4)]);
    // A target found on a later run is stored then: the third run's reads answer a case.
    const later = recording({ [POST_TWO]: [null, null, null, null, null, null, "a-case-at-last"] });
    const recorded = await recordIntake(later.deps, { ground, live: [{ type: "post", id: POST_TWO, position: 1 }] });
    expect(later.runs()).toBe(3);
    expect(recorded.items.map((item) => item.caseId)).toEqual(["a-case-at-last"]);
  });
});
