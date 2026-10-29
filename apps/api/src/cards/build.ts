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
