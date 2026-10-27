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
