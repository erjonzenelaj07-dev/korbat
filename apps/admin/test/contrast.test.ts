import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The console's colours (UI design, sections 4.2 and 9): app.css holds them as custom properties in two :root blocks, the
 * light one and its twin under `@media (prefers-color-scheme: dark)`, with the app's role names, so the console and the
 * app read as one family while red stays the console's own mark. This test parses the two blocks, resolving var(), and
 * holds every pair the console draws text or a control with to WCAG 2.2's minimum in both: 4.5:1 for text, 3:1 for a
 * control's boundary, the focus ring and the red fill against the page. The console imports nothing from the app, so the
 * design's values are written out here rather than read from apps/app's tokens.
 */
const CSS_FILE = path.resolve(import.meta.dirname, "..", "src", "app.css");

/** A text on one line: every line break and tab becomes a space, so the patterns below need no escapes. */
const flat = (text: string): string => [10, 13, 9].reduce((joined, code) => joined.split(String.fromCharCode(code)).join(" "), text);

/** app.css on one line without its comments, which may mention a name without declaring or using it. */
function stylesheet(): string {
  return flat(readFileSync(CSS_FILE, "utf8")).replace(/[/][*][^]*?[*][/]/g, "");
}

type Block = Record<string, string>;

/** The custom properties a block of declarations sets, by name with its two dashes, each value trimmed. */
function declarations(body: string): Block {
  const found: Block = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+) *: *([^;]+);/g)) found[match[1]!] = match[2]!.trim();
  return found;
}

/** The two :root blocks: the first at the top level (light), the second inside the dark colour scheme's media query. */
function rootBlocks(css: string): { light: Block; dark: Block } {
  const roots = [...css.matchAll(/:root *[{]([^{}]*)[}]/g)];
  expect(roots, "app.css holds exactly two :root blocks").toHaveLength(2);
  const [first, second] = roots as [RegExpMatchArray, RegExpMatchArray];
  expect(css.slice(0, first.index).trim(), "the light block comes first, at the top level").toBe("");
  expect(css.slice(0, second.index).replace(/ +/g, " ").trimEnd().endsWith("@media (prefers-color-scheme: dark) {"), "the second :root is the dark colour scheme's").toBe(true);
  return { light: declarations(first[1]!), dark: declarations(second[1]!) };
}

type ThemeName = "light" | "dark";
const THEMES: readonly ThemeName[] = ["light", "dark"];

/** A theme's properties as the page computes them: the dark block overrides the light one, which it otherwise inherits. */
function theme(css: string, name: ThemeName): Block {
  const { light, dark } = rootBlocks(css);
  return name === "light" ? light : { ...light, ...dark };
}

