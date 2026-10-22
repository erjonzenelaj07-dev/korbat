# korbat interface and experience (UI) — Task 6 of 10: The composer: section 6.15's parts on a pure reducer (ComposerField, ProgressRing, the image tray, SendBar and DiscardDialog) with drafts kept on the device (decision 18), section 8.6's sheet on kit/Sheet with its sent toast, Home's collapsed card (decision 19) and the thread's reply card (section 8.3), and New post on every screen (sections 7.2 and 7.3).

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-21 to 2026-10-22 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 6 of ten in korbat's UI sub-project (interface and experience), the end of the batch of Tasks 4 to 6, built from docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md on Tasks 1 to 5 (the tokens, the kit, the shell and its browser check, the post card with Sheet and Menu, the feeds and their lists). It follows sections 6.15 and 8.6 with decisions 18 and 19, section 5.2's composer-open and ring, 5.3's success and warning haptics, 5.4's toasts, 6.6's Reply and QuoteEmbed, 7.2 to 7.4, 8.2, 8.3 and 8.8's session end; Task 7 moves the moderation surfaces and the public pages onto the kit next.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): feeds, threads and profiles: every list scrolls through list/List.tsx, which owns FlatList's tuning, redraws a row only when its key or version changes and keeps the row on screen when rows are put above it (anchor.web.ts on the scroll node, maintainVisibleContentPosition on native), with the feed pattern (role feed, aria-posinset and aria-setsize, Page Down and Page Up) and the focus handed on after a delete; Home's Following and Latest are typed rows (lib/feed-rows.ts) that keep the reader's place on the device (lib/reading-place.ts), open there within the newest 100 under You were here, ask for new posts every 60 s while in view (lib/new-posts.ts) and count them in a pill that takes the reader to the oldest one, say You're all caught up, and come back across tabs without asking again (lib/feed-cache.ts); kit/Tabs; the thread opens on its large focused post with its chain above; the profile's header gains a More menu with Mute, Block and Report; account rows move onto ListRow and Explore onto List; the session's end clears the appearance and the places; the browser check gains steps 23 to 27`.

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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/06-the-composer.md 1
```

Expected: 9 lines starting with `wrote`, one for each file below.

### Create `apps/app/test/composer-state.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { POST_MAX_LENGTH } from "@korbat/contracts";
import { composerReducer, composerView, crossed, initialComposer, kindOf, ring, type ComposerState } from "../src/components/social/composer/state";
import type { ComposerImage } from "../src/components/social/useImageUploads";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * The composer's state (UI design, section 6.15, Task 6): one pure reducer holds the text, the images and where each
 * stands, whether the post is being sent, the server's refusal and the draft's key, and composerView() says what follows
 * from them: the length by the server's own normalisation, whether the post may go, the Post button's words (what is
 * missing first), the count's words and the ring. Every transition is here, so the parts that draw it need no state of
 * their own.
 */

const ELLIPSIS = String.fromCharCode(0x2026);
const POST = "00000000-0000-4000-8000-000000000101";

const image = (key: string, change: Partial<ComposerImage> = {}): ComposerImage => ({ key, previewUrl: `blob:${key}`, alt: "A heron on the canal", status: "ready", id: `00000000-0000-4000-8000-00000000070${key.length}`, error: null, ...change });

const typed = (text: string, state: ComposerState = initialComposer("post")) => composerReducer(state, { type: "type", text });

describe("the reducer", () => {
  test("starts from the draft's key and its kept text, empty and idle", () => {
    expect(initialComposer("post")).toEqual({ context: "post", text: "", images: [], busy: false, error: null });
    expect(initialComposer(`reply:${POST}`, "kept words")).toEqual({ context: `reply:${POST}`, text: "kept words", images: [], busy: false, error: null });
    expect(kindOf("post")).toBe("post");
    expect(kindOf(`reply:${POST}`)).toBe("reply");
    expect(kindOf(`quote:${POST}`)).toBe("quote");
  });

  test("type sets the text, and images replaces the images with where each stands", () => {
    const state = typed("Morning light");
    expect(state.text).toBe("Morning light");
    const withImages = composerReducer(state, { type: "images", images: [image("a")] });
    expect(withImages.images).toHaveLength(1);
    expect(withImages.text).toBe("Morning light");
    // Neither touches the draft's key.
    expect(withImages.context).toBe("post");
  });

  test("send starts sending only a post that may go, and clears the last refusal", () => {
    const ready = composerReducer(typed("Morning light"), { type: "failed", error: "korbat is busy." });
    const sending = composerReducer(ready, { type: "send" });
    expect(sending.busy).toBe(true);
    expect(sending.error).toBeNull();
    // A second press while it is out sends nothing more.
    expect(composerReducer(sending, { type: "send" })).toBe(sending);
    // Nothing to send, or too long: send changes nothing.
    const empty = initialComposer("post");
    expect(composerReducer(empty, { type: "send" })).toBe(empty);
    const long = typed("x".repeat(POST_MAX_LENGTH + 1));
    expect(composerReducer(long, { type: "send" })).toBe(long);
  });

  test("sent empties the composer and keeps its key; failed keeps the words and says why", () => {
    const sending = composerReducer(composerReducer(typed("Morning light"), { type: "images", images: [image("a")] }), { type: "send" });
    expect(composerReducer(sending, { type: "sent" })).toEqual({ context: "post", text: "", images: [], busy: false, error: null });
    const refused = composerReducer(sending, { type: "failed", error: "korbat is busy." });
    expect(refused).toMatchObject({ text: "Morning light", busy: false, error: "korbat is busy." });
    expect(refused.images).toHaveLength(1);
  });

  test("discard empties the composer at once, whatever it held", () => {
    const full = composerReducer(composerReducer(typed("Morning light"), { type: "images", images: [image("a")] }), { type: "failed", error: "no" });
    expect(composerReducer(full, { type: "discard" })).toEqual(initialComposer("post"));
  });
});

describe("what follows from it", () => {
  test("the length is the server's: normalised, so spaces at the ends do not count", () => {
    expect(composerView(typed("  hello  ")).length).toBe(5);
    expect(composerView(typed("")).hasContent).toBe(false);
    expect(composerView(typed("   ")).hasContent).toBe(false);
    expect(composerView(composerReducer(initialComposer("post"), { type: "images", images: [image("a")] })).hasContent).toBe(true);
  });

  test("the Post button says what the reader can act on first, and Posting... while it sends", () => {
    const view = (state: ComposerState) => composerView(state);
    expect(view(typed("hello")).button).toBe(UI_WORDS["composer.action.post"]);
    expect(view(typed("hello")).ready).toBe(true);
    expect(view(typed("hello", initialComposer(`reply:${POST}`))).button).toBe(UI_WORDS["composer.action.reply"]);
    expect(view(typed("hello", initialComposer(`quote:${POST}`))).button).toBe(UI_WORDS["composer.action.quote"]);
    const failed = composerReducer(typed("hello"), { type: "images", images: [image("a", { status: "failed" }), image("b", { alt: "" }), image("c", { status: "uploading" })] });
    expect(view(failed)).toMatchObject({ button: UI_WORDS["composer.missing.failed"], missing: UI_WORDS["composer.missing.failed"], ready: false });
    const refused = composerReducer(typed("hello"), { type: "images", images: [image("a", { status: "refused" })] });
    expect(view(refused).button).toBe(UI_WORDS["composer.missing.failed"]);
    const undescribed = composerReducer(typed("hello"), { type: "images", images: [image("b", { alt: "" }), image("c", { status: "processing" })] });
    expect(view(undescribed).button).toBe(UI_WORDS["composer.missing.undescribed"]);
    const waiting = composerReducer(typed("hello"), { type: "images", images: [image("c", { status: "uploading" })] });
    expect(view(waiting)).toMatchObject({ button: UI_WORDS["composer.missing.waiting"], ready: false });
    expect(view(composerReducer(typed("hello"), { type: "send" }))).toMatchObject({ button: UI_WORDS["composer.posting"], ready: false });
    // Too long: the button keeps its word and cannot be used; the ring says why.
    expect(view(typed("x".repeat(POST_MAX_LENGTH + 1)))).toMatchObject({ button: UI_WORDS["composer.action.post"], ready: false, missing: null });
    expect(view(typed(""))).toMatchObject({ ready: false, missing: null });
  });

  test("the words are the composer's own, word for word, with the real ellipsis", () => {
    expect(UI_WORDS["composer.missing.failed"]).toBe("Remove the failed image");
    expect(UI_WORDS["composer.missing.undescribed"]).toBe("Describe every image");
    expect(UI_WORDS["composer.missing.waiting"]).toBe(`Waiting for images${ELLIPSIS}`);
    expect(UI_WORDS["composer.posting"]).toBe(`Posting${ELLIPSIS}`);
    expect([UI_WORDS["composer.action.post"], UI_WORDS["composer.action.reply"], UI_WORDS["composer.action.quote"]]).toEqual(["Post", "Reply", "Quote"]);
    expect(UI_WORDS["composer.count"]).toBe("{n} of 1000 characters");
  });

  test("the count's words replace n/1000: {n} of 1000 characters", () => {
    expect(composerView(typed("hello")).count).toBe("5 of 1000 characters");
    expect(composerView(typed("")).count).toBe("0 of 1000 characters");
    expect(composerView(typed("x".repeat(1003))).count).toBe("1003 of 1000 characters");
  });

  test("the ring fills with the count, in the accent, review-ink from 900 and danger-ink past 1000, with the number when 100 or fewer remain", () => {
    expect(ring(0)).toEqual({ progress: 0, tone: "accent", number: null });
    expect(ring(500)).toEqual({ progress: 0.5, tone: "accent", number: null });
    expect(ring(899)).toMatchObject({ tone: "accent", number: null });
    expect(ring(900)).toEqual({ progress: 0.9, tone: "review-ink", number: "100" });
    expect(ring(988)).toMatchObject({ tone: "review-ink", number: "12" });
    expect(ring(1000)).toEqual({ progress: 1, tone: "review-ink", number: "0" });
    expect(ring(1003)).toEqual({ progress: 1, tone: "danger", number: "-3" });
    expect(composerView(typed("x".repeat(950))).ring).toEqual(ring(950));
  });

  test("the count is announced only when it crosses 900 or 1000, either way", () => {
    expect(crossed(899, 900)).toBe(true);
    expect(crossed(900, 899)).toBe(true);
    expect(crossed(1000, 1001)).toBe(true);
    expect(crossed(1001, 1000)).toBe(true);
    expect(crossed(850, 1100)).toBe(true);
    expect(crossed(10, 11)).toBe(false);
    expect(crossed(900, 950)).toBe(false);
    expect(crossed(1001, 1200)).toBe(false);
    expect(crossed(500, 500)).toBe(false);
  });
});
```

### Create `apps/app/test/composer.test.tsx`

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
      expect(anchors(nav).map((tag) => /href="([^"]*)"/.exec(tag)?.[1]), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
      const at = nav.indexOf('aria-label="New post"') >= 0 ? nav.indexOf('aria-label="New post"') : nav.lastIndexOf(">New post<");
      expect(at, kind).toBeGreaterThan(nav.lastIndexOf('href="/settings/security"'));
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

### Create `apps/app/test/drafts.test.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearDrafts, createDraftKeeper, DRAFT_PREFIX, DRAFT_SAVE_MS, draftContext, draftKey, draftsStored, readDraft, removeDraft, writeDraft } from "../src/lib/drafts";
import { writePlace } from "../src/lib/reading-place";
import { clearSessionTraces, sessionEnded, tracesStored } from "../src/lib/session-end";
import { sourceFiles } from "./legacy-files";

/**
 * Drafts on the device (UI design, decision 18, sections 6.15 and 8.8; Task 6): the composer keeps its text, never its
 * images, in this browser's storage under korbat.drafts.<accountId>, one entry per context (a new post, a reply to a
 * post, a quote of a post), written 500 ms after typing stops, removed when the post is sent or the draft discarded,
 * kept in memory where there is no browser storage (native until sub-project 5), and every one of them, whatever the
 * account, removed when the session ends.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** localStorage as far as the stores use it, keys in the order they were set. */
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

const globals = globalThis as { localStorage?: unknown };
let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  globals.localStorage = storage;
});

afterEach(() => {
  vi.useRealTimers();
  clearDrafts();
  delete globals.localStorage;
});

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";
const POST = "00000000-0000-4000-8000-000000000101";

describe("the store", () => {
  test("one key per account, one entry per context: a new post, a reply to a post, a quote of a post", () => {
    expect(DRAFT_PREFIX).toBe("korbat.drafts.");
    expect(draftKey(ADA)).toBe(`korbat.drafts.${ADA}`);
    expect(draftContext()).toBe("post");
    expect(draftContext(POST)).toBe(`reply:${POST}`);
    expect(draftContext(undefined, POST)).toBe(`quote:${POST}`);
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, `reply:${POST}`, "Lovely");
    writeDraft(GRACE, "post", "Compilers");
    expect(readDraft(ADA, "post")).toBe("Morning light");
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
    expect(readDraft(ADA, `quote:${POST}`)).toBe("");
    expect(readDraft(GRACE, "post")).toBe("Compilers");
    expect(JSON.parse(storage.items.get(draftKey(ADA))!)).toEqual({ post: "Morning light", [`reply:${POST}`]: "Lovely" });
  });

  test("a blank draft is no draft, and removing the last one removes the account's key", () => {
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, "post", "   ");
    expect(storage.items.has(draftKey(ADA))).toBe(false);
    writeDraft(ADA, "post", "Morning light");
    writeDraft(ADA, `quote:${POST}`, "Look");
    removeDraft(ADA, "post");
    expect(readDraft(ADA, "post")).toBe("");
    expect(readDraft(ADA, `quote:${POST}`)).toBe("Look");
    removeDraft(ADA, `quote:${POST}`);
    expect([...storage.items.keys()]).toEqual([]);
  });

  test("a damaged record reads as no draft, and storage that throws loses nothing but the draft", () => {
    storage.items.set(draftKey(ADA), "{not json");
    expect(readDraft(ADA, "post")).toBe("");
    storage.items.set(draftKey(ADA), JSON.stringify({ post: 7 }));
    expect(readDraft(ADA, "post")).toBe("");
    globals.localStorage = {
      get length() {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeDraft(ADA, "post", "x")).not.toThrow();
    expect(() => readDraft(ADA, "post")).not.toThrow();
    expect(() => clearDrafts()).not.toThrow();
  });

  test("without browser storage (native until sub-project 5) drafts live in memory for the session", () => {
    delete globals.localStorage;
    writeDraft(ADA, "post", "In memory");
    expect(readDraft(ADA, "post")).toBe("In memory");
    expect(draftsStored()).toBe(true);
    clearDrafts();
    expect(readDraft(ADA, "post")).toBe("");
    expect(draftsStored()).toBe(false);
  });
});

describe("the keeper of one composer", () => {
  test("written 500 ms after typing stops, not before, and only the last words", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, "post");
    keeper.typed("Mor");
    vi.advanceTimersByTime(300);
    keeper.typed("Morning");
    vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
    expect(readDraft(ADA, "post")).toBe("");
    vi.advanceTimersByTime(1);
    expect(DRAFT_SAVE_MS).toBe(500);
    expect(readDraft(ADA, "post")).toBe("Morning");
    keeper.dispose();
  });

  test("leaving writes what is waiting at once", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, `reply:${POST}`);
    keeper.typed("Lovely");
    keeper.dispose();
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    expect(readDraft(ADA, `reply:${POST}`)).toBe("Lovely");
  });

  test("sent: the draft is removed, and a write still waiting never lands", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(ADA, "post");
    keeper.typed("Morning");
    vi.advanceTimersByTime(DRAFT_SAVE_MS);
    keeper.typed("Morning light");
    keeper.sent();
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    keeper.dispose();
    expect(readDraft(ADA, "post")).toBe("");
    expect(storage.items.has(draftKey(ADA))).toBe(false);
  });

  test("discarded: the same", () => {
    vi.useFakeTimers();
    writeDraft(ADA, `quote:${POST}`, "Look at this");
    const keeper = createDraftKeeper(ADA, `quote:${POST}`);
    keeper.typed("Look at this one");
    keeper.discarded();
    vi.advanceTimersByTime(DRAFT_SAVE_MS * 2);
    keeper.dispose();
    expect(readDraft(ADA, `quote:${POST}`)).toBe("");
  });

  test("a reader who is signed out keeps no draft", () => {
    vi.useFakeTimers();
    const keeper = createDraftKeeper(null, "post");
    keeper.typed("Anonymous words");
    vi.advanceTimersByTime(DRAFT_SAVE_MS);
    keeper.dispose();
    expect([...storage.items.keys()]).toEqual([]);
  });
});

