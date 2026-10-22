# korbat interface and experience (UI) — Task 1 of 10: Tokens, fonts, Text, Icon and the theme switch: the design language in code, and the theme from the first frame.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 1 of ten in korbat's UI sub-project (interface and experience), the first of the batch of Tasks 1 to 3, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md. It follows section 4 (colour tokens, type, spacing, radii and icons), section 8.8 for the appearance store, sections 5.1, 6.1 to 6.3 and 7.1 for the motion values, Text, Icon and useLayout(), and section 11.3 for the web export's baseline, with section 2's decisions 3 to 5 as written. Task 2 builds the primitives and the shared test mocks on these files, and Task 3 the shell and the app's browser check.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `docs: interface and experience (UI) plan and verified execution prompts`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/01-tokens-fonts-text-icon-theme.md 1
```

Expected: 8 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/appearance.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Appearance } from "@/lib/appearance";
import { THEMES, type ThemeName } from "@/theme/tokens";
import { BOOT_FILE, runThemeBoot } from "./boot";
import { SRC, sourceFiles } from "./legacy-files";

/**
 * The reader's appearance (UI design, section 8.8): one record under korbat.appearance, read field by field so a
 * damaged or older record still gives every choice, kept in memory where there is no storage (native, or a browser
 * that refuses it), and read again by theme-boot.js before the first paint, which must resolve it as the app does.
 */
const KEY = "korbat.appearance";

const DEFAULTS: Appearance = {
  theme: "system",
  darkStyle: "dark",
  textStep: "default",
  font: "korbat",
  reduceMotion: "system",
  haptics: true,
  autoLoad: false,
  openNewest: false,
  hideCounts: false,
};

/** A browser's localStorage as far as the store uses it; `fail` makes every call throw, as a blocked store does. */
function fakeStorage(initial: Record<string, string> = {}, fail: { read?: boolean; write?: boolean } = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem(key: string) {
      if (fail.read) throw new Error("The operation is insecure.");
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (fail.write) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    removeItem(key: string) {
      if (fail.write) throw new Error("The operation is insecure.");
      items.delete(key);
    },
  };
}

const globals = globalThis as { localStorage?: unknown };

/** A fresh copy of the store, so what one test kept in memory does not reach the next. */
async function load(storage?: unknown) {
  vi.resetModules();
  if (storage === undefined) delete globals.localStorage;
  else globals.localStorage = storage;
  return import("@/lib/appearance");
}

afterEach(() => {
  delete globals.localStorage;
});

describe("the appearance store", () => {
  test("with nothing stored every choice is its default: System with Dark as the dark style, Default text, korbat fonts, motion as the system has it, haptics on, the reading switches off", async () => {
    const store = await load(fakeStorage());
    expect(store.DEFAULT_APPEARANCE).toEqual(DEFAULTS);
    expect(store.readAppearance()).toEqual(DEFAULTS);
    expect(store.APPEARANCE_KEY).toBe(KEY);
  });

  test("a choice is written at once under korbat.appearance, read back, and announced to the screens that show it", async () => {
    const storage = fakeStorage();
    const store = await load(storage);
    const heard = vi.fn();
    const stop = store.subscribeAppearance(heard);
    store.setAppearance({ theme: "dim", textStep: "larger" });
    expect(JSON.parse(storage.items.get(KEY)!)).toEqual({ ...DEFAULTS, theme: "dim", textStep: "larger" });
    expect(store.readAppearance()).toEqual({ ...DEFAULTS, theme: "dim", textStep: "larger" });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    store.setAppearance({ hideCounts: true });
    expect(heard).toHaveBeenCalledTimes(1);
    // The same record is the same object until it changes, as useSyncExternalStore needs.
    expect(store.readAppearance()).toBe(store.readAppearance());
  });

  test("a bad or partial record falls back field by field", async () => {
    const stored = { theme: "dim", darkStyle: "sepia", textStep: "huge", font: "system", reduceMotion: "always", haptics: "yes", autoLoad: true, hideCounts: 1, extra: "kept out" };
    const store = await load(fakeStorage({ [KEY]: JSON.stringify(stored) }));
    expect(store.readAppearance()).toEqual({ ...DEFAULTS, theme: "dim", font: "system", reduceMotion: "always", autoLoad: true });
  });

  test("a record that is not an object, or not JSON at all, gives the defaults", async () => {
    for (const raw of ["{not json", "null", "[]", "42", '"dark"', ""]) {
      const store = await load(fakeStorage({ [KEY]: raw }));
      expect(store.readAppearance(), raw).toEqual(DEFAULTS);
      expect(store.parseAppearance(raw), raw).toEqual(DEFAULTS);
    }
    const store = await load(fakeStorage());
    expect(store.parseAppearance(null)).toEqual(DEFAULTS);
  });

  test("storage that throws is survived: the defaults are read, and a choice lives on in memory", async () => {
    const store = await load(fakeStorage({}, { read: true, write: true }));
    expect(store.readAppearance()).toEqual(DEFAULTS);
    expect(() => store.setAppearance({ theme: "light" })).not.toThrow();
    expect(store.readAppearance().theme).toBe("light");
    expect(() => store.clearAppearance()).not.toThrow();
    expect(store.readAppearance()).toEqual(DEFAULTS);
  });

  test("a store that reads but refuses to write keeps the choice in memory rather than losing it", async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ theme: "dim" }) }, { write: true });
    const store = await load(storage);
    expect(store.readAppearance().theme).toBe("dim");
    store.setAppearance({ theme: "light" });
    expect(store.readAppearance().theme).toBe("light");
  });

  test("where there is no storage at all, as on native, choices are kept in memory", async () => {
    const store = await load();
    store.setAppearance({ theme: "dark", haptics: false });
    expect(store.readAppearance()).toEqual({ ...DEFAULTS, theme: "dark", haptics: false });
  });

  test("the one clear function removes the record and the theme returns to System", async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ theme: "dark", hideCounts: true }), "korbat.deviceId": "kept-by-api" });
    const store = await load(storage);
    const heard = vi.fn();
    store.subscribeAppearance(heard);
    store.clearAppearance();
    expect(storage.items.has(KEY)).toBe(false);
    expect(storage.items.get("korbat.deviceId")).toBe("kept-by-api");
    expect(store.readAppearance()).toEqual(DEFAULTS);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test("System resolves to Light on a light system and to the reader's dark style on a dark one", async () => {
    const store = await load();
    expect(store.resolveTheme(DEFAULTS, "light")).toBe("light");
    expect(store.resolveTheme(DEFAULTS, "dark")).toBe("dark");
    expect(store.resolveTheme({ ...DEFAULTS, darkStyle: "dim" }, "dark")).toBe("dim");
    expect(store.resolveTheme({ ...DEFAULTS, darkStyle: "dim" }, null)).toBe("light");
    for (const theme of ["light", "dim", "dark"] as const) {
      expect(store.resolveTheme({ ...DEFAULTS, theme }, "light")).toBe(theme);
      expect(store.resolveTheme({ ...DEFAULTS, theme }, "dark")).toBe(theme);
    }
  });

  test("only lib/appearance.ts touches korbat.appearance", () => {
    const files = sourceFiles().filter((file) => file.text.includes(KEY));
    expect(files.map((file) => file.name)).toEqual(["lib/appearance.ts"]);
  });
});

describe("the hooks read the store, with or without a provider", () => {
  test("useAppearance() gives the stored record, and useTheme() resolves it without ThemeProvider around it", async () => {
    await load(fakeStorage({ [KEY]: JSON.stringify({ theme: "dim", textStep: "largest" }) }));
    const { useAppearance } = await import("@/lib/appearance");
    const { useTheme } = await import("@/theme/ThemeProvider");
    function Probe() {
      const appearance = useAppearance();
      const theme = useTheme();
      return createElement("p", { "data-step": appearance.textStep, "data-theme": theme.name, "data-surface": theme.colors.surface, "data-turnstile": theme.turnstile });
    }
    const out = renderToStaticMarkup(createElement(Probe));
    expect(out).toContain('data-step="largest"');
    expect(out).toContain('data-theme="dim"');
    expect(out).toContain(`data-surface="${THEMES.dim.surface}"`);
    expect(out).toContain('data-turnstile="dark"');
  });

  test("the human check takes the light widget in Light and the dark one in Dim and Dark", async () => {
    const answers: Record<string, string> = {};
    for (const theme of ["light", "dim", "dark"] as const) {
      await load(fakeStorage({ [KEY]: JSON.stringify({ theme }) }));
      const { useTheme } = await import("@/theme/ThemeProvider");
      function Probe() {
        return createElement("i", null, useTheme().turnstile);
      }
      answers[theme] = renderToStaticMarkup(createElement(Probe));
    }
    expect(answers).toEqual({ light: "<i>light</i>", dim: "<i>dark</i>", dark: "<i>dark</i>" });
  });

  test("the three Turnstile widgets take their theme from useTheme(), none fixed to dark", () => {
    for (const file of [["app", "(auth)", "signin.tsx"], ["app", "(auth)", "password.tsx"], ["components", "moderation", "ReportForm.tsx"]]) {
      const source = readFileSync(path.join(SRC, ...file), "utf8");
      expect(source, file.join("/")).toContain('options={{ theme: theme.turnstile, refreshExpired: "manual" }}');
      expect(source, file.join("/")).toContain("const theme = useTheme();");
      expect(source, file.join("/")).not.toContain('theme: "dark"');
    }
  });

  test("ThemeProvider renders its children, and touches no document while rendering", async () => {
    await load(fakeStorage());
    const { ThemeProvider } = await import("@/theme/ThemeProvider");
    expect(renderToStaticMarkup(createElement(ThemeProvider, null, createElement("main", null, "korbat")))).toBe("<main>korbat</main>");
  });
});

describe("theme-boot.js, the first paint", () => {
  const resolved = (boot: ReturnType<typeof runThemeBoot>): ThemeName => {
    const names = boot.classes.filter((name) => name === "light" || name === "dim" || name === "dark");
    expect(names).toHaveLength(1);
    return names[0] as ThemeName;
  };

  test("is a plain script of about forty lines that touches only korbat.appearance", () => {
    const source = readFileSync(BOOT_FILE, "utf8");
    expect(source.split(String.fromCharCode(10)).length).toBeLessThanOrEqual(60);
    expect(source).not.toMatch(/\b(import|export)\b/);
    expect([...new Set(source.match(/korbat\.[a-zA-Z.]+/g))]).toEqual([KEY]);
  });

  test("with nothing stored it follows the system: Light on a light system, Dark on a dark one", () => {
    const light = runThemeBoot({ systemDark: false });
    expect(resolved(light)).toBe("light");
    expect(light.style).toMatchObject({ backgroundColor: THEMES.light.surface, color: THEMES.light["ink-high"], colorScheme: "light" });
    expect(light.attributes).toEqual({ "data-text-step": "default", "data-font": "korbat" });
    const dark = runThemeBoot({ systemDark: true });
    expect(resolved(dark)).toBe("dark");
    expect(dark.style).toMatchObject({ backgroundColor: THEMES.dark.surface, color: THEMES.dark["ink-high"], colorScheme: "dark" });
    expect(dark.themeColor).toBe(THEMES.dark.surface);
  });

  test("a stored theme wins over the system, each with its own colours", () => {
    for (const theme of ["light", "dim", "dark"] as const) {
      for (const systemDark of [false, true]) {
        const boot = runThemeBoot({ stored: JSON.stringify({ theme, darkStyle: "dim" }), systemDark });
        expect(resolved(boot), `${theme} on a ${systemDark ? "dark" : "light"} system`).toBe(theme);
        expect(boot.style.colorScheme).toBe(theme === "light" ? "light" : "dark");
        expect(boot.style.backgroundColor).toBe(THEMES[theme].surface);
        expect(boot.themeColor).toBe(THEMES[theme].surface);
      }
    }
  });

  test("System takes the stored dark style on a dark system and Light on a light one", () => {
    for (const darkStyle of ["dim", "dark"] as const) {
      expect(resolved(runThemeBoot({ stored: JSON.stringify({ theme: "system", darkStyle }), systemDark: true }))).toBe(darkStyle);
      expect(resolved(runThemeBoot({ stored: JSON.stringify({ theme: "system", darkStyle }), systemDark: false }))).toBe("light");
    }
  });

  test("it sets the text step and the font for the stylesheet, falling back field by field", () => {
    const boot = runThemeBoot({ stored: JSON.stringify({ theme: "sepia", textStep: "largest", font: "system" }), systemDark: true });
    expect(resolved(boot)).toBe("dark");
    expect(boot.attributes).toEqual({ "data-text-step": "largest", "data-font": "system" });
    expect(runThemeBoot({ stored: JSON.stringify({ textStep: "huge", font: "comic" }) }).attributes).toEqual({ "data-text-step": "default", "data-font": "korbat" });
  });

  test("bad JSON, a record that is not an object, a store that throws and a browser without matchMedia all paint the default", () => {
    for (const stored of ["{not json", "null", "[]", "7"]) {
      expect(resolved(runThemeBoot({ stored, systemDark: true })), stored).toBe("dark");
      expect(resolved(runThemeBoot({ stored, systemDark: false })), stored).toBe("light");
    }
    expect(resolved(runThemeBoot({ storageThrows: true, systemDark: true }))).toBe("dark");
    expect(resolved(runThemeBoot({ noMatchMedia: true }))).toBe("light");
  });

  test("it resolves every stored record as the app does", async () => {
    const store = await load();
    const records = [null, "{}", "{bad", JSON.stringify({ theme: "dim" }), JSON.stringify({ theme: "system", darkStyle: "dim" }), JSON.stringify({ theme: "system", darkStyle: "x" }), JSON.stringify({ theme: 3 })];
    for (const raw of records) {
      for (const systemDark of [false, true]) {
        const app = store.resolveTheme(store.parseAppearance(raw), systemDark ? "dark" : "light");
        expect(resolved(runThemeBoot({ stored: raw, systemDark })), `${raw} ${systemDark}`).toBe(app);
      }
    }
  });
});
```

### Create `apps/app/test/boot.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** public/theme-boot.js, the plain script index.html loads before anything else (UI design, section 4.2). */
export const BOOT_FILE = path.resolve(import.meta.dirname, "..", "public", "theme-boot.js");

/** What theme-boot.js did to the page: the html element's classes, attributes and inline style, and the theme-color meta. */
export interface BootResult {
  classes: string[];
  attributes: Record<string, string>;
  style: Record<string, string>;
  themeColor: string | null;
}

/**
 * Runs theme-boot.js in a fresh vm context that stands in for a browser at the top of the head: a document with an
 * html element and a head, localStorage holding `stored` under korbat.appearance (or throwing, as a blocked store
 * does), and matchMedia answering whether the system is dark (or missing). It gives the script exactly the browser
 * surface it may use, so a script that reaches for anything else fails here.
 */
export function runThemeBoot(options: { stored?: string | null; systemDark?: boolean; storageThrows?: boolean; noMatchMedia?: boolean } = {}): BootResult {
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};
  const style: Record<string, string> = {};
  const metas: { name: string | null; attrs: Record<string, string> }[] = [];
  const element = (tag: string) => {
    const attrs: Record<string, string> = {};
    const made = {
      tagName: tag.toUpperCase(),
      attrs,
      get name() {
        return attrs.name ?? null;
      },
      setAttribute(name: string, value: string) {
        attrs[name] = String(value);
      },
      getAttribute(name: string) {
        return name in attrs ? attrs[name]! : null;
      },
    };
    return made;
  };
  const document = {
    documentElement: {
      classList: {
        add: (...names: string[]) => names.forEach((name) => classes.add(name)),
        remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
        contains: (name: string) => classes.has(name),
      },
      setAttribute(name: string, value: string) {
        attributes[name] = String(value);
      },
      style,
    },
    head: {
      appendChild(child: ReturnType<typeof element>) {
        metas.push({ name: child.name, attrs: child.attrs });
        return child;
      },
    },
    createElement: element,
    querySelector(selector: string) {
      const named = /^meta\[name="([^"]+)"\]$/.exec(selector);
      if (!named) throw new Error(`theme-boot.js asked for an unexpected selector: ${selector}`);
      const found = metas.find((meta) => meta.attrs.name === named[1]);
      return found ? { setAttribute: (name: string, value: string) => void (found.attrs[name] = String(value)) } : null;
    },
  };
  const storage = {
    getItem: (key: string) => (key === "korbat.appearance" ? (options.stored ?? null) : null),
  };
  const context: Record<string, unknown> = { document };
  Object.defineProperty(context, "localStorage", {
    get() {
      if (options.storageThrows) throw new Error("The operation is insecure.");
      return storage;
    },
  });
  if (!options.noMatchMedia) context.matchMedia = (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" ? Boolean(options.systemDark) : false });
  context.window = context;
  vm.runInNewContext(readFileSync(BOOT_FILE, "utf8"), context, { filename: "theme-boot.js" });
  const themeColor = metas.find((meta) => meta.attrs.name === "theme-color")?.attrs.content ?? null;
  return { classes: [...classes].sort(), attributes, style, themeColor };
}
```

### Create `apps/app/test/browser/baseline.json`

```json
{
  "commit": "1222b87",
  "measuredAt": "2026-10-21",
  "command": "expo export --platform web --output-dir <dir>, from apps/app, with EXPO_NO_DOTENV=1 and the env below in the child",
  "env": {
    "EXPO_NO_DOTENV": "1",
    "EXPO_PUBLIC_API_URL": "",
    "EXPO_PUBLIC_TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
    "EXPO_PUBLIC_BADGE": "off",
    "EXPO_PUBLIC_CONTACT_EMAIL": "",
    "EXPO_PUBLIC_CONTACT_POINT": "",
    "EXPO_PUBLIC_HOME_STATE": ""
  },
  "method": {
    "compressor": "node:zlib gzipSync, each file compressed on its own and the sizes summed",
    "level": 9,
    "unit": "bytes",
    "kilobyte": 1024,
    "js": "_expo/static/js/web/*",
    "css": "_expo/static/css/*"
  },
  "js": { "files": 1, "bytes": 3107706, "gzipBytes": 709377 },
  "css": { "files": 1, "bytes": 14566, "gzipBytes": 3354 }
}
```

### Create `apps/app/test/contrast.test.ts`

```ts
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
```

### Create `apps/app/test/legacy-files.ts`

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The source files that still paint with Tailwind's own palette (`text-zinc-400`, `bg-sky-500`) and size the text
 * with size and weight classes instead of korbat's tokens and the Text component (UI design, sections 4.2 and 6.2).
 * contrast.test.ts lets these files, and only these, keep palette classes and hex colours; theme.test.ts lets them
 * keep size and weight classes. A listed file that no longer holds a palette class fails contrast.test.ts, so the
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 empties it. Paths are
 * from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/bookmarks.tsx",
  "app/explore/about.tsx",
  "app/index.tsx",
  "app/post/[id].tsx",
  "app/rules.tsx",
  "app/settings/account.tsx",
  "app/settings/cases/[id].tsx",
  "app/settings/cases/[id]/reply.tsx",
  "app/settings/cases/index.tsx",
  "app/settings/cases/releases/[id].tsx",
  "app/settings/cases/uploads/[id].tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/transparency.tsx",
  "app/u/[handle]/followers.tsx",
  "app/u/[handle]/following.tsx",
  "app/u/[handle]/index.tsx",
  "components/AppShell.tsx",
  "components/HandleBox.tsx",
  "components/PopularNow.tsx",
  "components/SettingsNav.tsx",
  "components/StandingBanner.tsx",
  "components/moderation/CasesLists.tsx",
  "components/moderation/DecisionDetail.tsx",
  "components/moderation/ItemLines.tsx",
  "components/moderation/NoticeStatusView.tsx",
  "components/moderation/RefusedNotice.tsx",
  "components/moderation/ReleaseNotice.tsx",
  "components/moderation/ReportForm.tsx",
  "components/moderation/UploadNotice.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
  "components/social/ExploreList.tsx",
  "components/social/HiddenImage.tsx",
  "components/social/ImageFault.tsx",
  "components/social/MediaGrid.tsx",
  "components/social/MediaViewer.tsx",
  "components/social/PagedList.tsx",
  "components/social/PostCard.tsx",
  "components/social/ProfileList.tsx",
  "components/social/RichText.tsx",
  "components/ui.tsx",
  "lib/session.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
```

