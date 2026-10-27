import { describe, expect, test } from "vitest";
import {
  ConfirmImportRequest,
  CreateImportRequest,
  IMPORT_ACTIVE_STATES,
  IMPORT_FAILURES,
  IMPORT_IMAGE_SKIPS,
  IMPORT_MARKS,
  IMPORT_RULES,
  IMPORT_SKIP_REASONS,
  IMPORT_SOURCE_KINDS,
  IMPORT_STOP_REASONS,
  ImportChoice,
  ImportErrorCode,
  ImportLineView,
  ImportMediaFile,
  ImportPickRequest,
  ImportPickView,
  ImportScanFacts,
  ImportSource,
  ImportStatus,
  ImportSummary,
  ImportView,
  ImportedPost,
  ImportedText,
  MEDIA_MAX_PER_POST,
  POST_MAX_LENGTH,
  PostText,
  normalizePostBody,
  postLength,
} from "../src/index";

/**
 * The import's contracts (3b design, sections 5.1 and 9.3; Task 1). Every character a vector needs beyond plain ASCII is
 * built here by code, so this file holds none.
 */
const KEY = "0123456789abcdef".repeat(4);
const ID = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
const BEL = String.fromCharCode(7);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const RLO = String.fromCharCode(0x202e);
const ZWJ = String.fromCharCode(0x200d);
const BACKSLASH = String.fromCharCode(92);
const ACUTE = String.fromCharCode(0x301);
const E_ACUTE = String.fromCharCode(0xe9);
/** A character outside the basic plane: two UTF-16 units and four UTF-8 bytes, one code point. */
const ASTRAL = String.fromCodePoint(0x1f600);

/** One line of posts.jsonl as the importer writes it, with the given members changed. */
function line(change: Record<string, unknown> = {}) {
  return { ref: 1, key: KEY, at: "2019-03-03T10:00:00Z", kind: "post", parent: null, text: "Hello", media: [], protected: false, warning: false, ...change };
}

const scanned = {
  v: 1,
  id: ID,
  status: "scanned",
  posts: 3,
  images: 1,
  skipped: { repost: 2, not_public: 4 },
  imagesSkipped: { video: 1 },
  cleaned: 0,
  warnings: 1,
  sourceLinks: 2,
  protectedPosts: 0,
  readInPart: false,
};

const facts = {
  posts: 3,
  images: 1,
  skipped: { repost: 2 },
  imagesSkipped: {},
  cleaned: 0,
  warnings: 1,
  sourceLinks: 0,
  protectedPosts: 0,
  readInPart: false,
  months: [{ month: "2019-03", groups: [[0, 2, 1, 1], [1, 1, 0, 0]] }],
  first: "2019-03",
  last: "2019-03",
  fromRef: 0,
  samples: [{ ref: 2, offset: 410 }],
  pages: [0],
};

const choice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };

