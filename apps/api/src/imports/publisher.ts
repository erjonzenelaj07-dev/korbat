import { IMPORT_RULES, ImportChoice, visibleLength, type ImportedPost } from "@korbat/contracts";
import { LINE_MAX_BYTES, POSTS_MAX_BYTES, readLines, type RawLine } from "@korbat/import-protocol";
import type { ImportBatchPost } from "../social";
import type { ImportDeps } from "./context";
import { endFiles } from "./flows/end";
import { latestDate, readableLine } from "./intake";
import { imageAlt, importImageId, importPostId, keptLine, shortenText } from "./plan";
import type { PublishingImport } from "./repo";
import { scanOf } from "./view";

/**
 * The publisher (3b design, sections 4.5 steps 3 and 4, 6.5 and 7.5 step 5): for an import in publishing, up to
 * `batches` batches of `posts` lines of posts.jsonl a round, oldest first, each one transaction of the social module's
 * batch writer judged by 3e's predicate. This module decides what a line becomes (plan.ts's rule, the cut of decision
 * 13, the derived ids, the kept images with their descriptions); the social module writes it. After each commit the
 * moderation module's automated step runs for every new post with images, as for a native post. At the end of
 * posts.jsonl the import is done, its seed cleared, and the work folder is asked for.
 *
 * Where a line starts: the preview's pages were cut at the confirmation (decision 25), so the publisher keeps, beside the
 * feeder's plans, a per-process map from an import to the byte offset its post_cursor stands at. It is used only while its
 * cursor is the row's; after a restart, or when the row moved without this process, the offset is found again by one read
 * of the file from its start, past post_cursor lines.
 */

/** Where an import's next line starts, as this process last left it. */
export interface PublishOffset {
  cursor: number;
  offset: number;
}

/** The batch sizes of a round; tests give smaller ones. */
export interface PublishSizes {
  posts: number;
  batches: number;
}

/** What one import's round did: posts written, whether it is done, and whether its author's suspension made it wait. */
export interface PublishRound {
  posts: number;
  done: boolean;
  paused: boolean;
}

/** The byte offset at which line `cursor` starts, read from the start of the file: one read, after a restart. */
async function offsetAt(lines: AsyncIterable<RawLine>, cursor: number): Promise<number | null> {
  if (cursor === 0) return 0;
  let seen = 0;
  for await (const line of lines) {
    seen++;
    if (seen === cursor) return line.next;
  }
  return null;
}

/** What a kept line becomes: its body (cut when the choice shortens a long post), its images, and its parent's derived id. */
function postOf(job: PublishingImport, post: ImportedPost, choice: ImportChoice, pick: Parameters<typeof imageAlt>[1], kept: ReadonlySet<string>): ImportBatchPost | null {
  // A long line is kept only when the choice shortens it (keptLine); the cut leaves a text within the limit as it is.
  const { body, shortened } = choice.long === "shorten" ? shortenText(post.text) : { body: post.text, shortened: false };
  const images: { id: string; alt: string }[] = [];
  for (const [position, media] of post.media.entries()) {
    const id = importImageId(job.seed, post.ref, position);
    const alt = imageAlt(media, pick, position);
    // Only an image the preparation kept (ready, its check clear) and that has a description is attached (decision 20).
    if (kept.has(id) && alt !== null) images.push({ id, alt });
  }
  // A line whose cut text and kept images leave nothing visible is skipped (6.5).
  if (visibleLength(body) < 1 && images.length === 0) return null;
  return {
    id: importPostId(job.seed, post.ref),
    // A line of the account's own thread answers its parent, by its derived id; a reply to someone else is a post of its own.
    parentId: post.kind === "thread" && post.parent !== null ? importPostId(job.seed, post.parent) : null,
    body,
    originalCreatedAt: post.at,
    shortened,
    key: post.key,
    images,
  };
}

