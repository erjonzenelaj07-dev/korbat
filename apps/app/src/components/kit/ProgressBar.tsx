import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useMotion } from "@/lib/motion";

/**
 * A determinate progress bar (3b design, sections 10.1, 10.3 and 10.5): role progressbar with the four aria values
 * (aria-valuemin 0, aria-valuemax 100, aria-valuenow the percentage, and aria-valuetext the words a person reads, "120 MB
 * of 840 MB", "Publishing posts: 800 of 1,240"), named by `label`. The fill is the accent on a surface-2 track and grows by
 * a transform (scaleX from its start), 200 ms ease-out, since only transform and opacity move (UI design, section 5.1);
 * under reduced motion it is a static bar that takes each new value at once. `indeterminate` draws the track alone and
 * carries no value, for work whose length is not known.
 */
export function ProgressBar({ label, value = 0, max = 100, valueText, indeterminate = false }: { label: string; value?: number; max?: number; valueText?: string; indeterminate?: boolean }) {
  const motion = useMotion();
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const shown = useSharedValue(fraction);
  useEffect(() => {
    shown.value = motion.reduced ? fraction : withTiming(fraction, motion.timing("easeOut", 200));
  }, [fraction, motion, shown]);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: shown.value }] }));
  const values = indeterminate ? {} : { "aria-valuenow": Math.round(fraction * 100), "aria-valuetext": valueText };
  return (
    <View role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...values} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      {indeterminate ? null : <Animated.View className="h-full w-full rounded-full bg-accent" style={[{ transformOrigin: "left" } as object, fill]} />}
    </View>
  );
}
