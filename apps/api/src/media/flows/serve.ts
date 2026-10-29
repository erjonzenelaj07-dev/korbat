import { EDGE_CACHE, type MediaSize } from "@korbat/contracts";
import type { MediaDeps } from "../context";
import type { StoredFile } from "../files";

/**
 * Visible images of visible posts are cacheable by anyone, on the 200 and on the 304 (3d design, section 2 row 12 and
 * 7.4): a browser keeps a copy at most EDGE_CACHE.browserSeconds and an edge at most EDGE_CACHE.edgeSeconds, both
 * revalidate once it is stale, and an edge serves no stale copy when the API errs, so a hidden image's copy is bounded
 * by these two numbers even without an accepted purge. Everything else depends on who asks and is never cached: an
 * author's own hidden image is PRIVATE_CACHE, and every other answer of the API is no-store (security-headers.ts).
 */
export const PUBLIC_CACHE = `public, max-age=${EDGE_CACHE.browserSeconds}, s-maxage=${EDGE_CACHE.edgeSeconds}, must-revalidate, stale-if-error=0`;
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
  if (!access || access.status !== "ready") return { kind: "not_found" };

  let cacheControl = PUBLIC_CACHE;
  if (access.kind === "avatar") {
    // 2d Task 3 (design, sections 7.5 and 7.8; decision 29): an avatar is served, to anyone and under the public header,
    // exactly while it is a live profile's picture, visible and not erased; every other avatar row (an upload not set yet,
    // a replaced or removed one, one a hold keeps, one of a deleted account, a sealed one) is not found for everyone, its
    // owner included. 2d Task 4 (7.5, 7.6): a set picture R1's review withholds (withheld) goes to its owner alone, under
    // PRIVATE_CACHE, as an author's own hidden image; only that branch asks for the viewer, so a visible avatar costs one
    // query. A reset picture is detached (no profile), so it is not found for its owner either.
    if (access.profileId === null || access.profileDeleted || access.erased) return { kind: "not_found" };
    if (access.mediaState === "withheld") {
      if ((await request.viewer()) !== access.ownerId) return { kind: "not_found" };
      cacheControl = PRIVATE_CACHE;
    } else if (access.mediaState !== "visible") return { kind: "not_found" };
  } else {
    if (!access.postState) return { kind: "not_found" };
    if (access.erased || !isShown(access.mediaState) || !isShown(access.postState)) return { kind: "not_found" };
    if (access.postState !== "visible" || access.mediaState !== "visible") {
      if ((await request.viewer()) !== access.authorId) return { kind: "not_found" };
      cacheControl = PRIVATE_CACHE;
    }
  }

  // The files of an id never change, so the id and the size identify the bytes.
  const etag = `"${request.id}-${request.size}"`;
  if (request.ifNoneMatch?.split(",").some((candidate) => candidate.trim() === etag)) return { kind: "not_modified", cacheControl, etag };

  const file = await deps.files.openImage(request.id, request.size);
  if (!file) {
    // 3d (design, sections 6.1 and 7.1): a visible image whose seal was lifted has its files in the quarantine until they
    // are returned, or korbat recorded them as lost: the same 404, and an info line, since nothing is broken. Only an
    // image that is neither has lost its file unexpectedly.
    const custody = access.mediaState === "visible" ? await deps.repo.custody(request.id) : { quarantined: false, lost: false };
    if (custody.quarantined || custody.lost) {
      deps.log.info({ id: request.id, size: request.size, custody: custody.lost ? "lost" : "quarantine" }, "media: a visible image's files are not in the store: being restored, or lost");
    } else {
      deps.log.error({ id: request.id, size: request.size }, "media: a ready image has no usable file in the store");
    }
    return { kind: "not_found" };
  }
  return { kind: "file", file, cacheControl, etag };
}
