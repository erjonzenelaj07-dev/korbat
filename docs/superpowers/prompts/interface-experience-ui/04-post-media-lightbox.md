# korbat interface and experience (UI) — Task 4 of 10: The post, its media and the lightbox: section 6.6's post card with its menus and optimistic actions, section 6.7's media and lightbox, and section 6.14's Who sees this.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 4 of ten in korbat's UI sub-project (interface and experience), the first of the batch of Tasks 4 to 6, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Task 1's tokens, Task 2's kit and Task 3's shell and browser check. It follows sections 6.6 to 6.9 and 6.14 (the post card, media and lightbox, Sheet, Menu, Who sees this), 5.1 to 5.4 (motion, haptics, toasts), 8.1, 8.3, 8.4 and 8.6's words, 10 and 11.2; Task 5 builds the feeds, threads and profiles on these cards and passes the large variant.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): the shell, the navigation and the app's browser check: AppShell lays out a phone's tab bar, a tablet's 80 px rail with the k and from 1280 px the full nav with the wordmark, one aria-current item marked by an accent-wash pill, a 3 px accent bar and the strong stroke; a skip link to the main column, a polite offline banner and, from 1024 px, About korbat with the handle box and How korbat works where Popular now was; ScreenHeader's title slides away on a phone as the list scrolls down and returns on a scroll up, staying under reduced motion, and the current Home item brings the feed to its newest post; toast.show() over sonner and sonner-native; usePageTitle(), a not-found screen and an error boundary in the public frame; SettingsNav, StandingBanner, HandleBox and SessionFailure on the tokens; five screens load inside the shell; zod jitless from the app's entry; the browser check builds the export and walks it in Chromium in 17 steps; the smoke test loads the page, theme-boot.js, a font and a post's page`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/04-post-media-lightbox.md 1
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/post-card.test.tsx`

```tsx
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
```

### Create `apps/app/test/reach.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { ExploreStatusKind, type AccountStanding, type MeResponse, type PostView } from "@korbat/contracts";
import { exploreStatusText } from "../src/lib/explore";
import { chipText } from "../src/lib/moderation";
import { CHIP_WORDS } from "../src/lib/moderation-words";
import { reach, type Reach } from "../src/lib/reach";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * Who sees a post (UI design, section 6.14; Task 4): reach() turns the post, the reader's /me and, for the reader's own
 * top-level post, its Explore status into the sentences of the "Who sees this" sheet. Every branch is here, and the three
 * things no sentence may claim: a reader's view of someone else's post never mentions moderation, no sentence says a
 * blocked account cannot read a public post, and the sentence of a withheld or removed post names korbat's moderators.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADA = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
const BEN = { id: id(2), handle: "ben", displayName: "Ben", verified: false };

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(100),
    author: ADA,
    body: "a post",
    createdAt: "2026-10-04T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    ...extra,
  };
}

const STANDING: AccountStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };

function me(extra: { showInExplore?: boolean; standing?: AccountStanding } = {}): MeResponse {
  return {
    user: { id: ADA.id, email: "ada@korbat.local", role: "user", onboarded: true, mfaEnabled: false, hasPassword: false, passkeys: 0 },
    profile: { id: ADA.id, handle: "ada", displayName: "Ada", handleChangedAt: null, verified: false, showInExplore: extra.showInExplore ?? true },
    standing: extra.standing ?? STANDING,
  } as MeResponse;
}

const suspended: AccountStanding = {
  ...STANDING,
  measure: {
    decisionId: id(9),
    kind: "suspend",
    days: 7,
    state: "running",
    earliestStart: "2026-10-01T10:00:00.000Z",
    startsAt: "2026-10-01T10:00:00.000Z",
    endsAt: "2026-10-08T10:00:00.000Z",
    reply: null,
    replyOpen: true,
    appealUntil: null,
    appealPending: false,
  },
} as AccountStanding;

const texts = (found: Reach): string[] => found.lines.map((line) => line.text);
const W = UI_WORDS;

describe("the sentences, word for word (6.14)", () => {
  test("each is the design's", () => {
    expect(W["reach.public"]).toBe("Public. Anyone can read it, including people who are not signed in.");
    expect(W["reach.blocked"]).toBe("Accounts you blocked do not see it in their feeds, but anyone signed out can still read it.");
    expect(W["reach.feeds"]).toBe("It shows in Latest and in your followers' Following, in time order.");
    expect(W["reach.inExplore"]).toBe("Also in Explore.");
    expect(W["reach.exploreOff"]).toBe("Not in Explore: you turned Explore off.");
    expect(W["reach.suspended"]).toBe("Not in Explore while your account is suspended.");
    expect(W["reach.reply"]).toBe("Public. Shown in the thread and on your Replies tab.");
    expect(W["reach.private"]).toBe("Only you and korbat's moderators can see it.");
    expect(W["reach.order"]).toBe("Removed for everyone else by an authority's order.");
    expect(W["reach.decision"]).toBe("Read the decision");
    expect(W["reach.never"]).toBe("korbat never lowers a post's reach in secret. Following and Latest are in time order.");
    expect(W["reach.how"]).toBe("How Explore works");
  });
});

describe("reach()", () => {
  const last = { text: W["reach.never"], link: { label: W["reach.how"], href: "/explore/about" } };

  test("someone else's post, signed in or out: public, then how korbat treats reach, and nothing to ask", () => {
    for (const reader of [null, me()]) {
      const found = reach(post({ author: BEN }), reader);
      expect(found.lines).toEqual([{ text: W["reach.public"] }, last]);
      expect(found.asksExplore).toBe(false);
      expect(found.summary).toBe(W["reach.summary.public"]);
    }
  });

  test("the reader's own visible top-level post: public, what a block does, the feeds, and one Explore line", () => {
    const head = [W["reach.public"], W["reach.blocked"], W["reach.feeds"]];
    expect(texts(reach(post({ inExplore: true }), me()))).toEqual([...head, W["reach.inExplore"], W["reach.never"]]);
    expect(texts(reach(post(), me({ showInExplore: false })))).toEqual([...head, W["reach.exploreOff"], W["reach.never"]]);
    expect(texts(reach(post(), me({ standing: suspended })))).toEqual([...head, W["reach.suspended"], W["reach.never"]]);
    // Otherwise the sheet asks the post's Explore status when it opens, and says it in the words of the status line.
    const asking = reach(post(), me());
    expect(asking.asksExplore).toBe(true);
    expect(texts(asking)).toEqual([...head, W["reach.never"]]);
    for (const status of ["below_cutoff", "pending", "author_cap", "not_visible"] as const) {
      const answered = reach(post(), me(), status);
      expect(answered.asksExplore).toBe(false);
      expect(texts(answered)).toEqual([...head, exploreStatusText(status)!, W["reach.never"]]);
    }
    // The flags decide before any answer: the sheet does not ask when it already knows.
    for (const known of [reach(post({ inExplore: true }), me()), reach(post(), me({ showInExplore: false })), reach(post(), me({ standing: suspended }))]) expect(known.asksExplore).toBe(false);
    expect(reach(post(), me()).summary).toBe(W["reach.summary.public"]);
  });

  test("the reader's own reply: shown in the thread and on the Replies tab, and never in Explore", () => {
    const found = reach(post({ replyTo: { id: id(50), authorHandle: "ben" } }), me());
    expect(texts(found)).toEqual([W["reach.reply"], W["reach.replyExplore"], W["reach.never"]]);
    expect(found.asksExplore).toBe(false);
  });

  test("the reader's own quote never enters Explore either, so nothing is asked", () => {
    const quoted = { ...post({ id: id(60), author: BEN }), quoteOf: null };
    const found = reach(post({ quoteOf: quoted }), me());
    expect(texts(found)).toEqual([W["reach.public"], W["reach.blocked"], W["reach.feeds"], W["reach.quoteExplore"], W["reach.never"]]);
    expect(found.asksExplore).toBe(false);
  });

  test("the reader's own withheld or removed post: only they and the moderators, the chip's words, an order, and the decision", () => {
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: false, interim: false, strikeUntil: null };
    const removed = reach(post({ state: "removed", moderation: decision }), me());
    expect(removed.lines).toEqual([{ text: W["reach.private"] }, { text: chipText(decision), link: { label: W["reach.decision"], href: `/settings/cases/${id(7)}` } }, last]);
    expect(removed.asksExplore).toBe(false);
    expect(removed.summary).toBe(W["reach.summary.private"]);
    const ordered = reach(post({ state: "removed", moderation: { ...decision, order: true } }), me());
    expect(texts(ordered)).toEqual([W["reach.private"], chipText({ ...decision, order: true }), W["reach.order"], W["reach.never"]]);
    // Without the decision's facts the chip's plain words stand, and there is no decision to read.
    const bare = reach(post({ state: "withheld" }), me());
    expect(bare.lines).toEqual([{ text: W["reach.private"] }, { text: CHIP_WORDS.underReview }, last]);
    expect(texts(reach(post({ state: "removed" }), me()))).toEqual([W["reach.private"], CHIP_WORDS.removed, W["reach.never"]]);
  });

  test("always ends with how korbat treats reach, linked to How Explore works", () => {
    const shapes = [post({ author: BEN }), post(), post({ inExplore: true }), post({ replyTo: { id: id(50), authorHandle: null } }), post({ state: "withheld" })];
    for (const shape of shapes) expect(reach(shape, me()).lines.at(-1)).toEqual(last);
  });
});

describe("what no sentence may claim (6.14)", () => {
  /** Every sentence any branch can give, with each Explore status the sheet can be answered. */
  function everySentence(): { own: string[]; others: string[] } {
    const own: string[] = [];
    const others: string[] = [];
    const decision = { decisionId: id(7), ruleId: "R3" as const, legal: true, interim: true, strikeUntil: null, order: true };
    const shapes = [
      post(),
      post({ inExplore: true }),
      post({ replyTo: { id: id(50), authorHandle: "ben" } }),
      post({ quoteOf: { id: id(61), deleted: true } }),
      post({ state: "withheld", moderation: decision }),
      post({ state: "removed" }),
    ];
    for (const shape of shapes) {
      for (const reader of [me(), me({ showInExplore: false }), me({ standing: suspended })]) {
        own.push(...texts(reach(shape, reader)));
        for (const status of ExploreStatusKind.options) own.push(...texts(reach(shape, reader, status)));
        // The same post seen by someone else, even one whose view carried moderation it should not.
        for (const viewer of [null, reader]) others.push(...texts(reach({ ...shape, author: BEN }, viewer)));
      }
    }
    return { own, others };
  }

  test("a reader's view of someone else's post never mentions moderation", () => {
    const { others } = everySentence();
    for (const sentence of others) {
      expect(sentence).not.toMatch(/moderat|Removed|Under review|authority|decision|withheld/i);
    }
    expect(new Set(others)).toEqual(new Set([W["reach.public"], W["reach.never"]]));
  });

  test("no sentence says a blocked account cannot read a public post", () => {
    const { own, others } = everySentence();
    for (const sentence of [...own, ...others]) {
      if (/block/i.test(sentence)) expect(sentence).toContain("anyone signed out can still read it");
      expect(sentence).not.toMatch(/cannot read|can't read|can not read|cannot see|can't see|unable to/i);
    }
  });

  test("the sentence of a withheld or removed post names korbat's moderators", () => {
    for (const state of ["withheld", "removed"] as const) expect(texts(reach(post({ state }), me()))[0]).toContain("korbat's moderators");
  });
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
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import { createFixtureApi, DECISION_ID, MISSING_POST_ID, NOTICE_REF, NOTICE_TOKEN, POST_ID, postIdOf, RELEASE_ID, UPLOAD_ID, type FixtureApi } from "./fixture-api";
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
 * rollback, Follow with its rollback, the menus, and Who sees this. Later tasks add their screens' steps.
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
 * screen that is the kit's alone (the missing page); from Task 4 every post card (an article), every sheet and dialog,
 * a menu's popover, the follow button and the toaster. The screens' own content still paints with Tailwind's palette and
 * sizes until its task moves it onto the tokens (test/legacy-files.ts), and joins this list then: the feeds, threads and
 * profiles with Task 5, the composer with Task 6, the moderation and public pages with Task 7, settings and sign-in with
 * Task 8.
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
].join(", ");
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
});
```

### Replace `apps/app/test/browser/fixture-api.ts` (whole file)

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthorCasesPage,
  AuthorNoticesPage,
  DecisionView,
  EngagementResponse,
  ExplorePage,
  ExploreStatus,
  FollowResponse,
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
 * what the API would send. A request no fixture answers is a problem of the walk, answered 404. The reader's actions on a
 * post (like, repost, save, delete) and a follow are answered from UI Task 4 on, with switches that refuse a kind or
 * hold every action's answer back; nothing else that changes something is. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false };

/** Post number n's id, for a step that acts on one post of the timelines: Grace writes 1, 4, 7..., Linus 2, 5, 8..., Ada 3, 6, 9.... */
export const postIdOf = (n: number): string => id(100 + n);

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

/** Post number `n`: its author goes round the three accounts; every fourth carries an image, and post 8 two of them (the lightbox's steps page between them); newer posts have lower numbers. */
function post(n: number, signedIn: boolean, extra: Partial<PostView> = {}): PostView {
  const view: PostView = {
    id: id(100 + n),
    author: AUTHORS[(n - 1) % AUTHORS.length]!,
    body: BODIES[(n - 1) % BODIES.length]!,
    createdAt: ago(n * 7),
    state: "visible",
    replyTo: null,
    counts: { likes: (n * 3) % 17, reposts: n % 4, replies: n % 3, quotes: n % 2 },
    media: n === 8 ? [image(8), image(80)] : n % 4 === 0 ? [image(n)] : [],
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
      // The reader follows nobody yet, so the follow step starts from Follow.
      ...(signedIn && !self ? { viewer: { following: false, followedBy: false, blocked: false, muted: false } } : {}),
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
  /**
   * The actions the API refuses for now (like, repost, bookmark, follow, delete), with a 503 as a busy server would, so
   * a step sees the card roll back; and how long every action's answer waits, so a step sees the change before it.
   */
  refuse: Set<string>;
  delayMs: number;
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

/** A fixture post's number from its id: post n has the id id(100 + n). */
const numberOf = (postId: string): number => Number.parseInt(postId.slice(-12), 10) - 100;

/** Others who liked the post while the reader's like was on its way: the answer's count is the server's, not the card's guess. */
const OTHERS = 2;

const FLAGS = { like: "liked", repost: "reposted", bookmark: "bookmarked" } as const;

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [], refuse: new Set(), delayMs: 0 };
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
    // Ada's own posts (3, 6, 9 and every third) have an Explore status for her: post 3 is listed, the others wait.
    const exploring = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (exploring && numberOf(exploring[1]!) % 3 === 0) {
      return ok(parse(ExploreStatus, { status: exploring[1] === id(103) ? "listed" : "pending", computedAt: ago(5) }, "explore status"));
    }
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

  /**
   * The answer to one of the reader's actions (UI Task 4): a like, a repost or a save turned on (POST) or off (DELETE),
   * answered with the post's counts and the reader's state; a follow, with the follower count; a post deleted, with 204.
   * A kind in `refuse` is answered 503; null for any other path, which is a problem.
   */
  function action(method: string, path: string): Answer | null {
    const refused: Answer = { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
    const engaged = /^\/api\/posts\/([0-9a-f-]{36})\/(like|repost|bookmark)$/.exec(path);
    if (engaged) {
      const kind = engaged[2] as keyof typeof FLAGS;
      if (state.refuse.has(kind)) return refused;
      const on = method === "POST";
      const base = post(numberOf(engaged[1]!), true);
      const counts = { ...base.counts };
      if (kind === "like") counts.likes = base.counts.likes + (on ? 1 + OTHERS : 0);
      if (kind === "repost") counts.reposts = base.counts.reposts + (on ? 1 : 0);
      return ok(parse(EngagementResponse, { counts, viewer: { ...base.viewer!, [FLAGS[kind]]: on } }, "engagement"));
    }
    const follow = /^\/api\/profiles\/([a-z0-9_]+)\/follow$/.exec(path);
    if (follow && AUTHORS.some((author) => author.handle === follow[1])) {
      if (state.refuse.has("follow")) return refused;
      const on = method === "POST";
      return ok(parse(FollowResponse, { following: on, followerCount: on ? 129 : 128 }, "follow"));
    }
    const removed = /^\/api\/posts\/([0-9a-f-]{36})$/.exec(path);
    if (removed && method === "DELETE") return state.refuse.has("delete") ? refused : { status: 204 };
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
        if (method === "GET") answer = get(url.pathname, url.searchParams);
        else if (method === "POST") answer = post_(url.pathname, body) ?? action(method, url.pathname);
        else if (method === "DELETE") answer = action(method, url.pathname);
        // An action's answer waits as long as the step asks, so the step sees the card change before it lands.
        if (method !== "GET" && answer !== null && state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      } catch (err) {
        state.problems.push(`a fixture threw for ${method} ${url.pathname}: ${String(err)}`);
      }
      if (answer === null) {
        state.problems.push(`an unanswered request: ${method} ${url.pathname}${url.search}`);
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: { code: "not_found", message: "No such route" } }));
        return;
      }
      if (answer.status === 204) {
        res.writeHead(204, { "cache-control": "no-store" }).end();
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
    expect(card).toContain('const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";');
    expect(card).toContain("<StatusChip tone={tone} label={words} href={decision ? `/settings/cases/${decision.decisionId}` : undefined} />");
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
    expect(callers.map((file) => file.name).sort()).toEqual(["app/post/[id].tsx", "components/social/ExploreList.tsx", "components/social/WhoSeesThis.tsx"]);
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
    expect(out.indexOf(HIDDEN_IMAGE)).toBeLessThan(out.indexOf('aria-label="Reply'));
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
  "components/social/PagedList.tsx",
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
  "components/social/PagedList.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
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

  test("a post that is not the reader's own has Report in its More menu, drawn open, signed in or out; the reader's own has none", () => {
    for (const state of [{ status: "signed-out" }, me(id(901))]) {
      session.state = state;
      const out = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />);
      expect(hrefs(out)).toContain(`/report?post=${id(1)}`);
      expect(textOf(out)).toContain("Report");
    }
    session.state = me(id(900));
    const own = html(<PostMenuPanel post={post(1)} onDelete={() => undefined} onWhoSees={() => undefined} />) + html(<PostCard post={post(1)} />);
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
    // The quote's author line: its name to the profile, then its time to the quoted post; its squares open nothing themselves.
    const quoted = { ...post(2, { media: [image(21)] }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(hrefs(out)).toEqual(["/u/ada", `/post/${id(2)}`]);
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

// UI Task 4: Report moved into the post card's More menu (UI design, decision 12); imported here, below, so the lines above keep their numbers.
import { PostMenuPanel } from "../src/components/social/PostMenu";
```

