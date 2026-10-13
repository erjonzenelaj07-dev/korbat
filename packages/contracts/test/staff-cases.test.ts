import { describe, expect, test } from "vitest";
import {
  CaseSnapshot,
  CaseDecisionAction,
  CaseView,
  FINDING_CATEGORIES,
  ErasureOverdue,
  FindingRequest,
  FindingResponse,
  IdentityRevealRequest,
  QUEUE_PAGE_SIZE,
  QueuePage,
  QueueQuery,
  RevealResponse,
  SOURCE_LABELS,
  STAFF_TEXT_KINDS,
  STAFF_TEXT_MAX,
  SourceSummary,
  StaffOverview,
  StaffSnapshotTaken,
  StaffTextSaveRequest,
  StaffTextSaved,
  StaffTextsResponse,
  TDB_CATEGORIES,
  reporterLabel,
  snapshotDigest,
  staffTextProblem,
} from "../src/index";

/**
 * The console's requests and answers on cases (3c design, section 10): what a moderator's own finding may say, what a
 * saved text must be, and the shapes the queue, the case and the home screen are parsed with.
 */

const CASE = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const POST = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
const OTHER = "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b";
const HEX = "ab".repeat(32);
const TIME = "2026-10-04T08:15:30.123Z";
/** The seven members of 3e on a ledger row of 3c, where each is null. */
const NO_STANDING_COLUMNS = { days: null, announced: null, basis: null, restsOn: null, earliestStart: null, countsUntil: null, period: null, restedOnBy: null, reply: null } as const;