describe("the session's end (section 8.8)", () => {
  test("clears every draft, whatever the account, and leaves the device's own keys", () => {
    writeDraft(ADA, "post", "Morning light");
    writeDraft(GRACE, `reply:${POST}`, "Compilers");
    storage.items.set("korbat.device", "kept");
    expect(draftsStored()).toBe(true);
    clearSessionTraces();
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
    expect(draftsStored()).toBe(false);
  });

  test("a draft kept here, like a place, makes the first signed-out answer the end of a session", () => {
    expect(tracesStored()).toBe(false);
    writeDraft(ADA, "post", "Morning light");
    expect(tracesStored()).toBe(true);
    expect(sessionEnded("loading", "signed-out", tracesStored())).toBe(true);
    clearDrafts();
    writePlace(ADA, "latest", { newest: { key: POST, time: "2026-10-21T10:00:00.000Z" }, top: { key: POST, time: "2026-10-21T10:00:00.000Z" }, savedAt: 1 });
    expect(tracesStored()).toBe(true);
    clearSessionTraces();
    expect(tracesStored()).toBe(false);
  });

  test("drafts.ts is the only module that touches the drafts' keys, and the composer reaches them through it", () => {
    const owners = sourceFiles().filter((file) => file.text.includes("korbat.drafts"));
    expect(owners.map((file) => file.name)).toEqual(["lib/drafts.ts"]);
    const composer = readFileSync(path.join(SRC, "components", "social", "Composer.tsx"), "utf8");
    expect(composer).toContain('from "@/lib/drafts"');
    expect(composer).not.toMatch(/localStorage/);
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
import { ADA, createFixtureApi, DECISION_ID, GRACE, MISSING_POST_ID, newPostIdOf, NOTICE_REF, NOTICE_TOKEN, POST_ID, postIdOf, RELEASE_ID, UPLOAD_ID, writtenIdOf, type FixtureApi } from "./fixture-api";
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
 * 1280, a reply and a quote. Later tasks add their screens' steps.
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
 * a menu's popover, the follow button and the toaster; from Task 5 every row of a feed (its posts, the marker, Load more,
 * the end), the tab lists, the new-posts pill, the profile's header and the thread's posts; from Task 6 every feed whole,
 * its header with Home's card and the thread's reply card included, and the compose button. The screens' own content
 * still paints with Tailwind's palette and sizes until its task moves it onto the tokens (test/legacy-files.ts), and
 * joins this list then: the moderation and public pages with Task 7, settings and sign-in with Task 8.
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
].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/**
 * The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each;
 * from Task 5 Bookmarks and a followers list too, drawn wholly on the kit.
 */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: DRAWN },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
  { name: "bookmarks", route: "/bookmarks", current: "/bookmarks", scope: ALL },
  { name: "followers", route: "/u/grace/followers", current: null, scope: ALL },
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
      expect(stops.slice(1, 5).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/bookmarks", "/u/ada", "/settings/security"]);
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
      // The screens drawn on the kit: a missing page, Bookmarks under its header, and from Task 5 Home with its tabs and
      // rows; from Task 6 a post with its reply card, and Home's New post sheet open with words in its field.
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
        ["home", "/"],
        ["post", `/post/${POST_ID}`],
        ["composer", "/"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
        if (name === "composer") {
          await visit_.page.locator("[data-compose]").click();
          await visit_.page.locator('[role="dialog"] textarea').fill("Morning light over the harbour, written at the largest text.");
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
  PostView,
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
 * hold every action's answer back; nothing else that changes something is. From UI Task 5 the timelines honour `limit`
 * and page through 120 posts (enough for the reading place's 100 rows), a switch puts new posts above them, a thread has
 * ancestors, and sign-out is answered. From UI Task 6 a post the reader writes (POST /api/posts) is answered as the API
 * answers it, goes on top of the timelines, has a thread and a page of its own, and a reply joins its thread's replies.
 * Nothing here needs a database or the network.
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

/** How many posts the timelines hold: more than the reading place's window of 100 rows (UI design, section 8.2). */
export const TIMELINE_POSTS = 120;

/** New post `j` of the new-posts switch (1 is the oldest of them): newer than every other post, with ids of their own. */
export const newPostIdOf = (j: number): string => id(900 + j);

function freshPost(j: number, count: number, signedIn: boolean): PostView {
  // Each a second apart and newer than post 1, so the newest of them comes first.
  return post(j, signedIn, { id: newPostIdOf(j), body: `A new post, number ${j}, written while the reader was reading.`, createdAt: new Date(Date.now() - (count - j + 1) * 1000).toISOString(), media: [] });
}

/**
 * A timeline from its start: the new posts the switch holds, newest first, then posts 1 to TIMELINE_POSTS, with a repost
 * of Grace's by Linus before post 3 and every twentieth post after it, as a page of twenty had one at its third row.
 */
function timelineItems(signedIn: boolean, fresh: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let j = fresh; j >= 1; j--) items.push({ kind: "post", post: freshPost(j, fresh, signedIn) });
  for (let n = 1; n <= TIMELINE_POSTS; n++) {
    if (n % 20 === 3) items.push({ kind: "repost", post: post(n + 40, signedIn, { author: GRACE }), repostedBy: LINUS, repostedAt: ago(n * 7 - 1) });
    items.push({ kind: "post", post: post(n, signedIn) });
  }
  return items;
}

/** A page of a timeline: `limit` items (20 by default, at most 50, as Pagination has it) from the cursor's place. */
function timeline(cursor: string | null, limit: string | null, signedIn: boolean, fresh: number, written: TimelineItem[] = []) {
  const items = [...written, ...timelineItems(signedIn, fresh)];
  const from = cursor === null ? 0 : Number.parseInt(cursor.replace(/^at-/, ""), 10);
  const size = Math.min(50, Math.max(1, Number.parseInt(limit ?? "20", 10) || 20));
  const to = Math.min(items.length, from + size);
  return parse(TimelinePage, { items: items.slice(from, to), nextCursor: to < items.length ? `at-${to}` : null }, "timeline");
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
  /** New posts above the timelines' first (UI Task 5): the poll finds them, and a reload reads them. */
  newPosts: number;
  /** How long each timeline answer waits, so a step can watch what the answer brings. */
  timelineDelayMs: number;
  /** The posts the reader wrote in the walk (UI Task 6), newest first: on top of the timelines, each with its own thread. */
  written: PostView[];
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/posts/<id>/status answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
}

type Answer = { status: number; json?: unknown; raw?: Buffer; type?: string };

/** The reader's k-th post written in the walk (UI Task 6): ids of their own, after every fixture's. */
export const writtenIdOf = (k: number): string => id(2000 + k);

/** A fixture post's number from its id: post n has the id id(100 + n). */
const numberOf = (postId: string): number => Number.parseInt(postId.slice(-12), 10) - 100;

/** Others who liked the post while the reader's like was on its way: the answer's count is the server's, not the card's guess. */
const OTHERS = 2;

const FLAGS = { like: "liked", repost: "reposted", bookmark: "bookmarked" } as const;

export function createFixtureApi(): FixtureApi {
  const state: FixtureState = { signedIn: false, problems: [], requests: [], refuse: new Set(), delayMs: 0, newPosts: 0, timelineDelayMs: 0, written: [] };
  /** The written posts that are not replies, as timeline rows: the API puts the reader's own posts on top of both feeds. */
  const writtenRows = (): TimelineItem[] => state.written.filter((view) => view.replyTo === null).map((view) => ({ kind: "post" as const, post: view }));
  /** The written replies to one post, oldest first, as the replies route lists them. */
  const writtenReplies = (postId: string): PostView[] => state.written.filter((view) => view.replyTo?.id === postId).reverse();
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok(me()) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") return ok(timeline(cursor, query.get("limit"), state.signedIn, state.newPosts, writtenRows()));
    if (path === "/api/timeline/explore") {
      const items = posts(1, 10).map((view) => ({ kind: "post" as const, post: view }));
      return ok(parse(ExplorePage, { items, nextCursor: null, computedAt: ago(5), signInForMore: !state.signedIn }, "explore"));
    }
    if (path === `/api/posts/${POST_ID}/thread`) {
      const replies = [2, 3, 5].map((n) => post(n, state.signedIn, { id: id(300 + n), replyTo: { id: POST_ID, authorHandle: GRACE.handle } }));
      return ok(parse(ThreadResponse, { ancestors: [], post: post(1, state.signedIn), replies: { items: [...replies, ...writtenReplies(POST_ID)], nextCursor: null } }, "thread"));
    }
    // Ada's post 3 replies to a chain of three, and has replies of its own: the page must scroll to hold it at the top (UI Task 5).
    if (path === `/api/posts/${id(103)}/thread`) {
      const ancestors = [9, 8, 6].map((n) => post(n, state.signedIn));
      const replies = [2, 5, 7, 10, 11].map((n) => post(n, state.signedIn, { id: id(320 + n), replyTo: { id: id(103), authorHandle: ADA.handle } }));
      return ok(parse(ThreadResponse, { ancestors, post: post(3, state.signedIn, { replyTo: { id: id(106), authorHandle: ADA.handle } }), replies: { items: replies, nextCursor: null } }, "thread"));
    }
    // A post the reader wrote in the walk: its page, with no ancestors and its replies; its Explore status waits.
    const writtenThread = /^\/api\/posts\/([0-9a-f-]{36})\/thread$/.exec(path);
    const written = writtenThread ? state.written.find((view) => view.id === writtenThread[1]) : undefined;
    if (written) return ok(parse(ThreadResponse, { ancestors: [], post: written, replies: { items: writtenReplies(written.id), nextCursor: null } }, "written thread"));
    const writtenExplore = /^\/api\/posts\/([0-9a-f-]{36})\/explore$/.exec(path);
    if (writtenExplore && state.written.some((view) => view.id === writtenExplore[1])) return ok(parse(ExploreStatus, { status: "pending", computedAt: ago(5) }, "explore status"));
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
    // Signing out ends the session: /api/me answers 401 from here on (UI Task 5, the session's end).
    if (path === "/api/auth/signout") {
      state.signedIn = false;
      return { status: 204 };
    }
    if (path === "/api/notices/status") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { ref?: string; token?: string };
      if (asked.ref !== NOTICE_REF || asked.token !== NOTICE_TOKEN) return null;
      return ok(parse(NoticeStatus, { ref: NOTICE_REF, receivedAt: ago(60 * 24 * 2), items: [], contact: null }, "notice status"));
    }
    if (path === "/api/auth/passkey/signin/options") return ok(parse(PasskeyOptionsResponse, { options: { challenge: "Y2hhbGxlbmdlLW9mLXRoZS13YWxr", rpId: "localhost", userVerification: "required", allowCredentials: [], timeout: 300000 } }, "passkey options"));
    // A post the reader writes (UI Task 6): answered as the API answers it, by Ada, now, with the post it replies to or quotes.
    if (path === "/api/posts") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { body?: string; replyToId?: string; quoteOfId?: string };
      const quoted = asked.quoteOfId ? post(numberOf(asked.quoteOfId), state.signedIn) : null;
      const view = parse(
        PostView,
        {
          id: writtenIdOf(state.written.length + 1),
          author: ADA,
          body: asked.body ?? "",
          createdAt: new Date().toISOString(),
          state: "visible",
          replyTo: asked.replyToId ? { id: asked.replyToId, authorHandle: GRACE.handle } : null,
          counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
          media: [],
          viewer: { liked: false, reposted: false, bookmarked: false },
          quoteOf: quoted ? { ...quoted, quoteOf: null } : null,
        },
        "written post",
      );
      state.written.unshift(view);
      return ok(view);
    }
    return null;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) || state.written.some((view) => view.id === asked) ? 204 : 404),
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
        if (url.pathname.startsWith("/api/timeline/") && state.timelineDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.timelineDelayMs));
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
  useLocalSearchParams: () => route.params, useIsFocused: () => true,
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

  test("each list is keyed by its reader only, so a tab change or a new post keeps its rows and place, and signing in or out, or another account, reads it again", () => {
    // A list read signed out has no cursor and a sign-in link and was read without any block or mute, and the web keeps a
    // Home mounted under the sign-in screen, which Back shows again once signed in. UI Task 5: the tab and a new post left
    // the key (UI design, section 7.5); a tab's rows and place come back from lib/feed-cache.ts.
    const readers = [homeListKey(null), homeListKey(AUTHOR), homeListKey(OTHER)];
    expect(new Set(readers).size).toBe(3);
    expect(homeListKey(AUTHOR)).toBe(homeListKey(AUTHOR));
    // Both lists take their key from it, with the session's account as the reader; the feeds' list is a FeedList.
    const home = block(read("app", "index.tsx"), "Home");
    expect(home).toContain('const viewer = state.status === "signed-in" ? state.me.user.id : null;');
    expect(home.match(/key=\{homeListKey\(viewer\)\}/g)).toHaveLength(2);
    expect(home).toContain("<FeedList");
  });

  test("a tab is chosen through the address, every link to a tab names one Home has, and Following's empty text points to Latest and Explore", () => {
    const home = read("app", "index.tsx");
    expect(home).toContain("useLocalSearchParams<{ tab?: string }>()");
    expect(home).toContain("const select = (tab: Tab) => router.setParams({ tab });");
    expect(read("lib", "ui-words.ts")).toContain('"feed.empty.following.body": "Nothing here yet. Follow someone, or switch to Latest or Explore.",');
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
      "items: shown.items,",
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
    expect(read("components", "social", "ExploreList.tsx")).toContain("renderPost={(item, place) => <PostCard post={item.post} onDeleted={remove} {...place} />}");
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
    // What the app keeps in the browser is the device id, the passkey card's Not now, the reader's appearance, reading places and drafts, nothing else.
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/appearance.ts", "lib/drafts.ts", "lib/passkeys.ts", "lib/reading-place.ts"]);
    // Explore's requests are the client's plain calls, which the API answers no-store.
    const social = read("lib", "social.ts");
    for (const line of social.split("\n").filter((text) => text.includes("/api/timeline/explore") || text.includes("/explore`"))) expect(line).not.toMatch(/cache/i);
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
  "app/not-me/[token].tsx",
  "app/passkey-remove/[token].tsx",
  "app/settings/account.tsx",
  "app/settings/privacy.tsx",
  "app/settings/profile.tsx",
  "app/settings/security.tsx",
  "app/terms.tsx",
  "components/moderation/ReportForm.tsx",
  "components/security/MfaSection.tsx",
  "components/security/PasskeysSection.tsx",
  "components/security/ReauthPanel.tsx",
  "components/security/SessionsSection.tsx",
];

export const SRC = path.resolve(import.meta.dirname, "..", "src");

/** Every source file of the app, with its path from src in forward slashes, as explore.test.tsx reads them. */
export function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ name: file.split(path.sep).join("/"), text: readFileSync(path.join(SRC, file), "utf8") }));
}
```

### Replace `apps/app/test/reading-place.test.ts` (whole file)

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { APPEARANCE_KEY, readAppearance, setAppearance } from "../src/lib/appearance";
import {
  clearPlaces,
  createPlaceKeeper,
  newer,
  openingRow,
  PLACE_PREFIX,
  PLACE_SAVE_MS,
  PLACE_WINDOW,
  placeKey,
  placesStored,
  readPlace,
  writePlace,
  type Place,
  type PlaceRow,
} from "../src/lib/reading-place";
import { clearSessionTraces, sessionEnded } from "../src/lib/session-end";

/**
 * Where the reader stopped in Following and Latest (UI design, decisions 8 and 9, sections 8.2 and 8.8; Task 5): kept in
 * this browser under korbat.place.<accountId>, per feed, as the newest post the reader has seen and the post at the top
 * of the list, written one second after scrolling stops and when the page is hidden; a feed opens there when that post
 * is among its newest 100, unless the reader chose to open at the newest; nothing is kept for a reader who is signed
 * out; and the session's end clears every place with the appearance.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** localStorage as far as the stores use it, keys in the order they were set. */
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

const globals = globalThis as { localStorage?: unknown };
let storage = fakeStorage();

beforeEach(() => {
  storage = fakeStorage();
  globals.localStorage = storage;
});

afterEach(() => {
  vi.useRealTimers();
  delete globals.localStorage;
});

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";
/** Row n of a feed, n minutes after nine: a higher number is newer. */
const row = (n: number): PlaceRow => ({ key: `post-${n}`, time: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString() });
const place = (top: number, newest: number, savedAt = 1000): Place => ({ top: row(top), newest: row(newest), savedAt });

describe("the stored place", () => {
  test("is kept per account under korbat.place.<accountId>, per feed, and read back", () => {
    expect(PLACE_PREFIX).toBe("korbat.place.");
    expect(placeKey(ADA)).toBe(`korbat.place.${ADA}`);
    writePlace(ADA, "latest", place(40, 12));
    writePlace(ADA, "following", place(3, 3));
    expect(readPlace(ADA, "latest")).toEqual(place(40, 12));
    expect(readPlace(ADA, "following")).toEqual(place(3, 3));
    expect(JSON.parse(storage.items.get(`korbat.place.${ADA}`)!)).toEqual({ latest: place(40, 12), following: place(3, 3) });
    // Another account on the same browser has none of Ada's.
    expect(readPlace(GRACE, "latest")).toBeNull();
  });

  test("a damaged record, or one of the wrong shape, is no place at all", () => {
    storage.items.set(`korbat.place.${ADA}`, "{not json");
    expect(readPlace(ADA, "latest")).toBeNull();
    storage.items.set(`korbat.place.${ADA}`, JSON.stringify({ latest: { top: { key: 4 }, newest: row(2), savedAt: 1 } }));
    expect(readPlace(ADA, "latest")).toBeNull();
    // Writing again replaces it.
    writePlace(ADA, "latest", place(5, 2));
    expect(readPlace(ADA, "latest")).toEqual(place(5, 2));
  });

  test("a browser that refuses storage keeps nothing and breaks nothing", () => {
    globals.localStorage = {
      getItem: () => {
        throw new Error("The operation is insecure.");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writePlace(ADA, "latest", place(5, 2))).not.toThrow();
    expect(readPlace(ADA, "latest")).toBeNull();
    expect(placesStored()).toBe(false);
  });

  test("the newer of two rows is the later one, and nothing is newer than something", () => {
    expect(newer(row(3), row(5))).toEqual(row(5));
    expect(newer(row(7), row(5))).toEqual(row(7));
    expect(newer(null, row(5))).toEqual(row(5));
    expect(newer(row(5), null)).toEqual(row(5));
  });
});

describe("where a feed opens (decision 9)", () => {
  // The first page and the second, newest first: post 199 down to post 0.
  const rows = Array.from({ length: 200 }, (_, i) => row(199 - i));

  test("at the stored top when it is among the newest 100, two pages of 50", () => {
    expect(PLACE_WINDOW).toBe(100);
    expect(openingRow(rows, place(150, 160), false)).toBe("post-150");
    // The 100th row is the last one in the window.
    expect(openingRow(rows, place(100, 120), false)).toBe("post-100");
  });

  test("else at the newest post: further down, gone, nothing stored, or the reader asks for the newest", () => {
    expect(openingRow(rows, place(99, 120), false)).toBeNull();
    expect(openingRow(rows, place(500, 520), false)).toBeNull();
    expect(openingRow(rows, null, false)).toBeNull();
    expect(openingRow(rows, place(150, 160), true)).toBeNull();
    // The newest post itself is the newest: nothing to move to.
    expect(openingRow(rows, place(199, 199), false)).toBeNull();
  });
});

describe("keeping the place while the reader reads", () => {
  test("the newest seen only ever moves to newer posts; the top follows the list", () => {
    const keeper = createPlaceKeeper(ADA, "latest", place(30, 40));
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(35), row(38)]);
    expect(keeper.newest()).toEqual(row(40));
    keeper.seen([row(44), row(41)]);
    expect(keeper.newest()).toEqual(row(44));
    keeper.top(row(36));
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(36), newest: row(44) });
    keeper.dispose();
  });

  test("written one second after scrolling stops, not on every scroll", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 12));
    const keeper = createPlaceKeeper(ADA, "following", null);
    keeper.seen([row(9)]);
    keeper.top(row(7));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    keeper.top(row(6));
    keeper.scrolled();
    vi.advanceTimersByTime(PLACE_SAVE_MS - 100);
    expect(readPlace(ADA, "following")).toBeNull();
    vi.advanceTimersByTime(100);
    expect(readPlace(ADA, "following")).toEqual({ top: row(6), newest: row(9), savedAt: Date.UTC(2026, 9, 21, 12) + 2 * PLACE_SAVE_MS - 100 });
    expect(PLACE_SAVE_MS).toBe(1000);
    keeper.dispose();
  });

  test("written at once when the page is hidden, and not before both rows are known", () => {
    const keeper = createPlaceKeeper(ADA, "latest", null);
    keeper.hidden();
    expect(readPlace(ADA, "latest")).toBeNull();
    keeper.top(row(4));
    keeper.hidden();
    // The top row has been seen: it is the newest when nothing newer was.
    expect(readPlace(ADA, "latest")).toMatchObject({ top: row(4), newest: row(4) });
    keeper.dispose();
  });

  test("nothing is kept for a reader who is signed out", () => {
    vi.useFakeTimers();
    const keeper = createPlaceKeeper(null, "latest", null);
    keeper.seen([row(9)]);
    keeper.top(row(8));
    keeper.scrolled();
    keeper.hidden();
    vi.advanceTimersByTime(5000);
    expect(storage.items.size).toBe(0);
    expect(keeper.newest()).toBeNull();
    keeper.dispose();
  });
});

describe("cleared when the session ends (section 8.8)", () => {
  test("clearPlaces removes every account's place, and only places", () => {
    writePlace(ADA, "latest", place(5, 2));
    writePlace(GRACE, "following", place(5, 2));
    storage.items.set("korbat.device", "kept");
    expect(placesStored()).toBe(true);
    clearPlaces();
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
    expect(placesStored()).toBe(false);
  });

  test("a move from signed in to signed out ends it; so does a first answer of signed out while a place is stored", () => {
    expect(sessionEnded("signed-in", "signed-out", false)).toBe(true);
    expect(sessionEnded("loading", "signed-out", true)).toBe(true);
    // A visitor who never signed in on this browser keeps their appearance.
    expect(sessionEnded("loading", "signed-out", false)).toBe(false);
    expect(sessionEnded("loading", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-in", "signed-in", true)).toBe(false);
    expect(sessionEnded("signed-out", "signed-out", true)).toBe(false);
  });

  test("its end clears the appearance and every place, and leaves the device's own keys", () => {
    setAppearance({ theme: "dim" });
    writePlace(ADA, "latest", place(5, 2));
    storage.items.set("korbat.device", "kept");
    clearSessionTraces();
    expect(storage.items.has(APPEARANCE_KEY)).toBe(false);
    expect(readAppearance().theme).toBe("system");
    expect([...storage.items.keys()]).toEqual(["korbat.device"]);
  });

  test("the provider decides with sessionEnded on every change of its state, and clears through the stores' own functions", () => {
    const session = readFileSync(path.join(SRC, "lib", "session.tsx"), "utf8");
    expect(session).toContain("if (sessionEnded(previous.current, state.status, tracesStored())) clearSessionTraces();");
    const end = readFileSync(path.join(SRC, "lib", "session-end.ts"), "utf8");
    expect(end).toContain("clearAppearance();");
    expect(end).toContain("clearPlaces();");
    // reading-place.ts is the only module that touches the places' keys.
    expect(session + end).not.toContain("korbat.place");
    // UI Task 6: the drafts end with the session too, through drafts.ts, the only module that touches their keys; the
    // first answer of /me ends a session while a place or a draft is stored (tracesStored, in session-end.ts).
    expect(end).toContain("clearDrafts();");
    expect(session + end).not.toContain("korbat.drafts");
    expect(end).toContain("return placesStored() || draftsStored();");
  });
});
```

