import { CaseDecidedParams, STANDING_DRAFTS, STANDING_RULES, type CaseDecision, type CaseView, type StaffMe } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AT_ONCE_DAYS, atOnceGroundOf, atOnceState, correctionChoices, correctionDraft, decisionParamsOf, newDraft, offeredDraft, previewOf, withAtOnce, type CaseDraft } from "../src/compose";
import { STANDING_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { atOnceCase, decision, NO_STANDING } from "./case-fixtures";

/**
 * The console's part of a suspension taken at once (3e design, sections 8.3, 8.7 and 10.3; Task 3): "Suspend at once" on
 * an account case's final restriction, offered to an admin on the ground of the chosen rule when the case answer says the
 * database would accept it, and greyed with its sentence otherwise; the four grounds marked; the drafted facts; the
 * params and the preview; the lift in a correction, and [review.basis] and [review.protective]. Pure parts are tested as
 * functions, screens server-rendered.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-12T09:30:00.000Z");
const ADMIN: StaffMe["role"] = "admin";
const MODERATOR: StaffMe["role"] = "moderator";
const HEX = "cd".repeat(32);
const DIGESTS = { snapshot: HEX, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null };
const SUSPENSION = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const SUSPEND_ACTION = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";

const final = (view: CaseView, role: StaffMe["role"], change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, role), kind: "final", ruleId: "R5", ...change });

function composer(view: CaseView, role: StaffMe["role"], draft: CaseDraft) {
  const props: ComposerViewProps = { view, role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
  return html(<ComposerView {...props} />);
}

describe("3e: a suspension at once in the composer of an account case (design, section 8.3)", () => {
  test("the words are the design's, each number printed from STANDING_RULES", () => {
    expect(STANDING_WORDS.atOnce.what).toBe(
      "A suspension at once restricts the account when you confirm. Only an admin takes one, and only on a ground the database checks. The statement goes at once; the account may reply and appeal from the first minute, and a reply does not pause it.",
    );
    expect(STANDING_WORDS.atOnce.threat).toContain(`at most ${STANDING_RULES.basisAgeDays} days old. Up to ${STANDING_RULES.threatDays} days.`);
    expect(STANDING_WORDS.atOnce.flood(23, "A", "B")).toBe(
      `Spam flood (R6): the account made 23 posts between A and B; the ground needs at least ${STANDING_RULES.floodPosts} in ${STANDING_RULES.floodMinutes} minutes. Up to ${STANDING_RULES.floodDays} days. The count alone is no flood: say in the facts what made the posts repetitive and unsolicited.`,
    );
    expect(STANDING_WORDS.atOnce.protective("2026-10-01")).toContain(`on 2026-10-01, at most ${STANDING_RULES.basisAgeDays} days ago`);
    expect(STANDING_WORDS.atOnce.admin).toBe("Only an admin suspends at once. You can withhold the content while deciding; the account measure waits for an admin.");
    expect(STANDING_WORDS.atOnce.other).toBe("This rule allows no suspension at once: announce it.");
    expect(STANDING_WORDS.atOnce.noSeal).toContain("A report alone, or a seal taken while deciding, is not enough.");
    expect(STANDING_WORDS.reportsFirst).toBe("Not open: this case holds a report that is not answered yet. Decide the reports in this case first; the measure gets a case of its own.");
    expect(AT_ONCE_DAYS).toEqual({ threat: STANDING_RULES.threatDays, terrorist: STANDING_RULES.terroristDays, flood: STANDING_RULES.floodDays, protective: STANDING_RULES.protectiveDays });
  });

  test("the ground follows the rule or the law, and the control is open to an admin on a ground the database would accept, greyed with its reason otherwise", () => {
    const view = atOnceCase();
    expect(atOnceGroundOf({ ground: "incompatible", ruleId: "R5", terrorist: false })).toBe("threat");
    expect(atOnceGroundOf({ ground: "incompatible", ruleId: "R6", terrorist: false })).toBe("flood");
    expect(atOnceGroundOf({ ground: "incompatible", ruleId: "R2", terrorist: false })).toBe("protective");
    expect(atOnceGroundOf({ ground: "illegal", ruleId: "R1", terrorist: true })).toBe("terrorist");
    expect(atOnceGroundOf({ ground: "illegal", ruleId: "R1", terrorist: false })).toBeNull();
    expect(atOnceGroundOf({ ground: "incompatible", ruleId: "R3", terrorist: false })).toBeNull();
    expect(atOnceState(view, ADMIN, final(view, ADMIN))).toEqual({ open: true, ground: "threat" });
    expect(atOnceState(view, MODERATOR, final(view, MODERATOR))).toMatchObject({ open: false, why: "admin" });
    expect(atOnceState(view, ADMIN, final(view, ADMIN, { ruleId: "R3" }))).toMatchObject({ open: false, why: "other" });
    expect(atOnceState(view, ADMIN, final(view, ADMIN, { ground: "illegal", terrorist: true }))).toMatchObject({ open: false, why: "unmet", ground: "terrorist" });
    expect(atOnceState(atOnceCase({ live: true }), ADMIN, final(view, ADMIN))).toMatchObject({ open: false, why: "conflict" });
    // The protective ground: no seal for good is no seal; a report that waits holds it back even with one.
    const r2 = atOnceCase({}, "R2");
    expect(atOnceState(r2, ADMIN, final(r2, ADMIN, { ruleId: "R2" }))).toMatchObject({ open: false, why: "noSeal" });
    const sealed = atOnceCase({ atOnce: ["protective"], seal: { decidedOn: "2026-10-05" }, basisDecidedAt: { threat: null, terrorist: null, protective: "2026-10-05T10:00:00.000Z" } }, "R2");
    expect(atOnceState(sealed, ADMIN, final(sealed, ADMIN, { ruleId: "R2" }))).toEqual({ open: true, ground: "protective" });
    expect(atOnceState({ ...sealed, standing: { ...sealed.standing!, openReports: true } }, ADMIN, final(sealed, ADMIN, { ruleId: "R2" }))).toMatchObject({ open: false, why: "reportsFirst" });
    // Not shown at all while deciding, on a post case or for an outcome that restricts nothing.
    expect(atOnceState(view, ADMIN, final(view, ADMIN, { kind: "interim" }))).toBeNull();
    expect(atOnceState(view, ADMIN, final(view, ADMIN, { outcome: "no_violation" }))).toBeNull();
  });

  test("an admin's composer lists the four grounds, each marked met or not, and the control with its days; a moderator's is greyed with [atOnce.admin]; the protective ground is greyed with [atOnce.noSeal]", () => {
    const view = atOnceCase();
    const out = composer(view, ADMIN, final(view, ADMIN));
    expect(out).toContain(STANDING_WORDS.atOnce.label);
    expect(out).toContain(esc(STANDING_WORDS.atOnce.what));
    expect(out).toContain(esc(STANDING_WORDS.atOnce.threat));
    expect(out).toContain(esc(STANDING_WORDS.atOnce.terrorist));
    expect(out).toContain(esc(STANDING_WORDS.atOnce.noSeal));
    expect(out.split(`<strong>${STANDING_WORDS.atOnce.met}</strong>`).length - 1).toBe(2);
    expect(out.split(`<strong>${STANDING_WORDS.atOnce.unmet}</strong>`).length - 1).toBe(2);
    expect(out).not.toContain(esc(STANDING_WORDS.atOnce.admin));
    // On a case under R5 a final decision is an admin's anyway; under R6 a moderator decides it and meets [atOnce.admin].
    const r6 = atOnceCase({}, "R6");
    const greyed = composer(r6, MODERATOR, final(r6, MODERATOR, { ruleId: "R6" }));
    expect(greyed).toContain(esc(STANDING_WORDS.atOnce.admin));
    expect(greyed).toMatch(/<input type="checkbox" disabled=""\/> <span>Suspend at once<\/span>/);
    const r2 = atOnceCase({}, "R2");
    expect(composer(r2, ADMIN, final(r2, ADMIN, { ruleId: "R2" }))).toMatch(/<input type="checkbox" disabled=""\/> <span>Suspend at once/);
  });

  test("choosing it adds the suspension taken at once and the ground's drafted facts; the params sign its days and announced false; the preview is the statement the account will get", () => {
    const view = atOnceCase();
    const draft = withAtOnce(view, final(view, ADMIN, { ruleId: "R6" }), "flood", 5);
    expect(draft.actions).toEqual([{ kind: "suspend", mediaId: null, days: 5, announced: false }]);
    expect(draft.written.facts).toBe("The account made 23 posts between 2026-10-12T08:30:00.000Z and 2026-10-12T09:30:00.000Z.");
    expect(draft.written.reason).toBe("");
    expect(offeredDraft(view, ADMIN, draft).actions).toEqual(draft.actions);
    // A moderator's draft, and more days than the ground allows, lose the suspension.
    expect(offeredDraft(view, MODERATOR, draft).actions).toEqual([]);
    expect(offeredDraft(view, ADMIN, { ...draft, actions: [{ kind: "suspend", mediaId: null, days: STANDING_RULES.floodDays + 1, announced: false }] }).actions).toEqual([]);
    const params = CaseDecidedParams.parse(decisionParamsOf(view, { ...draft, written: { ...draft.written, reason: "The posts repeat one link." } }, DIGESTS));
    expect(params.actions).toEqual([{ kind: "suspend", mediaId: null, days: 5, announced: false }]);
    expect(params).toMatchObject({ kind: "final", outcome: "restricted", ruleId: "R6" });
    const paragraphs = statementParagraphs(previewOf(view, draft, NOW));
    expect(paragraphs[0]).toBe(`${STATEMENT_WORDS.suspendAtOnce(5, "2026-10-17 09:30 UTC")} ${STATEMENT_WORDS.basis.flood}`);
    expect(paragraphs).toContain(STATEMENT_WORDS.automationFlood);
    expect(paragraphs).toContain(REDRESS_TEXTS[2].replyAtOnce);
    // On a threat the basis sentence names the decision it rests on by the time the case answer gave.
    const threat = statementParagraphs(previewOf(view, withAtOnce(view, final(view, ADMIN), "threat", 7), NOW));
    expect(threat[0]).toBe(`${STATEMENT_WORDS.suspendAtOnce(7, "2026-10-19 09:30 UTC")} ${STATEMENT_WORDS.basis.threat("2026-10-10 08:00 UTC")}`);
    // A protective suspension's drafts: the seal's day, and the fixed reason; its preview never says that a rule is broken.
    const sealed = atOnceCase({ atOnce: ["protective"], seal: { decidedOn: "2026-10-05" }, basisDecidedAt: { threat: null, terrorist: null, protective: "2026-10-05T10:00:00.000Z" } }, "R2");
    const protective = withAtOnce(sealed, final(sealed, ADMIN, { ruleId: "R2" }), "protective", 14);
    expect(protective.written.facts).toBe(STANDING_DRAFTS.facts.protective.replace("{sealedOn}", "2026-10-05"));
    expect(protective.written.reason).toBe(STANDING_DRAFTS.reason.protective);
    expect(statementParagraphs(previewOf(sealed, protective, NOW)).join(" | ")).not.toContain("It breaks");
  });
});

describe("3e: the lift of a suspension at once and what a review says of one (design, section 8.7)", () => {
  /** The final decision that suspended the account at once on a threat, running. */
  function suspended(): CaseDecision {
    return decision({
      id: SUSPENSION,
      kind: "final",
      ruleId: "R5",
      rulesVersion: 3,
      redressVersion: 2,
      needsAdmin: true,
      actions: [
        {
          ...decision().actions[0]!,
          ...NO_STANDING,
          id: SUSPEND_ACTION,
          kind: "suspend",
          inForce: true,
          days: 7,
          announced: false,
          basis: "threat",
          earliestStart: "2026-10-11T09:00:00.000Z",
          period: { startsAt: "2026-10-11T09:00:00.000Z", endsAt: "2026-10-18T09:00:00.000Z", state: "running" },
        },
      ],
    });
  }

  test("an admin's correction offers Lift the suspension; its preview says it ended with the decision; a moderator is offered nothing", () => {
    const view = { ...atOnceCase({ live: true }), decisions: [suspended()] };
    const draft = correctionDraft(caseId(view.id), view, view.decisions[0]!, ADMIN);
    const choices = correctionChoices(view, draft, ADMIN);
    expect(choices.map((choice) => choice.reversal)).toEqual([{ kind: "lift_suspension", mediaId: null }]);
    expect(correctionChoices(view, correctionDraft(caseId(view.id), view, view.decisions[0]!, MODERATOR), MODERATOR)).toEqual([]);
    const lifting = { ...draft, actions: [{ kind: "lift_suspension" as const, mediaId: null }], written: { ...draft.written, review_reason: "The threat was a quote." } };
    expect(statementParagraphs(previewOf(view, lifting, NOW))).toContain(STATEMENT_WORDS.liftedRunning("suspension"));
    expect(CaseDecidedParams.parse(decisionParamsOf(view, lifting, DIGESTS))).toMatchObject({ kind: "correction", outcome: "reversed", actions: [{ kind: "lift_suspension", mediaId: null }] });
  });

  test("[review.basis] beside a correction of a decision that a suspension at once rests on, [review.protective] beside one of a protective suspension", () => {
    const basis = decision({ id: SUSPENSION, kind: "final", ruleId: "R5", standingOn: [{ kind: "suspend", basis: "threat" }] });
    const view = { ...atOnceCase(), decisions: [basis] };
    const out = composer(view, ADMIN, correctionDraft(caseId(view.id), view, basis, ADMIN));
    expect(out).toContain(esc(STANDING_WORDS.reviewBasis));
    expect(out).not.toContain(esc(STANDING_WORDS.reviewProtective));
    const protective = suspended();
    protective.actions[0] = { ...protective.actions[0]!, basis: "protective" };
    const sealedView = { ...atOnceCase({ live: true }), decisions: [protective] };
    const correction = composer(sealedView, ADMIN, correctionDraft(caseId(sealedView.id), sealedView, protective, ADMIN));
    expect(correction).toContain(esc(STANDING_WORDS.reviewProtective));
    expect(correction).not.toContain(esc(STANDING_WORDS.reviewBasis));
  });
});
