import { describe, expect, test } from "vitest";
import { MENTION_NOTIFY_MAX, MENTION_SCAN_MAX, MENTION_STORE_MAX, MENTION_TOKEN, mentionHandles } from "../src/index";

/**
 * 2d's one tokenizer of mentions (design, section 4.1; tests of 12.2). Line breaks are built here by code, so this file
 * holds no control character.
 */
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);

/** Every handle the token itself finds, in order and as written: no folding, no repeats removed, no cap. */
const tokens = (body: string) => [...body.matchAll(new RegExp(MENTION_TOKEN.source, MENTION_TOKEN.flags))].map((match) => match[1]);

describe("MENTION_TOKEN", () => {
  test("is the design's token: an @ with no handle character before it, 3 to 20 handle characters, none after them, global", () => {
    expect(MENTION_TOKEN.source).toBe("(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])");
    expect(MENTION_TOKEN.flags).toBe("g");
  });

  test("the right boundary: a run longer than 20 handle characters is no mention at all, never its first 20", () => {
    const run = "abcdefghijklmnopqrstuvwxyz";
    expect(run).toHaveLength(26);
    expect(tokens(`@${run}`)).toEqual([]);
    expect(tokens(`@${run.slice(0, 21)}`)).toEqual([]);
    expect(tokens(`@${run.slice(0, 20)}`)).toEqual([run.slice(0, 20)]);
    expect(tokens(`@${run.slice(0, 3)}`)).toEqual(["abc"]);
    expect(tokens(`@${run.slice(0, 2)}`)).toEqual([]);
  });

  test("an e-mail address is no mention: the @ follows a letter", () => {
    expect(tokens("write to ada@example.org today")).toEqual([]);
    expect(tokens("ada_@bob")).toEqual([]);
    expect(tokens("2024@bob")).toEqual([]);
  });

  test("_ and digits belong to a handle at either edge, and a handle character before the @ or after the run refuses it", () => {
    expect(tokens("@_ada_")).toEqual(["_ada_"]);
    expect(tokens("@123")).toEqual(["123"]);
    expect(tokens("@9ada9")).toEqual(["9ada9"]);
    expect(tokens("x_@ada")).toEqual([]);
    expect(tokens("7@ada")).toEqual([]);
    // The second @ follows a handle character, so only the first handle counts.
    expect(tokens("@ada@bob")).toEqual(["ada"]);
  });

  test("punctuation, spaces, tabs and line breaks end a handle on either side", () => {
    expect(tokens("(@ada), @bob. @cat! @dan? @eve: @fay; @gus- @hal'")).toEqual(["ada", "bob", "cat", "dan", "eve", "fay", "gus", "hal"]);
    expect(tokens(`hi${LF}@ada${LF}@bob${CR}${LF}@cat${TAB}@dan`)).toEqual(["ada", "bob", "cat", "dan"]);
    expect(tokens("@@ada")).toEqual(["ada"]);
  });
});

describe("mentionHandles", () => {
  test("the handles in text order, lowercased, each once", () => {
    expect(mentionHandles("@Bob met @ada and @ADA, then @bob again, and @cat")).toEqual(["bob", "ada", "cat"]);
    expect(mentionHandles("no mention here")).toEqual([]);
    expect(mentionHandles("")).toEqual([]);
  });

  test("a retired_ handle is matched like any other: 3e's placeholder is an account's current handle", () => {
    expect(mentionHandles("ask @retired_0a1b2c3d4e")).toEqual(["retired_0a1b2c3d4e"]);
  });

  test("reads at most MENTION_SCAN_MAX distinct handles; repeats of one already read do not count towards the cap", () => {
    expect(MENTION_SCAN_MAX).toBe(40);
    // 200 handles of three characters: "@h" and two base-36 digits, then a space, fill 999 characters.
    const handles = Array.from({ length: 200 }, (_, n) => `h${n.toString(36).padStart(2, "0")}`);
    const body = handles.map((handle) => `@${handle}`).join(" ");
    expect(body.length).toBeLessThanOrEqual(1000);
    expect(mentionHandles(body)).toEqual(handles.slice(0, MENTION_SCAN_MAX));
    const repeated = [...Array.from({ length: 50 }, () => "@ada"), ...handles.slice(0, 45).map((handle) => `@${handle}`)].join(" ");
    expect(mentionHandles(repeated)).toEqual(["ada", ...handles.slice(0, MENTION_SCAN_MAX - 1)]);
  });

  test("shares no lastIndex with MENTION_TOKEN: two calls in a row answer the same, whatever the token's state", () => {
    const body = "@ada and @bob";
    expect(mentionHandles(body)).toEqual(["ada", "bob"]);
    expect(mentionHandles(body)).toEqual(["ada", "bob"]);
    // A caller that runs the global token by hand leaves its lastIndex part way through a text.
    MENTION_TOKEN.lastIndex = 0;
    expect(MENTION_TOKEN.exec(body)?.[1]).toBe("ada");
    expect(MENTION_TOKEN.lastIndex).toBeGreaterThan(0);
    expect(mentionHandles(body)).toEqual(["ada", "bob"]);
    MENTION_TOKEN.lastIndex = 0;
  });

  test("the store and notify caps of decision 12", () => {
    expect(MENTION_STORE_MAX).toBe(20);
    expect(MENTION_NOTIFY_MAX).toBe(10);
    expect(MENTION_NOTIFY_MAX).toBeLessThan(MENTION_STORE_MAX);
    expect(MENTION_STORE_MAX).toBeLessThan(MENTION_SCAN_MAX);
  });
});
