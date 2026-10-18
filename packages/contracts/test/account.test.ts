import { describe, expect, test } from "vitest";
import { ACCOUNT_DELETION_WORDS, ExportFormat, MEASURE_KINDS } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"], showInExplore: false, retiredHandles: [{ handle: "ada_l", retiredAt: at }] },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  // A session is named by its handle, as the session list names it; the token's hash stays on the server.
  sessions: [{ id: id(9), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
  // Last in the document since 3c: the decisions the account was told of, and the reports it sent itself.
  moderation: {
    decisions: [
      {
        id: id(10),
        decidedOn: "2026-09-24",
        postId: id(2),
        kind: "final",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R3",
        rulesVersion: 2,
        measures: [
          { kind: "remove", mediaId: null, noEffect: null },
          { kind: "remove_media", mediaId: id(3), noEffect: "already" },
        ],
        reversals: [],
        facts: "The post calls for a named group to be excluded.",
        reason: "That is an attack on people for what they are.",
        legalReference: null,
        appeal: { state: "answered", result: "kept" },
      },
      // A correction about the account itself: it names no post, lifts a reset, and carries no text that is still held.
      { id: id(11), decidedOn: "2026-09-25", postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null, appeal: null },
    ],
    reports: [
      {
        ref: "N-ABCDEFGH23",
        receivedAt: at,
        ground: "illegal",
        ruleId: null,
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        explanation: "It offers a fake giveaway.",
        items: [
          { position: 1, link: `https://korbat.example/post/${id(12)}`, reexamines: false, outcome: "no_violation", outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", reexaminationOpen: true },
          // Decided or not, an item says nothing of its outcome before the daily release.
          { position: 2, link: "https://korbat.example/u/grace", reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null },
        ],
      },
    ],
    // 3e: the strikes the account was given, newest first.
    strikes: [{ decisionId: id(10), postId: id(1), ruleId: "R3", givenAt: at, countsUntil: "2027-01-01T00:00:00.000Z", overruledAt: null }],
    // 3e (W.8): a suspension taken at once and lifted, which answered the account's reply, and a warning about reporting.
    standing: [
      {
        decisionId: id(30),
        kind: "suspend",
        basis: "threat",
        days: 7,
        announced: false,
        decidedAt: at,
        earliestStart: at,
        startsAt: at,
        endsAt: "2026-09-25T10:00:00.000Z",
        liftedAt: "2026-09-25T10:00:00.000Z",
        liftedBy: id(31),
        replaced: false,
        basisEndedAt: null,
        basisEndedBy: null,
      },
      { decisionId: id(32), kind: "warn_reporting", basis: "reports", days: null, announced: null, decidedAt: at, earliestStart: null, startsAt: at, endsAt: "2026-12-23T10:00:00.000Z", liftedAt: null, liftedBy: null, replaced: false, basisEndedAt: null, basisEndedBy: null },
    ],
    replies: [{ decisionId: id(30), filedAt: at, onTime: false, text: "I did not write that post.", erasedAt: null, answeredAt: "2026-09-25T10:00:00.000Z", answeredBy: id(31) }],
    reporting: {
      frameDays: 90,
      days: [{ day: "2026-09-24", reports: 6 }],
      marks: [
        { ref: "N-ABCDEFGH24", position: 1, sentOn: "2026-09-24", markedAt: at, withdrawnAt: null, counts: true },
        { ref: "N-ABCDEFGH25", position: 2, sentOn: "2026-09-24", markedAt: at, withdrawnAt: at, counts: false },
      ],
      markedReports: 1,
    },
  },
};

/** The three members 3e adds to the moderation member, empty, as an account with no standing measure, reply or report has them. */
const NO_STANDING = { standing: [], replies: [], reporting: { frameDays: 90, days: [], marks: [], markedReports: 0 } };

describe("what deleting an account removes, and what korbat keeps", () => {
  test("one sentence, word for word, that the deletion screen and both deletion mails say: nothing in it says that everything is gone for good", () => {
    expect(ACCOUNT_DELETION_WORDS).toBe(
      "Your posts, images and profile are removed from korbat for everyone, but where a post or your profile was reported or restricted, korbat keeps its copy for that case for the periods in its terms (Terms, Your data).",
    );
    expect(ACCOUNT_DELETION_WORDS).not.toMatch(/for good|gone/);
  });
});

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = {
      ...full,
      account: { ...full.account, passkeys: [] },
      posts: [],
      likes: [],
      reposts: [],
      bookmarks: [],
      following: [],
      blocks: [],
      mutes: [],
      sessions: [],
      devices: [],
      events: [],
      missingMedia: [],
      moderation: { decisions: [], reports: [], strikes: [], ...NO_STANDING },
    };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the profile carries the author's Explore switch, always, as it stands", () => {
    // Part of the format since 2c, beside the handle history: on as well as off, never left out.
    expect(ExportFormat.parse({ ...full, profile: { ...full.profile, showInExplore: true } }).profile.showInExplore).toBe(true);
    expect(ExportFormat.parse(full).profile.showInExplore).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, showInExplore: "off" } }).success).toBe(false);
  });

  test("the profile lists the account's own handles that korbat retired, each with when, beside the handle history (3e design, W.8)", () => {
    // Added to korbat-export-1 last in the profile, as the Explore switch was: always there, empty when nothing is retired.
    expect(ExportFormat.parse(full).profile.retiredHandles).toEqual([{ handle: "ada_l", retiredAt: at }]);
    expect(ExportFormat.parse({ ...full, profile: { ...full.profile, retiredHandles: [] } }).profile.retiredHandles).toEqual([]);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, retiredHandles: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, retiredHandles: [{ handle: "ada_l", retiredAt: null }] } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, retiredHandles: [{ handle: "ada_l" }] } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: id(9), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});

