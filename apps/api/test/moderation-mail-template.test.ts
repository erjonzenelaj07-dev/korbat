import { describe, expect, test } from "vitest";
import type { DecisionStatement } from "@korbat/contracts";
import { mailTemplateOf } from "../src/moderation/statement";

/**
 * Which template a decision's statement is mailed under (3e design, sections 7.15 and 18, W.6): the first row of 7.15's
 * table that fits, in its order, and moderation_decision otherwise. The statement's data alone decides, so a test builds
 * the data and reads the template.
 */
const DECIDED = "2026-10-04T09:30:15.250Z";
const EARLIEST = "2026-10-11T09:30:15.250Z";
const PARAGRAPHS = ["one", "two"];

function statement(more: Partial<DecisionStatement> = {}): DecisionStatement {
  return {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 3,
    redressVersion: 2,
    legalReference: null,
    facts: null,
    reason: null,
    source: "own_initiative",
    decidedAt: DECIDED,
    post: null,
    measures: [],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
    ...more,
  };
}
const standing = (kind: "suspend" | "terminate", announced: boolean): DecisionStatement["measures"][number] => ({
  kind,
  mediaId: null,
  noEffect: null,
  sealed: null,
  announced,
  days: kind === "suspend" ? 3 : null,
  basis: announced ? (kind === "suspend" ? "strikes" : "ladder_end") : "threat",
  earliestStart: announced ? EARLIEST : DECIDED,
  endsAt: announced || kind === "terminate" ? null : EARLIEST,
  restsOn: [],
});
const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R1" as const, rulesVersion: 3, legalReference: null, decidedAt: "2026-10-01T09:00:00.000Z" };
const lift = (more: Partial<DecisionStatement["reversals"][number]> = {}): DecisionStatement["reversals"][number] => ({
  kind: "lift_suspension",
  mediaId: null,
  resetDecisionId: null,
  oldValueKept: false,
  resetRuleId: null,
  liftedKind: "suspend",
  liftedDecidedAt: "2026-10-01T09:00:00.000Z",
  periodThen: { state: "not_started", startedAt: null, endedAt: null },
  replaced: false,
  replyFiledAt: null,
  ...more,
});
const answer = (kind: "correction" | "review", outcome: "kept" | "partly_reversed" | "reversed", more: Partial<DecisionStatement> = {}) =>
  statement({
    kind,
    outcome,
    ground: null,
    ruleId: null,
    reviewed,
    repliedTo: { filedAt: DECIDED, onTime: true, kind: "suspend", days: 3, periodThen: { state: "not_started", startedAt: null, endedAt: null }, startsAt: EARLIEST, endsAt: EARLIEST, appealUntil: EARLIEST },
    ...more,
  });

