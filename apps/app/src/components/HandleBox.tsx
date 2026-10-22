import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useAppearance } from "@/lib/appearance";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./kit/Icon";
import { FOCUS_RING } from "./kit/interaction";
import { Text, textStyle } from "./kit/Text";

/**
 * Opens a profile by handle, for an account whose handle is already known (UI design, section 7.3): the first thing in
 * the context column, above How korbat works. Explore (2c) is the way to come across posts and accounts; search stays
 * out. The handle is typed in the mono face, so look-alike handles stay apart.
 */
export function HandleBox() {
  const theme = useTheme();
  const appearance = useAppearance();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const handle = value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError(UI_WORDS["handle.invalid"]);
      return;
    }
    setError(null);
    setValue("");
    router.push(`/u/${handle}`);
  }

  return (
    <View className="gap-2">
      <Text variant="body-strong" tone="medium">
        {UI_WORDS["handle.title"]}
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          accessibilityLabel={UI_WORDS["handle.field"]}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={UI_WORDS["handle.placeholder"]}
          // The placeholder is ink-low on surface-1, at least 6.29:1 in every theme (section 4.2).
          placeholderTextColor={theme.colors["ink-low"]}
          returnKeyType="go"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={go}
          className={cn("min-h-[44px] flex-1 rounded-control border border-line-high bg-surface-1 px-3 text-ink-high", FOCUS_RING)}
          style={textStyle("mono", { step: appearance.textStep, font: appearance.font })}
        />
        <Pressable accessibilityRole="button" onPress={go} className={cn("min-h-[44px] justify-center rounded-control border border-line-high bg-surface-1 px-4 active:bg-surface-2 web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]", FOCUS_RING)}>
          <Text variant="body-strong">{UI_WORDS["handle.open"]}</Text>
        </Pressable>
      </View>
      {error ? (
        <View accessibilityRole="alert" className="flex-row items-start gap-2">
          <View className="pt-[2px]">
            <Icon name="error" size={16} tone="danger" />
          </View>
          <Text variant="meta" tone="danger" className="shrink">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
