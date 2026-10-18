import { describe, expect, test } from "vitest";
import { DecisionStatement, GAP_CLASSES, GAP_DISPOSITIONS, GAP_MEASURE_CLASSES, GAP_SITE_CLASSES, RESTORE_GAPS_MAX, RestoreView, type RestoreGap } from "../src/index";

/**
 * 3f Task 6 (design, sections 6.6, 7.17, 10.1, 10.2 and 10.4): the closed lists of recovery, each the one spelling of its
 * CHECK (a database test holds the two equal), what the console reads after a restore, and the day a decision taken again
 * names.
 */
describe("recovery", () => {
  const ID = "6f1c1e8a-2b3c-4d5e-8f90-123456789abc";
  const AT = "2026-10-10T01:00:00.000Z";

  test("the classes in the order a person takes them again, the measures among them, and those that keep the app's site closed", () => {
    expect(GAP_CLASSES).toEqual(["order_effect", "seal_final", "seal_interim", "standing", "restriction", "reversal", "no_measure", "record"]);
    expect(GAP_DISPOSITIONS).toEqual(["reapplied", "not_needed", "imported"]);
    expect(GAP_MEASURE_CLASSES).toEqual(["order_effect", "seal_final", "seal_interim", "standing", "restriction"]);
    expect(GAP_SITE_CLASSES).toEqual(["order_effect", "seal_final", "seal_interim"]);
  });

  test("RestoreView holds a gap's members and nothing more, and the held notices' ends as imported", () => {
    const gap: RestoreGap = {
      id: ID,
      class: "order_effect",
      actedAt: AT,
      action: "order_effected",
      caseId: null,
      orderId: ID,
      itemId: ID,
      kinds: ["disable_by_order"],
      closedAt: null,
      disposition: null,
      closedByDecisionId: null,
    };
    const view = { importedAt: AT, mayOpen: false, retentionMay: false, gaps: [gap], holds: [{ orderId: ID, holdUntil: AT }] };
    expect(RestoreView.parse(view)).toEqual(view);
    expect(RestoreView.parse({ importedAt: null, mayOpen: true, retentionMay: true, gaps: [], holds: [] }).gaps).toEqual([]);
    // No metadata beyond the members: a stripped extra member, never carried.
    expect((RestoreView.parse({ ...view, gaps: [{ ...gap, metadata: { authority: "x" } }] }).gaps[0] as Record<string, unknown>).metadata).toBeUndefined();
    for (const bad of [{ ...gap, class: "measure" }, { ...gap, disposition: "done" }, { ...gap, kinds: ["delete_everything"] }]) {
      expect(RestoreView.safeParse({ ...view, gaps: [bad] }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(RestoreView.safeParse({ ...view, gaps: Array.from({ length: RESTORE_GAPS_MAX + 1 }, () => gap) }).success).toBe(false);
  });

  test("a decision taken again names the lost decision's UTC day; every other decision names none", () => {
    const statement = {
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R5",
      rulesVersion: 1,
      redressVersion: 3,
      legalReference: null,
      facts: "f",
      reason: "r",
      source: "notice",
      decidedAt: AT,
      post: { id: ID, createdAt: AT },
      measures: [],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
    };
    expect(DecisionStatement.parse({ ...statement, reapplied: { lostOn: "2026-10-09" } }).reapplied).toEqual({ lostOn: "2026-10-09" });
    expect(DecisionStatement.parse(statement).reapplied).toBeUndefined();
    expect(DecisionStatement.safeParse({ ...statement, reapplied: { lostOn: AT } }).success).toBe(false);
  });
});
