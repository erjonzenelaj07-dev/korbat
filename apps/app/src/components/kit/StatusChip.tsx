import { cva } from "class-variance-authority";
import type { Ref } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { usePressScale } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING } from "./interaction";
import { Text, type Tone } from "./Text";

/**
 * A status as a chip (UI design, sections 4.8 and 6.13): the tone's wash, its own icon and its words, so it reads in
 * greyscale, to a screen reader and to a colour-blind reader alike; the colour only repeats what the words say. A chip is
 * never a coloured dot, and its words wrap rather than being cut. Three forms, by what it does:
 *   - information only (no href, no onPress): an image named by its label, or by `name` where the visible word needs
 *     more words to be understood (VerifiedChip shows "Verified" and is named "verified account");
 *   - a link (`href`): an anchor named by its words (In Explore, to its post);
 *   - a button (`onPress`): the author's moderation chip, which opens the details sheet, so it says it opens a dialog and
 *     ends in a chevron that makes it look pressable.
 */
export const STATUS_TONES = ["review", "restricted", "verified", "explore"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** Each tone's own icon, four different drawings (section 4.7): a clock, an eye struck through, a badge, a compass. */
export const STATUS_ICON: Record<StatusTone, IconName> = { review: "review", restricted: "restricted", verified: "verified", explore: "explore" };

const ON_WASH: Record<StatusTone, Tone> = { review: "review-on-wash", restricted: "restricted-on-wash", verified: "verified-on-wash", explore: "explore-on-wash" };

/**
 * The wash with a 1 px border in the tone's ink at 40 percent (4.8), solid CanvasText under forced colours, where the
 * browser removes backgrounds and the border alone keeps the shape. A chip that does something shows its border in full
 * ink under a fine pointer.
 */
const chip = cva("max-w-full flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5 web:forced-colors:border-[color:CanvasText]", {
  variants: {
    tone: {
      review: "border-review-ink/40 bg-review-wash web:group-hover:border-review-ink",
      restricted: "border-restricted-ink/40 bg-restricted-wash web:group-hover:border-restricted-ink",
      verified: "border-verified-ink/40 bg-verified-wash web:group-hover:border-verified-ink",
      explore: "border-explore-ink/40 bg-explore-wash web:group-hover:border-explore-ink",
    },
  },
});

interface StatusChipProps {
  tone: StatusTone;
  /** The chip's words, never empty: chipText(), "In Explore", "Verified". */
  label: string;
  /** The name of the information-only form, when it says more than the visible words. */
  name?: string;
  href?: Href;
  onPress?: () => void;
  /** Where the chip sits in its parent, such as self-center beside a display name. */
  className?: string;
  /** The button form's pressable, which takes the focus back when the sheet it opened has closed (UI Task 7). */
  ref?: Ref<View>;
}

/** The drawn chip: icon, words that wrap, and the button form's chevron. */
function Face({ tone, label, chevron }: { tone: StatusTone; label: string; chevron: boolean }) {
  return (
    <View className={chip({ tone })}>
      <Icon name={STATUS_ICON[tone]} size={14} tone={ON_WASH[tone]} />
      {/* At the largest text on the narrowest phone a single word can be wider than the chip: it breaks rather than clip. */}
      <Text variant="chip" tone={ON_WASH[tone]} className="min-w-0 shrink web:break-words">
        {label}
      </Text>
      {chevron ? <Icon name="next" size={14} tone={ON_WASH[tone]} /> : null}
    </View>
  );
}

export function StatusChip({ tone, label, name, href, onPress, className, ref }: StatusChipProps) {
  const press = usePressScale(0.97);
  if (href === undefined && onPress === undefined) {
    return (
      <View role="img" accessibilityLabel={name ?? label} className={cn("max-w-full", className)}>
        <Face tone={tone} label={label} chevron={false} />
      </View>
    );
  }
  // A chip that does something is a control: its target is 44 px tall around the drawn chip (section 4.4). The pressed
  // scale moves the Animated.View, which takes no classes on the web, so the placement sits on a View around it.
  const target = cn("group min-h-[44px] max-w-full justify-center rounded-control", FOCUS_RING);
  return (
    <View className={cn("max-w-full", className)}>
      <Animated.View style={press.style}>
        {href !== undefined ? (
          <Link href={href} asChild>
            <Pressable {...press.handlers} className={target}>
              <Face tone={tone} label={label} chevron={false} />
            </Pressable>
          </Link>
        ) : (
          <Pressable ref={ref} accessibilityRole="button" aria-haspopup="dialog" onPress={onPress} {...press.handlers} className={target}>
            <Face tone={tone} label={label} chevron />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * A fact as a chip, which is no status (UI Task 8, sections 4.8 and 8.8): Security's "this device" and a passkey's tags
 * ("used for this session", "new", "synced"). It takes no status colour and no icon, since it says nothing a colour could
 * repeat: ink-medium on surface-2 with a line-high border, solid CanvasText under forced colours, so it keeps its shape.
 * It is an image to assistive technology, named by `name` where the one word needs more words to be understood, as the
 * verified chip is.
 */
export function NeutralChip({ label, name, className }: { label: string; name?: string; className?: string }) {
  return (
    <View role="img" accessibilityLabel={name ?? label} className={cn("max-w-full self-start rounded-full border border-line-high bg-surface-2 px-2 py-0.5 web:forced-colors:border-[color:CanvasText]", className)}>
      <Text variant="chip" tone="medium" className="min-w-0 shrink web:break-words">
        {label}
      </Text>
    </View>
  );
}
