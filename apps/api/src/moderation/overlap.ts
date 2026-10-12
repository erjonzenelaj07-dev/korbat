import type { StaffTextKind } from "@korbat/contracts";

/**
 * The overlap check on staff texts (3c design, section 7.4; C19), a pure function. A text that goes to the author with a
 * statement of reasons, or into the record with a reveal, must not carry what a reporter, a notifier or an appellant
 * wrote: their words can identify them. So such a text is refused when any run of OVERLAP_RUN characters of one of their
 * texts appears in it. Staff paraphrase, never quote. The check finds copies, not likenesses.
 */

/** How many characters in a row of someone else's text a staff text may not hold. */
export const OVERLAP_RUN = 32;

/** The kinds that stay with staff and are never sent to anyone: they may quote. */
const EXEMPT: ReadonlySet<StaffTextKind> = new Set<StaffTextKind>(["note", "seal_declined"]);

/** A text as the check compares it: lower-cased, every run of whitespace made one space, one entry for each character. */
const characters = (text: string): string[] => Array.from(text.toLowerCase().replace(/\s+/g, " "));

/** Whether `text` holds a run of OVERLAP_RUN characters of any of `theirs`, compared without case and with whitespace runs as one space. */
export function quotes(text: string, theirs: readonly string[]): boolean {
  const own = characters(text);
  if (own.length < OVERLAP_RUN) return false;
  // Every run of the staff text once, so each of their runs is one lookup.
  const runs = new Set<string>();
  for (let start = 0; start + OVERLAP_RUN <= own.length; start++) runs.add(own.slice(start, start + OVERLAP_RUN).join(""));
  for (const their of theirs) {
    const other = characters(their);
    for (let start = 0; start + OVERLAP_RUN <= other.length; start++) {
      if (runs.has(other.slice(start, start + OVERLAP_RUN).join(""))) return true;
    }
  }
  return false;
}

/**
 * Whether a text of this kind must be refused for quoting: every kind but a note and a recorded choice not to seal is
 * checked against the explanations, cited laws, re-examination statements and appeal statements of its case.
 */
export function quotesUser(kind: StaffTextKind, text: string, theirs: readonly string[]): boolean {
  return !EXEMPT.has(kind) && quotes(text, theirs);
}
