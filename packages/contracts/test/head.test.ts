import { describe, expect, test } from "vitest";
import { ALERT_KINDS, ALERT_KIND_LIST, HEAD_KINDS, HEAD_RULES, HEAD_WITNESSES, PublicHead, SENTENCE_MAIL_KINDS, alertPlaceholders, isTimeFact, renderAlert } from "../src/index";

/**
 * 3d Task 5, the audit head's daily value (design, sections 7.7, 10.1, 10.6 and 18, W.7): the head's constants, the two
 * closed lists of head_publications, the public answer, which never holds the place, and the two alerts the
 * transparency job writes, whose one fact is a day.
 */
describe("the head's contracts (3d Task 5)", () => {
  test("HEAD_RULES: the digest's tag, thirty days shown, the witness bounded at ten seconds, a token of at most 16 KB", () => {
    expect({ ...HEAD_RULES }).toEqual({ tag: "korbat.head.v2", shownDays: 30, witnessTimeoutMs: 10_000, tokenMaxBytes: 16_384 });
    expect([...HEAD_KINDS]).toEqual(["head", "restore"]);
    expect([...HEAD_WITNESSES]).toEqual(["none", "rfc3161", "test"]);
  });

  const VALUE = "917907fc36f065a78e0b730230eac9c4f1c2882c77efc7a868a65ee336e0899e";
  const row = { day: "2026-10-18", kind: "head", value: VALUE, witness: "rfc3161", token: "MAMCAQA=", retiredOn: null, lastDay: null } as const;

  test("PublicHead: a day, its kind, its value, who witnessed it with the token, when a restore retired it and, on a restore, the last day that still fits", () => {
    expect(PublicHead.safeParse({ days: [row] }).success).toBe(true);
    expect(PublicHead.safeParse({ days: [] }).success).toBe(true);
    expect(PublicHead.safeParse({ days: [{ ...row, witness: "none", token: null }, { ...row, kind: "restore", lastDay: "2026-10-12", retiredOn: null }] }).success).toBe(true);
    expect(PublicHead.safeParse({ days: [{ ...row, retiredOn: "2026-10-19" }] }).success).toBe(true);
    // Never the place, the hash or anything a row does not have.
    for (const extra of [{ chainSeq: 41 }, { seq: 41 }, { hash: VALUE }, { publishedAt: "2026-10-18T07:01:00.000Z" }]) {
      expect(PublicHead.safeParse({ days: [{ ...row, ...extra }] }).success, Object.keys(extra)[0]).toBe(false);
    }
    for (const bad of [{ value: VALUE.toUpperCase() }, { value: VALUE.slice(1) }, { witness: "tsa" }, { kind: "retired" }, { day: "18.10.2026" }, { token: "not base64!" }]) {
      expect(PublicHead.safeParse({ days: [{ ...row, ...bad }] }).success, JSON.stringify(bad)).toBe(false);
    }
    // A token is at most HEAD_RULES.tokenMaxBytes bytes, as base64: four characters for each three bytes.
    const groups = Math.ceil(HEAD_RULES.tokenMaxBytes / 3);
    expect(PublicHead.safeParse({ days: [{ ...row, token: `${"A".repeat(groups * 4 - 4)}AA==` }] }).success).toBe(true);
    expect(PublicHead.safeParse({ days: [{ ...row, token: "A".repeat(groups * 4 + 4) }] }).success).toBe(false);
  });
});

describe("head_unwitnessed and head_missed (W.7): the transparency job's two alerts, a day each", () => {
  const now = new Date("2026-10-18T09:00:00.000Z");

  test("they follow edge_purge_failed in the list, a push and a sentence to every staff account, with the one fact day", () => {
    // 3d Task 6's three kinds follow them (automation.test.ts).
    expect(ALERT_KIND_LIST.slice(-9, -6)).toEqual(["edge_purge_failed", "head_unwitnessed", "head_missed"]);
    for (const kind of ["head_unwitnessed", "head_missed"] as const) {
      expect(ALERT_KINDS[kind], kind).toEqual({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["day"] });
      expect(SENTENCE_MAIL_KINDS, kind).toContain(kind);
      expect(alertPlaceholders(kind), kind).toEqual(["day"]);
    }
    // The day is the day's first instant in the row (alert_outbox's facts hold counts and instants), so it is a time fact.
    expect(isTimeFact("day")).toBe(true);
  });

  test("the day prints as a date, whether it is today's or an earlier one, never as a time of day", () => {
    expect(renderAlert("head_unwitnessed", { day: "2026-10-18T00:00:00.000Z" }, now)).toEqual({
      title: "A daily value has no outside timestamp",
      sentence: "The audit log's value of 2026-10-18 was published without an outside timestamp: the timestamp authority did not answer.",
      todo: "Nothing to do for one day. If it repeats, the operator checks the authority's address.",
    });
    expect(renderAlert("head_missed", { day: "2026-10-17T00:00:00.000Z" }, now)).toEqual({
      title: "No daily value was published",
      sentence: "No value of the audit log was published for 2026-10-17.",
      todo: "The operator checks that the API ran at the dispatch hour. The keeper notes the gap; the page shows it.",
    });
    // Two sets of facts differ in their digits alone.
    const a = renderAlert("head_missed", { day: "2026-10-13T00:00:00.000Z" }, now).sentence;
    const b = renderAlert("head_missed", { day: "2025-01-02T00:00:00.000Z" }, now).sentence;
    expect(a).not.toBe(b);
    expect(a.replace(/[0-9]/g, "")).toBe(b.replace(/[0-9]/g, ""));
  });

  test("review M13: head_unmailed, the last kind of the list, a day's value whose keeper's mail never went: a push and a sentence to every staff account with the one fact day", () => {
    expect(ALERT_KIND_LIST.at(-1)).toBe("head_unmailed");
    expect(ALERT_KINDS.head_unmailed).toEqual({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["day"] });
    expect(SENTENCE_MAIL_KINDS).toContain("head_unmailed");
    expect(alertPlaceholders("head_unmailed")).toEqual(["day"]);
    expect(renderAlert("head_unmailed", { day: "2026-10-17T00:00:00.000Z" }, now)).toEqual({
      title: "The keeper did not get a daily value",
      sentence: "The audit log's value of 2026-10-17 was published, and its mail to the keeper never went out.",
      todo: "The operator checks the mail relay and HEAD_KEEPER_MAIL (staff.js automation-status prints the last mail's outcome). The keeper copies that day's value from /transparency and notes that its mail did not come.",
    });
  });

  test("a day that is no instant, or a count in its place, is refused: an alert never goes out with a hole", () => {
    expect(() => renderAlert("head_missed", { day: "2026-10-17" }, now)).toThrow(/day/);
    expect(() => renderAlert("head_missed", { day: 17 }, now)).toThrow(/day/);
    expect(() => renderAlert("head_unwitnessed", {}, now)).toThrow(/day/);
  });
});
