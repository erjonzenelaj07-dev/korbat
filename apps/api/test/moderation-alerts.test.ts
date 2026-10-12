import pino from "pino";
import { describe, expect, test } from "vitest";
import type { AuthForModeration, StaffMessage } from "../src/auth";
import { MemoryStore, type RateLimitStore } from "../src/middleware/rate-limit";
import { URGENT_ALERT_KEY, URGENT_ALERT_WINDOW_MS, alertUrgentLane, staffAlert } from "../src/moderation/alerts";
import { createBackground, type ModerationDeps } from "../src/moderation/context";

/**
 * The staff alerts' throttle and the work a request starts without waiting for it (3c design, sections 7.1 step 5 and
 * 7.12), without a database: the limit store is the in-memory one or a stand-in that fails, and the auth module is a
 * stand-in that takes, or does not take, the mail.
 */

const message: StaffMessage = { template: "moderation_urgent", count: 2, oldest: new Date("2026-10-04T06:59:59.123Z") };

/** What the alert needs: a store, an auth module whose mailStaff answers as scripted, and a log that keeps its warnings. */
function world(options: { accepted?: number[]; limits?: RateLimitStore; waiting?: { n: number; oldest: string | null } } = {}) {
  let now = 1_000_000;
  const store = options.limits ?? new MemoryStore(() => now);
  const mails: StaffMessage[] = [];
  const warnings: string[] = [];
  const accepted = [...(options.accepted ?? [])];
  const deps = {
    limits: store,
    auth: {
      mailStaff: async (sent: StaffMessage) => {
        mails.push(sent);
        return accepted.length > 0 ? accepted.shift()! : 1;
      },
    } as unknown as AuthForModeration,
    log: { warn: (_fields: unknown, text: string) => warnings.push(text) } as unknown as ModerationDeps["log"],
    // The one read the urgent alert makes: how many cases wait in the urgent lane, and since when.
    apiDb: { execute: async () => [options.waiting ?? { n: 2, oldest: "2026-10-04T06:59:59.123Z" }] } as unknown as ModerationDeps["apiDb"],
  };
  return { deps, mails, warnings, store, advance: (ms: number) => (now += ms) };
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
  });

  test("when no address took the mail the hit is given back: the next occasion sends it again", async () => {
    const w = world({ accepted: [0, 0, 2] });
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("sent");
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("throttled");
    expect(w.mails).toHaveLength(3);
    expect(w.warnings).toEqual([]);
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
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(w.warnings).toEqual(["moderation alert: the hit of an alert nobody received could not be given back"]);
  });

  test("an alert fails open: when the store cannot be reached the mail goes anyway, every time, and nothing is given back", async () => {
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
    expect(await staffAlert(w.deps, "k", 60_000, message)).toBe("unsent");
    expect(w.mails).toHaveLength(2);
    expect(released).toBe(0);
    expect(w.warnings).toHaveLength(2);
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
