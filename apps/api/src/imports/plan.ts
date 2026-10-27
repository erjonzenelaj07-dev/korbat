import { createHash } from "node:crypto";
import { IMPORT_MARKS, IMPORT_RULES, MEDIA_MAX_BYTES, type ImportChoice, type ImportScanFacts, type ImportedPost } from "@korbat/contracts";
import { LINE_MAX_BYTES, POSTS_MAX_BYTES, POSTS_MAX_LINES, parsePostLine, readLineAt, readLines, type WorkFileRefusal } from "@korbat/import-protocol";
import type { ImportFiles } from "./files";
import { latestDate, marksOf, readableLine } from "./intake";
import type { PickRow } from "./repo";

/**
 * What a confirmed import publishes and prepares (3b design, sections 4.5, 6.5 and 7.4), in one place each: the derived
 * ids of its posts and images, the rule that keeps a line, the totals a choice holds, and the plan of the images the feeder
 * hands to the media pipeline. Task 5's feeder and confirmation use them; Task 6's publisher uses the same rule, ids and
 * plan, so a post and its images agree on what was chosen. Nothing here writes, and nothing of a line's text is kept but
 * the first words of a refused image's post, which the refusal stores (8.2).
 */

/**
 * 6.5's uuidFrom: the first 16 bytes of a digest as a UUID of version 4, its version and variant bits set and written in
 * lowercase hex, so isMediaId and every uuid column take it. Without the seed nobody can predict one.
 */
