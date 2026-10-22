import { View } from "react-native";
import { Text, fontVariation, type TextVariant } from "./Text";

/**
 * An account's picture (UI design, section 6.5, decision 22). No uploaded avatars exist before 2d, so it draws a
 * monogram now: the first grapheme of the display name, ink-medium on surface-2 inside a 1 px line-low ring, with no hue,
 * since colour in korbat means action or status and a coloured disc per account would mean neither. 2d gives it `src`
 * without moving anything. It is decoration, hidden from assistive technology: the author link beside it carries the
 * name. 40 px in post cards and rows, 64 px (phones) and 96 px in the profile header.
 */
export type AvatarSize = 32 | 40 | 64 | 96;

/**
 * The letter's variant: the text face at 700 in the small discs, Fraunces at the large ones, where the letter is above
 * 22 px, so the profile header's name and disc share the display face.
 */
const LETTER: Record<AvatarSize, TextVariant> = { 32: "body-strong", 40: "title", 64: "display-2", 96: "display-1" };

/** Splits text into what a reader sees as characters, where the runtime can; a letter and its accent stay together. */
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The monogram of a display name: its first grapheme, in capitals; nothing for an empty name. */
export function monogram(displayName: string): string {
  const name = displayName.trim();
  if (name === "") return "";
  const first = segmenter ? (segmenter.segment(name)[Symbol.iterator]().next().value?.segment ?? "") : (Array.from(name)[0] ?? "");
  return first.toLocaleUpperCase();
}

export function Avatar({ account, size = 40 }: { account: { id: string; displayName: string }; size?: AvatarSize; src?: string }) {
  const large = size >= 64;
  return (
    <View aria-hidden className="items-center justify-center overflow-hidden rounded-full border border-line-low bg-surface-2" style={{ width: size, height: size }}>
      <Text variant={LETTER[size]} tone="medium" style={large ? fontVariation('"SOFT" 100') : undefined}>
        {monogram(account.displayName)}
      </Text>
    </View>
  );
}
