import { randomUUID } from "node:crypto";
import { MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, type MediaAcceptedType, type UploadResponse } from "@korbat/contracts";
import { sniffImage, type MediaFormat } from "@korbat/media-protocol";
import { HEIC_MESSAGE, MAX_PENDING_UPLOADS, MediaError, type MediaDeps } from "../context";

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

/** Runs on the first bytes, before anything is written to disk. */
function checkFirstBytes(deps: MediaDeps, head: Uint8Array): void {
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
  // hashed and no row of media_hashes is written.
  const accept = (head: Uint8Array) => checkFirstBytes(deps, head);
  const hashes = deps.match.mode === "off" ? undefined : (await deps.files.receiveHashed(id, request.body, MEDIA_MAX_BYTES, accept)).hashes;
  if (hashes === undefined && deps.match.mode === "off") await deps.files.receive(id, request.body, MEDIA_MAX_BYTES, accept);
  try {
    await deps.repo.insertProcessing({ id, ownerId, now: deps.now(), hashes });
    await deps.files.commit(id);
  } catch (err) {
    await deps.repo.deleteRow(id).catch(() => undefined);
    await deps.files.discardUpload(id);
    throw err;
  }
  return { id, status: "processing" };
}
