import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EngagementResponse, FollowResponse, MeResponse, PostView } from "@korbat/contracts";
import { MenuPanel } from "../src/components/kit/Menu";
import { DeleteQuestion, PostCard, QuoteEmbed, repostMenuItems } from "../src/components/social/PostCard";
import { PostMenuPanel } from "../src/components/social/PostMenu";
import { FollowButton } from "../src/components/social/ProfileList";
import { WhoSeesThisBody } from "../src/components/social/WhoSeesThis";
import { DEFAULT_APPEARANCE, setAppearance } from "../src/lib/appearance";
import { REPORT_WORDS } from "../src/lib/moderation-words";
import { countLabel, deleteWithLeave, failedWords, flipped, followFailedWords, restored, settled, threadStats, toggleEngagement, toggleFollow, type ToggleKind } from "../src/lib/post-actions";
import { reach } from "../src/lib/reach";
import { createLanes, laneKey } from "../src/lib/social";
import { fullDate, postedWhen, timeAgo } from "../src/lib/time";
import { UI_WORDS, fill } from "../src/lib/ui-words";

/**
 * The post card (UI design, sections 6.6, 6.9, 6.14 and 10; Task 4): an article named by its author line, one explicit
 * link to the post in its time, icon actions named with their counts, the More and Repost menus, the delete question, and
 * the optimistic actions with their rollback, for the card's toggles and for FollowButton. A static render cannot press,
 * so the menus are drawn open through their panels, and the actions' transitions and request lanes are the pure
 * functions the components call, driven here through a fake social client that answers or refuses.
 */
