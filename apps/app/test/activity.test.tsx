import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACTIVITY_DEFAULTS, ACTIVITY_KEEP_DAYS, ActivityEntry, type ActivityPage, type Author, type PostView } from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";
import Activity, { ActivityRowView } from "../src/app/activity";
import { ActivitySettingsForm } from "../src/app/settings/activity";
import { FollowsEntry } from "../src/components/activity/FollowsEntry";
import { GettingStarted } from "../src/components/activity/GettingStarted";
import { ModerationEntry } from "../src/components/activity/ModerationEntry";
import { PostEntry } from "../src/components/activity/PostEntry";
import { ACTIVITY_WORDS } from "../src/lib/activity-words";
import {
  activityApi,
  activityPill,
  activityPollActive,
  activityRows,
  activityTab,
  createActivityPoll,
  createSettingsSaver,
  entryLine,
  entryName,
  firstEntryKey,
  firstLoadedKey,
  hasMention,
  markForVisit,
  retryFocus,
  seenToSend,
} from "../src/lib/activity";
import { RELEASE_TEXTS, UPLOAD_TEXTS } from "../src/lib/moderation-words";
import { ACTIVITY_SETTINGS_WORDS } from "../src/lib/settings-words";
import { localDay } from "../src/lib/time";
import { TITLE_WORDS, UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * Activity (2d design, sections 5.5.3, 5.7, 5.8, 10.2 and 10.8; Task 5): each entry's row, its accessible name and words,
 * the two headings, the pill's three forms, a follow group's name links and "See your followers", a post entry's Reply,
 * the empty and end states, the tab in the address, and Settings, Activity saving a settled choice once. A static render
 * cannot run effects, press or wait, so the list's rows, the seen marker, the poll, the debounce and the focus targets are
 * lib/activity.ts's pure functions, driven here with fakes; the browser check walks the screen itself (steps 52 and 53).
 */
const layout = vi.hoisted(() => ({ kind: "wide" as string }));
// The layout comes from the window's width, which a static render does not have: the test names the kind.
vi.mock("@/theme/layout", async (importOriginal) => ({ ...(await importOriginal<object>()), useLayout: () => layout.kind }));
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined, back: () => undefined, canGoBack: () => false, setParams: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/activity",
  useIsFocused: () => true,
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({
    state: { status: "signed-in", me: { user: { id: "00000000-0000-4000-8000-000000000001", onboarded: true }, profile: { handle: "ada", displayName: "Ada Lovelace" }, standing: null, avatar: null } },
    refresh: async () => undefined,
  }),
}));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source }: { source: { uri: string } }) => createElement("img", { "data-uri": source.uri, alt: "" }) };
});
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));
// The title goes into the document's head through expo-router/head; here it is drawn in place, so a test can read it.
vi.mock("expo-router/head", async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: { children: ReactElement }) => createElement("template", { "data-head": "" }, children) };
});

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const tags = (markup: string): string[] => markup.match(/<[a-z0-9]+\b[^>]*>/g) ?? [];
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from)).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}
const anchors = (markup: string): { href: string; open: string; inner: string }[] =>
  [...markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((match) => ({ href: attr(match[1]!, "href") ?? "", open: match[1]!, inner: match[2]! }));
const buttonNames = (markup: string): string[] => tags(markup).filter((tag) => tag.includes('role="button"')).map((tag) => attr(tag, "aria-label") ?? "");
const buttonTexts = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
const headings = (markup: string): [number, string][] => [...markup.matchAll(/<h([1-6])\b[^>]*>(.*?)<\/h\1>/g)].map((match) => [Number(match[1]), textOf(match[2]!)]);

const W = ACTIVITY_WORDS;
const NOW = new Date("2026-10-28T12:00:00.000Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = (n: number, handle: string, displayName: string): Author => ({ id: id(n), handle, displayName, verified: false, avatar: n === 2 ? { small: `/api/media/${id(90)}/small.webp`, large: `/api/media/${id(90)}/large.webp` } : null });
const GRACE = author(2, "grace", "Grace Hopper");
const LINUS = author(3, "linus", "Linus");
const BEN = author(4, "ben", "Ben");

function postView(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(10),
    author: GRACE,
    body: "Thanks @ada, the harbour notes are up.",
    createdAt: "2026-10-28T09:00:00.000Z",
    state: "visible",
    replyTo: { id: id(11), authorHandle: "ada" },
    counts: { likes: 2, reposts: 1, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: ["ada"],
    countsHidden: false,
    viewer: { liked: false, reposted: false, bookmarked: false },
    ...extra,
  };
}

/** Entries as the API answers them, parsed by the contract so a test never draws what the API would not send. */
const entry = <T extends ActivityEntry["type"]>(value: { type: T } & Record<string, unknown>) => ActivityEntry.parse(value) as Extract<ActivityEntry, { type: T }>;
const replyEntry = (isNew = true) => entry({ type: "post" as const, kind: "reply", key: `e:${id(20)}`, at: "2026-10-28T09:00:00.123456Z", new: isNew, post: postView() });
const mentionEntry = () => entry({ type: "post", kind: "mention", key: `e:${id(21)}`, at: "2026-10-28T08:00:00.000001Z", new: false, post: postView({ id: id(12), replyTo: null }) });
const quoteEntry = () => entry({ type: "post", kind: "quote", key: `e:${id(22)}`, at: "2026-10-28T07:00:00.000000Z", new: false, post: postView({ id: id(13), replyTo: null }) });
const follows = (count: number, actors: Author[], isNew = false) => entry({ type: "follows", key: "f:2026-10-27", at: "2026-10-27T20:00:00.000000Z", new: isNew, count, actors });
const moderation = (kind: "decision" | "release" | "upload" | "lost", target: "post" | "profile" | "account", n: number) =>
  entry({
    type: "moderation",
    kind,
    key: `${{ decision: "d", release: "r", upload: "u", lost: "l" }[kind]}:${id(n)}`,
    at: "2026-10-26T10:00:00.000000Z",
    new: false,
    target,
    id: id(n),
    postId: target === "post" ? id(14) : null,
    postCreatedAt: target === "post" ? "2026-10-20T10:00:00.000Z" : null,
  });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the words (10.10)", () => {
  test("Activity's sentences are the design's, word for word", () => {
    expect(W["activity.divider"]).toBe("New since you last looked");
    expect(W["activity.earlier"]).toBe("Earlier");
    expect(W["activity.moderation.open"]).toBe("Open in Cases");
    expect(W["activity.follow.all"]).toBe("See your followers");
    expect(fill(W["activity.end"], { days: ACTIVITY_KEEP_DAYS })).toBe("That's everything from the last 90 days.");
    expect(W["activity.composer.mentions"]).toBe("Up to 10 accounts you name with @ are told, if their settings allow it.");
    expect(UI_WORDS["nav.activity"]).toBe("Activity");
    // The own profile's button is the phone's way to Settings (10.1).
    expect(UI_WORDS["profile.settings"]).toBe("Settings");
    expect(TITLE_WORDS["title.activity"]).toBe("Activity - korbat");
    expect(TITLE_WORDS["title.settingsActivity"]).toBe("Activity - Settings - korbat");
  });
});

