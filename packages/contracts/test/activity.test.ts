import { describe, expect, test } from "vitest";
import {
  ACTIVITY_DEFAULTS,
  ACTIVITY_KEEP_DAYS,
  ACTIVITY_KINDS,
  ACTIVITY_MIN_AGE_HOURS,
  ACTIVITY_NEWER_CAP,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_REACH,
  ACTIVITY_TABS,
  ActivityEntry,
  ActivityNewerQuery,
  ActivityNewerResponse,
  ActivityPage,
  ActivityQuery,
  ActivitySettings,
  ActivityTime,
  SeenRequest,
  decodeActivityCursor,
  encodeActivityCursor,
} from "../src/index";

/** 2d's Activity contracts (design, sections 5.5, 5.7, 5.8 and 9.3; tests of 12.2). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = (n: number) => ({ id: id(n), handle: `user${n}`, displayName: `User ${n}`, verified: false });
const post = {
  id: id(50),
  author: author(1),
  body: "hello @ada",
  createdAt: "2026-10-27T10:00:00.000Z",
  state: "visible",
  replyTo: { id: id(51), authorHandle: "ada" },
  counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
  media: [],
  quoteOf: null,
  imported: null,
};
/** A time as the database writes it for Activity: UTC, to the microsecond. */
const AT = "2026-10-27T10:00:00.123456Z";

const postEntry = (change: Record<string, unknown> = {}) => ({ type: "post", kind: "reply", key: `e:${id(9)}`, at: AT, new: true, post, ...change });
const followsEntry = (change: Record<string, unknown> = {}) => ({ type: "follows", key: "f:2026-10-27", at: AT, new: false, count: 5, actors: [author(1), author(2), author(3)], ...change });
const moderationEntry = (change: Record<string, unknown> = {}) => ({
  type: "moderation",
  kind: "decision",
  key: `d:${id(7)}`,
  at: AT,
  new: false,
  target: "post",
  id: id(7),
  postId: id(50),
  postCreatedAt: "2026-10-27T10:00:00.000Z",
  ...change,
});
const ok = (value: unknown) => ActivityEntry.safeParse(value).success;

describe("the numbers and closed lists", () => {
  test("the kinds and the reach, in the enums' order; the tabs", () => {
    expect(ACTIVITY_KINDS).toEqual(["reply", "mention", "quote", "follow"]);
    expect(ACTIVITY_REACH).toEqual(["everyone", "older", "following", "off"]);
    expect(ACTIVITY_TABS).toEqual(["all", "conversations"]);
  });

  test("an actor 48 hours old passes `older`; entries live 90 days; 30 a page; the newer count stops at 21", () => {
    expect(ACTIVITY_MIN_AGE_HOURS).toBe(48);
    expect(ACTIVITY_KEEP_DAYS).toBe(90);
    expect(ACTIVITY_PAGE_SIZE).toBe(30);
    expect(ACTIVITY_NEWER_CAP).toBe(21);
  });
});

describe("ActivitySettings", () => {
  test("three reaches and the follow switch; an account without a row reads the defaults, Everyone and On", () => {
    expect(ActivitySettings.parse({ replies: "older", mentions: "following", quotes: "off", follows: false })).toEqual({ replies: "older", mentions: "following", quotes: "off", follows: false });
    expect(ACTIVITY_DEFAULTS).toEqual({ replies: "everyone", mentions: "everyone", quotes: "everyone", follows: true });
    expect(ActivitySettings.parse(ACTIVITY_DEFAULTS)).toEqual(ACTIVITY_DEFAULTS);
  });

  test("refuses a reach outside the list, a follow switch that is not a boolean, and a missing member", () => {
    expect(ActivitySettings.safeParse({ ...ACTIVITY_DEFAULTS, replies: "friends" }).success).toBe(false);
    expect(ActivitySettings.safeParse({ ...ACTIVITY_DEFAULTS, follows: "everyone" }).success).toBe(false);
    expect(ActivitySettings.safeParse({ replies: "everyone", mentions: "everyone", quotes: "everyone" }).success).toBe(false);
  });
});

describe("ActivityTime: the database's microseconds, in UTC", () => {
  test("six fractional digits and Z, and nothing else", () => {
    expect(ActivityTime.safeParse(AT).success).toBe(true);
    expect(ActivityTime.safeParse("2026-10-27T10:00:00.123Z").success).toBe(false);
    expect(ActivityTime.safeParse("2026-10-27T10:00:00Z").success).toBe(false);
    expect(ActivityTime.safeParse("2026-10-27T10:00:00.123456+01:00").success).toBe(false);
    expect(ActivityTime.safeParse("2026-10-27 10:00:00.123456Z").success).toBe(false);
  });
});

