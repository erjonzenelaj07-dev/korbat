import { AltText, FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizeAltText, normalizePostBody, type ImportSource } from "@korbat/contracts";

/**
 * Text conversion common to all sources (3b design, section 5.3), in its order: HTML to text is html.ts (step 1); here
 * X's unescaping (2), t.co links (3), links to the source platform (3b), X's leading mentions (4), cleaning (5) and
 * normalising (6), and the same cleaning for image descriptions. Step 7, the length, is the core's. No pattern in this
 * file is written with a backslash: characters outside printable ASCII are built with String.fromCharCode.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ELLIPSIS = String.fromCharCode(0x2026);
/** The white space a link ends at. */
const SPACE_CLASS = ` ${TAB}${LF}${CR}`;

/** The words that replace a link to the source platform (5.3 step 3b): its path holds someone's handle there. */
export const SOURCE_WORDS = {
  x: { post: "(a post on X)", profile: "(a profile on X)" },
  mastodon: { post: "(a post on Mastodon)", profile: "(a profile on Mastodon)" },
  bluesky: { post: "(a post on Bluesky)", profile: "(a profile on Bluesky)" },
} as const satisfies Record<ImportSource, { post: string; profile: string }>;

/** The first line of a Mastodon post with a content warning, before the warning's own words (decision 12). */
export const CONTENT_WARNING_LABEL = "Content warning: ";

/** Step 2 (X): full_text escapes these three, and only these; &amp; last, so "&amp;lt;" stays "&lt;". */
export function unescapeX(text: string): string {
  return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

const TCO = /( ?)(https?:[/][/]t[.]co[/][A-Za-z0-9]+)/gi;

/**
 * Step 3 (X): every t.co link becomes the expanded_url its entity gives, since t.co is a click tracker; a media link
 * and a t.co link with no entity are removed, with the one space before them.
 */
export function expandTco(text: string, urls: readonly { url: string; expanded: string }[], media: readonly string[]): string {
  const expanded = new Map(urls.map(({ url, expanded: to }) => [url, to]));
  return text.replace(TCO, (_, space: string, link: string) => {
    const to = media.includes(link) ? undefined : expanded.get(link);
    return to === undefined ? "" : space + to;
  });
}

const PUNCTUATION = `.,;:!?)]}'"`;

/** A link's own text and the punctuation the sentence put after it. */
function splitTrailing(link: string): [string, string] {
  let end = link.length;
  while (end > 0 && PUNCTUATION.includes(link[end - 1]!)) end--;
  return [link.slice(0, end), link.slice(end)];
}

const WEB_LINK = new RegExp(`https?://[^${SPACE_CLASS}<>"]+`, "gi");
const BSKY_LINK = new RegExp(`(?<![A-Za-z0-9.@/-])(?:https?://)?(?:[A-Za-z0-9-]+[.])*bsky[.]app(?:/[^${SPACE_CLASS}]*)?|at://[^${SPACE_CLASS}]+`, "gi");

function hostOf(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

const isXHost = (host: string) => host === "twitter.com" || host.endsWith(".twitter.com") || host === "x.com" || host.endsWith(".x.com");
const X_STATUS = /[/]status(es)?[/][0-9]/;
const MASTODON_STATUS = /^[/](@[^/]+[/][0-9]+|users[/][^/]+[/]statuses[/][0-9]+)/;
const BSKY_POST = /^[/]profile[/][^/]+[/]post[/]/;

/**
 * Step 3b: a link to the source platform becomes fixed words, a post's or a profile's (X: twitter.com, x.com and their
 * subdomains; Mastodon: the host of the Note's own attributedTo; Bluesky: bsky.app links, with or without a scheme, and
 * at:// URIs). Returns the text and how many links were replaced.
 */
export function replaceSourceLinks(text: string, source: ImportSource, host?: string): { text: string; count: number } {
  let count = 0;
  const words = SOURCE_WORDS[source];
  if (source === "bluesky") {
    const out = text.replace(BSKY_LINK, (match: string) => {
      const [link, after] = splitTrailing(match);
      count++;
      if (link.toLowerCase().startsWith("at://")) return (link.includes("/app.bsky.feed.post/") ? words.post : words.profile) + after;
      const url = hostOf(/^https?:/i.test(link) ? link : `https://${link}`);
      return (url && BSKY_POST.test(url.pathname) ? words.post : words.profile) + after;
    });
    return { text: out, count };
  }
  const own = host?.toLowerCase();
  const out = text.replace(WEB_LINK, (match: string) => {
    const [link, after] = splitTrailing(match);
    const url = hostOf(link);
    if (!url) return match;
    const name = url.hostname.toLowerCase();
    if (source === "x") {
      if (!isXHost(name)) return match;
      count++;
      return (X_STATUS.test(url.pathname) ? words.post : words.profile) + after;
    }
    if (own === undefined || name !== own) return match;
    count++;
    return (MASTODON_STATUS.test(url.pathname) ? words.post : words.profile) + after;
  });
  return { text: out, count };
}

const MENTION_RUN = /^( *@[A-Za-z0-9_]{1,50})+ *$/;

/** Step 4 (X): the automatic @name run before display_text_range[0], as X itself hides it; any other prefix stays. */
export function removeLeadingMentions(text: string, start: number): string {
  if (!Number.isInteger(start) || start <= 0) return text;
  const points = Array.from(text);
  if (start > points.length) return text;
  const prefix = points.slice(0, start).join("");
  return MENTION_RUN.test(prefix) ? points.slice(start).join("") : text;
}

const CONTROL_G = new RegExp(FORBIDDEN_CONTROL.source, "gu");
const FORMAT_G = new RegExp(FORBIDDEN_FORMAT.source, "gu");

/**
 * Step 5: every control character but tab and line feed, and every FORBIDDEN_FORMAT character (invisible direction and
 * spacing characters), is removed and counted. A carriage return is a line break first (CR LF and CR become LF, not
 * counted), as normalizePostBody would make it.
 */
export function cleanText(raw: string): { text: string; removed: number } {
  let removed = 0;
  const count = () => {
    removed++;
    return "";
  };
  const text = raw.replaceAll(CR + LF, LF).replaceAll(CR, LF).replace(CONTROL_G, count).replace(FORMAT_G, count);
  return { text, removed };
}

/** Steps 5 and 6 for a post's text: cleaned, then normalizePostBody (NFC, line breaks, at most two in a row, trimmed). */
export function finishText(raw: string): { text: string; removed: number } {
  const { text, removed } = cleanText(raw);
  return { text: normalizePostBody(text), removed };
}

/**
 * Steps 5 and 6 for an image's description: cleaned, folded as AltText folds it, and kept only if it then meets AltText
 * (at most 1,000 code points, a visible character); otherwise null. `cleaned` says a character was removed or a
 * description became null; a description that was never given is null and not cleaned.
 */
export function cleanDescription(raw: unknown): { alt: string | null; cleaned: boolean } {
  if (typeof raw !== "string" || raw === "") return { alt: null, cleaned: false };
  const { text, removed } = cleanText(raw);
  const parsed = AltText.safeParse(normalizeAltText(text));
  return parsed.success ? { alt: parsed.data, cleaned: removed > 0 } : { alt: null, cleaned: true };
}

/** A truncated tweet's visible text before its ellipsis, for matching its note (5.5), or null when it was not cut. */
export function beforeEllipsis(text: string): string | null {
  const at = text.lastIndexOf(ELLIPSIS);
  if (at < 0) return null;
  const head = text.slice(0, at).trimEnd();
  return head === "" ? null : head;
}
