import { z } from "zod";
import { FORBIDDEN_FORMAT } from "./text";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
// 3d Task 7 (design, sections 7.8 step 5 and 10.7): upload_refused, a post that attaches an upload korbat did not accept.
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable", "upload_refused"]);
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
 * 3d (design, sections 7.1, 9.6 and 10.2): a ready image on a post whose seal was lifted and whose files are not back in
 * the image store yet says `restoring`, and one whose files korbat recorded as lost says `lost`; at most one of the two.
 */
export const MediaStatusResponse = z
  .discriminatedUnion("status", [
    z.object({ id: MediaId, status: z.literal("processing") }),
    z.object({
      id: MediaId,
      status: z.literal("ready"),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      blurhash: z.string().min(6).optional(),
      restoring: z.literal(true).optional(),
      lost: z.literal(true).optional(),
    }),
    z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
    // 3d Task 7 (design, sections 7.8 step 5 and 10.2): an upload korbat refused on an acting match, with the refusal's id
    // for the link to its notice and nothing of the file: no blurhash, no sizes. An upload whose check is capped answers
    // processing, as any upload that is still being processed.
    z.object({ id: MediaId, status: z.literal("refused"), refusalId: z.uuid() }),
  ])
  .refine((answer) => !(answer.status === "ready" && answer.restoring && answer.lost), { message: "an image is either being restored or lost, never both" });
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

// ---------------------------------------------------------------- the edge (3d design, sections 2 rows 11 to 13, 7.4 and 10.1)

/**
 * The two numbers of a public image's Cache-Control header (3d Task 3), which the API builds the header from: a browser
 * keeps a copy at most `browserSeconds`, an edge at most `edgeSeconds`, and neither serves a stale one. They are the
 * bound korbat states for a hidden image's copy without an accepted purge, and every sentence that states it prints them
 * from here.
 */
export const EDGE_CACHE = {
  browserSeconds: 60,
  edgeSeconds: 300,
} as const;

/**
 * The outbox's job (7.4): at most `prefixes` images a request and one request a round, a round `roundSeconds` after the
 * last ended (so at most four a minute), each request bounded at `timeoutMs`; a failed row waits `backoffSeconds`, doubled
 * at each failure up to `backoffMaxSeconds`, and is given up `giveUpHours` after it was written; the retention job (Task 8)
 * deletes a row `keepDays` after it was done.
 */
export const EDGE_RULES = {
  prefixes: 30,
  roundSeconds: 15,
  timeoutMs: 5000,
  backoffSeconds: 30,
  backoffMaxSeconds: 3600,
  giveUpHours: 24,
  keepDays: 30,
} as const;

/** The numbers the words about the edge print, in the units they print them: the edge's bound in minutes and the hours of the give-up. */
export const EDGE_WORDS = {
  edgeMinutes: EDGE_CACHE.edgeSeconds / 60,
  giveUpHours: EDGE_RULES.giveUpHours,
} as const;

/** Why an image stopped being public: a state, the image's or its post's; a deletion or an erasure; a release (the CHECK of edge_purges.cause). */
export const EDGE_PURGE_CAUSES = ["state", "deleted", "released"] as const;
export type EdgePurgeCause = (typeof EDGE_PURGE_CAUSES)[number];

/** How an outbox row ended: the provider took the purge, it gave up, or no adapter was on (the CHECK of edge_purges.outcome). */
export const EDGE_PURGE_OUTCOMES = ["accepted", "failed", "off"] as const;
export type EdgePurgeOutcome = (typeof EDGE_PURGE_OUTCOMES)[number];

/**
 * One image's newest outbox row as staff read it (10.3), on a case and on an order's item: its outcome, or `pending` while
 * it has none, and its time (when it ended, or when it was written while it is pending). An image that never stopped
 * being public has no row and no entry.
 */
export const EdgePurgeView = z.strictObject({
  mediaId: z.uuid(),
  outcome: z.enum([...EDGE_PURGE_OUTCOMES, "pending"]),
  at: z.iso.datetime(),
});
export type EdgePurgeView = z.infer<typeof EdgePurgeView>;
