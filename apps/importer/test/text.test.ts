import { describe, expect, test } from "vitest";
import { AltText, FORBIDDEN_FORMAT } from "@korbat/contracts";
import { htmlToText } from "../src/html";
import {
  CONTENT_WARNING_LABEL,
  SOURCE_WORDS,
  cleanDescription,
  expandTco,
  finishText,
  removeLeadingMentions,
  replaceSourceLinks,
  unescapeX,
} from "../src/text";

/** 5.3, step by step. Every character outside printable ASCII is built in code, never typed. */

const ch = (...codes: number[]) => String.fromCodePoint(...codes);
const LF = ch(10);
const ELLIPSIS = ch(0x2026);
const RLO = ch(0x202e);
const LRI = ch(0x2066);
const ZWSP = ch(0x200b);
const WORD_JOINER = ch(0x2060);
const BOM = ch(0xfeff);
const ZWJ = ch(0x200d);
const RLM = ch(0x200f);
const LRM = ch(0x200e);
const HEBREW = ch(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const ARABIC = ch(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);

describe("step 1: HTML to text (Mastodon)", () => {
  test("paragraphs become paragraph breaks and <br> a line break", () => {
    expect(finishText(htmlToText("<p>One</p><p>Two<br>three<br />four</p>")).text).toBe(`One${LF}${LF}Two${LF}three${LF}four`);
  });

  test("the five named entities and numeric entities are decoded; other entities and broken ones stay or go", () => {
    expect(htmlToText("<p>&amp; &lt;b&gt; &quot;q&quot; &apos;a&apos; &#39;n&#39; &#x2014; &#8212;</p>").trim()).toBe(`& <b> "q" 'a' 'n' ${ch(0x2014)} ${ch(0x2014)}`);
    expect(htmlToText("<p>&nbsp;kept &#0; &#xD800; &#x110000; gone</p>").trim()).toBe("&nbsp;kept    gone");
  });

  test("every other tag is dropped with its attributes, comments too; the text never renders", () => {
    expect(htmlToText('<p><strong class="x">bold</strong> <em onclick="alert(1)">it</em><!-- hidden --> <img src="a.png" alt="pic"> <script>text</script></p>').trim()).toBe("bold it  text");
  });

  test("a link's shortened text is joined back into its href; other link text stays as it is", () => {
    const href = "https://example.com/a/very/long/path/that/is/shortened";
    const link = `<a href="${href}" rel="nofollow"><span class="invisible">https://</span><span class="ellipsis">example.com/a/very/lo</span><span class="invisible">ng/path/that/is/shortened</span></a>`;
    expect(htmlToText(`<p>Read ${link} now</p>`).trim()).toBe(`Read ${href} now`);
    expect(htmlToText(`<p><a href="${href}">example.com/a/very${ELLIPSIS}</a></p>`).trim()).toBe(href);
    expect(htmlToText('<p><a href="https://evil.example/x">https://example.com/</a></p>').trim()).toBe("https://example.com/");
    expect(htmlToText('<p><a href="https://social.example/tags/tag" class="mention hashtag" rel="tag">#<span>tag</span></a></p>').trim()).toBe("#tag");
  });

  test("a quote's fallback paragraph (quote-inline) is dropped whole", () => {
    expect(htmlToText('<p class="quote-inline">RE: <a href="https://o.example/@b/1">https://o.example/@b/1</a></p><p>Mine</p>').trim()).toBe("Mine");
    expect(htmlToText('<p>Before<span class="quote-inline"><br>RE: <span>nested <span>deep</span></span></span> after</p>').trim()).toBe("Before after");
  });

  test("step 4 (Mastodon): a reply's leading run of mention links is removed; mentions inside the text stay", () => {
    const mention = (name: string) => `<span class="h-card" translate="no"><a href="https://o.example/@${name}" class="u-url mention">@<span>${name}</span></a></span>`;
    const html = `<p>${mention("bob")} ${mention("carol")} Thanks ${mention("dave")}!</p>`;
    expect(finishText(htmlToText(html, { reply: true })).text).toBe("Thanks @dave!");
    expect(finishText(htmlToText(html, { reply: false })).text).toBe("@bob @carol Thanks @dave!");
  });
});

describe("step 2: unescape (X)", () => {
  test("&amp;, &lt; and &gt; in full_text, &amp; last", () => {
    expect(unescapeX("a &amp; b &lt;c&gt; &amp;lt;")).toBe("a & b <c> &lt;");
  });
});

describe("step 3: links (X)", () => {
  test("a t.co link becomes its expanded_url, a media link and a t.co link with no entity go", () => {
    const text = "See https://t.co/abc123 and https://t.co/med456 and https://t.co/zzz999";
    expect(expandTco(text, [{ url: "https://t.co/abc123", expanded: "https://example.com/page" }], ["https://t.co/med456"])).toBe("See https://example.com/page and and");
  });
});

describe("step 3b: links to the source platform", () => {
  test("X: a status link becomes the post's words, any other link on twitter.com, x.com or a subdomain the profile's", () => {
    const { text, count } = replaceSourceLinks(
      "q https://twitter.com/someone/status/123?s=20 p https://x.com/someone. m https://mobile.twitter.com/a/status/9 o https://box.com/a and https://x.com.evil.example/a/status/1",
      "x",
    );
    expect(text).toBe(`q ${SOURCE_WORDS.x.post} p ${SOURCE_WORDS.x.profile}. m ${SOURCE_WORDS.x.post} o https://box.com/a and https://x.com.evil.example/a/status/1`);
    expect(count).toBe(3);
    expect(SOURCE_WORDS.x).toEqual({ post: "(a post on X)", profile: "(a profile on X)" });
  });

  test("Mastodon: only links on the Note's own host, as a post (/@name/id, /users/name/statuses/id) or a profile", () => {
    const { text, count } = replaceSourceLinks(
      "a https://social.example/@me/109 b https://social.example/users/me/statuses/110 c https://social.example/@me d https://other.example/@me/1",
      "mastodon",
      "social.example",
    );
    expect(text).toBe(`a ${SOURCE_WORDS.mastodon.post} b ${SOURCE_WORDS.mastodon.post} c ${SOURCE_WORDS.mastodon.profile} d https://other.example/@me/1`);
    expect(count).toBe(3);
    expect(SOURCE_WORDS.mastodon).toEqual({ post: "(a post on Mastodon)", profile: "(a profile on Mastodon)" });
  });

  test("Bluesky: bsky.app links, with or without a scheme, and at:// URIs", () => {
    const { text, count } = replaceSourceLinks(
      "p bsky.app/profile/me.bsky.social q https://bsky.app/profile/me.bsky.social/post/3kabc r at://did:plc:abc/app.bsky.feed.post/3kabc s at://did:plc:abc t notbsky.app/x",
      "bluesky",
    );
    expect(text).toBe(`p ${SOURCE_WORDS.bluesky.profile} q ${SOURCE_WORDS.bluesky.post} r ${SOURCE_WORDS.bluesky.post} s ${SOURCE_WORDS.bluesky.profile} t notbsky.app/x`);
    expect(count).toBe(4);
  });
});

describe("step 4: leading mentions (X)", () => {
  test("the @name run before display_text_range[0] is removed, and nothing else", () => {
    expect(removeLeadingMentions("@a @b_c Hello @d", 8)).toBe("Hello @d");
    expect(removeLeadingMentions("Hello @d", 0)).toBe("Hello @d");
    // A prefix that is not a run of mentions is kept whole.
    expect(removeLeadingMentions("Not a mention run", 4)).toBe("Not a mention run");
  });
});

describe("steps 5 and 6: cleaning and normalising", () => {
  test("controls but tab and line feed, and every forbidden format character, are removed and counted; joiners and direction marks stay", () => {
    const raw = `a${ch(0)}b${ch(7)}c${ch(9)}d${RLO}e${LRI}f${ZWSP}g${WORD_JOINER}h${BOM}i${ZWJ}j${RLM}k${LRM}l${ch(0x7f)}m${ch(0x85)}n`;
    const { text, removed } = finishText(raw);
    expect(text).toBe(`abc${ch(9)}defghi${ZWJ}j${RLM}k${LRM}lmn`);
    expect(removed).toBe(9);
    expect(FORBIDDEN_FORMAT.test(text)).toBe(false);
  });

  test("right-to-left text keeps its letters and marks, loses its overrides", () => {
    const { text, removed } = finishText(`${RLM}${HEBREW} ${RLO}${ARABIC}${ch(0x202c)} ok`);
    expect(text).toBe(`${RLM}${HEBREW} ${ARABIC} ok`);
    expect(removed).toBe(2);
  });

  test("NFC, CR LF and CR to LF (not counted), at most two line breaks in a row, trimmed", () => {
    const decomposed = "e" + ch(0x301);
    const { text, removed } = finishText(`  ${decomposed}${ch(13, 10)}x${ch(13)}y${LF}${LF}${LF}${LF}z  `);
    expect(text).toBe(`${ch(0xe9)}${LF}x${LF}y${LF}${LF}z`);
    expect(removed).toBe(0);
  });

  test("the content warning's words", () => {
    expect(CONTENT_WARNING_LABEL).toBe("Content warning: ");
  });
});

describe("descriptions", () => {
  test("cleaned and folded to meet AltText; over 1,000 code points or nothing visible becomes null, counted", () => {
    expect(cleanDescription(`  A  photo${LF}of${ch(9)}a${RLO} cat `)).toEqual({ alt: "A photo of a cat", cleaned: true });
    expect(cleanDescription("A plain description")).toEqual({ alt: "A plain description", cleaned: false });
    expect(cleanDescription("x".repeat(1_000))).toEqual({ alt: "x".repeat(1_000), cleaned: false });
    expect(cleanDescription("x".repeat(1_001))).toEqual({ alt: null, cleaned: true });
    expect(cleanDescription(`${ZWSP}${BOM}`)).toEqual({ alt: null, cleaned: true });
    expect(cleanDescription("")).toEqual({ alt: null, cleaned: false });
    expect(cleanDescription(null)).toEqual({ alt: null, cleaned: false });
    expect(cleanDescription(42)).toEqual({ alt: null, cleaned: false });
    const { alt } = cleanDescription(`${ch(0x1b)}[31m colour ${ch(0x1b)}`);
    expect(AltText.safeParse(alt).success).toBe(true);
  });
});
