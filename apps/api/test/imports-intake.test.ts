import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES, ImportScanFacts, type ImportedPost } from "@korbat/contracts";
import { LINE_MAX_BYTES, parsePostLine, readLineAt, workLayout, writeScanOutput } from "@korbat/import-protocol";
import { createImportFiles } from "../src/imports/files";
import { marksOf, runIntake, type IntakeOptions, type ScannedSummary } from "../src/imports/intake";

/**
 * The intake (3b design, section 7.5 step 2; 12.2), over scan output that packages/import-protocol's writeScanOutput writes
 * as the importer would, read through the API's own files module. The social module's read of keys already imported is
 * a set the test gives.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CREATED = new Date("2026-10-26T10:00:00.000Z");
const keyOf = (ref: number) => createHash("sha256").update(`key ${ref}`).digest("hex");

/** One line as the importer writes it, dated in March, April or May of 2019 by its ref unless told otherwise. */
function post(ref: number, over: Partial<ImportedPost> = {}): ImportedPost {
  const month = ["03", "04", "05"][Math.floor(ref / 40) % 3]!;
  const day = String((ref % 28) + 1).padStart(2, "0");
  return { ref, key: keyOf(ref), at: `2019-${month}-${day}T12:00:00Z`, kind: "post", parent: null, text: `post number ${ref}`, media: [], protected: false, warning: false, ...over };
}

function summaryOf(id: string, posts: number, over: Partial<ScannedSummary> = {}): ScannedSummary {
  return { v: 1, id, status: "scanned", posts, images: 0, skipped: {}, imagesSkipped: {}, cleaned: 0, warnings: 0, sourceLinks: 0, protectedPosts: 0, readInPart: false, ...over };
}

function volume(options: { workDevice?: number } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "korbat-imports-intake-"));
  roots.push(root);
  const files = createImportFiles({ archivesDir: path.join(root, "archives"), workDir: path.join(root, "work"), log: pino({ level: "silent" }), ...options });
  return { root, files, id: randomUUID() };
}

type Volume = ReturnType<typeof volume>;

function intake(v: Volume, summary: ScannedSummary, over: Partial<IntakeOptions> = {}) {
  return runIntake({ id: v.id, summary, images: false, createdAt: CREATED, young: false, known: async () => new Set(), files: v.files, log: pino({ level: "silent" }), ...over });
}

/** The line at an offset of posts.jsonl, read as the preview reads a sample. */
async function lineAt(v: Volume, offset: number): Promise<ImportedPost | null> {
  const handle = await open(v.files.work.posts(v.id), "r");
  try {
    const text = await readLineAt(handle, offset);
    return text === null ? null : parsePostLine(text);
  } finally {
    await handle.close();
  }
}

