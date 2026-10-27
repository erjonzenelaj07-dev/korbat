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
