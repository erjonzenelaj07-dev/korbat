import { describe, expect, test } from "vitest";
import {
  ALERT_KINDS,
  ALERT_KIND_LIST,
  AUTOMATED_CASES_MAX,
  AUTOMATED_DECISIONS,
  AUTOMATION_RULES,
  AskPerson,
  AutomatedDecidedParams,
  CAP_LIMITS,
  CaseSignal,
  DecisionStatement,
  ModerationErrorCode,
  OBJECTION_TEXT_MAX,
  ObjectionRequest,
  QueueRow,
  R1_TEST_THRESHOLD,
  SENTENCE_MAIL_KINDS,
  SIGNAL_HANDLED,
  SIGNAL_KINDS,
  SOURCE_LABELS,
  SWEEP_BATCH,
  SWEEP_HOURS,
  SourceSummary,
  StatementSignal,
  alertPlaceholders,
  renderAlert,
} from "../src/index";

/**
 * 3d Task 6, the automated decision (design, sections 2 rows 14 to 25, 6.6, 7.9, 7.10, 10.1 to 10.4 and W.7): the mirror
 * of automation_rules() as the design's table has it (the database test holds it to the function), the closed lists of a
 * signal and of a cap's limit, the program's params, "Ask for a person", the members staff and the author read, and the
 * three alerts, whose every number is printed from AUTOMATION_RULES.
 */
const UUID = "1a2b3c4d-0000-4000-8000-0000000000d1";
const SNAPSHOT = "1a2b3c4d-0000-4000-8000-0000000000a1";
const HEX = "a".repeat(64);
const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);

describe("the program's numbers and closed lists (10.1)", () => {
  test("AUTOMATION_RULES is the design's table of automation_rules(), member for column", () => {
    expect(AUTOMATION_RULES).toEqual({
      decisionsPerHour: 20,
      decisionsPerDay: 100,
      r2DecisionsPerHour: 20,
      r2DecisionsPerDay: 100,
      unansweredMax: 20,
      unansweredHours: 72,
      refusalsPerHour: 20,
      noReportHours: 24,
      r1Threshold: null,
      r1ThresholdVersion: 1,
      objectionTargetHours: 24,
      matchTimeoutMs: 3000,
      matchRetryHours: 24,
      matcherDownMinutes: 15,
      pdqMinQuality: 50,
      matchKeepDays: 180,
    });
  });

  test("the test scorer's threshold is its own 0.5 under version 0, below every real version", () => {
    expect(R1_TEST_THRESHOLD).toEqual({ threshold: 0.5, thresholdVersion: 0 });
    expect(R1_TEST_THRESHOLD.thresholdVersion).toBeLessThan(AUTOMATION_RULES.r1ThresholdVersion);
  });

  test("the closed lists, the sweep's numbers, and the codes a program's step and an objection meet", () => {
    expect(SIGNAL_KINDS).toEqual(["r1_score", "known_match"]);
    expect(SIGNAL_HANDLED).toEqual(["finding", "measure", "capped", "covered", "gone"]);
    expect(CAP_LIMITS).toEqual(["hour", "day", "unanswered", "waiting"]);
    expect(AUTOMATED_DECISIONS).toEqual(["not_automated", "partially", "fully"]);
    expect([SWEEP_BATCH, SWEEP_HOURS, AUTOMATED_CASES_MAX]).toEqual([20, 24, 20]);
    for (const code of ["objection_not_open", "already_protected", "automation_capped"]) expect(ModerationErrorCode.safeParse(code).success, code).toBe(true);
  });
});

