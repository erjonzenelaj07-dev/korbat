import { describe, expect, test } from "vitest";
import {
  ALT_MAX_LENGTH,
  AltText,
  HiddenMedia,
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_POST,
  MediaAttachment,
  MediaErrorCode,
  MediaFailure,
  MediaStatusResponse,
  MediaView,
  PostView,
  UploadResponse,
  altLength,
  isHiddenMedia,
  mediaPath,
  normalizeAltText,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("limits and codes", () => {
  test("the numbers the API and the composer share", () => {
    expect(MEDIA_MAX_BYTES).toBe(20_971_520);
    expect(MEDIA_MAX_PER_POST).toBe(4);
    expect(ALT_MAX_LENGTH).toBe(1000);
    expect([...MEDIA_ACCEPTED_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  });

  test("error codes and failure reasons", () => {
    expect(MediaErrorCode.options).toEqual(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
    expect(MediaFailure.options).toEqual(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
  });

  test("image paths end in .webp, which is what a CDN caches by default", () => {
    expect(mediaPath(id(7), "small")).toBe(`/api/media/${id(7)}/small.webp`);
    expect(mediaPath(id(7), "large")).toBe(`/api/media/${id(7)}/large.webp`);
  });
});

describe("alt text", () => {
  test("normalization: NFC, every run of whitespace to one space, trimmed", () => {
    expect(normalizeAltText("  a  red\tbarn\r\n\r\nat dusk ")).toBe("a red barn at dusk");
    expect(normalizeAltText("e\u0301")).toBe("\u00e9");
  });

  test("a description is required", () => {
    expect(AltText.safeParse("").success).toBe(false);
    expect(AltText.safeParse(" \n\t ").success).toBe(false);
    expect(AltText.parse(" a cat ")).toBe("a cat");
  });

  test("length is counted in code points after normalization", () => {
    const astral = "\u{1F600}";
    expect(altLength(astral.repeat(3))).toBe(3);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH)).success).toBe(true);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH + 1)).success).toBe(false);
    expect(AltText.safeParse(`${"a".repeat(ALT_MAX_LENGTH)}   `).success).toBe(true);
  });

  test("control characters are refused, including ones JavaScript does not count as whitespace", () => {
    expect(AltText.safeParse("a\u0000b").success).toBe(false);
    expect(AltText.safeParse("a\u0085b").success).toBe(false);
    expect(AltText.safeParse("a\u001bb").success).toBe(false);
  });

  test("media ids are canonical: any spelling of a UUID becomes its lowercase form", () => {
    expect(MediaAttachment.parse({ id: id(10).toUpperCase().replace("0000000A", "0000000a"), alt: "x" }).id).toBe(id(10));
    expect(MediaAttachment.parse({ id: "3F2A9C1E-8B7D-4E6F-A5C4-0123456789AB", alt: "x" }).id).toBe("3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab");
  });

  test("an attachment is an upload id and a description", () => {
    expect(MediaAttachment.parse({ id: id(1), alt: "  a   cat " })).toEqual({ id: id(1), alt: "a cat" });
    expect(MediaAttachment.safeParse({ id: "nope", alt: "a cat" }).success).toBe(false);
    expect(MediaAttachment.safeParse({ id: id(1) }).success).toBe(false);
  });
});

describe("upload and status responses", () => {
  test("an upload starts as processing", () => {
    expect(UploadResponse.parse({ id: id(1), status: "processing" })).toEqual({ id: id(1), status: "processing" });
    expect(UploadResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
  });

  test("each status carries exactly what it needs", () => {
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "processing" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
    // A sealed image is ready and shown to nobody: its status carries the size and no blurhash, which is made from the image.
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536 }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "short" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 0, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "animated_not_supported" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "because" }).success).toBe(false);
  });
});

describe("images on posts", () => {
  const image = { id: id(9), width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3", alt: "a cat", small: mediaPath(id(9), "small"), large: mediaPath(id(9), "large") };
  const post = {
    id: id(2),
    author: { id: id(1), handle: "ada", displayName: "Ada", verified: false },
    body: "",
    createdAt: "2026-09-18T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    quoteOf: null,
  };

  test("a media view has dimensions, a placeholder, a description and both paths", () => {
    expect(MediaView.parse(image)).toEqual(image);
    expect(MediaView.safeParse({ ...image, blurhash: "" }).success).toBe(false);
    expect(MediaView.safeParse({ ...image, large: undefined }).success).toBe(false);
  });

  test("every post view has a media list, and a post may consist of images only", () => {
    expect(PostView.parse({ ...post, media: [image] }).media).toEqual([image]);
    expect(PostView.parse({ ...post, body: "text", media: [] }).media).toEqual([]);
    expect(PostView.safeParse(post).success).toBe(false);
  });

  test("a quoted post carries its images too", () => {
    const quoted = { ...post, id: id(3), media: [image] };
    const parsed = PostView.parse({ ...post, body: "look", media: [], quoteOf: quoted });
    expect(parsed.quoteOf).toMatchObject({ media: [image] });
  });

  test("the author's own image that moderation withheld or removed carries that state, and no other", () => {
    expect(MediaView.parse({ ...image, moderation: "withheld" })).toEqual({ ...image, moderation: "withheld" });
    expect(MediaView.parse({ ...image, moderation: "removed" })).toEqual({ ...image, moderation: "removed" });
    // A sealed image is never a media view: nobody is given its size, its blurhash, its description or its paths.
    for (const state of ["sealed", "visible", "hidden"]) expect(MediaView.safeParse({ ...image, moderation: state }).success, state).toBe(false);
    expect("moderation" in MediaView.parse(image)).toBe(false);
  });

  test("a hidden image is its id and the mark, with `sealed` only as true, and carries nothing of the image", () => {
    expect(HiddenMedia.parse({ id: id(9), hidden: true })).toEqual({ id: id(9), hidden: true });
    expect(HiddenMedia.parse({ id: id(9), hidden: true, sealed: true })).toEqual({ id: id(9), hidden: true, sealed: true });
    expect(HiddenMedia.safeParse({ id: id(9) }).success).toBe(false);
    expect(HiddenMedia.safeParse({ id: id(9), hidden: false }).success).toBe(false);
    expect(HiddenMedia.safeParse({ id: id(9), hidden: true, sealed: false }).success).toBe(false);
    // No size, no blurhash, no description and no path: a placeholder that carries one is not one.
    for (const member of ["width", "height", "blurhash", "alt", "small", "large"] as const) {
      expect(HiddenMedia.safeParse({ id: id(9), hidden: true, [member]: image[member] }).success, member).toBe(false);
    }
    expect(Object.keys(HiddenMedia.shape).sort()).toEqual(["hidden", "id", "sealed"]);
  });

  test("a post's media list holds images and hidden images side by side, in their order, on the post and on a quoted post", () => {
    const hidden = { id: id(10), hidden: true as const };
    const sealed = { id: id(11), hidden: true as const, sealed: true as const };
    const own = { ...image, id: id(12), moderation: "removed" as const };
    const media = [image, hidden, own, sealed];
    const parsed = PostView.parse({ ...post, media, quoteOf: { ...post, id: id(3), media: [hidden, image] } });
    expect(parsed.media).toEqual(media);
    expect(parsed.quoteOf).toMatchObject({ media: [hidden, image] });
    expect(parsed.media.map(isHiddenMedia)).toEqual([false, true, false, true]);
    // Something that is neither is refused.
    expect(PostView.safeParse({ ...post, media: [{ id: id(10) }] }).success).toBe(false);
  });
});
