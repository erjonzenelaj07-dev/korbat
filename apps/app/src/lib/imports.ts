import { useEffect, useState } from "react";
import { z } from "zod";
import {
  IMPORT_IMAGE_SKIPS,
  IMPORT_MARKS,
  IMPORT_RULES,
  ImportLineView,
  ImportPickView,
  ImportSource,
  ImportView,
  type ImportChoice,
  type ImportImageSkip,
  type ImportPickRequest,
  type ImportStatus,
} from "@korbat/contracts";
import { API_BASE, api, ApiError, errorMessage, messageFor } from "./api";
import { IMPORT_WORDS, sourceName, type ImportWord } from "./import-words";
import { fill } from "./ui-words";

/**
 * The import's client in the app (3b design, sections 4.2, 7.3, 9.2 and 10; Task 7): the calls of 9.2, the chunked
 * uploader, the uploads running in this tab, and the pure functions the screens count and word with. The app imports no
 * other app, so chosenTotals mirrors the API's apps/api/src/imports/plan.ts over the view's month table and picks, and a
 * test holds both to the same table. Nothing here is kept on the device: an upload's file lives in this tab's memory
 * while it runs, and a reload asks the person to choose it again (10.3, resuming).
 */

/** GET /api/imports: the account's imports, newest first, and the sources a new one may name (9.2). */
export const ImportList = z.object({ imports: z.array(ImportView), sources: z.array(ImportSource) });
export type ImportList = z.infer<typeof ImportList>;

/** GET /api/imports/:id/lines?page=<n>: 50 lines of the preview and how many pages there are (9.2). */
export const ImportLinesPage = z.object({ lines: z.array(ImportLineView), pages: z.int().min(0) });
export type ImportLinesPage = z.infer<typeof ImportLinesPage>;

/** PUT /api/imports/:id/archive's answer: the bytes the API holds now. */
const ChunkAnswer = z.object({ receivedBytes: z.int().min(0) });

/** How often a screen reads an import that is moving while the page is visible (10.3). */
export const IMPORT_POLL_MS = 3_000;

/** Only a lowercase UUID names an import and becomes part of a path, as the API's own routes check (7.1). */
const IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isImportId = (id: string): boolean => IMPORT_ID.test(id);

function importPath(id: string): string {
  if (!isImportId(id)) throw new ApiError(404, "not_found", messageFor("not_found"));
  return `/api/imports/${id}`;
}

/**
 * The routes of 9.2, typed by the contracts. Cookies and CSRF are lib/api.ts's. Each call that names an import is async,
 * so an id that is no import's (a typed address) is a refused promise, never a throw while a screen renders.
 */
export const imports = {
  list: () => api("/api/imports", { schema: ImportList }),
  get: async (id: string) => api(importPath(id), { schema: ImportView }),
  create: (source: ImportSource, bytes: number) => api("/api/imports", { json: { source, bytes }, schema: ImportView }),
  /** One chunk, raw, at `offset`, with its SHA-256 as 64 lowercase hex (7.3). */
  chunk: async (id: string, offset: number, chunk: Blob, sha256: string) =>
    api(`${importPath(id)}/archive`, {
      method: "PUT",
      raw: { type: "application/octet-stream", body: chunk },
      headers: { "import-offset": String(offset), "import-chunk-sha256": sha256 },
      schema: ChunkAnswer,
    }),
  lines: async (id: string, page: number) => api(`${importPath(id)}/lines?page=${Math.max(0, Math.floor(page))}`, { schema: ImportLinesPage }),
  pick: async (id: string, ref: number, pick: ImportPickRequest) => api(`${importPath(id)}/lines/${Math.floor(ref)}`, { method: "PUT", json: pick, schema: ImportPickView }),
  /** An image of the preview, the owner's only (9.2); the API sniffs it and never lets it be cached. */
  mediaUri: (id: string, file: string) => `${API_BASE}${importPath(id)}/media/${encodeURIComponent(file)}`,
  /** The choice with the statement (decision 14), which the request carries as `statement: true`. */
  confirm: async (id: string, choice: ImportChoice) => api(`${importPath(id)}/confirm`, { json: { choice, statement: true }, schema: ImportView }),
  cancel: async (id: string) => api(`${importPath(id)}/cancel`, { method: "POST", schema: ImportView }),
  stop: async (id: string) => api(`${importPath(id)}/stop`, { method: "POST", schema: ImportView }),
  undo: async (id: string) => api(`${importPath(id)}/undo`, { method: "POST", schema: ImportView }),
};

