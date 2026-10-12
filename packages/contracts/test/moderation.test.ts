import { describe, expect, test } from "vitest";
import {
  ACTION_KINDS,
  APPEAL_MONTHS,
  CSAM_KEYWORDS,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  DECISION_KEYWORDS,
  MEASURES,
  ModerationErrorCode,
  NOTICE_LIMITS,
  RETENTION,
  REVEAL_REASON_CATEGORIES,
  RULE_DEFAULT_CATEGORY,
  RULE_IDS,
  SEAL_LIST_MAX,
  SNAPSHOT_DIGEST_TAG,
  SUSPECT_EARLIER_MONTHS,
  TDB_CATEGORIES,
  TDB_FORM_CATEGORIES,
  TEXT_DIGEST_TAG,
  appealDeadline,
  compareDecisionActions,
  laneFor,
  snapshotDigest,
  snapshotText,
  textDigest,
  type ActionKind,
  type DecisionActionParams,
  type SnapshotDigestInput,
  type TdbCategory,
} from "../src/index";
import { TEXT_DIGEST_VECTORS } from "./digest-vectors";

const LF = String.fromCharCode(10);
const GRINNING = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

describe("the Transparency Database's values", () => {
  test("there are 16 categories, as the database was read on 2026-10-02", () => {
    expect(TDB_CATEGORIES).toEqual([
      "STATEMENT_CATEGORY_ANIMAL_WELFARE",
      "STATEMENT_CATEGORY_CONSUMER_INFORMATION",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_INTELLECTUAL_PROPERTY_INFRINGEMENTS",
      "STATEMENT_CATEGORY_NEGATIVE_EFFECTS_ON_CIVIC_DISCOURSE_OR_ELECTIONS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
      "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY",
      "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
      "STATEMENT_CATEGORY_SELF_HARM",
      "STATEMENT_CATEGORY_UNSAFE_AND_PROHIBITED_PRODUCTS",
      "STATEMENT_CATEGORY_VIOLENCE",
    ]);
    expect(new Set(TDB_CATEGORIES).size).toBe(16);
  });

  test("the illegal-ground form shows 14 of them: not the terms-and-conditions category, and not 'not specified'", () => {
    expect(TDB_FORM_CATEGORIES).toHaveLength(14);
    expect(TDB_FORM_CATEGORIES).toEqual(TDB_CATEGORIES.filter((c) => c !== "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" && c !== "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE"));
  });

  test("the CSAM path's four choices map to the three keywords, and 'abuse' to none", () => {
    expect(CSAM_KEYWORDS).toEqual({
      csam: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL",
      deepfake: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL_DEEPFAKE",
      grooming: "KEYWORD_GROOMING_SEXUAL_ENTICEMENT_MINORS",
      abuse: null,
    });
    expect(Object.keys(CSAM_KEYWORDS)).toEqual(["csam", "deepfake", "grooming", "abuse"]);
  });

  test("a decision on the law may carry one keyword: terrorist content", () => {
    expect(DECISION_KEYWORDS).toEqual(["KEYWORD_TERRORIST_CONTENT"]);
  });

  test("each rule has its default category", () => {
    expect(RULE_IDS).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(RULE_DEFAULT_CATEGORY).toEqual({
      R1: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC",
      R2: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      R3: "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      R4: "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      R5: "STATEMENT_CATEGORY_VIOLENCE",
      R6: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    });
    for (const category of Object.values(RULE_DEFAULT_CATEGORY)) expect(TDB_CATEGORIES).toContain(category);
  });
});

