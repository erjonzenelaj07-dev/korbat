import type { MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/** Visible images of visible posts are cacheable by anyone for five minutes. Everything else depends on who asks and is never cached. */
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

/** The states in which a post or an image is still shown to someone: to everyone, or to its author alone. */
const isShown = (state: string): state is "visible" | "withheld" | "removed" => state === "visible" || state === "withheld" || state === "removed";

/**
 * Decides whether an image file may be sent. An image follows its post and its own moderation state
 * (3c design, section 7.10). When both are `visible` it is public, as 2a made it, so blocks are not
 * checked here. When either is `withheld` or `removed` it goes to its author only and is never cached.
 * Everything else is not found for everyone: an image without a post or not ready; a sealed image; an
 * image of a deleted post, whose row a case or a freeze may have kept; an image whose content, or whose
 * post's, was erased; and any state this reader has not been taught. Those are tested before the
 * author's branch, so a sealed image of a withheld or removed post is not found for its author too.
 */
export async function serve(deps: MediaDeps, request: ServeRequest): Promise<Served> {
  const access = await deps.repo.fileAccess(request.id);
  if (!access || access.status !== "ready" || !access.postState) return { kind: "not_found" };
  if (access.erased || !isShown(access.mediaState) || !isShown(access.postState)) return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.postState !== "visible" || access.mediaState !== "visible") {
    if ((await request.viewer()) !== access.authorId) return { kind: "not_found" };
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
