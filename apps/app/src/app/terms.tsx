import { View } from "react-native";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Heading, Paragraph } from "@/components/Prose";
import { TextLink } from "@/components/ui";
import { CONTACT_EMAIL, reportHref } from "@/lib/moderation";
import { CONTACT_WORDS } from "@/lib/moderation-words";
import { usePageTitle } from "@/lib/page-title";
import { RULES_PAGE, TRANSPARENCY_PAGE } from "@/lib/public-pages";
import { TERMS_PAGE, TERMS_SECTIONS, TERMS_VERSION, termsParagraphs } from "@/lib/terms";

/**
 * The terms (UI design, section 8.9; UI Task 7): outside the app's shell, in PublicFrame's wide column (640 px), so they
 * read as a document: the title in the display face, the version under it, each section under its level-2 heading with
 * its paragraphs at the post's size, then Contact, the two public pages and the report form. The frame adds the
 * wordmark above and its own links to the public pages below, after the page's.
 */
export default function Terms() {
  const title = usePageTitle("title.terms");
  return (
    <PublicFrame wide>
      {title}
      <View className="pb-10 pt-2">
        <Text as="h1" variant="display-2">
          {TERMS_PAGE.title}
        </Text>
        <Text variant="meta" tone="low" className="mt-2">
          {TERMS_PAGE.version(TERMS_VERSION)}
        </Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title}>
            <Heading level={2}>{section.title}</Heading>
            {/* A long section is several paragraphs; each is an element of its own, so a reader gets them apart. */}
            {termsParagraphs(section.body).map((paragraph, index) => (
              <Paragraph key={index}>{paragraph}</Paragraph>
            ))}
          </View>
        ))}
        {/* Not one of the terms' sections: the users' contact address is the build's (3c design, section 9). */}
        <Heading level={2}>{CONTACT_WORDS.title}</Heading>
        <Paragraph>{CONTACT_WORDS.body(CONTACT_EMAIL)}</Paragraph>
        {/* 3d (design, section 9.1): the two public pages, under the sections and above the report form's link. */}
        <TextLink label={TRANSPARENCY_PAGE.rulesLink} href="/rules" />
        <TextLink label={RULES_PAGE.transparencyLink} href="/transparency" />
        {/* The report form needs no account and no item to start from. */}
        <TextLink label={CONTACT_WORDS.report} href={reportHref()} />
        <TextLink label={TERMS_PAGE.back} href="/" replace />
      </View>
    </PublicFrame>
  );
}
