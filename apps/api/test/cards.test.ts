import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { PostView, ProfileView, type ImportedLabel } from "@korbat/contracts";
import { createCards } from "../src/cards";
import { CARD_BLOCK_MAX_BYTES, CARD_HEADER_MAX_BYTES, cardBlock, cardHeader, postCard, profileCard, type CardSource } from "../src/cards/build";
import { CARD_WORDS, cardDay } from "../src/cards/words";
import type { SocialForCards } from "../src/social";

/**
 * 2d Task 6 (design, sections 8.3 to 8.6; section 12.2): the share card's head block. cardBlock is the one function that
 * builds every block: the tags in 8.3's order, what each row of 8.4 shows, 8.5's lengths counted in code points and its
 * escaping for a double-quoted attribute with the template delimiters as character references, and the 4,096-byte bound,
 * which the builder holds by cutting the image's description last. CARD_WORDS are the card's sentences, the imported
 * label in the same shape as 3b's. And the two routes, with a stand-in for the social module's interface: 204 with the
 * block in Korbat-Card, or 404 with no body.
 */
const ORIGIN = "https://korbat.example";
const POST_ID = "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const IMAGE_ID = "3c8d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const AVATAR_ID = "4d9e3f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const LF = String.fromCharCode(10);
/** A four-byte character (U+1F600), built in code: two UTF-16 units, one code point. */
const WIDE = String.fromCodePoint(0x1f600);