describe("FindingRequest", () => {
  const finding = { target: { kind: "post", id: POST }, ground: "rule", ruleId: "R1", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" };

  test("a moderator's finding cites a korbat rule, R2 among them, about a post, an account or a korbat link", () => {
    for (const ruleId of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(FindingRequest.safeParse({ ...finding, ruleId }).success, ruleId).toBe(true);
    expect(FindingRequest.safeParse({ ...finding, target: { kind: "account", handle: "@Some_one" } }).success).toBe(true);
    expect(FindingRequest.parse({ ...finding, target: { kind: "account", handle: "@Some_one" } }).target).toEqual({ kind: "account", handle: "some_one" });
    expect(FindingRequest.safeParse({ ...finding, target: { kind: "link", url: "https://korbat.example/post/" + POST } }).success).toBe(true);
  });

  test("it has no other ground than a rule: a finding never alleges illegality and never goes the path that records no sender", () => {
    for (const ground of ["illegal", "csam", "order", "law", ""]) expect(FindingRequest.safeParse({ ...finding, ground }).success, ground).toBe(false);
    const { ground: _ground, ...withoutGround } = finding;
    expect(FindingRequest.safeParse(withoutGround).success).toBe(false);
    // The members of the other grounds are refused, never ignored.
    for (const extra of [{ explanation: "words" }, { bonaFide: true }, { citedLaw: "a law" }, { keyword: "csam" }, { name: "A" }, { email: "a@b.example" }, { turnstileToken: "t" }]) {
      expect(FindingRequest.safeParse({ ...finding, ...extra }).success, Object.keys(extra)[0]).toBe(false);
    }
    expect(FindingRequest.safeParse({ ...finding, ruleId: "R7" }).success).toBe(false);
    expect(FindingRequest.safeParse({ ...finding, ruleId: null }).success).toBe(false);
  });

  test("its category is one of the Transparency Database's, but not the one that says a notifier was not sure", () => {
    for (const category of TDB_CATEGORIES) {
      expect(FindingRequest.safeParse({ ...finding, category }).success, category).toBe(category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE");
    }
    expect(FindingRequest.safeParse({ ...finding, category: "STATEMENT_CATEGORY_MADE_UP" }).success).toBe(false);
  });

  test("the categories a finding may carry are exported as a list, in the Transparency Database's order, for the console's form: exactly those the request takes", () => {
    expect(FINDING_CATEGORIES).toEqual(TDB_CATEGORIES.filter((category) => category !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
    expect(FINDING_CATEGORIES).toHaveLength(TDB_CATEGORIES.length - 1);
    expect(TDB_CATEGORIES.filter((category) => FindingRequest.safeParse({ ...finding, category }).success)).toEqual(FINDING_CATEGORIES);
  });

  test("the answer names the case the finding opened or joined", () => {
    expect(FindingResponse.parse({ caseId: CASE })).toEqual({ caseId: CASE });
    expect(FindingResponse.safeParse({ caseId: "x" }).success).toBe(false);
  });
});

describe("a saved text", () => {
  const save = { kind: "note", text: "Art. 18 check: no suspicion", salt: HEX, digest: HEX };

  test("is of one of the seven kinds, the recorded choice not to seal among them, with a 32-byte salt and a digest in lower-case hex", () => {
    expect(STAFF_TEXT_KINDS).toEqual(["facts", "reason", "legal_reference", "review_reason", "reveal_reason", "note", "seal_declined"]);
    for (const kind of STAFF_TEXT_KINDS) expect(StaffTextSaveRequest.safeParse({ ...save, kind }).success, kind).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, kind: "statement" }).success).toBe(false);
    for (const bad of [HEX.toUpperCase(), HEX.slice(2), `${HEX}00`, "", "g".repeat(64)]) {
      expect(StaffTextSaveRequest.safeParse({ ...save, salt: bad }).success, `salt ${bad}`).toBe(false);
      expect(StaffTextSaveRequest.safeParse({ ...save, digest: bad }).success, `digest ${bad}`).toBe(false);
    }
    expect(StaffTextSaveRequest.safeParse({ ...save, caseId: CASE }).success).toBe(false);
  });

  test("the request's schema lets any text through: what a text must be is the route's to refuse, with a code of its own", () => {
    // A text that is too long or holds a control character is answered text_invalid, not invalid_request.
    expect(StaffTextSaveRequest.safeParse({ ...save, text: "x".repeat(STAFF_TEXT_MAX + 1) }).success).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, text: `a${String.fromCharCode(7)}b` }).success).toBe(true);
    expect(StaffTextSaveRequest.safeParse({ ...save, text: 5 }).success).toBe(false);
  });

  test("staffTextProblem: a well-formed text of at most 5000 UTF-16 units, with no control character but the line feed and no invisible direction or zero-width character", () => {
    expect(STAFF_TEXT_MAX).toBe(5000);
    const LF = String.fromCharCode(10);
    expect(staffTextProblem(`two${LF}lines`)).toBeNull();
    expect(staffTextProblem("")).toBeNull();
    expect(staffTextProblem("x".repeat(5000))).toBeNull();
    expect(staffTextProblem("x".repeat(5001))).toBe("too_long");
    // An emoji is two units: 2500 of them fit, and one more unit does not.
    const emoji = String.fromCodePoint(0x1f600);
    expect(staffTextProblem(emoji.repeat(2500))).toBeNull();
    expect(staffTextProblem(`${emoji.repeat(2500)}x`)).toBe("too_long");
    // Half of a surrogate pair has no UTF-8 bytes.
    expect(staffTextProblem(`a${String.fromCharCode(0xd83d)}b`)).toBe("malformed");
    expect(staffTextProblem(`a${String.fromCharCode(0xde00)}`)).toBe("malformed");
    // NUL and every other C0 control but the line feed.
    for (let code = 0; code < 32; code++) {
      expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe(code === 10 ? null : "control");
    }
    // The invisible direction and spacing characters the notice texts refuse too; the joiners scripts and emoji need stay.
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x2060, 0xfeff]) expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBe("format");
    for (const code of [0x200c, 0x200d]) expect(staffTextProblem(`a${String.fromCharCode(code)}b`), `U+${code.toString(16)}`).toBeNull();
    expect(staffTextProblem(`r${String.fromCharCode(0xe9)}sum${String.fromCharCode(0xe9)}`)).toBeNull();
  });

  test("the answers: the stored text's id and digest, the person's own drafts with their salts, and a snapshot's id and digest, never content", () => {
    expect(StaffTextSaved.parse({ id: CASE, digest: HEX })).toEqual({ id: CASE, digest: HEX });
    const draft = { id: CASE, kind: "facts", text: "The post names a home address.", salt: HEX, digest: HEX, createdAt: TIME };
    expect(StaffTextsResponse.parse({ texts: [draft] }).texts).toEqual([draft]);
    expect(Object.keys(StaffSnapshotTaken.parse({ id: CASE, digest: HEX, body: "content", media: [] }))).toEqual(["id", "digest"]);
  });
});