describe("the list's state, as lib/activity.ts holds it (5.7, 10.2)", () => {
  test("the tab is the address's: Conversations by name, All for anything else", () => {
    expect(activityTab(undefined)).toBe("all");
    expect(activityTab("conversations")).toBe("conversations");
    expect(activityTab(["conversations", "all"])).toBe("conversations");
    expect(activityTab("likes")).toBe("all");
  });

  test("the pill says 1 new, n new, and 20+ new from the cap's 21", () => {
    expect(activityPill(1)).toBe("1 new");
    expect(activityPill(7)).toBe("7 new");
    expect(activityPill(20)).toBe("20 new");
    expect(activityPill(21)).toBe("20+ new");
  });

  test("later pages are marked new against the first page's marker, compared as the API's six-digit strings", () => {
    const later = [replyEntry(false)];
    expect(markForVisit(later, "2026-10-28T09:00:00.123455Z")[0]!.new).toBe(true);
    expect(markForVisit(later, "2026-10-28T09:00:00.123456Z")[0]!.new).toBe(false);
    expect(markForVisit(later, null)[0]!.new).toBe(true);
  });

  test("the seen marker goes out with the first page's newest time, and only when something on it was new", () => {
    const page = (items: ActivityEntry[]): ActivityPage => ({ items, nextCursor: null, seenAt: "2026-10-27T00:00:00.000000Z" });
    expect(seenToSend(page([replyEntry(true), mentionEntry()]))).toBe("2026-10-28T09:00:00.123456Z");
    expect(seenToSend(page([replyEntry(false), mentionEntry()]))).toBeNull();
    expect(seenToSend(page([]))).toBeNull();
  });

  test("the rows: skeletons, the error, the empty state, then the two headings around the new entries, Load more or the end", () => {
    const base = { status: "ready" as const, error: null, cursor: null, loadingMore: false, moreError: null };
    expect(activityRows({ ...base, items: [], status: "loading" }).every((row) => row.kind === "skeleton")).toBe(true);
    expect(activityRows({ ...base, items: [], status: "error", error: "no" }).map((row) => row.kind)).toEqual(["error"]);
    expect(activityRows({ ...base, items: [] }).map((row) => row.kind)).toEqual(["empty"]);
    const mixed = activityRows({ ...base, items: [replyEntry(true), follows(1, [LINUS], true), mentionEntry(), quoteEntry()], cursor: "c" });
    expect(mixed.map((row) => (row.kind === "entry" ? row.entry.key : row.kind === "heading" ? row.heading : row.kind))).toEqual([
      "new",
      `e:${id(20)}`,
      "f:2026-10-27",
      "earlier",
      `e:${id(21)}`,
      `e:${id(22)}`,
      "loadMore",
    ]);
    // With no new entry neither heading is drawn; after the last page, the end, which names the 90 days.
    const old = activityRows({ ...base, items: [mentionEntry(), quoteEntry()] });
    expect(old.map((row) => row.kind)).toEqual(["entry", "entry", "end"]);
    expect(activityRows({ ...base, items: [replyEntry(true)] }).map((row) => row.kind)).toEqual(["heading", "entry", "end"]);
    expect(activityRows({ ...base, items: [quoteEntry()], cursor: "c", moreError: "failed" }).map((row) => row.kind)).toEqual(["entry", "loadMoreError"]);
  });

  test("focus after the pill or a refresh is the first entry; after Load more, the first entry it loaded", () => {
    const rows = activityRows({ status: "ready", error: null, cursor: null, loadingMore: false, moreError: null, items: [replyEntry(true), mentionEntry()] });
    expect(firstEntryKey(rows)).toBe(`e:${id(20)}`);
    expect(firstEntryKey([])).toBeNull();
    const items = [replyEntry(true), mentionEntry(), quoteEntry()];
    expect(firstLoadedKey(2, items)).toBe(`e:${id(22)}`);
    expect(firstLoadedKey(3, items)).toBeNull();
  });
});

