# korbat interface and experience (UI) — Task 2 of 10: Primitives, haptics, motion and the test mocks: the owned components of section 6 that screens build on.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 2 of ten in korbat's UI sub-project (interface and experience), the second of the batch of Tasks 1 to 3, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Task 1's tokens, Text and Icon. It follows sections 5.1 to 5.3 (useMotion(), the press, hover, skeleton and spinner rows, haptics), 6.1 to 6.5, 6.11 to 6.13 and 6.16 (the kit and ui.tsx), 7.3 (PublicFrame), 8.1 and 8.11 (lib/time.ts, ui-words.ts and the offline words), 1.5 and 10 (the bare-string scan and the outline rule) and 12.1 to 12.2 (test/setup.ts). Task 3 builds the shell, the toasts and the app's browser check on these primitives; Sheet and Menu come with Task 4 and Tabs with Task 5.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. The `install` step runs `pnpm install` with that floor in force, and the `lockfile-age` step then proves that every newly locked version is at least 7 days old. `pnpm-lock.yaml` is written by the install, never by hand. Never edit `pnpm-workspace.yaml` or `.npmrc`, and never add a package this task does not name.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the design language in code and the theme from the first frame: src/theme/tokens.ts holds Light, Dim and Dark (ink and paper with one violet accent) and TEXT_PAIRS, every pair at its WCAG minimum in every theme, mirrored as --k-<token> triplets in global.css and mapped by tailwind.config.js with five radii; ThemeProvider follows the system under System, sets the html class, color-scheme and theme-color on web and NativeWind's vars() on native, and useTheme() works without it; public/theme-boot.js paints the stored theme before the bundle; lib/appearance.ts keeps the reader's choices under korbat.appearance and survives bad records and refused storage; Fraunces, Atkinson Hyperlegible Next and Mono bundled with their licences; kit/Text with ten variants and the text step in rem; kit/Icon over Lucide 1.55.0; the human check follows the theme; the web export's baseline recorded`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/02-primitives-haptics-motion-mocks.md 1
```

Expected: 20 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/format.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { compactCount } from "../src/lib/format";
import * as social from "../src/lib/social";
import { dayTime, fullDate, postedWhen, timeAgo } from "../src/lib/time";
import { UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The numbers and times every screen prints (UI design, sections 6.3 and 8.1): compactCount() for the counts beside
 * icons, and lib/time.ts, which holds timeAgo (moved from lib/social.ts with its output unchanged) and the new spoken
 * and full forms. The unit config sets no time zone, so every helper that prints a clock time takes the zone as a
 * parameter, and the tests pass one.
 */
describe("compactCount", () => {
  test("prints section 6.3's examples", () => {
    expect(compactCount(1)).toBe("1");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1_200)).toBe("1.2K");
    expect(compactCount(12_000)).toBe("12K");
    expect(compactCount(1_200_000)).toBe("1.2M");
  });

  test("truncates, so it never shows more than the count", () => {
    expect(compactCount(1_299)).toBe("1.2K");
    expect(compactCount(1_999)).toBe("1.9K");
    expect(compactCount(9_999)).toBe("9.9K");
    expect(compactCount(12_999)).toBe("12K");
    expect(compactCount(999_999)).toBe("999K");
    expect(compactCount(1_999_999)).toBe("1.9M");
    expect(compactCount(25_999_999)).toBe("25M");
  });

  test("drops a tenth of zero, and keeps small and odd inputs readable", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(1_000)).toBe("1K");
    expect(compactCount(1_049)).toBe("1K");
    expect(compactCount(10_000)).toBe("10K");
    expect(compactCount(1_000_000)).toBe("1M");
    expect(compactCount(2_000_000_000)).toBe("2B");
    expect(compactCount(12.7)).toBe("12");
    expect(compactCount(-3)).toBe("0");
  });
});

describe("lib/time.ts", () => {
  const NOW = Date.parse("2026-10-21T18:40:00.000Z");
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  test("timeAgo keeps its output, and lib/social.ts still exports the same function", () => {
    expect(social.timeAgo).toBe(timeAgo);
    expect(timeAgo(ago(10), NOW)).toBe("just now");
    expect(timeAgo(ago(5 * 60), NOW)).toBe("5m");
    expect(timeAgo(ago(3 * 3600), NOW)).toBe("3h");
    expect(timeAgo(ago(2 * 86_400), NOW)).toBe("2d");
    expect(timeAgo(ago(8 * 86_400), NOW)).toBe(new Date(ago(8 * 86_400)).toLocaleDateString());
    // A time a little ahead of this device's clock reads as now, not as a negative age.
    expect(timeAgo(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });

  test("postedWhen is the spoken form, and always contains the short time it is spoken for", () => {
    expect(postedWhen(ago(10), NOW)).toBe("posted just now");
    expect(postedWhen(ago(3 * 3600), NOW)).toBe("3h ago");
    expect(postedWhen(ago(5 * 60), NOW)).toBe("5m ago");
    const old = ago(30 * 86_400);
    expect(postedWhen(old, NOW)).toBe(`on ${new Date(old).toLocaleDateString()}`);
    for (const seconds of [0, 59, 60, 3599, 3600, 86_399, 86_400, 7 * 86_400 - 1, 7 * 86_400, 400 * 86_400]) {
      expect(postedWhen(ago(seconds), NOW)).toContain(timeAgo(ago(seconds), NOW));
    }
  });

  test("dayTime and fullDate print the day, the date and the minute in the zone they are given", () => {
    const at = "2026-10-21T18:40:00.000Z";
    expect(dayTime(at, "UTC")).toBe("Wed 18:40");
    expect(fullDate(at, "UTC")).toBe("21 Oct 2026, 18:40");
    // Tirana is two hours ahead in October: the same instant is another clock time there.
    expect(dayTime(at, "Europe/Tirane")).toBe("Wed 20:40");
    expect(fullDate("2026-10-20T23:30:00.000Z", "Europe/Tirane")).toBe("21 Oct 2026, 01:30");
    // Minutes and hours keep two digits, on a 24-hour clock.
    expect(dayTime("2026-10-18T07:05:00.000Z", "UTC")).toBe("Sun 07:05");
  });
});

describe("ui-words.ts", () => {
  test("fills a template's names and leaves the rest of the sentence as it is", () => {
    expect(fill(UI_WORDS["time.posted.ago"], { short: "3h" })).toBe("3h ago");
    expect(fill("{a} and {b}, {a}", { a: 1, b: "two" })).toBe("1 and two, 1");
  });

  test("Button's busy label ends in one ellipsis character, as today's did", () => {
    expect(UI_WORDS["button.busy"]).toBe(`Please wait${String.fromCharCode(0x2026)}`);
  });
});
```

### Create `apps/app/test/haptics.test.ts`

```ts
import * as Haptics from "expo-haptics";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { HAPTIC_INTENTS, hapticFor, playHaptic, useHaptics, type HapticIntent } from "../src/lib/haptics";

/**
 * Haptics by intent (UI design, section 5.3). The mapping is a pure function of the intent and the platform, so the
 * table's iOS and Android columns are checked here although react-native-web says "web"; expo-haptics is mocked in
 * test/setup.ts with its 57.0.3 enum values.
 */
const calls = () => ({
  impact: vi.mocked(Haptics.impactAsync).mock.calls,
  notification: vi.mocked(Haptics.notificationAsync).mock.calls,
  selection: vi.mocked(Haptics.selectionAsync).mock.calls,
  android: vi.mocked(Haptics.performAndroidHapticsAsync).mock.calls,
});
const none = { impact: [], notification: [], selection: [], android: [] };

beforeEach(() => {
  vi.clearAllMocks();
  setAppearance(DEFAULT_APPEARANCE);
});
afterEach(() => setAppearance(DEFAULT_APPEARANCE));

describe("the mapping", () => {
  test("names section 5.3's seven intents", () => {
    expect([...HAPTIC_INTENTS]).toEqual(["toggleOn", "toggleOff", "selection", "threshold", "success", "warning", "error"]);
  });

  test("iOS: impacts, the selection tick and notifications; turning off is silent", () => {
    expect(hapticFor("toggleOn", "ios")).toEqual({ kind: "impact", style: Haptics.ImpactFeedbackStyle.Light });
    expect(hapticFor("toggleOff", "ios")).toBeNull();
    expect(hapticFor("selection", "ios")).toEqual({ kind: "selection" });
    expect(hapticFor("threshold", "ios")).toEqual({ kind: "impact", style: Haptics.ImpactFeedbackStyle.Medium });
    expect(hapticFor("success", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Success });
    expect(hapticFor("warning", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Warning });
    expect(hapticFor("error", "ios")).toEqual({ kind: "notification", type: Haptics.NotificationFeedbackType.Error });
  });

  test("Android: the system's own constants through performAndroidHapticsAsync", () => {
    const android = (intent: HapticIntent) => hapticFor(intent, "android");
    expect(android("toggleOn")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Toggle_On });
    expect(android("toggleOff")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Toggle_Off });
    expect(android("selection")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Segment_Tick });
    // expo-haptics 57.0.3 has no Gesture_Threshold_Activate; Long_Press is the firm tick Android plays when a press arms.
    expect(android("threshold")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Long_Press });
    expect(android("success")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Confirm });
    expect(android("warning")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Reject });
    expect(android("error")).toEqual({ kind: "android", type: Haptics.AndroidHaptics.Reject });
  });

  test("the web has none, nor does any other platform", () => {
    for (const intent of HAPTIC_INTENTS) {
      expect(hapticFor(intent, "web"), intent).toBeNull();
      expect(hapticFor(intent, "windows"), intent).toBeNull();
    }
  });
});

describe("playing", () => {
  test("plays the mapped call when haptics are on", () => {
    playHaptic("toggleOn", "ios", true);
    playHaptic("success", "ios", true);
    playHaptic("selection", "ios", true);
    playHaptic("error", "android", true);
    expect(calls()).toEqual({
      impact: [[Haptics.ImpactFeedbackStyle.Light]],
      notification: [[Haptics.NotificationFeedbackType.Success]],
      selection: [[]],
      android: [[Haptics.AndroidHaptics.Reject]],
    });
  });

  test("the off switch silences every intent on every platform", () => {
    for (const intent of HAPTIC_INTENTS) for (const platform of ["ios", "android"] as const) playHaptic(intent, platform, false);
    expect(calls()).toEqual(none);
  });

  test("on the web every intent is a no-op", () => {
    for (const intent of HAPTIC_INTENTS) playHaptic(intent, "web", true);
    expect(calls()).toEqual(none);
  });

  test("a refused call is swallowed, since a device without haptics is not an error", async () => {
    vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error("unavailable"));
    expect(() => playHaptic("toggleOn", "ios", true)).not.toThrow();
    await Promise.resolve();
  });
});

describe("useHaptics()", () => {
  /** The function useHaptics() gives a component, taken out of a static render. */
  function hook(): (intent: HapticIntent) => void {
    let haptic: ((intent: HapticIntent) => void) | undefined;
    const Probe = () => {
      haptic = useHaptics();
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    if (!haptic) throw new Error("useHaptics() gave nothing");
    return haptic;
  }

  test("is a no-op here, where react-native-web says web, with haptics on or off", () => {
    hook()("toggleOn");
    setAppearance({ haptics: false });
    hook()("success");
    expect(calls()).toEqual(none);
  });
});
```

### Create `apps/app/test/kit.test.tsx`

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
```

### Create `apps/app/test/motion.test.ts`

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { useMotion, type Motion } from "../src/lib/motion";
import { MOTION } from "../src/theme/motion";

/**
 * useMotion() (UI design, section 5.1): one hook gives every component the motion values and whether to reduce them,
 * so no component reads either source on its own. Reduced motion has two sources, the operating system (Reanimated's
 * useReducedMotion(), mocked in test/setup.ts as a vi.fn) and the reader's own "Reduce motion: Always".
 */
function motion(): Motion {
  let found: Motion | undefined;
  const Probe = () => {
    found = useMotion();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  if (!found) throw new Error("useMotion() gave nothing");
  return found;
}

afterEach(() => {
  vi.mocked(useReducedMotion).mockReturnValue(false);
  setAppearance(DEFAULT_APPEARANCE);
});

describe("the reduce sources", () => {
  test("neither source: motion is full", () => {
    expect(motion().reduced).toBe(false);
  });

  test("the operating system asks for reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    expect(motion().reduced).toBe(true);
  });

  test("the reader chose Reduce motion: Always, whatever the system says", () => {
    setAppearance({ reduceMotion: "always" });
    expect(motion().reduced).toBe(true);
  });

  test("both at once", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    setAppearance({ reduceMotion: "always" });
    expect(motion().reduced).toBe(true);
  });
});

describe("the values come from theme/motion.ts", () => {
  test("springs take section 5.1's damping ratio and duration", () => {
    expect(motion().spring("springSnap")).toMatchObject({ dampingRatio: MOTION.springSnap.dampingRatio, duration: MOTION.springSnap.duration });
    expect(motion().spring("springRelease")).toMatchObject({ dampingRatio: 0.85, duration: 350 });
  });

  test("timings take their durations, the press its in and out", () => {
    expect(motion().timing("pressIn")).toMatchObject({ duration: MOTION.press.in });
    expect(motion().timing("pressOut")).toMatchObject({ duration: MOTION.press.out });
    expect(motion().timing("fade")).toMatchObject({ duration: 150 });
    expect(motion().timing("easeOut", 200)).toMatchObject({ duration: 200 });
    expect(motion().timing("easeInOut", 300)).toMatchObject({ duration: 300 });
  });

  test("korbat decides what reduced means, so Reanimated never second-guesses a timing; a spring under reduced motion lands at once", () => {
    expect(motion().timing("fade").reduceMotion).toBe(ReduceMotion.Never);
    expect(motion().spring("springSnap").reduceMotion).toBe(ReduceMotion.Never);
    setAppearance({ reduceMotion: "always" });
    expect(motion().timing("fade").reduceMotion).toBe(ReduceMotion.Never);
    expect(motion().spring("springSnap").reduceMotion).toBe(ReduceMotion.Always);
  });
});
```

### Create `apps/app/test/setup.ts`

```ts
import { createElement, Fragment, type ReactNode } from "react";
import { vi } from "vitest";

/**
 * The native modules that never load in Node, mocked once for every test file (UI design, sections 12.1 and 13, Task 2).
 * vitest.config.mts names this file in `test.setupFiles`, so a test file mocks only what is its own (expo-router, the
 * session, expo-image, Turnstile). Each mock gives every name that src imports from its module, which kit.test.tsx
 * checks: a later task that imports a new name from one of these modules adds it here. The file is .ts, so elements
 * are built with createElement.
 */

/** A builder that answers every chained call with itself: `FadeIn.duration(220).easing(...)`, `Gesture.Pan().onEnd(...)`. */
function chainable(): unknown {
  const target = () => proxy;
  const proxy: unknown = new Proxy(target, { get: (_target, key) => (key === "then" ? undefined : () => proxy) });
  return proxy;
}

/** A component that renders its children and nothing of its own. */
const passThrough = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);

vi.mock("react-native-reanimated", async () => {
  const { ScrollView, Text, View } = await import("react-native");
  // Animated components draw the plain react-native-web ones, so a test sees the markup a browser gets.
  const animated = <P extends object>(component: (props: P) => ReactNode) => component;
  const Animated = {
    View: (props: object) => createElement(View, props),
    Text: (props: object) => createElement(Text, props),
    ScrollView: (props: object) => createElement(ScrollView, props),
    createAnimatedComponent: animated,
  };
  // An animation lands on its target at once: a static render shows where a motion ends.
  const identity = (t: number) => t;
  return {
    default: Animated,
    createAnimatedComponent: animated,
    // A vi.fn, so motion.test.ts can say the operating system asks for reduced motion.
    useReducedMotion: vi.fn(() => false),
    useSharedValue: <T>(initial: T) => ({ value: initial }),
    useAnimatedStyle: <T>(updater: () => T) => updater(),
    useDerivedValue: <T>(updater: () => T) => ({ value: updater() }),
    withSpring: <T>(to: T) => to,
    withTiming: <T>(to: T) => to,
    withRepeat: <T>(animation: T) => animation,
    withSequence: <T>(...animations: T[]) => animations[animations.length - 1],
    withDelay: <T>(_ms: number, animation: T) => animation,
    cancelAnimation: () => undefined,
    runOnJS:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A) =>
        fn(...args),
    Easing: {
      linear: identity,
      ease: identity,
      bezier: () => identity,
      in: () => identity,
      out: () => identity,
      inOut: () => identity,
    },
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
    FadeIn: chainable(),
    FadeOut: chainable(),
    LinearTransition: chainable(),
  };
});

vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: passThrough,
  GestureHandlerRootView: passThrough,
  Gesture: { Pan: () => chainable(), Tap: () => chainable() },
}));

vi.mock("react-native-safe-area-context", () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: passThrough,
    SafeAreaView: passThrough,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 1280, height: 900 }),
    initialWindowMetrics: null,
  };
});

vi.mock("expo-haptics", () => ({
  // The enums carry expo-haptics 57.0.3's own values, so a test compares what the app would send.
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  AndroidHaptics: {
    Confirm: "confirm",
    Reject: "reject",
    Gesture_Start: "gesture-start",
    Gesture_End: "gesture-end",
    Toggle_On: "toggle-on",
    Toggle_Off: "toggle-off",
    Long_Press: "long-press",
    Segment_Tick: "segment-tick",
  },
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
  performAndroidHapticsAsync: vi.fn(async () => undefined),
}));

// A document title is the browser's, which a static render has no use for.
vi.mock("expo-router/head", () => ({ default: () => null }));

vi.mock("lucide-react-native", async () => {
  // vitest finds kit/Icon.web.tsx before kit/Icon.tsx, so the native set is never drawn here; kit/Icon.tsx takes each
  // icon from its own module (lucide-react-native/icons/<name>). The package's main entry, which src imports only a
  // type from, is a stub of every icon icons.ts names, for a test that reaches for it.
  const { ICONS } = await import("../src/components/icons");
  const stub = () => null;
  return Object.fromEntries(Object.values(ICONS).map((name) => [name, stub]));
});
```

### Replace `apps/app/test/a11y.test.tsx` (whole file)

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, Switch, Text, View } from "react-native";
import { describe, expect, test } from "vitest";

/**
 * A screen reader learns a control's state from the HTML. react-native-web 0.21 drops React
 * Native's `accessibilityState` prop without a trace, so the app passes `aria-*` props instead. The
 * first test keeps the dropped prop out of the app; the others pin the library behaviour the app
 * relies on, so an upgrade that changes it fails here instead of silently in a screen reader.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

const html = (element: ReactElement): string => renderToStaticMarkup(element);

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

describe("screen-reader states", () => {
  test("no component passes accessibilityState, which react-native-web drops", () => {
    expect(findInSource(/accessibilityState[ ]*=/)).toEqual([]);
  });

  test("no component gives a control the link role by hand: a link is a Link or a Text with an href, so it is a real anchor", () => {
    // react-native-web deliberately does not fire onPress from the keyboard on role="link" without an href,
    // so Tab reaches such a control and Enter does nothing.
    expect(findInSource(/accessibilityRole=["']link["']|role=["']link["']/)).toEqual([]);
  });

  test("no component uses imagebutton, which react-native-web maps to no role", () => {
    expect(findInSource(/imagebutton/)).toEqual([]);
  });

  test("no component uses accessibilityViewIsModal, which react-native-web drops", () => {
    expect(findInSource(/accessibilityViewIsModal/)).toEqual([]);
  });

  test("a tab list and its selected tab", () => {
    const out = html(
      <View accessibilityRole="tablist">
        <Pressable accessibilityRole="tab" aria-selected />
      </View>,
    );
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
  });

  test("toggle buttons say whether they are pressed", () => {
    expect(html(<Pressable accessibilityRole="button" aria-pressed />)).toContain('aria-pressed="true"');
    expect(html(<Pressable accessibilityRole="button" aria-pressed={false} />)).toContain('aria-pressed="false"');
  });

  test("a pressable text is a native button that says whether it is pressed", () => {
    const out = html(
      <Text accessibilityRole="button" aria-pressed onPress={() => undefined}>
        Email code
      </Text>,
    );
    expect(out).toContain("<button");
    expect(out).toContain('aria-pressed="true"');
  });

  test("the link to the current page", () => {
    expect(html(<Pressable accessibilityRole="link" aria-current="page" />)).toContain('aria-current="page"');
  });

  test("a text with an href is a real anchor that opens elsewhere without a reference back", () => {
    const out = html(<Text {...({ href: "https://example.org/x", hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object)}>x</Text>);
    expect(out).toContain("<a ");
    expect(out).toContain('href="https://example.org/x"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  test("a pressable with an href is an anchor with the link role", () => {
    const out = html(<Pressable {...({ href: "/bookmarks" } as object)} />);
    expect(out).toContain("<a ");
    expect(out).toContain('href="/bookmarks"');
  });

  test("a dialog names itself through its heading", () => {
    const out = html(
      <View role="dialog" aria-labelledby="t">
        <Text nativeID="t">Delete this post?</Text>
      </View>,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-labelledby="t"');
    expect(out).toContain('id="t"');
  });

  test("a heading can be a level below the page title", () => {
    expect(html(<Text accessibilityRole="header" aria-level={2}>Password</Text>)).toContain("<h2");
  });

  test("a checkbox that is not ticked", () => {
    expect(html(<Pressable accessibilityRole="checkbox" aria-checked={false} />)).toContain('aria-checked="false"');
  });

  test("a busy button, which disabled also marks", () => {
    const out = html(<Pressable accessibilityRole="button" aria-busy disabled />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
  });

  test("a switch is a checkbox with the switch role, named by its label, that says whether it is on and whether it can be used", () => {
    const input = (element: ReactElement): string => /<input[^>]*>/.exec(html(element))?.[0] ?? "";
    const on = input(<Switch accessibilityLabel="Show my posts in Explore" value />);
    expect(on).toContain('type="checkbox"');
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-label="Show my posts in Explore"');
    expect(on).toContain('checked=""');
    const off = input(<Switch accessibilityLabel="Show my posts in Explore" value={false} disabled />);
    expect(off).not.toContain("checked");
    expect(off).toContain('disabled=""');
  });

  test("every switch in the app names itself, since its markup carries no text of its own", () => {
    expect(findInSource(/<Switch\b/).length).toBeGreaterThan(0);
    expect(findInSource(/<Switch\b(?![^>]*accessibilityLabel=)/)).toEqual([]);
  });

  test("the delete question takes the focus and hands it back, since the Delete control leaves the tree meanwhile", () => {
    const card = readFileSync(path.join(SRC, "components", "social", "PostCard.tsx"), "utf8");
    expect(card).toMatch(/if \(confirmingDelete\) keepRef\.current\?\.focus\(\);/);
    expect(card).toMatch(/else if \(wasConfirming\.current\) deleteRef\.current\?\.focus\(\);/);
    expect(card).toMatch(/<Action ref=\{keepRef\} label="Keep"/);
  });
});

// UI Task 2 appends below, so the lines above keep the numbers other tasks cite.
import ts from "typescript";
import { LEGACY_TEXT_FILES } from "./legacy-files";

/** A letter or a digit in any script: what makes a text a word rather than punctuation. */
const WORDY = /[\p{L}\p{N}]/u;

/**
 * The bare sentences of one .tsx file, found by TypeScript's own parser (UI design, section 1.5, after Bluesky's
 * avoid-unwrapped-text rule): a JSX text with a letter or a digit in it, or a string literal written as a JSX child
 * (`{"Load more"}`). A single punctuation character or a space alone, such as `{" "}`, is allowed.
 */
