# korbat import from other platforms (3b) — Task 3 of 8: The importer: apps/importer, a service with no network that reads an X or Mastodon zip with korbat's own zip reader and streaming JSON assembler or a Bluesky CAR in two passes, keeps the person's own public posts through the three adapters and the common core, and writes posts.jsonl, the images of kept posts and summary.json into import-work (sections 5, 7.1 and 7.2), with its fixtures, unit tests and labs (12.1, 12.2, 12.5).

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-22 to 2026-10-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 3 of sub-project 3b (import from other platforms) opens batch 2 (Tasks 3 and 4) of docs/superpowers/specs/2026-10-22-import-3b-design.md, section 13: it builds sections 5 (formats and adapters), 7.1 (the importer) and 7.2 (the zip reader) on Task 1's contracts and file protocol (packages/contracts/src/imports.ts, packages/import-protocol), with 12.1's fixtures, 12.2's apps/importer tests and 12.5's labs. Task 4 puts the importer into Compose with its two volumes and builds the API's side of the protocol (upload, intake, import-drive) on the files this task writes; nothing of apps/api or the database changes here.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(db): the import's database: 0043_imports creates import_source and import_status whole and import_jobs, import_picks and import_keys under CHECKs that write out IMPORT_RULES and the closed lists, with row level security, 6.4's grants, import_jobs_insert forcing a new import's columns, import_jobs_guard walking 4.1's eighteen arrows (each time set once by its move, the scan cut down on leaving ready, the seed cleared at the end, the counts only growing), picks only while ready and the delete rules of a job and a key; 0044_imported_posts adds posts' five import columns, all or none, set only at insert by a publishing import of the author (posts_import_guard, before insert or update of the five: no quote, a reply only within its job, dated from 2006-03-21 to a day after the job) and cleared only with a tombstone, post_media's imported and import_job_id with post_media_import_link and an index on the job, the two image triggers, and decision_actions_check as 0032's text with imported posts out of the flood count; 0045_import_readers adds posts_imported_idx and posts_author_native_idx and leaves imports out of posts_latest_idx`.

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
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/03-importer.md 1
```

Expected: 26 lines starting with `wrote`, one for each file below.

### Create `apps/importer/test/bluesky.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../src/adapters/types";
import { blueskyAdapter } from "../src/adapters/bluesky/index";
import { openCar, type CarLimits } from "../src/car/reader";
import { SOURCE_WORDS } from "../src/text";
import { BLUESKY_POSTS, buildBlueskyArchive, type BlueskyOptions } from "./fixtures/bluesky";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { noise } from "./fixtures/zip";

/** The Bluesky adapter and the CAR reader: every row of 5.7's table, the two passes, each block checked against its CID. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = async (options: BlueskyOptions = {}, images = false) => runScan(ws.dir, { source: "bluesky", archive: await buildBlueskyArchive(options), images });

describe("reading a Bluesky repository", async () => {
  const result = await scan();
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ adult_label: 2, date_out_of_range: 1 });
    expect(summary.imagesSkipped).toEqual({ bluesky_no_files: 4 });
    expect(summary).toMatchObject({ posts: 11, images: 0, sourceLinks: 3, warnings: 0, protectedPosts: 0, readInPart: false });
  });

  test("a post, a thread under it, and a reply to someone else", () => {
    const plain = lineWith(lines, "Hello from Bluesky");
    expect(plain).toMatchObject({ kind: "post", at: "2023-04-01T10:00:00Z", media: [] });
    expect(lineWith(lines, "Continuing my own thread")).toMatchObject({ kind: "thread", parent: plain.ref });
    expect(lineWith(lines, "Answering someone else")).toMatchObject({ kind: "reply", parent: null });
  });

  test("quotes keep their text, a link card is dropped, image and video embeds are counted, graphic-media is kept", () => {
    lineWith(lines, "Quoting a post");
    lineWith(lines, "Quote with a picture");
    expect(lineWith(lines, "A link card").text).toBe(BLUESKY_POSTS.card.text);
    lineWith(lines, "Two pictures");
    lineWith(lines, "A video");
    lineWith(lines, "graphic but allowed");
    expect(lines.some((line) => line.text.startsWith("Labelled") || line.text.startsWith("Also labelled"))).toBe(false);
  });

  test("bsky.app links and at:// URIs become fixed words", () => {
    expect(lineWith(lines, "My profile").text).toBe(`My profile ${SOURCE_WORDS.bluesky.profile} and a post ${SOURCE_WORDS.bluesky.post} and ${SOURCE_WORDS.bluesky.post}`);
  });

  test("createdAt with an offset is converted to UTC and cut to the second", () => {
    expect(lineWith(lines, "Dated with an offset").at).toBe("2023-04-11T08:00:00Z");
  });

  test("images on changes nothing: the export holds no files", async () => {
    const on = scanned(await scan({}, true));
    expect(on.imagesSkipped).toEqual({ bluesky_no_files: 4 });
    expect(on.images).toBe(0);
  });
});

describe("blocks are checked against their CIDs", () => {
  test("a post whose bytes do not match its CID is unreadable; the rest are read", async () => {
    const summary = scanned(await scan({ corruptPost: BLUESKY_POSTS.quote.rkey }));
    expect(summary.skipped).toEqual({ adult_label: 2, date_out_of_range: 1, unreadable: 1 });
    expect(summary.posts).toBe(10);
  });

  test("a commit whose bytes do not match, or an MST root missing from the file, makes the archive unreadable", async () => {
    expect((await scan({ corruptCommit: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
    expect((await scan({ dropMstRoot: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("a block over 1,000,000 bytes refuses the archive", async () => {
    expect(IMPORT_RULES.carBlockMaxBytes).toBe(1_000_000);
    expect((await scan({ bigBlock: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("a deeper MST (fanout 2) and a flat one read the same posts", async () => {
    const deep = scanned(await scan({ fanout: 2 }));
    const flat = scanned(await scan({ fanout: 64 }));
    expect(deep.posts).toBe(11);
    expect(flat.posts).toBe(11);
  });
});

describe("detect and the failures", () => {
  test("two roots, or a commit that is not version 3, is not_this_source", async () => {
    expect((await scan({ twoRoots: true })).summary).toMatchObject({ failure: "not_this_source" });
    expect((await scan({ commitVersion: 2 })).summary).toMatchObject({ failure: "not_this_source" });
  });

  test("a zip, a gzip and anything else", async () => {
    const run = async (archive: Buffer) => (await runScan(ws.dir, { source: "bluesky", archive })).summary;
    expect(await run(buildMastodonArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await run(gzipSync(Buffer.from("tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await run(Buffer.from('{"chat": "a chat.jsonl line"}' + String.fromCharCode(10)))).toMatchObject({ failure: "not_an_archive" });
    expect(await run(noise(10))).toMatchObject({ failure: "not_an_archive" });
  });

  test("detect takes the one pseudo-entry", () => {
    expect(blueskyAdapter.detect([{ name: "repo.car", size: 100 }])).toBeNull();
    expect(blueskyAdapter.allowlist).toEqual([]);
  });

  test("more than carMaxBlocks blocks is too_many_entries", async () => {
    const bytes = await buildBlueskyArchive();
    const file = path.join(ws.dir, randomUUID());
    writeFileSync(file, bytes);
    const handle = await open(file, "r");
    const attempt = async (limits: Partial<CarLimits>) => {
      try {
        await openCar(handle, bytes.length, { limits });
        return "ok";
      } catch (err) {
        return err instanceof ScanFailure ? err.code : String(err);
      }
    };
    try {
      expect(IMPORT_RULES.carMaxBlocks).toBe(2_000_000);
      expect(await attempt({ maxBlocks: 5 })).toBe("too_many_entries");
      expect(await attempt({})).toBe("ok");
    } finally {
      await handle.close();
    }
  });
});
```

### Create `apps/importer/test/core.test.ts`

```ts
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import type { AdapterItem, DraftPost } from "../src/adapters/types";
import { ScanCore, importKey, type CoreOptions } from "../src/core";
import { ACCOUNT_KEY, CREATED_AT, OTHER_ACCOUNT_KEY } from "./fixtures/canaries";
import { capturingLogger, readOutput, volumes, workspace } from "./fixtures/harness";
import { fakeImage } from "./fixtures/zip";

/** The importer's core (5.4): keys, refs, threads, dates, the caps and the images, the same for every source. */

const ws = workspace();
afterAll(() => ws.remove());

const DAY = 86_400_000;
const T0 = Date.parse("2019-01-01T00:00:00Z");

function draft(sourceId: string, at: number, overrides: Partial<DraftPost> = {}): DraftPost {
  return { sourceId, parentId: null, kind: "post", at, text: `Post ${sourceId}`, cleaned: 0, sourceLinks: 0, protected: false, warning: false, images: [], imageSkips: [], ...overrides };
}

async function runCore(items: AdapterItem[], options: Partial<CoreOptions> = {}) {
  const { work } = volumes(ws.dir);
  const id = randomUUID();
  mkdirSync(work.jobDir(id), { recursive: true });
  const { log, lines: logs } = capturingLogger();
  const core = new ScanCore({
    id,
    work,
    source: "x",
    accountKey: Buffer.from(ACCOUNT_KEY, "hex"),
    createdAt: new Date(CREATED_AT),
    images: false,
    log,
    signal: new AbortController().signal,
    ...options,
  });
  await core.open();
  for (const item of items) await core.add(item);
  const counts = await core.finish();
  const scratchPath = work.scratch(id);
  await core.close();
  return { counts, ...readOutput(work, id), logs, scratchGone: !existsSync(scratchPath), work, id };
}

describe("keys", () => {
  test("HMAC-SHA256 of source:id under the account's key: stable per account, different between accounts", () => {
    const key = Buffer.from(ACCOUNT_KEY, "hex");
    const expected = createHmac("sha256", key).update("x:1100000000000000001").digest("hex");
    expect(importKey(key, "x", "1100000000000000001")).toBe(expected);
    expect(importKey(key, "x", "1100000000000000001")).toBe(expected);
    expect(importKey(Buffer.from(OTHER_ACCOUNT_KEY, "hex"), "x", "1100000000000000001")).not.toBe(expected);
    expect(importKey(key, "mastodon", "1100000000000000001")).not.toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("refs and threads", () => {
  test("lines are numbered from 0 in date order, whatever order they came in, ties by key; dates are cut to whole seconds", async () => {
    const { lines, counts } = await runCore([
      { kept: draft("c", T0 + 3 * DAY) },
      { kept: draft("a", T0 + DAY + 999) },
      { kept: draft("b", T0 + 2 * DAY) },
      { kept: draft("tie1", T0 + 5 * DAY) },
      { kept: draft("tie2", T0 + 5 * DAY) },
    ]);
    expect(lines.map((line) => line.ref)).toEqual([0, 1, 2, 3, 4]);
    expect(lines.slice(0, 3).map((line) => line.text)).toEqual(["Post a", "Post b", "Post c"]);
    expect(lines[0]!.at).toBe("2019-01-02T00:00:00Z");
    const tieKeys = lines.slice(3).map((line) => line.key);
    expect(tieKeys).toEqual([...tieKeys].sort());
    expect(counts.posts).toBe(5);
  });

  test("a thread keeps its parent's ref only when the parent is kept and earlier; otherwise it becomes a post", async () => {
    const { lines } = await runCore([
      { kept: draft("root", T0) },
      { kept: draft("child", T0 + DAY, { kind: "thread", parentId: "root" }) },
      { kept: draft("orphan", T0 + 2 * DAY, { kind: "thread", parentId: "never-kept" }) },
      { kept: draft("early", T0 + 3 * DAY, { kind: "thread", parentId: "late" }) },
      { kept: draft("late", T0 + 4 * DAY) },
      { kept: draft("same", T0 + 4 * DAY, { kind: "thread", parentId: "late" }) },
      { kept: draft("reply", T0 + 5 * DAY, { kind: "reply", parentId: "someone-else" }) },
    ]);
    const byText = (id: string) => lines.find((line) => line.text === `Post ${id}`)!;
    expect(byText("child")).toMatchObject({ kind: "thread", parent: byText("root").ref });
    expect(byText("orphan")).toMatchObject({ kind: "post", parent: null });
    expect(byText("early")).toMatchObject({ kind: "post", parent: null });
    // Same second as its parent: it is a thread only if it sorts after the parent (by key).
    const same = byText("same");
    expect(same.kind === "thread" ? same.parent! < same.ref : same.parent === null).toBe(true);
    expect(byText("reply")).toMatchObject({ kind: "reply", parent: null });
  });

  test("two items with one key (the same source id twice) are written once; the second is unreadable", async () => {
    const { lines, counts } = await runCore([{ kept: draft("dup", T0) }, { kept: draft("dup", T0) }, { kept: draft("other", T0) }]);
    expect(lines).toHaveLength(2);
    expect(counts.skipped.unreadable).toBe(1);
  });
});

describe("dates, lengths and empty posts", () => {
  test("before 2006-03-21 or more than one day after the import was created is date_out_of_range", async () => {
    const created = Date.parse(CREATED_AT);
    const { lines, counts } = await runCore([
      { kept: draft("first-day", Date.parse(`${IMPORT_RULES.earliestDate}T00:00:00Z`)) },
      { kept: draft("before", Date.parse(`${IMPORT_RULES.earliestDate}T00:00:00Z`) - 1_000) },
      { kept: draft("edge", created + IMPORT_RULES.futureDays * DAY) },
      { kept: draft("after", created + IMPORT_RULES.futureDays * DAY + 1_000) },
      { kept: draft("nan", Number.NaN) },
    ]);
    expect(lines.map((line) => line.text)).toEqual(["Post first-day", "Post edge"]);
    expect(counts.skipped.date_out_of_range).toBe(3);
  });

  test("over 30,000 code points is too_long_to_read; 30,000 is kept; no visible text and no image is empty", async () => {
    const astral = String.fromCodePoint(0x1f600);
    const { lines, counts } = await runCore([
      { kept: draft("max", T0, { text: astral.repeat(IMPORT_RULES.textMax) }) },
      { kept: draft("over", T0 + 1_000, { text: "a".repeat(IMPORT_RULES.textMax + 1) }) },
      { kept: draft("blank", T0 + 2_000, { text: String.fromCharCode(0x200d) }) },
      { kept: draft("nothing", T0 + 3_000, { text: "" }) },
    ]);
    expect(lines).toHaveLength(1);
    expect(Array.from(lines[0]!.text)).toHaveLength(IMPORT_RULES.textMax);
    expect(counts.skipped).toEqual({ too_long_to_read: 1, empty: 2 });
  });
});

describe("the caps", () => {
  test("the newest 50,000 posts are kept and the rest counted over_post_cap", { timeout: 300_000 }, async () => {
    const total = IMPORT_RULES.maxPosts + 3;
    const items: AdapterItem[] = [];
    // In an order that is neither ascending nor descending, so the heap has to work.
    for (let i = 0; i < total; i++) {
      const n = (i * 7_919) % total;
      items.push({ kept: draft(`n${n}`, T0 + n * 1_000, { text: `p${n}` }) });
    }
    const { lines, counts } = await runCore(items);
    expect(lines).toHaveLength(IMPORT_RULES.maxPosts);
    expect(counts.skipped.over_post_cap).toBe(3);
    expect(lines[0]!.text).toBe("p3");
    expect(lines.at(-1)!.text).toBe(`p${total - 1}`);
    expect(lines.at(-1)!.ref).toBe(IMPORT_RULES.maxPosts - 1);
  });

  test("an adapter's over_item_cap marks the scan read in part, counted once", async () => {
    const { counts } = await runCore([{ kept: draft("a", T0) }, { skipped: "over_item_cap" }]);
    expect(counts.readInPart).toBe(true);
    expect(counts.skipped.over_item_cap).toBe(1);
    expect(counts.posts).toBe(1);
  });

  test("the context's item budget is maxItems", async () => {
    const { work } = volumes(ws.dir);
    const id = randomUUID();
    mkdirSync(work.jobDir(id), { recursive: true });
    const core = new ScanCore({ id, work, source: "x", accountKey: Buffer.from(ACCOUNT_KEY, "hex"), createdAt: new Date(CREATED_AT), images: false, log: capturingLogger().log, signal: new AbortController().signal, limits: { maxItems: 3 } });
    await core.open();
    expect([core.context.takeItem(), core.context.takeItem(), core.context.takeItem(), core.context.takeItem()]).toEqual([true, true, true, false]);
    await core.close();
  });

  test("skips are counted by reason, and the counts of written posts only: images, warnings, protected, source links, cleaned", async () => {
    const { counts } = await runCore([
      { skipped: "repost" },
      { skipped: "repost" },
      { skipped: "not_public" },
      { kept: draft("w", T0, { warning: true, cleaned: 2, sourceLinks: 3, imageSkips: ["video"], images: [{ entry: null, alt: null }] }) },
      { kept: draft("p", T0 + 1_000, { protected: true }) },
      { kept: draft("gone", Date.parse("2001-01-01T00:00:00Z"), { warning: true, sourceLinks: 1, imageSkips: ["video"] }) },
    ]);
    expect(counts.skipped).toEqual({ repost: 2, not_public: 1, date_out_of_range: 1 });
    expect(counts).toMatchObject({ posts: 2, warnings: 1, protectedPosts: 1, sourceLinks: 3, cleaned: 1, readInPart: false });
    expect(counts.imagesSkipped).toEqual({ video: 1, images_off: 1 });
  });
});

describe("images", () => {
  function imageArchive(files: Record<string, Buffer>) {
    return {
      size: (name: string) => files[name]?.length,
      open: async function* (name: string) {
        yield files[name]!;
      },
    };
  }

  test("only images of kept posts are written, named <ref>-<position>.<ext> by their bytes; the rest are counted", async () => {
    const files = { "m/a.jpg": fakeImage("jpg", 300, 1), "m/b.png": fakeImage("png", 300, 2), "m/c.jpg": fakeImage("webp", 300, 3), "m/d.jpg": fakeImage("gif", 300, 4) };
    const { lines, media, counts } = await runCore(
      [
        { kept: draft("one", T0, { images: [{ entry: "m/a.jpg", alt: "first" }, { entry: "m/missing.jpg", alt: null }, { entry: "m/b.png", alt: null }] }) },
        { kept: draft("two", T0 + 1_000, { images: [{ entry: "m/c.jpg", alt: null }, { entry: "m/d.jpg", alt: "a gif" }] }) },
        { kept: draft("old", Date.parse("2001-01-01T00:00:00Z"), { images: [{ entry: "m/a.jpg", alt: null }] }) },
      ],
      { images: true, archive: imageArchive(files) },
    );
    expect(lines[0]!.media).toEqual([
      { file: "0-0.jpg", alt: "first" },
      { file: "0-1.png", alt: null },
    ]);
    expect(lines[1]!.media).toEqual([{ file: "1-0.webp", alt: null }]);
    expect([...media.keys()].sort()).toEqual(["0-0.jpg", "0-1.png", "1-0.webp"]);
    expect(media.get("0-0.jpg")).toEqual(files["m/a.jpg"]);
    expect(counts.images).toBe(3);
    expect(counts.imagesSkipped).toEqual({ missing_file: 1, unsupported: 1 });
  });

  test("an image over 20 MiB is too_large and never opened", async () => {
    let opened = 0;
    const archive = {
      size: () => IMPORT_RULES.maxBytes,
      open: async function* () {
        opened++;
        yield Buffer.alloc(0);
      },
    };
    const { counts, lines } = await runCore([{ kept: draft("big", T0, { images: [{ entry: "m/big.jpg", alt: null }] }) }], { images: true, archive });
    expect(counts.imagesSkipped).toEqual({ too_large: 1 });
    expect(lines[0]!.media).toEqual([]);
    expect(opened).toBe(0);
  });

  test("at most maxImages are kept, the newest posts' first; the rest counted over_image_cap; at most four a post", async () => {
    const files = Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [`m/${n}.jpg`, fakeImage("jpg", 100, n + 1)]));
    const five = [0, 1, 2, 3, 4].map((n) => ({ entry: `m/${n}.jpg`, alt: null }));
    const { lines, counts } = await runCore(
      [
        { kept: draft("older", T0, { images: [{ entry: "m/5.jpg", alt: null }] }) },
        { kept: draft("newer", T0 + 1_000, { images: five }) },
      ],
      { images: true, archive: imageArchive(files), limits: { maxImages: 3 } },
    );
    expect(lines.find((line) => line.text === "Post newer")!.media.map((m) => m.file)).toEqual(["1-0.jpg", "1-1.jpg", "1-2.jpg"]);
    expect(lines.find((line) => line.text === "Post older")!.media).toEqual([]);
    expect(counts.imagesSkipped).toEqual({ over_image_cap: 3 });
    expect(counts.images).toBe(3);
  });

  test("with images off, every image of a kept post counts images_off and no line carries media", async () => {
    const { lines, counts, media } = await runCore([{ kept: draft("a", T0, { images: [{ entry: "m/a.jpg", alt: "x" }, { entry: null, alt: null }], imageSkips: ["sensitive"] }) }]);
    expect(lines[0]!.media).toEqual([]);
    expect(media.size).toBe(0);
    expect(counts.imagesSkipped).toEqual({ images_off: 2, sensitive: 1 });
  });

  test("an image-only post whose image cannot be written is empty", async () => {
    const files = { "m/x.jpg": fakeImage("gif", 100, 9) };
    const { lines, counts } = await runCore([{ kept: draft("only", T0, { text: "", images: [{ entry: "m/x.jpg", alt: null }] }) }], { images: true, archive: imageArchive(files) });
    expect(lines).toEqual([]);
    expect(counts.skipped).toEqual({ empty: 1 });
  });
});

describe("files", () => {
  test("the scratch file holds texts while the scan runs and is deleted at the end; tmp/ is left empty", async () => {
    const { work, id, scratchGone } = await runCore([{ kept: draft("a", T0) }]);
    expect(scratchGone).toBe(true);
    expect(readdirSync(work.tmp)).toEqual([]);
    expect(existsSync(work.posts(id))).toBe(true);
  });

  test("an aborted signal stops the core between items", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runCore([{ kept: draft("a", T0) }], { signal: controller.signal })).rejects.toThrow();
  });

  test("a stash keeps a text in the scratch file and gives it back", async () => {
    const { work } = volumes(ws.dir);
    const id = randomUUID();
    mkdirSync(work.jobDir(id), { recursive: true });
    writeFileSync(path.join(work.jobDir(id), "unrelated"), "");
    const core = new ScanCore({ id, work, source: "x", accountKey: Buffer.from(ACCOUNT_KEY, "hex"), createdAt: new Date(CREATED_AT), images: false, log: capturingLogger().log, signal: new AbortController().signal });
    await core.open();
    const snowman = String.fromCodePoint(0x2603);
    const first = await core.context.stash(`first ${snowman}`);
    const second = await core.context.stash("second");
    expect(await core.context.recall(second)).toBe("second");
    expect(await core.context.recall(first)).toBe(`first ${snowman}`);
    await core.close();
  });
});
```

### Create `apps/importer/test/fixtures/bluesky.ts`

```ts
import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car/writer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { CANARY, FIXTURE_DID } from "./canaries";

/**
 * A Bluesky repository export built by code (3b design, section 12.1): a CAR written with @ipld/car's writer and
 * @ipld/dag-cbor, a commit, a two-level MST whose keys are prefix-compressed as atproto's repository spec writes them,
 * posts covering 5.7's table, a post linking the fixture's own profile, like and follow records holding canaries, the
 * blocks in a shuffled order, an extra block outside the tree, and switches for a block whose bytes do not match its
 * CID and for a block of 1,000,001 bytes.
 */

const SHA256 = 0x12;
const RAW = 0x55;

export interface Block {
  cid: CID;
  bytes: Uint8Array;
}

/** A DAG-CBOR block and its CID (CIDv1, sha2-256), hashed with node:crypto as the reader checks it. */
export function cborBlock(value: unknown): Block {
  const bytes = dagCbor.encode(value);
  const digest = Digest.create(SHA256, createHash("sha256").update(bytes).digest());
  return { cid: CID.create(1, dagCbor.code, digest), bytes };
}

function rawBlock(bytes: Uint8Array): Block {
  const digest = Digest.create(SHA256, createHash("sha256").update(bytes).digest());
  return { cid: CID.create(1, RAW, digest), bytes };
}

const encoder = new TextEncoder();

/** Shared prefix length of two byte strings. */
function shared(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export interface Leaf {
  key: string;
  cid: CID;
}

/**
 * An MST over sorted leaves: a node holds up to `fanout` entries; when there are more, every (fanout+1)-th key is lifted
 * into the node and the runs between them become its subtrees (`l` before the first, each entry's `t` after it). Keys
 * within a node are prefix-compressed: `p` bytes shared with the previous entry's key, then the rest in `k`. Every node
 * block is pushed to `out`; the root's CID is returned.
 */
export function buildMst(leaves: readonly Leaf[], fanout: number, out: Block[]): CID {
  const node = (run: readonly Leaf[]): CID | null => {
    if (run.length === 0) return null;
    let lifted: number[];
    if (run.length <= fanout) lifted = run.map((_, index) => index);
    else {
      const step = Math.ceil(run.length / fanout);
      lifted = [];
      for (let index = step - 1; index < run.length; index += step) lifted.push(index);
    }
    const left = node(run.slice(0, lifted[0]!));
    let previous = new Uint8Array(0);
    const entries = lifted.map((at, i) => {
      const key = encoder.encode(run[at]!.key);
      const p = shared(previous, key);
      previous = key;
      const next = lifted[i + 1] ?? run.length;
      return { k: key.subarray(p), p, t: node(run.slice(at + 1, next)), v: run[at]!.cid };
    });
    const block = cborBlock({ e: entries, l: left });
    out.push(block);
    return block.cid;
  };
  return node(leaves) ?? (() => {
    const empty = cborBlock({ e: [], l: null });
    out.push(empty);
    return empty.cid;
  })();
}

export interface PostSpec {
  rkey: string;
  text: string;
  createdAt: string;
  reply?: string;
  embed?: Record<string, unknown>;
  labels?: string[];
}

export const atUri = (rkey: string, did = FIXTURE_DID) => `at://${did}/app.bsky.feed.post/${rkey}`;
const OTHER_DID = "did:plc:someoneelse234567abcdefg";
const strongRef = (uri: string) => ({ uri, cid: "bafyreib2rxk3rh6kzwq" });
const imageRef = () => ({ $type: "blob", ref: rawBlock(encoder.encode("not in the export")).cid, mimeType: "image/jpeg", size: 1234 });

export const BLUESKY_POSTS = {
  plain: { rkey: "3kaaaaaaaaa01", text: "Hello from Bluesky", createdAt: "2023-04-01T10:00:00.000Z" },
  thread: { rkey: "3kaaaaaaaaa02", text: "Continuing my own thread", createdAt: "2023-04-01T10:05:00.000Z", reply: atUri("3kaaaaaaaaa01") },
  reply: { rkey: "3kaaaaaaaaa03", text: "Answering someone else", createdAt: "2023-04-02T10:00:00.000Z", reply: atUri("3kzzzzzzzzz99", OTHER_DID) },
  quote: { rkey: "3kaaaaaaaaa04", text: "Quoting a post", createdAt: "2023-04-03T10:00:00.000Z", embed: { $type: "app.bsky.embed.record", record: strongRef(atUri("3kzzzzzzzzz98", OTHER_DID)) } },
  images: {
    rkey: "3kaaaaaaaaa05",
    text: "Two pictures",
    createdAt: "2023-04-04T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.images", images: [{ alt: "one", image: imageRef() }, { alt: "two", image: imageRef() }] },
  },
  video: { rkey: "3kaaaaaaaaa06", text: "A video", createdAt: "2023-04-05T10:00:00.000Z", embed: { $type: "app.bsky.embed.video", video: imageRef() } },
  quoteWithMedia: {
    rkey: "3kaaaaaaaaa07",
    text: "Quote with a picture",
    createdAt: "2023-04-06T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.recordWithMedia", record: { record: strongRef(atUri("3kzzzzzzzzz97", OTHER_DID)) }, media: { $type: "app.bsky.embed.images", images: [{ alt: "", image: imageRef() }] } },
  },
  card: {
    rkey: "3kaaaaaaaaa08",
    text: "A link card example.com/article",
    createdAt: "2023-04-07T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.external", external: { uri: "https://example.com/article", title: "Article", description: "card" } },
  },
  adult: { rkey: "3kaaaaaaaaa09", text: "Labelled for adults", createdAt: "2023-04-08T10:00:00.000Z", labels: ["porn"] },
  graphic: { rkey: "3kaaaaaaaaa10", text: "A graphic but allowed post", createdAt: "2023-04-09T10:00:00.000Z", labels: ["graphic-media"] },
  links: {
    rkey: "3kaaaaaaaaa11",
    text: `My profile bsky.app/profile/${CANARY.handle}.bsky.social and a post https://bsky.app/profile/${CANARY.handle}.bsky.social/post/3kaaaaaaaaa01 and ${atUri("3kaaaaaaaaa02")}`,
    createdAt: "2023-04-10T10:00:00.000Z",
  },
  offset: { rkey: "3kaaaaaaaaa12", text: "Dated with an offset", createdAt: "2023-04-11T10:00:00.5+02:00" },
  tooOld: { rkey: "3kaaaaaaaaa13", text: "Dated before the first tweet", createdAt: "1999-01-01T00:00:00Z" },
  nudity: { rkey: "3kaaaaaaaaa14", text: "Also labelled", createdAt: "2023-04-12T10:00:00Z", labels: ["nudity"] },
} satisfies Record<string, PostSpec>;

function postRecord(spec: PostSpec): Record<string, unknown> {
  return {
    $type: "app.bsky.feed.post",
    text: spec.text,
    createdAt: spec.createdAt,
    langs: ["en"],
    facets: [],
    ...(spec.reply ? { reply: { root: strongRef(spec.reply), parent: strongRef(spec.reply) } } : {}),
    ...(spec.embed ? { embed: spec.embed } : {}),
    ...(spec.labels ? { labels: { $type: "com.atproto.label.defs#selfLabels", values: spec.labels.map((val) => ({ val })) } } : {}),
  };
}

export interface BlueskyOptions {
  posts?: PostSpec[];
  /** The rkey of a post whose block bytes no longer match its CID. */
  corruptPost?: string;
  /** Corrupt the commit block's bytes instead. */
  corruptCommit?: boolean;
  /** Add a raw block of 1,000,001 bytes outside the tree. */
  bigBlock?: boolean;
  /** Write the CAR's header with two roots. */
  twoRoots?: boolean;
  /** The commit's version. */
  commitVersion?: number;
  /** Leave the MST's root node out of the CAR. */
  dropMstRoot?: boolean;
  fanout?: number;
}

/** Deterministic shuffle, so the blocks come in no useful order. */
function shuffle<T>(items: T[], seed = 3): T[] {
  let state = seed;
  for (let i = items.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export async function writeCar(roots: CID[], blocks: readonly Block[]): Promise<Buffer> {
  const { writer, out } = CarWriter.create(roots);
  const chunks: Uint8Array[] = [];
  const collected = (async () => {
    for await (const chunk of out) chunks.push(chunk);
  })();
  for (const block of blocks) await writer.put(block);
  await writer.close();
  await collected;
  return Buffer.concat(chunks);
}

export async function buildBlueskyArchive(options: BlueskyOptions = {}): Promise<Buffer> {
  const posts = options.posts ?? Object.values(BLUESKY_POSTS);
  const blocks: Block[] = [];
  const leaves: Leaf[] = [];
  const record = (key: string, value: unknown, corrupt = false) => {
    const block = cborBlock(value);
    if (corrupt) {
      const bytes = Uint8Array.from(block.bytes);
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      blocks.push({ cid: block.cid, bytes });
    } else blocks.push(block);
    leaves.push({ key, cid: block.cid });
  };
  record("app.bsky.actor.profile/self", { $type: "app.bsky.actor.profile", displayName: CANARY.name, description: `${CANARY.handle} profile` });
  record("app.bsky.feed.like/3kbbbbbbbbb01", { $type: "app.bsky.feed.like", subject: strongRef(atUri("3kzzzzzzzzz96", OTHER_DID)), createdAt: "2023-04-01T00:00:00Z", note: CANARY.like });
  for (const spec of posts) record(`app.bsky.feed.post/${spec.rkey}`, postRecord(spec), spec.rkey === options.corruptPost);
  record("app.bsky.feed.repost/3kccccccccc01", { $type: "app.bsky.feed.repost", subject: strongRef(atUri("3kzzzzzzzzz95", OTHER_DID)), createdAt: "2023-04-01T00:00:00Z" });
  record("app.bsky.graph.follow/3kddddddddd01", { $type: "app.bsky.graph.follow", subject: OTHER_DID, createdAt: "2023-04-01T00:00:00Z", via: CANARY.like });
  leaves.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const mstBlocks: Block[] = [];
  const data = buildMst(leaves, options.fanout ?? 4, mstBlocks);
  for (const block of mstBlocks) if (!(options.dropMstRoot === true && block.cid.equals(data))) blocks.push(block);
  const commit = cborBlock({ did: FIXTURE_DID, version: options.commitVersion ?? 3, data, rev: "3kcommitrev01", prev: null, sig: new Uint8Array(64) });
  if (options.corruptCommit === true) {
    const bytes = Uint8Array.from(commit.bytes);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    blocks.push({ cid: commit.cid, bytes });
  } else blocks.push(commit);
  // A block outside the tree: never reached, never decoded.
  blocks.push(cborBlock({ $type: "chat.bsky.convo.message", text: `${CANARY.dm} outside the tree` }));
  if (options.bigBlock === true) blocks.push(rawBlock(new Uint8Array(1_000_001)));
  const roots = options.twoRoots === true ? [commit.cid, data] : [commit.cid];
  return writeCar(roots, shuffle(blocks));
}
```

### Create `apps/importer/test/fixtures/canaries.ts`

```ts
/**
 * The canaries of the 3b design's section 12: strings planted where korbat must never read (direct messages, the IP
 * log, likes, private and deleted posts) and the person's own names elsewhere (the handle, the display name, a DID),
 * so that a test can prove none reached posts.jsonl, summary.json, the media folder, the scratch file or a log line.
 */
export const CANARY = {
  dm: "CANARY-DM",
  ip: "CANARY-IP",
  like: "CANARY-LIKE",
  private: "CANARY-PRIVATE",
  deleted: "CANARY-DELETED",
  handle: "CANARY-HANDLE",
  name: "CANARY-NAME",
} as const;

/** The fixture account's DID on Bluesky; a plc DID is 24 base32 characters. */
export const FIXTURE_DID = "did:plc:canarydidfixture2345abcd";

/** Every string none of the importer's outputs may hold. */
export const FORBIDDEN_STRINGS: readonly string[] = [...Object.values(CANARY), FIXTURE_DID, "canarydidfixture"];

/** The fixtures' Mastodon server, whose name is the person's own instance. */
export const FIXTURE_HOST = "social.example";

/** The account key of the fixtures' person (64 lowercase hex), and a second account's. */
export const ACCOUNT_KEY = "a1".repeat(32);
export const OTHER_ACCOUNT_KEY = "b2".repeat(32);

/** The creation time of the fixtures' imports: dates up to one day later are in range. */
export const CREATED_AT = "2026-10-20T12:00:00.000Z";
```

### Create `apps/importer/test/fixtures/harness.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pino, { type Logger } from "pino";
import { ImportedPost, ImportSummary, type ImportSource } from "@korbat/contracts";
import { archivesLayout, workLayout, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { scanJob, type ScanHooks, type ScanOutcome } from "../../src/scan";
import { ACCOUNT_KEY, CREATED_AT } from "./canaries";

/** A temporary folder for one test file, removed when it ends. */
export function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "korbat-importer-"));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A logger whose every line lands in `lines`, as the process's stdout would carry them. */
export function capturingLogger(level: pino.Level = "trace"): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString("utf8"));
      done();
    },
  });
  return { log: pino({ level, base: undefined }, sink), lines };
}

/** Two fresh volumes in `dir`: import-archives and import-work, as the importer sees them. */
export function volumes(dir: string): { archives: ArchivesLayout; work: WorkLayout } {
  const root = path.join(dir, randomUUID());
  const archives = archivesLayout(path.join(root, "archives"));
  const work = workLayout(path.join(root, "work"));
  for (const folder of [archives.jobs, archives.queue, archives.deletions, work.jobs, work.attempts, work.tmp]) mkdirSync(folder, { recursive: true });
  return { archives, work };
}

export interface JobOptions {
  source: ImportSource;
  archive: Buffer;
  images?: boolean;
  createdAt?: string;
  accountKey?: string;
  id?: string;
  /** Leave the queue marker out. */
  unqueued?: boolean;
}

/** Writes what the API writes for one import: the archive, job.json and the queue marker. */
export function placeJob(archives: ArchivesLayout, options: JobOptions): string {
  const id = options.id ?? randomUUID();
  mkdirSync(archives.jobDir(id), { recursive: true });
  writeFileSync(archives.archive(id), options.archive);
  writeFileSync(
    archives.job(id),
    JSON.stringify({ v: 1, id, source: options.source, accountKey: options.accountKey ?? ACCOUNT_KEY, images: options.images ?? false, createdAt: options.createdAt ?? CREATED_AT }),
  );
  if (options.unqueued !== true) writeFileSync(archives.queued(id), "");
  return id;
}

export interface ScanResult {
  id: string;
  outcome: ScanOutcome;
  summary: ImportSummary | null;
  /** posts.jsonl's raw text, and each line parsed with the contract (every line must parse). */
  raw: string;
  lines: ImportedPost[];
  media: Map<string, Buffer>;
  logs: string[];
  /** The scratch file as it was just before the scan deleted it. */
  scratch: Buffer | null;
  archives: ArchivesLayout;
  work: WorkLayout;
}

export function readOutput(work: WorkLayout, id: string): Pick<ScanResult, "summary" | "raw" | "lines" | "media"> {
  const summaryPath = work.summary(id);
  const summary = existsSync(summaryPath) ? ImportSummary.parse(JSON.parse(readFileSync(summaryPath, "utf8"))) : null;
  const raw = existsSync(work.posts(id)) ? readFileSync(work.posts(id), "utf8") : "";
  const lines = raw === "" ? [] : raw.split(String.fromCharCode(10)).filter((line) => line !== "").map((line) => ImportedPost.parse(JSON.parse(line)));
  const media = new Map<string, Buffer>();
  if (existsSync(work.mediaDir(id))) for (const name of readdirSync(work.mediaDir(id))) media.set(name, readFileSync(path.join(work.mediaDir(id), name)));
  return { summary, raw, lines, media };
}

/** One scan of a code-built archive, start to finish, through the importer's own scan with a capturing logger. */
export async function runScan(dir: string, options: JobOptions & { hooks?: ScanHooks; signal?: AbortSignal }): Promise<ScanResult> {
  const { archives, work } = volumes(dir);
  const id = placeJob(archives, options);
  const { log, lines: logs } = capturingLogger();
  let scratch: Buffer | null = null;
  const hooks: ScanHooks = {
    ...options.hooks,
    scratch: async (file) => {
      scratch = existsSync(file) ? readFileSync(file) : null;
      await options.hooks?.scratch?.(file);
    },
  };
  const outcome = await scanJob({ archives, work, log, hooks }, id, options.signal ?? new AbortController().signal);
  return { id, outcome, ...readOutput(work, id), logs, scratch, archives, work };
}

/** The line whose text contains `fragment`; fails the test when there is none or more than one. */
export function lineWith(lines: readonly ImportedPost[], fragment: string): ImportedPost {
  const found = lines.filter((line) => line.text.includes(fragment));
  if (found.length !== 1) throw new Error(`expected one line with "${fragment}", found ${found.length}`);
  return found[0]!;
}