### Replace `apps/app/test/theme.test.ts` (whole file)

```ts
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
  test("the ten variants have section 4.3's faces, weights, sizes, line heights and tracking, and 6.6's large post text", () => {
    const table: Record<TextVariant, [string, number, number, number, number]> = {
      "display-1": ["display", 600, 34, 40, -0.02],
      "display-2": ["display", 600, 28, 34, -0.015],
      "display-3": ["display", 600, 22, 28, -0.01],
      title: ["text", 700, 18, 24, 0],
      post: ["text", 400, 17, 26, 0],
      // The thread's focused post (6.6): the post's face at 19 / 28.
      "post-large": ["text", 400, 19, 28, 0],
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/04-post-media-lightbox.md 3
```

Expected: 24 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/kit/DragArea.tsx`

```tsx
import { useMemo, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/**
 * A drag on iOS and Android (UI design, sections 5.1 and 5.2): gesture-handler's Pan, which needs a
 * GestureHandlerRootView above it (the root layout's, and a Sheet's own inside its Modal). It starts after 10 px, takes
 * the axis it started along, and ends with gesture-handler's release velocity in px per second. Its callbacks run on the
 * JS thread (runOnJS), so the owner moves its shared values from plain functions, as the web's pointer events do in
 * DragArea.web.tsx; the drags it serves (a sheet's handle, the lightbox's image) move one view each.
 */
export type DragAxis = "x" | "y";

export interface DragHandlers {
  /** Off while the owner cannot be dragged. */
  enabled?: boolean;
  /** The drag has started along `axis`; `touch` is false for a mouse. Answer false to let this drag go. */
  onStart?: (axis: DragAxis, touch: boolean) => boolean | void;
  /** The distance from where the drag began, in px. */
  onMove: (dx: number, dy: number) => void;
  /** The release, with its velocity in px per second. */
  onEnd: (dx: number, dy: number, vx: number, vy: number) => void;
}

export function DragArea({ children, style, enabled = true, onStart, onMove, onEnd }: DragHandlers & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const handlers = useRef({ onStart, onMove, onEnd });
  handlers.current = { onStart, onMove, onEnd };
  const accepted = useRef(false);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(enabled)
        .minDistance(10)
        .onStart((event) => {
          const axis: DragAxis = Math.abs(event.translationX) > Math.abs(event.translationY) ? "x" : "y";
          accepted.current = handlers.current.onStart?.(axis, true) !== false;
        })
        .onUpdate((event) => {
          if (accepted.current) handlers.current.onMove(event.translationX, event.translationY);
        })
        .onEnd((event) => {
          if (accepted.current) handlers.current.onEnd(event.translationX, event.translationY, event.velocityX, event.velocityY);
          accepted.current = false;
        }),
    [enabled],
  );
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
```

### Create `apps/app/src/components/kit/DragArea.web.tsx`

```tsx
import { useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { DragAxis, DragHandlers } from "./DragArea";

/**
 * A drag on the web (UI design, sections 5.1 and 5.2), on the browser's own pointer events. react-native-gesture-handler
 * draws its gestures on the web through the package's index, which would put the whole package into the web bundle (about
 * 55 KB gzip, more than the budget has left; GestureRoot.web.tsx says the same of its root view), so the web does this
 * small part of it itself: a drag starts after 10 px of movement, takes the axis it started along, captures the pointer
 * so it keeps following outside the element, and ends with the release velocity measured over the last 80 ms, in px per
 * second. DragArea.tsx is gesture-handler's Pan on iOS and Android, with the same handlers.
 */
interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  touch: boolean;
  axis: DragAxis | null;
  samples: Sample[];
}

/** The pointer event as react-native-web hands it on: the DOM's own. */
type Pointer = PointerEvent & { currentTarget: Element };

/** The distance a pointer moves before it is a drag, so a tap or a small tremor never starts one. */
const SLOP = 10;
/** How far back the release velocity looks. */
const WINDOW_MS = 80;

/** The release velocity in px per second, from the samples within the last WINDOW_MS. */
export function releaseVelocity(samples: readonly Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  const first = samples.find((sample) => last.t - sample.t <= WINDOW_MS) ?? last;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export function DragArea({ children, style, enabled = true, onStart, onMove, onEnd }: DragHandlers & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const drag = useRef<Drag | null>(null);
  const handlers = useRef({ onStart, onMove, onEnd });
  handlers.current = { onStart, onMove, onEnd };

  const down = (event: Pointer) => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, touch: event.pointerType !== "mouse", axis: null, samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }] };
  };
  const move = (event: Pointer) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const dx = event.clientX - current.x0;
    const dy = event.clientY - current.y0;
    if (current.axis === null) {
      if (Math.hypot(dx, dy) < SLOP) return;
      const axis: DragAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      // The owner may decline an axis (a sheet drags only down and up; the lightbox pages only on touch).
      if (handlers.current.onStart?.(axis, current.touch) === false) {
        drag.current = null;
        return;
      }
      current.axis = axis;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that has already gone cannot be captured; the drag still ends on its pointerup.
      }
    }
    current.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (current.samples.length > 12) current.samples.shift();
    event.preventDefault();
    handlers.current.onMove(dx, dy);
  };
  const up = (event: Pointer) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    drag.current = null;
    if (current.axis === null) return;
    current.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    const { vx, vy } = event.type === "pointercancel" ? { vx: 0, vy: 0 } : releaseVelocity(current.samples);
    handlers.current.onEnd(event.clientX - current.x0, event.clientY - current.y0, vx, vy);
  };

  // react-native-web hands these DOM props to the element as they are; React Native's types do not list them. The
  // browser's own panning is off inside, so a touch drag moves the element and not the page.
  const pointer = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } as object;
  return (
    <View {...pointer} style={[style, { touchAction: "none" } as unknown as ViewStyle]}>
      {children}
    </View>
  );
}
```

### Create `apps/app/src/components/kit/Menu.tsx`

```tsx
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { Icon } from "./Icon";
import { IconButton, type IconButtonProps } from "./IconButton";
import { FOCUS_RING_INSET, HOVER_WASH, dataAttribute, lastInputWasKeyboard, pressDelay } from "./interaction";
import { measureNode, type Rect } from "./measure";
import { Sheet, SheetFrame, type SheetLayout } from "./Sheet";
import { Text } from "./Text";

/**
 * A menu (UI design, section 6.9): a disclosure, not an ARIA menu. Its trigger is an IconButton that says it opens a menu
 * and whether it is open; its content is a list of buttons and real links, so a link stays an anchor and Tab moves
 * through them, and on the web the arrow keys move between them too. Below 768 px the content is a Sheet titled by the
 * trigger's label; from 768 px a popover of surface-1 under its trigger, flipped to stay inside the window, growing from
 * the trigger's corner (scale 0.97 to 1 and opacity, 160 ms in, 120 ms out; reduced or opened from the keyboard, opacity
 * only). Escape and a press outside close it, and the focus goes back to the trigger. An item's action runs once the menu
 * has closed and given the focus back, so an item that opens a sheet or asks a question takes the focus from there.
 */
export type MenuItem = {
  /** The item's name and its visible words. */
  label: string;
  icon: IconName;
  /** danger for Delete. */
  tone?: "danger";
  /** One line under the label (Who sees this). */
  description?: string;
} & ({ onSelect: () => void; href?: undefined } | { href: Href; onSelect?: undefined });

/**
 * Where the arrow keys move the focus among `count` items from `current` (-1 when none holds it): down and up wrap, Home
 * and End jump; any other key moves nothing (null).
 */
export function menuIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export interface Placement {
  left: number;
  top: number;
  /** The corner it grows from, as a CSS transform-origin: the trigger's side of it. */
  origin: "top right" | "top left" | "bottom right" | "bottom left";
}

/** The space kept between the popover and its trigger, and between it and the window's edges, in px. */
const GAP = 4;
const MARGIN = 8;

/**
 * Where the popover goes: under its trigger with its right edge at the trigger's (the post's More sits at the end of its
 * row); from the trigger's left edge when that would leave the window; above the trigger when there is no room under it;
 * and never past the window's edges.
 */
export function placeMenu(trigger: Rect, panel: { width: number; height: number }, window: { width: number; height: number }): Placement {
  let left = trigger.x + trigger.width - panel.width;
  let horizontal: "left" | "right" = "right";
  if (left < MARGIN) {
    left = trigger.x;
    horizontal = "left";
  }
  left = Math.max(MARGIN, Math.min(left, window.width - MARGIN - panel.width));
  let top = trigger.y + trigger.height + GAP;
  let vertical: "top" | "bottom" = "top";
  if (top + panel.height > window.height - MARGIN) {
    const above = trigger.y - GAP - panel.height;
    if (above >= MARGIN) {
      top = above;
      vertical = "bottom";
    }
  }
  top = Math.max(MARGIN, Math.min(top, window.height - MARGIN - panel.height));
  return { left, top, origin: `${vertical} ${horizontal}` };
}