/** The browser's Web Crypto, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as { crypto: { subtle: { digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> } } };
const HEX = "0123456789abcdef";

/** A chunk's SHA-256 as 64 lowercase hex, as Import-Chunk-Sha256 carries it (7.3). */
export async function chunkHash(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await web.crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const byte of digest) out += HEX[byte >> 4]! + HEX[byte & 15]!;
  return out;
}

/** The unsigned varint a CAR's header starts with, and its length; null when it does not end within 9 bytes. */
function varint(bytes: Uint8Array): [number, number] | null {
  let value = 0;
  for (let i = 0; i < bytes.length && i < 9; i++) {
    value += (bytes[i]! & 0x7f) * 2 ** (7 * i);
    if ((bytes[i]! & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/**
 * What the app says of a chosen file before anything is sent (4.2 step 2): its size against 2 GiB, then its first bytes,
 * read as the API reads them (apps/api/src/imports/flows/chunk.ts's firstBytesVerdict): gzip's two bytes are the
 * .tar.gz of an old Mastodon server, X and Mastodon need a zip's local header, Bluesky a CAR's header (its length as a
 * varint within the block cap, then a CBOR map). Null for a file that may be sent; otherwise the words' key.
 */
export function archiveProblem(source: ImportSource, size: number, head: Uint8Array): "import.tooLarge" | "import.notArchive" | "import.tarGz" | null {
  if (size > IMPORT_RULES.maxBytes) return "import.tooLarge";
  if (size < 1 || head.length < 2) return "import.notArchive";
  if (head[0] === 0x1f && head[1] === 0x8b) return "import.tarGz";
  if (source === "bluesky") {
    const read = varint(head);
    if (read === null) return "import.notArchive";
    const [length, used] = read;
    return length > 0 && length <= IMPORT_RULES.carBlockMaxBytes && head.length > used && head[used]! >> 5 === 5 ? null : "import.notArchive";
  }
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 ? null : "import.notArchive";
}

/** How a run of the uploader ended. */
export type UploadOutcome =
  | { status: "done"; receivedBytes: number }
  | { status: "stopped"; receivedBytes: number }
  /** The import left uploading meanwhile (a cancel in another tab, its 24 hours): its view as the API answered it. */
  | { status: "moved"; view: ImportView }
  | { status: "failed"; receivedBytes: number; error: ApiError };

export interface UploadOptions {
  id: string;
  file: Blob;
  /** The bytes the API holds already: 0 for a new upload, the view's receivedBytes when it goes on. */
  from: number;
  /** The view's chunkBytes, IMPORT_RULES.chunkBytes. */
  chunkBytes: number;
  onProgress?: (receivedBytes: number) => void;
  /** Read before every chunk: true when the person cancelled. */
  stopped?: () => boolean;
  /** Waits before a chunk is tried again; tests pass one that does not. */
  wait?: (ms: number) => Promise<void>;
}

/** wrong_offset at the very place the uploader is, as for a chunk of this import still in flight: tried this often, a second apart. */
const IN_FLIGHT_TRIES = 10;
const IN_FLIGHT_WAIT_MS = 1_000;
/** Network errors in a row, each followed by a read of the import, before the upload gives up. */
const NETWORK_TRIES = 5;

/** The stored size wrong_offset's details carry. */
function storedOf(details: unknown): number | null {
  const stored = (details as { receivedBytes?: unknown } | null)?.receivedBytes;
  return typeof stored === "number" && Number.isInteger(stored) && stored >= 0 ? stored : null;
}

/**
 * The chunked uploader (7.3, 10.3): the file from `from`, one chunk of exactly chunkBytes at a time (the last one
 * shorter), each hashed with crypto.subtle.digest and sent with Import-Offset and Import-Chunk-Sha256. chunk_mismatch
 * sends the chunk again, at most IMPORT_RULES.chunkRetries times; wrong_offset goes on from the stored size its details
 * carry (waiting a second when another request of this import is still in flight); after a network error the import is
 * read (GET /api/imports/:id) before anything more is sent, and the upload goes on from its receivedBytes. Any other
 * refusal ends the run with its error: a refused first chunk (not_an_archive) has failed the import already.
 */
export async function uploadArchive(options: UploadOptions): Promise<UploadOutcome> {
  const { id, file, chunkBytes } = options;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let offset = options.from;
  let mismatches = 0;
  let stalled = 0;
  let lost = 0;
  while (offset < file.size) {
    if (options.stopped?.()) return { status: "stopped", receivedBytes: offset };
    const chunk = file.slice(offset, Math.min(offset + chunkBytes, file.size));
    try {
      const sha256 = await chunkHash(await chunk.arrayBuffer());
      const answer = await imports.chunk(id, offset, chunk, sha256);
      offset = answer.receivedBytes;
      mismatches = 0;
      stalled = 0;
      lost = 0;
      options.onProgress?.(offset);
    } catch (thrown) {
      const err = thrown instanceof ApiError ? thrown : new ApiError(500, "internal", errorMessage(thrown));
      if (err.code === "chunk_mismatch" && mismatches < IMPORT_RULES.chunkRetries) {
        mismatches += 1;
        continue;
      }
      if (err.code === "wrong_offset") {
        const stored = storedOf(err.details);
        if (stored === null || stored > file.size) return { status: "failed", receivedBytes: offset, error: err };
        if (stored === offset) {
          stalled += 1;
          if (stalled > IN_FLIGHT_TRIES) return { status: "failed", receivedBytes: offset, error: err };
          await wait(IN_FLIGHT_WAIT_MS);
        }
        offset = stored;
        mismatches = 0;
        continue;
      }
      if (err.status === 0 && lost < NETWORK_TRIES) {
        lost += 1;
        await wait(IN_FLIGHT_WAIT_MS * lost);
        // The chunk may have arrived and only its answer been lost: the import says what the API holds.
        let view: ImportView;
        try {
          view = await imports.get(id);
        } catch (again) {
          return { status: "failed", receivedBytes: offset, error: again instanceof ApiError ? again : err };
        }
        if (view.status !== "uploading") return { status: "moved", view };
        offset = view.receivedBytes;
        mismatches = 0;
        options.onProgress?.(offset);
        continue;
      }
      return { status: "failed", receivedBytes: offset, error: err };
    }
  }
  return { status: "done", receivedBytes: offset };
}

/** An upload running in this tab, as the import's screen draws it. */
export interface UploadRunState {
  receivedBytes: number;
  running: boolean;
  error: ApiError | null;
}

interface UploadRun {
  state: UploadRunState;
  /** The file, in this tab's memory only, while the run may go on or be tried again. */
  file: Blob | null;
  stop: boolean;
  /** How the last run ended, for the screen to read the import again. */
  outcome: UploadOutcome | null;
  listeners: Set<() => void>;
}

/** The uploads of this tab, by import: they go on while the person moves between screens, and end with the tab. */
const runs = new Map<string, UploadRun>();

const notify = (run: UploadRun) => {
  for (const listener of [...run.listeners]) listener();
};

/** Starts (or starts again) the upload of `file` for an import, from the bytes the view says the API holds. */
export function startUpload(view: Pick<ImportView, "id" | "receivedBytes" | "chunkBytes">, file: Blob): void {
  const run: UploadRun = runs.get(view.id) ?? { state: { receivedBytes: view.receivedBytes, running: false, error: null }, file: null, stop: false, outcome: null, listeners: new Set() };
  if (run.state.running) return;
  runs.set(view.id, run);
  run.file = file;
  run.stop = false;
  run.outcome = null;
  run.state = { receivedBytes: view.receivedBytes, running: true, error: null };
  notify(run);
  void uploadArchive({
    id: view.id,
    file,
    from: view.receivedBytes,
    chunkBytes: view.chunkBytes,
    stopped: () => run.stop,
    onProgress: (receivedBytes) => {
      run.state = { ...run.state, receivedBytes };
      notify(run);
    },
  }).then((outcome) => {
    run.outcome = outcome;
    const receivedBytes = outcome.status === "moved" ? outcome.view.receivedBytes : outcome.receivedBytes;
    run.state = { receivedBytes, running: false, error: outcome.status === "failed" ? outcome.error : null };
    // A finished or abandoned upload has no use for its file; a failed one keeps it, so Try again needs no new choice.
    if (outcome.status !== "failed") run.file = null;
    notify(run);
  });
}

/** Stops the upload before its next chunk (Cancel import). */
export function stopUpload(id: string): void {
  const run = runs.get(id);
  if (run) run.stop = true;
}

/** The file of a run that failed, to try it again from what the API holds; null when the tab holds none. */
export const uploadFile = (id: string): Blob | null => runs.get(id)?.file ?? null;

/** Forgets an import's run once its upload has nothing more to do (the import moved on). */
export function forgetUpload(id: string): void {
  const run = runs.get(id);
  if (run && !run.state.running) runs.delete(id);
}

/** The run of an import in this tab, followed as it goes; null when this tab is not uploading it. */
export function useUploadRun(id: string): UploadRunState | null {
  const [state, setState] = useState<UploadRunState | null>(() => runs.get(id)?.state ?? null);
  useEffect(() => {
    const follow = () => setState(runs.get(id)?.state ?? null);
    follow();
    let run = runs.get(id);
    const attach = () => {
      run?.listeners.delete(follow);
      run = runs.get(id);
      run?.listeners.add(follow);
    };
    attach();
    // A run started after the screen mounted (the start screen hands the file over just before it navigates) is found
    // by a short check while none is held.
    const timer = setInterval(() => {
      if (runs.get(id) !== run) {
        attach();
        follow();
      }
    }, 250);
    return () => {
      clearInterval(timer);
      run?.listeners.delete(follow);
    };
  }, [id]);
  return state;
}

const bit = (mark: (typeof IMPORT_MARKS)[number]): number => 1 << IMPORT_MARKS.indexOf(mark);

/** Whether a choice keeps a line of these marks, as plan.ts's marksPass: replies, long posts, warnings and protected posts each as chosen. */
export function marksPass(marks: number, choice: Pick<ImportChoice, "replies" | "long" | "warnings" | "protected">): boolean {
  if (marks & bit("reply") && !choice.replies) return false;
  if (marks & bit("long") && choice.long !== "shorten") return false;
  if (marks & bit("warning") && !choice.warnings) return false;
  if (marks & bit("protected") && !choice.protected) return false;
  return true;
}

/** Whether a month (YYYY-MM) is within the choice's range, either end open when null, as plan.ts's monthInChoice. */
export const monthInChoice = (month: string, choice: Pick<ImportChoice, "from" | "to">): boolean => (choice.from === null || month >= choice.from) && (choice.to === null || month <= choice.to);

type MonthTable = ImportView["picks"];

/** What the totals read of a view: the scan's month table and the picks' counts. */
export interface Tables {
  scan: { months: MonthTable } | null;
  picks: MonthTable;
}

/**
 * The posts and images a choice holds (4.4; the orchestrator's ruling for Task 5), counted exactly as the API's
 * chosenTotals counts them and stores them at the confirmation: the scan's groups [marks, posts, images, images without
 * a source's description] over the months and marks the choice keeps, less the picks' posts left out and their described
 * images, plus the descriptions the picks gave. Images count only while `images` (the site brings them and so does the
 * choice).
 */
export function chosenTotals(view: Tables, choice: ImportChoice, images: boolean): { posts: number; images: number } {
  let posts = 0;
  let kept = 0;
  for (const { month, groups } of view.scan?.months ?? []) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, count, withImages, undescribed] of groups) {
      if (!marksPass(marks, choice)) continue;
      posts += count;
      kept += withImages - undescribed;
    }
  }
  for (const { month, groups } of view.picks) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, out, described, given] of groups) {
      if (!marksPass(marks, choice)) continue;
      posts -= out;
      kept -= described - given;
    }
  }
  return { posts: Math.max(0, posts), images: images ? Math.max(0, kept) : 0 };
}

