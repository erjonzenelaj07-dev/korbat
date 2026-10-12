import type { MediaAttachment, MediaErrorCode, MediaView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MediaRepo } from "./repo";

/** The media codes plus the shared ones the module also raises. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request";
export type MediaErrorStatus = 400 | 404 | 409 | 413 | 415 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** What an iPhone calls a photo. The decoder cannot read it, so the message says what to do instead. */
export const HEIC_MESSAGE = "HEIC photos are not supported. Export the photo as JPEG and try again.";

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorKind,
    readonly status: MediaErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaErrorMessage(code: MediaErrorKind): string {
  return MESSAGES[code];
}

/**
 * An image of a post as this module hands it to the social module, with the image's own moderation state: the view
 * builder decides from the state and the viewer what a reader gets. A sealed image is its id and its state only (3c
 * design, section 7.10): nobody is given its size, its blurhash, its alt text or a path.
 */
export type PostImage = (Omit<MediaView, "moderation"> & { state: "visible" | "withheld" | "removed" }) | { id: string; state: "sealed" };

/**
 * What the social module needs from this one. `attach` and `detachAll` run inside the social
 * module's own transaction; `requestDeletion` runs after it committed, because files cannot be
 * rolled back. `detachAll` answers only the images that are really gone: a row a case holds, and every
 * row of a frozen post, stays, and no deletion may be requested for its files. `forPosts` never lists
 * an image of a deleted post or an erased image.
 */
export interface MediaForPosts {
  attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly MediaAttachment[] }): Promise<void>;
  detachAll(tx: DbTx, postId: string): Promise<string[]>;
  requestDeletion(ids: readonly string[]): Promise<void>;
  forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>>;
}

/** How many uploads one account may hold that are not on a post yet. */
export const MAX_PENDING_UPLOADS = 20;

export interface MediaDeps {
  repo: MediaRepo;
  files: MediaFiles;
  /** The formats MEDIA_FORMATS enables. The worker reads the same setting. */
  formats: readonly MediaFormat[];
  /** Uploads are refused while either volume has less free space than this. */
  minFreeBytes: number;
  /** See MEDIA_RECONCILE. `on` refuses to delete many orphans at once; `force` does not; `off` skips the pass. */
  reconcileMode: "on" | "off" | "force";
  /** Counts one upload against the account's hourly limit and throws when it is used up. */
  enforceUploadLimit: (userId: string, accountCreatedAt: Date, now: Date) => Promise<void>;
  log: Logger;
  now: () => Date;
}
