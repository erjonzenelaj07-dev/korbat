import { describe, expect, test } from "vitest";
import { AUTOMATION_RULES, CaseFlag, CaseItem, CaseView, EDGE_RULES, ExportFormat, ORDER_RULES, QueueRow, RETENTION, SIGNAL_RULES } from "../src/index";

/**
 * 3d Task 8 (design, sections 6.8, 6.10, 7.13, 10.1, 10.3 and W.10): the mirror of case_flag's four numbers, the flag and
 * the count of other open items as staff read them, RETENTION's three new members, each read from its own constant, and
 * the export's new members.
 */
const UUID = "1a2b3c4d-0000-4000-8000-0000000000e1";
const AT = "2026-10-19T10:00:00.000Z";

describe("the flag's numbers (10.1)", () => {
  test("SIGNAL_RULES is the design's: five items from five reporters within sixty minutes, half of them linked", () => {
    expect(SIGNAL_RULES).toEqual({ minItems: 5, minReporters: 5, windowMinutes: 60, linkedShare: 0.5 });
  });
});

describe("what staff read of the flag (10.3)", () => {
  test("the flag is two counts and nothing else: never a reporter", () => {
    expect(CaseFlag.parse({ items: 6, reporters: 5 })).toEqual({ items: 6, reporters: 5 });
    expect(CaseFlag.safeParse({ items: 6, reporters: 5, who: [UUID] }).success).toBe(false);
    expect(CaseFlag.safeParse({ items: -1, reporters: 5 }).success).toBe(false);
    expect(CaseFlag.safeParse({ items: 1.5, reporters: 5 }).success).toBe(false);
  });

  test("the queue's row, the case answer and an item carry the flag and the count, after the members before them", () => {
    expect(Object.keys(QueueRow.shape).at(-1)).toBe("flag");
    expect(Object.keys(CaseView.shape).at(-1)).toBe("flag");
    expect(Object.keys(CaseItem.shape).at(-1)).toBe("sameSourceOpen");
    expect(QueueRow.shape.flag.safeParse(null).success).toBe(true);
    expect(QueueRow.shape.flag.safeParse(undefined).success).toBe(false);
    expect(CaseView.shape.flag.safeParse({ items: 5, reporters: 5 }).success).toBe(true);
    expect(CaseItem.shape.sameSourceOpen.safeParse(0).success).toBe(true);
    expect(CaseItem.shape.sameSourceOpen.safeParse(-1).success).toBe(false);
    expect(CaseItem.shape.sameSourceOpen.safeParse(undefined).success).toBe(false);
  });
});

describe("RETENTION's members of 3d (6.10, W.9)", () => {
  test("each is its own constant's number, never typed twice", () => {
    expect(RETENTION.matchKeepDays).toBe(AUTOMATION_RULES.matchKeepDays);
    expect(RETENTION.reportHoldDays).toBe(ORDER_RULES.reportHoldDays);
    expect(RETENTION.edgePurgeDays).toBe(EDGE_RULES.keepDays);
    expect([RETENTION.matchKeepDays, RETENTION.reportHoldDays, RETENTION.edgePurgeDays]).toEqual([180, 7, 30]);
  });
});

describe("the export's members of 3d (W.10)", () => {
  const decision = {
    id: UUID,
    decidedOn: "2026-10-19",
    postId: UUID,
    kind: "interim",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 4,
    measures: [{ kind: "withhold_media", mediaId: UUID, noEffect: null }],
    reversals: [],
    facts: null,
    reason: null,
    legalReference: null,
    appeal: null,
    automatedDetection: true,
    automatedDecision: "fully",
    signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null },
    objection: { text: "Please look again.", createdAt: AT },
  };
  const upload = {
    id: UUID,
    refusedAt: AT,
    source: "test",
    matchKind: "exact",
    listedAs: "csam",
    objection: null,
    mayObject: true,
    endedAt: null,
    endAs: null,
    endReason: null,
    released: null,
    reportKept: false,
  };
  const moderationShape = ExportFormat.shape.moderation;

  test("a decision carries what its statement says of automated means and the objection with its time; each member is always there", () => {
    const decisions = moderationShape.shape.decisions;
    expect(decisions.safeParse([decision]).success).toBe(true);
    expect(decisions.safeParse([{ ...decision, objection: null, signal: null, automatedDetection: false, automatedDecision: "not_automated" }]).success).toBe(true);
    for (const member of ["automatedDetection", "automatedDecision", "signal", "objection"]) {
      expect(decisions.safeParse([{ ...decision, [member]: undefined }]).success, member).toBe(false);
    }
    expect(decisions.safeParse([{ ...decision, automatedDecision: "mostly" }]).success).toBe(false);
  });

  test("the uploads are their notices' data and the releases a ground and a time; neither carries a file or a hash", () => {
    expect(moderationShape.shape.uploads.safeParse([upload]).success).toBe(true);
    expect(Object.keys(moderationShape.shape.uploads.element.shape)).not.toEqual(expect.arrayContaining(["hash", "file", "classification", "listVersion"]));
    const release = { id: UUID, basis: "leave", releasedAt: AT, upload: false };
    expect(moderationShape.shape.releases.safeParse([release]).success).toBe(true);
    expect(Object.keys(moderationShape.shape.releases.element.shape)).toEqual(["id", "basis", "releasedAt", "upload"]);
    expect(moderationShape.shape.releases.safeParse([{ ...release, basis: "answer" }]).success).toBe(false);
    expect(Object.keys(moderationShape.shape).slice(-2)).toEqual(["uploads", "releases"]);
  });
});
