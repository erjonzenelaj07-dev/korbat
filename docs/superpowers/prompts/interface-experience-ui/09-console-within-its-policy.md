# korbat interface and experience (UI) — Task 9 of 10: The console within its policy: section 9's restyle of apps/admin/src/app.css on the app's colour roles in light and dark with red kept as the console's mark, its type, mono ids and clocks, dense tables, one focus rule, status washes, colour-only motion and screens, the case's sticky composer column from 1200 px, and apps/admin/test/contrast.test.ts holding every pair the console draws to WCAG AA.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 9 of ten in korbat's UI sub-project (interface and experience), the first of the batch of Tasks 9 and 10, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Tasks 1 to 8, none of which touched apps/admin. It follows section 9 (the staff console) with 3.3, 4.2, 4.8, 10, 12.4 and 13's Task 9, under decisions 2 (the system's faces, no font-src) and 21 (light or dark by the system only); Task 10 writes apps/admin/README.md's note on these tokens and records the dry run.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): settings, security, the sign-in flow and Appearance: app/settings/appearance.tsx, the one settings page open signed out (the settings layout lets its path through, and the signed-out nav gains Appearance after Sign in), applies each choice at once through lib/appearance.ts: Theme with Dark style under System, Text size with a sample post that follows it, Font and Reduce motion as radio groups that are one tab stop each and whose arrows choose at once, the Reading switches (Hide counts hides follower counts too), Haptics on iOS and Android only, and Clear what this device keeps with its toast; a change of theme cross-fades the colours over 200 ms, 150 ms reduced, never on first paint; the nav's Settings and a profile's settings button open the new Settings index, Appearance first; Security, Privacy, Profile and Account take their titles in ScreenHeader with cards of fields and rows, sessions as rows with a neutral this device chip, Blocked and Muted on Tabs; the sign-in screens and token pages move into PublicFrame, codes and handles in the mono face, the lockdown's sentences in one words module; the legacy lists are empty; the browser check gains steps 35 to 39`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/09-console-within-its-policy.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Create `apps/admin/test/contrast.test.ts`

```ts
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
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/09-console-within-its-policy.md 3
```

Expected: 1 line starting with `wrote`, one for each file below.

### Replace `apps/admin/src/app.css` (whole file)

