import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import { FOCUS_RING } from "@/components/kit/interaction";
import { textStyle } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { useAppearance } from "@/lib/appearance";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { crossed, type ComposerKind } from "./state";

/** The field's names and placeholders, as the composer always had them (pinned by name in the walk). */
const NAME: Record<ComposerKind, string> = { post: UI_WORDS["composer.field.post"], reply: UI_WORDS["composer.field.reply"], quote: UI_WORDS["composer.field.quote"] };
const PLACEHOLDER: Record<ComposerKind, string> = { post: UI_WORDS["composer.placeholder.post"], reply: UI_WORDS["composer.placeholder.reply"], quote: UI_WORDS["composer.placeholder.quote"] };

/** The field's least height: three lines of the post variant and its padding. */
const MIN_HEIGHT = 88;
/** Its vertical padding (py-3), which a native content size leaves out. */
const PADDING = 24;

export interface ComposerFieldProps {
  kind: ComposerKind;
  value: string;
  onChangeText: (text: string) => void;
  /** The text's length by the server's rule (composer/state.ts), which the count says. */
  length: number;
  autoFocus?: boolean;
  fieldRef?: Ref<TextInput>;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * The composer's field (UI design, sections 6.15 and 10): the TextInput with its kept names ("What's on your mind?",
 * "Your reply", "Your comment on the quoted post") and placeholders, in the post variant, growing with its words up to
 * half the window and then scrolling (on the web by CSS field-sizing, natively from its content size). Its description
 * (aria-describedby) is a visually hidden "{n} of 1000 characters", which replaces the visible "n/1000": the ring shows
 * the count. A polite status says the count again only when it crosses 900 or 1000, so a screen reader hears the end
 * coming without hearing every keystroke.
 */
export function ComposerField({ kind, value, onChangeText, length, autoFocus, fieldRef, onFocus, onBlur }: ComposerFieldProps) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  const screen = useWindowDimensions();
  const countId = useId();
  const count = fill(UI_WORDS["composer.count"], { n: length });
  const [announced, setAnnounced] = useState("");
  const before = useRef(length);
  useEffect(() => {
    if (crossed(before.current, length)) setAnnounced(count);
    before.current = length;
  }, [length, count]);
  const [content, setContent] = useState(0);
  // Half the window, but never less than the field's own least height.
  const most = Math.max(MIN_HEIGHT, Math.round((screen.height || MIN_HEIGHT * 4) / 2));
  const native = Platform.OS !== "web";
  return (
    <View>
      <TextInput
        ref={fieldRef}
        accessibilityLabel={NAME[kind]}
        aria-describedby={countId}
        placeholder={PLACEHOLDER[kind]}
        placeholderTextColor={colors["ink-low"]}
        multiline
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onContentSizeChange={native ? (event) => setContent(event.nativeEvent.contentSize.height) : undefined}
        className={cn("min-h-[88px] rounded-control border border-line-high bg-surface-1 px-4 py-3 text-ink-high web:[field-sizing:content]", FOCUS_RING)}
        style={[textStyle("post", { step: appearance.textStep, font: appearance.font }), { maxHeight: most }, native && content > 0 ? { height: Math.min(most, Math.max(MIN_HEIGHT, content + PADDING)) } : null]}
      />
      <VisuallyHidden nativeID={countId}>{count}</VisuallyHidden>
      <VisuallyHidden role="status">{announced}</VisuallyHidden>
    </View>
  );
}
