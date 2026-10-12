import { CaseDecidedParams, CaseView, MEASURES, STANDING_RULES, type CaseDecision, type StaffMe } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  correctionChoices,
  correctionDraft,
  decisionParamsOf,
  newDraft,
  previewOf,
  reviewChoices,
  reviewDraft,
  reviewParamsOf,
  strikeLine,
  type CaseDraft,
} from "../src/compose";
import { CONSOLE_MODERATION_CODES, MODERATION_MESSAGES, STANDING_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { accountCase, decision, frozenCase, IMAGE_ONE, NO_STANDING, postCase, strikeCase, struckCase } from "./case-fixtures";

/**
 * The console's part of strikes (3e design, sections 8.2, 8.7 and 8.9): the strike line under "Restrict" and the strike
 * the params carry exactly when it says one is given; the overruling a full reversal adds, and never a reversal in part;
 * the author's standing in bands above the evidence; [review.strike] and [review.rests]; and the words of the five new
 * codes. Every number in the words is STANDING_RULES', never typed.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-12T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const HEX = "cd".repeat(32);
const DIGESTS = { snapshot: HEX, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: "cc".repeat(32) };

const REMOVAL_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const APPEAL_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

/** A final removal under R1 that gave a strike, with the strike's row as the case answer carries it. */
function struck(restedOnBy: ("suspend" | "terminate")[] = [], strikeInForce = true): CaseDecision {
  return decision({
    id: REMOVAL_ID,
    kind: "final",
    rulesVersion: 3,
    redressVersion: 2,
    actions: [
      { ...decision().actions[0]!, id: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f", kind: "remove" },
      { ...decision().actions[0]!, ...NO_STANDING, id: "d4e5f6a7-b8c9-4dae-9f2a-3b4c5d6e7f80", kind: "strike", inForce: strikeInForce, countsUntil: "2027-01-10T09:00:00.000Z", restedOnBy },
    ],
  });
}

/** The post case that holds that removal, closed, with its appeal pending for this person. */
const appealedStrike = (decided: CaseDecision = struck()): CaseView =>
  postCase({
    closedAt: "2026-10-01T09:00:00.000Z",
    strikeDue: { due: false, why: "already_struck" },
    decisions: [decided],
    appeals: [{ id: APPEAL_ID, decisionId: REMOVAL_ID, filedAt: "2026-10-03T10:00:00.000Z", statement: "Please look again.", answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true }],
  });

function composer(view: CaseView, draft: CaseDraft) {
  const props: ComposerViewProps = { view, role: MODERATOR, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
  return html(<ComposerView {...props} />);
}

const finalRemoval = (view: CaseView, change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, MODERATOR), kind: "final", actions: [{ kind: "remove", mediaId: null }], ...change });

describe("the strike line and the strike the params carry", () => {
  test("the line names why a decision gives a strike or not, and the params carry one exactly when it says it is given", () => {
    const view = postCase();
    const cases: [CaseView, Partial<CaseDraft>, ReturnType<typeof strikeLine>][] = [
      [view, {}, "due"],
      [view, { kind: "interim", actions: [{ kind: "withhold", mediaId: null }] }, "interim"],
      [view, { ground: "illegal" }, "law"],
      [view, { ruleId: "R2" }, "r2"],
      [postCase({ strikeDue: { due: false, why: "already_struck" } }), {}, "already"],
      [postCase({ strikeDue: { due: false, why: "before_last_strike" } }), {}, "before"],
      [view, { outcome: "no_violation", actions: [] }, null],
    ];
    for (const [shown, change, line] of cases) {
      const draft = finalRemoval(shown, change);
      expect(strikeLine(shown, draft), JSON.stringify(change)).toBe(line);
      const params = decisionParamsOf(shown, draft, DIGESTS);
      expect(params.actions.some((action) => action.kind === "strike"), JSON.stringify(change)).toBe(line === "due");
      expect(params).toMatchObject({ unfounded: [], replaced: false });
      expect(CaseDecidedParams.safeParse(params).success).toBe(true);
    }
    // A final decision that answers a report of child sexual abuse material gives none, whatever the answer said.
    const frozen = frozenCase({ decisions: [] });
    expect(strikeLine(frozen, finalRemoval(frozen, { ruleId: "R1" }))).toBe("r2");
    // An account case has no line: no decision about a profile gives a strike.
    const account = accountCase();
    expect(strikeLine(account, { ...newDraft(caseId(account.id), account, MODERATOR), kind: "final", actions: [{ kind: "reset_bio", mediaId: null }] })).toBeNull();
  });

  test("the composer shows the line under Restrict in the design's words, and the preview tells the strike as its author will read it", () => {
    const view = postCase();
    expect(composer(view, finalRemoval(view))).toContain(esc(STANDING_WORDS.strike.due));
    expect(composer(view, finalRemoval(view, { kind: "interim", actions: [] }))).toContain(esc(STANDING_WORDS.strike.none.interim));
    expect(composer(postCase({ strikeDue: { due: false, why: "before_last_strike" } }), finalRemoval(view))).toContain(esc(STANDING_WORDS.strike.none.before));
    expect(composer(view, finalRemoval(view, { outcome: "no_violation", actions: [] }))).not.toContain(esc(STANDING_WORDS.strike.due));
    // The author has 1 active strike in the fixture's band, so this one is the second; it counts strikeDays from now.
    const preview = previewOf(view, finalRemoval(view), NOW);
    const ends = new Date(NOW.getTime() + STANDING_RULES.strikeDays * 86_400_000).toISOString();
    expect(preview.measures.map((measure) => measure.kind)).toEqual(["remove", "strike"]);
    expect(preview.measures[1]).toMatchObject({ endsAt: ends, activeThen: 2 });
    const paragraphs = statementParagraphs(preview);
    expect(paragraphs.join(" ")).toContain("This decision gives your account a strike.");
    expect(paragraphs).toContain(STATEMENT_WORDS.automationStrike);
  });
});

describe("a correction or a review of a decision that gave a strike", () => {
  test("the strike is never offered on its own: a full reversal overrules it, a reversal in part never does", () => {
    const view = appealedStrike();
    const decided = view.decisions[0]!;
    const correction = correctionDraft(caseId(view.id), view, decided, "admin");
    expect(correctionChoices(view, correction, "admin").map((choice) => choice.reversal.kind)).toEqual(["restore"]);
    const whole = decisionParamsOf(view, { ...correction, actions: [{ kind: "restore", mediaId: null }] }, { ...DIGESTS, facts: null, legalReference: null });
    expect(whole).toMatchObject({ outcome: "reversed", actions: [{ kind: "overrule", mediaId: null }, { kind: "restore", mediaId: null }] });
    const review = reviewDraft(caseId(view.id), view, decided, MODERATOR);
    expect(reviewChoices(view, review, MODERATOR).map((choice) => choice.reversal.kind)).toEqual(["restore"]);
    const reversed = reviewParamsOf(view, { ...review, review: "reversed", actions: [{ kind: "restore", mediaId: null }] }, { snapshot: HEX, reason: HEX });
    expect(reversed.actions).toEqual([{ kind: "overrule", mediaId: null }, { kind: "restore", mediaId: null }]);
    expect(reviewParamsOf(view, { ...review, review: "kept", actions: [] }, { snapshot: HEX, reason: HEX }).actions).toEqual([]);
    // The preview tells the overruling with the reversal.
    expect(statementParagraphs(previewOf(view, { ...review, review: "reversed", actions: [{ kind: "restore", mediaId: null }] }, NOW))).toContain(STATEMENT_WORDS.overruled);
    // A strike already overruled is not overruled again.
    const overruled = appealedStrike(struck([], false));
    const again = reviewDraft(caseId(overruled.id), overruled, overruled.decisions[0]!, MODERATOR);
    expect(reviewParamsOf(overruled, { ...again, review: "reversed", actions: [{ kind: "restore", mediaId: null }] }, { snapshot: HEX, reason: HEX }).actions).toEqual([{ kind: "restore", mediaId: null }]);
  });

  test("with a removal and an image's removal, Reverse in part lifts one of them and leaves the strike; Reverse lifts both and overrules it", () => {
    const withImage = struck();
    withImage.actions.splice(1, 0, { ...decision().actions[0]!, id: "e5f6a7b8-c9da-4ebf-a03b-4c5d6e7f8091", kind: "remove_media", mediaId: IMAGE_ONE });
    const view = appealedStrike(withImage);
    const review = reviewDraft(caseId(view.id), view, withImage, MODERATOR);
    expect(reviewChoices(view, review, MODERATOR).map((choice) => choice.reversal.kind)).toEqual(["restore", "restore_media"]);
    expect(reviewParamsOf(view, { ...review, review: "partly_reversed", actions: [{ kind: "restore", mediaId: null }] }, { snapshot: HEX, reason: HEX }).actions).toEqual([{ kind: "restore", mediaId: null }]);
    const all = [
      { kind: "restore", mediaId: null },
      { kind: "restore_media", mediaId: IMAGE_ONE },
    ] as const;
    expect(reviewParamsOf(view, { ...review, review: "reversed", actions: [...all] }, { snapshot: HEX, reason: HEX }).actions.map((action) => action.kind)).toEqual(["overrule", "restore", "restore_media"]);
  });

  test("[review.strike] stands beside the reversals of a decision whose strike stands, and [review.rests] when a suspension rests on it", () => {
    const plain = appealedStrike();
    const out = composer(plain, reviewDraft(caseId(plain.id), plain, plain.decisions[0]!, MODERATOR));
    expect(out).toContain(esc(STANDING_WORDS.reviewStrike));
    expect(out).not.toContain(esc(STANDING_WORDS.reviewRests));
    const resting = appealedStrike(struck(["suspend"]));
    const rests = composer(resting, reviewDraft(caseId(resting.id), resting, resting.decisions[0]!, MODERATOR));
    expect(rests).toContain(esc(STANDING_WORDS.reviewRests));
    expect(STANDING_WORDS.reviewRests).toContain(`fewer than ${STANDING_RULES.ladderStrikes} of its strikes`);
    // The correction shows them too; a decision without a strike shows neither.
    expect(composer(resting, correctionDraft(caseId(resting.id), resting, resting.decisions[0]!, "admin"))).toContain(esc(STANDING_WORDS.reviewRests));
    const none = postCase({ decisions: [decision({ kind: "final", actions: [{ ...decision().actions[0]!, kind: "remove" }] })] });
    expect(composer(none, correctionDraft(caseId(none.id), none, none.decisions[0]!, "admin"))).not.toContain(esc(STANDING_WORDS.reviewStrike));
  });
});

describe("the author's standing and the words", () => {
  const base: Omit<CaseScreenViewProps, "caseId" | "view"> = {
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
  };
  const page = (view: CaseView) => html(<CaseScreenView {...base} caseId={caseId(view.id)} view={view} />);

  test("a post case shows its author's standing in bands above the evidence, with [post.standing]; an account case shows none", () => {
    const out = page(postCase({ authorStanding: { activeStrikes: "3_or_more", suspensionsInYear: "1", now: "announced" } }));
    for (const words of ["Active strikes: 3 or more", `Suspensions decided in the last ${STANDING_RULES.ladderMemoryDays} days: 1`, "Now: a suspension is announced", STANDING_WORDS.postStanding]) expect(out, words).toContain(esc(words));
    expect(out.indexOf("The author&#x27;s standing")).toBeLessThan(out.indexOf(">Evidence<"));
    expect(page(accountCase())).not.toContain("The author&#x27;s standing");
    // A strike's row says until when it counts.
    const struckView = appealedStrike();
    expect(page(struckView)).toContain(`${MEASURES.strike.label}: in force; counts until 2027-01-10 09:00`);
    // The browser check's two cases are cases as the contracts describe them.
    for (const view of [struckView, strikeCase(), struckCase()]) expect(CaseView.safeParse(view).success, view.id).toBe(true);
  });

  test("the five codes of 3e are worded, the composer's three as section 8.9 says", () => {
    for (const code of ["strike_mismatch", "standing_conflict", "ground_not_established", "reply_not_open", "reporting_restricted"] as const) {
      expect(CONSOLE_MODERATION_CODES).toContain(code);
      expect(MODERATION_MESSAGES[code].length, code).toBeGreaterThan(20);
    }
    expect(MODERATION_MESSAGES.strike_mismatch).toBe("The strike rule changed for this post since this page read it. Read the case again and decide again.");
    expect(MODERATION_MESSAGES.standing_conflict).toBe(STANDING_WORDS.conflict);
    expect(MODERATION_MESSAGES.ground_not_established).toBe(STANDING_WORDS.terminateR2);
  });
});
