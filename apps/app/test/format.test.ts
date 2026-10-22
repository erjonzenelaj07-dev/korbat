import { describe, expect, test } from "vitest";
import { compactCount } from "../src/lib/format";
import * as social from "../src/lib/social";
import { dayTime, fullDate, postedWhen, timeAgo } from "../src/lib/time";
import { UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The numbers and times every screen prints (UI design, sections 6.3 and 8.1): compactCount() for the counts beside
 * icons, and lib/time.ts, which holds timeAgo (moved from lib/social.ts with its output unchanged) and the new spoken
 * and full forms. The unit config sets no time zone, so every helper that prints a clock time takes the zone as a
 * parameter, and the tests pass one.
 */
describe("compactCount", () => {
  test("prints section 6.3's examples", () => {
    expect(compactCount(1)).toBe("1");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1_200)).toBe("1.2K");
    expect(compactCount(12_000)).toBe("12K");
    expect(compactCount(1_200_000)).toBe("1.2M");
  });

  test("truncates, so it never shows more than the count", () => {
    expect(compactCount(1_299)).toBe("1.2K");
    expect(compactCount(1_999)).toBe("1.9K");
    expect(compactCount(9_999)).toBe("9.9K");
    expect(compactCount(12_999)).toBe("12K");
    expect(compactCount(999_999)).toBe("999K");
    expect(compactCount(1_999_999)).toBe("1.9M");
    expect(compactCount(25_999_999)).toBe("25M");
  });

  test("drops a tenth of zero, and keeps small and odd inputs readable", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(1_000)).toBe("1K");
    expect(compactCount(1_049)).toBe("1K");
    expect(compactCount(10_000)).toBe("10K");
    expect(compactCount(1_000_000)).toBe("1M");
    expect(compactCount(2_000_000_000)).toBe("2B");
    expect(compactCount(12.7)).toBe("12");
    expect(compactCount(-3)).toBe("0");
  });
});

describe("lib/time.ts", () => {
  const NOW = Date.parse("2026-10-21T18:40:00.000Z");
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  test("timeAgo keeps its output, and lib/social.ts still exports the same function", () => {
    expect(social.timeAgo).toBe(timeAgo);
    expect(timeAgo(ago(10), NOW)).toBe("just now");
    expect(timeAgo(ago(5 * 60), NOW)).toBe("5m");
    expect(timeAgo(ago(3 * 3600), NOW)).toBe("3h");
    expect(timeAgo(ago(2 * 86_400), NOW)).toBe("2d");
    expect(timeAgo(ago(8 * 86_400), NOW)).toBe(new Date(ago(8 * 86_400)).toLocaleDateString());
    // A time a little ahead of this device's clock reads as now, not as a negative age.
    expect(timeAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });

  test("postedWhen is the spoken form, and always contains the short time it is spoken for", () => {
    expect(postedWhen(ago(10), NOW)).toBe("posted just now");
    expect(postedWhen(ago(3 * 3600), NOW)).toBe("3h ago");
    expect(postedWhen(ago(5 * 60), NOW)).toBe("5m ago");
    const old = ago(30 * 86_400);
    expect(postedWhen(old, NOW)).toBe(`on ${new Date(old).toLocaleDateString()}`);
    for (const seconds of [0, 59, 60, 3599, 3600, 86_399, 86_400, 7 * 86_400 - 1, 7 * 86_400, 400 * 86_400]) {
      expect(postedWhen(ago(seconds), NOW)).toContain(timeAgo(ago(seconds), NOW));
    }
  });

  test("dayTime and fullDate print the day, the date and the minute in the zone they are given", () => {
    const at = "2026-10-21T18:40:00.000Z";
    expect(dayTime(at, "UTC")).toBe("Wed 18:40");
    expect(fullDate(at, "UTC")).toBe("21 Oct 2026, 18:40");
    // Tirana is two hours ahead in October: the same instant is another clock time there.
    expect(dayTime(at, "Europe/Tirane")).toBe("Wed 20:40");
    expect(fullDate("2026-10-20T23:30:00.000Z", "Europe/Tirane")).toBe("21 Oct 2026, 01:30");
    // Minutes and hours keep two digits, on a 24-hour clock.
    expect(dayTime("2026-10-18T07:05:00.000Z", "UTC")).toBe("Sun 07:05");
  });
});

describe("ui-words.ts", () => {
  test("fills a template's names and leaves the rest of the sentence as it is", () => {
    expect(fill(UI_WORDS["time.posted.ago"], { short: "3h" })).toBe("3h ago");
    expect(fill("{a} and {b}, {a}", { a: 1, b: "two" })).toBe("1 and two, 1");
  });

  test("Button's busy label ends in one ellipsis character, as today's did", () => {
    expect(UI_WORDS["button.busy"]).toBe(`Please wait${String.fromCharCode(0x2026)}`);
  });
});
