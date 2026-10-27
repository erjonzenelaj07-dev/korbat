import { IMPORT_RULES, ImportChoice, ImportScanFacts, type ImportView } from "@korbat/contracts";
import { parsePostLine, readLineAt } from "@korbat/import-protocol";
import type { ImportDeps } from "./context";
import type { ImportRow, PickRow } from "./repo";

/**
 * An import as its owner sees it (3b design, section 9.3). It is built from the row and the import's picks alone: the
 * only file it opens is posts.jsonl, through openWorkFile, for the preview's three samples while the import is ready,
 * each from the byte offset the intake noted and at most 256 KiB (9.2). No text but the samples and the refused post's
 * first words, no file name, no source id.
 */

/** The picks' counts by month and marks (9.3): [marks, posts left out, described images left out, images given a description]. */
export function pickCounts(picks: readonly PickRow[]): ImportView["picks"] {
  const months = new Map<string, Map<number, [number, number, number]>>();
  for (const pick of picks) {
    const groups = months.get(pick.month) ?? new Map<number, [number, number, number]>();
    months.set(pick.month, groups);
    const group = groups.get(pick.marks) ?? [0, 0, 0];
    groups.set(pick.marks, group);
    if (pick.leftOut) {
      group[0] += 1;
      group[1] += pick.described;
    } else {
      group[2] += (pick.alts ?? []).filter((alt) => alt !== null).length;
    }
  }
  return [...months.keys()]
    .sort()
    .map((month) => ({
      month,
      groups: [...months.get(month)!.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, [out, described, given]]) => out + described + given > 0)
        .map(([marks, [out, described, given]]) => [marks, out, described, given] as [number, number, number, number]),
    }))
    .filter(({ groups }) => groups.length > 0);
}

/** The scan's facts as the drive stored them, or null for an import that has none (or one that does not parse). */
export function scanOf(row: Pick<ImportRow, "scan">): ImportScanFacts | null {
  if (row.scan === null || row.scan === undefined) return null;
  const parsed = ImportScanFacts.safeParse(row.scan);
  return parsed.success ? parsed.data : null;
}

/** The archive's day of a line, never its second. */
const dayOf = (at: string): string => at.slice(0, 10);

/** The three newest offered lines' days and texts, read through openWorkFile from their offsets; a line refused is passed over. */
async function samples(deps: ImportDeps, row: ImportRow, scan: ImportScanFacts): Promise<ImportView["samples"]> {
  if (scan.samples.length === 0) return [];
  const opened = await deps.files.openWork(deps.files.work.posts(row.id), IMPORT_RULES.postsFileMaxBytes);
  if (!opened.ok) {
    deps.log.warn({ id: row.id, code: opened.code }, "import: the samples' file was refused");
    return [];
  }
  const found: ImportView["samples"] = [];
  try {
    for (const sample of scan.samples) {
      const text = await readLineAt(opened.file.handle, sample.offset);
      const post = text === null ? null : parsePostLine(text);
      if (post !== null && post.ref === sample.ref) found.push({ at: dayOf(post.at), text: post.text });
    }
  } finally {
    await opened.file.handle.close();
  }
  return found;
}

export async function importView(deps: ImportDeps, row: ImportRow): Promise<ImportView> {
  const scan = scanOf(row);
  const choice = ImportChoice.safeParse(row.choice);
  // Picks exist from the preview until the import has ended; their counts are read while the choice can still use them.
  const picks = ["ready", "preparing", "publishing"].includes(row.status) ? pickCounts(await deps.repo.picks(row.id)) : [];
  const { samples: _samples, pages: _pages, ...facts } = scan ?? { samples: [], pages: [] };
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    declaredBytes: row.declaredBytes,
    receivedBytes: row.receivedBytes,
    chunkBytes: IMPORT_RULES.chunkBytes,
    failure: row.failure,
    stopReason: row.stopReason as ImportView["stopReason"],
    endedByStaff: row.staffRuleId,
    scan: scan === null ? null : (facts as ImportView["scan"]),
    samples: row.status === "ready" && scan !== null ? await samples(deps, row, scan) : [],
    choice: choice.success ? choice.data : null,
    picks,
    // Tasks 5 and 6 count the images and posts a confirmed choice holds; until then these are the row's own counts.
    progress: {
      imagesTotal: 0,
      imagesSettled: row.imagesKept + row.imagesLeftOut,
      postsTotal: 0,
      postsPublished: row.postsPublished,
      postsRemoved: row.postsRemoved,
      postsLeft: 0,
    },
    // Task 6 reads whether the author is suspended through the standing module (8.5).
    paused: false,
    // Task 5 names the refusal of a refused image (8.2).
    refusalId: null,
    refusedAt: row.refusedAtOriginal,
    refusedWords: row.refusedWords,
    undoable: row.status === "done" || (row.status === "stopped" && row.postsPublished > 0),
  };
}
