import { describe, expect, test } from "vitest";
import {
  ACCOUNT_ITEM_SCOPE,
  ACCOUNT_SUSPECT_SCOPE,
  ALREADY_NOT_SHOWN,
  CaseView,
  DecisionStatement,
  ITEM_OUTCOMES,
  OUTCOME_PHRASES,
  QUOTE_ITEM_SCOPE,
  SEAL_DRAFTS,
  SUSPECT_NO_SEAL,
  SUSPECT_OUTCOME_PHRASES,
  StaffOverview,
  UNSEEN_NO_ACTION,
  outcomeWords,
  sealFactsDraft,
  type ItemOutcome,
  type OutcomeWordsInput,
} from "../src/index";

/**
 * The words a report's sender reads for an outcome, and the console's fixed drafts for a seal (3c design, section 10).
 * Each table is the one place its words are written: the mails, the status page, the app's list and the console take
 * them from here, so this file pins every word once.
 */
const RULE = { id: "R1", title: "No sexual or pornographic content" };

/** One item's facts, plain unless a test says otherwise: a post that quotes nothing, answered by a decision that saw its images. */
const words = (outcome: ItemOutcome, facts: Partial<OutcomeWordsInput> = {}): string =>
  outcomeWords({ outcome, rule: outcome === "restricted_rule" ? RULE : null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null, ...facts });

describe("the outcome phrases", () => {
  test("there is exactly one phrase for each outcome an item can be shown, word for word", () => {
    expect(Object.keys(OUTCOME_PHRASES).sort()).toEqual([...ITEM_OUTCOMES].sort());
    expect(OUTCOME_PHRASES).toEqual({
      restricted_rule: "access restricted: it breaks korbat rule {rule} ({title})",
      restricted_legal: "access restricted: korbat found it illegal",
      no_violation: "no action: korbat found no breach of its rules and nothing illegal",
      not_evident:
        "no action: korbat found no breach of its rules, and whether it is illegal cannot be seen without a detailed legal examination; a court or an authority can order its removal",
      not_available: "no action: the link names nothing korbat can show (checked automatically)",
      partly_reversed: "korbat reversed part of its decision to restrict it",
      reversed: "korbat reversed its decision to restrict it",
    });
  });

  test("the sentences that follow an outcome, and the phrases of the path for child sexual abuse material, word for word", () => {
    expect(ALREADY_NOT_SHOWN).toBe("It was already not shown on korbat, so nothing changed now; korbat's restriction stays in force should that change.");
    expect(ACCOUNT_ITEM_SCOPE).toBe("This answer concerns the account's display name and bio. korbat decides about its posts and images in cases of their own and does not report those here.");
    expect(QUOTE_ITEM_SCOPE).toBe(
      "This answer concerns this post's own text and images. korbat decides about the post it quotes, shown inside its card, in a case of its own and does not report that here.",
    );
    expect(ACCOUNT_SUSPECT_SCOPE).toBe(
      "This answer concerns the account's display name and bio and, taken together, the images on its posts. korbat decides about single posts of the account, and about what its posts say, in cases of their own and does not report those here.",
    );
    expect(SUSPECT_OUTCOME_PHRASES).toEqual({
      sealed: "access restricted: korbat sealed its images without opening them. They are shown to nobody, their author included, and are kept for the authorities.",
      no_action:
        "no action: korbat's staff do not open images reported this way. An admin found in the report, and in what korbat can read and still holds of it, no sufficient ground to seal images or to restrict anything else.",
    });
    expect(SUSPECT_NO_SEAL).toBe("No image was sealed; korbat's staff do not open images reported this way.");
    expect(UNSEEN_NO_ACTION).toBe(
      "no action for now: when korbat decided, its staff could not open this post's images, because a report of another kind about them was waiting or they were sealed. If your report is about an image, ask for a re-examination.",
    );
  });
});

