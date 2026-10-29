# korbat engagement (2d) — Task 6 of 7: Share cards, indexing and the terms: the API's card routes and head block, Caddy's /post/* and /u/* serving card.html through templates, robots.txt and X-Robots-Tag, the card lab, and the privacy text's four drafts.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-28 to 2026-10-29 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 6 of sub-project 2d (engagement), the second task of the fourth batch (Tasks 5 and 6) and a stack task, after the app's screens and the Privacy switch of Task 5 and before Task 7's record. It follows docs/superpowers/specs/2026-10-22-engagement-2d-design.md section 8 (the routes, Caddy, the head block, what each card shows, lengths and escaping, words, titles) and section 11.3 (the terms' drafts), with decisions 19 to 23 and 30, the tests of sections 12.2 to 12.4 and section 13's Task 6.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- The ignored env files must hold every setting of the example files before the stack is rebuilt: `node scripts/gen-dev-env.mjs` appends any that is missing and generates the keys an example marks, and it prints no value. The dry run used ports 8380, 8390 and, for the push site, 8391 in its scratch clone. If another program listens on port 8080 on every interface, `localhost:8080` reaches it over IPv6 and the smoke test answers 404 on every path of the site of the app: free the port, or run the smoke step with `NODE_OPTIONS=--dns-result-order=ipv4first` (an earlier replay met this).
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app): Activity and the rest of engagement in the app: the nav gains Activity second (Bell), four items on a phone, whose Settings is the profile's button; /activity with All and Conversations in the address, entries as named articles, New since you last looked and Earlier, the seen marker, the pill after 30 s, focus after it and Load more; RichText links stored mentions only, the composer says who is told; Avatar draws src; the picker on Settings, Profile with Top, Middle and Bottom, the status line, refused, failed and reset lines and the removal's question; hide counts in the composer and the More menu; Getting started on an empty Following; Settings, Activity saves a settled choice once; Privacy's Link previews; steps 52 to 57`.

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
python docs/superpowers/prompts/engagement-2d/write_blocks.py docs/superpowers/prompts/engagement-2d/06-share-cards-indexing-terms.md 1
```

Expected: 11 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/cards.test.ts`

```ts
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
```

### Create `apps/api/test/integration/http-cards.test.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pino from "pino";
import type { MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { createCards } from "../../src/cards";
import { loadConfig, type Config } from "../../src/config";
import type { AppEnv } from "../../src/env";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia, mediaForCases } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { avatarSet } from "../../src/moderation/automated";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS } from "../../src/social/tiers";
import { automationDeps, removeAutomation } from "./automation-fixtures";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { closeDecisions, suspendForTest } from "./moderation-decide";
import { newPostRow, removeFixtures } from "./moderation-fixtures";
import { removeRecords } from "./records-fixtures";
import { newProfile } from "./social-fixtures";

type App = ReturnType<typeof createApp>;

// A suspension at once and the automated check of a picture each commit a moderator's or a program's decision: slow on a
// loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * 2d Task 6 (design, sections 8.1 and 8.4; section 12.3): the share cards through the real app. GET /api/cards/post/:id
 * and GET /api/cards/profile/:handle are the cards module's router, mounted beside the status route of 3f, after the
 * global limit and before the session's resolution: 204 with the head block, base64, in Korbat-Card, or 404 with no body,
 * no-store either way, the same for everyone. Each row of 8.4: a post visible, with its author's previews off (the default,
 * a generic card) and on; its author suspended (no label); withheld, removed, disabled, deleted, erased, missing, or its
 * author deleted (404); a reply and a quote, of their own text and images; an imported post with its label first; a
 * profile live, off and on, suspended, deleted, an old handle and an unknown one. An image withheld, sealed or erased is
 * never on a card, and nor is a picture that R1's review withholds (Task 4's hold), on a profile's card or as a post's
 * fallback. The status route answers as before. And every answer of the API, an image's included, says noindex.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: share cards", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let app: App;
  let h: MediaHarness;
  let startedAt: string;
  let resolved = 0;
  const accounts: string[] = [];
  const media: string[] = [];

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 6 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    h = await mediaHarness(apiDb);
    startedAt = (await apiDb.execute<{ now: string }>(sql`select now()::text as now`))[0]!.now;
    const rateLimitStore = new MemoryStore();
    const auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer: new MemoryMailer(),
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    // The session's resolution, counted: a card route must never reach it.
    const resolveSession: MiddlewareHandler<AppEnv> = (c, next) => {
      resolved++;
      return auth.resolveSession(c, next);
    };
    // The media module over the harness's two volumes, so its stand-in worker's files are the ones served.
    const mediaModule = createMedia({
      apiDb,
      uploadsDir: h.files.uploads.root,
      storeDir: h.files.store.root,
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: mediaModule.forPosts });
    const cards = createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth: { ...auth, resolveSession }, social, media: mediaModule, cards });
  }, 240_000);
  afterAll(async () => {
    try {
      await closeDecisions();
      await removeAutomation(migrateDb, startedAt, media);
      await removeRecords(migrateDb, accounts);
      await removeFixtures(migrateDb, accounts);
    } finally {
      h.cleanup();
      await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
    }
  });

  const origin = () => new URL(config.APP_ORIGIN).origin;
  const LF = String.fromCharCode(10);

  /** A card route's answer: its status, its body, its head block decoded (null without one), and its two headers. */
  async function card(path: string, headers: Record<string, string> = {}) {
    const res = await app.request(path, { headers });
    const header = res.headers.get("korbat-card");
    return {
      status: res.status,
      body: await res.text(),
      block: header === null ? null : Buffer.from(header, "base64").toString("utf8"),
      cache: res.headers.get("cache-control"),
      robots: res.headers.get("x-robots-tag"),
    };
  }
  const postCard = (id: string, headers?: Record<string, string>) => card(`/api/cards/post/${id}`, headers);
  const profileCard = (handle: string, headers?: Record<string, string>) => card(`/api/cards/profile/${handle}`, headers);
  /** The block's lines as [key, content], each a meta element of its own. */
  function metas(block: string | null): [string, string][] {
    if (block === null) throw new Error("no block");
    return block.split(LF).map((line) => {
      const found = /^<meta (?:name|property)="([^"]+)" content="([^"]*)" [/]>$/.exec(line);
      if (!found) throw new Error(`a line that is no meta element: ${line}`);
      return [found[1]!, found[2]!];
    });
  }
  const value = (block: string | null, key: string) => metas(block).find(([k]) => k === key)?.[1];
  const keysOf = (block: string | null) => metas(block).map(([key]) => key);
  const GENERIC_POST = ["robots", "og:site_name", "og:type", "og:url", "og:title", "twitter:card"];

  /** An account of this file, three days old, with its display name and bio. */
  async function account(displayName: string, bio = "") {
    const made = await newProfile(apiDb, { createdAt: new Date(Date.now() - 3 * DAY_MS), displayName });
    accounts.push(made.id);
    if (bio !== "") await apiDb.execute(sql`update profiles set bio = ${bio} where id = ${made.id}::uuid`);
    return made;
  }
  /** Link previews on or off, as setSharePreviews writes the column (the API role's own grant). */
  const previews = (id: string, on: boolean) => apiDb.execute(sql`update profiles set share_previews = ${on} where id = ${id}::uuid`);
  /** A picture set as the account's own, as setAvatar sets it: the harness's ready upload attached in a transaction. */
  async function pictured(id: string): Promise<string> {
    const avatar = await h.readyAvatar(id);
    media.push(avatar);
    await apiDb.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await h.deps.repo.attachAvatar(tx, id, avatar);
    });
    return avatar;
  }

  test("a visible post: the generic card while its author's previews are off (the default), the full card once on; no-store and noindex either way", async () => {
    const ada = await account("Ada Card");
    const id = await newPostRow(apiDb, ada.id, { body: "Cards are built by the API" });
    const off = await postCard(id);
    expect([off.status, off.body, off.cache, off.robots]).toEqual([204, "", "no-store", "noindex"]);
    expect(metas(off.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "website"],
      ["og:url", `${origin()}/post/${id}`],
      ["og:title", "A post on korbat"],
      ["twitter:card", "summary"],
    ]);
    expect(off.block).not.toContain(ada.handle);
    expect(off.block).not.toContain("Cards are built");
    await previews(ada.id, true);
    const on = await postCard(id);
    expect(on.status).toBe(204);
    // The time the post was written, as a signed-out read of the post gives it.
    const created = ((await (await app.request(`/api/posts/${id}`)).json()) as { createdAt: string }).createdAt;
    expect(metas(on.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "article"],
      ["og:url", `${origin()}/post/${id}`],
      ["og:title", `Ada Card (@${ada.handle})`],
      ["og:description", "Cards are built by the API"],
      ["description", "Cards are built by the API"],
      ["article:published_time", created],
      ["twitter:card", "summary"],
    ]);
  });

  test("withheld, removed, disabled, deleted, erased and missing posts get 404 with no body, as the status route answers them; a visible one 204 from both", async () => {
    const ada = await account("Ada States");
    await previews(ada.id, true);
    const posts: Record<string, string> = {};
    for (const state of ["visible", "withheld", "removed", "disabled", "deleted_by_author", "erased"] as const) {
      const id = await newPostRow(apiDb, ada.id, { body: `a post that is ${state}` });
      if (state === "deleted_by_author") await migrateDb.execute(sql`update posts set state = 'deleted_by_author', body = '', deleted_at = now() where id = ${id}::uuid`);
      // An erasure, as 3c's R4 redaction leaves a post: the body blanked and the post removed.
      else if (state === "erased") await migrateDb.execute(sql`update posts set erased_at = now(), body = '', state = 'removed', moderation_level = 'removed' where id = ${id}::uuid`);
      else if (state !== "visible") await migrateDb.execute(sql`update posts set state = ${state}::post_state, moderation_level = ${state}::moderation_level where id = ${id}::uuid`);
      posts[state] = id;
    }
    posts.missing = randomUUID();
    for (const [state, id] of Object.entries(posts)) {
      const answer = await postCard(id);
      const status = await app.request(`/api/posts/${id}/status`);
      const expected = state === "visible" ? 204 : 404;
      expect([state, answer.status, status.status]).toEqual([state, expected, expected]);
      if (expected === 404) expect([state, answer.body, answer.block, answer.cache, answer.robots]).toEqual([state, "", null, "no-store", "noindex"]);
      expect(await status.text()).toBe("");
    }
  });

  test("a malformed id or handle is 404 with no body, never the validator's JSON", async () => {
    for (const path of ["/api/cards/post/not-a-uuid", `/api/cards/post/${encodeURIComponent("../health")}`, `/api/cards/post/${"x".repeat(300)}`, "/api/cards/profile/ab", "/api/cards/profile/a-b", `/api/cards/profile/${"a".repeat(21)}`, `/api/cards/profile/${encodeURIComponent("../me")}`]) {
      const answer = await card(path);
      expect([path, answer.status, answer.body, answer.block]).toEqual([path, 404, "", null]);
    }
  });

  test("a post's image is the first one shown to everyone: a withheld, a sealed and an erased image are never named; the image's own size and description", async () => {
    const ada = await account("Ada Images");
    await previews(ada.id, true);
    const { postId, mediaIds } = await h.postWithImages(ada.id, 4, "four images");
    media.push(...mediaIds);
    const [withheld, sealed, erased, shown] = mediaIds as [string, string, string, string];
    await migrateDb.execute(sql`update post_media set moderation_state = 'withheld' where id = ${withheld}::uuid`);
    await migrateDb.execute(sql`update post_media set moderation_state = 'sealed' where id = ${sealed}::uuid`);
    await migrateDb.execute(sql`update post_media set erased_at = now() where id = ${erased}::uuid`);
    const answer = await postCard(postId);
    expect(answer.status).toBe(204);
    expect(keysOf(answer.block)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "og:image", "og:image:type", "og:image:width", "og:image:height", "og:image:alt", "article:published_time", "twitter:card"]);
    expect(value(answer.block, "og:image")).toBe(`${origin()}/api/media/${shown}/large.webp`);
    expect([value(answer.block, "og:image:type"), value(answer.block, "og:image:width"), value(answer.block, "og:image:height"), value(answer.block, "og:image:alt")]).toEqual(["image/webp", "2048", "1536", "image 4"]);
    expect(value(answer.block, "twitter:card")).toBe("summary_large_image");
    for (const hidden of [withheld, sealed, erased]) expect(answer.block).not.toContain(hidden);
    // Every answer of the API says noindex, an image's too.
    const file = await app.request(`/api/media/${shown}/large.webp`);
    expect([file.status, file.headers.get("x-robots-tag")]).toEqual([200, "noindex"]);
    await file.arrayBuffer();
  });

  test("a reply and a quote: each its own text and images, nothing of the parent, nothing of the quoted post", async () => {
    const [ada, grace] = [await account("Ada Replies"), await account("Grace Quoted")];
    await previews(ada.id, true);
    await previews(grace.id, true);
    const { postId: quotedId, mediaIds } = await h.postWithImages(grace.id, 1, "the quoted post's words");
    media.push(...mediaIds);
    const parent = await newPostRow(apiDb, grace.id, { body: "the parent's words" });
    const reply = await newPostRow(apiDb, ada.id, { body: "a reply of my own", replyToId: parent });
    const quote = await newPostRow(apiDb, ada.id, { body: "a quote of my own", quoteOfId: quotedId });
    const replied = await postCard(reply);
    expect(value(replied.block, "og:description")).toBe("a reply of my own");
    expect(replied.block).not.toContain(grace.handle);
    expect(replied.block).not.toContain("parent");
    const quoted = await postCard(quote);
    expect(value(quoted.block, "og:description")).toBe("a quote of my own");
    expect(keysOf(quoted.block)).not.toContain("og:image");
    expect(quoted.block).not.toContain(mediaIds[0]!);
    expect(quoted.block).not.toContain("quoted post");
  });

  test("an imported post carries its label first, with its source and the archive's day", async () => {
    const ada = await account("Ada Imports");
    await previews(ada.id, true);
    const jobId = randomUUID();
    await migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, status, declared_bytes) values (${jobId}::uuid, ${ada.id}::uuid, 'mastodon', 'publishing', 1000)`);
    const postId = randomUUID();
    const result = await createSocialRepo(apiDb).publishImportedBatch(
      { id: jobId, ownerId: ada.id, source: "mastodon", cursor: 0 },
      { lines: 1, posts: [{ id: postId, parentId: null, body: "a post from elsewhere", originalCreatedAt: "2019-03-03T12:00:00Z", shortened: true, key: randomBytes(32).toString("hex"), images: [] }] },
      new Date(),
      async () => undefined,
    );
    expect(result.written).toBe(true);
    const answer = await postCard(postId);
    expect(value(answer.block, "og:description")).toBe("Imported from Mastodon, dated 3 March 2019, shortened on import. a post from elsewhere");
  });

  test("a live profile: generic while its previews are off, then its name, bio and picture; a post without an image falls back to the author's picture", async () => {
    const ada = await account("Ada Profile", "Engines and notes.");
    const off = await profileCard(ada.handle.toUpperCase());
    expect([off.status, off.body, off.cache, off.robots]).toEqual([204, "", "no-store", "noindex"]);
    expect(metas(off.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "website"],
      ["og:url", `${origin()}/u/${ada.handle}`],
      ["og:title", "A profile on korbat"],
      ["twitter:card", "summary"],
    ]);
    expect(off.block).not.toContain("Engines");
    await previews(ada.id, true);
    const bare = await profileCard(ada.handle);
    expect(metas(bare.block)).toEqual([
      ["robots", "noindex"],
      ["og:site_name", "korbat"],
      ["og:type", "profile"],
      ["og:url", `${origin()}/u/${ada.handle}`],
      ["og:title", `Ada Profile (@${ada.handle})`],
      ["og:description", "Engines and notes."],
      ["description", "Engines and notes."],
      ["profile:username", ada.handle],
      ["twitter:card", "summary"],
    ]);
    const avatar = await pictured(ada.id);
    const shown = await profileCard(ada.handle);
    expect(keysOf(shown.block)).toEqual(["robots", "og:site_name", "og:type", "og:url", "og:title", "og:description", "description", "og:image", "og:image:type", "og:image:alt", "profile:username", "twitter:card"]);
    expect([value(shown.block, "og:image"), value(shown.block, "og:image:type"), value(shown.block, "og:image:alt")]).toEqual([`${origin()}/api/media/${avatar}/large.webp`, "image/webp", `Profile picture of @${ada.handle}`]);
    const post = await postCard(await newPostRow(apiDb, ada.id, { body: "no image of its own" }));
    expect(value(post.block, "og:image")).toBe(`${origin()}/api/media/${avatar}/large.webp`);
    expect(value(post.block, "og:image:alt")).toBe(`Profile picture of @${ada.handle}`);
    expect(value(post.block, "twitter:card")).toBe("summary");
    // Never a count, the verified mark or a standing.
    await migrateDb.execute(sql`update profiles set verified_at = now(), follower_count = 4321, post_count = 8765 where id = ${ada.id}::uuid`);
    const counted = await profileCard(ada.handle);
    for (const absent of ["4321", "8765", "erified"]) expect(counted.block).not.toContain(absent);
  });

  test("a picture that R1's review withholds is on no card: not on its profile's, not as a post's fallback", async () => {
    const rex = await account("Rex Reviewed", "Under review.");
    await previews(rex.id, true);
    const avatar = await pictured(rex.id);
    const postId = await newPostRow(apiDb, rex.id, { body: "a post without an image" });
    expect(value((await profileCard(rex.handle)).block, "og:image")).toBe(`${origin()}/api/media/${avatar}/large.webp`);
    // As automation-avatar does: a score at the threshold, AUTOMATION_R1_ACTS on, and the program's step waited for.
    await apiDb.execute(sql`update post_media set nsfw_score = ${0.9}::real where id = ${avatar}::uuid`);
    const deps = automationDeps(apiDb, { media: mediaForCases(h.deps) }, { AUTOMATION_R1_ACTS: "on" });
    avatarSet(deps, rex.id, avatar);
    await deps.background.settle();
    const [state] = await apiDb.execute<{ state: string }>(sql`select moderation_state::text as state from post_media where id = ${avatar}::uuid`);
    expect(state!.state).toBe("withheld");
    for (const answer of [await profileCard(rex.handle), await postCard(postId)]) {
      expect(answer.status).toBe(204);
      expect(keysOf(answer.block)).not.toContain("og:image");
      expect(answer.block).not.toContain(avatar);
    }
    expect(value((await profileCard(rex.handle)).block, "og:description")).toBe("Under review.");
  });

  test("a suspended account's visible post and profile keep their cards, with no label", async () => {
    const sam = await account("Sam Later", "Still here.");
    await previews(sam.id, true);
    const postId = await newPostRow(apiDb, sam.id, { body: "written before the suspension" });
    const before = [await postCard(postId), await profileCard(sam.handle)];
    await suspendForTest(apiDb, sam.id);
    const [suspended] = await apiDb.execute<{ on: boolean }>(sql`select (suspended_from is not null and suspended_from <= now()) as on from profiles where id = ${sam.id}::uuid`);
    expect(suspended!.on).toBe(true);
    const after = [await postCard(postId), await profileCard(sam.handle)];
    expect(after.map((answer) => [answer.status, answer.block])).toEqual(before.map((answer) => [answer.status, answer.block]));
    for (const answer of after) expect(answer.block?.toLowerCase()).not.toContain("suspend");
  });

  test("a deleted account: 404 for its profile and for a post of it, whatever the post's row still says; an old handle and an unknown one 404", async () => {
    const gone = await account("Gone Soon", "A bio.");
    await previews(gone.id, true);
    const postId = await newPostRow(apiDb, gone.id, { body: "left visible by a purge in flight" });
    expect((await postCard(postId)).status).toBe(204);
    await migrateDb.execute(sql`update profiles set deleted_at = now() where id = ${gone.id}::uuid`);
    for (const answer of [await postCard(postId), await profileCard(gone.handle)]) expect([answer.status, answer.body, answer.block]).toEqual([404, "", null]);

    const moved = await account("Moved On");
    const renamed = `r_${randomBytes(5).toString("hex")}`;
    await migrateDb.execute(sql`update profiles set handle = ${renamed}, handle_changed_at = now() where id = ${moved.id}::uuid`);
    await migrateDb.execute(sql`insert into handle_history (handle_lower, profile_id, changed_at) values (${moved.handle}, ${moved.id}::uuid, now())`);
    expect((await profileCard(moved.handle)).status).toBe(404);
    expect((await profileCard(renamed)).status).toBe(204);
    expect(value((await profileCard(renamed)).block, "og:url")).toBe(`${origin()}/u/${renamed}`);
    expect((await profileCard(`n_${randomBytes(5).toString("hex")}`)).status).toBe(404);
  });

  test("it reads no session: a cookie and a bearer token change nothing, and the session's resolution is never reached", async () => {
    const ada = await account("Ada Session");
    await previews(ada.id, true);
    const postId = await newPostRow(apiDb, ada.id, { body: "the same for everyone" });
    const carried = { cookie: "korbat_session=abc; __Host-korbat_session=def", authorization: `Bearer ${"a".repeat(43)}` };
    resolved = 0;
    const plain = [await postCard(postId), await profileCard(ada.handle), await postCard(randomUUID())];
    const withSession = [await postCard(postId, carried), await profileCard(ada.handle, carried), await postCard(randomUUID(), carried)];
    expect(withSession.map((answer) => [answer.status, answer.block])).toEqual(plain.map((answer) => [answer.status, answer.block]));
    expect(resolved).toBe(0);
    // The post's own read, beside it, does go through the session's resolution.
    await app.request(`/api/posts/${postId}`, { headers: carried });
    expect(resolved).toBeGreaterThan(0);
  });

  test("the card routes stand behind the global limit, as the status route does", async () => {
    const store = new MemoryStore();
    const logger = pino({ level: "silent" });
    const social = createSocial({ apiDb, rateLimitStore: store, logger, requireSession: async (_c, next) => next(), requireFreshAuth: async (_c, next) => next() });
    const limited = createApp({
      config,
      logger,
      rateLimitStore: store,
      healthChecks: {},
      auth: createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer: new MemoryMailer(), profiles: createProfileStore(apiDb), turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } }),
      social,
      cards: createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN }),
    });
    let last = 0;
    for (let n = 0; n < 300; n++) last = (await limited.request(`/api/cards/post/${randomUUID()}`)).status;
    expect(last).toBe(404);
    const [post, profile] = [await limited.request(`/api/cards/post/${randomUUID()}`), await limited.request("/api/cards/profile/nobody_here")];
    expect([post.status, profile.status]).toEqual([429, 429]);
  });
});
```

### Replace `apps/admin/test/console-site.test.ts` (whole file)

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDevServer } from "../dev-server.mjs";
import { CONSOLE_CSP, consoleSiteHeaders, isHashedPath } from "../site-headers.mjs";
import {
  APP_SITE,
  caddyOrder,
  CONSOLE_SITE,
  consoleSiteHeadersFromCaddyfile,
  handles,
  lines,
  matcherTakes,
  parseCaddyfile,
  pathMatchers,
  readCaddyfile,
  routeFor,
  site,
  type CaddyNode,
  type Handle,
} from "./caddyfile";

/**
 * Caddy's console site (3a design, sections 8 and 13, Task 7) against the console's own definition of its headers,
 * site-headers.mjs, which the development server sends: the two cannot drift, so the console runs locally under the policy
 * it runs under in production. Also the console site's routes, the app site's refusal of the staff API, and how the image,
 * Compose and infra/.env.example carry the console.
 */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

/** The paths the page, the router's addresses, the icon and the hashed files are asked for at, and a hashed name the build does not hold. */
const PATHS = ["/", "/index.html", "/signin", "/audit", "/enroll/abc", "/no/such/page", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css", "/assets/main-MISSING0.js"];
/** Those of the paths that name a file of the build; every other is answered with index.html. */
const FILES = new Set(["/index.html", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css"]);
/**
 * The headers site-headers.mjs gives the answer to `p`, as the development server asks for them: for the path itself when
 * it names a file, and for the page ("/") when index.html is answered in its place.
 */
const devHeaders = (p: string) => consoleSiteHeaders(FILES.has(p) ? p : "/");

/** The answer of a handle that refuses a path: Caddy's own 404 in the API's error envelope, never a proxy. */
function expectRefusal(handle: Handle) {
  const block = lines(handle.block);
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond");
  expect(respond?.tokens.length, block.join(" | ")).toBe(3);
  expect(respond!.tokens[2]).toBe("404");
  expect(JSON.parse(respond!.tokens[1]!)).toEqual({ error: { code: "not_found", message: "No such route" } });
  expect(block).toContain("header Content-Type application/json");
  expect(block).toContain("header Cache-Control no-store");
  expect(block).toContain("header -Server");
  expect(block.some((line) => line.startsWith("reverse_proxy"))).toBe(false);
}

describe("the reader of the Caddyfile", () => {
  test("reads blocks, quoted values, matchers and snippets, and drops comments", () => {
    const tree = parseCaddyfile(
      [
        "(refuse) {",
        "  respond `{\"a\": 1}` 404",
        "}",
        ":1 {",
        "  # a comment {",
        "  @m path /a/* /b",
        "  handle @m {",
        "    import refuse",
        "  }",
        "  handle {",
        "    header {",
        '      X-One "a; b c"',
        "      -Server",
        "    }",
        "    import /etc/some.caddy",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(tree.map((node) => node.tokens)).toEqual([[":1"]]);
    const one = site(tree, ":1");
    const [first, second] = handles(one);
    expect(first!.match).toEqual({ paths: ["/a/*", "/b"], file: false, not: false });
    expect(lines(first!.block)).toEqual(['respond {"a": 1} 404']);
    expect(second!.matcher).toBeNull();
    expect(lines(second!.block)).toEqual(["header", "X-One a; b c", "-Server", "import /etc/some.caddy"]);
  });

  test("reads path matchers with and without file, negated on one line or in a block, and evaluates them", () => {
    const block = site(
      parseCaddyfile([":1 {", "  @a path /x/*", "  @b {", "    path /x/*", "    file", "  }", "  @c {", "    not {", "      path /x/*", "      file", "    }", "  }", "  @d {", "    not path /x/*", "  }", "  @e header X-A b", "}"].join("\n")),
      ":1",
    );
    const m = pathMatchers(block);
    expect(m.get("@b")).toEqual({ paths: ["/x/*"], file: true, not: false });
    expect(m.get("@c")).toEqual({ paths: ["/x/*"], file: true, not: true });
    expect(m.get("@d")).toEqual({ paths: ["/x/*"], file: false, not: true });
    expect(m.get("@e")).toBeNull();
    const takes = (name: string, p: string, isFile: boolean) => matcherTakes(m.get(name), p, isFile);
    expect([takes("@a", "/x/y", false), takes("@b", "/x/y", false), takes("@b", "/x/y", true), takes("@c", "/x/y", false), takes("@c", "/x/y", true), takes("@c", "/z", true)]).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
    expect(() => matcherTakes(m.get("@e"), "/x")).toThrow(/cannot evaluate/);
  });

  test("3f: an import's name takes Caddy's environment placeholders, from the variables given or their default; one that names no snippet stays a line", () => {
    const text = ["(site_open) {", "  respond open", "}", "(site_closed) {", "  respond closed", "}", ":1 {", "  import site_{$WHICH:open}", "}"].join("\n");
    expect(lines(site(parseCaddyfile(text), ":1"))).toEqual(["respond open"]);
    expect(lines(site(parseCaddyfile(text, { WHICH: "closed" }), ":1"))).toEqual(["respond closed"]);
    expect(lines(site(parseCaddyfile(text, { WHICH: "clsoed" }), ":1"))).toEqual(["import site_clsoed"]);
  });

  test("refuses a block left open or closed twice, and an unclosed quote", () => {
    expect(() => parseCaddyfile(":1 {\n")).toThrow(/open/);
    expect(() => parseCaddyfile("}\n")).toThrow(/never opened/);
    expect(() => parseCaddyfile(':1 {\n  respond "x 404\n}\n')).toThrow(/quote/);
  });

  test("orders handles as Caddy 2.11.4 does: one path most specific first, matchers before none, written order otherwise", () => {
    const order = (text: string) => caddyOrder(handles(site(parseCaddyfile(text), ":1"))).map((h) => h.matcher ?? "none");
    expect(order([":1 {", "  handle /api/* {", "  }", "  handle /api/staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n"))).toEqual([
      "/api/staff/*",
      "/api/staff",
      "/api/*",
      "none",
    ]);
    // What `caddy adapt` printed for this site on Caddy 2.11.4: a matcher with two paths compares equal to both
    // one-path handles, so the more specific /api/staff/* stays behind /api/* (the comparison is not transitive).
    expect(
      order([":1 {", "  handle /api/* {", "  }", "  @staff path /api/staff /api/staff/*", "  handle @staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n")),
    ).toEqual(["/api/*", "@staff", "/api/staff/*", "none"]);
  });
});

describe("the console site sends exactly the headers the development server sends", () => {
  test("the CSP of section 3, the one site-headers.mjs defines", () => {
    expect(consoleSiteHeadersFromCaddyfile()("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
  });

  test("every header, for the page, the router's addresses, the icon and the hashed files", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) expect(headersFor(p, FILES.has(p)), p).toEqual(devHeaders(p));
  });

  test("the page is neither stored nor transformed, and only the hashed files are kept, for a year", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) {
      const hashedFile = FILES.has(p) && isHashedPath(p);
      expect(headersFor(p, FILES.has(p))["Cache-Control"], p).toBe(hashedFile ? "public, max-age=31536000, immutable" : "no-store, no-transform");
    }
    // The page answered for a hashed name the build does not hold is a page like any other, never kept under that name.
    expect(headersFor("/assets/main-MISSING0.js", false)["Cache-Control"]).toBe("no-store, no-transform");
    expect(headersFor("/assets/main-ABCDEFGH.js", true)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  test("the development server takes its headers from site-headers.mjs and spells no policy of its own", () => {
    const devServer = read("apps", "admin", "dev-server.mjs");
    expect(devServer).toContain('import { consoleSiteHeaders } from "./site-headers.mjs";');
    expect(devServer).toMatch(/res\.writeHead\(200, \{ \.\.\.consoleSiteHeaders\(served\),/);
    expect(devServer).not.toMatch(/Content-Security-Policy|default-src|trusted-types|Permissions-Policy|immutable/i);
  });

  describe("and the development server's answers carry the Caddyfile's console headers", () => {
    let dist = "";
    let dev: Server;
    let base = "";

    beforeAll(async () => {
      dist = mkdtempSync(path.join(tmpdir(), "korbat-admin-site-"));
      mkdirSync(path.join(dist, "assets"));
      writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>console</title>");
      writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.js"), "console.log(1)");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.css"), "body{}");
      // No API answers here: only static files are asked for.
      dev = createDevServer({ dist, api: "http://127.0.0.1:9" });
      await new Promise<void>((resolve) => dev.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(dev.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => dev.close(resolve));
      rmSync(dist, { recursive: true, force: true });
    });

    test("the same headers, and no other, on every static answer", async () => {
      const headersFor = consoleSiteHeadersFromCaddyfile();
      // What any HTTP server adds about the answer itself, beside the site's headers.
      const own = new Set(["content-type", "content-length", "date", "connection", "keep-alive", "transfer-encoding"]);
      for (const p of PATHS.filter((p) => p !== "/index.html")) {
        const res = await fetch(`${base}${p}`);
        expect(res.status, p).toBe(200);
        const expected = Object.fromEntries(Object.entries(headersFor(p, FILES.has(p))).map(([name, value]) => [name.toLowerCase(), value]));
        const sent = Object.fromEntries([...res.headers.entries()].filter(([name]) => !own.has(name)));
        expect(sent, p).toEqual(expected);
      }
    });
  });
});

describe("the console site's routes", () => {
  const consoleSite = () => site(readCaddyfile(), CONSOLE_SITE);

  test("the push network's refusal (3f), the staff API, then the rest of the API, then the console's files, whatever order Caddy sorts them in", () => {
    const routes = caddyOrder(handles(consoleSite()));
    expect(routes.map((route) => route.match ?? null)).toEqual([
      { paths: [], file: false, not: false, remoteIp: ["{$PUSH_SUBNET}"] },
      { paths: ["/api/staff", "/api/staff/*"], file: false, not: false },
      { paths: ["/api", "/api/*"], file: false, not: false },
      null,
    ]);
    // A client from the push network gets 403 and reaches nothing; the readers' requests never come from there.
    const push = routes[0]!;
    expect(lines(push.block)).toEqual(["header -Server", "respond 403"]);
    for (const p of ["/", "/api/staff/me", "/api/me"]) expect(routeFor(consoleSite(), p).matcher, p).not.toBe("@push");
  });

  test("3f: on the app's site the API proxy and the app's files each answer a client from the push network 403 first", () => {
    const app = site(readCaddyfile(), APP_SITE);
    expect(lines(app)).toContain("@push remote_ip {$PUSH_SUBNET}");
    expect(lines(routeFor(app, "/api/me").block)).toContain("respond @push 403");
    expect(lines(routeFor(app, "/").block)).toContain("respond @push 403");
    // 2d Task 6 (design, section 12.4): a post's page and a profile's page, each handle's first line.
    for (const p of ["/post/x", "/u/x"]) expect(routeFor(app, p).block.children![0]!.tokens, p).toEqual(["respond", "@push", "403"]);
  });

  test("/api/staff and /api/staff/* go to the API as on the app's site: 64KB bodies, no Server header, cf-header, the browser's Host", () => {
    for (const p of ["/api/staff", "/api/staff/me", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", "/api/staff/enroll/options"]) {
      expect(routeFor(consoleSite(), p).match?.paths, p).toEqual(["/api/staff", "/api/staff/*"]);
    }
    const staff = routeFor(consoleSite(), "/api/staff/me").block;
    const body = staff.children?.find((node) => node.tokens[0] === "request_body");
    expect(body?.tokens).toEqual(["request_body"]);
    expect(lines(body!)).toEqual(["max_size 64KB"]);
    expect(lines(staff)).toContain("header -Server");
    const proxy = staff.children?.find((node) => node.tokens[0] === "reverse_proxy");
    expect(proxy?.tokens).toEqual(["reverse_proxy", "api:3000"]);
    // The import sits inside reverse_proxy, where header_up lines belong: a client-set CF-Connecting-IP is dropped unless TUNNEL=on.
    expect(lines(proxy!)).toEqual(["import /etc/caddy/cf-header.caddy"]);
    // The staff gate compares the Host the browser sent with CONSOLE_ORIGIN, so Caddy sets no Host of its own.
    expect(lines(staff).filter((line) => /header_up|header_down|transport|X-Forwarded/i.test(line))).toEqual([]);
  });

  test("any other path of the API is Caddy's own 404 and never reaches the API", () => {
    for (const p of ["/api", "/api/me", "/api/auth/signin", "/api/staffx", "/api/media"]) {
      const route = routeFor(consoleSite(), p);
      expect(route.match?.paths, p).toEqual(["/api", "/api/*"]);
      expectRefusal(route);
    }
  });

  test("everything else is the console's files from /console, outside the app's /srv, with index.html as the fallback, gzipped", () => {
    for (const p of ["/", "/signin", "/audit", "/enroll/abc", "/assets/main-ABCDEFGH.js", "/favicon.svg", "/apix"]) expect(routeFor(consoleSite(), p).matcher, p).toBeNull();
    const files = lines(routeFor(consoleSite(), "/").block);
    expect(files).toContain("root * /console");
    expect(files).toContain("encode gzip");
    expect(files).toContain("try_files {path} /index.html");
    expect(files).toContain("file_server");
    expect(files).toContain("-Server");
  });

  test("the app's site serves nothing from /console", () => {
    expect(lines(site(readCaddyfile(), APP_SITE)).filter((line) => line.includes("/console"))).toEqual([]);
  });
});

describe("the app's site refuses the staff API ahead of its API proxy", () => {
  const appSite = () => site(readCaddyfile(), APP_SITE);

  test("/api/staff and /api/staff/* reach a 404 of Caddy's own, whatever order Caddy sorts the handles in", () => {
    for (const p of ["/api/staff", "/api/staff/", "/api/staff/me", "/api/staff/signin/options", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"]) {
      expectRefusal(routeFor(appSite(), p));
    }
  });

  test("every other API path still reaches the API, and the rest the app's files", () => {
    for (const p of ["/api/me", "/api/auth/signin", "/api/media", "/api/staffx", "/api/staff-notes"]) {
      const route = routeFor(appSite(), p);
      expect(route.match?.paths, p).toEqual(["/api/*"]);
      expect(lines(route.block), p).toContain("reverse_proxy api:3000");
    }
    expect(lines(routeFor(appSite(), "/").block)).toContain("root * /srv");
  });

  test("the refusals match one path each, longer than /api/*, so Caddy sorts them first by its documented rule as well", () => {
    const refusals = handles(appSite()).filter((h) => h.match?.paths.some((p) => p.startsWith("/api/staff")));
    expect(refusals.map((h) => h.match?.paths)).toEqual(expect.arrayContaining([["/api/staff"], ["/api/staff/*"]]));
    expect(refusals).toHaveLength(2);
    const order = caddyOrder(handles(appSite())).map((h) => h.matcher);
    expect(order.indexOf("/api/*")).toBeGreaterThan(Math.max(order.indexOf("/api/staff"), order.indexOf("/api/staff/*")));
  });
});

describe("the image carries the console", () => {
  const dockerfile = () => read("infra", "caddy", "Dockerfile");
  /** The lines of one build stage, from its FROM to the next. */
  const stage = (name: string) => {
    const text = dockerfile();
    const start = text.search(new RegExp(`^FROM .+ AS ${name}$`, "m"));
    expect(start, `a stage named ${name}`).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\nFROM ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  test("the console is built in a stage of its own, from the same Node image as the app's, with only its own packages", () => {
    const web = stage("web");
    const admin = stage("console");
    expect(admin.split("\n")[0]!.replace(/ AS console$/, "")).toBe(web.split("\n")[0]!.replace(/ AS web$/, ""));
    expect(admin).toContain("COPY apps/admin ./apps/admin");
    expect(admin).not.toContain("COPY apps/app");
    expect(admin).toContain("RUN pnpm install --frozen-lockfile --filter @korbat/admin...");
    expect(admin).toContain("RUN pnpm --filter @korbat/admin build");
    // The page holds no build argument: nothing it is built from differs between instances.
    expect(admin).not.toMatch(/^ARG /m);
  });

  test("the final image serves the build from /console, outside the app's /srv, and exposes both sites' ports", () => {
    const text = dockerfile();
    expect(text).toContain("COPY --from=console /repo/apps/admin/dist /console");
    expect(text).toContain("COPY --from=web /repo/apps/app/dist /srv");
    expect(text).toMatch(/^EXPOSE 8080 8090 8091$/m);
    expect(text).toContain("RUN setcap -r /usr/bin/caddy");
  });

  test("3f: the push site hands ntfy the client's address in X-Forwarded-For, with the tunnel on or off", () => {
    // Behind the tunnel Caddy's client is cloudflared, so the X-Forwarded-For that Caddy writes would name cloudflared for
    // every phone, and ntfy, which reads that header (infra/ntfy/server.yml.example), would count all phones as one
    // visitor: 30 wrong tokens from anyone would then shut every phone out (lab L3). With TUNNEL=on the header takes
    // the value of CF-Connecting-IP, which cloudflared sets; with it off Caddy's own value stands.
    expect(dockerfile()).toContain(
      'RUN if [ "$TUNNEL" = "on" ]; then echo "header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}" > /etc/caddy/push-header.caddy; else : > /etc/caddy/push-header.caddy; fi',
    );
    const push = site(readCaddyfile(), ":8091");
    const subscribe = push.children?.find((node) => node.tokens[0] === "handle" && node.tokens[1] === "@subscribe");
    const proxy = subscribe?.children?.find((node) => node.tokens[0] === "reverse_proxy");
    expect(proxy?.tokens).toEqual(["reverse_proxy", "ntfy:2586"]);
    expect(lines(proxy!)).toEqual(["import /etc/caddy/cf-header.caddy", "import /etc/caddy/push-header.caddy"]);
  });
});

describe("Compose and infra/.env.example carry the console", () => {
  /** One service's block of compose.yml: from its name to the next service's. */
  const service = (name: string) => {
    const compose = read("infra", "compose.yml");
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = compose.slice(start + 1).search(/\n {2}[a-z]+:\n/);
    return compose.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  /** The comment lines right above a line of the file, joined into one text. */
  const commentAbove = (text: string, line: string) => {
    const all = text.split(/\r?\n/);
    const at = all.indexOf(line);
    expect(at, line).toBeGreaterThan(0);
    const comment: string[] = [];
    for (let i = at - 1; i >= 0 && all[i]!.trimStart().startsWith("#"); i--) comment.unshift(all[i]!.trim().replace(/^#\s?/, ""));
    return comment.join(" ");
  };

  test("the API gets the console's origin and relying party ID, empty by default", () => {
    const api = service("api");
    expect(api).toContain("CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}");
    expect(api).toContain("CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}");
  });

  test("Caddy's comment names its three ports", () => {
    const compose = read("infra", "compose.yml");
    const comment = commentAbove(compose, "  caddy:");
    expect(comment).toContain("8080");
    expect(comment).toContain("8090");
    // 3f: the phones' push site.
    expect(comment).toContain("8091");
  });

  test("the development stack publishes the console's site on localhost, on a port of its own", () => {
    const dev = read("infra", "compose.dev.yml");
    const caddy = dev.slice(dev.indexOf("\n  caddy:\n"), dev.indexOf("\n  mailpit:\n"));
    expect(caddy).toContain('"127.0.0.1:${DEV_CADDY_PORT:-8080}:8080"');
    expect(caddy).toContain('"127.0.0.1:${DEV_CONSOLE_PORT:-8090}:8090"');
    // 3f: and the push site, with the profile notify.
    expect(caddy).toContain('"127.0.0.1:${DEV_PUSH_PORT:-8091}:8091"');
  });

  test("infra/.env.example names the console's origin on the published port, and its development port", () => {
    const env = read("infra", ".env.example");
    expect(env).toMatch(/^API_CONSOLE_ORIGIN=http:\/\/localhost:8090$/m);
    expect(env).toMatch(/^API_CONSOLE_RP_ID=$/m);
    expect(env).toMatch(/^# DEV_CONSOLE_PORT=8090$/m);
    // The note that API_CONSOLE_ORIGIN names the same port on localhost.
    expect(commentAbove(env, "# DEV_CONSOLE_PORT=8090")).toMatch(/API_CONSOLE_ORIGIN must name the same port on localhost/);
    expect(commentAbove(env, "# DEV_PG_PORT=55432")).toMatch(/Defaults: 55432, 56379, 3000, 8080, 8090, 51025, 58025, 8091, 2586[.]/);
  });

  test("the passkey comment says the staff console does not use the app's RP ID, word for word", () => {
    const env = read("infra", ".env.example");
    expect(commentAbove(env, "API_WEBAUTHN_RP_ID=")).toBe(
      "Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it later strands every passkey.",
    );
  });

  test("the TUNNEL_TOKEN note names the three hostnames and the port each points at", () => {
    const note = commentAbove(read("infra", ".env.example"), "TUNNEL_TOKEN=");
    expect(note).toContain("http://caddy:8080");
    expect(note).toContain("http://caddy:8090");
    expect(note).toMatch(/console/i);
    // 3f: the phones' push hostname.
    expect(note).toContain("http://caddy:8091");
    expect(note).toMatch(/push hostname/);
  });

  test("3f: the push network's default subnet, the one Caddy refuses, lies outside the address pools Docker draws its own networks from", () => {
    const compose = read("infra", "compose.yml");
    // Every default of PUSH_SUBNET in compose.yml: the network's and Caddy's, one value.
    const defaults = compose.split("${PUSH_SUBNET:-").slice(1).map((rest) => rest.slice(0, rest.indexOf("}")));
    expect(defaults.length).toBe(2);
    expect(new Set(defaults).size).toBe(1);
    const subnet = defaults[0]!;
    // infra/.env.example names the setting with the same default.
    expect(read("infra", ".env.example").split(String.fromCharCode(10))).toContain(`# PUSH_SUBNET=${subnet}`);
    const [address, bits] = subnet.split("/");
    const octets = (address ?? "").split(".").map(Number);
    expect(octets.length).toBe(4);
    const first = octets.reduce((sum, octet) => sum * 256 + octet, 0);
    const last = first + 2 ** (32 - Number(bits)) - 1;
    const range = (from: string, to: string) => [from, to].map((ip) => ip.split(".").map(Number).reduce((sum, octet) => sum * 256 + octet, 0));
    // Docker's default pools: 172.17.0.0/16 to 172.31.0.0/16, and 192.168.0.0/16 in /20s. A fixed subnet inside them
    // collides with a network Docker gave another project on the same host, and the stack does not start.
    for (const [from, to] of [range("172.17.0.0", "172.31.255.255"), range("192.168.0.0", "192.168.255.255")]) {
      expect(last < from! || first > to!, subnet).toBe(true);
    }
  });
});

/**
 * 3f (design, sections 5 and 7.12; invariant 19, Caddy's part): a post's page is served under the status the API gives
 * the post, and APP_SITE closes the app's site. Task 4's first step tried both on Caddy 2.11.4 itself; these tests hold
 * the Caddyfile to what was tried. 2d Task 6 (design, section 8.2) moves the pins of a post's page to the share card: the
 * post's page and a profile's page each ask the API for their card, whose 204 serves card.html through templates, the
 * only templates of the site; the card lab and the first step tried that on the same image.
 */
describe("3f: the status of a post's page, and APP_SITE", () => {
  const appSite = (env: Record<string, string> = {}) => site(readCaddyfile(env), APP_SITE);
  const PAGES = [
    { page: "/post/*", path: "/post/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", card: "/api/cards/post/{http.request.uri.path.1}" },
    { page: "/u/*", path: "/u/ada", card: "/api/cards/profile/{http.request.uri.path.1}" },
  ];

  test("2d: /post/* and /u/* ask the API for the page's card and serve card.html through templates for 204, the shell with 404 for 404, the shell with 200 for anything else", () => {
    for (const { page, path: p, card } of PAGES) {
      const route = routeFor(appSite(), p);
      expect(route.match?.paths, p).toEqual([page]);
      expect(route.block.children![0]!.tokens, p).toEqual(["respond", "@push", "403"]);
      const block = lines(route.block);
      for (const line of ["encode gzip", "request_header -Range", "header Cache-Control no-cache", "header X-Robots-Tag noindex"]) expect(block, `${p}: ${line}`).toContain(line);
      const proxy = route.block.children!.find((node) => node.tokens[0] === "reverse_proxy")!;
      expect(proxy.tokens).toEqual(["reverse_proxy", "api:3000"]);
      const asked = lines(proxy);
      for (const line of ["import /etc/caddy/cf-header.caddy", "method GET", `rewrite ${card}`, "@shown status 204", "@gone status 404"]) expect(asked, `${p}: ${line}`).toContain(line);
      const answers = proxy.children!.filter((node) => node.tokens[0] === "handle_response");
      expect(answers.map((node) => node.tokens)).toEqual([["handle_response", "@shown"], ["handle_response", "@gone"], ["handle_response"]]);
      // The card is card.html through templates; the other two the same shell, index.html from /srv, 404 only for 404.
      expect(lines(answers[0]!), p).toEqual(["root * /srv", "rewrite * /card.html", "templates", "file_server"]);
      expect(lines(answers[1]!), p).toEqual(["root * /srv", "rewrite * /index.html", "file_server", "status 404"]);
      expect(lines(answers[2]!), p).toEqual(["root * /srv", "rewrite * /index.html", "file_server"]);
    }
    // templates runs in those two handle_response blocks and nowhere else, so no other answer and no proxied body is evaluated.
    expect(lines(appSite()).filter((line) => line.split(" ")[0] === "templates")).toEqual(["templates", "templates"]);
    expect(lines(site(readCaddyfile(), CONSOLE_SITE)).some((line) => line.split(" ")[0] === "templates")).toBe(false);
    // Never 451.
    expect(lines(appSite()).some((line) => line.includes("451"))).toBe(false);
  });

  test("a post's page and a profile's page carry the same security headers as the app's files, and the API's own headers never reach them", () => {
    const headerBlock = (handle: Handle) => handle.block.children!.filter((node) => node.tokens[0] === "header" && node.tokens.length === 1).flatMap((node) => lines(node));
    for (const p of ["/post/x", "/u/x"]) {
      const page = headerBlock(routeFor(appSite(), p));
      expect(page.length, p).toBeGreaterThan(5);
      expect(page, p).toEqual(headerBlock(routeFor(appSite(), "/")));
      expect(lines(routeFor(appSite(), p).block), p).toContain("header Cache-Control no-cache");
      expect(lines(routeFor(appSite(), p).block).some((line) => /copy_response|header_down/.test(line)), p).toBe(false);
    }
    // 8.2: X-Robots-Tag is never set and then dropped, so the shared headers do not carry it.
    expect(headerBlock(routeFor(appSite(), "/")).some((line) => line.startsWith("X-Robots-Tag"))).toBe(false);
  });

  test("when the API cannot be asked, handle_errors serves a post's or a profile's page the same shell with 200, the same headers and noindex", () => {
    const errors = appSite().children!.find((node) => node.tokens[0] === "handle_errors")!;
    expect(lines(errors)).toContain("@pages path /post/* /u/*");
    const page = errors.children!.find((node) => node.tokens[0] === "handle" && node.tokens[1] === "@pages")!;
    const shown = lines(page);
    for (const line of ["root * /srv", "rewrite * /index.html", "file_server", "status 200", "encode gzip", "header Cache-Control no-cache", "header X-Robots-Tag noindex"]) expect(shown).toContain(line);
    const headers = page.children!.filter((node) => node.tokens[0] === "header" && node.tokens.length === 1).flatMap((node) => lines(node));
    expect(headers).toEqual(routeFor(appSite(), "/").block.children!.filter((node) => node.tokens[0] === "header" && node.tokens.length === 1).flatMap((node) => lines(node)));
  });

  test("2d: /card.html asked by its own path answers 404 with no body; the files' handle says noindex on every page but the five that name no account", () => {
    const card = routeFor(appSite(), "/card.html");
    expect(card.match?.paths).toEqual(["/card.html"]);
    expect(card.block.children![0]!.tokens).toEqual(["respond", "@push", "403"]);
    expect(card.block.children!.filter((node) => node.tokens[0] === "respond" && !node.tokens[1]?.startsWith("@")).map((node) => node.tokens)).toEqual([["respond", "", "404"]]);
    expect(lines(card.block)).toContain("header X-Robots-Tag noindex");
    expect(lines(card.block).some((line) => /file_server|reverse_proxy|templates/.test(line))).toBe(false);
    const files = routeFor(appSite(), "/");
    expect(pathMatchers(files.block).get("@named")).toEqual({ paths: ["/", "/rules", "/transparency", "/explore/about", "/terms"], file: false, not: true });
    expect(lines(files.block)).toContain("header @named X-Robots-Tag noindex");
  });

  test("2d: robots.txt is 8.2's, byte for byte, its named agents the unfurlers of the card lab's crawlers.json; the image copies it to /srv and writes card.html after the export", () => {
    const robots = ["User-agent: Twitterbot", "User-agent: facebookexternalhit", "User-agent: Slackbot-LinkExpanding", "User-agent: Discordbot", "User-agent: LinkedInBot", "Allow: /post/", "Allow: /u/", "Allow: /api/media/", "Disallow: /", "", "User-agent: *", "Disallow: /", ""].join(String.fromCharCode(10));
    expect(read("infra", "caddy", "robots.txt")).toBe(robots);
    const crawlers = JSON.parse(read("infra", "caddy", "lab", "crawlers.json")) as { crawlers: { robotsToken: string | null }[] };
    expect(crawlers.crawlers.flatMap((crawler) => (crawler.robotsToken === null ? [] : [crawler.robotsToken]))).toEqual(["Twitterbot", "facebookexternalhit", "Slackbot-LinkExpanding", "Discordbot", "LinkedInBot"]);
    const dockerfile = read("infra", "caddy", "Dockerfile");
    const copied = dockerfile.indexOf("COPY infra/caddy/robots.txt /srv/robots.txt");
    expect(copied).toBeGreaterThan(dockerfile.indexOf("COPY --from=web /repo/apps/app/dist /srv"));
    const written = dockerfile.indexOf("> card.html");
    expect(written).toBeGreaterThan(dockerfile.indexOf("npx expo export --platform web"));
    expect(written).toBeLessThan(dockerfile.indexOf("AS console"));
    const action = '{{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}';
    expect(dockerfile.split(action).length - 1).toBe(1);
    expect(dockerfile).toContain('test "$(grep -c "{{" card.html)" = 1');
  });

  test("APP_SITE names the app's site: open by default; closed answers every path, the API's included, 503 with one fixed sentence; any other value names no snippet, and Caddy refuses to start", () => {
    expect(readFileSync(path.join(REPO, "infra", "caddy", "Caddyfile"), "utf8")).toContain("import app_site_{$APP_SITE:open}");
    expect(lines(appSite())).toEqual(lines(appSite({ APP_SITE: "open" })));
    const closed = appSite({ APP_SITE: "closed" });
    for (const p of ["/", "/post/x", "/api/me", "/api/staff/me", "/api/media", "/assets/a.js"]) {
      const route = routeFor(closed, p);
      expect(route.matcher, p).toBeNull();
      expect(lines(route.block), p).toContain("respond korbat is closed for maintenance. Please come back later. 503");
    }
    expect(lines(closed).some((line) => line.startsWith("reverse_proxy") || line.startsWith("file_server"))).toBe(false);
    // What Caddy 2.11.4 answered in the first step: "File to import not found: app_site_clsoed", and no site.
    expect(lines(appSite({ APP_SITE: "clsoed" }))).toEqual(["import app_site_clsoed"]);
  });

  test("Compose gives Caddy APP_SITE, open by default, and infra/.env.example names it", () => {
    expect(read("infra", "compose.yml")).toContain("APP_SITE: ${APP_SITE:-open}");
    expect(read("infra", ".env.example")).toMatch(/^APP_SITE=open$/m);
  });
});

/** Nothing in the console site's block is left for a later reader to guess at: every directive is one this test knows. */
test("the console site holds only the directives these tests check", () => {
  const known = new Set(["@staff", "@api", "@push", "handle"]);
  const top = (site(readCaddyfile(), CONSOLE_SITE).children ?? []).map((node: CaddyNode) => node.tokens[0]);
  expect(top.filter((name) => !known.has(name ?? ""))).toEqual([]);
});
```

### Replace `apps/api/test/architecture.test.ts` (whole file)

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Module boundaries (1a spec section 2.2, 2a spec section 2.2, 3a design section 5, 3c design section 5). Paths are relative to apps/api/src
 * with forward slashes. The rules are plain functions so the tests below can prove each one catches
 * a deliberate violation.
 */
interface SourceFile {
  path: string;
  source: string;
}

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA_ROOT = fileURLToPath(new URL("../../../packages/db/src/schema", import.meta.url));

/** Schema files that define auth-schema objects or shared helpers; every other schema file is public. */
const NON_PUBLIC_SCHEMA_FILES = new Set(["auth.ts", "helpers.ts", "index.ts"]);
const AUTH_SCHEMA_FILE = "auth.ts";
// The command lines open both pools: grant-role changes a role on the auth pool, and staff.js reads there the staff keys
// that audit-verify checks the record against.
const AUTH_POOL_ALLOWED = new Set(["config.ts", "index.ts", "cli/grant-role.ts", "cli/staff.ts"]);
const AUTH_KEYS_ALLOWED = new Set(["config.ts"]);

/**
 * Modules that may only be entered through their index file. 3d Task 4 adds the seventh, transparency; 3b Task 4 the eighth,
 * imports; 2d Task 2 the ninth, activity (design, section 5.4), so the rules about who imports it have something to stand on;
 * 2d Task 6 the tenth, cards (design, sections 8.1 and 12.2), which reads no session (below).
 */
const MODULES = ["auth", "social", "media", "account", "staff", "moderation", "transparency", "imports", "activity", "cards"] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function loadSources(): SourceFile[] {
  return walk(SRC_ROOT).map((full) => ({ path: relative(SRC_ROOT, full).split(sep).join("/"), source: readFileSync(full, "utf8") }));
}

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SCHEMA_ROOT, file), "utf8");
  return [...source.matchAll(/^export (?:const|function|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

/** Names exported by the public-schema files of @korbat/db (tables and enums the auth module must not touch). */
function publicSchemaNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(SCHEMA_ROOT)) {
    if (!file.endsWith(".ts") || NON_PUBLIC_SCHEMA_FILES.has(file)) continue;
    for (const name of exportedNames(file)) names.add(name);
  }
  return names;
}

/** Names exported by the auth-schema file of @korbat/db (tables and enums the social module must not touch). */
function authSchemaNames(): Set<string> {
  return new Set(exportedNames(AUTH_SCHEMA_FILE));
}

/** Every module specifier in static imports, re-exports, side-effect imports and dynamic imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)].map((m) => m[1]!);
}

/** Named bindings of every `import { ... } from "@korbat/db"`; a namespace import yields the marker "*". */
function dbImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/\bimport\s+(type\s+)?(\*\s+as\s+\w+|\{[^}]*\})\s+from\s+["'](@korbat\/db(?:\/[^"']*)?)["']/g)) {
    const bindings = match[2]!;
    if (bindings.startsWith("*")) {
      names.push("*");
      continue;
    }
    for (const part of bindings.slice(1, -1).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

const insideAuth = (path: string) => path.startsWith("auth/");
const insideSocial = (path: string) => path.startsWith("social/");
const insideMedia = (path: string) => path.startsWith("media/");
const insideAccount = (path: string) => path.startsWith("account/");
const insideStaff = (path: string) => path.startsWith("staff/");
const insideModeration = (path: string) => path.startsWith("moderation/");
const insideImports = (path: string) => path.startsWith("imports/");
const insideActivity = (path: string) => path.startsWith("activity/");

function findViolations(files: SourceFile[], publicNames: Set<string>, authNames: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\.ts$/, "");
      for (const module of MODULES) {
        if (path.startsWith(`${module}/`)) continue;
        if (target.startsWith(`${module}/`) && target !== `${module}/index`) {
          violations.push(`${path}: imports ${spec}, which is inside the ${module} module (use ./${module})`);
        }
      }
    }
    if (!insideAuth(path) && !AUTH_POOL_ALLOWED.has(path) && /\b(DATABASE_URL_AUTH|authDb)\b/.test(source)) {
      violations.push(`${path}: references the auth database pool`);
    }
    // Each encryption key with the list of the keys it replaced: after a rotation those still open what was stored before it.
    if (!insideAuth(path) && !AUTH_KEYS_ALLOWED.has(path) && /\b(TOTP_ENC_KEY|TOTP_ENC_KEYS_PREVIOUS|NOTIFIER_ENC_KEY|NOTIFIER_ENC_KEYS_PREVIOUS|AUTH_HMAC_KEY|IP_HASH_KEY)\b/.test(source)) {
      violations.push(`${path}: references an auth key`);
    }
    if (insideAuth(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import auth-schema names explicitly)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db`);
      }
    }
    if (!insideMedia(path) && /\b(postMedia|post_media)\b/.test(source)) {
      violations.push(`${path}: references post_media, which only the media module may touch`);
    }
    // 3d Task 7 (design, section 5): the three tables of the migration known_material are the media module's too.
    if (!insideMedia(path)) {
      for (const name of new Set([...source.matchAll(/(?<![A-Za-z0-9_])(mediaHashes|media_hashes|mediaMatches|media_matches|uploadRefusals|upload_refusals)(?![A-Za-z0-9_])/g)].map((m) => m[1]!))) {
        violations.push(`${path}: references ${name}, which only the media module may touch`);
      }
    }
    // The staff module (role korbat_api) reads and writes the public audit log; staff keys, staff sessions and enrolments
    // are credentials, the auth module's alone (3a design, section 5). The moderation module owns the moderation tables on
    // the same role: a notifier's contact and the staff links live in the auth schema, out of its reach (3c design, section 5).
    // 3b: the imports module too, which asks the auth module whether an address is verified (design, section 4.2). 2d:
    // and the activity module, which reads the public schema's tables and none of the auth schema's.
    if (insideSocial(path) || insideMedia(path) || insideStaff(path) || insideModeration(path) || insideImports(path) || insideActivity(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (import public-schema names explicitly)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db`);
      }
    }
    // The account module sequences the other three through their index files and holds no table access of its own
    // (1b spec, section 5): no table or enum of either schema may be named in it. Db and DbTx, which are not schema
    // names, stay allowed, since a transaction is passed through it.
    if (insideAccount(path)) {
      for (const name of dbImports(source)) {
        if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the account module holds no table access)`);
        else if (publicNames.has(name)) violations.push(`${path}: imports public-schema ${name} from @korbat/db (the account module holds no table access)`);
        else if (authNames.has(name)) violations.push(`${path}: imports auth-schema ${name} from @korbat/db (the account module holds no table access)`);
      }
    }
    // The staff module uses the auth module's interface as the other modules do, never its repository or its session
    // store, which would hand it the auth tables; the moderation module likewise. Any mention counts, so a renamed,
    // namespace or dynamic import is caught as surely as a named one.
    if (insideStaff(path) || insideModeration(path)) {
      const module = insideStaff(path) ? "staff" : "moderation";
      for (const name of new Set([...source.matchAll(/\b(createAuthRepo|createSessions)\b/g)].map((m) => m[1]!))) {
        violations.push(`${path}: uses the auth module's ${name} (the ${module} module goes through the auth module's interface)`);
      }
    }
  }
  return violations;
}

/**
 * The source pins of the freeze (3c design, sections 6.1 and 6.5). The freeze of the path for suspected child sexual abuse
 * material holds only while every path of a kind passes one gate, so who may name what is pinned here, beside the
 * database's own pins of who names the predicate there:
 *   - `post_frozen` is named only in the media repository and the moderation repository, and `frozen_for` nowhere in the
 *     API: no other file decides by itself what is frozen;
 *   - a delete of `post_media` is written only in the media repository, whose every delete the keep trigger judges and
 *     whose every answer names only rows that are gone;
 *   - `requestDeletion` (asking the worker to delete an image's files) and `openImage` (opening an image file of the
 *     store) are named in a pinned list of files, each a pinned number of times, comments included: a new caller of
 *     either fails the test until whoever adds it has checked it against the gates and listed it.
 */
const POST_FROZEN_ALLOWED = new Set(["media/repo.ts", "moderation/repo.ts"]);
const POST_MEDIA_DELETE_ALLOWED = new Set(["media/repo.ts"]);
const POST_MEDIA_DELETE = /\bdelete\s+from\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?post_media\b|\btruncate\b[^;`]*\bpost_media\b|\.delete\(\s*postMedia\b/i;

function findFreezeViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (/\bfrozen_for\b/.test(source)) violations.push(`${path}: names frozen_for, which only the database's own functions name`);
    if (/\bpost_frozen\b/.test(source) && !POST_FROZEN_ALLOWED.has(path)) violations.push(`${path}: names post_frozen, which only the media and moderation repositories may`);
    if (POST_MEDIA_DELETE.test(source) && !POST_MEDIA_DELETE_ALLOWED.has(path)) violations.push(`${path}: deletes from post_media, which only the media repository may`);
  }
  return violations;
}

/** Every file that names `name` as a whole word, with how often, comments included. */
function mentions(files: SourceFile[], name: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const { path, source } of files) {
    // Cut at every word boundary: a whole word is then a piece of its own.
    const count = source.split(/\b/).filter((piece) => piece === name).length;
    if (count > 0) found[path] = count;
  }
  return found;
}

/**
 * Where `requestDeletion` is named. A deletion request names an id that a delete of post_media answered, an upload that
 * failed before it could be put on a post, or a file that has no row: the files module writes the request; the upload's
 * removal, the sweeper, the author's deletion (after its commit), the account's purge (after its commit) and the
 * disposal's caller (after its commit) ask for it through the module's interfaces; and the one retry of what the purge
 * and the disposal owe asks for it only for a row that is gone. 3b Task 5: the imports module's interface asks for the
 * files of an import's rows on no post after the commit that deleted them (media.forImports.releaseFiles), and the
 * imports module itself names it nowhere. 3b Task 6: the undo's batches, the author's deletion path, ask for the files of
 * the rows they detached after each commit (social/flows/imports.ts).
 */
const REQUEST_DELETION = {
  "account/flows/deletion.ts": 1,
  "media/cases.ts": 4,
  "media/context.ts": 2,
  "media/files.ts": 1,
  "media/flows/remove.ts": 1,
  // 3b Task 5: one more, mediaForImports' releaseFiles. 2d Task 3: one more, mediaForPosts' dropFormerAvatar, which asks for
  // a replaced or removed avatar's files after setAvatar's or removeAvatar's commit, and only once its row went.
  "media/index.ts": 7,
  // The retry of owed deletions, which asks only for ids whose row it found gone.
  "media/owed.ts": 1,
  "media/sweeper.ts": 2,
  // The retention job, which asks for a batch's files after the commit of the transaction that deleted their rows.
  "moderation/retention.ts": 1,
  "social/context.ts": 1,
  // 3b Task 6: the undo's batches ask for the files of the image rows they detached, after each commit (6.5).
  "social/flows/imports.ts": 1,
  "social/flows/posts.ts": 1,
};

/**
 * Where `openImage` is named: the files module, which opens a file of the store under its checks, and its three callers,
 * each behind its own reader's rule: serve (gate S), the export's open (which reads the row again) and the staff's image
 * (gate V).
 */
const OPEN_IMAGE = {
  "media/cases.ts": 1,
  "media/files.ts": 1,
  "media/flows/serve.ts": 1,
  "media/index.ts": 1,
};

describe("the freeze's source pins", () => {
  test("apps/api/src names post_frozen only in the two repositories, frozen_for nowhere, and deletes from post_media only in the media repository", () => {
    expect(findFreezeViolations(loadSources())).toEqual([]);
    // The media repository does name the predicate and does delete: the pins are about a file that exists.
    const repo = loadSources().find((file) => file.path === "media/repo.ts")!;
    expect(repo.source).toMatch(/\bpost_frozen\b/);
    expect(POST_MEDIA_DELETE.test(repo.source)).toBe(true);
  });

  test("catches the predicate named outside the two repositories, and its core named anywhere", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "sql`select public.post_frozen(m.post_id) as frozen from post_media m`" },
      { path: "moderation/repo.ts", source: "sql`select not public.post_frozen(${postId}::uuid) as images_allowed`" },
      { path: "moderation/cases.ts", source: "const [row] = await tx.execute(sql`select public.post_frozen(${postId}::uuid) as frozen`);" },
      { path: "media/flows/serve.ts", source: "const frozen = await db.execute(sql`select post_frozen(${postId})`);" },
      { path: "staff/cases.ts", source: "await db.execute(sql`select public.frozen_for(${postId}::uuid, ${authorId}::uuid)`);" },
      { path: "media/repo.ts", source: "sql`select public.frozen_for(m.post_id, m.owner_id) from post_media m`" },
      // Another word that only contains the name is not the name.
      { path: "social/views.ts", source: "const post_frozen_label = 1; const unfrozen_for_now = 2;" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "moderation/cases.ts: names post_frozen, which only the media and moderation repositories may",
      "media/flows/serve.ts: names post_frozen, which only the media and moderation repositories may",
      "staff/cases.ts: names frozen_for, which only the database's own functions name",
      "media/repo.ts: names frozen_for, which only the database's own functions name",
    ]);
  });

  test("catches a delete of post_media outside the media repository, in SQL and through the query builder", () => {
    const files: SourceFile[] = [
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_media where id in (select id from post_media where post_id = ${postId}::uuid order by id for update) returning id`);\nawait db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/sweeper.ts", source: "await db.execute(sql`delete from post_media where post_id is null and created_at < ${before}`);" },
      { path: "media/flows/remove.ts", source: "await deps.db.delete(postMedia).where(eq(postMedia.id, id));" },
      { path: "media/cases.ts", source: 'await tx.execute(sql`DELETE FROM "public"."post_media" WHERE "id" = ${id}`);' },
      { path: "media/index.ts", source: "await tx.execute(sql`truncate table post_media cascade`);" },
      // Reading and updating image rows, and deleting something else, is not a delete of image rows.
      { path: "media/flows/status.ts", source: "await db.update(postMedia).set({ status }).where(eq(postMedia.id, id));\nawait db.delete(posts).where(eq(posts.id, id));\nconst rows = await db.execute(sql`select id from post_media`);" },
    ];
    expect(findFreezeViolations(files)).toEqual([
      "media/sweeper.ts: deletes from post_media, which only the media repository may",
      "media/flows/remove.ts: deletes from post_media, which only the media repository may",
      "media/cases.ts: deletes from post_media, which only the media repository may",
      "media/index.ts: deletes from post_media, which only the media repository may",
    ]);
  });

  test("requestDeletion and openImage are named in exactly the pinned files, each the pinned number of times", () => {
    expect(mentions(loadSources(), "requestDeletion")).toEqual(REQUEST_DELETION);
    expect(mentions(loadSources(), "openImage")).toEqual(OPEN_IMAGE);
  });

  test("catches a new caller of either, in a file of the list and in one outside it", () => {
    const real = loadSources();
    // A second request in the purge's flow, and a first one in a file that had none.
    const withCallers = real
      .map((file) => (file.path === "account/flows/deletion.ts" ? { ...file, source: `${file.source}\nawait deps.media.requestDeletion(kept);` } : file))
      .concat([{ path: "moderation/decide.ts", source: "await deps.media.requestDeletion(ids);" }]);
    expect(mentions(withCallers, "requestDeletion")).not.toEqual(REQUEST_DELETION);
    expect(mentions(withCallers, "requestDeletion")).toMatchObject({ "account/flows/deletion.ts": 2, "moderation/decide.ts": 1 });
    // A fourth opener of the store's files.
    const withOpener = real.concat([{ path: "staff/cases.ts", source: 'const file = await files.openImage(id, "large");' }]);
    expect(mentions(withOpener, "openImage")).not.toEqual(OPEN_IMAGE);
    // A name that only contains the word is not counted.
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "requestDeletion")).toEqual({});
    expect(mentions([{ path: "x.ts", source: "requestDeletions(); reopenImage(); openImages();" }], "openImage")).toEqual({});
  });
});

/**
 * The source pins of account sanctions (3e design, sections 11 and 12.2; invariant 23): no write of an account is added
 * without the one predicate.
 *   - The predicate's three fragments, exported by lib/standing.ts (`liveNotSuspended`, and the two halves that a locking
 *     statement answers separately, `suspendedAt` and `reportsRestrictedAt`), are named in a pinned list of files, each a
 *     pinned number of times, comments included, as REQUEST_DELETION is: whoever adds a write on behalf of an account adds
 *     its site to the list, and the auth module never names one. So is the closing judgment (`closingJudgment`, 3e's
 *     review), the last statement of a write's transaction, which reads both halves.
 *   - The profile's three derived columns are named in apps/api/src only in lib/standing.ts, social/repo.ts's
 *     lockAccounts and the moderation module's standing-repo.ts, in SQL or by drizzle's names: no other file decides by
 *     itself whether an account is suspended. Their one writer is the database's standing_apply (the function pin of 6.6).
 */
const STANDING_PREDICATE = {
  // social/repo.ts, 3e Task 6: Explore's round applies the predicate to the candidates' authors and to the engagers at the
  // round's time, and the page and the chip to the authors at the read's (explorePage, listedInExplore).
  // imports/repo.ts, 3b Task 4 (design, section 8.5): the one statement that creates an import, as media/repo.ts's upload
  // row names it (its import and its use).
  liveNotSuspended: { "imports/repo.ts": 2, "lib/standing.ts": 1, "media/repo.ts": 2, "profiles/store.ts": 3, "social/repo.ts": 6 },
  // social/repo.ts, 3e Task 6: the author's Explore status reads whether the author is suspended (exploreFacts). lib/standing.ts,
  // 3e's review: the closing judgment reads both halves.
  suspendedAt: { "lib/standing.ts": 3, "social/repo.ts": 7 },
  reportsRestrictedAt: { "lib/standing.ts": 2, "social/repo.ts": 2 },
  // 3e's review (database1): the writes that end with the closing judgment: the social repository's (judgeActing), the
  // upload's row, and the intake of a report under a rule. The profile store's badge and the profile's edit end with
  // their UPDATE, made once the row is held.
  // 3b Task 4: and the creation of an import (imports/repo.ts, its import and its use).
  closingJudgment: { "imports/repo.ts": 2, "lib/standing.ts": 1, "media/repo.ts": 2, "moderation/intake.ts": 2, "social/repo.ts": 2 },
};
const STANDING_COLUMNS_ALLOWED = new Set(["lib/standing.ts", "social/repo.ts", "moderation/standing-repo.ts"]);
const STANDING_COLUMNS = ["suspended_from", "suspended_until", "reports_restricted_until", "suspendedFrom", "suspendedUntil", "reportsRestrictedUntil"];
/** Whether a file names one of the derived columns as a whole word, by the same cut as `mentions`. */
const namesStandingColumn = (file: SourceFile): boolean => STANDING_COLUMNS.some((name) => mentions([file], name)[file.path] !== undefined);

function findStandingViolations(files: SourceFile[]): string[] {
  return files.filter((file) => namesStandingColumn(file) && !STANDING_COLUMNS_ALLOWED.has(file.path)).map(({ path }) => `${path}: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may`);
}

describe("the source pins of account sanctions (3e)", () => {
  test("the predicate's fragments are named in exactly the pinned files, each the pinned number of times; the auth module names none", () => {
    for (const [name, pinned] of Object.entries(STANDING_PREDICATE)) expect(mentions(loadSources(), name), name).toEqual(pinned);
    // The auth module names none: no file of it is in any of the pinned lists.
    for (const pinned of Object.values(STANDING_PREDICATE)) expect(Object.keys(pinned).filter((path) => path.startsWith("auth/"))).toEqual([]);
  });

  test("catches a new write that names the predicate, in a pinned file and in one outside the list", () => {
    const real = loadSources();
    const withWrites = real
      .map((file) => (file.path === "media/repo.ts" ? { ...file, source: file.source + String.fromCharCode(10) + 'sql`update post_media set alt = null where ${liveNotSuspended("p", WRITE_CLOCK)}`;' } : file))
      .concat([{ path: "moderation/texts.ts", source: 'await tx.execute(sql`select 1 from profiles p where ${suspendedAt("p", WRITE_CLOCK)}`);' }]);
    expect(mentions(withWrites, "liveNotSuspended")).not.toEqual(STANDING_PREDICATE.liveNotSuspended);
    expect(mentions(withWrites, "liveNotSuspended")).toMatchObject({ "media/repo.ts": 3 });
    expect(mentions(withWrites, "suspendedAt")).toMatchObject({ "moderation/texts.ts": 1 });
    expect(mentions(withWrites, "suspendedAt")).not.toEqual(STANDING_PREDICATE.suspendedAt);
  });

  test("the three derived columns are named only in lib/standing.ts, social/repo.ts and moderation/standing-repo.ts, and lib/standing.ts does name them", () => {
    expect(findStandingViolations(loadSources())).toEqual([]);
    expect(namesStandingColumn(loadSources().find((file) => file.path === "lib/standing.ts")!)).toBe(true);
  });

  test("catches a derived column named elsewhere, in SQL and by drizzle's name", () => {
    const files: SourceFile[] = [
      { path: "lib/standing.ts", source: "sql`(${p}.suspended_from is not null and ${p}.suspended_from <= ${at} and ${at} < ${p}.suspended_until)`" },
      { path: "moderation/standing-repo.ts", source: "sql`select reports_restricted_until from profiles`" },
      { path: "social/flows/posts.ts", source: "const [row] = await db.execute(sql`select suspended_until from profiles where id = ${viewer}::uuid`);" },
      { path: "media/repo.ts", source: "await db.select({ until: profiles.suspendedUntil }).from(profiles);" },
      { path: "auth/flows/badge.ts", source: "if (profile.reportsRestrictedUntil) return;" },
      // A word that only contains the name is not the name.
      { path: "social/views.ts", source: "const unsuspended_from_now = 1;" },
    ];
    expect(findStandingViolations(files)).toEqual([
      "social/flows/posts.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "media/repo.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
      "auth/flows/badge.ts: names a derived column of an account's standing, which only lib/standing.ts, social/repo.ts and moderation/standing-repo.ts may",
    ]);
  });
});

/**
 * The watcher's boundary (3f design, section 5): notify, an entry point of its own (dist/notify.js), imports the contracts,
 * the database package and Node's and its packages' modules, and nothing of the API's: no relative import leaves
 * src/notify. Nothing outside it imports it either: the API holds no mailbox credential, no ntfy token and no route to the
 * push network, and the watcher shares no code with the API that could carry one in.
 */
function findNotifyViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const inside = path.startsWith("notify/");
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (inside && !target.startsWith("notify/")) violations.push(`${path}: imports ${spec}, outside the watcher`);
      if (!inside && target.startsWith("notify/")) violations.push(`${path}: imports ${spec}, inside the watcher`);
    }
  }
  return violations;
}

describe("the watcher's boundary (3f)", () => {
  test("src/notify imports nothing of the API's modules, and nothing imports src/notify", () => {
    const files = loadSources();
    expect(files.filter((file) => file.path.startsWith("notify/")).map((file) => file.path).sort()).toEqual(["notify/imap.ts", "notify/main.ts", "notify/push.ts"]);
    expect(findNotifyViolations(files)).toEqual([]);
  });

  test("catches an import of an API module from the watcher, and an import of the watcher from the API", () => {
    expect(
      findNotifyViolations([
        { path: "notify/main.ts", source: 'import { loadConfig } from "../config"; import { publish } from "./push";' },
        { path: "notify/push.ts", source: 'import { staffAlert } from "../moderation";' },
        { path: "moderation/alerts.ts", source: 'import { TOPICS } from "../notify/push";' },
        { path: "index.ts", source: 'import { ALERT_KINDS } from "@korbat/contracts";' },
      ]),
    ).toEqual(["notify/main.ts: imports ../config, outside the watcher", "notify/push.ts: imports ../moderation, outside the watcher", "moderation/alerts.ts: imports ../notify/push, inside the watcher"]);
  });
});

/**
 * The hand-over's boundary (3f design, section 5 and invariant 16): handover.ts, an entry point of its own
 * (dist/handover.js), imports nothing under ./ (no module of the API, so no database, no configuration and no copy of
 * anything that could reach either) and only Node's own modules, none of which opens a socket or a process; nothing
 * imports it. And no file outside media/ but config.ts and index.ts names the store's directory setting, MEDIA_STORE_DIR:
 * the store is read through the media module, or by the hand-over's program under its fixed mount.
 */
const SOCKET_MODULES = new Set(["node:net", "node:http", "node:https", "node:http2", "node:dgram", "node:tls", "node:child_process", "node:worker_threads", "node:cluster"]);
function findHandoverViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (path === "handover.ts") {
        if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a module of the API`);
        else if (!spec.startsWith("node:")) violations.push(`${path}: imports ${spec}, which is not one of Node's own modules`);
        else if (SOCKET_MODULES.has(spec)) violations.push(`${path}: imports ${spec}, which can open a socket or a process`);
      } else if (spec.startsWith(".") && posix.normalize(posix.join(posix.dirname(path), spec)).replace(/[.]ts$/, "") === "handover") {
        violations.push(`${path}: imports ${spec}, the hand-over's program`);
      }
    }
    if (/MEDIA_STORE_DIR/.test(source) && !path.startsWith("media/") && path !== "config.ts" && path !== "index.ts") {
      violations.push(`${path}: names MEDIA_STORE_DIR, which only the media module, config.ts and index.ts may`);
    }
  }
  return violations;
}

describe("the hand-over's boundary (3f Task 5)", () => {
  test("handover.ts imports only Node's own modules and none that opens a socket, nothing imports it, and no file outside media/ but config.ts and index.ts names the store's directory setting", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("handover.ts");
    expect(findHandoverViolations(files)).toEqual([]);
  });

  test("catches an import of an API module or a package from the hand-over, a socket's module, an import of the hand-over, and the store's setting named elsewhere", () => {
    expect(
      findHandoverViolations([
        { path: "handover.ts", source: 'import { storedImageName } from "./media"; import { sql } from "drizzle-orm"; import { connect } from "node:net"; import { crc32 } from "node:zlib";' },
        { path: "cli/records.ts", source: 'import { zipStored } from "../handover";' },
        { path: "cli/staff.ts", source: "const dir = env.MEDIA_STORE_DIR;" },
        { path: "media/files.ts", source: "const dir = config.MEDIA_STORE_DIR;" },
      ]),
    ).toEqual([
      "handover.ts: imports ./media, a module of the API",
      "handover.ts: imports drizzle-orm, which is not one of Node's own modules",
      "handover.ts: imports node:net, which can open a socket or a process",
      "cli/records.ts: imports ../handover, the hand-over's program",
      "cli/staff.ts: names MEDIA_STORE_DIR, which only the media module, config.ts and index.ts may",
    ]);
  });
});

/**
 * The quarantine's mover (3d design, section 5 "The services"; 12.1 rows 13 and 14): quarantine.ts, an entry point of its
 * own (dist/quarantine.js), is as bare as the hand-over: it imports nothing under ./ and only Node's own modules, none
 * that opens a socket or a process, and nothing imports it.
 */
function findQuarantineViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const spec of specifiers(source)) {
      if (path === "quarantine.ts") {
        if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a module of the API`);
        else if (!spec.startsWith("node:")) violations.push(`${path}: imports ${spec}, which is not one of Node's own modules`);
        else if (SOCKET_MODULES.has(spec)) violations.push(`${path}: imports ${spec}, which can open a socket or a process`);
      } else if (spec.startsWith(".") && posix.normalize(posix.join(posix.dirname(path), spec)).replace(/[.]ts$/, "") === "quarantine") {
        violations.push(`${path}: imports ${spec}, the quarantine's mover`);
      }
    }
  }
  return violations;
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LF = String.fromCharCode(10);

/** The service blocks of a Compose file's services section, by name, as text: from a service's name to the next one's. */
function composeServices(text: string): Map<string, string> {
  const head = `${LF}services:${LF}`;
  const section = text.slice(text.indexOf(head) + head.length - 1);
  // The section ends at the next top-level key.
  const end = section.slice(1).search(new RegExp(`${LF}[a-z][a-z0-9_-]*:`));
  const body = end === -1 ? section : section.slice(0, end + 1);
  const blocks = new Map<string, string>();
  const names = [...body.matchAll(new RegExp(`${LF} {2}([a-z][a-z0-9_-]*):${LF}`, "g"))];
  names.forEach((match, i) => blocks.set(match[1]!, body.slice(match.index!, names[i + 1]?.index ?? body.length)));
  return blocks;
}

/**
 * Who mounts the quarantine (3d design, section 5; 12.1 row 14): in compose.yml only `quarantine`, read-write, and
 * `handover`, read-only, name the volume media-quarantine, and compose.dev.yml names it nowhere, so neither the api, the
 * migrate nor the worker service mounts it. The mover has no network, no environment, every capability dropped, a
 * read-only root and the two volumes alone; the worker keeps network_mode: none.
 */
function findComposeViolations(compose: string, dev: string): string[] {
  const violations: string[] = [];
  const services = composeServices(compose);
  for (const [name, block] of services) {
    const mounts = block.split(LF).filter((line) => line.includes("media-quarantine"));
    if (mounts.length === 0) continue;
    const expected = name === "quarantine" ? "- media-quarantine:/media/quarantine" : name === "handover" ? "- media-quarantine:/media/quarantine:ro" : null;
    if (expected === null) violations.push(`compose.yml: ${name} names media-quarantine`);
    else if (mounts.map((line) => line.trim()).join("|") !== expected) violations.push(`compose.yml: ${name} mounts media-quarantine otherwise than ${expected}`);
  }
  for (const [name, block] of composeServices(dev)) {
    if (block.includes("media-quarantine")) violations.push(`compose.dev.yml: ${name} names media-quarantine`);
  }
  const mover = services.get("quarantine");
  if (!mover) violations.push("compose.yml: no service quarantine");
  else {
    for (const line of ["network_mode: none", "read_only: true", "cap_drop: [ALL]", '"no-new-privileges:true"', 'profiles: ["quarantine"]', 'entrypoint: ["node", "dist/quarantine.js", "/media/store", "/media/quarantine"]']) {
      if (!mover.includes(line)) violations.push(`compose.yml: quarantine lacks ${line}`);
    }
    for (const key of ["environment:", "env_file:", "networks:", "ports:", "secrets:"]) {
      if (mover.includes(key)) violations.push(`compose.yml: quarantine has ${key}`);
    }
    const volumes = mover
      .split(LF)
      .filter((line) => /^ {6}- /.test(line))
      .map((line) => line.trim());
    if (volumes.join("|") !== "- media-store:/media/store|- media-quarantine:/media/quarantine") violations.push(`compose.yml: quarantine mounts ${volumes.join(", ")}`);
  }
  if (!services.get("worker")?.includes("network_mode: none")) violations.push("compose.yml: worker has a network");
  violations.push(...findImporterViolations(services, composeServices(dev)));
  return violations;
}

/** A service's lines that are not comments: what Compose reads of it. */
const serviceLines = (block: string): string[] => block.split(LF).filter((line) => !line.trim().startsWith("#"));
/** The lines of a service that name one of the two import volumes. */
const importMounts = (block: string): string[] => serviceLines(block).filter((line) => line.includes("import-archives") || line.includes("import-work")).map((line) => line.trim());

/**
 * 3b (design, section 7.1; decision 1): the importer parses archives people upload, hostile input. Like the worker it has
 * no network and no capability; it reads import-archives read-only and writes import-work, and the API mounts the two
 * the other way round. No other service names either volume, and the development file names neither.
 */
function findImporterViolations(services: Map<string, string>, dev: Map<string, string>): string[] {
  const violations: string[] = [];
  const expected: Record<string, string> = {
    importer: "- import-archives:/import/archives:ro|- import-work:/import/work",
    api: "- import-archives:/import/archives|- import-work:/import/work:ro",
  };
  for (const [name, block] of services) {
    const mounts = importMounts(block);
    if (mounts.length === 0 && expected[name] === undefined) continue;
    if (expected[name] === undefined) violations.push(`compose.yml: ${name} names an import volume`);
    else if (mounts.join("|") !== expected[name]) violations.push(`compose.yml: ${name} mounts the import volumes otherwise than ${expected[name]}`);
  }
  for (const [name, block] of dev) {
    if (importMounts(block).length > 0) violations.push(`compose.dev.yml: ${name} names an import volume`);
  }
  const importer = services.get("importer");
  if (!importer) return [...violations, "compose.yml: no service importer"];
  const lines = serviceLines(importer).map((line) => line.trim());
  for (const line of ["network_mode: none", "cap_drop: [ALL]"]) if (!lines.includes(line)) violations.push(`compose.yml: importer lacks ${line}`);
  for (const key of ["networks:", "ports:", "env_file:", "secrets:"]) if (lines.some((line) => line.startsWith(key))) violations.push(`compose.yml: importer has ${key}`);
  return violations;
}

describe("the quarantine's boundary (3d Task 1)", () => {
  test("quarantine.ts imports only Node's own modules and none that opens a socket, and nothing imports it", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("quarantine.ts");
    expect(findQuarantineViolations(files)).toEqual([]);
  });

  test("catches an import of an API module or a package from the mover, a socket's module, and an import of the mover", () => {
    expect(
      findQuarantineViolations([
        { path: "quarantine.ts", source: 'import { storedImageName } from "./media"; import { z } from "zod"; import { request } from "node:https"; import { open } from "node:fs/promises";' },
        { path: "cli/custody.ts", source: 'import { runQuarantine } from "../quarantine";' },
      ]),
    ).toEqual([
      "quarantine.ts: imports ./media, a module of the API",
      "quarantine.ts: imports zod, which is not one of Node's own modules",
      "quarantine.ts: imports node:https, which can open a socket or a process",
      "cli/custody.ts: imports ../quarantine, the quarantine's mover",
    ]);
  });

  test("only quarantine (read-write) and handover (read-only) mount media-quarantine; the mover is bare and the worker keeps no network", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    expect([...composeServices(compose).keys()]).toEqual(expect.arrayContaining(["api", "migrate", "worker", "importer", "handover", "quarantine"]));
    expect(findComposeViolations(compose, dev)).toEqual([]);
  });

  test("catches the volume in the api or the development file, a writable hand-over and a mover with an environment", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    const broken = compose
      .replace(`      - media-store:/media/store:ro${LF}      - media-quarantine:/media/quarantine:ro`, `      - media-store:/media/store:ro${LF}      - media-quarantine:/media/quarantine`)
      .replace(`      - media-uploads:/media/uploads${LF}`, `      - media-uploads:/media/uploads${LF}      - media-quarantine:/media/quarantine:ro${LF}`)
      .replace(`    profiles: ["quarantine"]${LF}`, `    profiles: ["quarantine"]${LF}    environment:${LF}      X: "1"${LF}`);
    const devBroken = dev.replace(`  api:${LF}`, `  api:${LF}    volumes: [media-quarantine:/media/quarantine]${LF}`);
    expect(findComposeViolations(broken, devBroken)).toEqual([
      "compose.yml: api names media-quarantine",
      "compose.yml: handover mounts media-quarantine otherwise than - media-quarantine:/media/quarantine:ro",
      "compose.dev.yml: api names media-quarantine",
      "compose.yml: quarantine has environment:",
    ]);
  });

  test("3b: catches an importer with a network or a writable archive volume, an import volume in another service or in the development file", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const dev = readFileSync(join(REPO_ROOT, "infra", "compose.dev.yml"), "utf8");
    const broken = compose
      .replace(`      - import-archives:/import/archives:ro${LF}`, `      - import-archives:/import/archives${LF}`)
      .replace(`      dockerfile: apps/importer/Dockerfile${LF}    network_mode: none${LF}`, `      dockerfile: apps/importer/Dockerfile${LF}    networks: [app]${LF}`)
      .replace(`      - media-uploads:/media/uploads:ro${LF}      - media-store:/media/store${LF}`, `      - media-uploads:/media/uploads:ro${LF}      - media-store:/media/store${LF}      - import-work:/import/work:ro${LF}`);
    const devBroken = dev.replace(`  api:${LF}`, `  api:${LF}    volumes: [import-archives:/import/archives]${LF}`);
    expect(findComposeViolations(broken, devBroken)).toEqual([
      "compose.yml: worker names an import volume",
      "compose.yml: importer mounts the import volumes otherwise than - import-archives:/import/archives:ro|- import-work:/import/work",
      "compose.dev.yml: api names an import volume",
      "compose.yml: importer lacks network_mode: none",
      "compose.yml: importer has networks:",
    ]);
    expect(findComposeViolations(compose.replace(`${LF}  importer:${LF}`, `${LF}  importer2:${LF}`), dev)).toEqual(["compose.yml: importer2 names an import volume", "compose.yml: no service importer"]);
  });
});

/**
 * The adapters' files (3d design, section 5 "The adapters"): each adapter is a file of its own that imports nothing of its
 * module, so it is given what its interface names and nothing more: no media file, no repository and no database. Task
 * 3 builds the first, the edge's purge (media/edge-adapter.ts), and Task 5 the head's witness (transparency/witness.ts);
 * the matcher's (media/match-adapter.ts) joins this list with the task that builds it. A package import that is no
 * database stays allowed: the adapter reads its numbers from the contracts.
 */
const ADAPTER_FILES = ["media/edge-adapter.ts", "transparency/witness.ts", "media/match-adapter.ts"];
function findAdapterViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!ADAPTER_FILES.includes(path)) continue;
    for (const spec of specifiers(source)) {
      if (spec.startsWith(".")) violations.push(`${path}: imports ${spec}, a file of the API`);
      else if (spec.startsWith("@korbat/db")) violations.push(`${path}: imports ${spec}, the database`);
    }
  }
  return violations;
}

describe("the adapters' files (3d Task 3)", () => {
  test("each adapter's file exists and imports nothing of its module, no repository and no database", () => {
    const files = loadSources();
    for (const path of ADAPTER_FILES) expect(files.map((file) => file.path), path).toContain(path);
    expect(findAdapterViolations(files)).toEqual([]);
  });

  test("catches an adapter that imports the media repository, a module's file, its index or the database", () => {
    expect(
      findAdapterViolations([
        { path: "media/edge-adapter.ts", source: 'import { createMediaRepo } from "./repo"; import type { MediaDeps } from "./context"; import { postMedia } from "@korbat/db"; import { EDGE_RULES } from "@korbat/contracts";' },
        { path: "media/edge.ts", source: 'import { createMediaRepo } from "./repo";' },
      ]),
    ).toEqual(["media/edge-adapter.ts: imports ./repo, a file of the API", "media/edge-adapter.ts: imports ./context, a file of the API", "media/edge-adapter.ts: imports @korbat/db, the database"]);
    expect(findAdapterViolations([{ path: "media/edge-adapter.ts", source: 'import { media } from "../media";' }])).toEqual(["media/edge-adapter.ts: imports ../media, a file of the API"]);
    // Task 5: the witness's file imports nothing of the transparency module, no repository and no database.
    expect(
      findAdapterViolations([
        { path: "transparency/witness.ts", source: 'import { createTransparencyRepo } from "./repo"; import { headPublications } from "@korbat/db"; import { HEAD_RULES } from "@korbat/contracts";' },
        { path: "transparency/head.ts", source: 'import { createTransparencyRepo } from "./repo";' },
      ]),
    ).toEqual(["transparency/witness.ts: imports ./repo, a file of the API", "transparency/witness.ts: imports @korbat/db, the database"]);
    // Task 7: the matcher's file imports nothing of the media module, no repository and no database: it is given hashes.
    expect(
      findAdapterViolations([
        { path: "media/match-adapter.ts", source: 'import { createMatchRepo } from "./match-repo"; import { mediaHashes } from "@korbat/db"; import { MATCH_FIXTURES } from "@korbat/media-protocol";' },
        { path: "media/match.ts", source: 'import { createMatchRepo } from "./match-repo";' },
      ]),
    ).toEqual(["media/match-adapter.ts: imports ./match-repo, a file of the API", "media/match-adapter.ts: imports @korbat/db, the database"]);
  });
});

describe("the known material's tables (3d Task 7)", () => {
  test("only the media module names media_hashes, media_matches or upload_refusals, by table or by schema name", () => {
    const files: SourceFile[] = [
      { path: "moderation/uploads.ts", source: "await tx.execute(sql`select 1 from public.upload_refusals`);" },
      { path: "moderation/automated-repo.ts", source: 'import { mediaMatches } from "@korbat/db"; const q = "media_matches";' },
      { path: "cli/automation.ts", source: "sql`select count(*) from public.media_hashes`" },
      { path: "media/match-repo.ts", source: "sql`select 1 from public.media_hashes join public.media_matches on true join public.upload_refusals on true`" },
      // A column of releases and a step-up's target type are no table's name.
      { path: "moderation/release.ts", source: "sql`select r.upload_refusal_id from public.releases r`; const target = 'upload_refusal';" },
    ];
    expect(findViolations(files, new Set(["mediaMatches"]), new Set())).toEqual([
      "moderation/uploads.ts: references upload_refusals, which only the media module may touch",
      "moderation/automated-repo.ts: references mediaMatches, which only the media module may touch",
      "moderation/automated-repo.ts: references media_matches, which only the media module may touch",
      "cli/automation.ts: references media_hashes, which only the media module may touch",
    ]);
  });
});

/**
 * The transparency module (3d design, section 5, "The architecture test"; Task 4): it reads no session and no table of a
 * person, so a file under transparency/ imports from @korbat/db no schema name but those of schema/transparency.ts (Task 5
 * adds head_publications there) and the audit head, and no namespace of it. Db and DbTx, which are no schema names, stay
 * allowed.
 */
const TRANSPARENCY_SCHEMA_FILE = "transparency.ts";
const TRANSPARENCY_EXTRA_NAMES = new Set(["auditHead"]);

function findTransparencyViolations(files: SourceFile[], schemaNames: Set<string>, allowed: Set<string>): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!path.startsWith("transparency/")) continue;
    for (const name of dbImports(source)) {
      if (name === "*") violations.push(`${path}: namespace import of @korbat/db (the transparency module names its own tables only)`);
      else if (schemaNames.has(name) && !allowed.has(name)) violations.push(`${path}: imports ${name} from @korbat/db, which is no table of the public figures`);
    }
  }
  return violations;
}

describe("the transparency module's tables (3d Task 4)", () => {
  const schemaNames = () => new Set([...publicSchemaNames(), ...authSchemaNames()]);
  const allowed = () => new Set([...exportedNames(TRANSPARENCY_SCHEMA_FILE), ...TRANSPARENCY_EXTRA_NAMES]);

  test("the module exists, and its files name no table of @korbat/db but the public figures' three and the audit head", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("transparency/index.ts");
    expect([...allowed()].sort()).toEqual(["auditHead", "headPublications", "recipientMonths", "transparencyEditions"]);
    expect(findTransparencyViolations(files, schemaNames(), allowed())).toEqual([]);
  });

  test("catches a table of a person, an auth table and a namespace import, and allows its own tables, the head and the pool's types", () => {
    const files: SourceFile[] = [
      { path: "transparency/repo.ts", source: `import { transparencyEditions, recipientMonths, auditHead, decisions, type Db, type DbTx } from "@korbat/db";` },
      { path: "transparency/editions.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "transparency/recipients.ts", source: `import * as db from "@korbat/db";` },
      { path: "transparency/routes.ts", source: `import { profiles as p } from "@korbat/db";` },
      { path: "moderation/repo.ts", source: `import { decisions } from "@korbat/db";` },
    ];
    expect(findTransparencyViolations(files, new Set(["transparencyEditions", "recipientMonths", "auditHead", "decisions", "sessions", "profiles"]), new Set(["transparencyEditions", "recipientMonths", "auditHead"]))).toEqual([
      "transparency/repo.ts: imports decisions from @korbat/db, which is no table of the public figures",
      "transparency/editions.ts: imports sessions from @korbat/db, which is no table of the public figures",
      "transparency/recipients.ts: namespace import of @korbat/db (the transparency module names its own tables only)",
      "transparency/routes.ts: imports profiles from @korbat/db, which is no table of the public figures",
    ]);
  });

  test("catches a deep import into the transparency module, from the app, the auth module and the command line", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import type { Transparency } from "./transparency";
import { transparencyRoutes } from "./transparency/routes";` },
      { path: "auth/middleware.ts", source: `import type { TransparencyForAuth } from "../transparency";
import { createRecipientCounter } from "../transparency/recipients";` },
      { path: "cli/figures.ts", source: `import { createTransparencyRepo } from "../transparency/repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./transparency/routes, which is inside the transparency module (use ./transparency)",
      "auth/middleware.ts: imports ../transparency/recipients, which is inside the transparency module (use ./transparency)",
      "cli/figures.ts: imports ../transparency/repo, which is inside the transparency module (use ./transparency)",
    ]);
  });
});

/**
 * 2d's tables (design, sections 5.3, 5.4 and 12.2; Task 2). One table of pins: the files that may name each table of the
 * migration activity, in SQL or by drizzle's name, as a whole word, comments included. Entries are written only by the
 * social repository, in the act's transaction (createPost, follow), and deleted there (deletePost, block, the purge); the
 * activity module reads them, keeps the seen marker and the rules, and runs the retention; the mentions are the social
 * module's alone, read by its repository for the views. As an assertion of its own, the one insert into post_mentions is
 * in createPost, so a mention is added only with its post. And the staff and moderation modules never import the activity
 * module or name its tables: no staff route reads Activity, and moderation entries are never written, only read.
 */
const ACTIVITY_TABLE_PINS: { table: string; names: string[]; allowed: (path: string) => boolean }[] = [
  { table: "activity_items", names: ["activity_items", "activityItems"], allowed: (path) => path === "social/repo.ts" || insideActivity(path) },
  { table: "activity_state", names: ["activity_state", "activityState"], allowed: (path) => path === "social/repo.ts" || insideActivity(path) },
  { table: "post_mentions", names: ["post_mentions", "postMentions"], allowed: (path) => path === "social/repo.ts" || path === "social/views.ts" },
];
const MENTION_INSERT = /\binsert\s+into\s+(?:"?public"?\s*\.\s*)?"?post_mentions\b|\.insert\(\s*postMentions\b/gi;

function findActivityTableViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const pin of ACTIVITY_TABLE_PINS) {
      const named = pin.names.filter((name) => mentions([file], name)[file.path] !== undefined);
      if (named.length > 0 && !pin.allowed(file.path)) violations.push(`${file.path}: names ${named.join(" and ")}, which only ${pin.table}'s pinned files may`);
    }
    if ((insideStaff(file.path) || insideModeration(file.path)) && specifiers(file.source).some((spec) => spec.startsWith(".") && /^activity(\/|$)/.test(posix.normalize(posix.join(posix.dirname(file.path), spec))))) {
      violations.push(`${file.path}: imports the activity module, which no staff or moderation file may`);
    }
  }
  return violations;
}

/** Where post_mentions is inserted into: each file, the number of inserts, and for social/repo.ts the method each is in. */
function mentionInserts(files: SourceFile[]): { path: string; count: number; inCreatePost: number }[] {
  return files.flatMap((file) => {
    const count = [...file.source.matchAll(MENTION_INSERT)].length;
    if (count === 0) return [];
    const start = file.source.indexOf("async createPost(");
    const end = start < 0 ? -1 : file.source.indexOf("async deletePost(", start);
    const inCreatePost = start < 0 || end < 0 ? 0 : [...file.source.slice(start, end).matchAll(MENTION_INSERT)].length;
    return [{ path: file.path, count, inCreatePost }];
  });
}

describe("2d's tables (5.3)", () => {
  test("each of activity_items, activity_state and post_mentions is named only in its pinned files, and the staff and moderation modules never import the activity module", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toContain("activity/index.ts");
    expect(findActivityTableViolations(files)).toEqual([]);
    // The pins are about files that do name the tables.
    const named = (path: string, name: string) => mentions(files.filter((file) => file.path === path), name)[path] !== undefined;
    expect(named("social/repo.ts", "activity_items") && named("social/repo.ts", "activity_state") && named("social/repo.ts", "post_mentions")).toBe(true);
    expect(named("activity/repo.ts", "activity_items") && named("activity/repo.ts", "activity_state")).toBe(true);
  });

  test("the one insert into post_mentions is in social/repo.ts, inside createPost", () => {
    expect(mentionInserts(loadSources())).toEqual([{ path: "social/repo.ts", count: 1, inCreatePost: 1 }]);
  });

  test("catches a table named outside its files, by SQL or drizzle's name, a second insert of mentions, and the activity module imported by staff or moderation", () => {
    const files: SourceFile[] = [
      { path: "moderation/author.ts", source: "await q.execute(sql`select count(*) from activity_items where recipient_id = ${id}::uuid`);" },
      { path: "staff/cases.ts", source: 'import { activityState } from "@korbat/db";\nimport { createActivity } from "../activity";' },
      { path: "media/repo.ts", source: "await tx.execute(sql`delete from post_mentions where post_id = ${id}::uuid`);" },
      { path: "activity/repo.ts", source: "sql`select handle from post_mentions`" },
      { path: "moderation/release.ts", source: 'import type { ActivityForAccount } from "../activity/index";' },
      // Allowed: the social repository and the activity module, and a word that only contains a table's name.
      { path: "social/repo.ts", source: "sql`insert into activity_items (recipient_id) select 1`; sql`delete from activity_state`; sql`insert into post_mentions values (1)`;" },
      { path: "activity/flows.ts", source: "sql`select seen_at from activity_state`; const activity_items_insert = 1;" },
      { path: "account/flows/export.ts", source: 'import type { ActivityExport } from "../../activity";' },
    ];
    expect(findActivityTableViolations(files)).toEqual([
      "moderation/author.ts: names activity_items, which only activity_items's pinned files may",
      "staff/cases.ts: names activityState, which only activity_state's pinned files may",
      "staff/cases.ts: imports the activity module, which no staff or moderation file may",
      "media/repo.ts: names post_mentions, which only post_mentions's pinned files may",
      "activity/repo.ts: names post_mentions, which only post_mentions's pinned files may",
      "moderation/release.ts: imports the activity module, which no staff or moderation file may",
    ]);
    const twice: SourceFile[] = [
      { path: "social/repo.ts", source: "async createPost() { sql`insert into post_mentions (post_id) values (1)` } async deletePost() {} async publishImportedBatch() { sql`INSERT INTO public.post_mentions select 1` }" },
      { path: "social/views.ts", source: "await tx.insert(postMentions).values(rows);" },
    ];
    expect(mentionInserts(twice)).toEqual([
      { path: "social/repo.ts", count: 2, inCreatePost: 1 },
      { path: "social/views.ts", count: 1, inCreatePost: 0 },
    ]);
  });

  test("catches a deep import into the activity module and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createActivityRepo } from "./activity/repo";\nimport { createActivity } from "./activity";` },
      { path: "account/flows/export.ts", source: `import type { ReceivedEntry } from "../../activity/flows";` },
      { path: "activity/repo.ts", source: `import { users, type Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(), new Set(["users"]))).toEqual([
      "app.ts: imports ./activity/repo, which is inside the activity module (use ./activity)",
      "account/flows/export.ts: imports ../../activity/flows, which is inside the activity module (use ./activity)",
      "activity/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });
});

describe("module boundaries", () => {
  test("walks the real source tree", () => {
    const paths = loadSources().map((f) => f.path);
    expect(paths).toContain("auth/index.ts");
    expect(paths).toContain("social/index.ts");
    expect(paths).toContain("media/index.ts");
    expect(paths).toContain("account/index.ts");
    expect(paths).toContain("staff/index.ts");
    expect(paths).toContain("moderation/index.ts");
    expect(paths).toContain("transparency/index.ts");
    expect(paths).toContain("cli/staff.ts");
    expect(paths).toContain("app.ts");
    expect(publicSchemaNames()).toContain("profiles");
    expect(publicSchemaNames()).not.toContain("users");
    expect(authSchemaNames()).toContain("users");
    expect(authSchemaNames()).not.toContain("posts");
  });

  test("apps/api/src has no boundary violations", () => {
    expect(findViolations(loadSources(), publicSchemaNames(), authSchemaNames())).toEqual([]);
  });

  test("allows the module indexes, the permitted pool owners and each module's own schema", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createAuth } from "./auth";\nimport type { Auth } from "./auth/index";\nimport { createSocial } from "./social";` },
      { path: "profiles/store.ts", source: `import { isUniqueViolation } from "../auth";` },
      { path: "cli/grant-role.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "index.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "config.ts", source: `AUTH_HMAC_KEY: base64Key, IP_HASH_KEY: base64Key, TOTP_ENC_KEY: versionedKey, DATABASE_URL_AUTH: url` },
      { path: "auth/repo.ts", source: `import { users, sessions, type Db } from "@korbat/db";\nconst k = config.TOTP_ENC_KEY;` },
      { path: "social/repo.ts", source: `import { posts, profiles, type Db } from "@korbat/db";\nimport { SocialError } from "./context";` },
      { path: "social/routes.ts", source: `import type { Auth } from "../auth";` },
      { path: "index.ts", source: `import { createAccount } from "./account";\nimport { createMedia } from "./media";` },
      { path: "account/routes.ts", source: `import type { AuthForAccount } from "../auth";\nimport type { SocialForAccount } from "../social";\nimport { buildExport } from "./flows/export";` },
      { path: "account/flows/deletion.ts", source: `import type { DbTx } from "@korbat/db";\nimport type { MediaForAccount } from "../../media";` },
      { path: "cli/staff.ts", source: `import { createStaff } from "../staff";\nconst authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `import { auditHead, auditLog, profiles, type Db, type DbTx } from "@korbat/db";` },
      { path: "staff/routes.ts", source: `import { AuthError, type Auth } from "../auth";\nimport { staffGate } from "./gate";` },
      { path: "staff/cases.ts", source: `import { ModerationError, type ModerationForStaff } from "../moderation";` },
      { path: "index.ts", source: `import { createModeration } from "./moderation";\nimport { socialForModeration } from "./social";` },
      { path: "moderation/repo.ts", source: `import { cases, decisions, evidenceSnapshots, intakes, type Db, type DbTx } from "@korbat/db";\nimport { ModerationError } from "./context";` },
      { path: "moderation/decide.ts", source: `import type { ActiveStaffSession, StaffStepUpConfirmed } from "../auth";\nimport { boundLockWaits } from "../lib/lock-bounds";\nimport type { SocialForModeration } from "../social";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts", "auditLog", "auditHead", "cases", "decisions", "evidenceSnapshots", "intakes"]), new Set(["users", "sessions"]))).toEqual([]);
  });

  test("catches a deep import into the auth module", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `import { hashPassword } from "../auth/passwords";` },
      { path: "app.ts", source: `export { createSessions } from "./auth/sessions.ts";\nconst m = await import("./auth/repo");` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: imports ../auth/passwords, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/sessions.ts, which is inside the auth module (use ./auth)",
      "app.ts: imports ./auth/repo, which is inside the auth module (use ./auth)",
    ]);
  });

  test("catches a deep import into the social module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createSocialRepo } from "./social/repo";` },
      { path: "auth/flows/signup.ts", source: `import { createPost } from "../../social/flows/posts";` },
      { path: "social/flows/graph.ts", source: `import { ownProfile } from "./posts";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./social/repo, which is inside the social module (use ./social)",
      "auth/flows/signup.ts: imports ../../social/flows/posts, which is inside the social module (use ./social)",
    ]);
  });

  test("catches a deep import into the media module, post_media outside it, and the auth schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createMediaRepo } from "./media/repo";\nimport { createMedia } from "./media";` },
      { path: "social/repo.ts", source: `import { postMedia, posts } from "@korbat/db";` },
      { path: "social/views.ts", source: "const rows = await db.execute(sql`select * from post_media`);" },
      { path: "media/repo.ts", source: `import { postMedia, posts, users, type Db } from "@korbat/db";` },
      { path: "media/flows/serve.ts", source: `import type { MediaDeps } from "../context";` },
    ];
    expect(findViolations(files, new Set(["posts", "postMedia"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./media/repo, which is inside the media module (use ./media)",
      "social/repo.ts: references post_media, which only the media module may touch",
      "social/views.ts: references post_media, which only the media module may touch",
      "media/repo.ts: imports auth-schema users from @korbat/db",
    ]);
  });

  test("catches a deep import into the account module, and a table or enum of either schema inside it", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { createZipWriter } from "./account/zip";\nimport { createAccount } from "./account";` },
      { path: "social/flows/graph.ts", source: `import { buildExport } from "../../account/flows/export";` },
      { path: "account/flows/export.ts", source: `import { posts, users, type DbTx } from "@korbat/db";` },
      { path: "account/purge.ts", source: `import * as db from "@korbat/db";` },
      { path: "account/zip.ts", source: `import type { Db } from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users"]))).toEqual([
      "app.ts: imports ./account/zip, which is inside the account module (use ./account)",
      "social/flows/graph.ts: imports ../../account/flows/export, which is inside the account module (use ./account)",
      "account/flows/export.ts: imports public-schema posts from @korbat/db (the account module holds no table access)",
      "account/flows/export.ts: imports auth-schema users from @korbat/db (the account module holds no table access)",
      "account/purge.ts: namespace import of @korbat/db (the account module holds no table access)",
    ]);
  });

  test("catches auth pool and auth key references outside their owners", () => {
    const files: SourceFile[] = [
      { path: "routes/posts.ts", source: `const url = config.DATABASE_URL_AUTH;` },
      { path: "profiles/store.ts", source: `export function f(authDb: Db) {}` },
      { path: "lib/hash.ts", source: `const key = config.IP_HASH_KEY;` },
      { path: "index.ts", source: `const k = config.AUTH_HMAC_KEY;` },
      // The key a notifier's name and address are encrypted under is the auth module's too: the moderation module, which
      // names contacts by their ids, never sees it.
      { path: "moderation/intake.ts", source: `const key = deps.config.NOTIFIER_ENC_KEY;` },
      // The keys a key replaced are guarded as the key is: a contact is never encrypted again, so after a rotation they are
      // the only keys of every contact stored before it. The TOTP key's earlier keys likewise.
      { path: "moderation/context.ts", source: `const older = config.NOTIFIER_ENC_KEYS_PREVIOUS;` },
      { path: "staff/routes.ts", source: `const older = config.TOTP_ENC_KEYS_PREVIOUS;` },
      // A longer name that only contains a key's name is not the key; config.ts and the auth module may name every key.
      { path: "lib/names.ts", source: `const MY_NOTIFIER_ENC_KEY_NAME = 1; const NOTIFIER_ENC_KEYS = 2; const TOTP_ENC_KEYS_PREVIOUSLY = 3;` },
      { path: "config.ts", source: `NOTIFIER_ENC_KEY: versionedKey, NOTIFIER_ENC_KEYS_PREVIOUS: z.string(), TOTP_ENC_KEYS_PREVIOUS: z.string(),` },
      { path: "auth/context.ts", source: `notifierKey: parseVersionedKey(config.NOTIFIER_ENC_KEY), notifierPreviousKeys: config.NOTIFIER_ENC_KEYS_PREVIOUS.map(parseVersionedKey),` },
      // The staff command line may open the auth pool; another command line, or the staff module itself, may not.
      { path: "cli/other.ts", source: `const authDb = createDb(config.DATABASE_URL_AUTH);` },
      { path: "staff/audit.ts", source: `export function readKeys(authDb: Db) {}` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "routes/posts.ts: references the auth database pool",
      "profiles/store.ts: references the auth database pool",
      "lib/hash.ts: references an auth key",
      "index.ts: references an auth key",
      "moderation/intake.ts: references an auth key",
      "moderation/context.ts: references an auth key",
      "staff/routes.ts: references an auth key",
      "cli/other.ts: references the auth database pool",
      "staff/audit.ts: references the auth database pool",
    ]);
  });

  test("catches a deep import into the staff module, from outside it and from the auth module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { staffGate } from "./staff/gate";\nimport { createStaff } from "./staff";` },
      { path: "cli/staff.ts", source: `import { canonicalText } from "../staff/chain";` },
      { path: "auth/staff/flows.ts", source: `import { appendAuditRow } from "../../staff/audit";` },
      { path: "staff/routes.ts", source: `import { staffGate } from "./gate";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./staff/gate, which is inside the staff module (use ./staff)",
      "cli/staff.ts: imports ../staff/chain, which is inside the staff module (use ./staff)",
      "auth/staff/flows.ts: imports ../../staff/audit, which is inside the staff module (use ./staff)",
    ]);
  });

  test("catches auth-schema imports inside the staff module", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { auditLog, staffKeys, type Db } from "@korbat/db";` },
      { path: "staff/reader.ts", source: `import type { staffSessions as s } from "@korbat/db";` },
      { path: "staff/writer.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["auditLog"]), new Set(["staffKeys", "staffSessions"]))).toEqual([
      "staff/audit.ts: imports auth-schema staffKeys from @korbat/db",
      "staff/reader.ts: imports auth-schema staffSessions from @korbat/db",
      "staff/writer.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });

  test("catches the auth module's repository or session store inside the staff module, however it is imported", () => {
    const files: SourceFile[] = [
      { path: "staff/audit.ts", source: `import { AuthError, createAuthRepo } from "../auth";` },
      { path: "staff/routes.ts", source: `import { createSessions as sessionsOf } from "../auth";` },
      { path: "staff/flows/x.ts", source: `import * as auth from "../../auth";\nconst repo = auth.createAuthRepo(db);\nconst s = auth.createSessions(deps);` },
      { path: "staff/flows/y.ts", source: `const { createSessions } = await import("../../auth");` },
      // Outside the staff module the rule does not apply: the command lines build the auth module's parts themselves.
      { path: "cli/grant-role.ts", source: `import { createAuthRepo, createSessions } from "../auth";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "staff/audit.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/routes.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createAuthRepo (the staff module goes through the auth module's interface)",
      "staff/flows/x.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
      "staff/flows/y.ts: uses the auth module's createSessions (the staff module goes through the auth module's interface)",
    ]);
  });

  test("catches a deep import into the moderation module, from outside it and from another module", () => {
    const files: SourceFile[] = [
      { path: "app.ts", source: `import { decide } from "./moderation/decide";\nimport { createModeration } from "./moderation";` },
      { path: "staff/cases.ts", source: `import { ModerationError } from "../moderation/context";` },
      { path: "social/views.ts", source: `import { authorFacts } from "../moderation/repo";` },
      { path: "cli/staff.ts", source: `const { recordIntake } = await import("../moderation/intake");` },
      { path: "moderation/decide.ts", source: `import { ModerationError } from "./context";\nimport { insertDecision } from "./repo";` },
    ];
    expect(findViolations(files, new Set(), new Set())).toEqual([
      "app.ts: imports ./moderation/decide, which is inside the moderation module (use ./moderation)",
      "staff/cases.ts: imports ../moderation/context, which is inside the moderation module (use ./moderation)",
      "social/views.ts: imports ../moderation/repo, which is inside the moderation module (use ./moderation)",
      "cli/staff.ts: imports ../moderation/intake, which is inside the moderation module (use ./moderation)",
    ]);
  });

  test("catches the moderation module reaching into another module, naming post_media, or opening the auth pool", () => {
    const files: SourceFile[] = [
      { path: "moderation/intake.ts", source: `import { createSocialRepo } from "../social/repo";` },
      { path: "moderation/decide.ts", source: `import { verifyStepUp } from "../auth/staff/step-up";` },
      { path: "moderation/repo.ts", source: `import { cases, postMedia, type Db } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: "const rows = await tx.execute(sql`select id from post_media where post_id = ${postId}`);" },
      { path: "moderation/context.ts", source: `export interface ModerationDeps { authDb: Db }` },
    ];
    expect(findViolations(files, new Set(["cases", "postMedia"]), new Set())).toEqual([
      "moderation/intake.ts: imports ../social/repo, which is inside the social module (use ./social)",
      "moderation/decide.ts: imports ../auth/staff/step-up, which is inside the auth module (use ./auth)",
      "moderation/repo.ts: references post_media, which only the media module may touch",
      "moderation/cases.ts: references post_media, which only the media module may touch",
      "moderation/context.ts: references the auth database pool",
    ]);
  });

  test("catches auth-schema imports inside the moderation module, and the auth module's repository or session store", () => {
    const files: SourceFile[] = [
      { path: "moderation/repo.ts", source: `import { decisions, notifierContacts, type Db } from "@korbat/db";` },
      { path: "moderation/decide.ts", source: `import type { staffPersonalAccounts as links, users } from "@korbat/db";` },
      { path: "moderation/cases.ts", source: `import * as db from "@korbat/db";` },
      { path: "moderation/intake.ts", source: `import { createAuthRepo } from "../auth";` },
      { path: "moderation/reveal.ts", source: `const { createSessions } = await import("../auth");` },
    ];
    expect(findViolations(files, new Set(["decisions"]), new Set(["notifierContacts", "staffPersonalAccounts", "users"]))).toEqual([
      "moderation/repo.ts: imports auth-schema notifierContacts from @korbat/db",
      "moderation/decide.ts: imports auth-schema staffPersonalAccounts from @korbat/db",
      "moderation/decide.ts: imports auth-schema users from @korbat/db",
      "moderation/cases.ts: namespace import of @korbat/db (import public-schema names explicitly)",
      "moderation/intake.ts: uses the auth module's createAuthRepo (the moderation module goes through the auth module's interface)",
      "moderation/reveal.ts: uses the auth module's createSessions (the moderation module goes through the auth module's interface)",
    ]);
  });

  test("catches public-schema imports inside the auth module", () => {
    const files: SourceFile[] = [
      { path: "auth/repo.ts", source: `import { users, profiles as p, type Db } from "@korbat/db";` },
      { path: "auth/flows/x.ts", source: `import type { posts } from "@korbat/db";` },
      { path: "auth/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["profiles", "posts"]), new Set())).toEqual([
      "auth/repo.ts: imports public-schema profiles from @korbat/db",
      "auth/flows/x.ts: imports public-schema posts from @korbat/db",
      "auth/flows/y.ts: namespace import of @korbat/db (import auth-schema names explicitly)",
    ]);
  });

  test("catches auth-schema imports inside the social module", () => {
    const files: SourceFile[] = [
      { path: "social/repo.ts", source: `import { posts, users as u, type Db } from "@korbat/db";` },
      { path: "social/flows/x.ts", source: `import type { sessions } from "@korbat/db";` },
      { path: "social/flows/y.ts", source: `import * as db from "@korbat/db";` },
    ];
    expect(findViolations(files, new Set(["posts"]), new Set(["users", "sessions"]))).toEqual([
      "social/repo.ts: imports auth-schema users from @korbat/db",
      "social/flows/x.ts: imports auth-schema sessions from @korbat/db",
      "social/flows/y.ts: namespace import of @korbat/db (import public-schema names explicitly)",
    ]);
  });
});

/**
 * 3d review H3: the recipients' count (the day's salt and the sketches of accounts and readers) lives in a Valkey of its
 * own that writes nothing to disk, never in the shared one, whose append-only file keeps every write. In the API the
 * transparency module is given one store, `counts`, which index.ts builds from COUNTS_URL alone, and no file of the
 * module names the shared client or REDIS_URL. In compose.yml the service `counts` runs the redis service's own pinned
 * image with persistence off, on the data network alone, with no volume and no published port, and the API's COUNTS_URL
 * names it.
 */
function findCountsViolations(files: SourceFile[], compose: string): string[] {
  const violations: string[] = [];
  const index = files.find((file) => file.path === "index.ts")?.source ?? "";
  if (!/const counts = new Redis[(]config[.]COUNTS_URL,/.test(index)) violations.push("index.ts: builds no counts client from COUNTS_URL");
  const call = /createTransparency[(][{]([^}]*)[}][)]/.exec(index)?.[1] ?? "";
  if (!/(^|[ ,])counts([ ,]|$)/.test(call) || /(^|[ ,])redis([ ,:]|$)/.test(call)) violations.push(`index.ts: createTransparency is given ${call.trim()}`);
  for (const { path, source } of files) {
    if (!path.startsWith("transparency/")) continue;
    if (/REDIS_URL|[^a-zA-Z]redis[^a-zA-Z]/.test(source.replace(/import type Redis from "ioredis";/, ""))) violations.push(`${path}: names the shared Valkey`);
  }
  const services = composeServices(compose);
  const counts = services.get("counts");
  const image = (block: string | undefined) => /^ {4}image: (.+)$/m.exec(block ?? "")?.[1];
  if (!counts) violations.push("compose.yml: no service counts");
  else {
    if (image(counts) === undefined || image(counts) !== image(services.get("redis"))) violations.push("compose.yml: counts runs another image than redis");
    for (const flag of ["--appendonly no", "--save ''", "--requirepass $$REDIS_PASSWORD"]) if (!counts.includes(flag)) violations.push(`compose.yml: counts lacks ${flag}`);
    for (const key of ["volumes:", "ports:", "env_file:"]) if (counts.includes(key)) violations.push(`compose.yml: counts has ${key}`);
    if (!counts.includes("networks: [data]")) violations.push("compose.yml: counts is not on the data network alone");
  }
  if (!services.get("api")?.includes("COUNTS_URL: redis://:${REDIS_PASSWORD}@counts:6379")) violations.push("compose.yml: the api's COUNTS_URL does not name counts");
  return violations;
}

describe("the recipients' count keeps nothing on disk (3d review H3)", () => {
  test("the transparency module is given the counts store alone, built from COUNTS_URL; compose's counts writes nothing to disk", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    expect(findCountsViolations(loadSources(), compose)).toEqual([]);
  });

  test("catches the shared client handed to the module, a volume, persistence and another image", () => {
    const compose = readFileSync(join(REPO_ROOT, "infra", "compose.yml"), "utf8");
    const files = loadSources().map((file) => (file.path === "index.ts" ? { ...file, source: file.source.replace(/createTransparency[(][{]([^}]*)[}][)]/, "createTransparency({ apiDb, redis, auth: auth.forTransparency, config, logger })") } : file));
    const counts = composeServices(compose).get("counts") ?? "";
    // A function as the replacement, so the dollar signs of the block stay as they are.
    const broken = compose.replace(counts, () => counts.replace("--appendonly no", "--appendonly yes").replace("    networks: [data]", `    volumes:${LF}      - valkeydata:/data${LF}    networks: [data]`));
    expect(findCountsViolations(files, broken)).toEqual([
      "index.ts: createTransparency is given apiDb, redis, auth: auth.forTransparency, config, logger",
      "compose.yml: counts lacks --appendonly no",
      "compose.yml: counts has volumes:",
    ]);
  });
});

/**
 * The cards module (2d design, sections 8.1 and 12.2; Task 6): a card answers the same for everyone, so the module reads no
 * session, no cookie and no request header, and no table: a file under cards/ imports nothing of @korbat/db and nothing of
 * another module but the social module's index (its interface for cards), and names none of the ways a request's session
 * or headers are read. And app.ts mounts its routes before the session's resolution, as it mounts the status route.
 */
const CARDS_READS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bc[.]get\(\s*["']session["']/, what: "the session" },
  { pattern: /\b(resolveSession|requireSession|requireFreshAuth)\b/, what: "the auth module's session guard" },
  { pattern: /\bgetCookie\b|hono[/]cookie/, what: "a cookie" },
  { pattern: /\breq[.](header|raw|cookie)\b/, what: "the request's headers" },
];

function findCardsViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    if (!path.startsWith("cards/")) continue;
    if (dbImports(source).length > 0 || specifiers(source).some((spec) => spec === "@korbat/db" || spec.startsWith("@korbat/db/"))) violations.push(`${path}: imports @korbat/db (the cards module reads through the social module's interface)`);
    for (const spec of specifiers(source)) {
      if (!spec.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/[.]ts$/, "");
      if (!target.startsWith("cards/") && target !== "social" && target !== "social/index") violations.push(`${path}: imports ${spec} (the cards module uses the social module's index alone)`);
    }
    for (const { pattern, what } of CARDS_READS) if (pattern.test(source)) violations.push(`${path}: reads ${what}`);
  }
  return violations;
}

describe("the cards module reads no session (2d Task 6)", () => {
  test("the module exists, its files read no session, cookie, header or table, and app.ts mounts it before the session's resolution", () => {
    const files = loadSources();
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(["cards/index.ts", "cards/build.ts", "cards/words.ts"]));
    expect(findCardsViolations(files)).toEqual([]);
    const app = files.find((file) => file.path === "app.ts")!.source;
    const mounted = app.indexOf('app.route("/api", cards.routes)');
    expect(mounted).toBeGreaterThan(app.indexOf('rateLimit({ name: "global"'));
    expect(mounted).toBeGreaterThan(app.indexOf('app.route("/api", social.statusRoutes)'));
    expect(mounted).toBeLessThan(app.indexOf("auth.resolveSession(c, next)"));
  });

  test("catches a session, a cookie, a header, a table and another module's inside", () => {
    const files: SourceFile[] = [
      { path: "cards/index.ts", source: 'r.get("/cards/post/:id", async (c) => c.get("session"));' },
      { path: "cards/build.ts", source: 'import { getCookie } from "hono/cookie"; const ua = c.req.header("user-agent");' },
      { path: "cards/words.ts", source: 'import { profiles } from "@korbat/db"; import { createSocialRepo } from "../social/repo"; import type { SocialForCards } from "../social";' },
      { path: "cards/guard.ts", source: 'import { requireSession } from "../auth";' },
      { path: "social/routes.ts", source: 'c.get("session");' },
    ];
    expect(findCardsViolations(files)).toEqual([
      "cards/index.ts: reads the session",
      "cards/build.ts: reads a cookie",
      "cards/build.ts: reads the request's headers",
      "cards/words.ts: imports @korbat/db (the cards module reads through the social module's interface)",
      "cards/words.ts: imports ../social/repo (the cards module uses the social module's index alone)",
      "cards/guard.ts: imports ../auth (the cards module uses the social module's index alone)",
      "cards/guard.ts: reads the auth module's session guard",
    ]);
  });
});
```

### Replace `apps/api/test/middleware.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import type { AppEnv } from "../src/env";
import { observability } from "../src/middleware/observability";
import { noStore, securityHeaders } from "../src/middleware/security-headers";
import { MemoryStore, rateLimit } from "../src/middleware/rate-limit";
import { validate } from "../src/lib/validate";
import { clientIdentity, clientNetwork, resolveClientIp } from "../src/auth/client-ip";

const silent = pino({ level: "silent" });

function base() {
  const app = new Hono<AppEnv>();
  app.use(observability(silent));
  app.use(securityHeaders, noStore);
  return app;
}

describe("observability", () => {
  test("adds a uuid x-request-id header", async () => {
    const app = base().get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("security headers", () => {
  test("sets the hardened header set on every response", async () => {
    const app = base().get("/x", (c) => c.json({}));
    const h = (await app.request("/x")).headers;
    expect(h.get("content-security-policy")).toContain("default-src 'none'");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("cache-control")).toBe("no-store");
    expect(h.get("x-robots-tag")).toBe("noindex");
  });

  test("2d (design, decision 20 and section 8.2): X-Robots-Tag noindex on every answer, an image's, a 404's and an error's included", async () => {
    const app = base()
      .get("/image", () => new Response("webp", { headers: { "content-type": "image/webp", "cache-control": "public, max-age=60" } }))
      .get("/empty", (c) => c.body(null, 204))
      .get("/boom", () => {
        throw new Error("boom");
      });
    app.notFound((c) => c.json({ error: "not found" }, 404));
    app.onError((_err, c) => c.json({ error: "internal" }, 500));
    for (const [path, status] of [["/image", 200], ["/empty", 204], ["/none", 404], ["/boom", 500]] as const) {
      const res = await app.request(path);
      expect([path, res.status, res.headers.get("x-robots-tag")]).toEqual([path, status, "noindex"]);
    }
    // A handler's own caching stays as it set it.
    expect((await app.request("/image")).headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("rateLimit", () => {
  test("allows up to limit then returns 429 with Retry-After", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    const app = base()
      .use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const blocked = await app.request("/x");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()) as { error: { code: string } }).toMatchObject({ error: { code: "rate_limited" } });
    now += 10_001;
    expect((await app.request("/x")).status).toBe(200);
  });
  test("a hit given back with release leaves the count one lower in the same window, and never below zero", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    await store.hit("k", 10_000);
    now += 4_000;
    await store.hit("k", 10_000);
    await store.release("k");
    // One hit left, and the window still ends where the first hit put it: nothing was restarted.
    expect(await store.hit("k", 10_000)).toEqual({ count: 2, resetMs: 6_000 });
    await store.release("k");
    await store.release("k");
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 6_000 });
    // A key that was never hit has nothing to give back, and another key is not touched.
    await store.release("never");
    expect(await store.hit("never", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
    // Once the window is over, a release belongs to no window and the next hit opens a fresh one.
    now += 6_000;
    await store.release("k");
    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetMs: 10_000 });
  });
  test("a failing store answers 503 with Retry-After instead of letting the request through", async () => {
    const store = {
      hit: async () => {
        throw new Error("redis down");
      },
      release: async () => undefined,
    };
    const app = base().use(rateLimit({ name: "t", store, limit: 2, windowMs: 10_000, key: () => "k" })).get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toMatchObject({ error: { code: "service_unavailable" } });
  });
  test("exposes RateLimit-* headers", async () => {
    const app = base()
      .use(rateLimit({ name: "t", store: new MemoryStore(), limit: 5, windowMs: 1000, key: () => "k" }))
      .get("/x", (c) => c.text("ok"));
    const h = (await app.request("/x")).headers;
    expect(h.get("ratelimit-limit")).toBe("5");
    expect(h.get("ratelimit-remaining")).toBe("4");
  });
});

describe("client identity", () => {
  const key = Buffer.alloc(32, 1);
  const spoofed = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.7, 10.0.0.1" };
  const seen = async (trust: "cloudflare" | "caddy" | "none", ipHashKey = key) => {
    const app = base().use(clientIdentity({ trust, ipHashKey })).get("/x", (c) => c.json({ ip: c.get("clientIp"), hash: c.get("clientIpHash") }));
    return (await (await app.request("/x", { headers: spoofed })).json()) as { ip: string; hash: string };
  };
  test("cloudflare mode believes cf-connecting-ip", async () => {
    expect((await seen("cloudflare")).ip).toBe("203.0.113.9");
  });
  test("caddy mode takes the first forwarded entry and ignores cf-connecting-ip", async () => {
    expect((await seen("caddy")).ip).toBe("198.51.100.7");
  });
  test("none mode uses the socket only, so a spoofed header opens no bucket", async () => {
    expect((await seen("none")).ip).toBe("direct");
  });
  test("the hash is keyed and never the address itself", async () => {
    const a = await seen("cloudflare");
    const b = await seen("cloudflare", Buffer.alloc(32, 2));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.ip);
    expect(a.hash).not.toBe(b.hash);
  });
  test("missing headers fall back down the list", () => {
    const c = { req: { header: () => undefined } } as unknown as Parameters<typeof resolveClientIp>[0];
    for (const trust of ["cloudflare", "caddy", "none"] as const) expect(resolveClientIp(c, trust)).toBe("direct");
  });

  describe("the network an address belongs to, for the limits that count per network (3c design, section 7.1)", () => {
    test("an IPv4 address is its own network; an IPv6 address is its first 64 bits, however it is written", () => {
      expect(clientNetwork("203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("2001:db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:db8:1234:5678::1")).toBe("2001:db8:1234:5678::/64");
      expect(clientNetwork("2001:DB8:1234:5678:FFFF:FFFF:FFFF:FFFF")).toBe("2001:db8:1234:5678::/64");
      // Leading zeros and the compressed form name the same network.
      expect(clientNetwork("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
      expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
      expect(clientNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
      // Another /64 is another network.
      expect(clientNetwork("2001:db8:1234:5679::1")).toBe("2001:db8:1234:5679::/64");
    });
    test("an IPv4 address written as an IPv6 one counts as the IPv4 address it is", () => {
      expect(clientNetwork("::ffff:203.0.113.9")).toBe("203.0.113.9");
      expect(clientNetwork("::FFFF:203.0.113.9")).toBe("203.0.113.9");
    });
    test("what is no address is taken as it is, so a request without one still has a bucket", () => {
      expect(clientNetwork("direct")).toBe("direct");
      expect(clientNetwork("not an address")).toBe("not an address");
    });
    test("the middleware sets its keyed hash beside the address's: one hash for a whole /64, another for the next, never the network itself", async () => {
      const netOf = async (ip: string, ipHashKey = key) => {
        const app = base().use(clientIdentity({ trust: "cloudflare", ipHashKey })).get("/x", (c) => c.json({ hash: c.get("clientIpHash"), net: c.get("clientNetHash") }));
        return (await (await app.request("/x", { headers: { "cf-connecting-ip": ip } })).json()) as { hash: string; net: string };
      };
      const [one, two, next] = [await netOf("2001:db8:1234:5678::1"), await netOf("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd"), await netOf("2001:db8:1234:5679::1")];
      expect(one.net).toMatch(/^[0-9a-f]{64}$/);
      expect(two.net).toBe(one.net);
      expect(next.net).not.toBe(one.net);
      // The address's own hash still tells the two addresses apart.
      expect(two.hash).not.toBe(one.hash);
      expect(one.net).not.toBe(one.hash);
      expect((await netOf("2001:db8:1234:5678::1", Buffer.alloc(32, 2))).net).not.toBe(one.net);
      const v4 = await netOf("203.0.113.9");
      expect(v4.net).toMatch(/^[0-9a-f]{64}$/);
      expect(v4.net).not.toBe(v4.hash);
      expect((await netOf("::ffff:203.0.113.9")).net).toBe(v4.net);
      expect((await netOf("203.0.113.10")).net).not.toBe(v4.net);
    });
  });
});

describe("validate", () => {
  test("returns 400 envelope with field details", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: "no" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { properties?: Record<string, unknown> } } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.properties).toHaveProperty("n");
  });
  test("passes valid input through", async () => {
    const app = base().post("/x", validate("json", z.object({ n: z.number() })), (c) => c.json(c.req.valid("json")));
    const res = await app.request("/x", { method: "POST", body: JSON.stringify({ n: 4 }), headers: { "content-type": "application/json" } });
    expect(await res.json()).toEqual({ n: 4 });
  });
});
```

### Replace `apps/api/test/transparency/route-table.test.ts` (whole file)

```ts
import type { MiddlewareHandler } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { RECIPIENT_READ_ROUTES } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import type { AppEnv } from "../../src/env";
import { createCards } from "../../src/cards";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";

/**
 * The route table of the recipients' count (3d design, sections 7.5 and 10.1; Task 4): RECIPIENT_READ_ROUTES are exactly
 * the reads of the social module that answer without a session, so a signed-out read added later fails here until it is
 * listed there or refused below by name. The database pool is created and never connects: only the table is read.
 */
describe("RECIPIENT_READ_ROUTES and the social module's signed-out reads (3d Task 4)", () => {
  /** Signed-out reads that are deliberately not counted, each with why. */
  const NOT_COUNTED: Record<string, string> = {
    // Caddy asks it for every view of a post's page (3f): the page's own read is what a person makes.
    "GET /api/posts/:id/status": "the page status, which Caddy asks",
    // 2d Task 6 (design, section 8.1): the share cards, which Caddy asks for every view of a post's or a profile's page in
    // the status route's place, before the session's resolution: the page's own read is what a person makes.
    "GET /api/cards/post/:id": "a post's card, which Caddy asks",
    "GET /api/cards/profile/:handle": "a profile's card, which Caddy asks",
  };

  function signedOutReads(): string[] {
    const guard: MiddlewareHandler<AppEnv> = async (_c, next) => next();
    const fresh: MiddlewareHandler<AppEnv> = async (_c, next) => next();
    const social = createSocial({ apiDb: createDb("postgres://a:b@localhost:55432/k", { max: 1 }), rateLimitStore: new MemoryStore(), logger: pino({ level: "silent" }), requireSession: guard, requireFreshAuth: fresh });
    const chains = new Map<string, unknown[]>();
    const cards = createCards({ social: social.forCards, appOrigin: "https://korbat.example" });
    for (const router of [social.routes, social.statusRoutes, cards.routes]) {
      for (const route of router.routes) {
        if (route.method !== "GET") continue;
        const key = `GET /api${route.path}`;
        chains.set(key, [...(chains.get(key) ?? []), route.handler]);
      }
    }
    return [...chains.entries()].filter(([, handlers]) => !handlers.includes(guard)).map(([key]) => key);
  }

  test("every GET of the social module without the session guard is a counted read or refused by name, and every counted read is one", () => {
    const reads = signedOutReads();
    const counted = reads.filter((route) => !(route in NOT_COUNTED));
    expect(counted.sort()).toEqual([...RECIPIENT_READ_ROUTES].sort());
    for (const route of Object.keys(NOT_COUNTED)) expect(reads).toContain(route);
  });

  test("the check reads the guard: a guarded read such as the Following timeline is no signed-out read", () => {
    const reads = signedOutReads();
    expect(reads).not.toContain("GET /api/timeline/following");
    expect(reads).not.toContain("GET /api/me/likes");
    expect(reads).toContain("GET /api/timeline/latest");
  });
});
```

### Replace `apps/app/test/browser/app.browser.ts` (whole file)

```ts
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { THEMES, type ThemeName } from "../../src/theme/tokens";
import { TITLE_WORDS, UI_WORDS, fill } from "../../src/lib/ui-words";
import { THEME_FADE } from "../../src/theme/motion";
import { CASES_WORDS, DECISION_WORDS, STATUS_SHEET_WORDS, UPLOAD_TEXTS } from "../../src/lib/moderation-words";
import { RULES_PAGE } from "../../src/lib/public-pages";
import { IMPORT_WORDS } from "../../src/lib/import-words";
import { ACTIVITY_DEFAULTS, IMPORT_RULES } from "@korbat/contracts";
import { ACTIVITY_WORDS } from "../../src/lib/activity-words";
import { ACTIVITY_SETTINGS_WORDS, AVATAR_WORDS } from "../../src/lib/settings-words";
import { appSiteHeadersFromCaddyfile } from "./caddyfile";
import {
  ACTIVITY_SEEN,
  ADA,
  AVATAR_UPLOAD_ID,
  createFixtureApi,
  DECISION_ID,
  GRACE,
  HIDDEN_IMAGE_POST_ID,
  ARCHIVE_BYTES,
  IMPORT_BY_STAFF,
  IMPORT_DONE,
  IMPORT_NEW,
  IMPORT_PUBLISHING,
  IMPORT_READY,
  IMPORT_RESUME,
  IMPORT_SCANNING,
  IMPORTED_POST_ID,
  MISSING_POST_ID,
  newPostIdOf,
  NOTICE_REF,
  NOTICE_TOKEN,
  POST_DECISION_ID,
  POST_ID,
  postIdOf,
  RELEASE_ID,
  REMOVED_CHIP,
  solidWebp,
  UPLOAD_ID,
  writtenIdOf,
  type FixtureApi,
} from "./fixture-api";
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
 * 1280, a reply and a quote; from Task 7 the chip's details sheet, the appeal it opens and Cases' tabs, and the link
 * under a hidden image with the terms in their frame; from Task 8 the Settings index, Appearance and its radios, the
 * theme's cross-fade, the switch rows with Hide counts, and Clear what this device keeps. Later tasks add their steps.
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
  // The shell and PublicFrame both draw role="main"; on a loaded machine the app can draw it after the network is idle,
  // and a step that measured at once read nothing (UI Task 10's runner met this in steps 6, 15 and 32).
  await page.waitForSelector('[role="main"]', { state: "attached", timeout: 20_000 });
  await page.evaluate("document.fonts.ready.then(() => true)");
}

/**
 * UI Task 8: forgets the reading places and drafts the signed-in pages of a step kept, before it opens a page signed out.
 * A signed-out start with one kept is a session that ended elsewhere (section 8.8), which clears the appearance with them
 * and would cross-fade the step's theme back to System while the page is measured.
 */
async function forgetSession(page: Page): Promise<void> {
  await page.evaluate(`Object.keys(localStorage).filter((key) => key.startsWith("korbat.place.") || key.startsWith("korbat.drafts.")).forEach((key) => localStorage.removeItem(key))`);
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
  site = await startAppSite({ dist: out, api: fixtures.handle, postStatus: fixtures.postStatus, profileStatus: fixtures.profileStatus });
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
  // UI Task 8: the Settings index and Appearance.
  "/settings",
  "/settings/appearance",
  "/settings/security",
  "/settings/privacy",
  "/settings/profile",
  "/settings/account",
  "/settings/cases",
  `/settings/cases/${DECISION_ID}`,
  // UI Task 7: the decision of Ada's removed post, opened as its details sheet's Appeal opens it.
  `/settings/cases/${POST_DECISION_ID}?appeal=1`,
  `/settings/cases/${DECISION_ID}/reply`,
  `/settings/cases/releases/${RELEASE_ID}`,
  `/settings/cases/uploads/${UPLOAD_ID}`,
  // 3b Task 7: the import's two screens, the start and one import.
  "/settings/import",
  `/settings/import/${IMPORT_READY}`,
  // 2d Task 5: Activity, its Conversations tab and its settings page.
  "/activity",
  "/activity?tab=conversations",
  "/settings/activity",
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
 * its header with Home's card and the thread's reply card included, and the compose button; from Task 7 the column of
 * every screen it moved onto the tokens (`data-screen`: the cases screens, the report form, a report's status, the
 * public pages) and PublicFrame's banner and footer; from Task 8, with the legacy lists empty, the whole main column of
 * the shell and of PublicFrame, and every radio group.
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
  "[data-screen]",
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="main"]',
  '[role="radiogroup"]',
].join(", ");
/** A page drawn wholly on the kit: everything on it is held to the rules. */
const ALL = "body";

/**
 * The pages of the layout steps: Home, a post, a profile, the rules and a missing page, with the item current on each;
 * from Task 5 Bookmarks and a followers list too, drawn wholly on the kit; from Task 7 the rules wholly, Cases and a
 * decision under Settings, and the terms, which sit in PublicFrame outside the shell (`frame`), so the shell's own
 * checks pass them over; from Task 8 the Settings index, Appearance signed in and out (`signedOut`), Security, and the
 * sign-in screen in its frame.
 */
const LAYOUT_PAGES: { name: string; route: string; current: string | null; scope: string; frame?: boolean; signedOut?: boolean }[] = [
  { name: "home", route: "/", current: "/", scope: DRAWN },
  { name: "post", route: `/post/${POST_ID}`, current: null, scope: DRAWN },
  { name: "profile", route: "/u/grace", current: null, scope: DRAWN },
  { name: "rules", route: "/rules", current: null, scope: ALL },
  { name: "missing", route: "/no-such-page", current: null, scope: ALL },
  { name: "bookmarks", route: "/bookmarks", current: "/bookmarks", scope: ALL },
  { name: "followers", route: "/u/grace/followers", current: null, scope: ALL },
  { name: "cases", route: "/settings/cases", current: "/settings", scope: ALL },
  { name: "decision", route: `/settings/cases/${POST_DECISION_ID}`, current: "/settings", scope: ALL },
  { name: "terms", route: "/terms", current: null, scope: ALL, frame: true },
  { name: "settings", route: "/settings", current: "/settings", scope: ALL },
  { name: "appearance", route: "/settings/appearance", current: "/settings", scope: ALL },
  { name: "appearance-out", route: "/settings/appearance", current: "/settings/appearance", scope: ALL, signedOut: true },
  { name: "security", route: "/settings/security", current: "/settings", scope: ALL },
  { name: "signin", route: "/signin", current: null, scope: ALL, frame: true, signedOut: true },
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
        // The session each page needs, read again as the page loads: Appearance signed out, and sign-in, which a signed-in
        // account leaves for its feed.
        fixtures.state.signedIn = page.signedOut !== true;
        if (page.signedOut === true) await forgetSession(visit_.page);
        await visit(visit_.page, page.route);
        const layout = (await visit_.page.evaluate(LAYOUT_SCRIPT)) as Layout;
        // A page in PublicFrame has no shell: no layout kind, no nav and no context column.
        expect(layout.kind, page.name).toBe(page.frame ? null : kind);
        // 2d (decision 24, 10.1): the phone's tab bar has no Settings item, so its settings pages mark no item current; the
        // settings row under each one's title says where the reader is, and Settings is reached from the profile.
        const current = kind === "phone" && page.current === "/settings" ? null : page.current;
        expect(layout.current, page.name).toEqual(current === null ? [] : [current]);
        // The context column from 1024 px only.
        expect(layout.context, page.name).toBe(!page.frame && width >= 1024);
        expect(layout.scroll, `${page.name}: no horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(visit_.page, page.scope), page.name).toEqual([]);
        if (width < 768) expect(await phoneProblems(visit_.page, page.scope), page.name).toEqual([]);
        if (current !== null) {
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

/** UI Task 7: the chip of Ada's removed post on her own profile, the button that opens its details sheet. */
const statusChip = (page: Page) => page.locator('[aria-haspopup="dialog"]').filter({ hasText: REMOVED_CHIP });
/** The labelled blocks of the open details sheet, by their names, in their order. */
const STATUS_BLOCKS = `[...document.querySelectorAll('[role="dialog"] [data-status-block]')].map((block) => block.getAttribute("data-status-block"))`;
/** The design's order of the blocks while an appeal can still be filed: Appeal first (section 8.7). */
const OPEN_ORDER = ["appeal", "rule", "does", "appliesTo", "whoSees", "decidedBy", "when", "statement"];

/**
 * The placeholder's sentence (HiddenImage.tsx's HIDDEN_IMAGE, word for word): that component file draws, so the walk,
 * which runs in Node without react-native, holds its own copy, which hidden-media.test.tsx pins to the same words.
 */
const HIDDEN_IMAGE_WORDS = "Image hidden by korbat moderation";

/** Opens the details sheet of Ada's removed post (on /u/ada) and waits until its blocks are drawn. */
async function openStatusSheet(page: Page): Promise<void> {
  await statusChip(page).click();
  await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the status sheet's blocks");
}

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
    // The baseline (1222b87) is above 400 KB: the cap was it plus 80 KB, and is plus 120 KB from 3b Task 7 (owner), for imports.
    expect(jsGzip).toBeLessThanOrEqual(baseline.js.gzipBytes + 120 * 1024);
    expect(baseline.js.gzipBytes + 120 * 1024).toBe(832_257);
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
    // 2d Task 6: a profile's page takes its card's status the same way; both pages say noindex, and / does not.
    const profilePage = await fetch(`${origin}/u/grace`);
    expect([profilePage.status, profilePage.headers.get("x-robots-tag")]).toEqual([200, "noindex"]);
    expect((await fetch(`${origin}/u/nobody_here`)).status).toBe(404);
    expect((await fetch(`${origin}/post/${POST_ID}`)).headers.get("x-robots-tag")).toBe("noindex");
    expect((await fetch(`${origin}/`)).headers.get("x-robots-tag")).toBeNull();
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
      for (let i = 0; i < 8; i++) {
        await visit_.page.keyboard.press("Tab");
        stops.push((await visit_.page.evaluate(focused)) as Focus);
        if (i === 0) await screenshot(visit_.page, "keyboard-1280-dark-skip");
        if (i === 1) await screenshot(visit_.page, "keyboard-1280-dark-nav");
      }
      expect(stops[0]!.href).toBe("#main");
      // The skip link shows itself while it holds the focus, at a control's size.
      expect(stops[0]!.w).toBeGreaterThanOrEqual(44);
      expect(stops[0]!.h).toBeGreaterThanOrEqual(44);
      // 2d Task 5 (decision 24): Activity second.
      expect(stops.slice(1, 6).map((stop) => (stop.inNav ? stop.href : null))).toEqual(["/", "/activity", "/bookmarks", "/u/ada", "/settings"]);
      // Task 6: the nav ends with New post, a button and no link.
      expect(stops[6]!.inNav).toBe(true);
      expect(stops[6]!.role).toBe("button");
      expect(stops[6]!.href).toBeNull();
      expect(stops[7]!.inMain).toBe(true);
      // Every stop draws korbat's ring, 2 px: the shell's, and the first stop inside Home's column, Home's own tab (Task 5).
      expect(stops[7]!.role).toBe("tab");
      for (const stop of stops.slice(0, 8)) {
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
    test(`${step}. contrast as drawn in ${theme}: the shell on Home and a post, the whole rules, missing, decision, terms, Appearance, Security and sign-in pages, and the open status sheet`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      try {
        for (const [route, scope, signedIn] of [
          ["/", DRAWN, true],
          [`/post/${POST_ID}`, DRAWN, true],
          ["/rules", ALL, true],
          ["/no-such-page", ALL, true],
          // UI Task 7: a decision's screen and the terms, wholly on the tokens.
          [`/settings/cases/${POST_DECISION_ID}`, ALL, true],
          ["/terms", ALL, true],
          // UI Task 8: Appearance, Security and the sign-in screen, which a signed-in account leaves for its feed.
          ["/settings/appearance", ALL, true],
          ["/settings/security", ALL, true],
          ["/signin", ALL, false],
        ] as const) {
          fixtures.state.signedIn = signedIn;
          if (!signedIn) await forgetSession(visit_.page);
          await visit(visit_.page, route);
          expect(await contrast(visit_.page, scope), `${theme} ${route}`).toEqual([]);
          await clean(visit_);
        }
        fixtures.state.signedIn = true;
        // The details sheet of Ada's removed post, open with its blocks (section 12.3's theme steps).
        await visit(visit_.page, "/u/ada");
        await openStatusSheet(visit_.page);
        // Sampled once the sheet's opening fade has ended: the walk reads colours as drawn, opacity included.
        await pause(500);
        expect(await contrast(visit_.page, '[role="dialog"]'), `${theme} the status sheet`).toEqual([]);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    });
  }

  test("11. at 320 by 640 with Largest text and the root at 200 percent, nothing scrolls sideways and no label is cut", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    try {
      // The screens drawn on the kit: a missing page, Bookmarks under its header, and from Task 5 Home with its tabs and
      // rows; from Task 6 a post with its reply card, and Home's New post sheet open with words in its field; from Task 7
      // a decision's screen, the rules, and the details sheet of Ada's removed post, open.
      for (const [name, route] of [
        ["missing", "/no-such-page"],
        ["bookmarks", "/bookmarks"],
        ["home", "/"],
        ["post", `/post/${POST_ID}`],
        ["composer", "/"],
        ["decision", `/settings/cases/${POST_DECISION_ID}`],
        ["rules", "/rules"],
        ["sheet", "/u/ada"],
        // UI Task 8: Appearance, with its sample at the largest step.
        ["appearance", "/settings/appearance"],
      ] as const) {
        await visit(visit_.page, route);
        await visit_.page.evaluate(`document.documentElement.style.fontSize = "200%"`);
        await pause(300);
        if (name === "composer") {
          await visit_.page.locator("[data-compose]").click();
          await visit_.page.locator('[role="dialog"] textarea').fill("Morning light over the harbour, written at the largest text.");
          await pause(400);
        }
        if (name === "sheet") {
          await openStatusSheet(visit_.page);
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
      // 2d Task 5: on a loaded machine the feed's rows can be drawn after the network's idle moment, and their images and
      // the mono face would then be asked for offline (the export from before Task 5 met it too). The rows are drawn in
      // batches: once their number has held for a second, the images they asked for and the fonts they use are in before
      // the connection goes (an image left to load lazily is not asked for, so it is not waited for).
      await visit_.page.locator('main [role="article"]').first().waitFor();
      let rows = -1;
      for (let i = 0; i < 20; i++) {
        const now = await visit_.page.locator('main [role="article"]').count();
        if (now === rows) break;
        rows = now;
        await pause(1000);
      }
      await until(visit_.page, `[...document.images].filter((image) => image.loading !== "lazy").every((image) => image.complete)`, "the drawn rows' images");
      await visit_.page.evaluate("document.fonts.ready.then(() => true)");
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
      // 2d Task 5 (10.6): the author's menu holds Hide like and repost counts before Delete.
      expect(await menu.locator('[role="button"]').allInnerTexts()).toEqual([expect.stringContaining(UI_WORDS["post.whoSees"]), UI_WORDS["post.copyLink"], UI_WORDS["post.hideCounts"], UI_WORDS["post.delete"]]);
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

  // UI Task 7: the moderation surfaces and the public pages (UI design, sections 8.7 and 8.9; decision 10).

  test("32. the status sheet: the chip is a button that opens a dialog, named by its words; skeletons while the decision is read, then the blocks in the design's order; Decided by in role terms; Read the full decision opens the case; Escape gives the focus back to the chip; a refused read's Try again reads it again", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/ada");
          const chip = statusChip(page);
          // 2d Task 5: the profile asks for its posts only once the profile has answered, which a loaded machine can leave
          // after the network's idle moment: the chip is waited for before it is read (the export before Task 5 met it too).
          await chip.first().waitFor();
          // The chip: a button that opens a dialog, named by its own words, with a 44 px target.
          const tag = (await page.evaluate(`(() => { const e = [...document.querySelectorAll('[aria-haspopup="dialog"]')].find((x) => x.textContent.trim() === ${JSON.stringify(REMOVED_CHIP)}); return e ? { role: e.getAttribute("role"), popup: e.getAttribute("aria-haspopup"), name: e.textContent.trim(), height: e.offsetHeight } : null; })()`)) as {
            role: string | null;
            popup: string | null;
            name: string;
            height: number;
          };
          expect(tag).toEqual({ role: "button", popup: "dialog", name: REMOVED_CHIP, height: expect.any(Number) });
          expect(tag.height).toBeGreaterThanOrEqual(44);
          // While the decision is on its way: the dialog named by the chip's words, skeletons and one status, no block yet.
          fixtures.state.delayMs = 1500;
          const asked = fixtures.state.requests.length;
          await chip.click();
          const dialog = page.locator('[role="dialog"]');
          await dialog.waitFor({ state: "visible" });
          expect(await page.evaluate(DIALOG_NAME)).toBe(REMOVED_CHIP);
          await dialog.locator('[role="status"]').waitFor({ state: "attached" });
          expect(await page.evaluate(`${STATUS_BLOCKS}.length`)).toBe(0);
          await pause(300);
          await screenshot(page, `status-sheet-loading-${width}-${theme}`);
          // Each opening reads the decision.
          expect(fixtures.state.requests.slice(asked).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks", 10_000);
          fixtures.state.delayMs = 0;
          expect(await page.evaluate(STATUS_BLOCKS)).toEqual(OPEN_ORDER);
          const decided = dialog.locator('[data-status-block="decidedBy"]');
          expect(await decided.innerText()).toContain(STATUS_SHEET_WORDS["status.byPerson"]);
          expect(await dialog.locator('[data-status-block="appliesTo"]').innerText()).toContain(STATUS_SHEET_WORDS["status.appliesPost"]);
          expect(await dialog.locator('[data-status-block="whoSees"]').innerText()).toContain(UI_WORDS["reach.private"]);
          await pause(300);
          await screenshot(page, `status-sheet-open-${width}-${theme}`);
          expect(await contrast(page, '[role="dialog"]')).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, '[role="dialog"]')).toEqual([]);
          expect(await clippedLabels(page, '[role="dialog"]')).toEqual([]);
          // Escape closes it, and the focus is back on the chip.
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          await until(page, `(${FOCUSED}) === ${JSON.stringify(REMOVED_CHIP)}`, "the focus back on the chip", 3000);
          // A refused read says so, with Try again, which reads the decision again.
          fixtures.state.refuse.add("decision");
          await chip.click();
          await dialog.getByRole("alert").waitFor({ state: "visible" });
          await pause(300);
          await screenshot(page, `status-sheet-failed-${width}-${theme}`);
          fixtures.state.refuse.delete("decision");
          const again = fixtures.state.requests.length;
          await dialog.getByRole("button", { name: UI_WORDS["error.retry"], exact: true }).click();
          await until(page, `${STATUS_BLOCKS}.length === ${OPEN_ORDER.length}`, "the blocks after Try again");
          expect(fixtures.state.requests.slice(again).map((request) => request.path)).toContain(`/api/moderation/decisions/${POST_DECISION_ID}`);
          // Read the full decision: the sheet closes, then the case opens under Settings, Cases.
          await dialog.getByRole("link", { name: STATUS_SHEET_WORDS["status.readAll"], exact: true }).click();
          await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}"`, "the decision's screen");
          await page.locator("h1").filter({ hasText: CASES_WORDS.title }).waitFor({ state: "visible" });
          await page.getByText(DECISION_WORDS.title, { exact: true }).waitFor({ state: "visible" });
          expect(await page.locator('[role="dialog"]').count()).toBe(0);
          await page.waitForLoadState("networkidle");
          if (theme === "light") await screenshot(page, `decision-${width}-${theme}`);
          await cleanAfterRefusals(visit_);
        } finally {
          fixtures.state.delayMs = 0;
          fixtures.state.refuse.clear();
          await visit_.context.close();
        }
      }
    }
  });

  test("33. the sheet's Appeal opens the decision with ?appeal=1 and the appeal's field focused; Cases' tabs are one tab stop, and Right selects Your reports", async () => {
    for (const [width, height, theme] of [
      [1280, 900, "light"],
      [360, 740, "dark"],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/u/ada");
        await openStatusSheet(page);
        const appeal = page.locator('[role="dialog"] [data-status-appeal]');
        expect(await appeal.innerText()).toBe(STATUS_SHEET_WORDS["status.appeal"]);
        // Its layout height: the dialog's opening scale would shrink the drawn box for a moment.
        expect(await page.evaluate(`document.querySelector('[role="dialog"] [data-status-appeal]').offsetHeight`)).toBeGreaterThanOrEqual(44);
        await appeal.click();
        await until(page, `location.pathname === "/settings/cases/${POST_DECISION_ID}" && new URL(location.href).searchParams.get("appeal") === "1"`, "the decision, its appeal asked for");
        await until(page, fieldFocused(DECISION_WORDS.appealStatement), "the appeal's field focused", 8000);
        await pause(300);
        await screenshot(page, `decision-appeal-${width}-${theme}`);
        await clean(visit_);
        // Cases: two tabs, one tab stop (the selected tab); the arrows choose.
        await visit(page, "/settings/cases");
        const tabs = page.locator('[role="tablist"] [role="tab"]');
        expect(await tabs.count()).toBe(2);
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["0", "-1"]);
        await tabs.first().focus();
        await page.keyboard.press("ArrowRight");
        await until(page, `document.activeElement && document.activeElement.getAttribute("role") === "tab" && document.activeElement.getAttribute("aria-selected") === "true" && document.activeElement.textContent.trim() === ${JSON.stringify(CASES_WORDS.tabs.reports)}`, "Your reports chosen and focused", 3000);
        await page.getByText(CASES_WORDS.noReports).waitFor({ state: "visible" });
        expect(await page.evaluate(`[...document.querySelectorAll('[role="tablist"] [role="tab"]')].map((tab) => tab.getAttribute("tabindex"))`)).toEqual(["-1", "0"]);
        // The panel is named by the chosen tab.
        expect(await page.evaluate(`(() => { const panel = document.querySelector('[role="tabpanel"]'); const tab = panel && document.getElementById(panel.getAttribute("aria-labelledby")); return tab ? tab.textContent.trim() : null; })()`)).toBe(CASES_WORDS.tabs.reports);
        await page.waitForLoadState("networkidle");
        await screenshot(page, `cases-reports-${width}-${theme}`);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("34. under a grid that holds a hidden image, Why are images hidden? is a 44 px link to the rules and the placeholder no control; the terms stand in PublicFrame's 640 px column with its banner and footer", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/u/grace");
          const card = page.locator('[role="article"]').filter({ has: page.locator(`a[href="/post/${HIDDEN_IMAGE_POST_ID}"]`) });
          const link = card.getByRole("link", { name: UI_WORDS["media.whyHidden"], exact: true });
          expect(await link.getAttribute("href")).toBe("/rules");
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          // The placeholder is no control: nothing around its words takes a press or the focus.
          const placeholder = (await page.evaluate(
            `(() => { const words = [...document.querySelectorAll('[role="article"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(HIDDEN_IMAGE_WORDS)}); return words ? { control: !!words.closest('a, button, [role="button"], [role="link"], [tabindex="0"]') } : null; })()`,
          )) as { control: boolean } | null;
          expect(placeholder).toEqual({ control: false });
          await card.scrollIntoViewIfNeeded();
          await pause(300);
          await screenshot(page, `hidden-image-${width}-${theme}`);
          if (width < 768) expect(await phoneProblems(page, '[role="article"]')).toEqual([]);
          await link.click();
          await until(page, `location.pathname === "/rules"`, "the rules page");
          await page.locator("h1").filter({ hasText: RULES_PAGE.title }).waitFor({ state: "visible" });
          await page.waitForLoadState("networkidle");
          await clean(visit_);
          // The terms in the frame: the wordmark's banner, the page's column of 640 px at most, and the footer's links.
          await visit(page, "/terms");
          const frame = (await page.evaluate(
            `(() => { const main = document.querySelector('[role="main"]'); return { banner: !!document.querySelector('[role="banner"]'), footer: !!document.querySelector('[role="contentinfo"]'), shell: !!document.querySelector("[data-layout]"), column: main ? main.offsetWidth : 0, footerAfter: !!main && !!document.querySelector('[role="contentinfo"]') && (main.compareDocumentPosition(document.querySelector('[role="contentinfo"]')) & 4) === 4 }; })()`,
          )) as { banner: boolean; footer: boolean; shell: boolean; column: number; footerAfter: boolean };
          expect(frame).toEqual({ banner: true, footer: true, shell: false, column: width >= 768 ? 640 : width - 32, footerAfter: true });
          await screenshot(page, `terms-${width}-${theme}`);
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }
  });

  // UI Task 8 appends below: the Settings index, Appearance, the theme's cross-fade, the switch rows and Clear.

  /** A radio group of the Appearance page, by the id of the heading that names it. */
  const radioGroup = (id: string) => `[role="radiogroup"][aria-labelledby="${id}"]`;
  /** The html element's theme class, text step and font, as the stylesheet reads them. */
  const HTML_STATE = `(() => { const html = document.documentElement; return { theme: ["light", "dim", "dark"].find((name) => html.classList.contains(name)) || null, step: html.getAttribute("data-text-step"), font: html.getAttribute("data-font") }; })()`;
  /** The appearance this browser keeps, as lib/appearance.ts writes it. */
  const STORED = `JSON.parse(localStorage.getItem("korbat.appearance") || "null")`;

  test("35. the nav's Settings opens the Settings index, current there and on every page below; its eight rows, Appearance first, and no settings row; signed out the nav's Appearance opens Appearance without the row, and /settings goes to sign-in", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    // A client navigation keeps the screen it left mounted, hidden, with a shell of its own: only what is shown counts.
    const currentItem = `[...document.querySelectorAll('nav[aria-label="Main"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`;
    try {
      await visit(page, "/");
      await page.locator('nav[aria-label="Main"] a[href="/settings"]').click();
      await until(page, `location.pathname === "/settings"`, "the Settings index");
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(`document.title`)).toBe(TITLE_WORDS["title.settingsIndex"]);
      expect(await page.locator("h1:visible").innerText()).toBe(UI_WORDS["settings.title"]);
      expect(await page.evaluate(currentItem)).toEqual(["/settings"]);
      expect(await page.evaluate(`[...document.querySelectorAll('[data-screen="settings"] a')].map((link) => link.getAttribute("href"))`)).toEqual([
        "/settings/appearance",
        "/settings/activity", // 2d Task 5: Activity after Appearance (10.8).
        "/settings/security",
        "/settings/privacy",
        "/settings/profile",
        "/settings/account",
        "/settings/import", // 3b Task 7: Import posts after Account (10.1).
        "/settings/cases",
      ]);
      expect(await page.evaluate(`!!document.querySelector('nav[aria-label="Settings"]')`)).toBe(false);
      await screenshot(page, "settings-index-1280-light");
      // The first row opens Appearance, under Settings still, with the row of settings pages and Appearance current in it.
      await page.locator('[data-screen="settings"] a[href="/settings/appearance"]').click();
      await until(page, `location.pathname === "/settings/appearance"`, "Appearance");
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(currentItem)).toEqual(["/settings"]);
      expect(await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/settings/appearance"]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    const out = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme: "light" } });
    try {
      await visit(out.page, "/");
      expect(await out.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Main"] a')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/", "/signin", "/settings/appearance"]);
      await out.page.locator('nav[aria-label="Main"] a[href="/settings/appearance"]').click();
      await until(out.page, `location.pathname === "/settings/appearance"`, "Appearance signed out");
      await out.page.waitForLoadState("networkidle");
      expect(await out.page.locator("h1:visible").innerText()).toBe(UI_WORDS["appearance.title"]);
      expect(await out.page.evaluate(currentItem)).toEqual(["/settings/appearance"]);
      expect(await out.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"]')].some((nav) => nav.getClientRects().length > 0)`)).toBe(false);
      await screenshot(out.page, "appearance-out-1280-light");
      await visit(out.page, "/settings");
      await until(out.page, `location.pathname === "/signin"`, "sign-in in place of the index");
      await clean(out);
    } finally {
      await out.context.close();
    }
  });

  test("36. Appearance: each radio group is one tab stop on its chosen radio; the arrows choose at once; the html element's class, text step and font and the sample follow; the choice is kept, and the next first paint has it", async () => {
    // Nothing kept to begin with: System, on a light system. (A stored appearance given to open() is written again at
    // every load, which would hide what the page kept from the reload below.)
    const visit_ = await open({ width: 1280, height: 900 });
    const page = visit_.page;
    try {
      await visit(page, "/settings/appearance");
      // One tab stop per group: the chosen radio alone has tabindex 0.
      const stops = (await page.evaluate(
        `[...document.querySelectorAll('[role="radiogroup"]')].map((group) => [...group.querySelectorAll('[role="radio"]')].filter((radio) => radio.getAttribute("tabindex") === "0").map((radio) => radio.getAttribute("aria-checked")))`,
      )) as string[][];
      // Theme, Dark style (shown under System), Text size, Font and Reduce motion.
      expect(stops).toEqual([["true"], ["true"], ["true"], ["true"], ["true"]]);
      // The theme: from System, Down chooses Light, Dim and then Dark at once, the focus moving with the choice.
      await page.locator(`${radioGroup("appearance-theme")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `${STORED} !== null && ${STORED}.theme === "light"`, "Light at once");
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.classList.contains("dim")`, "Dim at once");
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.classList.contains("dark")`, "Dark at once");
      expect(await page.evaluate(`document.activeElement.getAttribute("role") + " " + document.activeElement.getAttribute("aria-checked") + " " + document.activeElement.textContent.trim()`)).toBe(
        `radio true ${UI_WORDS["appearance.dark"]}`,
      );
      // The text size: the sample's body grows from 17 px to 19 px as Larger is chosen, and the html element says so.
      const sampleSize = `parseFloat(getComputedStyle([...document.querySelectorAll("[data-sample] *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(UI_WORDS["appearance.sample"])})).fontSize)`;
      expect(await page.evaluate(sampleSize)).toBe(17);
      await page.locator(`${radioGroup("appearance-text-size")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.getAttribute("data-text-step") === "larger"`, "Larger at once");
      await until(page, `${sampleSize} === 19`, "the sample at Larger");
      // The font: Down chooses System font; the sample's face follows.
      await page.locator(`${radioGroup("appearance-font")} [role="radio"][aria-checked="true"]`).focus();
      await page.keyboard.press("ArrowDown");
      await until(page, `document.documentElement.getAttribute("data-font") === "system"`, "System font at once");
      expect(await page.evaluate(`getComputedStyle([...document.querySelectorAll("[data-sample] *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(UI_WORDS["appearance.sample"])})).fontFamily`)).toMatch(/^system-ui/);
      // Tab leaves a group from its chosen radio for the next group's chosen radio: one stop each.
      await page.keyboard.press("Tab");
      expect(await page.evaluate(`document.activeElement.closest('[role="radiogroup"]').getAttribute("aria-labelledby") + " " + document.activeElement.getAttribute("aria-checked")`)).toBe("appearance-motion true");
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "dark", step: "larger", font: "system" });
      expect(await page.evaluate(STORED)).toMatchObject({ theme: "dark", textStep: "larger", font: "system" });
      await pause(400);
      await screenshot(page, "appearance-chosen-1280-dark");
      await clean(visit_);
      // The next first paint, with the bundle held back: theme-boot.js has painted what the page kept.
      site!.state.holdBundle = true;
      const started = Date.now();
      await page.goto(`${origin}/settings/appearance`, { waitUntil: "commit" });
      await until(page, `document.documentElement.classList.contains("dark") && !!document.body`, "the kept theme on the first paint");
      const first = (await page.evaluate(`({ state: ${HTML_STATE}, background: getComputedStyle(document.documentElement).backgroundColor, drawn: document.getElementById("root") ? document.getElementById("root").childElementCount : -1 })`)) as {
        state: unknown;
        background: string;
        drawn: number;
      };
      expect(Date.now() - started).toBeLessThan(HOLD_MS);
      expect(first).toEqual({ state: { theme: "dark", step: "larger", font: "system" }, background: rgb(THEMES.dark.surface), drawn: 0 });
      site!.state.holdBundle = false;
      await until(page, `document.querySelector("[data-layout]") !== null`, "the app drawn");
      await page.waitForLoadState("networkidle");
      await clean(visit_);
    } finally {
      site!.state.holdBundle = false;
      await visit_.context.close();
    }
  });

  test("37. the theme cross-fades: the class is on the html element while a change fades, 200 ms, or 150 ms under either reduced motion, and gone after; nothing fades on load", async () => {
    for (const [run, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, ...options });
      const page = visit_.page;
      try {
        // Every time the class comes or goes, with the body's transition length while it is there.
        await visit_.context.addInitScript({
          // An init script runs before the html element exists, so it watches the document and reads the html element's records.
          content: `(() => { const seen = []; window.__fades = seen; let on = false; new MutationObserver((records) => { if (!records.some((record) => record.target === document.documentElement)) return; const now = document.documentElement.classList.contains(${JSON.stringify(THEME_FADE.className)}); if (now === on) return; on = now; seen.push({ on: now, at: performance.now(), duration: now && document.body ? getComputedStyle(document.body).transitionDuration : null }); }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true }); })();`,
        });
        await visit(page, "/settings/appearance");
        await pause(600);
        expect(await page.evaluate(`window.__fades.length`), `${run}: on load`).toBe(0);
        await page.locator(`${radioGroup("appearance-theme")} [role="radio"]`).filter({ hasText: UI_WORDS["appearance.dark"] }).click();
        await until(page, `document.documentElement.classList.contains("dark")`, `${run}: Dark`);
        await pause(600);
        const fades = (await page.evaluate(`window.__fades`)) as { on: boolean; at: number; duration: string | null }[];
        const length = run === "moves" ? THEME_FADE.duration : THEME_FADE.reduced;
        expect(fades.map((fade) => [fade.on, fade.duration]), run).toEqual([
          [true, `${length / 1000}s`],
          [false, null],
        ]);
        expect(fades[1]!.at - fades[0]!.at, run).toBeGreaterThanOrEqual(length);
        expect(await page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)).toBe(rgb(THEMES.dark.surface));
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("38. the Reading switches: Tab reaches each, the row draws the 2 px ring in the focus colour in Light and Dark, and Space flips it; Hide counts hides like and repost counts on Home and the follower counts on a profile; the web has no Haptics row", async () => {
    const READING = [UI_WORDS["appearance.autoLoad"], UI_WORDS["appearance.openNewest"], UI_WORDS["appearance.hideCounts"]];
    for (const theme of ["light", "dark"] as const) {
      // System, with the system's scheme choosing Light or Dark: a stored appearance given to open() would be written
      // again at every load, over the Hide counts this step turns on before it opens Home and a profile.
      const visit_ = await open({ width: 1280, height: 900, colorScheme: theme });
      const page = visit_.page;
      try {
        await visit(page, "/settings/appearance");
        expect(await page.evaluate(`document.documentElement.classList.contains(${JSON.stringify(theme)})`)).toBe(true);
        expect(await page.evaluate(`[...document.querySelectorAll('input[role="switch"]')].map((input) => input.getAttribute("aria-label"))`)).toEqual(READING);
        // From the switch before it, Tab reaches Hide counts: the switch is the row's one stop, and the row draws the ring.
        await page.locator(`input[role="switch"][aria-label="${READING[1]}"]`).focus();
        await page.keyboard.press("Tab");
        expect(await page.evaluate(`document.activeElement.getAttribute("aria-label")`)).toBe(READING[2]);
        const ring = (await page.evaluate(
          `(() => { for (let node = document.activeElement.parentElement; node; node = node.parentElement) { const s = getComputedStyle(node); if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, height: node.getBoundingClientRect().height }; } return null; })()`,
        )) as { style: string; width: number; color: string; height: number } | null;
        expect(ring, theme).not.toBeNull();
        expect(ring!.width, theme).toBeGreaterThanOrEqual(2);
        expect(ring!.color, theme).toBe(rgb(THEMES[theme].focus));
        expect(ring!.height, theme).toBeGreaterThanOrEqual(52);
        await screenshot(page, `appearance-switch-focus-1280-${theme}`);
        await page.keyboard.press("Space");
        await until(page, `document.activeElement.checked === true`, "Hide counts on");
        expect(await page.evaluate(STORED)).toMatchObject({ hideCounts: true });
        await clean(visit_);
        if (theme === "light") {
          // Home: every Like and Repost is named without its number, and no number shows beside them.
          await visit(page, "/");
          const actions = (await page.evaluate(
            `[...document.querySelectorAll('[role="article"] [aria-label^="Like"], [role="article"] [aria-label^="Repost"]')].map((button) => ({ name: button.getAttribute("aria-label"), text: button.textContent.trim() }))`,
          )) as { name: string; text: string }[];
          expect(actions.length).toBeGreaterThan(0);
          for (const action of actions) {
            expect([UI_WORDS["post.like.none"], UI_WORDS["post.reposts.none"]], action.name).toContain(action.name);
            expect(action.text, action.name).not.toMatch(/[0-9]/);
          }
          await clean(visit_);
          // A profile: Followers and Following are links that read their word alone.
          await visit(page, "/u/grace");
          expect(await page.evaluate(`[...document.querySelectorAll('a[href="/u/grace/followers"], a[href="/u/grace/following"]')].map((link) => link.textContent.trim())`)).toEqual([
            UI_WORDS["profile.followers.hidden"],
            UI_WORDS["profile.following.hidden"],
          ]);
          await clean(visit_);
        }
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("39. Clear what this device keeps: with an appearance, a reading place and a draft kept, it removes the three, keeps the device id and Not now, the theme returns to System, and the toast says Cleared", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark", textStep: "larger" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/appearance");
      // A reading place and a draft as Home and the composer keep them, and the browser's own two.
      await page.evaluate(
        `(() => { localStorage.setItem("korbat.place.${ADA.id}", JSON.stringify({ latest: { newest: { key: "p", time: new Date().toISOString() }, top: { key: "p", time: new Date().toISOString() }, savedAt: Date.now() } })); localStorage.setItem("korbat.drafts.${ADA.id}", JSON.stringify({ post: "Words worth keeping" })); localStorage.setItem("korbat.deviceId", "walk-device"); localStorage.setItem("korbat.passkeySuggestion.dismissedAt", String(Date.now())); })()`,
      );
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "dark", step: "larger", font: "korbat" });
      await page.getByRole("button", { name: UI_WORDS["device.clear"], exact: true }).click();
      await page.getByText(UI_WORDS["toast.cleared"], { exact: true }).waitFor({ state: "visible" });
      expect(((await page.evaluate(`Object.keys(localStorage)`)) as string[]).sort()).toEqual(["korbat.deviceId", "korbat.passkeySuggestion.dismissedAt"]);
      // System on a light system: Light, at the default step, with System chosen on the page.
      await until(page, `document.documentElement.classList.contains("light")`, "System again");
      expect(await page.evaluate(HTML_STATE)).toEqual({ theme: "light", step: "default", font: "korbat" });
      expect(await page.locator(`${radioGroup("appearance-theme")} [role="radio"][aria-checked="true"]`).innerText()).toBe(UI_WORDS["appearance.system"]);
      await pause(400);
      await screenshot(page, "appearance-cleared-1280");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  /**
   * UI Task 10's walk-through found the rail's Bookmarks, and signed out its Appearance, broken inside the word at 768 px
   * at the Default text ("Bookmark" over "s"): the label may break rather than clip (section 1.5), so the clipped-label
   * rule passes it, but a word cut in two is no label. Only the extreme sizes of step 11 may break one.
   */
  test("40. the nav's labels stay whole: at Default and Larger text each item's label is one line, in the tab bar at 360, the rail at 768 and the full nav at 1280, signed in and signed out", async () => {
    // Each label of the nav as its lines: the text of every item, and how many lines its words take as drawn.
    const LABEL_LINES = `[...document.querySelectorAll('nav[aria-label="Main"] a, nav[aria-label="Main"] [role="button"]')].map((item) => {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const tops = new Set();
      const words = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim() === "") continue;
        // Words clipped to 1 px for a screen reader alone are no drawn label.
        const box = node.parentElement.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;
        words.push(node.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return { label: words.join(" "), lines: tops.size };
    }).filter((item) => item.label !== "")`;
    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      for (const textStep of ["default", "larger"] as const) {
        for (const signedIn of [true, false]) {
          const visit_ = await open({ width, height, signedIn, appearance: { theme: "light", textStep } });
          try {
            // Signed out the nav holds Home, Sign in and Appearance, which is the longest label there.
            await visit(visit_.page, signedIn ? "/bookmarks" : "/settings/appearance");
            const labels = (await visit_.page.evaluate(LABEL_LINES)) as { label: string; lines: number }[];
            expect(labels.length, `${width} ${textStep}`).toBeGreaterThanOrEqual(signedIn ? 4 : 3);
            expect(labels.filter((item) => item.lines !== 1), `${width} px, ${textStep}, ${signedIn ? "signed in" : "signed out"}`).toEqual([]);
            await clean(visit_);
          } finally {
            await visit_.context.close();
          }
        }
      }
    }
  });

  // 3b Task 7 appends below: the import's screens, the provenance label and the Imported tab (3b design, sections 10.8 and 12.4).

  /** One import's screen. */
  const importAt = (importId: string) => `/settings/import/${importId}`;
  /** The level-2 headings shown in the main column, in order: a client navigation keeps the screen it left, hidden. */
  const SHOWN_H2 = `[...document.querySelectorAll('main h2')].filter((h) => h.getClientRects().length > 0).map((h) => h.textContent.trim())`;
  /** What the page's polite status regions say now, joined. */
  const STATUSES = `[...document.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(" | ")`;
  /** How far the page reaches past the window's right edge. */
  const SIDEWAYS = `document.documentElement.scrollWidth - document.documentElement.clientWidth`;
  /** The focused element's role, name and words, and the ring drawn for it: its own outline, or its row's for a switch. */
  const FOCUS_RING_NOW = `(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return null;
    let ring = null;
    for (let node = e, up = 0; node && up < 4 && !ring; node = node.parentElement, up++) {
      const s = getComputedStyle(node);
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 && s.outlineColor !== "rgba(0, 0, 0, 0)") ring = parseFloat(s.outlineWidth);
    }
    return { role: e.getAttribute("role") || e.tagName.toLowerCase(), name: (e.getAttribute("aria-label") || e.textContent || "").trim(), disabled: e.getAttribute("aria-disabled"), ring };
  })()`;

  /** A generated archive of `size` bytes, a zip's local header first, every other byte from its place. */
  function generatedArchive(size: number): Buffer {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
    bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
    return bytes;
  }

  /** Chooses a file through the browser's file picker, which Choose your archive opens. */
  async function chooseFile(page: Page, name: string, buffer: Buffer): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: IMPORT_WORDS["import.choose"] }).click();
    await (await chooser).setFiles({ name, mimeType: name.endsWith(".zip") ? "application/zip" : "application/gzip", buffer });
  }

  /** Forgets the picks a step made in the ready import's list, so the next step reads the preview as the fixture gives it. */
  const forgetPicks = () => fixtures.state.imports.picks.clear();

  /** Opens the preview, chooses a range, brings images, opens See every post, leaves the first post out and ticks the statement. */
  async function choosePreview(page: Page): Promise<void> {
    await visit(page, importAt(IMPORT_READY));
    await page.getByRole("radio", { name: IMPORT_WORDS["import.choose.range"] }).click();
    await page.getByRole("button", { name: IMPORT_WORDS["import.choose.from"] }).waitFor();
    // The switch takes no pointer of its own: its row flips it (UI design, section 6.11).
    await page.getByText(IMPORT_WORDS["import.choose.images"], { exact: true }).click();
    await page.getByRole("button", { name: IMPORT_WORDS["import.seeAll"] }).click();
    await page.getByRole("checkbox", { name: IMPORT_WORDS["import.list.leaveOut"] }).first().click();
    await until(page, `document.querySelectorAll('[role="checkbox"][aria-checked="true"]').length === 1`, "the post left out");
    await page.getByRole("checkbox", { name: IMPORT_WORDS["import.statement"] }).click();
    await page.waitForLoadState("networkidle");
    await pause(300);
  }

  /** Opens the done import's Remove sheet and waits until it is open and its fade has ended. */
  async function openRemove(page: Page): Promise<void> {
    await visit(page, importAt(IMPORT_DONE));
    await page.getByRole("button", { name: IMPORT_WORDS["import.remove"] }).click();
    await until(page, `${DIALOG_NAME} === ${JSON.stringify(fill(IMPORT_WORDS["import.remove.ask"], { n: "1,240" }))}`, "the Remove sheet");
    await pause(500);
  }

  test("41. the import's screens at 360, 768 and 1280 in Dark: the start with a source chosen, the preview with a range, a post left out and the statement ticked, the progress, the result and the Remove sheet; nothing scrolls sideways, no label is cut, every control 44 px at 360", async () => {
    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme: "dark" } });
      const page = visit_.page;
      const check = async (name: string, scope = ALL) => {
        expect(await page.evaluate(SIDEWAYS), `${width} ${name}`).toBeLessThanOrEqual(0);
        expect(await clippedLabels(page, scope), `${width} ${name}`).toEqual([]);
        if (width < 768) expect(await phoneProblems(page, scope), `${width} ${name}`).toEqual([]);
        await screenshot(page, `import-${width}-dark-${name}`);
      };
      try {
        await visit(page, "/settings/import");
        expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.import"]);
        expect(await page.locator("h1:visible").innerText()).toBe(IMPORT_WORDS["import.title"]);
        await page.getByRole("radio", { name: IMPORT_WORDS["import.source.mastodon"] }).click();
        await page.getByText(IMPORT_WORDS["import.never.mastodon"]).waitFor();
        await check("start");
        await choosePreview(page);
        expect(await page.evaluate(SHOWN_H2)).toEqual([IMPORT_WORDS["import.found.title"], IMPORT_WORDS["import.left.title"], IMPORT_WORDS["import.choose.title"], IMPORT_WORDS["import.confirm.title"]]);
        expect(await page.locator('[role="button"][aria-disabled="true"]').count()).toBe(0);
        await check("preview");
        await visit(page, importAt(IMPORT_PUBLISHING));
        await check("progress");
        await visit(page, importAt(IMPORT_DONE));
        await check("result");
        await openRemove(page);
        await check("remove-sheet", '[role="dialog"]');
        await page.keyboard.press("Escape");
        await page.locator('[role="dialog"]').waitFor({ state: "detached" });
        await clean(visit_);
      } finally {
        forgetPicks();
        await visit_.context.close();
      }
    }
  });

  for (const [step, theme] of [
    [42, "light"],
    [43, "dim"],
    [44, "dark"],
  ] as const) {
    test(`${step}. contrast as drawn in ${theme}: the preview, the Remove sheet and a profile's Imported tab`, async () => {
      const visit_ = await open({ width: 1280, height: 900, appearance: { theme } });
      const page = visit_.page;
      try {
        await choosePreview(page);
        expect(await contrast(page, ALL), `${theme} the preview`).toEqual([]);
        await openRemove(page);
        expect(await contrast(page, '[role="dialog"]'), `${theme} the Remove sheet`).toEqual([]);
        await page.keyboard.press("Escape");
        await visit(page, "/u/grace?tab=imported");
        await page.getByText("Imported from X, dated 3 Mar 2019").waitFor();
        expect(await contrast(page, DRAWN), `${theme} the Imported tab`).toEqual([]);
        await screenshot(page, `import-contrast-${theme}-imported-tab`);
        await clean(visit_);
      } finally {
        forgetPicks();
        await visit_.context.close();
      }
    });
  }

  test("45. at 320 by 640 with Largest text and the root at 200 percent, the preview and the Remove sheet scroll no sideways and cut no label", async () => {
    const visit_ = await open({ width: 320, height: 640, appearance: { theme: "light", textStep: "largest" } });
    const page = visit_.page;
    try {
      await choosePreview(page);
      await page.evaluate(`document.documentElement.style.fontSize = "200%"`);
      await pause(300);
      expect(await page.evaluate(SIDEWAYS), "the preview").toBeLessThanOrEqual(0);
      expect(await clippedLabels(page, ALL), "the preview").toEqual([]);
      await screenshot(page, "largest-320-import-preview");
      await openRemove(page);
      await page.evaluate(`document.documentElement.style.fontSize = "200%"`);
      await pause(300);
      expect(await page.evaluate(SIDEWAYS), "the Remove sheet").toBeLessThanOrEqual(0);
      expect(await clippedLabels(page, '[role="dialog"]'), "the Remove sheet").toEqual([]);
      await screenshot(page, "largest-320-import-remove");
      await clean(visit_);
    } finally {
      forgetPicks();
      await visit_.context.close();
    }
  });

  test("46. reading: the spinner turns; under the system's reduced motion and korbat's own, the import icon stands still in its place", async () => {
    for (const [name, options] of MOTION_RUNS) {
      const visit_ = await open({ width: 1280, height: 900, ...options });
      const page = visit_.page;
      try {
        await visit(page, importAt(IMPORT_SCANNING));
        await page.getByText(IMPORT_WORDS["import.reading"]).first().waitFor();
        const still = await page.locator('[data-reading="still"]').count();
        const spin = await page.locator('[data-reading="spin"]').count();
        const frames = await sampleFrames(page, `document.querySelector('[data-reading]')`, "transform", 400);
        if (name === "moves") {
          expect([still, spin], name).toEqual([0, 1]);
          expect(transformed(frames), name).toBe(true);
        } else {
          expect([still, spin], name).toEqual([1, 0]);
          expect(transformed(frames), name).toBe(false);
        }
        await screenshot(page, `import-reading-${name}`);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("47. the preview by keyboard alone: every control in order, each with its ring; Publish is reached while aria-disabled, and Enter on it moves the focus to the statement", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "dark" } });
    const page = visit_.page;
    try {
      await visit(page, importAt(IMPORT_READY));
      await page.locator("main h2").first().focus();
      type Stop = { role: string; name: string; disabled: string | null; ring: number | null };
      const stops: Stop[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const stop = (await page.evaluate(FOCUS_RING_NOW)) as Stop | null;
        if (stop === null) continue;
        stops.push(stop);
        expect(stop.ring, JSON.stringify(stop)).toBeGreaterThanOrEqual(2);
        if (stop.name.startsWith(IMPORT_WORDS["import.publish"].split(" ")[0]!) && stop.disabled === "true") break;
      }
      const names = stops.map((stop) => stop.name);
      const order = [
        IMPORT_WORDS["import.seeAll"],
        IMPORT_WORDS["import.choose.all"],
        IMPORT_WORDS["import.choose.replies"],
        IMPORT_WORDS["import.choose.warnings"],
        IMPORT_WORDS["import.choose.images"],
        IMPORT_WORDS["import.choose.long.leave"],
        IMPORT_WORDS["import.rules.link"],
        IMPORT_WORDS["import.statement"],
      ];
      const at = order.map((name) => names.findIndex((found) => found.startsWith(name)));
      expect(at.every((index) => index >= 0), JSON.stringify(names)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      const publish = stops.at(-1)!;
      expect(publish.disabled).toBe("true");
      expect(publish.name).toBe(fill(IMPORT_WORDS["import.publish"], { n: "60" }));
      await screenshot(page, "import-keyboard-publish");
      await page.keyboard.press("Enter");
      await until(page, `document.activeElement && document.activeElement.getAttribute("role") === "checkbox"`, "the statement focused");
      expect(((await page.evaluate(FOCUS_RING_NOW)) as Stop).name).toBe(IMPORT_WORDS["import.statement"]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("48. a change of state while the screen is open: reading turns ready, its sentence is said politely, and the focus, whose button left with the old view, goes to the new heading", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, importAt(IMPORT_SCANNING));
      await page.getByRole("button", { name: IMPORT_WORDS["import.cancel"] }).focus();
      fixtures.state.imports.scanReady = true;
      // The screen reads the import every 3 s while the page is visible.
      await until(page, `${SHOWN_H2}[0] === ${JSON.stringify(IMPORT_WORDS["import.found.title"])}`, "the preview", 15_000);
      await until(page, `document.activeElement && document.activeElement.tagName === "H2"`, "the new heading focused", 3_000);
      expect(await page.evaluate(`document.activeElement.textContent.trim()`)).toBe(IMPORT_WORDS["import.found.title"]);
      expect(await page.evaluate(STATUSES)).toContain(IMPORT_WORDS["import.now.ready"]);
      await screenshot(page, "import-state-change");
      await clean(visit_);
    } finally {
      fixtures.state.imports.scanReady = false;
      await visit_.context.close();
    }
  });

  test("49. the progress bars carry their four values and their value text: publishing, and preparing with its two phases", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    const BARS = `[...document.querySelectorAll('main [role="progressbar"]')].filter((b) => b.getClientRects().length > 0).map((b) => [b.getAttribute("aria-valuemin"), b.getAttribute("aria-valuemax"), b.getAttribute("aria-valuenow"), b.getAttribute("aria-valuetext")])`;
    try {
      await visit(page, importAt(IMPORT_PUBLISHING));
      expect(await page.evaluate(BARS)).toEqual([["0", "100", "65", fill(IMPORT_WORDS["import.publishing"], { done: "800", total: "1,240" })]]);
      await visit(page, importAt("00000000-0000-4000-8000-000000000804"));
      expect(await page.evaluate(BARS)).toEqual([
        ["0", "100", "28", fill(IMPORT_WORDS["import.preparing"], { done: "340", total: "1,200" })],
        ["0", "100", "0", fill(IMPORT_WORDS["import.publishing"], { done: "0", total: "1,240" })],
      ]);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("50. the Imported tab: ?tab=imported opens it; the label is a 44 px button that opens Who sees this at the provenance; @ada is no link; the post's links are nofollow ugc; at 360 nothing scrolls sideways and no label is cut", async () => {
    for (const [width, height] of [
      [360, 740],
      [1280, 900],
    ] as const) {
      const visit_ = await open({ width, height, appearance: { theme: "light" } });
      const page = visit_.page;
      try {
        await visit(page, "/u/grace?tab=imported");
        const label = page.getByRole("button", { name: "Imported from X, dated 3 March 2019. About imported posts" });
        await label.waitFor();
        expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(IMPORT_WORDS["import.tab"]);
        expect(await label.innerText()).toBe("Imported from X, dated 3 Mar 2019");
        expect(await page.getByText(`Imported from Mastodon, dated 20 Nov 2018${IMPORT_WORDS["import.label.shortened"]}`).count()).toBe(1);
        const box = (await label.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(await page.locator('[role="article"] a[href="/u/ada"]').count()).toBe(0);
        expect(await page.locator(`[role="article"] a[href="https://example.org/harbour"]`).getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
        expect(await page.evaluate(SIDEWAYS)).toBeLessThanOrEqual(0);
        expect(await clippedLabels(page, DRAWN)).toEqual([]);
        if (width < 768) expect(await phoneProblems(page, DRAWN)).toEqual([]);
        await screenshot(page, `import-tab-${width}`);
        await label.click();
        await until(page, `${DIALOG_NAME} === ${JSON.stringify(UI_WORDS["post.whoSees"])}`, "Who sees this");
        await until(page, `(document.activeElement && document.activeElement.textContent || "").startsWith("Anyone who searches the words of an imported post")`, "the provenance focused");
        expect(await page.locator('[role="dialog"]').innerText()).toContain(IMPORT_WORDS["import.reach"]);
        await pause(400);
        await screenshot(page, `import-provenance-${width}`);
        await page.keyboard.press("Escape");
        await page.locator('[role="dialog"]').waitFor({ state: "detached" });
        expect(await page.evaluate(FOCUSED)).toBe("Imported from X, dated 3 March 2019. About imported posts");
        // No post of the tab asked for its Explore status: an imported post's is known.
        expect(fixtures.state.requests.some((request) => request.path.startsWith(`/api/posts/${IMPORTED_POST_ID}/explore`))).toBe(false);
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
  });

  test("51. the upload: a .tar.gz is refused before anything is sent; 20 MB go in three chunks against the fixture, one refused and sent again, one whose answer is lost and resumed from the import's stored bytes; a stopped upload asks for the same file", async () => {
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    const imports = fixtures.state.imports;
    imports.chunks = [];
    // The second chunk arrives but its answer is lost, until the app reads the import; the third is refused once (chunk_mismatch).
    imports.dropUntilRead = new Set([IMPORT_RULES.chunkBytes]);
    imports.refuseOnce = new Set([2 * IMPORT_RULES.chunkBytes]);
    // What the API was asked from here on: a retried step starts from its own requests.
    const from = fixtures.state.requests.length;
    const bytes = generatedArchive(ARCHIVE_BYTES);
    try {
      await visit(page, "/settings/import");
      await page.getByRole("radio", { name: IMPORT_WORDS["import.source.mastodon"] }).click();
      await chooseFile(page, "archive.tar.gz", Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]));
      await until(page, `[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes(${JSON.stringify(IMPORT_WORDS["import.tarGz"])}))`, "the .tar.gz sentence");
      expect(fixtures.state.requests.slice(from).some((request) => request.method === "POST" && request.path === "/api/imports")).toBe(false);
      await chooseFile(page, "archive.zip", bytes);
      await page.getByText(fill(IMPORT_WORDS["import.chosen"], { name: "archive.zip", size: "20 MB" })).waitFor();
      // Each chunk's answer waits, so the bar and its value text can be seen while the archive goes in.
      fixtures.state.delayMs = 400;
      await page.getByRole("button", { name: IMPORT_WORDS["import.start"] }).click();
      await until(page, `location.pathname === ${JSON.stringify(importAt(IMPORT_NEW))}`, "the import's screen");
      await until(page, `!!document.querySelector('[role="progressbar"][aria-label=${JSON.stringify(IMPORT_WORDS["import.bar.upload"])}][aria-valuetext$="of 20 MB"]')`, "the upload's value text", 20_000);
      await screenshot(page, "import-uploading");
      await until(page, `${SHOWN_H2}[0] === ${JSON.stringify(IMPORT_WORDS["import.state.scanning"])}`, "reading the archive", 60_000);
      fixtures.state.delayMs = 0;
      // Chromium itself tries a PUT again once when a reused connection closes without an answer: tries lost in a row count once.
      const tries = imports.chunks.map((chunk) => [chunk.offset, chunk.length, chunk.answer]).filter((chunk, index, all) => !(chunk[2] === 0 && index > 0 && all[index - 1]![2] === 0 && all[index - 1]![0] === chunk[0]));
      expect(tries).toEqual([
        [0, IMPORT_RULES.chunkBytes, 200],
        [IMPORT_RULES.chunkBytes, IMPORT_RULES.chunkBytes, 0],
        [2 * IMPORT_RULES.chunkBytes, ARCHIVE_BYTES - 2 * IMPORT_RULES.chunkBytes, 400],
        [2 * IMPORT_RULES.chunkBytes, ARCHIVE_BYTES - 2 * IMPORT_RULES.chunkBytes, 200],
      ]);
      // After the lost answer the app read the import before it sent more: a GET between the second and the third PUT.
      const asked = fixtures.state.requests.slice(from).map((request) => `${request.method} ${request.path}`).filter((line) => line.includes(IMPORT_NEW));
      const puts = asked.flatMap((line, index) => (line === `PUT /api/imports/${IMPORT_NEW}/archive` ? [index] : []));
      // The fixture answers no try of the lost chunk until the import is read, so the chunks after it came after a read.
      expect(asked.slice(puts[1]! + 1, puts.at(-1)!)).toContain(`GET /api/imports/${IMPORT_NEW}`);
      expect(createHash("sha256").update(imports.archive).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
      // The refused chunk and the lost connection are what the fixture did on purpose; nothing else is reported.
      expect(visit_.watcher.take().filter((line) => !/status of 400|ERR_EMPTY_RESPONSE|ERR_CONNECTION|\/archive/.test(line))).toEqual([]);
      expect(fixtures.state.problems.splice(0)).toEqual([]);
      // An upload stopped elsewhere, with no file in hand: where it stopped, and only a file of the same size goes on.
      await visit(page, importAt(IMPORT_RESUME));
      await page.getByText(fill(IMPORT_WORDS["import.resume"], { done: "8.4 MB", total: "20 MB" })).waitFor();
      await chooseFile(page, "other.zip", generatedArchive(1000));
      await until(page, `[...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.includes(${JSON.stringify(IMPORT_WORDS["import.wrongFile"])}))`, "the size check");
      await screenshot(page, "import-resume");
      await clean(visit_);
    } finally {
      fixtures.state.delayMs = 0;
      imports.dropUntilRead.clear();
      imports.refuseOnce.clear();
      await visit_.context.close();
    }
  });

  // 2d Task 5 (2d design, section 10.9) appends steps 52 to 57 below, so the steps above keep their numbers.

  /** Activity's state as the fixture starts it: two entries new against the stored marker, nothing newer, the defaults. */
  const resetActivity = () => {
    fixtures.state.activity = { seenAt: ACTIVITY_SEEN, seen: [], newer: 0, fresh: 0, settings: { ...ACTIVITY_DEFAULTS }, saves: [] };
  };
  /** The names of the shown articles of the main column, in order. */
  const ARTICLE_NAMES = `[...document.querySelectorAll('main [role="article"][aria-label]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`;
  /** The shown h2s of the main column, in order. */
  const H2S = `[...document.querySelectorAll("main h2")].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent)`;
  /** The aria-label of the focused element, and the key of the list row it is in. */
  const FOCUSED_NAME = `document.activeElement ? document.activeElement.getAttribute("aria-label") : null`;
  const FOCUSED_ROW = `(() => { const row = document.activeElement && document.activeElement.closest("[data-row]"); return row ? row.getAttribute("data-row") : null; })()`;
  /** A fixture entry's id, as fixture-api.ts numbers them. */
  const entryId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  test("52. Activity at 360, 768 and 1280 in Light, Dim and Dark: its tabs, headings and rows, each entry's name, the seen marker, the pill and the focus after it and after Load more, a follow group's three links; no other route asks for Activity and nothing on the nav or in the title changes; at 360 Settings is reached from the profile", async () => {
    // No route but Activity asks for it: Home, Bookmarks, a profile and Settings, each left open past a poll's wait.
    const quiet = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    try {
      await quiet.page.clock.install();
      const from = fixtures.state.requests.length;
      for (const route of ["/", "/bookmarks", "/u/ada", "/settings", "/post/" + POST_ID]) {
        await visit(quiet.page, route);
        await quiet.page.clock.fastForward(95_000);
        await pause(200);
      }
      expect(fixtures.state.requests.slice(from).filter((request) => request.path.startsWith("/api/activity"))).toEqual([]);
      await clean(quiet);
    } finally {
      await quiet.context.close();
    }

    for (const [width, height] of [
      [360, 740],
      [768, 1024],
      [1280, 900],
    ] as const) {
      for (const theme of ["light", "dim", "dark"] as const) {
        resetActivity();
        const visit_ = await open({ width, height, appearance: { theme } });
        const page = visit_.page;
        try {
          await visit(page, "/activity");
          await page.locator('main [role="article"]').first().waitFor();
          expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.activity"]);
          expect(await page.locator("h1:visible").innerText()).toBe(ACTIVITY_WORDS["activity.title"]);
          expect(await page.locator('[role="tablist"]:visible').getAttribute("aria-label")).toBe(ACTIVITY_WORDS["activity.tabs"]);
          expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(ACTIVITY_WORDS["activity.tab.all"]);
          // The two new entries first, under "New since you last looked", then "Earlier"; each article named by its line and time.
          expect(await page.evaluate(H2S)).toEqual([ACTIVITY_WORDS["activity.divider"], ACTIVITY_WORDS["activity.earlier"]]);
          const names = (await page.evaluate(ARTICLE_NAMES)) as string[];
          expect(names.slice(0, 2).every((name) => name.startsWith("New, "))).toBe(true);
          // The times are the fixtures' (minutes before the walk started), so only the words before them are pinned here.
          expect(names[0]).toMatch(/^New, Grace Hopper replied to your post, [0-9]+[mhd] ago$/);
          expect(names[1]).toMatch(/^New, Linus mentioned you, [0-9]+[mhd] ago$/);
          expect(names[2]).toMatch(/^Grace Hopper and 4 others followed you, [0-9]+[mhd] ago$/);
          expect(names.slice(2).some((name) => name.startsWith("New, "))).toBe(false);
          // The marker went once, with the newest entry's time to the microsecond.
          await expect.poll(() => fixtures.state.activity.seen.length).toBe(1);
          expect(fixtures.state.activity.seen[0]! > ACTIVITY_SEEN).toBe(true);
          expect(fixtures.state.activity.seen[0]).toMatch(/[.][0-9]{6}Z$/);
          // The nav's Activity item is its label alone, and the title names no count.
          expect(await page.locator('nav[aria-label="Main"] a[href="/activity"]').innerText()).toBe(UI_WORDS["nav.activity"]);
          expect(await page.evaluate(SIDEWAYS)).toBeLessThanOrEqual(0);
          expect(await clippedLabels(page, ALL)).toEqual([]);
          if (width < 768) expect(await phoneProblems(page, ALL)).toEqual([]);
          expect(await contrast(page, "main")).toEqual([]);
          await screenshot(page, `activity-${width}-${theme}`);
          await clean(visit_);
        } finally {
          await visit_.context.close();
        }
      }
    }

    // At 1280: the follow group's links, Conversations in the address, Load more and the pill with the focus after each.
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await page.clock.install();
      await visit(page, "/activity");
      const group = page.locator('main [role="article"][aria-label^="Grace Hopper and 4 others"]');
      await group.waitFor();
      expect(await group.locator("a").evaluateAll((links) => links.map((link) => [link.getAttribute("aria-label") || link.textContent, link.getAttribute("href")]))).toEqual([
        ["Grace Hopper", "/u/grace"],
        ["Linus", "/u/linus"],
        ["Mary Somerville", "/u/mary"],
        [ACTIVITY_WORDS["activity.follow.all"], "/u/ada/followers"],
      ]);
      // Each of them a 44 px target; the pictures are the fixture's squares, drawn.
      for (const box of await group.locator("a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
      await until(page, `[...document.querySelectorAll('main [role="article"] img')].some((img) => img.complete && img.naturalWidth === 128)`, "an avatar drawn");
      // A post entry's one action is Reply, which opens the thread with its reply card.
      const reply = page.locator(`main [role="article"][aria-label^="New, Grace Hopper replied"]`);
      const actions = (await reply.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))) as string[];
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatch(/^Reply/);
      // Load more, at the end of the first page: the focus goes to the first entry it brought, the 31st, an older reply.
      const loadMore = page.getByRole("button", { name: UI_WORDS["feed.loadMore"] });
      // The list draws its rows in batches as it scrolls: on a loaded machine the end can take a while to come into the window.
      for (let i = 0; i < 60 && (await loadMore.count()) === 0; i++) {
        await scrollList(page, 100_000);
        await pause(400);
      }
      await loadMore.click();
      await until(page, `${FOCUSED_ROW} === "e:${entryId(1340)}"`, "the first entry Load more brought focused");
      expect(await page.evaluate(FOCUSED_NAME)).toMatch(/^Grace Hopper replied to your post, /);
      await page.getByText(fill(ACTIVITY_WORDS["activity.end"], { days: 90 })).waitFor();
      // The pill: three newer entries after the poll's 30 s; the nav and the title stay as they are.
      fixtures.state.activity.newer = 3;
      fixtures.state.activity.fresh = 3;
      const navBefore = await page.locator('nav[aria-label="Main"]').innerText();
      await page.clock.fastForward(31_000);
      const pill = page.locator("[data-pill]");
      await pill.waitFor({ state: "visible" });
      expect(await pill.innerText()).toBe("3 new");
      expect(await pill.getAttribute("aria-label")).toBe("3 new above, go to the first one");
      expect(await page.locator('nav[aria-label="Main"]').innerText()).toBe(navBefore);
      expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.activity"]);
      expect(fixtures.state.requests.some((request) => request.path.startsWith("/api/activity/newer?tab=all&since="))).toBe(true);
      await pause(400);
      await screenshot(page, "activity-pill-1280-light");
      await pill.click();
      // The first page again at the top, the newest of the three first, and the focus on it.
      await until(page, `${FOCUSED_ROW} === "e:${entryId(1383)}"`, "the first entry of the new first page focused");
      expect(await page.evaluate(FOCUSED_NAME)).toMatch(/^New, Grace Hopper replied to your post, /);
      expect(fixtures.state.activity.seen.length).toBe(2);
      // Conversations keeps replies, mentions and quotes, and stays in the address.
      await page.getByRole("tab", { name: ACTIVITY_WORDS["activity.tab.conversations"] }).click();
      await until(page, `location.search === "?tab=conversations"`, "the tab in the address");
      await page.reload();
      await page.locator('main [role="article"]').first().waitFor();
      expect(await page.locator('[role="tab"][aria-selected="true"]:visible').innerText()).toBe(ACTIVITY_WORDS["activity.tab.conversations"]);
      expect(((await page.evaluate(ARTICLE_NAMES)) as string[]).some((name) => name.includes("followed you") || name.includes("decision"))).toBe(false);
      await clean(visit_);
    } finally {
      fixtures.state.activity.newer = 0;
      fixtures.state.activity.fresh = 0;
      await visit_.context.close();
    }

    // At 360 the tab bar has four items, and Settings is the profile's button, found by its name.
    const phone = await open({ width: 360, height: 740, appearance: { theme: "light" } });
    try {
      await visit(phone.page, "/u/ada");
      expect(await phone.page.evaluate(`[...document.querySelectorAll('nav[aria-label="Main"] a')].map((link) => link.getAttribute("href"))`)).toEqual(["/", "/activity", "/bookmarks", "/u/ada"]);
      await phone.page.getByRole("button", { name: UI_WORDS["profile.settings"], exact: true }).click();
      await until(phone.page, `location.pathname === "/settings"`, "the Settings index from the profile");
      await phone.page.waitForLoadState("networkidle");
      expect(await phone.page.locator("h1:visible").innerText()).toBe(UI_WORDS["settings.title"]);
      await clean(phone);
    } finally {
      await phone.context.close();
    }
  });

  test("53. Settings, Activity: four radio groups by keyboard, each one tab stop; arrowing across a group sends one request, with one toast, once it is still or the focus leaves it", async () => {
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/activity");
      await page.getByRole("radiogroup").first().waitFor();
      expect(await page.evaluate("document.title")).toBe(TITLE_WORDS["title.settingsActivity"]);
      expect(await page.getByRole("radiogroup").count()).toBe(4);
      // The settings row marks Activity current.
      expect(await page.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings"] a[aria-current="page"]')].filter((link) => link.getClientRects().length > 0).map((link) => link.getAttribute("href"))`)).toEqual(["/settings/activity"]);
      const replies = page.getByRole("radiogroup", { name: ACTIVITY_SETTINGS_WORDS.replies });
      await replies.getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.everyone }).focus();
      // Three arrows across the group: the choice moves at once, and one request goes when it has been still for 800 ms.
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
      expect(await replies.getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.off }).getAttribute("aria-checked")).toBe("true");
      expect(fixtures.state.activity.saves).toEqual([]);
      await until(page, `document.querySelectorAll("[data-sonner-toast]").length > 0`, "the toast", 5000);
      expect(fixtures.state.activity.saves).toEqual([{ ...ACTIVITY_DEFAULTS, replies: "off" }]);
      expect(await page.locator("[data-sonner-toast]").last().innerText()).toBe(ACTIVITY_SETTINGS_WORDS.saved);
      // One arrow in the follows group, then Tab away at once: saved as the focus leaves, still one request.
      await page.getByRole("radiogroup", { name: ACTIVITY_SETTINGS_WORDS.follows }).getByRole("radio", { name: ACTIVITY_SETTINGS_WORDS.on }).focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect.poll(() => fixtures.state.activity.saves.length, { timeout: 500 }).toBe(2);
      expect(fixtures.state.activity.saves).toEqual([
        { ...ACTIVITY_DEFAULTS, replies: "off" },
        { ...ACTIVITY_DEFAULTS, replies: "off", follows: false },
      ]);
      expect(await clippedLabels(page, ALL)).toEqual([]);
      await screenshot(page, "settings-activity-1280-light");
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    for (const theme of ["light", "dark"] as const) {
      const narrow = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(narrow.page, "/settings/activity");
        await narrow.page.getByRole("radiogroup").first().waitFor();
        expect(await clippedLabels(narrow.page, ALL)).toEqual([]);
        expect(await phoneProblems(narrow.page, ALL)).toEqual([]);
        expect(await contrast(narrow.page, "main")).toEqual([]);
        await screenshot(narrow.page, `settings-activity-360-${theme}`);
        await clean(narrow);
      } finally {
        await narrow.context.close();
      }
    }
  });

  /** Picks a file in the browser's file dialog, which `button` opens. */
  async function pickFile(page: Page, button: string, name: string, buffer: Buffer): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: "image/webp", buffer });
  }
  /** A portrait the picker is given: 300 by 600, one colour. */
  const PORTRAIT = solidWebp(300, [0xb4, 0x3c, 0x1e], 600);
  const PREVIEW = `(() => { const img = [...document.querySelectorAll("main img")].find((e) => (e.getAttribute("alt") || "").startsWith(${JSON.stringify(AVATAR_WORDS.preview)})); return img ? { alt: img.getAttribute("alt"), position: getComputedStyle(img).objectPosition, fit: getComputedStyle(img).objectFit } : null; })()`;

  test("54. the avatar picker: a fixture image chosen, its part kept by the preview, uploaded as kind avatar with the crop, the status line, then the header and a post card show it; a refused, a failed and a reset upload as error lines that take the focus; the removal's question; the focus after each", async () => {
    const upload = fixtures.state.upload;
    fixtures.state.avatar = null;
    Object.assign(upload, { outcome: "ready", polls: 0, reset: false, queries: [] });
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/settings/profile");
      await page.getByRole("heading", { name: AVATAR_WORDS.section }).waitFor();
      expect(await page.getByRole("button", { name: AVATAR_WORDS.remove }).count()).toBe(0);
      await pickFile(page, AVATAR_WORDS.choose, "portrait.webp", PORTRAIT);
      // A portrait: Top, Middle and Bottom, Middle first; the preview covers the disc at the part kept, named by it.
      const keep = page.getByRole("radiogroup", { name: AVATAR_WORDS.keep });
      await keep.waitFor();
      expect(await keep.getByRole("radio").allInnerTexts()).toEqual([AVATAR_WORDS.top, AVATAR_WORDS.middle, AVATAR_WORDS.bottom]);
      await until(page, `(${PREVIEW}) && (${PREVIEW}).alt === ${JSON.stringify(fill(AVATAR_WORDS.previewPart, { part: AVATAR_WORDS.middle }))}`, "the preview at Middle");
      await keep.getByRole("radio", { name: AVATAR_WORDS.top }).click();
      await until(page, `(${PREVIEW}).alt === ${JSON.stringify(fill(AVATAR_WORDS.previewPart, { part: AVATAR_WORDS.top }))}`, "the preview at Top");
      const preview = (await page.evaluate(PREVIEW)) as { position: string; fit: string };
      expect(preview.fit).toBe("cover");
      expect(preview.position).toMatch(/^50% 0(%|px)$/);
      await screenshot(page, "avatar-preview-1280-light");
      // Use this picture: the status line says it uploads, then that it is prepared; then the toast and the focus.
      fixtures.state.delayMs = 400;
      await page.getByRole("button", { name: AVATAR_WORDS.use }).click();
      await page.locator('[role="status"]').getByText(AVATAR_WORDS.uploading).waitFor();
      fixtures.state.delayMs = 0;
      await page.locator('[role="status"]').getByText(AVATAR_WORDS.processing).waitFor();
      await page.locator("[data-sonner-toaster]").getByText(AVATAR_WORDS.updated).waitFor({ state: "visible" });
      await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.change)}`, "Choose another picture focused");
      expect(upload.queries).toEqual(["?kind=avatar&crop=start"]);
      // The header (96 px: the large file) and Ada's own post cards (40 px: the small one) show it.
      await visit(page, "/u/ada");
      await until(page, `[...document.querySelectorAll("[data-profile-header] img")].some((img) => img.complete && img.naturalWidth === 400 && img.src.endsWith("/large.webp"))`, "the header's picture");
      await until(page, `[...document.querySelectorAll('[role="article"] img')].some((img) => img.complete && img.naturalWidth === 128 && img.src.includes(${JSON.stringify(AVATAR_UPLOAD_ID)}))`, "a card's picture");
      await screenshot(page, "avatar-profile-1280-light");

      // A refused, a failed and a reset upload: each an error line that takes the focus.
      for (const [outcome, reset, words] of [
        ["refused", false, UPLOAD_TEXTS.refused],
        ["failed", false, AVATAR_WORDS.failed],
        ["ready", true, AVATAR_WORDS.resetRecently],
      ] as const) {
        Object.assign(upload, { outcome, reset });
        await visit(page, "/settings/profile");
        await pickFile(page, AVATAR_WORDS.change, "portrait.webp", PORTRAIT);
        await page.getByRole("button", { name: AVATAR_WORDS.use }).click();
        await page.locator('[role="alert"]').getByText(words).waitFor();
        await until(page, `(document.activeElement && document.activeElement.textContent || "").includes(${JSON.stringify(words)})`, `${outcome} focused`);
        if (outcome === "refused") {
          // Its Why link is next in order, to the refusal's notice.
          await page.keyboard.press("Tab");
          expect(await page.evaluate(`document.activeElement.getAttribute("href")`)).toBe(`/settings/cases/uploads/${UPLOAD_ID}`);
          // A refused upload is shown to nobody: its preview went with it, and the chooser is back.
          expect(await page.evaluate(PREVIEW)).toBeNull();
          expect(await page.getByRole("button", { name: AVATAR_WORDS.use }).count()).toBe(0);
          await screenshot(page, "avatar-refused-1280-light");
          continue;
        }
        // Cancel drops the file, and the focus goes back to the chooser.
        await page.getByRole("button", { name: AVATAR_WORDS.cancel }).click();
        await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.change)}`, "the chooser focused after Cancel");
      }
      Object.assign(upload, { outcome: "ready", reset: false });

      // Remove picture asks first; Remove deletes it, says so, and the focus is on Choose a picture.
      await page.getByRole("button", { name: AVATAR_WORDS.remove }).click();
      await until(page, `${DIALOG_NAME} === ${JSON.stringify(AVATAR_WORDS.confirmTitle)}`, "the removal's question");
      expect(await page.locator('[role="dialog"]').innerText()).toContain(AVATAR_WORDS.confirmBody);
      await screenshot(page, "avatar-remove-1280-light");
      await page.locator('[role="dialog"]').getByRole("button", { name: AVATAR_WORDS.confirm, exact: true }).click();
      await page.locator("[data-sonner-toaster]").getByText(AVATAR_WORDS.removed).waitFor({ state: "visible" });
      await page.locator('[role="dialog"]').waitFor({ state: "detached" });
      await until(page, `${FOCUSED} === ${JSON.stringify(AVATAR_WORDS.choose)}`, "Choose a picture focused");
      expect(fixtures.state.avatar).toBeNull();
      expect(visit_.watcher.take().filter((line) => !/status of 409/.test(line))).toEqual([]);
      expect(fixtures.state.problems.splice(0)).toEqual([]);
    } finally {
      fixtures.state.delayMs = 0;
      fixtures.state.avatar = null;
      Object.assign(upload, { outcome: "ready", reset: false });
      await visit_.context.close();
    }
    // At 360 the card's controls are 44 px and nothing is cut.
    for (const theme of ["light", "dark"] as const) {
      const narrow = await open({ width: 360, height: 740, appearance: { theme } });
      try {
        await visit(narrow.page, "/settings/profile");
        await narrow.page.getByRole("heading", { name: AVATAR_WORDS.section }).waitFor();
        expect(await clippedLabels(narrow.page, ALL)).toEqual([]);
        expect(await phoneProblems(narrow.page, ALL)).toEqual([]);
        expect(await contrast(narrow.page, "main")).toEqual([]);
        await screenshot(narrow.page, `avatar-card-360-${theme}`);
        await clean(narrow);
      } finally {
        await narrow.context.close();
      }
    }
  });

  test("55. mentions: a stored one links to its profile in accent ink with no underline; one that was not stored, and an imported post's, are text", async () => {
    resetActivity();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/activity");
      const reply = page.locator(`main [role="article"][aria-label^="New, Grace Hopper replied"]`);
      await reply.waitFor();
      // The reply's context names @ada too; the body's mention is the second link to her.
      expect(await reply.locator('a[href="/u/ada"]').count()).toBe(2);
      const mention = reply.locator('a[href="/u/ada"]').nth(1);
      expect(await mention.innerText()).toBe("@ada");
      expect(await mention.evaluate((link) => getComputedStyle(link).textDecorationLine)).toBe("none");
      expect(await mention.evaluate((link) => getComputedStyle(link).color)).toBe(rgb(THEMES.light["accent-ink"]));
      expect(await reply.innerText()).toContain("@nobody_here");
      expect(await reply.locator('a[href="/u/nobody_here"]').count()).toBe(0);
      await visit(page, "/u/grace?tab=imported");
      await page.locator('[role="article"]').first().waitFor();
      expect(await page.locator('[role="article"]').first().innerText()).toContain("@ada");
      expect(await page.locator('[role="article"] a[href="/u/ada"]').count()).toBe(0);
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
  });

  test("56. Getting started at 360: a new account's empty Following shows the panel with Latest, Explore, the handle box, the profile's settings with where Settings is, and the rules; the handle box opens a profile", async () => {
    fixtures.state.emptyFollowing = true;
    for (const theme of ["light", "dark"] as const) {
      const visit_ = await open({ width: 360, height: 740, appearance: { theme } });
      const page = visit_.page;
      try {
        await visit(page, "/");
        await page.getByRole("heading", { name: UI_WORDS["feed.start.title"] }).waitFor();
        const main = page.locator("main");
        for (const words of [UI_WORDS["feed.start.body"], UI_WORDS["feed.start.handle"], UI_WORDS["feed.start.settings"], UI_WORDS["shell.how1"]]) expect(await main.innerText()).toContain(words);
        expect(await page.getByRole("button", { name: UI_WORDS["feed.start.latest"] }).count()).toBe(1);
        for (const [words, href] of [
          [UI_WORDS["feed.start.explore"], "/explore/about"],
          [UI_WORDS["feed.start.profile"], "/settings/profile"],
          [UI_WORDS["feed.start.rules"], "/rules"],
        ] as const) {
          expect(await main.getByRole("link", { name: words }).getAttribute("href")).toBe(href);
        }
        expect(await clippedLabels(page, ALL)).toEqual([]);
        expect(await phoneProblems(page, ALL)).toEqual([]);
        expect(await contrast(page, "main")).toEqual([]);
        await screenshot(page, `getting-started-360-${theme}`);
        if (theme === "light") {
          await main.getByRole("textbox", { name: UI_WORDS["handle.field"] }).fill("@grace");
          await page.keyboard.press("Enter");
          await until(page, `location.pathname === "/u/grace"`, "the profile by its handle");
          await page.waitForLoadState("networkidle");
        }
        await clean(visit_);
      } finally {
        await visit_.context.close();
      }
    }
    fixtures.state.emptyFollowing = false;
  });

  test("57. hiding counts: the author's More menu hides a post's like and repost counts, with its toast; the author still reads them, Who sees this says so, and another reader gets no number", async () => {
    const MORE = `[role="button"][aria-label="${UI_WORDS["post.more"]}"]`;
    fixtures.state.hiddenCounts.clear();
    const visit_ = await open({ width: 1280, height: 900, appearance: { theme: "light" } });
    const page = visit_.page;
    try {
      await visit(page, "/?tab=latest");
      const own = postArticle(page, 3).first();
      await own.locator(MORE).click();
      const menu = page.locator("[data-menu]");
      await menu.waitFor({ state: "visible" });
      await menu.getByRole("button", { name: UI_WORDS["post.hideCounts"] }).click();
      await page.locator("[data-sonner-toaster]").getByText(UI_WORDS["post.countsHidden"]).waitFor({ state: "visible" });
      expect(fixtures.state.hiddenCounts.has(postIdOf(3))).toBe(true);
      // The author keeps the numbers; the menu now offers to show them, and Who sees this says they are hidden.
      expect(await own.getByRole("button", { name: /^Like, [0-9]+ likes?$/ }).count()).toBe(1);
      await own.locator(MORE).click();
      await menu.waitFor({ state: "visible" });
      expect(await menu.getByRole("button", { name: UI_WORDS["post.showCounts"] }).count()).toBe(1);
      await menu.getByRole("button", { name: new RegExp(`^${UI_WORDS["post.whoSees"]}`) }).click();
      await page.locator('[role="dialog"]').getByText(UI_WORDS["reach.countsHidden"]).waitFor();
      await page.keyboard.press("Escape");
      await page.locator('[role="dialog"]').waitFor({ state: "detached" });
      await clean(visit_);
    } finally {
      await visit_.context.close();
    }
    const other = await open({ width: 1280, height: 900, signedIn: false, appearance: { theme: "light" } });
    try {
      await visit(other.page, "/?tab=latest");
      const card = postArticle(other.page, 3).first();
      await card.waitFor();
      expect(await card.getByRole("button", { name: UI_WORDS["post.like.none"], exact: true }).count()).toBe(1);
      expect(await card.getByRole("button", { name: UI_WORDS["post.reposts.none"], exact: true }).count()).toBe(1);
      expect(await card.locator('[role="button"]').evaluateAll((buttons) => buttons.map((button) => button.textContent).join(" "))).not.toMatch(/[0-9]/);
      await screenshot(other.page, "counts-hidden-other-1280-light");
      await clean(other);
    } finally {
      fixtures.state.hiddenCounts.clear();
      await other.context.close();
    }
  });
});
```

### Replace `apps/app/test/browser/caddyfile.ts` (whole file)

```ts
import { APP_SITE, handles, matcherTakes, pathMatchers, readCaddyfile, routeFor, site, type CaddyNode, type Handle, type PathMatcher } from "../../../admin/test/caddyfile";

/**
 * The app's site in infra/caddy/Caddyfile, as the app's browser check needs it (UI design, section 12.3), read with the
 * console's reader (apps/admin/test/caddyfile.ts), so the check serves the export under the headers Caddy really sends
 * and never from a copy: the page's security headers (the app_page_headers snippet, its policy among them) and caching by
 * kind of file, immutable for /_expo/* and /assets/*, no-cache for the page and everything else. The site is the snippet
 * that APP_SITE names, open by default, as Caddy reads it with nothing set. 2d Task 6 (design, sections 8.2 and 12.4): a
 * post's page and a profile's page each ask the API for their share card, and the files' handle says noindex on every page
 * but the five that name no account (@named), all of which the check serves as Caddy sends them.
 */
export { APP_SITE, routeFor };

/**
 * What a request to the app's site reaches: the API, a handle's own answer, a post's or (2d) a profile's page (the shell
 * under the status of the page's card), or the files.
 */
export type AppRoute = { kind: "api" } | { kind: "own"; status: number; body: string; headers: Record<string, string> } | { kind: "post" } | { kind: "profile" } | { kind: "files" };

/** The app's site block, with its snippets put in. */
export function appSite(tree: CaddyNode[] = readCaddyfile()): CaddyNode {
  return site(tree, APP_SITE);
}

/**
 * Whether a handle hands the request to the API as it is (reverse_proxy without a rewrite of its path), or asks it for a
 * page's card (2d Task 6: the rewrite names the post's or the profile's card route); a rewrite to anything else is no route
 * this reader knows.
 */
function proxies(handle: Handle): "api" | "post" | "profile" | null {
  const proxy = handle.block.children?.find((node) => node.tokens[0] === "reverse_proxy");
  if (!proxy) return null;
  const rewrite = proxy.children?.find((node) => node.tokens[0] === "rewrite");
  if (rewrite === undefined) return "api";
  const target = rewrite.tokens[1] ?? "";
  if (target.startsWith("/api/cards/post/")) return "post";
  if (target.startsWith("/api/cards/profile/")) return "profile";
  throw new Error(`a page handle that asks the API for something this reader does not know: ${rewrite.tokens.join(" ")}`);
}

/** The `respond <body> <status>` of a handle that answers by itself, with its header lines; null for any other handle. */
function ownAnswer(handle: Handle): { status: number; body: string; headers: Record<string, string> } | null {
  // A respond with a matcher (respond @push 403) answers only the push network, which the walk never is.
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond" && !node.tokens[1]?.startsWith("@"));
  if (!respond) return null;
  const headers: Record<string, string> = {};
  for (const node of handle.block.children ?? []) {
    const [directive, name, value, ...rest] = node.tokens;
    if (directive === "header" && name !== undefined && value !== undefined && rest.length === 0 && !name.startsWith("-") && !name.startsWith("@")) headers[name] = value;
  }
  return { status: Number(respond.tokens[2] ?? 200), body: respond.tokens[1] ?? "", headers };
}

/** Where the site sends a request for `pathname`. */
export function appRoute(siteBlock: CaddyNode, pathname: string): AppRoute {
  const handle = routeFor(siteBlock, pathname);
  const proxy = proxies(handle);
  if (proxy === "api") return { kind: "api" };
  if (proxy === "post" || proxy === "profile") return { kind: proxy };
  const own = ownAnswer(handle);
  if (own) return { kind: "own", ...own };
  return { kind: "files" };
}

/**
 * The response headers a handle's lines set for `pathname`: every `header { ... }` block (the imported app_page_headers),
 * every unconditional `header Name value` line, and each `header @matcher Name value` whose matcher takes the path, which
 * is what Caddy matches on (the header directive runs before try_files). Deletions such as -Server set nothing.
 */
function headersOf(block: CaddyNode): (pathname: string, isFile: boolean) => Record<string, string> {
  const matchers = pathMatchers(block);
  const always: Record<string, string> = {};
  const conditional: { matcher: PathMatcher; name: string; value: string }[] = [];
  const unknown = (node: CaddyNode) => new Error(`a header line the reader does not know: ${node.tokens.join(" ")}`);
  for (const node of block.children ?? []) {
    if (node.tokens[0] !== "header") continue;
    if (node.children !== undefined) {
      if (node.tokens.length !== 1) throw unknown(node);
      for (const field of node.children) {
        const [name, value, ...rest] = field.tokens;
        if (name === undefined || (name.startsWith("-") && value === undefined)) continue;
        if (value === undefined || rest.length > 0 || name.startsWith("-") || name.startsWith("+") || name.startsWith("?")) throw unknown(field);
        always[name] = value;
      }
      continue;
    }
    const [, first, second, third, ...rest] = node.tokens;
    if (first?.startsWith("@")) {
      const matcher = matchers.get(first);
      if (!matcher || second === undefined || third === undefined || rest.length > 0) throw unknown(node);
      conditional.push({ matcher, name: second, value: third });
    } else if (first !== undefined && !(first.startsWith("-") && second === undefined)) {
      if (second === undefined || third !== undefined) throw unknown(node);
      always[first] = second;
    }
  }
  return (pathname, isFile) => {
    const headers = { ...always };
    for (const { matcher, name, value } of conditional) if (matcherTakes(matcher, pathname, isFile)) headers[name] = value;
    return headers;
  };
}

/**
 * The headers the app's site sends with a page or a file: those of the handle the path reaches (the post's page handle
 * for /post/*, 2d's profile's page handle for /u/*, the files' handle for everything else that is not the API). `isFile` says whether the path names a file of
 * the export, for a matcher with `file`.
 */
export function appSiteHeadersFromCaddyfile(tree: CaddyNode[] = readCaddyfile()): (pathname: string, isFile: boolean) => Record<string, string> {
  const block = appSite(tree);
  const statics = handles(block).filter((h) => h.matcher === null);
  if (statics.length !== 1) throw new Error(`the app site needs exactly one handle without a matcher, the files; it has ${statics.length}`);
  const files = headersOf(statics[0]!.block);
  const posts = headersOf(routeFor(block, "/post/x").block);
  const profiles = headersOf(routeFor(block, "/u/x").block);
  return (pathname, isFile) => {
    const kind = appRoute(block, pathname).kind;
    return kind === "post" ? posts(pathname, isFile) : kind === "profile" ? profiles(pathname, isFile) : files(pathname, isFile);
  };
}
```

### Replace `apps/app/test/browser/fixture-api.ts` (whole file)

```ts
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ActivityEntry,
  ActivityPage,
  ActivitySettings,
  ACTIVITY_DEFAULTS,
  ACTIVITY_PAGE_SIZE,
  IMPORT_RULES,
  ImportPickView,
  ImportView,
  type ImportLineView,
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
 * From UI Task 7 Ada's profile starts with a post of hers that korbat removed, whose decision has a screen of its own,
 * and Grace's with a post that holds an image hidden from readers; `delayMs` holds a decision's answer back too, and the
 * kind "decision" in `refuse` refuses it. Nothing here needs a database or the network.
 */

/** A WebP of 2 by 2 pixels (lossless, 38 bytes) in the accent violet: a real image, which the browser decodes under the policy. */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQmWrVuv+BiOh/AAA=", "base64");

/**
 * 2d Task 5 (design, section 10.9): a lossless WebP of one colour, `size` pixels wide (and `height` high, a square unless
 * told), written by code: the VP8L
 * header (the signature, the size less one in 14 bits each, no alpha, version 0), no transform, no colour cache, no meta
 * codes, then five prefix codes of one symbol each (green, red, blue, alpha, distance), so every pixel costs no bits and
 * the file is 32 bytes whatever its size. The avatars' two files, small.webp (128 px) and large.webp (400 px), are these.
 */
export function solidWebp(size: number, [r, g, b]: [number, number, number], height = size): Buffer {
  const bits: number[] = [];
  const put = (value: number, count: number) => {
    for (let i = 0; i < count; i++) bits.push((value >> i) & 1);
  };
  put(size - 1, 14);
  put(height - 1, 14);
  put(0, 4);
  put(0, 3);
  for (const symbol of [g, r, b, 255]) {
    put(1, 1);
    put(0, 1);
    put(1, 1);
    put(symbol, 8);
  }
  put(0b0001, 4);
  const data = Buffer.alloc(1 + Math.ceil(bits.length / 8));
  data[0] = 0x2f;
  bits.forEach((bit, i) => {
    data[1 + (i >> 3)]! |= bit << (i & 7);
  });
  const padded = data.length + (data.length % 2);
  const file = Buffer.alloc(20 + padded);
  file.write("RIFF", 0, "ascii");
  file.writeUInt32LE(12 + padded, 4);
  file.write("WEBPVP8L", 8, "ascii");
  file.writeUInt32LE(data.length, 16);
  data.copy(file, 20);
  return file;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADA: Author = { id: id(1), handle: "ada", displayName: "Ada Lovelace", verified: false, avatar: null };
export const GRACE: Author = { id: id(2), handle: "grace", displayName: "Grace Hopper", verified: true, avatar: null };
export const LINUS: Author = { id: id(3), handle: "linus", displayName: "Linus", verified: false, avatar: null };

/** Post number n's id, for a step that acts on one post of the timelines: Grace writes 1, 4, 7..., Linus 2, 5, 8..., Ada 3, 6, 9.... */
export const postIdOf = (n: number): string => id(100 + n);

/** The post the walk opens (by Grace), and a post id the API does not know, whose page answers 404. */
export const POST_ID = id(101);
export const MISSING_POST_ID = id(999);
/** A decision, a release and a refused upload of Ada's, for the cases screens. */
export const DECISION_ID = id(501);
export const RELEASE_ID = id(502);
export const UPLOAD_ID = id(503);
/**
 * UI Task 7: a post of Ada's that korbat removed under R6 (on top of her own profile, signed in as her), the decision
 * about it, which its chip's details sheet reads, and a post of Grace's whose second image is hidden from readers (on
 * top of her profile). Their ids are their own, so posts 1 to 120 keep theirs.
 */
export const REMOVED_POST_ID = id(401);
export const POST_DECISION_ID = id(504);
export const HIDDEN_IMAGE_POST_ID = id(402);
/** The removed post's chip, as chipText() words a final decision under R6 without a strike. */
export const REMOVED_CHIP = "Removed: R6";

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
    imported: null,
    mentions: [],
    countsHidden: false,
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
      // 3b Task 7: Grace has imported posts, so her profile shows the Imported tab to every reader (10.6).
      hasImported: author.id === GRACE.id,
      // 2d Task 3: nobody has a picture yet; Task 5 draws avatars and gives the fixture two squares.
      avatar: author.avatar,
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
      profile: { id: ADA.id, handle: ADA.handle, displayName: ADA.displayName, handleChangedAt: null, verified: false, showInExplore: true, sharePreviews: false },
      standing: { activeStrikes: 0, measure: null, reporting: null, handleRetired: false },
      avatar: null,
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

/** The decision about Ada's removed post (UI Task 7): final, under R6, after a report, which she can still appeal. */
function postDecision() {
  return parse(
    DecisionView,
    {
      id: POST_DECISION_ID,
      kind: "final",
      outcome: "restricted",
      ground: "incompatible",
      ruleId: "R6",
      rulesVersion: 3,
      redressVersion: 2,
      legalReference: null,
      facts: "The post offered followers for sale.",
      reason: "Selling followers is spam under rule R6: it fakes the reach that korbat's feeds show in time order.",
      source: "report",
      decidedAt: ago(60 * 24 * 2),
      post: { id: REMOVED_POST_ID, createdAt: ago(60 * 24 * 3) },
      measures: [{ kind: "remove", mediaId: null, noEffect: null, sealed: null }],
      reversals: [],
      endedMeasures: [],
      reviewed: null,
      appealUntil: daysAhead(170),
      reversedOn: null,
      content: { kind: "post", body: REMOVED_BODY, deletedByAuthor: false, images: [], imageCount: 0, imagesHidden: null },
      appeal: null,
      strike: null,
      standing: null,
    } as z.input<typeof DecisionView>,
    "post decision",
  );
}

const REMOVED_BODY = "Buy a thousand followers for five euros, delivered by tonight.";

/** Ada's removed post as she reads it on her own profile: removed, with the chip's facts of its decision. */
function removedPost(signedIn: boolean): PostView {
  return post(41, signedIn, {
    id: REMOVED_POST_ID,
    author: ADA,
    body: REMOVED_BODY,
    createdAt: ago(60 * 24 * 3),
    state: "removed",
    media: [],
    moderation: { decisionId: POST_DECISION_ID, ruleId: "R6", legal: false, interim: false, strikeUntil: null },
  });
}

/** Grace's post with two images, the second hidden from every reader by moderation (decision 10). */
function hiddenImagePost(signedIn: boolean): PostView {
  return post(42, signedIn, {
    id: HIDDEN_IMAGE_POST_ID,
    author: GRACE,
    body: "Two photographs from the harbour walk; one of them is not shown to you.",
    createdAt: ago(3),
    media: [image(42), { id: id(781), hidden: true }],
  });
}

/**
 * 3b Task 7 (design, section 10.8): the imports the walk opens, one in each state, by their ids. IMPORT_READY holds a scan
 * with every reason, three samples with "@ada" in their words and a page of lines; IMPORT_SCANNING turns ready when a step
 * sets `scanReady`; IMPORT_RESUME is an upload stopped at its first chunk; a new import (POST /api/imports) takes the
 * id IMPORT_NEW and its chunks at the stored offset with their SHA-256, as the API does (7.3).
 */
export const IMPORT_RESUME = id(801);
export const IMPORT_SCANNING = id(802);
export const IMPORT_READY = id(803);
export const IMPORT_PREPARING = id(804);
export const IMPORT_PUBLISHING = id(805);
export const IMPORT_DONE = id(806);
export const IMPORT_REFUSED = id(807);
export const IMPORT_BY_STAFF = id(808);
export const IMPORT_UNDOING = id(809);
export const IMPORT_UNDONE = id(810);
export const IMPORT_FAILED = id(811);
export const IMPORT_CANCELLED = id(812);
export const IMPORT_EXPIRED = id(813);
export const IMPORT_NEW = id(820);
/** The size of the walk's generated archives: 20 MB, three chunks of IMPORT_RULES.chunkBytes and the rest. */
export const ARCHIVE_BYTES = 20_000_000;
/** The refusal and the case decision of the imports that were stopped. */
export const IMPORT_REFUSAL_ID = id(830);
export const IMPORT_DECISION_ID = id(831);
/** Grace's imported posts on her Imported tab: one with "@ada" in its words, one shortened on import. */
export const IMPORTED_POST_ID = id(450);
export const IMPORTED_SHORTENED_ID = id(451);

type ImportStatusName = ImportView["status"];
const PROGRESS = { imagesTotal: 0, imagesSettled: 0, postsTotal: 0, postsPublished: 0, postsRemoved: 0, postsLeft: 0, imagesLeftOut: {} };

/** The ready import's scan: every reason of 9.3 that the importer and the intake count, posts in three months, replies, long posts and warnings. */
const READY_SCAN = {
  posts: 70,
  images: 6,
  skipped: {
    repost: 120,
    not_public: 40,
    older_version: 3,
    poll: 2,
    adult_label: 1,
    too_long_to_read: 1,
    date_out_of_range: 1,
    item_too_large: 1,
    unreadable: 1,
    empty: 2,
    already_imported: 5,
    over_post_cap: 1,
    over_item_cap: 1,
    new_account_cap: 4,
  },
  imagesSkipped: { video: 4, sensitive: 2, unsupported: 1, too_large: 1, missing_file: 1, over_image_cap: 1 },
  cleaned: 2,
  warnings: 3,
  sourceLinks: 4,
  protectedPosts: 0,
  readInPart: true,
  months: [
    { month: "2019-03", groups: [[0, 30, 4, 1], [1, 5, 0, 0], [2, 2, 0, 0], [4, 3, 0, 0]] as [number, number, number, number][] },
    { month: "2019-04", groups: [[0, 20, 2, 0]] as [number, number, number, number][] },
    { month: "2021-05", groups: [[0, 10, 0, 0]] as [number, number, number, number][] },
  ],
  first: "2019-03",
  last: "2021-05",
  fromRef: 0,
};

/** The ready import's page of lines, in the archive's order: posts, a reply, a long post, one with an image to describe. */
const READY_LINES: ImportLineView[] = [
  { ref: 0, at: "2019-03-03", kind: "post", marks: 0, text: "Morning, @ada: the ferries run late again.", media: [{ file: "0-0.webp", alt: null }], leftOut: false, alts: [] },
  { ref: 1, at: "2019-03-04", kind: "reply", marks: 1, text: "@grace_h thanks, the harbour was quiet today.", media: [], leftOut: false, alts: [] },
  { ref: 2, at: "2019-03-09", kind: "post", marks: 0, text: "A map of the old market, from a box of maps from the sixties.", media: [{ file: "2-0.webp", alt: "A hand-drawn map of the old market" }], leftOut: false, alts: [] },
  { ref: 3, at: "2019-03-21", kind: "post", marks: 2, text: "A long post about the essay. ".repeat(40).trim(), media: [], leftOut: false, alts: [] },
  { ref: 4, at: "2019-04-02", kind: "thread", marks: 0, text: "Second part of the thread on Babbage's engines.", media: [], leftOut: false, alts: [] },
  { ref: 5, at: "2021-05-30", kind: "post", marks: 0, text: "Rain all afternoon; the photo archive is sorted by year now.", media: [], leftOut: false, alts: [] },
];

/** One import of the walk, in its state, as GET /api/imports/:id answers it. */
function importOf(importId: string, status: ImportStatusName, extra: Partial<z.input<typeof ImportView>> = {}): ImportView {
  return parse(
    ImportView,
    {
      id: importId,
      source: "mastodon",
      status,
      createdAt: ago(60 * 3),
      endedAt: null,
      declaredBytes: ARCHIVE_BYTES,
      receivedBytes: status === "uploading" ? 0 : ARCHIVE_BYTES,
      chunkBytes: IMPORT_RULES.chunkBytes,
      failure: null,
      stopReason: null,
      endedByStaff: null,
      staffDecisionId: null,
      scan: null,
      samples: [],
      choice: null,
      picks: [],
      progress: PROGRESS,
      paused: false,
      refusalId: null,
      refusedAt: null,
      refusedWords: null,
      undoable: false,
      ...extra,
    } as z.input<typeof ImportView>,
    `import ${status}`,
  );
}

const CHOSEN = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" as const };

/** Every import of the walk but the new one, by id. */
function importsOfTheWalk(scanReady: boolean): Map<string, ImportView> {
  const published = { ...PROGRESS, postsTotal: 1240, postsPublished: 1240 };
  const ready = (importId: string) =>
    importOf(importId, "ready", {
      scan: READY_SCAN,
      samples: [
        { at: "2021-05-30", text: "Rain all afternoon; the photo archive is sorted by year now." },
        { at: "2019-04-02", text: "Second part of the thread on Babbage's engines." },
        { at: "2019-03-03", text: "Morning, @ada: the ferries run late again." },
      ],
    });
  return new Map<string, ImportView>([
    [IMPORT_RESUME, importOf(IMPORT_RESUME, "uploading", { receivedBytes: IMPORT_RULES.chunkBytes })],
    [IMPORT_SCANNING, scanReady ? ready(IMPORT_SCANNING) : importOf(IMPORT_SCANNING, "scanning")],
    [IMPORT_READY, ready(IMPORT_READY)],
    [IMPORT_PREPARING, importOf(IMPORT_PREPARING, "preparing", { choice: { ...CHOSEN, images: true }, progress: { ...PROGRESS, imagesTotal: 1200, imagesSettled: 340, postsTotal: 1240 } })],
    [IMPORT_PUBLISHING, importOf(IMPORT_PUBLISHING, "publishing", { choice: CHOSEN, progress: { ...PROGRESS, postsTotal: 1240, postsPublished: 800, postsLeft: 440 } })],
    [IMPORT_DONE, importOf(IMPORT_DONE, "done", { choice: CHOSEN, endedAt: ago(30), progress: { ...published, imagesLeftOut: { not_checked: 2, flagged: 1 } }, undoable: true })],
    [IMPORT_REFUSED, importOf(IMPORT_REFUSED, "stopped", { stopReason: "refused_image", endedAt: ago(30), refusalId: IMPORT_REFUSAL_ID, refusedAt: "2019-03-03", refusedWords: "Morning at the harbour, with the ferries" })],
    [IMPORT_BY_STAFF, importOf(IMPORT_BY_STAFF, "stopped", { stopReason: "by_staff", endedAt: ago(30), endedByStaff: "R6", staffDecisionId: IMPORT_DECISION_ID, progress: { ...PROGRESS, postsTotal: 1240, postsPublished: 300 }, undoable: true })],
    [IMPORT_UNDOING, importOf(IMPORT_UNDOING, "undoing", { endedAt: ago(30), progress: { ...published, postsRemoved: 400 } })],
    [IMPORT_UNDONE, importOf(IMPORT_UNDONE, "undone", { endedAt: ago(20), progress: { ...published, postsRemoved: 1240 } })],
    [IMPORT_FAILED, importOf(IMPORT_FAILED, "failed", { failure: "tar_gz", endedAt: ago(100), receivedBytes: IMPORT_RULES.chunkBytes })],
    [IMPORT_CANCELLED, importOf(IMPORT_CANCELLED, "cancelled", { endedAt: ago(100) })],
    [IMPORT_EXPIRED, importOf(IMPORT_EXPIRED, "expired", { endedAt: ago(100) })],
  ]);
}

/** The picks' counts of the walk's picks, by month and marks, as the API's pickCounts gives them (9.3). */
function pickTable(picks: Map<number, { leftOut: boolean; alts: (string | null)[] }>): ImportView["picks"] {
  const months = new Map<string, Map<number, [number, number, number]>>();
  for (const [ref, pick] of picks) {
    const line = READY_LINES.find((entry) => entry.ref === ref);
    if (!line) continue;
    const month = line.at.slice(0, 7);
    const groups = months.get(month) ?? new Map<number, [number, number, number]>();
    months.set(month, groups);
    const group = groups.get(line.marks) ?? [0, 0, 0];
    groups.set(line.marks, group);
    if (pick.leftOut) {
      group[0] += 1;
      group[1] += line.media.filter((media) => media.alt !== null).length;
    } else group[2] += pick.alts.filter((alt) => alt !== null).length;
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, groups]) => ({
      month,
      groups: [...groups.entries()].filter(([, [out, described, given]]) => out + described + given > 0).map(([marks, [out, described, given]]) => [marks, out, described, given] as [number, number, number, number]),
    }))
    .filter(({ groups }) => groups.length > 0);
}

/** Grace's imported posts (10.6), newest archive date first: one with "@ada" in its words, one shortened on import. */
function importedPosts(signedIn: boolean): PostView[] {
  const walk = "Notes from a long walk along the canal and the old docks. ".repeat(16).trim();
  return [
    post(43, signedIn, { id: IMPORTED_POST_ID, author: GRACE, body: "Thanks @ada for the harbour photographs; more at https://example.org/harbour", createdAt: ago(60 * 2), imported: { source: "x", at: "2019-03-03", shortened: false } }),
    post(44, signedIn, { id: IMPORTED_SHORTENED_ID, author: GRACE, body: `${walk}${String.fromCharCode(0x2026)}`, createdAt: ago(60 * 2), imported: { source: "mastodon", at: "2018-11-20", shortened: true } }),
  ];
}

/**
 * 2d Task 5 (design, sections 5.5, 5.7 and 10.9): Ada's Activity. Every time has six fractional digits, as the API's;
 * the seen marker sits between the two newest entries and the rest, so two are new; a reply whose words name a stored
 * mention (@ada) and one that is not (@nobody_here); a mention, a quote, a day of follows by five accounts (three named)
 * and a moderation entry of each kind; then older replies, so the first page of 30 ends on a day of follows and Load more
 * reads the rest. `fresh` entries are newer than all of them, as the poll's count says, and come with the next first page.
 */
export const MARY: Author = { id: id(4), handle: "mary", displayName: "Mary Somerville", verified: false, avatar: null };
/** Grace's and Linus's pictures (two WebP squares the fixture writes), on Activity's entries only, so earlier steps keep their monograms. */
export const AVATAR_OF: Record<string, { id: string; colour: [number, number, number] }> = {
  [GRACE.id]: { id: id(960), colour: [0x6d, 0x28, 0xd9] },
  [LINUS.id]: { id: id(961), colour: [0x0e, 0x7c, 0x66] },
};
/** Ada's upload in the picker (step 54), and its colour once it is her picture. */
export const AVATAR_UPLOAD_ID = id(962);
const ADA_COLOUR: [number, number, number] = [0xb4, 0x3c, 0x1e];
const withAvatar = (author: Author): Author => {
  const own = AVATAR_OF[author.id];
  return own ? { ...author, avatar: { small: `/api/media/${own.id}/small.webp`, large: `/api/media/${own.id}/large.webp` } } : author;
};

/** An Activity time: the minute `minutes` before the walk started, with six fractional digits. */
const micro = (minutes: number) => ago(minutes).replace(/[.]([0-9]{3})Z$/, ".$1321Z");
/** Ada's post the replies answer. */
const ADA_POST = { id: id(103), authorHandle: ADA.handle };
export const ACTIVITY_REPLY_ID = id(1201);
export const ACTIVITY_DECISION_POST = id(1202);
export const ACTIVITY_RELEASE_ID = id(1203);
export const ACTIVITY_UPLOAD_ID = id(1204);
export const ACTIVITY_LOST_ID = id(1205);
/** The marker as stored before the walk opens Activity: after the two newest entries' times. */
export const ACTIVITY_SEEN = micro(30);

function activityEntries(signedIn: boolean, fresh: number): ActivityEntry[] {
  const reply = (n: number, minutes: number, extra: Partial<PostView> = {}) =>
    ({ type: "post", kind: "reply", key: `e:${id(1300 + n)}`, at: micro(minutes), new: false, post: post(n, signedIn, { id: id(1400 + n), author: withAvatar(GRACE), createdAt: ago(minutes), replyTo: ADA_POST, ...extra }) }) as ActivityEntry;
  const day = (minutes: number) => micro(minutes).slice(0, 10);
  const entries: ActivityEntry[] = [];
  for (let j = fresh; j >= 1; j--) entries.push(reply(80 + j, 1 / 60 / (j + 1), { body: `A new reply, number ${j}, written while Activity was open.` }));
  entries.push(
    reply(1, 5, { id: ACTIVITY_REPLY_ID, body: "Thanks @ada for the notes, and say hello to @nobody_here.", mentions: ["ada"] }),
    { type: "post", kind: "mention", key: `e:${id(1302)}`, at: micro(9), new: false, post: post(2, signedIn, { id: id(1402), author: withAvatar(LINUS), createdAt: ago(9), body: "Reading @ada's essay on the engines this morning.", mentions: ["ada"] }) },
    { type: "follows", key: `f:${day(60)}`, at: micro(60), new: false, count: 5, actors: [withAvatar(GRACE), withAvatar(LINUS), MARY] },
    { type: "post", kind: "quote", key: `e:${id(1303)}`, at: micro(120), new: false, post: post(4, signedIn, { id: id(1403), author: withAvatar(GRACE), createdAt: ago(120), body: "Worth reading twice.", media: [], quoteOf: { ...post(3, signedIn), quoteOf: null } }) },
    { type: "moderation", kind: "decision", key: `d:${DECISION_ID}`, at: micro(180), new: false, target: "account", id: DECISION_ID, postId: null, postCreatedAt: null },
    { type: "moderation", kind: "decision", key: `d:${POST_DECISION_ID}`, at: micro(240), new: false, target: "post", id: POST_DECISION_ID, postId: REMOVED_POST_ID, postCreatedAt: ago(60 * 24 * 3) },
    { type: "moderation", kind: "release", key: `r:${RELEASE_ID}`, at: micro(300), new: false, target: "account", id: RELEASE_ID, postId: null, postCreatedAt: null },
    { type: "moderation", kind: "upload", key: `u:${UPLOAD_ID}`, at: micro(360), new: false, target: "account", id: UPLOAD_ID, postId: null, postCreatedAt: null },
    { type: "moderation", kind: "lost", key: `l:${ACTIVITY_LOST_ID}`, at: micro(420), new: false, target: "post", id: ACTIVITY_LOST_ID, postId: POST_ID, postCreatedAt: ago(7) },
  );
  // Older replies, a day apart from the follows, to fill the first page; its 30th entry is a day of follows by one account.
  for (let n = 5; entries.length < fresh + ACTIVITY_PAGE_SIZE - 1; n++) entries.push(reply(n, 600 + n * 10));
  entries.push({ type: "follows", key: `f:${day(60 * 24 * 3)}`, at: micro(60 * 24 * 3), new: false, count: 1, actors: [withAvatar(LINUS)] });
  for (let n = 40; n < 46; n++) entries.push(reply(n, 60 * 24 * 4 + n));
  return entries;
}

/** A page of Activity as GET /api/activity answers it, each entry new against the stored marker, checked by the contract. */
function activityPage(tab: string | null, cursor: string | null, signedIn: boolean, fresh: number, seenAt: string | null): ActivityPage {
  const all = activityEntries(signedIn, fresh).filter((entry) => tab !== "conversations" || entry.type === "post");
  const from = cursor === null ? 0 : Number.parseInt(cursor.replace(/^p/, ""), 10);
  const to = Math.min(all.length, from + ACTIVITY_PAGE_SIZE);
  const items = all.slice(from, to).map((entry) => ({ ...entry, new: seenAt === null || entry.at > seenAt }));
  return parse(ActivityPage, { items, nextCursor: to < all.length ? `p${to}` : null, seenAt }, "activity page");
}

/** An import's routes (9.2) as the walk needs them, over the state the steps set. */
interface ImportFixtureState {
  scanReady: boolean;
  /** The new import's view, once POST /api/imports made it. */
  created: ImportView | null;
  /** Its archive as the chunks arrived, and every chunk request: offset, length, hash, and whether it was kept. */
  archive: Buffer;
  chunks: { offset: number; length: number; sha256: string; answer: number }[];
  /**
   * The offsets whose first try the fixture refuses (chunk_mismatch), and those whose connection is lost until the app reads
   * the import: the first try's chunk is kept and its answer lost, and every try at that offset is dropped, the browser's
   * own retry of a PUT on a reused connection included, until GET /api/imports/:id arrives.
   */
  refuseOnce: Set<number>;
  dropUntilRead: Set<number>;
  picks: Map<number, { leftOut: boolean; alts: (string | null)[] }>;
}

export const newImportState = (): ImportFixtureState => ({ scanReady: false, created: null, archive: Buffer.alloc(0), chunks: [], refuseOnce: new Set(), dropUntilRead: new Set(), picks: new Map() });

const IMPORT_PATH = /^\/api\/imports\/([0-9a-f-]{36})(?:\/(archive|lines|cancel|stop|undo|confirm|media\/[0-9a-z.-]+|lines\/[0-9]+))?$/;

/** The answer to an import route, or null when the path is no import's. `drop` answers a lost connection. */
function importAnswer(imports: ImportFixtureState, method: string, path: string, query: URLSearchParams, headers: IncomingMessage["headers"], body: Buffer): Answer | "drop" | null {
  const walk = importsOfTheWalk(imports.scanReady);
  const withPicks = (view: ImportView): ImportView => (view.status === "ready" ? { ...view, picks: pickTable(imports.picks) } : view);
  if (path === "/api/imports" && method === "GET") {
    const list = [walk.get(IMPORT_READY)!, walk.get(IMPORT_DONE)!, walk.get(IMPORT_UNDONE)!];
    return { status: 200, json: { imports: list.map(withPicks), sources: ["x", "mastodon"] } };
  }
  if (path === "/api/imports" && method === "POST") {
    const asked = JSON.parse(body.toString("utf8") || "{}") as { source?: "x" | "mastodon"; bytes?: number };
    imports.created = importOf(IMPORT_NEW, "uploading", { source: asked.source ?? "mastodon", declaredBytes: asked.bytes ?? ARCHIVE_BYTES, createdAt: new Date().toISOString() });
    imports.archive = Buffer.alloc(0);
    return { status: 201, json: imports.created };
  }
  const match = IMPORT_PATH.exec(path);
  if (!match) return null;
  const importId = match[1]!;
  const part = match[2];
  const view = importId === IMPORT_NEW ? imports.created : (walk.get(importId) ?? null);
  if (view === null) return { status: 404, json: { error: { code: "not_found", message: "That no longer exists." } } };
  if (part === undefined && method === "GET") {
    // The app read the import after a chunk was lost: the connection is back. A read before (the screen opening) changes nothing.
    if (importId === IMPORT_NEW && imports.chunks.some((chunk) => chunk.answer === 0)) imports.dropUntilRead.clear();
    return { status: 200, json: withPicks(view) };
  }
  if (part === "archive" && method === "PUT" && importId === IMPORT_NEW && imports.created !== null) {
    const offset = Number(headers["import-offset"]);
    const sha256 = String(headers["import-chunk-sha256"] ?? "");
    const stored = imports.archive.length;
    const record = (answer: number) => imports.chunks.push({ offset, length: body.length, sha256, answer });
    if (imports.dropUntilRead.has(offset)) {
      // The first try arrives and is kept, but its answer is lost on the way; any further try is lost too, until the app
      // reads the import, which it must do before it sends more.
      if (offset === stored) {
        imports.archive = Buffer.concat([imports.archive, body]);
        imports.created = { ...imports.created, receivedBytes: imports.archive.length };
      }
      record(0);
      return "drop";
    }
    if (offset !== stored) {
      record(409);
      return { status: 409, json: { error: { code: "wrong_offset", message: "Not at that place.", details: { receivedBytes: stored } } } };
    }
    if (imports.refuseOnce.delete(offset) || createHash("sha256").update(body).digest("hex") !== sha256) {
      record(400);
      return { status: 400, json: { error: { code: "chunk_mismatch", message: "The chunk did not arrive whole." } } };
    }
    imports.archive = Buffer.concat([imports.archive, body]);
    const done = imports.archive.length >= imports.created.declaredBytes;
    imports.created = { ...imports.created, receivedBytes: imports.archive.length, status: done ? "scanning" : "uploading" };
    record(200);
    return { status: 200, json: { receivedBytes: imports.archive.length } };
  }
  if (part === "lines" && method === "GET" && view.status === "ready") {
    const lines = READY_LINES.map((line) => ({ ...line, ...(imports.picks.get(line.ref) ?? {}) }));
    return { status: 200, json: { lines: query.get("page") === "0" ? lines : [], pages: 1 } };
  }
  if (part?.startsWith("lines/") && method === "PUT" && view.status === "ready") {
    const ref = Number(part.slice("lines/".length));
    const asked = JSON.parse(body.toString("utf8") || "{}") as { leftOut?: boolean; alts?: (string | null)[] };
    const pick = { leftOut: asked.leftOut === true, alts: asked.alts ?? [] };
    imports.picks.set(ref, pick);
    return { status: 200, json: parse(ImportPickView, { ref, leftOut: pick.leftOut, alts: pick.alts, picks: pickTable(imports.picks) }, "pick") };
  }
  if (part?.startsWith("media/") && method === "GET" && view.status === "ready") return { status: 200, raw: FIXTURE_WEBP, type: "image/webp" };
  // The actions answer the import as it would stand, without changing what the other steps read.
  if (part === "cancel" && method === "POST") return { status: 200, json: { ...view, status: "cancelled", endedAt: new Date().toISOString() } };
  if (part === "stop" && method === "POST") return { status: 200, json: { ...view, status: "stopped", stopReason: "by_author", endedAt: new Date().toISOString(), undoable: view.progress.postsPublished > 0 } };
  if (part === "undo" && method === "POST") return { status: 200, json: { ...view, status: "undoing", undoable: false } };
  if (part === "confirm" && method === "POST") return { status: 200, json: { ...view, status: "publishing", samples: [], progress: { ...PROGRESS, postsTotal: 60 } } };
  return null;
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
   * a step sees the card roll back; and how long every action's answer waits, so a step sees the change before it. UI
   * Task 7: "decision" refuses the removed post's decision, and `delayMs` holds every decision's answer too.
   */
  refuse: Set<string>;
  delayMs: number;
  /** New posts above the timelines' first (UI Task 5): the poll finds them, and a reload reads them. */
  newPosts: number;
  /** How long each timeline answer waits, so a step can watch what the answer brings. */
  timelineDelayMs: number;
  /** The posts the reader wrote in the walk (UI Task 6), newest first: on top of the timelines, each with its own thread. */
  written: PostView[];
  /** 3b Task 7: the imports' switches, the new import's archive and chunks, and the ready import's picks. */
  imports: ImportFixtureState;
  /**
   * 2d Task 5: Activity's stored marker and every marker the app sent; the newer count the poll reads, and the entries a
   * next first page brings; the settings and every save; Following empty, as a new account's is; Ada's picture, how her
   * next upload ends ("ready", "refused" or "failed"), whether setting it is refused as a picture a moderator reset, and
   * every upload's query; the posts whose counts their author hid.
   */
  activity: { seenAt: string | null; seen: string[]; newer: number; fresh: number; settings: ActivitySettings; saves: ActivitySettings[] };
  emptyFollowing: boolean;
  avatar: { small: string; large: string } | null;
  upload: { outcome: "ready" | "refused" | "failed"; polls: number; reset: boolean; queries: string[] };
  hiddenCounts: Set<string>;
}

export interface FixtureApi {
  state: FixtureState;
  handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer): Promise<void>;
  /** What GET /api/cards/post/<id> answers, for the post page's handle: 204 for a post the API shows, 404 otherwise. */
  postStatus(id: string): number;
  /** 2d Task 6: what GET /api/cards/profile/<handle> answers, for the profile page's handle: 204 for a profile the API answers, 404 otherwise. */
  profileStatus(handle: string): number;
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
  const state: FixtureState = {
    signedIn: false,
    problems: [],
    requests: [],
    refuse: new Set(),
    delayMs: 0,
    newPosts: 0,
    timelineDelayMs: 0,
    written: [],
    imports: newImportState(),
    activity: { seenAt: ACTIVITY_SEEN, seen: [], newer: 0, fresh: 0, settings: { ...ACTIVITY_DEFAULTS }, saves: [] },
    emptyFollowing: false,
    avatar: null,
    upload: { outcome: "ready", polls: 0, reset: false, queries: [] },
    hiddenCounts: new Set(),
  };
  /** The written posts that are not replies, as timeline rows: the API puts the reader's own posts on top of both feeds. */
  const writtenRows = (): TimelineItem[] => state.written.filter((view) => view.replyTo === null).map((view) => ({ kind: "post" as const, post: view }));
  /** The written replies to one post, oldest first, as the replies route lists them. */
  const writtenReplies = (postId: string): PostView[] => state.written.filter((view) => view.replyTo?.id === postId).reverse();
  const ok = (json: unknown): Answer => ({ status: 200, json });
  const posts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => post(from + i, state.signedIn));

  /** The answer to one GET, or null when no fixture knows the path. */
  function get(path: string, query: URLSearchParams): Answer | null {
    const cursor = query.get("cursor");
    if (path === "/api/me") return state.signedIn ? ok({ ...me(), avatar: state.avatar }) : { status: 401, json: { error: { code: "unauthenticated", message: "Sign in to continue." } } };
    // 2d Task 5: a new account's Following is empty, and Home shows Getting started.
    if (path === "/api/timeline/following" && state.emptyFollowing) return ok(parse(TimelinePage, { items: [], nextCursor: null }, "empty following"));
    if (path === "/api/timeline/following" || path === "/api/timeline/latest") return ok(timeline(cursor, query.get("limit"), state.signedIn, state.newPosts, writtenRows()));
    // 2d Task 5: Activity's reads (9.2).
    if (path === "/api/activity") return ok(activityPage(query.get("tab"), cursor, state.signedIn, state.activity.fresh, state.activity.seenAt));
    if (path === "/api/activity/newer") return ok({ count: state.activity.newer });
    if (path === "/api/activity/settings") return ok(parse(ActivitySettings, state.activity.settings, "activity settings"));
    if (path === `/api/media/${AVATAR_UPLOAD_ID}`) {
      // The upload is processing at the first ask, and settled at the next, as the worker would leave it.
      state.upload.polls += 1;
      if (state.upload.polls < 2) return ok({ id: AVATAR_UPLOAD_ID, status: "processing" });
      if (state.upload.outcome === "refused") return ok({ id: AVATAR_UPLOAD_ID, status: "refused", refusalId: UPLOAD_ID });
      if (state.upload.outcome === "failed") return ok({ id: AVATAR_UPLOAD_ID, status: "failed", error: "corrupt_image" });
      return ok({ id: AVATAR_UPLOAD_ID, status: "ready", width: 400, height: 400 });
    }
    const avatarFile = /^\/api\/media\/([0-9a-f-]{36})\/(small|large)\.webp$/.exec(path);
    const owner = avatarFile ? (avatarFile[1] === AVATAR_UPLOAD_ID ? ADA_COLOUR : Object.values(AVATAR_OF).find((avatar) => avatar.id === avatarFile[1])?.colour) : undefined;
    if (avatarFile && owner) return { status: 200, raw: solidWebp(avatarFile[2] === "small" ? 128 : 400, owner), type: "image/webp" };
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
    const profilePath = /^\/api\/profiles\/([a-z0-9_]+)(?:\/(posts|replies|imported|followers|following))?$/.exec(path);
    if (profilePath) {
      const author = AUTHORS.find((a) => a.handle === profilePath[1]);
      if (!author) return null;
      const tab = profilePath[2];
      if (tab === undefined) return ok(profile(author, state.signedIn));
      if (tab === "posts") {
        // UI Task 7: Ada, signed in, reads her removed post first; Grace's profile starts with the post with a hidden image.
        const first = author.id === ADA.id ? (state.signedIn ? [removedPost(true)] : []) : author.id === GRACE.id ? [hiddenImagePost(state.signedIn)] : [];
        const items = [...first, ...posts(1, 12).map((view) => ({ ...view, author }))].map((view) => ({ kind: "post" as const, post: view }));
        return ok(parse(TimelinePage, { items, nextCursor: null }, "profile posts"));
      }
      if (tab === "replies") return ok(parse(PostPage, { items: [], nextCursor: null }, "replies"));
      // 3b Task 7: the Imported tab, Grace's alone.
      if (tab === "imported") return ok(parse(PostPage, { items: author.id === GRACE.id ? importedPosts(state.signedIn) : [], nextCursor: null }, "imported"));
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
    if (path === `/api/moderation/decisions/${POST_DECISION_ID}`) {
      if (state.refuse.has("decision")) return { status: 503, json: { error: { code: "unavailable", message: "korbat is busy. Try again in a moment." } } };
      return ok(postDecision());
    }
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
      // 2d (9.3): a count the post's author hid is null, and the answer keeps it null.
      if (kind === "like" && base.counts.likes !== null) counts.likes = base.counts.likes + (on ? 1 + OTHERS : 0);
      if (kind === "repost" && base.counts.reposts !== null) counts.reposts = base.counts.reposts + (on ? 1 : 0);
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
  function post_(path: string, body: Buffer, search = ""): Answer | null {
    // 2d Task 5: the seen marker, kept as the API keeps it (the later of the two), and an avatar's upload with its query.
    if (path === "/api/activity/seen") {
      const asked = JSON.parse(body.toString("utf8") || "{}") as { at?: string };
      if (typeof asked.at !== "string") return null;
      state.activity.seen.push(asked.at);
      if (state.activity.seenAt === null || asked.at > state.activity.seenAt) state.activity.seenAt = asked.at;
      return { status: 204 };
    }
    if (path === "/api/media") {
      state.upload.queries.push(search);
      state.upload.polls = 0;
      return ok({ id: AVATAR_UPLOAD_ID, status: "processing" });
    }
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
          imported: null,
          mentions: [],
          countsHidden: false,
        },
        "written post",
      );
      state.written.unshift(view);
      return ok(view);
    }
    return null;
  }

  /**
   * 2d Task 5: the writes of 9.2 the walk makes: Activity's settings (PUT), the avatar set (PUT, or avatar_reset while the
   * switch says so) and removed (DELETE), and a post's counts hidden or shown by its author (PATCH).
   */
  function change(method: string, path: string, body: Buffer): Answer | null {
    const asked = JSON.parse(body.toString("utf8") || "{}") as Record<string, unknown>;
    if (path === "/api/activity/settings" && method === "PUT") {
      const settings = parse(ActivitySettings, asked as ActivitySettings, "saved settings");
      state.activity.saves.push(settings);
      state.activity.settings = settings;
      return ok(settings);
    }
    if (path === "/api/me/avatar" && method === "PUT") {
      if (state.upload.reset) return { status: 409, json: { error: { code: "avatar_reset", message: "A moderator removed this picture from your profile less than 30 days ago, so it cannot be your profile picture again yet." } } };
      state.avatar = { small: `/api/media/${AVATAR_UPLOAD_ID}/small.webp`, large: `/api/media/${AVATAR_UPLOAD_ID}/large.webp` };
      return ok({ avatar: state.avatar });
    }
    if (path === "/api/me/avatar" && method === "DELETE") {
      state.avatar = null;
      return ok({ avatar: null });
    }
    const counts = /^\/api\/posts\/([0-9a-f-]{36})\/counts$/.exec(path);
    if (counts && method === "PATCH") {
      if (asked.hidden === true) state.hiddenCounts.add(counts[1]!);
      else state.hiddenCounts.delete(counts[1]!);
      return ok({ countsHidden: asked.hidden === true });
    }
    return null;
  }

  /** Walks an answer: Ada's views carry her picture, and a post whose counts are hidden gives others no number for them. */
  function adjust(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(adjust);
    if (value === null || typeof value !== "object") return value;
    const object = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, adjust(inner)])) as Record<string, unknown>;
    if (object.id === ADA.id && "avatar" in object && "handle" in object) object.avatar = state.avatar;
    if (typeof object.id === "string" && "countsHidden" in object && state.hiddenCounts.has(object.id)) {
      object.countsHidden = true;
      const author = object.author as { id?: string } | undefined;
      if (!(state.signedIn && author?.id === ADA.id)) object.counts = { ...(object.counts as object), likes: null, reposts: null };
    }
    return object;
  }

  return {
    state,
    postStatus: (asked) => (asked === POST_ID || asked === id(103) || state.written.some((view) => view.id === asked) ? 204 : 404),
    // The profiles GET /api/profiles/<handle> answers, compared as the card route compares a handle (an @ and the case left out).
    profileStatus: (asked) => (AUTHORS.some((author) => author.handle === asked.replace(/^@/, "").toLowerCase()) ? 204 : 404),
    async handle(req, res, url, body) {
      const method = req.method ?? "GET";
      state.requests.push({ method, path: `${url.pathname}${url.search}`, at: Date.now() });
      let answer: Answer | null = null;
      try {
        // 3b Task 7: an import's routes (9.2); a chunk whose answer the fixture loses closes its connection.
        const imported = url.pathname.startsWith("/api/imports") ? importAnswer(state.imports, method, url.pathname, url.searchParams, req.headers, body) : null;
        if (imported === "drop") {
          req.socket.destroy();
          return;
        }
        if (imported !== null) answer = imported;
        else if (method === "GET") answer = get(url.pathname, url.searchParams);
        else if (method === "POST") answer = post_(url.pathname, body, url.search) ?? action(method, url.pathname);
        else if (method === "DELETE") answer = change(method, url.pathname, body) ?? action(method, url.pathname);
        else if (method === "PUT" || method === "PATCH") answer = change(method, url.pathname, body);
        // 2d Task 5: Ada's picture on every view of her, and a post's hidden counts as each reader receives them.
        if (answer?.json !== undefined) answer = { ...answer, json: adjust(answer.json) };
        // An action's answer waits as long as the step asks, so the step sees the card change before it lands; from UI
        // Task 7 so does a decision's, so a step sees the details sheet's skeletons before the blocks.
        const held = method !== "GET" || url.pathname.startsWith("/api/moderation/decisions/");
        if (held && answer !== null && state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
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

### Replace `apps/app/test/browser/server.ts` (whole file)

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { IMPORT_RULES } from "@korbat/contracts";
import { appRoute, appSite, appSiteHeadersFromCaddyfile } from "./caddyfile";

/**
 * Caddy's app site as the browser check needs it (UI design, section 12.3), in a small Node server that takes its routes
 * and headers from infra/caddy/Caddyfile: a path the site proxies to the API goes to the fixture API; a post's page is
 * the export's index.html under the status the fixture API gives the post (204 gives 200, 404 gives 404, anything else
 * 200), as Caddy's /post/* handle asks GET /api/cards/post/<id> (2d Task 6; the status route before it), and a profile's
 * page the same under the status it gives the profile, as the /u/* handle asks GET /api/cards/profile/<handle>; the check
 * serves index.html for both, since Caddy's card.html is the image's and is drawn by the card lab; everything else is a file of the export, with
 * index.html for a path that names none (try_files), sent with the headers the site sets for the path asked for. With
 * `holdBundle` the entry bundle is answered two seconds late, so the walk can look at the first paint, which only
 * theme-boot.js has drawn. The page is opened at http://localhost:<port>, never 127.0.0.1: browsers refuse WebAuthn on an
 * address.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

/** The largest JSON body the app site lets through to the API (request_body max_size 64KB; Caddy's KB is 1000 bytes). */
const BODY_LIMIT = 64 * 1000;

/**
 * 3b Task 7: an import's chunk, which the Caddyfile's @import_chunk lets through at 9MB (decimal megabytes, the contracts'
 * IMPORT_RULES.chunkBodyBytes), the one body besides an image upload larger than BODY_LIMIT; every other body stays at it.
 */
const CHUNK_ROUTE = /^\/api\/imports\/[0-9a-f-]{36}\/archive$/;
const limitFor = (method: string | undefined, pathname: string): number => (method === "PUT" && CHUNK_ROUTE.test(pathname) ? IMPORT_RULES.chunkBodyBytes : BODY_LIMIT);

/** How long the entry bundle waits when it is held back. */
export const HOLD_MS = 2000;

/** Hands one API request to the fixtures, with its body read. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer) => Promise<void>;

/** What the fixture API says of a post's status, as GET /api/cards/post/<id> would: 204 shown, 404 not. */
export type PostStatus = (id: string) => number;

/** 2d Task 6: what it says of a profile's, as GET /api/cards/profile/<handle> would: 204 for a profile it answers, 404 not. */
export type ProfileStatus = (handle: string) => number;

export interface AppSiteServer {
  origin: string;
  /** Holds the entry bundle back two seconds while true. */
  state: { holdBundle: boolean };
  close(): Promise<void>;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The file a path names inside `dist`, or null: decoded once, and never outside the folder. */
async function fileFor(dist: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(dist, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

export async function startAppSite(options: { dist: string; api: ApiHandler; postStatus: PostStatus; profileStatus: ProfileStatus }): Promise<AppSiteServer> {
  const dist = path.resolve(options.dist);
  const block = appSite();
  const headersFor = appSiteHeadersFromCaddyfile();
  const state = { holdBundle: false };

  async function sendFile(req: IncomingMessage, res: ServerResponse, url: URL, file: string, named: boolean, status = 200): Promise<void> {
    const info = await stat(file);
    if (state.holdBundle && url.pathname.startsWith("/_expo/static/js/")) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    res.writeHead(status, { ...headersFor(url.pathname, named), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = appRoute(block, url.pathname);
      if (route.kind === "api") {
        const body = await readBody(req, limitFor(req.method, url.pathname));
        if (body === null) {
          res.writeHead(413).end();
          return;
        }
        await options.api(req, res, url, body);
        return;
      }
      if (route.kind === "own") {
        res.writeHead(route.status, route.headers).end(route.body);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (route.kind === "post" || route.kind === "profile") {
        // The second segment of the path, as Caddy's {http.request.uri.path.1} gives it: a post's id or a profile's handle.
        const segment = url.pathname.split("/")[2] ?? "";
        const status = route.kind === "post" ? options.postStatus(segment) : options.profileStatus(segment);
        await sendFile(req, res, url, path.join(dist, "index.html"), false, status === 404 ? 404 : 200);
        return;
      }
      const named = await fileFor(dist, url.pathname);
      await sendFile(req, res, url, named ?? path.join(dist, "index.html"), named !== null);
    })().catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
```

### Replace `apps/app/test/terms.test.tsx` (whole file)

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";
import * as contracts from "@korbat/contracts";
import * as rules from "@korbat/rules";

// The build's contact address, which Expo inlines at export time; set before the app's modules read it. 3f: the build's
// contact point for authorities and korbat's Member State, the web build's two arguments of the same kind.
const CONTACT = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTACT_EMAIL = "contact@korbat.local";
  process.env.EXPO_PUBLIC_CONTACT_POINT = "authorities@korbat.local";
  process.env.EXPO_PUBLIC_HOME_STATE = "DE";
  return "contact@korbat.local";
});
const CONTACT_POINT = "authorities@korbat.local";

import Terms from "../src/app/terms";
import { CONTACT_WORDS, numberWord } from "../src/lib/moderation-words";
import * as terms from "../src/lib/terms";

/**
 * The terms' moderation sections (3c design, sections 9 and 12): what the terms page gains and changes, and the table
 * tests that hold every number and every rule's text the terms print to its constant. A number is held twice: its
 * sentence is in the terms with the constant's value, and with other values in the constants the terms print those and
 * not one of the old ones, so no number is typed. The rulebook, the measures' labels and the outcomes' phrases are held
 * the same way. 3e (design, W.7) adds four sections, "Strikes", "Suspension and termination", "Reporting in bad faith" and
 * "Handles", whose numbers are STANDING_RULES', REPLY_AIM_HOURS', RETENTION.mailGiveUpDays' and APPEAL_MONTHS', and grows
 * RETENTION by three members: two numbers and one phrase, which the terms print as they print a rule's text. 3f (design,
 * W.6) adds "Authorities' orders" and "Contact point for authorities", rewrites "Terrorist content", grows four sections
 * by sentences and RETENTION by four members read from ORDER_RULES, whose two other numbers the terms print are held too.
 * 3d (design, W.9) adds "Automated tools" and "Transparency", whose numbers are AUTOMATION_RULES', changes four sections'
 * sentences, and grows "Your data" by a paragraph and RETENTION's printed list, with RETENTION's three new members, the
 * years of the records to authorities and the reader count's salt (RECIPIENT_RULES.saltHours).
 */
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
}));

type Contracts = typeof contracts;
type Rules = typeof rules;
type TermsModule = typeof terms;
type Section = { title: string; body: string };

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, entities read, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The sections 3c and 3e wrote or rewrote whole; of "Your data" they wrote every paragraph after the first, which older designs wrote. */
const MODERATION_TITLES = ["What you can post", "The rules", "Reports and notices", "How moderators decide", "Automated tools", "Appeals", "Strikes", "Suspension and termination", "Reporting in bad faith", "Handles", "Authorities' orders", "Terrorist content", "Contact point for authorities", "Transparency"];
const bodyOf = (t: TermsModule, title: string): string => t.TERMS_SECTIONS.find((section: Section) => section.title === title)?.body ?? "";
const paragraphsOf = (t: TermsModule, title: string): string[] => t.termsParagraphs(bodyOf(t, title));
/** What 3c added to "Your data". */
const dataParagraphs = (t: TermsModule): string[] => paragraphsOf(t, "Your data").slice(1);
/** The terms' moderation text, section by section: the name of the section each sentence is looked for in, and its text. */
const moderationText = (t: TermsModule): Record<string, string> => ({ ...Object.fromEntries(MODERATION_TITLES.map((title) => [title, bodyOf(t, title)])), "Your data": dataParagraphs(t).join(" ") });

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;
/** A share as the terms print it: half as a word, any other as a percentage. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/**
 * The table of numbers: every number of the constants the terms print, with the section and the sentence it stands in.
 * Built from whatever constants it is given, so the same table reads the terms as they are and the terms as they come out
 * with other numbers in the constants.
 */
function numbersTable(c: Contracts): { constant: string; section: string; phrase: string }[] {
  const { NOTICE_LIMITS: L, RETENTION: R, DAILY_LIMITS: D, STANDING_RULES: S, ORDER_RULES: O, AUTOMATION_RULES: A } = c;
  return [
    { constant: "NOTICE_LIMITS.signedOut.perHour", section: "Reports and notices", phrase: `at most ${L.signedOut.perHour} reports an hour and` },
    { constant: "NOTICE_LIMITS.signedOut.perDay", section: "Reports and notices", phrase: `and ${L.signedOut.perDay} a day from one network without an account` },
    { constant: "NOTICE_LIMITS.signedIn.perHour", section: "Reports and notices", phrase: `and ${L.signedIn.perHour} an hour and` },
    { constant: "NOTICE_LIMITS.signedIn.perDay", section: "Reports and notices", phrase: `${L.signedIn.perDay} a day from one account` },
    { constant: "NOTICE_LIMITS.maxTargets", section: "Reports and notices", phrase: `up to ${numberWord(L.maxTargets)} posts or profiles on korbat` },
    { constant: "NOTICE_LIMITS.explanationMax", section: "Reports and notices", phrase: `up to ${L.explanationMax} characters long` },
    { constant: "NOTICE_LIMITS.citedLawMax", section: "Reports and notices", phrase: `the law or country you cite up to ${L.citedLawMax}` },
    { constant: "CSAM_NOTICE_MAX_ACCOUNTS", section: "Reports and notices", phrase: `one report can name ${count(c.CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most` },
    { constant: "APPEAL_MONTHS", section: "Reports and notices", phrase: `once for a re-examination, within ${count(c.APPEAL_MONTHS, "month")} of being told` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `within ${count(c.APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow` },
    { constant: "DAILY_LIMITS.reexaminations", section: "Reports and notices", phrase: `at most ${count(D.reexaminations, "re-examination")} a day` },
    { constant: "DAILY_LIMITS.appeals", section: "Appeals", phrase: `at most ${count(D.appeals, "appeal")} a day` },
    { constant: "SUSPECT_EARLIER_MONTHS", section: "Your data", phrase: `in the last ${count(c.SUSPECT_EARLIER_MONTHS, "month")}` },
    { constant: "RETENTION.r4FinalMonths", section: "Your data", phrase: `${count(R.r4FinalMonths, "month")} after you were told` },
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `${count(R.intakeDays, "day")} after its last outcome was given and settled` },
    // The same period seen from a decision to take no action: the months of the re-examination's window, and these days.
    { constant: "RETENTION.intakeDays", section: "Your data", phrase: `at most about ${count(c.APPEAL_MONTHS + Math.ceil(R.intakeDays / 30), "month")} after a decision to take no action` },
    { constant: "RETENTION.resetValueDays", section: "Appeals", phrase: `for at least ${count(R.resetValueDays, "day")} after a reset that is lifted or ends` },
    { constant: "RETENTION.evidenceHours", section: "Your data", phrase: `when the case closes, or ${count(R.evidenceHours, "hour")} after its newest copy if that is later` },
    { constant: "RETENTION.statementMonths", section: "Your data", phrase: `for ${count(R.statementMonths, "month")} after its deletion` },
    { constant: "RETENTION.accessLogMonths", section: "Your data", phrase: `is kept for ${count(R.accessLogMonths, "month")}` },
    { constant: "RETENTION.contactMonths", section: "Your data", phrase: `deleted ${count(R.contactMonths, "month")} after the last day korbat still owed` },
    { constant: "RETENTION.contactMaxMonths", section: "Your data", phrase: `or ${count(R.contactMaxMonths, "month")} after the report if nothing moved that day` },
    { constant: "RETENTION.confirmationDays", section: "Reports and notices", phrase: `not been confirmed as its sender's in the last ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.confirmationDays", section: "Your data", phrase: `is kept for ${count(R.confirmationDays, "day")}` },
    { constant: "RETENTION.backupDays", section: "Your data", phrase: `deleted ${count(R.backupDays, "day")} after it was taken` },
    { constant: "RETENTION.draftHours", section: "Your data", phrase: `is deleted after ${count(R.draftHours, "hour")}` },
    { constant: "RETENTION.mailGiveUpDays", section: "Reports and notices", phrase: `could not send for ${count(R.mailGiveUpDays, "day")}` },
    // 3e (W.7): the four sections, each number from the constant the code that acts on it reads.
    { constant: "STANDING_RULES.strikeDays", section: "Strikes", phrase: `It counts for ${count(S.strikeDays, "day")} from its decision.` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Strikes", phrase: `ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `When your account has ${numberWord(S.ladderStrikes)} active strikes at once` },
    { constant: "STANDING_RULES.ladderStrikes", section: "Suspension and termination", phrase: `while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count` },
    ...([0, 1, 2] as const).map((rung) => ({
      constant: `STANDING_RULES.ladderDays.${rung}`,
      section: "Suspension and termination",
      phrase: `for at most ${count(S.ladderDays[0], "day")} the first time, ${numberWord(S.ladderDays[1])} the second and ${numberWord(S.ladderDays[2])} the third`,
    })),
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}` },
    { constant: "STANDING_RULES.ladderMemoryDays", section: "Suspension and termination", phrase: `that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account` },
    { constant: "STANDING_RULES.replyWindowHours", section: "Suspension and termination", phrase: `The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email.` },
    { constant: "STANDING_RULES.undeliveredHours", section: "Suspension and termination", phrase: `the suspension starts ${count(S.undeliveredHours, "hour")} after the decision` },
    { constant: "STANDING_RULES.threatDays", section: "Suspension and termination", phrase: `a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")};` },
    { constant: "STANDING_RULES.terroristDays", section: "Suspension and termination", phrase: `is terrorist content, for up to ${count(S.terroristDays, "day")};` },
    { constant: "STANDING_RULES.floodPosts", section: "Suspension and termination", phrase: `it made ${S.floodPosts} or more posts within` },
    { constant: "STANDING_RULES.floodMinutes", section: "Suspension and termination", phrase: `or more posts within ${count(S.floodMinutes, "minute")}, for up to` },
    { constant: "STANDING_RULES.floodDays", section: "Suspension and termination", phrase: `minutes, for up to ${count(S.floodDays, "day")}; and, as a protective suspension` },
    { constant: "STANDING_RULES.basisAgeDays", section: "Suspension and termination", phrase: `by a decision at most ${count(S.basisAgeDays, "day")} old` },
    { constant: "STANDING_RULES.protectiveDays", section: "Suspension and termination", phrase: `once for each such decision and for up to ${count(S.protectiveDays, "day")}.` },
    { constant: "REPLY_AIM_HOURS", section: "Suspension and termination", phrase: `korbat aims to answer a reply to a suspension taken at once within ${count(c.REPLY_AIM_HOURS, "hour")}.` },
    { constant: "RETENTION.mailGiveUpDays", section: "Suspension and termination", phrase: `cannot send the email for ${count(R.mailGiveUpDays, "day")}, only the app can tell you` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `your ${count(c.APPEAL_MONTHS, "month")} to appeal count again from that answer` },
    { constant: "APPEAL_MONTHS", section: "Suspension and termination", phrase: `It is final when the ${count(c.APPEAL_MONTHS, "month")} for your appeal have passed unused` },
    { constant: "APPEAL_MONTHS", section: "Appeals", phrase: `the ${count(c.APPEAL_MONTHS, "month")} to appeal it count from that answer` },
    { constant: "STANDING_RULES.reportWarnMarks", section: "Reporting in bad faith", phrase: `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `you sent under the rules within ${count(S.reportFrameDays, "day")} are marked` },
    { constant: "STANDING_RULES.reportFrameDays", section: "Reporting in bad faith", phrase: `while it counts, which is ${count(S.reportFrameDays, "day")},` },
    { constant: "STANDING_RULES.reportWarnShare", section: "Reporting in bad faith", phrase: `they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time` },
    { constant: "STANDING_RULES.reportRestrictMarks", section: "Reporting in bad faith", phrase: `If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked` },
    { constant: "STANDING_RULES.reportRestrictDays", section: "Reporting in bad faith", phrase: `for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted` },
    // "Your data": what 3e keeps, by RETENTION's three new members (two of them numbers read from STANDING_RULES).
    { constant: "RETENTION.standingRecord.strikeDays", section: "Your data", phrase: `a strike counts for ${count(R.standingRecord.strikeDays, "day")}` },
    { constant: "RETENTION.standingRecord.ladderMemoryDays", section: "Your data", phrase: `a suspension counts toward the next one for ${count(R.standingRecord.ladderMemoryDays, "day")}` },
    { constant: "RETENTION.standingRecord.warningDays", section: "Your data", phrase: `a warning about reporting for ${count(R.standingRecord.warningDays, "day")}` },
    { constant: "RETENTION.reportCountDays", section: "Your data", phrase: `both are deleted after ${count(R.reportCountDays, "day")} and with the account` },
    // 3f (W.6): what a removal order disabled, the records of orders and of authorities, the messages, the gaps, the address.
    { constant: "RETENTION.orderPreserveMonths", section: "Terrorist content", phrase: `with its images and a copy of its text, for ${count(R.orderPreserveMonths, "month")} from the disabling, as the Regulation requires` },
    { constant: "RETENTION.orderPreserveMonths", section: "Terrorist content", phrase: `since korbat erases it after the ${count(R.orderPreserveMonths, "month")} otherwise` },
    { constant: "RETENTION.orderPreserveMonths", section: "Your data", phrase: `content disabled under a removal order is kept ${count(R.orderPreserveMonths, "month")} and ${count(O.preserveMarginDays, "day")} from the disabling` },
    { constant: "ORDER_RULES.preserveMarginDays", section: "Your data", phrase: `is kept ${count(R.orderPreserveMonths, "month")} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `its records of authorities' orders for ${count(R.orderRecordYears, "year")} after the matter's last event, an order's record` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `the records of a notification or a production, are kept ${count(R.orderRecordYears, "year")} after the matter's last event` },
    { constant: "RETENTION.contactMessageDays", section: "Your data", phrase: `and deletes that record ${count(R.contactMessageDays, "day")} after the message was handled` },
    { constant: "RETENTION.contactMessageDays", section: "Your data", phrase: `contact point for authorities is kept ${count(R.contactMessageDays, "day")}, counted from the day the message was handled` },
    { constant: "RETENTION.restoreGapMonths", section: "Your data", phrase: `A gap a restore left is kept ${count(R.restoreGapMonths, "month")} when it was closed as not needed or imported` },
    { constant: "ORDER_RULES.reportHoldDays", section: "Your data", phrase: `and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address` },
    { constant: "ORDER_RULES.reportHoldDays", section: "Your data", phrase: `is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most` },
    // 3d (W.9): a program's limits and its target in "Automated tools", and what the tools and sealed images leave behind.
    { constant: "AUTOMATION_RULES.decisionsPerHour", section: "Automated tools", phrase: `It takes at most ${A.decisionsPerHour} measures an hour and` },
    { constant: "AUTOMATION_RULES.decisionsPerDay", section: "Automated tools", phrase: `measures an hour and ${A.decisionsPerDay} a day under rule R1` },
    { constant: "AUTOMATION_RULES.r2DecisionsPerHour", section: "Automated tools", phrase: `under rule R1, and ${A.r2DecisionsPerHour} and` },
    { constant: "AUTOMATION_RULES.r2DecisionsPerDay", section: "Automated tools", phrase: ` and ${A.r2DecisionsPerDay} under rule R2` },
    { constant: "AUTOMATION_RULES.unansweredMax", section: "Automated tools", phrase: `none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person` },
    { constant: "AUTOMATION_RULES.unansweredHours", section: "Automated tools", phrase: `a request for a person has waited longer than ${A.unansweredHours} hours` },
    { constant: "AUTOMATION_RULES.objectionTargetHours", section: "Automated tools", phrase: `korbat's target is that one answers within ${A.objectionTargetHours} hours` },
    { constant: "RETENTION.matchKeepDays", section: "Your data", phrase: `never your account) for ${count(R.matchKeepDays, "day")} after the case closed` },
    { constant: "RETENTION.matchKeepDays", section: "Your data", phrase: `the record of a match: ${count(R.matchKeepDays, "day")} after its case closed` },
    { constant: "RETENTION.reportHoldDays", section: "Your data", phrase: `korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal` },
    { constant: "RETENTION.reportHoldDays", section: "Your data", phrase: `was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal` },
    { constant: "RETENTION.edgePurgeDays", section: "Your data", phrase: `It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped` },
    { constant: "RETENTION.edgePurgeDays", section: "Your data", phrase: `a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `and for ${count(R.orderRecordYears, "year")} the record of a release` },
    { constant: "RETENTION.orderRecordYears", section: "Your data", phrase: `as korbat's records to authorities (${count(R.orderRecordYears, "year")})` },
    { constant: "RECIPIENT_RULES.saltHours", section: "Your data", phrase: `and the day's key after ${count(c.RECIPIENT_RULES.saltHours, "hour")}` },
    // 2d (design, section 11.3): how long an Activity entry is kept, the days the retention job deletes by.
    { constant: "ACTIVITY_KEEP_DAYS", section: "Your data", phrase: `and deletes it ${count(c.ACTIVITY_KEEP_DAYS, "day")} after it was written` },
  ];
}

/** The path of every number in a value, as the table names it. */
function numberPaths(name: string, value: unknown): string[] {
  if (typeof value === "number") return [name];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) => numberPaths(`${name}.${key}`, member));
}
/** Every number of the constants the terms must print, by its path. */
const constantPaths = (c: Contracts): string[] => [
  ...numberPaths("NOTICE_LIMITS", c.NOTICE_LIMITS),
  ...numberPaths("CSAM_NOTICE_MAX_ACCOUNTS", c.CSAM_NOTICE_MAX_ACCOUNTS),
  ...numberPaths("SUSPECT_EARLIER_MONTHS", c.SUSPECT_EARLIER_MONTHS),
  ...numberPaths("APPEAL_MONTHS", c.APPEAL_MONTHS),
  ...numberPaths("DAILY_LIMITS", c.DAILY_LIMITS),
  ...numberPaths("RETENTION", c.RETENTION),
  ...numberPaths("STANDING_RULES", c.STANDING_RULES),
  ...numberPaths("REPLY_AIM_HOURS", c.REPLY_AIM_HOURS),
  // 3f: of ORDER_RULES the terms print two numbers by themselves; the others they print through RETENTION, or not at all.
  ...numberPaths("ORDER_RULES.reportHoldDays", c.ORDER_RULES.reportHoldDays),
  ...numberPaths("ORDER_RULES.preserveMarginDays", c.ORDER_RULES.preserveMarginDays),
  // 3d: of AUTOMATION_RULES the terms print a program's six limits and the target of an answer; of RECIPIENT_RULES the salt's hours.
  ...(["decisionsPerHour", "decisionsPerDay", "r2DecisionsPerHour", "r2DecisionsPerDay", "unansweredMax", "unansweredHours", "objectionTargetHours"] as const).flatMap((key) => numberPaths(`AUTOMATION_RULES.${key}`, c.AUTOMATION_RULES[key])),
  ...numberPaths("RECIPIENT_RULES.saltHours", c.RECIPIENT_RULES.saltHours),
  // 2d: the days an Activity entry is kept.
  ...numberPaths("ACTIVITY_KEEP_DAYS", c.ACTIVITY_KEEP_DAYS),
];

/** A rule's name inside a sentence: its title without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");
/** A list in a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);
/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");
/** The phrases an answer to a report can read: the seven outcomes, and the three that stand in for them where nobody opened the images. */
const outcomePhrases = (c: Contracts): string[] => [...c.ITEM_OUTCOMES.map((outcome) => c.OUTCOME_PHRASES[outcome]), c.SUSPECT_OUTCOME_PHRASES.sealed, c.SUSPECT_OUTCOME_PHRASES.no_action, c.UNSEEN_NO_ACTION];

/** The sentence of the measures' paragraph that begins with these words, up to its full stop. */
function measuresSentence(t: TermsModule, lead: string): string {
  const paragraph = paragraphsOf(t, "How moderators decide").find((text) => text.includes("korbat's measures are these"));
  if (!paragraph) throw new Error("the terms have no paragraph of measures");
  const from = paragraph.indexOf(lead);
  if (from === -1) throw new Error(`the measures' paragraph has no sentence that begins "${lead}"`);
  return paragraph.slice(from, paragraph.indexOf(".", from) + 1);
}
const LEADS = {
  interim: "While korbat decides a case:",
  final: "When the case is decided:",
  either: "While it decides or when the case is decided:",
  // 3f Task 3: the measure an authority's order alone takes.
  byOrder: "On an authority's order alone, never on korbat's own judgement:",
  lifted: "A later decision can lift each of them again:",
};
/** The labels a sentence of the measures' paragraph quotes, in order. */
const labelsIn = (sentence: string): string[] => [...sentence.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);

/** What the tables below hold of the terms, read with the constants and the rulebook they were built from. */
function holds(t: TermsModule, c: Contracts, r: Rules): void {
  const text = moderationText(t);
  // Every number, in its sentence.
  for (const row of numbersTable(c)) expect(text[row.section], `${row.constant}: "${row.phrase}" in ${row.section}`).toContain(row.phrase);
  // Every rule, by its name in "What you can post" and with its number, title and text in "The rules".
  expect(text["What you can post"]).toContain(`(${r.RULES.map(ruleName).join(", ")})`);
  expect(paragraphsOf(t, "The rules").slice(1)).toEqual(r.RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`));
  expect(paragraphsOf(t, "The rules")[0]).toContain(`version ${r.RULES_VERSION} of its rulebook`);
  // The rules only an admin decides, and the one whose content is erased, are named from the rulebook.
  expect(text["How moderators decide"]).toContain(`under ${orList(r.RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id))} or on a report made on the anonymous path`);
  const r4 = r.RULES.find((rule) => rule.id === "R4")!;
  expect(text["Your data"]).toContain(`under rule R4 (${ruleName(r4)})`);
  expect(text["Appeals"]).toContain(`under rule R4 (${ruleName(r4)})`);
  // Every measure's label, in the sentence its two marks put it in; every reversal's in the last one.
  const kinds = { interim: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && !c.MEASURES[kind].final), final: c.MEASURE_KINDS.filter((kind) => !c.MEASURES[kind].interim && c.MEASURES[kind].final), either: c.MEASURE_KINDS.filter((kind) => c.MEASURES[kind].interim && c.MEASURES[kind].final) };
  for (const group of ["interim", "final", "either"] as const) expect(labelsIn(measuresSentence(t, LEADS[group])), group).toEqual(kinds[group].map((kind) => c.MEASURES[kind].label));
  expect(labelsIn(measuresSentence(t, LEADS.lifted))).toEqual(c.REVERSAL_KINDS.map((kind) => c.MEASURES[kind].label));
  // Every outcome's phrase, each in a paragraph of its own that says what it means.
  const answers = paragraphsOf(t, "Reports and notices").filter((paragraph) => paragraph.startsWith('"'));
  expect(answers.map((paragraph) => paragraph.slice(1, paragraph.indexOf('": ')))).toEqual(outcomePhrases(c).map(quoted));
  for (const paragraph of answers) expect(paragraph.slice(paragraph.indexOf('": ') + 3).length, paragraph).toBeGreaterThan(40);
  // 3e: the scope phrases of an answer that a measure on an account gave, the placeholder's prefix, and a reply's period.
  expect(text["Reports and notices"]).toContain(`the answer adds "${c.ACCOUNT_MEASURE_SCOPE.measure}", or "${c.ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle.`);
  expect(text["Handles"]).toContain(`Your profile then shows a placeholder that begins with ${c.RETIRED_HANDLE_PREFIX},`);
  expect(text["Handles"]).toContain(`Handles that begin with ${c.RETIRED_HANDLE_PREFIX} cannot be chosen.`);
  expect(text["Your data"]).toContain(`The text of a reply to a suspension is kept ${c.RETENTION.replyText}; a reply that is not answered yet is never erased.`);
}

describe("the terms' sections", () => {
  test("are these, in this order, under the draft's version: 3c adds five and rewrites two, 3e adds four after Appeals, 3f two around Terrorist content, without a new version", () => {
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).toEqual([
      "Draft",
      "Who can use korbat",
      "What you can post",
      "The rules",
      "Reports and notices",
      "How moderators decide",
      // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
      "Automated tools",
      "Appeals",
      "Strikes",
      "Suspension and termination",
      "Reporting in bad faith",
      "Handles",
      "Authorities' orders",
      "Terrorist content",
      "Contact point for authorities",
      // 3d (W.9): what korbat publishes.
      "Transparency",
      "Explore", "Importing posts", // 3b (11.3): after Explore, beside which it says where imported posts show; no line moves.
      "Your account",
      "Your data",
    ]);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
    // Contact is the page's, built from the build's address, and no section of the terms.
    expect(terms.TERMS_SECTIONS.map((section) => section.title)).not.toContain("Contact");
  });

  test("a section's body is its paragraphs, a blank line between two; none is empty or holds a line break of its own", () => {
    const blank = String.fromCharCode(10, 10);
    for (const section of terms.TERMS_SECTIONS) {
      const paragraphs = terms.termsParagraphs(section.body);
      expect(paragraphs.join(blank), section.title).toBe(section.body);
      for (const paragraph of paragraphs) {
        expect(paragraph.trim(), section.title).toBe(paragraph);
        expect(paragraph.length, section.title).toBeGreaterThan(0);
        expect(paragraph.includes(String.fromCharCode(10)), section.title).toBe(false);
      }
    }
    // The sections older designs wrote are one paragraph each, as they were.
    for (const title of ["Draft", "Who can use korbat", "Explore", "Your account"]) expect(paragraphsOf(terms, title), title).toHaveLength(1);
  });

  test("What you can post says when korbat restricts content: a published rule, each named from the rulebook, or the law and a notice; and that a final restriction can be appealed", () => {
    const names = rules.RULES.map(ruleName).join(", ");
    expect(names).toBe("sexual or pornographic content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, spam, scams, impersonation or coordinated manipulation");
    expect(paragraphsOf(terms, "What you can post")[0]).toBe(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${names}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
    );
    // The sentence 3c's code made false is gone from every section.
    for (const section of terms.TERMS_SECTIONS) {
      expect(section.body, section.title).not.toContain("Content is removed only when it breaks a published rule");
      expect(section.body, section.title).not.toContain("Every removal names the rule, and you can appeal it");
    }
  });

  test("Terrorist content is the policy the Regulation asks for, in the design's words (3f, W.6), its months from RETENTION", () => {
    expect(paragraphsOf(terms, "Terrorist content")).toEqual([
      "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
      "A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for six months from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.",
      "The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the six months otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.",
    ]);
    // The sentence that waited for korbat to open is gone: 3f carries an order out within the hour.
    expect(bodyOf(terms, "Terrorist content")).not.toContain("once korbat is open to the public");
  });

  test("Your data keeps what it said and gains 3c's paragraphs; the human check is named for a report sent signed out too", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    expect(first).toContain("At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy.");
    expect(first).not.toContain("At sign-in, Cloudflare Turnstile");
    // What 1a to 2c wrote there still stands.
    for (const kept of ["korbat stores your email address for sign-in and security messages", "a device keeps its hash for 30 days after it was last seen", "If you add a passkey, korbat keeps its public key", "you can export your account's data as a ZIP archive and delete your account"]) expect(first, kept).toContain(kept);
    expect(added.length).toBeGreaterThanOrEqual(8);
    const all = added.join(" ");
    for (const said of [
      "When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides.",
      "Deleting the post or your account leaves these copies until their period ends.",
      "they are left out of your account's export and are not released by korbat on its own",
      "so a later reversal cannot bring it back or show it to you again",
      "what korbat erased since included",
      "except a backup that korbat must keep for the authorities, which it keeps until they have answered",
      "never shown to staff or to the person reported",
      "in broad bands, never exact numbers",
      "the person reported never sees either",
      "as a number and a day",
      "Your account's export holds the decisions its Cases screens list and your own reports.",
      "where the law requires it after weighing the writer's rights, the words of a report without who wrote it",
    ]) expect(all, said).toContain(said);
  });

  test("the three sections of the procedure say what the design has them state", () => {
    const said: Record<string, string[]> = {
      "Reports and notices": [
        "Anyone can report a post, an image or a profile on korbat, signed in or not",
        "A report about a profile is decided on its display name and bio",
        "A report about a post that quotes another is decided on that post's own text and images",
        "korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email",
        "a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts",
        "your name and your email are optional",
        "Reports are anonymous towards the person you report",
        "A person looks at every report about something that is on korbat.",
        "A link that names nothing korbat can show is answered automatically, and the answer says so.",
        "never by how many reports an item has, and by who sent them only under the emergency switch",
        // 3d (W.9): the flag, which orders nothing.
        "When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
        "A report is never read after a less severe one, and every report is still read and answered.",
        "gets at most one receipt a day; the others come with the next daily email",
        "korbat sends no report email to an address whose holder asked it to stop",
        "korbat asks another moderator than the one who decided to take it when it has one",
        "says so and can be asked again",
        'this is what "illegality not evident" means',
        "An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told.",
        "For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page.",
      ],
      "How moderators decide": [
        // 3d (W.9): what a program may do until then is in Automated tools.
        "A moderator decides every case; what a program may do until then is in Automated tools.",
        "A moderator never decides about their own accounts or about accounts close to them.",
        "every lifting of a seal, and every correction of such a decision",
        "a moderator and an admin decide without seeing the images, on the report and on what korbat can read",
        "Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed",
        // 3d (review ruling 2, as rulebook version 4 words R2): never an image an automated comparison matched.
        "After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time.",
        "It hides the images from everyone, their author included, from the first seal, and never hides a post's text.",
        "A report of this kind about a post that quotes another opens a case on the quoted post too.",
        "korbat does not put the old value back",
        "korbat restricts the least it can: one image rather than the post, one field rather than the account.",
        "its statement then says that it changed nothing now",
        "comes with a statement of reasons, in the app at once and by email",
        "A decision to take no action is not sent to you, since it would tell you that someone reported you",
        "is recorded without being sent to you, since it can never take effect",
        "Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
      ],
      Appeals: [
        "you can appeal it once, while any of it is in force",
        'choose "Appeal" on the decision\'s screen under Settings, Cases',
        "What korbat does while it decides cannot be appealed.",
        // 3d (W.9).
        "What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
        "a seal ends with an admin's answer to the reports it was taken on",
        "made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case",
        "the appeal waits, without a time limit, and its screen says so",
        "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it.",
        "A decision reversed in full can no longer be appealed, since nothing of it remains.",
        "A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
        "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to.",
        "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // What the code does not do is not said: a decision a correction changed in part is still open to appeal, a report on a
    // rule gets no mail, and a case's copies are not kept a day past the close of a case that took longer than a day.
    expect(bodyOf(terms, "Appeals")).not.toContain("by a correction is final within korbat");
    expect(bodyOf(terms, "Reports and notices")).not.toContain("korbat sends its decisions on reports by email once a day");
    expect(bodyOf(terms, "Your data")).not.toContain("after the case closes");
  });
});

describe("3e's sections and sentences (design, W.7)", () => {
  test("Who can use korbat names what another account may not carry on, and points to the section that says it", () => {
    // 3f's sentence on the Member State follows it (the block below).
    expect(bodyOf(terms, "Who can use korbat").startsWith(
      "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).",
    )).toBe(true);
    expect(bodyOf(terms, "Who can use korbat")).not.toContain("to evade a suspension");
  });

  test("the four sections hold the design's paragraphs and sentences", () => {
    expect(paragraphsOf(terms, "Strikes")).toHaveLength(1);
    expect(paragraphsOf(terms, "Suspension and termination")).toHaveLength(6);
    expect(paragraphsOf(terms, "Reporting in bad faith")).toHaveLength(2);
    expect(paragraphsOf(terms, "Handles")).toHaveLength(1);
    const said: Record<string, string[]> = {
      Strikes: [
        "When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike.",
        "A strike restricts nothing by itself and is used for one thing: counting toward a suspension.",
        "A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding.",
        "so several posts decided in one sitting count as one warning",
        "A strike also counts when the post was already removed or deleted.",
        "your strikes are listed under Settings, Cases",
        "If that suspension was already over, it no longer counts toward a later one.",
      ],
      "Suspension and termination": [
        "A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step.",
        "After three such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides.",
        "Nothing happens automatically: a moderator reads the strikes and decides.",
        "Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.",
        "korbat cannot see whether an email it sent reached you, so keep the address of your account current.",
        "The app shows the start as a date and time.",
        "A reply sent later is read and answered too, and can end the suspension, but does not pause it.",
        "korbat suspends an account at once, before any reply, only in four cases, each decided by an admin",
        "the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted.",
        "Its appeal is reviewed at once and does not wait for the authorities.",
        "An announced suspension never rests on one of these four cases.",
        "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules.",
        "Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts.",
        "Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
        "A second post from before that suspension is no ground for it.",
        "nothing is deleted while your appeal or a reply of yours is unanswered",
        "deleting it ends your appeal, since nothing is left to restore",
        "After the deletion korbat keeps nothing to recognise a new account of yours by",
        "an appeal does not hold a start, only a reply does",
        "korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
      ],
      "Reporting in bad faith": [
        "Report what you believe breaks a rule; a report that turns out wrong costs you nothing.",
        "korbat acts only on reports that are manifestly unfounded",
        "You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination.",
        "a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
        "the count alone decides nothing",
        "Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted.",
        "You can appeal the warning and the restriction.",
      ],
      Handles: [
        "When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it.",
        "A retired handle can be used by nobody again, you included.",
        "you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends.",
        "nobody else could take it meanwhile",
        "also when the breach was someone's private information (rule R4): refusing it needs it.",
      ],
      Appeals: [
        "If a final decision restricts your content or your account, you can appeal it once",
        "An appeal never holds the start of a suspension; a reply does.",
        "The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.",
      ],
      "Reports and notices": [
        "When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long",
        "korbat does not tell you what happens to that account afterwards.",
      ],
      "Your data": [
        "korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use:",
        "To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded;",
        "so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.",
        "while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).",
      ],
    };
    for (const [title, sentences] of Object.entries(said)) for (const sentence of sentences) expect(bodyOf(terms, title), `${title}: ${sentence}`).toContain(sentence);
    // No text says more of a mail than korbat knows: it was sent, never delivered or handed over.
    const all = terms.TERMS_SECTIONS.map((section) => section.body).join(" ");
    expect(all).not.toMatch(/delivered|handed to your mail provider/);
    // A protective suspension is never worded as a finding.
    expect(bodyOf(terms, "Suspension and termination")).not.toContain("It breaks");
  });
});

describe("3f's sections and sentences (design, W.6)", () => {
  test("3f's review (people5): the measure only an order takes is shown to nobody, or to nobody but its author when the order does not ask that it be kept from them", () => {
    expect(measuresSentence(terms, LEADS.byOrder)).toBe(
      `${LEADS.byOrder} "${contracts.MEASURES.disable_by_order.label}" (the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it).`,
    );
  });

  test("3f's review (people8): both sentences on the contact point's records say that a message an order came with is kept as long as that order's records", () => {
    const data = paragraphsOf(terms, "Your data").join(" ");
    expect(data).toContain("deletes that record 30 days after the message was handled, or, when an order came with it, with that order's records.");
    expect(data).toContain("is kept 30 days, counted from the day the message was handled, or, when an order came with it, as long as that order's records;");
  });

  test("Authorities' orders holds the design's four paragraphs", () => {
    expect(paragraphsOf(terms, "Authorities' orders")).toEqual([
      "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
      "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
      "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
      "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
    ]);
  });

  test("Contact point for authorities prints the build's address; the languages are left out while the state's entry declares none", () => {
    expect(terms.CONTACT_POINT).toBe(CONTACT_POINT);
    expect(contracts.STATE_FACTS.DE!.languages).toBeNull();
    expect(paragraphsOf(terms, "Contact point for authorities")).toEqual([
      `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784). This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`,
    ]);
  });

  test("Who can use korbat names the build's Member State by its name in STATE_FACTS; What you can post points to Authorities' orders", () => {
    expect(bodyOf(terms, "Who can use korbat")).toBe(
      "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination). korbat is established in Germany and offers its service there only.",
    );
    expect(bodyOf(terms, "What you can post")).toContain("The one restriction that is not korbat's decision is an authority's order (Authorities' orders).");
  });

  test("Appeals says that korbat's appeal does not apply to an order, and when a held answer and a held decision's appeal count from", () => {
    const appeals = paragraphsOf(terms, "Appeals");
    const at = appeals.indexOf(
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
    );
    expect(at).toBeGreaterThan(-1);
    // Before the courts, which stay the section's last word.
    expect(at).toBe(appeals.length - 2);
  });

  test("Your data gains the four paragraphs and the periods of what concerns authorities, before the export's paragraph", () => {
    const data = paragraphsOf(terms, "Your data");
    const added = [
      "Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for seven days at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.",
      "korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for three years after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record 30 days after the message was handled, or, when an order came with it, with that order's records.",
      "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
      "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
      "The periods for what concerns authorities: content disabled under a removal order is kept six months and one day from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept three years after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept 30 days, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept 12 months when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, seven days at most.",
    ];
    const at = data.indexOf(added[0]!);
    expect(at).toBeGreaterThan(0);
    expect(data.slice(at, at + added.length)).toEqual(added);
    expect(data[at + added.length]).toMatch(/^Your account's export holds/);
  });

  describe("with other values of the build's two arguments and of STATE_FACTS", () => {
    /** The terms module as a build with these arguments, and these facts of the states, makes it. */
    async function built(env: { point?: string; state?: string }, facts?: Record<string, unknown>): Promise<TermsModule> {
      const saved = { point: process.env.EXPO_PUBLIC_CONTACT_POINT, state: process.env.EXPO_PUBLIC_HOME_STATE };
      vi.resetModules();
      if (env.point === undefined) delete process.env.EXPO_PUBLIC_CONTACT_POINT;
      else process.env.EXPO_PUBLIC_CONTACT_POINT = env.point;
      if (env.state === undefined) delete process.env.EXPO_PUBLIC_HOME_STATE;
      else process.env.EXPO_PUBLIC_HOME_STATE = env.state;
      if (facts) vi.doMock("@korbat/contracts", async (importOriginal) => ({ ...(await importOriginal<Contracts>()), STATE_FACTS: facts }));
      try {
        return await import("../src/lib/terms");
      } finally {
        vi.doUnmock("@korbat/contracts");
        process.env.EXPO_PUBLIC_CONTACT_POINT = saved.point;
        process.env.EXPO_PUBLIC_HOME_STATE = saved.state;
      }
    }

    test("without them the terms print no contact point and name no state, and every other section stands", async () => {
      const bare = await built({});
      const titles = bare.TERMS_SECTIONS.map((section) => section.title);
      expect(titles).not.toContain("Contact point for authorities");
      expect(titles).toEqual(terms.TERMS_SECTIONS.map((section) => section.title).filter((title) => title !== "Contact point for authorities"));
      expect(bodyOf(bare, "Who can use korbat")).not.toContain("korbat is established in");
      expect(bare.CONTACT_POINT).toBe("");
    });

    test("with the state's languages declared, the contact point names them; a state the contracts do not fill in is named by its code", async () => {
      const declared = await built({ point: CONTACT_POINT, state: "DE" }, { DE: { ...contracts.STATE_FACTS.DE!, languages: ["English", "German"] } });
      expect(bodyOf(declared, "Contact point for authorities")).toContain(`reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784), in English and German. This address is for authorities.`);
      const unknown = await built({ point: CONTACT_POINT, state: "AT" });
      expect(bodyOf(unknown, "Who can use korbat")).toContain("korbat is established in AT and offers its service there only.");
      expect(bodyOf(unknown, "Contact point for authorities")).toContain(`(Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784). This address`);
    });
  });
});

describe("3d's sections and sentences (design, W.9)", () => {
  test("Automated tools holds the design's four paragraphs, its numbers from AUTOMATION_RULES", () => {
    expect(paragraphsOf(terms, "Automated tools")).toEqual([
      "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
      "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
      "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
      `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most 20 measures an hour and 100 a day under rule R1, and 20 and 100 under rule R2, none under a rule while 20 of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than 72 hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within 24 hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
    ]);
  });

  test("Transparency says what korbat publishes, and the one count it keeps to publish it", () => {
    expect(paragraphsOf(terms, "Transparency")).toEqual([
      "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.",
    ]);
  });

  test("Your data: what korbat keeps on a report of child sexual abuse material it also keeps on a match; sealed images are kept for the authorities with no destruction promised and no period named; and a paragraph and RETENTION's list of what the tools leave behind, before 3f's", () => {
    const data = paragraphsOf(terms, "Your data");
    const all = data.join(" ");
    expect(all).toContain("For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post,");
    expect(all).toContain(
      "Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
    );
    const at = data.findIndex((paragraph) => paragraph.startsWith("While a comparison is switched on korbat keeps fingerprints"));
    expect(at).toBeGreaterThan(0);
    expect(data[at + 1]).toMatch(/^The periods for the automated tools and for sealed images: the record of a match: /);
    expect(data[at + 2]).toMatch(/^Two things the law can oblige korbat to keep/);
    for (const said of [
      "It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match.",
      "Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off.",
      "The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off.",
      "The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end,",
    ]) expect(all, said).toContain(said);
  });

  test("the words (section 12.2): no text promises a destruction or names a period for sealed images, none says more of a match than is known, and none says that a program does nothing to an account", () => {
    const all = terms.TERMS_SECTIONS.map((section) => section.body).join(" ");
    for (const banned of ["no longer holds", "destroyed it", "assessed them as illegal", "assessed it as illegal", "is child sexual abuse material", "korbat confirmed", "posted such", "does nothing to your account", "acts on an account", "Whatever it does"]) {
      expect(all.includes(banned), banned).toBe(false);
    }
    // A sentence on destroying sealed images names a leave or an instruction, never a period or an assessment.
    for (const sentence of all.split(/[.][ ]|[.]$|[.](?=[^a-z])/m).filter((part) => /destroy/i.test(part) && /sealed/i.test(part))) expect(sentence, sentence).not.toMatch(/after [0-9]+|within [0-9]+|days|months/);
    // The terms keep their version: 3d's sections are drafts, as 3c's, 3e's and 3f's were.
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
  });
});

describe("the table tests: the terms' numbers, rules, measures and outcomes are their constants'", () => {
  test("the table of numbers names every number of NOTICE_LIMITS, CSAM_NOTICE_MAX_ACCOUNTS, SUSPECT_EARLIER_MONTHS, APPEAL_MONTHS, DAILY_LIMITS, RETENTION, STANDING_RULES and REPLY_AIM_HOURS, and the two of ORDER_RULES the terms print", () => {
    expect([...new Set(numbersTable(contracts).map((row) => row.constant))].sort()).toEqual(constantPaths(contracts).sort());
  });

  test("the terms print every one of them in its sentence, every rule with its text, every measure's label in the sentence its marks put it in, and every outcome's phrase with what it means", () => {
    holds(terms, contracts, rules);
    // As they stand today, in the words a reader meets.
    const text = moderationText(terms);
    expect(text["Reports and notices"]).toContain("korbat takes at most 5 reports an hour and 20 a day from one network without an account, and 10 an hour and 50 a day from one account.");
    expect(text["Reports and notices"]).toContain("one report can name one profile at most");
    expect(text["Appeals"]).toContain("within six months of being told");
    expect(text["Your data"]).toContain("Each is deleted 30 days after it was taken");
    expect(text["How moderators decide"]).toContain("under R2 or R5 or on a report made on the anonymous path");
    expect(labelsIn(measuresSentence(terms, LEADS.interim))).toEqual(["Withhold the post", "Withhold one image"]);
    expect(labelsIn(measuresSentence(terms, LEADS.final))).toEqual(["Remove", "Remove one image", "Strike", "Suspend the account", "Terminate the account", "Retire the handle", "Warn about reporting", "Restrict reporting"]);
    // 2d Task 4 (7.7): the reset of a profile picture, taken while deciding or when the case is decided, as a field reset.
    expect(labelsIn(measuresSentence(terms, LEADS.either))).toEqual(["Seal the images this case reaches", "Reset display name", "Reset bio", "Reset profile picture"]);
    expect(measuresSentence(terms, LEADS.either)).toContain('"Reset profile picture" (the profile picture is removed, and the first letter of the display name is shown in its place)');
    expect(text["Reports and notices"]).toContain('"access restricted: it breaks korbat rule [number] ([title])": ');
    // 3e's numbers as a reader meets them.
    expect(text["Strikes"]).toContain("It counts for 90 days from its decision.");
    expect(text["Suspension and termination"]).toContain("for at most three days the first time, seven the second and 30 the third, counting the suspensions decided in the last 365 days");
    expect(text["Suspension and termination"]).toContain("The suspension starts 168 hours after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for five days, only the app can tell you, and the suspension starts 336 hours after the decision.");
    expect(text["Suspension and termination"]).toContain("it made 20 or more posts within 60 minutes, for up to seven days");
    expect(text["Suspension and termination"]).toContain("korbat aims to answer a reply to a suspension taken at once within 24 hours.");
    expect(text["Reporting in bad faith"]).toContain("If at least five of the reports you sent under the rules within 90 days are marked, and they are at least half of the reports you sent under the rules in that time");
    expect(text["Handles"]).toContain("a placeholder that begins with retired_,");
    expect(text["Your data"]).toContain("a strike counts for 90 days, a suspension counts toward the next one for 365 days, a warning about reporting for 90 days.");
    // 3f's numbers as a reader meets them.
    expect(text["Terrorist content"]).toContain("korbat keeps it, with its images and a copy of its text, for six months from the disabling");
    expect(text["Your data"]).toContain("and for seven days at most, korbat keeps the address");
    expect(text["Your data"]).toContain("A gap a restore left is kept 12 months when it was closed as not needed or imported");
    // 3d's numbers as a reader meets them.
    expect(text["Automated tools"]).toContain(
      "It takes at most 20 measures an hour and 100 a day under rule R1, and 20 and 100 under rule R2, none under a rule while 20 of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than 72 hours.",
    );
    expect(text["Automated tools"]).toContain("korbat's target is that one answers within 24 hours.");
    expect(text["Your data"]).toContain("for 180 days after the case closed, the hold ended or the images were released");
    expect(text["Your data"]).toContain("Your email address after an upload of yours was not accepted: up to seven days from the refusal");
    expect(text["Your data"]).toContain("The record that a cached copy was to be dropped: 30 days after it closed.");
    expect(text["Your data"]).toContain("and the day's key after 26 hours.");
    expect(text["Your data"]).toContain("as korbat's records to authorities (three years).");
  });

  test("the terms name no measure the constants lack and no ban; every kind of the ledger is quoted; and no number but the constants', the emergency switch's 48 hours and the Regulation's own", () => {
    const text = moderationText(terms);
    const all = Object.values(text).join(" ");
    // 3e names strikes, suspensions and retired handles (W.7), 3f an order's preservation (W.6); korbat bans nobody.
    expect(all).toMatch(/preserv/i);
    for (const absent of [/\bban(s|ned)?\b/i]) expect(absent.test(all), String(absent)).toBe(false);
    // The quoted labels are the ledger's 24 kinds (3f adds the order's measure and its reversal) and nothing else.
    const labels = Object.values(LEADS).flatMap((lead) => labelsIn(measuresSentence(terms, lead)));
    expect([...labels].sort()).toEqual(contracts.ACTION_KINDS.map((kind) => contracts.MEASURES[kind].label).sort());
    // Every run of digits outside the rulebook's own texts, a rule's number and the Regulation's articles is a constant's.
    const values = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "number") values.add(String(value));
      else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect([contracts.NOTICE_LIMITS, contracts.DAILY_LIMITS, contracts.RETENTION, contracts.CSAM_NOTICE_MAX_ACCOUNTS, contracts.SUSPECT_EARLIER_MONTHS, contracts.APPEAL_MONTHS, contracts.STANDING_RULES, contracts.REPLY_AIM_HOURS]);
    collect([contracts.ORDER_RULES.reportHoldDays, contracts.ORDER_RULES.preserveMarginDays]);
    collect([contracts.AUTOMATION_RULES, contracts.RECIPIENT_RULES.saltHours, contracts.IMPORT_RULES.recordDays]); // 3b Task 7: the import's record.
    collect([contracts.ACTIVITY_KEEP_DAYS]); // 2d Task 6: the days an Activity entry is kept.
    const outside = Object.entries(text)
      .filter(([title]) => title !== "The rules")
      .map(([, body]) => body)
      .join(" ")
      .replace(/Article [0-9]+ of /g, " ")
      .replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ")
      .replace(/\bR[1-6]\b/g, " ");
    const typed = (outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits));
    // The age of an account under the emergency switch has no constant: the queue's own query holds the same 48 hours.
    // 3f: and the scrutiny's 48 hours, TCO Art. 4(4)'s own period.
    expect(typed).toEqual(["48", "48"]);
    expect(text["Reports and notices"]).toContain("from accounts under 48 hours old");
    expect(text["Terrorist content"]).toContain("within 48 hours of receiving its reasons");
  });

  describe("with other numbers, another rulebook, other labels and other phrases in the constants", () => {
    let changed: { terms: TermsModule; contracts: Contracts; rules: Rules };

    beforeAll(async () => {
      vi.resetModules();
      // Every number of the constants becomes another, each its own and none a number the terms print today.
      let next = 100;
      const renumber = (value: unknown): unknown => {
        if (typeof value === "number") return ++next;
        if (Array.isArray(value)) return value.map(renumber);
        if (value === null || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, renumber(member)]));
      };
      vi.doMock("@korbat/contracts", async (importOriginal) => {
        const actual = await importOriginal<Contracts>();
        return {
          ...actual,
          NOTICE_LIMITS: renumber(actual.NOTICE_LIMITS),
          DAILY_LIMITS: renumber(actual.DAILY_LIMITS),
          // RETENTION's one phrase is changed too, as a rule's text is.
          RETENTION: { ...(renumber(actual.RETENTION) as object), replyText: "for the period of a reply's text" },
          STANDING_RULES: renumber(actual.STANDING_RULES),
          REPLY_AIM_HOURS: renumber(actual.REPLY_AIM_HOURS),
          // 3f: the two numbers of ORDER_RULES the terms print by themselves (the others through RETENTION).
          ORDER_RULES: renumber(actual.ORDER_RULES),
          // 3d: a program's limits and target, and the reader count's salt (the rest of RECIPIENT_RULES as it is).
          AUTOMATION_RULES: renumber(actual.AUTOMATION_RULES),
          RECIPIENT_RULES: { ...actual.RECIPIENT_RULES, saltHours: renumber(actual.RECIPIENT_RULES.saltHours) },
          // 2d Task 6: the days an Activity entry is kept, which the privacy text prints.
          ACTIVITY_KEEP_DAYS: renumber(actual.ACTIVITY_KEEP_DAYS),
          ACCOUNT_MEASURE_SCOPE: { retired: "the phrase of a retirement.", measure: "the phrase of an account measure." },
          RETIRED_HANDLE_PREFIX: "gone_",
          APPEAL_MONTHS: renumber(actual.APPEAL_MONTHS),
          CSAM_NOTICE_MAX_ACCOUNTS: renumber(actual.CSAM_NOTICE_MAX_ACCOUNTS),
          SUSPECT_EARLIER_MONTHS: renumber(actual.SUSPECT_EARLIER_MONTHS),
          // Other labels, and a removal that may also be taken while deciding: it moves to the third sentence.
          MEASURES: Object.fromEntries(Object.entries(actual.MEASURES).map(([kind, spec]) => [kind, { ...spec, label: `the label of ${kind}`, ...(kind === "remove" ? { interim: true } : {}) }])),
          OUTCOME_PHRASES: Object.fromEntries(actual.ITEM_OUTCOMES.map((outcome) => [outcome, outcome === "restricted_rule" ? "the phrase of restricted_rule {rule} ({title})" : `the phrase of ${outcome}`])),
          SUSPECT_OUTCOME_PHRASES: { sealed: "the phrase of a seal.", no_action: "the phrase of no action on that path." },
          UNSEEN_NO_ACTION: "the phrase of an answer given unseen.",
        };
      });
      vi.doMock("@korbat/rules", async (importOriginal) => {
        const actual = await importOriginal<Rules>();
        return {
          ...actual,
          RULES_VERSION: 9,
          // Other titles and texts, and a third rule that only an admin decides.
          RULES: actual.RULES.map((rule) => ({ ...rule, title: `No title of ${rule.id}`, text: `The text of ${rule.id}.`, seniorQueue: rule.seniorQueue || rule.id === "R3" })),
        };
      });
      changed = { terms: await import("../src/lib/terms"), contracts: await import("@korbat/contracts"), rules: await import("@korbat/rules") };
      vi.doUnmock("@korbat/contracts");
      vi.doUnmock("@korbat/rules");
    });

    test("the constants the terms were built from are the changed ones", () => {
      expect(changed.contracts.RETENTION.backupDays).not.toBe(contracts.RETENTION.backupDays);
      expect(changed.contracts.STANDING_RULES.strikeDays).not.toBe(contracts.STANDING_RULES.strikeDays);
      expect(changed.contracts.STANDING_RULES.ladderDays).toHaveLength(3);
      expect(changed.contracts.APPEAL_MONTHS).toBeGreaterThan(100);
      expect(changed.contracts.ORDER_RULES.reportHoldDays).toBeGreaterThan(100);
      expect(changed.contracts.AUTOMATION_RULES.decisionsPerHour).toBeGreaterThan(100);
      expect(changed.contracts.RECIPIENT_RULES.saltHours).toBeGreaterThan(100);
      expect(changed.contracts.ACTIVITY_KEEP_DAYS).toBeGreaterThan(100);
      expect(changed.rules.RULES_VERSION).toBe(9);
      expect(changed.terms).not.toBe(terms);
    });

    test("the terms print the changed numbers, rulebook, labels and phrases, each in its place", () => {
      holds(changed.terms, changed.contracts, changed.rules);
      const text = moderationText(changed.terms);
      expect(text["How moderators decide"]).toContain("under R2, R3 or R5 or on a report made on the anonymous path");
      expect(labelsIn(measuresSentence(changed.terms, LEADS.final))).toEqual(["remove_media", "strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting"].map((kind) => `the label of ${kind}`));
      expect(labelsIn(measuresSentence(changed.terms, LEADS.either))).toEqual(["the label of remove", "the label of seal_media", "the label of reset_display_name", "the label of reset_bio", "the label of reset_avatar"]);
      expect(text["What you can post"]).toContain("(title of R1, title of R2, title of R3, title of R4, title of R5, title of R6)");
    });

    test("and not one of today's: no number, rule title, rule text, label or phrase is typed into the terms", () => {
      const text = moderationText(changed.terms);
      const all = Object.values(text).join(" ");
      for (const row of numbersTable(contracts)) expect(text[row.section]!.includes(row.phrase), `${row.constant}: "${row.phrase}"`).toBe(false);
      for (const rule of rules.RULES) {
        expect(all.includes(rule.text), rule.id).toBe(false);
        expect(all.includes(rule.title), rule.id).toBe(false);
        // A rule's name is also a common word in these sections ("child sexual abuse material"), so it is looked for
        // where the terms list the rules by name, and in brackets, as a sentence names the rule on doxxing.
        expect(text["What you can post"]!.includes(ruleName(rule)), rule.id).toBe(false);
        expect(all.includes(`(${ruleName(rule)})`), rule.id).toBe(false);
      }
      for (const spec of Object.values(contracts.MEASURES)) expect(all.includes(`"${spec.label}"`), spec.label).toBe(false);
      for (const phrase of outcomePhrases(contracts)) expect(all.includes(quoted(phrase)), phrase).toBe(false);
      // 3e: the scope phrases, the placeholder's prefix and a reply's period are the constants', never typed.
      for (const phrase of [contracts.ACCOUNT_MEASURE_SCOPE.measure, contracts.ACCOUNT_MEASURE_SCOPE.retired, contracts.RETIRED_HANDLE_PREFIX, contracts.RETENTION.replyText]) expect(all.includes(phrase), phrase).toBe(false);
      // The only digits left that no changed constant printed are the emergency switch's and the Regulation's.
      const values = new Set<string>();
      const collect = (value: unknown): void => {
        if (typeof value === "number") values.add(String(value));
        else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
      };
      const c = changed.contracts;
      // 3e prints two numbers worked out from a constant: the earlier strikes after a suspension, and the share as a percentage.
      collect([c.NOTICE_LIMITS, c.DAILY_LIMITS, c.RETENTION, c.CSAM_NOTICE_MAX_ACCOUNTS, c.SUSPECT_EARLIER_MONTHS, c.APPEAL_MONTHS, c.APPEAL_MONTHS + Math.ceil(c.RETENTION.intakeDays / 30), changed.rules.RULES_VERSION]);
      collect([c.STANDING_RULES, c.REPLY_AIM_HOURS, c.STANDING_RULES.ladderStrikes - 1, c.STANDING_RULES.reportWarnShare * 100]);
      collect([c.ORDER_RULES.reportHoldDays, c.ORDER_RULES.preserveMarginDays]);
      collect([c.AUTOMATION_RULES, c.RECIPIENT_RULES.saltHours, c.IMPORT_RULES.recordDays]); // 3b Task 7: the import's record.
      collect([c.ACTIVITY_KEEP_DAYS]); // 2d Task 6: the days an Activity entry is kept.
      const outside = all.replace(/Article [0-9]+ of /g, " ").replace(/Article [0-9]+\([0-9]+\)|Regulation \(EU\) [0-9]+\/[0-9]+/g, " ").replace(/\bR[1-6]\b/g, " ");
      expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual(["48", "48"]);
    });
  });
});

describe("the terms page", () => {
  test("3d (design, section 9.1): it links the rules page and the transparency page under its sections, above the report form's link", () => {
    const out = html(<Terms />);
    const rules = out.indexOf('href="/rules"');
    const transparency = out.indexOf('href="/transparency"');
    const reportLink = out.indexOf('href="/report"');
    expect(rules).toBeGreaterThan(out.indexOf(">Contact<"));
    expect(transparency).toBeGreaterThan(rules);
    expect(reportLink).toBeGreaterThan(transparency);
  });

  test("shows every section under its heading and every paragraph of it, then Contact with the build's address and the link to the report form", () => {
    const out = html(<Terms />);
    const text = textOf(out);
    expect(text).toContain(`Version ${terms.TERMS_VERSION}`);
    let at = 0;
    for (const section of terms.TERMS_SECTIONS) {
      // Each heading after the one before it, with its paragraphs behind it in order.
      // A title's apostrophe is written as the markup escapes it (3f: "Authorities' orders").
      const heading = out.indexOf(`>${section.title.replaceAll("'", "&#x27;")}</`, at);
      expect(heading, section.title).toBeGreaterThan(at);
      at = heading;
      let within = textOf(out.slice(heading));
      for (const paragraph of terms.termsParagraphs(section.body)) {
        const found = within.indexOf(textOf(paragraph));
        expect(found, `${section.title}: ${paragraph.slice(0, 60)}`).toBeGreaterThan(-1);
        within = within.slice(found);
      }
    }
    // One level-2 heading for each section, and one for Contact.
    expect(out.split("<h2").length - 1).toBe(terms.TERMS_SECTIONS.length + 1);
    // Every paragraph is an element of its own: a reader gets them apart, not as one block. Its first words stand
    // directly behind an opening tag's end.
    const decoded = out.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">");
    for (const paragraph of terms.TERMS_SECTIONS.flatMap((section) => terms.termsParagraphs(section.body))) {
      const start = paragraph.slice(0, 40);
      expect(decoded.includes(`>${start}`), start).toBe(true);
    }
    expect(text).toContain(`Contact ${CONTACT_WORDS.body(CONTACT)}`);
    expect(text.indexOf("Your account's export holds")).toBeLessThan(text.indexOf("Contact Write to korbat"));
    expect(text.indexOf("Contact Write to korbat")).toBeLessThan(text.indexOf(CONTACT_WORDS.report));
    expect(out).toContain('href="/report"');
  });
});

describe("the web build's two arguments for the terms (3f, Task 7): the contact point for authorities and the home state", () => {
  const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
  const repo = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

  test("the terms read both from the build, and both example files carry the development values: no contact point, the API's state", () => {
    const source = repo("apps", "app", "src", "lib", "terms.ts");
    expect(source).toContain('export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";');
    expect(source).toContain('export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";');
    const infra = repo("infra", ".env.example");
    expect(infra).toMatch(/^WEB_CONTACT_POINT=$/m);
    expect(infra).toMatch(/^WEB_HOME_STATE=DE$/m);
    // The same two values the API holds, which the build cannot read.
    expect(infra).toMatch(/^API_CONTACT_POINT=$/m);
    expect(infra).toMatch(/^API_HOME_STATE=DE$/m);
    const app = repo("apps", "app", ".env.example");
    expect(app).toMatch(/^EXPO_PUBLIC_CONTACT_POINT=$/m);
    expect(app).toMatch(/^EXPO_PUBLIC_HOME_STATE=DE$/m);
  });

  test("the compose service passes both, neither required; the web image checks each when set and passes both to the export", () => {
    const compose = repo("infra", "compose.yml");
    expect(compose).toContain("EXPO_PUBLIC_CONTACT_POINT: ${WEB_CONTACT_POINT:-}");
    expect(compose).toContain("EXPO_PUBLIC_HOME_STATE: ${WEB_HOME_STATE:-}");
    const dockerfile = repo("infra", "caddy", "Dockerfile");
    for (const line of [
      "ARG EXPO_PUBLIC_CONTACT_POINT=",
      "ARG EXPO_PUBLIC_HOME_STATE=",
      'RUN case "$EXPO_PUBLIC_CONTACT_POINT" in "") ;; *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_POINT build argument must be empty or an email address" >&2; exit 1;; esac',
      `RUN case "$EXPO_PUBLIC_HOME_STATE" in "") ;; [A-Z][A-Z]) ;; *) echo "the EXPO_PUBLIC_HOME_STATE build argument must be empty or a Member State's two-letter code" >&2; exit 1;; esac`,
      'RUN if [ -n "$EXPO_PUBLIC_CONTACT_POINT" ] && [ -z "$EXPO_PUBLIC_HOME_STATE" ]; then echo "EXPO_PUBLIC_CONTACT_POINT needs EXPO_PUBLIC_HOME_STATE: the terms name the state whose authorities write to it" >&2; exit 1; fi',
      'RUN if [ "$KORBAT_ENV" = "production" ] && [ -n "$EXPO_PUBLIC_CONTACT_POINT" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_POINT##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_POINT is a placeholder address; a production build needs the address authorities write to" >&2; exit 1;; esac; fi',
      'EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web',
    ]) {
      expect(dockerfile, line).toContain(line);
      // Each check after KORBAT_ENV is declared and before the export.
      expect(dockerfile.indexOf("ARG KORBAT_ENV"), line).toBeLessThan(dockerfile.indexOf(line));
    }
    expect(dockerfile.indexOf("needs EXPO_PUBLIC_HOME_STATE")).toBeLessThan(dockerfile.indexOf("npx expo export"));
  });
});

// UI Task 8 appends below, so the lines above keep the numbers other tasks cite.
import { UI_WORDS } from "../src/lib/ui-words";
import { sourceFiles } from "./legacy-files";

describe("Your data names what the browser keeps (UI design, section 8.8)", () => {
  test("its first paragraph names every store the app keeps in the browser, when the account's go, and the button that clears them, with no new version", () => {
    const [first, ...added] = paragraphsOf(terms, "Your data");
    // The stores explore.test.tsx holds the source to, each named: the device id (lib/api.ts), the appearance
    // (lib/appearance.ts), the drafts (lib/drafts.ts), the passkey card's Not now (lib/passkeys.ts) and the reading places
    // (lib/reading-place.ts).
    const stores = sourceFiles().filter((file) => /localStorage|sessionStorage|indexedDB|AsyncStorage/.test(file.text));
    expect(stores.map((file) => file.name).sort()).toEqual(["lib/api.ts", "lib/appearance.ts", "lib/drafts.ts", "lib/passkeys.ts", "lib/reading-place.ts"]);
    for (const named of ["a random device id", "your appearance choices", "where you stopped reading in Following and Latest", "drafts you have not sent", "your Not now on the passkey card"]) {
      expect(first, named).toContain(named);
    }
    expect(first).toContain("until you sign out");
    expect(first).toContain(UI_WORDS["device.clear"]);
    // Beside the device id's sentence, which stays word for word; 3c's paragraphs after it and the version stay.
    expect(first).toContain("Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash.");
    expect(first.indexOf("your appearance choices")).toBeGreaterThan(first.indexOf("a random device id"));
    expect(added.length).toBeGreaterThanOrEqual(8);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
  });
});

// 3b Task 7 appends below: the terms' section on imports and the one licence (3b design, section 11.3).
describe("Importing posts (3b, 11.3)", () => {
  const R = contracts.IMPORT_RULES;
  const section = () => bodyOf(terms, "Importing posts");

  test("says what an import reads and never reads, the transit and the deletion by IMPORT_RULES' hours, where imported posts show and what korbat keeps", () => {
    const text = section();
    expect(text).toContain("korbat opens only the files of your archive that hold your posts and their images");
    expect(text).toContain("korbat's server and its network provider");
    expect(text).toContain(`within ${R.archiveHours} hours of the start`);
    expect(text).toContain(`within ${numberWord(R.workHours / 24)} days`);
    expect(text).toContain("Imported tab");
    expect(text).toContain("in no feed");
    expect(text).toContain("anyone who searches their words may find the originals");
    expect(text).toContain("the source, the day the archive gives it and a keyed hash");
    expect(text).toContain("never the other account");
    expect(text).toContain("that they are your own and that they were public");
    expect(text).toContain("rule R6");
    expect(text).toContain("same checks as uploads");
    expect(text).toContain("Remove imported posts");
    expect(text).toContain("named or pictured in an imported post can ask");
  });

  test("both sections name the one licence: What you can post grants it for every post and image, Importing posts points to it", () => {
    const licence = "korbat may store, show and send what you post as the service needs, until you delete it, except what the rules' records keep";
    expect(bodyOf(terms, "What you can post")).toContain(licence);
    expect(section()).toContain('the same licence as for any post (What you can post)');
    expect(section()).toContain("you must be able to grant it");
  });

  test("Your data gains the import's record and how long it is kept, by IMPORT_RULES' days, without a new version", () => {
    expect(bodyOf(terms, "Your data")).toContain(`at least ${R.recordDays} days after the import ended`);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
  });
});

// 2d Task 6 appends below: the privacy text's four drafts (2d design, section 11.3).
describe("2d's drafts in Your data (11.3)", () => {
  /** The four paragraphs, last in Your data, after the import's record. */
  const drafts = (): string[] => paragraphsOf(terms, "Your data").slice(-4);

  test("Your data ends with the four drafts, after the import's record, without a new version", () => {
    const data = paragraphsOf(terms, "Your data");
    expect(data.at(-5)).toMatch(/^An import's record/);
    const leads = ["Activity lists the replies to your posts,", "When a post names an account by its handle,", "A profile picture is public:", "When someone shares a link to a public post or profile"];
    expect(drafts().map((paragraph, n) => paragraph.startsWith(leads[n]!))).toEqual([true, true, true, true]);
    expect(terms.TERMS_VERSION).toBe("draft-2026-09");
  });

  test("Activity: what it stores and for how long, by ACTIVITY_KEEP_DAYS, its settings, and that no mail or push is sent about it", () => {
    const [activity] = drafts();
    expect(activity).toContain(`never a text, and deletes it ${contracts.ACTIVITY_KEEP_DAYS} days after it was written`);
    expect(activity).toContain("or sooner when its post is deleted, when one of the two accounts blocks the other or when either account is deleted");
    expect(activity).toContain("It also keeps when you last looked at Activity and your choices in Settings > Activity, as long as your account exists.");
    expect(activity).toContain("korbat sends no email and no push notification about Activity: you see it only when you open it.");
  });

  test("a mention links to the account it named when the post was written and tells that account, within its settings", () => {
    const [, mention] = drafts();
    expect(mention).toContain("korbat stores which account held that handle when the post was written");
    expect(mention).toContain("The handle links to that account only while it still holds the handle");
    expect(mention).toContain("that account is told in its Activity, as far as its own settings allow and never across a block");
    expect(mention).toContain("A handle in an imported post is plain text and tells no one.");
  });

  test("a profile picture is public, is checked like every image, can be reset by a moderator under the rules, and is deleted with the account", () => {
    const [, , picture] = drafts();
    expect(picture).toBe(
      "A profile picture is public: anyone who can see your profile, signed in or not, sees it. It passes the same checks as every image you upload, a moderator can reset it under the rules as a display name or a bio, and it is deleted with your account.",
    );
  });

  test("a shared link shows a generic card until its author turns previews on, then what a signed-out reader sees; other sites keep their copy; robots.txt and search engines", () => {
    const [, , , cards] = drafts();
    for (const said of [
      "that site shows a card that names only korbat, until the author turns on link previews in Settings > Privacy",
      "then the card shows what anyone sees without signing in",
      "never a count",
      "The sites that show a card keep their own copy, which korbat cannot change or delete, so a post deleted on korbat may still show there for a while.",
      "korbat's robots.txt turns away every automated visitor but the link-preview fetchers of the sites it names",
      "korbat asks search engines not to show its posts and profiles in their results, which a search engine may or may not honour.",
    ]) {
      expect(cards, said).toContain(said);
    }
  });

  test("the drafts type no number: the days are ACTIVITY_KEEP_DAYS', and with other days the terms print those", async () => {
    expect(drafts().join(" ").match(/[0-9]+/g)).toEqual([String(contracts.ACTIVITY_KEEP_DAYS)]);
    vi.resetModules();
    vi.doMock("@korbat/contracts", async (importOriginal) => ({ ...(await importOriginal<Contracts>()), ACTIVITY_KEEP_DAYS: 123 }));
    const changed: TermsModule = await import("../src/lib/terms");
    vi.doUnmock("@korbat/contracts");
    const text = changed.termsParagraphs(changed.TERMS_SECTIONS.find((section: Section) => section.title === "Your data")!.body).slice(-4).join(" ");
    expect(text).toContain("deletes it 123 days after it was written");
    expect(text).not.toContain(`${contracts.ACTIVITY_KEEP_DAYS} days`);
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
packages/db test:       Tests  131 passed (131)
packages/contracts test:       Tests  537 passed (537)
packages/media-protocol test:       Tests  28 passed (28)
packages/rules test:       Tests  138 passed (138)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/engagement-2d/write_blocks.py docs/superpowers/prompts/engagement-2d/06-share-cards-indexing-terms.md 3
```

Expected: 16 lines starting with `wrote`, one for each file below.

### Create `apps/api/src/cards/build.ts`

```ts
import { isHiddenMedia, type ImportedLabel, type MediaView, type PostView, type ProfileView } from "@korbat/contracts";
import { CARD_WORDS, fillCard, importedLabel } from "./words";

/**
 * 2d (design, sections 8.3 to 8.5): the share card's head block, built and escaped here and nowhere else. Caddy prints it,
 * decoded, into card.html through one template action that reads a placeholder; Go's templates never evaluate what an
 * action prints, and the block also writes the template delimiters as character references, so nothing a person wrote
 * is ever parsed as a template, even if it were.
 */

/** The block's bound before encoding (8.1), which cardBlock holds and cardHeader asserts. */
export const CARD_BLOCK_MAX_BYTES = 4096;
/** The header's bound: Korbat-Card is the block in base64, at most 6,000 bytes. */
export const CARD_HEADER_MAX_BYTES = 6000;
/** 8.5's lengths, in code points as the database counts them: X's title, a description, and X's image description. */
export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;
export const IMAGE_ALT_MAX = 420;

/**
 * What a card is built from: a generic card names the page only (decision 21, while the author's previews are off); a
 * post's and a profile's are what a signed-out reader sees of them (8.4), with paths as the API serves them.
 */
export type CardSource =
  | { kind: "generic"; page: "post"; id: string }
  | { kind: "generic"; page: "profile"; handle: string }
  | {
      kind: "post";
      id: string;
      displayName: string;
      handle: string;
      body: string;
      imported: ImportedLabel | null;
      /** The first image shown to everyone, with its own size and description; null when it has none. */
      image: { large: string; width: number; height: number; alt: string } | null;
      /** The author's picture's large square, the image when the post has none; null when there is none to show. */
      avatar: string | null;
      createdAt: string;
    }
  | { kind: "profile"; handle: string; displayName: string; bio: string; avatar: string | null };

/** A post's card from its view as a signed-out reader gets it: its own text and images, never its parent's or a quoted post's. */
export function postCard(view: PostView, previews: boolean): CardSource {
  if (!previews) return { kind: "generic", page: "post", id: view.id };
  // A signed-out reader gets a hidden image's placeholder in its place, and never an image with a moderation state (that
  // is the author's own view): either is passed over.
  const shown = view.media.find((item): item is MediaView => !isHiddenMedia(item) && item.moderation === undefined);
  return {
    kind: "post",
    id: view.id,
    displayName: view.author.displayName,
    handle: view.author.handle,
    body: view.body,
    imported: view.imported,
    image: shown ? { large: shown.large, width: shown.width, height: shown.height, alt: shown.alt } : null,
    avatar: view.author.avatar?.large ?? null,
    createdAt: view.createdAt,
  };
}

/** A profile's card from its view as a signed-out reader gets it: never a count, the verified mark or a standing. */
export function profileCard(view: ProfileView, previews: boolean): CardSource {
  if (!previews) return { kind: "generic", page: "profile", handle: view.handle };
  return { kind: "profile", handle: view.handle, displayName: view.displayName, bio: view.bio, avatar: view.avatar?.large ?? null };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" };

/** A value for a double-quoted attribute: the five of HTML, and the template delimiters as character references (8.5). */
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"'{}]/g, (char) => ESCAPES[char]!);
}

/** The block's line separator, a line feed. */
const LF = String.fromCharCode(10);
/** Every character that breaks a line: carriage return, line feed, and the line and paragraph separators, built in code. */
const LINE_BREAKS = new RegExp(`[${String.fromCharCode(13, 10, 0x2028, 0x2029)}]+`, "g");

/** Text as a card shows it: stored text is already normalised, and each run of line breaks becomes one space. */
export function cardText(text: string): string {
  return text.replace(LINE_BREAKS, " ");
}

/** At most `max` code points: longer text keeps its first max - 3 and ends with "...", never splitting a character. */
function clip(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max - 3).join("")}...`;
}

/**
 * At most `max` code points, cut at a word: longer text ends at its last space within the first max - 3 code points (a
 * space right after them included) and gets "..."; text with no such space is cut at max - 3, as a body of one word is.
 */
function clipAtWord(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  const room = max - 3;
  const space = points.lastIndexOf(" ", room);
  return `${points
    .slice(0, space > 0 ? space : room)
    .join("")
    .trimEnd()}...`;
}

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");
const meta = (attribute: "name" | "property", key: string, value: string): string => `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`;

/** The lines joined, held to the block's bound: a block over it is a fault of the builder or of APP_ORIGIN, never sent cut. */
function bounded(lines: string[]): string {
  const block = lines.join(LF);
  if (bytes(block) > CARD_BLOCK_MAX_BYTES) throw new Error(`a share card's block of ${bytes(block)} bytes is over ${CARD_BLOCK_MAX_BYTES}`);
  return block;
}

/**
 * The one builder of every block (8.3): each tag a meta element on its own line, in 8.3's order, every value escaped. A
 * generic card names only the page's address and korbat. Of a post's or a profile's card the image's description gives
 * way last: it is cut to 420 code points and then, with "...", to what keeps the block within 4,096 bytes, which a title
 * and a description at their limits leave room for (8.5's three limits in four-byte characters, or in characters
 * escaped to six bytes, would otherwise pass the bound).
 */
export function cardBlock(appOrigin: string, source: CardSource): string {
  // The origin alone, so a trailing slash or a path in the setting is no part of a card's address.
  const origin = new URL(appOrigin).origin;
  const head = [meta("name", "robots", "noindex"), meta("property", "og:site_name", CARD_WORDS["card.siteName"])];
  if (source.kind === "generic") {
    const [url, title] = source.page === "post" ? [`${origin}/post/${source.id}`, CARD_WORDS["card.post.generic"]] : [`${origin}/u/${source.handle}`, CARD_WORDS["card.profile.generic"]];
    return bounded([...head, meta("property", "og:type", "website"), meta("property", "og:url", url), meta("property", "og:title", title), meta("name", "twitter:card", "summary")]);
  }

  const title = clip(fillCard(CARD_WORDS["card.title"], { displayName: cardText(source.displayName), handle: source.handle }), TITLE_MAX);
  let description: string | null;
  if (source.kind === "post") {
    const text = cardText(source.body);
    // An imported post's label first, then a full stop and the text (8.4), all within the description's length: the text is
    // cut by the same rule in the room the label leaves, so a label's own spaces are never where the text ends.
    const label = source.imported === null ? null : importedLabel(source.imported);
    if (label === null) description = text === "" ? null : clipAtWord(text, DESCRIPTION_MAX);
    else description = text === "" ? `${label}.` : `${label}. ${clipAtWord(text, DESCRIPTION_MAX - Array.from(`${label}. `).length)}`;
  } else {
    const bio = cardText(source.bio);
    description = bio === "" ? null : clipAtWord(bio, DESCRIPTION_MAX);
  }

  const avatarAlt = fillCard(CARD_WORDS["card.avatar.alt"], { handle: source.handle });
  const image =
    source.kind === "post" && source.image !== null
      ? { url: `${origin}${source.image.large}`, size: { width: source.image.width, height: source.image.height }, alt: source.image.alt, large: true }
      : source.avatar !== null
        ? // An avatar's view carries no size, and its large square is 400 px or less (never enlarged): no width or height.
          { url: `${origin}${source.avatar}`, size: null, alt: avatarAlt, large: false }
        : null;

  const lines = (alt: string): string[] => [
    ...head,
    meta("property", "og:type", source.kind === "post" ? "article" : "profile"),
    meta("property", "og:url", source.kind === "post" ? `${origin}/post/${source.id}` : `${origin}/u/${source.handle}`),
    meta("property", "og:title", title),
    ...(description === null ? [] : [meta("property", "og:description", description), meta("name", "description", description)]),
    ...(image === null
      ? []
      : [
          meta("property", "og:image", image.url),
          meta("property", "og:image:type", "image/webp"),
          ...(image.size === null ? [] : [meta("property", "og:image:width", String(image.size.width)), meta("property", "og:image:height", String(image.size.height))]),
          meta("property", "og:image:alt", alt),
        ]),
    source.kind === "post" ? meta("property", "article:published_time", source.createdAt) : meta("property", "profile:username", source.handle),
    meta("name", "twitter:card", image?.large ? "summary_large_image" : "summary"),
  ];

  if (image === null) return bounded(lines(""));
  // The room the rest of the block leaves the image's description, in escaped bytes.
  const room = CARD_BLOCK_MAX_BYTES - bytes(lines("").join(LF));
  let max = Math.min(IMAGE_ALT_MAX, Array.from(image.alt).length);
  let alt = clip(image.alt, IMAGE_ALT_MAX);
  while (bytes(escapeAttribute(alt)) > room && max > 3) alt = clip(image.alt, --max);
  if (bytes(escapeAttribute(alt)) > room) alt = "";
  return bounded(lines(alt));
}

/** The header Caddy reads: the block in UTF-8 and base64, asserted within both bounds. */
export function cardHeader(block: string): string {
  if (bytes(block) > CARD_BLOCK_MAX_BYTES) throw new Error(`a share card's block of ${bytes(block)} bytes is over ${CARD_BLOCK_MAX_BYTES}`);
  const header = Buffer.from(block, "utf8").toString("base64");
  if (header.length > CARD_HEADER_MAX_BYTES) throw new Error(`a share card's header of ${header.length} bytes is over ${CARD_HEADER_MAX_BYTES}`);
  return header;
}
```

### Create `apps/api/src/cards/index.ts`

```ts
/**
 * The cards module (2d design, sections 8.1 and 9.1): the share cards of a public post's page and a profile's page, which
 * Caddy's /post/* and /u/* handles ask for at every view and print into the shell's head. The only file outside
 * `src/cards/` may import. It owns no table: it reads a post or a profile through the social module's interface for cards,
 * exactly as a signed-out reader gets it, and builds the block in build.ts.
 */
import { HandleParam, PostId } from "@korbat/contracts";
import { Hono } from "hono";
import type { SocialForCards } from "../social";
import { cardBlock, cardHeader, postCard, profileCard } from "./build";

export { CARD_WORDS } from "./words";

export interface CardsDeps {
  /** The social module's interface for cards: a post or a profile as a signed-out reader gets it, with its link-preview switch. */
  social: SocialForCards;
  /** APP_ORIGIN, the app's own origin: every address a card names is built on it. */
  appOrigin: string;
}

/**
 * GET /api/cards/post/:id and GET /api/cards/profile/:handle (8.1), a router of its own that app.ts mounts beside the status
 * route of 3f: after the global limit, which counts the question against the visitor (decision 30), and before the
 * session's resolution, so a card is the same for everyone, whatever cookies or token the visitor's request carries. Each
 * answers 204 with no body and the block in Korbat-Card, or 404 with no body and no header: a post not shown to a
 * signed-out reader, an author or a profile deleted, an old or unknown handle, and a malformed id or handle, which each
 * route parses itself, since the validator would answer it with a JSON body. Cache-Control is the API's no-store.
 */
export function createCards(deps: CardsDeps) {
  const r = new Hono();
  r.get("/cards/post/:id", async (c) => {
    const id = PostId.safeParse(c.req.param("id"));
    if (!id.success) return c.body(null, 404);
    const found = await deps.social.post(id.data);
    if (found === null) return c.body(null, 404);
    return c.body(null, 204, { "Korbat-Card": cardHeader(cardBlock(deps.appOrigin, postCard(found.view, found.previews))) });
  });
  r.get("/cards/profile/:handle", async (c) => {
    // A handle as a profile's page takes it: a leading @ and any case, compared lowercased as the profile's read compares it.
    const handle = HandleParam.safeParse(c.req.param("handle"));
    if (!handle.success) return c.body(null, 404);
    const found = await deps.social.profile(handle.data);
    if (found === null) return c.body(null, 404);
    return c.body(null, 204, { "Korbat-Card": cardHeader(cardBlock(deps.appOrigin, profileCard(found.view, found.previews))) });
  });
  return {
    /** Mounted at /api by app.ts, beside the status route. No interface member: nothing outside this module calls it. */
    routes: r,
  };
}

export type Cards = ReturnType<typeof createCards>;
```

### Create `apps/api/src/cards/words.ts`

```ts
import type { ImportedLabel } from "@korbat/contracts";

/**
 * 2d (design, section 8.6): every sentence of a share card. The API has no reader and no locale, so these are English and
 * fixed. The imported label is the API's own copy of 3b's `import.label`, `import.label.shortened` and each source's
 * `import.sourceName` (apps/app/src/lib/import-words.ts), which the API cannot import from the app; a unit test holds the
 * two equal.
 */
export const CARD_WORDS = {
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
} as const;

/** A sentence with each {name} put in from `values`; a name with no value stays as written. */
export function fillCard(sentence: string, values: Record<string, string>): string {
  return sentence.replace(/[{]([a-zA-Z]+)[}]/g, (whole: string, name: string) => values[name] ?? whole);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * An archive's day (YYYY-MM-DD, already in UTC) in the one fixed form a card uses, "3 March 2019": read as a UTC date, so
 * the server's own zone never moves it.
 */
export function cardDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** An imported post's label as a card says it: its source's name and the archive's day, and whether it was shortened. */
export function importedLabel(label: ImportedLabel): string {
  const source = CARD_WORDS[`card.source.${label.source}`];
  return fillCard(CARD_WORDS["card.imported"], { source, date: cardDay(label.at) }) + (label.shortened ? CARD_WORDS["card.imported.shortened"] : "");
}
```

### Create `infra/caddy/lab/README.md`

````markdown
# The card lab

`card-lab.mjs` checks korbat's share cards in Caddy itself (2d design, sections 8.2 and 12.4), without the rest of the
stack and without fetching any real site. It starts the Caddy image built from `infra/caddy/Dockerfile` beside a stub API
of a few lines (Caddy again, from the same image) that answers the card routes as the API would, and asks for every page
from this machine and from a client on the push network.

## Running it

From the repository root, with Docker running:

```
node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab
node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab --image korbat-caddy
```

- `--prefix` names everything the lab makes: the image `<prefix>-caddy` (when it builds one), the networks
  `<prefix>-app` and `<prefix>-push`, and the containers `<prefix>-api`, `<prefix>-caddy` and `<prefix>-client`. The lab
  removes all of them at its end, whether it passed or not, and touches no other image, network or container.
- `--image` uses an image already built, such as the stack's Caddy after `docker compose build`. Without it the lab builds
  one with Cloudflare's Turnstile test key and a development contact address; the web export runs inside, which takes
  minutes.
- `--port` (18381 by default) is the local port the lab's Caddy listens on, at 127.0.0.1 only.
- `--push-subnet` (172.16.193.0/24 by default) is the push network's subnet, which the lab gives Caddy as `PUSH_SUBNET`.
  It must not overlap a network Docker already has.

It prints one line a check, its measurements, and `card lab passed`; otherwise each failed check and `card lab FAILED`,
with exit code 1.

## What it checks

- `caddy list-modules` lists `http.handlers.templates`, and `card.html` is the exported `index.html` with one line more:
  the template action right after the charset's meta element, the file's only `{{`. robots.txt in `/srv` is
  `infra/caddy/robots.txt`.
- `/post/card` and `/u/card`, whose card route answers 204 with a block: `card.html` with the block decoded once in its
  head, status 200, `Cache-Control: no-cache`, `X-Robots-Tag: noindex` and the shell's security headers; the
  `Korbat-Card` header never reaches the client. The profile's block is just under the API's bound of 4,096 bytes and both
  hold a four-byte character.
- A block holding `{{ .Env }}` and `{{env "HOME"}}`, unescaped, is printed as text: neither Caddy's environment nor its
  `HOME` appears.
- A card route's 404 gives the plain shell with 404; its 429 the plain shell with 200; an API that drops the connection
  the plain shell with 200 through `handle_errors`; for a post's page and a profile's.
- `/card.html` asked by its own path answers 404 with no body; `/robots.txt` answers the file byte for byte.
- `X-Robots-Tag: noindex` on `/post/`, `/u/`, `/settings/appearance` and a `handle_errors` answer, and none on `/`,
  `/rules`, `/transparency`, `/explore/about` and `/terms`.
- A client on the push network is answered 403 on `/u/x` and `/post/x`.
- Each fetcher of `crawlers.json` (Twitterbot, facebookexternalhit with Meta's `Range: bytes=0-524288`,
  Slackbot-LinkExpanding with a range, Discordbot, LinkedInBot and Mastodon's fetcher, all with
  `Accept-Encoding: gzip, deflate` and no cookie) gets the same answer on both pages as a request with no User-Agent: a
  whole 200, never 206, with the Open Graph tags within the first 524,288 bytes and before `<title>`, which is `korbat`.

## crawlers.json

The request shapes of the link-preview fetchers, as their official pages give them (korbat-scratch/research-2d/inputs.md,
sections 3.2 and 3.3); a `note` says where a value is not from an official page. `robotsToken` is the agent's name in
`robots.txt`, null for a fetcher it does not name. The console's test `console-site.test.ts` holds the named agents of
`robots.txt` equal to these tokens, and the stack's smoke test reads Twitterbot's User-Agent from here.
````

### Create `infra/caddy/lab/card-lab.mjs`

```js
#!/usr/bin/env node
/**
 * The card lab (2d design, sections 8.2 and 12.4): korbat's Caddy image, as built from infra/caddy/Dockerfile, started
 * beside a stub API of a few lines (Caddy itself, from the same image) that answers the card routes with 204 and a block,
 * 404, 429, or not at all, and asked for every page of 8.2 from this machine and from the push network. It asserts:
 *   - `caddy list-modules` lists http.handlers.templates, and card.html holds the one template action once;
 *   - each page's status and bytes: card.html with the block decoded once in its head for 204, the plain shell with 404
 *     for 404, with 200 for a 429 and for an API that does not answer (handle_errors), for a post's page and a profile's;
 *   - a block holding {{ .Env }} and {{env "HOME"}} is written out as text, never evaluated;
 *   - /card.html asked by its own path answers 404; robots.txt is infra/caddy/robots.txt, byte for byte;
 *   - X-Robots-Tag on /post/, /u/, /settings/appearance and a handle_errors answer, absent on /, /rules, /transparency,
 *     /explore/about and /terms;
 *   - a client on the push network is answered 403 on /u/x;
 *   - each crawler of crawlers.json gets the same answer for both pages, whatever its User-Agent, a ranged request a whole
 *     200 (never 206), with the Open Graph tags within the first 524,288 bytes and before <title>, which is "korbat".
 * It prints its measurements and "card lab passed", or each failed check and exits 1.
 *
 * Every image, network and container it makes is named with --prefix and removed at its end; it touches nothing else.
 * Without --image it builds the image itself (the web export runs inside, which takes minutes); with --image it uses one
 * already built, the stack's korbat2b-caddy for one.
 *
 * Usage, from the repo root:
 *   node infra/caddy/lab/card-lab.mjs --prefix korbat-cardlab [--image <built caddy image>] [--port 18381]
 *     [--push-subnet 172.16.193.0/24]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const prefix = option("prefix");
const givenImage = option("image");
const port = Number(option("port", "18381"));
const pushSubnet = option("push-subnet", "172.16.193.0/24");
if (!prefix || !/^[a-z0-9][a-z0-9-]*$/.test(prefix) || !Number.isInteger(port)) {
  console.error("usage: node infra/caddy/lab/card-lab.mjs --prefix <name> [--image <image>] [--port <port>] [--push-subnet <cidr>]");
  process.exit(2);
}

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const LF = String.fromCharCode(10);
const ACTION = '{{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}';
const names = { image: givenImage ?? `${prefix}-caddy`, app: `${prefix}-app`, push: `${prefix}-push`, api: `${prefix}-api`, caddy: `${prefix}-caddy`, client: `${prefix}-client` };
const made = { image: false, networks: [], containers: [] };
const measured = {};
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
}

/** A docker command whose failure is an answer, not an error: its status and both outputs. */
function dockerTry(args) {
  const run = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** Removes what the lab made, containers first, and nothing else; each removal is tried whatever the others did. */
function cleanup() {
  for (const name of made.containers.reverse()) dockerTry(["rm", "-f", name]);
  for (const name of made.networks.reverse()) dockerTry(["network", "rm", name]);
  if (made.image) dockerTry(["image", "rm", "-f", names.image]);
}

/** One request to the lab's Caddy, as a fetcher sends it: no cookie, the headers given, the body decoded as sent. */
function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: "localhost", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"];
        const body = encoding === "gzip" ? gunzipSync(raw) : encoding === "deflate" ? inflateSync(raw) : raw;
        resolve({ status: res.statusCode, headers: res.headers, raw, body, ms: Number(process.hrtime.bigint() - started) / 1e6 });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Waits until the lab's Caddy answers /, for at most thirty seconds. */
async function ready() {
  const until = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await get("/")).status === 200) return true;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A docker command's standard output as bytes, for files read out of the image. */
function dockerBytes(args) {
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** A four-byte character (U+1F600), so the block holds UTF-8 that base64 and b64dec must carry whole. */
const WIDE = String.fromCodePoint(0x1f600);
/** The lab Caddy's HOME, which the block's {{env "HOME"}} would print if anything evaluated it. */
const HOME = `/home/cardlab-${randomBytes(6).toString("hex")}`;

/**
 * The stub's two blocks. Unlike a block the API builds, these keep the template delimiters as they are, so the lab proves
 * that Caddy prints a block as text even when nothing escaped it. The profile's is near the API's bound of 4,096 bytes.
 */
const POST_BLOCK = [
  '<meta name="robots" content="noindex" />',
  '<meta property="og:site_name" content="korbat" />',
  '<meta property="og:type" content="article" />',
  '<meta property="og:url" content="https://korbat.example/post/card" />',
  `<meta property="og:title" content="Card Lab ${WIDE} (@card_lab)" />`,
  `<meta property="og:description" content='{{ .Env }} and {{env "HOME"}} stay text' />`,
  '<meta property="article:published_time" content="2026-10-29T12:00:00.000Z" />',
  '<meta name="twitter:card" content="summary" />',
].join(LF);
function profileBlock() {
  const lines = (fill) => [
    '<meta name="robots" content="noindex" />',
    '<meta property="og:site_name" content="korbat" />',
    '<meta property="og:type" content="profile" />',
    '<meta property="og:url" content="https://korbat.example/u/card_lab" />',
    '<meta property="og:title" content="Card Lab (@card_lab)" />',
    `<meta property="og:description" content="${fill}" />`,
    '<meta property="profile:username" content="card_lab" />',
    '<meta name="twitter:card" content="summary" />',
  ];
  let fill = "";
  while (Buffer.byteLength(lines(fill + WIDE).join(LF), "utf8") <= 4096) fill += WIDE;
  return lines(fill).join(LF);
}
const PROFILE_BLOCK = profileBlock();

/** The stub API: Caddy answering the card routes as the API would, 204 with a block, 404, 429, or by dropping the connection. */
function stubCaddyfile() {
  const b64 = (block) => Buffer.from(block, "utf8").toString("base64");
  return [
    "{",
    "  admin off",
    "  auto_https off",
    "}",
    ":3000 {",
    "  @post_card path /api/cards/post/card",
    "  handle @post_card {",
    `    header Korbat-Card "${b64(POST_BLOCK)}"`,
    "    respond 204",
    "  }",
    "  @profile_card path /api/cards/profile/card",
    "  handle @profile_card {",
    `    header Korbat-Card "${b64(PROFILE_BLOCK)}"`,
    "    respond 204",
    "  }",
    "  @limited path /api/cards/post/limited /api/cards/profile/limited",
    "  handle @limited {",
    "    respond 429",
    "  }",
    "  @silent path /api/cards/post/silent /api/cards/profile/silent",
    "  handle @silent {",
    "    abort",
    "  }",
    "  handle {",
    "    respond 404",
    "  }",
    "}",
    "",
  ].join(LF);
}

async function main() {
  const work = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  try {
    if (!givenImage) {
      console.log(`building ${names.image} from infra/caddy/Dockerfile (the web export runs inside: minutes)`);
      made.image = true;
      execFileSync(
        "docker",
        ["build", "-f", "infra/caddy/Dockerfile", "-t", names.image, "--build-arg", "EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA", "--build-arg", "EXPO_PUBLIC_CONTACT_EMAIL=contact@korbat.local", "--build-arg", "KORBAT_ENV=development", "."],
        { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] },
      );
    }
    measured.caddy = docker(["run", "--rm", "--name", `${prefix}-version`, names.image, "caddy", "version"]).trim();
    const modules = docker(["run", "--rm", "--name", `${prefix}-modules`, names.image, "caddy", "list-modules"]);
    check("caddy list-modules lists http.handlers.templates", modules.split(LF).some((line) => line.trim() === "http.handlers.templates"));
    const shell = dockerBytes(["run", "--rm", "--name", `${prefix}-shell`, names.image, "cat", "/srv/index.html"]);
    const card = dockerBytes(["run", "--rm", "--name", `${prefix}-card`, names.image, "cat", "/srv/card.html"]).toString("utf8");
    const cardLines = card.split(LF);
    const at = cardLines.findIndex((line) => line.trim() === ACTION);
    check(
      "card.html holds the template action once, on the line after the charset's meta element, and no other {{",
      at > 0 && cardLines[at - 1].trim() === '<meta charset="utf-8" />' && card.split("{{").length === 2 && card.replace(`${cardLines[at]}${LF}`, "") === shell.toString("utf8"),
      `line ${at + 1}`,
    );
    const robotsFile = readFileSync(path.join(REPO, "infra", "caddy", "robots.txt"));
    check("the image's /srv/robots.txt is infra/caddy/robots.txt", dockerBytes(["run", "--rm", "--name", `${prefix}-robots`, names.image, "cat", "/srv/robots.txt"]).equals(robotsFile));

    const stub = path.join(work, "Caddyfile");
    writeFileSync(stub, stubCaddyfile());
    docker(["network", "create", names.app]);
    made.networks.push(names.app);
    docker(["network", "create", "--subnet", pushSubnet, names.push]);
    made.networks.push(names.push);
    made.containers.push(names.api);
    docker(["create", "--name", names.api, "--network", names.app, "--network-alias", "api", names.image]);
    docker(["cp", stub, `${names.api}:/etc/caddy/Caddyfile`]);
    docker(["start", names.api]);
    made.containers.push(names.caddy);
    docker(["create", "--name", names.caddy, "--network", names.app, "-p", `127.0.0.1:${port}:8080`, "-e", `PUSH_SUBNET=${pushSubnet}`, "-e", `HOME=${HOME}`, names.image]);
    docker(["network", "connect", names.push, names.caddy]);
    docker(["start", names.caddy]);
    if (!check("the lab's Caddy answers on its port", await ready())) return;
    await pages(shell, card, robotsFile);
    await crawlersOn(shell);
    pushNetwork();
  } finally {
    cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}

/** card.html as Caddy should serve it for a block: the action's line holding the block, decoded, in the action's place. */
const served = (card, block) => card.replace(ACTION, block);

/** Every page of 8.2: statuses, bytes, the evaluation that never happens, /card.html, robots.txt and X-Robots-Tag. */
async function pages(shell, card, robotsFile) {
  const root = await get("/");
  for (const [page, block] of [
    ["/post/card", POST_BLOCK],
    ["/u/card", PROFILE_BLOCK],
  ]) {
    const res = await get(page);
    const text = res.body.toString("utf8");
    check(`${page}: 204 gives card.html with 200, the block decoded once in its head`, res.status === 200 && text === served(card, block) && text.split(block).length === 2, `HTTP ${res.status}, ${res.body.length} bytes`);
    check(`${page}: the header itself never reaches the client`, res.headers["korbat-card"] === undefined);
    check(`${page}: no-cache, noindex, and the shell's security headers`, res.headers["cache-control"] === "no-cache" && res.headers["x-robots-tag"] === "noindex" && res.headers["content-security-policy"] === root.headers["content-security-policy"] && root.headers["content-security-policy"] !== undefined);
    measured[`${page} bytes`] = res.body.length;
  }
  const evaluated = (await get("/post/card")).body.toString("utf8");
  check(`a block holding {{ .Env }} and {{env "HOME"}} is written out as text, never evaluated`, evaluated.includes('{{ .Env }} and {{env "HOME"}} stay text') && !evaluated.includes(HOME) && !evaluated.includes("PUSH_SUBNET") && !evaluated.includes(pushSubnet));
  check("the block's four-byte character survives base64 and b64dec", evaluated.includes(`Card Lab ${WIDE} (@card_lab)`));
  measured["profile block bytes"] = Buffer.byteLength(PROFILE_BLOCK, "utf8");
  measured["profile header bytes (base64)"] = Buffer.from(PROFILE_BLOCK, "utf8").toString("base64").length;

  for (const [page, status, why] of [
    ["/post/none", 404, "404 gives the plain shell with 404"],
    ["/u/none", 404, "404 gives the plain shell with 404"],
    ["/post/limited", 200, "a 429 of the global limit gives the plain shell with 200"],
    ["/u/limited", 200, "a 429 of the global limit gives the plain shell with 200"],
    ["/post/silent", 200, "an API that does not answer gives the plain shell with 200 (handle_errors)"],
    ["/u/silent", 200, "an API that does not answer gives the plain shell with 200 (handle_errors)"],
  ]) {
    const res = await get(page);
    check(`${page}: ${why}`, res.status === status && res.body.equals(shell), `HTTP ${res.status}, ${res.body.length} bytes`);
  }
  const direct = await get("/card.html");
  check("/card.html asked by its own path answers 404 with no body", direct.status === 404 && direct.body.length === 0, `HTTP ${direct.status}, ${direct.body.length} bytes`);
  const robots = await get("/robots.txt");
  check("robots.txt is infra/caddy/robots.txt, byte for byte", robots.status === 200 && robots.body.equals(robotsFile), `HTTP ${robots.status}, ${robots.headers["content-type"]}`);
  measured["robots.txt bytes"] = robots.body.length;

  for (const page of ["/post/card", "/u/card", "/post/none", "/settings/appearance", "/post/silent", "/u/silent"]) {
    const res = await get(page);
    check(`X-Robots-Tag: noindex on ${page}`, res.headers["x-robots-tag"] === "noindex", String(res.headers["x-robots-tag"]));
  }
  for (const page of ["/", "/rules", "/transparency", "/explore/about", "/terms"]) {
    const res = await get(page);
    check(`no X-Robots-Tag on ${page}`, res.status === 200 && res.headers["x-robots-tag"] === undefined, String(res.headers["x-robots-tag"]));
  }
}

/** Each crawler of crawlers.json on both pages: the same answer for every User-Agent, whole, the tags early and before <title>. */
async function crawlersOn(shell) {
  const { crawlers } = JSON.parse(readFileSync(path.join(REPO, "infra", "caddy", "lab", "crawlers.json"), "utf8"));
  check("crawlers.json holds six fetchers, none with a cookie", crawlers.length === 6 && crawlers.every((crawler) => !Object.keys(crawler.headers).some((name) => name.toLowerCase() === "cookie")));
  const times = [];
  for (const page of ["/post/card", "/u/card"]) {
    const plain = await get(page);
    for (const crawler of crawlers) {
      const res = await get(page, crawler.headers);
      times.push(res.ms);
      check(`${crawler.name} on ${page}: a whole 200, the same page as anyone gets`, res.status === 200 && res.headers["content-range"] === undefined && res.body.equals(plain.body), `HTTP ${res.status}, ${res.headers["content-encoding"] ?? "identity"}`);
      const text = res.body.toString("utf8");
      const last = Math.max(text.lastIndexOf('property="og:'), text.lastIndexOf('name="twitter:'));
      const tagsEnd = Buffer.byteLength(text.slice(0, text.indexOf(LF, last)), "utf8");
      const title = Buffer.byteLength(text.slice(0, text.indexOf("<title>")), "utf8");
      const titles = text.match(/<title>[^<]*<[/]title>/g) ?? [];
      check(`${crawler.name} on ${page}: the Open Graph tags end at byte ${tagsEnd}, within 524,288 and before <title>, which is korbat`, last > 0 && tagsEnd <= 524_288 && tagsEnd < title && titles.length === 1 && titles[0] === "<title>korbat</title>");
      if (crawler.name === "Twitterbot") {
        measured[`${page} tags end at byte`] = tagsEnd;
        measured[`${page} <title> at byte`] = title;
        measured[`${page} gzip bytes on the wire`] = res.raw.length;
      }
    }
  }
  measured["shell bytes"] = shell.length;
  measured["crawler requests"] = times.length;
  measured["crawler request ms (median, max)"] = [times.sort((a, b) => a - b)[Math.floor(times.length / 2)].toFixed(1), times.at(-1).toFixed(1)].join(", ");
}

/** A client on the push network, which the app's site refuses with 403 first in every handle. */
function pushNetwork() {
  const answers = {};
  for (const page of ["/u/x", "/post/x"]) {
    const run = dockerTry(["run", "--rm", "--name", names.client, "--network", names.push, names.image, "wget", "-T", "10", "-S", "-O", "/dev/null", `http://${names.caddy}:8080${page}`]);
    answers[page] = /HTTP[/]1[.]1 403/.test(run.stderr);
  }
  check("a client on the push network is answered 403 on /u/x and /post/x", answers["/u/x"] && answers["/post/x"], JSON.stringify(answers));
}

try {
  await main();
} catch (err) {
  check("the card lab ran to its end", false, err instanceof Error ? err.message : String(err));
}
console.log(`measurements: ${JSON.stringify(measured, null, 2)}`);
console.log(failures === 0 ? "card lab passed" : `card lab FAILED: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
```

### Create `infra/caddy/lab/crawlers.json`

```json
{
  "about": "The requests of the link-preview fetchers korbat's share cards are made for (2d design, sections 8.2 and 12.1), as their official pages give them; the card lab and the smoke test send them. robotsToken is the agent's name in infra/caddy/robots.txt, null for a fetcher robots.txt does not name. No request carries a cookie. A note says where a value is not from an official page.",
  "crawlers": [
    {
      "name": "Twitterbot",
      "robotsToken": "Twitterbot",
      "headers": { "User-Agent": "Twitterbot/1.0", "Accept-Encoding": "gzip, deflate" }
    },
    {
      "name": "facebookexternalhit",
      "robotsToken": "facebookexternalhit",
      "headers": { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Range": "bytes=0-524288", "Accept-Encoding": "gzip, deflate" }
    },
    {
      "name": "Slackbot-LinkExpanding",
      "robotsToken": "Slackbot-LinkExpanding",
      "headers": { "User-Agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Range": "bytes=0-32767", "Accept-Encoding": "gzip, deflate" },
      "note": "Slack's page says it fetches as little of a page as it can with Range headers and gives no size: the 32 KiB range is the lab's own."
    },
    {
      "name": "Discordbot",
      "robotsToken": "Discordbot",
      "headers": { "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "Accept-Encoding": "gzip, deflate" }
    },
    {
      "name": "LinkedInBot",
      "robotsToken": "LinkedInBot",
      "headers": { "User-Agent": "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)", "Accept-Encoding": "gzip, deflate" },
      "note": "No official LinkedIn page gives its fetcher's User-Agent (inputs 3.3, unconfirmed); this string carries the robots.txt token LinkedInBot."
    },
    {
      "name": "Mastodon",
      "robotsToken": null,
      "headers": { "User-Agent": "Mastodon/4.5.0 (http.rb/5.2.0; +https://mastodon.example/) Bot", "Accept-Encoding": "gzip, deflate" },
      "note": "The form of mastodon/mastodon's lib/mastodon/version.rb at a8b8d37 for an instance at mastodon.example; its link cards read no robots.txt."
    }
  ]
}
```

### Create `infra/caddy/robots.txt`

```text
User-agent: Twitterbot
User-agent: facebookexternalhit
User-agent: Slackbot-LinkExpanding
User-agent: Discordbot
User-agent: LinkedInBot
Allow: /post/
Allow: /u/
Allow: /api/media/
Disallow: /

User-agent: *
Disallow: /
```

### Replace `apps/api/src/app.ts` (whole file)

```ts
import type { MeResponse } from "@korbat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { ActivityError, type Activity } from "./activity";
import { AuthError, type Auth } from "./auth";
import type { Cards } from "./cards";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { ImportError, type Imports } from "./imports";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { ModerationError, type Moderation } from "./moderation";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";
import type { Staff } from "./staff";
import type { Transparency } from "./transparency";

/** JSON requests are small; the two raw upload routes count their own bytes and are exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * 3b (design, section 7.3): a chunk of an import's archive, PUT /api/imports/<id>/archive with the id as a lowercase
 * UUID's 36 characters, the pattern Caddy's @import_chunk matches. Its route counts the bytes against the chunk's own
 * rules, so it is the one route besides POST /api/media that the JSON body limit leaves alone.
 */
const IMPORT_CHUNK_PATH = /^[/]api[/]imports[/][0-9a-f-]{36}[/]archive$/;
const isRawUpload = (method: string, path: string): boolean => (method === "POST" && path === "/api/media") || (method === "PUT" && IMPORT_CHUNK_PATH.test(path));

/**
 * The staff console's paths (3a design, section 5): /api/staff and everything under it, never a path that merely begins
 * with the same letters. The app's CORS and session resolution pass over them, so a staff route never meets the app's
 * credentialed CORS, its Origin allow-list, its session or its CSRF check: the staff gate and the staff session are the
 * only origin and session logic there. Everything else in the chain (request id, access log, client identity, security
 * headers, no-store, the body limit, the global rate limit) applies to them as to any path.
 */
const isStaffPath = (path: string) => path === "/api/staff" || path.startsWith("/api/staff/");

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
  /** The account lifecycle (the data export). Optional for the same reason; the server always wires it. */
  account?: Account;
  /** The staff console's API. Mounted only while CONSOLE_ORIGIN is set; optional as the other modules are. */
  staff?: Staff;
  /** Reports and notices. Optional as the other modules are; the server always wires it, whether the console is on or off. */
  moderation?: Moderation;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
  /** 3d: the public figures' two routes. Optional as the other modules are; the server always wires it. */
  transparency?: Transparency;
  /** 3b: import from other platforms. Optional as the other modules are; the server always wires it. */
  imports?: Imports;
  /** 2d: Activity. Optional as the other modules are; the server always wires it. */
  activity?: Activity;
  /** 2d Task 6: the share cards that Caddy asks for. Optional as the other modules are; the server always wires it. */
  cards?: Cards;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, staff, moderation, advisoryChecks, transparency, imports, activity, cards }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(auth.clientIdentity);
  app.use(securityHeaders, noStore);
  const appCors = cors({ origin: config.TRUSTED_ORIGINS, credentials: true });
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : appCors(c, next)));
  const jsonBodies = bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large", (c as typeof c & { get(key: "requestId"): string }).get("requestId")), 413),
  });
  app.use((c, next) => (isRawUpload(c.req.method, c.req.path) ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  // 3f (design, section 7.12): the status of a post's page, which Caddy asks for every view of /post/*, with the visitor's
  // cookies: after the global limit, which counts it against the visitor, and before the session's resolution, so it
  // reads no session. Every other path falls through to below.
  if (social) app.route("/api", social.statusRoutes);
  // 2d (design, section 8.1): the share cards of a post's and a profile's page, which Caddy asks in the status route's place
  // for every view of /post/* and /u/*, beside it and for the same reasons: counted against the visitor by the global limit
  // (decision 30), and answered before any session is read, so a card is the same for everyone.
  if (cards) app.route("/api", cards.routes);
  // 3d (design, sections 9.1 and 10.6): GET /api/public/facts and /api/public/transparency, at the same place and for the
  // same reasons: counted against the visitor by the global limit, and answered before any session is read. Each sets its
  // own Cache-Control, which noStore leaves alone.
  if (transparency) app.route("/api", transparency.routes);
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : auth.resolveSession(c, next)));

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  // 3e (design, section 7.12): /api/me from the auth module's meFor and the moderation module's standingFor, read at
  // every request; null without the moderation module (an app built for some tests) or without a profile. 2d Task 3 (9.3):
  // the account's own picture from the media module's avatarsOf, the same way: null without the media module or a profile.
  app.get("/api/me", auth.requireOnboarding, async (c) => {
    const session = c.get("session")!;
    const base = await auth.meFor(session);
    const standing = moderation && base.profile !== null ? await moderation.standingFor(session.userId) : null;
    const avatar = media && base.profile !== null ? ((await media.forPosts.avatarsOf([session.userId], session.userId)).get(session.userId) ?? null) : null;
    return c.json({ ...base, standing, avatar } satisfies MeResponse);
  });
  if (media) app.route("/api/media", media.routes);
  // 3b (design, section 9.1): every route behind the auth module's requireSession, CSRF included, like the social routes.
  if (imports) app.route("/api/imports", imports.routes);
  // 2d (design, section 9.2): every route behind the auth module's requireSession, CSRF included for the two writes.
  if (activity) app.route("/api/activity", activity.routes);
  if (account) app.route("/api/account", account.routes);
  // The console is off while CONSOLE_ORIGIN is unset: nothing is mounted, and every staff path is the unknown route below.
  if (staff && config.CONSOLE_ORIGIN !== undefined) app.route("/api/staff", staff.routes(config.CONSOLE_ORIGIN));
  // Reports and notices are taken, kept and given receipts whether or not the console is on: anyone may send one, signed
  // in or not, so these routes stand after session resolution and behind no session guard of their own.
  if (moderation) app.route("/api", moderation.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    // 3b (design, sections 9.1 and 9.4): every refusal of an import with its status, never 500; wrong_offset carries the
    // stored size, so the app goes on from there.
    if (err instanceof ImportError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // 2d: a cursor of Activity that names no place; the limits of its two writes are the social module's (above).
    if (err instanceof ActivityError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    // The account routes render nothing themselves: their own errors and those of the three modules they call all land here.
    if (err instanceof AccountError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // A moderation flow's refusal, from the app's routes or from the console's case routes.
    if (err instanceof ModerationError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createAccount } from "./account";
import { createActivity } from "./activity";
import { createApp } from "./app";
import { createAuth, verificationProviderFrom } from "./auth";
import { createCards } from "./cards";
import { loadConfig } from "./config";
import { createImports, importSettingsFrom, importsForModeration } from "./imports";
import { redisJobLock } from "./lib/jobs";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { R1_TEST_MODEL } from "@korbat/media-protocol";
import { createMedia, edgeAdapterFrom, matchAdapterFrom } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createModeration } from "./moderation";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit, socialForModeration } from "./social";
import { createStaff } from "./staff";
import { createTransparency } from "./transparency";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

// The profile store on the API's pool: the auth module writes profiles through it, and (3b Task 5) the imports module reads
// whether an account's suspension runs from it.
const profiles = createProfileStore(apiDb);
const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM, { requireTls: config.NODE_ENV === "production" }),
  profiles,
  // Null when VERIFY_PROVIDER is off: the badge routes then answer badge_unavailable and the app hides the section.
  verify: verificationProviderFrom(config),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  reconcile: config.MEDIA_RECONCILE,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
  // 3d Task 3: the edge's purge adapter (EDGE_PURGE, off by default); the configuration refused a test adapter on an open site.
  edge: edgeAdapterFrom(config),
  // 3d Task 6: the scorer's model whose scores finalize keeps: the test scorer's under R1_CLASSIFIER=test (refused on an open
  // site), none while it is off; no classifier is built in, and onnx stopped the configuration.
  r1Model: config.R1_CLASSIFIER === "test" ? R1_TEST_MODEL : null,
  // 3d Task 7: the comparison with known material (MEDIA_MATCH, off by default); the configuration refused a test adapter
  // on an open site, and every source's name, since no source's adapter is built in.
  match: matchAdapterFrom(config),
});
await media.prepare();
// Background work runs on one API instance at a time, under locks in Redis that are refreshed while a round runs.
const jobLock = redisJobLock(redis);
const stopSweeper = media.startSweeper(jobLock);
// 3d Task 3: the edge's outbox, drained every fifteen seconds: closed as off while the adapter is off, else one purge a round.
const stopEdge = media.startEdge(jobLock);
// 3d Task 7: match-retry, a round a minute: asks again for checks that were not answered or met the limit on refusals.
const stopMatch = media.startMatchRetry(jobLock);
const stopJanitor = auth.startJanitor(jobLock);
// 3d Task 4: the public figures. The module is built once auth exists, and auth is handed its count afterwards, as the
// wiring hands the media module its handler: resolveSession then counts the month's signed-in accounts and, while
// RECIPIENTS_SIGNED_OUT is on, each day's signed-out readers. Its job closes a month's count and, once a day after the
// dispatch hour, publishes what edition is due. 3d Task 5: and the audit head's daily value, witnessed while HEAD_WITNESS
// is on and mailed to the keeper through the auth module's one sender to HEAD_KEEPER_MAIL.
// 3d review H3: the recipients' count (the day's salt and the sketches) lives in a Valkey of its own, Compose's `counts`,
// which writes nothing to disk; the shared Valkey keeps an append-only file of every write, so the count never reaches it.
// A lost store loses the running month, which then reads as not recorded; counting never fails a request.
const counts = new Redis(config.COUNTS_URL, { maxRetriesPerRequest: 2 });
counts.on("error", (err) => logger.error({ err }, "counts store error"));
const transparency = createTransparency({ apiDb, counts, auth: auth.forTransparency, config, logger });
auth.onSeen(transparency.forAuth);
const stopTransparency = transparency.startJobs(jobLock);

// Moderation cases: the module owns its tables on the API's role and reaches the social module through an interface of
// that module's own, built over the same pool, the image rows through the media module's interface for cases, and a
// notifier's contact and every mail through the auth module's. Its limits count in the store the per-IP limit uses, and
// the routes of an account's own decisions and reports stand behind the auth module's session guard.
// 3b Task 6: a case reads an import's size through the imports module's own factory over the same pool, since this
// module is built before that one (which sends this one its alerts).
const moderation = createModeration({
  apiDb,
  auth: auth.forModeration,
  social: socialForModeration(apiDb),
  media: media.forCases,
  imports: importsForModeration(apiDb),
  requireSession: auth.requireSession,
  rateLimitStore,
  config,
  logger,
});
// The dispatch job: the staff alerts that are still due, the daily release of outcomes, and the mails that waited. And the
// retention job: what is due is erased, and kept image rows nothing retains go; while MODERATION_RETENTION is off it only
// forgets the hashes and ratings of a tool that is off (3d Task 8).
const stopModeration = moderation.startJobs(jobLock);
// 3d Task 7 (design, section 5): the media module is built before the moderation module, so it is handed that module's
// handler of a stored refusal or match afterwards (media.onMatch(moderation.matched)).
media.onMatch(moderation.matched);

const social = createSocial({
  apiDb,
  rateLimitStore,
  logger,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  media: media.forPosts,
  // The chip on the author's own withheld or removed post names its decision, which the moderation module reads.
  moderation: moderation.forSocial,
  // Profile and handle changes are security events; the social module hands them to the auth module, which owns the table.
  events: { append: auth.appendEvent },
});
// Explore's ranking: a round at once, so Explore is filled on a new database or after downtime, then one every five minutes.
const stopExplore = social.startExplore(jobLock);

// 2d Task 6: the share cards. They read a post or a profile as a signed-out reader gets it through the social module's
// interface for cards, and build every address on APP_ORIGIN; no table, no session and no job of their own.
const cards = createCards({ social: social.forCards, appOrigin: config.APP_ORIGIN });

// 2d: Activity. Built after the social and moderation modules, whose interfaces give it the posts' views, the follow
// groups' accounts and the moderation entries (authorActivity), and before the account module, whose export lists the
// account's entries through it. Its limits count in the store the per-IP limit uses, through the social module's table.
// Its job, activity-retention, deletes the entries older than 90 days, a round every hour.
const activity = createActivity({
  apiDb,
  social: social.forActivity,
  moderation: moderation.forActivity,
  rateLimitStore,
  requireSession: auth.requireSession,
  logger,
});
const stopActivity = activity.startRetention(jobLock);

// 3b: import from other platforms. The module owns the three import tables, writes import-archives and reads import-work
// (the importer's output) only through openWorkFile; it asks the auth module whether an address is verified and the
// social module which posts an account already imported. Its job, import-drive, reads finished scans, runs the intake,
// applies the time limits and clears what a crash left, a round every five seconds. 3b Task 5: it feeds imported images
// to the media module's pipeline through that module's interface, alerts staff to a non-acting match through the
// moderation module's, and reads whether an account is suspended, for a confirmation, from the profile store. 3b Task 6:
// built before the account module, whose purge deletes an account's imports and whose export lists them through
// imports.forAccount; it publishes and removes posts through the social module's batch writers.
const imports = createImports({
  apiDb,
  archivesDir: config.IMPORT_ARCHIVES_DIR,
  workDir: config.IMPORT_WORK_DIR,
  settings: importSettingsFrom(config),
  auth: auth.forImports,
  social: social.forImports,
  media: media.forImports,
  moderation: moderation.forImports,
  profiles,
  rateLimitStore,
  requireSession: auth.requireSession,
  logger,
});
await imports.prepare();
const stopImports = imports.startJobs(jobLock);

// The account module owns no table: it reaches the three modules above only through the interfaces their index files export.
const account = createAccount({
  auth: auth.forAccount,
  social: social.forAccount,
  media: media.forAccount,
  // The purge forgets that the deleted account sent its reports, which the moderation module's tables hold.
  moderation: moderation.forAccount,
  // 3b Task 6: the purge deletes the account's imports and import key in its transaction; the export lists the imports.
  imports: imports.forAccount,
  // 2d: the export's member `activity`; the social purge already deletes the account's entries, marker and mentions.
  activity: activity.forAccount,
  requireSession: auth.requireSession,
  requireFreshAuth: auth.requireFreshAuth(),
  requireStrongFreshAuth: auth.requireStrongFreshAuth(),
  rateLimitStore,
  logger,
});
// Deletions the process did not finish (a crash after the auth step, a failed purge) are completed within five minutes.
const stopPurge = account.startPurge(jobLock);

// The staff console's API; createApp mounts it only while CONSOLE_ORIGIN is set. Its credential work is the auth module's,
// its case work the moderation module's.
// 3b Task 6: and an admin's end of a whole import, the imports module's.
const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff, imports: imports.forStaff });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
  account,
  staff,
  moderation,
  transparency,
  imports,
  activity,
  cards,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

/** How long the shutdown waits for the moderation module's tasks that a request started and did not wait for. */
const SETTLE_MS = 5_000;

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  stopEdge();
  stopMatch();
  stopJanitor();
  stopTransparency();
  stopExplore();
  stopPurge();
  stopImports();
  stopActivity();
  stopModeration();
  server.close();
  // A statement, a receipt or a staff alert may be on its way to the relay: it gets five seconds to finish before the
  // pools close under it. What is still unsent then stays pending, and the dispatch job of the next start sends it.
  let waited: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    moderation.settle().then(() => true),
    new Promise<boolean>((resolve) => {
      waited = setTimeout(() => resolve(false), SETTLE_MS);
    }),
  ]);
  clearTimeout(waited);
  if (!settled) logger.warn({ signal }, "shutting down with moderation mails still in flight; what is pending is sent after the next start");
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit(), counts.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/middleware/security-headers.ts` (whole file)

```ts
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

/** The API only ever returns JSON, so the CSP forbids everything. HTML headers for the web app live in the Caddyfile. */
const hardened = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=31536000; includeSubDomains",
  referrerPolicy: "no-referrer",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
});

/**
 * The hardened header set, and 2d's X-Robots-Tag: noindex (design, decision 20 and section 8.2) on every answer of the
 * API, an image file's, a card's, a 404's and an error's included: a search engine that fetches an API path is asked not
 * to index it, as every page that names an account asks. Set after the handler and the error handler have answered, so
 * no answer goes without it.
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await hardened(c, next);
  c.res.headers.set("X-Robots-Tag", "noindex");
});

/**
 * Nothing the API returns may be cached, unless a handler said otherwise itself: image files of visible posts do (3d
 * design, section 7.4). A 404 of the image route stays no-store, so no edge keeps a refusal that would outlive a restored
 * image.
 */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Author, PostView, ProfileView } from "@korbat/contracts";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForSocial } from "../moderation";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import type { StoredPostState } from "./visibility";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { profileViewOf } from "./flows/profiles";
import { publishImportedBatch, removeImportedBatch } from "./flows/imports";
import { createSocialRepo, type AccountLockMode, type CapturedPost, type CapturedProfile, type ImportBatchJob, type ImportBatchPost, type ImportBatchResult, type LockedAccount } from "./repo";
import { postStatusRoutes, socialRoutes } from "./routes";
import { authorOf, isTombstone, loadPostViews, postView } from "./views";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
// 3b (design, section 7.6): the imports module counts its chunks, acts and picks in this module's one table of limits.
export { limitsFor } from "./tiers";
export type { EngagementAction, ImportAction, WriteAction } from "./tiers";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { AccountLockMode, CapturedPost, CapturedProfile, ImportBatchJob, ImportBatchPost, ImportBatchResult, LockedAccount } from "./repo";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, as its last
   * act, for the media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
}

/**
 * What the moderation module needs from this one (3c design, section 5): the locks on profile rows that order a case's
 * transactions against everything else an account does, and the reads a case's evidence and its rules are built from.
 * The moderation module owns no table of this one and never writes to one.
 */
export interface SocialForModeration {
  /**
   * Locks these profile rows in id order, in one statement; with `live`, a missing or deleted account is refused
   * (not_found). Each row answers whether its account is deleted and (3e) whether it is suspended and restricted in its
   * reports, read in the locking statement by the clock.
   */
  lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live?: boolean): Promise<LockedAccount[]>;
  /** The post, locked `for share`, as evidence copies it, or null; its body is empty when its content was erased. */
  capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null>;
  /** The account's handle, display name and bio as evidence copies them, or null. */
  captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null>;
  /**
   * The account a handle names. With `withDeleted`, for a report of child sexual abuse material, also a deleted profile
   * and the account of a handle it has left; without it, only a live profile that holds the handle now.
   */
  findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null>;
  /** Who wrote the post, or null when no row has the id. */
  postAuthor(postId: string): Promise<string | null>;
  /** The post's author, state and the post it quotes, or null when no row has the id; no lock. */
  postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null>;
}

/**
 * What the imports module needs from this one (3b design, section 9.1): the read of 7.5 step 2 that tells which lines of
 * an archive the account already imported, and (Task 6) the batch writers of section 6.5.
 */
export interface SocialForImports {
  /** Which of these keys (64 lowercase hex each) the account's posts that still exist carry; at most a thousand a call. */
  importedKeys(ownerId: string, keys: readonly string[]): Promise<Set<string>>;
  /**
   * One batch of an import's posts in one transaction judged by 3e's predicate: { written: false } when the import is no
   * longer publishing at the cursor given; a suspended author's batch throws account_suspended and writes nothing.
   */
  publishImportedBatch(job: ImportBatchJob, batch: { lines: number; posts: readonly ImportBatchPost[] }, now: Date): Promise<ImportBatchResult>;
  /** One batch of an import's undo, at most `limit` posts, their image files asked for after the commit; selected 0 when none is left. */
  removeImportedBatch(job: { id: string; ownerId: string }, now: Date, limit: number): Promise<{ selected: number; removed: number }>;
}

/**
 * What the activity module needs from this one (2d design, sections 5.5 and 9.1): the views of an Activity page's posts
 * and of a follow group's accounts, built here so that whatever a view or an Author carries (Task 3's avatar) lands in one
 * place. Its limits it counts through enforceWriteLimit, which this file exports.
 */
export interface SocialForActivity {
  /**
   * Views of these posts for the reader through loadPostViews, so each passes postAccess as every read of a post does:
   * only the posts the reader is shown are in the answer, each with its mentions and its counts as this reader gets them.
   */
  postViews(viewer: string, postIds: readonly string[]): Promise<Map<string, PostView>>;
  /** These accounts as an Author, by id; an id with no profile row is not in the answer. */
  authors(ids: readonly string[]): Promise<Map<string, Author>>;
}

/**
 * What the cards module needs from this one (2d design, sections 8.1 and 8.4): a post or a profile exactly as a signed-out
 * reader gets it, from the same reads GET /api/posts/:id and GET /api/profiles/:handle make with no viewer, so moderation,
 * deletion and 3f's disabled follow without a rule of the card's own; and with each the owner's link-preview switch, which no
 * public read carries.
 */
export interface SocialForCards {
  /**
   * The post through postView with no viewer, so postAccess decides it as for anyone signed out: only a visible post, with
   * its images as a signed-out reader gets them; null for any other state, a missing post, or an author deleted meanwhile.
   */
  post(postId: string): Promise<{ view: PostView; previews: boolean } | null>;
  /** The live profile that holds this handle now, lowercased (an old handle names none), with no viewer; null when none. */
  profile(handle: string): Promise<{ view: ProfileView; previews: boolean } | null>;
}

/**
 * The moderation module's interface over the social repository on the pool it is given. A factory of its own, not a
 * member of createSocial's result: the social module's views take facts from the moderation module, which is therefore
 * built between the two.
 */
export function socialForModeration(apiDb: Db): SocialForModeration {
  const repo = createSocialRepo(apiDb);
  return {
    lockAccounts: (tx, ids, mode, live) => repo.lockAccounts(tx, ids, mode, live),
    capturePost: (tx, postId) => repo.capturePost(tx, postId),
    captureProfile: (tx, accountId) => repo.captureProfile(tx, accountId),
    findAccountByHandle: (handle, withDeleted) => repo.findAccountByHandle(handle, withDeleted),
    postAuthor: (postId) => repo.postAuthor(postId),
    postRef: (postId) => repo.postRef(postId),
  };
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  /** The moderation module's interface for views: moderation.forSocial. Without it no post carries the author's chip. */
  moderation?: ModerationForSocial;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  const forActivity: SocialForActivity = {
    async postViews(viewer, postIds) {
      const loaded = await loadPostViews(deps, viewer, [...postIds]);
      return new Map([...loaded].flatMap(([id, view]) => (isTombstone(view) ? [] : [[id, view] as const])));
    },
    async authors(ids) {
      // 2d Task 3 (7.5): the follow groups' actors with their avatars, from one avatarsOf; as any reader but the actor sees them.
      const [found, avatars] = await Promise.all([deps.repo.findProfiles([...ids]), deps.media.avatarsOf([...ids], null)]);
      return new Map([...found].map(([id, profile]) => [id, authorOf(profile, avatars.get(id) ?? null)] as const));
    },
  };
  const forCards: SocialForCards = {
    async post(postId) {
      const view = await postView(deps, null, postId);
      if (view === null) return null;
      const previews = (await deps.repo.sharePreviewsOf([view.author.id])).get(view.author.id);
      return previews === undefined ? null : { view, previews };
    },
    async profile(handle) {
      const row = await deps.repo.findProfileByHandle(handle);
      if (row === null) return null;
      const [view, switches] = await Promise.all([profileViewOf(deps, null, row), deps.repo.sharePreviewsOf([row.id])]);
      const previews = switches.get(row.id);
      return previews === undefined ? null : { view, previews };
    },
  };
  const forImports: SocialForImports = {
    importedKeys: (ownerId, keys) => deps.repo.importedKeys(ownerId, keys),
    publishImportedBatch: (job, batch, now) => publishImportedBatch(deps, job, batch, now),
    removeImportedBatch: (job, now, limit) => removeImportedBatch(deps, job, now, limit),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    /** 3b: the interface the imports module uses. */
    forImports,
    /** 2d: the interface the activity module uses. */
    forActivity,
    /** 2d Task 6: the interface the cards module uses. */
    forCards,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
    /**
     * 3f (design, section 7.12): GET /api/posts/:id/status, a router of its own that app.ts mounts after the global limit
     * and before the session's resolution. No interface member: nothing outside this module calls it.
     */
    statusRoutes: postStatusRoutes(deps),
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ACTIVITY_MIN_AGE_HOURS, EXPLORE_V2, MENTION_NOTIFY_MAX, MENTION_STORE_MAX, type ExploreFormula, type ImportSource } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { handleRefusal, isUniqueViolation } from "../auth";
import { WRITE_CLOCK, closingJudgment, liveNotSuspended, reportsRestrictedAt, suspendedAt } from "../lib/standing";
import { SocialError } from "./context";
import type { Cursor, ExploreCursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
  /**
   * 3b (design, sections 8.4 and 9.3): an imported post's label from its own columns, the archive's date as its UTC day
   * (never its second); null for a native post and for a tombstone, whose columns are cleared.
   */
  imported: { source: ImportSource; at: string; shortened: boolean } | null;
  /** 2d (decision 26): the author hid the like and repost counts from everyone else. */
  hideCounts: boolean;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" | "handle_retired" | "handle_reserved" | "account_suspended" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
  /** 3b (design, section 11.2): an imported post's source, the date its archive gave it and whether it was shortened. */
  imported: { source: ImportSource; originalCreatedAt: Date; shortened: boolean } | null;
  /** 2d (design, section 11.2): the handles its stored mentions name as written, in text order, and its hidden-counts switch. */
  mentions: string[];
  countsHidden: boolean;
}

/**
 * 3b (design, section 6.5): the import a batch belongs to, as the imports module read it. The batch is written only while
 * the job is still publishing at `cursor`, the post_cursor the caller read.
 */
export interface ImportBatchJob {
  id: string;
  ownerId: string;
  source: ImportSource;
  cursor: number;
}

/** One post of an import's batch, built by the imports module from a line the person's choice keeps (imports/plan.ts). */
export interface ImportBatchPost {
  /** importPostId(seed, ref): derived, so a parent's id is computed and a repeated batch inserts nothing twice. */
  id: string;
  /** importPostId(seed, parent) for a line of the account's own thread, else null; written top-level when that post is not there. */
  parentId: string | null;
  body: string;
  /** The archive's date, ISO in UTC with whole seconds. */
  originalCreatedAt: string;
  shortened: boolean;
  /** The line's key (5.4), 64 lowercase hex. */
  key: string;
  /** The kept images to attach, in order, each with its description (decision 20). */
  images: { id: string; alt: string }[];
}

/** A batch's outcome: nothing written (the import moved on, or another batch wrote it), or the posts it inserted. */
export type ImportBatchResult = { written: false } | { written: true; posts: { id: string; images: boolean }[] };

/** An undo batch's outcome: the posts it found to remove, those it tombstoned, and the image rows that went with them. */
export interface RemoveBatchResult {
  selected: number;
  removed: number;
  images: string[];
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

/** One row of an Explore page: the post, and its place in the ranking, which orders the page and is never answered. */
export interface ExploreRow {
  postId: string;
  position: number;
}

/**
 * What one statement found for a page of Explore: the current generation (null before the first round); the ranking
 * read, the cursor's or else the current one, with its time, when it is kept (null otherwise); the position of the
 * cursor's post in that ranking (null when the ranking does not hold it; 0 without a cursor); and the rows after that
 * position that pass the page's filters, in order, at most the limit asked for.
 */
export interface ExplorePageRead {
  current: number | null;
  ranking: { generation: number; asOf: Date } | null;
  after: number | null;
  rows: ExploreRow[];
}

/**
 * What the author's status needs to know about one post before any judgement: who wrote it, whether it is a reply or a
 * quote, whether it is visible, whether its author is suspended now (3e), whether its author shows in Explore, whether
 * its window has passed at the request time, and the current ranking, if there is one, with its time, its formula's
 * version, whether it holds the post, whether the post was written after it and whether moderation gave the post back
 * after it (3e).
 */
export interface ExploreFacts {
  authorId: string;
  reply: boolean;
  quote: boolean;
  /** 3b (design, sections 8.5 and 10.6): an imported post, which enters no feed on its own. */
  imported: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outsideWindow: boolean;
  ranking: { generation: number; asOf: Date; formula: number; holdsPost: boolean; postIsNewer: boolean; restoredSince: boolean } | null;
}

/**
 * The status's judgement of one post: whether it meets every rule of the formula as of the request time and as of the
 * ranking's time (null when the ranking was computed under another version of the formula, whose rules are not judged),
 * and how many places the ranking gives the post's author and holds in all.
 */
export interface ExploreJudgement {
  metNow: boolean;
  metAtRanking: boolean | null;
  authorPlaces: number;
  places: number;
}

/**
 * The modes a profile row is locked in for a moderation case: a decision's on its subject (3e: `update` when it takes or
 * may start a suspension or a termination, section 5's lock order; `no key update` otherwise), and a report's on its sender.
 */
export type AccountLockMode = "update" | "no key update" | "key share";

/** One row lockAccounts locked: whether its account is deleted, and, read in the same statement by the clock, suspended and restricted in its reports. */
export interface LockedAccount {
  id: string;
  deleted: boolean;
  suspended: boolean;
  reportsRestricted: boolean;
}

/** A post as a case's evidence copies it. `body` is empty when the post's content was erased (`erased`). */
export interface CapturedPost {
  id: string;
  authorId: string;
  authorHandle: string;
  body: string;
  state: StoredPostState;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  erased: boolean;
}

/** An account's profile fields as a case's evidence copies them. */
export interface CapturedProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  deleted: boolean;
}

interface RawCapturedPost {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  state: StoredPostState;
  created_at: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  erased: boolean;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
  import_source: ImportSource | null;
  original_day: string | null;
  import_shortened: boolean | null;
  hide_counts: boolean;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
  handle_changed_at: string | null;
}

/** A row of the Explore page statement: the page's facts on every row, and a post on each row but a lone one for an empty page. */
interface RawExplorePage {
  current: number | null;
  generation: number | null;
  as_of: string | null;
  after: number | null;
  post_id: string | null;
  position: number | null;
}

interface RawExploreFacts {
  author_id: string;
  reply: boolean;
  quote: boolean;
  imported: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outside_window: boolean;
  generation: number | null;
  as_of: string | null;
  formula: number | null;
  holds_post: boolean;
  newer: boolean | null;
  restored: boolean;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

/** 3b (design, sections 6.2 and 6.5): the five import columns as a tombstone writes them, all null at once, as posts_import_guard allows only there. */
const CLEARED_IMPORT = { importJobId: null, importSource: null, originalCreatedAt: null, importShortened: null, importKey: null } as const;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
  imported: r.import_source !== null && r.original_day !== null ? { source: r.import_source, at: r.original_day, shortened: r.import_shortened === true } : null,
  hideCounts: r.hide_counts,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state,
  p.import_source::text as import_source, to_char(p.original_created_at at time zone 'UTC', 'YYYY-MM-DD') as original_day, p.import_shortened, p.hide_counts`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_COLUMNS = sql`id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at`;
const PROFILE_SELECT = sql`select ${PROFILE_COLUMNS} from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

/** Durations built in SQL from the formula's numbers, so each number travels as a parameter. */
const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;

/** The one version of the Explore formula whose rules exploreRules writes (3e design, section 7.13). */
const EXPLORE_RULES_VERSION = 2;

/**
 * The time Explore's reads (the page, the chip and the author's status) judge an author's suspension by (3e design,
 * section 7.13 item 6): the database's clock when the statement reads, the same clock a write is judged by. A round
 * judges by its own time instead (exploreRules).
 */
const READ_CLOCK = WRITE_CLOCK;

/**
 * The rules of one Explore formula as of one time (2c design, section 7; 3e design, section 7.13: version 2), as SQL
 * fragments. The refresh ranks with them and the author's status judges one post with them, so the two cannot disagree;
 * the time and every number of the formula travel as parameters. `post` narrows the candidates and the engagement to one
 * post, which the status reads through that post's own indexes; the rules are the same either way. A formula of any
 * other version throws here, before any SQL, so no ranking is stored under a version whose rules were not applied.
 *
 * Version 2's two rules: an account suspended at the time `asOf` (the round's own time, never the clock) is neither a
 * candidate's author nor an engager, by the one predicate of lib/standing.ts applied to rows the round only reads; and a
 * post's window and age count from coalesce(explore_from, created_at), its `starts_at`, where explore_from is created_at
 * plus every span moderation kept the post hidden, which the database's moderation_apply alone writes.
 */
function exploreRules(asOf: Date, formula: ExploreFormula) {
  if (formula.version !== EXPLORE_RULES_VERSION) {
    throw new Error(`Explore's round applies the rules of formula version ${EXPLORE_RULES_VERSION} only, not version ${formula.version}`);
  }
  const at = sql`${asOf.toISOString()}::timestamptz`;
  // A candidate is younger than the window, and only engagement inside the window counts.
  const since = sql`${at} - ${hours(formula.windowHours)}`;
  // Engagement counts once it has stood this long, so a like made just before a round and undone after it never counts.
  const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
  const onePost = (column: SQL, post?: string): SQL => (post ? sql` and ${column} = ${post}::uuid` : sql.empty());
  /**
   * The one candidate predicate: visible top-level posts that are not quotes, by authors who are live and not suspended
   * at the time and have not switched Explore off, whose starts_at lies in the window up to the time. The window test is
   * written in two arms so that each uses its own index: a post never given back its time by its created_at, a restored
   * one by its explore_from (a partial index holds only those). 3b (design, sections 1.5 and 8.5; decision 8): an imported
   * post is never a candidate; it enters no feed on its own, and is published all at once by design.
   */
  const candidates = (post?: string): SQL => sql`
    select p.id, p.author_id, coalesce(p.explore_from, p.created_at) as starts_at from posts p join profiles a on a.id = p.author_id
    where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.import_job_id is null
      and ((p.explore_from is null and p.created_at > ${since} and p.created_at <= ${at}) or (p.explore_from > ${since} and p.explore_from <= ${at}))
      and ${liveNotSuspended("a", at)} and a.show_in_explore${onePost(sql`p.id`, post)}`;
  /**
   * The engagement that counts, read from the candidates `c`: likes and reposts in the window that have stood long enough,
   * by accounts other than the author that are live and not suspended at the time and were old enough when they engaged.
   * The engager is judged at the round, never at the time of the like: a ring's earlier likes stop counting at once.
   */
  const engagement = (post?: string): SQL => sql`
    select x.post_id, x.user_id from (
      select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
      union all
      select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
    ) x
    join c on c.id = x.post_id
    join profiles u on u.id = x.user_id
    where x.user_id <> c.author_id and ${liveNotSuspended("u", at)} and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}`;
  /** The approving accounts per post, read from the engagement `e`: each counted once however it engaged, for the posts that reach the threshold. */
  const approvers = sql`select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}`;
  return {
    at,
    since,
    candidates,
    engagement,
    approvers,
    /**
     * Whether `post` is a candidate that reaches the threshold: the three fragments as the CTEs c, e and ap of a subquery
     * of their own, so one statement can ask at two times.
     */
    met: (post: string): SQL => sql`exists (with c as (${candidates(post)}), e as (${engagement(post)}), ap as (${approvers}) select 1 from ap)`,
  };
}

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive). 3e (design, section 5, the lock order, item 2): the
     * author's row is taken in its own statement, FOR NO KEY UPDATE when its post counter will change (a post or a quote)
     * and FOR KEY SHARE for a reply, with the one predicate on it (account_suspended); the other author's row FOR KEY
     * SHARE: those two modes never wait for each other. A post that both replies and quotes writes two
     * other posts' counters: their rows are taken first, in id order, the order in which a report takes the posts it
     * copies (3c design, section 2, Lock order), so the new post never holds one of them while it waits for the other.
     * The transaction ends with the closing judgment of the author (judgeActing), after `within`: a post that waited at
     * the other author's row, the parent's counter or a foreign key commits only if the author's suspension still has not
     * started.
     *
     * 2d (design, sections 4.2 and 5.3): after the insert and the counters, and before `within` and the closing judgment
     * (so a post the judgment refuses leaves neither), the post's mentions and then its Activity entries. The mentions:
     * one statement looks the handles up as they are held now (handle_history is not read: a handle names the account
     * that holds it at the moment of writing) and takes each live mentioned profile's row FOR KEY SHARE in id order, as
     * lockLive takes rows; a purge holding a row FOR UPDATE makes it wait, and a profile the purge deleted meanwhile fails
     * `deleted_at is null` when the row is read again after the wait, so it is dropped, never refused. Blocks are not read
     * (decision 12): a mention is stored whatever blocks exist, and the author's own handle too (stored and linked, never
     * told). The accounts kept, in the order their handles first appear, are cut to MENTION_STORE_MAX and inserted in one
     * statement, the only statement that adds a mention (the architecture test holds it). Then writeEntries, with the
     * parent's author, the quoted author and the stored mentions by position (postCandidates). The parent's and the
     * quoted author's rows are already held by lockLive, the mentioned ones by the lookup, and the author's by lockActing.
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      /**
       * 2d (4.2): mentionHandles of the normalised body, which the flow reads before the transaction: lowercased, each
       * once, in text order. None unless given, as for the tests that write posts directly.
       */
      mentions?: readonly string[];
      /** 2d (decision 26): the composer's "Hide like and repost counts"; off unless given. */
      hideCounts?: boolean;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockActing(tx, input.authorId, input.replyToId ? "key share" : "no key update");
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        if (input.replyToId && input.quoteOfId) await lockPostsInOrder(tx, [input.replyToId, input.quoteOfId]);
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now, hideCounts: input.hideCounts ?? false })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        const handles = input.mentions ?? [];
        if (handles.length > 0) {
          // Handles are ASCII letters, digits and underscores (mentionHandles), so a comma joins them safely.
          const found = (await tx.execute(
            sql`select id, lower(handle) as handle from profiles where lower(handle) = any(string_to_array(${handles.join(",")}, ',')) and deleted_at is null order by id for key share`,
          )) as unknown as { id: string; handle: string }[];
          const byHandle = new Map(found.map((profile) => [profile.handle, profile.id]));
          const kept = handles.flatMap((handle) => (byHandle.has(handle) ? [{ id: byHandle.get(handle)!, handle }] : [])).slice(0, MENTION_STORE_MAX);
          if (kept.length > 0) {
            await tx.execute(
              sql`insert into post_mentions (post_id, account_id, handle, position) values ${sql.join(
                kept.map((mention, position) => sql`(${row!.id}::uuid, ${mention.id}::uuid, ${mention.handle}, ${position})`),
                sql`, `,
              )}`,
            );
          }
        }
        await writeEntries(tx, input.authorId, row!.id, postCandidates(input.authorId, row!.id, input.replyToId, input.quoteOfId));
        await input.within?.(tx, row!.id);
        await judgeActing(tx, input.authorId);
        return row!.id;
      });
    },

    /**
     * Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to
     * delete. `within` runs in the same transaction. The author's profile row is taken first, in the mode the counter
     * update below needs: a decision about the author holds that row before it takes the post, so a deletion that took
     * the post first and the profile second would deadlock with it, and one that takes the profile first waits its turn.
     * Then every post this transaction writes is taken, in id order, before any is written: the post itself and the post
     * it replies to or quotes, whose counter goes down. A report takes the posts it copies for share in that order (3c
     * design, section 2, Lock order), and one of child sexual abuse material about a quoting post reaches the quoted post
     * by itself: a deletion that wrote its own post first and then asked for a quoted post with a lower id would hold
     * what that report asks for next while it waits for what the report holds. The two ids never change, so a plain read
     * names the right rows; only the author's own post is read, so nobody else's request locks anything here.
     */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${authorId}::uuid for no key update`);
        const [own] = (await tx.execute(sql`select reply_to_id, quote_of_id from posts where id = ${id}::uuid and author_id = ${authorId}::uuid`)) as unknown as {
          reply_to_id: string | null;
          quote_of_id: string | null;
        }[];
        if (!own) return false;
        await lockPostsInOrder(tx, [id, own.reply_to_id, own.quote_of_id]);
        // 3f (design, section 7.10): a post disabled for an order answers its author as a post that does not exist, so its
        // own deletion changes nothing and answers not_found (posts_guard refuses the update for the API role in any case).
        // 3b (design, sections 6.5 and 6.6): the five import columns are cleared in the statement that tombstones, so a
        // deleted imported post keeps nothing of its source (posts_import_guard allows them to change only so).
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "", ...CLEARED_IMPORT })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author"), ne(posts.state, "disabled")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        // 2d (4.4, 5.6): the statement after the tombstone deletes the post's stored mentions and its Activity entries, so
        // nothing of a deleted post's mentions stays and nobody is told of a post that is gone.
        await tx.execute(sql`with gone as (delete from post_mentions where post_id = ${id}::uuid) delete from activity_items where post_id = ${id}::uuid`);
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     * 3e: the liker is the acting account, refused account_suspended while its suspension runs; the author need only be live.
     * Like a repost and a bookmark, it ends with the closing judgment of the acting account (judgeActing), after its
     * counter: the post's row may have kept it waiting past a start.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        await judgeActing(tx, userId);
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        await judgeActing(tx, userId);
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        await judgeActing(tx, userId);
        return inserted.length > 0;
      });
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it. 3e (design, section 5, the lock order, item 2):
     * both rows are taken FOR NO KEY UPDATE, the mode the counter updates need, in one statement ordered by id, before
     * the insert; the follower is the acting account and is refused account_suspended while its suspension runs. The one
     * statement projects both rows before it locks either, so a wait for the followee's row leaves the follower's
     * judgment as it was before it: the transaction ends with the closing judgment of the follower (judgeActing).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockPair(tx, followerId, followeeId, followerId);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
          // 2d (5.3): a follow that did not exist tells the followed account, under its rules, by createPost's statement;
          // a follow, unfollow and follow again within the entry's 90 days is one entry (activity_items_follow_once).
          await writeEntries(tx, followerId, null, sql`select ${followeeId}::uuid as recipient_id, 'follow'::text as kind`);
        }
        await judgeActing(tx, followerId);
        return inserted.length > 0;
      });
    },
    /**
     * 3e (design, section 5, the lock order, item 2): both profile rows FOR NO KEY UPDATE in one statement ordered by id,
     * as a follow takes them, before the delete writes their counters. Withdrawing a follow is open to a suspended account.
     */
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockPair(tx, followerId, followeeId, null);
        return removeFollow(tx, followerId, followeeId);
      });
    },

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        // 2d (5.6): and the pair's Activity entries, both ways, so neither keeps an entry about the other.
        await tx.execute(
          sql`delete from activity_items where (recipient_id = ${blockerId}::uuid and actor_id = ${blockedId}::uuid) or (recipient_id = ${blockedId}::uuid and actor_id = ${blockerId}::uuid)`,
        );
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     * 3b (decisions 8 and 23): the own branch reads native posts only (posts_author_native_idx), so a followed account's
     * imported posts never enter; a repost of one is a deliberate act of the reposter's and shows in the other branch.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level native post and quote, newest first (3b: posts_latest_idx holds no imported post); a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /**
     * An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. 3b:
     * its own posts are native ones only (the Imported tab lists the others); a repost of an imported post still shows.
     */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's Replies tab: its native replies (3b: an imported thread's replies show on their post's page only). */
    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and p.import_job_id is null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /**
     * 3b (design, sections 8.6, 9.2 and 10.6; decision 8): an account's Imported tab: its imported top-level posts, newest
     * first by the archive's date (posts_imported_idx), the page's key that date and the id. The visibility rule and the
     * blocks apply as on the Posts tab; the caller has already checked the viewer may see the account.
     */
    async profileImported(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.original_created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.import_job_id is not null and p.reply_to_id is null and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)}
          and ${before(cursor, sql`p.original_created_at`, sql`p.id`)}
        order by p.original_created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** 3b (9.3, 10.6): whether the account has a visible imported top-level post, so its profile shows the Imported tab to every reader. */
    async hasImported(profileId: string): Promise<boolean> {
      const [row] = await rows<{ found: boolean }>(sql`
        select exists (select 1 from posts p where p.author_id = ${profileId}::uuid and p.import_job_id is not null and p.reply_to_id is null and p.state = 'visible') as found`);
      return row?.found === true;
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking of its formula's version is younger than the
     * formula's minimum gap, so at most one ranking lands per interval however many instances run the job or restart. The
     * newest `kept` rankings stay, so a reader paging through the one before the current one can finish; older ones go
     * with their items. A formula of a version other than 2 throws before the transaction (exploreRules).
     *
     * The statement's CTEs: `c` the candidates, `e` the engagement that counts and `ap` the approving accounts per post
     * reaching the threshold, all three the shared rules of `exploreRules`, which the author's status judges with too; `s`
     * the score, approvers over (hours since the post's window started, never negative, + offset) ^ gravity, the window
     * starting at `starts_at` (3e: when moderation last gave the post back its time, else when it was posted); `r` each author's posts numbered
     * by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts within the
     * per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id; `ins` the
     * items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreRefresh> {
      const started = performance.now();
      const rules = exploreRules(asOf, formula);
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        // Only a ranking of this formula's version counts (3e design, section 7.13 item 5), so the first round after a
        // change of version ranks at once rather than leave the old rules' ranking up for another gap.
        const [recent] = (await tx.execute(
          sql`select exists (select 1 from explore_runs where as_of > ${rules.at} - ${minutes(formula.minGapMinutes)} and formula = ${formula.version}) as fresh`,
        )) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${rules.at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (${rules.candidates()}),
          e as (${rules.engagement()}),
          ap as (${rules.approvers}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${rules.at} - c.starts_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
    },

    /**
     * A page of Explore (2c design, section 8), read by one statement, so a round that prunes a ranking between the checks
     * and the page cannot turn one answer into another: the current generation; the ranking read (the cursor's, or else
     * the current one) when it is kept, with its time; the position of the cursor's post in it; and after that position,
     * in order, the items whose post is visible (for every reader, its author too), whose author is live, not suspended
     * when the page is read (3e: by the database's clock, so a suspended author's posts leave at the next read and come
     * back with the next round once the suspension ends) and shows in Explore, and, for a signed-in reader, with no block
     * either way between reader and author and no mute of the author.
     * The filters come before the limit, so a page is full whenever the ranking holds that many posts the reader may see.
     * The statement answers one row per post, or a lone row without one for an empty page; the flow decides what a missing
     * ranking or post means.
     */
    async explorePage(viewer: string | null, cursor: ExploreCursor | undefined, limit: number): Promise<ExplorePageRead> {
      const raw = await rows<RawExplorePage>(sql`
        with cur as (select max(generation) as generation from explore_runs),
        run as (select generation, as_of from explore_runs where generation = ${cursor ? sql`${cursor.g}::int` : sql`(select generation from cur)`}),
        pos as (${cursor ? sql`select position from explore_items where generation = ${cursor.g}::int and post_id = ${cursor.id}::uuid` : sql`select 0 as position`}),
        page as (
          select i.post_id, i.position from explore_items i join posts p on p.id = i.post_id join profiles a on a.id = p.author_id
          where i.generation = (select generation from run) and i.position > (select position from pos)
            and p.state = 'visible' and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore and ${viewer ? otherWelcome(viewer, sql`p.author_id`) : sql`true`}
          order by i.position limit ${limit}
        )
        select cur.generation as current, run.generation, ${iso("run.as_of")} as as_of, pos.position as after, page.post_id, page.position
        from cur left join run on true left join pos on true left join page on true
        order by page.position`);
      const head = raw[0]!;
      return {
        current: head.current,
        ranking: head.generation === null ? null : { generation: head.generation, asOf: new Date(head.as_of!) },
        after: head.after,
        rows: raw.filter((row) => row.post_id !== null).map((row) => ({ postId: row.post_id!, position: row.position! })),
      };
    },

    /**
     * What the author's status needs about one post before any judgement (2c design, section 8), as of `now`: the window is
     * the formula's, through the same rules the refresh ranks with, and counts from the post's starts_at (3e: when
     * moderation last gave it back its time, else when it was posted). Whether the author is suspended is read at the
     * database's clock, as the page and the chip read it, so the status says why the post is not shown now. The ranking
     * comes with its formula's version and whether the post was restored after it. Null when there is no such post.
     */
    async exploreFacts(postId: string, now: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreFacts | null> {
      const rules = exploreRules(now, formula);
      const [r] = await rows<RawExploreFacts>(sql`
        with run as (select generation, as_of, formula from explore_runs order by generation desc limit 1)
        select p.author_id, p.reply_to_id is not null as reply, p.quote_of_id is not null as quote, p.import_job_id is not null as imported, p.state = 'visible' as visible,
          ${suspendedAt("a", READ_CLOCK)} as suspended, a.show_in_explore as shown, coalesce(p.explore_from, p.created_at) <= ${rules.since} as outside_window,
          run.generation, ${iso("run.as_of")} as as_of, run.formula, p.created_at > run.as_of as newer, coalesce(p.restored_at > run.as_of, false) as restored,
          exists (select 1 from explore_items i where i.generation = run.generation and i.post_id = p.id) as holds_post
        from posts p join profiles a on a.id = p.author_id left join run on true
        where p.id = ${postId}::uuid`);
      if (!r) return null;
      return {
        authorId: r.author_id,
        reply: r.reply,
        quote: r.quote,
        imported: r.imported,
        visible: r.visible,
        suspended: r.suspended,
        shown: r.shown,
        outsideWindow: r.outside_window,
        ranking:
          r.generation === null
            ? null
            : { generation: r.generation, asOf: new Date(r.as_of!), formula: r.formula!, holdsPost: r.holds_post, postIsNewer: r.newer!, restoredSince: r.restored },
      };
    },

    /**
     * The status's judgement of one post, from one statement about that post alone and never a ranking: whether it meets
     * every rule of the formula (the candidate predicate, the engagement that counts, the threshold) as of `now` and again
     * as of the ranking's time, through the very fragments the refresh ranks with, and how many places the ranking gives
     * the post's author and holds in all. Each count reads at most the ranking's items. A ranking computed under another
     * version of the formula applied other rules, so only `now` is judged then: metAtRanking is null (3e design, section
     * 7.13 item 7).
     */
    async exploreJudgement(
      post: { id: string; authorId: string },
      now: Date,
      ranking: { generation: number; asOf: Date; formula: number },
      formula: ExploreFormula = EXPLORE_V2,
    ): Promise<ExploreJudgement> {
      const sameRules = ranking.formula === formula.version;
      const [r] = await rows<{ met_now: boolean; met_at_ranking: boolean | null; author_places: number; places: number }>(sql`
        select ${exploreRules(now, formula).met(post.id)} as met_now, ${sameRules ? exploreRules(ranking.asOf, formula).met(post.id) : sql`null::boolean`} as met_at_ranking,
          (select count(*) from explore_items where generation = ${ranking.generation}::int and author_id = ${post.authorId}::uuid)::int as author_places,
          (select count(*) from explore_items where generation = ${ranking.generation}::int)::int as places`);
      return { metNow: r!.met_now, metAtRanking: r!.met_at_ranking, authorPlaces: r!.author_places, places: r!.places };
    },

    /**
     * Of the viewer's own posts given, those the current Explore ranking holds while the viewer's switch is on and the
     * viewer is not suspended when this reads (3e: by the database's clock, as the page reads it): with the visible posts
     * only, which the caller passes, exactly those whose status would be listed, and so the posts that carry the author's
     * chip. One statement for any number of posts.
     */
    async listedInExplore(viewer: string, postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) return new Set();
      const raw = await rows<{ post_id: string }>(sql`
        select i.post_id from explore_items i join profiles a on a.id = i.author_id
        where i.generation = (select max(generation) from explore_runs) and i.post_id = any(${uuidArray(postIds)})
          and i.author_id = ${viewer}::uuid and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore`);
      return new Set(raw.map((r) => r.post_id));
    },

    /** Turns "Show my posts in Explore" on or off. False when there is no such live profile. */
    async setShowInExplore(id: string, on: boolean): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ showInExplore: on })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * 2d (decision 21, 9.2): turns link previews off, as setShowInExplore is written: it only reduces what others see, so a
     * suspended account may. Turning them on takes the acting row FOR NO KEY UPDATE through lockActing, the mode of the
     * row then written, with 3e's predicate (a suspended account is refused account_suspended), and ends with the closing
     * judgment. False when there is no such live profile.
     */
    async setSharePreviews(id: string, on: boolean): Promise<boolean> {
      if (!on) {
        const updated = await db.update(profiles).set({ sharePreviews: false }).where(and(eq(profiles.id, id), isNull(profiles.deletedAt))).returning({ id: profiles.id });
        return updated.length === 1;
      }
      return db.transaction(async (tx) => {
        await lockActing(tx, id, "no key update");
        const updated = await tx.update(profiles).set({ sharePreviews: true }).where(and(eq(profiles.id, id), isNull(profiles.deletedAt))).returning({ id: profiles.id });
        await judgeActing(tx, id);
        return updated.length === 1;
      });
    },

    /**
     * 2d (decision 26, 9.2): the author's switch of a post's like and repost counts. False for a post that is not the
     * author's, is deleted, or is disabled for an order (all answered not_found, as deletePost answers them); a withheld or
     * removed post, which its author still sees, may change. Hiding only reduces what others see, and is open to a
     * suspended author; showing them again takes the author's row through lockActing FOR KEY SHARE, since only the post's
     * row is written, with 3e's predicate, and ends with the closing judgment.
     */
    async setHideCounts(postId: string, authorId: string, hidden: boolean): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (!hidden) await lockActing(tx, authorId, "key share");
        const updated = (await tx.execute(
          sql`update posts set hide_counts = ${hidden} where id = ${postId}::uuid and author_id = ${authorId}::uuid and state::text not in ('deleted_by_author', 'disabled') returning id`,
        )) as unknown as { id: string }[];
        if (updated.length === 0) return false;
        if (!hidden) await judgeActing(tx, authorId);
        return true;
      });
    },

    /**
     * 2d (design, section 4.3): the mentions of these posts that link for the reader, each post's handles in text order:
     * its stored mentions whose account is not deleted and still holds the handle as written (so a rename or a retirement
     * leaves the old mention plain), and, for a signed-in reader, with no block either way between the reader and the
     * mentioned account, the pair test every read uses. A signed-out reader gets every live mention whose handle is
     * unchanged. One statement for a page of posts; a post without a linking mention is not in the answer.
     */
    async mentionsFor(viewer: string | null, postIds: readonly string[]): Promise<Map<string, string[]>> {
      const found = new Map<string, string[]>();
      if (postIds.length === 0) return found;
      const raw = await rows<{ post_id: string; handle: string }>(sql`
        select m.post_id, m.handle from post_mentions m join profiles a on a.id = m.account_id
         where m.post_id = any(${uuidArray([...postIds])}) and a.deleted_at is null and lower(a.handle) = m.handle and ${otherNotBlocked(viewer, sql`m.account_id`)}
         order by m.post_id, m.position`);
      for (const row of raw) found.set(row.post_id, [...(found.get(row.post_id) ?? []), row.handle]);
      return found;
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },
    /**
     * 2d (design, sections 8.1 and 8.4): the link-preview switch of these profiles, by id, for the share cards, which the
     * public reads' profile row leaves out as it leaves out the Explore switch. A deleted profile is not in the answer, so
     * a post of an account deleted while its purge runs has no card.
     */
    async sharePreviewsOf(ids: readonly string[]): Promise<Map<string, boolean>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<{ id: string; share_previews: boolean }>(sql`select id, share_previews from profiles where id = any(${uuidArray([...ids])}) and deleted_at is null`);
      return new Map(raw.map((r) => [r.id, r.share_previews]));
    },

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row, its Explore switch (the owner's, which the profile row the public
     * reads leaves out), and every handle in handle_history for it, in the order they were recorded, with the time korbat
     * retired one that is still retired (3e). Null when there is no live profile. The lists come page by page from the
     * reads below.
     */
    async exportHead(
      id: string,
    ): Promise<{ profile: ProfileRow; showInExplore: boolean; sharePreviews: boolean; handleHistory: string[]; retiredHandles: { handle: string; retiredAt: Date }[] } | null> {
      // 2d (11.2): and the link-preview switch, the owner's as the Explore switch is.
      const [r] = await rows<RawProfile & { show_in_explore: boolean; share_previews: boolean }>(
        sql`select ${PROFILE_COLUMNS}, show_in_explore, share_previews from profiles where id = ${id}::uuid and deleted_at is null`,
      );
      if (!r) return null;
      const history = await rows<{ handle_lower: string; retired_at: string | null }>(
        sql`select handle_lower, ${iso("retired_at")} as retired_at from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`,
      );
      return {
        profile: toProfile(r),
        showInExplore: r.show_in_explore,
        sharePreviews: r.share_previews,
        handleHistory: history.map((row) => row.handle_lower),
        retiredHandles: history.flatMap((row) => (row.retired_at === null ? [] : [{ handle: row.handle_lower, retiredAt: new Date(row.retired_at) }])),
      };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them, and lists none of a post that is not here. 3f (design, W.7): a
     * post disabled for an order is left out, with its images, and no line says so; after a reinstatement it is back.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{
        id: string;
        body: string;
        created_at: string;
        reply_to_id: string | null;
        quote_of_id: string | null;
        state: StoredPostState;
        deleted_at: string | null;
        import_source: ImportSource | null;
        original_created_at: string | null;
        import_shortened: boolean | null;
        mentions: string[];
        hide_counts: boolean;
        key_at: string;
        key_id: string;
      }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at,
               import_source::text as import_source, ${iso("original_created_at")} as original_created_at, import_shortened,
               array(select m.handle from post_mentions m where m.post_id = posts.id order by m.position) as mentions, hide_counts,
               ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and state::text <> 'disabled' and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        // 3b (11.2): the import's facts on the post; a tombstone's columns are cleared, so it has none.
        imported:
          row.import_source !== null && row.original_created_at !== null
            ? { source: row.import_source, originalCreatedAt: new Date(row.original_created_at), shortened: row.import_shortened === true }
            : null,
        // 2d (11.2): the handles as written, whether or not they still link; a deleted post's rows went with it.
        mentions: row.mentions,
        countsHidden: row.hide_counts,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /**
     * Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile, and
     * (3e, section 7.2) while its suspension runs: the predicate is part of the update's own WHERE, so the update decides.
     * The row is locked first, in a statement of its own: an UPDATE that waited for a holder that only locked the row
     * would keep the judgment it made before the wait, so the UPDATE comes once the row is held and nothing is left to
     * wait for. It is the write's last statement, and so its closing judgment (3e's review).
     */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${id}::uuid for no key update`);
        const updated = await tx
          .update(profiles)
          .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
          .where(and(eq(profiles.id, id), liveNotSuspended("profiles", WRITE_CLOCK)))
          .returning({ id: profiles.id });
        return updated.length === 1;
      });
    },

    /**
     * 2d Task 3 (design, section 7.3): setAvatar's transaction. Step 1, the account's row through lockActing FOR NO KEY
     * UPDATE, the helper createPost uses, with 3e's predicate (account_suspended, or not_found for a deleted profile); then
     * `write`, the media module's attachAvatar (steps 2 to 4: the upload checked and set, the replaced picture detached), as
     * createPost's `within` attaches its images, so this module never names the image table; step 5, the closing judgment.
     * Answers what `write` answered; step 6 is the caller's, after the commit.
     */
    async setAvatar<T>(accountId: string, write: (tx: DbTx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await lockActing(tx, accountId, "no key update");
        const done = await write(tx);
        await judgeActing(tx, accountId);
        return done;
      });
    },

    /**
     * 2d Task 3 (7.3, decision 17): removeAvatar's transaction: the account's row FOR NO KEY UPDATE with no predicate, so a
     * suspended account may remove its picture, a deleted profile answering not_found; then `write`, the media module's
     * detachAvatar. Answers what `write` answered.
     */
    async removeAvatar<T>(accountId: string, write: (tx: DbTx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select deleted_at is not null as deleted from profiles where id = ${accountId}::uuid for no key update`)) as unknown as { deleted: boolean }[];
        if (!row || row.deleted) throw new SocialError("not_found", 404);
        return write(tx);
      });
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     *
     * 3e (design, section 7.10): a handle korbat retired is nobody's, its former holder's included, so the claim answers
     * handle_retired before it asks whether the handle is free; a handle of the account's own history counts as free
     * only while it is not retired. The database's guard of handles refuses the same, and a placeholder's form, to a
     * change that lost a race with a retirement or skipped the handle rule; its code is answered alike. The locking
     * statement also answers whether the account's suspension runs (3e, section 7.2), and then nothing is written; and the
     * transaction ends with the closing judgment (judgeActing), since the claim's statements can still wait after it.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(
            sql`select handle, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${id}::uuid and deleted_at is null for update`,
          )) as unknown as { handle: string; suspended: boolean }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.suspended) return { ok: false, reason: "account_suspended" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from handle_history where handle_lower = ${to} and retired_at is not null) as retired,
                   exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
                     or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { retired: boolean; taken: boolean }[];
          if (claim!.retired) return { ok: false, reason: "handle_retired" };
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          await judgeActing(tx, id);
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        // The closing judgment threw to roll the change back: answered as the locking statement answers it.
        if (err instanceof SocialError && (err.code === "account_suspended" || err.code === "not_found")) return { ok: false, reason: err.code };
        const guarded = handleRefusal(err);
        if (guarded !== null) return { ok: false, reason: guarded };
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ what moderation cases read

    /**
     * Locks these profile rows for the rest of the transaction, in one statement and in id order, so two transactions
     * that lock several accounts never take them in opposite orders. `no key update` is what a decision takes on its
     * subject: two decisions about one account then run one after the other, while the likes and follows of others,
     * which take `key share`, never wait for it. `key share` is what a report takes on its sender. It answers each row
     * found with whether its account is deleted; with `live`, a missing or deleted account is refused (not_found).
     *
     * 3e (design, sections 5 and 7.2): `update` is what a decision takes on its subject when it holds a suspension or a
     * termination, the mode the ledger's trigger takes again: left at `no key update`, the trigger's lock would be an
     * upgrade behind the case's lock, which deadlocks with followers' counter updates. Each row's answer also says whether
     * the account is suspended and whether its reports are restricted, read in the locking statement by the clock, which
     * is what the intake judges a report's sender by.
     */
    async lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live = false): Promise<LockedAccount[]> {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      // The mode is one of three literals of this file, never input.
      const found = (await tx.execute(
        sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended, ${reportsRestrictedAt("profiles", WRITE_CLOCK)} as reports_restricted
              from profiles where id = any(${uuidArray(wanted)}) order by id for ${sql.raw(mode)}`,
      )) as unknown as { id: string; deleted: boolean; suspended: boolean; reports_restricted: boolean }[];
      if (live && (found.length !== wanted.length || found.some((row) => row.deleted))) throw new SocialError("not_found", 404);
      return found.map((row) => ({ id: row.id, deleted: row.deleted, suspended: row.suspended, reportsRestricted: row.reports_restricted }));
    },

    /**
     * A post as a case's evidence copies it, or null when no row has the id: the row is locked `for share`, so the
     * author's deletion comes after the copy or has left its tombstone before it. A post whose content was erased is
     * answered with an empty body, so no copy holds erased text.
     */
    async capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null> {
      const [row] = (await tx.execute(sql`
        select p.id, p.author_id, a.handle as author_handle, p.body, p.state, ${iso("p.created_at")} as created_at, p.reply_to_id, p.quote_of_id,
               p.erased_at is not null as erased
        from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid for share of p`)) as unknown as RawCapturedPost[];
      if (!row) return null;
      return {
        id: row.id,
        authorId: row.author_id,
        authorHandle: row.author_handle,
        body: row.erased ? "" : row.body,
        state: row.state,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        erased: row.erased,
      };
    },

    /** An account's handle, display name and bio as a case's evidence copies them, with whether it is deleted; null when no row has the id. */
    async captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null> {
      const [row] = (await tx.execute(
        sql`select id, handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
      )) as unknown as { id: string; handle: string; display_name: string; bio: string; deleted: boolean }[];
      return row ? { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
    },

    /**
     * The account a handle names, for a report. Without `withDeleted`, only a live profile that holds the handle now: an
     * old handle names nothing, as everywhere else. With it, for a report of child sexual abuse material, also a deleted
     * profile (the purge keeps the handle on the row) and, for a handle no profile holds now, the profile that
     * handle_history records for it: a handle an account has left stays reserved for that account, so it names that
     * account and nobody else.
     */
    async findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null> {
      const lower = handle.toLowerCase();
      const [holder] = await rows<{ id: string; deleted: boolean }>(
        sql`select id, deleted_at is not null as deleted from profiles where lower(handle) = ${lower} and (${withDeleted}::boolean or deleted_at is null)`,
      );
      if (holder || !withDeleted) return holder ? { id: holder.id, deleted: holder.deleted } : null;
      const [former] = await rows<{ id: string; deleted: boolean }>(
        sql`select p.id, p.deleted_at is not null as deleted from handle_history h join profiles p on p.id = h.profile_id where h.handle_lower = ${lower}`,
      );
      return former ? { id: former.id, deleted: former.deleted } : null;
    },

    /** Who wrote a post, or null when no row has the id. */
    async postAuthor(postId: string): Promise<string | null> {
      const [row] = await rows<{ author_id: string }>(sql`select author_id from posts where id = ${postId}::uuid`);
      return row?.author_id ?? null;
    },

    /** A post's author, its state and the post it quotes, or null when no row has the id. Nothing is locked. */
    async postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null> {
      const [row] = await rows<{ author_id: string; state: StoredPostState; quote_of_id: string | null }>(
        sql`select author_id, state, quote_of_id from posts where id = ${postId}::uuid`,
      );
      return row ? { authorId: row.author_id, state: row.state, quoteOfId: row.quote_of_id } : null;
    },

    // ------------------------------------------------------------ imports (3b)

    /**
     * 3b (design, sections 7.5 step 2 and 9.1; decision 24): which of these import keys (64 lowercase hex each, the
     * HMAC of section 5.4) the account's posts carry now, by posts_import_key_idx. The intake counts such a line
     * already_imported and the preview leaves it out. A tombstone keeps no key (6.5), and one an older tombstone still
     * carries is passed over here, so only posts that exist count. Nothing is locked.
     */
    async importedKeys(ownerId: string, keys: readonly string[]): Promise<Set<string>> {
      if (keys.length === 0) return new Set();
      const found = await rows<{ key: string }>(sql`
        select encode(p.import_key, 'hex') as key from posts p
         where p.author_id = ${ownerId}::uuid and p.state <> 'deleted_by_author'
           and p.import_key = any(select decode(k, 'hex') from unnest(string_to_array(${keys.join(",")}, ',')) k)`);
      return new Set(found.map((row) => row.key));
    },

    // ------------------------------------------------------------ imports (3b design, section 6.5)

    /**
     * One batch of an import's posts, in one transaction, in 6.5's order. The author's row FOR NO KEY UPDATE with 3e's
     * predicate (lockActing: a suspended author's batch is refused account_suspended, and the import waits); the job's row
     * FOR UPDATE, which must still be publishing at the cursor the caller read (else nothing is written); the posts of the
     * batch that are there already by id or by key are passed over (a key another import of the account published since
     * the line was read; a repeated batch); every parent outside the batch, taken with lockPostsInOrder as createPost and
     * deletePost take theirs, and a thread line whose parent is neither earlier in the batch nor a post of this import (left
     * out, skipped, or deleted meanwhile, its import columns cleared) is written as a post of its own; one insert of the
     * rest, each created_at the batch's `now` plus its place in the batch in milliseconds (the module's precision, so a
     * thread's replies keep their order in `replies` and its keyset cursor round-trips), on conflict doing nothing, so only
     * the rows RETURNING gave count; the parents' reply counts and the author's post count, one statement each; the images
     * attached through `attach` (the media module's, 6.3's rules); the cursor moved past `lines` and the posts counted; and
     * the closing judgment last. posts_import_guard holds every row to its job, source, dates and parent.
     */
    async publishImportedBatch(
      job: ImportBatchJob,
      batch: { lines: number; posts: readonly ImportBatchPost[] },
      now: Date,
      attach: (tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }) => Promise<void>,
    ): Promise<ImportBatchResult> {
      return db.transaction(async (tx) => {
        await lockActing(tx, job.ownerId, "no key update");
        const held = (await tx.execute(
          sql`select j.id from import_jobs j where j.id = ${job.id}::uuid and j.owner_id = ${job.ownerId}::uuid and j.status = 'publishing' and j.post_cursor = ${job.cursor}::int for update of j`,
        )) as unknown as { id: string }[];
        if (held.length === 0) return { written: false };
        let posts = [...batch.posts];
        if (posts.length > 0) {
          const present = (await tx.execute(sql`
            select p.id, encode(p.import_key, 'hex') as key from posts p
             where p.author_id = ${job.ownerId}::uuid
               and (p.id = any(${uuidArray(posts.map((post) => post.id))}) or p.import_key = any(select decode(k, 'hex') from unnest(string_to_array(${posts.map((post) => post.key).join(",")}, ',')) k))`)) as unknown as { id: string; key: string | null }[];
          const ids = new Set(present.map((row) => row.id));
          const keys = new Set(present.flatMap((row) => (row.key === null ? [] : [row.key])));
          posts = posts.filter((post) => !ids.has(post.id) && !keys.has(post.key));
        }
        const own = new Set(posts.map((post) => post.id));
        const outside = [...new Set(posts.flatMap((post) => (post.parentId !== null && !own.has(post.parentId) ? [post.parentId] : [])))];
        await lockPostsInOrder(tx, outside);
        const standing =
          outside.length === 0
            ? new Set<string>()
            : new Set(((await tx.execute(sql`select p.id from posts p where p.id = any(${uuidArray(outside)}) and p.import_job_id = ${job.id}::uuid`)) as unknown as { id: string }[]).map((row) => row.id));
        const earlier = new Set<string>();
        const rows = posts.map((post, place) => {
          const parent = post.parentId !== null && (earlier.has(post.parentId) || standing.has(post.parentId)) ? post.parentId : null;
          earlier.add(post.id);
          return sql`(${post.id}::uuid, ${job.ownerId}::uuid, ${post.body}, ${parent}::uuid, ${new Date(now.getTime() + place).toISOString()}::timestamptz, ${job.id}::uuid,
                      ${job.source}::import_source, ${post.originalCreatedAt}::timestamptz, ${post.shortened}, decode(${post.key}, 'hex'))`;
        });
        const inserted =
          rows.length === 0
            ? []
            : ((await tx.execute(sql`
                insert into posts (id, author_id, body, reply_to_id, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
                values ${sql.join(rows, sql`, `)}
                on conflict do nothing
                returning id, reply_to_id`)) as unknown as { id: string; reply_to_id: string | null }[]);
        const replies = new Map<string, number>();
        for (const row of inserted) if (row.reply_to_id !== null) replies.set(row.reply_to_id, (replies.get(row.reply_to_id) ?? 0) + 1);
        if (replies.size > 0) {
          await tx.execute(sql`
            update posts set reply_count = posts.reply_count + c.n
              from (values ${sql.join([...replies].map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const topLevel = inserted.filter((row) => row.reply_to_id === null).length;
        if (topLevel > 0) await tx.execute(sql`update profiles set post_count = post_count + ${topLevel}::int where id = ${job.ownerId}::uuid`);
        const byId = new Map(posts.map((post) => [post.id, post]));
        for (const row of inserted) {
          const images = byId.get(row.id)?.images ?? [];
          if (images.length > 0) await attach(tx, { postId: row.id, ownerId: job.ownerId, items: images });
        }
        await tx.execute(sql`update import_jobs set post_cursor = post_cursor + ${batch.lines}::int, posts_published = posts_published + ${inserted.length}::int where id = ${job.id}::uuid`);
        await judgeActing(tx, job.ownerId);
        return { written: true, posts: inserted.map((row) => ({ id: row.id, images: (byId.get(row.id)?.images.length ?? 0) > 0 })) };
      });
    },

    /**
     * One batch of an import's undo (decision 22), in one transaction, through the author's own deletion path: the author's
     * row FOR NO KEY UPDATE (no predicate: a suspended author may still remove what it posted, as deletePost allows), the
     * job's row while it is undoing; at most `limit` of its posts that are neither deleted nor disabled, by id, and every
     * post they reply to, taken with lockPostsInOrder; the tombstones (deleted_by_author, the body blanked, the five import
     * columns null, a post that changed meanwhile passed over); the counters, one statement each; `detach` for each
     * tombstoned post inside the transaction, whose keep trigger leaves every image a case holds or a frozen post owns; and
     * posts_removed. An empty selection is the caller's sign to move the import to undone. The files of the image rows
     * that went are the caller's to ask for, after the commit.
     */
    async removeImportedBatch(job: { id: string; ownerId: string }, now: Date, limit: number, detach: (tx: DbTx, postId: string) => Promise<string[]>): Promise<RemoveBatchResult> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${job.ownerId}::uuid for no key update`);
        const held = (await tx.execute(sql`select j.id from import_jobs j where j.id = ${job.id}::uuid and j.status = 'undoing' for no key update of j`)) as unknown as { id: string }[];
        if (held.length === 0) return { selected: 0, removed: 0, images: [] };
        const batch = (await tx.execute(sql`
          select p.id, p.reply_to_id from posts p
           where p.import_job_id = ${job.id}::uuid and p.state <> 'deleted_by_author' and p.moderation_level <> 'disabled'
           order by p.id limit ${limit}::int`)) as unknown as { id: string; reply_to_id: string | null }[];
        if (batch.length === 0) return { selected: 0, removed: 0, images: [] };
        await lockPostsInOrder(tx, [...batch.map((row) => row.id), ...batch.map((row) => row.reply_to_id)]);
        const gone = (await tx.execute(sql`
          update posts set state = 'deleted_by_author', deleted_at = ${now.toISOString()}::timestamptz, body = '',
                 import_job_id = null, import_source = null, original_created_at = null, import_shortened = null, import_key = null
           where id = any(${uuidArray(batch.map((row) => row.id))}) and import_job_id = ${job.id}::uuid and state <> 'deleted_by_author' and moderation_level <> 'disabled'
          returning id, reply_to_id, quote_of_id`)) as unknown as { id: string; reply_to_id: string | null; quote_of_id: string | null }[];
        const tally = (ids: (string | null)[]) => {
          const counts = new Map<string, number>();
          for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
          return [...counts];
        };
        const replies = tally(gone.map((row) => row.reply_to_id));
        if (replies.length > 0) {
          await tx.execute(sql`
            update posts set reply_count = greatest(0, posts.reply_count - c.n)
              from (values ${sql.join(replies.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const quotes = tally(gone.map((row) => row.quote_of_id));
        if (quotes.length > 0) {
          await tx.execute(sql`
            update posts set quote_count = greatest(0, posts.quote_count - c.n)
              from (values ${sql.join(quotes.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const topLevel = gone.filter((row) => row.reply_to_id === null).length;
        if (topLevel > 0) await tx.execute(sql`update profiles set post_count = greatest(0, post_count - ${topLevel}::int) where id = ${job.ownerId}::uuid`);
        const images: string[] = [];
        for (const row of gone) images.push(...(await detach(tx, row.id)));
        await tx.execute(sql`update import_jobs set posts_removed = posts_removed + ${gone.length}::int where id = ${job.id}::uuid`);
        return { selected: batch.length, removed: gone.length, images };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, as its last act, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would). After the profile row come the row locks of every post of the account, in id order,
     * before any post is written (3c design, section 7.10): a report that holds two of them holds them in that
     * order. What stays unordered are the counters of other accounts' posts that this account replied to, quoted,
     * liked or reposted, which are written after.
     *
     * 3e (design, section 5, the lock order, item 3): right after its own row, the purge takes the rows of every account
     * whose counter it will write (those it follows and its followers) FOR NO KEY UPDATE, in id order, before any post.
     * With the posts first, a decision holding its subject FOR UPDATE, a third account's reply and a follower's purge
     * formed a cycle. An unfollow, a second follow or a quote between the purged account and its own counterparts can
     * still cross it; PostgreSQL detects that, the flows of follow, unfollow and createPost try once more, and the purge
     * is tried again by its job's next round.
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        await tx.execute(sql`
          select p.id from profiles p
           where p.id <> ${id}::uuid
             and p.id in (select followee_id from follows where follower_id = ${id}::uuid union select follower_id from follows where followee_id = ${id}::uuid)
           order by p.id for no key update`);
        // Every post of the account is locked first, in id order, before any of them is written. A report holds the posts it
        // copies for share in that order, and one about a post that quotes or replies to its author's own post holds two
        // posts of this account. The counter statements below write such a quoted or replied-to post, in their scan's
        // order, and the tombstones write the rest: with the locks taken here, in the report's order, the purge either
        // waits at the first post the report holds, holding none itself, or holds them all before the report asks. The
        // deleted posts are locked too: a live post may quote or reply to one, and its counter is written all the same.
        await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        // 3f (design, section 5, the lock order, item 4): the profile row is anonymised (which sets deleted_at) before the
        // tombstones, so posts_guard lets the tombstone of a post disabled for an order through, as it does only for a
        // deleted account. The row is this transaction's from its first statement, so no lock moves. The handle stays on
        // the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the
        // row; it may be there already, from an earlier stint. Only a live row is written, so a repeat leaves the deletion
        // time alone.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
        // The tombstones. The rows are this transaction's already, and no post of the account can appear meanwhile: writing
        // one takes a shared lock on the profile row, which this transaction holds for update. 3b (design, sections 4.7 and
        // 6.6): the five import columns are cleared in the same statement, a disabled post's too (the profile is marked
        // deleted above), and on any tombstone that still carries them, which keeps its deletion time; then no post names
        // an import of the account, whose rows the caller's `within` deletes.
        await tx.execute(sql`
          update posts set state = 'deleted_by_author', deleted_at = case when state = 'deleted_by_author' then deleted_at else ${now.toISOString()}::timestamptz end, body = '',
                 import_job_id = null, import_source = null, original_created_at = null, import_shortened = null, import_key = null
           where author_id = ${id}::uuid and (state <> 'deleted_by_author' or import_job_id is not null)`);
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // 2d (4.4, 5.6, 6.7): after the tombstones, the mentions that name the account and those of its own posts, every
        // Activity entry it caused or received, and its seen marker and rules. A post in flight that mentions it took its
        // row FOR KEY SHARE (createPost's lookup), so it either committed first, and its rows go here, or waits and then
        // finds the account deleted and stores nothing.
        await tx.execute(sql`delete from post_mentions where account_id = ${id}::uuid or post_id in (select p.id from posts p where p.author_id = ${id}::uuid)`);
        await tx.execute(sql`delete from activity_items where recipient_id = ${id}::uuid or actor_id = ${id}::uuid`);
        await tx.execute(sql`delete from activity_state where account_id = ${id}::uuid`);
        // The media rows go last (3c design, section 7.10): they are the last rows this transaction locks, after every
        // post and profile row it takes, and the requests for their files, which cannot be rolled back, are written as
        // close to the commit as they can be.
        await within(tx);
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/**
 * Takes these posts' rows, in id order and in one statement, in the mode an update of a counter or of the state takes
 * them: what a transaction that writes more than one post does before it writes the first, so that every such
 * transaction and every report that copies the same posts (for share, in id order) meet at the lowest post they share,
 * where the one that comes second holds none of the others yet. An id no post has locks nothing.
 */
async function lockPostsInOrder(tx: Tx, ids: readonly (string | null)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return;
  await tx.execute(sql`select id from posts where id = any(${uuidArray(wanted)}) order by id for no key update`);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 *
 * 3e (design, section 7.2): `acting` is the account that writes (the engager of a like, a repost or a bookmark); the
 * locking statement answers for each row whether its suspension runs, and the write is refused account_suspended when the
 * acting account's does. Any other row need only be live. A block and a mute name no acting account: both stay open.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found", acting: string | null = null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where ${accounts} for key share`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (found.some((row) => row.deleted)) throw new SocialError(code, code === "not_found" ? 404 : 400);
  if (acting !== null && found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
}

/**
 * The author's own row for a new post, in its own statement and in the mode its counter needs (3e design, section 5, the
 * lock order, item 2), with the predicate on it: a deleted author is refused not_found, a suspended one account_suspended.
 */
async function lockActing(tx: Tx, accountId: string, mode: "no key update" | "key share"): Promise<void> {
  // The mode is one of two literals of this file, never input.
  const [row] = (await tx.execute(
    sql`select deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${accountId}::uuid for ${sql.raw(mode)}`,
  )) as unknown as { deleted: boolean; suspended: boolean }[];
  if (!row || row.deleted) throw new SocialError("not_found", 404);
  if (row.suspended) throw new SocialError("account_suspended", 403);
}

/**
 * The closing judgment of a write of `accountId` (lib/standing.ts): the transaction's last statement. A deleted account is
 * refused not_found, a suspended one account_suspended, either of which rolls the write back.
 */
async function judgeActing(tx: Tx, accountId: string): Promise<void> {
  const judged = await closingJudgment(tx, accountId);
  if (!judged || judged.deleted) throw new SocialError("not_found", 404);
  if (judged.suspended) throw new SocialError("account_suspended", 403);
}

/**
 * Both profile rows of a follow or an unfollow FOR NO KEY UPDATE, the mode their counter updates take, in one statement
 * ordered by id (3e design, section 5, the lock order, item 2). A deleted row is refused not_found when `acting` is given
 * (a follow), and the acting account's running suspension account_suspended; an unfollow refuses neither.
 */
async function lockPair(tx: Tx, a: string, b: string, acting: string | null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id in (${a}::uuid, ${b}::uuid) order by id for no key update`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (acting === null) return;
  if (found.some((row) => row.deleted)) throw new SocialError("not_found", 404);
  if (found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

/**
 * 2d (design, section 5.3): who a new post tells, as rows (recipient_id, kind) for writeEntries. The parent's author for
 * a reply, the quoted author for a quote, then the stored mentions by position with the author and the accounts already
 * listed removed, cut to MENTION_NOTIFY_MAX; one row per recipient, the first in that order (reply, then quote, then
 * mention), so a reply that also names its parent's author is one reply entry. Only the parent's author is told of a
 * reply, never the thread's root or its other authors. The cut comes before the recipients' rules, so whether the
 * eleventh mention is told never depends on the first ten's settings.
 */
function postCandidates(authorId: string, postId: string, replyToId: string | null, quoteOfId: string | null): SQL {
  return sql`
    with listed as (
      select p.author_id as recipient_id, 'reply'::text as kind, 0 as place from posts p where p.id = ${replyToId}::uuid
      union all
      select p.author_id, 'quote', 1 from posts p where p.id = ${quoteOfId}::uuid
    ),
    named as (
      select m.account_id as recipient_id, 'mention'::text as kind, 2 + m.position as place from post_mentions m
       where m.post_id = ${postId}::uuid and m.account_id <> ${authorId}::uuid and m.account_id not in (select l.recipient_id from listed l)
       order by m.position limit ${MENTION_NOTIFY_MAX}
    )
    select distinct on (t.recipient_id) t.recipient_id, t.kind from (select * from listed union all select * from named) t order by t.recipient_id, t.place`;
}

/**
 * 2d (design, sections 5.2 and 5.3): the one statement that writes Activity entries, for createPost's candidates and for
 * a follow's one. `candidates` answers rows (recipient_id, kind); each becomes an entry of `actorId`'s act (about
 * `postId`, or none for a follow) only when every rule of the recipient holds, read in the act's own transaction: the
 * recipient is not the actor and is not deleted; no block stands between them either way; the recipient does not mute
 * the actor (decision 8); and the recipient's setting for the kind lets the actor in (activity_state, the defaults
 * Everyone and On without a row): `everyone`; `older` when the actor's account was made at least ACTIVITY_MIN_AGE_HOURS
 * before the act, judged by now(), the transaction's start, which is also the time activity_items_insert gives the entry,
 * against profiles.created_at; `following` when the recipient follows the actor; for a follow, `follows`. A refused rule
 * writes nothing. The unique keys make a repeat write nothing (`on conflict do nothing`). The time is the database's.
 */
async function writeEntries(tx: Tx, actorId: string, postId: string | null, candidates: SQL): Promise<void> {
  await tx.execute(sql`
    with c as (${candidates})
    insert into activity_items (recipient_id, kind, actor_id, post_id)
    select c.recipient_id, c.kind::activity_kind, ${actorId}::uuid, ${postId}::uuid
      from c
      join profiles r on r.id = c.recipient_id and r.deleted_at is null
      cross join (select a.created_at from profiles a where a.id = ${actorId}::uuid) actor
      left join activity_state s on s.account_id = c.recipient_id
     where c.recipient_id <> ${actorId}::uuid
       and not exists (select 1 from blocks b where (b.blocker_id = c.recipient_id and b.blocked_id = ${actorId}::uuid) or (b.blocker_id = ${actorId}::uuid and b.blocked_id = c.recipient_id))
       and not exists (select 1 from mutes m where m.muter_id = c.recipient_id and m.muted_id = ${actorId}::uuid)
       and case when c.kind = 'follow' then coalesce(s.follows, true)
                else case coalesce(case c.kind when 'reply' then s.replies::text when 'quote' then s.quotes::text else s.mentions::text end, 'everyone')
                       when 'everyone' then true
                       when 'older' then actor.created_at <= now() - make_interval(hours => ${ACTIVITY_MIN_AGE_HOURS}::int)
                       when 'following' then exists (select 1 from follows f where f.follower_id = c.recipient_id and f.followee_id = ${actorId}::uuid)
                       else false end end
    on conflict do nothing`);
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
import {
  ACCOUNT_MEASURE_SCOPE,
  ACTIVITY_KEEP_DAYS,
  APPEAL_MONTHS,
  IMPORT_RULES,
  AUTOMATION_RULES,
  CSAM_NOTICE_MAX_ACCOUNTS,
  DAILY_LIMITS,
  ITEM_OUTCOMES,
  MEASURES,
  MEASURE_KINDS,
  NOTICE_LIMITS,
  ORDER_RULES,
  OUTCOME_PHRASES,
  RECIPIENT_RULES,
  REPLY_AIM_HOURS,
  RETENTION,
  RETIRED_HANDLE_PREFIX,
  REVERSAL_KINDS,
  STANDING_RULES,
  STATE_FACTS,
  SUSPECT_EARLIER_MONTHS,
  SUSPECT_OUTCOME_PHRASES,
  UNSEEN_NO_ACTION,
  type ItemOutcome,
  type MeasureKind,
  type StateFacts,
} from "@korbat/contracts";
import { RULES, RULES_VERSION } from "@korbat/rules";
import { numberWord } from "./moderation-words";

/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

/** The terms page's own words around its sections (UI Task 7), word for word as app/terms.tsx had them in its markup. */
export const TERMS_PAGE = {
  title: "korbat terms",
  version: (version: string) => `Version ${version}`,
  back: "Back to korbat",
} as const;

/**
 * The moderation sections (3c design, section 9) state each rule of the mechanism once more, for the people it is
 * applied to. So that the text cannot drift from the mechanism, nothing it shares with the mechanism is typed here: every
 * limit and period is printed from the contracts' constants, the rules from the rulebook, the measures from the ledger's
 * own table and an answer's phrases from the table the mails and the screens read. A test changes those constants and
 * finds the terms changed with them (test/terms.test.tsx). 3e's sections (design, W.7) print every number of account
 * sanctions from STANDING_RULES, the days after which a mail is given up from RETENTION.mailGiveUpDays and the hours
 * korbat aims to answer a reply in from REPLY_AIM_HOURS, which the code that acts on each reads.
 */

/** A section's paragraphs are kept in one text, a blank line between two. */
const PARAGRAPH_BREAK = String.fromCharCode(10, 10);
const paragraphs = (...parts: string[]): string => parts.join(PARAGRAPH_BREAK);

/** A section's body as its paragraphs, for the page to set apart. */
export function termsParagraphs(body: string): string[] {
  return body.split(PARAGRAPH_BREAK);
}

/** A count as the terms print it: a small number as a word, and its noun in the singular or the plural. */
const count = (n: number, one: string): string => `${numberWord(n)} ${n === 1 ? one : `${one}s`}`;

/** A share as the terms print it: half as a word, any other share as a percentage, so the sentence follows the constant. */
const share = (fraction: number): string => (fraction === 0.5 ? "half" : `${fraction * 100} percent`);

/** A list inside a sentence: "a", "a or b", "a, b or c". */
const orList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** A rule's name inside a sentence: its title in the rulebook without the leading "No". */
const ruleName = (rule: { title: string }): string => rule.title.replace(/^No /, "");

/** The rules whose final decisions only an admin takes, as the rulebook marks them. */
const ADMIN_RULES = orList(RULES.filter((rule) => rule.seniorQueue).map((rule) => rule.id));

/** The rule on doxxing, whose restricted content is erased once the restriction is final, as a sentence names it. */
const R4 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R4");
  if (!rule) throw new Error("the rulebook holds no rule R4");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/** The rule on spam and manipulation, under which a false import statement can lead to removal (3b, 11.3), as a sentence names it. */
const R6 = (() => {
  const rule = RULES.find((candidate) => candidate.id === "R6");
  if (!rule) throw new Error("the rulebook holds no rule R6");
  return `rule ${rule.id} (${ruleName(rule)})`;
})();

/**
 * 3b (design, section 11.3): the one licence korbat takes in what is posted, native or imported, which "What you can
 * post" grants and "Importing posts" points to. The terms held no licence sentence for native posts before 3b.
 */
const LICENCE = "korbat may store, show and send what you post as the service needs, until you delete it, except what the rules' records keep";

/**
 * 3b (design, sections 11.3 and decision 28): "Importing posts", joining the draft without a new TERMS_VERSION, as the
 * earlier sub-projects' sentences did; its hours and days are IMPORT_RULES', the same numbers the API and the database hold.
 */
const IMPORTING_POSTS = paragraphs(
  "You can bring your own posts from X or Mastodon, and from Bluesky where korbat has turned it on, by uploading the archive you downloaded from that platform yourself; korbat never asks for your password there and never fetches anything from it. korbat opens only the files of your archive that hold your posts and their images, and of those it keeps only your own public posts: it never opens your messages, contacts, followers, likes and the rest, and posts for followers only or direct messages that share a file with public ones are skipped by who they were addressed to, and never kept or logged.",
  `The whole archive passes through korbat's server and its network provider on its way in. korbat deletes it as soon as it has been read, and within ${IMPORT_RULES.archiveHours} hours of the start at the latest; what was read from it is deleted when the import is published, stopped or cancelled, and within ${numberWord(IMPORT_RULES.workHours / 24)} days at the latest.`,
  "Imported posts are korbat posts. They follow korbat's rules like any post and show on your profile's Imported tab, each with a label that names where it came from and the day the archive gives it, and they are in no feed on their own and never in Explore; anyone can still repost or quote them, and anyone who searches their words may find the originals and the account that wrote them.",
  "On each imported post korbat keeps only the source, the day the archive gives it and a keyed hash that tells it a post you already imported, never the other account: no handle, name, address or link of it.",
  `Before anything is published you state that they are your own and that they were public where you posted them; korbat does not check who wrote an archive. A false statement can lead to the posts' removal under ${R6} and count against your account. Other people named or pictured in an imported post can ask for its removal, as anyone named in a post can.`,
  "You grant korbat for imported posts and images the same licence as for any post (What you can post), and you must be able to grant it: old posts often hold other people's photos and screenshots.",
  "Imported images pass the same checks as uploads, and korbat imports images only while it can check them. One action, Remove imported posts, removes every post of an import again.",
);

/**
 * What each measure does, beside its label. A measure added to the ledger does not compile until it is explained here.
 * 3e's six (design, W.1) point to the section that says the rest; W.7 has no words for them, so these are written here.
 */
const MEASURE_MEANINGS: Record<MeasureKind, string> = {
  withhold: "the post is hidden from other people; you still see it",
  remove: "the post is removed for other people; it stays in your own view while you keep it",
  seal_media: "the images the case covers are shown to nobody, you included",
  withhold_media: "one image of a post is hidden from other people; you still see it",
  remove_media: "one image of a post is removed for other people; it stays in your own view",
  reset_display_name: "the display name is replaced by the account's handle",
  reset_bio: "the bio is emptied",
  // 2d Task 4 (design, section 7.7): the monogram in its place, as the app draws an account without a picture.
  reset_avatar: "the profile picture is removed, and the first letter of the display name is shown in its place",
  strike: "a mark on the account that restricts nothing by itself and counts toward a suspension, as Strikes says",
  suspend: "for a number of days the account can no longer post, engage, follow, edit its profile or report under the rules, as Suspension and termination says",
  terminate: "the account is suspended until the decision is final, and then deleted, as Suspension and termination says",
  retire_handle: "the handle can be used by nobody again, and the profile shows a placeholder in its place, as Handles says",
  warn_reporting: "a warning about reports that are manifestly unfounded, which restricts nothing, as Reporting in bad faith says",
  restrict_reporting: "for a number of days korbat takes no report under its rules from the account, as Reporting in bad faith says",
  // 3f: no decision of korbat's takes it; only an authority's order does, which the terms' sections on orders describe.
  // 3f's review (people5): a DSA order that does not ask that the post be kept from its author leaves it to them.
  disable_by_order: "the post and its images are shown to nobody, or to nobody but you when the order does not ask that they be kept from you, because an authority ordered it",
};

/** The measures of one sentence, each by the label its decision records and what it does. */
const measureList = (kinds: readonly MeasureKind[]): string => kinds.map((kind) => `"${MEASURES[kind].label}" (${MEASURE_MEANINGS[kind]})`).join("; ");
// The ledger's own two marks sort the measures into the three sentences; every kind of the ledger is listed.
const WHILE_DECIDING = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && !MEASURES[kind].final);
const WHEN_DECIDED = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && MEASURES[kind].final);
const EITHER = MEASURE_KINDS.filter((kind) => MEASURES[kind].interim && MEASURES[kind].final);
// 3f: the measure no decision of korbat's own takes, which an authority's order alone does.
const BY_ORDER = MEASURE_KINDS.filter((kind) => !MEASURES[kind].interim && !MEASURES[kind].final);
const LIFTED = REVERSAL_KINDS.map((kind) => `"${MEASURES[kind].label}"`).join("; ");

/**
 * Every measure of the ledger with its label and what it does, sorted by when korbat may take it. 3d Task 4 (design,
 * section 9.2): the rules page prints the same paragraph under "What korbat can do, and when", so it is exported.
 */
export const MEASURES_PARAGRAPH = `korbat's measures are these, and no others; each is named as a decision records it. While korbat decides a case: ${measureList(WHILE_DECIDING)}. When the case is decided: ${measureList(WHEN_DECIDED)}. While it decides or when the case is decided: ${measureList(EITHER)}. On an authority's order alone, never on korbat's own judgement: ${measureList(BY_ORDER)}. A later decision can lift each of them again: ${LIFTED}.`;

/** What each outcome of a report means. An outcome added to the contracts does not compile until it is explained here. */
const OUTCOME_MEANINGS: Record<ItemOutcome, string> = {
  restricted_rule: "a moderator found that the item breaks the rule the answer names, and korbat restricted it.",
  restricted_legal: "a moderator found the item illegal under EU law or the law of an EU country, and korbat restricted it everywhere.",
  no_violation: "a moderator found that the item breaks no rule and is not illegal, and korbat left it as it was.",
  not_evident:
    'this is what "illegality not evident" means: a moderator found no breach of a rule and could not tell from the item and from what you wrote, without a detailed legal examination, that it is illegal. korbat does not settle legal disputes; it leaves such an item up, and a court or an authority can order its removal.',
  not_available: "the link named no post or profile that korbat can show: it does not exist, or its author deleted it. This answer is given automatically, and no person looked at the link.",
  partly_reversed: "on its author's appeal or by a correction, korbat lifted part of what it had done about the item.",
  reversed: "on its author's appeal or by a correction, korbat lifted all of what it had done about the item.",
};

/** An outcome's phrase as the terms quote it: the rule's number and title are named, not filled in. */
const quoted = (phrase: string): string => phrase.replace("{rule}", "[number]").replace("{title}", "[title]");

/** One paragraph for each phrase an answer can read, with what it means: the seven outcomes, then the three that stand in for them where nobody opened the images. */
const ANSWERS: string[] = [
  ...ITEM_OUTCOMES.map((outcome) => `"${quoted(OUTCOME_PHRASES[outcome])}": ${OUTCOME_MEANINGS[outcome]}`),
  `"${SUSPECT_OUTCOME_PHRASES.sealed}": korbat's answer to a report on the anonymous path, and to any other report that the same decision answers, when images were sealed. It never says that korbat found something about the images, since nobody at korbat opened them.`,
  `"${SUSPECT_OUTCOME_PHRASES.no_action}": korbat's answer to a report on the anonymous path when an admin sealed nothing and restricted nothing.`,
  `"${UNSEEN_NO_ACTION}": korbat's answer to a report on another ground about a post, when a moderator took no action while nobody at korbat could open the post's images. It does not use up your one request for a re-examination.`,
];

const COURTS = "You can also go to court, or complain to the Digital Services Coordinator of the EU country where you live.";

/**
 * 3e's four sections (design, W.7), in the design's words, each number printed from the constant the code that acts on
 * it reads: STANDING_RULES for the standing rules, RETENTION.mailGiveUpDays for the days after which a mail is given up,
 * REPLY_AIM_HOURS for korbat's aim in answering a reply, APPEAL_MONTHS for the appeal. The placeholder's prefix is the
 * handle rule's own.
 */
const S = STANDING_RULES;
const [FIRST_RUNG, SECOND_RUNG, THIRD_RUNG] = S.ladderDays;

// 3d Task 4 (design, section 9.2): the rules page prints these three sections and Terrorist content with the same
// builders, so one number has one sentence in both places (a table test holds both).
export const STRIKES = `When a moderator's final decision finds that a post of yours breaks a korbat rule, the decision also gives your account a strike. A strike restricts nothing by itself and is used for one thing: counting toward a suspension. It counts for ${count(S.strikeDays, "day")} from its decision. A decision gives no strike when it rests on the law alone, when it concerns child sexual abuse material (rule R2), when it is about your profile and not a post, or while korbat is still deciding. A post gets at most one strike, and a post you made before you were told of your newest strike gets none, so several posts decided in one sitting count as one warning. A strike also counts when the post was already removed or deleted. The decision's statement tells you of the strike, until when it counts and how many you have; your strikes are listed under Settings, Cases. A strike falls only with its decision: appeal that decision, and if it is reversed the strike stops counting at once, and a suspension that rested on it ends at once if fewer than ${numberWord(S.ladderStrikes)} of its strikes still stand. If that suspension was already over, it no longer counts toward a later one.`;

export const SUSPENSION = paragraphs(
  `When your account has ${numberWord(S.ladderStrikes)} active strikes at once, a moderator may decide to suspend it: for at most ${count(FIRST_RUNG, "day")} the first time, ${numberWord(SECOND_RUNG)} the second and ${numberWord(THIRD_RUNG)} the third, counting the suspensions decided in the last ${count(S.ladderMemoryDays, "day")}. A moderator may choose fewer days, never more, and a moderator who chose fewer days still used that step. After a suspension, one further strike is enough for the next step while at least ${numberWord(S.ladderStrikes - 1)} earlier strikes still count. After ${numberWord(S.ladderDays.length)} such suspensions in that time, whatever their length, the next step may be the termination of the account, which only an admin decides. Nothing happens automatically: a moderator reads the strikes and decides. Such a decision finds no new breach: its ground is this section, and its statement says so and lists the strikes it rests on.`,
  `korbat tells you first. The decision is always shown in the app with its reasons, and korbat also sends it to you by email. The suspension starts ${count(S.replyWindowHours, "hour")} after korbat sent that email. If korbat's mail service refuses your address or cannot send the email for ${count(RETENTION.mailGiveUpDays, "day")}, only the app can tell you, and the suspension starts ${count(S.undeliveredHours, "hour")} after the decision. korbat cannot see whether an email it sent reached you, so keep the address of your account current. The app shows the start as a date and time. If you reply before the start, it does not start until a moderator has read your reply and answered you; the answer reverses the decision, or keeps it, and then the suspension starts with the answer and never before the time you were first given. A reply sent later is read and answered too, and can end the suspension, but does not pause it. You can reply once, and replying does not use up your appeal: when korbat keeps a decision after a reply you sent before the start, your ${count(APPEAL_MONTHS, "month")} to appeal count again from that answer.`,
  `korbat suspends an account at once, before any reply, only in four cases, each decided by an admin: after a final decision that a post of the account is a direct threat of violence (rule R5), for up to ${count(S.threatDays, "day")}; after a final decision that a post of the account is terrorist content, for up to ${count(S.terroristDays, "day")}; when an admin finds that the account is flooding korbat with repetitive, unsolicited posts (rule R6) and it made ${S.floodPosts} or more posts within ${count(S.floodMinutes, "minute")}, for up to ${count(S.floodDays, "day")}; and, as a protective suspension, when korbat keeps images of the account sealed after a report of child sexual abuse material, by a decision at most ${count(S.basisAgeDays, "day")} old, once for each such decision and for up to ${count(S.protectiveDays, "day")}. In the last case korbat's staff do not open the images, so korbat has not assessed them: the suspension is a protective measure and not a finding that you broke the law or a rule, it gives no strike, counts toward no later step, and ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once and does not wait for the authorities. In the first two cases the suspension ends at once if the decision it rests on is reversed. An announced suspension never rests on one of these four cases. You get the statement at once and can reply and appeal from the first minute; korbat aims to answer a reply to a suspension taken at once within ${count(REPLY_AIM_HOURS, "hour")}.`,
  "While suspended you cannot post, reply, quote, like, repost, bookmark, follow, edit your profile, change your handle, upload images, ask for the verified badge, or report under korbat's rules. You can still sign in and read, see your cases, reply to korbat, appeal, ask for a re-examination, export your data, delete your posts or your account, undo likes, reposts, bookmarks and follows, block and mute, and report illegal content. Your profile and posts stay visible, without any mark, and others can still follow you and react to your posts. Your posts do not appear in Explore while you are suspended, and your likes and reposts do not count there.",
  `A termination is decided after ${numberWord(S.ladderDays.length)} suspensions as described above, with the same time to reply, or at once after a direct threat of violence (rule R5) that you post within ${count(S.ladderMemoryDays, "day")} after korbat suspended your account for an earlier one, while that suspension and the decision it rests on still stand. A second post from before that suspension is no ground for it. Until the decision is final the account is suspended and nothing more. It is final when the ${count(APPEAL_MONTHS, "month")} for your appeal have passed unused, or when your appeal is answered and the decision kept; nothing is deleted while your appeal or a reply of yours is unanswered. korbat then deletes the account with its posts and profile and every image it has not sealed. Until then you can export your data and delete the account yourself; deleting it ends your appeal, since nothing is left to restore. After the deletion korbat keeps nothing to recognise a new account of yours by; images that korbat sealed stay with it for the authorities alone, as the decision that sealed them said.`,
  "Each of these decisions can be appealed from the moment you are told, as Appeals says; an appeal does not hold a start, only a reply does. One person may hold more than one account, but not to carry on with another account what one was suspended or terminated for: korbat treats that as the same conduct and decides about it like any other breach, on what the account does.",
);

export const REPORTING_IN_BAD_FAITH = paragraphs(
  "Report what you believe breaks a rule; a report that turns out wrong costs you nothing. korbat acts only on reports that are manifestly unfounded: reports that anyone could see name nothing a rule could cover, without weighing them. Examples are many reports of the same account for posts that plainly break no rule, the same text sent against different posts, and a report sent again after it was answered. A moderator may mark such a report when deciding it. You see the mark on your list of reports together with the report's outcome, and you can ask for a re-examination. The mark stops counting if a re-examination finds a breach, and if korbat withdraws it because the report was arguable after all. korbat counts reports, not the posts or accounts a report names: a report counts once, by the day you sent it, however many of its items were marked, so no single report can lead to a warning.",
  `If at least ${numberWord(S.reportWarnMarks)} of the reports you sent under the rules within ${count(S.reportFrameDays, "day")} are marked, and they are at least ${share(S.reportWarnShare)} of the reports you sent under the rules in that time, a moderator may warn you: the warning lists the reports and restricts nothing. If ${numberWord(S.reportRestrictMarks)} of the reports you send after that warning are marked while it counts, which is ${count(S.reportFrameDays, "day")}, a moderator may stop taking your reports under the rules for up to ${count(S.reportRestrictDays, "day")}; the restriction ends at once if the warning is lifted. A person decides each step, looking at how many reports you sent, how many were marked and what they said; the count alone decides nothing. Notices of illegal content, reports of child sexual abuse material and requests for re-examination are never counted and never restricted. You can appeal the warning and the restriction.`,
);

const HANDLES = `When the breach lies in a handle itself (impersonation, someone's private information, a threat), a moderator may retire it. A retired handle can be used by nobody again, you included. Your profile then shows a placeholder that begins with ${RETIRED_HANDLE_PREFIX}, and you can choose a new handle without the usual wait: at once, or, while your account is suspended, when the suspension ends. If the decision is reversed, the retirement is lifted: your profile gets the handle back if it still shows the placeholder, and otherwise you can change back to it at once; nobody else could take it meanwhile. Handles that begin with ${RETIRED_HANDLE_PREFIX} cannot be chosen. korbat keeps a retired handle, as a handle and nothing else, for as long as it refuses it to everyone, also when the breach was someone's private information (rule R4): refusing it needs it.`;

/**
 * 3f (design, W.6 and section 5): the contact point for authorities and the Member State korbat is established in, the
 * web build's two arguments (WEB_CONTACT_POINT and WEB_HOME_STATE in infra/.env), which Expo inlines at export time as it
 * inlines the contact address. The app's page is built, so it cannot read the API's settings of the same names. While the
 * contact point is empty the terms print no section on it, and while the state is empty no sentence names one: both are
 * set, with the API's, as the last step of the README's Before going public.
 */
export const CONTACT_POINT = process.env.EXPO_PUBLIC_CONTACT_POINT ?? "";
export const HOME_STATE = process.env.EXPO_PUBLIC_HOME_STATE ?? "";
/** The home state's facts, while the contracts fill its entry in. */
const STATE: StateFacts | undefined = HOME_STATE === "" ? undefined : (STATE_FACTS as Partial<Record<string, StateFacts>>)[HOME_STATE];
/** The state as a sentence names it: its name from STATE_FACTS, or its code while the contracts have no entry for it. */
const HOME_STATE_NAME = STATE?.name ?? HOME_STATE;

/** A list inside a sentence: "a", "a and b", "a, b and c". */
const andList = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * 3f's sections (design, W.6), in the design's words. Each number is printed from the constant the code that acts on it
 * reads: what a removal order disabled is kept for RETENTION.orderPreserveMonths and ORDER_RULES.preserveMarginDays, the
 * records for RETENTION.orderRecordYears, a message's record for RETENTION.contactMessageDays, a restore gap for
 * RETENTION.restoreGapMonths and a deleted account's address for ORDER_RULES.reportHoldDays. The hour, the six and twelve
 * weeks and the 48 hours of a scrutiny are the Regulation's own periods (TCO Art. 3(3), 11(3) and 4(4)), written as it
 * writes them: ORDER_RULES holds korbat's own numbers built on them (holdDays counts a day more, so as never to be early).
 */
const O = ORDER_RULES;
const PRESERVED = count(RETENTION.orderPreserveMonths, "month");

const AUTHORITIES_ORDERS = paragraphs(
  "An authority or a court of the European Union or of one of its countries can order korbat to act against a post, or to give information about an account. korbat carries such an order out within the time the law sets and checks that it comes from the authority it names; if it does not, korbat reinstates the post and tells you. A removal order for terrorist content leaves korbat no choice, and has to be carried out within one hour, so korbat may act on it before that check is finished. Any other order korbat checks first, and carries out because the law under which it was issued requires it. korbat does not assess the post under its own rules when it carries out an order: such an order is not a decision of korbat's.",
  "So korbat gives no reasons of its own for it, and korbat's appeal does not apply. You get a notice instead, under Settings, Cases, announced by an email that says only that there is one. The notice says which authority the order names, under which law, on which day and under which reference, and whether korbat has confirmed that it comes from that authority. It gives the authority's reasons and the ways to challenge the order, in the authority's own words, as soon as korbat has them; when korbat adds them later it sends you an email, and the notice says since when it has held them. The notice also says how to ask korbat for a copy of the order.",
  "An order can forbid korbat to tell you about it for a time. Then korbat keeps the post from you as from everyone, tells you nothing, and can say nothing about the post by email either. For a removal order the law sets that time (Terrorist content); for another order the authority that issued it does, and korbat tells you when that authority allows. While korbat may not tell you of an order, it cannot tell you of a decision it takes about the same post under its own rules, or answer an appeal you made about that post before: you get those together with the notice.",
  "korbat lifts what it did only when the authority withdraws the order, when a court annuls it, when the authority of korbat's own country finds that an order from another country infringes the law, when the order turns out not to be authentic, or when korbat disabled a post that the order did not name. For that last case write to the address under Contact, from the email address of your account. When korbat's own rules apply to the same post, that is a second decision, with its own statement of reasons and its own appeal. korbat cannot act for one country alone, so an order takes effect everywhere korbat is available.",
);

// 3c's section, in full as 3f has it read: the removal order is carried out within the hour now, not once korbat is open.
export const TERRORIST_CONTENT = paragraphs(
  "korbat removes terrorist content as defined in Article 2(7) of Regulation (EU) 2021/784 when it is told about it in a notice, and carries out a removal order of a competent authority within one hour of receiving it. Material for educational, journalistic, artistic or research purposes, or for preventing or countering terrorism, and polemic or controversial views in public debate are not terrorist content. korbat uses no automated tool to find it.",
  `A post disabled under a removal order is shown to nobody, you included, for as long as the order stands. korbat keeps it, with its images and a copy of its text, for ${PRESERVED} from the disabling, as the Regulation requires, so that it can be reinstated or examined, and longer only when an authority or a court asks. Deleting the post or your account does not shorten this. Then korbat erases it, and it cannot be reinstated afterwards.`,
  `The law can oblige korbat to tell you nothing about such an order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early. During that time the post is simply not there, for you as for everyone, and korbat cannot say why. korbat tells you when that period ends, with the day on which the post was disabled. If the order comes from another country of the European Union than korbat's, you can ask the authority of korbat's country to scrutinise it, within 48 hours of receiving its reasons or a copy of it; the notice says since when it has held the reasons. If you challenge an order in court, ask the court or the authority to tell korbat to keep the post until that is decided, since korbat erases it after the ${PRESERVED} otherwise. korbat publishes the figures the Regulation asks for, for every year in which any of them is not zero.`,
);

// The languages the contact point declares are the operator's (STATE_FACTS); while the state's entry declares none, the
// sentence names none rather than print that they are not filled in.
const CONTACT_POINT_SECTION = `Authorities of the Member States, the European Commission and the European Board for Digital Services reach korbat at ${CONTACT_POINT} (Article 11 of the Digital Services Act; Article 15 of Regulation (EU) 2021/784)${STATE?.languages ? `, in ${andList(STATE.languages)}` : ""}. This address is for authorities. Everyone else writes to the address under Contact, and reports content with the report form.`;

/**
 * "Your data"'s four paragraphs of W.6, and RETENTION's printed list of what concerns authorities, in one paragraph. 3f's
 * review (people8): a message an order came with is kept with that order's records (delete_contact_messages skips it), so
 * both sentences about the contact point's records say so.
 */
const AUTHORITIES_DATA = [
  `Two things the law can oblige korbat to keep for a time when you delete your account; everything else is deleted at once. First, your email address: when korbat has sealed images of your account, the law may oblige it to report them to the authorities. Until it has done so, or has decided that it need not, and for ${count(O.reportHoldDays, "day")} at most, korbat keeps the address, and nothing else of the account; it uses it for that report alone, and the email that confirms your deletion tells you. You can write to korbat about this at the address under Contact, complain to a data protection authority, and go to court. Second, a post that an authority's order obliges korbat to preserve: korbat keeps it, with its images, until that time ends (Terrorist content), also after your account is gone.`,
  `korbat keeps a record of every report it makes to an authority and of everything it hands to one: which duty, which authority, when, both references, what was asked for and which kinds of data, never a copy of the data. It keeps these records and its records of authorities' orders for ${count(RETENTION.orderRecordYears, "year")} after the matter's last event, an order's record for as long as its measure stands, and a record that says you may not be told of something for as long as that holds. korbat records when a message reaches its contact point for authorities, never who sent it or what it says, and deletes that record ${count(RETENTION.contactMessageDays, "day")} after the message was handled, or, when an order came with it, with that order's records.`,
  "When an authority lawfully asks who holds an account, korbat gives the handle, the email address and the day the account was created. korbat also holds when and from which kind of device an account signed in; it gives those only when an order names them and the law requires it, and its record says so. korbat tells you when it has given an authority information about your account, with the authority's reasons and the ways to challenge its order, unless the order, or the law under which it was issued, forbids telling you or delays it; korbat records which of these applies and on what basis. While korbat may not tell you, its answer to a data request of yours leaves the matter out, and korbat keeps the reason on record.",
  "If korbat has to restore its database from a backup, it may have to take a decision about you again; the decision then says so.",
  `The periods for what concerns authorities: content disabled under a removal order is kept ${PRESERVED} and ${count(O.preserveMarginDays, "day")} from the disabling, and from the new disabling when it was reinstated and disabled again, longer on an authority's or a court's request, and is then erased. An order's records, and the records of a notification or a production, are kept ${count(RETENTION.orderRecordYears, "year")} after the matter's last event; an order's never while its measure stands, and a record of an authority's demand that a person is not told never while that demand holds. The record of a message at the contact point for authorities is kept ${count(RETENTION.contactMessageDays, "day")}, counted from the day the message was handled, or, when an order came with it, as long as that order's records; the record of a message nobody handled is kept until a person has closed it. A gap a restore left is kept ${count(RETENTION.restoreGapMonths, "month")} when it was closed as not needed or imported; a gap that a decision taken again closed is kept as long as that decision. The email address of a deleted account is kept while a report is owed, ${count(O.reportHoldDays, "day")} at most.`,
];

/**
 * 3d (design, W.9): "Automated tools" and "Transparency", drafts without a new TERMS_VERSION, as 3c's, 3e's and 3f's
 * sections were; counsel reviews them in sub-project 4. Every number is AUTOMATION_RULES', which the database's
 * automation_rules() holds the program to. They say what each tool may do when it is switched on, and the rules page says
 * which is on today: so they are true in every state the design builds (section 18, rule 9).
 */
const A = AUTOMATION_RULES;
export const AUTOMATED_TOOLS = paragraphs(
  "korbat's decisions are taken by people. korbat may use two programs, and the rules page says under Automation which of them is switched on today.",
  "The first rates uploaded images against rule R1 and keeps the rating with the image while the check is switched on. An image it rates as likely within the rule is put before a moderator. korbat may also hide that one image from other people until the moderator has decided; the post's text stays and you still see the image.",
  "The second compares the fingerprint of an uploaded image with lists of images that a named body has classified as child sexual abuse material. korbat sends that body fingerprints and nothing else. An upload that the body reports as an exact match with such an entry is not accepted, now or later, and is kept, unopened, until an admin has decided whether korbat reports it to the authorities. A match with such an entry on an image of a post, exact or not, is put before an admin even when the program seals nothing; from then on korbat keeps that post's images, also if you delete the post or your account, until the admin has answered (Your data). On an exact match korbat may also seal that post's images for everyone until then. A match is a comparison of fingerprints: it is not korbat's finding about an image, and korbat's staff do not open an image that a match names, before the admin's answer or after it. A match with an entry of any other class only flags the image for a person.",
  `A program never removes anything, never judges text, and never suspends or restricts an account. It takes at most ${A.decisionsPerHour} measures an hour and ${A.decisionsPerDay} a day under rule R1, and ${A.r2DecisionsPerHour} and ${A.r2DecisionsPerDay} under rule R2, none under a rule while ${A.unansweredMax} of its measures under that rule wait for a person, and none at all while a request for a person has waited longer than ${A.unansweredHours} hours. Every measure a program takes you are told at once, with the reasons and the words "automated means", under Settings, Cases and by email. You can ask for a person there, and korbat's target is that one answers within ${A.objectionTargetHours} hours. The person's decision is the one you can appeal. An upload that is not accepted is different: nobody at korbat can accept it, since nobody opens it; you can object, and an admin decides what happens to the file. korbat uses these programs to keep such content from being shown, on the basis of its legitimate interest in a service that follows its rules and the law; you can object to that at the address under Contact.`,
);

/** 3d (design, W.9): "Transparency". */
export const TRANSPARENCY =
  "korbat publishes its rules, with every change, on the rules page, and each year the counts of what its moderators, its programs and authorities' orders did, on the Transparency page. It publishes numbers, never a decision, and no number small enough to point at a person, except the figures on authorities' orders, which the law asks for as numbers. To give the authorities the figure the Digital Services Act asks for, korbat counts how many accounts and readers use it each month and keeps two numbers a month; the Transparency page says how it counts and what exists until a month has ended.";

/**
 * 3d (design, W.9): "Your data"'s paragraph on what the automated tools and the sealed images leave behind, and
 * RETENTION's printed list of the same, each period from its constant: the match record's days, the address held after a
 * refused upload (3f's hold), the edge's outbox rows, the records to authorities' years, and the reader count's salt.
 */
const R = RETENTION;
const AUTOMATION_DATA = [
  `While a comparison is switched on korbat keeps fingerprints of each uploaded image for as long as it keeps the image; when the comparison is switched off it deletes them all. While the check against rule R1 is switched on it keeps the program's rating of each image the same way, and deletes the ratings when the check is switched off. It keeps the record of a match (the image's id, the body, the kind of match and the fingerprint, never your account) for ${count(R.matchKeepDays, "day")} after the case closed, the hold ended or the images were released. The record that an upload of yours was not accepted names your account for the same time; after that korbat keeps only that an upload was refused on that day. If korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. While an upload of yours is held korbat keeps your email address for up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account, as it does when images are sealed. It keeps what you wrote when you asked for a person as long as the decision's own texts, and what you wrote when you objected to a refused upload as long as that upload's record of a match. It keeps for ${count(R.edgePurgeDays, "day")} the record that a cached copy was to be dropped, and for ${count(R.orderRecordYears, "year")} the record of a release, of the leave or instruction it rests on, and the digests that prove a destruction.`,
  `The periods for the automated tools and for sealed images: the record of a match: ${count(R.matchKeepDays, "day")} after its case closed, its hold ended or its images were released, or, for an upload that was accepted and never posted, after the comparison; longer only while images sealed for good and not released, or a held upload, rest on it. The record that an upload was not accepted: with your account until the record of its match is erased, and without it afterwards; when korbat reported the upload, the record of that report names your account for as long as korbat keeps its records to authorities. Your email address after an upload of yours was not accepted: up to ${count(R.reportHoldDays, "day")} from the refusal, also if you delete your account; less when the hold ends without a report. The record that a cached copy was to be dropped: ${count(R.edgePurgeDays, "day")} after it closed. Fingerprints of an uploaded image: as long as the image, and only while a comparison is switched on; all are deleted when it is switched off. The rating of an image under rule R1: as long as the image, and only while the check is switched on; all are deleted when it is switched off. The monthly count of readers: two numbers a month, kept; the counting sketches are deleted at the month's end, and the day's key after ${count(RECIPIENT_RULES.saltHours, "hour")}. The record of a release, of the leave or instruction it rests on, and of each destroyed file's digest: as korbat's records to authorities (${count(R.orderRecordYears, "year")}).`,
];

/**
 * 2d (design, section 11.3): the privacy text's four drafts, last in "Your data", joining the draft without a new
 * TERMS_VERSION, as 3d's drafts did; counsel reviews them before korbat opens (sub-project 4): what Activity keeps and for
 * how long, by the contracts' ACTIVITY_KEEP_DAYS, the days the retention job deletes by, and that nothing is mailed or pushed
 * about it; what a mention stores and whom it tells; that a profile picture is public, checked and reset like the rest of
 * the profile; and what a shared link shows elsewhere, what other sites keep, robots.txt and the request not to index.
 */
const ENGAGEMENT_DATA = [
  `Activity lists the replies to your posts, the posts that mention your account, the quotes of your posts and your new followers, beside what korbat told you about decisions on your own content. For each it keeps who acted, what kind of act it was, which post and when, never a text, and deletes it ${count(ACTIVITY_KEEP_DAYS, "day")} after it was written, or sooner when its post is deleted, when one of the two accounts blocks the other or when either account is deleted. It also keeps when you last looked at Activity and your choices in Settings > Activity, as long as your account exists. korbat sends no email and no push notification about Activity: you see it only when you open it.`,
  "When a post names an account by its handle, korbat stores which account held that handle when the post was written. The handle links to that account only while it still holds the handle, and that account is told in its Activity, as far as its own settings allow and never across a block. A handle in an imported post is plain text and tells no one.",
  "A profile picture is public: anyone who can see your profile, signed in or not, sees it. It passes the same checks as every image you upload, a moderator can reset it under the rules as a display name or a bio, and it is deleted with your account.",
  "When someone shares a link to a public post or profile on another site, that site shows a card that names only korbat, until the author turns on link previews in Settings > Privacy; then the card shows what anyone sees without signing in: the name and handle, the text or the bio and the first image or the profile picture, never a count. The sites that show a card keep their own copy, which korbat cannot change or delete, so a post deleted on korbat may still show there for a while. korbat's robots.txt turns away every automated visitor but the link-preview fetchers of the sites it names, and korbat asks search engines not to show its posts and profiles in their results, which a search engine may or may not honour.",
];

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    // 3e (W.7): what another account may not carry on, which "Suspension and termination" says.
    // 3f (W.6): the Member State korbat is established in, from the build's argument, while the build names one.
    body: `You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to carry on what another of their accounts was suspended or terminated for (Suspension and termination).${HOME_STATE_NAME === "" ? "" : ` korbat is established in ${HOME_STATE_NAME} and offers its service there only.`}`,
  },
  // The 3c design's sentence (section 9), in place of "removed only when it breaks a published rule", which notices of illegality made false. The rules are named from the rulebook.
  {
    title: "What you can post",
    body: paragraphs(
      `You can post opinions, including unpopular ones. korbat restricts content only when it breaks a published rule (${RULES.map(ruleName).join(", ")}), or when it is illegal under EU law or the law of an EU country and someone tells korbat so in a notice. Every decision names the rule or the law and says why, and a final decision that restricts your content can be appealed as the section "Appeals" describes. The one restriction that is not korbat's decision is an authority's order (Authorities' orders).`,
      // 3b (11.3): the licence for every post and image, written here or imported, which Importing posts points to.
      `You grant korbat a licence for every post and image you put on it, written here or imported: ${LICENCE}.`,
    ),
  },
  // The rulebook itself, as @korbat/rules holds it: the grounds on which korbat restricts content (Digital Services Act, Article 14(1)).
  {
    title: "The rules",
    body: paragraphs(
      `These are korbat's rules, in version ${RULES_VERSION} of its rulebook. A decision under a rule names the rule, and its statement of reasons quotes the rule as it stood when the decision was made.`,
      ...RULES.map((rule) => `${rule.id}. ${rule.title}. ${rule.text}`),
    ),
  },
  {
    title: "Reports and notices",
    body: paragraphs(
      "Anyone can report a post, an image or a profile on korbat, signed in or not: choose Report on the item itself, or use the report form linked below these terms. A report says either that the item breaks one of korbat's rules or that it is illegal.",
      "A report about a profile is decided on its display name and bio; korbat decides about the account's posts and images in cases of their own. A report about a post that quotes another is decided on that post's own text and images; the quoted post is decided in a case of its own.",
      `For the sexual abuse or exploitation of a child, child sexual abuse material or grooming, the form has a path of its own, which is anonymous: korbat does not record who sent the report, not even an account, asks for no name and no email, and sends no email. You follow such a report through the link that is shown once on screen. On that path a report about a profile covers the images on all the profile's posts, a report about a post that quotes another covers both posts, and one report can name ${count(CSAM_NOTICE_MAX_ACCOUNTS, "profile")} at most.`,
      "A notice that something is illegal asks you to explain why and to confirm that you report in good faith; which law or country you mean, your name and your email are optional. Reports are anonymous towards the person you report: korbat never tells them who reported them, and a request for their data shows them what was written only where the law requires it (see Your data).",
      `korbat takes at most ${NOTICE_LIMITS.signedOut.perHour} reports an hour and ${NOTICE_LIMITS.signedOut.perDay} a day from one network without an account, and ${NOTICE_LIMITS.signedIn.perHour} an hour and ${NOTICE_LIMITS.signedIn.perDay} a day from one account. One report can name up to ${numberWord(NOTICE_LIMITS.maxTargets)} posts or profiles on korbat, by their links; korbat takes no attachments and follows no links to other sites. What you write to explain a report can be up to ${NOTICE_LIMITS.explanationMax} characters long, and the law or country you cite up to ${NOTICE_LIMITS.citedLawMax}.`,
      "A person looks at every report about something that is on korbat. A link that names nothing korbat can show is answered automatically, and the answer says so. Moderators read reports in the order of their severity and then of their age, never by how many reports an item has, and by who sent them only under the emergency switch. When many reports about one post arrive in a short time from accounts that follow one another, korbat's moderators are shown that; it changes neither the order in which reports are read nor who decides; a moderator still judges the content itself.",
      "The emergency switch: when a flood of reports keeps moderators from real cases, the operator may turn it on until the flood ends. Reports sent without an account or from accounts under 48 hours old are then read after the others of the same severity; in the urgent lane (threats, violence, self-harm, public security, and the sexual abuse or exploitation of children) only reports sent without an account are. A report is never read after a less severe one, and every report is still read and answered.",
      `Every report gets a reference, shown on screen at once. A notice that something is illegal gets a receipt by email at once when you gave an email or sent it from an account; a report on the anonymous path gets none. An email address that has not been confirmed as its sender's in the last ${count(RETENTION.confirmationDays, "day")} gets at most one receipt a day; the others come with the next daily email. For a notice that something is illegal, korbat sends its decisions by email once a day when you gave an email or sent it from an account. Every decision on a report is shown under Settings, Cases, Your reports, or on the report's own page. korbat sends no report email to an address whose holder asked it to stop, and gives up an email it could not send for ${count(RETENTION.mailGiveUpDays, "day")}; the answer stays on the report's page.`,
      "korbat answers each item of a report in one of the following ways.",
      ...ANSWERS,
      // 3e (W.7, W.1): the scope phrases an answer carries when it was a measure on the account a report named.
      `When korbat's answer to a report about an account is a measure on that account, korbat tells you that it took a measure, and not which or for how long: the answer adds "${ACCOUNT_MEASURE_SCOPE.measure}", or "${ACCOUNT_MEASURE_SCOPE.retired}" when it retired the handle. korbat does not tell you what happens to that account afterwards.`,
      `Re-examination: if a moderator answered your report with no action, you can ask once for a re-examination, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with an optional statement, under Your reports or on the report's page. It is decided again as a new report, by a moderator; korbat asks another moderator than the one who decided to take it when it has one. You can ask for at most ${count(DAILY_LIMITS.reexaminations, "re-examination")} a day. Its answer is final within korbat, with one exception: an answer given while korbat's staff could not open a post's images, because a report of child sexual abuse material about them was waiting or because they were sealed, says so and can be asked again. An outcome changed on review or by a correction is final within korbat, and everyone whose report it answered is told. ${COURTS}`,
    ),
  },
  {
    title: "How moderators decide",
    body: paragraphs(
      // 3d (W.9): what a program may do until a moderator decides is in Automated tools.
      "A moderator decides every case; what a program may do until then is in Automated tools. A moderator never decides about their own accounts or about accounts close to them.",
      `Some decisions only an admin takes: every final decision, whether it acts or not, on a report or a moderator's finding under ${ADMIN_RULES} or on a report made on the anonymous path, every lifting of a seal, and every correction of such a decision. Until an admin decides, any moderator may at once hide a reported threat from other people, or seal reported images.`,
      "On the path for child sexual abuse material, a moderator and an admin decide without seeing the images, on the report and on what korbat can read. Nobody at korbat opens images that are reported or found as such material while the report is unanswered or the images are sealed; that covers the images of a post while such a report about it, or about its author's profile, is unanswered. After an admin has answered without a seal, staff may open them like any other image, except an image that an automated comparison matched: korbat's staff do not open such an image at any time. Reports on other grounds about those images, corrections and appeals are meanwhile decided on what korbat can read, or wait. An admin's answer to such a report about a post also answers the earlier reports about that post, and whoever sent a report about a post that is answered without action while its images cannot be opened is told so and may ask again.",
      "A seal can cover every image on a profile's posts. It hides the images from everyone, their author included, from the first seal, and never hides a post's text. A report of this kind about a post that quotes another opens a case on the quoted post too.",
      MEASURES_PARAGRAPH,
      "A reset is written once, and korbat does not put the old value back: you may set the field again, and what you set is judged on its own if someone reports it. korbat restricts the least it can: one image rather than the post, one field rather than the account. Every finding of a breach is recorded as a restriction of its own, also when the content was already not shown or already deleted; its statement then says that it changed nothing now.",
      "Every decision that restricts your content, also one that changes nothing anyone sees now, every decision that reverses one, every answer to your appeal, and every end or lifting of something korbat told you it did while deciding comes with a statement of reasons, in the app at once and by email. A decision to take no action is not sent to you, since it would tell you that someone reported you, unless it ends or lifts something korbat told you it did while deciding. Something korbat does while deciding about a post you had already deleted is recorded without being sent to you, since it can never take effect. Content restricted for being illegal is restricted everywhere, since korbat cannot restrict by country.",
    ),
  },
  // 3d (W.9): what a program may do, after the section that says a moderator decides every case.
  { title: "Automated tools", body: AUTOMATED_TOOLS },
  {
    title: "Appeals",
    body: paragraphs(
      `If a final decision restricts your content or your account, you can appeal it once, while any of it is in force, within ${count(APPEAL_MONTHS, "month")} of being told, free of charge and with no form to follow: choose "Appeal" on the decision's screen under Settings, Cases. You can file at most ${count(DAILY_LIMITS.appeals, "appeal")} a day.`,
      "What korbat does while it decides cannot be appealed. It ends with the case's final decision, which is shown and sent to you and can be appealed when it restricts; a seal ends with an admin's answer to the reports it was taken on. A moderator may lift it earlier; a seal, only an admin. What a program does while a person has not decided cannot be appealed; you can ask for a person at once, and the person's decision can be appealed.",
      "An appeal is reviewed by a moderator who made none of the case's decisions, including hiding the content while it was decided, did not report it, and has no link to anyone in the case. While korbat has no such moderator the appeal waits, without a time limit, and its screen says so: with one moderator every appeal waits, and with two every case both took part in, where one hid the content or reported it and the other decided it, which is how direct threats and images reported as child sexual abuse material are handled whenever the moderator on duty is not the admin.",
      "A review keeps the decision, lifts part of it or lifts all of it, and never adds to it. A decision reversed in full can no longer be appealed, since nothing of it remains. A decision that a correction changed in part can still be appealed for what remains of it; an answer to your appeal is final within korbat.",
      `korbat does not put back a display name or a bio it reset: set it again. The screen of the decision that reset it shows what it was while korbat keeps the case's copies, and for at least ${count(RETENTION.resetValueDays, "day")} after a reset that is lifted or ends before they are erased, unless korbat had already erased a value reset under ${R4}, as Your data says.`,
      "An appeal of a seal waits, without a time limit, for the assessment of the authority korbat reported the images to. Only an admin lifts a seal, and a seal for good only on that authority's answer that the images are not child sexual abuse material.",
      // 3e (W.7): what an appeal of a standing measure does and does not do.
      `An appeal never holds the start of a suspension; a reply does. When korbat keeps a decision in answer to a reply you sent before its start, the ${count(APPEAL_MONTHS, "month")} to appeal it count from that answer. The appeal of a protective suspension is reviewed at once; only the appeal of a decision that seals images waits for the authorities.`,
      // 3f (W.6): an order is no decision of korbat's, and what a hold delays counts from the day korbat may tell.
      "korbat's appeal does not apply to what korbat does on an authority's order. If such an order forbids korbat to tell you about a post, korbat's answer to an appeal you made about that post reaches you only when it may tell you of the order; your time to appeal a decision you are told of late counts from the day you are told.",
      COURTS,
    ),
  },
  // 3e's four sections (design, W.7), after the appeals they refer to.
  { title: "Strikes", body: STRIKES },
  { title: "Suspension and termination", body: SUSPENSION },
  { title: "Reporting in bad faith", body: REPORTING_IN_BAD_FAITH },
  { title: "Handles", body: HANDLES },
  // 3f (W.6): what an authority's order is and what korbat does with one, before the section on removal orders.
  { title: "Authorities' orders", body: AUTHORITIES_ORDERS },
  // The policy Article 7(1) of Regulation (EU) 2021/784 asks for; its one hour is the Regulation's own figure.
  { title: "Terrorist content", body: TERRORIST_CONTENT },
  // 3f (W.6): only while the build has a contact point for authorities to publish.
  ...(CONTACT_POINT === "" ? [] : [{ title: "Contact point for authorities", body: CONTACT_POINT_SECTION }]),
  // 3d (W.9): what korbat publishes, and the one count it keeps to publish it.
  { title: "Transparency", body: TRANSPARENCY },
  // The 2c design's sentence (section 2). It joins the draft without a new TERMS_VERSION, as 1b's and 1c's changes did before any public sign-up.
  {
    title: "Explore",
    body: "Public posts can appear in Explore, ranked by how many other accounts like or repost them; How Explore works gives the rules, and Settings > Privacy keeps your posts out.",
  },
  { title: "Importing posts", body: IMPORTING_POSTS },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    // UI Task 8 (8.8): the first paragraph names what the browser keeps beside the device id; it joins the draft without
    // a new TERMS_VERSION, as 2c's to 3f's sentences did.
    body: paragraphs(
      "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. Your browser also keeps, until you sign out, your appearance choices, where you stopped reading in Following and Latest, and drafts you have not sent; none of them leaves the browser, and Clear what this device keeps, in Settings > Appearance and accessibility, removes them at once. The device id stays, and so does your Not now on the passkey card. At sign-in, and when you send a report without being signed in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
      // What 3c adds, with the periods of RETENTION (3c design, section 6.6).
      `When someone reports a post or a profile, korbat keeps a copy of its text and holds its images, whatever it then decides. Deleting the post or your account leaves these copies until their period ends. A case's copies are erased when the case closes, or ${count(RETENTION.evidenceHours, "hour")} after its newest copy if that is later, unless a restriction of the case can still be appealed or, for a post, a report that only an admin can answer still waits or its images are sealed.`,
      // 3d (W.9): the same keeping starts on a program's match when nobody reported anything; and what korbat does with
      // sealed images it reported, which promises no destruction and names no period (review ruling 1).
      "For a report of child sexual abuse material, or a comparison that finds a match of the kind Automated tools describes, korbat keeps the images of the reported or matched post, of the post it quotes, or of all a profile's posts until an admin has answered, also when their author deletes the post or the account meanwhile; once their post is deleted they are shown to nobody. Images an admin then keeps sealed are kept for the authorities, with korbat's copies of their post's text; they are left out of your account's export and are not released by korbat on its own. Sealed images that korbat has reported are kept for the authorities, away from the rest of korbat's images and outside its ordinary backups. korbat does not destroy them on its own judgement, and not because an authority has assessed them: only when an authority or a court has given korbat leave or an instruction to destroy them, and an admin has confirmed it. korbat then tells you, at once or as soon as it may. If the authority answers that they are not illegal, the seal is lifted and they are shown again. An authority may never answer. korbat has set no time after which it then destroys them: they stay sealed and kept.",
      `Content korbat removes or resets under ${R4}, a post's text, an image, a display name or a bio, is erased for good, as far as that decision still stands, once it can no longer be appealed, ${count(RETENTION.r4FinalMonths, "month")} after you were told, or once your appeal against it is answered; for a post, later only while a report that only an admin can answer still waits or while its images are sealed. It is erased from your own view, your export and the decision's screen, and from every copy korbat keeps but its backups (an image once no other case still holds it), also when you had deleted the post, so a later reversal cannot bring it back or show it to you again.`,
      `korbat's backups of its database and its images hold everything as it stood when each was taken, what korbat erased since included. Each is deleted ${count(RETENTION.backupDays, "day")} after it was taken, except a backup that korbat must keep for the authorities, which it keeps until they have answered.`,
      `A notifier's name and email are kept apart from the case, never shown to staff or to the person reported, and deleted ${count(RETENTION.contactMonths, "month")} after the last day korbat still owed the report a decision or an email, or ${count(RETENTION.contactMaxMonths, "month")} after the report if nothing moved that day. That an email address was confirmed as a sender's is kept for ${count(RETENTION.confirmationDays, "day")}.`,
      `Staff see a reporter or a notifier as a summary: roughly how old the account is, how many reports it sent, what share were acted on and how many were answered while their images could not be opened, in broad bands, never exact numbers. A moderator sees a reporter's handle or a notifier's name only when a case needs it, for example a claim of impersonation or abuse of reporting, each time with a recorded reason that is shown to every staff member; the person reported never sees either. korbat forgets which account sent a report ${count(RETENTION.intakeDays, "day")} after its last outcome was given and settled, which is at most about ${count(APPEAL_MONTHS + Math.ceil(RETENTION.intakeDays / 30), "month")} after a decision to take no action, while it can still be re-examined, except through the mark of a report found manifestly unfounded (Reporting in bad faith).`,
      `On a report of child sexual abuse material, staff see how many such reports about the same post, profile or author an admin answered without a seal in the last ${count(SUSPECT_EARLIER_MONTHS, "month")}, as a number and a day.`,
      `The reasons korbat gave you for a decision are kept while your account exists and for ${count(RETENTION.statementMonths, "month")} after its deletion; the decision itself stays on record without them. korbat's log of which staff member opened a case, viewed an image or was shown who sent a report, with the reason given for that, is kept for ${count(RETENTION.accessLogMonths, "month")}. A text a moderator wrote for a decision and did not confirm is deleted after ${count(RETENTION.draftHours, "hour")}.`,
      // 3e (W.7): what korbat keeps of account sanctions, with RETENTION's three members.
      `korbat keeps the record of every strike, suspension, termination, warning and retired handle with its decision, as it keeps every decision. What ends is its use: a strike counts for ${count(RETENTION.standingRecord.strikeDays, "day")}, a suspension counts toward the next one for ${count(RETENTION.standingRecord.ladderMemoryDays, "day")}, a warning about reporting for ${count(RETENTION.standingRecord.warningDays, "day")}. The text of a reply to a suspension is kept ${RETENTION.replyText}; a reply that is not answered yet is never erased. To decide about reporting in bad faith korbat counts, for each account and day, how many reports under its rules the account sent, and keeps which of them a moderator marked manifestly unfounded; both are deleted after ${count(RETENTION.reportCountDays, "day")} and with the account, so for that long a marked report stays linked to the account that sent it. A retired handle is kept as a handle (Handles). Your export holds all of this.`,
      // 3d (W.9): what the automated tools and the sealed images leave behind, and RETENTION's printed list of it.
      ...AUTOMATION_DATA,
      // 3f (W.6): what is kept when an account is deleted, korbat's records about authorities, what an authority can get,
      // after a restore, and the periods of RETENTION that concern authorities.
      ...AUTHORITIES_DATA,
      "Your account's export holds the decisions its Cases screens list and your own reports. If you ask for your data at the address under Contact, you receive, within a month, every case about you (cases without action included), the copies korbat keeps, where each case came from (a report by another user, a notice, a moderator) and, where the law requires it after weighing the writer's rights, the words of a report without who wrote it.",
      // 3b (11.3): the import's record and how long it is kept (6.1, decision 25), by IMPORT_RULES' days.
      `An import's record (its source, its state, its times, your choice and its counts, never a file name or the other account) is kept while a post of it exists and at least ${IMPORT_RULES.recordDays} days after the import ended, and goes with your account.`,
      // 2d (11.3): the four drafts, last.
      ...ENGAGEMENT_DATA,
    ),
  },
];
```

### Replace `infra/caddy/Caddyfile` (whole file)

```text
{
  auto_https off
  admin off
}

# Caddy's own 404 for an API path a site does not serve, in the API's error envelope, so the page's parser reads it as it
# reads the API's own 404. Nothing behind it is asked.
(api_not_found) {
  header -Server
  header Content-Type application/json
  header Cache-Control no-store
  respond `{"error":{"code":"not_found","message":"No such route"}}` 404
}

# The page's security headers (3a; 3f, section 7.12): one block for the app's files and for a post's page, so every answer
# of the page carries the same ones, whatever status the post's page gets.
(app_page_headers) {
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
    # challenges.cloudflare.com serves the Turnstile widget script and its iframe (sign-in screens).
    Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    -Server
  }
}

# The app's shell, the same bytes for every post's page: the page itself decides what to show.
(app_shell) {
  root * /srv
  rewrite * /index.html
}

# 2d (design, section 8.2): a post's or a profile's page with its share card. card.html is the shell with one template action,
# written by the image's build, that prints the API's Korbat-Card header decoded into the head. templates runs here and
# nowhere else, so no other answer and no proxied body is ever evaluated: the action only reads a placeholder, Go's
# templates never evaluate what an action prints, and the API writes the delimiters as character references besides.
(card_page) {
  root * /srv
  rewrite * /card.html
  templates
  file_server
}

# The app's site while it is open (APP_SITE=open, the default).
(app_site_open) {
  # A client from the push network (ntfy and the watcher, 3f) is refused here: until the push site, only cloudflared could
  # reach Caddy. The handles below that reach anything each answer it 403 first: a handle of this matcher alone would be
  # sorted after the path handles. PUSH_SUBNET is the network's fixed subnet, from Compose.
  @push remote_ip {$PUSH_SUBNET}

  # The staff API belongs to the console's site below, on an origin of its own: the app's site never forwards it. Each of
  # these handles matches one path, longer than /api/*, and Caddy puts such handles most specific first, so they come
  # ahead of the API proxy below wherever they are written.
  handle /api/staff {
    import api_not_found
  }
  handle /api/staff/* {
    import api_not_found
  }

  # The API. Its own headers pass through untouched: its CSP is the strict one for JSON and images.
  handle /api/* {
    # Image uploads. The API counts bytes itself and stops at 20 MiB; this is the second line behind it.
    @upload path /api/media
    request_body @upload {
      max_size 25MB
    }
    # 3b (design, section 7.3): a chunk of an import's archive, 8 MiB at most, which the API counts itself too. 9MB, in
    # decimal megabytes, is the chunk and some slack (IMPORT_RULES.chunkBodyBytes).
    @import_chunk {
      method PUT
      path_regexp ^/api/imports/[0-9a-f-]{36}/archive$
    }
    request_body @import_chunk {
      max_size 9MB
    }
    # Everything else is JSON, and small. The API caps it at 64 KiB too.
    @json {
      not path /api/media
      not {
        method PUT
        path_regexp ^/api/imports/[0-9a-f-]{36}/archive$
      }
    }
    request_body @json {
      max_size 64KB
    }
    header -Server
    respond @push 403
    reverse_proxy api:3000 {
      # Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a
      # client could set it, so Caddy drops it. Decided at build time by the TUNNEL argument.
      import /etc/caddy/cf-header.caddy
    }
  }

  # A post's page (3f design, sections 5 and 7.12; 2d design, section 8.2): the app's shell under the status of the post's
  # share card, so that a check from outside reads 404 for a post that is not public and never 451, and an unfurler finds the
  # card in the page's first bytes. Caddy asks GET /api/cards/post/<id>, with the visitor's address and cookies as every
  # proxied request carries them (the route reads no session, and the global limit counts the question against the
  # visitor): 204 gives card.html, the card's block in its head, with 200; 404 the plain shell with 404; any other answer (a
  # 429 of the global limit) the plain shell with 200, which loses only the card; handle_errors below does the same when the
  # API cannot be asked. The request's Range is dropped first, so every answer is whole: a 206 of file_server would carry a
  # Content-Range of the template's size, which templates does not rewrite. Every answer says noindex. Task 6's first step and
  # its card lab checked this on this image (Caddy 2.11.4), as 3f's Task 4 checked the status route.
  handle /post/* {
    respond @push 403
    import app_page_headers
    header Cache-Control "no-cache"
    header X-Robots-Tag "noindex"
    encode gzip
    request_header -Range
    reverse_proxy api:3000 {
      import /etc/caddy/cf-header.caddy
      method GET
      rewrite /api/cards/post/{http.request.uri.path.1}
      @shown status 204
      handle_response @shown {
        import card_page
      }
      @gone status 404
      handle_response @gone {
        import app_shell
        file_server {
          status 404
        }
      }
      handle_response {
        import app_shell
        file_server
      }
    }
  }

  # A profile's page (2d design, section 8.2): the same, under the status of the profile's card, GET
  # /api/cards/profile/<handle>, which answers 404 for a handle no live profile holds now.
  handle /u/* {
    respond @push 403
    import app_page_headers
    header Cache-Control "no-cache"
    header X-Robots-Tag "noindex"
    encode gzip
    request_header -Range
    reverse_proxy api:3000 {
      import /etc/caddy/cf-header.caddy
      method GET
      rewrite /api/cards/profile/{http.request.uri.path.1}
      @shown status 204
      handle_response @shown {
        import card_page
      }
      @gone status 404
      handle_response @gone {
        import app_shell
        file_server {
          status 404
        }
      }
      handle_response {
        import app_shell
        file_server
      }
    }
  }

  # card.html is served only through the two handles above: asked by its own path it is 404 with no body (2d, 8.2), so its
  # template action is never sent as text.
  handle /card.html {
    respond @push 403
    import app_page_headers
    header X-Robots-Tag "noindex"
    respond "" 404
  }

  # The web app: static files, the page's security headers, and caching by kind of file.
  handle {
    respond @push 403
    root * /srv
    encode gzip
    import app_page_headers
    # The page is revalidated on every load, so a deploy is seen at once; the hashed bundles never change.
    @immutable path /_expo/* /assets/*
    header @immutable Cache-Control "public, max-age=31536000, immutable"
    @page {
      not path /_expo/* /assets/*
    }
    header @page Cache-Control "no-cache"
    # 2d (design, decision 20 and section 8.2): every page that can name an account asks search engines not to index it; the
    # five that name none do not. Set only where it applies, never set and then dropped: a dropping line would run before
    # the set, after app_page_headers' deferred -Server. robots.txt, a file of /srv, is served here as it is.
    @named {
      not path / /rules /transparency /explore/about /terms
    }
    header @named X-Robots-Tag "noindex"
    try_files {path} /index.html
    file_server
  }

  # A post's or (2d) a profile's page when the API cannot be asked (stopped, or not answering): the plain shell with 200,
  # as before the status, and noindex. Every other error is answered as Caddy answers it without this block.
  handle_errors {
    @pages path /post/* /u/*
    handle @pages {
      import app_page_headers
      header Cache-Control "no-cache"
      header X-Robots-Tag "noindex"
      encode gzip
      import app_shell
      file_server {
        status 200
      }
    }
  }
}

# The app's site while it is closed (APP_SITE=closed; 3f design, section 7.17, a restore): 503 with one fixed sentence to
# every path, the API's included, and nothing else asked or served. The console's site is unchanged.
(app_site_closed) {
  handle {
    header -Server
    header Content-Type "text/plain; charset=utf-8"
    header Cache-Control "no-store"
    respond "korbat is closed for maintenance. Please come back later." 503
  }
}

# The app's site. APP_SITE (open, the default, or closed) is read when Caddy starts and names the snippet that is the
# site: any other value names no snippet, and Caddy refuses to start rather than leave the site open during a restore.
:8080 {
  import app_site_{$APP_SITE:open}
}

# The staff console (3a design, section 8): a site of its own for the console's own origin, CONSOLE_ORIGIN. It serves the
# console's page and proxies the staff API and nothing else. It is always built and always serves the page; the API alone
# switches the console on, and while CONSOLE_ORIGIN is unset every staff path answers 404, which the page explains. Its
# handles each match two paths or none, so Caddy keeps them in the order written: the staff API, the rest of the API, the
# console's files.
:8090 {
  # A client from the push network (3f) is refused, as on the app's site. This handle's matcher names no path, like the
  # two below, so Caddy keeps it first, as written.
  @push remote_ip {$PUSH_SUBNET}
  handle @push {
    header -Server
    respond 403
  }

  # The staff API, proxied as the app's site proxies /api/*. No header_up Host: the API's staff gate compares the Host the
  # browser sent with CONSOLE_ORIGIN. Caddy still replaces whatever X-Forwarded-* headers a client sent with its own.
  @staff path /api/staff /api/staff/*
  handle @staff {
    # Staff requests are small JSON. The API caps them at 64 KiB too.
    request_body {
      max_size 64KB
    }
    header -Server
    reverse_proxy api:3000 {
      # As on the app's site: the per-IP sign-in limits key on CF-Connecting-IP, which only cloudflared may set.
      import /etc/caddy/cf-header.caddy
    }
  }

  # The rest of the API is the app's, never the console's.
  @api path /api /api/*
  handle @api {
    import api_not_found
  }

  # The console's page, from /console, a folder outside the app's /srv, so the app's site can never serve it. Its policy
  # is the strict one of section 3: everything from this origin only, no inline script or style, and Trusted Types with no
  # policy, so no HTML or script sink can be used. apps/admin/site-headers.mjs holds the same headers for the development
  # server, and apps/admin/test/console-site.test.ts keeps the two equal.
  handle {
    root * /console
    encode gzip
    header {
      Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'"
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "DENY"
      Referrer-Policy "no-referrer"
      Cross-Origin-Opener-Policy "same-origin"
      Cross-Origin-Resource-Policy "same-origin"
      # WebAuthn for the console itself only; no camera, microphone or position for anyone.
      Permissions-Policy "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)"
      -Server
    }
    # The hashed script and stylesheet never change under their names. Everything else, the page above all, is neither
    # stored nor transformed: no-transform stops Cloudflare injecting scripts the policy would block on every page view.
    # `file` holds only when the path names a file of the build, so the page answered for a missing /assets/ name (the
    # fallback below) is never kept for a year under that name.
    @immutable {
      path /assets/*
      file
    }
    header @immutable Cache-Control "public, max-age=31536000, immutable"
    @page {
      not {
        path /assets/*
        file
      }
    }
    header @page Cache-Control "no-store, no-transform"
    try_files {path} /index.html
    file_server
  }
}

# The phones' push site (3f design, section 5), for the push hostname (API_PUSH_ORIGIN): only the two topics'
# subscriptions reach ntfy, by GET, which is what the ntfy app sends: the stream a phone holds open (ws, json, sse; both
# topics joined by a comma in one request, in either order), with its replay of what it missed (since=), and the check of
# a user's access (auth). Everything else is Caddy's own 404, ntfy's account API, /v1/config and /v1/stats among them:
# they answer any caller otherwise. Publishing is the watcher's alone, on the push network.
:8091 {
  @subscribe {
    method GET
    path_regexp ^/(korbat-oncall|korbat-all)(,(korbat-oncall|korbat-all))?/(ws|json|sse|auth)$
  }
  handle @subscribe {
    header -Server
    reverse_proxy ntfy:2586 {
      # As on the other sites: a client-set CF-Connecting-IP is dropped unless TUNNEL=on. ntfy reads the client from
      # X-Forwarded-For (behind-proxy); behind the tunnel that header takes CF-Connecting-IP's value (the Dockerfile).
      import /etc/caddy/cf-header.caddy
      import /etc/caddy/push-header.caddy
    }
  }
  handle {
    header -Server
    respond 404
  }
}
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
# Whether the account settings show the verified badge section (WEB_BADGE in infra/.env): on only when the API's
# verification provider is on, off by default as the provider is. Anything else is refused, so a typo cannot hide or show it.
ARG EXPO_PUBLIC_BADGE=off
RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac
# The users' contact address (WEB_CONTACT_EMAIL in infra/.env), inlined like the site key: the report form names it when
# the form itself cannot be used, and the terms page shows it. A build without an address is refused, and a production
# build refuses a placeholder domain, as it refuses a Turnstile test key: mail to it would reach nobody.
ARG EXPO_PUBLIC_CONTACT_EMAIL
RUN case "$EXPO_PUBLIC_CONTACT_EMAIL" in *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_EMAIL build argument must be an email address" >&2; exit 1;; esac
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_EMAIL##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_EMAIL is a placeholder address; a production build needs the address people can write to" >&2; exit 1;; esac; fi
# 3f: the contact point for authorities and the Member State korbat is established in (WEB_CONTACT_POINT and WEB_HOME_STATE
# in infra/.env), inlined like the contact address for the terms' sections on them: the page is built, so it cannot read
# the API's settings of the same values. Both may stay empty until the last step of the README's Before going public; the
# terms then print no contact point and name no state. When set, a point is an address and needs its state, a state is a
# two-letter code, and a production build refuses a placeholder domain for the point as it does for the contact address.
ARG EXPO_PUBLIC_CONTACT_POINT=
ARG EXPO_PUBLIC_HOME_STATE=
RUN case "$EXPO_PUBLIC_CONTACT_POINT" in "") ;; *?@?*.?*) ;; *) echo "the EXPO_PUBLIC_CONTACT_POINT build argument must be empty or an email address" >&2; exit 1;; esac
RUN case "$EXPO_PUBLIC_HOME_STATE" in "") ;; [A-Z][A-Z]) ;; *) echo "the EXPO_PUBLIC_HOME_STATE build argument must be empty or a Member State's two-letter code" >&2; exit 1;; esac
RUN if [ -n "$EXPO_PUBLIC_CONTACT_POINT" ] && [ -z "$EXPO_PUBLIC_HOME_STATE" ]; then echo "EXPO_PUBLIC_CONTACT_POINT needs EXPO_PUBLIC_HOME_STATE: the terms name the state whose authorities write to it" >&2; exit 1; fi
RUN if [ "$KORBAT_ENV" = "production" ] && [ -n "$EXPO_PUBLIC_CONTACT_POINT" ]; then case "$(printf %s "${EXPO_PUBLIC_CONTACT_POINT##*@}" | tr A-Z a-z)" in *.local|*.localhost|*.test|*.invalid|*.example|example.com|example.org|example.net) echo "EXPO_PUBLIC_CONTACT_POINT is a placeholder address; a production build needs the address authorities write to" >&2; exit 1;; esac; fi
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" EXPO_PUBLIC_CONTACT_EMAIL="$EXPO_PUBLIC_CONTACT_EMAIL" EXPO_PUBLIC_CONTACT_POINT="$EXPO_PUBLIC_CONTACT_POINT" EXPO_PUBLIC_HOME_STATE="$EXPO_PUBLIC_HOME_STATE" npx expo export --platform web
# 2d (design, section 8.2): card.html, the export's index.html with one line inserted right after its charset's meta element:
# the one template action, which prints the API's Korbat-Card header decoded. Caddy runs templates on it for a post's or a
# profile's page and nowhere else. The build fails unless the action is there exactly once and the file holds no other {{.
RUN cd apps/app/dist && action='    {{placeholder "http.reverse_proxy.header.Korbat-Card" | b64dec}}' && awk -v marker='<meta charset="utf-8" />' -v action="$action" '{ print } index($0, marker) > 0 && !done { print action; done = 1 }' index.html > card.html && test "$(grep -c "{{" card.html)" = 1 && test "$(grep -cxF -e "$action" card.html)" = 1 || { echo "card.html needs the card's template action exactly once, after the charset's meta element, and no other {{" >&2; exit 1; }

# The staff console (apps/admin), in a stage of its own: its page takes no build argument and holds no secret, and its
# packages never meet the app's. esbuild writes dist/: index.html, favicon.svg and the hashed script and stylesheet.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS console
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile --filter @korbat/admin...
RUN pnpm --filter @korbat/admin build

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
# The push site (3f): ntfy reads the client from X-Forwarded-For, which behind the tunnel would name cloudflared for
# every phone, so that one client's wrong tokens would shut every phone out; there it takes CF-Connecting-IP's value.
RUN if [ "$TUNNEL" = "on" ]; then echo "header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}" > /etc/caddy/push-header.caddy; else : > /etc/caddy/push-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# 2d (design, section 8.2, decision 20): robots.txt, which the files' handle serves as it serves any file of /srv: the pages
# that carry cards and their images open to the link-preview fetchers it names, everything closed to every other agent.
COPY infra/caddy/robots.txt /srv/robots.txt
# The console's site serves /console, a folder outside the app's /srv, so the app's site can never serve the console.
COPY --from=console /repo/apps/admin/dist /console
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Ports 8080, 8090 and 8091 need no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on ports it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
# The app's site, the staff console's and (3f) the phones' push site.
EXPOSE 8080 8090 8091
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 *    The console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and
 *    the console's site answers the app's own moderation routes with 404 itself.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, no fingerprint of it is stored while MEDIA_MATCH is off (3d Task 7), and large.webp is
 *    served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, reports the first account's post under a rule
 *     (its own list of reports shows the report undecided, and no decision is about it), downloads its
 *     export as a ZIP whose export.json ends with the moderation member holding that report, since 3b the account's
 *     imports (none) and, since 2d, its Activity, posts, and deletes itself with a code read from Mailpit and its handle typed;
 *     afterwards its profile is not found, its session is gone, and its post has left the Latest timeline.
 * 15. Signed out, a notice that the first account's post is illegal is taken through the app's site with the
 *     human check: it answers a reference and a token. The status page opens with that token and shows the
 *     post's link, undecided, and the contact as given; another token finds no notice. The receipt arrives in
 *     Mailpit under the reference, and the token in its link opens the same page with the address not yet
 *     confirmed. Nothing here decides the case: a decision needs a staff key.
 * 16. With --push (3f, the stack under the Compose profile notify): the phones' push site answers 404 itself to ntfy's
 *     /v1/config, /v1/stats and /v1/account and to a publish, and hands a topic's subscription to ntfy, which refuses
 *     it without a user (403); from inside the ntfy container, on the push network, the app's and the console's sites
 *     answer 403. The contact point's routes (/api/staff/contact) stand behind the console's two doors like the case
 *     routes, in step 2.
 * 17. 3f: a post's page (/post/<id>) answers 200 while the post is public, the shell with its share card in its head (2d
 *     Task 6, step 23), and the plain shell, the same bytes as /, with the same security headers and noindex, with 404 once
 *     its author deleted it, and 404 for a post that does not exist or a malformed id: Caddy asks the API's card route, GET
 *     /api/cards/post/<id>; 3f's status route, GET /api/posts/<id>/status, still answers 204 or 404 with no body.
 * 18. With --closed (3f, the stack started with APP_SITE=closed, as for a restore): every path of the app's site, the
 *     API's included, answers 503 with Caddy's one sentence, the console's site still serves its page, and nothing else
 *     runs, since nothing else can be reached through the app's site.
 * 19. 3d Task 4: GET /api/public/facts answers no-cache and names every tool off (the R1 check, the comparison with
 *     known material, the edge and the head's witness). A status code proves nothing about the two public pages, since
 *     the web export is one page and Caddy answers every unknown path with its shell: so the lead sentences of the rules
 *     page and of the transparency page are looked for in the bundle Caddy serves under /_expo/, which proves they were
 *     built in (the app's render tests prove the pages). An app test holds the two sentences here to the pages' own.
 * 20. UI Task 3: the app's page and the files it loads first, as Caddy serves them: / answers 200 with no-cache;
 *     /theme-boot.js, the script that paints the reader's theme before the bundle, answers 200 with no-cache like the
 *     page; the first font file the entry bundle names (a hashed /assets/__node_modules/@fontsource-variable/... woff2)
 *     answers 200 with public, max-age=31536000, immutable; and a post's page answers 200 while the post is public and
 *     404 for a post that does not exist (step 17 checks the rest of the post's page).
 * 21. 3b Tasks 4 and 8: the whole import, before the grant-role step while the first account's session works: the account
 *     aged past seven days through psql in the postgres container, a Mastodon archive built here with fflate's zipSync
 *     (four public posts, a followers-only one and a boost beside a 9 MiB file korbat never opens), created and sent in
 *     chunks of 8 MiB with their SHA-256 through Caddy, the real importer's scan read by import-drive until the import is
 *     ready with its counts and its three samples, the archive gone once read; the importer healthy with only a loopback
 *     interface and 512 MiB. Then confirmed (POST /api/imports/:id/confirm) with every choice off or open, long posts left
 *     out and the statement; images are off in the stack, so it publishes at once, and import-drive's rounds every five
 *     seconds publish the four posts until it is done. The profile's Imported tab (GET /api/profiles/<handle>/imported)
 *     holds them, newest first by the archive's day, each labelled as imported from Mastodon with its day; the profile
 *     shows the tab (hasImported) and counts four more posts, and Latest holds none of them. Last, Remove imported posts
 *     (POST /api/imports/:id/undo) runs until the import is undone: the tab is empty, the profile no longer shows it and
 *     counts as before. The stack needs the archive's size, 4 GiB and IMPORT_MIN_FREE_BYTES free on Docker's disk.
 * 22. 2d Task 3: the first account's picture, a 900 by 600 JPEG whose middle third is a band of its own colour, sent through
 *     Caddy with kind=avatar&crop=centre and made square by the real worker (version 3 of its result); PUT /api/me/avatar
 *     sets it, /api/me and the author of the account's post carry its two paths, and large.webp is a 400 px square cut
 *     from the centre, served to anyone under the public header. It stays the account's picture.
 * 23. 2d Task 6: the share cards through the real Caddy, with Twitterbot's request from infra/caddy/lab/crawlers.json and no
 *     cookie. The first account's post (/post/<id>) and profile (/u/<handle>) answer 200 with the generic card while its
 *     link previews are off (the default): korbat's words alone, noindex in the header and in the head, and the served
 *     title korbat. Once the account sets its own display name to {{env "HOME"}} and turns previews on, the full cards: the
 *     name printed as text, escaped, with Caddy's HOME nowhere in the page and no {{ left in it; the post's text and time,
 *     its author's picture of step 22 with its description, the profile's handle. The name and the switch are put back.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Every run leaves its first account, by then a moderator, and one open case on that account's post, in the lane
 * that is read last, with a report and a notice that no run can decide. One network may run it five times an hour
 * and five times a day: its two sign-ups count against the hourly sign-up limit, its signed-out notice against the
 * limits of reports sent without an account, and its import against the five imports started from one address in a
 * day (3b's import-address-day).
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
// 3f: the phones' push site (Caddy's third site), only while the stack runs with the Compose profile notify.
const pushBase = option("push");
// 3f: the app's site closed by APP_SITE=closed (step 18).
const closed = options.includes("--closed");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] [--push <url>] [--closed] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");
/** The fflate the API depends on: the export's archive is opened with the library the API's own tests open it with. */
const { strFromU8, strToU8, unzipSync, zipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/** What a failed human check answers: the sign-in routes' code, and the code of a report sent signed out. */
const HUMAN_CHECK_REFUSALS = ["turnstile_failed", "human_check_failed"];

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (HUMAN_CHECK_REFUSALS.includes(result.body?.error?.code) && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type, ifNoneMatch } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** The headers a page's security rests on, which Caddy sets the same on every answer of the app's page. */
const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cache-control"];

/**
 * 3f (design, section 7.12): a post's page as a browser or a checker asks for it, through Caddy: its status, its media
 * type, its bytes and the security headers.
 */
async function postPage(postId) {
  const res = await fetch(`${base}/post/${postId}`, { headers: { accept: "text/html" } });
  const security = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, res.headers.get(name) ?? undefined]));
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()), security, robots: res.headers.get("x-robots-tag") };
}

/**
 * 3f (step 18): the app's site closed by APP_SITE=closed answers every path, the API's included, with 503 and Caddy's
 * one sentence; the console's site is not touched.
 */
async function closedSite() {
  for (const path of ["/", `/post/${randomUUID()}`, "/api/health", "/api/me", "/api/staff/me", "/assets/none.js"]) {
    const res = await send(path);
    check(`3f: with APP_SITE=closed, ${path} answers 503 with the fixed sentence`, res.status === 503 && res.bytes.toString("utf8") === "korbat is closed for maintenance. Please come back later.", `HTTP ${res.status}`);
  }
  const page = await fetch(`${consoleBase}/`);
  await page.arrayBuffer();
  check("3f: the console's site still serves its page", page.status === 200, `HTTP ${page.status}`);
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

/**
 * 3d Task 3 (design, sections 2 row 12 and 7.4): the header of a public image, which the API builds from the contracts'
 * EDGE_CACHE: a browser's minute, an edge's five minutes, revalidated and never stale.
 */
const PUBLIC_IMAGE_CACHE = "public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0";

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");
  // 3d Task 7 (design, section 7.8; row 10): with every adapter off (MEDIA_MATCH=off) nothing is hashed: no row of
  // media_hashes exists for the upload. Read as the database's owner inside its own container, which the id alone reaches.
  const hashed = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.media_hashes where media_id = '${id}'"`);
  check("3d: with MEDIA_MATCH off no media_hashes row exists for it", hashed === "0", hashed);

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, served);
  // 3d Task 3 (design, section 7.4): the 304 of a public image carries the same header through Caddy.
  const revalidated = await send(large, { ifNoneMatch: file.headers.get("etag") ?? "" });
  check("3d: its 304 carries the same header", revalidated.status === 304 && revalidated.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${revalidated.status}, ${revalidated.headers.get("cache-control")}`);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const shown = await postPage(created.body.id);
  // 2d Task 6: a public post's page is card.html, the shell with the card's block in its head; the plain shell is /'s bytes.
  const shell = (await send("/")).bytes;
  check(
    "3f, 2d: the post's page answers 200 while the post is public, the shell with its card",
    shown.status === 200 && shown.type === "text/html; charset=utf-8" && shown.bytes.toString("utf8").includes('<meta property="og:site_name" content="korbat" />'),
    `HTTP ${shown.status}, ${shown.type}`,
  );
  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const gone = await postPage(created.body.id);
  check("3f: once deleted, its page answers the plain shell with 404, never 451", gone.status === 404 && gone.bytes.equals(shell), `HTTP ${gone.status}`);
  check("3f, 2d: the same security headers and noindex on both answers", isDeepStrictEqual(gone.security, shown.security) && shown.security["content-security-policy"] !== undefined && gone.robots === "noindex" && shown.robots === "noindex", JSON.stringify(gone.security));
  const missing = await postPage(randomUUID());
  const malformed = await postPage("not-a-post");
  check("3f: a post that does not exist and a malformed id answer 404 with the plain shell", missing.status === 404 && malformed.status === 404 && missing.bytes.equals(shell) && malformed.bytes.equals(shell), `HTTP ${missing.status}, ${malformed.status}`);
  const status = await send(`/api/posts/${created.body.id}/status`);
  check("3f: the API's status route answers 404 with no body for the deleted post", status.status === 404 && status.bytes.length === 0, `HTTP ${status.status}, ${status.bytes.length} bytes`);
  const after = await send(large);
  check("its image is no longer served, and its 404 may be cached by nobody", after.status === 404 && after.headers.get("cache-control") === "no-store", `HTTP ${after.status}, ${after.headers.get("cache-control")}`);
  const unknown = await send(`/api/media/${randomUUID()}/large.webp`);
  check("3d: an image that does not exist answers 404 with no-store", unknown.status === 404 && unknown.headers.get("cache-control") === "no-store", `HTTP ${unknown.status}, ${unknown.headers.get("cache-control")}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/**
 * 2d Task 3 (design, sections 7.2 to 7.5; step 22): the account's picture through the real worker. The source is 900 by 600,
 * blue with its middle third orange, so the centre crop's square (600 px from x = 150) has orange at its centre, and the
 * start's or the end's would not.
 */
async function avatar(token, postId) {
  const band = await sharp({ create: { width: 300, height: 600, channels: 3, background: "#e0a020" } }).png().toBuffer();
  const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#204080" } }).composite([{ input: band, left: 300, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
  const sent = await send("/api/media?kind=avatar&crop=centre", { method: "POST", token, body: source, type: "image/jpeg" });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  if (!check("2d: upload a picture with kind=avatar&crop=centre through Caddy", sent.status === 202 && id !== null, `HTTP ${sent.status}`)) return;
  const state = await waitReady(id, token);
  if (!check("2d: the worker makes it ready as a 400 px square", state.status === "ready" && state.width === 400 && state.height === 400, `${state.status} ${state.width}x${state.height}`)) return;
  const set = await api("/api/me/avatar", { method: "PUT", json: { mediaId: id }, token });
  const paths = { small: `/api/media/${id}/small.webp`, large: `/api/media/${id}/large.webp` };
  if (!check("2d: PUT /api/me/avatar sets it and answers its two paths", set.status === 200 && isDeepStrictEqual(set.body?.avatar, paths), set.summary)) return;
  const me = await api("/api/me", { token });
  check("2d: /api/me carries the picture", isDeepStrictEqual(me.body?.avatar, paths), JSON.stringify(me.body?.avatar));
  const post = await api(`/api/posts/${postId}`);
  check("2d: the author of the account's post carries it, signed out", post.status === 200 && isDeepStrictEqual(post.body?.author?.avatar, paths), post.summary);
  const file = await send(paths.large);
  check("2d: large.webp is served to anyone under the public header", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${file.status}, ${file.headers.get("cache-control")}`);
  const meta = file.status === 200 ? await sharp(file.bytes).metadata() : null;
  const { data, info } = file.status === 200 ? await sharp(file.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : { data: Buffer.alloc(0), info: { width: 0, height: 0, channels: 3 } };
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  const centre = data.length > at + 2 ? [data[at], data[at + 1], data[at + 2]] : [0, 0, 0];
  check("2d: it is a 400 px WebP square cut from the centre", meta?.format === "webp" && meta.width === 400 && meta.height === 400 && centre[0] > 150 && centre[2] < 100, `${meta?.format} ${meta?.width}x${meta?.height}, centre ${centre.join(",")}`);
}

/** Twitterbot's request as the card lab's crawlers.json gives it: its User-Agent and Accept-Encoding, and no cookie. */
const TWITTERBOT = JSON.parse(readFileSync(new URL("../infra/caddy/lab/crawlers.json", import.meta.url), "utf8")).crawlers.find((crawler) => crawler.name === "Twitterbot").headers;

/**
 * A page as Twitterbot asks for it through Caddy: its status, its X-Robots-Tag, its text, its served titles and its head
 * block's tags, which are robots, description and the namespaced ones (og:, twitter:, article:, profile:); the shell's own
 * viewport and color-scheme are no card's.
 */
async function cardPage(path) {
  const res = await fetch(`${base}${path}`, { headers: TWITTERBOT });
  const text = await res.text();
  const tags = [...text.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)" [/]>/g)].map((match) => [match[1], match[2]]).filter(([key]) => key === "robots" || key === "description" || key.includes(":"));
  return { status: res.status, robots: res.headers.get("x-robots-tag"), text, titles: text.match(/<title>[^<]*<[/]title>/g) ?? [], tags };
}

/**
 * Step 23 (2d Task 6, design section 12.4): the share cards of the account's post and profile through the real Caddy, with
 * Twitterbot's request: the generic card while its link previews are off, the full one once on, and a display name the
 * account set to a template action printed as text.
 */
async function cards(token, postId) {
  const me = await api("/api/me", { token });
  const picture = me.body?.avatar?.large;
  if (!check("2d: the account has its picture of step 22 for its cards", typeof picture === "string" && typeof postId === "string", JSON.stringify(me.body?.avatar))) return;
  for (const [path, title] of [
    [`/post/${postId}`, "A post on korbat"],
    [`/u/${handle}`, "A profile on korbat"],
  ]) {
    const page = await cardPage(path);
    check(
      `2d: with previews off (the default) ${path.split("/")[1]}'s page is the generic card: korbat's words alone, noindex, the served title korbat`,
      page.status === 200 &&
        page.robots === "noindex" &&
        isDeepStrictEqual(page.tags.map(([key]) => key), ["robots", "og:site_name", "og:type", "og:url", "og:title", "twitter:card"]) &&
        page.tags.find(([key]) => key === "og:title")?.[1] === title &&
        page.tags.find(([key]) => key === "og:url")?.[1].endsWith(path) &&
        isDeepStrictEqual(page.titles, ["<title>korbat</title>"]) &&
        !page.text.includes("Smoke Test") &&
        !page.text.includes(picture),
      `HTTP ${page.status}, ${JSON.stringify(page.tags)}`,
    );
  }

  const named = await api("/api/me/profile", { method: "PATCH", json: { displayName: '{{env "HOME"}}' }, token });
  const on = await api("/api/me/share-previews", { method: "POST", token });
  if (!check("2d: the account sets its display name to a template action and turns link previews on", named.status === 200 && on.status === 200 && on.body?.sharePreviews === true, `${named.summary}, ${on.summary}`)) return;
  const home = inside("caddy", "printenv HOME || true");
  const escapedTitle = `&#123;&#123;env &quot;HOME&quot;&#125;&#125; (@${handle})`;
  const post = await cardPage(`/post/${postId}`);
  const read = (page, key) => page.tags.find(([name]) => name === key)?.[1];
  const created = (await api(`/api/posts/${postId}`)).body?.createdAt;
  check(
    "2d: with previews on the post's card names its author, its text, its time and its author's picture, the display name printed as text",
    post.status === 200 &&
      read(post, "og:type") === "article" &&
      read(post, "og:title") === escapedTitle &&
      read(post, "og:description") === "smoke test post" &&
      read(post, "og:image")?.endsWith(picture) &&
      read(post, "og:image:alt") === `Profile picture of @${handle}` &&
      read(post, "article:published_time") === created &&
      read(post, "twitter:card") === "summary" &&
      isDeepStrictEqual(post.titles, ["<title>korbat</title>"]),
    JSON.stringify(post.tags),
  );
  const profile = await cardPage(`/u/${handle}`);
  check(
    "2d: with previews on the profile's card names it, with its picture and its handle",
    profile.status === 200 && read(profile, "og:type") === "profile" && read(profile, "og:title") === escapedTitle && read(profile, "og:image")?.endsWith(picture) && read(profile, "profile:username") === handle,
    JSON.stringify(profile.tags),
  );
  for (const page of [post, profile]) {
    check("2d: nothing evaluated the name: no {{ in the page, and Caddy's HOME nowhere in it", !page.text.includes("{{") && (home === "" || !page.text.includes(home)), `HOME ${home === "" ? "unset" : "set"}`);
  }
  const back = await api("/api/me/profile", { method: "PATCH", json: { displayName: "Smoke Test" }, token });
  const off = await api("/api/me/share-previews", { method: "DELETE", token });
  check("2d: the display name and the switch are put back", back.status === 200 && off.status === 200 && off.body?.sharePreviews === false, `${back.summary}, ${off.summary}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);

  // The console's case routes (3c design, section 12) stand behind the same two doors: the overview, the queue, a case
  // and the appeals, and since account sanctions (3e design, section 12.2) the Standing screen's lists. The staff session
  // is asked for before anything of the request is read, so a case that does not exist answers like the others.
  // 3f: the contact point's list too.
  const caseRoutes = ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${randomUUID()}`, "/api/staff/appeals", "/api/staff/standing", "/api/staff/contact"];
  const answers = (list) => list.map((answer, index) => `${caseRoutes[index]}: ${answer.summary}`).join("; ");
  const casesOnApp = await Promise.all(caseRoutes.map((path) => getJson(`${base}${path}`)));
  check(
    "the app's site refuses the console's case routes itself, with 404",
    casesOnApp.every((answer) => answer.status === 404 && answer.body?.error?.code === "not_found" && answer.body.error.requestId === undefined),
    answers(casesOnApp),
  );
  const casesOnConsole = await Promise.all(caseRoutes.map((path) => getJson(`${consoleBase}${path}`)));
  check(
    "signed out, the console's site answers its case routes with 401 staff_session_required",
    casesOnConsole.every((answer) => answer.status === 401 && answer.body?.error?.code === "staff_session_required"),
    answers(casesOnConsole),
  );
  // And the other way round: the console's site proxies the staff API and nothing else, so the app's own moderation
  // routes are answered there by Caddy, never by the API.
  const appRoute = await getJson(`${consoleBase}/api/moderation/cases`);
  check("the console's site refuses the app's moderation routes itself, with 404", appRoute.status === 404 && appRoute.body?.error?.code === "not_found" && appRoute.body.error.requestId === undefined, appRoute.summary);
}

/**
 * The phones' push site (3f design, sections 5 and 12.2, with --push). Caddy hands ntfy only the two topics'
 * subscriptions: every path of ntfy's own API answers Caddy's 404 (ntfy's /v1/config and /v1/stats answer any caller
 * otherwise), and so does a publish; a subscription without a user reaches ntfy, whose deny-all answers 403. And from
 * inside the ntfy container, on the push network, the app's and the console's sites refuse the request with 403: until the
 * push site, only cloudflared could reach Caddy.
 */
async function pushSite() {
  for (const path of ["/v1/config", "/v1/stats", "/v1/account", "/v1/health", "/", "/korbat-all"]) {
    const res = await fetch(`${pushBase}${path}`);
    check(`the push site answers ${path} with 404 itself`, res.status === 404 && res.headers.get("server") === null, `HTTP ${res.status}`);
  }
  const publish = await fetch(`${pushBase}/korbat-all`, { method: "POST", body: "a publish from outside" });
  check("the push site refuses a publish with 404", publish.status === 404, `HTTP ${publish.status}`);
  const subscribe = await fetch(`${pushBase}/korbat-oncall,korbat-all/json?poll=1`);
  const refusal = await subscribe.json().catch(() => null);
  check("a subscription without a user reaches ntfy, which refuses it", subscribe.status === 403 && refusal?.code === 40301, `HTTP ${subscribe.status} ${JSON.stringify(refusal)}`);
  for (const [site, port] of [["app's", 8080], ["console's", 8090]]) {
    const answer = inside("ntfy", `wget -q -S -O /dev/null http://caddy:${port}/ 2>&1; true`);
    check(`from the push network the ${site} site answers 403`, / 403 /.test(answer), answer.split(String.fromCharCode(10))[0]);
  }
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
/** The lead sentences of /rules and /transparency (RULES_PAGE.lead and TRANSPARENCY_PAGE.lead), held to them by an app test. */
const RULES_LEAD =
  "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the day of the decision.";
const TRANSPARENCY_LEAD =
  "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a decision concerns gets its full reasons from korbat directly.";

/** Step 19 (3d Task 4): the facts of a stack with every adapter off, and the two pages' lead sentences in the bundle. */
async function publicPages() {
  const res = await fetch(`${base}/api/public/facts`);
  const facts = await res.json().catch(() => null);
  check("3d: GET /api/public/facts answers no-cache", res.status === 200 && res.headers.get("cache-control") === "no-cache", `HTTP ${res.status}, ${res.headers.get("cache-control")}`);
  check(
    "3d: the facts name every tool off: the R1 check, the comparison with known material, the edge and the witness",
    facts?.r1?.state === "off" && facts?.match?.state === "off" && facts?.edge?.on === false && facts?.witness?.on === false,
    JSON.stringify(facts),
  );
  const shell = await (await fetch(`${base}/`)).text();
  const scripts = [...shell.matchAll(/<script[^>]* src="([^"]+)"/g)].map((match) => match[1]).filter((src) => src.startsWith("/_expo/"));
  if (!check("3d: the app's shell loads its bundle from /_expo/", scripts.length > 0, `${scripts.length} scripts`)) return;
  // A minifier may write an apostrophe inside a string escaped; the sentence is looked for with it read back.
  const escapedQuote = `${String.fromCharCode(92)}'`;
  let bundle = "";
  for (const src of scripts) bundle += (await (await fetch(`${base}${src}`)).text()).replaceAll(escapedQuote, "'");
  check("3d: the rules page's lead sentence is in the bundle Caddy serves", bundle.includes(RULES_LEAD));
  check("3d: the transparency page's lead sentence is in the bundle Caddy serves", bundle.includes(TRANSPARENCY_LEAD));
}

/**
 * Step 20 (UI Task 3): the app's page, theme-boot.js, the first font the entry bundle names and a post's page, each with
 * its status and caching. `postId` is a public post's.
 */
async function appShell(postId) {
  const page = await send("/");
  check("UI: / answers the app's page with no-cache", page.status === 200 && page.headers.get("cache-control") === "no-cache", `HTTP ${page.status}, ${page.headers.get("cache-control")}`);
  const boot = await send("/theme-boot.js");
  check("UI: /theme-boot.js answers 200 with no-cache, like the page", boot.status === 200 && boot.headers.get("cache-control") === "no-cache", `HTTP ${boot.status}, ${boot.headers.get("cache-control")}`);
  const entry = /<script[^>]* src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(page.bytes.toString("utf8"))?.[1];
  if (!check("UI: the page names its entry bundle", entry !== undefined)) return;
  const bundle = (await send(entry)).bytes.toString("utf8");
  // On web Metro's require of a font yields its hashed address as a string, which the bundle carries (Task 1).
  const font = /\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2/.exec(bundle)?.[0];
  const file = font === undefined ? null : await send(font);
  check(
    "UI: the first font the bundle names answers 200, public, max-age=31536000, immutable",
    file?.status === 200 && file.headers.get("cache-control") === "public, max-age=31536000, immutable",
    font === undefined ? "no font in the bundle" : `${font}: HTTP ${file?.status}, ${file?.headers.get("cache-control")}`,
  );
  const shown = await postPage(postId);
  const missing = await postPage(randomUUID());
  check("UI: a public post's page answers 200 and a missing post's 404", shown.status === 200 && missing.status === 404, `HTTP ${shown.status}, ${missing.status}`);
}

async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/** A notice's public reference: N- and ten base32 characters. */
const NOTICE_REF = /^N-[A-Z2-7]{10}$/;

/** One line about a report's items as a status answer or a list gives them: how many, and each one's link and outcome. */
const itemsSummary = (items) => (Array.isArray(items) ? `${items.length} item(s): ${items.map((item) => `${item?.link} -> ${item?.outcome}`).join(", ")}` : "no items");
/** Whether these are exactly one item, about this post by its korbat link, with no outcome shown yet. */
const onePostUndecided = (items, postId) => Array.isArray(items) && items.length === 1 && typeof items[0]?.link === "string" && items[0].link.endsWith(`/post/${postId}`) && items[0].outcome === null;

/**
 * A report under a rule from a signed-in account (3c design, sections 7.1, 7.6 and 12), about another account's post:
 * it needs no human check and answers a reference without a token, since the account's own list follows it. That list
 * then shows the report with its one item undecided, and the account's list of decisions is empty. Answers the
 * reference, or null when the report was not taken.
 */
async function signedInReport(postId, token) {
  const reported = await api("/api/notices", { json: { ground: "rule", ruleId: "R6", targets: [{ kind: "post", id: postId }], explanation: "Sent by the smoke test." }, token });
  const ref = reported.body?.ref;
  if (!check("a signed-in report under a rule is taken: a reference and no token", reported.status === 201 && NOTICE_REF.test(ref ?? "") && reported.body.token === undefined, reported.summary)) return null;
  const reports = await api("/api/moderation/reports", { token });
  const mine = reports.body?.reports?.[0];
  check("the account's list of reports shows it, undecided", reports.status === 200 && mine?.ref === ref && onePostUndecided(mine.items, postId), `${reports.summary}, ${itemsSummary(mine?.items)}`);
  const cases = await api("/api/moderation/cases", { token });
  check("no decision is about the account", cases.status === 200 && Array.isArray(cases.body?.decisions) && cases.body.decisions.length === 0 && cases.body.nextCursor === null, cases.summary);
  return ref;
}

/**
 * The export's moderation member (3c design, section 7.11), read from the archive itself: export.json's member before
 * the last, with no decision about this account and the one report it sent, under its reference and its ground, its item
 * undecided. Since 3b Task 6 the last member is `imports` (3b design, section 11.2), empty for this account, which
 * imported nothing.
 */
function exportedModeration(archive, reportRef, postId) {
  let document = null;
  try {
    document = JSON.parse(strFromU8(unzipSync(new Uint8Array(archive))["export.json"]));
  } catch {
    document = null;
  }
  const moderation = document?.moderation;
  const last = document === null ? "export.json could not be read" : `last members ${Object.keys(document).slice(-3).join(", ")}`;
  // 2d (11.2): the account's Activity comes last, after 3b's imports.
  const ends = document !== null && isDeepStrictEqual(Object.keys(document).slice(-3), ["moderation", "imports", "activity"]) && isDeepStrictEqual(document.imports, []);
  if (!check("export.json ends with the moderation member, its decisions and its reports, then the account's imports, none, then its Activity", ends && Array.isArray(moderation?.decisions) && Array.isArray(moderation?.reports), last)) return;
  const own = moderation.reports[0];
  check(
    "the export holds no decision and the account's one report, undecided",
    reportRef !== null && moderation.decisions.length === 0 && moderation.reports.length === 1 && own?.ref === reportRef && own.ground === "rule" && own.ruleId === "R6" && onePostUndecided(own.items, postId) && own.items[0].reexaminationOpen === null,
    `${moderation.decisions.length} decision(s), ${moderation.reports.length} report(s), ${itemsSummary(own?.items)}`,
  );
}

/** The newest message to `to` in Mailpit whose subject is `subject`, read whole; null when none arrives within half a minute. */
async function mailTo(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const found = list.messages?.find((message) => message.Subject === subject);
    if (found) return (await fetch(`${mailpit}/api/v1/message/${found.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * A notice sent signed out, through the app's site (3c design, sections 7.1, 7.2 and 12): an Article 16 notice that the
 * first account's post is illegal, in a category of the lane that is read last, so that no urgent alert goes out, with a
 * name and an address. The human check is Turnstile's, with the test secret that passes any token. It answers a
 * reference and the notice's own token, which opens the status page; the receipt goes to the address at once, and the
 * token in its link opens the same page and shows what korbat knows of the address. A token travels in a POST's body,
 * never in an address.
 */
async function signedOutNotice(postId) {
  const notifier = `notifier-${randomUUID()}@korbat.local`;
  const notice = {
    ground: "illegal",
    category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    explanation: "Sent by the smoke test: nothing is wrong with this post.",
    bonaFide: true,
    name: "Smoke Test",
    email: notifier,
    targets: [{ kind: "post", id: postId }],
    turnstileToken: TURNSTILE_TOKEN,
  };
  const sent = await withTurnstile("/api/notices", notice);
  const ref = sent.body?.ref;
  const token = sent.body?.token;
  if (!check("signed out, a notice of illegality is taken through the app's site: a reference and a token", sent.status === 201 && NOTICE_REF.test(ref ?? "") && typeof token === "string" && token.length === 43, sent.summary)) return;

  const status = await api("/api/notices/status", { json: { ref, token } });
  check("its status page opens with the token and shows the post's link, undecided", status.status === 200 && status.body?.ref === ref && onePostUndecided(status.body.items, postId), `${status.summary}, ${itemsSummary(status.body?.items)}`);
  // Opened with the notice's own token, the page says that a contact was given and nothing of what korbat knows about the address.
  const contact = status.body?.contact;
  check("the page says that a contact was given, and no more", contact?.given === true && contact.confirmed === null && contact.stopped === null, JSON.stringify(contact ?? null));
  const other = await api("/api/notices/status", { json: { ref, token: randomBytes(32).toString("base64url") } });
  check("another token finds no notice", other.status === 404 && other.body?.error?.code === "notice_not_found", other.summary);

  const receipt = await mailTo(notifier, `korbat received your report ${ref}`);
  if (!check("the receipt arrives in Mailpit under the notice's reference", receipt !== null && typeof receipt.Text === "string" && receipt.Text.includes(ref), receipt === null ? "no receipt within 30 s" : "a receipt without the reference")) return;
  // The mail's link carries the contact's mail token in its fragment, which no server log sees.
  const mailToken = /[/]notice[/]N-[A-Z2-7]{10}#t=([A-Za-z0-9_-]{43})/.exec(receipt.Text)?.[1];
  if (!check("the receipt links to the notice's page with a token of its own", typeof mailToken === "string" && mailToken !== token)) return;
  const byMail = await api("/api/notices/status", { json: { ref, token: mailToken } });
  const known = byMail.body?.contact;
  check(
    "the mail's token opens the same page, with the address not yet confirmed and not stopped",
    byMail.status === 200 && byMail.body?.ref === ref && onePostUndecided(byMail.body.items, postId) && known?.given === true && known.confirmed === false && known.stopped === false,
    `${byMail.summary}, ${JSON.stringify(known ?? null)}`,
  );
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session. On its
 * way it reports the first account's post, and its export shows that report.
 */
async function accountLifecycle(reportedPostId) {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const reportRef = await signedInReport(reportedPostId, token);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  if (zip) exportedModeration(exported.bytes, reportRef, reportedPostId);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

/** 3b (design, section 7.3): IMPORT_RULES.chunkBytes, the size of every chunk but an archive's last. */
const IMPORT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Step 21's archive: what the Mastodon adapter reads (outbox.json, and the name of actor.json) and a file of 9 MiB it
 * never opens, so the upload takes two chunks. Four public Notes, one followers-only Note and one boost; the newest three
 * public ones are the samples. Nothing of it is a real person's: every name is the script's own.
 */
function mastodonArchive() {
  const actor = "https://smoke.korbat.test/users/smoke";
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
  const note = (n, to, published) => ({
    type: "Create",
    object: { type: "Note", id: `${actor}/statuses/${n}`, attributedTo: actor, published, to, cc: [], content: `<p>Smoke test post ${n}</p>` },
  });
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    orderedItems: [
      note(1, [PUBLIC], "2019-03-01T10:00:00Z"),
      note(2, [PUBLIC], "2019-03-02T10:00:00Z"),
      note(3, [`${actor}/followers`], "2019-03-03T10:00:00Z"),
      note(4, [PUBLIC], "2019-04-04T10:00:00Z"),
      { type: "Announce", object: `${actor}/statuses/1` },
      note(5, [PUBLIC], "2019-05-05T10:00:00Z"),
    ],
  };
  return zipSync(
    {
      "outbox.json": strToU8(JSON.stringify(outbox)),
      "actor.json": strToU8(JSON.stringify({ type: "Person", id: actor })),
      // Random bytes do not compress: stored, they make the archive larger than one chunk.
      "filler.bin": [new Uint8Array(randomBytes(9 * 1024 * 1024)), { level: 0 }],
    },
    { level: 6 },
  );
}

/** The importer's container: its memory limit, its restarts and its health. */
function importerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "importer"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.Health.Status}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), health: fields[2] };
}

/**
 * Reads an import every second while its state is one of `moving`, for at most two minutes, the scan's bound: import-drive
 * runs a round every five seconds, and the smoke archive's four posts are one batch. Answers the last view read.
 */
async function waitImport(id, token, moving) {
  let view = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    view = (await api(`/api/imports/${id}`, { token })).body;
    if (!moving.includes(view?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return view;
}

/** The posts of a profile's Imported tab, as [text, label] in the tab's order; null when the tab does not answer a page. */
async function importedTab(handle) {
  const tab = await api(`/api/profiles/${handle}/imported`);
  return Array.isArray(tab.body?.items) ? tab.body.items.map((post) => [post.body, post.imported]) : null;
}

/**
 * Step 21 (3b Tasks 4 and 8): an archive uploaded in chunks through Caddy and scanned by the real importer; the import
 * confirmed and published on the profile's Imported tab, then removed again with the person's own undo.
 */
async function importArchive(token) {
  const aged = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "update public.profiles set created_at = now() - interval '8 days' where handle = '${handle}' returning 1"`);
  if (!check("3b: the account is aged past the import's seven days", aged.split(String.fromCharCode(10))[0] === "1", aged)) return;
  const archive = mastodonArchive();
  const created = await api("/api/imports", { json: { source: "mastodon", bytes: archive.length }, token });
  if (!check("3b: an import is created, uploading", created.status === 201 && created.body?.status === "uploading" && created.body?.chunkBytes === IMPORT_CHUNK_BYTES, created.summary)) return;
  const id = created.body.id;
  let received = 0;
  for (let at = 0; at < archive.length; at += IMPORT_CHUNK_BYTES) {
    const chunk = archive.subarray(at, Math.min(archive.length, at + IMPORT_CHUNK_BYTES));
    const res = await fetch(`${base}/api/imports/${id}/archive`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "import-offset": String(at), "import-chunk-sha256": createHash("sha256").update(chunk).digest("hex") },
      body: chunk,
    });
    const answer = await res.json().catch(() => null);
    if (!check(`3b: a chunk of ${chunk.length} bytes at ${at} is taken through Caddy`, res.status === 200 && answer?.receivedBytes === at + chunk.length, `HTTP ${res.status}${answer?.error?.code ? ` ${answer.error.code}` : ""}`)) return;
    received = answer.receivedBytes;
  }
  check("3b: the whole archive arrived, in more than one chunk", received === archive.length && archive.length > IMPORT_CHUNK_BYTES, `${received} of ${archive.length} bytes`);
  const view = await waitImport(id, token, ["uploading", "scanning"]);
  if (!check("3b: the importer's scan is read and the import is ready", view?.status === "ready", `${view?.status ?? "no answer"}${view?.failure ? ` ${view.failure}` : ""}`)) return;
  const scan = view.scan;
  check(
    "3b: its counts: four posts from March to May 2019, the followers-only post and the boost skipped",
    scan?.posts === 4 && scan.skipped?.not_public === 1 && scan.skipped?.repost === 1 && scan.first === "2019-03" && scan.last === "2019-05",
    JSON.stringify(scan),
  );
  check(
    "3b: its three samples, newest first, by day",
    isDeepStrictEqual(view.samples, [
      { at: "2019-05-05", text: "Smoke test post 5" },
      { at: "2019-04-04", text: "Smoke test post 4" },
      { at: "2019-03-02", text: "Smoke test post 2" },
    ]),
    JSON.stringify(view.samples),
  );
  check("3b: the archive was deleted once its scan was read", inside("api", `test -e /import/archives/jobs/${id} && echo present || echo gone`) === "gone");
  const importer = importerState();
  check("3b: the importer is healthy and has never restarted", importer.health === "healthy" && importer.restarts === 0, `${importer.health}, restarts ${importer.restarts}`);
  const interfaces = inside("importer", "ls -x /sys/class/net");
  check("3b: the importer has only a loopback interface", interfaces === "lo", interfaces);
  check("3b: the importer's memory limit is 512 MiB", importer.memory === 512 * 1024 * 1024, `${importer.memory} bytes`);

  // Task 8: the rest of the import. The profile's post count before it, which the four posts raise and the undo lowers again.
  const before = (await api(`/api/profiles/${handle}`)).body;
  check("3b: before the import the profile shows no Imported tab", before?.hasImported === false, JSON.stringify(before?.hasImported));
  // Every choice off or open, long posts left out (none is long), and the statement, without which nothing is confirmed.
  // Images are off in the stack (IMPORT_IMAGES needs a matcher), so the confirmation goes straight to publishing.
  const choice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };
  const confirmed = await api(`/api/imports/${id}/confirm`, { json: { choice, statement: true }, token });
  if (!check("3b: the import is confirmed with the statement and publishes", confirmed.status === 200 && ["publishing", "done"].includes(confirmed.body?.status), `${confirmed.summary} ${confirmed.body?.status ?? ""}`)) return;
  const done = await waitImport(id, token, ["publishing"]);
  if (!check("3b: import-drive publishes the four posts and the import is done", done?.status === "done" && done.progress?.postsPublished === 4, `${done?.status ?? "no answer"}, ${done?.progress?.postsPublished ?? "?"} published`)) return;
  const label = (at) => ({ source: "mastodon", at, shortened: false });
  const published = [
    ["Smoke test post 5", label("2019-05-05")],
    ["Smoke test post 4", label("2019-04-04")],
    ["Smoke test post 2", label("2019-03-02")],
    ["Smoke test post 1", label("2019-03-01")],
  ];
  const tab = await importedTab(handle);
  check("3b: the Imported tab holds the four posts, newest first by the archive's day, each imported from Mastodon on its day", isDeepStrictEqual(tab, published), JSON.stringify(tab));
  const shown = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile shows its Imported tab and counts four more posts", shown?.hasImported === true && shown.counts?.posts === before?.counts?.posts + 4, `hasImported ${shown?.hasImported}, ${before?.counts?.posts} then ${shown?.counts?.posts} posts`);
  const latest = await api("/api/timeline/latest");
  const leaked = Array.isArray(latest.body?.items) ? latest.body.items.filter((item) => item.post?.imported != null || published.some(([text]) => item.post?.body === text)).length : -1;
  check("3b: Latest holds none of the imported posts", leaked === 0, `${latest.summary}, ${leaked} imported`);

  const undo = await api(`/api/imports/${id}/undo`, { method: "POST", token });
  if (!check("3b: Remove imported posts is taken", undo.status === 200 && ["undoing", "undone"].includes(undo.body?.status), `${undo.summary} ${undo.body?.status ?? ""}`)) return;
  const undone = await waitImport(id, token, ["undoing"]);
  check("3b: import-drive removes the four posts and the import is undone", undone?.status === "undone" && undone.progress?.postsRemoved === 4, `${undone?.status ?? "no answer"}, ${undone?.progress?.postsRemoved ?? "?"} removed`);
  const emptied = await importedTab(handle);
  check("3b: the Imported tab is empty again", Array.isArray(emptied) && emptied.length === 0, JSON.stringify(emptied));
  const after = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile no longer shows the tab and counts its posts as before", after?.hasImported === false && after.counts?.posts === before?.counts?.posts, `hasImported ${after?.hasImported}, ${after?.counts?.posts} posts`);
}

async function main() {
  if (closed) return closedSite();
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  if (pushBase) await pushSite();
  await explore();
  await publicPages();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);
  // Account sanctions (3e design, section 12.2): an onboarded account's standing, read fresh, holds no strike, no
  // measure, no restriction of reporting and no retired handle. A suspension needs a staff key: the walk-through's.
  const noStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
  check("/api/me carries the new account's standing: no strike, no measure, no restriction", isDeepStrictEqual(me.body?.standing, noStanding), JSON.stringify(me.body?.standing));

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);
  await appShell(created.body?.id);

  await images(token);
  // 2d Task 3 (step 22): the account's picture, on its post made above.
  await avatar(token, created.body?.id);
  // 2d Task 6 (step 23): the post's and the profile's share cards, previews off and on, before the token dies at grant-role.
  await cards(token, created.body?.id);
  if (worstCase) await worstCaseImages(token);
  await importArchive(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  // The post both the signed-in report and the signed-out notice name: the first account's, which is still there.
  const reportedPostId = created.body?.id;
  if (!check("the first account's post can be reported", typeof reportedPostId === "string")) return;
  await accountLifecycle(reportedPostId);
  await signedOutNotice(reportedPostId);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
// With --closed the run is a few requests long, and Node on Windows aborts (a libuv assertion, exit 127) when the process
// is ended while fetch's idle connections are still closing. So that run sets its code and ends when they have closed,
// a few seconds later; the full run, which holds other handles open, ends here as before.
if (closed) process.exitCode = failures === 0 ? 0 : 1;
else process.exit(failures === 0 ? 0 : 1);
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
pnpm -r --if-present run test --testTimeout=60000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  131 passed (131)
packages/contracts test:       Tests  537 passed (537)
packages/media-protocol test:       Tests  28 passed (28)
packages/rules test:       Tests  138 passed (138)
packages/import-protocol test:       Tests  35 passed | 2 skipped (37)
apps/admin test:       Tests  614 passed (614)
apps/worker test:       Tests  64 passed (64)
apps/app test:       Tests  764 passed (764)
apps/importer test:       Tests  143 passed (143)
apps/api test:       Tests  1019 passed | 1967 skipped (2986)
```

## Step 6: verify: admin-build

```bash
pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'
```

Expected output contains:

- `Build success`
- `index.html`
- `main-HASH.js`
- `main-HASH.css`

Observed on the dry run:

```text
Build success
index.html
main-HASH.js
main-HASH.css
```

## Step 7: verify: admin-browser

```bash
pnpm --filter @korbat/admin test:browser
```

Expected output contains:

- `Tests  79 passed (79)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  79 passed (79)
```

## Step 8: verify: export

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

## Step 9: verify: app-browser

```bash
pnpm --filter @korbat/app test:browser
```

Expected output contains:

- `Tests  57 passed (57)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  57 passed (57)
```

## Step 10: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 11: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1961 passed | 4 skipped (1965)
```

## Step 12: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 48 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0048_import_staff_end applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0048_import_staff_end applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 13: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1961 passed | 4 skipped (1965)
```

## Step 14: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 15: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 16: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 17: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 18: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 19: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 20: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 21: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker importer cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 22: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/admin/test/console-site.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/cards/build.ts`
- `apps/api/src/cards/index.ts`
- `apps/api/src/cards/words.ts`
- `apps/api/src/index.ts`
- `apps/api/src/middleware/security-headers.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/test/architecture.test.ts`
- `apps/api/test/cards.test.ts`
- `apps/api/test/integration/http-cards.test.ts`
- `apps/api/test/middleware.test.ts`
- `apps/api/test/transparency/route-table.test.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/test/browser/app.browser.ts`
- `apps/app/test/browser/caddyfile.ts`
- `apps/app/test/browser/fixture-api.ts`
- `apps/app/test/browser/server.ts`
- `apps/app/test/terms.test.tsx`
- `infra/caddy/Caddyfile`
- `infra/caddy/Dockerfile`
- `infra/caddy/lab/README.md`
- `infra/caddy/lab/card-lab.mjs`
- `infra/caddy/lab/crawlers.json`
- `infra/caddy/robots.txt`
- `scripts/smoke-auth-stack.mjs`

## Step 23: commit

```bash
git add -A
git commit -q -m "feat(api,app,admin,infra,scripts): share cards, indexing and the terms: the cards module answers GET /api/cards/post/:id and /api/cards/profile/:handle beside the status route, after the global limit and before the session, 204 with the head block in Korbat-Card or 404 with no body, from the signed-out reads and the owner's link-preview switch (the social module's forCards and sharePreviewsOf); cardBlock writes 8.3's tags in order, every value escaped with the template delimiters as character references, a generic card while previews are off, the image's description cut last to keep 4,096 bytes; X-Robots-Tag noindex on every API answer; Caddy's /post/* and new /u/* ask the card route without Range and serve card.html through templates for 204, the plain shell with 404 or 200 otherwise, noindex on every page that can name an account, /card.html 404; the image writes card.html and copies robots.txt; the card lab and crawlers.json; the Caddyfile's readers learn /u/*; the terms' four drafts by ACTIVITY_KEEP_DAYS; smoke step 23" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,app,admin,infra,scripts): share cards, indexing and the terms: the cards module answers GET /api/cards/post/:id and /api/cards/profile/:handle beside the status route, after the global limit and before the session, 204 with the head block in Korbat-Card or 404 with no body, from the signed-out reads and the owner's link-preview switch (the social module's forCards and sharePreviewsOf); cardBlock writes 8.3's tags in order, every value escaped with the template delimiters as character references, a generic card while previews are off, the image's description cut last to keep 4,096 bytes; X-Robots-Tag noindex on every API answer; Caddy's /post/* and new /u/* ask the card route without Range and serve card.html through templates for 204, the plain shell with 404 or 200 otherwise, noindex on every page that can name an account, /card.html 404; the image writes card.html and copies robots.txt; the card lab and crawlers.json; the Caddyfile's readers learn /u/*; the terms' four drafts by ACTIVITY_KEEP_DAYS; smoke step 23`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 27>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-build": <paste the expected lines as printed>
Verify "admin-browser": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "app-browser": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
