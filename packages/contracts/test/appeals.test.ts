import { describe, expect, test } from "vitest";
import {
  APPEALS_PAGE_SIZE,
  AppealRequest,
  AppealReviewRequest,
  AppealRow,
  AppealsPage,
  AppealsQuery,
  AppealsReviewedParams,
  CaseAppeal,
  DAILY_LIMITS,
  NoticeReexamineRequest,
  REVIEWER_STATES,
  ReexamineRequest,
  ReexamineResponse,
  STATEMENT_MAX,
  StaffOverview,
} from "../src/index";

/**
 * The shapes of appeals and re-examination (3c design, sections 7.2, 7.7 and 10): what the author and whoever reported
 * may send, what the console lists of the appeals that wait, and the marks by which the console says who may review one.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-10-04T10:00:00.000Z";
const TOKEN = "t".repeat(43);

describe("an appeal's and a re-examination's request", () => {
  test("the statement is optional and free of form, under the rules of every free text, and at most 2000 characters", () => {
    expect(STATEMENT_MAX).toBe(2000);
    expect(DAILY_LIMITS).toEqual({ appeals: 5, reexaminations: 5 });
    for (const schema of [AppealRequest, ReexamineRequest]) {
      expect(schema.parse({})).toEqual({});
      expect(schema.parse({ statement: "Line one.\nLine two." })).toEqual({ statement: "Line one.\nLine two." });
      expect(schema.safeParse({ statement: "x".repeat(STATEMENT_MAX) }).success).toBe(true);
      expect(schema.safeParse({ statement: "x".repeat(STATEMENT_MAX + 1) }).success).toBe(false);
      // Nothing is trimmed, changed or dropped: an empty text, a control character and an unknown member are refused.
      for (const statement of ["", "   ", `a${String.fromCharCode(0)}b`, `a${String.fromCharCode(0x202e)}b`]) expect(schema.safeParse({ statement }).success, JSON.stringify(statement)).toBe(false);
      expect(schema.safeParse({ statement: "x", decisionId: id(1) }).success).toBe(false);
      expect(schema.safeParse({ statement: 5 }).success).toBe(false);
    }
  });

  test("a notifier names the notice by its reference with a token, and the item by its position on the status page, 1 to 20", () => {
    const request = { ref: "N-ABCDEFGH23", token: TOKEN, position: 1 };
    expect(NoticeReexamineRequest.parse(request)).toEqual(request);
    expect(NoticeReexamineRequest.parse({ ...request, position: 20, statement: "Look again." })).toEqual({ ...request, position: 20, statement: "Look again." });
    for (const position of [0, 21, 1.5, "1"]) expect(NoticeReexamineRequest.safeParse({ ...request, position }).success, String(position)).toBe(false);
    for (const broken of [{ ...request, ref: "nope" }, { ...request, token: undefined }, { ...request, itemId: id(1) }, { ref: request.ref, position: 1 }]) {
      expect(NoticeReexamineRequest.safeParse(broken).success, JSON.stringify(broken)).toBe(false);
    }
  });

  test("the answer names the positions that are examined again: one, or two with the item korbat added for a quoted post", () => {
    expect(ReexamineResponse.parse({ positions: [1] })).toEqual({ positions: [1] });
    expect(ReexamineResponse.parse({ positions: [1, 11] })).toEqual({ positions: [1, 11] });
    for (const positions of [[], [1, 11, 2], [0], [21]]) expect(ReexamineResponse.safeParse({ positions }).success, JSON.stringify(positions)).toBe(false);
  });
});

describe("the appeals as the console reads them", () => {
  const row = {
    id: id(1),
    caseId: id(2),
    decisionId: id(3),
    filedAt: TIME,
    decidedAt: TIME,
    deadline: "2027-04-04T10:00:00.000Z",
    ruleId: "R3",
    legal: false,
    actions: ["remove"],
    reviewer: "available",
    needsAdmin: false,
    mayReview: true,
    standingFirst: false,
  };

  test("a page holds the pending appeals, each with its case, its decision and the three marks of its review", () => {
    const page = { appeals: [row, { ...row, id: id(4), ruleId: null, legal: true, actions: ["remove_media", "seal_media"], reviewer: "none_single_staff", needsAdmin: true, mayReview: false }], nextCursor: "abc" };
    expect(AppealsPage.parse(page)).toEqual(page);
    expect(APPEALS_PAGE_SIZE).toBe(50);
    expect(AppealsPage.safeParse({ appeals: Array.from({ length: APPEALS_PAGE_SIZE + 1 }, () => row), nextCursor: null }).success).toBe(false);
    for (const reviewer of REVIEWER_STATES) expect(AppealRow.parse({ ...row, reviewer }).reviewer).toBe(reviewer);
    // A pending appeal always has a reviewer state, and each mark is there.
    for (const broken of [{ ...row, reviewer: null }, { ...row, reviewer: "nobody" }, { ...row, mayReview: undefined }, { ...row, needsAdmin: undefined }, { ...row, actions: ["delete"] }]) {
      expect(AppealRow.safeParse(broken).success, JSON.stringify(broken).slice(0, 80)).toBe(false);
    }
  });

  test("no row of the list has a member for the appellant's statement, or one named like an address or an account", () => {
    const members = Object.keys(AppealRow.shape);
    expect(members).not.toContain("statement");
    for (const member of members) expect(member, member).not.toMatch(/email|address|userId|accountId|actorId|appellant/i);
    // A statement an answer carried all the same is dropped by the console's parse, never shown.
    expect(Object.keys(AppealRow.parse({ ...row, statement: "the author's words" }))).not.toContain("statement");
  });

  test("the list's cursor is an opaque word of the API's own alphabet", () => {
    expect(AppealsQuery.parse({})).toEqual({});
    expect(AppealsQuery.parse({ cursor: "abc_DEF-123" })).toEqual({ cursor: "abc_DEF-123" });
    for (const cursor of ["", "a b", "a/b", "a=b", "x".repeat(401)]) expect(AppealsQuery.safeParse({ cursor }).success, cursor).toBe(false);
  });

  test("an appeal on the case page carries its statement and the same three marks; answered, it has no reviewer state", () => {
    const pending = { id: id(1), decisionId: id(3), filedAt: TIME, statement: "the author's words", answeredAt: null, result: null, answeredBy: null, reviewer: "none_eligible", needsAdmin: true, mayReview: false };
    expect(CaseAppeal.parse(pending)).toEqual(pending);
    const answered = { ...pending, statement: null, answeredAt: TIME, result: "kept", answeredBy: id(5), reviewer: null };
    expect(CaseAppeal.parse(answered)).toEqual(answered);
    for (const member of ["reviewer", "needsAdmin", "mayReview"]) expect(CaseAppeal.safeParse({ ...pending, [member]: undefined }).success, member).toBe(false);
  });

  test("the home screen's numbers: the appeals waiting, those the reading person may review, and those nobody may review now", () => {
    const overview = {
      lanes: [0, 1, 2].map((lane) => ({ lane, open: 0, oldestAt: null })),
      appealsWaiting: 3,
      appealsYouMayReview: 1,
      appealsWithoutReviewer: 1,
      reveals: { total: 0, items: [] },
      imagesToday: [],
      findingsToday: [],
      mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
      mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
      releaseOverdue: 0,
      erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 },
      deferUnproven: false,
      protectionLifted: { total: 0, items: [] },
      sealsDeclined: { total: 0, items: [] },
      repliesWaiting: { count: 0, oldestAt: null },
      strikeAccounts: 0,
      interimSeals: { total: 0, items: [] },
      // 3f: the contact point and the alert channel.
      contact: { open: 0, oldestAt: null, dueAt: null },
      alerts: { channel: "off", since: null },
      ordersUnverified: { total: 0, items: [] },
      reportsOwed: { total: 0, items: [] },
      // 3f Task 6: the copy's age and the gaps after a restore.
      copy: { newestAt: null, overdue: false },
      restore: { open: 0, measures: 0, importedAt: null },
      quarantine: { dueIn: 0, dueOut: 0, undestroyed: 0, oldest: null },
      destructive: [],
    };
    expect(StaffOverview.parse(overview)).toEqual(overview);
    for (const member of ["appealsWaiting", "appealsYouMayReview", "appealsWithoutReviewer"]) {
      expect(StaffOverview.safeParse({ ...overview, [member]: undefined }).success, member).toBe(false);
      expect(StaffOverview.safeParse({ ...overview, [member]: -1 }).success, member).toBe(false);
    }
  });
});

describe("the review's request", () => {
  const params = {
    stateVersion: 2,
    appealId: id(1),
    snapshotId: id(2),
    snapshotDigest: "a".repeat(64),
    outcome: "partly_reversed",
    rulesVersion: 2,
    redressVersion: 1,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    actions: [{ kind: "restore", mediaId: null }],
    reasonDigest: "b".repeat(64),
  };
  const stepUp = { id: "aWQ", rawId: "aWQ", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AAAA", signature: "AAAA" }, clientExtensionResults: {} };

  test("is the action's params with the key's assertion beside them, and keeps the params' own rules", () => {
    expect(AppealsReviewedParams.parse(params)).toEqual(params);
    expect(AppealReviewRequest.safeParse({ ...params, stepUp }).success).toBe(true);
    expect(AppealReviewRequest.safeParse(params).success).toBe(false);
    // A review lifts and never restricts, with or without the assertion beside it.
    expect(AppealReviewRequest.safeParse({ ...params, actions: [{ kind: "remove", mediaId: null }], stepUp }).success).toBe(false);
    expect(AppealReviewRequest.safeParse({ ...params, outcome: "restricted", stepUp }).success).toBe(false);
    expect(AppealReviewRequest.safeParse({ ...params, reasonDigest: null, stepUp }).success).toBe(false);
  });
});
