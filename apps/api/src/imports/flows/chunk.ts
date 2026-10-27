import { IMPORT_RULES, type ImportSource } from "@korbat/contracts";
import { enforceImportLimit, ImportError, type ImportDeps } from "../context";

/**
 * PUT /api/imports/:id/archive (3b design, section 7.3): one chunk of the archive, appended to archive.part at the
 * offset the import has stored. Every chunk is exactly IMPORT_RULES.chunkBytes but the last, which ends the archive.
 * The refusals, in this order: a malformed header (invalid_request), the account's 600 chunks an hour (rate_limited), an
 * import that is not the caller's or not uploading (not_found, wrong_state), an offset that is not the stored size
 * (wrong_offset, with the stored size, so the app learns where to go on), a length that breaks the rules or runs past the
 * declared size (chunk_too_large), free space under IMPORT_MIN_FREE_BYTES (imports_unavailable). A body that is short,
 * long or damaged leaves the file at the stored size (chunk_mismatch). The first chunk's first bytes must be the
 * declared source's: a zip's local header for X and Mastodon, a CAR's header for Bluesky; gzip's are a Mastodon archive
 * of before 4.2 (tar_gz), anything else not_an_archive, and either ends the upload as failed. The chunk that completes
 * the archive renames it, writes job.json and the queue marker, and moves the import to scanning.
 */

export interface ChunkRequest {
  /** Import-Offset: the byte at which the chunk starts, in decimal. */
  offset: string | undefined;
  /** Content-Length, which the chunk must carry. */
  length: string | undefined;
  /** Import-Chunk-Sha256: the chunk's SHA-256 as 64 lowercase hex. */
  sha256: string | undefined;
  body: ReadableStream<Uint8Array> | null;
}