function bareSentences(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && WORDY.test(node.text)) found.push(node.text.trim());
    if (ts.isJsxExpression(node) && node.expression !== undefined && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const child = node.expression;
      if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
        const words = child.text.trim();
        if (words.length > 1 || WORDY.test(words)) found.push(child.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every .tsx file under src/app and src/components that holds a bare sentence, with its path from src. */
function filesWithBareSentences(): string[] {
  const found: string[] = [];
  for (const folder of ["app", "components"]) {
    for (const file of readdirSync(path.join(SRC, folder), { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".tsx")) continue;
      const name = `${folder}/${file.split(path.sep).join("/")}`;
      if (bareSentences(name, readFileSync(path.join(SRC, folder, file), "utf8")).length > 0) found.push(name);
    }
  }
  return found.sort();
}

describe("every visible sentence lives in a words module (UI design, section 1.5)", () => {
  test("the scan finds a bare text and a bare string literal, and lets punctuation and a words constant through", () => {
    expect(bareSentences("a.tsx", "const a = <Text>Load more</Text>;")).toEqual(["Load more"]);
    expect(bareSentences("a.tsx", 'const a = <Text>{"Try again"}</Text>;')).toEqual(["Try again"]);
    expect(bareSentences("a.tsx", "const a = <Text>{`Hidden`}</Text>;")).toEqual(["Hidden"]);
    expect(bareSentences("a.tsx", "const a = <Text>16</Text>;")).toEqual(["16"]);
    expect(bareSentences("a.tsx", 'const a = <Text>{WORDS.title} ( {" "} {"."} {count} )</Text>;')).toEqual([]);
    // A prop is not a child: a label passed as a prop is checked where its words are, not here.
    expect(bareSentences("a.tsx", 'const a = <Button label="Keep" />;')).toEqual([]);
  });

  test("no file of src/app or src/components holds a bare sentence, but those not yet converted", () => {
    expect(filesWithBareSentences().filter((name) => !LEGACY_TEXT_FILES.includes(name))).toEqual([]);
  });

  test("every file still listed holds one, so a task that converts a file takes it off the list; the list is sorted", () => {
    const found = filesWithBareSentences();
    expect(LEGACY_TEXT_FILES.filter((name) => !found.includes(name))).toEqual([]);
    expect([...LEGACY_TEXT_FILES]).toEqual([...new Set(LEGACY_TEXT_FILES)].sort());
  });
});

describe("focus stays visible in every theme and in forced colours (UI design, sections 6.1 and 10)", () => {
  test("no line takes the outline away without drawing korbat's focus-visible outline beside it", () => {
    expect(findInSource(/\boutline-none\b/).filter((at) => !findInSource(/\boutline-none\b.*focus-visible:outline\b|focus-visible:outline\b.*\boutline-none\b/).includes(at))).toEqual([]);
  });

  test("no focus ring is drawn as a box-shadow ring, which forced colours remove", () => {
    expect(findInSource(/focus-visible:ring\b|focus:ring\b/)).toEqual([]);
  });

  test("the kit's ring is a 2 px outline in the focus colour at a 2 px offset", () => {
    const kit = readFileSync(path.join(SRC, "components", "kit", "interaction.ts"), "utf8");
    expect(kit).toContain('"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"');
  });
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
    // Amber before the start, red while it runs: the colour repeats the words (a static render carries no class, so the source says it).
    expect(read("components", "StandingBanner.tsx")).toContain('measure.state === "running" ? "border-red-800 bg-red-950" : "border-amber-700 bg-amber-950"');
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

### Replace `apps/app/test/appeals.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DAILY_LIMITS, ModerationErrorCode, STATEMENT_MAX, type AuthorCaseRow, type DecisionAppeal, type DecisionView, type NoticeItemStatus, type NoticeStatus, type ReportItem } from "@korbat/contracts";
import { STATEMENT_WORDS, statementParagraphs } from "@korbat/rules";
import { DecisionsList, ReportsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { ItemLines } from "../src/components/moderation/ItemLines";
import { NoticeStatusView } from "../src/components/moderation/NoticeStatusView";
import { ApiError, errorMessage, messageFor } from "../src/lib/api";
import { appealWaitWords, dailyLimitFailure, quotedExaminedToo, statementOf } from "../src/lib/moderation";
import { CASES_WORDS, DAILY_LIMIT_WORDS, DECISION_WORDS, STATUS_WORDS } from "../src/lib/moderation-words";

/**
 * The appeal form and its states on the decision's screen, and "Ask for a re-examination" on the notice status page and
 * in Your reports (3c design, sections 7.2, 7.7 and 9). The components are server-rendered with made-up answers in each
 * state; what a static render cannot show (a request, where a token travels) is read from the source.
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
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
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
/** The text of every button in the markup. */
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APP = "http://localhost:8081";
const TIME = "2026-10-04T10:00:00.000Z";
const UNTIL = "2027-04-05T07:00:00.000Z";
const noop = async () => undefined;

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
const view = (extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(3),
  ...statement,
  appealUntil: "2027-04-04T10:00:00.000Z",
  reversedOn: null,
  content: { kind: "post", body: "the words that were judged", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
  ...extra,
});
const pending = (extra: Partial<Extract<DecisionAppeal, { state: "pending" }>> = {}): DecisionAppeal => ({ state: "pending", filedAt: "2026-10-06T09:00:00.000Z", reviewer: "available", needsAdmin: false, ...extra });
const sealed = { ...statement, ruleId: "R2" as const, measures: [{ kind: "seal_media" as const, mediaId: null, noEffect: null, sealed: { posts: 1, images: 2, deletedImages: 0 } }] };

describe("the words of appeals and re-examination", () => {
  test("the appeal's own sentences are the design's", () => {
    expect(DECISION_WORDS.appealHint).toBe("Tell us anything you want the reviewer to know. You do not need to cite rules or law.");
    expect(DECISION_WORDS.appealWaiting).toBe("Waiting for a reviewer");
    expect(DECISION_WORDS.appealWaits).toEqual({
      none_single_staff: "Your appeal waits for a moderator who did not take part in the decision. korbat has one moderator at the moment.",
      none_eligible: "Your appeal waits for a moderator who took no part in this case. None is available now; your appeal stays open until one is.",
      admin: "Your appeal waits for an admin who did not take part in the decision.",
      oneAdmin: "korbat has one admin at the moment.",
      sealed: "Sealed images are reviewed once the authorities have assessed them. Your appeal stays open until then.",
    });
    expect(DECISION_WORDS.appealAnswered("2026-10-09")).toBe("Answered on 2026-10-09");
    expect(STATUS_WORDS.reexamine).toBe("Ask for a re-examination");
    expect(STATUS_WORDS.reexamineBoth).toBe("korbat examines the post it quotes again as well.");
  });

  test("each code an appeal and a re-examination can meet has the app's own words", () => {
    expect(messageFor("appeal_not_open")).toBe("This decision cannot be appealed now.");
    expect(messageFor("appeal_exists")).toBe("You have already appealed this decision.");
    expect(messageFor("reexamination_not_open")).toBe("A re-examination cannot be asked for this item now.");
    expect(messageFor("reexamination_exists")).toBe("A re-examination of this item has already been asked for.");
    for (const code of ["appeal_not_open", "appeal_exists", "reexamination_not_open", "reexamination_exists"]) expect(ModerationErrorCode.options).toContain(code);
  });

  test("the day's limit of appeals and of re-examinations is worded as a daily limit with its number and the wait the answer gives, never as a moment", () => {
    const limited = new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", 86_400);
    const appeal = dailyLimitFailure(limited, "appeals");
    expect(appeal).toBe(DAILY_LIMIT_WORDS.appeals("24 hours"));
    expect(DAILY_LIMIT_WORDS.appeals("24 hours")).toBe(`korbat takes at most ${DAILY_LIMITS.appeals} appeals a day from one account. Try again in about 24 hours.`);
    const asked = dailyLimitFailure(new ApiError(429, "rate_limited", "Too many requests. Wait a moment and try again.", 3_000), "reexaminations");
    expect(asked).toBe(DAILY_LIMIT_WORDS.reexaminations("50 minutes"));
    expect(DAILY_LIMIT_WORDS.reexaminations("50 minutes")).toBe(
      `korbat takes at most ${DAILY_LIMITS.reexaminations} requests for a re-examination a day from one account, or without an account from one network. Try again in about 50 minutes.`,
    );
    for (const words of [appeal, asked]) expect(words).not.toMatch(/a moment/);
    // Any other failure is worded as before.
    const refused = new ApiError(422, "appeal_not_open", "the server's own words");
    expect(dailyLimitFailure(refused, "appeals")).toBe(errorMessage(refused));
    // The appeal form and the re-examination control word their failures through it.
    expect(read("components", "moderation", "DecisionDetail.tsx")).toContain('setError(dailyLimitFailure(err, "appeals"));');
    expect(read("components", "moderation", "ItemLines.tsx")).toContain('setError(dailyLimitFailure(err, "reexaminations"));');
  });

  test("a statement is sent only when something was written, and never longer than the contracts allow", () => {
    expect(statementOf("")).toEqual({});
    expect(statementOf("  \n ")).toEqual({});
    expect(statementOf(" It quotes a film. ")).toEqual({ statement: "It quotes a film." });
    expect(STATEMENT_MAX).toBe(2000);
  });
});

describe("the appeal on a decision's screen", () => {
  test("while the decision can be appealed: the deadline, an optional statement with its hint, and the button", () => {
    const out = html(<DecisionDetail view={view()} onAppeal={noop} />);
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.appealUntil("2027-04-04 10:00 UTC"));
    expect(text).toContain(DECISION_WORDS.appealHint);
    expect(out).toMatch(/<textarea[^>]*maxLength="2000"/i);
    expect(buttons(out)).toEqual([DECISION_WORDS.appeal]);
    // Without a way to send one (the screen is drawn before it can act) the deadline stands alone.
    expect(buttons(html(<DecisionDetail view={view()} />))).toEqual([]);
    // A decision that cannot be appealed shows no form: one taken while korbat decides, and one whose window passed.
    expect(buttons(html(<DecisionDetail view={view({ appealUntil: null })} onAppeal={noop} />))).toEqual([]);
  });

  test("a pending appeal says that it waits for a reviewer, and when nobody can review it now, why, in the design's sentences", () => {
    const shown = (appeal: DecisionAppeal, base: Partial<DecisionView> = {}) => textOf(html(<DecisionDetail view={view({ appealUntil: null, appeal, ...base })} onAppeal={noop} />));
    expect(appealWaitWords(view({ appeal: pending() }))).toBe(DECISION_WORDS.appealWaiting);
    expect(shown(pending())).toContain(DECISION_WORDS.appealWaiting);
    expect(shown(pending())).toContain(DECISION_WORDS.appealFiled("2026-10-06"));
    expect(shown(pending({ reviewer: "none_single_staff" }))).toContain(DECISION_WORDS.appealWaits.none_single_staff);
    expect(shown(pending({ reviewer: "none_eligible" }))).toContain(DECISION_WORDS.appealWaits.none_eligible);
    // A review that needs an admin: the admin's sentence, with "one admin" only while korbat has one.
    const r2 = { ...statement, ruleId: "R2" as const };
    expect(shown(pending({ reviewer: "none_eligible", needsAdmin: true }), r2)).toContain(DECISION_WORDS.appealWaits.admin);
    expect(shown(pending({ reviewer: "none_eligible", needsAdmin: true }), r2)).not.toContain(DECISION_WORDS.appealWaits.oneAdmin);
    expect(shown(pending({ reviewer: "none_single_staff", needsAdmin: true }), r2)).toContain(`${DECISION_WORDS.appealWaits.admin} ${DECISION_WORDS.appealWaits.oneAdmin}`);
    expect(shown(pending({ reviewer: "available", needsAdmin: true }), r2)).toContain(DECISION_WORDS.appealWaiting);
    // An appeal of a decision that sealed images: the seal's sentence in place of every other, whatever the reviewer's state.
    for (const reviewer of ["available", "none_single_staff", "none_eligible"] as const) {
      const text = shown(pending({ reviewer, needsAdmin: true }), sealed);
      expect(text, reviewer).toContain(DECISION_WORDS.appealWaits.sealed);
      expect(text, reviewer).not.toContain(DECISION_WORDS.appealWaits.admin);
      expect(text, reviewer).not.toContain(DECISION_WORDS.appealWaiting);
    }
    // No second appeal is offered.
    expect(buttons(html(<DecisionDetail view={view({ appealUntil: null, appeal: pending() })} onAppeal={noop} />))).toEqual([]);
  });

  test("an answered appeal shows its day and the answering decision's statement, rendered as every statement is", () => {
    const reviewed = { kind: "final" as const, ground: "incompatible" as const, ruleId: "R3" as const, rulesVersion: 2, legalReference: null, decidedAt: TIME };
    const review = { ...statement, kind: "review" as const, outcome: "kept" as const, ground: null, ruleId: null, facts: null, reason: "The post names a group, not an idea.", measures: [], reviewed, decidedAt: "2026-10-09T08:00:00.000Z" };
    const appeal: DecisionAppeal = { state: "answered", filedAt: "2026-10-06T09:00:00.000Z", answeredOn: "2026-10-09", result: "kept", answeredBy: id(9), statement: review };
    const out = html(<DecisionDetail view={view({ appealUntil: null, appeal })} onAppeal={noop} />);
    const text = textOf(out);
    expect(text).toContain(DECISION_WORDS.appealAnswered("2026-10-09"));
    for (const paragraph of statementParagraphs(review)) expect(text, paragraph).toContain(paragraph);
    expect(text).toContain(STATEMENT_WORDS.reviewed("2026-10-04 10:00 UTC", "kept"));
    expect(text).toContain("Why korbat kept it: The post names a group, not an idea.");
    expect(buttons(out)).toEqual([]);
    // The answer has a screen of its own, which the appeal links.
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
  });

  test("a restriction reversed in full with no appeal filed says that nothing is left to appeal", () => {
    const text = textOf(html(<DecisionDetail view={view({ appealUntil: null, reversedOn: "2026-10-07" })} onAppeal={noop} />));
    expect(text).toContain(DECISION_WORDS.reversed("2026-10-07"));
    // With an appeal that a correction answered, the answer stands in its place.
    const answered: DecisionAppeal = { state: "answered", filedAt: TIME, answeredOn: "2026-10-07", result: "reversed", answeredBy: id(9), statement: { ...statement, kind: "correction", outcome: "reversed", ground: null, ruleId: null, facts: null, reason: "It is satire.", measures: [], reversals: [{ kind: "restore", mediaId: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }], reviewed: { kind: "final", ground: "incompatible", ruleId: "R3", rulesVersion: 2, legalReference: null, decidedAt: TIME } } };
    const both = textOf(html(<DecisionDetail view={view({ appealUntil: null, reversedOn: "2026-10-07", appeal: answered })} onAppeal={noop} />));
    expect(both).toContain(DECISION_WORDS.appealAnswered("2026-10-07"));
    expect(both).not.toContain(DECISION_WORDS.reversed("2026-10-07"));
  });

  test("the screen sends the appeal as a POST for the decision in its address and shows the decision the answer carries", () => {
    const screen = read("app", "settings", "cases", "[id].tsx");
    expect(screen).toMatch(/moderation\.appeal\(id, /);
    expect(read("lib", "moderation.ts")).toMatch(/appeal: \(id: string, statement: string\) => api\(`\/api\/moderation\/decisions\/\$\{encodeURIComponent\(id\)\}\/appeal`, \{ json: statementOf\(statement\), schema: DecisionView \}\)/);
  });

  test("About you says where the appeal of each decision stands", () => {
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({ id: id(3), kind: "final", outcome: "restricted", decidedOn: "2026-10-04", post: { id: id(1), createdAt: TIME }, actions: ["remove"], endedInterim: false, ruleId: "R3", legal: false, appealUntil: null, reversedOn: null, appeal: null, strike: null, ...extra });
    const list = (extra: Partial<AuthorCaseRow>) => textOf(html(<DecisionsList decisions={[row(extra)]} />));
    expect(CASES_WORDS.appealState).toEqual({ pending: "Your appeal waits for a reviewer", kept: "Your appeal was answered: korbat kept its decision", partly_reversed: "Your appeal was answered: korbat reversed part of its decision", reversed: "Your appeal was answered: korbat reversed its decision" });
    for (const state of ["pending", "kept", "partly_reversed", "reversed"] as const) expect(list({ appeal: state }), state).toContain(CASES_WORDS.appealState[state]);
    expect(list({ appealUntil: "2027-04-04T10:00:00.000Z" })).toContain(CASES_WORDS.appealOpen("2027-04-04 10:00 UTC"));
    expect(list({})).not.toContain("appeal");
  });
});

describe("Ask for a re-examination", () => {
  const waiting: NoticeItemStatus = { position: 1, link: `${APP}/post/${id(1)}`, scope: null, suspect: false, sealed: false, unseen: false, quotedBy: null, outcome: null, decidedOn: null, changed: false, reexamines: false, reexamination: null };
  const item = (extra: Partial<NoticeItemStatus>): NoticeItemStatus => ({ ...waiting, decidedOn: "2026-10-05", ...extra });
  const open = item({ outcome: "no_violation", reexamination: { open: true, until: UNTIL } });
  const status = (items: NoticeItemStatus[]): NoticeStatus => ({ ref: "N-ABCDEFGH23", receivedAt: TIME, items, contact: null });

  test("the control stands beside an item whose answer can still be examined again: the sentence, an optional statement, and the button", () => {
    const out = html(<ItemLines items={[open]} onReexamine={noop} />);
    const text = textOf(out);
    expect(text).toContain(STATUS_WORDS.reexaminationOpen("2027-04-05 07:00 UTC"));
    expect(text).toContain(STATUS_WORDS.reexamineStatement);
    expect(out).toMatch(/<textarea[^>]*maxLength="2000"/i);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    // Drawn without a way to ask (a list that only reads), the sentence stands alone.
    expect(buttons(html(<ItemLines items={[open]} />))).toEqual([]);
  });

  test("no control beside an item that waits, one that was asked about already, one past its window, a restriction, a changed outcome or a re-examination's answer", () => {
    const none: NoticeItemStatus[] = [
      waiting,
      item({ outcome: "no_violation", reexamination: { open: false, until: UNTIL } }),
      item({ outcome: "restricted_rule", rule: { id: "R3", title: "No hate" } }),
      item({ outcome: "reversed", changed: true }),
      item({ outcome: "no_violation", reexamines: true }),
      item({ outcome: "not_available" }),
    ];
    for (const one of none) expect(buttons(html(<ItemLines items={[one]} onReexamine={noop} />)), JSON.stringify(one).slice(0, 80)).toEqual([]);
  });

  test("an answer given while nobody could open the images keeps the control, also when it answers a re-examination", () => {
    const unseen = item({ outcome: "no_violation", unseen: true, reexamines: true, reexamination: { open: true, until: UNTIL } });
    const out = html(<ItemLines items={[unseen]} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    expect(textOf(out)).not.toContain("final within korbat");
  });

  test("beside the control of an item whose added item can be examined again too, the page says that korbat examines the quoted post as well", () => {
    const origin = item({ suspect: true, outcome: "no_violation", reexamination: { open: true, until: UNTIL } });
    const added = (extra: Partial<NoticeItemStatus> = {}) => item({ position: 11, quotedBy: 1, suspect: true, link: `${APP}/post/${id(2)}`, outcome: "no_violation", reexamination: { open: true, until: UNTIL }, ...extra });
    expect(quotedExaminedToo([origin, added()], 0)).toBe(true);
    // Not for the added item itself, not while the added item waits or was asked about, and never for a report on another ground.
    expect(quotedExaminedToo([origin, added()], 1)).toBe(false);
    expect(quotedExaminedToo([origin, added({ reexamination: { open: false, until: UNTIL } })], 0)).toBe(false);
    expect(quotedExaminedToo([origin, added({ outcome: null, decidedOn: null, reexamination: null })], 0)).toBe(false);
    expect(quotedExaminedToo([{ ...origin, suspect: false }, added()], 0)).toBe(false);
    const both = textOf(html(<ItemLines items={[origin, added()]} onReexamine={noop} />));
    expect(both.split(STATUS_WORDS.reexamineBoth)).toHaveLength(2);
    expect(textOf(html(<ItemLines items={[origin, added({ reexamination: { open: false, until: UNTIL } })]} onReexamine={noop} />))).not.toContain(STATUS_WORDS.reexamineBoth);
  });

  test("the status page asks with the notice's reference, the page's token and the item's position, in the body of a POST", () => {
    const out = html(<NoticeStatusView status={status([open])} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    const page = read("app", "notice", "[ref].tsx");
    expect(page).toMatch(/moderation\.reexamineNotice\(ref, token, item\.position, /);
    const calls = read("lib", "moderation.ts");
    expect(calls).toMatch(/reexamineNotice: \(ref: string, token: string, position: number, statement: string\) => api\("\/api\/notices\/reexamine", \{ json: \{ ref, token, position, \.\.\.statementOf\(statement\) \}, schema: ReexamineResponse \}\)/);
    // No token ever travels in an address.
    expect(calls).not.toMatch(/[?&]t(oken)?=/);
  });

  test("Your reports asks by the item's id, which only the signed-in sender's list carries", () => {
    const listed: ReportItem = { ...open, id: id(8), unfounded: false };
    const out = html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [listed] }], reportMailStopped: false }} onReexamine={noop} />);
    expect(buttons(out)).toEqual([STATUS_WORDS.reexamine]);
    expect(buttons(html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: TIME, items: [listed] }], reportMailStopped: false }} />))).toEqual([]);
    expect(read("app", "settings", "cases", "index.tsx")).toMatch(/moderation\.reexamineOwn\(item\.id, /);
    expect(read("lib", "moderation.ts")).toMatch(/reexamineOwn: \(itemId: string, statement: string\) => api\(`\/api\/moderation\/items\/\$\{encodeURIComponent\(itemId\)\}\/reexamine`, \{ json: statementOf\(statement\), schema: ReexamineResponse \}\)/);
  });
});
```

### Replace `apps/app/test/automated.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, ModerationErrorCode, OBJECTION_TEXT_MAX, type AuthorCaseRow, type DecisionView } from "@korbat/contracts";
import { REDRESS_TEXTS, STATEMENT_WORDS } from "@korbat/rules";
import { DecisionsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { messageFor } from "../src/lib/api";
import { utcMinute } from "../src/lib/moderation";
import { AUTO_WORDS } from "../src/lib/moderation-words";

/**
 * A measure a program took, as its author sees it (3d design, sections 7.10, 9.4, 9.6 and 9.7; Task 6): the decision's
 * screen with [auto.chip] beside the day and the statement of a decision without a decider; "Ask for a person" in its
 * three states, [auto.ask] with [auto.askLead], [auto.asked] with the published target and [auto.decided] with a link;
 * the row of "About you"; objection_not_open in the app's words; and the request the screen sends, read from the source.
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
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** Every run of white space: a tab, a line feed, a carriage return or a space, built from their codes. */
const SPACES = new RegExp(`[${String.fromCharCode(9, 10, 13, 32)}]+`, "g");
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(SPACES, " ")
    .trim();
const buttons = (markup: string): string[] => [...markup.matchAll(/<(?:div|button) [^>]*role="button"[^>]*>(.*?)<[/](?:div|button)>/g)].map((match) => textOf(match[1]!));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DECIDED = "2026-10-19T09:15:00.000Z";
const ASKED = "2026-10-19T10:00:00.000Z";
const noop = async () => undefined;

/** A program's withhold of an image, as the author's screen reads it, with "Ask for a person" in the state given. */
const program = (askPerson: DecisionView["askPerson"]): DecisionView => ({
  id: id(3),
  kind: "interim",
  outcome: "restricted",
  ground: "incompatible",
  ruleId: "R1",
  rulesVersion: 3,
  redressVersion: 4,
  legalReference: null,
  facts: null,
  reason: null,
  source: "own_initiative",
  decidedAt: DECIDED,
  post: { id: id(1), createdAt: "2026-10-19T08:30:00.000Z" },
  measures: [{ kind: "withhold_media", mediaId: id(2), noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  automatedDetection: true,
  automatedDecision: "fully",
  signal: { kind: "r1_score", source: null, matchKind: null, listedAs: null, viewed: null },
  appealUntil: null,
  reversedOn: null,
  content: { kind: "post", body: "a photo", deletedByAuthor: false, images: [], imageCount: 1, imagesHidden: null },
  appeal: null,
  strike: null,
  standing: null,
  askPerson,
});

describe("a program's decision on its screen (9.4)", () => {
  test("[auto.chip] beside the day, the statement of a decision without a decider, and no appeal", () => {
    const shown = textOf(html(<DecisionDetail view={program({ state: "open" })} onAppeal={noop} onAsk={noop} />));
    expect(shown).toContain(`${AUTO_WORDS.chip}, 2026-10-19`);
    for (const sentence of [STATEMENT_WORDS.automated.until.r1, STATEMENT_WORDS.automated.fully.r1, REDRESS_TEXTS[4].askPerson!]) expect(shown).toContain(sentence);
    expect(shown).not.toContain("You can appeal this decision until");
    // A decision with a decider carries no chip.
    expect(textOf(html(<DecisionDetail view={{ ...program(null), automatedDecision: "not_automated" }} />))).not.toContain(AUTO_WORDS.chip);
  });

  test("[auto.ask] while the measure is in force and nothing was asked; its field under [auto.askLead]", () => {
    const out = html(<DecisionDetail view={program({ state: "open" })} onAsk={noop} />);
    expect(buttons(out)).toContain(AUTO_WORDS.ask);
    expect(AUTO_WORDS.askLead).toBe(
      "Write anything a person should know. You can send one message. A moderator reads it and lifts the measure or decides the case; for sealed images an admin does. You get that decision's statement either way. You do not need to cite rules or law.",
    );
    // The field's bound is the contracts' own.
    expect(OBJECTION_TEXT_MAX).toBe(2000);
    expect(read("components", "moderation", "DecisionDetail.tsx")).toContain("maxLength={OBJECTION_TEXT_MAX}");
    // Without a way to send it the screen offers no button.
    expect(buttons(html(<DecisionDetail view={program({ state: "open" })} />))).not.toContain(AUTO_WORDS.ask);
  });

  test("[auto.asked] with the time, the published target and the text as sent, and no button", () => {
    const text = "<script>alert(1)</script> It is a painting.";
    const out = html(<DecisionDetail view={program({ state: "asked", text, createdAt: ASKED })} onAsk={noop} />);
    const shown = textOf(out);
    expect(shown).toContain(AUTO_WORDS.asked(utcMinute(ASKED)));
    expect(AUTO_WORDS.asked("x")).toContain(`korbat's target is an answer within ${AUTOMATION_RULES.objectionTargetHours} hours.`);
    expect(out).not.toContain("<script>");
    expect(shown).toContain("It is a painting.");
    expect(buttons(out)).not.toContain(AUTO_WORDS.ask);
  });

  test("[auto.decided] with a link to the person's decision, and no button", () => {
    const out = html(<DecisionDetail view={program({ state: "decided", decisionId: id(9), decidedAt: ASKED })} onAsk={noop} />);
    expect(textOf(out)).toContain(AUTO_WORDS.decided(utcMinute(ASKED)));
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(buttons(out)).not.toContain(AUTO_WORDS.ask);
  });

  test("objection_not_open is [auto.decided] without the day, in the app's own words; the screen posts the text to the decision's route", () => {
    expect(ModerationErrorCode.options).toContain("objection_not_open");
    expect(messageFor("objection_not_open")).toBe(AUTO_WORDS.notOpen);
    expect(AUTO_WORDS.notOpen).toBe("A person has decided since: the decision is listed under Settings, Cases.");
    // 3d review L10 (people8): a second request while the first is open has its own code and words: nobody has decided.
    expect(ModerationErrorCode.options).toContain("objection_exists");
    expect(messageFor("objection_exists")).toBe(AUTO_WORDS.exists);
    expect(AUTO_WORDS.exists).toBe("You have already asked for a person about this decision. A person reads what you wrote.");
    expect(read("lib", "moderation.ts")).toContain("/api/moderation/decisions/${encodeURIComponent(id)}/objection`, { json: { text }, schema: DecisionView }");
    expect(read("app", "settings", "cases", "[id].tsx")).toContain("onAsk={ask}");
  });
});

describe("About you (9.6)", () => {
  test("a program's decision is listed as Taken by a program: what it did", () => {
    const row = {
      id: id(3),
      kind: "interim",
      outcome: "restricted",
      decidedOn: "2026-10-19",
      post: { id: id(1), createdAt: "2026-10-19T08:30:00.000Z" },
      actions: ["withhold_media"],
      ruleId: "R1",
      legal: false,
      appealUntil: null,
      appeal: null,
      reversedOn: null,
      endedInterim: false,
      byProgram: true,
    } as unknown as AuthorCaseRow;
    const shown = textOf(html(<DecisionsList decisions={[row]} />));
    expect(shown).toContain(AUTO_WORDS.row(""));
    expect(textOf(html(<DecisionsList decisions={[{ ...row, byProgram: false }]} />))).not.toContain(AUTO_WORDS.chip);
  });
});
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
    expect(hrefs(out)).toEqual(["/settings/security", "/settings/privacy", "/settings/profile", "/settings/account", "/settings/cases"]);
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
    expect(screen).toContain('accessibilityRole="tablist"');
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

  test("the author's own withheld or removed post shows the chip as a link to the decision's statement, amber while korbat decides and red once removed", () => {
    session.state = me(id(900));
    const removed = html(<PostCard post={post({ moderation: { decisionId: id(3), ruleId: "R3", legal: false, interim: false, strikeUntil: null } })} />);
    expect(textOf(removed)).toContain("Removed: R3");
    expect(hrefs(removed)).toContain(`/settings/cases/${id(3)}`);
    const held = html(<PostCard post={post({ state: "withheld", moderation: { decisionId: id(4), ruleId: null, legal: true, interim: true, strikeUntil: null } })} />);
    expect(textOf(held)).toContain("Under review: illegal content");
    expect(hrefs(held)).toContain(`/settings/cases/${id(4)}`);
    // The colours are class names, which a render without the style compiler does not carry: they are read from the source.
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain('const amber = decision ? decision.interim : post.state === "withheld";');
    expect(card).toContain('const surface = `self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`;');
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

### Replace `apps/app/test/hidden-media.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { HiddenMedia, MediaView, PostView } from "@korbat/contracts";
import { PopularPosts } from "../src/components/PopularNow";
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

describe("Popular now", () => {
  test("an image-only post is named by the first image the reader is shown; hidden images are skipped, and a post of hidden images alone has no image line", () => {
    const out = html(
      <PopularPosts
        posts={[
          post(1, { body: "", media: [hidden(11), image(12, "A green square")] }),
          post(2, { body: "", media: [sealed(21), hidden(22)] }),
          post(3, { body: "", media: [image(31, "A red circle"), hidden(32)] }),
        ]}
      />,
    );
    const lines = [...out.matchAll(/<a\b[^>]*href="\/post\/[^"]+"[^>]*>(.*?)<\/a>/g)].map((match) => textOf(match[1]!));
    expect(lines).toEqual(["Ada Image: A green square", "Ada", "Ada Image: A red circle"]);
    expect(out).not.toContain("undefined");
  });
});
```

### Replace `apps/app/test/image-fault.test.tsx` (whole file)

```tsx
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { MediaStatusResponse, MediaView } from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";
import { ImageFaultView, faultAsker, imageFaultOf } from "../src/components/social/ImageFault";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { IMAGE_FAULT_WORDS } from "../src/lib/moderation-words";

/**
 * An image of the reader's own post being restored or lost (3d design, sections 7.1 and 9.6; Task 1): after a failed
 * load of their own image, and only of their own, the component asks the image's status once and prints [image.restoring]
 * or [image.lost] in its place; anyone else sees what a missing image shows. A static render cannot fail a load, so it
 * shows which images would ask (the mock marks an image given a handler for its failed load), and the asking and the
 * words are tested by themselves.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return {
    Image: ({ source, accessibilityLabel, onError }: { source: { uri: string }; accessibilityLabel: string; onError?: () => void }) =>
      createElement("img", { "data-uri": source.uri, alt: accessibilityLabel, "data-asks": onError === undefined ? "no" : "yes" }),
  };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const asking = (markup: string): string[] => [...markup.matchAll(/data-asks="([a-z]+)"/g)].map((match) => match[1]!);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
const ready = (extra: Partial<Extract<MediaStatusResponse, { status: "ready" }>> = {}): MediaStatusResponse => ({ id: id(1), status: "ready", width: 800, height: 600, blurhash: "LEHV6nWB2yk8", ...extra });

describe("an image of the reader's own post being restored or lost (3d Task 1)", () => {
  test("the status names the fault: restoring, lost, or none for every other answer", () => {
    expect(imageFaultOf(ready({ restoring: true }))).toBe("restoring");
    expect(imageFaultOf(ready({ lost: true }))).toBe("lost");
    expect(imageFaultOf(ready())).toBeNull();
    expect(imageFaultOf({ id: id(1), status: "processing" })).toBeNull();
    expect(imageFaultOf({ id: id(1), status: "failed", error: "processing_failed" })).toBeNull();
  });

  test("the status is asked once an image, however often its load fails; a failed question names no fault", async () => {
    const ask = vi.fn(async (asked: string) => ready({ id: asked, restoring: true }));
    const once = faultAsker(ask);
    expect(await once(id(1))).toBe("restoring");
    expect(await once(id(1))).toBeNull();
    expect(await once(id(2))).toBe("restoring");
    expect(ask.mock.calls.map((call) => call[0])).toEqual([id(1), id(2)]);
    const failing = faultAsker(async () => {
      throw new Error("offline");
    });
    expect(await failing(id(3))).toBeNull();
  });

  test("the words in the image's place: [image.restoring] and [image.lost], the second those of the mail image_lost", () => {
    expect(textOf(html(<ImageFaultView fault="restoring" />))).toBe("This image is being restored. It is shown again once korbat has moved it back; you do not need to do anything.");
    expect(textOf(html(<ImageFaultView fault="lost" />))).toBe(IMAGE_LOST_NOTICE.onImage);
    expect(IMAGE_FAULT_WORDS.lost).toBe("korbat lost this image's files while they were kept apart from its other images. It cannot be shown again. You can delete the post, or post the image again.");
  });

  test("only the reader's own images ask, in the post and in the viewer; anyone else's image shows as missing", () => {
    expect(asking(html(<MediaGrid media={[image(1), image(2)]} postId={id(9)} own />))).toEqual(["yes", "yes"]);
    expect(asking(html(<MediaGrid media={[image(1), image(2)]} postId={id(9)} />))).toEqual(["no", "no"]);
    const noop = () => undefined;
    expect(asking(html(<MediaViewerContent media={[image(1)]} index={0} onIndex={noop} onClose={noop} own />))).toEqual(["yes"]);
    expect(asking(html(<MediaViewerContent media={[image(1)]} index={0} onIndex={noop} onClose={noop} postId={id(9)} />))).toEqual(["no"]);
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
  "lib/session.tsx",
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
  "app/bookmarks.tsx",
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
  "app/u/[handle]/followers.tsx",
  "app/u/[handle]/following.tsx",
  "app/u/[handle]/index.tsx",
  "components/AppShell.tsx",
  "components/HandleBox.tsx",
  "components/PopularNow.tsx",
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

### Replace `apps/app/test/orders.test.tsx` (whole file)

```tsx
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DecisionView, type AuthorCaseRow, type OrderNoticeFacts } from "@korbat/contracts";
import { ORDER_NOTICE, statementParagraphs } from "@korbat/rules";
import { DecisionsList } from "../src/components/moderation/CasesLists";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { messageFor } from "../src/lib/api";
import { chipText } from "../src/lib/moderation";
import { CASES_WORDS, DECISION_WORDS } from "../src/lib/moderation-words";
import { NOT_APPEALABLE, ORDER_TEXTS } from "../src/lib/orders";

/**
 * The app's part of an authority's order (3f design, section 9, Task 3), server-rendered with made-up answers: the notice
 * on the decision's screen (its title, ORDER_NOTICE's paragraphs, the authority's words in their own block, no post and
 * no appeal, [notice.wrongItem] and [notice.fresh]), the reinstatement's notice, the row on Cases in its own words and
 * without a rule, the chip [chip.order], and the words of not_appealable.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => ({ status: "signed-out" }) }) }));
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
    .replace(/ {2,}/g, " ")
    .trim();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DISABLED_AT = "2026-10-16T09:00:00.000Z";

const facts: OrderNoticeFacts = {
  kind: "tco_removal",
  memberState: "DE",
  authority: "Bundeskriminalamt (BKA)",
  reference: "BKA-2026-1",
  verified: true,
  orderedOn: "2026-10-16",
  orderedFrom: "received",
  crossBorder: false,
  homeState: "DE",
  withholdAuthor: true,
  disabledAt: DISABLED_AT,
  held: false,
  informedAt: DISABLED_AT,
  holdEndReason: null,
  preserveUntil: "2027-04-17T09:00:00.000Z",
  preserveFirstUntil: "2027-04-17T09:00:00.000Z",
  preserveExtended: false,
  preserveEndedOn: null,
  orderGround: null,
};

const notice = (extra: Partial<DecisionView> = {}): DecisionView => ({
  id: id(3),
  kind: "order",
  outcome: "restricted",
  ground: "illegal",
  ruleId: null,
  rulesVersion: 3,
  redressVersion: 3,
  legalReference: null,
  facts: null,
  reason: null,
  source: "order",
  decidedAt: DISABLED_AT,
  post: { id: id(1), createdAt: "2026-10-01T08:30:00.000Z" },
  measures: [{ kind: "disable_by_order", mediaId: null, noEffect: null, sealed: null }],
  reversals: [],
  endedMeasures: [],
  reviewed: null,
  order: facts,
  appealUntil: null,
  reversedOn: null,
  content: null,
  appeal: null,
  strike: null,
  standing: null,
  orderTexts: { reasons: "Der Beitrag ruft zu Gewalt auf.", redress: "Klage beim Verwaltungsgericht Wiesbaden.", scope: null, textsAt: DISABLED_AT, reasonsAt: DISABLED_AT },
  erasedOn: null,
  ...extra,
});

describe("the notice of an authority's order (9.3)", () => {
  test("titled as a notice, its paragraphs ORDER_NOTICE's, the authority's words whole in their own labelled block, no post, no appeal, and the app's three sentences", () => {
    const view = notice();
    expect(DecisionView.safeParse(view).success).toBe(true);
    const out = html(<DecisionDetail view={view} onAppeal={async () => undefined} />);
    const read = textOf(out);
    expect(out).toContain('role="article"');
    expect(out).toMatch(/aria-level="1"[^>]*>Notice: an authority&#x27;s order</);
    for (const paragraph of statementParagraphs(view, { texts: view.orderTexts ?? null, erasedOn: null })) expect(read).toContain(paragraph);
    expect(out).toContain(`aria-label="${ORDER_NOTICE.wordsBlock.replace("'", "&#x27;")}"`);
    expect(read).toContain(`${ORDER_NOTICE.reasonsLabel} Der Beitrag ruft zu Gewalt auf.`);
    expect(read).toContain(`${ORDER_NOTICE.redressLabel} Klage beim Verwaltungsgericht Wiesbaden.`);
    expect(read).not.toContain(ORDER_NOTICE.scopeLabel);
    expect(read).toContain(ORDER_TEXTS.notice.noContent);
    expect(read).toContain(ORDER_TEXTS.notice.noAppeal);
    expect(read).toContain("If the order does not name this post, korbat made a mistake that it can correct itself.");
    expect(read).toContain(ORDER_TEXTS.notice.fresh);
    expect(read).not.toContain(DECISION_WORDS.appeal);
    // The heading is the notice's, never "korbat's decision" (the notice's own paragraphs say that it is not korbat's).
    expect(out).not.toMatch(new RegExp(`aria-level="2"[^>]*>${DECISION_WORDS.title.replace("'", "&#x27;")}<`));
  });

  test("3f's review (people5): a DSA order that does not withhold leaves the post to its author, and the note says so, never that only authorities see it", () => {
    const removed = notice({ order: { ...facts, kind: "dsa_art9", withholdAuthor: false, preserveUntil: null, preserveFirstUntil: null } });
    expect(DecisionView.safeParse(removed).success).toBe(true);
    const read = textOf(html(<DecisionDetail view={removed} />));
    expect(read).toContain(ORDER_TEXTS.notice.noContentRemoved);
    expect(read).toContain(ORDER_NOTICE.done.removed("2026-10-01 08:30 UTC", `/post/${id(1)}`, "2026-10-16 09:00 UTC"));
    expect(read).not.toContain(ORDER_TEXTS.notice.noContent);
    expect(read).not.toContain("only to the authorities");
    // A measure that withholds keeps the first note.
    expect(textOf(html(<DecisionDetail view={notice()} />))).not.toContain(ORDER_TEXTS.notice.noContentRemoved);
  });

  test("without the authority's words, no block; the notice says they follow", () => {
    const read = textOf(html(<DecisionDetail view={notice({ orderTexts: { reasons: null, redress: null, scope: null, textsAt: null, reasonsAt: null } })} />));
    expect(read).not.toContain(ORDER_NOTICE.wordsBlock);
    expect(read).toContain(ORDER_NOTICE.textsFollow);
  });

  test("the reinstatement's notice: its ground's paragraph, the post shown again, no [notice.wrongItem]", () => {
    const view = notice({
      kind: "correction",
      outcome: "reversed",
      reviewsDecisionId: id(3),
      measures: [],
      reversals: [{ kind: "reinstate_by_order", mediaId: null, liftedKind: "disable_by_order", noEffect: null, resetDecisionId: null, oldValueKept: false, resetRuleId: null }],
      order: { ...facts, orderGround: "withdrawn" },
      content: { kind: "post", body: "the words of the post", deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
    } as unknown as Partial<DecisionView>);
    const read = textOf(html(<DecisionDetail view={view} />));
    expect(read).toContain(ORDER_NOTICE.reinstated.ground.withdrawn);
    expect(read).toContain(ORDER_NOTICE.lifted);
    expect(read).toContain("the words of the post");
    expect(read).not.toContain("If the order does not name this post");
  });
});

describe("Cases, the chip and the error (9.1, 9.3, 9.4)", () => {
  const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
    id: id(3),
    kind: "order",
    outcome: "restricted",
    decidedOn: "2026-10-16",
    post: { id: id(1), createdAt: "2026-10-01T08:30:00.000Z" },
    actions: ["disable_by_order"],
    endedInterim: false,
    ruleId: null,
    legal: true,
    appealUntil: null,
    reversedOn: null,
    appeal: null,
    strike: null,
    ...extra,
  });

  test("a row in its own words, and never a rule or the law of korbat's judgement", () => {
    const read = textOf(html(<DecisionsList decisions={[row({ order: "disabled" }), row({ id: id(4), order: "removed" }), row({ id: id(5), kind: "correction", outcome: "reversed", actions: ["reinstate_by_order"], order: "lifted" })]} />));
    expect(read).toContain(ORDER_TEXTS.row.disabled);
    expect(read).toContain(ORDER_TEXTS.row.removed);
    expect(read).toContain(ORDER_TEXTS.row.lifted);
    expect(read).not.toContain(CASES_WORDS.law);
  });

  test("3f's review (people9): an order's row shows the day its author was told, not the disabling's; other rows keep their decision's day", () => {
    const read = textOf(html(<DecisionsList decisions={[row({ order: "disabled", decidedOn: "2026-08-01", toldOn: "2026-10-16" }), row({ id: id(4), kind: "final", ruleId: "R1", legal: false, actions: ["remove"], decidedOn: "2026-09-01" })]} />));
    expect(read).toContain(ORDER_TEXTS.row.toldOn("2026-10-16"));
    expect(ORDER_TEXTS.row.toldOn("2026-10-16")).toBe("Told on 2026-10-16");
    expect(read).not.toContain(CASES_WORDS.decidedOn("2026-08-01"));
    expect(read).toContain(CASES_WORDS.decidedOn("2026-09-01"));
  });

  test("[chip.order] on a post a DSA order removed without withholding it; not_appealable in [notice.noAppeal]'s first words", () => {
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null, order: true })).toBe("Removed: an authority's order");
    expect(chipText({ decisionId: id(3), ruleId: null, legal: true, interim: false, strikeUntil: null })).not.toBe(ORDER_TEXTS.chip.order);
    expect(messageFor("not_appealable")).toBe(NOT_APPEALABLE);
    expect(ORDER_TEXTS.notice.noAppeal.startsWith(NOT_APPEALABLE)).toBe(true);
  });
});
```

### Replace `apps/app/test/public-pages.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, EDGE_CACHE, EDGE_WORDS, RECIPIENT_RULES, TRANSPARENCY_RULES, type PublicFacts, type PublicHead, type PublicTransparency, type TransparencyFigures } from "@korbat/contracts";
import { RULES, RULES_CHANGES, RULES_VERSION } from "@korbat/rules";

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/rules",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.

import { RulesView } from "../src/app/rules";
import { TransparencyView } from "../src/app/transparency";
import { PAGE_DOWN, RULES_PAGE, TOOL_TEXTS, TRANSPARENCY_PAGE, toolBlocks, type AutomationLimits } from "../src/lib/public-pages";
import { MEASURES_PARAGRAPH, TERMS_SECTIONS, termsParagraphs } from "../src/lib/terms";

/**
 * The two public pages (3d design, sections 9.1 to 9.3, 10.8 and 12.2; W.1 and W.2; Task 4): server-rendered checks of
 * both pages with every tool off, with the route down and with stored editions; TOOL_TEXTS in every state a tool can be
 * in; the rules page and the terms printing their numbered sentences with the same builders; every number of the words
 * held to its constant; and the smoke test's two lead sentences held to the pages' own.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
    .replace(/ +/g, " ");

const OFF: PublicFacts = {
  r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
  match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
  edge: { on: false, test: false },
  witness: { on: false, test: false },
  recipientsSignedOut: true,
  // 3d review M13: a keeper's address is set, as on a server ready to go public; the test of the keeper says otherwise.
  keeper: true,
};
const LIMITS: AutomationLimits = { decisionsPerHour: 20, decisionsPerDay: 100, r2DecisionsPerHour: 21, r2DecisionsPerDay: 101, unansweredMax: 22, unansweredHours: 72, refusalsPerHour: 23, objectionTargetHours: 24 };

describe("the rules page (3d Task 4)", () => {
  test("every rule with its text and its lists, the law, the measures and the numbered sections, every tool off, and the change log newest first", () => {
    const markup = html(<RulesView facts={OFF} />);
    const text = textOf(markup);
    expect(text).toContain(RULES_PAGE.lead);
    for (const rule of RULES) {
      expect(text).toContain(`${rule.id}: ${rule.title}`);
      expect(text).toContain(rule.text);
      for (const item of [...rule.allowed, ...rule.notAllowed]) expect(text).toContain(item);
    }
    expect(text).toContain(RULES_PAGE.law);
    expect(text).toContain(MEASURES_PARAGRAPH);
    for (const tool of [TOOL_TEXTS.r1.off, TOOL_TEXTS.match.off, TOOL_TEXTS.edge.off, TOOL_TEXTS.witness.off, RULES_PAGE.autoNone]) expect(text).toContain(tool);
    expect(text).not.toContain(PAGE_DOWN);
    expect(text).toContain(RULES_PAGE.version(RULES_VERSION));
    const changes = [...RULES_CHANGES].reverse().map((change) => text.indexOf(RULES_PAGE.change(change)));
    expect(changes.every((at) => at > -1)).toBe(true);
    expect([...changes].sort((a, b) => a - b)).toEqual(changes);
    // The headings, each a header of its level, and the links to the other page and to How Explore works.
    for (const heading of [RULES_PAGE.rulesHeading, RULES_PAGE.measuresHeading, RULES_PAGE.automationHeading, RULES_PAGE.versionHeading]) expect(markup).toContain(`aria-level="2"`);
    expect(markup).toContain('href="/transparency"');
    expect(markup).toContain('href="/explore/about"');
  });

  test("the numbered sentences are the terms' own: the same builders print Strikes, Suspension, Reporting in bad faith and Terrorist content in both", () => {
    const text = textOf(html(<RulesView facts={OFF} />));
    for (const title of ["Strikes", "Suspension and termination", "Reporting in bad faith", "Terrorist content"]) {
      const section = TERMS_SECTIONS.find((candidate) => candidate.title === title);
      expect(section, title).toBeDefined();
      for (const paragraph of termsParagraphs(section!.body)) expect(text).toContain(paragraph);
    }
    const decide = TERMS_SECTIONS.find((section) => section.title === "How moderators decide")!;
    expect(termsParagraphs(decide.body)).toContain(MEASURES_PARAGRAPH);
  });

  test("while the facts are read the automation section holds its lead alone; when the route does not answer it reads [page.down] and prints no tool as off or on", () => {
    for (const [facts, down] of [["loading", false], ["down", true]] as const) {
      const text = textOf(html(<RulesView facts={facts} />));
      expect(text).toContain(RULES_PAGE.autoLead);
      expect(text.includes(PAGE_DOWN)).toBe(down);
      for (const tool of [TOOL_TEXTS.r1.off, TOOL_TEXTS.match.off, TOOL_TEXTS.edge.off, TOOL_TEXTS.witness.off, RULES_PAGE.autoNone]) expect(text).not.toContain(tool);
      expect(text).toContain(RULES_PAGE.lead);
    }
  });

  test("with a tool that rates or compares images on, the caps and the target from the limits, and no [rules.auto.none]", () => {
    const on = { ...OFF, match: { state: "alerts", test: true, source: "test", dpia: "2026-10-01", dpiaActs: null } } as PublicFacts;
    const text = textOf(html(<RulesView facts={on} limits={LIMITS} />));
    expect(text).toContain(RULES_PAGE.autoCap(LIMITS));
    expect(text).toContain(RULES_PAGE.autoTarget(LIMITS.objectionTargetHours));
    expect(text).not.toContain(RULES_PAGE.autoNone);
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("at most 20 measures an hour and 100 a day under rule R1, and at most 21 an hour and 101 a day under rule R2");
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("while 22 of its measures");
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("refuses at most 23 uploads an hour");
  });

  test("3d Task 6: the page passes the contracts' AUTOMATION_RULES as its limits, so the caps it prints are the database's", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/rules.tsx"), "utf8");
    expect(source).toContain("<RulesView facts={facts} limits={AUTOMATION_RULES} />");
    const on = { ...OFF, r1: { ...OFF.r1, state: "withholds", test: true } } as PublicFacts;
    const text = textOf(html(<RulesView facts={on} limits={AUTOMATION_RULES} />));
    expect(text).toContain(RULES_PAGE.autoCap(AUTOMATION_RULES));
    expect(text).toContain(RULES_PAGE.autoTarget(AUTOMATION_RULES.objectionTargetHours));
    expect(RULES_PAGE.autoCap(AUTOMATION_RULES)).toContain(`at most ${AUTOMATION_RULES.decisionsPerHour} measures an hour and ${AUTOMATION_RULES.decisionsPerDay} a day under rule R1`);
  });
});

describe("TOOL_TEXTS in each state (3d Task 4, W.1)", () => {
  const blockOf = (facts: PublicFacts, tool: string) => toolBlocks(facts).find((block) => block.tool === tool)!;

  test("every tool off, as the facts route answers until the tasks that build them: each block its off text alone", () => {
    expect(toolBlocks(OFF).map((block) => [block.tool, block.on, block.paragraphs])).toEqual([
      ["r1", false, [TOOL_TEXTS.r1.off]],
      ["match", false, [TOOL_TEXTS.match.off]],
      ["edge", false, [TOOL_TEXTS.edge.off]],
      ["witness", false, [TOOL_TEXTS.witness.off]],
    ]);
  });

  test("review M13: with no keeper's address the witness's block off says the value stands on the Transparency page alone, and names no person", () => {
    expect(blockOf({ ...OFF, keeper: false }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.offAlone]);
    expect(TOOL_TEXTS.witness.offAlone).toBe("Outside timestamp for the audit log's daily value: off. The value stands on korbat's Transparency page alone.");
    expect(TOOL_TEXTS.witness.offAlone).not.toMatch(/person|mail/);
    expect(blockOf(OFF, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.off]);
  });

  test("the R1 check flagging, withholding and on a test adapter; its model's facts; its own dates, the measure's only while it acts", () => {
    const model = { model: "Marqo/nsfw-image-detection-384", digest: "ab".repeat(32), threshold: 0.9, thresholdVersion: 2, publisherClaim: "a claim" };
    const flags = blockOf({ ...OFF, r1: { ...OFF.r1, ...model, state: "flags", dpia: "2026-10-01", dpiaActs: "2026-10-02" } }, "r1");
    expect(flags.paragraphs).toEqual([TOOL_TEXTS.r1.flags, TOOL_TEXTS.r1.facts(model), RULES_PAGE.dpia("2026-10-01")]);
    const withholds = blockOf({ ...OFF, r1: { ...OFF.r1, ...model, state: "withholds", dpia: "2026-10-01", dpiaActs: "2026-10-02" } }, "r1");
    expect(withholds.paragraphs).toEqual([TOOL_TEXTS.r1.withholds, TOOL_TEXTS.r1.facts(model), RULES_PAGE.dpia("2026-10-01"), RULES_PAGE.dpiaActs("2026-10-02")]);
    const test = blockOf({ ...OFF, r1: { ...OFF.r1, state: "flags", test: true } }, "r1");
    expect(test.paragraphs).toEqual([TOOL_TEXTS.r1.flags.replace(": on.", ": on (test adapter).")]);
    expect(TOOL_TEXTS.r1.facts(model)).toContain('Its publisher states: "a claim".');
    // A date set for one tool never stands over another.
    expect(blockOf({ ...OFF, r1: { ...OFF.r1, state: "flags", dpia: "2026-10-01" } }, "match").paragraphs).toEqual([TOOL_TEXTS.match.off]);
  });

  test("the comparison with known material alerting and sealing, with its source's name, on a test adapter, and with its dates", () => {
    const alerts = blockOf({ ...OFF, match: { state: "alerts", test: false, source: "Source A", dpia: "2026-10-03", dpiaActs: "2026-10-04" } }, "match");
    expect(alerts.paragraphs).toEqual([TOOL_TEXTS.match.alerts("Source A"), RULES_PAGE.dpia("2026-10-03")]);
    const seals = blockOf({ ...OFF, match: { state: "seals", test: true, source: "test", dpia: "2026-10-03", dpiaActs: "2026-10-04" } }, "match");
    expect(seals.paragraphs).toEqual([TOOL_TEXTS.match.seals("test").replace(": on,", ": on (test adapter),"), RULES_PAGE.dpia("2026-10-03"), RULES_PAGE.dpiaActs("2026-10-04")]);
    // match.seals is match.alerts up to "what happens to the file." and its own words after it.
    const cut = "what happens to the file.";
    expect(TOOL_TEXTS.match.seals("S").slice(0, TOOL_TEXTS.match.seals("S").indexOf(cut))).toBe(TOOL_TEXTS.match.alerts("S").slice(0, TOOL_TEXTS.match.alerts("S").indexOf(cut)));
  });

  test("the edge and the witness, off, on and on a test adapter; the edge's minutes are the header's", () => {
    expect(blockOf({ ...OFF, edge: { on: true, test: false } }, "edge").paragraphs).toEqual([TOOL_TEXTS.edge.on]);
    expect(blockOf({ ...OFF, edge: { on: true, test: true } }, "edge").paragraphs).toEqual([TOOL_TEXTS.edge.on.replace(": on.", ": on (test adapter).")]);
    expect(blockOf({ ...OFF, witness: { on: true, test: false } }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.on]);
    expect(blockOf({ ...OFF, witness: { on: true, test: true } }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.on.replace(": on.", ": on (test adapter).")]);
    expect(TOOL_TEXTS.edge.off).toContain(`for up to ${EDGE_WORDS.edgeMinutes} minutes, and a copy in a browser for up to ${EDGE_CACHE.browserSeconds / 60} minute.`);
    expect(TOOL_TEXTS.edge.on).toContain(`up to ${EDGE_WORDS.edgeMinutes} minutes at the provider, up to ${EDGE_CACHE.browserSeconds / 60} minute in a browser.`);
  });

  test("3d Task 8 (12.2): the R1 check and the comparison in the four states a tool can be in: off from the start, on, on with its measure, and off again after it ran, which reads as off from the start; each off text says that korbat keeps nothing of the tool, which the retention job's step tools_off makes true (automation-retention.test.ts holds the database to it)", () => {
    const r1 = (state: PublicFacts["r1"]["state"]) => blockOf({ ...OFF, r1: { ...OFF.r1, state } }, "r1").paragraphs[0];
    const match = (state: PublicFacts["match"]["state"]) => blockOf({ ...OFF, match: { ...OFF.match, state, source: state === "off" ? null : "Source A" } }, "match").paragraphs[0];
    expect([r1("off"), r1("flags"), r1("withholds"), r1("off")]).toEqual([TOOL_TEXTS.r1.off, TOOL_TEXTS.r1.flags, TOOL_TEXTS.r1.withholds, TOOL_TEXTS.r1.off]);
    expect([match("off"), match("alerts"), match("seals"), match("off")]).toEqual([TOOL_TEXTS.match.off, TOOL_TEXTS.match.alerts("Source A"), TOOL_TEXTS.match.seals("Source A"), TOOL_TEXTS.match.off]);
    // While on, the rating and the fingerprints are kept with the image; once off, none from the time it was on.
    expect(TOOL_TEXTS.r1.flags).toContain("korbat keeps the rating with the image");
    expect(TOOL_TEXTS.r1.withholds).toContain("korbat keeps the rating with the image");
    expect(TOOL_TEXTS.r1.off).toContain("korbat keeps no rating from a time when one did");
    expect(TOOL_TEXTS.match.alerts("S")).toContain("keeps them with the image");
    expect(TOOL_TEXTS.match.off).toContain("keeps no fingerprint from a time when it did, except the one in the record of a match");
  });

  test("no text says more than is known: never that an image is such material, that korbat confirmed it, or the same fingerprint of a picture's look", () => {
    const texts = [
      TOOL_TEXTS.r1.off,
      TOOL_TEXTS.r1.flags,
      TOOL_TEXTS.r1.withholds,
      TOOL_TEXTS.r1.facts({ model: "m", digest: "d", threshold: 0.5, thresholdVersion: 0, publisherClaim: "c" }),
      TOOL_TEXTS.match.off,
      TOOL_TEXTS.match.alerts("S"),
      TOOL_TEXTS.match.seals("S"),
      TOOL_TEXTS.edge.off,
      TOOL_TEXTS.edge.on,
      TOOL_TEXTS.witness.off,
      TOOL_TEXTS.witness.on,
      RULES_PAGE.autoLead,
    ];
    for (const text of texts) {
      for (const phrase of ["is child sexual abuse material", "confirmed", "posted such", "the same fingerprint", "does nothing to your account", "Whatever it does", "no longer holds", "@"]) expect([phrase, text.includes(phrase)]).toEqual([phrase, false]);
    }
  });
});

describe("the transparency page (3d Task 4)", () => {
  const empty: TransparencyFigures = {
    restrictions: { byGround: [], byMeasure: [], total: "0" },
    noBreach: "0",
    intakes: [],
    appeals: [],
    reexaminations: [],
    accountMeasures: [],
    automated: { findings: [], measures: [] },
    recipients: "not recorded",
  };
  const full: TransparencyFigures = {
    restrictions: {
      byGround: [
        { label: "R1", count: "about 60" },
        { label: "law", count: "about 10" },
        { label: "other", count: "about 10" },
      ],
      byMeasure: [
        { label: "remove", count: "about 70" },
        { label: "other", count: "1 to 9" },
      ],
      total: "about 80",
    },
    noBreach: "about 140",
    intakes: [
      { label: "rules", count: "about 30" },
      { label: "illegal", count: "about 10" },
    ],
    appeals: [{ label: "kept", count: "about 10" }],
    reexaminations: [{ label: "no_action", count: "about 20" }],
    accountMeasures: [{ label: "strike", count: "about 10" }],
    automated: { findings: [], measures: [] },
    orders: {
      received: { total: 2, crossBorder: 1 },
      itemsDisabled: 3,
      minutes: { list: [10, 125], outside: 1, withoutReceipt: 0, open: 0 },
      annex3: { force_majeure: 0, manifest_error: 0, insufficient_information: 1 },
      scrutiny: { requested: 1, annulled: 0, upheld: 1 },
      reinstated: { withdrawn: 0, annulled: 1, scrutiny: 0, not_authentic: 0, wrong_item: 0 },
      authorityAccess: null,
      terroristWithoutOrder: 1,
      referralsClosed: 0,
    },
    recipients: { low: "about 120", high: "about 340" },
  };
  const answer: PublicTransparency = {
    editions: [
      { year: 2025, version: 2, publishedOn: "2026-05-02", method: 1, reason: "hold_ended", figures: full, older: [{ version: 1, publishedOn: "2026-03-01", replacedOn: "2026-05-02", reason: "first", figures: empty }] },
      { year: 2024, version: 1, publishedOn: "2025-03-01", method: 1, reason: "first", figures: { ...empty, recipients: { low: "1 to 9" } }, older: [] },
    ],
  };

  test("each year newest first with its edition line, the reason of its newest version, its tables, its older versions and its recipients; the method once", () => {
    const markup = html(<TransparencyView answer={answer} />);
    const text = textOf(markup);
    for (const fixed of [TRANSPARENCY_PAGE.lead, TRANSPARENCY_PAGE.read, TRANSPARENCY_PAGE.tdb]) expect(text).toContain(fixed);
    expect(text.indexOf(TRANSPARENCY_PAGE.edition(2025, 2, "2026-05-02", 1))).toBeLessThan(text.indexOf(TRANSPARENCY_PAGE.edition(2024, 1, "2025-03-01", 1)));
    expect(text).toContain(TRANSPARENCY_PAGE.reason.hold_ended);
    expect(text).toContain(`${TRANSPARENCY_PAGE.labels.ground("R1")}: about 60`);
    expect(TRANSPARENCY_PAGE.labels.ground("R1")).toBe(`Rule R1: ${RULES[0]!.title}`);
    for (const line of ["The law: about 10", "Other grounds: about 10", "All restrictions: about 80", "Remove: about 70", "Other measures: 1 to 9", "Decisions that found no breach: about 140"]) expect(text).toContain(line);
    for (const line of ["Reports under korbat's rules: about 30", "Notices of illegal content (Article 16 of the Digital Services Act): about 10", "Decision kept: about 10", "No action again: about 20", "Strike: about 10"]) expect(text).toContain(line);
    // A table with no row reads its "none" sentence.
    expect(text).toContain(`${TRANSPARENCY_PAGE.tables.automated} ${TRANSPARENCY_PAGE.tableNone}`);
    // The order section's numbers, small ones too, and a figure the rows cannot give as not recorded.
    for (const line of [
      TRANSPARENCY_PAGE.orders,
      TRANSPARENCY_PAGE.orderLines.received("2", "1"),
      TRANSPARENCY_PAGE.orderLines.itemsDisabled("3"),
      TRANSPARENCY_PAGE.orderLines.minutes("10, 125"),
      TRANSPARENCY_PAGE.orderLines.outside("1"),
      TRANSPARENCY_PAGE.orderLines.annex3("force majeure 0, manifest error 0, insufficient information 1"),
      TRANSPARENCY_PAGE.orderLines.scrutiny("1", "0", "1"),
      TRANSPARENCY_PAGE.orderLines.access("not recorded"),
      TRANSPARENCY_PAGE.orderLines.terrorist("1"),
    ]) {
      expect(text).toContain(line);
    }
    // The standing sentence under every year, whether or not it has the section.
    expect(text.split(TRANSPARENCY_PAGE.ordersHeld).length - 1).toBe(2);
    expect(text).toContain(TRANSPARENCY_PAGE.recipients("2026-02", "about 120", "about 340"));
    expect(text).toContain(TRANSPARENCY_PAGE.recipientsOff("2025-02", "1 to 9"));
    expect(text).toContain(TRANSPARENCY_PAGE.versions);
    expect(text).toContain(TRANSPARENCY_PAGE.versionLine(1, "2026-03-01", "2026-05-02"));
    expect(text.split(TRANSPARENCY_PAGE.method(1)).length - 1).toBe(1);
    expect(markup).toContain('href="/rules"');
    expect(markup).toContain('href="/explore/about"');
    // A public page points at no person: no handle, no id.
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("a correction says so with its day; no edition yet reads [tr.none]; a route that does not answer reads [page.down] beside the fixed texts", () => {
    const corrected: PublicTransparency = { editions: [{ ...answer.editions[1]!, version: 2, reason: "correction", publishedOn: "2025-06-01", older: [] }] };
    expect(textOf(html(<TransparencyView answer={corrected} />))).toContain(TRANSPARENCY_PAGE.reason.correction("2025-06-01"));
    const none = textOf(html(<TransparencyView answer={{ editions: [] }} />));
    expect(none).toContain(TRANSPARENCY_PAGE.none);
    expect(none).not.toContain(TRANSPARENCY_PAGE.ordersHeld);
    const down = textOf(html(<TransparencyView answer="down" />));
    expect(down).toContain(PAGE_DOWN);
    expect(down).toContain(TRANSPARENCY_PAGE.lead);
    expect(down).toContain(TRANSPARENCY_PAGE.tdb);
    expect(textOf(html(<TransparencyView answer="loading" />))).not.toContain(PAGE_DOWN);
  });

  test("review L12 (people10): recipients not recorded print as not recorded over the six months to the month, with the reason; never that korbat has not counted six full months", () => {
    const year: PublicTransparency = { editions: [{ ...answer.editions[1]!, figures: empty }] };
    const text = textOf(html(<TransparencyView answer={year} />));
    expect(text).toContain(TRANSPARENCY_PAGE.recipientsNotRecorded("2025-02"));
    expect(TRANSPARENCY_PAGE.recipientsNotRecorded("2025-02")).toBe(
      "Average monthly active recipients of korbat (Article 24(2) of the Digital Services Act), over the six months to 2025-02: not recorded. korbat holds a count for fewer than six of those months: it had not counted six full months by then, or the count of a month is missing, as after a restore of its database from a backup or a loss of its counting store during that month.",
    );
    expect(TRANSPARENCY_PAGE.recipientsNotRecorded("2025-02")).toContain(`: ${TRANSPARENCY_PAGE.notRecorded}.`);
    expect(text).not.toContain("has not counted six full months yet");
    expect(Object.keys(TRANSPARENCY_PAGE)).not.toContain("recipientsNotYet");
  });

  test("review L13 (people11): the table of uploads not accepted prints its total first, Uploads refused on a match, then the fates", () => {
    const uploads: TransparencyFigures["uploads"] = [
      { label: "refused", count: "about 20" },
      { label: "report", count: "about 10" },
      { label: "other", count: "1 to 9" },
    ];
    const text = textOf(html(<TransparencyView answer={{ editions: [{ ...answer.editions[1]!, figures: { ...empty, uploads } }] }} />));
    const total = text.indexOf("Uploads refused on a match: about 20");
    expect(total).toBeGreaterThan(text.indexOf(TRANSPARENCY_PAGE.tables.uploads));
    expect(text.indexOf("Held for a report: about 10")).toBeGreaterThan(total);
    expect(text.indexOf("Other: 1 to 9", total)).toBeGreaterThan(total);
  });

  test("every number of the page's words is its constant's: the due day, the floor, the rounding, the salt's hours; the recipients' last month is the one before the due day", () => {
    expect(TRANSPARENCY_PAGE.read).toContain(`on or after ${TRANSPARENCY_RULES.dueDay} March of the next year`);
    expect(TRANSPARENCY_PAGE.read).toContain(`korbat prints 0, "1 to ${TRANSPARENCY_RULES.floor - 1}"`);
    expect(TRANSPARENCY_PAGE.read).toContain("rounded to the nearest ten");
    expect(TRANSPARENCY_PAGE.read).toContain("fewer than ten");
    expect(TRANSPARENCY_PAGE.none).toContain(`${TRANSPARENCY_RULES.dueDay} March`);
    expect(TRANSPARENCY_PAGE.method(1)).toContain(`exists for ${RECIPIENT_RULES.saltHours} hours`);
    expect(TRANSPARENCY_PAGE.read).not.toContain("1 June");
  });
});

describe("the transparency page's daily value (3d Task 5, 9.3 item 6, W.2)", () => {
  const value = (c: string) => c.repeat(64);
  const head: PublicHead = {
    days: [
      { day: "2026-10-19", kind: "head", value: value("a"), witness: "rfc3161", token: "MAMCAQA=", retiredOn: null, lastDay: null },
      { day: "2026-10-18", kind: "restore", value: value("b"), witness: "none", token: null, retiredOn: null, lastDay: "2026-10-15" },
      { day: "2026-10-17", kind: "head", value: value("c"), witness: "none", token: null, retiredOn: "2026-10-18", lastDay: null },
      { day: "2026-10-15", kind: "head", value: value("d"), witness: "none", token: null, retiredOn: null, lastDay: null },
    ],
  };
  const T = TRANSPARENCY_PAGE;

  test("its section stands after the editions and before the Transparency Database: [tr.head], a row a day newest first with its value and its witness, [tr.restore], [tr.retired] and [tr.headMissing] in their places", () => {
    const text = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} />));
    const at = (part: string) => {
      expect(text, part).toContain(part);
      return text.indexOf(part);
    };
    const order = [
      at(T.none),
      at(T.headHeading),
      at(T.head),
      at(T.headRow("2026-10-19", value("a"), "rfc3161")),
      at(T.restore("2026-10-18", "2026-10-15")),
      at(T.headMissingRow("2026-10-18")),
      at(`${T.headRow("2026-10-17", value("c"), "none")} ${T.retired("2026-10-18")}`),
      at(T.headMissingRow("2026-10-16")),
      at(T.headRow("2026-10-15", value("d"), "none")),
      at(T.tdbHeading),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // A restore that found nothing that still fits says so; a day after the newest row is not shown as missing.
    expect(T.restore("2026-10-18", null)).toBe("2026-10-18: korbat restored its database from a backup. No value above still fits the restored log.");
    expect(text).not.toContain(T.headMissingRow("2026-10-20"));
    expect(text).not.toContain(T.headMissingRow("2026-10-14"));
    // A public page points at no person, and the head's place is in no row.
    expect(text).not.toMatch(/@|chainSeq|chain_seq|Place:/);
  });

  test("while a shown row has a proof: [tr.verify] as the lab ran it, with that day's value and file, and the proof to download as <day>.tsr; without one, neither", () => {
    const markup = html(<TransparencyView answer={{ editions: [] }} head={head} />);
    const text = textOf(markup);
    expect(text).toContain(T.verify(value("a"), "2026-10-19"));
    expect(T.verify(value("a"), "2026-10-19")).toBe(
      `To check a day: download its proof, get the timestamp authority's certificates from the authority itself, and run: openssl ts -verify -digest ${value("a")} -in 2026-10-19.tsr -CAfile <certificates>. It answers "Verification: OK" when that authority signed this value at the time the proof states.`,
    );
    expect(text).toContain(T.download("2026-10-19"));
    // One row has a proof, so one download: the words before the day are the same for every row.
    expect(text.split(T.download("DAY").split("DAY")[0]!).length - 1).toBe(1);
    const unwitnessed: PublicHead = { days: head.days.map((row) => ({ ...row, witness: "none", token: null })) };
    const plain = textOf(html(<TransparencyView answer={{ editions: [] }} head={unwitnessed} />));
    expect(plain).not.toContain("openssl");
    expect(plain).not.toContain(T.download("2026-10-19"));
    expect(plain).toContain(T.headRow("2026-10-19", value("a"), "none"));
  });

  test("review L15 (people13): a test adapter's token turns on neither [tr.verify] nor a download; only a row witnessed by rfc3161 does", () => {
    const tested: PublicHead = { days: head.days.map((row) => (row.day === "2026-10-19" ? { ...row, witness: "test" as const } : row)) };
    const text = textOf(html(<TransparencyView answer={{ editions: [] }} head={tested} />));
    expect(text).toContain(T.headRow("2026-10-19", value("a"), "test"));
    expect(text).not.toContain("openssl");
    expect(text).not.toContain(T.download("2026-10-19"));
    // A newer test row and an older rfc3161 row: the check and the one download are the older row's.
    const mixed: PublicHead = {
      days: [
        { day: "2026-10-20", kind: "head", value: value("e"), witness: "test", token: "MAMCAQA=", retiredOn: null, lastDay: null },
        ...head.days,
      ],
    };
    const both = textOf(html(<TransparencyView answer={{ editions: [] }} head={mixed} />));
    expect(both).toContain(T.verify(value("a"), "2026-10-19"));
    expect(both).not.toContain(T.verify(value("e"), "2026-10-20"));
    expect(both).toContain(T.download("2026-10-19"));
    expect(both).not.toContain(T.download("2026-10-20"));
  });

  test("[page.down] for this part alone; no value yet reads its sentence; while it loads, the section holds [tr.head] alone", () => {
    const down = textOf(html(<TransparencyView answer={{ editions: [] }} head="down" />));
    expect(down).toContain(T.none);
    expect(down.split(PAGE_DOWN).length - 1).toBe(1);
    expect(down.indexOf(PAGE_DOWN)).toBeGreaterThan(down.indexOf(T.head));
    const both = textOf(html(<TransparencyView answer="down" head="down" />));
    expect(both.split(PAGE_DOWN).length - 1).toBe(2);
    expect(textOf(html(<TransparencyView answer={{ editions: [] }} head={{ days: [] }} />))).toContain(T.headNone);
    const loading = textOf(html(<TransparencyView answer={{ editions: [] }} head="loading" />));
    expect(loading).toContain(T.head);
    expect(loading).not.toContain(PAGE_DOWN);
    expect(loading).not.toContain(T.headNone);
  });

  test("review M13: the keeper's sentence follows [tr.head] only while a keeper's address is set; without one the page names no person; until the facts answer, neither", () => {
    const withKeeper = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} keeper={true} />));
    expect(withKeeper).toContain(`${T.head} ${T.headKeeper}`);
    const without = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} keeper={false} />));
    expect(without).toContain(`${T.head} ${T.headNoKeeper}`);
    expect(without).not.toContain("a person who does not run the server");
    const unknown = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} />));
    expect(unknown).not.toContain(T.headKeeper);
    expect(unknown).not.toContain(T.headNoKeeper);
    // The page asks the facts route too, for the keeper's member alone.
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/transparency.tsx"), "utf8");
    expect(source).toContain('api("/api/public/facts", { schema: PublicFacts })');
  });

  test("its words are W.2's: [tr.head], [tr.headMissing], [tr.restore] and [tr.retired]", () => {
    expect(T.head).toBe(
      "Each day korbat publishes one value computed from the day and the newest entry of its staff audit log, the record of everything korbat's staff confirm with their keys. If an earlier entry were changed or removed later, the log would no longer lead to the values published since. A value shows neither how many entries the log has nor any entry, and it differs from one day to the next also when nothing was added to the log. A value on korbat's own page proves nothing against korbat's operator, who could change this page too.",
    );
    // 3d review M13: the sentence that names the keeper, and the one printed in its place while no address is set.
    expect(T.headKeeper).toBe("So the same value goes each day to a person who does not run the server, and, when the outside timestamp is on, to a timestamp authority.");
    expect(T.headNoKeeper).toBe("When the outside timestamp is on, the same value goes each day to a timestamp authority.");
    expect(T.headMissingRow("2026-10-16")).toBe("2026-10-16: no value was published");
    expect(T.restore("2026-10-18", "2026-10-15")).toBe("2026-10-18: korbat restored its database from a backup. The newest value above that still fits the restored log is of 2026-10-15.");
    expect(T.retired("2026-10-18")).toBe("retired by the restore of 2026-10-18: true when published, and fits no log now");
  });
});

describe("the smoke test looks for the pages' own lead sentences in the bundle (3d Task 4, 12.2)", () => {
  test("scripts/smoke-auth-stack.mjs holds RULES_PAGE.lead and TRANSPARENCY_PAGE.lead word for word", () => {
    const smoke = readFileSync(path.resolve(import.meta.dirname, "../../../scripts/smoke-auth-stack.mjs"), "utf8");
    expect(smoke).toContain(RULES_PAGE.lead);
    expect(smoke).toContain(TRANSPARENCY_PAGE.lead);
  });
});
```

### Replace `apps/app/test/report.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CSAM_KEYWORDS, CSAM_NOTICE_MAX_ACCOUNTS, NOTICE_LIMITS, REPORT_RULE_IDS, TDB_FORM_CATEGORIES, type HiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { RULES } from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  return "contact@korbat.local";
});

import Report from "../src/app/report";
import Terms from "../src/app/terms";
import { ReportForm, ReportSent } from "../src/components/moderation/ReportForm";
import { MediaGrid } from "../src/components/social/MediaGrid";
import { MediaViewerContent } from "../src/components/social/MediaViewer";
import { PostCard, QuoteEmbed } from "../src/components/social/PostCard";
import { ApiError, messageFor } from "../src/lib/api";
import {
  CONTACT_EMAIL,
  EMPTY_DRAFT,
  OTHER_LINKS_MAX,
  draftTargets,
  givenTarget,
  noticeFrom,
  profileOnly,
  profilesNamed,
  reportFailure,
  reportHref,
  ruleLine,
  statusLink,
  tooManyProfiles,
  waitWords,
  type GivenTarget,
  type ReportDraft,
} from "../src/lib/moderation";
import { CATEGORY_LABELS, CONTACT_WORDS, REPORT_WORDS, numberWord } from "../src/lib/moderation-words";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The report form and what leads to it in the web app (3c design, section 9): "Report" on posts, images and profiles, the
 * form's three grounds with every word of it, what it sends, its success screen, the three failures it words itself, and
 * the terms page's Contact section. The helpers that decide are called; the form and the screens are server-rendered in
 * each state, as explore.test.tsx renders its screens; what a static render cannot show (a request, a press) is read from
 * the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** The route parameters and the session the component under test reads; each test sets what it needs. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => route.params,
  usePathname: () => "/report",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// react-native-reanimated is mocked once for every test file in test/setup.ts.
// The human check's widget loads a script from Cloudflare; here it is a mark a test can find.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** The address of every link in the markup, in order. */
const hrefs = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));
/** The accessible name of every field in the markup. */
const fields = (markup: string): string[] => [...markup.matchAll(/<(?:input|textarea)\b[^>]*\baria-label="([^"]*)"/g)].map((match) => match[1]!.replace(/&#x27;/g, "'"));
/** Every element with this role, as its opening tag. */
const withRole = (markup: string, role: string): string[] => (markup.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`role="${role}"`));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST: GivenTarget = { kind: "post", id: id(1) };
const PROFILE: GivenTarget = { kind: "account", handle: "ada" };
const draft = (extra: Partial<ReportDraft> = {}): ReportDraft => ({ ...EMPTY_DRAFT, ...extra });
const form = (options: { signedIn?: boolean; given?: GivenTarget | null; initial?: Partial<ReportDraft> } = {}) =>
  html(<ReportForm signedIn={options.signedIn ?? true} given={options.given === undefined ? POST : options.given} initial={options.initial} />);

describe("3d (design, section 9.1): the rules page", () => {
  test("the form links The rules beside its list of rules", () => {
    const out = form({ initial: { ground: "rule" } });
    expect(out).toContain('href="/rules"');
    expect(textOf(out)).toContain("The rules");
    expect(form({ initial: { ground: "illegal" } })).not.toContain('href="/rules"');
  });
});

describe("the words", () => {
  test("the form's sentences are the design's, with their numbers printed from the contracts", () => {
    expect(REPORT_WORDS.question).toBe("What is wrong with it?");
    expect(REPORT_WORDS.grounds).toEqual({
      rule: "It breaks a korbat rule",
      illegal: "It is illegal",
      csam: "It is sexual abuse or exploitation of a child, child sexual abuse material, or grooming of a child",
    });
    expect(REPORT_WORDS.r2Instead).toBe("Child sexual abuse material: choose the third answer, which is anonymous.");
    expect(REPORT_WORDS.csamInstead).toBe("For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, choose the third answer, which is anonymous.");
    expect(Object.keys(REPORT_WORDS.keywords)).toEqual(Object.keys(CSAM_KEYWORDS));
    expect(REPORT_WORDS.keywords).toEqual({
      csam: "Sexual images or videos of a child",
      deepfake: "Such images made or altered by software",
      grooming: "An adult seeking sexual contact with a child",
      abuse: "Other sexual abuse or exploitation of a child, such as offering a child for sex",
    });
    expect(REPORT_WORDS.anonymous).toBe("This report is anonymous: korbat does not record who sent it, not even your account. Keep the link we show you to follow it.");
    expect(REPORT_WORDS.profileOnly).toBe(
      "If you can, report the post or the image itself: open it and choose Report. From a profile alone korbat cannot tell which image you mean, and its answer covers the images on all the profile's posts.",
    );
    expect(CSAM_NOTICE_MAX_ACCOUNTS).toBe(1);
    expect(REPORT_WORDS.oneProfile).toBe("On this path a report can name one profile. Send another report for the next one.");
    expect(REPORT_WORDS.bonaFide).toBe("I believe in good faith that the information in this report is accurate and complete.");
    expect(REPORT_WORDS.contactHint).toBe("Without an email we cannot send you a receipt or our decision. korbat never shows your name or email to the person you report.");
    expect(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`).toBe(
      "korbat uses what you send only to handle this report; how long it keeps it is in the terms. Moderators see who sent a report only when a case needs it, for example when you report an account impersonating you; each time is recorded and shown to every staff member. If the person you report asks korbat for their data, the law may require korbat to give them what you wrote, never your name, email or account.",
    );
    expect(REPORT_WORDS.turnstile).toBe("Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check.");
    expect(REPORT_WORDS.keepLink).toBe("Keep this link to follow your report or ask for a decision to be re-examined. It is shown only now.");
    expect(REPORT_WORDS.followInSettings).toBe("You can follow it under Settings, Cases, Your reports.");
    expect([REPORT_WORDS.control, REPORT_WORDS.imageControl, REPORT_WORDS.link, REPORT_WORDS.otherItems, REPORT_WORDS.explanation, REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]).toEqual([
      "Report",
      "Report this image",
      "Link to the post or profile on korbat",
      "Other items",
      "Anything the moderator should know",
      "Which law or country (optional)",
      "Why is it illegal?",
      "Your name (optional)",
      "Your email (optional)",
    ]);
    expect(numberWord(9)).toBe("nine");
    expect(REPORT_WORDS.otherItemsHint).toBe("You can add up to nine more korbat links.");
    expect(OTHER_LINKS_MAX).toBe(NOTICE_LIMITS.maxTargets - 1);
  });

  test("the three failures the form words itself name the contact address, the limits and the wait", () => {
    const mail = "email your report to contact@korbat.local with the korbat links of what you report and why. Do not attach images or files: korbat does not open them.";
    expect(REPORT_WORDS.humanCheckFailed(CONTACT)).toBe(`The check that you are not a bot failed. Try again, or ${mail}`);
    expect(REPORT_WORDS.rateLimited("20 minutes", CONTACT)).toBe(
      `korbat cannot take another report from this network or account right now: it takes at most 5 reports an hour and 20 a day without an account, and 10 an hour and 50 a day with one. Try again in about 20 minutes, or ${mail}`,
    );
    expect([NOTICE_LIMITS.signedOut, NOTICE_LIMITS.signedIn]).toEqual([{ perHour: 5, perDay: 20 }, { perHour: 10, perDay: 50 }]);
    expect(REPORT_WORDS.unavailable(CONTACT)).toBe(`korbat cannot take reports right now. Try again in a few minutes, or ${mail}`);
    expect(REPORT_WORDS.mailShowsAddress).toBe("An email shows korbat your address. korbat deletes your email, and its reply to you, once your report is entered.");
  });

  test("every category the illegal ground offers has a name, and the app's table words the codes the form can meet", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...TDB_FORM_CATEGORIES].sort());
    expect(new Set(Object.values(CATEGORY_LABELS)).size).toBe(TDB_FORM_CATEGORIES.length);
    expect(messageFor("notice_link_invalid")).toBe("That link does not name a post or a profile on korbat.");
    expect(messageFor("notice_link_offsite")).toBe("Only links to this korbat can be reported.");
    expect(messageFor("already_reported")).toBe("You already reported this; it is being looked at.");
    expect(messageFor("staff_cannot_report")).toBe("A staff account does not send reports. Open a finding in the staff console instead.");
    expect(messageFor("notice_not_found")).toBe("We could not find a report with this link.");
    expect(messageFor("human_check_failed")).toBe("We could not verify that you are human. Try again.");
  });
});

describe("what leads to the form", () => {
  test("the form's address names the post, the image of a post, or the profile it is opened on, and reads it back", () => {
    expect(reportHref()).toBe("/report");
    expect(reportHref({ post: id(1) })).toBe(`/report?post=${id(1)}`);
    expect(reportHref({ post: id(1), media: id(2) })).toBe(`/report?post=${id(1)}&media=${id(2)}`);
    expect(reportHref({ account: "ada" })).toBe("/report?account=ada");
    expect(givenTarget({ post: id(1) })).toEqual({ kind: "post", id: id(1) });
    expect(givenTarget({ post: id(1), media: id(2) })).toEqual({ kind: "post", id: id(1), mediaId: id(2) });
    expect(givenTarget({ account: "@Ada" })).toEqual({ kind: "account", handle: "ada" });
    // Anything the API would refuse names nothing: the form then asks for a link.
    for (const params of [{}, { post: "nope" }, { account: "a b" }, { media: id(2) }, { post: ["x"] }]) expect(givenTarget(params), JSON.stringify(params)).toBeNull();
  });

  const image = (n: number): MediaView => ({ id: id(n), width: 800, height: 600, blurhash: "LEHV6nWB2yk8", alt: `picture ${n}`, small: `/api/media/${id(n)}/small.webp`, large: `/api/media/${id(n)}/large.webp` });
  const hidden = (n: number): HiddenMedia => ({ id: id(n), hidden: true });
  const post = (n: number, extra: Partial<PostView> = {}): PostView => ({
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
  });
  const me = (userId: string) => ({ status: "signed-in", me: { user: { id: userId, onboarded: true }, profile: { handle: "me" } } });

  test("a post that is not the reader's own has Report in its action row, signed in or out; the reader's own has none", () => {
    for (const state of [{ status: "signed-out" }, me(id(901))]) {
      session.state = state;
      const out = html(<PostCard post={post(1)} />);
      expect(hrefs(out)).toContain(`/report?post=${id(1)}`);
      expect(textOf(out)).toContain("Report");
    }
    session.state = me(id(900));
    const own = html(<PostCard post={post(1)} />);
    expect(hrefs(own).filter((href) => href.startsWith("/report"))).toEqual([]);
    session.state = { status: "signed-out" };
  });

  test("the viewer reports an image on the post that holds it: opened from a post it names that post, and nothing for a hidden image or the reader's own post", () => {
    const noop = () => undefined;
    const media = [image(11), hidden(12)];
    const shown = html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} postId={id(2)} />);
    expect(hrefs(shown)).toEqual([`/report?post=${id(2)}&media=${id(11)}`]);
    expect(textOf(shown)).toContain("Report this image");
    // A hidden image has nothing to report by; the post's own Report still names the post.
    expect(hrefs(html(<MediaViewerContent media={media} index={1} onIndex={noop} onClose={noop} postId={id(2)} />))).toEqual([]);
    // Without a post to report on (the reader's own post), the viewer offers nothing.
    expect(hrefs(html(<MediaViewerContent media={media} index={0} onIndex={noop} onClose={noop} />))).toEqual([]);
  });

  test("the grid hands the viewer its post, and a quoted post's images belong to the quoted post", () => {
    const grid = read("components", "social", "MediaGrid.tsx");
    // 3d Task 1: the viewer is also told whether the reader wrote the post, for an image that fails to load.
    expect(grid).toContain("<MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />");
    const card = read("components", "social", "PostCard.tsx");
    expect(card).toContain("<MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />");
    expect(card).toContain("<MediaGrid media={quote.media} compact postId={quote.id} />");
    // The quote is one link to the quoted post, where the grid and the viewer are: its squares open nothing themselves.
    const quoted = { ...post(2, { media: [image(21)] }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(hrefs(out)).toEqual([`/post/${id(2)}`, "/u/ada"]);
    expect(html(<MediaGrid media={[image(1)]} postId={id(5)} />)).not.toContain("/report");
  });

  test("a profile has Report beside Mute and Block, and signed out too", () => {
    const profile = read("app", "u", "[handle]", "index.tsx");
    // Anyone but the profile's owner is offered it.
    expect(profile).toContain("const report = own ? null : (");
    expect(profile).toContain("<Link href={reportHref({ account: profile.handle })} asChild>");
    // In the row of the signed-in controls, after Block; and alone in their place when they are not shown.
    const row = profile.slice(profile.indexOf("{me && !own && viewer ? ("), profile.indexOf("{!own && !(me && viewer) ?"));
    expect(row.indexOf("Block</Text>")).toBeGreaterThan(row.indexOf("Mute"));
    expect(row.indexOf("{report}")).toBeGreaterThan(row.indexOf("Block</Text>"));
    expect(profile).toContain('{!own && !(me && viewer) ? <View className="mt-3 flex-row">{report}</View> : null}');
  });

  test("the terms page ends with a Contact section built from the build's address, and a link to the form, which needs no account", () => {
    expect(CONTACT_EMAIL).toBe(CONTACT);
    const out = html(<Terms />);
    const text = textOf(out);
    expect(CONTACT_WORDS.body(CONTACT)).toBe(
      "Write to korbat at contact@korbat.local when the report form does not work for you, to ask for your data, or about a decision. A person reads every email. Do not attach images or files: korbat does not open them.",
    );
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text).toContain("Report something on korbat");
    expect(hrefs(out)).toContain("/report");
    // After the terms' own sections, of which it is no part, and before the link to the form.
    expect(TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
    const last = TERMS_SECTIONS.at(-1)!.title;
    expect(text.indexOf(last)).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf("Report something on korbat"));
    // The form is no settings screen: the settings layout would send a signed-out reader to sign in.
    expect(read("app", "report.tsx")).not.toContain("SettingsNav");
  });
});

describe("the form", () => {
  test("asks what is wrong with three choices of equal weight, each a radio of one group, none chosen at first", () => {
    const out = form();
    const text = textOf(out);
    expect(text).toContain("What is wrong with it?");
    const at = Object.values(REPORT_WORDS.grounds).map((label) => text.indexOf(label));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(withRole(out, "radiogroup")).toHaveLength(1);
    const radios = withRole(out, "radio");
    expect(radios).toHaveLength(3);
    for (const radio of radios) expect(radio).toContain('aria-checked="false"');
    // Nothing of a ground shows before one is chosen, and nothing can be sent.
    for (const words of [REPORT_WORDS.whichRule, REPORT_WORDS.whyIllegal, REPORT_WORDS.which, REPORT_WORDS.anonymous]) expect(text).not.toContain(words);
    expect(text).toContain(REPORT_WORDS.missing.ground);
  });

  test("the rule ground lists the rules that can be reported, each with its title and one line, R2 replaced by the pointer to the third answer, and an optional note", () => {
    const out = form({ initial: { ground: "rule" } });
    const text = textOf(out);
    for (const ruleId of REPORT_RULE_IDS) {
      const rule = RULES.find((entry) => entry.id === ruleId)!;
      expect(text, ruleId).toContain(`${rule.id}: ${rule.title}`);
      expect(text, ruleId).toContain(ruleLine(rule));
    }
    const r2 = RULES.find((entry) => entry.id === "R2")!;
    expect(text).not.toContain(r2.title);
    expect(text).toContain(REPORT_WORDS.r2Instead);
    // In R2's place: after R1 and before R3.
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeGreaterThan(text.indexOf("R1: "));
    expect(text.indexOf(REPORT_WORDS.r2Instead)).toBeLessThan(text.indexOf("R3: "));
    expect(fields(out)).toEqual([REPORT_WORDS.explanation]);
    expect(out.toLowerCase()).toContain(`maxlength="${NOTICE_LIMITS.explanationMax}"`);
    expect(ruleLine({ text: "One sentence. And another." })).toBe("One sentence.");
    expect(ruleLine({ text: "Only one" })).toBe("Only one");
  });

  test("the illegal ground asks for the category, not sure by default, points to the third answer directly below it, and asks why, the law, a rule and good faith", () => {
    const out = form({ initial: { ground: "illegal" } });
    const text = textOf(out);
    const categories = [REPORT_WORDS.categoryNotSure, ...TDB_FORM_CATEGORIES.map((category) => CATEGORY_LABELS[category])];
    for (const label of categories) expect(text, label).toContain(label);
    const checked = withRole(out, "radio").filter((tag) => tag.includes('aria-checked="true"'));
    // The ground itself, "I am not sure", and no rule beside the law.
    expect(checked).toHaveLength(3);
    // The pointer stands directly below the categories: after the last of them and before the next field.
    const pointer = text.indexOf(REPORT_WORDS.csamInstead);
    expect(pointer).toBeGreaterThan(Math.max(...categories.map((label) => text.indexOf(label))));
    expect(pointer).toBeLessThan(text.indexOf(REPORT_WORDS.citedLaw));
    expect(fields(out)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal]);
    // A rule it also breaks: every rule but R2, and none.
    expect(text).toContain(REPORT_WORDS.alsoRule);
    for (const ruleId of REPORT_RULE_IDS) expect(text).toContain(`${ruleId}: `);
    expect(text).not.toContain("R2: ");
    const box = withRole(out, "checkbox");
    expect(box).toHaveLength(1);
    expect(box[0]).toContain('aria-checked="false"');
    expect(text).toContain(REPORT_WORDS.bonaFide);
  });

  test("the anonymous path asks which it is, says that nobody is recorded, and asks for neither a name nor an email, signed in or out", () => {
    for (const signedIn of [true, false]) {
      const out = form({ signedIn, initial: { ground: "csam" } });
      const text = textOf(out);
      for (const label of Object.values(REPORT_WORDS.keywords)) expect(text).toContain(label);
      expect(text).toContain(REPORT_WORDS.anonymous);
      expect(fields(out)).toEqual([REPORT_WORDS.csamExplanation]);
      expect(text).not.toContain(REPORT_WORDS.contactHint);
      // Good faith may be stated, and is not asked for.
      expect(withRole(out, "checkbox")).toHaveLength(1);
      // The privacy line leaves out who sees the sender: this path records none.
      expect(text).toContain(REPORT_WORDS.privacy.use);
      expect(text).toContain(REPORT_WORDS.privacy.access);
      expect(text).not.toContain(REPORT_WORDS.privacy.sender);
    }
    // On the other grounds the line is whole.
    expect(textOf(form({ initial: { ground: "rule" } }))).toContain(`${REPORT_WORDS.privacy.use} ${REPORT_WORDS.privacy.sender} ${REPORT_WORDS.privacy.access}`);
  });

  test("on the anonymous path, for images, a report that names only a profile is asked for the post or the image, and never refused", () => {
    const images = (keyword: ReportDraft["keyword"], extra: Partial<ReportDraft> = {}) => draft({ ground: "csam", keyword, ...extra });
    expect(profileOnly(images("csam"), PROFILE)).toBe(true);
    expect(profileOnly(images("deepfake"), PROFILE)).toBe(true);
    // Not for grooming or other abuse, which are not about an image; not on another ground; not with a post beside it.
    expect(profileOnly(images("grooming"), PROFILE)).toBe(false);
    expect(profileOnly(images("abuse"), PROFILE)).toBe(false);
    expect(profileOnly(draft({ ground: "illegal", keyword: "csam" }), PROFILE)).toBe(false);
    expect(profileOnly(images("csam"), POST)).toBe(false);
    expect(profileOnly(images("csam", { others: ["http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    // A typed link to a profile is a profile too.
    expect(profileOnly(images("csam", { link: "http://localhost:8081/u/ada" }), null)).toBe(true);
    expect(profileOnly(images("csam", { link: "http://localhost:8081/post/" + id(2) }), null)).toBe(false);

    const out = form({ given: PROFILE, initial: { ground: "csam", keyword: "csam" } });
    expect(textOf(out)).toContain(REPORT_WORDS.profileOnly);
    // It can still be sent: the sentence asks, it does not refuse.
    const sent = noticeFrom(draft({ ground: "csam", keyword: "csam" }), PROFILE, { signedIn: true, turnstileToken: null });
    expect(sent).toEqual({ request: { ground: "csam", targets: [PROFILE], keyword: "csam" } });
    expect(textOf(form({ given: PROFILE, initial: { ground: "csam", keyword: "grooming" } }))).not.toContain(REPORT_WORDS.profileOnly);
    expect(textOf(form({ given: PROFILE, initial: { ground: "rule" } }))).not.toContain(REPORT_WORDS.profileOnly);
  });

  test("on the anonymous path a report names one profile at most: with a second the form says so before anything is sent", () => {
    const second = draft({ ground: "csam", keyword: "grooming", others: ["http://localhost:8081/u/bob"] });
    expect(profilesNamed(draftTargets(second, PROFILE))).toBe(2);
    expect(tooManyProfiles(second, PROFILE)).toBe(true);
    expect(noticeFrom(second, PROFILE, { signedIn: true, turnstileToken: null })).toEqual({ problem: REPORT_WORDS.oneProfile });
    expect(textOf(form({ given: PROFILE, initial: second }))).toContain(REPORT_WORDS.oneProfile);
    // The same profile named twice is one profile, a post beside it is no profile, and other grounds have no such limit.
    expect(tooManyProfiles(draft({ ground: "csam", keyword: "csam", others: ["http://localhost:8081/u/ADA", "http://localhost:8081/post/" + id(2)] }), PROFILE)).toBe(false);
    expect(tooManyProfiles({ ...second, ground: "rule" }, PROFILE)).toBe(false);
    expect(textOf(form({ given: PROFILE, initial: { ...second, ground: "rule", ruleId: "R6" } }))).not.toContain(REPORT_WORDS.oneProfile);
  });

  test("signed out, the illegal ground asks for an optional name and email, and every ground shows the human check with its sentence; signed in, none of it", () => {
    for (const ground of ["rule", "illegal", "csam"] as const) {
      const out = form({ signedIn: false, initial: { ground } });
      expect(out, ground).toContain('data-turnstile="widget"');
      expect(textOf(out), ground).toContain(REPORT_WORDS.turnstile);
      const signedIn = form({ signedIn: true, initial: { ground } });
      expect(signedIn, ground).not.toContain("data-turnstile");
      expect(textOf(signedIn), ground).not.toContain(REPORT_WORDS.turnstile);
      expect(fields(signedIn), ground).not.toContain(REPORT_WORDS.email);
    }
    const illegal = form({ signedIn: false, initial: { ground: "illegal" } });
    expect(fields(illegal)).toEqual([REPORT_WORDS.citedLaw, REPORT_WORDS.whyIllegal, REPORT_WORDS.name, REPORT_WORDS.email]);
    expect(textOf(illegal)).toContain(REPORT_WORDS.contactHint);
    expect(fields(form({ signedIn: false, initial: { ground: "rule" } }))).toEqual([REPORT_WORDS.explanation]);
    // Before a ground is chosen the check is there already: it takes a moment to pass.
    expect(form({ signedIn: false })).toContain('data-turnstile="widget"');
  });

  test("opened without an item, the form starts with one required field for the link; opened on one, it shows what is reported; other items take up to nine more links", () => {
    const bare = form({ given: null });
    expect(fields(bare)[0]).toBe(REPORT_WORDS.link);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItems);
    expect(textOf(bare)).toContain(REPORT_WORDS.otherItemsHint);
    const onPost = form({ given: { kind: "post", id: id(1), mediaId: id(2) } });
    expect(fields(onPost)).not.toContain(REPORT_WORDS.link);
    expect(hrefs(onPost)).toContain(`/post/${id(1)}`);
    expect(hrefs(form({ given: PROFILE }))).toContain("/u/ada");
    // Each added link is a field of its own; at nine there is no way to add a tenth.
    const nine = form({ initial: { others: Array.from({ length: OTHER_LINKS_MAX }, () => "") } });
    expect(fields(nine).filter((label) => label.startsWith("Link "))).toHaveLength(9);
    expect(textOf(nine)).not.toContain(REPORT_WORDS.addLink);
    expect(textOf(form({ initial: { others: [""] } }))).toContain(REPORT_WORDS.addLink);
  });

  test("the screen opens the form on what its address names, signed in or out, and without an item when it names none", () => {
    session.state = { status: "signed-out" };
    route.params = { post: id(1), media: id(2) };
    const onImage = html(<Report />);
    expect(hrefs(onImage)).toContain(`/post/${id(1)}`);
    expect(onImage).toContain('data-turnstile="widget"');
    route.params = { account: "ada" };
    expect(hrefs(html(<Report />))).toContain("/u/ada");
    route.params = {};
    expect(fields(html(<Report />))[0]).toBe(REPORT_WORDS.link);
    session.state = { status: "signed-in", me: { user: { id: id(901), onboarded: true }, profile: { handle: "me" } } };
    expect(html(<Report />)).not.toContain("data-turnstile");
    session.state = { status: "signed-out" };
  });
});

describe("what the form sends", () => {
  const signedIn = { signedIn: true, turnstileToken: null };
  const signedOut = { signedIn: false, turnstileToken: "token" };

  test("says what is missing, one thing at a time, and sends nothing until it is all there", () => {
    const missing = REPORT_WORDS.missing;
    expect(noticeFrom(draft(), POST, signedIn)).toEqual({ problem: missing.ground });
    expect(noticeFrom(draft({ ground: "rule" }), null, signedIn)).toEqual({ problem: missing.link });
    expect(noticeFrom(draft({ ground: "rule", link: "korbat.example/post/1" }), null, signedIn)).toEqual({ problem: missing.linkInvalid });
    expect(noticeFrom(draft({ ground: "rule" }), POST, signedIn)).toEqual({ problem: missing.rule });
    expect(noticeFrom(draft({ ground: "illegal" }), POST, signedIn)).toEqual({ problem: missing.whyIllegal });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "It is a threat." }), POST, signedIn)).toEqual({ problem: missing.bonaFide });
    expect(noticeFrom(draft({ ground: "csam" }), POST, signedIn)).toEqual({ problem: missing.keyword });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3" }), POST, { signedIn: false, turnstileToken: null })).toEqual({ problem: missing.human });
    expect(noticeFrom(draft({ ground: "illegal", explanation: "x", bonaFide: true, email: "not an address" }), POST, signedOut)).toEqual({ problem: missing.details });
  });

  test("a rule report, a notice of illegality and an anonymous report, each in the contracts' shape for its sender", () => {
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R3", explanation: "  look at the second line  " }), POST, signedIn)).toEqual({
      request: { ground: "rule", ruleId: "R3", targets: [POST], explanation: "look at the second line" },
    });
    expect(noticeFrom(draft({ ground: "rule", ruleId: "R1", link: " http://localhost:8081/post/x ", others: ["", "http://localhost:8081/u/bob"] }), null, signedOut)).toEqual({
      request: { ground: "rule", ruleId: "R1", targets: [{ kind: "link", url: "http://localhost:8081/post/x" }, { kind: "link", url: "http://localhost:8081/u/bob" }], turnstileToken: "token" },
    });
    const illegal = draft({ ground: "illegal", explanation: "It is a threat.", bonaFide: true, citedLaw: "Section 241", ruleId: "R5", name: "Ada", email: "ada@korbat.local", category: "STATEMENT_CATEGORY_VIOLENCE" });
    expect(noticeFrom(illegal, PROFILE, signedOut)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5", name: "Ada", email: "ada@korbat.local", turnstileToken: "token" },
    });
    // Signed in, the contact is the account: a name or an address typed earlier is never sent.
    expect(noticeFrom(illegal, PROFILE, signedIn)).toEqual({
      request: { ground: "illegal", targets: [PROFILE], category: "STATEMENT_CATEGORY_VIOLENCE", citedLaw: "Section 241", explanation: "It is a threat.", bonaFide: true, ruleId: "R5" },
    });
    // The anonymous path sends neither, whatever the draft holds, and good faith only when it was stated.
    expect(noticeFrom(draft({ ground: "csam", keyword: "deepfake", name: "Ada", email: "ada@korbat.local", ruleId: "R1" }), POST, signedOut)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "deepfake", turnstileToken: "token" },
    });
    expect(noticeFrom(draft({ ground: "csam", keyword: "abuse", bonaFide: true, explanation: "seen today" }), POST, signedIn)).toEqual({
      request: { ground: "csam", targets: [POST], keyword: "abuse", explanation: "seen today", bonaFide: true },
    });
  });

  test("the form posts the request once, resets the human check after a failure, and shows the answer's screen", () => {
    const source = read("components", "moderation", "ReportForm.tsx");
    expect(source).toContain("const answer = await moderation.send(built.request);");
    expect(source).toContain("turnstile.current?.reset();");
    expect(source).toContain('setError(reportFailure(err, draft.ground === "csam"));');
    expect(read("lib", "moderation.ts")).toContain('send: (request: NoticeRequest) => api("/api/notices", { json: request, schema: NoticeResponse })');
  });
});

describe("after sending", () => {
  const TOKEN = "t".repeat(43);

  test("signed out, the screen shows the reference and the link to keep, its token in the fragment, with a Copy button", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn={false} origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain("N-ABCDEFGH23");
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(statusLink("http://localhost:8081", "N-ABCDEFGH23", TOKEN)).toBe(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).toContain(`http://localhost:8081/notice/N-ABCDEFGH23#t=${TOKEN}`);
    // The token is never part of a query, which a server would be sent and would log.
    expect(out).not.toContain(`?t=${TOKEN}`);
    expect(withRole(out, "button").some((tag) => tag.includes(REPORT_WORDS.copy)) || text.includes(REPORT_WORDS.copy)).toBe(true);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
  });

  test("signed in, a report on a rule or on the law is followed under Settings, Cases, Your reports, and no link is shown", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23" }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out)).toContain("/settings/cases?tab=reports");
    expect(text).not.toContain(REPORT_WORDS.keepLink);
    expect(text).not.toContain("/notice/");
  });

  test("signed in, an anonymous report shows the link and not the Settings sentence: korbat recorded no account for it", () => {
    const out = html(<ReportSent answer={{ ref: "N-ABCDEFGH23", token: TOKEN }} signedIn origin="http://localhost:8081" />);
    const text = textOf(out);
    expect(text).toContain(REPORT_WORDS.keepLink);
    expect(text).toContain(`/notice/N-ABCDEFGH23#t=${TOKEN}`);
    expect(text).not.toContain(REPORT_WORDS.followInSettings);
    expect(hrefs(out).filter((href) => href.startsWith("/settings"))).toEqual([]);
  });
});

describe("a send that fails", () => {
  const failed = (code: string, retryAfter?: number) => new ApiError(code === "rate_limited" ? 429 : 403, code, "the server's own words", retryAfter);

  test("the human check, the limits and an API that cannot take reports each get the form's own sentence, naming the build's contact address", () => {
    expect(reportFailure(failed("human_check_failed"), false)).toBe(REPORT_WORDS.humanCheckFailed(CONTACT));
    expect(reportFailure(failed("rate_limited", 1200), false)).toBe(REPORT_WORDS.rateLimited("20 minutes", CONTACT));
    expect(reportFailure(failed("service_unavailable"), false)).toBe(REPORT_WORDS.unavailable(CONTACT));
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) expect(reportFailure(failed(code, 60), false), code).toContain("contact@korbat.local");
  });

  test("the wait is worded in minutes under an hour and in hours otherwise", () => {
    expect([waitWords(1), waitWords(60), waitWords(61), waitWords(3599), waitWords(3600), waitWords(3601), waitWords(20 * 3600), waitWords(undefined)]).toEqual([
      "1 minute",
      "1 minute",
      "2 minutes",
      "60 minutes",
      "1 hour",
      "2 hours",
      "20 hours",
      "1 hour",
    ]);
  });

  test("on the anonymous path each is followed by what an email gives away", () => {
    for (const code of ["human_check_failed", "rate_limited", "service_unavailable"]) {
      const words = reportFailure(failed(code, 60), true);
      expect(words.endsWith(` ${REPORT_WORDS.mailShowsAddress}`), code).toBe(true);
      expect(reportFailure(failed(code, 60), false), code).not.toContain(REPORT_WORDS.mailShowsAddress);
    }
  });

  test("any other failure shows the server's message, as everywhere in the app", () => {
    expect(reportFailure(failed("already_reported"), false)).toBe("the server's own words");
    expect(reportFailure(failed("already_reported"), true)).toBe("the server's own words");
    expect(reportFailure(new Error("boom"), false)).toBe("Something went wrong. Try again.");
  });
});

describe("the build's contact address", () => {
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the app reads it from the build, and both example files carry the development value", () => {
    expect(read("lib", "moderation.ts")).toContain('export const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? "";');
    expect(repo("infra", ".env.example")).toMatch(/^WEB_CONTACT_EMAIL=contact@korbat\.local$/m);
    expect(repo("apps", "app", ".env.example")).toMatch(/^EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat\.local$/m);
  });

  test("the compose service requires it, and the web image takes it as a build argument, refuses what is no address, refuses a placeholder domain in production, and passes it to the export", () => {
    expect(repo("infra", "compose.yml")).toContain("EXPO_PUBLIC_CONTACT_EMAIL: ${WEB_CONTACT_EMAIL:?set WEB_CONTACT_EMAIL in infra/.env}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    expect(dockerfile).toContain("ARG EXPO_PUBLIC_CONTACT_EMAIL");
    expect(dockerfile).toContain('RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac');
    expect(dockerfile).toContain(
      'RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi',
    );
    expect(dockerfile).toContain(
      'RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web',
    );
    // The refusals come before the export, and the production one after KORBAT_ENV is declared.
    expect(dockerfile.indexOf("ARG KORBAT_ENV")).toBeLessThan(dockerfile.indexOf("is a placeholder address"));
    expect(dockerfile.indexOf("is a placeholder address")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});
```

### Replace `apps/app/test/reporting.test.tsx` (whole file)

```tsx
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AccountStanding, AuthorCaseRow, DecisionView, ReportItem } from "@korbat/contracts";
import { DecisionDetail } from "../src/components/moderation/DecisionDetail";
import { DecisionsList, ReportsList, StandingBlock } from "../src/components/moderation/CasesLists";
import { ReportForm } from "../src/components/moderation/ReportForm";
import { apiResponse, messageFor } from "../src/lib/api";
import { CASE_ROW_WORDS, reportingLine, reportingNowLine, reportsRestrictedUntil, STANDING_TEXTS, standingDay, standingTime } from "../src/lib/standing";

/**
 * The app's part of the restriction of reporting (3e design, sections 9.2, 9.4, 9.6 and 9.8; Task 5): the report form's
 * restricted state, the Cases block's reporting line, the rows of a warning, a restriction, their lift and a restriction
 * ended with its warning, the mark on the person's own list of reports, and where a restriction stands now on its
 * decision's screen. Components are server-rendered with made-up answers.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/settings/cases",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
});
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
const UNTIL = "2026-11-03T09:30:00.000Z";
const COUNTS = "2026-12-19T08:00:00.000Z";
const NONE: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
const restricted: AccountStanding = { ...NONE, reporting: { warning: { decisionId: id(1), countsUntil: COUNTS }, restriction: { decisionId: id(2), until: UNTIL } } };
const warned: AccountStanding = { ...NONE, reporting: { warning: { decisionId: id(1), countsUntil: COUNTS }, restriction: null } };

describe("3e Task 5: the words (design, sections 9.2, 9.4, 9.6 and 9.8)", () => {
  test("each sentence is the design's, every time printed as standingTime or standingDay prints it", () => {
    expect(STANDING_TEXTS.report.restricted(UNTIL)).toBe(
      `korbat has restricted your reports under its rules until ${standingTime(UNTIL)}, after a warning, because several of them were plainly unfounded. The decision is under Settings, Cases, where you can appeal it. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
    );
    expect(STANDING_TEXTS.cases.restricted(UNTIL)).toBe(`Your reports under korbat's rules are restricted until ${standingTime(UNTIL)}.`);
    expect(STANDING_TEXTS.cases.warned(COUNTS)).toBe(`A warning about your reports counts until ${standingTime(COUNTS)}.`);
    expect(STANDING_TEXTS.reports.marked).toBe("A moderator marked this report as manifestly unfounded (Terms, Reporting in bad faith). You can ask for a re-examination.");
    expect(STANDING_TEXTS.reporting.warningGone(UNTIL)).toBe(`Ended on ${standingDay(UNTIL)} with the warning it rested on, which korbat lifted.`);
    expect(CASE_ROW_WORDS.restricted(30)).toBe("your reports under the rules restricted for 30 days");
    expect(CASE_ROW_WORDS.restricted(1)).toBe("your reports under the rules restricted for 1 day");
    // A refusal's own words are the restricted sentence without its date, which /me adds on the form.
    expect(messageFor("reporting_restricted")).toBe(STANDING_TEXTS.report.restricted(UNTIL).replace(` until ${standingTime(UNTIL)}`, ""));
  });
});

describe("3e Task 5: the report form, Your standing and the lists (design, sections 9.4 and 9.6)", () => {
  test("the report form disables its first choice with [report.restricted] while a restriction runs, and leaves the notice of illegality and the path for child sexual abuse material open", () => {
    expect(reportsRestrictedUntil(restricted)).toBe(UNTIL);
    expect(reportsRestrictedUntil(warned)).toBeNull();
    const out = html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={restricted} />);
    expect(textOf(out)).toContain(STANDING_TEXTS.report.restricted(UNTIL));
    const radios = (out.match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(radios).toHaveLength(3);
    expect(radios[0]).toContain('aria-disabled="true"');
    expect(radios[1]).not.toContain('aria-disabled="true"');
    expect(radios[2]).not.toContain('aria-disabled="true"');
    // A warning restricts nothing: no choice is disabled.
    const open = (html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={warned} />).match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(open).toHaveLength(3);
    for (const radio of open) expect(radio).not.toContain('aria-disabled="true"');
  });

  test("Your standing says until when the reports are restricted, else until when a warning counts, else nothing of reporting", () => {
    expect(reportingLine(restricted)).toBe(STANDING_TEXTS.cases.restricted(UNTIL));
    expect(reportingLine(warned)).toBe(STANDING_TEXTS.cases.warned(COUNTS));
    expect(reportingLine(NONE)).toBeNull();
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={restricted} />))).toContain(STANDING_TEXTS.cases.restricted(UNTIL));
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={warned} />))).toContain(STANDING_TEXTS.cases.warned(COUNTS));
    expect(textOf(html(<StandingBlock activeStrikes={0} standing={NONE} />))).not.toContain("reports");
  });

  test("a row names a warning, a restriction with its days, the lift of either, and a restriction a reversal ended", () => {
    const row = (extra: Partial<AuthorCaseRow>): AuthorCaseRow => ({
      id: id(3),
      kind: "final",
      outcome: "restricted",
      decidedOn: "2026-09-20",
      post: null,
      actions: [],
      endedInterim: false,
      ruleId: "R6",
      legal: false,
      appealUntil: null,
      reversedOn: null,
      appeal: null,
      strike: null,
      ...extra,
    });
    const text = textOf(
      html(
        <DecisionsList
          decisions={[
            row({ id: id(4), actions: ["warn_reporting"] }),
            row({ id: id(5), actions: ["restrict_reporting"], reportingDays: 7 }),
            row({ id: id(6), kind: "review", outcome: "reversed", ruleId: null, actions: ["lift_reporting"], endedStanding: ["restrict_reporting"] }),
          ]}
        />,
      ),
    );
    expect(text).toContain(CASE_ROW_WORDS.warned);
    expect(text).toContain(CASE_ROW_WORDS.restricted(7));
    expect(text).toContain(`${CASE_ROW_WORDS.reportingLifted}, ${CASE_ROW_WORDS.restrictionEnded}`);
  });

  test("the sender's own list shows the mark with the released outcome, and an item without a mark that counts reads as before", () => {
    const item = (extra: Partial<ReportItem>): ReportItem => ({
      id: id(7),
      position: 1,
      link: "http://localhost:8081/post/x",
      scope: null,
      suspect: false,
      sealed: false,
      unseen: false,
      quotedBy: null,
      outcome: "no_violation",
      decidedOn: "2026-10-05",
      changed: false,
      reexamines: false,
      reexamination: { open: true, until: "2027-04-05T09:00:00.000Z" },
      unfounded: true,
      ...extra,
    });
    const page = (items: ReportItem[]) => textOf(html(<ReportsList page={{ reports: [{ ref: "N-ABCDEFGH23", receivedAt: "2026-10-01T09:00:00.000Z", items }], reportMailStopped: false }} onReexamine={async () => undefined} />));
    expect(page([item({})])).toContain(STANDING_TEXTS.reports.marked);
    expect(page([item({ unfounded: false })])).not.toContain(STANDING_TEXTS.reports.marked);
    // 3e's review (people8): "You can ask for a re-examination" only while one is open; once asked for, answered or
    // past its window the line keeps its first sentence.
    expect(STANDING_TEXTS.reports.markedClosed).toBe("A moderator marked this report as manifestly unfounded (Terms, Reporting in bad faith).");
    expect(STANDING_TEXTS.reports.marked.startsWith(STANDING_TEXTS.reports.markedClosed)).toBe(true);
    for (const closed of [{ reexamination: { open: false, until: "2027-04-05T09:00:00.000Z" } }, { reexamination: null }, { changed: true }]) {
      const text = page([item(closed as Partial<ReportItem>)]);
      expect(text, JSON.stringify(closed)).toContain(STANDING_TEXTS.reports.markedClosed);
      expect(text, JSON.stringify(closed)).not.toContain("You can ask for a re-examination.");
    }
  });

  test("a report refused for the restriction of reporting is worded in the app's own words, never the server's", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(403, { error: { code: "reporting_restricted", message: "server wording" } }));
    await expect(apiResponse("/api/notices", { json: {} })).rejects.toMatchObject({ code: "reporting_restricted", message: messageFor("reporting_restricted") });
    vi.unstubAllGlobals();
  });
});

describe("3e Task 5: where a restriction of reporting stands now (design, section 9.2)", () => {
  const view = (reportingStanding: DecisionView["reportingStanding"]): DecisionView => ({
    id: id(2),
    kind: "final",
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R6",
    rulesVersion: 3,
    redressVersion: 2,
    legalReference: null,
    facts: "Of the reports the account sent between korbat's warning of 2026-09-20 and 2026-10-12, a moderator marked 3 as manifestly unfounded.",
    reason: "The reports named nothing a rule could cover.",
    source: "own_initiative",
    decidedAt: "2026-10-12T09:30:00.000Z",
    post: null,
    measures: [{ kind: "restrict_reporting", mediaId: null, noEffect: null, sealed: null, basis: "reports", days: 22, endsAt: UNTIL, warnedAt: "2026-09-20T08:00:00.000Z" }],
    reversals: [],
    endedMeasures: [],
    reviewed: null,
    appealUntil: "2027-04-12T09:30:00.000Z",
    reversedOn: null,
    content: { kind: "account", handle: "someone", displayName: "Someone", bio: "" },
    appeal: null,
    strike: null,
    standing: null,
    reportingStanding,
  });

  test("its four states, each with its sentence; a lift and an end with the warning link to the decision that did it", () => {
    const LIFTED = "2026-10-20T09:00:00.000Z";
    expect(reportingNowLine({ state: "running", until: UNTIL, endedAt: null, endedBy: null })).toEqual({ text: STANDING_TEXTS.reporting.running(UNTIL), link: null });
    expect(reportingNowLine({ state: "ended", until: UNTIL, endedAt: null, endedBy: null })).toEqual({ text: STANDING_TEXTS.reporting.ended(UNTIL), link: null });
    expect(reportingNowLine({ state: "lifted", until: UNTIL, endedAt: LIFTED, endedBy: id(8) })).toEqual({ text: STANDING_TEXTS.reporting.lifted(LIFTED), link: id(8) });
    expect(reportingNowLine({ state: "basis_ended", until: UNTIL, endedAt: LIFTED, endedBy: id(9) })).toEqual({ text: STANDING_TEXTS.reporting.warningGone(LIFTED), link: id(9) });
    const running = textOf(html(<DecisionDetail view={view({ state: "running", until: UNTIL, endedAt: null, endedBy: null })} />));
    expect(running).toContain(STANDING_TEXTS.reporting.title);
    expect(running).toContain(STANDING_TEXTS.reporting.running(UNTIL));
    // The statement reads as it was sent: its restriction sentence names the warning it follows.
    expect(running).toContain("korbat restricted your reports under its rules for 22 days");
    const gone = html(<DecisionDetail view={view({ state: "basis_ended", until: UNTIL, endedAt: LIFTED, endedBy: id(9) })} />);
    expect(textOf(gone)).toContain(STANDING_TEXTS.reporting.warningGone(LIFTED));
    expect(gone).toContain(`href="/settings/cases/${id(9)}"`);
    // A decision without a restriction has no such block.
    expect(textOf(html(<DecisionDetail view={view(null)} />))).not.toContain(STANDING_TEXTS.reporting.running(UNTIL));
  });
});
```

### Replace `apps/app/test/standing.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AccountStanding, MeResponse } from "@korbat/contracts";
import { HandleSection } from "../src/app/settings/profile";
import { StandingBlock } from "../src/components/moderation/CasesLists";
import { ReportForm } from "../src/components/moderation/ReportForm";
import { StandingBanner } from "../src/components/StandingBanner";
import { messageFor } from "../src/lib/api";
import { refusalSentence, runningMeasure, STANDING_TEXTS, standingTime } from "../src/lib/standing";

/**
 * The app's part of a suspension taken at once (3e design, sections 9.1, 9.4 to 9.6 and 9.8; Task 3): the banner of a
 * running suspension above every signed-in screen, the refusal's sentence, the report form's suspended state, the line in
 * "Your standing", and Settings, Profile while the suspension runs. Components are server-rendered with made-up answers;
 * what a static render cannot show (the reads of /me on focus and after a refusal) is read from the source.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
// react-native-reanimated is mocked once for every test file in test/setup.ts.
vi.mock("@marsidev/react-turnstile", async () => {
  const { createElement } = await import("react");
  return { Turnstile: () => createElement("div", { "data-turnstile": "widget" }) };
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
const ENDS = "2026-10-19T10:00:00.000Z";
const running = (more: Partial<NonNullable<AccountStanding["measure"]>> = {}): AccountStanding => ({
  activeStrikes: 1,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 7,
    state: "running",
    earliestStart: "2026-10-12T10:00:00.000Z",
    startsAt: "2026-10-12T10:00:00.000Z",
    endsAt: ENDS,
    reply: null,
    replyOpen: true,
    appealUntil: "2027-04-12T10:00:00.000Z",
    appealPending: false,
    ...more,
  },
  reporting: null,
  handleRetired: false,
});
const NONE: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };

describe("3e: the words of a suspension in the app", () => {
  test("the banner's, the refusal's, the report form's and the retired handle's sentences are the design's, with the end printed as standingTime prints it", () => {
    expect(STANDING_TEXTS.banner.running(ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}. You can read, reply to korbat, appeal, export your data and delete your account. You cannot post, like, repost, bookmark, follow, edit your profile, upload images or report under korbat's rules.`,
    );
    expect(STANDING_TEXTS.banner.label).toBe("Your account's standing");
    expect(STANDING_TEXTS.refused.suspended(ENDS)).toBe(`Your account is suspended until ${standingTime(ENDS)}, so you cannot do this now.`);
    expect(STANDING_TEXTS.refused.terminated).toBe("korbat has terminated your account, so you cannot do this.");
    expect(STANDING_TEXTS.refused.over).toBe("The suspension has just ended. Try again.");
    expect(STANDING_TEXTS.report.suspended(ENDS)).toBe(
      `Your account is suspended until ${standingTime(ENDS)}, so it cannot report under korbat's rules. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
    );
    expect(STANDING_TEXTS.handle.retiredSuspended).toBe("korbat retired your handle; the decision is under Settings, Cases. You can choose a new one when your suspension ends: the 30-day wait will not apply.");
    // The fallback when /me cannot be read after a refusal.
    expect(messageFor("account_suspended")).toBe("Your account is suspended, so you cannot do this now.");
  });

  test("the refusal's sentence follows /me as read after the refusal: until when it runs, a termination, or that it has just ended", () => {
    expect(refusalSentence(running())).toBe(STANDING_TEXTS.refused.suspended(ENDS));
    expect(refusalSentence(running({ kind: "terminate", days: null, endsAt: null }))).toBe(STANDING_TEXTS.refused.terminated);
    expect(refusalSentence(NONE)).toBe(STANDING_TEXTS.refused.over);
    expect(refusalSentence(null)).toBe(STANDING_TEXTS.refused.over);
    // Only a measure that runs refuses anything.
    expect(runningMeasure(running({ state: "announced" }))).toBeNull();
  });
});

describe("3e: the banner (design, section 9.1)", () => {
  test("a running suspension: a region labelled with its standing, the sentence as a level-2 header, and the buttons to the decision, the appeal, the export and the deletion", () => {
    const out = html(<StandingBanner standing={running()} />);
    expect(out).toContain('role="region"');
    expect(out).toContain(`aria-label="${STANDING_TEXTS.banner.label.replace("'", "&#x27;")}"`);
    expect(out).toContain('aria-level="2"');
    const text = textOf(out);
    expect(text).toContain(STANDING_TEXTS.banner.running(ENDS));
    for (const label of [STANDING_TEXTS.banner.read, STANDING_TEXTS.banner.appeal, STANDING_TEXTS.banner.export, STANDING_TEXTS.banner.delete]) expect(text).toContain(label);
    expect(out).toContain(`href="/settings/cases/${id(9)}"`);
    expect(out).toContain('href="/settings/account"');
    // No appeal button once the appeal is closed.
    expect(textOf(html(<StandingBanner standing={running({ appealUntil: null })} />))).not.toContain(` ${STANDING_TEXTS.banner.appeal} `);
  });

  test("no banner without a measure (the states that Task 4 builds are tested with it, in announced.test.tsx)", () => {
    expect(html(<StandingBanner standing={NONE} />)).toBe("");
    expect(html(<StandingBanner standing={null} />)).toBe("");
  });

  test("the shell renders it above every signed-in screen, and the session reads /me again on focus and after a refusal account_suspended", () => {
    expect(read("components", "AppShell.tsx")).toContain("<StandingBanner standing={state.me.standing} />");
    const session = read("lib", "session.tsx");
    expect(session).toContain("setSuspendedHandler(quiet)");
    expect(session).toContain('AppState.addEventListener("change"');
    expect(read("lib", "api.ts")).toContain('if (res.status === 403 && code === "account_suspended") onSuspended?.();');
    // The composer's sheet says why in place of its fields while a measure runs.
    expect(read("components", "social", "ComposeSheet.tsx")).toContain("{refusalSentence(standing)}");
  });
});

describe("3e: the report form, Your standing and Settings, Profile while the suspension runs (design, sections 9.4 to 9.6)", () => {
  test("the report form disables its first choice with [report.suspended], and leaves the notice of illegality and the path for child sexual abuse material open", () => {
    const out = html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={running()} />);
    expect(textOf(out)).toContain(STANDING_TEXTS.report.suspended(ENDS));
    const radios = (out.match(/<[a-z]+ [^>]*role="radio"[^>]*>/g) ?? []).slice(0, 3);
    expect(radios).toHaveLength(3);
    expect(radios[0]).toContain('aria-disabled="true"');
    expect(radios[1]).not.toContain('aria-disabled="true"');
    expect(radios[2]).not.toContain('aria-disabled="true"');
    // Without a running measure nothing is disabled.
    expect(textOf(html(<ReportForm signedIn given={{ kind: "post", id: id(1) }} standing={NONE} />))).not.toContain(STANDING_TEXTS.report.suspended(ENDS));
  });

  test("Your standing carries the running suspension's line in the banner's words", () => {
    expect(textOf(html(<StandingBlock activeStrikes={1} standing={running()} />))).toContain(STANDING_TEXTS.banner.running(ENDS));
    expect(textOf(html(<StandingBlock activeStrikes={1} standing={NONE} />))).not.toContain("suspended");
  });

  test("Settings, Profile: the handle's form is replaced by the refusal's sentence, and a retired handle reads [handle.retired.suspended]", () => {
    const me = (handle: string): MeResponse => ({
      user: { id: id(1), email: "ada@example.com", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: { id: id(1), handle, displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: true },
      standing: running(),
    });
    const retired = textOf(html(<HandleSection me={me("retired_0a1b2c3d4e5f")} run={async () => undefined} refresh={async () => undefined} />));
    expect(retired).toContain(STANDING_TEXTS.handle.retiredSuspended);
    expect(retired).not.toContain(STANDING_TEXTS.handle.retired);
    expect(retired).toContain(STANDING_TEXTS.refused.suspended(ENDS));
    expect(retired).not.toContain("Change handle");
    const plain = textOf(html(<HandleSection me={me("ada_l")} run={async () => undefined} refresh={async () => undefined} />));
    expect(plain).toContain(STANDING_TEXTS.refused.suspended(ENDS));
    expect(plain).not.toContain(STANDING_TEXTS.handle.retiredSuspended);
    expect(read("app", "settings", "profile.tsx")).toContain("{refusalSentence(me.standing)}");
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
 * Icon.tsx), followed by Vite's own default list. test/setup.ts mocks, once for every file, the
 * native modules that never load in Node (Reanimated, gesture-handler, safe-area-context,
 * expo-haptics, expo-router/head, lucide-react-native).
 */
export default defineConfig({
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".web.js", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["./test/setup.ts"] },
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/02-primitives-haptics-motion-mocks.md 3
```

Expected: 23 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/kit/Avatar.tsx`

```tsx
import { View } from "react-native";
import { Text, fontVariation, type TextVariant } from "./Text";

/**
 * An account's picture (UI design, section 6.5, decision 22). No uploaded avatars exist before 2d, so it draws a
 * monogram now: the first grapheme of the display name, ink-medium on surface-2 inside a 1 px line-low ring, with no hue,
 * since colour in korbat means action or status and a coloured disc per account would mean neither. 2d gives it `src`
 * without moving anything. It is decoration, hidden from assistive technology: the author link beside it carries the
 * name. 40 px in post cards and rows, 64 px (phones) and 96 px in the profile header.
 */
export type AvatarSize = 32 | 40 | 64 | 96;

/**
 * The letter's variant: the text face at 700 in the small discs, Fraunces at the large ones, where the letter is above
 * 22 px, so the profile header's name and disc share the display face.
 */
const LETTER: Record<AvatarSize, TextVariant> = { 32: "body-strong", 40: "title", 64: "display-2", 96: "display-1" };

/** Splits text into what a reader sees as characters, where the runtime can; a letter and its accent stay together. */
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The monogram of a display name: its first grapheme, in capitals; nothing for an empty name. */
export function monogram(displayName: string): string {
  const name = displayName.trim();
  if (name === "") return "";
  const first = segmenter ? (segmenter.segment(name)[Symbol.iterator]().next().value?.segment ?? "") : (Array.from(name)[0] ?? "");
  return first.toLocaleUpperCase();
}

export function Avatar({ account, size = 40 }: { account: { id: string; displayName: string }; size?: AvatarSize; src?: string }) {
  const large = size >= 64;
  return (
    <View aria-hidden className="items-center justify-center overflow-hidden rounded-full border border-line-low bg-surface-2" style={{ width: size, height: size }}>
      <Text variant={LETTER[size]} tone="medium" style={large ? fontVariation('"SOFT" 100') : undefined}>
        {monogram(account.displayName)}
      </Text>
    </View>
  );
}
```

### Create `apps/app/src/components/kit/EmptyState.tsx`

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

export function EmptyState({ icon, title, body, action }: { icon?: IconName; title: string; body?: string; action?: EmptyAction }) {
  return (
    <View className="items-center gap-3 px-6 py-12">
      {icon !== undefined ? <Icon name={icon} size={24} tone="low" /> : null}
      <Text as="h2" variant="display-3" className="text-center">
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

### Create `apps/app/src/components/kit/ErrorState.tsx`

```tsx
import { useEffect } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { UI_WORDS } from "@/lib/ui-words";
import { Icon } from "./Icon";
import { Text } from "./Text";

/**
 * What a list or a screen shows when it could not load (UI design, sections 6.12 and 8.11): what happened, as an alert,
 * and "Try again". Offline it says so in its own words, "You're offline", with the same Try again, and when the browser
 * reports that the connection is back it tries once by itself.
 */

/** The browser's navigator, typed locally and read only where there is one: Node and native have none with onLine. */
const runtime = globalThis as unknown as { navigator?: { onLine?: boolean } };

/** A request that got no answer at all (lib/api.ts throws ApiError status 0, "network"), or a browser that says it is offline. */
export function isOffline(error?: unknown): boolean {
  if (error instanceof ApiError && error.status === 0) return true;
  return runtime.navigator?.onLine === false;
}

/** Where the "online" event fires: the window on the web; anything without addEventListener (native, Node) fires none. */
interface OnlineTarget {
  addEventListener?: (type: "online", listener: () => void) => void;
  removeEventListener?: (type: "online", listener: () => void) => void;
}

/** Calls `retry` once, the first time `target` says the connection is back; the function returned stops waiting. */
export function retryWhenOnline(retry: () => void, target: OnlineTarget = globalThis as unknown as OnlineTarget): () => void {
  if (typeof target.addEventListener !== "function") return () => undefined;
  let waiting = true;
  const once = () => {
    if (!waiting) return;
    waiting = false;
    target.removeEventListener?.("online", once);
    retry();
  };
  target.addEventListener("online", once);
  return () => {
    waiting = false;
    target.removeEventListener?.("online", once);
  };
}

export function ErrorState({ message, onRetry, offline = isOffline() }: { message: string; onRetry: () => void; offline?: boolean }) {
  useEffect(() => (offline ? retryWhenOnline(onRetry) : undefined), [offline, onRetry]);
  return (
    <View className="items-center gap-3 px-6 py-12">
      <Icon name={offline ? "offline" : "error"} size={24} tone={offline ? "low" : "danger"} />
      {offline ? (
        <View accessibilityRole="alert" className="items-center gap-2">
          <Text as="h2" variant="display-3" className="text-center">
            {UI_WORDS["offline.title"]}
          </Text>
          <Text tone="medium" className="max-w-[440px] text-center">
            {UI_WORDS["offline.body"]}
          </Text>
        </View>
      ) : (
        <Text accessibilityRole="alert" tone="danger" className="max-w-[440px] text-center">
          {message}
        </Text>
      )}
      <Button label={UI_WORDS["error.retry"]} tone="secondary" full={false} onPress={onRetry} />
    </View>
  );
}
```

### Create `apps/app/src/components/kit/IconButton.tsx`

```tsx
import { cva } from "class-variance-authority";
import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { IconName } from "@/components/icons";
import { compactCount } from "@/lib/format";
import { useMotion, usePressScale } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING, HOVER_WASH, pressDelay } from "./interaction";
import { Text, type Tone } from "./Text";

/**
 * A control drawn as an icon (UI design, section 6.3): the post's actions, More, Back, Close. `label` is required and is
 * its accessible name, since the icon itself is hidden from assistive technology; a toggle whose name stays the same
 * says whether it is on through `pressed`, and a trigger says what it opens and whether it is open through `hasPopup`
 * and `expanded`. It answers at once on pointer-down with section 5.2's press (scale 0.92; reduced, none), takes
 * surface-2 under a fine pointer, and shows the focus ring. Its target is at least 44 by 44 px.
 *
 * `count` is a visible number beside the icon, inside the button, formatted by compactCount() and hidden from the name,
 * because the label already says it ("Like, 12 likes"). The caller decides when a count shows: it leaves `count` out,
 * and drops the number from the label too, when the count is zero or the reader hides counts (decision 15, which hides
 * like and repost counts and keeps reply and quote counts). IconButton never reads that setting itself.
 */
export type IconButtonTone = "low" | "high" | "accent" | "danger";

const ICON_TONE: Record<IconButtonTone, Tone> = { low: "low", high: "high", accent: "accent", danger: "danger" };

/** The target: round, 44 px at least, the hover wash and the ring. A counted button grows to fit its number. */
const target = cva(cn("min-h-[44px] min-w-[44px] flex-row items-center justify-center gap-1 rounded-full", HOVER_WASH, FOCUS_RING), {
  variants: { counted: { true: "px-2", false: "" } },
});

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name, and the tooltip's words on the web. */
  label: string;
  onPress: () => void;
  /** aria-pressed, for a toggle whose name stays the same (Like, Repost); leave it out for any other button. */
  pressed?: boolean;
  /** The action's request is still out: aria-busy, and the icon at 60 percent (section 5.2, pending). */
  busy?: boolean;
  count?: number;
  /** The icon's colour: ink-low at rest, the accent for what the reader has turned on (decision 13). */
  tone?: IconButtonTone;
  /** A filled icon: a Heart or a Bookmark that is on. */
  filled?: boolean;
  disabled?: boolean;
  hasPopup?: "menu" | "dialog";
  /** Whether the menu or dialog the button opens is open now. */
  expanded?: boolean;
  ref?: Ref<View>;
}

/**
 * The tooltip's delay, and how long after one closes its neighbours still show theirs at once: moving along a row of
 * icon buttons reads each name without waiting again (section 6.3).
 */
const TOOLTIP_DELAY = 500;
const TOOLTIP_WARM = 300;
let tooltipsOpen = 0;
let warmUntil = 0;

/** Whether this pointer can hover, which a touch screen cannot; hover events from a tap never show a tooltip. */
function finePointer(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * The label above an icon-only button on the web, after 500 ms of hover, at once while a neighbour's is open. It grows
 * from the button (opacity, and scale 0.97 to 1 over 125 ms; reduced, opacity only; at once, neither), adds no aria,
 * since it repeats the name, and takes no pointer, so it never covers what is under it.
 */
function useTooltip() {
  const motion = useMotion();
  const [shown, setShown] = useState(false);
  // Whether this button's tooltip counts among the open ones; a ref, so the count never depends on a render.
  const open = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.97);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  const show = (instant: boolean) => {
    if (!open.current) {
      open.current = true;
      tooltipsOpen += 1;
    }
    setShown(true);
    if (instant) {
      opacity.value = 1;
      scale.value = 1;
      return;
    }
    opacity.value = 0;
    scale.value = motion.reduced ? 1 : 0.97;
    opacity.value = withTiming(1, motion.timing("easeOut", 125));
    if (!motion.reduced) scale.value = withTiming(1, motion.timing("easeOut", 125));
  };
  const hide = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (open.current) {
      open.current = false;
      tooltipsOpen -= 1;
      warmUntil = Date.now() + TOOLTIP_WARM;
    }
    setShown(false);
  };
  const onHoverIn = () => {
    if (!finePointer()) return;
    if (tooltipsOpen > 0 || Date.now() < warmUntil) show(true);
    else timer.current = setTimeout(() => show(false), TOOLTIP_DELAY);
  };
  // A button that leaves the screen while its tooltip shows still closes it, so the count of open ones stays true.
  useEffect(() => hide, []);
  return { shown, style, onHoverIn, hide };
}

export function IconButton({ icon, label, onPress, pressed, busy = false, count, tone, filled = false, disabled = false, hasPopup, expanded, ref }: IconButtonProps) {
  const press = usePressScale(0.92);
  const tooltip = useTooltip();
  const shown = count !== undefined && count > 0 ? compactCount(count) : null;
  const iconTone = ICON_TONE[tone ?? (pressed ? "accent" : "low")];
  // A press answers at once and puts the tooltip away: the reader is acting, no longer asking what the button is.
  const onPressIn = () => {
    tooltip.hide();
    press.handlers.onPressIn();
  };
  return (
    <Animated.View style={press.style}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        aria-haspopup={hasPopup}
        aria-expanded={hasPopup === undefined ? undefined : (expanded ?? false)}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={tooltip.onHoverIn}
        onHoverOut={tooltip.hide}
        onPressIn={onPressIn}
        onPressOut={press.handlers.onPressOut}
        {...pressDelay(0)}
        className={target({ counted: shown !== null })}
      >
        <View className={cn("flex-row items-center gap-1 web:transition-opacity web:duration-150", busy ? "opacity-60" : "opacity-100")}>
          <Icon name={icon} size={20} tone={iconTone} filled={filled} />
          {shown !== null ? (
            <Text variant="meta" tone={iconTone} aria-hidden>
              {shown}
            </Text>
          ) : null}
        </View>
        {tooltip.shown ? (
          <View aria-hidden pointerEvents="none" className="absolute bottom-full left-[-120px] right-[-120px] mb-1 items-center">
            <Animated.View style={tooltip.style}>
              <View className="rounded-control border border-line-high bg-surface-1 px-2 py-1 web:forced-colors:border-[color:CanvasText]">
                <Text variant="meta">{label}</Text>
              </View>
            </Animated.View>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
```

### Create `apps/app/src/components/kit/ListRow.tsx`

```tsx
import type { ReactNode } from "react";
import { Pressable, Switch, View } from "react-native";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { Icon } from "./Icon";
import { FOCUS_RING_INSET, HOVER_WASH, pressDelay } from "./interaction";
import { Text } from "./Text";

/**
 * One row for settings, lists of accounts, menus on phones and the details sheet (UI design, section 6.11), in four
 * forms by what it does: a link (`href`, an anchor with a chevron), a button (`onPress`), a switch, and a radio in a
 * RadioGroup. `label` is required: it is the row's title and its accessible name (section 6.1). The row is 52 px tall at
 * least (a 44 px target and its padding), divided by line-low, surface-2 under a fine pointer, and surface-2 when
 * pressed, after 80 ms, since a scroll starts on rows. Rows never scale. Their focus ring is drawn inside, where the
 * column's edges cannot clip it.
 */
export type ListRowControl =
  | { kind: "switch"; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean }
  | { kind: "radio"; checked: boolean; onSelect: () => void };

interface RowContent {
  label: string;
  /** One line under the label, in meta. */
  description?: string;
  icon?: IconName;
  /** A short trailing text, such as the chosen theme. */
  value?: string;
  tone?: "default" | "danger";
}

export type ListRowProps = RowContent & ({ href: Href } | { onPress: () => void } | { control: ListRowControl });

const ROW = cn("min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3", HOVER_WASH);

/**
 * The switch row's ring. react-native-web draws a switch's focus as a faint shadow on its thumb, which forced colours
 * remove, so the row draws korbat's ring, inside, while the switch in it has keyboard focus.
 */
const SWITCH_RING = "web:has-[:focus-visible]:outline web:has-[:focus-visible]:outline-2 web:has-[:focus-visible]:-outline-offset-2 web:has-[:focus-visible]:outline-focus";

/** The pressed wash, after the 80 ms delay; an inline colour, so it shows over the hover's class. */
function usePressedWash() {
  const { colors } = useTheme();
  return (pressed: boolean) => (pressed ? { backgroundColor: colors["surface-2"] } : undefined);
}

/** The label, its description, and what trails it. */
function Content({ label, description, icon, value, tone = "default", trailing }: RowContent & { trailing?: ReactNode }) {
  const danger = tone === "danger";
  return (
    <>
      {icon !== undefined ? <Icon name={icon} size={20} tone={danger ? "danger" : "medium"} /> : null}
      <View className="flex-1 gap-0.5">
        <Text variant="body-strong" tone={danger ? "danger" : "high"}>
          {label}
        </Text>
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
  const { label, description, icon, value, tone } = props;
  const content = { label, description, icon, value, tone };

  if ("href" in props) {
    return (
      <Link href={props.href} asChild>
        <Pressable {...pressDelay(80)} className={FOCUS_RING_INSET}>
          {({ pressed }) => (
            <View className={ROW} style={wash(pressed)}>
              <Content {...content} trailing={<Icon name="next" size={20} tone="low" />} />
            </View>
          )}
        </Pressable>
      </Link>
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
      <Pressable role="radio" aria-checked={control.checked} onPress={control.onSelect} {...pressDelay(80)} className={FOCUS_RING_INSET}>
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
        <View className={cn(ROW, SWITCH_RING)} style={wash(pressed)}>
          <Content
            {...content}
            trailing={
              <View pointerEvents="none">
                <Switch accessibilityLabel={label} value={control.value} onValueChange={control.onValueChange} disabled={control.disabled} trackColor={{ false: colors["line-high"], true: colors.accent }} thumbColor={colors["surface-1"]} />
              </View>
            }
          />
        </View>
      )}
    </Pressable>
  );
}

/** A group of radio rows, named by its heading's nativeID (section 6.11). */
export function RadioGroup({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <View role="radiogroup" aria-labelledby={labelledBy}>
      {children}
    </View>
  );
}
```

### Create `apps/app/src/components/kit/PublicFrame.tsx`

```tsx
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Link, type Href } from "expo-router";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING } from "./interaction";
import { Text } from "./Text";

/**
 * The frame of the pages outside the app's shell (UI design, section 7.3): the sign-in flow, the three token pages and
 * the terms, so they no longer look like another app. The wordmark at the top leads to /, the content is the page's
 * main landmark in a column 440 px wide (640 px with `wide`, for the terms), and the footer links the public pages. The
 * page's body does not scroll on the web (public/index.html), so the frame scrolls itself. No screen uses it until
 * Task 8 moves them in.
 */
const FOOTER: { label: string; href: Href }[] = [
  { label: UI_WORDS["frame.rules"], href: "/rules" },
  { label: UI_WORDS["frame.transparency"], href: "/transparency" },
  { label: UI_WORDS["frame.terms"], href: "/terms" },
];

/** A link of the frame: 44 px tall around its words, dimmed while pressed, underlined under a fine pointer. */
const LINK = cn("group min-h-[44px] justify-center rounded-control px-1 active:opacity-70", FOCUS_RING);

export function PublicFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  // The column's width is a style, not a class, so a test can read it from the markup.
  const column = { width: "100%", maxWidth: wide ? 640 : 440 } as const;
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="min-h-full items-center px-4">
      <View role="banner" className="items-center py-6" style={column}>
        <Link href="/" asChild>
          <Pressable className={LINK}>
            <Text variant="display-1">{UI_WORDS["frame.wordmark"]}</Text>
          </Pressable>
        </Link>
      </View>
      <View role="main" className="flex-1" style={column}>
        {children}
      </View>
      <View role="contentinfo" className="flex-row flex-wrap justify-center gap-x-4 border-t border-line-low py-6" style={column}>
        {FOOTER.map((link) => (
          <Link key={String(link.href)} href={link.href} asChild>
            <Pressable className={LINK}>
              <Text variant="meta" tone="medium" className="web:group-hover:underline">
                {link.label}
              </Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}
```

### Create `apps/app/src/components/kit/Skeleton.tsx`

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

### Create `apps/app/src/components/kit/StatusChip.tsx`

```tsx
import { cva } from "class-variance-authority";
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
}

/** The drawn chip: icon, words that wrap, and the button form's chevron. */
function Face({ tone, label, chevron }: { tone: StatusTone; label: string; chevron: boolean }) {
  return (
    <View className={chip({ tone })}>
      <Icon name={STATUS_ICON[tone]} size={14} tone={ON_WASH[tone]} />
      <Text variant="chip" tone={ON_WASH[tone]} className="shrink">
        {label}
      </Text>
      {chevron ? <Icon name="next" size={14} tone={ON_WASH[tone]} /> : null}
    </View>
  );
}

export function StatusChip({ tone, label, name, href, onPress, className }: StatusChipProps) {
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
          <Pressable accessibilityRole="button" aria-haspopup="dialog" onPress={onPress} {...press.handlers} className={target}>
            <Face tone={tone} label={label} chevron />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
```

### Create `apps/app/src/components/kit/VisuallyHidden.tsx`

```tsx
import type { ReactNode } from "react";
import { Text } from "react-native";

/**
 * Words for assistive technology only (UI design, section 6.16): a post link's spoken time, the composer's count, a
 * list's loading status. The box is 1 px, clipped and taken out of the layout, so nothing on screen moves, and the text
 * keeps to one line, so a screen reader does not read a wrapped word at a time. The style is inline, which every
 * platform honours; a control that shows itself on focus (the skip link) renders visibly while focused instead.
 * `nativeID` lets a field name it in aria-describedby; `role` makes it a polite status.
 */
const HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", margin: -1, padding: 0, borderWidth: 0 } as const;

export function VisuallyHidden({ children, nativeID, role }: { children: ReactNode; nativeID?: string; role?: "status" }) {
  return (
    <Text nativeID={nativeID} role={role} aria-live={role === "status" ? "polite" : undefined} numberOfLines={1} style={HIDDEN}>
      {children}
    </Text>
  );
}
```

### Create `apps/app/src/components/kit/interaction.ts`

```ts
import { Platform } from "react-native";

/**
 * What every pressable of the kit shares (UI design, sections 5.2 and 6.1), written once so the classes stay whole
 * strings Tailwind finds in the source.
 *
 * The focus ring: 2 px in the focus colour at a 2 px offset, drawn as an outline that follows the control's radius.
 * Never Tailwind's ring, a box-shadow that forced-colours mode removes; the browser itself recolours an outline there.
 * On native the system draws keyboard focus.
 */
export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * The same ring drawn 2 px inside, for full-width rows: a list scrolls inside its column, whose edges would clip a ring
 * drawn outside the row.
 */
export const FOCUS_RING_INSET = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/**
 * The hover of rows, icon buttons and nav items: surface-2 under a fine pointer only (tailwind.config.js's
 * hoverOnlyWhenSupported puts every hover style under `(hover: hover) and (pointer: fine)`), 120 ms ease. The web: prefix
 * keeps it out of the native styles, where there is no hover.
 */
export const HOVER_WASH = "web:hover:bg-surface-2 web:transition-colors web:duration-[120ms] web:ease-[ease]";

/**
 * How long a press waits before it shows (section 5.1): controls at once; surfaces a scroll starts on (rows, a card's
 * open area) after 80 ms, so a scroll never flashes them. react-native-web calls the prop delayPressIn and waits 50 ms
 * unless told; React Native calls it unstable_pressDelay and does not wait. Spread the result on the Pressable.
 */
export function pressDelay(ms: number): object {
  return Platform.OS === "web" ? { delayPressIn: ms } : { unstable_pressDelay: ms };
}
```

### Create `apps/app/src/components/kit/lucide-icons.d.ts`

```ts
/**
 * lucide-react 1.55.0 publishes one module per icon (dist/esm/icons/<name>.mjs), each exporting the icon as its default,
 * but types only for its main entry. kit/Icon.web.tsx imports the icons one module at a time, so the web bundle holds
 * only the icons korbat draws; this declaration gives each module the main entry's own LucideIcon type.
 */
declare module "lucide-react/dist/esm/icons/*.mjs" {
  import type { LucideIcon } from "lucide-react";
  const icon: LucideIcon;
  export default icon;
}
```

### Create `apps/app/src/lib/format.ts`

```ts
/**
 * A count as it shows beside an icon (UI design, section 6.3): 1, 999, 1.2K, 12K, 1.2M. It truncates rather than
 * rounds, so it never shows more than the count: 1,999 likes are "1.9K", not "2K". One decimal is kept below ten of a
 * unit and dropped when it is zero; a count that is not a whole number is cut to one, and nothing below zero is shown.
 */
const UNITS = [
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000, suffix: "K" },
] as const;

export function compactCount(count: number): string {
  const whole = Math.max(0, Math.floor(count));
  for (const { size, suffix } of UNITS) {
    if (whole < size) continue;
    // Whole tenths of the unit, in integers, so no binary fraction rounds 1.2 up or down.
    const tenths = Math.floor(whole / (size / 10));
    if (tenths >= 100 || tenths % 10 === 0) return `${Math.floor(tenths / 10)}${suffix}`;
    return `${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
  }
  return String(whole);
}
```

### Create `apps/app/src/lib/haptics.ts`

```ts
import { useCallback } from "react";
import { Platform } from "react-native";
import {
  AndroidHaptics,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  performAndroidHapticsAsync,
  selectionAsync,
} from "expo-haptics";
import { useAppearance } from "./appearance";

/**
 * Haptics by intent (UI design, section 5.3, after Bluesky's intent API) over expo-haptics 57.0.3. A component names
 * what happened, never a vibration: useHaptics() gives it one function that takes the intent, and the caller fires it
 * in the same handler as the visual change, before the state update, so sight and touch land on the same frame.
 * Ordinary taps, scrolling and navigation have none. The web has none (its Vibration API is coarse and Safari lacks
 * it). The reader's switch, Settings, Appearance and accessibility, "Haptics", turns them all off; reduced motion does not.
 */
export const HAPTIC_INTENTS = ["toggleOn", "toggleOff", "selection", "threshold", "success", "warning", "error"] as const;

export type HapticIntent = (typeof HAPTIC_INTENTS)[number];

/** One call to expo-haptics, as data, so the mapping can be checked without a device. */
export type HapticCall =
  | { kind: "impact"; style: ImpactFeedbackStyle }
  | { kind: "selection" }
  | { kind: "notification"; type: NotificationFeedbackType }
  | { kind: "android"; type: AndroidHaptics };

/** iOS: Light for a toggle turned on, nothing for one turned off, Medium once per crossing of a close threshold. */
const IOS: Record<HapticIntent, HapticCall | null> = {
  toggleOn: { kind: "impact", style: ImpactFeedbackStyle.Light },
  toggleOff: null,
  selection: { kind: "selection" },
  threshold: { kind: "impact", style: ImpactFeedbackStyle.Medium },
  success: { kind: "notification", type: NotificationFeedbackType.Success },
  warning: { kind: "notification", type: NotificationFeedbackType.Warning },
  error: { kind: "notification", type: NotificationFeedbackType.Error },
};

/**
 * Android: the system's own constants, which tsc checks against expo-haptics 57.0.3's AndroidHaptics. That version has
 * no Gesture_Threshold_Activate, which the design names for a threshold; Long_Press is the firm tick Android plays when
 * a press arms an action, the nearest in kind. Devices check these in sub-project 5.
 */
const ANDROID: Record<HapticIntent, HapticCall> = {
  toggleOn: { kind: "android", type: AndroidHaptics.Toggle_On },
  toggleOff: { kind: "android", type: AndroidHaptics.Toggle_Off },
  selection: { kind: "android", type: AndroidHaptics.Segment_Tick },
  threshold: { kind: "android", type: AndroidHaptics.Long_Press },
  success: { kind: "android", type: AndroidHaptics.Confirm },
  warning: { kind: "android", type: AndroidHaptics.Reject },
  error: { kind: "android", type: AndroidHaptics.Reject },
};

/** What an intent plays on a platform, or null where it plays nothing: on the web, and anywhere but iOS and Android. */
export function hapticFor(intent: HapticIntent, platform: string): HapticCall | null {
  if (platform === "ios") return IOS[intent];
  if (platform === "android") return ANDROID[intent];
  return null;
}

/** expo-haptics answers with a promise; a device or simulator without a haptic engine refuses it, which is not an error. */
function run(call: HapticCall): Promise<void> {
  switch (call.kind) {
    case "impact":
      return impactAsync(call.style);
    case "selection":
      return selectionAsync();
    case "notification":
      return notificationAsync(call.type);
    case "android":
      return performAndroidHapticsAsync(call.type);
  }
}

/** Plays an intent on a platform when the reader's switch is on. */
export function playHaptic(intent: HapticIntent, platform: string, enabled: boolean): void {
  if (!enabled) return;
  const call = hapticFor(intent, platform);
  if (call === null) return;
  try {
    void run(call).catch(() => undefined);
  } catch {
    // A module missing on this device throws before it answers; the visual change already said what happened.
  }
}

/** The function a component fires intents with, following the reader's Haptics switch as it changes. */
export function useHaptics(): (intent: HapticIntent) => void {
  const { haptics } = useAppearance();
  return useCallback((intent: HapticIntent) => playHaptic(intent, Platform.OS, haptics), [haptics]);
}
```

### Create `apps/app/src/lib/motion.ts`

```ts
import { useCallback, useEffect, useMemo } from "react";
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type WithSpringConfig,
  type WithTimingConfig,
} from "react-native-reanimated";
import { MOTION } from "@/theme/motion";
import { useAppearance } from "./appearance";

/**
 * Motion for every component (UI design, sections 5.1 and 5.2). useMotion() is the one place that decides whether to
 * reduce motion, from either source: the operating system (Reanimated's useReducedMotion(), which reads
 * prefers-reduced-motion on the web) and the reader's own "Reduce motion: Always". No component reads either on its own,
 * so the browser check can flip both. Reduced means no movement, not no feedback: colour and opacity still change, at
 * 150 ms or less. The values are theme/motion.ts's.
 */
export type SpringName = "springSnap" | "springRelease";

/** easeOut and easeInOut take the duration the animation's row of section 5.2 gives; the others have their own. */
export type TimingName = "easeOut" | "easeInOut" | "pressIn" | "pressOut" | "fade";

export interface Motion {
  reduced: boolean;
  spring(name: SpringName): WithSpringConfig;
  timing(name: TimingName, duration?: number): WithTimingConfig;
}

const bezier = (points: readonly [number, number, number, number]) => Easing.bezier(points[0], points[1], points[2], points[3]);

/** The curve and the default duration of each timing, in ms; easeOut and easeInOut default to the fade's 150. */
const TIMINGS: Record<TimingName, { easing: readonly [number, number, number, number]; duration: number }> = {
  easeOut: { easing: MOTION.easeOut.easing, duration: MOTION.fade.duration },
  easeInOut: { easing: MOTION.easeInOut.easing, duration: MOTION.fade.duration },
  pressIn: { easing: MOTION.press.easing, duration: MOTION.press.in },
  pressOut: { easing: MOTION.press.easing, duration: MOTION.press.out },
  fade: { easing: MOTION.fade.easing, duration: MOTION.fade.duration },
};

export function useMotion(): Motion {
  const system = useReducedMotion();
  const { reduceMotion } = useAppearance();
  const reduced = system || reduceMotion === "always";
  return useMemo<Motion>(
    () => ({
      reduced,
      // korbat chooses each reduced form itself, so Reanimated never skips a timing on its own; a spring is movement,
      // so under reduced motion one that a component starts anyway lands at once.
      spring: (name) => ({ dampingRatio: MOTION[name].dampingRatio, duration: MOTION[name].duration, reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never }),
      timing: (name, duration) => ({ duration: duration ?? TIMINGS[name].duration, easing: bezier(TIMINGS[name].easing), reduceMotion: ReduceMotion.Never }),
    }),
    [reduced],
  );
}

/**
 * The pressed scale of section 5.2 (buttons 0.97, icon buttons 0.92): in on pointer-down over press-in, back on release
 * over press-out, each retargeting from the current scale, so a second press mid-way never jumps. Under reduced motion
 * nothing scales; the control's own colour change is its feedback. Spread `handlers` on the Pressable and give `style`
 * to the Animated.View around it.
 */
export function usePressScale(scale: number) {
  const motion = useMotion();
  const value = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: value.value }] }));
  const onPressIn = useCallback(() => {
    if (!motion.reduced) value.value = withTiming(scale, motion.timing("pressIn"));
  }, [motion, scale, value]);
  const onPressOut = useCallback(() => {
    value.value = withTiming(1, motion.timing("pressOut"));
  }, [motion, value]);
  return { style, handlers: { onPressIn, onPressOut } };
}