describe("the reveal", () => {
  test("its request is the confirmed params with the key's assertion, and nothing else", () => {
    const stepUp = { id: "Y3JlZA", rawId: "Y3JlZA", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AAAA", signature: "AAAA" }, clientExtensionResults: {} };
    const params = { reasonCategory: "impersonation_claim", reasonDigest: HEX };
    expect(IdentityRevealRequest.safeParse({ ...params, stepUp }).success).toBe(true);
    expect(IdentityRevealRequest.safeParse(params).success).toBe(false);
    expect(IdentityRevealRequest.safeParse({ ...params, stepUp, reason: "free text" }).success).toBe(false);
    expect(IdentityRevealRequest.safeParse({ ...params, reasonCategory: "curiosity", stepUp }).success).toBe(false);
  });

  test("its answer is a reporter's handle or a notifier's given name, or neither when the name was forgotten in between; never an address", () => {
    expect(RevealResponse.parse({ handle: "some_one", name: null })).toEqual({ handle: "some_one", name: null });
    expect(RevealResponse.parse({ handle: null, name: "Ada" })).toEqual({ handle: null, name: "Ada" });
    expect(RevealResponse.parse({ handle: null, name: null })).toEqual({ handle: null, name: null });
    expect(Object.keys(RevealResponse.parse({ handle: null, name: "Ada", email: "ada@example.org" }))).toEqual(["handle", "name"]);
  });
});

describe("a source's summary", () => {
  const reporter = { kind: "reporter", label: "Reporter A", accountAge: "1_to_12_months", itemsFiled: "2_to_9", actedOn: "under_half", answeredUnseen: "none", named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };

  test("names nobody: a letter given per case, bands instead of counts, and for a notifier what was given, never what", () => {
    expect(SourceSummary.safeParse(reporter).success).toBe(true);
    expect(SourceSummary.safeParse({ ...reporter, kind: "notifier", label: SOURCE_LABELS.notifier, accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: true, contactGiven: true, confirmed: false, suppressed: false }).success).toBe(true);
    for (const kind of ["anonymous", "staff", "unlinked"] as const) {
      expect(SourceSummary.safeParse({ ...reporter, kind, label: SOURCE_LABELS[kind], accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null }).success, kind).toBe(true);
    }
    // Bands only: an exact count is no value of any of them.
    expect(SourceSummary.safeParse({ ...reporter, itemsFiled: "7" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, actedOn: "0.4" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, answeredUnseen: "3" }).success).toBe(false);
    expect(SourceSummary.safeParse({ ...reporter, accountAge: "3_days" }).success).toBe(false);
  });

  test("its label is one of the console's own: a reporter's letter or the fixed words of its kind, never a text an answer could choose", () => {
    expect(reporterLabel(0)).toBe("Reporter A");
    expect(reporterLabel(1)).toBe("Reporter B");
    expect(reporterLabel(25)).toBe("Reporter Z");
    expect(reporterLabel(26)).toBe("Reporter AA");
    expect(reporterLabel(27)).toBe("Reporter AB");
    expect(reporterLabel(26 + 26 * 26)).toBe("Reporter AAA");
    for (const label of ["korbat: verified notice from police", "Reporter a", "Reporter", "Reporter A ", "<b>Reporter A</b>", SOURCE_LABELS.staff]) {
      expect(SourceSummary.safeParse({ ...reporter, label }).success, label).toBe(false);
    }
    expect(SourceSummary.safeParse({ ...reporter, kind: "staff", label: "Reporter A" }).success).toBe(false);
  });
});

describe("the case answer", () => {
  const summary = { kind: "anonymous", label: SOURCE_LABELS.anonymous, accountAge: null, itemsFiled: null, actedOn: null, answeredUnseen: null, named: null, contactGiven: null, confirmed: null, suppressed: null, contactLost: false };
  const shown = {
    id: OTHER,
    takenAt: TIME,
    digest: HEX,
    withheld: false,
    salt: HEX,
    targetType: "post",
    targetId: POST,
    authorHandle: "author",
    postState: "visible",
    postCreatedAt: TIME,
    replyToId: null,
    quoteOfId: null,
    body: "the post's words",
    media: [{ id: OTHER, alt: "an image", width: 1200, height: 800 }],
    displayName: null,
    bio: null,
    handle: null,
  };
  const view = {
    id: CASE,
    lane: 0,
    stateVersion: 2,
    intakeSeq: 2,
    answeredSeq: 0,
    openedAt: TIME,
    closedAt: null,
    target: { type: "post", id: POST, link: `https://korbat.example/post/${POST}`, authorHandle: "author", state: "visible", level: "visible" },
    suspicion: { open: true, reach: { posts: 1, images: 1, sealed: 0, served: 1, newestPostOn: "2026-09-04" }, earlier: { target: { count: 0, lastOn: null, imagesOpenedOn: null }, author: { count: 1, lastOn: "2026-08-01" } } },
    imagesAllowed: false,
    snapshots: [shown, { id: CASE, takenAt: TIME, digest: HEX, withheld: true }],
    items: [
      {
        id: OTHER,
        seq: 1,
        position: 1,
        createdAt: TIME,
        lane: 0,
        link: `https://korbat.example/post/${POST}`,
        ruleId: null,
        allegesIllegal: true,
        csam: true,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
        citedLaw: null,
        explanation: "a notifier's words",
        mediaId: null,
        suspect: true,
        quotedByPosition: null,
        quotedCaseId: CASE,
        reexaminesPosition: null,
        reexaminesYourDecision: false,
        statement: null,
        outcome: null,
        answeredBy: null,
        erased: false,
        source: summary,
        markable: false,
        unfounded: false,
        markWithdrawn: false,
      },
    ],
    decisions: [
      {
        id: OTHER,
        kind: "interim",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R2",
        rulesVersion: 2,
        redressVersion: 1,
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        categoryKeyword: null,
        source: "notice",
        decidedAt: TIME,
        staffHandle: "mod_anna",
        throughSeq: 0,
        answersFromSeq: null,
        reviewsDecisionId: null,
        snapshotId: OTHER,
        suspect: true,
        unseen: false,
        needsAdmin: false,
        endedInterim: false,
        facts: "what was found",
        reason: "why",
        legalReference: null,
        actions: [
          { id: CASE, kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 1, deletedPosts: 0, list: [{ postId: POST, createdAt: TIME, images: 1 }] }, ...NO_STANDING_COLUMNS },
        ],
      },
    ],
    appeals: [{ id: OTHER, decisionId: OTHER, filedAt: TIME, statement: "the author's words", answeredAt: null, result: null, answeredBy: null, reviewer: "available", needsAdmin: false, mayReview: true }],
    drafts: [{ id: OTHER, kind: "reason", text: "a draft", salt: HEX, digest: HEX, createdAt: TIME }],
    notes: [{ id: OTHER, staffHandle: "mod_anna", createdAt: TIME, text: "Art. 18 check: no suspicion" }],
    sealsDeclined: [{ id: CASE, staffHandle: "mod_anna", createdAt: TIME, text: "The report repeats the one answered yesterday." }],
    history: [
      { at: TIME, event: "item", refId: OTHER, seq: 1, intakeKind: "user", ruleId: null, allegesIllegal: true, csam: true, reexamination: false, decisionKind: null, outcome: null, staffHandle: null, result: null },
      { at: TIME, event: "decision", refId: OTHER, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: "interim", outcome: "restricted", staffHandle: "mod_anna", result: null },
    ],
    strikeDue: { due: true, why: "due" },
    authorStanding: { activeStrikes: "0", suspensionsInYear: "0", now: "none" },
    standing: null,
  };

  test("parses a case with its target, suspicion, snapshots, items, decisions, appeals, texts and history", () => {
    const parsed = CaseView.parse(view);
    expect(parsed.snapshots).toHaveLength(2);
    expect(parsed.items[0]!.source.kind).toBe("anonymous");
    expect(parsed.decisions[0]!.actions[0]!.sealed?.list).toEqual([{ postId: POST, createdAt: TIME, images: 1 }]);
    // An account's case: its live fields, no suspicion, and never an image.
    const account = { ...view, target: { type: "account", id: POST, handle: "now_named", displayName: "A name", bio: "A bio", deleted: false }, suspicion: null, snapshots: [], items: [], decisions: [] };
    expect(CaseView.safeParse(account).success).toBe(true);
    // A target whose row is gone is still an answer: staff see what is.
    expect(CaseView.safeParse({ ...view, target: { type: "post", id: POST, link: `https://korbat.example/post/${POST}`, authorHandle: null, state: null, level: null } }).success).toBe(true);
  });


  test("3e: a post case carries whether a strike is due and the author's standing in bands; an account case the account's standing", () => {
    for (const why of ["due", "already_struck", "before_last_strike"] as const) expect(CaseView.safeParse({ ...view, strikeDue: { due: why === "due", why } }).success, why).toBe(true);
    expect(CaseView.safeParse({ ...view, strikeDue: { due: true, why: "maybe" } }).success).toBe(false);
    expect(CaseView.safeParse({ ...view, authorStanding: { activeStrikes: "3", suspensionsInYear: "0", now: "none" } }).success).toBe(false);
    expect(CaseView.safeParse({ ...view, authorStanding: { activeStrikes: "3_or_more", suspensionsInYear: "2_or_more", now: "terminated" } }).success).toBe(true);
    const standing = {
      activeStrikes: 3,
      strikes: [{ decisionId: OTHER, caseId: CASE, ruleId: "R3", decidedAt: TIME, countsUntil: TIME }],
      ladderRule: "R3",
      suspensionsInYear: 0,
      lastSuspendedOn: null,
      maxDays: 3,
      mayTerminate: false,
      live: false,
      openReports: true,
      atOnce: ["threat"],
      flood: { posts: 2, from: TIME, to: TIME },
      seal: { decidedOn: "2026-10-01" },
      snapshotHandleRetired: false,
      // 3e Task 3: the decision each ground of a suspension at once would rest on now, by its time.
      basisDecidedAt: { threat: TIME, terrorist: null, protective: TIME },
      // 3e Task 5: the account's record of reporting, in reports.
      reporting: { reports: 0, unfounded: 0, warnedOn: null, warnedAt: null, marksSince: null, mayWarn: false, mayRestrict: false, restrictedUntil: null, marked: [] },
    };
    const account = { ...view, target: { type: "account", id: POST, handle: "now_named", displayName: "A name", bio: "A bio", deleted: false }, suspicion: null, snapshots: [], items: [], decisions: [], strikeDue: null, authorStanding: null, standing };
    expect(CaseView.parse(account).standing).toEqual(standing);
    expect(CaseView.safeParse({ ...account, standing: { ...standing, maxDays: 31 } }).success).toBe(false);
    expect(CaseView.safeParse({ ...account, standing: { ...standing, atOnce: ["ladder"] } }).success).toBe(false);
    expect(CaseView.safeParse({ ...account, standing: { ...standing, basisDecidedAt: { threat: TIME } } }).success).toBe(false);
    // A decision says which standing measures rest on it, when any does; older answers carry no such member.
    const decision = CaseView.parse(view).decisions[0];
    if (decision) {
      expect(CaseView.parse({ ...view, decisions: [{ ...decision, standingOn: [{ kind: "suspend", basis: "threat" }] }] }).decisions[0]!.standingOn).toEqual([{ kind: "suspend", basis: "threat" }]);
      expect(CaseView.safeParse({ ...view, decisions: [{ ...decision, standingOn: [{ kind: "suspend", basis: "spam" }] }] }).success).toBe(false);
    }
    // Each member is always there: on the other kind of case it is null.
    const { standing: _standing, ...without } = account;
    expect(CaseView.safeParse(without).success).toBe(false);
  });

  test("3e: a ledger row carries its days, whether it is announced, its basis, what it rests on, its earliest start, its end of counting and its period", () => {
    const action = view.decisions[0]!.actions[0]!;
    const strike = { ...action, kind: "strike", sealed: null, countsUntil: TIME };
    const suspend = { ...action, kind: "suspend", sealed: null, days: 3, announced: true, basis: "strikes", restsOn: [OTHER], earliestStart: TIME, period: { startsAt: null, endsAt: null, state: "unfixed" } };
    for (const row of [strike, suspend]) expect(CaseDecisionAction.parse(row)).toEqual(row);
    expect(CaseDecisionAction.safeParse({ ...suspend, basis: "ladder" }).success).toBe(false);
    expect(CaseDecisionAction.safeParse({ ...suspend, period: { ...suspend.period, state: "paused" } }).success).toBe(false);
    expect(CaseDecisionAction.safeParse({ ...suspend, days: 0 }).success).toBe(false);
    const { period: _period, ...withoutPeriod } = suspend;
    expect(CaseDecisionAction.safeParse(withoutPeriod).success).toBe(false);
  });

  test("3e Task 5: each item says whether it can be marked and whether its mark counts or was withdrawn; an account case carries its record of reporting in reports, by reference and never by person", () => {
    const item = view.items[0]!;
    for (const member of ["markable", "unfounded", "markWithdrawn"] as const) {
      const { [member]: _gone, ...without } = item;
      expect(CaseView.safeParse({ ...view, items: [without] }).success, member).toBe(false);
      expect(CaseView.safeParse({ ...view, items: [{ ...item, [member]: null }] }).success, member).toBe(false);
    }
    expect(CaseView.parse({ ...view, items: [{ ...item, markable: true, unfounded: true }] }).items[0]).toMatchObject({ markable: true, unfounded: true, markWithdrawn: false });
    const reporting = {
      reports: 8,
      unfounded: 5,
      warnedOn: "2026-09-01",
      warnedAt: TIME,
      marksSince: 2,
      mayWarn: false,
      mayRestrict: false,
      restrictedUntil: null,
      marked: [{ ref: "N-ABCDEFGHIJ", position: 2, sentOn: "2026-08-30", markedOn: "2026-08-31", sinceWarning: false }],
    };
    const parsed = CaseView.shape.standing.unwrap().shape.reporting.parse(reporting);
    expect(parsed).toEqual(reporting);
    const Reporting = CaseView.shape.standing.unwrap().shape.reporting;
    // A marked report is named by its reference and the item's place in it, never by who sent it.
    expect(Object.keys(Reporting.shape.marked.element.shape).sort()).toEqual(["markedOn", "position", "ref", "sentOn", "sinceWarning"]);
    expect(Reporting.safeParse({ ...reporting, marked: [{ ...reporting.marked[0], ref: "someone" }] }).success).toBe(false);
    expect(Reporting.safeParse({ ...reporting, unfounded: -1 }).success).toBe(false);
    expect(Reporting.safeParse({ ...reporting, restrictedUntil: "2026-10-01" }).success).toBe(false);
    // A restriction of reporting rests on its warning: the warning's decision says so, for [review.warning].
    const decision = CaseView.parse(view).decisions[0];
    if (decision) expect(CaseView.parse({ ...view, decisions: [{ ...decision, standingOn: [{ kind: "restrict_reporting", basis: "reports" }] }] }).decisions[0]!.standingOn).toEqual([{ kind: "restrict_reporting", basis: "reports" }]);
  });

  test("a withheld snapshot carries its id, time and digest and no content, whatever the answer held", () => {
    const withheld = CaseSnapshot.parse({ ...shown, withheld: true });
    expect(Object.keys(withheld).sort()).toEqual(["digest", "id", "takenAt", "withheld"]);
  });

  test("a snapshot that is shown carries everything its digest covers: the console recomputes the digest from the answer", async () => {
    const parsed = CaseSnapshot.parse(shown);
    if (parsed.withheld) throw new Error("the snapshot is shown");
    const expected = await snapshotDigest({ ...shown, targetType: "post", postState: "visible" });
    expect(await snapshotDigest(parsed)).toBe(expected);
    const { salt: _salt, ...withoutSalt } = shown;
    expect(CaseSnapshot.safeParse(withoutSalt).success).toBe(false);
  });

  test("a seal's list holds at most the 500 rows the case answer carries", () => {
    const row = { postId: POST, createdAt: TIME, images: 1 };
    const withList = (rows: number) => ({ ...view, decisions: [{ ...view.decisions[0]!, actions: [{ ...view.decisions[0]!.actions[0]!, sealed: { posts: rows, images: rows, deletedPosts: 0, list: Array.from({ length: rows }, () => row) } }] }] });
    expect(CaseView.safeParse(withList(500)).success).toBe(true);
    expect(CaseView.safeParse(withList(501)).success).toBe(false);
  });

  test("suspicion holds counts and days only", () => {
    const bad = { ...view, suspicion: { ...view.suspicion, earlier: { target: { count: 0, lastOn: TIME, imagesOpenedOn: null }, author: { count: 0, lastOn: null } } } };
    expect(CaseView.safeParse(bad).success).toBe(false);
    expect(CaseView.safeParse({ ...view, suspicion: { ...view.suspicion, reach: { ...view.suspicion.reach, newestPostOn: TIME } } }).success).toBe(false);
  });
});