### Replace `apps/app/test/setup.ts` (whole file)

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
    // UI Task 6: the composer's native ring animates its dash offset as a prop.
    useAnimatedProps: <T>(updater: () => T) => updater(),
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
python docs/superpowers/prompts/interface-experience-ui/write_blocks.py docs/superpowers/prompts/interface-experience-ui/06-the-composer.md 3
```

Expected: 28 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/components/social/ComposeButton.tsx`

```tsx
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * The compose button (UI design, sections 4.6, 7.2 and 7.3): a 56 px accent circle with the compose icon, named
 * "New post" (pinned). It floats over a phone's Home, profile and Bookmarks, and stands under the rail's items from
 * 768 px. Flat: no shadow, but a 2 px ring in the page's surface colour that parts it from whatever scrolls under it, and
 * in forced colours a 1 px CanvasText border, so it keeps its shape when the browser drops backgrounds. It scales to 0.92
 * from pointer-down, as an icon button does (5.2). data-compose marks it for the browser check.
 */
export function ComposeButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.92);
  return (
    <Animated.View style={press.style}>
      <Pressable
        {...dataAttribute("compose")}
        accessibilityRole="button"
        accessibilityLabel={UI_WORDS["composer.newPost"]}
        onPress={onPress}
        {...press.handlers}
        {...pressDelay(0)}
        className={cn(
          "h-14 w-14 items-center justify-center rounded-full border-2 border-surface bg-accent web:transition-colors web:duration-[120ms] web:hover:bg-accent/90 web:forced-colors:border web:forced-colors:border-[color:CanvasText]",
          FOCUS_RING,
        )}
      >
        <Icon name="compose" size={24} tone="on-accent" />
      </Pressable>
    </Animated.View>
  );
}

/**
 * The full nav's New post (7.1, 7.3): a full-width primary button with the compose icon and its words, a pill like the
 * nav's items, 48 px tall.
 */
export function NewPostButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.97);
  return (
    <View className="self-stretch">
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          {...press.handlers}
          {...pressDelay(0)}
          className={cn(
            "min-h-[48px] flex-row items-center justify-center gap-2 rounded-full border border-accent bg-accent px-4 web:transition-colors web:duration-[120ms] web:hover:bg-accent/90 web:forced-colors:border-[color:CanvasText]",
            FOCUS_RING,
          )}
        >
          <Icon name="compose" size={20} tone="on-accent" />
          <Text variant="body-strong" tone="on-accent" className="shrink text-center">
            {UI_WORDS["composer.newPost"]}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
```

### Create `apps/app/src/components/social/ComposeHost.tsx`

```tsx
import { closeNewPost, useNewPostOpen } from "@/lib/composing";
import { insertPosted } from "@/lib/feed-cache";
import { useSession } from "@/lib/session";
import { ComposeSheet } from "./ComposeSheet";

/**
 * The app's one New post sheet (UI design, sections 7.2, 7.3 and 8.6), mounted once in the root layout beside the
 * screens, as the Toaster is: the nav's New post and the phone's compose button open it from any screen
 * (lib/composing.ts). A post sent from it goes on top of Home's Following and Latest (lib/feed-cache.ts, which also
 * tells a Home still mounted under the screen), and the composer's toast says where it is. A reader who is signed out
 * has no sheet.
 */
export function ComposeHost() {
  const open = useNewPostOpen();
  const { state } = useSession();
  if (state.status !== "signed-in") return null;
  const reader = state.me.user.id;
  return <ComposeSheet open={open} onClose={closeNewPost} onPosted={(post) => insertPosted(reader, post)} />;
}
```

### Create `apps/app/src/components/social/composer/ComposerCard.tsx`

```tsx
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { PostView } from "@korbat/contracts";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { draftContext, readDraft } from "@/lib/drafts";
import { useMotion } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { Composer, type ComposerHandle } from "../Composer";

/** What a screen asks of its card: open it and put the focus in its field (the nav's New post on Home). */
export interface ComposerCardHandle {
  open(): void;
}

/** The card's corners (radius card, 4.5), on the box that clips it while it grows. */
const CORNER = 16;

/**
 * A composer that opens in place (UI design, decision 19, sections 5.2, 8.2 and 8.3): collapsed, a one-line card with the
 * reader's monogram and "What's on your mind?" (Home from 768 px) or "Write your reply" (under a thread's focused post,
 * at every width); a focus or a press opens it into the composer with the focus in the field, and it closes back when it
 * is empty and the focus has left it. A draft kept for its context opens it with its words, so nothing written is hidden
 * behind the placeholder.
 *
 * composer-open: the card's height grows from the collapsed card's to the composer's over 200 ms ease-out, and shrinks
 * back the same way, each from wherever the other left it; the box clips what is not reached yet, so the words never
 * squash. Under reduced motion it opens and closes at once. (Reanimated's LinearTransition was not used: on the web it
 * animates a scale and a translation from the element's last rectangle, which squashes the field's text and slides
 * the card whenever the list it sits in has scrolled between two renders.)
 */
export function ComposerCard({ replyTo, onPosted, startOpen = false, handle }: { replyTo?: PostView; onPosted: (post: PostView) => void; startOpen?: boolean; handle?: Ref<ComposerCardHandle> }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const motion = useMotion();
  const context = draftContext(replyTo?.id);
  const [open, setOpen] = useState(() => startOpen || (me !== null && readDraft(me.user.id, context) !== ""));
  const [focusOnOpen, setFocusOnOpen] = useState(startOpen);
  const openNow = useRef(open);
  openNow.current = open;
  const dirty = useRef(false);
  const composer = useRef<ComposerHandle>(null);
  const root = useRef<View>(null);

  // The card's height while it grows or shrinks (sizing 1); otherwise its own (auto).
  const height = useSharedValue(0);
  const sizing = useSharedValue(0);
  const outer = useRef(0);
  const style = useAnimatedStyle(() => (sizing.value === 1 ? { height: height.value } : { height: "auto" as const }));

  const toggle = (next: boolean, focus: boolean) => {
    if (next === openNow.current) {
      if (next && focus) composer.current?.focus();
      return;
    }
    if (!motion.reduced && outer.current > 0) {
      // From where it is: a card still moving turns back from its current height.
      if (sizing.value === 0) height.value = outer.current;
      sizing.value = 1;
    }
    setFocusOnOpen(focus);
    setOpen(next);
  };
  useImperativeHandle(handle, () => ({ open: () => toggle(true, true) }));

  // The new content's own height is where the card goes; the Reanimated rule: no timing to where it already is.
  const onContent = (event: LayoutChangeEvent) => {
    if (sizing.value !== 1) return;
    const to = event.nativeEvent.layout.height;
    if (Math.abs(height.value - to) < 1) {
      sizing.value = 0;
      return;
    }
    height.value = withTiming(to, motion.timing("easeOut", 200), (finished) => {
      "worklet";
      if (finished) sizing.value = 0;
    });
  };

  // The web: once the focus has moved, a card left empty closes, unless the focus is still inside it (Add image, a
  // description, Post) or has left the window (the file picker).
  const left = () => {
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      const node = root.current as unknown as HTMLElement | null;
      const active = document.activeElement;
      if (!document.hasFocus() || (node !== null && active !== null && node.contains(active))) return;
      if (!dirty.current && openNow.current) toggle(false, false);
    }, 0);
  };
  // Native: the field's blur is the card's.
  const fieldLeft = () => {
    if (Platform.OS !== "web" && !dirty.current) toggle(false, false);
  };

  const label = replyTo ? UI_WORDS["composer.collapsedReply"] : UI_WORDS["composer.collapsed"];
  const avatar = me ? <Avatar account={{ id: me.user.id, displayName: me.profile?.displayName ?? me.profile?.handle ?? "" }} size={40} /> : null;

  return (
    <Animated.View style={[{ borderRadius: CORNER, overflow: "hidden" }, style]} onLayout={(event) => (outer.current = event.nativeEvent.layout.height)}>
      {/* The card's face, drawn behind the content at the box's own size, so its edge grows with it. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} className="rounded-card border border-line-high bg-surface-1 web:forced-colors:border-[color:CanvasText]" />
      <View ref={root} {...dataAttribute("composer-card", open ? "open" : "closed")} onLayout={onContent} {...({ onBlur: left } as object)}>
        {open ? (
          <View className="flex-row gap-3 p-3">
            {avatar}
            <View className="min-w-0 flex-1">
              <Composer
                handle={composer}
                replyTo={replyTo}
                autoFocus={focusOnOpen}
                onDirtyChange={(value) => {
                  dirty.current = value;
                }}
                onFieldBlur={fieldLeft}
                onPosted={(post) => {
                  onPosted(post);
                  // The card stays open, empty, with the focus back in its field: it closes when the reader leaves it.
                  composer.current?.focus();
                }}
              />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => toggle(true, true)}
            onFocus={() => toggle(true, true)}
            className={cn("min-h-[64px] flex-row items-center gap-3 rounded-card p-3 active:bg-surface-2 web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]", FOCUS_RING)}
          >
            {avatar}
            <Text tone="low" className="min-w-0 flex-1">
              {label}
            </Text>
            <Icon name="compose" size={20} tone="low" />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
```

### Create `apps/app/src/components/social/composer/ComposerField.tsx`

```tsx
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Platform, TextInput, View, useWindowDimensions } from "react-native";
import { FOCUS_RING } from "@/components/kit/interaction";
import { textStyle } from "@/components/kit/Text";
import { VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { useAppearance } from "@/lib/appearance";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import { crossed, type ComposerKind } from "./state";

/** The field's names and placeholders, as the composer always had them (pinned by name in the walk). */
const NAME: Record<ComposerKind, string> = { post: UI_WORDS["composer.field.post"], reply: UI_WORDS["composer.field.reply"], quote: UI_WORDS["composer.field.quote"] };
const PLACEHOLDER: Record<ComposerKind, string> = { post: UI_WORDS["composer.placeholder.post"], reply: UI_WORDS["composer.placeholder.reply"], quote: UI_WORDS["composer.placeholder.quote"] };

/** The field's least height: three lines of the post variant and its padding. */
const MIN_HEIGHT = 88;
/** Its vertical padding (py-3), which a native content size leaves out. */
const PADDING = 24;

export interface ComposerFieldProps {
  kind: ComposerKind;
  value: string;
  onChangeText: (text: string) => void;
  /** The text's length by the server's rule (composer/state.ts), which the count says. */
  length: number;
  autoFocus?: boolean;
  fieldRef?: Ref<TextInput>;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * The composer's field (UI design, sections 6.15 and 10): the TextInput with its kept names ("What's on your mind?",
 * "Your reply", "Your comment on the quoted post") and placeholders, in the post variant, growing with its words up to
 * half the window and then scrolling (on the web by CSS field-sizing, natively from its content size). Its description
 * (aria-describedby) is a visually hidden "{n} of 1000 characters", which replaces the visible "n/1000": the ring shows
 * the count. A polite status says the count again only when it crosses 900 or 1000, so a screen reader hears the end
 * coming without hearing every keystroke.
 */
export function ComposerField({ kind, value, onChangeText, length, autoFocus, fieldRef, onFocus, onBlur }: ComposerFieldProps) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  const screen = useWindowDimensions();
  const countId = useId();
  const count = fill(UI_WORDS["composer.count"], { n: length });
  const [announced, setAnnounced] = useState("");
  const before = useRef(length);
  useEffect(() => {
    if (crossed(before.current, length)) setAnnounced(count);
    before.current = length;
  }, [length, count]);
  const [content, setContent] = useState(0);
  // Half the window, but never less than the field's own least height.
  const most = Math.max(MIN_HEIGHT, Math.round((screen.height || MIN_HEIGHT * 4) / 2));
  const native = Platform.OS !== "web";
  return (
    <View>
      <TextInput
        ref={fieldRef}
        accessibilityLabel={NAME[kind]}
        aria-describedby={countId}
        placeholder={PLACEHOLDER[kind]}
        placeholderTextColor={colors["ink-low"]}
        multiline
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onContentSizeChange={native ? (event) => setContent(event.nativeEvent.contentSize.height) : undefined}
        className={cn("min-h-[88px] rounded-control border border-line-high bg-surface-1 px-4 py-3 text-ink-high web:[field-sizing:content]", FOCUS_RING)}
        style={[textStyle("post", { step: appearance.textStep, font: appearance.font }), { maxHeight: most }, native && content > 0 ? { height: Math.min(most, Math.max(MIN_HEIGHT, content + PADDING)) } : null]}
      />
      <VisuallyHidden nativeID={countId}>{count}</VisuallyHidden>
      <VisuallyHidden role="status">{announced}</VisuallyHidden>
    </View>
  );
}
```