/** One item: a button, or a real link for an item with an href; 48 px tall at least, the hover and pressed wash, the ring inside. */
function MenuRow({ item, onPick, popover }: { item: MenuItem; onPick: (item: MenuItem) => void; popover: boolean }) {
  const danger = item.tone === "danger";
  const row = cn("min-h-[48px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface-2", popover ? "rounded-control" : "", HOVER_WASH, FOCUS_RING_INSET);
  const body = (
    <>
      <Icon name={item.icon} size={20} tone={danger ? "danger" : "medium"} />
      <View className="min-w-0 flex-1">
        <Text variant="body-strong" tone={danger ? "danger" : "high"}>
          {item.label}
        </Text>
        {item.description ? (
          <Text variant="meta" tone="low">
            {item.description}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (item.href !== undefined) {
    return (
      <Link href={item.href} onPress={() => onPick(item)} asChild>
        <Pressable {...dataAttribute("menuItem")} {...pressDelay(0)} className={row}>
          {body}
        </Pressable>
      </Link>
    );
  }
  return (
    <Pressable accessibilityRole="button" {...dataAttribute("menuItem")} {...pressDelay(0)} onPress={() => onPick(item)} className={row}>
      {body}
    </Pressable>
  );
}

/** The items in order, with the arrow keys on the web. */
function MenuList({ items, onPick, popover }: { items: readonly MenuItem[]; onPick: (item: MenuItem) => void; popover: boolean }) {
  const list = useRef<View>(null);
  const keys = (event: KeyboardEvent) => {
    const node = list.current as unknown as HTMLElement | null;
    if (!node) return;
    const rows = [...node.querySelectorAll<HTMLElement>("[data-menu-item]")];
    const next = menuIndex(rows.indexOf(document.activeElement as HTMLElement), event.key, rows.length);
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  };
  return (
    <View ref={list} {...(Platform.OS === "web" ? ({ onKeyDown: keys } as object) : {})} className={popover ? "gap-0.5" : ""}>
      {items.map((item) => (
        <MenuRow key={item.label} item={item} onPick={onPick} popover={popover} />
      ))}
    </View>
  );
}

/**
 * The menu drawn open, as the render tests draw it: on a phone the sheet's frame titled by the trigger's label, wider the
 * popover's panel named by it.
 */
export function MenuPanel({ label, items, layout, onPick }: { label: string; items: readonly MenuItem[]; layout: SheetLayout; onPick: (item: MenuItem) => void }) {
  if (layout === "phone") {
    return (
      <SheetFrame titleId="menu-title" title={label} layout="phone" onClose={() => undefined}>
        <MenuList items={items} onPick={onPick} popover={false} />
      </SheetFrame>
    );
  }
  return <PopoverPanel label={label} items={items} onPick={onPick} />;
}

function PopoverPanel({ label, items, onPick }: { label: string; items: readonly MenuItem[]; onPick: (item: MenuItem) => void }) {
  return (
    <View {...dataAttribute("menu")} role="group" aria-label={label} className="w-[280px] rounded-card border border-line-high bg-surface-1 p-1.5 web:forced-colors:border-[color:CanvasText]">
      <MenuList items={items} onPick={onPick} popover />
    </View>
  );
}

/** The popover from 768 px: in a Modal, above everything, with a layer under it that closes it on a press outside. */
function Popover({ open, close, closed, trigger, label, items, onPick }: { open: boolean; close: () => void; closed: () => void; trigger: RefObject<View | null>; label: string; items: readonly MenuItem[]; onPick: (item: MenuItem) => void }) {
  const motion = useMotion();
  const screen = useWindowDimensions();
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const [place, setPlace] = useState<Placement | null>(null);
  const rect = useRef<Rect | null>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const panel = useRef<View>(null);
  const fade = useSharedValue(0);
  const scale = useSharedValue(0.97);
  const still = useSharedValue(0);

  const hide = () => {
    // The panel leaves with the Modal, so its size is measured again on the next opening.
    size.current = null;
    setShown(false);
  };
  const position = () => {
    if (rect.current && size.current) setPlace(placeMenu(rect.current, size.current, screen));
  };

  useEffect(() => {
    if (open) {
      still.value = motion.reduced || lastInputWasKeyboard() ? 1 : 0;
      fade.value = 0;
      scale.value = still.value === 1 ? 1 : 0.97;
      setPlace(null);
      measureNode(trigger.current, (found) => {
        rect.current = found;
        position();
      });
    } else if (shown) {
      // It shrinks back into the trigger it grew from, along the same path.
      const done = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(hide)();
      };
      if (still.value === 0) scale.value = withTiming(0.97, motion.timing("easeOut", 120));
      fade.value = withTiming(0, motion.timing("easeOut", 120), done);
    }
  }, [open]);

  // Placed: it grows in, and the first item takes the focus.
  useEffect(() => {
    if (!open || place === null) return;
    fade.value = withTiming(1, motion.timing("easeOut", 160));
    if (still.value === 0) scale.value = withTiming(1, motion.timing("easeOut", 160));
    if (Platform.OS !== "web") return;
    const frame = requestAnimationFrame(() => (panel.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>("[data-menu-item]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [place]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    size.current = { width, height };
    position();
  };
  const style = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: scale.value }] }));

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={close} onDismiss={closed} aria-label={label}>
      <View style={StyleSheet.absoluteFill}>
        {Platform.OS === "web" ? (
          <View aria-hidden {...({ onClick: close } as object)} style={StyleSheet.absoluteFill} />
        ) : (
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={close} style={StyleSheet.absoluteFill} />
        )}
        {/* Unplaced, it is laid out where it cannot be seen, so its size is known before it shows. */}
        <Animated.View style={[{ position: "absolute", left: place?.left ?? 0, top: place?.top ?? -10000, transformOrigin: place?.origin ?? "top right" }, style]}>
          <View ref={panel} onLayout={onLayout}>
            <PopoverPanel label={label} items={items} onPick={onPick} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface MenuProps {
  /** The trigger's name, and the sheet's title on a phone unless `title` says otherwise. */
  label: string;
  icon: IconName;
  items: readonly MenuItem[];
  title?: string;
  /** The trigger's other looks and states (a count, pressed, the reposted disc, its feedback). */
  trigger?: Omit<IconButtonProps, "icon" | "label" | "onPress" | "hasPopup" | "expanded" | "ref">;
  /** The trigger's ref, for an owner that moves the focus to it (the post's delete question gives it back to More). */
  triggerRef?: RefObject<View | null>;
  /** Called as the menu opens; answer false to open nothing (a reader sent to sign in instead). */
  onOpen?: () => boolean | void;
}

export function Menu({ label, icon, items, title, trigger: triggerLook, triggerRef, onOpen }: MenuProps) {
  const layout: SheetLayout = useLayout() === "phone" ? "phone" : "wide";
  const own = useRef<View>(null);
  const trigger = triggerRef ?? own;
  const [open, setOpen] = useState(false);
  // Mounted from the press until it has closed: react-native-web's Modal adds an element to the page as it mounts, so a
  // list of cards keeps none for the menus nobody opened.
  const [mounted, setMounted] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const close = () => setOpen(false);
  const pick = (item: MenuItem) => {
    pending.current = item.onSelect ?? null;
    setOpen(false);
  };
  // Closed: the focus goes back to the trigger, then the chosen item acts, and may take the focus from there.
  const closed = () => {
    setMounted(false);
    trigger.current?.focus();
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const press = () => {
    if (onOpen?.() === false) return;
    setMounted(true);
    setOpen(true);
  };

  let content: ReactNode = null;
  if (mounted && layout === "phone") {
    content = (
      <Sheet open={open} onClose={close} onClosed={closed} title={title ?? label} initialFocus="first">
        <MenuList items={items} onPick={pick} popover={false} />
      </Sheet>
    );
  } else if (mounted) {
    content = <Popover open={open} close={close} closed={closed} trigger={trigger} label={title ?? label} items={items} onPick={pick} />;
  }
  return (
    <>
      <IconButton {...triggerLook} ref={trigger} icon={icon} label={label} hasPopup="menu" expanded={open} onPress={press} />
      {content}
    </>
  );
}
```

### Create `apps/app/src/components/kit/Sheet.tsx`

```tsx
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { useHaptics } from "@/lib/haptics";
import { releaseCloses, rubberBand, useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { FIXED_COLOURS } from "@/theme/tokens";
import { DragArea, type DragHandlers } from "./DragArea";
import { FOCUS_RING, dataAttribute, lastInputWasKeyboard } from "./interaction";
import { Text } from "./Text";

/**
 * A sheet (UI design, sections 5.2 and 6.8): below 768 px a bottom sheet with a grab handle, which comes up from the
 * bottom, follows the finger down and rubber-bands up, and closes on a release whose momentum carries it past half its
 * height; from 768 px the same content as a centred dialog, 560 px wide, that grows from 0.96. Under reduced motion, and
 * when opened from the keyboard, it fades in 150 ms and moves not at all. The first users are the post's menus and Who
 * sees this; the composer moves onto it in Task 6.
 *
 * React Native's Modal holds it. On the web react-native-web draws the Modal's content as the dialog itself (role
 * "dialog", aria-modal), traps the focus inside, closes on Escape through onRequestClose and gives the focus back to the
 * element that had it when the Modal opened; the Sheet hands it the title's id for its name, moves the focus to the
 * title (or a menu's first item) once it is open, and puts a scrim behind it that closes it on a press but is no tab stop.
 * The Modal renders nothing on a server, so SheetFrame, what it holds, is exported for the render tests to draw open.
 */
export type SheetLayout = "phone" | "wide";

/** A fixed colour of tokens.ts as CSS, for the scrim and the lightbox's stage, which every theme shares. */
export function fixedColour(name: keyof typeof FIXED_COLOURS): string {
  const [r, g, b, a] = FIXED_COLOURS[name];
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Where a sheet waits before its height is known: below any screen. */
const OFFSCREEN = 4000;

export interface SheetFrameProps {
  titleId: string;
  title: string;
  description?: string;
  layout: SheetLayout;
  /** tall takes up to 90 percent of the window's height on a phone; auto, what its content needs, up to 85. */
  size?: "auto" | "tall";
  /** The dialog's width from 768 px (560; the composer, 640). */
  width?: number;
  /** A press on the scrim. */
  onClose: () => void;
  children: ReactNode;
  /** The motion and the drag, which Sheet gives; a render test draws the frame without them, open and still. */
  panelStyle?: object;
  scrimStyle?: object;
  drag?: DragHandlers;
  titleRef?: RefObject<View | null>;
  panelRef?: RefObject<View | null>;
  onPanelLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * What the Modal holds: the panel first, then the scrim, which sits behind it. The order matters on the web, where
 * react-native-web's focus trap gives the focus to the first element in it that takes one; the scrim takes none.
 */
export function SheetFrame({ titleId, title, description, layout, size = "auto", width = 560, onClose, children, panelStyle, scrimStyle, drag, titleRef, panelRef, onPanelLayout }: SheetFrameProps) {
  const phone = layout === "phone";
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const maxHeight = screen.height > 0 ? Math.round(screen.height * (phone && size === "tall" ? 0.9 : 0.85)) : undefined;
  const header = (
    // A phone's sheet has its handle above the title; a dialog's title keeps clear of its 24 px corners instead.
    <View className={phone ? "px-5 pb-3 pt-2" : "px-5 pb-3 pt-5"}>
      {phone ? <View {...dataAttribute("handle")} aria-hidden className="mb-3 h-1 w-9 self-center rounded-full bg-line-high" /> : null}
      {/* The title takes the focus when the sheet opens, so a screen reader starts at its name; it is no tab stop. */}
      <View ref={titleRef} tabIndex={-1} className={cn("self-start rounded-control", FOCUS_RING)}>
        <Text as="h2" variant="title" nativeID={titleId}>
          {title}
        </Text>
      </View>
      {description ? (
        <Text tone="medium" className="mt-1">
          {description}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={StyleSheet.absoluteFill} className={phone ? "justify-end" : "items-center justify-center px-4"}>
      <Animated.View style={[{ zIndex: 1, width: phone ? "100%" : Math.min(width, Math.max(0, screen.width - 32) || width) }, panelStyle]}>
        <View
          ref={panelRef}
          onLayout={onPanelLayout}
          className={cn("overflow-hidden border border-line-high bg-surface-1 web:forced-colors:border-[color:CanvasText]", phone ? "rounded-t-sheet border-b-0" : "rounded-sheet")}
          style={{ maxHeight, paddingBottom: phone ? 12 + insets.bottom : 12 }}
        >
          {phone && drag ? <DragArea {...drag}>{header}</DragArea> : header}
          <ScrollView bounces={false}>{children}</ScrollView>
        </View>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 0, backgroundColor: fixedColour("scrim") }, scrimStyle]}>
        {Platform.OS === "web" ? (
          // A plain element with a click: no role, no tab stop, hidden, so neither the keyboard nor a screen reader meets it.
          <View {...dataAttribute("scrim")} aria-hidden {...({ onClick: onClose } as object)} style={StyleSheet.absoluteFill} />
        ) : (
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={onClose} style={StyleSheet.absoluteFill} />
        )}
      </Animated.View>
    </View>
  );
}

export interface SheetProps {
  open: boolean;
  /** The reader asks to close: the scrim, Escape, a drag past the threshold. */
  onClose: () => void;
  /** The sheet has left the screen and the focus is back with its opener: a menu runs the item chosen from it now. */
  onClosed?: () => void;
  title: string;
  description?: string;
  /** false keeps it open on the scrim, Escape and a drag (a sheet with its own question first). */
  dismissible?: boolean;
  size?: "auto" | "tall";
  width?: number;
  /** What takes the focus on opening: the title (default), or the first control, as a menu's first item. */
  initialFocus?: "title" | "first";
  children: ReactNode;
}

/** The focusable elements of a menu or a form, in order, for the "first" focus. */
const FOCUSABLE = '[data-menu-item], a[href], button, input, textarea, [tabindex="0"]';

export function Sheet({ open, onClose, onClosed, title, description, dismissible = true, size = "auto", width = 560, initialFocus = "title", children }: SheetProps) {
  const layout: SheetLayout = useLayout() === "phone" ? "phone" : "wide";
  const motion = useMotion();
  const haptic = useHaptics();
  const titleId = useId();
  const [shown, setShown] = useState(open);
  // Opening shows the Modal in the same render; closing waits for the motion to end.
  if (open && !shown) setShown(true);

  const titleRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const height = useRef(0);
  const laidOut = useRef(false);
  const releaseVelocity = useRef(0);
  const openNow = useRef(open);
  openNow.current = open;
  const closedHandler = useRef(onClosed);
  closedHandler.current = onClosed;

  const y = useSharedValue(0);
  const fade = useSharedValue(0);
  const scale = useSharedValue(1);
  // 1 when this opening takes the reduced form (a fade): read inside the animated style, where a ref cannot be.
  const still = useSharedValue(0);
  const phone = layout === "phone";

  const hide = () => {
    laidOut.current = false;
    setShown(false);
  };

  const enter = () => {
    if (still.value === 1) {
      y.value = 0;
      scale.value = 1;
      fade.value = withTiming(1, motion.timing("fade"));
      return;
    }
    fade.value = withTiming(1, motion.timing("easeOut", 200));
    if (phone) y.value = withSpring(0, motion.spring("springSnap"));
    else scale.value = withTiming(1, motion.timing("easeOut", 200));
  };

  const leave = () => {
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(hide)();
    };
    if (still.value === 1) {
      fade.value = withTiming(0, motion.timing("fade"), done);
    } else if (phone) {
      // Down and out along the path it came, carrying a released drag's velocity.
      fade.value = withTiming(0, motion.timing("easeOut", 150));
      y.value = withSpring(height.current || OFFSCREEN, motion.spring("springRelease", releaseVelocity.current), done);
    } else {
      scale.value = withTiming(0.96, motion.timing("easeOut", 150));
      fade.value = withTiming(0, motion.timing("easeOut", 150), done);
    }
    releaseVelocity.current = 0;
  };

  // Each opening decides its form once: under reduced motion, or opened from the keyboard, it fades; otherwise it moves.
  // Opened again while it is still leaving, it turns back from where it is.
  useEffect(() => {
    if (open) {
      still.value = motion.reduced || lastInputWasKeyboard() ? 1 : 0;
      if (laidOut.current) {
        enter();
        return;
      }
      fade.value = 0;
      scale.value = still.value === 1 ? 1 : 0.96;
      y.value = still.value === 1 || !phone ? 0 : OFFSCREEN;
    } else if (laidOut.current) {
      leave();
    } else if (shown) {
      hide();
    }
    // The motion's inputs are read when the reader opens or closes, not followed while it is open.
  }, [open]);

  // iOS and Android: the Modal's onDismiss is iOS's alone, so the closed callback follows the Modal's hiding here.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (Platform.OS !== "web" && wasShown.current && !shown) closedHandler.current?.();
    wasShown.current = shown;
  }, [shown]);

  const focusTitle = () => {
    if (Platform.OS !== "web") return;
    const panel = panelRef.current as unknown as HTMLElement | null;
    const first = initialFocus === "first" ? panel?.querySelector<HTMLElement>(FOCUSABLE) : null;
    (first ?? (titleRef.current as unknown as HTMLElement | null))?.focus();
  };

  const onPanelLayout = (event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    if (laidOut.current) return;
    laidOut.current = true;
    if (!openNow.current) return;
    if (phone && still.value === 0) y.value = height.current;
    enter();
    // After react-native-web's focus trap has taken the focus into the Modal, the title (or the first item) takes it.
    if (Platform.OS === "web") requestAnimationFrame(focusTitle);
  };

  const dismiss = () => {
    if (dismissible) onClose();
  };

  const base = useRef(0);
  const past = useRef(false);
  const settle = (velocity: number) => {
    y.value = still.value === 1 ? withTiming(0, motion.timing("fade")) : withSpring(0, motion.spring("springRelease", velocity));
  };
  const drag: DragHandlers = {
    enabled: dismissible,
    onStart: (axis) => {
      if (axis !== "y") return false;
      // Grabbing it mid-flight takes it from where it is.
      cancelAnimation(y);
      base.current = y.value;
      past.current = false;
      return true;
    },
    onMove: (_dx, dy) => {
      const size = height.current || 1;
      const next = base.current + dy;
      // Down it follows the finger 1:1; up it resists more the further it is pulled.
      y.value = next < 0 ? -rubberBand(-next, size) : next;
      const over = next > size / 2;
      if (over !== past.current) {
        past.current = over;
        if (over) haptic("threshold");
      }
    },
    onEnd: (_dx, _dy, _vx, vy) => {
      if (releaseCloses(y.value, vy, height.current)) {
        releaseVelocity.current = vy;
        dismiss();
        // An owner that keeps it open (it asks a question first) gets it back in place.
        requestAnimationFrame(() => {
          if (openNow.current) settle(0);
        });
      } else {
        settle(vy);
      }
    },
  };

  const panelStyle = useAnimatedStyle(() =>
    phone ? { transform: [{ translateY: y.value }], opacity: still.value === 1 ? fade.value : 1 } : { transform: [{ scale: scale.value }], opacity: fade.value },
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  // On the web the Modal calls onDismiss once its content has left and its focus trap has handed the focus back.
  const closed = () => closedHandler.current?.();

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={dismiss} onDismiss={closed} aria-labelledby={titleId}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SheetFrame
          titleId={titleId}
          title={title}
          description={description}
          layout={layout}
          size={size}
          width={width}
          onClose={dismiss}
          panelStyle={panelStyle}
          scrimStyle={scrimStyle}
          drag={dismissible ? drag : undefined}
          titleRef={titleRef}
          panelRef={panelRef}
          onPanelLayout={onPanelLayout}
        >
          {children}
        </SheetFrame>
      </GestureHandlerRootView>
    </Modal>
  );
}
```

### Create `apps/app/src/components/kit/measure.ts`

```ts
import { Platform, type View } from "react-native";

/** A box in the window's coordinates, in px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an element is in the window (UI design, sections 5.2 and 6.9): a menu's trigger, which its popover sits under,
 * and an image's cell, which the lightbox grows from and returns into. The DOM's own box on the web, measureInWindow on
 * iOS and Android. Nothing is measured for an element that is gone.
 */
export function measureNode(node: View | null | undefined, done: (rect: Rect) => void): void {
  if (!node) return;
  const element = node as unknown as { getBoundingClientRect?: () => DOMRect };
  if (Platform.OS === "web" && typeof element.getBoundingClientRect === "function") {
    const box = element.getBoundingClientRect();
    done({ x: box.left, y: box.top, width: box.width, height: box.height });
    return;
  }
  node.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
}
```

### Create `apps/app/src/components/social/PostMenu.tsx`

```tsx
import { useState, type RefObject } from "react";
import { Platform, type View } from "react-native";
import type { MeResponse, PostView } from "@korbat/contracts";
import { Menu, MenuPanel, type MenuItem } from "@/components/kit/Menu";
import { toast } from "@/components/toast";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { useLayout } from "@/theme/layout";
import { WhoSeesThis } from "./WhoSeesThis";

/**
 * A post's More menu (UI design, section 6.6 and decision 12): Who sees this, with its one-line summary; Copy link, on the
 * web, which says "Link copied"; Delete for the post's author, in danger; and Report for everyone else, signed in or out,
 * as a link to the report form, since the form is a page of its own. Report left the visible row for this menu.
 */
export function postMenuItems(post: PostView, me: MeResponse | null, handlers: { onDelete: () => void; onWhoSees: () => void }): MenuItem[] {
  const own = me !== null && post.author.id === me.user.id;
  const items: MenuItem[] = [{ label: UI_WORDS["post.whoSees"], icon: "who-sees", description: reach(post, me).summary, onSelect: handlers.onWhoSees }];
  // Native shares through the system's sheet, which sub-project 5 brings; a link to copy is the web's.
  if (Platform.OS === "web") items.push({ label: UI_WORDS["post.copyLink"], icon: "copy-link", onSelect: () => void copyLink(post.id) });
  if (own) items.push({ label: UI_WORDS["post.delete"], icon: "delete", tone: "danger", onSelect: handlers.onDelete });
  else items.push({ label: REPORT_WORDS.control, icon: "report", href: reportHref({ post: post.id }) });
  return items;
}

/** The post's address on this site, on the clipboard; a browser that refuses the clipboard is told nothing went there. */
async function copyLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/post/${id}`);
    toast.show({ message: UI_WORDS["toast.linkCopied"] });
  } catch {
    // Without the clipboard there is nothing to confirm; the post's own link is still in the card.
  }
}

/** The menu drawn open, for the render tests: the items a reader gets for this post. */
export function PostMenuPanel({ post, onDelete, onWhoSees }: { post: PostView; onDelete: () => void; onWhoSees: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const layout = useLayout() === "phone" ? "phone" : "wide";
  return <MenuPanel label={UI_WORDS["post.more"]} items={postMenuItems(post, me, { onDelete, onWhoSees })} layout={layout} onPick={() => undefined} />;
}

/**
 * The More button and what it opens. `triggerRef` is the card's, which the delete question gives the focus back to when
 * it is withdrawn; Who sees this opens once the menu has closed, so its sheet hands the focus back to More too.
 */
export function PostMenu({ post, onDelete, triggerRef }: { post: PostView; onDelete: () => void; triggerRef: RefObject<View | null> }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  // Who sees this is mounted while it is open or leaving, as the menus are (kit/Menu.tsx says why).
  const [seeing, setSeeing] = useState({ mounted: false, open: false });
  return (
    <>
      <Menu label={UI_WORDS["post.more"]} icon="more" items={postMenuItems(post, me, { onDelete, onWhoSees: () => setSeeing({ mounted: true, open: true }) })} triggerRef={triggerRef} />
      {seeing.mounted ? (
        <WhoSeesThis post={post} open={seeing.open} onClose={() => setSeeing({ mounted: true, open: false })} onClosed={() => setSeeing({ mounted: false, open: false })} />
      ) : null}
    </>
  );
}
```

### Create `apps/app/src/components/social/WhoSeesThis.tsx`

```tsx
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { ExploreStatusKind, MeResponse, PostView } from "@korbat/contracts";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Text } from "@/components/kit/Text";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * Who sees this (UI design, section 6.14): the sheet a post's More menu opens, for every post, with reach()'s sentences
 * and their links. The first sentence says who can read the post, in ink-high; the rest say how, in ink-medium.
 */
export function WhoSeesThisBody({ post, me, explore }: { post: PostView; me: MeResponse | null; explore: ExploreStatusKind | null }) {
  const found = reach(post, me, explore);
  return (
    <View className="gap-3 px-5 pb-3">
      {found.lines.map((line, index) => (
        <View key={line.text} className="gap-0.5">
          <Text tone={index === 0 ? "high" : "medium"}>{line.text}</Text>
          {line.link ? (
            <Link href={line.link.href} asChild>
              <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
                <Text tone="accent" className="underline decoration-1 underline-offset-2">
                  {line.link.label}
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The sheet itself. For the reader's own visible top-level post, when neither the post nor /me already decides its
 * Explore line, it asks GET /api/posts/:id/explore each time it opens and words the answer as the status line under the
 * post does (2c design, section 8). The answer stays in this component's state, as 2c's rule wants every answer about
 * Explore kept: never stored, never cached.
 */
export function WhoSeesThis({ post, open, onClose, onClosed }: { post: PostView; open: boolean; onClose: () => void; onClosed?: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const asks = reach(post, me).asksExplore;
  const [answer, setAnswer] = useState<{ id: string; status: ExploreStatusKind | null } | null>(null);

  useEffect(() => {
    if (!open || !asks) return;
    let current = true;
    social.exploreStatus(post.id).then(
      (found) => {
        if (current) setAnswer({ id: post.id, status: found.status });
      },
      // Unanswered, the sheet leaves the Explore line out rather than guess it.
      () => {
        if (current) setAnswer({ id: post.id, status: null });
      },
    );
    return () => {
      current = false;
    };
  }, [open, asks, post.id]);

  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title={UI_WORDS["post.whoSees"]}>
      <WhoSeesThisBody post={post} me={me} explore={answer?.id === post.id ? answer.status : null} />
    </Sheet>
  );
}
```

### Create `apps/app/src/lib/post-actions.ts`

```ts
import type { EngagementResponse, FollowResponse, PostCounts, PostView, ViewerPostState } from "@korbat/contracts";
import { laneKey, type EngagementKind, type Lanes } from "./social";
import { UI_WORDS, fill, type UiWord } from "./ui-words";

/**
 * What the post's actions do to the card, as pure functions (UI design, sections 6.6 and 8.4): the optimistic change of a
 * toggle, the server's answer replacing the counts, the rollback of a refusal, the names and counts the buttons show, the
 * stats line of a thread's focused post, the rollback toasts' words, and the follow button's toggle. PostCard and
 * FollowButton call them with the app's social client and lanes; the tests call them with fakes, since a static render
 * cannot press.
 */
export type ToggleKind = EngagementKind;

const FLAG: Record<ToggleKind, keyof ViewerPostState> = { like: "liked", repost: "reposted", bookmark: "bookmarked" };
/** The count a toggle moves; Save has none. */
const COUNT: Partial<Record<ToggleKind, "likes" | "reposts">> = { like: "likes", repost: "reposts" };
const NO_VIEWER: ViewerPostState = { liked: false, reposted: false, bookmarked: false };

export function isOn(post: PostView, kind: ToggleKind): boolean {
  return (post.viewer ?? NO_VIEWER)[FLAG[kind]];
}

/** The post with one toggle set to `on`, its count moved by one, never below zero; the post itself when it already is. */
export function turned(post: PostView, kind: ToggleKind, on: boolean): PostView {
  const viewer = post.viewer ?? NO_VIEWER;
  if (viewer[FLAG[kind]] === on) return post;
  const key = COUNT[kind];
  const counts = key === undefined ? post.counts : { ...post.counts, [key]: Math.max(0, post.counts[key] + (on ? 1 : -1)) };
  return { ...post, viewer: { ...viewer, [FLAG[kind]]: on }, counts };
}

/** The optimistic change of a press: the toggle the other way, at once. */
export function flipped(post: PostView, kind: ToggleKind): PostView {
  return turned(post, kind, !isOn(post, kind));
}

/**
 * The server's answer: its counts replace the card's, so they never drift, and its state of this kind is the truth. The
 * other kinds keep the card's own state, since their requests may still be out and their answers will say.
 */
export function settled(current: PostView, kind: ToggleKind, answer: EngagementResponse): PostView {
  return { ...current, counts: answer.counts, viewer: { ...(current.viewer ?? NO_VIEWER), [FLAG[kind]]: answer.viewer[FLAG[kind]] } };
}

/** A refusal: this kind's state and count as they were before the press; anything else that changed meanwhile stays. */
export function restored(current: PostView, before: PostView, kind: ToggleKind): PostView {
  const key = COUNT[kind];
  const counts = key === undefined ? current.counts : { ...current.counts, [key]: before.counts[key] };
  return { ...current, counts, viewer: { ...(current.viewer ?? NO_VIEWER), [FLAG[kind]]: isOn(before, kind) } };
}

export type ToggleResult = { status: "busy" } | { status: "answered"; on: boolean } | { status: "refused"; on: boolean; error: unknown };

/**
 * One press of Like, Repost or Save: nothing while that kind's request is still out; otherwise `onStart` (the haptic and
 * the motion, before the change, so sight and touch land together), the change at once, the request in its lane, then
 * the answer's counts, or the rollback.
 */
export async function toggleEngagement(
  client: { engage: (id: string, kind: ToggleKind, on: boolean) => Promise<EngagementResponse> },
  lanes: Lanes,
  post: PostView,
  kind: ToggleKind,
  apply: (update: (current: PostView) => PostView) => void,
  onStart?: (on: boolean) => void,
): Promise<ToggleResult> {
  const key = laneKey.post(post.id, kind);
  if (lanes.busy(key)) return { status: "busy" };
  const on = !isOn(post, kind);
  onStart?.(on);
  apply((current) => turned(current, kind, on));
  const outcome = await lanes.run(key, () => client.engage(post.id, kind, on));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "answered") {
    apply((current) => settled(current, kind, outcome.answer));
    return { status: "answered", on };
  }
  apply((current) => restored(current, post, kind));
  return { status: "refused", on, error: outcome.error };
}

export type FollowResult = { status: "busy" } | { status: "answered"; answer: FollowResponse } | { status: "refused"; on: boolean; error: unknown };

/** Follow or unfollow, the same way: the label at once, the answer's state after, the old state back on a refusal. */
export async function toggleFollow(
  client: { setFollow: (handle: string, on: boolean) => Promise<FollowResponse> },
  lanes: Lanes,
  handle: string,
  following: boolean,
  apply: (following: boolean) => void,
): Promise<FollowResult> {
  const key = laneKey.follow(handle);
  if (lanes.busy(key)) return { status: "busy" };
  const on = !following;
  apply(on);
  const outcome = await lanes.run(key, () => client.setFollow(handle, on));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "answered") {
    apply(outcome.answer.following);
    return outcome;
  }
  apply(following);
  return { status: "refused", on, error: outcome.error };
}

export type DeleteResult = { status: "busy" } | { status: "deleted" } | { status: "refused"; error: unknown };

/**
 * Delete: the request in the post's delete lane; once the server has answered, the card leaves (`leave`, the
 * post-removed fade), and only then is the post deleted for its list. A refusal leaves the card where it is.
 */
export async function deleteWithLeave(client: { deletePost: (id: string) => Promise<unknown> }, lanes: Lanes, id: string, leave: () => Promise<void>): Promise<DeleteResult> {
  const outcome = await lanes.run(laneKey.post(id, "delete"), () => client.deletePost(id));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "refused") return { status: "refused", error: outcome.error };
  await leave();
  return { status: "deleted" };
}

type Counted = "reply" | "like" | "repost";

const COUNT_WORDS: Record<Counted, { many: UiWord; one: UiWord; none: UiWord }> = {
  reply: { many: "post.reply", one: "post.reply.one", none: "post.reply.none" },
  like: { many: "post.like", one: "post.like.one", none: "post.like.none" },
  repost: { many: "post.reposts", one: "post.reposts.one", none: "post.reposts.none" },
};

/** Whether the reader's setting hides this kind's count (decision 15: likes and reposts; replies lead to conversation). */
const hides = (kind: Counted, hideCounts: boolean): boolean => hideCounts && kind !== "reply";

/** A button's name with its count: "Like, 12 likes", "Like, 1 like", and "Like" at zero or when the count is hidden. */
export function countLabel(kind: Counted, count: number, hideCounts: boolean): string {
  const words = COUNT_WORDS[kind];
  if (count <= 0 || hides(kind, hideCounts)) return UI_WORDS[words.none];
  if (count === 1) return UI_WORDS[words.one];
  return fill(UI_WORDS[words.many], { n: count });
}

/** The number a button shows beside its icon, or nothing at zero or when the count is hidden. */
export function shownCount(kind: Counted, count: number, hideCounts: boolean): number | undefined {
  return count > 0 && !hides(kind, hideCounts) ? count : undefined;
}

/** The thread's stats line (8.3): "12 reposts, 4 quotes, 30 likes", each part left out at zero or when hidden. */
export function threadStats(counts: PostCounts, hideCounts: boolean): string {
  const parts: [number, UiWord, UiWord, boolean][] = [
    [counts.reposts, "thread.stats.reposts", "thread.stats.reposts.one", hideCounts],
    [counts.quotes, "thread.stats.quotes", "thread.stats.quotes.one", false],
    [counts.likes, "thread.stats.likes", "thread.stats.likes.one", hideCounts],
  ];
  return parts
    .filter(([n, , , hidden]) => n > 0 && !hidden)
    .map(([n, many, one]) => (n === 1 ? UI_WORDS[one] : fill(UI_WORDS[many], { n })))
    .join(", ");
}

const FAILED: Record<ToggleKind, { on: UiWord; off: UiWord }> = {
  like: { on: "toast.failed.like", off: "toast.failed.unlike" },
  repost: { on: "toast.failed.repost", off: "toast.failed.unrepost" },
  bookmark: { on: "toast.failed.save", off: "toast.failed.unsave" },
};

/** The rollback toast's sentence (5.4, 8.6), naming the action the reader took. */
export function failedWords(kind: ToggleKind, on: boolean): string {
  return UI_WORDS[FAILED[kind][on ? "on" : "off"]];
}

export function followFailedWords(handle: string, on: boolean): string {
  return fill(UI_WORDS[on ? "toast.failed.follow" : "toast.failed.unfollow"], { handle });
}
```

### Create `apps/app/src/lib/reach.ts`

```ts
import type { ExploreStatusKind, MeResponse, PostView } from "@korbat/contracts";
import { exploreStatusText } from "./explore";
import { chipText } from "./moderation";
import { CHIP_WORDS } from "./moderation-words";
import { runningMeasure } from "./standing";
import { UI_WORDS } from "./ui-words";

/**
 * Who sees a post (UI design, section 6.14): the sentences of the "Who sees this" sheet, built only from what the client
 * already holds (the post, the reader's /me) and, for the reader's own visible top-level post, the answer of GET
 * /api/posts/:id/explore, which the sheet asks for when `asksExplore` says so. Nothing here claims more than that data
 * says: a reader's view of someone else's post never mentions moderation (readers never receive another account's
 * restricted post, so its absence says nothing); no sentence says a blocked account cannot read a public post, since
 * anyone signed out can; and the sentence of a withheld or removed post names korbat's moderators, who see it too.
 */
export interface ReachLine {
  text: string;
  link?: { label: string; href: string };
}

export interface Reach {
  lines: ReachLine[];
  /** The one line under the menu item. */
  summary: string;
  /** Whether the sheet should ask the post's Explore status: the reader's own top-level post, when nothing else decides. */
  asksExplore: boolean;
}

/** Always last: how korbat treats reach, with the way to read how Explore ranks. */
const NEVER: ReachLine = { text: UI_WORDS["reach.never"], link: { label: UI_WORDS["reach.how"], href: "/explore/about" } };

export function reach(post: PostView, me: MeResponse | null, explore?: ExploreStatusKind | null): Reach {
  const own = me !== null && post.author.id === me.user.id;
  const publicLine: ReachLine = { text: UI_WORDS["reach.public"] };
  if (!own) return { lines: [publicLine, NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };

  if (post.state !== "visible") {
    const decision = post.moderation;
    const lines: ReachLine[] = [{ text: UI_WORDS["reach.private"] }];
    // The chip's own words; without the decision's facts, the state's plain word, as the chip says it.
    const chip = decision ? chipText(decision) : post.state === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
    if (decision && !decision.order) lines.push({ text: chip, link: { label: UI_WORDS["reach.decision"], href: `/settings/cases/${decision.decisionId}` } });
    else lines.push({ text: chip });
    if (decision?.order) {
      lines.push({ text: UI_WORDS["reach.order"], link: { label: UI_WORDS["reach.decision"], href: `/settings/cases/${decision.decisionId}` } });
    }
    lines.push(NEVER);
    return { lines, summary: UI_WORDS["reach.summary.private"], asksExplore: false };
  }

  if (post.replyTo !== null) {
    return { lines: [{ text: UI_WORDS["reach.reply"] }, { text: UI_WORDS["reach.replyExplore"] }, NEVER], summary: UI_WORDS["reach.summary.public"], asksExplore: false };
  }

  const lines: ReachLine[] = [publicLine, { text: UI_WORDS["reach.blocked"] }, { text: UI_WORDS["reach.feeds"] }];
  let asksExplore = false;
  if (post.inExplore) lines.push({ text: UI_WORDS["reach.inExplore"] });
  else if (me.profile?.showInExplore === false) lines.push({ text: UI_WORDS["reach.exploreOff"] });
  else if (runningMeasure(me.standing) !== null) lines.push({ text: UI_WORDS["reach.suspended"] });
  // Quotes never enter Explore, as replies do not (lib/explore.ts): there is nothing to ask.
  else if (post.quoteOf !== null) lines.push({ text: UI_WORDS["reach.quoteExplore"] });
  else if (explore) {
    const text = exploreStatusText(explore);
    if (text !== null) lines.push({ text });
  } else asksExplore = true;
  lines.push(NEVER);
  return { lines, summary: UI_WORDS["reach.summary.public"], asksExplore };
}
```

### Replace `apps/app/src/components/kit/IconButton.tsx` (whole file)

```tsx
import { cva } from "class-variance-authority";
import { useEffect, useRef, useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import type { IconName } from "@/components/icons";
import { compactCount } from "@/lib/format";
import { useMotion, usePressScale, type PopName } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { Icon } from "./Icon";
import { FOCUS_RING, HOVER_WASH, lastInputWasKeyboard, pressDelay } from "./interaction";
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
 *
 * The post's toggles (Like, Repost, Save) also take `feedback`, the motion of the reader's last press, and Repost takes
 * `disc`, its "on" look (UI Task 4 extends IconButton with both rather than building a second button on it).
 */
export type IconButtonTone = "low" | "high" | "accent" | "danger";

const ICON_TONE: Record<IconButtonTone, Tone> = { low: "low", high: "high", accent: "accent", danger: "danger" };

/** The target: round, 44 px at least, the hover wash and the ring. A counted button grows to fit its number. */
const target = cva(cn("min-h-[44px] min-w-[44px] flex-row items-center justify-center gap-1 rounded-full", HOVER_WASH, FOCUS_RING), {
  variants: { counted: { true: "px-2", false: "" } },
});

/**
 * A toggle's motion (section 5.2), played once for each new `at`. "on" pops: one spring released from the pressed scale
 * (Like's underdamped to about 1.15, with an accent ring at 40 percent growing from 0.6 to 1.4 as it fades, in 300 ms;
 * Repost's and Save's firmer, no ring). "off" never pops: the old look fades out over the new in 120 ms. "back" is the
 * rollback of a refused action: the old state returns with one 4 px nudge sideways over 200 ms. A count that moved rolls
 * 6 px, the old number out and the new one in from the other side, in 180 ms. Under reduced motion, and for a press made
 * with the keyboard, nothing moves: the look and the number cross-fade in 120 ms.
 */
export interface IconButtonFeedback {
  at: number;
  turn: "on" | "off" | "back";
  pop?: PopName;
  /** Which way the count moved: up, down, or not at all. */
  count?: 1 | -1 | 0;
}

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
  /**
   * The reposted look (section 4.7): Repeat2 has no closed shape to fill, so "on" draws it at stroke 2.25 inside a 28 px
   * accent-wash disc with a 1.5 px accent ring, and its count turns body-strong, a shape cue as the fill is.
   */
  disc?: boolean;
  /** What the reader's last press of a toggle did, for its motion; a new `at` plays it once. */
  feedback?: IconButtonFeedback;
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

/** What a button looks like at one moment, kept so the next look can cross-fade over it. */
interface Look {
  tone: Tone;
  filled: boolean;
  disc: boolean;
  shown: string | null;
}

/** The icon in its 28 px box, which draws the reposted disc when asked. */
function Glyph({ icon, look }: { icon: IconName; look: Look }) {
  return (
    <View className={cn("h-7 w-7 items-center justify-center rounded-full", look.disc ? "border-[1.5px] border-accent bg-accent-wash" : "")}>
      <Icon name={icon} size={20} tone={look.tone} filled={look.filled} strong={look.disc} />
    </View>
  );
}

/** The visible number, hidden from the name, which says it already. */
function Count({ look }: { look: Look }) {
  return (
    <Text variant={look.disc ? "body-strong" : "meta"} tone={look.tone} aria-hidden>
      {look.shown}
    </Text>
  );
}

/** An icon button's pressed scale (section 5.2), which a toggle's pop is released from. */
const PRESSED = 0.92;

export function IconButton({ icon, label, onPress, pressed, busy = false, count, tone, filled = false, disabled = false, hasPopup, expanded, disc = false, feedback, ref }: IconButtonProps) {
  const motion = useMotion();
  const press = usePressScale(PRESSED);
  const tooltip = useTooltip();
  const shown = count !== undefined && count > 0 ? compactCount(count) : null;
  const iconTone = ICON_TONE[tone ?? (pressed ? "accent" : "low")];
  const look: Look = { tone: iconTone, filled, disc, shown };

  // The look before the last change, drawn over the new one while it fades out; the count's old number likewise.
  const [leaving, setLeaving] = useState<Look | null>(null);
  const [rolling, setRolling] = useState<string | null>(null);
  const before = useRef(look);
  const played = useRef(feedback?.at ?? 0);
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0);
  const nudge = useSharedValue(0);
  const fadeIn = useSharedValue(1);
  const fadeOut = useSharedValue(0);
  const numberIn = useSharedValue(0);
  const numberOut = useSharedValue(0);

  useEffect(() => {
    if (feedback === undefined || feedback.at === played.current) return;
    played.current = feedback.at;
    const previous = before.current;
    const plain = motion.reduced || lastInputWasKeyboard();
    if (plain || feedback.turn !== "on") {
      setLeaving(previous);
      fadeIn.value = 0;
      fadeOut.value = 1;
      fadeIn.value = withTiming(1, motion.timing("easeOut", 120));
      fadeOut.value = withTiming(0, motion.timing("easeOut", 120), (finished) => {
        "worklet";
        if (finished) runOnJS(setLeaving)(null);
      });
    }
    if (plain) return;
    if (feedback.turn === "on") {
      // Released from the pressed scale, 0.92, with the pop's own velocity. The scale is set there first, which also stops
      // the press's own timing: Reanimated 4.5 skips an animation whose value already sits at its target (a quick tap is
      // back at 1 before its first frame), and it adds a new spring's velocity to the running animation's, which for a
      // timing is no number, so the pop would start still.
      press.value.value = Math.min(press.value.value, PRESSED);
      press.value.value = withSpring(1, motion.pop(feedback.pop ?? "springToggle"));
      if (feedback.pop === "springLike") {
        ringScale.value = 0.6;
        ringOpacity.value = 0.4;
        ringScale.value = withTiming(1.4, motion.timing("easeOut", 300));
        ringOpacity.value = withTiming(0, motion.timing("easeOut", 300));
      }
    }
    if (feedback.turn === "back") nudge.value = withSequence(withTiming(4, motion.timing("easeOut", 70)), withTiming(0, motion.timing("easeOut", 130)));
    const dir = feedback.count ?? 0;
    if (dir !== 0 && previous.shown !== null && previous.shown !== shown) {
      setRolling(previous.shown);
      numberIn.value = dir * 6;
      numberOut.value = 0;
      numberIn.value = withTiming(0, motion.timing("easeOut", 180));
      numberOut.value = withTiming(-dir * 6, motion.timing("easeOut", 180), (finished) => {
        "worklet";
        if (finished) runOnJS(setRolling)(null);
      });
    }
  }, [feedback?.at]);
  // After the feedback has read it: the look this render committed is the one the next change leaves from.
  useEffect(() => {
    before.current = look;
  });

  const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value, transform: [{ scale: ringScale.value }] }));
  const inStyle = useAnimatedStyle(() => ({ opacity: fadeIn.value }));
  const outStyle = useAnimatedStyle(() => ({ opacity: fadeOut.value }));
  const numberInStyle = useAnimatedStyle(() => ({ transform: [{ translateY: numberIn.value }], opacity: 1 - Math.abs(numberIn.value) / 6 }));
  const numberOutStyle = useAnimatedStyle(() => ({ transform: [{ translateY: numberOut.value }], opacity: 1 - Math.abs(numberOut.value) / 6 }));

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
        <Animated.View style={nudgeStyle}>
          <View className={cn("flex-row items-center gap-1 web:transition-opacity web:duration-150", busy ? "opacity-60" : "opacity-100")}>
            <View>
              {/* Like's ring, behind the heart: nothing to see until it pops. */}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ringStyle]}>
                <View aria-hidden className="h-7 w-7 rounded-full border-2 border-accent" />
              </Animated.View>
              <Animated.View style={inStyle}>
                <Glyph icon={icon} look={look} />
              </Animated.View>
              {leaving ? (
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, outStyle]}>
                  <Glyph icon={icon} look={leaving} />
                </Animated.View>
              ) : null}
            </View>
            {shown !== null ? (
              <View>
                <Animated.View style={rolling !== null ? numberInStyle : inStyle}>
                  <Count look={look} />
                </Animated.View>
                {rolling !== null ? (
                  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, numberOutStyle]}>
                    <Count look={{ ...look, shown: rolling }} />
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </View>
        </Animated.View>
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
export type TextVariant = "display-1" | "display-2" | "display-3" | "title" | "post" | "post-large" | "body" | "body-strong" | "meta" | "chip" | "mono";

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
 * The ten variants of section 4.3, and post-large, the thread's focused post at 19 / 28 (section 6.6). Fraunces (the display face) is used at 22 px and up only, where its optical size reads as meant;
 * below that, emphasis comes from weight. Prose is set loose (1.53 for posts), display tight.
 */
export const VARIANTS: Record<TextVariant, VariantSpec> = {
  "display-1": { face: "display", weight: 600, size: 34, line: 40, tracking: -0.02, variation: '"SOFT" 50, "WONK" 1' },
  "display-2": { face: "display", weight: 600, size: 28, line: 34, tracking: -0.015 },
  "display-3": { face: "display", weight: 600, size: 22, line: 28, tracking: -0.01 },
  title: { face: "text", weight: 700, size: 18, line: 24, tracking: 0 },
  post: { face: "text", weight: 400, size: 17, line: 26, tracking: 0 },
  "post-large": { face: "text", weight: 400, size: 19, line: 28, tracking: 0 },
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
const MAX_SCALE: Partial<Record<TextVariant, number>> = { chip: 1.5, post: 0, "post-large": 0 };

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

### Replace `apps/app/src/components/kit/interaction.ts` (whole file)

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

/**
 * Whether the reader's last input on the web was a key rather than a pointer. Keyboard actions do not animate their
 * content (section 5.1): a sheet, a dialog or a menu opened from the keyboard takes its reduced form, and a toggle pressed
 * with Enter or Space cross-fades instead of popping. The listeners are installed once, when the kit loads, in the
 * capture phase, so they hear a key before any handler acts on it; native has no such modality and answers false.
 */
const modality = { keyboard: false };

if (Platform.OS === "web" && typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    // A modifier alone (Alt+Tab away, Shift held) says nothing about how the next action is made.
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) modality.keyboard = true;
  }, true);
  document.addEventListener("pointerdown", () => {
    modality.keyboard = false;
  }, true);
}

export function lastInputWasKeyboard(): boolean {
  return modality.keyboard;
}

/**
 * A data attribute on the web (react-native-web's dataSet), which the browser check and the render tests find an element
 * by: `data-scrim`, `data-handle`, `data-menu`. React Native's own types have no dataSet, so it goes through one cast here.
 */
export function dataAttribute(name: string, value = ""): object {
  return { dataSet: { [name]: value } };
}
```

### Replace `apps/app/src/components/social/HiddenImage.tsx` (whole file)

```tsx
import { View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { UI_WORDS } from "@/lib/ui-words";

/** What stands in the place of an image korbat's moderation hid from this reader; it does not say why. */
export const HIDDEN_IMAGE = "Image hidden by korbat moderation";
/** What stands in the place of the reader's own image once it is sealed: nobody is shown it, its author included. */
export const SEALED_IMAGE = "Sealed: not shown to anyone, you included";

/** The API marks a hidden image as sealed only for its author; for everyone else a sealed image reads like any hidden one. */
export function hiddenImageWords(item: HiddenMedia): string {
  return item.sealed ? SEALED_IMAGE : HIDDEN_IMAGE;
}

/**
 * The placeholder of a hidden image, filling the cell or the frame it is put in (UI design, sections 4.8 and 6.7): the
 * hidden icon and the sentence in ink-medium on surface-2, a neutral look rather than a status colour. A hidden image has
 * no file to load, no description and nothing to open, so this is words in a box: no picture, and no control.
 */
export function HiddenImage({ item }: { item: HiddenMedia }) {
  return (
    <View style={{ flex: 1 }} className="items-center justify-center gap-2 bg-surface-2 px-3 py-4">
      <Icon name="hidden" size={20} tone="medium" />
      <Text variant="meta" tone="medium" className="text-center">
        {hiddenImageWords(item)}
      </Text>
    </View>
  );
}

/**
 * The same as a small square, for the row of a quoted post's images. It is too small for the sentence and shows one
 * short word; the row says the sentence once, as text, under its squares (HiddenRowWords), so the square itself is
 * left out of what assistive technology reads, which would otherwise hear the row's sentence after a word of each square.
 */
export function HiddenThumbnail({ size }: { size: number }) {
  return (
    <View aria-hidden className="items-center justify-center gap-0.5 rounded-media border border-line-low bg-surface-2" style={{ width: size, height: size }}>
      <Icon name="hidden" size={16} tone="medium" />
      <Text variant="chip" tone="medium">
        {UI_WORDS["media.hidden"]}
      </Text>
    </View>
  );
}

/**
 * The sentence a row of small squares says under itself when it holds a hidden image: once, however many it holds. The
 * API marks a hidden image as sealed only for its author, so the sealed sentence is read only by the author of a sealed
 * image in the row; anyone else reads the sentence of a hidden image. Nothing when the row holds no hidden image.
 */
export function HiddenRowWords({ media }: { media: readonly (MediaView | HiddenMedia)[] }) {
  const hidden = media.filter(isHiddenMedia);
  if (hidden.length === 0) return null;
  return (
    <Text variant="meta" tone="medium" className="mt-1">
      {hiddenImageWords(hidden.find((item) => item.sealed) ?? hidden[0]!)}
    </Text>
  );
}
```

### Replace `apps/app/src/components/social/ImageFault.tsx` (whole file)

```tsx
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import type { MediaStatusResponse } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { IMAGE_FAULT_WORDS } from "@/lib/moderation-words";
import { social } from "@/lib/social";

/**
 * 3d (design, sections 7.1 and 9.6): why an image of the reader's own post did not load, when its status says so. The
 * post's own answer says nothing of it (PostView is unchanged), so the image's component asks GET /api/media/:id once,
 * after a failed load, and only for the reader's own image: `restoring` while its files wait in the quarantine to be
 * returned after its seal was lifted, `lost` once korbat recorded them as lost. Anything else is what a missing image
 * shows to anyone.
 */
export type ImageFault = "restoring" | "lost";

/** The fault a status answer names, or null. */
export function imageFaultOf(answer: MediaStatusResponse): ImageFault | null {
  if (answer.status !== "ready") return null;
  if (answer.lost) return "lost";
  if (answer.restoring) return "restoring";
  return null;
}

/**
 * Asks the status of an image at most once, whatever number of times its load fails, and answers the fault it names,
 * or null when it names none or the question failed: a missing image then shows as one.
 */
export function faultAsker(ask: (id: string) => Promise<MediaStatusResponse> = social.mediaStatus) {
  const asked = new Set<string>();
  return async (id: string): Promise<ImageFault | null> => {
    if (asked.has(id)) return null;
    asked.add(id);
    try {
      return imageFaultOf(await ask(id));
    } catch {
      return null;
    }
  };
}

/**
 * The fault of one image of the reader's own post, and the handler for its failed load. For an image of anyone else's
 * post the handler does nothing: only an author is told why their image is missing.
 */
export function useImageFault(id: string, own: boolean): { fault: ImageFault | null; onError: (() => void) | undefined } {
  // Kept with the image it is about: the viewer steps between images with one component.
  const [found, setFound] = useState<{ id: string; fault: ImageFault } | null>(null);
  const ask = useRef(faultAsker()).current;
  const onError = useCallback(() => {
    void ask(id).then((fault) => {
      if (fault !== null) setFound({ id, fault });
    });
  }, [ask, id]);
  return { fault: found?.id === id ? found.fault : null, onError: own ? onError : undefined };
}

/**
 * What stands in the place of the author's own image that did not load, with the words of its fault, on surface-2 as a
 * hidden image's placeholder is (UI design, section 6.7). A lost image is an error, so it says so in danger-ink with the
 * error icon as well as in words; one being restored is neutral, with the retry icon.
 */
export function ImageFaultView({ fault }: { fault: ImageFault }) {
  const lost = fault === "lost";
  return (
    <View style={{ flex: 1 }} className="items-center justify-center gap-2 bg-surface-2 px-3 py-4">
      <Icon name={lost ? "error" : "retry"} size={20} tone={lost ? "danger" : "medium"} />
      <Text variant="meta" tone={lost ? "danger" : "medium"} className="text-center">
        {IMAGE_FAULT_WORDS[fault]}
      </Text>
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaGrid.tsx` (whole file)

```tsx
import { useRef, useState } from "react";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { FOCUS_RING_INSET } from "@/components/kit/interaction";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useMotion } from "@/lib/motion";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { HiddenImage, HiddenRowWords, HiddenThumbnail, hiddenImageWords } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";
import { MediaViewer, Thumbnails } from "./MediaViewer";

/** A single image keeps its own shape, within limits, so a very tall or very wide one cannot take over the timeline. */
const MIN_RATIO = 3 / 4;
const MAX_RATIO = 2;
const FRAME_RATIO = 16 / 9;
const GAP = 2;
const THUMBNAIL = 64;

export const clampRatio = (width: number, height: number): number => Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));

/**
 * The small size of an image with its blurhash (UI design, section 11.2). expo-image loads it lazily on the web and keeps
 * its view for the next image of a recycled row by the media id; the blurhash cross-fades into the image in 150 ms
 * unless motion is reduced, by the system or the reader, which swaps it at once.
 */
function Picture({ item, style, onError }: { item: MediaView; style: { width: number | "100%"; height: number | "100%" }; onError?: () => void }) {
  const { reduced } = useMotion();
  return (
    // On the web expo-image takes the <img alt> from accessibilityLabel, not from alt.
    <Image source={{ uri: `${API_BASE}${item.small}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="cover" transition={reduced ? 0 : 150} accessibilityLabel={item.alt} style={style} onError={onError} />
  );
}