describe("the queue and the overview", () => {
  const row = { id: CASE, lane: 0, targetType: "post", openedAt: TIME, oldestOpenAt: TIME, openItems: 2, rules: ["R5"], categories: ["STATEMENT_CATEGORY_VIOLENCE"], allegesIllegal: true, suspect: false, reexamination: false, deferred: false };

  test("a page of the queue holds at most 50 cases and the cursor of the next", () => {
    expect(QUEUE_PAGE_SIZE).toBe(50);
    expect(QueuePage.safeParse({ cases: [row], nextCursor: null, replies: [] }).success).toBe(true);
    expect(QueuePage.safeParse({ cases: Array.from({ length: 50 }, () => row), nextCursor: "abc_-123", replies: [] }).success).toBe(true);
    expect(QueuePage.safeParse({ cases: Array.from({ length: 51 }, () => row), nextCursor: null, replies: [] }).success).toBe(false);
    expect(QueuePage.safeParse({ cases: [{ ...row, lane: 3 }], nextCursor: null, replies: [] }).success).toBe(false);
  });

  test("the queue's cursor is an opaque word: letters, digits, dashes and underscores", () => {
    expect(QueueQuery.safeParse({}).success).toBe(true);
    expect(QueueQuery.safeParse({ cursor: "eyJhIjoxfQ_-" }).success).toBe(true);
    for (const cursor of ["", "a b", "a/b", "a=b", "x".repeat(401)]) expect(QueueQuery.safeParse({ cursor }).success, cursor).toBe(false);
  });

  test("the overview holds counts, times, staff handles and cases", () => {
    const overview = {
      lanes: [
        { lane: 0, open: 2, oldestAt: TIME },
        { lane: 1, open: 0, oldestAt: null },
        { lane: 2, open: 5, oldestAt: TIME },
      ],
      appealsWaiting: 3,
      appealsYouMayReview: 1,
      appealsWithoutReviewer: 2,
      reveals: { total: 1, items: [{ at: TIME, handle: "mod_anna", caseId: CASE }] },
      imagesToday: [{ handle: "mod_anna", count: 4 }],
      findingsToday: [{ handle: "mod_anna", count: 1 }],
      mailsWaiting: { receipts: 0, authorMails: 1, outcomes: 0 },
      mailsFailed: { receipts: 0, authorMails: 0, outcomes: 2 },
      releaseOverdue: 0,
      erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 },
      deferUnproven: false,
      protectionLifted: { total: 1, items: [{ at: TIME, handle: "mod_anna", caseId: CASE, kind: "dismissed" }] },
      sealsDeclined: { total: 0, items: [] },
      interimSeals: { total: 1, items: [{ at: TIME, handle: "mod_anna", caseId: CASE, posts: 2, images: 5 }] },
      repliesWaiting: { count: 2, oldestAt: TIME },
      strikeAccounts: 1,
    };
    expect(StaffOverview.safeParse(overview).success).toBe(true);
    // Each of the three lists holds at most as many rows as the reveals' list does.
    expect(StaffOverview.safeParse({ ...overview, interimSeals: { total: 101, items: Array.from({ length: 101 }, () => overview.interimSeals.items[0]) } }).success).toBe(false);
    expect(StaffOverview.safeParse({ ...overview, lanes: overview.lanes.slice(0, 2) }).success).toBe(false);
    expect(StaffOverview.safeParse({ ...overview, reveals: { total: 101, items: Array.from({ length: 101 }, () => overview.reveals.items[0]) } }).success).toBe(false);
    expect(StaffOverview.safeParse({ ...overview, releaseOverdue: -1 }).success).toBe(false);
  });

  test("erasureOverdue is one count for each due rule of retention: all eight, each a whole number from 0", () => {
    const counts = { caseEvidence: 2, intakeRecords: 0, statements: 1, redactions: 0, images: 60, drafts: 0, accessLog: 0, contacts: 3 };
    expect(ErasureOverdue.parse(counts)).toEqual(counts);
    expect(Object.keys(ErasureOverdue.shape).sort()).toEqual(["accessLog", "caseEvidence", "contacts", "drafts", "images", "intakeRecords", "redactions", "statements"]);
    for (const key of Object.keys(counts)) {
      const { [key]: _left, ...missing } = counts as Record<string, number>;
      expect(ErasureOverdue.safeParse(missing).success, key).toBe(false);
      expect(ErasureOverdue.safeParse({ ...counts, [key]: -1 }).success, key).toBe(false);
      expect(ErasureOverdue.safeParse({ ...counts, [key]: 1.5 }).success, key).toBe(false);
    }
    // The overview carries it: an answer without it is refused, so a console never reads "nothing is late" from a missing member.
    const parsed = StaffOverview.safeParse({ lanes: [], erasureOverdue: counts });
    expect(parsed.success).toBe(false);
    expect(Object.keys(StaffOverview.shape)).toContain("erasureOverdue");
  });
});
