import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MeResponse } from "@korbat/contracts";
import AppearanceSettings, { APPEARANCE_RADIOS, APPEARANCE_SWITCHES, chooseAppearance, clearThisDevice, hapticsShown } from "../src/app/settings/appearance";
import SettingsIndex from "../src/app/settings/index";
import SettingsLayout from "../src/app/settings/_layout";
import { ICONS } from "../src/components/icons";
import { textStyle } from "../src/components/kit/Text";
import { toast } from "../src/components/toast";
import { DEFAULT_APPEARANCE, readAppearance, setAppearance, type Appearance } from "../src/lib/appearance";
import { CASES_WORDS } from "../src/lib/moderation-words";
import { TITLE_WORDS, UI_WORDS } from "../src/lib/ui-words";
import { STILL_RULE, THEME_FADE_RULE } from "../src/theme/fonts.web";
import { THEME_FADE } from "../src/theme/motion";
import { themeFade } from "../src/theme/ThemeProvider";

/**
 * The Appearance and accessibility page and the Settings index (UI design, section 8.8, UI Task 8): every choice on the
 * page written to the store at once, the radio groups and the switch rows as the store says, the sample post following
 * the text size, the page signed out without the settings row, Clear what this device keeps, the index's six rows, the
 * settings layout letting only Appearance through signed out, and the theme's cross-fade (section 5.2). Rendered through
 * react-dom/server and react-native-web as the other screens' tests render them; what a static render cannot press is
 * called through the functions the page's rows call.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

const shell = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown, pathname: "/settings/appearance" }));

// expo-router cannot load in Node: Link with asChild hands its child the href, Redirect and Stack draw a mark of their own
// so a test sees which one a layout chose, and the path is the test's.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: ({ href }: { href: string }) => createElement("i", { "data-redirect": href }),
  Stack: () => createElement("i", { "data-stack": "" }),
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => ({}),
  usePathname: () => shell.pathname,
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: shell.state, refresh: async () => shell.state }) }));
// The title goes into the document's head through expo-router/head; here it is drawn in place, so a test can read it.
vi.mock("expo-router/head", () => ({ default: ({ children }: { children: ReactNode }) => createElement("template", { "data-head": "" }, children) }));

const ME: MeResponse = {
  user: { id: "00000000-0000-4000-8000-000000000001", email: "ada@example.org", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
  profile: { handle: "ada", displayName: "Ada Lovelace", handleChangedAt: null, verified: false, showInExplore: true },
  standing: null,
} as unknown as MeResponse;
const signedIn = () => ({ status: "signed-in", me: ME });

/** A browser's localStorage, with the length and key() the reading places and the drafts walk their keys by. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
  setAppearance(DEFAULT_APPEARANCE);
  shell.state = { status: "signed-out" };
  shell.pathname = "/settings/appearance";
});

afterEach(() => {
  setAppearance(DEFAULT_APPEARANCE);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ +/g, " ")
    .trim();
const anchors = (markup: string): string[] => markup.match(/<a [^>]*>/g) ?? [];
const hrefOf = (tag: string): string | undefined => /href="([^"]*)"/.exec(tag)?.[1];
const stored = (): Record<string, unknown> => JSON.parse(storage.items.get("korbat.appearance") ?? "{}") as Record<string, unknown>;

/** Every radio's opening tag with the words that follow it up to the next radio: its label comes first. */
function radios(markup: string): { tag: string; label: string; checked: boolean }[] {
  const parts = markup.split(/(?=<[a-z]+ [^>]*role="radio")/).slice(1);
  return parts.map((part) => {
    const tag = /^<[^>]+>/.exec(part)?.[0] ?? "";
    // The "Aa" a text size or font row draws in its own size or face is decoration, hidden from assistive technology.
    const label = textOf(part.slice(tag.length))
      .split(" ")
      .filter((word) => word !== UI_WORDS["appearance.glyphs"])
      .join(" ");
    return { tag, label, checked: tag.includes('aria-checked="true"') };
  });
}

/** The markup of each radio group, in order, up to the next group (groups are never nested). */
function groups(markup: string): string[] {
  const starts = [...markup.matchAll(/<[a-z]+ [^>]*role="radiogroup"/g)].map((match) => match.index ?? 0);
  return starts.map((start, n) => markup.slice(start, starts[n + 1] ?? markup.length));
}

