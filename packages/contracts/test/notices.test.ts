import { describe, expect, test } from "vitest";
import {
  CSAM_KEYWORDS,
  ITEM_OUTCOMES,
  ItemOutcome,
  NOTICE_LIMITS,
  NOTICE_NAME_MAX,
  NoticeContactRequest,
  NoticeRequest,
  NoticeResponse,
  NoticeStatus,
  NoticeStatusRequest,
  NoticeTarget,
  REPORT_RULE_IDS,
  TDB_FORM_CATEGORIES,
} from "../src/index";

// Reports and notices (3c design, sections 7.1, 7.2 and 10): what POST /api/notices takes and what the status page reads.

const POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ab";
const OTHER_POST = "0190f3a2-7c1e-7b1a-9f00-0123456789ac";
const MEDIA = "0190f3a2-7c1e-7b1a-9f00-0123456789ad";
const TOKEN = "A".repeat(43);
const postTarget = { kind: "post", id: POST } as const;

const rule = { ground: "rule", ruleId: "R1", targets: [postTarget] };
const illegal = { ground: "illegal", targets: [postTarget], category: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH", explanation: "It is a threat under section 241.", bonaFide: true };
const csam = { ground: "csam", targets: [postTarget], keyword: "csam" };

const accepted = (value: unknown) => NoticeRequest.safeParse(value).success;

/** Characters built in code: a file of this repository holds none of them as a literal. */
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const LONE_SURROGATE = String.fromCharCode(0xd800);
const GRINNING = String.fromCodePoint(0x1f600);

describe("a notice's targets", () => {
  test("a post by its id, with or without one of its images, in the lower case the database keeps", () => {
    expect(NoticeTarget.parse({ kind: "post", id: POST.toUpperCase() })).toEqual({ kind: "post", id: POST });
    expect(NoticeTarget.parse({ kind: "post", id: POST, mediaId: MEDIA.toUpperCase() })).toEqual({ kind: "post", id: POST, mediaId: MEDIA });
    expect(NoticeTarget.safeParse({ kind: "post", id: "not-an-id" }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "post", id: POST, mediaId: "x" }).success).toBe(false);
  });

  test("an account by its handle, with or without the @, kept in lower case", () => {
    expect(NoticeTarget.parse({ kind: "account", handle: "@Ada_99" })).toEqual({ kind: "account", handle: "ada_99" });
    expect(NoticeTarget.parse({ kind: "account", handle: " ada " })).toEqual({ kind: "account", handle: "ada" });
    for (const handle of ["ab", "a".repeat(21), "ada lovelace", "ada-lovelace", ""]) expect(NoticeTarget.safeParse({ kind: "account", handle }).success, handle).toBe(false);
  });

  test("a link of at most 300 characters that is an http or https address; whose address it is the route decides", () => {
    for (const url of ["http://localhost:8081/post/" + POST, "https://korbat.example/u/ada", "https://elsewhere.example/anything"]) {
      expect(NoticeTarget.parse({ kind: "link", url })).toEqual({ kind: "link", url });
    }
    for (const url of ["javascript:alert(1)", "ftp://korbat.example/post/" + POST, "korbat.example/u/ada", "/u/ada", "", "https://korbat.example/" + "a".repeat(300)]) {
      expect(NoticeTarget.safeParse({ kind: "link", url }).success, url).toBe(false);
    }
  });

  test("a target of no kind, of another kind, or with a member that is not its own is refused", () => {
    expect(NoticeTarget.safeParse({ id: POST }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "image", id: MEDIA }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "post", id: POST, handle: "ada" }).success).toBe(false);
    expect(NoticeTarget.safeParse({ kind: "account", handle: "ada", id: POST }).success).toBe(false);
  });
});