/** A name's colour in a theme, following var() to the hex value it ends at. */
function resolve(values: Block, name: string, seen: string[] = []): string {
  const value = values[name];
  if (value === undefined) throw new Error(`${name} is not declared (via ${seen.join(" > ") || "itself"})`);
  if (seen.includes(name)) throw new Error(`${name} refers to itself (${seen.join(" > ")})`);
  const reference = /^var[(](--[a-z0-9-]+)[)]$/.exec(value);
  if (reference) return resolve(values, reference[1]!, [...seen, name]);
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${name} is ${value}, not a six-digit hex colour`);
  return value.toUpperCase();
}

type Rgb = readonly [number, number, number];

function channels(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** The relative luminance of an sRGB colour, WCAG 2.2's formula. */
function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio of two colours, lighter over darker, from 1 to 21. */
function ratio(a: string, b: string): number {
  const [high, low] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** The names section 9 gives both blocks: the app's roles, the red accent as a fill and as text, and three status triples. */
const NAMES = [
  "--surface",
  "--surface-1",
  "--surface-2",
  "--line-low",
  "--line-high",
  "--ink-high",
  "--ink-medium",
  "--ink-low",
  "--accent",
  "--on-accent",
  "--accent-ink",
  "--focus",
  "--review-ink",
  "--review-wash",
  "--review-on-wash",
  "--restricted-ink",
  "--restricted-wash",
  "--restricted-on-wash",
  "--ok-ink",
  "--ok-bg",
  "--ok-fg",
] as const;

/**
 * The values the design gives: the app's Light and Dark neutrals and status colours (section 4.2), the red accent with
 * white on it and the blue focus ring (section 9). The ok triple is the app's green, explore's, which the app spends on
 * In Explore only; the console has no Explore and has always drawn its confirmations in green.
 */
const EXPECTED: Record<ThemeName, Record<(typeof NAMES)[number], string>> = {
  light: {
    "--surface": "#F6F5F9",
    "--surface-1": "#FFFFFF",
    "--surface-2": "#ECEAF1",
    "--line-low": "#DDDAE4",
    "--line-high": "#827C90",
    "--ink-high": "#15131B",
    "--ink-medium": "#45404F",
    "--ink-low": "#625D6E",
    "--accent": "#991B1B",
    "--on-accent": "#FFFFFF",
    "--accent-ink": "#991B1B",
    "--focus": "#2563EB",
    "--review-ink": "#8A4B00",
    "--review-wash": "#FCEFD2",
    "--review-on-wash": "#6B3A00",
    "--restricted-ink": "#B42318",
    "--restricted-wash": "#FDE4E1",
    "--restricted-on-wash": "#8A1C12",
    "--ok-ink": "#0B7350",
    "--ok-bg": "#DAF3E8",
    "--ok-fg": "#075A3E",
  },
  dark: {
    "--surface": "#100F16",
    "--surface-1": "#18171F",
    "--surface-2": "#22202B",
    "--line-low": "#2B2935",
    "--line-high": "#726D82",
    "--ink-high": "#F3F1F7",
    "--ink-medium": "#C7C2D3",
    "--ink-low": "#9C97AB",
    "--accent": "#D13438",
    "--on-accent": "#FFFFFF",
    "--accent-ink": "#FF7B72",
    "--focus": "#60A5FA",
    "--review-ink": "#F5B83D",
    "--review-wash": "#2E2310",
    "--review-on-wash": "#FAD27A",
    "--restricted-ink": "#FF7B72",
    "--restricted-wash": "#331418",
    "--restricted-on-wash": "#FFADA6",
    "--ok-ink": "#3DD39A",
    "--ok-bg": "#0C2A20",
    "--ok-fg": "#86EBC3",
  },
};

/** The names the console used before section 9, kept as aliases of the new ones so nothing that reads them breaks. */
const ALIASES: Record<string, string> = {
  "--bg": "--surface",
  "--fg": "--ink-high",
  "--muted": "--ink-low",
  "--line": "--line-high",
  "--panel": "--surface-1",
  "--accent-fg": "--on-accent",
  "--error-bg": "--restricted-wash",
  "--error-fg": "--restricted-on-wash",
  "--notice-bg": "--review-wash",
  "--notice-fg": "--review-on-wash",
};

const SURFACES = ["--surface", "--surface-1", "--surface-2"] as const;

/** Text on the three surfaces, 4.5:1: every ink, the red as text, and each status's ink. */
const TEXT_ON_SURFACES = ["--ink-high", "--ink-medium", "--ink-low", "--accent-ink", "--review-ink", "--restricted-ink", "--ok-ink"] as const;

/** Text on a fill or a wash of its own, 4.5:1. */
const TEXT_ON_FILLS: readonly [string, string][] = [
  ["--on-accent", "--accent"],
  ["--review-on-wash", "--review-wash"],
  ["--restricted-on-wash", "--restricted-wash"],
  ["--ok-fg", "--ok-bg"],
];

/** What is not text but must be seen against the page and a raised surface, 3:1 (WCAG 1.4.11). */
const NON_TEXT = ["--line-high", "--focus", "--accent"] as const;

/** Every rule outside the :root blocks, as its selector and its declarations by property. */
function rules(css: string): { selector: string; values: Record<string, string> }[] {
  const found: { selector: string; values: Record<string, string> }[] = [];
  for (const match of css.matchAll(/([^{}]+)[{]([^{}]*)[}]/g)) {
    const selector = match[1]!.trim().replace(/ +/g, " ");
    if (selector === ":root") continue;
    const values: Record<string, string> = {};
    for (const declaration of match[2]!.matchAll(/([a-z-]+) *: *([^;]+);/g)) values[declaration[1]!] = declaration[2]!.trim();
    found.push({ selector, values });
  }
  return found;
}

/** The custom property a value names when it is exactly one var(), or null. */
const named = (value: string | undefined): string | null => (value === undefined ? null : (/^var[(](--[a-z0-9-]+)[)]$/.exec(value)?.[1] ?? null));

describe("the console's two :root blocks", () => {
  test("each declares every name of section 9, at the design's value", () => {
    const css = stylesheet();
    const { light, dark } = rootBlocks(css);
    for (const name of NAMES) {
      expect(light[name], `${name} in the light block`).toBeDefined();
      expect(dark[name], `${name} in the dark block`).toBeDefined();
    }
    for (const name of THEMES) {
      const values = theme(css, name);
      expect(Object.fromEntries(NAMES.map((token) => [token, resolve(values, token)])), name).toEqual(EXPECTED[name]);
    }
  });

  test("the old names stay in both blocks as aliases of the new ones, and no rule reads them any more", () => {
    const css = stylesheet();
    const { light, dark } = rootBlocks(css);
    for (const [alias, target] of Object.entries(ALIASES)) {
      expect(light[alias], `${alias} in the light block`).toBe(`var(${target})`);
      expect(dark[alias], `${alias} in the dark block`).toBe(`var(${target})`);
    }
    // Every rule has moved to the new names; one --line could not serve both a control's border and a divider.
    const readers = rules(css).filter((rule) => Object.values(rule.values).some((value) => Object.keys(ALIASES).some((alias) => value.includes(`var(${alias})`))));
    expect(readers.map((rule) => rule.selector)).toEqual([]);
  });

  test("every var() a rule reads is declared in the light block, which the dark one inherits", () => {
    const css = stylesheet();
    const { light } = rootBlocks(css);
    const read = new Set<string>();
    for (const rule of rules(css)) for (const value of Object.values(rule.values)) for (const match of value.matchAll(/var[(](--[a-z0-9-]+)/g)) read.add(match[1]!);
    expect([...read].filter((name) => light[name] === undefined)).toEqual([]);
  });
});

describe("every pair the console draws keeps its minimum in light and in dark", () => {
  test("text on the three surfaces, 4.5:1", () => {
    const css = stylesheet();
    const failing: string[] = [];
    for (const name of THEMES) {
      const values = theme(css, name);
      for (const ink of TEXT_ON_SURFACES) {
        for (const surface of SURFACES) {
          const found = ratio(resolve(values, ink), resolve(values, surface));
          if (found < 4.5) failing.push(`${name}: ${ink} on ${surface} is ${found.toFixed(2)}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  test("white on the red fill and each wash's text on its wash, 4.5:1", () => {
    const css = stylesheet();
    const failing: string[] = [];
    for (const name of THEMES) {
      const values = theme(css, name);
      for (const [fg, bg] of TEXT_ON_FILLS) {
        const found = ratio(resolve(values, fg), resolve(values, bg));
        if (found < 4.5) failing.push(`${name}: ${fg} on ${bg} is ${found.toFixed(2)}`);
      }
    }
    expect(failing).toEqual([]);
  });

  test("a control's boundary, the focus ring and the red fill against the page and a raised surface, 3:1", () => {
    const css = stylesheet();
    const failing: string[] = [];
    for (const name of THEMES) {
      const values = theme(css, name);
      for (const mark of NON_TEXT) {
        for (const surface of ["--surface", "--surface-1"]) {
          const found = ratio(resolve(values, mark), resolve(values, surface));
          if (found < 3) failing.push(`${name}: ${mark} on ${surface} is ${found.toFixed(2)}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  test("the grey box an image waits in: its sentence on its box, 4.5:1", () => {
    const css = stylesheet();
    const box = rules(css).find((rule) => rule.selector === ".placeholder");
    expect(box).toBeDefined();
    const fg = named(box!.values.color);
    const bg = named(box!.values.background ?? box!.values["background-color"]);
    expect([fg, bg].every((name) => name !== null), ".placeholder sets its colour and its background from tokens").toBe(true);
    for (const name of THEMES) {
      const values = theme(css, name);
      expect(ratio(resolve(values, fg!), resolve(values, bg!)), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("every rule that sets both a text colour and a background from tokens draws them at 4.5:1", () => {
    const css = stylesheet();
    const failing: string[] = [];
    let checked = 0;
    for (const rule of rules(css)) {
      const fg = named(rule.values.color);
      const bg = named(rule.values.background ?? rule.values["background-color"]);
      if (fg === null || bg === null) continue;
      checked += 1;
      for (const name of THEMES) {
        const values = theme(css, name);
        const found = ratio(resolve(values, fg), resolve(values, bg));
        if (found < 4.5) failing.push(`${name}: ${rule.selector} draws ${fg} on ${bg} at ${found.toFixed(2)}`);
      }
    }
    expect(failing).toEqual([]);
    // The page, a button, the red button, the error and notice lines, the banners, the idle warning and the grey box at least.
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