/** The scanned summary, or a failure naming what came instead. */
export function scanned(result: ScanResult) {
  if (result.summary?.status !== "scanned") throw new Error(`expected a scanned summary, got ${JSON.stringify(result.summary)} (${result.outcome})`);
  return result.summary;
}
```

### Create `apps/importer/test/fixtures/mastodon.ts`

```ts
import { buildZip, fakeImage, type ZipItem } from "./zip";
import { CANARY, FIXTURE_HOST } from "./canaries";

/**
 * A Mastodon archive built by code (3b design, section 12.1): outbox.json with public, unlisted, private, direct and
 * limited Notes, an Announce embedding a Note, a Question, a quote with its quote-inline paragraph, a content warning,
 * sensitive media, a thread, a reply to another server beginning with two mention links, links to the person's own
 * statuses and profile, and media paths with and without a leading slash; the canaries in the private and direct
 * Notes, in likes.json and in actor.json.
 */

export const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
export const ACTOR = `https://${FIXTURE_HOST}/users/${CANARY.handle}`;
const FOLLOWERS = `${ACTOR}/followers`;
export const statusId = (n: number) => `${ACTOR}/statuses/1090000000000000${String(n).padStart(2, "0")}`;
export const mediaPath = (n: number, ext = "jpg") => `media_attachments/files/109/000/000/000/000/0${String(n).padStart(2, "0")}/original/${n.toString(16).padStart(16, "0")}.${ext}`;

const SPACE = " ";
const invisible = (text: string) => `<span class="invisible">${text}</span>`;
/** A link as Mastodon writes it: the scheme and the tail in invisible spans, the middle in an ellipsis span. */
export const masLink = (href: string) => {
  const rest = href.replace(/^https:[/][/]/, "");
  return `<a href="${href}" target="_blank" rel="nofollow noopener noreferrer" translate="no">${invisible("https://")}<span class="ellipsis">${rest.slice(0, 20)}</span>${invisible(rest.slice(20))}</a>`;
};
const mention = (href: string, name: string) => `<span class="h-card" translate="no"><a href="${href}" class="u-url mention">@<span>${name}</span></a></span>`;

export interface NoteSpec {
  n: number;
  at: string;
  content: string;
  to?: string[];
  cc?: string[];
  type?: "Note" | "Question";
  summary?: string;
  sensitive?: boolean;
  inReplyTo?: string | null;
  attachment?: { mediaType: string; url: string; name?: string | null }[];
  quote?: string;
}

const publicTo = { to: [PUBLIC], cc: [FOLLOWERS] };

export function createActivity(spec: NoteSpec): Record<string, unknown> {
  const to = spec.to ?? publicTo.to;
  const cc = spec.cc ?? publicTo.cc;
  return {
    id: `${statusId(spec.n)}/activity`,
    type: "Create",
    actor: ACTOR,
    published: spec.at,
    to,
    cc,
    object: {
      id: statusId(spec.n),
      type: spec.type ?? "Note",
      summary: spec.summary ?? null,
      inReplyTo: spec.inReplyTo ?? null,
      published: spec.at,
      url: `https://${FIXTURE_HOST}/@${CANARY.handle}/1090000000000000${String(spec.n).padStart(2, "0")}`,
      attributedTo: ACTOR,
      to,
      cc,
      sensitive: spec.sensitive ?? false,
      atomUri: statusId(spec.n),
      conversation: `tag:${FIXTURE_HOST},2019-03-03:objectId=${spec.n}:objectType=Conversation`,
      content: spec.content,
      contentMap: { en: spec.content },
      attachment: (spec.attachment ?? []).map((a) => ({ type: "Document", mediaType: a.mediaType, url: a.url, name: a.name ?? null, blurhash: "U00000fQfQfQfQfQfQfQfQfQfQfQ", width: 400, height: 300 })),
      tag: [],
      replies: { id: `${statusId(spec.n)}/replies`, type: "Collection" },
      ...(spec.quote !== undefined ? { quote: spec.quote, quoteUri: spec.quote, _misskey_quote: spec.quote } : {}),
      ...(spec.type === "Question" ? { oneOf: [{ type: "Note", name: "Yes", replies: { type: "Collection", totalItems: 1 } }] } : {}),
    },
  };
}

/** A description longer than korbat's 1,000 characters (Mastodon allows 1,500). */
export const LONG_DESCRIPTION = "A long description. ".repeat(60);

export const MASTODON_NOTES = {
  public: { n: 1, at: "2019-03-03T10:00:00Z", content: "<p>Hello from Mastodon &amp; friends &#8212; with &#x27;quotes&#39;</p><p>Second paragraph<br>with a line break</p>" },
  unlisted: { n: 2, at: "2019-03-04T10:00:00.000Z", content: "<p>An unlisted post</p>", to: [FOLLOWERS], cc: [PUBLIC] },
  private: { n: 3, at: "2019-03-05T10:00:00Z", content: `<p>${CANARY.private} for followers only</p>`, to: [FOLLOWERS], cc: [] },
  direct: { n: 4, at: "2019-03-06T10:00:00Z", content: `<p>${CANARY.dm} a direct message</p>`, to: ["https://other.example/users/bob"], cc: [] },
  limited: { n: 5, at: "2019-03-07T10:00:00Z", content: `<p>${CANARY.private} for a list</p>`, to: [`${ACTOR}/lists/1`], cc: [] },
  question: { n: 6, at: "2019-03-08T10:00:00Z", content: "<p>Which one?</p>", type: "Question" },
  quote: {
    n: 7,
    at: "2019-03-09T10:00:00Z",
    content: `<p class="quote-inline">RE: ${masLink("https://other.example/@bob/111")}</p><p>My comment on a quote</p>`,
    quote: "https://other.example/users/bob/statuses/111",
  },
  warning: { n: 8, at: "2019-03-10T10:00:00Z", content: "<p>The text behind a warning</p>", summary: "spoilers ahead" },
  sensitive: { n: 9, at: "2019-03-11T10:00:00Z", content: "<p>A sensitive picture</p>", sensitive: true, attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(9)}`, name: "a picture" }] },
  thread: { n: 10, at: "2019-03-12T10:00:00Z", content: "<p>Following up on my own post</p>", inReplyTo: statusId(1) },
  reply: {
    n: 11,
    at: "2019-03-13T10:00:00Z",
    content: `<p>${mention("https://other.example/@bob", "bob")}${SPACE}${mention("https://third.example/@carol", "carol")}${SPACE}Thanks both, see @dave too</p>`,
    inReplyTo: "https://other.example/users/bob/statuses/222",
  },
  ownLinks: {
    n: 12,
    at: "2019-03-14T10:00:00Z",
    content: `<p>My earlier post ${masLink(`https://${FIXTURE_HOST}/@${CANARY.handle}/109000000000000001`)} and my profile ${masLink(`https://${FIXTURE_HOST}/@${CANARY.handle}`)} and an old one ${masLink(`https://${FIXTURE_HOST}/users/${CANARY.handle}/statuses/109000000000000002`)}</p>`,
  },
  longLink: { n: 13, at: "2019-03-15T10:00:00Z", content: `<p>Read ${masLink("https://example.com/a/very/long/path/that/mastodon/shortens")} today <a href="https://${FIXTURE_HOST}/tags/korbat" class="mention hashtag" rel="tag">#<span>korbat</span></a></p>` },
  photos: {
    n: 14,
    at: "2019-03-16T10:00:00Z",
    content: "<p>Two photos</p>",
    attachment: [
      { mediaType: "image/jpeg", url: `/${mediaPath(14)}`, name: "  A described   photo  " },
      { mediaType: "image/png", url: mediaPath(15, "png"), name: null },
    ],
  },
  video: { n: 16, at: "2019-03-17T10:00:00Z", content: "<p>A video and a gif</p>", attachment: [{ mediaType: "video/mp4", url: `/${mediaPath(16, "jpg")}` }, { mediaType: "image/gif", url: `/${mediaPath(17, "jpg")}` }] },
  longAlt: { n: 18, at: "2019-03-18T10:00:00Z", content: "<p>A photo with a long description</p>", attachment: [{ mediaType: "image/webp", url: `https://${FIXTURE_HOST}/system/${mediaPath(18, "webp")}`, name: LONG_DESCRIPTION }] },
  missing: { n: 19, at: "2019-03-19T10:00:00Z", content: "<p>A photo that is not in the archive</p>", attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(19)}`, name: "gone" }] },
  tooOld: { n: 20, at: "2001-01-01T00:00:00Z", content: "<p>Before the first tweet</p>" },
  offset: { n: 21, at: "2019-03-20T23:30:00.750-02:00", content: "<p>Dated with an offset</p>" },
} satisfies Record<string, NoteSpec>;

export interface MastodonArchiveOptions {
  media?: boolean;
  noActor?: boolean;
  noOutbox?: boolean;
  notes?: NoteSpec[];
  /** Raw outbox.json text instead of the generated one. */
  outbox?: string;
  extra?: ZipItem[];
}

export function outboxJson(notes: readonly NoteSpec[], announce = true): string {
  const items: unknown[] = notes.map(createActivity);
  if (announce) {
    items.splice(2, 0, {
      id: `${ACTOR}/statuses/1090000000000000998/activity`,
      type: "Announce",
      actor: ACTOR,
      published: "2019-03-05T12:00:00Z",
      to: [PUBLIC],
      cc: [FOLLOWERS],
      object: { id: "https://other.example/users/bob/statuses/333", type: "Note", content: `<p>${CANARY.private} a boosted post</p>`, attributedTo: "https://other.example/users/bob" },
    });
  }
  return JSON.stringify({ "@context": "https://www.w3.org/ns/activitystreams", id: "outbox.json", type: "OrderedCollection", totalItems: items.length, orderedItems: items }, null, 1);
}

export function buildMastodonArchive(options: MastodonArchiveOptions = {}): Buffer {
  const notes = options.notes ?? Object.values(MASTODON_NOTES);
  const items: ZipItem[] = [];
  if (options.noOutbox !== true) items.push({ name: "outbox.json", data: options.outbox ?? outboxJson(notes, options.notes === undefined) });
  if (options.noActor !== true) {
    items.push({ name: "actor.json", data: JSON.stringify({ id: ACTOR, type: "Person", preferredUsername: CANARY.handle, name: CANARY.name, summary: `<p>${CANARY.name}</p>` }) });
  }
  items.push({ name: "likes.json", data: JSON.stringify({ type: "OrderedCollection", orderedItems: [`https://other.example/users/bob/statuses/${CANARY.like}`] }) });
  items.push({ name: "bookmarks.json", data: JSON.stringify({ type: "OrderedCollection", orderedItems: [] }) });
  items.push({ name: "avatar.png", data: Buffer.concat([fakeImage("png", 300, 3), Buffer.from(CANARY.name)]), method: 0 });
  items.push({ name: "header.jpg", data: fakeImage("jpg", 300, 4), method: 0 });
  if (options.media !== false) {
    items.push({ name: mediaPath(9), data: fakeImage("jpg", 900, 9), method: 0 });
    items.push({ name: mediaPath(14), data: fakeImage("jpg", 1_400, 14), method: 0 });
    items.push({ name: mediaPath(15, "png"), data: fakeImage("png", 1_500, 15), method: 0 });
    items.push({ name: mediaPath(16, "jpg"), data: fakeImage("jpg", 1_600, 16), method: 0 });
    items.push({ name: mediaPath(17, "jpg"), data: fakeImage("gif", 1_700, 17), method: 0 });
    items.push({ name: mediaPath(18, "webp"), data: fakeImage("webp", 1_800, 18), method: 0 });
  }
  items.push(...(options.extra ?? []));
  return buildZip(items);
}
```

### Create `apps/importer/test/fixtures/x.ts`

```ts
import { buildZip, fakeImage, type ZipItem } from "./zip";
import { CANARY } from "./canaries";

/**
 * An X archive built by code (3b design, section 12.1): data/manifest.js, tweets.js in the current and the 2019
 * element shape, tweets-part1.js, note-tweet.js, twitter-circle-tweet.js, protected-history.js with one protected
 * period, media files, and the canaries in the files korbat never opens. Its posts cover every row of 5.5's table. The
 * names of X's files come from open-source parsers (3.6), so this fixture is the contract the adapter is tested against.
 */

export const X_ACCOUNT_ID = "4000000001";
const OTHER_ACCOUNT_ID = "4000000999";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** X's created_at, as "Wed Oct 10 20:19:24 +0000 2018", for an ISO time in UTC. */
export function xDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
}

/** The text X writes before a data file's JSON. */
const prefix = (name: string, part = 0) => `window.YTD.${name}.part${part} = `;
export const dataFile = (name: string, elements: readonly unknown[], part = 0) => prefix(name, part) + JSON.stringify(elements, null, 2);

export interface TweetSpec {
  id: string;
  at: string;
  text: string;
  urls?: { url: string; expanded: string }[];
  media?: { url: string; file: string; type?: "photo" | "video" | "animated_gif" }[];
  replyTo?: { status: string; user: string };
  displayStart?: number;
  sensitive?: boolean;
  editIds?: string[];
  /** The 2019 element shape: the tweet object itself, not under "tweet". */
  bare?: boolean;
}

export function tweetObject(spec: TweetSpec): Record<string, unknown> {
  const media = (spec.media ?? []).map((m, index) => ({
    id_str: `${spec.id}${index}`,
    media_url_https: `https://pbs.twimg.com/media/${m.file}`,
    url: m.url,
    expanded_url: `https://twitter.com/${CANARY.handle}/status/${spec.id}/photo/${index + 1}`,
    type: m.type ?? "photo",
  }));
  const textLength = Array.from(spec.text).length;
  const tweet: Record<string, unknown> = {
    edit_info: { initial: { editTweetIds: spec.editIds ?? [spec.id], editableUntil: "2020-01-01T00:00:00.000Z", editsRemaining: "5", isEditEligible: true } },
    retweeted: false,
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    entities: {
      hashtags: [],
      symbols: [],
      user_mentions: [],
      urls: (spec.urls ?? []).map((u) => ({ url: u.url, expanded_url: u.expanded, display_url: u.expanded.replace(/^https?:[/][/]/, ""), indices: ["0", "23"] })),
      ...(media.length > 0 ? { media: media.slice(0, 1) } : {}),
    },
    display_text_range: [String(spec.displayStart ?? 0), String(textLength)],
    favorite_count: "0",
    id_str: spec.id,
    truncated: false,
    retweet_count: "0",
    id: spec.id,
    possibly_sensitive: spec.sensitive ?? false,
    created_at: xDate(spec.at),
    favorited: false,
    full_text: spec.text,
    lang: "en",
    ...(spec.replyTo ? { in_reply_to_status_id_str: spec.replyTo.status, in_reply_to_status_id: spec.replyTo.status, in_reply_to_user_id_str: spec.replyTo.user, in_reply_to_user_id: spec.replyTo.user, in_reply_to_screen_name: "someone" } : {}),
    ...(media.length > 0 ? { extended_entities: { media } } : {}),
  };
  return spec.bare === true ? tweet : { tweet };
}

/** Every case of 5.5's table, by a name the tests use; each kept one has a text no other has. */
export const X_TWEETS = {
  plain: { id: "1100000000000000001", at: "2019-03-03T10:00:00Z", text: "Plain post with a link https://t.co/aaa111 and &amp; &lt;b&gt; escapes", urls: [{ url: "https://t.co/aaa111", expanded: "https://example.com/page" }] },
  repost: { id: "1100000000000000002", at: "2019-03-04T10:00:00Z", text: "RT @someone: their words, not mine" },
  circle: { id: "1100000000000000003", at: "2019-03-05T10:00:00Z", text: `Circle only ${CANARY.private}` },
  editOld: { id: "1100000000000000004", at: "2019-03-06T10:00:00Z", text: "First version of an edited post", editIds: ["1100000000000000004", "1100000000000000005"] },
  editNew: { id: "1100000000000000005", at: "2019-03-06T10:05:00Z", text: "Second version of an edited post", editIds: ["1100000000000000004", "1100000000000000005"] },
  thread: { id: "1100000000000000006", at: "2019-03-07T10:00:00Z", text: "A reply to my own plain post", replyTo: { status: "1100000000000000001", user: X_ACCOUNT_ID } },
  reply: { id: "1100000000000000007", at: "2019-03-08T10:00:00Z", text: "@someone @another Answering someone else", displayStart: 18, replyTo: { status: "1100000000000000900", user: OTHER_ACCOUNT_ID } },
  selfQuote: {
    id: "1100000000000000008",
    at: "2019-03-09T10:00:00Z",
    text: "Quoting myself https://t.co/qqq222",
    urls: [{ url: "https://t.co/qqq222", expanded: `https://twitter.com/${CANARY.handle}/status/1100000000000000001` }],
  },
  profileLink: { id: "1100000000000000009", at: "2019-03-10T10:00:00Z", text: "Find me at https://t.co/ppp333", urls: [{ url: "https://t.co/ppp333", expanded: `https://x.com/${CANARY.handle}` }] },
  long: { id: "1100000000000000010", at: "2023-05-01T08:30:15Z", text: "This is the start of a long note that X cut short in the tweet's own text and keeps whole in the note file, so the importer has to join the two again before it writes the post down for the preview and the" + String.fromCharCode(0x2026) + " https://t.co/lll444" },
  sensitive: { id: "1100000000000000011", at: "2019-03-12T10:00:00Z", text: "A sensitive photo post https://t.co/sss555", sensitive: true, media: [{ url: "https://t.co/sss555", file: "Fsens001.jpg" }] },
  photo: { id: "1100000000000000012", at: "2019-03-13T10:00:00Z", text: "A photo post https://t.co/ppp666", media: [{ url: "https://t.co/ppp666", file: "Fphoto01.jpg" }] },
  video: { id: "1100000000000000013", at: "2019-03-14T10:00:00Z", text: "A video post https://t.co/vvv777", media: [{ url: "https://t.co/vvv777", file: "Fvideo01.jpg", type: "video" }] },
  gif: { id: "1100000000000000014", at: "2019-03-15T10:00:00Z", text: "An animated post https://t.co/ggg888", media: [{ url: "https://t.co/ggg888", file: "Fgif0001.jpg", type: "animated_gif" }] },
  protectedPost: { id: "1100000000000000015", at: "2020-06-15T10:00:00Z", text: "Written while my account was protected" },
  bare2019: { id: "1100000000000000016", at: "2019-03-16T10:00:00Z", text: "A post in the 2019 element shape", bare: true },
  stray: { id: "1100000000000000017", at: "2019-03-17T10:00:00Z", text: "A stray t.co link https://t.co/zzz999 goes away" },
  tooOld: { id: "1100000000000000018", at: "2005-01-01T10:00:00Z", text: "A date before the first tweet" },
  missing: { id: "1100000000000000019", at: "2019-03-18T10:00:00Z", text: "A photo whose file is missing https://t.co/mmm000", media: [{ url: "https://t.co/mmm000", file: "Fmiss001.jpg" }] },
  onlyMedia: { id: "1100000000000000020", at: "2019-03-19T10:00:00Z", text: "https://t.co/ooo123", media: [{ url: "https://t.co/ooo123", file: "Fonly001.jpg" }] },
  inPart1: { id: "1100000000000000021", at: "2019-03-20T10:00:00Z", text: "A post from tweets-part1.js" },
  future: { id: "1100000000000000022", at: "2026-10-22T12:00:01Z", text: "A date more than a day after the import" },
} satisfies Record<string, TweetSpec>;

/** The note's whole text, which replaces the long tweet's. */
export const X_NOTE_TEXT =
  "This is the start of a long note that X cut short in the tweet's own text and keeps whole in the note file, so the importer has to join the two again before it writes the post down for the preview and the person, who sees all of it.";

export interface XArchiveOptions {
  /** Media files in the archive (they are allowlisted only while images are on). */
  media?: boolean;
  /** archiveInfo.isPartialArchive. */
  partial?: boolean;
  /** A manifest without dataTypes: the fixed names are tried. */
  noFileList?: boolean;
  /** Leave the manifest out. */
  noManifest?: boolean;
  /** A manifest bigger than 1 MiB. */
  hugeManifest?: boolean;
  /** The 2018 archive: data/tweet.js only. */
  legacy?: boolean;
  /** Extra entries, e.g. crafted names. */
  extra?: ZipItem[];
  /** Tweets to write instead of the fixture's. */
  tweets?: TweetSpec[];
  /** The manifest's raw text, instead of the generated one. */
  manifestText?: string;
  /** data/tweets.js's raw text, instead of the generated one. */
  tweetsText?: string;
}

export function xManifest(options: XArchiveOptions = {}, tweetsFiles: string[] = ["data/tweets.js", "data/tweets-part1.js"]): string {
  const manifest = {
    userInfo: { accountId: X_ACCOUNT_ID, userName: CANARY.handle, displayName: CANARY.name },
    archiveInfo: { sizeBytes: "123456", generationDate: "2026-10-01T00:00:00.000Z", isPartialArchive: options.partial === true, maxPartSizeBytes: "53687091200" },
    readmeInfo: { fileName: "data/README.txt", directory: "data/", name: "README" },
    ...(options.noFileList === true
      ? {}
      : {
          dataTypes: {
            tweets: { files: tweetsFiles.map((fileName, index) => ({ fileName, globalName: `YTD.tweets.part${index}`, count: "1" })) },
            noteTweet: { files: [{ fileName: "data/note-tweet.js", globalName: "YTD.note_tweet.part0", count: "1" }] },
            twitterCircleTweet: { files: [{ fileName: "data/twitter-circle-tweet.js", globalName: "YTD.twitter_circle_tweet.part0", count: "1" }] },
            directMessages: { files: [{ fileName: "data/direct-messages.js", globalName: "YTD.direct_messages.part0", count: "1" }] },
            // A file name outside the allowlist, even under a data type the adapter reads, is never opened.
            account: { files: [{ fileName: "data/account.js", globalName: "YTD.account.part0", count: "1" }] },
          },
        }),
    ...(options.hugeManifest === true ? { padding: "x".repeat(1_100_000) } : {}),
  };
  return "window.__THAR_CONFIG = " + JSON.stringify(manifest, null, 2);
}

/** The archive, and the entries every X archive holds beside its posts: the canaries. */
export function buildXArchive(options: XArchiveOptions = {}): Buffer {
  const all = options.tweets ?? Object.values(X_TWEETS);
  const part1 = options.tweets ? [] : [X_TWEETS.inPart1];
  const main = options.tweets ? all : all.filter((tweet) => tweet !== X_TWEETS.inPart1 && tweet !== X_TWEETS.protectedPost);
  const items: ZipItem[] = [];
  if (options.noManifest !== true) {
    items.push({ name: "data/manifest.js", data: options.manifestText ?? xManifest(options, options.legacy === true ? ["data/tweet.js"] : ["data/tweets.js", "data/tweets-part1.js"]) });
  }
  if (options.legacy === true) {
    items.push({ name: "data/tweet.js", data: dataFile("tweet", main.map(tweetObject)) });
  } else {
    // The protected tweet is written in the current shape after the rest, so the file mixes both shapes.
    const elements = [...main.map(tweetObject), ...(options.tweets ? [] : [tweetObject(X_TWEETS.protectedPost)])];
    items.push({ name: "data/tweets.js", data: options.tweetsText ?? dataFile("tweets", elements) });
    if (part1.length > 0) items.push({ name: "data/tweets-part1.js", data: dataFile("tweets", part1.map(tweetObject), 1) });
  }
  items.push({
    name: "data/note-tweet.js",
    data: dataFile("note_tweet", [
      { noteTweet: { noteTweetId: "77001", updatedAt: "2023-05-01T08:30:15.000Z", lifecycle: { value: "live" }, createdAt: "2023-05-01T08:30:15.000Z", core: { styletags: [], urls: [], text: X_NOTE_TEXT, mentions: [], cashtags: [], hashtags: [] } } },
      // A note no tweet matches: ignored.
      { noteTweet: { noteTweetId: "77002", updatedAt: "2023-06-01T00:00:00.000Z", lifecycle: { value: "live" }, createdAt: "2023-06-01T00:00:00.000Z", core: { styletags: [], urls: [], text: "An unmatched note", mentions: [], cashtags: [], hashtags: [] } } },
    ]),
  });
  items.push({ name: "data/twitter-circle-tweet.js", data: dataFile("twitter_circle_tweet", [tweetObject(X_TWEETS.circle)]) });
  items.push({
    name: "data/protected-history.js",
    data: dataFile("protected_history", [
      { protectedHistory: { protectedAt: "2020-06-01T00:00:00.000Z", action: "Protect" } },
      { protectedHistory: { protectedAt: "2020-07-01T00:00:00.000Z", action: "Unprotect" } },
    ]),
  });
  if (options.media !== false) {
    items.push({ name: "data/tweets_media/1100000000000000011-Fsens001.jpg", data: fakeImage("jpg", 1_000, 11), method: 0 });
    items.push({ name: "data/tweets_media/1100000000000000012-Fphoto01.jpg", data: fakeImage("jpg", 1_500, 12), method: 0 });
    items.push({ name: "data/tweets_media/1100000000000000020-Fonly001.jpg", data: fakeImage("png", 1_200, 20), method: 0 });
    // Media of a direct message: a canary in a folder the allowlist never names.
    items.push({ name: "data/direct_messages_media/900-Fdm00001.jpg", data: Buffer.concat([fakeImage("jpg", 200, 9), Buffer.from(CANARY.dm)]), method: 0 });
  }
  // The files korbat never opens, each with its canary.
  items.push({ name: "data/direct-messages.js", data: dataFile("direct_messages", [{ dmConversation: { conversationId: "1-2", messages: [{ messageCreate: { text: `${CANARY.dm} a private message`, senderId: X_ACCOUNT_ID } }] } }]) });
  items.push({ name: "data/ip-audit.js", data: dataFile("ip_audit", [{ ipAudit: { accountId: X_ACCOUNT_ID, createdAt: "2019-01-01T00:00:00.000Z", loginIp: `${CANARY.ip} 192.0.2.1` } }]) });
  items.push({ name: "data/like.js", data: dataFile("like", [{ like: { tweetId: "1", fullText: `${CANARY.like} someone's post` } }]) });
  items.push({ name: "data/deleted-tweets.js", data: dataFile("deleted_tweets", [tweetObject({ id: "1100000000000000099", at: "2019-04-01T10:00:00Z", text: `${CANARY.deleted} a deleted post` })]) });
  items.push({ name: "data/account.js", data: dataFile("account", [{ account: { email: "person@example.com", username: CANARY.handle, accountDisplayName: CANARY.name, accountId: X_ACCOUNT_ID } }]) });
  items.push({ name: "data/README.txt", data: "Your archive" });
  items.push(...(options.extra ?? []));
  return buildZip(items);
}
```

### Create `apps/importer/test/fixtures/zip.ts`

```ts
import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small zip writer for the importer's tests (3b design, section 12.1), after korbat's own writer in
 * apps/api/src/account/zip.ts but never imported from it (an app imports no other app). It writes stored and deflated
 * entries, ZIP64 records on demand, and has a switch for every crafted case the zip reader must refuse or ignore, so
 * that no test reads an archive it did not build.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const FLAG_ENCRYPTED = 1;
const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;
/** "Made by" Unix (3), version 3.0: the high half of the external attributes then holds the file's mode. */
const MADE_BY_UNIX = (3 << 8) | 30;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export interface ZipItem {
  /** The entry's name, or its raw bytes (for a NUL or bytes that are not UTF-8). */
  name: string | Buffer;
  data: Buffer | string;
  /** 0 stored, 8 deflated (the default), 12 bzip2: declared only, the bytes are stored. */
  method?: 0 | 8 | 12;
  /** Flag bit 0, as an encrypting writer sets it. */
  encrypted?: boolean;
  /** A symbolic link entry (mode 0o120777 in the external attributes): its data is the link's target. */
  symlink?: boolean;
  /** A directory entry; give it a name with a trailing slash. */
  directory?: boolean;
  /** Flag bit 3: zero CRC and sizes in the local header, a data descriptor (with its signature) after the data. */
  dataDescriptor?: boolean;
  /** 0xFFFFFFFF sizes in the local header with a ZIP64 extra field holding the real ones. */
  zip64Local?: boolean;
  /** Both headers carry a CRC that is not the data's. */
  badCrc?: boolean;
  /** Both headers declare this uncompressed size instead of the real one: a size that lies. */
  declaredSize?: number;
  /** Both headers declare this compressed size instead of the real one. */
  declaredCompressed?: number;
  /** The local header's name, when it should differ from the central one. */
  localName?: string;
  /** The local header's method, when it should differ from the central one. */
  localMethod?: number;
  /** Clear flag bit 11 (UTF-8): the name is then CP437 by the format. */
  cp437?: boolean;
  /** This entry's local record lies inside the previous entry's stored data: the overlapping-files case. */
  nestInPrevious?: boolean;
}

export interface ZipOptions {
  /** Write the ZIP64 end records, and ZIP64 extras in every central entry. */
  zip64?: boolean;
  /** List the entry at this index twice in the central directory. */
  duplicateCentral?: number;
  /** The archive comment. */
  comment?: Buffer;
  /** Declare a comment this much longer than the one written: a comment that runs past the end. */
  commentOverrun?: number;
  /** The end record's disk numbers. */
  disk?: number;
  /** Override the end record's entry count (and the ZIP64 record's). */
  entriesDeclared?: number;
  /** Override the central directory's offset in the end records. */
  directoryOffset?: number;
  /** Override the central directory's size in the end records. */
  directorySize?: number;
}

const toBuffer = (value: Buffer | string) => (typeof value === "string" ? Buffer.from(value, "utf8") : value);

function zip64Extra(values: readonly number[]): Buffer {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return extra;
}

interface Prepared {
  item: ZipItem;
  name: Buffer;
  localName: Buffer;
  compressed: Buffer;
  crc: number;
  size: number;
  compressedSize: number;
  flags: number;
  method: number;
  record: Buffer;
  offset: number;
}

function localRecord(p: Omit<Prepared, "record" | "offset">): Buffer {
  const { item } = p;
  const descriptor = item.dataDescriptor === true;
  const zip64 = item.zip64Local === true;
  const extra = zip64 ? zip64Extra([p.size, p.compressedSize]) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(zip64 ? 45 : 20, 4);
  header.writeUInt16LE(p.flags, 6);
  header.writeUInt16LE(item.localMethod ?? p.method, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(descriptor ? 0 : p.crc, 14);
  header.writeUInt32LE(descriptor ? 0 : zip64 ? MAX32 : p.compressedSize, 18);
  header.writeUInt32LE(descriptor ? 0 : zip64 ? MAX32 : p.size, 22);
  header.writeUInt16LE(p.localName.length, 26);
  header.writeUInt16LE(extra.length, 28);
  const parts = [header, p.localName, extra, p.compressed];
  if (descriptor) {
    const tail = Buffer.alloc(16);
    tail.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    tail.writeUInt32LE(p.crc, 4);
    tail.writeUInt32LE(p.compressedSize, 8);
    tail.writeUInt32LE(p.size, 12);
    parts.push(tail);
  }
  return Buffer.concat(parts);
}

function prepare(item: ZipItem): Omit<Prepared, "record" | "offset"> {
  const name = toBuffer(item.name);
  const data = toBuffer(item.data);
  const method = item.method ?? 8;
  const compressed = method === 8 ? deflateRawSync(data) : data;
  let flags = item.cp437 === true ? 0 : FLAG_UTF8;
  if (item.encrypted === true) flags |= FLAG_ENCRYPTED;
  if (item.dataDescriptor === true) flags |= FLAG_DESCRIPTOR;
  const realCrc = crc32(data);
  return {
    item,
    name,
    localName: item.localName === undefined ? name : Buffer.from(item.localName, "utf8"),
    compressed,
    crc: item.badCrc === true ? (realCrc ^ 0x5a5a5a5a) >>> 0 : realCrc,
    size: item.declaredSize ?? data.length,
    compressedSize: item.declaredCompressed ?? compressed.length,
    flags,
    method,
  };
}

function centralRecord(p: Prepared, zip64: boolean): Buffer {
  const { item } = p;
  const extra = zip64 ? zip64Extra([p.size, p.compressedSize, p.offset]) : Buffer.alloc(0);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(MADE_BY_UNIX, 4);
  header.writeUInt16LE(zip64 ? 45 : 20, 6);
  header.writeUInt16LE(p.flags, 8);
  header.writeUInt16LE(p.method, 10);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(p.crc, 16);
  header.writeUInt32LE(zip64 ? MAX32 : p.compressedSize, 20);
  header.writeUInt32LE(zip64 ? MAX32 : p.size, 24);
  header.writeUInt16LE(p.name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  const mode = item.symlink === true ? S_IFLNK | 0o777 : item.directory === true ? S_IFDIR | 0o755 : S_IFREG | 0o644;
  header.writeUInt32LE((mode << 16) >>> 0, 38);
  header.writeUInt32LE(zip64 ? MAX32 : p.offset, 42);
  return Buffer.concat([header, p.name, extra]);
}

/** The archive's bytes. */
export function buildZip(items: readonly ZipItem[], options: ZipOptions = {}): Buffer {
  const prepared: Prepared[] = [];
  const body: Buffer[] = [];
  let offset = 0;
  for (const item of items) {
    const base = prepare(item);
    const previous = prepared.at(-1);
    if (item.nestInPrevious === true && previous) {
      // The previous entry becomes a stored entry whose data quotes this entry's whole record, which is then not
      // written again: both central entries point into one range of the file.
      const record = localRecord(base);
      const quoted = Buffer.concat([toBuffer(previous.item.data), record]);
      const outer = prepare({ ...previous.item, data: quoted, method: 0 });
      const outerRecord = localRecord(outer);
      offset -= previous.record.length;
      body.pop();
      const rebuilt: Prepared = { ...outer, record: outerRecord, offset };
      prepared[prepared.length - 1] = rebuilt;
      const inner = offset + 30 + outer.localName.length + toBuffer(previous.item.data).length;
      prepared.push({ ...base, record, offset: inner });
      body.push(outerRecord);
      offset += outerRecord.length;
      continue;
    }
    const record = localRecord(base);
    prepared.push({ ...base, record, offset });
    body.push(record);
    offset += record.length;
  }
  const zip64 = options.zip64 === true;
  const listed = [...prepared];
  if (options.duplicateCentral !== undefined) listed.push(prepared[options.duplicateCentral]!);
  const central = Buffer.concat(listed.map((p) => centralRecord(p, zip64)));
  const directoryOffset = options.directoryOffset ?? offset;
  const count = options.entriesDeclared ?? listed.length;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_END_SIGNATURE, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(options.disk ?? 0, 16);
    record.writeUInt32LE(options.disk ?? 0, 20);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(options.directorySize ?? central.length), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR_SIGNATURE, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset + central.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const comment = options.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(options.disk ?? 0, 4);
  end.writeUInt16LE(options.disk ?? 0, 6);
  end.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 8);
  end.writeUInt16LE(zip64 ? MAX16 : Math.min(count, MAX16), 10);
  end.writeUInt32LE(zip64 ? MAX32 : (options.directorySize ?? central.length), 12);
  end.writeUInt32LE(zip64 ? MAX32 : directoryOffset, 16);
  end.writeUInt16LE(comment.length + (options.commentOverrun ?? 0), 20);
  return Buffer.concat([...body, central, ...tail, end, comment]);
}

/** A buffer of pseudo-random bytes from a seed, which deflate cannot shrink: image stand-ins and incompressible data. */
export function noise(length: number, seed = 1): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

/** The first bytes of each image type the importer takes, then noise: enough for its check of the file's type. */
export function fakeImage(kind: "jpg" | "png" | "webp" | "gif", length = 2_048, seed = 7): Buffer {
  const rest = noise(length, seed);
  if (kind === "jpg") return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), rest]);
  if (kind === "png") return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), rest]);
  if (kind === "webp") {
    const head = Buffer.alloc(12);
    head.write("RIFF", 0, "latin1");
    head.writeUInt32LE(length + 4, 4);
    head.write("WEBP", 8, "latin1");
    return Buffer.concat([head, rest]);
  }
  return Buffer.concat([Buffer.from("GIF89a", "latin1"), rest]);
}
```

### Create `apps/importer/test/json.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ItemTooLarge, NotJson, afterPrefix, streamArray } from "../src/json";

/**
 * The assembler of 5.5 over stream-json's parser: one element at a time, its bytes and depth counted as it is built,
 * refused (item_too_large) past 1 MiB or 64 levels before more is held; everything outside the streamed array is
 * passed over without being held.
 */

async function* chunked(text: string, size = 7): AsyncGenerator<Uint8Array> {
  const bytes = Buffer.from(text, "utf8");
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of source) out.push(item);
  return out;
}

/** A source that produces `total` bytes lazily, and counts how many it was asked for. */
function lazy(head: string, fill: string, total: number, tail: string) {
  const state = { pulled: 0 };
  async function* source(): AsyncGenerator<Uint8Array> {
    yield Buffer.from(head);
    state.pulled += head.length;
    const block = Buffer.from(fill.repeat(65_536 / fill.length));
    for (let sent = 0; sent < total; sent += block.length) {
      state.pulled += block.length;
      yield block;
    }
    yield Buffer.from(tail);
  }
  return { source: source(), state };
}

describe("streamArray", () => {
  test("yields a top-level array's elements in order, strings split across chunks and multibyte characters whole", async () => {
    const snowman = String.fromCodePoint(0x2603);
    const items = await collect(streamArray(chunked(`[ {"a": 1, "b": [true, null, -2.5e3]}, "x${snowman}y", 42, {"nested": {"k": "v"}} ]`, 3)));
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ a: 1, b: [true, null, -2500] }, `x${snowman}y`, 42, { nested: { k: "v" } }]);
  });

  test("yields one member's array of the top-level object and passes over the rest without holding it", async () => {
    const text = `{"@context": "x", "big": "${"z".repeat(300_000)}", "orderedItems": [{"type": "Create"}, {"type": "Announce"}], "after": [1, 2]}`;
    const items = await collect(streamArray(chunked(text, 4_096), { member: "orderedItems" }));
    expect(JSON.parse(JSON.stringify(items))).toEqual([{ type: "Create" }, { type: "Announce" }]);
  });

  test("objects are built without a prototype, so __proto__ is only a key", async () => {
    const [item] = (await collect(streamArray(chunked('[{"__proto__": {"polluted": true}, "constructor": 1}]')))) as Record<string, unknown>[];
    expect(Object.getPrototypeOf(item)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(item!["__proto__"]).toEqual({ polluted: true });
  });

  test("a trailing semicolon and white space after the top-level value are ignored, and so is a later chunk", async () => {
    const LF = String.fromCharCode(10);
    expect(await collect(streamArray(chunked(`[1, 2];${LF}`)))).toEqual([1, 2]);
    expect(await collect(streamArray(chunked(`[1, 2] ${LF}${LF}`, 64)))).toEqual([1, 2]);
    // Bytes in a later read than the one that closed the array are never parsed.
    expect(await collect(streamArray(chunked("[1, 2]" + " ".repeat(70_000) + "trailing", 65_536)))).toEqual([1, 2]);
  });

  test("a syntax error, a truncated file, or another shape is NotJson", async () => {
    await expect(collect(streamArray(chunked("[1, 2,, 3]")))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked("[1, 2, {")))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked('{"a": 1}')))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked("[1]"), { member: "orderedItems" }))).rejects.toThrow(NotJson);
    await expect(collect(streamArray(chunked('{"orderedItems": 3}'), { member: "orderedItems" }))).rejects.toThrow(NotJson);
  });

  test("an element over 1 MiB is refused after the elements before it, without reading the rest of a 900 MB string", async () => {
    expect(IMPORT_RULES.itemMaxBytes).toBe(1_048_576);
    const { source, state } = lazy('[{"ok": 1}, "', "a", 900_000_000, '"]');
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const item of streamArray(source)) seen.push(item);
      })(),
    ).rejects.toThrow(ItemTooLarge);
    expect(JSON.parse(JSON.stringify(seen))).toEqual([{ ok: 1 }]);
    expect(state.pulled).toBeLessThan(3_000_000);
  });

  test("a key of 500 MB is refused the same way", async () => {
    const { source, state } = lazy('[{"', "k", 500_000_000, '": 1}]');
    await expect(collect(streamArray(source))).rejects.toThrow(ItemTooLarge);
    expect(state.pulled).toBeLessThan(3_000_000);
  });

  test("an element just under the byte cap is kept", async () => {
    const [item] = (await collect(streamArray(chunked(`["${"b".repeat(IMPORT_RULES.itemMaxBytes - 64)}"]`, 65_536)))) as string[];
    expect(item!.length).toBe(IMPORT_RULES.itemMaxBytes - 64);
  });

  test("depth: 64 levels are kept, 65 refused, and 1,000,000 brackets refused at once", async () => {
    expect(IMPORT_RULES.itemMaxDepth).toBe(64);
    const nested = (levels: number) => "[" + "[".repeat(levels) + "]".repeat(levels) + "]";
    expect(await collect(streamArray(chunked(nested(64), 4_096)))).toHaveLength(1);
    await expect(collect(streamArray(chunked(nested(65), 4_096)))).rejects.toThrow(ItemTooLarge);
    const { source, state } = lazy("[", "[", 1_000_000, "]");
    await expect(collect(streamArray(source))).rejects.toThrow(ItemTooLarge);
    expect(state.pulled).toBeLessThan(200_000);
  });
});