/** The reasons the app counts itself (9.3), in the order a line's first refused mark names it. */
const MARK_REASONS = [
  ["reply", "reply"],
  ["long", "too_long"],
  ["warning", "warning"],
  ["protected", "protected"],
] as const;

export type ChoiceSkip = "reply" | "too_long" | "warning" | "protected" | "left_out";

/**
 * The posts the choice leaves out by a reason of its own (9.3: reply, too_long, warning, protected and left_out), within
 * the months it keeps: each group the marks refuse counted once, by the first mark the choice refuses, and the picks that
 * leave a line out among the lines the marks keep. Zero counts are left out.
 */
export function leftOutCounts(view: Tables, choice: ImportChoice): Partial<Record<ChoiceSkip, number>> {
  const counts: Partial<Record<ChoiceSkip, number>> = {};
  const add = (reason: ChoiceSkip, n: number) => {
    if (n > 0) counts[reason] = (counts[reason] ?? 0) + n;
  };
  for (const { month, groups } of view.scan?.months ?? []) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, count] of groups) {
      const refused = MARK_REASONS.find(([mark]) => (marks & bit(mark)) !== 0 && !marksPass(marks & bit(mark), choice));
      if (refused) add(refused[1], count);
    }
  }
  for (const { month, groups } of view.picks) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, out] of groups) if (marksPass(marks, choice)) add("left_out", out);
  }
  return counts;
}

