import { CaseDecidedParams, REPLY_AIM_HOURS, RULE_DEFAULT_CATEGORY, STANDING_RULES, StandingLists, type CaseDecision, type CaseView, type QueueReply, type StaffMe } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { answerable, answerDraft, decisionParamsOf, newDraft, offeredDraft, previewOf, replyOf, replyState, standingControlState, withAnswer, withdrawable, withdrawDraft, withStanding, type CaseDraft } from "../src/compose";
import { STANDING_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { AppealsView } from "../src/screens/Appeals";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { ComposerView, type ComposerViewProps } from "../src/screens/Composer";
import { OverviewView } from "../src/screens/Home";
import { QueueView, replyWords, type QueueViewProps } from "../src/screens/Queue";
import { StandingView } from "../src/screens/Standing";
import { dateTime } from "../src/ui";
import { CASE_LADDER, CASE_POST, CASE_REPLIED, CASE_WITHDRAW, DECISION_REPLIED, DECISION_WITHDRAW, ladderCase, overview, REPLY_TEXT, repliedCase, withdrawCase } from "./case-fixtures";
import { HOSTILE, hrefs } from "./fixtures";

/**
 * The console's part of announced suspensions, replies and termination (3e design, sections 8.3 and 8.5 to 8.8; Task 4):
 * "Announce a suspension" with its days, "Announce a termination" and "Terminate at once", each offered when the case
 * answer says the database would accept it and greyed with its sentence otherwise ([reports.first] among them); the
 * queue's Replies to answer, which never carry a reply's words; the reply's block on the case page and its answer, Keep
 * or Reverse; "Withdraw it for another measure"; the Standing screen's four lists; the home screen's two lines; and the
 * appeals' order. Pure parts are tested as functions, screens server-rendered.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = () => undefined;
const caseId = (id: string) => parseCaseId(id)!;
const NOW = new Date("2026-10-12T09:30:00.000Z");
const ADMIN: StaffMe["role"] = "admin";
const MODERATOR: StaffMe["role"] = "moderator";
const DIGESTS = { snapshot: "cd".repeat(32), facts: "aa".repeat(32), reason: "bb".repeat(32), legalReference: null };

const final = (view: CaseView, role: StaffMe["role"], change: Partial<CaseDraft> = {}): CaseDraft => ({ ...newDraft(caseId(view.id), view, role), kind: "final", ruleId: "R3", ...change });
const withStandingOf = (view: CaseView, change: Partial<NonNullable<CaseView["standing"]>>): CaseView => ({ ...view, standing: { ...view.standing!, ...change } });

function composer(view: CaseView, role: StaffMe["role"], draft: CaseDraft) {
  const props: ComposerViewProps = { view, role, draft, now: NOW, busy: false, error: null, textErrors: {}, declining: null, onChange: noop, onTextBlur: noop, onSeal: noop, onConfirm: noop, onDeclineOpen: noop, onDeclineChange: noop, onDeclineSave: noop, onDeclineClose: noop, onCancelCorrection: noop };
  return html(<ComposerView {...props} />);
}

/** The case page as a person of this role sees it, with the controls beside each decision. */
function casePage(view: CaseView, role: StaffMe["role"]) {
  const base: CaseScreenViewProps = {
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
    },
  };
  return html(<CaseScreenView {...base} />);
}

/** The decision of a fixture case that holds the measure. */
const decisionOf = (view: CaseView, id: string): CaseDecision => view.decisions.find((decided) => decided.id === id)!;

/** The replied decision with its measure's reply or period changed. */
function repliedWith(change: { reply?: Partial<NonNullable<CaseDecision["actions"][number]["reply"]>>; period?: NonNullable<CaseDecision["actions"][number]["period"]>; needsAdmin?: boolean }): CaseDecision {
  const decided = decisionOf(repliedCase(), DECISION_REPLIED);
  const measure = decided.actions[0]!;
  return {
    ...decided,
    needsAdmin: change.needsAdmin ?? decided.needsAdmin,
    actions: [{ ...measure, reply: { ...measure.reply!, ...change.reply }, period: change.period ?? measure.period }],
  };
}