describe("NoticeRequest", () => {
  test("the three grounds, each with what it needs and nothing more", () => {
    expect(NoticeRequest.parse(rule)).toEqual(rule);
    expect(NoticeRequest.parse(illegal)).toEqual(illegal);
    expect(NoticeRequest.parse(csam)).toEqual(csam);
    expect(accepted({ targets: [postTarget] })).toBe(false);
    expect(accepted({ ...rule, ground: "other" })).toBe(false);
  });

  test("accepted: a rule notice with a turnstileToken, a CSAM notice without explanation or bona fide, a CSAM notice with keyword abuse", () => {
    expect(accepted({ ...rule, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })).toBe(true);
    expect(accepted({ ground: "csam", targets: [postTarget], keyword: "abuse" })).toBe(true);
    for (const keyword of Object.keys(CSAM_KEYWORDS)) expect(accepted({ ...csam, keyword }), keyword).toBe(true);
    expect(accepted({ ...csam, explanation: "The second image.", bonaFide: true, turnstileToken: "t" })).toBe(true);
    expect(accepted({ ...csam, bonaFide: false })).toBe(true);
    // Every rule but R2, on the rule ground and beside an allegation of illegality.
    for (const ruleId of REPORT_RULE_IDS) {
      expect(accepted({ ...rule, ruleId }), ruleId).toBe(true);
      expect(accepted({ ...illegal, ruleId }), ruleId).toBe(true);
    }
    expect(REPORT_RULE_IDS).toEqual(["R1", "R3", "R4", "R5", "R6"]);
  });

  test("refused: a rule report or an illegal-ground notice citing R2, which only a moderator's finding cites", () => {
    expect(accepted({ ...rule, ruleId: "R2" })).toBe(false);
    expect(accepted({ ...illegal, ruleId: "R2" })).toBe(false);
    expect(accepted({ ...rule, ruleId: "R7" })).toBe(false);
    expect(accepted({ ground: "rule", targets: [postTarget] })).toBe(false);
  });

  test("refused: a CSAM notice with a name or an email, and a rule report with either: only the illegal ground asks for them", () => {
    expect(accepted({ ...csam, name: "Ada" })).toBe(false);
    expect(accepted({ ...csam, email: "ada@example.com" })).toBe(false);
    expect(accepted({ ...rule, email: "ada@example.com" })).toBe(false);
    expect(accepted({ ...csam, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(false);
    expect(accepted({ ...csam, keyword: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL" })).toBe(false);
    expect(accepted({ ground: "csam", targets: [postTarget] })).toBe(false);
  });

  test("an illegal-ground notice may carry a name and an email; the address is kept trimmed and in lower case", () => {
    const parsed = NoticeRequest.parse({ ...illegal, name: "Ada Lovelace", email: " Ada@Example.COM ", citedLaw: "StGB 241" });
    expect(parsed).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com", citedLaw: "StGB 241" });
    expect(accepted({ ...illegal, email: "not an address" })).toBe(false);
    expect(accepted({ ...illegal, name: "" })).toBe(false);
    expect(accepted({ ...illegal, name: "a".repeat(NOTICE_NAME_MAX) })).toBe(true);
    expect(accepted({ ...illegal, name: "a".repeat(NOTICE_NAME_MAX + 1) })).toBe(false);
    expect(accepted({ ...illegal, name: `Ada${LF}Lovelace` })).toBe(false);
    expect(NOTICE_NAME_MAX).toBe(100);
  });

  test("an illegal-ground notice needs its explanation, its good-faith statement and a category the form offers or 'not sure'", () => {
    const { explanation: _explanation, ...withoutExplanation } = illegal;
    expect(accepted(withoutExplanation)).toBe(false);
    expect(accepted({ ...illegal, bonaFide: false })).toBe(false);
    const { bonaFide: _bonaFide, ...withoutStatement } = illegal;
    expect(accepted(withoutStatement)).toBe(false);
    for (const category of [...TDB_FORM_CATEGORIES, "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"]) expect(accepted({ ...illegal, category }), category).toBe(true);
    // A rule-only report gets this category from the server; a notice of illegality never carries it.
    expect(accepted({ ...illegal, category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" })).toBe(false);
    expect(accepted({ ...illegal, category: "STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT" })).toBe(false);
  });

  test("one to ten targets: none and eleven are refused", () => {
    expect(NOTICE_LIMITS.maxTargets).toBe(10);
    const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "post", id: `0190f3a2-7c1e-7b1a-9f00-${String(i).padStart(12, "0")}` }));
    expect(accepted({ ...rule, targets: [] })).toBe(false);
    expect(accepted({ ...rule, targets: posts(10) })).toBe(true);
    expect(accepted({ ...rule, targets: posts(11) })).toBe(false);
    expect(accepted({ ...csam, targets: posts(11) })).toBe(false);
  });

  test("refused: a CSAM notice with two account targets; one account, also named twice, and beside posts, is accepted", () => {
    const account = (handle: string) => ({ kind: "account", handle });
    expect(accepted({ ...csam, targets: [account("ada"), account("bob")] })).toBe(false);
    expect(accepted({ ...csam, targets: [account("ada"), postTarget, account("bob")] })).toBe(false);
    expect(accepted({ ...csam, targets: [account("ada")] })).toBe(true);
    expect(accepted({ ...csam, targets: [account("ada"), account("@ADA"), postTarget, { kind: "post", id: OTHER_POST }] })).toBe(true);
    // On the other grounds a notice may name several accounts.
    expect(accepted({ ...rule, targets: [account("ada"), account("bob")] })).toBe(true);
    expect(accepted({ ...illegal, targets: [account("ada"), account("bob")] })).toBe(true);
  });

  test("refused: an off-pattern link", () => {
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "see my profile" }] })).toBe(false);
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "mailto:ada@example.com" }] })).toBe(false);
    expect(accepted({ ...rule, targets: [{ kind: "link", url: "https://korbat.example/post/" + POST }] })).toBe(true);
  });

  test("every text is taken as written or refused, never changed: its bounds, and no control or disguising character", () => {
    const withText = (explanation: string) => ({ ...illegal, explanation });
    const kept = `  first line${LF}${LF}${LF}second line ${GRINNING} `;
    expect(NoticeRequest.parse(withText(kept))).toMatchObject({ explanation: kept });
    expect(NOTICE_LIMITS.explanationMax).toBe(2000);
    expect(accepted(withText("a".repeat(2000)))).toBe(true);
    expect(accepted(withText("a".repeat(2001)))).toBe(false);
    // Counted as PostgreSQL's char_length counts: a character outside the basic plane is one.
    expect(accepted(withText(GRINNING.repeat(2000)))).toBe(true);
    expect(accepted(withText(GRINNING.repeat(2001)))).toBe(false);
    for (const [name, bad] of [["NUL", NUL], ["a tab", TAB], ["a carriage return", CR], ["a zero-width space", ZERO_WIDTH_SPACE], ["a direction override", RIGHT_TO_LEFT_OVERRIDE], ["a lone surrogate", LONE_SURROGATE]] as const) {
      expect(accepted(withText(`an explanation with ${bad} in it`)), name).toBe(false);
    }
    expect(accepted(withText(""))).toBe(false);
    expect(accepted(withText(`  ${LF} `))).toBe(false);
    expect(accepted({ ...illegal, citedLaw: "a".repeat(NOTICE_LIMITS.citedLawMax) })).toBe(true);
    expect(accepted({ ...illegal, citedLaw: "a".repeat(NOTICE_LIMITS.citedLawMax + 1) })).toBe(false);
    expect(accepted({ ...rule, explanation: "a".repeat(2001) })).toBe(false);
    expect(accepted({ ...csam, explanation: `with ${ZERO_WIDTH_SPACE}` })).toBe(false);
  });
});

