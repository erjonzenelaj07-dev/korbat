import type { StaffMe } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { ApiError } from "../src/api";
import { createIdleTimer, IDLE_MS, WARNING_MS, type IdleWarning } from "../src/idle";
import { FakeClock, makeMe } from "./fixtures";

/**
 * The idle timer (3a design, section 9), on a clock the test moves. The console counts nothing itself: it restarts at 15
 * minutes (or the time left to the absolute end) after each request its person's action started, reads /me without the
 * activity mark two minutes before the end, and then either follows what the server says (another tab may have acted)
 * or warns.
 */
const MIN = 60_000;

/** A timer whose reads of /me answer from `answers`, one per read, and fail like a 401 once they run out. */
function timer(answers: (StaffMe | ApiError)[]) {
  const clock = new FakeClock();
  const reads: number[] = [];
  const warnings: (IdleWarning | null)[] = [];
  const seen: StaffMe[] = [];
  const idle = createIdleTimer({
    clock,
    readMe: async () => {
      reads.push(clock.now());
      const next = answers.shift() ?? new ApiError(401, "staff_session_required", "ended");
      if (next instanceof ApiError) throw next;
      return next;
    },
    onWarning: (warning) => warnings.push(warning),
    onMe: (me) => seen.push(me),
  });
  const lastWarning = () => (warnings.length === 0 ? null : warnings[warnings.length - 1]!);
  return { clock, idle, reads, warnings, seen, lastWarning };
}

describe("the idle timer", () => {
  test("the limits: 15 minutes, and a warning two minutes before the end", () => {
    expect(IDLE_MS).toBe(15 * MIN);
    expect(WARNING_MS).toBe(2 * MIN);
  });

  test("reads /me at 13 minutes of a full idle period, not before", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([13 * MIN]);
  });

  test("restarts at 15 minutes when a marked request succeeds", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(10 * MIN);
    t.idle.restart();
    await t.clock.advance(12 * MIN);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1 * MIN);
    expect(t.reads).toEqual([23 * MIN]);
  });

  test("another tab's activity moves the end: more than two minutes left sets the timer from the answer, with no warning", async () => {
    const t = timer([makeMe({ idle: 600 }), makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.reads).toEqual([13 * MIN]);
    expect(t.lastWarning()).toBeNull();
    expect(t.seen).toHaveLength(1);
    // 600 seconds left at 13 minutes: the next read is two minutes before that end, at 21 minutes.
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toHaveLength(1);
    await t.clock.advance(1);
    expect(t.reads).toEqual([13 * MIN, 21 * MIN]);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
  });

  test("two minutes or less: the warning with Stay signed in, which a marked success clears", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    // "Stay signed in" sends one marked GET /me; its success restarts the timer.
    await t.clock.advance(30_000);
    t.idle.restart();
    expect(t.lastWarning()).toBeNull();
    await t.clock.advance(13 * MIN - 1);
    expect(t.reads).toHaveLength(1);
    await t.clock.advance(1);
    expect(t.reads).toHaveLength(2);
  });

  test("when the timer runs out it reads /me once more and follows the answer", async () => {
    const t = timer([makeMe({ idle: 120 }), makeMe({ idle: 840 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    await t.clock.advance(2 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    // Another tab acted meanwhile: 14 minutes left, so the warning goes and the next read is at 15 + 12 minutes.
    expect(t.lastWarning()).toBeNull();
    await t.clock.advance(12 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN, 27 * MIN]);
  });

  test("when the timer runs out on a session that ended, it stops: the 401 has already shown sign-in", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(15 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    expect(t.clock.pending).toBe(0);
    await t.clock.advance(60 * MIN);
    expect(t.reads).toHaveLength(2);
  });

  test("the absolute end, when nearer, sets the timer, and its warning names the time and offers no button", async () => {
    const me = makeMe({ idle: 900, absolute: 600 });
    const t = timer([makeMe({ idle: 120, absolute: 120 })]);
    t.idle.start({ ...me, idleSecondsLeft: 600, idleExpiresAt: me.absoluteExpiresAt });
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([8 * MIN]);
    const warning = t.lastWarning();
    expect(warning).toEqual({ kind: "absolute", endsAt: makeMe({ idle: 120, absolute: 120 }).absoluteExpiresAt });
    // A marked success restarts the timer, but nothing moves the absolute end: the warning stays.
    t.idle.restart();
    expect(t.lastWarning()).toEqual(warning);
  });

  test("a marked success never sets the timer past the absolute end", async () => {
    const t = timer([makeMe({ idle: 120, absolute: 120 })]);
    t.idle.start(makeMe({ idle: 900, absolute: 1200 }));
    await t.clock.advance(10 * MIN);
    // 10 minutes left to the absolute end: the timer restarts at 10, not 15, so it reads at 18 minutes.
    t.idle.restart();
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([18 * MIN]);
    expect(t.lastWarning()).toMatchObject({ kind: "absolute" });
  });

  test("a session that starts with two minutes or less left warns at once", async () => {
    const t = timer([]);
    t.idle.start(makeMe({ idle: 90 }));
    expect(t.lastWarning()).toEqual({ kind: "idle" });
  });

  test("a read that fails for another reason keeps the timer going on what it knew", async () => {
    const t = timer([new ApiError(0, "network", "down"), makeMe({ idle: 840 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    await t.clock.advance(2 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    expect(t.lastWarning()).toBeNull();
  });

  test("stopped, it reads nothing and a restart does not start it again", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    t.idle.stop();
    t.idle.restart();
    await t.clock.advance(60 * MIN);
    expect(t.reads).toEqual([]);
    expect(t.clock.pending).toBe(0);
  });

  test("an answer that arrives after a restart is not allowed to undo it", async () => {
    let release: (me: StaffMe) => void = () => undefined;
    const clock = new FakeClock();
    const warnings: (IdleWarning | null)[] = [];
    const reads: number[] = [];
    const idle = createIdleTimer({
      clock,
      readMe: () => {
        reads.push(clock.now());
        return new Promise<StaffMe>((resolve) => {
          release = resolve;
        });
      },
      onWarning: (w) => warnings.push(w),
      onMe: () => undefined,
    });
    idle.start(makeMe({ idle: 900 }));
    await clock.advance(13 * MIN);
    idle.restart();
    release(makeMe({ idle: 60 }));
    await clock.advance(1);
    expect(warnings.filter((w) => w !== null)).toEqual([]);
    await clock.advance(13 * MIN);
    expect(reads).toEqual([13 * MIN, 26 * MIN]);
  });
});