describe("3e Task 4: the announced measures in the composer of an account case (design, section 8.3)", () => {
  test("the words are the design's, each number printed from STANDING_RULES or REPLY_AIM_HOURS", () => {
    expect(STANDING_WORDS.suspend.label).toBe("Announce a suspension");
    expect(STANDING_WORDS.suspend.short(2)).toBe(`Not open: an announced suspension needs ${STANDING_RULES.ladderStrikes} active strikes. This account has 2.`);
    expect(STANDING_WORDS.terminate.notYet).toContain(`needs ${STANDING_RULES.ladderDays.length} suspensions under the ladder decided in the last ${STANDING_RULES.ladderMemoryDays} days`);
    expect(STANDING_WORDS.terminate.noRepeat).toContain(`a final R5 decision at most ${STANDING_RULES.basisAgeDays} days old`);
    expect(STANDING_WORDS.reply.overAim).toBe(`waiting more than ${REPLY_AIM_HOURS} hours`);
    expect(STANDING_WORDS.lists.reportingRow("someone", 5, 8)).toBe(`@someone: 5 of the 8 rule reports sent in the last ${STANDING_RULES.reportFrameDays} days hold a mark manifestly unfounded.`);
    expect(STANDING_WORDS.home.strikes(2)).toBe(`Accounts at ${STANDING_RULES.ladderStrikes} strikes: 2.`);
    expect(STANDING_WORDS.appealsOrder).toBe("Appeals of a running suspension or of a termination come first.");
  });

  test("each control is open when the case answer says the database would accept it, and greyed with its reason otherwise", () => {
    const view = ladderCase();
    expect(standingControlState(view, MODERATOR, final(view, MODERATOR), "announce")).toEqual({ open: true });
    expect(standingControlState(ladderCase(true), MODERATOR, final(view, MODERATOR), "announce")).toEqual({ open: false, why: "reportsFirst" });
    expect(standingControlState(withStandingOf(view, { live: true }), MODERATOR, final(view, MODERATOR), "announce")).toEqual({ open: false, why: "conflict" });
    expect(standingControlState(withStandingOf(view, { activeStrikes: 2 }), MODERATOR, final(view, MODERATOR), "announce")).toEqual({ open: false, why: "short" });
    expect(standingControlState(withStandingOf(view, { maxDays: null }), MODERATOR, final(view, MODERATOR), "announce")).toEqual({ open: false, why: "stale" });
    // A termination is an admin's: announced at the ladder's end, at once on a second direct threat.
    expect(standingControlState(view, MODERATOR, final(view, MODERATOR), "announceTerminate")).toEqual({ open: false, why: "admin" });
    expect(standingControlState(view, ADMIN, final(view, ADMIN), "announceTerminate")).toEqual({ open: false, why: "notYet" });
    expect(standingControlState(withStandingOf(view, { mayTerminate: true }), ADMIN, final(view, ADMIN), "announceTerminate")).toEqual({ open: true });
    expect(standingControlState(withStandingOf(view, { mayTerminate: true, openReports: true }), ADMIN, final(view, ADMIN), "announceTerminate")).toEqual({ open: false, why: "reportsFirst" });
    expect(standingControlState(view, ADMIN, final(view, ADMIN, { ruleId: "R5" }), "terminateAtOnce")).toEqual({ open: false, why: "noRepeat" });
    expect(standingControlState(withStandingOf(view, { atOnce: ["threat_repeat"] }), ADMIN, final(view, ADMIN, { ruleId: "R5" }), "terminateAtOnce")).toEqual({ open: true });
    expect(standingControlState(withStandingOf(view, { atOnce: ["threat_repeat"] }), ADMIN, final(view, ADMIN, { ruleId: "R2" }), "terminateAtOnce")).toEqual({ open: false, why: "r2" });
    // Not shown at all while deciding, or for an outcome that restricts nothing.
    expect(standingControlState(view, MODERATOR, final(view, MODERATOR, { kind: "interim" }), "announce")).toBeNull();
    expect(standingControlState(view, MODERATOR, final(view, MODERATOR, { outcome: "no_violation" }), "announce")).toBeNull();
  });

  test("the composer shows the announce control with the rung's days and the newest strike's rule, and greys it with [reports.first] while a report waits", () => {
    const view = ladderCase();
    const open = composer(view, MODERATOR, final(view, MODERATOR));
    expect(open).toContain('<input type="checkbox"/> <span>Announce a suspension</span>');
    expect(open).toContain(esc(STANDING_WORDS.suspend.days(3, 1)));
    expect(open).toContain(esc(STANDING_WORDS.suspend.rule("R1")));
    // A moderator is offered no termination: both are greyed with [terminate.admin].
    expect(open).toContain('<input type="checkbox" disabled=""/> <span>Announce a termination</span>');
    expect(open).toContain('<input type="checkbox" disabled=""/> <span>Terminate at once</span>');
    expect(open).toContain(esc(STANDING_WORDS.terminate.admin));
    const waiting = ladderCase(true);
    const greyed = composer(waiting, MODERATOR, final(waiting, MODERATOR));
    expect(greyed).toContain('<input type="checkbox" disabled=""/> <span>Announce a suspension</span>');
    expect(greyed).toContain(esc(STANDING_WORDS.reportsFirst));
    expect(greyed).not.toContain(esc(STANDING_WORDS.suspend.days(3, 1)));
  });

  test("choosing it adds the announced suspension under the newest strike's rule with the drafted facts; the params sign its days and announced true; the preview says nothing is restricted yet", () => {
    const view = ladderCase();
    const draft = withStanding(view, final(view, MODERATOR), "announce", 2);
    expect(draft.actions).toEqual([{ kind: "suspend", mediaId: null, days: 2, announced: true }]);
    expect(draft.ruleId).toBe("R1");
    expect(draft.category).toBe(RULE_DEFAULT_CATEGORY.R1);
    expect(draft.written.facts).toBe(
      "When this was written the account had 3 active strikes. Each was given by a decision that found a breach of a korbat rule in a post, and each of those decisions was sent to the account with its reasons.",
    );
    expect(draft.written.reason).toBe("");
    expect(offeredDraft(view, MODERATOR, draft).actions).toEqual(draft.actions);
    // More days than the rung, another rule than the newest strike's, or a report that waits, lose the measure.
    expect(offeredDraft(view, MODERATOR, { ...draft, actions: [{ kind: "suspend", mediaId: null, days: 4, announced: true }] }).actions).toEqual([]);
    expect(offeredDraft(view, MODERATOR, { ...draft, ruleId: "R3" }).actions).toEqual([]);
    expect(offeredDraft(ladderCase(true), MODERATOR, draft).actions).toEqual([]);
    // At most one measure of the four: a termination chosen after it puts the suspension away.
    expect(withStanding(view, draft, "announceTerminate", null).actions).toEqual([{ kind: "terminate", mediaId: null, days: null, announced: true }]);
    const params = CaseDecidedParams.parse(decisionParamsOf(view, { ...draft, written: { ...draft.written, reason: "Three strikes in two weeks." } }, DIGESTS));
    expect(params).toMatchObject({ kind: "final", outcome: "restricted", ground: "incompatible", ruleId: "R1", actions: [{ kind: "suspend", mediaId: null, days: 2, announced: true }], replaced: false });
    const told = statementParagraphs(previewOf(view, draft, NOW)).join(" | ");
    expect(told).toContain(`${STATEMENT_WORDS.suspendAnnounced(2)} It rests on the active strikes of your account:`);
    expect(told).not.toContain("It breaks korbat rule");
  });
});

