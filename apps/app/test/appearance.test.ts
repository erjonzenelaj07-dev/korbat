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