### Create `apps/app/test/theme.test.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucide from "lucide-react";
import { describe, expect, test } from "vitest";
import { FONT_FACES, FONT_FAMILY, fontFaceCss } from "@/theme/fonts.web";
import { SYSTEM_MONO_STACK, SYSTEM_STACK, TEXT_STEPS, Text, VARIANTS, stepped, textStyle, type TextVariant } from "@/components/kit/Text";
import { Icon } from "@/components/kit/Icon";
import { ICONS, type IconName } from "@/components/icons";
import { BREAKPOINTS, GUTTER, layoutKind } from "@/theme/layout";
import { MOTION } from "@/theme/motion";
import { LEGACY_COLOUR_FILES, SRC, sourceFiles } from "./legacy-files";

/**
 * The type, the fonts and the other constants of the design language (UI design, sections 4.3 to 4.7, 5.1 and 7.1):
 * the bundled font files exist and are declared as their packages declare them, their licences sit beside the app,
 * the text-size step's maths, the variants, and the icons' closed list.
 */
const APP = path.resolve(import.meta.dirname, "..");
const requireFromApp = createRequire(path.join(APP, "package.json"));
const PACKAGES = ["@fontsource-variable/fraunces", "@fontsource-variable/atkinson-hyperlegible-next", "@fontsource-variable/atkinson-hyperlegible-mono"];

/** The package CSS's @font-face rule for one woff2 file, as its fields. */
function packageRule(file: string): Record<string, string> {
  const pkg = file.split("/files/")[0]!;
  const name = file.split("/files/")[1]!;
  const dir = path.dirname(requireFromApp.resolve(`${pkg}/package.json`));
  for (const css of ["full.css", "full-italic.css", "wght.css", "wght-italic.css"]) {
    if (!existsSync(path.join(dir, css))) continue;
    for (const block of readFileSync(path.join(dir, css), "utf8").matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      if (!block[1]!.includes(`./files/${name})`)) continue;
      return Object.fromEntries([...block[1]!.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
    }
  }
  throw new Error(`no rule in ${pkg} names ${name}`);
}

describe("the fonts", () => {
  const source = readFileSync(path.join(SRC, "theme", "fonts.web.ts"), "utf8");
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]!);

  test("fonts.web.ts requires each face's file by its literal path, and every one of them exists", () => {
    expect(required.sort()).toEqual(FONT_FACES.map((face) => face.file).sort());
    for (const file of required) expect(existsSync(requireFromApp.resolve(file)), file).toBe(true);
    for (const face of FONT_FACES) expect(face.url.toString(), face.file).toContain(face.file);
  });

  test("the three families come as their packages ship them: Fraunces' full axes, the text face's roman and italic, the mono roman; latin and latin-ext each", () => {
    expect(FONT_FACES.map((face) => face.file.split("/files/")[1]).sort()).toEqual([
      "atkinson-hyperlegible-mono-latin-ext-wght-normal.woff2",
      "atkinson-hyperlegible-mono-latin-wght-normal.woff2",
      "atkinson-hyperlegible-next-latin-ext-wght-italic.woff2",
      "atkinson-hyperlegible-next-latin-ext-wght-normal.woff2",
      "atkinson-hyperlegible-next-latin-wght-italic.woff2",
      "atkinson-hyperlegible-next-latin-wght-normal.woff2",
      "fraunces-latin-ext-full-normal.woff2",
      "fraunces-latin-full-normal.woff2",
    ]);
    expect(FONT_FAMILY).toEqual({ display: "Fraunces Variable", text: "Atkinson Hyperlegible Next Variable", mono: "Atkinson Hyperlegible Mono Variable" });
  });

  test("each rule's family, style, weights and unicode-range equal the package CSS's, so latin-ext downloads only when a post needs it", () => {
    for (const face of FONT_FACES) {
      const rule = packageRule(face.file);
      expect(`'${face.family}'`, face.file).toBe(rule["font-family"]);
      expect(face.style, face.file).toBe(rule["font-style"]);
      expect(face.weight, face.file).toBe(rule["font-weight"]);
      expect(face.unicodeRange, face.file).toBe(rule["unicode-range"]);
    }
  });

  test("the style element's rules swap in once loaded and name the bundled file's URL", () => {
    const css = fontFaceCss((face) => `/assets/${face.file.split("/files/")[1]}`);
    expect(css.match(/@font-face/g)).toHaveLength(FONT_FACES.length);
    expect(css.match(/font-display: swap;/g)).toHaveLength(FONT_FACES.length);
    expect(css).toContain('src: url("/assets/fraunces-latin-full-normal.woff2") format("woff2-variations");');
    expect(css).not.toMatch(/https?:/);
  });

  test("each package's licence, the SIL Open Font License, sits in assets/fonts/LICENSES as the package ships it", () => {
    for (const pkg of PACKAGES) {
      const shipped = readFileSync(requireFromApp.resolve(`${pkg}/LICENSE`), "utf8");
      const kept = path.join(APP, "assets", "fonts", "LICENSES", `${pkg.split("/")[1]}-OFL.txt`);
      expect(existsSync(kept), kept).toBe(true);
      expect(readFileSync(kept, "utf8"), pkg).toBe(shipped);
      expect(shipped).toContain("SIL Open Font License, Version 1.1");
    }
  });
});