/** The images of the chosen posts that still have no description (import.choose.images.noAlt): the scan's, less those the picks gave one. */
export function undescribedCount(view: Tables, choice: ImportChoice): number {
  let missing = 0;
  for (const { month, groups } of view.scan?.months ?? []) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, , , undescribed] of groups) if (marksPass(marks, choice)) missing += undescribed;
  }
  for (const { month, groups } of view.picks) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, , , given] of groups) if (marksPass(marks, choice)) missing -= given;
  }
  return Math.max(0, missing);
}

/**
 * Whether this import brings images at all: the importer counts every image images_off while the site's switch is off
 * (decision 15), and a Bluesky export holds none (decision 16).
 */
export const imagesOn = (view: Pick<ImportView, "source" | "scan">): boolean => view.source !== "bluesky" && !((view.scan?.imagesSkipped.images_off ?? 0) > 0);

/** The images the archive named, kept or not, and those the scan kept: import.found.images' two numbers. */
export function foundImages(scan: NonNullable<ImportView["scan"]>): { n: number; kept: number } {
  let skipped = 0;
  for (const reason of IMPORT_IMAGE_SKIPS) skipped += scan.imagesSkipped[reason as ImportImageSkip] ?? 0;
  return { n: scan.images + skipped, kept: scan.images };
}