describe("afterPrefix", () => {
  const PATTERN = /^window[.]YTD[.][a-z_]+[.]part[0-9]+ = $/;

  test("drops a prefix that matches exactly and passes the rest through", async () => {
    const out = await collect(afterPrefix(chunked("window.YTD.tweets.part0 = [1, 2]", 5), PATTERN));
    expect(Buffer.concat(out as Uint8Array[]).toString("utf8")).toBe("[1, 2]");
  });

  test("refuses another prefix, a prefix that is too long, and a file without one", async () => {
    await expect(collect(afterPrefix(chunked("window.YTD.Tweets.part0 = []"), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked("window.YTD.tweets.part0 =[]"), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked(`window.YTD.${"a".repeat(400)}.part0 = []`), PATTERN))).rejects.toThrow(NotJson);
    await expect(collect(afterPrefix(chunked("[1, 2]"), PATTERN))).rejects.toThrow(NotJson);
  });
});
```

### Create `apps/importer/test/lab/README.md`

```markdown
# The importer's labs

Four labs measure the importer against archives they build themselves (3b design, section 12.5): `zip-bomb.lab.ts`,
`json-bomb.lab.ts`, `traversal.lab.ts` and `large-archive.lab.ts`, the importer's half of the large-archive lab (the
API's intake of 50,000 lines within its 512m is Task 4's). No lab reads a real archive: `tool.ts` writes every one of
them, a chunk at a time, with the canaries of section 12 where a person's private data would be.

## Running them

From the repository's root, in the importer Dockerfile's build stage (the runtime stage holds only `dist/`), with the
importer's own limits and a read-only root:

    docker build -f apps/importer/Dockerfile --target build -t korbat2b-importer-build .
    docker run --rm --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m -v korbat2b-importer-lab:/lab -e LAB_DIR=/lab korbat2b-importer-build pnpm --filter @korbat/importer test:lab
    docker volume rm korbat2b-importer-lab

In Git Bash on Windows, put `MSYS_NO_PATHCONV=1` before `docker run`, or `/lab` becomes a Windows path. No suite
includes the labs: their files end in `.lab.ts`, which only `vitest.lab.config.ts` includes, and each file runs in a
fork of its own, one at a time. The whole run takes about 25 minutes at half a processor; most of it is building and
reading the two CARs. A single file runs with its path after `test:lab`.

Without Docker, `pnpm --filter @korbat/importer test:lab` runs them on the host with `LAB_DIR` (default: a folder of
the system's temporary one); the symbolic-link case skips where links cannot be made (Windows without Developer Mode).

## Where things go

- **The lab volume.** Section 12.5 names none, and the read-only root leaves only 16 MB of `/tmp`, so a named volume,
  `korbat2b-importer-lab`, is mounted at `/lab` (`LAB_DIR`). It holds the bundled tool, every generated archive, the two
  volumes each scan reads and writes (`run-<uuid>/archives` and `run-<uuid>/work`, deleted after each case), Vite's cache,
  and the record.
- **The configuration.** `test:lab` loads `vitest.lab.config.ts` with `--configLoader runner`, which writes no bundled
  copy of it next to `node_modules` (the root is read-only), and the configuration puts Vite's cache under `LAB_DIR`.
- **The record.** Each measurement is one line of JSON in `/lab/lab-importer.jsonl`, also printed in the run's output.

## How a scan is measured

Each lab bundles `tool.ts` into the lab volume with esbuild, as `build.mjs` bundles the importer, and runs every
generator and every scan with it in a process of its own, so the vitest processes stay small and a scan's memory is its
own. `tool.mjs scan` takes a collection (`--expose-gc`), reads `process.memoryUsage().rss`, runs the importer's own
`scanJob` on one job, and then reads `process.resourceUsage().maxRSS` (kilobytes, the process's peak resident set):
**peak** is that maximum less the RSS before the scan, the most the scan added. **ms** is `performance.now()` around
`scanJob`. A Node process holds about 75 MB before it scans anything (`rssBefore`).

## The numbers of 2026-10-26

The scratch clone's build stage on Docker Desktop's Linux VM (the host a shared Windows machine), with the importer's
limits: `--memory 512m --cpus 0.5`, a read-only root and no network. All sixteen cases passed; the run took 22.7 minutes.

### zip-bomb.lab.ts: each refused within 5 seconds and under 64 MB

| archive | what it is | refused as | ms | peak |
|---|---|---|---|---|
| overlap-terabytes.zip | 10 MB; 99 allowlisted entries whose local records all lie in one region, each declaring 1 TiB (ZIP64) | too_large_uncompressed | 118 | 0.9 MB |
| overlap-within-limits.zip | 10 MB; four overlapping entries of 1,000,000,000 bytes each (ratio 96, the sum under 4 GiB) | unreadable | 101 | 0.4 MB |
| ratio-bomb.zip | 2 MB; tweets.js declares 100 MB (ratio about 50) and inflates to 2 GiB of spaces | unreadable | 3,507 | 3.3 MB |
| million-entries.zip | 103 MB; a central directory of 1,000,001 entries (ZIP64 count) | too_many_entries | 99 | 0.7 MB |
| zip64-offset-past-end.zip | the ZIP64 end record puts the directory 1 TiB past the file | unreadable | 25 | 0.4 MB |
| zip64-size-lies.zip | tweets.js's ZIP64 extra declares 2^62 bytes | too_large_uncompressed | 104 | 0.8 MB |
| zip64-entry-offset-lies.zip | tweets.js's ZIP64 extra puts its local header at 2^45 | unreadable | 107 | 0.9 MB |

- The overlapping bombs never inflate a byte: the first is refused by a data file's 1 GiB, the second by the overlap of
  the allowlisted ranges, both from the central directory and the local headers alone.
- The ratio bomb is the slowest: it inflates 100 MB of spaces through the JSON tokenizer before the 100,000,001st byte
  stops it, at half a processor.

### json-bomb.lab.ts: each refused item_too_large within 5 seconds and under 64 MB

Each X archive holds one ordinary tweet and then the bomb in `tweets.js` (stored, so the ratio is 1 and the bomb reaches
the parser). The ordinary tweet is kept (posts 1), the bomb counted `item_too_large`, and the rest of the file is not
read.

| archive | the bomb | ms | peak |
|---|---|---|---|
| string-900mb.zip | a 900 MB string | 226 | 3.9 MB |
| depth-million.zip | 1,000,000 nested brackets | 198 | 2.5 MB |
| key-500mb.zip | a 500 MB key | 216 | 3.3 MB |

### traversal.lab.ts: refused or ignored, nothing written outside jobs/<id>/

| case | result | ms | peak |
|---|---|---|---|
| crafted-names.zip, images on: `..` segments, a leading slash, a drive letter, backslashes, a NUL, 513 bytes, an empty and a `.` segment, a media name with `..` in it, and symbolic links to /etc/passwd under a kept post's media name and under data/note-tweet.js | scanned: 2 posts, the linked image counted missing_file; the work volume holds only jobs/<id>/posts.jsonl, summary.json and attempts/<id>; the archives volume is unchanged; no file holds /etc/passwd's first line | 128 | 2.0 MB |
| the archive itself a symbolic link to /etc/passwd | failed: unreadable (openWorkFile refuses the link) | 27 | 0.8 MB |

### large-archive.lab.ts: each within the 30-minute watchdog, peak under 400 MB

| archive | size | result | ms | peak |
|---|---|---|---|---|
| X: 60,000 tweets in a tweets.js of 369 MiB (deflated), 5,000 images of 360,000 bytes, images on | 1,902 MiB (1.86 GiB) | 50,000 posts and 5,000 images written, over_post_cap 10,000 | 158,224 (2.6 min) | 61.4 MB |
| Mastodon: an outbox of 50,000 Notes | 1.9 MiB | 50,000 posts | 49,608 | 34.3 MB |
| Bluesky: a CAR of 2,000,000 blocks, 897,195 of its records posts | 446.5 MiB | 50,000 posts, over_post_cap 847,195 | 309,919 (5.2 min) | 148.5 MB |
| Bluesky: a CAR of 1,180,000 blocks, 1,102,803 of them posts | 258.6 MiB | read in part: 1,000,000 items read, over_item_cap 1, 50,000 posts, over_post_cap 950,000 | 410,124 (6.8 min) | 77.6 MB |

- The X archive is about 1.86 GiB rather than 1.9, so that it stays within `IMPORT_RULES.maxBytes` (2 GiB), which the
  importer's opener enforces. The 5,000 images are the newest 5,000 tweets', all kept; the scan copies 1.7 GiB of them.
- The first run, before `detach()` copied the source ids the heap keeps, ran out of the container's JavaScript heap on
  the X archive: each id the tokenizer made was a slice of its 64 KB chunk of tweets.js and kept the chunk alive (633 MB
  of peak on the host). After the copy the same scan's peak is in the table.
- The large CAR is a repository's mix: posts beside likes (whose keys sort first and which are never decoded) under a
  16-way MST, and the commit, made up to exactly 2,000,000 blocks with unreferenced blocks. The index of 2,000,000
  blocks is keyed by 8 bytes of each digest in typed arrays.
- The second CAR is all posts, more than `IMPORT_RULES.maxItems`: the read stops at 1,000,000 items (over_item_cap 1,
  read in part) and keeps the newest 50,000 of those it read.
```

### Create `apps/importer/test/lab/json-bomb.lab.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LAB_DIR, buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The JSON-bomb lab (3b design, 12.5): one 900 MB string, a depth of 1,000,000 brackets and a key of 500 MB in X's
 * tweets.js, each after one ordinary tweet. Each is refused item_too_large within 5 seconds and under 64 MB of memory;
 * the tweet before it is kept, and the rest of the file is not read (the assembler cannot resume after an element it
 * did not hold).
 */

const MB = 1_048_576;
const bombs = path.join(LAB_DIR, `json-bombs-${randomUUID()}`);

beforeAll(async () => {
  await buildTool();
  mkdirSync(bombs, { recursive: true });
  await runTool(["json-bombs", bombs]);
});

afterAll(() => rmSync(bombs, { recursive: true, force: true }));

describe.each(["string-900mb.zip", "depth-million.zip", "key-500mb.zip"])("%s", (file) => {
  test("is refused item_too_large within 5 seconds and under 64 MB", async () => {
    const volumes = labVolumes();
    const archive = volumes.archives.archive(volumes.id);
    renameSync(path.join(bombs, file), archive);
    writeJob(volumes, "x", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("json-bomb", file, bytes, result);
    removeRun(volumes);
    expect(result.summary).toMatchObject({ status: "scanned", posts: 1, skipped: { item_too_large: 1 } });
    expect(result.ms).toBeLessThan(5_000);
    expect(result.peak).toBeLessThan(64 * MB);
  });
});
```

### Create `apps/importer/test/lab/large-archive.lab.ts`

```ts
import { beforeAll, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The large-archive lab, the importer's half (3b design, 12.5): a generated X archive of about 1.9 GiB (60,000 tweets
 * in a tweets.js of about 400 MB, 5,000 images), a Mastodon outbox of 50,000 Notes, and a CAR of 2,000,000 blocks. Each
 * scans within the 30-minute watchdog with a peak memory under 400 MB. The API's intake of 50,000 lines within its 512m
 * is Task 4's half of this lab.
 */

const MB = 1_048_576;
const PEAK = 400 * MB;

beforeAll(async () => {
  await buildTool();
});

test("an X archive of about 1.9 GiB: 60,000 tweets, the newest 50,000 kept with their 5,000 images", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    const made = await runTool<{ tweetsBytes: number }>(["x-large", archive]);
    console.log(JSON.stringify({ tweetsJsMb: Math.round(made.tweetsBytes / MB) }));
    writeJob(volumes, "x", true);
    const bytes = sizeOf(archive);
    expect(bytes).toBeLessThanOrEqual(IMPORT_RULES.maxBytes);
    const result = await measure(volumes);
    record("large-archive", "x-60000-tweets-5000-images", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: IMPORT_RULES.maxPosts, images: IMPORT_RULES.maxImages, skipped: { over_post_cap: 10_000 } });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("a Mastodon outbox of 50,000 Notes", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    await runTool(["mastodon-large", archive]);
    writeJob(volumes, "mastodon", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "mastodon-50000-notes", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: 50_000 });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("a CAR of 2,000,000 blocks: about 900,000 posts beside likes that are never decoded", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    const made = await runTool<{ blocks: number; posts: number }>(["car-large", archive, String(IMPORT_RULES.carMaxBlocks)]);
    expect(made.blocks).toBe(IMPORT_RULES.carMaxBlocks);
    writeJob(volumes, "bluesky", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "car-2000000-blocks", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: IMPORT_RULES.maxPosts, readInPart: false, skipped: { over_post_cap: made.posts - IMPORT_RULES.maxPosts } });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("the item cap: a CAR of 1,100,000 posts is read up to 1,000,000 items and marked read in part", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    await runTool(["car-large", archive, "1180000", "1"]);
    writeJob(volumes, "bluesky", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "car-item-cap", bytes, result);
    expect(result.summary).toMatchObject({
      status: "scanned",
      posts: IMPORT_RULES.maxPosts,
      readInPart: true,
      skipped: { over_item_cap: 1, over_post_cap: IMPORT_RULES.maxItems - IMPORT_RULES.maxPosts },
    });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});
```

### Create `apps/importer/test/lab/support.ts`

```ts
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import type { ImportSource, ImportSummary } from "@korbat/contracts";
import { archivesLayout, workLayout, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { ACCOUNT_KEY } from "../fixtures/canaries";

/**
 * What the importer's labs share (3b design, 12.5; test/lab/README.md): the lab folder (the named volume the Docker run
 * mounts at LAB_DIR, or a folder of the system's temporary one), the tool bundled into it, and one scan in a process of
 * its own whose time and peak memory are recorded, one line of JSON each, in <LAB_DIR>/lab-importer.jsonl.
 */

export const LAB_DIR = process.env.LAB_DIR ?? path.join(tmpdir(), "korbat-importer-lab");
const TOOL = path.join(LAB_DIR, "tool.mjs");
const MB = 1_048_576;
const LF = String.fromCharCode(10);

/** Bundles test/lab/tool.ts into the lab folder, as build.mjs bundles the importer. */
export async function buildTool(): Promise<void> {
  mkdirSync(LAB_DIR, { recursive: true });
  await build({
    entryPoints: [path.join(import.meta.dirname, "tool.ts")],
    outfile: TOOL,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "bundle",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
}

/** Runs the tool with `args` in a process of its own and returns its last line of output, parsed. */
export function runTool<T>(args: readonly string[], timeoutMs = 3_600_000): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--expose-gc", TOOL, ...args], { maxBuffer: 16 * MB, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`tool ${args[0]} failed: ${err.message} ${stderr}`));
      const lines = stdout.trim().split(LF);
      resolve(JSON.parse(lines.at(-1) ?? "null") as T);
    });
  });
}

export interface Volumes {
  root: string;
  archives: ArchivesLayout;
  work: WorkLayout;
}

/** Two fresh volumes under the lab folder, and an import id with its folder ready for an archive. */
export function labVolumes(): Volumes & { id: string } {
  const root = path.join(LAB_DIR, `run-${randomUUID()}`);
  const archives = archivesLayout(path.join(root, "archives"));
  const work = workLayout(path.join(root, "work"));
  for (const dir of [archives.jobs, archives.queue, archives.deletions, work.jobs, work.attempts, work.tmp]) mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  mkdirSync(archives.jobDir(id), { recursive: true });
  return { root, archives, work, id };
}

export function writeJob(volumes: Volumes & { id: string }, source: ImportSource, images: boolean): void {
  const { archives, id } = volumes;
  writeFileSync(archives.job(id), JSON.stringify({ v: 1, id, source, accountKey: ACCOUNT_KEY, images, createdAt: new Date().toISOString() }));
  writeFileSync(archives.queued(id), "");
}

export interface Measurement {
  outcome: string;
  ms: number;
  rssBefore: number;
  maxRss: number;
  peak: number;
  summary: ImportSummary | null;
}

/** One scan of the archive already at the job's path, in a process of its own. */
export function measure(volumes: Volumes & { id: string }): Promise<Measurement> {
  return runTool<Measurement>(["scan", volumes.archives.root, volumes.work.root, volumes.id]);
}

/** Every file under `dir`, relative to it, with forward slashes. */
export function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? [rel + "/", ...filesUnder(path.join(dir, entry.name), rel)] : [rel];
  });
}

export const megabytes = (bytes: number) => Math.round((bytes / MB) * 10) / 10;

/** Writes one measurement to the lab's record and to the run's output. */
export function record(lab: string, name: string, archiveBytes: number, measurement: Measurement): void {
  const line = {
    lab,
    name,
    at: new Date().toISOString(),
    archiveMb: megabytes(archiveBytes),
    outcome: measurement.outcome,
    failure: measurement.summary?.status === "failed" ? measurement.summary.failure : null,
    posts: measurement.summary?.status === "scanned" ? measurement.summary.posts : null,
    images: measurement.summary?.status === "scanned" ? measurement.summary.images : null,
    skipped: measurement.summary?.status === "scanned" ? measurement.summary.skipped : null,
    ms: measurement.ms,
    rssBeforeMb: megabytes(measurement.rssBefore),
    maxRssMb: megabytes(measurement.maxRss),
    peakMb: megabytes(measurement.peak),
  };
  appendFileSync(path.join(LAB_DIR, "lab-importer.jsonl"), JSON.stringify(line) + LF);
  console.log(JSON.stringify(line));
}

export const sizeOf = (file: string) => statSync(file).size;
export const removeRun = (volumes: Volumes) => rmSync(volumes.root, { recursive: true, force: true });
```

### Create `apps/importer/test/lab/tool.ts`

```ts
import { createHash, randomFillSync } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { constants, crc32, deflateRawSync } from "node:zlib";
import { CarWriter } from "@ipld/car/writer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import pino from "pino";
import { archivesLayout, workLayout } from "@korbat/import-protocol";
import { scanJob } from "../../src/scan";
import { CANARY, FIXTURE_DID } from "../fixtures/canaries";
import { createActivity, outboxJson } from "../fixtures/mastodon";
import { tweetObject, xManifest, type TweetSpec } from "../fixtures/x";
import { StreamingZip, repeatedDeflate } from "./zip-writer";

/**
 * The labs' tool (3b design, 12.5), bundled by the labs into the lab volume and run in processes of its own, so that the
 * vitest processes stay small and every scan's memory is its own: `scan` runs one scan and prints its time and memory;
 * the other commands write the archives the labs read, a chunk at a time. Every archive is built by code.
 *
 *   node tool.mjs scan <archives root> <work root> <id>
 *   node tool.mjs <zip-bombs | json-bombs | traversal | x-large | mastodon-large | car-large> <folder>
 */

const LF = String.fromCharCode(10);
const MB = 1_048_576;

/** A block of pseudo-random lowercase letters: text that neither compresses much nor holds a quote or an escape. */
function letters(length: number, seed = 1): Buffer {
  const out = Buffer.alloc(length);
  randomFillSync(out);
  for (let i = 0; i < length; i++) out[i] = 0x61 + (out[i]! % 26);
  if (seed < 0) out.reverse();
  return out;
}

function* repeat(block: Buffer, total: number): Generator<Buffer> {
  for (let sent = 0; sent < total; sent += block.length) yield sent + block.length <= total ? block : block.subarray(0, total - sent);
}

const PREFIX = "window.YTD.tweets.part0 = ";
const plainTweet = (n: number, text: string, extra: Partial<TweetSpec> = {}): TweetSpec => ({ id: String(1_500_000_000_000_000_000n + BigInt(n)), at: new Date(Date.UTC(2015, 0, 1) + n * 3_600_000).toISOString(), text, ...extra });

// ---- scan --------------------------------------------------------------------------------------------------------

async function scan(archivesRoot: string, workRoot: string, id: string): Promise<void> {
  const archives = archivesLayout(archivesRoot);
  const work = workLayout(workRoot);
  for (const dir of [work.jobs, work.attempts, work.tmp]) mkdirSync(dir, { recursive: true });
  const log = pino({ level: "silent" });
  // With --expose-gc, the baseline is taken after a collection.
  (globalThis as { gc?: () => void }).gc?.();
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const outcome = await scanJob({ archives, work, log }, id, new AbortController().signal);
  const ms = Math.round(performance.now() - started);
  // maxRSS is the process's peak resident set in kilobytes; the scan is all this process does after rssBefore.
  const maxRss = process.resourceUsage().maxRSS * 1024;
  const summary = existsSync(work.summary(id)) ? JSON.parse(readFileSync(work.summary(id), "utf8")) : null;
  process.stdout.write(JSON.stringify({ outcome, ms, rssBefore, maxRss, peak: maxRss - rssBefore, summary }) + LF);
}

// ---- zip bombs ---------------------------------------------------------------------------------------------------

const manifestEntry = () => ({ name: "data/manifest.js", data: Buffer.from(xManifest({}, ["data/tweets.js"].concat(Array.from({ length: 99 }, (_, i) => `data/tweets-part${i + 1}.js`)))) });

/** A local header with flag bit 3 (its CRC and sizes are the descriptor's), stored at `method`. */
function localHeader(name: string, method: number): Buffer {
  const raw = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE((1 << 3) | (1 << 11), 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(raw.length, 26);
  return Buffer.concat([header, raw]);
}

interface CentralSpec {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  /** Write the sizes and the offset in a ZIP64 extra field. */
  zip64?: boolean;
}

function centralRecord(spec: CentralSpec): Buffer {
  const raw = Buffer.from(spec.name, "utf8");
  const extra = Buffer.alloc(spec.zip64 ? 28 : 0);
  if (spec.zip64) {
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(spec.size), 4);
    extra.writeBigUInt64LE(BigInt(spec.compressed), 12);
    extra.writeBigUInt64LE(BigInt(spec.offset), 20);
  }
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE((1 << 3) | (1 << 11), 8);
  header.writeUInt16LE(spec.method, 10);
  header.writeUInt32LE(spec.crc >>> 0, 16);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.compressed, 20);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.size, 24);
  header.writeUInt16LE(raw.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(((0o100000 | 0o644) << 16) >>> 0, 38);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.offset, 42);
  return Buffer.concat([header, raw, extra]);
}

/** The end records: ZIP64 ones (count, size and offset in 64 bits, with `offsetLie` added to the offset) and the classic one. */
function endRecords(count: number, directorySize: number, directoryOffset: number, zip64: boolean, offsetLie = 0): Buffer {
  const parts: Buffer[] = [];
  const recordAt = directoryOffset + directorySize;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset + offsetLie), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(recordAt), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directorySize, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : directoryOffset, 16);
  parts.push(end);
  return Buffer.concat(parts);
}

/** The manifest as a stored entry with an honest local header, and its central record. */
function manifestRecords(): { local: Buffer; central: (offset: number) => Buffer } {
  const { name, data } = manifestEntry();
  const raw = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(1 << 11, 6);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(raw.length, 26);
  const local = Buffer.concat([header, raw, data]);
  return {
    local,
    central: (offset) => {
      const record = centralRecord({ name, method: 0, crc, compressed: data.length, size: data.length, offset });
      record.writeUInt16LE(1 << 11, 8);
      return record;
    },
  };
}

/**
 * The overlapping-files bomb: `count` allowlisted entries whose local headers all lie inside one region of `region`
 * bytes, every entry's data running to the region's end, each declaring `size` bytes (ZIP64 when it needs it).
 */
async function overlapBomb(file: string, count: number, region: number, size: (compressed: number) => number): Promise<void> {
  const manifest = manifestRecords();
  const start = manifest.local.length;
  const body = letters(region);
  const centrals: Buffer[] = [manifest.central(0)];
  const names = ["data/tweets.js", ...Array.from({ length: 98 }, (_, i) => `data/tweets-part${i + 1}.js`)].slice(0, count);
  names.forEach((name, i) => {
    const at = i * 100;
    localHeader(name, 8).copy(body, at);
    const dataStart = start + at + 30 + Buffer.byteLength(name);
    // Each entry's data runs to the region's end, less a descriptor's 12 bytes: every range overlaps every other.
    const compressed = start + region - 12 - dataStart;
    const declared = size(compressed);
    centrals.push(centralRecord({ name, method: 8, crc: 0, compressed, size: declared, offset: start + at, zip64: declared > 0xfffffffe }));
  });
  const central = Buffer.concat(centrals);
  const zip64 = centrals.length > 1 && names.length > 0;
  writeFileSync(file, Buffer.concat([manifest.local, body, central, endRecords(centrals.length, central.length, start + region, zip64)]));
}

async function zipBombs(dir: string): Promise<void> {
  // 1. A 10 MB file whose 99 overlapping entries declare a terabyte each.
  await overlapBomb(path.join(dir, "overlap-terabytes.zip"), 99, 10 * MB, () => 2 ** 40);
  // 2. The same overlap within every per-entry limit and the sum: four entries of 1,000,000,000 bytes, ratio 100.
  await overlapBomb(path.join(dir, "overlap-within-limits.zip"), 4, 10 * MB, (compressed) => Math.min(compressed * 100, 1_000_000_000));

  // 3. A ratio bomb within one entry: tweets.js declares 100 MB (ratio about 50) and inflates to 2 GiB of spaces.
  {
    const manifest = manifestRecords();
    const prefix = deflateRawSync(Buffer.from(PREFIX + "["), { finishFlush: constants.Z_FULL_FLUSH });
    const { stream } = await repeatedDeflate(Buffer.alloc(16 * MB, 0x20), 128);
    const compressed = prefix.length + stream.reduce((sum, part) => sum + part.length, 0);
    const local = localHeader("data/tweets.js", 8);
    const offset = manifest.local.length;
    const handle = await open(path.join(dir, "ratio-bomb.zip"), "w");
    let position = 0;
    const write = async (bytes: Buffer) => {
      await handle.write(bytes, 0, bytes.length, position);
      position += bytes.length;
    };
    await write(manifest.local);
    await write(local);
    await write(prefix);
    for (const part of stream) await write(part);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(100 * MB, 12);
    await write(descriptor);
    const central = Buffer.concat([manifest.central(0), centralRecord({ name: "data/tweets.js", method: 8, crc: 0, compressed, size: 100 * MB, offset })]);
    const directoryOffset = position;
    await write(central);
    await write(endRecords(2, central.length, directoryOffset, false));
    await handle.close();
  }

  // 4. A central directory of 1,000,000 entries, with their local records.
  {
    const count = 1_000_000;
    const out = createWriteStream(path.join(dir, "million-entries.zip"));
    const writeOut = (bytes: Buffer) =>
      new Promise<void>((resolve) => {
        if (out.write(bytes)) resolve();
        else out.once("drain", () => resolve());
      });
    const manifest = manifestRecords();
    await writeOut(manifest.local);
    let position = manifest.local.length;
    const name = (i: number) => `data/f${String(i).padStart(7, "0")}.js`;
    const empty = crc32(Buffer.alloc(0));
    let batch: Buffer[] = [];
    const flush = async () => {
      if (batch.length > 0) await writeOut(Buffer.concat(batch));
      batch = [];
    };
    for (let i = 0; i < count; i++) {
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(1 << 11, 6);
      header.writeUInt32LE(empty, 14);
      header.writeUInt16LE(16, 26);
      batch.push(header, Buffer.from(name(i)));
      if (batch.length >= 20_000) await flush();
    }
    await flush();
    position += count * 46;
    const directoryOffset = position;
    await writeOut(manifest.central(0));
    let directorySize = manifest.central(0).length;
    for (let i = 0; i < count; i++) {
      const record = centralRecord({ name: name(i), method: 0, crc: empty, compressed: 0, size: 0, offset: manifest.local.length + i * 46 });
      record.writeUInt16LE(1 << 11, 8);
      batch.push(record);
      directorySize += record.length;
      if (batch.length >= 20_000) await flush();
    }
    await flush();
    await writeOut(endRecords(count + 1, directorySize, directoryOffset, true));
    await new Promise<void>((resolve) => out.end(resolve));
  }

  // 5. ZIP64 records that lie: the directory's offset past the file, a size of 2^62, and an entry's offset past its directory.
  {
    const manifest = manifestRecords();
    const data = Buffer.from(PREFIX + "[]");
    const local = Buffer.concat([localHeader("data/tweets.js", 0), data]);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc32(data), 4);
    descriptor.writeUInt32LE(data.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    const body = Buffer.concat([manifest.local, local, descriptor]);
    const tweets = (overrides: Partial<CentralSpec>) =>
      centralRecord({ name: "data/tweets.js", method: 0, crc: crc32(data), compressed: data.length, size: data.length, offset: manifest.local.length, zip64: true, ...overrides });
    const write = (file: string, central: Buffer, offsetLie = 0) => writeFileSync(path.join(dir, file), Buffer.concat([body, central, endRecords(2, central.length, body.length, true, offsetLie)]));
    write("zip64-offset-past-end.zip", Buffer.concat([manifest.central(0), tweets({})]), 2 ** 40);
    write("zip64-size-lies.zip", Buffer.concat([manifest.central(0), tweets({ size: 2 ** 62 })]));
    write("zip64-entry-offset-lies.zip", Buffer.concat([manifest.central(0), tweets({ offset: 2 ** 45 })]));
  }
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- JSON bombs --------------------------------------------------------------------------------------------------

async function jsonBombs(dir: string): Promise<void> {
  const normal = JSON.stringify(tweetObject(plainTweet(1, "A normal post before the bomb")));
  const block = letters(MB);
  const archive = async (file: string, parts: () => Iterable<Buffer>) => {
    const zip = await StreamingZip.create(path.join(dir, file));
    await zip.add("data/manifest.js", [manifestEntry().data], 0);
    await zip.add("data/tweets.js", parts(), 0);
    await zip.finish();
  };
  await archive("string-900mb.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, {"tweet": {"id_str": "1", "full_text": "`);
    yield* repeat(block, 900 * MB);
    yield Buffer.from('"}}]');
  });
  await archive("depth-million.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, `);
    yield* repeat(Buffer.alloc(MB, "["), 1_000_000);
    yield* repeat(Buffer.alloc(MB, "]"), 1_000_000);
    yield Buffer.from("]");
  });
  await archive("key-500mb.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, {"`);
    yield* repeat(block, 500 * MB);
    yield Buffer.from('": 1}]');
  });
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- traversal ---------------------------------------------------------------------------------------------------

async function traversal(dir: string): Promise<void> {
  const { buildZip } = await import("../fixtures/zip");
  const photo = plainTweet(2, "A photo whose file is a symlink https://t.co/sym111", { media: [{ url: "https://t.co/sym111", file: "Fsym0001.jpg" }] });
  const tweets = [plainTweet(1, "A post beside crafted names"), photo];
  const NUL = String.fromCharCode(0);
  const BACKSLASH = String.fromCharCode(92);
  const crafted = [
    "../../../tmp/evil.txt",
    "../outbox.json",
    "/etc/cron.d/evil",
    "C:/evil.txt",
    `data${BACKSLASH}tweets.js`,
    `data${BACKSLASH}..${BACKSLASH}..${BACKSLASH}evil.txt`,
    `data/tweets.js${NUL}.txt`,
    "a".repeat(513),
    "data//tweets.js",
    "data/./tweets.js",
    "data/tweets_media/../../../../etc/passwd",
    "data/tweets_media/1500000000000000002-Fsym0001.jpg/../../../evil",
  ];
  const archive = buildZip([
    { name: "data/manifest.js", data: xManifest({}, ["data/tweets.js"]) },
    { name: "data/tweets.js", data: PREFIX + JSON.stringify(tweets.map(tweetObject)) },
    ...crafted.map((name) => ({ name: Buffer.from(name, "utf8"), data: `evil ${CANARY.private}` })),
    // Symbolic links, one under a media name a kept post names and one under an allowlisted data name: ignored, never opened.
    { name: "data/tweets_media/1500000000000000002-Fsym0001.jpg", data: "/etc/passwd", symlink: true, method: 0 },
    { name: "data/note-tweet.js", data: "/etc/passwd", symlink: true, method: 0 },
  ]);
  writeFileSync(path.join(dir, "crafted-names.zip"), archive);
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- large archives ----------------------------------------------------------------------------------------------

async function xLarge(file: string): Promise<void> {
  const tweets = 60_000;
  const images = 5_000;
  const imageBytes = 360_000;
  // About 6,700 bytes a tweet, as an archive's pretty-printed tweets with their entities weigh: 400 MB for 60,000. Each
  // tweet's padding is its own slice of a large random pool: one padding repeated would deflate far past the ratio of 100.
  const pool = letters(64 * MB).toString("latin1");
  const padding = (n: number) => {
    const at = (n * 5_207) % (pool.length - 5_200);
    return pool.slice(at, at + 5_200);
  };
  let tweetsBytes = 0;
  const zip = await StreamingZip.create(file);
  await zip.add("data/manifest.js", [Buffer.from(xManifest({}, ["data/tweets.js"]))], 0);
  await zip.add(
    "data/tweets.js",
    (function* () {
      yield Buffer.from(`${PREFIX}[` + LF);
      for (let n = 0; n < tweets; n++) {
        const withPhoto = n >= tweets - images;
        const spec = plainTweet(n, `Post number ${n} of the large archive, with a link https://t.co/l${n} and some words to read`, {
          urls: [{ url: `https://t.co/l${n}`, expanded: `https://example.com/${n}` }],
          ...(withPhoto ? { media: [{ url: `https://t.co/m${n}`, file: `F${String(n).padStart(8, "0")}.jpg` }] } : {}),
        });
        const object = tweetObject(spec) as { tweet: Record<string, unknown> };
        object.tweet.padding = padding(n);
        const bytes = Buffer.from((n > 0 ? "," + LF : "") + JSON.stringify(object, null, 2));
        tweetsBytes += bytes.length;
        yield bytes;
      }
      yield Buffer.from(LF + "]");
    })(),
    8,
  );
  const photo = Buffer.alloc(imageBytes);
  randomFillSync(photo);
  photo.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let n = tweets - images; n < tweets; n++) {
    const id = String(1_500_000_000_000_000_000n + BigInt(n));
    await zip.add(`data/tweets_media/${id}-F${String(n).padStart(8, "0")}.jpg`, [photo], 0);
  }
  await zip.add("data/direct-messages.js", [Buffer.from(`window.YTD.direct_messages.part0 = [{"text": "${CANARY.dm}"}]`)], 8);
  const size = await zip.finish();
  process.stdout.write(JSON.stringify({ file, size, tweetsBytes }) + LF);
}

async function mastodonLarge(file: string): Promise<void> {
  const notes = 50_000;
  const zip = await StreamingZip.create(file);
  await zip.add(
    "outbox.json",
    (function* () {
      const head = outboxJson([], false).replace('"orderedItems": []', '"orderedItems": [');
      yield Buffer.from(head.slice(0, head.lastIndexOf("[") + 1) + LF);
      for (let n = 0; n < notes; n++) {
        const at = new Date(Date.UTC(2017, 0, 1) + n * 3_600_000).toISOString();
        const activity = createActivity({ n: n % 100, at, content: `<p>Note number ${n} of the large outbox, with <a href="https://example.com/${n}">a link</a> &amp; an entity</p>` });
        (activity.object as Record<string, unknown>).id = `https://social.example/users/${CANARY.handle}/statuses/${200_000_000_000_000 + n}`;
        yield Buffer.from((n > 0 ? "," + LF : "") + JSON.stringify(activity));
      }
      yield Buffer.from(LF + "]}");
    })(),
    8,
  );
  await zip.add("actor.json", [Buffer.from(JSON.stringify({ type: "Person", preferredUsername: CANARY.handle }))], 8);
  const size = await zip.finish();
  process.stdout.write(JSON.stringify({ file, size }) + LF);
}

const SHA256 = 0x12;
function cborBlock(value: unknown): { cid: CID; bytes: Uint8Array } {
  const bytes = dagCbor.encode(value);
  return { cid: CID.create(1, dagCbor.code, Digest.create(SHA256, createHash("sha256").update(bytes).digest())), bytes };
}

/**
 * A repository of exactly `total` blocks: post records under a 16-way MST built top-down over index ranges (so no list
 * of leaves is ever held), the commit, and unreferenced blocks to make up the count. Every node holds up to 16 entries
 * and its subtrees are as full as the range allows, so the nodes are about a fifteenth of the records. Keys are
 * fixed-width, so index order is key order, and dates rise with the key, as TIDs do: every record is newer than the last.
 */