/** The block's lines as [attribute, key, content], each a whole meta element on its own line, or a failure. */
function metas(block: string): [string, string, string][] {
  return block.split(LF).map((line) => {
    const found = /^<meta (name|property)="([^"]+)" content="([^"]*)" [/]>$/.exec(line);
    if (!found) throw new Error(`a line that is no meta element of the block: ${line}`);
    return [found[1]!, found[2]!, found[3]!];
  });
}
const keys = (block: string): string[] => metas(block).map(([, key]) => key);
const content = (block: string, key: string): string | undefined => metas(block).find(([, k]) => k === key)?.[2];
/** An attribute's value read back as text, the way a parser of the page reads it. */
const unescape = (value: string): string =>
  value.replace(/&#123;/g, "{").replace(/&#125;/g, "}").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const codePoints = (text: string): number => Array.from(text).length;
const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
/** True when the text holds no lone surrogate: a cut never splits a four-byte character. */
const whole = (text: string): boolean => Buffer.from(text, "utf8").toString("utf8") === text;

const ada = { id: "11111111-1111-4111-8111-111111111111", handle: "ada", displayName: "Ada Lovelace", verified: true, avatar: null };

function view(over: Partial<PostView> = {}): PostView {
  return PostView.parse({
    id: POST_ID,
    author: ada,
    body: "Notes on the analytical engine",
    createdAt: "2026-10-01T12:30:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 12, reposts: 3, replies: 4, quotes: 1 },
    media: [],
    quoteOf: null,
    imported: null,
    mentions: [],
    countsHidden: false,
    ...over,
  });
}
const image = (over: Record<string, unknown> = {}) => ({ id: IMAGE_ID, width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3", alt: "A brass gear train", small: `/api/media/${IMAGE_ID}/small.webp`, large: `/api/media/${IMAGE_ID}/large.webp`, ...over });
const avatar = { small: `/api/media/${AVATAR_ID}/small.webp`, large: `/api/media/${AVATAR_ID}/large.webp` };

function profile(over: Partial<ProfileView> = {}): ProfileView {
  return ProfileView.parse({
    id: ada.id,
    handle: "ada",
    displayName: "Ada Lovelace",
    bio: "Mathematician.",
    verified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    counts: { posts: 10, followers: 2000, following: 3 },
    hasImported: false,
    avatar: null,
    ...over,
  });
}

describe("the head block's tags, in 8.3's order, for each row of 8.4", () => {
  test("a post whose author turned previews on, with an image shown to everyone: the article card with the image's size and description", () => {
    const block = cardBlock(ORIGIN, postCard(view({ media: [image()] }), true));
    expect(metas(block)).toEqual([
      ["name", "robots", "noindex"],
      ["property", "og:site_name", "korbat"],
      ["property", "og:type", "article"],
      ["property", "og:url", `${ORIGIN}/post/${POST_ID}`],
      ["property", "og:title", "Ada Lovelace (@ada)"],
      ["property", "og:description", "Notes on the analytical engine"],
      ["name", "description", "Notes on the analytical engine"],
      ["property", "og:image", `${ORIGIN}/api/media/${IMAGE_ID}/large.webp`],
      ["property", "og:image:type", "image/webp"],
      ["property", "og:image:width", "2048"],
      ["property", "og:image:height", "1536"],
      ["property", "og:image:alt", "A brass gear train"],
      ["property", "article:published_time", "2026-10-01T12:30:00.000Z"],
      ["name", "twitter:card", "summary_large_image"],
    ]);
  });

  test("a post's image is the first one shown to everyone, never a hidden one; else the author's avatar with no size; else none", () => {
    const hidden = { id: "5e0f4a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", hidden: true as const };
    const second = image({ id: "6f1a5b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c", alt: "The second image", large: "/api/media/6f1a5b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c/large.webp" });
    expect(content(cardBlock(ORIGIN, postCard(view({ media: [hidden, second] }), true)), "og:image:alt")).toBe("The second image");
    const withAvatar = cardBlock(ORIGIN, postCard(view({ author: { ...ada, avatar }, media: [hidden] }), true));
    expect(keys(withAvatar)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "og:image", "og:image:type", "og:image:alt", "article:published_time", "twitter:card"]);
    expect(content(withAvatar, "og:image")).toBe(`${ORIGIN}${avatar.large}`);
    expect(content(withAvatar, "og:image:alt")).toBe("Profile picture of @ada");
    expect(content(withAvatar, "twitter:card")).toBe("summary");
    const bare = cardBlock(ORIGIN, postCard(view({ media: [hidden] }), true));
    expect(keys(bare)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "article:published_time", "twitter:card"]);
    expect(content(bare, "twitter:card")).toBe("summary");
  });

  test("a reply and a quote are cards of their own text and images: nothing of the parent, nothing of the quoted post", () => {
    const quoted = { ...view({ id: "7a2b6c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d", body: "The quoted words", media: [image()] }), quoteOf: null };
    const quote = cardBlock(ORIGIN, postCard(view({ body: "My own words", quoteOf: quoted }), true));
    expect(content(quote, "og:description")).toBe("My own words");
    expect(quote).not.toContain("quoted words");
    expect(quote).not.toContain(IMAGE_ID);
    const reply = cardBlock(ORIGIN, postCard(view({ body: "A reply", replyTo: { id: "7a2b6c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d", authorHandle: "grace" } }), true));
    expect(reply).not.toContain("grace");
    expect(content(reply, "og:description")).toBe("A reply");
  });

  test("a profile whose owner turned previews on: the profile card with the bio and the avatar, none of either when absent", () => {
    const block = cardBlock(ORIGIN, profileCard(profile({ avatar }), true));
    expect(metas(block)).toEqual([
      ["name", "robots", "noindex"],
      ["property", "og:site_name", "korbat"],
      ["property", "og:type", "profile"],
      ["property", "og:url", `${ORIGIN}/u/ada`],
      ["property", "og:title", "Ada Lovelace (@ada)"],
      ["property", "og:description", "Mathematician."],
      ["name", "description", "Mathematician."],
      ["property", "og:image", `${ORIGIN}${avatar.large}`],
      ["property", "og:image:type", "image/webp"],
      ["property", "og:image:alt", "Profile picture of @ada"],
      ["property", "profile:username", "ada"],
      ["name", "twitter:card", "summary"],
    ]);
    expect(keys(cardBlock(ORIGIN, profileCard(profile({ bio: "" }), true)))).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "profile:username", "twitter:card"]);
  });

  test("while previews are off (the default) the card is generic: korbat's words alone, no description, image, date or name", () => {
    const post = cardBlock(ORIGIN, postCard(view({ author: { ...ada, avatar }, media: [image()] }), false));
    expect(metas(post)).toEqual([
      ["name", "robots", "noindex"],
      ["property", "og:site_name", "korbat"],
      ["property", "og:type", "website"],
      ["property", "og:url", `${ORIGIN}/post/${POST_ID}`],
      ["property", "og:title", "A post on korbat"],
      ["name", "twitter:card", "summary"],
    ]);
    const shown = cardBlock(ORIGIN, profileCard(profile({ avatar, bio: "Mathematician." }), false));
    expect(metas(shown)).toEqual([
      ["name", "robots", "noindex"],
      ["property", "og:site_name", "korbat"],
      ["property", "og:type", "website"],
      ["property", "og:url", `${ORIGIN}/u/ada`],
      ["property", "og:title", "A profile on korbat"],
      ["name", "twitter:card", "summary"],
    ]);
    // It names no one: no display name, bio, picture or date; a profile's handle only in the address that was shared.
    for (const block of [post, shown]) {
      for (const absent of ["Ada", "Lovelace", "Mathematician", "Notes", AVATAR_ID, IMAGE_ID, "2026-10-01", "@ada"]) expect(block, absent).not.toContain(absent);
    }
    expect(metas(shown).filter(([, , value]) => value.includes("ada")).map(([, key]) => key)).toEqual(["og:url"]);
  });

  test("never a count, the verified mark or a moderation state: a post's and a profile's numbers and marks reach no block", () => {
    const post = cardBlock(ORIGIN, postCard(view({ counts: { likes: 4321, reposts: 8765, replies: 2468, quotes: 1357 }, author: { ...ada, verified: true } }), true));
    const shown = cardBlock(ORIGIN, profileCard(profile({ counts: { posts: 4321, followers: 8765, following: 2468 } }), true));
    for (const block of [post, shown]) {
      for (const absent of ["4321", "8765", "2468", "1357", "erified", "withheld", "removed", "suspend"]) expect(block, absent).not.toContain(absent);
    }
  });
});

