import { describe, expect, test } from "vitest";
import {
  ACCOUNT_ITEM_SCOPE,
  ALREADY_NOT_SHOWN,
  AuthorCasesPage,
  AuthorCasesQuery,
  DecisionAppeal,
  DecisionView,
  NoticeItemStatus,
  OUTCOME_PHRASES,
  PostView,
  QuotedPost,
  REPORTS_PAGE_SIZE,
  REVIEWER_STATES,
  ReportItem,
  ReportsPage,
  ReportsQuery,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  itemOutcomeWords,
  outcomeWords,
} from "../src/index";

/**
 * What the app reads of moderation (3c design, sections 7.6 and 10): the chip's facts on the author's own post, the
 * author's list of decisions and one decision's view, and the reporter's list. Each shape is what its route answers and
 * what the app parses, so this file pins what each may carry.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-10-04T10:00:00.000Z";

const post = (extra: Record<string, unknown> = {}) => ({
  id: id(1),
  author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
  body: "a post",
  createdAt: TIME,
  state: "removed",
  replyTo: null,
  counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
  media: [],
  quoteOf: null,
  ...extra,
});

describe("the chip's facts on a post", () => {
  test("a post may carry the decision behind its state: its id, the rule or the law, and whether korbat is still deciding", () => {
    const chip = { decisionId: id(2), ruleId: "R3", legal: false, interim: false };
    expect(PostView.parse(post({ moderation: chip })).moderation).toEqual(chip);
    expect(PostView.parse(post({ moderation: { decisionId: id(2), ruleId: null, legal: true, interim: true } })).moderation).toEqual({ decisionId: id(2), ruleId: null, legal: true, interim: true });
    expect(PostView.parse(post()).moderation).toBeUndefined();
    for (const ruleId of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(PostView.safeParse(post({ moderation: { ...chip, ruleId } })).success, ruleId).toBe(true);
  });

  test("anything else in its place is refused", () => {
    const chip = { decisionId: id(2), ruleId: "R3", legal: false, interim: false };
    for (const moderation of [{ ...chip, ruleId: "R7" }, { ...chip, decisionId: "no id" }, { ...chip, legal: "yes" }, { decisionId: id(2), ruleId: "R3", legal: false }, null]) {
      expect(PostView.safeParse(post({ moderation })).success, JSON.stringify(moderation)).toBe(false);
    }
  });

  test("a quoted embed carries none: the chip belongs to the card of the post itself", () => {
    const quoted = QuotedPost.parse(post({ moderation: { decisionId: id(2), ruleId: "R3", legal: false, interim: false } }));
    expect("moderation" in quoted).toBe(false);
  });
});

describe("an item's words from the status answer's item", () => {
  const waiting = { position: 1, link: "http://localhost:8081/post/" + id(1), scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };

  test("a released restriction under a rule carries the rule with its title, and a restriction that changed nothing says so; neither is there before the release", () => {
    expect(NoticeItemStatus.parse(waiting)).toEqual(waiting);
    const restricted = { ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", rule: { id: "R3", title: "No targeted hatred" }, noEffect: true };
    expect(NoticeItemStatus.parse(restricted)).toEqual(restricted);
    expect(NoticeItemStatus.safeParse({ ...restricted, rule: { id: "R9", title: "x" } }).success).toBe(false);
    expect(NoticeItemStatus.safeParse({ ...restricted, rule: { id: "R3" } }).success).toBe(false);
    // The mark is there or it is not: a false one is never sent.
    expect(NoticeItemStatus.safeParse({ ...restricted, noEffect: false }).success).toBe(false);
  });

  test("the words are the one composition the mails use, from the item's own facts, and nothing is said before the release", () => {
    expect(itemOutcomeWords(NoticeItemStatus.parse(waiting))).toBeNull();
    const rule = { id: "R3", title: "No targeted hatred" } as const;
    const restricted = NoticeItemStatus.parse({ ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", rule, noEffect: true, scope: "quote" });
    expect(itemOutcomeWords(restricted)).toBe(outcomeWords({ outcome: "restricted_rule", rule, suspect: false, sealed: false, unseen: false, noEffect: true, scope: "quote" }));
    expect(itemOutcomeWords(restricted)).toContain("it breaks korbat rule R3 (No targeted hatred).");
    expect(itemOutcomeWords(restricted)).toContain(ALREADY_NOT_SHOWN);
    const unseen = NoticeItemStatus.parse({ ...waiting, outcome: "no_violation", decidedOn: "2026-10-04", unseen: true });
    expect(itemOutcomeWords(unseen)).toBe(UNSEEN_NO_ACTION);
    const sealed = NoticeItemStatus.parse({ ...waiting, outcome: "restricted_rule", decidedOn: "2026-10-04", suspect: true, sealed: true, rule: { id: "R2", title: "No child sexual abuse material" } });
    expect(itemOutcomeWords(sealed)).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    const dismissed = NoticeItemStatus.parse({ ...waiting, outcome: "not_evident", decidedOn: "2026-10-04", suspect: true });
    expect(itemOutcomeWords(dismissed)).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
  });

  test("an account's item that named nothing keeps its scope in the answer and reads no scope sentence", () => {
    const nothing = NoticeItemStatus.parse({ ...waiting, link: "http://localhost:8081/u/nobody", scope: "account", outcome: "not_available", decidedOn: "2026-10-04" });
    expect(itemOutcomeWords(nothing)).toBe(`${OUTCOME_PHRASES.not_available}.`);
    const answered = NoticeItemStatus.parse({ ...nothing, outcome: "no_violation" });
    expect(itemOutcomeWords(answered)).toBe(`${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`);
  });
});

describe("the author's list of decisions", () => {
  const row = { id: id(3), kind: "final", outcome: "restricted", decidedOn: "2026-10-04", post: { id: id(1), createdAt: TIME }, actions: ["remove"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: "2027-04-04T10:00:00.000Z", reversedOn: null, appeal: null };

  test("a page holds decisions, each with its day, what it did, the post's time for a decision about a post, the rule or the law and where its appeal stands", () => {
    const page = { decisions: [row, { ...row, id: id(4), kind: "interim", post: null, actions: ["reset_bio", "seal_media"], ruleId: null, legal: true, appealUntil: null }], nextCursor: "abc" };
    expect(AuthorCasesPage.parse(page)).toEqual(page);
    expect(AuthorCasesPage.parse({ decisions: [{ ...row, kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null, reversedOn: null }], nextCursor: null }).decisions[0]!.actions).toEqual(["restore"]);
    expect(AuthorCasesPage.safeParse({ decisions: [{ ...row, decidedOn: TIME }], nextCursor: null }).success).toBe(false);
    expect(AuthorCasesPage.safeParse({ decisions: [{ ...row, actions: ["delete"] }], nextCursor: null }).success).toBe(false);
  });

  test("a row says where the author's appeal of the decision stands: none, pending, or its answer", () => {
    for (const appeal of [null, "pending", "kept", "partly_reversed", "reversed"]) {
      expect(AuthorCasesPage.parse({ decisions: [{ ...row, appealUntil: null, appeal }], nextCursor: null }).decisions[0]!.appeal, String(appeal)).toBe(appeal);
    }
    expect(AuthorCasesPage.safeParse({ decisions: [{ ...row, appeal: "answered" }], nextCursor: null }).success).toBe(false);
    const { appeal: _appeal, ...without } = row;
    expect(AuthorCasesPage.safeParse({ decisions: [without], nextCursor: null }).success).toBe(false);
  });

  test("its query takes an optional cursor and nothing else", () => {
    expect(AuthorCasesQuery.parse({})).toEqual({});
    expect(AuthorCasesQuery.parse({ cursor: "abc_-" })).toEqual({ cursor: "abc_-" });
    expect(AuthorCasesQuery.safeParse({ cursor: "" }).success).toBe(false);
    expect(AuthorCasesQuery.safeParse({ cursor: "a b" }).success).toBe(false);
    expect(ReportsQuery.parse({ cursor: "abc" })).toEqual({ cursor: "abc" });
    expect(ReportsQuery.safeParse({ cursor: "x".repeat(401) }).success).toBe(false);
  });
});

describe("one decision as its author reads it", () => {
  const statement = {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R3",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post attacks a group.",
    reason: "It breaks the rule.",
    source: "report",
    decidedAt: TIME,
    post: { id: id(1), createdAt: TIME },
    measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
  };
  const image = { id: id(7), alt: "a picture", width: 800, height: 600, small: `/api/media/${id(7)}/small.webp`, large: `/api/media/${id(7)}/large.webp` };
  const view = { id: id(3), ...statement, appealUntil: "2027-04-04T10:00:00.000Z", reversedOn: null, content: { kind: "post", body: "the words", deletedByAuthor: false, images: [image], imageCount: 1, imagesHidden: null }, appeal: null };

  test("it is the statement's data with what the author's screen adds: where the appeal stands and the content actioned", () => {
    expect(DecisionView.parse(view)).toEqual(view);
    expect(DecisionView.safeParse({ ...view, content: undefined }).success).toBe(false);
    expect(DecisionView.safeParse({ ...view, id: undefined }).success).toBe(false);
  });

  test("the content is the post's text with its images, an account's fields, or the reason it is not shown", () => {
    const contents = [
      { kind: "post", body: "", deletedByAuthor: true, images: [], imageCount: 2, imagesHidden: "deleted_by_author" },
      { kind: "post", body: "text stays", deletedByAuthor: false, images: [], imageCount: 3, imagesHidden: "sealed" },
      { kind: "account", handle: "ada", displayName: "Ada", bio: "hello" },
      { kind: "r4_redacted" },
      { kind: "erased", contentErasedOn: "2026-10-05", postKept: true },
      { kind: "erased", contentErasedOn: "2026-10-05", postKept: false },
    ];
    for (const content of contents) expect(DecisionView.parse({ ...view, content }).content, content.kind).toEqual(content);
    for (const content of [{ kind: "erased" }, { kind: "post", body: "x" }, { kind: "sealed" }, { kind: "post", body: "x", deletedByAuthor: false, images: [], imageCount: 1, imagesHidden: "withheld" }]) {
      expect(DecisionView.safeParse({ ...view, content }).success, JSON.stringify(content)).toBe(false);
    }
  });

  test("the appeal is none, pending with who may review it as two answers that name nobody, or answered with the answering decision's statement", () => {
    const pending = { state: "pending", filedAt: TIME, reviewer: "none_single_staff", needsAdmin: true };
    const answered = { state: "answered", filedAt: TIME, answeredOn: "2026-10-09", result: "kept", answeredBy: id(9), statement: { ...statement, kind: "review", outcome: "kept" } };
    for (const appeal of [pending, { ...pending, reviewer: "available", needsAdmin: false }, { ...pending, reviewer: "none_eligible" }, answered, { ...answered, result: "partly_reversed" }, { ...answered, result: "reversed" }]) {
      expect(DecisionView.parse({ ...view, appealUntil: null, appeal }).appeal, JSON.stringify(appeal).slice(0, 60)).toEqual(appeal);
    }
    expect(DecisionAppeal.parse(pending)).toEqual(pending);
    expect(REVIEWER_STATES).toEqual(["available", "none_single_staff", "none_eligible"]);
    // Each state is a strict shape: nothing of who took part in the case, and no answer without its statement.
    for (const appeal of [{ ...pending, reviewer: "nobody" }, { ...pending, decidedBy: "mod_anna" }, { ...pending, mayReview: false }, { ...answered, statement: undefined }, { ...answered, result: "pending" }, { ...answered, answeredOn: TIME }, { state: "none" }]) {
      expect(DecisionView.safeParse({ ...view, appeal }).success, JSON.stringify(appeal).slice(0, 60)).toBe(false);
    }
    const { appeal: _appeal, ...without } = view;
    expect(DecisionView.safeParse(without).success).toBe(false);
  });

  test("an image of the content carries what the app's own image route needs, and nothing of an image that is not shown", () => {
    expect(DecisionView.safeParse({ ...view, content: { ...view.content, images: [{ id: id(7), alt: "a picture" }] } }).success).toBe(false);
  });
});

describe("the reporter's list", () => {
  const item = { id: id(5), position: 1, link: "http://localhost:8081/u/ada", scope: "account", suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };

  test("a page holds the account's reports, each with its reference, its time and its items in the status page's shape with their ids, and says whether korbat's report mails to the account are stopped", () => {
    const page = { reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [item, { ...item, position: 2, outcome: "no_violation", decidedOn: "2026-10-04", reexamination: { open: true, until: "2027-04-04T07:00:00.000Z" } }] }], nextCursor: null, reportMailStopped: true };
    expect(ReportsPage.parse(page)).toEqual(page);
    expect(ReportsPage.safeParse({ ...page, reportMailStopped: undefined }).success).toBe(false);
    expect(ReportsPage.safeParse({ ...page, reports: [{ ref: "nope", receivedAt: TIME, items: [] }] }).success).toBe(false);
    // An item of the list carries its id, by which its sender asks for a re-examination; the status page's item never does.
    const { id: _id, ...asOnThePage } = item;
    expect(ReportsPage.safeParse({ ...page, reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [asOnThePage] }] }).success).toBe(false);
    expect(ReportItem.parse(item)).toEqual(item);
    expect(Object.keys(NoticeItemStatus.shape)).not.toContain("id");
    expect(REPORTS_PAGE_SIZE).toBe(20);
    expect(ReportsPage.safeParse({ ...page, reports: Array.from({ length: REPORTS_PAGE_SIZE + 1 }, () => page.reports[0]) }).success).toBe(false);
  });
});
