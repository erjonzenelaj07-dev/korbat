/**
 * 5.3 step 1 (Mastodon): HTML to text with a tokenizer of korbat's own, never a DOM and never rendering. <p> and </p>
 * become paragraph breaks, <br> a line break, an <a> its text (joined back into its href when the text is a shortened
 * form of it, as Mastodon shortens long links with invisible spans), every other tag is dropped with its attributes,
 * and the five named entities and numeric entities are decoded. A quote's fallback (class quote-inline, "RE: <link>")
 * is dropped whole, and for a reply (step 4) the run of mention links at its very start is removed, so the reply keeps
 * no handle of the person it answered. Mentions inside the text stay as typed.
 */

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ELLIPSIS = String.fromCharCode(0x2026);
const PARAGRAPH = LF + LF;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6}));/g;
const BLANK = new RegExp(`^[ ${TAB}${LF}${CR}]*$`);

/** The five named entities and numeric ones; a numeric entity that is no character (0, a surrogate, past U+10FFFF) is removed. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_, name: string | undefined, decimal: string | undefined, hex: string | undefined) => {
    if (name !== undefined) return NAMED[name]!;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

const isSpace = (c: string) => c === " " || c === TAB || c === LF || c === CR || c === String.fromCharCode(12);

interface Tag {
  name: string;
  closing: boolean;
  attributes: Map<string, string>;
}

/** Reads one tag from `html` at `at` (just past its "<"); returns it and where it ends, or null when it never closes. */
function readTag(html: string, at: number): { tag: Tag; end: number } | null {
  let i = at;
  const closing = html[i] === "/";
  if (closing) i++;
  let name = "";
  while (i < html.length && /[A-Za-z0-9-]/.test(html[i]!)) name += html[i++];
  const attributes = new Map<string, string>();
  while (i < html.length && html[i] !== ">") {
    if (isSpace(html[i]!) || html[i] === "/") {
      i++;
      continue;
    }
    let key = "";
    while (i < html.length && !isSpace(html[i]!) && html[i] !== "=" && html[i] !== ">" && html[i] !== "/") key += html[i++];
    while (i < html.length && isSpace(html[i]!)) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && isSpace(html[i]!)) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        while (i < html.length && !isSpace(html[i]!) && html[i] !== ">") value += html[i++];
      }
    }
    if (key !== "") attributes.set(key.toLowerCase(), decodeEntities(value));
  }
  if (i >= html.length) return null;
  return { tag: { name: name.toLowerCase(), closing, attributes }, end: i + 1 };
}

/** A link's text, or its href when the text is a shortened form of it (the start of it, perhaps with an ellipsis). */
function linkText(text: string, href: string | undefined): string {
  if (href === undefined || !/^https?:[/][/]/i.test(href)) return text;
  let shown = text.trim();
  if (shown.endsWith(ELLIPSIS)) shown = shown.slice(0, -1);
  else if (shown.endsWith("...")) shown = shown.slice(0, -3);
  if (shown === "") return text;
  const bare = href.replace(/^https?:[/][/]/i, "");
  const forms = [href, bare, bare.replace(/^www[.]/i, "")];
  return forms.some((form) => form.startsWith(shown)) ? href : text;
}

const classes = (tag: Tag) => (tag.attributes.get("class") ?? "").split(" ").filter((c) => c !== "");

export interface HtmlOptions {
  /** The item answers another post (inReplyTo): its leading run of mention links is removed. */
  reply?: boolean;
}

export function htmlToText(html: string, options: HtmlOptions = {}): string {
  let out = "";
  let leading = options.reply === true;
  let link: { href: string | undefined; text: string; drop: boolean } | null = null;
  let skip: { tag: string; depth: number } | null = null;

  const emit = (text: string) => {
    if (text === "" || skip) return;
    if (link) {
      link.text += text;
      return;
    }
    if (leading) {
      // Before anything visible, white space between dropped mentions is dropped with them.
      if (BLANK.test(text)) return;
      leading = false;
    }
    out += text;
  };
  const breakLine = (text: string) => {
    if (skip) return;
    if (link) link.text += text;
    else if (out !== "") out += text;
  };

  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    const textEnd = open < 0 ? html.length : open;
    if (textEnd > i) {
      // Text between tags: its own line breaks and tabs are only white space, as a browser would show them.
      let text = decodeEntities(html.slice(i, textEnd));
      for (const c of [CR, LF, TAB]) text = text.replaceAll(c, " ");
      emit(text);
    }
    if (open < 0) break;
    const next = html[open + 1];
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const close = html.indexOf(">", open);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z/]/.test(next)) {
      emit("<");
      i = open + 1;
      continue;
    }
    const read = readTag(html, open + 1);
    if (!read) break;
    i = read.end;
    const { tag } = read;
    if (skip) {
      if (tag.name === skip.tag) skip.depth += tag.closing ? -1 : 1;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (!tag.closing && classes(tag).includes("quote-inline")) {
      skip = { tag: tag.name, depth: 1 };
      continue;
    }
    switch (tag.name) {
      case "p":
        breakLine(PARAGRAPH);
        break;
      case "br":
        breakLine(LF);
        break;
      case "a":
        if (!tag.closing && !link) {
          const kinds = classes(tag);
          link = { href: tag.attributes.get("href"), text: "", drop: leading && kinds.includes("mention") && kinds.includes("u-url") };
        } else if (tag.closing && link) {
          const finished = link;
          link = null;
          if (!finished.drop) emit(linkText(finished.text, finished.href));
        }
        break;
      default:
        break;
    }
  }
  if (link && !link.drop) {
    const finished = link;
    link = null;
    emit(finished.text);
  }
  return out;
}