/** As many first bytes as the checks below read. */
const HEAD_BYTES = 16;
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The unsigned varint at the start of `bytes` and its length, as a CAR's header begins; null when it does not end within 9 bytes. */
function varint(bytes: Uint8Array): [number, number] | null {
  let value = 0;
  for (let i = 0; i < bytes.length && i < 9; i++) {
    value += (bytes[i]! & 0x7f) * 2 ** (7 * i);
    if ((bytes[i]! & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/**
 * What an archive's first bytes say for its declared source (7.3): "ok", or the failure the upload ends with. The same
 * reading as the importer's (apps/importer/src/scan.ts and car/reader.ts), which an app cannot import: gzip's two bytes,
 * a zip's local header, a CAR's varint header length within the block cap followed by a CBOR map.
 */
export function firstBytesVerdict(source: ImportSource, head: Uint8Array): "ok" | "tar_gz" | "not_an_archive" {
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return "tar_gz";
  if (source === "bluesky") {
    const read = varint(head);
    if (read === null) return "not_an_archive";
    const [length, used] = read;
    return length > 0 && length <= IMPORT_RULES.carBlockMaxBytes && head.length > used && head[used]! >> 5 === 5 ? "ok" : "not_an_archive";
  }
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04 ? "ok" : "not_an_archive";
}

/** The first bytes refused: the upload ends as failed with this code. */
class FirstBytesRefused extends Error {
  constructor(readonly failure: "tar_gz" | "not_an_archive") {
    super(failure);
  }
}

/** The stored size the app goes on from, in wrong_offset's details. */
const wrongOffset = (receivedBytes: number) => new ImportError("wrong_offset", { details: { receivedBytes } });

export async function receiveChunk(deps: ImportDeps, ownerId: string, id: string, request: ChunkRequest): Promise<{ receivedBytes: number }> {
  if (!DECIMAL.test(request.offset ?? "") || !SHA256.test(request.sha256 ?? "")) throw new ImportError("invalid_request");
  const offset = Number(request.offset);
  const sha256 = request.sha256!;
  // Content-Length is required: a body without it could not be held to the chunk's rules before it is read.
  const length = DECIMAL.test(request.length ?? "") ? Number(request.length) : null;
  await enforceImportLimit(deps, "import-chunk", ownerId);

  const row = await deps.repo.find(id, ownerId);
  if (!row) throw new ImportError("not_found");
  if (row.status !== "uploading") throw new ImportError("wrong_state");
  // One chunk at a time: another one of this import is still on its way in.
  if (deps.inFlight.has(id)) throw wrongOffset(row.receivedBytes);
  deps.inFlight.add(id);
  try {
    const stored = await reconcile(deps, ownerId, row.id, row.receivedBytes, row.declaredBytes);
    if (offset !== stored) throw wrongOffset(stored);
    const end = stored + (length ?? 0);
    if (length === null || length < 1 || length > deps.chunkBytes || end > row.declaredBytes || (length !== deps.chunkBytes && end !== row.declaredBytes)) {
      throw new ImportError("chunk_too_large");
    }
    const free = await deps.files.freeBytes().catch(() => -1);
    if (free < deps.settings.minFreeBytes) {
      deps.log.error({ id, freeBytes: free }, "import: a chunk refused, free space on import-archives is under IMPORT_MIN_FREE_BYTES");
      throw new ImportError("imports_unavailable");
    }

    if (stored === 0) await deps.files.ensureJobDir(id);
    const accept =
      stored === 0
        ? (head: Buffer) => {
            const verdict = firstBytesVerdict(row.source, head);
            if (verdict !== "ok") throw new FirstBytesRefused(verdict);
          }
        : undefined;
    let written: "kept" | "mismatch";
    try {
      written = await deps.files.appendChunk(id, { at: stored, length, sha256, body: request.body, accept, headBytes: HEAD_BYTES });
    } catch (err) {
      if (err instanceof FirstBytesRefused) {
        await deps.repo.failUpload(id, ownerId, err.failure);
        await deps.files.removeArchive(id);
        deps.log.info({ id, phase: "failed", failure: err.failure }, "import: the first bytes are not an archive of the source");
        throw new ImportError("not_an_archive");
      }
      deps.log.error({ id, error: (err as NodeJS.ErrnoException).code ?? "write" }, "import: a chunk could not be written");
      throw new ImportError("imports_unavailable");
    }
    if (written === "mismatch") throw new ImportError("chunk_mismatch");

    if (end < row.declaredBytes) {
      // A move that lost to a cancel: the chunk on disk passed, and the cancel takes the folder with it.
      if (!(await deps.repo.setReceived(id, ownerId, stored, end))) throw new ImportError("wrong_state");
      return { receivedBytes: end };
    }

    // The last chunk: the archive is complete. The account's key goes into job.json, the importer's one secret (5.4).
    const accountKey = await deps.repo.accountKey(ownerId);
    if (accountKey === null) throw new Error("import: the account has an import but no import key");
    await deps.files.completeArchive(id, { v: 1, id, source: row.source, accountKey, images: row.images, createdAt: row.createdAt.toISOString() });
    if (!(await deps.repo.completeUpload(id, ownerId, stored))) {
      // A cancel came first: the importer must not scan what nobody waits for.
      await deps.files.removeArchive(id);
      await deps.files.requestWorkDeletion(id);
      throw new ImportError("wrong_state");
    }
    deps.log.info({ id, phase: "uploaded", bytes: row.declaredBytes }, "import: the archive is complete and queued");
    return { receivedBytes: row.declaredBytes };
  } finally {
    deps.inFlight.delete(id);
  }
}

/**
 * The file's own size is the truth (7.3): a row behind its file (the process stopped between a chunk's write and its
 * update) takes the file's size, but only up to whole chunks and never the last one, whose request also completes the
 * archive and must come again; the file is cut back to what the row then holds, so a chunk cut short by the stop is sent
 * again. A file shorter than the row has lost bytes nothing can bring back: the upload cannot go on, and expires.
 */
async function reconcile(deps: ImportDeps, ownerId: string, id: string, received: number, declared: number): Promise<number> {
  const size = await deps.files.partSize(id);
  if (size === received || (size === null && received === 0)) return received;
  if (size === null || size < received) {
    deps.log.error({ id, receivedBytes: received, fileBytes: size }, "import: archive.part holds less than its row counts");
    throw new ImportError("imports_unavailable");
  }
  const whole = Math.floor(size / deps.chunkBytes) * deps.chunkBytes;
  const lastStart = Math.floor((declared - 1) / deps.chunkBytes) * deps.chunkBytes;
  const taken = Math.max(received, Math.min(whole, lastStart));
  if (size > taken) await deps.files.truncatePart(id, taken);
  if (taken > received) {
    if (!(await deps.repo.setReceived(id, ownerId, received, taken))) throw new ImportError("wrong_state");
    deps.log.warn({ id, receivedBytes: received, takenBytes: taken }, "import: a row behind its file took the file's whole chunks");
  }
  return taken;
}
