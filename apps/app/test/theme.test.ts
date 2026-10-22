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
