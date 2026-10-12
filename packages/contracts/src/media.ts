import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

/** Why processing an upload failed. Reported on the status response, not as an HTTP error. */
export const MediaFailure = z.enum(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
export type MediaFailure = z.infer<typeof MediaFailure>;

/** 20 MiB. The API counts bytes while it streams an upload to disk and stops here. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PER_POST = 4;
/** The types an upload may declare. The bytes decide; the declaration is checked and then forgotten. */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export type MediaAcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];
export const ALT_MAX_LENGTH = 1000;

/** A media id in its canonical lowercase form, which is also how it names files on the media volumes. */
export const MediaId = z.uuid().transform((id) => id.toLowerCase());

export const MEDIA_SIZES = ["small", "large"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

/** Where an image file is served. Views carry these paths, so the server can move images without a client change. */
export function mediaPath(id: string, size: MediaSize): string {
  return `/api/media/${id}/${size}.webp`;
}

/** Length in code points, which is what Postgres char_length counts. */
export function altLength(alt: string): number {
  return Array.from(alt).length;
}

/** Unicode NFC, every run of whitespace (line breaks included) to one space, trimmed. The server and the composer use the same rule. */
export function normalizeAltText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const CONTROL = /\p{Cc}/u;

/** An image description as stored: normalized, 1 to 1000 code points, no control characters. */
export const AltText = z
  .string()
  .max(4000)
  .transform(normalizeAltText)
  .refine((alt) => !CONTROL.test(alt), { message: "control characters are not allowed" })
  .refine((alt) => !FORBIDDEN_FORMAT.test(alt), { message: "invisible direction and spacing characters are not allowed" })
  .refine((alt) => altLength(alt) >= 1, { message: "every image needs a description" })
  .refine((alt) => altLength(alt) <= ALT_MAX_LENGTH, { message: `descriptions have at most ${ALT_MAX_LENGTH} characters` });

/** One image of a new post: an upload that is ready, and its description. */
export const MediaAttachment = z.object({ id: MediaId, alt: AltText });
export type MediaAttachment = z.infer<typeof MediaAttachment>;

export const UploadResponse = z.object({ id: MediaId, status: z.literal("processing") });
export type UploadResponse = z.infer<typeof UploadResponse>;

/**
 * The state of one upload, for its owner. Width and height are those of the large size, after rotation. A ready image
 * carries its blurhash, except one that moderation sealed: it is shown to nobody, and the blurhash is made from the image.
 */
export const MediaStatusResponse = z.discriminatedUnion("status", [
  z.object({ id: MediaId, status: z.literal("processing") }),
  z.object({ id: MediaId, status: z.literal("ready"), width: z.number().int().positive(), height: z.number().int().positive(), blurhash: z.string().min(6).optional() }),
  z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
]);
export type MediaStatusResponse = z.infer<typeof MediaStatusResponse>;

/**
 * An image on a post, as a reader who is shown it gets it. `moderation` is set only on the author's own image that
 * moderation withheld or removed, with that state: the author keeps seeing such an image, and nobody else is shown it.
 */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
  moderation: z.enum(["withheld", "removed"]).optional(),
});
export type MediaView = z.infer<typeof MediaView>;

/**
 * What a reader gets in place of an image they are not shown: its id and the mark, never its size, its blurhash, its
 * description or a path. It is what anyone but the author gets for a withheld or removed image, the same for both states,
 * and what everyone gets for a sealed image, its author included: `sealed` is set only then, and only for the author.
 */
export const HiddenMedia = z.strictObject({ id: MediaId, hidden: z.literal(true), sealed: z.literal(true).optional() });
export type HiddenMedia = z.infer<typeof HiddenMedia>;

/** Whether an entry of a post's media list is a hidden image, which has nothing to draw or to open. */
export function isHiddenMedia(item: MediaView | HiddenMedia): item is HiddenMedia {
  return "hidden" in item;
}
