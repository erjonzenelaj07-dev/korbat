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
