import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { COLOR_TOKENS, FIXED_COLOURS, TEXT_PAIRS, THEME_NAMES, THEMES, channels, type ThemeName } from "@/theme/tokens";
import { runThemeBoot } from "./boot";
import { LEGACY_COLOUR_FILES, sourceFiles } from "./legacy-files";

/**
 * korbat's colours are one table (src/theme/tokens.ts) and must stay readable (UI design, section 4.2): every pair the
 * app draws with keeps its minimum ratio in every theme, the stylesheet's variables and the first paint's colours are
 * the table's own values, and no screen paints with a colour that is not a token, except the files still listed as
 * not yet converted.
 */
const APP = path.resolve(import.meta.dirname, "..");

type Rgb = readonly [number, number, number];

/** The relative luminance of an sRGB colour, WCAG 2.2's formula. */
function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of two colours, lighter over darker, from 1 to 21. */
function ratio(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** A fixed colour laid over an opaque one, as the screen shows it: blended per channel and rounded to the 8 bits a pixel holds. */
function over([r, g, b, alpha]: readonly [number, number, number, number], under: Rgb): Rgb {
  const blend = (top: number, bottom: number): number => Math.round(top * alpha + bottom * (1 - alpha));
  return [blend(r, under[0]), blend(g, under[1]), blend(b, under[2])];
}

/** The ratio a pair keeps in one theme. */
function pairRatio(theme: ThemeName, pair: (typeof TEXT_PAIRS)[number]): number {
  if (pair.forced) {
    const foreground = channels(THEMES[pair.forced.theme][pair.fg]);
    return ratio(foreground, over(FIXED_COLOURS[pair.forced.over], channels(THEMES[theme][pair.bg])));
  }
  return ratio(channels(THEMES[theme][pair.fg]), channels(THEMES[theme][pair.bg]));
}

describe("the colour tokens", () => {
  test("every theme gives every token a six-digit hex colour", () => {
    for (const theme of THEME_NAMES) {
      expect(Object.keys(THEMES[theme]).sort(), theme).toEqual([...COLOR_TOKENS].sort());
      for (const token of COLOR_TOKENS) expect(THEMES[theme][token], `${theme} ${token}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("every pair the app draws with keeps its minimum ratio in Light, Dim and Dark", () => {
    const failing: string[] = [];
    for (const theme of THEME_NAMES) {
      for (const pair of TEXT_PAIRS) {
        const found = pairRatio(theme, pair);
        if (found < pair.min) failing.push(`${theme}: ${pair.fg} on ${pair.bg}${pair.forced ? " (forced)" : ""} is ${found.toFixed(2)}, under ${pair.min}`);
      }
    }
    expect(failing).toEqual([]);
    expect(TEXT_PAIRS).toHaveLength(44);
  });

  test("the pairs the design names as the tightest hold the ratios it gives", () => {
    const find = (fg: string, bg: string) => TEXT_PAIRS.find((pair) => pair.fg === fg && pair.bg === bg && !pair.forced)!;
    expect(pairRatio("dim", find("on-danger", "danger")).toFixed(2)).toBe("4.93");
    expect(pairRatio("dark", find("on-danger", "danger")).toFixed(2)).toBe("4.93");
    expect(pairRatio("light", find("explore-ink", "surface-2")).toFixed(2)).toBe("4.91");
    expect(pairRatio("dim", find("danger", "surface-1")).toFixed(2)).toBe("3.14");
    // The lightbox's stage keeps the Dark focus ring readable over every theme's page; Light's own would not be.
    const stage = TEXT_PAIRS.find((pair) => pair.forced)!;
    expect(THEME_NAMES.map((theme) => pairRatio(theme, stage).toFixed(2))).toEqual(["8.59", "9.30", "9.36"]);
    expect(ratio(channels(THEMES.light.focus), over(FIXED_COLOURS.stage, channels(THEMES.light.surface)))).toBeLessThan(3);
  });

  test("white on the media badge over a white image reads at 9.29:1, the worst case", () => {
    expect(ratio([255, 255, 255], over(FIXED_COLOURS["media-badge"], [255, 255, 255])).toFixed(2)).toBe("9.29");
  });
});

/** global.css's blocks of custom properties, by selector, each as token to "R G B". */
function cssBlocks(css: string): Record<string, Record<string, string>> {
  const blocks: Record<string, Record<string, string>> = {};
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim().replace(/\s+/g, " ");
    const values: Record<string, string> = {};
    for (const declaration of match[2]!.matchAll(/--k-([a-z0-9-]+)\s*:\s*([^;]+);/g)) values[declaration[1]!] = declaration[2]!.trim();
    blocks[selector] = values;
  }
  return blocks;
}

describe("the tokens reach the screens", () => {
  test("global.css keeps its three directives and holds each theme as --k-<token> triplets equal to THEMES", () => {
    const css = readFileSync(path.join(APP, "global.css"), "utf8");
    expect(css.match(/^@tailwind \w+;$/gm)).toEqual(["@tailwind base;", "@tailwind components;", "@tailwind utilities;"]);
    const blocks = cssBlocks(css.replace(/^@tailwind \w+;$/gm, ""));
    const selectors: Record<string, ThemeName> = { ":root": "light", ":root.dim": "dim", ":root.dark, .dark": "dark" };
    expect(Object.keys(blocks).sort()).toEqual(Object.keys(selectors).sort());
    for (const [selector, theme] of Object.entries(selectors)) {
      const expected = Object.fromEntries(COLOR_TOKENS.map((token) => [token, channels(THEMES[theme][token]).join(" ")]));
      expect(blocks[selector], selector).toEqual(expected);
    }
  });

  test("tailwind.config.js maps every token to its variable with the alpha placeholder, and keeps class-based dark mode", () => {
    const config = createRequire(path.join(APP, "package.json"))("./tailwind.config.js") as { darkMode: string; theme: { extend: { colors: Record<string, string> } } };
    expect(config.darkMode).toBe("class");
    expect(config.theme.extend.colors).toEqual(Object.fromEntries(COLOR_TOKENS.map((token) => [token, `rgb(var(--k-${token}) / <alpha-value>)`])));
  });

  test("theme-boot.js paints each theme's surface and ink-high, THEMES' values, before the stylesheet arrives", () => {
    for (const theme of THEME_NAMES) {
      const boot = runThemeBoot({ stored: JSON.stringify({ theme }) });
      expect(boot.style.backgroundColor?.toUpperCase(), theme).toBe(THEMES[theme].surface);
      expect(boot.style.color?.toUpperCase(), theme).toBe(THEMES[theme]["ink-high"]);
      expect(boot.themeColor?.toUpperCase(), theme).toBe(THEMES[theme].surface);
    }
  });

  test("index.html's reset, for a browser without scripts, is Dark's surface and ink-high", () => {
    const index = readFileSync(path.join(APP, "public", "index.html"), "utf8");
    expect(index).toContain(`background: ${THEMES.dark.surface};`);
    expect(index).toContain(`color: ${THEMES.dark["ink-high"]};`);
  });
});

/** Tailwind's own palette classes, which the tokens replace: `text-zinc-400`, `bg-sky-950`, `border-t-red-500`. */
const PALETTE_CLASS = /\b(?:text|bg|border(?:-[trblxy])?|divide|ring|outline|placeholder|fill|stroke|decoration|caret|accent|shadow|from|via|to)-(?:zinc|sky|amber|red|emerald|rose|stone)-(?:50|[1-9]00|950)\b/;
/** A hex colour literal: `#fafafa`, `#a1a1aa`, `#fff`. */
const HEX_COLOUR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;

describe("no screen paints with a colour that is not a token", () => {
  test("palette classes and hex colours appear only in theme/tokens.ts and the files not yet converted", () => {
    const painted = sourceFiles().filter((file) => file.name !== "theme/tokens.ts" && (PALETTE_CLASS.test(file.text) || HEX_COLOUR.test(file.text)));
    expect(painted.map((file) => file.name).filter((name) => !LEGACY_COLOUR_FILES.includes(name))).toEqual([]);
  });

  test("every file still listed holds a palette class, so a task that converts a file takes it off the list", () => {
    const files = new Map(sourceFiles().map((file) => [file.name, file.text]));
    expect(LEGACY_COLOUR_FILES.filter((name) => !PALETTE_CLASS.test(files.get(name) ?? ""))).toEqual([]);
    expect([...LEGACY_COLOUR_FILES]).toEqual([...new Set(LEGACY_COLOUR_FILES)].sort());
  });
});
