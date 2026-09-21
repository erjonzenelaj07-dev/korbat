import { useCallback, useEffect, useRef, useState } from "react";
import { ALT_MAX_LENGTH, MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_PER_POST, altLength, normalizeAltText, type MediaFailure } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";

export interface ComposerImage {
  /** Stable for the life of the row; the upload id only exists once the server answered. */
  key: string;
  /** A blob: URL of the chosen file, so the preview shows at once and nothing has to be downloaded. */
  previewUrl: string;
  alt: string;
  status: "uploading" | "processing" | "ready" | "failed";
  id: string | null;
  error: string | null;
}

const FAILURES: Record<MediaFailure, string> = {
  unsupported_format: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  animated_not_supported: "Animated images are not supported yet. Use a still image.",
  image_too_large: "That image has too many pixels. Make it smaller and try again.",
  corrupt_image: "That file could not be read as an image.",
  processing_failed: "We could not process that image. Try again.",
};

const POLL_MS = 1000;
/** A little longer than the server waits before it fails an upload itself. */
const GIVE_UP_MS = 6 * 60_000;

/**
 * Why a file is refused before it is sent, or null when it may go. The server checks again. Browsers on
 * Windows often report no type at all for a .heic file, so its name is checked too: an iPhone photo
 * should get the advice that helps, not the generic refusal.
 */
export function refusal(file: { name: string; type: string; size: number }): string | null {
  if (file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name)) return "HEIC photos are not supported. Export the photo as JPEG and try again.";
  if (!(MEDIA_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return FAILURES.unsupported_format;
  if (file.size > MEDIA_MAX_BYTES) return "Images can be at most 20 MB.";
  return null;
}

/** What still stands between these images and posting them. */
export function describeState(images: ComposerImage[]): { waiting: boolean; failed: boolean; undescribed: boolean } {
  return {
    waiting: images.some((image) => image.status === "uploading" || image.status === "processing"),
    failed: images.some((image) => image.status === "failed"),
    undescribed: images.some((image) => {
      const length = altLength(normalizeAltText(image.alt));
      return length < 1 || length > ALT_MAX_LENGTH;
    }),
  };
}

/**
 * The images of one composer: uploads each chosen file, follows its processing, and keeps the
 * descriptions. Removing an image also removes the upload on the server. Blob URLs are released
 * when an image goes and when the composer closes.
 */
export function useImageUploads() {
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** The same list as `images`, readable by callbacks without waiting for a render. */
  const list = useRef<ComposerImage[]>([]);
  const closed = useRef(false);

  const commit = useCallback((next: ComposerImage[]) => {
    list.current = next;
    setImages(next);
  }, []);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<ComposerImage>) => commit(list.current.map((image) => (image.key === key ? { ...image, ...change } : image))),
    [commit],
  );
  const present = (key: string) => !closed.current && list.current.some((image) => image.key === key);

  const follow = useCallback(
    async (key: string, file: File) => {
      try {
        const sent = await social.uploadMedia(file);
        if (!present(key)) {
          await social.removeMedia(sent.id).catch(() => undefined);
          return;
        }
        patch(key, { id: sent.id, status: "processing" });
        const deadline = Date.now() + GIVE_UP_MS;
        while (present(key) && Date.now() < deadline) {
          const state = await social.mediaStatus(sent.id);
          if (!present(key)) return;
          if (state.status === "ready") return patch(key, { status: "ready" });
          if (state.status === "failed") return patch(key, { status: "failed", error: FAILURES[state.error] });
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        if (present(key)) patch(key, { status: "failed", error: FAILURES.processing_failed });
      } catch (err) {
        if (present(key)) patch(key, { status: "failed", error: errorMessage(err) });
      }
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = Math.max(0, MEDIA_MAX_PER_POST - list.current.length);
      let message: string | null = files.length > room ? `A post can have at most ${MEDIA_MAX_PER_POST} images.` : null;
      const added: ComposerImage[] = [];
      const started: [string, File][] = [];
      for (const file of files.slice(0, room)) {
        const why = refusal(file);
        if (why) {
          message = why;
          continue;
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        added.push({ key, previewUrl: URL.createObjectURL(file), alt: "", status: "uploading", id: null, error: null });
        started.push([key, file]);
      }
      setNotice(message);
      commit([...list.current, ...added]);
      for (const [key, file] of started) void follow(key, file);
    },
    [commit, follow],
  );

  const remove = useCallback(
    (key: string) => {
      const image = list.current.find((candidate) => candidate.key === key);
      if (!image) return;
      URL.revokeObjectURL(image.previewUrl);
      commit(list.current.filter((candidate) => candidate.key !== key));
      if (image.id) void social.removeMedia(image.id).catch(() => undefined);
    },
    [commit],
  );

  /** After posting: the uploads now belong to the post, so only the previews are released. */
  const clear = useCallback(() => {
    for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    commit([]);
    setNotice(null);
  }, [commit]);

  const setAlt = useCallback((key: string, alt: string) => patch(key, { alt }), [patch]);

  return { images, notice, add, remove, clear, setAlt };
}
