import { describe, expect, test } from "vitest";
import {
  ACCOUNT_ITEM_SCOPE,
  AccountStanding,
  DecisionStatement,
  MeResponse,
  PeriodThen,
  SocialErrorCode,
  StatementEndedStanding,
  ACCOUNT_MEASURE_SCOPE,
  ACCOUNT_SUSPECT_SCOPE,
  CaseDecisionAction,
  CaseStanding,
  DecisionStrike,
  ITEM_OUTCOMES,
  NoticeItemStatus,
  OUTCOME_PHRASES,
  PERIOD_STATES,
  PostModeration,
  REPLY_TEXT_MAX,
  RETIRED_HANDLE_PREFIX,
  STANDING_BASES,
  STANDING_DAYS,
  STANDING_DRAFTS,
  STANDING_RULES,
  StatementMeasure,
  StatementReversal,
  UNFOUNDED_MAX,
  isRetiredPlaceholder,
  outcomeWords,
  DecisionStanding,
  QueuePage,
  QueueReply,
  REPLY_AIM_HOURS,
  ReplyRequest,
  ReplyResponse,
  StandingLists,
  StatementRepliedTo,
  AuthorCaseRow,
  DecisionView,
  ReportItem,
  ReportingStanding,
  type ItemOutcome,
} from "../src/index";

// Account sanctions (3e design, section 10.1): the constants every word of the console and the app is printed from. The
// database test (apps/api, standing-ledger.test.ts) holds STANDING_RULES to the SQL function standing_rules() name by name.

describe("STANDING_RULES", () => {
  test("holds the cautious defaults of the design, each one line to change", () => {
    expect(STANDING_RULES).toEqual({
      strikeDays: 90,
      ladderStrikes: 3,
      ladderDays: [3, 7, 30],
      ladderMemoryDays: 365,
      replyWindowHours: 168,
      undeliveredHours: 336,
      threatDays: 30,
      terroristDays: 30,
      floodDays: 7,
      protectiveDays: 14,
      floodPosts: 20,
      floodMinutes: 60,
      basisAgeDays: 30,
      reportFrameDays: 90,
      reportWarnMarks: 5,
      reportWarnShare: 0.5,
      reportRestrictMarks: 3,
      reportRestrictDays: 30,
    });
  });

  test("its numbers fit together: the undelivered window is twice the reply window, and no measure is longer than its days allow", () => {
    expect(STANDING_RULES.undeliveredHours).toBe(2 * STANDING_RULES.replyWindowHours);
    const longest = Math.max(...STANDING_RULES.ladderDays, STANDING_RULES.threatDays, STANDING_RULES.terroristDays, STANDING_RULES.floodDays, STANDING_RULES.protectiveDays, STANDING_RULES.reportRestrictDays);
    expect(longest).toBeLessThanOrEqual(STANDING_DAYS.max);
    expect(STANDING_DAYS).toEqual({ min: 1, max: 30 });
    // The rungs grow.
    expect([...STANDING_RULES.ladderDays].sort((a, b) => a - b)).toEqual([...STANDING_RULES.ladderDays]);
  });
});

describe("the other constants of 3e", () => {
  test("the bases, the bounds of a reply and of a decision's marks, and the states of a period", () => {
    expect(STANDING_BASES).toEqual(["strikes", "threat", "terrorist", "flood", "protective", "threat_repeat", "ladder_end", "reports"]);
    expect(REPLY_TEXT_MAX).toBe(2000);
    expect(UNFOUNDED_MAX).toBe(100);
    expect(PERIOD_STATES).toEqual(["unfixed", "announced", "held", "running", "ended", "never", "lifted", "basis_ended"]);
  });

  test("the composer's drafts are W.5's ten texts, each placeholder one the case answer fills", () => {
    const texts = [...Object.values(STANDING_DRAFTS.facts), ...Object.values(STANDING_DRAFTS.reason)];
    expect(texts).toHaveLength(10);
    expect(Object.keys(STANDING_DRAFTS.facts)).toEqual(["strikes", "ladder_end", "threat", "terrorist", "threat_repeat", "flood", "protective", "warn", "restrict"]);
    expect(Object.keys(STANDING_DRAFTS.reason)).toEqual(["protective"]);
    const known = new Set(["activeStrikes", "n", "ladderMemoryDays", "day", "posts", "from", "to", "sealedOn", "frameDays", "readDay", "reports", "unfounded", "marked", "warnedOn", "marksSince"]);
    for (const text of texts) {
      for (const match of text.matchAll(/[{]([a-zA-Z]+)[}]/g)) expect(known.has(match[1]!), `${match[1]} in "${text}"`).toBe(true);
    }
    // A draft that holds a count says when it was counted: the key signs the text, the database counts at the commit.
    expect(STANDING_DRAFTS.facts.strikes).toMatch(/^When this was written/);
    expect(STANDING_DRAFTS.facts.ladder_end).toMatch(/^When this was written/);
    // Nothing of a protective suspension says or implies that the images are such material, or promises a later look.
    for (const text of [STANDING_DRAFTS.facts.protective, STANDING_DRAFTS.reason.protective]) {
      expect(text).not.toMatch(/nobody at korbat has seen|until an admin has looked/i);
    }
    expect(STANDING_DRAFTS.facts.protective).toContain("korbat has not assessed them");
    expect(STANDING_DRAFTS.reason.protective).toContain("korbat makes no finding that this account broke the law or a korbat rule");
  });
});

