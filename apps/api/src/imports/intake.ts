import { IMPORT_MARKS, IMPORT_RULES, MEDIA_MAX_BYTES, postLength, type ImportImageSkip, type ImportScanFacts, type ImportSkipReason, type ImportSummary, type ImportedPost } from "@korbat/contracts";
import { LINE_MAX_BYTES, POSTS_MAX_BYTES, POSTS_MAX_LINES, parsePostLine, readLines, type WorkFileRefusal } from "@korbat/import-protocol";
import type { Logger } from "pino";
import type { ImportFiles } from "./files";

/**
 * The intake (3b design, section 7.5 step 2): what the API makes of a scan once its summary says "scanned". It reads
 * posts.jsonl line by line through openWorkFile, each line at most 256 KiB and parsed with the contracts' ImportedPost,
 * and keeps per line only a few numbers in typed arrays (its offset, month, marks and images) and its key, so 50,000
 * lines of up to 1 GiB cost a few megabytes. A line is readable when it parses and its ref is its place in the file
 * (refs run 0, 1, 2 in order); any other line is counted unreadable and is in no table. Each image a readable line names
 * must open through openWorkFile within 20 MiB, or it is counted missing_file and left out of the line; a line dated
 * outside the range the importer keeps (5.4: from 2006-03-21 to a day after the import's creation) is unreadable too, so
 * no hostile file can grow the month table past what the row holds. Then, in batches
 * of a thousand keys, the lines whose key the account's posts already carry are counted already_imported; for an
 * account younger than 30 days every offered line but the newest thousand is counted new_account_cap, and fromRef names
 * the lowest ref that may be published. What is left is offered: its month table, the three newest lines as samples and
 * every fiftieth line's offset as the preview's pages. Nothing of a line's text is kept or logged.
 */

/** A scanned summary: the importer's counts, which the intake adds its own to. */
export type ScannedSummary = Extract<ImportSummary, { status: "scanned" }>;

/** The caps of 7.5 step 2 and decision 21; tests give smaller ones. */
export interface IntakeCaps {
  lines: number;
  bytes: number;
  lineBytes: number;
  newAccountPosts: number;
  images: number;
}

const CAPS: IntakeCaps = {
  lines: POSTS_MAX_LINES,
  bytes: POSTS_MAX_BYTES,
  lineBytes: LINE_MAX_BYTES,
  newAccountPosts: IMPORT_RULES.newAccountMaxPosts,
  images: IMPORT_RULES.maxImages,
};

export interface IntakeOptions {
  id: string;
  summary: ScannedSummary;
  /** Whether the import brings images (its row's images, which job.json said too). */
  images: boolean;
  /** When the import was created, from which the latest date a line may carry counts (5.4). */
  createdAt: Date;
  /** The account is younger than 30 days (decision 21). */
  young: boolean;
  /** The social module's read: which of these keys the account's posts carry now (at most a thousand a call). */
  known: (keys: readonly string[]) => Promise<ReadonlySet<string>>;
  files: Pick<ImportFiles, "openWork" | "work">;
  log: Logger;
  caps?: Partial<IntakeCaps>;
}

export type IntakeResult = { ok: true; scan: ImportScanFacts } | { ok: false; code: WorkFileRefusal | "invalid" };

/** A line's marks, as IMPORT_MARKS' bits: reply, long (over shortenTo code points), warning, protected. */
export function marksOf(post: Pick<ImportedPost, "kind" | "text" | "warning" | "protected">): number {
  const bit = (mark: (typeof IMPORT_MARKS)[number]) => 1 << IMPORT_MARKS.indexOf(mark);
  let marks = 0;
  if (post.kind === "reply") marks |= bit("reply");
  if (postLength(post.text) > IMPORT_RULES.shortenTo) marks |= bit("long");
  if (post.warning) marks |= bit("warning");
  if (post.protected) marks |= bit("protected");
  return marks;
}

