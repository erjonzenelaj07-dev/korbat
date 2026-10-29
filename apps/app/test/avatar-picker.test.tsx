import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AvatarView, MediaStatusResponse } from "@korbat/contracts";
import { AvatarCardView, type AvatarCardViewProps } from "../src/app/settings/profile";
import { ApiError } from "../src/lib/api";
import { avatarShape, cropChoices, pickerFocus, previewName, sendAvatar } from "../src/lib/avatar";
import { UPLOAD_TEXTS } from "../src/lib/moderation-words";
import { pickImages } from "../src/lib/pick-images";
import { AVATAR_WORDS } from "../src/lib/settings-words";

/**
 * The avatar picker (2d design, sections 7.2, 7.7 and 10.5; Task 5): the crop choices by the image's shape, the preview's
 * position and name, the upload and set sequence with its status line, a refused, a failed and a reset upload as error
 * lines, the removal's question, and where the focus goes after each. A static render cannot choose a file or wait, so the
 * sequence is lib/avatar.ts's sendAvatar, driven by a fake client, and the card is drawn in each state through
 * AvatarCardView; the browser check walks it (step 54).
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/profile",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return {
    Image: ({ source, accessibilityLabel, contentPosition }: { source: { uri: string }; accessibilityLabel?: string; contentPosition?: string }) =>
      createElement("img", { "data-uri": source.uri, alt: accessibilityLabel ?? "", "data-position": contentPosition }),
  };
});
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const tags = (markup: string): string[] => markup.match(/<[a-z0-9]+\b[^>]*>/g) ?? [];
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from)).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}
const buttonTexts = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!);

const A = AVATAR_WORDS;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AVATAR: AvatarView = { small: `/api/media/${id(90)}/small.webp`, large: `/api/media/${id(90)}/large.webp` };

describe("the crop choices and the preview (decision 14, 10.5)", () => {
  test("named by the image's shape: Top, Middle, Bottom for a portrait; Left, Middle, Right for a landscape; none for a square", () => {
    expect(avatarShape(600, 900)).toBe("portrait");
    expect(avatarShape(900, 600)).toBe("landscape");
    expect(avatarShape(700, 700)).toBe("square");
    expect(cropChoices("portrait").map((choice) => [choice.label, choice.crop, choice.position])).toEqual([
      [A.top, "start", "top"],
      [A.middle, "centre", "center"],
      [A.bottom, "end", "bottom"],
    ]);
    expect(cropChoices("landscape").map((choice) => [choice.label, choice.crop, choice.position])).toEqual([
      [A.left, "start", "left"],
      [A.middle, "centre", "center"],
      [A.right, "end", "right"],
    ]);
    expect(cropChoices("square")).toEqual([]);
  });

  test("the preview's name says the part kept, and a square's is the plain name", () => {
    expect(previewName(cropChoices("portrait")[0]!)).toBe("Preview of your profile picture, Top part kept");
    expect(previewName(cropChoices("landscape")[2]!)).toBe("Preview of your profile picture, Right part kept");
    expect(previewName(null)).toBe(A.preview);
  });

  test("the picker opens the file dialog for one image only", async () => {
    const input = { type: "", accept: "", multiple: true, files: null as unknown, onchange: null as null | (() => void), oncancel: null as null | (() => void), click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => input });
    try {
      const picked = pickImages({ multiple: false });
      expect(input.multiple).toBe(false);
      expect(input.click).toHaveBeenCalledTimes(1);
      input.oncancel?.();
      expect(await picked).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/** A fake client: the upload answers processing, the status answers each of `statuses` in turn, and set answers or throws. */
function fakeClient(statuses: MediaStatusResponse[], set: () => Promise<{ avatar: AvatarView | null }> = async () => ({ avatar: AVATAR })) {
  const client = {
    uploadMedia: vi.fn(async (_file: Blob, _avatar?: { crop: string }) => ({ id: id(80), status: "processing" as const })),
    mediaStatus: vi.fn(async () => statuses.shift()!),
    setAvatar: vi.fn(set),
  };
  return client;
}
const FILE = new Blob(["x"], { type: "image/jpeg" });
const noWait = async () => undefined;