describe("3e Task 4: replies, their answer and the withdrawal (design, sections 8.5 and 8.7)", () => {
  test("where a reply stands, and who may answer it", () => {
    const decided = decisionOf(repliedCase(), DECISION_REPLIED);
    const found = replyOf(decided)!;
    expect(found.reply.text).toBe(REPLY_TEXT);
    expect(replyState(found.measure, found.reply)).toBe("onTime");
    expect(answerable(decided, MODERATOR)).toBe(true);
    const late = repliedWith({ reply: { onTime: false }, period: { startsAt: "2026-10-06T09:00:00.000Z", endsAt: "2026-10-09T09:00:00.000Z", state: "ended" } });
    expect(replyState(late.actions[0]!, late.actions[0]!.reply!)).toBe("lateEnded");
    const running = repliedWith({ reply: { onTime: false }, period: { startsAt: "2026-10-11T09:00:00.000Z", endsAt: "2026-10-14T09:00:00.000Z", state: "running" } });
    expect(replyState(running.actions[0]!, running.actions[0]!.reply!)).toBe("late");
    const answered = repliedWith({ reply: { answeredAt: "2026-10-07T09:00:00.000Z", answeredBy: DECISION_WITHDRAW } });
    expect(replyState(answered.actions[0]!, answered.actions[0]!.reply!)).toBe("answered");
    expect(answerable(answered, ADMIN)).toBe(false);
    const gone = repliedWith({ period: { startsAt: null, endsAt: null, state: "basis_ended" } });
    expect(replyState(gone.actions[0]!, gone.actions[0]!.reply!)).toBe("basisGone");
    expect(answerable(gone, ADMIN)).toBe(false);
    // [reply.admin]: a reply to a measure that needed an admin is answered by an admin.
    const admins = repliedWith({ needsAdmin: true });
    expect(answerable(admins, MODERATOR)).toBe(false);
    expect(answerable(admins, ADMIN)).toBe(true);
    expect(replyOf(decisionOf(withdrawCase(), DECISION_WITHDRAW))).toBeNull();
  });

  test("the queue's Replies to answer: how long each waited, before or after the start, what it is against, over the aim; never its words", () => {
    const replies: QueueReply[] = [
      { caseId: CASE_REPLIED, decisionId: DECISION_REPLIED, kind: "suspend", days: 3, filedAt: "2026-10-12T08:00:00.000Z", onTime: true, endsAt: null },
      { caseId: CASE_REPLIED, decisionId: DECISION_WITHDRAW, kind: "suspend", days: 5, filedAt: "2026-10-10T09:00:00.000Z", onTime: false, endsAt: "2026-10-11T09:00:00.000Z" },
      { caseId: CASE_LADDER, decisionId: DECISION_WITHDRAW, kind: "terminate", days: null, filedAt: "2026-10-12T09:00:00.000Z", onTime: false, endsAt: null },
    ];
    expect(replyWords(replies[0]!, NOW.getTime())).toEqual([STANDING_WORDS.reply.before, STANDING_WORDS.reply.suspension(3)]);
    expect(replyWords(replies[1]!, NOW.getTime())).toEqual([STANDING_WORDS.reply.afterEnded(dateTime("2026-10-11T09:00:00.000Z")), STANDING_WORDS.reply.suspension(5), STANDING_WORDS.reply.overAim]);
    expect(replyWords(replies[2]!, NOW.getTime())[1]).toBe(STANDING_WORDS.reply.termination);
    const props: QueueViewProps = {
      rows: { state: "ready", value: [] },
      replies,
      more: false,
      loadingMore: false,
      now: NOW.getTime(),
      finding: { link: "", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC", busy: false, error: null },
      onLoadMore: noop,
      onOpenCase: noop,
      onFindingChange: noop,
      onFindingSubmit: noop,
    };
    const out = html(<QueueView {...props} />);
    expect(out).toContain(`>${STANDING_WORDS.reply.title}</h3>`);
    expect(hrefs(out)).toEqual([`/cases/${CASE_REPLIED}`, `/cases/${CASE_REPLIED}`, `/cases/${CASE_LADDER}`]);
    expect(out).toContain(esc(STANDING_WORDS.reply.overAim));
    expect(out).not.toContain("film");
    expect(html(<QueueView {...props} replies={[]} />)).toContain(STANDING_WORDS.reply.none);
  });

  test("the case page shows the reply's text as text with [reply.onTime], and Answer this reply; once answered, the day it was answered and no control", () => {
    const out = casePage(repliedCase(), MODERATOR);
    expect(out).toContain(`aria-label="${STANDING_WORDS.reply.blockTitle}"`);
    expect(out).toContain(esc(REPLY_TEXT));
    expect(out).not.toContain(HOSTILE.script);
    expect(out).toContain(esc(STANDING_WORDS.reply.onTime));
    expect(out).toContain(`>${STANDING_WORDS.reply.answerLabel}</button>`);
    const view = repliedCase();
    view.decisions = [repliedWith({ reply: { answeredAt: "2026-10-07T09:00:00.000Z", answeredBy: DECISION_WITHDRAW } })];
    const answered = casePage(view, MODERATOR);
    expect(answered).toContain(esc(STANDING_WORDS.reply.answered(dateTime("2026-10-07T09:00:00.000Z"))));
    expect(answered).not.toContain(`>${STANDING_WORDS.reply.answerLabel}</button>`);
    // A reply with no text asks for a second look.
    const empty = repliedCase();
    empty.decisions = [repliedWith({ reply: { text: null } })];
    expect(casePage(empty, MODERATOR)).toContain(esc(STANDING_WORDS.reply.empty));
  });

  test("the answer: Keep lifts nothing and Reverse lifts the measure, each said by when the reply came; the params are a correction; the preview answers the reply", () => {
    const view = repliedCase();
    const decided = decisionOf(view, DECISION_REPLIED);
    const draft = answerDraft(caseId(view.id), view, decided, MODERATOR);
    expect(draft).toMatchObject({ kind: "correction", reviewsDecisionId: DECISION_REPLIED, answer: "kept", actions: [] });
    const out = composer(view, MODERATOR, draft);
    expect(out).toContain(STANDING_WORDS.reply.keepLabel);
    expect(out).toContain(STANDING_WORDS.reply.reverseLabel);
    expect(out).toContain(esc(STANDING_WORDS.keep.onTime(dateTime("2026-10-12T09:00:00.000Z"), 3)));
    expect(out).toContain(esc(STANDING_WORDS.reply.same));
    expect(out).toContain(esc(REPLY_TEXT));
    const kept = { ...draft, written: { ...draft.written, review_reason: "Your reply did not change the strikes." } };
    expect(CaseDecidedParams.parse(decisionParamsOf(view, kept, DIGESTS))).toMatchObject({ kind: "correction", outcome: "kept", reviewsDecisionId: DECISION_REPLIED, actions: [], replaced: false });
    const keptTold = statementParagraphs(previewOf(view, kept, NOW)).join(" | ");
    expect(keptTold).toContain(STATEMENT_WORDS.replyKept("2026-10-05 09:00 UTC"));
    expect(keptTold).toContain("The suspension of 3 days starts at");
    const reversed = withAnswer(kept, decided, "reversed");
    expect(reversed.actions).toEqual([{ kind: "lift_suspension", mediaId: null }]);
    expect(composer(view, MODERATOR, reversed)).toContain(esc(STANDING_WORDS.reverse.onTime));
    expect(CaseDecidedParams.parse(decisionParamsOf(view, reversed, DIGESTS))).toMatchObject({ kind: "correction", outcome: "reversed", actions: [{ kind: "lift_suspension", mediaId: null }], replaced: false });
    expect(withAnswer(reversed, decided, "kept").actions).toEqual([]);
  });

  test("Withdraw it for another measure: an admin's, while the account's measure is live, for an announced measure that has not started; signed replaced", () => {
    const view = withdrawCase();
    const decided = decisionOf(view, DECISION_WITHDRAW);
    expect(withdrawable(view, decided, ADMIN)?.kind).toBe("suspend");
    expect(withdrawable(view, decided, MODERATOR)).toBeNull();
    expect(withdrawable(withStandingOf(view, { live: false }), decided, ADMIN)).toBeNull();
    const started = { ...decided, actions: [{ ...decided.actions[0]!, period: { startsAt: "2026-10-12T09:05:00.000Z", endsAt: "2026-10-15T09:05:00.000Z", state: "running" as const } }] };
    expect(withdrawable(view, started, ADMIN)).toBeNull();
    expect(casePage(view, ADMIN)).toContain(`>${STANDING_WORDS.replace.label}</button>`);
    expect(casePage(view, MODERATOR)).not.toContain(`>${STANDING_WORDS.replace.label}</button>`);
    const draft = withdrawDraft(caseId(CASE_WITHDRAW), view, decided, ADMIN);
    expect(draft).toMatchObject({ kind: "correction", reviewsDecisionId: DECISION_WITHDRAW, replaced: true, actions: [{ kind: "lift_suspension", mediaId: null }] });
    const out = composer(view, ADMIN, draft);
    expect(out).toContain(esc(STANDING_WORDS.replace.what));
    expect(out).not.toContain(esc(STANDING_WORDS.replace.reply));
    const written = { ...draft, written: { ...draft.written, review_reason: "A threat since needs a suspension at once." } };
    expect(CaseDecidedParams.parse(decisionParamsOf(view, written, DIGESTS))).toMatchObject({ kind: "correction", outcome: "reversed", actions: [{ kind: "lift_suspension", mediaId: null }], replaced: true });
    const told = statementParagraphs(previewOf(view, written, NOW)).join(" | ");
    expect(told).toContain("because it is taking another measure on your account.");
    expect(told).not.toContain("korbat corrected its decision");
  });
});

describe("3e Task 4: the Standing screen, the home screen's lines and the appeals' order (design, sections 8.5, 8.6 and 8.8)", () => {
  const lists: StandingLists = {
    atThreeStrikes: { total: 3, items: [{ handle: HOSTILE.script, caseId: null, activeStrikes: 3, ruleId: "R1", newestOn: "2026-10-04", maxDays: 3, mayTerminate: false }] },
    reportingRecords: { total: 0, items: [] },
    noticesUndelivered: { total: 1, items: [{ handle: HOSTILE.img, caseId: CASE_POST, decidedOn: "2026-10-01", startsAt: "2026-10-15T09:00:00.000Z" }] },
    terminationsWaiting: { total: 1, items: [{ handle: "term_inated", caseId: CASE_REPLIED.toUpperCase(), decidedOn: "2026-09-01", finalOn: null, heldBy: "appeal", replyOnTime: null }] },
  };

  test("the four lists, people as handles shown as text, each row's link to its case built from a checked id, and Open a case on this account", () => {
    expect(StandingLists.safeParse(lists).success).toBe(true);
    const out = html(<StandingView lists={{ state: "ready", value: lists }} opening={{ handle: null, error: null }} onOpenCase={noop} onOpenFinding={noop} />);
    for (const title of [STANDING_WORDS.lists.strikesTitle, STANDING_WORDS.lists.reportingTitle, STANDING_WORDS.lists.noticesTitle, STANDING_WORDS.lists.terminationsTitle]) expect(out).toContain(`>${title}</h3>`);
    expect(out).toContain(esc(STANDING_WORDS.lists.strikesRow(HOSTILE.script, 3, "R1", "2026-10-04", 3, false)));
    expect(out).toContain(esc(STANDING_WORDS.lists.noticesRow(HOSTILE.img, "2026-10-01", "2026-10-15T09:00:00.000Z")));
    expect(out).not.toContain(HOSTILE.script);
    expect(out).toContain(`>${STANDING_WORDS.lists.openCase}</button>`);
    expect(out).toContain(esc(STANDING_WORDS.lists.appealHolds));
    expect(out).toContain(STANDING_WORDS.lists.empty);
    expect(out).toContain(esc(STANDING_WORDS.lists.more(3, 1)));
    // An id that is no lower-case uuid never becomes a link.
    expect(hrefs(out)).toEqual([`/cases/${CASE_POST}`]);
    const busy = html(<StandingView lists={{ state: "ready", value: lists }} opening={{ handle: HOSTILE.script, error: null }} onOpenCase={noop} onOpenFinding={noop} />);
    expect(busy).toContain('disabled="" aria-busy="true"');
  });

  test("the home screen's two lines, each shown when above zero", () => {
    const out = html(<OverviewView overview={overview({ repliesWaiting: { count: 2, oldestAt: "2026-10-11T09:30:00.000Z" }, strikeAccounts: 4 })} now={NOW.getTime()} onOpenCase={noop} />);
    expect(out).toContain("Replies waiting: 2, the oldest for ");
    expect(out).toContain(esc(STANDING_WORDS.home.strikes(4)));
    const none = html(<OverviewView overview={overview()} now={NOW.getTime()} onOpenCase={noop} />);
    expect(none).not.toContain("Replies waiting");
    expect(none).not.toContain(STANDING_WORDS.home.strikes(0));
  });

  test("the appeals screen says its order, and marks an appeal listed first", () => {
    const row = {
      id: "e1f2a3b4-c5d6-47e8-89f0-a1b2c3d4e5f6",
      caseId: CASE_REPLIED,
      decisionId: DECISION_REPLIED,
      filedAt: "2026-10-06T10:00:00.000Z",
      decidedAt: "2026-10-05T09:00:00.000Z",
      deadline: "2027-04-05T09:00:00.000Z",
      ruleId: "R1" as const,
      legal: false,
      actions: ["suspend" as const],
      reviewer: "available" as const,
      needsAdmin: false,
      mayReview: true,
      standingFirst: true,
    };
    const out = html(<AppealsView rows={{ state: "ready", value: [row] }} more={false} loadingMore={false} onLoadMore={noop} onOpenCase={noop} />);
    expect(out).toContain(esc(STANDING_WORDS.appealsOrder));
    expect(out).toContain(`${STANDING_WORDS.appealsFirst}.`);
    const plain = html(<AppealsView rows={{ state: "ready", value: [{ ...row, standingFirst: false }] }} more={false} loadingMore={false} onLoadMore={noop} onOpenCase={noop} />);
    expect(plain).not.toContain(`${STANDING_WORDS.appealsFirst}.`);
  });
});
