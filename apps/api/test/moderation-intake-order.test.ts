import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ModerationError, type ModerationDeps } from "../src/moderation/context";
import { recordIntake, type IntakeGround, type LiveTarget } from "../src/moderation/intake";

/**
 * The order of the intake's transaction (3c design, section 7.1, step 4), without a database: the transaction is a
 * stand-in that records every statement in the order it is issued and answers each as the test scripts it, the social
 * module is one that records what it is asked to lock and to copy, and the media module one that records the pairs it is
 * asked to hold and answers each post with one image. What the statements do to real rows is in the integration tests;
 * this holds only their order and how often a target's open case is read.
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
function recording(openCases: Record<string, (string | null)[]>, pictured: readonly string[] = []) {
  const dialect = new PgDialect();
  const events: string[] = [];
  const reads: Record<string, number> = {};
  /** What each stored snapshot lists as the target's images. */
  const snapshots: { target: string; media: unknown }[] = [];
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
      // The insert answers the position and the lane the database stored: for an item that is no re-examination, the ones it was given.
      if (statement.startsWith("insert into intake_items")) {
        return events.push(`item ${String(params[2])} ${String(params[3])} in ${String(params[1])}`), [{ id: randomUUID(), seq: 1, position: Number(params[4]), lane: Number(params[5]) }];
      }
      if (statement.startsWith("select to_char(")) return events.push("time"), [{ at: TAKEN }];
      // 2d Task 4: the newest snapshot's fields and, since the account's picture is evidence too, its media's ids.
      if (statement.startsWith("select display_name, bio, handle")) return [];
      if (statement.startsWith("insert into evidence_snapshots")) {
        snapshots.push({ target: String(params[2]), media: params[9] === null ? null : JSON.parse(String(params[9])) });
        return events.push(`snapshot ${String(params[1])} ${String(params[2])}`), [{ id: randomUUID(), taken_at: TAKEN }];
      }
      // 3e's review (database1): the closing judgment of a signed-in sender under a rule, the transaction's last read.
      if (statement.startsWith("select p.deleted_at is not null as deleted")) return events.push("judge sender"), [{ deleted: false, suspended: false, reports_restricted: false }];
      throw new Error(`the intake issued a statement this test does not know: ${statement}`);
    },
  };
  /**
   * The media module's hold: every pair it was given, in order, and one image for each post it was asked to hold. 2d Task
   * 4: an account's pair answers its picture when the account is among `pictured`, else an empty list.
   */
  const media = {
    hold: async (within: unknown, pairs: readonly ({ caseId: string; postId: string } | { ownerId: string } | { caseId: string; accountId: string })[]) => {
      if (within !== tx) throw new Error("the hold ran outside the intake's transaction");
      const named = (pair: (typeof pairs)[number]) => ("postId" in pair ? `post ${pair.postId} for ${pair.caseId}` : "accountId" in pair ? `account ${pair.accountId} for ${pair.caseId}` : `owner ${pair.ownerId}`);
      events.push(`hold ${pairs.map(named).join(", ") || "nothing"}`);
      type Held = { id: string; alt: string | null; width: number; height: number };
      const answered: [string, Held[]][] = pairs.flatMap((pair): [string, Held[]][] =>
        "postId" in pair
          ? [[pair.postId, [{ id: `image-of-${pair.postId}`, alt: "an image", width: 1200, height: 800 }]]]
          : "accountId" in pair
            ? [[pair.accountId, pictured.includes(pair.accountId) ? [{ id: `picture-of-${pair.accountId}`, alt: null, width: 400, height: 400 }] : []]]
            : [],
      );
      return new Map(answered);
    },
  };
  const social = {
    // 3e: each row says whether its account is suspended and restricted in its reports; this sender is neither.
    lockAccounts: async (_tx: unknown, ids: readonly string[]) => (events.push("lock sender"), ids.map((id) => ({ id, deleted: false, suspended: false, reportsRestricted: false }))),
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
  const deps = { apiDb, social, media, config: {}, log: pino({ level: "silent" }), now: () => new Date() } as unknown as ModerationDeps;
  return { deps, events, snapshots, runs: () => runs };
}

