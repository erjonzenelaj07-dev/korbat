import { CaseDecidedParams, MEASURES, RULE_DEFAULT_CATEGORY, SEAL_DRAFTS, textDigest, type CaseDecision, type CaseView, type StaffMe, type StaffTextDraft } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ApiError, createStaffApi } from "../src/api";
import {
  COMPOSER,
  afterRefusal,
  complete,
  confirmDecision,
  confirmWhileBusy,
  correctionDraft,
  decidedNotice,
  decisionParamsOf,
  newDraft,
  noEffectOf,
  offeredDraft,
  openCorrection,
  outcomesListed,
  previewOf,
  previewable,
  saveDraftText,
  textsOffered,
  textsRequired,
  withSavedTexts,
  withSeal,
  type CaseDraft,
} from "../src/compose";
import { COMPOSER_WORDS, MODERATION_MESSAGES, messageFor } from "../src/messages";
import { parseCaseId } from "../src/router";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { accountCase, CASE_FROZEN, CASE_POST, decision, frozenCase, IMAGE_ONE, IMAGE_TWO, item, ITEM_FINDING, ITEM_NOTIFIER, ITEM_SUSPECT, postCase, postSnapshot, SOURCES } from "./case-fixtures";
import { envelope, fakeCredentials, fakeFetch, makeMe, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The composer's draft against the case as it stands (3c design, sections 7.4, 7.5 and 8): which outcomes are listed and
 * what is asked first, what a decision without a measure carries and says, what a kept draft is brought back to after
 * the case was read again, when a text is saved, and what the page does after a confirmation. The pure parts are tested
 * as functions, the screen server-rendered.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** A text as React writes it into HTML. */
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-04T09:30:00.000Z");
const MODERATOR: StaffMe["role"] = "moderator";
const ADMIN: StaffMe["role"] = "admin";
const HEX = "cd".repeat(32);
const CONFIRM_OFF = /<button[^>]*disabled=""[^>]*>Confirm with your staff key<\/button>/;
const count = (out: string, sentence: string) => out.split(esc(sentence)).length - 1;

/** The composer for a case as the page opens it, with the draft changed as a test says. */
function composer(view: CaseView, role: StaffMe["role"], change: Partial<CaseDraft> = {}, extra: Partial<ComposerViewProps> = {}) {
  const draft = { ...newDraft(caseId(view.id), view, role), ...change };
  const props: ComposerViewProps = {
    view,
    role,
    draft,
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
    ...extra,
  };
  return html(<ComposerView {...props} />);
}

/** A suspect case about a post: a rule report, then the suspect item, then a second rule report. */
function rangeCase(more: Partial<CaseView> = {}): CaseView {
  return frozenCase({
    intakeSeq: 3,
    answeredSeq: 0,
    decisions: [],
    sealsDeclined: [],
    suspicion: { open: true, reach: { posts: 1, images: 2, sealed: 0, served: 2, newestPostOn: "2026-09-30" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } },
    items: [
      item({ id: ITEM_NOTIFIER, seq: 1, ruleId: "R1", lane: 2, source: SOURCES.reporter }),
      item({ id: ITEM_SUSPECT, seq: 2, csam: true, suspect: true, allegesIllegal: true, ruleId: null, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, explanation: null, source: SOURCES.anonymous }),
      item({ id: ITEM_FINDING, seq: 3, ruleId: "R6", lane: 2, explanation: null, source: SOURCES.reporter }),
    ],
    ...more,
  });
}
const draftOf = (view: CaseView, role: StaffMe["role"], change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, role), ...change });
const written = (texts: Partial<CaseDraft["written"]>): CaseDraft["written"] => ({ facts: "", reason: "", legal_reference: "", review_reason: "", ...texts });
/** A draft as the server keeps it: the text with the salt and the digest the console computed when it saved it. */
async function savedDraft(kind: StaffTextDraft["kind"], text: string, more: Partial<StaffTextDraft> = {}): Promise<StaffTextDraft> {
  const salt = "5a".repeat(32);
  return { id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", kind, text, salt, digest: await textDigest(salt, text), createdAt: "2026-10-04T09:00:00.000Z", ...more };
}

describe("the outcome comes first", () => {
  test("it lists from the start every outcome that some kind this person may decide allows, with its label", () => {
    const view = postCase();
    expect(outcomesListed(view, MODERATOR)).toEqual(["restricted", "no_violation", "not_evident"]);
    // The page opens on a restriction taken while deciding, and still lists the two outcomes of a final decision.
    const out = composer(view, MODERATOR);
    for (const label of ["Restrict", "No breach", "Illegality not evident"]) expect(out, label).toContain(`<span>${label}</span>`);
    // Outcome is the first group of the composer; the kind comes after it.
    expect(out.indexOf("<fieldset>")).toBe(out.indexOf("<fieldset><legend>Outcome</legend>"));
    expect(out.indexOf("<legend>Outcome</legend>")).toBeLessThan(out.indexOf("<legend>When</legend>"));
    // No item alleges illegality: "Illegality not evident" is not among them.
    const ruleOnly = postCase({ items: [item()], intakeSeq: 1 });
    expect(outcomesListed(ruleOnly, MODERATOR)).toEqual(["restricted", "no_violation"]);
    expect(composer(ruleOnly, MODERATOR)).not.toContain("Illegality not evident");
  });

  test("someone who is not an admin, on a case whose final decision is an admin's, sees Restrict alone under the sentence that says so", () => {
    const view = rangeCase();
    expect(outcomesListed(view, MODERATOR)).toEqual(["restricted"]);
    expect(outcomesListed(view, ADMIN)).toEqual(["restricted", "no_violation", "not_evident"]);
    const out = composer(view, MODERATOR);
    expect(out).toContain("<span>Restrict</span>");
    expect(out).not.toContain("<span>No breach</span>");
    expect(out).not.toContain("<span>Illegality not evident</span>");
    const [legend, sentence, restrict] = [out.indexOf("<legend>Outcome</legend>"), out.indexOf(esc(COMPOSER.adminFinal)), out.indexOf("<span>Restrict</span>")];
    expect(legend).toBeGreaterThan(-1);
    expect(sentence).toBeGreaterThan(legend);
    expect(restrict).toBeGreaterThan(sentence);
    // The one kind such a person may take is still named.
    expect(out).toContain("<span>While deciding</span>");
    expect(out).not.toContain("<span>Decide the case</span>");
  });

  test("choosing No breach or Illegality not evident makes the decision final; the kind is asked only for a restriction", () => {
    const view = postCase();
    for (const outcome of ["no_violation", "not_evident"] as const) {
      // Whatever kind the draft held, such an outcome is a final decision's.
      expect(offeredDraft(view, MODERATOR, draftOf(view, MODERATOR, { kind: "interim", outcome })), outcome).toMatchObject({ kind: "final", outcome });
      const out = composer(view, MODERATOR, { kind: "interim", outcome });
      expect(out, outcome).not.toContain("<legend>When</legend>");
      expect(decisionParamsOf(view, offeredDraft(view, MODERATOR, draftOf(view, MODERATOR, { kind: "interim", outcome })), { snapshot: HEX, facts: null, reason: null, legalReference: null })).toMatchObject({ kind: "final", throughSeq: 2, outcome });
    }
    // A restriction asks which of the two it is.
    const restricting = composer(view, MODERATOR);
    expect(restricting).toContain("<legend>When</legend>");
    for (const label of ["While deciding", "Decide the case"]) expect(restricting).toContain(`<span>${label}</span>`);
    // Where a final decision is not this person's to take, an outcome without a measure is not theirs either.
    expect(offeredDraft(rangeCase(), MODERATOR, draftOf(rangeCase(), MODERATOR, { kind: "final", outcome: "no_violation" }))).toMatchObject({ kind: "interim", outcome: "restricted" });
  });

  test("on a post case whose images cannot be opened the unseen sentence stands beside the two outcomes whenever they are listed, whatever is selected", () => {
    const UNSEEN = "This post's images cannot be opened now. A report about an image that you answer now is answered unseen: its sender is told so and may ask again.";
    expect(COMPOSER.unseen).toBe(UNSEEN);
    // A post frozen through its author's account's case: a moderator decides its own reports, unseen.
    const frozen = postCase({ imagesAllowed: false });
    for (const role of [MODERATOR, ADMIN]) {
      for (const change of [{}, { kind: "final" as const }, { kind: "final" as const, outcome: "no_violation" as const }, { kind: "final" as const, outcome: "not_evident" as const }]) {
        expect(count(composer(frozen, role, change), UNSEEN), `${role} ${JSON.stringify(change)}`).toBe(1);
      }
    }
    // It stands with the outcomes, before the kind is asked.
    const out = composer(frozen, MODERATOR);
    expect(out.indexOf(esc(UNSEEN))).toBeGreaterThan(out.indexOf("<span>No breach</span>"));
    expect(out.indexOf(esc(UNSEEN))).toBeLessThan(out.indexOf("<legend>When</legend>"));
    // Where the two outcomes are not listed there is nothing for it to stand beside.
    expect(count(composer(rangeCase(), MODERATOR), UNSEEN)).toBe(0);
    expect(count(composer(rangeCase(), ADMIN), UNSEEN)).toBe(1);
    // A post whose images can be opened, and an account case, which shows no image and whose reports concern what staff read.
    expect(count(composer(postCase(), MODERATOR, { kind: "final", outcome: "no_violation" }), UNSEEN)).toBe(0);
    expect(count(composer(accountCase({ suspicion: null, lane: 2, items: [item({ link: "http://localhost:8081/u/named_once" })] }), MODERATOR, { kind: "final", outcome: "no_violation" }), UNSEEN)).toBe(0);
  });
});

describe("a decision without a measure", () => {
  const STAYS =
    'Write only about the author\'s content and conduct. Never copy another person\'s name, handle, address or other personal data here: describe it (for example "the home address of another person"). The author never receives this text: a decision without a measure tells them at most that what korbat did while deciding has ended. It stays in the case\'s record, for staff.';
  const TO_AUTHOR =
    'Write only about the author\'s content and conduct. Never copy another person\'s name, handle, address or other personal data here: describe it (for example "the home address of another person"). The author receives this text by email and keeps it while their account exists.';

  test("the category is on the page for every decision that is not a correction: what the key confirms is shown", () => {
    const view = postCase();
    const CATEGORY = /<label for="compose-category">Category<\/label>/;
    for (const change of [{}, { kind: "final" as const }, { kind: "final" as const, outcome: "no_violation" as const }, { kind: "final" as const, outcome: "not_evident" as const }]) {
      expect(composer(view, MODERATOR, change), JSON.stringify(change)).toMatch(CATEGORY);
    }
    // The category a no-action decision's params carry is the one the page shows selected.
    const out = composer(view, MODERATOR, { kind: "final", outcome: "no_violation", category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" });
    expect(out).toMatch(/<option value="STATEMENT_CATEGORY_SCAMS_AND_FRAUD" selected="">/);
    expect(decisionParamsOf(view, draftOf(view, MODERATOR, { kind: "final", outcome: "no_violation", category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" }), { snapshot: HEX, facts: null, reason: null, legalReference: null }).category).toBe("STATEMENT_CATEGORY_SCAMS_AND_FRAUD");
    // A correction carries the corrected decision's category, and offers none.
    expect(composer(view, MODERATOR, correctionDraft(caseId(view.id), view, view.decisions[0]!, MODERATOR))).not.toMatch(CATEGORY);
  });

  test("offers its facts and its reason, both optional, and says under each that its author never receives the text", () => {
    const view = postCase();
    const draft = draftOf(view, MODERATOR, { kind: "final", outcome: "no_violation" });
    expect(textsOffered(draft)).toEqual(["facts", "reason"]);
    expect(textsRequired(view, draft)).toEqual([]);
    expect(complete(view, draft)).toBe(true);
    const out = composer(view, MODERATOR, draft);
    expect(out).toMatch(/<label for="compose-facts">Facts<\/label>/);
    expect(out).toMatch(/<label for="compose-reason">Reason<\/label>/);
    expect(out).not.toMatch(CONFIRM_OFF);
    // The personal-data rule, and in place of "The author receives this text by email..." that the author never does:
    // true of this case, whose withhold taken while deciding ends with the decision and is told to its author, and of
    // a case on which nothing was done, whose decision is told to nobody.
    expect(`${COMPOSER_WORDS.personalDataRule} ${COMPOSER_WORDS.staysInRecord}`).toBe(STAYS);
    expect(count(out, STAYS)).toBe(2);
    expect(out).not.toContain(esc(COMPOSER_WORDS.toAuthor));
    const quiet = composer(postCase({ decisions: [] }), MODERATOR, { kind: "final", outcome: "not_evident" });
    expect(count(quiet, STAYS)).toBe(2);
    expect(quiet).not.toContain(esc(COMPOSER_WORDS.toAuthor));
    // A restriction's two fields say that the author receives the text.
    expect(COMPOSER.personalData).toBe(TO_AUTHOR);
    const restricting = composer(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] });
    expect(count(restricting, TO_AUTHOR)).toBe(2);
    expect(count(restricting, COMPOSER_WORDS.staysInRecord)).toBe(0);
    // A correction's one field too.
    expect(count(composer(view, MODERATOR, correctionDraft(caseId(view.id), view, view.decisions[0]!, MODERATOR)), TO_AUTHOR)).toBe(1);
  });

  test("carries no ground, and the digests of its facts and its reason when they are written", () => {
    const view = postCase();
    const draft = draftOf(view, MODERATOR, { kind: "final", outcome: "no_violation" });
    const bare = decisionParamsOf(view, draft, { snapshot: HEX, facts: null, reason: null, legalReference: null });
    expect(bare).toMatchObject({ kind: "final", outcome: "no_violation", ground: null, ruleId: null, factsDigest: null, reasonDigest: null, legalReferenceDigest: null, actions: [] });
    const told = decisionParamsOf(view, draft, { snapshot: HEX, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null });
    expect(told).toMatchObject({ ground: null, ruleId: null, factsDigest: "aa".repeat(32), reasonDigest: "bb".repeat(32), legalReferenceDigest: null });
    for (const params of [bare, told]) expect(CaseDecidedParams.safeParse(params).success).toBe(true);
    // The facts alone, as an admin's answer without a seal may carry them.
    expect(decisionParamsOf(view, { ...draft, outcome: "not_evident" }, { snapshot: HEX, facts: "aa".repeat(32), reason: null, legalReference: null })).toMatchObject({ outcome: "not_evident", factsDigest: "aa".repeat(32), reasonDigest: null });
  });

  test("an admin's answer without a measure on a case that holds an unanswered suspect item needs its facts: Confirm is off until they are written, and the reason stays optional", () => {
    const view = rangeCase();
    for (const outcome of ["no_violation", "not_evident"] as const) {
      const draft = draftOf(view, ADMIN, { kind: "final", outcome });
      expect(textsRequired(view, draft)).toEqual(["facts"]);
      expect(complete(view, draft)).toBe(false);
      expect(composer(view, ADMIN, draft)).toMatch(CONFIRM_OFF);
      expect(complete(view, { ...draft, written: written({ facts: "   " }) })).toBe(false);
      expect(complete(view, { ...draft, written: written({ reason: "The report gives no reason to believe it." }) })).toBe(false);
      const said = { ...draft, written: written({ facts: "The report's words and the post's text give no concrete reason to believe the report." }) };
      expect(complete(view, said)).toBe(true);
      expect(composer(view, ADMIN, said)).not.toMatch(CONFIRM_OFF);
    }
  });

  test("its texts never reach its author: the preview's input holds neither, whether a statement is sent or none", () => {
    const texts = written({ facts: "A note for staff.", reason: "Another note for staff." });
    // Nothing was done while deciding: the decision sends its author nothing, and the preview says so in place of a statement.
    const quiet = postCase({ decisions: [] });
    expect(previewOf(quiet, draftOf(quiet, MODERATOR, { kind: "final", outcome: "no_violation", written: texts }), NOW)).toMatchObject({ outcome: "no_violation", facts: null, reason: null, measures: [], endedMeasures: [] });
    const out = composer(quiet, MODERATOR, { kind: "final", outcome: "no_violation", written: texts });
    expect(out).toContain(esc(COMPOSER_WORDS.noStatement));
    expect(out).not.toContain("Preview: the statement as its author will receive it");
    // A withhold taken while deciding ends with the decision: its author is told that, and nothing of the two texts.
    const view = postCase();
    for (const outcome of ["no_violation", "not_evident"] as const) {
      const draft = draftOf(view, MODERATOR, { kind: "final", outcome, written: texts });
      const input = previewOf(view, draft, NOW);
      expect(input, outcome).toMatchObject({ kind: "final", outcome, facts: null, reason: null, measures: [], endedMeasures: [{ kind: "withhold" }] });
      const paragraphs = statementParagraphs(input);
      expect(paragraphs[0]).toBe(STATEMENT_WORDS.ended(MEASURES.withhold.label));
      expect(paragraphs.join(" ")).not.toContain("note for staff");
      expect(paragraphs.some((paragraph) => paragraph.startsWith("The facts:") || paragraph.startsWith("korbat's reasons:"))).toBe(false);
      const shown = composer(view, MODERATOR, draft);
      expect(shown).toContain("Preview: the statement as its author will receive it");
      expect(shown).not.toContain(esc(COMPOSER_WORDS.noStatement));
      // The preview's own paragraphs hold neither text; the two fields above it do.
      expect(shown.slice(0, shown.indexOf("Preview: the statement"))).toContain("A note for staff.");
      expect(shown.slice(shown.indexOf("Preview: the statement"))).not.toContain("note for staff");
    }
    // A decision that restricts tells both, as before.
    const restricting = previewOf(view, draftOf(view, MODERATOR, { kind: "final", actions: [{ kind: "remove", mediaId: null }], written: texts }), NOW);
    expect(restricting).toMatchObject({ outcome: "restricted", facts: "A note for staff.", reason: "Another note for staff." });
    expect(statementParagraphs(restricting)).toEqual(expect.arrayContaining(["The facts: A note for staff.", "korbat's reasons: Another note for staff."]));
    // A final decision that only lifts a withhold taken while deciding restricts nothing either: neither text is told.
    const open = rangeCase({ decisions: postCase().decisions });
    const lifting = previewOf(open, draftOf(open, ADMIN, { kind: "final", outcome: "no_violation", actions: [{ kind: "restore", mediaId: null }], written: texts }), NOW);
    expect(lifting).toMatchObject({ facts: null, reason: null, measures: [], reversals: [{ kind: "restore" }] });
  });
});

describe("on a case that holds an unanswered suspect item", () => {
  const NEVER = "Never write that the images are child sexual abuse material: nobody at korbat has seen them.";

  test("the sentence against naming the images stands under the facts and under the reason, whatever the measure or the outcome", () => {
    expect(COMPOSER.neverWrite).toBe(NEVER);
    const view = rangeCase();
    // A withhold of the post's text, the seal, and an admin's answer without a measure.
    expect(count(composer(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] }), NEVER)).toBe(2);
    expect(count(composer(view, MODERATOR), NEVER)).toBe(2);
    expect(count(composer(view, MODERATOR, withSeal(view, draftOf(view, MODERATOR))), NEVER)).toBe(2);
    expect(count(composer(view, ADMIN, { kind: "final", outcome: "no_violation" }), NEVER)).toBe(2);
    expect(count(composer(view, ADMIN, { kind: "final", outcome: "not_evident" }), NEVER)).toBe(2);
    // It comes before the personal-data rule under each field.
    const out = composer(view, ADMIN, { kind: "final", outcome: "no_violation" });
    expect(out.indexOf(esc(NEVER))).toBeLessThan(out.indexOf(esc(COMPOSER_WORDS.personalDataRule)));
    // A case without such an item never shows it.
    expect(count(composer(postCase(), MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] }), NEVER)).toBe(0);
    expect(count(composer(postCase(), MODERATOR, { kind: "final", outcome: "no_violation" }), NEVER)).toBe(0);
  });

  test("Do not seal now is offered only while deciding, beside the seal taken while deciding: an admin deciding the case seals for good or answers without a seal", () => {
    const view = rangeCase();
    const [seal, decline] = [`>${MEASURES.seal_media.label}</button>`, ">Do not seal now</button>"];
    for (const role of [MODERATOR, ADMIN]) {
      const deciding = composer(view, role, { kind: "interim" });
      expect(deciding, role).toContain(seal);
      expect(deciding, role).toContain(decline);
    }
    for (const change of [{ kind: "final" as const }, { kind: "final" as const, outcome: "no_violation" as const }]) {
      const final = composer(view, ADMIN, change);
      expect(final).toContain(seal);
      expect(final).not.toContain(decline);
    }
    // A choice that was being recorded is not left open under "Decide the case".
    expect(composer(view, ADMIN, { kind: "final" }, { declining: { reason: "x", busy: false, error: null } })).not.toContain("Record this choice");
  });
});

describe("a kept draft is brought back to what the case now offers", () => {
  test("a seal under rule R2, once the case's suspect items were answered: the rule the composer would open with, its category, and no seal", () => {
    const before = rangeCase();
    const kept = withSeal(before, draftOf(before, MODERATOR));
    expect(kept).toMatchObject({ ruleId: "R2", actions: [{ kind: "seal_media", mediaId: null }] });
    expect(offeredDraft(before, MODERATOR, kept)).toBe(kept);
    // An admin answered the report meanwhile; the two rule reports are still open.
    const after = rangeCase({ answeredSeq: 2, items: before.items.map((each) => (each.seq <= 2 ? { ...each, outcome: "no_violation", answeredBy: "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe" } : each)) });
    const now = offeredDraft(after, MODERATOR, kept);
    expect(now).toMatchObject({ kind: "interim", outcome: "restricted", ruleId: "R6", category: RULE_DEFAULT_CATEGORY.R6, actions: [] });
    expect(now.ruleId).toBe(newDraft(caseId(after.id), after, MODERATOR).ruleId);
    // What its person wrote is kept.
    expect(now.written.facts).toBe(SEAL_DRAFTS.facts.notice_post);
    // The controls show what would be sent: rule R6 selected, R2 not offered, no seal chosen, and nothing to confirm yet.
    const out = composer(after, MODERATOR, kept);
    expect(out).toMatch(/<option value="R6" selected="">/);
    expect(out).not.toContain('<option value="R2"');
    expect(out).not.toContain(`${MEASURES.seal_media.label}: chosen`);
    expect(out).toMatch(CONFIRM_OFF);
    expect(complete(after, now)).toBe(false);
  });

  test("a Remove kept under Decide the case, once the final decision became an admin's: While deciding, without it", () => {
    const before = postCase();
    const kept = draftOf(before, MODERATOR, { kind: "final", actions: [{ kind: "remove", mediaId: null }] });
    expect(offeredDraft(before, MODERATOR, kept)).toBe(kept);
    // A report citing R5 arrived: the final decision is an admin's now.
    const after = postCase({ lane: 0, intakeSeq: 3, items: [...before.items, item({ id: ITEM_FINDING, seq: 3, ruleId: "R5", lane: 0 })] });
    const now = offeredDraft(after, MODERATOR, kept);
    expect(now).toMatchObject({ kind: "interim", outcome: "restricted", actions: [] });
    const out = composer(after, MODERATOR, kept);
    expect(out).not.toContain(`<span>${MEASURES.remove.label}</span>`);
    expect(out).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    // An admin's draft is left as it is.
    expect(offeredDraft(after, ADMIN, kept)).toBe(kept);
  });

  test("an image measure whose image the shown snapshot no longer lists, a measure of another kind or target, and a Lift that is no longer there are dropped; what is still offered stays", () => {
    const view = postCase();
    const both = draftOf(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }, { kind: "withhold_media", mediaId: IMAGE_ONE }] });
    expect(offeredDraft(view, MODERATOR, both)).toBe(both);
    // A fresh snapshot lists the second image alone.
    const fewer = postCase({ snapshots: [postSnapshot({ media: [{ id: IMAGE_TWO, alt: "x", width: 800, height: 600 }] })] });
    expect(offeredDraft(fewer, MODERATOR, both).actions).toEqual([{ kind: "withhold", mediaId: null }]);
    // A field reset is no measure of a post case.
    expect(offeredDraft(view, MODERATOR, draftOf(view, MODERATOR, { actions: [{ kind: "reset_bio", mediaId: null }] })).actions).toEqual([]);
    // A Lift beside a withhold taken while deciding, on a final decision that leaves the case open.
    const open = rangeCase({ decisions: [decision()] });
    const lifting = draftOf(open, ADMIN, { kind: "final", outcome: "no_violation", actions: [{ kind: "restore", mediaId: null }] });
    expect(offeredDraft(open, ADMIN, lifting)).toBe(lifting);
    // The withhold was lifted meanwhile: nothing is left to lift.
    const lifted = rangeCase({ decisions: [decision({ actions: [{ ...decision().actions[0]!, inForce: false }] })] });
    expect(offeredDraft(lifted, ADMIN, lifting).actions).toEqual([]);
    // The seal, where the case reaches no image any more.
    const sealed = withSeal(rangeCase(), draftOf(rangeCase(), MODERATOR));
    const empty = rangeCase({ suspicion: { ...rangeCase().suspicion!, reach: { posts: 0, images: 0, sealed: 0, served: 0, newestPostOn: null } } });
    expect(offeredDraft(empty, MODERATOR, sealed).actions).toEqual([]);
    // A correction's draft is left as it is.
    const correction = correctionDraft(caseId(view.id), view, view.decisions[0]!, MODERATOR);
    expect(offeredDraft(view, MODERATOR, correction)).toBe(correction);
  });
});