describe("mailTemplateOf, row by row in the order of 7.15", () => {
  test("1: an announced suspension or termination is suspension_announced, with its days, the window in hours and the earliest start", () => {
    expect(mailTemplateOf(statement({ measures: [standing("suspend", true)] }), PARAGRAPHS)).toEqual({
      template: "suspension_announced",
      measure: "suspend",
      days: 3,
      window: 168,
      earliestStart: EARLIEST,
      paragraphs: PARAGRAPHS,
    });
    expect(mailTemplateOf(statement({ measures: [standing("terminate", true)] }), PARAGRAPHS)).toMatchObject({ template: "suspension_announced", measure: "terminate", days: null });
  });

  test("2: a suspension or termination taken at once is suspension_started_at_once", () => {
    expect(mailTemplateOf(statement({ measures: [standing("suspend", false)] }), PARAGRAPHS)).toMatchObject({ template: "suspension_started_at_once", measure: "suspend", days: 3, endsAt: EARLIEST });
    expect(mailTemplateOf(statement({ measures: [standing("terminate", false)] }), PARAGRAPHS)).toMatchObject({ template: "suspension_started_at_once", measure: "terminate", days: null, endsAt: null });
  });

  test("3: a correction or review whose statement has repliedTo is reply_answered: kept when it leaves the measure in force, reversed when it lifts it", () => {
    expect(mailTemplateOf(answer("correction", "kept"), PARAGRAPHS)).toEqual({ template: "reply_answered", outcome: "kept", paragraphs: PARAGRAPHS });
    expect(mailTemplateOf(answer("review", "kept"), PARAGRAPHS)).toMatchObject({ template: "reply_answered", outcome: "kept" });
    expect(mailTemplateOf(answer("review", "partly_reversed"), PARAGRAPHS)).toMatchObject({ template: "reply_answered", outcome: "kept" });
    expect(mailTemplateOf(answer("correction", "reversed", { reversals: [lift()] }), PARAGRAPHS)).toMatchObject({ template: "reply_answered", outcome: "reversed" });
  });

  test("4: a lift with no repliedTo is suspension_lifted: a withdrawal signed replaced under its own lead, never as an answer to the reply; a lift by its period; a broken basis by its period", () => {
    const withdrawal = statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, reviewed, reversals: [lift({ replaced: true, replyFiledAt: DECIDED })] });
    expect(mailTemplateOf(withdrawal, PARAGRAPHS)).toEqual({ template: "suspension_lifted", measure: "suspend", why: "replaced", decidedAt: "2026-10-01T09:00:00.000Z", replied: true, paragraphs: PARAGRAPHS });
    expect(mailTemplateOf(statement({ ...withdrawal, reversals: [lift({ replaced: true })] }), PARAGRAPHS)).toMatchObject({ why: "replaced", replied: false });
    for (const state of ["not_started", "running", "ended"] as const) {
      const lifted = statement({ kind: "correction", outcome: "reversed", ground: null, ruleId: null, reviewed, reversals: [lift({ periodThen: { state, startedAt: null, endedAt: null } })] });
      expect(mailTemplateOf(lifted, PARAGRAPHS), state).toMatchObject({ template: "suspension_lifted", why: "lifted", period: state });
    }
    const broken = statement({
      kind: "correction",
      outcome: "reversed",
      ground: null,
      ruleId: null,
      reviewed,
      endedStanding: [{ kind: "terminate", decidedAt: DECIDED, periodThen: { state: "running", startedAt: DECIDED, endedAt: null }, seal: false, replyFiledAt: null }],
    });
    expect(mailTemplateOf(broken, PARAGRAPHS)).toMatchObject({ template: "suspension_lifted", measure: "terminate", why: "basis", period: "running" });
  });

  test("5: a final warning about reporting is reporting_warned", () => {
    const warning = { kind: "warn_reporting" as const, mediaId: null, noEffect: null, sealed: null, basis: "reports" as const, endsAt: EARLIEST };
    expect(mailTemplateOf(statement({ ruleId: "R6", measures: [warning] }), PARAGRAPHS)).toEqual({ template: "reporting_warned", paragraphs: PARAGRAPHS });
  });

  test("6: a final restriction of reporting is reporting_restricted, with its days and its end; one without them is no mail", () => {
    const restriction = { kind: "restrict_reporting" as const, mediaId: null, noEffect: null, sealed: null, basis: "reports" as const, days: 30, endsAt: EARLIEST, warnedAt: DECIDED };
    expect(mailTemplateOf(statement({ ruleId: "R6", measures: [restriction] }), PARAGRAPHS)).toEqual({ template: "reporting_restricted", days: 30, endsAt: EARLIEST, paragraphs: PARAGRAPHS });
    expect(() => mailTemplateOf(statement({ ruleId: "R6", measures: [{ ...restriction, days: null }] }), PARAGRAPHS)).toThrow(/restriction/);
    // A suspension taken at once in the same decision comes first, by the order of 7.15.
    expect(mailTemplateOf(statement({ measures: [standing("suspend", false), restriction] }), PARAGRAPHS)).toMatchObject({ template: "suspension_started_at_once" });
  });

  test("a lift of a reporting measure, also one that ends a restriction with its warning, rides on moderation_decision", () => {
    const liftReporting = lift({ kind: "lift_reporting", liftedKind: "warn_reporting", periodThen: null, replaced: undefined, replyFiledAt: undefined });
    const ended = { kind: "restrict_reporting" as const, decidedAt: DECIDED, periodThen: { state: "running" as const, startedAt: DECIDED, endedAt: null }, seal: false, replyFiledAt: null };
    expect(mailTemplateOf(statement({ kind: "review", outcome: "reversed", ground: null, ruleId: null, reviewed, reversals: [liftReporting], endedStanding: [ended] }), PARAGRAPHS)).toEqual({
      template: "moderation_decision",
      subject: "reversed",
      paragraphs: PARAGRAPHS,
    });
  });

  test("otherwise moderation_decision: a strike, a retirement and every decision of 3c", () => {
    expect(mailTemplateOf(statement({ measures: [{ kind: "retire_handle", mediaId: null, noEffect: null, sealed: null, handle: "ada", placeholder: "retired_0a1b2c3d4e5f" }] }), PARAGRAPHS)).toMatchObject({
      template: "moderation_decision",
      subject: "profile_restricted",
    });
  });
});
