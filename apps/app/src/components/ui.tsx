import type { ReactNode, Ref } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { Link, type Href } from "expo-router";

/** A centred column on the dark background, used by every auth screen. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950 px-6 py-10">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text className="mt-2 text-base leading-6 text-zinc-400">{children}</Text>;
}

/** A titled box on a settings screen; the title is a heading one level under the screen's own. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-xl border border-zinc-800 p-5">
      <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
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
 * a name, while an image is announced by it.
 */
export function VerifiedChip() {
  return (
    <View role="img" accessibilityLabel="verified account" className="self-center rounded-full bg-sky-950 px-2 py-0.5">
      <Text className="text-xs font-medium text-sky-300">Verified</Text>
    </View>
  );
}

/** A labelled text field. `ref` reaches the input itself, whose focus() moves the browser's focus to it. */
export function Field({ label, ref, ...input }: { label: string; ref?: Ref<TextInput> } & TextInputProps) {
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor="#a1a1aa"
        className="mt-2 rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-3 text-base text-zinc-50"
        {...input}
      />
    </View>
  );
}

/** A full-width button. `ref` reaches the pressable itself, whose focus() moves the browser's focus to it. */
export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  ref,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  ref?: Ref<View>;
}) {
  const inactive = disabled || busy;
  const surface = inactive ? "bg-zinc-800" : tone === "primary" ? "bg-zinc-50" : tone === "danger" ? "bg-red-600" : "border border-zinc-600";
  const text = inactive ? "text-zinc-400" : tone === "primary" ? "text-zinc-950" : "text-zinc-50";
  return (
    <Pressable ref={ref} accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} className={`mt-6 rounded-lg px-4 py-3 ${surface}`}>
      <Text className={`text-center text-base font-semibold ${text}`}>{busy ? "Please wait…" : label}</Text>
    </Pressable>
  );
}

/**
 * A small link under a form. It is a real anchor (expo-router's Link), so it opens with Enter, in a
 * new tab with a modifier key, and by every other means a link works. `onPress` runs before the
 * navigation, for a flow that has to forget its state first.
 */
export function TextLink({ label, href, replace = false, onPress }: { label: string; href: Href; replace?: boolean; onPress?: () => void }) {
  return (
    <Link href={href} replace={replace} onPress={onPress} asChild>
      <Pressable className="mt-6">
        <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
      </Pressable>
    </Link>
  );
}

/** The same look for an action that is not a destination, such as switching a form's mode. */
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="mt-6">
      <Text className="text-center text-sm text-zinc-400 underline">{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" className="mt-4 text-sm text-red-400">
      {message}
    </Text>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-300">{message}</Text>;
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-950">
      <ActivityIndicator color="#fafafa" accessibilityLabel="Loading" />
    </View>
  );
}