describe("what the app reads of a strike", () => {
  test("a post's chip carries the end of its strike, or null", () => {
    const chip = { decisionId: "4a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", ruleId: "R3", legal: false, interim: false };
    expect(PostModeration.parse({ ...chip, strikeUntil: "2027-01-01T00:00:00.000Z" }).strikeUntil).toBe("2027-01-01T00:00:00.000Z");
    expect(PostModeration.parse({ ...chip, strikeUntil: null }).strikeUntil).toBeNull();
    expect(PostModeration.safeParse(chip).success).toBe(false);
  });

  test("a decision's strike counts, ran out or was overruled; a statement's strike carries its end and how many counted then", () => {
    for (const state of ["counts", "expired", "overruled"] as const) expect(DecisionStrike.parse({ countsUntil: "2027-01-01T00:00:00.000Z", state, overruledAt: null }).state).toBe(state);
    expect(DecisionStrike.safeParse({ countsUntil: "2027-01-01T00:00:00.000Z", state: "paused", overruledAt: null }).success).toBe(false);
    const strike = { kind: "strike", mediaId: null, noEffect: null, sealed: null, endsAt: "2027-01-01T00:00:00.000Z", activeThen: 2 };
    expect(StatementMeasure.parse(strike)).toEqual(strike);
    // 3c's measures carry neither, and parse as they did.
    expect(StatementMeasure.parse({ kind: "remove", mediaId: null, noEffect: null, sealed: null })).toEqual({ kind: "remove", mediaId: null, noEffect: null, sealed: null });
  });
});

