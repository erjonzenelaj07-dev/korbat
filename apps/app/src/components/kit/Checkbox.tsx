import type { Ref } from "react";
import { Pressable, View } from "react-native";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./interaction";
import { Text } from "./Text";

/**
 * A statement or a choice the person ticks (3b design, section 10.1; the report form's good-faith statement moved onto
 * it): one control, role checkbox, which says in aria-checked whether it is ticked and is named by its label, its words
 * beside the box. The whole row is the target, 44 px tall at least, with the kit's 2 px focus ring; Space ticks it on the
 * web, as a button presses. The tick is drawn, two sides of a box turned 45 degrees in the colour that reads on the
 * accent, never written as a letter, and the box changes from line-high to the accent fill, so a ticked box differs by
 * shape as well as colour (UI design, section 4.8). `describedBy` ties a line under it to it (a reason, a hint).
 */
export function Checkbox({
  label,
  checked,
  onChange,
  describedBy,
  className,
  ref,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  describedBy?: string;
  className?: string;
  ref?: Ref<View>;
}) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="checkbox"
      aria-checked={checked}
      aria-describedby={describedBy}
      onPress={() => onChange(!checked)}
      className={cn("min-h-[44px] flex-row items-start gap-3 rounded-control py-2.5", FOCUS_RING, className)}
    >
      <View className={cn("mt-0.5 h-5 w-5 items-center justify-center rounded-[5px] border-2", checked ? "border-accent bg-accent" : "border-line-high bg-surface-1")}>
        {/* The tick: two sides of a box turned 45 degrees, in the colour that reads on the accent. */}
        {checked ? <View className="-mt-0.5 h-2.5 w-1.5 border-b-2 border-r-2 border-on-accent" style={{ transform: [{ rotate: "45deg" }] }} /> : null}
      </View>
      <Text className="flex-1">{label}</Text>
    </Pressable>
  );
}