/**
 * The label on the author's own image that moderation withheld or removed (3c design, section 9): the author keeps seeing
 * such an image, and reads on the image itself that others do not. The API marks an image so only for its author. It is
 * the information-only StatusChip in the image's corner (UI design, section 6.7), and takes no press: the image under it
 * still opens.
 */
export function OwnImageLabel({ state }: { state: NonNullable<MediaView["moderation"]> }) {
  const withheld = state === "withheld";
  return (
    <View pointerEvents="none" className="absolute left-2 top-2 right-2">
      <StatusChip tone={withheld ? "review" : "restricted"} label={withheld ? CHIP_WORDS.underReview : CHIP_WORDS.removed} />
    </View>
  );
}

/**
 * One image of the frame: the control that opens it and, beside that control, the label of the author's own restricted
 * image, as text of its own. 3d: when an image of the reader's own post fails to load, its status is asked once, and an
 * image being restored or lost shows why in its place, with nothing to open. `cell` keeps the control's element, which
 * the lightbox grows from and returns into.
 */
function Cell({ item, onPress, own, cell }: { item: MediaView; onPress: () => void; own: boolean; cell: (node: View | null) => void }) {
  const { fault, onError } = useImageFault(item.id, own);
  return (
    <View style={{ flex: 1 }}>
      {fault !== null ? (
        <ImageFaultView fault={fault} />
      ) : (
        <Pressable ref={cell} accessibilityRole="button" accessibilityLabel={fill(UI_WORDS["media.open"], { alt: item.alt })} onPress={onPress} style={{ flex: 1 }} className={FOCUS_RING_INSET}>
          <Picture item={item} style={{ width: "100%", height: "100%" }} onError={onError} />
        </Pressable>
      )}
      {item.moderation ? <OwnImageLabel state={item.moderation} /> : null}
    </View>
  );
}

