import type { MediaErrorCode } from "@korbat/contracts";

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