### Create `apps/app/src/components/social/composer/DiscardDialog.tsx`

```tsx
import { useEffect, useId, useRef, type Ref } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { LABEL_TONE, buttonFace, type ButtonFace } from "@/components/ui";
import { useHaptics } from "@/lib/haptics";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";

function Answer({ label, face, onPress, ref }: { label: string; face: ButtonFace; onPress: () => void; ref?: Ref<View> }) {
  const press = usePressScale(0.97);
  return (
    <Animated.View style={press.style}>
      <Pressable ref={ref} accessibilityRole="button" onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
        <Text variant="body-strong" tone={LABEL_TONE[face]} className="text-center">
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The discard question (UI design, sections 6.15 and 8.6): "Discard this draft?" with "Discard" (the danger fill) and
 * "Keep writing", asked in place of the send bar when a composer with content is closed (Cancel, Escape, the scrim, a
 * drag), never when it is empty. It is an alertdialog named by its question; the safe answer, Keep writing, takes the
 * focus as it appears, and the warning haptic fires with it. Keep writing goes back to the field, Discard closes.
 */
export function DiscardDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  const haptic = useHaptics();
  const questionId = useId();
  const keep = useRef<View>(null);
  useEffect(() => {
    haptic("warning");
    if (Platform.OS === "web") keep.current?.focus();
    // Once, as the question appears.
  }, []);
  return (
    <View role="alertdialog" aria-labelledby={questionId} className="mt-3 gap-2 rounded-card border border-line-high bg-surface-1 p-3 web:forced-colors:border-[color:CanvasText]">
      <Text variant="body-strong" nativeID={questionId}>
        {UI_WORDS["composer.discard.question"]}
      </Text>
      <View className="flex-row flex-wrap justify-end gap-2">
        <Answer label={UI_WORDS["composer.discard.confirm"]} face="danger" onPress={onDiscard} />
        <Answer ref={keep} label={UI_WORDS["composer.discard.keep"]} face="secondary" onPress={onKeep} />
      </View>
    </View>
  );
}
```

### Create `apps/app/src/components/social/composer/ProgressRing.tsx`

```tsx
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { TONE_TOKEN, Text } from "@/components/kit/Text";
import { useMotion } from "@/lib/motion";
import { useTheme } from "@/theme/ThemeProvider";
import { ring, type RingTone } from "./state";

const RING_SIZE = 20;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TONE: Record<RingTone, "accent" | "review-ink" | "danger"> = { accent: "accent", "review-ink": "review-ink", danger: "danger" };

/**
 * The ring of the composer's count on iOS and Android (UI design, sections 5.2 and 6.15), drawn with react-native-svg:
 * the same 20 px circle, colours and number as ProgressRing.web.tsx, its colours the theme's values (an svg takes no
 * class here). The dash offset follows the count on a 120 ms ease-out timing from where it is; under reduced motion it
 * is set at once.
 */
export function ProgressRing({ length }: { length: number }) {
  const motion = useMotion();
  const { colors } = useTheme();
  const shown = ring(length);
  const offset = useSharedValue(CIRCUMFERENCE * (1 - shown.progress));
  const target = CIRCUMFERENCE * (1 - shown.progress);
  useEffect(() => {
    // A timing to where it already is would not run (the Reanimated rule): only a change is animated.
    if (Math.abs(offset.value - target) < 0.01) return;
    offset.value = motion.reduced ? target : withTiming(target, motion.timing("easeOut", 120));
  }, [target, motion, offset]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const colour = colors[TONE_TOKEN[TONE[shown.tone]]];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-row items-center gap-1.5">
      {shown.number !== null ? (
        <Text variant="meta" tone={TONE[shown.tone]}>
          {shown.number}
        </Text>
      ) : null}
      <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" stroke={colors["line-low"]} strokeWidth={STROKE} />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          opacity={shown.progress === 0 ? 0 : 1}
          rotation={-90}
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
          animatedProps={props}
        />
      </Svg>
    </View>
  );
}
```

### Create `apps/app/src/components/social/composer/ProgressRing.web.tsx`

```tsx
import { View } from "react-native";
import { TONE_CLASS, Text } from "@/components/kit/Text";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { MOTION } from "@/theme/motion";
import { ring, type RingTone } from "./state";

/** The ring's geometry: 20 px across, a 2 px stroke, so its circle has a radius of 9. */
export const RING_SIZE = 20;
const STROKE = 2;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE: Record<RingTone, "accent" | "review-ink" | "danger"> = { accent: "accent", "review-ink": "review-ink", danger: "danger" };

/**
 * The ring of the composer's count on the web (UI design, sections 5.2 and 6.15): a 20 px circle that fills with the
 * count, in the accent, review-ink from 900 characters and danger-ink past 1000, and beside it the number left once 100
 * or fewer remain ("12", then "-3" over the limit). Drawn as a DOM svg, as Icon.web.tsx draws its icons, so the web
 * bundle never loads react-native-svg; its colour is the tone's class through currentColor. The dash offset follows the
 * count over 120 ms ease-out and retargets from where it is; under reduced motion it changes at once. It is decoration:
 * the field's description says the count in words.
 */
export function ProgressRing({ length }: { length: number }) {
  const motion = useMotion();
  const shown = ring(length);
  const tone = TONE_CLASS[TONE[shown.tone]];
  const easing = `cubic-bezier(${MOTION.easeOut.easing.join(", ")})`;
  return (
    <View aria-hidden className="flex-row items-center gap-1.5">
      {shown.number !== null ? (
        <Text variant="meta" tone={TONE[shown.tone]} className="web:tabular-nums">
          {shown.number}
        </Text>
      ) : null}
      <svg data-ring="" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" focusable="false" className={tone}>
        {/* The track, in the line colour, so the ring's whole shape shows while it is nearly empty. */}
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-line-low" />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown.progress)}
          // From the top, clockwise.
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          className={cn(shown.progress === 0 ? "opacity-0" : undefined)}
          style={{ transition: motion.reduced ? "none" : `stroke-dashoffset 120ms ${easing}, color 120ms ${easing}` }}
        />
      </svg>
    </View>
  );
}
```

### Create `apps/app/src/components/social/composer/SendBar.tsx`

```tsx
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { IconButton } from "@/components/kit/IconButton";
import { pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { LABEL_TONE, buttonFace, type ButtonFace } from "@/components/ui";
import { usePressScale } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { ProgressRing } from "./ProgressRing";

export interface SendBarProps {
  /** Opens the image picker; left out where images cannot be chosen yet (native) or the post has four. */
  onAddImage?: () => void;
  /** The text's length by the server's rule, which the ring shows. */
  length: number;
  /** Cancel, in a sheet only: the card closes by losing the focus. */
  onCancel?: () => void;
  /** The Post button's words (composer/state.ts): Post, Reply or Quote, what is missing, or Posting... */
  label: string;
  ready: boolean;
  busy: boolean;
  onPost: () => void;
}

/** A button of the bar: Button's own faces (ui.tsx), inline in the row and scaled to 0.97 from pointer-down. */
function BarButton({ label, face, busy = false, disabled = false, onPress }: { label: string; face: ButtonFace; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const press = usePressScale(0.97);
  return (
    <Animated.View style={press.style}>
      <Pressable accessibilityRole="button" aria-busy={busy} disabled={disabled} onPress={onPress} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
        <Text variant="body-strong" tone={LABEL_TONE[face]} className="shrink text-center">
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The composer's send bar (UI design, section 6.15): Add image (an icon button), then at the end the count's ring,
 * Cancel when the composer is a sheet, and the Post button, which says what is missing while images hold the post back
 * ("Remove the failed image", "Describe every image", "Waiting for images...") and "Posting..." while it sends, busy for
 * assistive technology. Under Add image, one line in ink-low says that korbat removes location and camera details from
 * images (2b's EXIF strip). The row wraps rather than cutting a long label at the largest text on a phone.
 */
export function SendBar({ onAddImage, length, onCancel, label, ready, busy, onPost }: SendBarProps) {
  return (
    <View className="mt-3 gap-1">
      <View className="flex-row flex-wrap items-center gap-2">
        {onAddImage ? <IconButton icon="add-image" label={UI_WORDS["composer.addImage"]} tone="accent" onPress={onAddImage} /> : null}
        <View className="min-w-0 flex-1 flex-row flex-wrap items-center justify-end gap-2">
          <ProgressRing length={length} />
          {onCancel ? <BarButton label={UI_WORDS["composer.cancel"]} face="secondary" onPress={onCancel} /> : null}
          <BarButton label={label} face={ready ? "primary" : "inactive"} busy={busy} disabled={!ready} onPress={onPost} />
        </View>
      </View>
      {onAddImage ? (
        <Text variant="meta" tone="low">
          {UI_WORDS["composer.exif"]}
        </Text>
      ) : null}
    </View>
  );
}
```

### Create `apps/app/src/components/social/composer/state.ts`

```ts
import { POST_MAX_LENGTH, normalizePostBody, postLength } from "@korbat/contracts";
import type { DraftContext } from "@/lib/drafts";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { describeState, type ComposerImage } from "../useImageUploads";

/**
 * The composer's state (UI design, section 6.15, after Bluesky's composerReducer): one pure reducer holds what the
 * reader is writing (the text), the images and where each upload stands (useImageUploads.ts follows the uploads and
 * hands each change here), whether the post is being sent, the server's refusal, and the draft's key; composerView()
 * says what follows from them. The counts use the server's own normalisation (normalizePostBody, postLength), so what
 * the composer allows is exactly what the API accepts. The parts (ComposerField, ProgressRing, SendBar, the image tray)
 * draw from it and keep no state of their own.
 */

export type ComposerKind = "post" | "reply" | "quote";

export const kindOf = (context: DraftContext): ComposerKind => (context === "post" ? "post" : context.startsWith("reply:") ? "reply" : "quote");

export interface ComposerState {
  /** The draft's key: a new post, a reply to a post, a quote of a post. */
  context: DraftContext;
  text: string;
  images: ComposerImage[];
  /** The post is on its way to the server. */
  busy: boolean;
  /** The server's refusal of the last send, in the app's words. */
  error: string | null;
}

export type ComposerAction =
  | { type: "type"; text: string }
  | { type: "images"; images: ComposerImage[] }
  | { type: "send" }
  | { type: "sent" }
  | { type: "failed"; error: string }
  | { type: "discard" };

/** A composer as it opens: empty, or with the draft kept for its context. */
export function initialComposer(context: DraftContext, text = ""): ComposerState {
  return { context, text, images: [], busy: false, error: null };
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "type":
      return { ...state, text: action.text };
    case "images":
      return { ...state, images: action.images };
    case "send":
      // Only a post that may go is sent, once: a second press while it is out changes nothing.
      return composerView(state).ready ? { ...state, busy: true, error: null } : state;
    case "sent":
      return initialComposer(state.context);
    case "failed":
      return { ...state, busy: false, error: action.error };
    case "discard":
      return initialComposer(state.context);
  }
}

/** From this many characters the ring turns review-ink; past POST_MAX_LENGTH, danger-ink. */
export const COUNT_NEAR = 900;
/** The ring shows the number left once this many or fewer remain. */
export const RING_NUMBER_AT = 100;

export type RingTone = "accent" | "review-ink" | "danger";

/** The ring (6.15): how full it is, its colour, and the number beside it ("12", then "-3" over the limit). */
export interface Ring {
  progress: number;
  tone: RingTone;
  number: string | null;
}

export function ring(length: number): Ring {
  const left = POST_MAX_LENGTH - length;
  return {
    progress: Math.min(1, Math.max(0, length / POST_MAX_LENGTH)),
    tone: length > POST_MAX_LENGTH ? "danger" : length >= COUNT_NEAR ? "review-ink" : "accent",
    number: left <= RING_NUMBER_AT ? String(left) : null,
  };
}

/**
 * Whether a change of the count crosses 900 or 1000, either way: the only changes the field's count is announced on, so
 * a screen reader hears that the end is near or passed without hearing every keystroke.
 */
export function crossed(before: number, after: number): boolean {
  return before < COUNT_NEAR !== after < COUNT_NEAR || before > POST_MAX_LENGTH !== after > POST_MAX_LENGTH;
}

export interface ComposerView {
  kind: ComposerKind;
  length: number;
  /** Text or an image: closing then asks first. */
  hasContent: boolean;
  /** The Post button can send now. */
  ready: boolean;
  /** What the images still need, in the words the button then shows; null when they need nothing. */
  missing: string | null;
  /** The Post button's words: Posting... while it sends, else what is missing, else Post, Reply or Quote. */
  button: string;
  /** "{n} of 1000 characters", the field's description. */
  count: string;
  ring: Ring;
}

const ACTION: Record<ComposerKind, string> = { post: UI_WORDS["composer.action.post"], reply: UI_WORDS["composer.action.reply"], quote: UI_WORDS["composer.action.quote"] };

export function composerView(state: ComposerState): ComposerView {
  const kind = kindOf(state.context);
  const length = postLength(normalizePostBody(state.text));
  const { waiting, failed, undescribed } = describeState(state.images);
  const hasContent = length >= 1 || state.images.length >= 1;
  // While images hold the post back, the button says what is missing, what the reader can act on first; its accessible
  // name is then that sentence, so a screen reader hears the reason too.
  const missing = failed ? UI_WORDS["composer.missing.failed"] : undescribed ? UI_WORDS["composer.missing.undescribed"] : waiting ? UI_WORDS["composer.missing.waiting"] : null;
  const ready = hasContent && length <= POST_MAX_LENGTH && missing === null && !state.busy;
  return {
    kind,
    length,
    hasContent,
    ready,
    missing,
    button: state.busy ? UI_WORDS["composer.posting"] : (missing ?? ACTION[kind]),
    count: fill(UI_WORDS["composer.count"], { n: length }),
    ring: ring(length),
  };
}
```

### Create `apps/app/src/lib/composing.ts`

```ts
import { useSyncExternalStore } from "react";

/**
 * Whether the app's one New post sheet is open (UI design, sections 7.2 and 7.3). The nav's New post (rail and full nav)
 * and the phone's compose button open it from any screen; the sheet itself is mounted once, in the root layout
 * (components/social/ComposeHost.tsx), so the shell need not load the composer to offer it. On Home from 768 px the
 * nav's button opens Home's own card instead (AppShell's onNewPost).
 */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export const openNewPost = (): void => set(true);
export const closeNewPost = (): void => set(false);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = () => open;

export function useNewPostOpen(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
```

### Create `apps/app/src/lib/drafts.ts`