describe("the composer's line (4.5, 10.3)", () => {
  test("a text names a handle by MENTION_TOKEN: an @ and 3 to 20 handle characters, with none on either side", () => {
    expect(hasMention("Thanks @ada!")).toBe(true);
    expect(hasMention("@grace_h")).toBe(true);
    expect(hasMention("write to ada@example.org")).toBe(false);
    expect(hasMention("@ab is too short")).toBe(false);
    expect(hasMention("@abcdefghijklmnopqrstuvwxyz is too long")).toBe(false);
    // The global token's place is never shared between calls.
    expect([hasMention("@ada"), hasMention("@ada")]).toEqual([true, true]);
  });
});

describe("each entry's line and name (5.5.3, 10.2)", () => {
  test("a reply, a mention and a quote name the actor; the name adds the time, and New first while it is new", () => {
    expect(entryLine(replyEntry())).toBe("Grace Hopper replied to your post");
    expect(entryLine(mentionEntry())).toBe("Grace Hopper mentioned you");
    expect(entryLine(quoteEntry())).toBe("Grace Hopper quoted your post");
    expect(entryName(replyEntry(true))).toBe("New, Grace Hopper replied to your post, 3h ago");
    expect(entryName(replyEntry(false))).toBe("Grace Hopper replied to your post, 3h ago");
  });

  test("a follow group names one, two, or one and the others by its count", () => {
    expect(entryLine(follows(1, [GRACE]))).toBe("Grace Hopper followed you");
    expect(entryLine(follows(2, [GRACE, LINUS]))).toBe("Grace Hopper and Linus followed you");
    expect(entryLine(follows(5, [GRACE, LINUS, BEN]))).toBe("Grace Hopper and 4 others followed you");
  });

  test("a moderation entry: a decision by its target, and 3d's words for a release, a refused upload and a lost image", () => {
    expect(entryLine(moderation("decision", "post", 30))).toBe(fill(W["activity.decision.post"], { date: localDay("2026-10-20T10:00:00.000Z") }));
    expect(entryLine(moderation("decision", "profile", 31))).toBe("A decision about your profile");
    expect(entryLine(moderation("decision", "account", 32))).toBe("A decision about your account");
    expect(entryLine(moderation("release", "account", 33))).toBe(RELEASE_TEXTS.entry);
    expect(entryLine(moderation("upload", "account", 34))).toBe(UPLOAD_TEXTS.entry);
    expect(entryLine(moderation("lost", "post", 35))).toBe(IMAGE_LOST_NOTICE.mail(localDay("2026-10-20T10:00:00.000Z")));
  });
});

