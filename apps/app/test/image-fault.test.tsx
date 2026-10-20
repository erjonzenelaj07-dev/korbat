import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { MediaStatusResponse, MediaView } from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";
import { ImageFaultView, faultAsker, imageFaultOf } from "../src/components/social/ImageFault";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { IMAGE_FAULT_WORDS } from "../src/lib/moderation-words";

/**
 * An image of the reader's own post being restored or lost (3d design, sections 7.1 and 9.6; Task 1): after a failed
 * load of their own image, and only of their own, the component asks the image's status once and prints [image.restoring]
 * or [image.lost] in its place; anyone else sees what a missing image shows. A static render cannot fail a load, so it
 * shows which images would ask (the mock marks an image given a handler for its failed load), and the asking and the
 * words are tested by themselves.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return {
    Image: ({ source, accessibilityLabel, onError }: { source: { uri: string }; accessibilityLabel: string; onError?: () => void }) =>
      createElement("img", { "data-uri": source.uri, alt: accessibilityLabel, "data-asks": onError === undefined ? "no" : "yes" }),
  };
});
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const asking = (markup: string): string[] => [...markup.matchAll(/data-asks="([a-z]+)"/g)].map((match) => match[1]!);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
const ready = (extra: Partial<Extract<MediaStatusResponse, { status: "ready" }>> = {}): MediaStatusResponse => ({ id: id(1), status: "ready", width: 800, height: 600, blurhash: "LEHV6nWB2yk8", ...extra });

describe("an image of the reader's own post being restored or lost (3d Task 1)", () => {
  test("the status names the fault: restoring, lost, or none for every other answer", () => {
    expect(imageFaultOf(ready({ restoring: true }))).toBe("restoring");
    expect(imageFaultOf(ready({ lost: true }))).toBe("lost");
    expect(imageFaultOf(ready())).toBeNull();
    expect(imageFaultOf({ id: id(1), status: "processing" })).toBeNull();
    expect(imageFaultOf({ id: id(1), status: "failed", error: "processing_failed" })).toBeNull();
  });

  test("the status is asked once an image, however often its load fails; a failed question names no fault", async () => {
    const ask = vi.fn(async (asked: string) => ready({ id: asked, restoring: true }));
    const once = faultAsker(ask);
    expect(await once(id(1))).toBe("restoring");
    expect(await once(id(1))).toBeNull();
    expect(await once(id(2))).toBe("restoring");
    expect(ask.mock.calls.map((call) => call[0])).toEqual([id(1), id(2)]);
    const failing = faultAsker(async () => {
      throw new Error("offline");
    });
    expect(await failing(id(3))).toBeNull();
  });

  test("the words in the image's place: [image.restoring] and [image.lost], the second those of the mail image_lost", () => {
    expect(textOf(html(<ImageFaultView fault="restoring" />))).toBe("This image is being restored. It is shown again once korbat has moved it back; you do not need to do anything.");
    expect(textOf(html(<ImageFaultView fault="lost" />))).toBe(IMAGE_LOST_NOTICE.onImage);
    expect(IMAGE_FAULT_WORDS.lost).toBe("korbat lost this image's files while they were kept apart from its other images. It cannot be shown again. You can delete the post, or post the image again.");
  });

  test("only the reader's own images ask, in the post and in the viewer; anyone else's image shows as missing", () => {
    expect(asking(html(<MediaGrid media={[image(1), image(2)]} postId={id(9)} own />))).toEqual(["yes", "yes"]);
    expect(asking(html(<MediaGrid media={[image(1), image(2)]} postId={id(9)} />))).toEqual(["no", "no"]);
    const noop = () => undefined;
    expect(asking(html(<MediaViewerContent media={[image(1)]} index={0} onIndex={noop} onClose={noop} own />))).toEqual(["yes"]);
    expect(asking(html(<MediaViewerContent media={[image(1)]} index={0} onIndex={noop} onClose={noop} postId={id(9)} />))).toEqual(["no"]);
  });
});