const session = vi.hoisted(() => ({ state: { status: "signed-out" } as unknown }));

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined, replace: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: session.state, refresh: async () => session.state }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
// A toast is sonner's, which a static render has no use for; the words it would show are tested as the functions give them.
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
/** Every opening tag of the markup. */
const tags = (markup: string): string[] => markup.match(/<[a-z0-9]+\b[^>]*>/g) ?? [];
/** The first opening tag that carries `attribute`. */
const tagWith = (markup: string, attribute: string): string => tags(markup).find((tag) => tag.includes(attribute)) ?? "";
/** An attribute's value in an opening tag, or null. */
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(` ${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 3;
  return tag.slice(from, tag.indexOf('"', from));
}
/** The text of every button, read up to the first closing div, as kit.test.tsx reads it: a menu item is named by its words. */
const buttonTexts = (markup: string): string[] => [...markup.matchAll(/<(?:div|button)\b[^>]*\brole="button"[^>]*>(.*?)<\/(?:div|button)>/g)].map((match) => textOf(match[1]!));
/** The accessible name of every button, from its aria-label. */
const buttonNames = (markup: string): string[] => tags(markup).filter((tag) => tag.includes('role="button"')).map((tag) => (attr(tag, "aria-label") ?? "").replace(/&#x27;/g, "'"));
/** Each anchor with its href and its inner markup. */
const anchors = (markup: string): { href: string; open: string; inner: string }[] =>
  [...markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((match) => ({ href: attr(match[1]!, "href") ?? "", open: match[1]!, inner: match[2]! }));
/** The inner markup of the element whose id is `id`. */
function byId(markup: string, id: string): string {
  const at = markup.indexOf(` id="${id}"`);
  if (at < 0) return "";
  const start = markup.lastIndexOf("<", at);
  const name = /^<([a-z0-9]+)/.exec(markup.slice(start))![1]!;
  const from = markup.indexOf(">", at) + 1;
  return markup.slice(from, markup.indexOf(`</${name}>`, from));
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = { id: id(900), handle: "ada", displayName: "Ada Lovelace", verified: false };
const BEN = { id: id(901), handle: "ben", displayName: "Ben", verified: false };
const NOW = new Date("2026-10-04T13:00:00.000Z");

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(1),
    author: ADA,
    body: "The ferries are running late again.",
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

function me(userId: string): { status: "signed-in"; me: MeResponse } {
  return {
    status: "signed-in",
    me: {
      user: { id: userId, email: "x@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
      profile: { id: userId, handle: "reader", displayName: "Reader", handleChangedAt: null, verified: false, showInExplore: true },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
    } as MeResponse,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  session.state = { status: "signed-out" };
});
afterEach(() => {
  vi.useRealTimers();
  setAppearance(DEFAULT_APPEARANCE);
});

describe("the post is an article with one link to it (6.6)", () => {
  test("an article named by its author line: the name, the handle and when it was posted", () => {
    const out = html(<PostCard post={post()} />);
    const article = tagWith(out, 'role="article"');
    const label = attr(article, "aria-labelledby");
    expect(label).not.toBeNull();
    expect(textOf(byId(out, label!))).toBe("Ada Lovelace, @ada, 3h ago");
  });

  test("the time is the post's only link: it shows the short time, and its name adds postedWhen's words around it", () => {
    for (const [createdAt, short] of [
      ["2026-10-04T12:59:40.000Z", "just now"],
      ["2026-10-04T10:00:00.000Z", "3h"],
      ["2026-09-20T10:00:00.000Z", timeAgo("2026-09-20T10:00:00.000Z", NOW.getTime())],
    ] as const) {
      const out = html(<PostCard post={post({ createdAt })} />);
      const links = anchors(out).filter((link) => link.href === `/post/${id(1)}`);
      expect(links, short).toHaveLength(1);
      const link = links[0]!;
      const when = postedWhen(createdAt, NOW.getTime());
      // The visible short time is hidden from the name, which says it inside the hidden words: the name contains the label.
      const visible = tags(link.inner).find((tag) => link.inner.includes(`${tag}${short}<`)) ?? "";
      expect(visible, short).toContain('aria-hidden="true"');
      expect(textOf(link.inner)).toContain(fill(UI_WORDS["post.open"], { when }));
      expect(when).toContain(short === "just now" ? "just now" : short);
    }
  });

  test("the name is the profile link; the avatar sits in a second one, out of the tab order and hidden", () => {
    const out = html(<PostCard post={post()} />);
    const profile = anchors(out).filter((link) => link.href === "/u/ada");
    expect(profile).toHaveLength(2);
    const [avatar, name] = profile;
    expect(avatar!.open).toContain('tabindex="-1"');
    expect(avatar!.open).toContain('aria-hidden="true"');
    expect(textOf(name!.inner)).toBe("Ada Lovelace");
    expect(name!.open).not.toContain('tabindex="-1"');
  });

  test("the body is text, no longer a link", () => {
    const out = html(<PostCard post={post()} />);
    expect(textOf(out)).toContain("The ferries are running late again.");
    for (const link of anchors(out)) expect(textOf(link.inner)).not.toContain("ferries");
  });

  test("the repost line names who reposted, as a link to their profile, and the reply context links its author", () => {
    const out = html(<PostCard post={post({ replyTo: { id: id(2), authorHandle: "ben" } })} repostedBy={BEN} />);
    expect(textOf(out)).toContain(fill(UI_WORDS["post.reposted"], { displayName: "Ben" }));
    expect(anchors(out).filter((link) => link.href === "/u/ben").map((link) => textOf(link.inner))).toEqual(["Ben", "@ben"]);
    expect(textOf(out)).toContain(`${UI_WORDS["post.replyingTo"].trim()} @ben`);
    expect(textOf(html(<PostCard post={post({ replyTo: { id: id(2), authorHandle: null } })} />))).toContain(UI_WORDS["post.replyingHidden"]);
  });

  test("a quoted post has its own author line: the name to the profile, the time to the quoted post; a tombstone keeps its words", () => {
    const quoted = { ...post({ id: id(2), author: BEN, body: "quoted words" }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(anchors(out).map((link) => link.href)).toEqual(["/u/ben", `/post/${id(2)}`]);
    expect(textOf(out)).toContain("quoted words");
    expect(textOf(html(<QuoteEmbed quote={{ id: id(3), deleted: true }} />))).toBe(UI_WORDS["post.deleted"]);
    expect(textOf(html(<QuoteEmbed quote={{ id: id(3), unavailable: true }} />))).toBe(UI_WORDS["post.unavailable"]);
    expect(UI_WORDS["post.deleted"]).toBe("This post was deleted by its author.");
    expect(UI_WORDS["post.unavailable"]).toBe("This post is unavailable.");
  });
});

describe("the actions' names (6.6, section 10, decision 15)", () => {
  const named = (counts: PostView["counts"]) => buttonNames(html(<PostCard post={post({ counts })} />));

  test("Reply, Repost and Like say their count, in the singular for one and with no number at zero", () => {
    expect(named({ likes: 0, reposts: 0, replies: 0, quotes: 0 }).slice(0, 3)).toEqual(["Reply", "Repost", "Like"]);
    expect(named({ likes: 1, reposts: 1, replies: 1, quotes: 0 }).slice(0, 3)).toEqual(["Reply, 1 reply", "Repost, 1 repost", "Like, 1 like"]);
    expect(named({ likes: 30, reposts: 12, replies: 4, quotes: 2 }).slice(0, 3)).toEqual(["Reply, 4 replies", "Repost, 12 reposts", "Like, 30 likes"]);
    expect(countLabel("like", 1234, false)).toBe("Like, 1234 likes");
  });

  test("hiding counts drops the like and repost numbers, in the name and on screen; replies keep theirs", () => {
    setAppearance({ hideCounts: true });
    const out = html(<PostCard post={post({ counts: { likes: 30, reposts: 12, replies: 4, quotes: 2 } })} />);
    expect(buttonNames(out).slice(0, 3)).toEqual(["Reply, 4 replies", "Repost", "Like"]);
    expect(textOf(out)).not.toMatch(/\b30\b|\b12\b/);
    expect(textOf(out)).toMatch(/\b4\b/);
  });

  test("Like and Repost say whether they are on; Save changes its name instead; Repost and More open menus", () => {
    session.state = me(id(950));
    const on = html(<PostCard post={post({ viewer: { liked: true, reposted: true, bookmarked: true } })} />);
    const off = html(<PostCard post={post({ viewer: { liked: false, reposted: false, bookmarked: false } })} />);
    const button = (markup: string, name: string) => tags(markup).find((tag) => tag.includes('role="button"') && attr(tag, "aria-label") === name) ?? "";
    expect(button(on, "Like")).toContain('aria-pressed="true"');
    expect(button(off, "Like")).toContain('aria-pressed="false"');
    expect(button(on, "Repost")).toContain('aria-pressed="true"');
    expect(button(on, "Repost")).toContain('aria-haspopup="menu"');
    expect(button(on, "Repost")).toContain('aria-expanded="false"');
    expect(button(on, "Saved")).not.toContain("aria-pressed");
    expect(button(off, "Save")).not.toContain("aria-pressed");
    const more = button(off, UI_WORDS["post.more"]);
    expect(more).toContain('aria-haspopup="menu"');
    expect(UI_WORDS["post.more"]).toBe("More options for this post");
    expect(buttonNames(off)).toEqual(["Reply", "Repost", "Like", "Save", "More options for this post"]);
  });

  test("the thread's stats line: each part in the singular for one, left out at zero, likes and reposts left out when hidden", () => {
    expect(threadStats({ reposts: 12, quotes: 4, likes: 30, replies: 9 }, false)).toBe("12 reposts, 4 quotes, 30 likes");
    expect(threadStats({ reposts: 1, quotes: 1, likes: 1, replies: 0 }, false)).toBe("1 repost, 1 quote, 1 like");
    expect(threadStats({ reposts: 0, quotes: 2, likes: 0, replies: 0 }, false)).toBe("2 quotes");
    expect(threadStats({ reposts: 12, quotes: 4, likes: 30, replies: 0 }, true)).toBe("4 quotes");
    expect(threadStats({ reposts: 0, quotes: 0, likes: 0, replies: 3 }, false)).toBe("");
  });

  test("the large variant shows the full date and the stats line above the actions", () => {
    const out = textOf(html(<PostCard post={post({ counts: { likes: 30, reposts: 12, replies: 4, quotes: 2 } })} large />));
    expect(out).toContain("12 reposts, 2 quotes, 30 likes");
    // The full date in the reader's own time zone, which is the machine's here.
    expect(out).toContain(fullDate("2026-10-04T10:00:00.000Z"));
  });
});

describe("the menus, drawn open (6.9, decision 12)", () => {
  const items = (markup: string) => ({ buttons: buttonTexts(markup), links: anchors(markup).map((link) => [textOf(link.inner), link.href]) });

  test("More holds Who sees this, Copy link, and Report for anyone's post but the reader's own, signed in or out", () => {
    for (const state of [{ status: "signed-out" }, me(id(950))]) {
      session.state = state;
      const out = html(<PostMenuPanel post={post()} onDelete={() => undefined} onWhoSees={() => undefined} />);
      expect(items(out).buttons).toEqual([UI_WORDS["post.whoSees"], UI_WORDS["post.copyLink"]]);
      expect(items(out).links).toEqual([[REPORT_WORDS.control, `/report?post=${id(1)}`]]);
    }
    session.state = me(ADA.id);
    const own = html(<PostMenuPanel post={post()} onDelete={() => undefined} onWhoSees={() => undefined} />);
    expect(items(own).buttons).toEqual([UI_WORDS["post.whoSees"], UI_WORDS["post.copyLink"], UI_WORDS["post.delete"]]);
    expect(items(own).links).toEqual([]);
    // Who sees this carries its one-line summary under its label.
    expect(textOf(own)).toContain(reach(post(), me(ADA.id).me).summary);
  });

  test("the Repost menu offers Repost or Undo repost, and Quote as a link: to the quote composer, or to sign in", () => {
    const panel = (view: PostView, signedIn: boolean) => html(<MenuPanel label={UI_WORDS["post.repost"]} items={repostMenuItems(view, signedIn, () => undefined)} layout="wide" onPick={() => undefined} />);
    const signedIn = panel(post({ viewer: { liked: false, reposted: false, bookmarked: false } }), true);
    expect(items(signedIn).buttons).toEqual([UI_WORDS["post.repost"]]);
    expect(items(signedIn).links).toEqual([[UI_WORDS["post.quote"], `/post/${id(1)}?quote=1`]]);
    expect(items(panel(post({ viewer: { liked: false, reposted: true, bookmarked: false } }), true)).buttons).toEqual([UI_WORDS["post.unrepost"]]);
    expect(items(panel(post(), false)).links).toEqual([[UI_WORDS["post.quote"], "/signin"]]);
    expect([UI_WORDS["post.repost"], UI_WORDS["post.unrepost"], UI_WORDS["post.quote"]]).toEqual(["Repost", "Undo repost", "Quote"]);
  });

  test("Who sees this lists reach()'s sentences with their links", () => {
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: null };
    const view = post({ state: "removed", moderation: decision });
    const out = html(<WhoSeesThisBody post={view} me={me(ADA.id).me} explore={null} />);
    for (const line of reach(view, me(ADA.id).me).lines) expect(textOf(out)).toContain(line.text);
    expect(anchors(out).map((link) => [textOf(link.inner), link.href])).toEqual([
      [UI_WORDS["reach.decision"], `/settings/cases/${id(7)}`],
      [UI_WORDS["reach.how"], "/explore/about"],
    ]);
  });
});

describe("delete (6.6)", () => {
  test("the question replaces the action row: a dialog named by its question, with Delete and Keep", () => {
    const out = html(<DeleteQuestion postId={id(1)} busy={false} onDelete={() => undefined} onKeep={() => undefined} />);
    const dialog = tagWith(out, 'role="dialog"');
    expect(textOf(byId(out, attr(dialog, "aria-labelledby")!))).toBe(UI_WORDS["post.deleteQuestion"]);
    expect(UI_WORDS["post.deleteQuestion"]).toBe("Delete this post?");
    expect(textOf(out)).toContain("Delete");
    expect(textOf(out)).toContain("Keep");
  });

  test("a deleted post leaves the list after it has faded, never before the answer; a refusal leaves it in place", async () => {
    const lanes = createLanes();
    const order: string[] = [];
    const client = { deletePost: vi.fn(async () => void order.push("answered")) };
    const result = await deleteWithLeave(client, lanes, id(1), async () => void order.push("faded"));
    expect(result).toEqual({ status: "deleted" });
    expect(order).toEqual(["answered", "faded"]);
    const refusing = { deletePost: vi.fn(async () => Promise.reject(new Error("refused"))) };
    const refused = await deleteWithLeave(refusing, lanes, id(1), async () => void order.push("faded again"));
    expect(refused.status).toBe("refused");
    expect(order).toEqual(["answered", "faded"]);
  });
});

describe("optimistic actions with rollback (6.6, section 5.2)", () => {
  const counts = { likes: 5, reposts: 2, replies: 1, quotes: 0 };
  const viewer = { liked: false, reposted: false, bookmarked: false };
  const base = post({ counts, viewer });

  test("each toggle changes the state and its count at once, both ways; Save has no count", () => {
    expect(flipped(base, "like")).toMatchObject({ viewer: { liked: true }, counts: { likes: 6 } });
    expect(flipped(base, "repost")).toMatchObject({ viewer: { reposted: true }, counts: { reposts: 3 } });
    expect(flipped(base, "bookmark")).toMatchObject({ viewer: { bookmarked: true }, counts });
    const on = post({ counts, viewer: { liked: true, reposted: true, bookmarked: true } });
    expect(flipped(on, "like")).toMatchObject({ viewer: { liked: false }, counts: { likes: 4 } });
    expect(flipped(on, "repost")).toMatchObject({ viewer: { reposted: false }, counts: { reposts: 1 } });
    // Never below zero, whatever a stale count says.
    expect(flipped(post({ counts: { ...counts, likes: 0 }, viewer: { ...viewer, liked: true } }), "like").counts.likes).toBe(0);
  });

  /** A fake social client whose answers the test releases one at a time. */
  function fakeClient() {
    const pending: { kind: string; on: boolean; resolve: (answer: EngagementResponse) => void; reject: (error: unknown) => void }[] = [];
    const engage = vi.fn((_id: string, kind: string, on: boolean) => new Promise<EngagementResponse>((resolve, reject) => pending.push({ kind, on, resolve, reject })));
    return { client: { engage }, pending };
  }

  for (const kind of ["like", "repost", "bookmark"] as ToggleKind[]) {
    test(`${kind}: the card changes before the answer, the answer's counts replace its own, and a refusal restores it`, async () => {
      let view = base;
      const apply = (update: (current: PostView) => PostView) => void (view = update(view));
      const { client, pending } = fakeClient();
      const lanes = createLanes();
      const started: boolean[] = [];
      const running = toggleEngagement(client, lanes, view, kind, apply, (on) => started.push(on));
      expect(started).toEqual([true]);
      expect(view).toEqual(flipped(base, kind));
      const answer = { counts: { likes: 9, reposts: 7, replies: 1, quotes: 3 }, viewer: { ...viewer, [kind === "bookmark" ? "bookmarked" : kind === "like" ? "liked" : "reposted"]: true } };
      pending[0]!.resolve(answer);
      expect(await running).toEqual({ status: "answered", on: true });
      expect(view.counts).toEqual(answer.counts);
      expect(view).toEqual(settled(flipped(base, kind), kind, answer));
      // A refusal of the same turn puts back the reader's state and count of that kind only.
      view = base;
      const refusing = toggleEngagement(client, lanes, view, kind, apply);
      pending[1]!.reject(new Error("refused"));
      const result = await refusing;
      expect(result.status).toBe("refused");
      expect(view).toEqual(base);
      expect(failedWords(kind, true)).toMatch(/^Couldn't .*Try again\.$/);
    });
  }

  test("a rollback restores only its own kind, so a like refused while a save landed keeps the save", () => {
    const liked = flipped(flipped(base, "bookmark"), "like");
    expect(restored(liked, base, "like")).toEqual(flipped(base, "bookmark"));
  });

  test("each kind has its own lane: a second tap of a busy kind is not sent, while another kind runs beside it", async () => {
    let view = base;
    const apply = (update: (current: PostView) => PostView) => void (view = update(view));
    const { client, pending } = fakeClient();
    const lanes = createLanes();
    const first = toggleEngagement(client, lanes, view, "like", apply);
    const second = await toggleEngagement(client, lanes, view, "like", apply);
    expect(second).toEqual({ status: "busy" });
    // The double tap did not undo the like on screen either.
    expect(view.viewer?.liked).toBe(true);
    const save = toggleEngagement(client, lanes, view, "bookmark", apply);
    expect(client.engage.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["like", true],
      ["bookmark", true],
    ]);
    expect(lanes.busy(laneKey.post(id(1), "like"))).toBe(true);
    pending[0]!.resolve({ counts: { ...counts, likes: 6 }, viewer: { ...viewer, liked: true } });
    pending[1]!.resolve({ counts: { ...counts, likes: 6 }, viewer: { ...viewer, liked: true, bookmarked: true } });
    await Promise.all([first, save]);
    expect(view.viewer).toEqual({ liked: true, reposted: false, bookmarked: true });
    expect(lanes.busy(laneKey.post(id(1), "like"))).toBe(false);
  });

  test("the rollback toasts' words, one per action and direction", () => {
    expect([true, false].flatMap((on) => (["like", "repost", "bookmark"] as ToggleKind[]).map((kind) => failedWords(kind, on)))).toEqual([
      "Couldn't like this post. Try again.",
      "Couldn't repost this post. Try again.",
      "Couldn't save this post. Try again.",
      "Couldn't remove your like. Try again.",
      "Couldn't undo the repost. Try again.",
      "Couldn't remove this post from Bookmarks. Try again.",
    ]);
    expect(followFailedWords("grace", true)).toBe("Couldn't follow @grace. Try again.");
    expect(followFailedWords("grace", false)).toBe("Couldn't unfollow @grace. Try again.");
    expect([UI_WORDS["toast.saved"], UI_WORDS["toast.view"], UI_WORDS["toast.linkCopied"]]).toEqual(["Saved to Bookmarks", "View", "Link copied"]);
  });
});

