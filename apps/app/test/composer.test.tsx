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
  imported: null,
  mentions: [],
  countsHidden: false,
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
      expect(anchors(nav).map((tag) => /href="([^"]*)"/.exec(tag)?.[1]), kind).toEqual(["/", "/bookmarks", "/u/ada", "/settings"]);
      const at = nav.indexOf('aria-label="New post"') >= 0 ? nav.indexOf('aria-label="New post"') : nav.lastIndexOf(">New post<");
      expect(at, kind).toBeGreaterThan(nav.lastIndexOf('href="/settings"'));
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