describe("the intake (7.5 step 2)", () => {
  test("the month table by month and marks, the three newest lines as samples and every fiftieth line's offset as the pages", async () => {
    const v = volume();
    const long = "word ".repeat(220);
    const posts = Array.from({ length: 120 }, (_, ref) => {
      if (ref % 10 === 1) return post(ref, { kind: "reply" });
      if (ref % 10 === 2) return post(ref, { text: long, warning: true });
      if (ref % 10 === 3) return post(ref, { protected: true });
      return post(ref);
    });
    writeScanOutput(v.files.work.root, posts, summaryOf(v.id, 120, { warnings: 12, protectedPosts: 12, cleaned: 3 }));
    const result = await intake(v, summaryOf(v.id, 120, { warnings: 12, protectedPosts: 12, cleaned: 3 }));
    if (!result.ok) throw new Error(result.code);
    const scan = ImportScanFacts.parse(result.scan);
    expect(scan.posts).toBe(120);
    expect([scan.first, scan.last, scan.fromRef]).toEqual(["2019-03", "2019-05", 0]);
    expect([scan.warnings, scan.protectedPosts, scan.cleaned]).toEqual([12, 12, 3]);
    // Forty lines a month: four of each ten carry a mark, one each of reply, long and warning together, protected.
    expect(scan.months).toEqual(
      ["2019-03", "2019-04", "2019-05"].map((month) => ({
        month,
        groups: [
          [0, 28, 0, 0],
          [1, 4, 0, 0],
          [2 | 4, 4, 0, 0],
          [8, 4, 0, 0],
        ],
      })),
    );
    expect(scan.samples.map((sample) => sample.ref)).toEqual([119, 118, 117]);
    for (const sample of scan.samples) expect((await lineAt(v, sample.offset))?.ref).toBe(sample.ref);
    expect(scan.pages).toHaveLength(3);
    expect(await Promise.all(scan.pages.map(async (offset) => (await lineAt(v, offset))?.ref))).toEqual([0, 50, 100]);
    expect(scan.skipped).toEqual({});
  });

  test("a line that is not JSON, not the contract, out of its place, dated outside the range or over 256 KiB is unreadable; the lines after it are read", async () => {
    const v = volume();
    const lines: (ImportedPost | string)[] = [post(0), "{not json", JSON.stringify({ ...post(2), extra: true }), post(4), post(4), "x".repeat(LINE_MAX_BYTES + 1), post(6, { at: "2006-03-20T23:59:59Z" }), post(7, { at: "2026-10-27T10:00:01Z" }), post(8, { at: "2026-10-27T10:00:00Z" }), post(9)];
    writeScanOutput(v.files.work.root, lines, summaryOf(v.id, 10, { skipped: { not_public: 4, unreadable: 1 } }));
    const result = await intake(v, summaryOf(v.id, 10, { skipped: { not_public: 4, unreadable: 1 } }));
    if (!result.ok) throw new Error(result.code);
    // Lines 1, 2, 3 (ref 4 in place 3), 5 (over the cap), 6 (before the first tweet) and 7 (more than a day after the
    // import's creation) are unreadable; the importer's own unreadable count is added.
    expect(result.scan.posts).toBe(4);
    expect(result.scan.skipped).toEqual({ unreadable: 7, not_public: 4 });
    expect(result.scan.samples.map((sample) => sample.ref)).toEqual([9, 8, 4]);
  });

  test("a note of 75 KB in CJK characters is one readable line, marked long", async () => {
    const v = volume();
    const note = Array.from({ length: 25_000 }, (_, i) => String.fromCharCode(0x4e00 + (i % 500))).join("");
    expect(Buffer.byteLength(note)).toBe(75_000);
    writeScanOutput(v.files.work.root, [post(0, { text: note })], summaryOf(v.id, 1));
    const result = await intake(v, summaryOf(v.id, 1));
    if (!result.ok) throw new Error(result.code);
    expect(result.scan.posts).toBe(1);
    expect(result.scan.months[0]!.groups).toEqual([[2, 1, 0, 0]]);
    expect(marksOf(post(0, { text: note }))).toBe(2);
  });

  test("lines the account already imported are counted and left out; a young account offers its newest lines only, from fromRef", async () => {
    const v = volume();
    writeScanOutput(v.files.work.root, Array.from({ length: 30 }, (_, ref) => post(ref)), summaryOf(v.id, 30));
    const asked: number[] = [];
    const known = async (keys: readonly string[]) => {
      asked.push(keys.length);
      return new Set([keyOf(1), keyOf(25), keyOf(29)]);
    };
    const old = await intake(v, summaryOf(v.id, 30), { known });
    if (!old.ok) throw new Error(old.code);
    expect([old.scan.posts, old.scan.fromRef, old.scan.skipped]).toEqual([27, 0, { already_imported: 3 }]);
    expect(old.scan.samples.map((sample) => sample.ref)).toEqual([28, 27, 26]);
    expect(asked).toEqual([30]);
    // The ten newest of the 27 offered: refs 18 to 28 but 25.
    const young = await intake(v, summaryOf(v.id, 30), { known, young: true, caps: { newAccountPosts: 10 } });
    if (!young.ok) throw new Error(young.code);
    expect([young.scan.posts, young.scan.fromRef, young.scan.skipped]).toEqual([10, 18, { already_imported: 3, new_account_cap: 17 }]);
    expect(young.scan.months.flatMap((month) => month.groups).reduce((sum, group) => sum + group[1], 0)).toBe(10);
  });

  test("keys are asked in batches of a thousand", async () => {
    const v = volume();
    writeScanOutput(v.files.work.root, Array.from({ length: 2_001 }, (_, ref) => post(ref)), summaryOf(v.id, 2_001));
    const asked: number[] = [];
    const result = await intake(v, summaryOf(v.id, 2_001), {
      known: async (keys) => {
        asked.push(keys.length);
        return new Set();
      },
    });
    expect(result.ok && result.scan.posts).toBe(2_001);
    expect(asked).toEqual([IMPORT_RULES.keyBatch, IMPORT_RULES.keyBatch, 1]);
  });

  test("images: each named file must open within 20 MiB or it is missing_file; images without a source's description are counted; beyond the cap over_image_cap; with images off a line's media are images_off", async () => {
    const v = volume();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const posts = [
      post(0, { media: [{ file: "0-0.jpg", alt: "A described photo" }, { file: "0-1.jpg", alt: null }] }),
      post(1, { media: [{ file: "1-0.jpg", alt: null }] }),
      post(2, { media: [{ file: "2-0.png", alt: "Gone" }] }),
    ];
    writeScanOutput(v.files.work.root, posts, summaryOf(v.id, 3, { images: 4, imagesSkipped: { video: 2 } }), { "0-0.jpg": jpeg, "0-1.jpg": jpeg, "1-0.jpg": jpeg });
    const on = await intake(v, summaryOf(v.id, 3, { images: 4, imagesSkipped: { video: 2 } }), { images: true });
    if (!on.ok) throw new Error(on.code);
    expect([on.scan.images, on.scan.imagesSkipped]).toEqual([3, { missing_file: 1, video: 2 }]);
    expect(on.scan.months).toEqual([{ month: "2019-03", groups: [[0, 3, 3, 2]] }]);
    // The cap keeps the newest posts' images first: ref 1's, then ref 0's first.
    const capped = await intake(v, summaryOf(v.id, 3), { images: true, caps: { images: 2 } });
    if (!capped.ok) throw new Error(capped.code);
    expect([capped.scan.images, capped.scan.imagesSkipped]).toEqual([2, { missing_file: 1, over_image_cap: 1 }]);
    expect(capped.scan.months[0]!.groups).toEqual([[0, 3, 2, 1]]);
    const off = await intake(v, summaryOf(v.id, 3), { images: false });
    if (!off.ok) throw new Error(off.code);
    expect([off.scan.images, off.scan.imagesSkipped]).toEqual([0, { images_off: 4 }]);
  });

  test("a posts.jsonl that is no regular file of the work volume is refused: a symlinked folder, a symlinked file, another device, none at all", async () => {
    const v = volume();
    writeScanOutput(v.files.work.root, [post(0)], summaryOf(v.id, 1));
    expect((await intake(v, summaryOf(v.id, 1))).ok).toBe(true);

    // The job's folder as a link (a junction on Windows) to a folder that holds a good posts.jsonl.
    const elsewhere = path.join(v.root, "elsewhere");
    renameSync(v.files.work.jobDir(v.id), elsewhere);
    symlinkSync(elsewhere, v.files.work.jobDir(v.id), "junction");
    expect(await intake(v, summaryOf(v.id, 1))).toEqual({ ok: false, code: "symlink" });
    // The link alone goes, never what it names: unlink, or rmdir for a junction where unlink is refused.
    try {
      unlinkSync(v.files.work.jobDir(v.id));
    } catch {
      rmdirSync(v.files.work.jobDir(v.id));
    }

    // posts.jsonl itself as a link: Windows without developer mode cannot make one.
    mkdirSync(v.files.work.jobDir(v.id), { recursive: true });
    let linked = true;
    try {
      symlinkSync(path.join(elsewhere, "posts.jsonl"), v.files.work.posts(v.id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM" || process.platform !== "win32") throw err;
      linked = false;
    }
    if (linked) expect(await intake(v, summaryOf(v.id, 1))).toEqual({ ok: false, code: "symlink" });
    expect(await intake(volumeWith(v, -1), summaryOf(v.id, 1))).toEqual({ ok: false, code: "other_device" });
    const empty = volume();
    expect(await intake(empty, summaryOf(empty.id, 1))).toEqual({ ok: false, code: "missing" });
  });
});

/** The same volume read as if its mount root were on another device. */
function volumeWith(v: Volume, workDevice: number): Volume {
  const files = createImportFiles({ archivesDir: path.join(v.root, "archives"), workDir: workLayout(v.files.work.root).root, log: pino({ level: "silent" }), workDevice });
  return { ...v, files };
}
