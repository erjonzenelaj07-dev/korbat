import { ScrollView, Text, View } from "react-native";

import { TextLink } from "@/components/ui";
import { CONTACT_EMAIL, reportHref } from "@/lib/moderation";
import { CONTACT_WORDS } from "@/lib/moderation-words";
import { TERMS_SECTIONS, TERMS_VERSION, termsParagraphs } from "@/lib/terms";

export default function Terms() {
  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          korbat terms
        </Text>
        <Text className="mt-2 text-sm text-zinc-400">Version {TERMS_VERSION}</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} className="mt-8">
            <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
              {section.title}
            </Text>
            {/* A long section is several paragraphs; each is an element of its own, so a reader gets them apart. */}
            {termsParagraphs(section.body).map((paragraph, index) => (
              <Text key={index} className="mt-2 text-base leading-7 text-zinc-300">
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
        {/* Not one of the terms' sections: the users' contact address is the build's (3c design, section 9). */}
        <View className="mt-8">
          <Text accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-100">
            {CONTACT_WORDS.title}
          </Text>
          <Text className="mt-2 text-base leading-7 text-zinc-300">{CONTACT_WORDS.body(CONTACT_EMAIL)}</Text>
        </View>
        {/* The report form needs no account and no item to start from. */}
        <TextLink label={CONTACT_WORDS.report} href={reportHref()} />
        <TextLink label="Back to korbat" href="/" replace />
      </View>
    </ScrollView>
  );
}
