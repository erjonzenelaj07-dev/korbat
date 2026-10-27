import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { IMPORT_RULES, type ImportedPost } from "@korbat/contracts";
import { serializeLine, workLayout } from "@korbat/import-protocol";

/**
 * The API's half of the large-archive lab (3b design, section 12.5; Task 4): the intake of 50,000 lines near the 1 GiB cap
 * of posts.jsonl runs within the API's 512m. The lab writes the file by code (each line a post of about 21,000 characters,
 * dated three hours apart from April 2006 on, so the month table spans seventeen years), then runs the intake in a process of
 * its own (imports-intake.child.ts) and records its time and its peak memory. See README.md, "The intake of a large
 * archive".
 */

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const API = fileURLToPath(new URL("../../", import.meta.url));
const OUT = process.env.LAB_OUT ?? path.join(REPO, ".data", "lab-import-intake.jsonl");
const LINES = IMPORT_RULES.maxPosts;
/** The text of a line: about 21,000 bytes a line in all, 50,000 lines just under postsFileMaxBytes. */
const TEXT_CHARS = 20_800;
/** From April 2006, three hours apart: the last line is dated in 2023, inside the range the importer keeps (5.4). */
const START = Date.UTC(2006, 3, 1);

function lineOf(ref: number, words: string): ImportedPost {
  const at = new Date(START + ref * 3 * 3_600_000).toISOString().replace(/[.][0-9]+Z$/, "Z");
  return { ref, key: createHash("sha256").update(`lab ${ref}`).digest("hex"), at, kind: ref % 5 === 1 ? "reply" : "post", parent: null, text: words, media: [], protected: false, warning: ref % 11 === 0 };
}

describe("the intake of a large archive (API, 512m)", () => {
  test(
    "50,000 lines near 1 GiB: read, counted and tabled in a process of its own, its peak recorded",
    async () => {
      const root = path.join(REPO, ".data", `lab-import-intake-${randomUUID()}`);
      const work = workLayout(root);
      const id = randomUUID();
      mkdirSync(work.jobDir(id), { recursive: true });
      try {
        const words = Array.from({ length: Math.ceil(TEXT_CHARS / 8) }, (_, i) => `word${String(i % 1000).padStart(3, "0")}`).join(" ").slice(0, TEXT_CHARS);
        const out = createWriteStream(work.posts(id));
        for (let ref = 0; ref < LINES; ref++) {
          if (!out.write(serializeLine(lineOf(ref, words)))) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        }
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
        const bytes = statSync(work.posts(id)).size;
        expect(bytes).toBeLessThanOrEqual(IMPORT_RULES.postsFileMaxBytes);
        expect(bytes).toBeGreaterThan(0.95 * IMPORT_RULES.postsFileMaxBytes);

        const output = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", path.join(API, "test", "lab", "imports-intake.child.ts"), root, id, String(LINES)], {
          cwd: API,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          maxBuffer: 1024 * 1024,
        });
        const measured = JSON.parse(output.trim().split(String.fromCharCode(10)).at(-1)!) as { ok: boolean; posts: number; months: number; pages: number; scanBytes: number; asked: number; ms: number; rssBefore: number; maxRss: number };
        const record = { lab: "imports-intake", at: new Date().toISOString(), lines: LINES, bytes, ...measured, peakAboveStartMiB: Math.round((measured.maxRss - measured.rssBefore) / 1048576), maxRssMiB: Math.round(measured.maxRss / 1048576) };
        mkdirSync(path.dirname(OUT), { recursive: true });
        appendFileSync(OUT, JSON.stringify(record) + String.fromCharCode(10));
        console.log(JSON.stringify(record));
        expect(measured.ok).toBe(true);
        expect(measured.posts).toBe(LINES);
        expect(measured.pages).toBe(LINES / IMPORT_RULES.pageLines);
        expect(measured.asked).toBe(LINES);
        expect(measured.scanBytes).toBeLessThan(IMPORT_RULES.scanMaxBytes);
        // The API's container has 512m for everything it does: the intake's own share, its peak above the process's start,
        // stays under half of it.
        expect(measured.maxRss - measured.rssBefore).toBeLessThan(256 * 1024 * 1024);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    1_800_000,
  );
});