describe("the closed lists, in the design's order (9.3)", () => {
  test("sources, states and the active states", () => {
    expect(IMPORT_SOURCE_KINDS).toEqual(["x", "mastodon", "bluesky"]);
    expect(ImportSource.options).toEqual(["x", "mastodon", "bluesky"]);
    expect(ImportStatus.options).toEqual(["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);
    // The first five are active, and undoing is not: a person may remove one import's posts while another runs (4.1).
    expect(IMPORT_ACTIVE_STATES).toEqual(ImportStatus.options.slice(0, 5));
  });

  test("failures, stop reasons, skips and image skips", () => {
    expect(IMPORT_FAILURES).toEqual(["not_this_source", "not_an_archive", "tar_gz", "partial_archive", "encrypted", "too_many_entries", "too_large_uncompressed", "bad_entry_name", "unreadable", "nothing_to_import", "scan_timed_out", "interrupted"]);
    expect(IMPORT_STOP_REASONS).toEqual(["refused_image", "by_author", "by_staff", "time_ran_out"]);
    expect(IMPORT_SKIP_REASONS).toEqual([
      "repost",
      "reply",
      "too_long",
      "warning",
      "protected",
      "left_out",
      "not_public",
      "older_version",
      "poll",
      "adult_label",
      "too_long_to_read",
      "date_out_of_range",
      "item_too_large",
      "unreadable",
      "empty",
      "already_imported",
      "over_post_cap",
      "over_item_cap",
      "new_account_cap",
    ]);
    expect(IMPORT_IMAGE_SKIPS).toEqual(["video", "sensitive", "unsupported", "too_large", "missing_file", "bluesky_no_files", "images_off", "not_chosen", "no_description", "over_image_cap", "failed", "not_checked", "flagged"]);
  });

  test("a line's marks are four bits, in this order", () => {
    expect(IMPORT_MARKS).toEqual(["reply", "long", "warning", "protected"]);
  });

  test("the error codes", () => {
    expect(ImportErrorCode.options).toEqual([
      "imports_unavailable",
      "import_active",
      "rate_limited",
      "archive_too_large",
      "wrong_state",
      "wrong_offset",
      "chunk_too_large",
      "chunk_mismatch",
      "not_an_archive",
      "statement_required",
      "nothing_chosen",
      "import_too_soon",
      "account_suspended",
      "not_found",
    ]);
  });
});

describe("IMPORT_RULES", () => {
  test("holds every number of the design, written out here as the design states it", () => {
    expect(IMPORT_RULES).toEqual({
      chunkBytes: 8_388_608,
      maxBytes: 2_147_483_648,
      chunkBodyBytes: 9_000_000,
      chunkRetries: 3,
      minAccountAgeDays: 7,
      newAccountDays: 30,
      newAccountMaxPosts: 1_000,
      importsPerWeek: 3,
      importsPerAddressDay: 5,
      chunksPerHour: 600,
      actsPerHour: 20,
      picksPerHour: 3_000,
      maxActiveDefault: 2,
      imagesPerHourDefault: 600,
      imagesPerHourMax: 600,
      minFreeBytesDefault: 2_147_483_648,
      scanWriteBytes: 4_294_967_296,
      heartbeatMs: 10_000,
      heartbeatStaleMs: 60_000,
      archiveHours: 24,
      scanMinutes: 45,
      previewHours: 24,
      checkHours: 24,
      workHours: 72,
      recordDays: 30,
      textMax: 30_000,
      shortenTo: 1_000,
      maxItems: 1_000_000,
      maxPosts: 50_000,
      maxImages: 5_000,
      earliestDate: "2006-03-21",
      futureDays: 1,
      itemMaxBytes: 1_048_576,
      itemMaxDepth: 64,
      manifestMaxBytes: 1_048_576,
      tweetsPartsMax: 99,
      carBlockMaxBytes: 1_000_000,
      carMaxBlocks: 2_000_000,
      mstMaxDepth: 48,
      mstMaxEntries: 4_096,
      zipMaxEntries: 200_000,
      zipDirectoryMaxBytes: 67_108_864,
      zipNameMaxBytes: 512,
      zipDataMaxBytes: 1_073_741_824,
      zipMaxRatio: 100,
      zipTotalMaxBytes: 4_294_967_296,
      jobFileMaxBytes: 4_096,
      summaryMaxBytes: 65_536,
      lineMaxBytes: 262_144,
      postsFileMaxBytes: 1_073_741_824,
      maxAttempts: 3,
      watchdogMs: 1_800_000,
      idleMs: 1_000,
      refusedWordsMax: 80,
      scanMaxBytes: 262_144,
      choiceMaxBytes: 1_024,
      altsMaxBytes: 16_384,
      keyBytes: 32,
      seedBytes: 32,
      imagesInFlight: 2,
      driveIntervalMs: 5_000,
      driveLockMs: 60_000,
      keyBatch: 1_000,
      batchPosts: 200,
      publishBatchesPerRound: 10,
      undoBatchesPerRound: 5,
      orphanEveryRounds: 10,
      orphanAgeMs: 3_600_000,
      pageLines: 50,
      maxPages: 1_000,
      samples: 3,
      sampleMaxBytes: 262_144,
      listMax: 20,
    });
  });

  test("the numbers agree with each other and with the rules they lean on", () => {
    // 256 chunks make the largest archive, under the global 300 requests a minute (7.3).
    expect(IMPORT_RULES.maxBytes / IMPORT_RULES.chunkBytes).toBe(256);
    expect(IMPORT_RULES.chunkBodyBytes).toBeGreaterThan(IMPORT_RULES.chunkBytes);
    // A shortened post is a post korbat could have taken (decision 13).
    expect(IMPORT_RULES.shortenTo).toBe(POST_MAX_LENGTH);
    // Every 50th line's offset, at most 1,000 of them, reaches every line of the largest scan (9.2).
    expect(IMPORT_RULES.pageLines * IMPORT_RULES.maxPages).toBe(IMPORT_RULES.maxPosts);
    // A line holds 30,000 code points of four bytes, plus the JSON and the media's names and descriptions (5.3 step 7).
    expect(IMPORT_RULES.textMax * 4 + MEDIA_MAX_PER_POST * 1_000 * 6).toBeLessThan(IMPORT_RULES.lineMaxBytes);
    expect(IMPORT_RULES.sampleMaxBytes).toBe(IMPORT_RULES.lineMaxBytes);
    // Four descriptions of 1,000 code points of four bytes, quoted and separated, fit the picks' CHECK (6.1).
    expect(MEDIA_MAX_PER_POST * (1_000 * 4 + 2) + 2 + 3 * 2).toBeLessThanOrEqual(IMPORT_RULES.altsMaxBytes);
    expect(IMPORT_RULES.heartbeatStaleMs).toBeGreaterThan(IMPORT_RULES.heartbeatMs * 3);
    expect(IMPORT_RULES.imagesPerHourDefault).toBeLessThanOrEqual(IMPORT_RULES.imagesPerHourMax);
    // The 72 hours are the three days the terms print (11.3).
    expect(IMPORT_RULES.workHours % 24).toBe(0);
  });
});

describe("ImportedText (5.1): PostText's rule at 30,000 code points", () => {
  test("30,000 code points pass and one more is refused, counted in code points, not in UTF-16 units", () => {
    const longest = ASTRAL.repeat(30_000);
    expect(ImportedText.parse(longest)).toBe(longest);
    expect(postLength(longest)).toBe(30_000);
    expect(ImportedText.safeParse(ASTRAL.repeat(30_001)).success).toBe(false);
    expect(ImportedText.safeParse("a".repeat(30_001)).success).toBe(false);
    // The text a native post may carry is far shorter.
    expect(PostText.safeParse("a".repeat(1_001)).success).toBe(false);
    expect(ImportedText.safeParse("a".repeat(1_001)).success).toBe(true);
  });

  test("the raw cap is four UTF-16 units a code point, as PostText's 4,000 is for 1,000", () => {
    expect(ImportedText.safeParse("a" + " ".repeat(119_999)).success).toBe(true);
    expect(ImportedText.safeParse("a" + " ".repeat(120_000)).success).toBe(false);
  });

  test("normalised as a post body is, and may be empty", () => {
    expect(ImportedText.parse(`  one${CR}${LF}two${LF}${LF}${LF}${LF}three  `)).toBe(`one${LF}two${LF}${LF}three`);
    expect(ImportedText.parse(`e${ACUTE}`)).toBe(E_ACUTE);
    expect(ImportedText.parse(`a${TAB}b`)).toBe(`a${TAB}b`);
    expect(ImportedText.parse("")).toBe("");
    expect(normalizePostBody(`e${ACUTE}${CR}${LF}`)).toBe(E_ACUTE);
  });

  test("control and disguising characters are refused", () => {
    expect(ImportedText.safeParse(`a${BEL}b`).success).toBe(false);
    expect(ImportedText.safeParse(`a${RLO}b`).success).toBe(false);
    expect(ImportedText.safeParse(`a${String.fromCharCode(0x85)}b`).success).toBe(false);
  });
});

describe("ImportMediaFile (5.1): <ref>-<position>.<jpg|png|webp>", () => {
  test("the names the core makes", () => {
    for (const name of ["0-0.jpg", "12-3.png", "49999-0.webp", "7-1.jpg"]) expect(ImportMediaFile.safeParse(name).success, name).toBe(true);
  });

  test("nothing else, and positions start at 0 and stay below four", () => {
    const refused = [
      "0-4.jpg",
      "50000-0.jpg",
      "01-0.jpg",
      "00-0.jpg",
      "-1-0.jpg",
      "1.5-0.jpg",
      "0-0.jpeg",
      "0-0.JPG",
      "0-0.gif",
      "0-0",
      "0.jpg",
      "",
      "..",
      "../0-0.jpg",
      "0-0.jpg/..",
      "media/0-0.jpg",
      `media${BACKSLASH}0-0.jpg`,
      " 0-0.jpg",
      "0-0.jpg ",
      `0-0.jpg${LF}`,
      "0-0.jpg.png",
    ];
    for (const name of refused) expect(ImportMediaFile.safeParse(name).success, JSON.stringify(name)).toBe(false);
  });
});

describe("ImportedPost (5.1)", () => {
  test("a line as the importer writes it", () => {
    expect(ImportedPost.parse(line())).toEqual(line());
    expect(ImportedPost.parse(line({ ref: 0 })).ref).toBe(0);
    expect(ImportedPost.parse(line({ ref: 49_999 })).ref).toBe(49_999);
  });

  test("refs are whole numbers from 0, below the cap of kept posts", () => {
    for (const ref of [-1, 50_000, 1.5, "1", null]) expect(ImportedPost.safeParse(line({ ref })).success, String(ref)).toBe(false);
  });

  test("the key is 64 lowercase hex characters", () => {
    for (const key of [KEY.toUpperCase(), KEY.slice(1), `${KEY}0`, `${KEY.slice(1)}g`]) expect(ImportedPost.safeParse(line({ key })).success, key).toBe(false);
  });

  test("the date is UTC in whole seconds", () => {
    for (const at of ["2019-03-03T10:00:00.5Z", "2019-03-03T10:00:00+01:00", "2019-03-03T10:00:00", "2019-03-03", "3 Mar 2019"]) expect(ImportedPost.safeParse(line({ at })).success, at).toBe(false);
  });

  test("kinds and parents: a thread has a parent below its own ref, and only a thread has one", () => {
    expect(ImportedPost.safeParse(line({ kind: "thread", parent: 0 })).success).toBe(true);
    expect(ImportedPost.safeParse(line({ kind: "reply" })).success).toBe(true);
    expect(ImportedPost.safeParse(line({ kind: "thread", parent: null })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "post", parent: 0 })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "reply", parent: 0 })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "thread", parent: 1 })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "thread", parent: 2 })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "thread", parent: -1, ref: 0 })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ kind: "repost" })).success).toBe(false);
  });

  test("the text follows ImportedText", () => {
    expect(ImportedPost.parse(line({ text: ` a${CR}${LF}b ` })).text).toBe(`a${LF}b`);
    expect(ImportedPost.safeParse(line({ text: ASTRAL.repeat(30_000) })).success).toBe(true);
    expect(ImportedPost.safeParse(line({ text: ASTRAL.repeat(30_001) })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ text: `a${BEL}` })).success).toBe(false);
  });

  test("a line has visible text or an image", () => {
    const image = { file: "1-0.jpg", alt: null };
    expect(ImportedPost.safeParse(line({ text: "" })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ text: `  ${LF}  ` })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ text: ZWJ })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ text: "", media: [image] })).success).toBe(true);
  });

  test("media: at most four, each named for this line, each position once", () => {
    const named = (...files: string[]) => files.map((file) => ({ file, alt: null }));
    expect(ImportedPost.safeParse(line({ media: named("1-0.jpg", "1-1.png", "1-2.webp", "1-3.jpg") })).success).toBe(true);
    expect(ImportedPost.safeParse(line({ media: named("1-3.jpg", "1-0.jpg") })).success).toBe(true);
    expect(ImportedPost.safeParse(line({ media: [...named("1-0.jpg", "1-1.png", "1-2.webp", "1-3.jpg"), ...named("1-3.png")] })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: named("2-0.jpg") })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: named("11-0.jpg") })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: named("1-0.jpg", "1-0.png") })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: named("1-4.jpg") })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: named("../1-0.jpg") })).success).toBe(false);
  });

  test("a description is AltText or null", () => {
    expect(ImportedPost.parse(line({ media: [{ file: "1-0.jpg", alt: "  A cat  " }] })).media[0]?.alt).toBe("A cat");
    expect(ImportedPost.safeParse(line({ media: [{ file: "1-0.jpg", alt: "" }] })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: [{ file: "1-0.jpg", alt: "a".repeat(1_001) }] })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: [{ file: "1-0.jpg" }] })).success).toBe(false);
  });

  test("no member beyond the contract's: a source's handle or link has nowhere to go", () => {
    expect(ImportedPost.safeParse(line({ handle: "someone" })).success).toBe(false);
    expect(ImportedPost.safeParse(line({ media: [{ file: "1-0.jpg", alt: null, url: "https://example.com/a.jpg" }] })).success).toBe(false);
    expect(ImportedPost.safeParse(JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(line()).slice(1)}`)).success).toBe(false);
    const { warning: _warning, ...withoutWarning } = line();
    expect(ImportedPost.safeParse(withoutWarning).success).toBe(false);
    expect(ImportedPost.safeParse(line({ protected: "yes" })).success).toBe(false);
  });
});

describe("ImportSummary (7.1 step 4): counts only, reasons from the closed lists", () => {
  test("the two shapes", () => {
    expect(ImportSummary.parse(scanned)).toEqual(scanned);
    expect(ImportSummary.parse({ v: 1, id: ID, status: "failed", failure: "encrypted" })).toEqual({ v: 1, id: ID, status: "failed", failure: "encrypted" });
  });

  test("anything else is refused", () => {
    const refused: unknown[] = [
      { ...scanned, v: 2 },
      { ...scanned, id: "not-an-id" },
      { ...scanned, status: "done" },
      { ...scanned, skipped: { repost: 2, handle: 1 } },
      { ...scanned, imagesSkipped: { gif: 1 } },
      { ...scanned, skipped: { repost: -1 } },
      { ...scanned, cleaned: 1.5 },
      { ...scanned, posts: 50_001 },
      { ...scanned, images: 5_001 },
      { ...scanned, file: "tweets.js" },
      { ...scanned, readInPart: 0 },
      { ...scanned, failure: "encrypted" },
      { v: 1, id: ID, status: "failed", failure: "on_fire" },
      { v: 1, id: ID, status: "failed" },
    ];
    for (const value of refused) expect(ImportSummary.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});

describe("ImportScanFacts (9.3)", () => {
  test("the intake's numbers", () => {
    expect(ImportScanFacts.parse(facts)).toEqual(facts);
    expect(ImportScanFacts.parse({ ...facts, months: [], first: null, last: null, samples: [], pages: [] }).months).toEqual([]);
  });

  test("marks are four bits; at most three samples and 1,000 pages", () => {
    expect(ImportScanFacts.safeParse({ ...facts, months: [{ month: "2019-03", groups: [[15, 1, 0, 0]] }] }).success).toBe(true);
    expect(ImportScanFacts.safeParse({ ...facts, months: [{ month: "2019-03", groups: [[16, 1, 0, 0]] }] }).success).toBe(false);
    expect(ImportScanFacts.safeParse({ ...facts, months: [{ month: "2019-13", groups: [] }] }).success).toBe(false);
    expect(ImportScanFacts.safeParse({ ...facts, samples: Array.from({ length: 4 }, (_, ref) => ({ ref, offset: ref * 10 })) }).success).toBe(false);
    expect(ImportScanFacts.safeParse({ ...facts, pages: Array.from({ length: 1_000 }, (_, page) => page * 100) }).success).toBe(true);
    expect(ImportScanFacts.safeParse({ ...facts, pages: Array.from({ length: 1_001 }, (_, page) => page * 100) }).success).toBe(false);
    expect(ImportScanFacts.safeParse({ ...facts, fromRef: 50_000 }).success).toBe(false);
  });
});

describe("ImportChoice (9.3): strict, months as YYYY-MM or null", () => {
  test("everything, a range, and one month", () => {
    expect(ImportChoice.parse(choice)).toEqual(choice);
    expect(ImportChoice.safeParse({ ...choice, from: "2019-03", to: "2020-01", long: "shorten" }).success).toBe(true);
    expect(ImportChoice.safeParse({ ...choice, from: "2019-03", to: "2019-03" }).success).toBe(true);
    expect(ImportChoice.safeParse({ ...choice, from: "2019-03" }).success).toBe(true);
  });

  test("never from after to, never a malformed month, a missing or an extra member", () => {
    expect(ImportChoice.safeParse({ ...choice, from: "2020-01", to: "2019-12" }).success).toBe(false);
    for (const month of ["2019-3", "2019-00", "2019-13", "19-03", "2019-03-01", ""]) expect(ImportChoice.safeParse({ ...choice, from: month }).success, month).toBe(false);
    expect(ImportChoice.safeParse({ ...choice, long: "cut" }).success).toBe(false);
    expect(ImportChoice.safeParse({ ...choice, everything: true }).success).toBe(false);
    const { images: _images, ...withoutImages } = choice;
    expect(ImportChoice.safeParse(withoutImages).success).toBe(false);
  });
});

describe("requests", () => {
  test("CreateImportRequest: bytes from 1 to the cap, a known source", () => {
    expect(CreateImportRequest.parse({ source: "x", bytes: 1 })).toEqual({ source: "x", bytes: 1 });
    expect(CreateImportRequest.safeParse({ source: "mastodon", bytes: IMPORT_RULES.maxBytes }).success).toBe(true);
    for (const bytes of [0, IMPORT_RULES.maxBytes + 1, 1.5, "10"]) expect(CreateImportRequest.safeParse({ source: "x", bytes }).success, String(bytes)).toBe(false);
    expect(CreateImportRequest.safeParse({ source: "reddit", bytes: 10 }).success).toBe(false);
    expect(CreateImportRequest.safeParse({ source: "x", bytes: 10, name: "archive.zip" }).success).toBe(false);
  });

  test("ConfirmImportRequest: the statement is true or the request is refused", () => {
    expect(ConfirmImportRequest.parse({ choice, statement: true })).toEqual({ choice, statement: true });
    for (const statement of [false, "true", 1, undefined]) expect(ConfirmImportRequest.safeParse({ choice, statement }).success, String(statement)).toBe(false);
    expect(ConfirmImportRequest.safeParse({ choice: { ...choice, from: "2020-02", to: "2020-01" }, statement: true }).success).toBe(false);
  });

  test("ImportPickRequest: left out or not, and at most four descriptions, each AltText or null", () => {
    expect(ImportPickRequest.parse({ leftOut: true, alts: [] })).toEqual({ leftOut: true, alts: [] });
    expect(ImportPickRequest.parse({ leftOut: false, alts: [null, " A dog "] })).toEqual({ leftOut: false, alts: [null, "A dog"] });
    expect(ImportPickRequest.safeParse({ leftOut: false, alts: [null, null, null, null, null] }).success).toBe(false);
    expect(ImportPickRequest.safeParse({ leftOut: false, alts: [""] }).success).toBe(false);
    expect(ImportPickRequest.safeParse({ leftOut: false, alts: ["a".repeat(1_001)] }).success).toBe(false);
    expect(ImportPickRequest.safeParse({ leftOut: false }).success).toBe(false);
    expect(ImportPickRequest.safeParse({ leftOut: false, alts: [], ref: 3 }).success).toBe(false);
  });
});

describe("views", () => {
  const progress = { imagesTotal: 0, imagesSettled: 0, postsTotal: 3, postsPublished: 0, postsRemoved: 0, postsLeft: 3 };
  const view = {
    id: ID,
    source: "mastodon",
    status: "ready",
    createdAt: "2026-10-21T10:00:00.000Z",
    endedAt: null,
    declaredBytes: 1_000,
    receivedBytes: 1_000,
    chunkBytes: IMPORT_RULES.chunkBytes,
    failure: null,
    stopReason: null,
    endedByStaff: null,
    scan: facts,
    samples: [{ at: "2019-03-03", text: "Hello" }],
    choice: null,
    picks: [{ month: "2019-03", groups: [[0, 1, 0, 0]] }],
    progress,
    paused: false,
    refusalId: null,
    refusedAt: null,
    refusedWords: null,
    undoable: false,
  };

  test("ImportView carries the scan's facts without their offsets", () => {
    const parsed = ImportView.parse(view);
    expect(parsed.scan).not.toBeNull();
    expect(Object.keys(parsed.scan!)).not.toContain("samples");
    expect(Object.keys(parsed.scan!)).not.toContain("pages");
    expect(parsed.samples).toEqual([{ at: "2019-03-03", text: "Hello" }]);
    expect(ImportView.safeParse({ ...view, samples: [...view.samples, ...view.samples, ...view.samples, ...view.samples] }).success).toBe(false);
    expect(ImportView.safeParse({ ...view, status: "stopped", stopReason: "by_staff", endedByStaff: "R6", scan: null, samples: [] }).success).toBe(true);
    expect(ImportView.safeParse({ ...view, stopReason: "bored" }).success).toBe(false);
  });

  test("ImportLineView: the archive's day, never its second", () => {
    const lineView = { ref: 0, at: "2019-03-03", kind: "post", marks: 0, text: "Hello", media: [{ file: "0-0.jpg", alt: null }], leftOut: false, alts: [null] };
    expect(ImportLineView.parse(lineView)).toEqual(lineView);
    expect(ImportLineView.safeParse({ ...lineView, at: "2019-03-03T10:00:00Z" }).success).toBe(false);
    expect(ImportLineView.safeParse({ ...lineView, marks: 16 }).success).toBe(false);
  });

  test("ImportPickView: the pick and the picks' counts by month and marks", () => {
    const pick = { ref: 4, leftOut: true, alts: [], picks: [{ month: "2019-03", groups: [[1, 1, 0, 0]] }] };
    expect(ImportPickView.parse(pick)).toEqual(pick);
  });
});
