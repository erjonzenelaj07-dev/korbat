# korbat import from other platforms (3b) — Task 1 of 8: Contracts and the file protocol: packages/contracts/src/imports.ts (5.1, 9.3, IMPORT_RULES) and the new package packages/import-protocol (layout, limits, summary, lines, open, fixtures), the shapes every later 3b task builds on.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-22 to 2026-10-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 1 of sub-project 3b (import from other platforms) opens batch 1 (Tasks 1 and 2) of docs/superpowers/specs/2026-10-22-import-3b-design.md, section 13: it builds the contracts of sections 5.1 and 9.3 and the file protocol of section 7.1 (the two volumes' trees, the API's one opener, the summary of the loop's step 4), with IMPORT_RULES gathered from sections 4.2, 4.8, 5.3 to 5.7, 6.1, 7.1 to 7.7, 9.2 and 11.3 and the tests of 12.1 and 12.2. It adds no API, importer or database code: Task 2 mirrors IMPORT_RULES' CHECK constants in migrations 0043 to 0045, Task 3 builds the importer and Task 4 the API on these shapes, readers and the opener.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: import from other platforms (3b) plan and verified execution prompts`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/01-contracts-and-file-protocol.md 1
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/test/imports.test.ts`

```ts
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
```

### Create `packages/import-protocol/test/layout.test.ts`

```ts
import path from "node:path";
import { describe, expect, test } from "vitest";
import { archivesLayout, isImportId, isImportMediaFile, mediaFileName, workLayout } from "../src/index";

const ID = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
/** Built by code: this file holds no backslash. */
const BACKSLASH = String.fromCharCode(92);

describe("ids", () => {
  test("only a lowercase UUID is an import id", () => {
    expect(isImportId(ID)).toBe(true);
    const refused = [
      "",
      ID.toUpperCase(),
      `${ID.slice(0, -1)}B`,
      `${ID}.json`,
      `../${ID}`,
      `${ID}/..`,
      `${ID}/x`,
      `${ID}${BACKSLASH}x`,
      `x${BACKSLASH}${ID}`,
      "..",
      ".",
      "heartbeat",
      `${ID} `,
      ` ${ID}`,
      ID.replace(/-/g, ""),
      ID.replace("-", "_"),
      `{${ID}}`,
    ];
    for (const value of refused) expect(isImportId(value), JSON.stringify(value)).toBe(false);
  });

  test("only <ref>-<position>.<jpg|png|webp> names an image of the work folder", () => {
    for (const name of ["0-0.jpg", "12-3.png", "49999-1.webp"]) expect(isImportMediaFile(name), name).toBe(true);
    const refused = ["0-4.jpg", "0-5.png", "50000-0.jpg", "..", "../0-0.jpg", "0-0.jpg/..", "a/0-0.jpg", `a${BACKSLASH}0-0.jpg`, `0-0.jpg${BACKSLASH}`, "0-0.JPG", "0-0.gif", "0-0", "", "heartbeat"];
    for (const name of refused) expect(isImportMediaFile(name), JSON.stringify(name)).toBe(false);
  });

  test("mediaFileName makes the names the core writes, and nothing else", () => {
    expect(mediaFileName(0, 0, "jpg")).toBe("0-0.jpg");
    expect(mediaFileName(49_999, 3, "webp")).toBe("49999-3.webp");
    expect(() => mediaFileName(0, 4, "jpg")).toThrow();
    expect(() => mediaFileName(-1, 0, "jpg")).toThrow();
    expect(() => mediaFileName(50_000, 0, "png")).toThrow();
    expect(() => mediaFileName(1.5, 0, "png")).toThrow();
    expect(() => mediaFileName(0, 0, "gif" as "jpg")).toThrow();
  });
});

