import { View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { UI_WORDS } from "@/lib/ui-words";

/** What stands in the place of an image korbat's moderation hid from this reader; it does not say why. */
export const HIDDEN_IMAGE = "Image hidden by korbat moderation";
/** What stands in the place of the reader's own image once it is sealed: nobody is shown it, its author included. */
export const SEALED_IMAGE = "Sealed: not shown to anyone, you included";

/** The API marks a hidden image as sealed only for its author; for everyone else a sealed image reads like any hidden one. */
export function hiddenImageWords(item: HiddenMedia): string {
  return item.sealed ? SEALED_IMAGE : HIDDEN_IMAGE;
}

/**
 * The placeholder of a hidden image, filling the cell or the frame it is put in (UI design, sections 4.8 and 6.7): the
 * hidden icon and the sentence in ink-medium on surface-2, a neutral look rather than a status colour. A hidden image has
 * no file to load, no description and nothing to open, so this is words in a box: no picture, and no control.
 */
export function HiddenImage({ item }: { item: HiddenMedia }) {
  return (
    <View style={{ flex: 1 }} className="items-center justify-center gap-2 bg-surface-2 px-3 py-4">
      <Icon name="hidden" size={20} tone="medium" />
      <Text variant="meta" tone="medium" className="text-center">
        {hiddenImageWords(item)}
      </Text>
    </View>
  );
}

/**
 * The same as a small square, for the row of a quoted post's images. It is too small for the sentence and shows one
 * short word; the row says the sentence once, as text, under its squares (HiddenRowWords), so the square itself is
 * left out of what assistive technology reads, which would otherwise hear the row's sentence after a word of each square.
 */
export function HiddenThumbnail({ size }: { size: number }) {
  return (
    <View aria-hidden className="items-center justify-center gap-0.5 rounded-media border border-line-low bg-surface-2" style={{ width: size, height: size }}>
      <Icon name="hidden" size={16} tone="medium" />
      <Text variant="chip" tone="medium">
        {UI_WORDS["media.hidden"]}
      </Text>
    </View>
  );
}

/**
 * The sentence a row of small squares says under itself when it holds a hidden image: once, however many it holds. The
 * API marks a hidden image as sealed only for its author, so the sealed sentence is read only by the author of a sealed
 * image in the row; anyone else reads the sentence of a hidden image. Nothing when the row holds no hidden image.
 */
export function HiddenRowWords({ media }: { media: readonly (MediaView | HiddenMedia)[] }) {
  const hidden = media.filter(isHiddenMedia);
  if (hidden.length === 0) return null;
  return (
    <Text variant="meta" tone="medium" className="mt-1">
      {hiddenImageWords(hidden.find((item) => item.sealed) ?? hidden[0]!)}
    </Text>
  );
}
