/**
 * The faces on web (UI design, section 4.3): korbat's own @font-face rules over the woff2 files of the three
 * @fontsource-variable packages, bundled by Metro into /assets/ (immutable in Caddy, allowed by the policy's font-src
 * 'self'), so no font comes from anyone else's server. Fraunces takes the package's `full` files, which carry the
 * opsz, SOFT and WONK axes; the text face its roman and italic `wght` files; the mono face its roman. Each family has a
 * latin and a latin-ext rule whose unicode-range is copied from the package's own CSS (test/theme.test.ts holds them
 * equal), so latin-ext downloads only when a post needs it. `font-display: swap` with the system stack as the
 * fallback, so text never waits for a font.
 */
export const FONT_FAMILY: { display: string | undefined; text: string | undefined; mono: string | undefined } = {
  display: "Fraunces Variable",
  text: "Atkinson Hyperlegible Next Variable",
  mono: "Atkinson Hyperlegible Mono Variable",
};

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

export interface FontFaceRule {
  family: string;
  style: "normal" | "italic";
  /** The weight range the variable file covers, as the package declares it. */
  weight: string;
  unicodeRange: string;
  /** The file as the package exports it. */
  file: string;
  /**
   * The file's URL in the build. Each require names its file literally, so Metro bundles it; it runs only when the
   * style element is written, so loading this module (as the unit tests do, which have no Metro) reads no font file.
   */
  url: () => unknown;
}

/** The rules, latin-ext before latin within each family and style, in the packages' own order. */
export const FONT_FACES: readonly FontFaceRule[] = [
  {
    family: "Fraunces Variable",
    style: "normal",
    weight: "100 900",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/fraunces/files/fraunces-latin-ext-full-normal.woff2",
    url: () => require("@fontsource-variable/fraunces/files/fraunces-latin-ext-full-normal.woff2"),
  },
  {
    family: "Fraunces Variable",
    style: "normal",
    weight: "100 900",
    unicodeRange: LATIN,
    file: "@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2",
    url: () => require("@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "italic",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-italic.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-italic.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Next Variable",
    style: "italic",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Mono Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN_EXT,
    file: "@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-ext-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-ext-wght-normal.woff2"),
  },
  {
    family: "Atkinson Hyperlegible Mono Variable",
    style: "normal",
    weight: "200 800",
    unicodeRange: LATIN,
    file: "@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2",
    url: () => require("@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2"),
  },
];

/** On web Metro's require of a font yields its URL as a string; an object carrying `uri` is read too, should that change. */
function urlOf(asset: unknown): string {
  if (typeof asset === "string") return asset;
  const uri = (asset as { uri?: unknown } | null)?.uri;
  return typeof uri === "string" ? uri : String(asset);
}

/** The @font-face rules, each file named by the URL `urlFor` gives it. */
export function fontFaceCss(urlFor: (face: FontFaceRule) => string = (face) => urlOf(face.url())): string {
  return FONT_FACES.map((face) =>
    [
      "@font-face {",
      `font-family: "${face.family}";`,
      `font-style: ${face.style};`,
      "font-display: swap;",
      `font-weight: ${face.weight};`,
      `src: url("${urlFor(face)}") format("woff2-variations");`,
      `unicode-range: ${face.unicodeRange};`,
      "}",
    ].join(" "),
  ).join(" ");
}

const STYLE_ID = "korbat-fonts";

/**
 * The rule a toast takes under korbat's own "Reduce motion: Always" (UI design, section 5.4): toast.web.tsx gives each
 * toast the class, and the toast fades instead of moving. It rides in this style element, the one korbat writes.
 */
export const STILL_RULE = ".k-still { transform: none !important; transition: opacity 150ms ease !important; }";

/** Adds the one style element with the rules, once; the browser downloads a file only when text needs it. */
export function installFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${fontFaceCss()} ${STILL_RULE}`;
  document.head.appendChild(style);
}