/** The radio of group `n` whose label starts with `label`. */
const radio = (markup: string, n: number, label: string) => radios(groups(markup)[n] ?? "").find((one) => one.label.startsWith(label));

/** The switch input named `label`, or "" when there is none. */
const switchTag = (markup: string, label: string): string => (markup.match(/<input[^>]*role="switch"[^>]*>/g) ?? []).find((tag) => tag.includes(`aria-label="${label}"`)) ?? "";

describe("Appearance and accessibility (section 8.8)", () => {
  test("each radio choice is written to the store at once, with the selection haptic first, and the page shows it chosen", () => {
    for (const [n, group] of APPEARANCE_RADIOS.entries()) {
      for (const choice of group.choices) {
        // Dark style shows only under System, so every group is on the page while its choices are checked.
        setAppearance({ theme: "system" });
        const before = readAppearance()[group.field];
        const heard: { intent: string; value: unknown }[] = [];
        chooseAppearance(group.field, choice.value as never, (intent) => heard.push({ intent, value: readAppearance()[group.field] }));
        expect(heard, `${group.field} ${choice.value}`).toEqual([{ intent: "selection", value: before }]);
        expect(readAppearance()[group.field], group.field).toBe(choice.value);
        expect(stored()[group.field], group.field).toBe(choice.value);
        const out = html(<AppearanceSettings />);
        // The theme's group is the first whatever it holds, and under System every group after it keeps its place.
        expect(radio(out, n, UI_WORDS[choice.label])?.checked, `${group.field} ${choice.value}`).toBe(true);
      }
    }
  });

  test("the radio groups are named by their headings and hold their choices in the design's order", () => {
    setAppearance({ theme: "system" });
    const out = html(<AppearanceSettings />);
    const groups = out.match(/<[a-z]+ [^>]*role="radiogroup"[^>]*>/g) ?? [];
    expect(groups).toHaveLength(APPEARANCE_RADIOS.length);
    for (const group of groups) {
      const id = /aria-labelledby="([^"]+)"/.exec(group)?.[1] ?? "";
      expect(id).not.toBe("");
      expect(out).toContain(`id="${id}"`);
    }
    expect(radios(out).map((one) => one.label.split(" ")[0])).toEqual(
      APPEARANCE_RADIOS.flatMap((group) => group.choices.map((choice) => UI_WORDS[choice.label].split(" ")[0])),
    );
    expect(APPEARANCE_RADIOS.map((group) => group.choices.map((choice) => choice.value))).toEqual([
      ["system", "light", "dim", "dark"],
      ["dim", "dark"],
      ["smaller", "default", "larger", "largest"],
      ["korbat", "system"],
      ["system", "always"],
    ]);
    // One tab stop per group: the chosen row; the arrows move from there (kit.test.tsx's radioMove).
    for (const one of radios(out)) expect(one.tag, one.label).toContain(one.checked ? 'tabindex="0"' : 'tabindex="-1"');
  });

  test("Dark style shows only while the theme is System", () => {
    setAppearance({ theme: "light" });
    expect(textOf(html(<AppearanceSettings />))).not.toContain(UI_WORDS["appearance.darkStyle"]);
    setAppearance({ theme: "system" });
    expect(textOf(html(<AppearanceSettings />))).toContain(UI_WORDS["appearance.darkStyle"]);
  });

  test("the three reading switches, off by default, are written to the store at once and named by their words", () => {
    expect(APPEARANCE_SWITCHES.map((one) => one.field)).toEqual(["autoLoad", "openNewest", "hideCounts"]);
    for (const one of APPEARANCE_SWITCHES) {
      const off = switchTag(html(<AppearanceSettings />), UI_WORDS[one.label]);
      expect(off, one.field).not.toBe("");
      expect(off, one.field).not.toContain("checked");
      chooseAppearance(one.field, true as never);
      expect(stored()[one.field], one.field).toBe(true);
      expect(switchTag(html(<AppearanceSettings />), UI_WORDS[one.label]), one.field).toContain('checked=""');
    }
    // Ruling 12 of the owner: the switch hides follower counts too, and its words say so.
    expect(UI_WORDS["appearance.hideCounts"]).toBe("Hide like, repost and follower counts");
  });

  test("the sample post follows the text size", () => {
    for (const step of ["smaller", "default", "larger", "largest"] as const) {
      setAppearance({ textStep: step });
      const out = html(<AppearanceSettings />);
      const at = out.indexOf(UI_WORDS["appearance.sample"]);
      expect(at, step).toBeGreaterThan(0);
      const tag = out.slice(out.lastIndexOf("<", at), out.indexOf(">", out.lastIndexOf("<", at)) + 1);
      expect(tag, step).toContain(`font-size:${String(textStyle("post", { step, font: "korbat" }, "web").fontSize)}`);
    }
  });

  test("Haptics is a switch on iOS and Android only, so the web shows no Haptics row", () => {
    expect(hapticsShown("web")).toBe(false);
    expect(hapticsShown("ios")).toBe(true);
    expect(hapticsShown("android")).toBe(true);
    expect(switchTag(html(<AppearanceSettings />), UI_WORDS["appearance.haptics"])).toBe("");
    chooseAppearance("haptics", false);
    expect(stored().haptics).toBe(false);
  });

  test("signed out the page has its title and its choices, and no settings row; signed in the row names Appearance current", () => {
    const out = html(<AppearanceSettings />);
    expect(out).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["appearance.title"]}</h1>`));
    expect(/<title>([^<]*)<[/]title>/.exec(out)?.[1]).toBe(TITLE_WORDS["title.settingsAppearance"]);
    expect(out).not.toMatch(/<nav [^>]*aria-label="Settings"/);
    expect(anchors(out).map(hrefOf).filter((href) => href?.startsWith("/settings/") && href !== "/settings/appearance")).toEqual([]);
    expect(radios(out).length).toBeGreaterThan(0);
    shell.state = signedIn();
    const mine = html(<AppearanceSettings />);
    const row = /<nav [^>]*aria-label="Settings"[^>]*>[^]*?<[/]nav>/.exec(mine)?.[0] ?? "";
    expect(anchors(row).map(hrefOf)[0]).toBe("/settings/appearance");
    expect(anchors(row).filter((tag) => tag.includes('aria-current="page"')).map(hrefOf)).toEqual(["/settings/appearance"]);
  });

  test("On this device says what korbat keeps here and what stays, and its button is a secondary one", () => {
    const out = html(<AppearanceSettings />);
    expect(textOf(out)).toContain(UI_WORDS["device.title"]);
    expect(textOf(out)).toContain(UI_WORDS["device.body"]);
    expect(textOf(out)).toContain(UI_WORDS["device.clear"]);
    const source = readFileSync(path.join(SRC, "app", "settings", "appearance.tsx"), "utf8");
    expect(source).toContain('label={UI_WORDS["device.clear"]} onPress={clearThisDevice} tone="secondary"');
  });

  test("Clear what this device keeps removes the appearance, the reading places and the drafts, keeps the device id and Not now, and says Cleared", () => {
    storage.items.set("korbat.place.00000000-0000-4000-8000-000000000001", "{}");
    storage.items.set("korbat.drafts.00000000-0000-4000-8000-000000000001", '{"post":"Words"}');
    storage.items.set("korbat.deviceId", "device-1");
    storage.items.set("korbat.passkeySuggestion.dismissedAt", "1");
    setAppearance({ theme: "dark", textStep: "largest" });
    const show = vi.spyOn(toast, "show").mockImplementation(() => undefined);
    clearThisDevice();
    expect([...storage.items.keys()].sort()).toEqual(["korbat.deviceId", "korbat.passkeySuggestion.dismissedAt"]);
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({ message: UI_WORDS["toast.cleared"] });
  });
});

describe("the Settings index (section 8.8, ruling 10)", () => {
  test("lists Appearance first, then Security, Privacy, Profile, Account, Import posts (3b Task 7) and Cases, each a link with its icon, and no settings row", () => {
    shell.state = signedIn();
    shell.pathname = "/settings";
    const out = html(<SettingsIndex />);
    expect(out).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["settings.title"]}</h1>`));
    expect(/<title>([^<]*)<[/]title>/.exec(out)?.[1]).toBe(TITLE_WORDS["title.settingsIndex"]);
    expect(out).not.toMatch(/<nav [^>]*aria-label="Settings"/);
    const rows: [string, string, keyof typeof ICONS][] = [
      ["/settings/appearance", UI_WORDS["appearance.nav"], "appearance"],
      ["/settings/security", UI_WORDS["settings.security"], "security"],
      ["/settings/privacy", UI_WORDS["settings.privacy"], "privacy"],
      ["/settings/profile", UI_WORDS["settings.profile"], "edit-profile"],
      ["/settings/account", UI_WORDS["settings.account"], "account"], ["/settings/import", IMPORT_WORDS["import.title"], "import"],
      ["/settings/cases", CASES_WORDS.nav, "cases"],
    ];
    // The main column only: the shell's nav and tab bar hold their own Settings link.
    const main = out.slice(out.indexOf("<h1"), out.indexOf("</main>"));
    expect(anchors(main).map(hrefOf)).toEqual(rows.map(([href]) => href));
    for (const [href, label, icon] of rows) {
      const link = new RegExp(`<a [^>]*href="${href}"[^>]*>([^]*?)</a>`).exec(main)?.[1] ?? "";
      expect(textOf(link), href).toBe(label);
      const lucide = `lucide-${ICONS[icon].replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
      expect(link, href).toContain(lucide);
    }
  });
});

describe("the settings layout", () => {
  test("lets Appearance through signed out and sends every other settings page, the index too, to sign-in", () => {
    shell.state = { status: "signed-out" };
    shell.pathname = "/settings/appearance";
    expect(html(<SettingsLayout />)).toContain("data-stack");
    for (const pathname of ["/settings", "/settings/security", "/settings/privacy", "/settings/cases"]) {
      shell.pathname = pathname;
      expect(html(<SettingsLayout />), pathname).toContain('data-redirect="/signin"');
    }
    shell.state = signedIn();
    for (const pathname of ["/settings", "/settings/appearance", "/settings/security"]) {
      shell.pathname = pathname;
      expect(html(<SettingsLayout />), pathname).toContain("data-stack");
    }
    // An account still choosing its handle finishes that first, as before.
    shell.state = { status: "signed-in", me: { ...ME, user: { ...ME.user, onboarded: false } } };
    shell.pathname = "/settings/security";
    expect(html(<SettingsLayout />)).toContain('data-redirect="/handle"');
  });
});

describe("the theme's cross-fade (section 5.2)", () => {
  test("none on the first paint or when the theme stays; 200 ms on a change, 150 ms under reduced motion", () => {
    expect(themeFade(null, "dark", false)).toBeNull();
    expect(themeFade("dark", "dark", false)).toBeNull();
    expect(themeFade("light", "dark", false)).toBe(200);
    expect(themeFade("dark", "dim", true)).toBe(150);
    expect(THEME_FADE.duration).toBe(200);
    expect(THEME_FADE.reduced).toBe(150);
  });

  test("its rule rides in the style element beside the toasts' still rule: colours only, at the duration the class carries, never a toast's own motion", () => {
    expect(THEME_FADE_RULE).toContain(`html.${THEME_FADE.className}`);
    expect(THEME_FADE_RULE).toContain(`var(${THEME_FADE.property})`);
    expect(THEME_FADE_RULE).toContain("background-color");
    expect(THEME_FADE_RULE).toContain("ease");
    expect(THEME_FADE_RULE).not.toMatch(/transform|opacity/);
    expect(THEME_FADE_RULE).toContain(":not([data-sonner-toast])");
    const fonts = readFileSync(path.join(SRC, "theme", "fonts.web.ts"), "utf8");
    expect(fonts).toContain("`${fontFaceCss()} ${STILL_RULE} ${DRAW_RULE} ${THEME_FADE_RULE}`");
    expect(STILL_RULE).toContain(".k-still");
    // The class goes on only when the theme changes after the first apply, and comes off after the fade.
    const provider = readFileSync(path.join(SRC, "theme", "ThemeProvider.tsx"), "utf8");
    expect(provider).toContain("themeFade(shown, theme.name, reduced)");
    expect(provider).toContain("root.classList.remove(THEME_FADE.className)");
  });
});

describe("what a choice of the page is", () => {
  test("every field of the store but haptics is on the page as a radio group or a switch; haptics is the native switch", () => {
    const fields = [...APPEARANCE_RADIOS.map((group) => group.field), ...APPEARANCE_SWITCHES.map((one) => one.field), "haptics"];
    expect([...fields].sort()).toEqual((Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]).sort());
  });
});

// 3b Task 7 appends below, so no line above moves: the Settings index's Import posts row (3b design, section 10.1).
import { IMPORT_WORDS } from "../src/lib/import-words";