describe("ActivityEntry", () => {
  test("a post entry: reply, mention or quote, its own key, the post's view", () => {
    for (const kind of ["reply", "mention", "quote"]) expect(ok(postEntry({ kind })), kind).toBe(true);
    expect(ok(postEntry({ kind: "follow" }))).toBe(false);
    expect(ok(postEntry({ key: `d:${id(9)}` }))).toBe(false);
    expect(ok(postEntry({ key: "f:2026-10-27" }))).toBe(false);
    expect(ok(postEntry({ at: "2026-10-27T10:00:00.123Z" }))).toBe(false);
    expect(ok(postEntry({ new: "yes" }))).toBe(false);
    expect(ok(postEntry({ post: { ...post, state: "deleted_by_author" } }))).toBe(false);
    const parsed = ActivityEntry.parse(postEntry());
    expect(parsed.type === "post" && parsed.post.id).toBe(id(50));
  });

  test("a follows entry: the day's key, its newest follow's time in that day, the count and at most three actors", () => {
    expect(ok(followsEntry())).toBe(true);
    expect(ok(followsEntry({ count: 1, actors: [author(1)] }))).toBe(true);
    expect(ok(followsEntry({ actors: [author(1), author(2), author(3), author(4)] }))).toBe(false);
    expect(ok(followsEntry({ actors: [] }))).toBe(false);
    expect(ok(followsEntry({ count: 2, actors: [author(1), author(2), author(3)] }))).toBe(false);
    expect(ok(followsEntry({ count: 0, actors: [] }))).toBe(false);
    expect(ok(followsEntry({ key: "f:2026-10-26" }))).toBe(false);
    expect(ok(followsEntry({ key: `e:${id(9)}` }))).toBe(false);
    expect(ok(followsEntry({ key: "f:2026-02-30", at: "2026-02-30T10:00:00.123456Z" }))).toBe(false);
  });

  test("a moderation entry: its kind's key over its id, its target, and the post's id and time exactly when the target is a post", () => {
    expect(ok(moderationEntry())).toBe(true);
    for (const [kind, prefix] of [
      ["decision", "d"],
      ["release", "r"],
      ["upload", "u"],
      ["lost", "l"],
    ]) {
      expect(ok(moderationEntry({ kind, key: `${prefix}:${id(7)}` })), kind).toBe(true);
      expect(ok(moderationEntry({ kind, key: `${prefix}:${id(8)}` })), `${kind} with another id`).toBe(false);
    }
    expect(ok(moderationEntry({ kind: "release", key: `d:${id(7)}` }))).toBe(false);
    expect(ok(moderationEntry({ kind: "strike" }))).toBe(false);
    expect(ok(moderationEntry({ target: "profile", postId: null, postCreatedAt: null }))).toBe(true);
    expect(ok(moderationEntry({ target: "account", postId: null, postCreatedAt: null }))).toBe(true);
    expect(ok(moderationEntry({ target: "profile" }))).toBe(false);
    expect(ok(moderationEntry({ postId: null, postCreatedAt: null }))).toBe(false);
    expect(ok(moderationEntry({ postCreatedAt: null }))).toBe(false);
    expect(ok(moderationEntry({ target: "image" }))).toBe(false);
  });

  test("an unknown type is refused", () => {
    expect(ok({ ...postEntry(), type: "like" })).toBe(false);
  });
});