describe("the notice's answers and the status page", () => {
  test("the answer carries the reference, and the token only where there is one", () => {
    expect(NoticeResponse.parse({ ref: "N-ABCDEFGH23", token: TOKEN })).toEqual({ ref: "N-ABCDEFGH23", token: TOKEN });
    expect(NoticeResponse.parse({ ref: "N-ABCDEFGH23" })).toEqual({ ref: "N-ABCDEFGH23" });
    expect(NoticeResponse.safeParse({ ref: "N-abcdefgh23" }).success).toBe(false);
    expect(NoticeResponse.safeParse({ ref: "N-ABCDEFGH23", token: "short" }).success).toBe(false);
  });

  test("the status and contact requests take a reference and a token, and the contact request one of two choices", () => {
    expect(NoticeStatusRequest.parse({ ref: "N-ABCDEFGH23", token: TOKEN })).toEqual({ ref: "N-ABCDEFGH23", token: TOKEN });
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH23" }).success).toBe(false);
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH2", token: TOKEN }).success).toBe(false);
    expect(NoticeStatusRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, position: 1 }).success).toBe(false);
    for (const choice of ["confirm", "stop"]) expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, choice }).success, choice).toBe(true);
    expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN, choice: "resume" }).success).toBe(false);
    expect(NoticeContactRequest.safeParse({ ref: "N-ABCDEFGH23", token: TOKEN }).success).toBe(false);
  });

  test("the outcomes an item can be shown are the seven of the database's item_outcome", () => {
    expect(ITEM_OUTCOMES).toEqual(["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]);
    expect(ItemOutcome.options).toEqual([...ITEM_OUTCOMES]);
  });

  test("the status answer: each item with its link, scope and marks, its outcome and day only once released, and the contact's facts", () => {
    const waiting = { position: 1, link: "http://localhost:8081/post/" + POST, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
    const answered = { ...waiting, position: 11, link: "http://localhost:8081/u/ada", scope: "account_suspect", suspect: true, sealed: true, quotedBy: 1, outcome: "no_violation", decidedOn: "2026-10-04", reexamination: { open: true, until: "2027-04-04T07:00:00.000Z" } };
    const status = { ref: "N-ABCDEFGH23", receivedAt: "2026-10-04T06:59:59.123Z", items: [waiting, answered], contact: { given: true, confirmed: null, stopped: null } };
    expect(NoticeStatus.parse(status)).toEqual(status);
    expect(NoticeStatus.parse({ ...status, contact: null }).contact).toBeNull();
    expect(NoticeStatus.parse({ ...status, contact: { given: true, confirmed: true, stopped: false } }).contact).toEqual({ given: true, confirmed: true, stopped: false });
    for (const scope of ["account", "quote", "account_suspect", null]) expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, scope }] }).success, String(scope)).toBe(true);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, scope: "post" }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, position: 21 }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, quotedBy: 11 }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, outcome: "removed" }] }).success).toBe(false);
    expect(NoticeStatus.safeParse({ ...status, items: [{ ...waiting, decidedOn: "04.10.2026" }] }).success).toBe(false);
  });
});
