import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { PostView } from "@korbat/contracts";
import { RichText } from "../src/components/social/RichText";
import { PostCard, QuoteEmbed } from "../src/components/social/PostCard";

/**
 * A post's words (3b design, sections 5.3, 10.6 and decision 21; Task 7): mentions are links in a native post and never in
 * an imported one, whose @names belong to another platform, even where an account of that name exists on korbat; and
 * every link to an outside page is marked nofollow and ugc, opens without a reference back and sends no referrer.
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { push: () => undefined, replace: () => undefined },
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
vi.mock("expo-image", async () => {
  const { createElement } = await import("react");
  return { Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel: string }) => createElement("img", { "data-uri": source.uri, alt: accessibilityLabel }) };
});
vi.mock("@/components/toast", () => ({ toast: { show: vi.fn() }, Toaster: () => null }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const anchors = (markup: string): string[] => markup.match(/<a\b[^>]*>/g) ?? [];
const hrefOf = (tag: string): string => /href="([^"]+)"/.exec(tag)?.[1] ?? "";
const REL = "nofollow ugc noopener noreferrer";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// An account @ada exists on korbat: the author of this card.
const ADA = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false };
const BODY = "Thanks @ada and @grace_h, notes at https://example.org/notes and http://example.com/x";

function post(extra: Partial<PostView> = {}): PostView {
  return {
    id: id(10),
    author: { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: false },
    body: BODY,
    createdAt: "2026-10-21T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    media: [],
    quoteOf: null,
    imported: null,
    ...extra,
  };
}

describe("RichText", () => {
  test("in a native post a mention is a link to the profile, and every outside link carries rel nofollow ugc noopener noreferrer", () => {
    const out = html(<RichText body={BODY} />);
    const links = anchors(out);
    expect(links.map(hrefOf)).toEqual(["/u/ada", "/u/grace_h", "https://example.org/notes", "http://example.com/x"]);
    for (const tag of links.filter((link) => hrefOf(link).startsWith("http"))) {
      expect(tag).toContain(`rel="${REL}"`);
      expect(tag).toContain('target="_blank"');
    }
  });

  test("with mentions off, @ada stays text, while an account @ada exists, and the outside links keep their rel", () => {
    const out = html(<RichText body={BODY} mentions={false} />);
    expect(anchors(out).map(hrefOf)).toEqual(["https://example.org/notes", "http://example.com/x"]);
    expect(out).toContain("@ada");
    for (const tag of anchors(out)) expect(tag).toContain(`rel="${REL}"`);
  });

  test("an imported post's card draws its body with mentions off: no /u/ada link but the author's own", () => {
    const imported = post({ author: ADA, imported: { source: "x", at: "2019-03-03", shortened: false } });
    const out = html(<PostCard post={imported} />);
    // The author line links Ada's profile once, the avatar's hidden link once: the body's @ada links nothing.
    expect(anchors(out).filter((tag) => hrefOf(tag) === "/u/ada")).toHaveLength(2);
    expect(anchors(out).filter((tag) => hrefOf(tag) === "/u/grace_h")).toEqual([]);
    const native = html(<PostCard post={post({ author: ADA })} />);
    expect(anchors(native).filter((tag) => hrefOf(tag) === "/u/ada")).toHaveLength(3);
  });

  test("a quoted imported post shows the short label and no mention as a link", () => {
    const quoted = { ...post({ id: id(11), imported: { source: "mastodon", at: "2019-03-03", shortened: true } }), quoteOf: null };
    const out = html(<QuoteEmbed quote={quoted} />);
    expect(out).toContain("Imported from Mastodon");
    expect(out).not.toContain("dated");
    // Quoted words are plain text: no mention, no link but the quote's own (its author and its time).
    expect(anchors(out).map(hrefOf)).toEqual(["/u/grace", `/post/${id(11)}`]);
  });
});
