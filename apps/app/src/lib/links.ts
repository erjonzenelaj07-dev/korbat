import { Platform } from "react-native";

/**
 * Props that make a Text an anchor to an outside page on the web: react-native-web renders `href`
 * as a real link, and `hrefAttrs` opens it in a new tab without handing that tab a reference to
 * this one. Native has no anchors, so the caller keeps its `onPress` there.
 */
export function externalLink(url: string): object {
  return Platform.OS === "web" ? { href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : {};
}
