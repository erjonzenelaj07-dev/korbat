import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { PostView } from "@korbat/contracts";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { draftContext, readDraft } from "@/lib/drafts";
import { useMotion } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { Composer, type ComposerHandle } from "../Composer";

/** What a screen asks of its card: open it and put the focus in its field (the nav's New post on Home). */
export interface ComposerCardHandle {
  open(): void;
}

/** The card's corners (radius card, 4.5), on the box that clips it while it grows. */
const CORNER = 16;

/**
 * A composer that opens in place (UI design, decision 19, sections 5.2, 8.2 and 8.3): collapsed, a one-line card with the
 * reader's monogram and "What's on your mind?" (Home from 768 px) or "Write your reply" (under a thread's focused post,
 * at every width); a focus or a press opens it into the composer with the focus in the field, and it closes back when it
 * is empty and the focus has left it. A draft kept for its context opens it with its words, so nothing written is hidden
 * behind the placeholder.
 *
 * composer-open: the card's height grows from the collapsed card's to the composer's over 200 ms ease-out, and shrinks
 * back the same way, each from wherever the other left it; the box clips what is not reached yet, so the words never
 * squash. Under reduced motion it opens and closes at once. (Reanimated's LinearTransition was not used: on the web it
 * animates a scale and a translation from the element's last rectangle, which squashes the field's text and slides
 * the card whenever the list it sits in has scrolled between two renders.)
 */
export function ComposerCard({ replyTo, onPosted, startOpen = false, handle }: { replyTo?: PostView; onPosted: (post: PostView) => void; startOpen?: boolean; handle?: Ref<ComposerCardHandle> }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const motion = useMotion();
  const context = draftContext(replyTo?.id);
  const [open, setOpen] = useState(() => startOpen || (me !== null && readDraft(me.user.id, context) !== ""));
  const [focusOnOpen, setFocusOnOpen] = useState(startOpen);
  const openNow = useRef(open);
  openNow.current = open;
  const dirty = useRef(false);
  const composer = useRef<ComposerHandle>(null);
  const root = useRef<View>(null);

  // The card's height while it grows or shrinks (sizing 1); otherwise its own (auto).
  const height = useSharedValue(0);
  const sizing = useSharedValue(0);
  const outer = useRef(0);
  const style = useAnimatedStyle(() => (sizing.value === 1 ? { height: height.value } : { height: "auto" as const }));

  const toggle = (next: boolean, focus: boolean) => {
    if (next === openNow.current) {
      if (next && focus) composer.current?.focus();
      return;
    }
    if (!motion.reduced && outer.current > 0) {
      // From where it is: a card still moving turns back from its current height.
      if (sizing.value === 0) height.value = outer.current;
      sizing.value = 1;
    }
    setFocusOnOpen(focus);
    setOpen(next);
  };
  useImperativeHandle(handle, () => ({ open: () => toggle(true, true) }));

  // The new content's own height is where the card goes; the Reanimated rule: no timing to where it already is.
  const onContent = (event: LayoutChangeEvent) => {
    if (sizing.value !== 1) return;
    const to = event.nativeEvent.layout.height;
    if (Math.abs(height.value - to) < 1) {
      sizing.value = 0;
      return;
    }
    height.value = withTiming(to, motion.timing("easeOut", 200), (finished) => {
      "worklet";
      if (finished) sizing.value = 0;
    });
  };

  // The web: once the focus has moved, a card left empty closes, unless the focus is still inside it (Add image, a
  // description, Post) or has left the window (the file picker).
  const left = () => {
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      const node = root.current as unknown as HTMLElement | null;
      const active = document.activeElement;
      if (!document.hasFocus() || (node !== null && active !== null && node.contains(active))) return;
      if (!dirty.current && openNow.current) toggle(false, false);
    }, 0);
  };
  // Native: the field's blur is the card's.
  const fieldLeft = () => {
    if (Platform.OS !== "web" && !dirty.current) toggle(false, false);
  };

  const label = replyTo ? UI_WORDS["composer.collapsedReply"] : UI_WORDS["composer.collapsed"];
  const avatar = me ? <Avatar account={{ id: me.user.id, displayName: me.profile?.displayName ?? me.profile?.handle ?? "" }} size={40} src={me.avatar} /> : null;

  return (
    <Animated.View style={[{ borderRadius: CORNER, overflow: "hidden" }, style]} onLayout={(event) => (outer.current = event.nativeEvent.layout.height)}>
      {/* The card's face, drawn behind the content at the box's own size, so its edge grows with it. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} className="rounded-card border border-line-high bg-surface-1 web:forced-colors:border-[color:CanvasText]" />
      <View ref={root} {...dataAttribute("composer-card", open ? "open" : "closed")} onLayout={onContent} {...({ onBlur: left } as object)}>
        {open ? (
          <View className="flex-row gap-3 p-3">
            {avatar}
            <View className="min-w-0 flex-1">
              <Composer
                handle={composer}
                replyTo={replyTo}
                autoFocus={focusOnOpen}
                onDirtyChange={(value) => {
                  dirty.current = value;
                }}
                onFieldBlur={fieldLeft}
                onPosted={(post) => {
                  onPosted(post);
                  // The card stays open, empty, with the focus back in its field: it closes when the reader leaves it.
                  composer.current?.focus();
                }}
              />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => toggle(true, true)}
            onFocus={() => toggle(true, true)}
            className={cn("min-h-[64px] flex-row items-center gap-3 rounded-card p-3 active:bg-surface-2 web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]", FOCUS_RING)}
          >
            {avatar}
            <Text tone="low" className="min-w-0 flex-1">
              {label}
            </Text>
            <Icon name="compose" size={20} tone="low" />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
