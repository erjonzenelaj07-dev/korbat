import { CaseDecidedParams, MEASURES, RETIRED_HANDLE_PREFIX, type CaseDecision, type CaseView, type StaffMe } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  COMPOSER,
  PREVIEW_PLACEHOLDER,
  correctionChoices,
  correctionDraft,
  decisionParamsOf,
  measuresOffered,
  newDraft,
  noEffectOf,
  offeredDraft,
  previewOf,
  retireMoved,
  retireOpen,
  reviewChoices,
  reviewDraft,
  reviewParamsOf,
  type CaseDraft,
} from "../src/compose";
import { STANDING_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { accountCase, decision, NO_STANDING, retireCase } from "./case-fixtures";

/**
 * The console's part of the retirement of a handle (3e design, sections 8.3, 8.7 and 10.3): the control in the composer
 * of an account case, with [retire.what], [retire.first], [retire.moved], [retire.none] and the no-effect sentence; the
 * params, in which the retirement is one action of the list in its one order; the preview; and "Give the handle back"
 * with [review.handle] in a correction and a review. Its pure parts are tested as functions, its screens server-rendered.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-12T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const HEX = "cd".repeat(32);
const DIGESTS = { snapshot: HEX, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null };
const PLACEHOLDER = `${RETIRED_HANDLE_PREFIX}0a1b2c3d4e5f`;
const RETIREMENT = "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const RETIRE_ACTION = "0b1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e";
const APPEAL = "1c2d3e4f-5a6b-4c7d-8e8f-9a0b1c2d3e4f";

const retire = { kind: "retire_handle" as const, mediaId: null };
const finalRetire = (view: CaseView, change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, MODERATOR), kind: "final", ruleId: "R4", actions: [retire], ...change });

function composer(view: CaseView, draft: CaseDraft) {
  const props: ComposerViewProps = { view, role: MODERATOR, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
  return html(<ComposerView {...props} />);
}

/** The final decision under R4 that retired the account's handle, with its retirement's row as the case answer carries it. */
function retired(inForce = true): CaseDecision {
  const view = retireCase();
  return decision({
    id: RETIREMENT,
    kind: "final",
    ruleId: "R4",
    rulesVersion: 3,
    redressVersion: 2,
    category: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
    snapshotId: view.snapshots[0]!.id,
    actions: [{ ...decision().actions[0]!, ...NO_STANDING, id: RETIRE_ACTION, kind: "retire_handle", inForce, handle: "ada_l" }],
  });
}

/** The account case that holds that retirement, closed, the profile on its placeholder, with an appeal this person may review. */
const retiredCase = (decided: CaseDecision = retired()): CaseView => ({
  ...retireCase(PLACEHOLDER, "Ada_L", { snapshotHandleRetired: true, openReports: false }),
  closedAt: "2026-10-05T09:00:00.000Z",
  answeredSeq: 1,
  decisions: [decided],
  appeals: [{ id: APPEAL, decisionId: RETIREMENT, filedAt: "2026-10-06T10:00:00.000Z", statement: "That was my own name.", answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true }],
});

describe("the control in the composer of an account case (8.3)", () => {
  test("the retirement is offered in a final decision on an account case to any moderator, never while deciding and never on a post case", () => {
    const view = retireCase();
    // 2d Task 4 (7.7): the reset of a profile picture follows them, last in the ledger's order.
    expect(measuresOffered(view, "final")).toEqual(["reset_display_name", "reset_bio", "retire_handle", "reset_avatar"]);
    expect(measuresOffered(view, "interim")).toEqual(["reset_display_name", "reset_bio", "reset_avatar"]);
    expect(MEASURES.retire_handle.label).toBe("Retire the handle");
    const out = composer(view, finalRetire(view, { actions: [] }));
    expect(out).toContain(MEASURES.retire_handle.label);
    expect(out).toContain(esc(STANDING_WORDS.retire.what));
    // Not chosen yet: the sentence about its place in the decision waits for the choice.
    expect(out).not.toContain(esc(STANDING_WORDS.retire.first));
    expect(composer(view, finalRetire(view))).toContain(esc(STANDING_WORDS.retire.first));
    expect(retireOpen(view)).toBe(true);
    expect(retireMoved(view)).toBe(false);
  });

  test("[retire.moved] when the profile's handle now differs from the snapshot's, in any case; the retirement still names the snapshot's", () => {
    const moved = retireCase("ada_new", "Ada_L");
    expect(retireMoved(moved)).toBe(true);
    expect(retireMoved(retireCase("ADA_L", "ada_l"))).toBe(false);
    expect(composer(moved, finalRetire(moved))).toContain(esc(STANDING_WORDS.retire.moved));
    expect(composer(retireCase(), finalRetire(retireCase()))).not.toContain(esc(STANDING_WORDS.retire.moved));
    // The statement names the handle of the snapshot, lowercased, as the database retires it.
    expect(statementParagraphs(previewOf(moved, finalRetire(moved), NOW))[0]).toBe(STATEMENT_WORDS.retire("ada_l", PREVIEW_PLACEHOLDER, "at_once"));
  });

  test("[retire.none] greys the control while the profile holds a placeholder, and a draft that held it loses it", () => {
    const view = retireCase(PLACEHOLDER, PLACEHOLDER);
    expect(retireOpen(view)).toBe(false);
    const out = composer(view, finalRetire(view, { actions: [] }));
    expect(out).toContain(esc(STANDING_WORDS.retire.none));
    // The checkbox before the label is disabled.
    const label = out.indexOf(">Retire the handle<");
    expect(out.slice(out.lastIndexOf("<li>", label), label)).toContain('disabled=""');
    expect(offeredDraft(view, MODERATOR, finalRetire(view)).actions).toEqual([]);
    // An open control keeps a chosen retirement.
    expect(offeredDraft(retireCase(), MODERATOR, finalRetire(retireCase())).actions).toEqual([retire]);
  });

  test("when the snapshot's handle is already retired the control stays open with the no-effect sentence; on a deleted account it says so too", () => {
    const view = retireCase("ada_new", "Ada_L", { snapshotHandleRetired: true });
    expect(retireOpen(view)).toBe(true);
    expect(noEffectOf(view, retire, "final")).toBe("already");
    expect(composer(view, finalRetire(view))).toContain(esc(COMPOSER.noEffect));
    expect(noEffectOf(retireCase(), retire, "final")).toBeNull();
    const gone = { ...retireCase(), target: { ...retireCase().target, deleted: true } } as CaseView;
    expect(noEffectOf(gone, retire, "final")).toBe("deleted");
    // The preview says what the author will read: the handle, and that it changes nothing now.
    expect(statementParagraphs(previewOf(view, finalRetire(view), NOW))[0]).toBe(`${STATEMENT_WORDS.retireLead("ada_l")} ${STATEMENT_WORDS.retireAlready}`);
  });

  test("the params carry the retirement in the list's one order, beside a reset of the display name; the decide route moves it first", () => {
    const view = retireCase();
    const params = decisionParamsOf(view, finalRetire(view, { actions: [retire, { kind: "reset_display_name", mediaId: null }] }), DIGESTS);
    expect(params.actions).toEqual([{ kind: "reset_display_name", mediaId: null }, retire]);
    expect(params).toMatchObject({ kind: "final", outcome: "restricted", ruleId: "R4", unfounded: [], replaced: false });
    expect(CaseDecidedParams.safeParse(params).success).toBe(true);
    // No strike: a decision on an account case never gives one.
    expect(params.actions.some((action) => action.kind === "strike")).toBe(false);
  });

  test("the preview prints the snapshot's handle and the placeholder's form, since the measure has no id yet; its sentence ends at once", () => {
    const view = retireCase();
    expect(PREVIEW_PLACEHOLDER).toBe(`${RETIRED_HANDLE_PREFIX}xxxxxxxxxxxx`);
    expect(PREVIEW_PLACEHOLDER).toHaveLength(20);
    const preview = previewOf(view, finalRetire(view), NOW);
    expect(preview.measures).toEqual([{ kind: "retire_handle", mediaId: null, noEffect: null, sealed: null, handle: "ada_l", placeholder: PREVIEW_PLACEHOLDER }]);
    const paragraphs = statementParagraphs(preview);
    expect(paragraphs[0]).toBe(STATEMENT_WORDS.retire("ada_l", PREVIEW_PLACEHOLDER, "at_once"));
    expect(paragraphs).toContain(STATEMENT_WORDS.scope.final);
    expect(paragraphs).toContain(STATEMENT_WORDS.automation);
    expect(composer(view, finalRetire(view))).toContain(esc(STATEMENT_WORDS.retire("ada_l", PREVIEW_PLACEHOLDER, "at_once")));
  });

  test("the words are the design's", () => {
    expect(STANDING_WORDS.retire).toEqual({
      what: "Retiring a handle takes it from everyone for good, its holder included. Use it when the breach lies in the handle itself: impersonation, a doxxed name, a threat. The profile then shows a placeholder (retired_ and 12 characters), and its holder may choose a new handle at once, or, if the account is suspended, when that suspension ends.",
      first: "The retirement is this decision's first measure. A reset of the display name added to it copies the placeholder, never the retired handle.",
      moved: "The account changed its handle after this snapshot. Confirming retires the handle shown in the snapshot and leaves the new one alone. To judge the new handle, take a fresh snapshot.",
      none: "Not open: this profile holds a placeholder, so there is no handle to retire.",
    });
    expect(STANDING_WORDS.reviewHandle).toBe("Giving the handle back clears its retirement. A profile that still holds the placeholder gets the handle again; one that chose another handle since may change back at once.");
  });
});

describe("giving the handle back in a correction or a review (8.7)", () => {
  test("a correction offers Give the handle back with [review.handle]; lifting it reverses the decision, and the preview names the handle", () => {
    const view = retiredCase();
    const decided = view.decisions[0]!;
    const draft = correctionDraft(caseId(view.id), view, decided, MODERATOR);
    expect(correctionChoices(view, draft, MODERATOR).map((choice) => choice.reversal)).toEqual([{ kind: "unretire_handle", mediaId: null }]);
    const out = composer(view, draft);
    expect(out).toContain(MEASURES.unretire_handle.label);
    expect(out).toContain(esc(STANDING_WORDS.reviewHandle));
    const chosen = { ...draft, actions: [{ kind: "unretire_handle" as const, mediaId: null }] };
    expect(decisionParamsOf(view, chosen, { ...DIGESTS, facts: null })).toMatchObject({ kind: "correction", outcome: "reversed", actions: [{ kind: "unretire_handle", mediaId: null }] });
    const preview = previewOf(view, chosen, NOW);
    expect(preview.reversals).toEqual([{ kind: "unretire_handle", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null, handle: "ada_l" }]);
    expect(statementParagraphs(preview)).toContain(STATEMENT_WORDS.unretired("ada_l"));
  });

  test("a review offers it too: Reverse gives the handle back, Keep lifts nothing; a retirement already reversed is not offered", () => {
    const view = retiredCase();
    const decided = view.decisions[0]!;
    const draft = reviewDraft(caseId(view.id), view, decided, MODERATOR);
    expect(reviewChoices(view, draft, MODERATOR).map((choice) => choice.reversal.kind)).toEqual(["unretire_handle"]);
    expect(composer(view, draft)).toContain(esc(STANDING_WORDS.reviewHandle));
    expect(reviewParamsOf(view, { ...draft, review: "reversed", actions: [{ kind: "unretire_handle", mediaId: null }] }, { snapshot: HEX, reason: HEX }).actions).toEqual([{ kind: "unretire_handle", mediaId: null }]);
    expect(reviewParamsOf(view, { ...draft, review: "kept", actions: [] }, { snapshot: HEX, reason: HEX }).actions).toEqual([]);
    const lifted = retiredCase(retired(false));
    expect(reviewChoices(lifted, reviewDraft(caseId(lifted.id), lifted, lifted.decisions[0]!, MODERATOR), MODERATOR)).toEqual([]);
  });

  test("the case page names the handle a retirement retired beside its row", () => {
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
    const out = html(<CaseScreenView {...base} caseId={caseId(retiredCase().id)} view={retiredCase()} />);
    expect(out).toContain(`${MEASURES.retire_handle.label}: in force; the handle @ada_l`);
    // An account case without the measure says nothing of one.
    expect(html(<CaseScreenView {...base} caseId={caseId(accountCase().id)} view={accountCase()} />)).not.toContain("the handle @");
  });
});
