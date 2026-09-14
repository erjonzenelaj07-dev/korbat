import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { TextLink } from "@/components/ui";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/terms";

export default function Terms() {
  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          korbat terms
        </Text>
        <Text className="mt-2 text-sm text-zinc-500">Version {TERMS_VERSION}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} className="mt-8">
            <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-100">
              {section.title}
            </Text>
            <Text className="mt-2 text-base leading-7 text-zinc-300">{section.body}</Text>
          </View>
        ))}
        <TextLink label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
    </ScrollView>
  );
}
