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