describe("text, lengths and escaping (8.5)", () => {
  const HOSTILE = ["<script>alert(1)</script>", '"><meta http-equiv="refresh" content="0">', "&amp; &lt;", "{{ .Env }}", '{{env "HOME"}}', "{{", "}}", "it's {not} a template"];

  test("every hostile value is escaped for a double-quoted attribute, the template delimiters as character references, and reads back as written", () => {
    for (const text of HOSTILE) {
      const name = text.slice(0, 50);
      for (const block of [
        cardBlock(ORIGIN, postCard(view({ author: { ...ada, displayName: name }, body: text, media: [image({ alt: text })] }), true)),
        cardBlock(ORIGIN, profileCard(profile({ displayName: name, bio: text, avatar }), true)),
      ]) {
        // Every line is still one meta element: nothing broke out of an attribute or added a tag.
        const lines = metas(block);
        expect(block.split("<").length - 1, text).toBe(lines.length);
        for (const absent of ["{", "}", "<script", "'"]) expect(block.includes(absent), `${text}: ${absent}`).toBe(false);
        expect(unescape(content(block, "og:title")!), text).toBe(`${name} (@ada)`);
        expect(unescape(content(block, "og:description")!), text).toBe(text);
        expect(unescape(content(block, "og:image:alt")!), text).toBe(block.includes("article:published_time") ? text : "Profile picture of @ada");
      }
    }
    expect(cardBlock(ORIGIN, postCard(view({ body: '{{env "HOME"}}' }), true))).toContain('content="&#123;&#123;env &quot;HOME&quot;&#125;&#125;"');
    expect(cardBlock(ORIGIN, postCard(view({ body: "a & b < c > d ' e" }), true))).toContain('content="a &amp; b &lt; c &gt; d &#39; e"');
  });

  test("line breaks become single spaces; mentions and links stay as written", () => {
    const body = ["@grace look", "", "https://example.org/a?b=c&d=e", "end"].join(LF);
    const block = cardBlock(ORIGIN, postCard(view({ body }), true));
    expect(unescape(content(block, "og:description")!)).toBe("@grace look https://example.org/a?b=c&d=e end");
    expect(block.split(LF)).toHaveLength(9);
  });

  test("the title is at most 70 code points, cut with ...; four-byte characters at the cut stay whole", () => {
    const title = (displayName: string) => unescape(content(cardBlock(ORIGIN, postCard(view({ author: { ...ada, displayName } }), true)), "og:title")!);
    // " (@ada)" is 7 code points: a name of 63 makes a title of exactly 70, kept; 64 makes 71, cut to 67 and "...".
    expect(title("n".repeat(63))).toBe(`${"n".repeat(63)} (@ada)`);
    expect(title("n".repeat(64))).toBe(`${"n".repeat(64)} (@...`);
    // 50 four-byte characters and " (@ada)" are 57 code points: kept whole.
    const wide = title(WIDE.repeat(50));
    expect(wide).toBe(`${WIDE.repeat(50)} (@ada)`);
    expect(codePoints(wide)).toBe(57);
    // A longer handle puts the cut inside the run of four-byte characters: 67 whole ones and "...".
    const long = unescape(content(cardBlock(ORIGIN, postCard(view({ author: { ...ada, handle: "a".repeat(20), displayName: WIDE.repeat(50) + "n".repeat(10) + WIDE.repeat(10) } }), true)), "og:title")!);
    expect(codePoints(long)).toBe(70);
    expect(long).toBe(`${WIDE.repeat(50)}${"n".repeat(10)}${WIDE.repeat(7)}...`);
    expect(whole(long)).toBe(true);
  });

  test("the description is at most 200 code points, cut at the last space before 197 and ended with ...; a body of one word is cut at 197", () => {
    const description = (body: string) => unescape(content(cardBlock(ORIGIN, postCard(view({ body }), true)), "og:description")!);
    expect(description("w".repeat(200))).toBe("w".repeat(200));
    const words = Array.from({ length: 60 }, (_, n) => `w${n}`).join(" ");
    const cut = description(words);
    expect(codePoints(cut)).toBeLessThanOrEqual(200);
    expect(cut.endsWith("...")).toBe(true);
    expect(words.startsWith(`${cut.slice(0, -3)} `)).toBe(true);
    expect(codePoints(cut.slice(0, -3))).toBeLessThanOrEqual(197);
    // A 1,000-character body of one word has no space to cut at: 197 code points and "...".
    expect(description("x".repeat(1000))).toBe(`${"x".repeat(197)}...`);
    const wide = description(WIDE.repeat(1000));
    expect(wide).toBe(`${WIDE.repeat(197)}...`);
    expect(whole(wide)).toBe(true);
    // A space right after the 197th code point is no cut inside it: the 197 stay, then "...".
    expect(description(`${WIDE.repeat(197)} ${"y".repeat(10)}`)).toBe(`${WIDE.repeat(197)}...`);
    const both = cardBlock(ORIGIN, postCard(view({ body: WIDE.repeat(1000) }), true));
    expect(content(both, "description")).toBe(content(both, "og:description"));
  });

  test("an empty body with an image: no description, the image all the same", () => {
    const block = cardBlock(ORIGIN, postCard(view({ body: "", media: [image()] }), true));
    expect(keys(block)).not.toContain("og:description");
    expect(keys(block)).not.toContain("description");
    expect(content(block, "og:image")).toBe(`${ORIGIN}/api/media/${IMAGE_ID}/large.webp`);
  });

  test("an image's description is at most 420 code points, and is cut further, with ..., only to keep the block within 4,096 bytes", () => {
    const alt = (text: string) => unescape(content(cardBlock(ORIGIN, postCard(view({ media: [image({ alt: text })] }), true)), "og:image:alt")!);
    expect(alt("a".repeat(420))).toBe("a".repeat(420));
    expect(alt("a".repeat(421))).toBe(`${"a".repeat(417)}...`);
    // With the title and the description at their limits in four-byte characters, 420 of them do not fit: the image's
    // description alone is cut, whole characters and "...".
    const block = cardBlock(ORIGIN, postCard(view({ author: { ...ada, handle: "a".repeat(20), displayName: WIDE.repeat(50) }, body: WIDE.repeat(1000), media: [image({ alt: WIDE.repeat(420) })] }), true));
    expect(bytes(block)).toBeLessThanOrEqual(CARD_BLOCK_MAX_BYTES);
    const cut = unescape(content(block, "og:image:alt")!);
    expect(cut.endsWith("...")).toBe(true);
    expect(codePoints(cut)).toBeLessThan(420);
    expect(WIDE.repeat(420).startsWith(cut.slice(0, -3))).toBe(true);
    expect(whole(cut)).toBe(true);
    // The other two are untouched by the bound.
    expect(codePoints(unescape(content(block, "og:title")!))).toBe(70);
    expect(unescape(content(block, "og:description")!)).toBe(`${WIDE.repeat(197)}...`);
  });

  test("the 4,096-byte bound holds at every length limit, with four-byte characters and with characters that escape to six bytes, and the header stays within 6,000", () => {
    const worst: [string, CardSource][] = [];
    for (const unit of [WIDE, "{", '"', "&", "a"]) {
      const fill = (n: number) => unit.repeat(n);
      const author = { ...ada, handle: "a".repeat(20), displayName: fill(50), avatar };
      worst.push([`post ${unit}`, postCard(view({ author, body: fill(1000), media: [image({ alt: fill(1000) })], imported: { source: "mastodon", at: "2019-03-03", shortened: true } }), true)]);
      worst.push([`post with its avatar ${unit}`, postCard(view({ author, body: fill(1000) }), true)]);
      worst.push([`profile ${unit}`, profileCard(profile({ handle: "a".repeat(20), displayName: fill(50), bio: fill(160), avatar }), true)]);
    }
    for (const [name, source] of worst) {
      const block = cardBlock(ORIGIN, source);
      expect(bytes(block), name).toBeLessThanOrEqual(CARD_BLOCK_MAX_BYTES);
      const header = cardHeader(block);
      expect(header.length, name).toBeLessThanOrEqual(CARD_HEADER_MAX_BYTES);
      expect(Buffer.from(header, "base64").toString("utf8"), name).toBe(block);
      expect(header, name).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    expect(CARD_BLOCK_MAX_BYTES).toBe(4096);
    expect(CARD_HEADER_MAX_BYTES).toBe(6000);
  });

  test("the builder asserts its bounds: a block over 4,096 bytes is never encoded", () => {
    expect(() => cardHeader("x".repeat(CARD_BLOCK_MAX_BYTES + 1))).toThrow();
    expect(cardHeader("x".repeat(CARD_BLOCK_MAX_BYTES))).toHaveLength(Math.ceil(CARD_BLOCK_MAX_BYTES / 3) * 4);
    // An origin so long that the block cannot fit even without the image's description is refused, not sent cut.
    expect(() => cardBlock(`https://${"o".repeat(3000)}.example`, postCard(view({ media: [image()] }), true))).toThrow();
  });
});

describe("the card's words (8.6)", () => {
  test("CARD_WORDS: the generic titles, the picture's description, the title form and the imported label", () => {
    expect(CARD_WORDS).toEqual({
      "card.siteName": "korbat",
      "card.post.generic": "A post on korbat",
      "card.profile.generic": "A profile on korbat",
      "card.title": "{displayName} (@{handle})",
      "card.avatar.alt": "Profile picture of @{handle}",
      "card.imported": "Imported from {source}, dated {date}",
      "card.imported.shortened": ", shortened on import",
      "card.source.x": "X",
      "card.source.mastodon": "Mastodon",
      "card.source.bluesky": "Bluesky",
    });
  });

  test("an imported post's label comes first, with each source's name and the archive's day in one fixed UTC form, then a full stop and the text", () => {
    const description = (imported: ImportedLabel, body = "An old post") => unescape(content(cardBlock(ORIGIN, postCard(view({ imported, body }), true)), "og:description")!);
    expect(description({ source: "mastodon", at: "2019-03-03", shortened: false })).toBe("Imported from Mastodon, dated 3 March 2019. An old post");
    expect(description({ source: "x", at: "2020-12-31", shortened: true })).toBe("Imported from X, dated 31 December 2020, shortened on import. An old post");
    expect(description({ source: "bluesky", at: "2024-01-09", shortened: false })).toBe("Imported from Bluesky, dated 9 January 2024. An old post");
    // An imported post with no text still says where it came from.
    expect(description({ source: "x", at: "2019-03-03", shortened: false }, "")).toBe("Imported from X, dated 3 March 2019.");
    // The label counts toward the 200 code points, and the text after it is cut by 8.5's rule in the room it leaves.
    const long = description({ source: "mastodon", at: "2019-03-03", shortened: true }, "x".repeat(1000));
    expect(long.startsWith("Imported from Mastodon, dated 3 March 2019, shortened on import. ")).toBe(true);
    expect(codePoints(long)).toBe(200);
  });

  test("the date is the archive's day in UTC, one fixed form, whatever the server's zone", () => {
    expect(["2019-03-03", "2000-01-01", "1999-12-31", "2024-02-29"].map(cardDay)).toEqual(["3 March 2019", "1 January 2000", "31 December 1999", "29 February 2024"]);
  });

  test("card.imported is the same sentence as 3b's import.label, and each source's name its import.sourceName (apps/app/src/lib/import-words.ts)", () => {
    const words = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "src", "lib", "import-words.ts"), "utf8");
    const word = (key: string): string => {
      const found = new RegExp(`"${key.replace(/[.]/g, "[.]")}": "([^"]*)"`).exec(words);
      if (!found) throw new Error(`import-words.ts has no ${key}`);
      return found[1]!;
    };
    expect(CARD_WORDS["card.imported"]).toBe(word("import.label"));
    expect(CARD_WORDS["card.imported.shortened"]).toBe(word("import.label.shortened"));
    for (const source of ["x", "mastodon", "bluesky"] as const) expect(CARD_WORDS[`card.source.${source}`]).toBe(word(`import.sourceName.${source}`));
  });
});

