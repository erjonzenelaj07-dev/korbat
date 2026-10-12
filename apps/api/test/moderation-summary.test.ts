import { describe, expect, test } from "vitest";
import { accountAgeBand, actedOnBand, answeredUnseenBand, itemsFiledBand, reporterIndexes, secondsToUtcMidnight } from "../src/moderation/cases";

/**
 * A reporter's summary on the case page (3c design, section 7.3): four bands computed on read, never exact counts, and
 * a letter given per case. The summary is the same on every case the person reported, so its bands must rarely single
 * anyone out.
 */
describe("a reporter's summary: the bands", () => {
  const at = (iso: string) => new Date(iso);

  test("the account's age: under one month, one to twelve months, over twelve, by the calendar in UTC", () => {
    const now = at("2026-10-04T12:00:00.000Z");
    expect(accountAgeBand(at("2026-10-04T11:59:59.000Z"), now)).toBe("under_1_month");
    expect(accountAgeBand(at("2026-09-04T12:00:01.000Z"), now)).toBe("under_1_month");
    // One month to the second is no longer under a month.
    expect(accountAgeBand(at("2026-09-04T12:00:00.000Z"), now)).toBe("1_to_12_months");
    expect(accountAgeBand(at("2026-01-01T00:00:00.000Z"), now)).toBe("1_to_12_months");
    // Twelve months to the second still counts as one to twelve; a second more is over.
    expect(accountAgeBand(at("2025-10-04T12:00:00.000Z"), now)).toBe("1_to_12_months");
    expect(accountAgeBand(at("2025-10-04T11:59:59.000Z"), now)).toBe("over_12_months");
    expect(accountAgeBand(at("2020-02-29T00:00:00.000Z"), now)).toBe("over_12_months");
    // A day the next month lacks ends on that month's last day: created on 31 January, a month old on 28 February.
    expect(accountAgeBand(at("2026-01-31T10:00:00.000Z"), at("2026-02-28T09:59:59.000Z"))).toBe("under_1_month");
    expect(accountAgeBand(at("2026-01-31T10:00:00.000Z"), at("2026-02-28T10:00:00.000Z"))).toBe("1_to_12_months");
  });

  test("the items it filed: 1, 2 to 9, 10 or more", () => {
    expect(itemsFiledBand(1)).toBe("1");
    expect(itemsFiledBand(2)).toBe("2_to_9");
    expect(itemsFiledBand(9)).toBe("2_to_9");
    expect(itemsFiledBand(10)).toBe("10_or_more");
    expect(itemsFiledBand(250)).toBe("10_or_more");
    // The item being read is among them, so the count is never below one.
    expect(itemsFiledBand(0)).toBe("1");
  });

  test("the share of its decided items that were acted on: none decided, none, under half, half or more; exactly half is half or more", () => {
    expect(actedOnBand(0, 0)).toBe("none_decided");
    expect(actedOnBand(3, 0)).toBe("none");
    expect(actedOnBand(3, 1)).toBe("under_half");
    expect(actedOnBand(100, 49)).toBe("under_half");
    expect(actedOnBand(4, 2)).toBe("half_or_more");
    expect(actedOnBand(100, 50)).toBe("half_or_more");
    expect(actedOnBand(1, 1)).toBe("half_or_more");
  });

  test("the items answered while nobody could open the images are counted apart: none, 1, 2 to 9, 10 or more", () => {
    expect(answeredUnseenBand(0)).toBe("none");
    expect(answeredUnseenBand(1)).toBe("1");
    expect(answeredUnseenBand(2)).toBe("2_to_9");
    expect(answeredUnseenBand(9)).toBe("2_to_9");
    expect(answeredUnseenBand(10)).toBe("10_or_more");
    // A reporter whose only answered item was answered that way has no decided item: it is not "no action".
    expect([actedOnBand(0, 0), answeredUnseenBand(1)]).toEqual(["none_decided", "1"]);
  });
});

describe("a reporter's summary: the letter", () => {
  test("is given per case, in the order of each reporter's first item in that case", () => {
    // The items in the case's order: the second reporter's first item comes before the first reporter's second.
    const first = reporterIndexes(["r-anna", "r-ben", "r-anna", null, "r-cleo", "r-ben"]);
    expect([...first]).toEqual([
      ["r-anna", 0],
      ["r-ben", 1],
      ["r-cleo", 2],
    ]);
    // On another case the same people get the letters of that case's order: a letter says nothing across cases.
    const second = reporterIndexes(["r-cleo", "r-anna"]);
    expect([...second]).toEqual([
      ["r-cleo", 0],
      ["r-anna", 1],
    ]);
    expect([...reporterIndexes([null, null])]).toEqual([]);
  });
});

describe("the day's limits", () => {
  test("a refusal at a daily limit says how many seconds are left to midnight UTC, at least one", () => {
    expect(secondsToUtcMidnight(new Date("2026-10-04T00:00:00.000Z"))).toBe(86_400);
    expect(secondsToUtcMidnight(new Date("2026-10-04T23:59:30.000Z"))).toBe(30);
    expect(secondsToUtcMidnight(new Date("2026-10-04T23:59:59.999Z"))).toBe(1);
    expect(secondsToUtcMidnight(new Date("2026-12-31T12:00:00.000Z"))).toBe(43_200);
  });
});
