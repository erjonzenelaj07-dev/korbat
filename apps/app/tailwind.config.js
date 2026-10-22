/**
 * korbat's colour tokens, as src/theme/tokens.ts names them (UI design, section 4.2): each class reads the theme's
 * `--k-<token>` triplet from global.css, so `bg-surface-1` or `text-ink-low` switches with the theme and still takes
 * an opacity (`bg-accent/40`). test/contrast.test.ts holds this list to the tokens.
 */
const TOKENS = [
  "surface",
  "surface-1",
  "surface-2",
  "line-low",
  "line-high",
  "ink-high",
  "ink-medium",
  "ink-low",
  "accent",
  "on-accent",
  "accent-ink",
  "accent-wash",
  "focus",
  "danger",
  "on-danger",
  "danger-ink",
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
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  // "class" (not the default "media"): the theme is switched by the app, and NativeWind's web
  // runtime throws in dev mode under "media" when Metro injects the stylesheet.
  darkMode: "class",
  presets: [require("nativewind/preset")],
  // Hover styles apply only where the pointer can hover (UI design, section 5.2): every hover: class is wrapped in
  // @media (hover: hover) and (pointer: fine), so a tap on a touch screen never leaves a row or a button washed.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: Object.fromEntries(TOKENS.map((token) => [token, `rgb(var(--k-${token}) / <alpha-value>)`])),
      // Radius says what kind of thing a shape is (section 4.5): controls, media, cards, sheets, and round things.
      borderRadius: { control: "10px", media: "12px", card: "16px", sheet: "24px", full: "9999px" },
    },
  },
  plugins: [],
};
