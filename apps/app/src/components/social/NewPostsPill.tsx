import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { useMotion } from "@/lib/motion";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { CaughtUpCheck } from "./FeedRows";

/**
 * "N new posts above" (UI design, decision 7, sections 5.2, 8.2 and 10): the one sign that new posts arrived, floating
 * 12 px under the header, centred, in the accent fill with the newer icon. Its name adds "above, go to the first one";
 * pressing it scrolls to the oldest unread new post, the first one above the reader's place, so the reader reads on
 * upwards in time order. The count falls as rows come into view; at zero it says "You're all caught up" for two seconds
 * (opacity only) and leaves. It comes in from 8 px above and leaves by fading (pill-show: 200 ms in, 150 ms out; reduced,
 * opacity only), and a screen reader hears "N new posts above" once, when it first shows, never on later counts. Like
 * every floating layer it keeps a border in forced colours (section 4.6).
 */

/** How long "You're all caught up" stays once the count reaches zero. */
export const CAUGHT_UP_MS = 2000;

/** The pill's words for a count: "1 new post", "N new posts", or "50+ new posts" when a gap holds more not yet read. */
export function pillWords(count: number, more = false): string {
  if (more || count > 50) return UI_WORDS["feed.pill.many"];
  if (count === 1) return UI_WORDS["feed.pill.one"];
  return fill(UI_WORDS["feed.pill"], { n: count });
}

export function NewPostsPill({
  count,
  more = false,
  top,
  headerY,
  onPress,
}: {
  count: number;
  more?: boolean;
  /** The room the phone's floating header takes; the pill sits 12 px under it. */
  top: number;
  /** The header's slide on a phone: the pill moves up with it when it hides. */
  headerY?: SharedValue<number>;
  onPress: () => void;
}) {
  const motion = useMotion();
  // What shows: the count, "You're all caught up" for two seconds after it reached zero, or nothing.
  const [phase, setPhase] = useState<"hidden" | "count" | "caughtUp">(count > 0 ? "count" : "hidden");
  const [mounted, setMounted] = useState(count > 0);
  const [announced, setAnnounced] = useState<string | null>(null);
  const had = useRef(count > 0);
  useEffect(() => {
    if (count > 0) {
      if (!had.current) setAnnounced(fill(UI_WORDS["feed.pill.announce"], { visible: pillWords(count, more) }));
      had.current = true;
      setPhase("count");
      setMounted(true);
      return undefined;
    }
    if (!had.current) return undefined;
    had.current = false;
    setPhase("caughtUp");
    const timer = setTimeout(() => setPhase("hidden"), CAUGHT_UP_MS);
    return () => clearTimeout(timer);
  }, [count > 0, count]);

  const shown = useSharedValue(0);
  useEffect(() => {
    const target = phase === "hidden" ? 0 : 1;
    if (shown.value === target) {
      if (target === 0) setMounted(false);
      return;
    }
    shown.value = withTiming(target, motion.timing("easeOut", target === 1 ? 200 : 150), (finished) => {
      "worklet";
      if (finished && target === 0) runOnJS(setMounted)(false);
    });
  }, [phase, mounted]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (headerY ? headerY.value : 0) + (motion.reduced ? 0 : (1 - shown.value) * -8) }],
  }));

  // While it fades out the pill keeps the words it last showed.
  const shownWords = useRef("");
  if (phase === "caughtUp") shownWords.current = UI_WORDS["feed.caughtUp"];
  else if (phase === "count" && count > 0) shownWords.current = pillWords(count, more);
  const words = shownWords.current;
  return (
    <>
      {/* Heard once, when the pill first shows. */}
      <VisuallyHidden role="status">{announced ?? ""}</VisuallyHidden>
      {mounted ? (
        <View pointerEvents="box-none" className="absolute left-0 right-0 z-20 items-center" style={{ top: top + 12 }}>
          <Animated.View style={style}>
            <Pressable
              {...dataAttribute("pill")}
              accessibilityRole="button"
              aria-label={phase === "caughtUp" ? words : fill(UI_WORDS["feed.pill.label"], { visible: words })}
              disabled={phase !== "count"}
              onPress={onPress}
              {...pressDelay(0)}
              className={cn(
                "min-h-[44px] flex-row items-center gap-2 rounded-full border border-accent bg-accent px-4 active:opacity-90 web:forced-colors:border-[color:CanvasText]",
                FOCUS_RING,
              )}
            >
              {phase === "caughtUp" ? <CaughtUpCheck tone="on-accent" /> : <Icon name="newer" size={20} tone="on-accent" />}
              <Text variant="body-strong" tone="on-accent">
                {words}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}
