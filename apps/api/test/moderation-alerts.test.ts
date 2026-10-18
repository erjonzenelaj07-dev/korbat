import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { ALERT_KINDS } from "@korbat/contracts";
import type { AuthForModeration, StaffMessage } from "../src/auth";
import { MemoryStore, type RateLimitStore } from "../src/middleware/rate-limit";
import { URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, alertFacts, alertUrgentLane, staffAlert } from "../src/moderation/alerts";
import { createBackground, type ModerationDeps } from "../src/moderation/context";

/**
 * The staff alerts' throttle, their second leg and the work a request starts without waiting for it (3c design, sections
 * 7.1 step 5 and 7.12; 3f design, sections 5 and 7.2), without a database: the limit store is the in-memory one or a
 * stand-in that fails, the auth module a stand-in that takes, or does not take, the mail, and the database a stand-in
 * that records each statement. After the throttle, staffAlert writes one row of alert_outbox, which the watcher pushes,
 * then mails as 3c did; for 3c's and 3e's kinds, whose mail says more than the row's facts, it then marks the row mailed
 * whether or not an address took the mail, so the alert tick never renders such a mail from a row.
 */

const message: StaffMessage = { template: "moderation_urgent", count: 2, oldest: new Date("2026-10-04T06:59:59.123Z") };
const dialect = new PgDialect();

/** What the alert needs: a store, an auth module whose mailStaff answers as scripted, a log that keeps its warnings, and a database that records. */
function world(options: { accepted?: number[]; limits?: RateLimitStore; waiting?: { n: number; oldest: string | null }; insertFails?: boolean } = {}) {
  let now = 1_000_000;
  const store = options.limits ?? new MemoryStore(() => now);
  const mails: StaffMessage[] = [];
  const warnings: string[] = [];
  const accepted = [...(options.accepted ?? [])];
  const statements: { text: string; params: unknown[] }[] = [];
  /** The order of what happened: each row written, each mail, each row marked mailed. */
  const order: string[] = [];
  let ids = 40;
  const execute = async (statement: SQL) => {
    const q = dialect.sqlToQuery(statement);
    statements.push({ text: q.sql, params: q.params });
    if (/insert into public[.]alert_outbox/.test(q.sql)) {
      if (options.insertFails) throw new Error("the database refused the row");
      order.push(`row ${q.params[0]}`);
      return [{ id: String(++ids) }];
    }
    if (/update public[.]alert_outbox set mailed_at/.test(q.sql)) {
      order.push("marked");
      return [];
    }
    // The one read the urgent alert makes: how many cases wait in the urgent lane, and since when.
    return [options.waiting ?? { n: 2, oldest: "2026-10-04T06:59:59.123Z" }];
  };
  const deps = {
    limits: store,
    auth: {
      mailStaff: async (sent: StaffMessage) => {
        mails.push(sent);
        order.push(`mail ${sent.template}`);
        return accepted.length > 0 ? accepted.shift()! : 1;
      },
    } as unknown as AuthForModeration,
    log: { warn: (_fields: unknown, text: string) => warnings.push(text), error: (_fields: unknown, text: string) => warnings.push(text) } as unknown as ModerationDeps["log"],
    apiDb: { execute, transaction: async <T>(run: (tx: { execute: typeof execute }) => Promise<T>) => run({ execute }) } as unknown as ModerationDeps["apiDb"],
  };
  const rows = () => statements.filter((s) => /insert into public[.]alert_outbox/.test(s.text)).map((s) => s.params);
  return { deps, mails, warnings, store, statements, order, rows, advance: (ms: number) => (now += ms) };
}