describe("the five calls, the poll and the settings' save (5.7, 5.8, 9.2, 10.8)", () => {
  test("each call asks its route, with the tab, the cursor and the time in the query", async () => {
    const asked: [string, string][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { method: string }) => {
        asked.push([init.method, url]);
        if (url.startsWith("/api/activity/newer")) return new Response(JSON.stringify({ count: 3 }), { status: 200 });
        if (url === "/api/activity/seen") return new Response(null, { status: 204 });
        if (url === "/api/activity/settings") return new Response(JSON.stringify(ACTIVITY_DEFAULTS), { status: 200 });
        return new Response(JSON.stringify({ items: [], nextCursor: null, seenAt: null }), { status: 200 });
      }),
    );
    try {
      await activityApi.page("conversations", "20261028090000123456_e_x");
      await activityApi.page("all");
      expect((await activityApi.newer("all", "2026-10-28T09:00:00.123456Z")).count).toBe(3);
      await activityApi.newer("conversations");
      await activityApi.seen("2026-10-28T09:00:00.123456Z");
      expect(await activityApi.settings()).toEqual(ACTIVITY_DEFAULTS);
      await activityApi.saveSettings({ ...ACTIVITY_DEFAULTS, follows: false });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toEqual([
      ["GET", "/api/activity?tab=conversations&cursor=20261028090000123456_e_x"],
      ["GET", "/api/activity?tab=all"],
      ["GET", "/api/activity/newer?tab=all&since=2026-10-28T09%3A00%3A00.123456Z"],
      ["GET", "/api/activity/newer?tab=conversations"],
      ["POST", "/api/activity/seen"],
      ["GET", "/api/activity/settings"],
      ["PUT", "/api/activity/settings"],
    ]);
  });

  test("the newer count is asked 30 s after the screen opens and every 60 s after, only while it is on screen and visible", async () => {
    vi.useFakeTimers({ now: NOW });
    const ask = vi.fn(async () => undefined);
    const poll = createActivityPoll(ask);
    poll.setActive(activityPollActive({ focused: true, visible: true, ready: true }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ask).toHaveBeenCalledTimes(2);
    // Hidden or left, nothing is asked; back, the wait goes on from where it stopped.
    poll.setActive(activityPollActive({ focused: true, visible: false, ready: true }));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(ask).toHaveBeenCalledTimes(2);
    poll.setActive(activityPollActive({ focused: true, visible: true, ready: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ask).toHaveBeenCalledTimes(3);
    poll.dispose();
    expect(activityPollActive({ focused: false, visible: true, ready: true })).toBe(false);
    expect(activityPollActive({ focused: true, visible: true, ready: false })).toBe(false);
  });

  test("a focus waits for its row: tried at once and every 50 ms until it lands, given up after 5 s, and cancelled by a newer one or the list's end", async () => {
    vi.useFakeTimers({ now: NOW });
    // The row is drawn at the third try: three tries, then none.
    let drawn = 0;
    const lands = vi.fn(() => ++drawn >= 3);
    retryFocus(lands);
    await vi.advanceTimersByTimeAsync(0);
    expect(lands).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(lands).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lands).toHaveBeenCalledTimes(3);
    // A row never drawn: tried for 5 s, then left alone.
    const never = vi.fn(() => false);
    retryFocus(never);
    await vi.advanceTimersByTimeAsync(5000);
    const tries = never.mock.calls.length;
    expect(tries).toBeGreaterThan(90);
    await vi.advanceTimersByTimeAsync(5000);
    expect(never).toHaveBeenCalledTimes(tries);
    // Cancelled (a newer focus, the list gone): no further try.
    const replaced = vi.fn(() => false);
    const cancel = retryFocus(replaced);
    await vi.advanceTimersByTimeAsync(120);
    const before = replaced.mock.calls.length;
    cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(replaced).toHaveBeenCalledTimes(before);
  });

  test("a setting is saved once it has been still for 800 ms, or at once when the focus leaves its group: one request per settled change", async () => {
    vi.useFakeTimers({ now: NOW });
    const save = vi.fn(async (next: typeof ACTIVITY_DEFAULTS) => next);
    const saved = vi.fn();
    const failed = vi.fn();
    const saver = createSettingsSaver({ initial: ACTIVITY_DEFAULTS, save, onSaved: saved, onFailed: failed });
    // Three arrow presses across a group: one request, with the last.
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "older" });
    await vi.advanceTimersByTimeAsync(300);
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "following" });
    await vi.advanceTimersByTimeAsync(300);
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "off" });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith({ ...ACTIVITY_DEFAULTS, replies: "off" });
    expect(saved).toHaveBeenCalledTimes(1);
    // Leaving the group saves at once; arrowing back to the saved value sends nothing.
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "off", follows: false });
    saver.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "everyone", follows: false });
    saver.choose({ ...ACTIVITY_DEFAULTS, replies: "off", follows: false });
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(2);
    // A refused save rolls back to what was saved, with its sentence (the screen's onFailed).
    save.mockRejectedValueOnce(new Error("busy"));
    saver.choose({ ...ACTIVITY_DEFAULTS, quotes: "off" });
    await vi.advanceTimersByTimeAsync(800);
    expect(failed).toHaveBeenCalledWith({ ...ACTIVITY_DEFAULTS, replies: "off", follows: false });
    saver.dispose();
  });
});

