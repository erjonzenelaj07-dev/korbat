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
