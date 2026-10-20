import { describe, expect, test } from "vitest";
import {
  ALERT_KINDS,
  ALERT_KIND_LIST,
  CaseView,
  EDGE_CACHE,
  EDGE_PURGE_CAUSES,
  EDGE_PURGE_OUTCOMES,
  EDGE_RULES,
  EDGE_WORDS,
  EdgePurgeView,
  OrderItemView,
  SENTENCE_MAIL_KINDS,
  alertPlaceholders,
  renderAlert,
} from "../src/index";

/**
 * 3d Task 3, the edge (design, sections 7.4, 10.1, 10.3 and W.7): the two numbers of a public image's header, the
 * outbox job's numbers, the two closed lists of edge_purges, the purge line's answer on a case and on an order's item,
 * and the alert edge_purge_failed, whose every number is printed from a constant.
 */
describe("the edge's contracts (3d Task 3)", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const IMAGE = "1a2b3c4d-0000-4000-8000-0000000000e1";

  test("EDGE_CACHE holds the header's two numbers: a browser's minute and an edge's five minutes", () => {
    expect(EDGE_CACHE).toEqual({ browserSeconds: 60, edgeSeconds: 300 });
  });

  test("EDGE_RULES holds the job's numbers: 30 prefixes a request, a round 15 seconds after the last, 5 seconds a request, a backoff from 30 seconds to an hour, 24 hours, 30 days", () => {
    expect(EDGE_RULES).toEqual({ prefixes: 30, roundSeconds: 15, timeoutMs: 5000, backoffSeconds: 30, backoffMaxSeconds: 3600, giveUpHours: 24, keepDays: 30 });
    // One request a round: at most four a minute, under the provider's documented five.
    expect(Math.floor(60 / EDGE_RULES.roundSeconds)).toBe(4);
  });

  test("the words' two numbers come from the two constants", () => {
    expect(EDGE_WORDS).toEqual({ edgeMinutes: EDGE_CACHE.edgeSeconds / 60, giveUpHours: EDGE_RULES.giveUpHours });
    expect(EDGE_WORDS.edgeMinutes).toBe(5);
  });

  test("the closed lists of edge_purges: why an image stopped being public, and how its purge ended", () => {
    expect([...EDGE_PURGE_CAUSES]).toEqual(["state", "deleted", "released"]);
    expect([...EDGE_PURGE_OUTCOMES]).toEqual(["accepted", "failed", "off"]);
  });

  test("EdgePurgeView: an image, an outcome of the list or pending, and a time; nothing else", () => {
    for (const outcome of [...EDGE_PURGE_OUTCOMES, "pending"]) {
      expect(EdgePurgeView.safeParse({ mediaId: IMAGE, outcome, at: "2026-10-19T11:00:00.000Z" }).success, outcome).toBe(true);
    }
    expect(EdgePurgeView.safeParse({ mediaId: IMAGE, outcome: "sent", at: "2026-10-19T11:00:00.000Z" }).success).toBe(false);
    expect(EdgePurgeView.safeParse({ mediaId: IMAGE, outcome: "off", at: "2026-10-19T11:00:00.000Z", token: "x" }).success).toBe(false);
    expect(EdgePurgeView.safeParse({ mediaId: "not-an-id", outcome: "off", at: "2026-10-19T11:00:00.000Z" }).success).toBe(false);
  });

  test("CaseView and OrderItemView each carry their purges", () => {
    expect(Object.keys(CaseView.shape)).toContain("purges");
    expect(Object.keys(OrderItemView.shape)).toContain("purges");
    expect(CaseView.shape.purges.safeParse([{ mediaId: IMAGE, outcome: "pending", at: "2026-10-19T11:00:00.000Z" }]).success).toBe(true);
    expect(OrderItemView.shape.purges.safeParse([{ mediaId: IMAGE, outcome: "accepted", at: "2026-10-19T11:00:00.000Z" }]).success).toBe(true);
  });

  test("edge_purge_failed: a push and a sentence to every staff account, the job's facts, as W.7 words it with every number from a constant", () => {
    expect(ALERT_KIND_LIST.at(-1)).toBe("edge_purge_failed");
    expect(ALERT_KINDS.edge_purge_failed).toEqual({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["count", "oldestAt"] });
    expect(SENTENCE_MAIL_KINDS).toContain("edge_purge_failed");
    expect(alertPlaceholders("edge_purge_failed").sort()).toEqual(["count", "edgeMinutes", "giveUpHours", "oldestAt"]);
    expect(renderAlert("edge_purge_failed", { count: 3, oldestAt: "2026-10-18T08:05:00.000Z" }, now)).toEqual({
      title: "A cached copy could not be dropped",
      sentence: `3 purges at the network provider failed for ${EDGE_RULES.giveUpHours} hours, the first of 2026-10-18 08:05 UTC.`,
      todo: `The measures themselves stand. A copy may have been served for up to ${EDGE_CACHE.edgeSeconds / 60} minutes after each. The operator checks the provider's token and zone.`,
    });
  });
});
