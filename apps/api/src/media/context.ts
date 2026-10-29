import type { AvatarView, MediaAttachment, MediaErrorCode, MediaView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MatchAdapter } from "./match-adapter";
import type { MatchRepo } from "./match-repo";
import type { MediaRepo } from "./repo";

/** The media codes plus the shared ones the module also raises; 3e's account_suspended is the social module's code, shared. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request" | "account_suspended";
export type MediaErrorStatus = 400 | 403 | 404 | 409 | 413 | 415 | 422 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  // 3d Task 7 (design, sections 9.5 and 9.7, [upload.refusedPost]): a post that attaches an upload korbat did not accept.
  upload_refused: "This image was not accepted, so the post was not sent. Remove the image to post. Its notice is under Settings, Cases.",
  // 2d Task 3 (design, section 9.4): PUT /api/me/avatar's two refusals of the upload it names.
  avatar_not_ready: "This picture is not ready to be your profile picture. Wait until it has uploaded, or choose another.",
  not_an_avatar: "This image was uploaded for a post. Choose the picture again as your profile picture.",
  // 2d Task 4 (design, sections 7.7 and 10.10): the words of AVATAR_WORDS.resetRecently, which say why.
  avatar_reset: "A moderator removed this picture from your profile less than 30 days ago, so it cannot be your profile picture again yet.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  // 3e (design, sections 7.2 and 9.8): an upload while the account's suspension runs, in the social module's words.
  account_suspended: "Your account is suspended, so you cannot do this now.",
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
 *
 * 2d Task 3 (design, sections 7.3 and 7.5): the avatar's writes run inside the social module's transaction as `attach`
 * does, so that only this module names the image table: `attachAvatar` (setAvatar's steps 2 to 4, which answers the
 * detached former avatar) and `detachAvatar` (removeAvatar's write); `dropFormerAvatar` is step 6, after the commit. And
 * `avatarsOf`, every view's avatars in one statement per page.
 */
export interface MediaForPosts {
  attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly MediaAttachment[] }): Promise<void>;
  detachAll(tx: DbTx, postId: string): Promise<string[]>;
  requestDeletion(ids: readonly string[]): Promise<void>;
  forPosts(postIds: readonly string[]): Promise<Map<string, PostImage[]>>;
  attachAvatar(tx: DbTx, accountId: string, mediaId: string): Promise<{ avatar: AvatarView; former: string | null }>;
  detachAvatar(tx: DbTx, accountId: string): Promise<string | null>;
  /** The former avatar's row and files, after the commit, unless something keeps the row; null asks for nothing. */
  dropFormerAvatar(id: string | null): Promise<void>;
  avatarsOf(profileIds: readonly string[], viewer: string | null): Promise<Map<string, AvatarView>>;
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
  /**
   * 3d Task 6 (design, sections 5 and 10.2): the scorer's model this server keeps a score from, as R1_CLASSIFIER names it:
   * the test scorer's name under `test`, null while it is off (no classifier is built in). finalize keeps a result's
   * score only from this model, so a score of another build, or one written while the setting differed, is never stored.
   */
  r1Model: string | null;
  /**
   * 3d Task 7 (design, sections 5 and 7.8): the comparison with known material, as MEDIA_MATCH chose it (off unless set),
   * and the statements on its three tables. While the adapter is off nothing is hashed or compared.
   */
  match: MatchAdapter;
  matches: MatchRepo;
  /**
   * The moderation module's handler of a stored refusal or of a match on a posted image (media.onMatch), which the wiring
   * hands over after the moderation module is built; null until then, and in tests that build none.
   */
  matched: { handler: MatchHandler | null };
}

/**
 * 3d Task 7 (design, section 5, media.onMatch): what the media module tells the moderation module after a commit: a
 * refusal it stored, for the uploader's notice and the urgent alert (the media module mails nobody); a match it stored for
 * an image on a post, the automated step's entry for a late match; and the first upload of an hour that matched over the
 * limit on refusals, for matcher_down at once. A call lost to a crash is found by the sweep or the dispatch round.
 */
export type MatchEvent = { kind: "refused"; refusalId: string } | { kind: "posted"; mediaId: string; matchId: string } | { kind: "capped" };
export type MatchHandler = (event: MatchEvent) => Promise<void>;