describe("the preview", () => {
  test("says what a seal changes: nothing on a deleted target, and nothing on a post whose images a seal of this case of at least its standing already holds", () => {
    const seal = { kind: "seal_media" as const, mediaId: null };
    expect(noEffectOf(rangeCase(), seal, "interim")).toBeNull();
    // The post was deleted by its author, the account is deleted.
    const deletedPost = rangeCase({ target: { ...rangeCase().target, state: "deleted_by_author" } as CaseView["target"] });
    expect(noEffectOf(deletedPost, seal, "interim")).toBe("deleted");
    expect(noEffectOf(deletedPost, seal, "final")).toBe("deleted");
    const account = accountCase({ suspicion: { ...rangeCase().suspicion! } });
    expect(noEffectOf(account, seal, "interim")).toBeNull();
    expect(noEffectOf(accountCase({ target: { ...accountCase().target, deleted: true } as CaseView["target"] }), seal, "interim")).toBe("deleted");
    // A seal taken while deciding is in force: another one while deciding changes nothing, a seal for good does.
    const sealAction = frozenCase().decisions[0]!.actions[0]!;
    const whileDeciding: CaseDecision = decision({ ruleId: "R2", suspect: true, actions: [sealAction] });
    const interimSealed = rangeCase({ decisions: [whileDeciding] });
    expect(noEffectOf(interimSealed, seal, "interim")).toBe("already");
    expect(noEffectOf(interimSealed, seal, "final")).toBeNull();
    // A seal for good is in force: neither kind of seal changes anything.
    const forGood = rangeCase({ decisions: [{ ...whileDeciding, kind: "final", throughSeq: 2, answersFromSeq: 1 }] });
    expect(noEffectOf(forGood, seal, "interim")).toBe("already");
    expect(noEffectOf(forGood, seal, "final")).toBe("already");
    // A seal that ended or was lifted holds nothing.
    expect(noEffectOf(rangeCase({ decisions: [decision({ ruleId: "R2", suspect: true, actions: [{ ...sealAction, inForce: false }] })] }), seal, "interim")).toBeNull();
    // On an account's case a second seal may cover images posted since: the page cannot tell, and says nothing.
    expect(noEffectOf(accountCase({ suspicion: { ...rangeCase().suspicion! }, decisions: [whileDeciding] }), seal, "interim")).toBeNull();
    // The statement the preview shows says so.
    const again = previewOf(interimSealed, withSeal(interimSealed, draftOf(interimSealed, MODERATOR)), NOW);
    expect(again.measures).toEqual([{ kind: "seal_media", mediaId: null, noEffect: "already", sealed: { posts: 1, images: 2, deletedImages: 0 } }]);
    expect(statementParagraphs(again)[0]).toContain(STATEMENT_WORDS.alreadySealed);
    expect(statementParagraphs(previewOf(deletedPost, withSeal(deletedPost, draftOf(deletedPost, MODERATOR)), NOW))[0]).toContain(STATEMENT_WORDS.deletedPost);
  });

  test("under a seal it names what only the recorded statement settles, and under every text field the personal-data rule is rendered", () => {
    const view = rangeCase();
    const out = composer(view, MODERATOR, withSeal(view, draftOf(view, MODERATOR)));
    expect(COMPOSER_WORDS.sealSettled).toBe(
      "The numbers, the sentence about posts their author had deleted, and whether the seal changes anything are settled when the seal is recorded: the statement its author gets holds them as they are then.",
    );
    expect(count(out, COMPOSER_WORDS.sealSettled)).toBe(1);
    expect(count(out, COMPOSER.personalData)).toBe(2);
    // No such hint without a seal.
    expect(count(composer(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] }), COMPOSER_WORDS.sealSettled)).toBe(0);
  });

  test("a post case without a snapshot the page can show has no preview: no creation time is made up, and the page says the preview follows the fresh snapshot", () => {
    const hidden = postCase({ snapshots: [{ id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", takenAt: "2026-10-01T08:00:00.000Z", digest: HEX, withheld: true }] });
    expect(previewable(hidden)).toBe(false);
    expect(previewable(postCase())).toBe(true);
    expect(previewable(postCase({ snapshots: [] }))).toBe(false);
    // An account's statement names no post.
    expect(previewable(accountCase({ snapshots: [] }))).toBe(true);
    const draft = draftOf(hidden, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }], written: written({ facts: "The post offers followers for money.", reason: "That is spam." }) });
    expect(() => previewOf(hidden, draft, NOW)).toThrow();
    const out = composer(hidden, MODERATOR, draft);
    expect(out).toContain(esc(COMPOSER_WORDS.previewAfterSnapshot));
    expect(out).not.toContain("Preview: the statement as its author will receive it");
    expect(out).not.toContain("korbat hid your post of");
    // An older snapshot that is still shown gives the post's time.
    const older = postCase({ snapshots: [hidden.snapshots[0]!, postSnapshot()] });
    expect(previewable(older)).toBe(true);
    expect(statementParagraphs(previewOf(older, draft, NOW))[0]).toBe(STATEMENT_WORDS.done.withhold("2026-09-30 12:00 UTC"));
  });

  test("draws each paragraph as text in a frame of its own direction", () => {
    const view = postCase();
    const draft = draftOf(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }], written: written({ facts: "<b>bold</b> claims", reason: "That is spam." }) });
    const out = composer(view, MODERATOR, draft);
    const preview = out.slice(out.indexOf("Preview: the statement as its author will receive it"));
    const paragraphs = statementParagraphs(previewOf(view, draft, NOW));
    for (const paragraph of paragraphs) expect(preview, paragraph.slice(0, 40)).toContain(`<p class="frame-text"><bdi>${esc(paragraph)}</bdi></p>`);
    expect(preview.split('<p class="frame-text">').length - 1).toBe(paragraphs.length);
    expect(preview).not.toContain("<b>");
  });
});