describe("the upload and set sequence (7.2, 7.3, 10.5)", () => {
  test("uploads with kind avatar and the crop, says uploading then preparing, polls until ready, then sets it", async () => {
    const client = fakeClient([{ status: "processing" } as MediaStatusResponse, { status: "ready" } as MediaStatusResponse]);
    const steps: string[] = [];
    const outcome = await sendAvatar(client, FILE, "end", (step) => steps.push(step), noWait);
    expect(client.uploadMedia).toHaveBeenCalledWith(FILE, { crop: "end" });
    expect(client.mediaStatus).toHaveBeenCalledTimes(2);
    expect(client.setAvatar).toHaveBeenCalledWith(id(80));
    expect(steps).toEqual(["uploading", "processing"]);
    expect(outcome).toEqual({ status: "set", avatar: AVATAR });
    expect(pickerFocus(outcome)).toBe("change");
  });

  test("a refused upload is never set and names its refusal; a failed one is failed; a reset picture is refused by its code", async () => {
    const refused = fakeClient([{ status: "refused", refusalId: id(81) } as MediaStatusResponse]);
    expect(await sendAvatar(refused, FILE, "centre", () => undefined, noWait)).toEqual({ status: "refused", refusalId: id(81) });
    expect(refused.setAvatar).not.toHaveBeenCalled();
    const failed = fakeClient([{ status: "failed", error: "corrupt_image" } as MediaStatusResponse]);
    expect(await sendAvatar(failed, FILE, "centre", () => undefined, noWait)).toEqual({ status: "failed" });
    const reset = fakeClient([{ status: "ready" } as MediaStatusResponse], async () => {
      throw new ApiError(409, "avatar_reset", "x");
    });
    const outcome = await sendAvatar(reset, FILE, "start", () => undefined, noWait);
    expect(outcome).toEqual({ status: "reset" });
    // Each is an error line, which takes the focus; Cancel and a removal give it back to Choose a picture.
    expect(pickerFocus(outcome)).toBe("error");
    expect(pickerFocus({ status: "failed" })).toBe("error");
    expect(pickerFocus("cancel")).toBe("choose");
    expect(pickerFocus("removed")).toBe("choose");
  });
});

const view = (extra: Partial<AvatarCardViewProps> = {}) =>
  html(
    <AvatarCardView
      avatar={null}
      displayName="Ada Lovelace"
      chosen={null}
      choice={null}
      step={null}
      error={null}
      onChoose={() => undefined}
      onPart={() => undefined}
      onUse={() => undefined}
      onCancel={() => undefined}
      onRemove={() => undefined}
      {...extra}
    />,
  );

describe("the card (10.5)", () => {
  test("without a picture: the monogram, the explanation and Choose a picture; with one: the 96 px picture, Choose another picture and Remove picture", () => {
    const none = view();
    expect(textOf(none)).toContain(A.section);
    expect(textOf(none)).toContain(A.explain);
    expect(buttonTexts(none)).toEqual([A.choose]);
    expect(textOf(none)).toContain("A");
    const set = view({ avatar: AVATAR });
    expect(set).toContain(`data-uri="${AVATAR.large}"`);
    expect(buttonTexts(set)).toEqual([A.change, A.remove]);
  });

  test("a chosen portrait: the preview over the local file at its part, named by it, Which part to keep, Use this picture and Cancel", () => {
    const portrait = cropChoices("portrait");
    const out = view({ chosen: { url: "blob:x", width: 600, height: 900 }, choice: portrait[0]! });
    const preview = tags(out).find((tag) => tag.includes('data-uri="blob:x"'))!;
    expect(attr(preview, "data-position")).toBe("top");
    expect(attr(preview, "alt")).toBe("Preview of your profile picture, Top part kept");
    const group = tags(out).find((tag) => tag.includes('role="radiogroup"'))!;
    expect(group).toContain("aria-labelledby=");
    expect(textOf(out)).toContain(A.keep);
    expect(tags(out).filter((tag) => tag.includes('role="radio"')).map((tag) => attr(tag, "aria-checked"))).toEqual(["true", "false", "false"]);
    expect(buttonTexts(out)).toEqual([A.use, A.cancel]);
    // A square has no choice to make.
    const square = view({ chosen: { url: "blob:y", width: 500, height: 500 }, choice: null });
    expect(tags(square).some((tag) => tag.includes('role="radiogroup"'))).toBe(false);
  });

  test("the status line while it uploads and prepares; a refused, a failed and a reset picture as error lines", () => {
    const chosen = { url: "blob:x", width: 500, height: 500 };
    for (const [step, words] of [
      ["uploading", A.uploading],
      ["processing", A.processing],
    ] as const) {
      const out = view({ chosen, step });
      const status = tags(out).find((tag) => tag.includes('role="status"'))!;
      expect(status, step).toBeDefined();
      expect(textOf(out), step).toContain(words);
    }
    const refused = view({ chosen, error: { status: "refused", refusalId: id(81) } });
    expect(tags(refused).some((tag) => tag.includes('role="alert"'))).toBe(true);
    expect(textOf(refused)).toContain(UPLOAD_TEXTS.refused);
    expect(hrefs(refused)).toContain(`/settings/cases/uploads/${id(81)}`);
    expect(textOf(view({ chosen, error: { status: "failed" } }))).toContain(A.failed);
    expect(textOf(view({ chosen, error: { status: "reset" } }))).toContain(A.resetRecently);
  });

  test("Remove picture asks first, in the AskSheet, with its question, its sentence, Remove and Cancel", () => {
    const source = read("app", "settings", "profile.tsx");
    expect(source).toContain("<AskSheet");
    expect(source).toContain("title={AVATAR_WORDS.confirmTitle}");
    expect(source).toContain("description={AVATAR_WORDS.confirmBody}");
    expect(source).toContain("confirm={AVATAR_WORDS.confirm}");
    expect(source).toContain("keep={AVATAR_WORDS.cancel}");
    expect(source).toContain("toast.show({ message: AVATAR_WORDS.removed })");
    expect(source).toContain("toast.show({ message: AVATAR_WORDS.updated })");
    // The preview's blob: address is let go when the card closes.
    expect(source).toContain("URL.revokeObjectURL(");
  });
});
