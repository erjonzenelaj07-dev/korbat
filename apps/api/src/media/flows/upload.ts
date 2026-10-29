import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, type AvatarCrop, type MediaAcceptedType, type UploadResponse } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import { sniffImage, type MediaFormat } from "@korbat/media-protocol";
import { HEIC_MESSAGE, MAX_PENDING_UPLOADS, MediaError, type MediaDeps } from "../context";
import type { ReceivedHashes } from "../files";
import { ImportMovedOn } from "../repo";

const FORMAT_OF: Record<MediaAcceptedType, MediaFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export interface UploadRequest {
  contentType: string | undefined;
  contentLength: string | undefined;
  body: ReadableStream<Uint8Array> | null;
  /** 2d Task 3 (design, section 7.2): an avatar's upload, from the query's kind=avatar and its crop; absent for a post's. */
  avatar?: { crop: AvatarCrop };
}

/** `image/jpeg; charset=binary` to `image/jpeg`. */
const mediaType = (header: string | undefined): string => (header ?? "").split(";")[0]!.trim().toLowerCase();

/** The declared type is checked and then forgotten: nothing of it is stored, and the bytes decide what the file is. */
function checkDeclaredType(deps: MediaDeps, header: string | undefined): void {
  const type = mediaType(header);
  if (type === "image/heic" || type === "image/heif") throw new MediaError("unsupported_media_type", 415, HEIC_MESSAGE);
  const format = (MEDIA_ACCEPTED_TYPES as readonly string[]).includes(type) ? FORMAT_OF[type as MediaAcceptedType] : null;
  if (!format || !deps.formats.includes(format)) throw new MediaError("unsupported_media_type", 415);
}

/** Runs on the first bytes, before anything is written to disk. 3b Task 5: an imported image's too. */
export function checkFirstBytes(deps: MediaDeps, head: Uint8Array): void {
  const sniffed = sniffImage(head);
  if (sniffed.kind === "heic") throw new MediaError("unsupported_media_type", 415, HEIC_MESSAGE);
  if (sniffed.kind === "animated") throw new MediaError("unsupported_media_type", 415, "Animated images are not supported yet. Use a still image.");
  if (sniffed.kind !== "image" || !deps.formats.includes(sniffed.format)) throw new MediaError("unsupported_media_type", 415);
}

/**
 * Takes one image from its owner and hands it to the worker. Cheap refusals come first; the body
 * is only read once the account may upload. The row is written before the file becomes visible to
 * the worker, so the worker never processes an upload nobody owns.
 */
export async function upload(deps: MediaDeps, ownerId: string, request: UploadRequest): Promise<UploadResponse> {
  checkDeclaredType(deps, request.contentType);
  const declaredLength = Number(request.contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > MEDIA_MAX_BYTES) throw new MediaError("file_too_large", 413);

  const createdAt = await deps.repo.accountCreatedAt(ownerId);
  if (!createdAt) throw new MediaError("not_found", 404);
  await deps.enforceUploadLimit(ownerId, createdAt, deps.now());
  if ((await deps.repo.pendingCount(ownerId)) >= MAX_PENDING_UPLOADS) throw new MediaError("too_many_pending_uploads", 409);
  if ((await deps.files.freeBytes()) < deps.minFreeBytes) {
    deps.log.error({ minFreeBytes: deps.minFreeBytes }, "media: uploads refused, free space is under the floor");
    throw new MediaError("uploads_unavailable", 503);
  }

  const id = randomUUID();
  // 3d Task 7 (design, section 7.8 step 1): while the comparison with known material is on, the three hashes of the file
  // as received are taken while it streams, and stored with the image row in one transaction; while it is off, nothing is
  // hashed and no row of media_hashes is written. 2d Task 3 (7.2): an avatar's SHA-256 is taken always, one hash of at
  // most MEDIA_MAX_BYTES, and kept on its row as avatar_sha256.
  const accept = (head: Uint8Array) => checkFirstBytes(deps, head);
  const matching = deps.match.mode !== "off";
  let hashes: ReceivedHashes | undefined;
  let avatar: { sha256: string } | undefined;
  if (request.avatar !== undefined) {
    const received = await deps.files.receiveAvatar(id, request.body, MEDIA_MAX_BYTES, accept, matching);
    hashes = received.hashes ?? undefined;
    avatar = { sha256: received.sha256 };
  } else if (matching) {
    hashes = (await deps.files.receiveHashed(id, request.body, MEDIA_MAX_BYTES, accept)).hashes;
  } else {
    await deps.files.receive(id, request.body, MEDIA_MAX_BYTES, accept);
  }
  try {
    await deps.repo.insertProcessing({ id, ownerId, now: deps.now(), hashes, avatar });
    // An avatar's job file goes into incoming/ before the upload does (files.commit).
    await deps.files.commit(id, request.avatar === undefined ? undefined : { avatar: request.avatar.crop });
  } catch (err) {
    await deps.repo.deleteRow(id).catch(() => undefined);
    await deps.files.discardUpload(id);
    throw err;
  }
  return { id, status: "processing" };
}