describe("the type scale", () => {
  test("the ten variants have section 4.3's faces, weights, sizes, line heights and tracking", () => {
    const table: Record<TextVariant, [string, number, number, number, number]> = {
      "display-1": ["display", 600, 34, 40, -0.02],
      "display-2": ["display", 600, 28, 34, -0.015],
      "display-3": ["display", 600, 22, 28, -0.01],
      title: ["text", 700, 18, 24, 0],
      post: ["text", 400, 17, 26, 0],
      body: ["text", 400, 15, 22, 0],
      "body-strong": ["text", 700, 15, 22, 0],
      meta: ["text", 400, 13, 18, 0.005],
      chip: ["text", 700, 12, 16, 0.01],
      mono: ["mono", 400, 14, 20, 0],
    };
    expect(Object.fromEntries(Object.entries(VARIANTS).map(([name, v]) => [name, [v.face, v.weight, v.size, v.line, v.tracking]]))).toEqual(table);
  });

  test("Fraunces is used at 22 px and up only, at the Default step", () => {
    for (const [name, variant] of Object.entries(VARIANTS)) if (variant.face === "display") expect(variant.size, name).toBeGreaterThanOrEqual(22);
  });

  test("the text-size step multiplies size and line height together, rounded to whole pixels", () => {
    expect(TEXT_STEPS).toEqual({ smaller: 0.875, default: 1, larger: 1.125, largest: 1.25 });
    expect([stepped(17, "smaller"), stepped(26, "smaller"), stepped(17, "default"), stepped(15, "larger"), stepped(22, "larger"), stepped(34, "largest"), stepped(13, "largest")]).toEqual([15, 23, 17, 17, 25, 43, 16]);
  });

  test("on web sizes are rem, so the browser's own text size scales them too, with tracking in em", () => {
    const post = textStyle("post", { step: "smaller", font: "korbat" }, "web");
    expect(post).toMatchObject({ fontSize: "0.9375rem", lineHeight: "1.4375rem", fontWeight: "400" });
    expect(post.fontFamily).toBe(`"Atkinson Hyperlegible Next Variable", ${SYSTEM_STACK}`);
    const display = textStyle("display-1", { step: "default", font: "korbat" }, "web");
    expect(display).toMatchObject({ fontSize: "2.125rem", lineHeight: "2.5rem", letterSpacing: "-0.02em", fontWeight: "600" });
    expect(display.fontFamily).toBe(`"Fraunces Variable", ${SYSTEM_STACK}`);
    expect(textStyle("mono", { step: "default", font: "korbat" }, "web").fontFamily).toBe(`"Atkinson Hyperlegible Mono Variable", ${SYSTEM_MONO_STACK}`);
  });

  test("with the system font, text and display take the system stack (display at 700) and mono the system monospace", () => {
    expect(SYSTEM_STACK).toBe('system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
    expect(SYSTEM_MONO_STACK).toBe('ui-monospace, "Cascadia Mono", Consolas, monospace');
    const display = textStyle("display-1", { step: "default", font: "system" }, "web");
    expect(display).toMatchObject({ fontFamily: SYSTEM_STACK, fontWeight: "700" });
    expect(display).not.toHaveProperty("fontVariationSettings");
    expect(textStyle("mono", { step: "default", font: "system" }, "web").fontFamily).toBe(SYSTEM_MONO_STACK);
  });

  test("on native sizes are pixels times the step, the system font is every family, and the OS text size is capped on chrome only", () => {
    const families = { display: undefined, text: undefined, mono: undefined };
    const post = textStyle("post", { step: "larger", font: "korbat" }, "native", families);
    expect(post).toMatchObject({ fontSize: 19, lineHeight: 29, fontWeight: "400" });
    expect(post.fontFamily).toBeUndefined();
    expect(textStyle("display-1", { step: "default", font: "korbat" }, "native", families).letterSpacing).toBeCloseTo(-0.68, 5);
  });
});

describe("the Text component", () => {
  test("draws a heading at its level, and its variant in rem at the reader's step and font, through react-native-web", () => {
    const heading = renderToStaticMarkup(createElement(Text, { as: "h2", variant: "display-1" }, "Settings"));
    expect(heading).toMatch(/^<h2 /);
    expect(heading).toContain('aria-level="2"');
    expect(heading).toContain("font-size:2.125rem;line-height:2.5rem;letter-spacing:-0.02em");
    expect(heading).toContain("font-variation-settings:&quot;SOFT&quot; 50, &quot;WONK&quot; 1");
    expect(renderToStaticMarkup(createElement(Text, { variant: "meta", italic: true }, "deleted"))).toContain("font-style:italic");
    const globals = globalThis as { localStorage?: unknown };
    globals.localStorage = { getItem: () => JSON.stringify({ textStep: "largest", font: "system" }), setItem: () => undefined, removeItem: () => undefined };
    try {
      const post = renderToStaticMarkup(createElement(Text, { variant: "post" }, "A post"));
      expect(post).toMatch(/^<div /);
      expect(post).toContain("font-size:1.3125rem;line-height:2.0625rem");
      expect(post).toContain("font-family:system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif");
    } finally {
      delete globals.localStorage;
    }
  });
});

/** Size and weight classes, which the Text component replaces. */
const TYPE_CLASS = /\b(?:text-(?:xs|sm|base|lg|xl|2xl|3xl)|font-(?:bold|semibold|medium))\b/;

describe("screens size text through Text only", () => {
  test("size and weight classes appear only in kit/Text.tsx and the files not yet converted", () => {
    const sized = sourceFiles().filter((file) => file.name !== "components/kit/Text.tsx" && TYPE_CLASS.test(file.text));
    expect(sized.map((file) => file.name).filter((name) => !LEGACY_COLOUR_FILES.includes(name))).toEqual([]);
  });
});

describe("the icons", () => {
  test("icons.ts names section 4.7's thirty-nine icons by Lucide's export names", () => {
    expect(ICONS).toEqual({
      home: "House",
      bookmarks: "Bookmark",
      profile: "CircleUser",
      settings: "Settings",
      compose: "SquarePen",
      reply: "MessageCircle",
      repost: "Repeat2",
      quote: "Quote",
      like: "Heart",
      more: "Ellipsis",
      "who-sees": "Eye",
      "copy-link": "Link",
      delete: "Trash2",
      report: "Flag",
      close: "X",
      back: "ArrowLeft",
      newer: "ArrowUp",
      previous: "ChevronLeft",
      next: "ChevronRight",
      "add-image": "ImagePlus",
      error: "CircleAlert",
      offline: "WifiOff",
      done: "CircleCheck",
      review: "Clock",
      restricted: "EyeOff",
      verified: "BadgeCheck",
      explore: "Compass",
      hidden: "EyeOff",
      security: "Shield",
      privacy: "Lock",
      "edit-profile": "UserPen",
      account: "UserCog",
      cases: "Scale",
      appearance: "Palette",
      "sign-in": "LogIn",
      passkey: "KeyRound",
      external: "ExternalLink",
      info: "Info",
      retry: "RotateCw",
    });
    const source = readFileSync(path.join(SRC, "components", "icons.ts"), "utf8");
    expect(source).not.toMatch(/from "lucide-react(-native)?"/);
  });

  test("Icon.web.tsx and Icon.tsx map every name to the component icons.ts names, each from its own package", () => {
    for (const [file, pkg] of [["Icon.web.tsx", "lucide-react"], ["Icon.tsx", "lucide-react-native"]] as const) {
      const source = readFileSync(path.join(SRC, "components", "kit", file), "utf8");
      expect(source, file).toContain(`} from "${pkg}";`);
      expect(source, file).not.toContain(`from "${pkg === "lucide-react" ? "lucide-react-native" : "lucide-react"}"`);
      const entries = Object.fromEntries([...source.matchAll(/^ {2}("?[a-z-]+"?): ([A-Za-z0-9]+),$/gm)].map((match) => [match[1]!.replace(/"/g, ""), match[2]!]));
      expect(entries, file).toEqual(ICONS);
    }
  });

  test("on web an icon is lucide-react's svg, hidden from assistive technology, its stroke 1.75 scaled with it", () => {
    const out = renderToStaticMarkup(createElement(Icon, { name: "like", size: 20 }));
    const expected = renderToStaticMarkup(createElement(lucide.Heart, { size: 20, strokeWidth: 1.75 }));
    expect(out).toMatch(/^<svg\b/);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('focusable="false"');
    expect(out).toContain('width="20"');
    expect(out).toContain('stroke-width="1.75"');
    expect(out).toContain('fill="none"');
    expect(out.replace(/ (?:aria-hidden|focusable|class|fill)="[^"]*"/g, "")).toBe(expected.replace(/ (?:aria-hidden|class|fill)="[^"]*"/g, ""));
    expect(renderToStaticMarkup(createElement(Icon, { name: "like", size: 20, filled: true }))).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(createElement(Icon, { name: "repost", size: 20, strong: true }))).toContain('stroke-width="2.25"');
    for (const name of Object.keys(ICONS) as IconName[]) expect(renderToStaticMarkup(createElement(Icon, { name, size: 24 })), name).toMatch(/^<svg\b/);
  });
});

describe("the layout and motion constants", () => {
  test("useLayout's four kinds start at 768, 1024 and 1280 px; the gutter is 16 px on phones and 20 px wider", () => {
    expect(BREAKPOINTS).toEqual({ tablet: 768, desktop: 1024, wide: 1280 });
    expect([320, 767, 768, 1023, 1024, 1279, 1280, 1920].map(layoutKind)).toEqual(["phone", "phone", "tablet", "tablet", "desktop", "desktop", "wide", "wide"]);
    expect(GUTTER).toEqual({ phone: 16, wider: 20 });
  });

  test("motion.ts holds section 5.1's six values as plain data", () => {
    expect(MOTION).toEqual({
      easeOut: { type: "timing", easing: [0.23, 1, 0.32, 1] },
      easeInOut: { type: "timing", easing: [0.77, 0, 0.175, 1] },
      springSnap: { type: "spring", dampingRatio: 1, duration: 300 },
      springRelease: { type: "spring", dampingRatio: 0.85, duration: 350 },
      press: { type: "timing", in: 100, out: 160, easing: [0.23, 1, 0.32, 1] },
      fade: { type: "timing", duration: 150, easing: [0.23, 1, 0.32, 1] },
    });
  });

  test("tailwind.config.js adds section 4.5's five radii", () => {
    const config = requireFromApp("./tailwind.config.js") as { theme: { extend: { borderRadius: Record<string, string> } } };
    expect(config.theme.extend.borderRadius).toEqual({ control: "10px", media: "12px", card: "16px", sheet: "24px", full: "9999px" });
  });
});
```

### Replace `apps/app/test/explore.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EXPLORE_V2, ExploreStatusKind, type ExploreFormula, type ExplorePage, type MeResponse, type PostView, type TimelineItem } from "@korbat/contracts";
import ExploreAbout, { ExploreRules } from "../src/app/explore/about";
import Home, { homeListKey, homeTab, homeTabs } from "../src/app/index";
import { ExploreSwitch, useExploreSwitch } from "../src/app/settings/privacy";
import { PopularPosts } from "../src/components/PopularNow";
import { ExploreEmpty, ExploreFooter, ExploreHeader } from "../src/components/social/ExploreList";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError } from "../src/lib/api";
import {
  appendUnseen,
  EXPLORE_REFRESHED_NOTICE,
  exploreEmptyText,
  exploreReader,
  exploreRules,
  exploreStatusText,
  exploreSwitchText,
  rankingAge,
  readPages,
  STALE_AFTER_MS,
  type RankingRead,
} from "../src/lib/explore";
import type { ExploreAnswer } from "../src/lib/social";
import { TERMS_SECTIONS, TERMS_VERSION } from "../src/lib/terms";

/**
 * Explore in the web app (2c design, section 11): the tabs, the list, the formula page, the switch, the status line, the
 * chip, the context column and the terms. The helpers that decide (the tab an address names, the lists' keys, the
 * ranking's age, what a page of a new ranking adds, the list's reads, every sentence and its numbers) are called, the
 * reads with fake answers; the screens and components are server-rendered as lifecycle.test.tsx renders its pages; what a
 * static render cannot show (requests, focus, the order of a save) is read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

// expo-router cannot load in Node (it reaches React Native's own modules): Link with `asChild` hands the child its href,
// which react-native-web renders as a real anchor, a screen reads its parameters and the path, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
// A post card's images and the compose sheet's slide reach native modules that do not load in Node; neither is under test.
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source file of the app, with its path from src in forward slashes. */
function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}

/** The body of the function `name` declares at the top of a file, up to its closing brace at the start of a line. */
function block(source: string, name: string): string {
  const from = source.indexOf(`function ${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return source.slice(from, source.indexOf("\n}\n", from));
}

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

/** The text of every link to `href`, in order. */
function linkTexts(markup: string, href: string): string[] {
  const texts: string[] = [];
  for (let at = markup.indexOf(`href="${href}"`); at !== -1; at = markup.indexOf(`href="${href}"`, at + 1)) {
    const start = markup.lastIndexOf("<a ", at);
    const end = markup.indexOf("</a>", at);
    if (start !== -1 && end !== -1) texts.push(markup.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  return texts;
}

/** The opening tag of the button whose text is `label`, or "" when there is none. */
function buttonTag(markup: string, label: string): string {
  const at = markup.indexOf(label);
  const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
  return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
}

/** The tabs of the markup's tab list, in order: each one's text and whether it is selected. */
function tabsOf(markup: string): { label: string; selected: boolean }[] {
  return [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({
    label: match[2] ?? "",
    selected: (match[1] ?? "").includes('aria-selected="true"'),
  }));
}

/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const AUTHOR = "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f";
const OTHER = "1e2d3c4b-5a69-4786-9a5b-4c3d2e1f0a9b";
const AT = "2026-09-28T12:05:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: AUTHOR, handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-09-28T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 3, reposts: 1, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}
// ExplorePage's items are post items only: the contract's refinement narrows the timeline item.
const item = (n: number): ExplorePage["items"][number] => ({ kind: "post", post: post(n) });
const explorePage = (posts: number[], nextCursor: string | null): ExplorePage => ({ items: posts.map(item), nextCursor, computedAt: AT, signInForMore: false });
const ids = (items: TimelineItem[]): string[] => items.map((entry) => entry.post.id);
/** The Date header of an answer carrying the ranking of AT: two and a half minutes after it, by the server's clock. */
const DATE = new Date(Date.parse(AT) + 150_000).toUTCString();
/** When that answer arrived, by the device's clock. */
const RECEIVED = Date.parse(AT) + 151_000;
/** A page of Explore as the app's client answers it: with the answer's Date header and the time it arrived. */
const answer = (posts: number[], nextCursor: string | null, extra: Partial<ExploreAnswer> = {}): ExploreAnswer => ({
  ...explorePage(posts, nextCursor),
  date: DATE,
  receivedAt: RECEIVED,
  ...extra,
});

const ME: MeResponse = {
  user: { id: AUTHOR, email: "ada@example.org", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
  profile: { id: AUTHOR, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true },
  standing: null,
};
const signedIn = (showInExplore = true) => ({ status: "signed-in", me: { ...ME, profile: { ...ME.profile!, showInExplore } } });

describe("Home's tabs and their addresses", () => {
  test("an account has Following, Latest and Explore; everyone else Latest and Explore, Latest first as before", () => {
    expect(homeTabs(true)).toEqual(["following", "latest", "explore"]);
    expect(homeTabs(false)).toEqual(["latest", "explore"]);
  });

  test("the tab is the one /?tab= names, and a missing, unknown or unavailable name means the first tab", () => {
    expect(homeTab(undefined, true)).toBe("following");
    expect(homeTab("latest", true)).toBe("latest");
    expect(homeTab("explore", true)).toBe("explore");
    expect(homeTab(undefined, false)).toBe("latest");
    expect(homeTab("explore", false)).toBe("explore");
    // Following needs an account.
    expect(homeTab("following", false)).toBe("latest");
    expect(homeTab("trending", true)).toBe("following");
    expect(homeTab("Explore", true)).toBe("following");
    // A parameter given twice counts once, by its first value.
    expect(homeTab(["explore", "latest"], true)).toBe("explore");
  });

  test("signed in, Home shows the three tabs with the one the address names selected, and Explore's list under them", () => {
    session.state = signedIn();
    route.params = { tab: "explore" };
    const out = html(<Home />);
    expect(out).toContain('role="tablist"');
    expect(tabsOf(out)).toEqual([
      { label: "Following", selected: false },
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    // The list's header, with its link to the rules.
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    route.params = {};
    const following = html(<Home />);
    expect(tabsOf(following).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Following"]);
    expect(linkTexts(following, "/explore/about")).toEqual([]);
  });

  test("signed out, Home shows Latest and Explore, and the prompt under them fits the tab", () => {
    session.state = { status: "signed-out" };
    route.params = {};
    const latest = html(<Home />);
    expect(tabsOf(latest)).toEqual([
      { label: "Latest", selected: true },
      { label: "Explore", selected: false },
    ]);
    expect(latest).toContain("You are reading the latest public posts. Sign in to follow people and post.");
    route.params = { tab: "explore" };
    const explore = html(<Home />);
    expect(tabsOf(explore)).toEqual([
      { label: "Latest", selected: false },
      { label: "Explore", selected: true },
    ]);
    expect(explore).toContain("Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.");
    // True whatever the list holds: it neither promises more of Explore, which may not exist, nor says posts are being read
    // over a list that may be empty. Only the list's own footer, shown when more posts exist, offers more of it.
    expect(explore).not.toContain("see more of Explore");
    expect(explore).not.toContain("You are reading");
    route.params = { tab: "following" };
    expect(tabsOf(html(<Home />)).filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(["Latest"]);
    route.params = {};
  });

  test("each list is keyed by its tab, the posts written on Home and its reader, so signing in or out, or another account, reads it again", () => {
    // A list read signed out has no cursor and a sign-in link and was read without any block or mute, and the web keeps a
    // Home mounted under the sign-in screen, which Back shows again once signed in.
    const readers = [homeListKey("explore", 0, null), homeListKey("explore", 0, AUTHOR), homeListKey("explore", 0, OTHER)];
    expect(new Set(readers).size).toBe(3);
    expect(homeListKey("latest", 0, null)).not.toBe(homeListKey("latest", 0, AUTHOR));
    // Another tab and a new post still make a new list.
    expect(homeListKey("latest", 0, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    expect(homeListKey("explore", 1, AUTHOR)).not.toBe(homeListKey("explore", 0, AUTHOR));
    // Both lists take their key from it, with the session's account as the reader.
    const home = block(read("app", "index.tsx"), "Home");
    expect(home).toContain('const viewer = state.status === "signed-in" ? state.me.user.id : null;');
    expect(home.match(/key=\{homeListKey\(current, version, viewer\)\}/g)).toHaveLength(2);
  });

  test("a tab is chosen through the address, every link to a tab names one Home has, and Following's empty text points to Latest and Explore", () => {
    const home = read("app", "index.tsx");
    expect(home).toContain("useLocalSearchParams<{ tab?: string }>()");
    expect(home).toContain("const select = (tab: Tab) => router.setParams({ tab });");
    expect(home).toContain('"Nothing here yet. Follow someone, or switch to Latest or Explore."');
    const links = sourceFiles().flatMap((file) => [...file.text.matchAll(/"\/\?tab=([a-z]+)"/g)].map((match) => ({ file: file.name, tab: match[1] ?? "" })));
    // Popular now and How Explore works lead back to the Explore tab.
    expect(links.map((link) => link.file).sort()).toEqual(["app/explore/about.tsx", "components/PopularNow.tsx"]);
    for (const link of links) expect(homeTab(link.tab, false), link.file).toBe(link.tab);
  });
});

describe("the Explore list", () => {
  test("its header says how long ago the ranking was computed, or since when it had not been when read, offers Refresh once a newer one is due, and links to How Explore works", () => {
    /** A ranking of the given age, read just now: the answer's Date header and the device's clock agree. */
    const readNow = (age: number): RankingRead => {
      const now = Date.now();
      return { computedAt: new Date(now - age).toISOString(), date: new Date(now).toUTCString(), receivedAt: now };
    };
    // Five seconds past the minute: the Date header counts whole seconds.
    const fresh = html(<ExploreHeader ranking={readNow(3 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(fresh).toContain("Updated 3 minutes ago");
    expect(buttonTag(fresh, "Refresh")).toBe("");
    expect(linkTexts(fresh, "/explore/about")).toEqual(["How Explore works"]);
    const due = html(<ExploreHeader ranking={readNow(6 * 60_000 + 5_000)} onRefresh={() => undefined} />);
    expect(due).toContain("Updated 6 minutes ago");
    expect(buttonTag(due, "Refresh")).not.toBe("");
    const stale = html(<ExploreHeader ranking={readNow(20 * 60_000)} onRefresh={() => undefined} />);
    expect(stale).toContain("Explore has not been updated since ");
    expect(stale).not.toContain("Updated ");
    expect(buttonTag(stale, "Refresh")).not.toBe("");
    // Before the first round there is no ranking, no time to show and nothing to read again.
    const none = html(<ExploreHeader ranking={null} onRefresh={() => undefined} />);
    expect(none).not.toMatch(/Updated|updated since|Refresh/);
    expect(linkTexts(none, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("the ranking's age is its age when read, by the answer's Date header, plus the time on screen; only its age when read makes it stale", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    /** The ranking in an answer the server sent `served` ms after computing it, which arrived at the device's `receivedAt`. */
    const ranking = (served: number, receivedAt: number): RankingRead => ({ computedAt, date: new Date(t0 + served).toUTCString(), receivedAt });
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
    // A device clock that agrees with the server's.
    const right = t0 + 190_000;
    expect(rankingAge(ranking(30_000, t0 + 30_000), t0 + 30_000)).toMatchObject({ stale: false, text: "Updated just now" });
    expect(rankingAge(ranking(60_000, t0 + 60_000), t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge(ranking(190_000, right), right)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A device clock 20 minutes fast, then one 20 minutes slow: the age at the read is the server's and the time on screen
    // the device's alone, so neither error counts, and neither warns nor calls the ranking new.
    const fast = right + 20 * 60_000;
    expect(rankingAge(ranking(190_000, fast), fast)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    expect(rankingAge(ranking(190_000, fast), fast + 60_000)).toMatchObject({ stale: false, text: "Updated 4 minutes ago" });
    const slow = right - 20 * 60_000;
    expect(rankingAge(ranking(190_000, slow), slow)).toMatchObject({ stale: false, text: "Updated 3 minutes ago" });
    // A page left open counts on, and never turns into the warning: the job has written newer rankings meanwhile.
    expect(rankingAge(ranking(190_000, right), right + 20 * 60_000)).toMatchObject({ stale: false, text: "Updated 23 minutes ago" });
    // Over 15 minutes old when the server answered: by then several rounds have failed or been skipped.
    expect(rankingAge(ranking(15 * 60_000, right), right)).toMatchObject({ stale: false, text: "Updated 15 minutes ago" });
    const stale = rankingAge(ranking(15 * 60_000 + 1000, fast), fast);
    expect(stale.stale).toBe(true);
    expect(stale.text).toMatch(/^Explore has not been updated since .+\.$/);
    expect(stale.text).toContain(new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    // Without a Date header the device's clock is all there is.
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 60_000 }, t0 + 60_000)).toMatchObject({ stale: false, text: "Updated 1 minute ago" });
    expect(rankingAge({ computedAt, date: null, receivedAt: t0 + 20 * 60_000 }, t0 + 20 * 60_000)).toMatchObject({ stale: true });
    // The header counts whole seconds, so a ranking of the same second is not in the future; and a minute clock that last
    // ticked before the answer arrived adds no time on screen.
    expect(rankingAge({ computedAt: "2026-09-28T12:00:00.800Z", date: new Date(t0).toUTCString(), receivedAt: right }, right - 30_000)).toMatchObject({
      stale: false,
      text: "Updated just now",
    });
    // Days later the date is named too, so the time cannot be read as today's.
    const old = new Date(t0 - 3 * 24 * 3600_000);
    const days = rankingAge({ computedAt: old.toISOString(), date: new Date(t0).toUTCString(), receivedAt: t0 }, t0);
    expect(days.stale).toBe(true);
    expect(days.text).toContain(old.toLocaleDateString());
  });

  test("Refresh is offered once the ranking on screen is as old as EXPLORE_V2's refresh interval, when a newer one should exist", () => {
    const computedAt = "2026-09-28T12:00:00.000Z";
    const t0 = Date.parse(computedAt);
    // Read a minute after it was computed, then left on screen.
    const read: RankingRead = { computedAt, date: new Date(t0 + 60_000).toUTCString(), receivedAt: t0 + 60_000 };
    expect(EXPLORE_V2.refreshMinutes).toBe(5);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000 - 1000).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 4 * 60_000).offerRefresh).toBe(true);
    // A ranking that was stale when read is offered at once.
    expect(rankingAge({ ...read, date: new Date(t0 + 16 * 60_000).toUTCString() }, read.receivedAt)).toMatchObject({ stale: true, offerRefresh: true });
    // The interval is the formula's.
    const slower: ExploreFormula = { ...EXPLORE_V2, refreshMinutes: 10 };
    expect(rankingAge(read, read.receivedAt + 9 * 60_000 - 1000, slower).offerRefresh).toBe(false);
    expect(rankingAge(read, read.receivedAt + 9 * 60_000, slower).offerRefresh).toBe(true);
  });

  test("a page adds only the posts not on screen; another page is read only while one adds nothing and more follow", () => {
    const shown = new Set([id(1), id(2), id(3)]);
    const some = appendUnseen(shown, explorePage([2, 4, 1, 5], "c1"));
    expect(ids(some.added)).toEqual([id(4), id(5)]);
    expect(some).toMatchObject({ nextCursor: "c1", fetchNext: false });
    expect(appendUnseen(shown, explorePage([3, 1], "c2"))).toEqual({ added: [], nextCursor: "c2", fetchNext: true });
    // The ranking ends.
    expect(appendUnseen(shown, explorePage([2], null))).toEqual({ added: [], nextCursor: null, fetchNext: false });
    // A page whose posts the reader's blocks and mutes all took out is not the end while a cursor follows it.
    expect(appendUnseen(shown, explorePage([], "c3"))).toEqual({ added: [], nextCursor: "c3", fetchNext: true });
    // A post is added once, and the set on screen is left as it was.
    expect(ids(appendUnseen(shown, explorePage([6, 6], null)).added)).toEqual([id(6)]);
    expect([...shown]).toEqual([id(1), id(2), id(3)]);
  });

  /** A fake Explore: each cursor (the first page's is "first") answers a page or an error, and every request is recorded. */
  function fakeExplore(answers: Record<string, ExplorePage | Error>) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExplorePage> => {
      calls.push(cursor);
      const answer = answers[cursor ?? "first"];
      if (!answer) throw new Error(`no page for ${cursor ?? "first"}`);
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { fetchPage, calls };
  }
  const refreshed = () => new ApiError(409, "explore_refreshed", "Explore was refreshed.");

  test("Load more reads the next page of the ranking being paged", async () => {
    const fake = fakeExplore({ c1: explorePage([3, 4], "c2") });
    const result = await readPages(fake.fetchPage, "c1", new Set([id(1), id(2)]));
    expect(fake.calls).toEqual(["c1"]);
    expect(ids(result.added)).toEqual([id(3), id(4)]);
    expect(result).toMatchObject({ nextCursor: "c2", refreshed: false });
  });

  test("when the ranking being paged is gone, the new one is read from its first page, keeping only unseen posts, until a page adds some", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([1, 5, 2, 6], "n2") });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(ids(result.added)).toEqual([id(5), id(6)]);
    expect(result).toMatchObject({ nextCursor: "n2", refreshed: true });
    expect(result.last?.computedAt).toBe(AT);
  });

  test("... or until the new ranking ends", async () => {
    const fake = fakeExplore({ c2: refreshed(), first: explorePage([2, 1], "n1"), n1: explorePage([3], null) });
    const result = await readPages(fake.fetchPage, "c2", new Set([id(1), id(2), id(3)]));
    expect(fake.calls).toEqual(["c2", undefined, "n1"]);
    expect(result).toMatchObject({ added: [], nextCursor: null, refreshed: true });
  });

  test("any other failure is the list's to show, a first page is never a refresh, and one read is bounded", async () => {
    const failing = fakeExplore({ c1: new ApiError(500, "internal", "Something went wrong on our side. Try again.") });
    await expect(readPages(failing.fetchPage, "c1", new Set())).rejects.toMatchObject({ code: "internal" });
    // Only a cursor names a ranking: the first page is always the current one.
    const first = fakeExplore({ first: refreshed() });
    await expect(readPages(first.fetchPage, undefined, new Set())).rejects.toMatchObject({ code: "explore_refreshed" });
    expect(first.calls).toEqual([undefined]);
    const empty = fakeExplore({ first: explorePage([], "x"), x: explorePage([], "x") });
    const result = await readPages(empty.fetchPage, undefined, new Set(), 3);
    expect(empty.calls).toHaveLength(3);
    expect(result).toMatchObject({ added: [], nextCursor: "x" });
  });

  test("the footer: a polite status line always in the tree, Load more while the ranking has more, and signed out the sign-in link when more exist", () => {
    expect(EXPLORE_REFRESHED_NOTICE).toBe("Explore was refreshed; the posts below come from the new ranking.");
    const quiet = html(<ExploreFooter cursor={null} signInForMore={false} notice={null} error={null} onLoadMore={() => undefined} />);
    const status = /<div[^>]*role="status"[^>]*>/.exec(quiet)?.[0] ?? "";
    expect(status).toContain('aria-live="polite"');
    // It can take the focus when Load more, which had it, leaves the tree.
    expect(status).toContain('tabindex="-1"');
    expect(quiet).not.toContain("Load more");
    expect(linkTexts(quiet, "/signin")).toEqual([]);
    const after = html(<ExploreFooter cursor="n2" signInForMore={false} notice={EXPLORE_REFRESHED_NOTICE} error={null} onLoadMore={() => undefined} />);
    expect(after).toMatch(/role="status"[^>]*><div[^>]*>Explore was refreshed; the posts below come from the new ranking\.<\/div>/);
    expect(buttonTag(after, "Load more")).not.toBe("");
    const signedOut = html(<ExploreFooter cursor={null} signInForMore notice={null} error={null} onLoadMore={() => undefined} />);
    expect(linkTexts(signedOut, "/signin")).toEqual(["Sign in to see more of Explore"]);
  });

  /** A fake Explore answering its requests in order from `script`, each a page or a failure, and recording each cursor. */
  function scripted(script: (ExploreAnswer | Error)[]) {
    const calls: (string | undefined)[] = [];
    const fetchPage = async (cursor?: string): Promise<ExploreAnswer> => {
      calls.push(cursor);
      const next = script.shift();
      if (!next) throw new Error(`no answer left for ${cursor ?? "first"}`);
      if (next instanceof Error) throw next;
      return next;
    };
    return { fetchPage, calls };
  }

  test("the list's reader lets one read run at a time: a load meanwhile fetches nothing and answers null, and each read answers what the list shows", async () => {
    const calls: (string | undefined)[] = [];
    const held: ((page: ExploreAnswer) => void)[] = [];
    const reader = exploreReader((cursor) => {
      calls.push(cursor);
      return new Promise<ExploreAnswer>((resolve) => held.push(resolve));
    });
    const first = reader.load();
    // Pull to refresh, Refresh or Load more while the first read runs: nothing is fetched and nothing changes on screen.
    expect(await reader.load()).toBeNull();
    expect(await reader.load("c0")).toBeNull();
    expect(calls).toEqual([undefined]);
    held[0]!(answer([1, 2], "c1"));
    const shown = await first;
    expect(ids(shown!.items)).toEqual([id(1), id(2)]);
    expect(shown).toMatchObject({ cursor: "c1", signInForMore: false, refreshed: false });
    // The ranking's time with the Date header and the arrival of the answer that carried it, which the header ages it by.
    expect(shown!.ranking).toEqual({ computedAt: AT, date: DATE, receivedAt: RECEIVED });
    // Once it has answered the next read runs, and a double press of Load more appends its page once.
    const more = reader.load("c1");
    expect(await reader.load("c1")).toBeNull();
    expect(calls).toEqual([undefined, "c1"]);
    held[1]!(answer([3], null));
    expect(await more).toMatchObject({ cursor: null, refreshed: false });
    expect(ids((await more)!.items)).toEqual([id(1), id(2), id(3)]);
  });

  test("after explore_refreshed the reader appends from the current ranking only the posts not already on screen, and goes on from there", async () => {
    const fake = scripted([answer([1, 2], "c1"), refreshed(), answer([2, 1, 5], "n1"), answer([5, 6], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    const after = await reader.load("c1");
    expect(fake.calls).toEqual([undefined, "c1", undefined]);
    // The posts read stay where they are, once each; the new ranking adds what was not on screen, and the list says so.
    expect(ids(after!.items)).toEqual([id(1), id(2), id(5)]);
    expect(after).toMatchObject({ cursor: "n1", refreshed: true });
    // What it added is on screen now as well: a page holding it again adds only the rest.
    const next = await reader.load("n1");
    expect(ids(next!.items)).toEqual([id(1), id(2), id(5), id(6)]);
    expect(next).toMatchObject({ cursor: null, refreshed: false });
  });

  test("a failed read throws, leaves what the list shows as it was and lets the next load run", async () => {
    const offline = () => new ApiError(0, "network", "Cannot reach korbat. Check your connection.");
    const fake = scripted([offline(), answer([1, 2], "c1"), offline(), answer([3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await expect(reader.load()).rejects.toMatchObject({ code: "network" });
    expect(ids((await reader.load())!.items)).toEqual([id(1), id(2)]);
    await expect(reader.load("c1")).rejects.toMatchObject({ code: "network" });
    // Load more again: its page comes below the posts that stayed.
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3)]);
    expect(fake.calls).toEqual([undefined, undefined, "c1", "c1"]);
  });

  test("a load without a cursor starts over: the first page in place of everything on screen, from which Load more goes on", async () => {
    const later = "2026-09-28T12:10:00.000Z";
    const fake = scripted([answer([1, 2], "c1"), answer([3, 4], "c2"), answer([5, 1], "d1", { computedAt: later }), answer([2, 3], null)]);
    const reader = exploreReader(fake.fetchPage);
    await reader.load();
    expect(ids((await reader.load("c1"))!.items)).toEqual([id(1), id(2), id(3), id(4)]);
    const again = await reader.load();
    expect(ids(again!.items)).toEqual([id(5), id(1)]);
    expect(again).toMatchObject({ cursor: "d1", refreshed: false });
    expect(again!.ranking?.computedAt).toBe(later);
    // The posts shown before it are no longer on screen, so a page holding them adds them like any other.
    expect(ids((await reader.load("d1"))!.items)).toEqual([id(5), id(1), id(2), id(3)]);
  });

  test("a post deleted from the list leaves the reader's list too, even while a read is in flight", async () => {
    let release: ((page: ExploreAnswer) => void) | undefined;
    const reader = exploreReader((cursor) => (cursor === undefined ? Promise.resolve(answer([1, 2], "c1")) : new Promise<ExploreAnswer>((resolve) => (release = resolve))));
    await reader.load();
    const more = reader.load("c1");
    expect(ids(reader.remove(id(2)).items)).toEqual([id(1)]);
    release!(answer([3], null));
    expect(ids((await more)!.items)).toEqual([id(1), id(3)]);
  });

  test("the sign-in flag comes from the last page read, and before the first round there is no ranking to age", async () => {
    const fake = scripted([answer([], null, { computedAt: null }), answer([1], null, { signInForMore: true })]);
    const reader = exploreReader(fake.fetchPage);
    expect(await reader.load()).toMatchObject({ items: [], cursor: null, ranking: null, signInForMore: false });
    expect(await reader.load()).toMatchObject({ cursor: null, ranking: { computedAt: AT }, signInForMore: true });
  });

  test("the list shows what one reader of its own answers, reads the first page again from pull to refresh and Refresh, announces a refresh and keeps the focus", () => {
    const list = block(read("components", "social", "ExploreList.tsx"), "ExploreList");
    const at = (code: string): number => {
      const index = list.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    // Made once with the list, so its state lives and ends with it.
    expect(list).toContain("const [reader] = useState(() => exploreReader(social.explore));");
    // An answer is what the list shows; null, while another read runs, changes nothing.
    expect(at("const answer = await reader.load(after);")).toBeLessThan(at("if (!answer) return;"));
    expect(at("if (!answer) return;")).toBeLessThan(at("setShown(answer);"));
    expect(at("setShown(answer);")).toBeLessThan(at("if (answer.refreshed) {"));
    expect(at("if (answer.refreshed) {")).toBeLessThan(at("setNotice(EXPLORE_REFRESHED_NOTICE);"));
    expect(list).toContain("const remove = (id: string) => setShown(reader.remove(id));");
    // Its posts, Load more's cursor, the ranking's time and the sign-in link all come from the answer.
    for (const wire of [
      "data={shown.items}",
      "<ExploreHeader ranking={shown.ranking} onRefresh={() => refresh(true)} lineRef={line} />",
      "onRefresh={() => refresh(false)}",
      "cursor={shown.cursor}",
      "signInForMore={shown.signInForMore}",
      "if (shown.cursor) void load(shown.cursor);",
      "statusRef={footer}",
      // The empty state is an element, with its own links, not a line of text.
      "<ExploreEmpty onShowLatest={onShowLatest} />",
    ]) {
      expect(list, wire).toContain(wire);
    }
    // After a refresh the focus stays at the footer; after the header's Refresh it goes to the line saying how old the
    // ranking now is, since the button leaves the tree once the ranking is fresh.
    expect(list).toContain("if (refreshes > 0 && shown.cursor === null) (footer.current as unknown as { focus?: () => void } | null)?.focus?.();");
    expect(list).toContain("if (lineFocus > 0) (line.current as unknown as { focus?: () => void } | null)?.focus?.();");
  });

  test("the empty state is worded from EXPLORE_V2, links to How Explore works and offers Show Latest", () => {
    expect(exploreEmptyText()).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 3 other accounts, each at least 2 days old, like or repost it in its first 48 hours. Explore is refreshed every 5 minutes.",
    );
    // Every number comes from the formula: another formula words another sentence.
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, windowHours: 24, refreshMinutes: 10 };
    expect(exploreEmptyText(other)).toBe(
      "Nothing to show in Explore right now. A post appears here when at least 5 other accounts, each at least 3 days old, like or repost it in its first 24 hours. Explore is refreshed every 10 minutes.",
    );
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 36 })).toContain("each at least 36 hours old");
    expect(exploreEmptyText({ ...EXPLORE_V2, engagerMinAgeHours: 24 })).toContain("each at least 1 day old");
    const out = html(<ExploreEmpty onShowLatest={() => undefined} />);
    expect(out).toContain(exploreEmptyText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
    expect(buttonTag(out, "Show Latest")).not.toBe("");
    expect(textOf(html(<ExploreEmpty onShowLatest={() => undefined} formula={other} />))).toContain("at least 5 other accounts");
  });
});

describe("How Explore works", () => {
  test("states every number of the formula from EXPLORE_V2, with the version and the change log", () => {
    const out = textOf(html(<ExploreRules />));
    for (const phrase of [
      "Original posts from the last 48 hours",
      "was at least 2 days old when it liked or reposted",
      "has stood for at least 10 minutes",
      "A post needs at least 3 approving accounts.",
      "divided by (the hours it has been shown since it was posted + 2) to the power 1.8",
      "Explore holds the 300 posts with the highest scores, with at most 2 posts of one account",
      "A new ranking is computed every 5 minutes, never sooner than 4.5 minutes after the last one.",
      "The newest 2 rankings are kept",
      "Signed out, you see the first 20 posts.",
      "Explore stays empty for about 2 days after it opens",
      "This is version 2 of the formula.",
      "Version 1, 2026-09-28: First version.",
      // The second entry of the change log, word for word (3e design, section 9.7).
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked, and a suspended account's likes and reposts do not count. A post that moderation hid and then restored gets back the time it was hidden.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
  });

  test("version 2's rules in the design's words: what is ranked, what counts and the score name suspension and the time given back (3e)", () => {
    const body = (title: string) => exploreRules().find((section) => section.title === title)?.body;
    expect(body("What is ranked")).toBe(
      "Original posts from the last 48 hours: posts that are not replies or quotes, by accounts that have not switched Explore off and are not suspended when the ranking is computed. Replies belong to their threads. Quotes do not enter, because a quote that mocks another post would put that post under the mockery on a public page.",
    );
    expect(body("What counts")).toBe(
      "One thing: the post's approving accounts, meaning the accounts other than its author that liked or reposted it. An account that both liked and reposted a post counts once. A like or repost counts when its account still exists, is not suspended when the ranking is computed, was at least 2 days old when it liked or reposted, and the like or repost has stood for at least 10 minutes. Replies and quotes do not count, so a pile-on of replies cannot lift a post. Followers, the verified badge and reports are never used.",
    );
    expect(body("The score")).toBe(
      "A post needs at least 3 approving accounts. Its score is the number of approving accounts divided by (the hours it has been shown since it was posted + 2) to the power 1.8, so a newer post needs fewer approving accounts to rank as high as an older one. A post that korbat's moderation hid and then restored gets that time back: its window and its age stand still while it is not shown.",
    );
    // Server-rendered on How Explore works, each whole.
    const out = textOf(html(<ExploreRules />));
    for (const title of ["What is ranked", "What counts", "The score"]) expect(out, title).toContain(body(title)!);
  });

  test("follows the formula it is given: another formula's numbers, version and change log", () => {
    const other: ExploreFormula = {
      ...EXPLORE_V2,
      version: 3,
      windowHours: 72,
      engagerMinAgeHours: 96,
      standingMinutes: 15,
      threshold: 7,
      gravity: 1.5,
      offsetHours: 3,
      perAuthor: 4,
      listLength: 100,
      refreshMinutes: 10,
      minGapMinutes: 9,
      kept: 3,
      signedOutPage: 10,
      changes: [...EXPLORE_V2.changes, { version: 3, date: "2026-12-01", summary: "A later version." }],
    };
    const out = textOf(html(<ExploreRules formula={other} />));
    for (const phrase of [
      "Original posts from the last 72 hours",
      "was at least 4 days old when it liked or reposted",
      "has stood for at least 15 minutes",
      "A post needs at least 7 approving accounts.",
      "(the hours it has been shown since it was posted + 3) to the power 1.5",
      "Explore holds the 100 posts with the highest scores, with at most 4 posts of one account",
      "every 10 minutes, never sooner than 9 minutes after the last one",
      "The newest 3 rankings are kept",
      "Signed out, you see the first 10 posts.",
      "Explore stays empty for about 4 days after it opens",
      "This is version 3 of the formula.",
      "Version 1, 2026-09-28: First version.",
      "Version 2, 2026-10-12: Posts of suspended accounts are not ranked",
      "Version 3, 2026-12-01: A later version.",
    ]) {
      expect(out, phrase).toContain(phrase);
    }
    for (const phrase of ["48 hours", "2 days", "at least 3 approving", "300 posts", "power 1.8", "version 2 of"]) expect(out, phrase).not.toContain(phrase);
  });

  test("says what takes a post out besides the formula, in the design's words: a suspension, never Explore alone, and no longer the automatic checks", () => {
    const rule = exploreRules().find((section) => section.title === "What else takes a post out");
    expect(rule?.body).toBe(
      "Besides the formula, only these take a post out of Explore: its moderation state, set by a moderator for every list at once; a suspension of its author, which a moderator decides with a statement of reasons and which stops everything the account writes, never Explore alone; its author's switch or deletion; a block between you and the author in either direction; your mute. No moderator or automatic lever acts on Explore alone.",
    );
    // Rulebook version 2 has no automatic R1 and R2 checks, so the page names none.
    expect(rule?.body).not.toContain("automatic R1 and R2 checks");
    expect(textOf(html(<ExploreRules />))).toContain(rule!.body);
  });

  test("is a public page with the rules under its title", () => {
    session.state = { status: "signed-out" };
    const out = html(<ExploreAbout />);
    expect(out).toMatch(/<h1[^>]*>How Explore works<\/h1>/);
    expect(textOf(out)).toContain("A post needs at least 3 approving accounts.");
    // Nothing on the page asks who is reading: the rules are the same for everyone, signed in or not.
    expect(read("app", "explore", "about.tsx")).not.toMatch(/Redirect|useSession/);
  });
});

describe("Settings > Privacy: Show my posts in Explore", () => {
  const switchTag = (markup: string): string => /<input[^>]*role="switch"[^>]*>/.exec(markup)?.[0] ?? "";
  /** The switch as Privacy shows it: its state from the hook, which reads the session. */
  function SessionSwitch() {
    return <ExploreSwitch {...useExploreSwitch()} />;
  }

  test("is a switch named Show my posts in Explore, whose state is /api/me's", () => {
    session.state = signedIn(true);
    const on = switchTag(html(<SessionSwitch />));
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('aria-label="Show my posts in Explore"');
    expect(on).toContain('checked=""');
    expect(on).not.toContain("disabled");
    session.state = signedIn(false);
    const off = switchTag(html(<SessionSwitch />));
    expect(off).toContain('aria-label="Show my posts in Explore"');
    expect(off).not.toContain("checked");
  });

  test("shows what it is given: the value being saved, disabled while the save runs, and a failed save's error", () => {
    const saving = switchTag(html(<ExploreSwitch on={false} busy error={null} change={async () => undefined} />));
    expect(saving).not.toContain("checked");
    expect(saving).toContain('disabled=""');
    const failed = html(<ExploreSwitch on busy={false} error="Cannot reach korbat. Check your connection." change={async () => undefined} />);
    expect(switchTag(failed)).toContain('checked=""');
    expect(switchTag(failed)).not.toContain("disabled");
    expect(textOf(failed)).toContain("Cannot reach korbat. Check your connection.");
  });

  test("its one sentence says turning it off takes effect at once and turning it back on at the next refresh", () => {
    expect(exploreSwitchText()).toBe(
      "Your public posts can appear in Explore when other accounts like or repost them: turning this off takes them out at once, and turning it back on takes effect at the next refresh, which comes every 5 minutes.",
    );
    expect(exploreSwitchText({ ...EXPLORE_V2, refreshMinutes: 10 })).toContain("at the next refresh, which comes every 10 minutes.");
    session.state = signedIn(true);
    const out = html(<SessionSwitch />);
    expect(out).toContain(exploreSwitchText());
    expect(linkTexts(out, "/explore/about")).toEqual(["How Explore works"]);
  });

  test("its state and its save live in Privacy, above the list that the Blocked and Muted tabs remount, so a tab change during a save loses neither", () => {
    const privacy = read("app", "settings", "privacy.tsx");
    const screen = block(privacy, "Privacy");
    expect(screen).toContain("const explore = useExploreSwitch();");
    expect(screen).toContain("<ExploreSwitch {...explore} />");
    // The list stays keyed by the tab, so the old tab's rows never show with the new tab's Unblock or Unmute.
    expect(screen).toContain("key={tab}");
    // The switch in the list's header only shows what it is given: it has no state a remount could reset.
    expect(block(privacy, "ExploreSwitch")).not.toMatch(/useState|useEffect|useSession/);
  });

  test("saves with POST or DELETE /api/me/explore while disabled, puts the switch back with the error on failure, and then refreshes the session", () => {
    expect(read("lib", "social.ts")).toContain('setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),');
    const privacy = read("app", "settings", "privacy.tsx");
    expect(privacy).toContain('<Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)}');
    const change = block(privacy, "useExploreSwitch");
    const at = (code: string): number => {
      const index = change.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (busy) return;")).toBeLessThan(at("setBusy(true);"));
    expect(at("setOn(next);")).toBeLessThan(at("await social.setShowInExplore(next);"));
    expect(at("await social.setShowInExplore(next);")).toBeLessThan(at("await refresh();"));
    expect(at("} catch (err) {")).toBeLessThan(at("setOn(before);"));
    expect(at("setOn(before);")).toBeLessThan(at("setError(errorMessage(err));"));
    expect(at("} finally {")).toBeLessThan(at("setBusy(false);"));
  });
});

describe("the author's status line", () => {
  test("words every status in the formula's words, with EXPLORE_V2's numbers, and nothing for a reply or a quote", () => {
    const expected: Record<ExploreStatusKind, string | null> = {
      reply: null,
      quote: null,
      not_visible: "Not in Explore: posts under review or removed never appear there.",
      // 3e design, section 9.7, word for word.
      suspended:
        "Not in Explore: your account is suspended, and posts of suspended accounts do not appear there. A post still in its window when the suspension ends can appear from the next refresh.",
      hidden_by_author: "Not in Explore: you turned off Show my posts in Explore.",
      listed: "In Explore",
      outside_window: "Not in Explore: posts can appear only in their first 48 hours, not counting time in which korbat's moderation kept them from being shown.",
      no_ranking: "Not in Explore yet: the first ranking has not been computed.",
      new_since_ranking: "Not in Explore yet: it is newer than the current ranking, so the next refresh will consider it.",
      below_threshold:
        "Not in Explore: fewer than 3 approving accounts. Your own likes, accounts under 2 days old and likes from the last 10 minutes do not count.",
      pending: "Not in Explore yet: the next refresh will consider it.",
      author_cap: "Not in Explore: two of your posts rank above it.",
      below_cutoff: "Not in Explore: it ranks below the 300 posts Explore holds.",
    };
    for (const status of ExploreStatusKind.options) expect(exploreStatusText(status), status).toBe(expected[status]);
  });

  test("takes its numbers from the formula", () => {
    const other: ExploreFormula = { ...EXPLORE_V2, threshold: 5, engagerMinAgeHours: 72, standingMinutes: 15, windowHours: 24, perAuthor: 3, listLength: 100 };
    expect(exploreStatusText("below_threshold", other)).toBe(
      "Not in Explore: fewer than 5 approving accounts. Your own likes, accounts under 3 days old and likes from the last 15 minutes do not count.",
    );
    expect(exploreStatusText("author_cap", other)).toBe("Not in Explore: three of your posts rank above it.");
    expect(exploreStatusText("author_cap", { ...EXPLORE_V2, perAuthor: 1 })).toBe("Not in Explore: one of your posts ranks above it.");
    expect(exploreStatusText("below_cutoff", other)).toBe("Not in Explore: it ranks below the 100 posts Explore holds.");
    expect(exploreStatusText("outside_window", other)).toBe(
      "Not in Explore: posts can appear only in their first 24 hours, not counting time in which korbat's moderation kept them from being shown.",
    );
  });

  test("shows under the author's own top-level post only, never a reply's or a quote's, with links to How Explore works and to the switch", () => {
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain("{mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}");
    expect(thread).toContain(".exploreStatus(id)");
    expect(thread).toContain("exploreStatusText(answer.status)");
    const line = block(thread, "ExploreStatusLine");
    expect(line).toContain('<Link href="/explore/about" asChild>');
    expect(line).toContain('<Link href="/settings/privacy" asChild>');
    expect(read("lib", "social.ts")).toContain("exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),");
  });

  test("the line and the post are read again whenever the screen gains focus, so both follow a change of the switch made through the line's own link", () => {
    // The web keeps the post's screen mounted under Settings > Privacy, and Back shows that same screen again.
    const thread = read("app", "post", "[id].tsx");
    expect(thread).toContain('import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";');
    // The line asks on every focus, as the sign-in screen's autofill starts on every focus, not once per post.
    const line = block(thread, "ExploreStatusLine");
    expect(line).toMatch(/useFocusEffect\(\s+useCallback\(\(\) => \{[\s\S]*?\.exploreStatus\(id\)[\s\S]*?\}, \[id\]\),\s+\);/);
    expect(line).not.toContain("useEffect(");
    // Another post's line never shows under this one while this one's is read.
    expect(line).toContain("const text = line?.id === id ? line.text : null;");
    // The screen reads its post again on every focus after the first, into the thread on screen and without clearing it,
    // so the card's In Explore chip follows; the first focus is the mount, whose read is the thread's own.
    const screen = block(thread, "Thread");
    const focus = screen.slice(screen.indexOf("useFocusEffect("), screen.indexOf("}, [id]),", screen.indexOf("useFocusEffect(")));
    const at = (code: string): number => {
      const index = focus.indexOf(code);
      expect(index, code).toBeGreaterThan(0);
      return index;
    };
    expect(at("if (focusedFor.current !== id) {")).toBeLessThan(at("focusedFor.current = id;"));
    expect(at("focusedFor.current = id;")).toBeLessThan(at(".getPost(id)"));
    expect(at(".getPost(id)")).toBeLessThan(at("setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));"));
    expect(focus).not.toContain("setThread(null)");
    expect(focus).not.toContain("setError(");
  });
});

describe("the In Explore chip", () => {
  test("shows on the author's own card while the post is in Explore, as a link to the post", () => {
    session.state = signedIn();
    const listed = html(<PostCard post={post(7, { inExplore: true })} />);
    expect(linkTexts(listed, `/post/${id(7)}`)).toContain("In Explore");
    expect(html(<PostCard post={post(7)} />)).not.toContain("In Explore");
    // Nobody else's view carries the flag, and a card never shows it on someone else's post.
    const bob = { id: OTHER, handle: "bob", displayName: "Bob", verified: false };
    expect(html(<PostCard post={post(8, { author: bob, inExplore: true })} />)).not.toContain("In Explore");
    session.state = { status: "signed-out" };
    expect(html(<PostCard post={post(7, { inExplore: true })} />)).not.toContain("In Explore");
  });
});

describe("the context column", () => {
  test("Popular now lists posts as links to their threads, an image-only post by its image's description, then a link to Explore", () => {
    const image = { id: id(90), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    const out = html(<PopularPosts posts={[post(1), post(2, { body: "", media: [image] }), post(3)]} />);
    expect(out).toMatch(/<h2[^>]*>Popular now<\/h2>/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual([`/post/${id(1)}`, `/post/${id(2)}`, `/post/${id(3)}`, "/?tab=explore"]);
    expect(linkTexts(out, `/post/${id(1)}`)[0]).toContain("post number 1");
    expect(linkTexts(out, `/post/${id(2)}`)[0]).toContain("Image: A green square");
    expect(linkTexts(out, "/?tab=explore")).toEqual(["More in Explore"]);
  });

  test("sits above the handle box on wide screens and asks Explore for its first three posts", () => {
    expect(read("components", "AppShell.tsx")).toMatch(/<PopularNow \/>\s*<HandleBox \/>/);
    expect(read("lib", "social.ts")).toContain('popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),');
    expect(read("components", "PopularNow.tsx")).toContain(".popular()");
    // The handle box is no longer the only way to find anyone.
    expect(read("components", "HandleBox.tsx")).not.toContain("only discovery tool");
  });
});

describe("the terms", () => {
  test("say that public posts can appear in Explore, where its rules are and how to keep one's posts out, without a new version", () => {
    const sentence =
      "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.";
    expect(TERMS_SECTIONS.filter((section) => section.body.includes(sentence))).toHaveLength(1);
    expect(TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("no screen caches or stores Explore's answers", () => {
  test("the files that ask for Explore keep its answers in component state only: no browser storage, no cache, no module-level variable", () => {
    const callers = sourceFiles().filter((file) => /social\s*\.(explore|popular|exploreStatus)\b/.test(file.text));
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/PopularNow.tsx", "components/social/ExploreList.tsx"]);
    const explore = sourceFiles().filter((file) => [...callers.map((caller) => caller.name), "lib/explore.ts", "app/explore/about.tsx"].includes(file.name));
    expect(explore).toHaveLength(5);
    for (const file of explore) {
      expect(file.text, file.name).not.toMatch(/localStorage|sessionStorage|indexedDB|AsyncStorage|caches\./);
      expect(file.text, file.name).not.toMatch(/^(export )?(let|var) /m);
      expect(file.text, file.name).not.toMatch(/^(export )?const \w+ = new (Map|Set|WeakMap)\b/m);
    }
    // What the app keeps in the browser is the device id, the passkey card's Not now and the reader's appearance, nothing else.
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/appearance.ts", "lib/passkeys.ts"]);
    // Explore's requests are the client's plain calls, which the API answers no-store.
    const social = read("lib", "social.ts");
    for (const line of social.split("\n").filter((text) => text.includes("/api/timeline/explore") || text.includes("/explore`"))) expect(line).not.toMatch(/cache/i);
  });
});
```

### Replace `apps/app/vitest.config.mts` (whole file)

```text
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The tests run in Node against react-native-web, which is what `react-native` means in the web
 * build, so they see the HTML a browser gets. `@/` is the app's source folder, as tsconfig.json's
 * paths say, so a test can load a screen that imports its components that way. A file's `.web`
 * twin is found before the file itself, as Metro finds it for the web build (Icon.web.tsx before
 * Icon.tsx), followed by Vite's own default list.
 */
