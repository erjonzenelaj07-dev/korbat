import type { FileHandle } from "node:fs/promises";
import { IMPORT_RULES, ImportPickRequest, MEDIA_MAX_BYTES, type ImportLineView, type ImportPickView, type ImportedPost } from "@korbat/contracts";
import { SAMPLE_MAX_BYTES, isImportMediaFile, readLineAt, readLines } from "@korbat/import-protocol";
import { SNIFF_BYTES, sniffImage } from "@korbat/media-protocol";
import { enforceImportLimit, ImportError, type ImportDeps } from "../context";
import { latestDate, marksOf, readableLine } from "../intake";
import { pgError, type ImportRow } from "../repo";
import { pickCounts, scanOf } from "../view";

/**
 * The preview's list and the person's picks (3b design, sections 4.4 and 9.2), and the preview's images. Each reads
 * posts.jsonl or one image through openWorkFile, only while the import is ready, from the offsets the intake noted:
 * scan.pages holds every fiftieth offered line's offset, so page n is read from pages[n] up to pages[n + 1], and a line
 * there is shown only by the intake's own rule (readable, at or after fromRef, not already imported).
 */

/** How many readable lines are asked about at once whether the account already imported them. */
const KNOWN_BATCH = 100;

type Ready = { row: ImportRow; scan: NonNullable<ReturnType<typeof scanOf>> };

async function readyImport(deps: ImportDeps, ownerId: string, id: string): Promise<Ready> {
  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  const scan = scanOf(row);
  if (row.status !== "ready" || scan === null) throw new ImportError("wrong_state");
  return { row, scan };
}

/** posts.jsonl through openWorkFile; a refusal is logged with its code and answered as the site's (the importer misbehaved). */
async function openPosts(deps: ImportDeps, id: string): Promise<FileHandle> {
  const opened = await deps.files.openWork(deps.files.work.posts(id), IMPORT_RULES.postsFileMaxBytes);
  if (!opened.ok) {
    deps.log.error({ id, code: opened.code }, "import: posts.jsonl was refused");
    throw new ImportError("imports_unavailable");
  }
  return opened.file.handle;
}

/** Which of a line's images open through openWorkFile within 20 MiB: the intake counted the others missing_file. */
async function present(deps: ImportDeps, row: ImportRow, post: ImportedPost): Promise<boolean[]> {
  if (!row.images) return post.media.map(() => false);
  const found: boolean[] = [];
  for (const media of post.media) {
    const opened = await deps.files.openWork(deps.files.work.media(row.id, media.file), MEDIA_MAX_BYTES);
    if (opened.ok) await opened.file.handle.close();
    found.push(opened.ok);
  }
  return found;
}

/** The archive's day of a line, never its second. */
const dayOf = (at: string): string => at.slice(0, 10);

/** GET /api/imports/:id/lines?page=<n>: 50 offered lines of the preview with their marks and picks, and how many pages there are. */
export async function linesPage(deps: ImportDeps, ownerId: string, id: string, page: number): Promise<{ lines: ImportLineView[]; pages: number }> {
  const { row, scan } = await readyImport(deps, ownerId, id);
  const pages = scan.pages.length;
  const from = scan.pages[page];
  if (from === undefined) return { lines: [], pages };
  const latest = latestDate(row.createdAt);
  const handle = await openPosts(deps, id);
  const shown: ImportedPost[] = [];
  try {
    let batch: ImportedPost[] = [];
    const settle = async () => {
      const known = await deps.social.importedKeys(ownerId, batch.map((post) => post.key));
      for (const post of batch) if (!known.has(post.key) && shown.length < IMPORT_RULES.pageLines) shown.push(post);
      batch = [];
    };
    let index: number | null = null;
    // A page reads up to the next page's offset (Task 1's settlement), so its lines are its own.
    for await (const line of readLines(handle, { from, maxBytes: scan.pages[page + 1] ?? IMPORT_RULES.postsFileMaxBytes })) {
      // The first line of a page is an offered line, whose ref is its place in the file; the next ones count from it.
      // A first line that names no ref (the file changed under the intake) leaves the whole page unreadable.
      if (index === null) index = readFirstRef(line.text) ?? Number.NaN;
      const post = readableLine(line.text, index, latest);
      index++;
      if (post === null || post.ref < scan.fromRef) continue;
      batch.push(post);
      if (batch.length >= KNOWN_BATCH) await settle();
      if (shown.length >= IMPORT_RULES.pageLines) break;
    }
    if (batch.length > 0 && shown.length < IMPORT_RULES.pageLines) await settle();
  } finally {
    await handle.close();
  }
  const picks = new Map((await deps.repo.picks(id, shown.map((post) => post.ref))).map((pick) => [pick.ref, pick]));
  const lines: ImportLineView[] = shown.map((post) => ({
    ref: post.ref,
    at: dayOf(post.at),
    kind: post.kind,
    marks: marksOf(post),
    text: post.text,
    media: row.images ? post.media.map(({ file, alt }) => ({ file, alt })) : [],
    leftOut: picks.get(post.ref)?.leftOut ?? false,
    alts: picks.get(post.ref)?.alts ?? [],
  }));
  return { lines, pages };
}