describe("the texts a draft is given back", () => {
  test("the newest saved text of each kind is restored with its salt and digest; one whose digest does not recompute, and one the rules refuse, are dropped", async () => {
    const view = postCase();
    const fresh = draftOf(view, MODERATOR);
    const facts = await savedDraft("facts", "The post offers followers for money.");
    const older = await savedDraft("reason", "An earlier reason.", { id: "c0d1e2f3-0415-4627-8893-becfd0e1f203" });
    const reason = await savedDraft("reason", "That is spam.");
    const restored = await withSavedTexts(fresh, [facts, older, reason]);
    expect(restored.written).toEqual(written({ facts: facts.text, reason: reason.text }));
    expect(restored.texts).toEqual({ facts: { id: facts.id, text: facts.text, salt: facts.salt, digest: facts.digest }, reason: { id: reason.id, text: reason.text, salt: reason.salt, digest: reason.digest } });
    // A draft the server answers with a digest that is not its text's: an answer cannot put a text into the draft.
    const forged = await withSavedTexts(fresh, [{ ...facts, digest: "ee".repeat(32) }, reason]);
    expect(forged.written).toEqual(written({ reason: reason.text }));
    expect(forged.texts.facts).toBeUndefined();
    // A text the console would never have saved (it holds a control character), though its digest is its own.
    const control = await savedDraft("facts", `The post${String.fromCharCode(7)} rings.`);
    expect((await withSavedTexts(fresh, [control])).written.facts).toBe("");
    // What its person has typed since is never overwritten.
    const typed = { ...fresh, written: written({ facts: "Typed since." }) };
    expect((await withSavedTexts(typed, [facts])).written.facts).toBe("Typed since.");
  });

  test("a saved reason of a correction is carried into the correction when it opens", async () => {
    const view = postCase({ drafts: [await savedDraft("review_reason", "The withhold was taken on the wrong post."), await savedDraft("facts", "A decision's facts.")] });
    const opened = await openCorrection(caseId(view.id), view, view.decisions[0]!, MODERATOR);
    expect(opened).toMatchObject({ kind: "correction", reviewsDecisionId: view.decisions[0]!.id, actions: [] });
    expect(opened.written.review_reason).toBe("The withhold was taken on the wrong post.");
    expect(opened.texts.review_reason?.digest).toBe(view.drafts[0]!.digest);
    // Without one the correction opens empty.
    expect((await openCorrection(caseId(view.id), postCase(), view.decisions[0]!, MODERATOR)).written.review_reason).toBe("");
  });
});