/** 3b Task 5: what feeding one imported image came to (3b design, section 7.4 step 4). */
export type ImportedReceipt =
  /** The row is written and the file is in incoming/ for the worker; the import's cursor moved with the row. */
  | "fed"
  /** The first bytes are no still image of a format this site takes (the sniff of any upload), never retried. */
  | "unsupported"
  /** Over MEDIA_MAX_BYTES as its bytes arrived. */
  | "too_large"
  /** The import was no longer preparing at its cursor: nothing was written. */
  | "stopped"
  /** The owner's suspension runs, by the one predicate: nothing was written, and the import waits. */
  | "suspended"
  /** A row with this id exists already: the image was fed before (a plan that an earlier process built differently). */
  | "already";

/** Whether an error is the primary key of post_media refusing a second row of an id. */
function duplicateRow(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const found = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (typeof current === "object" && found.code === "23505") return found.constraint_name === "post_media_pkey" || found.constraint === "post_media_pkey";
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 3b Task 5 (design, sections 7.4 step 4 and 8.1): one imported image enters through this module's own receive path, as an
 * upload of its owner's: the bytes come from a work file the imports module opened through openWorkFile (the importer's
 * output is hostile, so nothing else of import-work is read), the first bytes are sniffed as any upload's, the bytes are
 * counted against MEDIA_MAX_BYTES as they arrive and hashed while the comparison is on, the row is written by
 * insertProcessing with the import (its claim moves the import's cursor in the same transaction), and the file is
 * committed to incoming/ for the unchanged worker. Neither the upload limits, nor the pending count, nor the route's
 * declared type apply: no route of the person's sent it (decision 21).
 */
export async function receiveImported(
  deps: MediaDeps,
  input: { id: string; ownerId: string; file: { handle: FileHandle; size: number }; now: Date; importJob: { id: string; claim: (tx: DbTx) => Promise<boolean> } },
): Promise<ImportedReceipt> {
  if (input.file.size > MEDIA_MAX_BYTES) return "too_large";
  // A part a crash left under this derived id is discarded first: receive opens tmp/<id>.part with "wx". A complete upload
  // in incoming/ is never touched here: a row of the id may own it.
  await deps.files.discardPart(input.id);
  let hashes: Awaited<ReturnType<typeof deps.files.receiveWorkFile>>["hashes"];
  try {
    hashes = (await deps.files.receiveWorkFile(input.id, input.file, MEDIA_MAX_BYTES, (head) => checkFirstBytes(deps, head), deps.match.mode !== "off")).hashes;
  } catch (err) {
    if (err instanceof MediaError && err.code === "unsupported_media_type") return "unsupported";
    if (err instanceof MediaError && err.code === "file_too_large") return "too_large";
    throw err;
  }
  try {
    await deps.repo.insertProcessing({ id: input.id, ownerId: input.ownerId, now: input.now, hashes: hashes ?? undefined, importJob: input.importJob });
  } catch (err) {
    await deps.files.discardPart(input.id);
    if (err instanceof ImportMovedOn) return "stopped";
    if (err instanceof MediaError && err.code === "account_suspended") return "suspended";
    if (duplicateRow(err)) return "already";
    throw err;
  }
  // The row is committed with the cursor; a rename that fails leaves a row the worker never answers, which the import
  // settles as not checked after IMPORT_RULES.checkHours (the orchestrator's ruling), as it settles any unanswered one.
  await deps.files.commit(input.id).catch((err: unknown) => deps.log.error({ id: input.id, code: (err as NodeJS.ErrnoException).code }, "media: an imported image could not be handed to the worker"));
  return "fed";
}