describe("outcomeWords: one item's outcome as its sender reads it", () => {
  test("an ordinary item reads its outcome's phrase, a rule's with its id and title, and ends in one full stop", () => {
    expect(words("restricted_rule")).toBe("access restricted: it breaks korbat rule R1 (No sexual or pornographic content).");
    expect(words("restricted_legal")).toBe("access restricted: korbat found it illegal.");
    expect(words("no_violation")).toBe("no action: korbat found no breach of its rules and nothing illegal.");
    expect(words("not_evident")).toBe(`${OUTCOME_PHRASES.not_evident}.`);
    expect(words("not_available")).toBe(`${OUTCOME_PHRASES.not_available}.`);
    expect(words("partly_reversed")).toBe(`${OUTCOME_PHRASES.partly_reversed}.`);
    expect(words("reversed")).toBe(`${OUTCOME_PHRASES.reversed}.`);
    // A phrase that fills nothing in never keeps a placeholder, and no outcome ends in two full stops.
    for (const outcome of ITEM_OUTCOMES) {
      for (const facts of [{}, { suspect: true }, { sealed: true }, { unseen: true }, { noEffect: true }, { scope: "account" as const }, { scope: "quote" as const }, { scope: "account_suspect" as const }]) {
        const text = words(outcome, facts);
        expect(text, `${outcome} ${JSON.stringify(facts)}`).not.toMatch(/[{}]|[.][.]|[.] [.]/);
        expect(text.endsWith("."), `${outcome} ${JSON.stringify(facts)}`).toBe(true);
      }
    }
  });

  test("a restriction under a rule that is not named is refused: the phrase would keep its placeholder", () => {
    expect(() => outcomeWords({ outcome: "restricted_rule", rule: null, suspect: false, sealed: false, unseen: false, noEffect: false, scope: null })).toThrow(/rule/);
  });

  test("ALREADY_NOT_SHOWN follows a restricting outcome whose measures all changed nothing, a seal's included, and no other outcome", () => {
    expect(words("restricted_rule", { noEffect: true })).toBe(`access restricted: it breaks korbat rule R1 (No sexual or pornographic content). ${ALREADY_NOT_SHOWN}`);
    expect(words("restricted_legal", { noEffect: true })).toBe(`access restricted: korbat found it illegal. ${ALREADY_NOT_SHOWN}`);
    expect(words("restricted_rule", { noEffect: true, sealed: true })).toBe(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ALREADY_NOT_SHOWN}`);
    for (const outcome of ["no_violation", "not_evident", "not_available", "partly_reversed", "reversed"] as const) expect(words(outcome, { noEffect: true }), outcome).not.toContain(ALREADY_NOT_SHOWN);
  });

  test("ACCOUNT_ITEM_SCOPE follows the outcome of exactly the items about an account that are not suspect and whose decision sealed nothing", () => {
    for (const outcome of ITEM_OUTCOMES) {
      const text = words(outcome, { scope: "account" });
      expect(text.endsWith(` ${ACCOUNT_ITEM_SCOPE}`), outcome).toBe(outcome !== "not_available");
      expect(text, outcome).not.toContain(ACCOUNT_SUSPECT_SCOPE);
      for (const scope of [null, "quote", "account_suspect"] as const) expect(words(outcome, { scope }), `${outcome} ${String(scope)}`).not.toContain(ACCOUNT_ITEM_SCOPE);
    }
    // After the already-not-shown sentence when both apply.
    expect(words("restricted_legal", { noEffect: true, scope: "account" })).toBe(`access restricted: korbat found it illegal. ${ALREADY_NOT_SHOWN} ${ACCOUNT_ITEM_SCOPE}`);
  });

  test("QUOTE_ITEM_SCOPE follows the outcome of exactly the items about a post that quotes another, after ALREADY_NOT_SHOWN when both apply", () => {
    for (const outcome of ITEM_OUTCOMES) {
      expect(words(outcome, { scope: "quote" }).endsWith(` ${QUOTE_ITEM_SCOPE}`), outcome).toBe(outcome !== "not_available");
      for (const scope of [null, "account", "account_suspect"] as const) expect(words(outcome, { scope }), `${outcome} ${String(scope)}`).not.toContain(QUOTE_ITEM_SCOPE);
    }
    expect(words("restricted_rule", { noEffect: true, scope: "quote" })).toBe(`access restricted: it breaks korbat rule R1 (No sexual or pornographic content). ${ALREADY_NOT_SHOWN} ${QUOTE_ITEM_SCOPE}`);
  });

  test("ACCOUNT_SUSPECT_SCOPE follows the outcome of exactly the items about an account that are suspect or that a sealing decision answered, a rule report merged into a sealed account case among them", () => {
    for (const outcome of ITEM_OUTCOMES) {
      expect(words(outcome, { scope: "account_suspect", suspect: true }).endsWith(` ${ACCOUNT_SUSPECT_SCOPE}`), outcome).toBe(outcome !== "not_available");
      for (const scope of [null, "account", "quote"] as const) expect(words(outcome, { scope }), `${outcome} ${String(scope)}`).not.toContain(ACCOUNT_SUSPECT_SCOPE);
    }
    // A rule report about an account that an answer with a seal answered: the sealed phrase, then the scope.
    expect(words("restricted_rule", { sealed: true, scope: "account_suspect" })).toBe(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
  });

  test("a suspect item is worded from SUSPECT_OUTCOME_PHRASES, never from the four words for a finding alone", () => {
    expect(words("no_violation", { suspect: true })).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
    expect(words("not_evident", { suspect: true })).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
    expect(words("restricted_rule", { suspect: true, sealed: true })).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(words("restricted_legal", { suspect: true, sealed: true })).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    // Answered by a measure on the post's text without a seal: the phrase of that finding, then that no image was sealed.
    expect(words("restricted_rule", { suspect: true })).toBe(`access restricted: it breaks korbat rule R1 (No sexual or pornographic content). ${SUSPECT_NO_SEAL}`);
    expect(words("restricted_legal", { suspect: true })).toBe(`access restricted: korbat found it illegal. ${SUSPECT_NO_SEAL}`);
    for (const outcome of ["no_violation", "not_evident", "restricted_rule", "restricted_legal"] as const) {
      for (const sealed of [false, true]) {
        const text = words(outcome, { suspect: true, sealed });
        expect(text === `${OUTCOME_PHRASES[outcome]}.` || text === "access restricted: it breaks korbat rule R1 (No sexual or pornographic content).", `${outcome} ${sealed}`).toBe(false);
      }
    }
    // The other three outcomes are worded as for any item.
    expect(words("not_available", { suspect: true })).toBe(`${OUTCOME_PHRASES.not_available}.`);
    expect(words("partly_reversed", { suspect: true, sealed: true })).toBe(`${OUTCOME_PHRASES.partly_reversed}.`);
    expect(words("reversed", { suspect: true, sealed: true })).toBe(`${OUTCOME_PHRASES.reversed}.`);
  });

  test("the sealed phrase stands for every item a sealing decision answered, suspect or not, in place of both restricting phrases", () => {
    for (const suspect of [false, true]) {
      expect(words("restricted_rule", { sealed: true, suspect })).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
      expect(words("restricted_legal", { sealed: true, suspect })).toBe(SUSPECT_OUTCOME_PHRASES.sealed);
    }
  });

  test("an item on another ground about a post, answered without action while nobody could open its images, reads UNSEEN_NO_ACTION, and no other item does", () => {
    expect(words("no_violation", { unseen: true })).toBe(UNSEEN_NO_ACTION);
    expect(words("not_evident", { unseen: true })).toBe(UNSEEN_NO_ACTION);
    // A restriction, a reversal and a link that named nothing keep their own words, and a suspect item its own phrase.
    for (const outcome of ["restricted_rule", "restricted_legal", "not_available", "partly_reversed", "reversed"] as const) expect(words(outcome, { unseen: true }), outcome).not.toContain(UNSEEN_NO_ACTION);
    expect(words("no_violation", { unseen: true, suspect: true })).toBe(SUSPECT_OUTCOME_PHRASES.no_action);
    // An item about an account is never worded this way, whatever its decision's mark: it keeps the ordinary phrase with its scope.
    expect(words("no_violation", { unseen: true, scope: "account" })).toBe(`${OUTCOME_PHRASES.no_violation}. ${ACCOUNT_ITEM_SCOPE}`);
    expect(words("not_evident", { unseen: true, scope: "account_suspect" })).toBe(`${OUTCOME_PHRASES.not_evident}. ${ACCOUNT_SUSPECT_SCOPE}`);
    // On a post that quotes another the scope follows it as it follows any outcome.
    expect(words("no_violation", { unseen: true, scope: "quote" })).toBe(`${UNSEEN_NO_ACTION} ${QUOTE_ITEM_SCOPE}`);
  });
});

describe("the console's fixed drafts for a seal", () => {
  test("SEAL_DRAFTS holds its eight texts, word for word", () => {
    expect(SEAL_DRAFTS).toEqual({
      facts: {
        notice_post: "korbat received a notice that reports images of this post as child sexual abuse material.",
        notice_account: "korbat received a notice that reports this account for child sexual abuse material. It does not say which images, so korbat sealed every image on the account's posts.",
        notice_added: "korbat received a notice about content on korbat that shows this post's images and reports them as child sexual abuse material.",
        finding_post: "A moderator reported images of this post as possible child sexual abuse material.",
        finding_account: "A moderator reported images on this account's posts as possible child sexual abuse material. korbat sealed every image on the account's posts.",
        finding_added: "A moderator reported content on korbat that shows this post's images as possible child sexual abuse material.",
      },
      reason: {
        deciding: "korbat's staff do not open images reported this way, so korbat has not assessed them. It hides them from everyone, you included, until an admin has answered the report.",
        final:
          "korbat's staff do not open images reported this way, so korbat has not assessed them. An admin found the report credible enough to keep the images sealed and to report them to the police, who can assess them.",
      },
    });
    expect(Object.keys(SEAL_DRAFTS.facts).length + Object.keys(SEAL_DRAFTS.reason).length).toBe(8);
  });

  test("none says that korbat found the images to be such material, and each reason says that staff do not open them", () => {
    for (const text of [...Object.values(SEAL_DRAFTS.facts), ...Object.values(SEAL_DRAFTS.reason)]) {
      expect(text).not.toMatch(/korbat found|is child sexual abuse material|are child sexual abuse material/);
    }
    for (const text of Object.values(SEAL_DRAFTS.reason)) expect(text).toContain("korbat's staff do not open images reported this way");
    // The two drafts for an added item never say that this post was reported, and name no other post.
    for (const text of [SEAL_DRAFTS.facts.notice_added, SEAL_DRAFTS.facts.finding_added]) expect(text).not.toMatch(/of this post as|this post was|quot/);
  });

  test("the facts draft follows the suspect items the decision considers: a notice when any came from a user, the added form when every one was added by korbat, else by the case's target", () => {
    const item = (source: "user" | "finding", added = false) => ({ source, added });
    expect(sealFactsDraft("post", [item("user")])).toBe(SEAL_DRAFTS.facts.notice_post);
    expect(sealFactsDraft("account", [item("user")])).toBe(SEAL_DRAFTS.facts.notice_account);
    expect(sealFactsDraft("post", [item("finding")])).toBe(SEAL_DRAFTS.facts.finding_post);
    expect(sealFactsDraft("account", [item("finding")])).toBe(SEAL_DRAFTS.facts.finding_account);
    // A notice among findings makes it a notice's draft.
    expect(sealFactsDraft("post", [item("finding"), item("user")])).toBe(SEAL_DRAFTS.facts.notice_post);
    // Every item added for a quoted post (or a re-examination of one): the added form; one named item among them: the post's.
    expect(sealFactsDraft("post", [item("user", true), item("user", true)])).toBe(SEAL_DRAFTS.facts.notice_added);
    expect(sealFactsDraft("post", [item("finding", true)])).toBe(SEAL_DRAFTS.facts.finding_added);
    expect(sealFactsDraft("post", [item("user", true), item("finding")])).toBe(SEAL_DRAFTS.facts.notice_post);
    expect(() => sealFactsDraft("post", [])).toThrow(/suspect item/);
  });
});

describe("the statement's data", () => {
  const statement = {
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post offers followers for money.",
    reason: "That is spam under R6.",
    source: "report",
    decidedAt: "2026-10-04T09:00:00.000Z",
    post: { id: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", createdAt: "2026-10-01T12:00:00.000Z" },
    measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
  };

  test("DecisionStatement takes a decision's data, and refuses a reversal among the measures and a measure among the reversals", () => {
    expect(DecisionStatement.parse(statement)).toEqual(statement);
    expect(DecisionStatement.safeParse({ ...statement, measures: [{ kind: "restore", mediaId: null, noEffect: null, sealed: null }] }).success).toBe(false);
    expect(DecisionStatement.safeParse({ ...statement, reversals: [{ kind: "remove", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }] }).success).toBe(false);
    const sealed = { kind: "seal_media", mediaId: null, noEffect: null, sealed: { posts: 3, images: 7, deletedImages: 2 } };
    expect(DecisionStatement.parse({ ...statement, post: null, measures: [sealed] }).measures).toEqual([sealed]);
    const reviewed = { kind: "final", ground: "illegal", ruleId: null, rulesVersion: 1, legalReference: "Section 241 of the criminal code", decidedAt: "2026-10-01T09:00:00.000Z" };
    const lifted = { kind: "restore_bio", mediaId: null, resetDecisionId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", oldValueKept: true, resetRuleId: "R4" };
    expect(DecisionStatement.parse({ ...statement, kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, post: null, measures: [], reversals: [lifted], reviewed })).toMatchObject({ reviewed, reversals: [lifted] });
  });
});

describe("the home screen's three lists of the path for child sexual abuse material", () => {
  const overview = {
    lanes: [0, 1, 2].map((lane) => ({ lane, open: 0, oldestAt: null })),
    appealsWaiting: 0,
    appealsYouMayReview: 0,
    appealsWithoutReviewer: 0,
    reveals: { total: 0, items: [] },
    imagesToday: [],
    findingsToday: [],
    mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
    mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
    releaseOverdue: 0,
    erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 },
    deferUnproven: false,
    protectionLifted: { total: 2, items: [{ at: "2026-10-04T09:00:00.000Z", handle: "mod_anna", caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", kind: "unsealed" }] },
    sealsDeclined: { total: 1, items: [{ at: "2026-10-04T09:00:00.000Z", handle: "mod_anna", caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a" }] },
    interimSeals: { total: 1, items: [{ at: "2026-10-04T09:00:00.000Z", handle: "mod_anna", caseId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", posts: 3, images: 7 }] },
    repliesWaiting: { count: 0, oldestAt: null },
    strikeAccounts: 0,
  };

  test("StaffOverview carries the decisions that lifted the protection of reported images, the choices not to seal and the seals taken while deciding that are in force", () => {
    expect(StaffOverview.parse(overview)).toEqual(overview);
    for (const list of ["protectionLifted", "sealsDeclined", "interimSeals"] as const) {
      const { [list]: _left, ...rest } = overview;
      expect(StaffOverview.safeParse(rest).success, list).toBe(false);
    }
    // What a lifting decision did is one of two words.
    expect(StaffOverview.safeParse({ ...overview, protectionLifted: { total: 1, items: [{ ...overview.protectionLifted.items[0]!, kind: "restored" }] } }).success).toBe(false);
    expect(StaffOverview.parse({ ...overview, protectionLifted: { total: 1, items: [{ ...overview.protectionLifted.items[0]!, kind: "dismissed" }] } }).protectionLifted.items[0]!.kind).toBe("dismissed");
  });

  test("the decision route answers the case, and the contracts no longer name an answer of its own for it", async () => {
    const contracts = (await import("../src/index")) as Record<string, unknown>;
    expect(contracts.CaseDecisionResponse).toBeUndefined();
    expect(CaseView).toBeDefined();
  });
});
