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
  // 2d (decision 24, 10.1): Activity second; the phone's tab bar keeps four items and reaches Settings from the profile.
  const SIGNED_IN_ITEMS: Record<LayoutKind, string[]> = {
    phone: ["/", "/activity", "/bookmarks", "/u/ada"],
    tablet: ["/", "/activity", "/bookmarks", "/u/ada", "/settings"],
    desktop: ["/", "/activity", "/bookmarks", "/u/ada", "/settings"],
    wide: ["/", "/activity", "/bookmarks", "/u/ada", "/settings"],
  };

  test("at every layout the nav is a landmark named Main whose items are real anchors, in today's order and hrefs, with one current item", () => {
    for (const kind of KINDS) {
      shell.kind = kind;
      shell.state = signedIn();
      shell.pathname = "/bookmarks";
      const out = html(<AppShell>{null}</AppShell>);
      expect(out, kind).toContain(`data-layout="${kind}"`);
      const nav = inside(out, /<nav\b[^>]*aria-label="Main"[^>]*>/);
      expect(nav, kind).not.toBe("");
      expect(anchors(nav).map(hrefOf), kind).toEqual(SIGNED_IN_ITEMS[kind]);
      const current = anchors(nav).filter((tag) => tag.includes('aria-current="page"'));
      expect(current, kind).toHaveLength(1);
      expect(current[0], kind).toContain('href="/bookmarks"');
      // The current item's icon is drawn at the strong stroke, a shape cue beside its colour; the others at the usual one.
      // (Its pill and bar are classes, which a static render does not draw: the browser check measures them.)
      const items = nav.split(/(?=<a\b)/).slice(1);
      expect(items.filter((item) => item.includes('stroke-width="2.25"')).map((item) => hrefOf(item)), kind).toEqual(["/bookmarks"]);
      expect(items.filter((item) => item.includes('stroke-width="1.75"')).map((item) => hrefOf(item)), kind).toEqual(SIGNED_IN_ITEMS[kind].filter((href) => href !== "/bookmarks"));
      expect(textOf(nav), kind).toContain(UI_WORDS["nav.bookmarks"]);
    }
  });

  test("2d (decision 4, 10.1): Activity's item is its icon and its label alone, at every layout and on every page, Activity's own included", () => {
    for (const kind of KINDS) {
      for (const pathname of ["/", "/activity", "/settings/activity"]) {
        shell.kind = kind;
        shell.state = signedIn();
        shell.pathname = pathname;
        const nav = inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/);
        const item = nav.split(/(?=<a\b)/).find((part) => hrefOf(part) === "/activity") ?? "";
        expect(item, `${kind} ${pathname}`).toContain("lucide-bell");
        // Nothing counts or badges: the item says its label and nothing else, no number, no dot, no other word.
        expect(textOf(inside(item, /<a\b[^>]*>/)), `${kind} ${pathname}`).toBe(UI_WORDS["nav.activity"]);
        expect(item, `${kind} ${pathname}`).not.toMatch(/aria-label=|aria-describedby=/);
        expect(nav.match(/<a\b/g), `${kind} ${pathname}`).toHaveLength(SIGNED_IN_ITEMS[kind].length);
      }
    }
  });

  test("on a phone the settings pages mark no nav item current: Settings is reached from the profile, and the settings row says where the reader is", () => {
    shell.kind = "phone";
    shell.state = signedIn();
    shell.pathname = "/settings/activity";
    const nav = inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/);
    expect(anchors(nav).filter((tag) => tag.includes('aria-current="page"'))).toEqual([]);
    shell.pathname = "/activity";
    expect(anchors(inside(html(<AppShell>{null}</AppShell>), /<nav\b[^>]*>/)).filter((tag) => tag.includes('aria-current="page"')).map(hrefOf)).toEqual(["/activity"]);
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