describe("the entries (5.5.3, 10.2, 10.4)", () => {
  test("a reply: an article named by its line and time, the actor's avatar, the post as a static card whose one action is Reply", () => {
    const out = html(<PostEntry entry={replyEntry(true)} />);
    const article = tags(out).find((tag) => tag.includes('role="article"'))!;
    expect(attr(article, "aria-label")).toBe("New, Grace Hopper replied to your post, 3h ago");
    expect(tags(out).filter((tag) => tag.includes('role="article"'))).toHaveLength(1);
    expect(textOf(out)).toContain("Grace Hopper replied to your post");
    // The actor's picture, the small file, after the API's base.
    expect(out).toContain(`data-uri="/api/media/${id(90)}/small.webp"`);
    // The card keeps its links (the author, the post's time, the stored mention) and only Reply of its actions.
    const hrefs = anchors(out).map((link) => link.href);
    expect(hrefs).toContain(`/post/${id(10)}`);
    expect(hrefs).toContain("/u/ada");
    expect(buttonNames(out)).toEqual(["Reply"]);
  });

  test("a follow group: its avatars and names are links to each profile; more than three ends with See your followers", () => {
    const three = html(<FollowsEntry entry={follows(5, [GRACE, LINUS, BEN])} handle="ada" />);
    expect(attr(tags(three).find((tag) => tag.includes('role="article"'))!, "aria-label")).toMatch(/^Grace Hopper and 4 others followed you, /);
    const named = anchors(three).filter((link) => link.href.startsWith("/u/") && !link.href.endsWith("/followers"));
    expect([...new Set(named.map((link) => link.href))]).toEqual(["/u/grace", "/u/linus", "/u/ben"]);
    expect(anchors(three).filter((link) => link.href === "/u/ada/followers").map((link) => textOf(link.inner))).toEqual([W["activity.follow.all"]]);
    // The row itself is no link or button: each target is its own.
    expect(tags(three).find((tag) => tag.includes('role="article"'))).not.toMatch(/href=|role="button"/);
    const two = html(<FollowsEntry entry={follows(2, [GRACE, LINUS])} handle="ada" />);
    expect(textOf(two)).toContain("Grace Hopper and Linus followed you");
    expect(anchors(two).map((link) => link.href)).not.toContain("/u/ada/followers");
  });

  test("a moderation entry opens its screen under Settings, Cases, or the post for a lost image", () => {
    const cases: [ReturnType<typeof moderation>, string][] = [
      [moderation("decision", "post", 30), `/settings/cases/${id(30)}`],
      [moderation("release", "account", 33), `/settings/cases/releases/${id(33)}`],
      [moderation("upload", "account", 34), `/settings/cases/uploads/${id(34)}`],
      [moderation("lost", "post", 35), `/post/${id(14)}`],
    ];
    for (const [value, href] of cases) {
      const out = html(<ModerationEntry entry={value} />);
      expect(anchors(out).map((link) => link.href), href).toEqual([href]);
      expect(attr(tags(out).find((tag) => tag.includes('role="article"'))!, "aria-label"), href).toBe(entryName(value));
      expect(out, href).toContain("lucide-scale");
    }
    expect(textOf(html(<ModerationEntry entry={moderation("decision", "account", 32)} />))).toContain(W["activity.moderation.open"]);
  });

  test("the headings are h2s; the empty states, the end and the error say the design's words", () => {
    const view = (row: Parameters<typeof ActivityRowView>[0]["row"], tab: "all" | "conversations" = "all") => html(<ActivityRowView row={row} tab={tab} handle="ada" onRetry={() => undefined} onLoadMore={() => undefined} />);
    expect(headings(view({ kind: "heading", key: "heading-new", heading: "new" }))).toEqual([[2, W["activity.divider"]]]);
    expect(headings(view({ kind: "heading", key: "heading-earlier", heading: "earlier" }))).toEqual([[2, W["activity.earlier"]]]);
    expect(textOf(view({ kind: "empty", key: "empty" }))).toBe(`${W["activity.empty.all.title"]} ${W["activity.empty.all.body"]}`);
    expect(textOf(view({ kind: "empty", key: "empty" }, "conversations"))).toBe(`${W["activity.empty.conversations.title"]} ${W["activity.empty.conversations.body"]}`);
    expect(textOf(view({ kind: "end", key: "end" }))).toBe("That's everything from the last 90 days.");
    const error = view({ kind: "error", key: "error", message: "x" });
    expect(textOf(error)).toContain(W["activity.error"]);
    expect(buttonTexts(error)).toContain(UI_WORDS["error.retry"]);
  });

  test("the screen: its title, one h1, the tabs All and Conversations in a named list, and the quiet link to Settings, Activity", () => {
    const out = html(<Activity />);
    expect(out).toContain(`<title>${TITLE_WORDS["title.activity"]}</title>`);
    expect(headings(out).filter(([level]) => level === 1)).toEqual([[1, W["activity.title"]]]);
    const list = tags(out).find((tag) => tag.includes('role="tablist"'))!;
    expect(attr(list, "aria-label")).toBe(W["activity.tabs"]);
    expect(tags(out).filter((tag) => tag.includes('role="tab"')).map((tag) => attr(tag, "aria-selected"))).toEqual(["true", "false"]);
    expect(textOf(out)).toContain(`${W["activity.tab.all"]} ${W["activity.tab.conversations"]}`);
    expect(anchors(out).filter((link) => link.href === "/settings/activity").map((link) => textOf(link.inner))).toEqual([W["activity.settingsLink"]]);
  });
});