/** One import's round at `now`. A refusal of the predicate (account_suspended) rolls the batch back and the import waits. */
export async function publishRound(deps: ImportDeps, job: PublishingImport, now: Date, sizes: PublishSizes): Promise<PublishRound> {
  const round: PublishRound = { posts: 0, done: false, paused: false };
  const scan = scanOf(job);
  const choice = ImportChoice.safeParse(job.choice);
  if (scan === null || !choice.success) {
    deps.log.error({ id: job.id, phase: "publishing" }, "import: a publishing import's scan or choice does not parse");
    return round;
  }
  const picks = new Map((await deps.repo.picks(job.id)).map((pick) => [pick.ref, pick]));
  // The images the preparation kept, which stay on no post until their line's batch attaches them.
  const kept = new Set((await deps.media.importRows(job.id)).filter((row) => row.status === "ready" && row.check === "clear").map((row) => row.id));
  const opened = await deps.files.openWork(deps.files.work.posts(job.id), POSTS_MAX_BYTES);
  if (!opened.ok) {
    deps.log.error({ id: job.id, phase: "publishing", code: opened.code }, "import: posts.jsonl was refused while publishing; the import waits for its time limit");
    return round;
  }
  const latest = latestDate(job.createdAt);
  let cursor = job.postCursor;
  try {
    const known = deps.offsets.get(job.id);
    let offset = known?.cursor === cursor ? known.offset : await offsetAt(readLines(opened.file.handle, { maxBytes: POSTS_MAX_BYTES, lineMaxBytes: LINE_MAX_BYTES }), cursor);
    if (offset === null) {
      deps.log.error({ id: job.id, phase: "publishing" }, "import: posts.jsonl is shorter than the import's cursor");
      return round;
    }
    for (let batch = 0; batch < sizes.batches; batch++) {
      const lines: RawLine[] = [];
      for await (const line of readLines(opened.file.handle, { from: offset, maxLines: sizes.posts, maxBytes: POSTS_MAX_BYTES, lineMaxBytes: LINE_MAX_BYTES })) lines.push(line);
      if (lines.length === 0) {
        // The end of posts.jsonl: done, the seed cleared, and the work folder asked for (4.5 step 4).
        if (await deps.repo.toDone(job.id, cursor)) {
          round.done = true;
          deps.offsets.delete(job.id);
          await endFiles(deps, job.id);
          deps.log.info({ id: job.id, phase: "done", posts: round.posts }, "import: published");
        }
        return round;
      }
      const readable = lines.map((line, place) => readableLine(line.text, cursor + place, latest));
      const keys = readable.flatMap((post) => (post === null ? [] : [post.key]));
      // The keys the account's posts carry now, asked again for each batch (decision 24).
      const knownKeys = await deps.social.importedKeys(job.ownerId, keys);
      const posts: ImportBatchPost[] = [];
      for (const post of readable) {
        if (post === null) continue;
        if (!keptLine(post, { fromRef: scan.fromRef, choice: choice.data, picks, known: knownKeys }).kept) continue;
        const made = postOf(job, post, choice.data, picks.get(post.ref), kept);
        if (made !== null) posts.push(made);
      }
      let result: Awaited<ReturnType<ImportDeps["social"]["publishImportedBatch"]>>;
      try {
        // Each batch's posts are dated from its own millisecond on, after the batches before it in the round.
        result = await deps.social.publishImportedBatch(
          { id: job.id, ownerId: job.ownerId, source: job.source, cursor },
          { lines: lines.length, posts },
          new Date(now.getTime() + batch * sizes.posts),
        );
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === "account_suspended") {
          round.paused = true;
          deps.log.info({ id: job.id, phase: "publishing" }, "import: the author is suspended; the import waits");
          return round;
        }
        throw err;
      }
      if (!result.written) return round;
      cursor += lines.length;
      offset = lines.at(-1)!.next;
      deps.offsets.set(job.id, { cursor, offset });
      round.posts += result.posts.length;
      // After the commit, as for a native post: the automated step of each new post with images starts, unwaited for.
      for (const post of result.posts) {
        if (!post.images) continue;
        try {
          deps.moderation.imagesPublished(post.id);
        } catch (err) {
          deps.log.error({ err, postId: post.id }, "import: the automated step of a post's images was not started; the sweep takes them");
        }
      }
      // A batch shorter than asked ended the file: the next read finds nothing, and the import is done then.
      if (lines.length < sizes.posts && (await deps.repo.toDone(job.id, cursor))) {
        round.done = true;
        deps.offsets.delete(job.id);
        await endFiles(deps, job.id);
        deps.log.info({ id: job.id, phase: "done", posts: round.posts }, "import: published");
        return round;
      }
    }
    return round;
  } finally {
    await opened.file.handle.close();
  }
}

/** The default sizes of 7.5 step 5. */
export const PUBLISH_SIZES: PublishSizes = { posts: IMPORT_RULES.batchPosts, batches: IMPORT_RULES.publishBatchesPerRound };
