import { AUTOMATION_RULES, MEASURES, type CaseView, type RestoreGap, type RestoreView, type StaffMe } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDraft, previewOf, programFinding, programStatementOf } from "../src/compose";
import { AUTOMATION_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { CustodyLines, OverviewView } from "../src/screens/Home";
import { marksOf } from "../src/screens/Queue";
import { RestoreScreen, type RestoreScreenProps } from "../src/screens/Restore";
import { bothTimes } from "../src/ui";
import { CASE_POST, IMAGE_ONE, NO_STANDING, SOURCES, decision, item, overview, postCase, queueRow } from "./case-fixtures";
import { HOSTILE } from "./fixtures";

/**
 * A program's finding and measure on the console (3d design, sections 8.2 to 8.4 and 8.7; Task 6), server-rendered: the
 * queue's three chips; Home's [home.automated] and [home.objected] with a link to each case, and a program's row on Home's
 * lists; on a case [case.r1] beside the item a score opened and never a score, a decision without a decider with the chip
 * in the place of a handle, [case.auto] with the statement its author was sent and [case.autoR1] while its withhold is in
 * force, the author's request for a person above the evidence, in a frame as the author's text; the composer's
 * [case.autoRecord] and a preview whose found paragraph says whether this person opened the image; and [restore.program].
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const noop = () => undefined;
const hrefs = (out: string) => [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const AT = "2026-10-19T09:15:00.000Z";
const ASKED = "2026-10-19T10:00:00.000Z";
const NOW = new Date("2026-10-19T11:00:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const ITEM_PROGRAM = "4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b";
const DECISION_PROGRAM = "5f6a7b8c-9d0e-4f1a-8b2c-4d5e6f7a8b9c";
const ACTION_PROGRAM = "6a7b8c9d-0e1f-4a2b-9c3d-5e6f7a8b9c0d";
/** An objection with what a hostile author could write: a bidirectional override, a script and a link. */
const HOSTILE_OBJECTION = `${HOSTILE.bidi} <script>alert(1)</script> javascript:alert(1)`;

/** A post's case a program's score opened: its finding on the first image, its withhold of that image, and the author's request. */
function programCase(more: Partial<CaseView> = {}, inForce = true): CaseView {
  return postCase({
    items: [item({ id: ITEM_PROGRAM, source: SOURCES.program, explanation: null, mediaId: IMAGE_ONE, ruleId: "R1" })],
    intakeSeq: 1,
    decisions: [
      decision({
        id: DECISION_PROGRAM,
        byProgram: true,
        staffHandle: null,
        source: "own_initiative",
        rulesVersion: 3,
        redressVersion: 4,
        decidedAt: AT,
        facts: null,
        reason: null,
        actions: [{ id: ACTION_PROGRAM, kind: "withhold_media", mediaId: IMAGE_ONE, noEffect: null, inForce, reversesActionId: null, liftedBy: null, sealed: null, ...NO_STANDING }],
      }),
    ],
    signals: [{ itemId: ITEM_PROGRAM, kind: "r1_score", thresholdVersion: 0 }],
    objection: inForce ? { text: HOSTILE_OBJECTION, createdAt: ASKED } : null,
    ...more,
  });
}

const caseProps: Omit<CaseScreenViewProps, "caseId" | "view"> = {
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
const page = (view: CaseView) => html(<CaseScreenView {...caseProps} caseId={parseCaseId(view.id)!} view={view} />);

describe("the queue's chips (8.3)", () => {
  test("found, taken and the author's request, in that order after 3c's marks; none on a case a program never touched", () => {
    expect(marksOf(queueRow())).toEqual(["notice under Art. 16"]);
    expect(marksOf(queueRow({ foundByProgram: true, takenByProgram: true, objected: true }))).toEqual([
      "notice under Art. 16",
      AUTOMATION_WORDS.queue.found,
      AUTOMATION_WORDS.queue.taken,
      AUTOMATION_WORDS.queue.objected,
    ]);
    expect(AUTOMATION_WORDS.queue).toEqual({ found: "Found by a program", taken: "Taken by a program", objected: "The author asked for a person" });
  });
});

describe("Home (8.2)", () => {
  test("[home.automated] and [home.objected] with a link to each case, the target from the contracts; nothing while neither applies", () => {
    const automated = { waiting: 2, oldestAt: AT, objected: 1, oldestObjectionAt: ASKED, cases: [CASE_POST], objectedCases: [CASE_POST] };
    const out = html(<CustodyLines overview={overview({ automated })} now={NOW.getTime()} onOpenCase={noop} />);
    const shown = text(out);
    expect(shown).toContain(AUTOMATION_WORDS.homeAutomated(2, bothTimes(AT)));
    expect(shown).toContain(AUTOMATION_WORDS.homeObjected(1, bothTimes(ASKED)));
    expect(AUTOMATION_WORDS.homeObjected(1, "x")).toContain(`1 case, the oldest request of x. korbat's published target is an answer within ${AUTOMATION_RULES.objectionTargetHours} hours.`);
    expect(AUTOMATION_WORDS.homeObjected(3, "x")).toContain("3 cases");
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`, `/cases/${CASE_POST}`]);
    expect(html(<CustodyLines overview={overview()} now={NOW.getTime()} onOpenCase={noop} />)).toBe("");
  });

  test("a seal taken by a program on Home's list carries the chip in the place of a handle", () => {
    const home = text(html(<OverviewView overview={overview({ interimSeals: { total: 1, items: [{ at: AT, handle: null, caseId: CASE_POST, posts: 1, images: 2 }] } })} now={NOW.getTime()} onOpenCase={noop} />));
    expect(home).toContain(AUTOMATION_WORDS.byProgram);
  });
});

describe("a case a program found and took (8.4)", () => {
  test("[case.r1] by the item, the chip in the place of a handle, [case.auto] with the statement sent, [case.autoR1], and no score anywhere", () => {
    const view = programCase();
    const shown = text(page(view));
    expect(shown).toContain("Source: Found by a program");
    expect(shown).toContain(AUTOMATION_WORDS.caseR1(0));
    expect(AUTOMATION_WORDS.caseR1(0)).toContain("over the threshold (version 0)");
    expect(shown).toContain(AUTOMATION_WORDS.byProgram);
    expect(shown).toContain(AUTOMATION_WORDS.caseAuto(bothTimes(AT), MEASURES.withhold_media.label));
    // The statement its author was sent: the program's sentences, the rule, and "Ask for a person" in the appeal's place.
    for (const sentence of [STATEMENT_WORDS.automated.until.r1, STATEMENT_WORDS.automated.fully.r1, REDRESS_TEXTS[4].askPerson!]) expect(shown).toContain(sentence);
    expect(statementParagraphs(programStatementOf(view, view.decisions[0]!))).toContain(STATEMENT_WORDS.automated.fully.r1);
    expect(shown).toContain(AUTOMATION_WORDS.caseAutoR1);
    // No number beside the image reads as a verdict: no score, no rating's value.
    expect(shown).not.toMatch(/score|0[.][0-9]/i);
    // Its source has no reveal and no mark.
    expect(shown).not.toContain("Reveal who sent this");
  });

  test("[case.objection] above the evidence, the author's text in its frame as text; gone, with [case.autoR1], once the measure is lifted", () => {
    const out = page(programCase());
    const shown = text(out);
    expect(shown).toContain(AUTOMATION_WORDS.objection.lead(bothTimes(ASKED)));
    expect(shown).toContain(AUTOMATION_WORDS.objection.tail);
    expect(AUTOMATION_WORDS.objection.tail).toContain(`within ${AUTOMATION_RULES.objectionTargetHours} hours`);
    expect(shown.indexOf(AUTOMATION_WORDS.objection.lead(bothTimes(ASKED)))).toBeLessThan(shown.indexOf("Evidence"));
    expect(shown).toContain(AUTOMATION_WORDS.objection.by);
    // The text is escaped: no script element and no link is made of it.
    expect(out).not.toContain("<script>");
    expect(hrefs(out).some((href) => href!.startsWith("javascript:"))).toBe(false);
    const lifted = text(page(programCase({}, false)));
    expect(lifted).not.toContain(AUTOMATION_WORDS.objection.lead(bothTimes(ASKED)));
    expect(lifted).not.toContain(AUTOMATION_WORDS.caseAutoR1);
    expect(lifted).toContain(AUTOMATION_WORDS.caseAuto(bothTimes(AT), MEASURES.withhold_media.label));
  });

  test("the history names a program's finding as such", () => {
    const view = programCase({
      history: [{ at: AT, event: "item", refId: ITEM_PROGRAM, seq: 1, intakeKind: "automated", ruleId: "R1", allegesIllegal: false, csam: false, reexamination: false, decisionKind: null, outcome: null, staffHandle: null, result: null }],
    });
    expect(text(page(view))).toContain(`Item 1 arrived: ${AUTOMATION_WORDS.historyItem}, R1`);
  });
});

describe("the composer on such a case (8.4)", () => {
  const composer = (view: CaseView, extra: Partial<ComposerViewProps> = {}) => {
    const draft = newDraft(parseCaseId(view.id)!, view, MODERATOR);
    const props: ComposerViewProps = { view, role: MODERATOR, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop, ...extra };
    return text(html(<ComposerView {...props} />));
  };

  test("[case.autoRecord] while an unanswered item is a program's finding, and not on a case without one", () => {
    expect(programFinding(programCase())).toEqual({ signal: { itemId: ITEM_PROGRAM, kind: "r1_score", thresholdVersion: 0 }, mediaId: IMAGE_ONE });
    expect(composer(programCase())).toContain(AUTOMATION_WORDS.caseAutoRecord);
    expect(programFinding(postCase())).toBeNull();
    expect(composer(postCase())).not.toContain(AUTOMATION_WORDS.caseAutoRecord);
  });

  test("the preview's found paragraph says whether this person opened the image on this case, as the statement will", () => {
    const view = programCase();
    const draft = { ...newDraft(parseCaseId(view.id)!, view, MODERATOR), kind: "final" as const, outcome: "restricted" as const, ground: "incompatible" as const, ruleId: "R1" as const, actions: [{ kind: "remove_media" as const, mediaId: IMAGE_ONE }] };
    const unseen = previewOf(view, draft, NOW);
    expect(unseen).toMatchObject({ automatedDetection: true, automatedDecision: "not_automated", signal: { kind: "r1_score", viewed: false } });
    // A final removal under R1 gives a strike: the found paragraph then carries the strike's rule sentence after it.
    expect(statementParagraphs(unseen).join(" ")).toContain(`${STATEMENT_WORDS.automated.found.r1.unviewed} ${STATEMENT_WORDS.automated.strikeRule}`);
    const seen = previewOf(view, draft, NOW, [IMAGE_ONE]);
    expect(statementParagraphs(seen).join(" ")).toContain(STATEMENT_WORDS.automated.found.r1.viewed);
    // A case no program touched: the preview carries no automation member, and 3c's sentence stands.
    const plain = postCase();
    const none = previewOf(plain, { ...newDraft(parseCaseId(plain.id)!, plain, MODERATOR), kind: "interim", actions: [{ kind: "withhold", mediaId: null }] }, NOW);
    expect(none.automatedDetection).toBeUndefined();
  });
});

describe("After a restore (8.7)", () => {
  test("[restore.program] beside a lost measure a program took, and beside no other", () => {
    const gap = (action: string): RestoreGap => ({
      id: action === "automated_decided" ? "7b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e" : "8c9d0e1f-2a3b-4c4d-9e5f-7a8b9c0d1e2f",
      class: "restriction",
      actedAt: AT,
      action,
      caseId: CASE_POST,
      orderId: null,
      itemId: null,
      kinds: action === "automated_decided" ? ["withhold_media"] : ["remove"],
      closedAt: null,
      disposition: null,
      closedByDecisionId: null,
    });
    const view: RestoreView = { importedAt: AT, mayOpen: false, retentionMay: false, gaps: [gap("automated_decided"), gap("case_decided")], holds: [] };
    const props: RestoreScreenProps = { view, role: "moderator", busy: null, notice: null, error: null, onOpenCase: noop, onOpenOrder: noop, onNotNeeded: noop };
    const shown = text(html(<RestoreScreen {...props} />));
    expect(shown.split(AUTOMATION_WORDS.restoreProgram).length - 1).toBe(1);
    expect(AUTOMATION_WORDS.restoreProgram).toBe("A program took this measure, not a person. Take it again as your own decision while you decide; the author is sent your decision's statement.");
  });
});