export function uuidFrom(digest: Uint8Array): string {
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A post's id: uuidFrom(SHA-256(seed || "post:" || ref)). A parent's id is computed, never looked up. */
export const importPostId = (seed: Uint8Array, ref: number): string => uuidFrom(createHash("sha256").update(seed).update(`post:${ref}`).digest());

/** An image's id: uuidFrom(SHA-256(seed || "image:" || ref || ":" || position)), its position in the line's media. */
export const importImageId = (seed: Uint8Array, ref: number, position: number): string => uuidFrom(createHash("sha256").update(seed).update(`image:${ref}:${position}`).digest());

const bit = (mark: (typeof IMPORT_MARKS)[number]): number => 1 << IMPORT_MARKS.indexOf(mark);

/** Whether a choice keeps a line of these marks (IMPORT_MARKS' bits): replies, long posts, warnings and protected posts each as chosen. */
export function marksPass(marks: number, choice: ImportChoice): boolean {
  if (marks & bit("reply") && !choice.replies) return false;
  if (marks & bit("long") && choice.long !== "shorten") return false;
  if (marks & bit("warning") && !choice.warnings) return false;
  if (marks & bit("protected") && !choice.protected) return false;
  return true;
}

/** Whether a month (YYYY-MM) is within the choice's range, either end open when null. */
export const monthInChoice = (month: string, choice: Pick<ImportChoice, "from" | "to">): boolean =>
  (choice.from === null || month >= choice.from) && (choice.to === null || month <= choice.to);

/** Why a line is not published: before the lowest ref a new account may publish, already imported, or the choice's. */
export type LineVerdict = { kept: true } | { kept: false; reason: "new_account_cap" | "already_imported" | "month" | "marks" | "left_out" };

/** What a line is judged by once the import is confirmed. */
export interface KeptLineRule {
  /** scan.fromRef: the lowest ref that may be published (decision 21). */
  fromRef: number;
  choice: ImportChoice;
  /** The person's picks, by ref (4.4). */
  picks: ReadonlyMap<number, PickRow>;
  /** The keys the account's posts carry now, asked again after the intake (7.5 step 2). */
  known: ReadonlySet<string>;
}

/**
 * The rule that keeps a line (6.5): its ref is at least fromRef, the account carries no post of its key, its month is
 * within the choice's range, its marks pass the choice, and its pick does not leave it out. The line must be one the
 * intake's rule reads (readableLine) for this to be asked.
 */
export function keptLine(post: Pick<ImportedPost, "ref" | "key" | "at" | "kind" | "text" | "warning" | "protected">, rule: KeptLineRule): LineVerdict {
  if (post.ref < rule.fromRef) return { kept: false, reason: "new_account_cap" };
  if (rule.known.has(post.key)) return { kept: false, reason: "already_imported" };
  if (!monthInChoice(post.at.slice(0, 7), rule.choice)) return { kept: false, reason: "month" };
  if (!marksPass(marksOf(post), rule.choice)) return { kept: false, reason: "marks" };
  if (rule.picks.get(post.ref)?.leftOut) return { kept: false, reason: "left_out" };
  return { kept: true };
}

/**
 * The description an image is attached with (decision 20): its source's, or the one the person wrote in the preview
 * (`alts[i]` is media[i]'s); null when it has neither, and then it is neither fed nor attached (no_description).
 */
export function imageAlt(media: ImportedPost["media"][number], pick: PickRow | undefined, position: number): string | null {
  return media.alt ?? pick?.alts?.[position] ?? null;
}

/**
 * The posts and images a choice holds (the orchestrator's ruling for Task 5), counted as the app counts them under the
 * choice (4.4): from the scan's month table, whose groups are [marks, posts, images, images without a source's
 * description] of the offered lines, and the picks' facts ([posts left out, their described images, descriptions given in
 * posts not left out], 9.3), over the months and marks the choice keeps. Images count only while the import and the
 * choice both bring them.
 */
export function chosenTotals(scan: Pick<ImportScanFacts, "months">, picks: readonly PickRow[], choice: ImportChoice, images: boolean): { posts: number; images: number } {
  let posts = 0;
  let kept = 0;
  for (const { month, groups } of scan.months) {
    if (!monthInChoice(month, choice)) continue;
    for (const [marks, count, withImages, undescribed] of groups) {
      if (!marksPass(marks, choice)) continue;
      posts += count;
      kept += withImages - undescribed;
    }
  }
  for (const pick of picks) {
    if (!monthInChoice(pick.month, choice) || !marksPass(pick.marks, choice)) continue;
    if (pick.leftOut) {
      posts -= 1;
      kept -= pick.described;
    } else {
      kept += (pick.alts ?? []).filter((alt) => alt !== null).length;
    }
  }
  return { posts: Math.max(0, posts), images: images ? Math.max(0, kept) : 0 };
}

/** One image the feeder hands to the media pipeline: the line, its place among the line's media, the file and its description. */
export interface PlannedImage {
  ref: number;
  position: number;
  file: string;
  alt: string;
  /** The line's byte offset in posts.jsonl, from which a refusal reads the post's day and first words (8.2). */
  offset: number;
}

/** The images of a confirmed import in feeding order: oldest line first, then by position. image_cursor counts into it. */
export interface ImportPlan {
  images: PlannedImage[];
}

export interface PlanInput {
  id: string;
  files: Pick<ImportFiles, "openWork" | "work">;
  /** When the import was created, from which the latest date a line may carry counts (5.4). */
  createdAt: Date;
  fromRef: number;
  choice: ImportChoice;
  picks: readonly PickRow[];
  /** The import brings images (import_jobs.images) and the choice does too. */
  images: boolean;
  /** The social module's read of the keys the account's posts carry, at most a thousand a call. */
  known: (keys: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Tests only: the newest-first cap, as the intake's caps. */
  maxImages?: number;
}

/** A line with images, as the plan reads it the first time. */
interface MediaLine {
  post: ImportedPost;
  offset: number;
}

/**
 * The plan (7.4), built once a process for each import that prepares, since the preview's pages were cut at the
 * confirmation: posts.jsonl is read once through openWorkFile by the intake's own rule, the keys of its lines with images
 * are asked again, and the images kept are chosen exactly as the intake counted them, the newest lines first up to
 * IMPORT_RULES.maxImages, each line's present files in order (a file openWorkFile refuses was counted missing_file then,
 * and is skipped here) and only as long as the cap has room, so no more than the cap's files are opened. A kept line's
 * images with a description are planned, in ref and position order. At most maxImages entries are held, a few hundred
 * kilobytes; reading a posts.jsonl of 1 GiB takes the intake's time, once.
 */
export async function buildPlan(input: PlanInput): Promise<{ ok: true; plan: ImportPlan } | { ok: false; code: WorkFileRefusal | "invalid" }> {
  if (!input.images) return { ok: true, plan: { images: [] } };
  const { files, id } = input;
  const opened = await files.openWork(files.work.posts(id), POSTS_MAX_BYTES);
  if (!opened.ok) return { ok: false, code: opened.code };
  const latest = latestDate(input.createdAt);
  const lines: MediaLine[] = [];
  try {
    let index = 0;
    for await (const line of readLines(opened.file.handle, { maxLines: POSTS_MAX_LINES, maxBytes: POSTS_MAX_BYTES, lineMaxBytes: LINE_MAX_BYTES })) {
      const post = readableLine(line.text, index++, latest);
      if (post !== null && post.ref >= input.fromRef && post.media.length > 0) lines.push({ post, offset: line.offset });
    }
  } catch {
    return { ok: false, code: "error" };
  } finally {
    await opened.file.handle.close();
  }

  const known = new Set<string>();
  for (let from = 0; from < lines.length; from += IMPORT_RULES.keyBatch) {
    for (const key of await input.known(lines.slice(from, from + IMPORT_RULES.keyBatch).map(({ post }) => post.key))) known.add(key);
  }
  const picks = new Map(input.picks.map((pick) => [pick.ref, pick]));
  const rule: KeptLineRule = { fromRef: input.fromRef, choice: input.choice, picks, known };
  const cap = input.maxImages ?? IMPORT_RULES.maxImages;

  const planned: PlannedImage[] = [];
  let counted = 0;
  // Newest first, as the intake capped them: an offered line's present images count against the cap whatever the choice.
  for (let i = lines.length - 1; i >= 0 && counted < cap; i--) {
    const { post, offset } = lines[i]!;
    if (known.has(post.key)) continue;
    const present: number[] = [];
    for (const [position, media] of post.media.entries()) {
      if (counted + present.length >= cap) break;
      const image = await files.openWork(files.work.media(id, media.file), MEDIA_MAX_BYTES);
      if (!image.ok) continue;
      await image.file.handle.close();
      present.push(position);
    }
    counted += present.length;
    if (!keptLine(post, rule).kept) continue;
    for (const position of present) {
      const alt = imageAlt(post.media[position]!, picks.get(post.ref), position);
      if (alt !== null) planned.push({ ref: post.ref, position, file: post.media[position]!.file, alt, offset });
    }
  }
  planned.sort((a, b) => a.ref - b.ref || a.position - b.position);
  return { ok: true, plan: { images: planned } };
}

/**
 * A refused image's post, as the import's row keeps it (8.2): its archive's day and its first words, at most
 * IMPORT_RULES.refusedWordsMax code points, cut at the last space within them when the text is longer, its line breaks
 * read as spaces. Read from the work line before the work folder goes; null when the line cannot be read again.
 */
export async function refusedPost(files: Pick<ImportFiles, "openWork" | "work">, id: string, image: Pick<PlannedImage, "ref" | "offset">): Promise<{ day: string; words: string } | null> {
  const opened = await files.openWork(files.work.posts(id), POSTS_MAX_BYTES);
  if (!opened.ok) return null;
  try {
    const text = await readLineAt(opened.file.handle, image.offset, LINE_MAX_BYTES);
    const post = text === null ? null : parsePostLine(text);
    if (post === null || post.ref !== image.ref) return null;
    return { day: post.at.slice(0, 10), words: firstWords(post.text) };
  } finally {
    await opened.file.handle.close();
  }
}

/** The ellipsis a shortened post ends with (decision 13), built without an escape. */
export const ELLIPSIS = String.fromCharCode(0x2026);

/**
 * Decision 13's cut, for a post the choice shortens: a text over IMPORT_RULES.shortenTo code points is cut at the last
 * space or line break within its first shortenTo - 1 code points (at shortenTo - 1 when there is none), its trailing
 * space dropped, and the ellipsis added, so the body is at most shortenTo code points, as posts_body_len holds it. A text
 * within the limit is kept as it is. Code points, as postLength and the CHECK count them.
 */
export function shortenText(text: string): { body: string; shortened: boolean } {
  const points = Array.from(text);
  if (points.length <= IMPORT_RULES.shortenTo) return { body: text, shortened: false };
  const head = points.slice(0, IMPORT_RULES.shortenTo - 1);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf(String.fromCharCode(10)));
  const cut = (space > 0 ? head.slice(0, space) : head).join("").trimEnd();
  return { body: cut + ELLIPSIS, shortened: true };
}

/** A run of spaces, tabs and line breaks (an imported text holds no other control character, 5.3), built without escapes. */
const SPACES = new RegExp(`[ ${String.fromCharCode(9, 10, 13)}]+`, "g");

/** The first words of a text, at most IMPORT_RULES.refusedWordsMax code points, cut at a space where it is longer. */
export function firstWords(text: string): string {
  const points = Array.from(text.replace(SPACES, " ").trim());
  if (points.length <= IMPORT_RULES.refusedWordsMax) return points.join("");
  const head = points.slice(0, IMPORT_RULES.refusedWordsMax);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head).join("").trim();
}
