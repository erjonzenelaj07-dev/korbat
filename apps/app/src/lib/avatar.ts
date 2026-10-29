import type { AvatarCrop, AvatarView, MediaStatusResponse, UploadResponse } from "@korbat/contracts";
import { ApiError } from "./api";
import { AVATAR_WORDS } from "./settings-words";
import { fill } from "./ui-words";

/**
 * The avatar picker's logic (2d design, decision 14, sections 7.2, 7.3, 7.7 and 10.5), as pure functions the picker on
 * Settings, Profile calls and the tests drive: the choices of the part to keep by the chosen image's shape, the preview's
 * position and name, the upload, its processing and the setting of the picture, and where the focus goes after each.
 */

export type AvatarShape = "square" | "portrait" | "landscape";

export function avatarShape(width: number, height: number): AvatarShape {
  return width === height ? "square" : width < height ? "portrait" : "landscape";
}

/** One choice of "Which part to keep": its words, the crop the worker cuts, and the preview's position over the file. */
export interface CropChoice {
  label: string;
  crop: AvatarCrop;
  position: "top" | "center" | "bottom" | "left" | "right";
}

/**
 * The three parts along the longer side (decision 14): Top, Middle, Bottom for a portrait and Left, Middle, Right for a
 * landscape, as the worker's start, centre and end; a square has nothing to choose. Each moves the preview's position,
 * so the preview is the square the worker will keep.
 */
export function cropChoices(shape: AvatarShape): CropChoice[] {
  if (shape === "square") return [];
  const portrait = shape === "portrait";
  return [
    { label: portrait ? AVATAR_WORDS.top : AVATAR_WORDS.left, crop: "start", position: portrait ? "top" : "left" },
    { label: AVATAR_WORDS.middle, crop: "centre", position: "center" },
    { label: portrait ? AVATAR_WORDS.bottom : AVATAR_WORDS.right, crop: "end", position: portrait ? "bottom" : "right" },
  ];
}

/** The preview's name: the part kept, or the plain name for a square. */
export function previewName(choice: CropChoice | null): string {
  return choice ? fill(AVATAR_WORDS.previewPart, { part: choice.label }) : AVATAR_WORDS.preview;
}

export type AvatarOutcome = { status: "set"; avatar: AvatarView | null } | { status: "refused"; refusalId: string } | { status: "failed" } | { status: "reset" } | { status: "error"; error: unknown };

/** The calls the sequence makes: lib/social.ts's, or a test's fakes. */
export interface AvatarClient {
  uploadMedia: (file: Blob, avatar: { crop: AvatarCrop }) => Promise<UploadResponse>;
  mediaStatus: (id: string) => Promise<MediaStatusResponse>;
  setAvatar: (mediaId: string) => Promise<{ avatar: AvatarView | null }>;
}

/** How often the upload's state is asked, and for how long at most, as the composer does (useImageUploads). */
const POLL_MS = 1000;
const GIVE_UP_MS = 6 * 60_000;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));

/**
 * "Use this picture" (10.5): uploads the file as kind=avatar with the crop ("uploading"), asks its state until it is
 * settled ("processing"), and sets a ready one as the account's picture. A refused upload is never set and names its
 * refusal, whose notice the "Why" link opens; a failed one is failed; the picture a moderator reset less than 30 days ago
 * is refused by PUT /api/me/avatar's avatar_reset (7.7); any other refusal is handed back as it came.
 */
export async function sendAvatar(client: AvatarClient, file: Blob, crop: AvatarCrop, onStep: (step: "uploading" | "processing") => void, wait: () => Promise<void> = pause): Promise<AvatarOutcome> {
  try {
    onStep("uploading");
    const sent = await client.uploadMedia(file, { crop });
    onStep("processing");
    const deadline = Date.now() + GIVE_UP_MS;
    for (;;) {
      const state = await client.mediaStatus(sent.id);
      if (state.status === "refused") return { status: "refused", refusalId: state.refusalId };
      if (state.status === "failed") return { status: "failed" };
      if (state.status === "ready") break;
      if (Date.now() > deadline) return { status: "failed" };
      await wait();
    }
    return { status: "set", avatar: (await client.setAvatar(sent.id)).avatar };
  } catch (error) {
    if (error instanceof ApiError && error.code === "avatar_reset") return { status: "reset" };
    return { status: "error", error };
  }
}

/**
 * Where the focus goes (10.5): after a picture is set, to "Choose another picture"; after Cancel or a removal, to "Choose
 * a picture"; after a refusal, a failure or any error, to the error line, which says why with its "Why" link next.
 */
export function pickerFocus(event: AvatarOutcome | "cancel" | "removed"): "change" | "choose" | "error" {
  if (event === "cancel" || event === "removed") return "choose";
  return event.status === "set" ? "change" : "error";
}