describe("the retirement of a handle (3e design, sections 10.1, 10.2, 10.3 and W.1)", () => {
  test("a placeholder is the reserved prefix and 12 lower-case hex digits: a valid handle of 20 characters that nobody can choose", () => {
    expect(RETIRED_HANDLE_PREFIX).toBe("retired_");
    const placeholder = `${RETIRED_HANDLE_PREFIX}0a1b2c3d4e5f`;
    expect(placeholder).toHaveLength(20);
    expect(placeholder).toMatch(/^[a-z0-9_]{3,20}$/);
    expect(isRetiredPlaceholder(placeholder)).toBe(true);
    // The form only: upper-case or too few digits are no placeholder, nor is a handle that merely starts with the word.
    for (const other of ["retired_0A1B2C3D4E5F", "retired_0a1b2c3d4e5", "retired_0a1b2c3d4e5f0", "retired_ghijklmnopqr", "retiredada", "ada"]) expect(isRetiredPlaceholder(other), other).toBe(false);
  });

  test("ACCOUNT_MEASURE_SCOPE: two phrases, neither of which names a suspension, an access or a duration", () => {
    expect(ACCOUNT_MEASURE_SCOPE).toEqual({
      retired: "korbat retired the handle.",
      measure: "korbat took a measure on the account. It does not report here which, or for how long.",
    });
    for (const phrase of Object.values(ACCOUNT_MEASURE_SCOPE)) {
      expect(phrase).not.toMatch(/suspen|terminat|access|day|hour|week|until/i);
    }
  });

  const words = (outcome: ItemOutcome, scope: "account" | "account_retired" | "account_suspect") =>
    outcomeWords({ outcome, rule: outcome === "restricted_rule" ? { id: "R4", title: "No doxxing" } : null, suspect: false, sealed: false, unseen: false, noEffect: false, scope });

  test("a reporter's line for an item that a retirement answered carries the retired phrase in place of ACCOUNT_ITEM_SCOPE, after a restriction and nowhere else", () => {
    expect(NoticeItemStatus.shape.scope.unwrap().options).toEqual(["account", "quote", "account_suspect", "account_retired", "account_measure"]);
    expect(words("restricted_rule", "account_retired")).toBe(`access restricted: it breaks korbat rule R4 (No doxxing). ${ACCOUNT_MEASURE_SCOPE.retired}`);
    expect(words("restricted_legal", "account_retired")).toBe(`${OUTCOME_PHRASES.restricted_legal}. ${ACCOUNT_MEASURE_SCOPE.retired}`);
    // A reversal's phrase stands alone: the handle given back is never followed by "korbat retired the handle".
    expect(words("reversed", "account_retired")).toBe(`${OUTCOME_PHRASES.reversed}.`);
    expect(words("partly_reversed", "account_retired")).toBe(`${OUTCOME_PHRASES.partly_reversed}.`);
    for (const outcome of ITEM_OUTCOMES) {
      expect(words(outcome, "account_retired"), outcome).not.toContain(ACCOUNT_ITEM_SCOPE);
      expect(words(outcome, "account_retired"), outcome).not.toContain(ACCOUNT_SUSPECT_SCOPE);
      for (const scope of ["account", "account_suspect"] as const) expect(words(outcome, scope), `${outcome} ${scope}`).not.toContain(ACCOUNT_MEASURE_SCOPE.retired);
    }
  });

  test("a statement's retirement carries its handle and placeholder, a standing measure whether it was announced, and the handle given back its handle; all optional, so older data parses", () => {
    const retire = { kind: "retire_handle", mediaId: null, noEffect: null, sealed: null, handle: "ada_l", placeholder: "retired_0a1b2c3d4e5f" };
    expect(StatementMeasure.parse(retire)).toEqual(retire);
    expect(StatementMeasure.parse({ kind: "suspend", mediaId: null, noEffect: null, sealed: null, announced: false }).announced).toBe(false);
    expect(StatementMeasure.parse({ kind: "retire_handle", mediaId: null, noEffect: "already", sealed: null, handle: "ada_l", placeholder: null }).placeholder).toBeNull();
    const back = { kind: "unretire_handle", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null, handle: "ada_l" };
    expect(StatementReversal.parse(back)).toEqual(back);
    expect(StatementReversal.parse({ kind: "restore", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null })).not.toHaveProperty("handle");
  });

  test("the case answer says whether the newest snapshot's handle is retired, and a retirement's row names the handle it retired", () => {
    expect(CaseStanding.shape.snapshotHandleRetired.parse(true)).toBe(true);
    expect(CaseStanding.shape.snapshotHandleRetired.safeParse(null).success).toBe(false);
    expect(CaseDecisionAction.shape.handle.parse("ada_l")).toBe("ada_l");
    expect(CaseDecisionAction.shape.handle.parse(undefined)).toBeUndefined();
  });
});