describe("a staff alert is sent at most once in its key's window", () => {
  test("the first goes, the next within the window do not, and one after the window goes again", async () => {
    const w = world();
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    // Another alert has a key of its own.
    expect(await staffAlert(w.deps, "other", 60_000, message)).toBe("sent");
    w.advance(60_001);
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(w.mails).toEqual([message, message, message]);
    // A throttled alert writes no row either.
    expect(w.rows()).toHaveLength(3);
  });

  test("when no address took the mail of one of 3c's kinds, its push still goes, and the hit is given back: the next occasion mails again", async () => {
    const w = world({ accepted: [0, 0, 2] });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    expect(w.mails).toHaveLength(3);
    expect(w.rows()).toHaveLength(3);
    expect(w.warnings).toEqual([]);
  });

  test("with neither leg taking it (no row and no address), the answer is unsent and the hit is given back", async () => {
    const w = world({ accepted: [0, 1], insertFails: true });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(w.mails).toHaveLength(2);
    // The failed row is logged, and the mail goes all the same: an alert fails open.
    expect(w.warnings).toEqual(["moderation alert: its row for the phones could not be written; the mail goes all the same", "moderation alert: its row for the phones could not be written; the mail goes all the same"]);
  });

  test("a hit that cannot be given back is logged, never thrown", async () => {
    const hits = new MemoryStore();
    const limits: RateLimitStore = {
      hit: (key, windowMs) => hits.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    const w = world({ accepted: [0], limits });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(w.warnings).toEqual(["moderation alert: the hit of an alert nobody received could not be given back"]);
  });

  test("an alert fails open: when the store cannot be reached the row and the mail go anyway, every time, and nothing is given back", async () => {
    let released = 0;
    const limits: RateLimitStore = {
      hit: async () => {
        throw new Error("the store cannot be reached");
      },
      release: async () => {
        released++;
      },
    };
    const w = world({ accepted: [1, 0], limits });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(w.mails).toHaveLength(2);
    expect(w.rows()).toHaveLength(2);
    expect(released).toBe(0);
    expect(w.warnings).toHaveLength(2);
  });

  test("without a key (a reveal, a decision that lifted the protection of reported images) nothing throttles it", async () => {
    const w = world();
    const reveal: StaffMessage = { template: "moderation_reveal", handle: "mod_anna", at: new Date("2026-10-04T07:00:00.000Z"), count: 1, limit: 10 };
    expect(await staffAlert(w.deps, null, 0, reveal)).toBe("sent");
    expect(await staffAlert(w.deps, null, 0, reveal)).toBe("sent");
    expect(w.mails).toEqual([reveal, reveal]);
    expect(w.rows()).toHaveLength(2);
  });
});

describe("the alert's second leg (3f design, section 7.2)", () => {
  test("the row is written first, with the kind's priority and scope and its counts and times, then the mail, then the row is marked mailed", async () => {
    const w = world();
    await staffAlert(w.deps, "k", 60_000, message);
    expect(w.order).toEqual(["row moderation_urgent", "mail moderation_urgent", "marked"]);
    const [kind, priority, scope, facts] = w.rows()[0]!;
    expect([kind, priority, scope]).toEqual(["moderation_urgent", ALERT_KINDS.moderation_urgent.priority, ALERT_KINDS.moderation_urgent.scope]);
    expect(JSON.parse(String(facts))).toEqual({ count: 2, oldestAt: "2026-10-04T06:59:59.123Z" });
  });

  test("a mail of 3c's kinds that no address took is marked all the same: the tick never renders such a mail from a row", async () => {
    const w = world({ accepted: [0] });
    await staffAlert(w.deps, "k", 60_000, message);
    expect(w.order).toEqual(["row moderation_urgent", "mail moderation_urgent", "marked"]);
  });

  test("the facts of 3c's and 3e's six kinds name nobody: counts and times only, under the names ALERT_KINDS gives", () => {
    const at = new Date("2026-10-04T07:00:00.000Z");
    const kinds: [StaffMessage, Record<string, number | string>][] = [
      [message, { count: 2, oldestAt: "2026-10-04T06:59:59.123Z" }],
      [{ template: "moderation_waiting", lanes: [{ lane: 0, count: 2, oldest: at }, { lane: 2, count: 1, oldest: at }], interim: 3, replies: { count: 1, oldest: at } }, { count: 7 }],
      [{ template: "moderation_waiting", lanes: [], interim: 1 }, { count: 1 }],
      [{ template: "moderation_burst", handle: "mod_anna", count: 20 }, { count: 20 }],
      [{ template: "moderation_reads", handle: "mod_anna", limit: 200 }, { limit: 200 }],
      [{ template: "moderation_reveal", handle: "mod_anna", at, count: 1, limit: 10 }, { at: "2026-10-04T07:00:00.000Z" }],
      [{ template: "moderation_csam_lifted", handle: "mod_anna", at, what: "unsealed" }, { at: "2026-10-04T07:00:00.000Z" }],
    ];
    for (const [sent, facts] of kinds) {
      expect(alertFacts(sent), sent.template).toEqual(facts);
      expect(Object.keys(facts).every((name) => ALERT_KINDS[sent.template as keyof typeof ALERT_KINDS].facts.includes(name)), sent.template).toBe(true);
    }
  });
});

describe("the urgent lane's alert", () => {
  test("tells how many cases wait in the urgent lane and since when the oldest does, under its own key and a 15-minute window", async () => {
    expect([URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS]).toEqual(["moderation-urgent", 15 * 60_000]);
    const w = world({ waiting: { n: 3, oldest: "2026-10-04T06:59:59.123Z" } });
    expect(await alertUrgentLane(w.deps)).toBe("sent");
    expect(w.mails).toEqual([{ template: "moderation_urgent", count: 3, oldest: new Date("2026-10-04T06:59:59.123Z") }]);
    expect(await alertUrgentLane(w.deps)).toBe("throttled");
    w.advance(15 * 60_000 + 1);
    expect(await alertUrgentLane(w.deps)).toBe("sent");
    // The key is the one the dispatch job repeats the alert under.
    expect((await w.store.hit("moderation-urgent", URGENT_ALERT_WINDOW_MS)).count).toBe(2);
  });

  test("with nothing waiting any more, nothing is sent and no window is opened", async () => {
    const w = world({ waiting: { n: 0, oldest: null } });
    expect(await alertUrgentLane(w.deps)).toBe("nothing_waiting");
    expect(w.mails).toEqual([]);
    expect((await w.store.hit(URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS)).count).toBe(1);
  });
});

describe("the work a request starts and does not wait for", () => {
  test("settle resolves once every task has ended, those started meanwhile included; a task that throws is logged and stops nothing", async () => {
    const errors: unknown[] = [];
    const background = createBackground({ error: (fields: { err: unknown }) => errors.push(fields.err) } as unknown as pino.Logger);
    const done: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    background.start(async () => {
      await held;
      done.push("first");
      // A task may start another: settle waits for that one too.
      background.start(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done.push("started meanwhile");
      });
    });
    const failure = new Error("the relay fell over");
    background.start(async () => {
      throw failure;
    });
    let settled = false;
    const settling = background.settle().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(errors).toEqual([failure]);
    release();
    await settling;
    expect(done).toEqual(["first", "started meanwhile"]);
    // With nothing running, settle resolves at once.
    await background.settle();
  });
});