export default defineConfig({
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".web.js", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"] },
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/01-tokens-fonts-text-icon-theme.md 3
```

Expected: 27 lines starting with `wrote`, one for each file below.

### Create `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-mono-OFL.txt`

```text
Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next-mono) AtkinsonHyperlegibleMono-Italic[wght].ttf: Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next-mono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Create `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-next-OFL.txt`

```text
Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) AtkinsonHyperlegibleNext-Italic[wght].ttf: Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Create `apps/app/assets/fonts/LICENSES/fraunces-OFL.txt`

```text
Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) Fraunces-Italic[SOFT,WONK,opsz,wght].ttf: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Create `apps/app/public/theme-boot.js`

```js
// korbat's first frame (UI design, section 4.2). The page's policy allows no inline script, so this plain file runs
// first in the head, before the bundle and its stylesheet: it reads the reader's appearance as src/lib/appearance.ts
// stores it, resolves System with the system's scheme, and marks the html element with the theme's class, the text
// step and the font. The stylesheet that holds the colours has not arrived yet, so the page's surface and ink-high
// are carried here too (test/contrast.test.ts holds them equal to src/theme/tokens.ts). Any failure leaves the default.
(function () {
  var COLOURS = { light: ["#F6F5F9", "#15131B"], dim: ["#1B1A24", "#F1EFF6"], dark: ["#100F16", "#F3F1F7"] };
  var stored = {};
  try {
    var parsed = JSON.parse(window.localStorage.getItem("korbat.appearance") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
  } catch (error) {
    stored = {};
  }
  var pick = function (value, choices, fallback) {
    return choices.indexOf(value) >= 0 ? value : fallback;
  };
  var theme = pick(stored.theme, ["system", "light", "dim", "dark"], "system");
  if (theme === "system") {
    var dark = false;
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (error) {
      dark = false;
    }
    theme = dark ? pick(stored.darkStyle, ["dim", "dark"], "dark") : "light";
  }
  var root = document.documentElement;
  root.classList.remove("light", "dim", "dark");
  root.classList.add(theme);
  root.setAttribute("data-text-step", pick(stored.textStep, ["smaller", "default", "larger", "largest"], "default"));
  root.setAttribute("data-font", pick(stored.font, ["korbat", "system"], "korbat"));
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  root.style.backgroundColor = COLOURS[theme][0];
  root.style.color = COLOURS[theme][1];
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", COLOURS[theme][0]);
})();
```

