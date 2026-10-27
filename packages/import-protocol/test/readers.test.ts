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