describe("the archives volume (the API writes, the importer reads)", () => {
  test("its tree", () => {
    const archives = archivesLayout(path.join("x", "archives"));
    const at = (...parts: string[]) => path.join("x", "archives", ...parts);
    expect(archives.root).toBe(at());
    expect([archives.jobs, archives.queue, archives.deletions]).toEqual([at("jobs"), at("queue"), at("delete")]);
    expect(archives.jobDir(ID)).toBe(at("jobs", ID));
    expect(archives.part(ID)).toBe(at("jobs", ID, "archive.part"));
    expect(archives.archive(ID)).toBe(at("jobs", ID, "archive"));
    expect(archives.job(ID)).toBe(at("jobs", ID, "job.json"));
    expect(archives.queued(ID)).toBe(at("queue", ID));
    expect(archives.deletion(ID)).toBe(at("delete", ID));
  });

  test("nothing but an import id becomes part of a path", () => {
    const archives = archivesLayout("a");
    for (const bad of [ID.toUpperCase(), "..", `../${ID}`, `${ID}${BACKSLASH}..`, ""]) {
      for (const build of [archives.jobDir, archives.part, archives.archive, archives.job, archives.queued, archives.deletion]) expect(() => build(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("the work volume (the importer writes, the API reads)", () => {
  test("its tree", () => {
    const work = workLayout(path.join("x", "work"));
    const at = (...parts: string[]) => path.join("x", "work", ...parts);
    expect(work.root).toBe(at());
    expect([work.jobs, work.attempts, work.tmp, work.heartbeat]).toEqual([at("jobs"), at("attempts"), at("tmp"), at("heartbeat")]);
    expect(work.jobDir(ID)).toBe(at("jobs", ID));
    expect(work.scratch(ID)).toBe(at("jobs", ID, "scratch"));
    expect(work.posts(ID)).toBe(at("jobs", ID, "posts.jsonl"));
    expect(work.mediaDir(ID)).toBe(at("jobs", ID, "media"));
    expect(work.media(ID, "3-1.png")).toBe(at("jobs", ID, "media", "3-1.png"));
    expect(work.summary(ID)).toBe(at("jobs", ID, "summary.json"));
    expect(work.attempt(ID)).toBe(at("attempts", ID));
  });

  test("ids and media names are checked before any path is built", () => {
    const work = workLayout("w");
    for (const bad of [ID.toUpperCase(), "..", `${ID}/x`, `${ID}${BACKSLASH}x`, ""]) {
      for (const build of [work.jobDir, work.scratch, work.posts, work.mediaDir, work.summary, work.attempt]) expect(() => build(bad), JSON.stringify(bad)).toThrow();
      expect(() => work.media(bad, "0-0.jpg")).toThrow();
    }
    for (const name of ["0-4.jpg", "..", "../summary.json", `..${BACKSLASH}0-0.jpg`, "0-0.jpg/x", "summary.json"]) expect(() => work.media(ID, name), name).toThrow();
  });
});
```

### Create `packages/import-protocol/test/open.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openWorkFile, readSummary, workLayout } from "../src/index";

/**
 * The API's one opener (3b design, section 7.1): every file of import-work the API reads is opened through it, since the
 * importer that wrote the volume parses hostile input. On Windows a directory junction stands in for a symlinked folder:
 * it needs no privilege, and lstat reports it as a symbolic link, as a plain directory link on Linux.
 */
const base = mkdtempSync(path.join(tmpdir(), "korbat-import-open-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A fresh work volume holding one job's posts.jsonl, and a folder outside it with a file of the same name. */
function planted() {
  const dir = path.join(base, randomUUID());
  const work = workLayout(path.join(dir, "work"));
  const id = randomUUID();
  mkdirSync(work.mediaDir(id), { recursive: true });
  writeFileSync(work.posts(id), "hello");
  const outside = path.join(dir, "outside");
  mkdirSync(path.join(outside, "media"), { recursive: true });
  writeFileSync(path.join(outside, "posts.jsonl"), "SECRET=1");
  writeFileSync(path.join(outside, "summary.json"), "{}");
  writeFileSync(path.join(outside, "media", "0-0.jpg"), "SECRET=1");
  return { work, id, outside };
}

/** Plants a link to a folder: a junction on Windows, a symlink elsewhere. */
function linkFolder(target: string, link: string) {
  symlinkSync(target, link, "junction");
}

describe("openWorkFile", () => {
  test("a plain file is opened and read through its descriptor", async () => {
    const { work, id } = planted();
    const opened = await openWorkFile(work.root, work.posts(id), 5);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      expect(opened.file.size).toBe(5);
      expect(await opened.file.handle.readFile("utf8")).toBe("hello");
    } finally {
      await opened.file.handle.close();
    }
  });

  test("at its cap, and one byte over", async () => {
    const { work, id } = planted();
    const atCap = await openWorkFile(work.root, work.posts(id), 5);
    if (atCap.ok) await atCap.file.handle.close();
    expect(atCap.ok).toBe(true);
    expect(await openWorkFile(work.root, work.posts(id), 4)).toEqual({ ok: false, code: "too_large" });
  });

  test("a file that is not there, and a path outside the mount", async () => {
    const { work, id, outside } = planted();
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "missing" });
    expect(await openWorkFile(work.root, work.posts(randomUUID()), 100)).toEqual({ ok: false, code: "missing" });
    expect(await openWorkFile(work.root, path.join(outside, "posts.jsonl"), 100)).toEqual({ ok: false, code: "outside" });
    expect(await openWorkFile(work.root, path.join(work.root, "..", "outside", "posts.jsonl"), 100)).toEqual({ ok: false, code: "outside" });
  });

  test("a directory is not a file", async () => {
    const { work, id } = planted();
    expect(await openWorkFile(work.root, work.mediaDir(id), 100)).toEqual({ ok: false, code: "not_a_file" });
    expect(await openWorkFile(work.root, work.jobDir(id), 100)).toEqual({ ok: false, code: "not_a_file" });
    expect(await openWorkFile(work.root, work.root, 100)).toEqual({ ok: false, code: "not_a_file" });
    // A file where a folder of the path should be.
    expect(await openWorkFile(work.root, path.join(work.posts(id), "x"), 100)).toEqual({ ok: false, code: "not_a_file" });
  });

  test("a file on another device is refused, through the tests' device seam", async () => {
    const { work, id } = planted();
    expect(await openWorkFile(work.root, work.posts(id), 100, { device: -1 })).toEqual({ ok: false, code: "other_device" });
    const same = await openWorkFile(work.root, work.posts(id), 100, { device: statSync(work.root, { bigint: true }).dev });
    expect(same.ok).toBe(true);
    if (same.ok) await same.file.handle.close();
  });

  test("a symlinked job folder is refused, wherever it leads", async () => {
    const { work, outside } = planted();
    const id = randomUUID();
    linkFolder(outside, work.jobDir(id));
    expect(await openWorkFile(work.root, work.posts(id), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "symlink" });
  });

  test("a symlinked media folder, and a symlinked jobs folder, are refused", async () => {
    const { work, id, outside } = planted();
    rmSync(work.mediaDir(id), { recursive: true });
    linkFolder(path.join(outside, "media"), work.mediaDir(id));
    expect(await openWorkFile(work.root, work.media(id, "0-0.jpg"), 100)).toEqual({ ok: false, code: "symlink" });

    const other = workLayout(path.join(base, randomUUID(), "work"));
    const elsewhere = path.join(base, randomUUID());
    const otherId = randomUUID();
    mkdirSync(path.join(elsewhere, otherId), { recursive: true });
    writeFileSync(path.join(elsewhere, otherId, "posts.jsonl"), "SECRET=1");
    mkdirSync(other.root, { recursive: true });
    linkFolder(elsewhere, other.jobs);
    expect(await openWorkFile(other.root, other.posts(otherId), 100)).toEqual({ ok: false, code: "symlink" });
  });

  test("a symlink planted in place of a file is refused, even one that stays inside the volume", async (context) => {
    const { work, id, outside } = planted();
    const other = randomUUID();
    mkdirSync(work.jobDir(other), { recursive: true });
    try {
      symlinkSync(path.join(outside, "posts.jsonl"), work.posts(other));
      symlinkSync(work.posts(id), work.summary(other));
    } catch (err) {
      // Windows without Developer Mode cannot make a file symlink: the folder cases above stand for it there.
      if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") return context.skip();
      throw err;
    }
    expect(await openWorkFile(work.root, work.posts(other), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await openWorkFile(work.root, work.summary(other), 100)).toEqual({ ok: false, code: "symlink" });
  });

  test.skipIf(process.platform === "win32")("a FIFO is refused at once instead of blocking a thread", { timeout: 5_000 }, async () => {
    const { work, id } = planted();
    execFileSync("mkfifo", [work.summary(id)]);
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "not_a_file" });
  });
});
```

### Create `packages/import-protocol/test/readers.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES, type ImportSummary, type ImportedPost } from "@korbat/contracts";
import {
  IMPORTER_HEARTBEAT_INTERVAL_MS,
  IMPORTER_HEARTBEAT_STALE_MS,
  JOB_FILE_MAX_BYTES,
  LINE_MAX_BYTES,
  POSTS_MAX_BYTES,
  POSTS_MAX_LINES,
  SAMPLE_MAX_BYTES,
  SCAN_MAX_ATTEMPTS,
  SUMMARY_MAX_BYTES,
  archivesLayout,
  parsePostLine,
  readHeartbeat,
  readJobFile,
  readLineAt,
  readLines,
  readSummary,
  serializeLine,
  workLayout,
  writeScanOutput,
  type RawLine,
} from "../src/index";

const root = mkdtempSync(path.join(tmpdir(), "korbat-import-readers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const LF = String.fromCharCode(10);
/** Three bytes in UTF-8 and one UTF-16 unit, so byte offsets and string lengths differ. */
const CJK = String.fromCharCode(0x4e00);
const KEY = "0123456789abcdef".repeat(4);

/** A fresh pair of volumes in the temporary directory. */
function volumes() {
  const base = path.join(root, randomUUID());
  return { archives: archivesLayout(path.join(base, "archives")), work: workLayout(path.join(base, "work")) };
}

function post(ref: number, change: Partial<ImportedPost> = {}): ImportedPost {
  return { ref, key: KEY, at: `2019-03-0${(ref % 9) + 1}T10:00:00Z`, kind: "post", parent: null, text: `post ${ref} ${CJK}`, media: [], protected: false, warning: false, ...change };
}

function scanned(id: string, posts: number): ImportSummary {
  return { v: 1, id, status: "scanned", posts, images: 0, skipped: {}, imagesSkipped: {}, cleaned: 0, warnings: 0, sourceLinks: 0, protectedPosts: 0, readInPart: false };
}

/** Writes `body` as the whole file, creating its folder. */
function plant(file: string, body: string | Uint8Array) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/** Every line a file yields, from the reader's options. */
async function linesOf(file: string, options: Parameters<typeof readLines>[1] = {}): Promise<RawLine[]> {
  const handle = await open(file, "r");
  try {
    const out: RawLine[] = [];
    for await (const line of readLines(handle, options)) out.push(line);
    return out;
  } finally {
    await handle.close();
  }
}

describe("the protocol's caps come from IMPORT_RULES", () => {
  test("one place for each number", () => {
    expect(JOB_FILE_MAX_BYTES).toBe(4_096);
    expect(SUMMARY_MAX_BYTES).toBe(65_536);
    expect(LINE_MAX_BYTES).toBe(262_144);
    expect(POSTS_MAX_LINES).toBe(50_000);
    expect(POSTS_MAX_BYTES).toBe(1_073_741_824);
    expect(SAMPLE_MAX_BYTES).toBe(262_144);
    expect(IMPORTER_HEARTBEAT_INTERVAL_MS).toBe(10_000);
    expect(IMPORTER_HEARTBEAT_STALE_MS).toBe(60_000);
    expect(SCAN_MAX_ATTEMPTS).toBe(3);
    expect([JOB_FILE_MAX_BYTES, SUMMARY_MAX_BYTES, LINE_MAX_BYTES, POSTS_MAX_LINES, POSTS_MAX_BYTES, SAMPLE_MAX_BYTES, SCAN_MAX_ATTEMPTS]).toEqual([
      IMPORT_RULES.jobFileMaxBytes,
      IMPORT_RULES.summaryMaxBytes,
      IMPORT_RULES.lineMaxBytes,
      IMPORT_RULES.maxPosts,
      IMPORT_RULES.postsFileMaxBytes,
      IMPORT_RULES.sampleMaxBytes,
      IMPORT_RULES.maxAttempts,
    ]);
  });
});

describe("job.json", () => {
  const id = randomUUID();
  const job = { v: 1, id, source: "mastodon", accountKey: KEY, images: false, createdAt: "2026-10-21T10:00:00.000Z" };

  test("read and parsed with its schema, at its cap", async () => {
    const { archives } = volumes();
    const body = JSON.stringify(job);
    plant(archives.job(id), body + " ".repeat(JOB_FILE_MAX_BYTES - body.length));
    expect(await readJobFile(archives.root, id)).toEqual({ ok: true, value: job });
  });

  test("one byte over its cap is refused", async () => {
    const { archives } = volumes();
    const body = JSON.stringify(job);
    plant(archives.job(id), body + " ".repeat(JOB_FILE_MAX_BYTES + 1 - body.length));
    expect(await readJobFile(archives.root, id)).toEqual({ ok: false, code: "too_large" });
  });

  test("a missing file, a broken one, another id, a key that is not 64 lowercase hex, an extra member", async () => {
    const { archives } = volumes();
    expect(await readJobFile(archives.root, id)).toEqual({ ok: false, code: "missing" });
    const cases: [unknown, string][] = [
      ["{", "invalid"],
      [{ ...job, id: randomUUID() }, "wrong_id"],
      [{ ...job, accountKey: KEY.toUpperCase() }, "invalid"],
      [{ ...job, accountKey: KEY.slice(2) }, "invalid"],
      [{ ...job, source: "reddit" }, "invalid"],
      [{ ...job, handle: "someone" }, "invalid"],
      [{ ...job, v: 2 }, "invalid"],
    ];
    for (const [value, code] of cases) {
      plant(archives.job(id), typeof value === "string" ? value : JSON.stringify(value));
      expect(await readJobFile(archives.root, id), JSON.stringify(value)).toEqual({ ok: false, code });
    }
  });
});

describe("summary.json", () => {
  test("read with the contracts' ImportSummary, at its cap", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const summary = scanned(id, 2);
    const body = JSON.stringify(summary);
    plant(work.summary(id), body + " ".repeat(SUMMARY_MAX_BYTES - body.length));
    expect(await readSummary(work.root, id)).toEqual({ ok: true, value: summary });
    plant(work.summary(id), body + " ".repeat(SUMMARY_MAX_BYTES + 1 - body.length));
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "too_large" });
  });

  test("a failed scan's summary", async () => {
    const { work } = volumes();
    const id = randomUUID();
    plant(work.summary(id), JSON.stringify({ v: 1, id, status: "failed", failure: "partial_archive" }));
    expect(await readSummary(work.root, id)).toEqual({ ok: true, value: { v: 1, id, status: "failed", failure: "partial_archive" } });
  });

  test("a summary that names another import is refused, as is anything but the contract", async () => {
    const { work } = volumes();
    const id = randomUUID();
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "missing" });
    plant(work.summary(id), JSON.stringify(scanned(randomUUID(), 1)));
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "wrong_id" });
    plant(work.summary(id), JSON.stringify(scanned(id.toUpperCase(), 1)));
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "wrong_id" });
    for (const body of ["", "null", "[]", JSON.stringify({ ...scanned(id, 1), skipped: { secret: 1 } }), JSON.stringify({ ...scanned(id, 1), text: "a post" })]) {
      plant(work.summary(id), body);
      expect(await readSummary(work.root, id), body).toEqual({ ok: false, code: "invalid" });
    }
  });
});