describe("ActivityPage, the queries and the seen marker", () => {
  test("a page holds at most ACTIVITY_PAGE_SIZE entries, the next cursor and the stored marker, null before the first visit", () => {
    const items = [postEntry(), followsEntry(), moderationEntry()];
    expect(ActivityPage.safeParse({ items, nextCursor: null, seenAt: null }).success).toBe(true);
    expect(ActivityPage.safeParse({ items, nextCursor: encodeActivityCursor({ at: AT, key: `e:${id(9)}` }), seenAt: AT }).success).toBe(true);
    expect(ActivityPage.safeParse({ items: Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, () => postEntry()), nextCursor: null, seenAt: null }).success).toBe(false);
    expect(ActivityPage.safeParse({ items, nextCursor: null, seenAt: "2026-10-27T10:00:00.123Z" }).success).toBe(false);
    expect(ActivityPage.safeParse({ items, nextCursor: "not a cursor!", seenAt: null }).success).toBe(false);
  });

  test("ActivityQuery: the tab, All by default, and an optional cursor word", () => {
    expect(ActivityQuery.parse({})).toEqual({ tab: "all" });
    expect(ActivityQuery.parse({ tab: "conversations", cursor: "abc_DEF-1" })).toEqual({ tab: "conversations", cursor: "abc_DEF-1" });
    expect(ActivityQuery.safeParse({ tab: "mentions" }).success).toBe(false);
    expect(ActivityQuery.safeParse({ cursor: "" }).success).toBe(false);
    expect(ActivityQuery.safeParse({ cursor: "a".repeat(401) }).success).toBe(false);
  });

  test("ActivityNewerQuery: the tab and the newest time shown, absent when the screen shows none; the count from 0 to 21", () => {
    expect(ActivityNewerQuery.parse({ since: AT })).toEqual({ tab: "all", since: AT });
    expect(ActivityNewerQuery.parse({ tab: "conversations" })).toEqual({ tab: "conversations" });
    expect(ActivityNewerQuery.safeParse({ since: "2026-10-27T10:00:00.123Z" }).success).toBe(false);
    expect(ActivityNewerResponse.safeParse({ count: 0 }).success).toBe(true);
    expect(ActivityNewerResponse.safeParse({ count: ACTIVITY_NEWER_CAP }).success).toBe(true);
    expect(ActivityNewerResponse.safeParse({ count: ACTIVITY_NEWER_CAP + 1 }).success).toBe(false);
    expect(ActivityNewerResponse.safeParse({ count: -1 }).success).toBe(false);
  });

  test("SeenRequest: an entry's own time, to the microsecond, so that the marker never stops short of the newest entry", () => {
    expect(SeenRequest.parse({ at: AT })).toEqual({ at: AT });
    expect(SeenRequest.safeParse({ at: "2026-10-27T10:00:00.123Z" }).success).toBe(false);
    expect(SeenRequest.safeParse({}).success).toBe(false);
  });
});

describe("the cursor on (at, key)", () => {
  const places = [
    { at: AT, key: `e:${id(9)}` },
    { at: "2026-10-27T23:59:59.999999Z", key: "f:2026-10-27" },
    { at: "2026-01-01T00:00:00.000000Z", key: `d:${id(1)}` },
    { at: AT, key: `r:${id(2)}` },
    { at: AT, key: `u:${id(3)}` },
    { at: AT, key: `l:${id(4)}` },
  ];

  test("round trip: each key of each source, the time kept to the microsecond", () => {
    for (const place of places) {
      const word = encodeActivityCursor(place);
      expect(word, place.key).toMatch(/^[A-Za-z0-9_-]{1,400}$/);
      expect(decodeActivityCursor(word), place.key).toEqual(place);
      expect(ActivityQuery.safeParse({ cursor: word }).success, place.key).toBe(true);
    }
    // Two places a microsecond apart are two cursors.
    expect(encodeActivityCursor({ at: "2026-10-27T10:00:00.123456Z", key: `e:${id(9)}` })).not.toBe(encodeActivityCursor({ at: "2026-10-27T10:00:00.123457Z", key: `e:${id(9)}` }));
  });

  test("the encoder refuses what is not a place: a millisecond time, an unknown key, an upper-case id", () => {
    expect(() => encodeActivityCursor({ at: "2026-10-27T10:00:00.123Z", key: `e:${id(9)}` })).toThrow();
    expect(() => encodeActivityCursor({ at: AT, key: `x:${id(9)}` })).toThrow();
    expect(() => encodeActivityCursor({ at: AT, key: "e:3F2A9C1E-8B7D-4E6F-A5C4-0123456789AB" })).toThrow();
    expect(encodeActivityCursor({ at: AT, key: "e:3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab" })).toMatch(/_e_3f2a9c1e/);
    expect(() => encodeActivityCursor({ at: AT, key: "f:2026-13-01" })).toThrow();
  });

  test("the decoder refuses anything it did not write, never guessing", () => {
    const word = encodeActivityCursor({ at: AT, key: `e:${id(9)}` });
    for (const forged of [
      "",
      "abc",
      `${word}x`,
      `x${word}`,
      word.toUpperCase(),
      word.replace("_e_", "_x_"),
      word.replace("_e_", "_f_"),
      // A time that is no time: the 30th of February, the 25th hour.
      encodeActivityCursor({ at: AT, key: `e:${id(9)}` }).replace(/^2026102710/, "2026023010"),
      encodeActivityCursor({ at: AT, key: `e:${id(9)}` }).replace(/^2026102710/, "2026102725"),
      encodeActivityCursor({ at: AT, key: "f:2026-10-27" }).replace("2026-10-27", "2026-02-30"),
      // Another module's cursor: base64url of JSON.
      "WyIyMDI2LTEwLTI3VDEwOjAwOjAwLjEyMzQ1NloiLCIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDkiXQ",
    ]) {
      expect(decodeActivityCursor(forged), forged).toBeNull();
    }
  });
});
