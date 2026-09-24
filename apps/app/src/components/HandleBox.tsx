import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

/** Opens a profile by handle. The only discovery tool until explore (2c) arrives. */
export function HandleBox() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const handle = value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError("Handles are 3 to 20 letters, numbers or underscores.");
      return;
    }
    setError(null);
    setValue("");
    router.push(`/u/${handle}`);
  }

  return (
    <View>
      <Text className="text-sm font-medium text-zinc-300">Go to a profile</Text>
      <View className="mt-2 flex-row gap-2">
        <TextInput
          accessibilityLabel="Handle"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="@handle"
          placeholderTextColor="#a1a1aa"
          returnKeyType="go"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={go}
          className="flex-1 rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-2 text-base text-zinc-50"
        />
        <Pressable accessibilityRole="button" onPress={go} className="justify-center rounded-lg bg-zinc-50 px-3">
          <Text className="text-sm font-semibold text-zinc-950">Open</Text>
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
