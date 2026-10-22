import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Platform, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import { resolveTheme, useAppearance, type Appearance } from "@/lib/appearance";
import { scopeStyle } from "./scope";
import { THEMES, THEME_NAMES, type ColorToken, type ThemeName } from "./tokens";

/** The theme a screen is drawn in, resolved from the reader's choice and, under System, the operating system's. */
export interface Theme {
  name: ThemeName;
  colors: Record<ColorToken, string>;
  /** The scheme the browser draws its own controls and scrollbars in. */
  scheme: "light" | "dark";
  /** The human check's widget: light in Light, dark in Dim and Dark (UI design, section 4.2). */
  turnstile: "light" | "dark";
}

/** One object per theme, so a screen that compares themes sees the same object while the theme stays. */
const RESOLVED = Object.fromEntries(
  THEME_NAMES.map((name) => {
    const scheme = name === "light" ? "light" : "dark";
    return [name, { name, colors: THEMES[name], scheme, turnstile: scheme }];
  }),
) as Record<ThemeName, Theme>;

/**
 * The current theme. It reads the appearance store and the system's scheme itself, so it works with no ThemeProvider
 * around it: the unit tests render screens such as ReportForm on their own, and every answer is the same either way.
 */
export function useTheme(): Theme {
  const forced = useContext(Forced);
  const appearance = useAppearance();
  const system = useColorScheme();
  return RESOLVED[forced ?? resolveTheme(appearance, system)];
}

/** The theme a ThemeScope forces on what it holds, or null outside any. */
const Forced = createContext<ThemeName | null>(null);

/**
 * A part of the screen drawn in one theme whatever the reader's (UI design, section 6.7): the lightbox's stage is a forced
 * Dark scope, so its ink, buttons and focus ring always take the Dark values over its near-black (the Light focus colour
 * there would be 2.63:1). On the web the class names the theme, which global.css's blocks match; on iOS and Android its
 * View carries the theme's vars(); and useTheme() inside answers that theme, so the native icons, whose colours are hex
 * values from it rather than classes, follow too.
 */
export function ThemeScope({ theme, style, children }: { theme: ThemeName; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Forced.Provider value={theme}>
      <View className={theme} style={[style, scopeStyle(theme)]}>
        {children}
      </View>
    </Forced.Provider>
  );
}

/**
 * What theme-boot.js did before the bundle, kept true as the reader changes their appearance or the system its scheme:
 * the theme's class on the html element (global.css switches the variables by it), the text step and font for the
 * stylesheet, the scheme for the browser's own controls, the page's colours under everything, and the theme-color meta.
 */
function applyToDocument(theme: Theme, appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of THEME_NAMES) if (name !== theme.name) root.classList.remove(name);
  root.classList.add(theme.name);
  root.setAttribute("data-text-step", appearance.textStep);
  root.setAttribute("data-font", appearance.font);
  root.style.colorScheme = theme.scheme;
  root.style.backgroundColor = theme.colors.surface;
  root.style.color = theme.colors["ink-high"];
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", theme.colors.surface);
}

/**
 * Puts the reader's theme around the app (UI design, section 4.2). On web it keeps the html element in step, as
 * theme-boot.js set it for the first frame, and renders nothing of its own; on iOS and Android it is the root View that
 * carries the theme's variables through NativeWind's vars(), so the same classes resolve on every platform.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const appearance = useAppearance();
  useEffect(() => {
    if (Platform.OS === "web") applyToDocument(theme, appearance);
  }, [theme, appearance]);
  if (Platform.OS === "web") return <>{children}</>;
  return <View style={[{ flex: 1 }, scopeStyle(theme.name)]}>{children}</View>;
}
