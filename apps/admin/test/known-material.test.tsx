import { AUTOMATION_RULES, MATCH_ANSWER_REASON_LABELS, ORDER_RULES, SEAL_DRAFTS, UPLOAD_END_REASON_LABELS, type CaseView, type HeldUpload, type MatchRecord, type RestoreGap, type StaffMe } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { answerReasonNeeded, confirmDecision, decisionParamsOf, matchSealFacts, newDraft, previewOf, programStatementOf, restrictsOnMatch, sealDraftFor } from "../src/compose";
import { AUTOMATION_WORDS, CONSOLE_MODERATION_CODES, CUSTODY_WORDS, MODERATION_MESSAGES, RECOVERY_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { CustodyLines } from "../src/screens/Home";
import { marksOf } from "../src/screens/Queue";
import { RestoreScreen, type RestoreScreenProps } from "../src/screens/Restore";
import { endsOffered, holdEndParams, stateLine, UploadBlock, uploadReleaseParams, UploadsView, type UploadsActions } from "../src/screens/Uploads";
import { bothTimes } from "../src/ui";
import { CASE_FROZEN, CASE_POST, IMAGE_ONE, IMAGE_TWO, LOOKALIKE, NO_STANDING, SOURCES, decision, frozenCase, item, overview, postCase, queueRow } from "./case-fixtures";
import { HOSTILE } from "./fixtures";

/**
 * Known material on the console (3d design, sections 8.1 to 8.4, 8.6 to 8.8; Task 7), server-rendered: a match's record on
 * a case in its three kinds, with the source's strings framed; an image a match names, closed with no reveal control,
 * also after an answer without a seal; the queue's chip; the answer without a seal that asks for its reason; the
 * composer's [case.autoRecord] for a partly automated decision and [case.liftedMatch]; a program's seal with [case.autoR2]
 * and the statement its author was sent; Held uploads with neither end chosen; Home's lines; and [restore.holdEnd].
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
const AT = "2026-10-19T09:15:00.000Z";
const NOW = new Date("2026-10-19T11:00:00.000Z");
const ADMIN: StaffMe["role"] = "admin";
const MODERATOR: StaffMe["role"] = "moderator";
const ITEM_MATCH = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
const DECISION_SEAL = "0e1f2a3b-4c5d-4e6f-9a7b-8c9d0e1f2a3b";
const REFUSAL = "1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c";
const LEAVE = "2a3b4c5d-6e7f-4a8b-9c9d-0e1f2a3b4c5d";

/** A match's record with a third party's hostile strings: a bidirectional override, a look-alike label, a script address. */
const record = (more: Partial<MatchRecord> = {}): MatchRecord => ({
  source: HOSTILE.bidi,
  listVersion: LOOKALIKE.label,
  hashType: "sha256",
  matchKind: "exact",
  classification: HOSTILE.url,
  listed: true,
  acting: true,
  queriedAt: AT,
  ...more,
});

/** A post's case a match opened on its first image: an acting or near match cites R2 and freezes; a flag cites no rule. */
function matchCase(match: MatchRecord, more: Partial<CaseView> = {}): CaseView {
  const listed = match.listed;
  return (listed ? frozenCase : postCase)({
    items: [item({ id: ITEM_MATCH, source: SOURCES.program, explanation: null, mediaId: IMAGE_ONE, ruleId: listed ? "R2" : null, csam: listed, suspect: listed, lane: listed ? 0 : 2 })],
    intakeSeq: 1,
    decisions: [],
    signals: [{ itemId: ITEM_MATCH, kind: "known_match", thresholdVersion: null, match }],
    matchedImages: [IMAGE_ONE],
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

describe("a match's record on a case (8.4)", () => {
  test("[case.match] as label and value, the source's three strings framed and escaped, never a hash value; [case.matchWeak] by the hash type", () => {
    const out = page(matchCase(record({ hashType: "md5" })));
    const shown = text(out);
    const M = AUTOMATION_WORDS.match;
    for (const label of [M.source, M.listVersion, M.hashType, M.matchKind, M.classification, M.queriedAt]) expect(shown).toContain(label);
    // Each string a source wrote stands in a frame "As the source returned it", and none is markup or a link.
    expect(shown.split(M.frame).length - 1).toBe(3);
    expect(out).not.toContain('href="javascript:');
    expect(shown).toContain(LOOKALIKE.label);
    expect(shown).toContain(bothTimes(AT));
    expect(shown).toContain(M.weak("md5")!);
    expect(M.weak("md5")).toBe("A file with the same MD5 as another can be made on purpose by whoever made both files.");
    expect(M.weak("sha1")).toBe("A file with the same SHA-1 as another can be made on purpose by whoever made both files.");
    expect(M.weak("pdq")).toBe("A perceptual hash describes how a picture looks. Two different pictures can have the same one, by accident or on purpose.");
    expect(M.weak("sha256")).toBeNull();
    expect(text(page(matchCase(record())))).not.toContain("can be made on purpose");
    expect(shown).toContain(M.what);
    expect(shown).toContain("Source: Found by a program");
  });

  test("the three kinds: acting with [case.matchActing] and 3c's banner; listed and not exact with [case.matchNear] and the banner; another class with [case.matchFlag] and no banner", () => {
    const M = AUTOMATION_WORDS.match;
    const acting = text(page(matchCase(record())));
    expect(acting).toContain(M.acting);
    expect(acting).not.toContain(M.near);
    const near = text(page(matchCase(record({ matchKind: "near", acting: false }))));
    expect(near).toContain(M.near);
    expect(near).not.toContain(M.acting);
    const flag = page(matchCase(record({ listed: false, acting: false, classification: "other-class" })));
    expect(text(flag)).toContain(M.flag);
    expect(flag).not.toContain("banner suspect");
    expect(page(matchCase(record()))).toContain("banner suspect");
    expect(page(matchCase(record({ matchKind: "near", acting: false })))).toContain("banner suspect");
  });

  test("[case.image.matched] in the place of a matched image, with no reveal control, before an answer and after an answer without a seal; the other image is offered as before", () => {
    const before = page(matchCase(record()));
    expect(text(before)).toContain(AUTOMATION_WORDS.imageMatched);
    expect(before).not.toContain("Show image");
    // After an answer without a seal the images are served to everyone again: the matched one stays closed to staff.
    const after = page(matchCase(record(), { imagesAllowed: true, suspicion: null, items: [item({ id: ITEM_MATCH, source: SOURCES.program, explanation: null, mediaId: IMAGE_ONE, ruleId: "R2", csam: true, suspect: true, outcome: "no_violation", answeredBy: DECISION_SEAL })] }));
    expect(text(after)).toContain(AUTOMATION_WORDS.imageMatched);
    expect(after.split(">Show image<").length - 1).toBe(1);
    expect(MODERATION_MESSAGES.image_matched).toBe(AUTOMATION_WORDS.imageMatched);
    expect(AUTOMATION_WORDS.imageMatched).toBe("Not opened: this image matched a list of known material. Nobody at korbat opens it, also after an answer without a seal.");
    void IMAGE_TWO;
  });

  test("a program's seal on a match: [case.auto] with the statement its author was sent, worded for a match, and [case.autoR2] while it is in force", () => {
    const sealing = decision({
      id: DECISION_SEAL,
      byProgram: true,
      staffHandle: null,
      source: "own_initiative",
      kind: "interim",
      ruleId: "R2",
      rulesVersion: 3,
      redressVersion: 4,
      suspect: true,
      decidedAt: AT,
      facts: null,
      reason: null,
      actions: [{ id: "3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e", kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 2, deletedPosts: 0, list: [] }, ...NO_STANDING }],
    });
    const view = matchCase(record({ source: "Example Hotline" }), { decisions: [sealing] });
    const shown = text(page(view));
    expect(shown).toContain(AUTOMATION_WORDS.caseAutoR2);
    expect(shown).toContain(STATEMENT_WORDS.automated.until.match);
    expect(shown).toContain(REDRESS_TEXTS[4].askAdmin!);
    expect(statementParagraphs(programStatementOf(view, sealing))).toContain(STATEMENT_WORDS.automated.notAssessed("csam", "exact"));
    const lifted = text(page(matchCase(record(), { decisions: [{ ...sealing, actions: sealing.actions.map((action) => ({ ...action, inForce: false })) }] })));
    expect(lifted).not.toContain(AUTOMATION_WORDS.caseAutoR2);
  });
});

describe("the queue (8.3)", () => {
  test("[queue.matchFlag] after the program's chips; it moves nothing", () => {
    expect(marksOf(queueRow({ matchFlag: true }))).toEqual(["notice under Art. 16", AUTOMATION_WORDS.queueMatchFlag]);
    expect(AUTOMATION_WORDS.queueMatchFlag).toBe("A match that only flags");
    expect(marksOf(queueRow())).not.toContain(AUTOMATION_WORDS.queueMatchFlag);
  });
});

describe("the composer on a case a match opened (8.4)", () => {
  const draftOf = (view: CaseView, role: StaffMe["role"], more: Partial<ReturnType<typeof newDraft>> = {}) => ({ ...newDraft(parseCaseId(view.id)!, view, role), ...more });
  const composer = (view: CaseView, role: StaffMe["role"], more: Partial<ReturnType<typeof newDraft>> = {}) => {
    const props: ComposerViewProps = { view, role, draft: draftOf(view, role, more), now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
    return html(<ComposerView {...props} />);
  };
  const answer = { kind: "final" as const, outcome: "no_violation" as const, actions: [] };

  test("an answer without a seal on an acting match asks for one of the reasons, none chosen; a match that does not act, and a seal, ask for none", () => {
    const view = matchCase(record());
    expect(answerReasonNeeded(view, draftOf(view, ADMIN, answer))).toBe(true);
    const out = composer(view, ADMIN, answer);
    for (const label of Object.values(MATCH_ANSWER_REASON_LABELS)) expect(text(out)).toContain(label);
    expect(out).not.toMatch(/name="compose-match-reason"[^>]*checked/);
    expect(text(out)).toContain(AUTOMATION_WORDS.answerReason.choose);
    expect(answerReasonNeeded(matchCase(record({ matchKind: "near", acting: false })), draftOf(view, ADMIN, answer))).toBe(false);
    expect(answerReasonNeeded(view, draftOf(view, ADMIN, { kind: "final", outcome: "restricted", actions: [{ kind: "seal_media", mediaId: null }] }))).toBe(false);
  });

  test("the key signs the reason only where it is asked for, and a decision without it is refused before any request", async () => {
    const view = matchCase(record());
    const digests = { snapshot: "a".repeat(64), facts: "b".repeat(64), reason: "c".repeat(64), legalReference: null };
    expect(decisionParamsOf(view, draftOf(view, ADMIN, { ...answer, matchAnswerReason: "source_withdrew" }), digests).matchAnswerReason).toBe("source_withdrew");
    // Elsewhere the member is absent, so every other decision's params hash as they did before Task 7.
    const plain = postCase();
    expect("matchAnswerReason" in decisionParamsOf(plain, draftOf(plain, ADMIN, { kind: "interim", outcome: "restricted", actions: [{ kind: "withhold", mediaId: null }] }), digests)).toBe(false);
    let asked = 0;
    const api = new Proxy({}, { get: () => () => (asked++, Promise.reject(new Error("no request may be sent"))) });
    const outcome = await confirmDecision({ api: api as never, credentials: { get: () => Promise.reject(new Error("no key")) } as never }, parseCaseId(view.id)!, view, { ...draftOf(view, ADMIN, answer), written: { facts: "The record is the source's word.", reason: "", legal_reference: "", review_reason: "" } });
    expect(outcome).toEqual({ error: AUTOMATION_WORDS.answerReason.choose, code: "incomplete" });
    expect(asked).toBe(0);
  });

  test("[case.autoRecord] gains its second sentence for an admin who restricts on a match's finding citing R2, and the preview is partly automated", () => {
    const view = matchCase(record({ source: "Example Hotline" }));
    const seal = { kind: "final" as const, outcome: "restricted" as const, ruleId: "R2" as const, actions: [{ kind: "seal_media" as const, mediaId: null }] };
    expect(restrictsOnMatch(view, draftOf(view, ADMIN, seal))).toBe(true);
    expect(text(composer(view, ADMIN, seal))).toContain(`${AUTOMATION_WORDS.caseAutoRecord} ${AUTOMATION_WORDS.caseAutoRecordPartly}`);
    expect(text(composer(view, ADMIN, answer))).not.toContain(AUTOMATION_WORDS.caseAutoRecordPartly);
    const preview = previewOf(view, draftOf(view, ADMIN, seal), NOW);
    expect(preview).toMatchObject({ automatedDetection: true, automatedDecision: "partially", signal: { kind: "known_match", source: "Example Hotline", matchKind: "exact", listedAs: "csam" } });
    expect(statementParagraphs(preview).join(" ")).toContain("this decision rests on them in part");
    // A flag of another class is never partly automated: it cites no rule.
    const flag = matchCase(record({ listed: false, acting: false }));
    expect(restrictsOnMatch(flag, draftOf(flag, ADMIN, { kind: "final", outcome: "restricted", ruleId: "R1", actions: [{ kind: "remove", mediaId: null }] }))).toBe(false);
  });

  test("[case.liftedMatch] in the place of 3c's sentence on a case that holds a match; the seal's facts draft is W.3's comparison about this post", () => {
    const view = matchCase(record({ source: "Example Hotline" }));
    const shown = text(composer(view, ADMIN, answer));
    expect(shown).toContain(AUTOMATION_WORDS.liftedMatch);
    expect(shown).not.toContain("whoever is on duty opens the case's target the same day");
    expect(text(composer(frozenCase(), ADMIN, answer))).toContain("whoever is on duty opens the case's target the same day");
    const facts = matchSealFacts(view)!;
    expect(facts).toBe(
      "An automated comparison found that an image of this post has the same fingerprint as one that Example Hotline has classified as child sexual abuse material. korbat's staff do not open such an image, and korbat has not assessed it.",
    );
    expect(SEAL_DRAFTS.facts.match_post).toContain("{comparison}");
    expect(sealDraftFor(view, "final").facts).toBe(facts);
    // A case with a person's report of such material keeps 3c's draft.
    expect(matchSealFacts(frozenCase({ signals: [] }))).toBeNull();
    void CASE_FROZEN;
  });
});

describe("Held uploads (8.6)", () => {
  const upload = (more: Partial<HeldUpload> = {}): HeldUpload => ({
    id: REFUSAL,
    refusedAt: AT,
    match: record(),
    otherRefusals: 2,
    uploaderGone: false,
    objection: null,
    objectedAt: null,
    endedAt: null,
    endAs: null,
    endReason: null,
    deletesAt: null,
    reported: false,
    quarantined: false,
    release: null,
    ...more,
  });
  const actions = (role: StaffMe["role"]): UploadsActions => ({ role, busy: null, errors: {}, onEnd: noop, onRelease: noop });
  const block = (more: Partial<HeldUpload> = {}, role: StaffMe["role"] = ADMIN) => html(<UploadBlock upload={upload(more)} actions={actions(role)} />);
  const W = CUSTODY_WORDS.uploads;

  test("a held refusal: its time, the match's record with [case.matchActing], [uploads.others], the state, and the two ends side by side with neither chosen nor focused", () => {
    const out = block();
    const shown = text(out);
    expect(shown).toContain(W.refusedAt(bothTimes(AT)));
    expect(shown).toContain(AUTOMATION_WORDS.match.acting);
    expect(shown).toContain(W.others(2));
    expect(shown).toContain(W.state.open);
    expect(shown).toContain(`${W.report.label}: ${W.report.what}`);
    expect(shown).toContain(`${W.noReport.label}: ${W.noReport.what}`);
    expect(out).not.toMatch(/type="radio"[^>]*checked/);
    expect(out).not.toMatch(/autofocus/i);
    expect(out).not.toMatch(/<img|src=/);
    // The confirmation waits for a choice.
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Confirm with your staff key/);
    // [uploads.unseen] names neither end: it says nothing of which to take.
    expect(W.unseen).not.toMatch(/"Report"|"No report"|Report[.]|No report/);
    expect(W.noReport.what).toContain(`${AUTOMATION_RULES.noReportHours} hours from now`);
  });

  test("[uploads.gone]; an objection after Report under the state line, framed; the end's reasons; the state lines; greyed for a moderator", () => {
    expect(text(block({ uploaderGone: true }))).toContain(W.gone);
    expect(W.gone).toContain(`up to ${ORDER_RULES.reportHoldDays} days from the refusal`);
    const objected = block({ endAs: "report", endedAt: AT, reported: true, objection: HOSTILE.script, objectedAt: NOW.toISOString() });
    expect(text(objected)).toContain(W.state.report(bothTimes(AT), true, false));
    expect(text(objected)).toContain(W.objection.lead(bothTimes(NOW.toISOString())));
    expect(text(objected)).toContain(W.objection.by);
    expect(objected).not.toContain("<script>");
    const ended = upload({ endAs: "no_report", endReason: "counsel_no_duty", endedAt: AT, deletesAt: NOW.toISOString() });
    expect(stateLine(ended)).toBe(W.state.noReport(bothTimes(AT), UPLOAD_END_REASON_LABELS.counsel_no_duty, bothTimes(NOW.toISOString())));
    expect(text(block({}, MODERATOR))).toContain(W.adminOnly);
    expect(block({}, MODERATOR)).toMatch(/<fieldset disabled=""/);
  });

  test("which ends stay open, and what the key signs: neither end is a default and No report needs its reason", () => {
    expect(endsOffered(upload())).toEqual(["report", "no_report"]);
    expect(endsOffered(upload({ endAs: "report", endedAt: AT }))).toEqual(["no_report"]);
    expect(endsOffered(upload({ endAs: "no_report", endReason: "other", endedAt: AT, deletesAt: NOW.toISOString() }), NOW.getTime() - 1000)).toEqual(["report"]);
    expect(endsOffered(upload({ endAs: "no_report", endReason: "other", endedAt: AT, deletesAt: AT }), NOW.getTime())).toEqual([]);
    expect(holdEndParams(null, null)).toBeNull();
    expect(holdEndParams("no_report", null)).toBeNull();
    expect(holdEndParams("no_report", "source_withdrew")).toEqual({ endAs: "no_report", reason: "source_withdrew" });
    expect(holdEndParams("report", "other")).toEqual({ endAs: "report", reason: null });
  });

  test("the release block of a hold ended as Report: the leave's facts framed, the control only on a recorded leave, no image; a released one reads its state", () => {
    const release = {
      reported: true,
      theirReference: LOOKALIKE.label,
      answer: null,
      answeredAt: null,
      handedOverAt: null,
      quarantined: true,
      leave: { id: LEAVE, from: "authority" as const, reference: "4 O 1/26", receivedOn: "2026-10-18", untold: false, untoldUntil: null },
      tellHeld: false,
      silenceDays: null,
      releasedAt: null,
      basis: null,
      backupsClearAt: null,
      noticeHeld: null,
    };
    const held = upload({ endAs: "report", endedAt: AT, reported: true, quarantined: true, release });
    expect(uploadReleaseParams(held)).toEqual({ basis: "leave", leaveId: LEAVE, theirReference: "4 O 1/26" });
    const out = html(<UploadBlock upload={held} actions={actions(ADMIN)} />);
    expect(text(out)).toContain(W.releaseSign);
    expect(out).not.toMatch(/<img|src=/);
    expect(uploadReleaseParams(upload({ endAs: "report", endedAt: AT, release: { ...release, leave: null } }))).toBeNull();
    const done = upload({ endAs: "report", endedAt: AT, release: { ...release, releasedAt: NOW.toISOString(), basis: "leave", backupsClearAt: NOW.toISOString(), noticeHeld: false } });
    expect(stateLine(done)).toBe(W.state.released(bothTimes(NOW.toISOString())));
    expect(endsOffered(done)).toEqual([]);
  });

  test("the list: [uploads.what], one block a refusal, no image anywhere; empty, its own sentence", () => {
    const out = html(<UploadsView rows={{ state: "ready", value: [upload(), upload({ id: "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f", uploaderGone: true })] }} more={false} loadingMore={false} onLoadMore={noop} actions={actions(ADMIN)} />);
    expect(text(out)).toContain(W.what);
    expect(out.split('class="panel upload"').length - 1).toBe(2);
    expect(out).not.toMatch(/<img|src=/);
    expect(text(html(<UploadsView rows={{ state: "ready", value: [] }} more={false} loadingMore={false} onLoadMore={noop} actions={actions(ADMIN)} />))).toContain(W.empty);
  });
});

describe("Home (8.2)", () => {
  test("[home.flags], [home.uploads] with the capped sentence and a link to Held uploads, a held upload's release and [home.unreported]; nothing while none applies", () => {
    const out = html(
      <CustodyLines
        overview={overview({
          automated: { waiting: 0, oldestAt: null, objected: 0, oldestObjectionAt: null, flags: 3, cases: [], objectedCases: [] },
          heldUploads: { open: 2, oldest: AT, objected: 1, capped: 4 },
          destructive: [
            { kind: "upload_released", at: AT, caseId: null, refusalId: REFUSAL },
            { kind: "hold_ended_unreported", at: NOW.toISOString(), caseId: null, refusalId: REFUSAL },
          ],
        })}
        now={NOW.getTime()}
        onOpenCase={noop}
        onNavigate={noop}
      />,
    );
    const shown = text(out);
    expect(shown).toContain(AUTOMATION_WORDS.homeFlags(3));
    expect(shown).toContain(CUSTODY_WORDS.homeUploads(2, bothTimes(AT), 1));
    expect(shown).toContain(CUSTODY_WORDS.homeUploadsCapped(4));
    expect(shown).toContain(CUSTODY_WORDS.homeReleasedUpload(bothTimes(AT)));
    expect(shown).toContain(CUSTODY_WORDS.homeUnreported(bothTimes(NOW.toISOString())));
    expect([...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/uploads", "/uploads", "/uploads"]);
    expect(html(<CustodyLines overview={overview()} now={NOW.getTime()} onOpenCase={noop} onNavigate={noop} />)).toBe("");
  });
});

describe("After a restore (8.7) and the messages (8.8)", () => {
  test("a lost end of a hold: its line by how it ended, and [restore.holdEnd] with a link to Held uploads while the refusal is there, without one when it is gone", () => {
    const gap = (present: boolean, id: string): RestoreGap => ({
      id,
      class: "release",
      actedAt: AT,
      action: "upload_hold_ended",
      caseId: null,
      orderId: null,
      itemId: null,
      kinds: [],
      closedAt: null,
      disposition: null,
      closedByDecisionId: null,
      hold: { endAs: present ? "report" : "no_report", present },
    });
    const props: RestoreScreenProps = {
      view: { importedAt: AT, mayOpen: false, retentionMay: true, gaps: [gap(true, "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a"), gap(false, "6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b")], holds: [] },
      role: ADMIN,
      busy: null,
      notice: null,
      error: null,
      onOpenCase: noop,
      onOpenOrder: noop,
      onNotNeeded: noop,
      onNavigate: noop,
    };
    const out = html(<RestoreScreen {...props} />);
    const shown = text(out);
    const C = RECOVERY_WORDS.classes.release;
    expect(shown).toContain(C.holdLine(bothTimes(AT), "report"));
    expect(shown).toContain(C.holdLine(bothTimes(AT), "no_report"));
    expect(C.holdLine("x", "report")).toContain("as Report.");
    expect(shown).toContain(C.holdEnd(true));
    expect(shown).toContain(C.holdEnd(false));
    expect([...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/uploads"]);
    expect(shown).not.toContain(RECOVERY_WORDS.notNeeded);
  });

  test("the console words every code of 3d's held uploads and the matched image", () => {
    for (const code of ["hold_not_open", "invalid_hold_end", "image_matched"] as const) expect(CONSOLE_MODERATION_CODES).toContain(code);
    expect(MODERATION_MESSAGES.hold_not_open).toBe('This hold cannot be ended this way: it is released, it ended as "No report" and its upload is deleted, or it ended the same way already. Read the page again.');
    expect(MODERATION_MESSAGES.invalid_hold_end).toBe('An end as "No report" needs exactly one of its reasons, and an end as "Report" takes none. Nothing changed.');
    void CASE_POST;
  });
});
