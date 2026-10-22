# korbat interface and experience (UI) — Task 8 of 10: Settings, security, auth and Appearance: section 8.8's Appearance and accessibility page, open signed out, with its radio groups, Reading switches, sample post and On this device, the Settings index the nav's Settings item opens, Security, Privacy, Profile, Account and components/security on the kit, and section 8.10's sign-in flow and token pages in PublicFrame, with the theme's cross-fade and the legacy lists emptied.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 8 of ten in korbat's UI sub-project (interface and experience), the second of the batch of Tasks 7 and 8, which it ends with the browser check's full matrix, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Tasks 1 to 7. It follows sections 8.8 and 8.10 with 5.2's theme row, 5.3, 6.10, 6.11, 8.1, 1.5, 4.2, 10 and 12.3 and the owner's rulings 10 and 12; Task 9 restyles the console within its policy next, and Task 10 records the dry run.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): moderation surfaces and the public pages: the author's chip on a withheld or removed post is the button that opens components/moderation/StatusSheet.tsx, named by its words, which reads GET /api/moderation/decisions/:id each time it opens and keeps the answer in its own state, with skeleton blocks while it waits, ErrorState's Try again, and labelled blocks in the design's order (Rule, What it does, Applies to, Who can see it now, Decided by in role terms, When, Statement with Read the full decision, and Appeal, first while one can be filed, which opens the decision with ?appeal=1 and its field focused); a grid that holds a hidden image gains Why are images hidden? to /rules; DecisionDetail, the Cases lists, the report form, a report's status and the notices move onto the tokens as cards, rows and labelled lines, Cases on Tabs; the case screens, /report and /notice take their titles in ScreenHeader with skeletons inside the shell; /rules, /transparency and How Explore works read in components/Prose.tsx's layout and the terms in PublicFrame's 640 px column; the browser check gains steps 32 to 34`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/08-settings-security-auth-appearance.md 1
```

Expected: 11 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/appearance-page.test.tsx`

```tsx
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
  test("lists Appearance first, then Security, Privacy, Profile, Account and Cases, each a link with its icon, and no settings row", () => {
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
      ["/settings/account", UI_WORDS["settings.account"], "account"],
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
```

### Replace `apps/app/test/browser/app.browser.ts` (whole file)

```ts
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { THEMES, type ThemeName } from "../../src/theme/tokens";
import { TITLE_WORDS, UI_WORDS } from "../../src/lib/ui-words";
import { THEME_FADE } from "../../src/theme/motion";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS } from "../../src/lib/moderation-words";
import { RULES_PAGE } from "../../src/lib/public-pages";
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import {
  ADA,
  createFixtureApi,
  DECISION_ID,
  GRACE,
  HIDDEN_IMAGE_POST_ID,
  MISSING_POST_ID,
  newPostIdOf,
  NOTICE_REF,
  NOTICE_TOKEN,
  POST_DECISION_ID,
  POST_ID,
  postIdOf,
  RELEASE_ID,
  REMOVED_CHIP,
  UPLOAD_ID,
  writtenIdOf,
  type FixtureApi,
} from "./fixture-api";
import { HOLD_MS, startAppSite, type AppSiteServer } from "./server";
import { clippedLabels, phoneProblems, TURNSTILE_ORIGIN, watch, type Watcher } from "./watch";

/**
 * The app's browser check (UI design, section 12.3, decision 20; Task 3): the web export, built once per run with the
 * check's own environment (no apps/app/.env, an empty API base so every call goes to this server's origin, Cloudflare's
 * published Turnstile test key), served as Caddy's app site serves it by test/browser/server.ts, with the fixture API
 * of fixture-api.ts beside it, and walked in Chromium through playwright-core. Turnstile's script is answered by a stub
 * that hands its widget a test token, so the walk needs no network and no stack. Each step opens its own browser context
 * (its width, theme, motion and session) and fails on any policy report, console error or warning, page error, dialog,
 * failed request or request the fixtures do not answer (watch.ts).
 *
 * The steps, one test each: the budgets of section 11.3; the Caddyfile's headers; the first paint in the stored theme
 * with the bundle held back; the layout at 360, 768 and 1280 px on Home, a post, a profile, /rules and a missing page;
 * the keyboard; contrast as drawn in Light, Dim and Dark; text at Largest with the root at 200 percent at 320 px; every
 * route signed out and signed in; the requests and the time before the first content; the offline banner; the header
 * that hides on a phone, and stays under reduced motion; the soft reset; and from Task 4 the lightbox, Like with its
 * rollback, Follow with its rollback, the menus, and Who sees this; from Task 5 the new-posts pill, the reading place, the
 * feeds kept across tabs, the keyboard on Home, and the focus after a delete with the thread held at its post; from Task
 * 6 the composer: the sheet and its toast at 360, the discard question and the drafts, Home's card and New post at
 * 1280, a reply and a quote; from Task 7 the chip's details sheet, the appeal it opens and Cases' tabs, and the link
 * under a hidden image with the terms in their frame; from Task 8 the Settings index, Appearance and its radios, the
 * theme's cross-fade, the switch rows with Hide counts, and Clear what this device keeps. Later tasks add their steps.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome. The
 * screenshots of the layout steps go to KORBAT_SHOTS, or to a new folder in the system's temporary folder, and are
 * never compared pixel by pixel.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";
const APP = path.resolve(import.meta.dirname, "..", "..");
const REPO = path.resolve(APP, "..", "..");

/** The export's environment (section 12.3): set in the child, so the developer's apps/app/.env is never read. */
const EXPORT_ENV: Record<string, string> = {
  EXPO_NO_DOTENV: "1",
  EXPO_NO_TELEMETRY: "1",
  CI: "1",
  EXPO_PUBLIC_API_URL: "",
  EXPO_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  EXPO_PUBLIC_BADGE: "off",
  EXPO_PUBLIC_CONTACT_EMAIL: "contact@korbat.local",
  EXPO_PUBLIC_CONTACT_POINT: "",
  EXPO_PUBLIC_HOME_STATE: "",
};

/** The test token Turnstile's stub gives every widget, as Cloudflare's test keys do. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Turnstile's script as the walk answers it: window.turnstile with the calls @marsidev/react-turnstile makes, a widget
 * that hands its callback the test token at once, and the load callback the script's address names.
 */
const TURNSTILE_STUB = `
(function () {
  var source = document.currentScript && document.currentScript.src ? new URL(document.currentScript.src) : null;
  var count = 0;
  window.turnstile = {
    render: function (container, options) {
      count += 1;
      var id = "stub-" + count;
      setTimeout(function () { if (options && typeof options.callback === "function") options.callback(${JSON.stringify(TURNSTILE_TOKEN)}); }, 0);
      return id;
    },
    reset: function () {},
    remove: function () {},
    execute: function () {},
    getResponse: function () { return ${JSON.stringify(TURNSTILE_TOKEN)}; },
    isExpired: function () { return false; },
    ready: function (callback) { callback(); }
  };
  var onload = source ? source.searchParams.get("onload") : null;
  if (onload && typeof window[onload] === "function") window[onload]();
})();
`;

let out = "";
let shots = "";
let site: AppSiteServer | undefined;
let browser: Browser | undefined;
let fixtures: FixtureApi;
let origin = "";

/** Runs the export into `dir`, failing with the end of its output. */
function exportWeb(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO, "node_modules", "expo", "bin", "cli"), "export", "--platform", "web", "--output-dir", dir, "--clear"], {
      cwd: APP,
      env: { ...process.env, ...EXPORT_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (log += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`expo export exited with ${code}: ${log.slice(-3000)}`))));
  });
}

interface Visit {
  context: BrowserContext;
  page: Page;
  watcher: Watcher;
}

interface VisitOptions {
  width: number;
  height: number;
  signedIn?: boolean;
  /** The reader's stored appearance (korbat.appearance), set before any of the page's scripts runs. */
  appearance?: Record<string, unknown>;
  reducedMotion?: "reduce" | "no-preference";
  colorScheme?: "light" | "dark";
}

/** A fresh browser context at a width, with its session, appearance and motion, watched, and Turnstile stubbed. */
async function open(options: VisitOptions): Promise<Visit> {
  fixtures.state.signedIn = options.signedIn ?? true;
  const context = await browser!.newContext({
    viewport: { width: options.width, height: options.height },
    timezoneId: "UTC",
    locale: "en-GB",
    reducedMotion: options.reducedMotion ?? "no-preference",
    colorScheme: options.colorScheme ?? "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const watcher = await watch(context, page, origin);
  // Registered after the watcher's catch-all, so it runs first: Turnstile's address is answered by the stub.
  await context.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: TURNSTILE_STUB }));
  if (options.appearance) {
    const stored = JSON.stringify(JSON.stringify(options.appearance));
    await context.addInitScript({ content: `try { window.localStorage.setItem("korbat.appearance", ${stored}); } catch (error) {}` });
  }
  return { context, page, watcher };
}

/** Opens a path and waits until the page has asked for and drawn what it needs, and its fonts are in. */
async function visit(page: Page, route: string): Promise<void> {
  await page.goto(`${origin}${route}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/**
 * UI Task 8: forgets the reading places and drafts the signed-in pages of a step kept, before it opens a page signed out.
 * A signed-out start with one kept is a session that ended elsewhere (section 8.8), which clears the appearance with them
 * and would cross-fade the step's theme back to System while the page is measured.
 */
async function forgetSession(page: Page): Promise<void> {
  await page.evaluate(`Object.keys(localStorage).filter((key) => key.startsWith("korbat.place.") || key.startsWith("korbat.drafts.")).forEach((key) => localStorage.removeItem(key))`);
}

/** The end of every step: no report, error, warning or dialog on any channel, and nothing the fixtures did not answer. */
async function clean(visit: Visit): Promise<void> {
  expect(visit.watcher.take()).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** Waits until an expression is true in the page. The expression is plain text, evaluated as the page's own code is not. */
async function until(page: Page, expression: string, what: string, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`not within ${timeout} ms: ${what}`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A token colour as getComputedStyle writes it. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/**
 * KORBAT_APP_EXPORT names an export already built with EXPORT_ENV, which a developer re-running the walk while working on
 * it may reuse; it is read and never deleted. Without it, as the gates run the check, the walk builds its own.
 */
const PREBUILT = process.env.KORBAT_APP_EXPORT ? path.resolve(process.env.KORBAT_APP_EXPORT) : null;

beforeAll(async () => {
  shots = process.env.KORBAT_SHOTS ? path.resolve(process.env.KORBAT_SHOTS) : mkdtempSync(path.join(tmpdir(), "korbat-app-shots-"));
  mkdirSync(shots, { recursive: true });
  console.log(`screenshots: ${shots}`);
  if (PREBUILT) {
    out = PREBUILT;
  } else {
    out = mkdtempSync(path.join(tmpdir(), "korbat-app-browser-"));
    await exportWeb(out);
  }
  fixtures = createFixtureApi();
  site = await startAppSite({ dist: out, api: fixtures.handle, postStatus: fixtures.postStatus });
  origin = site.origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out && !PREBUILT) rmSync(out, { recursive: true, force: true });
});

/** The files of the export under a folder, with their sizes raw and gzip at level 9 (Task 1's method, baseline.json). */
function sizes(folder: string): { name: string; bytes: number; gzip: number }[] {
  const dir = path.join(out, folder);
  return readdirSync(dir).map((name) => {
    const bytes = readFileSync(path.join(dir, name));
    return { name, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  });
}

/** The routes of the app (section 3.1) with the fixtures' ids, for the walk through every one. */
const TOKEN = "B".repeat(43);
const ROUTES = [
  "/",
  "/?tab=latest",
  "/?tab=explore",
  "/bookmarks",
  "/explore/about",
  `/post/${POST_ID}`,
  "/u/grace",
  "/u/ada",
  "/u/grace/followers",
  "/u/grace/following",
  "/report",
  `/notice/${NOTICE_REF}#t=${NOTICE_TOKEN}`,
  "/rules",
  "/transparency",
  "/terms",
  // UI Task 8: the Settings index and Appearance.
  "/settings",
  "/settings/appearance",
  "/settings/security",
  "/settings/privacy",
  "/settings/profile",
  "/settings/account",
  "/settings/cases",
  `/settings/cases/${DECISION_ID}`,
  // UI Task 7: the decision of Ada's removed post, opened as its details sheet's Appeal opens it.
  `/settings/cases/${POST_DECISION_ID}?appeal=1`,
  `/settings/cases/${DECISION_ID}/reply`,
  `/settings/cases/releases/${RELEASE_ID}`,
  `/settings/cases/uploads/${UPLOAD_ID}`,
  "/signin",
  "/code",
  "/password",
  "/mfa",
  "/age",
  "/handle",
  `/email-revert/${TOKEN}`,
  `/not-me/${TOKEN}`,
  `/passkey-remove/${TOKEN}`,
  "/no-such-page",
];

/**
 * The parts of a page this sub-project has drawn so far, which the walk holds to the phone's target rule, the labels'
 * fit and contrast as drawn: the skip link, the nav, the context column, the screen header, the offline banner, and a
 * screen that is the kit's alone (the missing page); from Task 4 every post card (an article), every sheet and dialog,
 * a menu's popover, the follow button and the toaster; from Task 5 every row of a feed (its posts, the marker, Load more,
 * the end), the tab lists, the new-posts pill, the profile's header and the thread's posts; from Task 6 every feed whole,
 * its header with Home's card and the thread's reply card included, and the compose button; from Task 7 the column of
 * every screen it moved onto the tokens (`data-screen`: the cases screens, the report form, a report's status, the
 * public pages) and PublicFrame's banner and footer; from Task 8, with the legacy lists empty, the whole main column of
 * the shell and of PublicFrame, and every radio group.
 */
const DRAWN = [
  'a[href="#main"]',
  'nav[aria-label="Main"]',
  'aside[aria-label="About korbat"]',
  "#screen-header",
  'main > [role="status"]',
  '[role="article"]',
  '[role="dialog"]',
  "[data-menu]",
  "[data-follow]",
  "[data-sonner-toaster]",
  '[role="feed"]',
  "[data-compose]",
  '[role="tablist"]',
  "[data-pill]",
  "[data-profile-header]",
  "[data-thread]",
  "[data-screen]",
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="main"]',
  '[role="radiogroup"]',
].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/**
 * The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each;
 * from Task 5 Bookmarks and a followers list too, drawn wholly on the kit; from Task 7 the rules wholly, Cases and a
 * decision under Settings, and the terms, which sit in PublicFrame outside the shell (`frame`), so the shell's own
 * checks pass them over; from Task 8 the Settings index, Appearance signed in and out (`signedOut`), Security, and the
 * sign-in screen in its frame.
 */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string; frame?: boolean; signedOut?: boolean }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: ALL },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
  { name: "bookmarks", route: "/bookmarks", current: "/bookmarks", scope: ALL },
  { name: "followers", route: "/u/grace/followers", current: null, scope: ALL },
  { name: "cases", route: "/settings/cases", current: "/settings", scope: ALL },
  { name: "decision", route: `/settings/cases/${POST_DECISION_ID}`, current: "/settings", scope: ALL },
  { name: "terms", route: "/terms", current: null, scope: ALL, frame: true },
  { name: "settings", route: "/settings", current: "/settings", scope: ALL },
  { name: "appearance", route: "/settings/appearance", current: "/settings", scope: ALL },
  { name: "appearance-out", route: "/settings/appearance", current: "/settings/appearance", scope: ALL, signedOut: true },
  { name: "security", route: "/settings/security", current: "/settings", scope: ALL },
  { name: "signin", route: "/signin", current: null, scope: ALL, frame: true, signedOut: true },
];


/** What the layout of a page says of itself: its kind, the nav's current links, the context column, and the current item's marks. */
const LAYOUT_SCRIPT = `
(() => {
  const root = document.querySelector("[data-layout]");
  const nav = document.querySelector('nav[aria-label="Main"]');
  const current = nav ? [...nav.querySelectorAll('a[aria-current="page"]')] : [];
  const marks = current.length === 1 ? [current[0], ...current[0].querySelectorAll("*")].map((element) => {
    const rect = element.getBoundingClientRect();
    return { bg: getComputedStyle(element).backgroundColor, width: Math.round(rect.width), height: Math.round(rect.height) };
  }) : [];
  return {
    kind: root ? root.getAttribute("data-layout") : null,
    current: current.map((link) => link.getAttribute("href")),
    context: !!document.querySelector('aside[aria-label="About korbat"]'),
    marks,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
  };
})()
`;

interface Layout {
  kind: string | null;
  current: string[];
  context: boolean;
  marks: { bg: string; width: number; height: number }[];
  scroll: number;
  title: string;
}

/** The layout steps at one size: each page in Light and Dark, the shell's kind and marks, the phone's rules, screenshots. */
async function layoutStep(width: number, height: number, kind: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const visit_ = await open({ width, height, appearance: { theme } });
    try {
      for (const page of LAYOUT_PAGES) {
        // The session each page needs, read again as the page loads: Appearance signed out, and sign-in, which a signed-in
        // account leaves for its feed.
        fixtures.state.signedIn = page.signedOut !== true;
        if (page.signedOut === true) await forgetSession(visit_.page);
        await visit(visit_.page, page.route);
        const layout = (await visit_.page.evaluate(LAYOUT_SCRIPT)) as Layout;
        // A page in PublicFrame has no shell: no layout kind, no nav and no context column.
        expect(layout.kind, page.name).toBe(page.frame ? null : kind);
        expect(layout.current, page.name).toEqual(page.current === null ? [] : [page.current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(!page.frame && width >= 1024);
        expect(layout.scroll, `${page.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, page.scope), page.name).toEqual([]);
        if (width < 768) expect(await phoneProblems(visit_.page, page.scope), page.name).toEqual([]);
        if (page.current !== null) {
          // The current item: the accent-wash pill and a 3 px accent bar, so it is marked by shape as well as colour.
          const colours = THEMES[theme as ThemeName];
          expect(layout.marks.some((mark) => mark.bg === rgb(colours["accent-wash"])), `${page.name}: the pill`).toBe(true);
          expect(layout.marks.some((mark) => mark.bg === rgb(colours.accent) && (mark.width === 3 || mark.height === 3)), `${page.name}: the bar`).toBe(true);
        }
        if (page.name === "missing") {
          expect(layout.title).toBe(TITLE_WORDS["title.notFound"]);
          expect(await visit_.page.locator("h1").innerText()).toBe(UI_WORDS["notFound.title"]);
        }
        await screenshot(visit_.page, `layout-${width}-${theme}-${page.name}`);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  }
}

/**
 * Every text of the nav, the main column and the context column, sampled as drawn against its nearest opaque background
 * (with any see-through layers between blended in): 4.5:1, or 3:1 from 24 px, or 18.66 px in bold (WCAG 1.4.3). Text
 * hidden from assistive technology as decoration (aria-hidden, the skeletons), or clipped to 1 px, is passed over.
 */
const CONTRAST_SCRIPT = `
((scope) => {
  const parse = (value) => {
    const match = /rgba?[(]([^)]+)[)]/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const channel = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const background = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let colour = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (colour.a < 1) colour = over(colour, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = layers.length - 1; i >= 0; i--) colour = over(layers[i], colour);
    return colour;
  };
  const out = [];
  const regions = document.querySelectorAll(scope);
  for (const region of regions) {
    for (const element of region.querySelectorAll("*")) {
      const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
      if (!own) continue;
      if (element.closest("[aria-hidden=true]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden") continue;
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      if (opacity === 0) continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = background(element);
      const drawn = over({ ...fg, a: fg.a * opacity }, bg);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const least = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const found = ratio(drawn, bg);
      if (found < least) out.push(element.textContent.trim().slice(0, 40) + ": " + found.toFixed(2) + " < " + least + " (" + style.color + " on rgb(" + Math.round(bg.r) + ", " + Math.round(bg.g) + ", " + Math.round(bg.b) + "))");
    }
  }
  return out;
})
`;

/** The contrast failures of the text inside `scope`. */
const contrast = (page: Page, scope: string) => page.evaluate(`${CONTRAST_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;

/** The scroll box of the main column's list: the element in main that scrolls vertically and has more to scroll. */
const LIST = `(() => [...document.querySelectorAll("main *")].find((e) => { const s = getComputedStyle(e); return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 10; }) || null)()`;

/** The phone header's translateY, from its computed transform; null without one. */
const HEADER_Y = `(() => { const h = document.getElementById("screen-header"); if (!h) return null; const t = getComputedStyle(h).transform; if (t === "none") return 0; const m = /matrix[(]([^)]+)[)]/.exec(t); return m ? Number(m[1].split(",")[5]) : null; })()`;
const HEADER_HEIGHT = `(() => { const h = document.getElementById("screen-header"); return h ? h.getBoundingClientRect().height : null; })()`;

/** Scrolls the main column's list to `y`, in a few steps, as a reader's wheel would. */
async function scrollList(page: Page, y: number): Promise<void> {
  const from = (await page.evaluate(`(${LIST})?.scrollTop ?? 0`)) as number;
  for (let step = 1; step <= 4; step++) {
    await page.evaluate(`(() => { const list = ${LIST}; if (list) list.scrollTop = ${Math.round(from + ((y - from) * step) / 4)}; })()`);
    await pause(60);
  }
}

/**
 * The motion steps' three runs (section 12.3): no reduction, the system's reduced motion, and korbat's own "Reduce motion:
 * Always" with the system's off, as step 16 runs them.
 */
const MOTION_RUNS = [
  ["moves", {}],
  ["system-reduced", { reducedMotion: "reduce" as const }],
  ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
] as const;

/**
 * An element's computed transform or opacity on every frame for `ms`, from now: the element is found anew each frame by
 * `find`, a page expression, and a frame without it gives null. Started before a click, it sees the motion the click
 * starts from its first frame.
 */
function sampleFrames(page: Page, find: string, property: "transform" | "opacity", ms: number): Promise<(string | null)[]> {
  return page.evaluate(
    `new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { const e = ${find}; out.push(e ? getComputedStyle(e)[${JSON.stringify(property)}] : null); if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(out); }; tick(); })`,
  ) as Promise<(string | null)[]>;
}

/** Whether any frame drew a transform other than none or the identity: something moved. */
const transformed = (frames: (string | null)[]) => frames.some((frame) => frame !== null && frame !== "none" && frame !== "matrix(1, 0, 0, 1, 0, 0)");
/** Whether any frame drew the element less than opaque: something faded. */
const faded = (frames: (string | null)[]) => frames.some((frame) => frame !== null && Number(frame) < 0.98);

/** The accessible name of the open dialog, from the ids its aria-labelledby names. */
const DIALOG_NAME = `(() => { const d = document.querySelector('[role="dialog"]'); if (!d) return null; return (d.getAttribute("aria-labelledby") || "").split(" ").filter(Boolean).map((id) => { const e = document.getElementById(id); return e ? e.textContent : ""; }).join(" "); })()`;

/** What holds the focus: its name, or else its words. */
const FOCUSED = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; return (e.getAttribute("aria-label") || e.textContent || "").trim(); })()`;

/** The end of a step that had the fixtures refuse on purpose: the browser's report of each 503 is expected, nothing else. */
async function cleanAfterRefusals(visit: Visit): Promise<void> {
  expect(visit.watcher.take().filter((line) => !/status of 503/.test(line))).toEqual([]);
  expect(fixtures.state.problems.splice(0)).toEqual([]);
}

/** The n-th article of the list on screen (0 for the first). */
const article = (page: Page, n: number) => page.locator('[role="article"]').nth(n);
/** The article of fixture post `n`, found by its one link to the post. */
const postArticle = (page: Page, n: number) => page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${postIdOf(n)}"]`) });

/** UI Task 7: the chip of Ada's removed post on her own profile, the button that opens its details sheet. */
const statusChip = (page: Page) => page.locator('[aria-haspopup="dialog"]').filter({ hasText: REMOVED_CHIP });
/** The labelled blocks of the open details sheet, by their names, in their order. */
const STATUS_BLOCKS = `[...document.querySelectorAll('[role="dialog"] [data-status-block]')].map((block) => block.getAttribute("data-status-block"))`;
/** The design's order of the blocks while an appeal can still be filed: Appeal first (section 8.7). */
const OPEN_ORDER = ["appeal", "rule", "does", "appliesTo", "whoSees", "decidedBy", "when", "statement"];

/**
 * The placeholder's sentence (HiddenImage.tsx's HIDDEN_IMAGE, word for word): that component file draws, so the walk,
 * which runs in Node without react-native, holds its own copy, which hidden-media.test.tsx pins to the same words.
 */
const HIDDEN_IMAGE_WORDS = "Image hidden by korbat moderation";

/** Opens the details sheet of Ada's removed post (on /u/ada) and waits until its blocks are drawn. */
async function openStatusSheet(page: Page): Promise<void> {
  await statusChip(page).click();
  await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the status sheet's blocks");
}

/**
 * How much of a greyscale screenshot differs from its own background: the pixels whose luminance is more than 0.08 away
 * from the corner's, counted in the page from the PNG through a canvas (the policy allows data: images).
 */
const INK_SCRIPT = `
(async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  const grey = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  const ground = grey(0);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) if (Math.abs(grey(i) - ground) > 0.08) ink += 1;
  return ink;
})
`;

/** The inked pixels of the left 36 px of a counted icon button: its 28 px glyph box after the 8 px padding. */
async function glyphInk(page: Page, button: ReturnType<Page["locator"]>): Promise<number> {
  const box = (await button.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: 36, height: box.height } });
  return (await page.evaluate(`${INK_SCRIPT}(${JSON.stringify(`data:image/png;base64,${shot.toString("base64")}`)})`)) as number;
}

describe("the app in Chromium, under the app site's policy", () => {
  test("1. the budgets of section 11.3: the bundle, the stylesheet and the latin fonts", () => {
    const baseline = JSON.parse(readFileSync(path.join(import.meta.dirname, "baseline.json"), "utf8")) as { js: { gzipBytes: number } };
    const js = sizes(path.join("_expo", "static", "js", "web"));
    const css = sizes(path.join("_expo", "static", "css"));
    const jsGzip = js.reduce((sum, file) => sum + file.gzip, 0);
    const cssGzip = css.reduce((sum, file) => sum + file.gzip, 0);
    console.log(`budgets: JS ${jsGzip} bytes gzip in ${js.length} file(s), CSS ${cssGzip}`);
    // The baseline (1222b87) is above 400 KB, so the cap is the baseline plus 80 KB.
    expect(jsGzip).toBeLessThanOrEqual(baseline.js.gzipBytes + 80 * 1024);
    expect(baseline.js.gzipBytes + 80 * 1024).toBe(791_297);
    expect(cssGzip).toBeLessThanOrEqual(40 * 1024);
    const fonts: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else if (/-latin-(?!ext)[a-z-]*\.[0-9a-f]+\.woff2$/.test(entry.name)) fonts.push(path.join(dir, entry.name));
      }
    };
    walk(path.join(out, "assets"));
    expect(fonts.length).toBeGreaterThanOrEqual(3);
    const latin = fonts.reduce((sum, file) => sum + readFileSync(file).length, 0);
    console.log(`budgets: latin fonts ${latin} bytes in ${fonts.length} files`);
    expect(latin).toBeLessThanOrEqual(320 * 1024);
  });

  test("2. the page, theme-boot.js, a font and the bundle come with the Caddyfile's app headers and caching; a post's page takes the post's status", async () => {
    const headersFor = appSiteHeadersFromCaddyfile();
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    const bundle = /src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(index)?.[1] ?? "";
    expect(bundle).not.toBe("");
    const font = /\/assets\/[^"'`]+?\.woff2/.exec(readFileSync(path.join(out, bundle), "utf8"))?.[0] ?? "";
    expect(font).toMatch(/^\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2$/);
    const expected: Record<string, string> = { "/": "no-cache", "/theme-boot.js": "no-cache", [font]: "public, max-age=31536000, immutable", [bundle]: "public, max-age=31536000, immutable" };
    for (const [pathname, cache] of Object.entries(expected)) {
      const answer = await fetch(`${origin}${pathname}`);
      expect(answer.status, pathname).toBe(200);
      expect(answer.headers.get("cache-control"), pathname).toBe(cache);
      for (const [name, value] of Object.entries(headersFor(pathname, pathname !== "/"))) expect(answer.headers.get(name), `${pathname} ${name}`).toBe(value);
      expect(answer.headers.get("content-security-policy"), pathname).toContain("script-src 'self' https://challenges.cloudflare.com");
      await answer.arrayBuffer();
    }
    expect((await fetch(`${origin}/post/${POST_ID}`)).status).toBe(200);
    expect((await fetch(`${origin}/post/${MISSING_POST_ID}`)).status).toBe(404);
    expect(fixtures.state.problems.splice(0)).toEqual([]);
  });

  test("3. the first paint is already in the stored theme, with the bundle held back", async () => {
    for (const theme of ["light", "dark"] as const) {
      // The system says the other scheme, so the stored choice is what decides.
      const visit_ = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme }, colorScheme: theme === "light" ? "dark" : "light" });
      try {
        site!.state.holdBundle = true;
        const started = Date.now();
        await visit_.page.goto(`${origin}/`, { waitUntil: "commit" });
        await until(visit_.page, `document.documentElement.classList.contains(${JSON.stringify(theme)}) && !!document.body`, `the html element in ${theme}`);
        const first = (await visit_.page.evaluate(`({ background: getComputedStyle(document.documentElement).backgroundColor, drawn: document.getElementById("root") ? document.getElementById("root").childElementCount : -1 })`)) as { background: string; drawn: number };
        // Still within the hold: the bundle has not run, and theme-boot.js has painted the theme's surface.
        expect(Date.now() - started).toBeLessThan(HOLD_MS);
        expect(first.drawn).toBe(0);
        expect(first.background).toBe(rgb(THEMES[theme].surface));
        site!.state.holdBundle = false;
        await until(visit_.page, `document.querySelector("[data-layout]") !== null`, "the app drawn");
        await visit_.page.waitForLoadState("networkidle");
        expect(await visit_.page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)).toBe(rgb(THEMES[theme].surface));
        await clean(visit_);
      } finally {
        site!.state.holdBundle = false;
        await visit_.context.close();
      }
    }
  });

  test("4. the layout at 360 by 740: the tab bar, no context column, no sideways scroll, nothing clipped, every control 44 px", async () => {
    await layoutStep(360, 740, "phone");
  });

  test("5. the layout at 768 by 1024: the rail, no context column", async () => {
    await layoutStep(768, 1024, "tablet");
  });

  test("6. the layout at 1280 by 900: the full nav and the context column", async () => {
    await layoutStep(1280, 900, "wide");
  });

  test("7. the keyboard: the skip link first, then the nav in order with New post last, then the main column, every focus drawn at 2 px or more", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(visit_.page, "/");
      const focused = `(() => { const e = document.activeElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), href: e.getAttribute("href"), role: e.getAttribute("role"), inMain: !!e.closest("main"), isMain: e.tagName === "MAIN", inNav: !!e.closest('nav[aria-label="Main"]'), outline: s.outlineStyle, width: parseFloat(s.outlineWidth), w: r.width, h: r.height }; })()`;
      type Focus = { tag: string; href: string | null; role: string | null; inMain: boolean; isMain: boolean; inNav: boolean; outline: string; width: number; w: number; h: number };
      const stops: Focus[] = [];
      for (let i = 0; i < 7; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      expect(stops.slice(1, 5).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/bookmarks", "/u/ada", "/settings"]);
      // Task 6: the nav ends with New post, a button and no link.
      expect(stops[5]!.inNav).toBe(true);
      expect(stops[5]!.role).toBe("button");
      expect(stops[5]!.href).toBeNull();
      expect(stops[6]!.inMain).toBe(true);
      // Every stop draws korbat's ring, 2 px: the shell's, and the first stop inside Home's column, Home's own tab (Task 5).
      expect(stops[6]!.role).toBe("tab");
      for (const stop of stops.slice(0, 7)) {
        expect(stop.outline, JSON.stringify(stop)).not.toBe("none");
        expect(stop.width, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
      }
      await screenshot(visit_.page, "keyboard-1280-dark-main");
      // The skip link moves the focus into the main column without changing the address.
      await visit(visit_.page, "/");
      await visit_.page.keyboard.press("Tab");
      await visit_.page.keyboard.press("Enter");
      const after = (await visit_.page.evaluate(focused)) as Focus;
      expect(after.isMain || after.inMain).toBe(true);
      expect(after.width).toBeGreaterThanOrEqual(2);
      expect(new URL(visit_.page.url()).hash).toBe("");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, theme] of [
    [8, "light"],
    [9, "dim"],
    [10, "dark"],
  ] as const) {
    test(`${step}. contrast as drawn in ${theme}: the shell on Home and a post, the whole rules, missing, decision, terms, Appearance, Security and sign-in pages, and the open status sheet`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      try {
        for (const [route, scope, signedIn] of [
          ["/", DRAWN, true],
          [`/post/${POST_ID}`, DRAWN, true],
          ["/rules", ALL, true],
          ["/no-such-page", ALL, true],
          // UI Task 7: a decision's screen and the terms, wholly on the tokens.
          [`/settings/cases/${POST_DECISION_ID}`, ALL, true],
          ["/terms", ALL, true],
          // UI Task 8: Appearance, Security and the sign-in screen, which a signed-in account leaves for its feed.
          ["/settings/appearance", ALL, true],
          ["/settings/security", ALL, true],
          ["/signin", ALL, false],
        ] as const) {
          fixtures.state.signedIn = signedIn;
          if (!signedIn) await forgetSession(visit_.page);
          await visit(visit_.page, route);
          expect(await contrast(visit_.page, scope), `${theme} ${route}`).toEqual([]);
          await clean(visit_);
        }
        fixtures.state.signedIn = true;
        // The details sheet of Ada's removed post, open with its blocks (section 12.3's theme steps).
        await visit(visit_.page, "/u/ada");
        await openStatusSheet(visit_.page);
        // Sampled once the sheet's opening fade has ended: the walk reads colours as drawn, opacity included.
        await pause(500);
        expect(await contrast(visit_.page, '[role="dialog"]'), `${theme} the status sheet`).toEqual([]);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("11. at 320 by 640 with Largest text and the root at 200 percent, nothing scrolls sideways and no label is cut", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    try {
      // The screens drawn on the kit: a missing page, Bookmarks under its header, and from Task 5 Home with its tabs and
      // rows; from Task 6 a post with its reply card, and Home's New post sheet open with words in its field; from Task 7
      // a decision's screen, the rules, and the details sheet of Ada's removed post, open.
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
        ["home", "/"],
        ["post", `/post/${POST_ID}`],
        ["composer", "/"],
        ["decision", `/settings/cases/${POST_DECISION_ID}`],
        ["rules", "/rules"],
        ["sheet", "/u/ada"],
        // UI Task 8: Appearance, with its sample at the largest step.
        ["appearance", "/settings/appearance"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
        if (name === "composer") {
          await visit_.page.locator("[data-compose]").click();
          await visit_.page.locator('[role="dialog"] textarea').fill("Morning light over the harbour, written at the largest text.");
          await pause(400);
        }
        if (name === "sheet") {
          await openStatusSheet(visit_.page);
          await pause(400);
        }
        await screenshot(visit_.page, `largest-320-${name}`);
        // What sticks out past the window's right edge, should anything.
        const wide = (await visit_.page.evaluate(
          `[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== "fixed").slice(0, 8).map((e) => e.tagName.toLowerCase() + " " + (e.getAttribute("role") || "") + " " + (e.textContent || "").trim().slice(0, 30) + " " + Math.round(e.getBoundingClientRect().right))`,
        )) as string[];
        const scroll = (await visit_.page.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) as number;
        expect(scroll, `${name}: ${wide.join("; ")}`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, DRAWN), name).toEqual([]);
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  for (const [step, signedIn] of [
    [12, false],
    [13, true],
  ] as const) {
    test(`${step}. every route at 1280 in Dark, ${signedIn ? "signed in" : "signed out"}, with nothing reported`, async () => {
      const visit_ = await open({ width: 1280, height: 900, signedIn, appearance: { theme: "dark" } });
      try {
        for (const route of ROUTES) {
          await visit(visit_.page, route);
          const name = route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
          await screenshot(visit_.page, `route-${signedIn ? "in" : "out"}-${name.slice(0, 60)}`);
          const problems = visit_.watcher.take();
          expect(problems, route).toEqual([]);
          expect(fixtures.state.problems.splice(0), route).toEqual([]);
        }
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("14. before its first content a route asks the API at most three times, and Home's first post is drawn within 2.5 s", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      const firsts: { route: string; shown: string }[] = [
        { route: "/", shown: "Morning light over the harbour" },
        { route: `/post/${POST_ID}`, shown: "Morning light over the harbour" },
        { route: "/u/grace", shown: "Grace Hopper" },
        { route: "/rules", shown: "R1" },
      ];
      for (const { route, shown } of firsts) {
        // From a blank page, so nothing of the previous route is in flight.
        await visit_.page.goto("about:blank");
        const from = fixtures.state.requests.length;
        const started = Date.now();
        await visit_.page.goto(`${origin}${route}`, { waitUntil: "commit" });
        await visit_.page.getByText(shown).first().waitFor({ state: "visible" });
        const took = Date.now() - started;
        // Images are the posts' own and come after them; the count is of the API's answers the content waits for.
        const asked = fixtures.state.requests.slice(from).filter((request) => !request.path.startsWith("/api/media/"));
        console.log(`first content of ${route}: ${took} ms after ${asked.length} requests (${asked.map((request) => request.path).join(", ")})`);
        expect(asked.length, route).toBeLessThanOrEqual(3);
        if (route === "/") expect(took).toBeLessThan(2500);
        await visit_.page.waitForLoadState("networkidle");
        await clean(visit_);
      }
    } finally {
      await visit_.context.close();
    }
  });

  test("15. offline: a polite status at the top of the main column says so, and leaves when the connection is back", async () => {
    const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    try {
      await visit(visit_.page, "/");
      const banner = visit_.page.locator('main [role="status"]', { hasText: UI_WORDS["offline.title"] });
      expect(await banner.count()).toBe(0);
      await visit_.context.setOffline(true);
      await banner.first().waitFor({ state: "visible" });
      expect(await visit_.page.locator('main [role="status"][aria-live="polite"]').first().innerText()).toBe(UI_WORDS["offline.title"]);
      await screenshot(visit_.page, "offline-360-light");
      await visit_.context.setOffline(false);
      await banner.first().waitFor({ state: "detached" });
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("16. on a phone the header slides away as Bookmarks scrolls down and returns on a scroll up; under reduced motion it stays", async () => {
    for (const [name, options] of [
      ["moves", {}],
      ["system-reduced", { reducedMotion: "reduce" as const }],
      ["korbat-reduced", { appearance: { theme: "light", reduceMotion: "always" } }],
    ] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/bookmarks");
        const height = (await visit_.page.evaluate(HEADER_HEIGHT)) as number;
        expect(height, name).toBeGreaterThan(40);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        // The list starts below the floating header: its first row is not under it.
        const firstRow = (await visit_.page.evaluate(`(() => { const list = ${LIST}; const row = list && list.querySelector("[role=article], a[href^='/post/']"); return row ? row.getBoundingClientRect().top : null; })()`)) as number | null;
        expect(firstRow, name).not.toBeNull();
        expect(firstRow!, name).toBeGreaterThanOrEqual(height - 1);
        await scrollList(visit_.page, height * 4);
        await pause(450);
        const down = (await visit_.page.evaluate(HEADER_Y)) as number;
        if (name === "moves") expect(Math.round(down), name).toBe(-Math.round(height));
        else expect(down, name).toBe(0);
        await screenshot(visit_.page, `header-360-${name}-down`);
        await scrollList(visit_.page, height * 3);
        await pause(450);
        expect(await visit_.page.evaluate(HEADER_Y), name).toBe(0);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("17. pressing the current Home item brings the feed back to its newest post without leaving the page, at once under reduced motion", async () => {
    for (const [name, options] of [
      ["smooth", { width: 1280, height: 900 }],
      ["reduced", { width: 360, height: 740, reducedMotion: "reduce" as const }],
    ] as const) {
      const visit_ = await open({ appearance: { theme: "dark" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        await scrollList(visit_.page, 1500);
        await pause(200);
        const scrolled = (await visit_.page.evaluate(`${LIST}.scrollTop`)) as number;
        expect(scrolled, name).toBeGreaterThan(1000);
        await visit_.page.locator('nav[aria-label="Main"] a[aria-current="page"]').click();
        if (name === "reduced") {
          await pause(50);
          expect(await visit_.page.evaluate(`${LIST}.scrollTop`), name).toBe(0);
        } else {
          // Smooth: still on its way a moment after the press, at the top soon after.
          await until(visit_.page, `${LIST}.scrollTop === 0`, "the feed at its top", 3000);
        }
        // The press did not navigate: the tab in the address is the reader's still.
        expect(new URL(visit_.page.url()).search, name).toBe("?tab=latest");
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("18. the lightbox: named, Close, Previous and Next, the arrows, Escape and the focus back on the image; it grows from the image, and at once under reduced motion", async () => {
    // Post 8 holds two images; the first one's cell opens the viewer.
    const cellOf = (page: Page) => page.locator('[role="button"][aria-label^="Open image: A photograph, number 8,"]').first();
    const counter = (page: Page, n: number) => until(page, `!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(`${n} of 2`)})`, `${n} of 2`);
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        const cell = cellOf(visit_.page);
        await cell.scrollIntoViewIfNeeded();
        const frames = sampleFrames(visit_.page, `document.querySelector("[data-lightbox-image]") && document.querySelector("[data-lightbox-image]").parentElement`, "transform", 700);
        await cell.click();
        const dialog = visit_.page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        // Growing from the thumbnail moves the image between frames; under either reduced motion it only fades.
        expect(transformed(await frames), name).toBe(name === "moves");
        const named = (await visit_.page.evaluate(DIALOG_NAME)) as string;
        expect(named, name).toContain("1 of 2");
        expect(named, name).toContain("A photograph, number 8, of the harbour at dawn");
        expect(await dialog.locator('[role="button"]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual([UI_WORDS["media.close"], UI_WORDS["media.previous"], UI_WORDS["media.next"]]);
        // The arrow keys switch at once; Next does too.
        await visit_.page.keyboard.press("ArrowRight");
        await counter(visit_.page, 2);
        await visit_.page.keyboard.press("ArrowLeft");
        await counter(visit_.page, 1);
        await dialog.locator(`[aria-label="${UI_WORDS["media.next"]}"]`).click();
        await counter(visit_.page, 2);
        await dialog.locator(`[aria-label="${UI_WORDS["media.previous"]}"]`).click();
        await counter(visit_.page, 1);
        // Escape closes it, and the image that opened it holds the focus again.
        await visit_.page.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        expect(await visit_.page.evaluate(FOCUSED), name).toMatch(/^Open image: A photograph, number 8,/);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          await visit(visit_.page, "/?tab=latest");
          await cellOf(visit_.page).scrollIntoViewIfNeeded();
          await cellOf(visit_.page).click();
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "visible" });
          await pause(600);
          await screenshot(visit_.page, `lightbox-${width}-${theme}`);
          // The stage is a forced Dark scope: its words read on the near-black in every theme.
          expect(await contrast(visit_.page, '[role="dialog"]'), `${width} ${theme}`).toEqual([]);
          if (width < 768) expect(await phoneProblems(visit_.page, '[role="dialog"]')).toEqual([]);
          await visit_.page.keyboard.press("Escape");
          await visit_.page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  test("19. Like: pressed and counted at once, the answer's counts after; a refusal rolls back with its toast; it pops, and changes at once under reduced motion; a reposted Repost differs from an idle one in greyscale", async () => {
    const LIKE = '[role="button"][aria-label^="Like"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/?tab=latest");
        // Post 1 (Grace's) has 3 likes, none of them the reader's.
        const like = article(visit_.page, 0).locator(LIKE);
        expect(await like.getAttribute("aria-label")).toBe("Like, 3 likes");
        expect(await like.getAttribute("aria-pressed")).toBe("false");
        fixtures.state.delayMs = 1500;
        const frames = sampleFrames(visit_.page, `document.querySelector('[role="article"] ${LIKE}') && document.querySelector('[role="article"] ${LIKE}').parentElement`, "transform", 1200);
        await like.click();
        // Before the answer: pressed, and one more like.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-pressed") === "true"`, "pressed at once", 1000);
        expect(await like.getAttribute("aria-label")).toBe("Like, 4 likes");
        const drawn = await frames;
        expect(transformed(drawn), `${name}: ${[...new Set(drawn)].slice(0, 6).join(" | ")}`).toBe(name === "moves");
        if (name === "moves") await screenshot(visit_.page, "like-1280-light");
        // The answer's counts replace the card's guess: two others liked it meanwhile.
        await until(visit_.page, `document.querySelector('[role="article"] ${LIKE}').getAttribute("aria-label") === "Like, 6 likes"`, "the answer's count");
        expect(await like.getAttribute("aria-pressed")).toBe("true");
        fixtures.state.delayMs = 0;
        // A refusal: post 2 (Linus's, 6 likes) is liked, then put back as it was, and the toast says so.
        fixtures.state.refuse.add("like");
        const other = article(visit_.page, 1).locator(LIKE);
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        await other.click();
        await visit_.page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.failed.like"]).waitFor({ state: "visible" });
        expect(await other.getAttribute("aria-pressed")).toBe("false");
        expect(await other.getAttribute("aria-label")).toBe("Like, 6 likes");
        fixtures.state.refuse.delete("like");
        if (name === "moves") {
          // 4.7: a reposted Repost is told from an idle one by its shape, which a greyscale screenshot keeps.
          const repost = article(visit_.page, 0).locator('[role="button"][aria-label^="Repost"]');
          await repost.click();
          await visit_.page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.repost"] }).click();
          await until(visit_.page, `document.querySelector('[role="article"] [role="button"][aria-label^="Repost"]').getAttribute("aria-pressed") === "true"`, "reposted");
          await visit_.page.locator("[data-menu]").waitFor({ state: "detached" });
          await visit_.page.mouse.move(2, 2);
          await pause(400);
          const reposted = await glyphInk(visit_.page, repost);
          const idle = await glyphInk(visit_.page, article(visit_.page, 1).locator('[role="button"][aria-label^="Repost"]'));
          console.log(`greyscale ink of a reposted Repost ${reposted}, of an idle one ${idle}`);
          expect(reposted).toBeGreaterThan(idle * 1.5);
          await screenshot(visit_.page, "reposted-1280-light");
        }
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("20. Follow on a profile: Following at once, kept after the answer; a refusal rolls back with its toast; the label cross-fades, at once under reduced motion", async () => {
    const BUTTON = '[data-follow] [role="button"]';
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" }, ...options });
      try {
        await visit(visit_.page, "/u/grace");
        const button = visit_.page.locator(BUTTON);
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        // Refused: Following at once, then Follow again, and the toast.
        fixtures.state.delayMs = 800;
        fixtures.state.refuse.add("follow");
        const frames = sampleFrames(visit_.page, `document.querySelector('${BUTTON}') && document.querySelector('${BUTTON}').firstElementChild`, "opacity", 400);
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        expect(faded(await frames), name).toBe(name === "moves");
        await visit_.page.locator("[data-sonner-toaster]").getByText("Couldn't follow @grace. Try again.").waitFor({ state: "visible" });
        expect(await button.innerText()).toBe(UI_WORDS["follow.follow"]);
        if (name === "moves") await screenshot(visit_.page, "follow-refused-360-light");
        fixtures.state.refuse.delete("follow");
        // Answered: Following, and still Following once the answer has landed.
        await button.click();
        await until(visit_.page, `document.querySelector('${BUTTON}').innerText === ${JSON.stringify(UI_WORDS["follow.following"])}`, "Following at once", 700);
        await pause(1200);
        expect(await button.innerText()).toBe(UI_WORDS["follow.following"]);
        expect(await phoneProblems(visit_.page, "[data-follow], [data-sonner-toaster]")).toEqual([]);
        await cleanAfterRefusals(visit_);
      } finally {
        fixtures.state.delayMs = 0;
        fixtures.state.refuse.clear();
        await visit_.context.close();
      }
    }
  });

  test("21. the menus: a popover at 1280 and a sheet at 360; Report on Grace's post, Delete on Ada's with Keep's focus and its return; Repost's menu; the arrows; Escape back to More; Copy link and its toast", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    try {
      await visit_.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await visit(visit_.page, "/?tab=latest");
      const page = visit_.page;
      // Grace's post 1: Who sees this, Copy link, and Report as a link to the form.
      const more = postArticle(page, 1).locator(MORE);
      await more.click();
      const menu = page.locator("[data-menu]");
      await menu.waitFor({ state: "visible" });
      expect(await more.getAttribute("aria-expanded")).toBe("true");
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/report?post=${postIdOf(1)}`);
      // The first item holds the focus; the arrows move it, and wrap.
      await until(page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
      const steps: [string, string][] = [
        ["ArrowDown", UI_WORDS["post.copyLink"]],
        ["ArrowDown", "Report"],
        ["ArrowDown", UI_WORDS["post.whoSees"]],
        ["ArrowUp", "Report"],
        ["Home", UI_WORDS["post.whoSees"]],
        ["End", "Report"],
      ];
      for (const [key, words] of steps) {
        await page.keyboard.press(key);
        expect(((await page.evaluate(FOCUSED)) as string).startsWith(words), key).toBe(true);
      }
      await screenshot(page, "menu-1280-light");
      expect(await contrast(page, "[data-menu]")).toEqual([]);
      // Escape closes it and gives the focus back to More.
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
      expect(await more.getAttribute("aria-expanded")).toBe("false");
      // Copy link: the post's address on the clipboard, and the toast.
      await more.click();
      await menu.getByRole("button", { name: UI_WORDS["post.copyLink"] }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.linkCopied"]).waitFor({ state: "visible" });
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe(`${origin}/post/${postIdOf(1)}`);
      // Ada's own post 3: Delete instead of Report. The question takes More's place, Keep takes the focus and gives it back.
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"], UI_WORDS["post.delete"]]);
      expect(await menu.locator("a").count()).toBe(0);
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await until(page, `${FOCUSED} === "Keep"`, "Keep focused");
      expect(await ada.locator(MORE).count()).toBe(0);
      await screenshot(page, "delete-question-1280-light");
      await page.keyboard.press("Enter");
      await question.waitFor({ state: "detached" });
      await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.more"])}`, "More focused again");
      // Delete, answered: the card fades out of the list.
      await ada.locator(MORE).click();
      await menu.getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await ada.locator('[role="dialog"]').getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      await postArticle(page, 3).waitFor({ state: "detached" });
      expect(fixtures.state.requests.some((request) => request.method === "DELETE" && request.path === `/api/posts/${postIdOf(3)}`)).toBe(true);
      // Repost's menu on Linus's post 2: Repost, and Quote as a link to the quote composer; Escape back to its trigger.
      const repost = postArticle(page, 2).locator('[role="button"][aria-label^="Repost"]');
      await repost.click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([UI_WORDS["post.repost"]]);
      expect(await menu.locator("a").getAttribute("href")).toBe(`/post/${postIdOf(2)}?quote=1`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      expect(await page.evaluate(FOCUSED)).toMatch(/^Repost/);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    // Below 768 px the same menu is a sheet titled by its trigger's label, with a grab handle.
    for (const theme of ["light", "dark"] as const) {
      const phone = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(phone.page, "/?tab=latest");
        const more = article(phone.page, 0).locator(MORE);
        await more.click();
        const sheet = phone.page.locator('[role="dialog"]');
        await sheet.waitFor({ state: "visible" });
        expect(await phone.page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["post.more"]);
        expect(await sheet.locator("[data-handle]").count()).toBe(1);
        await until(phone.page, `${FOCUSED} !== null && ${FOCUSED}.startsWith(${JSON.stringify(UI_WORDS["post.whoSees"])})`, "the first item focused", 2000);
        await pause(500);
        await screenshot(phone.page, `menu-sheet-360-${theme}`);
        expect(await phoneProblems(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await clippedLabels(phone.page, '[role="dialog"]')).toEqual([]);
        expect(await contrast(phone.page, '[role="dialog"]')).toEqual([]);
        await phone.page.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });
        expect(await phone.page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
        await clean(phone);
      } finally {
        await phone.context.close();
      }
    }
    const dark = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(dark.page, "/?tab=latest");
      await article(dark.page, 0).locator(MORE).click();
      await dark.page.locator("[data-menu]").waitFor({ state: "visible" });
      await pause(300);
      await screenshot(dark.page, "menu-1280-dark");
      expect(await contrast(dark.page, "[data-menu]")).toEqual([]);
      await clean(dark);
    } finally {
      await dark.context.close();
    }
  });

  test("22. Who sees this: public on Grace's post, with how korbat treats reach; on Ada's own post 3 also what a block does, the feeds and its Explore status, asked as the sheet opens", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    for (const [width, height] of [
      [1280, 900],
      [360, 740],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        try {
          const page = visit_.page;
          await visit(page, "/?tab=latest");
          const openWho = async (n: number) => {
            await postArticle(page, n).locator(MORE).click();
            await page.getByRole("button", { name: UI_WORDS["post.whoSees"] }).click();
            await until(page, `${DIALOG_NAME} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "Who sees this open");
          };
          const sheet = page.locator('[role="dialog"]');
          await openWho(1);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.public"]);
          expect(await sheet.innerText()).toContain(UI_WORDS["reach.never"]);
          expect(await sheet.innerText()).not.toContain(UI_WORDS["reach.blocked"]);
          expect(await sheet.locator('a[href="/explore/about"]').innerText()).toBe(UI_WORDS["reach.how"]);
          await until(page, `${FOCUSED} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "the title focused", 2000);
          await pause(400);
          await screenshot(page, `who-sees-other-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          expect(await page.evaluate(FOCUSED)).toBe(UI_WORDS["post.more"]);
          // Ada's own post 3: its Explore status is asked when the sheet opens, and said in the status line's words.
          const asked = fixtures.state.requests.length;
          await openWho(3);
          await sheet.getByText("In Explore", { exact: true }).waitFor({ state: "visible" });
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/posts/${postIdOf(3)}/explore`);
          for (const words of [UI_WORDS["reach.public"], UI_WORDS["reach.blocked"], UI_WORDS["reach.feeds"], UI_WORDS["reach.never"]]) expect(await sheet.innerText()).toContain(words);
          await pause(300);
          await screenshot(page, `who-sees-own-${width}-${theme}`);
          await page.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  // UI Task 5: the feeds that keep the reader's place (UI design, sections 7.5, 8.2, 8.3 and 10).

  /** The post at the top of the main column's list: its open link and how far its top is below the list's top line. */
  const TOP_ARTICLE = `(() => { const list = ${LIST}; if (!list) return null; const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const article = [...list.querySelectorAll('[role="article"]')].find((a) => a.querySelector("[data-open]") && a.getBoundingClientRect().bottom > line + 1); if (!article) return null; return { href: article.querySelector("[data-open]").getAttribute("href"), top: Math.round((article.getBoundingClientRect().top - line) * 10) / 10 }; })()`;
  type Top = { href: string; top: number } | null;
  /** Whether the post at the top is the one at `href`, its top within 2 px of the list's top line. */
  const onTop = (href: string) => `(() => { const top = ${TOP_ARTICLE}; return !!top && top.href === ${JSON.stringify(href)} && Math.abs(top.top) <= 2; })()`;

  /** Scrolls the list until fixture post `href` is at its top line, as a reader would, a screen at a time. */
  async function scrollToPost(page: Page, href: string): Promise<void> {
    for (let tries = 0; tries < 40; tries++) {
      const there = await page.evaluate(
        `(() => { const list = ${LIST}; if (!list) return false; const link = list.querySelector('[role="article"] [data-open][href="${href}"]'); if (!link) { list.scrollTop += 500; return false; } const line = list.getBoundingClientRect().top + (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0); const delta = link.closest('[role="article"]').getBoundingClientRect().top - line; list.scrollTop += delta; return Math.abs(delta) < 1; })()`,
      );
      if (there) return;
      await pause(120);
    }
    throw new Error(`${href} never came to the top`);
  }

  /** Waits until a condition on the walk's side is true. */
  async function waitFor(check: () => boolean, what: string, timeout = 10_000): Promise<void> {
    const end = Date.now() + timeout;
    while (!check()) {
      if (Date.now() > end) throw new Error(`not within ${timeout} ms: ${what}`);
      await pause(50);
    }
  }

  /** How many API requests have begun with `path` so far. */
  const asked = (path: string) => fixtures.state.requests.filter((request) => request.path.startsWith(path)).length;

  /** The keys of every reading place in the page's storage. */
  const PLACES = `Object.keys(localStorage).filter((key) => key.startsWith("korbat.place."))`;

  test("23. new posts: after the poll the pill says how many are above while the post on top stays still; pressing it brings the oldest new post to the top; at zero it says You're all caught up; it slides in, and only fades under reduced motion", async () => {
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      const page = visit_.page;
      try {
        // The page's own clock, so the walk need not wait the poll's 30 seconds: it flows as time does, and jumps on asking.
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(6)}`);
        await pause(400);
        const before = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(before?.href).toBe(`/post/${postIdOf(6)}`);
        // Three posts arrive; the timeline's answer waits a moment, so the pill's entrance is sampled from its first frame.
        fixtures.state.newPosts = 3;
        fixtures.state.timelineDelayMs = 600;
        await page.clock.fastForward(31_000);
        const frames = sampleFrames(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").parentElement`, "transform", 1400);
        const pill = page.locator("[data-pill]");
        await pill.waitFor({ state: "visible" });
        expect(transformed(await frames), name).toBe(name === "moves");
        fixtures.state.timelineDelayMs = 0;
        expect(await pill.innerText()).toBe("3 new posts");
        expect(await pill.getAttribute("aria-label")).toBe("3 new posts above, go to the first one");
        // Nothing the reader reads moved.
        const after = (await page.evaluate(TOP_ARTICLE)) as Top;
        expect(after?.href, name).toBe(before?.href);
        expect(Math.abs(after!.top - before!.top), name).toBeLessThanOrEqual(1);
        if (name === "moves") await screenshot(page, "pill-1280-light");
        // The pill takes the reader to the oldest of the new posts, right above where they were, to read on upwards.
        await pill.click();
        await until(page, onTop(`/post/${newPostIdOf(1)}`), "the oldest new post on top", 5000);
        await until(page, `document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === "2 new posts"`, "two left", 3000);
        // Up to the newest: none left, and the pill says so for two seconds before it leaves.
        await scrollList(page, 0);
        await until(page, `!!document.querySelector("[data-pill]") && document.querySelector("[data-pill]").innerText === ${JSON.stringify(UI_WORDS["feed.caughtUp"])}`, "caught up", 3000);
        if (name === "moves") await screenshot(page, "pill-caught-up-1280-light");
        await pill.waitFor({ state: "detached", timeout: 6000 });
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        fixtures.state.timelineDelayMs = 0;
        await visit_.context.close();
      }
    }
    // The pill at a phone's width, in both themes, under the floating header.
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await page.clock.install();
        await visit(page, "/?tab=latest");
        await scrollToPost(page, `/post/${postIdOf(4)}`);
        fixtures.state.newPosts = 2;
        await page.clock.fastForward(31_000);
        await page.locator("[data-pill]").waitFor({ state: "visible" });
        await pause(400);
        await screenshot(page, `pill-360-${theme}`);
        expect(await contrast(page, "[data-pill]")).toEqual([]);
        expect(await phoneProblems(page, "[data-pill]")).toEqual([]);
        await clean(visit_);
      } finally {
        fixtures.state.newPosts = 0;
        await visit_.context.close();
      }
    }
  });

  test("24. the reading place: Latest opens again at the post the reader stopped at, You were here above it and the new posts counted; at the newest when the reader asks; nothing kept signed out; signing out clears it with the appearance", async () => {
    const visit_ = await open({ width: 1280, height: 900 });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      // The first posts are seen (half in view for half a second), then the reader stops at post 12.
      await pause(800);
      await scrollToPost(page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await page.evaluate(PLACES)).toEqual([`korbat.place.${ADA.id}`]);
      // Two posts arrive while the reader is away; the feed opens at post 12 again.
      fixtures.state.newPosts = 2;
      await visit(page, "/?tab=latest");
      await until(page, onTop(`/post/${postIdOf(12)}`), "post 12 on top again");
      // The marker sits above the posts already seen, under the two new ones, which the pill counts.
      const marker = page.locator("[data-marker]");
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.title"]);
      expect(await marker.innerText()).toContain(UI_WORDS["feed.marker.body"]);
      expect(await page.locator("[data-pill]").innerText()).toBe("2 new posts");
      expect(
        await page.evaluate(`(() => { const marker = document.querySelector("[data-marker]"); const post = document.querySelector('[data-open][href="/post/${postIdOf(12)}"]'); return !!(marker.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING); })()`),
      ).toBe(true);
      await screenshot(page, "place-1280-light");
      // "Open feeds at the newest post": the newest, whatever was kept.
      await page.evaluate(`localStorage.setItem("korbat.appearance", JSON.stringify({ openNewest: true }))`);
      await visit(page, "/?tab=latest");
      // At the top of the list, under the composer: the first post is the newest.
      await until(page, `!!${LIST} && ${LIST}.scrollTop === 0 && document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href") === "/post/${newPostIdOf(2)}"`, "the newest post first, at the top");
      // Signing out ends the session: every place and the appearance go.
      await visit(page, "/settings/security");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await until(page, `location.pathname === "/" && !document.querySelector('nav[aria-label="Main"] a[href="/bookmarks"]')`, "signed out, on Home");
      expect(await page.evaluate(PLACES)).toEqual([]);
      expect(await page.evaluate(`localStorage.getItem("korbat.appearance")`)).toBeNull();
      await clean(visit_);
    } finally {
      fixtures.state.newPosts = 0;
      await visit_.context.close();
    }
    // A reader who is signed out keeps no place.
    const out = await open({ width: 1280, height: 900, signedIn: false });
    try {
      await visit(out.page, "/?tab=latest");
      await pause(800);
      await scrollToPost(out.page, `/post/${postIdOf(12)}`);
      await pause(1600);
      expect(await out.page.evaluate(PLACES)).toEqual([]);
      expect(await out.page.locator("[data-marker], [data-pill]").count()).toBe(0);
      await clean(out);
    } finally {
      await out.context.close();
    }
  });

  test("25. Following, Latest and Following again: the same post on top and page one not asked again; Explore is read again each time it is chosen", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      await scrollToPost(page, `/post/${postIdOf(9)}`);
      await pause(300);
      const before = (await page.evaluate(TOP_ARTICLE)) as Top;
      const following = asked("/api/timeline/following");
      const tab = (label: string) => page.locator('[role="tablist"] [role="tab"]', { hasText: label });
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && !!document.querySelector('[role="feed"] [role="article"]')`, "Latest shown");
      await tab(UI_WORDS["home.following"]).click();
      await until(page, onTop(before!.href), "the same post on top");
      const after = (await page.evaluate(TOP_ARTICLE)) as Top;
      expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(2);
      expect(asked("/api/timeline/following")).toBe(following);
      // Explore is never kept: each time it is chosen, it is read again.
      const explore = asked("/api/timeline/explore");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 1, "Explore read");
      await tab(UI_WORDS["home.latest"]).click();
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest"`, "Latest again");
      await tab(UI_WORDS["home.explore"]).click();
      await waitFor(() => asked("/api/timeline/explore") === explore + 2, "Explore read again");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("26. the keyboard on Home: Tab reaches the skip link, the nav, Home's tab and the first post's open link in that order; Page Down and Page Up move between posts; the arrows choose the tabs; the list is a feed", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/");
      const feed = page.locator('[role="feed"]');
      expect(await feed.count()).toBe(1);
      expect(await feed.getAttribute("aria-busy")).toBe("false");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-posinset")).toBe("1");
      expect(await feed.locator('[role="article"]').first().getAttribute("aria-setsize")).toBe("-1");
      const first = (await page.evaluate(`document.querySelector('[role="feed"] [role="article"] [data-open]').getAttribute("href")`)) as string;
      const WHERE = `(() => { const e = document.activeElement; return { href: e.getAttribute("href"), role: e.getAttribute("role"), nav: !!e.closest('nav[aria-label="Main"]'), open: e.hasAttribute("data-open"), outline: parseFloat(getComputedStyle(e).outlineWidth) }; })()`;
      type Where = { href: string | null; role: string | null; nav: boolean; open: boolean; outline: number };
      const kinds: string[] = [];
      for (let i = 0; i < 40 && !kinds.includes("post"); i++) {
        await page.keyboard.press("Tab");
        const at = (await page.evaluate(WHERE)) as Where;
        const kind = at.href === "#main" ? "skip" : at.nav ? "nav" : at.role === "tab" ? "tab" : at.open && at.href === first ? "post" : "other";
        kinds.push(kind);
        if (kind === "tab" || kind === "post") expect(at.outline, kind).toBeGreaterThanOrEqual(2);
      }
      expect(kinds.indexOf("skip")).toBe(0);
      expect(kinds.indexOf("nav")).toBe(1);
      expect(kinds.indexOf("tab")).toBeGreaterThan(kinds.lastIndexOf("nav"));
      expect(kinds.indexOf("post")).toBeGreaterThan(kinds.indexOf("tab"));
      // One tab stop for the whole tab list.
      expect(kinds.filter((kind) => kind === "tab")).toHaveLength(1);
      // Page Down and Page Up: from article to article, by their open links.
      const hrefs = (await feed.locator('[role="article"] [data-open]').evaluateAll((links) => links.slice(0, 3).map((link) => link.getAttribute("href")))) as string[];
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await page.keyboard.press("PageDown");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[2]);
      await page.keyboard.press("PageUp");
      expect(((await page.evaluate(WHERE)) as Where).href).toBe(hrefs[1]);
      await screenshot(page, "keyboard-1280-light-post");
      // The tabs' arrows choose at once and move the focus with the choice.
      await page.locator('[role="tab"][aria-selected="true"]').focus();
      await page.keyboard.press("ArrowRight");
      await until(page, `new URL(location.href).searchParams.get("tab") === "latest" && document.activeElement.getAttribute("aria-selected") === "true"`, "Latest chosen by the arrow");
      await page.keyboard.press("ArrowLeft");
      await until(page, `new URL(location.href).searchParams.get("tab") === "following" && document.activeElement.getAttribute("aria-selected") === "true"`, "Following chosen by the arrow");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("27. a deleted post hands the focus to the next post's open link; a reply's thread opens with its post at the top and its chain above it", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      const ada = postArticle(page, 3);
      await ada.locator(MORE).click();
      await page.locator("[data-menu]").getByRole("button", { name: UI_WORDS["post.delete"] }).click();
      const question = ada.locator('[role="dialog"]');
      await question.waitFor({ state: "visible" });
      await question.getByRole("button", { name: UI_WORDS["post.delete"] }).focus();
      await page.keyboard.press("Enter");
      await postArticle(page, 3).waitFor({ state: "detached" });
      await until(page, `!!document.activeElement && document.activeElement.hasAttribute("data-open") && document.activeElement.getAttribute("href") === "/post/${postIdOf(4)}"`, "post 4's open link focused");
      // Ada's post 3 replies to a chain of three: the page opens with it at the top, the chain above, out of view.
      const FOCUSED_ROW = `(() => { const list = ${LIST}; const row = document.querySelector('[data-row="focused"]'); if (!list || !row) return null; return { top: row.getBoundingClientRect().top - list.getBoundingClientRect().top - (parseFloat(getComputedStyle(list.firstElementChild).paddingTop) || 0), scroll: list.scrollTop }; })()`;
      await visit(page, `/post/${postIdOf(3)}`);
      await until(page, `(() => { const at = ${FOCUSED_ROW}; return !!at && Math.abs(at.top) <= 2 && at.scroll > 0; })()`, "the post on top, its chain above");
      expect(await page.locator('[data-thread] [role="article"]').count()).toBe(4);
      expect(await page.title()).toBe(TITLE_WORDS["title.post"]);
      await screenshot(page, "thread-1280-light");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  // UI Task 6: the composer (UI design, sections 6.15, 7.2, 7.3, 8.2, 8.3, 8.6 and 10).

  /** Every drafts key in the page's storage. */
  const DRAFTS = `Object.keys(localStorage).filter((key) => key.startsWith("korbat.drafts."))`;
  /** The reader's kept drafts, by context. */
  const draftsOf = (page: Page) => page.evaluate(`JSON.parse(localStorage.getItem("korbat.drafts.${ADA.id}") || "{}")`) as Promise<Record<string, string>>;
  /** The open dialog's field. */
  const sheetField = (page: Page) => page.locator('[role="dialog"] textarea');
  /** Whether two boxes overlap. */
  const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** The words of the first post of the feed on screen. */
  const FIRST_POST = `(() => { const article = document.querySelector('[role="feed"] [role="article"]'); return article ? article.innerText : ""; })()`;
  /** Home's card's height: the box that grows, around [data-composer-card]. */
  const CARD_HEIGHT = `(() => { const card = document.querySelector("[data-composer-card]"); return card ? card.parentElement.getBoundingClientRect().height : null; })()`;
  /** Whether Home's card is open or closed. */
  const cardIs = (state: "open" | "closed") => `(() => { const card = document.querySelector("[data-composer-card]"); return !!card && card.getAttribute("data-composer-card") === "${state}"; })()`;
  /** What holds the focus is the field named `name`. */
  const fieldFocused = (name: string) => `(${FOCUSED}) === ${JSON.stringify(name)} && document.activeElement.tagName === "TEXTAREA"`;
  /** The card's height on every frame for `ms`, from now. */
  const sampleHeights = (page: Page, ms: number) =>
    page.evaluate(
      `new Promise((resolve) => { const out = []; const start = performance.now(); const tick = () => { out.push(${CARD_HEIGHT}); if (performance.now() - start < ${ms}) requestAnimationFrame(tick); else resolve(out); }; tick(); })`,
    ) as Promise<(number | null)[]>;
  /** The nav's New post, from 768 px. */
  const navNewPost = (page: Page) => page.locator('nav[aria-label="Main"]').getByRole("button", { name: UI_WORDS["composer.newPost"], exact: true });

  /** Opens the New post sheet: the compose button on a phone's Home, the nav's New post on Bookmarks wider up. */
  async function openSheet(page: Page, width: number): Promise<void> {
    if (width < 768) {
      await visit(page, "/");
      await page.locator("[data-compose]").click();
    } else {
      await visit(page, "/bookmarks");
      await navNewPost(page).click();
    }
    await page.locator('[role="dialog"]').waitFor({ state: "visible" });
    await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
  }

  test("28. at 360 the compose button opens the sheet New post with its field focused; the ring and its number; Post closes it at once, its toast and View keep clear of the button, the post is on top, the focus is back on the button and View opens the post; the button shows on a profile and Bookmarks, not on a post", async () => {
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        const button = page.locator("[data-compose]");
        expect(await button.count()).toBe(1);
        await button.click();
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.post"]);
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
        // Near the end the ring turns review-ink and says what is left.
        await sheetField(page).fill("Morning light over the harbour. ".repeat(30).slice(0, 950));
        await dialog.getByText("50", { exact: true }).waitFor({ state: "visible" });
        expect(await page.evaluate(`getComputedStyle(document.querySelector('[role="dialog"] svg[data-ring]')).color`)).toBe(rgb(THEMES[theme]["review-ink"]));
        await pause(400);
        await screenshot(page, `composer-360-${theme}`);
        expect(await contrast(page, '[role="dialog"]')).toEqual([]);
        expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
        expect(await clippedLabels(page, '[role="dialog"]')).toEqual([]);
        // Post: the sheet closes at once and the toast offers View, above the compose button, never over it.
        const words = `A post from the walk in ${theme}.`;
        await sheetField(page).fill(words);
        await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.post"]).waitFor({ state: "visible" });
        await pause(600);
        const view = page.locator("[data-sonner-toaster]").getByRole("button", { name: UI_WORDS["toast.view"], exact: true });
        const compose = (await button.boundingBox())!;
        expect(intersects((await page.locator("[data-sonner-toast]").first().boundingBox())!, compose)).toBe(false);
        expect(intersects((await view.boundingBox())!, compose)).toBe(false);
        await screenshot(page, `toast-360-${theme}`);
        expect(await contrast(page, "[data-sonner-toaster]")).toEqual([]);
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(words)})`, "the post on top of Home");
        await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`, "the focus back on the compose button", 5000);
        await view.click();
        await until(page, `location.pathname === "/post/${writtenIdOf(1)}"`, "View opens the post");
        await page.locator('[data-row="focused"] [role="article"]').getByText(words).waitFor({ state: "visible" });
        await page.waitForLoadState("networkidle");
        // A profile and Bookmarks show the button; a post does not.
        for (const [route, count] of [
          ["/u/grace", 1],
          ["/bookmarks", 1],
          [`/post/${POST_ID}`, 0],
        ] as const) {
          await visit(page, route);
          expect(await page.locator("[data-compose]").count(), route).toBe(count);
        }
        await clean(visit_);
      } finally {
        fixtures.state.written.length = 0;
        await visit_.context.close();
      }
    }
  });

  test("29. an empty sheet closes at once on Escape; with words Escape asks Discard this draft?, Keep writing keeps the words and the focus, Discard closes, and the focus is back on the opener; the draft is kept 500 ms after typing, survives a reload and goes when sent; signing out clears every draft", async () => {
    const visit_ = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      const dialog = page.locator('[role="dialog"]');
      const question = page.locator('[role="alertdialog"]');
      const opener = page.locator("[data-compose]");
      const backOnOpener = `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`;
      await openSheet(page, 360);
      // Empty: Escape closes it at once, with no question.
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect(await question.count()).toBe(0);
      await until(page, backOnOpener, "the focus back on the opener", 5000);
      // With words: kept on the device 500 ms after typing stops; Escape asks, Keep writing keeps them and the focus.
      await opener.click();
      await dialog.waitFor({ state: "visible" });
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Words worth keeping");
      await pause(700);
      expect((await draftsOf(page)).post).toBe("Words worth keeping");
      await page.keyboard.press("Escape");
      await question.waitFor({ state: "visible" });
      expect(await question.innerText()).toContain(UI_WORDS["composer.discard.question"]);
      await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.discard.keep"])}`, "Keep writing focused", 3000);
      await question.getByRole("button", { name: UI_WORDS["composer.discard.keep"], exact: true }).click();
      await question.waitFor({ state: "detached" });
      expect(await sheetField(page).inputValue()).toBe("Words worth keeping");
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the focus back in the field", 3000);
      // Discard closes it, the focus goes back to the opener, and the draft is gone.
      await page.keyboard.press("Escape");
      await question.waitFor({ state: "visible" });
      await question.getByRole("button", { name: UI_WORDS["composer.discard.confirm"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await until(page, backOnOpener, "the focus back on the opener after Discard", 5000);
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      // A draft survives a reload, and is gone once sent.
      await opener.click();
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Kept across a reload");
      await pause(700);
      await openSheet(page, 360);
      expect(await sheetField(page).inputValue()).toBe("Kept across a reload");
      await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      // Signing out clears every draft on the device, another account's too.
      await opener.click();
      await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the field focused", 5000);
      await page.keyboard.type("Left on this device");
      await pause(700);
      await page.evaluate(`localStorage.setItem("korbat.drafts.00000000-0000-4000-8000-0000000000aa", JSON.stringify({ post: "Another account's words" }))`);
      expect(await page.evaluate(DRAFTS)).toHaveLength(2);
      await visit(page, "/settings/security");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await until(page, `location.pathname === "/" && !document.querySelector('nav[aria-label="Main"] a[href="/bookmarks"]')`, "signed out, on Home");
      expect(await page.evaluate(DRAFTS)).toEqual([]);
      await clean(visit_);
    } finally {
      fixtures.state.written.length = 0;
      await visit_.context.close();
    }
    // The question as drawn: in a phone's sheet and in the 640 px dialog, in both themes.
    for (const width of [360, 1280]) {
      for (const theme of ["light", "dark"] as const) {
        const shot = await open({ width, height: width < 768 ? 740 : 900, appearance: { theme } });
        try {
          await openSheet(shot.page, width);
          await shot.page.keyboard.type("A draft to think twice about");
          await shot.page.keyboard.press("Escape");
          const asked = shot.page.locator('[role="alertdialog"]');
          await asked.waitFor({ state: "visible" });
          await pause(400);
          await screenshot(shot.page, `discard-${width}-${theme}`);
          expect(await contrast(shot.page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(shot.page, '[role="dialog"]')).toEqual([]);
          await asked.getByRole("button", { name: UI_WORDS["composer.discard.confirm"], exact: true }).click();
          await shot.page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await clean(shot);
        } finally {
          await shot.context.close();
        }
      }
    }
  });

  test("30. at 1280 Home's card opens in place on a click and grows, at once under reduced motion, and closes back empty when the focus leaves it; the nav's New post focuses it on Home and opens a 640 px dialog on Bookmarks, whose post is then on top of Home", async () => {
    for (const [name, options] of [
      ["moves", {}],
      ["system-reduced", { reducedMotion: "reduce" as const }],
    ] as const) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" }, ...options });
      const page = visit_.page;
      try {
        await visit(page, "/");
        const collapsed = page.getByRole("button", { name: UI_WORDS["composer.collapsed"], exact: true });
        await collapsed.waitFor({ state: "visible" });
        const before = (await page.evaluate(CARD_HEIGHT)) as number;
        const frames = sampleHeights(page, 700);
        await collapsed.click();
        const heights = (await frames).filter((height): height is number => height !== null);
        await until(page, cardIs("open"), "the card open");
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the card's field focused", 3000);
        await pause(300);
        const after = (await page.evaluate(CARD_HEIGHT)) as number;
        expect(after, name).toBeGreaterThan(before + 40);
        // Moving, some frames fall between the two heights; reduced, none does.
        const between = heights.filter((height) => height > before + 2 && height < after - 2);
        if (name === "moves") expect(between.length, heights.join(" ")).toBeGreaterThan(0);
        else expect(between, heights.join(" ")).toEqual([]);
        // Left empty, it closes back to its one line.
        await page.locator('aside[aria-label="About korbat"]').getByText(UI_WORDS["shell.howTitle"], { exact: true }).click();
        await until(page, cardIs("closed"), "the card closed back", 3000);
        await pause(400);
        expect(Math.abs(((await page.evaluate(CARD_HEIGHT)) as number) - before), name).toBeLessThanOrEqual(1);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        // On Home the nav's New post opens and focuses the card, and opens no dialog.
        await navNewPost(page).click();
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the card's field focused", 3000);
        expect(await page.locator('[role="dialog"]').count()).toBe(0);
        await page.keyboard.type(`Written in the card in ${theme}.`);
        await pause(400);
        await screenshot(page, `card-open-1280-${theme}`);
        expect(await contrast(page, "[data-composer-card]")).toEqual([]);
        await page.locator("[data-composer-card]").getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.post"]).waitFor({ state: "visible" });
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(`Written in the card in ${theme}.`)})`, "the card's post on top");
        // On Bookmarks the nav's New post opens the 640 px dialog.
        await visit(page, "/bookmarks");
        await navNewPost(page).click();
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.post"]);
        // Its layout width, which the dialog's opening scale (0.96 to 1) does not change.
        expect(await page.evaluate(`[...document.querySelectorAll('[role="dialog"] *')].some((element) => element.offsetWidth === 640)`)).toBe(true);
        await until(page, fieldFocused(UI_WORDS["composer.field.post"]), "the dialog's field focused", 5000);
        const words = `Sent from Bookmarks in ${theme}.`;
        await sheetField(page).fill(words);
        await pause(400);
        await screenshot(page, `bookmarks-dialog-1280-${theme}`);
        expect(await contrast(page, '[role="dialog"]')).toEqual([]);
        await dialog.getByRole("button", { name: UI_WORDS["composer.action.post"], exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await until(page, `(${FOCUSED}) === ${JSON.stringify(UI_WORDS["composer.newPost"])}`, "the focus back on New post", 5000);
        await visit(page, "/");
        await until(page, `${FIRST_POST}.includes(${JSON.stringify(words)})`, "that post on top of Home");
        await clean(visit_);
      } finally {
        fixtures.state.written.length = 0;
        await visit_.context.close();
      }
    }
  });

  test("31. Reply on a feed card opens the thread with Your reply focused, and a reply is sent with its toast and read again; Repost's Quote opens a sheet whose preview holds no link, and a quote is sent with its toast while the page stays", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      await postArticle(page, 1).getByRole("button", { name: /^Reply/ }).click();
      await until(page, `location.pathname === "/post/${POST_ID}" && new URL(location.href).searchParams.get("reply") === "1"`, "the thread, its reply card asked for");
      await until(page, fieldFocused(UI_WORDS["composer.field.reply"]), "Your reply focused", 5000);
      const read = asked(`/api/posts/${POST_ID}/thread`);
      await page.keyboard.type("A reply from the walk.");
      await page.locator("[data-composer-card]").getByRole("button", { name: UI_WORDS["composer.action.reply"], exact: true }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.reply"]).waitFor({ state: "visible" });
      await waitFor(() => asked(`/api/posts/${POST_ID}/thread`) > read, "the replies read again");
      await page.locator('[role="article"]').filter({ hasText: "A reply from the walk." }).waitFor({ state: "visible" });
      // The card stays open and empty, with the focus in its field.
      await until(page, fieldFocused(UI_WORDS["composer.field.reply"]), "the focus back in the reply card", 3000);
      // Repost's Quote: the quote sheet over the thread, its preview of the post linking nowhere.
      await visit(page, "/?tab=latest");
      await postArticle(page, 1).getByRole("button", { name: /^Repost/ }).click();
      await page.locator("[data-menu]").getByRole("link", { name: UI_WORDS["post.quote"], exact: true }).click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      expect(await page.evaluate(DIALOG_NAME)).toBe(UI_WORDS["composer.title.quote"]);
      await until(page, fieldFocused(UI_WORDS["composer.field.quote"]), "the quote's field focused", 5000);
      expect(await dialog.locator("a").count()).toBe(0);
      expect(await dialog.innerText()).toContain(GRACE.displayName);
      await page.keyboard.type("Worth reading.");
      await pause(400);
      await screenshot(page, "quote-1280-light");
      await dialog.getByRole("button", { name: UI_WORDS["composer.action.quote"], exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["toast.sent.quote"]).waitFor({ state: "visible" });
      // The page stays: the toast's View is the way to the quote.
      expect(new URL(page.url()).pathname).toBe(`/post/${POST_ID}`);
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      fixtures.state.written.length = 0;
      await visit_.context.close();
    }
    // The reply card as drawn, opened by ?reply=1: on a phone and at 1280, in both themes.
    for (const width of [360, 1280]) {
      for (const theme of ["light", "dark"] as const) {
        const shot = await open({ width, height: width < 768 ? 740 : 900, appearance: { theme } });
        try {
          await visit(shot.page, `/post/${POST_ID}?reply=1`);
          await until(shot.page, fieldFocused(UI_WORDS["composer.field.reply"]), "Your reply focused", 5000);
          await shot.page.keyboard.type("A reply in progress.");
          await pause(400);
          await screenshot(shot.page, `reply-card-${width}-${theme}`);
          expect(await contrast(shot.page, "[data-composer-card]")).toEqual([]);
          if (width < 768) expect(await phoneProblems(shot.page, "[data-composer-card]")).toEqual([]);
          expect(await clippedLabels(shot.page, "[data-composer-card]")).toEqual([]);
          await clean(shot);
        } finally {
          await shot.context.close();
        }
      }
    }
  });

  // UI Task 7: the moderation surfaces and the public pages (UI design, sections 8.7 and 8.9; decision 10).

  test("32. the status sheet: the chip is a button that opens a dialog, named by its words; skeletons while the decision is read, then the blocks in the design's order; Decided by in role terms; Read the full decision opens the case; Escape gives the focus back to the chip; a refused read's Try again reads it again", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/ada");
          const chip = statusChip(page);
          // The chip: a button that opens a dialog, named by its own words, with a 44 px target.
          const tag = (await page.evaluate(`(() => { const e = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => x.textContent.trim() === ${JSON.stringify(REMOVED_CHIP)}); return e ? { role: e.getAttribute("role"), popup: e.getAttribute("aria-haspopup"), name: e.textContent.trim(), height: e.offsetHeight } : null; })()`)) as {
            role: string | null;
            popup: string | null;
            name: string;
            height: number;
          };
          expect(tag).toEqual({ role: "button", popup: "dialog", name: REMOVED_CHIP, height: expect.any(Number) });
          expect(tag.height).toBeGreaterThanOrEqual(44);
          // While the decision is on its way: the dialog named by the chip's words, skeletons and one status, no block yet.
          fixtures.state.delayMs = 1500;
          const asked = fixtures.state.requests.length;
          await chip.click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.waitFor({ state: "visible" });
          expect(await page.evaluate(DIALOG_NAME)).toBe(REMOVED_CHIP);
          await dialog.locator('[role="status"]').waitFor({ state: "attached" });
          expect(await page.evaluate(`${STATUS_BLOCKS}.length`)).toBe(0);
          await pause(300);
          await screenshot(page, `status-sheet-loading-${width}-${theme}`);
          // Each opening reads the decision.
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks", 10_000);
          fixtures.state.delayMs = 0;
          expect(await page.evaluate(STATUS_BLOCKS)).toEqual(OPEN_ORDER);
          const decided = dialog.locator('[data-status-block="decidedBy"]');
          expect(await decided.innerText()).toContain(STATUS_SHEET_WORDS["status.byPerson"]);
          expect(await dialog.locator('[data-status-block="appliesTo"]').innerText()).toContain(STATUS_SHEET_WORDS["status.appliesPost"]);
          expect(await dialog.locator('[data-status-block="whoSees"]').innerText()).toContain(UI_WORDS["reach.private"]);
          await pause(300);
          await screenshot(page, `status-sheet-open-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          expect(await clippedLabels(page, '[role="dialog"]')).toEqual([]);
          // Escape closes it, and the focus is back on the chip.
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          await until(page, `(${FOCUSED}) === ${JSON.stringify(REMOVED_CHIP)}`, "the focus back on the chip", 3000);
          // A refused read says so, with Try again, which reads the decision again.
          fixtures.state.refuse.add("decision");
          await chip.click();
          await dialog.getByRole("alert").waitFor({ state: "visible" });
          await pause(300);
          await screenshot(page, `status-sheet-failed-${width}-${theme}`);
          fixtures.state.refuse.delete("decision");
          const again = fixtures.state.requests.length;
          await dialog.getByRole("button", { name: UI_WORDS["error.retry"], exact: true }).click();
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks after Try again");
          expect(fixtures.state.requests.slice(again).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          // Read the full decision: the sheet closes, then the case opens under Settings, Cases.
          await dialog.getByRole("link", { name: STATUS_SHEET_WORDS["status.readAll"], exact: true }).click();
          await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}"`, "the decision's screen");
          await page.locator("h1").filter({ hasText: CASES_WORDS.title }).waitFor({ state: "visible" });
          await page.getByText(DECISION_WORDS.title, { exact: true }).waitFor({ state: "visible" });
          expect(await page.locator('[role="dialog"]').count()).toBe(0);
          await page.waitForLoadState("networkidle");
          if (theme === "light") await screenshot(page, `decision-${width}-${theme}`);
          await cleanAfterRefusals(visit_);
        } finally {
          fixtures.state.delayMs = 0;
          fixtures.state.refuse.clear();
          await visit_.context.close();
        }
      }
    }
  });

  test("33. the sheet's Appeal opens the decision with ?appeal=1 and the appeal's field focused; Cases' tabs are one tab stop, and Right selects Your reports", async () => {
    for (const [width, height, theme] of [
      [1280, 900, "light"],
      [360, 740, "dark"],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/u/ada");
        await openStatusSheet(page);
        const appeal = page.locator('[role="dialog"] [data-status-appeal]');
        expect(await appeal.innerText()).toBe(STATUS_SHEET_WORDS["status.appeal"]);
        // Its layout height: the dialog's opening scale would shrink the drawn box for a moment.
        expect(await page.evaluate(`document.querySelector('[role="dialog"] [data-status-appeal]').offsetHeight`)).toBeGreaterThanOrEqual(44);
        await appeal.click();
        await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}" && new URL(location.href).searchParams.get("appeal") === "1"`, "the decision, its appeal asked for");
        await until(page, fieldFocused(DECISION_WORDS.appealStatement), "the appeal's field focused", 8000);
        await pause(300);
        await screenshot(page, `decision-appeal-${width}-${theme}`);
        await clean(visit_);
        // Cases: two tabs, one tab stop (the selected tab); the arrows choose.
        await visit(page, "/settings/cases");
        const tabs = page.locator('[role="tablist"] [role="tab"]');
        expect(await tabs.count()).toBe(2);
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["0", "-1"]);
        await tabs.first().focus();
        await page.keyboard.press("ArrowRight");
        await until(page, `document.activeElement && document.activeElement.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.textContent.trim() === ${JSON.stringify(CASES_WORDS.tabs.reports)}`, "Your reports chosen and focused", 3000);
        await page.getByText(CASES_WORDS.noReports).waitFor({ state: "visible" });
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["-1", "0"]);
        // The panel is named by the chosen tab.
        expect(await page.evaluate(`(() => { const panel = document.querySelector('[role="tabpanel"]'); const tab = panel && document.getElementById(panel.getAttribute("aria-labelledby")); return tab ? tab.textContent.trim() : null; })()`)).toBe(CASES_WORDS.tabs.reports);
        await page.waitForLoadState("networkidle");
        await screenshot(page, `cases-reports-${width}-${theme}`);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("34. under a grid that holds a hidden image, Why are images hidden? is a 44 px link to the rules and the placeholder no control; the terms stand in PublicFrame's 640 px column with its banner and footer", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/grace");
          const card = page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${HIDDEN_IMAGE_POST_ID}"]`) });
          const link = card.getByRole("link", { name: UI_WORDS["media.whyHidden"], exact: true });
          expect(await link.getAttribute("href")).toBe("/rules");
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          // The placeholder is no control: nothing around its words takes a press or the focus.
          const placeholder = (await page.evaluate(
            `(() => { const words = [...document.querySelectorAll('[role="article"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(HIDDEN_IMAGE_WORDS)}); return words ? { control: !!words.closest('a, button, [role="button"], [role="link"], [tabindex="0"]') } : null; })()`,
          )) as { control: boolean } | null;
          expect(placeholder).toEqual({ control: false });
          await card.scrollIntoViewIfNeeded();
          await pause(300);
          await screenshot(page, `hidden-image-${width}-${theme}`);
          if (width < 768) expect(await phoneProblems(page, '[role="article"]')).toEqual([]);
          await link.click();
          await until(page, `location.pathname === "/rules"`, "the rules page");
          await page.locator("h1").filter({ hasText: RULES_PAGE.title }).waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          await clean(visit_);
          // The terms in the frame: the wordmark's banner, the page's column of 640 px at most, and the footer's links.
          await visit(page, "/terms");
          const frame = (await page.evaluate(
            `(() => { const main = document.querySelector('[role="main"]'); return { banner: !!document.querySelector('[role="banner"]'), footer: !!document.querySelector('[role="contentinfo"]'), shell: !!document.querySelector("[data-layout]"), column: main ? main.offsetWidth : 0, footerAfter: !!main && !!document.querySelector('[role="contentinfo"]') && (main.compareDocumentPosition(document.querySelector('[role="contentinfo"]')) & 4) === 4 }; })()`,
          )) as { banner: boolean; footer: boolean; shell: boolean; column: number; footerAfter: boolean };
          expect(frame).toEqual({ banner: true, footer: true, shell: false, column: width >= 768 ? 640 : width - 32, footerAfter: true });
          await screenshot(page, `terms-${width}-${theme}`);
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  // UI Task 8 appends below: the Settings index, Appearance, the theme's cross-fade, the switch rows and Clear.

  /** A radio group of the Appearance page, by the id of the heading that names it. */
  const radioGroup = (id: string) => `[role="radiogroup"][aria-labelledby="${id}"]`;
  /** The html element's theme class, text step and font, as the stylesheet reads them. */
  const HTML_STATE = `(() => { const html = document.documentElement; return { theme: ["light", "dim", "dark"].find((name) => html.classList.contains(name)) || null, step: html.getAttribute("data-text-step"), font: html.getAttribute("data-font") }; })()`;
  /** The appearance this browser keeps, as lib/appearance.ts writes it. */
  const STORED = `JSON.parse(localStorage.getItem("korbat.appearance") || "null")`;

  test("35. the nav's Settings opens the Settings index, current there and on every page below; its six rows, Appearance first, and no settings row; signed out the nav's Appearance opens Appearance without the row, and /settings goes to sign-in", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    // A client navigation keeps the screen it left mounted, hidden, with a shell of its own: only what is shown counts.
    const currentItem = `[...document.querySelectorAll('nav[aria-label="Main"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`;
    try {
      await visit(page, "/");
      await page.locator('nav[aria-label="Main"] a[href="/settings"]').click();
      await until(page, `location.pathname === "/settings"`, "the Settings index");
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(`document.title`)).toBe(TITLE_WORDS["title.settingsIndex"]);
      expect(await page.locator("h1:visible").innerText()).toBe(UI_WORDS["settings.title"]);
      expect(await page.evaluate(currentItem)).toEqual(["/settings"]);
      expect(await page.evaluate(`[...document.querySelectorAll('[data-screen="settings"] a')].map((link) => link.getAttribute("href"))`)).toEqual([
        "/settings/appearance",
        "/settings/security",
        "/settings/privacy",
        "/settings/profile",
        "/settings/account",
        "/settings/cases",
      ]);
      expect(await page.evaluate(`!!document.querySelector('nav[aria-label="Settings"]')`)).toBe(false);
      await screenshot(page, "settings-index-1280-light");
      // The first row opens Appearance, under Settings still, with the row of settings pages and Appearance current in it.
      await page.locator('[data-screen="settings"] a[href="/settings/appearance"]').click();
      await until(page, `location.pathname === "/settings/appearance"`, "Appearance");
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(currentItem)).toEqual(["/settings"]);
      expect(await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/settings/appearance"]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    const out = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme: "light" } });
    try {
      await visit(out.page, "/");
      expect(await out.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Main"] a')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/", "/signin", "/settings/appearance"]);
      await out.page.locator('nav[aria-label="Main"] a[href="/settings/appearance"]').click();
      await until(out.page, `location.pathname === "/settings/appearance"`, "Appearance signed out");
      await out.page.waitForLoadState("networkidle");
      expect(await out.page.locator("h1:visible").innerText()).toBe(UI_WORDS["appearance.title"]);
      expect(await out.page.evaluate(currentItem)).toEqual(["/settings/appearance"]);
      expect(await out.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"]')].some((nav) => nav.getClientRects().length > 0)`)).toBe(false);
      await screenshot(out.page, "appearance-out-1280-light");
      await visit(out.page, "/settings");
      await until(out.page, `location.pathname === "/signin"`, "sign-in in place of the index");
      await clean(out);
    } finally {
      await out.context.close();
    }
  });

  test("36. Appearance: each radio group is one tab stop on its chosen radio; the arrows choose at once; the html element's class, text step and font and the sample follow; the choice is kept, and the next first paint has it", async () => {
    // Nothing kept to begin with: System, on a light system. (A stored appearance given to open() is written again at
    // every load, which would hide what the page kept from the reload below.)
    const visit_ = await open({ width: 1280, height: 900 });
    const page = visit_.page;
    try {
      await visit(page, "/settings/appearance");
      // One tab stop per group: the chosen radio alone has tabindex 0.
      const stops = (await page.evaluate(
        `[...document.querySelectorAll('[role="radiogroup"]')].map((group) => [...group.querySelectorAll('[role="radio"]')].filter((radio) => radio.getAttribute("tabindex") === "0").map((radio) => radio.getAttribute("aria-checked")))`,
      )) as string[][];
      // Theme, Dark style (shown under System), Text size, Font and Reduce motion.
      expect(stops).toEqual([["true"], ["true"], ["true"], ["true"], ["true"]]);
      // The theme: from System, Down chooses Light, Dim and then Dark at once, the focus moving with the choice.
      await page.locator(`${radioGroup("appearance-theme")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `${STORED} !== null && ${STORED}.theme === "light"`, "Light at once");
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.classList.contains("dim")`, "Dim at once");
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.classList.contains("dark")`, "Dark at once");
      expect(await page.evaluate(`document.activeElement.getAttribute("role") + " " + document.activeElement.getAttribute("aria-checked") + " " + document.activeElement.textContent.trim()`)).toBe(
        `radio true ${UI_WORDS["appearance.dark"]}`,
      );
      // The text size: the sample's body grows from 17 px to 19 px as Larger is chosen, and the html element says so.
      const sampleSize = `parseFloat(getComputedStyle([...document.querySelectorAll("[data-sample] *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(UI_WORDS["appearance.sample"])})).fontSize)`;
      expect(await page.evaluate(sampleSize)).toBe(17);
      await page.locator(`${radioGroup("appearance-text-size")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.getAttribute("data-text-step") === "larger"`, "Larger at once");
      await until(page, `${sampleSize} === 19`, "the sample at Larger");
      // The font: Down chooses System font; the sample's face follows.
      await page.locator(`${radioGroup("appearance-font")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.getAttribute("data-font") === "system"`, "System font at once");
      expect(await page.evaluate(`getComputedStyle([...document.querySelectorAll("[data-sample] *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(UI_WORDS["appearance.sample"])})).fontFamily`)).toMatch(/^system-ui/);
      // Tab leaves a group from its chosen radio for the next group's chosen radio: one stop each.
      await page.keyboard.press("Tab");
      expect(await page.evaluate(`document.activeElement.closest('[role="radiogroup"]').getAttribute("aria-labelledby") + " " + document.activeElement.getAttribute("aria-checked")`)).toBe("appearance-motion true");
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "dark", step: "larger", font: "system" });
      expect(await page.evaluate(STORED)).toMatchObject({ theme: "dark", textStep: "larger", font: "system" });
      await pause(400);
      await screenshot(page, "appearance-chosen-1280-dark");
      await clean(visit_);
      // The next first paint, with the bundle held back: theme-boot.js has painted what the page kept.
      site!.state.holdBundle = true;
      const started = Date.now();
      await page.goto(`${origin}/settings/appearance`, { waitUntil: "commit" });
      await until(page, `document.documentElement.classList.contains("dark") && !!document.body`, "the kept theme on the first paint");
      const first = (await page.evaluate(`({ state: ${HTML_STATE}, background: getComputedStyle(document.documentElement).backgroundColor, drawn: document.getElementById("root") ? document.getElementById("root").childElementCount : -1 })`)) as {
        state: unknown;
        background: string;
        drawn: number;
      };
      expect(Date.now() - started).toBeLessThan(HOLD_MS);
      expect(first).toEqual({ state: { theme: "dark", step: "larger", font: "system" }, background: rgb(THEMES.dark.surface), drawn: 0 });
      site!.state.holdBundle = false;
      await until(page, `document.querySelector("[data-layout]") !== null`, "the app drawn");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      site!.state.holdBundle = false;
      await visit_.context.close();
    }
  });

  test("37. the theme cross-fades: the class is on the html element while a change fades, 200 ms, or 150 ms under either reduced motion, and gone after; nothing fades on load", async () => {
    for (const [run, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, ...options });
      const page = visit_.page;
      try {
        // Every time the class comes or goes, with the body's transition length while it is there.
        await visit_.context.addInitScript({
          // An init script runs before the html element exists, so it watches the document and reads the html element's records.
          content: `(() => { const seen = []; window.__fades = seen; let on = false; new MutationObserver((records) => { if (!records.some((record) => record.target === document.documentElement)) return; const now = document.documentElement.classList.contains(${JSON.stringify(THEME_FADE.className)}); if (now === on) return; on = now; seen.push({ on: now, at: performance.now(), duration: now && document.body ? getComputedStyle(document.body).transitionDuration : null }); }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true }); })();`,
        });
        await visit(page, "/settings/appearance");
        await pause(600);
        expect(await page.evaluate(`window.__fades.length`), `${run}: on load`).toBe(0);
        await page.locator(`${radioGroup("appearance-theme")} [role="radio"]`).filter({ hasText: UI_WORDS["appearance.dark"] }).click();
        await until(page, `document.documentElement.classList.contains("dark")`, `${run}: Dark`);
        await pause(600);
        const fades = (await page.evaluate(`window.__fades`)) as { on: boolean; at: number; duration: string | null }[];
        const length = run === "moves" ? THEME_FADE.duration : THEME_FADE.reduced;
        expect(fades.map((fade) => [fade.on, fade.duration]), run).toEqual([
          [true, `${length / 1000}s`],
          [false, null],
        ]);
        expect(fades[1]!.at - fades[0]!.at, run).toBeGreaterThanOrEqual(length);
        expect(await page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)).toBe(rgb(THEMES.dark.surface));
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("38. the Reading switches: Tab reaches each, the row draws the 2 px ring in the focus colour in Light and Dark, and Space flips it; Hide counts hides like and repost counts on Home and the follower counts on a profile; the web has no Haptics row", async () => {
    const READING = [UI_WORDS["appearance.autoLoad"], UI_WORDS["appearance.openNewest"], UI_WORDS["appearance.hideCounts"]];
    for (const theme of ["light", "dark"] as const) {
      // System, with the system's scheme choosing Light or Dark: a stored appearance given to open() would be written
      // again at every load, over the Hide counts this step turns on before it opens Home and a profile.
      const visit_ = await open({ width: 1280, height: 900, colorScheme: theme });
      const page = visit_.page;
      try {
        await visit(page, "/settings/appearance");
        expect(await page.evaluate(`document.documentElement.classList.contains(${JSON.stringify(theme)})`)).toBe(true);
        expect(await page.evaluate(`[...document.querySelectorAll('input[role="switch"]')].map((input) => input.getAttribute("aria-label"))`)).toEqual(READING);
        // From the switch before it, Tab reaches Hide counts: the switch is the row's one stop, and the row draws the ring.
        await page.locator(`input[role="switch"][aria-label="${READING[1]}"]`).focus();
        await page.keyboard.press("Tab");
        expect(await page.evaluate(`document.activeElement.getAttribute("aria-label")`)).toBe(READING[2]);
        const ring = (await page.evaluate(
          `(() => { for (let node = document.activeElement.parentElement; node; node = node.parentElement) { const s = getComputedStyle(node); if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, height: node.getBoundingClientRect().height }; } return null; })()`,
        )) as { style: string; width: number; color: string; height: number } | null;
        expect(ring, theme).not.toBeNull();
        expect(ring!.width, theme).toBeGreaterThanOrEqual(2);
        expect(ring!.color, theme).toBe(rgb(THEMES[theme].focus));
        expect(ring!.height, theme).toBeGreaterThanOrEqual(52);
        await screenshot(page, `appearance-switch-focus-1280-${theme}`);
        await page.keyboard.press("Space");
        await until(page, `document.activeElement.checked === true`, "Hide counts on");
        expect(await page.evaluate(STORED)).toMatchObject({ hideCounts: true });
        await clean(visit_);
        if (theme === "light") {
          // Home: every Like and Repost is named without its number, and no number shows beside them.
          await visit(page, "/");
          const actions = (await page.evaluate(
            `[...document.querySelectorAll('[role="article"] [aria-label^="Like"], [role="article"] [aria-label^="Repost"]')].map((button) => ({ name: button.getAttribute("aria-label"), text: button.textContent.trim() }))`,
          )) as { name: string; text: string }[];
          expect(actions.length).toBeGreaterThan(0);
          for (const action of actions) {
            expect([UI_WORDS["post.like.none"], UI_WORDS["post.reposts.none"]], action.name).toContain(action.name);
            expect(action.text, action.name).not.toMatch(/[0-9]/);
          }
          await clean(visit_);
          // A profile: Followers and Following are links that read their word alone.
          await visit(page, "/u/grace");
          expect(await page.evaluate(`[...document.querySelectorAll('a[href="/u/grace/followers"], a[href="/u/grace/following"]')].map((link) => link.textContent.trim())`)).toEqual([
            UI_WORDS["profile.followers.hidden"],
            UI_WORDS["profile.following.hidden"],
          ]);
          await clean(visit_);
        }
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("39. Clear what this device keeps: with an appearance, a reading place and a draft kept, it removes the three, keeps the device id and Not now, the theme returns to System, and the toast says Cleared", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark", textStep: "larger" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/appearance");
      // A reading place and a draft as Home and the composer keep them, and the browser's own two.
      await page.evaluate(
        `(() => { localStorage.setItem("korbat.place.${ADA.id}", JSON.stringify({ latest: { newest: { key: "p", time: new Date().toISOString() }, top: { key: "p", time: new Date().toISOString() }, savedAt: Date.now() } })); localStorage.setItem("korbat.drafts.${ADA.id}", JSON.stringify({ post: "Words worth keeping" })); localStorage.setItem("korbat.deviceId", "walk-device"); localStorage.setItem("korbat.passkeySuggestion.dismissedAt", String(Date.now())); })()`,
      );
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "dark", step: "larger", font: "korbat" });
      await page.getByRole("button", { name: UI_WORDS["device.clear"], exact: true }).click();
      await page.getByText(UI_WORDS["toast.cleared"], { exact: true }).waitFor({ state: "visible" });
      expect(((await page.evaluate(`Object.keys(localStorage)`)) as string[]).sort()).toEqual(["korbat.deviceId", "korbat.passkeySuggestion.dismissedAt"]);
      // System on a light system: Light, at the default step, with System chosen on the page.
      await until(page, `document.documentElement.classList.contains("light")`, "System again");
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "light", step: "default", font: "korbat" });
      expect(await page.locator(`${radioGroup("appearance-theme")} [role="radio"][aria-checked="true"]`).innerText()).toBe(UI_WORDS["appearance.system"]);
      await pause(400);
      await screenshot(page, "appearance-cleared-1280");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });
});
```

### Replace `apps/app/test/browser/watch.ts` (whole file)

```ts
import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * Every channel a policy report, an error, a warning or a dialog can reach the app's check by (UI design, section 12.3,
 * after apps/admin/test/browser/watch.ts), watched for the whole walk: the page's own securitypolicyviolation events, from
 * a listener installed before any of the page's scripts runs; Chromium's console, through Playwright and through the CDP
 * Log domain; DevTools issues for the policy; page errors; dialogs, dismissed; failed requests; and any request that
 * would leave the app's origin, aborted, but Turnstile's, which the walk answers itself with a stub. Everything found is
 * a problem, listed with what it said. The one error the app causes on purpose is /api/me's 401 for a reader who is
 * signed out, which Chromium logs as a failed resource.
 */
const POLICY_TEXT = /Content.Security.Policy|Trusted.?Type|require-trusted-types-for|Refused to/i;
const FAILED_RESOURCE = /^Failed to load resource: the server responded with a status of (\d+)/;

/** The origin of Turnstile's script and widget, which the walk serves from a stub (see app.browser.ts). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Whether a console line is /api/me's expected 401: Chromium logs it with the resource's address. */
function expectedHttpError(text: string, url: string | undefined): boolean {
  const status = FAILED_RESOURCE.exec(text)?.[1];
  return status === "401" && url !== undefined && new URL(url, "http://localhost").pathname === "/api/me";
}

/** Runs in every page before its own scripts, outside its policy (Playwright adds it through CDP), and reports through the binding. */
const INIT_SCRIPT = `
(() => {
  const report = (kind, detail) => window.__korbatReport(kind, detail);
  document.addEventListener("securitypolicyviolation", (event) => {
    report("securitypolicyviolation", JSON.stringify({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
      sample: event.sample,
      source: event.sourceFile,
      line: event.lineNumber,
    }));
  }, true);
})();
`;

export interface Watcher {
  cdp: CDPSession;
  /** The problems found since the last call, which it clears. */
  take(): string[];
}

export async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watcher> {
  let problems: string[] = [];
  const found = (text: string) => problems.push(text);

  await context.exposeBinding("__korbatReport", (_source, kind: string, detail: string) => found(`${kind}: ${detail}`));
  await context.addInitScript({ content: INIT_SCRIPT });

  const cdp = await context.newCDPSession(page);
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" || POLICY_TEXT.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
    else if ((entry.level === "error" || entry.level === "warning") && !expectedHttpError(entry.text, entry.url)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text} ${entry.url ?? ""}`);
  });
  await cdp.send("Log.enable");
  cdp.on("Audits.issueAdded", ({ issue }) => {
    if (issue.code === "ContentSecurityPolicyIssue") found(`DevTools CSP issue: ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
  });
  await cdp.send("Audits.enable");

  page.on("console", (message) => {
    const text = message.text();
    if (POLICY_TEXT.test(text)) found(`console ${message.type()}: ${text}`);
    else if ((message.type() === "error" || message.type() === "warning") && !expectedHttpError(text, message.location().url)) found(`console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => found(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    found(`dialog (${dialog.type()}): ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "no reason";
    void request.response().then((response) => {
      // Chromium reports a 204 answer as aborted once it has arrived, since there is no body to read. The answer did arrive.
      if (reason === "net::ERR_ABORTED" && response?.status() === 204) return;
      found(`request failed: ${request.method()} ${request.url()} (${reason})`);
    });
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.fallback();
    if (url.origin === TURNSTILE_ORIGIN) return route.fallback();
    found(`a request to another origin, aborted: ${url.href}`);
    return route.abort();
  });

  return {
    cdp,
    take() {
      const taken = problems;
      problems = [];
      return taken;
    },
  };
}

/**
 * The app's rules at a phone's width (UI design, sections 4.4, 10 and 12.3), which every step at 360 px is held to: no
 * horizontal scroll, every control at least 44 by 44 px, except an `a` laid out inline in running text (a link in a post,
 * a mention, a link in a notice), which needs 24 by 24 px under WCAG 2.5.8, and an element clipped to 1 px by
 * VisuallyHidden, which is passed over until it holds the focus and then measured like any control (the skip link). A
 * control is an a, button, input, select, textarea or summary element, or anything with a control's role, that is shown.
 * A control the pointer cannot press (pointer-events none: a switch inside its row, which the whole row flips, UI Task
 * 8) is measured as the element that takes the pointer for it, since that is the target a finger aims at.
 * Plain text, evaluated in the page, so no test runner's transform can put a helper into it.
 */
const PHONE_SCRIPT = `
((scope) => {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) out.push("a horizontal scroll bar: the page is " + doc.scrollWidth + " px wide in " + doc.clientWidth);
  const shown = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const clipped = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.position === "absolute" && style.overflow === "hidden" && rect.width <= 1 && rect.height <= 1;
  };
  const selector = "a, button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem]";
  for (const element of document.querySelectorAll(selector)) {
    if (!shown(element)) continue;
    if (!element.closest(scope)) continue;
    if (clipped(element) && document.activeElement !== element) continue;
    let box = element.getBoundingClientRect();
    if (getComputedStyle(element).pointerEvents === "none") {
      let target = element.parentElement;
      while (target && getComputedStyle(target).pointerEvents === "none") target = target.parentElement;
      if (target) box = target.getBoundingClientRect();
    }
    if (element.tagName === "INPUT" && (element.type === "radio" || element.type === "checkbox")) {
      const label = element.closest("label") || (element.id ? document.querySelector("label[for='" + element.id + "']") : null);
      if (label) {
        const other = label.getBoundingClientRect();
        box = { width: Math.max(box.right, other.right) - Math.min(box.left, other.left), height: Math.max(box.bottom, other.bottom) - Math.min(box.top, other.top) };
      }
    }
    const inline = element.tagName === "A" && getComputedStyle(element).display === "inline";
    const least = inline ? 24 : 44;
    if (box.width < least - 0.5 || box.height < least - 0.5) {
      const name = (element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").trim().slice(0, 40);
      out.push("a " + (inline ? "link in running text" : "control") + " smaller than " + least + " px: <" + element.tagName.toLowerCase() + "> " + name + " (" + Math.round(box.width) + " by " + Math.round(box.height) + ")");
    }
  }
  return out;
})
`;

/**
 * What the page breaks of the phone's rules, at the viewport it is shown in: the horizontal scroll of the whole page, and
 * the controls inside `scope` (a selector of the parts to measure, the whole body by default).
 */
export function phoneProblems(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate(`${PHONE_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;
}

/**
 * Labels that do not fit their box (UI design, sections 1.5 and 12.3): a control, a tab or a heading whose text is wider
 * or taller than the box shows it, which is where a longer language would break first. Labels wrap or grow; nothing is
 * cut. Plain text, evaluated in the page.
 */
const CLIPPED_SCRIPT = `
((scope) => {
  const out = [];
  const shown = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(element).visibility !== "hidden";
  };
  for (const element of document.querySelectorAll("a, button, [role=button], [role=tab], h1, h2, h3, label")) {
    if (!shown(element)) continue;
    if (!element.closest(scope)) continue;
    // An inline element has no box of its own to fit (clientWidth 0); its block does.
    if (getComputedStyle(element).display === "inline") continue;
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
      out.push("a clipped label: <" + element.tagName.toLowerCase() + "> " + (element.textContent || "").trim().slice(0, 40) + " (" + element.scrollWidth + " by " + element.scrollHeight + " in " + element.clientWidth + " by " + element.clientHeight + ")");
    }
  }
  return out;
})
`;

/** The labels inside `scope` (the whole body by default) whose text does not fit their box. */
export function clippedLabels(page: Page, scope = "body"): Promise<string[]> {
  return page.evaluate(`${CLIPPED_SCRIPT}(${JSON.stringify(scope)})`) as Promise<string[]>;
}
```

### Replace `apps/app/test/cases.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  ACCOUNT_SUSPECT_SCOPE,
  MEASURES,
  OUTCOME_PHRASES,
  SUSPECT_NO_SEAL,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  itemOutcomeWords,
  type AccountStanding,
  type AuthorCaseRow,
  type DecisionView,
  type HiddenMedia,
  type MeResponse,
  type MediaView,
  type NoticeItemStatus,
  type NoticeStatus,
  type PostView,
  type ReportsPage,
} from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS, getRule, statementParagraphs } from "@korbat/rules";
import NoticePage from "../src/app/notice/[ref]";
import { HandleSection } from "../src/app/settings/profile";
import { DecisionsList, ReportsList, StandingBlock } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { NoticeNotFound, NoticeStatusView } from "../src/components/moderation/NoticeStatusView";
import { SettingsNav } from "../src/components/SettingsNav";
import { HIDDEN_IMAGE, SEALED_IMAGE } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import { chipText, fragmentToken, itemRedress, utcMinute } from "../src/lib/moderation";
import { CASES_WORDS, CHIP_WORDS, DECISION_WORDS, STATUS_WORDS } from "../src/lib/moderation-words";
import { CASE_ROW_WORDS, STANDING_TEXTS, bannerSentences, isSuspendedRefusal, refusalSentence, standingDay, standingTime } from "../src/lib/standing";
import { RefusedNotice } from "../src/components/moderation/RefusedNotice";

/**
 * The notice status page, the cases screens and the decision screen, the chips and the labels in the web app (3c design,
 * section 9). An outcome's words come from the contracts and a statement's from the rulebook's package, so the tests hold
 * the screens to those functions and pin only the screens' own words. The components are server-rendered with made-up
 * answers in each state; what a static render cannot show (a request, where a token travels) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** The text of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const count = (whole: string, part: string): number => whole.split(part).length - 1;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APP = "http://localhost:8081";
const TIME = "2026-10-04T10:00:00.000Z";

const waiting: NoticeItemStatus = { position: 1, link: `${APP}/post/${id(1)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
const item = (extra: Partial<NoticeItemStatus>): NoticeItemStatus => ({ ...waiting, decidedOn: "2026-10-05", ...extra });
const status = (items: NoticeItemStatus[], contact: NoticeStatus["contact"] = null): NoticeStatus => ({ ref: "N-ABCDEFGH23", receivedAt: TIME, items, contact });
const page = (items: NoticeItemStatus[], contact?: NoticeStatus["contact"]) => html(<NoticeStatusView status={status(items, contact)} />);
const UNTIL = "2027-04-05T07:00:00.000Z";

describe("the words", () => {
  test("the status page's own sentences are the design's", () => {
    expect(STATUS_WORDS.added(2, `${APP}/post/${id(9)}`)).toBe(`The post that item 2 quotes (${APP}/post/${id(9)}), added by korbat`);
    expect(STATUS_WORDS.reexaminationLabel).toBe("Re-examination");
    expect(STATUS_WORDS.reexaminationOpen("2027-04-05")).toBe("A moderator decides it again as a new report. You can ask once for each item, within six months of being told, until 2027-04-05.");
    expect(STATUS_WORDS.final).toBe("This is final within korbat. You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.courts).toBe("You can go to court, or complain to the Digital Services Coordinator of the EU country where you live.");
    expect(STATUS_WORDS.confirm).toBe("Yes, I sent this: keep me informed");
    expect(STATUS_WORDS.stop).toBe("I did not send this: stop korbat's report emails to this address");
    expect(STATUS_WORDS.stopHint).toBe(
      "This also stops korbat's emails about reports you send yourself from this address, signed in or not, until you undo it on this page or, if a korbat account uses this address, under Settings, Cases, Your reports.",
    );
    expect(STATUS_WORDS.stopped).toBe("korbat's report emails to this address are stopped.");
    expect(STATUS_WORDS.undo).toBe("Undo: email this address about reports again");
  });

  test("the cases screens' and the decision screen's own sentences are the design's", () => {
    expect(CASES_WORDS.tabs).toEqual({ about: "About you", reports: "Your reports" });
    expect(CASES_WORDS.mailStopped).toBe("korbat does not email you about your reports, because someone using your email address asked it to stop. Their outcomes are listed here.");
    expect(CASES_WORDS.resume).toBe("Email me about my reports again");
    expect(CASES_WORDS.resumeHint).toBe("korbat may then also email this address about reports sent without an account that give it.");
    expect(DECISION_WORDS.post("2026-10-04 10:00 UTC")).toBe("Your post of 2026-10-04 10:00 UTC");
    expect(DECISION_WORDS.r4Redacted).toBe("Content erased when the R4 decision became final");
    expect(DECISION_WORDS.erased("2026-10-05")).toBe("korbat's copy of the content this decision was made on was erased on 2026-10-05 under its retention rules (Terms, Your data).");
    expect(DECISION_WORDS.postKept).toBe("The post itself stays in your profile while you keep it.");
    expect(DECISION_WORDS.deleted).toBe("You deleted this post. korbat keeps this copy for the case for the periods in its terms.");
    expect(DECISION_WORDS.deletedImages).toBe("Images kept for the case, not shown");
    expect(DECISION_WORDS.resetDecision).toBe("The decision that reset it");
    expect(DECISION_WORDS.appeal).toBe("Appeal");
    expect(DECISION_WORDS.reversed("2026-10-06")).toBe("Reversed in full on 2026-10-06: nothing of this decision is in force, so there is nothing to appeal.");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
  });
});

describe("the notice status page", () => {
  test("shows the reference, when korbat received it, and each item with its link; an undecided item says so and nothing more", () => {
    const out = page([waiting, { ...waiting, position: 2, link: `${APP}/u/ada`, scope: "account" }]);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(STATUS_WORDS.received(utcMinute(TIME)));
    expect(text).toContain(`${APP}/post/${id(1)}`);
    expect(text).toContain(`${APP}/u/ada`);
    expect(count(text, STATUS_WORDS.waiting)).toBe(2);
    for (const words of [STATUS_WORDS.final, STATUS_WORDS.courts, STATUS_WORDS.reexaminationLabel, "This answer concerns"]) expect(text).not.toContain(words);
    // Opened from the link shown on screen: no contact buttons.
    expect(buttons(out)).toEqual([]);
  });

  test("a decided item reads the words the mail reads: the contracts' one composition from the item's own facts", () => {
    const rule = { id: "R3" as const, title: getRule("R3")!.title };
    const items = [
      item({ outcome: "restricted_rule", rule }),
      item({ position: 2, outcome: "restricted_legal", noEffect: true }),
      item({ position: 3, outcome: "no_violation", reexamination: { open: true, until: UNTIL } }),
      item({ position: 4, link: `${APP}/u/ada`, scope: "account", outcome: "not_available" }),
    ];
    const text = textOf(page(items));
    for (const one of items) expect(text).toContain(itemOutcomeWords(one)!);
    expect(text).toContain(`access restricted: it breaks korbat rule R3 (${rule.title}).`);
    expect(text).toContain(STATUS_WORDS.decided("2026-10-05"));
    // A link that named nothing reads no scope sentence, though the answer keeps the item's scope.
    expect(text).not.toContain("This answer concerns the account's display name and bio.");
  });

  test("a report on the anonymous path reads the phrases of that path, each of them, and after an account's outcome that the answer concerns the images on its posts", () => {
    const sealed = textOf(page([item({ suspect: true, sealed: true, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(sealed).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(sealed).not.toContain("it breaks korbat rule");
    const dismissed = textOf(page([item({ suspect: true, outcome: "no_violation" })]));
    expect(dismissed).toContain(SUSPECT_OUTCOME_PHRASES.no_action);
    expect(dismissed).not.toContain(OUTCOME_PHRASES.no_violation);
    const onText = textOf(page([item({ suspect: true, outcome: "restricted_rule", rule: { id: "R5", title: getRule("R5")!.title } })]));
    expect(onText).toContain(SUSPECT_NO_SEAL);
    const account = textOf(page([item({ link: `${APP}/u/ada`, suspect: true, scope: "account_suspect", outcome: "not_evident" })]));
    expect(account).toContain(`${SUSPECT_OUTCOME_PHRASES.no_action} ${ACCOUNT_SUSPECT_SCOPE}`);
    // A rule report about an account that the sealing decision answered too: the sealed phrase, then the same scope.
    const beside = textOf(page([item({ link: `${APP}/u/ada`, sealed: true, scope: "account_suspect", outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } })]));
    expect(beside).toContain(`${SUSPECT_OUTCOME_PHRASES.sealed} ${ACCOUNT_SUSPECT_SCOPE}`);
  });

  test("an answer given while nobody could open the post's images reads UNSEEN_NO_ACTION with the re-examination still open beside it, also when it answers a re-examination, and is never called final", () => {
    const unseen = item({ outcome: "no_violation", unseen: true, reexamination: { open: true, until: UNTIL } });
    for (const one of [unseen, { ...unseen, reexamines: true }]) {
      const text = textOf(page([one]));
      expect(text).toContain(UNSEEN_NO_ACTION);
      expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain(STATUS_WORDS.courts);
      expect(itemRedress(one)).toBe("reexamination");
    }
    // The re-examination's own answer is labelled as one.
    expect(textOf(page([{ ...unseen, reexamines: true }]))).toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("beside an outcome: that it can still be examined again while that is open; that it is final within korbat when it was changed or answers a re-examination; the courts for any other", () => {
    const open = item({ outcome: "not_evident", reexamination: { open: true, until: UNTIL } });
    const asked = item({ outcome: "no_violation", reexamination: { open: false, until: UNTIL } });
    const answer = item({ outcome: "no_violation", reexamines: true });
    const changed = item({ outcome: "reversed", changed: true });
    const restricted = item({ outcome: "restricted_legal" });
    expect([open, asked, answer, changed, restricted, waiting].map(itemRedress)).toEqual(["reexamination", "courts", "final", "final", "courts", "waiting"]);
    // A restriction answered while the images were out of sight is no "no action for now": changed, it is final.
    expect(itemRedress(item({ outcome: "restricted_rule", unseen: true, reexamines: true }))).toBe("final");

    const openText = textOf(page([open]));
    expect(openText).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(openText).not.toContain(STATUS_WORDS.courts);
    for (const one of [asked, restricted]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.courts);
      expect(text).not.toContain(STATUS_WORDS.final);
      expect(text).not.toContain("A moderator decides it again");
    }
    for (const one of [answer, changed]) {
      const text = textOf(page([one]));
      expect(text).toContain(STATUS_WORDS.final);
      expect(count(text, "go to court")).toBe(1);
    }
    expect(textOf(page([answer]))).toContain(STATUS_WORDS.reexaminationLabel);
    expect(textOf(page([changed]))).not.toContain(STATUS_WORDS.reexaminationLabel);
  });

  test("an item korbat added for a quoted post is headed as such, after the item it was added for, with an outcome of its own", () => {
    const origin = item({ position: 2, suspect: true, outcome: "no_violation" });
    const added = item({ position: 12, link: `${APP}/post/${id(9)}`, suspect: true, sealed: true, quotedBy: 2, outcome: "restricted_rule", rule: { id: "R2", title: getRule("R2")!.title } });
    const text = textOf(page([origin, added]));
    const heading = STATUS_WORDS.added(2, `${APP}/post/${id(9)}`);
    expect(text).toContain(heading);
    expect(text.indexOf(heading)).toBeGreaterThan(text.indexOf(STATUS_WORDS.item(2)));
    expect(text).toContain(SUSPECT_OUTCOME_PHRASES.sealed);
    expect(text).not.toContain(STATUS_WORDS.item(12));
  });

  test("opened from a mail's link, the page shows the contact's state with its two buttons and what a stop also stops; opened from the on-screen link, none", () => {
    const fromMail = page([waiting], { given: true, confirmed: false, stopped: false });
    expect(buttons(fromMail)).toEqual([STATUS_WORDS.confirm, STATUS_WORDS.stop]);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.stopHint);
    expect(textOf(fromMail)).toContain(STATUS_WORDS.unconfirmed);
    expect(textOf(page([waiting], { given: true, confirmed: true, stopped: false }))).toContain(STATUS_WORDS.confirmed);
    for (const contact of [{ given: true, confirmed: null, stopped: null }, { given: false, confirmed: null, stopped: null }, null]) {
      const out = page([waiting], contact);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out)).not.toContain(STATUS_WORDS.stopHint);
    }
  });

  test("a stopped address reads that the emails are stopped, with the one button that undoes it", () => {
    const out = page([waiting], { given: true, confirmed: false, stopped: true });
    expect(textOf(out)).toContain(STATUS_WORDS.stopped);
    expect(buttons(out)).toEqual([STATUS_WORDS.undo]);
    expect(textOf(out)).not.toContain(STATUS_WORDS.confirm);
    // The undo is the confirm choice, which lifts the stop; the other two send their own.
    const view = read("components", "moderation", "NoticeStatusView.tsx");
    expect(view).toContain('<Button label={STATUS_WORDS.undo} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.confirm} onPress={() => onContact?.("confirm")}');
    expect(view).toContain('<Button label={STATUS_WORDS.stop} onPress={() => onContact?.("stop")}');
  });

  test("a wrong reference or token is one sentence, whatever was wrong", () => {
    expect(textOf(html(<NoticeNotFound />))).toContain("We could not find a report with this link.");
  });

  test("the token is read from the address's fragment and sent in the body of a POST, never in a query", () => {
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(fragmentToken(`#t=${token}`)).toBe(token);
    for (const hash of ["", "#", `#t=${token}x`, `#t=${token.slice(1)}`, `#x=${token}`, `?t=${token}`, `#t=${token}&u=1`]) expect(fragmentToken(hash), hash).toBeNull();
    const screen = read("app", "notice", "[ref].tsx");
    expect(screen).toContain("fragmentToken(location.hash)");
    expect(screen).toContain("moderation.status(ref, token)");
    expect(screen).toContain("moderation.contact(ref, token, choice)");
    expect(screen).not.toMatch(/useLocalSearchParams<[^>]*\btoken\b/);
    const client = read("lib", "moderation.ts");
    expect(client).toContain('status: (ref: string, token: string) => api("/api/notices/status", { json: { ref, token }, schema: NoticeStatus })');
    expect(client).toContain('contact: (ref: string, token: string, choice: "confirm" | "stop") => api("/api/notices/contact", { json: { ref, token, choice } })');
    // Before the fragment is read, and without one, the page says the link is no report's: it asks the API nothing.
    route.params = { ref: "N-ABCDEFGH23" };
    expect(textOf(html(<NoticePage />))).not.toContain("N-ABCDEFGH23");
    // The page is outside the settings, whose layout would send a signed-out reader to sign in.
    expect(readdirSync(path.join(SRC, "app", "notice"))).toEqual(["[ref].tsx"]);
  });
});

describe("Cases, under Settings", () => {
  test("the settings row has Cases, whose screens live in a folder of their own inside the settings layout", () => {
    const out = html(<SettingsNav current="cases" />);
    expect(hrefs(out)).toEqual(["/settings/appearance", "/settings/security", "/settings/privacy", "/settings/profile", "/settings/account", "/settings/cases"]);
    const current = (out.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/settings/cases"');
    expect(textOf(out)).toContain("Cases");
    // 3d Task 2: a release's notice has its screen in a folder of its own, at /settings/cases/releases/<id>.
    // 3d Task 7: so has a refused upload's notice, at /settings/cases/uploads/<id>.
    expect(readdirSync(path.join(SRC, "app", "settings", "cases")).sort()).toEqual(["[id]", "[id].tsx", "index.tsx", "releases", "uploads"]);
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "releases")).sort()).toEqual(["[id].tsx"]);
    expect(read("app", "settings", "cases", "releases", "[id].tsx")).toContain('<SettingsNav current="cases" />');
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "uploads")).sort()).toEqual(["[id].tsx"]);
    expect(read("app", "settings", "cases", "uploads", "[id].tsx")).toContain('<SettingsNav current="cases" />');
    // 3e Task 4: the reply screen sits beside the decision's screen, at /settings/cases/<id>/reply.
    expect(readdirSync(path.join(SRC, "app", "settings", "cases", "[id]")).sort()).toEqual(["reply.tsx"]);
    for (const file of ["index.tsx", "[id].tsx"]) expect(read("app", "settings", "cases", file), file).toContain('<SettingsNav current="cases" />');
    // Two tabs, and the list each shows.
    const screen = read("app", "settings", "cases", "index.tsx");
    expect(tabsOf(screen)).toContain('role="tablist"');
    expect(screen).toContain("moderation.cases(");
    expect(screen).toContain("moderation.reports(");
    expect(screen).toContain("moderation.resumeReportMail()");
  });

  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(3),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-05",
    post: { id: id(1), createdAt: TIME },
    actions: ["remove"],
    endedInterim: false,
    ruleId: "R3",
    legal: false,
    appealUntil: "2027-04-05T10:00:00.000Z",
    reversedOn: null,
    appeal: null,
    strike: null,
    ...extra,
  });

  test("About you lists each decision with its day, what was done, the post's time, the rule or the law and where its appeal stands, each a link to its screen", () => {
    const rows = [
      row(),
      row({ id: id(4), kind: "interim", actions: ["seal_media", "withhold"], ruleId: null, legal: true, appealUntil: null }),
      row({ id: id(5), post: null, actions: ["reset_bio"], ruleId: "R6", appealUntil: null, reversedOn: "2026-10-06" }),
      row({ id: id(6), outcome: "no_violation", actions: [], endedInterim: true, ruleId: null, appealUntil: null }),
      row({ id: id(7), kind: "correction", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null }),
    ];
    const out = html(<DecisionsList decisions={rows} />);
    const text = textOf(out);
    expect(hrefs(out)).toEqual(rows.map((one) => `/settings/cases/${one.id}`));
    expect(count(text, CASES_WORDS.decidedOn("2026-10-05"))).toBe(5);
    expect(text).toContain(CASES_WORDS.post(utcMinute(TIME)));
    expect(text).toContain(CASES_WORDS.profile);
    // What was done, in the measures' own labels.
    for (const label of ["Remove", "Seal the images this case reaches", "Withhold the post", "Reset bio", "Lift the restriction of the post"]) expect(text, label).toContain(label);
    expect(text).toContain(CASES_WORDS.rule("R3"));
    expect(text).toContain(CASES_WORDS.law);
    expect(text).toContain(CASES_WORDS.whileDeciding);
    expect(text).toContain(CASES_WORDS.ended);
    expect(text).toContain(CASES_WORDS.correction);
    expect(count(text, "You can appeal until")).toBe(1);
    expect(text).toContain(CASES_WORDS.appealOpen(utcMinute("2027-04-05T10:00:00.000Z")));
    expect(text).toContain(CASES_WORDS.reversed("2026-10-06"));
    expect(textOf(html(<DecisionsList decisions={[]} />))).toContain(CASES_WORDS.noDecisions);
  });

  test("the answer to an appeal that kept the decision reads as a kept decision, never as No action; a reversal by what it lifted", () => {
    const kept = row({ id: id(8), kind: "review", outcome: "kept", actions: [], ruleId: null, appealUntil: null });
    const reversed = row({ id: id(9), kind: "review", outcome: "reversed", actions: ["restore"], ruleId: null, appealUntil: null });
    const text = textOf(html(<DecisionsList decisions={[kept, reversed, row()]} />));
    expect(CASES_WORDS.keptDecision).toBe("korbat kept its decision");
    expect(count(text, CASES_WORDS.keptDecision)).toBe(1);
    expect(text).not.toContain(CASES_WORDS.noAction);
    expect(text).toContain(MEASURES.restore.label);
    // A final decision without a measure that ended nothing still reads No action.
    expect(textOf(html(<DecisionsList decisions={[row({ id: id(10), outcome: "no_violation", actions: [], ruleId: null, appealUntil: null })]} />))).toContain(CASES_WORDS.noAction);
  });

  const reports = (extra: Partial<ReportsPage> = {}): ReportsPage => ({
    reports: [
      { ref: "N-ABCDEFGH23", receivedAt: TIME, items: [{ ...item({ link: `${APP}/u/old_handle`, scope: "account", outcome: "no_violation", reexamination: { open: true, until: UNTIL } }), id: id(21), unfounded: false }, { ...waiting, position: 2, id: id(22), unfounded: false }] },
      { ref: "N-BCDEFGH234", receivedAt: TIME, items: [{ ...item({ outcome: "not_evident", unseen: true, reexamination: { open: true, until: UNTIL } }), id: id(23), unfounded: false }] },
    ],
    nextCursor: null,
    reportMailStopped: false,
    ...extra,
  });

  test("Your reports lists each report with its items as the status page words them: the account under the handle the report named, the outcome once released, and whether it can still be examined again", () => {
    const answer = reports();
    const out = html(<ReportsList page={answer} />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(`${APP}/u/old_handle`);
    expect(text).toContain(itemOutcomeWords(answer.reports[0]!.items[0]!)!);
    expect(text).toContain(STATUS_WORDS.reexaminationOpen(utcMinute(UNTIL)));
    expect(text).toContain(STATUS_WORDS.waiting);
    expect(text).toContain(UNSEEN_NO_ACTION);
    expect(text).not.toContain(STATUS_WORDS.final);
    // Without a stop there is no notice and no button.
    expect(text).not.toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([]);
    expect(textOf(html(<ReportsList page={reports({ reports: [] })} />))).toContain(CASES_WORDS.noReports);
  });

  test("when the account's address stopped korbat's report mails, the tab says so above the list, with the button that resumes them and what that also allows", () => {
    const out = html(<ReportsList page={reports({ reportMailStopped: true })} />);
    const text = textOf(out);
    expect(text).toContain(CASES_WORDS.mailStopped);
    expect(buttons(out)).toEqual([CASES_WORDS.resume]);
    expect(text).toContain(CASES_WORDS.resumeHint);
    expect(text.indexOf(CASES_WORDS.mailStopped)).toBeLessThan(text.indexOf("N-ABCDEFGH23"));
    expect(read("lib", "moderation.ts")).toContain('resumeReportMail: () => api("/api/moderation/report-mail/resume", { method: "POST" })');
  });
});

describe("a decision's screen", () => {
  const statement = {
    kind: "final" as const,
    outcome: "restricted" as const,
    ground: "incompatible" as const,
    ruleId: "R3" as const,
    rulesVersion: 2,
    redressVersion: 1,
    legalReference: null,
    facts: "The post attacks a group for its religion.",
    reason: "That is an attack on people, not on an idea.",
    source: "report" as const,
    decidedAt: TIME,
    post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
    measures: [{ kind: "remove" as const, mediaId: null, noEffect: null, sealed: null }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
  };
  const image = (n: number) => ({ id: id(n), alt: `picture ${n}`, width: 800, height: 600, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const view = (extra: Partial<DecisionView> = {}): DecisionView => ({
    id: id(3),
    ...statement,
    appealUntil: "2027-04-04T10:00:00.000Z",
    reversedOn: null,
    content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [image(7)], imageCount: 1, imagesHidden: null },
    appeal: null,
    strike: null,
    standing: null,
    ...extra,
  });
  const screen = (extra: Partial<DecisionView> = {}) => html(<DecisionDetail view={view(extra)} />);

  test("3d (design, section 9.1): a statement links the rules page after the rule it names; one on the law alone does not", () => {
    const out = screen();
    const link = out.indexOf('href="/rules"');
    expect(link).toBeGreaterThan(-1);
    expect(textOf(out.slice(link))).toContain(DECISION_WORDS.rulesPage);
    expect(link).toBeGreaterThan(out.indexOf(textOf(statementParagraphs(view())[0]!).slice(0, 20)));
    expect(screen({ ground: "illegal", ruleId: null, legalReference: "the law" } as Partial<DecisionView>)).not.toContain('href="/rules"');
  });

  test("a final restriction: the statement as the mail rendered it, the post's time, the content it was made on, and Appeal with its deadline", () => {
    const out = screen();
    const text = textOf(out);
    for (const paragraph of statementParagraphs(view())) expect(text).toContain(paragraph);
    expect(text).toContain(`"${getRule("R3", 2)!.title}"`);
    expect(text).toContain(STATEMENT_WORDS.automation);
    expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
    expect(text).toContain("the words that were judged");
    // The image comes from the app's own image route, with its description.
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(7)}/small.webp`)]);
    expect(out).toContain('alt="picture 7"');
    expect(text).toContain(DECISION_WORDS.appeal);
    expect(text).toContain(DECISION_WORDS.appealUntil("2027-04-04 10:00 UTC"));
    expect(text).not.toContain("Reversed in full");
  });

  test("a decision taken while korbat decides: the interim redress, and no Appeal", () => {
    const interim = { kind: "interim" as const, measures: [{ kind: "withhold" as const, mediaId: null, noEffect: null, sealed: null }], appealUntil: null };
    const text = textOf(screen(interim));
    expect(text).toContain(REDRESS_TEXTS[1].interim);
    expect(text).toContain(STATEMENT_WORDS.scope.interim);
    // Neither the section nor its sentence: the interim redress never says the word.
    expect(text).not.toContain("Appeal");
    expect(text).not.toContain("You can appeal this decision until");
    expect(text).not.toContain("Reversed in full");
  });

  test("a restriction reversed in full says on which day, in place of Appeal", () => {
    const text = textOf(screen({ appealUntil: null, reversedOn: "2026-10-06" }));
    expect(text).toContain(DECISION_WORDS.reversed("2026-10-06"));
    expect(text).not.toContain("You can appeal this decision until");
  });

  test("a post whose images are sealed keeps its text: each sealed image is drawn as its placeholder, and nothing is loaded for it", () => {
    const sealed = {
      kind: "interim" as const,
      ruleId: "R2" as const,
      measures: [{ kind: "seal_media" as const, mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }],
      appealUntil: null,
      content: { kind: "post" as const, body: "text beside the images", deletedByAuthor: false, images: [], imageCount: 2, imagesHidden: "sealed" as const },
    };
    const out = screen(sealed);
    const text = textOf(out);
    expect(text).toContain("text beside the images");
    expect(count(text, SEALED_IMAGE)).toBe(2);
    expect(loaded(out)).toEqual([]);
    expect(text).toContain(STATEMENT_WORDS.sealPost("2026-09-01 08:30 UTC", 2));
  });

  test("a post its author deleted: korbat's copy of the text under its own heading, and its images kept and not shown", () => {
    const out = screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 2, imagesHidden: "deleted_by_author" } });
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.deleted);
    expect(text.indexOf(DECISION_WORDS.deleted)).toBeLessThan(text.indexOf("deleted since"));
    expect(count(text, DECISION_WORDS.deletedImages)).toBe(1);
    expect(loaded(out)).toEqual([]);
    // A deleted post without images says nothing of images.
    expect(textOf(screen({ content: { kind: "post", body: "deleted since", deletedByAuthor: true, images: [], imageCount: 0, imagesHidden: "deleted_by_author" } }))).not.toContain(DECISION_WORDS.deletedImages);
  });

  test("content korbat no longer holds: erased under the retention rules on its day, with the profile sentence only for a post its author kept; or erased by the R4 decision", () => {
    const kept = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: true } }));
    expect(kept).toContain(`${DECISION_WORDS.erased("2027-04-06")} ${DECISION_WORDS.postKept}`);
    const gone = textOf(screen({ content: { kind: "erased", contentErasedOn: "2027-04-06", postKept: false } }));
    expect(gone).toContain(DECISION_WORDS.erased("2027-04-06"));
    expect(gone).not.toContain(DECISION_WORDS.postKept);
    const redacted = textOf(screen({ ruleId: "R4", content: { kind: "r4_redacted" } }));
    expect(redacted).toContain(DECISION_WORDS.r4Redacted);
    expect(redacted).not.toContain("was erased on");
    // The post's time stays on the screen whatever became of the content.
    for (const text of [kept, gone, redacted]) expect(text).toContain(DECISION_WORDS.post("2026-09-01 08:30 UTC"));
  });

  test("a decision about the account shows the fields as korbat copied them, and links the decision that reset a field while its value is still kept", () => {
    const reset = {
      post: null,
      ruleId: "R6" as const,
      measures: [{ kind: "reset_bio" as const, mediaId: null, noEffect: null, sealed: null }],
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const text = textOf(screen(reset));
    expect(text).toContain(`${DECISION_WORDS.bio} what the bio said`);
    expect(text).toContain(`${DECISION_WORDS.displayName} Ada`);
    expect(text).not.toContain("Your post of");
    // A later decision that lifts the reset: its statement says where the old value can be read, and the screen links there.
    const lifted = {
      kind: "correction" as const,
      outcome: "reversed" as const,
      ground: null,
      ruleId: null,
      facts: null,
      post: null,
      measures: [],
      reversals: [{ kind: "restore_bio" as const, mediaId: null, resetDecisionId: id(3), oldValueKept: true, resetRuleId: "R6" as const }],
      reviewed: { kind: "final" as const, ground: "incompatible" as const, ruleId: "R6" as const, rulesVersion: 2, legalReference: null, decidedAt: TIME },
      appealUntil: null,
      content: { kind: "account" as const, handle: "ada", displayName: "Ada", bio: "what the bio said" },
    };
    const out = screen({ id: id(8), ...lifted });
    expect(textOf(out)).toContain(STATEMENT_WORDS.oldValueKept);
    expect(textOf(out)).toContain(DECISION_WORDS.resetDecision);
    expect(hrefs(out)).toContain(`/settings/cases/${id(3)}`);
    // Once the old value is gone, nothing links there.
    const erased = screen({ id: id(8), ...lifted, reversals: [{ ...lifted.reversals[0]!, oldValueKept: false }] });
    expect(hrefs(erased)).not.toContain(`/settings/cases/${id(3)}`);
  });

  test("the screen asks for the decision by the id in its address and says when there is none for this account", () => {
    const source = read("app", "settings", "cases", "[id].tsx");
    expect(source).toContain("moderation.decision(id)");
    expect(source).toContain("DECISION_WORDS.notFound");
    expect(read("lib", "moderation.ts")).toContain("decision: (id: string) => api(`/api/moderation/decisions/${encodeURIComponent(id)}`, { schema: DecisionView })");
  });
});

describe("the chips and the labels", () => {
  const post = (extra: Partial<PostView> = {}): PostView => ({
    id: id(1),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "ada" } } });
  const image = (n: number, moderation?: MediaView["moderation"]): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp`, ...(moderation ? { moderation } : {}) });

  test("the chip's four texts: under review or removed, under a rule or as illegal content", () => {
    expect(CHIP_WORDS).toEqual({ underReview: "Under review", removed: "Removed", illegal: "illegal content" });
    const decision = { decisionId: id(3), ruleId: "R4" as const, legal: false, interim: true, strikeUntil: null };
    expect(chipText(decision)).toBe("Under review: R4");
    expect(chipText({ ...decision, ruleId: null, legal: true })).toBe("Under review: illegal content");
    expect(chipText({ ...decision, ruleId: "R3", interim: false })).toBe("Removed: R3");
    expect(chipText({ ...decision, ruleId: null, legal: true, interim: false })).toBe("Removed: illegal content");
  });

  test("3e: a removed post's chip names its strike while the strike stands and counts, with the day it stops counting", () => {
    const until = "2027-01-10T09:00:00.000Z";
    const decision = { decisionId: id(3), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: until };
    expect(chipText(decision)).toBe(`Removed: R3, strike until ${standingDay(until)}`);
    expect(chipText({ ...decision, strikeUntil: null })).toBe("Removed: R3");
    session.state = me(id(900));
    const removed = textOf(html(<PostCard post={post({ moderation: decision })} />));
    expect(removed).toContain(STANDING_TEXTS.chip("Removed: R3", until));
  });

  test("the author's own withheld or removed post shows the chip as the button that opens the decision's sheet, which links its statement, amber while korbat decides and red once removed", () => {
    session.state = me(id(900));
    const removed = html(<PostCard post={post({ moderation: { decisionId: id(3), ruleId: "R3", legal: false, interim: false, strikeUntil: null } })} />);
    expect(textOf(removed)).toContain("Removed: R3");
    expect(hrefs(sheetOf(removed, id(3)))).toContain(`/settings/cases/${id(3)}`);
    const held = html(<PostCard post={post({ state: "withheld", moderation: { decisionId: id(4), ruleId: null, legal: true, interim: true, strikeUntil: null } })} />);
    expect(textOf(held)).toContain("Under review: illegal content");
    expect(hrefs(sheetOf(held, id(4)))).toContain(`/settings/cases/${id(4)}`);
    // The colours are class names, which a render without the style compiler does not carry: they are read from the source.
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain('const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";');
    expect(card).toContain("<StatusChip tone={tone} label={words} onPress={decision ? openSheet : undefined} ref={chipRef} />");
    // Without the decision's facts the chip still says the state, and links nowhere.
    const bare = html(<PostCard post={post()} />);
    expect(textOf(bare)).toContain("Removed");
    expect(hrefs(bare).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    // A post whose images are sealed keeps its text and its place, without a chip: the post itself is visible.
    const sealedMedia: HiddenMedia[] = [{ id: id(21), hidden: true, sealed: true }, { id: id(22), hidden: true, sealed: true }];
    const sealed = html(<PostCard post={post({ state: "visible", media: sealedMedia })} />);
    expect(textOf(sealed)).toContain("my own post");
    expect(count(textOf(sealed), SEALED_IMAGE)).toBe(2);
    expect(hrefs(sealed).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
    session.state = { status: "signed-out" };
    // Anyone else reads the placeholder of a hidden image for each of them.
    const others = html(<PostCard post={post({ state: "visible", media: [{ id: id(21), hidden: true }, { id: id(22), hidden: true }] })} />);
    expect(count(textOf(others), HIDDEN_IMAGE)).toBe(2);
    expect(textOf(others)).not.toContain(SEALED_IMAGE);
  });

  test("the author's own withheld image says Under review on itself and a removed one Removed, in the post and in the viewer; anyone else gets one placeholder for both", () => {
    const own = html(<MediaGrid media={[image(1, "withheld"), image(2, "removed"), image(3)]} postId={id(1)} own />);
    const text = textOf(own);
    expect(count(text, "Under review")).toBe(1);
    expect(count(text, "Removed")).toBe(1);
    // The author still sees their own images.
    expect(loaded(own)).toHaveLength(3);
    const noop = () => undefined;
    expect(textOf(html(<MediaViewerContent media={[image(1, "withheld")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Under review");
    expect(textOf(html(<MediaViewerContent media={[image(2, "removed")]} index={0} onIndex={noop} onClose={noop} />))).toContain("Removed");
    expect(textOf(html(<MediaViewerContent media={[image(3)]} index={0} onIndex={noop} onClose={noop} />))).not.toMatch(/Under review|Removed/);
    // For anyone else the API sends the same hidden image for a withheld and a removed one: one placeholder, which does not say which.
    const hidden: HiddenMedia = { id: id(1), hidden: true };
    const others = textOf(html(<MediaGrid media={[hidden, { ...hidden, id: id(2) }]} postId={id(1)} />));
    expect(count(others, HIDDEN_IMAGE)).toBe(2);
    expect(others).not.toMatch(/Under review|Removed/);
  });
});

describe("3e: strikes on Cases and on the decision's screen (design, sections 9.2 and 9.4)", () => {
  const COUNTS = "2027-01-10T09:00:00.000Z";
  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(3),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-12",
    post: { id: id(1), createdAt: TIME },
    actions: ["remove", "strike"],
    endedInterim: false,
    ruleId: "R3",
    legal: false,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: { countsUntil: COUNTS, overruledAt: null },
    ...extra,
  });
  const list = (extra: Partial<AuthorCaseRow>, now = new Date("2026-10-12T10:00:00.000Z")) => textOf(html(<DecisionsList decisions={[row(extra)]} now={now} />));

  test("the numbers of the sentences are STANDING_RULES', and a time names the device's minute and the UTC one", () => {
    expect(STANDING_TEXTS.cases.strikes(2)).toBe("Active strikes: 2 of 3. At 3, a moderator may announce a suspension; you would be told first and could reply.");
    expect(STANDING_TEXTS.cases.none).toBe("You have no active strikes.");
    expect(standingTime("2026-10-16T14:05:00.000Z").endsWith("(14:05 UTC)")).toBe(true);
    expect(standingTime("2026-10-16T14:05:00.000Z").startsWith(standingDay("2026-10-16T14:05:00.000Z"))).toBe(true);
  });

  test("Your standing stands above About you: the active strikes and what that many leads to, or that there are none", () => {
    expect(textOf(html(<StandingBlock activeStrikes={0} />))).toBe(`${STANDING_TEXTS.cases.title} ${STANDING_TEXTS.cases.none}`);
    expect(textOf(html(<StandingBlock activeStrikes={2} />))).toContain(STANDING_TEXTS.cases.strikes(2));
    const screen = read("app", "settings", "cases", "index.tsx");
    expect(screen).toContain("setActiveStrikes(page.activeStrikes)");
    expect(screen.indexOf("<StandingBlock")).toBeLessThan(screen.indexOf("<DecisionsList"));
  });

  test("a row names the strike after the post measure, with where it stands, and an overruling in its own words", () => {
    expect(list({})).toContain(`Remove, ${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.counts(COUNTS)})`);
    expect(list({}, new Date("2027-02-01T00:00:00.000Z"))).toContain(`${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.expired})`);
    expect(list({ strike: { countsUntil: COUNTS, overruledAt: "2026-10-20T08:00:00.000Z" } })).toContain(`${CASE_ROW_WORDS.strike} (${CASE_ROW_WORDS.overruled})`);
    expect(list({ kind: "correction", outcome: "reversed", actions: ["overrule", "restore"], strike: null })).toContain(`${CASE_ROW_WORDS.overrule}, ${MEASURES.restore.label}`);
  });

  test("the decision's screen says where its strike stands now, below the statement", () => {
    const view: DecisionView = {
      id: id(3),
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post attacks a group for its religion.",
      reason: "That is an attack on people, not on an idea.",
      source: "report",
      decidedAt: TIME,
      post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
      measures: [
        { kind: "remove", mediaId: null, noEffect: null, sealed: null },
        { kind: "strike", mediaId: null, noEffect: null, sealed: null, endsAt: COUNTS, activeThen: 1 },
      ],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: "2027-04-04T10:00:00.000Z",
      reversedOn: null,
      content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
      appeal: null,
      strike: { countsUntil: COUNTS, state: "counts", overruledAt: null },
      standing: null,
    };
    const screen = (strike: DecisionView["strike"]) => textOf(html(<DecisionDetail view={{ ...view, strike }} />));
    const counting = screen(view.strike);
    expect(counting).toContain(STANDING_TEXTS.strike.counts(COUNTS));
    expect(counting).toContain("This decision gives your account a strike.");
    expect(counting.indexOf("This decision gives your account a strike.")).toBeLessThan(counting.indexOf(STANDING_TEXTS.strike.counts(COUNTS)));
    expect(screen({ countsUntil: COUNTS, state: "expired", overruledAt: null })).toContain(STANDING_TEXTS.strike.expired(COUNTS));
    expect(screen({ countsUntil: COUNTS, state: "overruled", overruledAt: "2026-10-20T08:00:00.000Z" })).toContain(STANDING_TEXTS.strike.overruled("2026-10-20T08:00:00.000Z"));
    expect(screen(null)).not.toContain("Strike:");
  });
});

describe("3e: a retired handle in the app (design, sections 9.4, 9.5 and 9.8)", () => {
  const PLACEHOLDER = "retired_0a1b2c3d4e5f";
  const me = (handle: string, handleChangedAt: string | null = null): MeResponse => ({
    user: { id: id(1), email: "ada@example.com", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
    profile: { id: id(1), handle, displayName: "Ada", handleChangedAt, verified: false, showInExplore: true },
    standing: null,
  });
  const section = (handle: string, handleChangedAt: string | null = null) => textOf(html(<HandleSection me={me(handle, handleChangedAt)} run={async () => undefined} refresh={async () => undefined} />));

  test("the words are the design's: the retired handle's sentence, the standing sentence, and the refusal", () => {
    expect(STANDING_TEXTS.handle.retired).toBe("korbat retired your handle; the decision is under Settings, Cases. Choose a new one: the 30-day wait does not apply this time.");
    expect(STANDING_TEXTS.handle.standing("ada_l")).toBe("Your handle is @ada_l. You can change it once every 30 days. Handles you used before stay yours, except one that korbat retired.");
    expect(messageFor("handle_retired")).toBe("That handle was retired by korbat. Nobody can use it.");
    // handle_reserved keeps its words; it now also answers a handle that begins with retired_.
    expect(messageFor("handle_reserved")).toBe("That handle is reserved.");
  });

  test("while the profile holds a placeholder, Settings, Profile says that korbat retired the handle and keeps the form open at once", () => {
    const out = section(PLACEHOLDER);
    expect(out).toContain(STANDING_TEXTS.handle.retired);
    expect(out).toContain(STANDING_TEXTS.handle.standing(PLACEHOLDER));
    expect(out).toContain("Change handle");
    expect(out).not.toContain("Your next change is allowed on");
    // Any other handle reads the standing sentence alone.
    const plain = section("ada_l");
    expect(plain).toContain(STANDING_TEXTS.handle.standing("ada_l"));
    expect(plain).not.toContain(STANDING_TEXTS.handle.retired);
    // The sentence is keyed on the placeholder's form, not on a handle that merely starts with the word.
    expect(section("retiredada")).not.toContain(STANDING_TEXTS.handle.retired);
  });

  test("a row of About you names a retirement and its reversal in the words of 9.4", () => {
    expect(CASE_ROW_WORDS.retired).toBe("your handle retired");
    expect(CASE_ROW_WORDS.unretired).toBe("handle given back");
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
      id: id(5),
      kind: "final",
      outcome: "restricted",
      decidedOn: "2026-10-12",
      post: null,
      actions: ["retire_handle"],
      endedInterim: false,
      ruleId: "R4",
      legal: false,
      appealUntil: null,
      reversedOn: null,
      appeal: null,
      strike: null,
      ...extra,
    });
    expect(textOf(html(<DecisionsList decisions={[row({})]} />))).toContain(CASE_ROW_WORDS.retired);
    expect(textOf(html(<DecisionsList decisions={[row({ actions: ["reset_display_name", "retire_handle"] })]} />))).toContain(`${MEASURES.reset_display_name.label}, ${CASE_ROW_WORDS.retired}`);
    expect(textOf(html(<DecisionsList decisions={[row({ kind: "correction", outcome: "reversed", actions: ["unretire_handle"] })]} />))).toContain(CASE_ROW_WORDS.unretired);
  });
});

describe("3e's review: what Cases says of a suspension, a termination and their answers (design, section 9.4)", () => {
  const row = (extra: Partial<AuthorCaseRow> = {}): AuthorCaseRow => ({
    id: id(31),
    kind: "final",
    outcome: "restricted",
    decidedOn: "2026-10-12",
    post: null,
    actions: ["suspend"],
    endedInterim: false,
    ruleId: "R5",
    legal: false,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: null,
    standingMeasure: { kind: "suspend", days: 7, announced: false },
    ...extra,
  });
  const list = (extra: Partial<AuthorCaseRow>) => textOf(html(<DecisionsList decisions={[row(extra)]} />));

  test("the row words are the design's: a suspension with its days and kind, a termination, a lift, a withdrawal, the lift of a termination, and a suspension that rested on a reversed decision", () => {
    expect(CASE_ROW_WORDS.suspendedFor(7, false)).toBe("a suspension of 7 days, at once");
    expect(CASE_ROW_WORDS.suspendedFor(3, true)).toBe("a suspension of 3 days, announced");
    expect(CASE_ROW_WORDS.suspendedFor(1, true)).toBe("a suspension of 1 day, announced");
    expect(CASE_ROW_WORDS.terminated).toBe("a termination");
    expect(CASE_ROW_WORDS.withdrawn).toBe("suspension withdrawn for another measure");
    expect(CASE_ROW_WORDS.standingEnded.suspend).toBe("a suspension that rested on it ended");
    expect(list({})).toContain(CASE_ROW_WORDS.suspendedFor(7, false));
    expect(list({ standingMeasure: { kind: "suspend", days: 3, announced: true } })).toContain(CASE_ROW_WORDS.suspendedFor(3, true));
    expect(list({ actions: ["terminate"], standingMeasure: { kind: "terminate", days: null, announced: false } })).toContain(CASE_ROW_WORDS.terminated);
    expect(list({ actions: ["terminate"], standingMeasure: { kind: "terminate", days: null, announced: false } })).not.toContain("Terminate");
    const lift = { kind: "correction" as const, outcome: "reversed" as const, actions: ["lift_suspension" as const], standingMeasure: undefined };
    expect(list({ ...lift, liftedStanding: { kind: "suspend", replaced: false } })).toContain(CASE_ROW_WORDS.lifted);
    expect(list({ ...lift, liftedStanding: { kind: "suspend", replaced: true } })).toContain(CASE_ROW_WORDS.withdrawn);
    expect(list({ ...lift, liftedStanding: { kind: "terminate", replaced: false } })).toContain(CASE_ROW_WORDS.terminationLifted);
    expect(list({ ...lift, liftedStanding: { kind: "terminate", replaced: false } })).not.toContain(CASE_ROW_WORDS.lifted);
    const broke = { kind: "correction" as const, outcome: "reversed" as const, actions: ["restore" as const], standingMeasure: undefined, post: { id: id(1), createdAt: TIME } };
    expect(list({ ...broke, endedStanding: ["suspend"] })).toContain(`${MEASURES.restore.label}, ${CASE_ROW_WORDS.standingEnded.suspend}`);
    expect(list({ ...broke, endedStanding: ["terminate"] })).toContain(CASE_ROW_WORDS.standingEnded.terminate);
  });

  test("korbat's kept answer to a reply is listed as a kept decision, never as no action", () => {
    // 3e's review (people3): a kept correction holds no ledger row, and kept the suspension.
    const text = list({ kind: "correction", outcome: "kept", actions: [], standingMeasure: undefined });
    expect(text).toContain(CASES_WORDS.keptDecision);
    expect(text).not.toContain(CASES_WORDS.noAction);
  });

  test("Your standing has a line for a measure not started, announced or held, and for a termination, in the banner's words", () => {
    const standing = (more: Partial<NonNullable<AccountStanding["measure"]>>): AccountStanding => ({
      activeStrikes: 3,
      measure: {
        decisionId: id(9),
        kind: "suspend",
        days: 3,
        state: "unfixed",
        earliestStart: "2026-10-15T10:00:00.000Z",
        startsAt: null,
        endsAt: null,
        reply: null,
        replyOpen: true,
        appealUntil: "2027-04-12T10:00:00.000Z",
        appealPending: false,
        ...more,
      },
      reporting: null,
      handleRetired: false,
    });
    for (const s of [
      standing({}),
      standing({ state: "announced", startsAt: "2026-10-16T10:00:00.000Z", endsAt: "2026-10-19T10:00:00.000Z" }),
      standing({ state: "held", reply: { filedAt: "2026-10-13T08:00:00.000Z", onTime: true, answeredAt: null }, replyOpen: false }),
      standing({ kind: "terminate", days: null, state: "running", startsAt: "2026-10-16T10:00:00.000Z" }),
    ]) {
      const text = textOf(html(<StandingBlock activeStrikes={3} standing={s} />));
      for (const sentence of bannerSentences(s)!) expect(text, s.measure!.state).toContain(sentence);
    }
  });

  test("a card's action and a follow refused account_suspended show the refusal's sentence from /me with the link to the decision, as the forms do", () => {
    const running: AccountStanding = {
      activeStrikes: 0,
      measure: { decisionId: id(9), kind: "suspend", days: 7, state: "running", earliestStart: TIME, startsAt: TIME, endsAt: "2026-10-19T10:00:00.000Z", reply: null, replyOpen: true, appealUntil: null, appealPending: false },
      reporting: null,
      handleRetired: false,
    };
    const out = html(<RefusedNotice standing={running} />);
    expect(textOf(out)).toContain(refusalSentence(running));
    expect(textOf(out)).toContain(STANDING_TEXTS.refused.read);
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(textOf(html(<RefusedNotice standing={null} />))).toBe(STANDING_TEXTS.refused.over);
    expect(isSuspendedRefusal(new ApiError(403, "account_suspended", "server wording"))).toBe(true);
    expect(isSuspendedRefusal(new ApiError(403, "reauth_required", "x"))).toBe(false);
    // A static render cannot press a button: the card and the profile's follow read their refusals through these two.
    for (const file of [["components", "social", "PostCard.tsx"], ["app", "u", "[handle]", "index.tsx"]]) {
      const source = read(...file);
      expect(source, file.join("/")).toContain("isSuspendedRefusal(err)");
      expect(source, file.join("/")).toContain("<RefusedNotice");
    }
  });
});

// UI Task 7 appends below, so the lines above keep the numbers other tasks cite.
import { Tabs } from "../src/components/kit/Tabs";
import { StatusSheetBody } from "../src/components/moderation/StatusSheet";

/**
 * Cases' tabs are the kit's Tabs (UI design, section 6.10): the screen names `<Tabs`, which draws the tab list's role
 * that the screen used to write by hand.
 */
function tabsOf(screen: string): string {
  expect(screen).toContain("<Tabs");
  return html(<Tabs label={CASES_WORDS.title} tabs={[{ key: "about", label: CASES_WORDS.tabs.about }, { key: "reports", label: CASES_WORDS.tabs.reports }]} selected="about" onSelect={() => undefined} panelId="cases" />);
}

/** A removed post's decision as GET /api/moderation/decisions/:id answers it, for the sheet the chip opens. */
const sheetDecision: DecisionView = {
  id: id(3),
  kind: "final",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R3",
  rulesVersion: 2,
  redressVersion: 1,
  legalReference: null,
  facts: "The post attacks a group for its religion.",
  reason: "That is an attack on people, not on an idea.",
  source: "report",
  decidedAt: TIME,
  post: { id: id(1), createdAt: "2026-09-01T08:30:00.000Z" },
  measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  appealUntil: "2027-04-04T10:00:00.000Z",
  reversedOn: null,
  content: { kind: "post", body: "my own post", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
};

/**
 * UI Task 7 (section 8.7): the chip on a card is the button that opens StatusSheet (aria-haspopup="dialog"), and the
 * decision's statement is linked from the sheet, drawn here open with the decision `decisionId` names.
 */
function sheetOf(card: string, decisionId: string): string {
  expect(card).toContain('aria-haspopup="dialog"');
  expect(hrefs(card).filter((href) => href.startsWith("/settings/cases"))).toEqual([]);
  const post: PostView = {
    id: id(1),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: "my own post",
    createdAt: TIME,
    state: "removed",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
  };
  return html(<StatusSheetBody load={{ kind: "shown", view: { ...sheetDecision, id: decisionId } }} post={post} me={null} onRetry={() => undefined} />);
}
```

### Replace `apps/app/test/composer.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MeResponse, PostView } from "@korbat/contracts";
import { AppShell } from "../src/components/AppShell";
import { ComposeButton, NewPostButton } from "../src/components/social/ComposeButton";
import { closeStep, COMPOSE_TITLE } from "../src/components/social/ComposeSheet";
import { announceSent, Composer } from "../src/components/social/Composer";
import { ComposerCard } from "../src/components/social/composer/ComposerCard";
import { ComposerField } from "../src/components/social/composer/ComposerField";
import { DiscardDialog } from "../src/components/social/composer/DiscardDialog";
import { ProgressRing } from "../src/components/social/composer/ProgressRing";
import { SendBar } from "../src/components/social/composer/SendBar";
import { QuoteEmbed } from "../src/components/social/PostCard";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * The composer's parts as they render (UI design, sections 6.15 and 8.6, Task 6): the field with its kept names and its
 * count as a description, the ring and its number, the send bar, the discard question asked only when the draft has
 * content, the sent toast with View (through a fake toaster, as shell.test.tsx's), the quote's preview without a live
 * link, the cards that open in place, and New post in the nav and as the phone's compose button.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

const shell = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown, kind: "phone" as string, pathname: "/", push: [] as string[] }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: (href: string) => void shell.push.push(href), replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => ({}),
  usePathname: () => shell.pathname,
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: shell.state, refresh: async () => shell.state }) }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/theme/layout", async (importOriginal) => ({ ...(await importOriginal<object>()), useLayout: () => shell.kind }));

/** The fake toaster: sonner's custom toasts and dismissals are recorded. */
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", async () => {
  const { createElement: element } = await import("react");
  return {
    toast: Object.assign(vi.fn(), { custom: sonner.custom, dismiss: sonner.dismiss }),
    Toaster: () => element("section", { "data-fake-toaster": "" }),
  };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];
/** The opening tag of the element with this aria-label. */
const labelled = (markup: string, label: string): string => new RegExp(`<[a-z]+ [^>]*aria-label="${label.replace(/'/g, "&#x27;").replace(/[?]/g, "[?]")}"[^>]*>`).exec(markup)?.[0] ?? "";

const ADA_ID = "00000000-0000-4000-8000-000000000001";
const ME = { user: { id: ADA_ID, onboarded: true }, profile: { handle: "ada", displayName: "Ada Lovelace" }, standing: null } as unknown as MeResponse;
const signedIn = () => ({ status: "signed-in", me: ME });

const POST: PostView = {
  id: "00000000-0000-4000-8000-000000000102",
  author: { id: "00000000-0000-4000-8000-000000000002", handle: "grace", displayName: "Grace Hopper", verified: true },
  body: "Compilers, ships and the occasional heron.",
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  state: "visible",
  replyTo: null,
  counts: { likes: 3, reposts: 1, replies: 2, quotes: 0 },
  media: [],
  quoteOf: null,
};

afterEach(() => {
  shell.state = { status: "signed-out" };
  shell.kind = "phone";
  shell.pathname = "/";
  shell.push.length = 0;
  sonner.custom.mockReset();
  sonner.dismiss.mockReset();
});

describe("the field (6.15)", () => {
  test("keeps its names and placeholders, and is described by its count", () => {
    const field = (kind: "post" | "reply" | "quote", length = 0) => html(<ComposerField kind={kind} value="" onChangeText={() => undefined} length={length} />);
    const post = field("post", 5);
    const input = labelled(post, "What's on your mind?");
    expect(input).toMatch(/^<textarea\b/);
    expect(input).toContain('placeholder="What&#x27;s on your mind?"');
    const described = /aria-describedby="([^"]+)"/.exec(input)?.[1] ?? "";
    expect(described).not.toBe("");
    expect(new RegExp(`<[a-z]+ [^>]*id="${described}"[^>]*>([^<]*)<`).exec(post)?.[1]).toBe("5 of 1000 characters");
    expect(labelled(field("reply"), "Your reply")).toContain('placeholder="Write your reply"');
    expect(labelled(field("quote"), "Your comment on the quoted post")).toContain('placeholder="Add your comment"');
    // The count is no visible "n/1000" any more.
    expect(textOf(post)).not.toContain("/1000");
  });
});

describe("the ring (6.15)", () => {
  test("20 px, hidden from assistive technology, its number only when 100 or fewer remain, in the tone of the count", () => {
    const low = html(<ProgressRing length={10} />);
    expect(low).toContain('width="20"');
    expect(low).toMatch(/<svg\b[^>]*aria-hidden="true"/);
    expect(low).toContain("text-accent-ink");
    expect(textOf(low)).toBe("");
    const near = html(<ProgressRing length={988} />);
    expect(near).toContain("text-review-ink");
    expect(textOf(near)).toBe("12");
    const over = html(<ProgressRing length={1003} />);
    expect(over).toContain("text-danger-ink");
    expect(textOf(over)).toBe("-3");
  });
});

describe("the send bar (6.15)", () => {
  test("Add image as an icon button, the ring, Cancel only in a sheet, and the Post button busy while it sends", () => {
    const bar = (extra: Partial<Parameters<typeof SendBar>[0]> = {}) => html(<SendBar length={0} label="Post" ready busy={false} onPost={() => undefined} onAddImage={() => undefined} {...extra} />);
    const card = bar();
    expect(labelled(card, "Add image")).toMatch(/role="button"|^<button/);
    expect(textOf(card)).not.toContain(UI_WORDS["composer.cancel"]);
    expect(textOf(card)).toContain(UI_WORDS["composer.exif"]);
    expect(UI_WORDS["composer.exif"]).toBe("korbat removes location and camera details from images.");
    expect(textOf(bar({ onCancel: () => undefined }))).toContain("Cancel");
    const sending = bar({ label: UI_WORDS["composer.posting"], ready: false, busy: true });
    expect(sending).toMatch(/aria-busy="true"[^>]*>|aria-busy="true"/);
    expect(textOf(sending)).toContain(UI_WORDS["composer.posting"]);
    // Without a way to pick images (native until sub-project 5) there is no Add image.
    expect(labelled(bar({ onAddImage: undefined }), "Add image")).toBe("");
  });
});

describe("the discard question (6.15, 8.6)", () => {
  test("asked only when the draft has content: an empty composer closes at once, and Escape while asking keeps writing", () => {
    expect(closeStep(false, false)).toBe("close");
    expect(closeStep(true, false)).toBe("ask");
    expect(closeStep(true, true)).toBe("keep");
  });

  test("its words, Discard in danger and Keep writing, and the warning haptic as it appears", () => {
    const out = html(<DiscardDialog onDiscard={() => undefined} onKeep={() => undefined} />);
    expect(textOf(out)).toBe("Discard this draft? Discard Keep writing");
    expect(out).toMatch(/role="alertdialog"/);
    // Classes are not drawn by a static render: the source says Discard takes the danger face.
    const source = read("components", "social", "composer", "DiscardDialog.tsx");
    expect(source).toContain('label={UI_WORDS["composer.discard.confirm"]} face="danger"');
    expect(source).toContain('haptic("warning")');
  });

  test("the composer shows it in place of its send bar while it asks, and never otherwise", () => {
    shell.state = signedIn();
    const asking = html(<Composer asking onKeep={() => undefined} onDiscard={() => undefined} onCancel={() => undefined} />);
    expect(textOf(asking)).toContain(UI_WORDS["composer.discard.question"]);
    expect(labelled(asking, "Add image")).toBe("");
    const writing = html(<Composer onCancel={() => undefined} />);
    expect(textOf(writing)).not.toContain(UI_WORDS["composer.discard.question"]);
    expect(textOf(writing)).toContain(UI_WORDS["composer.action.post"]);
  });
});

describe("after sending (6.15, 5.4)", () => {
  test("the toast names what was sent and offers View, which opens the post", () => {
    for (const [kind, words] of [
      ["post", "Your post was sent. It is at the top of Home."],
      ["reply", "Your reply was sent"],
      ["quote", "Your quote was sent"],
    ] as const) {
      sonner.custom.mockReset();
      announceSent(kind, POST);
      expect(sonner.custom).toHaveBeenCalledTimes(1);
      const [draw, options] = sonner.custom.mock.calls[0] as [(id: string) => ReactElement<{ onAction?: () => void }>, { duration: number }];
      expect(options.duration).toBe(8000);
      const card = draw("t1");
      expect(textOf(html(card))).toBe(`${words} ${UI_WORDS["toast.view"]}`);
      card.props.onAction?.();
      expect(shell.push.at(-1)).toBe(`/post/${POST.id}`);
      expect(sonner.dismiss).toHaveBeenCalledWith("t1");
    }
    expect(UI_WORDS["toast.sent.post"]).toBe("Your post was sent. It is at the top of Home.");
  });

  test("the success haptic, the draft removed and the post put on top of Home are part of sending", () => {
    const composer = read("components", "social", "Composer.tsx");
    expect(composer).toContain('haptic("success")');
    expect(composer).toContain("keeper.current.sent()");
  });
});

describe("the sheet (8.6)", () => {
  test("keeps its titles, New post, Reply and Quote, is 640 px wide from 768 px and asks before closing through its own onClose", () => {
    expect(COMPOSE_TITLE).toEqual({ post: "New post", reply: "Reply", quote: "Quote" });
    const sheet = read("components", "social", "ComposeSheet.tsx");
    expect(sheet).toContain("width={640}");
    expect(sheet).toContain("<Sheet");
    expect(sheet).not.toContain("<Modal");
    // A running suspension still replaces the fields with the refusal (3e, 9.4).
    expect(sheet).toContain("{refusalSentence(standing)}");
  });

  test("the quote's preview inside it has no live link: the author line and the time are text", () => {
    shell.state = signedIn();
    const preview = html(<QuoteEmbed quote={POST} preview />);
    expect(anchors(preview)).toEqual([]);
    expect(textOf(preview)).toContain("Grace Hopper");
    expect(textOf(preview)).toContain("@grace");
    expect(textOf(preview)).toContain("3h");
    expect(textOf(preview)).toContain(POST.body);
    expect(anchors(html(<Composer quoteOf={POST} />))).toEqual([]);
    // The live quote keeps its two links.
    expect(anchors(html(<QuoteEmbed quote={POST} />))).toHaveLength(2);
  });
});

describe("the cards that open in place (8.2, 8.3; decision 19)", () => {
  test("collapsed, Home's card and the reply card are one control each, named by their words, with no field yet", () => {
    shell.state = signedIn();
    const home = html(<ComposerCard onPosted={() => undefined} />);
    expect(labelled(home, "What's on your mind?")).toMatch(/role="button"/);
    expect(home).not.toContain("<textarea");
    const reply = html(<ComposerCard replyTo={POST} onPosted={() => undefined} />);
    expect(labelled(reply, "Write your reply")).toMatch(/role="button"/);
    expect([UI_WORDS["composer.collapsed"], UI_WORDS["composer.collapsedReply"]]).toEqual(["What's on your mind?", "Write your reply"]);
  });

  test("opened, the card holds the field and the send bar, without Cancel", () => {
    shell.state = signedIn();
    const open = html(<ComposerCard replyTo={POST} startOpen onPosted={() => undefined} />);
    expect(labelled(open, "Your reply")).toMatch(/^<textarea\b/);
    expect(textOf(open)).toContain(UI_WORDS["composer.action.reply"]);
    expect(textOf(open)).not.toContain(UI_WORDS["composer.cancel"]);
  });

  test("Reply on a card opens the thread with its reply card open (?reply=1)", () => {
    expect(read("components", "social", "PostCard.tsx")).toContain("?reply=1");
    expect(read("app", "post", "[id].tsx")).toContain("const { id, quote, reply } = useLocalSearchParams<{ id: string; quote?: string; reply?: string }>();");
  });
});

describe("New post (7.2, 7.3)", () => {
  test("the compose button is a 56 px accent circle named New post; the full nav's is a full-width button", () => {
    const button = html(<ComposeButton onPress={() => undefined} />);
    expect(labelled(button, "New post")).toMatch(/role="button"/);
    const full = html(<NewPostButton onPress={() => undefined} />);
    expect(textOf(full)).toBe("New post");
    expect(full).toContain('role="button"');
    // Classes are not drawn by a static render: the source holds the circle, its ring and the full width.
    const source = read("components", "social", "ComposeButton.tsx");
    expect(source).toContain("h-14 w-14 items-center justify-center rounded-full border-2 border-surface bg-accent");
    expect(source).toContain("web:forced-colors:border web:forced-colors:border-[color:CanvasText]");
    expect(source).toContain('<View className="self-stretch">');
  });

  test("signed in, the rail and the full nav hold New post after the links, a button and no link; signed out there is none", () => {
    for (const kind of ["tablet", "desktop", "wide"]) {
      shell.kind = kind;
      shell.state = signedIn();
      shell.pathname = "/bookmarks";
      const out = html(<AppShell>{null}</AppShell>);
      const nav = /<nav\b[^>]*aria-label="Main"[^>]*>[\s\S]*<\/nav>/.exec(out)?.[0] ?? "";
      expect(anchors(nav).map((tag) => /href="([^"]*)"/.exec(tag)?.[1]), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings"]);
      const at = nav.indexOf('aria-label="New post"') >= 0 ? nav.indexOf('aria-label="New post"') : nav.lastIndexOf(">New post<");
      expect(at, kind).toBeGreaterThan(nav.lastIndexOf('href="/settings"'));
      shell.state = { status: "signed-out" };
      expect(html(<AppShell>{null}</AppShell>), kind).not.toContain("New post");
    }
  });

  test("on a phone the compose button shows only where the screen asks for it (Home, a profile, Bookmarks), signed in", () => {
    shell.kind = "phone";
    shell.state = signedIn();
    expect(labelled(html(<AppShell compose>{null}</AppShell>), "New post")).toMatch(/role="button"/);
    expect(html(<AppShell>{null}</AppShell>)).not.toContain("New post");
    shell.state = { status: "signed-out" };
    expect(html(<AppShell compose>{null}</AppShell>)).not.toContain("New post");
    const screens = [read("app", "index.tsx"), read("app", "bookmarks.tsx"), read("app", "u", "[handle]", "index.tsx")];
    for (const screen of screens) expect(screen).toMatch(/<AppShell compose\b/);
    expect(read("app", "post", "[id].tsx")).not.toMatch(/<AppShell compose\b/);
  });
});
```

### Replace `apps/app/test/kit.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PostModeration } from "@korbat/contracts";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ICONS } from "../src/components/icons";
import { Avatar, monogram } from "../src/components/kit/Avatar";
import { EmptyState } from "../src/components/kit/EmptyState";
import { ErrorState, isOffline, retryWhenOnline } from "../src/components/kit/ErrorState";
import { IconButton } from "../src/components/kit/IconButton";
import { ListRow, RadioGroup } from "../src/components/kit/ListRow";
import { PublicFrame } from "../src/components/kit/PublicFrame";
import { Skeleton } from "../src/components/kit/Skeleton";
import { STATUS_ICON, STATUS_TONES, StatusChip } from "../src/components/kit/StatusChip";
import { VisuallyHidden } from "../src/components/kit/VisuallyHidden";
import { Body, Button, ErrorText, Field, Loading, Notice, Screen, Section, TextButton, TextLink, Title, VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { chipText } from "../src/lib/moderation";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * The kit of owned components (UI design, sections 6.1 to 6.5, 6.11 to 6.13 and 6.16, Task 2) and ui.tsx rebuilt on
 * it, rendered through react-dom/server and react-native-web and read as HTML: roles, names and states, which is what
 * assistive technology gets. Classes do not reach this markup (NativeWind turns them into styles only in the app's own
 * build), so the look is checked in the browser check from Task 3; what is checked here is what a screen reader hears.
 */

// expo-router cannot load in Node; Link with asChild hands its child the href, which react-native-web draws as an anchor.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

const SRC = path.resolve(import.meta.dirname, "..", "src");
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const noop = () => undefined;
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The text of every button, read up to the first closing div as appeals.test.tsx, automated.test.tsx and cases.test.tsx read it. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!);
/** The first opening tag that carries `attribute`. */
const tagWith = (markup: string, attribute: string): string => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).find((tag) => tag.includes(attribute)) ?? "";
/** Lucide's class for an icon's export name, as lucide-react writes it on the svg: BadgeCheck is lucide-badge-check. */
const lucideClass = (exportName: string): string => `lucide-${exportName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

afterEach(() => setAppearance(DEFAULT_APPEARANCE));

describe("IconButton (6.3)", () => {
  test("is a button named by its label, with its icon hidden", () => {
    const out = html(<IconButton icon="more" label="More options for this post" onPress={noop} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-label="More options for this post"');
    expect(out).toContain(lucideClass(ICONS.more));
    expect(/<svg[^>]*>/.exec(out)?.[0]).toContain('aria-hidden="true"');
    // The 500 ms tooltip repeats the name for pointers only, and only while hovered: a static render shows none.
    expect(out.split("More options for this post").length - 1).toBe(1);
  });

  test("says whether a toggle is pressed, and whether its request is still out", () => {
    expect(tagWith(html(<IconButton icon="like" label="Like" pressed onPress={noop} />), 'role="button"')).toContain('aria-pressed="true"');
    expect(tagWith(html(<IconButton icon="like" label="Like" pressed={false} onPress={noop} />), 'role="button"')).toContain('aria-pressed="false"');
    expect(tagWith(html(<IconButton icon="like" label="Like" onPress={noop} />), 'role="button"')).not.toContain("aria-pressed");
    expect(tagWith(html(<IconButton icon="like" label="Like" busy onPress={noop} />), 'role="button"')).toContain('aria-busy="true"');
  });

  test("a trigger says what it opens and whether it is open", () => {
    const closed = tagWith(html(<IconButton icon="more" label="More" hasPopup="menu" onPress={noop} />), 'role="button"');
    expect(closed).toContain('aria-haspopup="menu"');
    expect(closed).toContain('aria-expanded="false"');
    const open = tagWith(html(<IconButton icon="more" label="More" hasPopup="dialog" expanded onPress={noop} />), 'role="button"');
    expect(open).toContain('aria-haspopup="dialog"');
    expect(open).toContain('aria-expanded="true"');
  });

  test("the count is shown compact and kept out of the name, which already says it", () => {
    const out = html(<IconButton icon="like" label="Like, 1234 likes" count={1234} onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-label="Like, 1234 likes"');
    expect(out).toMatch(/aria-hidden="true"[^>]*>1\.2K</);
    expect(textOf(out)).toBe("1.2K");
    // The caller leaves the count out when it is zero or the reader hides counts (decision 15); then nothing shows.
    expect(textOf(html(<IconButton icon="like" label="Like" onPress={noop} />))).toBe("");
    expect(textOf(html(<IconButton icon="like" label="Like" count={0} onPress={noop} />))).toBe("");
  });
});

describe("Avatar (6.5)", () => {
  test("is a monogram of the display name's first grapheme, hidden from assistive technology", () => {
    const out = html(<Avatar account={{ id: "a", displayName: "ada lovelace" }} />);
    expect(/^<div[^>]*>/.exec(out)?.[0]).toContain('aria-hidden="true"');
    expect(textOf(out)).toBe("A");
  });

  test("keeps a letter and its combining mark together, and an empty name draws an empty disc", () => {
    const accented = `e${String.fromCharCode(0x301)}lise`;
    expect(monogram(accented)).toBe(`E${String.fromCharCode(0x301)}`);
    expect(monogram("  bea")).toBe("B");
    expect(monogram("")).toBe("");
  });

  test("draws the size it is given", () => {
    expect(html(<Avatar account={{ id: "a", displayName: "Ada" }} size={96} />)).toContain("width:96px;height:96px");
    expect(html(<Avatar account={{ id: "a", displayName: "Ada" }} />)).toContain("width:40px;height:40px");
  });
});

describe("ListRow (6.11)", () => {
  test("as a link it is an anchor with its label and description", () => {
    const out = html(<ListRow label="Appearance" description="Theme, text size and motion" href="/settings/appearance" />);
    expect(hrefs(out)).toEqual(["/settings/appearance"]);
    expect(textOf(out)).toBe("Appearance Theme, text size and motion");
    expect(out).toContain(lucideClass(ICONS.next));
  });

  test("as a button it is a button, with its value after the label", () => {
    const out = html(<ListRow label="Theme" value="Dark" onPress={noop} />);
    expect(buttons(out)).toEqual(["Theme"]);
    expect(textOf(out)).toBe("Theme Dark");
  });

  test("with a switch, the switch names itself by the row's label and says whether it is on", () => {
    const out = html(<ListRow label="Haptics" control={{ kind: "switch", value: true, onValueChange: noop }} />);
    const input = /<input[^>]*>/.exec(out)?.[0] ?? "";
    expect(input).toContain('role="switch"');
    expect(input).toContain('aria-label="Haptics"');
    expect(input).toContain('checked=""');
    // The row toggles it for a pointer, but is no second tab stop and no second control.
    expect(out).not.toContain('role="button"');
    expect(out.match(/tabindex="0"/g) ?? []).toEqual([]);
  });

  test("in a radio group each row is a radio that says whether it is chosen", () => {
    const out = html(
      <RadioGroup labelledBy="theme-heading">
        <ListRow label="Light" control={{ kind: "radio", checked: false, onSelect: noop }} />
        <ListRow label="Dark" control={{ kind: "radio", checked: true, onSelect: noop }} />
      </RadioGroup>,
    );
    expect(tagWith(out, 'role="radiogroup"')).toContain('aria-labelledby="theme-heading"');
    const radios = out.match(/<[a-z]+\b[^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('aria-checked="false"');
    expect(radios[1]).toContain('aria-checked="true"');
    expect(textOf(out)).toBe("Light Dark");
  });

  test("a switch row names its Switch on the <Switch line, which a11y.test.tsx's scan reads one line at a time", () => {
    const source = readFileSync(path.join(SRC, "components", "kit", "ListRow.tsx"), "utf8");
    expect(source).toMatch(/<Switch accessibilityLabel=\{label\}/);
  });
});

describe("Skeleton (6.12)", () => {
  test("every part is hidden from assistive technology", () => {
    for (const part of [<Skeleton.Text width={120} />, <Skeleton.Circle size={40} />, <Skeleton.Block height={120} />, <Skeleton.Post />, <Skeleton.Row />]) {
      expect(/^<div[^>]*>/.exec(html(part))?.[0]).toContain('aria-hidden="true"');
      expect(textOf(html(part))).toBe("");
    }
  });

  test("a post row carries a media block on every third row", () => {
    const blocks = (index: number) => (html(<Skeleton.Post index={index} />).match(/<div/g) ?? []).length;
    expect(blocks(2)).toBeGreaterThan(blocks(0));
    expect(blocks(5)).toBe(blocks(2));
    expect(blocks(1)).toBe(blocks(0));
  });

  test("a list of them carries one polite status with its words", () => {
    const posts = html(<Skeleton.List kind="posts" count={3} />);
    expect(tagWith(posts, 'role="status"')).toContain('aria-live="polite"');
    expect(textOf(posts)).toBe(UI_WORDS["feed.loading"]);
    expect(posts.match(/role="status"/g)).toHaveLength(1);
    expect(textOf(html(<Skeleton.List kind="accounts" />))).toBe(UI_WORDS["accounts.loading"]);
  });

  test("pulses, and stands still at 0.8 under reduced motion", () => {
    expect(html(<Skeleton.Row />)).toContain("opacity:1");
    setAppearance({ reduceMotion: "always" });
    expect(html(<Skeleton.Row />)).toContain("opacity:0.8");
  });
});

describe("EmptyState and ErrorState (6.12)", () => {
  test("an empty state has its title as a heading, its body, and one action", () => {
    const out = html(<EmptyState icon="bookmarks" title="No saved posts" body="Nothing saved yet. Use Save on a post to keep it here." action={{ label: "Go to Home", href: "/" }} />);
    expect(out).toMatch(/<h2[^>]*>No saved posts<\/h2>/);
    expect(textOf(out)).toContain("Nothing saved yet. Use Save on a post to keep it here.");
    expect(hrefs(out)).toEqual(["/"]);
    const pressed = html(<EmptyState title="Nothing posted yet" action={{ label: "Refresh", onPress: noop }} />);
    expect(buttons(pressed)).toEqual(["Refresh"]);
    expect(hrefs(pressed)).toEqual([]);
  });

  test("an error state says what went wrong as an alert, with Try again", () => {
    const out = html(<ErrorState message="Something went wrong. Try again." onRetry={noop} />);
    expect(out).toMatch(/role="alert"/);
    expect(textOf(/<[a-z]+\b[^>]*role="alert"[^>]*>.*$/.exec(out)?.[0] ?? "")).toContain("Something went wrong. Try again.");
    expect(buttons(out)).toEqual([UI_WORDS["error.retry"]]);
    expect(out).not.toContain(UI_WORDS["offline.title"].replace("'", "&#x27;"));
  });

  test("offline, it says so in its own words, with the same Try again", () => {
    const out = html(<ErrorState message="Check your connection and try again." offline onRetry={noop} />);
    const read = textOf(out);
    expect(read).toContain(UI_WORDS["offline.title"]);
    expect(read).toContain(UI_WORDS["offline.body"]);
    expect(out).toContain(lucideClass(ICONS.offline));
    expect(buttons(out)).toEqual([UI_WORDS["error.retry"]]);
  });

  test("offline is a request that got no answer, or a browser that says it is offline", () => {
    expect(isOffline(new ApiError(0, "network", "Check your connection and try again."))).toBe(true);
    expect(isOffline(new ApiError(500, "internal", "Something went wrong."))).toBe(false);
    expect(isOffline(new Error("boom"))).toBe(false);
    vi.stubGlobal("navigator", { onLine: false });
    try {
      expect(isOffline(new ApiError(500, "internal", "Something went wrong."))).toBe(true);
      expect(isOffline()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("retries once by itself when the browser is online again, and does nothing where there is no such event", () => {
    const target = new EventTarget();
    const retry = vi.fn();
    const stop = retryWhenOnline(retry, target);
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("online"));
    expect(retry).toHaveBeenCalledTimes(1);
    stop();
    const later = vi.fn();
    retryWhenOnline(later, target)();
    target.dispatchEvent(new Event("online"));
    expect(later).not.toHaveBeenCalled();
    expect(() => retryWhenOnline(noop, {})()).not.toThrow();
  });
});

describe("StatusChip (6.13) and never colour alone (4.8)", () => {
  test("the four tones draw four different icons", () => {
    expect([...STATUS_TONES]).toEqual(["review", "restricted", "verified", "explore"]);
    const names = STATUS_TONES.map((tone) => STATUS_ICON[tone]);
    expect(new Set(names).size).toBe(4);
    expect(new Set(names.map((name) => ICONS[name])).size).toBe(4);
  });

  test("every chip draws its icon and a label that is not empty", () => {
    for (const tone of STATUS_TONES) {
      const out = html(<StatusChip tone={tone} label="Under review: R4" />);
      expect(out, tone).toContain(lucideClass(ICONS[STATUS_ICON[tone]]));
      expect(textOf(out), tone).toBe("Under review: R4");
    }
  });

  test("information only: an image named by its label, or by a name of its own", () => {
    const out = html(<StatusChip tone="verified" label="Verified" name="verified account" />);
    const tag = tagWith(out, 'role="img"');
    expect(tag).toContain('aria-label="verified account"');
    expect(textOf(out)).toBe("Verified");
    expect(tagWith(html(<StatusChip tone="explore" label="In Explore" />), 'role="img"')).toContain('aria-label="In Explore"');
  });

  test("a link: an anchor whose name is its words", () => {
    const out = html(<StatusChip tone="explore" label="In Explore" href="/post/p1" />);
    expect(hrefs(out)).toEqual(["/post/p1"]);
    expect(out).not.toContain('role="img"');
    expect(textOf(out)).toBe("In Explore");
  });

  test("a button that opens a sheet: named by chipText(), it says it opens a dialog and ends in a chevron", () => {
    const decision: PostModeration = { decisionId: "00000000-0000-4000-8000-000000000001", ruleId: "R3", legal: false, interim: false, strikeUntil: "2026-12-04T10:00:00.000Z" };
    const words = chipText(decision);
    const out = html(<StatusChip tone="restricted" label={words} onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-haspopup="dialog"');
    expect(buttons(out)).toEqual([words]);
    expect(out).toContain(lucideClass(ICONS.next));
    expect(out).not.toContain('role="img"');
  });

  test("chipText() is never empty, over interim, removed, legal, strike and order shapes", () => {
    const base: PostModeration = { decisionId: "00000000-0000-4000-8000-000000000001", ruleId: null, legal: false, interim: false, strikeUntil: null };
    const shapes: PostModeration[] = [
      { ...base, interim: true, ruleId: "R4" },
      { ...base, ruleId: "R3" },
      base,
      { ...base, legal: true },
      { ...base, interim: true, legal: true },
      { ...base, ruleId: "R2", strikeUntil: "2026-12-04T10:00:00.000Z" },
      { ...base, order: true },
    ];
    for (const shape of shapes) {
      const words = chipText(shape);
      expect(words.trim().length, JSON.stringify(shape)).toBeGreaterThan(0);
      expect(textOf(html(<StatusChip tone={shape.interim ? "review" : "restricted"} label={words} onPress={noop} />))).toBe(words);
    }
  });

  test("a chip keeps its shape in forced colours and never truncates its words", () => {
    const source = readFileSync(path.join(SRC, "components", "kit", "StatusChip.tsx"), "utf8");
    expect(source).toContain("forced-colors:border-[color:CanvasText]");
    expect(source).not.toMatch(/numberOfLines|truncate|ellipsizeMode/);
  });
});

describe("VisuallyHidden (6.16)", () => {
  test("keeps its text for assistive technology in a 1 px clipped box off the layout", () => {
    const out = html(<VisuallyHidden nativeID="count">12 of 1000 characters</VisuallyHidden>);
    expect(textOf(out)).toBe("12 of 1000 characters");
    expect(out).toContain('id="count"');
    expect(out).toContain("position:absolute;width:1px;height:1px;overflow-x:hidden;overflow-y:hidden");
  });

  test("can be a polite status", () => {
    expect(tagWith(html(<VisuallyHidden role="status">Loading posts</VisuallyHidden>), 'role="status"')).toContain('aria-live="polite"');
  });
});

describe("PublicFrame (7.3)", () => {
  test("the wordmark leads home, the content is the main landmark, and the footer links the public pages", () => {
    const out = html(
      <PublicFrame>
        <Title>Sign in</Title>
      </PublicFrame>,
    );
    expect(hrefs(out)).toEqual(["/", "/rules", "/transparency", "/terms"]);
    expect(out).toMatch(/<a\b[^>]*href="\/"[^>]*>.*?korbat/);
    expect(out).toMatch(/<main\b[^>]*>.*<h1/);
    expect(out).toContain("<footer");
    expect(textOf(/<footer.*<\/footer>/.exec(out)?.[0] ?? "")).toBe(`${UI_WORDS["frame.rules"]} ${UI_WORDS["frame.transparency"]} ${UI_WORDS["frame.terms"]}`);
    expect(out).toContain("max-width:440px");
    expect(html(<PublicFrame wide>{null}</PublicFrame>)).toContain("max-width:640px");
  });
});

describe("ui.tsx on the kit (6.1, 6.4)", () => {
  test("a busy button says Please wait, is busy and disabled, and its label comes before any closing div", () => {
    const out = html(<Button label="Send code" busy onPress={noop} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).toContain('aria-disabled="true"');
    expect(buttons(out)).toEqual([`Please wait${String.fromCharCode(0x2026)}`]);
  });

  test("a disabled button keeps its label, which may carry its reason", () => {
    const out = html(<Button label="Describe every image" disabled onPress={noop} />);
    expect(tagWith(out, 'role="button"')).toContain('aria-disabled="true"');
    expect(buttons(out)).toEqual(["Describe every image"]);
  });

  test("every tone, size and icon keeps the label first in the button's text", () => {
    for (const tone of ["primary", "secondary", "danger"] as const) {
      expect(buttons(html(<Button label="Add image" tone={tone} icon="add-image" size="lg" full={false} onPress={noop} />)), tone).toEqual(["Add image"]);
    }
    expect(html(<Button label="Add image" icon="add-image" onPress={noop} />)).toContain(lucideClass(ICONS["add-image"]));
  });

  test("the verified chip: one image named verified account, showing Verified and its icon", () => {
    const out = html(<VerifiedChip />);
    expect(out.match(/<div[^>]*aria-label="verified account"[^>]*>/g)).toHaveLength(1);
    expect(tagWith(out, 'aria-label="verified account"')).toContain('role="img"');
    expect(textOf(out)).toBe("Verified");
    expect(out).toContain(lucideClass(ICONS.verified));
  });

  test("Title is the level-1 heading, Section's title a level-2 heading", () => {
    expect(html(<Title>Security</Title>)).toMatch(/^<h1\b[^>]*>Security<\/h1>$/);
    expect(html(<Section title="Password">{null}</Section>)).toMatch(/<h2\b[^>]*aria-level="2"[^>]*>Password<\/h2>/);
  });

  test("TextLink is an anchor, TextButton a button, both named by their words", () => {
    const link = html(<TextLink label="Read the terms" href="/terms" />);
    expect(hrefs(link)).toEqual(["/terms"]);
    expect(textOf(link)).toBe("Read the terms");
    expect(buttons(html(<TextButton label="Use a recovery code" onPress={noop} />))).toEqual(["Use a recovery code"]);
  });

  test("the rest keep their contracts: a labelled field, an alert for errors, a notice, the screen and the spinner", () => {
    const field = html(<Field label="Email" />);
    expect(textOf(field)).toBe("Email");
    expect(/<input[^>]*>/.exec(field)?.[0]).toContain('aria-label="Email"');
    expect(html(<ErrorText message={null} />)).toBe("");
    const error = html(<ErrorText message="That code is not valid." />);
    expect(tagWith(error, 'role="alert"')).not.toBe("");
    expect(textOf(error)).toBe("That code is not valid.");
    expect(error).toContain(lucideClass(ICONS.error));
    expect(html(<Notice message={null} />)).toBe("");
    expect(textOf(html(<Notice message="Saved." />))).toBe("Saved.");
    expect(textOf(html(<Screen><Body>Hello</Body></Screen>))).toBe("Hello");
    const spinner = tagWith(html(<Loading />), 'role="progressbar"');
    expect(spinner).toContain(`aria-label="${UI_WORDS["spinner.label"]}"`);
  });

  test("the spinner turns, and under reduced motion pulses instead of turning", () => {
    const turning = html(<Loading />);
    expect(turning).toContain('style="transform:rotate(0deg)"');
    expect(turning).not.toContain("opacity:");
    setAppearance({ reduceMotion: "always" });
    const pulsing = html(<Loading />);
    expect(pulsing).not.toContain("rotate(");
    expect(pulsing).toContain('style="opacity:1"');
  });
});

describe("controls must be named (section 10)", () => {
  test("tsc refuses a Button, IconButton or ListRow without a label", () => {
    const nameless = [
      // @ts-expect-error label is required: it is the control's accessible name.
      <Button onPress={noop} />,
      // @ts-expect-error label is required: it is the icon-only control's only name.
      <IconButton icon="like" onPress={noop} />,
      // @ts-expect-error label is required: it is the row's title and its name.
      <ListRow onPress={noop} />,
    ];
    expect(nameless).toHaveLength(3);
  });
});

describe("only the icons korbat draws are bundled (4.7)", () => {
  test("each Icon file takes its icons one module at a time, never values from the package's main entry, which re-exports the whole set", () => {
    for (const [file, deep] of [
      ["Icon.web.tsx", /^import [A-Z]\w* from "lucide-react\/dist\/esm\/icons\/[a-z0-9-]+\.mjs";$/],
      ["Icon.tsx", /^import [A-Z]\w* from "lucide-react-native\/icons\/[a-z0-9-]+";$/],
    ] as const) {
      const imports = readFileSync(path.join(SRC, "components", "kit", file), "utf8")
        .split(String.fromCharCode(10))
        .filter((line) => line.includes('from "lucide-react'));
      expect(imports.filter((line) => !line.startsWith("import type ") && !deep.test(line)), file).toEqual([]);
      expect(imports.filter((line) => deep.test(line)).length, file).toBe(new Set(Object.values(ICONS)).size);
    }
  });
});

describe("hover is for fine pointers only (5.2)", () => {
  test("tailwind.config.js gives hover styles only where the pointer can hover", () => {
    const config = createRequire(path.resolve(import.meta.dirname, "..", "package.json"))("./tailwind.config.js") as { future?: Record<string, boolean> };
    expect(config.future).toEqual({ hoverOnlyWhenSupported: true });
  });
});

describe("test/setup.ts", () => {
  /** Every name src imports from `module`, "default" for a default import; type-only imports are left out. */
  function importedNames(module: string): string[] {
    const names = new Set<string>();
    const pattern = /import\s+(?!type\b)(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*"([^"]+)"/g;
    for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      for (const match of readFileSync(path.join(SRC, file), "utf8").matchAll(pattern)) {
        if (match[3] !== module) continue;
        if (match[1]) names.add("default");
        for (const part of (match[2] ?? "").split(",")) {
          const name = part.trim();
          if (name === "" || name.startsWith("type ")) continue;
          names.add(name.split(/\s+as\s+/)[0]!.trim());
        }
      }
    }
    return [...names].sort();
  }

  test("each native module's mock gives every name src imports from it", async () => {
    for (const module of ["react-native-reanimated", "react-native-gesture-handler", "react-native-safe-area-context", "expo-haptics", "expo-router/head", "lucide-react-native"]) {
      const mocked = Object.keys(await import(/* @vite-ignore */ module));
      expect(importedNames(module).filter((name) => !mocked.includes(name)), module).toEqual([]);
    }
    expect(importedNames("react-native-reanimated")).toContain("useReducedMotion");
    expect(importedNames("expo-haptics").length).toBeGreaterThan(0);
  });
});

// UI Task 4 appends below, so the lines above keep the numbers other tasks cite.
import { Text as KitText } from "../src/components/kit/Text";
import { Menu, MenuPanel, menuIndex, placeMenu, type MenuItem } from "../src/components/kit/Menu";
import { SheetFrame } from "../src/components/kit/Sheet";

/** The source of a kit file, for what a static render cannot show (a press, a key, a Modal's props). */
const kitSource = (file: string): string => readFileSync(path.join(SRC, "components", "kit", file), "utf8");

describe("Sheet (6.8)", () => {
  const frame = (layout: "phone" | "wide") =>
    html(
      <SheetFrame titleId="sheet-title" title="Who sees this" description="Who can read this post" layout={layout} onClose={noop}>
        <KitText>What the sheet holds</KitText>
      </SheetFrame>,
    );

  test("drawn open, its title is the heading the dialog is named by, with the description and the content under it", () => {
    const out = frame("phone");
    expect(out).toMatch(/<h2 [^>]*id="sheet-title"/);
    expect(textOf(out)).toBe("Who sees this Who can read this post What the sheet holds");
    // react-native-web's Modal is the dialog (role="dialog", aria-modal) and renders nothing on a server: the Sheet hands
    // it the title's id, and the frame is what it holds.
    const sheet = kitSource("Sheet.tsx");
    expect(sheet).toMatch(/<Modal visible=\{shown\} transparent animationType="none" onRequestClose=\{[^}]+\} onDismiss=\{[^}]+\} aria-labelledby=\{titleId\}>/);
    expect(sheet).toContain("titleId={titleId}");
  });

  test("the scrim closes the sheet but is no tab stop and hidden from assistive technology, and comes after the panel", () => {
    const out = frame("phone");
    const scrim = tagWith(out, "data-scrim");
    expect(scrim).toContain('aria-hidden="true"');
    expect(scrim).not.toContain("tabindex");
    expect(scrim).not.toContain('role="button"');
    // react-native-web's focus trap gives the focus to the first focusable element it meets: the panel's, never the scrim.
    expect(out.indexOf("data-scrim")).toBeGreaterThan(out.indexOf('id="sheet-title"'));
  });

  test("below 768 px a bottom sheet with a grab handle; wider a centred dialog without one", () => {
    expect(frame("phone")).toContain("data-handle");
    expect(frame("wide")).not.toContain("data-handle");
    expect(tagWith(frame("phone"), "data-handle")).toContain('aria-hidden="true"');
  });

  test("Escape, the scrim and a release past the threshold close it; focus goes in on opening and back to the opener", () => {
    const sheet = kitSource("Sheet.tsx");
    // Escape reaches the Modal's onRequestClose; the scrim's press and the drag's release call the same close.
    expect(sheet).toContain("onRequestClose={dismiss}");
    expect(sheet).toContain('haptic("threshold")');
    expect(sheet).toContain("focusTitle");
  });
});

describe("Menu (6.9)", () => {
  const items: MenuItem[] = [
    { label: "Who sees this", icon: "who-sees", description: "Public", onSelect: noop },
    { label: "Delete", icon: "delete", tone: "danger", onSelect: noop },
    { label: "Report", icon: "report", href: "/report?post=1" },
  ];

  test("the trigger is a disclosure: an icon button named by its label that says it opens a menu, and whether it is open", () => {
    const out = html(<Menu label="More options for this post" icon="more" items={items} />);
    const tag = tagWith(out, 'role="button"');
    expect(tag).toContain('aria-label="More options for this post"');
    expect(tag).toContain('aria-haspopup="menu"');
    expect(tag).toContain('aria-expanded="false"');
  });

  test("open on a phone it is a sheet titled by the trigger's label; its items are buttons and real links", () => {
    const out = html(<MenuPanel label="More options for this post" items={items} layout="phone" onPick={noop} />);
    expect(/<h2[^>]*>(.*?)<\/h2>/.exec(out)?.[1]).toBe("More options for this post");
    expect(buttons(out)).toEqual(["Who sees this", "Delete"]);
    // Who sees this carries its one line under its label.
    expect(textOf(out)).toContain("Who sees this Public");
    expect(hrefs(out)).toEqual(["/report?post=1"]);
    expect(textOf(out)).toContain("Report");
  });

  test("open wider it is a popover of the same items, named by the trigger's label", () => {
    const out = html(<MenuPanel label="More options for this post" items={items} layout="wide" onPick={noop} />);
    expect(out).not.toContain("<h2");
    expect(tagWith(out, "data-menu")).toContain('aria-label="More options for this post"');
    expect(buttons(out)).toEqual(["Who sees this", "Delete"]);
    expect(hrefs(out)).toEqual(["/report?post=1"]);
  });

  test("arrow keys move between the items and wrap; Home and End jump; other keys do nothing", () => {
    expect(menuIndex(0, "ArrowDown", 3)).toBe(1);
    expect(menuIndex(2, "ArrowDown", 3)).toBe(0);
    expect(menuIndex(0, "ArrowUp", 3)).toBe(2);
    expect(menuIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(menuIndex(1, "Home", 3)).toBe(0);
    expect(menuIndex(1, "End", 3)).toBe(2);
    expect(menuIndex(1, "Enter", 3)).toBeNull();
  });

  test("the popover sits under its trigger at its end, and flips to stay inside the window", () => {
    const window_ = { width: 1280, height: 900 };
    const panel = { width: 280, height: 200 };
    // Under the trigger, its right edge at the trigger's: growing from the trigger's bottom-right corner.
    expect(placeMenu({ x: 900, y: 100, width: 44, height: 44 }, panel, window_)).toEqual({ left: 664, top: 148, origin: "top right" });
    // No room under it: above it, growing from its top.
    expect(placeMenu({ x: 900, y: 800, width: 44, height: 44 }, panel, window_)).toEqual({ left: 664, top: 596, origin: "bottom right" });
    // No room at its start: from its left edge instead.
    expect(placeMenu({ x: 20, y: 100, width: 44, height: 44 }, panel, window_)).toEqual({ left: 20, top: 148, origin: "top left" });
    // Never past the window's edges, with 8 px to spare.
    const tight = placeMenu({ x: 100, y: 300, width: 44, height: 44 }, { width: 280, height: 880 }, { width: 300, height: 900 });
    expect(tight.left).toBeGreaterThanOrEqual(8);
    expect(tight.top).toBeGreaterThanOrEqual(8);
  });

  test("Escape and a press outside close it and give the focus back to the trigger", () => {
    const menu = kitSource("Menu.tsx");
    expect(menu).toContain("onRequestClose={close}");
    expect(menu).toContain("trigger.current?.focus()");
  });

  test("tsc refuses a Menu item without a label", () => {
    // @ts-expect-error label is required: it is the item's name.
    const nameless: MenuItem = { icon: "delete", onSelect: noop };
    expect(nameless.icon).toBe("delete");
  });
});

// UI Task 5 appends below, after Menu's cases, so the lines above keep the numbers other tasks cite.
import { tabId, TabPanel, Tabs, tabMove, type TabsProps } from "../src/components/kit/Tabs";

describe("Tabs (6.10)", () => {
  const tabs = [
    { key: "posts", label: "Posts" },
    { key: "replies", label: "Replies" },
    { key: "likes", label: "Likes" },
  ];
  /** Each tab's opening tag and its first text, as explore.test.tsx's tabsOf reads a tab list. */
  const tabsOf = (markup: string) => [...markup.matchAll(/<[a-z]+\b([^>]*\brole="tab"[^>]*)>(?:<[^>]+>)*([^<]*)/g)].map((match) => ({ tag: match[1]!, label: match[2]! }));

  test("a tab list named by its label, a tab per entry with its label as its first text, the chosen one selected", () => {
    const out = html(<Tabs label="Profile tabs" tabs={tabs} selected="replies" onSelect={noop} panelId="profile-panel" />);
    expect(tagWith(out, 'role="tablist"')).toContain('aria-label="Profile tabs"');
    const found = tabsOf(out);
    expect(found.map((tab) => tab.label)).toEqual(["Posts", "Replies", "Likes"]);
    expect(found.map((tab) => tab.tag.includes('aria-selected="true"'))).toEqual([false, true, false]);
    // Each tab controls the panel and has the id the panel is named by.
    for (const tab of found) expect(tab.tag).toContain('aria-controls="profile-panel"');
    expect(found[1]!.tag).toContain(`id="${tabId("profile-panel", "replies")}"`);
  });

  test("one tab stop: the selected tab, the others reached with the arrows", () => {
    const found = tabsOf(html(<Tabs label="Profile tabs" tabs={tabs} selected="posts" onSelect={noop} panelId="p" />));
    expect(found.map((tab) => /tabindex="(-?\d)"/.exec(tab.tag)?.[1])).toEqual(["0", "-1", "-1"]);
  });

  test("Left and Right move and select at once and wrap; Home and End jump; other keys do nothing", () => {
    expect(tabMove(0, "ArrowRight", 3)).toBe(1);
    expect(tabMove(2, "ArrowRight", 3)).toBe(0);
    expect(tabMove(0, "ArrowLeft", 3)).toBe(2);
    expect(tabMove(1, "Home", 3)).toBe(0);
    expect(tabMove(1, "End", 3)).toBe(2);
    expect(tabMove(1, "ArrowDown", 3)).toBeNull();
    expect(tabMove(1, "Enter", 3)).toBeNull();
  });

  test("the panel is a tabpanel named by the selected tab", () => {
    const panel = tagWith(html(<TabPanel panelId="profile-panel" selected="likes"><KitText>Likes</KitText></TabPanel>), 'role="tabpanel"');
    expect(panel).toContain('id="profile-panel"');
    expect(panel).toContain(`aria-labelledby="${tabId("profile-panel", "likes")}"`);
  });

  test("the underline moves on spring-snap for a pointer and jumps for keys and reduced motion; the row scrolls sideways; the ring and the selection haptic", () => {
    const source = kitSource("Tabs.tsx");
    expect(source).toContain('motion.spring("springSnap")');
    expect(source).toContain("lastInputWasKeyboard()");
    expect(source).toContain('haptic("selection")');
    expect(source).toContain("FOCUS_RING");
    expect(source).toContain("horizontal");
    expect(source).not.toContain("flex-wrap");
  });

  test("tsc refuses a tab list without a name", () => {
    // @ts-expect-error label is required: it names the tab list.
    const nameless: TabsProps<"posts"> = { tabs: [{ key: "posts", label: "Posts" }], selected: "posts", onSelect: noop, panelId: "p" };
    expect(nameless.panelId).toBe("p");
  });
});

describe("ListRow for an account (6.11, 8.4)", () => {
  const account = { id: "00000000-0000-4000-8000-000000000002", displayName: "Grace Hopper" };

  test("the link holds the avatar, the name with its chip and the handle; the control sits beside the link, outside it", () => {
    const out = html(
      <ListRow
        label="Grace Hopper"
        href="/u/grace"
        leading={<Avatar account={account} size={40} />}
        badge={<VerifiedChip />}
        detail={<KitText variant="mono">@grace</KitText>}
        control={{ kind: "button", element: <Button label="Follow" onPress={noop} full={false} /> }}
      />,
    );
    const link = /<a\b[^>]*href="\/u\/grace"[^>]*>([\s\S]*?)<\/a>/.exec(out)?.[1] ?? "";
    // The monogram's letter is decoration, hidden from assistive technology; the name, the chip and the handle follow it.
    expect(textOf(link)).toBe("G Grace Hopper Verified @grace");
    expect(link).not.toContain('role="button"');
    expect(buttons(out)).toEqual(["Follow"]);
    // No chevron beside a control: the row's one trailing thing is the control.
    expect(out).not.toContain(lucideClass(ICONS.next));
  });
});

// UI Task 8 appends below, so the lines above keep the numbers other tasks cite.
import { Switch } from "react-native";
import { radioMove } from "../src/components/kit/Tabs";

describe("radio groups on the keyboard (6.11, UI Task 8)", () => {
  test("Down and Right move to the next radio and Up and Left to the one before, wrapping; other keys do nothing", () => {
    expect(radioMove(0, "ArrowDown", 4)).toBe(1);
    expect(radioMove(0, "ArrowRight", 4)).toBe(1);
    expect(radioMove(3, "ArrowDown", 4)).toBe(0);
    expect(radioMove(0, "ArrowUp", 4)).toBe(3);
    expect(radioMove(2, "ArrowLeft", 4)).toBe(1);
    // A radio group has no Home and End (WAI-ARIA's radio group pattern), and Enter, Tab or a letter move nothing.
    expect(radioMove(2, "Home", 4)).toBeNull();
    expect(radioMove(2, "End", 4)).toBeNull();
    expect(radioMove(1, "Enter", 4)).toBeNull();
    expect(radioMove(1, "Tab", 4)).toBeNull();
    expect(radioMove(0, "ArrowDown", 0)).toBeNull();
  });

  test("one tab stop per group: the chosen radio; the arrows reach the others and choose them at once, unanimated", () => {
    const out = html(
      <RadioGroup labelledBy="size-heading">
        <ListRow label="Smaller" control={{ kind: "radio", checked: false, onSelect: noop }} />
        <ListRow label="Default" control={{ kind: "radio", checked: true, onSelect: noop }} />
        <ListRow label="Larger" control={{ kind: "radio", checked: false, onSelect: noop }} />
      </RadioGroup>,
    );
    const radios = out.match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? [];
    expect(radios.map((tag) => /tabindex="(-?[0-9])"/.exec(tag)?.[1])).toEqual(["-1", "0", "-1"]);
    const source = kitSource("ListRow.tsx");
    expect(source).toContain("radioMove(");
    // The arrows choose without any motion of their own: the row's radio mark changes as a press would change it.
    expect(source).not.toMatch(/withSpring|withTiming/);
  });

  test("a switch row can carry a Switch of its own, which keeps its own line, with the row's flip and ring", () => {
    const out = html(
      <ListRow
        label="Show my posts in Explore"
        control={{ kind: "switch", value: true, onValueChange: noop, element: <Switch accessibilityLabel="Show my posts in Explore" value onValueChange={noop} /> }}
      />,
    );
    const inputs = out.match(/<input[^>]*role="switch"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('aria-label="Show my posts in Explore"');
    expect(inputs[0]).toContain('checked=""');
    expect(out).not.toContain('role="button"');
    expect(out.match(/tabindex="0"/g) ?? []).toEqual([]);
  });
});
```

### Replace `apps/app/test/legacy-files.ts` (whole file)

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The source files that still paint with Tailwind's own palette (`text-zinc-400`, `bg-sky-500`) and size the text
 * with size and weight classes instead of korbat's tokens and the Text component (UI design, sections 4.2 and 6.2).
 * contrast.test.ts lets these files, and only these, keep palette classes and hex colours; theme.test.ts lets them
 * keep size and weight classes. A listed file that no longer holds a palette class fails contrast.test.ts, so the
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 emptied it, and the export
 * stays, empty, for Task 10's check. Paths are from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [];

/**
 * The files of src/app and src/components that still hold a bare sentence as a JSX child, a text or a string literal
 * written straight into the markup instead of a words module (UI design, section 1.5). a11y.test.tsx lets these files,
 * and only these, keep them; a listed file that no longer holds one fails, so the task that moves a file's sentences
 * into its area's words module takes it off this list in the same commit. Task 8 emptied it, and the export stays,
 * empty, for Task 10, which records what is left. Paths are from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_TEXT_FILES: readonly string[] = [];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
```

### Replace `apps/app/test/lifecycle.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import { ORDER_RULES } from "@korbat/contracts";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import EmailRevert from "../src/app/email-revert/[token]";
import { exportMessage } from "../src/app/settings/account";
import { SettingsNav, type SettingsPage } from "../src/components/SettingsNav";
import { VerifiedChip } from "../src/components/ui";
import { ApiError } from "../src/lib/api";
import { DELETE_HOLD } from "../src/lib/orders";
import { exportFilename } from "../src/lib/download";

/**
 * The account-lifecycle screens (1b design, section 9): the row of settings links, the verified badge
 * chip and the export download. The screens themselves need the router and a session, so what can be
 * checked without a browser is rendered on its own or read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** The route parameters the screen under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules), and the row needs only what
// Link does with `asChild`: hand the child its href, which react-native-web renders as a real anchor. A
// screen also reads its route parameters, and could navigate, which a static render never does.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined },
  useLocalSearchParams: () => route.params,
}));
// A screen reads the session only to refresh it after its call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** Every anchor's opening tag in the markup. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];

const PAGES: SettingsPage[] = ["appearance", "security", "privacy", "profile", "account", "cases"];

describe("the settings row", () => {
  test("links every settings screen as a real anchor inside a navigation landmark", () => {
    const out = html(<SettingsNav current="security" />);
    expect(out).toMatch(/<nav\b|role="navigation"/);
    expect(anchors(out).map((tag) => /href="([^"]+)"/.exec(tag)?.[1])).toEqual(PAGES.map((page) => `/settings/${page}`));
  });

  test("marks the current page and only it", () => {
    for (const page of PAGES) {
      const current = anchors(html(<SettingsNav current={page} />)).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, page).toHaveLength(1);
      expect(current[0], page).toContain(`href="/settings/${page}"`);
    }
  });

  test("every settings screen shows the row and names itself as the current page", () => {
    const dir = path.join(SRC, "app", "settings");
    // A page is a file of the folder, or a folder of its own whose screens all belong to it, at any depth (Cases: its list,
    // one decision, and that decision's reply screen).
    const filesUnder = (folder: string): string[] =>
      readdirSync(path.join(dir, folder), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
    const screens = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("_") && entry.name !== "index.tsx") // UI Task 8: the Settings index lists the pages, without the row.
      .flatMap((entry) =>
        entry.isDirectory() ? filesUnder(entry.name).map((file) => ({ page: entry.name, file })) : [{ page: entry.name.endsWith(".tsx") ? entry.name.slice(0, -".tsx".length) : entry.name, file: entry.name }],
      );
    expect([...new Set(screens.map((screen) => screen.page))].sort()).toEqual([...PAGES].sort());
    for (const { page, file } of screens) {
      expect(file.endsWith(".tsx"), file).toBe(true);
      expect(readFileSync(path.join(dir, file), "utf8"), file).toContain(`<SettingsNav current="${page}"`);
    }
  });
});

describe("the verified badge chip", () => {
  test("renders its label and names itself for a screen reader, as an image, since ARIA lets no generic element carry a name", () => {
    const out = html(<VerifiedChip />);
    expect(out).toContain("Verified");
    const tag = /<div[^>]*aria-label="verified account"[^>]*>/.exec(out)?.[0] ?? "";
    expect(tag).toContain('role="img"');
  });

  test("is what post cards and the profile header show for a verified account", () => {
    for (const file of [path.join("components", "social", "PostCard.tsx"), path.join("app", "u", "[handle]", "index.tsx")]) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      expect(source, file).toMatch(/verified \? <VerifiedChip \/> : null/);
    }
  });
});

describe("the export download", () => {
  test("takes its file name from Content-Disposition and falls back to a plain one", () => {
    expect(exportFilename('attachment; filename="korbat-export-alice-2026-09-24.zip"')).toBe("korbat-export-alice-2026-09-24.zip");
    expect(exportFilename(null)).toBe("korbat-export.zip");
    expect(exportFilename("attachment")).toBe("korbat-export.zip");
    // Only the API's own shape of name reaches the browser's download prompt.
    expect(exportFilename('attachment; filename="../evil.zip"')).toBe("korbat-export.zip");
  });
});

describe("the email-revert page, opened from the link in the email-changed notice", () => {
  const LABEL = "Move my account back to this address";
  /** The opening tag of the button whose text is the label, or "" when there is none. */
  const buttonTag = (markup: string): string => {
    const at = markup.indexOf(LABEL);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };

  test("with the link's token it explains what happens and offers the button, which nothing happens without", () => {
    route.params = { token: "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2) };
    const out = html(<EmailRevert />);
    expect(out).toContain(LABEL);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(buttonTag(out)).not.toBe("");
    expect(buttonTag(out)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
  });

  test("with anything else in place of the token it says the link is incomplete and disables the button", () => {
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const out = html(<EmailRevert />);
      expect(out, token).toContain('role="alert"');
      expect(out, token).toMatch(/link is incomplete/);
      expect(buttonTag(out), token).toContain('aria-disabled="true"');
    }
  });

  test("the button posts the token to the undo route and the page then offers Sign in", () => {
    const source = readFileSync(path.join(SRC, "app", "email-revert", "[token].tsx"), "utf8");
    expect(source).toContain('api("/api/auth/email/revert", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });
});

/**
 * The settings screens' own rules, read from their source: the static render cannot press a key or
 * move the focus, so what a keyboard does there is checked in the code that does it.
 */
describe("the settings forms", () => {
  const account = readFileSync(path.join(SRC, "app", "settings", "account.tsx"), "utf8");
  const profile = readFileSync(path.join(SRC, "app", "settings", "profile.tsx"), "utf8");

  /** The body of the function or component `name` declares at the top of the file, up to its closing brace at the start of a line. */
  function block(source: string, name: string): string {
    const from = source.indexOf(`function ${name}(`);
    expect(from, name).toBeGreaterThanOrEqual(0);
    return source.slice(from, source.indexOf("\n}\n", from));
  }

  /** The first statement of the function `name` inside `outer`, comments skipped. */
  function firstStatement(source: string, outer: string, name: string): string {
    const body = block(source, outer);
    const at = body.indexOf(`function ${name}(`);
    expect(at, `${outer} ${name}`).toBeGreaterThanOrEqual(0);
    const lines = body
      .slice(at)
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    return lines[0] ?? "";
  }

  test("Enter follows the same rules as the button: every action begins with its button's condition", () => {
    expect(firstStatement(account, "useAction", "act")).toBe("if (busy) return;");
    expect(firstStatement(account, "EmailSection", "start")).toBe("if (email.trim().length === 0) return;");
    expect(firstStatement(account, "EmailSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "BadgeSection", "start")).toBe("if (phone.trim().length === 0) return;");
    expect(firstStatement(account, "BadgeSection", "verify")).toBe("if (!CODE.test(code.trim())) return;");
    expect(firstStatement(account, "DeleteSection", "confirm")).toBe("if (!CODE.test(code.trim()) || !matches) return;");
    expect(firstStatement(profile, "ProfileForm", "save")).toBe("if (!saved || !ready || busy) return;");
    expect(firstStatement(profile, "HandleSection", "change")).toBe("if (!ready || busy) return;");
  });

  test("the deletion screen says what deleting removes and what korbat keeps for a case, in the sentence the deletion mails say", () => {
    const section = block(account, "DeleteSection");
    expect(section).toContain("{ACCOUNT_DELETION_WORDS}");
    expect(section).not.toMatch(/for good|are gone|removes your posts and images/);
  });

  test("3f Task 5: the deletion screen says beforehand, to every account, the two things the law can oblige korbat to keep, with reportHoldDays from the contracts", () => {
    const section = block(account, "DeleteSection");
    expect(section).toContain("<Body>{DELETE_HOLD}</Body>");
    expect(section.indexOf("{DELETE_HOLD}")).toBeGreaterThan(section.indexOf("{ACCOUNT_DELETION_WORDS}"));
    expect(DELETE_HOLD).toBe(
      `Two things the law can oblige korbat to keep for a time (Terms, Your data). If korbat has sealed images of this account, it keeps your email address, and nothing else, for up to ${ORDER_RULES.reportHoldDays} days, until it has reported them to the authorities or has decided that it need not. And a post that an authority's order obliges korbat to preserve is kept until that time ends. Everything else is deleted at once, as described above.`,
    );
    // It promises no report and names no post: it is a rule, not a finding about this account.
    expect(DELETE_HOLD).not.toMatch(/will report|your post /);
  });

  test("the account's own address is refused in its own words, without asking the API", () => {
    const email = block(account, "EmailSection");
    expect(email).toContain("const current = email.trim().toLowerCase() === me.user.email.toLowerCase();");
    expect(email).toContain('<Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />');
    const start = email.slice(email.indexOf("function start("));
    const refusal = start.indexOf('setError("That is already your email address.");');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(start.indexOf('api("/api/auth/email/change/start"'));
  });

  test("the badge section shows only in a build that says on, and every build defaults to off", () => {
    expect(account).toContain('const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";');
    const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");
    expect(read("infra", "compose.yml")).toContain("EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}");
    const dockerfile = read("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_BADGE=off");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac');
    const infraEnv = read("infra", ".env.example");
    expect(infraEnv).toMatch(/^WEB_BADGE=off$/m);
    expect(infraEnv).toMatch(/^API_VERIFY_PROVIDER=off$/m);
    // The development API runs the dev provider, so the development app shows the section.
    expect(read("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_BADGE=on$/m);
    expect(read("apps", "api", ".env.example")).toMatch(/^VERIFY_PROVIDER=dev$/m);
  });

  test("the focus survives a step change: code fields take it, and going back hands it to the section's first control", () => {
    for (const label of ["Code from the email", "Code from the text message"]) {
      const fields = account.split("\n").filter((line) => line.includes(`<Field label="${label}"`));
      expect(fields.length, label).toBeGreaterThan(0);
      for (const field of fields) expect(field, label).toContain(" autoFocus ");
    }
    expect(block(account, "EmailSection")).toContain("useFocusOnReturn(flowId !== null, emailRef);");
    expect(block(account, "EmailSection")).toContain('<Field ref={emailRef} label="New email address"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(verified || flowId !== null, phoneRef);");
    expect(block(account, "BadgeSection")).toContain('<Field ref={phoneRef} label="Phone number"');
    expect(block(account, "BadgeSection")).toContain("useFocusOnReturn(!verified, removeRef);");
    expect(block(account, "BadgeSection")).toContain('<Button ref={removeRef} label="Remove badge"');
    expect(block(account, "DeleteSection")).toContain("useFocusOnReturn(flowId !== null, sendRef);");
    expect(block(account, "DeleteSection")).toContain('<Button ref={sendRef} label="Send me a code"');
    const hook = block(account, "useFocusOnReturn");
    expect(hook).toContain("if (!away && wasAway.current) target.current?.focus();");
    // The field and the button hand the ref to the element react-native-web renders, whose focus() moves the browser's focus.
    const ui = readFileSync(path.join(SRC, "components", "ui.tsx"), "utf8");
    expect(block(ui, "Field")).toContain("<TextInput\n        ref={ref}");
    expect(block(ui, "Button")).toContain("<Pressable ref={ref}");
  });

  test("the export's daily limit says when the next export is allowed", () => {
    const limited = (seconds: number) => new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", seconds);
    expect(exportMessage(limited(3600))).toBe("You exported your data today already. You can export again in about an hour.");
    expect(exportMessage(limited(20 * 3600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(limited(20 * 3600 - 600))).toBe("You exported your data today already. You can export again in about 20 hours.");
    expect(exportMessage(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toBe("Confirm it's you to continue.");
  });

  test("the export says it was downloaded only once the whole body arrived; a body that fails part way is an error", () => {
    const exporting = block(account, "ExportSection");
    const saved = exporting.indexOf("saveBlob(await res.blob(), exportFilename(res.headers.get(\"content-disposition\")));");
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThan(exporting.indexOf('setDone("Your export was downloaded.");'));
    // A rejected res.blob() leaves the action through useAction, which shows the error and no note.
    expect(exporting).toContain("useAction(run, exportMessage)");
  });
});
```

### Replace `apps/app/test/passkeys.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReauthResponse, type MeResponse, type PasskeyView } from "@korbat/contracts";
import EmailRevert from "../src/app/email-revert/[token]";
import NotMe from "../src/app/not-me/[token]";
import PasskeyRemove from "../src/app/passkey-remove/[token]";
import { AddPasskeyDialog, PasskeyItem } from "../src/components/security/PasskeysSection";
import { methodsForLevel, panelStart, REENROLL_HINT, ReauthPanel, reauthNeeded, recoveryCodeSpent, ReenrollNotice, type Method } from "../src/components/security/ReauthPanel";
import { ApiError, apiResponse, messageFor } from "../src/lib/api";
import { AUTOFILL_RESTART_MS, createAutofillScheduler, SUGGESTION_SNOOZE_MS, suggestPasskey, type AutofillEffects } from "../src/lib/passkeys";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The passkey screens (1c design, section 9): the sign-in autofill's schedule, the level-2 panel's choice, the home
 * card's rule and the messages are pure helpers and are called; the Security list's rows, the Add dialog and the
 * re-authentication panel are server-rendered as lifecycle.test.tsx renders the email-revert page; what a static
 * render cannot show (the sign-in screen's field and button, the pages' calls, the absence of the Signal API) is
 * read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters the page under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules); Link with `asChild` hands the child its
// href, a page reads its route parameters, and nothing navigates in a static render.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined, push: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  useFocusEffect: () => undefined,
}));
// The panel and the pages read the session only to refresh it after their call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source line matching `pattern`, as `file:line`. */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

const noop = async () => undefined;
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2);

/** Effects the scheduler drives, recorded: the runs it started, the aborts it asked for, and the timers it set. */
function fakeEffects() {
  const started: number[] = [];
  let aborts = 0;
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const effects: AutofillEffects = {
    start: (run) => started.push(run),
    abort: () => {
      aborts += 1;
    },
    after: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return { effects, started, aborts: () => aborts, timers };
}

describe("the sign-in autofill's schedule", () => {
  test("starts one conditional request when the screen is focused, and never a second while it runs", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.focus();
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(true);
    // A challenge lives 10 minutes and conditional mediation ignores the ceremony's timeout, so the request is renewed before its challenge expires.
    expect(AUTOFILL_RESTART_MS).toBe(9 * 60 * 1000);
    expect(fx.timers.map((timer) => timer.ms)).toEqual([AUTOFILL_RESTART_MS]);
  });

  test("renews the request after 9 minutes: aborts it and starts another, and the old one's late ending changes nothing", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    fx.timers[0]!.callback();
    expect(fx.aborts()).toBe(1);
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(scheduler.isCurrent(2)).toBe(true);
    scheduler.ended(1, "expired");
    scheduler.ended(1, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(true);
  });

  test("starts over after the API said the challenge expired, and stops after any other failure or a sign-in until the next focus", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1, 2]);
    expect(fx.timers[0]!.cancelled).toBe(true);
    scheduler.ended(2, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(false);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    scheduler.ended(3, "done");
    expect(fx.started).toEqual([1, 2, 3]);
    expect(fx.timers.every((timer) => timer.cancelled)).toBe(true);
    expect(fx.aborts()).toBe(0);
  });

  test("aborts the request when the screen loses focus, and starts a new one when it is focused again", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.blur();
    expect(fx.aborts()).toBe(0);
    scheduler.focus();
    scheduler.blur();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(fx.timers[0]!.cancelled).toBe(true);
    // The aborted request's own ending arrives later and starts nothing while the screen is away.
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2]);
  });

  test("holds while the button's own request runs: options fetched meanwhile start no ceremony, and it resumes afterwards if still focused", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.hold();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.hold();
    scheduler.blur();
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    // A hold with nothing running aborts nothing.
    scheduler.ended(3, "failed");
    scheduler.hold();
    expect(fx.aborts()).toBe(2);
  });

  test("does nothing once it is disposed, whatever comes after", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.dispose();
    expect(fx.aborts()).toBe(1);
    scheduler.focus();
    scheduler.release();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(false);
  });
});

describe("the level-2 panel's choice from the factors the session proved", () => {
  const ALL: Method[] = ["password", "passkey", "totp", "email", "recovery"];

  test("level 1 offers every method the account has", () => {
    expect(methodsForLevel({ level: 1, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
    expect(methodsForLevel({ level: 1, have: ["email"] }, ["email"])).toEqual({ methods: ["email"], missing: null });
  });

  test("after a first factor, only a second one is offered: a passkey, an authenticator code or a recovery code", () => {
    for (const first of ["email", "password", "passkey"] as const) {
      expect(methodsForLevel({ level: 2, have: [first] }, ALL), first).toEqual({ methods: ["passkey", "totp", "recovery"], missing: "second" });
    }
  });

  test("with only a second factor, a first one is offered: the password, a passkey or an email code", () => {
    for (const second of ["totp", "recovery"] as const) {
      expect(methodsForLevel({ level: 2, have: [second] }, ALL), second).toEqual({ methods: ["password", "passkey", "email"], missing: "first" });
    }
  });

  test("with nothing proved in time, everything is offered", () => {
    expect(methodsForLevel({ level: 2, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
  });

  test("the account's own methods bound the choice, and a choice that would be empty falls back to all of them", () => {
    expect(methodsForLevel({ level: 2, have: ["password"] }, ["password", "totp", "email"])).toEqual({ methods: ["totp"], missing: "second" });
    expect(methodsForLevel({ level: 2, have: ["email"] }, ["password", "email"])).toEqual({ methods: ["password", "email"], missing: null });
  });

  test("the details of a refusal are read as the level and the factors, and anything else means level 1 with nothing proved", () => {
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 2, have: ["email", "totp"] }))).toEqual({ level: 2, have: ["email", "totp"] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toEqual({ level: 1, have: [] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 3, have: "email" }))).toEqual({ level: 1, have: [] });
  });
});

describe("the home screen's passkey suggestion", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-25T12:00:00Z");

  test("shows for an account without passkeys on a device with a built-in authenticator, unless Not now was chosen in the last 30 days", () => {
    expect(SUGGESTION_SNOOZE_MS).toBe(30 * DAY);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: null, now })).toBe(true);
    expect(suggestPasskey({ passkeys: 1, platformAuthenticator: true, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: false, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 29 * DAY, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 31 * DAY, now })).toBe(true);
    // A dismissal from the future (the clock moved) still counts as recent.
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now + DAY, now })).toBe(false);
  });
});

describe("the passkey messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("every new code has its sentence, and the daily bound says its wait in hours from the details", () => {
    expect(messageFor("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(messageFor("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    expect(messageFor("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "cap" })).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7200 })).toBe("You added 5 passkeys today. You can add another in about 2 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7201 })).toBe("You added 5 passkeys today. You can add another in about 3 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 1 })).toBe("You added 5 passkeys today. You can add another in about 1 hour.");
    expect(messageFor("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(messageFor("challenge_expired")).toBe("That took too long. Try again.");
    expect(messageFor("passkey_not_found")).toBe("That passkey is gone.");
  });

  test("a refusal's details reach the error, and the daily bound is worded here from them rather than by the server", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(409, { error: { code: "passkey_limit", message: "server wording", details: { reason: "daily", retryAfter: 7200 } } }));
    await expect(apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } })).rejects.toMatchObject({
      status: 409,
      code: "passkey_limit",
      message: "You added 5 passkeys today. You can add another in about 2 hours.",
      details: { reason: "daily", retryAfter: 7200 },
    });
    vi.stubGlobal("fetch", answer(403, { error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["password"] } } }));
    const refused = await apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect(reauthNeeded(refused as ApiError)).toEqual({ level: 2, have: ["password"] });
    // The server's own wording still stands for every other code.
    vi.stubGlobal("fetch", answer(401, { error: { code: "passkey_invalid", message: "server wording" } }));
    await expect(apiResponse("/api/auth/passkey/signin/verify", { json: {} })).rejects.toMatchObject({ code: "passkey_invalid", message: "server wording", details: undefined });
  });
});

describe("the Security screen's passkeys", () => {
  const view = (extra: Partial<PasskeyView> = {}): PasskeyView => ({
    id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f",
    name: "Laptop",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastUsedAt: null,
    synced: false,
    createdOn: "Chrome on Windows",
    current: false,
    isNew: false,
    suspended: false,
    ...extra,
  });
  const row = (passkey: PasskeyView) => html(<PasskeyItem passkey={passkey} busy={false} onRename={async () => true} onRemove={() => undefined} onNotMine={() => undefined} />);

  test("a row shows the name, when it was added and last used, and the device that added it", () => {
    const out = row(view());
    expect(out).toContain("Laptop");
    expect(out).toContain("added ");
    expect(out).toContain("never used");
    expect(out).toContain("added on Chrome on Windows");
    expect(out).toContain("Rename");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/This wasn(&#x27;|')t me/);
    expect(out).not.toContain('role="img"');
    const gone = row(view({ createdOn: null, lastUsedAt: "2026-09-25T10:00:00.000Z" }));
    expect(gone).toContain("last used ");
    expect(gone).not.toContain("never used");
    expect(gone).not.toContain("added on");
  });

  test("each tag names itself for a screen reader as an image, since ARIA lets no generic element carry a name", () => {
    const out = row(view({ current: true, isNew: true, suspended: true, synced: true }));
    for (const label of [
      "used for this session: it signed you in here",
      "new: added in the last 7 days",
      "suspended: switched off because a copy of it may exist",
      "synced: backed up by your password manager to your other devices",
    ]) {
      const tag = new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`).exec(out)?.[0] ?? "";
      expect(tag, label).toContain('role="img"');
    }
    expect(out).toMatch(/This wasn(&#x27;|')t me/);
  });

  test("the Add dialog labels both fields, prefills the password manager's name with the handle and says what that name reveals", () => {
    const out = html(<AddPasskeyDialog handle="alice" busy={false} error={null} onCreate={noop} onCancel={() => undefined} />);
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/<input[^>]*aria-label="Name"[^>]*>/);
    const label = /<input[^>]*aria-label="Name in your password manager"[^>]*>/.exec(out)?.[0] ?? "";
    expect(label).toContain('value="alice"');
    expect(out).toContain("Your password manager shows this name to anyone who can see this device.");
    expect(out).toContain("Create passkey");
    expect(out).toContain("Cancel");
  });

  test("the screen shows the section, opens the Add dialog from the home card's link, and turns two-factor off without a code", () => {
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain('<Section title="Passkeys">');
    expect(security).toContain('openAdd={add === "1"}');
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain('api("/api/auth/mfa/totp/disable", { json: {} })');
    expect(mfa).not.toMatch(/totp\/disable", \{ json: \{ code/);
    const home = read("app", "index.tsx");
    expect(home).toContain("<PasskeySuggestion");
    expect(home).toContain('router.push("/settings/security?add=1")');
  });

  test("a staff account without two-factor is told what it protects in the app, and that staff tools open only on the console with a staff key", () => {
    // 3a design, section 13, Task 4: two-factor in the app gives no staff power, so the sentence promises none.
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain(
      "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key.",
    );
    expect(mfa).not.toContain("before using staff tools");
  });
});

describe("the re-authentication panel", () => {
  const me: MeResponse = {
    user: { id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f", email: "alice@example.org", role: "user", onboarded: true, mfaEnabled: true, hasPassword: true, passkeys: 1 },
    profile: null,
    standing: null,
  };
  /** The method chips, in order: each is a pressed or unpressed native button. */
  const chips = (out: string): string[] => [...out.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1] ?? "");

  test("offers the recovery code beside the other methods, and the passkey only in a browser that supports it, which Node is not", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 1, have: [] } }} onClose={() => undefined} />);
    expect(chips(out)).toEqual(["Password", "Authenticator code", "Email code", "Recovery code"]);
    expect(out).not.toContain("This change needs two factors");
    const source = read("components", "security", "ReauthPanel.tsx");
    expect(source).toContain('label="Use a passkey"');
    expect(source).toContain('method: "passkey"');
    expect(source).toContain('method: "recovery"');
    expect(source).toContain("me.user.passkeys > 0 && passkeysSupported()");
  });

  test("at level 2 it says why and asks only for what is missing", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["password"] } }} onClose={() => undefined} />);
    expect(out).toContain("This change needs two factors because two-factor authentication is on.");
    expect(chips(out)).toEqual(["Authenticator code", "Recovery code"]);
    const first = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["totp"] } }} onClose={() => undefined} />);
    expect(chips(first)).toEqual(["Password", "Email code"]);
  });

  test("closing the panel never replaces the route, which would mount the screen anew and lose what the action just showed: the hint is a parameter set on the route the screen is on", () => {
    const source = read("components", "security", "ReauthPanel.tsx");
    // A replace builds a route with a new key: the new recovery codes, a setup's QR code and the flow id of a mailed code would go with the old one.
    expect(source).not.toMatch(/router\.(replace|push|navigate)\(/);
    expect(source.match(/router\.setParams\(\{ reenroll: "1" \}\)/g)).toHaveLength(1);
    // Security reads the parameter where it stands and hands it to the two-factor section; Account and Profile show the notice.
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain("useLocalSearchParams<{ reenroll?: string; add?: string }>()");
    expect(security).toContain('reenroll={reenroll === "1"}');
    for (const screen of ["account.tsx", "profile.tsx"]) expect(read("app", "settings", screen), screen).toContain("<ReenrollNotice me={me} />");
  });

  test("on a screen without a two-factor section the hint is a notice with a link to Security, shown when the parameter is set and two-factor is on", () => {
    route.params = { reenroll: "1" };
    const out = html(<ReenrollNotice me={me} />);
    expect(out).toContain(REENROLL_HINT);
    expect(out).toMatch(/<a[^>]*href="\/settings\/security\?reenroll=1"[^>]*>/);
    // One sentence on the three screens: Security's own, which its two-factor section shows.
    expect(REENROLL_HINT).toBe("You used a recovery code. Set up two-factor again to get a fresh set of codes.");
    expect(read("components", "security", "MfaSection.tsx")).toContain(REENROLL_HINT);
    route.params = {};
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    route.params = { reenroll: "0" };
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    // Without two-factor there is nothing to set up again, as on Security.
    route.params = { reenroll: "1" };
    expect(html(<ReenrollNotice me={{ ...me, user: { ...me.user, mfaEnabled: false } }} />)).toBe("");
    route.params = {};
  });

  test("a spent recovery code is remembered for the panel's life: whichever answer carried it, and whether or not the action then went through, the panel closes with the hint", () => {
    const spent = (answers: unknown[]): boolean => answers.map((answer) => ReauthResponse.parse(answer)).reduce(recoveryCodeSpent, false);
    // At level 2 with nothing proved in time: the recovery code first, after which the action is refused again, then the password.
    expect(spent([{ level: 1, mustReenrollMfa: true }, { level: 2 }])).toBe(true);
    // The password first, then the recovery code.
    expect(spent([{ level: 1 }, { level: 2, mustReenrollMfa: true }])).toBe(true);
    // A recovery code, after which the action fails for a reason of its own: the panel stays open with the error and closes by Cancel.
    expect(spent([{ level: 2, mustReenrollMfa: true }])).toBe(true);
    // No recovery code, no hint.
    expect(spent([{ level: 1 }, { level: 2 }])).toBe(false);
    expect(spent([{ level: 2, mustReenrollMfa: false }])).toBe(false);
    expect(spent([])).toBe(false);

    const source = read("components", "security", "ReauthPanel.tsx");
    // Held in a ref, which outlives one answer, and read from every answer before the action runs.
    expect(source).toContain("const recoveryUsed = useRef(false);");
    expect(source).toContain("recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);");
    expect(source.indexOf("recoveryUsed.current = recoveryCodeSpent(")).toBeLessThan(source.indexOf("await pending.action();"));
    // Acted on in one place, which both ways out of the panel go through: the action that went through, and Cancel.
    expect(source).toMatch(/function close\(\) \{\s*onClose\(\);\s*if \(recoveryUsed\.current\) router\.setParams\(\{ reenroll: "1" \}\);\s*\}/);
    expect(source).toContain('<Button label="Cancel" onPress={close} tone="secondary" />');
    expect(source.match(/^\s*close\(\);$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/onPress=\{onClose\}/);
    expect(source.match(/\bonClose\(\)/g)).toHaveLength(1);
  });

  test("the panel follows the refusal it is answering: when another action's refusal replaces the one it shows, it starts over from what that one needs", () => {
    const available: Method[] = ["password", "totp", "email", "recovery"];
    // A level-2 action refused after the password: the two-factor sentence, and second factors only.
    expect(methodsForLevel({ level: 2, have: ["password"] }, available)).toEqual({ methods: ["totp", "recovery"], missing: "second" });
    expect(panelStart({ level: 2, have: ["password"] }, available)).toEqual({ needed: { level: 2, have: ["password"] }, method: "totp", value: "", flowId: null, error: null });
    // "This wasn't me" or "Sign out everywhere" refused while that panel is open: level 1 with nothing proved in time, so
    // every method the account has, the password and the email code among them, and nothing typed, mailed or refused yet.
    expect(methodsForLevel({ level: 1, have: [] }, available)).toEqual({ methods: available, missing: null });
    expect(panelStart({ level: 1, have: [] }, available)).toEqual({ needed: { level: 1, have: [] }, method: "password", value: "", flowId: null, error: null });

    const source = read("components", "security", "ReauthPanel.tsx");
    // The panel is one instance whatever refusal it shows (the screens give it no key), so it compares the refusal it
    // started from with the one it is given, and starts over when they differ.
    expect(source).toContain("const [asked, setAsked] = useState(pending);");
    const reset = /if \(asked !== pending\) \{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const line of ["const next = panelStart(pending.needed, available);", "setAsked(pending);", "setNeeded(next.needed);", "setMethod(next.method);", "setValue(next.value);", "setFlowId(next.flowId);", "setError(next.error);"]) {
      expect(reset, line).toContain(line);
    }
    // The focus moves to the panel for every refusal, not only the first.
    expect(source).toMatch(/\.focus\?\.\(\);\s*\}, \[pending\]\);/);
    for (const screen of ["security.tsx", "account.tsx", "profile.tsx"]) {
      expect(read("app", "settings", screen), screen).toContain("{reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}");
    }
  });
});

describe("the sign-in screen", () => {
  const signin = read("app", "(auth)", "signin.tsx");

  test("the email field carries the autofill pair, and the passkey button sends the response with the device fields the password sign-in sends", () => {
    expect(signin).toContain('const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];');
    expect(signin).toMatch(/<Field label="Email" autoComplete=\{EMAIL_AUTOFILL\}/);
    expect(signin).toContain('label="Sign in with a passkey"');
    expect(signin).toContain('api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse })');
    expect(signin).toContain('router.replace("/mfa")');
  });

  test("one controller owns the conditional request: focus and blur drive it, and unmounting disposes of it", () => {
    expect(signin).toContain("createAutofillScheduler(");
    expect(signin).toContain("useFocusEffect(");
    expect(signin).toMatch(/scheduler\.blur\(\)/);
    expect(signin).toMatch(/scheduler\.dispose\(\)/);
    expect(signin).toMatch(/scheduler\.hold\(\)/);
  });

  test("no screen calls the Signal API, which deletes other accounts' passkeys on Safari", () => {
    expect(findInSource(/signalUnknownCredential|signalAllAcceptedCredentials|signalCurrentUserDetails|sendSignal\(/)).toEqual([]);
  });
});

describe("the pages behind the links", () => {
  /** The opening tag of the button whose text is `label`, or "" when there is none. */
  const buttonTag = (markup: string, label: string): string => {
    const at = markup.indexOf(label);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };
  // The lockdown reaches from the day before its anchor to the moment it runs, which can be a week later: "since", never "in".
  const LOCKDOWN = /passkeys and two-factor authentication set up since the day before/;
  /** A page before the confirmation and after it: the second render starts from the state the confirmation leaves. */
  const sentences = (source: string): string[] => source.replace(/\s+/g, " ").match(/[^.]*set up (?:since|in) the day before[^.;]*/g) ?? [];

  test("the passkey-remove page explains the lockdown, confirms, and offers the button only with the link's token", () => {
    route.params = { token: TOKEN };
    const out = html(<PasskeyRemove />);
    const label = "Remove the passkey and lock down my account";
    expect(out).toContain(label);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(out).toMatch(LOCKDOWN);
    expect(buttonTag(out, label)).not.toBe("");
    expect(buttonTag(out, label)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const bad = html(<PasskeyRemove />);
      expect(bad, token).toContain('role="alert"');
      expect(bad, token).toMatch(/link is incomplete/);
      expect(buttonTag(bad, label), token).toContain('aria-disabled="true"');
    }
    const source = read("app", "passkey-remove", "[token].tsx");
    expect(source).toContain('api("/api/auth/passkeys/remove-link", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });

  test("the not-me and email-undo pages describe the lockdown: every session out, the password removed, and what was set up since the day before", () => {
    route.params = { token: TOKEN };
    for (const [name, page] of [
      ["not-me", <NotMe />],
      ["email-revert", <EmailRevert />],
    ] as const) {
      const out = html(page);
      expect(out, name).toMatch(/sign(s|ed)? out every session/i);
      expect(out, name).toMatch(/remove (your|any) password/i);
      expect(out, name).toMatch(LOCKDOWN);
    }
  });

  test("every explanation of the lockdown names its reach as it is, before the confirmation and after it: what was set up since the day before, the person's own later additions included", () => {
    const anchors = { "passkey-remove": ["PASSKEY_REMOVE_WORDS", "it was added"], "not-me": ["NOT_ME_WORDS", "that sign-in"], "email-revert": ["EMAIL_REVERT_WORDS", "the change"] };
    for (const [page, [words, anchor]] of Object.entries(anchors)) {
      // UI Task 8 (section 1.5): the sentences live in lib/lockdown-words.ts, one block per page, which the page reads.
      const found = sentences(lockdownBlock(words!));
      expect(read("app", page, "[token].tsx"), page).toContain(`${words}.`);
      expect(found, page).toHaveLength(2); // Twice on each page: what confirming will do, and what it did.
      for (const sentence of found) expect(sentence, page).toContain(`passkeys and two-factor authentication set up since the day before ${anchor}`);
    }
    const dialog = sentences(lockdownBlock("NOT_MINE_WORDS")); // The dialog behind "This wasn't me", whose passkey can be a week old by then.
    expect(read("components", "security", "PasskeysSection.tsx")).toContain("NOT_MINE_WORDS.");
    expect(dialog).toHaveLength(1);
    expect(dialog[0]).toContain("every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it");
    // Nowhere does the app say "in the day before", which names one day of what can be eight.
    expect(findInSource(/in the day before/)).toEqual([]);
  });
});

/** UI Task 8: one block of lib/lockdown-words.ts, from its export to its closing brace. */
function lockdownBlock(name: string): string {
  const words = read("lib", "lockdown-words.ts");
  const from = words.indexOf(`export const ${name} = {`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return words.slice(from, words.indexOf(`${String.fromCharCode(10)}};`, from));
}

describe("the terms", () => {
  test("say what a passkey keeps on the server and that nothing about fingerprints or faces leaves the device", () => {
    const body = TERMS_SECTIONS.find((section) => section.title === "Your data")?.body ?? "";
    expect(body).toMatch(/passkey/);
    expect(body).toMatch(/public key/);
    expect(body).toMatch(/the device that added it/);
    expect(body).toMatch(/fingerprint/);
    expect(body).toMatch(/face/);
  });
});
```

### Replace `apps/app/test/shell.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MeResponse } from "@korbat/contracts";
import { ErrorBoundary } from "../src/app/_layout";
import NotFound from "../src/app/+not-found";
import Bookmarks from "../src/app/bookmarks";
import Followers from "../src/app/u/[handle]/followers";
import Following from "../src/app/u/[handle]/following";
import { AboutCard } from "../src/components/AboutCard";
import { AppShell } from "../src/components/AppShell";
import { ToastCard } from "../src/components/ToastCard";
import { toast, Toaster } from "../src/components/toast";
import { pageTitle } from "../src/lib/page-title";
import { createShellScroll, headerOffset, softReset } from "../src/lib/shell-scroll";
import { setComposeButtonShown, toastDuration, toastOffset, TOAST_LIMIT } from "../src/lib/toast-rules";
import { TITLE_WORDS, UI_WORDS } from "../src/lib/ui-words";
import type { LayoutKind } from "../src/theme/layout";

/**
 * The shell, the navigation and what every screen gets from them (UI design, sections 7 and 8.1, Task 3): the nav at each
 * of the four layouts with one current item, the context column, the skip link and the offline banner, the not-found
 * screen and the error boundary, document titles, the toast API over a fake toaster, the header that hides on a phone
 * and the soft reset. Screens are server-rendered as the other test files render theirs; what a static render cannot do
 * (scroll, press) is driven through the pure functions the components use.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** What the component under test reads: the path, the session, the layout and the route's parameters; each test sets them. */
const shell = vi.hoisted(() => ({
  pathname: "/",
  state: { status: "signed-out" } as unknown,
  kind: "phone" as string,
  params: {} as Record<string, string>,
}));

// expo-router cannot load in Node: Link with `asChild` hands its child the href, and its onPress too, as expo-router does,
// so a test can find the handler the shell gives the current Home item. Nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children, onPress }: { href: string; children: ReactElement; onPress?: unknown }) => cloneElement(children, { href, onPress } as object),
  Redirect: () => null,
  Stack: () => null,
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false },
  useLocalSearchParams: () => shell.params,
  usePathname: () => shell.pathname,
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: shell.state, refresh: async () => shell.state }) }));
// A post card's images reach native modules that do not load in Node; no image is drawn here.
vi.mock("expo-image", () => ({ Image: () => null }));
// The layout comes from the window's width, which a static render does not have: the test names the kind.
vi.mock("@/theme/layout", async (importOriginal) => ({ ...(await importOriginal<object>()), useLayout: () => shell.kind }));
// The title goes into the document's head through expo-router/head; here it is drawn in place, so a test can read it.
vi.mock("expo-router/head", () => ({ default: ({ children }: { children: ReactNode }) => createElement("template", { "data-head": "" }, children) }));

/** The fake toaster: sonner's custom toasts and dismissals are recorded, and its Toaster keeps the props it was given. */
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn(), props: [] as Record<string, unknown>[] }));
vi.mock("sonner", async () => {
  const { createElement: element } = await import("react");
  return {
    toast: Object.assign(vi.fn(), { custom: sonner.custom, dismiss: sonner.dismiss }),
    Toaster: (props: Record<string, unknown>) => {
      sonner.props.push(props);
      return element("section", { "data-fake-toaster": "" });
    },
  };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, spaces collapsed. */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The part of the markup inside the first element whose opening tag matches `open`, up to its closing tag of the same name. */
function inside(markup: string, open: RegExp): string {
  const found = open.exec(markup);
  if (!found) return "";
  const tag = /^<([a-z0-9]+)/.exec(found[0])![1]!;
  let depth = 0;
  const pattern = new RegExp(`<(/?)${tag}(?=[ >])[^>]*>`, "g");
  pattern.lastIndex = found.index;
  for (let match = pattern.exec(markup); match; match = pattern.exec(markup)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return markup.slice(found.index, match.index + match[0].length);
  }
  return markup.slice(found.index);
}
/** Every anchor's opening tag. */
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];
const hrefOf = (tag: string): string => /href="([^"]*)"/.exec(tag)?.[1] ?? "";

const ME = { user: { id: "00000000-0000-4000-8000-000000000001", onboarded: true }, profile: { handle: "ada" }, standing: null } as unknown as MeResponse;
const signedIn = () => ({ status: "signed-in", me: ME });

afterEach(() => {
  shell.pathname = "/";
  shell.state = { status: "signed-out" };
  shell.kind = "phone";
  shell.params = {};
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.unstubAllGlobals();
  setComposeButtonShown(false);
});

const KINDS: LayoutKind[] = ["phone", "tablet", "desktop", "wide"];

describe("the navigation (sections 7.1 to 7.3)", () => {
  test("at every layout the nav is a landmark named Main whose items are real anchors, in today's order and hrefs, with one current item", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = signedIn();
      shell.pathname = "/bookmarks";
      const out = html(<AppShell>{null}</AppShell>);
      expect(out, kind).toContain(`data-layout="${kind}"`);
      const nav = inside(out, /<nav\b[^>]*aria-label="Main"[^>]*>/);
      expect(nav, kind).not.toBe("");
      expect(anchors(nav).map(hrefOf), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings"]);
      const current = anchors(nav).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, kind).toHaveLength(1);
      expect(current[0], kind).toContain('href="/bookmarks"');
      // The current item's icon is drawn at the strong stroke, a shape cue beside its colour; the others at the usual one.
      // (Its pill and bar are classes, which a static render does not draw: the browser check measures them.)
      const items = nav.split(/(?=<a\b)/).slice(1);
      expect(items.filter((item) => item.includes('stroke-width="2.25"')).map((item) => hrefOf(item)), kind).toEqual(["/bookmarks"]);
      expect(items.filter((item) => item.includes('stroke-width="1.75"')).map((item) => hrefOf(item)), kind).toEqual(["/", "/u/ada", "/settings"]);
      expect(textOf(nav), kind).toContain(UI_WORDS["nav.bookmarks"]);
    }
  });

  test("signed out the nav holds Home and Sign in; while the session loads it holds Home alone, so Sign in never flashes", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = { status: "signed-out" };
      expect(anchors(inside(html(<AppShell>{null}</AppShell>), /<nav [^>]*>/)).map(hrefOf), kind).toEqual(["/", "/signin", "/settings/appearance"]);
      shell.state = { status: "loading" };
      const loading = inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/);
      expect(anchors(loading).map(hrefOf), kind).toEqual(["/"]);
      expect(textOf(loading), kind).not.toContain(UI_WORDS["nav.signin"]);
    }
  });

  test("Home is current on / only, Settings on every settings page, and the wordmark is the rail's k and the full nav's korbat", () => {
    shell.state = signedIn();
    shell.kind = "wide";
    shell.pathname = "/settings/cases";
    const current = (out: string) => anchors(inside(out, /<nav\b[^>]*>/)).filter((tag) => tag.includes('aria-current="page"')).map(hrefOf);
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/settings"]);
    shell.pathname = "/";
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/"]);
    shell.pathname = "/u/ada/followers";
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/u/ada"]);
    expect(textOf(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).startsWith(UI_WORDS["frame.wordmark"])).toBe(true);
    shell.kind = "tablet";
    expect(textOf(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).startsWith("k ")).toBe(true);
  });

  test("the skip link comes first, says where it goes, and the main column it moves to takes the focus", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      const out = html(<AppShell>{null}</AppShell>);
      const first = anchors(out)[0] ?? "";
      expect(hrefOf(first), kind).toBe("#main");
      expect(textOf(inside(out, /<a\b[^>]*href="#main"[^>]*>/)), kind).toBe(UI_WORDS["shell.skip"]);
      const main = /<main\b[^>]*>/.exec(out)?.[0] ?? "";
      expect(main, kind).toContain('id="main"');
      expect(main, kind).toContain('tabindex="-1"');
      // The skip link, then the nav, then the main column, in that order in the page.
      expect(out.indexOf('href="#main"'), kind).toBeLessThan(out.indexOf("<nav"));
      expect(out.indexOf("<nav"), kind).toBeLessThan(out.indexOf("<main"));
    }
  });

  test("the shell keeps the standing banner and the floating compose button it is given", () => {
    const source = read("components", "AppShell.tsx");
    expect(source).toContain("<StandingBanner standing={state.me.standing} />");
    shell.kind = "phone";
    expect(html(<AppShell floating={<Text>floating control</Text>}>{null}</AppShell>)).toContain("floating control");
  });
});

describe("the context column (section 7.3, decision 14)", () => {
  test("at desktop and wide a complementary landmark, About korbat, holds the handle box and then How korbat works; narrower there is none", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      const out = html(<AppShell>{null}</AppShell>);
      const column = inside(out, /<aside\b[^>]*>|<[a-z]+\b[^>]*role="complementary"[^>]*>/);
      if (kind === "phone" || kind === "tablet") {
        expect(column, kind).toBe("");
        continue;
      }
      expect(column, kind).toContain(`aria-label="${UI_WORDS["shell.about"]}"`);
      const text = textOf(column);
      expect(text.indexOf(UI_WORDS["handle.title"]), kind).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(UI_WORDS["handle.title"]), kind).toBeLessThan(text.indexOf(UI_WORDS["shell.howTitle"]));
      expect(column, kind).toContain(`aria-label="${UI_WORDS["handle.field"]}"`);
      expect(text, kind).not.toContain("Popular now");
    }
  });

  test("How korbat works says the three lines and links the rules, transparency and how Explore works", () => {
    const out = html(<AboutCard />);
    expect(out).toMatch(new RegExp(`<h2[^>]*>${UI_WORDS["shell.howTitle"]}</h2>`));
    const text = textOf(out).replace(/&#x27;/g, "'");
    for (const line of [UI_WORDS["shell.how1"], UI_WORDS["shell.how2"], UI_WORDS["shell.how3"]]) expect(text).toContain(line);
    expect(anchors(out).map(hrefOf)).toEqual(["/rules", "/transparency", "/explore/about"]);
  });

  test("Popular now has left the shell, and nothing calls Explore for it", () => {
    expect(read("components", "AppShell.tsx")).not.toContain("PopularNow");
    expect(read("lib", "social.ts")).not.toContain("popular");
  });
});

describe("offline (section 8.11)", () => {
  test("while the browser says it is offline a polite status at the top of the main column says so; online it says nothing", () => {
    shell.kind = "wide";
    vi.stubGlobal("navigator", { onLine: false });
    const offline = html(<AppShell>{null}</AppShell>);
    const status = inside(offline, /<[a-z]+\b[^>]*role="status"[^>]*>/);
    expect(status).toContain('aria-live="polite"');
    expect(textOf(status)).toBe(UI_WORDS["offline.title"]);
    expect(offline.indexOf("<main")).toBeLessThan(offline.indexOf('role="status"'));
    vi.stubGlobal("navigator", { onLine: true });
    expect(textOf(html(<AppShell>{null}</AppShell>))).not.toContain(UI_WORDS["offline.title"]);
  });
});

describe("the not-found screen and the error boundary (section 8.11)", () => {
  test("a mistyped address shows, inside the shell, that the page does not exist, with Go to Home, under its own title", () => {
    shell.kind = "wide";
    shell.pathname = "/nowhere";
    const out = html(<NotFound />);
    expect(out).toContain("<nav");
    expect(out).toMatch(/<h1[^>]*>This page doesn&#x27;t exist<\/h1>/);
    expect(anchors(inside(out, /<main\b[^>]*>/)).map(hrefOf)).toContain("/");
    expect(textOf(out)).toContain(UI_WORDS["notFound.action"]);
    expect(out).toContain(`<title>${TITLE_WORDS["title.notFound"]}</title>`);
  });

  test("the boundary draws the public frame with its words, Try again and Go to Home, and nothing of the error", () => {
    const retry = vi.fn(async () => undefined);
    const out = html(<ErrorBoundary error={new Error("secret detail of a broken screen")} retry={retry} />);
    expect(out).toContain("<header");
    expect(out).toContain("<main");
    expect(out).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["crash.title"]}</h1>`));
    expect(textOf(out)).toContain(UI_WORDS["crash.body"]);
    expect(textOf(out)).toContain(UI_WORDS["crash.retry"]);
    expect(textOf(out)).toContain(UI_WORDS["notFound.action"]);
    expect(out).not.toContain("secret detail");
    // Nothing about the error leaves the device: the layout sends nothing anywhere.
    expect(read("app", "_layout.tsx")).not.toMatch(/fetch\(|api\(|sendBeacon|console\./);
  });

  test("the root layout puts the gesture root and the safe areas outside, and the one Toaster inside the theme", () => {
    const layout = read("app", "_layout.tsx");
    expect(layout.indexOf("<GestureHandlerRootView")).toBeLessThan(layout.indexOf("<SafeAreaProvider"));
    expect(layout.indexOf("<SafeAreaProvider")).toBeLessThan(layout.indexOf("<ThemeProvider"));
    expect(layout.match(/<Toaster \/>/g)).toHaveLength(1);
    expect(layout.indexOf("<ThemeProvider")).toBeLessThan(layout.indexOf("<Toaster />"));
    expect(layout.indexOf("<Toaster />")).toBeLessThan(layout.indexOf("</ThemeProvider>"));
    expect(layout).toContain("export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)");
  });
});

describe("titles (section 8.1, decision 16)", () => {
  test("every title names a kind of screen, ends with korbat and holds no account", () => {
    for (const [key, title] of Object.entries(TITLE_WORDS)) {
      expect(title, key).toMatch(key === "title.token" ? /^korbat$/ : / - korbat$/); // UI Task 8: a token page is titled korbat alone (8.10).
      expect(title, key).not.toMatch(/@|\{/);
    }
    expect(pageTitle("title.followers")).toBe("Followers - korbat");
  });

  test("the screens this task draws set their titles, and a profile's lists never name the account in theirs", () => {
    shell.kind = "phone";
    shell.state = signedIn();
    shell.params = { handle: "grace" };
    const title = (out: string) => /<title>([^<]*)<\/title>/.exec(out)?.[1];
    expect(title(html(<Bookmarks />))).toBe(TITLE_WORDS["title.bookmarks"]);
    const followers = html(<Followers />);
    expect(title(followers)).toBe(TITLE_WORDS["title.followers"]);
    expect(title(html(<Following />))).toBe(TITLE_WORDS["title.following"]);
    // The account is named in the page, as its h1's neighbour, and not in the tab's title.
    expect(followers).toMatch(new RegExp(`<h1[^>]*>${UI_WORDS["followers.title"]}</h1>`));
    expect(textOf(followers)).toContain("@grace");
  });

  test("the screens that waited outside the shell for the session load inside it, with skeleton rows", () => {
    shell.kind = "phone";
    shell.state = { status: "loading" };
    shell.params = { handle: "grace" };
    for (const [name, out] of [
      ["bookmarks", html(<Bookmarks />)],
      ["followers", html(<Followers />)],
    ] as const) {
      expect(out, name).toContain("<nav");
      expect(textOf(out), name).toContain(name === "bookmarks" ? UI_WORDS["feed.loading"] : UI_WORDS["accounts.loading"]);
      expect(out, name).not.toContain('role="progressbar"');
    }
    for (const file of [["app", "bookmarks.tsx"], ["app", "report.tsx"], ["app", "notice", "[ref].tsx"], ["app", "u", "[handle]", "followers.tsx"], ["app", "u", "[handle]", "following.tsx"]]) {
      expect(read(...file), file.join("/")).not.toContain("<Loading />");
    }
  });
});

describe("toasts (sections 5.4 and 6.16)", () => {
  test("show() hands sonner one custom toast for four seconds, eight with an action and six for a rollback", () => {
    expect(toastDuration({ message: "Link copied" })).toBe(4000);
    expect(toastDuration({ message: "Your reply was sent", action: { label: "View", onPress: () => undefined } })).toBe(8000);
    expect(toastDuration({ message: "Couldn't like this post. Try again.", tone: "rollback" })).toBe(6000);
    sonner.custom.mockClear();
    toast.show({ message: "Link copied" });
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    const [draw, options] = sonner.custom.mock.calls[0] as [(id: string | number) => ReactElement, { duration: number }];
    expect(options.duration).toBe(4000);
    const out = html(draw("t1"));
    expect(textOf(out)).toBe("Link copied");
    expect(out).toContain("lucide-circle-check");
    expect(out).not.toContain('role="button"');
  });

  test("an action is a button that runs and puts the toast away; a rollback carries the error icon", () => {
    sonner.custom.mockClear();
    sonner.dismiss.mockClear();
    const view = vi.fn();
    toast.show({ message: "Your reply was sent", action: { label: "View", onPress: view } });
    const [draw, options] = sonner.custom.mock.calls[0] as [(id: string | number) => ReactElement<{ onAction?: () => void }>, { duration: number }];
    expect(options.duration).toBe(8000);
    const card = draw("t2");
    expect(html(card)).toMatch(/role="button"[^>]*>|<button\b/);
    expect(textOf(html(card))).toBe("Your reply was sent View");
    card.props.onAction?.();
    expect(view).toHaveBeenCalledTimes(1);
    expect(sonner.dismiss).toHaveBeenCalledWith("t2");
    expect(html(<ToastCard message="Couldn't save this post. Try again." tone="rollback" />)).toContain("lucide-circle-alert");
  });

  test("the Toaster keeps three at most at the bottom centre, above the tab bar and the compose button on phones", () => {
    expect(TOAST_LIMIT).toBe(3);
    expect(toastOffset({ layout: "phone", bottomInset: 0, composeButton: false })).toBe(72);
    expect(toastOffset({ layout: "phone", bottomInset: 20, composeButton: true })).toBe(160);
    expect(toastOffset({ layout: "wide", bottomInset: 20, composeButton: true })).toBe(24);
    sonner.props.length = 0;
    shell.kind = "phone";
    html(<Toaster />);
    setComposeButtonShown(true);
    html(<Toaster />);
    shell.kind = "wide";
    html(<Toaster />);
    const [phone, compose, wide] = sonner.props;
    expect(phone).toMatchObject({ position: "bottom-center", visibleToasts: 3, offset: { bottom: 72 }, mobileOffset: { bottom: 72 } });
    expect(compose).toMatchObject({ offset: { bottom: 140 }, mobileOffset: { bottom: 140 } });
    expect(wide).toMatchObject({ offset: { bottom: 24 } });
    expect((phone!.toastOptions as { className?: string }).className ?? "").not.toContain("k-still");
  });

  test("under reduced motion every toast takes k-still, whose rule in the fonts' style element keeps it from moving", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    sonner.props.length = 0;
    html(<Toaster />);
    expect((sonner.props[0]!.toastOptions as { className?: string }).className).toBe("k-still");
    expect(read("theme", "fonts.web.ts")).toContain(".k-still { transform: none !important; transition: opacity 150ms ease !important; }");
  });

  test("on native the same API announces the sentence, with the action's word, to the screen reader", () => {
    const native = read("components", "toast.tsx");
    expect(native).toContain('from "sonner-native"');
    expect(native).toContain("AccessibilityInfo.announceForAccessibility(");
  });
});

describe("the header that hides, and the soft reset (sections 5.2 and 7.1, review ruling 8)", () => {
  test("headerOffset(): down past the header's height hides it, any scroll up shows it, the top always shows it", () => {
    const at = (previousY: number, y: number, offset = 0) => headerOffset({ previousY, y, height: 60, offset });
    expect(at(0, 30)).toBe(0);
    expect(at(30, 90)).toBe(-60);
    expect(at(90, 120, -60)).toBe(-60);
    expect(at(120, 110, -60)).toBe(0);
    expect(at(110, 140, 0)).toBe(-60);
    expect(at(40, 50, 0)).toBe(0);
    expect(at(10, -5, -60)).toBe(0);
    expect(headerOffset({ previousY: 0, y: 500, height: 0, offset: 0 })).toBe(0);
  });

  test("the shell's scroll moves the header only when it changes, only on phones, and never under reduced motion", () => {
    const moves: number[] = [];
    const scrolled: boolean[] = [];
    const store = createShellScroll({ moveHeader: (offset) => moves.push(offset), markScrolled: (value) => scrolled.push(value) });
    store.settings = { hides: true, reduced: false };
    store.setHeight(60);
    for (const y of [20, 80, 120, 100, 160, 0]) store.onScroll(y);
    expect(moves).toEqual([-60, 0, -60, 0]);
    expect(scrolled).toEqual([true, false]);
    // Focus inside the header shows it.
    store.onScroll(200);
    store.show();
    expect(moves.slice(-2)).toEqual([-60, 0]);
    moves.length = 0;
    store.settings = { hides: false, reduced: true };
    for (const y of [20, 300, 600]) store.onScroll(y);
    expect(moves).toEqual([]);
  });

  test("pressing the current Home item again brings the registered list to its newest post, smooth, or at once under reduced motion", () => {
    const store = createShellScroll({ moveHeader: () => undefined, markScrolled: () => undefined });
    const toTop = vi.fn();
    const unregister = store.register({ toTop });
    const event = { preventDefault: vi.fn() };
    softReset(event, store);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(toTop).toHaveBeenLastCalledWith(true);
    store.settings = { hides: false, reduced: true };
    softReset(event, store);
    expect(toTop).toHaveBeenLastCalledWith(false);
    unregister();
    expect(store.toTop()).toBe(false);
    // The shell gives this handler to the current Home item's link, and to no other item.
    const source = read("components", "AppShell.tsx");
    expect(source).toContain("onHomeAgain: (event) => softReset(event, scroll)");
    expect(source).toContain('const again = current && item.href === "/" ? onHomeAgain : undefined;');
  });

  test("the lists hand the shell their scroll and their way to the top, and the three screens title themselves through ScreenHeader", () => {
    const list = read("components", "list", "List.tsx");
    expect(list).toContain("scroll.onScroll(event);");
    expect(list).toContain("scroll.register(");
    for (const file of [["app", "bookmarks.tsx"], ["app", "u", "[handle]", "followers.tsx"], ["app", "u", "[handle]", "following.tsx"]]) {
      expect(read(...file), file.join("/")).toContain("<ScreenHeader");
    }
    const header = read("components", "ScreenHeader.tsx");
    expect(header).toContain('as="h1"');
    expect(header).toContain('variant="display-2"');
    expect(header).toContain('UI_WORDS["shell.back"]');
  });
});
```

### Replace `apps/app/test/terms.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";
import * as contracts from "@korbat/contracts";
import * as rules from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it. 3f: the build's
// contact point for authorities and korbat's Member State, the web build's two arguments of the same kind.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  process.env.EXPO_PUBLIC_CONTACT_POINT = "authorities@korbat.local";
  process.env.EXPO_PUBLIC_HOME_STATE = "DE";
  return "contact@korbat.local";
});
const CONTACT_POINT = "authorities@korbat.local";

import Terms from "../src/app/terms";
import { CONTACT_WORDS, numberWord } from "../src/lib/moderation-words";
import * as terms from "../src/lib/terms";

/**
 * The terms' moderation sections (3c design, sections 9 and 12): what the terms page gains and changes, and the table
 * tests that hold every number and every rule's text the terms print to its constant. A number is held twice: its
 * sentence is in the terms with the constant's value, and with other values in the constants the terms print those and
 * not one of the old ones, so no number is typed. The rulebook, the measures' labels and the outcomes' phrases are held
 * the same way. 3e (design, W.7) adds four sections, "Strikes", "Suspension and termination", "Reporting in bad faith" and
 * "Handles", whose numbers are STANDING_RULES', REPLY_AIM_HOURS', RETENTION.mailGiveUpDays' and APPEAL_MONTHS', and grows
 * RETENTION by three members: two numbers and one phrase, which the terms print as they print a rule's text. 3f (design,
 * W.6) adds "Authorities' orders" and "Contact point for authorities", rewrites "Terrorist content", grows four sections
 * by sentences and RETENTION by four members read from ORDER_RULES, whose two other numbers the terms print are held too.
 * 3d (design, W.9) adds "Automated tools" and "Transparency", whose numbers are AUTOMATION_RULES', changes four sections'
 * sentences, and grows "Your data" by a paragraph and RETENTION's printed list, with RETENTION's three new members, the
 * years of the records to authorities and the reader count's salt (RECIPIENT_RULES.saltHours).
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

type Contracts = typeof contracts;
type Rules = typeof rules;
type TermsModule = typeof terms;
type Section = { title: string; body: string };

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The sections 3c and 3e wrote or rewrote whole; of "Your data" they wrote every paragraph after the first, which older designs wrote. */
const MODERATION_TITLES = ["What you can post", "The rules", "Reports and notices", "How moderators decide", "Automated tools", "Appeals", "Strikes", "Suspension and termination", "Reporting in bad faith", "Handles", "Authorities' orders", "Terrorist content", "Contact point for authorities", "Transparency"];
const bodyOf = (t: TermsModule, title: string): string => t.TERMS_SECTIONS.find((section: Section) => section.title === title)?.body ?? "";
const paragraphsOf = (t: TermsModule, title: string): string[] => t.termsParagraphs(bodyOf(t, title));
/** What 3c added to "Your data". */
const dataParagraphs = (t: TermsModule): string[] => paragraphsOf(t, "Your data").slice(1);
/** The terms' moderation text, section by section: the name of the section each sentence is looked for in, and its text. */
const moderationText = (t: TermsModule): Record<string, string> => ({ ...Object.fromEntries(MODERATION_TITLES.map((title) => [title, bodyOf(t, title)])), "Your data": dataParagraphs(t).join(" ") });

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;
/** A share as the terms print it: half as a word, any other as a percentage. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/**
 * The table of numbers: every number of the constants the terms print, with the section and the sentence it stands in.
 * Built from whatever constants it is given, so the same table reads the terms as they are and the terms as they come out
 * with other numbers in the constants.
 */
function numbersTable(c: Contracts): { constant: string; section: string; phrase: string }[] {
  const { NOTICE_LIMITS: L, RETENTION: R, DAILY_LIMITS: D, STANDING_RULES: S, ORDER_RULES: O, AUTOMATION_RULES: A } = c;
  return [
    { constant: "NOTICE_LIMITS.signedOut.perHour", section: "Reports and notices", phrase: `at most ${L.signedOut.perHour} reports an hour and` },
    { constant: "NOTICE_LIMITS.signedOut.perDay", section: "Reports and notices", phrase: `and ${L.signedOut.perDay} a day from one network without an account` },
    { constant: "NOTICE_LIMITS.signedIn.perHour", section: "Reports and notices", phrase: `and ${L.signedIn.perHour} an hour and` },
    { constant: "NOTICE_LIMITS.signedIn.perDay", section: "Reports and notices", phrase: `${L.signedIn.perDay} a day from one account` },
    { constant: "NOTICE_LIMITS.maxTargets", section: "Reports and notices", phrase: `up to ${numberWord(L.maxTargets)} posts or profiles on korbat` },
    { constant: "NOTICE_LIMITS.explanationMax", section: "Reports and notices", phrase: `up to ${L.explanationMax} characters long` },
    { constant: "NOTICE_LIMITS.citedLawMax", section: "Reports and notices", phrase: `the law or country you cite up to ${L.citedLawMax}` },
    { constant: "CSAM_NOTICE_MAX_ACCOUNTS", section: "Reports and notices", phrase: `one report can name ${count(c.CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most` },
    { constant: "APPEAL_MONTHS", section: "Reports and notices", phrase: `once for a re-examination, within ${count(c.APPEAL_MONTHS, "month")} of being told` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `within ${count(c.APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow` },
    { constant: "DAILY_LIMITS.reexaminations", section: "Reports and notices", phrase: `at most ${count(D.reexaminations, "re-examination")} a day` },
    { constant: "DAILY_LIMITS.appeals", section: "Appeals", phrase: `at most ${count(D.appeals, "appeal")} a day` },
    { constant: "SUSPECT_EARLIER_MONTHS", section: "Your data", phrase: `in the last ${count(c.SUSPECT_EARLIER_MONTHS, "month")}` },
    { constant: "RETENTION.r4FinalMonths", section: "Your data", phrase: `${count(R.r4FinalMonths, "month")} after you were told` },
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `${count(R.intakeDays, "day")} after its last outcome was given and settled` },
    // The same period seen from a decision to take no action: the months of the re-examination's window, and these days.
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `at most about ${count(c.APPEAL_MONTHS + Math.ceil(R.intakeDays / 30), "month")} after a decision to take no action` },
    { constant: "RETENTION.resetValueDays", section: "Appeals", phrase: `for at least ${count(R.resetValueDays, "day")} after a reset that is lifted or ends` },
    { constant: "RETENTION.evidenceHours", section: "Your data", phrase: `when the case closes, or ${count(R.evidenceHours, "hour")} after its newest copy if that is later` },
    { constant: "RETENTION.statementMonths", section: "Your data", phrase: `for ${count(R.statementMonths, "month")} after its deletion` },
    { constant: "RETENTION.accessLogMonths", section: "Your data", phrase: `is kept for ${count(R.accessLogMonths, "month")}` },
    { constant: "RETENTION.contactMonths", section: "Your data", phrase: `deleted ${count(R.contactMonths, "month")} after the last day korbat still owed` },
    { constant: "RETENTION.contactMaxMonths", section: "Your data", phrase: `or ${count(R.contactMaxMonths, "month")} after the report if nothing moved that day` },
    { constant: "RETENTION.confirmationDays", section: "Reports and notices", phrase: `not been confirmed as its sender's in the last ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.confirmationDays", section: "Your data", phrase: `is kept for ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.backupDays", section: "Your data", phrase: `deleted ${count(R.backupDays, "day")} after it was taken` },
    { constant: "RETENTION.draftHours", section: "Your data", phrase: `is deleted after ${count(R.draftHours, "hour")}` },
    { constant: "RETENTION.mailGiveUpDays", section: "Reports and notices", phrase: `could not send for ${count(R.mailGiveUpDays, "day")}` },
    // 3e (W.7): the four sections, each number from the constant the code that acts on it reads.
    { constant: "STANDING_RULES.strikeDays", section: "Strikes", phrase: `It counts for ${count(S.strikeDays, "day")} from its decision.` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Strikes", phrase: `ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `When your account has ${numberWord(S.ladderStrikes)} active strikes at once` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count` },
    ...([0, 1, 2] as const).map((rung) => ({
      constant: `STANDING_RULES.ladderDays.${rung}`,
      section: "Suspension and termination",
      phrase: `for at most ${count(S.ladderDays[0], "day")} the first time, ${numberWord(S.ladderDays[1])} the second and ${numberWord(S.ladderDays[2])} the third`,
    })),
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}` },
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account` },
    { constant: "STANDING_RULES.replyWindowHours", section: "Suspension and termination", phrase: `The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email.` },
    { constant: "STANDING_RULES.undeliveredHours", section: "Suspension and termination", phrase: `the suspension starts ${count(S.undeliveredHours, "hour")} after the decision` },
    { constant: "STANDING_RULES.threatDays", section: "Suspension and termination", phrase: `a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")};` },
    { constant: "STANDING_RULES.terroristDays", section: "Suspension and termination", phrase: `is terrorist content, for up to ${count(S.terroristDays, "day")};` },
    { constant: "STANDING_RULES.floodPosts", section: "Suspension and termination", phrase: `it made ${S.floodPosts} or more posts within` },
    { constant: "STANDING_RULES.floodMinutes", section: "Suspension and termination", phrase: `or more posts within ${count(S.floodMinutes, "minute")}, for up to` },
    { constant: "STANDING_RULES.floodDays", section: "Suspension and termination", phrase: `minutes, for up to ${count(S.floodDays, "day")}; and, as a protective suspension` },
    { constant: "STANDING_RULES.basisAgeDays", section: "Suspension and termination", phrase: `by a decision at most ${count(S.basisAgeDays, "day")} old` },
    { constant: "STANDING_RULES.protectiveDays", section: "Suspension and termination", phrase: `once for each such decision and for up to ${count(S.protectiveDays, "day")}.` },
    { constant: "REPLY_AIM_HOURS", section: "Suspension and termination", phrase: `korbat aims to answer a reply to a suspension taken at once within ${count(c.REPLY_AIM_HOURS, "hour")}.` },
    { constant: "RETENTION.mailGiveUpDays", section: "Suspension and termination", phrase: `cannot send the email for ${count(R.mailGiveUpDays, "day")}, only the app can tell you` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `your ${count(c.APPEAL_MONTHS, "month")} to appeal count again from that answer` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `It is final when the ${count(c.APPEAL_MONTHS, "month")} for your appeal have passed unused` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `the ${count(c.APPEAL_MONTHS, "month")} to appeal it count from that answer` },
    { constant: "STANDING_RULES.reportWarnMarks", section: "Reporting in bad faith", phrase: `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `you sent under the rules within ${count(S.reportFrameDays, "day")} are marked` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `while it counts, which is ${count(S.reportFrameDays, "day")},` },
    { constant: "STANDING_RULES.reportWarnShare", section: "Reporting in bad faith", phrase: `they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time` },
    { constant: "STANDING_RULES.reportRestrictMarks", section: "Reporting in bad faith", phrase: `If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked` },
    { constant: "STANDING_RULES.reportRestrictDays", section: "Reporting in bad faith", phrase: `for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted` },
    // "Your data": what 3e keeps, by RETENTION's three new members (two of them numbers read from STANDING_RULES).
    { constant: "RETENTION.standingRecord.strikeDays", section: "Your data", phrase: `a strike counts for ${count(R.standingRecord.strikeDays, "day")}` },
    { constant: "RETENTION.standingRecord.ladderMemoryDays", section: "Your data", phrase: `a suspension counts toward the next one for ${count(R.standingRecord.ladderMemoryDays, "day")}` },
    { constant: "RETENTION.standingRecord.warningDays", section: "Your data", phrase: `a warning about reporting for ${count(R.standingRecord.warningDays, "day")}` },
    { constant: "RETENTION.reportCountDays", section: "Your data", phrase: `both are deleted after ${count(R.reportCountDays, "day")} and with the account` },
    // 3f (W.6): what a removal order disabled, the records of orders and of authorities, the messages, the gaps, the address.
    { constant: "RETENTION.orderPreserveMonths", section: "Terrorist content", phrase: `with its images and a copy of its text, for ${count(R.orderPreserveMonths, "month")} from the disabling, as the Regulation requires` },
    { constant: "RETENTION.orderPreserveMonths", section: "Terrorist content", phrase: `since korbat erases it after the ${count(R.orderPreserveMonths, "month")} otherwise` },
    { constant: "RETENTION.orderPreserveMonths", section: "Your data", phrase: `content disabled under a removal order is kept ${count(R.orderPreserveMonths, "month")} and ${count(O.preserveMarginDays, "day")} from the disabling` },
    { constant: "ORDER_RULES.preserveMarginDays", section: "Your data", phrase: `is kept ${count(R.orderPreserveMonths, "month")} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `its records of authorities' orders for ${count(R.orderRecordYears, "year")} after the matter's last event, an order's record` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `the records of a notification or a production, are kept ${count(R.orderRecordYears, "year")} after the matter's last event` },
    { constant: "RETENTION.contactMessageDays", section: "Your data", phrase: `and deletes that record ${count(R.contactMessageDays, "day")} after the message was handled` },
    { constant: "RETENTION.contactMessageDays", section: "Your data", phrase: `contact point for authorities is kept ${count(R.contactMessageDays, "day")}, counted from the day the message was handled` },
    { constant: "RETENTION.restoreGapMonths", section: "Your data", phrase: `A gap a restore left is kept ${count(R.restoreGapMonths, "month")} when it was closed as not needed or imported` },
    { constant: "ORDER_RULES.reportHoldDays", section: "Your data", phrase: `and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address` },
    { constant: "ORDER_RULES.reportHoldDays", section: "Your data", phrase: `is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most` },
    // 3d (W.9): a program's limits and its target in "Automated tools", and what the tools and sealed images leave behind.
    { constant: "AUTOMATION_RULES.decisionsPerHour", section: "Automated tools", phrase: `It takes at most ${A.decisionsPerHour} measures an hour and` },
    { constant: "AUTOMATION_RULES.decisionsPerDay", section: "Automated tools", phrase: `measures an hour and ${A.decisionsPerDay} a day under rule R1` },
    { constant: "AUTOMATION_RULES.r2DecisionsPerHour", section: "Automated tools", phrase: `under rule R1, and ${A.r2DecisionsPerHour} and` },
    { constant: "AUTOMATION_RULES.r2DecisionsPerDay", section: "Automated tools", phrase: ` and ${A.r2DecisionsPerDay} under rule R2` },
    { constant: "AUTOMATION_RULES.unansweredMax", section: "Automated tools", phrase: `none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person` },
    { constant: "AUTOMATION_RULES.unansweredHours", section: "Automated tools", phrase: `a request for a person has waited longer than ${A.unansweredHours} hours` },
    { constant: "AUTOMATION_RULES.objectionTargetHours", section: "Automated tools", phrase: `korbat's target is that one answers within ${A.objectionTargetHours} hours` },
    { constant: "RETENTION.matchKeepDays", section: "Your data", phrase: `never your account) for ${count(R.matchKeepDays, "day")} after the case closed` },
    { constant: "RETENTION.matchKeepDays", section: "Your data", phrase: `the record of a match: ${count(R.matchKeepDays, "day")} after its case closed` },
    { constant: "RETENTION.reportHoldDays", section: "Your data", phrase: `korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal` },
    { constant: "RETENTION.reportHoldDays", section: "Your data", phrase: `was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal` },
    { constant: "RETENTION.edgePurgeDays", section: "Your data", phrase: `It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped` },
    { constant: "RETENTION.edgePurgeDays", section: "Your data", phrase: `a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `and for ${count(R.orderRecordYears, "year")} the record of a release` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `as korbat's records to authorities (${count(R.orderRecordYears, "year")})` },
    { constant: "RECIPIENT_RULES.saltHours", section: "Your data", phrase: `and the day's key after ${count(c.RECIPIENT_RULES.saltHours, "hour")}` },
  ];
}

/** The path of every number in a value, as the table names it. */
function numberPaths(name: string, value: unknown): string[] {
  if (typeof value === "number") return [name];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) => numberPaths(`${name}.${key}`, member));
}
/** Every number of the constants the terms must print, by its path. */
const constantPaths = (c: Contracts): string[] => [
  ...numberPaths("NOTICE_LIMITS", c.NOTICE_LIMITS),
  ...numberPaths("CSAM_NOTICE_MAX_ACCOUNTS", c.CSAM_NOTICE_MAX_ACCOUNTS),
  ...numberPaths("SUSPECT_EARLIER_MONTHS", c.SUSPECT_EARLIER_MONTHS),
  ...numberPaths("APPEAL_MONTHS", c.APPEAL_MONTHS),
  ...numberPaths("DAILY_LIMITS", c.DAILY_LIMITS),
  ...numberPaths("RETENTION", c.RETENTION),
  ...numberPaths("STANDING_RULES", c.STANDING_RULES),
  ...numberPaths("REPLY_AIM_HOURS", c.REPLY_AIM_HOURS),
  // 3f: of ORDER_RULES the terms print two numbers by themselves; the others they print through RETENTION, or not at all.
  ...numberPaths("ORDER_RULES.reportHoldDays", c.ORDER_RULES.reportHoldDays),
  ...numberPaths("ORDER_RULES.preserveMarginDays", c.ORDER_RULES.preserveMarginDays),
  // 3d: of AUTOMATION_RULES the terms print a program's six limits and the target of an answer; of RECIPIENT_RULES the salt's hours.
  ...(["decisionsPerHour", "decisionsPerDay", "r2DecisionsPerHour", "r2DecisionsPerDay", "unansweredMax", "unansweredHours", "objectionTargetHours"] as const).flatMap((key) => numberPaths(`AUTOMATION_RULES.${key}`, c.AUTOMATION_RULES[key])),
  ...numberPaths("RECIPIENT_RULES.saltHours", c.RECIPIENT_RULES.saltHours),
];

/** A rule's name inside a sentence: its title without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");
/** A list in a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);
/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");
/** The phrases an answer to a report can read: the seven outcomes, and the three that stand in for them where nobody opened the images. */
const outcomePhrases = (c: Contracts): string[] => [...c.ITEM_OUTCOMES.map((outcome) => c.OUTCOME_PHRASES[outcome]), c.SUSPECT_OUTCOME_PHRASES.sealed, c.SUSPECT_OUTCOME_PHRASES.no_action, c.UNSEEN_NO_ACTION];

/** The sentence of the measures' paragraph that begins with these words, up to its full stop. */
function measuresSentence(t: TermsModule, lead: string): string {
  const paragraph = paragraphsOf(t, "How moderators decide").find((text) => text.includes("korbat's measures are these"));
  if (!paragraph) throw new Error("the terms have no paragraph of measures");
  const from = paragraph.indexOf(lead);
  if (from === -1) throw new Error(`the measures' paragraph has no sentence that begins "${lead}"`);
  return paragraph.slice(from, paragraph.indexOf(".", from) + 1);
}
const LEADS = {
  interim: "While korbat decides a case:",
  final: "When the case is decided:",
  either: "While it decides or when the case is decided:",
  // 3f Task 3: the measure an authority's order alone takes.
  byOrder: "On an authority's order alone, never on korbat's own judgement:",
  lifted: "A later decision can lift each of them again:",
};
/** The labels a sentence of the measures' paragraph quotes, in order. */
const labelsIn = (sentence: string): string[] => [...sentence.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

/** What the tables below hold of the terms, read with the constants and the rulebook they were built from. */
function holds(t: TermsModule, c: Contracts, r: Rules): void {
  const text = moderationText(t);
  // Every number, in its sentence.
  for (const row of numbersTable(c)) expect(text[row.section], `${row.constant}: "${row.phrase}" in ${row.section}`).toContain(row.phrase);
  // Every rule, by its name in "What you can post" and with its number, title and text in "The rules".
  expect(text["What you can post"]).toContain(`(${r.RULES.map(ruleName).join(", ")})`);
  expect(paragraphsOf(t, "The rules").slice(1)).toEqual(r.RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`));
  expect(paragraphsOf(t, "The rules")[0]).toContain(`version ${r.RULES_VERSION} of its rulebook`);
  // The rules only an admin decides, and the one whose content is erased, are named from the rulebook.
  expect(text["How moderators decide"]).toContain(`under ${orList(r.RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id))} or on a report made on the anonymous path`);
  const r4 = r.RULES.find((rule) => rule.id === "R4")!;
  expect(text["Your data"]).toContain(`under rule R4 (${ruleName(r4)})`);
  expect(text["Appeals"]).toContain(`under rule R4 (${ruleName(r4)})`);
  // Every measure's label, in the sentence its two marks put it in; every reversal's in the last one.
  const kinds = { interim: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && !c.MEASURES[kind].final), final: c.MEASURE_KINDS.filter((kind) => !c.MEASURES[kind].interim && c.MEASURES[kind].final), either: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && c.MEASURES[kind].final) };
  for (const group of ["interim", "final", "either"] as const) expect(labelsIn(measuresSentence(t, LEADS[group])), group).toEqual(kinds[group].map((kind) => c.MEASURES[kind].label));
  expect(labelsIn(measuresSentence(t, LEADS.lifted))).toEqual(c.REVERSAL_KINDS.map((kind) => c.MEASURES[kind].label));
  // Every outcome's phrase, each in a paragraph of its own that says what it means.
  const answers = paragraphsOf(t, "Reports and notices").filter((paragraph) => paragraph.startsWith('"'));
  expect(answers.map((paragraph) => paragraph.slice(1, paragraph.indexOf('": ')))).toEqual(outcomePhrases(c).map(quoted));
  for (const paragraph of answers) expect(paragraph.slice(paragraph.indexOf('": ') + 3).length, paragraph).toBeGreaterThan(40);
  // 3e: the scope phrases of an answer that a measure on an account gave, the placeholder's prefix, and a reply's period.
  expect(text["Reports and notices"]).toContain(`the answer adds "${c.ACCOUNT_MEASURE_SCOPE.measure}", or "${c.ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle.`);
  expect(text["Handles"]).toContain(`Your profile then shows a placeholder that begins with ${c.RETIRED_HANDLE_PREFIX},`);
  expect(text["Handles"]).toContain(`Handles that begin with ${c.RETIRED_HANDLE_PREFIX} cannot be chosen.`);
  expect(text["Your data"]).toContain(`The text of a reply to a suspension is kept ${c.RETENTION.replyText}; a reply that is not answered yet is never erased.`);
}

describe("the terms' sections", () => {
  test("are these, in this order, under the draft's version: 3c adds five and rewrites two, 3e adds four after Appeals, 3f two around Terrorist content, without a new version", () => {
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).toEqual([
      "Draft",
      "Who can use korbat",
      "What you can post",
      "The rules",
      "Reports and notices",
      "How moderators decide",
      // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
      "Automated tools",
      "Appeals",
      "Strikes",
      "Suspension and termination",
      "Reporting in bad faith",
      "Handles",
      "Authorities' orders",
      "Terrorist content",
      "Contact point for authorities",
      // 3d (W.9): what korbat publishes.
      "Transparency",
      "Explore",
      "Your account",
      "Your data",
    ]);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
    // Contact is the page's, built from the build's address, and no section of the terms.
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
  });

  test("a section's body is its paragraphs, a blank line between two; none is empty or holds a line break of its own", () => {
    const blank = String.fromCharCode(10, 10);
    for (const section of terms.TERMS_SECTIONS) {
      const paragraphs = terms.termsParagraphs(section.body);
      expect(paragraphs.join(blank), section.title).toBe(section.body);
      for (const paragraph of paragraphs) {
        expect(paragraph.trim(), section.title).toBe(paragraph);
        expect(paragraph.length, section.title).toBeGreaterThan(0);
        expect(paragraph.includes(String.fromCharCode(10)), section.title).toBe(false);
      }
    }
    // The sections older designs wrote are one paragraph each, as they were.
    for (const title of ["Draft", "Who can use korbat", "Explore", "Your account"]) expect(paragraphsOf(terms, title), title).toHaveLength(1);
  });

  test("What you can post says when korbat restricts content: a published rule, each named from the rulebook, or the law and a notice; and that a final restriction can be appealed", () => {
    const names = rules.RULES.map(ruleName).join(", ");
    expect(names).toBe("sexual or pornographic content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, spam, scams, impersonation or coordinated manipulation");
    expect(bodyOf(terms, "What you can post")).toBe(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${names}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
    );
    // The sentence 3c's code made false is gone from every section.
    for (const section of terms.TERMS_SECTIONS) {
      expect(section.body, section.title).not.toContain("Content is removed only when it breaks a published rule");
      expect(section.body, section.title).not.toContain("Every removal names the rule, and you can appeal it");
    }
  });

  test("Terrorist content is the policy the Regulation asks for, in the design's words (3f, W.6), its months from RETENTION", () => {
    expect(paragraphsOf(terms, "Terrorist content")).toEqual([
      "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
      "A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for six months from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.",
      "The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the six months otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.",
    ]);
    // The sentence that waited for korbat to open is gone: 3f carries an order out within the hour.
    expect(bodyOf(terms, "Terrorist content")).not.toContain("once korbat is open to the public");
  });

  test("Your data keeps what it said and gains 3c's paragraphs; the human check is named for a report sent signed out too", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    expect(first).toContain("At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy.");
    expect(first).not.toContain("At sign-in, Cloudflare Turnstile");
    // What 1a to 2c wrote there still stands.
    for (const kept of ["korbat stores your email address for sign-in and security messages", "a device keeps its hash for 30 days after it was last seen", "If you add a passkey, korbat keeps its public key", "you can export your account's data as a ZIP archive and delete your account"]) expect(first, kept).toContain(kept);
    expect(added.length).toBeGreaterThanOrEqual(8);
    const all = added.join(" ");
    for (const said of [
      "When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides.",
      "Deleting the post or your account leaves these copies until their period ends.",
      "they are left out of your account's export and are not released by korbat on its own",
      "so a later reversal cannot bring it back or show it to you again",
      "what korbat erased since included",
      "except a backup that korbat must keep for the authorities, which it keeps until they have answered",
      "never shown to staff or to the person reported",
      "in broad bands, never exact numbers",
      "the person reported never sees either",
      "as a number and a day",
      "Your account's export holds the decisions its Cases screens list and your own reports.",
      "where the law requires it after weighing the writer's rights, the words of a report without who wrote it",
    ]) expect(all, said).toContain(said);
  });

  test("the three sections of the procedure say what the design has them state", () => {
    const said: Record<string, string[]> = {
      "Reports and notices": [
        "Anyone can report a post, an image or a profile on korbat, signed in or not",
        "A report about a profile is decided on its display name and bio",
        "A report about a post that quotes another is decided on that post's own text and images",
        "korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email",
        "a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts",
        "your name and your email are optional",
        "Reports are anonymous towards the person you report",
        "A person looks at every report about something that is on korbat.",
        "A link that names nothing korbat can show is answered automatically, and the answer says so.",
        "never by how many reports an item has, and by who sent them only under the emergency switch",
        // 3d (W.9): the flag, which orders nothing.
        "When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
        "A report is never read after a less severe one, and every report is still read and answered.",
        "gets at most one receipt a day; the others come with the next daily email",
        "korbat sends no report email to an address whose holder asked it to stop",
        "korbat asks another moderator than the one who decided to take it when it has one",
        "says so and can be asked again",
        'this is what "illegality not evident" means',
        "An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told.",
        "For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page.",
      ],
      "How moderators decide": [
        // 3d (W.9): what a program may do until then is in Automated tools.
        "A moderator decides every case; what a program may do until then is in Automated tools.",
        "A moderator never decides about their own accounts or about accounts close to them.",
        "every lifting of a seal, and every correction of such a decision",
        "a moderator and an admin decide without seeing the images, on the report and on what korbat can read",
        "Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed",
        // 3d (review ruling 2, as rulebook version 4 words R2): never an image an automated comparison matched.
        "After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time.",
        "It hides the images from everyone, their author included, from the first seal, and never hides a post's text.",
        "A report of this kind about a post that quotes another opens a case on the quoted post too.",
        "korbat does not put the old value back",
        "korbat restricts the least it can: one image rather than the post, one field rather than the account.",
        "its statement then says that it changed nothing now",
        "comes with a statement of reasons, in the app at once and by email",
        "A decision to take no action is not sent to you, since it would tell you that someone reported you",
        "is recorded without being sent to you, since it can never take effect",
        "Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
      ],
      Appeals: [
        "you can appeal it once, while any of it is in force",
        'choose "Appeal" on the decision\'s screen under Settings, Cases',
        "What korbat does while it decides cannot be appealed.",
        // 3d (W.9).
        "What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
        "a seal ends with an admin's answer to the reports it was taken on",
        "made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case",
        "the appeal waits, without a time limit, and its screen says so",
        "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it.",
        "A decision reversed in full can no longer be appealed, since nothing of it remains.",
        "A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
        "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to.",
        "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // What the code does not do is not said: a decision a correction changed in part is still open to appeal, a report on a
    // rule gets no mail, and a case's copies are not kept a day past the close of a case that took longer than a day.
    expect(bodyOf(terms, "Appeals")).not.toContain("by a correction is final within korbat");
    expect(bodyOf(terms, "Reports and notices")).not.toContain("korbat sends its decisions on reports by email once a day");
    expect(bodyOf(terms, "Your data")).not.toContain("after the case closes");
  });
});

describe("3e's sections and sentences (design, W.7)", () => {
  test("Who can use korbat names what another account may not carry on, and points to the section that says it", () => {
    // 3f's sentence on the Member State follows it (the block below).
    expect(bodyOf(terms, "Who can use korbat").startsWith(
      "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).",
    )).toBe(true);
    expect(bodyOf(terms, "Who can use korbat")).not.toContain("to evade a suspension");
  });

  test("the four sections hold the design's paragraphs and sentences", () => {
    expect(paragraphsOf(terms, "Strikes")).toHaveLength(1);
    expect(paragraphsOf(terms, "Suspension and termination")).toHaveLength(6);
    expect(paragraphsOf(terms, "Reporting in bad faith")).toHaveLength(2);
    expect(paragraphsOf(terms, "Handles")).toHaveLength(1);
    const said: Record<string, string[]> = {
      Strikes: [
        "When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike.",
        "A strike restricts nothing by itself and is used for one thing: counting toward a suspension.",
        "A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding.",
        "so several posts decided in one sitting count as one warning",
        "A strike also counts when the post was already removed or deleted.",
        "your strikes are listed under Settings, Cases",
        "If that suspension was already over, it no longer counts toward a later one.",
      ],
      "Suspension and termination": [
        "A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step.",
        "After three such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides.",
        "Nothing happens automatically: a moderator reads the strikes and decides.",
        "Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.",
        "korbat cannot see whether an email it sent reached you, so keep the address of your account current.",
        "The app shows the start as a date and time.",
        "A reply sent later is read and answered too, and can end the suspension, but does not pause it.",
        "korbat suspends an account at once, before any reply, only in four cases, each decided by an admin",
        "the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted.",
        "Its appeal is reviewed at once and does not wait for the authorities.",
        "An announced suspension never rests on one of these four cases.",
        "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules.",
        "Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts.",
        "Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
        "A second post from before that suspension is no ground for it.",
        "nothing is deleted while your appeal or a reply of yours is unanswered",
        "deleting it ends your appeal, since nothing is left to restore",
        "After the deletion korbat keeps nothing to recognise a new account of yours by",
        "an appeal does not hold a start, only a reply does",
        "korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
      ],
      "Reporting in bad faith": [
        "Report what you believe breaks a rule; a report that turns out wrong costs you nothing.",
        "korbat acts only on reports that are manifestly unfounded",
        "You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination.",
        "a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
        "the count alone decides nothing",
        "Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted.",
        "You can appeal the warning and the restriction.",
      ],
      Handles: [
        "When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it.",
        "A retired handle can be used by nobody again, you included.",
        "you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends.",
        "nobody else could take it meanwhile",
        "also when the breach was someone's private information (rule R4): refusing it needs it.",
      ],
      Appeals: [
        "If a final decision restricts your content or your account, you can appeal it once",
        "An appeal never holds the start of a suspension; a reply does.",
        "The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.",
      ],
      "Reports and notices": [
        "When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long",
        "korbat does not tell you what happens to that account afterwards.",
      ],
      "Your data": [
        "korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use:",
        "To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded;",
        "so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.",
        "while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // No text says more of a mail than korbat knows: it was sent, never delivered or handed over.
    const all = terms.TERMS_SECTIONS.map((section) => section.body).join(" ");
    expect(all).not.toMatch(/delivered|handed to your mail provider/);
    // A protective suspension is never worded as a finding.
    expect(bodyOf(terms, "Suspension and termination")).not.toContain("It breaks");
  });
});

describe("3f's sections and sentences (design, W.6)", () => {
  test("3f's review (people5): the measure only an order takes is shown to nobody, or to nobody but its author when the order does not ask that it be kept from them", () => {
    expect(measuresSentence(terms, LEADS.byOrder)).toBe(
      `${LEADS.byOrder} "${contracts.MEASURES.disable_by_order.label}" (the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it).`,
    );
  });

  test("3f's review (people8): both sentences on the contact point's records say that a message an order came with is kept as long as that order's records", () => {
    const data = paragraphsOf(terms, "Your data").join(" ");
    expect(data).toContain("deletes that record 30 days after the message was handled, or, when an order came with it, with that order's records.");
    expect(data).toContain("is kept 30 days, counted from the day the message was handled, or, when an order came with it, as long as that order's records;");
  });

  test("Authorities' orders holds the design's four paragraphs", () => {
    expect(paragraphsOf(terms, "Authorities' orders")).toEqual([
      "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
      "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
      "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
      "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
    ]);
  });

  test("Contact point for authorities prints the build's address; the languages are left out while the state's entry declares none", () => {
    expect(terms.CONTACT_POINT).toBe(CONTACT_POINT);
    expect(contracts.STATE_FACTS.DE!.languages).toBeNull();
    expect(paragraphsOf(terms, "Contact point for authorities")).toEqual([
      `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784). This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`,
    ]);
  });

  test("Who can use korbat names the build's Member State by its name in STATE_FACTS; What you can post points to Authorities' orders", () => {
    expect(bodyOf(terms, "Who can use korbat")).toBe(
      "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination). korbat is established in Germany and offers its service there only.",
    );
    expect(bodyOf(terms, "What you can post")).toContain("The one restriction that is not korbat's decision is an authority's order (Authorities' orders).");
  });

  test("Appeals says that korbat's appeal does not apply to an order, and when a held answer and a held decision's appeal count from", () => {
    const appeals = paragraphsOf(terms, "Appeals");
    const at = appeals.indexOf(
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
    );
    expect(at).toBeGreaterThan(-1);
    // Before the courts, which stay the section's last word.
    expect(at).toBe(appeals.length - 2);
  });

  test("Your data gains the four paragraphs and the periods of what concerns authorities, before the export's paragraph", () => {
    const data = paragraphsOf(terms, "Your data");
    const added = [
      "Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for seven days at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.",
      "korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for three years after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record 30 days after the message was handled, or, when an order came with it, with that order's records.",
      "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
      "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
      "The periods for what concerns authorities: content disabled under a removal order is kept six months and one day from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept three years after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept 30 days, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept 12 months when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, seven days at most.",
    ];
    const at = data.indexOf(added[0]!);
    expect(at).toBeGreaterThan(0);
    expect(data.slice(at, at + added.length)).toEqual(added);
    expect(data[at + added.length]).toMatch(/^Your account's export holds/);
  });

  describe("with other values of the build's two arguments and of STATE_FACTS", () => {
    /** The terms module as a build with these arguments, and these facts of the states, makes it. */
    async function built(env: { point?: string; state?: string }, facts?: Record<string, unknown>): Promise<TermsModule> {
      const saved = { point: process.env.EXPO_PUBLIC_CONTACT_POINT, state: process.env.EXPO_PUBLIC_HOME_STATE };
      vi.resetModules();
      if (env.point === undefined) delete process.env.EXPO_PUBLIC_CONTACT_POINT;
      else process.env.EXPO_PUBLIC_CONTACT_POINT = env.point;
      if (env.state === undefined) delete process.env.EXPO_PUBLIC_HOME_STATE;
      else process.env.EXPO_PUBLIC_HOME_STATE = env.state;
      if (facts) vi.doMock("@korbat/contracts", async (importOriginal) => ({ ...(await importOriginal<Contracts>()), STATE_FACTS: facts }));
      try {
        return await import("../src/lib/terms");
      } finally {
        vi.doUnmock("@korbat/contracts");
        process.env.EXPO_PUBLIC_CONTACT_POINT = saved.point;
        process.env.EXPO_PUBLIC_HOME_STATE = saved.state;
      }
    }

    test("without them the terms print no contact point and name no state, and every other section stands", async () => {
      const bare = await built({});
      const titles = bare.TERMS_SECTIONS.map((section) => section.title);
      expect(titles).not.toContain("Contact point for authorities");
      expect(titles).toEqual(terms.TERMS_SECTIONS.map((section) => section.title).filter((title) => title !== "Contact point for authorities"));
      expect(bodyOf(bare, "Who can use korbat")).not.toContain("korbat is established in");
      expect(bare.CONTACT_POINT).toBe("");
    });

    test("with the state's languages declared, the contact point names them; a state the contracts do not fill in is named by its code", async () => {
      const declared = await built({ point: CONTACT_POINT, state: "DE" }, { DE: { ...contracts.STATE_FACTS.DE!, languages: ["English", "German"] } });
      expect(bodyOf(declared, "Contact point for authorities")).toContain(`reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784), in English and German. This address is for authorities.`);
      const unknown = await built({ point: CONTACT_POINT, state: "AT" });
      expect(bodyOf(unknown, "Who can use korbat")).toContain("korbat is established in AT and offers its service there only.");
      expect(bodyOf(unknown, "Contact point for authorities")).toContain(`(Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784). This address`);
    });
  });
});

describe("3d's sections and sentences (design, W.9)", () => {
  test("Automated tools holds the design's four paragraphs, its numbers from AUTOMATION_RULES", () => {
    expect(paragraphsOf(terms, "Automated tools")).toEqual([
      "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
      "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
      "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
      `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most 20 measures an hour and 100 a day under rule R1, and 20 and 100 under rule R2, none under a rule while 20 of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than 72 hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within 24 hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
    ]);
  });

  test("Transparency says what korbat publishes, and the one count it keeps to publish it", () => {
    expect(paragraphsOf(terms, "Transparency")).toEqual([
      "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.",
    ]);
  });

  test("Your data: what korbat keeps on a report of child sexual abuse material it also keeps on a match; sealed images are kept for the authorities with no destruction promised and no period named; and a paragraph and RETENTION's list of what the tools leave behind, before 3f's", () => {
    const data = paragraphsOf(terms, "Your data");
    const all = data.join(" ");
    expect(all).toContain("For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post,");
    expect(all).toContain(
      "Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
    );
    const at = data.findIndex((paragraph) => paragraph.startsWith("While a comparison is switched on korbat keeps fingerprints"));
    expect(at).toBeGreaterThan(0);
    expect(data[at + 1]).toMatch(/^The periods for the automated tools and for sealed images: the record of a match: /);
    expect(data[at + 2]).toMatch(/^Two things the law can oblige korbat to keep/);
    for (const said of [
      "It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match.",
      "Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off.",
      "The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off.",
      "The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end,",
    ]) expect(all, said).toContain(said);
  });

  test("the words (section 12.2): no text promises a destruction or names a period for sealed images, none says more of a match than is known, and none says that a program does nothing to an account", () => {
    const all = terms.TERMS_SECTIONS.map((section) => section.body).join(" ");
    for (const banned of ["no longer holds", "destroyed it", "assessed them as illegal", "assessed it as illegal", "is child sexual abuse material", "korbat confirmed", "posted such", "does nothing to your account", "acts on an account", "Whatever it does"]) {
      expect(all.includes(banned), banned).toBe(false);
    }
    // A sentence on destroying sealed images names a leave or an instruction, never a period or an assessment.
    for (const sentence of all.split(/[.][ ]|[.]$|[.](?=[^a-z])/m).filter((part) => /destroy/i.test(part) && /sealed/i.test(part))) expect(sentence, sentence).not.toMatch(/after [0-9]+|within [0-9]+|days|months/);
    // The terms keep their version: 3d's sections are drafts, as 3c's, 3e's and 3f's were.
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("the table tests: the terms' numbers, rules, measures and outcomes are their constants'", () => {
  test("the table of numbers names every number of NOTICE_LIMITS, CSAM_NOTICE_MAX_ACCOUNTS, SUSPECT_EARLIER_MONTHS, APPEAL_MONTHS, DAILY_LIMITS, RETENTION, STANDING_RULES and REPLY_AIM_HOURS, and the two of ORDER_RULES the terms print", () => {
    expect([...new Set(numbersTable(contracts).map((row) => row.constant))].sort()).toEqual(constantPaths(contracts).sort());
  });

  test("the terms print every one of them in its sentence, every rule with its text, every measure's label in the sentence its marks put it in, and every outcome's phrase with what it means", () => {
    holds(terms, contracts, rules);
    // As they stand today, in the words a reader meets.
    const text = moderationText(terms);
    expect(text["Reports and notices"]).toContain("korbat takes at most 5 reports an hour and 20 a day from one network without an account, and 10 an hour and 50 a day from one account.");
    expect(text["Reports and notices"]).toContain("one report can name one profile at most");
    expect(text["Appeals"]).toContain("within six months of being told");
    expect(text["Your data"]).toContain("Each is deleted 30 days after it was taken");
    expect(text["How moderators decide"]).toContain("under R2 or R5 or on a report made on the anonymous path");
    expect(labelsIn(measuresSentence(terms, LEADS.interim))).toEqual(["Withhold the post", "Withhold one image"]);
    expect(labelsIn(measuresSentence(terms, LEADS.final))).toEqual(["Remove", "Remove one image", "Strike", "Suspend the account", "Terminate the account", "Retire the handle", "Warn about reporting", "Restrict reporting"]);
    expect(labelsIn(measuresSentence(terms, LEADS.either))).toEqual(["Seal the images this case reaches", "Reset display name", "Reset bio"]);
    expect(text["Reports and notices"]).toContain('"access restricted: it breaks korbat rule [number] ([title])": ');
    // 3e's numbers as a reader meets them.
    expect(text["Strikes"]).toContain("It counts for 90 days from its decision.");
    expect(text["Suspension and termination"]).toContain("for at most three days the first time, seven the second and 30 the third, counting the suspensions decided in the last 365 days");
    expect(text["Suspension and termination"]).toContain("The suspension starts 168 hours after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for five days, only the app can tell you, and the suspension starts 336 hours after the decision.");
    expect(text["Suspension and termination"]).toContain("it made 20 or more posts within 60 minutes, for up to seven days");
    expect(text["Suspension and termination"]).toContain("korbat aims to answer a reply to a suspension taken at once within 24 hours.");
    expect(text["Reporting in bad faith"]).toContain("If at least five of the reports you sent under the rules within 90 days are marked, and they are at least half of the reports you sent under the rules in that time");
    expect(text["Handles"]).toContain("a placeholder that begins with retired_,");
    expect(text["Your data"]).toContain("a strike counts for 90 days, a suspension counts toward the next one for 365 days, a warning about reporting for 90 days.");
    // 3f's numbers as a reader meets them.
    expect(text["Terrorist content"]).toContain("korbat keeps it, with its images and a copy of its text, for six months from the disabling");
    expect(text["Your data"]).toContain("and for seven days at most, korbat keeps the address");
    expect(text["Your data"]).toContain("A gap a restore left is kept 12 months when it was closed as not needed or imported");
    // 3d's numbers as a reader meets them.
    expect(text["Automated tools"]).toContain(
      "It takes at most 20 measures an hour and 100 a day under rule R1, and 20 and 100 under rule R2, none under a rule while 20 of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than 72 hours.",
    );
    expect(text["Automated tools"]).toContain("korbat's target is that one answers within 24 hours.");
    expect(text["Your data"]).toContain("for 180 days after the case closed, the hold ended or the images were released");
    expect(text["Your data"]).toContain("Your email address after an upload of yours was not accepted: up to seven days from the refusal");
    expect(text["Your data"]).toContain("The record that a cached copy was to be dropped: 30 days after it closed.");
    expect(text["Your data"]).toContain("and the day's key after 26 hours.");
    expect(text["Your data"]).toContain("as korbat's records to authorities (three years).");
  });

  test("the terms name no measure the constants lack and no ban; every kind of the ledger is quoted; and no number but the constants', the emergency switch's 48 hours and the Regulation's own", () => {
    const text = moderationText(terms);
    const all = Object.values(text).join(" ");
    // 3e names strikes, suspensions and retired handles (W.7), 3f an order's preservation (W.6); korbat bans nobody.
    expect(all).toMatch(/preserv/i);
    for (const absent of [/\bban(s|ned)?\b/i]) expect(absent.test(all), String(absent)).toBe(false);
    // The quoted labels are the ledger's 24 kinds (3f adds the order's measure and its reversal) and nothing else.
    const labels = Object.values(LEADS).flatMap((lead) => labelsIn(measuresSentence(terms, lead)));
    expect([...labels].sort()).toEqual(contracts.ACTION_KINDS.map((kind) => contracts.MEASURES[kind].label).sort());
    // Every run of digits outside the rulebook's own texts, a rule's number and the Regulation's articles is a constant's.
    const values = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "number") values.add(String(value));
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect([contracts.NOTICE_LIMITS, contracts.DAILY_LIMITS, contracts.RETENTION, contracts.CSAM_NOTICE_MAX_ACCOUNTS, contracts.SUSPECT_EARLIER_MONTHS, contracts.APPEAL_MONTHS, contracts.STANDING_RULES, contracts.REPLY_AIM_HOURS]);
    collect([contracts.ORDER_RULES.reportHoldDays, contracts.ORDER_RULES.preserveMarginDays]);
    collect([contracts.AUTOMATION_RULES, contracts.RECIPIENT_RULES.saltHours]);
    const outside = Object.entries(text)
      .filter(([title]) => title !== "The rules")
      .map(([, body]) => body)
      .join(" ")
      .replace(/Article [0-9]+ of /g, " ")
      .replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ")
      .replace(/\bR[1-6]\b/g, " ");
    const typed = (outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits));
    // The age of an account under the emergency switch has no constant: the queue's own query holds the same 48 hours.
    // 3f: and the scrutiny's 48 hours, TCO Art. 4(4)'s own period.
    expect(typed).toEqual(["48", "48"]);
    expect(text["Reports and notices"]).toContain("from accounts under 48 hours old");
    expect(text["Terrorist content"]).toContain("within 48 hours of receiving its reasons");
  });

  describe("with other numbers, another rulebook, other labels and other phrases in the constants", () => {
    let changed: { terms: TermsModule; contracts: Contracts; rules: Rules };

    beforeAll(async () => {
      vi.resetModules();
      // Every number of the constants becomes another, each its own and none a number the terms print today.
      let next = 100;
      const renumber = (value: unknown): unknown => {
        if (typeof value === "number") return ++next;
        if (Array.isArray(value)) return value.map(renumber);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, renumber(member)]));
      };
      vi.doMock("@korbat/contracts", async (importOriginal) => {
        const actual = await importOriginal<Contracts>();
        return {
          ...actual,
          NOTICE_LIMITS: renumber(actual.NOTICE_LIMITS),
          DAILY_LIMITS: renumber(actual.DAILY_LIMITS),
          // RETENTION's one phrase is changed too, as a rule's text is.
          RETENTION: { ...(renumber(actual.RETENTION) as object), replyText: "for the period of a reply's text" },
          STANDING_RULES: renumber(actual.STANDING_RULES),
          REPLY_AIM_HOURS: renumber(actual.REPLY_AIM_HOURS),
          // 3f: the two numbers of ORDER_RULES the terms print by themselves (the others through RETENTION).
          ORDER_RULES: renumber(actual.ORDER_RULES),
          // 3d: a program's limits and target, and the reader count's salt (the rest of RECIPIENT_RULES as it is).
          AUTOMATION_RULES: renumber(actual.AUTOMATION_RULES),
          RECIPIENT_RULES: { ...actual.RECIPIENT_RULES, saltHours: renumber(actual.RECIPIENT_RULES.saltHours) },
          ACCOUNT_MEASURE_SCOPE: { retired: "the phrase of a retirement.", measure: "the phrase of an account measure." },
          RETIRED_HANDLE_PREFIX: "gone_",
          APPEAL_MONTHS: renumber(actual.APPEAL_MONTHS),
          CSAM_NOTICE_MAX_ACCOUNTS: renumber(actual.CSAM_NOTICE_MAX_ACCOUNTS),
          SUSPECT_EARLIER_MONTHS: renumber(actual.SUSPECT_EARLIER_MONTHS),
          // Other labels, and a removal that may also be taken while deciding: it moves to the third sentence.
          MEASURES: Object.fromEntries(Object.entries(actual.MEASURES).map(([kind, spec]) => [kind, { ...spec, label: `the label of ${kind}`, ...(kind === "remove" ? { interim: true } : {}) }])),
          OUTCOME_PHRASES: Object.fromEntries(actual.ITEM_OUTCOMES.map((outcome) => [outcome, outcome === "restricted_rule" ? "the phrase of restricted_rule {rule} ({title})" : `the phrase of ${outcome}`])),
          SUSPECT_OUTCOME_PHRASES: { sealed: "the phrase of a seal.", no_action: "the phrase of no action on that path." },
          UNSEEN_NO_ACTION: "the phrase of an answer given unseen.",
        };
      });
      vi.doMock("@korbat/rules", async (importOriginal) => {
        const actual = await importOriginal<Rules>();
        return {
          ...actual,
          RULES_VERSION: 9,
          // Other titles and texts, and a third rule that only an admin decides.
          RULES: actual.RULES.map((rule) => ({ ...rule, title: `No title of ${rule.id}`, text: `The text of ${rule.id}.`, seniorQueue: rule.seniorQueue || rule.id === "R3" })),
        };
      });
      changed = { terms: await import("../src/lib/terms"), contracts: await import("@korbat/contracts"), rules: await import("@korbat/rules") };
      vi.doUnmock("@korbat/contracts");
      vi.doUnmock("@korbat/rules");
    });

    test("the constants the terms were built from are the changed ones", () => {
      expect(changed.contracts.RETENTION.backupDays).not.toBe(contracts.RETENTION.backupDays);
      expect(changed.contracts.STANDING_RULES.strikeDays).not.toBe(contracts.STANDING_RULES.strikeDays);
      expect(changed.contracts.STANDING_RULES.ladderDays).toHaveLength(3);
      expect(changed.contracts.APPEAL_MONTHS).toBeGreaterThan(100);
      expect(changed.contracts.ORDER_RULES.reportHoldDays).toBeGreaterThan(100);
      expect(changed.contracts.AUTOMATION_RULES.decisionsPerHour).toBeGreaterThan(100);
      expect(changed.contracts.RECIPIENT_RULES.saltHours).toBeGreaterThan(100);
      expect(changed.rules.RULES_VERSION).toBe(9);
      expect(changed.terms).not.toBe(terms);
    });

    test("the terms print the changed numbers, rulebook, labels and phrases, each in its place", () => {
      holds(changed.terms, changed.contracts, changed.rules);
      const text = moderationText(changed.terms);
      expect(text["How moderators decide"]).toContain("under R2, R3 or R5 or on a report made on the anonymous path");
      expect(labelsIn(measuresSentence(changed.terms, LEADS.final))).toEqual(["remove_media", "strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting"].map((kind) => `the label of ${kind}`));
      expect(labelsIn(measuresSentence(changed.terms, LEADS.either))).toEqual(["the label of remove", "the label of seal_media", "the label of reset_display_name", "the label of reset_bio"]);
      expect(text["What you can post"]).toContain("(title of R1, title of R2, title of R3, title of R4, title of R5, title of R6)");
    });

    test("and not one of today's: no number, rule title, rule text, label or phrase is typed into the terms", () => {
      const text = moderationText(changed.terms);
      const all = Object.values(text).join(" ");
      for (const row of numbersTable(contracts)) expect(text[row.section]!.includes(row.phrase), `${row.constant}: "${row.phrase}"`).toBe(false);
      for (const rule of rules.RULES) {
        expect(all.includes(rule.text), rule.id).toBe(false);
        expect(all.includes(rule.title), rule.id).toBe(false);
        // A rule's name is also a common word in these sections ("child sexual abuse material"), so it is looked for
        // where the terms list the rules by name, and in brackets, as a sentence names the rule on doxxing.
        expect(text["What you can post"]!.includes(ruleName(rule)), rule.id).toBe(false);
        expect(all.includes(`(${ruleName(rule)})`), rule.id).toBe(false);
      }
      for (const spec of Object.values(contracts.MEASURES)) expect(all.includes(`"${spec.label}"`), spec.label).toBe(false);
      for (const phrase of outcomePhrases(contracts)) expect(all.includes(quoted(phrase)), phrase).toBe(false);
      // 3e: the scope phrases, the placeholder's prefix and a reply's period are the constants', never typed.
      for (const phrase of [contracts.ACCOUNT_MEASURE_SCOPE.measure, contracts.ACCOUNT_MEASURE_SCOPE.retired, contracts.RETIRED_HANDLE_PREFIX, contracts.RETENTION.replyText]) expect(all.includes(phrase), phrase).toBe(false);
      // The only digits left that no changed constant printed are the emergency switch's and the Regulation's.
      const values = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === "number") values.add(String(value));
        else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
      };
      const c = changed.contracts;
      // 3e prints two numbers worked out from a constant: the earlier strikes after a suspension, and the share as a percentage.
      collect([c.NOTICE_LIMITS, c.DAILY_LIMITS, c.RETENTION, c.CSAM_NOTICE_MAX_ACCOUNTS, c.SUSPECT_EARLIER_MONTHS, c.APPEAL_MONTHS, c.APPEAL_MONTHS + Math.ceil(c.RETENTION.intakeDays / 30), changed.rules.RULES_VERSION]);
      collect([c.STANDING_RULES, c.REPLY_AIM_HOURS, c.STANDING_RULES.ladderStrikes - 1, c.STANDING_RULES.reportWarnShare * 100]);
      collect([c.ORDER_RULES.reportHoldDays, c.ORDER_RULES.preserveMarginDays]);
      collect([c.AUTOMATION_RULES, c.RECIPIENT_RULES.saltHours]);
      const outside = all.replace(/Article [0-9]+ of /g, " ").replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ").replace(/\bR[1-6]\b/g, " ");
      expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual(["48", "48"]);
    });
  });
});

describe("the terms page", () => {
  test("3d (design, section 9.1): it links the rules page and the transparency page under its sections, above the report form's link", () => {
    const out = html(<Terms />);
    const rules = out.indexOf('href="/rules"');
    const transparency = out.indexOf('href="/transparency"');
    const reportLink = out.indexOf('href="/report"');
    expect(rules).toBeGreaterThan(out.indexOf(">Contact<"));
    expect(transparency).toBeGreaterThan(rules);
    expect(reportLink).toBeGreaterThan(transparency);
  });

  test("shows every section under its heading and every paragraph of it, then Contact with the build's address and the link to the report form", () => {
    const out = html(<Terms />);
    const text = textOf(out);
    expect(text).toContain(`Version ${terms.TERMS_VERSION}`);
    let at = 0;
    for (const section of terms.TERMS_SECTIONS) {
      // Each heading after the one before it, with its paragraphs behind it in order.
      // A title's apostrophe is written as the markup escapes it (3f: "Authorities' orders").
      const heading = out.indexOf(`>${section.title.replaceAll("'", "&#x27;")}</`, at);
      expect(heading, section.title).toBeGreaterThan(at);
      at = heading;
      let within = textOf(out.slice(heading));
      for (const paragraph of terms.termsParagraphs(section.body)) {
        const found = within.indexOf(textOf(paragraph));
        expect(found, `${section.title}: ${paragraph.slice(0, 60)}`).toBeGreaterThan(-1);
        within = within.slice(found);
      }
    }
    // One level-2 heading for each section, and one for Contact.
    expect(out.split("<h2").length - 1).toBe(terms.TERMS_SECTIONS.length + 1);
    // Every paragraph is an element of its own: a reader gets them apart, not as one block. Its first words stand
    // directly behind an opening tag's end.
    const decoded = out.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">");
    for (const paragraph of terms.TERMS_SECTIONS.flatMap((section) => terms.termsParagraphs(section.body))) {
      const start = paragraph.slice(0, 40);
      expect(decoded.includes(`>${start}`), start).toBe(true);
    }
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text.indexOf("Your account's export holds")).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf(CONTACT_WORDS.report));
    expect(out).toContain('href="/report"');
  });
});

describe("the web build's two arguments for the terms (3f, Task 7): the contact point for authorities and the home state", () => {
  const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the terms read both from the build, and both example files carry the development values: no contact point, the API's state", () => {
    const source = repo("apps", "app", "src", "lib", "terms.ts");
    expect(source).toContain('export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";');
    expect(source).toContain('export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";');
    const infra = repo("infra", ".env.example");
    expect(infra).toMatch(/^WEB_CONTACT_POINT=$/m);
    expect(infra).toMatch(/^WEB_HOME_STATE=DE$/m);
    // The same two values the API holds, which the build cannot read.
    expect(infra).toMatch(/^API_CONTACT_POINT=$/m);
    expect(infra).toMatch(/^API_HOME_STATE=DE$/m);
    const app = repo("apps", "app", ".env.example");
    expect(app).toMatch(/^EXPO_PUBLIC_CONTACT_POINT=$/m);
    expect(app).toMatch(/^EXPO_PUBLIC_HOME_STATE=DE$/m);
  });

  test("the compose service passes both, neither required; the web image checks each when set and passes both to the export", () => {
    const compose = repo("infra", "compose.yml");
    expect(compose).toContain("EXPO_PUBLIC_CONTACT_POINT: ${WEB_CONTACT_POINT:-}");
    expect(compose).toContain("EXPO_PUBLIC_HOME_STATE: ${WEB_HOME_STATE:-}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    for (const line of [
      "ARG EXPO_PUBLIC_CONTACT_POINT=",
      "ARG EXPO_PUBLIC_HOME_STATE=",
      'RUN case "$EXPO_PUBLIC_CONTACT_POINT" in "") ;; *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_POINT build argument must be empty or an email address" >&2; exit 1;; esac',
      `RUN case "$EXPO_PUBLIC_HOME_STATE" in "") ;; [A-Z][A-Z]) ;; *) echo "the EXPO_PUBLIC_HOME_STATE build argument must be empty or a Member State's two-letter code" >&2; exit 1;; esac`,
      'RUN if [ -n "$EXPO_PUBLIC_CONTACT_POINT" ] && [ -z "$EXPO_PUBLIC_HOME_STATE" ]; then echo "EXPO_PUBLIC_CONTACT_POINT needs EXPO_PUBLIC_HOME_STATE: the terms name the state whose authorities write to it" >&2; exit 1; fi',
      'RUN if [ "$KORBAT_ENV" = "production" ] && [ -n "$EXPO_PUBLIC_CONTACT_POINT" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_POINT##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_POINT is a placeholder address; a production build needs the address authorities write to" >&2; exit 1;; esac; fi',
      'EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web',
    ]) {
      expect(dockerfile, line).toContain(line);
      // Each check after KORBAT_ENV is declared and before the export.
      expect(dockerfile.indexOf("ARG KORBAT_ENV"), line).toBeLessThan(dockerfile.indexOf(line));
    }
    expect(dockerfile.indexOf("needs EXPO_PUBLIC_HOME_STATE")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});

// UI Task 8 appends below, so the lines above keep the numbers other tasks cite.
import { UI_WORDS } from "../src/lib/ui-words";
import { sourceFiles } from "./legacy-files";

describe("Your data names what the browser keeps (UI design, section 8.8)", () => {
  test("its first paragraph names every store the app keeps in the browser, when the account's go, and the button that clears them, with no new version", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    // The stores explore.test.tsx holds the source to, each named: the device id (lib/api.ts), the appearance
    // (lib/appearance.ts), the drafts (lib/drafts.ts), the passkey card's Not now (lib/passkeys.ts) and the reading places
    // (lib/reading-place.ts).
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/appearance.ts", "lib/drafts.ts", "lib/passkeys.ts", "lib/reading-place.ts"]);
    for (const named of ["a random device id", "your appearance choices", "where you stopped reading in Following and Latest", "drafts you have not sent", "your Not now on the passkey card"]) {
      expect(first, named).toContain(named);
    }
    expect(first).toContain("until you sign out");
    expect(first).toContain(UI_WORDS["device.clear"]);
    // Beside the device id's sentence, which stays word for word; 3c's paragraphs after it and the version stay.
    expect(first).toContain("Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash.");
    expect(first.indexOf("your appearance choices")).toBeGreaterThan(first.indexOf("a random device id"));
    expect(added.length).toBeGreaterThanOrEqual(8);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/08-settings-security-auth-appearance.md 3
```

Expected: 36 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/app/settings/appearance.tsx`

```tsx
import { Fragment } from "react";
import { Platform, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/kit/Avatar";
import { dataAttribute } from "@/components/kit/interaction";
import { ListRow, RadioGroup } from "@/components/kit/ListRow";
import { Text, textStyle } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { toast } from "@/components/toast";
import { Body, Button, Section, SectionRows } from "@/components/ui";
import { setAppearance, useAppearance, type Appearance } from "@/lib/appearance";
import { useHaptics, type HapticIntent } from "@/lib/haptics";
import { usePageTitle } from "@/lib/page-title";
import { clearSessionTraces } from "@/lib/session-end";
import { useSession } from "@/lib/session";
import { UI_WORDS, type UiWord } from "@/lib/ui-words";
import { THEMES, type ThemeName } from "@/theme/tokens";

/**
 * Appearance and accessibility (UI design, section 8.8; UI Task 8): the one settings page a signed-out reader can open,
 * since its choices belong to this device and not to an account. Every choice is applied at once, with no Save button,
 * through lib/appearance.ts, which keeps it in this browser for theme-boot.js to paint before the next first frame, and
 * in memory on native until sub-project 5. A radio choice (a theme or a segment) plays the selection haptic first (5.3);
 * the switches play none, as ordinary taps play none. The page ends with what korbat keeps on this device and the button
 * that clears it.
 */

type RadioField = "theme" | "darkStyle" | "textStep" | "font" | "reduceMotion";
type SwitchField = "autoLoad" | "openNewest" | "hideCounts";

interface RadioGroupSpec<K extends RadioField> {
  field: K;
  heading: UiWord;
  choices: readonly { value: Appearance[K]; label: UiWord }[];
}

const group = <K extends RadioField>(spec: RadioGroupSpec<K>) => spec;

/** The page's radio groups, in its order; Dark style shows only under System. */
export const APPEARANCE_RADIOS = [
  group({
    field: "theme",
    heading: "appearance.theme",
    choices: [
      { value: "system", label: "appearance.system" },
      { value: "light", label: "appearance.light" },
      { value: "dim", label: "appearance.dim" },
      { value: "dark", label: "appearance.dark" },
    ],
  }),
  group({
    field: "darkStyle",
    heading: "appearance.darkStyle",
    choices: [
      { value: "dim", label: "appearance.dim" },
      { value: "dark", label: "appearance.dark" },
    ],
  }),
  group({
    field: "textStep",
    heading: "appearance.textSize",
    choices: [
      { value: "smaller", label: "appearance.smaller" },
      { value: "default", label: "appearance.default" },
      { value: "larger", label: "appearance.larger" },
      { value: "largest", label: "appearance.largest" },
    ],
  }),
  group({
    field: "font",
    heading: "appearance.font",
    choices: [
      { value: "korbat", label: "appearance.korbatFonts" },
      { value: "system", label: "appearance.systemFont" },
    ],
  }),
  group({
    field: "reduceMotion",
    heading: "appearance.motion",
    choices: [
      { value: "system", label: "appearance.followSystem" },
      { value: "always", label: "appearance.always" },
    ],
  }),
] as const;

/** The Reading switches, off by default (decisions 6, 9 and 15; the owner's ruling 12). */
export const APPEARANCE_SWITCHES: readonly { field: SwitchField; label: UiWord }[] = [
  { field: "autoLoad", label: "appearance.autoLoad" },
  { field: "openNewest", label: "appearance.openNewest" },
  { field: "hideCounts", label: "appearance.hideCounts" },
];

/** Haptics is a switch on iOS and Android only: the web has none to turn off (5.3). */
export function hapticsShown(os: string): boolean {
  return os === "ios" || os === "android";
}

/**
 * One choice of the page, applied at once. `haptic`, given for a radio choice, plays the selection intent first, so the
 * touch lands with the change it answers (5.3).
 */
export function chooseAppearance<K extends keyof Appearance>(field: K, value: Appearance[K], haptic?: (intent: HapticIntent) => void): void {
  haptic?.("selection");
  setAppearance({ [field]: value } as Partial<Appearance>);
}

/**
 * "Clear what this device keeps": the appearance (the theme returns to System), every reading place and every draft, as
 * the session's end clears them (lib/session-end.ts), then the toast that says it is done. The device id and the passkey
 * card's Not now stay: they belong to the browser, not to an account.
 */
export function clearThisDevice(): void {
  clearSessionTraces();
  toast.show({ message: UI_WORDS["toast.cleared"] });
}

/** A theme's swatch: its page with its accent on it; System's is Light's page beside the dark style's. Decoration. */
function Swatch({ theme, darkStyle }: { theme: Appearance["theme"]; darkStyle: ThemeName }) {
  const halves: ThemeName[] = theme === "system" ? ["light", darkStyle] : [theme];
  return (
    <View aria-hidden className="h-7 w-7 flex-row overflow-hidden rounded-full border border-line-high">
      {halves.map((name) => (
        <View key={name} className="flex-1 items-center justify-center" style={{ backgroundColor: THEMES[name].surface }}>
          {theme === "system" ? null : <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: THEMES[name].accent }} />}
        </View>
      ))}
    </View>
  );
}

/** "Aa" in a text size row's own size, or a font row's own face: what the choice looks like, beside its name. Decoration. */
function Glyphs({ step, font }: { step: Appearance["textStep"]; font: Appearance["font"] }) {
  return (
    <View aria-hidden className="w-12 items-center">
      <Text tone="medium" style={textStyle("display-3", { step, font })}>
        {UI_WORDS["appearance.glyphs"]}
      </Text>
    </View>
  );
}

/** The sample post that follows the text size and the font (8.8): a monogram, a name and a body in the post variant. */
function Sample() {
  return (
    <View {...dataAttribute("sample")} className="mt-3 flex-row gap-3 rounded-card border border-line-low bg-surface p-4">
      <Avatar account={{ id: "sample", displayName: UI_WORDS["frame.wordmark"] }} size={40} />
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="body-strong">{UI_WORDS["frame.wordmark"]}</Text>
        <Text variant="post">{UI_WORDS["appearance.sample"]}</Text>
      </View>
    </View>
  );
}

export default function AppearanceSettings() {
  const title = usePageTitle("title.settingsAppearance");
  const appearance = useAppearance();
  const haptic = useHaptics();
  const { state } = useSession();

  /** A group's radio rows: each chooses its value at once, with the selection haptic, and nothing when already chosen. */
  const radios = <K extends RadioField>(spec: RadioGroupSpec<K>, id: string) => (
    <RadioGroup labelledBy={id}>
      {spec.choices.map((choice) => (
        <ListRow
          key={String(choice.value)}
          label={UI_WORDS[choice.label]}
          leading={
            spec.field === "theme" ? (
              <Swatch theme={choice.value as Appearance["theme"]} darkStyle={appearance.darkStyle} />
            ) : spec.field === "textStep" ? (
              <Glyphs step={choice.value as Appearance["textStep"]} font={appearance.font} />
            ) : spec.field === "font" ? (
              <Glyphs step="default" font={choice.value as Appearance["font"]} />
            ) : undefined
          }
          control={{
            kind: "radio",
            checked: appearance[spec.field] === choice.value,
            onSelect: () => {
              if (appearance[spec.field] !== choice.value) chooseAppearance(spec.field, choice.value, haptic);
            },
          }}
        />
      ))}
    </RadioGroup>
  );

  const [theme, darkStyle, textStep, font, motion] = APPEARANCE_RADIOS;
  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["appearance.title"]}>{state.status === "signed-in" ? <SettingsNav current="appearance" /> : null}</ScreenHeader>
      <ScreenScroll screen="appearance">
        <Section title={UI_WORDS[theme.heading]} id="appearance-theme">
          <SectionRows end={appearance.theme !== "system"}>{radios(theme, "appearance-theme")}</SectionRows>
          {appearance.theme === "system" ? (
            <Fragment>
              <Text as="h3" variant="body-strong" tone="medium" nativeID="appearance-dark-style" className="mt-4">
                {UI_WORDS[darkStyle.heading]}
              </Text>
              <SectionRows end>{radios(darkStyle, "appearance-dark-style")}</SectionRows>
            </Fragment>
          ) : null}
        </Section>
        <Section title={UI_WORDS[textStep.heading]} id="appearance-text-size">
          <Sample />
          <SectionRows end>{radios(textStep, "appearance-text-size")}</SectionRows>
        </Section>
        <Section title={UI_WORDS[font.heading]} id="appearance-font">
          <SectionRows end>{radios(font, "appearance-font")}</SectionRows>
        </Section>
        <Section title={UI_WORDS[motion.heading]} id="appearance-motion">
          <SectionRows end={!hapticsShown(Platform.OS)}>{radios(motion, "appearance-motion")}</SectionRows>
          {/* Haptics sits with motion, the other feedback the body feels; reduced motion does not turn it off (5.3). */}
          {hapticsShown(Platform.OS) ? (
            <SectionRows end>
              <ListRow label={UI_WORDS["appearance.haptics"]} control={{ kind: "switch", value: appearance.haptics, onValueChange: (next) => chooseAppearance("haptics", next) }} />
            </SectionRows>
          ) : null}
        </Section>
        <Section title={UI_WORDS["appearance.reading"]}>
          <SectionRows end>
            {APPEARANCE_SWITCHES.map(({ field, label }) => (
              <ListRow key={field} label={UI_WORDS[label]} control={{ kind: "switch", value: appearance[field], onValueChange: (next) => chooseAppearance(field, next) }} />
            ))}
          </SectionRows>
        </Section>
        <Section title={UI_WORDS["device.title"]}>
          <Body>{UI_WORDS["device.body"]}</Body>
          <Button label={UI_WORDS["device.clear"]} onPress={clearThisDevice} tone="secondary" />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}
```

### Create `apps/app/src/app/settings/index.tsx`

```tsx
import { View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { ListRow } from "@/components/kit/ListRow";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { SETTINGS_PAGES } from "@/components/SettingsNav";
import { usePageTitle } from "@/lib/page-title";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * The Settings index (UI design, section 8.8; the owner's ruling 10), which the nav's Settings item and a profile's
 * settings button open: one card of link rows, Appearance first, then Security, Privacy, Profile, Account and Cases,
 * each with its icon and a chevron, so the page a newcomer looks for is the first thing Settings shows. It is the one
 * settings screen without the settings row, since it is the list; signed out the settings layout sends it to sign-in.
 */
export default function SettingsIndex() {
  const title = usePageTitle("title.settingsIndex");
  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.title"]} />
      <ScreenScroll screen="settings">
        {/* The card clips its rows to its corners, and the last row's divider goes under its border: one line closes it. */}
        <View className="mt-4 overflow-hidden rounded-card border border-line-low bg-surface-1">
          <View className="-mb-px">
            {SETTINGS_PAGES.map(({ page, label, icon }) => (
              <ListRow key={page} label={label} icon={icon} href={`/settings/${page}`} />
            ))}
          </View>
        </View>
      </ScreenScroll>
    </AppShell>
  );
}
```

### Create `apps/app/src/lib/auth-words.ts`

```ts
/**
 * The sign-in flow's words (UI design, sections 1.5 and 8.10), word for word as the six screens of app/(auth) had them
 * in their markup; the fields' and buttons' labels stay on the screens, where tests read them. New in UI Task 8: the
 * sign-in screen's heading names the screen, as its tab's title does, since the frame's wordmark already says korbat
 * above it, and the handle step's preview.
 */
export const AUTH_WORDS = {
  signinTitle: "Sign in",
  signinBody: "Enter your email. We'll send a code that signs you in, or creates your account if you don't have one yet.",
  codeTitle: "Check your email",
  codeBody: (email: string) => `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
  codeWait: (seconds: number) => `You can ask for a new code in ${seconds} s.`,
  passwordTitle: "Sign in",
  passwordBody: "Use the password you set in your security settings.",
  mfaTitle: "Two-factor authentication",
  mfaRecovery: "Enter one of your recovery codes. Each code works once; afterwards you'll be asked to set up two-factor again.",
  mfaCode: "Enter the 6-digit code from your authenticator app.",
  ageTitle: "Almost there",
  ageBody: "Your date of birth is checked once and never stored.",
  ageAccept: (version: string) => `I accept the korbat terms (${version}).`,
  refusedTitle: "Sorry",
  refusedBody: "You must be at least 16 to use korbat. No account was created.",
  handleTitle: "Choose your handle",
  handleBody: "Your handle is how people find you: 3 to 20 lowercase letters, numbers or underscores. You can use a pseudonym.",
  /** Above the live preview of the handle in the mono face (8.10), shown once something is typed. */
  handlePreview: "How it will look",
} as const;
```

### Create `apps/app/src/lib/lockdown-words.ts`

```ts
/**
 * The lockdown's words (1c design, sections 7.5 and 7.6; UI design, sections 1.5 and 8.10), word for word as the three
 * token pages and the Security screen's "This wasn't me" dialog had them, in one module: each says what confirming will
 * do and what it did, and names the lockdown's reach as it is, everything set up since the day before its anchor (which
 * can be a week earlier), the person's own later additions included. passkeys.test.tsx reads each block here.
 */

/** What the three pages share: a link that lost part of its token, the way back, and the way in again. */
export const LINK_WORDS = {
  incomplete: "This link is incomplete. Open it again from the email.",
  itWasMe: "It was me, go back",
  signIn: "Sign in",
} as const;

/** /email-revert/[token], from the "email address changed" notice sent to the old address. */
export const EMAIL_REVERT_WORDS = {
  title: "Undo the email change",
  body: "If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before the change.",
  confirm: "Move my account back to this address",
  doneTitle: "Your account is back at this address",
  doneBody:
    "Every session is signed out, including any in this browser. Sign in again with a code sent to this address. Your password was removed, and so were any passkeys and two-factor authentication set up since the day before the change; set them up again from Security.",
};

/** /not-me/[token], from the new-device email. */
export const NOT_ME_WORDS = {
  title: "This wasn't me",
  body: "If you didn't just sign in to korbat on a new device, confirm below. We'll sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before that sign-in, so only someone with your email can get back in.",
  confirm: "Sign out everywhere and lock down my account",
  doneTitle: "Your account is locked down",
  doneBody:
    "Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before that sign-in are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.",
};

/** /passkey-remove/[token], from the "passkey added" notice; it works for 7 days, and still once the passkey is gone. */
export const PASSKEY_REMOVE_WORDS = {
  title: "Remove this passkey",
  body: "If you did not add this passkey to your korbat account, confirm below. We'll remove it, sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before it was added, so only someone with your email can get back in.",
  confirm: "Remove the passkey and lock down my account",
  doneTitle: "Your account is locked down",
  doneBody:
    "The passkey is removed. Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before it was added are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.",
};

/** The Security screen's question behind "This wasn't me" on a new passkey, whose passkey can be a week old by then. */
export const NOT_MINE_WORDS = {
  title: "Lock down your account?",
  body: (name: string) =>
    `If you did not add the passkey named ${name}, confirm below. Every session is signed out, including this browser, your password is removed, and every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it, so only someone with your email can get back in.`,
};
```

### Create `apps/app/src/lib/settings-words.ts`

```ts
/**
 * The words of Settings' Security, Privacy, Profile and Account pages and of components/security (UI design, sections
 * 1.5 and 8.8), word for word as their markup had them, so the screens hold no bare sentence. The labels of fields and
 * buttons, and the notes an action leaves behind, stay on the screens, where tests read them in the source. The
 * lockdown's sentences live in lib/lockdown-words.ts, the sign-in flow's in lib/auth-words.ts. What is new in UI Task 8:
 * the facts of a passkey and of a session are joined by commas instead of middle dots (section 4.1 has no middle-dot
 * meta strings), and the Blocked and Muted tabs' list has a name.
 */

/** U+2026, built in code so this file stays plain ASCII, as the sessions list wrote its loading line. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const SECURITY_WORDS = {
  mfaSetup: "Scan this QR code with an authenticator app, then enter the 6-digit code it shows.",
  mfaKey: "Can't scan it? Enter this key:",
  mfaCodes: "Save these recovery codes somewhere safe. Each works once, and they are the only way back into your account if you lose your authenticator. They won't be shown again.",
  mfaDisable: "Two-factor authentication will be turned off, and your recovery codes stop working. You will be asked to confirm it's you first.",
  passkeysBody: "A passkey signs you in with your fingerprint, face, PIN or a security key, and cannot be phished. You can have up to 10.",
  passkeysLoading: "Loading passkeys...",
  passkeysNone: "You have no passkeys yet.",
  passkeysUnsupported: "This browser cannot add a passkey. Use a recent browser on a device with a screen lock, or a password manager that stores passkeys.",
  passkeyAdded: (date: string) => `added ${date}`,
  passkeyLastUsed: (when: string) => `last used ${when}`,
  passkeyNeverUsed: "never used",
  passkeyAddedOn: (device: string) => `added on ${device}`,
  addTitle: "Add a passkey",
  addBody: "Your browser or password manager will ask you to confirm with your fingerprint, face, PIN or security key.",
  addNameHint: "Optional: what korbat calls this passkey in the list.",
  addLabelHint: "Your password manager shows this name to anyone who can see this device.",
  sessionsLoading: `Loading sessions${ELLIPSIS}`,
  thisDevice: "this device",
  sessionFacts: (platform: string, signedIn: string, lastActive: string) => `${platform}, signed in ${signedIn}, last active ${lastActive}`,
  sessionSignOut: "Sign out",
  platform: { web: "Web", ios: "iPhone or iPad", android: "Android" },
  reauthTitle: "Confirm it's you",
  reauthTwo: "This change needs two factors because two-factor authentication is on. ",
  reauthFresh: "This change needs a fresh confirmation. ",
  reauthSecond: "You confirmed a first factor; add a second one: an authenticator code, a recovery code, or a passkey that checks your fingerprint, face or PIN. ",
  reauthFirst: "You confirmed a second factor; add a first one: your password, an email code or a passkey. ",
  reauthValid: "It stays valid for 5 minutes.",
  reauthPasskey: "Confirm with a passkey of this account. The browser will ask for it.",
} as const;

export const PRIVACY_WORDS = {
  explore: "Explore",
  explain:
    "A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can still read them. A mute only hides an account from your timelines, and they are never told.",
  /** The name of the Blocked and Muted tab list (6.10 requires one). */
  tabs: "Blocked and muted accounts",
  blocked: "Blocked",
  muted: "Muted",
  emptyBlocked: "You have not blocked anyone.",
  emptyMuted: "You have not muted anyone.",
  unblock: "Unblock",
  unmute: "Unmute",
} as const;

export const PROFILE_WORDS = {
  loading: "Loading your profile...",
  formBody: "Your display name is shown next to your posts. The bio is one line on your profile.",
  nextChange: (date: string) => `Your next change is allowed on ${date}.`,
} as const;

export const ACCOUNT_WORDS = {
  emailBody: (email: string) => `Your address is ${email}. Sign-in codes and security messages go there, and nobody else sees it.`,
  emailSent: (email: string) => `We sent a code to ${email}. Enter it to move your account to that address. Every session stays signed in.`,
  badgeBody:
    "The Verified badge means you hold a phone number that no other account uses. To check it, the number is handed to the verification provider for one text message; korbat keeps it only as a keyed hash, never the number itself.",
  badgeHeld: "Your account holds the badge.",
  badgeSent: (phone: string) => `We texted a code to ${phone}.`,
  phoneHint: "International format: a plus sign, the country code and the number, without the leading zero.",
  exportBody:
    "The archive is a ZIP with export.json (your account, profile, posts, likes, reposts, bookmarks, follows, blocks, mutes, sessions, devices and security events) and every image you uploaded. It holds your email address, so keep it somewhere private. You can export once a day.",
  exportNative: "Export your data from the web app.",
  deleteMore: "Your likes, reposts, bookmarks, follows, blocks and mutes are removed too. Your handle stays reserved, so nobody can take it. This cannot be undone.",
  deleteSent: (email: string) => `We emailed a code to ${email}.`,
} as const;
```

### Replace `apps/app/src/app/(auth)/_layout.tsx` (whole file)

```tsx
import { Redirect, Stack, usePathname } from "expo-router";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Screens for people who are not fully signed in. A signed-in account that still needs a handle is
 * sent to /handle; a finished account goes to its feed. While the session loads, the spinner turns inside the frame the
 * screens are drawn in (UI Task 8, 8.10), so the page keeps its wordmark and footer.
 */
export default function AuthLayout() {
  const { state } = useSession();
  const pathname = usePathname();

  if (state.status === "loading") {
    return (
      <PublicFrame>
        <Loading />
      </PublicFrame>
    );
  }
  if (state.status === "signed-in") {
    if (state.me.user.onboarded) return <Redirect href="/" />;
    if (pathname !== "/handle") return <Redirect href="/handle" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Replace `apps/app/src/app/(auth)/age.tsx` (whole file)

```tsx
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";
import { cn } from "@/theme/cn";

const pad = (value: string, length: number) => value.trim().padStart(length, "0");

/**
 * Date of birth (checked once, never stored) and acceptance of the current terms. UI Task 8 (8.10): in PublicFrame, the
 * terms' checkbox on the tokens with its tick drawn, as the report form's.
 */
export default function AgeAndTerms() {
  const { refresh } = useSession();
  const title = usePageTitle("title.age");
  const { flowId } = flow.get();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  if (!flowId && !refused) return <Redirect href="/signin" />;

  const dateOfBirth = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) && year.trim().length === 4 && accepted;

  async function submit() {
    if (busy || !flowId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth, termsVersion: TERMS_VERSION }, schema: SessionResult });
      flow.clear();
      await refresh();
      router.replace("/handle");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "age_requirement") {
        flow.clear();
        setRefused(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (refused) {
    return (
      <PublicFrame>
        {title}
        <Title>{AUTH_WORDS.refusedTitle}</Title>
        <Body>{AUTH_WORDS.refusedBody}</Body>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.ageTitle}</Title>
      <Body>{AUTH_WORDS.ageBody}</Body>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Day" inputMode="numeric" maxLength={2} value={day} onChangeText={setDay} />
        </View>
        <View className="flex-1">
          <Field label="Month" inputMode="numeric" maxLength={2} value={month} onChangeText={setMonth} />
        </View>
        <View className="flex-[1.4]">
          <Field label="Year" inputMode="numeric" maxLength={4} value={year} onChangeText={setYear} />
        </View>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        aria-checked={accepted}
        onPress={() => setAccepted((a) => !a)}
        className={cn("mt-6 min-h-[44px] flex-row items-center gap-3 rounded-control py-1", FOCUS_RING)}
      >
        <View className={cn("h-5 w-5 items-center justify-center rounded-[5px] border-2", accepted ? "border-accent bg-accent" : "border-line-high bg-surface-1")}>
          {/* The tick: two sides of a box turned 45 degrees, in the colour that reads on the accent. */}
          {accepted ? <View className="-mt-0.5 h-2.5 w-1.5 border-b-2 border-r-2 border-on-accent" style={{ transform: [{ rotate: "45deg" }] }} /> : null}
        </View>
        <Text className="flex-1">{AUTH_WORDS.ageAccept(TERMS_VERSION)}</Text>
      </Pressable>
      <TextLink label="Read the terms" href="/terms" />
      <ErrorText message={error} />
      <Button label="Create account" onPress={submit} busy={busy} disabled={!complete} />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/(auth)/code.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Redirect, router } from "expo-router";
import { EmailVerifyResponse } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

const RESEND_AFTER_SECONDS = 60;

/** The emailed code (UI Task 8, 8.10: in PublicFrame, the field in the mono face with one-time-code autofill). */
export default function CodeEntry() {
  const { refresh } = useSession();
  const title = usePageTitle("title.code");
  const { email, flowId } = flow.get();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => setWait((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!flowId || !email) return <Redirect href="/signin" />;

  async function submit() {
    if (busy || !flowId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/email/verify", { json: { flowId, code: code.trim() }, schema: EmailVerifyResponse });
      if (result.result === "signup_required") {
        router.replace("/age");
      } else if (result.result === "mfa_required") {
        flow.set({ mfaTicket: result.mfaTicket });
        router.replace("/mfa");
      } else {
        flow.clear();
        const session = await refresh();
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.codeTitle}</Title>
      <Body>{AUTH_WORDS.codeBody(email)}</Body>
      <Field label="Code" mono autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
      {wait > 0 ? (
        <Body>{AUTH_WORDS.codeWait(wait)}</Body>
      ) : (
        <TextLink label="Send a new code" href="/signin" replace />
      )}
      <TextLink label="Use a different email" href="/signin" replace onPress={() => flow.clear()} />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/(auth)/handle.tsx` (whole file)

```tsx
import { useState } from "react";
import { View } from "react-native";
import { Redirect, router } from "expo-router";
import { OnboardingHandleResponse } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, Loading, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

const HANDLE = /^[a-z0-9_]{3,20}$/;

/**
 * The handle step of sign-up, one step as before (UI Task 8, 8.10): in PublicFrame, with a live preview of the handle in
 * the mono face as it will be sent (the @ dropped, lower case), so the reader sees how it will look; handles are set in
 * that face everywhere, so look-alike handles differ at a glance.
 */
export default function ChooseHandle() {
  const { state, refresh } = useSession();
  const title = usePageTitle("title.handle");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/signin" />;

  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  const valid = HANDLE.test(normalized) && displayName.trim().length > 0;

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/onboarding/handle", { json: { handle: normalized, displayName: displayName.trim() }, schema: OnboardingHandleResponse });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.handleTitle}</Title>
      <Body>{AUTH_WORDS.handleBody}</Body>
      <Field label="Handle" mono autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} />
      {normalized.length > 0 ? (
        <View className="mt-3 gap-1 rounded-control border border-line-low bg-surface-1 px-4 py-3">
          <Text variant="meta" tone="low">
            {AUTH_WORDS.handlePreview}
          </Text>
          <Text variant="mono" className="web:break-all">{`@${normalized}`}</Text>
        </View>
      ) : null}
      <Field label="Display name" maxLength={50} value={displayName} onChangeText={setDisplayName} onSubmitEditing={submit} />
      <ErrorText message={error} />
      <Button label="Finish" onPress={submit} busy={busy} disabled={!valid} />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/(auth)/mfa.tsx` (whole file)

```tsx
import { useState } from "react";
import { Redirect, router } from "expo-router";
import { SessionResult } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextButton, Title } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * The second factor at sign-in: an authenticator code, or one of the saved recovery codes. UI Task 8 (8.10): in
 * PublicFrame, the field in the mono face with one-time-code autofill.
 */
export default function MfaChallenge() {
  const { refresh } = useSession();
  const title = usePageTitle("title.mfa");
  const { mfaTicket } = flow.get();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mfaTicket) return <Redirect href="/signin" />;

  const valid = useRecovery ? /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/i.test(value.trim()) : /^\d{6}$/.test(value.trim());

  async function submit() {
    if (busy || !mfaTicket) return;
    setBusy(true);
    setError(null);
    try {
      const second = useRecovery ? { recoveryCode: value.trim().toLowerCase() } : { code: value.trim() };
      const result = await api("/api/auth/mfa/verify", { json: { mfaTicket, ...second }, schema: SessionResult });
      flow.clear();
      const session = await refresh();
      if (session.status === "signed-in" && !session.me.user.onboarded) router.replace("/handle");
      else router.replace(result.mustReenrollMfa ? "/settings/security?reenroll=1" : "/");
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "too_many_attempts") {
        flow.set({ mfaTicket: undefined });
        router.replace("/signin");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.mfaTitle}</Title>
      <Body>{useRecovery ? AUTH_WORDS.mfaRecovery : AUTH_WORDS.mfaCode}</Body>
      <Field
        label={useRecovery ? "Recovery code" : "Authentication code"}
        mono
        autoCapitalize="none"
        autoComplete="one-time-code"
        inputMode={useRecovery ? "text" : "numeric"}
        maxLength={useRecovery ? 14 : 6}
        placeholder={useRecovery ? "abcd-efgh-ijkl" : undefined}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Button label="Verify" onPress={submit} busy={busy} disabled={!valid} />
      <TextButton
        label={useRecovery ? "Use my authenticator app" : "Use a recovery code"}
        onPress={() => {
          setUseRecovery((r) => !r);
          setValue("");
          setError(null);
        }}
      />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/(auth)/password.tsx` (whole file)

```tsx
import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { SignInResponse } from "@korbat/contracts";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, deviceId, errorMessage, platform } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** Sign-in with a password, for an account that set one (UI Task 8, 8.10: in PublicFrame). */
export default function PasswordSignIn() {
  const { refresh } = useSession();
  const title = usePageTitle("title.password");
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
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.passwordTitle}</Title>
      <Body>{AUTH_WORDS.passwordBody}</Body>
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
    </PublicFrame>
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
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, Field, TextLink, Title } from "@/components/ui";
import { api, ApiError, deviceId, errorMessage, platform } from "@/lib/api";
import { AUTH_WORDS } from "@/lib/auth-words";
import { flow } from "@/lib/flow";
import { usePageTitle } from "@/lib/page-title";
import { abortPasskeyRequest, autofillPasskey, autofillSupported, confirmWithPasskey, createAutofillScheduler, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The browser offers the passkeys it holds in the email field's autofill when the field's autocomplete ends with "webauthn"; React Native's type does not list the pair. */
const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];

type Outcome = "done" | "expired" | "failed";

/**
 * The single entry point: one email field for both sign-up and sign-in, and a passkey where the browser has them. UI
 * Task 8 (8.10): in PublicFrame, with the screen named as its tab is, and "Sign in with a passkey" a secondary button with
 * the passkey icon under the email field.
 */
export default function EmailEntry() {
  const { refresh } = useSession();
  const title = usePageTitle("title.signin");
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
    <PublicFrame>
      {title}
      <Title>{AUTH_WORDS.signinTitle}</Title>
      <Body>{AUTH_WORDS.signinBody}</Body>
      <Field label="Email" autoComplete={EMAIL_AUTOFILL} autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={submit} />
      {passkeys ? <Button label="Sign in with a passkey" icon="passkey" onPress={() => void passkeyButton()} busy={busy} tone="secondary" /> : null}
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
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/email-revert/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { EMAIL_REVERT_WORDS, LINK_WORDS } from "@/lib/lockdown-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "email address changed" notice, which goes to the address the account
 * had. The link is the only credential needed, because an account without a password can no longer
 * sign in at that address. Nothing happens until the person confirms. In PublicFrame since UI Task 8 (8.10), titled
 * korbat alone, so the tab says nothing of what the link does.
 */
export default function EmailRevert() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const title = usePageTitle("title.token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email/revert", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PublicFrame>
        {title}
        <Title>{EMAIL_REVERT_WORDS.doneTitle}</Title>
        <Body>{EMAIL_REVERT_WORDS.doneBody}</Body>
        <Button label={LINK_WORDS.signIn} onPress={() => router.replace("/signin")} />
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{EMAIL_REVERT_WORDS.title}</Title>
      <Body>{EMAIL_REVERT_WORDS.body}</Body>
      <ErrorText message={valid ? error : LINK_WORDS.incomplete} />
      <Button label={EMAIL_REVERT_WORDS.confirm} onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label={LINK_WORDS.itWasMe} href="/" replace />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/not-me/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { LINK_WORDS, NOT_ME_WORDS } from "@/lib/lockdown-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * Opened from the new-device email. Nothing happens until the person confirms. In PublicFrame since UI Task 8 (8.10),
 * titled korbat alone, so the tab says nothing of what the link does.
 */
export default function NotMe() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const title = usePageTitle("title.token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/not-me", { json: { token } });
      setDone(true);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PublicFrame>
        {title}
        <Title>{NOT_ME_WORDS.doneTitle}</Title>
        <Body>{NOT_ME_WORDS.doneBody}</Body>
        <Button label={LINK_WORDS.signIn} onPress={() => router.replace("/signin")} />
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{NOT_ME_WORDS.title}</Title>
      <Body>{NOT_ME_WORDS.body}</Body>
      <ErrorText message={valid ? error : LINK_WORDS.incomplete} />
      <Button label={NOT_ME_WORDS.confirm} onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label={LINK_WORDS.itWasMe} href="/" replace />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/passkey-remove/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Body, Button, ErrorText, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { LINK_WORDS, PASSKEY_REMOVE_WORDS } from "@/lib/lockdown-words";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "passkey added" notice (1c design, section 7.6). The link is the only credential
 * needed; it works for 7 days, and still once the passkey is gone. Nothing happens until the person confirms. In
 * PublicFrame since UI Task 8 (8.10), titled korbat alone, so the tab says nothing of what the link does.
 */
export default function PasskeyRemove() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const title = usePageTitle("title.token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/passkeys/remove-link", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PublicFrame>
        {title}
        <Title>{PASSKEY_REMOVE_WORDS.doneTitle}</Title>
        <Body>{PASSKEY_REMOVE_WORDS.doneBody}</Body>
        <Button label={LINK_WORDS.signIn} onPress={() => router.replace("/signin")} />
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      {title}
      <Title>{PASSKEY_REMOVE_WORDS.title}</Title>
      <Body>{PASSKEY_REMOVE_WORDS.body}</Body>
      <ErrorText message={valid ? error : LINK_WORDS.incomplete} />
      <Button label={PASSKEY_REMOVE_WORDS.confirm} onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label={LINK_WORDS.itWasMe} href="/" replace />
    </PublicFrame>
  );
}
```

### Replace `apps/app/src/app/settings/_layout.tsx` (whole file)

```tsx
import { Redirect, Stack, usePathname } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Settings need a finished account: signed out goes to sign-in, no handle yet goes to onboarding. The one exception is
 * Appearance and accessibility (UI design, section 8.8), whose choices belong to this device and not to an account, so
 * a signed-out reader opens it too, from the nav's Appearance item; the Settings index still sends them to sign-in.
 */
export default function SettingsLayout() {
  const { state } = useSession();
  const pathname = usePathname();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return pathname === "/settings/appearance" ? <Stack screenOptions={{ headerShown: false }} /> : <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### Replace `apps/app/src/app/settings/account.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type RefObject } from "react";
import { Platform, View, type TextInput } from "react-native";
import { router } from "expo-router";
import { ACCOUNT_DELETION_WORDS, BadgeVerifyResponse, DeleteStartResponse, EmailChangeResponse, FlowResponse, type MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { api, ApiError, apiResponse, errorMessage } from "@/lib/api";
import { exportFilename, saveBlob } from "@/lib/download";
import { DELETE_HOLD } from "@/lib/orders";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { ACCOUNT_WORDS } from "@/lib/settings-words";
import { STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS } from "@/lib/ui-words";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/**
 * Expo inlines this public value into the web bundle at export time (WEB_BADGE in infra/.env). The
 * badge routes answer badge_unavailable when the API's verification provider is off, and there is no
 * harmless read to probe that with, so the section is shown only by a build that says "on"; the API's
 * provider is off by default, and so is this.
 */
const BADGE_SHOWN = process.env.EXPO_PUBLIC_BADGE === "on";

const CODE = /^\d{6}$/;

/** One request at a time for a section, through the re-authentication hook, with its busy, error and done texts. */
function useAction(run: Run, describe: (err: unknown) => string = errorMessage) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Enter in a field calls the action as the button does, so the button's busy rule is here too: a second Enter while a request is out sends nothing.
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(action);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, done, setDone, act };
}

/**
 * Moves the focus to `target` when `away` turns false after being true: the section went back to the
 * step `target` is in, and the control that had the focus (Start over, Cancel, Change, Verify, Remove
 * badge) left the tree with the step it was in, which would drop the focus to the page body.
 */
function useFocusOnReturn(away: boolean, target: RefObject<{ focus(): void } | null>) {
  const wasAway = useRef(away);
  useEffect(() => {
    if (!away && wasAway.current) target.current?.focus();
    wasAway.current = away;
  }, [away, target]);
}

/** A new address gets a code; the account moves to it once the code is entered, and every session stays signed in. */
function EmailSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, setError, done, setDone, act } = useAction(run);
  const emailRef = useRef<TextInput>(null);
  // The code field takes the focus itself (autoFocus); Change and Start over bring the address field back, which takes it here.
  useFocusOnReturn(flowId !== null, emailRef);
  // The API would answer a generic invalid_request for the account's own address; it is refused here in its own words instead.
  const current = email.trim().toLowerCase() === me.user.email.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function start() {
    if (email.trim().length === 0) return;
    if (current) {
      setDone(null);
      setError("That is already your email address.");
      return;
    }
    await act(async () => {
      const flow = await api("/api/auth/email/change/start", { json: { email: email.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      const changed = await api("/api/auth/email/change/verify", { json: { flowId, code: code.trim() }, schema: EmailChangeResponse });
      setFlowId(null);
      setEmail("");
      setCode("");
      setDone(`Your email address is now ${changed.email}.`);
      // The address shown here and on the security screen reads the session.
      await refresh();
    });
  }

  return (
    <View>
      <Body>{ACCOUNT_WORDS.emailBody(me.user.email)}</Body>
      {flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.emailSent(email.trim())}</Body>
          <Field label="Code from the email" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Change" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={emailRef} label="New email address" autoComplete="email" autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={() => void start()} />
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={email.trim().length === 0 || current} />
        </>
      )}
    </View>
  );
}

/** The API reuses the email flows' code errors, whose wording points at an email; the badge's code came by text message. */
function badgeMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "invalid_code") return "That code is not right. Check the text message.";
  if (err instanceof ApiError && err.code === "code_expired") return "That code has expired. Send a new one.";
  return errorMessage(err);
}

/** Holding the badge, verifying a number, or removing it; each needs fresh authentication. */
function BadgeSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [phone, setPhone] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { busy, error, done, setDone, act } = useAction(run, badgeMessage);
  const verified = me.profile?.verified === true;
  const phoneRef = useRef<TextInput>(null);
  const removeRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus). Start over and a removed badge bring the phone field back, and a verified
  // badge brings Remove badge: each takes the focus when its step returns.
  useFocusOnReturn(verified || flowId !== null, phoneRef);
  useFocusOnReturn(!verified, removeRef);

  // Enter in the field calls this as the button does, so the button's condition comes first.
  async function start() {
    if (phone.trim().length === 0) return;
    await act(async () => {
      const flow = await api("/api/auth/badge/start", { json: { phone: phone.trim() }, schema: FlowResponse });
      setCode("");
      setFlowId(flow.flowId);
    });
  }

  async function verify() {
    if (!CODE.test(code.trim())) return;
    await act(async () => {
      await api("/api/auth/badge/verify", { json: { flowId, code: code.trim() }, schema: BadgeVerifyResponse });
      setFlowId(null);
      setPhone("");
      setCode("");
      setDone("Your account is now verified.");
      // The chip on posts and the profile, and this section, read the session.
      await refresh();
    });
  }

  const remove = () =>
    act(async () => {
      await api("/api/auth/badge", { method: "DELETE" });
      setDone("The badge was removed.");
      await refresh();
    });

  return (
    <View>
      <Body>{ACCOUNT_WORDS.badgeBody}</Body>
      {verified ? (
        <>
          <Body>{ACCOUNT_WORDS.badgeHeld}</Body>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button ref={removeRef} label="Remove badge" onPress={() => void remove()} busy={busy} tone="danger" />
        </>
      ) : flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.badgeSent(phone.trim())}</Body>
          <Field label="Code from the text message" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={() => void verify()} />
          <ErrorText message={error} />
          <Button label="Verify" onPress={() => void verify()} busy={busy} disabled={!CODE.test(code.trim())} />
          <Button
            label="Start over"
            onPress={() => {
              setFlowId(null);
              setCode("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <Field ref={phoneRef} label="Phone number" autoComplete="tel" inputMode="tel" placeholder="+447911123456" value={phone} onChangeText={setPhone} onSubmitEditing={() => void start()} />
          <Text variant="meta" tone="low" className="mt-1">
            {ACCOUNT_WORDS.phoneHint}
          </Text>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Send code" onPress={() => void start()} busy={busy} disabled={phone.trim().length === 0} />
        </>
      )}
    </View>
  );
}

/** The export's own words for its daily limit: the generic "wait a moment" would be wrong for a window of a day. */
export function exportMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "rate_limited" && err.retryAfter) {
    const hours = Math.ceil(err.retryAfter / 3600);
    return hours <= 1 ? "You exported your data today already. You can export again in about an hour." : `You exported your data today already. You can export again in about ${hours} hours.`;
  }
  return errorMessage(err);
}

/**
 * The ZIP comes back as the response body, so the raw response is turned into a file the browser saves;
 * native has no downloads folder to offer. The API fails the body when the archive breaks off part way,
 * so res.blob() rejects and the section shows an error, never the note that the export was downloaded.
 */
function ExportSection({ run }: { run: Run }) {
  const { busy, error, done, setDone, act } = useAction(run, exportMessage);

  const download = () =>
    act(async () => {
      const res = await apiResponse("/api/account/export", { method: "POST" });
      saveBlob(await res.blob(), exportFilename(res.headers.get("content-disposition")));
      setDone("Your export was downloaded.");
    });

  return (
    <View>
      <Body>{ACCOUNT_WORDS.exportBody}</Body>
      {Platform.OS === "web" ? (
        <>
          <ErrorText message={error} />
          <Notice message={done} />
          <Button label="Download my data" onPress={() => void download()} busy={busy} />
        </>
      ) : (
        <Body>{ACCOUNT_WORDS.exportNative}</Body>
      )}
    </View>
  );
}

/** Deletion needs an emailed code and the handle typed back; the API takes the account down at once and this session with it. */
function DeleteSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const { busy, error, act } = useAction(run);
  const handle = me.profile?.handle ?? "";
  const typedHandle = typed.trim().replace(/^@/, "").toLowerCase();
  // The API compares the typed handle case-insensitively and answers a mismatch as a generic invalid request; the same rule here keeps the button off until it matches.
  const matches = typedHandle.length > 0 && typedHandle === handle.toLowerCase();
  const sendRef = useRef<View>(null);
  // The code field takes the focus itself (autoFocus); Cancel brings "Send me a code" back, which takes it here.
  useFocusOnReturn(flowId !== null, sendRef);

  const start = () =>
    act(async () => {
      const flow = await api("/api/account/delete/start", { method: "POST", schema: DeleteStartResponse });
      setCode("");
      setTyped("");
      setFlowId(flow.flowId);
    });

  // The button's condition comes first, as in every other action of this screen.
  async function confirm() {
    if (!CODE.test(code.trim()) || !matches) return;
    await act(async () => {
      await api("/api/account/delete/confirm", { json: { flowId, code: code.trim(), handle: typedHandle } });
      // The API cleared the cookies: the session reloads as signed out, and the home page is public.
      await refresh();
      router.replace("/");
    });
  }

  return (
    <View>
      <Body>
        {ACCOUNT_DELETION_WORDS} {ACCOUNT_WORDS.deleteMore}
      </Body>
      {/* 3f Task 5 ([delete.hold]): what the law can oblige korbat to keep for a time, said to every account beforehand. */}
      <Body>{DELETE_HOLD}</Body>
      {flowId ? (
        <>
          <Body>{ACCOUNT_WORDS.deleteSent(me.user.email)}</Body>
          <Field label="Code from the email" mono autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} />
          <Field label="Type your handle to confirm" autoCapitalize="none" autoComplete="off" placeholder={`@${handle}`} value={typed} onChangeText={setTyped} />
          <ErrorText message={error} />
          <Button label="Delete my account" onPress={() => void confirm()} busy={busy} disabled={!CODE.test(code.trim()) || !matches} tone="danger" />
          <Button
            label="Cancel"
            onPress={() => {
              setFlowId(null);
              setCode("");
              setTyped("");
            }}
            tone="secondary"
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button ref={sendRef} label="Send me a code" onPress={() => void start()} busy={busy} tone="secondary" />
        </>
      )}
    </View>
  );
}

/**
 * Settings, Account (1b, 3e and 3f designs; UI design, section 8.8): the email address, the Verified badge where the
 * build offers it, the data export and the account's deletion. UI Task 8 keeps its sections, words and flows on the
 * tokens: the title and the settings row in ScreenHeader, the handle in the mono face under it, each section a card of
 * fields on ScreenScroll, and the codes in the mono face.
 */
export default function AccountSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsAccount");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.account"]}>
        <SettingsNav current="account" />
      </ScreenHeader>
      <ScreenScroll screen="account">
        <Text variant="mono" tone="medium" className="mt-2">{`@${me.profile?.handle ?? ""}`}</Text>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed an action here: the screen stays, with the field for the code it mailed, and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Email address">
          <EmailSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        {BADGE_SHOWN ? (
          <Section title="Verified badge">
            <BadgeSection me={me} run={reauth.run} refresh={refresh} />
          </Section>
        ) : null}
        <Section title="Data export">
          <ExportSection run={reauth.run} />
        </Section>
        <Section title="Delete account">
          {/* 3e Task 4 (design, section 9.2): [terminate.delete], while /me carries a termination. */}
          {me.standing?.measure?.kind === "terminate" ? <Body>{STANDING_TEXTS.terminateDelete}</Body> : null}
          <DeleteSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/privacy.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { ListRow, switchColours } from "@/components/kit/ListRow";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SettingsNav } from "@/components/SettingsNav";
import { ProfileList } from "@/components/social/ProfileList";
import { buttonFace, ErrorText, LABEL_TONE, Section, SectionRows } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { exploreSwitchText } from "@/lib/explore";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { PRIVACY_WORDS } from "@/lib/settings-words";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { useTheme } from "@/theme/ThemeProvider";

type Tab = "blocked" | "muted";

/** The panel the Blocked and Muted tabs control (section 6.10). */
const PANEL = "privacy-panel";

/** "Show my posts in Explore" as useExploreSwitch holds it and ExploreSwitch shows it. */
export interface ExploreSwitchState {
  on: boolean;
  busy: boolean;
  error: string | null;
  change: (next: boolean) => Promise<void>;
}

/**
 * "Show my posts in Explore" (2c design, section 11), on by default: its state and its save. Its state is /api/me's. A
 * change shows at once while it is saved (POST turns it on, DELETE off, as the app's other switches), the switch is
 * disabled until the save and the session's refresh are done, and a failed save puts it back with the error. Privacy
 * calls it, above the list whose header shows the switch: the Blocked and Muted tabs remount that list, and a remount
 * must not lose a save in progress or its error.
 */
export function useExploreSwitch(): ExploreSwitchState {
  const { state, refresh } = useSession();
  // The settings layout lets in only an account with a profile; the type still allows none.
  const stored = state.status === "signed-in" ? (state.me.profile?.showInExplore ?? true) : true;
  const [on, setOn] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Follows the session when it changes: after a save here, or a refresh from elsewhere.
  useEffect(() => setOn(stored), [stored]);

  async function change(next: boolean) {
    if (busy) return;
    const before = on;
    setBusy(true);
    setError(null);
    setOn(next);
    try {
      const answer = await social.setShowInExplore(next);
      setOn(answer.showInExplore);
      // /api/me carries the switch, so the session follows the saved state. A failed refresh shows its own screen, so what
      // the catch below sees is a failed save.
      await refresh();
    } catch (err) {
      setOn(before);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { on, busy, error, change };
}

/**
 * The switch, its sentence, the way to the rules and a failed save's error, showing what useExploreSwitch holds. UI Task 8
 * (8.8): a card of two rows, the switch row (its own Switch, whose line explore.test.tsx reads, with the theme's track,
 * the row's flip for a pointer and its focus ring) with the sentence under its label, and a link row to How Explore works.
 */
export function ExploreSwitch({ on, busy, error, change }: ExploreSwitchState) {
  const { colors } = useTheme();
  return (
    <Section title={PRIVACY_WORDS.explore}>
      <SectionRows end={error === null}>
        <ListRow
          label="Show my posts in Explore"
          description={exploreSwitchText()}
          control={{
            kind: "switch",
            value: on,
            disabled: busy,
            onValueChange: (next) => void change(next),
            element: (
              // react-native-web renders a checkbox with the switch role, named by this label and checked while it is on.
              <Switch accessibilityLabel="Show my posts in Explore" value={on} disabled={busy} onValueChange={(next) => void change(next)} {...switchColours(colors)} />
            ),
          }}
        />
        <ListRow label={UI_WORDS["shell.exploreLink"]} icon="explore" href="/explore/about" />
      </SectionRows>
      <ErrorText message={error} />
    </Section>
  );
}

/** Unblock or Unmute beside an account: a secondary button with its own busy state and, below it, a failed undo's error. */
function UndoButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        aria-busy={busy}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError(null);
          onPress()
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
        className={buttonFace({ face: busy ? "inactive" : "secondary", size: "md" })}
      >
        <Text variant="body-strong" tone={LABEL_TONE[busy ? "inactive" : "secondary"]}>
          {label}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="mt-1">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Whether your posts show in Explore, then blocked and muted accounts with one-tap undo. This is the only place a block
 * can be lifted. UI Task 8 (8.8): the title and the settings row in ScreenHeader; the Explore card, the sentence on what
 * a block and a mute do, and the Blocked and Muted tabs (the kit's Tabs: one tab stop, the arrows choose) head the list,
 * which is their tab panel, as a profile's tabs head its posts.
 */
export default function Privacy() {
  const [tab, setTab] = useState<Tab>("blocked");
  const title = usePageTitle("title.settingsPrivacy");
  // Here, not in the list's header, which the tab's key remounts: a save in progress and its error outlive a tab change.
  const explore = useExploreSwitch();
  const fetchBlocks = useCallback((cursor?: string) => social.myBlocks(cursor), []);
  const fetchMutes = useCallback((cursor?: string) => social.myMutes(cursor), []);

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.privacy"]}>
        <SettingsNav current="privacy" />
      </ScreenHeader>
      <TabPanel panelId={PANEL} selected={tab}>
        <ProfileList
          key={tab}
          fetchPage={tab === "blocked" ? fetchBlocks : fetchMutes}
          empty={tab === "blocked" ? PRIVACY_WORDS.emptyBlocked : PRIVACY_WORDS.emptyMuted}
          header={
            <View className="border-b border-line-low px-4 pb-1">
              <ExploreSwitch {...explore} />
              <Text tone="medium" className="mt-6">
                {PRIVACY_WORDS.explain}
              </Text>
              <View className="mt-3">
                <Tabs
                  label={PRIVACY_WORDS.tabs}
                  tabs={[
                    { key: "blocked", label: PRIVACY_WORDS.blocked },
                    { key: "muted", label: PRIVACY_WORDS.muted },
                  ]}
                  selected={tab}
                  onSelect={setTab}
                  panelId={PANEL}
                />
              </View>
            </View>
          }
          action={(item, remove) => (
            <UndoButton
              label={tab === "blocked" ? PRIVACY_WORDS.unblock : PRIVACY_WORDS.unmute}
              onPress={async () => {
                if (tab === "blocked") await social.setBlock(item.handle, false);
                else await social.setMute(item.handle, false);
                remove();
              }}
            />
          )}
        />
      </TabPanel>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/profile.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { View } from "react-native";
import { BIO_MAX_LENGTH, isRetiredPlaceholder, postLength, type MeResponse, type ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { ReauthPanel, ReenrollNotice, useReauth } from "@/components/security/ReauthPanel";
import { SettingsNav } from "@/components/SettingsNav";
import { Body, Button, ErrorText, Field, Loading, Notice, Section } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { PROFILE_WORDS } from "@/lib/settings-words";
import { social } from "@/lib/social";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS } from "@/lib/ui-words";

/** The DisplayName contract's limit, in the code points the counter shows. */
const DISPLAY_NAME_MAX = 50;
/** The API lets a handle change again this long after the last change (1b design, section 7.2); mirrored so the date shows before a refused attempt. */
const HANDLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** A field's count against its limit, in danger-ink once it is over, as the composer's count is. */
function Counter({ length, max }: { length: number; max: number }) {
  return (
    <Text variant="meta" tone={length > max ? "danger" : "low"} className="mt-1 text-right">
      {`${length}/${max}`}
    </Text>
  );
}

/**
 * A sentence that holds the form back (3e: a refusal while a measure runs; the date of the next handle change): an alert
 * in the review tone with its icon, so it does not rely on its colour (UI design, section 4.8).
 */
function Held({ message, alert = false }: { message: string; alert?: boolean }) {
  return (
    <View accessibilityRole={alert ? "alert" : undefined} className="mt-4 flex-row items-start gap-2">
      <View className="pt-[3px]">
        <Icon name="review" size={16} tone="review-ink" />
      </View>
      <Text tone="review-ink" className="shrink">
        {message}
      </Text>
    </View>
  );
}

/** Display name and bio. /api/me carries no bio, so the form starts from the public profile, which has both. */
function ProfileForm({ handle, refresh }: { handle: string; refresh: Refresh }) {
  const [saved, setSaved] = useState<ProfileView | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    social
      .profile(handle)
      .then((profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDisplayName(profile.displayName);
        setBio(profile.bio);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const name = displayName.trim();
  const text = bio.trim();
  const nameLength = postLength(name);
  const bioLength = postLength(text);
  const changed = saved !== null && (name !== saved.displayName || text !== saved.bio);
  const ready = changed && nameLength >= 1 && nameLength <= DISPLAY_NAME_MAX && bioLength <= BIO_MAX_LENGTH;

  // Enter in the bio calls this as the button does, so the button's conditions come first: nothing unchanged or invalid is
  // sent, and a second Enter while the first request is out sends nothing.
  async function save() {
    if (!saved || !ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      // Only what changed is sent: the contract refuses an empty edit, and the server records an event per call.
      const { profile } = await social.editProfile({ ...(name !== saved.displayName ? { displayName: name } : {}), ...(text !== saved.bio ? { bio: text } : {}) });
      setSaved(profile);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setDone("Profile saved.");
      // The shell's Profile link and the profile page read the session, so it follows the new name.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!saved) {
    return error ? (
      <ErrorText message={error} />
    ) : (
      <Text tone="low" className="mt-3">
        {PROFILE_WORDS.loading}
      </Text>
    );
  }
  return (
    <View>
      <Body>{PROFILE_WORDS.formBody}</Body>
      <Field label="Display name" autoComplete="name" value={displayName} onChangeText={setDisplayName} />
      <Counter length={nameLength} max={DISPLAY_NAME_MAX} />
      {/* The Bio contract refuses control characters, which a line break is, so the field stays single-line. */}
      <Field label="Bio" value={bio} onChangeText={setBio} onSubmitEditing={() => void save()} />
      <Counter length={bioLength} max={BIO_MAX_LENGTH} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}

/**
 * The handle and its 30-day rule. The change needs fresh authentication, so it runs through useReauth. While the profile
 * holds a placeholder (3e design, section 9.5) the section says that korbat retired the handle and that the wait does not
 * apply: the retirement cleared the change time, so the form is open at once. Exported for the server-rendered check.
 */
export function HandleSection({ me, run, refresh }: { me: MeResponse; run: Run; refresh: Refresh }) {
  const current = me.profile?.handle ?? "";
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The moment a handle_cooldown answer named through Retry-After; until one comes, the last change plus 30 days says it.
  const [refusedUntil, setRefusedUntil] = useState<number | null>(null);
  const fromLastChange = me.profile?.handleChangedAt ? new Date(me.profile.handleChangedAt).getTime() + HANDLE_COOLDOWN_MS : null;
  const until = refusedUntil ?? fromLastChange;
  const allowedAt = until !== null && until > Date.now() ? new Date(until) : null;
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  // Keyed on the placeholder's form; while /me carries a running measure the sentence waits for its end (Task 3).
  const retired = isRetiredPlaceholder(current.toLowerCase());
  const running = runningMeasure(me.standing);
  const ready = normalized.length > 0 && normalized !== current.toLowerCase();

  // Enter in the field calls this as the button does, so the button's conditions come first.
  async function change() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        const { profile } = await social.changeHandle(normalized);
        setHandle("");
        setRefusedUntil(null);
        setDone(`Your handle is now @${profile.handle}. The old one stays reserved for you.`);
        // The shell's Profile link and this screen's heading read the session.
        await refresh();
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_cooldown") setRefusedUntil(err.retryAfter ? Date.now() + err.retryAfter * 1000 : fromLastChange);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // 3e (design, sections 9.4 and 9.5): while a suspension or termination runs, the form is replaced by the refusal's
  // sentence (a terminated account never chooses one, so it reads that sentence alone).
  if (running !== null) {
    return (
      <View>
        {retired && running.kind === "suspend" ? <Notice message={STANDING_TEXTS.handle.retiredSuspended} /> : null}
        <Body>{STANDING_TEXTS.handle.standing(current)}</Body>
        <Held message={refusalSentence(me.standing)} alert />
      </View>
    );
  }
  return (
    <View>
      {retired ? <Notice message={STANDING_TEXTS.handle.retired} /> : null}
      <Body>{STANDING_TEXTS.handle.standing(current)}</Body>
      {allowedAt ? <Held message={PROFILE_WORDS.nextChange(allowedAt.toLocaleDateString())} /> : null}
      <Field label="New handle" mono autoCapitalize="none" autoComplete="username" placeholder="@yourname" value={handle} onChangeText={setHandle} onSubmitEditing={() => void change()} />
      <ErrorText message={error} />
      <Notice message={done} />
      <Button label="Change handle" onPress={() => void change()} busy={busy} disabled={!ready} />
    </View>
  );
}

/**
 * Settings, Profile (1b and 3e designs; UI design, section 8.8): the name and bio, and the handle with its 30-day rule.
 * UI Task 8 keeps its sections, words and flows on the tokens: the title and the settings row in ScreenHeader, the
 * handle in the mono face under it, each section a card of fields on ScreenScroll.
 */
export default function ProfileSettings() {
  const { state, refresh } = useSession();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsProfile");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;
  // The settings layout sends an account without a handle to onboarding, so the profile is there; the type still allows null.
  if (!me.profile) return <Loading />;

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.profile"]}>
        <SettingsNav current="profile" />
      </ScreenHeader>
      <ScreenScroll screen="profile">
        <Text variant="mono" tone="medium" className="mt-2">{`@${me.profile.handle}`}</Text>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}
        {/* After a recovery code confirmed the handle change: the screen stays as it is and says where two-factor is set up again. */}
        <ReenrollNotice me={me} />

        <Section title="Name and bio">
          {/* 3e (design, section 9.4): while a suspension or termination runs, the form is replaced by the refusal's sentence. */}
          {runningMeasure(me.standing) !== null ? (
            <Held message={refusalSentence(me.standing)} alert />
          ) : (
            <ProfileForm handle={me.profile.handle} refresh={refresh} />
          )}
        </Section>
        <Section title="Handle">
          <HandleSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/settings/security.tsx` (whole file)

```tsx
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { MfaSection } from "@/components/security/MfaSection";
import { PasskeysSection } from "@/components/security/PasskeysSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { SettingsNav } from "@/components/SettingsNav";
import { Button, Loading, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * Settings, Security (1b and 1c designs; UI design, section 8.8): two-factor authentication, the password, the passkeys,
 * where the account is signed in, and Sign out. UI Task 8 restyles it and keeps its sections, words and flows: the title
 * and the settings row in ScreenHeader, the account's handle (in the mono face) and address at the top of the column,
 * each section a card of fields and rows on ScreenScroll.
 */
export default function SecuritySettings() {
  const { state, refresh } = useSession();
  // reenroll=1 after a recovery code was used; add=1 from the home screen's passkey card, which opens the Add dialog at once.
  const { reenroll, add } = useLocalSearchParams<{ reenroll?: string; add?: string }>();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsSecurity");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  async function signOut() {
    await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/");
  }

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.security"]}>
        <SettingsNav current="security" />
      </ScreenHeader>
      <ScreenScroll screen="security">
        {/* Whose security this is: the handle in the mono face, so look-alike handles differ, and the address. */}
        <View className="mt-2 flex-row flex-wrap items-baseline gap-x-3 gap-y-1">
          <Text variant="mono" tone="medium">{`@${me.profile?.handle ?? ""}`}</Text>
          <Text tone="medium" className="min-w-0 shrink web:break-words">
            {me.user.email}
          </Text>
        </View>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Two-factor authentication">
          <MfaSection me={me} run={reauth.run} refresh={refresh} reenroll={reenroll === "1"} />
        </Section>
        <Section title="Password">
          <PasswordSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        <Section title="Passkeys">
          <PasskeysSection me={me} run={reauth.run} refresh={refresh} openAdd={add === "1"} />
        </Section>
        <Section title="Where you're signed in">
          <SessionsSection run={reauth.run} refresh={refresh} />
        </Section>

        <Button label="Sign out" onPress={() => void signOut()} tone="secondary" />
      </ScreenScroll>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace } from "@/components/ScreenHeader";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { ProfileMenu } from "@/components/social/ProfileMenu";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, ErrorText, VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { social } from "@/lib/social";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";

type Tab = "posts" | "replies" | "likes";

const TAB_LABELS: Record<Tab, string> = { posts: UI_WORDS["profile.tab.posts"], replies: UI_WORDS["profile.tab.replies"], likes: UI_WORDS["profile.tab.likes"] };

/** The profile's panel, which its tabs control. */
const PANEL = "profile-panel";

/**
 * A count under the profile (section 8.4): the number in body-strong and its word, a link to the list where there is
 * one (signed in). With "Hide like, repost and follower counts" on, a link reads its word alone, "Followers" or
 * "Following" (decision 15), and a count without a link is not shown.
 */
function Stat({ value, label, hidden, href }: { value: number; label: string; hidden?: string; href?: Href }) {
  const { hideCounts } = useAppearance();
  if (hideCounts && hidden !== undefined && !href) return null;
  const inner =
    hideCounts && hidden !== undefined ? (
      <Text tone="medium">{hidden}</Text>
    ) : (
      <Text tone="low">
        <Text variant="body-strong">{String(value)}</Text> {label}
      </Text>
    );
  return href ? (
    <Link href={href} asChild>
      <Pressable className={cn("min-h-[44px] justify-center rounded-control web:hover:underline", FOCUS_RING)}>{inner}</Pressable>
    </Link>
  ) : (
    <View className="min-h-[44px] justify-center">{inner}</View>
  );
}

/** "Follows you": a neutral chip, no status colour (section 8.4). */
function FollowsYou() {
  return (
    <View className="self-start rounded-full border border-line-low bg-surface-2 px-2.5 py-0.5">
      <Text variant="chip" tone="medium">
        {UI_WORDS["profile.followsYou"]}
      </Text>
    </View>
  );
}

/** While the profile loads: the header's shapes and three posts' (section 8.4). */
function ProfileSkeleton() {
  return (
    <View>
      <View className="gap-3 px-4 pb-4 pt-6">
        <Skeleton.Circle size={64} />
        <Skeleton.Text width="45%" variant="post" />
        <Skeleton.Text width="30%" />
        <Skeleton.Text width="80%" />
      </View>
      <Skeleton.List kind="posts" count={3} />
    </View>
  );
}

/**
 * A profile (UI design, section 8.4): the header with the monogram, the display name as the screen's one h1 (decision
 * 16: the tab's title names the kind of screen only), the verified chip, the handle in the mono face, the bio, the
 * counts as links and "Follows you"; Follow and the More menu (Mute, Block, Report) for anyone but the owner, whose
 * place holds the way to their settings; then Posts and Replies, and Likes on the reader's own profile.
 */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.profile");
  const wide = useLayout() !== "phone";
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  // The block question's sheet, mounted while it is open or closing, as the kit's sheets are.
  const [blocking, setBlocking] = useState({ mounted: false, open: false });
  const [actionError, setActionError] = useState<string | null>(null);
  // 3e (design, section 9.4): a follow refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // UI Task 3: the profile is read once the session is known, since what it holds depends on the reader; read while
    // the session loads, it was read twice, and its posts with it (UI design, section 11.3: three requests at most).
    if (state.status === "loading") return;
    let cancelled = false;
    setProfile(null);
    setError(null);
    setTab("posts");
    social
      .profile(handle)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handle, state.status]);

  const fetchPosts = useCallback((cursor?: string) => social.profilePosts(handle, cursor), [handle]);
  const fetchReplies = useCallback((cursor?: string) => social.profileReplies(handle, cursor), [handle]);
  const fetchLikes = useCallback((cursor?: string) => social.myLikes(cursor), []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setRefused(false);
    try {
      await action();
    } catch (err) {
      if (isSuspendedRefusal(err)) setRefused(true);
      else setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <View className="gap-2 px-4 py-6">
          <Text as="h1" variant="display-2">
            {UI_WORDS["profile.missing"]}
          </Text>
          <Text tone="medium">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        {title}
        <HeaderSpace />
        <ProfileSkeleton />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];
  const mute = () =>
    void act(async () => {
      const { muted } = await social.setMute(profile.handle, !viewer!.muted);
      setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
    });
  // Unblocking needs no question; blocking asks first, in a sheet, with its words as they were.
  const block = () => {
    if (viewer?.blocked) {
      void act(async () => {
        const { blocked } = await social.setBlock(profile.handle, false);
        setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, blocked } } : current));
      });
      return;
    }
    setBlocking({ mounted: true, open: true });
  };

  const header = (
    <View>
      <View {...dataAttribute("profile-header")} className="gap-3 px-4 pb-2 pt-6">
        <Avatar account={profile} size={wide ? 96 : 64} />
        <View className="gap-0.5">
          <View className="flex-row flex-wrap items-center gap-x-2">
            {/* The display name is the screen's h1; it wraps rather than pushing the page sideways. */}
            <Text as="h1" variant={wide ? "display-1" : "display-2"} className="shrink web:break-words">
              {profile.displayName}
            </Text>
            {profile.verified ? <VerifiedChip /> : null}
          </View>
          <Text variant="mono" tone="low" style={{ fontWeight: "700" }}>
            @{profile.handle}
          </Text>
        </View>
        {profile.bio ? <Text variant="post">{profile.bio}</Text> : null}
        <View className="flex-row flex-wrap items-center gap-x-4">
          <Stat value={profile.counts.posts} label={UI_WORDS["profile.posts"]} />
          <Stat value={profile.counts.followers} label={UI_WORDS["profile.followers"]} hidden={UI_WORDS["profile.followers.hidden"]} href={me ? `/u/${profile.handle}/followers` : undefined} />
          <Stat value={profile.counts.following} label={UI_WORDS["profile.following"]} hidden={UI_WORDS["profile.following.hidden"]} href={me ? `/u/${profile.handle}/following` : undefined} />
        </View>
        {viewer?.followedBy ? <FollowsYou /> : null}
        <View className="flex-row flex-wrap items-center gap-2">
          {me && !own && viewer ? (
            <FollowButton
              handle={profile.handle}
              initial={viewer.following}
              onChange={(following, followerCount) =>
                setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
              }
            />
          ) : null}
          {own ? (
            <View className="-mt-6">
              {/* UI Task 8: the Settings index, as the nav's Settings item opens it. */}
              <Button label={UI_WORDS["profile.settings"]} onPress={() => router.push("/settings")} tone="secondary" full={false} />
            </View>
          ) : (
            <ProfileMenu profile={profile} onMute={mute} onBlock={block} />
          )}
        </View>
        {!me ? (
          <Text variant="meta" tone="low">
            {UI_WORDS["profile.signIn"]}
          </Text>
        ) : null}
        <ErrorText message={actionError} />
        {refused ? <RefusedNotice standing={me?.standing ?? null} /> : null}
      </View>
      <View className="border-b border-line-low px-3">
        <Tabs label={UI_WORDS["profile.tabs"]} tabs={tabs.map((key) => ({ key, label: TAB_LABELS[key] }))} selected={tab} onSelect={setTab} panelId={PANEL} />
      </View>
    </View>
  );

  // The phone's compose button shows on a profile (section 7.2).
  return (
    <AppShell compose>
      {title}
      <TabPanel panelId={PANEL} selected={tab}>
        {tab === "posts" ? (
          <TimelineList key="posts" fetchPage={fetchPosts} empty={UI_WORDS["profile.empty.posts"]} header={header} />
        ) : tab === "replies" ? (
          <PostList key="replies" fetchPage={fetchReplies} empty={UI_WORDS["profile.empty.replies"]} header={header} />
        ) : (
          <PostList key="likes" fetchPage={fetchLikes} empty={UI_WORDS["profile.empty.likes"]} header={header} />
        )}
      </TabPanel>
      {blocking.mounted ? (
        <Sheet
          open={blocking.open}
          onClose={() => setBlocking({ mounted: true, open: false })}
          onClosed={() => setBlocking({ mounted: false, open: false })}
          title={fill(UI_WORDS["profile.blockQuestion"], { handle: profile.handle })}
          description={UI_WORDS["profile.blockBody"]}
        >
          <View className="flex-row flex-wrap gap-x-2">
            <Button
              label={UI_WORDS["profile.block"]}
              tone="danger"
              full={false}
              busy={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
            />
            <Button label={UI_WORDS["profile.cancel"]} tone="secondary" full={false} onPress={() => setBlocking({ mounted: true, open: false })} />
          </View>
        </Sheet>
      ) : null}
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/AppShell.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link, usePathname } from "expo-router";
import { openNewPost } from "@/lib/composing";
import { useSession } from "@/lib/session";
import { ShellScrollProvider, softReset, useShellScroll } from "@/lib/shell-scroll";
import { setComposeButtonShown } from "@/lib/toast-rules";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { COLUMNS, useLayout, type LayoutKind } from "@/theme/layout";
import { AboutCard } from "./AboutCard";
import { HandleBox } from "./HandleBox";
import type { IconName } from "./icons";
import { Icon } from "./kit/Icon";
import { FOCUS_RING, FOCUS_RING_INSET, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";
import { VISUALLY_HIDDEN } from "./kit/VisuallyHidden";
import { ComposeButton, NewPostButton } from "./social/ComposeButton";
import { StandingBanner } from "./StandingBanner";

/**
 * The shell around every screen of the app (UI design, section 7): the navigation, the main column the screen draws in,
 * and from 1024 px the context column. useLayout() picks one of four layouts by the window's width:
 *
 * - phone (below 768 px): a bottom tab bar, icons over 12 px labels, and on Home, a profile and Bookmarks (the screens
 *   that pass `compose`) the floating compose button;
 * - tablet (768 to 1023 px): a rail 80 px wide at the left, with the "k" monogram, and the 600 px column centred in the rest;
 * - desktop (1024 to 1279 px): the rail, the column and the 320 px context column, together and centred;
 * - wide (1280 px and up): the full nav, 240 px with the wordmark and labels beside the icons, the column and the context.
 *
 * Signed in, the rail and the full nav end with New post on every screen (Task 6): the compose button in the rail, a
 * full-width button in the full nav. It opens the app's one New post sheet (lib/composing.ts, mounted in the root layout
 * as components/social/ComposeHost.tsx), a 640 px dialog at these widths, unless the screen gives `onNewPost`: Home
 * gives the one that opens and focuses its own card in the list.
 *
 * The nav is a landmark named "Main" with the same items and hrefs at every width (Home, Bookmarks, Profile, Settings for
 * an account; Home, Sign in and Appearance signed out, UI Task 8, since Appearance is the one settings page open to
 * everyone). The current item keeps aria-current="page" on its anchor and is marked by
 * more than colour: an accent-wash pill, a 3 px accent bar (above the icon in the tab bar, at the item's start in the
 * rail and full nav) and its icon at the strong stroke. Focus order on the web is the skip link (shown while focused),
 * the nav, the main column, the context column. The page's body never scrolls; each screen's list scrolls in the main
 * column, which tells the shell through lib/shell-scroll.tsx, so the phone's header can hide and the current Home item
 * can bring the feed back to its newest post. Nothing here counts or badges anything (section 1.7).
 */
type Status = "loading" | "signed-out" | "signed-in";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Marks the item current on every page under this prefix, when that is wider than the href. */
  match?: string;
}

const HOME: NavItem = { label: UI_WORDS["nav.home"], href: "/", icon: "home" };

/**
 * The nav's items. While the session loads only Home shows, the one item both sets share: the rest join once /me answers,
 * so a signed-in reader never sees Sign in flash, nor a signed-out one Bookmarks.
 */
function navItems(status: Status, handle: string | undefined): NavItem[] {
  if (status === "loading") return [HOME];
  if (status === "signed-out") {
    return [HOME, { label: UI_WORDS["nav.signin"], href: "/signin", icon: "sign-in" }, { label: UI_WORDS["appearance.nav"], href: "/settings/appearance", icon: "appearance" }];
  }
  return [
    HOME,
    { label: UI_WORDS["nav.bookmarks"], href: "/bookmarks", icon: "bookmarks" },
    { label: UI_WORDS["nav.profile"], href: handle ? `/u/${handle}` : "/handle", icon: "profile" },
    // Settings opens the Settings index (UI Task 8, the owner's ruling 10) and stays current on every page below it.
    { label: UI_WORDS["nav.settings"], href: "/settings", icon: "settings", match: "/settings" },
  ];
}

/** Whether a path is the prefix's page or below it: /u/ada/followers is under /u/ada, /u/adam is not. */
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const isCurrent = (item: NavItem, pathname: string) => (item.href === "/" ? pathname === "/" : under(pathname, item.match ?? item.href));

/** The layout's name on the root element, which the browser check reads (data-layout). */
const layoutData = (kind: LayoutKind) => ({ dataSet: { layout: kind } }) as object;

/** Whether the browser says it is offline. Node and native have no navigator.onLine, and count as online. */
const browserOnline = () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false;

interface OnlineEvents {
  addEventListener?: (type: "online" | "offline", listener: () => void) => void;
  removeEventListener?: (type: "online" | "offline", listener: () => void) => void;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(browserOnline);
  useEffect(() => {
    const target = globalThis as unknown as OnlineEvents;
    if (typeof target.addEventListener !== "function") return;
    const update = () => setOnline(browserOnline());
    target.addEventListener("online", update);
    target.addEventListener("offline", update);
    return () => {
      target.removeEventListener?.("online", update);
      target.removeEventListener?.("offline", update);
    };
  }, []);
  return online;
}

/**
 * The polite status at the top of the main column (section 8.11): "You're offline" while the browser says so, nothing
 * once it is back. The live region is always there, so its words are announced when they appear.
 */
function OfflineBanner() {
  const online = useOnline();
  return (
    <View role="status" aria-live="polite">
      {online ? null : (
        <View className="flex-row items-center gap-2 border-b border-line-low bg-surface-1 px-4 py-2.5">
          <Icon name="offline" size={16} tone="medium" />
          <Text variant="body-strong" tone="medium">
            {UI_WORDS["offline.title"]}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * "Skip to the main content": the first stop of the Tab key, kept off screen (as VisuallyHidden keeps text) until it has
 * the focus, then drawn at the top left over the page. It is a real link to #main; pressed, it moves the focus to the
 * main column itself instead of changing the address.
 */
function SkipLink({ onSkip }: { onSkip: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...({ href: "#main" } as object)}
      onPress={(event: GestureResponderEvent) => {
        event.preventDefault();
        onSkip();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn("min-h-[44px] justify-center rounded-control border border-line-high bg-surface-1 px-4 web:forced-colors:border-[color:CanvasText]", FOCUS_RING)}
      // Hidden, its least size is undone too, and it sits at the corner rather than where the row would centre it.
      style={focused ? { position: "absolute", top: 8, left: 8, zIndex: 50 } : { ...VISUALLY_HIDDEN, top: 0, left: 0, minWidth: 0, minHeight: 0 }}
    >
      <Text variant="body-strong">{UI_WORDS["shell.skip"]}</Text>
    </Pressable>
  );
}

interface NavProps {
  items: NavItem[];
  pathname: string;
  /** The current Home item pressed again: the soft reset. A press or, on the web, the anchor's click. */
  onHomeAgain: (event: { preventDefault(): void }) => void;
}

/** One item's link: the current Home item scrolls the feed instead of navigating. */
function ItemLink({ item, current, onHomeAgain, children }: { item: NavItem; current: boolean; onHomeAgain: NavProps["onHomeAgain"]; children: ReactNode }) {
  const again = current && item.href === "/" ? onHomeAgain : undefined;
  return (
    <Link href={item.href} onPress={again} asChild>
      {children}
    </Link>
  );
}

/** The item's icon: the strong stroke when current, and filled where its shape is closed (Bookmark). */
function ItemIcon({ item, current }: { item: NavItem; current: boolean }) {
  return <Icon name={item.icon} size={24} tone={current ? "high" : "low"} strong={current} filled={current && item.icon === "bookmarks"} />;
}

/**
 * The phone's bottom tab bar: 56 px plus the bottom safe area, each item a 3 by 20 px bar, the icon in its pill, the label.
 * The bar's and the pill's sizes are px, as the icons' are, so a larger root font size grows the labels and not the
 * shapes past their quarter of the bar.
 */
function TabBar({ items, pathname, onHomeAgain }: NavProps) {
  const insets = useSafeAreaInsets();
  return (
    <View role="navigation" aria-label={UI_WORDS["nav.label"]} className="flex-row border-t border-line-low bg-surface" style={{ paddingBottom: insets.bottom }}>
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <ItemLink key={item.href} item={item} current={current} onHomeAgain={onHomeAgain}>
            <Pressable aria-current={current ? "page" : undefined} className={cn("min-h-[56px] min-w-0 flex-1 items-center pb-1 active:bg-surface-2", HOVER_WASH, FOCUS_RING_INSET)}>
              <View className={cn("h-[3px] w-[20px] rounded-b-full", current ? "bg-accent" : "bg-transparent")} />
              <View className={cn("mt-[3px] h-[28px] w-[56px] max-w-full items-center justify-center rounded-full", current ? "bg-accent-wash" : undefined)}>
                <ItemIcon item={item} current={current} />
              </View>
              {/* A label never clips: at the largest text it breaks, hyphenated, onto another line inside its quarter of the bar. */}
              <Text variant="chip" tone={current ? "high" : "low"} className="mt-0.5 self-stretch px-0.5 text-center web:hyphens-auto web:break-words">
                {item.label}
              </Text>
            </Pressable>
          </ItemLink>
        );
      })}
    </View>
  );
}

/**
 * The nav from 768 px: the rail (80 px, the "k" monogram, icons over 12 px labels) or, from 1280 px, the full nav (240 px,
 * the wordmark, labels beside the icons). Under them, signed in, New post: a button and no link, so the nav's links stay
 * the four of section 7.1.
 */
function SideNav({ items, pathname, onHomeAgain, full, newPost }: NavProps & { full: boolean; newPost?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      role="navigation"
      aria-label={UI_WORDS["nav.label"]}
      className={cn("shrink-0 gap-1", full ? "px-3" : "items-center px-2")}
      style={{ width: full ? COLUMNS.nav : COLUMNS.rail, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
    >
      {/* The mark only: the page's title and the Home item already name korbat, so a screen reader passes over it. */}
      <Text aria-hidden variant={full ? "display-1" : "display-2"} className={full ? "mb-4 px-4" : "mb-4"}>
        {full ? UI_WORDS["frame.wordmark"] : UI_WORDS["nav.monogram"]}
      </Text>
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <ItemLink key={item.href} item={item} current={current} onHomeAgain={onHomeAgain}>
            {full ? (
              <Pressable
                aria-current={current ? "page" : undefined}
                className={cn("min-h-[48px] flex-row items-center gap-4 rounded-full px-4 active:bg-surface-2", current ? "bg-accent-wash" : HOVER_WASH, FOCUS_RING)}
              >
                <View className={cn("absolute bottom-3 left-[-12px] top-3 w-[3px] rounded-r-full", current ? "bg-accent" : "bg-transparent")} />
                <ItemIcon item={item} current={current} />
                <Text variant={current ? "body-strong" : "body"} tone={current ? "high" : "low"} className="shrink web:hyphens-auto web:break-words">
                  {item.label}
                </Text>
              </Pressable>
            ) : (
              <Pressable aria-current={current ? "page" : undefined} className={cn("min-h-[60px] w-[64px] items-center justify-center gap-1 rounded-card py-1.5 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}>
                <View className={cn("absolute bottom-4 left-[-8px] top-4 w-[3px] rounded-r-full", current ? "bg-accent" : "bg-transparent")} />
                <View className={cn("h-[32px] w-[48px] max-w-full items-center justify-center rounded-full", current ? "bg-accent-wash" : undefined)}>
                  <ItemIcon item={item} current={current} />
                </View>
                <Text variant="chip" tone={current ? "high" : "low"} className="self-stretch text-center web:hyphens-auto web:break-words">
                  {item.label}
                </Text>
              </Pressable>
            )}
          </ItemLink>
        );
      })}
      {newPost ? <View className={cn("mt-4", full ? "self-stretch" : "items-center")}>{full ? <NewPostButton onPress={newPost} /> : <ComposeButton onPress={newPost} />}</View> : null}
    </View>
  );
}

/** The context column (section 7.3, decision 14): the handle box, then How korbat works. Popular now has left it. */
function ContextColumn() {
  const insets = useSafeAreaInsets();
  return (
    <View role="complementary" aria-label={UI_WORDS["shell.about"]} className="shrink-0" style={{ width: COLUMNS.context }}>
      <ScrollView contentContainerClassName="gap-6 pb-6" contentContainerStyle={{ paddingTop: insets.top + 24 }}>
        <HandleBox />
        <AboutCard />
      </ScrollView>
    </View>
  );
}

interface AppShellProps {
  children: ReactNode;
  /** A control floating over a phone's column, bottom right. */
  floating?: ReactNode;
  /** The phone's compose button on this screen (7.2: Home, a profile and Bookmarks), for a signed-in reader. */
  compose?: boolean;
  /** What New post does here instead of opening the sheet: Home opens and focuses its own card from 768 px. */
  onNewPost?: () => void;
}

export function AppShell({ children, floating, compose = false, onNewPost }: AppShellProps) {
  const kind = useLayout();
  return (
    <ShellScrollProvider phone={kind === "phone"}>
      <Shell kind={kind} floating={floating} compose={compose} onNewPost={onNewPost}>
        {children}
      </Shell>
    </ShellScrollProvider>
  );
}

function Shell({ kind, children, floating, compose, onNewPost }: { kind: LayoutKind } & AppShellProps) {
  const { state } = useSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const scroll = useShellScroll();
  const main = useRef<View>(null);
  const signedIn = state.status === "signed-in";
  const handle = signedIn ? state.me.profile?.handle : undefined;
  // 3e (design, section 9.1): above every signed-in screen while /me's standing holds a measure.
  const banner = signedIn ? <StandingBanner standing={state.me.standing} /> : null;
  const items = navItems(state.status, handle);
  const phone = kind === "phone";
  const newPost = signedIn ? (onNewPost ?? openNewPost) : undefined;
  // The phone's floating control: the screen's own, or the compose button where the screen asks for it.
  const shownFloating = floating ?? (compose && newPost ? <ComposeButton onPress={newPost} /> : null);
  const hasFloating = shownFloating !== undefined && shownFloating !== null && shownFloating !== false;

  // Toasts on a phone screen with the compose button sit above it (section 5.4); the Toaster lives outside the screen.
  useEffect(() => {
    if (!phone || !hasFloating) return;
    setComposeButtonShown(true);
    return () => setComposeButtonShown(false);
  }, [phone, hasFloating]);

  // The skip link's target: the main column itself takes the focus, so the next Tab starts inside it.
  const focusMain = () => (main.current as unknown as { focus?: () => void } | null)?.focus?.();
  const nav: NavProps = { items, pathname, onHomeAgain: (event) => softReset(event, scroll) };

  const column = (
    <View ref={main} role="main" nativeID="main" tabIndex={-1} className={cn("flex-1", FOCUS_RING_INSET)}>
      <OfflineBanner />
      {banner}
      <View className="flex-1">{children}</View>
    </View>
  );

  if (phone) {
    return (
      <View {...layoutData(kind)} className="flex-1 bg-surface">
        <SkipLink onSkip={focusMain} />
        {/* The tab bar comes before the column in the page, after the skip link, and is drawn below it. */}
        <View className="flex-1 flex-col-reverse">
          <TabBar {...nav} />
          {column}
        </View>
        {hasFloating ? (
          // 16 px from the right, and 16 px above the tab bar and the bottom safe area (section 7.2).
          <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: 56 + insets.bottom + 16 }}>
            {shownFloating}
          </View>
        ) : null}
      </View>
    );
  }

  const context = kind === "desktop" || kind === "wide";
  const navWidth = kind === "wide" ? COLUMNS.nav : COLUMNS.rail;
  // The columns sit together, 24 px apart with a line-low rule on each side of the main column: 1,208 px at wide.
  const together = navWidth + COLUMNS.gap + COLUMNS.timeline + 2 + COLUMNS.gap + COLUMNS.context;
  const timeline = (
    <View className="min-w-0 flex-1 border-x border-line-low" style={{ maxWidth: COLUMNS.timeline + 2 }}>
      {column}
    </View>
  );
  return (
    <View {...layoutData(kind)} className="flex-1 flex-row justify-center bg-surface">
      <SkipLink onSkip={focusMain} />
      {context ? (
        <View className="w-full flex-row" style={{ maxWidth: together, gap: COLUMNS.gap }}>
          <SideNav {...nav} full={kind === "wide"} newPost={newPost} />
          {timeline}
          <ContextColumn />
        </View>
      ) : (
        // A tablet: the rail at the left edge and the column centred in the rest.
        <View className="w-full flex-row">
          <SideNav {...nav} full={false} newPost={newPost} />
          <View className="min-w-0 flex-1 flex-row justify-center">
            {timeline}
          </View>
        </View>
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/SettingsNav.tsx` (whole file)

```tsx
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { CASES_WORDS } from "@/lib/moderation-words";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import type { IconName } from "./icons";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

export type SettingsPage = "appearance" | "security" | "privacy" | "profile" | "account" | "cases";

/**
 * The settings pages in their order, with their names and icons (UI design, sections 4.7 and 8.8): Appearance first
 * (UI Task 8, the owner's ruling 10), so the page a newcomer looks for comes first, in this row and in the Settings
 * index (app/settings/index.tsx), which lists the same pages as rows.
 */
export const SETTINGS_PAGES: { page: SettingsPage; label: string; icon: IconName }[] = [
  { page: "appearance", label: UI_WORDS["appearance.nav"], icon: "appearance" },
  { page: "security", label: UI_WORDS["settings.security"], icon: "security" },
  { page: "privacy", label: UI_WORDS["settings.privacy"], icon: "privacy" },
  { page: "profile", label: UI_WORDS["settings.profile"], icon: "edit-profile" },
  { page: "account", label: UI_WORDS["settings.account"], icon: "account" },
  // The decisions about the account and the reports it sent (3c design, section 9); its screens are the folder settings/cases.
  { page: "cases", label: CASES_WORDS.nav, icon: "cases" },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title but the index, which is the
 * list itself. Each link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render the row on its own.
 * Appearance shows the row only to a signed-in reader, since the others need an account.
 *
 * On the tokens (UI design, sections 4.8 and 7.1): each link a 44 px pill that wraps rather than clipping its word, the
 * current one in the accent wash with its label in body-strong and an accent underline beneath it, a shape mark that
 * does not rely on the colour; the others ink-medium, with the hover wash under a fine pointer.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label={UI_WORDS["settings.nav"]} className="mt-3 flex-row flex-wrap gap-1">
      {SETTINGS_PAGES.map(({ page, label }) => (
        <Link key={page} href={`/settings/${page}`} asChild>
          <Pressable
            aria-current={page === current ? "page" : undefined}
            className={cn("min-h-[44px] justify-center rounded-full px-3 active:bg-surface-2", page === current ? "bg-accent-wash" : HOVER_WASH, FOCUS_RING)}
          >
            <Text variant={page === current ? "body-strong" : "body"} tone={page === current ? "high" : "medium"} className={page === current ? "underline decoration-accent web:decoration-2 web:underline-offset-4" : undefined}>
              {label}
            </Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}
```

### Replace `apps/app/src/components/kit/ListRow.tsx` (whole file)

```tsx
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./Icon";
import { FOCUS_RING_INSET, HOVER_WASH, pressDelay } from "./interaction";
import { radioMove } from "./Tabs";
import { Text } from "./Text";

/**
 * One row for settings, lists of accounts, menus on phones and the details sheet (UI design, section 6.11), in four
 * forms by what it does: a link (`href`, an anchor with a chevron), a button (`onPress`), a switch, and a radio in a
 * RadioGroup. `label` is required: it is the row's title and its accessible name (section 6.1). The row is 52 px tall at
 * least (a 44 px target and its padding), divided by line-low, surface-2 under a fine pointer, and surface-2 when
 * pressed, after 80 ms, since a scroll starts on rows. Rows never scale. Their focus ring is drawn inside, where the
 * column's edges cannot clip it.
 *
 * UI Task 5 extends it for a list of accounts (8.4): `leading` puts an element (the account's Avatar) in the icon's
 * place, `badge` follows the label (the VerifiedChip), `detail` replaces the meta line (the handle in the mono face and
 * the bio), and a link row may carry a control of the kind "button" (FollowButton), drawn beside the link and outside
 * it, since a button inside an anchor is a control no assistive technology can reach; such a row has no chevron.
 *
 * UI Task 8 (8.8): a radio row is the group's one tab stop while it is chosen, and RadioGroup's arrows move the choice; a
 * switch row may carry a Switch element of its own (`element`, Privacy's "Show my posts in Explore", whose line a test
 * reads) in place of the row's, with the row's flip and ring; and a row that only informs (`info`, a device of Security's
 * sessions) is neither a link nor a button, with an optional control of its own beside its words.
 */
export type ListRowControl =
  | { kind: "switch"; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean; element?: ReactElement }
  | { kind: "radio"; checked: boolean; onSelect: () => void };

/** A control of its own beside a link row: an element with its own name and press (FollowButton). */
export type ListRowButton = { kind: "button"; element: ReactElement };

interface RowContent {
  label: string;
  /** One line under the label, in meta. */
  description?: string;
  icon?: IconName;
  /** A short trailing text, such as the chosen theme. */
  value?: string;
  tone?: "default" | "danger";
  /** In the icon's place: an account's Avatar. */
  leading?: ReactNode;
  /** After the label: the VerifiedChip. */
  badge?: ReactNode;
  /** Under the label in place of the description: an account's handle and bio. */
  detail?: ReactNode;
}

export type ListRowProps = RowContent & ({ href: Href; control?: ListRowButton } | { onPress: () => void } | { control: ListRowControl } | { info: true; control?: ListRowButton });

/**
 * A switch's colours from the theme: the accent track with an on-accent thumb when on, line-high with a surface-1 thumb
 * when off. react-native-web paints the thumb of a switch that is on in its own teal unless `activeThumbColor` names
 * another colour, a prop React Native's types do not know, so it goes through one cast here.
 */
export function switchColours(colors: Record<"line-high" | "accent" | "on-accent" | "surface-1", string>): object {
  return { trackColor: { false: colors["line-high"], true: colors.accent }, thumbColor: colors["surface-1"], activeThumbColor: colors["on-accent"] };
}

const ROW = cn("min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3", HOVER_WASH);

/**
 * The switch row's ring. react-native-web draws a switch's focus as a faint shadow on its thumb, which forced colours
 * remove, so the row draws korbat's ring, inside, while the switch in it has keyboard focus.
 */
const SWITCH_RING = "web:has-[:focus-visible]:outline web:has-[:focus-visible]:outline-2 web:has-[:focus-visible]:-outline-offset-2 web:has-[:focus-visible]:outline-focus";

/**
 * One ring, not two (UI Task 8): the browser's own ring on the switch's hidden checkbox gives way to the row's, which
 * SWITCH_RING draws as korbat's focus-visible:outline; outline-none is a transparent outline, which forced colours still show.
 */
const ONE_RING = "web:[&_input]:outline-none"; // The row's focus-visible:outline above is the ring a keyboard sees.

/** The pressed wash, after the 80 ms delay; an inline colour, so it shows over the hover's class. */
function usePressedWash() {
  const { colors } = useTheme();
  return (pressed: boolean) => (pressed ? { backgroundColor: colors["surface-2"] } : undefined);
}

/** The label, its description, and what trails it. */
function Content({ label, description, icon, value, tone = "default", leading, badge, detail, trailing }: RowContent & { trailing?: ReactNode }) {
  const danger = tone === "danger";
  const title = (
    <Text variant="body-strong" tone={danger ? "danger" : "high"} className={badge === undefined ? undefined : "shrink"}>
      {label}
    </Text>
  );
  return (
    <>
      {leading ?? (icon !== undefined ? <Icon name={icon} size={20} tone={danger ? "danger" : "medium"} /> : null)}
      <View className="min-w-0 flex-1 gap-0.5">
        {badge === undefined ? (
          title
        ) : (
          <View className="flex-row flex-wrap items-center gap-x-1.5">
            {title}
            {badge}
          </View>
        )}
        {detail}
        {description !== undefined ? (
          <Text variant="meta" tone="low">
            {description}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? <Text tone="low">{value}</Text> : null}
      {trailing}
    </>
  );
}

/** The circle of a radio row: a ring, filled with the accent when chosen; the row's aria-checked says the same in words. */
function RadioMark({ checked }: { checked: boolean }) {
  return (
    <View className={cn("h-5 w-5 items-center justify-center rounded-full border-2", checked ? "border-accent" : "border-line-high")}>
      {checked ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </View>
  );
}

export function ListRow(props: ListRowProps) {
  const wash = usePressedWash();
  const { colors } = useTheme();
  const { label, description, icon, value, tone, leading, badge, detail } = props;
  const content = { label, description, icon, value, tone, leading, badge, detail };

  if ("href" in props) {
    const link = (
      <Link href={props.href} asChild>
        <Pressable {...pressDelay(80)} className={cn(FOCUS_RING_INSET, props.control ? "min-w-0 flex-1" : undefined)}>
          {({ pressed }) => (
            <View className={props.control ? cn(ROW, "border-b-0 pr-2") : ROW} style={wash(pressed)}>
              <Content {...content} trailing={props.control ? undefined : <Icon name="next" size={20} tone="low" />} />
            </View>
          )}
        </Pressable>
      </Link>
    );
    if (!props.control) return link;
    // The control beside the link, in the same row and under the same divider, but no part of the anchor.
    return (
      <View className="flex-row items-center border-b border-line-low pr-4">
        {link}
        {props.control.element}
      </View>
    );
  }

  if ("info" in props) {
    return (
      <View className="min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3">
        <Content {...content} trailing={props.control?.element} />
      </View>
    );
  }

  if ("onPress" in props) {
    return (
      <Pressable accessibilityRole="button" onPress={props.onPress} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} />
          </View>
        )}
      </Pressable>
    );
  }

  const control = props.control;
  if (control.kind === "radio") {
    return (
      // The group's one tab stop is its chosen radio; the arrows reach the others (RadioGroup), so a group always has one chosen.
      <Pressable role="radio" aria-checked={control.checked} tabIndex={control.checked ? 0 : -1} onPress={control.onSelect} {...pressDelay(80)} className={FOCUS_RING_INSET}>
        {({ pressed }) => (
          <View className={ROW} style={wash(pressed)}>
            <Content {...content} trailing={<RadioMark checked={control.checked} />} />
          </View>
        )}
      </Pressable>
    );
  }

  // The switch is the one control, with its own name and state: Tab reaches it and Space flips it. The row around it
  // flips it too for a pointer, as a convenience: it is no tab stop and no second control, and the switch takes no
  // pointer of its own, so one click never flips it twice.
  const flip = () => {
    if (!control.disabled) control.onValueChange(!control.value);
  };
  return (
    <Pressable onPress={flip} tabIndex={-1} {...pressDelay(80)}>
      {({ pressed }) => (
        <View className={cn(ROW, SWITCH_RING, ONE_RING)} style={wash(pressed)}>
          <Content
            {...content}
            trailing={
              <View pointerEvents="none">
                {control.element ?? <Switch accessibilityLabel={label} value={control.value} onValueChange={control.onValueChange} disabled={control.disabled} {...switchColours(colors)} />}
              </View>
            }
          />
        </View>
      )}
    </Pressable>
  );
}

/**
 * On the web, what a key does in a radio group (UI Task 8, WAI-ARIA's radio group pattern): the arrows move the focus to
 * the next or the previous radio and choose it at once, through the row's own press, with no motion of their own (5.1);
 * Space chooses the radio that has the focus. Native assistive technology has its own gestures for a radio group.
 */
function radioKeys(event: { key: string; currentTarget: unknown; preventDefault(): void }): void {
  const radios = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')];
  const focused = radios.findIndex((radio) => radio === document.activeElement);
  if (event.key === " ") {
    if (focused !== -1 && radios[focused]!.getAttribute("aria-checked") !== "true") {
      event.preventDefault();
      radios[focused]!.click();
    }
    return;
  }
  const from = focused !== -1 ? focused : radios.findIndex((radio) => radio.getAttribute("aria-checked") === "true");
  const next = radioMove(Math.max(from, 0), event.key, radios.length);
  if (next === null) return;
  event.preventDefault();
  radios[next]!.focus();
  radios[next]!.click();
}

/** A group of radio rows, named by its heading's nativeID (section 6.11). */
export function RadioGroup({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <View role="radiogroup" aria-labelledby={labelledBy} {...(Platform.OS === "web" ? ({ onKeyDown: radioKeys } as object) : {})}>
      {children}
    </View>
  );
}
```

### Replace `apps/app/src/components/kit/StatusChip.tsx` (whole file)

```tsx
import { cva } from "class-variance-authority";
import type { Ref } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { usePressScale } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING } from "./interaction";
import { Text, type Tone } from "./Text";

/**
 * A status as a chip (UI design, sections 4.8 and 6.13): the tone's wash, its own icon and its words, so it reads in
 * greyscale, to a screen reader and to a colour-blind reader alike; the colour only repeats what the words say. A chip is
 * never a coloured dot, and its words wrap rather than being cut. Three forms, by what it does:
 *   - information only (no href, no onPress): an image named by its label, or by `name` where the visible word needs
 *     more words to be understood (VerifiedChip shows "Verified" and is named "verified account");
 *   - a link (`href`): an anchor named by its words (In Explore, to its post);
 *   - a button (`onPress`): the author's moderation chip, which opens the details sheet, so it says it opens a dialog and
 *     ends in a chevron that makes it look pressable.
 */
export const STATUS_TONES = ["review", "restricted", "verified", "explore"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** Each tone's own icon, four different drawings (section 4.7): a clock, an eye struck through, a badge, a compass. */
export const STATUS_ICON: Record<StatusTone, IconName> = { review: "review", restricted: "restricted", verified: "verified", explore: "explore" };

const ON_WASH: Record<StatusTone, Tone> = { review: "review-on-wash", restricted: "restricted-on-wash", verified: "verified-on-wash", explore: "explore-on-wash" };

/**
 * The wash with a 1 px border in the tone's ink at 40 percent (4.8), solid CanvasText under forced colours, where the
 * browser removes backgrounds and the border alone keeps the shape. A chip that does something shows its border in full
 * ink under a fine pointer.
 */
const chip = cva("max-w-full flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5 web:forced-colors:border-[color:CanvasText]", {
  variants: {
    tone: {
      review: "border-review-ink/40 bg-review-wash web:group-hover:border-review-ink",
      restricted: "border-restricted-ink/40 bg-restricted-wash web:group-hover:border-restricted-ink",
      verified: "border-verified-ink/40 bg-verified-wash web:group-hover:border-verified-ink",
      explore: "border-explore-ink/40 bg-explore-wash web:group-hover:border-explore-ink",
    },
  },
});

interface StatusChipProps {
  tone: StatusTone;
  /** The chip's words, never empty: chipText(), "In Explore", "Verified". */
  label: string;
  /** The name of the information-only form, when it says more than the visible words. */
  name?: string;
  href?: Href;
  onPress?: () => void;
  /** Where the chip sits in its parent, such as self-center beside a display name. */
  className?: string;
  /** The button form's pressable, which takes the focus back when the sheet it opened has closed (UI Task 7). */
  ref?: Ref<View>;
}

/** The drawn chip: icon, words that wrap, and the button form's chevron. */
function Face({ tone, label, chevron }: { tone: StatusTone; label: string; chevron: boolean }) {
  return (
    <View className={chip({ tone })}>
      <Icon name={STATUS_ICON[tone]} size={14} tone={ON_WASH[tone]} />
      {/* At the largest text on the narrowest phone a single word can be wider than the chip: it breaks rather than clip. */}
      <Text variant="chip" tone={ON_WASH[tone]} className="min-w-0 shrink web:break-words">
        {label}
      </Text>
      {chevron ? <Icon name="next" size={14} tone={ON_WASH[tone]} /> : null}
    </View>
  );
}

export function StatusChip({ tone, label, name, href, onPress, className, ref }: StatusChipProps) {
  const press = usePressScale(0.97);
  if (href === undefined && onPress === undefined) {
    return (
      <View role="img" accessibilityLabel={name ?? label} className={cn("max-w-full", className)}>
        <Face tone={tone} label={label} chevron={false} />
      </View>
    );
  }
  // A chip that does something is a control: its target is 44 px tall around the drawn chip (section 4.4). The pressed
  // scale moves the Animated.View, which takes no classes on the web, so the placement sits on a View around it.
  const target = cn("group min-h-[44px] max-w-full justify-center rounded-control", FOCUS_RING);
  return (
    <View className={cn("max-w-full", className)}>
      <Animated.View style={press.style}>
        {href !== undefined ? (
          <Link href={href} asChild>
            <Pressable {...press.handlers} className={target}>
              <Face tone={tone} label={label} chevron={false} />
            </Pressable>
          </Link>
        ) : (
          <Pressable ref={ref} accessibilityRole="button" aria-haspopup="dialog" onPress={onPress} {...press.handlers} className={target}>
            <Face tone={tone} label={label} chevron />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

/**
 * A fact as a chip, which is no status (UI Task 8, sections 4.8 and 8.8): Security's "this device" and a passkey's tags
 * ("used for this session", "new", "synced"). It takes no status colour and no icon, since it says nothing a colour could
 * repeat: ink-medium on surface-2 with a line-high border, solid CanvasText under forced colours, so it keeps its shape.
 * It is an image to assistive technology, named by `name` where the one word needs more words to be understood, as the
 * verified chip is.
 */
export function NeutralChip({ label, name, className }: { label: string; name?: string; className?: string }) {
  return (
    <View role="img" accessibilityLabel={name ?? label} className={cn("max-w-full self-start rounded-full border border-line-high bg-surface-2 px-2 py-0.5 web:forced-colors:border-[color:CanvasText]", className)}>
      <Text variant="chip" tone="medium" className="min-w-0 shrink web:break-words">
        {label}
      </Text>
    </View>
  );
}
```

### Replace `apps/app/src/components/kit/Tabs.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useHaptics } from "@/lib/haptics";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { FOCUS_RING, HOVER_WASH, lastInputWasKeyboard, pressDelay } from "./interaction";
import { Text } from "./Text";

/**
 * Tabs (UI design, section 6.10): Home's Following, Latest and Explore, a profile's Posts, Replies and Likes, and later
 * Settings' and Cases' lists. A tab list named by `label` (required, so tsc refuses a nameless one), a tab per entry with
 * aria-selected and its label as its first text, and one tab stop: the selected tab; on the web Left and Right move and
 * select at once, wrapping, and Home and End jump. The content below is a TabPanel named by the selected tab.
 *
 * The look: each label in body-strong, ink-low, and ink-high when selected, over a 2 px accent underline that moves and
 * resizes to the chosen tab on the spring-snap for a pointer, and jumps for a key and under reduced motion (5.1: keyboard
 * actions do not animate). The underline is a border, which forced colours keep. The row scrolls sideways when the
 * labels are wider than the column and never wraps into two rows. Choosing a tab plays the selection haptic.
 */

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

export interface TabsProps<K extends string> {
  /** The tab list's name. */
  label: string;
  tabs: readonly TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** The id of the TabPanel the tabs control. */
  panelId: string;
}

/** A tab's id, which its panel is named by. */
export const tabId = (panelId: string, key: string): string => `${panelId}-tab-${key}`;

/** Where a key moves the selection among `count` tabs from `current`: Left and Right wrap, Home and End jump; null for any other key. */
export function tabMove(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Where a key moves the choice in a radio group of `count` radios from `current` (UI Task 8, section 6.11, after
 * WAI-ARIA's radio group pattern): Down and Right to the next, Up and Left to the one before, wrapping; null for any other
 * key, Home and End included, which the pattern does not give a radio group. kit/ListRow.tsx's RadioGroup moves the focus
 * and the choice together, at once, as Tabs does for its arrows.
 */
export function radioMove(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (current - 1 + count) % count;
  return null;
}

/** The underline is a bar this wide, scaled to the tab's width, so only its transform moves (5.1). */
const BAR = 100;

export function Tabs<K extends string>({ label, tabs, selected, onSelect, panelId }: TabsProps<K>) {
  const motion = useMotion();
  const haptic = useHaptics();
  const { colors } = useTheme();
  // Each tab's measured width. Its place is the sum of the widths before it (the tabs sit side by side with no gap),
  // since react-native-web reports a layout when a size changes and not when a tab only moves (a tab added before it).
  const widths = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const shown = useRef(false);

  // The underline goes to the selected tab once both are measured: on a spring for a pointer, at once for a key, under
  // reduced motion and the first time. A value already at its target is left alone (Reanimated would not start it).
  const order = tabs.map((tab) => tab.key).join(" ");
  useEffect(() => {
    const at = tabs.findIndex((tab) => tab.key === selected);
    const before = tabs.slice(0, at + 1).map((tab) => widths.current.get(tab.key));
    if (at < 0 || before.some((wide) => wide === undefined)) return;
    const frame = { x: before.slice(0, at).reduce<number>((sum, wide) => sum + wide!, 0), width: before[at]! };
    const still = !shown.current || motion.reduced || lastInputWasKeyboard();
    shown.current = true;
    for (const [value, target] of [
      [x, frame.x],
      [width, frame.width],
    ] as const) {
      if (value.value === target) continue;
      value.value = still ? target : withSpring(target, motion.spring("springSnap"));
    }
  }, [selected, measured, motion.reduced, order]);

  const bar = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ translateX: x.value + (width.value - BAR) / 2 }, { scaleX: width.value / BAR }],
  }));

  const choose = (key: K) => {
    if (key === selected) return;
    haptic("selection");
    onSelect(key);
  };

  // Left and Right select at once and move the focus with the selection; the underline jumps (a key never animates).
  const keys = (event: KeyboardEvent) => {
    const next = tabMove(
      tabs.findIndex((tab) => tab.key === selected),
      event.key,
      tabs.length,
    );
    if (next === null) return;
    event.preventDefault();
    const key = tabs[next]!.key;
    choose(key);
    (document.getElementById(tabId(panelId, key)) as HTMLElement | null)?.focus();
  };

  const measure = (key: K) => (event: LayoutChangeEvent) => {
    const wide = event.nativeEvent.layout.width;
    if (widths.current.get(key) === wide) return;
    widths.current.set(key, wide);
    setMeasured((count) => count + 1);
  };

  return (
    // The room around the row keeps each tab's focus ring inside the scroll view, which clips what overflows it.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4, paddingHorizontal: 4 }} className="-mx-1">
      <View role="tablist" aria-label={label} {...(Platform.OS === "web" ? ({ onKeyDown: keys } as object) : {})} className="flex-row">
        {tabs.map((tab) => {
          const on = tab.key === selected;
          return (
            <Pressable
              key={tab.key}
              nativeID={tabId(panelId, tab.key)}
              accessibilityRole="tab"
              aria-selected={on}
              aria-controls={panelId}
              tabIndex={on ? 0 : -1}
              onPress={() => choose(tab.key)}
              onLayout={measure(tab.key)}
              {...pressDelay(0)}
              className={cn("min-h-[44px] justify-center rounded-control px-3 pb-2.5 pt-2 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}
            >
              <Text variant="body-strong" tone={on ? "high" : "low"} maxFontSizeMultiplier={1.5}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
        <Animated.View
          pointerEvents="none"
          aria-hidden
          style={[{ position: "absolute", left: 0, bottom: 0, width: BAR, height: 0, borderTopWidth: 2, borderColor: colors.accent }, bar]}
        />
      </View>
    </ScrollView>
  );
}

/** The content under Tabs: a tab panel named by the selected tab. */
export function TabPanel({ panelId, selected, children }: { panelId: string; selected: string; children: ReactNode }) {
  return (
    <View role="tabpanel" nativeID={panelId} aria-labelledby={tabId(panelId, selected)} className="flex-1">
      {children}
    </View>
  );
}
```

### Replace `apps/app/src/components/security/MfaSection.tsx` (whole file)

```tsx
import { useState } from "react";
import { View } from "react-native";
import { RecoveryCodesResponse, TotpConfirmResponse, TotpSetupResponse, type MeResponse } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { QrCode } from "@/components/security/QrCode";
import { Body, Button, ErrorText, Field } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { SECURITY_WORDS } from "@/lib/settings-words";

type Stage = { kind: "idle" } | { kind: "setup"; otpauthUri: string; qrSvg: string } | { kind: "codes"; recoveryCodes: string[] } | { kind: "disable" };

const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;

/**
 * A hint to act on, in the review tone with its icon, so it does not rely on its colour (UI design, section 4.8): after a
 * recovery code was used, two-factor should be set up again for a fresh set.
 */
function Hint({ message }: { message: string }) {
  return (
    <View className="mt-3 flex-row items-start gap-2 rounded-control border border-review-ink/40 bg-review-wash px-3 py-2.5">
      <View className="pt-[3px]">
        <Icon name="review" size={16} tone="review-on-wash" />
      </View>
      <Text tone="review-on-wash" className="shrink">
        {message}
      </Text>
    </View>
  );
}

/**
 * Two-factor authentication on the Security screen (1c design): turning it on with an authenticator app's QR code or key
 * and its first code, the recovery codes once, new codes, and turning it off. On the tokens since UI Task 8 (8.8): the QR
 * code on a white plate, which a camera needs whatever the theme, and the key and the codes in the mono face.
 */
export function MfaSection({
  me,
  run,
  refresh,
  reenroll,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
  reenroll: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run(action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    act(async () => {
      const setup = await api("/api/auth/mfa/totp/setup", { method: "POST", schema: TotpSetupResponse });
      setCode("");
      setStage({ kind: "setup", ...setup });
    });

  const confirmSetup = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/totp/confirm", { json: { code: code.trim() }, schema: TotpConfirmResponse });
      setCode("");
      setStage({ kind: "codes", recoveryCodes });
      await refresh();
    });

  const regenerate = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/recovery-codes/regenerate", { method: "POST", schema: RecoveryCodesResponse });
      setStage({ kind: "codes", recoveryCodes });
    });

  // No code of its own (1c design, section 2): the route needs a level-2 re-authentication, which the panel provides, and the authenticator code given there already spent the current step.
  const disable = () =>
    act(async () => {
      await api("/api/auth/mfa/totp/disable", { json: {} });
      setStage({ kind: "idle" });
      await refresh();
    });

  if (stage.kind === "setup") {
    const secret = new URL(stage.otpauthUri).searchParams.get("secret") ?? "";
    return (
      <View>
        <Body>{SECURITY_WORDS.mfaSetup}</Body>
        {/* A literal white plate, not a theme's surface: a camera reads the code's dark squares only on light ground. */}
        <View className="mt-4 items-center self-center rounded-media border border-line-low bg-white p-3">
          <QrCode svg={stage.qrSvg} size={200} />
        </View>
        <Text variant="meta" tone="medium" className="mt-3">
          {SECURITY_WORDS.mfaKey}
        </Text>
        <Text variant="mono" selectable className="mt-1 web:break-all">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </Text>
        <Field label="Code from the app" mono autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={confirmSetup} />
        <ErrorText message={error} />
        <Button label="Turn on two-factor" onPress={confirmSetup} busy={busy} disabled={!/^[0-9]{6}$/.test(code.trim())} />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  if (stage.kind === "codes") {
    return (
      <View>
        <Body>{SECURITY_WORDS.mfaCodes}</Body>
        <View className="mt-4 flex-row flex-wrap gap-y-2 rounded-control border border-line-low bg-surface-2 p-4">
          {stage.recoveryCodes.map((c) => (
            <Text key={c} variant="mono" selectable className="w-1/2">
              {c}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            label={copied ? "Copied" : "Copy codes"}
            tone="secondary"
            onPress={() => {
              clipboard
                .writeText(stage.recoveryCodes.join(String.fromCharCode(10)))
                .then(() => setCopied(true))
                .catch(() => setError("Copying is not allowed here. Select the codes and copy them by hand."));
            }}
          />
        ) : null}
        <Button label="I saved my recovery codes" onPress={() => setStage({ kind: "idle" })} />
      </View>
    );
  }

  if (stage.kind === "disable") {
    return (
      <View>
        <Body>{SECURITY_WORDS.mfaDisable}</Body>
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? <Hint message="You used a recovery code. Set up two-factor again to get a fresh set of codes." /> : null}
      <Body>
        {me.user.mfaEnabled
          ? "Two-factor authentication is on. Signing in needs a code from your authenticator app."
          : me.user.role === "user"
            ? "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account."
            : "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key."}
      </Body>
      <ErrorText message={error} />
      {me.user.mfaEnabled ? (
        <>
          <Button label="Set up a new authenticator" onPress={() => void startSetup()} busy={busy} tone={reenroll ? "primary" : "secondary"} />
          <Button label="New recovery codes" onPress={() => void regenerate()} busy={busy} tone="secondary" />
          {me.user.role === "user" ? <Button label="Turn off two-factor" onPress={() => setStage({ kind: "disable" })} tone="danger" /> : null}
        </>
      ) : (
        <Button label="Turn on two-factor" onPress={() => void startSetup()} busy={busy} />
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/security/PasskeysSection.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, type MeResponse } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { NeutralChip, StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, Notice, SectionRows } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { NOT_MINE_WORDS } from "@/lib/lockdown-words";
import { createPasskey, passkeysSupported } from "@/lib/passkeys";
import { SECURITY_WORDS } from "@/lib/settings-words";
import { cn } from "@/theme/cn";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** What the registration's verify and a rename answer: the passkey as the list shows it. */
const PasskeyResponse = z.object({ passkey: PasskeyView });

/** The PasskeyName contract's limit (the display-name rules). */
const NAME_MAX = 50;

/** Ids come from the API's list; only a UUID may become part of a path. */
const passkeyPath = (id: string) => `/api/auth/passkeys/${encodeURIComponent(z.uuid().parse(id))}`;

/**
 * A short tag beside a passkey's name. It is an image to assistive technology, as the verified chip is: ARIA forbids
 * naming a generic element, and the label says what the one word means. A fact is a neutral chip; "suspended", the one
 * status, takes the restricted tone with its icon (UI Task 8, section 4.8), where it was red text before.
 */
function Tag({ label, meaning, tone = "plain" }: { label: string; meaning: string; tone?: "plain" | "bad" }) {
  const name = `${label}: ${meaning}`;
  return tone === "bad" ? <StatusChip tone="restricted" label={label} name={name} /> : <NeutralChip label={label} name={name} />;
}

/** A small action inside a row: its words in the accent, or in danger-ink when it ends something, on a 44 px target. */
function RowButton({ label, onPress, disabled, tone = "plain" }: { label: string; onPress: () => void; disabled: boolean; tone?: "plain" | "danger" }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className={cn("min-h-[44px] justify-center rounded-control px-2 active:opacity-70", FOCUS_RING)}>
      <Text variant="body-strong" tone={disabled ? "low" : tone === "danger" ? "danger" : "accent"}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One passkey of the list: its name and tags, its dates and device, and its actions; the rename is a field in place. */
export function PasskeyItem({
  passkey,
  busy,
  onRename,
  onRemove,
  onNotMine,
}: {
  passkey: PasskeyView;
  busy: boolean;
  /** Answers whether the new name was saved; the field stays for a retry otherwise. */
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
  onNotMine: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== passkey.name;

  // Enter in the field saves as the button does, so the button's conditions come first.
  async function save() {
    if (!ready || busy) return;
    if (await onRename(trimmed)) setRenaming(false);
  }

  // When it was added and last used, and the device that added it, joined by commas (section 4.1: no middle dots).
  const facts = [
    SECURITY_WORDS.passkeyAdded(new Date(passkey.createdAt).toLocaleDateString()),
    passkey.lastUsedAt ? SECURITY_WORDS.passkeyLastUsed(new Date(passkey.lastUsedAt).toLocaleString()) : SECURITY_WORDS.passkeyNeverUsed,
    ...(passkey.createdOn ? [SECURITY_WORDS.passkeyAddedOn(passkey.createdOn)] : []),
  ].join(", ");
  return (
    <View className="gap-1 border-b border-line-low px-4 pb-1 pt-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text variant="body-strong" className="min-w-0 shrink web:break-words">
          {passkey.name}
        </Text>
        {passkey.current ? <Tag label="used for this session" meaning="it signed you in here" /> : null}
        {passkey.isNew ? <Tag label="new" meaning="added in the last 7 days" /> : null}
        {passkey.suspended ? <Tag label="suspended" meaning="switched off because a copy of it may exist" tone="bad" /> : null}
        {passkey.synced ? <Tag label="synced" meaning="backed up by your password manager to your other devices" /> : null}
      </View>
      <Text variant="meta" tone="low">
        {facts}
      </Text>
      {renaming ? (
        <>
          <Field label="Name" autoComplete="off" maxLength={NAME_MAX} value={name} onChangeText={setName} onSubmitEditing={() => void save()} />
          <View className="-ml-2 mt-1 flex-row flex-wrap">
            <RowButton label="Save" onPress={() => void save()} disabled={!ready || busy} />
            <RowButton
              label="Cancel"
              onPress={() => {
                setRenaming(false);
                setName(passkey.name);
              }}
              disabled={busy}
            />
          </View>
        </>
      ) : (
        <View className="-ml-2 flex-row flex-wrap">
          <RowButton
            label="Rename"
            onPress={() => {
              // The field starts from the name the list shows now, not from an earlier edit.
              setName(passkey.name);
              setRenaming(true);
            }}
            disabled={busy}
          />
          <RowButton label="Remove" onPress={onRemove} disabled={busy} tone="danger" />
          {passkey.isNew ? <RowButton label="This wasn't me" onPress={onNotMine} disabled={busy} tone="danger" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * The dialog behind Add a passkey (1c design, section 9): the name korbat shows, optional, and the name the password
 * manager shows, prefilled with the handle, with one sentence on what that name reveals. Nothing is sent until Create.
 */
export function AddPasskeyDialog({
  handle,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  handle: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string | undefined, label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState(handle);
  const dialog = useRef<View>(null);
  // The dialog appears in reply to the Add button; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (dialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  const ready = label.trim().length > 0 && label.trim().length <= NAME_MAX && name.trim().length <= NAME_MAX;

  // Enter in a field creates as the button does, so the button's conditions come first.
  async function create() {
    if (!ready || busy) return;
    await onCreate(name.trim().length > 0 ? name.trim() : undefined, label.trim());
  }

  return (
    // An inset card on the page's surface inside the section's card, with a control's boundary: a question in place.
    <View ref={dialog} role="dialog" aria-labelledby="add-passkey-title" tabIndex={-1} className="mt-4 rounded-card border border-line-high bg-surface p-4">
      <Text as="h3" variant="title" nativeID="add-passkey-title">
        {SECURITY_WORDS.addTitle}
      </Text>
      <Text tone="medium" className="mt-1">
        {SECURITY_WORDS.addBody}
      </Text>
      <Field label="Name" autoComplete="off" maxLength={NAME_MAX} placeholder="For example Laptop or Phone" value={name} onChangeText={setName} />
      <Text variant="meta" tone="low" className="mt-1">
        {SECURITY_WORDS.addNameHint}
      </Text>
      <Field label="Name in your password manager" autoComplete="off" maxLength={NAME_MAX} value={label} onChangeText={setLabel} onSubmitEditing={() => void create()} />
      <Text variant="meta" tone="low" className="mt-1">
        {SECURITY_WORDS.addLabelHint}
      </Text>
      <ErrorText message={error} />
      <Button label="Create passkey" onPress={() => void create()} busy={busy} disabled={!ready} />
      <Button label="Cancel" onPress={onCancel} tone="secondary" />
    </View>
  );
}

/**
 * The Passkeys section of the Security screen (1c design, sections 7.3 and 7.5): the list, Add a passkey, Rename,
 * Remove, and "This wasn't me" on a new passkey, which explains the lockdown before running it. Adding and removing may
 * need level 2 on an account with two-factor, so they run through the re-authentication hook.
 */
export function PasskeysSection({ me, run, refresh, openAdd }: { me: MeResponse; run: Run; refresh: Refresh; openAdd: boolean }) {
  const supported = passkeysSupported();
  const [passkeys, setPasskeys] = useState<PasskeyView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The home screen's card opens the dialog at once; without support there is nothing to open.
  const [adding, setAdding] = useState(openAdd && supported);
  const [notMine, setNotMine] = useState<PasskeyView | null>(null);
  const lockdownDialog = useRef<View>(null);
  // The lockdown question appears in reply to "This wasn't me"; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    if (notMine) (lockdownDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [notMine]);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api("/api/auth/passkeys", { schema: PasskeyListResponse })).passkeys);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One request at a time for the section, through the re-authentication hook; answers whether the action went through, with its failure shown where `show` puts it. */
  async function act(action: () => Promise<void>, show: (message: string) => void = setError): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setDialogError(null);
    setDone(null);
    try {
      await run(action);
      return true;
    } catch (err) {
      show(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** A verify that fails after the browser created the passkey leaves one in the password manager that korbat does not know; the message says so. */
  function kept(err: unknown): ApiError {
    const sentence = " Your password manager may have kept a passkey that korbat does not know; you can delete it there.";
    return err instanceof ApiError ? new ApiError(err.status, err.code, err.message + sentence, err.retryAfter, err.details) : new ApiError(0, "internal", errorMessage(err) + sentence);
  }

  const create = (name: string | undefined, label: string) =>
    act(async () => {
      const { options } = await api("/api/auth/passkeys/register/options", { json: { label }, schema: PasskeyOptionsResponse });
      const response = await createPasskey(options);
      // The prompt was closed: the dialog stays, with nothing to say.
      if (response === null) return;
      try {
        await api("/api/auth/passkeys/register/verify", { json: { ...(name ? { name } : {}), response }, schema: PasskeyResponse });
      } catch (err) {
        throw kept(err);
      }
      setAdding(false);
      setDone("Passkey added. An email about it is on its way, with a link that removes it in case this was not you.");
      await load();
      // The count in the session decides whether the home screen suggests a passkey and the panel offers one.
      await refresh();
    }, setDialogError);

  const rename = (passkey: PasskeyView, name: string) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "PATCH", json: { name }, schema: PasskeyResponse });
      await load();
    });

  const remove = (passkey: PasskeyView) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "DELETE" });
      setDone(`The passkey named ${passkey.name} was removed.`);
      await load();
      await refresh();
    });

  const lockDown = (passkey: PasskeyView) =>
    act(async () => {
      await api(`${passkeyPath(passkey.id)}/not-mine`, { method: "POST" });
      // The API signed this session out with every other and cleared its cookies; the session reloads as signed out.
      await refresh();
      router.replace("/signin");
    });

  return (
    <View>
      <Body>{SECURITY_WORDS.passkeysBody}</Body>
      {passkeys === null ? (
        <Text tone="low" className="mt-3">
          {SECURITY_WORDS.passkeysLoading}
        </Text>
      ) : null}
      {passkeys?.length === 0 ? (
        <Text tone="low" className="mt-3">
          {SECURITY_WORDS.passkeysNone}
        </Text>
      ) : null}
      {/* The passkeys as rows from edge to edge of the section's card, each with its tags, its facts and its actions. */}
      {passkeys !== null && passkeys.length > 0 ? (
        <SectionRows>
          {passkeys.map((passkey) => (
            <PasskeyItem key={passkey.id} passkey={passkey} busy={busy} onRename={(name) => rename(passkey, name)} onRemove={() => void remove(passkey)} onNotMine={() => setNotMine(passkey)} />
          ))}
        </SectionRows>
      ) : null}
      {notMine ? (
        <View ref={lockdownDialog} role="dialog" aria-labelledby="not-mine-title" tabIndex={-1} className="mt-4 rounded-card border border-line-high bg-surface p-4">
          <Text as="h3" variant="title" nativeID="not-mine-title">
            {NOT_MINE_WORDS.title}
          </Text>
          {/* What the lockdown reaches, as it is: from the day before this passkey to now, which can be a week, the person's own additions since included. */}
          <Text tone="medium" className="mt-1">
            {NOT_MINE_WORDS.body(notMine.name)}
          </Text>
          <Button label="Sign out everywhere and lock down" onPress={() => void lockDown(notMine)} busy={busy} tone="danger" />
          <Button label="Cancel" onPress={() => setNotMine(null)} tone="secondary" />
        </View>
      ) : null}
      <ErrorText message={error} />
      <Notice message={done} />
      {!supported ? (
        <Body>{SECURITY_WORDS.passkeysUnsupported}</Body>
      ) : adding ? (
        <AddPasskeyDialog
          handle={me.profile?.handle ?? ""}
          busy={busy}
          error={dialogError}
          onCreate={async (name, label) => {
            await create(name, label);
          }}
          onCancel={() => {
            setAdding(false);
            setDialogError(null);
          }}
        />
      ) : (
        <Button label="Add a passkey" onPress={() => setAdding(true)} tone="secondary" />
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/security/ReauthPanel.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { FlowResponse, PasskeyOptionsResponse, ReauthResponse, type MeResponse, type ReauthRequest } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { Body, Button, ErrorText, Field, TextLink } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { confirmWithPasskey, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { SECURITY_WORDS } from "@/lib/settings-words";
import { cn } from "@/theme/cn";

type Action = () => Promise<void>;

/** The factor kinds a session can have proven (1c design, section 7.1), as the API names them. */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";

/** What a reauth_required refusal says: the level the action needs, and the factors proven within the last five minutes. */
export interface ReauthNeeded {
  level: 1 | 2;
  have: FactorKind[];
}

const Needed = z.object({ level: z.union([z.literal(1), z.literal(2)]), have: z.array(z.enum(["email", "password", "passkey", "passkey_uv", "totp", "recovery"])) });

/** Reads a refusal's details; an answer without them, or in a shape this app does not know, counts as level 1 with nothing proved. */
export function reauthNeeded(err: ApiError): ReauthNeeded {
  const parsed = Needed.safeParse(err.details);
  return parsed.success ? parsed.data : { level: 1, have: [] };
}

/** What the panel keeps for the action it will run again: the action, and what its refusal said is needed. */
export interface Pending {
  action: Action;
  needed: ReauthNeeded;
}

/**
 * Runs a sensitive action. When the server answers `reauth_required`, the action is kept, with what the refusal said
 * is needed, so the re-authentication panel can run it again once the person has confirmed it's them.
 */
export function useReauth() {
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useCallback(async (action: Action) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        setPending({ action, needed: reauthNeeded(err) });
        return;
      }
      throw err;
    }
  }, []);
  const clear = useCallback(() => setPending(null), []);
  return { pending, run, clear };
}

export type Method = "password" | "passkey" | "totp" | "email" | "recovery";

const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
const SECOND: readonly FactorKind[] = ["totp", "recovery"];
/** The methods that prove a first factor and those that prove a second; a passkey is in both, since a device that verifies the person makes it count as two. */
const PROVES_FIRST: readonly Method[] = ["password", "passkey", "email"];
const PROVES_SECOND: readonly Method[] = ["passkey", "totp", "recovery"];

/**
 * Which methods the panel offers (1c design, section 9): every one the account has at level 1; at level 2, only what
 * closes the gap the factors in `have` leave (a second factor after a first, a first after a second), and every one
 * when nothing was proved in time or nothing the account has would close it.
 */
export function methodsForLevel(needed: ReauthNeeded, available: Method[]): { methods: Method[]; missing: "first" | "second" | null } {
  if (needed.level === 2) {
    const hasFirst = needed.have.some((kind) => FIRST.includes(kind));
    const hasSecond = needed.have.some((kind) => SECOND.includes(kind));
    const missing = hasFirst && !hasSecond ? "second" : hasSecond && !hasFirst ? "first" : null;
    const proves = missing === "second" ? PROVES_SECOND : missing === "first" ? PROVES_FIRST : null;
    const methods = proves ? available.filter((method) => proves.includes(method)) : available;
    if (missing && methods.length > 0) return { methods, missing };
  }
  return { methods: available, missing: null };
}

/**
 * What the panel starts from for a refusal: what the refusal said is needed, the first method that closes the gap, and
 * nothing typed, mailed or refused yet. The same at mount and whenever another action's refusal takes the panel over.
 */
export function panelStart(needed: ReauthNeeded, available: Method[]): { needed: ReauthNeeded; method: Method; value: string; flowId: string | null; error: string | null } {
  return { needed, method: methodsForLevel(needed, available).methods[0]!, value: "", flowId: null, error: null };
}

/**
 * Whether the panel owes the hint to set two-factor up again: once any answer of its life spent a recovery code, whatever
 * was answered before or after it. `before` is what the earlier answers left.
 */
export function recoveryCodeSpent(before: boolean, answer: { mustReenrollMfa?: boolean }): boolean {
  return before || answer.mustReenrollMfa === true;
}

/** The hint after a recovery code was used, in the words of the Security screen's two-factor section. */
export const REENROLL_HINT = "You used a recovery code. Set up two-factor again to get a fresh set of codes.";

/**
 * The hint on a screen that has no two-factor section of its own (Account, Profile): shown once the panel set the
 * parameter on the route, with a link to Security, where two-factor is set up. The screen stays as it is, with what the
 * action just put on it.
 */
export function ReenrollNotice({ me }: { me: MeResponse }) {
  const { reenroll } = useLocalSearchParams<{ reenroll?: string }>();
  if (reenroll !== "1" || !me.user.mfaEnabled) return null;
  // A hint to act on: the review tone with its icon, so it does not rely on its colour (UI design, section 4.8).
  return (
    <View className="mt-6 rounded-card border border-review-ink/40 bg-review-wash px-4 pt-3">
      <View className="flex-row items-start gap-2">
        <View className="pt-[3px]">
          <Icon name="review" size={16} tone="review-on-wash" />
        </View>
        <Text tone="review-on-wash" className="shrink">
          {REENROLL_HINT}
        </Text>
      </View>
      <View className="-mt-3 items-start">
        <TextLink label="Open Security" href="/settings/security?reenroll=1" />
      </View>
    </View>
  );
}

const LABELS: Record<Method, string> = { password: "Password", passkey: "Passkey", totp: "Authenticator code", email: "Email code", recovery: "Recovery code" };

export function ReauthPanel({ me, pending, onClose }: { me: MeResponse; pending: Pending; onClose: () => void }) {
  const { refresh } = useSession();
  // The methods the account has, in the order the chips show them; a passkey only where the browser can use one.
  const available: Method[] = [
    ...(me.user.hasPassword ? (["password"] as const) : []),
    ...(me.user.passkeys > 0 && passkeysSupported() ? (["passkey"] as const) : []),
    ...(me.user.mfaEnabled ? (["totp"] as const) : []),
    "email",
    ...(me.user.mfaEnabled ? (["recovery"] as const) : []),
  ];
  const start = panelStart(pending.needed, available);
  // What the last refusal said is needed; the action's own refusal after a first answer replaces it.
  const [needed, setNeeded] = useState(start.needed);
  const { methods, missing } = methodsForLevel(needed, available);
  const [method, setMethod] = useState<Method>(start.method);
  const [value, setValue] = useState(start.value);
  const [flowId, setFlowId] = useState(start.flowId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(start.error);
  // The screens render one panel for whatever refusal is pending, so another action refused while this one is open
  // hands the same panel a new refusal. It starts over from that one, here rather than in an effect, so that no frame
  // shows the old refusal's sentence and methods above an action that needs something else.
  const [asked, setAsked] = useState(pending);
  if (asked !== pending) {
    const next = panelStart(pending.needed, available);
    setAsked(pending);
    setNeeded(next.needed);
    setMethod(next.method);
    setValue(next.value);
    setFlowId(next.flowId);
    setError(next.error);
  }
  // Whether an answer of this panel's life spent a recovery code. A ref, since the answer's own result is gone when the
  // action is refused again (the code was the first of two answers) or fails, and the hint is due all the same.
  const recoveryUsed = useRef(false);
  const panel = useRef<View>(null);
  // The panel appears in reply to an action elsewhere on the page, and so does each refusal that takes it over; focus
  // moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (panel.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [pending]);

  /**
   * Closes the panel, after the action went through and on Cancel alike. A recovery code works once, so after one
   * two-factor should be set up again for a fresh set: the hint is a parameter set on the route the screen is on, which
   * keeps the screen mounted, with what the action just showed (new recovery codes, a QR code, the field for a mailed
   * code). Replacing the route would build the screen anew and lose that.
   */
  function close() {
    onClose();
    if (recoveryUsed.current) router.setParams({ reenroll: "1" });
  }

  async function sendEmailCode() {
    setBusy(true);
    setError(null);
    try {
      setFlowId((await api("/api/auth/reauth/email/start", { method: "POST", schema: FlowResponse })).flowId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Sends one answer, then runs the action. A web session got fresh cookies with the answer, and a native client would
   * keep the token it carries; the session is reloaded so the app follows what the answer changed. When the action is
   * refused again, the level rose past what one answer gave, and the panel asks for what is still missing.
   */
  async function answer(body: ReauthRequest) {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/reauth", { json: body, schema: ReauthResponse });
      recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);
      setValue("");
      await refresh();
      try {
        await pending.action();
      } catch (err) {
        if (err instanceof ApiError && err.code === "reauth_required") {
          const next = reauthNeeded(err);
          setNeeded(next);
          setMethod(methodsForLevel(next, available).methods[0]!);
          setFlowId(null);
          return;
        }
        throw err;
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** The passkey method: the account's usable passkeys in the options, the browser's prompt, and the response as the answer. */
  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api("/api/auth/reauth/passkey/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      // The prompt was closed: nothing to say.
      if (response === null) return;
      await answer({ method: "passkey", response });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Enter in the field confirms as the button does, so the button's condition comes first.
  async function confirm() {
    const typed = value.trim();
    if (typed.length === 0) return;
    if (method === "password") return answer({ method: "password", password: value });
    if (method === "totp") return answer({ method: "totp", code: typed });
    if (method === "recovery") return answer({ method: "recovery", recoveryCode: typed.toLowerCase() });
    if (flowId) return answer({ method: "email", flowId, code: typed });
    return undefined;
  }

  const explanation = missing === "second" ? SECURITY_WORDS.reauthSecond : missing === "first" ? SECURITY_WORDS.reauthFirst : "";

  return (
    // A floating card in the review tone's ink at its edge: the screen asks for something before the action goes on.
    <View ref={panel} role="dialog" aria-labelledby="reauth-title" tabIndex={-1} className="mt-6 rounded-card border border-review-ink/40 bg-surface-1 p-4">
      <Text as="h2" variant="title" nativeID="reauth-title">
        {SECURITY_WORDS.reauthTitle}
      </Text>
      <Text tone="medium" className="mt-1">
        {`${needed.level === 2 ? SECURITY_WORDS.reauthTwo : SECURITY_WORDS.reauthFresh}${explanation}${SECURITY_WORDS.reauthValid}`}
      </Text>
      {/* The methods as pressed or unpressed buttons: the chosen one filled with the accent, the others outlined. Each is a
          native button with its words as its only content, 44 px tall, the outline drawn by the focus ring's rule. */}
      <View className="mt-4 flex-row flex-wrap gap-2">
        {methods.map((m) => (
          <Text
            key={m}
            accessibilityRole="button"
            aria-pressed={m === method}
            onPress={() => {
              setMethod(m);
              setValue("");
              setError(null);
            }}
            variant="body-strong"
            tone={m === method ? "on-accent" : "high"}
            className={cn("min-h-[44px] items-center justify-center rounded-full border px-4 py-2.5 text-center web:inline-flex web:cursor-pointer", m === method ? "border-accent bg-accent" : "border-line-high bg-surface-1 web:hover:bg-surface-2", FOCUS_RING)}
          >
            {LABELS[m]}
          </Text>
        ))}
      </View>
      {method === "passkey" ? (
        <>
          <Body>{SECURITY_WORDS.reauthPasskey}</Body>
          <Button label="Use a passkey" onPress={() => void passkey()} busy={busy} />
        </>
      ) : method === "email" && !flowId ? (
        <Button label="Email me a code" onPress={() => void sendEmailCode()} busy={busy} tone="secondary" />
      ) : (
        <>
          <Field
            label={LABELS[method]}
            secureTextEntry={method === "password"}
            autoComplete={method === "password" ? "current-password" : method === "recovery" ? "off" : "one-time-code"}
            autoCapitalize={method === "recovery" ? "none" : undefined}
            inputMode={method === "password" || method === "recovery" ? "text" : "numeric"}
            maxLength={method === "recovery" ? 14 : undefined}
            placeholder={method === "recovery" ? "abcd-efgh-ijkl" : undefined}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => void confirm()}
          />
          <Button label="Confirm" onPress={() => void confirm()} busy={busy} disabled={value.trim().length === 0} />
        </>
      )}
      <ErrorText message={error} />
      <Button label="Cancel" onPress={close} tone="secondary" />
    </View>
  );
}
```

### Replace `apps/app/src/components/security/SessionsSection.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { SessionsResponse, type SessionInfo } from "@korbat/contracts";
import { ListRow } from "@/components/kit/ListRow";
import { NeutralChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { Button, buttonFace, ErrorText, LABEL_TONE, SectionRows } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { SECURITY_WORDS } from "@/lib/settings-words";

/** A session's Sign out, a secondary button beside its row's words, with no margin of its own (Button has one). */
function SignOut({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={buttonFace({ face: "secondary", size: "md" })}>
      <Text variant="body-strong" tone={LABEL_TONE.secondary}>
        {SECURITY_WORDS.sessionSignOut}
      </Text>
    </Pressable>
  );
}

/**
 * Where the account is signed in (1b design), on the Security screen: each session a row of its own (UI Task 8, 8.8),
 * its device and its platform, when it signed in and was last active, "this device" as a neutral chip on the session in
 * use, and Sign out on every other; then Sign out everywhere, which runs through the re-authentication hook.
 */
export function SessionsSection({ run, refresh }: { run: (action: () => Promise<void>) => Promise<void>; refresh: () => Promise<unknown> }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions((await api("/api/auth/sessions", { schema: SessionsResponse })).sessions);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/api/auth/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    setError(null);
    try {
      await run(async () => {
        await api("/api/auth/sessions/revoke-all", { method: "POST" });
        await refresh();
        router.replace("/");
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {sessions === null ? (
        <Text tone="low" className="mt-3">
          {SECURITY_WORDS.sessionsLoading}
        </Text>
      ) : (
        <SectionRows>
          {sessions.map((s) => (
            <ListRow
              key={s.id}
              info
              label={s.deviceLabel}
              description={SECURITY_WORDS.sessionFacts(SECURITY_WORDS.platform[s.platform], new Date(s.createdAt).toLocaleDateString(), new Date(s.lastUsedAt).toLocaleString())}
              badge={s.current ? <NeutralChip label={SECURITY_WORDS.thisDevice} /> : undefined}
              control={s.current ? undefined : { kind: "button", element: <SignOut onPress={() => void revoke(s.id)} /> }}
            />
          ))}
        </SectionRows>
      )}
      <ErrorText message={error} />
      <Button label="Sign out everywhere" onPress={() => void signOutEverywhere()} busy={busy} tone="danger" />
    </>
  );
}
```

### Replace `apps/app/src/components/ui.tsx` (whole file)

```tsx
import { cva } from "class-variance-authority";
import type { ReactNode, Ref } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Animated from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, pressDelay } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text, textStyle, type Tone } from "@/components/kit/Text";
import { useAppearance } from "@/lib/appearance";
import { useMotion, usePressScale, usePulse, useSpin } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The twelve building blocks the screens have used since the first sub-projects, kept with their names and props
 * because tests import them and pin lines of them (UI design, section 6.1), and redrawn on korbat's kit: the tokens of
 * theme/, the Text and Icon components, the pressed scale of lib/motion.ts and the words of lib/ui-words.ts.
 */

/** A centred column on the page's surface, used by every auth screen. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-surface px-6 py-10">
      <View className="w-full max-w-sm">{children}</View>
    </View>
  );
}

/** A screen's title: its one level-1 heading, in the display face. */
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text as="h1" variant="display-2">
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return (
    <Text tone="medium" className="mt-2">
      {children}
    </Text>
  );
}

/**
 * A titled box on a settings screen, a card on the page; the title is a heading one level under the screen's own, and
 * `id` names it for a radio group it heads. UI Task 8 (8.8): its padding is the 16 px gutter of the rows and the screen,
 * and it clips what reaches its edges to its corners, so SectionRows can run from edge to edge.
 */
export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <View className="mt-8 overflow-hidden rounded-card border border-line-low bg-surface-1 p-4">
      <Text as="h2" variant="title" nativeID={id}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * ListRows inside a Section, from edge to edge of the card under a line-low rule (UI Task 8, 8.8: "each Section becomes a
 * card group of ListRows and fields"). `end` when the rows end the card: they then run under its padding, and the last
 * row's own divider goes under the card's border, so one line closes the card.
 */
export function SectionRows({ end = false, children }: { end?: boolean; children: ReactNode }) {
  return <View className={cn("-mx-4 mt-3 border-t border-line-low", end ? "-mb-[17px]" : undefined)}>{children}</View>;
}

/**
 * The verified badge after a display name: the account proved it holds a phone number that no other
 * account uses. The label says what the one word means to a screen reader. The chip is an image to
 * assistive technology: ARIA forbids naming an element without a role, and screen readers ignore such
 * a name, while an image is announced by it. It is StatusChip's information-only form, in the verified tone.
 */
export function VerifiedChip() {
  return <StatusChip tone="verified" label={UI_WORDS["verified.label"]} name={UI_WORDS["verified.name"]} className="self-center" />;
}

/**
 * A labelled text field. `ref` reaches the input itself, whose focus() moves the browser's focus to it. Its text is the
 * body variant at the reader's step and font (textStyle()), its placeholder ink-low, which reads at 6.29:1 or more on
 * surface-1 in every theme.
 */
export function Field({ label, ref, style, mono = false, ...input }: { label: string; ref?: Ref<TextInput>; mono?: boolean } & TextInputProps) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  return (
    <View className="mt-6 gap-2">
      <Text variant="body-strong" tone="medium">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors["ink-low"]}
        className={cn("min-h-[44px] rounded-control border border-line-high bg-surface-1 px-4 py-3 text-ink-high", FOCUS_RING)}
        // A code or a handle is set in the mono face (UI Task 8, 8.10), so 1 and l, 0 and O differ.
        style={[textStyle(mono ? "mono" : "body", { step: appearance.textStep, font: appearance.font }), style]}
        {...input}
      />
    </View>
  );
}

/**
 * Button's faces (section 6.4): the accent fill for the primary action, surface-1 with a line-high border for a second
 * one, the danger fill for a destructive one, and surface-2 with ink-low while it cannot be used, still readable because
 * its label may carry the reason ("Describe every image"). Each face sets its colours once, so no two classes fight.
 */
export const buttonFace = cva(cn("flex-row items-center justify-center gap-2 rounded-control border px-4 web:transition-colors web:duration-[120ms] web:ease-[ease]", FOCUS_RING), {
  variants: {
    face: {
      primary: "border-accent bg-accent web:hover:bg-accent/90",
      secondary: "border-line-high bg-surface-1 web:hover:bg-surface-2",
      danger: "border-danger bg-danger web:hover:bg-danger/90",
      inactive: "border-surface-2 bg-surface-2",
    },
    size: { md: "min-h-[44px] py-2", lg: "min-h-[52px] py-3" },
  },
});

export type ButtonFace = "primary" | "secondary" | "danger" | "inactive";

/** The label's tone on each face: on-accent on the accent, on-danger on the danger fill, ink-low on an inactive one. */
export const LABEL_TONE: Record<ButtonFace, Tone> = { primary: "on-accent", secondary: "high", danger: "on-danger", inactive: "low" };

/**
 * A button, full width by default as inside a form. `ref` reaches the pressable itself, whose focus() moves the
 * browser's focus to it. It scales to 0.97 from pointer-down (section 5.2; reduced, not at all). While `busy` it says
 * "Please wait..." and is busy and disabled. Nothing inside it that closes a div comes before the label (the icon is a
 * bare svg), since tests read a button's text up to its first closing div.
 */
export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "primary",
  size = "md",
  icon,
  full = true,
  ref,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  /** md is 44 px tall at least, lg 52 px. */
  size?: "md" | "lg";
  icon?: IconName;
  full?: boolean;
  ref?: Ref<View>;
}) {
  const press = usePressScale(0.97);
  const inactive = disabled || busy;
  const face: ButtonFace = inactive ? "inactive" : tone;
  return (
    // Not full, the button keeps to its words: it sits at the start of a stretching parent and where a centring one puts it.
    <View className={cn("mt-6", full ? "self-stretch" : "items-start")}>
      <Animated.View style={press.style}>
        <Pressable ref={ref} accessibilityRole="button" aria-busy={busy} disabled={inactive} onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size })}>
          {icon !== undefined ? <Icon name={icon} size={20} tone={LABEL_TONE[face]} /> : null}
          <Text variant="body-strong" tone={LABEL_TONE[face]} className="shrink text-center">
            {busy ? UI_WORDS["button.busy"] : label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A text link's target: 44 px tall around its words, dimmed while pressed, its underline thicker under a fine pointer. */
const TEXT_TARGET = cn("group mt-6 min-h-[44px] justify-center self-center rounded-control px-1 active:opacity-70", FOCUS_RING);
const TEXT_WORDS = "text-center underline web:underline-offset-2 web:group-hover:decoration-2";

/**
 * A small link under a form. It is a real anchor (expo-router's Link), so it opens with Enter, in a
 * new tab with a modifier key, and by every other means a link works. `onPress` runs before the
 * navigation, for a flow that has to forget its state first. Accent ink, underlined, at body size.
 */
export function TextLink({ label, href, replace = false, onPress }: { label: string; href: Href; replace?: boolean; onPress?: () => void }) {
  return (
    <Link href={href} replace={replace} onPress={onPress} asChild>
      <Pressable className={TEXT_TARGET}>
        <Text tone="accent" className={TEXT_WORDS}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/** The same look for an action that is not a destination, such as switching a form's mode. */
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={TEXT_TARGET}>
      <Text tone="accent" className={TEXT_WORDS}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A form's error, announced as it appears, with the error icon so it never relies on its colour (section 4.8). */
export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" className="mt-4 flex-row items-start gap-2">
      <View className="pt-[3px]">
        <Icon name="error" size={16} tone="danger" />
      </View>
      <Text tone="danger" className="shrink">
        {message}
      </Text>
    </View>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View className="mt-4 rounded-card border border-line-low bg-surface-1 px-4 py-3">
      <Text tone="medium">{message}</Text>
    </View>
  );
}

/**
 * The centred spinner of the auth screens and the guard layouts (sections 5.2 and 6.12), in the accent on the page: a
 * ring with a fainter quarter, one turn every 800 ms; under reduced motion it does not turn and pulses instead. Screens
 * inside the shell show skeleton rows instead (kit/Skeleton.tsx).
 */
export function Loading() {
  const motion = useMotion();
  const spin = useSpin();
  const pulse = usePulse({ on: motion.reduced, still: false });
  return (
    <View className="flex-1 items-center justify-center bg-surface">
      <View accessibilityRole="progressbar" accessibilityLabel={UI_WORDS["spinner.label"]}>
        <Animated.View style={motion.reduced ? pulse : spin}>
          <View className="h-7 w-7 rounded-full border-[3px] border-x-accent border-b-accent border-t-accent/20" />
        </Animated.View>
      </View>
    </View>
  );
}
```

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
import {
  ACCOUNT_MEASURE_SCOPE,
  APPEAL_MONTHS,
  AUTOMATION_RULES,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  ORDER_RULES,
  OUTCOME_PHRASES,
  RECIPIENT_RULES,
  REPLY_AIM_HOURS,
  RETENTION,
  RETIRED_HANDLE_PREFIX,
  REVERSAL_KINDS,
  STANDING_RULES,
  STATE_FACTS,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
  type StateFacts,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

/** The terms page's own words around its sections (UI Task 7), word for word as app/terms.tsx had them in its markup. */
export const TERMS_PAGE = {
  title: "korbat terms",
  version: (version: string) => `Version ${version}`,
  back: "Back to korbat",
} as const;

/**
 * The moderation sections (3c design, section 9) state each rule of the mechanism once more, for the people it is
 * applied to. So that the text cannot drift from the mechanism, nothing it shares with the mechanism is typed here: every
 * limit and period is printed from the contracts' constants, the rules from the rulebook, the measures from the ledger's
 * own table and an answer's phrases from the table the mails and the screens read. A test changes those constants and
 * finds the terms changed with them (test/terms.test.tsx). 3e's sections (design, W.7) print every number of account
 * sanctions from STANDING_RULES, the days after which a mail is given up from RETENTION.mailGiveUpDays and the hours
 * korbat aims to answer a reply in from REPLY_AIM_HOURS, which the code that acts on each reads.
 */

/** A section's paragraphs are kept in one text, a blank line between two. */
const PARAGRAPH_BREAK = String.fromCharCode(10, 10);
const paragraphs = (...parts: string[]): string => parts.join(PARAGRAPH_BREAK);

/** A section's body as its paragraphs, for the page to set apart. */
export function termsParagraphs(body: string): string[] {
  return body.split(PARAGRAPH_BREAK);
}

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/** A share as the terms print it: half as a word, any other share as a percentage, so the sentence follows the constant. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/** A list inside a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** A rule's name inside a sentence: its title in the rulebook without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");

/** The rules whose final decisions only an admin takes, as the rulebook marks them. */
const ADMIN_RULES = orList(RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id));

/** The rule on doxxing, whose restricted content is erased once the restriction is final, as a sentence names it. */
const R4 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R4");
  if (!rule) throw new Error("the rulebook holds no rule R4");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/**
 * What each measure does, beside its label. A measure added to the ledger does not compile until it is explained here.
 * 3e's six (design, W.1) point to the section that says the rest; W.7 has no words for them, so these are written here.
 */
const MEASURE_MEANINGS: Record<MeasureKind, string> = {
  withhold: "the post is hidden from other people; you still see it",
  remove: "the post is removed for other people; it stays in your own view while you keep it",
  seal_media: "the images the case covers are shown to nobody, you included",
  withhold_media: "one image of a post is hidden from other people; you still see it",
  remove_media: "one image of a post is removed for other people; it stays in your own view",
  reset_display_name: "the display name is replaced by the account's handle",
  reset_bio: "the bio is emptied",
  strike: "a mark on the account that restricts nothing by itself and counts toward a suspension, as Strikes says",
  suspend: "for a number of days the account can no longer post, engage, follow, edit its profile or report under the rules, as Suspension and termination says",
  terminate: "the account is suspended until the decision is final, and then deleted, as Suspension and termination says",
  retire_handle: "the handle can be used by nobody again, and the profile shows a placeholder in its place, as Handles says",
  warn_reporting: "a warning about reports that are manifestly unfounded, which restricts nothing, as Reporting in bad faith says",
  restrict_reporting: "for a number of days korbat takes no report under its rules from the account, as Reporting in bad faith says",
  // 3f: no decision of korbat's takes it; only an authority's order does, which the terms' sections on orders describe.
  // 3f's review (people5): a DSA order that does not ask that the post be kept from its author leaves it to them.
  disable_by_order: "the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it",
};

/** The measures of one sentence, each by the label its decision records and what it does. */
const measureList = (kinds: readonly MeasureKind[]): string => kinds.map((kind) => `"${MEASURES[kind].label}" (${MEASURE_MEANINGS[kind]})`).join("; ");
// The ledger's own two marks sort the measures into the three sentences; every kind of the ledger is listed.
const WHILE_DECIDING = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && !MEASURES[kind].final);
const WHEN_DECIDED = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && MEASURES[kind].final);
const EITHER = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && MEASURES[kind].final);
// 3f: the measure no decision of korbat's own takes, which an authority's order alone does.
const BY_ORDER = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && !MEASURES[kind].final);
const LIFTED = REVERSAL_KINDS.map((kind) => `"${MEASURES[kind].label}"`).join("; ");

/**
 * Every measure of the ledger with its label and what it does, sorted by when korbat may take it. 3d Task 4 (design,
 * section 9.2): the rules page prints the same paragraph under "What korbat can do, and when", so it is exported.
 */
export const MEASURES_PARAGRAPH = `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. On an authority's order alone, never on korbat's own judgement: ${measureList(BY_ORDER)}. A later decision can lift each of them again: ${LIFTED}.`;

/** What each outcome of a report means. An outcome added to the contracts does not compile until it is explained here. */
const OUTCOME_MEANINGS: Record<ItemOutcome, string> = {
  restricted_rule: "a moderator found that the item breaks the rule the answer names, and korbat restricted it.",
  restricted_legal: "a moderator found the item illegal under EU law or the law of an EU country, and korbat restricted it everywhere.",
  no_violation: "a moderator found that the item breaks no rule and is not illegal, and korbat left it as it was.",
  not_evident:
    'this is what "illegality not evident" means: a moderator found no breach of a rule and could not tell from the item and from what you wrote, without a detailed legal examination, that it is illegal. korbat does not settle legal disputes; it leaves such an item up, and a court or an authority can order its removal.',
  not_available: "the link named no post or profile that korbat can show: it does not exist, or its author deleted it. This answer is given automatically, and no person looked at the link.",
  partly_reversed: "on its author's appeal or by a correction, korbat lifted part of what it had done about the item.",
  reversed: "on its author's appeal or by a correction, korbat lifted all of what it had done about the item.",
};

/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");

/** One paragraph for each phrase an answer can read, with what it means: the seven outcomes, then the three that stand in for them where nobody opened the images. */
const ANSWERS: string[] = [
  ...ITEM_OUTCOMES.map((outcome) => `"${quoted(OUTCOME_PHRASES[outcome])}": ${OUTCOME_MEANINGS[outcome]}`),
  `"${SUSPECT_OUTCOME_PHRASES.sealed}": korbat's answer to a report on the anonymous path, and to any other report that the same decision answers, when images were sealed. It never says that korbat found something about the images, since nobody at korbat opened them.`,
  `"${SUSPECT_OUTCOME_PHRASES.no_action}": korbat's answer to a report on the anonymous path when an admin sealed nothing and restricted nothing.`,
  `"${UNSEEN_NO_ACTION}": korbat's answer to a report on another ground about a post, when a moderator took no action while nobody at korbat could open the post's images. It does not use up your one request for a re-examination.`,
];

const COURTS = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

/**
 * 3e's four sections (design, W.7), in the design's words, each number printed from the constant the code that acts on
 * it reads: STANDING_RULES for the standing rules, RETENTION.mailGiveUpDays for the days after which a mail is given up,
 * REPLY_AIM_HOURS for korbat's aim in answering a reply, APPEAL_MONTHS for the appeal. The placeholder's prefix is the
 * handle rule's own.
 */
const S = STANDING_RULES;
const [FIRST_RUNG, SECOND_RUNG, THIRD_RUNG] = S.ladderDays;

// 3d Task 4 (design, section 9.2): the rules page prints these three sections and Terrorist content with the same
// builders, so one number has one sentence in both places (a table test holds both).
export const STRIKES = `When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike. A strike restricts nothing by itself and is used for one thing: counting toward a suspension. It counts for ${count(S.strikeDays, "day")} from its decision. A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding. A post gets at most one strike, and a post you made before you were told of your newest strike gets none, so several posts decided in one sitting count as one warning. A strike also counts when the post was already removed or deleted. The decision's statement tells you of the strike, until when it counts and how many you have; your strikes are listed under Settings, Cases. A strike falls only with its decision: appeal that decision, and if it is reversed the strike stops counting at once, and a suspension that rested on it ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand. If that suspension was already over, it no longer counts toward a later one.`;

export const SUSPENSION = paragraphs(
  `When your account has ${numberWord(S.ladderStrikes)} active strikes at once, a moderator may decide to suspend it: for at most ${count(FIRST_RUNG, "day")} the first time, ${numberWord(SECOND_RUNG)} the second and ${numberWord(THIRD_RUNG)} the third, counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}. A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step. After a suspension, one further strike is enough for the next step while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count. After ${numberWord(S.ladderDays.length)} such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides. Nothing happens automatically: a moderator reads the strikes and decides. Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.`,
  `korbat tells you first. The decision is always shown in the app with its reasons, and korbat also sends it to you by email. The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for ${count(RETENTION.mailGiveUpDays, "day")}, only the app can tell you, and the suspension starts ${count(S.undeliveredHours, "hour")} after the decision. korbat cannot see whether an email it sent reached you, so keep the address of your account current. The app shows the start as a date and time. If you reply before the start, it does not start until a moderator has read your reply and answered you; the answer reverses the decision, or keeps it, and then the suspension starts with the answer and never before the time you were first given. A reply sent later is read and answered too, and can end the suspension, but does not pause it. You can reply once, and replying does not use up your appeal: when korbat keeps a decision after a reply you sent before the start, your ${count(APPEAL_MONTHS, "month")} to appeal count again from that answer.`,
  `korbat suspends an account at once, before any reply, only in four cases, each decided by an admin: after a final decision that a post of the account is a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")}; after a final decision that a post of the account is terrorist content, for up to ${count(S.terroristDays, "day")}; when an admin finds that the account is flooding korbat with repetitive, unsolicited posts (rule R6) and it made ${S.floodPosts} or more posts within ${count(S.floodMinutes, "minute")}, for up to ${count(S.floodDays, "day")}; and, as a protective suspension, when korbat keeps images of the account sealed after a report of child sexual abuse material, by a decision at most ${count(S.basisAgeDays, "day")} old, once for each such decision and for up to ${count(S.protectiveDays, "day")}. In the last case korbat's staff do not open the images, so korbat has not assessed them: the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once and does not wait for the authorities. In the first two cases the suspension ends at once if the decision it rests on is reversed. An announced suspension never rests on one of these four cases. You get the statement at once and can reply and appeal from the first minute; korbat aims to answer a reply to a suspension taken at once within ${count(REPLY_AIM_HOURS, "hour")}.`,
  "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules. You can still sign in and read, see your cases, reply to korbat, appeal, ask for a re-examination, export your data, delete your posts or your account, undo likes, reposts, bookmarks and follows, block and mute, and report illegal content. Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts. Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
  `A termination is decided after ${numberWord(S.ladderDays.length)} suspensions as described above, with the same time to reply, or at once after a direct threat of violence (rule R5) that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account for an earlier one, while that suspension and the decision it rests on still stand. A second post from before that suspension is no ground for it. Until the decision is final the account is suspended and nothing more. It is final when the ${count(APPEAL_MONTHS, "month")} for your appeal have passed unused, or when your appeal is answered and the decision kept; nothing is deleted while your appeal or a reply of yours is unanswered. korbat then deletes the account with its posts and profile and every image it has not sealed. Until then you can export your data and delete the account yourself; deleting it ends your appeal, since nothing is left to restore. After the deletion korbat keeps nothing to recognise a new account of yours by; images that korbat sealed stay with it for the authorities alone, as the decision that sealed them said.`,
  "Each of these decisions can be appealed from the moment you are told, as Appeals says; an appeal does not hold a start, only a reply does. One person may hold more than one account, but not to carry on with another account what one was suspended or terminated for: korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
);

export const REPORTING_IN_BAD_FAITH = paragraphs(
  "Report what you believe breaks a rule; a report that turns out wrong costs you nothing. korbat acts only on reports that are manifestly unfounded: reports that anyone could see name nothing a rule could cover, without weighing them. Examples are many reports of the same account for posts that plainly break no rule, the same text sent against different posts, and a report sent again after it was answered. A moderator may mark such a report when deciding it. You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination. The mark stops counting if a re-examination finds a breach, and if korbat withdraws it because the report was arguable after all. korbat counts reports, not the posts or accounts a report names: a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
  `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules within ${count(S.reportFrameDays, "day")} are marked, and they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time, a moderator may warn you: the warning lists the reports and restricts nothing. If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked while it counts, which is ${count(S.reportFrameDays, "day")}, a moderator may stop taking your reports under the rules for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted. A person decides each step, looking at how many reports you sent, how many were marked and what they said; the count alone decides nothing. Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted. You can appeal the warning and the restriction.`,
);

const HANDLES = `When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it. A retired handle can be used by nobody again, you included. Your profile then shows a placeholder that begins with ${RETIRED_HANDLE_PREFIX}, and you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends. If the decision is reversed, the retirement is lifted: your profile gets the handle back if it still shows the placeholder, and otherwise you can change back to it at once; nobody else could take it meanwhile. Handles that begin with ${RETIRED_HANDLE_PREFIX} cannot be chosen. korbat keeps a retired handle, as a handle and nothing else, for as long as it refuses it to everyone, also when the breach was someone's private information (rule R4): refusing it needs it.`;

/**
 * 3f (design, W.6 and section 5): the contact point for authorities and the Member State korbat is established in, the
 * web build's two arguments (WEB_CONTACT_POINT and WEB_HOME_STATE in infra/.env), which Expo inlines at export time as it
 * inlines the contact address. The app's page is built, so it cannot read the API's settings of the same names. While the
 * contact point is empty the terms print no section on it, and while the state is empty no sentence names one: both are
 * set, with the API's, as the last step of the README's Before going public.
 */
export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";
export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";
/** The home state's facts, while the contracts fill its entry in. */
const STATE: StateFacts | undefined = HOME_STATE === "" ? undefined : (STATE_FACTS as Partial<Record<string, StateFacts>>)[HOME_STATE];
/** The state as a sentence names it: its name from STATE_FACTS, or its code while the contracts have no entry for it. */
const HOME_STATE_NAME = STATE?.name ?? HOME_STATE;

/** A list inside a sentence: "a", "a and b", "a, b and c". */
const andList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * 3f's sections (design, W.6), in the design's words. Each number is printed from the constant the code that acts on it
 * reads: what a removal order disabled is kept for RETENTION.orderPreserveMonths and ORDER_RULES.preserveMarginDays, the
 * records for RETENTION.orderRecordYears, a message's record for RETENTION.contactMessageDays, a restore gap for
 * RETENTION.restoreGapMonths and a deleted account's address for ORDER_RULES.reportHoldDays. The hour, the six and twelve
 * weeks and the 48 hours of a scrutiny are the Regulation's own periods (TCO Art. 3(3), 11(3) and 4(4)), written as it
 * writes them: ORDER_RULES holds korbat's own numbers built on them (holdDays counts a day more, so as never to be early).
 */
const O = ORDER_RULES;
const PRESERVED = count(RETENTION.orderPreserveMonths, "month");

const AUTHORITIES_ORDERS = paragraphs(
  "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
  "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
  "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
  "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
);

// 3c's section, in full as 3f has it read: the removal order is carried out within the hour now, not once korbat is open.
export const TERRORIST_CONTENT = paragraphs(
  "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
  `A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for ${PRESERVED} from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.`,
  `The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the ${PRESERVED} otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.`,
);

// The languages the contact point declares are the operator's (STATE_FACTS); while the state's entry declares none, the
// sentence names none rather than print that they are not filled in.
const CONTACT_POINT_SECTION = `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784)${STATE?.languages ? `, in ${andList(STATE.languages)}` : ""}. This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`;

/**
 * "Your data"'s four paragraphs of W.6, and RETENTION's printed list of what concerns authorities, in one paragraph. 3f's
 * review (people8): a message an order came with is kept with that order's records (delete_contact_messages skips it), so
 * both sentences about the contact point's records say so.
 */
const AUTHORITIES_DATA = [
  `Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.`,
  `korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for ${count(RETENTION.orderRecordYears, "year")} after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record ${count(RETENTION.contactMessageDays, "day")} after the message was handled, or, when an order came with it, with that order's records.`,
  "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
  "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
  `The periods for what concerns authorities: content disabled under a removal order is kept ${PRESERVED} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept ${count(RETENTION.orderRecordYears, "year")} after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept ${count(RETENTION.contactMessageDays, "day")}, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept ${count(RETENTION.restoreGapMonths, "month")} when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most.`,
];

/**
 * 3d (design, W.9): "Automated tools" and "Transparency", drafts without a new TERMS_VERSION, as 3c's, 3e's and 3f's
 * sections were; counsel reviews them in sub-project 4. Every number is AUTOMATION_RULES', which the database's
 * automation_rules() holds the program to. They say what each tool may do when it is switched on, and the rules page says
 * which is on today: so they are true in every state the design builds (section 18, rule 9).
 */
const A = AUTOMATION_RULES;
export const AUTOMATED_TOOLS = paragraphs(
  "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
  "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
  "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
  `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most ${A.decisionsPerHour} measures an hour and ${A.decisionsPerDay} a day under rule R1, and ${A.r2DecisionsPerHour} and ${A.r2DecisionsPerDay} under rule R2, none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than ${A.unansweredHours} hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within ${A.objectionTargetHours} hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
);

/** 3d (design, W.9): "Transparency". */
export const TRANSPARENCY =
  "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.";

/**
 * 3d (design, W.9): "Your data"'s paragraph on what the automated tools and the sealed images leave behind, and
 * RETENTION's printed list of the same, each period from its constant: the match record's days, the address held after a
 * refused upload (3f's hold), the edge's outbox rows, the records to authorities' years, and the reader count's salt.
 */
const R = RETENTION;
const AUTOMATION_DATA = [
  `While a comparison is switched on korbat keeps fingerprints of each uploaded image for as long as it keeps the image; when the comparison is switched off it deletes them all. While the check against rule R1 is switched on it keeps the program's rating of each image the same way, and deletes the ratings when the check is switched off. It keeps the record of a match (the image's id, the body, the kind of match and the fingerprint, never your account) for ${count(R.matchKeepDays, "day")} after the case closed, the hold ended or the images were released. The record that an upload of yours was not accepted names your account for the same time; after that korbat keeps only that an upload was refused on that day. If korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. While an upload of yours is held korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account, as it does when images are sealed. It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match. It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped, and for ${count(R.orderRecordYears, "year")} the record of a release, of the leave or instruction it rests on, and the digests that prove a destruction.`,
  `The periods for the automated tools and for sealed images: the record of a match: ${count(R.matchKeepDays, "day")} after its case closed, its hold ended or its images were released, or, for an upload that was accepted and never posted, after the comparison; longer only while images sealed for good and not released, or a held upload, rest on it. The record that an upload was not accepted: with your account until the record of its match is erased, and without it afterwards; when korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. Your email address after an upload of yours was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account; less when the hold ends without a report. The record that a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed. Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off. The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off. The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end, and the day's key after ${count(RECIPIENT_RULES.saltHours, "hour")}. The record of a release, of the leave or instruction it rests on, and of each destroyed file's digest: as korbat's records to authorities (${count(R.orderRecordYears, "year")}).`,
];

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    // 3e (W.7): what another account may not carry on, which "Suspension and termination" says.
    // 3f (W.6): the Member State korbat is established in, from the build's argument, while the build names one.
    body: `You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).${HOME_STATE_NAME === "" ? "" : ` korbat is established in ${HOME_STATE_NAME} and offers its service there only.`}`,
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
  },
  // The rulebook itself, as @korbat/rules holds it: the grounds on which korbat restricts content (Digital Services Act, Article 14(1)).
  {
    title: "The rules",
    body: paragraphs(
      `These are korbat's rules, in version ${RULES_VERSION} of its rulebook. A decision under a rule names the rule, and its statement of reasons quotes the rule as it stood when the decision was made.`,
      ...RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`),
    ),
  },
  {
    title: "Reports and notices",
    body: paragraphs(
      "Anyone can report a post, an image or a profile on korbat, signed in or not: choose Report on the item itself, or use the report form linked below these terms. A report says either that the item breaks one of korbat's rules or that it is illegal.",
      "A report about a profile is decided on its display name and bio; korbat decides about the account's posts and images in cases of their own. A report about a post that quotes another is decided on that post's own text and images; the quoted post is decided in a case of its own.",
      `For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, the form has a path of its own, which is anonymous: korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email. You follow such a report through the link that is shown once on screen. On that path a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts, and one report can name ${count(CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most.`,
      "A notice that something is illegal asks you to explain why and to confirm that you report in good faith; which law or country you mean, your name and your email are optional. Reports are anonymous towards the person you report: korbat never tells them who reported them, and a request for their data shows them what was written only where the law requires it (see Your data).",
      `korbat takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day from one network without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day from one account. One report can name up to ${numberWord(NOTICE_LIMITS.maxTargets)} posts or profiles on korbat, by their links; korbat takes no attachments and follows no links to other sites. What you write to explain a report can be up to ${NOTICE_LIMITS.explanationMax} characters long, and the law or country you cite up to ${NOTICE_LIMITS.citedLawMax}.`,
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch. When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
      "The emergency switch: when a flood of reports keeps moderators from real cases, the operator may turn it on until the flood ends. Reports sent without an account or from accounts under 48 hours old are then read after the others of the same severity; in the urgent lane (threats, violence, self-harm, public security, and the sexual abuse or exploitation of children) only reports sent without an account are. A report is never read after a less severe one, and every report is still read and answered.",
      `Every report gets a reference, shown on screen at once. A notice that something is illegal gets a receipt by email at once when you gave an email or sent it from an account; a report on the anonymous path gets none. An email address that has not been confirmed as its sender's in the last ${count(RETENTION.confirmationDays, "day")} gets at most one receipt a day; the others come with the next daily email. For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page. korbat sends no report email to an address whose holder asked it to stop, and gives up an email it could not send for ${count(RETENTION.mailGiveUpDays, "day")}; the answer stays on the report's page.`,
      "korbat answers each item of a report in one of the following ways.",
      ...ANSWERS,
      // 3e (W.7, W.1): the scope phrases an answer carries when it was a measure on the account a report named.
      `When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long: the answer adds "${ACCOUNT_MEASURE_SCOPE.measure}", or "${ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle. korbat does not tell you what happens to that account afterwards.`,
      `Re-examination: if a moderator answered your report with no action, you can ask once for a re-examination, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with an optional statement, under Your reports or on the report's page. It is decided again as a new report, by a moderator; korbat asks another moderator than the one who decided to take it when it has one. You can ask for at most ${count(DAILY_LIMITS.reexaminations, "re-examination")} a day. Its answer is final within korbat, with one exception: an answer given while korbat's staff could not open a post's images, because a report of child sexual abuse material about them was waiting or because they were sealed, says so and can be asked again. An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told. ${COURTS}`,
    ),
  },
  {
    title: "How moderators decide",
    body: paragraphs(
      // 3d (W.9): what a program may do until a moderator decides is in Automated tools.
      "A moderator decides every case; what a program may do until then is in Automated tools. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      MEASURES_PARAGRAPH,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
  { title: "Automated tools", body: AUTOMATED_TOOLS },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content or your account, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin. What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      // 3e (W.7): what an appeal of a standing measure does and does not do.
      `An appeal never holds the start of a suspension; a reply does. When korbat keeps a decision in answer to a reply you sent before its start, the ${count(APPEAL_MONTHS, "month")} to appeal it count from that answer. The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.`,
      // 3f (W.6): an order is no decision of korbat's, and what a hold delays counts from the day korbat may tell.
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
      COURTS,
    ),
  },
  // 3e's four sections (design, W.7), after the appeals they refer to.
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Handles", body: HANDLES },
  // 3f (W.6): what an authority's order is and what korbat does with one, before the section on removal orders.
  { title: "Authorities' orders", body: AUTHORITIES_ORDERS },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  { title: "Terrorist content", body: TERRORIST_CONTENT },
  // 3f (W.6): only while the build has a contact point for authorities to publish.
  ...(CONTACT_POINT === "" ? [] : [{ title: "Contact point for authorities", body: CONTACT_POINT_SECTION }]),
  // 3d (W.9): what korbat publishes, and the one count it keeps to publish it.
  { title: "Transparency", body: TRANSPARENCY },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    // UI Task 8 (8.8): the first paragraph names what the browser keeps beside the device id; it joins the draft without
    // a new TERMS_VERSION, as 2c's to 3f's sentences did.
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. Your browser also keeps, until you sign out, your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent; none of them leaves the browser, and Clear what this device keeps, in Settings > Appearance and accessibility, removes them at once. The device id stays, and so does your Not now on the passkey card. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased when the case closes, or ${count(RETENTION.evidenceHours, "hour")} after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      // 3d (W.9): the same keeping starts on a program's match when nobody reported anything; and what korbat does with
      // sealed images it reported, which promises no destruction and names no period (review ruling 1).
      "For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post, of the post it quotes, or of all a profile's posts until an admin has answered, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own. Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      // 3e (W.7): what korbat keeps of account sanctions, with RETENTION's three members.
      `korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use: a strike counts for ${count(RETENTION.standingRecord.strikeDays, "day")}, a suspension counts toward the next one for ${count(RETENTION.standingRecord.ladderMemoryDays, "day")}, a warning about reporting for ${count(RETENTION.standingRecord.warningDays, "day")}. The text of a reply to a suspension is kept ${RETENTION.replyText}; a reply that is not answered yet is never erased. To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded; both are deleted after ${count(RETENTION.reportCountDays, "day")} and with the account, so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.`,
      // 3d (W.9): what the automated tools and the sealed images leave behind, and RETENTION's printed list of it.
      ...AUTOMATION_DATA,
      // 3f (W.6): what is kept when an account is deleted, korbat's records about authorities, what an authority can get,
      // after a restore, and the periods of RETENTION that concern authorities.
      ...AUTHORITIES_DATA,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
    ),
  },
];
```

### Replace `apps/app/src/lib/ui-words.ts` (whole file)

```ts
/**
 * The words of korbat's own components and of this sub-project's screens (UI design, sections 1.5 and 8.1), kept out
 * of the markup so a later translation is mechanical: a test of a11y.test.tsx refuses a bare sentence in src/app and
 * src/components. Keys are written as the design's word tables write them (`offline.title`, `feed.loading`); words no
 * table keys take a key of the same shape. A template holds `{name}` where fill() puts a value. Words of an area that
 * has a words module of its own (moderation, standing, orders, Explore, the public pages, the terms) stay there.
 */

/** U+2026, built in code so this file stays plain ASCII. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const UI_WORDS = {
  /** Button's label while its action runs (6.4), word for word what ui.tsx showed before the kit. */
  "button.busy": `Please wait${ELLIPSIS}`,
  /** The centred spinner's name (Loading in ui.tsx). */
  "spinner.label": "Loading",
  /** VerifiedChip (6.13): the visible word and the name a screen reader hears, as ui.tsx had them. */
  "verified.label": "Verified",
  "verified.name": "verified account",
  /** The polite status of a list that shows skeleton rows (6.12). */
  "feed.loading": "Loading posts",
  "accounts.loading": "Loading accounts",
  /** ErrorState (6.12) and its offline form (8.11). */
  "error.retry": "Try again",
  "offline.title": "You're offline",
  "offline.body": "korbat will load this when your connection is back.",
  /** PublicFrame (7.3): the wordmark and the footer's links to the public pages. */
  "frame.wordmark": "korbat",
  "frame.rules": "The rules",
  "frame.transparency": "Transparency",
  "frame.terms": "Terms",
  /** postedWhen() (8.1), the spoken form of timeAgo's short time, which it always contains. */
  "time.posted.now": "posted just now",
  "time.posted.ago": "{short} ago",
  "time.posted.on": "on {date}",
  /** The shell (7.1 to 7.5, 8.1): the skip link, the context column and its card, the header's back button. */
  "shell.skip": "Skip to the main content",
  "shell.about": "About korbat",
  "shell.howTitle": "How korbat works",
  "shell.how1": "Following and Latest are in time order.",
  "shell.how2": "korbat never lowers a post's reach in secret.",
  "shell.how3": "The rules are public, and so is how they are enforced.",
  "shell.rulesLink": "The rules",
  "shell.transparencyLink": "Transparency",
  "shell.exploreLink": "How Explore works",
  "shell.back": "Back",
  /** The navigation landmark's name and its items, the same words at every width (7.1). */
  "nav.label": "Main",
  "nav.home": "Home",
  "nav.bookmarks": "Bookmarks",
  "nav.profile": "Profile",
  "nav.settings": "Settings",
  "nav.signin": "Sign in",
  /** The rail's mark (7.1), the wordmark's first letter, as the favicon draws it. */
  "nav.monogram": "k",
  /** HandleBox, in the context column (7.3), word for word as it had them. */
  "handle.title": "Go to a profile",
  "handle.field": "Handle",
  "handle.placeholder": "@handle",
  "handle.open": "Open",
  "handle.invalid": "Handles are 3 to 20 letters, numbers or underscores.",
  /** A mistyped address and the error boundary (8.11). */
  "notFound.title": "This page doesn't exist",
  "notFound.action": "Go to Home",
  "crash.title": "Something went wrong on this screen",
  "crash.body": "Try again, or go back to Home.",
  "crash.retry": "Try again",
  /** Bookmarks, followers and following (8.4, 8.5): their titles and empty sentences, word for word as the screens had them. */
  "bookmarks.title": "Bookmarks",
  "bookmarks.private": "Private to you.",
  "bookmarks.empty": "Nothing saved yet. Use Save on a post to keep it here.",
  "followers.title": "Followers",
  "followers.empty": "No followers yet.",
  "following.title": "Following",
  "following.empty": "Not following anyone yet.",
  /**
   * The post card (6.6, 8.1, section 10). post.label is the article's name, "Ada, @ada, 3h ago"; post.open is the time
   * link's, whose `when` comes from postedWhen() and always contains the visible short time. The action names leave the
   * number out at zero and when the reader hides counts (decision 15): then they are the `.none` words.
   */
  "post.label": "{name}, @{handle}, {when}",
  "post.open": "{when}, open the post",
  "post.reposted": "{displayName} reposted",
  "post.more": "More options for this post",
  "post.repost": "Repost",
  "post.unrepost": "Undo repost",
  "post.quote": "Quote",
  "post.whoSees": "Who sees this",
  "post.copyLink": "Copy link",
  "post.delete": "Delete",
  "post.reply": "Reply, {n} replies",
  "post.reply.one": "Reply, 1 reply",
  "post.reply.none": "Reply",
  "post.like": "Like, {n} likes",
  "post.like.one": "Like, 1 like",
  "post.like.none": "Like",
  "post.reposts": "Repost, {n} reposts",
  "post.reposts.one": "Repost, 1 repost",
  "post.reposts.none": "Repost",
  "post.save": "Save",
  "post.saved": "Saved",
  /** The delete question (6.6), word for word as PostCard.tsx had it. */
  "post.deleteQuestion": "Delete this post?",
  /** The reply context and the quoted post's tombstones, word for word as PostCard.tsx had them. */
  "post.replyingTo": "Replying to ",
  "post.replyingHidden": "Replying to a post you can't see",
  "post.deleted": "This post was deleted by its author.",
  "post.unavailable": "This post is unavailable.",
  "post.inExplore": "In Explore",
  /** The thread's focused post (8.3): each part left out when zero or hidden, joined by a comma. */
  "thread.stats.reposts": "{n} reposts",
  "thread.stats.reposts.one": "1 repost",
  "thread.stats.quotes": "{n} quotes",
  "thread.stats.quotes.one": "1 quote",
  "thread.stats.likes": "{n} likes",
  "thread.stats.likes.one": "1 like",
  /**
   * Who sees this (6.14), the sentences reach() in lib/reach.ts puts together, word for word as the design reviewed them;
   * the summary is the one line under the menu item.
   */
  "reach.public": "Public. Anyone can read it, including people who are not signed in.",
  "reach.blocked": "Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.",
  "reach.feeds": "It shows in Latest and in your followers' Following, in time order.",
  "reach.inExplore": "Also in Explore.",
  "reach.exploreOff": "Not in Explore: you turned Explore off.",
  "reach.suspended": "Not in Explore while your account is suspended.",
  "reach.reply": "Public. Shown in the thread and on your Replies tab.",
  "reach.replyExplore": "Replies never enter Explore.",
  "reach.quoteExplore": "Quotes never enter Explore.",
  "reach.private": "Only you and korbat's moderators can see it.",
  "reach.order": "Removed for everyone else by an authority's order.",
  "reach.decision": "Read the decision",
  "reach.never": "korbat never lowers a post's reach in secret. Following and Latest are in time order.",
  "reach.how": "How Explore works",
  "reach.summary.public": "Public, signed in or not",
  "reach.summary.private": "Only you and korbat's moderators",
  /** A post's images and the lightbox (6.7), word for word as MediaGrid.tsx, HiddenImage.tsx and MediaViewer.tsx had them. */
  "media.open": "Open image: {alt}",
  "media.showAlt": "Show image descriptions",
  "media.hideAlt": "Hide image descriptions",
  "media.alt": "ALT",
  "media.hidden": "Hidden",
  "media.close": "Close the image viewer",
  "media.previous": "Previous image",
  "media.next": "Next image",
  "media.count": "{n} of {total}",
  /** UI Task 7 (decision 10, 8.7): the link under a grid that holds a hidden image, to the rules page. */
  "media.whyHidden": "Why are images hidden?",
  /** Toasts (5.4, 8.6). */
  "toast.view": "View",
  "toast.linkCopied": "Link copied",
  "toast.saved": "Saved to Bookmarks",
  "toast.failed.like": "Couldn't like this post. Try again.",
  "toast.failed.unlike": "Couldn't remove your like. Try again.",
  "toast.failed.repost": "Couldn't repost this post. Try again.",
  "toast.failed.unrepost": "Couldn't undo the repost. Try again.",
  "toast.failed.save": "Couldn't save this post. Try again.",
  "toast.failed.unsave": "Couldn't remove this post from Bookmarks. Try again.",
  "toast.failed.follow": "Couldn't follow @{handle}. Try again.",
  "toast.failed.unfollow": "Couldn't unfollow @{handle}. Try again.",
  /** What sending says (5.4, 8.6), each with View; the post's names where it is, so View is a convenience. */
  "toast.sent.post": "Your post was sent. It is at the top of Home.",
  "toast.sent.reply": "Your reply was sent",
  "toast.sent.quote": "Your quote was sent",
  /**
   * The composer (6.15, 8.6): the sheet's titles and the compose button's name, the field's names and placeholders, the
   * Post button's words and what it says is missing, the count, the send bar, the discard question and the image tray,
   * word for word as Composer.tsx, ComposeSheet.tsx and ComposerImages.tsx had them; the collapsed cards, the count and
   * the location sentence are new (8.6's table).
   */
  "composer.title.post": "New post",
  "composer.title.reply": "Reply",
  "composer.title.quote": "Quote",
  "composer.newPost": "New post",
  "composer.collapsed": "What's on your mind?",
  "composer.collapsedReply": "Write your reply",
  "composer.field.post": "What's on your mind?",
  "composer.field.reply": "Your reply",
  "composer.field.quote": "Your comment on the quoted post",
  "composer.placeholder.post": "What's on your mind?",
  "composer.placeholder.reply": "Write your reply",
  "composer.placeholder.quote": "Add your comment",
  "composer.action.post": "Post",
  "composer.action.reply": "Reply",
  "composer.action.quote": "Quote",
  "composer.posting": `Posting${ELLIPSIS}`,
  "composer.missing.failed": "Remove the failed image",
  "composer.missing.undescribed": "Describe every image",
  "composer.missing.waiting": `Waiting for images${ELLIPSIS}`,
  "composer.count": "{n} of 1000 characters",
  "composer.cancel": "Cancel",
  "composer.addImage": "Add image",
  "composer.exif": "korbat removes location and camera details from images.",
  "composer.discard.question": "Discard this draft?",
  "composer.discard.confirm": "Discard",
  "composer.discard.keep": "Keep writing",
  /** Under the refusal that replaces the fields while a measure runs (3e, 9.4): where to read about it. */
  "composer.refused.where": "{read}: Settings, Cases.",
  "composer.image.name": "image {n}",
  "composer.image.preview": "Preview of {name}",
  "composer.image.refused": "{name}, not accepted",
  "composer.image.description": "Description of {name}",
  "composer.image.placeholder": "Describe this image for people who cannot see it",
  "composer.image.remove": "Remove {name}",
  "composer.image.removeWord": "Remove",
  "composer.image.uploading": `Uploading${ELLIPSIS}`,
  "composer.image.processing": `Processing${ELLIPSIS}`,
  "composer.image.ready": "Ready",
  "composer.image.failed": "Failed",
  /** FollowButton (8.4), word for word as ProfileList.tsx had them. */
  "follow.follow": "Follow",
  "follow.following": "Following",
  /**
   * Home's feeds (8.2): the marker, the new-posts pill, the gap, the end, the empty states and Load more. The empty
   * sentences and Load more are word for word what index.tsx and PagedList.tsx had; feed.pill.label is the pill's name
   * and feed.pill.announce what a screen reader hears once when it first shows.
   */
  "feed.marker.title": "You were here",
  "feed.marker.body": "Newer posts are above. Below are posts you have already seen.",
  "feed.caughtUp": "You're all caught up",
  "feed.pill": "{n} new posts",
  "feed.pill.one": "1 new post",
  "feed.pill.many": "50+ new posts",
  "feed.pill.label": "{visible} above, go to the first one",
  "feed.pill.announce": "{visible} above",
  "feed.gap": "Show more new posts",
  "feed.end.following": "That's everything in Following.",
  "feed.end.latest": "That's everything in Latest.",
  "feed.empty.following.title": "Your Following feed is empty",
  "feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",
  "feed.empty.following.action": "Open Latest",
  "feed.empty.latest.title": "Nothing posted yet",
  "feed.empty.latest.body": "No posts yet.",
  "feed.loadMore": "Load more",
  /** Home (8.2): its title, its tab list's name and its tabs, and the passkey card's words as index.tsx had them. */
  "home.title": "Home",
  "home.tabs": "Feeds",
  "home.following": "Following",
  "home.latest": "Latest",
  "home.explore": "Explore",
  "passkey.title": "Sign in faster with a passkey",
  "passkey.body": "A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.",
  "passkey.add": "Add a passkey",
  "passkey.notNow": "Not now",
  /** A post and its thread (8.3), word for word as post/[id].tsx had them; thread.signIn is new. */
  "thread.title": "Post",
  "thread.missing": "This post is not available",
  "thread.back": "Back to the timeline",
  "thread.quote": "Quote this post",
  "thread.empty": "No replies yet.",
  "thread.signIn": "Sign in to reply.",
  "thread.exploreSetting": "Your Explore setting",
  /** A profile (8.4), word for word as u/[handle]/index.tsx had them; the hidden counts' words and More's name are new. */
  "profile.more": "More options for @{handle}",
  "profile.posts": "posts",
  "profile.followers": "followers",
  "profile.following": "following",
  "profile.followers.hidden": "Followers",
  "profile.following.hidden": "Following",
  "profile.followsYou": "Follows you",
  "profile.mute": "Mute",
  "profile.unmute": "Unmute",
  "profile.block": "Block",
  "profile.unblock": "Unblock",
  "profile.blockQuestion": "Block @{handle}?",
  "profile.blockBody":
    "Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from someone who signs out. You can undo this in your privacy settings.",
  "profile.cancel": "Cancel",
  "profile.signIn": "Sign in to follow this account.",
  "profile.settings": "Security and privacy settings",
  "profile.missing": "This account is not available",
  "profile.tabs": "Profile",
  "profile.tab.posts": "Posts",
  "profile.tab.replies": "Replies",
  "profile.tab.likes": "Likes",
  "profile.empty.posts": "No posts yet.",
  "profile.empty.replies": "No replies yet.",
  "profile.empty.likes": "You have not liked anything yet. Only you can see this tab.",
  "bookmarks.empty.title": "No saved posts",
  /**
   * UI Task 8: the Settings index (8.8, the owner's ruling 10) and the settings row's pages, word for word as
   * SettingsNav.tsx had them; the row's landmark keeps its name.
   */
  "settings.title": "Settings",
  "settings.nav": "Settings",
  "settings.security": "Security",
  "settings.privacy": "Privacy",
  "settings.profile": "Profile",
  "settings.account": "Account",
  /** Appearance and accessibility (8.8), the design's table. */
  "appearance.title": "Appearance and accessibility",
  "appearance.nav": "Appearance",
  "appearance.theme": "Theme",
  "appearance.system": "System",
  "appearance.light": "Light",
  "appearance.dim": "Dim",
  "appearance.dark": "Dark",
  "appearance.darkStyle": "Dark style",
  "appearance.textSize": "Text size",
  "appearance.smaller": "Smaller",
  "appearance.default": "Default",
  "appearance.larger": "Larger",
  "appearance.largest": "Largest",
  "appearance.sample": "This is how posts will read.",
  /** The letters each text size and font row draws in its own size or face, as decoration beside its name. */
  "appearance.glyphs": "Aa",
  "appearance.font": "Font",
  "appearance.korbatFonts": "korbat fonts",
  "appearance.systemFont": "System font",
  "appearance.motion": "Reduce motion",
  "appearance.followSystem": "Follow the system",
  "appearance.always": "Always",
  "appearance.haptics": "Haptics",
  "appearance.reading": "Reading",
  "appearance.autoLoad": "Load older posts automatically",
  "appearance.openNewest": "Open feeds at the newest post",
  /** The owner's ruling 12: it hides follower counts too, and says so. */
  "appearance.hideCounts": "Hide like, repost and follower counts",
  /** "On this device" (8.8, decision 8): what korbat keeps in this browser, and the button that clears it. */
  "device.title": "On this device",
  "device.body":
    "korbat keeps your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent in this browser until you sign out. A random device id, which tells a new device from a known one at sign-in, and your Not now on the passkey card stay.",
  "device.clear": "Clear what this device keeps",
  "toast.cleared": "Cleared",
} as const;

export type UiWord = keyof typeof UI_WORDS;

/**
 * Each screen's browser tab title (8.1, decision 16), read by lib/page-title.tsx: "<what> - korbat", naming the kind of
 * screen and never an account, so a synced browser history holds no handles (the h1 inside the page names the account).
 * A title joins this table with the first screen that sets it.
 */
export const TITLE_WORDS = {
  "title.notFound": "Page not found - korbat",
  "title.bookmarks": "Bookmarks - korbat",
  "title.followers": "Followers - korbat",
  "title.following": "Following - korbat",
  "title.home": "Home - korbat",
  "title.post": "Post - korbat",
  "title.postMissing": "Post not available - korbat",
  "title.profile": "Profile - korbat",
  /** UI Task 7: the public pages (8.9). */
  "title.rules": "Rules - korbat",
  "title.transparency": "Transparency - korbat",
  "title.exploreAbout": "How Explore works - korbat",
  "title.terms": "Terms - korbat",
  /**
   * UI Task 7: screens the design gives no title (8.1 wants one), each named by its kind: the report form, a report's
   * status page (never its reference), and the case screens in the form of 8.8's title.settings, filled, since a title
   * holds no placeholder.
   */
  "title.report": "Report - korbat",
  "title.notice": "Report status - korbat",
  "title.cases": "Cases - Settings - korbat",
  /**
   * UI Task 8: the Settings index and its pages (8.8), each the form of title.settings filled in, since a title holds no
   * placeholder; Appearance takes the settings row's short name, as Cases does.
   */
  "title.settingsIndex": "Settings - korbat",
  "title.settingsAppearance": "Appearance - Settings - korbat",
  "title.settingsSecurity": "Security - Settings - korbat",
  "title.settingsPrivacy": "Privacy - Settings - korbat",
  "title.settingsProfile": "Profile - Settings - korbat",
  "title.settingsAccount": "Account - Settings - korbat",
  /**
   * The sign-in flow and the token pages (8.10). A token page is named korbat alone: its address holds the link's
   * secret and its words say what the link does, so the tab names neither (shell.test.tsx allows this one key).
   */
  "title.signin": "Sign in - korbat",
  "title.code": "Check your email - korbat",
  "title.password": "Sign in with a password - korbat",
  "title.mfa": "Two-factor authentication - korbat",
  "title.age": "Almost there - korbat",
  "title.handle": "Choose your handle - korbat",
  "title.token": "korbat",
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
```

### Replace `apps/app/src/theme/ThemeProvider.tsx` (whole file)

```tsx
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Platform, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import { resolveTheme, useAppearance, type Appearance } from "@/lib/appearance";
import { useMotion } from "@/lib/motion";
import { THEME_FADE } from "./motion";
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
 * How long the theme's cross-fade lasts when the screen goes from `previous` to `next` (section 5.2's theme row, UI Task
 * 8): none on the first apply, which only keeps what theme-boot.js painted before the bundle, and none while the theme
 * stays (a text step or a font changes nothing's colour); otherwise 200 ms, or 150 ms under reduced motion.
 */
export function themeFade(previous: ThemeName | null, next: ThemeName, reduced: boolean): number | null {
  if (previous === null || previous === next) return null;
  return reduced ? THEME_FADE.reduced : THEME_FADE.duration;
}

/** The theme the html element shows, null until the first apply; and the timer that ends a running cross-fade. */
let shown: ThemeName | null = null;
let fadeEnd: ReturnType<typeof setTimeout> | undefined;

/**
 * What theme-boot.js did before the bundle, kept true as the reader changes their appearance or the system its scheme:
 * the theme's class on the html element (global.css switches the variables by it), the text step and font for the
 * stylesheet, the scheme for the browser's own controls, the page's colours under everything, and the theme-color meta.
 * A change of theme after the first apply cross-fades: THEME_FADE's class goes on in the same change as the new theme,
 * so every colour moves to the new one as a transition (theme/fonts.web.ts's rule), and comes off once the fade is over.
 */
function applyToDocument(theme: Theme, appearance: Appearance, reduced: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const fade = themeFade(shown, theme.name, reduced);
  shown = theme.name;
  if (fade !== null) {
    clearTimeout(fadeEnd);
    root.style.setProperty(THEME_FADE.property, `${fade}ms`);
    root.classList.add(THEME_FADE.className);
    // A frame after the fade, so the last step of every transition is drawn before the class takes them away.
    fadeEnd = setTimeout(() => {
      root.classList.remove(THEME_FADE.className);
      root.style.removeProperty(THEME_FADE.property);
    }, fade + 34);
  }
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
  // Read when the theme changes, not a reason to apply it again: the system's reduced motion changes no colour.
  const reduced = useRef(false);
  reduced.current = useMotion().reduced;
  useEffect(() => {
    if (Platform.OS === "web") applyToDocument(theme, appearance, reduced.current);
  }, [theme, appearance]);
  if (Platform.OS === "web") return <>{children}</>;
  return <View style={[{ flex: 1 }, scopeStyle(theme.name)]}>{children}</View>;
}
```

### Replace `apps/app/src/theme/fonts.web.ts` (whole file)

```ts
import { THEME_FADE } from "./motion";

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

/**
 * The theme's cross-fade (UI design, section 5.2; UI Task 8): while ThemeProvider holds THEME_FADE's class on the html
 * element, every element's colours move to the new theme's over the length its custom property names, on ease. Colours
 * only, so nothing moves; a toast keeps its own motion, which this rule would otherwise cut for the fade's length.
 */
export const THEME_FADE_RULE = `html.${THEME_FADE.className}, html.${THEME_FADE.className} *:not([data-sonner-toast]) { transition-property: background-color, border-color, color, fill, stroke, outline-color, text-decoration-color !important; transition-duration: var(${THEME_FADE.property}) !important; transition-timing-function: ease !important; transition-delay: 0s !important; }`;

/**
 * "You're all caught up" draws its check once a session (UI design, section 5.2, caught-up): the done icon's check, a
 * path about 8.5 units long, goes from a dash offset of its length to 0 in 450 ms on ease-out. FeedRows.tsx sets
 * data-draw on the icon only the first time and never under reduced motion, so the icon is otherwise drawn at once.
 */
export const DRAW_RULE = "@keyframes k-draw { to { stroke-dashoffset: 0; } } [data-draw] svg path { stroke-dasharray: 9; stroke-dashoffset: 9; animation: k-draw 450ms cubic-bezier(0.23, 1, 0.32, 1) forwards; }";

/** Adds the one style element with the rules, once; the browser downloads a file only when text needs it. */
export function installFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${fontFaceCss()} ${STILL_RULE} ${DRAW_RULE} ${THEME_FADE_RULE}`;
  document.head.appendChild(style);
}
```

### Replace `apps/app/src/theme/motion.ts` (whole file)

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

/**
 * The theme's cross-fade on the web (section 5.2's theme row, UI Task 8): when the reader changes theme after the first
 * paint, ThemeProvider puts this class on the html element, with the fade's length in this custom property, for as long
 * as the fade runs; theme/fonts.web.ts's rule turns every colour into a transition while it is there. 200 ms on ease;
 * under reduced motion 150 ms, since a soft brightness change is gentler than a jump. Kept apart from MOTION, whose
 * table is section 5.1's six values.
 */
export const THEME_FADE = { className: "k-theme-fade", property: "--k-theme-fade", duration: 200, reduced: 150 } as const;
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
apps/admin test:       Tests  584 passed (584)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  637 passed (637)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 6: verify: export

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

## Step 7: verify: app-browser

```bash
pnpm --filter @korbat/app test:browser
```

Expected output contains:

- `Tests  39 passed (39)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  39 passed (39)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/(auth)/_layout.tsx`
- `apps/app/src/app/(auth)/age.tsx`
- `apps/app/src/app/(auth)/code.tsx`
- `apps/app/src/app/(auth)/handle.tsx`
- `apps/app/src/app/(auth)/mfa.tsx`
- `apps/app/src/app/(auth)/password.tsx`
- `apps/app/src/app/(auth)/signin.tsx`
- `apps/app/src/app/email-revert/[token].tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/passkey-remove/[token].tsx`
- `apps/app/src/app/settings/_layout.tsx`
- `apps/app/src/app/settings/account.tsx`
- `apps/app/src/app/settings/appearance.tsx`
- `apps/app/src/app/settings/index.tsx`
- `apps/app/src/app/settings/privacy.tsx`
- `apps/app/src/app/settings/profile.tsx`
- `apps/app/src/app/settings/security.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/SettingsNav.tsx`
- `apps/app/src/components/kit/ListRow.tsx`
- `apps/app/src/components/kit/StatusChip.tsx`
- `apps/app/src/components/kit/Tabs.tsx`
- `apps/app/src/components/security/MfaSection.tsx`
- `apps/app/src/components/security/PasskeysSection.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/src/components/security/SessionsSection.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/auth-words.ts`
- `apps/app/src/lib/lockdown-words.ts`
- `apps/app/src/lib/settings-words.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/src/theme/ThemeProvider.tsx`
- `apps/app/src/theme/fonts.web.ts`
- `apps/app/src/theme/motion.ts`
- `apps/app/test/appearance-page.test.tsx`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/watch.ts`
- `apps/app/test/cases.test.tsx`
- `apps/app/test/composer.test.tsx`
- `apps/app/test/kit.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/lifecycle.test.tsx`
- `apps/app/test/passkeys.test.tsx`
- `apps/app/test/shell.test.tsx`
- `apps/app/test/terms.test.tsx`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(app): settings, security, the sign-in flow and Appearance: app/settings/appearance.tsx, the one settings page open signed out (the settings layout lets its path through, and the signed-out nav gains Appearance after Sign in), applies each choice at once through lib/appearance.ts: Theme with Dark style under System, Text size with a sample post that follows it, Font and Reduce motion as radio groups that are one tab stop each and whose arrows choose at once, the Reading switches (Hide counts hides follower counts too), Haptics on iOS and Android only, and Clear what this device keeps with its toast; a change of theme cross-fades the colours over 200 ms, 150 ms reduced, never on first paint; the nav's Settings and a profile's settings button open the new Settings index, Appearance first; Security, Privacy, Profile and Account take their titles in ScreenHeader with cards of fields and rows, sessions as rows with a neutral this device chip, Blocked and Muted on Tabs; the sign-in screens and token pages move into PublicFrame, codes and handles in the mono face, the lockdown's sentences in one words module; the legacy lists are empty; the browser check gains steps 35 to 39" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): settings, security, the sign-in flow and Appearance: app/settings/appearance.tsx, the one settings page open signed out (the settings layout lets its path through, and the signed-out nav gains Appearance after Sign in), applies each choice at once through lib/appearance.ts: Theme with Dark style under System, Text size with a sample post that follows it, Font and Reduce motion as radio groups that are one tab stop each and whose arrows choose at once, the Reading switches (Hide counts hides follower counts too), Haptics on iOS and Android only, and Clear what this device keeps with its toast; a change of theme cross-fades the colours over 200 ms, 150 ms reduced, never on first paint; the nav's Settings and a profile's settings button open the new Settings index, Appearance first; Security, Privacy, Profile and Account take their titles in ScreenHeader with cards of fields and rows, sessions as rows with a neutral this device chip, Blocked and Muted on Tabs; the sign-in screens and token pages move into PublicFrame, codes and handles in the mono face, the lockdown's sentences in one words module; the legacy lists are empty; the browser check gains steps 35 to 39`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 47>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "app-browser": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
