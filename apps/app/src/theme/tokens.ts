/**
 * korbat's colours, the one place in src that holds them (UI design, section 4.2). A name says what a colour is for
 * and how much contrast it carries, never its hue, so a screen asks for `ink-low` and gets a colour that reads on
 * every surface of every theme. global.css carries the same values as `--k-<token>` triplets for the classes, and
 * public/theme-boot.js carries each theme's surface and ink-high for the first paint; test/contrast.test.ts holds
 * both to THEMES and every pair below to its minimum.
 */

/** The three themes: Light ("Day"), Dim ("Dusk") and Dark ("Night"), the raven's ink. */
export type ThemeName = "light" | "dim" | "dark";

export const THEME_NAMES: readonly ThemeName[] = ["light", "dim", "dark"];

export const COLOR_TOKENS = [
  // Surfaces: the page, a raised layer (cards that float, sheets, menus, inputs), and pressed or selected rows.
  "surface",
  "surface-1",
  "surface-2",
  // Lines: dividers with no contrast duty, and the boundary of a control (at least 3:1, WCAG 1.4.11).
  "line-low",
  "line-high",
  // Ink: primary, secondary and tertiary text; the tertiary is the floor, at least 4.5:1 on every surface.
  "ink-high",
  "ink-medium",
  "ink-low",
  // The one accent, the raven's violet sheen, for what the reader can do and has done, and nothing else.
  "accent",
  "on-accent",
  "accent-ink",
  "accent-wash",
  "focus",
  // Destructive buttons and error sentences.
  "danger",
  "on-danger",
  "danger-ink",
  // Status, each as text on a surface, a chip's background, and text on that background (section 4.8).
  "review-ink",
  "review-wash",
  "review-on-wash",
  "restricted-ink",
  "restricted-wash",
  "restricted-on-wash",
  "verified-ink",
  "verified-wash",
  "verified-on-wash",
  "explore-ink",
  "explore-wash",
  "explore-on-wash",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const THEMES: Record<ThemeName, Record<ColorToken, string>> = {
  light: {
    surface: "#F6F5F9",
    "surface-1": "#FFFFFF",
    "surface-2": "#ECEAF1",
    "line-low": "#DDDAE4",
    "line-high": "#827C90",
    "ink-high": "#15131B",
    "ink-medium": "#45404F",
    "ink-low": "#625D6E",
    accent: "#5A33D6",
    "on-accent": "#FFFFFF",
    "accent-ink": "#5A33D6",
    "accent-wash": "#ECE6FF",
    focus: "#5A33D6",
    danger: "#C2261B",
    "on-danger": "#FFFFFF",
    "danger-ink": "#B42318",
    "review-ink": "#8A4B00",
    "review-wash": "#FCEFD2",
    "review-on-wash": "#6B3A00",
    "restricted-ink": "#B42318",
    "restricted-wash": "#FDE4E1",
    "restricted-on-wash": "#8A1C12",
    "verified-ink": "#1F55C7",
    "verified-wash": "#E0EAFD",
    "verified-on-wash": "#173F94",
    "explore-ink": "#0B7350",
    "explore-wash": "#DAF3E8",
    "explore-on-wash": "#075A3E",
  },
  dim: {
    surface: "#1B1A24",
    "surface-1": "#24232F",
    "surface-2": "#2F2D3B",
    "line-low": "#3A3848",
    "line-high": "#807B93",
    "ink-high": "#F1EFF6",
    "ink-medium": "#CCC8D8",
    "ink-low": "#A8A3B8",
    accent: "#B9A6FF",
    "on-accent": "#170E33",
    "accent-ink": "#B9A6FF",
    "accent-wash": "#332C55",
    focus: "#B9A6FF",
    danger: "#D13438",
    "on-danger": "#FFFFFF",
    "danger-ink": "#FF8A80",
    "review-ink": "#F5B83D",
    "review-wash": "#3A2D17",
    "review-on-wash": "#FAD27A",
    "restricted-ink": "#FF8A80",
    "restricted-wash": "#3D1A1F",
    "restricted-on-wash": "#FFB4AC",
    "verified-ink": "#78B0FF",
    "verified-wash": "#1A2A45",
    "verified-on-wash": "#B0CEFF",
    "explore-ink": "#4BD9A2",
    "explore-wash": "#123328",
    "explore-on-wash": "#93EDC9",
  },
  dark: {
    surface: "#100F16",
    "surface-1": "#18171F",
    "surface-2": "#22202B",
    "line-low": "#2B2935",
    "line-high": "#726D82",
    "ink-high": "#F3F1F7",
    "ink-medium": "#C7C2D3",
    "ink-low": "#9C97AB",
    accent: "#B4A0FF",
    "on-accent": "#170E33",
    "accent-ink": "#B4A0FF",
    "accent-wash": "#251E42",
    focus: "#B4A0FF",
    danger: "#D13438",
    "on-danger": "#FFFFFF",
    "danger-ink": "#FF7B72",
    "review-ink": "#F5B83D",
    "review-wash": "#2E2310",
    "review-on-wash": "#FAD27A",
    "restricted-ink": "#FF7B72",
    "restricted-wash": "#331418",
    "restricted-on-wash": "#FFADA6",
    "verified-ink": "#6AA8FF",
    "verified-wash": "#12213A",
    "verified-on-wash": "#A5C8FF",
    "explore-ink": "#3DD39A",
    "explore-wash": "#0C2A20",
    "explore-on-wash": "#86EBC3",
  },
};

/**
 * Colours that are the same in every theme: the scrim behind sheets and dialogs, the badge under the white text of
 * the ALT and count badges on images, and the lightbox's stage, which stays near-black so images are seen as they are
 * (section 6.7). Each is black at an opacity, given as [red, green, blue, alpha].
 */
export const FIXED_COLOURS = {
  scrim: [0, 0, 0, 0.6],
  "media-badge": [0, 0, 0, 0.72],
  stage: [0, 0, 0, 0.94],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * A foreground and the background it is drawn on, with the least contrast ratio the pair must keep in every theme:
 * 4.5 for text, 3 for control boundaries, the focus ring and filled controls against the page (WCAG 2.2, 1.4.3 and
 * 1.4.11). `forced` marks a pair inside a forced Dark scope (the lightbox's stage): its foreground takes the Dark
 * value whatever the theme, and its background is the fixed colour `over` laid on the theme's own `bg`.
 */
export interface TextPair {
  fg: ColorToken;
  bg: ColorToken;
  min: 4.5 | 3;
  forced?: { theme: ThemeName; over: keyof typeof FIXED_COLOURS };
}

/** Every pair the app draws text or controls with (section 4.2's table, in its order). */
export const TEXT_PAIRS: readonly TextPair[] = [
  { fg: "ink-high", bg: "surface", min: 4.5 },
  { fg: "ink-high", bg: "surface-1", min: 4.5 },
  { fg: "ink-high", bg: "surface-2", min: 4.5 },
  { fg: "ink-medium", bg: "surface", min: 4.5 },
  { fg: "ink-medium", bg: "surface-1", min: 4.5 },
  { fg: "ink-medium", bg: "surface-2", min: 4.5 },
  { fg: "ink-low", bg: "surface", min: 4.5 },
  { fg: "ink-low", bg: "surface-1", min: 4.5 },
  { fg: "ink-low", bg: "surface-2", min: 4.5 },
  { fg: "accent-ink", bg: "surface", min: 4.5 },
  { fg: "accent-ink", bg: "surface-1", min: 4.5 },
  { fg: "accent-ink", bg: "surface-2", min: 4.5 },
  { fg: "danger-ink", bg: "surface", min: 4.5 },
  { fg: "danger-ink", bg: "surface-1", min: 4.5 },
  { fg: "danger-ink", bg: "surface-2", min: 4.5 },
  { fg: "review-ink", bg: "surface", min: 4.5 },
  { fg: "review-ink", bg: "surface-1", min: 4.5 },
  { fg: "review-ink", bg: "surface-2", min: 4.5 },
  { fg: "restricted-ink", bg: "surface", min: 4.5 },
  { fg: "restricted-ink", bg: "surface-1", min: 4.5 },
  { fg: "restricted-ink", bg: "surface-2", min: 4.5 },
  { fg: "verified-ink", bg: "surface", min: 4.5 },
  { fg: "verified-ink", bg: "surface-1", min: 4.5 },
  { fg: "verified-ink", bg: "surface-2", min: 4.5 },
  { fg: "explore-ink", bg: "surface", min: 4.5 },
  { fg: "explore-ink", bg: "surface-1", min: 4.5 },
  { fg: "explore-ink", bg: "surface-2", min: 4.5 },
  { fg: "ink-high", bg: "accent-wash", min: 4.5 },
  { fg: "accent-ink", bg: "accent-wash", min: 4.5 },
  { fg: "on-accent", bg: "accent", min: 4.5 },
  { fg: "on-danger", bg: "danger", min: 4.5 },
  { fg: "review-on-wash", bg: "review-wash", min: 4.5 },
  { fg: "restricted-on-wash", bg: "restricted-wash", min: 4.5 },
  { fg: "verified-on-wash", bg: "verified-wash", min: 4.5 },
  { fg: "explore-on-wash", bg: "explore-wash", min: 4.5 },
  { fg: "line-high", bg: "surface", min: 3 },
  { fg: "line-high", bg: "surface-1", min: 3 },
  { fg: "focus", bg: "surface", min: 3 },
  { fg: "focus", bg: "surface-1", min: 3 },
  // The lightbox's stage over the page: the Dark focus ring on near-black laid over each theme's page.
  { fg: "focus", bg: "surface", min: 3, forced: { theme: "dark", over: "stage" } },
  { fg: "accent", bg: "surface", min: 3 },
  { fg: "accent", bg: "surface-1", min: 3 },
  { fg: "danger", bg: "surface", min: 3 },
  { fg: "danger", bg: "surface-1", min: 3 },
];

/** "#RRGGBB" as its three channels, 0 to 255. */
export function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A theme as the `--k-<token>` variables global.css declares: each colour as "R G B", so a class can add its alpha. */
export function themeVariables(theme: ThemeName): Record<`--k-${string}`, string> {
  const out: Record<`--k-${string}`, string> = {};
  for (const token of COLOR_TOKENS) out[`--k-${token}`] = channels(THEMES[theme][token]).join(" ");
  return out;
}
