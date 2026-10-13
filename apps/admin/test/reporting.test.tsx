import { CaseDecidedParams, CaseView, RULE_DEFAULT_CATEGORY, STANDING_RULES, StandingLists, type StaffMe } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  complete,
  correctionChoices,
  correctionDraft,
  decisionParamsOf,
  markableItems,
  markedList,
  marksWithdrawable,
  newDraft,
  offeredDraft,
  previewOf,
  reportingControlState,
  reviewChoices,
  reviewDraft,
  withdrawMarksDraft,
  withMark,
  withReporting,
  type CaseDraft,
} from "../src/compose";
import { STANDING_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { StandingView } from "../src/screens/Standing";
import { DECISION_MARKED, DECISION_WARNED, ITEM_MARKED, ITEM_NOTIFIER, ITEM_REPORTER, MARKED_REF, WARNED_REPORTING, markCase, markedCase, reportingCase, warnedCase } from "./case-fixtures";
import { HOSTILE } from "./fixtures";

/**
 * The console's part of the restriction of reporting (3e design, sections 8.3, 8.4, 8.6 and 8.7; Task 5): "Warn about
 * reporting" and "Restrict reporting" on an account case, each offered when the case answer says the database would
 * accept it and greyed with its sentence otherwise, under R6, with the facts drafted from the record in reports; the mark
 * "manifestly unfounded" beside the items a "No breach" decision answers and may mark, signed as the list `unfounded`;
 * "Withdraw this decision's marks", a kept correction that signs no list; the reversals of the two measures with
 * [review.warning]; and the reporting records of the Standing screen. Every number in the words is STANDING_RULES'.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-12T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const ADMIN: StaffMe["role"] = "admin";
const DIGESTS = { snapshot: "cd".repeat(32), facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null };
const W = STANDING_WORDS.reporting;
const M = STANDING_WORDS.mark;

const final = (view: CaseView, change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, MODERATOR), kind: "final", ruleId: "R6", ...change });
const written = (draft: CaseDraft): CaseDraft => ({ ...draft, written: { ...draft.written, facts: draft.written.facts || "The facts.", reason: "The reason." } });

function composer(view: CaseView, draft: CaseDraft, role: StaffMe["role"] = MODERATOR) {
  const props: ComposerViewProps = { view, role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
  return html(<ComposerView {...props} />);
}

function casePage(view: CaseView, role: StaffMe["role"] = MODERATOR) {
  const props: CaseScreenViewProps = {
    caseId: caseId(view.id),
    view,
    shownImage: null,
    busy: null,
    notice: null,
    error: null,
    note: "",
    reveal: null,
    onOpenCase: noop,
    onShowImage: noop,
    onShowClearly: noop,
    onHideImage: noop,
    onImageError: noop,
    onSnapshot: noop,
    onNoteChange: noop,
    onNoteSave: noop,
    onRevealOpen: noop,
    onRevealChange: noop,
    onRevealConfirm: noop,
    onRevealClose: noop,
    compose: {
      role,
      draft: newDraft(caseId(view.id), view, role),
      now: NOW,
      busy: false,
      error: null,
      textErrors: {},
      declining: null,
      onChange: noop,
      onTextBlur: noop,
      onSeal: noop,
      onConfirm: noop,
      onDeclineOpen: noop,
      onDeclineChange: noop,
      onDeclineSave: noop,
      onDeclineClose: noop,
      onCancelCorrection: noop,
      onCorrect: noop,
      onReview: noop,
      onAnswer: noop,
      onWithdraw: noop,
      onWithdrawMarks: noop,
    },
  };
  return html(<CaseScreenView {...props} />);
}

describe("3e Task 5: the warning about reporting and the restriction of it (design, section 8.3)", () => {
  test("the words are the design's, each number printed from STANDING_RULES", () => {
    expect(W.warnShort(4, 8)).toBe(
      `Not open: a warning needs at least ${STANDING_RULES.reportWarnMarks} marked reports among those the account sent in the last ${STANDING_RULES.reportFrameDays} days, and they must be at least half of its rule reports sent in that time. This account has 4 of 8. One report never reaches the number alone.`,
    );
    expect(W.warnStanding("2026-09-20")).toBe("Not open: the warning of 2026-09-20 still counts.");
    expect(W.warnWhat(5, 8)).toContain(`that 5 of the 8 reports it sent under the rules in the last ${STANDING_RULES.reportFrameDays} days were marked manifestly unfounded`);
    expect(W.warnWhat(5, 8)).toContain(`says that ${STANDING_RULES.reportRestrictMarks} marked reports among those it sends after the warning may lead to a restriction`);
    expect(W.restrictWhat(7)).toContain(`for 7 days, from the moment you confirm`);
    expect(W.restrictWhat(1)).toContain("for 1 day, from the moment you confirm");
    expect(W.restrictWhat(7)).toContain(`At most ${STANDING_RULES.reportRestrictDays} days.`);
    expect(W.restrictNoWarning).toBe("Not open: the account has no warning that still counts. Warn first.");
    expect(W.restrictShort(2, "2026-09-20")).toBe(`Not open: 2 of the reports the account sent since the warning of 2026-09-20 were marked; a restriction needs ${STANDING_RULES.reportRestrictMarks}.`);
    expect(W.restrictRunning("x")).toBe("Not open: a restriction runs until x.");
    expect(STANDING_WORDS.reviewWarning).toBe(
      "A restriction of this account's reports rests on this warning. If you lift the warning, the restriction ends when you confirm, and this decision's statement says so.",
    );
    expect(M.rule).toContain(`for ${STANDING_RULES.reportFrameDays} days from the day it was sent`);
  });

  test("each control is open when the case answer says the database would accept it, and greyed with its reason otherwise", () => {
    const view = reportingCase();
    expect(reportingControlState(view, final(view), "warn")).toEqual({ open: true });
    expect(reportingControlState(view, final(view), "restrict")).toEqual({ open: false, why: "noWarning" });
    expect(reportingControlState(reportingCase({}, true), final(view), "warn")).toEqual({ open: false, why: "reportsFirst" });
    expect(reportingControlState(reportingCase({ mayWarn: false, unfounded: 4 }), final(view), "warn")).toEqual({ open: false, why: "warnShort" });
    const warned = reportingCase(WARNED_REPORTING);
    expect(reportingControlState(warned, final(warned), "warn")).toEqual({ open: false, why: "warnStanding" });
    expect(reportingControlState(warned, final(warned), "restrict")).toEqual({ open: true });
    expect(reportingControlState(reportingCase({ ...WARNED_REPORTING, marksSince: 2, mayRestrict: false }), final(warned), "restrict")).toEqual({ open: false, why: "restrictShort" });
    expect(reportingControlState(reportingCase({ ...WARNED_REPORTING, mayRestrict: false, restrictedUntil: "2026-10-20T09:00:00.000Z" }), final(warned), "restrict")).toEqual({ open: false, why: "running" });
    // Not shown while deciding, for an outcome that restricts nothing, on the law, or on a post case.
    expect(reportingControlState(view, final(view, { kind: "interim" }), "warn")).toBeNull();
    expect(reportingControlState(view, final(view, { outcome: "no_violation" }), "warn")).toBeNull();
    expect(reportingControlState(view, final(view, { ground: "illegal" }), "warn")).toBeNull();
    expect(reportingControlState(markCase(), final(markCase()), "warn")).toBeNull();
  });

  test("the composer shows both controls, the warning open and the restriction greyed with [restrict.noWarning]; [reports.first] greys both while a report waits", () => {
    const view = reportingCase();
    const out = composer(view, final(view));
    expect(out).toContain(`<input type="checkbox"/> <span>${W.warnLabel}</span>`);
    expect(out).toContain(`<input type="checkbox" disabled=""/> <span>${W.restrictLabel}</span>`);
    expect(out).toContain(esc(W.warnWhat(5, 8)));
    expect(out).toContain(esc(W.restrictNoWarning));
    const waiting = reportingCase({}, true);
    const greyed = composer(waiting, final(waiting));
    expect(greyed).toContain(`<input type="checkbox" disabled=""/> <span>${W.warnLabel}</span>`);
    expect(greyed).toContain(esc(STANDING_WORDS.reportsFirst));
  });

  test("choosing the warning sets R6 and drafts the facts in reports from the record as read, each report once with its marked items; the params sign it; the preview words it", () => {
    const view = reportingCase();
    const draft = withReporting(view, final(view, { ruleId: "R1", category: RULE_DEFAULT_CATEGORY.R1 }), "warn", null, NOW);
    expect(draft.actions).toEqual([{ kind: "warn_reporting", mediaId: null }]);
    expect(draft.ruleId).toBe("R6");
    expect(draft.category).toBe(RULE_DEFAULT_CATEGORY.R6);
    expect(markedList(view.standing!.reporting.marked)).toBe(
      `report N-AAAAAAAAAA of 2026-09-01 (item 1); report ${MARKED_REF} of 2026-09-03 (items 1 and 3); report N-BBBBBBBBBB of 2026-09-06 (item 2); report N-CCCCCCCCCC of 2026-09-08 (item 1); report N-DDDDDDDDDD of 2026-09-10 (item 1)`,
    );
    expect(draft.written.facts).toBe(
      `In the ${STANDING_RULES.reportFrameDays} days up to 2026-10-12 the account sent 8 reports under korbat's rules. A moderator marked 5 of them as manifestly unfounded: ${markedList(view.standing!.reporting.marked)}.`,
    );
    // Facts already written stay as they are.
    expect(withReporting(view, { ...final(view), written: { ...final(view).written, facts: "Mine." } }, "warn", null, NOW).written.facts).toBe("Mine.");
    expect(offeredDraft(view, MODERATOR, draft).actions).toEqual(draft.actions);
    // Another rule than R6, or a report that waits, loses the measure.
    expect(offeredDraft(view, MODERATOR, { ...draft, ruleId: "R1" }).actions).toEqual([]);
    expect(offeredDraft(reportingCase({}, true), MODERATOR, draft).actions).toEqual([]);
    const params = CaseDecidedParams.parse(decisionParamsOf(view, written(draft), DIGESTS));
    expect(params).toMatchObject({ kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R6", actions: [{ kind: "warn_reporting", mediaId: null }], unfounded: [] });
    const told = statementParagraphs(previewOf(view, written(draft), NOW));
    expect(told[0]).toContain("korbat warns you about your reports. Nothing is restricted.");
    expect(told).toContain(STATEMENT_WORDS.scope.warn);
  });

  test("choosing the restriction drafts the facts from the reports sent since the warning, signs its days and announced false, and previews the warning it follows", () => {
    const view = reportingCase(WARNED_REPORTING);
    const draft = withReporting(view, final(view), "restrict", 7, NOW);
    expect(draft.actions).toEqual([{ kind: "restrict_reporting", mediaId: null, days: 7, announced: false }]);
    expect(draft.written.facts).toBe(
      "Of the reports the account sent between korbat's warning of 2026-09-20 and 2026-10-12, a moderator marked 3 as manifestly unfounded: report N-EEEEEEEEEE of 2026-09-21 (item 1); report N-FFFFFFFFFF of 2026-09-23 (item 2); report N-GGGGGGGGGG of 2026-09-25 (item 1).",
    );
    // More days than the restriction's own number lose the measure; so does a warning that no longer counts.
    expect(offeredDraft(view, MODERATOR, { ...draft, actions: [{ kind: "restrict_reporting", mediaId: null, days: STANDING_RULES.reportRestrictDays + 1, announced: false }] }).actions).toEqual([]);
    expect(offeredDraft(reportingCase(), MODERATOR, draft).actions).toEqual([]);
    const params = CaseDecidedParams.parse(decisionParamsOf(view, written(draft), DIGESTS));
    expect(params.actions).toEqual([{ kind: "restrict_reporting", mediaId: null, days: 7, announced: false }]);
    const told = statementParagraphs(previewOf(view, written(draft), NOW)).join(" | ");
    expect(told).toContain("korbat restricted your reports under its rules for 7 days, until 2026-10-19 09:30 UTC");
    expect(told).toContain("It follows korbat's warning of 2026-09-20 08:00 UTC");
    expect(composer(view, draft)).toContain(esc(W.restrictWhat(7)));
  });
});

describe("3e Task 5: the mark manifestly unfounded and its withdrawal (design, sections 8.4 and 8.7)", () => {
  test("a final No breach decision offers the mark on each item it answers that can be marked, says once why another cannot, and signs the ticked items, sorted", () => {
    const view = markCase();
    const noBreach = final(view, { outcome: "no_violation", ruleId: "R1" });
    expect(markableItems(view, noBreach).map((each) => each.id)).toEqual([ITEM_REPORTER]);
    expect(markableItems(view, { ...noBreach, outcome: "restricted" })).toEqual([]);
    expect(markableItems(view, { ...noBreach, kind: "interim" })).toEqual([]);
    const out = composer(view, noBreach);
    expect(out).toContain(`<legend>${M.legend}</legend>`);
    expect(out).toContain(`<input type="checkbox"/> <span>${M.label}: item 1</span>`);
    expect(out).not.toContain(`${M.label}: item 2`);
    expect(out).toContain(esc(M.never));
    expect(out).toContain(esc(M.rule));
    expect(out).toContain(esc(M.undone));
    // Ticked, the item is signed; an item that cannot be marked never is, whatever the draft holds.
    const marked = { ...noBreach, unfounded: withMark(noBreach, ITEM_REPORTER, true) };
    expect(composer(view, marked)).toContain(`<input type="checkbox" checked=""/> <span>${M.label}: item 1</span>`);
    expect(decisionParamsOf(view, { ...marked, unfounded: [ITEM_NOTIFIER, ITEM_REPORTER] }, DIGESTS).unfounded).toEqual([ITEM_REPORTER]);
    expect(CaseDecidedParams.parse(decisionParamsOf(view, marked, DIGESTS))).toMatchObject({ kind: "final", outcome: "no_violation", unfounded: [ITEM_REPORTER] });
    // A restriction signs no mark, and the draft the composer shows drops them.
    expect(decisionParamsOf(view, { ...marked, outcome: "restricted", actions: [{ kind: "remove", mediaId: null }], ruleId: "R1" }, DIGESTS).unfounded).toEqual([]);
    expect(offeredDraft(view, MODERATOR, { ...marked, outcome: "restricted" }).unfounded).toEqual([]);
    expect(withMark(marked, ITEM_REPORTER, false)).toEqual([]);
  });

  test("the case page shows a mark that stands and one withdrawn, and offers Withdraw this decision's marks beside the decision while one stands", () => {
    const page = casePage(markedCase());
    expect(page).toContain(esc(M.marked));
    expect(page).toContain(`>${esc(M.withdrawLabel)}</button>`);
    const withdrawn = casePage(markedCase(true));
    expect(withdrawn).toContain(M.withdrawn);
    expect(withdrawn).not.toContain(`>${esc(M.withdrawLabel)}</button>`);
    expect(marksWithdrawable(markedCase(), markedCase().decisions[0]!, MODERATOR).map((each) => each.id)).toEqual([ITEM_MARKED]);
    // A decision that needed an admin is corrected by an admin.
    const admins = { ...markedCase().decisions[0]!, needsAdmin: true };
    expect(marksWithdrawable(markedCase(), admins, MODERATOR)).toEqual([]);
    expect(marksWithdrawable(markedCase(), admins, ADMIN)).toHaveLength(1);
  });

  test("the withdrawal is a kept correction that lifts nothing and signs no list; the page says what it does and that no statement is sent", () => {
    const view = markedCase();
    const draft = withdrawMarksDraft(caseId(view.id), view, view.decisions[0]!, MODERATOR);
    expect(complete(view, draft)).toBe(false);
    const reasoned = { ...draft, written: { ...draft.written, review_reason: "The reports were arguable." } };
    expect(complete(view, reasoned)).toBe(true);
    const params = CaseDecidedParams.parse(decisionParamsOf(view, reasoned, { ...DIGESTS, facts: null }));
    expect(params).toMatchObject({ kind: "correction", outcome: "kept", reviewsDecisionId: DECISION_MARKED, actions: [], unfounded: [], replaced: false });
    const out = composer(view, reasoned);
    expect(out).toContain(`>${esc(M.withdrawLabel)}</h3>`);
    expect(out).toContain(esc(M.withdrawWhat));
    expect(out).toContain(esc(M.noStatement));
    expect(out).not.toContain("Preview: the statement");
    // Once no mark stands, nothing is left to withdraw.
    expect(composer(markedCase(true), reasoned)).toContain("No mark of that decision stands any more.");
  });

  test("a review or a correction of a warning names its lift as the warning's, with [review.warning] when a restriction rests on it; the preview says the warning no longer counts", () => {
    const view = warnedCase();
    const decision = view.decisions[0]!;
    const review = reviewDraft(caseId(view.id), view, decision, MODERATOR);
    expect(reviewChoices(view, review, MODERATOR).map((choice) => choice.reversal)).toEqual([{ kind: "lift_reporting", mediaId: null }]);
    const lifted = { ...review, review: "reversed" as const, actions: [{ kind: "lift_reporting" as const, mediaId: null }], written: { ...review.written, review_reason: "The marks were arguable." } };
    const out = composer(view, lifted);
    expect(out).toContain(W.liftWarning);
    expect(out).toContain(esc(STANDING_WORDS.reviewWarning));
    expect(statementParagraphs(previewOf(view, lifted, NOW))).toContain(STATEMENT_WORDS.reportingLifted.warning);
    const correction = correctionDraft(caseId(view.id), view, decision, ADMIN);
    expect(correctionChoices(view, correction, ADMIN).map((choice) => choice.reversal.kind)).toEqual(["lift_reporting"]);
    expect(composer(view, correction, ADMIN)).toContain(W.liftWarning);
    expect(DECISION_WARNED).toBe(decision.id);
  });
});

describe("3e Task 5: the Standing screen's reporting records (design, section 8.6)", () => {
  test("each record by handle as text, in reports, at the threshold or warned with the marked reports since, with Open a case on this account under R6", () => {
    const lists: StandingLists = {
      atThreeStrikes: { total: 0, items: [] },
      reportingRecords: {
        total: 2,
        items: [
          { handle: HOSTILE.script, caseId: null, reports: 8, unfounded: 5, warnedOn: null, marksSince: null },
          { handle: "warned_one", caseId: null, reports: 11, unfounded: 8, warnedOn: "2026-09-20", marksSince: 3 },
        ],
      },
      noticesUndelivered: { total: 0, items: [] },
      terminationsWaiting: { total: 0, items: [] },
    };
    const out = html(<StandingView lists={{ state: "ready", value: lists }} opening={{ handle: null, error: null }} onOpenCase={noop} onOpenFinding={noop} />);
    expect(out).toContain(esc(STANDING_WORDS.lists.reportingRow(HOSTILE.script, 5, 8)));
    expect(out).toContain(STANDING_WORDS.lists.reportingThreshold);
    expect(out).toContain(STANDING_WORDS.lists.reportingWarned("2026-09-20", 3));
    expect(out).not.toContain(HOSTILE.script);
  });
});
