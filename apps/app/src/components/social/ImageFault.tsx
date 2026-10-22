import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import type { MediaStatusResponse } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { IMAGE_FAULT_WORDS } from "@/lib/moderation-words";
import { social } from "@/lib/social";

/**
 * 3d (design, sections 7.1 and 9.6): why an image of the reader's own post did not load, when its status says so. The
 * post's own answer says nothing of it (PostView is unchanged), so the image's component asks GET /api/media/:id once,
 * after a failed load, and only for the reader's own image: `restoring` while its files wait in the quarantine to be
 * returned after its seal was lifted, `lost` once korbat recorded them as lost. Anything else is what a missing image
 * shows to anyone.
 */
export type ImageFault = "restoring" | "lost";

/** The fault a status answer names, or null. */
export function imageFaultOf(answer: MediaStatusResponse): ImageFault | null {
  if (answer.status !== "ready") return null;
  if (answer.lost) return "lost";
  if (answer.restoring) return "restoring";
  return null;
}

/**
 * Asks the status of an image at most once, whatever number of times its load fails, and answers the fault it names,
 * or null when it names none or the question failed: a missing image then shows as one.
 */
export function faultAsker(ask: (id: string) => Promise<MediaStatusResponse> = social.mediaStatus) {
  const asked = new Set<string>();
  return async (id: string): Promise<ImageFault | null> => {
    if (asked.has(id)) return null;
    asked.add(id);
    try {
      return imageFaultOf(await ask(id));
    } catch {
      return null;
    }
  };
}

/**
 * The fault of one image of the reader's own post, and the handler for its failed load. For an image of anyone else's
 * post the handler does nothing: only an author is told why their image is missing.
 */
export function useImageFault(id: string, own: boolean): { fault: ImageFault | null; onError: (() => void) | undefined } {
  // Kept with the image it is about: the viewer steps between images with one component.
  const [found, setFound] = useState<{ id: string; fault: ImageFault } | null>(null);
  const ask = useRef(faultAsker()).current;
  const onError = useCallback(() => {
    void ask(id).then((fault) => {
      if (fault !== null) setFound({ id, fault });
    });
  }, [ask, id]);
  return { fault: found?.id === id ? found.fault : null, onError: own ? onError : undefined };
}

/**
 * What stands in the place of the author's own image that did not load, with the words of its fault, on surface-2 as a
 * hidden image's placeholder is (UI design, section 6.7). A lost image is an error, so it says so in danger-ink with the
 * error icon as well as in words; one being restored is neutral, with the retry icon.
 */
export function ImageFaultView({ fault }: { fault: ImageFault }) {
  const lost = fault === "lost";
  return (
    <View style={{ flex: 1 }} className="items-center justify-center gap-2 bg-surface-2 px-3 py-4">
      <Icon name={lost ? "error" : "retry"} size={20} tone={lost ? "danger" : "medium"} />
      <Text variant="meta" tone={lost ? "danger" : "medium"} className="text-center">
        {IMAGE_FAULT_WORDS[fault]}
      </Text>
    </View>
  );
}