/**
 * Section 5.2's pulse: opacity between 1 and 0.6, 1.6 s a cycle, ease-in-out, until it unmounts. It is the skeleton's
 * motion, which under reduced motion stands still at 0.8; and it is the spinner's reduced form, which keeps pulsing,
 * since an opacity change is not movement (`still: false`). `on` false leaves it at 1 without animating.
 */
export function usePulse({ on = true, still = true }: { on?: boolean; still?: boolean } = {}) {
  const motion = useMotion();
  const stands = on && still && motion.reduced;
  const opacity = useSharedValue(stands ? 0.8 : 1);
  useEffect(() => {
    if (!on) return;
    if (stands) {
      cancelAnimation(opacity);
      opacity.value = 0.8;
      return;
    }
    // Half a cycle each way: 800 ms down to 0.6, 800 ms back up, repeated for as long as the work goes on.
    opacity.value = withRepeat(withTiming(0.6, motion.timing("easeInOut", 800)), -1, true);
    return () => cancelAnimation(opacity);
  }, [motion, on, stands, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/** Section 5.2's spinner: one turn every 800 ms, linear. Under reduced motion it does not turn; the caller pulses instead. */
export function useSpin() {
  const motion = useMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      cancelAnimation(turn);
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false);
    return () => cancelAnimation(turn);
  }, [motion, turn]);
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
}
```

### Create `apps/app/src/lib/time.ts`

```ts
import { UI_WORDS, fill } from "./ui-words";

