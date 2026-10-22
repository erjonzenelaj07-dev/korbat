import { Pressable, View } from "react-native";
import { cn } from "@/theme/cn";
import type { ToastTone } from "@/lib/toast-rules";
import { Icon } from "./kit/Icon";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

/**
 * One toast as korbat draws it (UI design, sections 4.6, 5.4 and 6.16), the same on web (sonner) and native
 * (sonner-native), which place, stack, time and swipe it: a floating surface-1 card with a line-high border and no
 * shadow, the done icon in ink-high (a success is never green, section 4.8) or the error icon for a rollback, the
 * sentence, and at most one action, a 44 px button in the accent's ink. Under forced colours the border is CanvasText,
 * so the card keeps its edge when the browser removes backgrounds.
 */
export function ToastCard({ message, tone = "done", action, onAction }: { message: string; tone?: ToastTone; action?: string; onAction?: () => void }) {
  return (
    <View className="min-h-[56px] w-full flex-row items-center gap-3 rounded-card border border-line-high bg-surface-1 py-1.5 pl-4 pr-1.5 web:forced-colors:border-[color:CanvasText]">
      <Icon name={tone === "rollback" ? "error" : "done"} size={20} tone={tone === "rollback" ? "danger" : "high"} />
      <Text className="flex-1 py-2.5">{message}</Text>
      {action !== undefined && onAction !== undefined ? (
        <Pressable accessibilityRole="button" onPress={onAction} className={cn("min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}>
          <Text variant="body-strong" tone="accent">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
