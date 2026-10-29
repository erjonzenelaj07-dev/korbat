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

  test("the delete question takes the focus and hands it back to More, since the action row leaves the tree meanwhile", () => {
    const card = readFileSync(path.join(SRC, "components", "social", "PostCard.tsx"), "utf8");
    expect(card).toMatch(/if \(confirmingDelete\) keepRef\.current\?\.focus\(\);/);
    expect(card).toMatch(/else if \(wasConfirming\.current\) moreRef\.current\?\.focus\(\);/);
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

// UI Task 10 appends below, so the lines above keep the numbers the design and other tasks cite.
import { existsSync } from "node:fs";
import { LEGACY_COLOUR_FILES } from "./legacy-files";

/**
 * The 107 .tsx files of src/app and src/components that this sub-project added or rewrote, from its first task to its
 * last that touched the app (`git diff --name-only --diff-filter=AM 6babae1 b2fc637 -- apps/app/src/app
 * apps/app/src/components`), with their paths from src, sorted. UI design, section 13's Task 10: none of them may be
 * left on a legacy list, so a later change cannot put a rewritten file back on one to keep a bare sentence or a palette
 * colour in it.
 */
const REWRITTEN_FILES: readonly string[] = [
  "app/(auth)/_layout.tsx",
  "app/(auth)/age.tsx",
  "app/(auth)/code.tsx",
  "app/(auth)/handle.tsx",
  "app/(auth)/mfa.tsx",
  "app/(auth)/password.tsx",
  "app/(auth)/signin.tsx",
  "app/+not-found.tsx",
  "app/_layout.tsx",
  "app/bookmarks.tsx",
  "app/email-revert/[token].tsx",
  "app/explore/about.tsx",
  "app/index.tsx",
  "app/not-me/[token].tsx",
  "app/notice/[ref].tsx",
  "app/passkey-remove/[token].tsx",
  "app/post/[id].tsx",
  "app/report.tsx",
  "app/rules.tsx",
  "app/settings/_layout.tsx",
  "app/settings/account.tsx",
  "app/settings/appearance.tsx",
  "app/settings/cases/[id].tsx",
  "app/settings/cases/[id]/reply.tsx",
  "app/settings/cases/index.tsx",
  "app/settings/cases/releases/[id].tsx",
  "app/settings/cases/uploads/[id].tsx",
  "app/settings/index.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "app/transparency.tsx",
  "app/u/[handle]/followers.tsx",
  "app/u/[handle]/following.tsx",
  "app/u/[handle]/index.tsx",
  "components/AboutCard.tsx",
  "components/AppShell.tsx",
  "components/GestureRoot.tsx",
  "components/GestureRoot.web.tsx",
  "components/HandleBox.tsx",
  "components/Prose.tsx",
  "components/ScreenHeader.tsx",
  "components/SettingsNav.tsx",
  "components/StandingBanner.tsx",
  "components/ToastCard.tsx",
  "components/kit/Avatar.tsx",
  "components/kit/DragArea.tsx",
  "components/kit/DragArea.web.tsx",
  "components/kit/EmptyState.tsx",
  "components/kit/ErrorState.tsx",
  "components/kit/Icon.tsx",
  "components/kit/Icon.web.tsx",
  "components/kit/IconButton.tsx",
  "components/kit/ListRow.tsx",
  "components/kit/Menu.tsx",
  "components/kit/PublicFrame.tsx",
  "components/kit/Sheet.tsx",
  "components/kit/Skeleton.tsx",
  "components/kit/StatusChip.tsx",
  "components/kit/Tabs.tsx",
  "components/kit/Text.tsx",
  "components/kit/VisuallyHidden.tsx",
  "components/list/List.tsx",
  "components/moderation/CasesLists.tsx",
  "components/moderation/DecisionDetail.tsx",
  "components/moderation/ItemLines.tsx",
  "components/moderation/NoticeStatusView.tsx",
  "components/moderation/RefusedNotice.tsx",
  "components/moderation/ReleaseNotice.tsx",
  "components/moderation/ReportForm.tsx",
  "components/moderation/StatusSheet.tsx",
  "components/moderation/UploadNotice.tsx",
  "components/moderation/parts.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
  "components/social/ComposeButton.tsx",
  "components/social/ComposeHost.tsx",
  "components/social/ComposeSheet.tsx",
  "components/social/Composer.tsx",
  "components/social/ComposerImages.tsx",
  "components/social/ExploreList.tsx",
  "components/social/FeedList.tsx",
  "components/social/FeedRows.tsx",
  "components/social/HiddenImage.tsx",
  "components/social/ImageFault.tsx",
  "components/social/MediaGrid.tsx",
  "components/social/MediaViewer.tsx",
  "components/social/NewPostsPill.tsx",
  "components/social/PagedList.tsx",
  "components/social/PostCard.tsx",
  "components/social/PostMenu.tsx",
  "components/social/ProfileList.tsx",
  "components/social/ProfileMenu.tsx",
  "components/social/RichText.tsx",
  "components/social/WhoSeesThis.tsx",
  "components/social/composer/ComposerCard.tsx",
  "components/social/composer/ComposerField.tsx",
  "components/social/composer/DiscardDialog.tsx",
  "components/social/composer/ProgressRing.tsx",
  "components/social/composer/ProgressRing.web.tsx",
  "components/social/composer/SendBar.tsx",
  "components/toast.tsx",
  "components/toast.web.tsx",
  "components/ui.tsx",
];

describe("no file this sub-project added or rewrote is left on a legacy list (UI design, sections 1.5, 4.2 and 13)", () => {
  test("the list of rewritten files is sorted, holds 107 files without a repeat, and each of them is still in src", () => {
    expect(REWRITTEN_FILES).toHaveLength(107);
    expect([...REWRITTEN_FILES]).toEqual([...new Set(REWRITTEN_FILES)].sort());
    expect(REWRITTEN_FILES.filter((name) => !existsSync(path.join(SRC, ...name.split("/"))))).toEqual([]);
  });

  test("both legacy lists are empty and name none of the rewritten files", () => {
    expect(LEGACY_TEXT_FILES.filter((name) => REWRITTEN_FILES.includes(name))).toEqual([]);
    expect(LEGACY_COLOUR_FILES.filter((name) => REWRITTEN_FILES.includes(name))).toEqual([]);
    expect([...LEGACY_TEXT_FILES]).toEqual([]);
    expect([...LEGACY_COLOUR_FILES]).toEqual([]);
  });
});

// 2d Task 5 appends below, so the lines above keep the numbers other tasks cite.
/**
 * 2d's new screens and components (design, sections 10.2, 10.7 and 10.8): each is in src, so the source scan above reads
 * it, and holds no bare sentence; their words are in lib/activity-words.ts, lib/ui-words.ts and lib/settings-words.ts.
 */
const ENGAGEMENT_FILES: readonly string[] = [
  "app/activity.tsx",
  "app/settings/activity.tsx",
  "components/activity/FollowsEntry.tsx",
  "components/activity/GettingStarted.tsx",
  "components/activity/ModerationEntry.tsx",
  "components/activity/PostEntry.tsx",
];

describe("2d's new files are scanned (design, section 12.5)", () => {
  test("each is in src, the scan reads it, and none holds a bare sentence", () => {
    expect(ENGAGEMENT_FILES.filter((name) => !existsSync(path.join(SRC, ...name.split("/"))))).toEqual([]);
    for (const name of ENGAGEMENT_FILES) {
      expect(bareSentences(name, readFileSync(path.join(SRC, ...name.split("/")), "utf8")), name).toEqual([]);
    }
    expect(filesWithBareSentences().filter((name) => ENGAGEMENT_FILES.includes(name))).toEqual([]);
  });
});