async function carLarge(file: string, total = 2_000_000, postShare = 0.48): Promise<void> {
  const fanout = 16;
  // The records and the nodes over them (about 7 in 100 of the records) and the commit stay under `total`. A share of the
  // records are posts; the rest are likes, whose keys sort before the posts' and which the importer never decodes.
  const records = Math.floor((total - 1) / 1.07);
  const posts = Math.floor(records * postShare);
  const likes = records - posts;
  const placeholder = cborBlock({ placeholder: true }).cid;
  const { writer, out } = CarWriter.create([placeholder]);
  const stream = createWriteStream(file);
  const piped = (async () => {
    for await (const chunk of out) if (!stream.write(chunk)) await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
    await new Promise<void>((resolve) => stream.end(resolve));
  })();
  let blocks = 0;
  const put = async (block: { cid: CID; bytes: Uint8Array }) => {
    blocks++;
    await writer.put(block);
  };
  const encoder = new TextEncoder();
  const key = (i: number) => (i < likes ? `app.bsky.feed.like/3l${String(i).padStart(11, "0")}` : `app.bsky.feed.post/3l${String(i - likes).padStart(11, "0")}`);
  const record = async (i: number) => {
    const createdAt = new Date(Date.UTC(2023, 0, 1) + i * 60_000).toISOString();
    const value =
      i < likes
        ? { $type: "app.bsky.feed.like", subject: { uri: `at://did:plc:someoneelse234567abcdefg/app.bsky.feed.post/3k${i}`, cid: "bafyrei" }, createdAt }
        : { $type: "app.bsky.feed.post", text: `Post ${i - likes} of the large repository bsky.app/profile/${CANARY.handle}`, createdAt, langs: ["en"] };
    const block = cborBlock(value);
    await put(block);
    return block.cid;
  };
  const shared = (a: Uint8Array, b: Uint8Array) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  /** How many records a tree of `height` levels holds when full: 16 entries a node, 17 subtrees under each. */
  const capacity = (height: number): number => (height <= 1 ? fanout : fanout + (fanout + 1) * capacity(height - 1));
  const node = async (lo: number, hi: number): Promise<CID | null> => {
    if (hi <= lo) return null;
    const lifted: number[] = [];
    if (hi - lo <= fanout) for (let i = lo; i < hi; i++) lifted.push(i);
    else {
      let height = 2;
      while (capacity(height) < hi - lo) height++;
      const below = capacity(height - 1);
      for (let at = lo + below; at < hi && lifted.length < fanout; at += below + 1) lifted.push(at);
    }
    const left = await node(lo, lifted[0]!);
    let previous = new Uint8Array(0);
    const entries = [];
    for (const [index, at] of lifted.entries()) {
      const k = encoder.encode(key(at));
      const p = shared(previous, k);
      previous = k;
      const v = await record(at);
      const t = await node(at + 1, lifted[index + 1] ?? hi);
      entries.push({ k: k.subarray(p), p, t, v });
    }
    const block = cborBlock({ e: entries, l: left });
    await put(block);
    return block.cid;
  };
  const data = await node(0, records);
  const commit = cborBlock({ did: FIXTURE_DID, version: 3, data, rev: "3lcommitrev01", prev: null, sig: new Uint8Array(64) });
  await put(commit);
  for (let i = 0; blocks < total; i++) await put(cborBlock({ $type: "app.bsky.feed.like", n: i }));
  await writer.close();
  await piped;
  const handle = await open(file, "r+");
  await CarWriter.updateRootsInFile(handle, [commit.cid]);
  await handle.close();
  process.stdout.write(JSON.stringify({ file, blocks, records, posts, likes }) + LF);
}

// ---- main --------------------------------------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
const commands: Record<string, (...args: string[]) => Promise<void>> = {
  scan: (archivesRoot, workRoot, id) => scan(archivesRoot!, workRoot!, id!),
  "zip-bombs": (dir) => zipBombs(dir!),
  "json-bombs": (dir) => jsonBombs(dir!),
  traversal: (dir) => traversal(dir!),
  "x-large": (file) => xLarge(file!),
  "mastodon-large": (file) => mastodonLarge(file!),
  "car-large": (file, total, share) => carLarge(file!, total ? Number(total) : undefined, share ? Number(share) : undefined),
};
const run = commands[command ?? ""];
if (!run) {
  process.stderr.write(`unknown command ${command ?? ""}` + LF);
  process.exit(2);
}
await run(...args);
```

### Create `apps/importer/test/lab/traversal.lab.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { LAB_DIR, buildTool, filesUnder, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The traversal lab (3b design, 12.5): every crafted name of 12.1 (.., a leading slash, a drive letter, a backslash, a
 * NUL, 513 bytes, an empty and a `.` segment, a media name with .. in it) and symbolic links to /etc/passwd inside the
 * archive, and an archive that is itself a symbolic link to /etc/passwd. Each is refused or ignored, and nothing is
 * written outside jobs/<id>/ of the work volume.
 */

const dir = path.join(LAB_DIR, `traversal-${randomUUID()}`);
const PASSWD = "/etc/passwd";

beforeAll(async () => {
  await buildTool();
  mkdirSync(dir, { recursive: true });
  await runTool(["traversal", dir]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("crafted names and symbolic links in the archive are ignored; nothing is written outside jobs/<id>/", async () => {
  const volumes = labVolumes();
  const { archives, work, id } = volumes;
  renameSync(path.join(dir, "crafted-names.zip"), archives.archive(id));
  writeJob(volumes, "x", true);
  const archivesBefore = filesUnder(archives.root).sort();
  const bytes = sizeOf(archives.archive(id));
  const result = await measure(volumes);
  record("traversal", "crafted-names.zip", bytes, result);
  try {
    expect(result.summary).toMatchObject({ status: "scanned", posts: 2, images: 0, imagesSkipped: { missing_file: 1 } });
    // The work volume holds the job's two files and the attempt counter, and an empty tmp/.
    expect(filesUnder(work.root).sort()).toEqual(["attempts/", `attempts/${id}`, "jobs/", `jobs/${id}/`, `jobs/${id}/posts.jsonl`, `jobs/${id}/summary.json`, "tmp/"].sort());
    // The archives volume is as the API left it (the importer mounts it read-only).
    expect(filesUnder(archives.root).sort()).toEqual(archivesBefore);
    // No file anywhere on either volume holds what a followed link would have copied.
    const secret = existsSync(PASSWD) ? readFileSync(PASSWD, "utf8").split(String.fromCharCode(10))[0]! : "root:x:0:0";
    for (const file of filesUnder(volumes.root).filter((name) => !name.endsWith("/"))) {
      const full = path.join(volumes.root, file);
      if (statSync(full).size < 64 * 1_048_576) expect(readFileSync(full, "utf8").includes(secret), file).toBe(false);
    }
    for (const outside of ["/tmp/evil.txt", "/etc/cron.d/evil", path.join(LAB_DIR, "evil.txt"), path.join(work.root, "evil")]) expect(existsSync(outside), outside).toBe(false);
  } finally {
    removeRun(volumes);
  }
});

test("an archive that is a symbolic link to /etc/passwd is refused without being read", async (context) => {
  const volumes = labVolumes();
  try {
    symlinkSync(PASSWD, volumes.archives.archive(volumes.id));
  } catch (err) {
    // Without the right to make symbolic links (Windows without Developer Mode) there is nothing to test.
    removeRun(volumes);
    if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") return context.skip();
    throw err;
  }
  writeJob(volumes, "x", false);
  const result = await measure(volumes);
  record("traversal", "archive-symlink", 0, result);
  removeRun(volumes);
  expect(result.summary).toEqual({ v: 1, id: volumes.id, status: "failed", failure: "unreadable" });
});
```

### Create `apps/importer/test/lab/zip-bomb.lab.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LAB_DIR, buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The zip-bomb lab (3b design, 12.5): the overlapping-files bomb (a 10 MB file declaring terabytes, and the same
 * overlap within every per-entry limit), a ratio bomb within one entry, a central directory of 1,000,000 entries, and
 * ZIP64 records that lie about sizes and offsets. Each is refused within 5 seconds and under 64 MB of memory.
 */

const MB = 1_048_576;
const bombs = path.join(LAB_DIR, `zip-bombs-${randomUUID()}`);

beforeAll(async () => {
  await buildTool();
  mkdirSync(bombs, { recursive: true });
  await runTool(["zip-bombs", bombs]);
});

afterAll(() => rmSync(bombs, { recursive: true, force: true }));

const cases: [string, string][] = [
  ["overlap-terabytes.zip", "too_large_uncompressed"],
  ["overlap-within-limits.zip", "unreadable"],
  ["ratio-bomb.zip", "unreadable"],
  ["million-entries.zip", "too_many_entries"],
  ["zip64-offset-past-end.zip", "unreadable"],
  ["zip64-size-lies.zip", "too_large_uncompressed"],
  ["zip64-entry-offset-lies.zip", "unreadable"],
];

describe.each(cases)("%s", (file, failure) => {
  test(`is refused (${failure}) within 5 seconds and under 64 MB`, async () => {
    const volumes = labVolumes();
    const archive = volumes.archives.archive(volumes.id);
    renameSync(path.join(bombs, file), archive);
    writeJob(volumes, "x", true);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("zip-bomb", file, bytes, result);
    removeRun(volumes);
    expect(result.summary).toEqual({ v: 1, id: volumes.id, status: "failed", failure });
    expect(result.ms).toBeLessThan(5_000);
    expect(result.peak).toBeLessThan(64 * MB);
  });
});
```

### Create `apps/importer/test/lab/zip-writer.ts`

```ts
import { open, type FileHandle } from "node:fs/promises";
import { constants, createDeflateRaw, crc32 } from "node:zlib";

/**
 * A streaming zip writer for the labs (3b design, 12.5): archives of gigabytes written to disk a chunk at a time, every
 * entry with a data descriptor (flag bit 3, as Java's ZipOutputStream writes them), and a raw writer for the crafted
 * records of the bombs. The unit tests' writer (test/fixtures/zip.ts) holds an archive in memory; this one never does.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
const FLAG_DESCRIPTOR = 1 << 3;
const FLAG_UTF8 = 1 << 11;
const MADE_BY_UNIX = (3 << 8) | 30;
const S_IFREG = 0o100000;

interface Written {
  name: Buffer;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

export class StreamingZip {
  private position = 0;
  private readonly entries: Written[] = [];

  private constructor(private readonly handle: FileHandle) {}

  static async create(file: string): Promise<StreamingZip> {
    return new StreamingZip(await open(file, "w"));
  }

  async raw(bytes: Uint8Array): Promise<void> {
    await this.handle.write(bytes, 0, bytes.length, this.position);
    this.position += bytes.length;
  }

  private localHeader(name: Buffer, method: number): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_DESCRIPTOR | FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name]);
  }

  /** One entry from `chunks`, stored (0) or deflated (8) at level 1. */
  async add(name: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, method: 0 | 8 = 8): Promise<void> {
    const rawName = Buffer.from(name, "utf8");
    const offset = this.position;
    await this.raw(this.localHeader(rawName, method));
    let crc = 0;
    let size = 0;
    const start = this.position;
    if (method === 0) {
      for await (const chunk of chunks) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await this.raw(chunk);
      }
    } else {
      const deflater = createDeflateRaw({ level: 1 });
      const output: Buffer[] = [];
      deflater.on("data", (chunk: Buffer) => output.push(chunk));
      const flushOut = async () => {
        while (output.length > 0) await this.raw(output.shift()!);
      };
      for await (const chunk of chunks) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        await new Promise<void>((resolve, reject) => deflater.write(chunk, (err) => (err ? reject(err) : resolve())));
        await flushOut();
      }
      const ended = new Promise<void>((resolve, reject) => {
        deflater.once("end", resolve);
        deflater.once("error", reject);
      });
      deflater.end();
      await ended;
      await flushOut();
    }
    const compressed = this.position - start;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.raw(descriptor);
    this.entries.push({ name: rawName, method, crc: crc >>> 0, compressed, size, offset });
  }

  /** The central directory and the end record. */
  async finish(): Promise<number> {
    const directoryOffset = this.position;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL, 0);
      header.writeUInt16LE(MADE_BY_UNIX, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(FLAG_DESCRIPTOR | FLAG_UTF8, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(((S_IFREG | 0o644) << 16) >>> 0, 38);
      header.writeUInt32LE(entry.offset, 42);
      await this.raw(Buffer.concat([header, entry.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.position - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    await this.raw(end);
    await this.handle.close();
    return this.position;
  }
}

/** A raw deflate stream that inflates to `copies` times `block`, built from one compressed block: a ratio bomb's kernel. */
export async function repeatedDeflate(block: Buffer, copies: number): Promise<{ stream: Buffer[]; inflated: number }> {
  const { deflateRawSync } = await import("node:zlib");
  // A full flush ends each segment on a byte boundary with no reference to earlier data, so segments can be repeated.
  const segment = deflateRawSync(block, { level: 9, finishFlush: constants.Z_FULL_FLUSH });
  const last = deflateRawSync(Buffer.alloc(0));
  return { stream: [...Array.from({ length: copies }, () => segment), last], inflated: block.length * copies };
}
```

### Create `apps/importer/test/log.test.ts`

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { runScan, workspace } from "./fixtures/harness";
import { MASTODON_NOTES, buildMastodonArchive, outboxJson, type NoteSpec } from "./fixtures/mastodon";

/**
 * What the importer logs (3b design, 7.1): the job id, the phase, timings, the failure code, the counts by reason once
 * at the end, and a line per item only for unreadable and item_too_large (its reason and its index in the stream).
 * Never a text, a description, an entry name, a source id, a handle or a DID, and never an error's message, which a
 * parser or zlib may build from the input. This source scan refuses any log call that could carry one.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const LEVELS = "fatal|error|warn|info|debug|trace";
/** The only field names a log call may use. */
export const ALLOWED_FIELDS = [
  "id",
  "phase",
  "ms",
  "failure",
  "code",
  "error",
  "reason",
  "index",
  "attempts",
  "posts",
  "images",
  "skipped",
  "imagesSkipped",
  "cleaned",
  "warnings",
  "sourceLinks",
  "protectedPosts",
  "readInPart",
  "refusedNames",
  "signal",
];
/** Words a value may not name: what the archive holds, and an error's own text. */
const FORBIDDEN_WORDS = /(?<![A-Za-z0-9_])(message|stack|text|entry|entries|name|names|sourceId|parentId|did|handle|alt|href|uri|url|file|path|key|content|record|err)(?![A-Za-z0-9_])/;

export interface SourceFile {
  path: string;
  source: string;
}

/** The text of a call's arguments, from just after its opening parenthesis to the matching one. */
function argumentsAt(source: string, open: number): string {
  let depth = 1;
  let at = open + 1;
  let quote: string | null = null;
  for (; at < source.length && depth > 0; at++) {
    const c = source[at]!;
    if (quote) {
      if (c === String.fromCharCode(92)) at++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
  }
  return source.slice(open + 1, at - 1);
}

/** Splits `a, b: c(d, e), f` at its top-level commas. */
function topLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

export function violations(files: readonly SourceFile[]): string[] {
  const found: string[] = [];
  const call = new RegExp(`(?<![A-Za-z0-9_])log[ ]*[.][ ]*(${LEVELS})[ ]*[(]`, "g");
  for (const file of files) {
    for (const match of file.source.matchAll(call)) {
      const args = topLevel(argumentsAt(file.source, match.index + match[0].length - 1));
      const where = `${file.path}: log.${match[1]}`;
      const message = args.at(-1) ?? "";
      if (!/^"[^"`$]*"$/.test(message)) found.push(`${where}: the message is not a plain string`);
      if (args.length > 2) found.push(`${where}: too many arguments`);
      if (args.length === 2) {
        const fields = args[0]!;
        if (!fields.startsWith("{") || !fields.endsWith("}")) {
          found.push(`${where}: the fields are not an object literal`);
          continue;
        }
        for (const property of topLevel(fields.slice(1, -1))) {
          const [name, ...rest] = property.split(":");
          const field = name!.trim();
          const value = rest.join(":").trim() || field;
          if (!ALLOWED_FIELDS.includes(field)) found.push(`${where}: the field ${field} is not allowed`);
          // A plain word in quotes (a phase's name) is fine; any other quote, or a forbidden word, is not.
          const literal = /^"[A-Za-z0-9_ -]*"$/.test(value);
          if (!literal && (/["'`]/.test(value) || FORBIDDEN_WORDS.test(value))) found.push(`${where}: the field ${field} may carry the archive's words`);
        }
      }
    }
  }
  return found;
}

function sourceFiles(dir: string, prefix = ""): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".ts") ? [{ path: rel, source: readFileSync(path.join(dir, entry.name), "utf8") }] : [];
  });
}

describe("the source scan", () => {
  test("the importer's source has no log call that could carry the archive's words", () => {
    const files = sourceFiles(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(10);
    expect(violations(files)).toEqual([]);
    // The scan sees the calls it is meant to see.
    expect(files.some((file) => /(?<![A-Za-z0-9_])log[.](info|warn|error)[(]/.test(file.source))).toBe(true);
  });

  test("it refuses fields outside the list, an error object, an archive's words and a built message", () => {
    const files: SourceFile[] = [
      { path: "a.ts", source: 'deps.log.info({ id, text: draft.text }, "kept");' },
      { path: "b.ts", source: 'log.error({ id, err }, "failed");' },
      { path: "c.ts", source: 'log.warn({ id, reason: item.entry }, "skipped");' },
      { path: "d.ts", source: "log.info({ id }, `scanned ${name}`);" },
      { path: "e.ts", source: 'this.log.debug({ id, error: err.message }, "x");' },
      { path: "f.ts", source: 'log.info(draft, "kept");' },
      { path: "ok.ts", source: 'log.info({ id, phase: "read", ms: now() - started, skipped: counts.skipped }, "scan ended"); log.warn({ id, reason, index }, "item skipped");' },
    ];
    expect(violations(files)).toEqual([
      "a.ts: log.info: the field text is not allowed",
      "a.ts: log.info: the field text may carry the archive's words",
      "b.ts: log.error: the field err is not allowed",
      "b.ts: log.error: the field err may carry the archive's words",
      "c.ts: log.warn: the field reason may carry the archive's words",
      "d.ts: log.info: the message is not a plain string",
      "e.ts: log.debug: the field error may carry the archive's words",
      "f.ts: log.info: the fields are not an object literal",
    ]);
  });
});

describe("no log line for a skipped item", async () => {
  const ws = workspace();
  afterAll(() => ws.remove());
  const linesFor = async (notes: NoteSpec[]) => (await runScan(ws.dir, { source: "mastodon", archive: buildMastodonArchive({ outbox: outboxJson(notes, false) }) })).logs;
  const kept = MASTODON_NOTES.public;
  const privates = Array.from({ length: 50 }, (_, i) => ({ ...MASTODON_NOTES.private, n: 60 + i }));
  const baseline = await linesFor([kept]);
  const many = await linesFor([kept, ...privates, MASTODON_NOTES.question, MASTODON_NOTES.tooOld]);

  test("fifty private posts, a poll and an old post add no line", () => {
    expect(many.length).toBe(baseline.length);
    const parsed = many.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.filter((line) => "index" in line)).toEqual([]);
    expect(parsed.at(-1)).toMatchObject({ skipped: { not_public: 50, poll: 1, date_out_of_range: 1 } });
  });

  test("every line names only allowed fields", () => {
    for (const line of many) {
      const fields = Object.keys(JSON.parse(line) as object).filter((field) => !["level", "time", "msg"].includes(field));
      for (const field of fields) expect(ALLOWED_FIELDS).toContain(field);
    }
  });
});
```

### Create `apps/importer/test/loop.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ImporterHeartbeat, SCAN_MAX_ATTEMPTS } from "@korbat/import-protocol";
import { prepareWork, tick, writeHeartbeat, type LoopDeps } from "../src/loop";
import { scanJob, type ScanOutcome } from "../src/scan";
import { capturingLogger, placeJob, readOutput, volumes, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";

/** The importer's loop (7.1): attempts, the third start, deletion requests, the order of the files, the watchdog. */

const ws = workspace();
afterAll(() => ws.remove());

function harness(overrides: Partial<LoopDeps> = {}) {
  const { archives, work } = volumes(ws.dir);
  const { log, lines } = capturingLogger();
  const aborted: string[] = [];
  const deps: LoopDeps = {
    archives,
    work,
    log,
    now: () => 1_800_000_000_000,
    idleMs: 5,
    watchdogMs: 60_000,
    abort: (reason) => void aborted.push(reason),
    ...overrides,
  };
  return { deps, archives, work, logs: lines, aborted };
}

const mastodon = buildMastodonArchive();

describe("a scan through the loop", () => {
  test("a queued archive is scanned once: the attempt is counted, the summary written, the next tick idle", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    expect(await tick(h.deps)).toBe(true);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe("1");
    expect(readOutput(h.work, id).summary).toMatchObject({ status: "scanned", posts: 14 });
    expect(await tick(h.deps)).toBe(false);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe("1");
    expect(readdirSync(h.work.tmp)).toEqual([]);
  });

  test("the oldest queue marker goes first, one archive a tick", async () => {
    const h = harness();
    await prepareWork(h.work);
    const late = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    const early = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    utimesSync(h.archives.queued(late), new Date(2_000_000), new Date(2_000_000));
    utimesSync(h.archives.queued(early), new Date(1_000_000), new Date(1_000_000));
    await tick(h.deps);
    expect(existsSync(h.work.summary(early))).toBe(true);
    expect(existsSync(h.work.summary(late))).toBe(false);
    await tick(h.deps);
    expect(existsSync(h.work.summary(late))).toBe(true);
  });

  test("a scan that dies is tried again, and its third start fails interrupted without opening the archive", async () => {
    let calls = 0;
    const h = harness({
      scan: async (id, signal) => {
        calls++;
        // Stands in for a scan that kills the process: the real scan counts its attempt, then the hook throws.
        const hooks = { attempted: () => {
          throw new Error("simulated crash");
        } };
        return scanJob({ archives: h.archives, work: h.work, log: h.deps.log, hooks }, id, signal);
      },
    });
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    await tick(h.deps);
    expect(readFileSync(h.work.attempt(id), "utf8")).toBe(String(SCAN_MAX_ATTEMPTS - 1));
    expect(existsSync(h.work.summary(id))).toBe(false);
    // The archive is replaced by bytes no reader takes: a third start must not open it at all.
    writeFileSync(h.archives.archive(id), "not an archive");
    await tick(h.deps);
    expect(calls).toBe(3);
    expect(readOutput(h.work, id).summary).toEqual({ v: 1, id, status: "failed", failure: "interrupted" });
  });

  test("a job file that cannot be read fails the scan unreadable", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    writeFileSync(h.archives.job(id), JSON.stringify({ v: 1, id: randomUUID(), source: "mastodon" }));
    await tick(h.deps);
    expect(readOutput(h.work, id).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("the summary is written last: images, then posts.jsonl, then summary.json", async () => {
    const placed: string[] = [];
    const h = harness();
    h.deps.hooks = { placed: (file) => void placed.push(file) };
    await prepareWork(h.work);
    placeJob(h.archives, { source: "x", archive: buildXArchive(), images: true });
    await tick(h.deps);
    expect(placed.length).toBe(4);
    expect(placed.slice(0, 2).every((file) => /^media[/][0-9]+-0[.](jpg|png)$/.test(file))).toBe(true);
    expect(placed.slice(2)).toEqual(["posts.jsonl", "summary.json"]);
  });
});

describe("deletion requests", () => {
  test("remove the work folder, and an archive with a request is not scanned", async () => {
    const h = harness();
    await prepareWork(h.work);
    const done = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(existsSync(h.work.jobDir(done))).toBe(true);
    writeFileSync(h.archives.deletion(done), "");
    const waiting = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    writeFileSync(h.archives.deletion(waiting), "");
    expect(await tick(h.deps)).toBe(true);
    expect(existsSync(h.work.jobDir(done))).toBe(false);
    expect(existsSync(h.work.jobDir(waiting))).toBe(false);
    expect(existsSync(h.work.attempt(waiting))).toBe(false);
    // Carried out: the next tick has nothing to do, while the API has not withdrawn the requests yet.
    expect(await tick(h.deps)).toBe(false);
  });

  test("a request for the archive being scanned aborts that scan; nothing of it is left", async () => {
    let outcome: ScanOutcome | undefined;
    const h = harness({
      scan: async (id, signal) => {
        writeFileSync(h.archives.deletion(id), "");
        // The loop looks for requests every idleMs while a scan runs; the scan sees its signal between items.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("the scan was not aborted")), 5_000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        outcome = await scanJob({ archives: h.archives, work: h.work, log: h.deps.log }, id, signal);
        return outcome;
      },
    });
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(outcome).toBe("aborted");
    expect(existsSync(h.work.jobDir(id))).toBe(false);
  });

  test("attempts/<id> goes once the job's archive folder is gone", async () => {
    const h = harness();
    await prepareWork(h.work);
    const id = placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(existsSync(h.work.attempt(id))).toBe(true);
    rmSync(h.archives.jobDir(id), { recursive: true });
    rmSync(h.archives.queued(id));
    await tick(h.deps);
    expect(existsSync(h.work.attempt(id))).toBe(false);
  });

  test("names that are not import ids are ignored in queue/ and delete/", async () => {
    const h = harness();
    await prepareWork(h.work);
    writeFileSync(`${h.archives.queue}/not-an-id`, "");
    writeFileSync(`${h.archives.deletions}/x..`, "");
    mkdirSync(`${h.archives.queue}/${randomUUID()}`);
    expect(await tick(h.deps)).toBe(false);
  });
});

describe("the process's own care", () => {
  test("prepareWork creates the folders and forgets files a crash left half written", async () => {
    const h = harness();
    mkdirSync(h.work.tmp, { recursive: true });
    writeFileSync(`${h.work.tmp}/half`, "x");
    await prepareWork(h.work);
    expect(readdirSync(h.work.tmp)).toEqual([]);
    expect(existsSync(h.work.jobs) && existsSync(h.work.attempts)).toBe(true);
  });

  test("the heartbeat is { v: 1, at } in epoch milliseconds, written through tmp/", async () => {
    const h = harness();
    await prepareWork(h.work);
    await writeHeartbeat(h.deps);
    expect(ImporterHeartbeat.parse(JSON.parse(readFileSync(h.work.heartbeat, "utf8")))).toEqual({ v: 1, at: 1_800_000_000_000 });
    expect(readdirSync(h.work.tmp)).toEqual([]);
    expect(IMPORT_RULES.heartbeatMs).toBe(10_000);
  });

  test("the watchdog ends the process when one scan runs too long", async () => {
    const h = harness({
      watchdogMs: 20,
      scan: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "scanned";
      },
    });
    await prepareWork(h.work);
    placeJob(h.archives, { source: "mastodon", archive: mastodon });
    await tick(h.deps);
    expect(h.aborted).toHaveLength(1);
    expect(IMPORT_RULES.watchdogMs).toBe(1_800_000);
  });
});
```

### Create `apps/importer/test/mastodon.test.ts`

```ts
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { MEDIA_MAX_BYTES } from "@korbat/contracts";
import { isAllowed } from "../src/adapters/types";
import { mastodonAdapter } from "../src/adapters/mastodon/index";
import { CONTENT_WARNING_LABEL, SOURCE_WORDS } from "../src/text";
import { FIXTURE_HOST } from "./fixtures/canaries";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { MASTODON_NOTES, buildMastodonArchive, createActivity, mediaPath, outboxJson, statusId } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";
import { fakeImage, noise } from "./fixtures/zip";

/** The Mastodon adapter: every row of 5.6's table, detect for each failure, and the allowlist. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = (archive: Buffer, images = false) => runScan(ws.dir, { source: "mastodon", archive, images });
const LF = String.fromCharCode(10);

describe("reading a Mastodon archive (images off)", async () => {
  const result = await scan(buildMastodonArchive());
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ not_public: 3, repost: 1, poll: 1, date_out_of_range: 1 });
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, images_off: 4, video: 1, unsupported: 1 });
    expect(summary).toMatchObject({ posts: 14, images: 0, warnings: 1, sourceLinks: 3, protectedPosts: 0, readInPart: false });
    expect(lines).toHaveLength(14);
  });

  test("public and unlisted Notes are kept; HTML becomes text with its entities decoded", () => {
    expect(lineWith(lines, "Hello from Mastodon")).toMatchObject({
      kind: "post",
      text: `Hello from Mastodon & friends ${String.fromCharCode(0x2014)} with 'quotes'${LF}${LF}Second paragraph${LF}with a line break`,
      at: "2019-03-03T10:00:00Z",
    });
    lineWith(lines, "An unlisted post");
  });

  test("a quote keeps its own words without its fallback paragraph", () => {
    expect(lineWith(lines, "My comment").text).toBe("My comment on a quote");
  });

  test("a content warning becomes the first line, marked and counted", () => {
    expect(lineWith(lines, "behind a warning")).toMatchObject({ text: `${CONTENT_WARNING_LABEL}spoilers ahead${LF}${LF}The text behind a warning`, warning: true });
  });

  test("a self-reply is a thread; a reply to another server loses its leading mentions but keeps later ones", () => {
    expect(lineWith(lines, "Following up")).toMatchObject({ kind: "thread", parent: lineWith(lines, "Hello from Mastodon").ref });
    expect(lineWith(lines, "Thanks both")).toMatchObject({ kind: "reply", parent: null, text: "Thanks both, see @dave too" });
  });

  test("links to the person's own statuses and profile become fixed words; a shortened link is whole again", () => {
    expect(lineWith(lines, "My earlier post").text).toBe(`My earlier post ${SOURCE_WORDS.mastodon.post} and my profile ${SOURCE_WORDS.mastodon.profile} and an old one ${SOURCE_WORDS.mastodon.post}`);
    expect(lineWith(lines, "Read https").text).toBe("Read https://example.com/a/very/long/path/that/mastodon/shortens today #korbat");
  });

  test("a date with an offset is converted to UTC and cut to the second", () => {
    expect(lineWith(lines, "Dated with an offset").at).toBe("2019-03-21T01:30:00Z");
  });
});

describe("reading a Mastodon archive (images on)", async () => {
  const result = await scan(buildMastodonArchive(), true);
  const summary = scanned(result);

  test("images with and without a leading slash or a host, their descriptions cleaned; long ones become null and count", () => {
    const photos = lineWith(result.lines, "Two photos");
    expect(photos.media).toEqual([
      { file: `${photos.ref}-0.jpg`, alt: "A described photo" },
      { file: `${photos.ref}-1.png`, alt: null },
    ]);
    const long = lineWith(result.lines, "long description");
    expect(long.media).toEqual([{ file: `${long.ref}-0.webp`, alt: null }]);
    expect(summary.cleaned).toBe(1);
    expect(summary.images).toBe(3);
    expect(result.media.get(`${photos.ref}-1.png`)).toEqual(fakeImage("png", 1_500, 15));
  });

  test("a sensitive post's images are left out, its text kept; a missing file, a video and a GIF are counted", () => {
    expect(lineWith(result.lines, "A sensitive picture").media).toEqual([]);
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, missing_file: 1, video: 1, unsupported: 1 });
  });
});

describe("addressing comes first", () => {
  test("a private Question is not_public, not a poll; an Announce is a repost whatever it embeds", async () => {
    const notes = [
      { ...MASTODON_NOTES.question, to: [`${statusId(0)}/followers`], cc: [] },
      { n: 30, at: "2019-04-01T10:00:00Z", content: "<p>kept</p>" },
    ];
    const result = await scan(buildMastodonArchive({ notes }));
    expect(scanned(result).skipped).toEqual({ not_public: 1 });
  });

  test("an item that is not a Create of an embedded Note, or has no date, is unreadable", async () => {
    const good = createActivity({ n: 31, at: "2019-04-01T10:00:00Z", content: "<p>kept</p>" });
    const undated = createActivity({ n: 32, at: "2019-04-01T10:00:00Z", content: "<p>undated</p>" });
    (undated.object as Record<string, unknown>).published = "yesterday";
    const outbox = JSON.stringify({ type: "OrderedCollection", orderedItems: [good, { type: "Create", object: statusId(33), to: ["https://www.w3.org/ns/activitystreams#Public"] }, { type: "Like" }, "text", undated] });
    const result = await scan(buildMastodonArchive({ outbox }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { unreadable: 4 } });
  });
});

describe("detect and the failures", () => {
  const failure = async (archive: Buffer) => (await scan(archive)).summary;

  test("no outbox.json at the root, or no actor.json, is not_this_source; actor.json is never opened", async () => {
    expect(await failure(buildMastodonArchive({ noOutbox: true }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildMastodonArchive({ noActor: true }))).toMatchObject({ failure: "not_this_source" });
    expect(mastodonAdapter.detect([{ name: "outbox.json", size: 10 }, { name: "actor.json", size: 10 }])).toBeNull();
    expect(mastodonAdapter.detect([{ name: "outbox.json", size: 1_073_741_825 }, { name: "actor.json", size: 10 }])).toBe("not_this_source");
  });

  test("an X archive, a gzip (an instance before 4.2) and anything else", async () => {
    expect(await failure(buildXArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(gzipSync(Buffer.from("tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await failure(noise(100))).toMatchObject({ failure: "not_an_archive" });
  });

  test("an outbox that is not JSON is unreadable; an element over 1 MiB is item_too_large and ends the file", async () => {
    expect(await failure(buildMastodonArchive({ outbox: "{ not json" }))).toMatchObject({ failure: "unreadable" });
    const big = createActivity({ n: 40, at: "2019-04-01T10:00:00Z", content: `<p>${noise(550_000).toString("hex")}</p>` });
    const after = createActivity({ n: 41, at: "2019-04-02T10:00:00Z", content: "<p>after the big one</p>" });
    const before = createActivity({ n: 42, at: "2019-03-31T10:00:00Z", content: "<p>before the big one</p>" });
    const result = await scan(buildMastodonArchive({ outbox: JSON.stringify({ orderedItems: [before, big, after] }) }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { item_too_large: 1 } });
    const logged = result.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.reason === "item_too_large");
    expect(logged).toEqual([expect.objectContaining({ reason: "item_too_large", index: 1 })]);
  });

  test("an image over 20 MiB is too_large", async () => {
    const notes = [{ n: 50, at: "2019-04-01T10:00:00Z", content: "<p>huge</p>", attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(50)}`, name: "big" }] }];
    const archive = buildMastodonArchive({ notes, extra: [{ name: mediaPath(50), data: Buffer.concat([fakeImage("jpg", 10), noise(MEDIA_MAX_BYTES)]), method: 0 }] });
    const result = await scan(archive, true);
    expect(scanned(result).imagesSkipped).toEqual({ too_large: 1 });
  });

  test("a scan that keeps no post fails nothing_to_import", async () => {
    const outbox = outboxJson([MASTODON_NOTES.private, MASTODON_NOTES.direct], false);
    expect(await failure(buildMastodonArchive({ outbox }))).toMatchObject({ status: "failed", failure: "nothing_to_import" });
  });
});

describe("the allowlist", () => {
  const allowed = (name: string, images = true) => isAllowed(mastodonAdapter.allowlist, name, images);

  test("outbox.json at the root, and original media only while images are on", () => {
    expect(allowed("outbox.json", false)).toBe(true);
    expect(allowed(mediaPath(9))).toBe(true);
    expect(allowed(mediaPath(9), false)).toBe(false);
    expect(allowed("media_attachments/files/109/original/0123456789abcdef.jpeg")).toBe(true);
  });

  test("everything else is refused: actor.json, likes, avatars, small copies, deeper and .. paths", () => {
    for (const name of [
      "actor.json",
      "likes.json",
      "bookmarks.json",
      "avatar.png",
      "header.jpg",
      "x/outbox.json",
      "outbox.json.gz",
      "media_attachments/files/109/000/small/0123456789abcdef.jpg",
      "media_attachments/files/109/000/000/000/000/000/000/000/000/original/0123456789abcdef.jpg",
      "media_attachments/files/109/../original/0123456789abcdef.jpg",
      "media_attachments/files/109/original/0123456789abcdeg.jpg",
      "media_attachments/files/109/original/0123456789abcdef.gif",
      `${FIXTURE_HOST}/media_attachments/files/109/original/0123456789abcdef.jpg`,
    ]) {
      expect(allowed(name), name).toBe(false);
    }
  });
});
```

### Create `apps/importer/test/minimisation.test.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import type { ImportSource } from "@korbat/contracts";
import { buildBlueskyArchive } from "./fixtures/bluesky";
import { FORBIDDEN_STRINGS } from "./fixtures/canaries";
import { runScan, scanned, workspace, type ScanResult } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";

/**
 * Data minimisation (3b design, 1.5 and 12): for each source, no canary, handle, display name or DID reaches
 * posts.jsonl, summary.json, the media folder (names and bytes), the scratch file or the captured log. The scratch file
 * is deleted when the scan ends; the scan's hook lets this test read it first.
 */

const ws = workspace();
afterAll(() => ws.remove());

function leaks(label: string, bytes: Buffer | string): string[] {
  const text = typeof bytes === "string" ? bytes : bytes.toString("latin1");
  return FORBIDDEN_STRINGS.filter((canary) => text.includes(canary)).map((canary) => `${label} holds ${canary}`);
}

function everyLeak(result: ScanResult): string[] {
  const found: string[] = [];
  found.push(...leaks("posts.jsonl", result.raw));
  found.push(...leaks("summary.json", existsSync(result.work.summary(result.id)) ? readFileSync(result.work.summary(result.id)) : ""));
  for (const [name, bytes] of result.media) found.push(...leaks(`media ${name}`, name), ...leaks(`media ${name}`, bytes));
  found.push(...leaks("scratch", result.scratch ?? ""));
  for (const line of result.logs) found.push(...leaks("log", line));
  return found;
}

const cases: { name: string; source: ImportSource; archive: () => Promise<Buffer> | Buffer; images: boolean }[] = [
  { name: "X, images off", source: "x", archive: () => buildXArchive(), images: false },
  { name: "X, images on", source: "x", archive: () => buildXArchive(), images: true },
  { name: "Mastodon, images off", source: "mastodon", archive: () => buildMastodonArchive(), images: false },
  { name: "Mastodon, images on", source: "mastodon", archive: () => buildMastodonArchive(), images: true },
  { name: "Bluesky", source: "bluesky", archive: () => buildBlueskyArchive(), images: false },
];

describe.each(cases)("$name", ({ source, archive, images }) => {
  test("no canary, handle, name or DID in any output, and the scratch file is gone", async () => {
    const result = await runScan(ws.dir, { source, archive: await archive(), images });
    scanned(result);
    expect(result.scratch?.length ?? 0).toBeGreaterThan(0);
    expect(existsSync(result.work.scratch(result.id))).toBe(false);
    expect(result.lines.length).toBeGreaterThan(5);
    expect(everyLeak(result)).toEqual([]);
  });
});

test("the check itself finds a canary where one is", () => {
  expect(leaks("x", "a CANARY-DM b")).toEqual(["x holds CANARY-DM"]);
});
```

### Create `apps/importer/test/text.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { AltText, FORBIDDEN_FORMAT } from "@korbat/contracts";
import { htmlToText } from "../src/html";
import {
  CONTENT_WARNING_LABEL,
  SOURCE_WORDS,
  cleanDescription,
  expandTco,
  finishText,
  removeLeadingMentions,
  replaceSourceLinks,
  unescapeX,
} from "../src/text";

/** 5.3, step by step. Every character outside printable ASCII is built in code, never typed. */

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const LF = ch(10);
const ELLIPSIS = ch(0x2026);
const RLO = ch(0x202e);
const LRI = ch(0x2066);
const ZWSP = ch(0x200b);
const WORD_JOINER = ch(0x2060);
const BOM = ch(0xfeff);
const ZWJ = ch(0x200d);
const RLM = ch(0x200f);
const LRM = ch(0x200e);
const HEBREW = ch(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const ARABIC = ch(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);

describe("step 1: HTML to text (Mastodon)", () => {
  test("paragraphs become paragraph breaks and <br> a line break", () => {
    expect(finishText(htmlToText("<p>One</p><p>Two<br>three<br />four</p>")).text).toBe(`One${LF}${LF}Two${LF}three${LF}four`);
  });

  test("the five named entities and numeric entities are decoded; other entities and broken ones stay or go", () => {
    expect(htmlToText("<p>&amp; &lt;b&gt; &quot;q&quot; &apos;a&apos; &#39;n&#39; &#x2014; &#8212;</p>").trim()).toBe(`& <b> "q" 'a' 'n' ${ch(0x2014)} ${ch(0x2014)}`);
    expect(htmlToText("<p>&nbsp;kept &#0; &#xD800; &#x110000; gone</p>").trim()).toBe("&nbsp;kept    gone");
  });

  test("every other tag is dropped with its attributes, comments too; the text never renders", () => {
    expect(htmlToText('<p><strong class="x">bold</strong> <em onclick="alert(1)">it</em><!-- hidden --> <img src="a.png" alt="pic"> <script>text</script></p>').trim()).toBe("bold it  text");
  });

  test("a link's shortened text is joined back into its href; other link text stays as it is", () => {
    const href = "https://example.com/a/very/long/path/that/is/shortened";
    const link = `<a href="${href}" rel="nofollow"><span class="invisible">https://</span><span class="ellipsis">example.com/a/very/lo</span><span class="invisible">ng/path/that/is/shortened</span></a>`;
    expect(htmlToText(`<p>Read ${link} now</p>`).trim()).toBe(`Read ${href} now`);
    expect(htmlToText(`<p><a href="${href}">example.com/a/very${ELLIPSIS}</a></p>`).trim()).toBe(href);
    expect(htmlToText('<p><a href="https://evil.example/x">https://example.com/</a></p>').trim()).toBe("https://example.com/");
    expect(htmlToText('<p><a href="https://social.example/tags/tag" class="mention hashtag" rel="tag">#<span>tag</span></a></p>').trim()).toBe("#tag");
  });

  test("a quote's fallback paragraph (quote-inline) is dropped whole", () => {
    expect(htmlToText('<p class="quote-inline">RE: <a href="https://o.example/@b/1">https://o.example/@b/1</a></p><p>Mine</p>').trim()).toBe("Mine");
    expect(htmlToText('<p>Before<span class="quote-inline"><br>RE: <span>nested <span>deep</span></span></span> after</p>').trim()).toBe("Before after");
  });

  test("step 4 (Mastodon): a reply's leading run of mention links is removed; mentions inside the text stay", () => {
    const mention = (name: string) => `<span class="h-card" translate="no"><a href="https://o.example/@${name}" class="u-url mention">@<span>${name}</span></a></span>`;
    const html = `<p>${mention("bob")} ${mention("carol")} Thanks ${mention("dave")}!</p>`;
    expect(finishText(htmlToText(html, { reply: true })).text).toBe("Thanks @dave!");
    expect(finishText(htmlToText(html, { reply: false })).text).toBe("@bob @carol Thanks @dave!");
  });
});

describe("step 2: unescape (X)", () => {
  test("&amp;, &lt; and &gt; in full_text, &amp; last", () => {
    expect(unescapeX("a &amp; b &lt;c&gt; &amp;lt;")).toBe("a & b <c> &lt;");
  });
});

describe("step 3: links (X)", () => {
  test("a t.co link becomes its expanded_url, a media link and a t.co link with no entity go", () => {
    const text = "See https://t.co/abc123 and https://t.co/med456 and https://t.co/zzz999";
    expect(expandTco(text, [{ url: "https://t.co/abc123", expanded: "https://example.com/page" }], ["https://t.co/med456"])).toBe("See https://example.com/page and and");
  });
});

describe("step 3b: links to the source platform", () => {
  test("X: a status link becomes the post's words, any other link on twitter.com, x.com or a subdomain the profile's", () => {
    const { text, count } = replaceSourceLinks(
      "q https://twitter.com/someone/status/123?s=20 p https://x.com/someone. m https://mobile.twitter.com/a/status/9 o https://box.com/a and https://x.com.evil.example/a/status/1",
      "x",
    );
    expect(text).toBe(`q ${SOURCE_WORDS.x.post} p ${SOURCE_WORDS.x.profile}. m ${SOURCE_WORDS.x.post} o https://box.com/a and https://x.com.evil.example/a/status/1`);
    expect(count).toBe(3);
    expect(SOURCE_WORDS.x).toEqual({ post: "(a post on X)", profile: "(a profile on X)" });
  });

  test("Mastodon: only links on the Note's own host, as a post (/@name/id, /users/name/statuses/id) or a profile", () => {
    const { text, count } = replaceSourceLinks(
      "a https://social.example/@me/109 b https://social.example/users/me/statuses/110 c https://social.example/@me d https://other.example/@me/1",
      "mastodon",
      "social.example",
    );
    expect(text).toBe(`a ${SOURCE_WORDS.mastodon.post} b ${SOURCE_WORDS.mastodon.post} c ${SOURCE_WORDS.mastodon.profile} d https://other.example/@me/1`);
    expect(count).toBe(3);
    expect(SOURCE_WORDS.mastodon).toEqual({ post: "(a post on Mastodon)", profile: "(a profile on Mastodon)" });
  });

  test("Bluesky: bsky.app links, with or without a scheme, and at:// URIs", () => {
    const { text, count } = replaceSourceLinks(
      "p bsky.app/profile/me.bsky.social q https://bsky.app/profile/me.bsky.social/post/3kabc r at://did:plc:abc/app.bsky.feed.post/3kabc s at://did:plc:abc t notbsky.app/x",
      "bluesky",
    );
    expect(text).toBe(`p ${SOURCE_WORDS.bluesky.profile} q ${SOURCE_WORDS.bluesky.post} r ${SOURCE_WORDS.bluesky.post} s ${SOURCE_WORDS.bluesky.profile} t notbsky.app/x`);
    expect(count).toBe(4);
  });
});

describe("step 4: leading mentions (X)", () => {
  test("the @name run before display_text_range[0] is removed, and nothing else", () => {
    expect(removeLeadingMentions("@a @b_c Hello @d", 8)).toBe("Hello @d");
    expect(removeLeadingMentions("Hello @d", 0)).toBe("Hello @d");
    // A prefix that is not a run of mentions is kept whole.
    expect(removeLeadingMentions("Not a mention run", 4)).toBe("Not a mention run");
  });
});

describe("steps 5 and 6: cleaning and normalising", () => {
  test("controls but tab and line feed, and every forbidden format character, are removed and counted; joiners and direction marks stay", () => {
    const raw = `a${ch(0)}b${ch(7)}c${ch(9)}d${RLO}e${LRI}f${ZWSP}g${WORD_JOINER}h${BOM}i${ZWJ}j${RLM}k${LRM}l${ch(0x7f)}m${ch(0x85)}n`;
    const { text, removed } = finishText(raw);
    expect(text).toBe(`abc${ch(9)}defghi${ZWJ}j${RLM}k${LRM}lmn`);
    expect(removed).toBe(9);
    expect(FORBIDDEN_FORMAT.test(text)).toBe(false);
  });

  test("right-to-left text keeps its letters and marks, loses its overrides", () => {
    const { text, removed } = finishText(`${RLM}${HEBREW} ${RLO}${ARABIC}${ch(0x202c)} ok`);
    expect(text).toBe(`${RLM}${HEBREW} ${ARABIC} ok`);
    expect(removed).toBe(2);
  });

  test("NFC, CR LF and CR to LF (not counted), at most two line breaks in a row, trimmed", () => {
    const decomposed = "e" + ch(0x301);
    const { text, removed } = finishText(`  ${decomposed}${ch(13, 10)}x${ch(13)}y${LF}${LF}${LF}${LF}z  `);
    expect(text).toBe(`${ch(0xe9)}${LF}x${LF}y${LF}${LF}z`);
    expect(removed).toBe(0);
  });

  test("the content warning's words", () => {
    expect(CONTENT_WARNING_LABEL).toBe("Content warning: ");
  });
});

describe("descriptions", () => {
  test("cleaned and folded to meet AltText; over 1,000 code points or nothing visible becomes null, counted", () => {
    expect(cleanDescription(`  A  photo${LF}of${ch(9)}a${RLO} cat `)).toEqual({ alt: "A photo of a cat", cleaned: true });
    expect(cleanDescription("A plain description")).toEqual({ alt: "A plain description", cleaned: false });
    expect(cleanDescription("x".repeat(1_000))).toEqual({ alt: "x".repeat(1_000), cleaned: false });
    expect(cleanDescription("x".repeat(1_001))).toEqual({ alt: null, cleaned: true });
    expect(cleanDescription(`${ZWSP}${BOM}`)).toEqual({ alt: null, cleaned: true });
    expect(cleanDescription("")).toEqual({ alt: null, cleaned: false });
    expect(cleanDescription(null)).toEqual({ alt: null, cleaned: false });
    expect(cleanDescription(42)).toEqual({ alt: null, cleaned: false });
    const { alt } = cleanDescription(`${ch(0x1b)}[31m colour ${ch(0x1b)}`);
    expect(AltText.safeParse(alt).success).toBe(true);
  });
});
```

### Create `apps/importer/test/x.test.ts`

```ts
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { isAllowed } from "../src/adapters/types";
import { xAdapter } from "../src/adapters/x/index";
import { SOURCE_WORDS } from "../src/text";
import { buildBlueskyArchive } from "./fixtures/bluesky";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { X_NOTE_TEXT, X_TWEETS, buildXArchive, dataFile, tweetObject, xManifest } from "./fixtures/x";
import { noise } from "./fixtures/zip";

/** The X adapter: every row of 5.5's table, detect for each failure, and the allowlist. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = (archive: Buffer, images = false) => runScan(ws.dir, { source: "x", archive, images });

describe("reading an X archive (images off)", async () => {
  const result = await scan(buildXArchive());
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ repost: 1, not_public: 1, older_version: 1, date_out_of_range: 2, empty: 1 });
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, images_off: 2, video: 2 });
    expect(summary).toMatchObject({ posts: 16, images: 0, warnings: 0, protectedPosts: 1, sourceLinks: 2, cleaned: 0, readInPart: false });
    expect(lines).toHaveLength(16);
    expect(lines.map((line) => line.ref)).toEqual([...lines.keys()]);
  });

  test("a post: unescaped, its t.co link expanded", () => {
    expect(lineWith(lines, "Plain post")).toMatchObject({ text: "Plain post with a link https://example.com/page and & <b> escapes", kind: "post", parent: null, at: "2019-03-03T10:00:00Z", protected: false, warning: false, media: [] });
  });

  test("a self-reply is a thread under the post it answers; a reply to someone else is a reply without the leading mentions", () => {
    const plain = lineWith(lines, "Plain post");
    expect(lineWith(lines, "A reply to my own")).toMatchObject({ kind: "thread", parent: plain.ref });
    expect(lineWith(lines, "Answering")).toMatchObject({ kind: "reply", parent: null, text: "Answering someone else" });
  });

  test("of an edited post only the latest version is kept", () => {
    expect(lines.some((line) => line.text.startsWith("First version"))).toBe(false);
    lineWith(lines, "Second version");
  });

  test("a self-quote and a link to the person's profile become fixed words", () => {
    expect(lineWith(lines, "Quoting myself").text).toBe(`Quoting myself ${SOURCE_WORDS.x.post}`);
    expect(lineWith(lines, "Find me at").text).toBe(`Find me at ${SOURCE_WORDS.x.profile}`);
  });

  test("a truncated post takes its note's whole text; an unmatched note is ignored", () => {
    expect(lineWith(lines, "This is the start of a long note").text).toBe(X_NOTE_TEXT);
    expect(lines.some((line) => line.text.includes("unmatched note"))).toBe(false);
  });

  test("a tweet inside the protected period is marked protected; the rest are not", () => {
    expect(lineWith(lines, "while my account was protected").protected).toBe(true);
    expect(lines.filter((line) => line.protected)).toHaveLength(1);
  });

  test("the 2019 element shape, tweets-part1.js, a stray t.co link, and a media-only post", () => {
    lineWith(lines, "2019 element shape");
    lineWith(lines, "tweets-part1.js");
    expect(lineWith(lines, "A stray t.co link").text).toBe("A stray t.co link goes away");
    expect(lines.some((line) => line.text === "")).toBe(false);
  });

  test("videos and animated GIFs are counted, their posts kept", () => {
    expect(lineWith(lines, "A video post").media).toEqual([]);
    expect(lineWith(lines, "An animated post").media).toEqual([]);
  });

  test("keys are 64 hex and distinct", () => {
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });
});

describe("reading an X archive (images on)", async () => {
  const result = await scan(buildXArchive(), true);
  const summary = scanned(result);

  test("a photo of a kept post is written with no description; a sensitive one and a missing one are counted", () => {
    expect(lineWith(result.lines, "A photo post").media).toEqual([{ file: `${lineWith(result.lines, "A photo post").ref}-0.jpg`, alt: null }]);
    expect(lineWith(result.lines, "A sensitive photo post").media).toEqual([]);
    expect(lineWith(result.lines, "whose file is missing").media).toEqual([]);
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, missing_file: 1, video: 2 });
    expect(summary.images).toBe(2);
    expect(result.media.size).toBe(2);
  });

  test("a media-only post is kept with its image", () => {
    const only = result.lines.find((line) => line.text === "")!;
    expect(only.media).toHaveLength(1);
    expect(only.media[0]!.file).toMatch(/^[0-9]+-0[.]png$/);
    expect(summary.posts).toBe(17);
    expect(summary.skipped).toEqual({ repost: 1, not_public: 1, older_version: 1, date_out_of_range: 2 });
  });
});

describe("other X archives", () => {
  test("the 2018 archive's data/tweet.js", async () => {
    const result = await scan(buildXArchive({ legacy: true }));
    expect(scanned(result).posts).toBeGreaterThan(10);
    lineWith(result.lines, "Plain post");
  });

  test("without a manifest's file list the fixed names are read", async () => {
    const result = await scan(buildXArchive({ noFileList: true }));
    expect(scanned(result).posts).toBe(16);
  });

  test("a tweet's created_at must match X's pattern exactly; anything else, or an element that is no tweet, is unreadable", async () => {
    const good = tweetObject(X_TWEETS.plain);
    const iso = tweetObject({ id: "1100000000000000500", at: "2019-03-03T10:00:00Z", text: "An ISO date X never writes" });
    (iso.tweet as Record<string, unknown>).created_at = "2019-03-03T10:00:00Z";
    const tweetsText = dataFile("tweets", [good, iso, 42, { tweet: { full_text: "no id" } }]);
    const result = await scan(buildXArchive({ tweets: [X_TWEETS.plain], tweetsText }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { unreadable: 3 } });
    // One log line for each unreadable item, with its reason and index only.
    const unreadable = result.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.reason === "unreadable");
    expect(unreadable.map((line) => line.index)).toEqual([1, 2, 3]);
  });
});

describe("detect and the failures", () => {
  const failure = async (archive: Buffer) => (await scan(archive)).summary;

  test("no manifest, or one over 1 MiB, is not_this_source", async () => {
    expect(await failure(buildXArchive({ noManifest: true }))).toMatchObject({ status: "failed", failure: "not_this_source" });
    expect(await failure(buildXArchive({ hugeManifest: true }))).toMatchObject({ status: "failed", failure: "not_this_source" });
  });

  test("a manifest whose prefix is not window.__THAR_CONFIG = exactly, or whose rest is not JSON, is not_this_source", async () => {
    const manifest = xManifest();
    expect(await failure(buildXArchive({ manifestText: manifest.replace("window.__THAR_CONFIG = ", "window.__THAR_CONFIG= ") }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildXArchive({ manifestText: manifest.replace("window.__THAR_CONFIG = ", "window.__THAR_CONFIG = alert(1);") }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildXArchive({ manifestText: manifest + ";" }))).toMatchObject({ status: "scanned" });
  });

  test("a data file whose prefix is not window.YTD.<name>.part<N> = is unreadable", async () => {
    const tweetsText = dataFile("tweets", [tweetObject(X_TWEETS.plain)]).replace("window.YTD.tweets.part0 = ", "var tweets = ");
    expect(await failure(buildXArchive({ tweets: [X_TWEETS.plain], tweetsText }))).toMatchObject({ failure: "unreadable" });
  });

  test("a partial archive is partial_archive", async () => {
    expect(await failure(buildXArchive({ partial: true }))).toMatchObject({ status: "failed", failure: "partial_archive" });
  });

  test("a Mastodon archive, a CAR, a gzip and anything else", async () => {
    expect(await failure(buildMastodonArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(await buildBlueskyArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(gzipSync(Buffer.from("a tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await failure(noise(5_000))).toMatchObject({ failure: "not_an_archive" });
  });
});

describe("the allowlist", () => {
  const allowed = (name: string, images = true) => isAllowed(xAdapter.allowlist, name, images);

  test("the data files, and media only while images are on", () => {
    for (const name of ["data/manifest.js", "data/tweets.js", "data/tweet.js", "data/tweets-part1.js", "data/tweets-part99.js", "data/note-tweet.js", "data/twitter-circle-tweet.js", "data/protected-history.js"]) {
      expect(allowed(name, false)).toBe(true);
    }
    expect(allowed("data/tweets_media/1100000000000000012-Fphoto01.jpg")).toBe(true);
    expect(allowed("data/tweet_media/12-abc_DEF-1.webp")).toBe(true);
    expect(allowed("data/tweets_media/1100000000000000012-Fphoto01.jpg", false)).toBe(false);
  });

  test("everything else is refused: the private files, part 0 and 100, deeper and .. paths", () => {
    for (const name of [
      "data/direct-messages.js",
      "data/direct-messages-group.js",
      "data/ip-audit.js",
      "data/deleted-tweets.js",
      "data/like.js",
      "data/follower.js",
      "data/account.js",
      "data/tweets-part0.js",
      "data/tweets-part100.js",
      "data/tweets.js.bak",
      "x/data/tweets.js",
      "data/tweets_media/sub/12-abc.jpg",
      "data/tweets_media/../12-abc.jpg",
      "data/tweets_media/12-abc.gif",
      "data/direct_messages_media/12-abc.jpg",
      "data/tweets_media/12-" + "a".repeat(65) + ".jpg",
    ]) {
      expect(allowed(name), name).toBe(false);
    }
  });
});
```

### Create `apps/importer/test/zip.test.ts`

```ts
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES, MEDIA_MAX_BYTES } from "@korbat/contracts";
import { ScanFailure, type EntryRule } from "../src/adapters/types";
import { checkEntryName } from "../src/zip/central";
import { openZip, type ZipArchive, type ZipLimits } from "../src/zip/entry";
import { workspace } from "./fixtures/harness";
import { buildZip, noise, type ZipItem, type ZipOptions } from "./fixtures/zip";

/** The zip reader of the 3b design, section 7.2: every limit refuses with its code, and good archives read. */

const ws = workspace();
afterAll(() => ws.remove());

const EVERYTHING: EntryRule[] = [{ pattern: /^.*$/s }];

/** Opens `bytes` as an archive under `rules`, reads every allowlisted entry whole, and closes the file. */
async function withZip<T>(bytes: Buffer, use: (zip: ZipArchive) => Promise<T>, options: { rules?: EntryRule[]; images?: boolean; limits?: Partial<ZipLimits>; seen?: string[] } = {}): Promise<T> {
  const file = path.join(ws.dir, randomUUID());
  writeFileSync(file, bytes);
  const handle = await open(file, "r");
  try {
    const rules = options.rules ?? EVERYTHING;
    const zip = await openZip(handle, bytes.length, {
      rules,
      images: options.images ?? true,
      limits: options.limits,
      onName: (name) => void options.seen?.push(name),
    });
    return await use(zip);
  } finally {
    await handle.close();
  }
}

async function readAll(zip: ZipArchive, name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of zip.open(name)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** The failure code of a whole read of `items`, or "ok". */
async function outcome(items: ZipItem[], options: ZipOptions = {}, limits?: Partial<ZipLimits>): Promise<string> {
  try {
    await withZip(
      buildZip(items, options),
      async (zip) => {
        for (const entry of zip.entries) await readAll(zip, entry.name);
      },
      { limits },
    );
    return "ok";
  } catch (err) {
    if (err instanceof ScanFailure) return err.code;
    throw err;
  }
}

const TEXT = "korbat reads only what it allows. ".repeat(40);

describe("good archives read", () => {
  test("stored and deflated entries read back whole, and only allowlisted names are listed", async () => {
    const bytes = buildZip([
      { name: "outbox.json", data: TEXT },
      { name: "media/a.jpg", data: noise(5_000), method: 0 },
      { name: "likes.json", data: "never opened" },
    ]);
    await withZip(
      bytes,
      async (zip) => {
        expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json", "media/a.jpg"]);
        expect(zip.entries[0]!.size).toBe(Buffer.byteLength(TEXT));
        expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
        expect(await readAll(zip, "media/a.jpg")).toEqual(noise(5_000));
        expect(zip.has("likes.json")).toBe(false);
        expect(() => zip.open("likes.json")).toThrow();
      },
      { rules: [{ name: "outbox.json" }, { pattern: /^media[/][a-z]+[.]jpg$/ }] },
    );
  });

  test("a ZIP64 archive reads", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: TEXT }, { name: "b.json", data: "{}" }], { zip64: true });
    await withZip(bytes, async (zip) => {
      expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json", "b.json"]);
      expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
    });
  });

  test("an archive with data descriptors (flag bit 3, zero local sizes) reads", async () => {
    const bytes = buildZip([
      { name: "outbox.json", data: TEXT, dataDescriptor: true },
      { name: "second.json", data: TEXT.toUpperCase(), dataDescriptor: true },
    ]);
    expect(await outcome([{ name: "outbox.json", data: TEXT, dataDescriptor: true }, { name: "second.json", data: TEXT, dataDescriptor: true }])).toBe("ok");
    await withZip(bytes, async (zip) => expect((await readAll(zip, "second.json")).toString("utf8")).toBe(TEXT.toUpperCase()));
  });

  test("an archive with ZIP64 local sizes (0xFFFFFFFF and a ZIP64 extra) reads", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: TEXT, zip64Local: true }, { name: "c.bin", data: noise(3_000), method: 0, zip64Local: true }]);
    await withZip(bytes, async (zip) => {
      expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
      expect(await readAll(zip, "c.bin")).toEqual(noise(3_000));
    });
  });

  test("an images rule applies only while images are on", async () => {
    const bytes = buildZip([{ name: "data.json", data: "{}" }, { name: "pic.jpg", data: noise(100), method: 0 }]);
    const rules: EntryRule[] = [{ name: "data.json" }, { pattern: /^pic[.]jpg$/, images: true }];
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["data.json"]), { rules, images: false });
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["data.json", "pic.jpg"]), { rules, images: true });
  });
});