/** The targets in an order that is not the cases' own: the account first, then the later post, then the earlier one. */
const live: LiveTarget[] = [
  { type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" },
  { type: "post", id: POST_TWO, position: 2 },
  { type: "post", id: POST_ONE, position: 3 },
];

describe("the intake's transaction keeps one order", () => {
  test("every case with its item first, posts before accounts and each kind by id, whatever order the request names them in; then the copies, in that same order; then one hold for the whole intake; only then the snapshots", async () => {
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
      `copy post ${POST_TWO}`,
      `copy account ${ACCOUNT}`,
      // No image row is locked before the last post is: one hold, a pair for each post with its case, in the cases' order.
      // 2d Task 4 (7.7): and the account's case's pair for its picture, which its snapshot lists by reference.
      `hold post ${POST_ONE} for case-of-${POST_ONE}, post ${POST_TWO} for case-of-${POST_TWO}, account ${ACCOUNT} for case-of-${ACCOUNT}`,
      `snapshot post ${POST_ONE}`,
      `snapshot post ${POST_TWO}`,
      `snapshot account ${ACCOUNT}`,
      // Last, after every lock: the sender is judged again by the clock, so a suspension that started while it waited counts.
      "judge sender",
    ]);
    // A post's snapshot lists the images the hold answered for it; an account without a picture lists none (null).
    expect(world.snapshots).toEqual([
      { target: POST_ONE, media: [{ id: `image-of-${POST_ONE}`, alt: "an image", width: 1200, height: 800 }] },
      { target: POST_TWO, media: [{ id: `image-of-${POST_TWO}`, alt: "an image", width: 1200, height: 800 }] },
      { target: ACCOUNT, media: null },
    ]);
    // The answer lists the items as the request named them.
    expect(recorded.items.map((item) => [item.position, item.targetId])).toEqual([[1, ACCOUNT], [2, POST_TWO], [3, POST_ONE]]);
    // The same request in another order issues the same statements.
    const reversed = recording({});
    await recordIntake(reversed.deps, { ground, live: [...live].reverse() });
    expect(reversed.events).toEqual(world.events);
  });

  test("a report of child sexual abuse material that names an account brings the pair that only locks the account's images, after the posts' pairs; no other report of an account does", async () => {
    const csam: IntakeGround = { ...ground, channel: "signed_out", reporterId: null, ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" };
    const world = recording({});
    await recordIntake({ ...world.deps, social: { ...world.deps.social, postRef: async () => ({ authorId: ACCOUNT, state: "visible", quoteOfId: null }) } } as ModerationDeps, { ground: csam, live });
    expect(world.events.filter((event) => event.startsWith("hold"))).toEqual([
      `hold post ${POST_ONE} for case-of-${POST_ONE}, post ${POST_TWO} for case-of-${POST_TWO}, account ${ACCOUNT} for case-of-${ACCOUNT}, owner ${ACCOUNT}`,
    ]);
    // An account alone, reported under a rule: the hold is asked once, for its picture alone (2d Task 4).
    const plain = recording({});
    await recordIntake(plain.deps, { ground, live: [{ type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" }] });
    expect(plain.events.filter((event) => event.startsWith("hold"))).toEqual([`hold account ${ACCOUNT} for case-of-${ACCOUNT}`]);
  });

  test("2d Task 4 (7.7): an account with a picture: its snapshot lists the picture the hold answered, by reference", async () => {
    const world = recording({}, [ACCOUNT]);
    await recordIntake(world.deps, { ground, live: [{ type: "account", id: ACCOUNT, position: 1, namedHandle: "Named" }] });
    expect(world.snapshots).toEqual([{ target: ACCOUNT, media: [{ id: `picture-of-${ACCOUNT}`, alt: null, width: 400, height: 400 }] }]);
  });

  test("a target whose open case is read as none twice and found the third time stays in one run: the insert and the read are repeated in the same transaction", async () => {
    const world = recording({ [POST_ONE]: [null, null, "the-new-case"] });
    await recordIntake(world.deps, { ground, live: [{ type: "post", id: POST_ONE, position: 1 }] });
    expect(world.runs()).toBe(1);
    const pair = [`open post ${POST_ONE}`, `read post ${POST_ONE}`];
    expect(world.events).toEqual(["run 1", "lock sender", "intake", ...pair, ...pair, ...pair, `item post ${POST_ONE} in the-new-case`, "time", `copy post ${POST_ONE}`, `hold post ${POST_ONE} for the-new-case`, `snapshot post ${POST_ONE}`, "judge sender"]);
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
