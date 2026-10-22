import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The compose button (UI design, sections 4.6, 7.2 and 7.3): a 56 px accent circle with the compose icon, named
 * "New post" (pinned). It floats over a phone's Home, profile and Bookmarks, and stands under the rail's items from
 * 768 px. Flat: no shadow, but a 2 px ring in the page's surface colour that parts it from whatever scrolls under it, and
 * in forced colours a 1 px CanvasText border, so it keeps its shape when the browser drops backgrounds. It scales to 0.92
 * from pointer-down, as an icon button does (5.2). data-compose marks it for the browser check.
 */
export function ComposeButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.92);
  return (
    <Animated.View style={press.style}>
      <Pressable
        {...dataAttribute("compose")}
        accessibilityRole="button"
        accessibilityLabel={UI_WORDS["composer.newPost"]}
        onPress={onPress}
        {...press.handlers}
        {...pressDelay(0)}
        className={cn(
          "h-14 w-14 items-center justify-center rounded-full border-2 border-surface bg-accent web:transition-colors web:duration-[120ms] web:hover:bg-accent/90 web:forced-colors:border web:forced-colors:border-[color:CanvasText]",
          FOCUS_RING,
        )}
      >
        <Icon name="compose" size={24} tone="on-accent" />
      </Pressable>
    </Animated.View>
  );
}

/**
 * The full nav's New post (7.1, 7.3): a full-width primary button with the compose icon and its words, a pill like the
 * nav's items, 48 px tall.
 */
export function NewPostButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.97);
  return (
    <View className="self-stretch">
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          {...press.handlers}
          {...pressDelay(0)}
          className={cn(
            "min-h-[48px] flex-row items-center justify-center gap-2 rounded-full border border-accent bg-accent px-4 web:transition-colors web:duration-[120ms] web:hover:bg-accent/90 web:forced-colors:border-[color:CanvasText]",
            FOCUS_RING,
          )}
        >
          <Icon name="compose" size={20} tone="on-accent" />
          <Text variant="body-strong" tone="on-accent" className="shrink text-center">
            {UI_WORDS["composer.newPost"]}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