describe("step 1: the end record", () => {
  test("a file under 22 bytes, a file without the record, a comment that runs past the end and a second disk are not archives", async () => {
    const refuse = async (bytes: Buffer) => {
      try {
        await withZip(bytes, async () => undefined);
        return "ok";
      } catch (err) {
        return err instanceof ScanFailure ? err.code : String(err);
      }
    };
    expect(await refuse(Buffer.from("PK"))).toBe("not_an_archive");
    expect(await refuse(noise(70_000))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { comment: Buffer.from("hello"), commentOverrun: 10 }))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { disk: 1 }))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { comment: Buffer.from("a comment is fine") }))).toBe("ok");
  });

  test("a central directory that starts outside the file is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}" }], { directoryOffset: 10_000_000 })).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, directoryOffset: 2 ** 40 })).toBe("unreadable");
  });
});

describe("step 2: the central directory and the names", () => {
  test("more entries than ZIP_MAX_ENTRIES, or a directory over 64 MiB, is too_many_entries", async () => {
    expect(IMPORT_RULES.zipMaxEntries).toBe(200_000);
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, entriesDeclared: 200_001 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, entriesDeclared: 1_000_000 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }], { directorySize: IMPORT_RULES.zipDirectoryMaxBytes + 1 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }, { name: "c.json", data: "{}" }], {}, { maxEntries: 2 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }], {}, { maxEntries: 2 })).toBe("ok");
  });

  test("a directory whose entries run past its declared size is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }], { directorySize: 60 })).toBe("unreadable");
  });

  test("checkEntryName refuses every crafted name and takes ordinary ones", () => {
    const utf8 = (name: string) => checkEntryName(Buffer.from(name, "utf8"), true);
    expect(utf8("data/tweets.js")).toBe("data/tweets.js");
    expect(utf8("media_attachments/files/109/original/0123456789abcdef.jpg")).toBe("media_attachments/files/109/original/0123456789abcdef.jpg");
    expect(utf8("../outbox.json")).toBeNull();
    expect(utf8("data/../outbox.json")).toBeNull();
    expect(utf8("data/./tweets.js")).toBeNull();
    expect(utf8("/outbox.json")).toBeNull();
    expect(utf8("C:/outbox.json")).toBeNull();
    expect(utf8("c:outbox.json")).toBeNull();
    expect(utf8("data" + String.fromCharCode(92) + "tweets.js")).toBeNull();
    expect(utf8("data" + String.fromCharCode(0) + "tweets.js")).toBeNull();
    expect(utf8("data//tweets.js")).toBeNull();
    expect(utf8("")).toBeNull();
    expect(utf8("a".repeat(513))).toBeNull();
    expect(utf8("a".repeat(512))).toBe("a".repeat(512));
    // Not UTF-8 although flag bit 11 says so, and a CP437 name (bit 11 clear) beyond ASCII.
    expect(checkEntryName(Buffer.from([0x64, 0xff, 0xfe]), true)).toBeNull();
    expect(checkEntryName(Buffer.from([0x64, 0x82]), false)).toBeNull();
    expect(checkEntryName(Buffer.from("plain.json", "latin1"), false)).toBe("plain.json");
  });

  test("an entry whose name fails is never offered to the allowlist and never opened, only counted", async () => {
    const crafted: ZipItem[] = [
      { name: "../outbox.json", data: "{}" },
      { name: "/outbox.json", data: "{}" },
      { name: "C:/outbox.json", data: "{}" },
      { name: "data" + String.fromCharCode(92) + "outbox.json", data: "{}" },
      { name: Buffer.from("outbox.json" + String.fromCharCode(0) + ".txt", "utf8"), data: "{}" },
      { name: "a".repeat(513), data: "{}" },
    ];
    const seen: string[] = [];
    await withZip(
      buildZip([{ name: "outbox.json", data: "{}" }, ...crafted]),
      async (zip) => {
        expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]);
        expect(zip.refusedNames).toBe(crafted.length);
      },
      { seen },
    );
    expect(seen).toEqual(["outbox.json"]);
  });

  test("a directory or a symbolic link is ignored and never opened, whatever its name", async () => {
    const seen: string[] = [];
    await withZip(
      buildZip([
        { name: "outbox.json", data: "{}" },
        { name: "data/", data: "", directory: true, method: 0 },
        { name: "actor.json", data: "/etc/passwd", symlink: true, method: 0 },
      ]),
      async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]),
      { seen },
    );
    expect(seen).toEqual(["outbox.json"]);
  });
});

describe("step 3: two entries with one allowlisted name", () => {
  test("refuse the archive (bad_entry_name)", async () => {
    expect(await outcome([{ name: "outbox.json", data: "{}" }, { name: "x.json", data: "{}" }], { duplicateCentral: 0 })).toBe("bad_entry_name");
  });

  test("but not when the name is outside the allowlist", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: "{}" }, { name: "likes.json", data: "{}" }], { duplicateCentral: 1 });
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]), { rules: [{ name: "outbox.json" }] });
  });
});

describe("step 4: each allowlisted entry", () => {
  test("encryption is encrypted, a method other than stored or deflate is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}", encrypted: true }])).toBe("encrypted");
    expect(await outcome([{ name: "a.json", data: "{}", method: 12 }])).toBe("unreadable");
  });

  test("a data file over 1 GiB, an entry whose ratio is over 100, and a sum over 4 GiB are too_large_uncompressed", async () => {
    expect(IMPORT_RULES.zipDataMaxBytes).toBe(1_073_741_824);
    expect(await outcome([{ name: "a.json", data: noise(20_000_000), method: 0, declaredSize: IMPORT_RULES.zipDataMaxBytes + 1 }])).toBe("too_large_uncompressed");
    expect(await outcome([{ name: "a.json", data: Buffer.alloc(2_000_000) }])).toBe("too_large_uncompressed");
    expect(await outcome([{ name: "a.json", data: Buffer.alloc(100_000), method: 0, declaredSize: 100 * 1_000 + 1, declaredCompressed: 1_000 }])).not.toBe("ok");
    const three = [1, 2, 3].map((n) => ({ name: `${n}.json`, data: noise(1_000, n), method: 0 as const }));
    expect(await outcome(three, {}, { totalMaxBytes: 2_999 })).toBe("too_large_uncompressed");
    expect(await outcome(three, {}, { totalMaxBytes: 3_000 })).toBe("ok");
  });

  test("an image over 20 MiB is not a refusal of the archive: its size is listed, and the core counts it too_large unopened", async () => {
    const big = noise(MEDIA_MAX_BYTES + 1);
    const bytes = buildZip([{ name: "data.json", data: "{}" }, { name: "big.jpg", data: big, method: 0 }]);
    const rules: EntryRule[] = [{ name: "data.json" }, { pattern: /^big[.]jpg$/, images: true }];
    await withZip(bytes, async (zip) => expect(zip.size("big.jpg")).toBe(MEDIA_MAX_BYTES + 1), { rules });
  });

  test("a data range outside the file, or two allowlisted entries whose ranges overlap, is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: noise(500), method: 0, declaredCompressed: 5_000_000, declaredSize: 5_000_000 }])).toBe("unreadable");
    expect(await outcome([{ name: "outer.json", data: noise(300), method: 0 }, { name: "inner.json", data: "{}", method: 0, nestInPrevious: true }])).toBe("unreadable");
    // The same two names without the overlap read.
    expect(await outcome([{ name: "outer.json", data: noise(300), method: 0 }, { name: "inner.json", data: "{}", method: 0 }])).toBe("ok");
  });
});

describe("step 5: opening an entry", () => {
  test("a local header whose name, method or encryption bit differs from the central entry is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: TEXT, localName: "b.json" }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, localMethod: 0 }])).toBe("unreadable");
  });

  test("a size that lies stops one byte over the central size, and a bad CRC is found at the end", async () => {
    expect(await outcome([{ name: "a.json", data: TEXT, declaredSize: 100 }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, badCrc: true }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, badCrc: true, dataDescriptor: true }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: noise(400), method: 0, declaredSize: 300, declaredCompressed: 400 }])).toBe("unreadable");
  });

  test("a reader that stops early leaves nothing open, and the next read starts afresh", async () => {
    const big = noise(3_000_000);
    await withZip(buildZip([{ name: "a.bin", data: big, method: 0 }]), async (zip) => {
      for await (const chunk of zip.open("a.bin")) {
        expect(chunk.length).toBeGreaterThan(0);
        break;
      }
      expect((await readAll(zip, "a.bin")).equals(big)).toBe(true);
    });
  });
});
```

### Create `apps/importer/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

/**
 * The importer's unit tests build every archive they read in code (3b design, section 12.1), some of them a few
 * megabytes, so they get a longer timeout. The labs (test/lab/*.lab.ts) are measurements, run by hand through
 * vitest.lab.config.ts and never here.
 */
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
```

### Create `apps/importer/vitest.lab.config.ts`

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The importer's labs under test/lab (3b design, section 12.5): measurements of time and memory against archives the
 * labs generate, run by hand in the Dockerfile's build stage and never by a suite (their files end in .lab.ts, which no
 * other configuration includes). Each file runs in a process of its own (the forks pool, one file at a time), so one
 * lab's peak memory is not another's. See test/lab/README.md.
 */
export default defineConfig({
  // In the Docker run the root is read-only: Vite's cache goes to the lab volume (LAB_DIR), and the script loads this
  // file with --configLoader runner, which writes no bundled copy of it next to node_modules.
  ...(process.env.LAB_DIR ? { cacheDir: path.join(process.env.LAB_DIR, "vite-cache") } : {}),
  test: {
    include: ["test/lab/**/*.lab.ts"],
    pool: "forks",
    fileParallelism: false,
    isolate: true,
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
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
packages/db test:       Tests  112 passed (112)
packages/contracts test:       Tests  493 passed (493)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/03-importer.md 3
```

Expected: 22 lines starting with `wrote`, one for each file below.

### Create `apps/importer/Dockerfile`

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/importer ./apps/importer
RUN pnpm install --frozen-lockfile --filter @korbat/importer...
RUN pnpm --filter @korbat/importer build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
WORKDIR /app
# One bundle and nothing else: the importer has no native module and no package at runtime (3b design, 7.1).
COPY --from=build /repo/apps/importer/dist ./dist
# The volumes mount here. A new volume takes the owner of the path in the image, so both paths exist and belong to
# the user the process runs as. import-archives is mounted read-only; the importer writes only import-work.
RUN mkdir -p /import/archives /import/work && chown node:node /import/archives /import/work
USER node
CMD ["node", "dist/index.js"]
```

### Create `apps/importer/build.mjs`

```js
// Bundles the importer for the Docker image. esbuild is called directly: the whole configuration fits here.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: { index: "src/index.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: true,
  // Everything is bundled: the importer has no native module, so the image holds dist/ and nothing else (3b design, 7.1).
  packages: "bundle",
  // Bundled CommonJS dependencies (stream-json, stream-chain, varint) call require(); an ES module bundle has to provide it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
console.log("Build success");
```

### Create `apps/importer/package.json`

```json
{
  "name": "@korbat/importer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "start": "node dist/index.js",
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "test:lab": "vitest run --config vitest.lab.config.ts --configLoader runner"
  },
  "dependencies": {
    "@ipld/car": "5.4.7",
    "@ipld/dag-cbor": "10.0.2",
    "@korbat/contracts": "workspace:*",
    "@korbat/import-protocol": "workspace:*",
    "cborg": "6.1.4",
    "multiformats": "14.0.5",
    "pino": "10.3.1",
    "stream-json": "3.7.0",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "esbuild": "0.28.2",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Create `apps/importer/src/adapters/bluesky/index.ts`

```ts
import type { ImportImageSkip } from "@korbat/contracts";
import { parseIsoDate } from "../../core";
import { finishText, replaceSourceLinks } from "../../text";
import { ScanFailure, field, text, type AdapterItem, type AllowedArchive, type ReadContext, type SourceAdapter } from "../types";

/**
 * The Bluesky adapter (3b design, section 5.7; behind the owner's switch, decision 16). The archive is a repository
 * export (a CAR), one pseudo-entry whose reader yields post records only: the header, the commit, the MST nodes and the
 * records under app.bsky.feed.post/ are all that is decoded. The export holds no image files, and korbat never fetches
 * them from a PDS: every image or video a post embeds is counted bluesky_no_files. The commit's DID is used only to
 * tell the account's own replies from replies to others.
 */

const POST_TYPE = "app.bsky.feed.post";
/** Self-labels that mark sexual content, which R1 forbids: such a post is left out (decision 10). */
const ADULT_LABELS = new Set(["porn", "sexual", "nudity"]);
const IMAGES = "app.bsky.embed.images";
const GALLERY = "app.bsky.embed.gallery";
const VIDEO = "app.bsky.embed.video";
const QUOTE_WITH_MEDIA = "app.bsky.embed.recordWithMedia";

/** How many files an embed would have needed: images and gallery items one each, a video one. */
function filesOf(embed: unknown): number {
  const type = text(embed, "$type");
  if (type === IMAGES || type === GALLERY) {
    const list = field(embed, "images") ?? field(embed, "items");
    return Array.isArray(list) ? list.length : 1;
  }
  if (type === VIDEO) return 1;
  if (type === QUOTE_WITH_MEDIA) return filesOf(field(embed, "media"));
  // A quote (app.bsky.embed.record) keeps its text, a link card (external) is dropped: neither has a file.
  return 0;
}

function labelled(record: unknown): boolean {
  const values = field(field(record, "labels"), "values");
  return Array.isArray(values) && values.some((label) => ADULT_LABELS.has(text(label, "val") ?? ""));
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "car") throw new ScanFailure("not_this_source");
  const ownPosts = `at://${archive.did}/${POST_TYPE}/`;
  let index = 0;
  for await (const record of archive.records()) {
    context.checkAborted();
    const at = index++;
    if (!context.takeItem()) return yield { skipped: "over_item_cap" };
    if ("unreadable" in record) {
      yield { skipped: "unreadable", index: at };
      continue;
    }
    const value = record.value;
    const body = text(value, "text");
    const created = parseIsoDate(field(value, "createdAt"));
    if (text(value, "$type") !== POST_TYPE || body === undefined || created === null) {
      yield { skipped: "unreadable", index: at };
      continue;
    }
    if (labelled(value)) {
      yield { skipped: "adult_label" };
      continue;
    }
    const parent = text(field(field(value, "reply"), "parent"), "uri");
    const kind = parent === undefined ? "post" : parent.startsWith(ownPosts) ? "thread" : "reply";
    // `text` holds no HTML and its facets are not read: links stay as typed, but for 5.3 step 3b.
    const linked = replaceSourceLinks(body, "bluesky");
    const finished = finishText(linked.text);
    const imageSkips: ImportImageSkip[] = Array.from({ length: filesOf(field(value, "embed")) }, () => "bluesky_no_files" as const);
    yield {
      kept: {
        sourceId: record.uri,
        parentId: kind === "thread" ? parent! : null,
        kind,
        at: created,
        text: finished.text,
        cleaned: finished.removed,
        sourceLinks: linked.count,
        protected: false,
        warning: false,
        images: [],
        imageSkips,
      },
    };
  }
}

export const blueskyAdapter: SourceAdapter = {
  source: "bluesky",
  // Nothing is opened by name: the CAR reader decides what is decoded.
  allowlist: [],
  detect(entries) {
    return entries.length === 1 ? null : "not_this_source";
  },
  readPosts,
};
```

### Create `apps/importer/src/adapters/mastodon/index.ts`

```ts
import { IMPORT_RULES, type ImportImageSkip } from "@korbat/contracts";
import { parseIsoDate } from "../../core";
import { htmlToText } from "../../html";
import { ItemTooLarge, NotJson, streamArray } from "../../json";
import { CONTENT_WARNING_LABEL, cleanDescription, finishText, replaceSourceLinks } from "../../text";
import { ScanFailure, field, isRecord, text, type AdapterItem, type AllowedArchive, type DraftImage, type EntryRule, type ReadContext, type SourceAdapter } from "../types";

/**
 * The Mastodon adapter (3b design, section 5.6), for archives of Mastodon 4.2 and later. It opens outbox.json and,
 * while images are on, the original media files a kept Note names. The order of its checks is the data-minimisation
 * rule: for each item it reads `type` first, then the Note's `to` and `cc`, and only for a kept Note any other field,
 * so a direct or followers-only post is skipped by its addressing before its content is read. actor.json's name is
 * read from the central directory for detect; the file is never opened, nor are likes.json, bookmarks.json, the avatar
 * or the header.
 */