describe("AutomatedDecidedParams (10.4): the system's audit row, as decision_holds compares it", () => {
  const params = {
    kind: "interim",
    stateVersion: 3,
    throughSeq: 0,
    reviewsDecisionId: null,
    snapshotId: SNAPSHOT,
    snapshotDigest: HEX,
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 3,
    redressVersion: 4,
    category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
    categoryKeyword: null,
    actions: [{ kind: "withhold_media", mediaId: UUID }],
    factsDigest: null,
    reasonDigest: null,
    legalReferenceDigest: null,
    unfounded: [],
    replaced: false,
  };

  test("a program's withhold of one image under R1 is accepted as it is", () => {
    expect(AutomatedDecidedParams.parse(params)).toEqual(params);
    // Task 7's seal of a post's images under R2 has its shape already.
    expect(AutomatedDecidedParams.safeParse({ ...params, ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", actions: [{ kind: "seal_media", mediaId: null }] }).success).toBe(true);
  });

  test("everything a program may not sign is refused: a final kind, another rule, a text, two measures, a measure of the other rule, a member more", () => {
    const refused = (change: Record<string, unknown>) => AutomatedDecidedParams.safeParse({ ...params, ...change }).success;
    expect(refused({ kind: "final" })).toBe(false);
    expect(refused({ throughSeq: 1 })).toBe(false);
    expect(refused({ ruleId: "R3" })).toBe(false);
    expect(refused({ ground: "illegal" })).toBe(false);
    expect(refused({ factsDigest: HEX })).toBe(false);
    expect(refused({ reasonDigest: HEX })).toBe(false);
    expect(refused({ actions: [] })).toBe(false);
    expect(refused({ actions: [{ kind: "withhold_media", mediaId: UUID }, { kind: "withhold", mediaId: null }] })).toBe(false);
    expect(refused({ actions: [{ kind: "remove_media", mediaId: UUID }] })).toBe(false);
    expect(refused({ actions: [{ kind: "seal_media", mediaId: null }] })).toBe(false);
    expect(refused({ unfounded: [UUID] })).toBe(false);
    expect(refused({ replaced: true })).toBe(false);
    expect(refused({ score: 0.9 })).toBe(false);
    // An image's id in another spelling than PostgreSQL's would leave a record that no longer hashes as it was written.
    expect(refused({ actions: [{ kind: "withhold_media", mediaId: UUID.toUpperCase() }] })).toBe(false);
  });
});

describe("Ask for a person (10.2): the request and where it stands", () => {
  test("one text of 1 to 2000 characters under the rules of a notice's text, and nothing else", () => {
    expect(OBJECTION_TEXT_MAX).toBe(2000);
    expect(ObjectionRequest.parse({ text: "Please look again: the photo is of a sculpture." })).toEqual({ text: "Please look again: the photo is of a sculpture." });
    expect(ObjectionRequest.safeParse({ text: "x".repeat(OBJECTION_TEXT_MAX) }).success).toBe(true);
    expect(ObjectionRequest.safeParse({ text: "x".repeat(OBJECTION_TEXT_MAX + 1) }).success).toBe(false);
    expect(ObjectionRequest.safeParse({ text: "" }).success).toBe(false);
    expect(ObjectionRequest.safeParse({ text: "   " }).success).toBe(false);
    expect(ObjectionRequest.safeParse({ text: `a${NUL}b` }).success).toBe(false);
    expect(ObjectionRequest.safeParse({ text: `a${RLO}b` }).success).toBe(false);
    expect(ObjectionRequest.safeParse({}).success).toBe(false);
    expect(ObjectionRequest.safeParse({ text: "fine", decisionId: UUID }).success).toBe(false);
    // No transform: the text is stored exactly as it was sent, its spaces included.
    expect(ObjectionRequest.parse({ text: "  spaced  " }).text).toBe("  spaced  ");
  });

  test("askPerson is open, asked with its text and time, or decided by a person's decision", () => {
    expect(AskPerson.parse({ state: "open" })).toEqual({ state: "open" });
    expect(AskPerson.safeParse({ state: "asked", text: "t", createdAt: "2026-10-19T10:00:00.000Z" }).success).toBe(true);
    expect(AskPerson.safeParse({ state: "decided", decisionId: UUID, decidedAt: "2026-10-19T10:00:00.000Z" }).success).toBe(true);
    expect(AskPerson.safeParse({ state: "lapsed" }).success).toBe(false);
  });
});

describe("what staff and the author read of a program (10.2, 10.3)", () => {
  test("a program's finding has the fixed source label and no reporter's summary", () => {
    expect(SOURCE_LABELS.program).toBe("Found by a program");
    const none = { accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };
    expect(SourceSummary.safeParse({ kind: "program", label: "Found by a program", ...none }).success).toBe(true);
    expect(SourceSummary.safeParse({ kind: "program", label: "Reporter A", ...none }).success).toBe(false);
  });

  test("the queue's row carries the three marks, and a signal on a case names no score", () => {
    expect(Object.keys(QueueRow.shape)).toEqual(expect.arrayContaining(["foundByProgram", "takenByProgram", "objected"]));
    expect(Object.keys(CaseSignal.shape)).toEqual(["itemId", "kind", "thresholdVersion"]);
    expect(Object.keys(StatementSignal.shape)).toEqual(["kind", "source", "matchKind", "listedAs", "viewed"]);
  });

  test("a statement made before 3d still parses, and one of a program carries its three members", () => {
    const statement = {
      kind: "interim",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R1",
      rulesVersion: 3,
      redressVersion: 4,
      legalReference: null,
      facts: null,
      reason: null,
      source: "own_initiative",
      decidedAt: "2026-10-19T10:00:00.000Z",
      post: { id: UUID, createdAt: "2026-10-18T10:00:00.000Z" },
      measures: [{ kind: "withhold_media", mediaId: UUID, noEffect: null, sealed: null }],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
    };
    expect(DecisionStatement.safeParse(statement).success).toBe(true);
    const program = { ...statement, automatedDetection: true, automatedDecision: "fully", signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null } };
    expect(DecisionStatement.parse(program)).toMatchObject({ automatedDetection: true, automatedDecision: "fully" });
    expect(DecisionStatement.safeParse({ ...program, automatedDecision: "mostly" }).success).toBe(false);
  });
});

describe("the three alerts of a program (W.7)", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const DIGIT = /[0-9]/;

  test("they follow head_missed at the end of the list, each a push and a sentence to every staff account", () => {
    expect(ALERT_KIND_LIST.slice(-3)).toEqual(["automated_objection", "automation_capped", "automated_waiting"]);
    for (const kind of ["automated_objection", "automation_capped", "automated_waiting"] as const) {
      expect(ALERT_KINDS[kind].priority, kind).toBe(3);
      expect(ALERT_KINDS[kind].scope, kind).toBe("all");
      expect(SENTENCE_MAIL_KINDS, kind).toContain(kind);
    }
  });

  test("no number is typed in their words: each comes from a fact or from AUTOMATION_RULES", () => {
    for (const kind of ["automated_objection", "automation_capped", "automated_waiting"] as const) {
      const placeholders = alertPlaceholders(kind);
      for (const name of placeholders) expect(ALERT_KINDS[kind].facts.includes(name) || Object.hasOwn(AUTOMATION_RULES, name), `${kind} {${name}}`).toBe(true);
    }
    expect(alertPlaceholders("automated_waiting")).toContain("objectionTargetHours");
  });

  test("automated_objection and automated_waiting render with two sets of facts that differ only in digits", () => {
    const a = renderAlert("automated_objection", { at: "2026-10-19T10:05:00.000Z", count: 2 }, now);
    const b = renderAlert("automated_objection", { at: "2026-10-19T11:07:00.000Z", count: 5 }, now);
    expect(a).toEqual({
      title: "An author asked for a person",
      sentence: "An author asked for a person about a measure a program took, at 10:05 UTC. 2 such requests are open.",
      todo: "A moderator opens the queue: the case stands first in its lane. Sealed images are an admin's.",
    });
    expect(a.sentence.replace(/[0-9]/g, "")).toBe(b.sentence.replace(/[0-9]/g, ""));
    expect(renderAlert("automated_waiting", { count: 3, oldestAt: "2026-10-18T09:00:00.000Z" }, now).sentence).toBe(
      `3 requests for a person have waited longer than ${AUTOMATION_RULES.objectionTargetHours} hours, the oldest since 2026-10-18 09:00 UTC.`,
    );
    for (const kind of ["automated_objection", "automated_waiting"] as const) {
      const text = JSON.stringify(ALERT_KINDS[kind]) + JSON.stringify(renderAlert(kind, kind === "automated_objection" ? { at: now.toISOString(), count: 1 } : { count: 1, oldestAt: now.toISOString() }, now));
      expect(text.includes("@") || text.includes("http"), kind).toBe(false);
    }
  });

  test("automation_capped says which limit was met, each in its own sentence, and how many findings wait", () => {
    const at = "2026-10-19T10:05:00.000Z";
    const of = (limit: (typeof CAP_LIMITS)[number]) =>
      renderAlert("automation_capped", { at, count: 4, [`limit${limit.charAt(0).toUpperCase()}${limit.slice(1)}`]: 1 }, now).sentence;
    expect(of("hour")).toBe("A program reached its limit of measures an hour under one rule at 10:05 UTC. 4 findings since then stand without a measure.");
    expect(of("day")).toBe("A program reached its limit of measures a day under one rule at 10:05 UTC. 4 findings since then stand without a measure.");
    expect(of("unanswered")).toBe(
      `At 10:05 UTC ${AUTOMATION_RULES.unansweredMax} measures of a program under one rule were waiting for a person, so it takes no new one under that rule. 4 findings since then stand without a measure.`,
    );
    expect(of("waiting")).toBe(`At 10:05 UTC a request for a person had waited longer than ${AUTOMATION_RULES.unansweredHours} hours, so a program takes no new measure. 4 findings since then stand without a measure.`);
    // The texts hold no digit of their own.
    const words = JSON.stringify(renderAlert("automation_capped", { at, count: 0, limitHour: 1 }, now).todo);
    expect(DIGIT.test(words)).toBe(false);
  });
});