/** The latest date a line of an import created at `createdAt` may carry (5.4), in the lines' own format. */
export const latestDate = (createdAt: Date): string => new Date(createdAt.getTime() + IMPORT_RULES.futureDays * 86_400_000).toISOString().replace(/[.][0-9]+Z$/, "Z");
const EARLIEST = `${IMPORT_RULES.earliestDate}T00:00:00Z`;

/**
 * A line as the intake reads it: the ImportedPost it holds when it parses, its ref is its place in the file and its date
 * is within the range the importer keeps; null for any other line, which is unreadable. The lines and picks routes read
 * a line by the same rule, so they show exactly the lines the intake offered. Dates are whole seconds of UTC in one
 * format, so their text compares as their time does.
 */
export function readableLine(text: string | null, index: number, latest: string): ImportedPost | null {
  const post = text === null ? null : parsePostLine(text);
  return post === null || post.ref !== index || post.at < EARLIEST || post.at > latest ? null : post;
}

/** The month of a line's date, YYYY-MM, as one number (YYYYMM), and back. */
const monthNumber = (at: string): number => Number(at.slice(0, 4)) * 100 + Number(at.slice(5, 7));
const monthText = (n: number): string => `${String(Math.floor(n / 100)).padStart(4, "0")}-${String(n % 100).padStart(2, "0")}`;

/** The set bits of a small number. */
const bits = (n: number): number => {
  let count = 0;
  for (let v = n; v > 0; v >>= 1) count += v & 1;
  return count;
};

/** Adds one count to a partial record of reasons, keeping only the reasons that have one. */
function add<K extends string>(record: Partial<Record<K, number>>, key: K, by: number): void {
  if (by > 0) record[key] = (record[key] ?? 0) + by;
}

const READABLE = 1;
const KNOWN = 2;