/** The ref a line names, read loosely, for the first line of a page, whose place the intake checked. */
function readFirstRef(text: string | null): number | null {
  if (text === null) return null;
  try {
    const ref = (JSON.parse(text) as { ref?: unknown }).ref;
    return typeof ref === "number" && Number.isInteger(ref) && ref >= 0 && ref < IMPORT_RULES.maxPosts ? ref : null;
  } catch {
    return null;
  }
}

/**
 * The offered line `ref`, found from the pages' offsets: the last page whose first line's ref is at most `ref` (a binary
 * search, each step one bounded read), then the line `ref - base` lines further on. Null when no offered line has it.
 */
async function offeredLine(deps: ImportDeps, ownerId: string, ready: Ready, ref: number): Promise<ImportedPost | null> {
  const { row, scan } = ready;
  if (ref < scan.fromRef || scan.pages.length === 0) return null;
  const latest = latestDate(row.createdAt);
  const handle = await openPosts(deps, row.id);
  try {
    const firstRef = async (page: number) => readFirstRef(await readLineAt(handle, scan.pages[page]!, SAMPLE_MAX_BYTES));
    let low = 0;
    let high = scan.pages.length - 1;
    let base: number | null = null;
    let at = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const first = await firstRef(middle);
      if (first === null) return null;
      if (first <= ref) {
        base = first;
        at = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (base === null) return null;
    let index = base;
    for await (const line of readLines(handle, { from: scan.pages[at]!, maxBytes: scan.pages[at + 1] ?? IMPORT_RULES.postsFileMaxBytes, maxLines: ref - base + 1 })) {
      if (index === ref) {
        const post = readableLine(line.text, index, latest);
        if (post === null) return null;
        const known = await deps.social.importedKeys(ownerId, [post.key]);
        return known.has(post.key) ? null : post;
      }
      index++;
    }
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * PUT /api/imports/:id/lines/:ref (9.2): leaves an offered line out or brings it back, and gives each of its images
 * that its source left without a description one of the person's (decision 20), saved at once in import_picks with the
 * line's month, marks and described images; counted in import-pick. A description for an image the source described,
 * or for an image a line does not have, is refused (invalid_request), and while images are off a line takes none.
 */
export async function pickLine(deps: ImportDeps, ownerId: string, id: string, ref: number, body: unknown): Promise<ImportPickView> {
  const parsed = ImportPickRequest.safeParse(body);
  if (!parsed.success) throw new ImportError("invalid_request");
  await enforceImportLimit(deps, "import-pick", ownerId);
  const ready = await readyImport(deps, ownerId, id);
  const post = await offeredLine(deps, ownerId, ready, ref);
  if (post === null) throw new ImportError("not_found");
  const { leftOut, alts } = parsed.data;
  const there = await present(deps, ready.row, post);
  for (const [position, alt] of alts.entries()) {
    if (alt === null) continue;
    if (!there[position] || post.media[position]!.alt !== null) throw new ImportError("invalid_request");
  }
  const described = post.media.filter((media, position) => there[position] && media.alt !== null).length;
  const kept = alts.some((alt) => alt !== null) ? alts : null;
  try {
    await deps.repo.upsertPick(id, { ref, leftOut, alts: kept, month: post.at.slice(0, 7), marks: marksOf(post), described });
  } catch (err) {
    // import_picks_guard: the import left ready meanwhile (a confirmation, a cancel, the expiry).
    if (pgError(err)?.code === "42501") throw new ImportError("wrong_state");
    throw err;
  }
  return { ref, leftOut, alts: kept ?? [], picks: pickCounts(await deps.repo.picks(id)) };
}

/** The image types the preview shows (9.2): the sniffed format decides, never the name. */
const SHOWN = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/**
 * GET /api/imports/:id/media/:file (9.2): one image of the preview, the owner's only, while the import is ready and brings
 * images, opened through openWorkFile within 20 MiB and sniffed as JPEG, PNG or WebP; anything else is not_found. The
 * caller streams it from the handle and closes it.
 */
export async function mediaFile(deps: ImportDeps, ownerId: string, id: string, file: string): Promise<{ handle: FileHandle; size: number; type: string }> {
  if (!isImportMediaFile(file)) throw new ImportError("not_found");
  const { row } = await readyImport(deps, ownerId, id);
  if (!row.images) throw new ImportError("not_found");
  const opened = await deps.files.openWork(deps.files.work.media(id, file), MEDIA_MAX_BYTES);
  if (!opened.ok) {
    if (opened.code !== "missing") deps.log.warn({ id, code: opened.code }, "import: an image of the preview was refused");
    throw new ImportError("not_found");
  }
  const { handle, size } = opened.file;
  const head = Buffer.alloc(SNIFF_BYTES);
  const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
  const sniffed = sniffImage(head.subarray(0, bytesRead));
  const type = sniffed.kind === "image" && sniffed.format in SHOWN ? SHOWN[sniffed.format as keyof typeof SHOWN] : null;
  if (type === null) {
    await handle.close();
    throw new ImportError("not_found");
  }
  return { handle, size, type };
}
