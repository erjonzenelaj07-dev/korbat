import { describe, expect, test } from "vitest";
import { DAY_MS, HOUR_MS, NEW_ACCOUNT_MS, REPOST_MIN_AGE_MS, isNewAccount, limitsFor, mayRepostOrQuote } from "../../src/social/tiers";

describe("account tiers", () => {
  test("the low tier ends exactly at 24 hours", () => {
    expect(isNewAccount(NEW_ACCOUNT_MS - 1)).toBe(true);
    expect(isNewAccount(NEW_ACCOUNT_MS)).toBe(false);
    expect(limitsFor("post", 0)).toEqual([{ bucket: "post", max: 5, windowMs: HOUR_MS }]);
    expect(limitsFor("post", NEW_ACCOUNT_MS)).toEqual([{ bucket: "post", max: 30, windowMs: HOUR_MS }]);
    expect(limitsFor("reply", 0)[0]!.max).toBe(20);
    expect(limitsFor("reply", NEW_ACCOUNT_MS)[0]!.max).toBe(60);
  });
  test("reposts and quotes open at 48 hours, and quotes share the post bucket", () => {
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS - 1)).toBe(false);
    expect(mayRepostOrQuote(REPOST_MIN_AGE_MS)).toBe(true);
    expect(limitsFor("quote", 3 * DAY_MS)).toEqual(limitsFor("post", 3 * DAY_MS));
    expect(limitsFor("repost", 3 * DAY_MS)).toEqual([{ bucket: "repost", max: 30, windowMs: HOUR_MS }]);
  });
  test("image uploads: 20 an hour and 60 a day in the first day, 120 an hour and 500 a day afterwards", () => {
    expect(limitsFor("upload", 0)).toEqual([
      { bucket: "upload", max: 20, windowMs: HOUR_MS },
      { bucket: "upload-day", max: 60, windowMs: DAY_MS },
    ]);
    expect(limitsFor("upload", NEW_ACCOUNT_MS)).toEqual([
      { bucket: "upload", max: 120, windowMs: HOUR_MS },
      { bucket: "upload-day", max: 500, windowMs: DAY_MS },
    ]);
  });
  test("3b: an import's chunks, acts and picks, 600, 20 and 3,000 an hour, at any age", () => {
    for (const age of [0, 10 * DAY_MS]) {
      expect(limitsFor("import-chunk", age)).toEqual([{ bucket: "import-chunk", max: 600, windowMs: HOUR_MS }]);
      expect(limitsFor("import-act", age)).toEqual([{ bucket: "import-act", max: 20, windowMs: HOUR_MS }]);
      expect(limitsFor("import-pick", age)).toEqual([{ bucket: "import-pick", max: 3_000, windowMs: HOUR_MS }]);
    }
  });
  test("engagement and graph limits do not depend on age, and follows have two windows", () => {
    for (const age of [0, 10 * DAY_MS]) {
      expect(limitsFor("like", age)[0]!.max).toBe(100);
      expect(limitsFor("bookmark", age)[0]!.max).toBe(100);
      expect(limitsFor("block", age)[0]!.max).toBe(30);
      expect(limitsFor("mute", age)[0]!.max).toBe(30);
      expect(limitsFor("follow", age)).toEqual([
        { bucket: "follow-hour", max: 50, windowMs: HOUR_MS },
        { bucket: "follow-day", max: 400, windowMs: DAY_MS },
      ]);
    }
  });
  test("2d (9.5): the five new actions and their buckets, at any age: the seen marker 240 an hour, the settings 120, the avatar 10 an hour and 30 a day, the preview switch 30 and hidden counts 60", () => {
    for (const age of [0, NEW_ACCOUNT_MS - 1, 10 * DAY_MS]) {
      expect(limitsFor("activity-seen", age)).toEqual([{ bucket: "activity-seen", max: 240, windowMs: HOUR_MS }]);
      expect(limitsFor("activity-settings", age)).toEqual([{ bucket: "activity-settings", max: 120, windowMs: HOUR_MS }]);
      // Setting and removing an avatar count together, in two windows.
      expect(limitsFor("avatar", age)).toEqual([
        { bucket: "avatar-hour", max: 10, windowMs: HOUR_MS },
        { bucket: "avatar-day", max: 30, windowMs: DAY_MS },
      ]);
      expect(limitsFor("share-previews", age)).toEqual([{ bucket: "share-previews", max: 30, windowMs: HOUR_MS }]);
      expect(limitsFor("hide-counts", age)).toEqual([{ bucket: "hide-counts", max: 60, windowMs: HOUR_MS }]);
    }
  });
});