describe("suspensions at once and the account's standing (3e design, sections 7.2, 10.2, 10.5 and W.1, Task 3)", () => {
  const decisionId = "4a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("a refused write of a suspended account answers account_suspended, a code of the social module that the others name as shared", () => {
    expect(SocialErrorCode.options).toContain("account_suspended");
  });

  test("/me carries the account's standing: no strike, no measure and no restriction for an account that holds none, and the one standing measure with its state and times", () => {
    const none = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
    expect(AccountStanding.parse(none)).toEqual(none);
    const running = {
      activeStrikes: 1,
      measure: {
        decisionId,
        kind: "suspend",
        days: 7,
        state: "running",
        earliestStart: "2026-10-12T10:00:00.000Z",
        startsAt: "2026-10-12T10:00:00.000Z",
        endsAt: "2026-10-19T10:00:00.000Z",
        reply: null,
        replyOpen: true,
        appealUntil: "2027-04-12T10:00:00.000Z",
        appealPending: false,
      },
      reporting: null,
      handleRetired: false,
    };
    expect(AccountStanding.parse(running)).toEqual(running);
    for (const state of ["unfixed", "announced", "held", "running"]) expect(AccountStanding.shape.measure.unwrap().shape.state.parse(state)).toBe(state);
    // Only a suspension or a termination is a standing measure, and an ended period is never the account's measure now.
    expect(AccountStanding.safeParse({ ...running, measure: { ...running.measure, kind: "strike" } }).success).toBe(false);
    expect(AccountStanding.safeParse({ ...running, measure: { ...running.measure, state: "ended" } }).success).toBe(false);
    const user = { id: decisionId, email: "a@b.io", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 };
    expect(MeResponse.parse({ user, profile: null, standing: null }).standing).toBeNull();
    expect(MeResponse.parse({ user, profile: null, standing: running }).standing?.measure?.state).toBe("running");
    // The member is always there: null without the moderation module or a profile, never missing.
    expect(MeResponse.safeParse({ user, profile: null }).success).toBe(false);
  });

  test("a statement's suspension at once carries its days, its basis, its start and end and the decisions it rests on; a lift its measure and the period as it stood; all optional, so older data parses", () => {
    const atOnce = {
      kind: "suspend",
      mediaId: null,
      noEffect: null,
      sealed: null,
      announced: false,
      days: 7,
      basis: "threat",
      earliestStart: "2026-10-12T10:00:00.000Z",
      endsAt: "2026-10-19T10:00:00.000Z",
      restsOn: [{ decidedAt: "2026-10-10T10:00:00.000Z", ruleId: "R5", postCreatedAt: "2026-10-09T10:00:00.000Z" }],
    };
    expect(StatementMeasure.parse(atOnce)).toEqual(atOnce);
    // A protective suspension rests on the seal's decision, which names no rule and no post of its own here.
    expect(StatementMeasure.parse({ ...atOnce, basis: "protective", restsOn: [{ decidedAt: "2026-10-10T10:00:00.000Z", ruleId: null, postCreatedAt: null }] }).restsOn).toHaveLength(1);
    expect(StatementMeasure.safeParse({ ...atOnce, basis: "spam" }).success).toBe(false);
    const lift = {
      kind: "lift_suspension",
      mediaId: null,
      resetDecisionId: null,
      oldValueKept: false,
      resetRuleId: null,
      liftedKind: "suspend",
      liftedDecidedAt: "2026-10-10T10:00:00.000Z",
      periodThen: { state: "running", startedAt: "2026-10-10T10:00:00.000Z", endedAt: null },
      replaced: false,
    };
    expect(StatementReversal.parse(lift)).toEqual(lift);
    for (const state of ["not_started", "running", "ended"]) expect(PeriodThen.parse({ state, startedAt: null, endedAt: null }).state).toBe(state);
    expect(PeriodThen.safeParse({ state: "lifted", startedAt: null, endedAt: null }).success).toBe(false);
    const ended = { kind: "suspend", decidedAt: "2026-10-10T10:00:00.000Z", periodThen: { state: "ended", startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-17T10:00:00.000Z" }, seal: false, replyFiledAt: null };
    expect(StatementEndedStanding.parse(ended)).toEqual(ended);
    expect(DecisionStatement.shape.endedStanding.parse(undefined)).toBeUndefined();
  });

  test("a reporter's line for an item that a measure at once answered carries ACCOUNT_MEASURE_SCOPE.measure through a scope of its own, after a restriction and nowhere else", () => {
    expect(NoticeItemStatus.shape.scope.unwrap().options).toContain("account_measure");
    const line = (outcome: ItemOutcome) =>
      outcomeWords({ outcome, rule: outcome === "restricted_rule" ? { id: "R5", title: "No threats" } : null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: "account_measure" });
    expect(line("restricted_rule")).toBe(`access restricted: it breaks korbat rule R5 (No threats). ${ACCOUNT_MEASURE_SCOPE.measure}`);
    expect(line("reversed")).toBe(`${OUTCOME_PHRASES.reversed}.`);
    for (const outcome of ITEM_OUTCOMES) {
      expect(line(outcome), outcome).not.toContain(ACCOUNT_ITEM_SCOPE);
      expect(line(outcome), outcome).not.toContain(ACCOUNT_MEASURE_SCOPE.retired);
    }
  });
});