export async function runIntake(options: IntakeOptions): Promise<IntakeResult> {
  const caps = { ...CAPS, ...options.caps };
  const { files, id, log } = options;
  const opened = await files.openWork(files.work.posts(id), caps.bytes);
  if (!opened.ok) return { ok: false, code: opened.code };

  const offsets = new Float64Array(caps.lines);
  const state = new Uint8Array(caps.lines);
  const months = new Int32Array(caps.lines);
  const marks = new Uint8Array(caps.lines);
  const imageCount = new Uint8Array(caps.lines);
  // The positions, among the images kept, of those without a source's description.
  const undescribed = new Uint8Array(caps.lines);
  const keys: string[] = [];
  const skipped: Partial<Record<ImportSkipReason, number>> = {};
  const imagesSkipped: Partial<Record<ImportImageSkip, number>> = {};
  const refused: Partial<Record<string, number>> = {};
  let lines = 0;
  let unreadable = 0;
  const latest = latestDate(options.createdAt);
  try {
    for await (const line of readLines(opened.file.handle, { maxLines: caps.lines, maxBytes: caps.bytes, lineMaxBytes: caps.lineBytes })) {
      const ref = lines++;
      offsets[ref] = line.offset;
      keys.push("");
      const post = readableLine(line.text, ref, latest);
      if (post === null) {
        unreadable++;
        continue;
      }
      state[ref] = READABLE;
      keys[ref] = post.key;
      months[ref] = monthNumber(post.at);
      marks[ref] = marksOf(post);
      if (post.media.length > 0 && !options.images) {
        // An importer told that images are off writes none; whatever a line names then is not imported.
        add(imagesSkipped, "images_off", post.media.length);
        continue;
      }
      let kept = 0;
      let mask = 0;
      for (const media of post.media) {
        const image = await files.openWork(files.work.media(id, media.file), MEDIA_MAX_BYTES);
        if (!image.ok) {
          add(imagesSkipped, "missing_file", 1);
          add(refused, image.code, 1);
          continue;
        }
        await image.file.handle.close();
        if (media.alt === null) mask |= 1 << kept;
        kept++;
      }
      imageCount[ref] = kept;
      undescribed[ref] = mask;
    }
  } catch (err) {
    log.error({ id, phase: "intake", error: (err as NodeJS.ErrnoException).code ?? "read" }, "import: posts.jsonl could not be read");
    return { ok: false, code: "error" };
  } finally {
    await opened.file.handle.close();
  }
  if (Object.keys(refused).length > 0) log.warn({ id, phase: "intake", refused }, "import: images the importer named were refused (missing_file)");

  // Lines whose key the account's posts carry now, asked in batches.
  let known = 0;
  for (let from = 0; from < lines; from += IMPORT_RULES.keyBatch) {
    const batch: number[] = [];
    for (let ref = from; ref < Math.min(lines, from + IMPORT_RULES.keyBatch); ref++) if (state[ref] === READABLE) batch.push(ref);
    if (batch.length === 0) continue;
    const found = await options.known(batch.map((ref) => keys[ref]!));
    for (const ref of batch) {
      if (found.has(keys[ref]!)) {
        state[ref] = KNOWN;
        known++;
      }
    }
  }

  // The lines offered, oldest first; a young account's newest thousand of them only.
  let offered: number[] = [];
  for (let ref = 0; ref < lines; ref++) if (state[ref] === READABLE) offered.push(ref);
  let capped = 0;
  if (options.young && offered.length > caps.newAccountPosts) {
    capped = offered.length - caps.newAccountPosts;
    offered = offered.slice(capped);
  }
  const fromRef = options.young && offered.length > 0 ? offered[0]! : 0;

  // Images, newest posts first, at most the cap; a line's images beyond it are its last ones.
  const table = new Map<number, Map<number, [number, number, number]>>();
  let images = 0;
  let overImages = 0;
  for (let i = offered.length - 1; i >= 0; i--) {
    const ref = offered[i]!;
    const count = Math.min(imageCount[ref]!, Math.max(0, caps.images - images));
    overImages += imageCount[ref]! - count;
    images += count;
    const groups = table.get(months[ref]!) ?? new Map<number, [number, number, number]>();
    table.set(months[ref]!, groups);
    const group = groups.get(marks[ref]!) ?? [0, 0, 0];
    groups.set(marks[ref]!, group);
    group[0] += 1;
    group[1] += count;
    group[2] += bits(undescribed[ref]! & ((1 << count) - 1));
  }

  add(skipped, "unreadable", unreadable);
  add(skipped, "already_imported", known);
  add(skipped, "new_account_cap", capped);
  add(imagesSkipped, "over_image_cap", overImages);
  const { v: _v, id: _id, status: _status, ...counts } = options.summary;
  for (const [reason, count] of Object.entries(counts.skipped)) add(skipped, reason as ImportSkipReason, count ?? 0);
  for (const [reason, count] of Object.entries(counts.imagesSkipped)) add(imagesSkipped, reason as ImportImageSkip, count ?? 0);

  const sorted = [...table.keys()].sort((a, b) => a - b);
  const pages: number[] = [];
  for (let i = 0; i < offered.length && pages.length < IMPORT_RULES.maxPages; i += IMPORT_RULES.pageLines) pages.push(offsets[offered[i]!]!);
  const scan = {
    ...counts,
    posts: offered.length,
    images,
    skipped,
    imagesSkipped,
    months: sorted.map((month) => ({
      month: monthText(month),
      groups: [...table.get(month)!.entries()].sort(([a], [b]) => a - b).map(([group, [posts, withImages, without]]) => [group, posts, withImages, without] as [number, number, number, number]),
    })),
    first: sorted.length > 0 ? monthText(sorted[0]!) : null,
    last: sorted.length > 0 ? monthText(sorted.at(-1)!) : null,
    fromRef,
    samples: offered.slice(-IMPORT_RULES.samples).reverse().map((ref) => ({ ref, offset: offsets[ref]! })),
    pages,
  } satisfies ImportScanFacts;
  log.info({ id, phase: "intake", lines, offered: offered.length, unreadable, known, capped, images }, "import: intake done");
  return { ok: true, scan };
}