describe("Settings, Activity (10.8)", () => {
  test("an intro and four radio groups, each one tab stop on its chosen radio, with the design's choices", () => {
    const out = html(<ActivitySettingsForm value={{ ...ACTIVITY_DEFAULTS, quotes: "following", follows: false }} onChoose={() => undefined} onLeave={() => undefined} />);
    const S = ACTIVITY_SETTINGS_WORDS;
    expect(textOf(out)).toContain(S.intro);
    expect(headings(out).map(([, words]) => words)).toEqual([S.replies, S.mentions, S.quotes, S.follows]);
    // Each group up to the next card's heading; the last one up to the two sentences after the cards.
    const groups = out.split(/(?=<div[^>]*role="radiogroup")/).slice(1).map((part) => part.split("<h2")[0]!.split(S.muted)[0]!);
    expect(groups).toHaveLength(4);
    const radios = (group: string) => tags(group).filter((tag) => tag.includes('role="radio"'));
    for (const group of groups.slice(0, 3)) expect(textOf(group)).toBe(`${S.everyone} ${S.older} ${S.following} ${S.off}`);
    expect(textOf(groups[3]!)).toBe(`${S.on} ${S.off}`);
    // One tab stop a group: its chosen radio.
    expect(radios(groups[2]!).map((tag) => [attr(tag, "aria-checked"), attr(tag, "tabindex")])).toEqual([
      ["false", "-1"],
      ["false", "-1"],
      ["true", "0"],
      ["false", "-1"],
    ]);
    expect(radios(groups[3]!).map((tag) => attr(tag, "aria-checked"))).toEqual(["false", "true"]);
    expect(textOf(out)).toContain(S.muted);
    expect(textOf(out)).toContain(S.fromNow);
  });
});