describe("the export's moderation member", () => {
  const [decision, correction] = full.moderation.decisions;
  const [report] = full.moderation.reports;
  const [released, waiting] = report!.items;
  const withModeration = (moderation: unknown) => ExportFormat.safeParse({ ...full, moderation }).success;
  const withDecision = (change: Record<string, unknown>) => withModeration({ decisions: [{ ...decision, ...change }], reports: [], strikes: [], ...NO_STANDING });
  const withReport = (change: Record<string, unknown>) => withModeration({ decisions: [], reports: [{ ...report, ...change }], strikes: [], ...NO_STANDING });
  const withItem = (change: Record<string, unknown>) => withReport({ items: [{ ...released, ...change }] });

  test("is part of korbat-export-1 since 3c, the last member of the document: always present, with its two lists, either of which may be empty", () => {
    // Added without a new format name, as the passkeys and the Explore switch were: a reader that skips it loses nothing.
    expect(ExportFormat.parse(full).format).toBe("korbat-export-1");
    expect(Object.keys(ExportFormat.shape).at(-1)).toBe("moderation");
    expect(withModeration(undefined)).toBe(false);
    expect(withModeration({ decisions: [] })).toBe(false);
    expect(withModeration({ reports: [] })).toBe(false);
    expect(withModeration({ decisions: [], reports: [] })).toBe(false);
    // 3e: the strikes, the standing measures, the replies and the reporting counts are always there too.
    expect(withModeration({ decisions: [], reports: [], strikes: [] })).toBe(false);
    expect(withModeration({ decisions: [], reports: [], strikes: [], standing: [], replies: [] })).toBe(false);
    expect(withModeration({ decisions: [], reports: [], strikes: [], ...NO_STANDING })).toBe(true);
    expect(withModeration({ decisions: [decision], reports: [], strikes: [], ...NO_STANDING })).toBe(true);
    expect(withModeration({ decisions: [], reports: [report], strikes: [], ...NO_STANDING })).toBe(true);
  });

  test("a decision carries its day, the post it concerns, its kind, outcome, ground, rule and rules version, its measures with whether each changed anything, its reversals, the texts still held and where the appeal stands", () => {
    expect(withDecision({})).toBe(true);
    // The day, never the time: the list of decisions shows a day too.
    expect(withDecision({ decidedOn: at })).toBe(false);
    expect(withDecision({ decidedOn: undefined })).toBe(false);
    // A decision about the account names no post; the member is null then, never missing.
    expect(withDecision({ postId: null })).toBe(true);
    expect(withDecision({ postId: undefined })).toBe(false);
    expect(withDecision({ postId: "the-post" })).toBe(false);
    // 3f (W.7): an order's decision is an entry like any other once its author was told.
    for (const kind of ["interim", "final", "order", "review", "correction"]) expect(withDecision({ kind }), kind).toBe(true);
    expect(withDecision({ kind: "appeal" })).toBe(false);
    for (const outcome of ["restricted", "no_violation", "not_evident", "kept", "partly_reversed", "reversed"]) expect(withDecision({ outcome }), outcome).toBe(true);
    expect(withDecision({ outcome: "suspended" })).toBe(false);
    expect(withDecision({ ground: "illegal", ruleId: null })).toBe(true);
    expect(withDecision({ ground: "other" })).toBe(false);
    expect(withDecision({ ruleId: "R7" })).toBe(false);
    expect(withDecision({ rulesVersion: 0 })).toBe(false);
    expect(withDecision({ rulesVersion: undefined })).toBe(false);
    // The fourteen measures (3c's seven, 3e's six and 3f's order measure) and nothing else; a reversal is no measure, and a measure no reversal.
    for (const kind of MEASURE_KINDS) expect(withDecision({ measures: [{ kind, mediaId: null, noEffect: null }] }), kind).toBe(true);
    expect(withDecision({ measures: [{ kind: "restore", mediaId: null, noEffect: null }] })).toBe(false);
    expect(withDecision({ measures: [{ kind: "overrule", mediaId: null, noEffect: null }] })).toBe(false);
    expect(withDecision({ reversals: [{ kind: "strike", mediaId: null }] })).toBe(false);
    expect(withDecision({ reversals: [{ kind: "overrule", mediaId: null }] })).toBe(true);
    for (const noEffect of ["already", "deleted", null]) expect(withDecision({ measures: [{ kind: "remove", mediaId: null, noEffect }] }), String(noEffect)).toBe(true);
    expect(withDecision({ measures: [{ kind: "remove", mediaId: null, noEffect: "no" }] })).toBe(false);
    expect(withDecision({ measures: [{ kind: "remove", mediaId: null }] })).toBe(false);
    for (const kind of ["restore", "unseal_media", "restore_media", "restore_display_name", "restore_bio"]) expect(withDecision({ reversals: [{ kind, mediaId: null }] }), kind).toBe(true);
    expect(withDecision({ reversals: [{ kind: "remove", mediaId: null }] })).toBe(false);
    expect(withDecision({ measures: undefined })).toBe(false);
    expect(withDecision({ reversals: undefined })).toBe(false);
    // A text that is not held, or that the decision never had, is null, never missing.
    expect(withDecision({ facts: null, reason: null, legalReference: null })).toBe(true);
    for (const text of ["facts", "reason", "legalReference"]) expect(withDecision({ [text]: undefined }), text).toBe(false);
    expect(ExportFormat.parse(full).moderation.decisions[1]).toEqual(correction);
  });

  test("an appeal is pending without a result or answered with one, and null when none was filed", () => {
    expect(withDecision({ appeal: null })).toBe(true);
    expect(withDecision({ appeal: undefined })).toBe(false);
    expect(withDecision({ appeal: { state: "pending", result: null } })).toBe(true);
    for (const result of ["kept", "partly_reversed", "reversed"]) expect(withDecision({ appeal: { state: "answered", result } }), result).toBe(true);
    expect(withDecision({ appeal: { state: "pending", result: "kept" } })).toBe(false);
    expect(withDecision({ appeal: { state: "answered", result: null } })).toBe(false);
    expect(withDecision({ appeal: { state: "withdrawn", result: null } })).toBe(false);
  });

  test("a decision is read with its own members and no more: nothing of who reported, who decided or how many reports there were is part of the format", () => {
    const extra = { ...decision, decidedBy: id(20), staffHandle: "mod_one", reporterId: id(21), reporterHandle: "grace", reports: 3, source: "report", caseId: id(22) };
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [extra], reports: [], strikes: [], ...NO_STANDING } });
    expect(parsed.moderation.decisions).toEqual([decision]);
  });

  test("a report carries its reference, when korbat received it, its ground with the rule it cited, its category and its sender's own explanation while that is held", () => {
    expect(withReport({})).toBe(true);
    expect(withReport({ ref: "N-abc" })).toBe(false);
    expect(withReport({ receivedAt: "last week" })).toBe(false);
    expect(withReport({ ground: "rule", ruleId: "R6", category: "STATEMENT_CATEGORY_OTHER_VIOLATION_TC" })).toBe(true);
    // A report on the path for child sexual abuse material records no sender, so it is in nobody's export.
    expect(withReport({ ground: "csam" })).toBe(false);
    expect(withReport({ ruleId: "R9" })).toBe(false);
    expect(withReport({ ruleId: undefined })).toBe(false);
    expect(withReport({ category: "STATEMENT_CATEGORY_MADE_UP" })).toBe(false);
    expect(withReport({ explanation: null })).toBe(true);
    expect(withReport({ explanation: undefined })).toBe(false);
    expect(withReport({ items: undefined })).toBe(false);
    // Read with its own members and no more.
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [], strikes: [], ...NO_STANDING, reports: [{ ...report, reporterId: id(1), contactId: id(23), lookupHash: "f".repeat(64), token: "secret" }] } });
    expect(parsed.moderation.reports).toEqual([report]);
  });

  test("an item carries its place in the report, its link and whether it is a re-examination; its outcome, the outcome's words and whether a re-examination is open come together, with the release, or not at all", () => {
    expect(withItem({})).toBe(true);
    expect(withReport({ items: [waiting] })).toBe(true);
    expect(withItem({ position: 0 })).toBe(false);
    expect(withItem({ position: 21 })).toBe(false);
    expect(withItem({ link: undefined })).toBe(false);
    expect(withItem({ reexamines: undefined })).toBe(false);
    for (const outcome of ["restricted_rule", "restricted_legal", "no_violation", "not_evident", "not_available", "partly_reversed", "reversed"]) expect(withItem({ outcome }), outcome).toBe(true);
    expect(withItem({ outcome: "restricted" })).toBe(false);
    expect(withItem({ reexaminationOpen: false })).toBe(true);
    // Released, all three are told; before the release, none is.
    expect(withItem({ outcome: null })).toBe(false);
    expect(withItem({ outcomeText: null })).toBe(false);
    expect(withItem({ reexaminationOpen: null })).toBe(false);
    expect(withReport({ items: [{ ...waiting, reexaminationOpen: false }] })).toBe(false);
    expect(withReport({ items: [{ ...waiting, outcomeText: "no action" }] })).toBe(false);
    // An item is read with its own members and no more: the list's id of an item is not part of the export.
    const parsed = ExportFormat.parse({ ...full, moderation: { decisions: [], strikes: [], ...NO_STANDING, reports: [{ ...report, items: [{ ...released, id: id(24), caseId: id(25), answeredBy: id(26) }] }] } });
    expect(parsed.moderation.reports[0]!.items).toEqual([released]);
  });
});