describe("the card routes, with a stand-in for the social module's interface", () => {
  function routes(found: { post?: { view: PostView; previews: boolean }; profile?: { view: ProfileView; previews: boolean } }) {
    const asked: string[] = [];
    const social: SocialForCards = {
      async post(id) {
        asked.push(`post ${id}`);
        return found.post && found.post.view.id === id ? found.post : null;
      },
      async profile(handle) {
        asked.push(`profile ${handle}`);
        return found.profile && found.profile.view.handle === handle ? found.profile : null;
      },
    };
    const app = new Hono();
    app.route("/api", createCards({ social, appOrigin: `${ORIGIN}/` }).routes);
    return { app, asked };
  }
  const decoded = (res: Response): string => Buffer.from(res.headers.get("korbat-card") ?? "", "base64").toString("utf8");

  test("204 with the block in Korbat-Card and no body for a card that exists; the origin's trailing slash is no part of a URL", async () => {
    const { app } = routes({ post: { view: view(), previews: true }, profile: { view: profile(), previews: false } });
    const post = await app.request(`/api/cards/post/${POST_ID.toUpperCase()}`);
    expect(post.status).toBe(204);
    expect(await post.text()).toBe("");
    expect(content(decoded(post), "og:url")).toBe(`${ORIGIN}/post/${POST_ID}`);
    expect(content(decoded(post), "og:title")).toBe("Ada Lovelace (@ada)");
    const shown = await app.request("/api/cards/profile/@Ada");
    expect(shown.status).toBe(204);
    expect(content(decoded(shown), "og:title")).toBe("A profile on korbat");
    expect(content(decoded(shown), "og:url")).toBe(`${ORIGIN}/u/ada`);
  });

  test("404 with no body and no header when the social module finds nothing, and for a malformed id or handle, which it is never asked", async () => {
    const { app, asked } = routes({});
    for (const missing of [`/api/cards/post/${POST_ID}`, "/api/cards/profile/nobody"]) {
      const res = await app.request(missing);
      expect([missing, res.status, await res.text(), res.headers.get("korbat-card")]).toEqual([missing, 404, "", null]);
    }
    expect(asked).toEqual([`post ${POST_ID}`, "profile nobody"]);
    asked.length = 0;
    for (const malformed of ["/api/cards/post/not-a-uuid", `/api/cards/post/${encodeURIComponent("../health")}`, `/api/cards/post/${"x".repeat(300)}`, "/api/cards/profile/ab", `/api/cards/profile/${"a".repeat(21)}`, "/api/cards/profile/a-b", `/api/cards/profile/${encodeURIComponent("../me")}`, "/api/cards/profile/%40%40ada"]) {
      const res = await app.request(malformed);
      expect([malformed, res.status, await res.text()]).toEqual([malformed, 404, ""]);
    }
    expect(asked).toEqual([]);
  });
});