/**
 * The images of a post (UI design, section 6.7). One image is shown in its own ratio; two to four share a 16:9 frame and
 * are cropped to their cell. The frame is clipped to radius media with a 1 px line-low hairline drawn inside it, so a
 * white image keeps its edge on the Light theme. Pressing one opens the viewer, which grows from it; ALT shows the
 * descriptions in place. An image moderation hid from this reader keeps its place as a placeholder: it has no size of its
 * own, so alone it takes the frame's ratio, it is no control, and it has no description to show. The viewer is told the
 * post that holds the images, so that an image can be reported on it, unless the post is the reader's own.
 */
function Grid({ media, postId, own }: { media: (MediaView | HiddenMedia)[]; postId?: string; own?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [described, setDescribed] = useState(false);
  // Each cell's control, by its place, for the viewer to measure.
  const cells = useRef<(View | null)[]>([]);
  const cell = (index: number) => {
    const item = media[index]!;
    return isHiddenMedia(item) ? <HiddenImage key={item.id} item={item} /> : <Cell key={item.id} item={item} onPress={() => setOpen(index)} own={own === true} cell={(node) => void (cells.current[index] = node)} />;
  };
  const first = media[0]!;
  // Descriptions exist only for the images this reader is shown.
  const anyShown = media.some((item) => !isHiddenMedia(item));

  let frame;
  if (media.length === 1) {
    frame = <View style={{ aspectRatio: isHiddenMedia(first) ? FRAME_RATIO : clampRatio(first.width, first.height) }}>{cell(0)}</View>;
  } else if (media.length === 2) {
    frame = <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>;
  } else if (media.length === 3) {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, flexDirection: "row", gap: GAP }}>
        {cell(0)}
        <View style={{ flex: 1, gap: GAP }}>{[cell(1), cell(2)]}</View>
      </View>
    );
  } else {
    frame = (
      <View style={{ aspectRatio: FRAME_RATIO, gap: GAP }}>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(0), cell(1)]}</View>
        <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{[cell(2), cell(3)]}</View>
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="overflow-hidden rounded-media bg-surface-2">
        {frame}
        <View pointerEvents="none" aria-hidden className="absolute inset-0 rounded-media border border-line-low" />
      </View>
      {anyShown ? (
        // The one ALT toggle (a per-image badge would say nothing: every korbat image has a description), a 44 px target.
        <Pressable
          accessibilityRole="button"
          aria-expanded={described}
          accessibilityLabel={described ? UI_WORDS["media.hideAlt"] : UI_WORDS["media.showAlt"]}
          onPress={() => setDescribed(!described)}
          className={cn("group min-h-[44px] min-w-[44px] items-start justify-center self-start rounded-control", FOCUS_RING_INSET)}
        >
          <View className={cn("rounded-[6px] border px-1.5 py-0.5", described ? "border-accent bg-accent-wash" : "border-line-high bg-surface-1 web:group-hover:bg-surface-2")}>
            <Text variant="chip" tone={described ? "accent" : "medium"}>
              {UI_WORDS["media.alt"]}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {described
        ? media.map((item, index) => (
            <Text key={item.id} tone="medium" className="mt-1">
              {media.length > 1 ? `${index + 1}. ` : ""}
              {/* A hidden image keeps its number, so the others' numbers match their places in the frame. */}
              {isHiddenMedia(item) ? hiddenImageWords(item) : item.alt}
            </Text>
          ))
        : null}
      <Thumbnails.Provider value={cells}>
        {open === null ? null : <MediaViewer media={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} postId={own ? undefined : postId} own={own === true} />}
      </Thumbnails.Provider>
    </View>
  );
}

