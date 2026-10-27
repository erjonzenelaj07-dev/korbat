import { IMPORT_IMAGE_SKIPS, IMPORT_RULES, ImportChoice, ImportScanFacts, type ImportImageSkip, type ImportView } from "@korbat/contracts";
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
  // 3b Task 5: the images left out by reason, as the job counts them (migration 0047), each a reason of the closed list.
  const imagesLeftOut: Partial<Record<ImportImageSkip, number>> = {};
  for (const reason of IMPORT_IMAGE_SKIPS) {
    const count = row.imagesLeftOutBy[reason];
    if (typeof count === "number" && count > 0) imagesLeftOut[reason] = count;
  }
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
    // 3b Task 6 (the orchestrator's ruling, migration 0048): the decision the admin's end rests on, for the screen's link.
    staffDecisionId: row.staffDecisionId,
    scan: scan === null ? null : (facts as ImportView["scan"]),
    samples: row.status === "ready" && scan !== null ? await samples(deps, row, scan) : [],
    choice: choice.success ? choice.data : null,
    picks,
    // 3b Task 5: the totals the confirmation counted and kept in the scan (the orchestrator's ruling). 3b Task 6 (the
    // orchestrator's ruling): the posts left are the chosen posts less those published, while the import publishes, and 0
    // in every other state (a line the batch finds already imported, or with nothing visible, is published by no one).
    progress: {
      imagesTotal: scan?.chosen?.images ?? 0,
      imagesSettled: row.imagesKept + row.imagesLeftOut,
      postsTotal: scan?.chosen?.posts ?? 0,
      postsPublished: row.postsPublished,
      postsRemoved: row.postsRemoved,
      postsLeft: row.status === "publishing" ? Math.max(0, (scan?.chosen?.posts ?? 0) - row.postsPublished) : 0,
      imagesLeftOut,
    },
    // 3b Task 6 (8.5): while the import prepares or publishes and its author's suspension runs, its writes wait; read as
    // the confirmation reads it, through the profile store.
    paused: (row.status === "preparing" || row.status === "publishing") && (await deps.profiles.suspended(row.ownerId)),
    // 8.2: the refusal of the image that stopped the import, read through the media module, for the link to its notice.
    refusalId: row.stopReason === "refused_image" ? await deps.media.refusalOf(row.id) : null,
    refusedAt: row.refusedAtOriginal,
    refusedWords: row.refusedWords,
    undoable: row.status === "done" || (row.status === "stopped" && row.postsPublished > 0),
  };
}