describe("FollowButton (8.4)", () => {
  test("says Follow or Following, as a button named by its words", () => {
    session.state = me(id(950));
    expect(buttonNames(html(<FollowButton handle="grace" initial={false} />))).toEqual([""]);
    expect(textOf(html(<FollowButton handle="grace" initial={false} />))).toBe("Follow");
    expect(textOf(html(<FollowButton handle="grace" initial />))).toBe("Following");
  });

  test("changes at once, takes the answer's count, and a refusal puts it back", async () => {
    const lanes = createLanes();
    const shown: boolean[] = [];
    let release: (answer: FollowResponse) => void = () => undefined;
    const client = { setFollow: vi.fn(() => new Promise<FollowResponse>((resolve) => (release = resolve))) };
    const running = toggleFollow(client, lanes, "grace", false, (following) => shown.push(following));
    expect(shown).toEqual([true]);
    expect(await toggleFollow(client, lanes, "grace", true, (following) => shown.push(following))).toEqual({ status: "busy" });
    release({ following: true, followerCount: 129 });
    expect(await running).toEqual({ status: "answered", answer: { following: true, followerCount: 129 } });
    expect(shown).toEqual([true, true]);
    const refusing = { setFollow: vi.fn(async () => Promise.reject(new Error("refused"))) };
    const refused = await toggleFollow(refusing, lanes, "grace", true, (following) => shown.push(following));
    expect(refused.status).toBe("refused");
    expect(shown).toEqual([true, true, false, true]);
  });
});