### Create `apps/app/src/components/icons.ts`

```ts
import type { Tone } from "./kit/Text";

/**
 * The closed list of icons korbat draws (UI design, section 4.7), each mapped to its Lucide 1.55.0 export name. The
 * names are strings, so this file imports neither icon package: kit/Icon.web.tsx imports the components from
 * lucide-react and kit/Icon.tsx from lucide-react-native, each as a Record<IconName, ...>, so tsc refuses a name that
 * either side lacks, only listed icons are bundled, and the web export and the unit tests never load the native set.
 * restricted and hidden share EyeOff: not shown to others, as on a hidden image (Lucide's Ban, a prohibition sign, is
 * not used). Trash2 is Lucide's own name, which 1.55.0 exports as an alias of Trash.
 */
export const ICONS = {
  home: "House",
  bookmarks: "Bookmark",
  profile: "CircleUser",
  settings: "Settings",
  compose: "SquarePen",
  reply: "MessageCircle",
  repost: "Repeat2",
  quote: "Quote",
  like: "Heart",
  more: "Ellipsis",
  "who-sees": "Eye",
  "copy-link": "Link",
  delete: "Trash2",
  report: "Flag",
  close: "X",
  back: "ArrowLeft",
  newer: "ArrowUp",
  previous: "ChevronLeft",
  next: "ChevronRight",
  "add-image": "ImagePlus",
  error: "CircleAlert",
  offline: "WifiOff",
  done: "CircleCheck",
  review: "Clock",
  restricted: "EyeOff",
  verified: "BadgeCheck",
  explore: "Compass",
  hidden: "EyeOff",
  security: "Shield",
  privacy: "Lock",
  "edit-profile": "UserPen",
  account: "UserCog",
  cases: "Scale",
  appearance: "Palette",
  "sign-in": "LogIn",
  passkey: "KeyRound",
  external: "ExternalLink",
  info: "Info",
  retry: "RotateCw",
} as const;

export type IconName = keyof typeof ICONS;

/** The sizes an icon is drawn at: 24 in the nav and tab bar, 20 in post actions, buttons and rows, 16 inline with meta text, 14 in chips. */
export type IconSize = 14 | 16 | 20 | 24;

/** What Icon takes, the same on web and native (kit/Icon.web.tsx and kit/Icon.tsx). */
export interface IconProps {
  name: IconName;
  /** Defaults to 20, the size of post actions, buttons and rows. */
  size?: IconSize;
  /** The colour, as Text's tones; ink-high by default. */
  tone?: Tone;
  /** Filled with its own colour: Heart and Bookmark when on. */
  filled?: boolean;
  /** Stroke 2.25 instead of 1.75: the current nav item, a reposted Repeat2. */
  strong?: boolean;
}
```

### Create `apps/app/src/components/kit/Icon.tsx`

```tsx
import type { LucideIcon } from "lucide-react-native";
import {
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleUser,
  Clock,
  Compass,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Heart,
  House,
  ImagePlus,
  Info,
  KeyRound,
  Link,
  Lock,
  LogIn,
  MessageCircle,
  Palette,
  Quote,
  Repeat2,
  RotateCw,
  Scale,
  Settings,
  Shield,
  SquarePen,
  Trash2,
  UserCog,
  UserPen,
  WifiOff,
  X,
} from "lucide-react-native";
import type { IconName, IconProps } from "@/components/icons";
import { useTheme } from "@/theme/ThemeProvider";
import { TONE_TOKEN } from "./Text";

/**
 * An icon on iOS and Android (UI design, sections 4.7 and 6.3): lucide-react-native over react-native-svg, the same
 * names and version as the web's, hidden from accessibility services; the control around it carries the name. Its
 * colour is the tone's token in the reader's theme.
 */
const COMPONENTS: Record<IconName, LucideIcon> = {
  home: House,
  bookmarks: Bookmark,
  profile: CircleUser,
  settings: Settings,
  compose: SquarePen,
  reply: MessageCircle,
  repost: Repeat2,
  quote: Quote,
  like: Heart,
  more: Ellipsis,
  "who-sees": Eye,
  "copy-link": Link,
  delete: Trash2,
  report: Flag,
  close: X,
  back: ArrowLeft,
  newer: ArrowUp,
  previous: ChevronLeft,
  next: ChevronRight,
  "add-image": ImagePlus,
  error: CircleAlert,
  offline: WifiOff,
  done: CircleCheck,
  review: Clock,
  restricted: EyeOff,
  verified: BadgeCheck,
  explore: Compass,
  hidden: EyeOff,
  security: Shield,
  privacy: Lock,
  "edit-profile": UserPen,
  account: UserCog,
  cases: Scale,
  appearance: Palette,
  "sign-in": LogIn,
  passkey: KeyRound,
  external: ExternalLink,
  info: Info,
  retry: RotateCw,
};

/** Lucide's 24 px drawing has a stroke of 2; korbat draws 1.75, scaled with the icon, and 2.25 when strong. */
export function Icon({ name, size = 20, tone = "high", filled = false, strong = false }: IconProps) {
  const { colors } = useTheme();
  const Drawn = COMPONENTS[name];
  const color = colors[TONE_TOKEN[tone]];
  return <Drawn size={size} color={color} strokeWidth={strong ? 2.25 : 1.75} fill={filled ? color : "none"} accessible={false} />;
}
```