describe("a text is saved when its field loses focus", () => {
  const view = postCase({ decisions: [] });
  const base = draftOf(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }], written: written({ facts: "The post offers followers for money.", reason: "That is spam." }) });

  /** A fake API whose saves answer the digest that was sent, unless a test gives another answer, and which keeps every save. */
  function world(texts?: { status: number; body: unknown }[]) {
    const saves: { kind: string; text: string; digest: string }[] = [];
    let answered = 0;
    const fake = fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() }, [`POST /api/staff/cases/${CASE_POST}/decisions`]: { status: 201, body: postCase({ stateVersion: 4 }) } });
    const fetch: typeof fake.fetch = async (input, init) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      if (input === `/api/staff/cases/${CASE_POST}/texts` && init?.method === "POST") {
        await fake.fetch(input, init);
        const scripted = texts?.[answered++];
        if (scripted) return new Response(JSON.stringify(scripted.body), { status: scripted.status, headers: { "content-type": "application/json" } });
        saves.push(body as (typeof saves)[number]);
        return new Response(JSON.stringify({ id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", digest: body!.digest }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (input === "/api/staff/step-up/options") {
        await fake.fetch(input, init);
        return new Response(JSON.stringify(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, body as never))), { status: 200, headers: { "content-type": "application/json" } });
      }
      return fake.fetch(input, init);
    };
    const credentials = fakeCredentials();
    return { deps: { api: createStaffApi({ fetch, cookie: () => "__Host-korbat_staff_csrf=t" }), credentials, random: (length: number) => new Uint8Array(length).fill(7) }, saves, requests: fake.requests, credentials };
  }

  test("through the one save, without the key, when its normalised form is not empty and differs from the one saved; the request is its person's", async () => {
    const w = world();
    const outcome = await saveDraftText(w.deps, caseId(CASE_POST), base, "facts");
    const digest = await textDigest("07".repeat(32), "The post offers followers for money.");
    expect(outcome).toEqual({ saved: { id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", text: "The post offers followers for money.", salt: "07".repeat(32), digest } });
    expect(w.saves).toEqual([{ kind: "facts", text: "The post offers followers for money.", salt: "07".repeat(32), digest }]);
    expect(w.requests.map((request) => `${request.method} ${request.url} ${request.headers["x-staff-activity"]}`)).toEqual([`POST /api/staff/cases/${CASE_POST}/texts 1`]);
    expect(w.credentials.calls).toEqual([]);
    // The same text, already saved: nothing is sent again, also when only white space differs.
    const kept = { ...base, texts: { facts: outcome && "saved" in outcome ? outcome.saved : undefined } } as CaseDraft;
    expect(await saveDraftText(w.deps, caseId(CASE_POST), kept, "facts")).toBeNull();
    expect(await saveDraftText(w.deps, caseId(CASE_POST), { ...kept, written: { ...kept.written, facts: "  The post offers followers for money.\n" } }, "facts")).toBeNull();
    // An empty field saves nothing.
    expect(await saveDraftText(w.deps, caseId(CASE_POST), { ...base, written: written({ facts: "   " }) }, "facts")).toBeNull();
    expect(w.saves).toHaveLength(1);
    // A changed text is saved again, as a text of its own.
    expect(await saveDraftText(w.deps, caseId(CASE_POST), { ...kept, written: { ...kept.written, facts: "The post sells followers." } }, "facts")).toMatchObject({ saved: { text: "The post sells followers." } });
    expect(w.saves.map((save) => save.text)).toEqual(["The post offers followers for money.", "The post sells followers."]);
  });

  test("a refusal is worded for its field, and the draft is the caller's to keep: nothing of what was written is lost", async () => {
    for (const code of ["text_quotes_user", "text_invalid", "rate_limited"] as const) {
      const w = world([{ status: code === "rate_limited" ? 429 : 422, body: envelope(code) }]);
      const frozen = JSON.stringify(base);
      const outcome = await saveDraftText(w.deps, caseId(CASE_POST), base, "facts");
      expect(outcome, code).toEqual({ error: code === "rate_limited" ? "Too many texts were saved in a minute. Wait a moment and save again." : MODERATION_MESSAGES[code], code });
      expect(JSON.stringify(base)).toBe(frozen);
    }
    // A text the rules refuse is never sent.
    const w = world();
    expect(await saveDraftText(w.deps, caseId(CASE_POST), { ...base, written: written({ facts: `Bell${String.fromCharCode(7)}` }) }, "facts")).toEqual({ error: MODERATION_MESSAGES.text_invalid, code: "text_invalid" });
    expect(w.requests).toEqual([]);
    // An answer that carries another digest saves nothing the draft could name.
    const forged = world([{ status: 201, body: { id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", digest: "ee".repeat(32) } }]);
    expect(await saveDraftText(forged.deps, caseId(CASE_POST), base, "facts")).toEqual({ error: messageFor("invalid_answer"), code: "invalid_answer" });
  });

  test("Confirm uses the texts that were saved as they are, and saves again one whose save failed or that changed since: each text is on the server exactly once when the key is asked", async () => {
    // Both texts saved when their fields lost focus: the confirmation saves nothing.
    const w = world();
    let draft = base;
    for (const kind of ["facts", "reason"] as const) {
      const outcome = await saveDraftText(w.deps, caseId(CASE_POST), draft, kind);
      if (outcome === null || !("saved" in outcome)) throw new Error("the save was refused");
      draft = { ...draft, texts: { ...draft.texts, [kind]: outcome.saved } };
    }
    expect(w.saves.map((save) => save.kind)).toEqual(["facts", "reason"]);
    expect(await confirmDecision(w.deps, caseId(CASE_POST), view, draft)).toMatchObject({ view: { stateVersion: 4 } });
    expect(w.saves).toHaveLength(2);
    expect(w.credentials.calls).toHaveLength(1);
    const sent = w.requests.at(-1)!.body as CaseDecidedParams;
    expect([sent.factsDigest, sent.reasonDigest]).toEqual([draft.texts.facts!.digest, draft.texts.reason!.digest]);

    // The save of the facts failed when the field lost focus: what was written is still in the draft, and Confirm saves it.
    const failing = world([{ status: 503, body: envelope("service_unavailable") }]);
    expect(await saveDraftText(failing.deps, caseId(CASE_POST), base, "facts")).toMatchObject({ code: "service_unavailable" });
    expect(failing.saves).toEqual([]);
    expect(base.written.facts).toBe("The post offers followers for money.");
    const remembered: string[] = [];
    expect(await confirmDecision(failing.deps, caseId(CASE_POST), view, base, (kind) => void remembered.push(kind))).toMatchObject({ view: { stateVersion: 4 } });
    expect(failing.saves.map((save) => save.kind)).toEqual(["facts", "reason"]);
    expect(remembered).toEqual(["facts", "reason"]);
  });
});

describe("the case a confirmation names", () => {
  const view = postCase({ decisions: [] });
  const base = draftOf(view, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }], written: written({ facts: "The post offers followers for money.", reason: "That is spam." }) });

  test("is the one of the page's address: a view of another case is confirmed nowhere, with no text saved and no key asked", async () => {
    const fake = fakeFetch({});
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    // The page stands at the frozen case's address and was handed the post case's view.
    expect(await confirmDecision({ api, credentials }, caseId(CASE_FROZEN), view, base)).toEqual({ error: messageFor("invalid_answer"), code: "invalid_answer" });
    expect(fake.requests).toEqual([]);
    expect(credentials.calls).toEqual([]);
  });

  test("the API client refuses a case answered under another case's address, on the read and on a decision's answer", async () => {
    const other = postCase({ id: CASE_FROZEN });
    const fake = fakeFetch({ [`GET /api/staff/cases/${CASE_POST}`]: { status: 200, body: other }, [`POST /api/staff/cases/${CASE_POST}/decisions`]: { status: 201, body: other }, [`GET /api/staff/cases/${CASE_FROZEN}`]: { status: 200, body: other } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const refusal = (promise: Promise<unknown>) => promise.then(() => null, (err: unknown) => (err instanceof ApiError ? err.code : "thrown"));
    expect(await refusal(api.caseView(caseId(CASE_POST)))).toBe("invalid_answer");
    expect(await refusal(api.decide(CASE_POST, { ...decisionParamsOf(view, base, { snapshot: HEX, facts: HEX, reason: HEX, legalReference: null }), stepUp: {} } as never))).toBe("invalid_answer");
    // The case that was asked for is read as ever.
    expect((await api.caseView(caseId(CASE_FROZEN))).id).toBe(CASE_FROZEN);
  });
});

describe("after a confirmation", () => {
  test("a refusal that says the case or its snapshot is no longer what the page shows makes the page read the case again; a text that is gone is saved again at the next try", () => {
    for (const code of ["case_changed", "profile_changed", "snapshot_erased", "snapshot_mismatch"]) expect(afterRefusal(code), code).toEqual({ readAgain: true, saveAgain: false });
    expect(afterRefusal("text_not_found")).toEqual({ readAgain: false, saveAgain: true });
    for (const code of ["staff_recused", "staff_target", "admin_required", "decision_cap", "invalid_decision", "step_up_mismatch", "ceremony_cancelled", "network", "incomplete"]) {
      expect(afterRefusal(code), code).toEqual({ readAgain: false, saveAgain: false });
    }
  });

  test("the page says that the decision is recorded, which reports stay open for later, and what arrived since it read the case", () => {
    const before = rangeCase();
    const answered = (through: number, more: CaseView["items"] = []): CaseView =>
      rangeCase({ answeredSeq: through, stateVersion: before.stateVersion + 1, items: [...before.items.map((each) => (each.seq <= through ? { ...each, outcome: "no_violation" as const, answeredBy: "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe" } : each)), ...more] });
    // An admin's answer through the suspect item leaves the later rule report open.
    expect(decidedNotice(before, answered(2), true)).toBe(`The decision is recorded. ${COMPOSER.leftForLater(1)}`);
    expect(COMPOSER.leftForLater(1)).toBe("The reports on other grounds that arrived after the newest report of child sexual abuse material stay open (1 item), to be judged with the images once the freeze has ended.");
    // A report that arrived since the page read the case stays open too, and the page says so.
    const arrived = item({ id: "6a7b8c9d-aebf-40c1-a23d-5e6f7a8b9cad", seq: 4, ruleId: "R3", lane: 1 });
    expect(decidedNotice(before, answered(2, [arrived]), true)).toBe(`The decision is recorded. ${COMPOSER.leftForLater(1)} ${COMPOSER.arrivedSince(1)}`);
    expect(COMPOSER.arrivedSince(1)).toBe("1 new item arrived since this page read the case: it stays open.");
    expect(COMPOSER.arrivedSince(2)).toBe("2 new items arrived since this page read the case: they stay open.");
    // A final decision through the newest item of an ordinary case, and one item arrived meanwhile.
    const plain = postCase();
    const closed = postCase({ answeredSeq: 2, items: plain.items.map((each) => ({ ...each, outcome: "no_violation" as const, answeredBy: "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe" })) });
    expect(decidedNotice(plain, closed, true)).toBe("The decision is recorded.");
    expect(decidedNotice(plain, { ...closed, items: [...closed.items, item({ id: ITEM_FINDING, seq: 3 })] }, true)).toBe(`The decision is recorded. ${COMPOSER.arrivedSince(1)}`);
    // A decision taken while deciding answers nothing, and says nothing about what is open.
    expect(decidedNotice(before, before, false)).toBe("The decision is recorded.");
  });
});

describe("the page's busy flag during a confirmation", () => {
  const view = postCase({ decisions: [] });
  const draft = draftOf(view, MODERATOR);

  /** A page as the case screen hands itself over: what it shows and holds can be changed under the confirmation, and every change of the flag is kept. */
  function page(start: { view?: CaseView | null; draft?: CaseDraft | null; saving?: Promise<unknown>[] } = {}) {
    const state = { alive: true, view: start.view === undefined ? view : start.view, draft: start.draft === undefined ? draft : start.draft, flags: [] as boolean[] };
    const port = { alive: () => state.alive, shown: () => state.view, draft: () => state.draft, saving: () => start.saving ?? [], setBusy: (busy: boolean) => void state.flags.push(busy) };
    return { state, port };
  }
  /** A save of a text that is on its way until the test lets it end. */
  function pendingSave() {
    let end!: () => void;
    const save = new Promise<void>((resolve) => {
      end = resolve;
    });
    return { save, end };
  }

  test("is up while the confirmation runs, and down again when it has run, was refused or threw", async () => {
    // The confirmation gets the case and the draft as the page holds them, with the flag up.
    const ran = page();
    const seen: unknown[] = [];
    await confirmWhileBusy(ran.port, async (shown, held) => void seen.push([shown === view, held === draft, [...ran.state.flags]]));
    expect(seen).toEqual([[true, true, [true]]]);
    expect(ran.state.flags).toEqual([true, false]);
    // A step that throws: the flag still comes down, and the error is the caller's.
    const thrown = page();
    await expect(confirmWhileBusy(thrown.port, () => Promise.reject(new Error("a step failed")))).rejects.toThrow("a step failed");
    expect(thrown.state.flags).toEqual([true, false]);
    // A page that shows no case, or holds no draft, starts nothing and raises no flag.
    for (const none of [page({ view: null }), page({ draft: null })]) {
      await confirmWhileBusy(none.port, async () => void seen.push("ran"));
      expect(none.state.flags).toEqual([]);
    }
    expect(seen).toHaveLength(1);
  });

  test("comes down when the page is no longer ready after the wait for the text saves: nothing is confirmed, and the page is not left busy", async () => {
    // The saves on their way end first; one that failed is waited for like one that succeeded.
    const waited = page({ saving: [Promise.reject(new Error("the save failed")), Promise.resolve()] });
    let runs = 0;
    await confirmWhileBusy(waited.port, async () => void runs++);
    expect(runs).toBe(1);
    expect(waited.state.flags).toEqual([true, false]);
    // The page lost its case while a save was on its way (a read failed for good): nothing runs, and the flag comes down.
    const first = pendingSave();
    const lost = page({ saving: [first.save] });
    const noCase = confirmWhileBusy(lost.port, async () => void runs++);
    expect(lost.state.flags).toEqual([true]);
    lost.state.view = null;
    first.end();
    await noCase;
    expect(runs).toBe(1);
    expect(lost.state.flags).toEqual([true, false]);
    // The draft was put away meanwhile: the same.
    const second = pendingSave();
    const emptied = page({ saving: [second.save] });
    const noDraft = confirmWhileBusy(emptied.port, async () => void runs++);
    emptied.state.draft = null;
    second.end();
    await noDraft;
    expect(runs).toBe(1);
    expect(emptied.state.flags).toEqual([true, false]);
    // The confirmation runs on the case and the draft as they stand after the wait, not as they stood at the click.
    const third = pendingSave();
    const moved = page({ saving: [third.save] });
    const saved = { ...draft, texts: { facts: { id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", text: "Saved at blur.", salt: "5a".repeat(32), digest: HEX } } };
    const got: CaseDraft[] = [];
    const later = confirmWhileBusy(moved.port, async (_shown, held) => void got.push(held));
    moved.state.draft = saved;
    third.end();
    await later;
    expect(got).toEqual([saved]);
    // A page that was closed meanwhile is not touched again.
    const fourth = pendingSave();
    const closed = page({ saving: [fourth.save] });
    const gone = confirmWhileBusy(closed.port, async () => void runs++);
    closed.state.alive = false;
    fourth.end();
    await gone;
    expect(runs).toBe(1);
    expect(closed.state.flags).toEqual([true]);
  });
});
