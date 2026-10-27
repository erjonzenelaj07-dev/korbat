/**
 * Bidirectional overrides and isolates, the zero-width space, the word joiner and the byte order mark:
 * invisible, and used to disguise text or hide from a search. Joiners that scripts and emoji need
 * (U+200C, U+200D) stay allowed.
 */
export const FORBIDDEN_FORMAT = /[\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF]/u;

/** The characters a reader can see: format characters (joiners, direction marks) do not count. */
export function visibleLength(text: string): number {
  return Array.from(text.replace(/\p{Cf}/gu, "")).length;
}

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. The rule of every post body, native or imported. */
export const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;