### Create `apps/app/src/components/kit/Icon.web.tsx`

```tsx
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleUser,
  Clock,
  Compass,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Heart,
  House,
  ImagePlus,
  Info,
  KeyRound,
  Link,
  Lock,
  LogIn,
  MessageCircle,
  Palette,
  Quote,
  Repeat2,
  RotateCw,
  Scale,
  Settings,
  Shield,
  SquarePen,
  Trash2,
  UserCog,
  UserPen,
  WifiOff,
  X,
} from "lucide-react";
import type { IconName, IconProps } from "@/components/icons";
import { TONE_CLASS } from "./Text";

/**
 * An icon on web (UI design, sections 4.7 and 6.3): lucide-react's plain svg, decoration only, so it is hidden from
 * assistive technology and never takes the focus; the control around it carries the name. Its colour is the tone's
 * class, which the svg's stroke follows as currentColor, so a forced Dark scope recolours it with its text.
 */
const COMPONENTS: Record<IconName, LucideIcon> = {
  home: House,
  bookmarks: Bookmark,
  profile: CircleUser,
  settings: Settings,
  compose: SquarePen,
  reply: MessageCircle,
  repost: Repeat2,
  quote: Quote,
  like: Heart,
  more: Ellipsis,
  "who-sees": Eye,
  "copy-link": Link,
  delete: Trash2,
  report: Flag,
  close: X,
  back: ArrowLeft,
  newer: ArrowUp,
  previous: ChevronLeft,
  next: ChevronRight,
  "add-image": ImagePlus,
  error: CircleAlert,
  offline: WifiOff,
  done: CircleCheck,
  review: Clock,
  restricted: EyeOff,
  verified: BadgeCheck,
  explore: Compass,
  hidden: EyeOff,
  security: Shield,
  privacy: Lock,
  "edit-profile": UserPen,
  account: UserCog,
  cases: Scale,
  appearance: Palette,
  "sign-in": LogIn,
  passkey: KeyRound,
  external: ExternalLink,
  info: Info,
  retry: RotateCw,
};

/** Lucide's 24 px drawing has a stroke of 2; korbat draws 1.75, scaled with the icon, and 2.25 when strong. */
export function Icon({ name, size = 20, tone = "high", filled = false, strong = false }: IconProps) {
  const Drawn = COMPONENTS[name];
  return (
    <Drawn
      size={size}
      strokeWidth={strong ? 2.25 : 1.75}
      fill={filled ? "currentColor" : "none"}
      className={TONE_CLASS[tone]}
      aria-hidden="true"
      focusable="false"
    />
  );
}
```

### Create `apps/app/src/components/kit/Text.tsx`

```tsx
import { Platform, Text as NativeText, type TextProps as NativeTextProps, type TextStyle } from "react-native";
import { useAppearance, type Appearance } from "@/lib/appearance";
import { cn } from "@/theme/cn";
import { FONT_FAMILY } from "@/theme/fonts";
import type { ColorToken } from "@/theme/tokens";

/**
 * korbat's type (UI design, sections 4.3 and 6.2): every size, line height, weight, family and tracking in the app
 * comes from the variant named here, scaled by the reader's text step and drawn in the reader's font choice. Screens
 * never write size or weight classes; test/theme.test.ts refuses them outside this file once Task 8 ends.
 */
export type TextVariant = "display-1" | "display-2" | "display-3" | "title" | "post" | "body" | "body-strong" | "meta" | "chip" | "mono";

export type TextStep = Appearance["textStep"];

type Face = keyof typeof FONT_FAMILY;

interface VariantSpec {
  face: Face;
  weight: 400 | 600 | 700;
  /** Size and line height in px at the Default step. */
  size: number;
  line: number;
  /** Letter spacing in em: tighter as the size grows, a little open below 14 px. */
  tracking: number;
  /** Fraunces' own axes, set only where the table asks for them. */
  variation?: string;
}

/**
 * The ten variants. Fraunces (the display face) is used at 22 px and up only, where its optical size reads as meant;
 * below that, emphasis comes from weight. Prose is set loose (1.53 for posts), display tight.
 */
export const VARIANTS: Record<TextVariant, VariantSpec> = {
  "display-1": { face: "display", weight: 600, size: 34, line: 40, tracking: -0.02, variation: '"SOFT" 50, "WONK" 1' },
  "display-2": { face: "display", weight: 600, size: 28, line: 34, tracking: -0.015 },
  "display-3": { face: "display", weight: 600, size: 22, line: 28, tracking: -0.01 },
  title: { face: "text", weight: 700, size: 18, line: 24, tracking: 0 },
  post: { face: "text", weight: 400, size: 17, line: 26, tracking: 0 },
  body: { face: "text", weight: 400, size: 15, line: 22, tracking: 0 },
  "body-strong": { face: "text", weight: 700, size: 15, line: 22, tracking: 0 },
  meta: { face: "text", weight: 400, size: 13, line: 18, tracking: 0.005 },
  chip: { face: "text", weight: 700, size: 12, line: 16, tracking: 0.01 },
  mono: { face: "mono", weight: 400, size: 14, line: 20, tracking: 0 },
};

/** The text-size step multiplies size and line height together. */
export const TEXT_STEPS: Record<TextStep, number> = { smaller: 0.875, default: 1, larger: 1.125, largest: 1.25 };

/** The system font, for the reader who chooses it and as every korbat face's fallback while it loads. */
export const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const SYSTEM_MONO_STACK = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

/** A size at a step, rounded to whole pixels. */
export function stepped(px: number, step: TextStep): number {
  return Math.round(px * TEXT_STEPS[step]);
}

/** A web style's lengths are CSS strings: rem for sizes, so the browser's own text size scales them, and em for tracking. */
interface WebTextStyle {
  fontFamily: string;
  fontWeight: "400" | "600" | "700";
  fontSize: `${number}rem`;
  lineHeight: `${number}rem`;
  letterSpacing?: `${number}em`;
  fontVariationSettings?: string;
}

/**
 * The one cast in the type code: React Native types fontSize, lineHeight and letterSpacing as numbers, and has no
 * fontVariationSettings, while react-native-web passes CSS strings and unknown properties through to the element.
 */
function webStyle(style: WebTextStyle): TextStyle {
  return style as unknown as TextStyle;
}

/**
 * The style of a variant at the reader's step and font. On web it is written in rem and em; on native in px times the
 * step, with the system font for every face until sub-project 5 embeds korbat's (theme/fonts.ts).
 */
export function textStyle(
  variant: TextVariant,
  choice: { step: TextStep; font: Appearance["font"] },
  platform: "web" | "native" = Platform.OS === "web" ? "web" : "native",
  families: Record<Face, string | undefined> = FONT_FAMILY,
): TextStyle {
  const spec = VARIANTS[variant];
  const family = choice.font === "korbat" ? families[spec.face] : undefined;
  // Without Fraunces the display variants keep their presence by weight.
  const weight = spec.face === "display" && family === undefined ? 700 : spec.weight;
  const size = stepped(spec.size, choice.step);
  const line = stepped(spec.line, choice.step);
  if (platform === "web") {
    const stack = spec.face === "mono" ? SYSTEM_MONO_STACK : SYSTEM_STACK;
    const web: WebTextStyle = {
      fontFamily: family === undefined ? stack : `"${family}", ${stack}`,
      fontWeight: `${weight}`,
      fontSize: `${size / 16}rem`,
      lineHeight: `${line / 16}rem`,
    };
    if (spec.tracking !== 0) web.letterSpacing = `${spec.tracking}em`;
    if (spec.variation !== undefined && family !== undefined) web.fontVariationSettings = spec.variation;
    return webStyle(web);
  }
  const native: TextStyle = { fontWeight: `${weight}`, fontSize: size, lineHeight: line };
  if (family !== undefined) native.fontFamily = family;
  if (spec.tracking !== 0) native.letterSpacing = Math.round(spec.tracking * size * 100) / 100;
  return native;
}

/** What a text says about itself by colour: an ink, the accent, an error, or a status (always with its own words, section 4.8). */
export type Tone = "high" | "medium" | "low" | "accent" | "danger" | "review-ink" | "restricted-ink" | "verified-ink" | "explore-ink";

/** Each tone's colour token, for code that needs the colour itself (Icon on native). */
export const TONE_TOKEN: Record<Tone, ColorToken> = {
  high: "ink-high",
  medium: "ink-medium",
  low: "ink-low",
  accent: "accent-ink",
  danger: "danger-ink",
  "review-ink": "review-ink",
  "restricted-ink": "restricted-ink",
  "verified-ink": "verified-ink",
  "explore-ink": "explore-ink",
};

/** Each tone's class, written out whole so Tailwind finds it in the source. */
export const TONE_CLASS: Record<Tone, string> = {
  high: "text-ink-high",
  medium: "text-ink-medium",
  low: "text-ink-low",
  accent: "text-accent-ink",
  danger: "text-danger-ink",
  "review-ink": "text-review-ink",
  "restricted-ink": "text-restricted-ink",
  "verified-ink": "text-verified-ink",
  "explore-ink": "text-explore-ink",
};

/**
 * How far the operating system's text size may grow a variant on native: chrome (chips) at most 1.5 times, post
 * bodies without a cap (0), everything else twice. The web has the browser's own setting, which rem follows.
 */
const MAX_SCALE: Partial<Record<TextVariant, number>> = { chip: 1.5, post: 0 };

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  tone?: Tone;
  /** A heading level (one level-1 heading per screen, its title), or running text. */
  as?: "p" | "h1" | "h2" | "h3" | "h4" | "span";
  /** The text face's italic, used for tombstones. */
  italic?: boolean;
  className?: string;
}

/**
 * Text in a variant and a tone. A heading is `accessibilityRole="header"` with its aria-level, which react-native-web
 * draws as h1 to h4; "p" and "span" are running text, which react-native-web draws as a block and, inside other text,
 * inline (React Native's role list has no paragraph).
 */
export function Text({ variant = "body", tone = "high", as, italic, className, style, maxFontSizeMultiplier, ...rest }: TextProps) {
  const appearance = useAppearance();
  const level = as === "h1" || as === "h2" || as === "h3" || as === "h4" ? Number(as.slice(1)) : undefined;
  return (
    <NativeText
      {...rest}
      accessibilityRole={level === undefined ? undefined : "header"}
      aria-level={level}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === "web" ? undefined : (MAX_SCALE[variant] ?? 2))}
      className={cn(TONE_CLASS[tone], className)}
      style={[textStyle(variant, { step: appearance.textStep, font: appearance.font }), italic ? { fontStyle: "italic" } : null, style]}
    />
  );
}
```

### Create `apps/app/src/lib/appearance.ts`

```ts
import { useSyncExternalStore } from "react";
import type { ThemeName } from "@/theme/tokens";

/**
 * The reader's appearance and reading choices (UI design, section 8.8), applied at once with no Save button and kept on
 * this device: in localStorage under korbat.appearance on web, which public/theme-boot.js reads before the first paint,
 * and in memory on native until sub-project 5 brings storage there. This is the only module in src that touches that
 * key; ThemeProvider, Text and the Appearance page read and write through it, and the session's end clears it through
 * clearAppearance().
 */
export interface Appearance {
  /** System follows the operating system: Light, or the dark style when the system is dark. */
  theme: "system" | "light" | "dim" | "dark";
  darkStyle: "dim" | "dark";
  /** Multiplies every text size and line height (kit/Text.tsx). */
  textStep: "smaller" | "default" | "larger" | "largest";
  font: "korbat" | "system";
  /** Always reduces motion whatever the system says; "system" follows the operating system's setting. */
  reduceMotion: "system" | "always";
  haptics: boolean;
  autoLoad: boolean;
  openNewest: boolean;
  hideCounts: boolean;
}

export const APPEARANCE_KEY = "korbat.appearance";

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  theme: "system",
  darkStyle: "dark",
  textStep: "default",
  font: "korbat",
  reduceMotion: "system",
  haptics: true,
  autoLoad: false,
  openNewest: false,
  hideCounts: false,
});

/** The values each choice may take; anything else in a stored record falls back to that field's default. */
const CHOICES: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  theme: ["system", "light", "dim", "dark"],
  darkStyle: ["dim", "dark"],
  textStep: ["smaller", "default", "larger", "largest"],
  font: ["korbat", "system"],
  reduceMotion: ["system", "always"],
  haptics: [true, false],
  autoLoad: [true, false],
  openNewest: [true, false],
  hideCounts: [true, false],
};

/** Each field taken from `value` when it is one of the field's choices, else the default: an older or damaged record still gives every choice. */
function normalise(value: Record<string, unknown>): Appearance {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CHOICES) as (keyof Appearance)[]) {
    const choices = CHOICES[key] as readonly unknown[];
    out[key] = choices.includes(value[key]) ? value[key] : DEFAULT_APPEARANCE[key];
  }
  return out as unknown as Appearance;
}

/** A stored record as the choices it holds; anything that is not a JSON object gives the defaults. */
export function parseAppearance(raw: string | null): Appearance {
  if (raw === null || raw === "") return DEFAULT_APPEARANCE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_APPEARANCE;
    return normalise(value as Record<string, unknown>);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Which theme the screen shows: the chosen one, or under System the reader's dark style on a dark system and Light otherwise. */
export function resolveTheme(appearance: Pick<Appearance, "theme" | "darkStyle">, system: string | null | undefined): ThemeName {
  if (appearance.theme !== "system") return appearance.theme;
  return system === "dark" ? appearance.darkStyle : "light";
}

/** Browser storage, typed locally as lib/api.ts types it; every access is guarded, since a private window or blocked storage throws. */
const web = globalThis as unknown as {
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
};

/** The browser's storage, or null where there is none (native) or the browser refuses it. */
function storage() {
  if (broken) return null;
  try {
    return web.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The choices where storage is missing or refused: on native always, on web once a read or write has thrown. */
let memory: Appearance = DEFAULT_APPEARANCE;
/** Set once storage throws, so the choices made after it are read back from memory rather than lost. */
let broken = false;
/** The last stored text and what it parsed to, so an unchanged record reads as the same object. */
let lastRaw: string | null = null;
let lastParsed: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** The reader's current choices. */
export function readAppearance(): Appearance {
  const store = storage();
  if (!store) return memory;
  let raw: string | null;
  try {
    raw = store.getItem(APPEARANCE_KEY);
  } catch {
    broken = true;
    return memory;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastParsed = parseAppearance(raw);
  }
  return lastParsed;
}

/** Changes some choices at once and tells every screen that shows them. */
export function setAppearance(change: Partial<Appearance>): Appearance {
  const next = normalise({ ...readAppearance(), ...change });
  memory = next;
  const store = storage();
  try {
    store?.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    broken = true;
  }
  announce();
  return next;
}

/**
 * Forgets every choice on this device, so the theme returns to System. The session's end calls it (Task 5), and so
 * does the Appearance page's "Clear what this device keeps" (Task 8).
 */
export function clearAppearance(): void {
  memory = DEFAULT_APPEARANCE;
  const store = storage();
  try {
    store?.removeItem(APPEARANCE_KEY);
  } catch {
    broken = true;
  }
  announce();
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The reader's choices in a component, which renders again when one changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, readAppearance, readAppearance);
}
```

### Create `apps/app/src/theme/ThemeProvider.tsx`

```tsx
import { useEffect, type ReactNode } from "react";
import { Platform, View, useColorScheme } from "react-native";
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
  const appearance = useAppearance();
  const system = useColorScheme();
  return RESOLVED[resolveTheme(appearance, system)];
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
```

### Create `apps/app/src/theme/cn.ts`

```ts
import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names, dropping the false and empty ones, for NativeWind's className (UI design, section 6.1). There is
 * no merge step: variants written with class-variance-authority never set the same property twice, so two classes
 * never fight over one value.
 */
export function cn(...classes: ClassValue[]): string {
  return clsx(classes);
}
```

### Create `apps/app/src/theme/fonts.ts`

```ts
/**
 * The faces on iOS and Android (UI design, section 4.3): every family resolves to the platform's system font until
 * sub-project 5 embeds the static files with expo-font's config plugin. An unknown family name on iOS logs an error,
 * so native never names a family it has not loaded. The web build takes fonts.web.ts instead.
 */
export const FONT_FAMILY: { display: string | undefined; text: string | undefined; mono: string | undefined } = {
  display: undefined,
  text: undefined,
  mono: undefined,
};

/** Nothing to install on native: the system font is already there. */
export function installFonts(): void {}
```

### Create `apps/app/src/theme/fonts.web.ts`

```ts
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

/** Adds the one style element with the rules, once; the browser downloads a file only when text needs it. */
export function installFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = fontFaceCss();
  document.head.appendChild(style);
}
```

### Create `apps/app/src/theme/layout.ts`

```ts
import { useWindowDimensions } from "react-native";

/**
 * The four layouts the shell switches between by the window's width (UI design, section 7.1), and the spacing that
 * screens share (section 4.4). The 768 and 1024 px edges are AppShell's today; 1280 px brings the full nav.
 */
export type LayoutKind = "phone" | "tablet" | "desktop" | "wide";

/** The first width, in px, of each layout above the phone. */
export const BREAKPOINTS = { tablet: 768, desktop: 1024, wide: 1280 } as const;

/** The layout a window of this width gets. */
export function layoutKind(width: number): LayoutKind {
  if (width >= BREAKPOINTS.wide) return "wide";
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "phone";
}

/** The current layout, which changes as the window is resized or the phone is turned. */
export function useLayout(): LayoutKind {
  return layoutKind(useWindowDimensions().width);
}

/** The space between the screen's edge and its content: 16 px on phones, 20 px from 768 px on. */
export const GUTTER = { phone: 16, wider: 20 } as const;

/** A post's padding and the gaps inside it, in px: across, down, author line to body, body to media, above the actions. */
export const POST_SPACING = { across: 16, down: 12, authorToBody: 12, bodyToMedia: 8, aboveActions: 4 } as const;

/** Between the sections of a screen, and between a heading and its content, in px. */
export const SECTION_GAP = 24;
export const HEADING_GAP = 8;

/** The least size of a standalone control on every platform, and of a link inside running text (WCAG 2.5.8), in px. */
export const TARGET = { control: 44, inline: 24 } as const;

/** The widths of the shell's columns at 768 px and wider, in px, and the space between them. */
export const COLUMNS = { timeline: 600, context: 320, rail: 80, nav: 240, gap: 24 } as const;
```