describe("announced measures, replies and termination (3e design, sections 10.1 to 10.3, Task 4)", () => {
  const T = "2026-10-12T10:00:00.000Z";
  const ID = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("a reply carries at most REPLY_TEXT_MAX characters and nothing else; its answer says when it was filed and whether before the start; replies are answered within REPLY_AIM_HOURS", () => {
    expect(REPLY_AIM_HOURS).toBe(24);
    expect(ReplyRequest.safeParse({}).success).toBe(true);
    expect(ReplyRequest.safeParse({ statement: "I quoted a film." }).success).toBe(true);
    expect(ReplyRequest.safeParse({ statement: "x".repeat(REPLY_TEXT_MAX + 1) }).success).toBe(false);
    // The time of filing and whether it came on time are the database's: a request that sets either is refused.
    expect(ReplyRequest.safeParse({ statement: "x", onTime: true }).success).toBe(false);
    expect(ReplyRequest.safeParse({ filedAt: T }).success).toBe(false);
    expect(ReplyResponse.parse({ filedAt: T, onTime: true })).toEqual({ filedAt: T, onTime: true });
  });

  test("the queue's first page carries the unanswered replies without their text; a decision's standing carries the reply with its text for its author", () => {
    const reply = { caseId: ID, decisionId: ID, kind: "suspend", days: 3, filedAt: T, onTime: true, endsAt: null };
    expect(QueueReply.parse(reply)).toEqual(reply);
    expect(Object.keys(QueueReply.shape)).not.toContain("text");
    expect(QueuePage.safeParse({ cases: [], nextCursor: null, replies: [reply] }).success).toBe(true);
    expect(QueuePage.safeParse({ cases: [], nextCursor: null }).success).toBe(false);
    const standing = {
      state: "held",
      earliestStart: T,
      startsAt: null,
      endsAt: null,
      endedAt: null,
      endedBy: null,
      replaced: false,
      restsOn: [{ decisionId: ID, ruleId: "R1", decidedAt: T, countsUntil: T, state: "counts", overruledAt: null }],
      reply: { filedAt: T, onTime: true, text: "I quoted a film.", erasedAt: null, answeredAt: null, answeredBy: null },
      replyOpen: false,
    };
    expect(DecisionStanding.parse(standing)).toEqual(standing);
    expect(DecisionStanding.safeParse({ ...standing, state: "paused" }).success).toBe(false);
    // A measure taken at once rests on a decision, not a strike: no rule's count, no state.
    expect(DecisionStanding.safeParse({ ...standing, restsOn: [{ decisionId: ID, ruleId: null, decidedAt: T, countsUntil: null, state: null, overruledAt: null }] }).success).toBe(true);
  });

  test("a statement that answered a reply carries the reply's time, the measure and the start and end it fixed; optional, so older data parses", () => {
    const repliedTo = { filedAt: T, onTime: true, kind: "suspend", days: 3, periodThen: { state: "not_started", startedAt: null, endedAt: null }, startsAt: T, endsAt: T, appealUntil: T };
    expect(StatementRepliedTo.parse(repliedTo)).toEqual(repliedTo);
    expect(StatementRepliedTo.safeParse({ ...repliedTo, days: 31 }).success).toBe(false);
    expect(DecisionStatement.shape.repliedTo.safeParse(undefined).success).toBe(true);
    expect(StatementReversal.shape.replyFiledAt.safeParse(undefined).success).toBe(true);
  });

  test("the Standing screen's four lists: people by handle, each row's case, the numbers the ladder reads", () => {
    const lists = {
      atThreeStrikes: { total: 1, items: [{ handle: "someone", caseId: null, activeStrikes: 3, ruleId: "R1", newestOn: "2026-10-04", maxDays: 3, mayTerminate: false }] },
      reportingRecords: { total: 0, items: [] },
      noticesUndelivered: { total: 1, items: [{ handle: "someone", caseId: ID, decidedOn: "2026-10-01", startsAt: T }] },
      terminationsWaiting: { total: 1, items: [{ handle: "someone", caseId: ID, decidedOn: "2026-09-01", finalOn: null, heldBy: "reply", replyOnTime: true }] },
    };
    expect(StandingLists.parse(lists)).toEqual(lists);
    expect(StandingLists.safeParse({ ...lists, terminationsWaiting: { total: 1, items: [{ ...lists.terminationsWaiting.items[0], heldBy: "admin" }] } }).success).toBe(false);
    // No row carries an account's id or address.
    for (const list of Object.values(StandingLists.shape)) {
      const row = (list.shape.items.element as unknown as { shape: Record<string, unknown> }).shape;
      for (const member of Object.keys(row)) expect(member, member).not.toMatch(/accountId|email|address/i);
    }
  });
});

