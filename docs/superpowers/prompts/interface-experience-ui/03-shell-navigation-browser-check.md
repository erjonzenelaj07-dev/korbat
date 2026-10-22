# korbat interface and experience (UI) — Task 3 of 10: The shell, navigation and the app's browser check: the layout of section 7 on every screen, and the check that guards everything after it.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 3 of ten in korbat's UI sub-project (interface and experience), the end of the batch of Tasks 1 to 3, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Task 1's tokens and Task 2's kit. It follows sections 7.1 to 7.5 (the four layouts, the skip link, safe areas, the context column of decision 14), 5.2 and 5.4 (header-hide, soft reset, toasts), 6.12 and 6.16, 8.1 and 8.11 (titles of decision 16, not found, the error boundary, offline) and 11.3, 12.3 and 12.4 (the budgets and the app's browser check of decision 20); Task 4 builds the post, its media and the lightbox on this shell.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- The ignored env files must hold every setting of the example files before the stack is rebuilt: `node scripts/gen-dev-env.mjs` appends any that is missing and generates the keys an example marks, and it prints no value. The dry run used ports 8380, 8390 and, for the push site, 8391 in its scratch clone. If another program listens on port 8080 on every interface, `localhost:8080` reaches it over IPv6 and the smoke test answers 404 on every path of the site of the app: free the port, or run the smoke step with `NODE_OPTIONS=--dns-result-order=ipv4first` (an earlier replay met this).
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the primitives, haptics, motion and the shared test mocks: kit/IconButton with a required label, pressed, busy, a compact count kept out of its name, a popup trigger's aria-expanded and a 500 ms tooltip for fine pointers; Avatar's monogram; ListRow's link, button, switch and radio forms; Skeleton's pulse, still at 0.8 under reduced motion; EmptyState; ErrorState with its offline form and one retry when the browser is online again; StatusChip's image, link and button forms, each tone with an icon of its own; VisuallyHidden; PublicFrame; lib/haptics.ts maps seven intents onto expo-haptics 57.0.3 behind the reader's switch, useMotion() reduces motion for the system or the reader, lib/time.ts takes timeAgo with dayTime, fullDate and postedWhen, compactCount truncates, ui-words.ts holds the kit's words; ui.tsx rebuilt on the kit leaves the colour list; test/setup.ts mocks the native modules once for every file; a scan refuses bare sentences in the markup, 38 files still listed; hover only on fine pointers; icons bundled one module at a time`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/03-shell-navigation-browser-check.md 1
```

Expected: 11 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/browser/app.browser.ts`

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
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import { createFixtureApi, DECISION_ID, MISSING_POST_ID, NOTICE_REF, NOTICE_TOKEN, POST_ID, RELEASE_ID, UPLOAD_ID, type FixtureApi } from "./fixture-api";
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
 * that hides on a phone, and stays under reduced motion; the soft reset. Later tasks add their screens' steps.
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
  "/settings/security",
  "/settings/privacy",
  "/settings/profile",
  "/settings/account",
  "/settings/cases",
  `/settings/cases/${DECISION_ID}`,
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
 * screen that is the kit's alone (the missing page). The screens' own content still paints with Tailwind's palette and
 * sizes until its task moves it onto the tokens (test/legacy-files.ts), and joins this list then: posts with Task 4, the
 * feeds, threads and profiles with Task 5, the composer with Task 6, the moderation and public pages with Task 7,
 * settings and sign-in with Task 8.
 */