### Create `apps/app/src/theme/motion.ts`

```ts
/**
 * The motion values every animation takes (UI design, section 5.1), as plain data so this file loads anywhere: no
 * Reanimated here. useMotion() in lib/motion.ts (Task 2) turns them into Reanimated springs and timings and swaps in
 * the reduced form when the system or the reader's "Reduce motion" asks for it. Easing curves are cubic-bezier
 * control points; durations are in ms.
 */
export const MOTION = {
  /** Entering, pressing, menus, the new-posts pill. */
  easeOut: { type: "timing", easing: [0.23, 1, 0.32, 1] },
  /** On-screen movement without a gesture: the tab underline, a scroll to the oldest unread new post. */
  easeInOut: { type: "timing", easing: [0.77, 0, 0.175, 1] },
  /** The default spring, with no overshoot: sheets opening, the lightbox growing, the tab underline. */
  springSnap: { type: "spring", dampingRatio: 1, duration: 300 },
  /** After a drag or flick is released, started with the gesture's velocity (sheets, lightbox). */
  springRelease: { type: "spring", dampingRatio: 0.85, duration: 350 },
  /** The pressed scale: in on pointer-down, out on release. */
  press: { type: "timing", in: 100, out: 160, easing: [0.23, 1, 0.32, 1] },
  /** The reduced forms, and the blurhash cross-fade. */
  fade: { type: "timing", duration: 150, easing: [0.23, 1, 0.32, 1] },
} as const;

export type MotionName = keyof typeof MOTION;
```

### Create `apps/app/src/theme/scope.ts`

```ts
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
```

### Create `apps/app/src/theme/scope.web.ts`

```ts
import type { ThemeName } from "./tokens";

/**
 * On web the variables come from global.css, switched by the class `light`, `dim` or `dark` on the html element or on a
 * forced scope's own element, so a View needs no style for them (scope.ts is the native side).
 */
export function scopeStyle(_theme: ThemeName): undefined {
  return undefined;
}
```

### Create `apps/app/src/theme/tokens.ts`

```ts
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
```

### Replace `apps/app/global.css` (whole file)

```text
@tailwind base;
@tailwind components;
@tailwind utilities;

/*
 * korbat's colour tokens (UI design, section 4.2), one block per theme, each colour as an R G B triplet so a class
 * can add its alpha: tailwind.config.js maps every token to rgb(var(--k-<token>) / <alpha-value>). The html element
 * carries the class light, dim or dark (public/theme-boot.js sets it before the first paint, ThemeProvider keeps it),
 * and a forced Dark scope such as the lightbox's stage takes the class dark on its own element. The values are
 * src/theme/tokens.ts's THEMES; test/contrast.test.ts fails if they drift apart.
 */
/* Light ("Day"), also the values before any class is set. */
:root {
  --k-surface: 246 245 249;
  --k-surface-1: 255 255 255;
  --k-surface-2: 236 234 241;
  --k-line-low: 221 218 228;
  --k-line-high: 130 124 144;
  --k-ink-high: 21 19 27;
  --k-ink-medium: 69 64 79;
  --k-ink-low: 98 93 110;
  --k-accent: 90 51 214;
  --k-on-accent: 255 255 255;
  --k-accent-ink: 90 51 214;
  --k-accent-wash: 236 230 255;
  --k-focus: 90 51 214;
  --k-danger: 194 38 27;
  --k-on-danger: 255 255 255;
  --k-danger-ink: 180 35 24;
  --k-review-ink: 138 75 0;
  --k-review-wash: 252 239 210;
  --k-review-on-wash: 107 58 0;
  --k-restricted-ink: 180 35 24;
  --k-restricted-wash: 253 228 225;
  --k-restricted-on-wash: 138 28 18;
  --k-verified-ink: 31 85 199;
  --k-verified-wash: 224 234 253;
  --k-verified-on-wash: 23 63 148;
  --k-explore-ink: 11 115 80;
  --k-explore-wash: 218 243 232;
  --k-explore-on-wash: 7 90 62;
}

/* Dim ("Dusk"). */
:root.dim {
  --k-surface: 27 26 36;
  --k-surface-1: 36 35 47;
  --k-surface-2: 47 45 59;
  --k-line-low: 58 56 72;
  --k-line-high: 128 123 147;
  --k-ink-high: 241 239 246;
  --k-ink-medium: 204 200 216;
  --k-ink-low: 168 163 184;
  --k-accent: 185 166 255;
  --k-on-accent: 23 14 51;
  --k-accent-ink: 185 166 255;
  --k-accent-wash: 51 44 85;
  --k-focus: 185 166 255;
  --k-danger: 209 52 56;
  --k-on-danger: 255 255 255;
  --k-danger-ink: 255 138 128;
  --k-review-ink: 245 184 61;
  --k-review-wash: 58 45 23;
  --k-review-on-wash: 250 210 122;
  --k-restricted-ink: 255 138 128;
  --k-restricted-wash: 61 26 31;
  --k-restricted-on-wash: 255 180 172;
  --k-verified-ink: 120 176 255;
  --k-verified-wash: 26 42 69;
  --k-verified-on-wash: 176 206 255;
  --k-explore-ink: 75 217 162;
  --k-explore-wash: 18 51 40;
  --k-explore-on-wash: 147 237 201;
}

/* Dark ("Night"), on the page or on a forced scope. */
:root.dark,
.dark {
  --k-surface: 16 15 22;
  --k-surface-1: 24 23 31;
  --k-surface-2: 34 32 43;
  --k-line-low: 43 41 53;
  --k-line-high: 114 109 130;
  --k-ink-high: 243 241 247;
  --k-ink-medium: 199 194 211;
  --k-ink-low: 156 151 171;
  --k-accent: 180 160 255;
  --k-on-accent: 23 14 51;
  --k-accent-ink: 180 160 255;
  --k-accent-wash: 37 30 66;
  --k-focus: 180 160 255;
  --k-danger: 209 52 56;
  --k-on-danger: 255 255 255;
  --k-danger-ink: 255 123 114;
  --k-review-ink: 245 184 61;
  --k-review-wash: 46 35 16;
  --k-review-on-wash: 250 210 122;
  --k-restricted-ink: 255 123 114;
  --k-restricted-wash: 51 20 24;
  --k-restricted-on-wash: 255 173 166;
  --k-verified-ink: 106 168 255;
  --k-verified-wash: 18 33 58;
  --k-verified-on-wash: 165 200 255;
  --k-explore-ink: 61 211 154;
  --k-explore-wash: 12 42 32;
  --k-explore-on-wash: 134 235 195;
}
```

### Replace `apps/app/metro.config.js` (whole file)

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
// The bundled fonts (src/theme/fonts.web.ts): neither Metro's nor Expo's default asset list has woff2, and without it
// a require of a font is read as source. On web the require then yields the hashed file's URL under /assets/.
config.resolver.assetExts = [...config.resolver.assetExts, "woff2"];
module.exports = withNativeWind(config, { input: "./global.css" });
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fontsource-variable/atkinson-hyperlegible-mono": "5.3.0",
    "@fontsource-variable/atkinson-hyperlegible-next": "5.3.0",
    "@fontsource-variable/fraunces": "5.3.0",
    "@korbat/contracts": "workspace:*",
    "@korbat/rules": "workspace:*",
    "@marsidev/react-turnstile": "1.6.1",
    "@simplewebauthn/browser": "14.0.0",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "expo": "57.0.22",
    "expo-constants": "57.0.18",
    "expo-image": "57.0.5",
    "expo-linking": "57.0.10",
    "expo-router": "57.0.21",
    "lucide-react": "1.55.0",
    "lucide-react-native": "1.55.0",
    "nativewind": "4.2.7",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2",
    "react-native-svg": "15.15.4",
    "react-native-web": "0.21.2",
    "react-native-worklets": "0.10.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "tailwindcss": "3.4.19",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/app/public/index.html` (whole file)

```text
<!DOCTYPE html>
<!-- The shell around the single-page web export: `expo export` reads public/index.html, fills in the
     language and title, and appends the bundle and stylesheet links. theme-boot.js runs first, before
     anything is drawn: it puts the reader's theme (stored, or the system's) on the html element with
     the page's colours, so the first frame is already in that theme with no flash. Without scripts the
     reset below paints the Dark theme. The icon is inline SVG so no request for it falls through to
     the app. Everything else is the Expo template. -->
<html lang="%LANG_ISO_CODE%">
  <head>
    <meta charset="utf-8" />
    <script src="/theme-boot.js"></script>
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23100F16'/%3E%3Ctext x='16' y='23' font-size='20' font-family='system-ui,sans-serif' font-weight='700' text-anchor='middle' fill='%23F3F1F7'%3Ek%3C/text%3E%3C/svg%3E" />
    <title>%WEB_TITLE%</title>
    <!-- The `react-native-web` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element -->
    <style id="expo-reset">
      /* These styles make the body full-height */
      html,
      body {
        height: 100%;
      }
      /* These styles disable body scrolling if you are using <ScrollView> */
      body {
        overflow: hidden;
      }
      /* These styles make the root element full-height */
      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }
      /* Dark (its surface and ink-high) for a browser without scripts. theme-boot.js sets the
         reader's theme on the html element itself, so the body stays transparent and shows it. */
      html {
        background: #100F16;
        color: #F3F1F7;
      }
    </style>
  </head>

  <body>
    <!-- Use static rendering with Expo Router to support running without JavaScript. -->
    <noscript>
      You need to enable JavaScript to run this app.
    </noscript>
    <!-- The root element for your Expo app. -->
    <div id="root"></div>
  </body>
</html>
```

### Replace `apps/app/src/app/(auth)/password.tsx` (whole file)

```tsx
import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { SignInResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function PasswordSignIn() {
  const { refresh } = useSession();
  const turnstile = useRef<TurnstileInstance | null>(null);
  // The human check is drawn light in Light and dark in Dim and Dark, like the page around it.
  const theme = useTheme();
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/password/signin", {
        json: { email: email.trim(), password, turnstileToken: token, deviceId: deviceId(), platform },
        schema: SignInResponse,
      });
      setPassword("");
      if (result.result === "mfa_required") {
        flow.set({ email: email.trim(), mfaTicket: result.mfaTicket });
        router.replace("/mfa");
        return;
      }
      flow.clear();
      const session = await refresh();
      router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
    } catch (err) {
      setError(errorMessage(err));
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Sign in</Title>
      <Body>Use the password you set in your security settings.</Body>
      <Field label="Email" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} />
      <Field label="Password" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={submit} />
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: theme.turnstile, refreshExpired: "manual" }}
          onSuccess={setToken}
          onExpire={() => {
            setToken(null);
            turnstile.current?.reset();
          }}
          onError={() => setError("We could not verify that you are human. Reload the page and try again.")}
        />
      </View>
      <ErrorText message={error} />
      <Button label="Sign in" onPress={submit} busy={busy} disabled={!email.includes("@") || password.length === 0 || token === null} />
      <TextLink label="Email me a code instead" href="/signin" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/(auth)/signin.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { View, type TextInputProps } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { FlowResponse, PasskeyOptionsResponse, SignInResponse, type AuthenticationResponseJSON } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";
import { abortPasskeyRequest, autofillPasskey, autofillSupported, confirmWithPasskey, createAutofillScheduler, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The browser offers the passkeys it holds in the email field's autofill when the field's autocomplete ends with "webauthn"; React Native's type does not list the pair. */
const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];

type Outcome = "done" | "expired" | "failed";

/** The single entry point: one email field for both sign-up and sign-in, and a passkey where the browser has them. */
export default function EmailEntry() {
  const { refresh } = useSession();
  const turnstile = useRef<TurnstileInstance | null>(null);
  // The human check is drawn light in Light and dark in Dim and Dark, like the page around it.
  const theme = useTheme();
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Decided once: the button and the autofill exist only in a browser with WebAuthn.
  const [passkeys] = useState(passkeysSupported);

  /**
   * Verifies a passkey's response as the password sign-in handles its answer: a session, or the TOTP step with its
   * ticket. Answers how it ended, for the autofill's schedule.
   */
  const signIn = useCallback(
    async (response: AuthenticationResponseJSON): Promise<Outcome> => {
      try {
        const result = await api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse });
        if (result.result === "mfa_required") {
          flow.set({ mfaTicket: result.mfaTicket });
          router.replace("/mfa");
          return "done";
        }
        flow.clear();
        const session = await refresh();
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
        return "done";
      } catch (err) {
        setError(errorMessage(err));
        return err instanceof ApiError && err.code === "challenge_expired" ? "expired" : "failed";
      }
    },
    [refresh],
  );

  // One controller owns the conditional request (1c design, section 9); it is created once, and everything its runs touch is stable across renders.
  const [scheduler] = useState(() =>
    createAutofillScheduler({
      start: (run) => void runAutofill(run),
      abort: abortPasskeyRequest,
      after: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    }),
  );

  /** One conditional request: the options, the browser's autofill until a passkey is picked or the request is aborted, then the verification. */
  async function runAutofill(run: number): Promise<void> {
    let options;
    try {
      options = (await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse })).options;
    } catch {
      // The person did nothing yet, so nothing is said; the schedule rests until the screen is focused again.
      scheduler.ended(run, "failed");
      return;
    }
    // The screen went away, or the button took over, while the options were fetched: no ceremony now.
    if (!scheduler.isCurrent(run)) return;
    let response: AuthenticationResponseJSON | null;
    try {
      response = await autofillPasskey(options);
    } catch {
      scheduler.ended(run, "failed");
      return;
    }
    // Aborted, in which case the schedule has moved on already, or closed without a choice: nothing to verify.
    if (response === null) {
      scheduler.ended(run, "failed");
      return;
    }
    scheduler.ended(run, await signIn(response));
  }

  // The conditional request lives while the screen is focused and the browser can show one; a screen that goes away aborts it, and unmounting ends it for good.
  useFocusEffect(
    useCallback(() => {
      if (!passkeys) return undefined;
      let away = false;
      void autofillSupported().then((supported) => {
        if (supported && !away) scheduler.focus();
      });
      return () => {
        away = true;
        scheduler.blur();
      };
    }, [passkeys, scheduler]),
  );
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  /** The button's own request: the browser's prompt with every passkey it holds for korbat, then the same verification as the autofill's. */
  async function passkeyButton() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The conditional request steps aside for the prompt, which the library would otherwise abort itself.
    scheduler.hold();
    let outcome: Outcome = "failed";
    try {
      const { options } = await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      if (response !== null) outcome = await signIn(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      // A signed-in screen is on its way out; anything else lets the autofill come back.
      if (outcome !== "done") scheduler.release();
    }
  }

  async function submit() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      const { flowId } = await api("/api/auth/email/start", {
        json: { email: address, turnstileToken: token, deviceId: deviceId(), platform },
        schema: FlowResponse,
      });
      flow.set({ email: address, flowId, mfaTicket: undefined });
      router.push("/code");
    } catch (err) {
      setError(errorMessage(err));
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>korbat</Title>
      <Body>Enter your email. We'll send a code that signs you in, or creates your account if you don't have one yet.</Body>
      <Field label="Email" autoComplete={EMAIL_AUTOFILL} autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={submit} />
      {passkeys ? <Button label="Sign in with a passkey" onPress={() => void passkeyButton()} busy={busy} tone="secondary" /> : null}
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: theme.turnstile, refreshExpired: "manual" }}
          onSuccess={setToken}
          onExpire={() => {
            setToken(null);
            turnstile.current?.reset();
          }}
          onError={() => setError("We could not verify that you are human. Reload the page and try again.")}
        />
      </View>
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!email.includes("@") || token === null} />
      <TextLink label="Sign in with a password instead" href="/password" />
      <TextLink label="Read the terms" href="/terms" />
      <TextLink label="Back to the latest posts" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/_layout.tsx` (whole file)

```tsx
import "../../global.css";
import { Stack } from "expo-router";
import { SessionProvider } from "@/lib/session";
import { installFonts } from "@/theme/fonts";
import { ThemeProvider } from "@/theme/ThemeProvider";

// The font rules go in before the first render, so text set in korbat's faces asks for its file at once (web only).
installFonts();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </ThemeProvider>
  );
}
```

### Replace `apps/app/src/components/moderation/ReportForm.tsx` (whole file)