/**
 * Times as korbat prints them (UI design, section 8.1), every one through Intl in this one place, so a later
 * translation changes one file. timeAgo moved here from lib/social.ts with its output unchanged, and social.ts
 * re-exports it for its callers. The forms with a clock time take the time zone as a parameter (the reader's own when
 * it is left out), and timeAgo and postedWhen take the present moment, so a test passes both.
 */

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The spoken form of timeAgo's short time, which a post's link adds to its name (6.6): "posted just now", "3h ago",
 * "on 12/10/2026". It always contains the short time, so the link's name contains its visible label (WCAG 2.5.3).
 */
export function postedWhen(iso: string, now: number = Date.now()): string {
  const short = timeAgo(iso, now);
  if (short === "just now") return UI_WORDS["time.posted.now"];
  if (/^\d+[mhd]$/.test(short)) return fill(UI_WORDS["time.posted.ago"], { short });
  return fill(UI_WORDS["time.posted.on"], { date: short });
}

/** The named parts of one instant in one zone, on a 24-hour clock. British English gives day before month. */
function parts(iso: string, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const format = new Intl.DateTimeFormat("en-GB", { ...options, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
}

/** The weekday and the minute: "Tue 18:40". */
export function dayTime(iso: string, timeZone?: string): string {
  const at = parts(iso, timeZone, { weekday: "short" });
  return `${at.weekday} ${at.hour}:${at.minute}`;
}

/** The date and the minute, for a thread's focused post: "21 Oct 2026, 18:40". */
export function fullDate(iso: string, timeZone?: string): string {
  const at = parts(iso, timeZone, { day: "numeric", month: "short", year: "numeric" });
  return `${at.day} ${at.month} ${at.year}, ${at.hour}:${at.minute}`;
}
```

### Create `apps/app/src/lib/ui-words.ts`

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
} as const;

export type UiWord = keyof typeof UI_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
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

### Replace `apps/app/src/components/kit/Icon.tsx` (whole file)

```tsx
import type { LucideIcon } from "lucide-react-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import BadgeCheck from "lucide-react-native/icons/badge-check";
import Bookmark from "lucide-react-native/icons/bookmark";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleUser from "lucide-react-native/icons/circle-user";
import Clock from "lucide-react-native/icons/clock";
import Compass from "lucide-react-native/icons/compass";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import ExternalLink from "lucide-react-native/icons/external-link";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import Flag from "lucide-react-native/icons/flag";
import Heart from "lucide-react-native/icons/heart";
import House from "lucide-react-native/icons/house";
import ImagePlus from "lucide-react-native/icons/image-plus";
import Info from "lucide-react-native/icons/info";
import KeyRound from "lucide-react-native/icons/key-round";
import Link from "lucide-react-native/icons/link";
import Lock from "lucide-react-native/icons/lock";
import LogIn from "lucide-react-native/icons/log-in";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Palette from "lucide-react-native/icons/palette";
import Quote from "lucide-react-native/icons/quote";
import Repeat2 from "lucide-react-native/icons/repeat-2";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Scale from "lucide-react-native/icons/scale";
import Settings from "lucide-react-native/icons/settings";
import Shield from "lucide-react-native/icons/shield";
import SquarePen from "lucide-react-native/icons/square-pen";
import Trash2 from "lucide-react-native/icons/trash";
import UserCog from "lucide-react-native/icons/user-cog";
import UserPen from "lucide-react-native/icons/user-pen";
import WifiOff from "lucide-react-native/icons/wifi-off";
import X from "lucide-react-native/icons/x";
import type { IconName, IconProps } from "@/components/icons";
import { useTheme } from "@/theme/ThemeProvider";
import { TONE_TOKEN } from "./Text";

/**
 * An icon on iOS and Android (UI design, sections 4.7 and 6.3): lucide-react-native over react-native-svg, the same
 * names and version as the web's, hidden from accessibility services; the control around it carries the name. Its
 * colour is the tone's token in the reader's theme.
 *
 * Each icon comes from its own module (the package's `icons/*` export), so the bundle carries these icons and not the
 * whole set its main entry re-exports. 1.55.0 has no module of its own for the alias Trash2, which is Trash.
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

### Replace `apps/app/src/components/kit/Icon.web.tsx` (whole file)

```tsx
import type { LucideIcon } from "lucide-react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import BadgeCheck from "lucide-react/dist/esm/icons/badge-check.mjs";
import Bookmark from "lucide-react/dist/esm/icons/bookmark.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import CircleUser from "lucide-react/dist/esm/icons/circle-user.mjs";
import Clock from "lucide-react/dist/esm/icons/clock.mjs";
import Compass from "lucide-react/dist/esm/icons/compass.mjs";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import Flag from "lucide-react/dist/esm/icons/flag.mjs";
import Heart from "lucide-react/dist/esm/icons/heart.mjs";
import House from "lucide-react/dist/esm/icons/house.mjs";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Link from "lucide-react/dist/esm/icons/link.mjs";
import Lock from "lucide-react/dist/esm/icons/lock.mjs";
import LogIn from "lucide-react/dist/esm/icons/log-in.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import Palette from "lucide-react/dist/esm/icons/palette.mjs";
import Quote from "lucide-react/dist/esm/icons/quote.mjs";
import Repeat2 from "lucide-react/dist/esm/icons/repeat-2.mjs";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw.mjs";
import Scale from "lucide-react/dist/esm/icons/scale.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import UserPen from "lucide-react/dist/esm/icons/user-pen.mjs";
import WifiOff from "lucide-react/dist/esm/icons/wifi-off.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import type { IconName, IconProps } from "@/components/icons";
import { TONE_CLASS } from "./Text";

/**
 * An icon on web (UI design, sections 4.7 and 6.3): lucide-react's plain svg, decoration only, so it is hidden from
 * assistive technology and never takes the focus; the control around it carries the name. Its colour is the tone's
 * class, which the svg's stroke follows as currentColor, so a forced Dark scope recolours it with its text.
 *
 * Each icon comes from its own module. lucide-react's main entry re-exports every icon of the set, and Metro keeps
 * whatever a module re-exports, so a named import from it put the whole set in the web bundle (about 240 KB gzip); only
 * these files are bundled now. The package ships no types for them, so lucide-icons.d.ts types each as a LucideIcon.
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

### Replace `apps/app/src/components/kit/Text.tsx` (whole file)

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
function webStyle(style: Partial<WebTextStyle>): TextStyle {
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

/**
 * A variable font's axes on the web, such as the monogram's "SOFT" 100 (section 6.5), through webStyle()'s one cast:
 * React Native has no fontVariationSettings. On native it is nothing, since sub-project 5 embeds static faces.
 */
export function fontVariation(settings: string, platform: "web" | "native" = Platform.OS === "web" ? "web" : "native"): TextStyle {
  return platform === "web" ? webStyle({ fontVariationSettings: settings }) : {};
}

/**
 * What a text says about itself by colour: an ink, the accent, an error, or a status (always with its own words, section
 * 4.8). The on- tones are for text and icons drawn on a fill: a filled button (on-accent, on-danger) and a chip's wash.
 */
export type Tone =
  | "high"
  | "medium"
  | "low"
  | "accent"
  | "danger"
  | "review-ink"
  | "restricted-ink"
  | "verified-ink"
  | "explore-ink"
  | "on-accent"
  | "on-danger"
  | "review-on-wash"
  | "restricted-on-wash"
  | "verified-on-wash"
  | "explore-on-wash";

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
  "on-accent": "on-accent",
  "on-danger": "on-danger",
  "review-on-wash": "review-on-wash",
  "restricted-on-wash": "restricted-on-wash",
  "verified-on-wash": "verified-on-wash",
  "explore-on-wash": "explore-on-wash",
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
  "on-accent": "text-on-accent",
  "on-danger": "text-on-danger",
  "review-on-wash": "text-review-on-wash",
  "restricted-on-wash": "text-restricted-on-wash",
  "verified-on-wash": "text-verified-on-wash",
  "explore-on-wash": "text-explore-on-wash",
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
export function Text({ variant = "body", tone = "high", as, italic, className, style, maxFontSizeMultiplier, accessibilityRole, ...rest }: TextProps) {
  const appearance = useAppearance();
  const level = as === "h1" || as === "h2" || as === "h3" || as === "h4" ? Number(as.slice(1)) : undefined;
  return (
    <NativeText
      {...rest}
      // A heading's role comes from `as`; any other role the caller gives (an alert, a button) is kept.
      accessibilityRole={level === undefined ? accessibilityRole : "header"}
      aria-level={level}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (Platform.OS === "web" ? undefined : (MAX_SCALE[variant] ?? 2))}
      className={cn(TONE_CLASS[tone], className)}
      style={[textStyle(variant, { step: appearance.textStep, font: appearance.font }), italic ? { fontStyle: "italic" } : null, style]}
    />
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

/** A titled box on a settings screen, a card on the page; the title is a heading one level under the screen's own. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-card border border-line-low bg-surface-1 p-5">
      <Text as="h2" variant="title">
        {title}
      </Text>
      {children}
    </View>
  );
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
export function Field({ label, ref, style, ...input }: { label: string; ref?: Ref<TextInput> } & TextInputProps) {
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
        style={[textStyle("body", { step: appearance.textStep, font: appearance.font }), style]}
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
const buttonFace = cva(cn("flex-row items-center justify-center gap-2 rounded-control border px-4 web:transition-colors web:duration-[120ms] web:ease-[ease]", FOCUS_RING), {
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

type ButtonFace = "primary" | "secondary" | "danger" | "inactive";

const LABEL_TONE: Record<ButtonFace, Tone> = { primary: "on-accent", secondary: "high", danger: "on-danger", inactive: "low" };

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
  /** The first three posts of Explore, for the context column's Popular now. */
  popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),

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
  // Hover styles apply only where the pointer can hover (UI design, section 5.2): every hover: class is wrapped in
  // @media (hover: hover) and (pointer: fine), so a tap on a touch screen never leaves a row or a button washed.
  future: { hoverOnlyWhenSupported: true },
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
Done in 2.4s using pnpm v10.30.0
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
1 new package versions since HEAD; all at least 7 days old
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
apps/app test:       Tests  443 passed (443)
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

- `apps/app/package.json`
- `apps/app/src/components/kit/Avatar.tsx`
- `apps/app/src/components/kit/EmptyState.tsx`
- `apps/app/src/components/kit/ErrorState.tsx`
- `apps/app/src/components/kit/Icon.tsx`
- `apps/app/src/components/kit/Icon.web.tsx`
- `apps/app/src/components/kit/IconButton.tsx`
- `apps/app/src/components/kit/ListRow.tsx`
- `apps/app/src/components/kit/PublicFrame.tsx`
- `apps/app/src/components/kit/Skeleton.tsx`
- `apps/app/src/components/kit/StatusChip.tsx`
- `apps/app/src/components/kit/Text.tsx`
- `apps/app/src/components/kit/VisuallyHidden.tsx`
- `apps/app/src/components/kit/interaction.ts`
- `apps/app/src/components/kit/lucide-icons.d.ts`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/format.ts`
- `apps/app/src/lib/haptics.ts`
- `apps/app/src/lib/motion.ts`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/time.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/tailwind.config.js`
- `apps/app/test/a11y.test.tsx`
- `apps/app/test/announced.test.tsx`
- `apps/app/test/appeals.test.tsx`
- `apps/app/test/automated.test.tsx`
- `apps/app/test/cases.test.tsx`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/format.test.ts`
- `apps/app/test/haptics.test.ts`
- `apps/app/test/hidden-media.test.tsx`
- `apps/app/test/image-fault.test.tsx`
- `apps/app/test/kit.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/motion.test.ts`
- `apps/app/test/orders.test.tsx`
- `apps/app/test/public-pages.test.tsx`
- `apps/app/test/report.test.tsx`
- `apps/app/test/reporting.test.tsx`
- `apps/app/test/setup.ts`
- `apps/app/test/standing.test.tsx`
- `apps/app/vitest.config.mts`
- `pnpm-lock.yaml`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(app): the primitives, haptics, motion and the shared test mocks: kit/IconButton with a required label, pressed, busy, a compact count kept out of its name, a popup trigger's aria-expanded and a 500 ms tooltip for fine pointers; Avatar's monogram; ListRow's link, button, switch and radio forms; Skeleton's pulse, still at 0.8 under reduced motion; EmptyState; ErrorState with its offline form and one retry when the browser is online again; StatusChip's image, link and button forms, each tone with an icon of its own; VisuallyHidden; PublicFrame; lib/haptics.ts maps seven intents onto expo-haptics 57.0.3 behind the reader's switch, useMotion() reduces motion for the system or the reader, lib/time.ts takes timeAgo with dayTime, fullDate and postedWhen, compactCount truncates, ui-words.ts holds the kit's words; ui.tsx rebuilt on the kit leaves the colour list; test/setup.ts mocks the native modules once for every file; a scan refuses bare sentences in the markup, 38 files still listed; hover only on fine pointers; icons bundled one module at a time" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the primitives, haptics, motion and the shared test mocks: kit/IconButton with a required label, pressed, busy, a compact count kept out of its name, a popup trigger's aria-expanded and a 500 ms tooltip for fine pointers; Avatar's monogram; ListRow's link, button, switch and radio forms; Skeleton's pulse, still at 0.8 under reduced motion; EmptyState; ErrorState with its offline form and one retry when the browser is online again; StatusChip's image, link and button forms, each tone with an icon of its own; VisuallyHidden; PublicFrame; lib/haptics.ts maps seven intents onto expo-haptics 57.0.3 behind the reader's switch, useMotion() reduces motion for the system or the reader, lib/time.ts takes timeAgo with dayTime, fullDate and postedWhen, compactCount truncates, ui-words.ts holds the kit's words; ui.tsx rebuilt on the kit leaves the colour list; test/setup.ts mocks the native modules once for every file; a scan refuses bare sentences in the markup, 38 files still listed; hover only on fine pointers; icons bundled one module at a time`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 43>
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
