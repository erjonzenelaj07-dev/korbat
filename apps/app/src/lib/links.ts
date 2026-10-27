import { Platform } from "react-native";

/**
 * Props that make a Text an anchor to an outside page on the web: react-native-web renders `href`
 * as a real link, and `hrefAttrs` opens it in a new tab without handing that tab a reference to
 * this one. Native has no anchors, so the caller keeps its `onPress` there. `rel` is the link's
 * relation, "noopener noreferrer" unless the caller names its own (3b Task 7: a post's words).
 */
export function externalLink(url: string, rel = "noopener noreferrer"): object {
  return Platform.OS === "web" ? { href: url, hrefAttrs: { target: "_blank", rel } } : {};
}

/**
 * 3b (design, decision 21; Task 7): the relation of every link in a post's words, native or imported: written by an
 * account (ugc), vouched for by nobody (nofollow), opened without a reference back (noopener), and sending no referrer
 * (noreferrer), so the page a post links to does not learn which korbat page it was read on.
 */
export const POST_LINK_REL = "nofollow ugc noopener noreferrer";
