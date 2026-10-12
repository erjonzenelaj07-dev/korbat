import { Text, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";

/** What stands in the place of an image korbat's moderation hid from this reader; it does not say why. */
export const HIDDEN_IMAGE = "Image hidden by korbat moderation";
/** What stands in the place of the reader's own image once it is sealed: nobody is shown it, its author included. */
export const SEALED_IMAGE = "Sealed: not shown to anyone, you included";

/** The API marks a hidden image as sealed only for its author; for everyone else a sealed image reads like any hidden one. */
export function hiddenImageWords(item: HiddenMedia): string {
  return item.sealed ? SEALED_IMAGE : HIDDEN_IMAGE;
}

/**
 * The placeholder of a hidden image, filling the cell or the frame it is put in. A hidden image has no file to load, no
 * description and nothing to open, so this is words in a box: no picture, and no control.
 */
export function HiddenImage({ item }: { item: HiddenMedia }) {
  return (
    <View style={{ flex: 1 }} className="items-center justify-center bg-zinc-900 px-3 py-4">
      <Text className="text-center text-sm leading-5 text-zinc-400">{hiddenImageWords(item)}</Text>
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
    <View aria-hidden className="items-center justify-center border border-zinc-800 bg-zinc-900" style={{ width: size, height: size, borderRadius: 6 }}>
      <Text className="text-xs text-zinc-500">Hidden</Text>
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
  return <Text className="mt-1 text-xs leading-4 text-zinc-400">{hiddenImageWords(hidden.find((item) => item.sealed) ?? hidden[0]!)}</Text>;
}
