import type { ReactNode } from "react";
import { Linking, Platform, Text as Inline } from "react-native";
import { Link } from "expo-router";
import { MENTION_TOKEN } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text, type TextVariant } from "@/components/kit/Text";
import { POST_LINK_REL, externalLink } from "@/lib/links";

/** Outside links become real links; everything else is plain text. Bodies are never rendered as markup. */
const URL_TOKEN = /(https?:\/\/[^\s<>"']+)/g;

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
 * React Native's own Text inside the kit's, so they take its face, size and step and change only their colour. Every
 * outside link carries POST_LINK_REL (3b, decision 21).
 *
 * 2d (design, sections 4.3 and 4.5): `mentions` is the post's own list, the handles the API stored that link for this
 * reader (PostView.mentions). A token of the contracts' MENTION_TOKEN, with its right boundary, links to /u/<handle>,
 * in accent ink with its "@" and no underline, exactly when its lowercased handle is in that list; any other @name stays
 * plain text: one not stored, one renamed or blocked since, and every one of an imported post, whose list is empty. The
 * text is never rewritten. The token's one capture group is the handle, so split() hands each handle back between the
 * text around it; a fresh copy is made, since the contracts' object carries the g flag and its place.
 */
export function RichText({ body, variant = "post", mentions = [] }: { body: string; variant?: TextVariant; mentions?: readonly string[] }) {
  const pieces: ReactNode[] = [];
  body.split(URL_TOKEN).forEach((part, index) => {
    if (index % 2 === 1) {
      pieces.push(
        <Inline key={`u${index}`} className={`text-accent-ink ${UNDERLINED} ${INLINE}`} {...externalLink(part, POST_LINK_REL)} onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(part)}>
          {part}
        </Inline>,
      );
      return;
    }
    part.split(new RegExp(MENTION_TOKEN.source, "g")).forEach((piece, at) => {
      const key = `t${index}-${at}`;
      if (at % 2 === 0) {
        if (piece !== "") pieces.push(<Inline key={key}>{piece}</Inline>);
        return;
      }
      const handle = piece.toLowerCase();
      pieces.push(
        mentions.includes(handle) ? (
          <Link key={key} href={`/u/${handle}`} asChild>
            <Inline className={`text-accent-ink web:hover:underline ${INLINE}`}>{`@${piece}`}</Inline>
          </Link>
        ) : (
          <Inline key={key}>{`@${piece}`}</Inline>
        ),
      );
    });
  });
  return <Text variant={variant}>{pieces}</Text>;
}
