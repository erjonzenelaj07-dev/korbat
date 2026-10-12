import type { MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/** Images of visible posts are cacheable by anyone for five minutes. Everything else depends on who asks and is never cached. */
export const PUBLIC_CACHE = "public, max-age=300";
export const PRIVATE_CACHE = "private, no-store";

export type Served =
  | { kind: "file"; file: StoredFile; cacheControl: string; etag: string }
  | { kind: "not_modified"; cacheControl: string; etag: string }
  | { kind: "not_found" };

export interface ServeRequest {
  id: string;
  size: MediaSize;
  ifNoneMatch: string | undefined;
  /** Resolves the session. Only called when the answer depends on who asks, so public images cost one query. */
  viewer: () => Promise<string | null>;
}

/**
 * Decides whether an image file may be sent. An image follows its post: visible posts are public,
 * as 2a made them, so blocks are not checked here; withheld and removed posts show their images to
 * their author only; an image without a post, or not ready, does not exist for anyone. It also
 * follows its own moderation state, by a whitelist: only an image whose state is `visible` is sent.
 * A sealed image reaches nobody, its author included, and any other state is not found for everyone
 * until this reader is taught who may see it. The image's state is tested before the post's, so a
 * sealed image of a withheld or removed post is not found for its author too.
 */
export async function serve(deps: MediaDeps, request: ServeRequest): Promise<Served> {
  const access = await deps.repo.fileAccess(request.id);
  if (!access || access.status !== "ready" || !access.postState) return { kind: "not_found" };
  if (access.mediaState !== "visible") return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.postState !== "visible") {
    const moderated = access.postState === "withheld" || access.postState === "removed";
    if (!moderated || (await request.viewer()) !== access.authorId) return { kind: "not_found" };
    cacheControl = PRIVATE_CACHE;
  }

  // The files of an id never change, so the id and the size identify the bytes.
  const etag = `"${request.id}-${request.size}"`;
  if (request.ifNoneMatch?.split(",").some((candidate) => candidate.trim() === etag)) return { kind: "not_modified", cacheControl, etag };

  const file = await deps.files.openImage(request.id, request.size);
  if (!file) {
    deps.log.error({ id: request.id, size: request.size }, "media: a ready image has no usable file in the store");
    return { kind: "not_found" };
  }
  return { kind: "file", file, cacheControl, etag };
}