```text
/*
 * The staff console's only stylesheet. The page's policy allows styles from its own files only (style-src 'self'), so
 * every rule is here and no component sets a style. It loads no file of its own either: no font (the policy has no
 * font-src, so the console keeps the system's faces) and no image, which the browser check's first step would refuse.
 *
 * The colours are the app's roles (UI design, sections 4.2 and 9), so the console and the app read as one family: ink on
 * paper, lines instead of shadows, and one accent for actions. The console's accent is red, its own mark at a glance,
 * and the focus ring stays blue so it is never mistaken for it. The names say what a colour is for, never its hue.
 */
:root {
  color-scheme: light dark;
  /* The page, a raised surface (cards, inputs, the masthead) and a pressed or quoted one. */
  --surface: #F6F5F9;
  --surface-1: #FFFFFF;
  --surface-2: #ECEAF1;
  /* Dividers, which carry no contrast duty, and the boundary of a control, at least 3:1. */
  --line-low: #DDDAE4;
  --line-high: #827C90;
  /* Primary, secondary and tertiary text; the tertiary is the floor, at least 4.5:1 on every surface. */
  --ink-high: #15131B;
  --ink-medium: #45404F;
  --ink-low: #625D6E;
  /* Red as a fill (the confirming button, the masthead's rule), the text on it, and red as text (links). */
  --accent: #991B1B;
  --on-accent: #FFFFFF;
  --accent-ink: #991B1B;
  --focus: #2563EB;
  /* Status, each as text on a surface, a wash, and text on that wash: under review, restricted, and done. */
  --review-ink: #8A4B00;
  --review-wash: #FCEFD2;
  --review-on-wash: #6B3A00;
  --restricted-ink: #B42318;
  --restricted-wash: #FDE4E1;
  --restricted-on-wash: #8A1C12;
  --ok-ink: #0B7350;
  --ok-bg: #DAF3E8;
  --ok-fg: #075A3E;
  /* The names the console used before, kept as aliases; no rule reads them now. */
  --bg: var(--surface);
  --fg: var(--ink-high);
  --muted: var(--ink-low);
  --line: var(--line-high);
  --panel: var(--surface-1);
  --accent-fg: var(--on-accent);
  --error-bg: var(--restricted-wash);
  --error-fg: var(--restricted-on-wash);
  --notice-bg: var(--review-wash);
  --notice-fg: var(--review-on-wash);
  /*
   * The system's faces (UI design, decision 2); the mono face tells l from 1 and O from 0 in ids and handles. Consolas
   * comes before Cascadia Mono: Chromium draws Windows' variable Cascadia Mono at a weight close to the text face's bold,
   * so every id and time would read as emphasised.
   */
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, Consolas, "Cascadia Mono", monospace;
  font-family: var(--sans);
  line-height: 1.5;
}

/* The console follows the system's light or dark setting, with no switch and no dim style (UI design, decision 21). */
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #100F16;
    --surface-1: #18171F;
    --surface-2: #22202B;
    --line-low: #2B2935;
    --line-high: #726D82;
    --ink-high: #F3F1F7;
    --ink-medium: #C7C2D3;
    --ink-low: #9C97AB;
    --accent: #D13438;
    --on-accent: #FFFFFF;
    --accent-ink: #FF7B72;
    --focus: #60A5FA;
    --review-ink: #F5B83D;
    --review-wash: #2E2310;
    --review-on-wash: #FAD27A;
    --restricted-ink: #FF7B72;
    --restricted-wash: #331418;
    --restricted-on-wash: #FFADA6;
    --ok-ink: #3DD39A;
    --ok-bg: #0C2A20;
    --ok-fg: #86EBC3;
    --bg: var(--surface);
    --fg: var(--ink-high);
    --muted: var(--ink-low);
    --line: var(--line-high);
    --panel: var(--surface-1);
    --accent-fg: var(--on-accent);
    --error-bg: var(--restricted-wash);
    --error-fg: var(--restricted-on-wash);
    --notice-bg: var(--review-wash);
    --notice-fg: var(--review-on-wash);
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--surface);
  color: var(--ink-high);
  font-size: 0.9375rem;
  line-height: 1.5;
}

h2 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

h3 {
  margin: 2rem 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.35;
}

h4 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

a {
  color: var(--accent-ink);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

a[aria-current="page"] {
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.4em;
}

/*
 * One focus rule for everything that takes focus: a 2 px ring in the focus colour, 2 px off the element. Nothing removes
 * an outline anywhere else.
 */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* The masthead: the console's name on a raised bar under the red rule, the pages as quiet tabs, who is signed in. */
.masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.25rem;
  padding: 0.625rem 1.5rem;
  border-top: 4px solid var(--accent);
  border-bottom: 1px solid var(--line-low);
  background: var(--surface-1);
}

.masthead h1 {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.masthead nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.125rem;
}

.masthead nav a {
  padding: 0.3125rem 0.625rem;
  border-radius: 6px;
  color: var(--ink-medium);
  text-decoration: none;
}

/* The page shown now: in the accent's ink and underlined, so the tab is told apart by its shape too. */
.masthead nav a[aria-current="page"] {
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.4em;
}

.masthead .who {
  margin: 0 0 0 auto;
}

/* Meta: the who line, the idle notice, hints and quiet lines, and the label above a frame. */
.hint,
.quiet,
.frame-label,
.who,
.idle {
  font-size: 0.8125rem;
  color: var(--ink-low);
}

/* The idle warning: a review wash under the masthead, its rule at the start. */
.idle.warning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1.5rem;
  border-inline-start: 4px solid var(--review-ink);
  background: var(--review-wash);
  color: var(--review-on-wash);
}

.idle.warning p {
  margin: 0;
}

main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem;
}

/* A console that is off: one sentence, centred. */
main.unavailable {
  max-width: 36rem;
  padding: 6rem 1.5rem;
  text-align: center;
  text-wrap: balance;
  font-size: 1.0625rem;
}

.panel {
  max-width: 40rem;
}

/* A line of prose stays readable on a wide screen, and so do the cards that hold such lines. */
main p,
.authorities,
.block {
  max-width: 48rem;
}

/*
 * Sign-in and Enroll: one card of 440 px, centred. They are found by their titles: .panel alone also lays out the
 * queue's finder and the case's blocks.
 */
section.panel[aria-labelledby="signin-title"],
section.panel[aria-labelledby="enroll-title"] {
  max-width: 27.5rem;
  margin: 2.5rem auto;
  padding: 1.5rem;
  border: 1px solid var(--line-low);
  border-radius: 12px;
  background: var(--surface-1);
}

/* Controls. A control's boundary is the high line, at least 3:1 against what it stands on. */
button {
  font: inherit;
  font-weight: 600;
  padding: 0.375rem 0.875rem;
  border: 1px solid var(--line-high);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--ink-high);
  cursor: pointer;
}

button.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

/* A control that cannot be used now is grey but still readable: its words often say why. */
button:disabled {
  border-color: var(--line-low);
  background: var(--surface-2);
  color: var(--ink-low);
  cursor: default;
}

button[aria-busy="true"] {
  cursor: progress;
}

.quiet-button {
  padding: 0.125rem 0.5rem;
  font-size: 0.8125rem;
  font-weight: 400;
}

label {
  display: block;
  font-weight: 600;
  margin-top: 1.5rem;
}

input[type="text"],
input[type="number"] {
  font: inherit;
  width: 100%;
  max-width: 24rem;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--line-high);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--ink-high);
}

input[type="number"] {
  width: 6rem;
}

input[type="checkbox"],
input[type="radio"] {
  accent-color: var(--accent);
}

input[aria-invalid="true"] {
  border-color: var(--restricted-ink);
}

select,
textarea {
  display: block;
  width: 100%;
  max-width: 40rem;
  margin: 0.25rem 0 0.75rem;
  padding: 0.5rem 0.625rem;
  font: inherit;
  color: var(--ink-high);
  background: var(--surface-1);
  border: 1px solid var(--line-high);
  border-radius: 8px;
}

fieldset {
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--line-low);
  border-radius: 8px;
}

legend {
  padding: 0 0.25rem;
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

/*
 * Status lines. An error stands on the restricted wash with a rule at its start, a notice on the green wash without one,
 * so the two differ by shape as well as by colour, and both say what they are in words.
 */
.error {
  padding: 0.5rem 0.75rem;
  border-inline-start: 4px solid var(--restricted-ink);
  border-radius: 8px;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  background: var(--restricted-wash);
  color: var(--restricted-on-wash);
}

.error p {
  margin: 0.25rem 0;
}

.notice {
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: var(--ok-bg);
  color: var(--ok-fg);
}

.ended {
  font-weight: 600;
}

/*
 * A banner stands above the evidence and is read before it: the report of abuse material on the restricted wash, the
 * Art. 18 check and the author's standing on the review wash, each with a 4 px rule at its start and its words first.
 */
.banner,
.panel.standing {
  max-width: 40rem;
  margin: 1rem 0;
  padding: 0.75rem 1rem;
  border-inline-start: 4px solid var(--restricted-ink);
  border-radius: 8px;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  background: var(--restricted-wash);
  color: var(--restricted-on-wash);
}

.banner.art18,
.panel.standing {
  border-inline-start-color: var(--review-ink);
  background: var(--review-wash);
  color: var(--review-on-wash);
}

.banner p {
  margin: 0.375rem 0;
}

.panel.standing h3 {
  margin-top: 0;
}

/* On a wash, meta and links take the wash's own text colour, which the contrast test holds to its wash. */
.error :is(.hint, .quiet, a),
.notice :is(.hint, .quiet, a),
.banner :is(.hint, .quiet, a),
.panel.standing :is(.hint, .quiet, a),
.idle.warning a {
  color: inherit;
}

/* A question asked inside the page (the reveal, the choice not to seal): a raised card with the red rule at its start. */
.dialog {
  margin: 0.75rem 0;
  padding: 1rem;
  border: 1px solid var(--line-high);
  border-inline-start: 4px solid var(--accent);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--ink-high);
}

.place {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.place label {
  margin: 0;
}

.place input[type="text"] {
  width: 12rem;
}

/* Tables: dividers in the low line, no zebra; a wide table scrolls sideways inside its own block. */
.scroll {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 1rem;
  font-variant-numeric: tabular-nums;
}

th,
td {
  text-align: left;
  vertical-align: top;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--line-low);
}

thead th {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ink-medium);
}

/*
 * Ids, handles, digests and clocks in the mono face with figures of one width, so a column of them lines up and look-alike
 * characters stay apart. A handle a person wrote elsewhere stays in the text face: only the who line's is an id here.
 */
code,
.hash,
time,
.who bdi,
pre {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

code {
  font-size: 0.9em;
}

/* A hash is copied whole by the keeper, so it wraps anywhere rather than widening the table. */
.hash {
  word-break: break-all;
}

/* User-written text may be one long word. */
bdi {
  overflow-wrap: anywhere;
}

.lanes,
.reveals,
.today,
.history,
.seal-list,
.signins,
.keys {
  padding-left: 1.25rem;
}

.lanes {
  font-variant-numeric: tabular-nums;
}

.plain {
  padding-left: 0;
  list-style: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* Moderation cases (3c design, section 8). An item, a decision and a snapshot are divided by the low line. */
.item,
.decision,
.snapshot {
  margin: 0.75rem 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--line-low);
}

/*
 * Text someone else wrote, inside a frame that says who wrote it: the label is the console's, the text is theirs, and
 * the frame keeps the two apart, on a pressed surface with a 3 px rule at its start.
 */
.frame {
  margin: 0.5rem 0;
  padding: 0.5rem 0.75rem;
  border-inline-start: 3px solid var(--line-high);
  border-radius: 6px;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  background: var(--surface-2);
  color: var(--ink-high);
}

/* The statement its author will receive reads as a page of its own: raised, edged, and ruled at its start. */
.frame.preview {
  border: 1px solid var(--line-low);
  border-inline-start: 3px solid var(--line-high);
  background: var(--surface-1);
}

.frame-label,
.frame figcaption {
  margin: 0 0 0.25rem;
}

.frame figcaption {
  font-size: 0.8125rem;
  color: var(--ink-low);
}

.frame-text {
  margin: 0 0 0.25rem;
  white-space: pre-wrap;
}

.images {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding-left: 0;
  list-style: none;
}

.images li {
  width: 16rem;
}

/* Every image of a case starts as this grey box of one size, whatever the image's own size, until its person asks for it. */
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16rem;
  height: 12rem;
  overflow: hidden;
  text-align: center;
  color: var(--ink-medium);
  background: var(--surface-2);
  border: 1px solid var(--line-low);
  border-radius: 8px;
}

.evidence {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* The first look at an image: blurred and grey, so its person sees what kind of image it is before they see it. */
.evidence.blurred {
  filter: blur(14px) grayscale(1);
}

/* The decision composer, a raised card: its choices, the rule beside its examples, and the statement its author will receive. */
.composer {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--line-low);
  border-radius: 12px;
  background: var(--surface-1);
}

.composer > h3:first-child {
  margin-top: 0;
}

.composer fieldset label {
  display: inline-block;
  margin: 0.375rem 1.25rem 0.375rem 0;
}

.composer textarea {
  width: 100%;
}

/* What a rule allows and what it does not, side by side. */
.examples {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.examples h5 {
  margin: 0.25rem 0;
  font-size: 0.9375rem;
}

.preview h4 {
  margin: 0 0 0.5rem;
}

/*
 * Authorities' orders (3f design, section 8): the home screen's blocks, Authorities and Sealed files and programs, as
 * raised panels whose lines stand on their washes, counts in figures of one width.
 */
.authorities {
  margin: 1rem 0;
  padding: 0.75rem 1rem 0.5rem;
  border: 1px solid var(--line-low);
  border-radius: 12px;
  background: var(--surface-1);
  font-variant-numeric: tabular-nums;
}

.authorities h3 {
  margin-top: 0;
}

.authorities p {
  margin: 0.5rem 0;
}

/* The Contact point screen's lists of blocks, the orders' blocks and the Held uploads' and restore's blocks. */
.blocks {
  padding-left: 0;
  list-style: none;
}

.block {
  margin: 0.75rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--line-low);
  border-radius: 10px;
  background: var(--surface-1);
}

.block > h3:first-child {
  margin-top: 0;
}

.block p {
  margin: 0.25rem 0;
}

/* A record of labels and values: each label above its value. */
dt {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ink-low);
}

dd {
  margin: 0 0 0.5rem;
}

/* A mark beside words, such as "Flagged": a neutral outlined chip, its words carrying its meaning. */
.chip {
  display: inline-block;
  padding: 0 0.5rem;
  border: 1px solid var(--line-high);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.5;
  color: var(--ink-medium);
  background: var(--surface-1);
}

.choices {
  padding-left: 0;
  list-style: none;
}

/* A choice is its radio button and its label, one block that is touched as one. */
.choice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  min-height: 44px;
}

.choices .hint {
  margin: 0 0 0.5rem 1.75rem;
}

/* 3f, Task 2: the orders' screens. A labelled field stacks its label, its control and its hint; the forms' values keep
   their lines and wrap; every input fills the column. */
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.75rem 0;
}

.order-form input[type="text"],
.order-form textarea,
.order-form select,
.block .field textarea {
  max-width: 100%;
  box-sizing: border-box;
}

.form-values {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/*
 * The one-hour clock of an order (3f design, section 8): the first line under the order's title, and the line after the
 * authority's frame in a block of the orders' list, large in the mono face. Once it has passed it is an error line, on
 * the restricted wash with its rule, and its words begin "Overdue".
 */
section[aria-labelledby="order-title"] > h2 + p,
.orders > .block > .frame + p {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 1.0625rem;
  line-height: 1.4;
}

.orders > .block > .frame + p {
  margin: 0.5rem 0;
}

section[aria-labelledby="order-title"] > h2 + p {
  padding: 0.625rem 0.875rem;
}

/* The audit log: the chain in the mono face, its place numbers right-aligned. */
table.audit td:first-child {
  font-family: var(--mono);
  text-align: right;
}

/* From 600 px, tables are dense: rows of at least 40 px, head cells in meta, and figures of one width. */
@media (min-width: 600px) {
  th,
  td {
    height: 2.5rem;
    padding: 0.5rem 0.75rem;
  }

  table.audit thead th:first-child {
    text-align: right;
  }

  /* A time in the audit log stays on one line; the hashes beside it wrap by character instead. */
  table.audit time {
    white-space: nowrap;
  }

  /*
   * The head of a table that sits in its own sideways scroll stays at the top of that block. The block does not scroll
   * up and down, so the head never covers a row; Home's table of sessions is in no such block and is left as it is.
   */
  .scroll > table > thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
  }

  section[aria-labelledby="order-title"] > h2 + p,
  .orders > .block > .frame + p {
    font-size: 1.25rem;
  }
}

/*
 * The case from 1200 px: two columns, the case on the left and the composer on the right, sticky, as high as the window
 * at most and scrolling inside itself, so its lower controls can always be scrolled into view. The composer is the case's
 * last child and no wrapper may be added (the order of elements is pinned), so it is placed in the second column across
 * every row of the grid: the span is far more rows than a case has children, and rows without a child take no height.
 * The case's children keep only their top margins here, since a grid does not collapse margins as the page's flow does.
 */
@media (min-width: 1200px) {
  main:has(> section[aria-labelledby="case-title"] > .panel.composer) {
    max-width: 90rem;
  }

  section[aria-labelledby="case-title"]:has(> .panel.composer) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28rem;
    column-gap: 2rem;
    align-items: start;
  }

  section[aria-labelledby="case-title"]:has(> .panel.composer) > * {
    grid-column: 1;
    margin-bottom: 0;
  }

  section[aria-labelledby="case-title"] > .panel.composer {
    grid-column: 2;
    grid-row: 1 / span 1000;
    position: sticky;
    top: 0;
    align-self: start;
    max-width: none;
    max-height: 100vh;
    margin-top: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  section[aria-labelledby="case-title"] > .panel.composer .examples {
    grid-template-columns: 1fr;
  }
}

/* Hover is shown to a mouse only: a touch would leave it behind. */
@media (hover: hover) and (pointer: fine) {
  a:hover {
    text-decoration-thickness: 2px;
  }

  .masthead nav a:not([aria-current="page"]):hover {
    background: var(--surface-2);
    color: var(--ink-high);
  }

  button:hover:not(:disabled) {
    border-color: var(--ink-low);
    background: var(--surface-2);
  }

  button.primary:hover:not(:disabled) {
    border-color: var(--ink-high);
    background: var(--accent);
  }

  input[type="text"]:hover,
  input[type="number"]:hover,
  select:hover,
  textarea:hover {
    border-color: var(--ink-low);
  }
}

@media (hover: hover) and (pointer: fine) and (min-width: 600px) {
  tbody tr:hover {
    background: var(--surface-2);
  }
}

/* The only motion: colours that change on hover and focus ease over 120 ms, and only for a reader who has not asked for less. */
@media (prefers-reduced-motion: no-preference) {
  a,
  button,
  input,
  select,
  textarea,
  summary,
  tbody tr {
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }
}

/*
 * The phone (3f design, section 8.1): at widths under 600 px every screen is one column, a table is a list of blocks,
 * and every control is at least 44 px high and wide. A link inside a sentence is laid out as a block of its own, so it
 * can be measured and touched; a tick box or a radio button is measured with its label.
 */
@media (max-width: 599px) {
  .masthead {
    padding: 0.5rem 1rem;
    gap: 0.25rem 0.75rem;
  }

  .masthead nav {
    gap: 0;
  }

  .masthead nav a {
    padding: 0 0.375rem;
  }

  .masthead .who {
    margin: 0;
    flex-basis: 100%;
  }

  .idle.warning {
    padding: 0.5rem 1rem;
  }

  main {
    padding: 1rem;
  }

  section.panel[aria-labelledby="signin-title"],
  section.panel[aria-labelledby="enroll-title"] {
    margin: 0.5rem auto;
    padding: 1rem;
  }

  .composer {
    padding: 0.75rem;
  }

  .block,
  .authorities {
    padding: 0.75rem;
  }

  a,
  button,
  select,
  textarea,
  summary,
  input:not([type="radio"]):not([type="checkbox"]) {
    min-height: 44px;
    min-width: 44px;
  }

  a {
    display: inline-flex;
    align-items: center;
  }

  main p a,
  main li a {
    display: flex;
  }

  button {
    max-width: 100%;
    white-space: normal;
  }

  table,
  thead,
  tbody,
  tr,
  th,
  td,
  caption {
    display: block;
    width: 100%;
  }

  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  tr {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line-low);
  }

  th,
  td {
    padding: 0.15rem 0;
    border-bottom: none;
  }

  table.audit td:first-child {
    text-align: left;
  }

  .examples {
    grid-template-columns: 1fr;
  }

  .images li,
  .placeholder {
    width: 100%;
  }

  code,
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .composer fieldset label {
    display: flex;
    align-items: center;
    min-height: 44px;
    margin-right: 0;
  }

  .order-form input[type="text"],
  .order-form textarea,
  .order-form select,
  .block .field textarea,
  .block select,
  .block input[type="text"] {
    width: 100%;
  }
}
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=20000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  102 passed (102)
packages/contracts test:       Tests  459 passed (459)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
apps/admin test:       Tests  592 passed (592)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  637 passed (637)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 6: verify: admin-build

```bash
pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'
```

Expected output contains:

- `Build success`
- `index.html`
- `main-HASH.js`
- `main-HASH.css`

Observed on the dry run:

```text
Build success
index.html
main-HASH.css
main-HASH.js
```

## Step 7: verify: admin-browser

```bash
pnpm --filter @korbat/admin test:browser
```

Expected output contains:

- `Tests  79 passed (79)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  79 passed (79)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/admin/src/app.css`
- `apps/admin/test/contrast.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(admin): the console within its policy: app.css's two :root blocks take the app's roles at its Light and Dark values (three surfaces, two lines, three inks), the review, restricted and ok triples, red kept as the console's mark (#991B1B, and #D13438 as a fill with #FF7B72 as text in dark) with white on it and a blue focus ring, and the old names as aliases no rule reads; one 2 px focus rule; meta in ink-low; ids, times, hashes and the order's clock in the system's mono face with tabular figures; tables dense from 600 px, their head sticky inside its own scroll; the suspect banner on the restricted wash, the Art. 18 check and the author's standing on the review wash, each with a 4 px rule at its start, and every error line ruled too; quiet tabs in the masthead, Sign-in and Enroll as one 440 px card, Home's blocks as panels; the case from 1200 px in two columns with the composer sticky in the second; only colours ease, over 120 ms; test/contrast.test.ts holds every pair the console draws in both schemes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(admin): the console within its policy: app.css's two :root blocks take the app's roles at its Light and Dark values (three surfaces, two lines, three inks), the review, restricted and ok triples, red kept as the console's mark (#991B1B, and #D13438 as a fill with #FF7B72 as text in dark) with white on it and a blue focus ring, and the old names as aliases no rule reads; one 2 px focus rule; meta in ink-low; ids, times, hashes and the order's clock in the system's mono face with tabular figures; tables dense from 600 px, their head sticky inside its own scroll; the suspect banner on the restricted wash, the Art. 18 check and the author's standing on the review wash, each with a 4 px rule at its start, and every error line ruled too; quiet tabs in the masthead, Sign-in and Enroll as one 440 px card, Home's blocks as panels; the case from 1200 px in two columns with the composer sticky in the second; only colours ease, over 120 ms; test/contrast.test.ts holds every pair the console draws in both schemes`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 2>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-build": <paste the expected lines as printed>
Verify "admin-browser": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
