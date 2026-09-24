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