```tsx
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type AccountStanding, type CsamKeywordChoice, type NoticeResponse, type ReportRuleId } from "@korbat/contracts";
import { RULES } from "@korbat/rules";
import { RULES_PAGE } from "@/lib/public-pages";
import { Body, Button, ErrorText, Field, TextButton, TextLink, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  moderation,
  noticeFrom,
  profileOnly,
  reportFailure,
  ruleLine,
  statusLink,
  tooManyProfiles,
  type GivenTarget,
  type Ground,
  type NoticeCategoryChoice,
  type ReportDraft,
} from "@/lib/moderation";
import { CATEGORY_LABELS, REPORT_WORDS } from "@/lib/moderation-words";
import { reportsRestrictedUntil, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** One entry of a list of choices: a choice with its label and an optional line under it, or a line of text that stands in a choice's place. */
type ChoiceEntry<T extends string> = { value: T; label: string; hint?: string; disabled?: string } | { note: string };

/**
 * One question with its answers, of which one is chosen: a radio group, each answer a radio that says whether it is
 * checked. Every answer has the same weight on the page; a note among them is plain text and no control.
 */
function Choice<T extends string>({ label, entries, value, onChange }: { label: string; entries: ChoiceEntry<T>[]; value: T | null; onChange: (value: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" aria-label={label} className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      {entries.map((entry) =>
        "note" in entry ? (
          <Text key={entry.note} className="mt-2 rounded-lg border border-dashed border-zinc-700 px-4 py-3 text-sm leading-5 text-zinc-400">
            {entry.note}
          </Text>
        ) : (
          <Pressable
            key={entry.value}
            accessibilityRole="radio"
            aria-checked={value === entry.value}
            aria-disabled={entry.disabled !== undefined}
            disabled={entry.disabled !== undefined}
            onPress={() => onChange(entry.value)}
            className={`mt-2 rounded-lg border px-4 py-3 ${value === entry.value ? "border-zinc-50 bg-zinc-900" : "border-zinc-700"}`}
          >
            <Text className={`text-base ${entry.disabled !== undefined ? "text-zinc-500" : value === entry.value ? "font-semibold text-zinc-50" : "text-zinc-200"}`}>{entry.label}</Text>
            {entry.hint ? <Text className="mt-1 text-sm leading-5 text-zinc-400">{entry.hint}</Text> : null}
            {/* A disabled choice keeps its reason as text beside it (9.8). */}
            {entry.disabled !== undefined ? <Text className="mt-1 text-sm leading-5 text-amber-300">{entry.disabled}</Text> : null}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** A statement the person may tick: a checkbox that says whether it is checked. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} className="mt-6 flex-row items-start gap-3">
      <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${checked ? "border-zinc-50 bg-zinc-50" : "border-zinc-500"}`}>
        {checked ? <Text className="text-xs font-bold text-zinc-950">x</Text> : null}
      </View>
      <Text className="flex-1 text-base leading-6 text-zinc-200">{label}</Text>
    </Pressable>
  );
}

const Hint = ({ children }: { children: string }) => <Text className="mt-2 text-sm leading-5 text-zinc-400">{children}</Text>;

/** The rules a report may cite, each with its title and one line; R2 is no choice: in its place stands the pointer to the anonymous path. */
function ruleEntries(withPointer: boolean): ChoiceEntry<ReportRuleId>[] {
  const reportable: readonly string[] = REPORT_RULE_IDS;
  return RULES.flatMap((rule): ChoiceEntry<ReportRuleId>[] => {
    if (reportable.includes(rule.id)) return [{ value: rule.id as ReportRuleId, label: `${rule.id}: ${rule.title}`, hint: ruleLine(rule) }];
    return withPointer ? [{ note: REPORT_WORDS.r2Instead }] : [];
  });
}

const GROUNDS: ChoiceEntry<Ground>[] = [
  { value: "rule", label: REPORT_WORDS.grounds.rule },
  { value: "illegal", label: REPORT_WORDS.grounds.illegal },
  { value: "csam", label: REPORT_WORDS.grounds.csam },
];
const CATEGORIES: ChoiceEntry<NoticeCategoryChoice>[] = [
  { value: "STATEMENT_CATEGORY_NOT_SPECIFIED_NOTICE", label: REPORT_WORDS.categoryNotSure },
  ...TDB_FORM_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] })),
];
const KEYWORDS: ChoiceEntry<CsamKeywordChoice>[] = (Object.keys(REPORT_WORDS.keywords) as CsamKeywordChoice[]).map((keyword) => ({ value: keyword, label: REPORT_WORDS.keywords[keyword] }));
/** The illegal ground's optional rule: none, or one of the rules a report may cite. */
const NO_RULE = "none";

/** "The rules", the public rules page, beside the list of rules (3d design, section 9.1). */
function RulesLink() {
  return (
    <Link href="/rules" asChild>
      <Pressable className="mt-2 self-start">
        <Text className="text-sm text-sky-400 underline">{RULES_PAGE.title}</Text>
      </Pressable>
    </Link>
  );
}

/** What the form was opened on, as a link to it; a form opened without an item asks for its link instead. */
function GivenItem({ given }: { given: GivenTarget }) {
  const [href, label] = given.kind === "post" ? [`/post/${given.id}`, given.mediaId ? REPORT_WORDS.itemImage : REPORT_WORDS.itemPost] : [`/u/${given.handle}`, REPORT_WORDS.itemProfile(given.handle)];
  return (
    <View className="mt-6">
      <Text className="text-sm font-medium text-zinc-300">{REPORT_WORDS.item}</Text>
      <Link href={href} asChild>
        <Pressable className="mt-2 self-start">
          <Text className="text-base text-sky-400 underline">{label}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The report form (3c design, section 9): what is wrong, with three grounds of equal weight, then what that ground
 * needs. It builds the request from what is filled in (noticeFrom), says what is still missing in place of sending, and
 * shows the answer's screen once korbat took the report. `given` is the post, image or profile "Report" was pressed on,
 * or null for a form opened on its own, which asks for the link. Signed out, every ground needs the human check.
 * `initial` is what a test starts the form with.
 */
export function ReportForm({ signedIn, given, initial, standing = null }: { signedIn: boolean; given: GivenTarget | null; initial?: Partial<ReportDraft>; standing?: AccountStanding | null }) {
  // 3e (design, section 9.6): read from /me before anything is sent. While a suspension runs, or (Task 5) a restriction of
  // the account's reports, the first choice is disabled with its sentence, the suspension's first as the intake refuses
  // it first; a notice of illegality and the path for child sexual abuse material stay open.
  const running = runningMeasure(standing);
  const restrictedUntil = reportsRestrictedUntil(standing);
  const ruleClosed =
    running !== null
      ? running.kind === "suspend" && running.endsAt !== null
        ? STANDING_TEXTS.report.suspended(running.endsAt)
        : STANDING_TEXTS.refused.terminated
      : restrictedUntil !== null
        ? STANDING_TEXTS.report.restricted(restrictedUntil)
        : undefined;
  const grounds = GROUNDS.map((entry) => ("value" in entry && entry.value === "rule" && ruleClosed !== undefined ? { ...entry, disabled: ruleClosed } : entry));
  const turnstile = useRef<TurnstileInstance | null>(null);
  // The human check is drawn light in Light and dark in Dim and Dark, like the page around it.
  const theme = useTheme();
  const [draft, setDraft] = useState<ReportDraft>({ ...EMPTY_DRAFT, ...initial });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<NoticeResponse | null>(null);
  const set = (patch: Partial<ReportDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const built = noticeFrom(draft, given, { signedIn, turnstileToken: token });
  const anonymous = draft.ground === "csam";

  async function send() {
    if (busy || !("request" in built)) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await moderation.send(built.request);
      setSent(answer);
    } catch (err) {
      setError(reportFailure(err, draft.ground === "csam"));
      // A token of the human check is good for one request: the next try needs a fresh one.
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <ReportSent answer={sent} signedIn={signedIn} origin={(globalThis as { location?: { origin?: string } }).location?.origin ?? ""} />;

  const setOther = (index: number, url: string) => set({ others: draft.others.map((other, at) => (at === index ? url : other)) });
  return (
    <View>
      <Title>{REPORT_WORDS.title}</Title>
      {given ? <GivenItem given={given} /> : <Field label={REPORT_WORDS.link} autoCapitalize="none" inputMode="url" value={draft.link} onChangeText={(link) => set({ link })} />}

      <Choice label={REPORT_WORDS.question} entries={grounds} value={draft.ground} onChange={(ground) => set({ ground })} />

      {draft.ground === "rule" ? (
        <>
          <Choice label={REPORT_WORDS.whichRule} entries={ruleEntries(true)} value={draft.ruleId} onChange={(ruleId) => set({ ruleId })} />
          {/* 3d (design, section 9.1): every rule in full, with what it allows, beside the list. */}
          <RulesLink />
          <Field label={REPORT_WORDS.explanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
        </>
      ) : null}

      {draft.ground === "illegal" ? (
        <>
          <Choice label={REPORT_WORDS.category} entries={CATEGORIES} value={draft.category} onChange={(category) => set({ category })} />
          <Hint>{REPORT_WORDS.csamInstead}</Hint>
          <Field label={REPORT_WORDS.citedLaw} maxLength={NOTICE_LIMITS.citedLawMax} value={draft.citedLaw} onChangeText={(citedLaw) => set({ citedLaw })} />
          <Field label={REPORT_WORDS.whyIllegal} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Choice
            label={REPORT_WORDS.alsoRule}
            entries={[{ value: NO_RULE, label: REPORT_WORDS.noRule }, ...ruleEntries(false)]}
            value={draft.ruleId ?? NO_RULE}
            onChange={(ruleId) => set({ ruleId: ruleId === NO_RULE ? null : (ruleId as ReportRuleId) })}
          />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          {signedIn ? null : (
            <>
              <Field label={REPORT_WORDS.name} autoComplete="name" value={draft.name} onChangeText={(name) => set({ name })} />
              <Field label={REPORT_WORDS.email} autoComplete="email" autoCapitalize="none" inputMode="email" value={draft.email} onChangeText={(email) => set({ email })} />
              <Hint>{REPORT_WORDS.contactHint}</Hint>
            </>
          )}
        </>
      ) : null}

      {draft.ground === "csam" ? (
        <>
          <Choice label={REPORT_WORDS.which} entries={KEYWORDS} value={draft.keyword} onChange={(keyword) => set({ keyword })} />
          {profileOnly(draft, given) ? <Hint>{REPORT_WORDS.profileOnly}</Hint> : null}
          <Field label={REPORT_WORDS.csamExplanation} multiline numberOfLines={4} maxLength={NOTICE_LIMITS.explanationMax} value={draft.explanation} onChangeText={(explanation) => set({ explanation })} />
          <Check label={REPORT_WORDS.bonaFide} checked={draft.bonaFide} onChange={(bonaFide) => set({ bonaFide })} />
          <Hint>{REPORT_WORDS.anonymous}</Hint>
        </>
      ) : null}

      <View className="mt-8">
        <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-100">
          {REPORT_WORDS.otherItems}
        </Text>
        <Hint>{REPORT_WORDS.otherItemsHint}</Hint>
        {draft.others.map((other, index) => (
          <View key={index}>
            <Field label={REPORT_WORDS.otherLink(index + 1)} autoCapitalize="none" inputMode="url" value={other} onChangeText={(url) => setOther(index, url)} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${REPORT_WORDS.removeLink}: ${REPORT_WORDS.otherLink(index + 1)}`} onPress={() => set({ others: draft.others.filter((_, at) => at !== index) })} className="mt-2 self-start">
              <Text className="text-sm text-zinc-400 underline">{REPORT_WORDS.removeLink}</Text>
            </Pressable>
          </View>
        ))}
        {draft.others.length < OTHER_LINKS_MAX ? <TextButton label={REPORT_WORDS.addLink} onPress={() => set({ others: [...draft.others, ""] })} /> : null}
        {/* Said before anything is sent: the anonymous path's one report reaches every image of the profile it names. */}
        {tooManyProfiles(draft, given) ? <ErrorText message={REPORT_WORDS.oneProfile} /> : null}
      </View>

      <Text className="mt-8 text-sm leading-5 text-zinc-400">
        {/* Who sees the sender is not said on the anonymous path, which records none. */}
        {[REPORT_WORDS.privacy.use, ...(anonymous ? [] : [REPORT_WORDS.privacy.sender]), REPORT_WORDS.privacy.access].join(" ")}
      </Text>
      {signedIn ? null : (
        <View className="mt-6">
          <Turnstile
            ref={turnstile}
            siteKey={SITE_KEY}
            options={{ theme: theme.turnstile, refreshExpired: "manual" }}
            onSuccess={setToken}
            onExpire={() => {
              setToken(null);
              turnstile.current?.reset();
            }}
            onError={() => setError(reportFailure(new ApiError(403, "human_check_failed", ""), anonymous))}
          />
          <Hint>{REPORT_WORDS.turnstile}</Hint>
        </View>
      )}

      <ErrorText message={error} />
      {/* What is still missing, in place of a button that silently does nothing; the one-profile sentence stands above already. */}
      {"problem" in built && built.problem !== REPORT_WORDS.oneProfile ? <Hint>{built.problem}</Hint> : null}
      <Button label={REPORT_WORDS.send} onPress={() => void send()} busy={busy} disabled={!("request" in built)} />
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}

/**
 * What the form shows once korbat took the report: its reference and how to follow it. A report sent signed out, or on
 * the anonymous path, is followed with a link that is shown only now, its token in the fragment, which no server is sent;
 * a signed-in report on a rule or on the law is in the account's own list. The answer carries a token exactly in the
 * first case, so the token decides.
 */
export function ReportSent({ answer, signedIn, origin }: { answer: { ref: string; token?: string }; signedIn: boolean; origin: string }) {
  const [copied, setCopied] = useState(false);
  const link = answer.token ? statusLink(origin, answer.ref, answer.token) : null;

  async function copy() {
    if (!link) return;
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;
    try {
      await clipboard?.writeText(link);
      setCopied(clipboard !== undefined);
    } catch {
      // The browser refused the clipboard: the link stays on screen to be selected.
      setCopied(false);
    }
  }

  return (
    <View>
      <Title>{REPORT_WORDS.sent}</Title>
      <Body>{REPORT_WORDS.reference(answer.ref)}</Body>
      {link ? (
        <>
          <Body>{REPORT_WORDS.keepLink}</Body>
          <Text selectable className="mt-4 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
            {link}
          </Text>
          <Button label={copied ? REPORT_WORDS.copied : REPORT_WORDS.copy} onPress={() => void copy()} tone="secondary" />
        </>
      ) : signedIn ? (
        <>
          <Body>{REPORT_WORDS.followInSettings}</Body>
          <TextLink label={REPORT_WORDS.yourReports} href="/settings/cases?tab=reports" />
        </>
      ) : null}
      <TextLink label="Back to korbat" href="/" replace />
    </View>
  );
}
```

### Replace `apps/app/tailwind.config.js` (whole file)

```js
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
  theme: {
    extend: {
      colors: Object.fromEntries(TOKENS.map((token) => [token, `rgb(var(--k-${token}) / <alpha-value>)`])),
      // Radius says what kind of thing a shape is (section 4.5): controls, media, cards, sheets, and round things.
      borderRadius: { control: "10px", media: "12px", card: "16px", sheet: "24px", full: "9999px" },
    },
  },
  plugins: [],
};
```

## Step 4: verify: install

```bash
pnpm install --config.package-import-method=copy
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.2s using pnpm v10.30.0
```

## Step 5: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.1s using pnpm v10.30.0
```

## Step 6: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
19 new package versions since HEAD; all at least 7 days old
```

## Step 7: verify: typecheck

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

## Step 8: verify: test

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
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  370 passed (370)
apps/admin test:       Tests  584 passed (584)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 9: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-mono-OFL.txt`
- `apps/app/assets/fonts/LICENSES/atkinson-hyperlegible-next-OFL.txt`
- `apps/app/assets/fonts/LICENSES/fraunces-OFL.txt`
- `apps/app/global.css`
- `apps/app/metro.config.js`
- `apps/app/package.json`
- `apps/app/public/index.html`
- `apps/app/public/theme-boot.js`
- `apps/app/src/app/(auth)/password.tsx`
- `apps/app/src/app/(auth)/signin.tsx`
- `apps/app/src/app/_layout.tsx`
- `apps/app/src/components/icons.ts`
- `apps/app/src/components/kit/Icon.tsx`
- `apps/app/src/components/kit/Icon.web.tsx`
- `apps/app/src/components/kit/Text.tsx`
- `apps/app/src/components/moderation/ReportForm.tsx`
- `apps/app/src/lib/appearance.ts`
- `apps/app/src/theme/ThemeProvider.tsx`
- `apps/app/src/theme/cn.ts`
- `apps/app/src/theme/fonts.ts`
- `apps/app/src/theme/fonts.web.ts`
- `apps/app/src/theme/layout.ts`
- `apps/app/src/theme/motion.ts`
- `apps/app/src/theme/scope.ts`
- `apps/app/src/theme/scope.web.ts`
- `apps/app/src/theme/tokens.ts`
- `apps/app/tailwind.config.js`
- `apps/app/test/appearance.test.ts`
- `apps/app/test/boot.ts`
- `apps/app/test/browser/baseline.json`
- `apps/app/test/contrast.test.ts`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/theme.test.ts`
- `apps/app/vitest.config.mts`
- `pnpm-lock.yaml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(app): the design language in code and the theme from the first frame: src/theme/tokens.ts holds Light, Dim and Dark (ink and paper with one violet accent) and TEXT_PAIRS, every pair at its WCAG minimum in every theme, mirrored as --k-<token> triplets in global.css and mapped by tailwind.config.js with five radii; ThemeProvider follows the system under System, sets the html class, color-scheme and theme-color on web and NativeWind's vars() on native, and useTheme() works without it; public/theme-boot.js paints the stored theme before the bundle; lib/appearance.ts keeps the reader's choices under korbat.appearance and survives bad records and refused storage; Fraunces, Atkinson Hyperlegible Next and Mono bundled with their licences; kit/Text with ten variants and the text step in rem; kit/Icon over Lucide 1.55.0; the human check follows the theme; the web export's baseline recorded" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the design language in code and the theme from the first frame: src/theme/tokens.ts holds Light, Dim and Dark (ink and paper with one violet accent) and TEXT_PAIRS, every pair at its WCAG minimum in every theme, mirrored as --k-<token> triplets in global.css and mapped by tailwind.config.js with five radii; ThemeProvider follows the system under System, sets the html class, color-scheme and theme-color on web and NativeWind's vars() on native, and useTheme() works without it; public/theme-boot.js paints the stored theme before the bundle; lib/appearance.ts keeps the reader's choices under korbat.appearance and survives bad records and refused storage; Fraunces, Atkinson Hyperlegible Next and Mono bundled with their licences; kit/Text with ten variants and the text step in rem; kit/Icon over Lucide 1.55.0; the human check follows the theme; the web export's baseline recorded`.

## Report format (mandatory)

```text
TASK 1 REPORT
Files written: <count, expected 35>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
