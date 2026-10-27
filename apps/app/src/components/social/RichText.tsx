import { Linking, Platform, Text as Inline } from "react-native";
import { Link } from "expo-router";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text, type TextVariant } from "@/components/kit/Text";
import { POST_LINK_REL, externalLink } from "@/lib/links";

/** Links and @handles become real links; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

/**
 * A link inside running text (UI design, sections 4.4 and 6.6): accent-ink, which against the body's ink is under 3:1, so
 * a web link is also underlined, 1 px at a 2 px offset, thicker under a fine pointer; a mention keeps its "@" as its cue.
 * Its padding makes it at least 24 px tall (WCAG 2.5.8's inline target) without moving the line, since padding on an
 * inline box does not change the line's height.
 */
const INLINE = `rounded-sm py-1 ${FOCUS_RING}`;
const UNDERLINED = "underline decoration-1 underline-offset-2 web:hover:decoration-2";

/**
 * A post's words (or a quoted post's, in the body variant), with its links and mentions as real anchors. The pieces are
 * React Native's own Text inside the kit's, so they take its face, size and step and change only their colour.
 *
 * 3b Task 7 (design, sections 5.3 and 10.6, decision 21): `mentions` false keeps every @name as plain text, for an
 * imported post, whose names belong to another platform and must never link to the korbat account that happens to hold
 * the same handle; and every outside link carries POST_LINK_REL.
 */
export function RichText({ body, variant = "post", mentions = true }: { body: string; variant?: TextVariant; mentions?: boolean }) {
  const parts = body.split(TOKEN);
  return (
    <Text variant={variant}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Inline key={index} className={`text-accent-ink ${UNDERLINED} ${INLINE}`} {...externalLink(part, POST_LINK_REL)} onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(part)}>
              {part}
            </Inline>
          );
        }
        if (mentions && /^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Link key={index} href={`/u/${part.slice(1).toLowerCase()}`} asChild>
              <Inline className={`text-accent-ink web:hover:underline ${INLINE}`}>{part}</Inline>
            </Link>
          );
        }
        return <Inline key={index}>{part}</Inline>;
      })}
    </Text>
  );
}