const OUTBOX = "outbox.json";
const ACTOR = "actor.json";
const MEDIA = /^media_attachments[/]files[/]([0-9]{3}[/]){1,8}original[/][0-9a-f]{16}[.](jpg|jpeg|png|webp)$/;
const MEDIA_ROOT = "media_attachments/";
const PUBLIC = new Set(["https://www.w3.org/ns/activitystreams#Public", "as:Public", "Public"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PARAGRAPH = String.fromCharCode(10).repeat(2);

const ALLOWLIST: readonly EntryRule[] = [{ name: OUTBOX }, { name: ACTOR, listOnly: true }, { pattern: MEDIA, images: true }];

/** An addressing field as a list of strings: a single string, an array, or nothing. */
function addresses(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** An attachment's url as an archive path: a leading slash and anything up to media_attachments/ dropped. */
function mediaEntry(url: string | undefined): string | null {
  if (url === undefined) return null;
  const at = url.indexOf(MEDIA_ROOT);
  if (at < 0) return null;
  const path = url.slice(at);
  return MEDIA.test(path) ? path : null;
}

function hostOf(uri: string): string | undefined {
  try {
    return new URL(uri).hostname;
  } catch {
    return undefined;
  }
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "zip") throw new ScanFailure("not_this_source");
  let index = 0;
  try {
    for await (const item of streamArray(archive.open(OUTBOX), { member: "orderedItems" })) {
      context.checkAborted();
      const at = index++;
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const unreadable: AdapterItem = { skipped: "unreadable", index: at };
      // 1. The activity's type, and nothing else of a boost: its embedded object is never read.
      const type = text(item, "type");
      if (type === "Announce") {
        yield { skipped: "repost" };
        continue;
      }
      const note = field(item, "object");
      if (type !== "Create" || !isRecord(note)) {
        yield unreadable;
        continue;
      }
      // 2. The Note's addressing: a post with as:Public in neither to nor cc is private, direct or limited.
      const audience = [...addresses(field(note, "to")), ...addresses(field(note, "cc"))];
      if (!audience.some((address) => PUBLIC.has(address))) {
        yield { skipped: "not_public" };
        continue;
      }
      // 3. Only now, for a public or unlisted Note, any other field.
      const objectType = text(note, "type");
      if (objectType === "Question") {
        yield { skipped: "poll" };
        continue;
      }
      const id = text(note, "id");
      const published = parseIsoDate(field(note, "published"));
      if (objectType !== "Note" || id === undefined || published === null) {
        yield unreadable;
        continue;
      }
      // attributedTo tells a self-reply from a reply and names the person's own host; it is never kept.
      const actor = text(note, "attributedTo") ?? "";
      const inReplyTo = text(note, "inReplyTo");
      const kind = inReplyTo === undefined ? "post" : actor !== "" && inReplyTo.startsWith(`${actor}/statuses/`) ? "thread" : "reply";
      const host = hostOf(actor);
      let body = replaceSourceLinks(htmlToText(text(note, "content") ?? "", { reply: inReplyTo !== undefined }), "mastodon", host);
      const summary = text(note, "summary") ?? "";
      const warning = summary.trim() !== "";
      if (warning) {
        const said = replaceSourceLinks(summary, "mastodon", host);
        body = { text: CONTENT_WARNING_LABEL + said.text + PARAGRAPH + body.text, count: body.count + said.count };
      }
      const finished = finishText(body.text);

      const sensitive = field(note, "sensitive") === true;
      const images: DraftImage[] = [];
      const imageSkips: ImportImageSkip[] = [];
      const attachments = field(note, "attachment");
      for (const attachment of Array.isArray(attachments) ? attachments : []) {
        const mediaType = text(attachment, "mediaType") ?? "";
        if (IMAGE_TYPES.has(mediaType)) {
          if (sensitive) imageSkips.push("sensitive");
          else {
            const entry = mediaEntry(text(attachment, "url"));
            const { alt, cleaned } = cleanDescription(field(attachment, "name"));
            images.push({ entry: entry !== null && archive.has(entry) ? entry : null, alt, altCleaned: cleaned });
          }
        } else if (mediaType.startsWith("video/") || mediaType.startsWith("audio/")) imageSkips.push("video");
        else if (mediaType.startsWith("image/")) imageSkips.push("unsupported");
        // Anything else (a link card) is not an image: ignored.
      }
      yield {
        kept: {
          sourceId: id,
          parentId: kind === "thread" ? inReplyTo! : null,
          kind,
          at: published,
          text: finished.text,
          cleaned: finished.removed,
          sourceLinks: body.count,
          protected: false,
          warning,
          images,
          imageSkips,
        },
      };
    }
  } catch (err) {
    if (err instanceof ItemTooLarge) {
      // The outbox cannot be resumed after an element it could not hold: the rest of it is not read.
      yield { skipped: "item_too_large", index };
      return;
    }
    if (err instanceof NotJson) throw new ScanFailure("unreadable");
    throw err;
  }
}

export const mastodonAdapter: SourceAdapter = {
  source: "mastodon",
  allowlist: ALLOWLIST,
  detect(entries) {
    const outbox = entries.find((entry) => entry.name === OUTBOX);
    const actor = entries.some((entry) => entry.name === ACTOR);
    return outbox !== undefined && outbox.size <= IMPORT_RULES.zipDataMaxBytes && actor ? null : "not_this_source";
  },
  readPosts,
};
```

### Create `apps/importer/src/adapters/types.ts`

```ts
import type { ImportFailure, ImportImageSkip, ImportSkipReason, ImportSource } from "@korbat/contracts";

/**
 * The adapter contract (3b design, section 5.2). Each source is a folder of adapters/ exporting one SourceAdapter: its
 * allowlist of entry names, its detect over the allowlisted names and sizes, and its readPosts. The zip reader filters
 * the central directory through the allowlist before detect sees any name, so an adapter never learns that a file
 * outside it exists; the core does the rest the same way for every source, and an adapter never writes a file.
 */

/**
 * An exact entry name, or one anchored pattern (^...$, never a bare prefix). `images`: the rule applies only while images
 * are imported. `listOnly`: the name and size reach detect (Mastodon's actor.json, 5.6), but the entry is never opened.
 */
export type EntryRule = { name: string; images?: boolean; listOnly?: boolean } | { pattern: RegExp; images?: boolean; listOnly?: boolean };

const matches = (rule: EntryRule, name: string) => ("name" in rule ? rule.name === name : rule.pattern.test(name));

/** Whether an entry named `name` may be opened under `rules`, with images on or off. */
export function isAllowed(rules: readonly EntryRule[], name: string, images: boolean): boolean {
  return rules.some((rule) => rule.listOnly !== true && (rule.images !== true || images) && matches(rule, name));
}

/** Whether `name` is listed for detect only. */
export function isListed(rules: readonly EntryRule[], name: string): boolean {
  return rules.some((rule) => rule.listOnly === true && matches(rule, name));
}

/** An allowlisted entry as detect sees it: its name and its uncompressed size, from the central directory. */
export interface ArchiveEntry {
  name: string;
  size: number;
}

/** A zip whose allowlisted entries alone can be opened: each streams inflated, capped and checked; any other name throws. */
export interface ZipArchive {
  kind: "zip";
  entries: readonly ArchiveEntry[];
  /** Entries whose names failed 7.2 step 2's checks: never opened, only counted. */
  refusedNames: number;
  has(name: string): boolean;
  /** The uncompressed size of an allowlisted entry, or undefined. */
  size(name: string): number | undefined;
  open(name: string): AsyncIterable<Buffer>;
}

/** A post record of a CAR (5.7): its at:// URI and its decoded value, or a record that could not be read. */
export type CarRecord = { uri: string; value: unknown } | { unreadable: true };

/** A CAR is one pseudo-entry whose reader yields post records only (5.2, 5.7). */
export interface CarArchive {
  kind: "car";
  entries: readonly ArchiveEntry[];
  /** The commit's DID: only to recognise the account's own at:// URIs in replies; never stored, logged or written. */
  did: string;
  records(): AsyncIterable<CarRecord>;
}

export type AllowedArchive = ZipArchive | CarArchive;

/** Where a stashed text lies in the scratch file. */
export interface Stashed {
  offset: number;
  length: number;
}

/** What the core lends an adapter while it reads. */
export interface ReadContext {
  /** Whether images are imported (job.json's `images`). */
  images: boolean;
  /** One more element read from a data file (posts and the elements an adapter reads first): false once maxItems are read. */
  takeItem(): boolean;
  /** Keeps a text in the scan's scratch file instead of memory (an X note until its tweet is read), and gives it back. */
  stash(text: string): Promise<Stashed>;
  recall(stashed: Stashed): Promise<string>;
  /** Throws once a deletion request has aborted the scan. */
  checkAborted(): void;
}

/** An image of a post: its allowlisted entry (null when the archive names none) and its source description, cleaned (5.3). */
export interface DraftImage {
  entry: string | null;
  alt: string | null;
  /** The description lost characters to cleaning or became null (counted `cleaned` only when the image is written). */
  altCleaned?: boolean;
}

/**
 * A kept post as an adapter hands it to the core. The source ids stay in the importer's memory: the core turns them
 * into the key and the thread links and never writes them.
 */
export interface DraftPost {
  /** The tweet's id_str, the Note's id URI, the record's at:// URI. */
  sourceId: string;
  /** The source id of the post a thread item answers; the core keeps the link only when that post is kept and earlier. */
  parentId: string | null;
  kind: "post" | "thread" | "reply";
  /** The date the archive gives, in epoch milliseconds; the core cuts it to whole seconds and checks its range. */
  at: number;
  /** korbat's plain text after 5.3's steps 1 to 6. */
  text: string;
  /** Characters step 5 removed from the text. */
  cleaned: number;
  /** Links to the source platform replaced by words (5.3 step 3b). */
  sourceLinks: number;
  protected: boolean;
  warning: boolean;
  /** The photos, in order. */
  images: DraftImage[];
  /** Images left out by the adapter (video, sensitive, unsupported, bluesky_no_files), counted only if the post is written. */
  imageSkips: ImportImageSkip[];
}

/**
 * One item: kept, or skipped with its reason. `index` is the item's place in its data file's stream, given for
 * unreadable and item_too_large only: the one line per item the log holds (7.1), never a text or an id.
 */
export type AdapterItem = { kept: DraftPost } | { skipped: ImportSkipReason; index?: number };

export interface SourceAdapter {
  source: ImportSource;
  /** Entry names this adapter may open. */
  allowlist: readonly EntryRule[];
  /** From the allowlisted entries' names and sizes only: null when the archive is this source's, else why not. */
  detect(entries: readonly ArchiveEntry[]): ImportFailure | null;
  /** Every item the allowlisted files hold, each kept or skipped with its reason; never throws on one item. */
  readPosts(archive: AllowedArchive, context: ReadContext): AsyncIterable<AdapterItem>;
}

/** A refusal of the whole archive, with its failure code (7.1 step 4's `failed` summary). */
export class ScanFailure extends Error {
  constructor(readonly code: ImportFailure) {
    super(code);
    this.name = "ScanFailure";
  }
}

/** The scan was aborted by a deletion request for its archive (7.1, the loop). */
export class ScanAborted extends Error {
  constructor() {
    super("aborted");
    this.name = "ScanAborted";
  }
}

/** Whether a parsed value is an object (not an array): every element of an archive is hostile until read through this. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field of a parsed object, its own only: never one a crafted __proto__ lent it. */
export function field(value: unknown, name: string): unknown {
  return isRecord(value) && Object.hasOwn(value, name) ? value[name] : undefined;
}

/** A field that must be a string, or undefined. */
export function text(value: unknown, name: string): string | undefined {
  const found = field(value, name);
  return typeof found === "string" ? found : undefined;
}
```

### Create `apps/importer/src/adapters/x/index.ts`

```ts
import { IMPORT_RULES, type ImportImageSkip } from "@korbat/contracts";
import { detach, parseIsoDate, parseXDate } from "../../core";
import { ItemTooLarge, NotJson, afterPrefix, streamArray } from "../../json";
import { beforeEllipsis, expandTco, finishText, removeLeadingMentions, replaceSourceLinks, unescapeX } from "../../text";
import {
  ScanFailure,
  field,
  isAllowed,
  isRecord,
  text,
  type AdapterItem,
  type AllowedArchive,
  type DraftImage,
  type EntryRule,
  type ReadContext,
  type SourceAdapter,
  type Stashed,
  type ZipArchive,
} from "../types";

/**
 * The X adapter (3b design, section 5.5). X's file names are known mostly from open-source parsers (3.6), so this is
 * tested against fixtures, not trusted as a contract. It opens only the manifest, the tweet files, the notes, the
 * Circle file (its ids only), the protected history (its timestamps and actions only) and, while images are on, the
 * media of kept posts. direct-messages.js, ip-audit.js, deleted-tweets.js, like.js and every other file are refused by
 * name in the central directory and never inflated.
 */

const MANIFEST = "data/manifest.js";
const MANIFEST_PREFIX = "window.__THAR_CONFIG = ";
/** A data file's prefix, dropped before its JSON: `window.YTD.<name>.part<N> = `. */
const DATA_PREFIX = /^window[.]YTD[.][a-z_]+[.]part[0-9]+ = $/;
/** tweets-part<N>.js with N from 1 to IMPORT_RULES.tweetsPartsMax (99). */
const TWEETS_PART = /^data[/]tweets-part[1-9][0-9]?[.]js$/;
const TWEETS_FILES = ["data/tweet.js", "data/tweets.js"];
const NOTES = "data/note-tweet.js";
const CIRCLE = "data/twitter-circle-tweet.js";
const PROTECTED = "data/protected-history.js";
const MEDIA = /^data[/]tweets?_media[/][0-9]{1,20}-[A-Za-z0-9_-]{1,64}[.](jpg|jpeg|png|webp)$/;
const ID = /^[0-9]{1,20}$/;
const SEMICOLON = ";";

const isTweetsFile = (name: string) => TWEETS_FILES.includes(name) || TWEETS_PART.test(name);

const ALLOWLIST: readonly EntryRule[] = [
  { name: MANIFEST },
  ...TWEETS_FILES.map((name) => ({ name })),
  { pattern: TWEETS_PART },
  { name: NOTES },
  { name: CIRCLE },
  { name: PROTECTED },
  { pattern: MEDIA, images: true },
];

/** The manifest's userName and displayName are never read into a value: the parser drops them as it builds the object. */
const dropNames = (key: string, value: unknown) => (key === "userName" || key === "displayName" ? undefined : value);

interface Manifest {
  accountId: string | null;
  tweets: string[] | null;
  notes: string[] | null;
  circle: string[] | null;
}

async function readWhole(zip: ZipArchive, name: string, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of zip.open(name)) {
    length += chunk.length;
    if (length > maxBytes) throw new ScanFailure("not_this_source");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The file names a manifest lists under one data type, each of which must also be on the allowlist; null without a list. */
function listed(dataTypes: unknown, type: string, accept: (name: string) => boolean): string[] | null {
  const files = field(field(dataTypes, type), "files");
  if (!Array.isArray(files)) return null;
  return files.map((file) => text(file, "fileName")).filter((name): name is string => name !== undefined && accept(name) && isAllowed(ALLOWLIST, name, false));
}

/** The manifest: its prefix exactly, the rest parsed as JSON (never evaluated); a partial archive is refused. */
async function readManifest(zip: ZipArchive): Promise<Manifest> {
  const raw = (await readWhole(zip, MANIFEST, IMPORT_RULES.manifestMaxBytes)).toString("utf8");
  if (!raw.startsWith(MANIFEST_PREFIX)) throw new ScanFailure("not_this_source");
  let body = raw.slice(MANIFEST_PREFIX.length).trimEnd();
  if (body.endsWith(SEMICOLON)) body = body.slice(0, -1);
  let manifest: unknown;
  try {
    manifest = JSON.parse(body, dropNames);
  } catch {
    throw new ScanFailure("not_this_source");
  }
  if (!isRecord(manifest)) throw new ScanFailure("not_this_source");
  if (field(field(manifest, "archiveInfo"), "isPartialArchive") === true) throw new ScanFailure("partial_archive");
  const accountId = text(field(manifest, "userInfo"), "accountId");
  const dataTypes = field(manifest, "dataTypes");
  return {
    accountId: accountId !== undefined && ID.test(accountId) ? accountId : null,
    tweets: listed(dataTypes, "tweets", isTweetsFile),
    notes: listed(dataTypes, "noteTweet", (name) => name === NOTES),
    circle: listed(dataTypes, "twitterCircleTweet", (name) => name === CIRCLE),
  };
}

type Element = { value: unknown; index: number } | { tooLarge: number };

/** The elements of one data file, after its prefix; a file that is not the expected JSON is unreadable. */
async function* elements(zip: ZipArchive, name: string): AsyncGenerator<Element> {
  let index = 0;
  try {
    for await (const value of streamArray(afterPrefix(zip.open(name), DATA_PREFIX))) yield { value, index: index++ };
  } catch (err) {
    if (err instanceof ItemTooLarge) {
      // The element cannot be read past its cap, and the file cannot be resumed after it: the rest of it is not read.
      yield { tooLarge: index };
      return;
    }
    if (err instanceof NotJson) throw new ScanFailure("unreadable");
    throw err;
  }
}

/** The tweet object of an element: `{ "tweet": {...} }`, or in 2019 archives the bare object. */
const tweetOf = (value: unknown) => (isRecord(field(value, "tweet")) ? field(value, "tweet") : value);

/** Protected periods from protected-history.js: only its timestamps and actions. */
function periodsOf(events: { at: number; protect: boolean }[]): [number, number][] {
  const periods: [number, number][] = [];
  let since: number | null = null;
  for (const event of events.sort((a, b) => a.at - b.at)) {
    if (event.protect && since === null) since = event.at;
    else if (!event.protect && since !== null) {
      periods.push([since, event.at]);
      since = null;
    }
  }
  if (since !== null) periods.push([since, Number.POSITIVE_INFINITY]);
  return periods;
}

/** t.co links an entity names, as { url, expanded }. */
function urlEntities(list: unknown, short: string, long: string): { url: string; expanded: string }[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const url = text(entry, short);
    const expanded = text(entry, long);
    return url !== undefined && expanded !== undefined ? [{ url, expanded }] : [];
  });
}

/** Steps 2, 3 and 3b on a tweet's text, before the leading mentions' removal was applied by the caller. */
function convert(raw: string, urls: { url: string; expanded: string }[], media: string[]): { text: string; count: number } {
  return replaceSourceLinks(expandTco(unescapeX(raw), urls, media), "x");
}

async function* readPosts(archive: AllowedArchive, context: ReadContext): AsyncGenerator<AdapterItem> {
  if (archive.kind !== "zip") throw new ScanFailure("not_this_source");
  const manifest = await readManifest(archive);
  const present = (names: readonly string[]) => names.filter((name) => archive.has(name));
  const tweetFiles = present(manifest.tweets ?? archive.entries.map((entry) => entry.name).filter(isTweetsFile));
  const noteFiles = present(manifest.notes ?? [NOTES]);
  const circleFiles = present(manifest.circle ?? [CIRCLE]);

  // The Circle file first, ids only, into a set: its tweets are not public.
  const circle = new Set<string>();
  for (const name of circleFiles) {
    for await (const element of elements(archive, name)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const id = text(tweetOf(element.value), "id_str");
      // Detached: a slice of the file's chunk would keep the whole chunk alive in the set.
      if (id !== undefined) circle.add(detach(id));
    }
  }

  const events: { at: number; protect: boolean }[] = [];
  if (archive.has(PROTECTED)) {
    for await (const element of elements(archive, PROTECTED)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const history = field(element.value, "protectedHistory");
      const at = parseIsoDate(field(history, "protectedAt"));
      const action = text(history, "action");
      if (at !== null && (action === "Protect" || action === "Unprotect")) events.push({ at, protect: action === "Protect" });
    }
  }
  const periods = periodsOf(events);
  const isProtected = (at: number) => periods.some(([from, to]) => at >= from && at < to);

  // Notes wait in the scratch file, converted, keyed in memory by their second only.
  const notes = new Map<number, Stashed[]>();
  for (const name of noteFiles) {
    for await (const element of elements(archive, name)) {
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const note = field(element.value, "noteTweet");
      const at = parseIsoDate(field(note, "createdAt"));
      const core = field(note, "core");
      const raw = text(core, "text");
      if (at === null || raw === undefined) continue;
      const urls = [...urlEntities(field(core, "urls"), "shortUrl", "expandedUrl"), ...urlEntities(field(core, "urls"), "url", "expanded_url")];
      const converted = replaceSourceLinks(expandTco(raw, urls, []), "x");
      const stashed = await context.stash(JSON.stringify(converted));
      const second = Math.floor(at / 1_000);
      notes.set(second, [...(notes.get(second) ?? []), stashed]);
    }
  }

  for (const name of tweetFiles) {
    for await (const element of elements(archive, name)) {
      context.checkAborted();
      if ("tooLarge" in element) {
        yield { skipped: "item_too_large", index: element.tooLarge };
        break;
      }
      if (!context.takeItem()) return yield { skipped: "over_item_cap" };
      const unreadable: AdapterItem = { skipped: "unreadable", index: element.index };
      const tweet = tweetOf(element.value);
      const id = text(tweet, "id_str");
      const fullText = text(tweet, "full_text");
      if (id === undefined || !ID.test(id) || fullText === undefined) {
        yield unreadable;
        continue;
      }
      if (fullText.startsWith("RT @")) {
        yield { skipped: "repost" };
        continue;
      }
      if (circle.has(id)) {
        yield { skipped: "not_public" };
        continue;
      }
      const editInfo = field(tweet, "edit_info");
      const editIds = field(field(editInfo, "initial"), "editTweetIds") ?? field(field(field(editInfo, "edit"), "editControlInitial"), "editTweetIds");
      if (Array.isArray(editIds) && editIds.some((other) => typeof other === "string" && ID.test(other) && BigInt(other) > BigInt(id))) {
        yield { skipped: "older_version" };
        continue;
      }
      const at = parseXDate(field(tweet, "created_at"));
      if (at === null) {
        yield unreadable;
        continue;
      }
      const replyStatus = text(tweet, "in_reply_to_status_id_str");
      const replyUser = text(tweet, "in_reply_to_user_id_str");
      const replying = replyStatus !== undefined && replyStatus !== "";
      const kind = !replying ? "post" : manifest.accountId !== null && replyUser === manifest.accountId ? "thread" : "reply";

      const entities = field(tweet, "entities");
      const extended = field(field(tweet, "extended_entities"), "media");
      const mediaList = Array.isArray(extended) ? extended : Array.isArray(field(entities, "media")) ? (field(entities, "media") as unknown[]) : [];
      const mediaUrls = [...mediaList, ...((field(entities, "media") as unknown[] | undefined) ?? [])].map((m) => text(m, "url")).filter((url): url is string => url !== undefined);
      const range = field(tweet, "display_text_range");
      const start = Array.isArray(range) ? Number(range[0]) : 0;
      let converted = convert(removeLeadingMentions(fullText, start), urlEntities(field(entities, "urls"), "url", "expanded_url"), mediaUrls);

      // A truncated post whose note has the same second and starts with its visible text takes the note's whole text.
      const head = beforeEllipsis(converted.text);
      if (head !== null) {
        for (const stashed of notes.get(Math.floor(at / 1_000)) ?? []) {
          const note = JSON.parse(await context.recall(stashed)) as { text: string; count: number };
          if (note.text.startsWith(head)) {
            converted = note;
            break;
          }
        }
      }
      const finished = finishText(converted.text);

      const images: DraftImage[] = [];
      const imageSkips: ImportImageSkip[] = [];
      const sensitive = field(tweet, "possibly_sensitive") === true;
      for (const media of mediaList) {
        const type = text(media, "type");
        if (type === "video" || type === "animated_gif") imageSkips.push("video");
        else if (type !== "photo") imageSkips.push("unsupported");
        else if (sensitive) imageSkips.push("sensitive");
        else {
          const base = (text(media, "media_url_https") ?? "").split("/").at(-1) ?? "";
          const entry = [`data/tweets_media/${id}-${base}`, `data/tweet_media/${id}-${base}`].find((candidate) => MEDIA.test(candidate) && archive.has(candidate));
          // An X image has no description: the person may write one in the preview (decision 20).
          images.push({ entry: entry ?? null, alt: null });
        }
      }
      yield {
        kept: {
          sourceId: id,
          parentId: kind === "thread" ? replyStatus! : null,
          kind,
          at,
          text: finished.text,
          cleaned: finished.removed,
          sourceLinks: converted.count,
          protected: isProtected(at),
          warning: false,
          images,
          imageSkips,
        },
      };
    }
  }
}

export const xAdapter: SourceAdapter = {
  source: "x",
  allowlist: ALLOWLIST,
  detect(entries) {
    const manifest = entries.find((entry) => entry.name === MANIFEST);
    return manifest !== undefined && manifest.size <= IMPORT_RULES.manifestMaxBytes ? null : "not_this_source";
  },
  readPosts,
};
```

### Create `apps/importer/src/car/mst.ts`

```ts
import { CID } from "multiformats/cid";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure, field, isRecord } from "../adapters/types";

/**
 * The walk of a Bluesky repository's Merkle Search Tree (3b design, 5.7), from the commit's `data`: at most 48 levels,
 * at most 4,096 entries a node, every node visited once (a crafted tree that names one node twice would otherwise make
 * the walk exponential). A node is `{ l, e }`: `l` the subtree before its first entry, each entry `{ p, k, v, t }` with
 * its key prefix-compressed as atproto's repository spec writes it (`p` bytes shared with the previous entry's key in
 * the node, then `k`), `v` the record's CID and `t` the subtree after it. Only the CIDs of keys under
 * app.bsky.feed.post/ are handed on; no other record is decoded.
 */

export const POST_COLLECTION = "app.bsky.feed.post/";
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface MstLimits {
  maxDepth: number;
  maxEntries: number;
}

export const MST_LIMITS: Readonly<MstLimits> = { maxDepth: IMPORT_RULES.mstMaxDepth, maxEntries: IMPORT_RULES.mstMaxEntries };

export interface MstSource {
  /** Marks a node visited; false when it already was. */
  visit(cid: CID): boolean;
  /** The node's decoded value, checked against its CID; throws ScanFailure("unreadable") when it cannot be had. */
  node(cid: CID): Promise<unknown>;
}

const asCid = (value: unknown) => (value === null || value === undefined ? null : CID.asCID(value));

/** The post keys of the tree in key order, each with its record's CID. A broken tree is unreadable. */
export async function* walkPosts(root: CID, source: MstSource, limits: MstLimits = MST_LIMITS): AsyncGenerator<{ key: string; cid: CID }> {
  async function* walk(cid: CID, depth: number): AsyncGenerator<{ key: string; cid: CID }> {
    if (depth > limits.maxDepth) throw new ScanFailure("unreadable");
    if (!source.visit(cid)) return;
    const node = await source.node(cid);
    const entries = field(node, "e");
    const left = field(node, "l");
    if (!isRecord(node) || !Array.isArray(entries) || entries.length > limits.maxEntries) throw new ScanFailure("unreadable");
    const leftCid = asCid(left);
    if (left !== null && left !== undefined && leftCid === null) throw new ScanFailure("unreadable");
    if (leftCid) yield* walk(leftCid, depth + 1);
    let previous = new Uint8Array(0);
    for (const entry of entries) {
      const shared = field(entry, "p");
      const rest = field(entry, "k");
      const value = asCid(field(entry, "v"));
      const rightRaw = field(entry, "t");
      const right = asCid(rightRaw);
      if (typeof shared !== "number" || !Number.isInteger(shared) || shared < 0 || shared > previous.length || !(rest instanceof Uint8Array) || value === null) {
        throw new ScanFailure("unreadable");
      }
      if (rightRaw !== null && rightRaw !== undefined && right === null) throw new ScanFailure("unreadable");
      const key = new Uint8Array(shared + rest.length);
      key.set(previous.subarray(0, shared), 0);
      key.set(rest, shared);
      previous = key;
      let name: string | null;
      try {
        name = UTF8.decode(key);
      } catch {
        name = null;
      }
      if (name !== null && name.startsWith(POST_COLLECTION)) yield { key: name, cid: value };
      if (right) yield* walk(right, depth + 1);
    }
  }
  yield* walk(root, 1);
}
```

### Create `apps/importer/src/car/reader.ts`

```ts
import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { CarIndexer } from "@ipld/car/indexer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure, field, type CarArchive, type CarRecord } from "../adapters/types";
import { readAt } from "../zip/central";
import { MST_LIMITS, POST_COLLECTION, walkPosts } from "./mst";

/**
 * The CAR reader (3b design, 5.7): a Bluesky repository export read in two passes, since a CAR's blocks come in any
 * order. Pass 1, with @ipld/car's CarIndexer, records each block's offset and length without decoding it, refusing a
 * block over 1,000,000 bytes and more than 2,000,000 blocks; the index is keyed by the first 8 bytes of each block's
 * SHA-256 digest in typed arrays (about 16 bytes a slot), never by a CID's string, so 2,000,000 blocks fit in tens of
 * megabytes. Then the commit is decoded and the MST walked (mst.ts), and each post record is read and decoded with
 * @ipld/dag-cbor when the walk reaches its key. Every block decoded is first hashed with node:crypto and compared with
 * its CID's SHA-256 digest; a mismatch is unreadable.
 */

const SHA2_256 = 0x12;
const DAG_CBOR = 0x71;
const DIGEST_BYTES = 32;
/** One read of pass 1. */
const READ_BYTES = 1_048_576;
/** The CAR's one pseudo-entry, as detect sees it. */
export const CAR_ENTRY = "repo.car";
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;

export interface CarLimits {
  maxBlocks: number;
  blockMaxBytes: number;
}

const CAR_LIMITS: Readonly<CarLimits> = { maxBlocks: IMPORT_RULES.carMaxBlocks, blockMaxBytes: IMPORT_RULES.carBlockMaxBytes };

