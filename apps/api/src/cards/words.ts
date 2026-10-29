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