describe("the moderation member's standing, replies and reporting (3e design, W.8)", () => {
  const [suspension, warning] = full.moderation.standing;
  const [answered] = full.moderation.replies;
  const [counting, withdrawn] = full.moderation.reporting.marks;
  const withModeration = (change: Record<string, unknown>) => ExportFormat.safeParse({ ...full, moderation: { ...full.moderation, ...change } }).success;
  const withStanding = (change: Record<string, unknown>) => withModeration({ standing: [{ ...suspension, ...change }] });
  const withReply = (change: Record<string, unknown>) => withModeration({ replies: [{ ...answered, ...change }] });
  const withReporting = (change: Record<string, unknown>) => withModeration({ reporting: { ...full.moderation.reporting, ...change } });
  const withMark = (change: Record<string, unknown>) => withReporting({ marks: [{ ...counting, ...change }] });

  test("come after the strikes, in this order, and every one of them is always there", () => {
    expect(Object.keys(ExportFormat.shape.moderation.shape)).toEqual(["decisions", "reports", "strikes", "standing", "replies", "reporting"]);
    expect(ExportFormat.parse(full).moderation).toEqual(full.moderation);
    for (const member of ["standing", "replies", "reporting"]) expect(withModeration({ [member]: undefined }), member).toBe(false);
  });

  test("a standing entry is a suspension, a termination, a warning or a restriction of reporting, with its basis, days, times, lift and broken basis", () => {
    expect(withStanding({})).toBe(true);
    expect(withModeration({ standing: [warning] })).toBe(true);
    for (const kind of ["suspend", "terminate", "warn_reporting", "restrict_reporting"]) expect(withStanding({ kind }), kind).toBe(true);
    // A strike is in strikes, a retirement in the profile's retired handles; neither is a standing entry.
    for (const kind of ["strike", "retire_handle", "remove"]) expect(withStanding({ kind }), kind).toBe(false);
    for (const basis of ["strikes", "threat", "terrorist", "flood", "protective", "threat_repeat", "ladder_end", "reports"]) expect(withStanding({ basis }), basis).toBe(true);
    expect(withStanding({ basis: "other" })).toBe(false);
    expect(withStanding({ days: null, kind: "terminate" })).toBe(true);
    expect(withStanding({ days: 0 })).toBe(false);
    expect(withStanding({ days: 31 })).toBe(false);
    // A period that never started, or a termination without end, has no start or no end.
    expect(withStanding({ startsAt: null, endsAt: null })).toBe(true);
    expect(withStanding({ basisEndedAt: at, basisEndedBy: id(33) })).toBe(true);
    expect(withStanding({ replaced: null })).toBe(false);
    expect(withStanding({ liftedBy: "a staff member" })).toBe(false);
    // An entry is read with its own members and no more: who decided is not part of it.
    const parsed = ExportFormat.parse({ ...full, moderation: { ...full.moderation, standing: [{ ...suspension, decidedBy: id(40), handle: "staff" }] } });
    expect(parsed.moderation.standing).toEqual([suspension]);
  });

  test("a reply carries when it was filed, whether it was on time, its text while korbat holds it, when that was erased and its answer", () => {
    expect(withReply({})).toBe(true);
    expect(withReply({ text: null, erasedAt: at })).toBe(true);
    expect(withReply({ text: null, erasedAt: null })).toBe(true);
    expect(withReply({ answeredAt: null, answeredBy: null })).toBe(true);
    expect(withReply({ text: "x".repeat(2001) })).toBe(false);
    expect(withReply({ onTime: undefined })).toBe(false);
    expect(withReply({ filedAt: "yesterday" })).toBe(false);
  });

  test("the reporting counts carry the frame, the reports of each day, each mark by its own report's reference and position, and the marked reports a threshold reads", () => {
    expect(withReporting({})).toBe(true);
    expect(withModeration({ reporting: { frameDays: 90, days: [], marks: [], markedReports: 0 } })).toBe(true);
    expect(withReporting({ marks: [withdrawn] })).toBe(true);
    expect(withReporting({ frameDays: 0 })).toBe(false);
    expect(withReporting({ markedReports: -1 })).toBe(false);
    expect(withReporting({ days: [{ day: at, reports: 1 }] })).toBe(false);
    expect(withReporting({ days: [{ day: "2026-09-24", reports: 0 }] })).toBe(false);
    expect(withMark({ ref: "not a reference" })).toBe(false);
    expect(withMark({ position: 0 })).toBe(false);
    expect(withMark({ sentOn: at })).toBe(false);
    expect(withMark({ counts: undefined })).toBe(false);
    // A mark names the account's own report and nothing else: never the item, the decision or who was reported.
    const parsed = ExportFormat.parse({ ...full, moderation: { ...full.moderation, reporting: { ...full.moderation.reporting, marks: [{ ...counting, itemId: id(41), decisionId: id(42), target: "u/bob" }] } } });
    expect(parsed.moderation.reporting.marks).toEqual([counting]);
  });
});