/** The unsigned varint at the start of `bytes`, and its length; null when it does not end within 9 bytes. */
function varint(bytes: Uint8Array): [number, number] | null {
  let value = 0;
  for (let i = 0; i < bytes.length && i < 9; i++) {
    value += (bytes[i]! & 0x7f) * 2 ** (7 * i);
    if ((bytes[i]! & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/** A CAR's first bytes: a varint header length within the block cap, then a CBOR map (major type 5). */
export function looksLikeCar(head: Uint8Array, maxHeader: number = CAR_LIMITS.blockMaxBytes): boolean {
  const read = varint(head);
  if (!read) return false;
  const [length, used] = read;
  return length > 0 && length <= maxHeader && head.length > used && head[used]! >> 5 === 5;
}

const LOAD = 0.7;
const VISITED = 0x80000000;

/** Each block's place in the file, by the first 8 bytes of its SHA-256 digest: open addressing over typed arrays. */
export class BlockIndex {
  private capacity: number;
  private count = 0;
  private hi: Uint32Array;
  private lo: Uint32Array;
  private offsets: Uint32Array;
  /** The block's length plus one (0: an empty slot), with VISITED once the walk took the block. */
  private lengths: Uint32Array;

  constructor(capacity = 1 << 16) {
    this.capacity = capacity;
    this.hi = new Uint32Array(capacity);
    this.lo = new Uint32Array(capacity);
    this.offsets = new Uint32Array(capacity);
    this.lengths = new Uint32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  private static key(digest: Uint8Array): [number, number] {
    return [((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0, ((digest[4]! << 24) | (digest[5]! << 16) | (digest[6]! << 8) | digest[7]!) >>> 0];
  }

  /** The slot holding `hi:lo`, or the empty slot where it would go. */
  private slot(hi: number, lo: number): number {
    const mask = this.capacity - 1;
    let at = lo & mask;
    while (this.lengths[at] !== 0 && (this.hi[at] !== hi || this.lo[at] !== lo)) at = (at + 1) & mask;
    return at;
  }

  private grow(): void {
    const { hi, lo, offsets, lengths, capacity } = this;
    this.capacity = capacity * 2;
    this.hi = new Uint32Array(this.capacity);
    this.lo = new Uint32Array(this.capacity);
    this.offsets = new Uint32Array(this.capacity);
    this.lengths = new Uint32Array(this.capacity);
    for (let i = 0; i < capacity; i++) {
      if (lengths[i] === 0) continue;
      const at = this.slot(hi[i]!, lo[i]!);
      this.hi[at] = hi[i]!;
      this.lo[at] = lo[i]!;
      this.offsets[at] = offsets[i]!;
      this.lengths[at] = lengths[i]!;
    }
  }

  /** Records a block; the first of two blocks with one digest prefix stays (a wrong one fails its hash check when read). */
  put(digest: Uint8Array, offset: number, length: number): void {
    if ((this.count + 1) / this.capacity > LOAD) this.grow();
    const [hi, lo] = BlockIndex.key(digest);
    const at = this.slot(hi, lo);
    if (this.lengths[at] !== 0) return;
    this.hi[at] = hi;
    this.lo[at] = lo;
    this.offsets[at] = offset;
    this.lengths[at] = length + 1;
    this.count++;
  }

  find(digest: Uint8Array): { offset: number; length: number; slot: number } | null {
    const [hi, lo] = BlockIndex.key(digest);
    const at = this.slot(hi, lo);
    const stored = this.lengths[at]!;
    if (stored === 0) return null;
    return { offset: this.offsets[at]!, length: (stored & ~VISITED) - 1, slot: at };
  }

  /** Marks a slot visited; false when it already was. */
  visit(slot: number): boolean {
    const stored = this.lengths[slot]!;
    if ((stored & VISITED) !== 0) return false;
    this.lengths[slot] = (stored | VISITED) >>> 0;
    return true;
  }
}

async function* fileChunks(handle: FileHandle, size: number): AsyncGenerator<Uint8Array> {
  for (let position = 0; position < size; position += READ_BYTES) {
    const chunk = await readAt(handle, position, Math.min(READ_BYTES, size - position));
    if (chunk.length === 0) return;
    yield chunk;
  }
}

const isSha256 = (cid: CID) => cid.multihash.code === SHA2_256 && cid.multihash.digest.length === DIGEST_BYTES;

export interface OpenCarOptions {
  /** Tests only: smaller limits than IMPORT_RULES's. */
  limits?: Partial<CarLimits>;
}

/** Pass 1 and the commit; the records are read as the caller iterates `records()`. */
export async function openCar(handle: FileHandle, size: number, options: OpenCarOptions = {}): Promise<CarArchive> {
  const limits: CarLimits = { ...CAR_LIMITS, ...options.limits };
  // The header's length is checked before @ipld/car reads it, which would otherwise gather any length it is told.
  const head = await readAt(handle, 0, 16);
  if (!looksLikeCar(head, limits.blockMaxBytes)) throw new ScanFailure("not_an_archive");
  let indexer: CarIndexer;
  try {
    indexer = await CarIndexer.fromIterable(fileChunks(handle, size));
  } catch {
    throw new ScanFailure("not_an_archive");
  }
  const roots = await indexer.getRoots();
  if (indexer.version !== 1 || roots.length !== 1) throw new ScanFailure("not_this_source");

  const index = new BlockIndex();
  let blocks = 0;
  try {
    for await (const block of indexer) {
      blocks++;
      if (blocks > limits.maxBlocks) throw new ScanFailure("too_many_entries");
      if (block.blockLength > limits.blockMaxBytes) throw new ScanFailure("unreadable");
      if (isSha256(block.cid)) index.put(block.cid.multihash.digest, block.blockOffset, block.blockLength);
    }
  } catch (err) {
    // @ipld/car's own errors (a truncated section, a bad CID) carry text of the input: only the code is kept.
    throw err instanceof ScanFailure ? err : new ScanFailure("unreadable");
  }

  /**
   * A block's bytes, checked against its CID's digest; null when it is absent or does not match. Blocks are at most
   * 1,000,000 bytes and read one after another, so each is read synchronously from the open descriptor: a round trip
   * through the thread pool for every one of a million small reads would leave the process mostly waiting.
   */
  const blockBytes = async (cid: CID): Promise<Uint8Array | null> => {
    if (!isSha256(cid) || cid.code !== DAG_CBOR) return null;
    const found = index.find(cid.multihash.digest);
    if (!found) return null;
    const bytes = Buffer.alloc(found.length);
    let filled = 0;
    while (filled < found.length) {
      const read = readSync(handle.fd, bytes, filled, found.length - filled, found.offset + filled);
      if (read === 0) return null;
      filled += read;
    }
    const digest = createHash("sha256").update(bytes).digest();
    return digest.equals(cid.multihash.digest) ? bytes : null;
  };
  const decode = (bytes: Uint8Array): unknown => {
    try {
      return dagCbor.decode(bytes);
    } catch {
      return undefined;
    }
  };

  const root = roots[0]!;
  const commitBytes = await blockBytes(root);
  if (!commitBytes) throw new ScanFailure("unreadable");
  const commit = decode(commitBytes);
  const did = field(commit, "did");
  const data = CID.asCID(field(commit, "data"));
  if (typeof did !== "string" || !did.startsWith("did:") || field(commit, "version") !== 3 || data === null) throw new ScanFailure("not_this_source");

  const source = {
    visit: (cid: CID) => {
      const found = isSha256(cid) ? index.find(cid.multihash.digest) : null;
      if (!found) throw new ScanFailure("unreadable");
      return index.visit(found.slot);
    },
    node: async (cid: CID) => {
      const bytes = await blockBytes(cid);
      const node = bytes ? decode(bytes) : undefined;
      if (node === undefined) throw new ScanFailure("unreadable");
      return node;
    },
  };

  async function* records(): AsyncGenerator<CarRecord> {
    for await (const { key, cid } of walkPosts(data!, source, MST_LIMITS)) {
      const bytes = RKEY.test(key.slice(POST_COLLECTION.length)) ? await blockBytes(cid) : null;
      const value = bytes ? decode(bytes) : undefined;
      if (value === undefined) {
        yield { unreadable: true };
        continue;
      }
      // The DID stays in memory: it makes the source id the key is computed from, and is never written.
      yield { uri: `at://${did as string}/${key}`, value };
    }
  }

  return { kind: "car", entries: [{ name: CAR_ENTRY, size }], did, records };
}
```

### Create `apps/importer/src/config.ts`

```ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** import-archives, which this process may only read (mounted read-only). */
  IMPORT_ARCHIVES_DIR: z.string().min(1),
  /** import-work, the only place this process writes. */
  IMPORT_WORK_DIR: z.string().min(1),
});

/** The refusal of a configuration: "Invalid environment:" and what is wrong, on a line of its own. */
const invalid = (message: string) => new Error(["Invalid environment:", message].join(String.fromCharCode(10)));

export interface Config {
  production: boolean;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
  archivesDir: string;
  workDir: string;
}

/**
 * The importer's whole configuration (3b design, 7.1): two directories, a log level and the environment's name. It has
 * no database URL, no Valkey URL and no secret, by design: the one secret it holds is each job's account key, which
 * job.json brings and which leaves the process only as the keys of posts.jsonl.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw invalid(z.prettifyError(result.error));
  return {
    production: result.data.NODE_ENV === "production",
    logLevel: result.data.LOG_LEVEL,
    archivesDir: result.data.IMPORT_ARCHIVES_DIR,
    workDir: result.data.IMPORT_WORK_DIR,
  };
}
```

### Create `apps/importer/src/core.ts`

```ts
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import {
  IMPORT_RULES,
  ImportedPost,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_POST,
  postLength,
  visibleLength,
  type ImportImageSkip,
  type ImportSkipReason,
  type ImportSource,
} from "@korbat/contracts";
import { mediaFileName, serializeLine, type ImportImageExtension, type WorkLayout } from "@korbat/import-protocol";
import { ScanAborted, type AdapterItem, type DraftPost, type ReadContext, type Stashed } from "./adapters/types";

/**
 * The importer's core (3b design, section 5.4), the same for every source: the key, the date checks, the caps, the
 * thread links, the sort, the image extraction and the writing. While the adapter reads, it keeps in memory only a heap
 * of at most maxPosts candidates (each one's date, key, source id, parent's source id and where its text lies in the
 * scratch file); the converted text and the media names wait in the scratch file on the work volume. After the read it
 * sorts the kept posts by date (ties by key), numbers them from 0, gives the image slots to the newest posts first,
 * inflates only the images of kept posts, and writes each line through the contract and the one serialiser.
 */

const DAY_MS = 86_400_000;
const EARLIEST_MS = Date.parse(`${IMPORT_RULES.earliestDate}T00:00:00Z`);
/** How much of posts.jsonl is gathered before one write. */
const FLUSH_BYTES = 1_048_576;

export interface CoreLimits {
  maxPosts: number;
  maxImages: number;
  maxItems: number;
}

const CORE_LIMITS: Readonly<CoreLimits> = { maxPosts: IMPORT_RULES.maxPosts, maxImages: IMPORT_RULES.maxImages, maxItems: IMPORT_RULES.maxItems };

/** The archive's allowlisted images, as the core reads them: an entry's size (undefined when absent) and its bytes. */
export interface CoreArchive {
  size(name: string): number | undefined;
  open(name: string): AsyncIterable<Buffer>;
}

export interface CoreHooks {
  /** Each file renamed into the job's folder, relative to it (tests: the order of the commit). */
  placed?(relative: string): void;
}

export interface CoreOptions {
  id: string;
  work: WorkLayout;
  source: ImportSource;
  /** The account's import key, 32 bytes (job.json's accountKey). */
  accountKey: Buffer;
  /** The import's creation: a date more than futureDays after it is out of range. */
  createdAt: Date;
  images: boolean;
  log: Logger;
  signal: AbortSignal;
  archive?: CoreArchive | undefined;
  /** Tests only: smaller caps than IMPORT_RULES's. */
  limits?: Partial<CoreLimits> | undefined;
  hooks?: CoreHooks | undefined;
}

export interface CoreCounts {
  posts: number;
  images: number;
  skipped: Partial<Record<ImportSkipReason, number>>;
  imagesSkipped: Partial<Record<ImportImageSkip, number>>;
  cleaned: number;
  warnings: number;
  sourceLinks: number;
  protectedPosts: number;
  readInPart: boolean;
}

/**
 * A copy of `text` that stands on its own. A string the JSON tokenizer produced can be a slice of the whole chunk of the
 * file it came from, which it then keeps alive: a source id held in the heap would pin its 64 KB chunk, and 50,000 of
 * them hundreds of megabytes. JSON's round trip makes a fresh string with the same characters, lone surrogates included.
 */
export function detach(text: string): string {
  return JSON.parse(JSON.stringify(text)) as string;
}

/** HMAC-SHA256(accountKey, source + ":" + sourcePostId) as 64 lowercase hex (5.4): no key of the server alone links accounts. */
export function importKey(accountKey: Buffer, source: ImportSource, sourceId: string): string {
  return createHmac("sha256", accountKey).update(`${source}:${sourceId}`).digest("hex");
}

/** One candidate in memory: never its text, which waits in the scratch file. */
interface Candidate {
  /** Whole seconds since the epoch. */
  at: number;
  key: string;
  sourceId: string;
  parentId: string | null;
  offset: number;
  length: number;
  /** Its images that exist in the archive within 20 MiB (the ones that may take an image slot). */
  available: number;
  /** Slots given after the read. */
  granted: number;
}

/** What the scratch file holds for a candidate: the converted text and the media entries, never a source id. */
interface ScratchRecord {
  text: string;
  kind: DraftPost["kind"];
  protected: boolean;
  warning: boolean;
  cleaned: number;
  sourceLinks: number;
  /** The available images: entry, description, whether its description was cleaned. */
  images: [string, string | null, boolean][];
  /** Images already left out, by reason. */
  skips: ImportImageSkip[];
}

const before = (a: Candidate, b: Candidate) => a.at < b.at || (a.at === b.at && a.key < b.key);

/** A min-heap by (date, key): its root is the oldest kept candidate, the first to give way to a newer one. */
class Heap {
  readonly items: Candidate[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): Candidate | undefined {
    return this.items[0];
  }

  push(item: Candidate): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  replaceRoot(item: Candidate): void {
    const items = this.items;
    items[0] = item;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let least = i;
      if (left < items.length && before(items[left]!, items[least]!)) least = left;
      if (right < items.length && before(items[right]!, items[least]!)) least = right;
      if (least === i) return;
      [items[i], items[least]] = [items[least]!, items[i]!];
      i = least;
    }
  }
}

/** The first bytes of the image types korbat takes; anything else is `unsupported`. */
function sniff(head: Buffer): ImportImageExtension | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

const SNIFF_BYTES = 12;

export class ScanCore {
  readonly context: ReadContext;
  private readonly limits: CoreLimits;
  private readonly heap = new Heap();
  private readonly key: Buffer;
  private readonly latestMs: number;
  private scratch: FileHandle | null = null;
  /** The scratch file's length including what waits in `pending`, and how much of it is on disk. */
  private scratchSize = 0;
  private flushedSize = 0;
  private pending: Buffer[] = [];
  private items = 0;
  private readonly counts: CoreCounts = { posts: 0, images: 0, skipped: {}, imagesSkipped: {}, cleaned: 0, warnings: 0, sourceLinks: 0, protectedPosts: 0, readInPart: false };

  constructor(private readonly options: CoreOptions) {
    this.limits = { ...CORE_LIMITS, ...options.limits };
    this.key = options.accountKey;
    this.latestMs = options.createdAt.getTime() + IMPORT_RULES.futureDays * DAY_MS;
    this.context = {
      images: options.images,
      takeItem: () => {
        if (this.items >= this.limits.maxItems) return false;
        this.items++;
        return true;
      },
      stash: (text) => this.append(text),
      recall: (stashed) => this.readScratch(stashed),
      checkAborted: () => this.checkAborted(),
    };
  }

  /** Creates the scratch file on the work volume (the 16 MB tmpfs never holds it). */
  async open(): Promise<void> {
    await mkdir(this.options.work.tmp, { recursive: true });
    this.scratch = await open(this.options.work.scratch(this.options.id), "w+");
  }

  /** Closes and deletes the scratch file; safe to call twice. */
  async close(): Promise<void> {
    const handle = this.scratch;
    this.scratch = null;
    if (handle) await handle.close();
    await rm(this.options.work.scratch(this.options.id), { force: true });
  }

  private checkAborted(): void {
    if (this.options.signal.aborted) throw new ScanAborted();
  }

  /** Appends go to the scratch file a megabyte at a time: one write each would leave the scan waiting on the disk. */
  private async append(text: string): Promise<Stashed> {
    if (!this.scratch) throw new Error("the scratch file is not open");
    const bytes = Buffer.from(text, "utf8");
    const offset = this.scratchSize;
    this.pending.push(bytes);
    this.scratchSize += bytes.length;
    if (this.scratchSize - this.flushedSize >= FLUSH_BYTES) await this.flushScratch();
    return { offset, length: bytes.length };
  }

  private async flushScratch(): Promise<void> {
    if (!this.scratch || this.pending.length === 0) return;
    const bytes = Buffer.concat(this.pending);
    this.pending = [];
    await this.scratch.write(bytes, 0, bytes.length, this.flushedSize);
    this.flushedSize += bytes.length;
  }

  private async readScratch({ offset, length }: Stashed): Promise<string> {
    if (!this.scratch) throw new Error("the scratch file is not open");
    if (offset + length > this.flushedSize) await this.flushScratch();
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await this.scratch.read(buffer, 0, length, offset);
    return buffer.toString("utf8", 0, bytesRead);
  }

  private skip(reason: ImportSkipReason, by = 1): void {
    this.counts.skipped[reason] = (this.counts.skipped[reason] ?? 0) + by;
  }

  private skipImage(reason: ImportImageSkip, by = 1): void {
    if (by > 0) this.counts.imagesSkipped[reason] = (this.counts.imagesSkipped[reason] ?? 0) + by;
  }

  /** One item from the adapter: counted when skipped, else checked and kept as a candidate. */
  async add(item: AdapterItem): Promise<void> {
    this.checkAborted();
    if ("skipped" in item) {
      this.skip(item.skipped);
      if (item.skipped === "over_item_cap") this.counts.readInPart = true;
      // The one log line per item (7.1): its reason and its index in the stream, for these two reasons only.
      if ((item.skipped === "unreadable" || item.skipped === "item_too_large") && item.index !== undefined) {
        this.options.log.warn({ id: this.options.id, reason: item.skipped, index: item.index }, "item skipped");
      }
      return;
    }
    const draft = item.kept;
    if (!Number.isFinite(draft.at) || draft.at < EARLIEST_MS || draft.at > this.latestMs) return this.skip("date_out_of_range");
    if (postLength(draft.text) > IMPORT_RULES.textMax) return this.skip("too_long_to_read");

    const images: ScratchRecord["images"] = [];
    const skips = [...draft.imageSkips];
    for (const image of draft.images) {
      if (!this.options.images) skips.push("images_off");
      else if (image.entry === null) skips.push("missing_file");
      else {
        const size = this.options.archive?.size(image.entry);
        if (size === undefined) skips.push("missing_file");
        else if (size > MEDIA_MAX_BYTES) skips.push("too_large");
        else images.push([image.entry, image.alt, image.altCleaned === true]);
      }
    }
    if (visibleLength(draft.text) === 0 && images.length === 0) return this.skip("empty");

    const candidate: Candidate = {
      at: Math.floor(draft.at / 1_000),
      key: importKey(this.key, this.options.source, draft.sourceId),
      // Held until the scan ends, so detached from the chunk of the file they were read from.
      sourceId: detach(draft.sourceId),
      parentId: draft.kind === "thread" && draft.parentId !== null ? detach(draft.parentId) : null,
      offset: 0,
      length: 0,
      available: images.length,
      granted: 0,
    };
    // Full: the newest maxPosts stay. A candidate older than every kept one is counted at once and never stored.
    const oldest = this.heap.peek();
    if (this.heap.size >= this.limits.maxPosts && oldest && !before(oldest, candidate)) return this.skip("over_post_cap");
    const record: ScratchRecord = { text: draft.text, kind: draft.kind, protected: draft.protected, warning: draft.warning, cleaned: draft.cleaned, sourceLinks: draft.sourceLinks, images, skips };
    const stashed = await this.append(JSON.stringify(record));
    candidate.offset = stashed.offset;
    candidate.length = stashed.length;
    if (this.heap.size < this.limits.maxPosts) this.heap.push(candidate);
    else {
      this.heap.replaceRoot(candidate);
      this.skip("over_post_cap");
    }
  }

  /** Copies one image into tmp/ and then into media/, named by its bytes' type; null when the type is not one korbat takes. */
  private async placeImage(entry: string, ref: number, position: number): Promise<string | null> {
    const { work, id, archive } = this.options;
    if (!archive) return null;
    const temporary = path.join(work.tmp, randomUUID());
    const handle = await open(temporary, "w");
    let extension: ImportImageExtension | null = null;
    let head = Buffer.alloc(0);
    let decided = false;
    try {
      for await (const chunk of archive.open(entry)) {
        this.checkAborted();
        if (!decided) {
          head = Buffer.concat([head, chunk]);
          if (head.length < SNIFF_BYTES) continue;
          decided = true;
          extension = sniff(head);
          if (!extension) break;
          await handle.write(head);
          continue;
        }
        await handle.write(chunk);
      }
      if (!decided) {
        extension = sniff(head);
        if (extension) await handle.write(head);
      }
      if (extension) await handle.sync();
    } finally {
      await handle.close();
    }
    if (!extension) {
      await rm(temporary, { force: true });
      return null;
    }
    const file = mediaFileName(ref, position, extension);
    await mkdir(work.mediaDir(id), { recursive: true });
    await rename(temporary, work.media(id, file));
    this.options.hooks?.placed?.(`media/${file}`);
    return file;
  }

  /**
   * After the read: sorts the kept posts, gives the image slots to the newest posts first, and writes the images and
   * then posts.jsonl (through tmp/ and a rename). Returns the counts; summary.json is the caller's last write.
   */
  async finish(): Promise<CoreCounts> {
    const { work, id, log } = this.options;
    const kept = [...this.heap.items].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
    let slots = this.limits.maxImages;
    for (let i = kept.length - 1; i >= 0; i--) {
      const candidate = kept[i]!;
      candidate.granted = Math.min(candidate.available, MEDIA_MAX_PER_POST, slots);
      slots -= candidate.granted;
    }

    const temporary = path.join(work.tmp, randomUUID());
    const out = await open(temporary, "w");
    const refs = new Map<string, number>();
    let pending = "";
    let previousKey: string | null = null;
    try {
      for (const candidate of kept) {
        this.checkAborted();
        // The same source id twice: the second copy is no new post.
        if (candidate.key === previousKey) {
          this.skip("unreadable");
          continue;
        }
        previousKey = candidate.key;
        const record = JSON.parse(await this.readScratch(candidate)) as ScratchRecord;
        const ref = this.counts.posts;
        const media: { file: string; alt: string | null }[] = [];
        const imageSkips: ImportImageSkip[] = [...record.skips];
        let altCleaned = false;
        for (const [index, [entry, alt, cleaned]] of record.images.entries()) {
          if (index >= candidate.granted) {
            imageSkips.push("over_image_cap");
            continue;
          }
          const file = await this.placeImage(entry, ref, media.length);
          if (file === null) {
            imageSkips.push("unsupported");
            continue;
          }
          media.push({ file, alt });
          altCleaned ||= cleaned;
        }
        // A thread keeps its link only to a written post, which is earlier in the sort and so has a lower ref.
        const parentRef = record.kind === "thread" && candidate.parentId !== null ? refs.get(candidate.parentId) : undefined;
        const kind = record.kind === "thread" && parentRef === undefined ? "post" : record.kind;
        const parsed = ImportedPost.safeParse({
          ref,
          key: candidate.key,
          at: new Date(candidate.at * 1_000).toISOString().replace(".000Z", "Z"),
          kind,
          parent: kind === "thread" ? parentRef : null,
          text: record.text,
          media,
          protected: record.protected,
          warning: record.warning,
        });
        if (!parsed.success) {
          for (const { file } of media) await rm(work.media(id, file), { force: true });
          this.skip(visibleLength(record.text) === 0 && media.length === 0 ? "empty" : "unreadable");
          continue;
        }
        pending += serializeLine(parsed.data);
        if (pending.length >= FLUSH_BYTES) {
          await out.write(pending);
          pending = "";
        }
        refs.set(candidate.sourceId, ref);
        this.counts.posts++;
        this.counts.images += media.length;
        for (const reason of imageSkips) this.skipImage(reason);
        if (record.warning) this.counts.warnings++;
        if (record.protected) this.counts.protectedPosts++;
        this.counts.sourceLinks += record.sourceLinks;
        if (record.cleaned > 0 || altCleaned) this.counts.cleaned++;
      }
      if (pending !== "") await out.write(pending);
      await out.sync();
    } finally {
      await out.close();
    }
    if (this.counts.posts > 0) {
      await rename(temporary, work.posts(id));
      this.options.hooks?.placed?.("posts.jsonl");
    } else await rm(temporary, { force: true });
    log.info({ id, phase: "written", posts: this.counts.posts, images: this.counts.images }, "lines written");
    return this.counts;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const X_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2}) ([0-9]{4})$/;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})([.][0-9]{1,9})?([Zz]|([+-])([0-9]{2}):([0-9]{2}))$/;

/** Epoch milliseconds of a UTC calendar time, or null when a field is out of its range (Feb 30, 25:00). */
function utc(year: number, month: number, day: number, hour: number, minute: number, second: number): number | null {
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return ms;
}

/** X's created_at ("Wed Oct 10 20:19:24 +0000 2018"), by a strict pattern, in epoch milliseconds UTC; null otherwise. */
export function parseXDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = X_DATE.exec(value);
  if (!m) return null;
  const ms = utc(Number(m[10]), MONTHS.indexOf(m[2]!) + 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (ms === null) return null;
  const offset = (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  return m[7] === "+" ? ms - offset : ms + offset;
}

/** An RFC 3339 / ISO 8601 time with a zone (Mastodon's published, Bluesky's createdAt, X's notes), in epoch milliseconds UTC. */
export function parseIsoDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const ms = utc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (ms === null) return null;
  const fraction = m[7] ? Math.floor(Number(`0${m[7]}`) * 1_000) : 0;
  if (m[9] === undefined) return ms + fraction;
  const offset = (Number(m[10]) * 60 + Number(m[11])) * 60_000;
  return (m[9] === "+" ? ms - offset : ms + offset) + fraction;
}
```

### Create `apps/importer/src/html.ts`

```ts
/**
 * 5.3 step 1 (Mastodon): HTML to text with a tokenizer of korbat's own, never a DOM and never rendering. <p> and </p>
 * become paragraph breaks, <br> a line break, an <a> its text (joined back into its href when the text is a shortened
 * form of it, as Mastodon shortens long links with invisible spans), every other tag is dropped with its attributes,
 * and the five named entities and numeric entities are decoded. A quote's fallback (class quote-inline, "RE: <link>")
 * is dropped whole, and for a reply (step 4) the run of mention links at its very start is removed, so the reply keeps
 * no handle of the person it answered. Mentions inside the text stay as typed.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ELLIPSIS = String.fromCharCode(0x2026);
const PARAGRAPH = LF + LF;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/g;
const BLANK = new RegExp(`^[ ${TAB}${LF}${CR}]*$`);

/** The five named entities and numeric ones; a numeric entity that is no character (0, a surrogate, past U+10FFFF) is removed. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_, name: string | undefined, decimal: string | undefined, hex: string | undefined) => {
    if (name !== undefined) return NAMED[name]!;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

const isSpace = (c: string) => c === " " || c === TAB || c === LF || c === CR || c === String.fromCharCode(12);

interface Tag {
  name: string;
  closing: boolean;
  attributes: Map<string, string>;
}

/** Reads one tag from `html` at `at` (just past its "<"); returns it and where it ends, or null when it never closes. */
function readTag(html: string, at: number): { tag: Tag; end: number } | null {
  let i = at;
  const closing = html[i] === "/";
  if (closing) i++;
  let name = "";
  while (i < html.length && /[A-Za-z0-9-]/.test(html[i]!)) name += html[i++];
  const attributes = new Map<string, string>();
  while (i < html.length && html[i] !== ">") {
    if (isSpace(html[i]!) || html[i] === "/") {
      i++;
      continue;
    }
    let key = "";
    while (i < html.length && !isSpace(html[i]!) && html[i] !== "=" && html[i] !== ">" && html[i] !== "/") key += html[i++];
    while (i < html.length && isSpace(html[i]!)) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && isSpace(html[i]!)) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < html.length && !isSpace(html[i]!) && html[i] !== ">") value += html[i++];
      }
    }
    if (key !== "") attributes.set(key.toLowerCase(), decodeEntities(value));
  }
  if (i >= html.length) return null;
  return { tag: { name: name.toLowerCase(), closing, attributes }, end: i + 1 };
}

/** A link's text, or its href when the text is a shortened form of it (the start of it, perhaps with an ellipsis). */
function linkText(text: string, href: string | undefined): string {
  if (href === undefined || !/^https?:[/][/]/i.test(href)) return text;
  let shown = text.trim();
  if (shown.endsWith(ELLIPSIS)) shown = shown.slice(0, -1);
  else if (shown.endsWith("...")) shown = shown.slice(0, -3);
  if (shown === "") return text;
  const bare = href.replace(/^https?:[/][/]/i, "");
  const forms = [href, bare, bare.replace(/^www[.]/i, "")];
  return forms.some((form) => form.startsWith(shown)) ? href : text;
}

const classes = (tag: Tag) => (tag.attributes.get("class") ?? "").split(" ").filter((c) => c !== "");

export interface HtmlOptions {
  /** The item answers another post (inReplyTo): its leading run of mention links is removed. */
  reply?: boolean;
}

export function htmlToText(html: string, options: HtmlOptions = {}): string {
  let out = "";
  let leading = options.reply === true;
  let link: { href: string | undefined; text: string; drop: boolean } | null = null;
  let skip: { tag: string; depth: number } | null = null;

  const emit = (text: string) => {
    if (text === "" || skip) return;
    if (link) {
      link.text += text;
      return;
    }
    if (leading) {
      // Before anything visible, white space between dropped mentions is dropped with them.
      if (BLANK.test(text)) return;
      leading = false;
    }
    out += text;
  };
  const breakLine = (text: string) => {
    if (skip) return;
    if (link) link.text += text;
    else if (out !== "") out += text;
  };

  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    const textEnd = open < 0 ? html.length : open;
    if (textEnd > i) {
      // Text between tags: its own line breaks and tabs are only white space, as a browser would show them.
      let text = decodeEntities(html.slice(i, textEnd));
      for (const c of [CR, LF, TAB]) text = text.replaceAll(c, " ");
      emit(text);
    }
    if (open < 0) break;
    const next = html[open + 1];
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const close = html.indexOf(">", open);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z/]/.test(next)) {
      emit("<");
      i = open + 1;
      continue;
    }
    const read = readTag(html, open + 1);
    if (!read) break;
    i = read.end;
    const { tag } = read;
    if (skip) {
      if (tag.name === skip.tag) skip.depth += tag.closing ? -1 : 1;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (!tag.closing && classes(tag).includes("quote-inline")) {
      skip = { tag: tag.name, depth: 1 };
      continue;
    }
    switch (tag.name) {
      case "p":
        breakLine(PARAGRAPH);
        break;
      case "br":
        breakLine(LF);
        break;
      case "a":
        if (!tag.closing && !link) {
          const kinds = classes(tag);
          link = { href: tag.attributes.get("href"), text: "", drop: leading && kinds.includes("mention") && kinds.includes("u-url") };
        } else if (tag.closing && link) {
          const finished = link;
          link = null;
          if (!finished.drop) emit(linkText(finished.text, finished.href));
        }
        break;
      default:
        break;
    }
  }
  if (link && !link.drop) {
    const finished = link;
    link = null;
    emit(finished.text);
  }
  return out;
}
```

### Create `apps/importer/src/index.ts`

```ts
import { setTimeout as sleep } from "node:timers/promises";
import pino from "pino";
import { IMPORT_RULES } from "@korbat/contracts";
import { IMPORTER_HEARTBEAT_INTERVAL_MS, archivesLayout, workLayout } from "@korbat/import-protocol";
import { loadConfig } from "./config";
import { prepareWork, tick, writeHeartbeat, type LoopDeps } from "./loop";
import { errorCode } from "./scan";

/**
 * The importer (3b design, section 7.1; decision 1). It reads archives from one volume and writes normalised posts,
 * images and a heartbeat to another, one archive at a time. It has no network, no database, no Valkey and no secret but
 * the per-account key each job brings: the two volumes are everything it can reach.
 */
const config = loadConfig();
const log = pino({ level: config.logLevel, base: undefined });

const deps: LoopDeps = {
  archives: archivesLayout(config.archivesDir),
  work: workLayout(config.workDir),
  log,
  now: Date.now,
  idleMs: IMPORT_RULES.idleMs,
  watchdogMs: IMPORT_RULES.watchdogMs,
  abort: (reason) => {
    log.fatal({ reason }, "watchdog: exiting so the container restarts");
    process.exit(1);
  },
};

await prepareWork(deps.work);
await writeHeartbeat(deps);
// The heartbeat has its own timer, so it keeps beating while a long scan awaits its reads.
const heartbeat = setInterval(() => void writeHeartbeat(deps).catch((caught: unknown) => log.error({ error: errorCode(caught) }, "heartbeat failed")), IMPORTER_HEARTBEAT_INTERVAL_MS);

let running = true;
const stop = (signal: string) => {
  log.info({ signal }, "stopping after the current scan");
  running = false;
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

log.info({ phase: "ready" }, "importer started");
while (running) {
  const worked = await tick(deps).catch((caught: unknown) => {
    log.error({ error: errorCode(caught) }, "tick failed");
    return false;
  });
  if (!worked) await sleep(deps.idleMs);
}
clearInterval(heartbeat);
```

### Create `apps/importer/src/json.ts`

```ts
import * as tokenizer from "stream-json/core/parser.js";
import type { Token } from "stream-json/core/parser.js";
import { IMPORT_RULES } from "@korbat/contracts";

/**
 * korbat's own assembler over stream-json's tokenizer (3b design, 5.5): it streams the elements of one array of a
 * data file, building one element at a time and counting its bytes and depth as it grows, so that an element over
 * 1 MiB or 64 levels is refused (item_too_large) before more of it is held. Everything outside the streamed array is
 * passed over without being held. stream-json's own Assembler and array streamer are not used: they hold an element
 * whole before its size can be read.
 *
 * The tokenizer is stream-json 3's documented raw `jsonParser` (the bare state machine; the caller decodes UTF-8),
 * with packValues off, so strings, keys and numbers arrive as chunks of at most one read. Its typings name only the
 * gen pipeline, so its shape is declared here: a function of text that returns stream-chain's many() (`values`) or none.
 */

type Tokens = { values: Token[] } | symbol;
const jsonParser = (tokenizer as unknown as { jsonParser: (options: { packValues: boolean }) => (text: string) => Tokens }).jsonParser;

/** One element went past the byte or depth cap: the adapter counts item_too_large and stops reading that file. */
export class ItemTooLarge extends Error {
  constructor() {
    super("item_too_large");
    this.name = "ItemTooLarge";
  }
}

/** Not JSON, or not the shape asked for. The tokenizer's message is never kept: it can quote the input. */
export class NotJson extends Error {
  constructor() {
    super("not_json");
    this.name = "NotJson";
  }
}

export interface JsonLimits {
  /** Characters held for one element (strings, keys and numbers by their length, one for every other token). */
  maxBytes: number;
  maxDepth: number;
}

const ITEM_LIMITS: JsonLimits = { maxBytes: IMPORT_RULES.itemMaxBytes, maxDepth: IMPORT_RULES.itemMaxDepth };
/** The end of a file is held back by this many characters, so that a trailing semicolon can be taken off it before it is parsed. */
const HOLD_BACK = 64;
const SEMICOLON = ";";

type Container = { kind: "object"; value: Record<string, unknown>; key: string | null } | { kind: "array"; value: unknown[] };

/** Builds one element from its tokens, refusing it as soon as it is too large or too deep. */
class Builder {
  private stack: Container[] = [];
  private text: string | null = null;
  private keyText: string | null = null;
  private bytes = 0;
  /** The finished element, once its last token arrived. */
  done = false;
  value: unknown = undefined;

  constructor(private readonly limits: JsonLimits) {}

  private grow(by: number): void {
    this.bytes += by;
    if (this.bytes > this.limits.maxBytes) throw new ItemTooLarge();
  }

  private place(value: unknown): void {
    const top = this.stack.at(-1);
    if (!top) {
      this.value = value;
      this.done = true;
    } else if (top.kind === "array") top.value.push(value);
    else {
      // Objects have no prototype, so a key named __proto__ is only a key.
      if (top.key === null) throw new NotJson();
      top.value[top.key] = value;
      top.key = null;
    }
  }

  private open(container: Container): void {
    this.grow(1);
    this.stack.push(container);
    if (this.stack.length > this.limits.maxDepth) throw new ItemTooLarge();
  }

  token(token: Token): void {
    switch (token.name) {
      case "startObject":
        this.open({ kind: "object", value: Object.create(null) as Record<string, unknown>, key: null });
        return;
      case "startArray":
        this.open({ kind: "array", value: [] });
        return;
      case "endObject":
      case "endArray": {
        this.grow(1);
        const top = this.stack.pop();
        if (!top) throw new NotJson();
        this.place(top.value);
        return;
      }
      case "startKey":
        this.keyText = "";
        return;
      case "endKey": {
        const top = this.stack.at(-1);
        if (!top || top.kind !== "object" || this.keyText === null) throw new NotJson();
        top.key = this.keyText;
        this.keyText = null;
        return;
      }
      case "startString":
      case "startNumber":
        this.text = "";
        return;
      case "stringChunk":
      case "numberChunk":
        this.grow(token.value.length);
        if (this.keyText !== null) this.keyText += token.value;
        else this.text += token.value;
        return;
      case "endString": {
        this.grow(1);
        const value = this.text ?? "";
        this.text = null;
        this.place(value);
        return;
      }
      case "endNumber": {
        this.grow(1);
        const value = Number(this.text);
        this.text = null;
        this.place(value);
        return;
      }
      case "nullValue":
      case "trueValue":
      case "falseValue":
        this.grow(1);
        this.place(token.value);
        return;
      default:
        // Packed values are off and the JSON tokenizer emits no whitespace tokens; anything else is not ours.
        return;
    }
  }
}

export interface StreamArrayOptions {
  /** The member of the top-level object whose array is streamed (Mastodon's orderedItems); without it, the top-level array. */
  member?: string;
  limits?: JsonLimits;
}

/**
 * The elements of one array, one at a time. Throws NotJson for a syntax error, a truncated file or another shape, and
 * ItemTooLarge for an element over a cap (after yielding every element before it).
 */
export async function* streamArray(chunks: AsyncIterable<Uint8Array>, options: StreamArrayOptions = {}): AsyncGenerator<unknown> {
  const limits = options.limits ?? ITEM_LIMITS;
  const parse = jsonParser({ packValues: false });
  const decoder = new TextDecoder("utf-8");
  const member = options.member;

  // Where the parser stands: its depth, and what the walk is doing at that depth.
  let depth = 0;
  let started = false;
  /** The depth of the streamed array's elements, once it was found. */
  let itemDepth = -1;
  let finished = false;
  /** While seeking `member`: the key being read at depth 1 (cut once it is longer than `member`), and whether it matched. */
  let key: string | null = null;
  let matched = false;
  let builder: Builder | null = null;
  const ready: unknown[] = [];

  const step = (token: Token): void => {
    if (finished) return;
    if (builder) {
      builder.token(token);
      if (builder.done) {
        ready.push(builder.value);
        builder = null;
      }
      if (token.name === "startObject" || token.name === "startArray") depth++;
      else if (token.name === "endObject" || token.name === "endArray") depth--;
      return;
    }
    if (!started) {
      started = true;
      if (member === undefined) {
        if (token.name !== "startArray") throw new NotJson();
        depth = 1;
        itemDepth = 1;
        return;
      }
      if (token.name !== "startObject") throw new NotJson();
      depth = 1;
      return;
    }
    if (itemDepth >= 0 && depth === itemDepth) {
      // Inside the streamed array, between elements.
      if (token.name === "endArray") {
        finished = true;
        return;
      }
      builder = new Builder(limits);
      step(token);
      return;
    }
    // Seeking the member, or passing over a value that is not it.
    switch (token.name) {
      case "startObject":
      case "startArray":
        if (depth === 1 && matched) {
          if (token.name !== "startArray") throw new NotJson();
          itemDepth = 2;
          depth = 2;
          matched = false;
          return;
        }
        depth++;
        matched = false;
        return;
      case "endObject":
      case "endArray":
        depth--;
        if (depth === 0) throw new NotJson();
        return;
      case "startKey":
        if (depth === 1) key = "";
        return;
      case "stringChunk":
        if (key !== null && member !== undefined && key.length <= member.length) key += token.value;
        return;
      case "endKey":
        if (key !== null) matched = key === member;
        key = null;
        return;
      case "endString":
      case "endNumber":
      case "nullValue":
      case "trueValue":
      case "falseValue":
        // A scalar member value: if it was the member, the shape is wrong.
        if (depth === 1 && matched) throw new NotJson();
        return;
      default:
        return;
    }
  };

  const feed = (text: string): void => {
    if (text === "" || finished) return;
    let result: Tokens;
    try {
      result = parse(text);
    } catch {
      throw new NotJson();
    }
    if (typeof result === "symbol") return;
    for (const token of result.values) {
      step(token);
      if (finished) return;
    }
  };

  /** Feeds `text`, then hands out every element it finished, those before a refused one included, then the refusal. */
  async function* fed(text: string): AsyncGenerator<unknown> {
    let failure: unknown = null;
    try {
      feed(text);
    } catch (err) {
      failure = err;
    }
    while (ready.length > 0) yield ready.shift();
    if (failure !== null) throw failure;
  }

  let pending = "";
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length > HOLD_BACK) {
      const text = pending.slice(0, pending.length - HOLD_BACK);
      pending = pending.slice(pending.length - HOLD_BACK);
      yield* fed(text);
    }
    if (finished) return;
  }
  // The end of the file: a trailing semicolon and white space are not JSON, and are taken off before the last feed.
  let tail = (pending + decoder.decode()).trimEnd();
  if (tail.endsWith(SEMICOLON)) tail = tail.slice(0, -1).trimEnd();
  yield* fed(tail);
  if (!finished) throw new NotJson();
}

/**
 * The bytes after a data file's prefix (X's `window.YTD.<name>.part<N> = `): the prefix, at most `maxBytes` bytes up to
 * and including its first " = ", must match `pattern` exactly, and is dropped.
 */
export async function* afterPrefix(chunks: AsyncIterable<Uint8Array>, pattern: RegExp, maxBytes = 256): AsyncGenerator<Uint8Array> {
  let head = Buffer.alloc(0);
  let passed = false;
  const marker = Buffer.from(" = ", "latin1");
  for await (const chunk of chunks) {
    if (passed) {
      yield chunk;
      continue;
    }
    head = Buffer.concat([head, chunk]);
    const at = head.indexOf(marker);
    if (at < 0) {
      if (head.length > maxBytes) throw new NotJson();
      continue;
    }
    const end = at + marker.length;
    if (end > maxBytes || !pattern.test(head.subarray(0, end).toString("latin1"))) throw new NotJson();
    passed = true;
    if (end < head.length) yield head.subarray(end);
  }
  if (!passed) throw new NotJson();
}
```

### Create `apps/importer/src/loop.ts`

```ts
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { isImportId, type ArchivesLayout, type ImporterHeartbeat, type WorkLayout } from "@korbat/import-protocol";
import { errorCode, scanJob, writeAtomic, type ScanHooks, type ScanOutcome } from "./scan";

/**
 * The importer's loop (3b design, 7.1), after the image worker's: each tick handles deletion requests first (removing a
 * work folder the API no longer wants), then scans at most one archive from queue/ whose job has no summary and no
 * deletion request, oldest marker first, then forgets the attempt counters of archives the API has deleted. While a
 * scan runs, the loop looks for a deletion request for that archive every idleMs and aborts the scan when one comes, and
 * a watchdog of watchdogMs ends the process (Docker restarts it, and the attempt counter does the rest). The importer
 * mounts import-archives read-only: the archive, its queue marker and the request itself are the API's to delete.
 */

export interface LoopDeps {
  archives: ArchivesLayout;
  work: WorkLayout;
  log: Logger;
  now: () => number;
  /** The sleep when idle, and how often a running scan looks for a deletion request. */
  idleMs: number;
  watchdogMs: number;
  /** Ends the process when one scan takes too long. */
  abort: (reason: string) => void;
  /** Tests only: a stand-in for the scan. */
  scan?: (id: string, signal: AbortSignal) => Promise<ScanOutcome>;
  hooks?: ScanHooks | undefined;
}

/** Creates the work volume's folders and forgets files a crash left half written. */
export async function prepareWork(work: WorkLayout): Promise<void> {
  await rm(work.tmp, { recursive: true, force: true });
  for (const dir of [work.jobs, work.attempts, work.tmp]) await mkdir(dir, { recursive: true });
}

/** { v: 1, at } in epoch milliseconds, which the Compose healthcheck and the API read. */
export async function writeHeartbeat(deps: Pick<LoopDeps, "work" | "now">): Promise<void> {
  const beat: ImporterHeartbeat = { v: 1, at: deps.now() };
  await writeAtomic(deps.work, deps.work.heartbeat, JSON.stringify(beat));
}

/** Names in a folder that are import ids and regular files, oldest first. Anything else, a symlink included, is ignored. */
async function idFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const found: { id: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!isImportId(name)) continue;
    const stats = await lstat(path.join(dir, name)).catch(() => null);
    if (stats?.isFile()) found.push({ id: name, mtimeMs: stats.mtimeMs });
  }
  return found.sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id)).map(({ id }) => id);
}

/**
 * A request stays until the API sees it carried out and withdraws it (7.5 step 8), so this runs for the same id on
 * several ticks; it only acts while the work folder is there, which makes repeats free.
 */
async function handleDeletions(deps: LoopDeps): Promise<boolean> {
  let worked = false;
  for (const id of await idFiles(deps.archives.deletions)) {
    if (!existsSync(deps.work.jobDir(id))) continue;
    await rm(deps.work.jobDir(id), { recursive: true, force: true });
    deps.log.info({ id, phase: "deleted" }, "work folder deleted");
    worked = true;
  }
  return worked;
}

/** An attempt counter outlives its scan until the API deletes the archive's folder. */
async function cleanAttempts(deps: LoopDeps): Promise<void> {
  for (const id of await readdir(deps.work.attempts).catch(() => [] as string[])) {
    if (isImportId(id) && !existsSync(deps.archives.jobDir(id))) await rm(deps.work.attempt(id), { force: true });
  }
}

async function scanOne(deps: LoopDeps, id: string): Promise<void> {
  const controller = new AbortController();
  const deletion = deps.archives.deletion(id);
  const poll = setInterval(() => {
    if (existsSync(deletion)) controller.abort();
  }, deps.idleMs);
  const watchdog = setTimeout(() => deps.abort(`scan of ${id} took longer than ${deps.watchdogMs} ms`), deps.watchdogMs);
  try {
    const scan = deps.scan ?? ((job: string, signal: AbortSignal) => scanJob({ archives: deps.archives, work: deps.work, log: deps.log, hooks: deps.hooks }, job, signal));
    await scan(id, controller.signal);
  } catch (caught) {
    deps.log.error({ id, phase: "broken", error: errorCode(caught) }, "scan threw; it will start again");
  } finally {
    clearInterval(poll);
    clearTimeout(watchdog);
  }
}

/** One pass: deletions, then at most one scan, then attempt cleanup. Returns whether it did any work. */
export async function tick(deps: LoopDeps): Promise<boolean> {
  let worked = await handleDeletions(deps);
  // A job with a summary waits for the API; one with a deletion request is not wanted any more.
  const pending = (await idFiles(deps.archives.queue)).filter((id) => !existsSync(deps.work.summary(id)) && !existsSync(deps.archives.deletion(id)));
  const next = pending[0];
  if (next) {
    await scanOne(deps, next);
    worked = true;
  }
  await cleanAttempts(deps);
  return worked;
}
```

### Create `apps/importer/src/scan.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { IMPORT_RULES, ImportSummary, type ImportFailure, type ImportSource } from "@korbat/contracts";
import { SCAN_MAX_ATTEMPTS, openWorkFile, readJobFile, type ArchivesLayout, type WorkLayout } from "@korbat/import-protocol";
import { blueskyAdapter } from "./adapters/bluesky/index";
import { mastodonAdapter } from "./adapters/mastodon/index";
import { ScanAborted, ScanFailure, type AllowedArchive, type SourceAdapter } from "./adapters/types";
import { xAdapter } from "./adapters/x/index";
import { openCar, looksLikeCar } from "./car/reader";
import { ScanCore, type CoreHooks } from "./core";
import { readAt } from "./zip/central";
import { openZip } from "./zip/entry";

/**
 * One scan (3b design, 7.1's four steps): (1) the attempt is counted first, and a third start writes the summary
 * `failed: interrupted` without opening the archive, so a file that kills the process cannot loop; (2) job.json is read
 * (at most 4 KiB, its schema) and any earlier output of the job cleared, and the archive opened by file descriptor;
 * (3) the zip or CAR reader, the adapter and the core write posts.jsonl and the images; (4) summary.json, the commit
 * point, is written last. The scratch file is deleted when the scan ends. What reaches the log is the job id, the
 * phase, timings, the failure code, the counts once at the end, and an error's class or code: never its message.
 */

export const ADAPTERS: Readonly<Record<ImportSource, SourceAdapter>> = { x: xAdapter, mastodon: mastodonAdapter, bluesky: blueskyAdapter };

export interface ScanHooks extends CoreHooks {
  /** Tests only: called with the scratch file's path just before it is deleted, so a test can read it first. */
  scratch?(file: string): void | Promise<void>;
  /** Tests only: called after the attempt was counted and before anything is opened; a throw stands in for a crash. */
  attempted?(attempts: number): void;
}

export interface ScanDeps {
  archives: ArchivesLayout;
  work: WorkLayout;
  log: Logger;
  hooks?: ScanHooks | undefined;
}

/** scanned or failed: a summary was written. aborted: a deletion request ended it. retry: it broke and will start again. */
export type ScanOutcome = "scanned" | "failed" | "aborted" | "retry";