```ts
/**
 * Drafts on the device (UI design, decision 18, sections 6.15 and 8.8): what the reader is writing, its text and never
 * its images, kept in this browser's storage under korbat.drafts.<accountId>, one entry per context: a new post
 * (`post`), a reply to a post (`reply:<id>`) and a quote of a post (`quote:<id>`). A composer writes its text 500 ms
 * after typing stops and when it leaves the screen, and removes it when the post is sent or the draft discarded.
 * Where there is no browser storage (native, until sub-project 5 chooses a storage library), or the browser refuses it,
 * drafts live in this module's memory for the session instead. This is the only module in src that touches those keys
 * (explore.test.tsx holds the app's stores to a list); the session's end clears every one of them, whatever the account,
 * through clearDrafts() (lib/session-end.ts), as Task 8's "Clear what this device keeps" will. A reader who is signed
 * out keeps no draft.
 */

export const DRAFT_PREFIX = "korbat.drafts.";

/** How long after the last keystroke the text is written. */
export const DRAFT_SAVE_MS = 500;

/** Where a draft belongs: a new post, or a reply to or a quote of one post. */
export type DraftContext = "post" | `reply:${string}` | `quote:${string}`;

/** The context of a composer: a reply to `replyToId`, a quote of `quoteOfId`, or else a new post. */
export function draftContext(replyToId?: string | null, quoteOfId?: string | null): DraftContext {
  if (replyToId) return `reply:${replyToId}`;
  if (quoteOfId) return `quote:${quoteOfId}`;
  return "post";
}

export function draftKey(accountId: string): string {
  return `${DRAFT_PREFIX}${accountId}`;
}

/** Browser storage, typed locally as lib/reading-place.ts types it; every access is guarded, since a private window or blocked storage throws. */
interface Store {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The session's memory, for a platform without browser storage: the same shape, gone when the app ends. */
const memory = new Map<string, string>();
const memoryStore: Store = {
  get length() {
    return memory.size;
  },
  key: (index) => [...memory.keys()][index] ?? null,
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

/** The browser's storage, or the memory where there is none (native) or the browser will not say. */
function store(): Store {
  try {
    return (globalThis as unknown as { localStorage?: Store }).localStorage ?? memoryStore;
  } catch {
    return memoryStore;
  }
}

type Drafts = Partial<Record<DraftContext, string>>;

/** Every draft an account has here; a damaged record is none. */
function readDrafts(accountId: string): Drafts {
  try {
    const raw = store().getItem(draftKey(accountId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Drafts) : {};
  } catch {
    return {};
  }
}

function writeDrafts(accountId: string, drafts: Drafts): void {
  try {
    if (Object.keys(drafts).length === 0) store().removeItem(draftKey(accountId));
    else store().setItem(draftKey(accountId), JSON.stringify(drafts));
  } catch {
    // A full or refused store keeps the draft on screen only; nothing else depends on it.
  }
}

/** The kept text of one context, or "" when there is none. */
export function readDraft(accountId: string, context: DraftContext): string {
  const text = readDrafts(accountId)[context];
  return typeof text === "string" ? text : "";
}

/** Keeps a context's text; blank text is no draft, and removes the one kept. */
export function writeDraft(accountId: string, context: DraftContext, text: string): void {
  const drafts = readDrafts(accountId);
  if (text.trim() === "") delete drafts[context];
  else drafts[context] = text;
  writeDrafts(accountId, drafts);
}

export function removeDraft(accountId: string, context: DraftContext): void {
  const drafts = readDrafts(accountId);
  if (!(context in drafts)) return;
  delete drafts[context];
  writeDrafts(accountId, drafts);
}

/** Every drafts key in a store. */
function draftKeys(from: Store): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < from.length; index++) {
      const key = from.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
  } catch {
    // Storage that cannot be read holds nothing this module can find.
  }
  return keys;
}

/** Whether any account's draft is kept here: the session's first 401 then means a session that ended while away. */
export function draftsStored(): boolean {
  return draftKeys(store()).length > 0;
}

/** Forgets every account's drafts, in the browser and in memory (the session's end; Task 8's "Clear what this device keeps"). */
export function clearDrafts(): void {
  for (const from of new Set([store(), memoryStore])) {
    for (const key of draftKeys(from)) {
      try {
        from.removeItem(key);
      } catch {
        // What cannot be removed cannot be read back either.
      }
    }
  }
}

/** One composer's draft: what it typed, written once typing stops; removed when sent or discarded. */
export interface DraftKeeper {
  typed(text: string): void;
  sent(): void;
  discarded(): void;
  /** The composer leaves: what waits is written now. */
  dispose(): void;
}

export function createDraftKeeper(accountId: string | null, context: DraftContext): DraftKeeper {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: string | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    waiting = null;
  };
  const flush = () => {
    if (accountId === null || waiting === null) return;
    const text = waiting;
    cancel();
    writeDraft(accountId, context, text);
  };
  const forget = () => {
    cancel();
    if (accountId !== null) removeDraft(accountId, context);
  };
  return {
    typed(text) {
      if (accountId === null) return;
      if (timer !== null) clearTimeout(timer);
      waiting = text;
      timer = setTimeout(flush, DRAFT_SAVE_MS);
    },
    sent: forget,
    discarded: forget,
    dispose: flush,
  };
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
import { ComposeHost } from "@/components/social/ComposeHost";
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
 * the session inside the theme, and the one Toaster beside the screens, inside the theme so toasts take its tokens. The
 * app's one New post sheet (Task 6) sits beside the screens inside the session, which it needs for the drafts.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <ComposeHost />
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

  // The phone's compose button shows here (section 7.2).
  return (
    <AppShell compose>
      {title}
      <BookmarksHeader />
      <PostList fetchPage={fetchPage} empty={{ title: UI_WORDS["bookmarks.empty.title"], body: UI_WORDS["bookmarks.empty"] }} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Redirect, router, useIsFocused, useLocalSearchParams } from "expo-router";
import type { MeResponse, PostView } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/kit/Skeleton";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { Text } from "@/components/kit/Text";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposerCard, type ComposerCardHandle } from "@/components/social/composer/ComposerCard";
import { ExploreList } from "@/components/social/ExploreList";
import { FeedList, type FeedListHandle } from "@/components/social/FeedList";
import { Button } from "@/components/ui";
import { insertPosted } from "@/lib/feed-cache";
import { usePageTitle } from "@/lib/page-title";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

export type Tab = "following" | "latest" | "explore";

const LABELS: Record<Tab, string> = { following: UI_WORDS["home.following"], latest: UI_WORDS["home.latest"], explore: UI_WORDS["home.explore"] };

/**
 * What a signed-out reader is told under the tabs: both lists are public, and an account adds the rest. Explore's prompt
 * must be true whatever the list turns out to hold, nothing or all there is, so it promises no more of Explore: the
 * list's own footer offers that, and only when the page says more posts exist.
 */
const SIGNED_OUT_PROMPTS: Record<Exclude<Tab, "following">, string> = {
  latest: "You are reading the latest public posts. Sign in to follow people and post.",
  explore: "Explore lists recent posts that other accounts like and repost. Sign in to follow people and post.",
};

/** Home's tabs in their order (2c design, section 11): Following first for an account, and Latest first for everyone else, who has no Following. */
export function homeTabs(signedIn: boolean): Tab[] {
  return signedIn ? ["following", "latest", "explore"] : ["latest", "explore"];
}

/**
 * The tab the address names (`/?tab=explore`), so another page can link to one; a missing or unknown name, or one the
 * reader does not have (Following, signed out), means the first tab. A parameter given twice counts by its first value.
 */
export function homeTab(param: string | string[] | undefined, signedIn: boolean): Tab {
  const tabs = homeTabs(signedIn);
  const named = Array.isArray(param) ? param[0] : param;
  return tabs.find((tab) => tab === named) ?? tabs[0]!;
}

/**
 * The key of Home's list: only another reader (an account's id, or none signed out) mounts a new list, which reads its
 * first page again (UI design, section 7.5). The reader is in it because a list read signed out has no cursor, offers a
 * sign-in and was read without any block or mute, and the web keeps a Home mounted under the sign-in screen, which Back
 * shows again once signed in. A tab change or a new post keeps the list: a tab's rows and place come back from
 * lib/feed-cache.ts, and the reader's own post is put on top.
 */
export function homeListKey(viewer: string | null): string {
  return viewer ?? "signed-out";
}

/** Home's panel, which its tabs control. */
const PANEL = "home-panel";

/**
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device. A card of its own (UI design,
 * section 8.2), its words as they were.
 */
function PasskeySuggestion({ me }: { me: MeResponse }) {
  const [platform, setPlatform] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(suggestionDismissedAt);
  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPlatform(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestPasskey({ passkeys: me.user.passkeys, platformAuthenticator: platform, dismissedAt, now: Date.now() })) return null;
  return (
    <View className="mx-4 mt-3 gap-1 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text as="h2" variant="title">
        {UI_WORDS["passkey.title"]}
      </Text>
      <Text tone="medium">{UI_WORDS["passkey.body"]}</Text>
      <View className="flex-row flex-wrap gap-x-2">
        <Button label={UI_WORDS["passkey.add"]} full={false} onPress={() => router.push("/settings/security?add=1")} />
        <Button
          label={UI_WORDS["passkey.notNow"]}
          tone="secondary"
          full={false}
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
        />
      </View>
    </View>
  );
}

/** What a signed-out reader reads above the list: what the tab holds, and the way to an account. */
function SignedOutPrompt({ tab }: { tab: Tab }) {
  return (
    <View className="mx-4 mt-3 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
      <Text tone="medium">{SIGNED_OUT_PROMPTS[tab === "explore" ? "explore" : "latest"]}</Text>
      <View className="flex-row">
        <Button label={UI_WORDS["nav.signin"]} onPress={() => router.push("/signin")} tone="secondary" full={false} />
      </View>
    </View>
  );
}

/**
 * Home (UI design, section 8.2): the header "Home" with the tabs under it, Following, Latest and Explore for a
 * signed-in account and Latest and Explore with a sign-in prompt for everyone else; then the tab's list, which keeps the
 * reader's place in Following and Latest. At 768 px and wider the composer is a card at the top of the list, collapsed to
 * "What's on your mind?" until it is focused or pressed (decision 19), and the nav's New post opens and focuses it
 * (AppShell's onNewPost); below, the compose button opens the app's New post sheet. The reader's own new post goes on
 * top of Following and Latest.
 */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const title = usePageTitle("title.home");
  const focused = useIsFocused();
  const { tab: param } = useLocalSearchParams<{ tab?: string }>();
  const feed = useRef<FeedListHandle>(null);
  const card = useRef<ComposerCardHandle>(null);

  const signedIn = state.status === "signed-in";
  const current = homeTab(param, signedIn);
  const header = (
    <ScreenHeader title={UI_WORDS["home.title"]}>
      <Tabs
        label={UI_WORDS["home.tabs"]}
        tabs={homeTabs(signedIn).map((key) => ({ key, label: LABELS[key] }))}
        selected={current}
        // The tab lives in the address, so a reload keeps it and other pages can link to one; setParams changes it in place.
        onSelect={(tab) => router.setParams({ tab })}
        panelId={PANEL}
      />
    </ScreenHeader>
  );
  const viewerId = state.status === "signed-in" ? state.me.user.id : null;
  const posted = useCallback(
    (post: PostView) => {
      // On top of both feeds: the one on screen now, and the other one as the session keeps it.
      insertPosted(viewerId, post);
      feed.current?.posted(post);
    },
    [viewerId],
  );

  if (state.status === "loading") {
    return (
      <AppShell>
        {title}
        {header}
        <HeaderSpace />
        <Skeleton.List kind="posts" count={5} />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const viewer = state.status === "signed-in" ? state.me.user.id : null;
  const select = (tab: Tab) => router.setParams({ tab });
  const inlineComposer = signedIn && width >= 768;
  // What scrolls above the posts: the sign-in prompt, the passkey card and, wider, the composer.
  const above = (
    <View>
      {signedIn ? null : <SignedOutPrompt tab={current} />}
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-line-low px-4 py-3">
          <ComposerCard handle={card} onPosted={posted} />
        </View>
      ) : null}
    </View>
  );

  return (
    <AppShell compose onNewPost={inlineComposer ? () => card.current?.open() : undefined}>
      {title}
      {header}
      <TabPanel panelId={PANEL} selected={current}>
        {current === "explore" ? (
          <ExploreList key={homeListKey(viewer)} onShowLatest={() => select("latest")} header={above} />
        ) : (
          <FeedList key={homeListKey(viewer)} handle={feed} feed={current} reader={viewer} active={focused} header={above} onShowLatest={() => select("latest")} />
        )}
      </TabPanel>
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/post/[id].tsx` (whole file)

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import type { ListHandle } from "@/components/list/List";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { ComposerCard, type ComposerCardHandle } from "@/components/social/composer/ComposerCard";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Button, TextLink } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { EXPLORE_WORDS, exploreStatusText } from "@/lib/explore";
import { insertPosted } from "@/lib/feed-cache";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/** A link of the status line: a 44 px target, as TextLink draws one. */
const LINE_LINK = cn("min-h-[44px] justify-center rounded-control active:opacity-70", FOCUS_RING);

/**
 * A post above the focused one, in the chain it replies to (UI design, section 8.3): a compact card joined to the next
 * by the 2 px thread line through the avatars; a post that is gone keeps its sentence, in the italic text face on a
 * surface-2 block, on the same line.
 */
function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="px-4 pb-1 pt-3">
        <View className="rounded-media bg-surface-2 px-3 py-2.5">
          <Text tone="medium" italic>
            {item.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
          </Text>
        </View>
      </View>
    );
  }
  return <PostCard post={item} joined />;
}

/**
 * The author's line under their own post (2c design, section 11): whether it is in Explore and, if not, which rule keeps
 * it out, in the formula's words and without any count, with the way to the rules and to the switch. Until the answer
 * comes, and if it fails, there is no line: the post is the screen, and the line only explains. It is asked again every
 * time the screen gains focus: the web keeps this screen mounted under the ones it links to, and Back shows it again as
 * it was, so after the switch is turned through the line's own link the line would otherwise still give the old reason.
 */
