import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { THEMES, type ThemeName } from "../../src/theme/tokens";
import { TITLE_WORDS, UI_WORDS, fill } from "../../src/lib/ui-words";
import { THEME_FADE } from "../../src/theme/motion";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS, UPLOAD_TEXTS } from "../../src/lib/moderation-words";
import { RULES_PAGE } from "../../src/lib/public-pages";
import { IMPORT_WORDS } from "../../src/lib/import-words";
import { ACTIVITY_DEFAULTS, IMPORT_RULES } from "@korbat/contracts";
import { ACTIVITY_WORDS } from "../../src/lib/activity-words";
import { ACTIVITY_SETTINGS_WORDS, AVATAR_WORDS } from "../../src/lib/settings-words";
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import {
  ACTIVITY_SEEN,
  ADA,
  AVATAR_UPLOAD_ID,
  createFixtureApi,
  DECISION_ID,
  GRACE,
  HIDDEN_IMAGE_POST_ID,
  ARCHIVE_BYTES,
  IMPORT_BY_STAFF,
  IMPORT_DONE,
  IMPORT_NEW,
  IMPORT_PUBLISHING,
  IMPORT_READY,
  IMPORT_RESUME,
  IMPORT_SCANNING,
  IMPORTED_POST_ID,
  MISSING_POST_ID,
  newPostIdOf,
  NOTICE_REF,
  NOTICE_TOKEN,
  POST_DECISION_ID,
  POST_ID,
  postIdOf,
  RELEASE_ID,
  REMOVED_CHIP,
  solidWebp,
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
  // The shell and PublicFrame both draw role="main"; on a loaded machine the app can draw it after the network is idle,
  // and a step that measured at once read nothing (UI Task 10's runner met this in steps 6, 15 and 32).
  await page.waitForSelector('[role="main"]', { state: "attached", timeout: 20_000 });
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
  site = await startAppSite({ dist: out, api: fixtures.handle, postStatus: fixtures.postStatus, profileStatus: fixtures.profileStatus });
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
  // 3b Task 7: the import's two screens, the start and one import.
  "/settings/import",
  `/settings/import/${IMPORT_READY}`,
  // 2d Task 5: Activity, its Conversations tab and its settings page.
  "/activity",
  "/activity?tab=conversations",
  "/settings/activity",
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
        // 2d (decision 24, 10.1): the phone's tab bar has no Settings item, so its settings pages mark no item current; the
        // settings row under each one's title says where the reader is, and Settings is reached from the profile.
        const current = kind === "phone" && page.current === "/settings" ? null : page.current;
        expect(layout.current, page.name).toEqual(current === null ? [] : [current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(!page.frame && width >= 1024);
        expect(layout.scroll, `${page.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, page.scope), page.name).toEqual([]);
        if (width < 768) expect(await phoneProblems(visit_.page, page.scope), page.name).toEqual([]);
        if (current !== null) {
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
    // The baseline (1222b87) is above 400 KB: the cap was it plus 80 KB, and is plus 120 KB from 3b Task 7 (owner), for imports.
    expect(jsGzip).toBeLessThanOrEqual(baseline.js.gzipBytes + 120 * 1024);
    expect(baseline.js.gzipBytes + 120 * 1024).toBe(832_257);
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
    // 2d Task 6: a profile's page takes its card's status the same way; both pages say noindex, and / does not.
    const profilePage = await fetch(`${origin}/u/grace`);
    expect([profilePage.status, profilePage.headers.get("x-robots-tag")]).toEqual([200, "noindex"]);
    expect((await fetch(`${origin}/u/nobody_here`)).status).toBe(404);
    expect((await fetch(`${origin}/post/${POST_ID}`)).headers.get("x-robots-tag")).toBe("noindex");
    expect((await fetch(`${origin}/`)).headers.get("x-robots-tag")).toBeNull();
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
      for (let i = 0; i < 8; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      // 2d Task 5 (decision 24): Activity second.
      expect(stops.slice(1, 6).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/activity", "/bookmarks", "/u/ada", "/settings"]);
      // Task 6: the nav ends with New post, a button and no link.
      expect(stops[6]!.inNav).toBe(true);
      expect(stops[6]!.role).toBe("button");
      expect(stops[6]!.href).toBeNull();
      expect(stops[7]!.inMain).toBe(true);
      // Every stop draws korbat's ring, 2 px: the shell's, and the first stop inside Home's column, Home's own tab (Task 5).
      expect(stops[7]!.role).toBe("tab");
      for (const stop of stops.slice(0, 8)) {
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
      // 2d Task 5: on a loaded machine the feed's rows can be drawn after the network's idle moment, and their images and
      // the mono face would then be asked for offline (the export from before Task 5 met it too). The rows are drawn in
      // batches: once their number has held for a second, the images they asked for and the fonts they use are in before
      // the connection goes (an image left to load lazily is not asked for, so it is not waited for).
      await visit_.page.locator('main [role="article"]').first().waitFor();
      let rows = -1;
      for (let i = 0; i < 20; i++) {
        const now = await visit_.page.locator('main [role="article"]').count();
        if (now === rows) break;
        rows = now;
        await pause(1000);
      }
      await until(visit_.page, `[...document.images].filter((image) => image.loading !== "lazy").every((image) => image.complete)`, "the drawn rows' images");
      await visit_.page.evaluate("document.fonts.ready.then(() => true)");
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
      // 2d Task 5 (10.6): the author's menu holds Hide like and repost counts before Delete.
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"], UI_WORDS["post.hideCounts"], UI_WORDS["post.delete"]]);
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
          // 2d Task 5: the profile asks for its posts only once the profile has answered, which a loaded machine can leave
          // after the network's idle moment: the chip is waited for before it is read (the export before Task 5 met it too).
          await chip.first().waitFor();
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

  test("35. the nav's Settings opens the Settings index, current there and on every page below; its eight rows, Appearance first, and no settings row; signed out the nav's Appearance opens Appearance without the row, and /settings goes to sign-in", async () => {
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
        "/settings/activity", // 2d Task 5: Activity after Appearance (10.8).
        "/settings/security",
        "/settings/privacy",
        "/settings/profile",
        "/settings/account",
        "/settings/import", // 3b Task 7: Import posts after Account (10.1).
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

  /**
   * UI Task 10's walk-through found the rail's Bookmarks, and signed out its Appearance, broken inside the word at 768 px
   * at the Default text ("Bookmark" over "s"): the label may break rather than clip (section 1.5), so the clipped-label
   * rule passes it, but a word cut in two is no label. Only the extreme sizes of step 11 may break one.
   */
  test("40. the nav's labels stay whole: at Default and Larger text each item's label is one line, in the tab bar at 360, the rail at 768 and the full nav at 1280, signed in and signed out", async () => {
    // Each label of the nav as its lines: the text of every item, and how many lines its words take as drawn.
    const LABEL_LINES = `[...document.querySelectorAll('nav[aria-label="Main"] a, nav[aria-label="Main"] [role="button"]')].map((item) => {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const tops = new Set();
      const words = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim() === "") continue;
        // Words clipped to 1 px for a screen reader alone are no drawn label.
        const box = node.parentElement.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;
        words.push(node.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return { label: words.join(" "), lines: tops.size };
    }).filter((item) => item.label !== "")`;
    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      for (const textStep of ["default", "larger"] as const) {
        for (const signedIn of [true, false]) {
          const visit_ = await open({ width, height, signedIn, appearance: { theme: "light", textStep } });
          try {
            // Signed out the nav holds Home, Sign in and Appearance, which is the longest label there.
            await visit(visit_.page, signedIn ? "/bookmarks" : "/settings/appearance");
            const labels = (await visit_.page.evaluate(LABEL_LINES)) as { label: string; lines: number }[];
            expect(labels.length, `${width} ${textStep}`).toBeGreaterThanOrEqual(signedIn ? 4 : 3);
            expect(labels.filter((item) => item.lines !== 1), `${width} px, ${textStep}, ${signedIn ? "signed in" : "signed out"}`).toEqual([]);
            await clean(visit_);
          } finally {
            await visit_.context.close();
          }
        }
      }
    }
  });

  // 3b Task 7 appends below: the import's screens, the provenance label and the Imported tab (3b design, sections 10.8 and 12.4).

  /** One import's screen. */
  const importAt = (importId: string) => `/settings/import/${importId}`;
  /** The level-2 headings shown in the main column, in order: a client navigation keeps the screen it left, hidden. */
  const SHOWN_H2 = `[...document.querySelectorAll('main h2')].filter((h) => h.getClientRects().length > 0).map((h) => h.textContent.trim())`;
  /** What the page's polite status regions say now, joined. */
  const STATUSES = `[...document.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(" | ")`;
  /** How far the page reaches past the window's right edge. */
  const SIDEWAYS = `document.documentElement.scrollWidth - document.documentElement.clientWidth`;
  /** The focused element's role, name and words, and the ring drawn for it: its own outline, or its row's for a switch. */
  const FOCUS_RING_NOW = `(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    let ring = null;
    for (let node = e, up = 0; node && up < 4 && !ring; node = node.parentElement, up++) {
      const s = getComputedStyle(node);
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 && s.outlineColor !== "rgba(0, 0, 0, 0)") ring = parseFloat(s.outlineWidth);
    }
    return { role: e.getAttribute("role") || e.tagName.toLowerCase(), name: (e.getAttribute("aria-label") || e.textContent || "").trim(), disabled: e.getAttribute("aria-disabled"), ring };
  })()`;

  /** A generated archive of `size` bytes, a zip's local header first, every other byte from its place. */
  function generatedArchive(size: number): Buffer {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
    return bytes;
  }

  /** Chooses a file through the browser's file picker, which Choose your archive opens. */
  async function chooseFile(page: Page, name: string, buffer: Buffer): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: IMPORT_WORDS["import.choose"] }).click();
    await (await chooser).setFiles({ name, mimeType: name.endsWith(".zip") ? "application/zip" : "application/gzip", buffer });
  }

  /** Forgets the picks a step made in the ready import's list, so the next step reads the preview as the fixture gives it. */
  const forgetPicks = () => fixtures.state.imports.picks.clear();

  /** Opens the preview, chooses a range, brings images, opens See every post, leaves the first post out and ticks the statement. */
  async function choosePreview(page: Page): Promise<void> {
    await visit(page, importAt(IMPORT_READY));
    await page.getByRole("radio", { name: IMPORT_WORDS["import.choose.range"] }).click();
    await page.getByRole("button", { name: IMPORT_WORDS["import.choose.from"] }).waitFor();
    // The switch takes no pointer of its own: its row flips it (UI design, section 6.11).
    await page.getByText(IMPORT_WORDS["import.choose.images"], { exact: true }).click();
    await page.getByRole("button", { name: IMPORT_WORDS["import.seeAll"] }).click();
    await page.getByRole("checkbox", { name: IMPORT_WORDS["import.list.leaveOut"] }).first().click();
    await until(page, `document.querySelectorAll('[role="checkbox"][aria-checked="true"]').length === 1`, "the post left out");
    await page.getByRole("checkbox", { name: IMPORT_WORDS["import.statement"] }).click();
    await page.waitForLoadState("networkidle");
    await pause(300);
  }

  /** Opens the done import's Remove sheet and waits until it is open and its fade has ended. */
  async function openRemove(page: Page): Promise<void> {
    await visit(page, importAt(IMPORT_DONE));
    await page.getByRole("button", { name: IMPORT_WORDS["import.remove"] }).click();
    await until(page, `${DIALOG_NAME} === ${JSON.stringify(fill(IMPORT_WORDS["import.remove.ask"], { n: "1,240" }))}`, "the Remove sheet");
    await pause(500);
  }

  test("41. the import's screens at 360, 768 and 1280 in Dark: the start with a source chosen, the preview with a range, a post left out and the statement ticked, the progress, the result and the Remove sheet; nothing scrolls sideways, no label is cut, every control 44 px at 360", async () => {
    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme: "dark" } });
      const page = visit_.page;
      const check = async (name: string, scope = ALL) => {
        expect(await page.evaluate(SIDEWAYS), `${width} ${name}`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(page, scope), `${width} ${name}`).toEqual([]);
        if (width < 768) expect(await phoneProblems(page, scope), `${width} ${name}`).toEqual([]);
        await screenshot(page, `import-${width}-dark-${name}`);
      };
      try {
        await visit(page, "/settings/import");
        expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.import"]);
        expect(await page.locator("h1:visible").innerText()).toBe(IMPORT_WORDS["import.title"]);
        await page.getByRole("radio", { name: IMPORT_WORDS["import.source.mastodon"] }).click();
        await page.getByText(IMPORT_WORDS["import.never.mastodon"]).waitFor();
        await check("start");
        await choosePreview(page);
        expect(await page.evaluate(SHOWN_H2)).toEqual([IMPORT_WORDS["import.found.title"], IMPORT_WORDS["import.left.title"], IMPORT_WORDS["import.choose.title"], IMPORT_WORDS["import.confirm.title"]]);
        expect(await page.locator('[role="button"][aria-disabled="true"]').count()).toBe(0);
        await check("preview");
        await visit(page, importAt(IMPORT_PUBLISHING));
        await check("progress");
        await visit(page, importAt(IMPORT_DONE));
        await check("result");
        await openRemove(page);
        await check("remove-sheet", '[role="dialog"]');
        await page.keyboard.press("Escape");
        await page.locator('[role="dialog"]').waitFor({ state: "detached" });
        await clean(visit_);
      } finally {
        forgetPicks();
        await visit_.context.close();
      }
    }
  });

  for (const [step, theme] of [
    [42, "light"],
    [43, "dim"],
    [44, "dark"],
  ] as const) {
    test(`${step}. contrast as drawn in ${theme}: the preview, the Remove sheet and a profile's Imported tab`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      const page = visit_.page;
      try {
        await choosePreview(page);
        expect(await contrast(page, ALL), `${theme} the preview`).toEqual([]);
        await openRemove(page);
        expect(await contrast(page, '[role="dialog"]'), `${theme} the Remove sheet`).toEqual([]);
        await page.keyboard.press("Escape");
        await visit(page, "/u/grace?tab=imported");
        await page.getByText("Imported from X, dated 3 Mar 2019").waitFor();
        expect(await contrast(page, DRAWN), `${theme} the Imported tab`).toEqual([]);
        await screenshot(page, `import-contrast-${theme}-imported-tab`);
        await clean(visit_);
      } finally {
        forgetPicks();
        await visit_.context.close();
      }
    });
  }

  test("45. at 320 by 640 with Largest text and the root at 200 percent, the preview and the Remove sheet scroll no sideways and cut no label", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    const page = visit_.page;
    try {
      await choosePreview(page);
      await page.evaluate(`document.documentElement.style.fontSize = "200%"`);
      await pause(300);
      expect(await page.evaluate(SIDEWAYS), "the preview").toBeLessThanOrEqual(0);
      expect(await clippedLabels(page, ALL), "the preview").toEqual([]);
      await screenshot(page, "largest-320-import-preview");
      await openRemove(page);
      await page.evaluate(`document.documentElement.style.fontSize = "200%"`);
      await pause(300);
      expect(await page.evaluate(SIDEWAYS), "the Remove sheet").toBeLessThanOrEqual(0);
      expect(await clippedLabels(page, '[role="dialog"]'), "the Remove sheet").toEqual([]);
      await screenshot(page, "largest-320-import-remove");
      await clean(visit_);
    } finally {
      forgetPicks();
      await visit_.context.close();
    }
  });

  test("46. reading: the spinner turns; under the system's reduced motion and korbat's own, the import icon stands still in its place", async () => {
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, ...options });
      const page = visit_.page;
      try {
        await visit(page, importAt(IMPORT_SCANNING));
        await page.getByText(IMPORT_WORDS["import.reading"]).first().waitFor();
        const still = await page.locator('[data-reading="still"]').count();
        const spin = await page.locator('[data-reading="spin"]').count();
        const frames = await sampleFrames(page, `document.querySelector('[data-reading]')`, "transform", 400);
        if (name === "moves") {
          expect([still, spin], name).toEqual([0, 1]);
          expect(transformed(frames), name).toBe(true);
        } else {
          expect([still, spin], name).toEqual([1, 0]);
          expect(transformed(frames), name).toBe(false);
        }
        await screenshot(page, `import-reading-${name}`);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("47. the preview by keyboard alone: every control in order, each with its ring; Publish is reached while aria-disabled, and Enter on it moves the focus to the statement", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    const page = visit_.page;
    try {
      await visit(page, importAt(IMPORT_READY));
      await page.locator("main h2").first().focus();
      type Stop = { role: string; name: string; disabled: string | null; ring: number | null };
      const stops: Stop[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const stop = (await page.evaluate(FOCUS_RING_NOW)) as Stop | null;
        if (stop === null) continue;
        stops.push(stop);
        expect(stop.ring, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
        if (stop.name.startsWith(IMPORT_WORDS["import.publish"].split(" ")[0]!) && stop.disabled === "true") break;
      }
      const names = stops.map((stop) => stop.name);
      const order = [
        IMPORT_WORDS["import.seeAll"],
        IMPORT_WORDS["import.choose.all"],
        IMPORT_WORDS["import.choose.replies"],
        IMPORT_WORDS["import.choose.warnings"],
        IMPORT_WORDS["import.choose.images"],
        IMPORT_WORDS["import.choose.long.leave"],
        IMPORT_WORDS["import.rules.link"],
        IMPORT_WORDS["import.statement"],
      ];
      const at = order.map((name) => names.findIndex((found) => found.startsWith(name)));
      expect(at.every((index) => index >= 0), JSON.stringify(names)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      const publish = stops.at(-1)!;
      expect(publish.disabled).toBe("true");
      expect(publish.name).toBe(fill(IMPORT_WORDS["import.publish"], { n: "60" }));
      await screenshot(page, "import-keyboard-publish");
      await page.keyboard.press("Enter");
      await until(page, `document.activeElement && document.activeElement.getAttribute("role") === "checkbox"`, "the statement focused");
      expect(((await page.evaluate(FOCUS_RING_NOW)) as Stop).name).toBe(IMPORT_WORDS["import.statement"]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("48. a change of state while the screen is open: reading turns ready, its sentence is said politely, and the focus, whose button left with the old view, goes to the new heading", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, importAt(IMPORT_SCANNING));
      await page.getByRole("button", { name: IMPORT_WORDS["import.cancel"] }).focus();
      fixtures.state.imports.scanReady = true;
      // The screen reads the import every 3 s while the page is visible.
      await until(page, `${SHOWN_H2}[0] === ${JSON.stringify(IMPORT_WORDS["import.found.title"])}`, "the preview", 15_000);
      await until(page, `document.activeElement && document.activeElement.tagName === "H2"`, "the new heading focused", 3_000);
      expect(await page.evaluate(`document.activeElement.textContent.trim()`)).toBe(IMPORT_WORDS["import.found.title"]);
      expect(await page.evaluate(STATUSES)).toContain(IMPORT_WORDS["import.now.ready"]);
      await screenshot(page, "import-state-change");
      await clean(visit_);
    } finally {
      fixtures.state.imports.scanReady = false;
      await visit_.context.close();
    }
  });

  test("49. the progress bars carry their four values and their value text: publishing, and preparing with its two phases", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    const BARS = `[...document.querySelectorAll('main [role="progressbar"]')].filter((b) => b.getClientRects().length > 0).map((b) => [b.getAttribute("aria-valuemin"), b.getAttribute("aria-valuemax"), b.getAttribute("aria-valuenow"), b.getAttribute("aria-valuetext")])`;
    try {
      await visit(page, importAt(IMPORT_PUBLISHING));
      expect(await page.evaluate(BARS)).toEqual([["0", "100", "65", fill(IMPORT_WORDS["import.publishing"], { done: "800", total: "1,240" })]]);
      await visit(page, importAt("00000000-0000-4000-8000-000000000804"));
      expect(await page.evaluate(BARS)).toEqual([
        ["0", "100", "28", fill(IMPORT_WORDS["import.preparing"], { done: "340", total: "1,200" })],
        ["0", "100", "0", fill(IMPORT_WORDS["import.publishing"], { done: "0", total: "1,240" })],
      ]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("50. the Imported tab: ?tab=imported opens it; the label is a 44 px button that opens Who sees this at the provenance; @ada is no link; the post's links are nofollow ugc; at 360 nothing scrolls sideways and no label is cut", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme: "light" } });
      const page = visit_.page;
      try {
        await visit(page, "/u/grace?tab=imported");
        const label = page.getByRole("button", { name: "Imported from X, dated 3 March 2019. About imported posts" });
        await label.waitFor();
        expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(IMPORT_WORDS["import.tab"]);
        expect(await label.innerText()).toBe("Imported from X, dated 3 Mar 2019");
        expect(await page.getByText(`Imported from Mastodon, dated 20 Nov 2018${IMPORT_WORDS["import.label.shortened"]}`).count()).toBe(1);
        const box = (await label.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(await page.locator('[role="article"] a[href="/u/ada"]').count()).toBe(0);
        expect(await page.locator(`[role="article"] a[href="https://example.org/harbour"]`).getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
        expect(await page.evaluate(SIDEWAYS)).toBeLessThanOrEqual(0);
        expect(await clippedLabels(page, DRAWN)).toEqual([]);
        if (width < 768) expect(await phoneProblems(page, DRAWN)).toEqual([]);
        await screenshot(page, `import-tab-${width}`);
        await label.click();
        await until(page, `${DIALOG_NAME} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "Who sees this");
        await until(page, `(document.activeElement && document.activeElement.textContent || "").startsWith("Anyone who searches the words of an imported post")`, "the provenance focused");
        expect(await page.locator('[role="dialog"]').innerText()).toContain(IMPORT_WORDS["import.reach"]);
        await pause(400);
        await screenshot(page, `import-provenance-${width}`);
        await page.keyboard.press("Escape");
        await page.locator('[role="dialog"]').waitFor({ state: "detached" });
        expect(await page.evaluate(FOCUSED)).toBe("Imported from X, dated 3 March 2019. About imported posts");
        // No post of the tab asked for its Explore status: an imported post's is known.
        expect(fixtures.state.requests.some((request) => request.path.startsWith(`/api/posts/${IMPORTED_POST_ID}/explore`))).toBe(false);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("51. the upload: a .tar.gz is refused before anything is sent; 20 MB go in three chunks against the fixture, one refused and sent again, one whose answer is lost and resumed from the import's stored bytes; a stopped upload asks for the same file", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    const imports = fixtures.state.imports;
    imports.chunks = [];
    // The second chunk arrives but its answer is lost, until the app reads the import; the third is refused once (chunk_mismatch).
    imports.dropUntilRead = new Set([IMPORT_RULES.chunkBytes]);
    imports.refuseOnce = new Set([2 * IMPORT_RULES.chunkBytes]);
    // What the API was asked from here on: a retried step starts from its own requests.
    const from = fixtures.state.requests.length;
    const bytes = generatedArchive(ARCHIVE_BYTES);
    try {
      await visit(page, "/settings/import");
      await page.getByRole("radio", { name: IMPORT_WORDS["import.source.mastodon"] }).click();
      await chooseFile(page, "archive.tar.gz", Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]));
      await until(page, `[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes(${JSON.stringify(IMPORT_WORDS["import.tarGz"])}))`, "the .tar.gz sentence");
      expect(fixtures.state.requests.slice(from).some((request) => request.method === "POST" && request.path === "/api/imports")).toBe(false);
      await chooseFile(page, "archive.zip", bytes);
      await page.getByText(fill(IMPORT_WORDS["import.chosen"], { name: "archive.zip", size: "20 MB" })).waitFor();
      // Each chunk's answer waits, so the bar and its value text can be seen while the archive goes in.
      fixtures.state.delayMs = 400;
      await page.getByRole("button", { name: IMPORT_WORDS["import.start"] }).click();
      await until(page, `location.pathname === ${JSON.stringify(importAt(IMPORT_NEW))}`, "the import's screen");
      await until(page, `!!document.querySelector('[role="progressbar"][aria-label=${JSON.stringify(IMPORT_WORDS["import.bar.upload"])}][aria-valuetext$="of 20 MB"]')`, "the upload's value text", 20_000);
      await screenshot(page, "import-uploading");
      await until(page, `${SHOWN_H2}[0] === ${JSON.stringify(IMPORT_WORDS["import.state.scanning"])}`, "reading the archive", 60_000);
      fixtures.state.delayMs = 0;
      // Chromium itself tries a PUT again once when a reused connection closes without an answer: tries lost in a row count once.
      const tries = imports.chunks.map((chunk) => [chunk.offset, chunk.length, chunk.answer]).filter((chunk, index, all) => !(chunk[2] === 0 && index > 0 && all[index - 1]![2] === 0 && all[index - 1]![0] === chunk[0]));
      expect(tries).toEqual([
        [0, IMPORT_RULES.chunkBytes, 200],
        [IMPORT_RULES.chunkBytes, IMPORT_RULES.chunkBytes, 0],
        [2 * IMPORT_RULES.chunkBytes, ARCHIVE_BYTES - 2 * IMPORT_RULES.chunkBytes, 400],
        [2 * IMPORT_RULES.chunkBytes, ARCHIVE_BYTES - 2 * IMPORT_RULES.chunkBytes, 200],
      ]);
      // After the lost answer the app read the import before it sent more: a GET between the second and the third PUT.
      const asked = fixtures.state.requests.slice(from).map((request) => `${request.method} ${request.path}`).filter((line) => line.includes(IMPORT_NEW));
      const puts = asked.flatMap((line, index) => (line === `PUT /api/imports/${IMPORT_NEW}/archive` ? [index] : []));
      // The fixture answers no try of the lost chunk until the import is read, so the chunks after it came after a read.
      expect(asked.slice(puts[1]! + 1, puts.at(-1)!)).toContain(`GET /api/imports/${IMPORT_NEW}`);
      expect(createHash("sha256").update(imports.archive).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
      // The refused chunk and the lost connection are what the fixture did on purpose; nothing else is reported.
      expect(visit_.watcher.take().filter((line) => !/status of 400|ERR_EMPTY_RESPONSE|ERR_CONNECTION|\/archive/.test(line))).toEqual([]);
      expect(fixtures.state.problems.splice(0)).toEqual([]);
      // An upload stopped elsewhere, with no file in hand: where it stopped, and only a file of the same size goes on.
      await visit(page, importAt(IMPORT_RESUME));
      await page.getByText(fill(IMPORT_WORDS["import.resume"], { done: "8.4 MB", total: "20 MB" })).waitFor();
      await chooseFile(page, "other.zip", generatedArchive(1000));
      await until(page, `[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes(${JSON.stringify(IMPORT_WORDS["import.wrongFile"])}))`, "the size check");
      await screenshot(page, "import-resume");
      await clean(visit_);
    } finally {
      fixtures.state.delayMs = 0;
      imports.dropUntilRead.clear();
      imports.refuseOnce.clear();
      await visit_.context.close();
    }
  });

  // 2d Task 5 (2d design, section 10.9) appends steps 52 to 57 below, so the steps above keep their numbers.

  /** Activity's state as the fixture starts it: two entries new against the stored marker, nothing newer, the defaults. */
  const resetActivity = () => {
    fixtures.state.activity = { seenAt: ACTIVITY_SEEN, seen: [], newer: 0, fresh: 0, settings: { ...ACTIVITY_DEFAULTS }, saves: [] };
  };
  /** The names of the shown articles of the main column, in order. */
  const ARTICLE_NAMES = `[...document.querySelectorAll('main [role="article"][aria-label]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`;
  /** The shown h2s of the main column, in order. */
  const H2S = `[...document.querySelectorAll("main h2")].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent)`;
  /** The aria-label of the focused element, and the key of the list row it is in. */
  const FOCUSED_NAME = `document.activeElement ? document.activeElement.getAttribute("aria-label") : null`;
  const FOCUSED_ROW = `(() => { const row = document.activeElement && document.activeElement.closest("[data-row]"); return row ? row.getAttribute("data-row") : null; })()`;
  /** A fixture entry's id, as fixture-api.ts numbers them. */
  const entryId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  test("52. Activity at 360, 768 and 1280 in Light, Dim and Dark: its tabs, headings and rows, each entry's name, the seen marker, the pill and the focus after it and after Load more, a follow group's three links; no other route asks for Activity and nothing on the nav or in the title changes; at 360 Settings is reached from the profile", async () => {
    // No route but Activity asks for it: Home, Bookmarks, a profile and Settings, each left open past a poll's wait.
    const quiet = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    try {
      await quiet.page.clock.install();
      const from = fixtures.state.requests.length;
      for (const route of ["/", "/bookmarks", "/u/ada", "/settings", "/post/" + POST_ID]) {
        await visit(quiet.page, route);
        await quiet.page.clock.fastForward(95_000);
        await pause(200);
      }
      expect(fixtures.state.requests.slice(from).filter((request) => request.path.startsWith("/api/activity"))).toEqual([]);
      await clean(quiet);
    } finally {
      await quiet.context.close();
    }

    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dim", "dark"] as const) {
        resetActivity();
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/activity");
          await page.locator('main [role="article"]').first().waitFor();
          expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.activity"]);
          expect(await page.locator("h1:visible").innerText()).toBe(ACTIVITY_WORDS["activity.title"]);
          expect(await page.locator('[role="tablist"]:visible').getAttribute("aria-label")).toBe(ACTIVITY_WORDS["activity.tabs"]);
          expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(ACTIVITY_WORDS["activity.tab.all"]);
          // The two new entries first, under "New since you last looked", then "Earlier"; each article named by its line and time.
          expect(await page.evaluate(H2S)).toEqual([ACTIVITY_WORDS["activity.divider"], ACTIVITY_WORDS["activity.earlier"]]);
          const names = (await page.evaluate(ARTICLE_NAMES)) as string[];
          expect(names.slice(0, 2).every((name) => name.startsWith("New, "))).toBe(true);
          // The times are the fixtures' (minutes before the walk started), so only the words before them are pinned here.
          expect(names[0]).toMatch(/^New, Grace Hopper replied to your post, [0-9]+[mhd] ago$/);
          expect(names[1]).toMatch(/^New, Linus mentioned you, [0-9]+[mhd] ago$/);
          expect(names[2]).toMatch(/^Grace Hopper and 4 others followed you, [0-9]+[mhd] ago$/);
          expect(names.slice(2).some((name) => name.startsWith("New, "))).toBe(false);
          // The marker went once, with the newest entry's time to the microsecond.
          await expect.poll(() => fixtures.state.activity.seen.length).toBe(1);
          expect(fixtures.state.activity.seen[0]! > ACTIVITY_SEEN).toBe(true);
          expect(fixtures.state.activity.seen[0]).toMatch(/[.][0-9]{6}Z$/);
          // The nav's Activity item is its label alone, and the title names no count.
          expect(await page.locator('nav[aria-label="Main"] a[href="/activity"]').innerText()).toBe(UI_WORDS["nav.activity"]);
          expect(await page.evaluate(SIDEWAYS)).toBeLessThanOrEqual(0);
          expect(await clippedLabels(page, ALL)).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, ALL)).toEqual([]);
          expect(await contrast(page, "main")).toEqual([]);
          await screenshot(page, `activity-${width}-${theme}`);
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }

    // At 1280: the follow group's links, Conversations in the address, Load more and the pill with the focus after each.
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await page.clock.install();
      await visit(page, "/activity");
      const group = page.locator('main [role="article"][aria-label^="Grace Hopper and 4 others"]');
      await group.waitFor();
      expect(await group.locator("a").evaluateAll((links) => links.map((link) => [link.getAttribute("aria-label") || link.textContent, link.getAttribute("href")]))).toEqual([
        ["Grace Hopper", "/u/grace"],
        ["Linus", "/u/linus"],
        ["Mary Somerville", "/u/mary"],
        [ACTIVITY_WORDS["activity.follow.all"], "/u/ada/followers"],
      ]);
      // Each of them a 44 px target; the pictures are the fixture's squares, drawn.
      for (const box of await group.locator("a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
      await until(page, `[...document.querySelectorAll('main [role="article"] img')].some((img) => img.complete && img.naturalWidth === 128)`, "an avatar drawn");
      // A post entry's one action is Reply, which opens the thread with its reply card.
      const reply = page.locator(`main [role="article"][aria-label^="New, Grace Hopper replied"]`);
      const actions = (await reply.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))) as string[];
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatch(/^Reply/);
      // Load more, at the end of the first page: the focus goes to the first entry it brought, the 31st, an older reply.
      const loadMore = page.getByRole("button", { name: UI_WORDS["feed.loadMore"] });
      // The list draws its rows in batches as it scrolls: on a loaded machine the end can take a while to come into the window.
      for (let i = 0; i < 60 && (await loadMore.count()) === 0; i++) {
        await scrollList(page, 100_000);
        await pause(400);
      }
      await loadMore.click();
      await until(page, `${FOCUSED_ROW} === "e:${entryId(1340)}"`, "the first entry Load more brought focused");
      expect(await page.evaluate(FOCUSED_NAME)).toMatch(/^Grace Hopper replied to your post, /);
      await page.getByText(fill(ACTIVITY_WORDS["activity.end"], { days: 90 })).waitFor();
      // The pill: three newer entries after the poll's 30 s; the nav and the title stay as they are.
      fixtures.state.activity.newer = 3;
      fixtures.state.activity.fresh = 3;
      const navBefore = await page.locator('nav[aria-label="Main"]').innerText();
      await page.clock.fastForward(31_000);
      const pill = page.locator("[data-pill]");
      await pill.waitFor({ state: "visible" });
      expect(await pill.innerText()).toBe("3 new");
      expect(await pill.getAttribute("aria-label")).toBe("3 new above, go to the first one");
      expect(await page.locator('nav[aria-label="Main"]').innerText()).toBe(navBefore);
      expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.activity"]);
      expect(fixtures.state.requests.some((request) => request.path.startsWith("/api/activity/newer?tab=all&since="))).toBe(true);
      await pause(400);
      await screenshot(page, "activity-pill-1280-light");
      await pill.click();
      // The first page again at the top, the newest of the three first, and the focus on it.
      await until(page, `${FOCUSED_ROW} === "e:${entryId(1383)}"`, "the first entry of the new first page focused");
      expect(await page.evaluate(FOCUSED_NAME)).toMatch(/^New, Grace Hopper replied to your post, /);
      expect(fixtures.state.activity.seen.length).toBe(2);
      // Conversations keeps replies, mentions and quotes, and stays in the address.
      await page.getByRole("tab", { name: ACTIVITY_WORDS["activity.tab.conversations"] }).click();
      await until(page, `location.search === "?tab=conversations"`, "the tab in the address");
      await page.reload();
      await page.locator('main [role="article"]').first().waitFor();
      expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(ACTIVITY_WORDS["activity.tab.conversations"]);
      expect(((await page.evaluate(ARTICLE_NAMES)) as string[]).some((name) => name.includes("followed you") || name.includes("decision"))).toBe(false);
      await clean(visit_);
    } finally {
      fixtures.state.activity.newer = 0;
      fixtures.state.activity.fresh = 0;
      await visit_.context.close();
    }

    // At 360 the tab bar has four items, and Settings is the profile's button, found by its name.
    const phone = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    try {
      await visit(phone.page, "/u/ada");
      expect(await phone.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Main"] a')].map((link) => link.getAttribute("href"))`)).toEqual(["/", "/activity", "/bookmarks", "/u/ada"]);
      await phone.page.getByRole("button", { name: UI_WORDS["profile.settings"], exact: true }).click();
      await until(phone.page, `location.pathname === "/settings"`, "the Settings index from the profile");
      await phone.page.waitForLoadState("networkidle");
      expect(await phone.page.locator("h1:visible").innerText()).toBe(UI_WORDS["settings.title"]);
      await clean(phone);
    } finally {
      await phone.context.close();
    }
  });

  test("53. Settings, Activity: four radio groups by keyboard, each one tab stop; arrowing across a group sends one request, with one toast, once it is still or the focus leaves it", async () => {
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/activity");
      await page.getByRole("radiogroup").first().waitFor();
      expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.settingsActivity"]);
      expect(await page.getByRole("radiogroup").count()).toBe(4);
      // The settings row marks Activity current.
      expect(await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/settings/activity"]);
      const replies = page.getByRole("radiogroup", { name: ACTIVITY_SETTINGS_WORDS.replies });
      await replies.getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.everyone }).focus();
      // Three arrows across the group: the choice moves at once, and one request goes when it has been still for 800 ms.
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
      expect(await replies.getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.off }).getAttribute("aria-checked")).toBe("true");
      expect(fixtures.state.activity.saves).toEqual([]);
      await until(page, `document.querySelectorAll("[data-sonner-toast]").length > 0`, "the toast", 5000);
      expect(fixtures.state.activity.saves).toEqual([{ ...ACTIVITY_DEFAULTS, replies: "off" }]);
      expect(await page.locator("[data-sonner-toast]").last().innerText()).toBe(ACTIVITY_SETTINGS_WORDS.saved);
      // One arrow in the follows group, then Tab away at once: saved as the focus leaves, still one request.
      await page.getByRole("radiogroup", { name: ACTIVITY_SETTINGS_WORDS.follows }).getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.on }).focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect.poll(() => fixtures.state.activity.saves.length, { timeout: 500 }).toBe(2);
      expect(fixtures.state.activity.saves).toEqual([
        { ...ACTIVITY_DEFAULTS, replies: "off" },
        { ...ACTIVITY_DEFAULTS, replies: "off", follows: false },
      ]);
      expect(await clippedLabels(page, ALL)).toEqual([]);
      await screenshot(page, "settings-activity-1280-light");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    for (const theme of ["light", "dark"] as const) {
      const narrow = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(narrow.page, "/settings/activity");
        await narrow.page.getByRole("radiogroup").first().waitFor();
        expect(await clippedLabels(narrow.page, ALL)).toEqual([]);
        expect(await phoneProblems(narrow.page, ALL)).toEqual([]);
        expect(await contrast(narrow.page, "main")).toEqual([]);
        await screenshot(narrow.page, `settings-activity-360-${theme}`);
        await clean(narrow);
      } finally {
        await narrow.context.close();
      }
    }
  });

  /** Picks a file in the browser's file dialog, which `button` opens. */
  async function pickFile(page: Page, button: string, name: string, buffer: Buffer): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: "image/webp", buffer });
  }
  /** A portrait the picker is given: 300 by 600, one colour. */
  const PORTRAIT = solidWebp(300, [0xb4, 0x3c, 0x1e], 600);
  const PREVIEW = `(() => { const img = [...document.querySelectorAll("main img")].find((e) => (e.getAttribute("alt") || "").startsWith(${JSON.stringify(AVATAR_WORDS.preview)})); return img ? { alt: img.getAttribute("alt"), position: getComputedStyle(img).objectPosition, fit: getComputedStyle(img).objectFit } : null; })()`;

  test("54. the avatar picker: a fixture image chosen, its part kept by the preview, uploaded as kind avatar with the crop, the status line, then the header and a post card show it; a refused, a failed and a reset upload as error lines that take the focus; the removal's question; the focus after each", async () => {
    const upload = fixtures.state.upload;
    fixtures.state.avatar = null;
    Object.assign(upload, { outcome: "ready", polls: 0, reset: false, queries: [] });
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/profile");
      await page.getByRole("heading", { name: AVATAR_WORDS.section }).waitFor();
      expect(await page.getByRole("button", { name: AVATAR_WORDS.remove }).count()).toBe(0);
      await pickFile(page, AVATAR_WORDS.choose, "portrait.webp", PORTRAIT);
      // A portrait: Top, Middle and Bottom, Middle first; the preview covers the disc at the part kept, named by it.
      const keep = page.getByRole("radiogroup", { name: AVATAR_WORDS.keep });
      await keep.waitFor();
      expect(await keep.getByRole("radio").allInnerTexts()).toEqual([AVATAR_WORDS.top, AVATAR_WORDS.middle, AVATAR_WORDS.bottom]);
      await until(page, `(${PREVIEW}) && (${PREVIEW}).alt === ${JSON.stringify(fill(AVATAR_WORDS.previewPart, { part: AVATAR_WORDS.middle }))}`, "the preview at Middle");
      await keep.getByRole("radio", { name: AVATAR_WORDS.top }).click();
      await until(page, `(${PREVIEW}).alt === ${JSON.stringify(fill(AVATAR_WORDS.previewPart, { part: AVATAR_WORDS.top }))}`, "the preview at Top");
      const preview = (await page.evaluate(PREVIEW)) as { position: string; fit: string };
      expect(preview.fit).toBe("cover");
      expect(preview.position).toMatch(/^50% 0(%|px)$/);
      await screenshot(page, "avatar-preview-1280-light");
      // Use this picture: the status line says it uploads, then that it is prepared; then the toast and the focus.
      fixtures.state.delayMs = 400;
      await page.getByRole("button", { name: AVATAR_WORDS.use }).click();
      await page.locator('[role="status"]').getByText(AVATAR_WORDS.uploading).waitFor();
      fixtures.state.delayMs = 0;
      await page.locator('[role="status"]').getByText(AVATAR_WORDS.processing).waitFor();
      await page.locator("[data-sonner-toaster]").getByText(AVATAR_WORDS.updated).waitFor({ state: "visible" });
      await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.change)}`, "Choose another picture focused");
      expect(upload.queries).toEqual(["?kind=avatar&crop=start"]);
      // The header (96 px: the large file) and Ada's own post cards (40 px: the small one) show it.
      await visit(page, "/u/ada");
      await until(page, `[...document.querySelectorAll("[data-profile-header] img")].some((img) => img.complete && img.naturalWidth === 400 && img.src.endsWith("/large.webp"))`, "the header's picture");
      await until(page, `[...document.querySelectorAll('[role="article"] img')].some((img) => img.complete && img.naturalWidth === 128 && img.src.includes(${JSON.stringify(AVATAR_UPLOAD_ID)}))`, "a card's picture");
      await screenshot(page, "avatar-profile-1280-light");

      // A refused, a failed and a reset upload: each an error line that takes the focus.
      for (const [outcome, reset, words] of [
        ["refused", false, UPLOAD_TEXTS.refused],
        ["failed", false, AVATAR_WORDS.failed],
        ["ready", true, AVATAR_WORDS.resetRecently],
      ] as const) {
        Object.assign(upload, { outcome, reset });
        await visit(page, "/settings/profile");
        await pickFile(page, AVATAR_WORDS.change, "portrait.webp", PORTRAIT);
        await page.getByRole("button", { name: AVATAR_WORDS.use }).click();
        await page.locator('[role="alert"]').getByText(words).waitFor();
        await until(page, `(document.activeElement && document.activeElement.textContent || "").includes(${JSON.stringify(words)})`, `${outcome} focused`);
        if (outcome === "refused") {
          // Its Why link is next in order, to the refusal's notice.
          await page.keyboard.press("Tab");
          expect(await page.evaluate(`document.activeElement.getAttribute("href")`)).toBe(`/settings/cases/uploads/${UPLOAD_ID}`);
          // A refused upload is shown to nobody: its preview went with it, and the chooser is back.
          expect(await page.evaluate(PREVIEW)).toBeNull();
          expect(await page.getByRole("button", { name: AVATAR_WORDS.use }).count()).toBe(0);
          await screenshot(page, "avatar-refused-1280-light");
          continue;
        }
        // Cancel drops the file, and the focus goes back to the chooser.
        await page.getByRole("button", { name: AVATAR_WORDS.cancel }).click();
        await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.change)}`, "the chooser focused after Cancel");
      }
      Object.assign(upload, { outcome: "ready", reset: false });

      // Remove picture asks first; Remove deletes it, says so, and the focus is on Choose a picture.
      await page.getByRole("button", { name: AVATAR_WORDS.remove }).click();
      await until(page, `${DIALOG_NAME} === ${JSON.stringify(AVATAR_WORDS.confirmTitle)}`, "the removal's question");
      expect(await page.locator('[role="dialog"]').innerText()).toContain(AVATAR_WORDS.confirmBody);
      await screenshot(page, "avatar-remove-1280-light");
      await page.locator('[role="dialog"]').getByRole("button", { name: AVATAR_WORDS.confirm, exact: true }).click();
      await page.locator("[data-sonner-toaster]").getByText(AVATAR_WORDS.removed).waitFor({ state: "visible" });
      await page.locator('[role="dialog"]').waitFor({ state: "detached" });
      await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.choose)}`, "Choose a picture focused");
      expect(fixtures.state.avatar).toBeNull();
      expect(visit_.watcher.take().filter((line) => !/status of 409/.test(line))).toEqual([]);
      expect(fixtures.state.problems.splice(0)).toEqual([]);
    } finally {
      fixtures.state.delayMs = 0;
      fixtures.state.avatar = null;
      Object.assign(upload, { outcome: "ready", reset: false });
      await visit_.context.close();
    }
    // At 360 the card's controls are 44 px and nothing is cut.
    for (const theme of ["light", "dark"] as const) {
      const narrow = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(narrow.page, "/settings/profile");
        await narrow.page.getByRole("heading", { name: AVATAR_WORDS.section }).waitFor();
        expect(await clippedLabels(narrow.page, ALL)).toEqual([]);
        expect(await phoneProblems(narrow.page, ALL)).toEqual([]);
        expect(await contrast(narrow.page, "main")).toEqual([]);
        await screenshot(narrow.page, `avatar-card-360-${theme}`);
        await clean(narrow);
      } finally {
        await narrow.context.close();
      }
    }
  });

  test("55. mentions: a stored one links to its profile in accent ink with no underline; one that was not stored, and an imported post's, are text", async () => {
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/activity");
      const reply = page.locator(`main [role="article"][aria-label^="New, Grace Hopper replied"]`);
      await reply.waitFor();
      // The reply's context names @ada too; the body's mention is the second link to her.
      expect(await reply.locator('a[href="/u/ada"]').count()).toBe(2);
      const mention = reply.locator('a[href="/u/ada"]').nth(1);
      expect(await mention.innerText()).toBe("@ada");
      expect(await mention.evaluate((link) => getComputedStyle(link).textDecorationLine)).toBe("none");
      expect(await mention.evaluate((link) => getComputedStyle(link).color)).toBe(rgb(THEMES.light["accent-ink"]));
      expect(await reply.innerText()).toContain("@nobody_here");
      expect(await reply.locator('a[href="/u/nobody_here"]').count()).toBe(0);
      await visit(page, "/u/grace?tab=imported");
      await page.locator('[role="article"]').first().waitFor();
      expect(await page.locator('[role="article"]').first().innerText()).toContain("@ada");
      expect(await page.locator('[role="article"] a[href="/u/ada"]').count()).toBe(0);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("56. Getting started at 360: a new account's empty Following shows the panel with Latest, Explore, the handle box, the profile's settings with where Settings is, and the rules; the handle box opens a profile", async () => {
    fixtures.state.emptyFollowing = true;
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        await page.getByRole("heading", { name: UI_WORDS["feed.start.title"] }).waitFor();
        const main = page.locator("main");
        for (const words of [UI_WORDS["feed.start.body"], UI_WORDS["feed.start.handle"], UI_WORDS["feed.start.settings"], UI_WORDS["shell.how1"]]) expect(await main.innerText()).toContain(words);
        expect(await page.getByRole("button", { name: UI_WORDS["feed.start.latest"] }).count()).toBe(1);
        for (const [words, href] of [
          [UI_WORDS["feed.start.explore"], "/explore/about"],
          [UI_WORDS["feed.start.profile"], "/settings/profile"],
          [UI_WORDS["feed.start.rules"], "/rules"],
        ] as const) {
          expect(await main.getByRole("link", { name: words }).getAttribute("href")).toBe(href);
        }
        expect(await clippedLabels(page, ALL)).toEqual([]);
        expect(await phoneProblems(page, ALL)).toEqual([]);
        expect(await contrast(page, "main")).toEqual([]);
        await screenshot(page, `getting-started-360-${theme}`);
        if (theme === "light") {
          await main.getByRole("textbox", { name: UI_WORDS["handle.field"] }).fill("@grace");
          await page.keyboard.press("Enter");
          await until(page, `location.pathname === "/u/grace"`, "the profile by its handle");
          await page.waitForLoadState("networkidle");
        }
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    fixtures.state.emptyFollowing = false;
  });

  test("57. hiding counts: the author's More menu hides a post's like and repost counts, with its toast; the author still reads them, Who sees this says so, and another reader gets no number", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    fixtures.state.hiddenCounts.clear();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      const own = postArticle(page, 3).first();
      await own.locator(MORE).click();
      const menu = page.locator("[data-menu]");
      await menu.waitFor({ state: "visible" });
      await menu.getByRole("button", { name: UI_WORDS["post.hideCounts"] }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["post.countsHidden"]).waitFor({ state: "visible" });
      expect(fixtures.state.hiddenCounts.has(postIdOf(3))).toBe(true);
      // The author keeps the numbers; the menu now offers to show them, and Who sees this says they are hidden.
      expect(await own.getByRole("button", { name: /^Like, [0-9]+ likes?$/ }).count()).toBe(1);
      await own.locator(MORE).click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.getByRole("button", { name: UI_WORDS["post.showCounts"] }).count()).toBe(1);
      await menu.getByRole("button", { name: new RegExp(`^${UI_WORDS["post.whoSees"]}`) }).click();
      await page.locator('[role="dialog"]').getByText(UI_WORDS["reach.countsHidden"]).waitFor();
      await page.keyboard.press("Escape");
      await page.locator('[role="dialog"]').waitFor({ state: "detached" });
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    const other = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme: "light" } });
    try {
      await visit(other.page, "/?tab=latest");
      const card = postArticle(other.page, 3).first();
      await card.waitFor();
      expect(await card.getByRole("button", { name: UI_WORDS["post.like.none"], exact: true }).count()).toBe(1);
      expect(await card.getByRole("button", { name: UI_WORDS["post.reposts.none"], exact: true }).count()).toBe(1);
      expect(await card.locator('[role="button"]').evaluateAll((buttons) => buttons.map((button) => button.textContent).join(" "))).not.toMatch(/[0-9]/);
      await screenshot(other.page, "counts-hidden-other-1280-light");
      await clean(other);
    } finally {
      fixtures.state.hiddenCounts.clear();
      await other.context.close();
    }
  });
});
