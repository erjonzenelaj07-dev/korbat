import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { TONE_TOKEN, Text } from "@/components/kit/Text";
import { useMotion } from "@/lib/motion";
import { useTheme } from "@/theme/ThemeProvider";
import { ring, type RingTone } from "./state";

const RING_SIZE = 20;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TONE: Record<RingTone, "accent" | "review-ink" | "danger"> = { accent: "accent", "review-ink": "review-ink", danger: "danger" };

/**
 * The ring of the composer's count on iOS and Android (UI design, sections 5.2 and 6.15), drawn with react-native-svg:
 * the same 20 px circle, colours and number as ProgressRing.web.tsx, its colours the theme's values (an svg takes no
 * class here). The dash offset follows the count on a 120 ms ease-out timing from where it is; under reduced motion it
 * is set at once.
 */
export function ProgressRing({ length }: { length: number }) {
  const motion = useMotion();
  const { colors } = useTheme();
  const shown = ring(length);
  const offset = useSharedValue(CIRCUMFERENCE * (1 - shown.progress));
  const target = CIRCUMFERENCE * (1 - shown.progress);
  useEffect(() => {
    // A timing to where it already is would not run (the Reanimated rule): only a change is animated.
    if (Math.abs(offset.value - target) < 0.01) return;
    offset.value = motion.reduced ? target : withTiming(target, motion.timing("easeOut", 120));
  }, [target, motion, offset]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const colour = colors[TONE_TOKEN[TONE[shown.tone]]];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-row items-center gap-1.5">
      {shown.number !== null ? (
        <Text variant="meta" tone={TONE[shown.tone]}>
          {shown.number}
        </Text>
      ) : null}
      <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" stroke={colors["line-low"]} strokeWidth={STROKE} />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          opacity={shown.progress === 0 ? 0 : 1}
          rotation={-90}
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
          animatedProps={props}
        />
      </Svg>
    </View>
  );
}