/** The choice a preview starts from (4.4): everything, no replies, no warnings, no protected posts, no images, long posts left out. */
export function startingChoice(view: Pick<ImportView, "choice">): ImportChoice {
  return view.choice ?? { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };
}

/**
 * The polite sentence of a change of state the screen saw while it was open (10.1): the news the import brought by itself.
 * A change the person's own press made (their confirm, cancel or remove) is answered where they pressed, so it says
 * nothing here; nor does an admin's end, which the view's own sentence says with its rule.
 */
export function announcement(from: ImportStatus, to: ImportStatus): string | null {
  if (from === to) return null;
  if (to === "cancelled" || to === "undoing" || (from === "ready" && (to === "preparing" || to === "publishing"))) return null;
  switch (to) {
    case "scanning":
      return IMPORT_WORDS["import.now.scanning"];
    case "ready":
      return IMPORT_WORDS["import.now.ready"];
    case "failed":
      return IMPORT_WORDS["import.now.failed"];
    case "publishing":
      return IMPORT_WORDS["import.now.publishing"];
    case "done":
      return IMPORT_WORDS["import.now.done"];
    case "stopped":
      return IMPORT_WORDS["import.now.stopped"];
    case "undone":
      return IMPORT_WORDS["import.now.undone"];
    case "expired":
      return IMPORT_WORDS["import.expired"];
    default:
      return null;
  }
}