/**
 * A post's images (`Grid`), or a quoted post's as one row of small squares (`compact`). The squares
 * are pictures, not buttons: the whole quote is a link to the quoted post, where the grid and the
 * viewer are, and a control inside another control is one that assistive technology cannot reach.
 * A hidden image keeps its square in the row, and the row says the placeholder's sentence once, as
 * text, under the squares. `postId` is the post that holds the images and `own` says that the reader
 * wrote it: the viewer reports an image on that post, and offers no report of the reader's own.
 */
export function MediaGrid({ media, compact = false, postId, own = false }: { media: (MediaView | HiddenMedia)[]; compact?: boolean; postId?: string; own?: boolean }) {
  if (media.length === 0) return null;
  if (!compact) return <Grid media={media} postId={postId} own={own} />;
  return (
    <View className="mt-2">
      <View className="flex-row" style={{ gap: GAP }}>
        {media.map((item) =>
          isHiddenMedia(item) ? (
            <HiddenThumbnail key={item.id} size={THUMBNAIL} />
          ) : (
            <View key={item.id} className="overflow-hidden rounded-media border border-line-low" style={{ width: THUMBNAIL, height: THUMBNAIL }}>
              <Picture item={item} style={{ width: "100%", height: "100%" }} />
            </View>
          ),
        )}
      </View>
      <HiddenRowWords media={media} />
    </View>
  );
}
```

### Replace `apps/app/src/components/social/MediaViewer.tsx` (whole file)

```tsx
import { createContext, useContext, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Link } from "expo-router";
import { isHiddenMedia, type HiddenMedia, type MediaView } from "@korbat/contracts";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { DragArea, type DragHandlers } from "@/components/kit/DragArea";
import { IconButton } from "@/components/kit/IconButton";
import { FOCUS_RING, dataAttribute, lastInputWasKeyboard } from "@/components/kit/interaction";
import { measureNode, type Rect } from "@/components/kit/measure";
import { StatusChip } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { API_BASE } from "@/lib/api";
import { useHaptics } from "@/lib/haptics";
import { reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { projectedEnd, useMotion } from "@/lib/motion";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { ThemeScope } from "@/theme/ThemeProvider";
import { FIXED_COLOURS } from "@/theme/tokens";
import { HiddenImage } from "./HiddenImage";
import { ImageFaultView, useImageFault } from "./ImageFault";

interface MediaViewerProps {
  media: (MediaView | HiddenMedia)[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The post that holds the images: an image is reported on it. Absent for the reader's own post, which they do not report. */
  postId?: string;
  /** 3d: the reader wrote the post, so an image that fails to load asks its status once and says why it is missing. */
  own?: boolean;
}

/**
 * The grid's image cells by their place, which the lightbox grows from and returns into (UI design, section 5.2): the
 * grid provides them around its viewer, so the viewer's props stay as they were.
 */
export const Thumbnails = createContext<RefObject<(View | null)[]> | null>(null);

/** The stage's near-black, 0.94 at full; the drag thins it towards 0.4 at half a screen. */
const STAGE_ALPHA = FIXED_COLOURS.stage[3];
const DRAGGED_ALPHA = 0.4;
/** A vertical release closes when its projected end passes this far, or it moves down faster than 200 px/s. */
const CLOSE_DISTANCE = 100;

/** What the motion hands the content; a render test draws the content without it, open and still. */
interface Staging {
  stageStyle?: object;
  chromeStyle?: object;
  imageStyle?: object;
  drag?: DragHandlers;
  onArea?: (event: LayoutChangeEvent) => void;
  /** The ids that name the dialog: its place among the images and the description. */
  countId?: string;
  altId?: string;
}

/**
 * What the viewer shows: one image in its large size, fitted inside the screen, with its description underneath, its
 * place among the post's images and the controls, on a near-black stage (rgba(0, 0, 0, 0.94)) that is a forced Dark
 * scope in every theme, so images are seen as they are and the ink, buttons and focus ring keep the Dark values (section
 * 6.7). The viewer is opened from an image's own cell only; stepping through the post's images can still come to one
 * moderation hid from this reader, which is never loaded: its placeholder stands in the image's place. An image that is
 * shown can be reported from here, on the post that holds it; the author's own withheld or removed image says so.
 */
export function MediaViewerContent({ media, index, onIndex, onClose, postId, own = false, stageStyle, chromeStyle, imageStyle, drag, onArea, countId, altId }: MediaViewerProps & Staging) {
  const { reduced } = useMotion();
  const item = media[index]!;
  const { fault, onError } = useImageFault(item.id, own && !isHiddenMedia(item));
  const many = media.length > 1;
  const step = (by: number) => onIndex((index + by + media.length) % media.length);

  const picture = isHiddenMedia(item) ? (
    <HiddenImage item={item} />
  ) : fault !== null ? (
    <ImageFaultView fault={fault} />
  ) : (
    <Image source={{ uri: `${API_BASE}${item.large}` }} placeholder={{ blurhash: item.blurhash }} recyclingKey={item.id} contentFit="contain" transition={reduced ? 0 : 150} accessibilityLabel={item.alt} style={{ flex: 1 }} onError={onError} />
  );
  return (
    <ThemeScope theme="dark" style={{ flex: 1 }}>
      <Animated.View style={[{ flex: 1, backgroundColor: `rgba(0, 0, 0, ${STAGE_ALPHA})` }, stageStyle]}>
        <Animated.View style={chromeStyle}>
          <View className="flex-row items-center justify-between gap-3 px-4 py-2">
            <Text nativeID={countId} tone="medium">
              {many ? fill(UI_WORDS["media.count"], { n: index + 1, total: media.length }) : ""}
            </Text>
            <IconButton icon="close" label={UI_WORDS["media.close"]} tone="high" onPress={onClose} />
          </View>
        </Animated.View>
        <View className="flex-1 px-2" onLayout={onArea}>
          <Animated.View style={[{ flex: 1 }, imageStyle]}>
            {/* The browser check finds the image by this mark and reads the motion off the element around it. */}
            <View {...dataAttribute("lightbox-image")} style={{ flex: 1 }}>
              {drag ? (
                <DragArea {...drag} style={{ flex: 1 }}>
                  {picture}
                </DragArea>
              ) : (
                picture
              )}
            </View>
          </Animated.View>
        </View>
        <Animated.View style={chromeStyle}>
          <View className="items-center gap-2 px-4 pb-4 pt-3">
            {isHiddenMedia(item) ? null : (
              <Text nativeID={altId} className="text-center">
                {item.alt}
              </Text>
            )}
            {!isHiddenMedia(item) && item.moderation ? (
              <StatusChip tone={item.moderation === "withheld" ? "review" : "restricted"} label={item.moderation === "withheld" ? CHIP_WORDS.underReview : CHIP_WORDS.removed} className="self-center" />
            ) : null}
            {!isHiddenMedia(item) && postId ? (
              // A real anchor, as every link of the app; the viewer closes as the form opens.
              <Link href={reportHref({ post: postId, media: item.id })} onPress={onClose} asChild>
                <Pressable className={cn("min-h-[44px] justify-center self-center rounded-control px-2", FOCUS_RING)}>
                  <Text tone="accent" className="underline decoration-1 underline-offset-2">
                    {REPORT_WORDS.imageControl}
                  </Text>
                </Pressable>
              </Link>
            ) : null}
            {many ? (
              <View className="flex-row justify-center gap-6">
                <IconButton icon="previous" label={UI_WORDS["media.previous"]} tone="high" onPress={() => step(-1)} />
                <IconButton icon="next" label={UI_WORDS["media.next"]} tone="high" onPress={() => step(1)} />
              </View>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </ThemeScope>
  );
}

/** The fitted box of an image of this ratio inside the image area (contentFit "contain"), centred. */
function fitted(area: Rect, ratio: number): Rect {
  const width = Math.min(area.width, area.height * ratio);
  const height = width / ratio;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}

/**
 * The transform that lays the fitted image over a thumbnail: the centres together, the image scaled until it fits inside
 * the thumbnail's box. The image area's own centre is the fitted image's, which is where the scale is taken from.
 */
function towards(thumbnail: Rect, area: Rect, ratio: number): { x: number; y: number; scale: number } {
  const image = fitted(area, ratio);
  const scale = Math.min(thumbnail.width / image.width, thumbnail.height / image.height);
  return { x: thumbnail.x + thumbnail.width / 2 - (area.x + area.width / 2), y: thumbnail.y + thumbnail.height / 2 - (area.y + area.height / 2), scale };
}

/**
 * One image on the whole screen (UI design, sections 5.2 and 6.7). It grows from the thumbnail that was pressed (translate
 * and scale, spring-snap) while the stage fades in over 200 ms; a vertical drag of the image takes it along 1:1, shrinking
 * it to 0.85 and thinning the stage to 0.4 at half a screen while the chrome fades, and a release whose momentum carries
 * it 100 px, or a downward flick over 200 px/s, closes it; on touch a horizontal swipe pages to the next image. Closing
 * returns it into its thumbnail when that is on screen, else it fades. Under reduced motion, or opened from the keyboard,
 * it fades in and out in 150 ms and a drag moves the image only. Arrow keys switch at once; react-native-web's Modal
 * closes it on Escape and gives the focus back to the image that opened it.
 */
export function MediaViewer({ media, index, onIndex, onClose, postId, own }: MediaViewerProps) {
  const many = media.length > 1;
  const motion = useMotion();
  const haptic = useHaptics();
  const cells = useContext(Thumbnails);
  const screen = useWindowDimensions();
  const countId = useId();
  const altId = useId();
  const area = useRef<Rect | null>(null);
  const closing = useRef(false);
  const still = useRef(motion.reduced || lastInputWasKeyboard());
  const [opened, setOpened] = useState(false);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  // 0 to 1: the stage's share of its full near-black, the chrome's opacity, and the whole viewer's under a fade.
  const stage = useSharedValue(0);
  const chrome = useSharedValue(0);
  const whole = useSharedValue(still.current ? 0 : 1);
  // The image waits unseen until it is laid over its thumbnail, so its first frame is never at full size.
  const ready = useSharedValue(still.current ? 1 : 0);

  const item = media[index]!;
  const ratio = isHiddenMedia(item) ? 16 / 9 : item.width / item.height;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && many) onIndex((index + 1) % media.length);
      if (event.key === "ArrowLeft" && many) onIndex((index - 1 + media.length) % media.length);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, many, media.length, onIndex]);

  /** Opens once the image area has its size: from the thumbnail, or as a fade. */
  const onArea = (event: LayoutChangeEvent) => {
    const { x: left, y: top, width, height } = event.nativeEvent.layout;
    area.current = { x: left, y: top, width, height };
    if (opened) return;
    setOpened(true);
    if (still.current) {
      stage.value = 1;
      chrome.value = 1;
      whole.value = withTiming(1, motion.timing("fade"));
      return;
    }
    stage.value = withTiming(1, motion.timing("easeOut", 200));
    chrome.value = withTiming(1, motion.timing("easeOut", 200));
    const node = cells?.current[index];
    if (!node) {
      ready.value = withTiming(1, motion.timing("fade"));
      return;
    }
    measureNode(node, (thumbnail) => {
      if (!area.current || closing.current) return;
      const from = towards(thumbnail, area.current, ratio);
      x.value = from.x;
      y.value = from.y;
      scale.value = from.scale;
      ready.value = 1;
      x.value = withSpring(0, motion.spring("springSnap"));
      y.value = withSpring(0, motion.spring("springSnap"));
      scale.value = withSpring(1, motion.spring("springSnap"));
    });
  };

  /** Closes: back into the thumbnail of the image on screen when it is in view, else a fade; then the viewer leaves. */
  const close = (velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    const leave = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(onClose)();
    };
    const fade = () => {
      whole.value = withTiming(0, motion.timing("fade"), leave);
    };
    if (still.current || motion.reduced || !area.current) {
      fade();
      return;
    }
    const node = cells?.current[index];
    if (!node) {
      fade();
      return;
    }
    measureNode(node, (thumbnail) => {
      const inView = thumbnail.y + thumbnail.height > 0 && thumbnail.y < screen.height && thumbnail.width > 0;
      if (!inView || !area.current) {
        fade();
        return;
      }
      const to = towards(thumbnail, area.current, ratio);
      stage.value = withTiming(0, motion.timing("easeOut", 150));
      chrome.value = withTiming(0, motion.timing("easeOut", 150));
      x.value = withSpring(to.x, motion.spring("springRelease"));
      scale.value = withSpring(to.scale, motion.spring("springRelease"));
      y.value = withSpring(to.y, motion.spring("springRelease", velocity), leave);
    });
  };

  // The drag: vertical to dismiss; on touch, horizontal to page.
  const axis = useRef<"x" | "y" | null>(null);
  const past = useRef(false);
  const settle = (vx: number, vy: number) => {
    if (still.current || motion.reduced) {
      x.value = withTiming(0, motion.timing("fade"));
      y.value = withTiming(0, motion.timing("fade"));
      return;
    }
    x.value = withSpring(0, motion.spring("springRelease", vx));
    y.value = withSpring(0, motion.spring("springRelease", vy));
    scale.value = withSpring(1, motion.spring("springRelease"));
    stage.value = withTiming(1, motion.timing("easeOut", 150));
    chrome.value = withTiming(1, motion.timing("easeOut", 150));
  };
  const page = (by: number, vx: number) => {
    const width = area.current?.width ?? screen.width;
    const next = (index + by + media.length) % media.length;
    if (still.current || motion.reduced) {
      x.value = 0;
      onIndex(next);
      return;
    }
    // Out along the swipe, then the neighbour in from the other side.
    const arrive = () => {
      onIndex(next);
      x.value = by * width;
      x.value = withSpring(0, motion.spring("springRelease"));
    };
    x.value = withSpring(-by * width, motion.spring("springRelease", vx), (finished) => {
      "worklet";
      if (finished) runOnJS(arrive)();
    });
  };
  const drag: DragHandlers = {
    onStart: (along, touch) => {
      if (closing.current) return false;
      if (along === "x" && !(touch && many)) return false;
      axis.current = along;
      past.current = false;
      cancelAnimation(x);
      cancelAnimation(y);
      return true;
    },
    onMove: (dx, dy) => {
      if (axis.current === "x") {
        x.value = dx;
        return;
      }
      x.value = dx;
      y.value = dy;
      if (!(still.current || motion.reduced)) {
        const half = Math.max(1, screen.height / 2);
        const share = Math.min(1, Math.abs(dy) / half);
        scale.value = 1 - 0.15 * share;
        stage.value = 1 - (1 - DRAGGED_ALPHA / STAGE_ALPHA) * share;
        chrome.value = 1 - Math.min(1, share * 2);
      }
      const over = Math.abs(dy) > CLOSE_DISTANCE;
      if (over !== past.current) {
        past.current = over;
        if (over) haptic("threshold");
      }
    },
    onEnd: (dx, dy, vx, vy) => {
      if (axis.current === "x") {
        const width = area.current?.width ?? screen.width;
        const end = projectedEnd(dx, vx);
        if (Math.abs(end) > width / 3) page(end < 0 ? 1 : -1, vx);
        else settle(vx, 0);
        return;
      }
      if (Math.abs(projectedEnd(dy, vy)) > CLOSE_DISTANCE || vy > 200) close(vy);
      else settle(vx, vy);
    },
  };

  const stageStyle = useAnimatedStyle(() => ({ backgroundColor: `rgba(0, 0, 0, ${STAGE_ALPHA * stage.value})`, opacity: whole.value }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const imageStyle = useAnimatedStyle(() => ({ opacity: ready.value, transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  const named = [many ? countId : null, isHiddenMedia(item) ? null : altId].filter((part) => part !== null).join(" ");

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} aria-labelledby={named}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <MediaViewerContent
          media={media}
          index={index}
          onIndex={onIndex}
          onClose={() => close()}
          postId={postId}
          own={own}
          stageStyle={stageStyle}
          chromeStyle={chromeStyle}
          imageStyle={imageStyle}
          drag={drag}
          onArea={onArea}
          countId={countId}
          altId={altId}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}
```

### Replace `apps/app/src/components/social/PostCard.tsx` (whole file)

```tsx
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, Text as Inline, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { ErrorText, VerifiedChip } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { IconButton, type IconButtonFeedback } from "@/components/kit/IconButton";
import { FOCUS_RING, pressDelay } from "@/components/kit/interaction";
import { Menu, type MenuItem } from "@/components/kit/Menu";
import { StatusChip, type StatusTone } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { VISUALLY_HIDDEN, VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { useHaptics } from "@/lib/haptics";
import { chipText } from "@/lib/moderation";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { useMotion } from "@/lib/motion";
import { countLabel, deleteWithLeave, failedWords, shownCount, threadStats, toggleEngagement, type ToggleKind } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social } from "@/lib/social";
import { fullDate, postedWhen, timeAgo } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { MediaGrid } from "./MediaGrid";
import { PostMenu } from "./PostMenu";
import { RichText } from "./RichText";

/**
 * A link inside a line of text (the author line, the repost line, the reply context): inline, so a phone holds it to
 * WCAG 2.5.8's 24 px rather than a control's 44, and padded to reach it, which does not move the line.
 */
const INLINE_LINK = cn("rounded-sm py-1.5 web:hover:underline", FOCUS_RING);

/**
 * Who wrote the post and when (UI design, section 6.6): the display name in body-strong as the link to the profile, the
 * verified chip, the handle in the mono face, and the time as the post's one link. The time shows its short form ("3h"),
 * hidden from the link's name, which says it inside postedWhen's words ("3h ago, open the post"), so the name contains
 * the visible label. The thread's focused post shows the full date instead.
 */
function AuthorLine({ author, createdAt, postId, large = false }: { author: Author; createdAt: string; postId: string; large?: boolean }) {
  const shown = large ? fullDate(createdAt) : timeAgo(createdAt);
  const when = large ? fill(UI_WORDS["time.posted.on"], { date: shown }) : postedWhen(createdAt);
  return (
    <View className="flex-row flex-wrap items-center gap-x-1.5">
      <Text variant="body-strong">
        <Link href={`/u/${author.handle}`} asChild>
          <Inline className={INLINE_LINK}>{author.displayName}</Inline>
        </Link>
      </Text>
      {author.verified ? <VerifiedChip /> : null}
      <Text variant="mono" tone="low">
        @{author.handle}
      </Text>
      <Text variant="meta" tone="low">
        <Link href={`/post/${postId}`} asChild>
          <Inline className={cn(INLINE_LINK, "px-1.5")}>
            <Inline aria-hidden>{shown}</Inline>
            <VisuallyHidden>{fill(UI_WORDS["post.open"], { when })}</VisuallyHidden>
          </Inline>
        </Link>
      </Text>
    </View>
  );
}

/** The repost line above a reposted post: the repost icon, and "Ben reposted" with Ben's name a link to his profile. */
function RepostLine({ by }: { by: Author }) {
  const [before, after] = UI_WORDS["post.reposted"].split("{displayName}");
  return (
    <View className="mb-1 flex-row items-center gap-2 pl-6">
      <Icon name="repost" size={16} tone="low" />
      <Text variant="meta" tone="low" className="shrink">
        {before}
        <Link href={`/u/${by.handle}`} asChild>
          <Inline className={cn(INLINE_LINK, "text-ink-medium")}>{by.displayName}</Inline>
        </Link>
        {after}
      </Text>
    </View>
  );
}

/** A quoted post that is gone: its sentence in the text face's italic, on surface-2 (section 8.3). */
function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-media bg-surface-2 px-3 py-2.5">
      <Text tone="medium" italic>
        {tombstone.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
      </Text>
    </View>
  );
}

/** What a press on a card's empty space must leave alone: its links and controls, which act for themselves. */
const CONTROL = "a, button, input, textarea, select, [role=button], [role=link], [role=dialog], [role=switch]";

/**
 * The open target of a card's body for pointers on the web (section 6.6): a click on the card that is not on one of its
 * links or controls, and that does not end a text selection, opens `href`. A click from a menu or sheet the card opened
 * reaches this handler through React's portal, but is not inside the card's own element, so it is left alone.
 */
function opensOnClick(open: () => void) {
  return (event: MouseEvent & { currentTarget: Element; target: Element }) => {
    const root = event.currentTarget;
    if (!root.contains(event.target)) return;
    const control = event.target.closest?.(CONTROL);
    if (control && root.contains(control)) return;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
    event.stopPropagation();
    open();
  };
}

/**
 * A quoted post (section 6.6): a bordered region with its own author line, whose time is the link to the quoted post,
 * so the quote has one open target too; its words are plain text, and its images open nothing, since they belong to the
 * quoted post, where the grid and the viewer are. A press on its empty space opens the quoted post.
 */
export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  const open = () => router.push(`/post/${quote.id}`);
  const content = (
    <>
      <AuthorLine author={quote.author} createdAt={quote.createdAt} postId={quote.id} />
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact postId={quote.id} />
    </>
  );
  if (Platform.OS !== "web") {
    return (
      <Pressable accessible={false} {...pressDelay(80)} onPress={open} className="mt-2 rounded-media border border-line-low px-3 py-2.5 active:bg-surface-2">
        {content}
      </Pressable>
    );
  }
  return (
    <View {...({ onClick: opensOnClick(open) } as object)} className="mt-2 rounded-media border border-line-low px-3 py-2.5 web:cursor-pointer web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]">
      {content}
    </View>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9; UI design, section 4.8). With the decision
 * behind the state it names the rule or says "illegal content", in the review tone while korbat decides and the
 * restricted tone once removed, and links to the decision's statement under Settings, Cases; Task 7 turns the link into
 * the button that opens the details sheet. A view without the decision's facts still says the state, and links nowhere.
 */
function StateChip({ post }: { post: PostView }) {
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";
  const words = decision ? chipText(decision) : tone === "review" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  return <StatusChip tone={tone} label={words} href={decision ? `/settings/cases/${decision.decisionId}` : undefined} />;
}

/**
 * The delete question's two controls, as the card's actions were before the icons: a word in a 44 px target, Delete in
 * the danger fill, Keep plain. While the request is out both are busy.
 */
function Action({ label, tone = "plain", busy, onPress, ref }: { label: string; tone?: "danger" | "plain"; busy?: boolean; onPress: () => void; ref?: Ref<View> }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      {...pressDelay(0)}
      className={cn(
        "min-h-[44px] items-center justify-center rounded-control border px-4",
        tone === "danger" ? "border-danger bg-danger web:hover:bg-danger/90" : "border-line-high bg-surface-1 web:hover:bg-surface-2",
        FOCUS_RING,
      )}
    >
      <Text variant="body-strong" tone={tone === "danger" ? "on-danger" : "high"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Delete this post?" in place of the action row (section 6.6), with Delete and Keep. Keep, the safe answer, takes the
 * focus when the question shows; the card gives it back to More when the question is withdrawn.
 */
export function DeleteQuestion({ postId, busy, onDelete, onKeep, keepRef }: { postId: string; busy: boolean; onDelete: () => void; onKeep: () => void; keepRef?: Ref<View> }) {
  return (
    <View role="dialog" aria-labelledby={`delete-${postId}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-card border border-line-high bg-surface-1 px-3 py-2 web:forced-colors:border-[color:CanvasText]">
      <Text nativeID={`delete-${postId}`} variant="body-strong" className="mr-auto">
        {UI_WORDS["post.deleteQuestion"]}
      </Text>
      <Action label={UI_WORDS["post.delete"]} tone="danger" busy={busy} onPress={onDelete} />
      <Action ref={keepRef} label="Keep" busy={busy} onPress={onKeep} />
    </View>
  );
}

/**
 * The Repost menu's items (decision 12): Repost, or Undo repost once reposted, and Quote, a real link to the post's
 * quote composer as today (`?quote=1`), or to sign in for a reader who is signed out.
 */
export function repostMenuItems(post: PostView, signedIn: boolean, onRepost: () => void): MenuItem[] {
  return [
    { label: post.viewer?.reposted ? UI_WORDS["post.unrepost"] : UI_WORDS["post.repost"], icon: "repost", onSelect: onRepost },
    { label: UI_WORDS["post.quote"], icon: "quote", href: signedIn ? `/post/${post.id}?quote=1` : "/signin" },
  ];
}

const NO_VIEWER = { liked: false, reposted: false, bookmarked: false };

/** How long an action's request may be out before its control says it is busy (section 5.2, pending). */
const PENDING_MS = 400;

/**
 * One post in any list (UI design, section 6.6): an article named by its author line, with one explicit link to the post
 * in its time, and for pointers the whole card body as the open target. Reply, Repost (a menu: Repost or Undo repost, and
 * Quote), Like and Save act at once: the state, the icon and the count change on the press, with its haptic and its
 * motion, the request goes out in its kind's lane, and the server's answer replaces the counts, so they never drift; a
 * refusal puts the old state back, nudges the control and says so in a toast, and a write refused for a suspension shows
 * the standing's sentence under the card (3e, 9.4). A signed-out reader is sent to sign in on the first action. More
 * holds Who sees this, Copy link, Delete for the author and Report for everyone else.
 *
 * Below 768 px the images and the quoted post span the card's inner width, from the avatar's edge to the gutter; wider
 * they keep the content column's indent. `large` is the thread's focused post: its words at 19 / 28, the full date and
 * time, and the stats line above the actions (post/[id].tsx passes it in Task 5).
 */
export function PostCard({ post: initial, repostedBy, onDeleted, large = false }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void; large?: boolean }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const { hideCounts } = useAppearance();
  const phone = useLayout() === "phone";
  const motion = useMotion();
  const haptic = useHaptics();
  const labelId = useId();
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // 3e (design, section 9.4): an action refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<ToggleKind | "delete", boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<ToggleKind, IconButtonFeedback>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [washed, setWashed] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const moreRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The action row, More with it, leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and More takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) moreRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  const own = post.author.id === me;
  const viewer = post.viewer ?? NO_VIEWER;
  const openPost = () => router.push(`/post/${post.id}`);

  /** Marks a kind busy if its request is still out after 400 ms, and returns the function that ends it. */
  const pending = (kind: ToggleKind | "delete") => {
    const timer = setTimeout(() => setBusy((current) => ({ ...current, [kind]: true })), PENDING_MS);
    return () => {
      clearTimeout(timer);
      setBusy((current) => ({ ...current, [kind]: false }));
    };
  };
  const play = (kind: ToggleKind, next: Omit<IconButtonFeedback, "at">) => setFeedback((current) => ({ ...current, [kind]: { ...next, at: (current[kind]?.at ?? 0) + 1 } }));

  function toggle(kind: ToggleKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    // A second tap while this kind's request is out is not sent (lib/social.ts, lanes), and changes nothing on screen.
    if (lanes.busy(laneKey.post(post.id, kind))) return;
    const moves = kind !== "bookmark";
    const done = pending(kind);
    void toggleEngagement(social, lanes, post, kind, setPost, (on) => {
      // Touch and sight on the same frame: the haptic before the state changes, the motion with it.
      haptic(on ? "toggleOn" : "toggleOff");
      play(kind, { turn: on ? "on" : "off", pop: kind === "like" ? "springLike" : "springToggle", count: moves ? (on ? 1 : -1) : 0 });
    }).then((result) => {
      done();
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        // Saved: a polite toast says it worked, with the way to the saved posts; unsaving says nothing.
        if (kind === "bookmark" && result.on) toast.show({ message: UI_WORDS["toast.saved"], action: { label: UI_WORDS["toast.view"], onPress: () => router.push("/bookmarks") } });
        return;
      }
      const err = result.error;
      haptic("error");
      play(kind, { turn: "back", count: moves ? (result.on ? -1 : 1) : 0 });
      // A suspension is said under the card in the standing's words; trying again would not help, so no toast says to.
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: failedWords(kind, result.on), tone: "rollback" });
    });
  }

  // The card fades (post-removed, 150 ms; at once under reduced motion) before its list lets it go.
  const opacity = useSharedValue(1);
  const leave = () =>
    new Promise<void>((resolve) => {
      if (motion.reduced) {
        resolve();
        return;
      }
      opacity.value = withTiming(0, motion.timing("easeOut", 150), (finished) => {
        "worklet";
        if (finished) runOnJS(resolve)();
      });
    });
  const removedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  function remove() {
    const done = pending("delete");
    void deleteWithLeave(social, lanes, post.id, leave).then((result) => {
      done();
      if (result.status === "deleted") {
        onDeleted?.(post.id);
        return;
      }
      if (result.status === "refused") {
        const err = result.error;
        setRefused(isSuspendedRefusal(err));
        setError(isSuspendedRefusal(err) ? null : errorMessage(err));
      }
    });
  }

  // The press wash of the card's body (section 5.1): after 80 ms, gone again on 10 px of movement, so a scroll never flashes it.
  const wash = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const unwash = () => {
    if (wash.current) clearTimeout(wash.current.timer);
    wash.current = null;
    setWashed(false);
  };
  const webPress =
    Platform.OS === "web"
      ? {
          onClick: opensOnClick(openPost),
          onPointerDown: (event: PointerEvent & { target: Element; currentTarget: Element }) => {
            const control = event.target.closest?.(CONTROL);
            if (control && event.currentTarget.contains(control)) return;
            unwash();
            wash.current = { timer: setTimeout(() => setWashed(true), 80), x: event.clientX, y: event.clientY };
          },
          onPointerMove: (event: PointerEvent) => {
            if (wash.current && Math.hypot(event.clientX - wash.current.x, event.clientY - wash.current.y) > 10) unwash();
          },
          onPointerUp: unwash,
          onPointerCancel: unwash,
          onPointerLeave: unwash,
        }
      : {};

  const media = <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />;
  const quote = post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null;
  const stats = large ? threadStats(post.counts, hideCounts) : "";
  const when = postedWhen(post.createdAt);

  const actions = (
    // It wraps rather than cutting More off at the largest text on the narrowest phone.
    <View className="-ml-2.5 mt-1 flex-row flex-wrap items-center">
      <IconButton icon="reply" label={countLabel("reply", post.counts.replies, hideCounts)} count={shownCount("reply", post.counts.replies, hideCounts)} onPress={openPost} />
      <Menu
        label={countLabel("repost", post.counts.reposts, hideCounts)}
        title={UI_WORDS["post.repost"]}
        icon="repost"
        items={repostMenuItems(post, me !== null, () => toggle("repost"))}
        trigger={{ pressed: viewer.reposted, disc: viewer.reposted, tone: viewer.reposted ? "accent" : "low", count: shownCount("repost", post.counts.reposts, hideCounts), busy: busy.repost === true, feedback: feedback.repost }}
      />
      <IconButton
        icon="like"
        label={countLabel("like", post.counts.likes, hideCounts)}
        count={shownCount("like", post.counts.likes, hideCounts)}
        pressed={viewer.liked}
        filled={viewer.liked}
        busy={busy.like === true}
        feedback={feedback.like}
        onPress={() => toggle("like")}
      />
      <IconButton
        icon="bookmarks"
        label={viewer.bookmarked ? UI_WORDS["post.saved"] : UI_WORDS["post.save"]}
        tone={viewer.bookmarked ? "accent" : "low"}
        filled={viewer.bookmarked}
        busy={busy.bookmark === true}
        feedback={feedback.bookmark}
        onPress={() => toggle("bookmark")}
      />
      <View className="flex-1" />
      <PostMenu post={post} onDelete={() => setConfirmingDelete(true)} triggerRef={moreRef} />
    </View>
  );

  const content: ReactNode = (
    <>
      {repostedBy ? <RepostLine by={repostedBy} /> : null}
      <View className="flex-row gap-2">
        {/* The avatar opens the profile too, but the name is the one keyboard and screen-reader target. */}
        <Link href={`/u/${post.author.handle}`} asChild>
          <Pressable tabIndex={-1} aria-hidden className="h-11 w-11 items-center justify-center rounded-full">
            <Avatar account={post.author} size={40} />
          </Pressable>
        </Link>
        <View className="min-w-0 flex-1">
          <AuthorLine author={post.author} createdAt={post.createdAt} postId={post.id} large={large} />
          {own && (post.state !== "visible" || post.inExplore) ? (
            <View className="flex-row flex-wrap gap-x-2">
              <StateChip post={post} />
              {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
              {post.inExplore ? <StatusChip tone="explore" label={UI_WORDS["post.inExplore"]} href={`/post/${post.id}`} /> : null}
            </View>
          ) : null}
          {post.replyTo ? (
            <Text variant="meta" tone="low">
              {post.replyTo.authorHandle ? UI_WORDS["post.replyingTo"] : UI_WORDS["post.replyingHidden"]}
              {post.replyTo.authorHandle ? (
                <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
                  <Inline className={cn(INLINE_LINK, "text-accent-ink")}>@{post.replyTo.authorHandle}</Inline>
                </Link>
              ) : null}
            </Text>
          ) : null}
          {/* A post may consist of images only, and then there is no text. */}
          {post.body ? (
            <View className="mt-1.5">
              <RichText body={post.body} variant={large ? "post-large" : "post"} />
            </View>
          ) : null}
          {phone ? null : media}
          {phone ? null : quote}
        </View>
      </View>
      {phone ? media : null}
      {phone ? quote : null}
      {/* The stats, the actions and what they answer keep the content column's indent at every width. */}
      <View className="pl-[52px]">
        {stats ? (
          <Text variant="meta" tone="medium" className="mt-3">
            {stats}
          </Text>
        ) : null}
        {confirmingDelete ? (
          <DeleteQuestion postId={post.id} busy={busy.delete === true} onDelete={remove} onKeep={() => setConfirmingDelete(false)} keepRef={keepRef} />
        ) : (
          actions
        )}
        <ErrorText message={error} />
        {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
      </View>
    </>
  );

  return (
    <Animated.View style={removedStyle}>
      <View role="article" aria-labelledby={labelId} {...(webPress as object)} className={cn("border-b border-line-low px-4 py-3 web:transition-colors web:duration-[120ms]", washed ? "bg-surface-2" : "")}>
        {/* The article's name, the author line as a screen reader should hear it; hidden, and named only through aria-labelledby. */}
        <Text nativeID={labelId} aria-hidden style={VISUALLY_HIDDEN}>
          {fill(UI_WORDS["post.label"], { name: post.author.displayName, handle: post.author.handle, when })}
        </Text>
        {Platform.OS === "web" ? (
          content
        ) : (
          // On native the body is one Pressable that the accessibility tree does not see: the time's link does its job there.
          <Pressable accessible={false} {...pressDelay(80)} onPress={openPost} className="-mx-4 -my-3 px-4 py-3 active:bg-surface-2">
            {content}
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
```

### Replace `apps/app/src/components/social/ProfileList.tsx` (whole file)

```tsx
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link } from "expo-router";
import type { ProfileListItem } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { LABEL_TONE, VerifiedChip, buttonFace } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { useHaptics } from "@/lib/haptics";
import { useMotion, usePressScale } from "@/lib/motion";
import { followFailedWords, toggleFollow } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { PagedList } from "./PagedList";

/**
 * One account in a list of followers or followings (UI design, sections 6.5, 6.11 and 8.4): the monogram, the display
 * name with the verified chip, the handle in the mono face and the bio, together one link to the profile, and the row's
 * action (FollowButton) beside it. Task 5 moves it onto ListRow.
 */
export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-line-low px-4 py-3">
      <Link href={`/u/${item.handle}`} asChild>
        <Pressable className={cn("min-h-[44px] flex-1 flex-row items-center gap-3 rounded-control web:hover:bg-surface-2", FOCUS_RING)}>
          <Avatar account={item} size={40} />
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-x-1.5">
              <Text variant="body-strong" className="shrink">
                {item.displayName}
              </Text>
              {item.verified ? <VerifiedChip /> : null}
            </View>
            <Text variant="mono" tone="low">
              @{item.handle}
            </Text>
            {item.bio ? (
              <Text tone="medium" numberOfLines={2} className="mt-0.5">
                {item.bio}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Link>
      {action}
    </View>
  );
}

/**
 * Follow or unfollow one account (section 8.4), with its words and states as they were: "Follow" as a primary button
 * while the reader does not follow, "Following" as a secondary one while they do. It is optimistic as the post's actions
 * are: the label changes at once with its haptic, the new label fading in over 160 ms (reduced, at once), and the
 * request goes out in the account's own lane, so a second tap meanwhile is not sent; the answer's state and follower
 * count are handed to `onChange`, and a refusal puts the old label back with the error haptic and a toast, or, for a
 * suspension, the standing's sentence under the button (3e, 9.4).
 */
export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const { state } = useSession();
  const motion = useMotion();
  const haptic = useHaptics();
  const press = usePressScale(0.97);
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const label = useSharedValue(1);
  const shownAt = useRef(following);
  useEffect(() => {
    if (shownAt.current === following) return;
    shownAt.current = following;
    if (motion.reduced) return;
    label.value = 0;
    label.value = withTiming(1, motion.timing("easeOut", 160));
  }, [following]);
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.value }));

  function toggle() {
    if (lanes.busy(laneKey.follow(handle))) return;
    haptic(following ? "toggleOff" : "toggleOn");
    const timer = setTimeout(() => setBusy(true), 400);
    void toggleFollow(social, lanes, handle, following, setFollowing).then((result) => {
      clearTimeout(timer);
      setBusy(false);
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        onChange?.(result.answer.following, result.answer.followerCount);
        return;
      }
      const err = result.error;
      haptic("error");
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: followFailedWords(handle, result.on), tone: "rollback" });
    });
  }

  const face = following ? "secondary" : "primary";
  return (
    <View {...dataAttribute("follow")} className="items-end">
      <Animated.View style={press.style}>
        <Pressable accessibilityRole="button" aria-busy={busy} onPress={toggle} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
          <Animated.View style={labelStyle}>
            <Text variant="body-strong" tone={LABEL_TONE[face]}>
              {following ? UI_WORDS["follow.following"] : UI_WORDS["follow.follow"]}
            </Text>
          </Animated.View>
        </Pressable>
      </Animated.View>
      {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
    </View>
  );
}

export function ProfileList({
  fetchPage,
  empty,
  header,
  action,
}: {
  fetchPage: (cursor?: string) => Promise<Page<ProfileListItem>>;
  empty: string;
  header?: ReactElement;
  action?: (item: ProfileListItem, remove: () => void) => ReactElement | undefined;
}) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={(item) => item.id}
      empty={empty}
      header={header}
      render={(item, remove) => <ProfileRow item={item} action={action?.(item, () => remove(item.id))} />}
    />
  );
}
```

### Replace `apps/app/src/components/social/RichText.tsx` (whole file)

```tsx
import { Linking, Platform, Text as Inline } from "react-native";
import { Link } from "expo-router";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text, type TextVariant } from "@/components/kit/Text";
import { externalLink } from "@/lib/links";

/** Links and @handles become real links; everything else is plain text. Bodies are never rendered as markup. */
const TOKEN = /(https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;

/**
 * A link inside running text (UI design, sections 4.4 and 6.6): accent-ink, which against the body's ink is under 3:1, so
 * a web link is also underlined, 1 px at a 2 px offset, thicker under a fine pointer; a mention keeps its "@" as its cue.
 * Its padding makes it at least 24 px tall (WCAG 2.5.8's inline target) without moving the line, since padding on an
 * inline box does not change the line's height.
 */
const INLINE = `rounded-sm py-1 ${FOCUS_RING}`;
const UNDERLINED = "underline decoration-1 underline-offset-2 web:hover:decoration-2";

/**
 * A post's words (or a quoted post's, in the body variant), with its links and mentions as real anchors. The pieces are
 * React Native's own Text inside the kit's, so they take its face, size and step and change only their colour.
 */
export function RichText({ body, variant = "post" }: { body: string; variant?: TextVariant }) {
  const parts = body.split(TOKEN);
  return (
    <Text variant={variant}>
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <Inline key={index} className={`text-accent-ink ${UNDERLINED} ${INLINE}`} {...externalLink(part)} onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(part)}>
              {part}
            </Inline>
          );
        }
        if (/^@[A-Za-z0-9_]{3,20}$/.test(part)) {
          return (
            <Link key={index} href={`/u/${part.slice(1).toLowerCase()}`} asChild>
              <Inline className={`text-accent-ink web:hover:underline ${INLINE}`}>{part}</Inline>
            </Link>
          );
        }
        return <Inline key={index}>{part}</Inline>;
      })}
    </Text>
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

### Replace `apps/app/src/lib/motion.ts` (whole file)

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

/**
 * The pops of a toggle the reader turns on (section 5.2's like, repost and save rows), released from the pressed scale
 * 0.92 with an initial velocity in scale units per second: Like underdamped to a peak near 1.15, Repost and Save a little
 * firmer, near 1.12. `response` is the undamped period in seconds, as Apple's springs give it. They sit here rather than
 * in theme/motion.ts, whose table is section 5.1's six values.
 */
export const POPS = {
  springLike: { dampingRatio: 0.5, response: 0.22, velocity: 10 },
  springToggle: { dampingRatio: 0.6, response: 0.25, velocity: 8 },
} as const;

export type PopName = keyof typeof POPS;

export interface Motion {
  reduced: boolean;
  /** `velocity` is a released gesture's, in the animated value's units per second (sheets, the lightbox). */
  spring(name: SpringName, velocity?: number): WithSpringConfig;
  timing(name: TimingName, duration?: number): WithTimingConfig;
  pop(name: PopName): WithSpringConfig;
}

/**
 * A pop as a physical spring: Apple's damping ratio and response (the undamped period) turned into Reanimated's stiffness
 * and damping for a mass of 1, with the pop's initial velocity, so Like peaks near 1.15 from 0.92 and settles in about
 * 370 ms. Under reduced motion no component starts one (the toggle cross-fades instead); one started anyway lands at once.
 */
export function popSpring(name: PopName, reduced: boolean): WithSpringConfig {
  const { dampingRatio, response, velocity } = POPS[name];
  const omega = (2 * Math.PI) / response;
  return { mass: 1, stiffness: omega * omega, damping: 2 * dampingRatio * omega, velocity, reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never };
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
      spring: (name, velocity) => ({
        dampingRatio: MOTION[name].dampingRatio,
        duration: MOTION[name].duration,
        ...(velocity === undefined ? {} : { velocity }),
        reduceMotion: reduced ? ReduceMotion.Always : ReduceMotion.Never,
      }),
      timing: (name, duration) => ({ duration: duration ?? TIMINGS[name].duration, easing: bezier(TIMINGS[name].easing), reduceMotion: ReduceMotion.Never }),
      pop: (name) => popSpring(name, reduced),
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
  // `value` is the scale itself, for a control whose release turns into a pop from where the press left it (section 5.2).
  return { style, handlers: { onPressIn, onPressOut }, value };
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

/**
 * The maths of a released drag (section 5.2, after Apple's fluid interfaces). Past its edge an element resists more the
 * further it is pulled (rubber-banding: overshoot x size x 0.55 / (size + 0.55 x overshoot)); a release is judged by
 * where its momentum would carry it, as a scroll decelerates (current + v/1000 x 0.998/0.002), not by where the finger
 * let go, so a flick closes what a slow drag of the same length does not.
 */
export function rubberBand(overshoot: number, size: number, constant = 0.55): number {
  if (size <= 0) return 0;
  return (overshoot * size * constant) / (size + constant * Math.abs(overshoot));
}

export function projectedEnd(position: number, velocity: number, deceleration = 0.998): number {
  return position + (velocity / 1000) * (deceleration / (1 - deceleration));
}

/** A sheet's release closes it when its projected end passes half its height, or it moves down faster than 200 px/s. */
export function releaseCloses(position: number, velocity: number, height: number): boolean {
  return projectedEnd(position, velocity) > height / 2 || velocity > 200;
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

/**
 * Request lanes (UI design, section 6.6): each toggle of each post, and each account's follow, has a lane of its own,
 * keyed by the post or the handle and the kind. Kinds run side by side, so a like and a save can be in flight together;
 * a second tap of a kind whose request is still out is not sent at all, so a double tap cannot undo itself, and the card
 * leaves its state as the first tap set it. A lane answers what became of its request instead of throwing, so the caller
 * decides how to roll back.
 */
export type LaneOutcome<T> = { status: "busy" } | { status: "answered"; answer: T } | { status: "refused"; error: unknown };

export interface Lanes {
  busy(key: string): boolean;
  run<T>(key: string, request: () => Promise<T>): Promise<LaneOutcome<T>>;
}

export function createLanes(): Lanes {
  const out = new Set<string>();
  return {
    busy: (key) => out.has(key),
    async run<T>(key: string, request: () => Promise<T>): Promise<LaneOutcome<T>> {
      if (out.has(key)) return { status: "busy" };
      out.add(key);
      try {
        return { status: "answered", answer: await request() };
      } catch (error) {
        return { status: "refused", error };
      } finally {
        out.delete(key);
      }
    },
  };
}

/** The app's one set of lanes, which every card and follow button shares: a post shown twice still has one like lane. */
export const lanes = createLanes();

export const laneKey = {
  post: (id: string, kind: EngagementKind | "delete") => `post:${id}:${kind}`,
  follow: (handle: string) => `follow:${handle.replace(/^@/, "").toLowerCase()}`,
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
  /** Toasts (5.4, 8.6); toast.sent.* comes with the composer in Task 6. */
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
  /** FollowButton (8.4), word for word as ProfileList.tsx had them. */
  "follow.follow": "Follow",
  "follow.following": "Following",
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

### Replace `apps/app/src/theme/ThemeProvider.tsx` (whole file)

```tsx
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Platform, View, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import { resolveTheme, useAppearance, type Appearance } from "@/lib/appearance";
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
 * What theme-boot.js did before the bundle, kept true as the reader changes their appearance or the system its scheme:
 * the theme's class on the html element (global.css switches the variables by it), the text step and font for the
 * stylesheet, the scheme for the browser's own controls, the page's colours under everything, and the theme-color meta.
 */
function applyToDocument(theme: Theme, appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
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
  useEffect(() => {
    if (Platform.OS === "web") applyToDocument(theme, appearance);
  }, [theme, appearance]);
  if (Platform.OS === "web") return <>{children}</>;
  return <View style={[{ flex: 1 }, scopeStyle(theme.name)]}>{children}</View>;
}
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
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  512 passed (512)
apps/admin test:       Tests  584 passed (584)
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

- `Tests  22 passed (22)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  22 passed (22)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/components/kit/DragArea.tsx`
- `apps/app/src/components/kit/DragArea.web.tsx`
- `apps/app/src/components/kit/IconButton.tsx`
- `apps/app/src/components/kit/Menu.tsx`
- `apps/app/src/components/kit/Sheet.tsx`
- `apps/app/src/components/kit/Text.tsx`
- `apps/app/src/components/kit/interaction.ts`
- `apps/app/src/components/kit/measure.ts`
- `apps/app/src/components/social/HiddenImage.tsx`
- `apps/app/src/components/social/ImageFault.tsx`
- `apps/app/src/components/social/MediaGrid.tsx`
- `apps/app/src/components/social/MediaViewer.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/PostMenu.tsx`
- `apps/app/src/components/social/ProfileList.tsx`
- `apps/app/src/components/social/RichText.tsx`
- `apps/app/src/components/social/WhoSeesThis.tsx`
- `apps/app/src/components/ui.tsx`
- `apps/app/src/lib/motion.ts`
- `apps/app/src/lib/post-actions.ts`
- `apps/app/src/lib/reach.ts`
- `apps/app/src/lib/social.ts`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/src/theme/ThemeProvider.tsx`
- `apps/app/test/a11y.test.tsx`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/cases.test.tsx`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/hidden-media.test.tsx`
- `apps/app/test/kit.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/post-card.test.tsx`
- `apps/app/test/reach.test.ts`
- `apps/app/test/report.test.tsx`
- `apps/app/test/theme.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(app): the post, its media and the lightbox: PostCard is an article named by its author line, with the time as its one link to the post (postedWhen's words in its name), the name and a hidden 44 px avatar as links to the profile, and the card body as a pointer's open target with an 80 ms press wash; Reply, Repost, Like and Save act at once in per-kind request lanes, Like popping on its spring with the accent ring, Repost and Save firmer, counts rolling, Repost's reposted disc, and a refusal rolled back with a nudge, the error haptic and a toast; kit/Sheet and kit/Menu (a bottom sheet or a centred dialog, a sheet or an anchored popover, focus in and back, arrow keys) carry More's Who sees this (reach() in lib/reach.ts), Copy link, Delete with its question and Report, and Repost's menu; MediaGrid, the lightbox on a forced Dark stage that grows from its thumbnail, drags to close and pages, the hidden-image placeholders, RichText and an optimistic FollowButton move onto the tokens; drags on the web run on pointer events, so gesture-handler stays out of the bundle; the browser check gains steps 18 to 22" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the post, its media and the lightbox: PostCard is an article named by its author line, with the time as its one link to the post (postedWhen's words in its name), the name and a hidden 44 px avatar as links to the profile, and the card body as a pointer's open target with an 80 ms press wash; Reply, Repost, Like and Save act at once in per-kind request lanes, Like popping on its spring with the accent ring, Repost and Save firmer, counts rolling, Repost's reposted disc, and a refusal rolled back with a nudge, the error haptic and a toast; kit/Sheet and kit/Menu (a bottom sheet or a centred dialog, a sheet or an anchored popover, focus in and back, arrow keys) carry More's Who sees this (reach() in lib/reach.ts), Copy link, Delete with its question and Report, and Repost's menu; MediaGrid, the lightbox on a forced Dark stage that grows from its thumbnail, drags to close and pages, the hidden-image placeholders, RichText and an optimistic FollowButton move onto the tokens; drags on the web run on pointer events, so gesture-handler stays out of the bundle; the browser check gains steps 18 to 22`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 36>
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