describe("Getting started (decision 25, 10.7)", () => {
  afterEach(() => {
    layout.kind = "wide";
  });

  test("its heading and sentence, then Latest, Explore and how it picks, the handle box, the profile's settings and the rules", () => {
    const shown = vi.fn();
    const out = html(<GettingStarted onShowLatest={shown} />);
    expect(headings(out)[0]).toEqual([2, UI_WORDS["feed.start.title"]]);
    expect(textOf(out)).toContain(UI_WORDS["feed.start.body"]);
    expect(buttonTexts(out)).toContain(UI_WORDS["feed.start.latest"]);
    const links = anchors(out).map((link) => [textOf(link.inner), link.href]);
    expect(links).toContainEqual([UI_WORDS["feed.start.explore"], "/explore/about"]);
    expect(links).toContainEqual([UI_WORDS["feed.start.profile"], "/settings/profile"]);
    expect(links).toContainEqual([UI_WORDS["feed.start.rules"], "/rules"]);
    // The handle box itself, drawn inside the panel on every width.
    expect(out).toContain(`aria-label="${UI_WORDS["handle.field"]}"`);
    // Wide, the context column holds How korbat works and Settings is in the nav: neither line is repeated here.
    expect(textOf(out)).not.toContain(UI_WORDS["feed.start.settings"]);
    expect(textOf(out)).not.toContain(UI_WORDS["shell.how1"]);
    // No account is suggested by name, and nothing is dismissed.
    expect(textOf(out)).not.toMatch(/Not now|Dismiss/);
  });

  test("on a phone the profile's row says where Settings is, and the panel ends with How korbat works' three lines", () => {
    layout.kind = "phone";
    const out = html(<GettingStarted onShowLatest={() => undefined} />);
    expect(textOf(out)).toContain(UI_WORDS["feed.start.settings"]);
    for (const line of [UI_WORDS["shell.how1"], UI_WORDS["shell.how2"], UI_WORDS["shell.how3"]]) expect(textOf(out).replace(/&#x27;/g, "'")).toContain(line);
    layout.kind = "tablet";
    const tablet = html(<GettingStarted onShowLatest={() => undefined} />);
    expect(textOf(tablet)).not.toContain(UI_WORDS["feed.start.settings"]);
    expect(textOf(tablet)).toContain(UI_WORDS["shell.how1"]);
  });
});