const DRAWN = ['a[href="#main"]', 'nav[aria-label="Main"]', 'aside[aria-label="About korbat"]', "#screen-header", 'main > [role="status"]'].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/** The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each. */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: DRAWN },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
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
        await visit(visit_.page, page.route);
        const layout = (await visit_.page.evaluate(LAYOUT_SCRIPT)) as Layout;
        expect(layout.kind, page.name).toBe(kind);
        expect(layout.current, page.name).toEqual(page.current === null ? [] : [page.current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(width >= 1024);
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

  test("7. the keyboard: the skip link first, then the nav in order, then the main column, every focus drawn at 2 px or more", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    try {
      await visit(visit_.page, "/");
      const focused = `(() => { const e = document.activeElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), href: e.getAttribute("href"), inMain: !!e.closest("main"), isMain: e.tagName === "MAIN", inNav: !!e.closest('nav[aria-label="Main"]'), outline: s.outlineStyle, width: parseFloat(s.outlineWidth), w: r.width, h: r.height }; })()`;
      type Focus = { tag: string; href: string | null; inMain: boolean; isMain: boolean; inNav: boolean; outline: string; width: number; w: number; h: number };
      const stops: Focus[] = [];
      for (let i = 0; i < 6; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      expect(stops.slice(1, 5).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      expect(stops[5]!.inMain).toBe(true);
      // The shell's stops draw korbat's ring, 2 px; the first stop inside Home's column is Home's own tab, drawn by Task 5,
      // which shows the browser's ring until then.
      for (const stop of stops.slice(0, 5)) {
        expect(stop.outline, JSON.stringify(stop)).not.toBe("none");
        expect(stop.width, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
      }
      expect(stops[5]!.outline).not.toBe("none");
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
    test(`${step}. contrast as drawn in ${theme}: the shell on Home, a post and the rules, and the whole missing page`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      try {
        for (const [route, scope] of [
          ["/", DRAWN],
          [`/post/${POST_ID}`, DRAWN],
          ["/rules", DRAWN],
          ["/no-such-page", ALL],
        ] as const) {
          await visit(visit_.page, route);
          expect(await contrast(visit_.page, scope), `${theme} ${route}`).toEqual([]);
          await clean(visit_);
        }
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("11. at 320 by 640 with Largest text and the root at 200 percent, nothing scrolls sideways and no label is cut", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    try {
      // The screens this task draws: a missing page, wholly the kit's, and Bookmarks under its header. Home and a post
      // join when Task 5 moves them onto the kit (their tabs and rows still use fixed sizes from before).
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
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
});
```

### Create `apps/app/test/browser/caddyfile.ts`

```ts
import { APP_SITE, handles, matcherTakes, pathMatchers, readCaddyfile, routeFor, site, type CaddyNode, type Handle, type PathMatcher } from "../../../admin/test/caddyfile";

/**
 * The app's site in infra/caddy/Caddyfile, as the app's browser check needs it (UI design, section 12.3), read with the
 * console's reader (apps/admin/test/caddyfile.ts), so the check serves the export under the headers Caddy really sends
 * and never from a copy: the page's security headers (the app_page_headers snippet, its policy among them) and caching by
 * kind of file, immutable for /_expo/* and /assets/*, no-cache for the page and everything else. The site is the snippet
 * that APP_SITE names, open by default, as Caddy reads it with nothing set.
 */
export { APP_SITE, routeFor };

/** What a request to the app's site reaches: the API, a post's page (the shell under the post's status), or the files. */
export type AppRoute = { kind: "api" } | { kind: "own"; status: number; body: string; headers: Record<string, string> } | { kind: "post" } | { kind: "files" };

/** The app's site block, with its snippets put in. */
export function appSite(tree: CaddyNode[] = readCaddyfile()): CaddyNode {
  return site(tree, APP_SITE);
}

/** Whether a handle hands the request to the API as it is (reverse_proxy without a rewrite of its path). */
function proxies(handle: Handle): "api" | "post" | null {
  const proxy = handle.block.children?.find((node) => node.tokens[0] === "reverse_proxy");
  if (!proxy) return null;
  return proxy.children?.some((node) => node.tokens[0] === "rewrite") ? "post" : "api";
}

/** The `respond <body> <status>` of a handle that answers by itself, with its header lines; null for any other handle. */
function ownAnswer(handle: Handle): { status: number; body: string; headers: Record<string, string> } | null {
  // A respond with a matcher (respond @push 403) answers only the push network, which the walk never is.
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond" && !node.tokens[1]?.startsWith("@"));
  if (!respond) return null;
  const headers: Record<string, string> = {};
  for (const node of handle.block.children ?? []) {
    const [directive, name, value, ...rest] = node.tokens;
    if (directive === "header" && name !== undefined && value !== undefined && rest.length === 0 && !name.startsWith("-") && !name.startsWith("@")) headers[name] = value;
  }
  return { status: Number(respond.tokens[2] ?? 200), body: respond.tokens[1] ?? "", headers };
}

/** Where the site sends a request for `pathname`. */
export function appRoute(siteBlock: CaddyNode, pathname: string): AppRoute {
  const handle = routeFor(siteBlock, pathname);
  const proxy = proxies(handle);
  if (proxy === "api") return { kind: "api" };
  if (proxy === "post") return { kind: "post" };
  const own = ownAnswer(handle);
  if (own) return { kind: "own", ...own };
  return { kind: "files" };
}

/**
 * The response headers a handle's lines set for `pathname`: every `header { ... }` block (the imported app_page_headers),
 * every unconditional `header Name value` line, and each `header @matcher Name value` whose matcher takes the path, which
 * is what Caddy matches on (the header directive runs before try_files). Deletions such as -Server set nothing.
 */
function headersOf(block: CaddyNode): (pathname: string, isFile: boolean) => Record<string, string> {
  const matchers = pathMatchers(block);
  const always: Record<string, string> = {};
  const conditional: { matcher: PathMatcher; name: string; value: string }[] = [];
  const unknown = (node: CaddyNode) => new Error(`a header line the reader does not know: ${node.tokens.join(" ")}`);
  for (const node of block.children ?? []) {
    if (node.tokens[0] !== "header") continue;
    if (node.children !== undefined) {
      if (node.tokens.length !== 1) throw unknown(node);
      for (const field of node.children) {
        const [name, value, ...rest] = field.tokens;
        if (name === undefined || (name.startsWith("-") && value === undefined)) continue;
        if (value === undefined || rest.length > 0 || name.startsWith("-") || name.startsWith("+") || name.startsWith("?")) throw unknown(field);
        always[name] = value;
      }
      continue;
    }
    const [, first, second, third, ...rest] = node.tokens;
    if (first?.startsWith("@")) {
      const matcher = matchers.get(first);
      if (!matcher || second === undefined || third === undefined || rest.length > 0) throw unknown(node);
      conditional.push({ matcher, name: second, value: third });
    } else if (first !== undefined && !(first.startsWith("-") && second === undefined)) {
      if (second === undefined || third !== undefined) throw unknown(node);
      always[first] = second;
    }
  }
  return (pathname, isFile) => {
    const headers = { ...always };
    for (const { matcher, name, value } of conditional) if (matcherTakes(matcher, pathname, isFile)) headers[name] = value;
    return headers;
  };
}

/**
 * The headers the app's site sends with a page or a file: those of the handle the path reaches (the post's page handle
 * for /post/*, the files' handle for everything else that is not the API). `isFile` says whether the path names a file of
 * the export, for a matcher with `file`.
 */
export function appSiteHeadersFromCaddyfile(tree: CaddyNode[] = readCaddyfile()): (pathname: string, isFile: boolean) => Record<string, string> {
  const block = appSite(tree);
  const statics = handles(block).filter((h) => h.matcher === null);
  if (statics.length !== 1) throw new Error(`the app site needs exactly one handle without a matcher, the files; it has ${statics.length}`);
  const files = headersOf(statics[0]!.block);
  const posts = headersOf(routeFor(block, "/post/x").block);
  return (pathname, isFile) => (appRoute(block, pathname).kind === "post" ? posts(pathname, isFile) : files(pathname, isFile));
}
```

### Create `apps/app/test/browser/fixture-api.ts`

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthorCasesPage,
  AuthorNoticesPage,
  DecisionView,
  ExplorePage,
  ExploreStatus,
  MeResponse,
  NoticeStatus,
  PasskeyListResponse,
  PasskeyOptionsResponse,
  PostPage,
  ProfilePage,
  ProfileView,
  PublicFacts,
  PublicHead,
  PublicTransparency,
  ReleaseNoticeView,
  ReportsPage,
  SessionsResponse,
  ThreadResponse,
  TimelinePage,
  UploadRefusalView,
  type Author,
  type MediaView,
  type PostView,
  type ProfileListItem,
  type TimelineItem,
} from "@korbat/contracts";
import type { z } from "zod";

/**
 * The API answers the app's browser check needs (UI design, section 12.3): /api/me signed in and out (a 401), the three
 * timelines with cursors, a post with its thread and its status for the post page's handle, profiles with their tabs and
 * lists, bookmarks, the public facts, the settings and cases screens' reads, a report's status, and one 2 by 2 WebP for
 * every image. Every answer is checked against @korbat/contracts' schema when it is built, so the app parses exactly
 * what the API would send. A request no fixture answers is a problem of the walk, answered 404, and so is a request
 * that changes something: this walk only reads. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false };

/** The post the walk opens (by Grace), and a post id the API does not know, whose page answers 404. */
export const POST_ID = id(101);
export const MISSING_POST_ID = id(999);
/** A decision, a release and a refused upload of Ada's, for the cases screens. */
export const DECISION_ID = id(501);
export const RELEASE_ID = id(502);
export const UPLOAD_ID = id(503);
/** A report's status page: its reference and the token its link carries in the fragment. */
export const NOTICE_REF = "N-ABCDEFGH23";
export const NOTICE_TOKEN = "A".repeat(43);

/** The fixtures' own clock: every time is this many minutes before the walk started, so "3m" stays "3m". */
const START = Date.now();
const ago = (minutes: number) => new Date(START - minutes * 60_000).toISOString();
const daysAhead = (days: number) => new Date(START + days * 86_400_000).toISOString();

const BODIES = [
  "Morning light over the harbour. The ferries are running late again, and nobody seems to mind.",
  "Finished the first draft of the essay on Babbage's engines. It is long, and it needs a walk before it needs an edit.",
  "Reminder that the library's reading room opens at nine on Saturdays now.",
  "Small thing that made my day: the baker remembered my order.",
  "Notes from the meetup: three talks on compilers, one on gardening, all of them about patience.",
  "If you are near the old market today, the second-hand book stall has a box of maps from the sixties.",
  "Tried the new route home along the canal. Two herons, one very confident duck.",
  "Rain all afternoon, so I sorted the photo archive by year instead of by mood.",
];

/** One image, sized as 2b serves it: a 4 by 3 frame whose two sizes are the fixture WebP. */
function image(n: number): MediaView {
  const media = id(700 + n);
  return { id: media, width: 1200, height: 900, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", alt: `A photograph, number ${n}, of the harbour at dawn`, small: `/api/media/${media}/small.webp`, large: `/api/media/${media}/large.webp` };
}

const AUTHORS = [GRACE, LINUS, ADA];

/** Post number `n`: its author goes round the three accounts; every fourth carries an image; newer posts have lower numbers. */
function post(n: number, signedIn: boolean, extra: Partial<PostView> = {}): PostView {
  const view: PostView = {
    id: id(100 + n),
    author: AUTHORS[(n - 1) % AUTHORS.length]!,
    body: BODIES[(n - 1) % BODIES.length]!,
    createdAt: ago(n * 7),
    state: "visible",
    replyTo: null,
    counts: { likes: (n * 3) % 17, reposts: n % 4, replies: n % 3, quotes: n % 2 },
    media: n % 4 === 0 ? [image(n)] : [],
    quoteOf: null,
    ...extra,
  };
  if (signedIn) view.viewer = { liked: n % 5 === 0, reposted: false, bookmarked: false };
  return view;
}

function parse<S extends z.ZodType>(schema: S, value: z.input<S>, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`the fixture ${what} does not match its schema: ${result.error.message}`);
  return result.data;
}

/** A page of a timeline: posts `from` to `to`, a repost of Grace's by Linus among them, and the next page's cursor. */
function timeline(from: number, to: number, signedIn: boolean, nextCursor: string | null) {
  const items: TimelineItem[] = [];
  for (let n = from; n <= to; n++) {
    if (n === from + 2) items.push({ kind: "repost", post: post(n + 40, signedIn, { author: GRACE }), repostedBy: LINUS, repostedAt: ago(n * 7 - 1) });
    items.push({ kind: "post", post: post(n, signedIn) });
  }
  return parse(TimelinePage, { items, nextCursor }, "timeline");
}

const listItem = (author: Author, bio: string, signedIn: boolean): ProfileListItem => ({ ...author, bio, ...(signedIn ? { viewerFollows: author.handle === "grace" } : {}) });

function profile(author: Author, signedIn: boolean) {
  const self = signedIn && author.id === ADA.id;
  return parse(
    ProfileView,
    {
      id: author.id,
      handle: author.handle,
      displayName: author.displayName,
      bio: author.handle === "ada" ? "Writing about engines, looms and the people who built them." : "Compilers, ships and the occasional heron.",
      verified: author.verified,
      createdAt: ago(60 * 24 * 90),
      counts: { posts: 42, followers: 128, following: 64 },
      ...(signedIn && !self ? { viewer: { following: author.handle === "grace", followedBy: false, blocked: false, muted: false } } : {}),
    },
    "profile",
  );
}

function me() {
  return parse(
    MeResponse,
    {
      user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 1 },
      profile: { id: ADA.id, handle: ADA.handle, displayName: ADA.displayName, handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    },
    "me",
  );
}

const FACTS = parse(
  PublicFacts,
  {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: false, test: false },
    witness: { on: false, test: false },
    recipientsSignedOut: false,
    keeper: false,
  },
  "facts",
);

function decision() {
  return parse(
    DecisionView,
    {
      id: DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R3",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers breaks rule R3.",
      source: "own_initiative",
      decidedAt: ago(60 * 24 * 3),
      post: null,
      measures: [],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(10),
      reversedOn: null,
      content: { kind: "account", handle: "ada", displayName: "Ada Lovelace", bio: "" },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "decision",
  );
}

export interface FixtureState {
  /** Whether /api/me answers the account or 401. */
  signedIn: boolean;
  /** Everything the page asked that no fixture answers, or that the walk should never cause. */
  problems: string[];
  /** Every API request, in order: method, path and query, and when it arrived (ms since the walk's clock started). */
  requests: { method: string; path: string; at: number }[];
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [] };
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok(me()) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") {
      // Two pages: twenty posts and a cursor, then ten and none.
      return ok(cursor === null ? timeline(1, 20, state.signedIn, "page-2") : timeline(21, 30, state.signedIn, null));
    }
    if (path === "/api/timeline/explore") {
      const items = posts(1, 10).map((view) => ({ kind: "post" as const, post: view }));
      return ok(parse(ExplorePage, { items, nextCursor: null, computedAt: ago(5), signInForMore: !state.signedIn }, "explore"));
    }
    if (path === `/api/posts/${POST_ID}/thread`) {
      const replies = [2, 3, 5].map((n) => post(n, state.signedIn, { id: id(300 + n), replyTo: { id: POST_ID, authorHandle: GRACE.handle } }));
      return ok(parse(ThreadResponse, { ancestors: [], post: post(1, state.signedIn), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // Ada's own post (number 3) shows its Explore status line to her.
    if (path === `/api/posts/${id(103)}/explore`) return ok(parse(ExploreStatus, { status: "listed", computedAt: ago(5) }, "explore status"));
    const profilePath = /^\/api\/profiles\/([a-z0-9_]+)(?:\/(posts|replies|followers|following))?$/.exec(path);
    if (profilePath) {
      const author = AUTHORS.find((a) => a.handle === profilePath[1]);
      if (!author) return null;
      const tab = profilePath[2];
      if (tab === undefined) return ok(profile(author, state.signedIn));
      if (tab === "posts") return ok(parse(TimelinePage, { items: posts(1, 12).map((view) => ({ kind: "post" as const, post: { ...view, author } })), nextCursor: null }, "profile posts"));
      if (tab === "replies") return ok(parse(PostPage, { items: [], nextCursor: null }, "replies"));
      const people = [listItem(GRACE, "Compilers, ships and the occasional heron.", state.signedIn), listItem(LINUS, "Kernels and coffee.", state.signedIn)].filter((p) => p.handle !== author.handle);
      return ok(parse(ProfilePage, { items: people, nextCursor: null }, "profile list"));
    }
    if (path === "/api/me/bookmarks") return ok(parse(PostPage, { items: posts(1, 20).map((view) => ({ ...view, viewer: { liked: false, reposted: false, bookmarked: true } })), nextCursor: null }, "bookmarks"));
    if (path === "/api/me/likes") return ok(parse(PostPage, { items: posts(5, 8), nextCursor: null }, "likes"));
    if (path === "/api/me/blocks" || path === "/api/me/mutes") return ok(parse(ProfilePage, { items: [], nextCursor: null }, "blocks"));
    const media = /^\/api\/media\/[0-9a-f-]{36}\/(small|large)\.webp$/.exec(path);
    if (media) return { status: 200, raw: FIXTURE_WEBP, type: "image/webp" };
    if (path === "/api/public/facts") return ok(FACTS);
    if (path === "/api/public/transparency") return ok(parse(PublicTransparency, { editions: [] }, "transparency"));
    if (path === "/api/public/head") return ok(parse(PublicHead, { days: [] }, "head"));
    if (path === "/api/auth/sessions") {
      return ok(parse(SessionsResponse, { sessions: [{ id: id(601), deviceLabel: "Chromium on Windows", platform: "web", createdAt: ago(600), lastUsedAt: ago(1), current: true }] }, "sessions"));
    }
    if (path === "/api/auth/passkeys") {
      return ok(parse(PasskeyListResponse, { passkeys: [{ id: id(602), name: "Laptop", createdAt: ago(60 * 24 * 20), lastUsedAt: ago(30), synced: false, createdOn: "Chromium on Windows", current: true, isNew: false, suspended: false }] }, "passkeys"));
    }
    if (path === "/api/moderation/cases") return ok(parse(AuthorCasesPage, { decisions: [], nextCursor: null, activeStrikes: 0 }, "cases"));
    if (path === "/api/moderation/reports") return ok(parse(ReportsPage, { reports: [], nextCursor: null, reportMailStopped: false }, "reports"));
    if (path === "/api/moderation/notices") return ok(parse(AuthorNoticesPage, { notices: [], nextCursor: null }, "notices"));
    if (path === `/api/moderation/decisions/${DECISION_ID}`) return ok(decision());
    if (path === `/api/moderation/releases/${RELEASE_ID}`) {
      return ok(parse(ReleaseNoticeView, { id: RELEASE_ID, basis: "period", releasedAt: ago(60), backupsClearAt: daysAhead(35), upload: false, posts: [{ id: id(103), createdAt: ago(60 * 24 * 40) }], postCount: 1, images: 1, sealDecisionId: null, appeal: "none" }, "release"));
    }
    if (path === `/api/moderation/uploads/${UPLOAD_ID}`) {
      return ok(parse(UploadRefusalView, { id: UPLOAD_ID, refusedAt: ago(120), source: "a hash list", matchKind: "exact", listedAs: "csam", objection: null, mayObject: true, endedAt: null, endAs: null, endReason: null, released: null, reportKept: false }, "upload"));
    }
    return null;
  }

  /** The answer to one POST the walk causes by reading: a report's status, and the passkey autofill's options on sign-in. */
  function post_(path: string, body: Buffer): Answer | null {
    if (path === "/api/notices/status") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { ref?: string; token?: string };
      if (asked.ref !== NOTICE_REF || asked.token !== NOTICE_TOKEN) return null;
      return ok(parse(NoticeStatus, { ref: NOTICE_REF, receivedAt: ago(60 * 24 * 2), items: [], contact: null }, "notice status"));
    }
    if (path === "/api/auth/passkey/signin/options") return ok(parse(PasskeyOptionsResponse, { options: { challenge: "Y2hhbGxlbmdlLW9mLXRoZS13YWxr", rpId: "localhost", userVerification: "required", allowCredentials: [], timeout: 300000 } }, "passkey options"));
    return null;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) ? 204 : 404),
    async handle(req, res, url, body) {
      const method = req.method ?? "GET";
      state.requests.push({ method, path: `${url.pathname}${url.search}`, at: Date.now() });
      let answer: Answer | null = null;
      try {
        answer = method === "GET" ? get(url.pathname, url.searchParams) : method === "POST" ? post_(url.pathname, body) : null;
      } catch (err) {
        state.problems.push(`a fixture threw for ${method} ${url.pathname}: ${String(err)}`);
      }
      if (answer === null) {
        state.problems.push(`an unanswered request: ${method} ${url.pathname}${url.search}`);
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: { code: "not_found", message: "No such route" } }));
        return;
      }
      if (answer.raw) {
        res.writeHead(answer.status, { "content-type": answer.type ?? "application/octet-stream", "content-length": answer.raw.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).end(answer.raw);
        return;
      }
      // The API's own date header: Explore ages its ranking by it.
      res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store", date: new Date().toUTCString() }).end(JSON.stringify(answer.json));
    },
  };
}
```

### Create `apps/app/test/browser/server.ts`

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { appRoute, appSite, appSiteHeadersFromCaddyfile } from "./caddyfile";

/**
 * Caddy's app site as the browser check needs it (UI design, section 12.3), in a small Node server that takes its routes
 * and headers from infra/caddy/Caddyfile: a path the site proxies to the API goes to the fixture API; a post's page is
 * the export's index.html under the status the fixture API gives the post (204 gives 200, 404 gives 404, anything else
 * 200), as Caddy's /post/* handle asks GET /api/posts/<id>/status; everything else is a file of the export, with
 * index.html for a path that names none (try_files), sent with the headers the site sets for the path asked for. With
 * `holdBundle` the entry bundle is answered two seconds late, so the walk can look at the first paint, which only
 * theme-boot.js has drawn. The page is opened at http://localhost:<port>, never 127.0.0.1: browsers refuse WebAuthn on an
 * address.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** The largest JSON body the app site lets through to the API (request_body max_size 64KB; Caddy's KB is 1000 bytes). */
const BODY_LIMIT = 64 * 1000;

/** How long the entry bundle waits when it is held back. */
export const HOLD_MS = 2000;

/** Hands one API request to the fixtures, with its body read. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer) => Promise<void>;

/** What the fixture API says of a post's status, as GET /api/posts/<id>/status would: 204 shown, 404 not. */
export type PostStatus = (id: string) => number;

export interface AppSiteServer {
  origin: string;
  /** Holds the entry bundle back two seconds while true. */
  state: { holdBundle: boolean };
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The file a path names inside `dist`, or null: decoded once, and never outside the folder. */
async function fileFor(dist: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(dist, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

export async function startAppSite(options: { dist: string; api: ApiHandler; postStatus: PostStatus }): Promise<AppSiteServer> {
  const dist = path.resolve(options.dist);
  const block = appSite();
  const headersFor = appSiteHeadersFromCaddyfile();
  const state = { holdBundle: false };

  async function sendFile(req: IncomingMessage, res: ServerResponse, url: URL, file: string, named: boolean, status = 200): Promise<void> {
    const info = await stat(file);
    if (state.holdBundle && url.pathname.startsWith("/_expo/static/js/")) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    res.writeHead(status, { ...headersFor(url.pathname, named), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = appRoute(block, url.pathname);
      if (route.kind === "api") {
        const body = await readBody(req);
        if (body === null) {
          res.writeHead(413).end();
          return;
        }
        await options.api(req, res, url, body);
        return;
      }
      if (route.kind === "own") {
        res.writeHead(route.status, route.headers).end(route.body);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (route.kind === "post") {
        // The second segment of the path, as Caddy's {http.request.uri.path.1} gives it.
        const id = url.pathname.split("/")[2] ?? "";
        const status = options.postStatus(id);
        await sendFile(req, res, url, path.join(dist, "index.html"), false, status === 404 ? 404 : 200);
        return;
      }
      const named = await fileFor(dist, url.pathname);
      await sendFile(req, res, url, named ?? path.join(dist, "index.html"), named !== null);
    })().catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
```

### Create `apps/app/test/browser/watch.ts`

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

### Create `apps/app/test/shell.test.tsx`

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
      expect(anchors(nav).map(hrefOf), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      const current = anchors(nav).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, kind).toHaveLength(1);
      expect(current[0], kind).toContain('href="/bookmarks"');
      // The current item's icon is drawn at the strong stroke, a shape cue beside its colour; the others at the usual one.
      // (Its pill and bar are classes, which a static render does not draw: the browser check measures them.)
      const items = nav.split(/(?=<a\b)/).slice(1);
      expect(items.filter((item) => item.includes('stroke-width="2.25"')).map((item) => hrefOf(item)), kind).toEqual(["/bookmarks"]);
      expect(items.filter((item) => item.includes('stroke-width="1.75"')).map((item) => hrefOf(item)), kind).toEqual(["/", "/u/ada", "/settings/security"]);
      expect(textOf(nav), kind).toContain(UI_WORDS["nav.bookmarks"]);
    }
  });

  test("signed out the nav holds Home and Sign in; while the session loads it holds Home alone, so Sign in never flashes", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = { status: "signed-out" };
      expect(anchors(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).map(hrefOf), kind).toEqual(["/", "/signin"]);
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
    expect(current(html(<AppShell>{null}</AppShell>))).toEqual(["/settings/security"]);
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
      expect(title, key).toMatch(/ - korbat$/);
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
    const list = read("components", "social", "PagedList.tsx");
    expect(list).toContain("onScroll={scroll.onScroll}");
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

### Create `apps/app/vitest.browser.config.mts`

```text
import { defineConfig } from "vitest/config";

/**
 * The app's browser check (`pnpm --filter @korbat/app test:browser`, UI design, section 12.3, decision 20): one walk
 * through the app's screens in Chromium, driven by playwright-core, against the app's own web export served as Caddy
 * serves it and a fixture API in the same Node process. It is kept apart from the unit tests because it builds the export
 * and starts a browser; its steps share one browser and run in order. It needs no stack and no internet, and it never
 * downloads a browser. Times are shown in UTC, as the walk's browser context sets them.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/browser/**/*.browser.ts"],
    env: { TZ: "UTC" },
    testTimeout: 120_000,
    // The export runs once per walk, before the first step, and takes a few minutes on a busy machine.
    hookTimeout: 600_000,
  },
});
```

### Replace `apps/app/test/announced.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { REPLY_TEXT_MAX, RETENTION, STANDING_RULES, type AccountStanding, type DecisionView } from "@korbat/contracts";
import { ReplyPanel, replyOpening } from "../src/app/settings/cases/[id]/reply";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { StandingBanner } from "../src/components/StandingBanner";
import { apiResponse, messageFor } from "../src/lib/api";
import { bannerSentences, nowSentence, STANDING_TEXTS, standingDay, standingTime } from "../src/lib/standing";

/**
 * The app's part of announced suspensions, replies and termination (3e design, sections 9.1 to 9.3 and 9.8; Task 4): the
 * banner in every state of a suspension and of a termination, with "Reply"; the decision's block "Where it stands now",
 * what the measure rests on, the reply and the appeal's sentences; the reply screen; and [terminate.delete]. Components
 * are server-rendered with made-up answers; what a static render cannot show (the requests) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: () => createElement("img") };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split(" ")
    .filter((part) => part !== "")
    .join(" ");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const EARLIEST = "2026-10-15T10:00:00.000Z";
const STARTS = "2026-10-16T10:00:00.000Z";
const ENDS = "2026-10-19T10:00:00.000Z";
const APPEAL = "2027-04-12T10:00:00.000Z";
const FILED = "2026-10-13T08:00:00.000Z";

const measure = (more: Partial<NonNullable<AccountStanding["measure"]>> = {}): AccountStanding => ({
  activeStrikes: 3,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 3,
    state: "unfixed",
    earliestStart: EARLIEST,
    startsAt: null,
    endsAt: null,
    reply: null,
    replyOpen: true,
    appealUntil: APPEAL,
    appealPending: false,
    ...more,
  },
  reporting: null,
  handleRetired: false,
});

/** An announced suspension's decision as its author reads it, with where it stands now. */
const decision = (standing: Partial<NonNullable<DecisionView["standing"]>> = {}, extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(9),
  kind: "final",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R1",
  rulesVersion: 3,
  redressVersion: 2,
  legalReference: null,
  facts: "When this was written the account had 3 active strikes.",
  reason: "Three strikes in two weeks.",
  source: "own_initiative",
  decidedAt: "2026-10-12T10:00:00.000Z",
  post: null,
  measures: [{ kind: "suspend", mediaId: null, noEffect: null, sealed: null, announced: true, days: 3, basis: "strikes", earliestStart: EARLIEST }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  appealUntil: APPEAL,
  reversedOn: null,
  content: { kind: "account", handle: "someone", displayName: "Someone", bio: "" },
  appeal: null,
  strike: null,
  standing: {
    state: "unfixed",
    earliestStart: EARLIEST,
    startsAt: null,
    endsAt: null,
    endedAt: null,
    endedBy: null,
    replaced: false,
    restsOn: [
      { decisionId: id(1), ruleId: "R3", decidedAt: "2026-09-20T09:00:00.000Z", countsUntil: "2026-12-19T09:00:00.000Z", state: "counts", overruledAt: null },
      { decisionId: id(2), ruleId: "R1", decidedAt: "2026-09-27T09:00:00.000Z", countsUntil: "2026-12-26T09:00:00.000Z", state: "overruled", overruledAt: "2026-10-01T09:00:00.000Z" },
    ],
    reply: null,
    replyOpen: true,
    ...standing,
  },
  ...extra,
});
const termination = (standing: Partial<NonNullable<DecisionView["standing"]>> = {}, extra: Partial<DecisionView> = {}): DecisionView =>
  decision(standing, { measures: [{ kind: "terminate", mediaId: null, noEffect: null, sealed: null, announced: true, days: null, basis: "ladder_end", earliestStart: EARLIEST }], ...extra });

describe("3e Task 4: the words (design, sections 9.1 to 9.3 and 9.8)", () => {
  test("the banner's sentences are the design's, with the mail's days from RETENTION and every time as standingTime prints it", () => {
    expect(STANDING_TEXTS.banner.unfixed("suspend", 3, EARLIEST)).toBe(
      `korbat has decided to suspend your account for 3 days. Nothing is restricted yet. It will not start before ${standingTime(EARLIEST)}; the exact time appears here within ${RETENTION.mailGiveUpDays} days, once korbat knows whether its email to you could be sent.`,
    );
    expect(STANDING_TEXTS.banner.unfixed("terminate", null, EARLIEST)).toContain("korbat has decided to terminate your account. Nothing is restricted yet.");
    expect(STANDING_TEXTS.banner.announced("suspend", 3, STARTS)).toBe(
      `korbat will suspend your account for 3 days from ${standingTime(STARTS)}. Nothing is restricted until then. If you reply before it starts, it waits for korbat's answer.`,
    );
    expect(STANDING_TEXTS.banner.held("suspend", FILED, EARLIEST)).toBe(
      `You replied on ${standingDay(FILED)}. The suspension does not start while your reply is unanswered. korbat answers you here and by email. If korbat keeps its decision, the suspension starts with that answer, and never before ${standingTime(EARLIEST)}.`,
    );
    expect(STANDING_TEXTS.banner.held("terminate", FILED, EARLIEST)).toContain("The termination does not start while your reply is unanswered.");
    expect(STANDING_TEXTS.banner.terminated(APPEAL)).toBe(
      `korbat has terminated your account. You cannot post or interact; your posts stay visible for now. korbat deletes the account once the decision is final: on ${standingTime(APPEAL)} if you do not appeal, or when your appeal is answered and the decision kept. Until then you can reply, appeal, export your data, or delete the account yourself.`,
    );
    expect(STANDING_TEXTS.banner.terminated(APPEAL).startsWith(STANDING_TEXTS.banner.terminatedFirst)).toBe(true);
    expect(STANDING_TEXTS.banner.appealed).toBe("Your appeal is waiting for a reviewer. Nothing is deleted before it is answered.");
    expect(STANDING_TEXTS.banner.replied).toBe("Your reply is waiting for an answer. Nothing is deleted before it is answered.");
  });

  test("the reply screen's, the decision's and the appeal's sentences, each number from the contracts", () => {
    expect(STANDING_TEXTS.reply.title).toBe("Reply to korbat");
    expect(STANDING_TEXTS.reply.before("suspend", STARTS)).toBe(
      `korbat has decided to suspend your account from ${standingTime(STARTS)}. If you reply before then, the suspension does not start until a moderator has read your reply and answered you. The answer reverses the suspension, or keeps it; a kept suspension starts with the answer, and never before ${standingTime(STARTS)}, so replying early costs you nothing.`,
    );
    expect(STANDING_TEXTS.reply.unfixed("suspend", EARLIEST)).toContain(`suspend your account not before ${standingTime(EARLIEST)}. If you reply before it starts,`);
    expect(STANDING_TEXTS.reply.running("suspend", ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}. A moderator reads your reply and answers you, and can end the suspension at once. The suspension goes on meanwhile.`,
    );
    expect(STANDING_TEXTS.reply.running("terminate", null)).toBe(
      "Your account is terminated. A moderator reads your reply and answers you, and can end the termination at once. Nothing is deleted before your reply is answered.",
    );
    expect(STANDING_TEXTS.reply.count(12)).toBe(`12 of ${REPLY_TEXT_MAX} characters`);
    expect(STANDING_TEXTS.reply.sentOnTime("suspend", FILED)).toBe(`korbat received your reply on ${standingTime(FILED)}, before the start. The suspension is held until korbat answers.`);
    expect(STANDING_TEXTS.reply.sentLate("terminate", FILED)).toBe(`korbat received your reply on ${standingTime(FILED)}. The termination stays until korbat answers, and nothing is deleted before that.`);
    expect(STANDING_TEXTS.rests.hint).toBe(`Each strike is appealed on its own decision's screen. If one is overruled and fewer than ${STANDING_RULES.ladderStrikes} of these still stand, this suspension ends at once.`);
    expect(STANDING_TEXTS.terminateDelete).toBe("If you delete your account now, your appeal ends with it: nothing is left to restore.");
    expect(messageFor("reply_not_open")).toBe("You cannot reply to this decision: you already replied, or it has ended or was lifted.");
  });
});

describe("3e Task 4: the banner in every state (design, section 9.1)", () => {
  test("a suspension not started: unfixed, announced and held, in amber, with Reply while no reply was sent", () => {
    expect(bannerSentences(measure())).toEqual([STANDING_TEXTS.banner.unfixed("suspend", 3, EARLIEST)]);
    expect(bannerSentences(measure({ state: "announced", startsAt: STARTS, endsAt: ENDS }))).toEqual([STANDING_TEXTS.banner.announced("suspend", 3, STARTS)]);
    const held = measure({ state: "held", reply: { filedAt: FILED, onTime: true, answeredAt: null }, replyOpen: false });
    expect(bannerSentences(held)).toEqual([STANDING_TEXTS.banner.held("suspend", FILED, EARLIEST)]);
    const out = html(<StandingBanner standing={measure()} />);
    expect(out).toContain('aria-level="2"');
    expect(out).toContain(`href="/settings/cases/${id(9)}/reply"`);
    expect(textOf(out)).toContain(` ${STANDING_TEXTS.banner.reply} `);
    // Once replied, no Reply; the running suspension is red.
    expect(html(<StandingBanner standing={held} />)).not.toContain("/reply");
    // The review wash before the start, the restricted wash while it runs (UI design, 4.8): the colour repeats the words and the icon.
    expect(read("components", "StandingBanner.tsx")).toContain('measure.state === "running" ? "border-restricted-ink/40 bg-restricted-wash" : "border-review-ink/40 bg-review-wash"');
  });

  test("a termination: announced in the suspension's words with terminate your account; running with its deletion, its appeal pending, and its reply unanswered", () => {
    const terminate = { kind: "terminate" as const, days: null };
    expect(bannerSentences(measure({ ...terminate }))).toEqual([STANDING_TEXTS.banner.unfixed("terminate", null, EARLIEST)]);
    expect(bannerSentences(measure({ ...terminate, state: "running", startsAt: STARTS }))).toEqual([STANDING_TEXTS.banner.terminated(APPEAL)]);
    expect(bannerSentences(measure({ ...terminate, state: "running", startsAt: STARTS, appealPending: true }))).toEqual([STANDING_TEXTS.banner.terminatedFirst, STANDING_TEXTS.banner.appealed]);
    const replied = measure({ ...terminate, state: "running", startsAt: STARTS, appealPending: true, reply: { filedAt: FILED, onTime: false, answeredAt: null }, replyOpen: false });
    expect(bannerSentences(replied)).toEqual([STANDING_TEXTS.banner.terminatedFirst, STANDING_TEXTS.banner.appealed, STANDING_TEXTS.banner.replied]);
    const out = textOf(html(<StandingBanner standing={replied} />));
    expect(out).toContain(STANDING_TEXTS.banner.replied);
    // The appeal is pending: no Appeal button, and no Reply once replied.
    expect(out).not.toContain(` ${STANDING_TEXTS.banner.appeal} `);
    expect(out).not.toContain(` ${STANDING_TEXTS.banner.reply} `);
  });
});

describe("3e Task 4: the decision's screen (design, section 9.2)", () => {
  test("Where it stands now: one sentence for each state, read fresh", () => {
    const at = (state: NonNullable<DecisionView["standing"]>["state"], more: Partial<NonNullable<DecisionView["standing"]>> = {}) => ({ ...decision().standing!, state, ...more });
    expect(nowSentence(at("unfixed"), "suspend", false)).toBe(`Start: not fixed yet, and not before ${standingTime(EARLIEST)}.`);
    expect(nowSentence(at("announced", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Starts on ${standingTime(STARTS)}. Ends on ${standingTime(ENDS)}.`);
    expect(nowSentence(at("held", { reply: { filedAt: FILED, onTime: true, text: null, erasedAt: null, answeredAt: null, answeredBy: null } }), "suspend", false)).toBe(
      `Held by your reply of ${standingDay(FILED)}: it has not started.`,
    );
    expect(nowSentence(at("running", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Started on ${standingTime(STARTS)}. Ends on ${standingTime(ENDS)}.`);
    expect(nowSentence(at("ended", { startsAt: STARTS, endsAt: ENDS }), "suspend", false)).toBe(`Ran from ${standingTime(STARTS)} to ${standingTime(ENDS)}.`);
    const lifted = "2026-10-14T09:00:00.000Z";
    expect(nowSentence(at("never", { endedAt: lifted, endedBy: id(5) }), "suspend", false)).toBe(`Never started: korbat reversed it on ${standingDay(lifted)}.`);
    expect(nowSentence(at("never", { endedAt: lifted, endedBy: id(5), replaced: true }), "suspend", false)).toBe(
      `Never started: korbat withdrew it on ${standingDay(lifted)} because it took another measure on your account.`,
    );
    expect(nowSentence(at("lifted", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-17T09:00:00.000Z" }), "suspend", false)).toBe(`Lifted on ${standingDay("2026-10-17T09:00:00.000Z")}.`);
    expect(nowSentence(at("lifted", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-25T09:00:00.000Z" }), "suspend", false)).toContain("it no longer counts toward a later suspension.");
    // 3e's review (people5): the API sends the period's end cut to the lift or to the basis's break (decisionStanding reads
    // suspension_periods), so a measure lifted, or whose basis broke, while it ran has its end at that moment.
    const cut = "2026-10-17T09:00:00.000Z";
    expect(nowSentence(at("lifted", { startsAt: STARTS, endsAt: cut, endedAt: cut }), "suspend", false)).toBe(`Lifted on ${standingDay(cut)}.`);
    expect(nowSentence(at("basis_ended", { startsAt: STARTS, endsAt: cut, endedAt: cut }), "suspend", true)).toBe(`Ended on ${standingDay(cut)}, because korbat lifted the seal it rested on.`);
    expect(nowSentence(at("basis_ended", { endedAt: lifted }), "suspend", false)).toBe(`It will not start: korbat reversed a decision it rested on, on ${standingDay(lifted)}.`);
    expect(nowSentence(at("basis_ended", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-17T09:00:00.000Z" }), "suspend", true)).toBe(
      `Ended on ${standingDay("2026-10-17T09:00:00.000Z")}, because korbat lifted the seal it rested on.`,
    );
    expect(nowSentence(at("basis_ended", { startsAt: STARTS, endsAt: ENDS, endedAt: "2026-10-25T09:00:00.000Z" }), "suspend", false)).toContain(
      `On ${standingDay("2026-10-25T09:00:00.000Z")} korbat reversed a decision it rested on, so it no longer counts toward a later suspension.`,
    );
    expect(nowSentence(at("running", { startsAt: STARTS }), "terminate", false, APPEAL)).toBe(
      `Started on ${standingTime(STARTS)}. It has no end date. The account is deleted once this decision is final: on ${standingTime(APPEAL)} if you do not appeal. Nothing is deleted while your appeal or your reply is unanswered.`,
    );
  });

  test("the block under the statement: the sentence, the strikes it rests on as links with [rests.hint], Reply, and [appeal.early] above the appeal", () => {
    const out = html(<DecisionDetail view={decision()} />);
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.now.title);
    expect(text).toContain(STANDING_TEXTS.now.unfixed(EARLIEST));
    expect(text).toContain(`Strike of ${standingDay("2026-09-20T09:00:00.000Z")} under R3: counts until ${standingTime("2026-12-19T09:00:00.000Z")}`);
    expect(text).toContain(`Strike of ${standingDay("2026-09-27T09:00:00.000Z")} under R1: overruled on ${standingDay("2026-10-01T09:00:00.000Z")}`);
    expect(out).toContain(`href="/settings/cases/${id(1)}"`);
    expect(out).toContain(`href="/settings/cases/${id(2)}"`);
    expect(text).toContain(STANDING_TEXTS.rests.hint);
    expect(out).toContain(`href="/settings/cases/${id(9)}/reply"`);
    expect(text).toContain(STANDING_TEXTS.appeal.early);
    expect(text.indexOf(STANDING_TEXTS.now.title)).toBeLessThan(text.indexOf(STANDING_TEXTS.appeal.early));
    // A decision without a suspension or a termination has no block.
    expect(textOf(html(<DecisionDetail view={decision({}, { standing: null })} />))).not.toContain(STANDING_TEXTS.now.title);
  });

  test("the reply: its text while kept, or that it was erased; not answered, answered with a link, closed by a withdrawal or by a broken basis; and [appeal.again] after a kept answer", () => {
    const reply = { filedAt: FILED, onTime: true, text: "I quoted a film.", erasedAt: null, answeredAt: null, answeredBy: null };
    const waiting = textOf(html(<DecisionDetail view={decision({ state: "held", reply, replyOpen: false })} />));
    expect(waiting).toContain(`${STANDING_TEXTS.reply.replied(FILED)} I quoted a film. ${STANDING_TEXTS.reply.waiting}`);
    expect(waiting).not.toContain(` ${STANDING_TEXTS.reply.button} `);
    const answeredAt = "2026-10-14T09:00:00.000Z";
    const kept = html(<DecisionDetail view={decision({ state: "announced", startsAt: "2026-10-15T10:00:00.000Z", endsAt: ENDS, reply: { ...reply, answeredAt, answeredBy: id(6) }, replyOpen: false })} />);
    expect(textOf(kept)).toContain(STANDING_TEXTS.reply.answered(answeredAt));
    expect(kept).toContain(`href="/settings/cases/${id(6)}"`);
    expect(textOf(kept)).toContain(STANDING_TEXTS.appeal.again(answeredAt, APPEAL));
    const erased = textOf(html(<DecisionDetail view={decision({ state: "ended", startsAt: STARTS, endsAt: ENDS, reply: { ...reply, text: null, erasedAt: "2027-05-01T09:00:00.000Z", answeredAt, answeredBy: id(6) }, replyOpen: false })} />));
    expect(erased).toContain(STANDING_TEXTS.reply.erased("2027-05-01T09:00:00.000Z"));
    expect(erased).not.toContain("I quoted a film.");
    const withdrawn = textOf(html(<DecisionDetail view={decision({ state: "never", endedAt: answeredAt, endedBy: id(7), replaced: true, reply: { ...reply, answeredAt, answeredBy: id(7) }, replyOpen: false })} />));
    expect(withdrawn).toContain(STANDING_TEXTS.reply.closedWithdrawn(answeredAt));
    expect(withdrawn).toContain(STANDING_TEXTS.now.endedBy);
    expect(withdrawn).not.toContain(STANDING_TEXTS.appeal.again(answeredAt, APPEAL));
    const basis = textOf(html(<DecisionDetail view={decision({ state: "basis_ended", endedAt: answeredAt, endedBy: id(8), reply: { ...reply, answeredAt, answeredBy: id(8) }, replyOpen: false })} />));
    expect(basis).toContain(STANDING_TEXTS.reply.closedBasis(answeredAt));
  });

  test("a termination: its sentence with the appeal's last moment, and [terminate.delete] beside its appeal and in Settings, Account", () => {
    const text = textOf(html(<DecisionDetail view={termination({ state: "running", startsAt: STARTS })} />));
    expect(text).toContain(STANDING_TEXTS.now.terminated(STARTS, APPEAL));
    expect(text).toContain(STANDING_TEXTS.terminateDelete);
    expect(textOf(html(<DecisionDetail view={decision({ state: "running", startsAt: STARTS, endsAt: ENDS })} />))).not.toContain(STANDING_TEXTS.terminateDelete);
    const account = read("app", "settings", "account.tsx");
    expect(account).toContain('{me.standing?.measure?.kind === "terminate" ? <Body>{STANDING_TEXTS.terminateDelete}</Body> : null}');
    expect(account.indexOf("STANDING_TEXTS.terminateDelete")).toBeLessThan(account.indexOf("<DeleteSection"));
  });
});

describe("3e Task 4: the reply screen (design, section 9.3)", () => {
  test("its opening follows the decision's standing: before a fixed start, before one not fixed, while it runs; none once the reply is closed", () => {
    expect(replyOpening(decision())).toBe(STANDING_TEXTS.reply.unfixed("suspend", EARLIEST));
    expect(replyOpening(decision({ state: "announced", startsAt: STARTS, endsAt: ENDS }))).toBe(STANDING_TEXTS.reply.before("suspend", STARTS));
    expect(replyOpening(decision({ state: "running", startsAt: STARTS, endsAt: ENDS }))).toBe(STANDING_TEXTS.reply.running("suspend", ENDS));
    expect(replyOpening(termination({ state: "running", startsAt: STARTS }))).toBe(STANDING_TEXTS.reply.running("terminate", null));
    expect(replyOpening(decision({ state: "held", replyOpen: false }))).toBeNull();
    expect(replyOpening(decision({}, { standing: null }))).toBeNull();
  });

  test("the form: the opening, the optional field with its count, the three hints and Send reply; a closed reply says so with the way back", () => {
    const send = async () => ({ filedAt: FILED, onTime: true });
    const out = html(<ReplyPanel view={decision({ state: "announced", startsAt: STARTS, endsAt: ENDS })} onSend={send} />);
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.reply.before("suspend", STARTS));
    expect(out).toContain(`aria-label="${STANDING_TEXTS.reply.field}"`);
    expect(out).toContain(`maxLength="${REPLY_TEXT_MAX}"`);
    expect(text).toContain(STANDING_TEXTS.reply.count(0));
    for (const line of [STANDING_TEXTS.reply.hint, STANDING_TEXTS.reply.once, STANDING_TEXTS.reply.kept]) expect(text).toContain(line);
    expect(text).toContain(STANDING_TEXTS.reply.send);
    const closed = textOf(html(<ReplyPanel view={decision({ state: "held", replyOpen: false })} onSend={send} />));
    expect(closed).toContain(STANDING_TEXTS.reply.closed);
    expect(closed).toContain(STANDING_TEXTS.reply.back);
    expect(closed).not.toContain(STANDING_TEXTS.reply.send);
  });

  test("the screen posts to the reply route through the moderation client, and sits beside the decision's screen", () => {
    expect(read("app", "settings", "cases", "[id]", "reply.tsx")).toContain("moderation.reply(id, statement)");
    expect(read("lib", "moderation.ts")).toContain("/api/moderation/decisions/${encodeURIComponent(id)}/reply`, { json: statementOf(statement), schema: ReplyResponse }");
    const reply = read("app", "settings", "cases", "[id]", "reply.tsx");
    expect(reply).toContain('<SettingsNav current="cases" />');
    expect(reply.indexOf("sentOnTime")).toBeLessThan(reply.indexOf("export default function Reply"));
  });
});

describe("3e's review: the banner after a reply, and the reply's refusal (design, sections 9.1 and 9.8)", () => {
  const ANSWERED = "2026-10-14T08:00:00.000Z";

  test("an announced measure whose reply korbat answered (or that takes none) is not offered a second reply: the banner drops its last sentence, a termination's too", () => {
    const answered = { filedAt: FILED, onTime: true, answeredAt: ANSWERED };
    const kept = measure({ state: "announced", startsAt: STARTS, endsAt: ENDS, reply: answered, replyOpen: false });
    const [sentence] = bannerSentences(kept)!;
    expect(sentence).toBe(`korbat will suspend your account for 3 days from ${standingTime(STARTS)}. Nothing is restricted until then.`);
    expect(sentence).not.toContain("If you reply before it starts");
    const termination = measure({ kind: "terminate", days: null, state: "announced", startsAt: STARTS, reply: answered, replyOpen: false });
    expect(bannerSentences(termination)).toEqual([`korbat will terminate your account from ${standingTime(STARTS)}. Nothing is restricted until then.`]);
    // While a reply is open, the sentence stays.
    expect(bannerSentences(measure({ state: "announced", startsAt: STARTS, endsAt: ENDS }))![0]).toContain("If you reply before it starts, it waits for korbat's answer.");
    expect(textOf(html(<StandingBanner standing={kept} />))).not.toContain("If you reply before it starts");
  });

  test("a reply that is not open is refused in the app's own words, never the server's", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(409, { error: { code: "reply_not_open", message: "server wording" } }));
    await expect(apiResponse(`/api/moderation/decisions/${id(9)}/reply`, { json: {} })).rejects.toMatchObject({ code: "reply_not_open", message: messageFor("reply_not_open") });
    vi.unstubAllGlobals();
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
// UI Task 3: PopularNow.tsx left the shell (UI design, decision 14); its case is on Explore's rows below.
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
// react-native-reanimated is mocked once for every test file in test/setup.ts.

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
    // How Explore works leads back to the Explore tab; Popular now, which did too, left the shell (UI design, decision 14).
    expect(links.map((link) => link.file).sort()).toEqual(["app/explore/about.tsx"]);
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

describe("Explore's rows", () => {
  // UI Task 3: Popular now left the context column (UI design, decision 14), and with it its own line for an image-only
  // post. The case it shared with hidden-media.test.tsx lives on where those posts are listed now: Explore's rows, whose
  // first posts are the ones Popular now listed.
  test("each row is a post card, which names an image-only post by its image's description and skips a hidden image", () => {
    // The row ExploreList draws for every item of a page.
    expect(read("components", "social", "ExploreList.tsx")).toContain("renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}");
    const image = { id: id(90), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: "A green square", small: "/media/x/small.webp", large: "/media/x/large.webp" };
    // An image-only post whose first image is hidden: the shown one names it.
    const out = html(<PostCard post={post(2, { body: "", media: [{ id: id(91), hidden: true }, image] })} />);
    expect(out).toContain('aria-label="Open image: A green square"');
    expect(out.match(/aria-label="Open image:/g)).toHaveLength(1);
    expect(out).not.toContain("undefined");
    // A post of hidden images alone offers no image to open: the placeholder says why in the image's place, and the card's
    // author line and time name the post, as they do every post, so no line of its own is needed.
    const hiddenOnly = html(<PostCard post={post(3, { body: "", media: [{ id: id(92), hidden: true }] })} />);
    expect(hiddenOnly).not.toContain('aria-label="Open image:');
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
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/social/ExploreList.tsx"]);
    const explore = sourceFiles().filter((file) => [...callers.map((caller) => caller.name), "lib/explore.ts", "app/explore/about.tsx"].includes(file.name));
    expect(explore).toHaveLength(4);
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

### Replace `apps/app/test/hidden-media.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { HiddenMedia, MediaView, PostView } from "@korbat/contracts";
// UI Task 3: PopularNow.tsx left the shell (UI design, decision 14); its case is on Explore's rows at the end.
import { HIDDEN_IMAGE, SEALED_IMAGE, hiddenImageWords } from "../src/components/social/HiddenImage";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard } from "../src/components/social/PostCard";

/**
 * The placeholder of a hidden image in the web app (3c design, section 9). A post's media list holds, in an image's
 * place, a hidden image when the reader is not shown it: anyone but the author for an image moderation withheld or
 * removed, and everyone, the author included, for a sealed one. The components are server-rendered, as explore.test.tsx
 * renders its screens; what a static render cannot show (that pressing a placeholder opens nothing) is read from the
 * markup's roles and from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

// expo-router cannot load in Node: Link with `asChild` hands the child its href, and nothing navigates.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
// expo-image reaches native modules; here an image is the address it would load and its description, so a test can see
// exactly which files a render asks for.
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, spaces collapsed. */
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** The address of every image the markup would load. */
const loaded = (markup: string): string[] => [...markup.matchAll(/data-uri="([^"]+)"/g)].map((match) => match[1]!);
/** How often `part` occurs in `whole`. */
const count = (whole: string, part: string): number => whole.split(part).length - 1;
/** The accessible name of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<[a-z]+\b[^>]*\brole="button"[^>]*>/g)].map((match) => /aria-label="([^"]*)"/.exec(match[0])?.[1] ?? "");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = (n: number, alt = `picture ${n}`): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
const sealed = (n: number): HiddenMedia => ({ id: id(n), hidden: true, sealed: true });

function post(n: number, extra: Partial<PostView> = {}): PostView {
  return {
    id: id(n),
    author: { id: id(900), handle: "ada", displayName: "Ada", verified: false },
    body: `post number ${n}`,
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

describe("the words", () => {
  test("a hidden image reads as the design gives it, and the reader's own sealed image says that nobody is shown it", () => {
    expect(HIDDEN_IMAGE).toBe("Image hidden by korbat moderation");
    expect(SEALED_IMAGE).toBe("Sealed: not shown to anyone, you included");
    expect(hiddenImageWords(hidden(1))).toBe(HIDDEN_IMAGE);
    expect(hiddenImageWords(sealed(1))).toBe(SEALED_IMAGE);
  });
});

describe("a post's images", () => {
  test("a hidden image is drawn as the placeholder in its place: nothing is loaded for it and nothing opens it, while the others are shown as before", () => {
    const out = html(<MediaGrid media={[image(1), hidden(2), image(3)]} />);
    expect(textOf(out)).toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/small.webp`), expect.stringContaining(`/api/media/${id(3)}/small.webp`)]);
    expect(out).not.toContain(id(2));
    // Two images open the viewer; the placeholder is no button. The third control shows the descriptions.
    expect(buttons(out)).toEqual(["Open image: picture 1", "Open image: picture 3", "Show image descriptions"]);
  });

  test("the reader's own sealed image is drawn with the sealed words, and not with the others'", () => {
    const out = html(<MediaGrid media={[sealed(1), image(2)]} />);
    expect(textOf(out)).toContain(SEALED_IMAGE);
    expect(textOf(out)).not.toContain(HIDDEN_IMAGE);
    expect(loaded(out)).toHaveLength(1);
    expect(buttons(out)).toEqual(["Open image: picture 2", "Show image descriptions"]);
  });

  test("a post whose every image is hidden shows the placeholders alone: no image, no viewer, no description control", () => {
    for (const media of [[hidden(1)], [sealed(1), sealed(2)], [hidden(1), hidden(2), hidden(3), hidden(4)]]) {
      const out = html(<MediaGrid media={media} />);
      expect(loaded(out)).toEqual([]);
      expect(buttons(out)).toEqual([]);
      expect(textOf(out).split(media[0]!.sealed ? SEALED_IMAGE : HIDDEN_IMAGE).length - 1).toBe(media.length);
    }
    expect(html(<MediaGrid media={[]} />)).toBe("");
  });

  test("a quoted post's row of small squares keeps a square in a hidden image's place and says the sentence once, as text, under the row", () => {
    const out = html(<MediaGrid compact media={[image(1), hidden(2), hidden(3)]} />);
    const text = textOf(out);
    expect(loaded(out)).toHaveLength(1);
    expect(out).not.toContain(id(2));
    expect(buttons(out)).toEqual([]);
    // Each square keeps its short word; the sentence is text, said once however many images are hidden, and it is not
    // repeated anywhere in the markup as a name of each square.
    expect(count(text, "Hidden")).toBe(2);
    expect(count(text, HIDDEN_IMAGE)).toBe(1);
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text).not.toContain(SEALED_IMAGE);
    // It comes after the squares: under the row.
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.lastIndexOf("Hidden"));
  });

  test("the author of a sealed image in a quoted post reads the sealed sentence there, once, and not the other one", () => {
    const out = html(<MediaGrid compact media={[sealed(1), image(2), sealed(3)]} />);
    const text = textOf(out);
    expect(count(text, SEALED_IMAGE)).toBe(1);
    expect(count(out, SEALED_IMAGE)).toBe(1);
    expect(text).not.toContain(HIDDEN_IMAGE);
    expect(count(text, "Hidden")).toBe(2);
    expect(loaded(out)).toHaveLength(1);
  });

  test("a quoted post's row with no hidden image says neither sentence", () => {
    const text = textOf(html(<MediaGrid compact media={[image(1), image(2)]} />));
    for (const words of [HIDDEN_IMAGE, SEALED_IMAGE, "Hidden"]) expect(text).not.toContain(words);
  });

  test("a card renders a post that holds hidden images, on the post and in the post it quotes", () => {
    const quoted = { ...post(2, { media: [hidden(21), image(22)] }), quoteOf: null };
    const out = html(<PostCard post={post(1, { media: [image(11), sealed(12)], quoteOf: quoted })} />);
    const text = textOf(out);
    // The post's own sealed image says so in its place in the frame.
    expect(count(text, SEALED_IMAGE)).toBe(1);
    // The quoted post's hidden image: the sentence once, as text, inside the quote, which comes after the quoted post's
    // own words and before the card's actions.
    expect(count(out, HIDDEN_IMAGE)).toBe(1);
    expect(text.indexOf(HIDDEN_IMAGE)).toBeGreaterThan(text.indexOf("post number 2"));
    expect(text.indexOf(HIDDEN_IMAGE)).toBeLessThan(text.indexOf("Reply"));
    expect(loaded(out)).toHaveLength(2);
  });
});

describe("the viewer", () => {
  const media = [image(1), hidden(2), sealed(3)];
  const noop = () => undefined;

  test("shows an image in its large size with its description and its place among the post's images", () => {
    const out = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />);
    expect(loaded(out)).toEqual([expect.stringContaining(`/api/media/${id(1)}/large.webp`)]);
    expect(textOf(out)).toContain("1 of 3");
    expect(textOf(out)).toContain("picture 1");
  });

  test("never opens a hidden image: stepped onto, it shows the placeholder's words in the image's place and loads nothing", () => {
    const second = html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} />);
    expect(loaded(second)).toEqual([]);
    expect(textOf(second)).toContain("2 of 3");
    expect(textOf(second)).toContain(HIDDEN_IMAGE);
    const third = html(<MediaViewerContent media={media} index={2} onIndex={noop} onClose={noop} />);
    expect(loaded(third)).toEqual([]);
    expect(textOf(third)).toContain(SEALED_IMAGE);
    // The viewer's own controls stay.
    expect(buttons(third)).toEqual(["Close the image viewer", "Previous image", "Next image"]);
  });

  test("is opened only from an image's own cell: the placeholder has no press handler", () => {
    const grid = readFileSync(path.join(SRC, "components", "social", "MediaGrid.tsx"), "utf8");
    const placeholder = readFileSync(path.join(SRC, "components", "social", "HiddenImage.tsx"), "utf8");
    expect(grid).toMatch(/isHiddenMedia\(item\) \? <HiddenImage/);
    expect(placeholder).not.toMatch(/onPress|Pressable|accessibilityRole="button"/);
  });
});

describe("Explore's rows", () => {
  // UI Task 3: Popular now left the context column (UI design, decision 14). Its case moves to the row Explore lists
  // these posts with, ExploreList's PostCard: an image-only post is named by the images the reader is shown.
  test("an image-only post is named by the first image the reader is shown; hidden images are skipped, and a post of hidden images alone has no image line", () => {
    const explore = readFileSync(path.join(SRC, "components", "social", "ExploreList.tsx"), "utf8");
    expect(explore).toContain("renderItem={({ item }) => <PostCard post={item.post} onDeleted={remove} />}");
    const names = (markup: string) => buttons(markup).filter((name) => name.startsWith("Open image: "));
    const first = html(<PostCard post={post(1, { body: "", media: [hidden(11), image(12, "A green square")] })} />);
    expect(names(first)).toEqual(["Open image: A green square"]);
    expect(loaded(first)).toEqual([expect.stringContaining(`/api/media/${id(12)}/small.webp`)]);
    const none = html(<PostCard post={post(2, { body: "", media: [sealed(21), hidden(22)] })} />);
    expect(names(none)).toEqual([]);
    expect(loaded(none)).toEqual([]);
    const third = html(<PostCard post={post(3, { body: "", media: [image(31, "A red circle"), hidden(32)] })} />);
    expect(names(third)).toEqual(["Open image: A red circle"]);
    for (const out of [first, none, third]) expect(out).not.toContain("undefined");
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
 * task that moves a file onto the tokens takes it off this list in the same commit; Task 8 empties it. Paths are
 * from apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_COLOUR_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
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
  "app/u/[handle]/index.tsx",
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
];

/**
 * The files of src/app and src/components that still hold a bare sentence as a JSX child, a text or a string literal
 * written straight into the markup instead of a words module (UI design, section 1.5). a11y.test.tsx lets these files,
 * and only these, keep them; a listed file that no longer holds one fails, so the task that moves a file's sentences
 * into its area's words module takes it off this list in the same commit. Task 10 records what is left. Paths are from
 * apps/app/src, in forward slashes, sorted.
 */
export const LEGACY_TEXT_FILES: readonly string[] = [
  "app/(auth)/age.tsx",
  "app/(auth)/code.tsx",
  "app/(auth)/handle.tsx",
  "app/(auth)/mfa.tsx",
  "app/(auth)/password.tsx",
  "app/(auth)/signin.tsx",
  "app/email-revert/[token].tsx",
  "app/explore/about.tsx",
  "app/index.tsx",
  "app/not-me/[token].tsx",
  "app/passkey-remove/[token].tsx",
  "app/post/[id].tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/u/[handle]/index.tsx",
  "components/moderation/ReportForm.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
  "components/social/ExploreList.tsx",
  "components/social/HiddenImage.tsx",
  "components/social/MediaGrid.tsx",
  "components/social/MediaViewer.tsx",
  "components/social/PagedList.tsx",
  "components/social/PostCard.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/03-shell-navigation-browser-check.md 3
```

Expected: 34 lines starting with `wrote`, one for each file below.

### Create `apps/app/index.ts`

```ts
// The app's entry (package.json's main). zod is made jitless first, before expo-router reads the route files, whose
// layouts it loads while it builds the route tree and which build the contracts' schemas as they are imported; then
// expo-router's own entry starts the app. src/lib/zod-jitless.ts says why.
import "./src/lib/zod-jitless";
import "expo-router/entry";
```

### Create `apps/app/src/app/+not-found.tsx`

```tsx
import { ScrollView } from "react-native";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/kit/EmptyState";
import { usePageTitle } from "@/lib/page-title";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * What a mistyped address shows (UI design, section 8.11). Caddy answers every path with the app's page (try_files), so
 * this screen, inside the shell, is what the reader sees: "This page doesn't exist", its one heading, with Go to Home.
 */
export default function NotFound() {
  const title = usePageTitle("title.notFound");
  return (
    <AppShell>
      {title}
      {/* The column does not scroll by itself: at the largest text the words and the link must still be reachable. */}
      <ScrollView contentContainerClassName="flex-grow justify-center">
        <EmptyState level={1} icon="info" title={UI_WORDS["notFound.title"]} action={{ label: UI_WORDS["notFound.action"], href: "/" }} />
      </ScrollView>
    </AppShell>
  );
}
```

### Create `apps/app/src/components/AboutCard.tsx`

```tsx
import { Pressable, View } from "react-native";
import { Link, type Href } from "expo-router";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./kit/interaction";
import { Text } from "./kit/Text";

/**
 * "How korbat works" (UI design, section 7.3, decision 14), the card under the handle box in the context column, where
 * Popular now was: three short lines on what korbat promises a reader, and the pages that show it. It suggests no posts,
 * since suggestions appear only where the reader goes looking.
 */
const LINES = [UI_WORDS["shell.how1"], UI_WORDS["shell.how2"], UI_WORDS["shell.how3"]];

const LINKS: { label: string; href: Href }[] = [
  { label: UI_WORDS["shell.rulesLink"], href: "/rules" },
  { label: UI_WORDS["shell.transparencyLink"], href: "/transparency" },
  { label: UI_WORDS["shell.exploreLink"], href: "/explore/about" },
];

export function AboutCard() {
  return (
    <View className="gap-3 rounded-card border border-line-low bg-surface-1 px-4 pb-2 pt-4">
      <Text as="h2" variant="title">
        {UI_WORDS["shell.howTitle"]}
      </Text>
      <View className="gap-2">
        {LINES.map((line) => (
          <Text key={line} tone="medium">
            {line}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-x-4">
        {LINKS.map((link) => (
          <Link key={String(link.href)} href={link.href} asChild>
            <Pressable className={cn("group min-h-[44px] justify-center rounded-control active:opacity-70", FOCUS_RING)}>
              <Text tone="accent" className="underline web:underline-offset-2 web:group-hover:decoration-2">
                {link.label}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}
```

### Create `apps/app/src/components/GestureRoot.tsx`

```tsx
/**
 * The gesture root on iOS and Android (UI design, section 7.4): react-native-gesture-handler's own root view, which every
 * GestureDetector needs above it there. The web takes GestureRoot.web.tsx instead.
 */
export { GestureHandlerRootView } from "react-native-gesture-handler";
```

### Create `apps/app/src/components/GestureRoot.web.tsx`

```tsx
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * The gesture root on the web: a plain View, as react-native-gesture-handler's own root view is there (its web file only
 * adds a context that its GestureDetector does not ask for on the web). Importing the package's index for it would put
 * the whole of gesture handler into the web bundle, about 55 KB gzip, for nothing; a screen whose gestures need the
 * package on the web brings it with them. GestureRoot.tsx is the package's root view on iOS and Android.
 */
export function GestureHandlerRootView({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return <View style={style ?? { flex: 1 }}>{children}</View>;
}
```

### Create `apps/app/src/components/ScreenHeader.tsx`

```tsx
import type { ReactNode } from "react";
import { Platform, View, type ViewProps } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useShellScroll } from "@/lib/shell-scroll";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { IconButton } from "./kit/IconButton";
import { Text } from "./kit/Text";

/**
 * The bar at the top of a screen inside the shell (UI design, sections 7.2 and 7.3): Back when the screen sits below a
 * tab (an IconButton named "Back"), the screen's title in display-2 as its one level-1 heading, and the screen's own
 * controls under it. On a phone it floats over the list on the page's surface with a line-low rule, slides up out of
 * view as the list scrolls down past it and returns on any scroll up or when the focus enters it (lib/shell-scroll.tsx;
 * under reduced motion it stays); the list starts below it (HeaderSpace, and the list's own top padding). From 768 px it
 * sits above the list and stays, with the rule drawn once the list has scrolled.
 */
export function ScreenHeader({ title, back, children }: { title: string; back?: Href; children?: ReactNode }) {
  const scroll = useShellScroll();
  const insets = useSafeAreaInsets();
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: scroll.headerY.value }] }));
  // Back goes where the reader came from, or, opened from an address, to the screen above this one.
  const goBack = () => {
    if (back === undefined) return;
    if (router.canGoBack()) router.back();
    else router.replace(back);
  };
  // react-native-web hands focus events to a View, and they bubble from the controls inside it; the types of React
  // Native's View do not list them.
  const focusable = { onFocus: scroll.showHeader } as ViewProps;
  const bar = (
    <View
      {...focusable}
      className={cn(
        "gap-1 border-b bg-surface px-4 pb-3 pt-3 web:transition-colors web:duration-150",
        scroll.phone || scroll.scrolled ? "border-line-low" : "border-transparent",
      )}
      // The status bar's height on native; the web's insets are the browser's own.
      style={Platform.OS === "web" ? undefined : { paddingTop: insets.top + 12 }}
    >
      <View className="min-h-[44px] flex-row items-center gap-1">
        {back !== undefined ? (
          <View className="-ml-3">
            <IconButton icon="back" label={UI_WORDS["shell.back"]} onPress={goBack} tone="high" />
          </View>
        ) : null}
        {/* The title wraps, and at the largest text a long word breaks, rather than pushing the page sideways. */}
        <Text as="h1" variant="display-2" className="min-w-0 flex-1 web:hyphens-auto web:break-words">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
  if (!scroll.phone) return bar;
  return (
    <Animated.View
      nativeID="screen-header"
      onLayout={(event) => scroll.setHeaderHeight(event.nativeEvent.layout.height)}
      style={[{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }, slide]}
    >
      {bar}
    </Animated.View>
  );
}

/** The room the floating phone header takes above content that is not a list (skeleton rows while a screen loads). */
export function HeaderSpace() {
  const scroll = useShellScroll();
  return scroll.headerSpace > 0 ? <View style={{ height: scroll.headerSpace }} /> : null;
}
```

### Create `apps/app/src/components/ToastCard.tsx`

```tsx
import { Pressable, View } from "react-native";
import { cn } from "@/theme/cn";
import type { ToastTone } from "@/lib/toast-rules";
import { Icon } from "./kit/Icon";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

/**
 * One toast as korbat draws it (UI design, sections 4.6, 5.4 and 6.16), the same on web (sonner) and native
 * (sonner-native), which place, stack, time and swipe it: a floating surface-1 card with a line-high border and no
 * shadow, the done icon in ink-high (a success is never green, section 4.8) or the error icon for a rollback, the
 * sentence, and at most one action, a 44 px button in the accent's ink. Under forced colours the border is CanvasText,
 * so the card keeps its edge when the browser removes backgrounds.
 */
export function ToastCard({ message, tone = "done", action, onAction }: { message: string; tone?: ToastTone; action?: string; onAction?: () => void }) {
  return (
    <View className="min-h-[56px] w-full flex-row items-center gap-3 rounded-card border border-line-high bg-surface-1 py-1.5 pl-4 pr-1.5 web:forced-colors:border-[color:CanvasText]">
      <Icon name={tone === "rollback" ? "error" : "done"} size={20} tone={tone === "rollback" ? "danger" : "high"} />
      <Text className="flex-1 py-2.5">{message}</Text>
      {action !== undefined && onAction !== undefined ? (
        <Pressable accessibilityRole="button" onPress={onAction} className={cn("min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 active:bg-surface-2", HOVER_WASH, FOCUS_RING)}>
          <Text variant="body-strong" tone="accent">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

### Create `apps/app/src/components/toast.tsx`

```tsx
import { AccessibilityInfo } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster as NativeToaster, toast as nativeToast } from "sonner-native";
import { useMotion } from "@/lib/motion";
import { TOAST_LIMIT, toastDuration, toastOffset, useComposeButtonShown, type ToastInput } from "@/lib/toast-rules";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/ThemeProvider";
import { ToastCard } from "./ToastCard";

/**
 * Toasts on iOS and Android (UI design, section 5.4), through sonner-native 0.27.0, with the API of toast.web.tsx. A
 * toast is also announced to the screen reader, with its action's word, since a native toast is no live region; its
 * timer pauses while it is touched, and it can be swiped away.
 */
let next = 0;

export const toast = {
  show(input: ToastInput): void {
    next += 1;
    const id = `korbat-${next}`;
    nativeToast.custom(
      <ToastCard
        message={input.message}
        tone={input.tone}
        action={input.action?.label}
        onAction={
          input.action === undefined
            ? undefined
            : () => {
                input.action?.onPress();
                nativeToast.dismiss(id);
              }
        }
      />,
      { id, duration: toastDuration(input), unstyled: true },
    );
    AccessibilityInfo.announceForAccessibility(input.action === undefined ? input.message : `${input.message} ${input.action.label}`);
  },
};

/** The fade that replaces a toast's movement under korbat's own "Reduce motion: Always" (150 ms, opacity only). */
const STILL = { enter: FadeIn.duration(150), exit: FadeOut.duration(150) };

/**
 * The one toaster, mounted in the root layout inside the theme: bottom centre, at most three, above the tab bar and the
 * compose button on phones. sonner-native drops its own movement under the system's reduced motion (it reads
 * Reanimated's useReducedMotion()); under korbat's "Always" it is given the fade instead.
 */
export function Toaster() {
  const theme = useTheme();
  const motion = useMotion();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const composeButton = useComposeButtonShown();
  return (
    <NativeToaster
      position="bottom-center"
      visibleToasts={TOAST_LIMIT}
      theme={theme.scheme}
      gap={8}
      offset={toastOffset({ layout, bottomInset: insets.bottom, composeButton })}
      animation={motion.reduced ? STILL : undefined}
    />
  );
}
```

### Create `apps/app/src/components/toast.web.tsx`

```tsx
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toaster as Sonner, toast as sonner } from "sonner";
import { useMotion } from "@/lib/motion";
import { TOAST_LIMIT, toastDuration, toastOffset, useComposeButtonShown, type ToastInput } from "@/lib/toast-rules";
import { useLayout } from "@/theme/layout";
import { useTheme } from "@/theme/ThemeProvider";
import { ToastCard } from "./ToastCard";

/**
 * Toasts on the web (UI design, section 5.4), through sonner 2.0.8. sonner places, stacks, times and swipes them, and its
 * region is a polite live region whose hotkey, Alt+T, moves the focus into it, so a toast's action is reachable from the
 * keyboard; korbat draws each toast itself (ToastCard), since sonner's own look has a shadow and a 24 px action button.
 * Timers pause while a toast is hovered, while the focus is inside the toaster and while the page is hidden (sonner's
 * own behaviour). toast.tsx is the same API on iOS and Android.
 */
export const toast = {
  show(input: ToastInput): void {
    sonner.custom(
      (id) => (
        <ToastCard
          message={input.message}
          tone={input.tone}
          action={input.action?.label}
          onAction={
            input.action === undefined
              ? undefined
              : () => {
                  input.action?.onPress();
                  sonner.dismiss(id);
                }
          }
        />
      ),
      { duration: toastDuration(input) },
    );
  },
};

/**
 * The one toaster, mounted in the root layout inside the theme: bottom centre, at most three, above the tab bar and the
 * compose button on phones. Under reduced motion (the system's, which sonner also follows, or korbat's own Always) every
 * toast takes the class k-still, whose rule in theme/fonts.web.ts's style element keeps it from moving: it only fades.
 */
export function Toaster() {
  const theme = useTheme();
  const motion = useMotion();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const composeButton = useComposeButtonShown();
  const bottom = toastOffset({ layout, bottomInset: insets.bottom, composeButton });
  return (
    <Sonner
      position="bottom-center"
      visibleToasts={TOAST_LIMIT}
      theme={theme.scheme}
      gap={8}
      // sonner switches to its mobile offset below 600 px; korbat's phone layout runs to 768 px, so both are set.
      offset={{ bottom }}
      mobileOffset={{ bottom, left: 16, right: 16 }}
      toastOptions={{ className: motion.reduced ? "k-still" : undefined }}
    />
  );
}
```

### Create `apps/app/src/lib/page-title.tsx`

```tsx
import type { ReactElement } from "react";
import Head from "expo-router/head";
import { fill, TITLE_WORDS, type TitleWord } from "./ui-words";

/**
 * Each screen's browser tab title (UI design, section 8.1, decision 16; WCAG 2.4.2), set on the client through
 * expo-router's Head, which applies the title of the screen in focus only. A title names the kind of screen and never an
 * account, so a synced browser history holds no handles. The server-rendered titles and the meta of share cards stay
 * with sub-project 2d.
 */
export function pageTitle(key: TitleWord, values: Record<string, string | number> = {}): string {
  return fill(TITLE_WORDS[key], values);
}

/**
 * The element that sets a screen's title: a screen renders what this returns once, anywhere in its tree. On native Head
 * hands the title to the system (Handoff and search on iOS) and draws nothing.
 */
export function usePageTitle(key: TitleWord, values?: Record<string, string | number>): ReactElement {
  return (
    <Head>
      <title>{pageTitle(key, values)}</title>
    </Head>
  );
}
```

### Create `apps/app/src/lib/shell-scroll.tsx`

```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useMotion } from "./motion";

/**
 * What a screen's list and the shell tell each other while the list scrolls (UI design, sections 5.2, 7.1 and 7.2;
 * review ruling 8). AppShell provides it, one per screen. On a phone the screen's header slides up out of view as the
 * list scrolls down past it and comes back on any scroll up, or when the focus enters it (header-hide: 200 ms ease-out,
 * reversing from where it is; under reduced motion it stays). From 768 px the header stays and draws a line-low rule
 * once the list has scrolled. Pressing the current Home item again brings the list to its newest post (the soft reset,
 * smooth, or at once under reduced motion), without reloading it. Task 5 moves the list's side of this onto List.
 */

/**
 * Where the header should be, as a translateY in px (0 shown, minus its height hidden), after the list moved from
 * `previousY` to `y`: scrolling down past the header's height hides it, any scroll up shows it, the top of the list (or
 * an overscroll above it) always shows it, and anything else keeps `offset`, where it is now.
 */
export function headerOffset({ previousY, y, height, offset }: { previousY: number; y: number; height: number; offset: number }): number {
  if (height <= 0 || y <= 0) return 0;
  if (y < previousY) return 0;
  if (y > previousY && y > height) return -height;
  return offset;
}

/** A list the shell can bring to its top. */
export interface ScrollTarget {
  toTop(animated: boolean): void;
}

/** What the store asks of the screen: move the header to an offset, and say whether the list has left its top. */
export interface ShellScrollHooks {
  moveHeader(offset: number): void;
  markScrolled(scrolled: boolean): void;
}

/**
 * The shell's scroll state for one screen, apart from React so it can be driven in a test: the header's offset, the
 * list's last position and the one list registered for the soft reset. `settings` is the shell's current layout and
 * motion: `hides` on a phone without reduced motion.
 */
export function createShellScroll(hooks: ShellScrollHooks) {
  let target: ScrollTarget | null = null;
  let previousY = 0;
  let offset = 0;
  let height = 0;
  let scrolled = false;
  const store = {
    settings: { hides: false, reduced: false },
    setHeight(next: number): void {
      height = next;
    },
    onScroll(y: number): void {
      const next = store.settings.hides ? headerOffset({ previousY, y, height, offset }) : 0;
      previousY = y;
      if (next !== offset) {
        offset = next;
        hooks.moveHeader(next);
      }
      if (y > 0 !== scrolled) {
        scrolled = y > 0;
        hooks.markScrolled(scrolled);
      }
    },
    /** Brings the header back, wherever the list is: the focus entered it, or the list goes to its top. */
    show(): void {
      if (offset === 0) return;
      offset = 0;
      hooks.moveHeader(0);
    },
    /** The list that the soft reset scrolls; the function returned forgets it, if it is still the one. */
    register(list: ScrollTarget): () => void {
      target = list;
      return () => {
        if (target === list) target = null;
      };
    },
    /** Scrolls the registered list to its top, smooth unless motion is reduced; false when no list is registered. */
    toTop(): boolean {
      if (target === null) return false;
      store.show();
      target.toTop(!store.settings.reduced);
      return true;
    },
  };
  return store;
}

export type ShellScrollStore = ReturnType<typeof createShellScroll>;

/**
 * The current Home item pressed again: the feed goes to its newest post, and the link does not navigate, so the tab, the
 * reader's marker and the new-posts pill stay as they are (section 7.1).
 */
export function softReset(event: { preventDefault(): void }, scroll: Pick<ShellScrollStore, "toTop">): void {
  event.preventDefault();
  scroll.toTop();
}

export interface ShellScroll {
  /** The list's onScroll. */
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  /** Registers the list for the soft reset; returns the function that forgets it (an effect's cleanup). */
  register(list: ScrollTarget): () => void;
  toTop(): boolean;
  /** The focus entered the header: show it. */
  showHeader(): void;
  setHeaderHeight(height: number): void;
  /** On a phone the header floats over the list, which starts this far down so its first row is not under it. */
  headerSpace: number;
  /** The header's translateY, which ScreenHeader animates on a phone. */
  headerY: SharedValue<number>;
  /** The list has left its top: from 768 px the header draws its rule. */
  scrolled: boolean;
  phone: boolean;
}

const noop = () => undefined;

/** Outside a shell nothing scrolls the header: a list rendered on its own keeps working. */
const OUTSIDE: ShellScroll = {
  onScroll: noop,
  register: () => noop,
  toTop: () => false,
  showHeader: noop,
  setHeaderHeight: noop,
  headerSpace: 0,
  headerY: { value: 0 } as SharedValue<number>,
  scrolled: false,
  phone: false,
};

const ShellScrollContext = createContext<ShellScroll>(OUTSIDE);

export function useShellScroll(): ShellScroll {
  return useContext(ShellScrollContext);
}

/** The header-hide's movement: 200 ms on ease-out, from wherever the header is (section 5.2). */
const HIDE_MS = 200;

export function ShellScrollProvider({ phone, children }: { phone: boolean; children: ReactNode }) {
  const motion = useMotion();
  const headerY = useSharedValue(0);
  const [scrolled, setScrolled] = useState(false);
  const [height, setHeight] = useState(0);
  // The latest motion, read when the store moves the header, which it does from a scroll event and not a render.
  const latest = useRef(motion);
  latest.current = motion;
  const [store] = useState(() =>
    createShellScroll({
      moveHeader: (offset) => {
        headerY.value = latest.current.reduced ? offset : withTiming(offset, latest.current.timing("easeOut", HIDE_MS));
      },
      markScrolled: setScrolled,
    }),
  );
  store.settings = { hides: phone && !motion.reduced, reduced: motion.reduced };
  // A header hidden on a phone comes back when the window widens or motion becomes reduced.
  useEffect(() => {
    if (!phone || motion.reduced) store.show();
  }, [phone, motion.reduced, store]);

  const value = useMemo<ShellScroll>(
    () => ({
      onScroll: (event) => store.onScroll(event.nativeEvent.contentOffset.y),
      register: store.register,
      toTop: store.toTop,
      showHeader: store.show,
      setHeaderHeight: (next) => {
        store.setHeight(next);
        setHeight(next);
      },
      headerSpace: phone ? height : 0,
      headerY,
      scrolled,
      phone,
    }),
    [store, phone, height, headerY, scrolled],
  );
  return <ShellScrollContext.Provider value={value}>{children}</ShellScrollContext.Provider>;
}
```

### Create `apps/app/src/lib/toast-rules.ts`

```ts
import { useSyncExternalStore } from "react";
import type { LayoutKind } from "@/theme/layout";

/**
 * What the two toast files share (UI design, sections 5.4 and 6.16): components/toast.web.tsx draws toasts with sonner and
 * components/toast.tsx with sonner-native, behind one API, `toast.show({ message, action?, tone? })`. A toast confirms;
 * it never carries the only copy of something the reader must act on.
 */
export type ToastTone = "done" | "rollback";

export interface ToastAction {
  /** The action's word, named as its button names it everywhere ("View"). */
  label: string;
  onPress: () => void;
}

export interface ToastInput {
  /** The sentence, naming the action as its button did ("Your reply was sent"). */
  message: string;
  action?: ToastAction;
  /** done (the default) shows the done icon; rollback, an optimistic action the server refused, the error icon. */
  tone?: ToastTone;
}

/** At most three on screen; newer ones stack above older ones. */
export const TOAST_LIMIT = 3;

/** How long a toast stays, in ms: long enough to reach its action, and a rollback a little longer than a plain one. */
export const TOAST_DURATION = { plain: 4000, action: 8000, rollback: 6000 } as const;

export function toastDuration(input: ToastInput): number {
  if (input.action !== undefined) return TOAST_DURATION.action;
  return input.tone === "rollback" ? TOAST_DURATION.rollback : TOAST_DURATION.plain;
}

/**
 * How far above the window's bottom edge toasts sit, in px. On phones they clear the 56 px tab bar and the bottom safe
 * area (72 px plus the inset), and on a screen with the compose button they clear it too (140 px plus the inset), so a
 * toast's "View" is never under the button. Wider up they sit at the bottom centre of the window.
 */
export function toastOffset({ layout, bottomInset, composeButton }: { layout: LayoutKind; bottomInset: number; composeButton: boolean }): number {
  if (layout !== "phone") return 24;
  return (composeButton ? 140 : 72) + bottomInset;
}

/**
 * Whether a phone screen shows the floating compose button now. AppShell, which draws the button, says so; the one
 * Toaster, mounted in the root layout outside every screen, reads it to place toasts above it.
 */
let composeShown = false;
const listeners = new Set<() => void>();

export function setComposeButtonShown(shown: boolean): void {
  if (shown === composeShown) return;
  composeShown = shown;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = () => composeShown;

export function useComposeButtonShown(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
```

### Create `apps/app/src/lib/zod-jitless.ts`

```ts
import { z } from "zod";

// The app's page runs under a policy that allows no script compiled from a string (script-src 'self' and Turnstile only;
// infra/caddy/Caddyfile, app_page_headers). Unless zod is jitless, the first object schema it builds probes whether it
// may compile code from a string, which the browser reports as a policy violation even though zod catches the failure
// (the console found the same, apps/admin/src/zod-jitless.ts). The contracts build their schemas as soon as they are
// imported, and expo-router loads layouts while it builds the route tree, before the root layout runs, so the app's
// entry (apps/app/index.ts) imports this module first, and it imports nothing but zod.
z.config({ jitless: true });
```

### Replace `apps/app/package.json` (whole file)

```json
{
  "name": "@korbat/app",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "export:web": "expo export --platform web",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:browser": "vitest run --config vitest.browser.config.mts"
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
    "expo-haptics": "57.0.3",
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
    "sonner": "2.0.8",
    "sonner-native": "0.27.0",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "playwright-core": "1.63.0",
    "tailwindcss": "3.4.19",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/app/src/app/_layout.tsx` (whole file)

```tsx
import "../../global.css";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { Icon } from "@/components/kit/Icon";
import { PublicFrame } from "@/components/kit/PublicFrame";
import { Text } from "@/components/kit/Text";
import { Toaster } from "@/components/toast";
import { Button, TextLink } from "@/components/ui";
import { SessionProvider } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { installFonts } from "@/theme/fonts";
import { ThemeProvider } from "@/theme/ThemeProvider";

// The font rules go in before the first render, so text set in korbat's faces asks for its file at once (web only).
installFonts();

/**
 * What a screen that threw shows instead of itself (UI design, section 8.11): the public frame with "Something went wrong
 * on this screen", "Try again" (expo-router's retry, which renders the screen again) and "Go to Home". It promises
 * nothing it cannot check, since the boundary does not know what the broken screen had sent, and nothing about the error
 * is shown or leaves the device: korbat has no crash reporting (section 1.7). It renders in place of the layout, so it
 * needs none of the providers below; Text and the theme read the appearance store themselves.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // The error stays in this function: React has already written it to the browser's own console, and that is all.
  void error;
  return (
    <PublicFrame>
      <View className="items-center gap-3 py-12">
        <Icon name="error" size={24} tone="danger" />
        <Text as="h1" variant="display-2" className="text-center">
          {UI_WORDS["crash.title"]}
        </Text>
        <Text tone="medium" className="text-center">
          {UI_WORDS["crash.body"]}
        </Text>
        <Button label={UI_WORDS["crash.retry"]} full={false} onPress={() => void retry()} />
        <TextLink label={UI_WORDS["notFound.action"]} href="/" />
      </View>
    </PublicFrame>
  );
}

/**
 * The root of every screen: the gesture root and the safe areas outside everything (section 7.4), the theme inside them,
 * the session inside the theme, and the one Toaster beside the screens, inside the theme so toasts take its tokens.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </SessionProvider>
          <Toaster />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

### Replace `apps/app/src/app/bookmarks.tsx` (whole file)

```tsx
import { useCallback } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Icon } from "@/components/kit/Icon";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { PostList } from "@/components/social/PagedList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";

/** The header (UI design, section 8.5): "Bookmarks", and beside the privacy icon, "Private to you." */
function BookmarksHeader() {
  return (
    <ScreenHeader title={UI_WORDS["bookmarks.title"]}>
      <View className="flex-row items-center gap-1.5">
        <Icon name="privacy" size={16} tone="low" />
        <Text variant="meta" tone="low">
          {UI_WORDS["bookmarks.private"]}
        </Text>
      </View>
    </ScreenHeader>
  );
}

/** Your bookmarks, newest first. Nobody else can see them. */
export default function Bookmarks() {
  const { state } = useSession();
  const title = usePageTitle("title.bookmarks");
  const fetchPage = useCallback((cursor?: string) => social.myBookmarks(cursor), []);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <BookmarksHeader />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;

  return (
    <AppShell>
      {title}
      <BookmarksHeader />
      <PostList fetchPage={fetchPage} empty={UI_WORDS["bookmarks.empty"]} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/notice/[ref].tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { NoticeRef, type NoticeItemStatus, type NoticeStatus } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { NoticeNotFound, NoticeStatusView } from "@/components/moderation/NoticeStatusView";
import { Skeleton } from "@/components/kit/Skeleton";
import { Button, ErrorText } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { fragmentToken, moderation } from "@/lib/moderation";
import { STATUS_WORDS } from "@/lib/moderation-words";

type Shown = { kind: "loading" } | { kind: "missing" } | { kind: "failed"; message: string } | { kind: "status"; status: NoticeStatus };

/**
 * The notice status page (3c design, section 9), outside the settings: whoever holds the link reads it, signed in or
 * not. The link carries the reference in its path and the token in its fragment, which a browser sends to no server; the
 * page reads the token there and sends it only in the body of a POST. A wrong reference and a wrong token read the same.
 */
export default function NoticePage() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (ref: string, token: string) => {
    try {
      setShown({ kind: "status", status: await moderation.status(ref, token) });
    } catch (err) {
      // No report has this reference with this token, or the address was not a status page's at all.
      if (err instanceof ApiError && (err.code === "notice_not_found" || err.code === "invalid_request")) setShown({ kind: "missing" });
      else setShown({ kind: "failed", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const location = (globalThis as { location?: { hash: string } }).location;
    const found = location ? fragmentToken(location.hash) : null;
    setToken(found);
    if (found === null || !NoticeRef.safeParse(ref).success) {
      setShown({ kind: "missing" });
      return;
    }
    setShown({ kind: "loading" });
    void load(ref, found);
  }, [ref, load]);

  /** One of the page's buttons: a POST with the page's own token, then the page again as the API now gives it. */
  async function contact(choice: "confirm" | "stop") {
    if (busy || token === null) return;
    setBusy(true);
    setError(null);
    try {
      await moderation.contact(ref, token, choice);
      await load(ref, token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Ask for a re-examination" of one item: a POST with the page's own token and the item's position, then the page again
   * as the API now gives it. A refusal is thrown to the control that asked, which words it in place.
   */
  async function reexamine(item: NoticeItemStatus, statement: string) {
    if (token === null) return;
    await moderation.reexamineNotice(ref, token, item.position, statement);
    await load(ref, token);
  }

  // While the status loads the page stays in the shell, as skeleton lines (UI design, section 6.12).
  if (shown.kind === "loading") {
    return (
      <AppShell>
        <Skeleton.Page />
      </AppShell>
    );
  }
  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          {shown.kind === "missing" ? <NoticeNotFound /> : null}
          {shown.kind === "failed" ? (
            <>
              <ErrorText message={shown.message} />
              <Button
                label={STATUS_WORDS.retry}
                onPress={() => {
                  if (token !== null) void load(ref, token);
                }}
                tone="secondary"
              />
            </>
          ) : null}
          {shown.kind === "status" ? <NoticeStatusView status={shown.status} onContact={(choice) => void contact(choice)} onReexamine={reexamine} busy={busy} error={error} /> : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/report.tsx` (whole file)

```tsx
import { ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { ReportForm } from "@/components/moderation/ReportForm";
import { givenTarget } from "@/lib/moderation";
import { useSession } from "@/lib/session";

/**
 * The report form's page (3c design, section 9): opened from "Report" on a post, an image or a profile, whose address
 * names the item, or on its own, from the terms page, where it asks for a link. It stands outside the settings, whose
 * layout sends a signed-out reader to sign in: anyone may report, signed in or not. An account that has not chosen a
 * handle yet finishes that first, as the API asks of every signed-in request.
 */
export default function Report() {
  const params = useLocalSearchParams<{ post?: string; media?: string; account?: string }>();
  const { state } = useSession();
  // While the session loads the form's place stays in the shell, as skeleton lines (UI design, section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        <Skeleton.Page />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  const given = givenTarget(params);
  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          {/* A form opened on another item starts empty: its key is the item. */}
          <ReportForm key={given ? JSON.stringify(given) : "link"} signedIn={state.status === "signed-in"} given={given} standing={state.status === "signed-in" ? state.me.standing : null} />
        </View>
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/followers.tsx` (whole file)

```tsx
import { useCallback } from "react";
import { Pressable } from "react-native";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { FollowButton, ProfileList } from "@/components/social/ProfileList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The header (UI design, sections 7.2 and 8.4): Back to the profile, "Followers" as the h1, and the account's handle in the
 * mono face, a link to its profile. The tab's title names the kind of screen only, never the account.
 */
function FollowersHeader({ handle }: { handle: string }) {
  return (
    <ScreenHeader title={UI_WORDS["followers.title"]} back={`/u/${handle}`}>
      <Link href={`/u/${handle}`} asChild>
        <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING)}>
          <Text variant="mono" tone="accent" className="underline web:underline-offset-2">
            @{handle}
          </Text>
        </Pressable>
      </Link>
    </ScreenHeader>
  );
}

/** Who follows an account. Signed-in viewers only, so scraping needs an account we can limit. */
export default function Followers() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.followers");
  const fetchPage = useCallback((cursor?: string) => social.followers(handle, cursor), [handle]);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <FollowersHeader handle={handle} />
        <HeaderSpace />
        <Skeleton.List kind="accounts" count={6} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  const myId = state.me.user.id;

  return (
    <AppShell>
      {title}
      <FollowersHeader handle={handle} />
      <ProfileList
        fetchPage={fetchPage}
        empty={UI_WORDS["followers.empty"]}
        action={(item) => (item.id === myId ? undefined : <FollowButton handle={item.handle} initial={item.viewerFollows ?? false} />)}
      />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/following.tsx` (whole file)

```tsx
import { useCallback } from "react";
import { Pressable } from "react-native";
import { Link, Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { FollowButton, ProfileList } from "@/components/social/ProfileList";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The header (UI design, sections 7.2 and 8.4): Back to the profile, "Following" as the h1, and the account's handle in the
 * mono face, a link to its profile. The tab's title names the kind of screen only, never the account.
 */
function FollowingHeader({ handle }: { handle: string }) {
  return (
    <ScreenHeader title={UI_WORDS["following.title"]} back={`/u/${handle}`}>
      <Link href={`/u/${handle}`} asChild>
        <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING)}>
          <Text variant="mono" tone="accent" className="underline web:underline-offset-2">
            @{handle}
          </Text>
        </Pressable>
      </Link>
    </ScreenHeader>
  );
}

/** Who an account follows. Signed-in viewers only. */
export default function Following() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const title = usePageTitle("title.following");
  const fetchPage = useCallback((cursor?: string) => social.followingOf(handle, cursor), [handle]);

  // While the session loads the screen stays in the shell, with skeleton rows under its header (section 6.12).
  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        <FollowingHeader handle={handle} />
        <HeaderSpace />
        <Skeleton.List kind="accounts" count={6} />
      </AppShell>
    );
  }
  if (state.status === "signed-out") return <Redirect href="/signin" />;
  const myId = state.me.user.id;

  return (
    <AppShell>
      {title}
      <FollowingHeader handle={handle} />
      <ProfileList
        fetchPage={fetchPage}
        empty={UI_WORDS["following.empty"]}
        action={(item) => (item.id === myId ? undefined : <FollowButton handle={item.handle} initial={item.viewerFollows ?? false} />)}
      />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/u/[handle]/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams, type Href } from "expo-router";
import type { ProfileView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { PostList, TimelineList } from "@/components/social/PagedList";
import { FollowButton } from "@/components/social/ProfileList";
import { Button, Loading, VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { social } from "@/lib/social";

type Tab = "posts" | "replies" | "likes";

function Stat({ label, value, href }: { label: string; value: number; href?: Href }) {
  const inner = (
    <Text className="text-sm text-zinc-400">
      <Text className="font-semibold text-zinc-50">{value}</Text> {label}
    </Text>
  );
  return href ? (
    <Link href={href} asChild>
      <Pressable className="mr-4">{inner}</Pressable>
    </Link>
  ) : (
    <View className="mr-4">{inner}</View>
  );
}

/** A profile: header with counts and actions, then Posts and Replies tabs, plus a private Likes tab on your own. */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { state } = useSession();
  const me = state.status === "signed-in" && state.me.user.onboarded ? state.me : null;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("posts");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 3e (design, section 9.4): a follow refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const blockDialog = useRef<View>(null);
  useEffect(() => {
    if (confirmBlock) (blockDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [confirmBlock]);

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
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This account is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
        </View>
      </AppShell>
    );
  }
  if (!profile) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const own = me !== null && profile.id === me.user.id;
  const viewer = profile.viewer;
  const tabs: Tab[] = own ? ["posts", "replies", "likes"] : ["posts", "replies"];

  // Anyone but the profile's owner may report it, signed in or out (3c design, section 9): a link to the report form,
  // which stands beside Mute and Block when those are shown.
  const report = own ? null : (
    <Link href={reportHref({ account: profile.handle })} asChild>
      <Pressable className="rounded-full border border-zinc-600 px-4 py-1.5">
        <Text className="text-sm text-zinc-200">{REPORT_WORDS.control}</Text>
      </Pressable>
    </Link>
  );

  const header = (
    <View className="border-b border-zinc-800 px-4 pt-4">
      <View className="flex-row flex-wrap items-center gap-x-2">
        <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-50">
          {profile.displayName}
        </Text>
        {profile.verified ? <VerifiedChip /> : null}
      </View>
      <Text className="text-base text-zinc-400">@{profile.handle}</Text>
      {profile.bio ? <Text className="mt-2 text-base leading-6 text-zinc-200">{profile.bio}</Text> : null}
      <View className="mt-3 flex-row">
        <Stat label="posts" value={profile.counts.posts} />
        <Stat label="followers" value={profile.counts.followers} href={me ? `/u/${profile.handle}/followers` : undefined} />
        <Stat label="following" value={profile.counts.following} href={me ? `/u/${profile.handle}/following` : undefined} />
      </View>
      {viewer?.followedBy ? <Text className="mt-1 text-xs text-zinc-400">Follows you</Text> : null}

      {me && !own && viewer ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <FollowButton
            handle={profile.handle}
            initial={viewer.following}
            onChange={(following, followerCount) =>
              setProfile((current) => (current ? { ...current, counts: { ...current.counts, followers: followerCount }, viewer: { ...current.viewer!, following } } : current))
            }
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const { muted } = await social.setMute(profile.handle, !viewer.muted);
                setProfile((current) => (current ? { ...current, viewer: { ...current.viewer!, muted } } : current));
              })
            }
            className="rounded-full border border-zinc-600 px-4 py-1.5"
          >
            <Text className="text-sm text-zinc-200">{viewer.muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmBlock(true)} className="rounded-full border border-red-900 px-4 py-1.5">
            <Text className="text-sm text-red-300">Block</Text>
          </Pressable>
          {report}
        </View>
      ) : null}
      {/* Without the signed-in controls (signed out, or no relation loaded) the report link stands alone in their place. */}
      {!own && !(me && viewer) ? <View className="mt-3 flex-row">{report}</View> : null}
      {own ? <Button label="Security and privacy settings" onPress={() => router.push("/settings/security")} tone="secondary" /> : null}
      {!me ? <Text className="mt-3 text-xs text-zinc-400">Sign in to follow this account.</Text> : null}
      {actionError ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {actionError}
        </Text>
      ) : null}
      {refused ? <RefusedNotice standing={me?.standing ?? null} /> : null}

      {confirmBlock ? (
        <View ref={blockDialog} role="dialog" aria-labelledby="block-title" tabIndex={-1} className="mt-3 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="block-title" className="text-base font-semibold text-zinc-50">
            Block @{profile.handle}?
          </Text>
          <Text className="mt-1 text-sm text-zinc-300">
            Neither of you will see the other's posts or profile while signed in, and you will unfollow each other. Posts on korbat are public, so a block does not hide them from
            someone who signs out. You can undo this in your privacy settings.
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await social.setBlock(profile.handle, true);
                  router.replace("/settings/privacy");
                })
              }
              className="rounded-lg bg-red-600 px-4 py-2"
            >
              <Text className="text-sm font-semibold text-zinc-50">Block</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmBlock(false)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View accessibilityRole="tablist" className="mt-4 flex-row">
        {tabs.map((t) => (
          <Pressable key={t} accessibilityRole="tab" aria-selected={tab === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${tab === t ? "border-zinc-50" : "border-transparent"}`}>
            <Text className={`text-base ${tab === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "posts" ? "Posts" : t === "replies" ? "Replies" : "Likes"}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <AppShell>
      {tab === "posts" ? (
        <TimelineList key="posts" fetchPage={fetchPosts} empty="No posts yet." header={header} />
      ) : tab === "replies" ? (
        <PostList key="replies" fetchPage={fetchReplies} empty="No replies yet." header={header} />
      ) : (
        <PostList key="likes" fetchPage={fetchLikes} empty="You have not liked anything yet. Only you can see this tab." header={header} />
      )}
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
import { StandingBanner } from "./StandingBanner";

/**
 * The shell around every screen of the app (UI design, section 7): the navigation, the main column the screen draws in,
 * and from 1024 px the context column. useLayout() picks one of four layouts by the window's width:
 *
 * - phone (below 768 px): a bottom tab bar, icons over 12 px labels, and the screen's floating compose button;
 * - tablet (768 to 1023 px): a rail 80 px wide at the left, with the "k" monogram, and the 600 px column centred in the rest;
 * - desktop (1024 to 1279 px): the rail, the column and the 320 px context column, together and centred;
 * - wide (1280 px and up): the full nav, 240 px with the wordmark and labels beside the icons, the column and the context.
 *
 * The nav is a landmark named "Main" with the same items and hrefs at every width (Home, Bookmarks, Profile, Settings for
 * an account; Home and Sign in signed out). The current item keeps aria-current="page" on its anchor and is marked by
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
  if (status === "signed-out") return [HOME, { label: UI_WORDS["nav.signin"], href: "/signin", icon: "sign-in" }];
  return [
    HOME,
    { label: UI_WORDS["nav.bookmarks"], href: "/bookmarks", icon: "bookmarks" },
    { label: UI_WORDS["nav.profile"], href: handle ? `/u/${handle}` : "/handle", icon: "profile" },
    // Settings opens Security until the Settings index (Task 8).
    { label: UI_WORDS["nav.settings"], href: "/settings/security", icon: "settings", match: "/settings" },
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
 * the wordmark, labels beside the icons). Under them, the screen's own New post button when it gives one.
 */
function SideNav({ items, pathname, onHomeAgain, full, floating }: NavProps & { full: boolean; floating?: ReactNode }) {
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
      {floating ? <View className="mt-4 items-center">{floating}</View> : null}
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

export function AppShell({ children, floating }: { children: ReactNode; floating?: ReactNode }) {
  const kind = useLayout();
  return (
    <ShellScrollProvider phone={kind === "phone"}>
      <Shell kind={kind} floating={floating}>
        {children}
      </Shell>
    </ShellScrollProvider>
  );
}

function Shell({ kind, children, floating }: { kind: LayoutKind; children: ReactNode; floating?: ReactNode }) {
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
  const hasFloating = floating !== undefined && floating !== null && floating !== false;

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
            {floating}
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
          <SideNav {...nav} full={kind === "wide"} floating={floating} />
          {timeline}
          <ContextColumn />
        </View>
      ) : (
        // A tablet: the rail at the left edge and the column centred in the rest.
        <View className="w-full flex-row">
          <SideNav {...nav} full={false} floating={floating} />
          <View className="min-w-0 flex-1 flex-row justify-center">
            {timeline}
          </View>
        </View>
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/HandleBox.tsx` (whole file)

```tsx
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useAppearance } from "@/lib/appearance";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./kit/Icon";
import { FOCUS_RING } from "./kit/interaction";
import { Text, textStyle } from "./kit/Text";

/**
 * Opens a profile by handle, for an account whose handle is already known (UI design, section 7.3): the first thing in
 * the context column, above How korbat works. Explore (2c) is the way to come across posts and accounts; search stays
 * out. The handle is typed in the mono face, so look-alike handles stay apart.
 */
export function HandleBox() {
  const theme = useTheme();
  const appearance = useAppearance();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const handle = value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError(UI_WORDS["handle.invalid"]);
      return;
    }
    setError(null);
    setValue("");
    router.push(`/u/${handle}`);
  }

  return (
    <View className="gap-2">
      <Text variant="body-strong" tone="medium">
        {UI_WORDS["handle.title"]}
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          accessibilityLabel={UI_WORDS["handle.field"]}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={UI_WORDS["handle.placeholder"]}
          // The placeholder is ink-low on surface-1, at least 6.29:1 in every theme (section 4.2).
          placeholderTextColor={theme.colors["ink-low"]}
          returnKeyType="go"
          value={value}
          onChangeText={setValue}
          onSubmitEditing={go}
          className={cn("min-h-[44px] flex-1 rounded-control border border-line-high bg-surface-1 px-3 text-ink-high", FOCUS_RING)}
          style={textStyle("mono", { step: appearance.textStep, font: appearance.font })}
        />
        <Pressable accessibilityRole="button" onPress={go} className={cn("min-h-[44px] justify-center rounded-control border border-line-high bg-surface-1 px-4 active:bg-surface-2 web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]", FOCUS_RING)}>
          <Text variant="body-strong">{UI_WORDS["handle.open"]}</Text>
        </Pressable>
      </View>
      {error ? (
        <View accessibilityRole="alert" className="flex-row items-start gap-2">
          <View className="pt-[2px]">
            <Icon name="error" size={16} tone="danger" />
          </View>
          <Text variant="meta" tone="danger" className="shrink">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
```

### Replace `apps/app/src/components/SettingsNav.tsx` (whole file)

```tsx
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import { CASES_WORDS } from "@/lib/moderation-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";

export type SettingsPage = "security" | "privacy" | "profile" | "account" | "cases";

const PAGES: { page: SettingsPage; label: string }[] = [
  { page: "security", label: "Security" },
  { page: "privacy", label: "Privacy" },
  { page: "profile", label: "Profile" },
  { page: "account", label: "Account" },
  // The decisions about the account and the reports it sent (3c design, section 9); its screens are the folder settings/cases.
  { page: "cases", label: CASES_WORDS.nav },
];

/**
 * The row of links between the settings screens, shown by every one of them under its title. Each
 * link is a real anchor (expo-router's Link), so the keyboard can follow it. The screen names itself
 * through `current` instead of the row asking the router for the path, which also lets a test render
 * the row on its own.
 *
 * On the tokens (UI design, sections 4.8 and 7.1): each link a 44 px pill that wraps rather than clipping its word, the
 * current one in the accent wash with its label in body-strong and an accent underline beneath it, a shape mark that
 * does not rely on the colour; the others ink-medium, with the hover wash under a fine pointer.
 */
export function SettingsNav({ current }: { current: SettingsPage }) {
  return (
    <View role="navigation" aria-label="Settings" className="mt-3 flex-row flex-wrap gap-1">
      {PAGES.map(({ page, label }) => (
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

### Replace `apps/app/src/components/StandingBanner.tsx` (whole file)

```tsx
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { AccountStanding } from "@korbat/contracts";
import { bannerSentences, STANDING_TEXTS } from "@/lib/standing";
import { cn } from "@/theme/cn";
import { Icon } from "./kit/Icon";
import { FOCUS_RING } from "./kit/interaction";
import { Text, type Tone } from "./kit/Text";

/** One of the banner's buttons: a link to the screen where the person acts, outlined in the banner's own ink. */
function BannerLink({ label, href, tone, border }: { label: string; href: string; tone: Tone; border: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className={cn("min-h-[44px] justify-center rounded-control border px-3 active:opacity-70", border, FOCUS_RING)}>
        <Text variant="body-strong" tone={tone}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/**
 * The banner above every signed-in screen while /me's standing holds a measure (3e design, section 9.1). It cannot be
 * dismissed, so a deadline is never out of sight. It is a region labelled "Your account's standing" whose first sentence
 * is a level-2 header; amber (a start not fixed, announced, held by a reply) and red (running) repeat what the words say
 * and are never the only signal. Its buttons, each while it applies: Read the decision, Reply (while no reply was sent),
 * Appeal (on the decision's screen, while the appeal is open), Export my data and Delete account.
 *
 * On the tokens (UI design, section 4.8): the review wash before the start and the restricted wash while it runs, with
 * the status's icon (Clock, or EyeOff) at the start of the heading, so the state reads without its colour too.
 */
export function StandingBanner({ standing }: { standing: AccountStanding | null }) {
  const measure = standing?.measure ?? null;
  const sentences = bannerSentences(standing);
  if (measure === null || sentences === null) return null;
  const [first, ...rest] = sentences;
  const decision = `/settings/cases/${measure.decisionId}`;
  const running = measure.state === "running";
  const tone = measure.state === "running" ? "border-restricted-ink/40 bg-restricted-wash" : "border-review-ink/40 bg-review-wash";
  const ink: Tone = running ? "restricted-on-wash" : "review-on-wash";
  // The buttons' outline is the banner's own ink, a control's boundary at well over 3:1 on the wash (section 4.2), and
  // CanvasText under forced colours.
  const border = cn(running ? "border-restricted-on-wash" : "border-review-on-wash", "web:forced-colors:border-[color:CanvasText]");
  return (
    <View role="region" aria-label={STANDING_TEXTS.banner.label} className={cn("gap-2 border-b px-4 py-3 web:forced-colors:border-[color:CanvasText]", tone)}>
      <View className="flex-row items-start gap-2">
        <View className="pt-[3px]">
          <Icon name={running ? "restricted" : "review"} size={16} tone={ink} />
        </View>
        <Text as="h2" variant="body-strong" tone={ink} className="shrink">
          {first}
        </Text>
      </View>
      {rest.map((sentence) => (
        <Text key={sentence} tone={ink}>
          {sentence}
        </Text>
      ))}
      <View className="mt-1 flex-row flex-wrap gap-2">
        <BannerLink label={STANDING_TEXTS.banner.read} href={decision} tone={ink} border={border} />
        {measure.replyOpen ? <BannerLink label={STANDING_TEXTS.banner.reply} href={`${decision}/reply`} tone={ink} border={border} /> : null}
        {measure.appealUntil !== null && !measure.appealPending ? <BannerLink label={STANDING_TEXTS.banner.appeal} href={decision} tone={ink} border={border} /> : null}
        <BannerLink label={STANDING_TEXTS.banner.export} href="/settings/account" tone={ink} border={border} />
        <BannerLink label={STANDING_TEXTS.banner.delete} href="/settings/account" tone={ink} border={border} />
      </View>
    </View>
  );
}
```

### Replace `apps/app/src/components/kit/EmptyState.tsx` (whole file)

```tsx
import { View } from "react-native";
import type { Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { Button, TextLink } from "@/components/ui";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * What a screen shows when it has nothing to show (UI design, section 6.12): what it will hold and what to do next. The
 * title is a level-2 heading in the display face, under the screen's own title; the body is the screen's existing empty
 * sentence, word for word; one action at most, a link where it leads somewhere and a button where it does something
 * here.
 */
export type EmptyAction = { label: string; href: Href } | { label: string; onPress: () => void };

export function EmptyState({ icon, title, body, action, level = 2 }: { icon?: IconName; title: string; body?: string; action?: EmptyAction; level?: 1 | 2 }) {
  return (
    <View className="items-center gap-3 px-6 py-12">
      {icon !== undefined ? <Icon name={icon} size={24} tone="low" /> : null}
      {/* Level 1 where the empty state is the whole screen and its title the screen's one h1 (the not-found screen). */}
      <Text as={level === 1 ? "h1" : "h2"} variant="display-3" className="text-center">
        {title}
      </Text>
      {body !== undefined ? (
        <Text tone="medium" className="max-w-[440px] text-center">
          {body}
        </Text>
      ) : null}
      {action === undefined ? null : "href" in action ? <TextLink label={action.label} href={action.href} /> : <Button label={action.label} tone="secondary" full={false} onPress={action.onPress} />}
    </View>
  );
}
```

### Replace `apps/app/src/components/kit/Skeleton.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { View, type DimensionValue } from "react-native";
import Animated from "react-native-reanimated";
import { usePulse } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { VARIANTS } from "./Text";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * The shapes a list shows while its first page loads (UI design, sections 5.2 and 6.12), so loading keeps the layout and
 * never leaves the shell: surface-2 shapes that pulse between opacity 1 and 0.6, 1.6 s a cycle, until the content
 * arrives; under reduced motion they stand still at 0.8. Every part is hidden from assistive technology; a list of them
 * (Skeleton.List) says what is loading once, in a polite status. A composed row pulses as one, so a screen of rows runs
 * one animation a row rather than one a shape.
 */

/** A shape's grey; the parts are drawn still, and pulse inside a Pulse. */
const SHAPE = "bg-surface-2";

/** Its children pulse together. */
function Pulse({ children }: { children: ReactNode }) {
  const style = usePulse();
  return (
    <Animated.View aria-hidden style={style}>
      {children}
    </Animated.View>
  );
}

/** A bar of one line of text: the line's height, with the bar at 60 percent of it, as letters fill a line. */
function TextBar({ width = "100%", variant = "body" }: { width?: DimensionValue; variant?: "post" | "body" | "meta" }) {
  const line = VARIANTS[variant].line;
  return (
    <View className="justify-center" style={{ width, height: line }}>
      <View className={cn(SHAPE, "rounded-full")} style={{ height: Math.round(line * 0.6) }} />
    </View>
  );
}

function CircleShape({ size = 40 }: { size?: number }) {
  return <View className={cn(SHAPE, "rounded-full")} style={{ width: size, height: size }} />;
}

function BlockShape({ height, width = "100%" }: { height: number; width?: DimensionValue }) {
  return <View className={cn(SHAPE, "rounded-media")} style={{ width, height }} />;
}

/** A post: the avatar column, two lines, a media block on every third row (index 2, 5, 8...), and the action row. */
function PostShape({ index = 0 }: { index?: number }) {
  return (
    <View className="flex-row gap-3 border-b border-line-low px-4 py-3">
      <CircleShape size={40} />
      <View className="flex-1 gap-2">
        <TextBar width="45%" variant="meta" />
        <TextBar width="90%" variant="post" />
        <TextBar width="70%" variant="post" />
        {index % 3 === 2 ? <BlockShape height={180} /> : null}
        <View className="flex-row gap-8 pt-1">
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
        </View>
      </View>
    </View>
  );
}

/** A row of an account or settings list, as ListRow lays one out. */
function RowShape() {
  return (
    <View className="min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3">
      <CircleShape size={40} />
      <View className="flex-1 gap-1">
        <TextBar width="40%" />
        <TextBar width="25%" variant="meta" />
      </View>
    </View>
  );
}

export const Skeleton = {
  Text: (props: { width?: DimensionValue; variant?: "post" | "body" | "meta" }) => (
    <Pulse>
      <TextBar {...props} />
    </Pulse>
  ),
  Circle: (props: { size?: number }) => (
    <Pulse>
      <CircleShape {...props} />
    </Pulse>
  ),
  Block: (props: { height: number; width?: DimensionValue }) => (
    <Pulse>
      <BlockShape {...props} />
    </Pulse>
  ),
  Post: (props: { index?: number }) => (
    <Pulse>
      <PostShape {...props} />
    </Pulse>
  ),
  Row: () => (
    <Pulse>
      <RowShape />
    </Pulse>
  ),
  /**
   * A screen that is not a list, while it loads (a form, a notice's status): a heading's bar and lines of text in a
   * readable column, with the polite status "Loading", which a screen reader hears instead of the shapes.
   */
  Page: () => (
    <View className="gap-3 px-4 pt-6">
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      <Pulse>
        <View className="w-full max-w-[576px] gap-3">
          <TextBar width="55%" variant="post" />
          <TextBar width="100%" />
          <TextBar width="92%" />
          <TextBar width="70%" />
          <BlockShape height={44} />
        </View>
      </Pulse>
    </View>
  ),
  /**
   * A list's first page while it loads: `count` rows of posts or accounts, and once the polite status "Loading posts"
   * or "Loading accounts", which a screen reader hears instead of the shapes.
   */
  List: ({ kind, count = 6 }: { kind: "posts" | "accounts"; count?: number }) => (
    <View>
      <VisuallyHidden role="status">{kind === "posts" ? UI_WORDS["feed.loading"] : UI_WORDS["accounts.loading"]}</VisuallyHidden>
      {Array.from({ length: count }, (_, index) =>
        kind === "posts" ? (
          <Pulse key={index}>
            <PostShape index={index} />
          </Pulse>
        ) : (
          <Pulse key={index}>
            <RowShape />
          </Pulse>
        ),
      )}
    </View>
  ),
};
```

### Replace `apps/app/src/components/kit/VisuallyHidden.tsx` (whole file)

```tsx
import type { ReactNode } from "react";
import { Text } from "react-native";

/**
 * Words for assistive technology only (UI design, section 6.16): a post link's spoken time, the composer's count, a
 * list's loading status. The box is 1 px, clipped and taken out of the layout, so nothing on screen moves, and the text
 * keeps to one line, so a screen reader does not read a wrapped word at a time. The style is inline, which every
 * platform honours; a control that shows itself on focus (the skip link) takes VISUALLY_HIDDEN until it is focused and
 * renders visibly while focused instead.
 * `nativeID` lets a field name it in aria-describedby; `role` makes it a polite status.
 */
export const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", margin: -1, padding: 0, borderWidth: 0 } as const;

export function VisuallyHidden({ children, nativeID, role }: { children: ReactNode; nativeID?: string; role?: "status" }) {
  return (
    <Text nativeID={nativeID} role={role} aria-live={role === "status" ? "polite" : undefined} numberOfLines={1} style={VISUALLY_HIDDEN}>
      {children}
    </Text>
  );
}
```

### Replace `apps/app/src/components/social/PagedList.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { useShellScroll } from "@/lib/shell-scroll";
import type { Page } from "@/lib/social";
import { PostCard } from "./PostCard";

interface PagedListProps<T> {
  /** Must be stable (useCallback) or the list reloads on every render. */
  fetchPage: (cursor?: string) => Promise<Page<T>>;
  keyOf: (item: T) => string;
  render: (item: T, remove: (key: string) => void) => ReactElement;
  empty: string;
  header?: ReactElement;
}

/**
 * Cursor pagination with a load-more control, pull to refresh, and the same error text as the rest
 * of the app. One request is in flight at a time, and a response only lands if no newer request
 * started meanwhile, so a double tap on Load more cannot append a page twice and a refresh cannot be
 * overwritten by an older page.
 */
export function PagedList<T>({ fetchPage, keyOf, render, empty, header }: PagedListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  // The shell (lib/shell-scroll.tsx): the list's scroll hides and shows the phone's header, and the current Home item
  // pressed again brings it to its first, newest row. Task 5 moves this onto the List wrapper.
  const scroll = useShellScroll();
  const list = useRef<FlatList<T>>(null);
  useEffect(() => scroll.register({ toTop: (animated) => list.current?.scrollToOffset({ offset: 0, animated }) }), [scroll.register]);

  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const mine = ++sequence.current;
      try {
        const page = await fetchPage(after);
        if (mine !== sequence.current) return;
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        if (mine === sequence.current) setError(errorMessage(err));
      } finally {
        if (mine === sequence.current) {
          inFlight.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    // A new source (another tab, another profile) supersedes whatever the old one still has in flight.
    sequence.current++;
    inFlight.current = false;
    setLoading(true);
    void load();
  }, [load]);

  const remove = (key: string) => setItems((current) => current.filter((item) => keyOf(item) !== key));

  return (
    <FlatList
      ref={list}
      onScroll={scroll.onScroll}
      scrollEventThrottle={16}
      // On a phone the header floats over the list: its first row starts below it.
      contentContainerStyle={scroll.headerSpace > 0 ? { paddingTop: scroll.headerSpace } : undefined}
      data={items}
      keyExtractor={keyOf}
      renderItem={({ item }) => render(item, remove)}
      ListHeaderComponent={header}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      ListEmptyComponent={
        loading ? null : (
          <View className="items-center px-4 py-10">
            <Text accessibilityRole={error ? "alert" : undefined} className="text-center text-base text-zinc-400">
              {error ?? empty}
            </Text>
            {error ? (
              <Pressable accessibilityRole="button" onPress={() => void load()} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2">
                <Text className="text-sm text-zinc-200">Try again</Text>
              </Pressable>
            ) : null}
          </View>
        )
      }
      ListFooterComponent={
        <View className="items-center py-4">
          {error && items.length > 0 ? (
            <Text accessibilityRole="alert" className="mb-2 text-sm text-red-400">
              {error}
            </Text>
          ) : null}
          {cursor ? (
            <Pressable accessibilityRole="button" onPress={() => void load(cursor)} className="rounded-lg border border-zinc-700 px-4 py-2">
              <Text className="text-sm text-zinc-200">Load more</Text>
            </Pressable>
          ) : null}
        </View>
      }
    />
  );
}

const timelineKey = (item: TimelineItem) => (item.kind === "repost" ? `${item.post.id}:${item.repostedBy.id}` : item.post.id);

export function TimelineList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<TimelineItem>>; empty: string; header?: ReactElement }) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={timelineKey}
      empty={empty}
      header={header}
      render={(item, remove) => (
        <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(timelineKey(item))} />
      )}
    />
  );
}

export function PostList({ fetchPage, empty, header }: { fetchPage: (cursor?: string) => Promise<Page<PostView>>; empty: string; header?: ReactElement }) {
  return <PagedList fetchPage={fetchPage} keyOf={(post) => post.id} empty={empty} header={header} render={(post, remove) => <PostCard post={post} onDeleted={remove} />} />;
}
```

### Replace `apps/app/src/lib/session.tsx` (whole file)

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { MeResponse } from "@korbat/contracts";
import { ErrorState, isOffline } from "@/components/kit/ErrorState";
import { api, ApiError, errorMessage, setSuspendedHandler, setUnauthenticatedHandler } from "./api";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: MeResponse };

interface SessionValue {
  state: SessionState;
  /** Reloads /api/me, for example after sign-in, onboarding or sign-out. */
  refresh(): Promise<SessionState>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function loadSession(): Promise<SessionState> {
  try {
    return { status: "signed-in", me: await api("/api/me", { schema: MeResponse }) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { status: "signed-out" };
    throw err;
  }
}

/** Why /me could not be read: its sentence, and whether no answer came at all (offline, or no connection to korbat). */
interface Failure {
  message: string;
  offline: boolean;
}

/**
 * Only a 401 means signed out. Any other failure to load the session (no network, a 5xx, a limit)
 * is shown as such with a retry, instead of sending someone with a valid cookie back through sign-in.
 * It is the kit's ErrorState (UI design, section 6.12): the sentence as an alert and "Try again", or, when the request
 * got no answer (ApiError status 0), "You're offline", which tries again by itself once the browser is back online.
 */
function SessionFailure({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <View className="flex-1 justify-center bg-surface">
      <ErrorState message={failure.message} offline={failure.offline} onRetry={onRetry} />
    </View>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [failure, setFailure] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    setFailure(null);
    try {
      const next = await loadSession();
      setState(next);
      return next;
    } catch (err) {
      setFailure({ message: errorMessage(err), offline: isOffline(err) });
      return { status: "loading" } as const;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setState((current) => (current.status === "signed-in" ? { status: "signed-out" } : current)));
    return () => setUnauthenticatedHandler(null);
  }, []);

  // 3e (design, section 9.1): /me again when the app gains focus and after a refusal account_suspended, so the banner and
  // a refusal's sentence are true of the row. Quietly: a read that fails keeps what is shown, and never the failure screen.
  useEffect(() => {
    const quiet = () => {
      loadSession()
        .then(setState)
        .catch(() => undefined);
    };
    setSuspendedHandler(quiet);
    const focus = AppState.addEventListener("change", (next) => {
      if (next === "active") quiet();
    });
    return () => {
      setSuspendedHandler(null);
      focus.remove();
    };
  }, []);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  // Stable, since ErrorState waits for the browser to come back online through an effect that depends on it.
  const retry = useCallback(() => void refresh(), [refresh]);
  return <SessionContext.Provider value={value}>{failure ? <SessionFailure failure={failure} onRetry={retry} /> : children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
```

### Replace `apps/app/src/lib/social.ts` (whole file)

```ts
import {
  BlockResponse,
  EngagementResponse,
  ExplorePage,
  ExploreSettingResponse,
  ExploreStatus,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostId,
  PostPage,
  PostView,
  type ProfileEditRequest,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { z } from "zod";
import { api, apiResponse } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A page of Explore as it arrived: with the answer's Date header, the server's clock when it answered (null when the
 * answer has none), and the device's clock on arrival. The list ages the ranking by the first and counts the time on
 * screen from the second, so the device's clock is never compared with the server's.
 */
export type ExploreAnswer = ExplorePage & { date: string | null; receivedAt: number };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** The signed-in account's own profile as the editing routes answer it: the public view, since /api/me carries no bio. */
const OwnProfileResponse = z.object({ profile: ProfileView });

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(postPath(id), { schema: PostView }),
  deletePost: (id: string) => api(postPath(id), { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`${postPath(id)}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`${postPath(id)}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),
  /** Why the author's own post is in Explore or not, with no count (2c design, section 8); anyone else gets not_found. */
  exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

  following: (cursor?: string) => api(`/api/timeline/following${query(cursor)}`, { schema: TimelinePage }),
  latest: (cursor?: string) => api(`/api/timeline/latest${query(cursor)}`, { schema: TimelinePage }),
  /**
   * A page of Explore (2c design, section 8). Its cursor names the ranking it came from, which a refresh can prune
   * (explore_refreshed); signed out, the first page is all there is, and signInForMore says whether more exist. The web
   * app is served from the API's origin, so the answer's Date header can be read, and it is kept with the page; an API on
   * another origin would hide it from the browser, and the list then ages the ranking by the device's clock.
   */
  explore: async (cursor?: string): Promise<ExploreAnswer> => {
    const res = await apiResponse(`/api/timeline/explore${query(cursor)}`);
    const page = ExplorePage.parse(await res.json());
    return { ...page, date: res.headers.get("date"), receivedAt: Date.now() };
  },

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),

  /** Either field or both; the caller refreshes the session afterwards, so the shell's Profile link follows a new name. */
  editProfile: (edit: ProfileEditRequest) => api("/api/me/profile", { method: "PATCH", json: edit, schema: OwnProfileResponse }),
  /** Needs fresh authentication: the caller runs it through useReauth. */
  changeHandle: (handle: string) => api("/api/me/handle", { json: { handle }, schema: OwnProfileResponse }),
  /** "Show my posts in Explore", on or off, with no body as the other switches; the caller refreshes the session, whose /api/me carries it. */
  setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),
};

/** timeAgo lives in lib/time.ts with korbat's other times (UI design, section 8.1); its callers keep importing it from here. */
export { timeAgo } from "./time";
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
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
```

### Replace `apps/app/src/theme/fonts.web.ts` (whole file)

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
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 *    The console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and
 *    the console's site answers the app's own moderation routes with 404 itself.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, no fingerprint of it is stored while MEDIA_MATCH is off (3d Task 7), and large.webp is
 *    served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, reports the first account's post under a rule
 *     (its own list of reports shows the report undecided, and no decision is about it), downloads its
 *     export as a ZIP whose export.json ends with the moderation member holding that report, posts, and
 *     deletes itself with a code read from Mailpit and its handle typed; afterwards its profile is not
 *     found, its session is gone, and its post has left the Latest timeline.
 * 15. Signed out, a notice that the first account's post is illegal is taken through the app's site with the
 *     human check: it answers a reference and a token. The status page opens with that token and shows the
 *     post's link, undecided, and the contact as given; another token finds no notice. The receipt arrives in
 *     Mailpit under the reference, and the token in its link opens the same page with the address not yet
 *     confirmed. Nothing here decides the case: a decision needs a staff key.
 * 16. With --push (3f, the stack under the Compose profile notify): the phones' push site answers 404 itself to ntfy's
 *     /v1/config, /v1/stats and /v1/account and to a publish, and hands a topic's subscription to ntfy, which refuses
 *     it without a user (403); from inside the ntfy container, on the push network, the app's and the console's sites
 *     answer 403. The contact point's routes (/api/staff/contact) stand behind the console's two doors like the case
 *     routes, in step 2.
 * 17. 3f: a post's page (/post/<id>) answers the app's shell with 200 while the post is public and the same bytes, with
 *     the same security headers, with 404 once its author deleted it, and 404 for a post that does not exist or a
 *     malformed id: Caddy asks the API's status route, GET /api/posts/<id>/status, which answers 204 or 404 with no body.
 * 18. With --closed (3f, the stack started with APP_SITE=closed, as for a restore): every path of the app's site, the
 *     API's included, answers 503 with Caddy's one sentence, the console's site still serves its page, and nothing else
 *     runs, since nothing else can be reached through the app's site.
 * 19. 3d Task 4: GET /api/public/facts answers no-cache and names every tool off (the R1 check, the comparison with
 *     known material, the edge and the head's witness). A status code proves nothing about the two public pages, since
 *     the web export is one page and Caddy answers every unknown path with its shell: so the lead sentences of the rules
 *     page and of the transparency page are looked for in the bundle Caddy serves under /_expo/, which proves they were
 *     built in (the app's render tests prove the pages). An app test holds the two sentences here to the pages' own.
 * 20. UI Task 3: the app's page and the files it loads first, as Caddy serves them: / answers 200 with no-cache;
 *     /theme-boot.js, the script that paints the reader's theme before the bundle, answers 200 with no-cache like the
 *     page; the first font file the entry bundle names (a hashed /assets/__node_modules/@fontsource-variable/... woff2)
 *     answers 200 with public, max-age=31536000, immutable; and a post's page answers 200 while the post is public and
 *     404 for a post that does not exist (step 17 checks the rest of the post's page).
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Every run leaves its first account, by then a moderator, and one open case on that account's post, in the lane
 * that is read last, with a report and a notice that no run can decide. One network may run it five times an hour
 * and twenty times a day: its two sign-ups count against the hourly sign-up limit, and its signed-out notice
 * against the limits of reports sent without an account.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
// 3f: the phones' push site (Caddy's third site), only while the stack runs with the Compose profile notify.
const pushBase = option("push");
// 3f: the app's site closed by APP_SITE=closed (step 18).
const closed = options.includes("--closed");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] [--push <url>] [--closed] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");
/** The fflate the API depends on: the export's archive is opened with the library the API's own tests open it with. */
const { strFromU8, unzipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/** What a failed human check answers: the sign-in routes' code, and the code of a report sent signed out. */
const HUMAN_CHECK_REFUSALS = ["turnstile_failed", "human_check_failed"];

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (HUMAN_CHECK_REFUSALS.includes(result.body?.error?.code) && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type, ifNoneMatch } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** The headers a page's security rests on, which Caddy sets the same on every answer of the app's page. */
const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cache-control"];

/**
 * 3f (design, section 7.12): a post's page as a browser or a checker asks for it, through Caddy: its status, its media
 * type, its bytes and the security headers.
 */
async function postPage(postId) {
  const res = await fetch(`${base}/post/${postId}`, { headers: { accept: "text/html" } });
  const security = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, res.headers.get(name) ?? undefined]));
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()), security };
}

/**
 * 3f (step 18): the app's site closed by APP_SITE=closed answers every path, the API's included, with 503 and Caddy's
 * one sentence; the console's site is not touched.
 */
async function closedSite() {
  for (const path of ["/", `/post/${randomUUID()}`, "/api/health", "/api/me", "/api/staff/me", "/assets/none.js"]) {
    const res = await send(path);
    check(`3f: with APP_SITE=closed, ${path} answers 503 with the fixed sentence`, res.status === 503 && res.bytes.toString("utf8") === "korbat is closed for maintenance. Please come back later.", `HTTP ${res.status}`);
  }
  const page = await fetch(`${consoleBase}/`);
  await page.arrayBuffer();
  check("3f: the console's site still serves its page", page.status === 200, `HTTP ${page.status}`);
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

/**
 * 3d Task 3 (design, sections 2 row 12 and 7.4): the header of a public image, which the API builds from the contracts'
 * EDGE_CACHE: a browser's minute, an edge's five minutes, revalidated and never stale.
 */
const PUBLIC_IMAGE_CACHE = "public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0";

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");
  // 3d Task 7 (design, section 7.8; row 10): with every adapter off (MEDIA_MATCH=off) nothing is hashed: no row of
  // media_hashes exists for the upload. Read as the database's owner inside its own container, which the id alone reaches.
  const hashed = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.media_hashes where media_id = '${id}'"`);
  check("3d: with MEDIA_MATCH off no media_hashes row exists for it", hashed === "0", hashed);

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, served);
  // 3d Task 3 (design, section 7.4): the 304 of a public image carries the same header through Caddy.
  const revalidated = await send(large, { ifNoneMatch: file.headers.get("etag") ?? "" });
  check("3d: its 304 carries the same header", revalidated.status === 304 && revalidated.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${revalidated.status}, ${revalidated.headers.get("cache-control")}`);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const shown = await postPage(created.body.id);
  check("3f: the post's page answers the app's shell with 200 while the post is public", shown.status === 200 && shown.type === "text/html; charset=utf-8", `HTTP ${shown.status}, ${shown.type}`);
  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const gone = await postPage(created.body.id);
  check("3f: once deleted, its page answers the same shell with 404, never 451", gone.status === 404 && gone.bytes.equals(shown.bytes), `HTTP ${gone.status}`);
  check("3f: the same security headers on both answers", isDeepStrictEqual(gone.security, shown.security) && shown.security["content-security-policy"] !== undefined, JSON.stringify(gone.security));
  const missing = await postPage(randomUUID());
  const malformed = await postPage("not-a-post");
  check("3f: a post that does not exist and a malformed id answer 404 with the shell", missing.status === 404 && malformed.status === 404 && missing.bytes.equals(shown.bytes), `HTTP ${missing.status}, ${malformed.status}`);
  const status = await send(`/api/posts/${created.body.id}/status`);
  check("3f: the API's status route answers 404 with no body for the deleted post", status.status === 404 && status.bytes.length === 0, `HTTP ${status.status}, ${status.bytes.length} bytes`);
  const after = await send(large);
  check("its image is no longer served, and its 404 may be cached by nobody", after.status === 404 && after.headers.get("cache-control") === "no-store", `HTTP ${after.status}, ${after.headers.get("cache-control")}`);
  const unknown = await send(`/api/media/${randomUUID()}/large.webp`);
  check("3d: an image that does not exist answers 404 with no-store", unknown.status === 404 && unknown.headers.get("cache-control") === "no-store", `HTTP ${unknown.status}, ${unknown.headers.get("cache-control")}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);

  // The console's case routes (3c design, section 12) stand behind the same two doors: the overview, the queue, a case
  // and the appeals, and since account sanctions (3e design, section 12.2) the Standing screen's lists. The staff session
  // is asked for before anything of the request is read, so a case that does not exist answers like the others.
  // 3f: the contact point's list too.
  const caseRoutes = ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${randomUUID()}`, "/api/staff/appeals", "/api/staff/standing", "/api/staff/contact"];
  const answers = (list) => list.map((answer, index) => `${caseRoutes[index]}: ${answer.summary}`).join("; ");
  const casesOnApp = await Promise.all(caseRoutes.map((path) => getJson(`${base}${path}`)));
  check(
    "the app's site refuses the console's case routes itself, with 404",
    casesOnApp.every((answer) => answer.status === 404 && answer.body?.error?.code === "not_found" && answer.body.error.requestId === undefined),
    answers(casesOnApp),
  );
  const casesOnConsole = await Promise.all(caseRoutes.map((path) => getJson(`${consoleBase}${path}`)));
  check(
    "signed out, the console's site answers its case routes with 401 staff_session_required",
    casesOnConsole.every((answer) => answer.status === 401 && answer.body?.error?.code === "staff_session_required"),
    answers(casesOnConsole),
  );
  // And the other way round: the console's site proxies the staff API and nothing else, so the app's own moderation
  // routes are answered there by Caddy, never by the API.
  const appRoute = await getJson(`${consoleBase}/api/moderation/cases`);
  check("the console's site refuses the app's moderation routes itself, with 404", appRoute.status === 404 && appRoute.body?.error?.code === "not_found" && appRoute.body.error.requestId === undefined, appRoute.summary);
}

/**
 * The phones' push site (3f design, sections 5 and 12.2, with --push). Caddy hands ntfy only the two topics'
 * subscriptions: every path of ntfy's own API answers Caddy's 404 (ntfy's /v1/config and /v1/stats answer any caller
 * otherwise), and so does a publish; a subscription without a user reaches ntfy, whose deny-all answers 403. And from
 * inside the ntfy container, on the push network, the app's and the console's sites refuse the request with 403: until the
 * push site, only cloudflared could reach Caddy.
 */
async function pushSite() {
  for (const path of ["/v1/config", "/v1/stats", "/v1/account", "/v1/health", "/", "/korbat-all"]) {
    const res = await fetch(`${pushBase}${path}`);
    check(`the push site answers ${path} with 404 itself`, res.status === 404 && res.headers.get("server") === null, `HTTP ${res.status}`);
  }
  const publish = await fetch(`${pushBase}/korbat-all`, { method: "POST", body: "a publish from outside" });
  check("the push site refuses a publish with 404", publish.status === 404, `HTTP ${publish.status}`);
  const subscribe = await fetch(`${pushBase}/korbat-oncall,korbat-all/json?poll=1`);
  const refusal = await subscribe.json().catch(() => null);
  check("a subscription without a user reaches ntfy, which refuses it", subscribe.status === 403 && refusal?.code === 40301, `HTTP ${subscribe.status} ${JSON.stringify(refusal)}`);
  for (const [site, port] of [["app's", 8080], ["console's", 8090]]) {
    const answer = inside("ntfy", `wget -q -S -O /dev/null http://caddy:${port}/ 2>&1; true`);
    check(`from the push network the ${site} site answers 403`, / 403 /.test(answer), answer.split(String.fromCharCode(10))[0]);
  }
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
/** The lead sentences of /rules and /transparency (RULES_PAGE.lead and TRANSPARENCY_PAGE.lead), held to them by an app test. */
const RULES_LEAD =
  "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the day of the decision.";
const TRANSPARENCY_LEAD =
  "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a decision concerns gets its full reasons from korbat directly.";

/** Step 19 (3d Task 4): the facts of a stack with every adapter off, and the two pages' lead sentences in the bundle. */
async function publicPages() {
  const res = await fetch(`${base}/api/public/facts`);
  const facts = await res.json().catch(() => null);
  check("3d: GET /api/public/facts answers no-cache", res.status === 200 && res.headers.get("cache-control") === "no-cache", `HTTP ${res.status}, ${res.headers.get("cache-control")}`);
  check(
    "3d: the facts name every tool off: the R1 check, the comparison with known material, the edge and the witness",
    facts?.r1?.state === "off" && facts?.match?.state === "off" && facts?.edge?.on === false && facts?.witness?.on === false,
    JSON.stringify(facts),
  );
  const shell = await (await fetch(`${base}/`)).text();
  const scripts = [...shell.matchAll(/<script[^>]* src="([^"]+)"/g)].map((match) => match[1]).filter((src) => src.startsWith("/_expo/"));
  if (!check("3d: the app's shell loads its bundle from /_expo/", scripts.length > 0, `${scripts.length} scripts`)) return;
  // A minifier may write an apostrophe inside a string escaped; the sentence is looked for with it read back.
  const escapedQuote = `${String.fromCharCode(92)}'`;
  let bundle = "";
  for (const src of scripts) bundle += (await (await fetch(`${base}${src}`)).text()).replaceAll(escapedQuote, "'");
  check("3d: the rules page's lead sentence is in the bundle Caddy serves", bundle.includes(RULES_LEAD));
  check("3d: the transparency page's lead sentence is in the bundle Caddy serves", bundle.includes(TRANSPARENCY_LEAD));
}

/**
 * Step 20 (UI Task 3): the app's page, theme-boot.js, the first font the entry bundle names and a post's page, each with
 * its status and caching. `postId` is a public post's.
 */
async function appShell(postId) {
  const page = await send("/");
  check("UI: / answers the app's page with no-cache", page.status === 200 && page.headers.get("cache-control") === "no-cache", `HTTP ${page.status}, ${page.headers.get("cache-control")}`);
  const boot = await send("/theme-boot.js");
  check("UI: /theme-boot.js answers 200 with no-cache, like the page", boot.status === 200 && boot.headers.get("cache-control") === "no-cache", `HTTP ${boot.status}, ${boot.headers.get("cache-control")}`);
  const entry = /<script[^>]* src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(page.bytes.toString("utf8"))?.[1];
  if (!check("UI: the page names its entry bundle", entry !== undefined)) return;
  const bundle = (await send(entry)).bytes.toString("utf8");
  // On web Metro's require of a font yields its hashed address as a string, which the bundle carries (Task 1).
  const font = /\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2/.exec(bundle)?.[0];
  const file = font === undefined ? null : await send(font);
  check(
    "UI: the first font the bundle names answers 200, public, max-age=31536000, immutable",
    file?.status === 200 && file.headers.get("cache-control") === "public, max-age=31536000, immutable",
    font === undefined ? "no font in the bundle" : `${font}: HTTP ${file?.status}, ${file?.headers.get("cache-control")}`,
  );
  const shown = await postPage(postId);
  const missing = await postPage(randomUUID());
  check("UI: a public post's page answers 200 and a missing post's 404", shown.status === 200 && missing.status === 404, `HTTP ${shown.status}, ${missing.status}`);
}

async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/** A notice's public reference: N- and ten base32 characters. */
const NOTICE_REF = /^N-[A-Z2-7]{10}$/;

/** One line about a report's items as a status answer or a list gives them: how many, and each one's link and outcome. */
const itemsSummary = (items) => (Array.isArray(items) ? `${items.length} item(s): ${items.map((item) => `${item?.link} -> ${item?.outcome}`).join(", ")}` : "no items");
/** Whether these are exactly one item, about this post by its korbat link, with no outcome shown yet. */
const onePostUndecided = (items, postId) => Array.isArray(items) && items.length === 1 && typeof items[0]?.link === "string" && items[0].link.endsWith(`/post/${postId}`) && items[0].outcome === null;

/**
 * A report under a rule from a signed-in account (3c design, sections 7.1, 7.6 and 12), about another account's post:
 * it needs no human check and answers a reference without a token, since the account's own list follows it. That list
 * then shows the report with its one item undecided, and the account's list of decisions is empty. Answers the
 * reference, or null when the report was not taken.
 */
async function signedInReport(postId, token) {
  const reported = await api("/api/notices", { json: { ground: "rule", ruleId: "R6", targets: [{ kind: "post", id: postId }], explanation: "Sent by the smoke test." }, token });
  const ref = reported.body?.ref;
  if (!check("a signed-in report under a rule is taken: a reference and no token", reported.status === 201 && NOTICE_REF.test(ref ?? "") && reported.body.token === undefined, reported.summary)) return null;
  const reports = await api("/api/moderation/reports", { token });
  const mine = reports.body?.reports?.[0];
  check("the account's list of reports shows it, undecided", reports.status === 200 && mine?.ref === ref && onePostUndecided(mine.items, postId), `${reports.summary}, ${itemsSummary(mine?.items)}`);
  const cases = await api("/api/moderation/cases", { token });
  check("no decision is about the account", cases.status === 200 && Array.isArray(cases.body?.decisions) && cases.body.decisions.length === 0 && cases.body.nextCursor === null, cases.summary);
  return ref;
}

/**
 * The export's moderation member (3c design, section 7.11), read from the archive itself: export.json's last member,
 * with no decision about this account and the one report it sent, under its reference and its ground, its item
 * undecided.
 */
function exportedModeration(archive, reportRef, postId) {
  let document = null;
  try {
    document = JSON.parse(strFromU8(unzipSync(new Uint8Array(archive))["export.json"]));
  } catch {
    document = null;
  }
  const moderation = document?.moderation;
  const last = document === null ? "export.json could not be read" : `last member ${Object.keys(document).at(-1)}`;
  if (!check("export.json ends with the moderation member: its decisions and its reports", document !== null && Object.keys(document).at(-1) === "moderation" && Array.isArray(moderation?.decisions) && Array.isArray(moderation?.reports), last)) return;
  const own = moderation.reports[0];
  check(
    "the export holds no decision and the account's one report, undecided",
    reportRef !== null && moderation.decisions.length === 0 && moderation.reports.length === 1 && own?.ref === reportRef && own.ground === "rule" && own.ruleId === "R6" && onePostUndecided(own.items, postId) && own.items[0].reexaminationOpen === null,
    `${moderation.decisions.length} decision(s), ${moderation.reports.length} report(s), ${itemsSummary(own?.items)}`,
  );
}

/** The newest message to `to` in Mailpit whose subject is `subject`, read whole; null when none arrives within half a minute. */
async function mailTo(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const found = list.messages?.find((message) => message.Subject === subject);
    if (found) return (await fetch(`${mailpit}/api/v1/message/${found.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * A notice sent signed out, through the app's site (3c design, sections 7.1, 7.2 and 12): an Article 16 notice that the
 * first account's post is illegal, in a category of the lane that is read last, so that no urgent alert goes out, with a
 * name and an address. The human check is Turnstile's, with the test secret that passes any token. It answers a
 * reference and the notice's own token, which opens the status page; the receipt goes to the address at once, and the
 * token in its link opens the same page and shows what korbat knows of the address. A token travels in a POST's body,
 * never in an address.
 */
async function signedOutNotice(postId) {
  const notifier = `notifier-${randomUUID()}@korbat.local`;
  const notice = {
    ground: "illegal",
    category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    explanation: "Sent by the smoke test: nothing is wrong with this post.",
    bonaFide: true,
    name: "Smoke Test",
    email: notifier,
    targets: [{ kind: "post", id: postId }],
    turnstileToken: TURNSTILE_TOKEN,
  };
  const sent = await withTurnstile("/api/notices", notice);
  const ref = sent.body?.ref;
  const token = sent.body?.token;
  if (!check("signed out, a notice of illegality is taken through the app's site: a reference and a token", sent.status === 201 && NOTICE_REF.test(ref ?? "") && typeof token === "string" && token.length === 43, sent.summary)) return;

  const status = await api("/api/notices/status", { json: { ref, token } });
  check("its status page opens with the token and shows the post's link, undecided", status.status === 200 && status.body?.ref === ref && onePostUndecided(status.body.items, postId), `${status.summary}, ${itemsSummary(status.body?.items)}`);
  // Opened with the notice's own token, the page says that a contact was given and nothing of what korbat knows about the address.
  const contact = status.body?.contact;
  check("the page says that a contact was given, and no more", contact?.given === true && contact.confirmed === null && contact.stopped === null, JSON.stringify(contact ?? null));
  const other = await api("/api/notices/status", { json: { ref, token: randomBytes(32).toString("base64url") } });
  check("another token finds no notice", other.status === 404 && other.body?.error?.code === "notice_not_found", other.summary);

  const receipt = await mailTo(notifier, `korbat received your report ${ref}`);
  if (!check("the receipt arrives in Mailpit under the notice's reference", receipt !== null && typeof receipt.Text === "string" && receipt.Text.includes(ref), receipt === null ? "no receipt within 30 s" : "a receipt without the reference")) return;
  // The mail's link carries the contact's mail token in its fragment, which no server log sees.
  const mailToken = /[/]notice[/]N-[A-Z2-7]{10}#t=([A-Za-z0-9_-]{43})/.exec(receipt.Text)?.[1];
  if (!check("the receipt links to the notice's page with a token of its own", typeof mailToken === "string" && mailToken !== token)) return;
  const byMail = await api("/api/notices/status", { json: { ref, token: mailToken } });
  const known = byMail.body?.contact;
  check(
    "the mail's token opens the same page, with the address not yet confirmed and not stopped",
    byMail.status === 200 && byMail.body?.ref === ref && onePostUndecided(byMail.body.items, postId) && known?.given === true && known.confirmed === false && known.stopped === false,
    `${byMail.summary}, ${JSON.stringify(known ?? null)}`,
  );
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session. On its
 * way it reports the first account's post, and its export shows that report.
 */
async function accountLifecycle(reportedPostId) {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const reportRef = await signedInReport(reportedPostId, token);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  if (zip) exportedModeration(exported.bytes, reportRef, reportedPostId);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

async function main() {
  if (closed) return closedSite();
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  if (pushBase) await pushSite();
  await explore();
  await publicPages();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);
  // Account sanctions (3e design, section 12.2): an onboarded account's standing, read fresh, holds no strike, no
  // measure, no restriction of reporting and no retired handle. A suspension needs a staff key: the walk-through's.
  const noStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
  check("/api/me carries the new account's standing: no strike, no measure, no restriction", isDeepStrictEqual(me.body?.standing, noStanding), JSON.stringify(me.body?.standing));

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);
  await appShell(created.body?.id);

  await images(token);
  if (worstCase) await worstCaseImages(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  // The post both the signed-in report and the signed-out notice name: the first account's, which is still there.
  const reportedPostId = created.body?.id;
  if (!check("the first account's post can be reported", typeof reportedPostId === "string")) return;
  await accountLifecycle(reportedPostId);
  await signedOutNotice(reportedPostId);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
// With --closed the run is a few requests long, and Node on Windows aborts (a libuv assertion, exit 127) when the process
// is ended while fetch's idle connections are still closing. So that run sets its code and ends when they have closed,
// a few seconds later; the full run, which holds other handles open, ends here as before.
if (closed) process.exitCode = failures === 0 ? 0 : 1;
else process.exit(failures === 0 ? 0 : 1);
```

## Step 4: delete `apps/app/src/components/PopularNow.tsx`

```bash
git rm -q "apps/app/src/components/PopularNow.tsx"
```

Expected: no output.

## Step 5: verify: install

```bash
pnpm install --config.package-import-method=copy
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 2.6s using pnpm v10.30.0
```

## Step 6: verify: frozen-install

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

## Step 7: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
2 new package versions since HEAD; all at least 7 days old
```

## Step 8: verify: typecheck

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

## Step 9: verify: test

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
apps/app test:       Tests  466 passed (466)
apps/admin test:       Tests  584 passed (584)
apps/api test:       Tests  943 passed | 1772 skipped (2715)
```

## Step 10: verify: export

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

## Step 11: verify: app-browser

```bash
pnpm --filter @korbat/app test:browser
```

Expected output contains:

- `Tests  17 passed (17)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  17 passed (17)
```

## Step 12: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 13: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 14: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 15: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 16: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 17: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 47 seconds (healthy)
```

## Step 18: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/index.ts`
- `apps/app/package.json`
- `apps/app/src/app/+not-found.tsx`
- `apps/app/src/app/_layout.tsx`
- `apps/app/src/app/bookmarks.tsx`
- `apps/app/src/app/notice/[ref].tsx`
- `apps/app/src/app/report.tsx`
- `apps/app/src/app/u/[handle]/followers.tsx`
- `apps/app/src/app/u/[handle]/following.tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/AboutCard.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/GestureRoot.tsx`
- `apps/app/src/components/GestureRoot.web.tsx`
- `apps/app/src/components/HandleBox.tsx`
- `apps/app/src/components/PopularNow.tsx`
- `apps/app/src/components/ScreenHeader.tsx`
- `apps/app/src/components/SettingsNav.tsx`
- `apps/app/src/components/StandingBanner.tsx`
- `apps/app/src/components/ToastCard.tsx`
- `apps/app/src/components/kit/EmptyState.tsx`
- `apps/app/src/components/kit/Skeleton.tsx`
- `apps/app/src/components/kit/VisuallyHidden.tsx`
- `apps/app/src/components/social/PagedList.tsx`
- `apps/app/src/components/toast.tsx`
- `apps/app/src/components/toast.web.tsx`
- `apps/app/src/lib/page-title.tsx`
- `apps/app/src/lib/session.tsx`
- `apps/app/src/lib/shell-scroll.tsx`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/toast-rules.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/src/lib/zod-jitless.ts`
- `apps/app/src/theme/fonts.web.ts`
- `apps/app/test/announced.test.tsx`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/caddyfile.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/browser/server.ts`
- `apps/app/test/browser/watch.ts`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/hidden-media.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/shell.test.tsx`
- `apps/app/vitest.browser.config.mts`
- `pnpm-lock.yaml`
- `scripts/smoke-auth-stack.mjs`

`git rm` stages the deletion, so `apps/app/src/components/PopularNow.tsx` shows with a `D` in the first column. That line is expected.

## Step 19: commit

```bash
git add -A
git commit -q -m "feat(app): the shell, the navigation and the app's browser check: AppShell lays out a phone's tab bar, a tablet's 80 px rail with the k and from 1280 px the full nav with the wordmark, one aria-current item marked by an accent-wash pill, a 3 px accent bar and the strong stroke; a skip link to the main column, a polite offline banner and, from 1024 px, About korbat with the handle box and How korbat works where Popular now was; ScreenHeader's title slides away on a phone as the list scrolls down and returns on a scroll up, staying under reduced motion, and the current Home item brings the feed to its newest post; toast.show() over sonner and sonner-native; usePageTitle(), a not-found screen and an error boundary in the public frame; SettingsNav, StandingBanner, HandleBox and SessionFailure on the tokens; five screens load inside the shell; zod jitless from the app's entry; the browser check builds the export and walks it in Chromium in 17 steps; the smoke test loads the page, theme-boot.js, a font and a post's page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the shell, the navigation and the app's browser check: AppShell lays out a phone's tab bar, a tablet's 80 px rail with the k and from 1280 px the full nav with the wordmark, one aria-current item marked by an accent-wash pill, a 3 px accent bar and the strong stroke; a skip link to the main column, a polite offline banner and, from 1024 px, About korbat with the handle box and How korbat works where Popular now was; ScreenHeader's title slides away on a phone as the list scrolls down and returns on a scroll up, staying under reduced motion, and the current Home item brings the feed to its newest post; toast.show() over sonner and sonner-native; usePageTitle(), a not-found screen and an error boundary in the public frame; SettingsNav, StandingBanner, HandleBox and SessionFailure on the tokens; five screens load inside the shell; zod jitless from the app's entry; the browser check builds the export and walks it in Chromium in 17 steps; the smoke test loads the page, theme-boot.js, a font and a post's page`.

## Report format (mandatory)

```text
TASK 3 REPORT
Files written: <count, expected 45>
Failing-test step (the error line): <paste>
Verify "install": <paste the expected lines as printed>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "app-browser": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
