import { CaseDecidedParams, CaseView, MEASURES, RULE_DEFAULT_CATEGORY, SEAL_DRAFTS, snapshotDigest, textDigest, type CaseDecision, type StaffMe } from "@korbat/contracts";
import { RULES, RULES_VERSION, REDRESS_VERSION, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import {
  COMPOSER,
  confirmDecision,
  correctable,
  correctionDraft,
  decidedNotice,
  decisionParamsOf,
  finalNeedsAdmin,
  kindsOffered,
  leftOpen,
  liftable,
  measuresOffered,
  newDraft,
  noEffectOf,
  offeredDraft,
  outcomesOffered,
  predictedSource,
  previewOf,
  sealDraftFor,
  sealOffered,
  shownSnapshotDigest,
  throughSeqOf,
  withSeal,
  type CaseDraft,
} from "../src/compose";
import { MODERATION_MESSAGES } from "../src/messages";
import { parseCaseId } from "../src/router";
import { ComposerView, CorrectControl, type ComposerViewProps } from "../src/screens/Composer";
import { decisionAction, decideWithKey, StepUpMismatch } from "../src/step-up";
import { accountCase, CASE_ACCOUNT, CASE_FROZEN, CASE_POST, decision, frozenCase, IMAGE_ONE, IMAGE_TWO, item, ITEM_FINDING, ITEM_NOTIFIER, ITEM_SUSPECT, postCase, postSnapshot, SOURCES } from "./case-fixtures";
import { envelope, fakeCredentials, fakeFetch, HOSTILE_ESCAPED, hrefs, makeMe, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The decision composer (3c design, sections 7.5 and 8): what it offers to whom, the sentences it says beside each
 * choice, the params it builds from what the page shows, the preview, which is the statement exactly as its author will
 * get it, and the confirmation by the key. Its pure parts are tested as functions, its screen server-rendered.
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

/** The composer for a case as the page opens it, with the draft changed as a test says. */
function composer(view: CaseView, role: StaffMe["role"], change: Partial<CaseDraft> = {}, extra: Partial<ComposerViewProps> = {}) {
  const draft = { ...newDraft(caseId(view.id), view, role), ...change };
  const props: ComposerViewProps = { view, role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop, ...extra };
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

/** An account case that holds an unanswered suspect item and reaches images. */
const sealableAccount = (more: Partial<CaseView> = {}): CaseView =>
  accountCase({ suspicion: { open: true, reach: { posts: 3, images: 7, sealed: 0, served: 7, newestPostOn: "2026-09-30" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } }, ...more });

describe("what the composer offers", () => {
  test("to a moderator on an ordinary case: both kinds, the three outcomes only where an item alleges illegality, and the measures of the target and the kind", () => {
    // Nothing decided yet: a withhold taken while deciding in force would keep a second one from being offered.
    const view = postCase({ decisions: [] });
    expect(kindsOffered(view, MODERATOR)).toEqual(["interim", "final"]);
    expect(outcomesOffered(view, "final")).toEqual(["restricted", "no_violation", "not_evident"]);
    expect(outcomesOffered(view, "interim")).toEqual(["restricted"]);
    // No item alleges illegality: "Illegality not evident" is not offered, and neither is the ground of the law.
    const ruleOnly = postCase({ items: [item()], intakeSeq: 1 });
    expect(outcomesOffered(ruleOnly, "final")).toEqual(["restricted", "no_violation"]);
    expect(composer(ruleOnly, MODERATOR, { kind: "final" })).not.toContain("Illegality not evident");
    expect(composer(ruleOnly, MODERATOR, { kind: "final" })).not.toContain(">The law<");
    expect(composer(view, MODERATOR, { kind: "final" })).toContain(">The law<");
    expect(measuresOffered(view, "interim")).toEqual(["withhold", "withhold_media"]);
    expect(measuresOffered(view, "final")).toEqual(["remove", "remove_media"]);
    expect(measuresOffered(accountCase(), "interim")).toEqual(["reset_display_name", "reset_bio"]);
    expect(measuresOffered(accountCase(), "final")).toEqual(["reset_display_name", "reset_bio"]);
    const out = composer(view, MODERATOR);
    for (const label of [MEASURES.withhold.label, MEASURES.withhold_media.label]) expect(out).toContain(label);
    expect(out).not.toContain(`>${MEASURES.remove.label}<`);
    // A closed case takes no new decision: only its restrictions can still be corrected.
    expect(kindsOffered(postCase({ closedAt: "2026-10-02T08:00:00.000Z" }), ADMIN)).toEqual([]);
    expect(composer(postCase({ closedAt: "2026-10-02T08:00:00.000Z" }), ADMIN)).toContain(COMPOSER.closed);
  });

  test("each rule with its text and, side by side, what is allowed and what is not, as the current rulebook words them", () => {
    const out = composer(postCase(), MODERATOR, { ruleId: "R3" });
    const rule = getRule("R3", RULES_VERSION)!;
    expect(out).toContain(rule.text);
    for (const example of [...rule.allowed, ...rule.notAllowed]) expect(out).toContain(example.replace(/'/g, "&#x27;"));
    expect(out).toMatch(/<h5[^>]*>Allowed<\/h5>/);
    expect(out).toMatch(/<h5[^>]*>Not allowed<\/h5>/);
    // Every rule of the rulebook is offered with its title, but R2: a decision under it rests on a report or finding of
    // child sexual abuse material, so it is offered only on a case that holds one unanswered.
    for (const each of RULES) expect(out.includes(`${each.id}: ${each.title}`), each.id).toBe(each.id !== "R2");
    expect(composer(rangeCase(), MODERATOR)).toContain(`R2: ${getRule("R2", RULES_VERSION)!.title}`);
  });

  test("to a non-admin on a case whose final decision would need an admin, only While deciding, and why", () => {
    const suspect = rangeCase();
    const r5 = postCase({ lane: 0, items: [item({ ruleId: "R5", lane: 0 })], intakeSeq: 1 });
    for (const view of [suspect, r5]) {
      expect(finalNeedsAdmin(view)).toBe(true);
      expect(kindsOffered(view, MODERATOR)).toEqual(["interim"]);
      expect(kindsOffered(view, ADMIN)).toEqual(["interim", "final"]);
      const out = composer(view, MODERATOR);
      expect(COMPOSER.adminFinal).toBe("A final decision on this case, whatever its outcome, is an admin's.");
      expect(out).toContain(esc(COMPOSER.adminFinal));
      expect(out).not.toContain(">Decide the case<");
      expect(composer(view, ADMIN)).toContain(">Decide the case<");
      expect(composer(view, ADMIN)).not.toContain(esc(COMPOSER.adminFinal));
    }
    // An answered R5 item no longer makes the next decision an admin's.
    expect(finalNeedsAdmin(postCase({ items: [item({ ruleId: "R5", outcome: "no_violation", answeredBy: HEX.slice(0, 8) }), item({ seq: 2 })] }))).toBe(false);
    expect(finalNeedsAdmin(postCase())).toBe(false);
  });

  test("a measure on a post that is not visible is offered with the sentence that it changes nothing now, and a lane-0 case with the note advice", () => {
    // The post is removed by another case's final decision: a withhold while deciding is recorded and changes nothing.
    const hidden = postCase({ lane: 0, target: { ...postCase().target, type: "post", state: "removed", level: "removed" } as CaseView["target"], items: [item({ ruleId: "R5", lane: 0 })], intakeSeq: 1, decisions: [] });
    expect(noEffectOf(hidden, { kind: "withhold", mediaId: null })).toBe("already");
    expect(noEffectOf(hidden, { kind: "withhold_media", mediaId: IMAGE_ONE })).toBe("already");
    const out = composer(hidden, MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] });
    expect(out).toContain(MEASURES.withhold.label);
    expect(out).toContain("This changes nothing anyone sees now. It is recorded as a measure of its own, stays in force should the other restriction be reversed, and its author is told (not for a measure taken while deciding on a deleted post).");
    expect(out).toContain(
      "To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails. A measure taken while deciding here changes nothing and mails its author at once.",
    );
    // A visible post in the urgent lane gets neither sentence: there the post is withheld or the item decided.
    const visible = composer(postCase({ lane: 0, items: [item({ ruleId: "R5", lane: 0 })], intakeSeq: 1 }), MODERATOR, { actions: [{ kind: "withhold", mediaId: null }] });
    expect(visible).not.toContain(COMPOSER.noEffect);
    expect(visible).not.toContain("save your Art. 18 check as a note");
    // A deleted post, a removed one, and the fields of an account.
    const deleted = postCase({ target: { ...postCase().target, type: "post", state: "deleted_by_author", level: "visible" } as CaseView["target"] });
    expect(noEffectOf(deleted, { kind: "remove", mediaId: null })).toBe("deleted");
    const removed = postCase({ target: { ...postCase().target, type: "post", state: "removed", level: "removed" } as CaseView["target"] });
    expect(noEffectOf(removed, { kind: "remove", mediaId: null })).toBe("already");
    const reset = accountCase({ target: { type: "account", id: accountCase().target.id, handle: "ada", displayName: "ada", bio: "", deleted: false } });
    expect(noEffectOf(reset, { kind: "reset_display_name", mediaId: null })).toBe("already");
    expect(noEffectOf(reset, { kind: "reset_bio", mediaId: null })).toBe("already");
    expect(noEffectOf(accountCase(), { kind: "reset_bio", mediaId: null })).toBeNull();
    expect(noEffectOf(accountCase({ target: { ...accountCase().target, deleted: true } as CaseView["target"] }), { kind: "reset_bio", mediaId: null })).toBe("deleted");
    // A lane-0 account case without a suspect item: the account's advice.
    const account = accountCase({ suspicion: null, items: [item({ ruleId: "R5", lane: 0, link: "http://localhost:8081/u/named_once" })] });
    expect(composer(account, MODERATOR)).toContain(
      "To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails. Reset the display name or bio while deciding only when it carries what was reported: a reset mails its author at once.",
    );
  });
});

describe("a post this case hides while deciding", () => {
  /** A post this case withheld while deciding (the fixture's decision), with its one item unanswered: a final decision now closes the case. */
  const hiddenHere = (more: Partial<CaseView> = {}) =>
    postCase({ target: { ...postCase().target, type: "post", state: "withheld", level: "withheld" } as CaseView["target"], items: [item()], intakeSeq: 1, ...more });

  test("a final decision that closes the case ends the withhold, as the database does: an image measure then changes what everyone sees, and the preview says what ends", () => {
    const view = hiddenHere();
    expect(leftOpen(view)).toEqual([]);
    const removeImage = { kind: "remove_media" as const, mediaId: IMAGE_ONE };
    expect(noEffectOf(view, removeImage, "final")).toBeNull();
    expect(noEffectOf(view, { kind: "remove", mediaId: null }, "final")).toBeNull();
    const draft = { ...newDraft(caseId(view.id), view, MODERATOR), kind: "final" as const, actions: [removeImage] };
    const preview = statementParagraphs(previewOf(view, draft, NOW));
    expect(preview.join(" ")).not.toContain("Another decision already keeps this image from being shown");
    expect(preview).toContain(STATEMENT_WORDS.ended(MEASURES.withhold.label));
    // The composer says nothing beside the measure about it changing nothing.
    expect(composer(view, MODERATOR, { kind: "final", actions: [removeImage] })).not.toContain(COMPOSER.noEffect);
    // While deciding, the post stays hidden by this case: the image measure changes nothing now.
    expect(noEffectOf(view, { kind: "withhold_media", mediaId: IMAGE_ONE }, "interim")).toBe("already");
    // A post removed for good stays removed whatever this case decides.
    const removed = hiddenHere({ target: { ...postCase().target, type: "post", state: "removed", level: "removed" } as CaseView["target"] });
    expect(noEffectOf(removed, removeImage, "final")).toBe("already");
  });

  test("a final decision that leaves the case open leaves the withhold in force: there the image measure changes nothing now", () => {
    // An unanswered suspect item ends the range of a final decision: the rule report after it stays open.
    const open = rangeCase({ target: hiddenHere().target, decisions: hiddenHere().decisions });
    expect(leftOpen(open).length).toBeGreaterThan(0);
    expect(noEffectOf(open, { kind: "remove_media", mediaId: IMAGE_ONE }, "final")).toBe("already");
  });

  test("while deciding, a second withhold of the post is not offered: the page says that the case hides it already, and a kept draft drops it", () => {
    const view = hiddenHere();
    expect(measuresOffered(view, "interim")).not.toContain("withhold");
    expect(measuresOffered(view, "interim")).toContain("withhold_media");
    // A final decision may still remove the post.
    expect(measuresOffered(view, "final")).toContain("remove");
    const out = composer(view, MODERATOR, { kind: "interim" });
    expect(out).toContain(COMPOSER.alreadyHidden);
    expect(COMPOSER.alreadyHidden).toBe("This case already hides the post while it is decided.");
    expect(out).not.toContain(`> <span>${MEASURES.withhold.label}</span>`);
    const kept = { ...newDraft(caseId(view.id), view, MODERATOR), kind: "interim" as const, actions: [{ kind: "withhold" as const, mediaId: null }] };
    expect(offeredDraft(view, MODERATOR, kept).actions).toEqual([]);
    // An image this case withholds while deciding is not offered for a second withhold; the other image is.
    const imageHeld = postCase({ decisions: [decision({ actions: [{ ...decision().actions[0]!, kind: "withhold_media", mediaId: IMAGE_ONE }] })], items: [item()], intakeSeq: 1 });
    const second = { ...newDraft(caseId(imageHeld.id), imageHeld, MODERATOR), kind: "interim" as const, actions: [{ kind: "withhold_media" as const, mediaId: IMAGE_ONE }] };
    expect(offeredDraft(imageHeld, MODERATOR, second).actions).toEqual([]);
    const other = { ...second, actions: [{ kind: "withhold_media" as const, mediaId: IMAGE_TWO }] };
    expect(offeredDraft(imageHeld, MODERATOR, other).actions).toEqual(other.actions);
    expect(composer(imageHeld, MODERATOR, { kind: "interim", actions: other.actions })).not.toContain(`value="${IMAGE_ONE}"`);
  });

  test("after a final decision that left the case open because an item arrived meanwhile, the page says that what was done while deciding stays in force", () => {
    const before = hiddenHere();
    const answered = { ...before.items[0]!, outcome: "no_violation" as const, answeredBy: "7b8c9dae-bfc0-41d2-b34e-6f7a8b9cadbe" };
    const arrived = item({ id: ITEM_FINDING, seq: 2, ruleId: "R3", lane: 2, source: SOURCES.reporter });
    const now = hiddenHere({ answeredSeq: 1, intakeSeq: 2, items: [answered, arrived] });
    expect(decidedNotice(before, now, true)).toBe(`The decision is recorded. ${COMPOSER.arrivedSince(1)} ${COMPOSER.interimStays(MEASURES.withhold.label)}`);
    expect(COMPOSER.interimStays(MEASURES.withhold.label)).toBe(`The case stays open, so what was done while deciding stays in force: ${MEASURES.withhold.label}.`);
    // Closed as the page read it: nothing stays.
    const closed = hiddenHere({ answeredSeq: 1, closedAt: "2026-10-04T09:30:00.000Z", items: [answered], decisions: [decision({ actions: [{ ...decision().actions[0]!, inForce: false }] })] });
    expect(decidedNotice(before, closed, true)).toBe("The decision is recorded.");
  });
});

describe("a case with an unanswered suspect item", () => {
  test("Seal the images this case reaches, with its fixed drafts, and Do not seal now, are offered while deciding to anyone eligible", () => {
    const view = rangeCase();
    expect(sealOffered(view, "interim", MODERATOR)).toBe(true);
    const out = composer(view, MODERATOR);
    expect(out).toContain(`>${MEASURES.seal_media.label}</button>`);
    expect(out).toContain(">Do not seal now</button>");
    expect(out).toContain(esc("Only the seal, a recorded choice not to seal, or an admin's answer ends the urgent mails."));
    // The ordinary measures for the post's text stay offered.
    expect(out).toContain(MEASURES.withhold.label);
    // The seal chosen: rule R2, the drafts of the facts and the reason, and the sentence under both fields.
    const sealed = withSeal(view, newDraft(caseId(view.id), view, MODERATOR));
    expect(sealed).toMatchObject({ kind: "interim", outcome: "restricted", ground: "incompatible", ruleId: "R2", category: RULE_DEFAULT_CATEGORY.R2, actions: [{ kind: "seal_media", mediaId: null }] });
    expect(sealed.written.facts).toBe(SEAL_DRAFTS.facts.notice_post);
    expect(sealed.written.reason).toBe(SEAL_DRAFTS.reason.deciding);
    const chosen = composer(view, MODERATOR, sealed);
    expect(chosen).toContain(SEAL_DRAFTS.facts.notice_post);
    expect(chosen).toContain(SEAL_DRAFTS.reason.deciding.replace(/'/g, "&#x27;"));
    expect(chosen.split("Never write that the images are child sexual abuse material: nobody at korbat has seen them.").length - 1).toBe(2);
    // The preview is the statement the author will get, from the drafts.
    expect(chosen).toContain("korbat sealed the images of your post of 2026-09-30 12:00 UTC (2 in all): nobody can see them, you included.");
    expect(chosen).toContain(`The facts: ${SEAL_DRAFTS.facts.notice_post}`);
  });

  test("the facts draft follows the unanswered suspect items: a notice or a finding, a post or an account, and the added form when korbat added every one", () => {
    expect(sealDraftFor(rangeCase(), "interim")).toEqual({ facts: SEAL_DRAFTS.facts.notice_post, reason: SEAL_DRAFTS.reason.deciding });
    expect(sealDraftFor(rangeCase(), "final")).toEqual({ facts: SEAL_DRAFTS.facts.notice_post, reason: SEAL_DRAFTS.reason.final });
    expect(sealDraftFor(sealableAccount(), "interim").facts).toBe(SEAL_DRAFTS.facts.notice_account);
    const finding = rangeCase({ items: [item({ id: ITEM_SUSPECT, seq: 1, suspect: true, ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", lane: 0, source: SOURCES.staff })], intakeSeq: 1 });
    expect(sealDraftFor(finding, "interim").facts).toBe(SEAL_DRAFTS.facts.finding_post);
    const added = rangeCase({ items: [item({ id: ITEM_SUSPECT, seq: 1, position: 11, quotedByPosition: 1, csam: true, suspect: true, allegesIllegal: true, ruleId: null, lane: 0, source: SOURCES.anonymous })], intakeSeq: 1 });
    expect(sealDraftFor(added, "interim").facts).toBe(SEAL_DRAFTS.facts.notice_added);
    // The composer and the preview hold exactly the contracts' words: none is written a second time in the console.
    for (const draftText of [...Object.values(SEAL_DRAFTS.facts), ...Object.values(SEAL_DRAFTS.reason)]) expect(JSON.stringify(COMPOSER)).not.toContain(draftText.slice(0, 40));
  });

  test("a case that reaches no image is not offered the seal, and a note ends its urgent mails", () => {
    const view = accountCase();
    expect(sealOffered(view, "interim", MODERATOR)).toBe(false);
    const out = composer(view, MODERATOR);
    expect(out).not.toContain(`>${MEASURES.seal_media.label}</button>`);
    expect(out).toContain("To record that you read a new urgent item, save your Art. 18 check as a note: a note saved after the item arrived ends its urgent-lane mails.");
    expect(out).not.toContain("Only the seal, a recorded choice not to seal");
    expect(out).not.toContain("Reset the display name or bio while deciding only when");
  });

  test("Do not seal now asks for a reason under its words, and saves nothing empty", () => {
    const view = rangeCase();
    const open = composer(view, MODERATOR, {}, { declining: { reason: "", busy: false, error: null } });
    expect(open).toContain(
      "Record why you do not seal now. This ends the urgent mails for the reports that have arrived so far, until an image is posted that this case reaches; an admin still answers the case. Every staff member sees this choice on the home screen for 30 days.",
    );
    expect(open).toMatch(/<button[^>]*disabled=""[^>]*>Record this choice<\/button>/);
    const written = composer(view, MODERATOR, {}, { declining: { reason: "The report repeats the one answered on 14 August.", busy: false, error: null } });
    expect(written).not.toMatch(/<button[^>]*disabled=""[^>]*>Record this choice<\/button>/);
    const refused = composer(view, MODERATOR, {}, { declining: { reason: "x", busy: false, error: MODERATION_MESSAGES.text_invalid } });
    expect(refused).toContain(MODERATION_MESSAGES.text_invalid);
  });

  test("the seal for good and the answer without one are an admin's, with what the answer does: on a post case it also answers the earlier reports on other grounds unseen", () => {
    const view = rangeCase();
    expect(sealOffered(view, "final", MODERATOR)).toBe(false);
    expect(sealOffered(view, "final", ADMIN)).toBe(true);
    const out = composer(view, ADMIN, { kind: "final", outcome: "no_violation" });
    expect(out).toContain(esc("A final decision without a seal ends this case's freeze: staff may then open these images unless another open report or a seal still covers them, and every staff account is mailed."));
    expect(out).toContain(
      "You decide without seeing the images. Seal for good, and report, when the report's words, the post's text or alt texts, or the account's conduct give a concrete reason to believe the report; answer without a seal when they give none. Say which it was in the facts.".replace(/'/g, "&#x27;"),
    );
    expect(out).toContain("Your answer also answers the reports on other grounds that arrived before the newest report of this kind, unseen; their senders are told so and may ask again.");
    expect(out).toContain(
      "After an answer without a seal the case's images may be opened: whoever is on duty opens the case's target the same day and, where an image breaks a rule or the law, opens a finding on the post and decides it (if it is what the report said, a finding citing R2, which freezes again). When a new report of this kind arrives before that decision is made, the admin's next answer carries the measure for what staff saw, and its facts say when the images were seen. An admin's answer never restricts under another rule on a report's words alone about an image nobody at korbat has opened: that report is answered unseen, and its sender may ask again.".replace(
        /'/g,
        "&#x27;",
      ),
    );
    // The seal for good takes the final reason.
    expect(withSeal(view, { ...newDraft(caseId(view.id), view, ADMIN), kind: "final" }).written.reason).toBe(SEAL_DRAFTS.reason.final);
    // On an account case such reports concern the display name and bio, which the admin reads: no such sentence.
    const account = composer(sealableAccount(), ADMIN, { kind: "final", outcome: "no_violation" });
    expect(account).toContain(esc(COMPOSER.admin.endsFreeze));
    expect(account).not.toContain(COMPOSER.admin.answersEarlier);
    // A moderator is offered none of it, and no admin sentence.
    const moderator = composer(view, MODERATOR);
    expect(moderator).not.toContain(esc(COMPOSER.admin.endsFreeze));
    expect(moderator).not.toContain(esc(COMPOSER.admin.unseen));
  });

  test("the range of an admin's answer: through the newest unanswered suspect item, not the newest item; the later reports stay open, and the page says so beside the composer, never in the preview", () => {
    const view = rangeCase();
    expect(throughSeqOf(view)).toBe(2);
    expect(leftOpen(view).map((left) => left.seq)).toEqual([3]);
    const draft: CaseDraft = { ...newDraft(caseId(view.id), view, ADMIN), kind: "final", outcome: "no_violation" };
    const params = decisionParamsOf(view, draft, { snapshot: HEX, facts: null, reason: null, legalReference: null });
    expect(params).toMatchObject({ kind: "final", throughSeq: 2, stateVersion: view.stateVersion, outcome: "no_violation", ground: null, ruleId: null, actions: [] });
    expect(CaseDecidedParams.safeParse(params).success).toBe(true);
    const out = composer(view, ADMIN, draft);
    const STAYS = "This decision answers the items up to the newest report of child sexual abuse material (item 2). The reports on other grounds that arrived after it stay open (1 item), to be judged with the images once the freeze has ended.";
    expect(out).toContain(STAYS);
    // Never in the preview: the statement is the author's.
    expect(statementParagraphs(previewOf(view, draft, NOW)).join("\n")).not.toContain("stay open");
    // Without a suspect item a final decision answers through the newest item the page showed.
    expect(throughSeqOf(postCase())).toBe(2);
    expect(leftOpen(postCase())).toEqual([]);
    expect(composer(postCase(), MODERATOR, { kind: "final" })).not.toContain("stay open");
    // A decision taken while deciding answers no item.
    expect(decisionParamsOf(view, { ...draft, kind: "interim", outcome: "restricted", actions: [{ kind: "withhold", mediaId: null }] }, { snapshot: HEX, facts: HEX, reason: HEX, legalReference: null }).throughSeq).toBe(0);
  });
});

describe("the params the key confirms", () => {
  test("are built from what the page shows: the case's version, the snapshot it displayed with the digest computed here, the digests of the saved texts and the sorted actions", async () => {
    const view = postCase();
    const draft: CaseDraft = {
      ...newDraft(caseId(view.id), view, MODERATOR),
      kind: "final",
      ruleId: "R6",
      category: RULE_DEFAULT_CATEGORY.R6,
      actions: [
        { kind: "remove_media", mediaId: IMAGE_ONE },
        { kind: "remove", mediaId: null },
      ],
    };
    const shown = view.snapshots[0]!;
    if (shown.withheld) throw new Error("the fixture's newest snapshot shows its content");
    const digest = await shownSnapshotDigest(shown);
    // The console's own computation over the displayed members, not the digest the answer carried.
    expect(digest).toBe(await snapshotDigest({ ...shown, media: shown.media }));
    expect(digest).not.toBe(shown.digest);
    const params = decisionParamsOf(view, draft, { snapshot: digest, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null });
    expect(params).toEqual({
      kind: "final",
      stateVersion: 3,
      throughSeq: 2,
      reviewsDecisionId: null,
      snapshotId: shown.id,
      snapshotDigest: digest,
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R6",
      rulesVersion: RULES_VERSION,
      redressVersion: REDRESS_VERSION,
      category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      categoryKeyword: null,
      actions: [
        { kind: "remove", mediaId: null },
        { kind: "remove_media", mediaId: IMAGE_ONE },
      ],
      factsDigest: "aa".repeat(32),
      reasonDigest: "bb".repeat(32),
      legalReferenceDigest: null,
    });
    // A decision on the law names no rule, carries its reference's digest and, when ticked, the terrorist-content keyword.
    const law = decisionParamsOf(view, { ...draft, ground: "illegal", category: "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", terrorist: true, actions: [{ kind: "remove", mediaId: null }] }, { snapshot: digest, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: "cc".repeat(32) });
    expect(law).toMatchObject({ ground: "illegal", ruleId: null, categoryKeyword: "KEYWORD_TERRORIST_CONTENT", legalReferenceDigest: "cc".repeat(32) });
    // A no-action decision carries no ground, and its facts and its reason when they are written.
    expect(decisionParamsOf(view, { ...draft, outcome: "no_violation", actions: [] }, { snapshot: digest, facts: null, reason: null, legalReference: null })).toMatchObject({ ground: null, ruleId: null, factsDigest: null, reasonDigest: null, actions: [] });
    expect(decisionParamsOf(view, { ...draft, outcome: "no_violation", actions: [] }, { snapshot: digest, facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: "cc".repeat(32) })).toMatchObject({ ground: null, ruleId: null, factsDigest: "aa".repeat(32), reasonDigest: "bb".repeat(32), legalReferenceDigest: null });
    // What the contracts refuse is refused here, before any key is asked: a restriction without a measure's texts.
    expect(() => decisionParamsOf(view, draft, { snapshot: digest, facts: null, reason: null, legalReference: null })).toThrow();
  });

  test("the terrorist-content checkbox is offered only with the ground of the law", () => {
    const TERROR = "Terrorist content (Regulation (EU) 2021/784, Article 2(7))";
    expect(composer(postCase(), MODERATOR, { kind: "final", ground: "illegal" })).toContain(TERROR);
    expect(composer(postCase(), MODERATOR, { kind: "final", ground: "incompatible" })).not.toContain(TERROR);
  });

  test("the source the preview names is the one the database will record: a notice, a report or the moderator's own finding, from the items the decision considers", () => {
    expect(predictedSource(postCase(), "final")).toBe("notice");
    expect(predictedSource(postCase({ items: [item()], intakeSeq: 1 }), "final")).toBe("report");
    expect(predictedSource(postCase({ items: [item({ source: SOURCES.staff })], intakeSeq: 1 }), "interim")).toBe("own_initiative");
    // An answered notice is no longer considered.
    expect(predictedSource(postCase({ answeredSeq: 2, intakeSeq: 3, items: [item({ outcome: "no_violation", answeredBy: "x" }), item({ id: ITEM_NOTIFIER, seq: 2, allegesIllegal: true, outcome: "no_violation", answeredBy: "x", source: SOURCES.notifier }), item({ id: ITEM_FINDING, seq: 3, source: SOURCES.staff })] }), "final")).toBe("own_initiative");
  });
});

describe("the preview", () => {
  test("is the statement exactly as the author will receive it, from the drafts: the same function renders both", () => {
    const view = postCase();
    const draft: CaseDraft = {
      ...newDraft(caseId(view.id), view, MODERATOR),
      kind: "final",
      ruleId: "R6",
      category: RULE_DEFAULT_CATEGORY.R6,
      actions: [{ kind: "remove", mediaId: null }],
      written: { facts: "The post offers followers for money.", reason: "That is a deceptive scheme.", legal_reference: "", review_reason: "" },
    };
    const input = previewOf(view, draft, NOW);
    expect(input).toMatchObject({ kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R6", rulesVersion: RULES_VERSION, redressVersion: REDRESS_VERSION, source: "notice", decidedAt: NOW.toISOString(), post: { createdAt: "2026-09-30T12:00:00.000Z" } });
    const out = composer(view, MODERATOR, draft);
    for (const paragraph of statementParagraphs(input)) expect(out, paragraph.slice(0, 50)).toContain(paragraph.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;"));
    expect(out).toContain("korbat removed your post of 2026-09-30 12:00 UTC: other people can no longer see it.");
    expect(out).toMatch(/<h4[^>]*>Preview: the statement as its author will receive it<\/h4>/);
    // A text someone could have copied in is only ever text.
    const hostile = composer(view, MODERATOR, { ...draft, written: { ...draft.written, facts: "<script>alert(1)</script>" } });
    expect(hostile).toContain(HOSTILE_ESCAPED.script);
    expect(hostile).not.toContain("<script>");
    expect(hrefs(hostile)).toEqual([]);
  });

  test("says which measures taken while deciding end with a final decision: every one with the decision that closes the case, a seal with the admin's answer", () => {
    // The fixture's interim withhold is in force; a final decision through the newest item closes the case and ends it.
    const view = postCase();
    const closing = previewOf(view, { ...newDraft(caseId(view.id), view, MODERATOR), kind: "final", outcome: "no_violation" }, NOW);
    expect(closing.endedMeasures).toEqual([{ kind: "withhold", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }]);
    expect(statementParagraphs(closing)[0]).toBe(STATEMENT_WORDS.ended(MEASURES.withhold.label));
    // A decision taken while deciding ends nothing.
    expect(previewOf(view, newDraft(caseId(view.id), view, MODERATOR), NOW).endedMeasures).toEqual([]);
    // The seal taken while deciding ends with the admin's answer, also when the case stays open; not when the answer seals for good.
    const sealedCase = rangeCase({ decisions: frozenCase().decisions });
    const answer = previewOf(sealedCase, { ...newDraft(caseId(sealedCase.id), sealedCase, ADMIN), kind: "final", outcome: "no_violation" }, NOW);
    expect(answer.endedMeasures.map((ended) => ended.kind)).toEqual(["seal_media"]);
    const forGood = previewOf(sealedCase, withSeal(sealedCase, { ...newDraft(caseId(sealedCase.id), sealedCase, ADMIN), kind: "final" }), NOW);
    expect(forGood.endedMeasures).toEqual([]);
  });

  test("a final decision that leaves the case open may lift a withhold taken while deciding: Lift beside each", () => {
    const withheld = rangeCase({ decisions: [decision()] });
    expect(liftable(withheld)).toEqual([{ kind: "restore", mediaId: null }]);
    const out = composer(withheld, ADMIN, { kind: "final", outcome: "no_violation" });
    expect(out).toContain(`Lift: ${MEASURES.withhold.label}`);
    // A decision that closes the case ends the withhold anyway, and one taken while deciding lifts nothing here.
    expect(composer(postCase(), MODERATOR, { kind: "final", outcome: "no_violation" })).not.toContain("Lift: ");
    expect(composer(withheld, ADMIN, { kind: "interim" })).not.toContain("Lift: ");
  });
});

describe("lifting and correcting", () => {
  const sealAction = frozenCase().decisions[0]!.actions[0]!;
  const interimSeal: CaseDecision = decision({ ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", suspect: true, actions: [sealAction] });
  const finalRemoval: CaseDecision = decision({ id: "9daebfc0-d1e2-43f4-9560-8b9cadbecfd0", kind: "final", throughSeq: 2, answersFromSeq: 1, actions: [{ ...decision().actions[0]!, kind: "remove" }] });

  test("beside each decision taken while deciding with a measure in force: Lift what was done while deciding, for anyone eligible", () => {
    const view = postCase();
    expect(correctable(view, view.decisions[0]!, MODERATOR)).toEqual({ label: "Lift what was done while deciding", measures: view.decisions[0]!.actions });
    expect(html(<CorrectControl view={view} decision={view.decisions[0]!} role={MODERATOR} disabled={false} onCorrect={noop} />)).toContain(">Lift what was done while deciding</button>");
    // A measure that is no longer in force leaves nothing to lift.
    const ended = decision({ actions: [{ ...decision().actions[0]!, inForce: false }] });
    expect(correctable(postCase({ decisions: [ended] }), ended, ADMIN)).toBeNull();
    expect(html(<CorrectControl view={postCase({ decisions: [ended] })} decision={ended} role={ADMIN} disabled={false} onCorrect={noop} />)).toBe("");
  });

  test("beside each final restriction with a measure in force: Correct this decision, for admins only where the decision needed one", () => {
    const view = postCase({ decisions: [finalRemoval] });
    expect(correctable(view, finalRemoval, MODERATOR)?.label).toBe("Correct this decision");
    const adminOnly = { ...finalRemoval, needsAdmin: true };
    expect(correctable(postCase({ decisions: [adminOnly] }), adminOnly, MODERATOR)).toBeNull();
    expect(correctable(postCase({ decisions: [adminOnly] }), adminOnly, ADMIN)?.label).toBe("Correct this decision");
    // A decision that restricted nothing, and a correction itself, are not corrected.
    const noAction = decision({ kind: "final", outcome: "no_violation", actions: [] });
    expect(correctable(postCase({ decisions: [noAction] }), noAction, ADMIN)).toBeNull();
  });

  test("Lift the seal is offered to an admin only, inside the correction, with when a seal may be lifted", () => {
    const view = rangeCase({ decisions: [interimSeal] });
    // A moderator may lift what a decision did while deciding, but never its seal: with nothing else to lift, nothing is offered.
    expect(correctable(view, interimSeal, MODERATOR)).toBeNull();
    expect(correctable(view, interimSeal, ADMIN)?.measures.map((measure) => measure.kind)).toEqual(["seal_media"]);
    const draft = correctionDraft(caseId(view.id), view, interimSeal, ADMIN);
    expect(draft).toMatchObject({ kind: "correction", reviewsDecisionId: interimSeal.id, actions: [] });
    const out = composer(view, ADMIN, { ...draft, actions: [{ kind: "unseal_media", mediaId: null }] });
    expect(out).toContain(MEASURES.unseal_media.label);
    expect(out).toContain("Lift a seal taken while deciding only when it was taken in error: on the wrong case, or on a report that gives no reason to believe it.");
    // A seal for good: the sentence of the review composer on the reason.
    const forGood = { ...interimSeal, kind: "final" as const, needsAdmin: true, throughSeq: 2, answersFromSeq: 1 };
    const good = composer(rangeCase({ decisions: [forGood] }), ADMIN, { ...correctionDraft(caseId(view.id), rangeCase({ decisions: [forGood] }), forGood, ADMIN), actions: [{ kind: "unseal_media", mediaId: null }] });
    expect(good).toContain(
      "A seal for good is lifted only on the authority's answer that the images are not child sexual abuse material. Say in the reason that the authority has answered, and the date of its answer. Never write its reference or anything that names a person: the reference stays in the operator's records, off the server.".replace(/'/g, "&#x27;"),
    );
    // A moderator's correction of a decision that holds a seal beside a withhold offers the withhold alone.
    const both = decision({ actions: [decision().actions[0]!, sealAction] });
    expect(correctable(rangeCase({ decisions: [both] }), both, MODERATOR)?.measures.map((measure) => measure.kind)).toEqual(["withhold"]);
  });

  test("a correction's params: reversals only, the corrected decision's category and rules version, its own reason, and reversed only when nothing of the decision stays in force", () => {
    const two = decision({ kind: "final", rulesVersion: 1, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD", throughSeq: 2, answersFromSeq: 1, actions: [{ ...decision().actions[0]!, kind: "remove" }, { ...decision().actions[0]!, id: "c0d1e2f3-0415-4627-8893-becfd0e1f203", kind: "remove_media", mediaId: IMAGE_ONE }] });
    const view = postCase({ decisions: [two] });
    const draft = correctionDraft(caseId(view.id), view, two, MODERATOR);
    const part = decisionParamsOf(view, { ...draft, actions: [{ kind: "restore", mediaId: null }] }, { snapshot: HEX, facts: null, reason: "bb".repeat(32), legalReference: null });
    expect(part).toMatchObject({ kind: "correction", reviewsDecisionId: two.id, throughSeq: 0, outcome: "partly_reversed", ground: null, ruleId: null, rulesVersion: 1, redressVersion: REDRESS_VERSION, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD", categoryKeyword: null, factsDigest: null, legalReferenceDigest: null, reasonDigest: "bb".repeat(32), actions: [{ kind: "restore", mediaId: null }] });
    const all = decisionParamsOf(view, { ...draft, actions: [{ kind: "restore_media", mediaId: IMAGE_ONE }, { kind: "restore", mediaId: null }] }, { snapshot: HEX, facts: null, reason: "bb".repeat(32), legalReference: null });
    expect(all).toMatchObject({ outcome: "reversed", actions: [{ kind: "restore", mediaId: null }, { kind: "restore_media", mediaId: IMAGE_ONE }] });
    expect(CaseDecidedParams.safeParse(all).success).toBe(true);
    // The preview of a correction renders the corrected decision's rule from its own version.
    const preview = statementParagraphs(previewOf(view, { ...draft, actions: [{ kind: "restore", mediaId: null }], written: { ...draft.written, review_reason: "The post is satire." } }, NOW));
    expect(preview[0]).toBe(STATEMENT_WORDS.corrected("2026-10-01 09:00 UTC", true));
    expect(preview).toContain(`That decision rested on korbat rule R1, "${getRule("R1", 1)!.title}": ${getRule("R1", 1)!.text}`);
    expect(preview).toContain("Why korbat changed it: The post is satire.");
  });
});

describe("the decision, confirmed by the key", () => {
  const view = postCase({ decisions: [] });
  const base: CaseDraft = { ...newDraft(caseId(view.id), view, MODERATOR), actions: [{ kind: "withhold", mediaId: null }], written: { facts: "The post offers followers for money.", reason: "That is spam.", legal_reference: "", review_reason: "" } };
  const after = postCase({ stateVersion: 4, decisions: [decision()] });

  /** The whole exchange against a fake API: the saves, /me, the options (bound to whatever `bind` says), and the decision. */
  async function run(options: { bind?: (action: ReturnType<typeof decisionAction>) => ReturnType<typeof decisionAction> | object; decision?: { status: number; body: unknown }; view?: CaseView; draft?: CaseDraft } = {}) {
    const saves: { kind: string; text: string; salt: string; digest: string }[] = [];
    let action: ReturnType<typeof decisionAction> | null = null;
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe() },
      [`POST /api/staff/cases/${CASE_POST}/decisions`]: options.decision ?? { status: 201, body: after },
      [`POST /api/staff/cases/${CASE_POST}/snapshots`]: { status: 200, body: { id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", digest: HEX } },
      [`GET /api/staff/cases/${CASE_POST}`]: { status: 200, body: view },
    });
    // The saves answer the digest that was sent, and the options bind the action the page sent, unless a test says otherwise.
    const fetch: typeof fake.fetch = async (input, init) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      if (input === `/api/staff/cases/${CASE_POST}/texts` && init?.method === "POST") {
        await fake.fetch(input, init);
        saves.push(body as (typeof saves)[number]);
        return new Response(JSON.stringify({ id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", digest: body!.digest }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (input === "/api/staff/step-up/options") {
        await fake.fetch(input, init);
        action = body as ReturnType<typeof decisionAction>;
        const bound = options.bind ? options.bind(action) : action;
        return new Response(JSON.stringify(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, bound as never))), { status: 200, headers: { "content-type": "application/json" } });
      }
      return fake.fetch(input, init);
    };
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
    const outcome = await confirmDecision({ api, credentials, random: (length) => new Uint8Array(length).fill(7) }, caseId(CASE_POST), options.view ?? view, options.draft ?? base);
    return { outcome, credentials, requests: fake.requests, saves, action: action as ReturnType<typeof decisionAction> | null };
  }

  test("the texts are saved first, the key confirms params built from the console's own digests, and the answer is the case as it now stands", async () => {
    const done = await run();
    expect(done.outcome).toEqual({ view: after });
    expect(done.credentials.calls).toHaveLength(1);
    expect(done.saves.map((save) => save.kind)).toEqual(["facts", "reason"]);
    const salt = "07".repeat(32);
    const [facts, reason] = [await textDigest(salt, "The post offers followers for money."), await textDigest(salt, "That is spam.")];
    const shown = view.snapshots[0]!;
    if (shown.withheld) throw new Error("the fixture's newest snapshot shows its content");
    expect(done.action).toEqual({
      action: "case_decided",
      target: { type: "case", id: CASE_POST },
      params: decisionParamsOf(view, base, { snapshot: await shownSnapshotDigest(shown), facts, reason, legalReference: null }),
    });
    const sent = done.requests.at(-1)!;
    expect(`${sent.method} ${sent.url} ${sent.headers["x-staff-activity"]}`).toBe(`POST /api/staff/cases/${CASE_POST}/decisions 1`);
    expect(sent.body).toMatchObject({ ...done.action!.params, stepUp: { type: "public-key" } });
    // Every request was the person's own.
    expect(done.requests.filter((request) => request.headers["x-staff-activity"] !== "1")).toEqual([]);
  });

  test("options that bind other params, another case or another action are refused before the key is asked, and no decision is sent", async () => {
    const binds: ((action: ReturnType<typeof decisionAction>) => object)[] = [
      (action) => ({ ...action, params: { ...action.params, category: "STATEMENT_CATEGORY_VIOLENCE" } }),
      (action) => ({ ...action, params: { ...action.params, actions: [{ kind: "remove", mediaId: null }] } }),
      (action) => ({ ...action, target: { type: "case", id: CASE_FROZEN } }),
      () => ({ action: "staff_session_revoked", target: { type: "staff_session", id: CASE_POST }, params: {} }),
    ];
    for (const bind of binds) {
      const done = await run({ bind });
      expect(done.outcome).toEqual({ error: new StepUpMismatch().message, code: "step_up_mismatch" });
      expect(done.credentials.calls).toEqual([]);
      expect(done.requests.some((request) => request.url.endsWith("/decisions"))).toBe(false);
    }
  });

  test("a refusal is worded in the console's words, in place, and nothing is thrown: the draft is the caller's to keep", async () => {
    for (const code of ["case_changed", "profile_changed", "staff_recused", "staff_target", "admin_required", "decision_cap", "snapshot_mismatch", "snapshot_erased", "text_not_found", "invalid_decision"] as const) {
      const done = await run({ decision: { status: 409, body: envelope(code) } });
      expect(done.outcome, code).toEqual({ error: MODERATION_MESSAGES[code], code });
    }
  });

  test("a save answered with another digest ends the decision there: the key is never asked", async () => {
    const fake = fakeFetch({ [`POST /api/staff/cases/${CASE_POST}/texts`]: { status: 201, body: { id: "bfc0d1e2-f304-4516-b782-adbecfd0e1f2", digest: "ee".repeat(32) } } });
    const credentials = fakeCredentials();
    const outcome = await confirmDecision({ api: createStaffApi({ fetch: fake.fetch, cookie: () => "" }), credentials }, caseId(CASE_POST), view, base);
    expect(outcome).toMatchObject({ code: "invalid_answer" });
    expect(credentials.calls).toEqual([]);
    expect(fake.requests.map((request) => request.url)).toEqual([`/api/staff/cases/${CASE_POST}/texts`]);
  });

  test("a restriction without its facts or its reason, or a decision without a measure, is not sent at all", async () => {
    const empty = await run({ draft: { ...base, written: { ...base.written, facts: "  " } } });
    expect(empty.outcome).toEqual({ error: COMPOSER.incomplete, code: "incomplete" });
    expect(empty.requests).toEqual([]);
    const bare = await run({ draft: { ...base, actions: [] } });
    expect(bare.outcome).toEqual({ error: COMPOSER.incomplete, code: "incomplete" });
    expect(bare.requests).toEqual([]);
  });

  test("a case whose newest snapshot is withheld gets a fresh one first, and the page shows it before anything is confirmed", async () => {
    const hidden = postCase({ decisions: [], snapshots: [{ id: "8c9daebf-c0d1-42e3-845f-7a8b9cadbecf", takenAt: "2026-10-01T08:00:00.000Z", digest: HEX, withheld: true }] });
    const done = await run({ view: hidden });
    expect(done.outcome).toEqual({ fresh: view, notice: COMPOSER.freshSnapshot });
    expect(done.credentials.calls).toEqual([]);
    expect(done.requests.map((request) => `${request.method} ${request.url}`)).toEqual([`POST /api/staff/cases/${CASE_POST}/snapshots`, `GET /api/staff/cases/${CASE_POST}`]);
  });

  test("the action is the case with params of ids, enums, numbers and digests, and nothing typed", () => {
    const params = decisionParamsOf(view, base, { snapshot: HEX, facts: HEX, reason: HEX, legalReference: null });
    expect(decisionAction(CASE_POST, params)).toEqual({ action: "case_decided", target: { type: "case", id: CASE_POST }, params });
    expect(() => decisionAction(CASE_POST.toUpperCase(), params)).toThrow();
    expect(() => decisionAction(CASE_POST, { ...params, facts: "free text" } as never)).toThrow();
    expect(typeof decideWithKey).toBe("function");
  });
});

describe("the fixtures of these tests", () => {
  test("are cases as the contracts describe them", () => {
    for (const view of [rangeCase(), sealableAccount(), postCase({ snapshots: [postSnapshot()] })]) expect(CaseView.safeParse(view).success, view.id).toBe(true);
    expect([CASE_ACCOUNT, CASE_FROZEN].every((id) => parseCaseId(id) !== null)).toBe(true);
  });
});
