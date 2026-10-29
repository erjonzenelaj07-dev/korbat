import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import type { AvatarView } from "@korbat/contracts";
import { API_BASE } from "@/lib/api";
import { Text, fontVariation, type TextVariant } from "./Text";

/**
 * An account's picture (UI design, section 6.5, decision 22): without an uploaded picture, a monogram, the first grapheme
 * of the display name, ink-medium on surface-2 inside a 1 px line-low ring, with no hue, since colour in korbat means
 * action or status and a coloured disc per account would mean neither. 2d (10.4): with `src`, the account's picture in
 * the same disc, ring and size, through expo-image with no transition, so nothing moves; the monogram stays when there is
 * none or the file fails to load. It is decoration, hidden from assistive technology: the author link beside it carries
 * the name. 32 and 40 px in rows and cards, 64 px (phones) and 96 px in the profile header.
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

/** The file a disc of `size` draws: the 128 px small.webp at 32 and 40 px, the 400 px large.webp at 64 and 96; none after an error. */
export function avatarFile(src: AvatarView | null | undefined, size: AvatarSize, failed: boolean): string | null {
  if (!src || failed) return null;
  return size >= 64 ? src.large : src.small;
}

export function Avatar({ account, size = 40, src }: { account: { id: string; displayName: string }; size?: AvatarSize; src?: AvatarView | null }) {
  const large = size >= 64;
  // A file that fails to load (gone, or withheld since the view was read) gives way to the monogram, in the same place.
  const [failed, setFailed] = useState<string | null>(null);
  const file = avatarFile(src, size, failed !== null && failed === (src ? src.small + src.large : null));
  return (
    <View aria-hidden className="items-center justify-center overflow-hidden rounded-full border border-line-low bg-surface-2" style={{ width: size, height: size }}>
      {file !== null ? (
        <Image source={{ uri: `${API_BASE}${file}` }} transition={0} contentFit="cover" style={{ width: "100%", height: "100%" }} onError={() => setFailed(src ? src.small + src.large : null)} />
      ) : (
        <Text variant={LETTER[size]} tone="medium" style={large ? fontVariation('"SOFT" 100') : undefined}>
          {monogram(account.displayName)}
        </Text>
      )}
    </View>
  );
}