describe("the heartbeat", () => {
  test("when the importer last completed a tick", async () => {
    const { work } = volumes();
    expect(await readHeartbeat(work.root)).toEqual({ ok: false, code: "missing" });
    plant(work.heartbeat, JSON.stringify({ v: 1, at: 1_700_000_000_000 }));
    expect(await readHeartbeat(work.root)).toEqual({ ok: true, value: { v: 1, at: 1_700_000_000_000 } });
    plant(work.heartbeat, JSON.stringify({ v: 1, at: -1 }));
    expect(await readHeartbeat(work.root)).toEqual({ ok: false, code: "invalid" });
  });
});

describe("the line serialiser", () => {
  test("one ImportedPost a line, members in the contract's order, ending in a line feed", () => {
    const line = post(3, { kind: "thread", parent: 1, media: [{ file: "3-0.jpg", alt: "A cat" }], warning: true });
    const text = serializeLine(line);
    expect(text.endsWith(LF)).toBe(true);
    expect(text.indexOf(LF)).toBe(text.length - 1);
    expect(Object.keys(JSON.parse(text))).toEqual(["ref", "key", "at", "kind", "parent", "text", "media", "protected", "warning"]);
    // The same post built in any other order is the same bytes, so the importer and the fixture never differ.
    const shuffled = { warning: true, protected: false, media: [{ alt: "A cat", file: "3-0.jpg" }], text: line.text, parent: 1, kind: "thread", at: line.at, key: KEY, ref: 3 } as ImportedPost;
    expect(serializeLine(shuffled)).toBe(text);
    expect(parsePostLine(text.slice(0, -1))).toEqual(line);
  });

  test("a line feed inside the text stays inside the JSON string", () => {
    const text = serializeLine(post(0, { text: `one${LF}two` }));
    expect(text.indexOf(LF)).toBe(text.length - 1);
    expect(parsePostLine(text.slice(0, -1))?.text).toBe(`one${LF}two`);
  });

  test("a line that is not JSON or not an ImportedPost parses to null", () => {
    for (const text of ["", "{", "null", "[]", JSON.stringify({ ...post(0), handle: "someone" }), JSON.stringify({ ...post(0), text: "" })]) expect(parsePostLine(text), text).toBeNull();
  });
});

describe("posts.jsonl", () => {
  test("each line with the byte offset at which it starts and the one at which the next does", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const posts = [post(0), post(1, { text: CJK.repeat(100) }), post(2)];
    writeScanOutput(work.root, posts, scanned(id, 3), {});
    const bytes = posts.map((line) => Buffer.byteLength(serializeLine(line)));
    const lines = await linesOf(work.posts(id));
    expect(lines.map((line) => [line.offset, line.next])).toEqual([
      [0, bytes[0]],
      [bytes[0], bytes[0]! + bytes[1]!],
      [bytes[0]! + bytes[1]!, bytes[0]! + bytes[1]! + bytes[2]!],
    ]);
    expect(lines.map((line) => parsePostLine(line.text!))).toEqual(posts);
  });

  test("from a line's offset, as a page or a sample starts", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const posts = [post(0), post(1), post(2), post(3)];
    writeScanOutput(work.root, posts, scanned(id, 4), {});
    const all = await linesOf(work.posts(id));
    const from = await linesOf(work.posts(id), { from: all[2]!.offset });
    expect(from).toEqual(all.slice(2));
    expect(await linesOf(work.posts(id), { from: all[1]!.offset, maxLines: 2 })).toEqual(all.slice(1, 3));
  });

  test("a line split across reads is joined, whatever the read size", async () => {
    const { work } = volumes();
    const id = randomUUID();
    writeScanOutput(work.root, [post(0, { text: CJK.repeat(40) }), post(1), post(2, { text: "x".repeat(300) })], scanned(id, 3), {});
    const whole = await linesOf(work.posts(id));
    for (const chunkBytes of [1, 2, 3, 7, 64, 1_000]) expect(await linesOf(work.posts(id), { chunkBytes }), String(chunkBytes)).toEqual(whole);
  });

  test("a line at its cap is read; one byte over is reported, passed over to its line feed, and the next line is read", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const atCap = "a".repeat(LINE_MAX_BYTES);
    const over = "b".repeat(LINE_MAX_BYTES + 1);
    writeScanOutput(work.root, [atCap, over, post(2)], scanned(id, 3), {});
    const lines = await linesOf(work.posts(id));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ offset: 0, next: LINE_MAX_BYTES + 1, text: atCap });
    expect(lines[1]).toEqual({ offset: LINE_MAX_BYTES + 1, next: 2 * LINE_MAX_BYTES + 3, text: null });
    expect(lines[2]!.offset).toBe(2 * LINE_MAX_BYTES + 3);
    expect(parsePostLine(lines[2]!.text!)).toEqual(post(2));
  });

  test("an over-long line at the end of the file, and a last line without its line feed", async () => {
    const { work } = volumes();
    const id = randomUUID();
    plant(work.posts(id), `${serializeLine(post(0))}${"c".repeat(LINE_MAX_BYTES + 5)}`);
    const first = Buffer.byteLength(serializeLine(post(0)));
    expect((await linesOf(work.posts(id))).slice(1)).toEqual([{ offset: first, next: first + LINE_MAX_BYTES + 5, text: null }]);
    plant(work.posts(id), `${serializeLine(post(0))}{"partial":`);
    expect((await linesOf(work.posts(id))).slice(1)).toEqual([{ offset: first, next: first + 11, text: '{"partial":' }]);
  });

  test("the line count cap: 50,000 lines, and not one more", async () => {
    const { work } = volumes();
    const id = randomUUID();
    plant(work.posts(id), `{}${LF}`.repeat(POSTS_MAX_LINES + 1));
    const lines = await linesOf(work.posts(id));
    expect(lines).toHaveLength(POSTS_MAX_LINES);
    expect(lines.at(-1)).toEqual({ offset: (POSTS_MAX_LINES - 1) * 3, next: POSTS_MAX_LINES * 3, text: "{}" });
  });

  test("the byte cap: nothing at or past it is read, and a line it cuts is not yielded", async () => {
    const { work } = volumes();
    const id = randomUUID();
    plant(work.posts(id), `aaaa${LF}bbbb${LF}cccc${LF}`);
    expect((await linesOf(work.posts(id), { maxBytes: 10 })).map((line) => line.text)).toEqual(["aaaa", "bbbb"]);
    expect((await linesOf(work.posts(id), { maxBytes: 9 })).map((line) => line.text)).toEqual(["aaaa"]);
    expect((await linesOf(work.posts(id), { maxBytes: 15 })).map((line) => line.text)).toEqual(["aaaa", "bbbb", "cccc"]);
    expect((await linesOf(work.posts(id), { maxBytes: 14 })).map((line) => line.text)).toEqual(["aaaa", "bbbb"]);
  });

  test("a sample is one line from its offset, at most 256 KiB", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const atCap = "s".repeat(SAMPLE_MAX_BYTES);
    writeScanOutput(work.root, [post(0), atCap, "t".repeat(SAMPLE_MAX_BYTES + 1)], scanned(id, 3), {});
    const first = Buffer.byteLength(serializeLine(post(0)));
    const handle = await open(work.posts(id), "r");
    try {
      expect(await readLineAt(handle, first)).toBe(atCap);
      expect(await readLineAt(handle, first + SAMPLE_MAX_BYTES + 1)).toBeNull();
      // Past the last line there is nothing to read.
      expect(await readLineAt(handle, first + 2 * SAMPLE_MAX_BYTES + 3)).toBeNull();
      expect(parsePostLine((await readLineAt(handle, 0))!)).toEqual(post(0));
    } finally {
      await handle.close();
    }
  });
});