/** The refusals of 9.4 in 10.9's words. rate_limited is the per-address limit only when an import is created. */
const REFUSALS: Partial<Record<string, ImportWord>> = {
  import_active: "import.active",
  imports_unavailable: "import.unavailable",
  import_weekly_limit: "import.limit",
  import_too_soon: "import.tooSoon",
  archive_too_large: "import.tooLarge",
  wrong_state: "import.wrongState",
  statement_required: "import.statementRequired",
  nothing_chosen: "import.publish.nothing",
};

/**
 * The sentence for a refusal of the import's routes: 10.9's for the codes of 9.4, the source's not_an_archive with its
 * name, and the shared sentence for the rest (account_suspended, not_found, a network error).
 */
export function importErrorMessage(err: unknown, options: { source?: ImportSource; during?: "create" | "act" } = {}): string {
  if (err instanceof ApiError) {
    if (err.code === "rate_limited" && options.during === "create") return IMPORT_WORDS["import.limit.network"];
    if (err.code === "not_an_archive") return fill(IMPORT_WORDS["import.notArchive"], { source: options.source === undefined ? "" : sourceName(options.source) });
    const key = REFUSALS[err.code];
    if (key !== undefined) return IMPORT_WORDS[key];
  }
  return errorMessage(err);
}

const COUNT = new Intl.NumberFormat("en-GB");

/** A count as the screens print one: "1,240". */
export const formatCount = (n: number): string => COUNT.format(n);

/** One decimal, without a trailing ".0". */
const oneDecimal = (n: number): string => String(Number(n.toFixed(1)));

/** A size in decimal units, as the value text prints it (10.3): "0 KB" before the first chunk, "4 KB", "2.5 MB", "120 MB", "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${bytes <= 0 ? 0 : Math.max(1, Math.round(bytes / 1_000))} KB`;
  if (bytes < 1_000_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb < 10 ? oneDecimal(mb) : Math.round(mb)} MB`;
  }
  return `${oneDecimal(bytes / 1_000_000_000)} GB`;
}

/**
 * Decision 13's cut as plan.ts makes it, for the preview's cards of a long post the choice shortens: at the last space
 * or line break within the first shortenTo - 1 code points (at shortenTo - 1 without one), and the ellipsis.
 */
export function shortened(text: string): { body: string; cut: boolean } {
  const points = Array.from(text);
  if (points.length <= IMPORT_RULES.shortenTo) return { body: text, cut: false };
  const head = points.slice(0, IMPORT_RULES.shortenTo - 1);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf(String.fromCharCode(10)));
  return { body: (space > 0 ? head.slice(0, space) : head).join("").trimEnd() + String.fromCharCode(0x2026), cut: true };
}