describe("laneFor", () => {
  const TC: TdbCategory = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";

  test("a rule report takes its rule's lane: R2 and R5 are urgent, R3 and R4 next, R1 and R6 last", () => {
    const lanes = RULE_IDS.map((ruleId) => laneFor({ ruleId, allegesIllegal: false, csam: false, category: TC }));
    expect(lanes).toEqual([2, 0, 1, 1, 0, 2]);
  });

  test("the CSAM path is lane 0 whatever else the intake says", () => {
    expect(laneFor({ ruleId: null, allegesIllegal: true, csam: true, category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS" })).toBe(0);
    expect(laneFor({ ruleId: null, allegesIllegal: false, csam: true, category: TC })).toBe(0);
  });

  test("a notice of illegality takes its category's lane, for every category", () => {
    const urgent = ["STATEMENT_CATEGORY_VIOLENCE", "STATEMENT_CATEGORY_RISK_FOR_PUBLIC_SECURITY", "STATEMENT_CATEGORY_SELF_HARM"];
    const next = [
      "STATEMENT_CATEGORY_DATA_PROTECTION_AND_PRIVACY_VIOLATIONS",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE",
      "STATEMENT_CATEGORY_CYBER_VIOLENCE_AGAINST_WOMEN",
      "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH",
      "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE",
    ];
    for (const category of TDB_CATEGORIES) {
      const expected = urgent.includes(category) ? 0 : next.includes(category) ? 1 : 2;
      expect(laneFor({ ruleId: null, allegesIllegal: true, csam: false, category }), category).toBe(expected);
    }
  });

  test("a notice of illegality that also cites a rule takes the more severe of the two lanes", () => {
    // Fraud (lane 2) under R5 (lane 0), and violence (lane 0) under R1 (lane 2): both are urgent.
    expect(laneFor({ ruleId: "R5", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(0);
    expect(laneFor({ ruleId: "R1", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_VIOLENCE" })).toBe(0);
    expect(laneFor({ ruleId: "R3", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD" })).toBe(1);
    expect(laneFor({ ruleId: "R6", allegesIllegal: true, csam: false, category: "STATEMENT_CATEGORY_ANIMAL_WELFARE" })).toBe(2);
  });

  test("where nothing is alleged to be illegal, the category is korbat's own classification and moves no lane", () => {
    for (const category of TDB_CATEGORIES) {
      expect(laneFor({ ruleId: "R1", allegesIllegal: false, csam: false, category }), category).toBe(2);
      expect(laneFor({ ruleId: "R3", allegesIllegal: false, csam: false, category }), category).toBe(1);
    }
  });
});

describe("limits and periods", () => {
  test("the notice limits: per network signed out, per account signed in, ten targets, and the two text bounds", () => {
    expect(NOTICE_LIMITS).toEqual({ signedOut: { perHour: 5, perDay: 20 }, signedIn: { perHour: 10, perDay: 50 }, maxTargets: 10, explanationMax: 2000, citedLawMax: 300 });
  });

  test("a notice on the CSAM path names at most one account; a seal's list shows 500 rows; earlier answers count for 12 months", () => {
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(SEAL_LIST_MAX).toBe(500);
    expect(SUSPECT_EARLIER_MONTHS).toBe(12);
  });

  test("six months to appeal or to ask for a re-examination, five of each a day", () => {
    expect(APPEAL_MONTHS).toBe(6);
    expect(DAILY_LIMITS).toEqual({ appeals: 5, reexaminations: 5 });
  });

  test("the retention periods of the design's table", () => {
    expect(RETENTION).toEqual({
      r4FinalMonths: 6,
      intakeDays: 30,
      resetValueDays: 30,
      evidenceHours: 24,
      statementMonths: 12,
      accessLogMonths: 12,
      contactMonths: 6,
      contactMaxMonths: 13,
      confirmationDays: 30,
      backupDays: 30,
      draftHours: 24,
      mailGiveUpDays: 5,
    });
    // Content restricted under R4 goes when its restriction is final: the appeal's window.
    expect(RETENTION.r4FinalMonths).toBe(APPEAL_MONTHS);
  });
});

describe("the measures", () => {
  const kinds = Object.keys(MEASURES) as ActionKind[];
  const measures = kinds.filter((kind) => MEASURES[kind].lifts === null);
  const reversals = kinds.filter((kind) => MEASURES[kind].lifts !== null);

  test("every action kind has an entry: the seven measures, then the five reversals", () => {
    expect(kinds).toEqual([
      "withhold",
      "remove",
      "seal_media",
      "withhold_media",
      "remove_media",
      "reset_display_name",
      "reset_bio",
      "restore",
      "unseal_media",
      "restore_media",
      "restore_display_name",
      "restore_bio",
    ]);
    expect(ACTION_KINDS).toEqual(kinds);
    expect(measures).toEqual(kinds.slice(0, 7));
    expect(reversals).toEqual(kinds.slice(7));
  });

  test("a post or one image is withheld only while deciding and removed only when the case is decided; a seal and a reset are either", () => {
    const when = (kind: ActionKind) => [MEASURES[kind].interim, MEASURES[kind].final];
    expect(when("withhold")).toEqual([true, false]);
    expect(when("withhold_media")).toEqual([true, false]);
    expect(when("remove")).toEqual([false, true]);
    expect(when("remove_media")).toEqual([false, true]);
    for (const kind of ["seal_media", "reset_display_name", "reset_bio"] as const) expect(when(kind), kind).toEqual([true, true]);
    // A reversal is neither: which decision may hold one is the reversed measure's matter.
    for (const kind of reversals) expect(when(kind), kind).toEqual([false, false]);
  });

  test("each measure has its target, and each reversal lifts the measures of its own target", () => {
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].target]))).toEqual({
      withhold: "post",
      remove: "post",
      seal_media: "images",
      withhold_media: "image",
      remove_media: "image",
      reset_display_name: "display_name",
      reset_bio: "bio",
      restore: "post",
      unseal_media: "images",
      restore_media: "image",
      restore_display_name: "display_name",
      restore_bio: "bio",
    });
    expect(Object.fromEntries(reversals.map((kind) => [kind, MEASURES[kind].lifts]))).toEqual({
      restore: ["withhold", "remove"],
      unseal_media: ["seal_media"],
      restore_media: ["withhold_media", "remove_media"],
      restore_display_name: ["reset_display_name"],
      restore_bio: ["reset_bio"],
    });
    // Every measure can be lifted, by exactly one kind of reversal.
    for (const measure of measures) expect(reversals.filter((kind) => (MEASURES[kind].lifts as readonly ActionKind[]).includes(measure)), measure).toHaveLength(1);
  });

  test("each has a label of its own: the composer's words where the composer names the measure", () => {
    // The first seven and "Lift the seal" are the words of the decision composer; the composer, the statement and the
    // terms all take them from here.
    expect(Object.fromEntries(kinds.map((kind) => [kind, MEASURES[kind].label]))).toEqual({
      withhold: "Withhold the post",
      remove: "Remove",
      seal_media: "Seal the images this case reaches",
      withhold_media: "Withhold one image",
      remove_media: "Remove one image",
      reset_display_name: "Reset display name",
      reset_bio: "Reset bio",
      restore: "Lift the restriction of the post",
      unseal_media: "Lift the seal",
      restore_media: "Lift the restriction of one image",
      restore_display_name: "Lift the reset of the display name",
      restore_bio: "Lift the reset of the bio",
    });
    const labels = kinds.map((kind) => MEASURES[kind].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the order of a decision's actions", () => {
  const a = "1a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const b = "2a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

  test("by kind as a string, then by image as a string, an action without an image first", () => {
    const sorted: DecisionActionParams[] = [
      { kind: "remove", mediaId: null },
      { kind: "remove_media", mediaId: a },
      { kind: "remove_media", mediaId: b },
      { kind: "reset_bio", mediaId: null },
      { kind: "seal_media", mediaId: null },
      { kind: "withhold_media", mediaId: a },
    ];
    for (const shuffled of [[...sorted].reverse(), [sorted[3]!, sorted[0]!, sorted[5]!, sorted[2]!, sorted[1]!, sorted[4]!]]) {
      expect([...shuffled].sort(compareDecisionActions)).toEqual(sorted);
    }
    expect(compareDecisionActions(sorted[1]!, sorted[1]!)).toBe(0);
    expect(compareDecisionActions({ kind: "restore_media", mediaId: null }, { kind: "restore_media", mediaId: a })).toBeLessThan(0);
  });
});

describe("the reasons for revealing a source", () => {
  test("are the four categories the reveal dialog offers", () => {
    expect(REVEAL_REASON_CATEGORIES).toEqual(["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"]);
  });
});

describe("moderation error codes", () => {
  test("are the codes the notice routes, the intake and the decision raise", () => {
    expect(ModerationErrorCode.options).toEqual([
      "notice_link_invalid",
      "notice_link_offsite",
      "human_check_failed",
      "staff_cannot_report",
      "notice_not_found",
      "already_reported",
      "case_changed",
      "case_closed",
      "staff_recused",
      "staff_target",
      "admin_required",
      "decision_cap",
      "profile_changed",
      "snapshot_mismatch",
      "snapshot_erased",
      "text_not_found",
      "invalid_decision",
    ]);
    // The codes the database keeps to itself are no route's answer.
    for (const code of ["moderation_column", "quote_item_missing", "read_committed_only", "staff_confirmation_ended", "staff_confirmation_late"]) {
      expect(ModerationErrorCode.safeParse(code).success, code).toBe(false);
    }
  });
});

describe("textDigest", () => {
  test("the tag names the version of the rule", () => {
    expect(TEXT_DIGEST_TAG).toBe("korbat.text.v1");
  });

  test.each(TEXT_DIGEST_VECTORS.map((vector) => [vector.name, vector] as const))("%s: the sha256 of the tag, a line feed, the salt's bytes and the text's UTF-8 bytes", async (_name, vector) => {
    expect(await textDigest(vector.salt, vector.text)).toBe(vector.digest);
  });

  test("the longest vector is 5000 UTF-16 units, and the vectors hold a line feed, a character outside ASCII and one outside the basic plane", () => {
    expect(Math.max(...TEXT_DIGEST_VECTORS.map((vector) => vector.text.length))).toBe(5000);
    const all = TEXT_DIGEST_VECTORS.map((vector) => vector.text).join("");
    expect(all).toContain(LF);
    expect(all).toContain(E_ACUTE);
    expect(all).toContain(GRINNING);
  });

  test("another salt or another text gives another digest", async () => {
    const digests = await Promise.all([textDigest("a1".repeat(32), "one"), textDigest("a2".repeat(32), "one"), textDigest("a1".repeat(32), "one "), textDigest("a1".repeat(32), "One")]);
    expect(new Set(digests).size).toBe(4);
  });

  test("a salt that is not 32 bytes of lower-case hex is refused, never padded or folded", async () => {
    for (const salt of ["", "a1".repeat(31), "a1".repeat(33), "A1".repeat(32), "g1".repeat(32), ` ${"a1".repeat(32)}`]) {
      await expect(textDigest(salt, "text"), JSON.stringify(salt)).rejects.toThrow(TypeError);
    }
  });

  test("a text with a lone surrogate, which has no UTF-8 bytes, is refused rather than hashed as something else", async () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xde00);
    for (const text of [high, low, `a${high}b`, `${low}${high}`]) await expect(textDigest("a1".repeat(32), text)).rejects.toThrow(TypeError);
    // The pair itself is a character.
    await expect(textDigest("a1".repeat(32), `${high}${low}`)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snapshotText and snapshotDigest", () => {
  const post: SnapshotDigestInput = {
    salt: "ab".repeat(32),
    targetType: "post",
    targetId: "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    takenAt: "2026-10-03T10:00:00.123Z",
    authorHandle: "ada",
    postState: "visible",
    postCreatedAt: "2026-10-01T08:30:00.000Z",
    replyToId: null,
    quoteOfId: "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36",
    body: `Line one${LF}caf${E_ACUTE} ${GRINNING}`,
    media: [
      { id: "11111111-2222-4333-8444-555555555555", alt: "A cat", width: 1200, height: 800 },
      { id: "66666666-7777-4888-9999-aaaaaaaaaaaa", alt: null, width: 640, height: 480 },
    ],
    displayName: null,
    bio: null,
    handle: null,
  };
  const account: SnapshotDigestInput = {
    salt: "cd".repeat(32),
    targetType: "account",
    targetId: "8a3c7f0e-1111-4222-8333-944445555666",
    takenAt: "2026-10-03T10:00:00.000Z",
    authorHandle: "bob",
    postState: null,
    postCreatedAt: null,
    replyToId: null,
    quoteOfId: null,
    body: null,
    media: null,
    displayName: `Bob ${GRINNING}`,
    bio: "",
    handle: "bob",
  };
  const BS = String.fromCharCode(92);
  // The texts and the digests below were computed with Python's json and hashlib when they were written.
  const POST_TEXT =
    `{"authorHandle":"ada","bio":null,"body":"Line one${BS}ncaf${E_ACUTE} ${GRINNING}","displayName":null,"handle":null,` +
    `"media":[{"alt":"A cat","height":800,"id":"11111111-2222-4333-8444-555555555555","width":1200},{"alt":null,"height":480,"id":"66666666-7777-4888-9999-aaaaaaaaaaaa","width":640}],` +
    `"postCreatedAt":"2026-10-01T08:30:00.000Z","postState":"visible","quoteOfId":"7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36","replyToId":null,` +
    `"salt":"${"ab".repeat(32)}","takenAt":"2026-10-03T10:00:00.123Z","targetId":"3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a","targetType":"post","v":1}`;
  const POST_DIGEST = "cb995d11ed14e3c4e555c187d319a86506b263e98f924f59f2f7d5231a3bc6e6";
  const ACCOUNT_DIGEST = "41019b2a47d4ebad37cc8c5ad25f8d79a7232c4e3e705231f9e9ba1e02fb1f26";

  test("the tag names the version of the rule", () => {
    expect(SNAPSHOT_DIGEST_TAG).toBe("korbat.snapshot.v1");
  });

  test("the text is the sorted JSON of version 1 and the snapshot's fifteen members", () => {
    expect(snapshotText(post)).toBe(POST_TEXT);
    const parsed = JSON.parse(snapshotText(account)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["authorHandle", "bio", "body", "displayName", "handle", "media", "postCreatedAt", "postState", "quoteOfId", "replyToId", "salt", "takenAt", "targetId", "targetType", "v"]);
    expect(parsed).toEqual({ v: 1, ...account });
  });

  test("the digest is the sha256 of the tag, a line feed and that text", async () => {
    expect(await snapshotDigest(post)).toBe(POST_DIGEST);
    expect(await snapshotDigest(account)).toBe(ACCOUNT_DIGEST);
  });

  test("it round-trips the snapshot answer's JSON, whatever order and whatever else the answer carries", async () => {
    // As the console receives it: parsed from JSON, with members the digest does not cover, in another order.
    const sent = {
      id: "9d0f5e3c-0000-4000-8000-000000000001",
      digest: POST_DIGEST,
      withheld: false,
      erasedAt: null,
      ...Object.fromEntries(Object.entries(post).reverse()),
      media: post.media!.map((image) => ({ height: image.height, width: image.width, note: "never part of a snapshot", alt: image.alt, id: image.id })),
    };
    const answer = JSON.parse(JSON.stringify(sent)) as SnapshotDigestInput;
    expect(snapshotText(answer)).toBe(POST_TEXT);
    expect(await snapshotDigest(answer)).toBe(POST_DIGEST);
  });

  test("any member that changes gives another digest", async () => {
    const changed: SnapshotDigestInput[] = [
      { ...post, salt: "ac".repeat(32) },
      { ...post, takenAt: "2026-10-03T10:00:00.124Z" },
      { ...post, body: `${post.body} ` },
      { ...post, postState: "withheld" },
      { ...post, quoteOfId: null },
      { ...post, media: [post.media![1]!, post.media![0]!] },
      { ...post, media: [{ ...post.media![0]!, alt: "A dog" }, post.media![1]!] },
      { ...post, authorHandle: "adb" },
    ];
    const digests = await Promise.all([post, ...changed].map(snapshotDigest));
    expect(new Set(digests).size).toBe(changed.length + 1);
  });

  test("a time that is not the UTC string toISOString writes, to the millisecond, is refused", () => {
    for (const takenAt of ["2026-10-03T10:00:00Z", "2026-10-03T10:00:00.123456Z", "2026-10-03T12:00:00.123+02:00", "2026-10-03 10:00:00.123Z", ""]) {
      expect(() => snapshotText({ ...post, takenAt }), takenAt).toThrow(TypeError);
    }
    expect(() => snapshotText({ ...post, postCreatedAt: "2026-10-01T08:30:00Z" })).toThrow(TypeError);
    expect(snapshotText({ ...post, takenAt: new Date(Date.UTC(2026, 9, 3, 10, 0, 0, 123)).toISOString() })).toBe(POST_TEXT);
  });
});

describe("appealDeadline", () => {
  const at = (iso: string) => new Date(iso);
  const deadline = (iso: string) => appealDeadline(at(iso)).toISOString();

  test("six calendar months later, at the same UTC time", () => {
    expect(deadline("2026-10-03T10:15:30.250Z")).toBe("2027-04-03T10:15:30.250Z");
    expect(deadline("2026-01-15T00:00:00.000Z")).toBe("2026-07-15T00:00:00.000Z");
    expect(deadline("2026-07-01T23:59:59.999Z")).toBe("2027-01-01T23:59:59.999Z");
  });

  test("a day the sixth month lacks becomes that month's last day", () => {
    // 31 August plus six months is the end of February: the 28th, or the 29th in a leap year.
    expect(deadline("2026-08-31T12:00:00.000Z")).toBe("2027-02-28T12:00:00.000Z");
    expect(deadline("2027-08-31T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-30T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2027-08-29T12:00:00.000Z")).toBe("2028-02-29T12:00:00.000Z");
    expect(deadline("2026-03-31T08:00:00.000Z")).toBe("2026-09-30T08:00:00.000Z");
    expect(deadline("2026-05-31T08:00:00.000Z")).toBe("2026-11-30T08:00:00.000Z");
    expect(deadline("2026-10-31T08:00:00.000Z")).toBe("2027-04-30T08:00:00.000Z");
    expect(deadline("2026-12-31T08:00:00.000Z")).toBe("2027-06-30T08:00:00.000Z");
    // A leap day itself moves to 29 August: August has the day.
    expect(deadline("2028-02-29T08:00:00.000Z")).toBe("2028-08-29T08:00:00.000Z");
  });

  test("it is computed in UTC: the last instants of a UTC month stay on that month's side", () => {
    expect(deadline("2026-08-31T23:59:59.999Z")).toBe("2027-02-28T23:59:59.999Z");
    expect(deadline("2026-09-01T00:00:00.000Z")).toBe("2027-03-01T00:00:00.000Z");
  });

  test("it leaves its argument as it was", () => {
    const informed = at("2026-08-31T12:00:00.000Z");
    appealDeadline(informed);
    expect(informed.toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });
});
