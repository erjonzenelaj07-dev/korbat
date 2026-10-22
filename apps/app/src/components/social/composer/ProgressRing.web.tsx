import { View } from "react-native";
import { TONE_CLASS, Text } from "@/components/kit/Text";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { MOTION } from "@/theme/motion";
import { ring, type RingTone } from "./state";

/** The ring's geometry: 20 px across, a 2 px stroke, so its circle has a radius of 9. */
export const RING_SIZE = 20;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE: Record<RingTone, "accent" | "review-ink" | "danger"> = { accent: "accent", "review-ink": "review-ink", danger: "danger" };

/**
 * The ring of the composer's count on the web (UI design, sections 5.2 and 6.15): a 20 px circle that fills with the
 * count, in the accent, review-ink from 900 characters and danger-ink past 1000, and beside it the number left once 100
 * or fewer remain ("12", then "-3" over the limit). Drawn as a DOM svg, as Icon.web.tsx draws its icons, so the web
 * bundle never loads react-native-svg; its colour is the tone's class through currentColor. The dash offset follows the
 * count over 120 ms ease-out and retargets from where it is; under reduced motion it changes at once. It is decoration:
 * the field's description says the count in words.
 */
export function ProgressRing({ length }: { length: number }) {
  const motion = useMotion();
  const shown = ring(length);
  const tone = TONE_CLASS[TONE[shown.tone]];
  const easing = `cubic-bezier(${MOTION.easeOut.easing.join(", ")})`;
  return (
    <View aria-hidden className="flex-row items-center gap-1.5">
      {shown.number !== null ? (
        <Text variant="meta" tone={TONE[shown.tone]} className="web:tabular-nums">
          {shown.number}
        </Text>
      ) : null}
      <svg data-ring="" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" focusable="false" className={tone}>
        {/* The track, in the line colour, so the ring's whole shape shows while it is nearly empty. */}
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-line-low" />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown.progress)}
          // From the top, clockwise.
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          className={cn(shown.progress === 0 ? "opacity-0" : undefined)}
          style={{ transition: motion.reduced ? "none" : `stroke-dashoffset 120ms ${easing}, color 120ms ${easing}` }}
        />
      </svg>
    </View>
  );
}