describe("the restriction of reporting (3e design, sections 7.9, 10.1 to 10.3, Task 5)", () => {
  const T = "2026-10-12T10:00:00.000Z";
  const ID = "5b1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("/me carries the warning that counts and the restriction that runs, each null when none stands", () => {
    const reporting = { warning: { decisionId: ID, countsUntil: T }, restriction: { decisionId: ID, until: T } };
    const standing = { activeStrikes: 0, measure: null, reporting, handleRetired: false };
    expect(AccountStanding.parse(standing).reporting).toEqual(reporting);
    expect(AccountStanding.parse({ ...standing, reporting: { warning: reporting.warning, restriction: null } }).reporting?.restriction).toBeNull();
    expect(AccountStanding.safeParse({ ...standing, reporting: { warning: reporting.warning } }).success).toBe(false);
  });

  test("a sender's own report says whether a mark on its item counts; the status page by reference never does", () => {
    const status = {
      position: 1,
      link: "https://korbat.example/post/x",
      scope: null,
      suspect: false,
      sealed: false,
      unseen: false,
      quotedBy: null,
      outcome: "no_violation",
      decidedOn: "2026-10-12",
      changed: false,
      reexamines: false,
      reexamination: { open: true, until: "2026-10-26" },
    };
    expect(ReportItem.parse({ ...status, id: ID, unfounded: true }).unfounded).toBe(true);
    expect(ReportItem.safeParse({ ...status, id: ID }).success).toBe(false);
    expect(Object.keys(NoticeItemStatus.shape)).not.toContain("unfounded");
  });

  test("a statement's warning and restriction carry their basis, their end and the restriction's days and warning; a lift of either names it; a restriction ended with its warning is an entry of endedStanding; all optional, so older data parses", () => {
    const warning = { kind: "warn_reporting", mediaId: null, noEffect: null, sealed: null, basis: "reports", endsAt: T };
    expect(StatementMeasure.parse(warning)).toEqual(warning);
    const restriction = { kind: "restrict_reporting", mediaId: null, noEffect: null, sealed: null, basis: "reports", days: 30, endsAt: T, warnedAt: T };
    expect(StatementMeasure.parse(restriction)).toEqual(restriction);
    expect(StatementMeasure.shape.warnedAt.parse(undefined)).toBeUndefined();
    const lift = { kind: "lift_reporting", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null, liftedKind: "restrict_reporting", liftedDecidedAt: T, periodThen: { state: "ended", startedAt: T, endedAt: T } };
    expect(StatementReversal.parse(lift)).toEqual(lift);
    expect(StatementReversal.safeParse({ ...lift, liftedKind: "strike" }).success).toBe(false);
    const ended = { kind: "restrict_reporting", decidedAt: T, periodThen: { state: "running", startedAt: T, endedAt: null }, seal: false, replyFiledAt: null };
    expect(StatementEndedStanding.parse(ended)).toEqual(ended);
  });

  test("a decision's screen says where its restriction of reporting stands now, in four states; a case row names the restriction's days and what a reversal ended", () => {
    for (const state of ["running", "ended", "lifted", "basis_ended"]) expect(ReportingStanding.parse({ state, until: T, endedAt: null, endedBy: null }).state).toBe(state);
    expect(ReportingStanding.safeParse({ state: "held", until: T, endedAt: null, endedBy: null }).success).toBe(false);
    expect(DecisionView.shape.reportingStanding.safeParse(undefined).success).toBe(true);
    expect(AuthorCaseRow.shape.reportingDays.parse(30)).toBe(30);
    expect(AuthorCaseRow.shape.reportingDays.safeParse(31).success).toBe(false);
    expect(AuthorCaseRow.shape.endedStanding.parse(["restrict_reporting"])).toEqual(["restrict_reporting"]);
    expect(AuthorCaseRow.shape.endedStanding.safeParse(undefined).success).toBe(true);
  });

  test("the Standing screen's reporting records count reports, by handle, with the warning's day and the marked reports since", () => {
    const row = { handle: "someone", caseId: null, reports: 9, unfounded: 5, warnedOn: "2026-09-01", marksSince: 1 };
    expect(StandingLists.shape.reportingRecords.parse({ total: 1, items: [row] }).items[0]).toEqual(row);
    expect(UNFOUNDED_MAX).toBe(100);
  });
});