describe("writeScanOutput, the importer's stand-in", () => {
  test("lines, images and the summary land in the job's folder, and nothing stays in tmp/", async () => {
    const { work } = volumes();
    const id = randomUUID();
    const posts = [post(0, { media: [{ file: "0-0.jpg", alt: null }, { file: "0-1.png", alt: "A dog" }] }), post(1)];
    const summary = { ...scanned(id, 2), images: 2 };
    writeScanOutput(work.root, posts, summary, { "0-0.jpg": Uint8Array.from([0xff, 0xd8, 0xff]), "0-1.png": Uint8Array.from([0x89, 0x50]) });
    expect(readFileSync(work.posts(id), "utf8")).toBe(posts.map(serializeLine).join(""));
    expect([...readFileSync(work.media(id, "0-0.jpg"))]).toEqual([0xff, 0xd8, 0xff]);
    expect(readdirSync(work.mediaDir(id)).sort()).toEqual(["0-0.jpg", "0-1.png"]);
    expect(readdirSync(work.tmp)).toEqual([]);
    expect(await readSummary(work.root, id)).toEqual({ ok: true, value: summary });
  });

  test("an image name the layout refuses is never written", () => {
    const { work } = volumes();
    const id = randomUUID();
    expect(() => writeScanOutput(work.root, [], scanned(id, 0), { "../summary.json": Uint8Array.from([1]) })).toThrow();
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:  Test Files  1 failed | 28 passed (29)
packages/contracts test:       Tests  459 passed (459)
ELIFECYCLE  Test failed. See above for more details.
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/01-contracts-and-file-protocol.md 3
```

Expected: 13 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/imports.ts`

```ts
import { z } from "zod";
import { AltText, MEDIA_MAX_PER_POST } from "./media";
import { FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizePostBody, postLength, visibleLength } from "./text";

/**
 * Import from other platforms (3b design, docs/superpowers/specs/2026-10-22-import-3b-design.md, sections 5.1 and 9.3;
 * Task 1): the line the importer writes and the API reads back as hostile input, the importer's summary, the intake's
 * numbers, the person's choice, the views, the closed lists and every number of the design. It imports only zod,
 * ./media and ./text, so social.ts, moderation.ts, staff.ts and account.ts can read ImportSource while they load.
 */

const rules = {
  /** 7.3: a chunk is exactly this long but the last; under Cloudflare's 100 MB and inside its 125-second read timeout. */
  chunkBytes: 8_388_608,
  /** 7.3: the largest archive, 256 chunks; the CHECK of import_jobs.declared_bytes (6.1). */
  maxBytes: 2_147_483_648,
  /** 7.3: Caddy's body limit for a chunk, its "9MB", which Caddy reads as decimal megabytes. */
  chunkBodyBytes: 9_000_000,
  /** 9.4: the app sends a chunk whose hash differed again at most this often. */
  chunkRetries: 3,
  /** 4.2 step 3, decision 21: an account imports once it is this old (import_too_soon). */
  minAccountAgeDays: 7,
  /** Decision 21: an account younger than this publishes at most newAccountMaxPosts posts per import. */
  newAccountDays: 30,
  newAccountMaxPosts: 1_000,
  /** 7.6: the limits. Published imports per account in seven days, imports created per address in a day, and per hour per account. */
  importsPerWeek: 3,
  importsPerAddressDay: 5,
  chunksPerHour: 600,
  actsPerHour: 20,
  picksPerHour: 3_000,
  /** 7.7: the default of IMPORT_MAX_ACTIVE, imports in uploading or scanning on the site at once. */
  maxActiveDefault: 2,
  /** 7.4, 7.7: IMPORT_IMAGES_PER_HOUR's default, and the most it may be set to (it may only be lowered). */
  imagesPerHourDefault: 600,
  imagesPerHourMax: 600,
  /** 7.7: the default of IMPORT_MIN_FREE_BYTES, kept free on import-archives beyond a new import's size and scanWriteBytes. */
  minFreeBytesDefault: 2_147_483_648,
  /** 4.2 step 3, 7.2: the most a scan may write to import-work. */
  scanWriteBytes: 4_294_967_296,
  /** 7.1: the importer rewrites its heartbeat this often; the API takes no new import once it is older than the second. */
  heartbeatMs: 10_000,
  heartbeatStaleMs: 60_000,
  /** 4.8, decision 4: an archive lives at most this long after its import was created (an upload not complete then expires, a scan not done fails). */
  archiveHours: 24,
  /** 4.8: a scan not done this long after the upload ended fails (scan_timed_out). */
  scanMinutes: 45,
  /** 4.8: a preview not confirmed this long after the scan ended expires. */
  previewHours: 24,
  /** 4.8, decision 19: an imported image whose check is not answered this long after its upload is left out. */
  checkHours: 24,
  /** 4.8: an import not finished this long after its scan ended is stopped; the work folder never outlives it (the terms' three days). */
  workHours: 72,
  /** 4.8, decision 25: a finished import's record stays at least this long after its end. */
  recordDays: 30,
  /** 5.3 step 7, decision 13: a longer text is skipped (too_long_to_read). */
  textMax: 30_000,
  /** Decision 13: a post over this many code points is long; shortened, it is cut to this many with its ellipsis. */
  shortenTo: 1_000,
  /** 5.4: items read, posts kept and images kept by one scan. */
  maxItems: 1_000_000,
  maxPosts: 50_000,
  maxImages: 5_000,
  /** 5.4: a date before the first tweet, or more than futureDays after the import was created, is skipped (date_out_of_range). */
  earliestDate: "2006-03-21",
  futureDays: 1,
  /** 5.5, 5.6: one JSON element of a data file, in bytes and levels (item_too_large). */
  itemMaxBytes: 1_048_576,
  itemMaxDepth: 64,
  /** 5.5: X's data/manifest.js, and the highest N of data/tweets-part<N>.js. */
  manifestMaxBytes: 1_048_576,
  tweetsPartsMax: 99,
  /** 5.7: a CAR's blocks, and its MST's levels and entries a node. */
  carBlockMaxBytes: 1_000_000,
  carMaxBlocks: 2_000_000,
  mstMaxDepth: 48,
  mstMaxEntries: 4_096,
  /** 7.2: the zip reader's limits: entries, central directory, a name, a data file, the ratio, the allowlisted entries' sum. */
  zipMaxEntries: 200_000,
  zipDirectoryMaxBytes: 67_108_864,
  zipNameMaxBytes: 512,
  zipDataMaxBytes: 1_073_741_824,
  zipMaxRatio: 100,
  zipTotalMaxBytes: 4_294_967_296,
  /** 7.1, 7.5: the file protocol's caps: job.json, summary.json, a line of posts.jsonl, and posts.jsonl (whose lines are at most maxPosts). */
  jobFileMaxBytes: 4_096,
  summaryMaxBytes: 65_536,
  lineMaxBytes: 262_144,
  postsFileMaxBytes: 1_073_741_824,
  /** 7.1: the third start of a scan fails it (interrupted); the watchdog ends a scan; the loop sleeps this long when idle. */
  maxAttempts: 3,
  watchdogMs: 1_800_000,
  idleMs: 1_000,
  /** 6.1: the CHECKs of import_jobs (refused_words in code points, scan and choice in bytes), import_picks.alts, import_keys.key and the seed. */
  refusedWordsMax: 80,
  scanMaxBytes: 262_144,
  choiceMaxBytes: 1_024,
  altsMaxBytes: 16_384,
  keyBytes: 32,
  seedBytes: 32,
  /** 7.4: imported images in processing on the site at once. */
  imagesInFlight: 2,
  /** 7.5: import-drive's interval and lock, the intake's batch of keys, a batch of posts, batches a round, the orphan pass. */
  driveIntervalMs: 5_000,
  driveLockMs: 60_000,
  keyBatch: 1_000,
  batchPosts: 200,
  publishBatchesPerRound: 10,
  undoBatchesPerRound: 5,
  orphanEveryRounds: 10,
  orphanAgeMs: 3_600_000,
  /** 9.2: lines a page of the preview, pages kept, samples and a sample's bytes, imports listed. */
  pageLines: 50,
  maxPages: 1_000,
  samples: 3,
  sampleMaxBytes: 262_144,
  listMax: 20,
};

/**
 * Every number of the design (section 9.3), as 3d's AUTOMATION_RULES holds its own: the CHECK constants of Task 2's
 * migrations mirror the ones of 6.1, a database test holds them equal, and the terms print their hours and days from
 * here (11.3). Settings that the owner may change are named for their defaults.
 */
export const IMPORT_RULES: Readonly<typeof rules> = rules;

export const IMPORT_SOURCE_KINDS = ["x", "mastodon", "bluesky"] as const;
export const ImportSource = z.enum(IMPORT_SOURCE_KINDS);
export type ImportSource = z.infer<typeof ImportSource>;

/** The twelve states of section 4.1. */
export const ImportStatus = z.enum(["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** The active states: an account has at most one import in them (import_jobs_one_active). undoing is not one. */
export const IMPORT_ACTIVE_STATES = ["uploading", "scanning", "ready", "preparing", "publishing"] as const satisfies readonly ImportStatus[];

/** Why a scan failed: import_jobs.failure's CHECK, and a failed summary's member. */
export const IMPORT_FAILURES = [
  "not_this_source",
  "not_an_archive",
  "tar_gz",
  "partial_archive",
  "encrypted",
  "too_many_entries",
  "too_large_uncompressed",
  "bad_entry_name",
  "unreadable",
  "nothing_to_import",
  "scan_timed_out",
  "interrupted",
] as const;
export const ImportFailure = z.enum(IMPORT_FAILURES);
export type ImportFailure = z.infer<typeof ImportFailure>;

/** Why an import was stopped: import_jobs.stop_reason's CHECK. */
export const IMPORT_STOP_REASONS = ["refused_image", "by_author", "by_staff", "time_ran_out"] as const;
export type ImportStopReason = (typeof IMPORT_STOP_REASONS)[number];

/**
 * Why a post is not published. reply, too_long, warning, protected and left_out are counted by the app from the month
 * table and the picks when the choice leaves them out; already_imported and new_account_cap by the intake; the rest by
 * the importer.
 */
export const IMPORT_SKIP_REASONS = [
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
] as const;
export type ImportSkipReason = (typeof IMPORT_SKIP_REASONS)[number];

/** Why an image is not imported. */
export const IMPORT_IMAGE_SKIPS = ["video", "sensitive", "unsupported", "too_large", "missing_file", "bluesky_no_files", "images_off", "not_chosen", "no_description", "over_image_cap", "failed", "not_checked", "flagged"] as const;
export type ImportImageSkip = (typeof IMPORT_IMAGE_SKIPS)[number];

/**
 * A line's marks, the facts a choice decides on, as bits: IMPORT_MARKS[i] is the bit 1 << i. reply: its kind is reply;
 * long: its text is over shortenTo code points; warning and protected: the line's members of those names.
 */
export const IMPORT_MARKS = ["reply", "long", "warning", "protected"] as const;

const Count = z.int().min(0);
const Ref = z.int().min(0).max(IMPORT_RULES.maxPosts - 1);
/** A byte offset into posts.jsonl. */
const Offset = z.int().min(0).max(IMPORT_RULES.postsFileMaxBytes);
const Marks = z.int().min(0).max(2 ** IMPORT_MARKS.length - 1);
const Month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
/** The archive's day, never its second, which with the text would fingerprint the original. */
const Day = z.iso.date();
const Kind = z.enum(["post", "thread", "reply"]);

/**
 * PostText's rule with textMax in place of POST_MAX_LENGTH, and its raw cap scaled the same way (four UTF-16 units a code
 * point). This module's refinements carry no message of their own: no person reads them (the API answers invalid_request
 * and the intake counts a line unreadable), and every byte here is in the app's web bundle.
 */
export const ImportedText = z
  .string()
  .max(IMPORT_RULES.textMax * 4)
  .transform(normalizePostBody)
  .refine((text) => !FORBIDDEN_CONTROL.test(text))
  .refine((text) => !FORBIDDEN_FORMAT.test(text))
  .refine((text) => postLength(text) <= IMPORT_RULES.textMax);
export type ImportedText = z.infer<typeof ImportedText>;

/**
 * The only names the work folder's media/ may hold: <ref>-<position>.<jpg|png|webp>, the ref without leading zeros and
 * below maxPosts, the position from 0, as refs count, and below MEDIA_MAX_PER_POST (so 0 to 3).
 */
export const ImportMediaFile = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,4})-[0-3][.](jpg|png|webp)$/)
  .refine((file) => Number.parseInt(file, 10) < IMPORT_RULES.maxPosts);
export type ImportMediaFile = z.infer<typeof ImportMediaFile>;

/** One kept post, one line of posts.jsonl (5.1). The importer writes it; the API parses every line with this schema. */
export const ImportedPost = z
  .strictObject({
    /** Its line in posts.jsonl, from 0; lines are in ascending order of `at`. */
    ref: Ref,
    /** HMAC-SHA256 of the source and the source post's id under the account's import key, as 64 lowercase hex. */
    key: z.string().regex(/^[0-9a-f]{64}$/),
    /** The date the archive gives the post, UTC, whole seconds. */
    at: z.iso.datetime({ offset: false, precision: 0 }),
    /** post: the account's own top-level post; thread: a reply to its own post; reply: a reply to someone else. */
    kind: Kind,
    /** The ref of the post a `thread` item answers, always lower than its own ref; null otherwise. */
    parent: z.int().min(0).nullable(),
    /** korbat's plain text: converted, cleaned and normalised (5.3); up to textMax code points. */
    text: ImportedText,
    /** Images in the work folder, in order; `alt` is the source's description, normalised, or null. */
    media: z.array(z.strictObject({ file: ImportMediaFile, alt: AltText.nullable() })).max(MEDIA_MAX_PER_POST),
    /** X only: dated inside a period protected-history.js marks as protected (5.5); left out unless chosen. */
    protected: z.boolean(),
    /** Mastodon only: the text begins with a content warning's line (decision 12); left out unless chosen. */
    warning: z.boolean(),
  })
  .refine((post) => (post.kind === "thread") === (post.parent !== null) && (post.parent === null || post.parent < post.ref), { path: ["parent"] })
  .refine((post) => visibleLength(post.text) >= 1 || post.media.length >= 1, { path: ["text"] })
  .refine(
    (post) => {
      const names = post.media.map(({ file }) => file.split(/[-.]/));
      return names.every(([ref]) => Number(ref) === post.ref) && new Set(names.map(([, position]) => position)).size === names.length;
    },
    { path: ["media"] },
  );
export type ImportedPost = z.infer<typeof ImportedPost>;

/** The counts a scan reports and the intake keeps: counts only, every reason from the closed lists. */
const scanCounts = {
  /** Lines written (the summary), or lines the preview offers (the intake: readable, not already imported, not over the new account's cap). */
  posts: Count.max(IMPORT_RULES.maxPosts),
  images: Count.max(IMPORT_RULES.maxImages),
  skipped: z.partialRecord(z.enum(IMPORT_SKIP_REASONS), Count),
  imagesSkipped: z.partialRecord(z.enum(IMPORT_IMAGE_SKIPS), Count),
  /** Characters removed by 5.3 step 5, and descriptions that became null. */
  cleaned: Count,
  /** Posts that begin with a content warning's line (Mastodon), and links to the source platform replaced by words (5.3 step 3b). */
  warnings: Count,
  sourceLinks: Count,
  /** X posts dated inside a protected period. */
  protectedPosts: Count,
  /** The scan stopped at maxItems (over_item_cap). */
  readInPart: z.boolean(),
};

/** summary.json, the importer's last write for a scan and its commit point (7.1 step 4). The API parses it as hostile input. */
export const ImportSummary = z.discriminatedUnion("status", [
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("scanned"), ...scanCounts }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), failure: ImportFailure }),
]);
export type ImportSummary = z.infer<typeof ImportSummary>;

/**
 * A month table: per month, one group per set of marks that occurs, as [marks, posts, images, imagesUndescribed]. In the
 * scan: the lines the preview offers, their images, and those of their images without a source's description. In the
 * picks' counts: [marks, posts left out, images with a source's description in posts left out, images given a
 * description by a pick in posts not left out], so the app's totals stay exact.
 */
const MonthTable = z.array(z.object({ month: Month, groups: z.array(z.tuple([Marks, Count, Count, Count])).max(2 ** IMPORT_MARKS.length) }));

/**
 * What the intake stores in import_jobs.scan (6.1, 7.5 step 2). `fromRef` is the lowest ref that may be published (a
 * new account's newest lines only); `samples` the three newest lines' refs and byte offsets; `pages` every pageLines-th
 * line's byte offset. The move out of ready keeps the counts and fromRef and empties the rest.
 */
export const ImportScanFacts = z.object({
  ...scanCounts,
  months: MonthTable,
  first: Month.nullable(),
  last: Month.nullable(),
  fromRef: Ref,
  samples: z.array(z.object({ ref: Ref, offset: Offset })).max(IMPORT_RULES.samples),
  pages: z.array(Offset).max(IMPORT_RULES.maxPages),
});
export type ImportScanFacts = z.infer<typeof ImportScanFacts>;

/** The person's choice (4.4): a range of months, inclusive, either end open when null; never `from` after `to`. */
export const ImportChoice = z
  .strictObject({
    from: Month.nullable(),
    to: Month.nullable(),
    replies: z.boolean(),
    warnings: z.boolean(),
    protected: z.boolean(),
    images: z.boolean(),
    long: z.enum(["leave", "shorten"]),
  })
  .refine((choice) => choice.from === null || choice.to === null || choice.from <= choice.to, { path: ["to"] });
export type ImportChoice = z.infer<typeof ImportChoice>;

/** One line of the preview's list (9.2), with the person's pick: `alts[i]` is the description written for media[i]. */
export const ImportLineView = z.object({
  ref: Ref,
  at: Day,
  kind: Kind,
  marks: Marks,
  text: z.string(),
  media: z.array(z.object({ file: ImportMediaFile, alt: z.string().nullable() })),
  leftOut: z.boolean(),
  alts: z.array(z.string().nullable()),
});
export type ImportLineView = z.infer<typeof ImportLineView>;

/** A pick (4.4): leave the line out or not, and a description for each image its source gave none, by position in media. */
export const ImportPickRequest = z.strictObject({ leftOut: z.boolean(), alts: z.array(AltText.nullable()).max(MEDIA_MAX_PER_POST) });
export type ImportPickRequest = z.infer<typeof ImportPickRequest>;

/** The pick as saved, and the picks' counts by month and marks. */
export const ImportPickView = z.object({ ref: Ref, leftOut: z.boolean(), alts: z.array(z.string().nullable()), picks: MonthTable });
export type ImportPickView = z.infer<typeof ImportPickView>;

export const CreateImportRequest = z.strictObject({ source: ImportSource, bytes: z.int().min(1).max(IMPORT_RULES.maxBytes) });
export type CreateImportRequest = z.infer<typeof CreateImportRequest>;

/** The statement (decision 14) is part of the request: without it there is nothing to confirm. */
export const ConfirmImportRequest = z.strictObject({ choice: ImportChoice, statement: z.literal(true) });
export type ConfirmImportRequest = z.infer<typeof ConfirmImportRequest>;

/**
 * An import as its owner sees it (9.3). No text but the samples (only in ready) and the refused post's first words, no
 * file name, no source id. `scan` holds the facts without their offsets; `endedByStaff` is the rule's id when an admin
 * ended it; `refusedAt` is the archive's day of the post whose image was refused.
 */
export const ImportView = z.object({
  id: z.uuid(),
  source: ImportSource,
  status: ImportStatus,
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  declaredBytes: z.int().min(1).max(IMPORT_RULES.maxBytes),
  receivedBytes: Count.max(IMPORT_RULES.maxBytes),
  chunkBytes: z.int().min(1),
  failure: ImportFailure.nullable(),
  stopReason: z.enum(IMPORT_STOP_REASONS).nullable(),
  endedByStaff: z.string().nullable(),
  scan: ImportScanFacts.omit({ samples: true, pages: true }).nullable(),
  samples: z.array(z.object({ at: Day, text: z.string() })).max(IMPORT_RULES.samples),
  choice: ImportChoice.nullable(),
  picks: MonthTable,
  progress: z.object({ imagesTotal: Count, imagesSettled: Count, postsTotal: Count, postsPublished: Count, postsRemoved: Count, postsLeft: Count }),
  paused: z.boolean(),
  refusalId: z.uuid().nullable(),
  refusedAt: Day.nullable(),
  refusedWords: z.string().nullable(),
  undoable: z.boolean(),
});
export type ImportView = z.infer<typeof ImportView>;

/** Every code the imports endpoints add to ErrorEnvelope.error.code; rate_limited, account_suspended and not_found are shared. */
export const ImportErrorCode = z.enum([
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
export type ImportErrorCode = z.infer<typeof ImportErrorCode>;
```

### Create `packages/import-protocol/package.json`

```json
{
  "name": "@korbat/import-protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "@korbat/contracts": "workspace:*", "zod": "4.6.5" },
  "devDependencies": { "@types/node": "24.13.5", "typescript": "7.0.2", "vitest": "4.1.11" }
}
```

### Create `packages/import-protocol/src/fixtures.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ImportSummary, ImportedPost } from "@korbat/contracts";
import { workLayout } from "./layout";
import { serializeLine } from "./lines";

const NEWLINE = String.fromCharCode(10);

/**
 * Stands in for the importer in the API's tests (3b design, section 12.1), as fakeWorker in
 * apps/api/test/integration/media-harness.ts stands in for the worker: writes one scan's output into the work volume at
 * `root`, for the import `summary.id`, exactly as the protocol says. Every file is written under tmp/ and renamed into
 * place, the images first, then posts.jsonl through the line serialiser, and summary.json last, the commit point.
 * `images` maps a media name to its bytes; a name the layout refuses throws before anything is written for it. A
 * string in `posts` is written as it is, then a line feed: a line the importer never writes, for tests of the intake's
 * caps and of unreadable lines. Nothing here reads or builds an archive.
 */
export function writeScanOutput(root: string, posts: readonly (ImportedPost | string)[], summary: ImportSummary, images: Readonly<Record<string, Uint8Array>> = {}): void {
  const work = workLayout(root);
  const { id } = summary;
  mkdirSync(work.tmp, { recursive: true });
  mkdirSync(work.mediaDir(id), { recursive: true });
  const place = (target: string, body: string | Uint8Array) => {
    const temporary = path.join(work.tmp, randomUUID());
    writeFileSync(temporary, body);
    renameSync(temporary, target);
  };
  for (const [file, bytes] of Object.entries(images)) place(work.media(id, file), bytes);
  place(work.posts(id), posts.map((line) => (typeof line === "string" ? line + NEWLINE : serializeLine(line))).join(""));
  place(work.summary(id), JSON.stringify(summary));
}
```

### Create `packages/import-protocol/src/index.ts`

```ts
/**
 * The contract between the API and the importer (3b design, section 7.1), which talk only through files on two volumes:
 * the API writes import-archives and the importer only reads it; the importer writes import-work and the API only reads
 * it, through openWorkFile, as hostile input. The shapes of what they exchange are packages/contracts' imports.ts.
 */
export * from "./limits";
export * from "./layout";
export * from "./open";
export * from "./summary";
export * from "./lines";
// The importer's stand-in for the API's tests (section 12.1).
export * from "./fixtures";
```

### Create `packages/import-protocol/src/layout.ts`

```ts
import path from "node:path";
import { ImportMediaFile, MEDIA_MAX_PER_POST } from "@korbat/contracts";

const IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_EXTENSIONS = ["jpg", "png", "webp"] as const;
export type ImportImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/** Ids are lowercase UUIDs made by the API (import_jobs.id). Nothing else may become part of a path. */
export function isImportId(value: string): boolean {
  return IMPORT_ID.test(value);
}

/** The only names the work folder's media/ may hold, by the contracts' ImportMediaFile. */
export function isImportMediaFile(value: string): boolean {
  return ImportMediaFile.safeParse(value).success;
}

function checked(id: string): string {
  if (!isImportId(id)) throw new Error("not an import id");
  return id;
}

function checkedFile(file: string): string {
  if (!isImportMediaFile(file)) throw new Error("not an import media file");
  return file;
}

/** The name the importer's core gives the image at `position` (from 0) of line `ref`. Throws for any other. */
export function mediaFileName(ref: number, position: number, extension: ImportImageExtension): string {
  if (!Number.isInteger(position) || position < 0 || position >= MEDIA_MAX_PER_POST || !IMAGE_EXTENSIONS.includes(extension)) throw new Error("not an import media file");
  return checkedFile(`${ref}-${position}.${extension}`);
}

/**
 * The archives volume, import-archives: the API writes it, the importer only reads it (3b design, section 7.1).
 *   jobs/<id>/archive.part   the archive while chunks arrive
 *   jobs/<id>/archive        the complete archive
 *   jobs/<id>/job.json       { v: 1, id, source, accountKey, images, createdAt }
 *   queue/<id>               the API's marker: this archive waits for a scan (oldest mtime first)
 *   delete/<id>              the API's request: delete the work folder of <id>, and stop scanning it
 */
export function archivesLayout(root: string) {
  const jobs = path.join(root, "jobs");
  const queue = path.join(root, "queue");
  const deletions = path.join(root, "delete");
  const jobDir = (id: string) => path.join(jobs, checked(id));
  return {
    root,
    jobs,
    queue,
    deletions,
    jobDir,
    part: (id: string) => path.join(jobDir(id), "archive.part"),
    archive: (id: string) => path.join(jobDir(id), "archive"),
    job: (id: string) => path.join(jobDir(id), "job.json"),
    queued: (id: string) => path.join(queue, checked(id)),
    deletion: (id: string) => path.join(deletions, checked(id)),
  };
}
export type ArchivesLayout = ReturnType<typeof archivesLayout>;

/**
 * The work volume, import-work: the importer writes it, the API only reads it, and every read goes through openWorkFile.
 *   jobs/<id>/scratch        the scan's scratch file, deleted when the scan ends
 *   jobs/<id>/posts.jsonl    one ImportedPost a line, in date order
 *   jobs/<id>/media/<file>   allowlisted images of kept posts, named <ref>-<position>.<jpg|png|webp>
 *   jobs/<id>/summary.json   the commit point, written last (ImportSummary)
 *   attempts/<id>            how often a scan of <id> started
 *   tmp/                     files being written; renamed into place
 *   heartbeat                rewritten every ten seconds
 */
export function workLayout(root: string) {
  const jobs = path.join(root, "jobs");
  const attempts = path.join(root, "attempts");
  const tmp = path.join(root, "tmp");
  const jobDir = (id: string) => path.join(jobs, checked(id));
  const mediaDir = (id: string) => path.join(jobDir(id), "media");
  return {
    root,
    jobs,
    attempts,
    tmp,
    heartbeat: path.join(root, "heartbeat"),
    jobDir,
    scratch: (id: string) => path.join(jobDir(id), "scratch"),
    posts: (id: string) => path.join(jobDir(id), "posts.jsonl"),
    mediaDir,
    media: (id: string, file: string) => path.join(mediaDir(id), checkedFile(file)),
    summary: (id: string) => path.join(jobDir(id), "summary.json"),
    attempt: (id: string) => path.join(attempts, checked(id)),
  };
}
export type WorkLayout = ReturnType<typeof workLayout>;
```

### Create `packages/import-protocol/src/limits.ts`

```ts
import { IMPORT_RULES } from "@korbat/contracts";

/**
 * The file protocol's caps (3b design, sections 7.1, 7.5 and 9.2), each read from the contracts' IMPORT_RULES, so every
 * number lives in one place. The API reads everything the importer wrote as hostile input, under these caps.
 */

/** job.json, which the API writes and the importer reads. */
export const JOB_FILE_MAX_BYTES = IMPORT_RULES.jobFileMaxBytes;
/** summary.json, the importer's commit point. */
export const SUMMARY_MAX_BYTES = IMPORT_RULES.summaryMaxBytes;
/** One line of posts.jsonl: 30,000 code points of four bytes, plus the JSON and the media (5.3 step 7). */
export const LINE_MAX_BYTES = IMPORT_RULES.lineMaxBytes;
/** posts.jsonl: one line for each kept post at most, and its bytes. */
export const POSTS_MAX_LINES = IMPORT_RULES.maxPosts;
export const POSTS_MAX_BYTES = IMPORT_RULES.postsFileMaxBytes;
/** One of the preview's samples, read from its offset (9.2). */
export const SAMPLE_MAX_BYTES = IMPORT_RULES.sampleMaxBytes;
/** How often the importer rewrites its heartbeat, and the age at which the API stops taking new imports (4.2 step 3). */
export const IMPORTER_HEARTBEAT_INTERVAL_MS = IMPORT_RULES.heartbeatMs;
export const IMPORTER_HEARTBEAT_STALE_MS = IMPORT_RULES.heartbeatStaleMs;
/** How often a scan of one archive may start: the third start fails it as interrupted, so a file that kills the importer cannot loop. */
export const SCAN_MAX_ATTEMPTS = IMPORT_RULES.maxAttempts;
```

### Create `packages/import-protocol/src/lines.ts`

```ts
import type { FileHandle } from "node:fs/promises";
import { ImportedPost } from "@korbat/contracts";
import { LINE_MAX_BYTES, POSTS_MAX_BYTES, POSTS_MAX_LINES, SAMPLE_MAX_BYTES } from "./limits";

/**
 * posts.jsonl (3b design, sections 5.1, 7.1 and 7.5): one ImportedPost a line, each ending in a line feed. The importer
 * writes it through serializeLine, as the API's tests do through writeScanOutput, so both write the same bytes; the API
 * reads it through readLines from a descriptor openWorkFile opened, and parses each line with parsePostLine.
 */

/** The line feed, the only byte that ends a line: JSON.stringify escapes every one inside a string. */
const LF = 10;
const NEWLINE = String.fromCharCode(LF);

/** How much of the file one read takes. */
const READ_CHUNK_BYTES = 65_536;

/**
 * The one serialiser of a line: the contract's members in the contract's order, whatever order the caller built them
 * in, as JSON on one line, then a line feed. It formats and does not check: the importer's core writes only lines that
 * pass ImportedPost, and skips the rest with their reason.
 */
export function serializeLine(post: ImportedPost): string {
  const { ref, key, at, kind, parent, text, media, protected: isProtected, warning } = post;
  return JSON.stringify({ ref, key, at, kind, parent, text, media: media.map(({ file, alt }) => ({ file, alt })), protected: isProtected, warning }) + NEWLINE;
}

/** One line's text as an ImportedPost, or null when it is not JSON or not the contract (the intake counts it unreadable). */
export function parsePostLine(text: string): ImportedPost | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ImportedPost.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface RawLine {
  /** The byte offset at which the line starts. */
  offset: number;
  /** The byte offset just past its line feed, where the next line starts (for a last line without one, the file's end). */
  next: number;
  /** The line without its line feed, or null when it was longer than the cap: then it was passed over unread. */
  text: string | null;
}

export interface LineOptions {
  /** Where to start: 0, or a line's offset the intake noted (a page, a sample). */
  from?: number;
  /** At most this many lines, over-long ones included. */
  maxLines?: number;
  /** Nothing at or past this byte of the file is read, and a line it cuts is not yielded. */
  maxBytes?: number;
  /** A line's cap in bytes, its line feed not counted. */
  lineMaxBytes?: number;
  /** Tests only: how much one read takes, to split lines across reads. */
  chunkBytes?: number;
}

/**
 * The bounded reader of posts.jsonl: each line from the offset with the offsets where it starts and where the next one
 * does, decoded as UTF-8. A line over its cap is reported as such (text null) and passed over to the next line feed
 * without being held, so the intake counts it unreadable (7.5 step 2) and goes on. It stops at the line cap and at the
 * byte cap; at the end of the file a last line without its line feed is still yielded, so nothing is passed over unseen.
 * Reads go only through the caller's descriptor; the caller closes it.
 */
export async function* readLines(handle: FileHandle, options: LineOptions = {}): AsyncGenerator<RawLine, void, undefined> {
  const maxLines = options.maxLines ?? POSTS_MAX_LINES;
  const maxBytes = options.maxBytes ?? POSTS_MAX_BYTES;
  const lineMax = options.lineMaxBytes ?? LINE_MAX_BYTES;
  const buffer = Buffer.alloc(options.chunkBytes ?? READ_CHUNK_BYTES);
  let position = options.from ?? 0;
  let start = position;
  let pieces: Buffer[] = [];
  let held = 0;
  let over = false;
  let count = 0;
  if (maxLines < 1) return;
  while (position < maxBytes) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes - position), position);
    if (bytesRead === 0) {
      if (held > 0 || over) yield { offset: start, next: position, text: over ? null : Buffer.concat(pieces).toString("utf8") };
      return;
    }
    const chunk = buffer.subarray(0, bytesRead);
    let from = 0;
    while (from < bytesRead) {
      const feed = chunk.indexOf(LF, from);
      const end = feed === -1 ? bytesRead : feed;
      if (!over) {
        // Held only while it fits: an over-long line costs its reading, never its memory.
        if (held + (end - from) > lineMax) {
          over = true;
          pieces = [];
          held = 0;
        } else if (end > from) {
          pieces.push(Buffer.from(chunk.subarray(from, end)));
          held += end - from;
        }
      }
      if (feed === -1) break;
      const next = position + feed + 1;
      yield { offset: start, next, text: over ? null : Buffer.concat(pieces).toString("utf8") };
      count += 1;
      if (count >= maxLines) return;
      start = next;
      pieces = [];
      held = 0;
      over = false;
      from = feed + 1;
    }
    position += bytesRead;
  }
}

/**
 * One line's text from its offset, as a sample of the preview is read (9.2): at most its cap, and never a byte past the
 * cap and its line feed, so an over-long line costs one bounded read. Null when there is no line there or it is too long.
 */
export async function readLineAt(handle: FileHandle, offset: number, lineMaxBytes: number = SAMPLE_MAX_BYTES): Promise<string | null> {
  for await (const line of readLines(handle, { from: offset, maxLines: 1, lineMaxBytes, maxBytes: offset + lineMaxBytes + 1 })) return line.text;
  return null;
}
```

### Create `packages/import-protocol/src/open.ts`

```ts
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * The API's one opener (3b design, section 7.1, "The API's one opener"). The importer parses hostile input, so the API
 * trusts nothing it wrote, not even a path: every file of import-work the API reads is opened here. Every component of
 * the path from the mount root down is looked at with lstat: each folder must be a real folder and the file a regular
 * file, none a symbolic link (a junction on Windows reports as one), all on the mount root's device. The file is then
 * opened without following a symlink where the platform can say so (O_NOFOLLOW; Windows cannot, and the checks above
 * still hold there) and without waiting (O_NONBLOCK: a FIFO swapped in would otherwise block a thread of the pool), and
 * the descriptor is checked again: a regular file with the device and inode the lstat saw, within the cap. The caller
 * reads only through that descriptor. So an importer taken over by a crafted archive cannot make the API read a file of
 * another volume, media-store's or /proc's.
 *
 * A refusal is returned as its code and never thrown: the package has no logger, and the API logs the job id and the
 * code (a refused file counts as missing_file). Device and inode are compared as bigints, which Windows' 64-bit file ids
 * need.
 */

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Why a file was not opened, in the order the checks run. */
export const WORK_FILE_REFUSALS = ["outside", "missing", "symlink", "not_a_file", "other_device", "too_large", "changed", "error"] as const;
export type WorkFileRefusal = (typeof WORK_FILE_REFUSALS)[number];

export interface WorkFile {
  handle: FileHandle;
  size: number;
}

export type WorkFileResult = { ok: true; file: WorkFile } | { ok: false; code: WorkFileRefusal };

export interface WorkFileOptions {
  /** Tests only: pretend the mount root lives on this device, as the media files' storeDevice does. */
  device?: number | bigint;
}

const refuse = (code: WorkFileRefusal): WorkFileResult => ({ ok: false, code });

/** An error of the file system as a refusal: nothing there, a symlink met by O_NOFOLLOW (ELOOP, or EMLINK on the BSDs), or anything else. */
function refusalOf(err: unknown): WorkFileRefusal {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return "missing";
  if (code === "ELOOP" || code === "EMLINK") return "symlink";
  return "error";
}

/**
 * Opens `file`, which must lie under `root` (the import-work mount, or for the importer its import-archives mount), for
 * reading. On success the caller owns the handle and closes it.
 */
export async function openWorkFile(root: string, file: string, maxBytes: number, options: WorkFileOptions = {}): Promise<WorkFileResult> {
  const relative = path.relative(root, file);
  if (relative === "") return refuse("not_a_file");
  const parts = relative.split(path.sep);
  // On Windows a path on another drive comes back absolute.
  if (path.isAbsolute(relative) || parts[0] === "..") return refuse("outside");

  let device: bigint;
  try {
    device = options.device === undefined ? (await stat(root, { bigint: true })).dev : BigInt(options.device);
  } catch (err) {
    return refuse(refusalOf(err));
  }

  // Every component from the root down, so that a symlinked folder anywhere on the path is refused, not only at its end.
  let at = root;
  let entry: BigIntStats | undefined;
  for (const [index, part] of parts.entries()) {
    at = path.join(at, part);
    try {
      entry = await lstat(at, { bigint: true });
    } catch (err) {
      return refuse(refusalOf(err));
    }
    if (entry.isSymbolicLink()) return refuse("symlink");
    const last = index === parts.length - 1;
    if (last ? !entry.isFile() : !entry.isDirectory()) return refuse("not_a_file");
    if (entry.dev !== device) return refuse("other_device");
  }
  if (!entry) return refuse("not_a_file");
  if (entry.size > BigInt(maxBytes)) return refuse("too_large");

  let handle: FileHandle;
  try {
    // The path just walked, normalised: in the caller's own spelling a ".." after a symlinked folder would be resolved
    // through the link by the system, to a file the walk never looked at.
    handle = await open(at, READ_FLAGS);
  } catch (err) {
    return refuse(refusalOf(err));
  }
  let code: WorkFileRefusal = "changed";
  try {
    // The descriptor must be the very file the lstat saw: a swap between the two is a file of someone else's choosing.
    const opened = await handle.stat({ bigint: true });
    if (opened.isFile() && opened.dev === entry.dev && opened.ino === entry.ino) {
      if (opened.size <= BigInt(maxBytes)) return { ok: true, file: { handle, size: Number(opened.size) } };
      code = "too_large";
    }
  } catch {
    code = "error";
  }
  await handle.close();
  return refuse(code);
}
```

### Create `packages/import-protocol/src/summary.ts`

```ts
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";
import { ImportSource, ImportSummary } from "@korbat/contracts";
import { archivesLayout, isImportId, workLayout } from "./layout";
import { JOB_FILE_MAX_BYTES, SUMMARY_MAX_BYTES } from "./limits";
import { openWorkFile, type WorkFileOptions, type WorkFileRefusal } from "./open";

/**
 * The protocol's small JSON files (3b design, section 7.1): job.json, which the API writes for the importer, and
 * summary.json and the heartbeat, which the importer writes for the API. Each is read under its cap through
 * openWorkFile and parsed strictly; a refusal is returned as its code, never thrown.
 */

/**
 * jobs/<id>/job.json on import-archives: what the importer needs to scan one archive. `accountKey` is the account's
 * import key (5.4, import_keys.key, 32 random bytes) as 64 lowercase hex, the one secret the importer holds; `images`
 * whether images are imported (IMPORT_IMAGES and the matcher, decision 15); `createdAt` the import's creation, from which
 * the core's date bound counts (5.4).
 */
export const JobFile = z.strictObject({
  v: z.literal(1),
  id: z.string().refine(isImportId, { message: "not an import id" }),
  source: ImportSource,
  accountKey: z.string().regex(/^[0-9a-f]{64}$/),
  images: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type JobFile = z.infer<typeof JobFile>;

/** The heartbeat file on import-work: when the importer last completed a tick, in epoch milliseconds (the Compose healthcheck reads `at`). */
export const ImporterHeartbeat = z.strictObject({ v: z.literal(1), at: z.int().min(0) });
export type ImporterHeartbeat = z.infer<typeof ImporterHeartbeat>;

/** Why a file was not read: openWorkFile's refusals, a file that is not JSON or not its schema, or one that names another import. */
export type ReadRefusal = WorkFileRefusal | "invalid" | "wrong_id";
export type ReadResult<T> = { ok: true; value: T } | { ok: false; code: ReadRefusal };

/** The whole file through its descriptor, or null when it holds more than `maxBytes` (it may have grown since it was opened). */
async function readWhole(handle: FileHandle, maxBytes: number): Promise<Buffer | null> {
  const buffer = Buffer.alloc(maxBytes + 1);
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled > maxBytes ? null : buffer.subarray(0, filled);
}

async function readJson<T>(root: string, file: string, maxBytes: number, schema: z.ZodType<T>, options: WorkFileOptions): Promise<ReadResult<T>> {
  const opened = await openWorkFile(root, file, maxBytes, options);
  if (!opened.ok) return { ok: false, code: opened.code };
  let bytes: Buffer | null;
  try {
    bytes = await readWhole(opened.file.handle, maxBytes);
  } catch {
    return { ok: false, code: "error" };
  } finally {
    await opened.file.handle.close();
  }
  if (bytes === null) return { ok: false, code: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "invalid" };
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "invalid" };
}

/** The importer's read of a job file, at most 4 KiB, from the import-archives mount at `root`. */
export async function readJobFile(root: string, id: string, options: WorkFileOptions = {}): Promise<ReadResult<JobFile>> {
  const read = await readJson(root, archivesLayout(root).job(id), JOB_FILE_MAX_BYTES, JobFile, options);
  return read.ok && read.value.id !== id ? { ok: false, code: "wrong_id" } : read;
}

/**
 * The API's read of a scan's summary, at most 64 KiB, from the import-work mount at `root`, parsed with the contracts'
 * ImportSummary. A summary that names another import is refused: an importer taken over by one archive must not be able
 * to settle another person's scan.
 */
export async function readSummary(root: string, id: string, options: WorkFileOptions = {}): Promise<ReadResult<ImportSummary>> {
  const read = await readJson(root, workLayout(root).summary(id), SUMMARY_MAX_BYTES, ImportSummary, options);
  return read.ok && read.value.id !== id ? { ok: false, code: "wrong_id" } : read;
}

/** The API's read of the importer's heartbeat, under the job file's cap of 4 KiB (a heartbeat is a few dozen bytes). */
export async function readHeartbeat(root: string, options: WorkFileOptions = {}): Promise<ReadResult<ImporterHeartbeat>> {
  return readJson(root, workLayout(root).heartbeat, JOB_FILE_MAX_BYTES, ImporterHeartbeat, options);
}
```

### Create `packages/import-protocol/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./account";
export * from "./auth";
// 3d Task 6: the automated decision's numbers and closed lists. It imports nothing, so every module below can read it.
export * from "./automation";
export * from "./explore";
// 3b Task 1: the import's contracts and numbers. It imports only ./media and ./text, so the modules that name ImportSource
// (social.ts, moderation.ts, staff.ts, account.ts) can read it while they load.
export * from "./imports";
export * from "./media";
// Evaluated before ./staff, and importing nothing from it: staff.ts can read this module's constants while it loads.
export * from "./moderation";
// 3f: imports nothing from the other modules, so moderation.ts can read its constants while it loads.
export * from "./orders";
export * from "./passkeys";
export * from "./social";
export * from "./staff";
export * from "./text";
// 3d Task 4: the public figures. It reads moderation.ts and orders.ts for closed lists, and nothing reads it.
export * from "./transparency";
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { HiddenMedia, MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";
import { RULE_IDS } from "./moderation";
import { FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizePostBody, postLength, visibleLength } from "./text";

/**
 * Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited).
 * explore_refreshed (409) refuses a page of an Explore ranking that is no longer kept. account_suspended (403, 3e design,
 * section 10.5) refuses a write of an account while a suspension or termination of it runs; the media, auth and
 * moderation modules answer it too, as a code they share with this one.
 */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed", "account_suspended"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

// 3b Task 1: postLength, normalizePostBody and FORBIDDEN_CONTROL live in ./text, so that imports.ts can read the body rules
// without loading this module, which reads moderation.ts at load.

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order, each as the image or, where the reader is not shown it, as a hidden image in its place. Always present, often empty. */
  media: z.array(z.union([MediaView, HiddenMedia])),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

/**
 * The decision behind the state of the viewer's own withheld or removed post (3c design, sections 5 and 7.6): the decision
 * of the strongest post measure in force, by its id, the rule it cites (null for a decision on the law), whether it rests
 * on the law, and whether korbat is still deciding. The app shows it as the chip that links to the statement. `strikeUntil`
 * (3e design, section 10.2) is the end of counting of the strike the post's decision gave, while that strike stands and
 * still counts; null otherwise.
 */
// 3f: `order` is true when the chip's decision gives effect to an authority's order (a DSA Article 9 order that does not
// withhold, the only order that leaves a post its author sees), so the chip reads [chip.order]; absent otherwise.
export const PostModeration = z.object({ decisionId: z.uuid(), ruleId: z.enum(RULE_IDS).nullable(), legal: z.boolean(), interim: z.boolean(), strikeUntil: z.iso.datetime().nullable(), order: z.boolean().optional() });
export type PostModeration = z.infer<typeof PostModeration>;

export const PostView = z.object({
  ...postFields,
  /**
   * The author's "In Explore" chip (2c design, section 8): present, and true, only on the viewer's own post while it is in
   * the current Explore ranking with their switch on. Nobody else's view carries it, nor does a quoted embed. It sits here
   * rather than in `viewer`, which the like, repost and bookmark answers replace.
   */
  inExplore: z.literal(true).optional(),
  /** Present only on the viewer's own post while moderation withholds or removed it; nobody else's view carries it, nor does a quoted embed. */
  moderation: PostModeration.optional(),
  quoteOf: z.union([QuotedPost, Tombstone]).nullable(),
});
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
```

### Replace `packages/contracts/src/text.ts` (whole file)

```ts
/**
 * Bidirectional overrides and isolates, the zero-width space, the word joiner and the byte order mark:
 * invisible, and used to disguise text or hide from a search. Joiners that scripts and emoji need
 * (U+200C, U+200D) stay allowed.
 */
export const FORBIDDEN_FORMAT = /[\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF]/u;

/** The characters a reader can see: format characters (joiners, direction marks) do not count. */
export function visibleLength(text: string): number {
  return Array.from(text.replace(/\p{Cf}/gu, "")).length;
}

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. The rule of every post body, native or imported. */
export const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;
```

## Step 4: verify: install

```bash
pnpm install --config.package-import-method=copy
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 13.7s using pnpm v10.30.0
```

## Step 5: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 8.3s using pnpm v10.30.0
```

## Step 6: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 7: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: test

```bash
pnpm -r --if-present run test --testTimeout=60000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  493 passed (493)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
packages/import-protocol test:       Tests  35 passed | 2 skipped (37)
apps/admin test:       Tests  594 passed (594)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  639 passed (639)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 9: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `packages/contracts/src/imports.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/src/text.ts`
- `packages/contracts/test/imports.test.ts`
- `packages/import-protocol/package.json`
- `packages/import-protocol/src/fixtures.ts`
- `packages/import-protocol/src/index.ts`
- `packages/import-protocol/src/layout.ts`
- `packages/import-protocol/src/limits.ts`
- `packages/import-protocol/src/lines.ts`
- `packages/import-protocol/src/open.ts`
- `packages/import-protocol/src/summary.ts`
- `packages/import-protocol/test/layout.test.ts`
- `packages/import-protocol/test/open.test.ts`
- `packages/import-protocol/test/readers.test.ts`
- `packages/import-protocol/tsconfig.json`
- `pnpm-lock.yaml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(contracts,import-protocol): the import's contracts and file protocol: contracts/src/imports.ts holds ImportedPost as 5.1 gives it (a thread line exactly when it has a parent below its ref, visible text or an image, each image <ref>-<position>.<jpg|png|webp> named for its own line, positions from 0 and each once), ImportedText at 30,000 code points, ImportSummary's two shapes, ImportScanFacts with its month table of [marks, posts, images, imagesUndescribed], ImportChoice, the requests and views, the closed lists in the design's order, IMPORT_MARKS and IMPORT_RULES with every number of the design (import_picks.alts at 16,384 bytes); postLength, normalizePostBody and FORBIDDEN_CONTROL move to text.ts so imports.ts reads only ./media and ./text; packages/import-protocol lays out import-archives and import-work by checked ids and names, reads job.json, summary.json, the heartbeat and posts.jsonl under their caps, writes a line one way, opens every work file through openWorkFile (each component lstat'ed, no symlink or junction, the mount's device, O_NOFOLLOW, the descriptor's device and inode), and writeScanOutput stands in for the importer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(contracts,import-protocol): the import's contracts and file protocol: contracts/src/imports.ts holds ImportedPost as 5.1 gives it (a thread line exactly when it has a parent below its ref, visible text or an image, each image <ref>-<position>.<jpg|png|webp> named for its own line, positions from 0 and each once), ImportedText at 30,000 code points, ImportSummary's two shapes, ImportScanFacts with its month table of [marks, posts, images, imagesUndescribed], ImportChoice, the requests and views, the closed lists in the design's order, IMPORT_MARKS and IMPORT_RULES with every number of the design (import_picks.alts at 16,384 bytes); postLength, normalizePostBody and FORBIDDEN_CONTROL move to text.ts so imports.ts reads only ./media and ./text; packages/import-protocol lays out import-archives and import-work by checked ids and names, reads job.json, summary.json, the heartbeat and posts.jsonl under their caps, writes a line one way, opens every work file through openWorkFile (each component lstat'ed, no symlink or junction, the mount's device, O_NOFOLLOW, the descriptor's device and inode), and writeScanOutput stands in for the importer`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 17>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
