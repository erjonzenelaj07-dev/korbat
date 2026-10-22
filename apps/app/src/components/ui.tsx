import { cva } from "class-variance-authority";
import type { ReactNode, Ref } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Animated from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, pressDelay } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text, textStyle, type Tone } from "@/components/kit/Text";
import { useAppearance } from "@/lib/appearance";
import { useMotion, usePressScale, usePulse, useSpin } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The twelve building blocks the screens have used since the first sub-projects, kept with their names and props
 * because tests import them and pin lines of them (UI design, section 6.1), and redrawn on korbat's kit: the tokens of
 * theme/, the Text and Icon components, the pressed scale of lib/motion.ts and the words of lib/ui-words.ts.
 */

/** A centred column on the page's surface, used by every auth screen. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-surface px-6 py-10">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}

/** A screen's title: its one level-1 heading, in the display face. */
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text as="h1" variant="display-2">
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return (
    <Text tone="medium" className="mt-2">
      {children}
    </Text>
  );
}

/** A titled box on a settings screen, a card on the page; the title is a heading one level under the screen's own. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-card border border-line-low bg-surface-1 p-5">
      <Text as="h2" variant="title">
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * The verified badge after a display name: the account proved it holds a phone number that no other
 * account uses. The label says what the one word means to a screen reader. The chip is an image to
 * assistive technology: ARIA forbids naming an element without a role, and screen readers ignore such
 * a name, while an image is announced by it. It is StatusChip's information-only form, in the verified tone.
 */
export function VerifiedChip() {
  return <StatusChip tone="verified" label={UI_WORDS["verified.label"]} name={UI_WORDS["verified.name"]} className="self-center" />;
}

/**
 * A labelled text field. `ref` reaches the input itself, whose focus() moves the browser's focus to it. Its text is the
 * body variant at the reader's step and font (textStyle()), its placeholder ink-low, which reads at 6.29:1 or more on
 * surface-1 in every theme.
 */
export function Field({ label, ref, style, ...input }: { label: string; ref?: Ref<TextInput> } & TextInputProps) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  return (
    <View className="mt-6 gap-2">
      <Text variant="body-strong" tone="medium">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors["ink-low"]}
        className={cn("min-h-[44px] rounded-control border border-line-high bg-surface-1 px-4 py-3 text-ink-high", FOCUS_RING)}
        style={[textStyle("body", { step: appearance.textStep, font: appearance.font }), style]}
        {...input}
      />
    </View>
  );
}

/**
 * Button's faces (section 6.4): the accent fill for the primary action, surface-1 with a line-high border for a second
 * one, the danger fill for a destructive one, and surface-2 with ink-low while it cannot be used, still readable because
 * its label may carry the reason ("Describe every image"). Each face sets its colours once, so no two classes fight.
 */
export const buttonFace = cva(cn("flex-row items-center justify-center gap-2 rounded-control border px-4 web:transition-colors web:duration-[120ms] web:ease-[ease]", FOCUS_RING), {
  variants: {
    face: {
      primary: "border-accent bg-accent web:hover:bg-accent/90",
      secondary: "border-line-high bg-surface-1 web:hover:bg-surface-2",
      danger: "border-danger bg-danger web:hover:bg-danger/90",
      inactive: "border-surface-2 bg-surface-2",
    },
    size: { md: "min-h-[44px] py-2", lg: "min-h-[52px] py-3" },
  },
});

export type ButtonFace = "primary" | "secondary" | "danger" | "inactive";

/** The label's tone on each face: on-accent on the accent, on-danger on the danger fill, ink-low on an inactive one. */
export const LABEL_TONE: Record<ButtonFace, Tone> = { primary: "on-accent", secondary: "high", danger: "on-danger", inactive: "low" };

/**
 * A button, full width by default as inside a form. `ref` reaches the pressable itself, whose focus() moves the
 * browser's focus to it. It scales to 0.97 from pointer-down (section 5.2; reduced, not at all). While `busy` it says
 * "Please wait..." and is busy and disabled. Nothing inside it that closes a div comes before the label (the icon is a
 * bare svg), since tests read a button's text up to its first closing div.
 */
export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  size = "md",
  icon,
  full = true,
  ref,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  /** md is 44 px tall at least, lg 52 px. */
  size?: "md" | "lg";
  icon?: IconName;
  full?: boolean;
  ref?: Ref<View>;
}) {
  const press = usePressScale(0.97);
  const inactive = disabled || busy;
  const face: ButtonFace = inactive ? "inactive" : tone;
  return (
    // Not full, the button keeps to its words: it sits at the start of a stretching parent and where a centring one puts it.
    <View className={cn("mt-6", full ? "self-stretch" : "items-start")}>
      <Animated.View style={press.style}>
        <Pressable ref={ref} accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size })}>
          {icon !== undefined ? <Icon name={icon} size={20} tone={LABEL_TONE[face]} /> : null}
          <Text variant="body-strong" tone={LABEL_TONE[face]} className="shrink text-center">
            {busy ? UI_WORDS["button.busy"] : label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A text link's target: 44 px tall around its words, dimmed while pressed, its underline thicker under a fine pointer. */
const TEXT_TARGET = cn("group mt-6 min-h-[44px] justify-center self-center rounded-control px-1 active:opacity-70", FOCUS_RING);
const TEXT_WORDS = "text-center underline web:underline-offset-2 web:group-hover:decoration-2";

/**
 * A small link under a form. It is a real anchor (expo-router's Link), so it opens with Enter, in a
 * new tab with a modifier key, and by every other means a link works. `onPress` runs before the
 * navigation, for a flow that has to forget its state first. Accent ink, underlined, at body size.
 */
export function TextLink({ label, href, replace = false, onPress }: { label: string; href: Href; replace?: boolean; onPress?: () => void }) {
  return (
    <Link href={href} replace={replace} onPress={onPress} asChild>
      <Pressable className={TEXT_TARGET}>
        <Text tone="accent" className={TEXT_WORDS}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/** The same look for an action that is not a destination, such as switching a form's mode. */
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={TEXT_TARGET}>
      <Text tone="accent" className={TEXT_WORDS}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A form's error, announced as it appears, with the error icon so it never relies on its colour (section 4.8). */
export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" className="mt-4 flex-row items-start gap-2">
      <View className="pt-[3px]">
        <Icon name="error" size={16} tone="danger" />
      </View>
      <Text tone="danger" className="shrink">
        {message}
      </Text>
    </View>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 py-3">
      <Text tone="medium">{message}</Text>
    </View>
  );
}

/**
 * The centred spinner of the auth screens and the guard layouts (sections 5.2 and 6.12), in the accent on the page: a
 * ring with a fainter quarter, one turn every 800 ms; under reduced motion it does not turn and pulses instead. Screens
 * inside the shell show skeleton rows instead (kit/Skeleton.tsx).
 */
export function Loading() {
  const motion = useMotion();
  const spin = useSpin();
  const pulse = usePulse({ on: motion.reduced, still: false });
  return (
    <View className="flex-1 items-center justify-center bg-surface">
      <View accessibilityRole="progressbar" accessibilityLabel={UI_WORDS["spinner.label"]}>
        <Animated.View style={motion.reduced ? pulse : spin}>
          <View className="h-7 w-7 rounded-full border-[3px] border-x-accent border-b-accent border-t-accent/20" />
        </Animated.View>
      </View>
    </View>
  );
}
