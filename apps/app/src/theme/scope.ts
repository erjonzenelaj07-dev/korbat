import { vars } from "nativewind";
import { themeVariables, type ThemeName } from "./tokens";

/**
 * On iOS and Android the token classes read `--k-<token>` variables, which NativeWind's vars() sets on a View and its
 * subtree (UI design, section 4.2): ThemeProvider sets the reader's theme at the root, and a forced Dark scope such as
 * the lightbox's stage sets Dark on its own View. The web build takes scope.web.ts, where global.css and the html
 * class do this work, so neither the web bundle's theme nor the unit tests (which run in Node with no native modules)
 * load NativeWind's runtime from here.
 */
export function scopeStyle(theme: ThemeName): ReturnType<typeof vars> | undefined {
  return vars(themeVariables(theme));
}