function ExploreStatusLine({ id }: { id: string }) {
  // The line with the post it was read for: the same post's line stays while it is asked again, and another post's never shows.
  const [line, setLine] = useState<{ id: string; text: string | null } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      social
        .exploreStatus(id)
        .then((answer) => {
          if (!cancelled) setLine({ id, text: exploreStatusText(answer.status) });
        })
        .catch(() => {
          if (!cancelled) setLine(null);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const text = line?.id === id ? line.text : null;
  if (!text) return null;
  return (
    <View className="px-4 pb-2">
      <Text variant="meta" tone="medium">
        {text}
      </Text>
      <View className="flex-row flex-wrap gap-x-4">
        <Link href="/explore/about" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {EXPLORE_WORDS.about}
            </Text>
          </Pressable>
        </Link>
        <Link href="/settings/privacy" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {UI_WORDS["thread.exploreSetting"]}
            </Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

/**
 * A post with the chain it replies to above it and its direct replies below, oldest first. Under the focused post, the
 * reply card (Task 6) at every width: "Write your reply", opening in place on focus; `?reply=1`, which a card's Reply
 * gives, opens it at once with the focus in it, and the focused post's own Reply opens it too. A reply sent reads the
 * replies again (and the composer's toast says it was sent). `?quote=1` opens the quote sheet, whose post goes on top of
 * Home's feeds; its toast's View opens it, where today's code went to it at once.
 */
export default function Thread() {
  const { id, quote, reply } = useLocalSearchParams<{ id: string; quote?: string; reply?: string }>();
  const { state } = useSession();
  const viewer = state.status === "signed-in" && state.me.user.onboarded ? state.me.user.id : null;
  const signedIn = viewer !== null;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");
  const replyCard = useRef<ComposerCardHandle>(null);
  const title = usePageTitle("title.post");
  const missingTitle = usePageTitle("title.postMissing");

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setError(null);
    // The id comes from the address bar; anything but a post id is refused before a request is built from it.
    if (!PostId.safeParse(id).success) {
      setError("That address is not a post.");
      return;
    }
    social
      .thread(id)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The screen stays mounted under the ones it links to, and Back shows it again as it was: on every focus after the
  // first, the post is read again into the thread on screen, without clearing it, so its card (the In Explore chip
  // included) follows a change made there. An id's first focus comes with the read above.
  const focusedFor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (focusedFor.current !== id) {
        focusedFor.current = id;
        return undefined;
      }
      // An address that is not a post has its error on screen already, and no request may be built from it.
      if (!PostId.safeParse(id).success) return undefined;
      let cancelled = false;
      social
        .getPost(id)
        .then((post) => {
          if (!cancelled) setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));
        })
        // What is on screen stays: the next focus asks again.
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  // A new `version` (a reply sent here) is a new source, which the list reads again from its first page; the list and its
  // header, where the reply card holds the focus, stay mounted.
  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id, version]);

  // The page opens with the focused post at the top of the view and its ancestors above it, kept there by the list's
  // anchor while they and the replies are drawn (section 7.5); a reply written here reads the replies again, not the post.
  const list = useRef<ListHandle>(null);
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!thread || opened.current === thread.post.id || thread.ancestors.length === 0) return;
    opened.current = thread.post.id;
    list.current?.hold("focused");
  }, [thread]);

  if (error) {
    return (
      <AppShell>
        {missingTitle}
        <ScreenHeader title={UI_WORDS["thread.missing"]} back="/" />
        <HeaderSpace />
        <View className="items-start gap-2 px-4 py-6">
          <Text tone="medium">{error}</Text>
          <TextLink label={UI_WORDS["thread.back"]} href="/" replace />
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        {title}
        <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={1} />
      </AppShell>
    );
  }

  const mine = viewer !== null && thread.post.author.id === viewer;
  const header = (
    <View>
      <View {...dataAttribute("thread")}>
        {thread.ancestors.map((item) => (
          <AncestorRow key={item.id} item={item} />
        ))}
        {/* The focused post, which the list holds at the top when the page opens. */}
        <View {...dataAttribute("row", "focused")} className="border-b border-line-low">
          <PostCard post={thread.post} large onDeleted={() => router.replace("/")} onReply={signedIn ? () => replyCard.current?.open() : undefined} />
          {/* Replies and quotes never enter Explore, so they get no line and no request. */}
          {mine && thread.post.replyTo === null && thread.post.quoteOf === null ? <ExploreStatusLine id={thread.post.id} /> : null}
          {signedIn ? (
            <View className="flex-row justify-end px-4 pb-3">
              <View className="-mt-6">
                <Button label={UI_WORDS["thread.quote"]} tone="secondary" full={false} onPress={() => setQuoting(true)} />
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {signedIn ? (
        <View className="border-b border-line-low px-4 py-3">
          <ComposerCard
            key={thread.post.id}
            handle={replyCard}
            replyTo={thread.post}
            startOpen={reply === "1"}
            onPosted={() => {
              // The replies are read again; the focused post counts the new one at once, without reading the thread.
              setThread((current) => (current ? { ...current, post: { ...current.post, counts: { ...current.post.counts, replies: current.post.counts.replies + 1 } } } : current));
              setVersion((v) => v + 1);
            }}
          />
        </View>
      ) : (
        <View className="border-b border-line-low px-4 py-1">
          <TextLink label={UI_WORDS["thread.signIn"]} href="/signin" />
        </View>
      )}
    </View>
  );

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
      <PostList handle={list} fetchPage={fetchReplies} empty={UI_WORDS["thread.empty"]} header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => insertPosted(viewer, post)} />
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
              <Button label={UI_WORDS["profile.settings"]} onPress={() => router.push("/settings/security")} tone="secondary" full={false} />
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

### Replace `apps/app/src/components/kit/Sheet.tsx` (whole file)

```tsx
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
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
 * sees this; the composer (Task 6) is the first to pass its own width (640) and to ask its own question before closing.
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
  const share = phone && size === "tall" ? 0.9 : 0.85;
  // On the web the share of the visual viewport (dvh), so a sheet shrinks above the on-screen keyboard (section 7.4).
  const maxHeight = Platform.OS === "web" ? (`${Math.round(share * 100)}dvh` as unknown as number) : screen.height > 0 ? Math.round(screen.height * share) : undefined;
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

/**
 * Room for the on-screen keyboard (section 7.4): natively React Native's KeyboardAvoidingView, until sub-project 5 brings
 * react-native-keyboard-controller; on the web nothing, since the sheet's height follows the visual viewport (dvh).
 */
function KeyboardRoom({ children }: { children: ReactNode }) {
  if (Platform.OS === "web") return <>{children}</>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      {children}
    </KeyboardAvoidingView>
  );
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
        <KeyboardRoom>
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
        </KeyboardRoom>
      </GestureHandlerRootView>
    </Modal>
  );
}
```

### Replace `apps/app/src/components/social/ComposeSheet.tsx` (whole file)

```tsx
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import type { PostView } from "@korbat/contracts";
import { Sheet } from "@/components/kit/Sheet";
import { Text } from "@/components/kit/Text";
import { useSession } from "@/lib/session";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { Composer } from "./Composer";
import type { ComposerKind } from "./composer/state";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted?: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/** The sheet's titles (8.6), as the composer's sheet always had them; they name the dialog. */
export const COMPOSE_TITLE: Record<ComposerKind, string> = { post: UI_WORDS["composer.title.post"], reply: UI_WORDS["composer.title.reply"], quote: UI_WORDS["composer.title.quote"] };

/**
 * What a request to close does (sections 6.8 and 8.6): an empty composer closes at once; one with content asks first;
 * and a request while the question shows (Escape again) withdraws the question and goes back to writing.
 */
export function closeStep(dirty: boolean, asking: boolean): "close" | "ask" | "keep" {
  if (asking) return "keep";
  return dirty ? "ask" : "close";
}

/**
 * The composer as a sheet (UI design, sections 6.8 and 8.6): kit/Sheet's bottom sheet with its handle below 768 px and a
 * 640 px dialog wider up, titled "New post", "Reply" or "Quote", with the focus in the field as it opens and back on the
 * opener as it closes. Every way to close it (Cancel, Escape, the scrim, a drag) comes through the Sheet's onClose, which
 * asks the discard question when the draft has content and closes at once when it is empty; the scrim stays no tab
 * stop and hidden from assistive technology, as Task 4's Sheet draws it. Sending closes it at once (the composer shows
 * the toast). While /me shows a running suspension or termination (3e, 9.4), the refusal replaces the fields.
 */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  const { state } = useSession();
  const standing = state.status === "signed-in" ? state.me.standing : null;
  const refused = runningMeasure(standing) !== null;
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  // A sheet opened again starts with no question.
  useEffect(() => {
    if (!open) {
      setAsking(false);
      setDirty(false);
    }
  }, [open]);
  const kind: ComposerKind = replyTo ? "reply" : quoteOf ? "quote" : "post";
  const requestClose = () => {
    const step = closeStep(dirty && !refused, asking);
    if (step === "close") onClose();
    else setAsking(step === "ask");
  };
  return (
    <Sheet open={open} onClose={requestClose} title={COMPOSE_TITLE[kind]} width={640} size="tall" initialFocus="first">
      <View className="px-5 pb-2 pt-1">
        {refused ? (
          <View className="gap-2">
            <Text accessibilityRole="alert">{refusalSentence(standing)}</Text>
            <Text variant="meta" tone="medium">
              {fill(UI_WORDS["composer.refused.where"], { read: STANDING_TEXTS.refused.read })}
            </Text>
          </View>
        ) : (
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            // On the web the Sheet moves the focus into the field once it is open (initialFocus "first"), after the
            // Modal has noted the opener it gives the focus back to; a field focused as it mounts would be noted instead.
            autoFocus={Platform.OS !== "web"}
            onDirtyChange={setDirty}
            onCancel={requestClose}
            asking={asking}
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              setDirty(false);
              onClose();
            }}
            onPosted={(post) => {
              setDirty(false);
              onPosted?.(post);
              onClose();
            }}
          />
        )}
      </View>
    </Sheet>
  );
}
```

### Replace `apps/app/src/components/social/Composer.tsx` (whole file)

```tsx
import { useEffect, useImperativeHandle, useReducer, useRef, type Ref } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";
import { MEDIA_MAX_PER_POST, type PostView } from "@korbat/contracts";
import { Text } from "@/components/kit/Text";
import { toast } from "@/components/toast";
import { errorMessage } from "@/lib/api";
import { createDraftKeeper, draftContext, readDraft } from "@/lib/drafts";
import { useHaptics } from "@/lib/haptics";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { ComposerField } from "./composer/ComposerField";
import { DiscardDialog } from "./composer/DiscardDialog";
import { SendBar } from "./composer/SendBar";
import { composerReducer, composerView, initialComposer, type ComposerKind } from "./composer/state";
import { ComposerImages } from "./ComposerImages";
import { QuoteEmbed } from "./PostCard";
import { useImageUploads } from "./useImageUploads";

/** What sending says, by what was sent (section 5.4): the same name as the button had. */
const SENT: Record<ComposerKind, string> = { post: UI_WORDS["toast.sent.post"], reply: UI_WORDS["toast.sent.reply"], quote: UI_WORDS["toast.sent.quote"] };

/**
 * The toast after sending (UI design, sections 5.4 and 6.15): the sentence names what was sent, and its View opens the
 * new post. It is announced politely; the post's own place is in the sentence, so View is a convenience, not the only way.
 */
export function announceSent(kind: ComposerKind, post: PostView): void {
  toast.show({ message: SENT[kind], action: { label: UI_WORDS["toast.view"], onPress: () => router.push(`/post/${post.id}`) } });
}

/** What a card does with its composer: put the focus back in the field. */
export interface ComposerHandle {
  focus(): void;
}

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  /** Cancel in the send bar, which a sheet gives: it closes, asking first when there is content. */
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Told whenever the draft gains or loses content, so a sheet can ask before discarding it. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The discard question shows in place of the send bar (ComposeSheet asks it). */
  asking?: boolean;
  onKeep?: () => void;
  onDiscard?: () => void;
  /** The field lost the focus (a card closes itself when it is then empty). */
  onFieldBlur?: () => void;
  handle?: Ref<ComposerHandle>;
}

/**
 * One composer for posts, replies and quotes, with up to four images (UI design, section 6.15), on its parts: the field,
 * the image tray, the quoted post's preview (no live link in it), and the send bar with the ring and the Post button, or,
 * while a sheet asks, the discard question. composer/state.ts holds what is being written and says what follows; the
 * text is kept on the device per context (lib/drafts.ts) from the first keystroke, 500 ms after typing stops, and the
 * draft is removed when the post is sent or discarded. Sending fires the success haptic and the toast with View, and
 * hands the post on; the field keeps or gets back the focus as its container decides. States reach assistive
 * technology through aria-* props: react-native-web 0.21 ignores accessibilityState.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus, onDirtyChange, asking = false, onKeep, onDiscard, onFieldBlur, handle }: ComposerProps) {
  const { state: session } = useSession();
  const account = session.status === "signed-in" ? session.me.user.id : null;
  const context = draftContext(replyTo?.id, quoteOf?.id);
  const [state, dispatch] = useReducer(composerReducer, context, (opening) => initialComposer(opening, account ? readDraft(account, opening) : ""));
  const uploads = useImageUploads((images) => dispatch({ type: "images", images }));
  const view = composerView(state);
  const haptic = useHaptics();
  const field = useRef<TextInput>(null);

  // One keeper per account and context; leaving writes what is still waiting.
  const keeper = useRef(createDraftKeeper(account, context));
  useEffect(() => {
    const own = createDraftKeeper(account, context);
    keeper.current = own;
    return () => own.dispose();
  }, [account, context]);

  useEffect(() => {
    onDirtyChange?.(view.hasContent);
  }, [view.hasContent, onDirtyChange]);
  useImperativeHandle(handle, () => ({ focus: () => field.current?.focus() }), []);

  // When the question is withdrawn (Keep writing, or Escape while it asks), the focus goes back to the words.
  const wasAsking = useRef(asking);
  useEffect(() => {
    if (wasAsking.current && !asking) field.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const type = (text: string) => {
    dispatch({ type: "type", text });
    keeper.current.typed(text);
  };

  async function submit() {
    if (!view.ready) return;
    dispatch({ type: "send" });
    try {
      const post = await social.createPost({
        body: state.text,
        media: state.images.map((image) => ({ id: image.id!, alt: image.alt })),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
      });
      // Touch and sight on the same frame: the haptic before the composer empties.
      haptic("success");
      keeper.current.sent();
      uploads.clear();
      dispatch({ type: "sent" });
      announceSent(view.kind, post);
      onPosted?.(post);
    } catch (err) {
      dispatch({ type: "failed", error: errorMessage(err) });
    }
  }

  const discard = () => {
    keeper.current.discarded();
    dispatch({ type: "discard" });
    onDiscard?.();
  };

  const addImage = canPickImages && state.images.length < MEDIA_MAX_PER_POST ? () => void pickImages().then(uploads.add) : undefined;

  return (
    <View>
      <ComposerField fieldRef={field} kind={view.kind} value={state.text} onChangeText={type} length={view.length} autoFocus={autoFocus} onBlur={onFieldBlur} />
      <ComposerImages images={state.images} onAlt={uploads.setAlt} onRemove={uploads.remove} />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} preview /> : null}
      {uploads.notice ? (
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="mt-2">
          {uploads.notice}
        </Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" tone="danger" className="mt-2">
          {state.error}
        </Text>
      ) : null}
      {asking ? (
        <DiscardDialog onDiscard={discard} onKeep={() => onKeep?.()} />
      ) : (
        <SendBar onAddImage={addImage} length={view.length} onCancel={onCancel} label={view.button} ready={view.ready} busy={state.busy} onPost={() => void submit()} />
      )}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/ComposerImages.tsx` (whole file)

```tsx
import { Image } from "expo-image";
import { Link } from "expo-router";
import { Pressable, TextInput, View } from "react-native";
import { ALT_MAX_LENGTH, altLength, normalizeAltText } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text, textStyle, type Tone } from "@/components/kit/Text";
import { useAppearance } from "@/lib/appearance";
import { UPLOAD_TEXTS } from "@/lib/moderation-words";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useTheme } from "@/theme/ThemeProvider";
import type { IconName } from "../icons";
import type { ComposerImage } from "./useImageUploads";

/** Where each upload stands, in words, with an icon and a tone, so the status is never colour alone (section 4.8). */
const STATUS: Record<ComposerImage["status"], { words: string; icon: IconName | null; tone: Tone }> = {
  uploading: { words: UI_WORDS["composer.image.uploading"], icon: null, tone: "low" },
  processing: { words: UI_WORDS["composer.image.processing"], icon: null, tone: "low" },
  // A done upload shows the done icon in ink (green is In Explore's alone, section 4.8).
  ready: { words: UI_WORDS["composer.image.ready"], icon: "done", tone: "medium" },
  failed: { words: UI_WORDS["composer.image.failed"], icon: "error", tone: "danger" },
  refused: { words: UPLOAD_TEXTS.refused, icon: "error", tone: "danger" },
};

/** The preview's side (6.15): 88 px, in the media radius. */
const PREVIEW = 88;

/**
 * The image tray (UI design, section 6.15): the images of a post being written, each with an 88 px preview from the
 * chosen file, where its upload stands, and the description every image needs, with its counter and Remove. The counter
 * uses the server's rule, so what it allows is what the API accepts.
 */
export function ComposerImages({ images, onAlt, onRemove }: { images: ComposerImage[]; onAlt: (key: string, alt: string) => void; onRemove: (key: string) => void }) {
  const { colors } = useTheme();
  const appearance = useAppearance();
  if (images.length === 0) return null;
  return (
    <View className="mt-3 gap-3">
      {images.map((image, index) => {
        const length = altLength(normalizeAltText(image.alt));
        const name = fill(UI_WORDS["composer.image.name"], { n: index + 1 });
        const status = STATUS[image.status];
        return (
          <View key={image.key} className="flex-row gap-3 rounded-card border border-line-low p-2">
            {/* 3d Task 7 (9.5): a refused upload is shown to nobody, its uploader included: no preview stands for it. */}
            {image.status === "refused" ? (
              <View accessibilityLabel={fill(UI_WORDS["composer.image.refused"], { name })} style={{ width: PREVIEW, height: PREVIEW }} className="items-center justify-center rounded-media bg-surface-2">
                <Icon name="hidden" size={20} tone="medium" />
              </View>
            ) : (
              <View className="overflow-hidden rounded-media border border-line-low" style={{ width: PREVIEW, height: PREVIEW }}>
                <Image source={{ uri: image.previewUrl }} contentFit="cover" accessibilityLabel={fill(UI_WORDS["composer.image.preview"], { name })} style={{ width: "100%", height: "100%" }} />
              </View>
            )}
            <View className="min-w-0 flex-1 gap-1">
              <View accessibilityLiveRegion="polite" className="min-h-[20px] flex-row items-center gap-1.5">
                {status.icon ? <Icon name={status.icon} size={16} tone={status.tone} /> : null}
                <Text variant="meta" tone={status.tone} className="shrink">
                  {image.status === "failed" && image.error ? image.error : status.words}
                </Text>
              </View>
              {image.status === "refused" && image.refusalId ? (
                <Link href={`/settings/cases/uploads/${image.refusalId}`} asChild>
                  <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
                    <Text variant="meta" tone="accent" className="underline web:underline-offset-2">
                      {UPLOAD_TEXTS.why}
                    </Text>
                  </Pressable>
                </Link>
              ) : null}
              <TextInput
                accessibilityLabel={fill(UI_WORDS["composer.image.description"], { name })}
                placeholder={UI_WORDS["composer.image.placeholder"]}
                placeholderTextColor={colors["ink-low"]}
                multiline
                value={image.alt}
                onChangeText={(alt) => onAlt(image.key, alt)}
                className={cn("min-h-[44px] rounded-control border border-line-high bg-surface-1 px-3 py-2 text-ink-high", FOCUS_RING)}
                style={textStyle("body", { step: appearance.textStep, font: appearance.font })}
              />
              <View className="flex-row items-center justify-between">
                <Text variant="meta" tone={length > ALT_MAX_LENGTH ? "danger" : "low"}>
                  {length}/{ALT_MAX_LENGTH}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fill(UI_WORDS["composer.image.remove"], { name })}
                  onPress={() => onRemove(image.key)}
                  className={cn("min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-2 active:bg-surface-2 web:hover:bg-surface-2", FOCUS_RING)}
                >
                  <Text variant="meta" tone="medium" className="underline web:underline-offset-2">
                    {UI_WORDS["composer.image.removeWord"]}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
```

### Replace `apps/app/src/components/social/FeedList.tsx` (whole file)

```tsx
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from "react";
import { AppState, Platform, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { PostView, TimelineItem } from "@korbat/contracts";
import { List, useStable, type ListHandle } from "@/components/list/List";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { onPosted, readFeedCache, writeFeedCache, type FeedSnapshot } from "@/lib/feed-cache";
import { feedRows, timelineTime, trimOlder, type FeedName, type FeedRow } from "@/lib/feed-rows";
import { useMotion } from "@/lib/motion";
import { createNewPosts, gapRows, NEW_LIMIT, newRows, pageVisible, pollActive, type NewPostsClock } from "@/lib/new-posts";
import { createPlaceKeeper, openingRow, readPlace, type Place, type PlaceKeeper, type PlaceRow } from "@/lib/reading-place";
import { useShellScroll } from "@/lib/shell-scroll";
import { social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { FeedRowView, feedRowVersion, type PostPlace } from "./FeedRows";
import { NewPostsPill } from "./NewPostsPill";
import { timelineKey } from "./PagedList";
import { PostCard } from "./PostCard";

/**
 * Home's Following and Latest (UI design, sections 7.5 and 8.2; decisions 6 to 9): a feed that keeps the reader's place.
 *
 * - It opens where the reader stopped (lib/reading-place.ts) when that post is among the newest 100: page one is read
 *   with limit=50, and a second page of 50 when the place is not in the first, before anything shows; otherwise, or with
 *   "Open feeds at the newest post", it opens at the newest. The marker sits above the first post the reader had already
 *   seen, and the pill counts the posts above the place that are newer than that.
 * - A tab change keeps it mounted (Home keys it by the reader only): the feed it leaves is kept for the session with its
 *   rows, cursor and place (lib/feed-cache.ts), and the feed it opens comes back from there without asking page one again.
 * - New posts are asked for 30 s after it opens and every 60 s, only while Home is focused and the page visible
 *   (lib/new-posts.ts); they are put above the reader's row, which does not move, and the pill counts them until they
 *   have come into view. All 50 new gives the gap row, which reads the rest on demand.
 * - The reader's own new post goes on top; at the top of the feed it fades in and pushes the rows down (new-own-post).
 * - Load more stays at the end of each page; with "Load older posts automatically" the next page loads two screens
 *   before the end, but not below the marker. Past 300 rows the oldest pages go and come back through Load more.
 *
 * A signed-out reader gets none of the place, the marker, the pill or the asking: Latest as it is, with Load more.
 */

export interface FeedListHandle {
  /** The reader's own new post, on top of this feed. */
  posted(post: PostView): void;
}

/** Home's feeds read 50 posts a page, the most Pagination allows, so the place is found in two pages (decision 9). */
const FEED_LIMIT = 50;

const fetchFeed = (feed: FeedName, cursor?: string, limit = FEED_LIMIT): Promise<Page<TimelineItem>> => (feed === "following" ? social.following(cursor, limit) : social.latest(cursor, limit));

const placeRow = (item: TimelineItem): PlaceRow => ({ key: timelineKey(item), time: timelineTime(item) });

interface FeedState {
  feed: FeedName;
  items: TimelineItem[];
  cursor: string | null;
  ends: [string, string | null][];
  status: "loading" | "ready" | "error";
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  gap: { after: string; cursor: string } | null;
  gapBusy: boolean;
  /** The newest post the reader had seen when the feed opened: the marker's place. */
  marker: PlaceRow | null;
  caughtUp: boolean;
  /** New posts above the reader that have not come into view yet: the pill's count. */
  unread: string[];
}

const loading = (feed: FeedName): FeedState => ({
  feed,
  items: [],
  cursor: null,
  ends: [],
  status: "loading",
  error: null,
  loadingMore: false,
  moreError: null,
  gap: null,
  gapBusy: false,
  marker: null,
  caughtUp: false,
  unread: [],
});

/** The last row of a page, with the cursor its page gave: where the oldest rows can be cut and read again. */
const pageEnd = (page: Page<TimelineItem>): [string, string | null][] => (page.items.length > 0 ? [[timelineKey(page.items.at(-1)!), page.nextCursor]] : []);

/** The index of the first post at or below a row of the list: the post the reader sees at the top. */
function postAt(rows: readonly FeedRow<TimelineItem>[], items: readonly TimelineItem[], key: string | null): number {
  const at = key === null ? -1 : rows.findIndex((row) => row.key === key);
  if (at < 0) return -1;
  const post = rows.slice(at).find((row) => row.kind === "post");
  return post ? items.findIndex((item) => timelineKey(item) === post.key) : items.length;
}

export function FeedList({
  feed,
  reader,
  active,
  header,
  onShowLatest,
  handle,
}: {
  feed: FeedName;
  /** The signed-in account's id, or null signed out. */
  reader: string | null;
  /** Home has the focus (a screen above it does not cover it). */
  active: boolean;
  header?: ReactElement;
  onShowLatest: () => void;
  handle?: Ref<FeedListHandle>;
}) {
  const appearance = useAppearance();
  const motion = useMotion();
  const scroll = useShellScroll();
  const [state, setState] = useState<FeedState>(() => loading(feed));
  const [visible, setVisible] = useState(pageVisible);
  const list = useRef<ListHandle>(null);
  const sequence = useRef(0);
  const keeper = useRef<PlaceKeeper | null>(null);
  const clock = useRef<NewPostsClock | null>(null);
  const pendingHold = useRef<{ key: string; offset: number } | null>(null);
  /** The reader's own new post, which fades in where it lands. */
  const own = useRef<string | null>(null);
  // The latest state and settings, for the callbacks that rows and timers keep.
  const latest = useRef({ state, openNewest: appearance.openNewest, rows: [] as FeedRow<TimelineItem>[], top: null as string | null });
  latest.current.state = state;
  latest.current.openNewest = appearance.openNewest;

  /** Page one, and page two when the place is not in page one, then the feed as it opens. */
  const open = useStable(async (place: Place | null, mine: number) => {
    try {
      const first = await fetchFeed(feed);
      if (mine !== sequence.current) return;
      let items = first.items;
      let cursor = first.nextCursor;
      const ends = pageEnd(first);
      const openNewest = latest.current.openNewest;
      let at = openingRow(items.map(placeRow), place, openNewest);
      if (!at && place && !openNewest && cursor !== null && !items.some((item) => timelineKey(item) === place.top.key)) {
        const second = await fetchFeed(feed, cursor);
        if (mine !== sequence.current) return;
        const known = new Set(items.map(timelineKey));
        const both = [...items, ...second.items.filter((item) => !known.has(timelineKey(item)))];
        at = openingRow(both.map(placeRow), place, false);
        if (at) {
          items = both;
          cursor = second.nextCursor;
          ends.push(...pageEnd(second));
        }
      }
      const marker = reader && place ? place.newest : null;
      const top = at ? items.findIndex((item) => timelineKey(item) === at) : 0;
      // The posts above the place that are newer than the newest the reader had seen: the pill counts them.
      const unread = marker ? items.slice(0, top).filter((item) => Date.parse(timelineTime(item)) > Date.parse(marker.time)).map(timelineKey) : [];
      pendingHold.current = at ? { key: at, offset: 0 } : null;
      setState({ ...loading(feed), items, cursor, ends, status: "ready", marker, unread });
    } catch (err) {
      if (mine === sequence.current) setState({ ...loading(feed), status: "error", error: errorMessage(err) });
    }
  });

  // Opening a feed, at mount and on a tab change: from the session's cache, else from the API. Leaving it keeps it in
  // the cache and writes the place. A layout effect, so the old feed's rows are never painted under the new tab.
  useLayoutEffect(() => {
    const mine = ++sequence.current;
    const place = reader ? readPlace(reader, feed) : null;
    keeper.current = createPlaceKeeper(reader, feed, place);
    // The list stays mounted across tabs: the feed it opens starts at its own top, or at the row it was left at.
    list.current?.toTop(false);
    const kept = readFeedCache(reader, feed);
    if (kept) {
      pendingHold.current = kept.view;
      setState({ ...loading(feed), items: kept.items, cursor: kept.cursor, ends: kept.ends, gap: kept.gap, marker: kept.marker, unread: kept.unread, status: "ready" });
    } else {
      setState(loading(feed));
      void open(place, mine);
    }
    return () => {
      sequence.current++;
      const left = latest.current.state;
      if (left.feed === feed && left.status === "ready") {
        const snapshot: FeedSnapshot = { items: left.items, cursor: left.cursor, ends: left.ends, gap: left.gap, marker: left.marker, unread: left.unread, view: list.current?.view() ?? null };
        writeFeedCache(reader, feed, snapshot);
      }
      keeper.current?.hidden();
      keeper.current?.dispose();
      keeper.current = null;
    };
  }, [feed, reader]);

  const result = feedRows({
    items: state.items,
    keyOf: timelineKey,
    timeOf: timelineTime,
    status: state.feed === feed ? state.status : "loading",
    error: state.error,
    cursor: state.cursor,
    loadingMore: state.loadingMore,
    moreError: state.moreError,
    marker: state.marker ? { time: state.marker.time, caughtUp: state.caughtUp } : null,
    gap: state.gap ? { after: state.gap.after, busy: state.gapBusy } : null,
    feed,
    autoLoad: appearance.autoLoad,
  });
  latest.current.rows = result.rows;

  // Once the rows are drawn, the list shows the place (or the row a tab left at); with the marker right above the place,
  // the marker, so "You were here" is the first thing the reader sees.
  useLayoutEffect(() => {
    const hold = pendingHold.current;
    if (!hold || state.status !== "ready") return;
    pendingHold.current = null;
    const at = result.rows.findIndex((row) => row.key === hold.key);
    const key = hold.offset === 0 && at > 0 && result.rows[at - 1]!.kind === "marker" ? "marker" : hold.key;
    list.current?.hold(key, hold.offset);
  }, [state]);

  // The page hidden: the place is written now, and nothing is asked until it is visible again.
  useEffect(() => {
    const change = (shown: boolean) => {
      setVisible(shown);
      if (!shown) keeper.current?.hidden();
    };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const onVisibility = () => change(pageVisible());
      const onHide = () => keeper.current?.hidden();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onHide);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onHide);
      };
    }
    const subscription = AppState.addEventListener("change", (next) => change(next === "active"));
    return () => subscription.remove();
  }, []);

  /** Rows put above the reader's: from a poll they are unread and keep the reader's row in place. */
  const insertAbove = (added: TimelineItem[], gapCursor: string | null, unread: boolean) => {
    setState((current) => {
      const keys = added.map(timelineKey);
      let items = [...added, ...current.items];
      let cursor = current.cursor;
      let ends = current.ends;
      const trimmed = trimOlder(items, timelineKey, new Map(ends));
      if (trimmed) {
        items = trimmed.items;
        cursor = trimmed.cursor;
        const kept = new Set(items.map(timelineKey));
        ends = ends.filter(([key]) => kept.has(key));
      }
      return {
        ...current,
        items,
        cursor,
        ends,
        unread: unread ? [...keys, ...current.unread] : current.unread,
        caughtUp: unread ? false : current.caughtUp,
        gap: gapCursor && keys.length > 0 ? { after: keys.at(-1)!, cursor: gapCursor } : current.gap,
      };
    });
  };

  /** The poll: page one of 50, and the posts above the first one listed. */
  const ask = useStable(async () => {
    const asked = latest.current.state;
    if (asked.status !== "ready" || asked.feed !== feed) return;
    const page = await fetchFeed(feed, undefined, NEW_LIMIT);
    const now = latest.current.state;
    if (now.status !== "ready" || now.feed !== feed) return;
    const { added, gapCursor } = newRows(page, timelineKey, new Set(now.items.map(timelineKey)));
    if (added.length === 0) return;
    // Nothing the reader reads moves: the row at the top stays where it is, even at the very top.
    list.current?.keepNext();
    insertAbove(added, gapCursor, true);
  });

  // The clock runs per feed for an account, and only while Home is focused, the page visible and the feed in.
  useEffect(() => {
    if (!reader) return undefined;
    const made = createNewPosts(ask);
    clock.current = made;
    return () => {
      made.dispose();
      clock.current = null;
    };
  }, [feed, reader]);
  useEffect(() => {
    clock.current?.setActive(pollActive({ focused: active, signedIn: reader !== null, selected: true, visible }) && state.status === "ready");
  }, [active, visible, state.status, feed, reader]);

  const more = useStable(async () => {
    const current = latest.current.state;
    if (current.loadingMore || current.cursor === null) return;
    const mine = sequence.current;
    setState((now) => ({ ...now, loadingMore: true, moreError: null }));
    try {
      const page = await fetchFeed(feed, current.cursor);
      if (mine !== sequence.current) return;
      setState((now) => {
        const known = new Set(now.items.map(timelineKey));
        return { ...now, items: [...now.items, ...page.items.filter((item) => !known.has(timelineKey(item)))], cursor: page.nextCursor, ends: [...now.ends, ...pageEnd(page)], loadingMore: false };
      });
    } catch (err) {
      if (mine === sequence.current) setState((now) => ({ ...now, loadingMore: false, moreError: errorMessage(err) }));
    }
  });

  const fillGap = useStable(async () => {
    const current = latest.current.state;
    if (!current.gap || current.gapBusy) return;
    const mine = sequence.current;
    setState((now) => ({ ...now, gapBusy: true }));
    try {
      const page = await fetchFeed(feed, current.gap.cursor, NEW_LIMIT);
      if (mine !== sequence.current) return;
      setState((now) => {
        if (!now.gap) return { ...now, gapBusy: false };
        const { added, gapCursor } = gapRows(page, timelineKey, new Set(now.items.map(timelineKey)));
        const at = now.items.findIndex((item) => timelineKey(item) === now.gap!.after) + 1;
        const items = [...now.items.slice(0, at), ...added, ...now.items.slice(at)];
        return { ...now, items, gapBusy: false, gap: gapCursor && added.length > 0 ? { after: timelineKey(added.at(-1)!), cursor: gapCursor } : null };
      });
    } catch {
      // The gap stays, to be pressed again.
      if (mine === sequence.current) setState((now) => ({ ...now, gapBusy: false }));
    }
  });

  const retry = useStable(() => {
    const mine = ++sequence.current;
    setState(loading(feed));
    void open(reader ? readPlace(reader, feed) : null, mine);
  });

  const remove = useStable((key: string) => setState((now) => ({ ...now, items: now.items.filter((item) => timelineKey(item) !== key), unread: now.unread.filter((unread) => unread !== key) })));

  // The row at the top: the place's top, and the unread posts that have come into view leave the pill's count.
  const onTop = useStable((key: string | null) => {
    latest.current.top = key;
    const now = latest.current.state;
    const index = postAt(latest.current.rows, now.items, key);
    if (index >= 0 && index < now.items.length) keeper.current?.top(placeRow(now.items[index]!));
    if (index < 0 || now.unread.length === 0) return;
    const above = new Set(now.items.slice(0, index).map(timelineKey));
    const unread = now.unread.filter((unreadKey) => above.has(unreadKey));
    if (unread.length === now.unread.length) return;
    setState((current) => ({ ...current, unread, caughtUp: current.caughtUp || unread.length === 0 }));
  });

  // Rows half in view for half a second: the place's newest. The marker reached from above, with nothing unread above it,
  // says the reader is caught up.
  const onViewed = useStable((keys: string[]) => {
    const now = latest.current.state;
    const byKey = new Map(now.items.map((item) => [timelineKey(item), item]));
    keeper.current?.seen(keys.flatMap((key) => (byKey.has(key) ? [placeRow(byKey.get(key)!)] : [])));
    if (!keys.includes("marker") || now.caughtUp || now.unread.length > 0) return;
    const rows = latest.current.rows;
    const top = rows.findIndex((row) => row.key === latest.current.top);
    if (top >= 0 && top < rows.findIndex((row) => row.key === "marker")) setState((current) => ({ ...current, caughtUp: true }));
  });

  const scrolled = useStable(() => keeper.current?.scrolled());

  // The pill: to the oldest unread new post, the first one above the reader's place, so they read on upwards in order.
  const jump = useStable(() => {
    const now = latest.current.state;
    const unread = new Set(now.unread);
    const oldest = [...now.items].reverse().find((item) => unread.has(timelineKey(item)));
    if (oldest) list.current?.jumpTo(timelineKey(oldest), !motion.reduced);
  });

  // The reader's own new post on top. Home tells it, and so does lib/feed-cache.ts for a post sent from any screen; the
  // second word of the same post is passed over (own.current is set at once, before the state that holds it renders).
  const posted = useStable((post: PostView) => {
    const now = latest.current.state;
    if (own.current === post.id || now.status !== "ready" || now.items.some((item) => timelineKey(item) === post.id)) return;
    own.current = post.id;
    insertAbove([{ kind: "post", post }], null, false);
  });
  useImperativeHandle(handle, () => ({ posted }), [posted]);
  useEffect(() => onPosted((who, post) => (who === reader ? posted(post) : undefined)), [reader, posted]);

  const renderPost = (item: TimelineItem, place: PostPlace, key: string) => {
    const card = <PostCard post={item.post} repostedBy={item.kind === "repost" ? item.repostedBy : undefined} onDeleted={() => remove(key)} {...place} />;
    // The reader's own new post fades in where it lands (new-own-post, 220 ms; at once under reduced motion).
    return key === own.current && !motion.reduced ? <Animated.View entering={FadeIn.duration(220)}>{card}</Animated.View> : card;
  };
  const empty =
    feed === "following"
      ? { title: UI_WORDS["feed.empty.following.title"], body: UI_WORDS["feed.empty.following.body"], action: { label: UI_WORDS["feed.empty.following.action"], onPress: onShowLatest } }
      : { title: UI_WORDS["feed.empty.latest.title"], body: UI_WORDS["feed.empty.latest.body"] };

  return (
    <View className="flex-1">
      <List
        handle={list}
        rows={result.rows}
        keyOf={(row) => row.key}
        versionOf={(row) => feedRowVersion(row, result.setSize)}
        renderRow={(row, index) => <FeedRowView row={row} index={index} setSize={result.setSize} renderPost={renderPost} empty={empty} onRetry={retry} onLoadMore={more} onGap={fillGap} />}
        header={header}
        feed
        label={feed === "following" ? UI_WORDS["home.following"] : UI_WORDS["home.latest"]}
        busy={state.status === "loading" || state.loadingMore || state.gapBusy}
        autoLoad={result.autoLoad}
        onEndReached={more}
        onViewed={onViewed}
        onTop={onTop}
        onScrolled={scrolled}
        // Pull to refresh on a phone asks for new posts now; they push the rows down, since the reader is at the top.
        refreshing={false}
        onRefresh={Platform.OS === "web" ? undefined : () => void ask()}
      />
      {reader ? <NewPostsPill count={state.unread.length} more={state.gap !== null} top={scroll.headerSpace} headerY={scroll.headerY} onPress={jump} /> : null}
    </View>
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
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
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
import { ImagePriority, MediaGrid } from "./MediaGrid";
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
 * the visible label. The thread's focused post shows the full date instead. The card's own line marks its time link as
 * the article's open link (`open`), which a feed's Page Down and Page Up move the focus to; a quote's line does not.
 */
function AuthorLine({ author, createdAt, postId, large = false, open = false }: { author: Author; createdAt: string; postId: string; large?: boolean; open?: boolean }) {
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
          <Inline {...(open ? dataAttribute("open") : {})} className={cn(INLINE_LINK, "px-1.5")}>
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
 * The quoted post as the composer previews it (UI design, Task 6): the same frame and words, with its author line as
 * text, nothing to open and nothing to click, so the composer's sheet holds no live link out of the post being written.
 */
function QuotePreview({ quote }: { quote: QuotedPost }) {
  return (
    <View className="mt-2 rounded-media border border-line-low px-3 py-2.5">
      <View className="flex-row flex-wrap items-center gap-x-1.5">
        <Text variant="body-strong">{quote.author.displayName}</Text>
        {quote.author.verified ? <VerifiedChip /> : null}
        <Text variant="mono" tone="low">
          @{quote.author.handle}
        </Text>
        <Text variant="meta" tone="low">
          {timeAgo(quote.createdAt)}
        </Text>
      </View>
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact />
    </View>
  );
}

/**
 * A quoted post (section 6.6): a bordered region with its own author line, whose time is the link to the quoted post,
 * so the quote has one open target too; its words are plain text, and its images open nothing, since they belong to the
 * quoted post, where the grid and the viewer are. A press on its empty space opens the quoted post. `preview` is the
 * composer's form, which opens nothing (QuotePreview).
 */
export function QuoteEmbed({ quote, preview = false }: { quote: QuotedPost | Tombstone; preview?: boolean }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  if (preview) return <QuotePreview quote={quote} />;
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
 *
 * In a feed (section 10) the article says its place, `position` from 1 and `setSize` (-1 while more can load); a list's
 * first two rows pass `priority`, so their images load first (11.2); and a thread's ancestors are `joined`: compact,
 * without a divider, and linked to the post below by a 2 px line-low thread line through their avatars (8.3).
 */
export function PostCard({
  post: initial,
  repostedBy,
  onDeleted,
  large = false,
  position,
  setSize,
  priority = false,
  joined = false,
  onReply,
}: {
  post: PostView;
  repostedBy?: Author;
  onDeleted?: (id: string) => void;
  large?: boolean;
  position?: number;
  setSize?: number;
  priority?: boolean;
  joined?: boolean;
  /** What Reply does instead of opening the thread: the thread's own focused post opens its reply card (Task 6). */
  onReply?: () => void;
}) {
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
  // Reply (section 6.6): the thread, with its reply card open and focused (?reply=1); signed out, the thread, which says
  // how to sign in to reply.
  const reply = onReply ?? (() => router.push(me === null ? `/post/${post.id}` : `/post/${post.id}?reply=1`));

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
      <IconButton icon="reply" label={countLabel("reply", post.counts.replies, hideCounts)} count={shownCount("reply", post.counts.replies, hideCounts)} onPress={reply} />
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
          <AuthorLine author={post.author} createdAt={post.createdAt} postId={post.id} large={large} open />
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
      <View
        role="article"
        aria-labelledby={labelId}
        aria-posinset={position}
        aria-setsize={position === undefined ? undefined : setSize}
        {...(webPress as object)}
        // A thread's focused post draws no divider of its own: the thread's block under it does, after Quote this post.
        className={cn(joined ? "px-4 pb-1 pt-3" : large ? "px-4 py-3" : "border-b border-line-low px-4 py-3", "web:transition-colors web:duration-[120ms]", washed ? "bg-surface-2" : "")}
      >
        {/* The thread line, from under the avatar to the next post's avatar: 2 px, line-low, through the avatars' centre. */}
        {joined ? <View pointerEvents="none" aria-hidden className="absolute bottom-0 left-[37px] top-[60px] w-0.5 bg-line-low" /> : null}
        {/* The article's name, the author line as a screen reader should hear it; hidden, and named only through aria-labelledby. */}
        <Text nativeID={labelId} aria-hidden style={VISUALLY_HIDDEN}>
          {fill(UI_WORDS["post.label"], { name: post.author.displayName, handle: post.author.handle, when })}
        </Text>
        {/* The first rows of a list load their images first (11.2): the grid reads it, through the quote's too. */}
        <ImagePriority.Provider value={priority}>
          {Platform.OS === "web" ? (
            content
          ) : (
            // On native the body is one Pressable that the accessibility tree does not see: the time's link does its job there.
            <Pressable accessible={false} {...pressDelay(80)} onPress={openPost} className="-mx-4 -my-3 px-4 py-3 active:bg-surface-2">
              {content}
            </Pressable>
          )}
        </ImagePriority.Provider>
      </View>
    </Animated.View>
  );
}
```

### Replace `apps/app/src/components/social/useImageUploads.ts` (whole file)

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { ALT_MAX_LENGTH, MEDIA_ACCEPTED_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_PER_POST, altLength, normalizeAltText, type MediaFailure } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";

export interface ComposerImage {
  /** Stable for the life of the row; the upload id only exists once the server answered. */
  key: string;
  /** A blob: URL of the chosen file, so the preview shows at once and nothing has to be downloaded. */
  previewUrl: string;
  alt: string;
  status: "uploading" | "processing" | "ready" | "failed" | "refused";
  id: string | null;
  error: string | null;
  /** 3d Task 7: the refusal's id, whose notice the tile's "Why" opens; null for every other status. */
  refusalId?: string | null;
}

const FAILURES: Record<MediaFailure, string> = {
  unsupported_format: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  animated_not_supported: "Animated images are not supported yet. Use a still image.",
  image_too_large: "That image has too many pixels. Make it smaller and try again.",
  corrupt_image: "That file could not be read as an image.",
  processing_failed: "We could not process that image. Try again.",
};

const POLL_MS = 1000;
/** A little longer than the server waits before it fails an upload itself. */
const GIVE_UP_MS = 6 * 60_000;

/**
 * Why a file is refused before it is sent, or null when it may go. The server checks again. Browsers on
 * Windows often report no type at all for a .heic file, so its name is checked too: an iPhone photo
 * should get the advice that helps, not the generic refusal.
 */
export function refusal(file: { name: string; type: string; size: number }): string | null {
  if (file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name)) return "HEIC photos are not supported. Export the photo as JPEG and try again.";
  if (!(MEDIA_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return FAILURES.unsupported_format;
  if (file.size > MEDIA_MAX_BYTES) return "Images can be at most 20 MB.";
  return null;
}

/** What still stands between these images and posting them. */
export function describeState(images: ComposerImage[]): { waiting: boolean; failed: boolean; undescribed: boolean } {
  return {
    waiting: images.some((image) => image.status === "uploading" || image.status === "processing"),
    // 3d Task 7: a refused upload is never posted: the composer holds it back as it holds back a failed one.
    failed: images.some((image) => image.status === "failed" || image.status === "refused"),
    undescribed: images.some((image) => {
      const length = altLength(normalizeAltText(image.alt));
      return length < 1 || length > ALT_MAX_LENGTH;
    }),
  };
}

/**
 * The images of one composer: uploads each chosen file, follows its processing, and keeps the
 * descriptions. Removing an image also removes the upload on the server (a refused upload, and one whose check has not
 * answered, only from the composer: korbat keeps it as its hold or its check needs). Blob URLs are released
 * when an image goes and when the composer closes. `onImages` hears every change of the list: the composer's reducer
 * (composer/state.ts) holds the images with the rest of what the reader is writing (UI design, section 6.15).
 */
export function useImageUploads(onImages?: (images: ComposerImage[]) => void) {
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** The same list as `images`, readable by callbacks without waiting for a render. */
  const list = useRef<ComposerImage[]>([]);
  const closed = useRef(false);
  const listener = useRef(onImages);
  listener.current = onImages;

  const commit = useCallback((next: ComposerImage[]) => {
    list.current = next;
    setImages(next);
    listener.current?.(next);
  }, []);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<ComposerImage>) => commit(list.current.map((image) => (image.key === key ? { ...image, ...change } : image))),
    [commit],
  );
  const present = (key: string) => !closed.current && list.current.some((image) => image.key === key);

  const follow = useCallback(
    async (key: string, file: File) => {
      try {
        const sent = await social.uploadMedia(file);
        if (!present(key)) {
          await social.removeMedia(sent.id).catch(() => undefined);
          return;
        }
        patch(key, { id: sent.id, status: "processing" });
        const deadline = Date.now() + GIVE_UP_MS;
        while (present(key) && Date.now() < deadline) {
          const state = await social.mediaStatus(sent.id);
          if (!present(key)) return;
          if (state.status === "ready") return patch(key, { status: "ready" });
          if (state.status === "failed") return patch(key, { status: "failed", error: FAILURES[state.error] });
          // 3d Task 7 (9.5): an upload the comparison refused: the tile says so and links its notice.
          if (state.status === "refused") return patch(key, { status: "refused", refusalId: state.refusalId });
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        if (present(key)) patch(key, { status: "failed", error: FAILURES.processing_failed });
      } catch (err) {
        if (present(key)) patch(key, { status: "failed", error: errorMessage(err) });
      }
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = Math.max(0, MEDIA_MAX_PER_POST - list.current.length);
      let message: string | null = files.length > room ? `A post can have at most ${MEDIA_MAX_PER_POST} images.` : null;
      const added: ComposerImage[] = [];
      const started: [string, File][] = [];
      for (const file of files.slice(0, room)) {
        const why = refusal(file);
        if (why) {
          message = why;
          continue;
        }
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        added.push({ key, previewUrl: URL.createObjectURL(file), alt: "", status: "uploading", id: null, error: null });
        started.push([key, file]);
      }
      setNotice(message);
      commit([...list.current, ...added]);
      for (const [key, file] of started) void follow(key, file);
    },
    [commit, follow],
  );

  const remove = useCallback(
    (key: string) => {
      const image = list.current.find((candidate) => candidate.key === key);
      if (!image) return;
      URL.revokeObjectURL(image.previewUrl);
      commit(list.current.filter((candidate) => candidate.key !== key));
      if (image.id) void social.removeMedia(image.id).catch(() => undefined);
    },
    [commit],
  );

  /** After posting: the uploads now belong to the post, so only the previews are released. */
  const clear = useCallback(() => {
    for (const image of list.current) URL.revokeObjectURL(image.previewUrl);
    commit([]);
    setNotice(null);
  }, [commit]);

  const setAlt = useCallback((key: string, alt: string) => patch(key, { alt }), [patch]);

  return { images, notice, add, remove, clear, setAlt };
}
```

### Replace `apps/app/src/lib/feed-cache.ts` (whole file)

```ts
import type { PostView, TimelineItem } from "@korbat/contracts";
import type { FeedName } from "./feed-rows";
import type { PlaceRow } from "./reading-place";

/**
 * Home's two feeds as the reader left them, for the session (UI design, section 7.5): each feed's rows, its cursor, the
 * page ends that let the oldest rows go and come back, a gap of new posts, its marker and unread new posts, and the row
 * at the top with its offset, in memory and per reader, so switching Home's tabs, opening a post and coming Back return
 * to the same row without asking for page one again. Nothing here is written to the browser, it ends with the page, and
 * another reader (another account, or the signed-out reader) never gets what one read. Only Following and Latest are
 * kept: Explore's answers stay in ExploreList's own state and are read again when it returns (2c's rule).
 */

export interface FeedSnapshot {
  items: TimelineItem[];
  cursor: string | null;
  /** Each loaded page's last row and the cursor its page gave (feed-rows.ts, trimOlder). */
  ends: [string, string | null][];
  gap: { after: string; cursor: string } | null;
  /** The newest post the reader had seen when the feed opened: the marker's place. */
  marker: PlaceRow | null;
  /** New posts above the reader not yet in view: the pill's count. */
  unread: string[];
  /** The row at the top of the view and how far its top is below the view's top line. */
  view: { key: string; offset: number } | null;
}

const kept = new Map<string, FeedSnapshot>();

export function feedCacheKey(reader: string | null, feed: FeedName): string {
  return `${reader ?? "signed-out"}:${feed}`;
}

export function readFeedCache(reader: string | null, feed: FeedName): FeedSnapshot | null {
  return kept.get(feedCacheKey(reader, feed)) ?? null;
}

export function writeFeedCache(reader: string | null, feed: FeedName, snapshot: FeedSnapshot): void {
  kept.set(feedCacheKey(reader, feed), snapshot);
}

/** Who hears of the reader's own new posts: a Home feed on screen, or kept mounted under another screen. */
type PostedListener = (reader: string | null, post: PostView) => void;
const postedListeners = new Set<PostedListener>();

/** Hears every post insertPosted() puts on top (UI Task 6: a post sent from another screen's sheet); returns the unsubscribe. */
export function onPosted(listener: PostedListener): () => void {
  postedListeners.add(listener);
  return () => {
    postedListeners.delete(listener);
  };
}

/**
 * The reader's own new post on top of both their feeds kept here (section 8.2); a feed not kept reads it with page one.
 * A feed on screen, or one the web keeps mounted under the screen the post was sent from, is told too, and puts it on
 * top of its own rows.
 */
export function insertPosted(reader: string | null, post: PostView): void {
  for (const feed of ["following", "latest"] as const) {
    const snapshot = readFeedCache(reader, feed);
    if (!snapshot || snapshot.items.some((item) => item.kind === "post" && item.post.id === post.id)) continue;
    kept.set(feedCacheKey(reader, feed), { ...snapshot, items: [{ kind: "post", post }, ...snapshot.items] });
  }
  for (const listener of postedListeners) listener(reader, post);
}

export function clearFeedCache(): void {
  kept.clear();
}
```

### Replace `apps/app/src/lib/session-end.ts` (whole file)

```ts
import { clearAppearance } from "./appearance";
import { clearDrafts, draftsStored } from "./drafts";
import { clearFeedCache } from "./feed-cache";
import { clearPlaces, placesStored } from "./reading-place";

/**
 * The session's end (UI design, section 8.8), apart from SessionProvider (lib/session.tsx), which calls these on every
 * change of its state, so the decision is a pure function the tests call without rendering anything.
 */

/** The session's states, as SessionProvider's state names them. */
export type SessionStatus = "loading" | "signed-out" | "signed-in";

/**
 * Whether the session has ended (UI design, section 8.8): the state moved from signed in to signed out (a sign-out here
 * or everywhere, a lockdown page, any 401 the API answered), or the first answer of /api/me is signed out while a reading
 * place or a draft is still stored (`stored`, tracesStored()), which means a session revoked, expired or signed out
 * elsewhere while the app was closed.
 */
export function sessionEnded(previous: SessionStatus, next: SessionStatus, stored: boolean): boolean {
  if (next !== "signed-out") return false;
  if (previous === "signed-in") return true;
  return previous === "loading" && stored;
}

/** Whether an account left a trace on this device that a signed-out start must clear: a reading place or a draft. */
export function tracesStored(): boolean {
  return placesStored() || draftsStored();
}

/**
 * What the device kept for the session, cleared when it ends, through each store's own function: the appearance (the
 * theme returns to System), every reading place and every draft, whatever the account, and the feeds kept in memory.
 * The device id and the passkey card's Not now stay: they belong to the browser, not to an account.
 */
export function clearSessionTraces(): void {
  clearAppearance();
  clearPlaces();
  clearDrafts();
  clearFeedCache();
}
```

### Replace `apps/app/src/lib/session.tsx` (whole file)

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { MeResponse } from "@korbat/contracts";
import { ErrorState, isOffline } from "@/components/kit/ErrorState";
import { api, ApiError, errorMessage, setSuspendedHandler, setUnauthenticatedHandler } from "./api";
import { clearSessionTraces, sessionEnded, tracesStored } from "./session-end";

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

  // Every end of a session arrives here as a change of state, whatever caused it (section 8.8).
  const previous = useRef<SessionState["status"]>("loading");
  useEffect(() => {
    if (sessionEnded(previous.current, state.status, tracesStored())) clearSessionTraces();
    previous.current = state.status;
  }, [state.status]);

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
} as const;

export type TitleWord = keyof typeof TITLE_WORDS;

/** A template with each `{name}` replaced by its value; a name with no value stays as it is written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
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
apps/app test:       Tests  603 passed (603)
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

- `Tests  31 passed (31)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  31 passed (31)
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/_layout.tsx`
- `apps/app/src/app/bookmarks.tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/post/[id].tsx`
- `apps/app/src/app/u/[handle]/index.tsx`
- `apps/app/src/components/AppShell.tsx`
- `apps/app/src/components/kit/Sheet.tsx`
- `apps/app/src/components/social/ComposeButton.tsx`
- `apps/app/src/components/social/ComposeHost.tsx`
- `apps/app/src/components/social/ComposeSheet.tsx`
- `apps/app/src/components/social/Composer.tsx`
- `apps/app/src/components/social/ComposerImages.tsx`
- `apps/app/src/components/social/FeedList.tsx`
- `apps/app/src/components/social/PostCard.tsx`
- `apps/app/src/components/social/composer/ComposerCard.tsx`
- `apps/app/src/components/social/composer/ComposerField.tsx`
- `apps/app/src/components/social/composer/DiscardDialog.tsx`
- `apps/app/src/components/social/composer/ProgressRing.tsx`
- `apps/app/src/components/social/composer/ProgressRing.web.tsx`
- `apps/app/src/components/social/composer/SendBar.tsx`
- `apps/app/src/components/social/composer/state.ts`
- `apps/app/src/components/social/useImageUploads.ts`
- `apps/app/src/lib/composing.ts`
- `apps/app/src/lib/drafts.ts`
- `apps/app/src/lib/feed-cache.ts`
- `apps/app/src/lib/session-end.ts`
- `apps/app/src/lib/session.tsx`
- `apps/app/src/lib/ui-words.ts`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/composer-state.test.ts`
- `apps/app/test/composer.test.tsx`
- `apps/app/test/drafts.test.ts`
- `apps/app/test/explore.test.tsx`
- `apps/app/test/legacy-files.ts`
- `apps/app/test/reading-place.test.ts`
- `apps/app/test/setup.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(app): the composer: composer/state.ts, a pure reducer of the text, the images and where each upload stands, the send and its refusal and the draft's key, says the length by the server's rule, whether a post may go and the Post button's words, and the parts draw from it: ComposerField with its kept names, growing to half the window and described by {n} of 1000 characters, said again only across 900 and 1000; ProgressRing (a DOM svg on the web, react-native-svg natively); the image tray at 88 px; SendBar; DiscardDialog, asked only when there is content; lib/drafts.ts keeps the text per context on the device 500 ms after typing stops and the session's end clears every draft; ComposeSheet moves onto kit/Sheet, 640 px wide from 768 px, and sending closes it with a toast whose View opens the post; New post ends the rail and the full nav on every screen, one sheet for the app in the root layout, with the phone's compose button on Home, a profile and Bookmarks; Home's collapsed card and the thread's reply card open in place, Reply opens the thread with its card focused, a quote's preview links nowhere; the browser check gains steps 28 to 31" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the composer: composer/state.ts, a pure reducer of the text, the images and where each upload stands, the send and its refusal and the draft's key, says the length by the server's rule, whether a post may go and the Post button's words, and the parts draw from it: ComposerField with its kept names, growing to half the window and described by {n} of 1000 characters, said again only across 900 and 1000; ProgressRing (a DOM svg on the web, react-native-svg natively); the image tray at 88 px; SendBar; DiscardDialog, asked only when there is content; lib/drafts.ts keeps the text per context on the device 500 ms after typing stops and the session's end clears every draft; ComposeSheet moves onto kit/Sheet, 640 px wide from 768 px, and sending closes it with a toast whose View opens the post; New post ends the rail and the full nav on every screen, one sheet for the app in the root layout, with the phone's compose button on Home, a profile and Bookmarks; Home's collapsed card and the thread's reply card open in place, Reply opens the thread with its card focused, a quote's preview links nowhere; the browser check gains steps 28 to 31`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 37>
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