/** Write under tmp/, flush, rename: the API never sees half a file, and a finished file survives a power cut. */
export async function writeAtomic(work: WorkLayout, target: string, data: string): Promise<void> {
  const temporary = path.join(work.tmp, randomUUID());
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

/** An error as the log may show it: a system code (ENOSPC) or the error's class, never its message. */
export function errorCode(caught: unknown): string {
  const code = (caught as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  return caught instanceof Error ? caught.constructor.name : "unknown";
}

async function readAttempts(work: WorkLayout, id: string): Promise<number> {
  const text = await readFile(work.attempt(id), "utf8").catch(() => "0");
  const count = Number.parseInt(text, 10);
  // A counter that is not a number is treated as spent, as the worker treats its own.
  return Number.isInteger(count) && count >= 0 ? count : SCAN_MAX_ATTEMPTS;
}

/** Empties the job's folder of the work volume: an earlier output, or a part of this scan's. */
async function clearOutput(work: WorkLayout, id: string): Promise<void> {
  await rm(work.jobDir(id), { recursive: true, force: true });
  await mkdir(work.jobDir(id), { recursive: true });
}

async function writeFailed(deps: ScanDeps, id: string, failure: ImportFailure): Promise<void> {
  const { work } = deps;
  await clearOutput(work, id);
  await writeAtomic(work, work.summary(id), JSON.stringify({ v: 1, id, status: "failed", failure } satisfies ImportSummary));
  deps.hooks?.placed?.("summary.json");
  deps.log.info({ id, phase: "failed", failure }, "scan failed");
}

const ZIP = [0x50, 0x4b];
const GZIP = [0x1f, 0x8b];
const starts = (head: Buffer, bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

/** What the first bytes say: a zip (a local header, or the end record of an empty one), a CAR, a gzip, or none of them. */
function kindOf(head: Buffer): "zip" | "car" | "gzip" | null {
  if (starts(head, GZIP)) return "gzip";
  if (starts(head, ZIP) && (starts(head.subarray(2), [3, 4]) || starts(head.subarray(2), [5, 6]))) return "zip";
  if (looksLikeCar(head)) return "car";
  return null;
}

export async function scanJob(deps: ScanDeps, id: string, signal: AbortSignal): Promise<ScanOutcome> {
  const { archives, work, log, hooks } = deps;
  const started = Date.now();
  await mkdir(work.attempts, { recursive: true });
  await mkdir(work.tmp, { recursive: true });
  const attempts = (await readAttempts(work, id)) + 1;
  await writeAtomic(work, work.attempt(id), String(attempts));
  log.info({ id, phase: "started", attempts }, "scan started");
  if (attempts >= SCAN_MAX_ATTEMPTS) {
    await writeFailed(deps, id, "interrupted");
    return "failed";
  }

  let failure: ImportFailure | null = null;
  let aborted = false;
  let core: ScanCore | null = null;
  let file: FileHandle | null = null;
  try {
    hooks?.attempted?.(attempts);
    if (signal.aborted) throw new ScanAborted();
    const job = await readJobFile(archives.root, id);
    if (!job.ok) throw new ScanFailure("unreadable");
    await clearOutput(work, id);
    const opened = await openWorkFile(archives.root, archives.archive(id), IMPORT_RULES.maxBytes);
    if (!opened.ok) throw new ScanFailure("unreadable");
    file = opened.file.handle;
    const size = opened.file.size;
    const { source, images } = job.value;
    const adapter = ADAPTERS[source];

    const kind = kindOf(await readAt(file, 0, 16));
    if (kind === "gzip") throw new ScanFailure("tar_gz");
    if (kind === null) throw new ScanFailure("not_an_archive");
    if ((kind === "car") !== (source === "bluesky")) throw new ScanFailure("not_this_source");

    let archive: AllowedArchive;
    if (kind === "zip") {
      archive = await openZip(file, size, { rules: adapter.allowlist, images, detect: (entries) => adapter.detect(entries) });
      // Their count only: a refused name itself never reaches the log.
      const refused = archive.refusedNames;
      if (refused > 0) log.info({ id, phase: "listed", refusedNames: refused }, "entries with refused names were passed over");
    } else {
      archive = await openCar(file, size);
      const refusal = adapter.detect(archive.entries);
      if (refusal) throw new ScanFailure(refusal);
    }

    core = new ScanCore({
      id,
      work,
      source,
      accountKey: Buffer.from(job.value.accountKey, "hex"),
      createdAt: new Date(job.value.createdAt),
      images,
      log,
      signal,
      archive: archive.kind === "zip" ? archive : undefined,
      hooks,
    });
    await core.open();
    for await (const item of adapter.readPosts(archive, core.context)) await core.add(item);
    const counts = await core.finish();
    if (counts.posts === 0) throw new ScanFailure("nothing_to_import");
    const summary = ImportSummary.safeParse({ v: 1, id, status: "scanned", ...counts });
    if (!summary.success) throw new ScanFailure("unreadable");
    await writeAtomic(work, work.summary(id), JSON.stringify(summary.data));
    hooks?.placed?.("summary.json");
    const { posts, images: written, skipped, imagesSkipped, cleaned, warnings, sourceLinks, protectedPosts, readInPart } = counts;
    log.info(
      { id, phase: "scanned", ms: Date.now() - started, posts, images: written, skipped, imagesSkipped, cleaned, warnings, sourceLinks, protectedPosts, readInPart },
      "scan ended",
    );
    return "scanned";
  } catch (caught) {
    if (caught instanceof ScanAborted) aborted = true;
    else if (caught instanceof ScanFailure) failure = caught.code;
    else {
      log.error({ id, phase: "broken", error: errorCode(caught) }, "scan broke; it will start again");
      return "retry";
    }
  } finally {
    if (core) {
      await hooks?.scratch?.(work.scratch(id));
      await core.close();
    }
    await file?.close();
  }
  if (aborted) {
    await rm(work.jobDir(id), { recursive: true, force: true });
    log.info({ id, phase: "aborted" }, "scan aborted by a deletion request");
    return "aborted";
  }
  await writeFailed(deps, id, failure!);
  return "failed";
}
```

### Create `apps/importer/src/text.ts`

```ts
import { AltText, FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizeAltText, normalizePostBody, type ImportSource } from "@korbat/contracts";

/**
 * Text conversion common to all sources (3b design, section 5.3), in its order: HTML to text is html.ts (step 1); here
 * X's unescaping (2), t.co links (3), links to the source platform (3b), X's leading mentions (4), cleaning (5) and
 * normalising (6), and the same cleaning for image descriptions. Step 7, the length, is the core's. No pattern in this
 * file is written with a backslash: characters outside printable ASCII are built with String.fromCharCode.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ELLIPSIS = String.fromCharCode(0x2026);
/** The white space a link ends at. */
const SPACE_CLASS = ` ${TAB}${LF}${CR}`;

/** The words that replace a link to the source platform (5.3 step 3b): its path holds someone's handle there. */
export const SOURCE_WORDS = {
  x: { post: "(a post on X)", profile: "(a profile on X)" },
  mastodon: { post: "(a post on Mastodon)", profile: "(a profile on Mastodon)" },
  bluesky: { post: "(a post on Bluesky)", profile: "(a profile on Bluesky)" },
} as const satisfies Record<ImportSource, { post: string; profile: string }>;

/** The first line of a Mastodon post with a content warning, before the warning's own words (decision 12). */
export const CONTENT_WARNING_LABEL = "Content warning: ";

/** Step 2 (X): full_text escapes these three, and only these; &amp; last, so "&amp;lt;" stays "&lt;". */
export function unescapeX(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

const TCO = /( ?)(https?:[/][/]t[.]co[/][A-Za-z0-9]+)/gi;

/**
 * Step 3 (X): every t.co link becomes the expanded_url its entity gives, since t.co is a click tracker; a media link
 * and a t.co link with no entity are removed, with the one space before them.
 */
export function expandTco(text: string, urls: readonly { url: string; expanded: string }[], media: readonly string[]): string {
  const expanded = new Map(urls.map(({ url, expanded: to }) => [url, to]));
  return text.replace(TCO, (_, space: string, link: string) => {
    const to = media.includes(link) ? undefined : expanded.get(link);
    return to === undefined ? "" : space + to;
  });
}

const PUNCTUATION = `.,;:!?)]}'"`;

/** A link's own text and the punctuation the sentence put after it. */
function splitTrailing(link: string): [string, string] {
  let end = link.length;
  while (end > 0 && PUNCTUATION.includes(link[end - 1]!)) end--;
  return [link.slice(0, end), link.slice(end)];
}

const WEB_LINK = new RegExp(`https?://[^${SPACE_CLASS}<>"]+`, "gi");
const BSKY_LINK = new RegExp(`(?<![A-Za-z0-9.@/-])(?:https?://)?(?:[A-Za-z0-9-]+[.])*bsky[.]app(?:/[^${SPACE_CLASS}]*)?|at://[^${SPACE_CLASS}]+`, "gi");

function hostOf(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

const isXHost = (host: string) => host === "twitter.com" || host.endsWith(".twitter.com") || host === "x.com" || host.endsWith(".x.com");
const X_STATUS = /[/]status(es)?[/][0-9]/;
const MASTODON_STATUS = /^[/](@[^/]+[/][0-9]+|users[/][^/]+[/]statuses[/][0-9]+)/;
const BSKY_POST = /^[/]profile[/][^/]+[/]post[/]/;

/**
 * Step 3b: a link to the source platform becomes fixed words, a post's or a profile's (X: twitter.com, x.com and their
 * subdomains; Mastodon: the host of the Note's own attributedTo; Bluesky: bsky.app links, with or without a scheme, and
 * at:// URIs). Returns the text and how many links were replaced.
 */
export function replaceSourceLinks(text: string, source: ImportSource, host?: string): { text: string; count: number } {
  let count = 0;
  const words = SOURCE_WORDS[source];
  if (source === "bluesky") {
    const out = text.replace(BSKY_LINK, (match: string) => {
      const [link, after] = splitTrailing(match);
      count++;
      if (link.toLowerCase().startsWith("at://")) return (link.includes("/app.bsky.feed.post/") ? words.post : words.profile) + after;
      const url = hostOf(/^https?:/i.test(link) ? link : `https://${link}`);
      return (url && BSKY_POST.test(url.pathname) ? words.post : words.profile) + after;
    });
    return { text: out, count };
  }
  const own = host?.toLowerCase();
  const out = text.replace(WEB_LINK, (match: string) => {
    const [link, after] = splitTrailing(match);
    const url = hostOf(link);
    if (!url) return match;
    const name = url.hostname.toLowerCase();
    if (source === "x") {
      if (!isXHost(name)) return match;
      count++;
      return (X_STATUS.test(url.pathname) ? words.post : words.profile) + after;
    }
    if (own === undefined || name !== own) return match;
    count++;
    return (MASTODON_STATUS.test(url.pathname) ? words.post : words.profile) + after;
  });
  return { text: out, count };
}

const MENTION_RUN = /^( *@[A-Za-z0-9_]{1,50})+ *$/;

/** Step 4 (X): the automatic @name run before display_text_range[0], as X itself hides it; any other prefix stays. */
export function removeLeadingMentions(text: string, start: number): string {
  if (!Number.isInteger(start) || start <= 0) return text;
  const points = Array.from(text);
  if (start > points.length) return text;
  const prefix = points.slice(0, start).join("");
  return MENTION_RUN.test(prefix) ? points.slice(start).join("") : text;
}

const CONTROL_G = new RegExp(FORBIDDEN_CONTROL.source, "gu");
const FORMAT_G = new RegExp(FORBIDDEN_FORMAT.source, "gu");

/**
 * Step 5: every control character but tab and line feed, and every FORBIDDEN_FORMAT character (invisible direction and
 * spacing characters), is removed and counted. A carriage return is a line break first (CR LF and CR become LF, not
 * counted), as normalizePostBody would make it.
 */
export function cleanText(raw: string): { text: string; removed: number } {
  let removed = 0;
  const count = () => {
    removed++;
    return "";
  };
  const text = raw.replaceAll(CR + LF, LF).replaceAll(CR, LF).replace(CONTROL_G, count).replace(FORMAT_G, count);
  return { text, removed };
}

/** Steps 5 and 6 for a post's text: cleaned, then normalizePostBody (NFC, line breaks, at most two in a row, trimmed). */
export function finishText(raw: string): { text: string; removed: number } {
  const { text, removed } = cleanText(raw);
  return { text: normalizePostBody(text), removed };
}

/**
 * Steps 5 and 6 for an image's description: cleaned, folded as AltText folds it, and kept only if it then meets AltText
 * (at most 1,000 code points, a visible character); otherwise null. `cleaned` says a character was removed or a
 * description became null; a description that was never given is null and not cleaned.
 */
export function cleanDescription(raw: unknown): { alt: string | null; cleaned: boolean } {
  if (typeof raw !== "string" || raw === "") return { alt: null, cleaned: false };
  const { text, removed } = cleanText(raw);
  const parsed = AltText.safeParse(normalizeAltText(text));
  return parsed.success ? { alt: parsed.data, cleaned: removed > 0 } : { alt: null, cleaned: true };
}

/** A truncated tweet's visible text before its ellipsis, for matching its note (5.5), or null when it was not cut. */
export function beforeEllipsis(text: string): string | null {
  const at = text.lastIndexOf(ELLIPSIS);
  if (at < 0) return null;
  const head = text.slice(0, at).trimEnd();
  return head === "" ? null : head;
}
```

### Create `apps/importer/src/zip/central.ts`

```ts
import type { FileHandle } from "node:fs/promises";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../adapters/types";
import type { ZipLimits } from "./limits";

/**
 * The zip reader's first three steps (3b design, 7.2; decision 2): the end of central directory record (and its ZIP64
 * record), then the central directory, each entry's name checked before any adapter sees it, directories and symbolic
 * links ignored, and every name filtered through the adapter's allowlist. Only allowlisted entries are kept; nothing of
 * the others is held, and the directory is read through a window, never whole.
 */

const END_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_LENGTH = 22;
/** The end record and the longest comment it may carry. */
const END_SEARCH = END_LENGTH + 0xffff;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const FLAG_UTF8 = 1 << 11;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const SLASH = 0x2f;
/** One read of the directory: enough for any entry (46 bytes and three fields of at most 65,535). */
const WINDOW_BYTES = 1_048_576;

/** Reads up to `length` bytes at `position`; fewer only at the end of the file. */
export async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

/** A 64-bit field as a number: beyond 2^53 it is only ever compared with smaller limits, which it then fails. */
const big = (value: bigint) => Number(value);

export interface EndRecord {
  entries: number;
  directorySize: number;
  directoryOffset: number;
  /** Where the end records begin: the central directory must end at or before it. */
  endOffset: number;
}

const notAnArchive = () => new ScanFailure("not_an_archive");

/** Step 1: the end record in the file's last 65,557 bytes, and the ZIP64 records when its fields say so. */
export async function readEnd(handle: FileHandle, fileSize: number, limits: ZipLimits): Promise<EndRecord> {
  if (fileSize < END_LENGTH) throw notAnArchive();
  const tailLength = Math.min(fileSize, END_SEARCH);
  const tailStart = fileSize - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let at = -1;
  // The last record whose comment ends exactly at the end of the file: one whose comment runs past it is no record.
  for (let i = tail.length - END_LENGTH; i >= 0; i--) {
    if (tail.readUInt32LE(i) === END_SIGNATURE && i + END_LENGTH + tail.readUInt16LE(i + 20) === tail.length) {
      at = i;
      break;
    }
  }
  if (at < 0) throw notAnArchive();
  const end = tail.subarray(at, at + END_LENGTH);
  const disk = end.readUInt16LE(4);
  const directoryDisk = end.readUInt16LE(6);
  const onDisk = end.readUInt16LE(8);
  let entries = end.readUInt16LE(10);
  let directorySize = end.readUInt32LE(12);
  let directoryOffset = end.readUInt32LE(16);
  let endOffset = tailStart + at;
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== entries) throw notAnArchive();

  if (entries === MAX16 || directorySize === MAX32 || directoryOffset === MAX32) {
    const locatorAt = endOffset - 20;
    if (locatorAt < 0) throw notAnArchive();
    const locator = await readAt(handle, locatorAt, 20);
    if (locator.length < 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE || locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) > 1) throw notAnArchive();
    const recordAt = big(locator.readBigUInt64LE(8));
    if (recordAt + 56 > locatorAt) throw notAnArchive();
    const record = await readAt(handle, recordAt, 56);
    if (record.length < 56 || record.readUInt32LE(0) !== ZIP64_END_SIGNATURE || record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) throw notAnArchive();
    const onThisDisk = record.readBigUInt64LE(24);
    const total = record.readBigUInt64LE(32);
    if (onThisDisk !== total) throw notAnArchive();
    entries = big(total);
    directorySize = big(record.readBigUInt64LE(40));
    directoryOffset = big(record.readBigUInt64LE(48));
    endOffset = recordAt;
  }
  if (entries > limits.maxEntries || directorySize > limits.directoryMaxBytes) throw new ScanFailure("too_many_entries");
  if (directoryOffset + directorySize > endOffset) throw new ScanFailure("unreadable");
  return { entries, directorySize, directoryOffset, endOffset };
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
/** Any control character; the backslash of its pattern is built, so no source file carries one. */
const CONTROL = new RegExp(`${String.fromCharCode(92)}p{Cc}`, "u");
const DRIVE = /^[A-Za-z]:/;

/**
 * Step 2's checks of one entry name: at most `maxBytes` bytes of valid UTF-8 (or, with flag bit 11 clear, CP437 bytes
 * that are all ASCII); no NUL or other control character, no backslash, no drive letter, no leading slash, no `.` or
 * `..` segment and no empty one. Returns the name, or null for a name no allowlist rule may ever see.
 */
export function checkEntryName(raw: Uint8Array, utf8: boolean, maxBytes: number = IMPORT_RULES.zipNameMaxBytes): string | null {
  if (raw.length === 0 || raw.length > maxBytes) return null;
  let name: string;
  if (utf8) {
    try {
      name = UTF8.decode(raw);
    } catch {
      return null;
    }
  } else {
    if (raw.some((byte) => byte >= 0x80)) return null;
    name = Buffer.from(raw).toString("latin1");
  }
  if (CONTROL.test(name) || name.includes(String.fromCharCode(92)) || DRIVE.test(name) || name.startsWith("/")) return null;
  if (name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return name;
}

/** A central entry the allowlist took. Sizes and the offset come from the ZIP64 extra field where the 32-bit fields are full. */
export interface CentralEntry {
  name: string;
  rawName: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  /** Whether a ZIP64 extra field gave a size: a data descriptor then holds 64-bit sizes. */
  zip64: boolean;
}

export interface CentralDirectory {
  entries: CentralEntry[];
  /** Entries whose names failed the checks: never offered to the allowlist, never opened. */
  refusedNames: number;
}

export interface CentralOptions {
  allow: (name: string) => boolean;
  /** Tests: every name the allowlist was asked about. */
  onName?: (name: string) => void;
  limits: ZipLimits;
}

/** The ZIP64 extra field (0x0001): the 64-bit values of the fields whose 32-bit form is full, in their fixed order. */
function zip64Values(extra: Buffer, wanted: boolean[]): (number | undefined)[] {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (at + 4 + size > extra.length) break;
    if (id === 0x0001) {
      const values: (number | undefined)[] = [];
      let field = at + 4;
      for (const want of wanted) {
        if (!want) {
          values.push(undefined);
          continue;
        }
        if (field + 8 > at + 4 + size) throw new ScanFailure("unreadable");
        values.push(big(extra.readBigUInt64LE(field)));
        field += 8;
      }
      return values;
    }
    at += 4 + size;
  }
  if (wanted.some(Boolean)) throw new ScanFailure("unreadable");
  return wanted.map(() => undefined);
}

/** Step 2 and 3: the central directory through a window, each entry checked, only allowlisted ones kept. */
export async function readCentral(handle: FileHandle, end: EndRecord, options: CentralOptions): Promise<CentralDirectory> {
  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let refusedNames = 0;
  let window: Buffer = Buffer.alloc(0);
  let windowStart = end.directoryOffset;
  let position = end.directoryOffset;
  const stop = end.directoryOffset + end.directorySize;

  /** The next `length` bytes of the directory; an entry that runs past the declared directory is unreadable. */
  const take = async (length: number): Promise<Buffer> => {
    if (position + length > stop) throw new ScanFailure("unreadable");
    if (position + length > windowStart + window.length) {
      windowStart = position;
      window = await readAt(handle, position, Math.min(Math.max(length, WINDOW_BYTES), stop - position));
      if (window.length < length) throw new ScanFailure("unreadable");
    }
    const out = window.subarray(position - windowStart, position - windowStart + length);
    position += length;
    return out;
  };

  for (let index = 0; index < end.entries; index++) {
    const head = await take(46);
    if (head.readUInt32LE(0) !== CENTRAL_SIGNATURE) throw new ScanFailure("unreadable");
    const flags = head.readUInt16LE(8);
    const method = head.readUInt16LE(10);
    const crc = head.readUInt32LE(16);
    const compressed32 = head.readUInt32LE(20);
    const uncompressed32 = head.readUInt32LE(24);
    const nameLength = head.readUInt16LE(28);
    const extraLength = head.readUInt16LE(30);
    const commentLength = head.readUInt16LE(32);
    const startDisk = head.readUInt16LE(34);
    const mode = head.readUInt32LE(38) >>> 16;
    const offset32 = head.readUInt32LE(42);
    const rawName = Buffer.from(await take(nameLength));
    const extra = Buffer.from(await take(extraLength));
    await take(commentLength);

    // A directory or a symbolic link is ignored and never opened, whatever its name.
    if (rawName.at(-1) === SLASH || (mode & S_IFMT) === S_IFDIR || (mode & S_IFMT) === S_IFLNK) continue;
    const name = checkEntryName(rawName, (flags & FLAG_UTF8) !== 0, options.limits.nameMaxBytes);
    if (name === null) {
      refusedNames++;
      continue;
    }
    options.onName?.(name);
    if (!options.allow(name)) continue;
    // Two central entries with one allowlisted name: a reader that takes either could be steered.
    if (seen.has(name)) throw new ScanFailure("bad_entry_name");
    seen.add(name);
    if (startDisk !== 0 && startDisk !== MAX16) throw new ScanFailure("unreadable");
    const [uncompressed, compressed, offset] = zip64Values(extra, [uncompressed32 === MAX32, compressed32 === MAX32, offset32 === MAX32]);
    entries.push({
      name,
      rawName,
      flags,
      method,
      crc,
      compressedSize: compressed ?? compressed32,
      uncompressedSize: uncompressed ?? uncompressed32,
      offset: offset ?? offset32,
      zip64: uncompressed !== undefined || compressed !== undefined,
    });
  }
  return { entries, refusedNames };
}
```

### Create `apps/importer/src/zip/entry.ts`

```ts
import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw, crc32 } from "node:zlib";
import type { ImportFailure } from "@korbat/contracts";
import { ScanFailure, isAllowed, isListed, type ArchiveEntry, type EntryRule, type ZipArchive } from "../adapters/types";
import { readCentral, readEnd } from "./central";
import { ZIP_LIMITS, checkEntries, type ZipEntry, type ZipLimits } from "./limits";

export type { ZipArchive } from "../adapters/types";
export type { ZipLimits } from "./limits";

/**
 * The zip reader (3b design, 7.2; decision 2), korbat's own: the end record, the central directory filtered through the
 * adapter's allowlist, the adapter's detect, every limit, and then entries opened one at a time. An entry streams
 * straight into its reader: nothing is ever extracted to a path built from an entry name. Inflating uses node:zlib's
 * raw inflater, counts its output and stops one byte over the central size, and checks the CRC-32 at the end. A zlib
 * error's message is never kept (it can quote the input): every failure is the code `unreadable`.
 */

/** How much of the file one read takes, and how much of it the inflater gets at once (deflate expands at most about 1,032 to 1). */
const READ_BYTES = 65_536;
const FEED_BYTES = 16_384;

async function* compressedSlices(handle: FileHandle, start: number, length: number): AsyncGenerator<Buffer> {
  let position = start;
  const end = start + length;
  while (position < end) {
    const want = Math.min(READ_BYTES, end - position);
    const buffer = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buffer, 0, want, position);
    if (bytesRead === 0) throw new ScanFailure("unreadable");
    for (let at = 0; at < bytesRead; at += FEED_BYTES) yield buffer.subarray(at, Math.min(at + FEED_BYTES, bytesRead));
    position += bytesRead;
  }
}

async function* inflated(handle: FileHandle, entry: ZipEntry): AsyncGenerator<Buffer> {
  const source = Readable.from(compressedSlices(handle, entry.dataStart, entry.compressedSize), { objectMode: false });
  const inflater = createInflateRaw({ chunkSize: FEED_BYTES });
  source.on("error", (err) => inflater.destroy(err));
  source.pipe(inflater);
  try {
    for await (const chunk of inflater) yield chunk as Buffer;
  } finally {
    source.unpipe(inflater);
    source.destroy();
    inflater.destroy();
  }
}

/** One entry's bytes, inflated and checked: at most its central size, and its CRC-32 at the end. */
export async function* readEntry(handle: FileHandle, entry: ZipEntry): AsyncGenerator<Buffer> {
  let total = 0;
  let crc = 0;
  const chunks = entry.method === 0 ? compressedSlices(handle, entry.dataStart, entry.compressedSize) : inflated(handle, entry);
  try {
    for await (const chunk of chunks) {
      total += chunk.length;
      if (total > entry.uncompressedSize) throw new ScanFailure("unreadable");
      crc = crc32(chunk, crc);
      yield chunk;
    }
  } catch (err) {
    throw err instanceof ScanFailure ? err : new ScanFailure("unreadable");
  }
  if (total !== entry.uncompressedSize || crc !== entry.crc) throw new ScanFailure("unreadable");
}

export interface OpenZipOptions {
  rules: readonly EntryRule[];
  images: boolean;
  /** Tests only: smaller limits than IMPORT_RULES's. */
  limits?: Partial<ZipLimits> | undefined;
  /** Tests only: every well-formed name offered to the allowlist. */
  onName?: (name: string) => void;
  /** The adapter's detect, run on the allowlisted names and sizes before any entry is checked further or opened. */
  detect?: (entries: readonly ArchiveEntry[]) => ImportFailure | null;
}

/** Steps 1 to 5 of 7.2 on an open file: the allowlisted entries, checked, ready to open one at a time. */
export async function openZip(handle: FileHandle, fileSize: number, options: OpenZipOptions): Promise<ZipArchive> {
  const limits: ZipLimits = { ...ZIP_LIMITS, ...options.limits };
  const end = await readEnd(handle, fileSize, limits);
  const allow = (name: string) => isAllowed(options.rules, name, options.images) || isListed(options.rules, name);
  const central = await readCentral(handle, end, { allow, onName: options.onName, limits });
  const listed: ArchiveEntry[] = central.entries.map((entry) => ({ name: entry.name, size: entry.uncompressedSize }));
  const refusal = options.detect?.(listed) ?? null;
  if (refusal) throw new ScanFailure(refusal);
  // A name listed for detect only is never checked further or opened. An entry an images rule took is an image; every
  // other is a data file.
  const openable = central.entries.filter((entry) => isAllowed(options.rules, entry.name, options.images));
  const dataRules = options.rules.filter((rule) => rule.images !== true);
  const isImage = (name: string) => !isAllowed(dataRules, name, false);
  const entries = await checkEntries(handle, end.directoryOffset, openable, isImage, limits);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    kind: "zip",
    entries: listed,
    refusedNames: central.refusedNames,
    has: (name) => byName.has(name),
    size: (name) => byName.get(name)?.uncompressedSize,
    open: (name) => {
      const entry = byName.get(name);
      // Only an allowlisted entry can be opened: any other name is a bug of the caller, never a file.
      if (!entry) throw new Error("not an allowlisted entry");
      return readEntry(handle, entry);
    },
  };
}
```

### Create `apps/importer/src/zip/limits.ts`

```ts
import type { FileHandle } from "node:fs/promises";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../adapters/types";
import { readAt, type CentralEntry } from "./central";

/**
 * The zip reader's limits (3b design, 7.2 steps 4 and 5's local checks), every number from IMPORT_RULES. Only
 * allowlisted entries are checked, all before any is opened: encryption, the method, the sizes, the ratio, each
 * entry's local header against its central entry, its data range inside the file and apart from every other
 * allowlisted entry's (the overlapping-files bomb), and the sum of their sizes.
 */

export interface ZipLimits {
  maxEntries: number;
  directoryMaxBytes: number;
  nameMaxBytes: number;
  /** A data file's uncompressed size. An image is not held to it: the core counts one over 20 MiB too_large, unopened. */
  dataMaxBytes: number;
  maxRatio: number;
  totalMaxBytes: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  maxEntries: IMPORT_RULES.zipMaxEntries,
  directoryMaxBytes: IMPORT_RULES.zipDirectoryMaxBytes,
  nameMaxBytes: IMPORT_RULES.zipNameMaxBytes,
  dataMaxBytes: IMPORT_RULES.zipDataMaxBytes,
  maxRatio: IMPORT_RULES.zipMaxRatio,
  totalMaxBytes: IMPORT_RULES.zipTotalMaxBytes,
};

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX32 = 0xffffffff;
const FLAG_ENCRYPTED = 1;
const FLAG_DESCRIPTOR = 1 << 3;
const STORED = 0;
const DEFLATED = 8;

/** An allowlisted entry that passed every check, with where its data starts. */
export interface ZipEntry extends CentralEntry {
  dataStart: number;
}

/** The ZIP64 extra field of a local header: its uncompressed and compressed sizes. */
function localZip64(extra: Buffer): [number, number] | null {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === 0x0001 && size >= 16 && at + 4 + size <= extra.length) {
      return [Number(extra.readBigUInt64LE(at + 4)), Number(extra.readBigUInt64LE(at + 12))];
    }
    at += 4 + size;
  }
  return null;
}

/**
 * Checks every allowlisted entry and returns them with their data's start. `isImage` names the entries an images rule
 * took. Throws the failure of the first entry that fails.
 */
export async function checkEntries(handle: FileHandle, directoryOffset: number, entries: readonly CentralEntry[], isImage: (name: string) => boolean, limits: ZipLimits): Promise<ZipEntry[]> {
  let total = 0;
  for (const entry of entries) {
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) throw new ScanFailure("encrypted");
    if (entry.method !== STORED && entry.method !== DEFLATED) throw new ScanFailure("unreadable");
    if (!isImage(entry.name) && entry.uncompressedSize > limits.dataMaxBytes) throw new ScanFailure("too_large_uncompressed");
    // The ratio of one entry; nothing that inflates to something from nothing passes.
    if (entry.compressedSize === 0 ? entry.uncompressedSize > 0 : entry.uncompressedSize / entry.compressedSize > limits.maxRatio) {
      throw new ScanFailure("too_large_uncompressed");
    }
    if (entry.method === STORED && entry.compressedSize !== entry.uncompressedSize) throw new ScanFailure("unreadable");
    total += entry.uncompressedSize;
    if (total > limits.totalMaxBytes) throw new ScanFailure("too_large_uncompressed");
  }

  const checked: ZipEntry[] = [];
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    if (entry.offset + 30 > directoryOffset) throw new ScanFailure("unreadable");
    const head = await readAt(handle, entry.offset, 30);
    if (head.length < 30 || head.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ScanFailure("unreadable");
    const flags = head.readUInt16LE(6);
    const method = head.readUInt16LE(8);
    const nameLength = head.readUInt16LE(26);
    const extraLength = head.readUInt16LE(28);
    if (method !== entry.method || (flags & FLAG_ENCRYPTED) !== (entry.flags & FLAG_ENCRYPTED)) throw new ScanFailure("unreadable");
    const rest = await readAt(handle, entry.offset + 30, nameLength + extraLength);
    if (rest.length < nameLength + extraLength || !rest.subarray(0, nameLength).equals(entry.rawName)) throw new ScanFailure("unreadable");
    const descriptor = (entry.flags & FLAG_DESCRIPTOR) !== 0;
    let zip64 = entry.zip64;
    if (!descriptor) {
      // Without a data descriptor the local header must say what the central entry says.
      let compressed = head.readUInt32LE(18);
      let uncompressed = head.readUInt32LE(22);
      if (compressed === MAX32 || uncompressed === MAX32) {
        const sizes = localZip64(rest.subarray(nameLength));
        if (!sizes) throw new ScanFailure("unreadable");
        [uncompressed, compressed] = sizes;
        zip64 = true;
      }
      if (head.readUInt32LE(14) !== entry.crc || compressed !== entry.compressedSize || uncompressed !== entry.uncompressedSize) throw new ScanFailure("unreadable");
    }
    const dataStart = entry.offset + 30 + nameLength + extraLength;
    let recordEnd = dataStart + entry.compressedSize;
    if (descriptor) {
      // The descriptor's own length (12, 16, 20 or 24 bytes) counts in the range the overlap check compares.
      const signature = await readAt(handle, recordEnd, 4);
      const signed = signature.length === 4 && signature.readUInt32LE(0) === DESCRIPTOR_SIGNATURE;
      recordEnd += (signed ? 4 : 0) + (zip64 ? 20 : 12);
    }
    if (recordEnd > directoryOffset) throw new ScanFailure("unreadable");
    ranges.push([entry.offset, recordEnd]);
    checked.push({ ...entry, dataStart });
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) throw new ScanFailure("unreadable");
  return checked;
}
```

### Create `apps/importer/tsconfig.json`

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test", "vitest.config.ts", "vitest.lab.config.ts"] }
```

### Replace `.github/workflows/ci.yml` (whole file)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
        with: { version: 10.30.0 }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: new lockfile entries are at least 7 days old
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
            echo "no base commit to compare with"
          else
            node scripts/check-lockfile-age.mjs --base "$BASE"
          fi
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build && pnpm --filter @korbat/admin build && pnpm --filter @korbat/importer build
      # The staff console over every screen under the console site's policy, read from the Caddyfile, in the runner's own
      # Chrome: no browser is downloaded, and no database or API is needed.
      - name: the console's browser check
        run: pnpm --filter @korbat/admin test:browser
        env:
          KORBAT_BROWSER_CHANNEL: chrome
      - run: pnpm --filter @korbat/app exec expo export --platform web
        env:
          EXPO_PUBLIC_TURNSTILE_SITE_KEY: 1x00000000000000000000AA
      - run: docker compose --env-file infra/.env.example -f infra/compose.yml config -q

  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep:1.177.0@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: the api, worker and web images build
        run: docker compose --env-file infra/.env.example -f infra/compose.yml build
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
Done in 7.5s using pnpm v10.30.0
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
Done in 3s using pnpm v10.30.0
```

## Step 6: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
7 new package versions since HEAD; all at least 7 days old
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
packages/db test:       Tests  112 passed (112)
packages/contracts test:       Tests  493 passed (493)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
packages/import-protocol test:       Tests  35 passed | 2 skipped (37)
apps/admin test:       Tests  594 passed (594)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  639 passed (639)
apps/api test:       Tests  943 passed | 1797 skipped (2740)
apps/importer test:       Tests  143 passed (143)
```

## Step 9: verify: importer-build

```bash
pnpm --filter @korbat/importer build 2>&1 | tail -2 && node --check apps/importer/dist/index.js && echo check-ok
```

Expected output contains:

- `Build success`
- `check-ok`

Observed on the dry run:

```text
Build success
check-ok
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.github/workflows/ci.yml`
- `apps/importer/Dockerfile`
- `apps/importer/build.mjs`
- `apps/importer/package.json`
- `apps/importer/src/adapters/bluesky/index.ts`
- `apps/importer/src/adapters/mastodon/index.ts`
- `apps/importer/src/adapters/types.ts`
- `apps/importer/src/adapters/x/index.ts`
- `apps/importer/src/car/mst.ts`
- `apps/importer/src/car/reader.ts`
- `apps/importer/src/config.ts`
- `apps/importer/src/core.ts`
- `apps/importer/src/html.ts`
- `apps/importer/src/index.ts`
- `apps/importer/src/json.ts`
- `apps/importer/src/loop.ts`
- `apps/importer/src/scan.ts`
- `apps/importer/src/text.ts`
- `apps/importer/src/zip/central.ts`
- `apps/importer/src/zip/entry.ts`
- `apps/importer/src/zip/limits.ts`
- `apps/importer/test/bluesky.test.ts`
- `apps/importer/test/core.test.ts`
- `apps/importer/test/fixtures/bluesky.ts`
- `apps/importer/test/fixtures/canaries.ts`
- `apps/importer/test/fixtures/harness.ts`
- `apps/importer/test/fixtures/mastodon.ts`
- `apps/importer/test/fixtures/x.ts`
- `apps/importer/test/fixtures/zip.ts`
- `apps/importer/test/json.test.ts`
- `apps/importer/test/lab/README.md`
- `apps/importer/test/lab/json-bomb.lab.ts`
- `apps/importer/test/lab/large-archive.lab.ts`
- `apps/importer/test/lab/support.ts`
- `apps/importer/test/lab/tool.ts`
- `apps/importer/test/lab/traversal.lab.ts`
- `apps/importer/test/lab/zip-bomb.lab.ts`
- `apps/importer/test/lab/zip-writer.ts`
- `apps/importer/test/log.test.ts`
- `apps/importer/test/loop.test.ts`
- `apps/importer/test/mastodon.test.ts`
- `apps/importer/test/minimisation.test.ts`
- `apps/importer/test/text.test.ts`
- `apps/importer/test/x.test.ts`
- `apps/importer/test/zip.test.ts`
- `apps/importer/tsconfig.json`
- `apps/importer/vitest.config.ts`
- `apps/importer/vitest.lab.config.ts`
- `pnpm-lock.yaml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(importer): the importer: apps/importer, a service with no network, database or secret but each job's account key, scans one archive at a time from import-archives into import-work (7.1): the attempt counted first and a third start failed interrupted unopened, job.json under its schema, the archive by descriptor, deletion requests first and one naming the running scan aborting it, a 30-minute watchdog and its own heartbeat; korbat's zip reader (7.2: the end record and ZIP64, names checked before any allowlist sees them, links and folders ignored, encryption, method, sizes, ratio 100, overlap and the 4 GiB sum, local headers and data descriptors, inflate stopped one byte over, the CRC) and a two-pass CAR reader hashing every block against its CID; the X, Mastodon and Bluesky adapters of 5.5 to 5.7 over korbat's JSON assembler (1 MiB and 64 levels an element); 5.3's text steps; the core of 5.4 (HMAC keys, the newest 50,000 in a heap, texts in a scratch file, thread links, images of kept posts only, tmp and renames, summary.json last); fixtures built by code with canaries, unit tests and four labs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(importer): the importer: apps/importer, a service with no network, database or secret but each job's account key, scans one archive at a time from import-archives into import-work (7.1): the attempt counted first and a third start failed interrupted unopened, job.json under its schema, the archive by descriptor, deletion requests first and one naming the running scan aborting it, a 30-minute watchdog and its own heartbeat; korbat's zip reader (7.2: the end record and ZIP64, names checked before any allowlist sees them, links and folders ignored, encryption, method, sizes, ratio 100, overlap and the 4 GiB sum, local headers and data descriptors, inflate stopped one byte over, the CRC) and a two-pass CAR reader hashing every block against its CID; the X, Mastodon and Bluesky adapters of 5.5 to 5.7 over korbat's JSON assembler (1 MiB and 64 levels an element); 5.3's text steps; the core of 5.4 (HMAC keys, the newest 50,000 in a heap, texts in a scratch file, thread links, images of kept posts only, tmp and renames, summary.json last); fixtures built by code with canaries, unit tests and four labs`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 48>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "importer-build": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
