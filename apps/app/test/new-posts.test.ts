import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ASK_EVERY_MS, createNewPosts, FIRST_ASK_MS, gapRows, NEW_LIMIT, newRows, pollActive } from "../src/lib/new-posts";

/**
 * New posts above the feed (UI design, decision 7, sections 8.2 and 5.2; Task 5): Following and Latest ask for their first
 * page of 50 thirty seconds after they open and every sixty seconds after, only while Home is focused, the feed is the
 * tab chosen and the page is visible; the posts newer than the list's first are put above it, and when all fifty are
 * new a gap row follows them, which reads on until it meets the posts already listed. The schedule runs on fake timers.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the schedule", () => {
  test("the first ask 30 seconds after the feed opens, then every 60 seconds", async () => {
    expect([FIRST_ASK_MS, ASK_EVERY_MS, NEW_LIMIT]).toEqual([30_000, 60_000, 50]);
    const ask = vi.fn(async () => undefined);
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ask).toHaveBeenCalledTimes(4);
    poll.dispose();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ask).toHaveBeenCalledTimes(4);
  });

  test("nothing while inactive: the clock stops and goes on from where it was", async () => {
    const ask = vi.fn(async () => undefined);
    const poll = createNewPosts(ask);
    // Not active yet (the page hidden from the start): nothing at all.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ask).not.toHaveBeenCalled();
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(20_000);
    poll.setActive(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ask).not.toHaveBeenCalled();
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    poll.dispose();
  });

  test("an ask still out is never doubled: the next one is counted from its answer", async () => {
    let answer: () => void = () => undefined;
    const ask = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ask).toHaveBeenCalledTimes(1);
    answer();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ask).toHaveBeenCalledTimes(2);
    poll.dispose();
  });

  test("a failed ask is quiet and the schedule goes on", async () => {
    const ask = vi.fn(async () => Promise.reject(new Error("offline")));
    const poll = createNewPosts(ask);
    poll.setActive(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(ask).toHaveBeenCalledTimes(2);
    poll.dispose();
  });

  test("active only on Home in focus, with an account, the feed chosen and the page visible", () => {
    const all = { focused: true, signedIn: true, selected: true, visible: true };
    expect(pollActive(all)).toBe(true);
    for (const key of Object.keys(all) as (keyof typeof all)[]) expect(pollActive({ ...all, [key]: false }), key).toBe(false);
  });
});

describe("what an ask adds", () => {
  const page = (keys: string[], nextCursor: string | null = null) => ({ items: keys.map((key) => ({ key })), nextCursor });
  const keyOf = (item: { key: string }) => item.key;
  const known = new Set(["a", "b", "c"]);

  test("the posts newer than the first one listed, in order; nothing when nothing is new", () => {
    expect(newRows(page(["x", "y", "a", "b"]), keyOf, known)).toEqual({ added: [{ key: "x" }, { key: "y" }], gapCursor: null });
    expect(newRows(page(["a", "b", "c"]), keyOf, known)).toEqual({ added: [], gapCursor: null });
    // The first listed post was deleted meanwhile: what follows the new ones is still known, and stops them.
    expect(newRows(page(["x", "b", "c"]), keyOf, known).added).toEqual([{ key: "x" }]);
  });

  test("fifty new posts and none known: a gap follows them, which reads on from the page's cursor", () => {
    const fifty = Array.from({ length: NEW_LIMIT }, (_, i) => `n${i}`);
    expect(newRows(page(fifty, "after-n49"), keyOf, known)).toEqual({ added: fifty.map((key) => ({ key })), gapCursor: "after-n49" });
    // Fewer than fifty and none known: the feed was shorter than a page, nothing is missing.
    expect(newRows(page(["x", "y"], "more"), keyOf, known)).toEqual({ added: [{ key: "x" }, { key: "y" }], gapCursor: null });
  });

  test("the gap reads until it meets a post already listed", () => {
    expect(gapRows(page(["p", "q", "a", "b"], "next"), keyOf, known)).toEqual({ added: [{ key: "p" }, { key: "q" }], gapCursor: null });
    expect(gapRows(page(["p", "q"], "next"), keyOf, known)).toEqual({ added: [{ key: "p" }, { key: "q" }], gapCursor: "next" });
    expect(gapRows(page(["p"], null), keyOf, known)).toEqual({ added: [{ key: "p" }], gapCursor: null });
  });
});
