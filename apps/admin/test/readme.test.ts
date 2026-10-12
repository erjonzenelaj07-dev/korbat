import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ERASURE_OVERDUE_RUNBOOK, RELEASE_OVERDUE_RUNBOOK } from "../src/screens/Home";

/**
 * The README's moderation runbook and the console's home screen say the same thing (3c design, section 13, Task 12).
 * When decided items wait for the daily release longer than it ever takes, or an erasure is more than a day late, the
 * home screen shows the count with the runbook's sentence for it, and each sentence is a constant of the screen. This
 * test reads README.md from the repository's root and holds the runbook to the same two constants, word for word, so
 * that what staff are told on the screen is what the operator reads in the runbook: whoever changes one changes both.
 */
const README = path.resolve(import.meta.dirname, "..", "..", "..", "README.md");

/** Markdown's code mark. The README sets a log line or a setting in code marks; the console shows the same words as plain text. */
const CODE_MARK = "`";

/** A text as its reader sees it: without the code marks. Nothing else is changed, so every word and every sign must agree. */
const withoutCodeMarks = (text: string): string => text.split(CODE_MARK).join("");

/** The README's lines, as written. */
function readmeLines(): string[] {
  return readFileSync(README, "utf8").split("\n");
}

/** The lines of the README's section "Moderation": from its heading to the next heading of the same level. */
function moderationSection(): string[] {
  const lines = readmeLines();
  const start = lines.indexOf("## Moderation");
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The section's runbook as its reader sees it: every line after "The runbook:", without the code marks. */
function moderationRunbook(): string {
  const section = moderationSection();
  const start = section.indexOf("The runbook:");
  return start === -1 ? "" : withoutCodeMarks(section.slice(start + 1).join("\n"));
}

/** How often `part` stands in `text`. */
const count = (text: string, part: string): number => text.split(part).length - 1;

describe("the README's moderation runbook says what the home screen says", () => {
  const sentences: [string, string][] = [
    ["decisions not released", RELEASE_OVERDUE_RUNBOOK],
    ["late erasures", ERASURE_OVERDUE_RUNBOOK],
  ];

  test("the README has a section Moderation, and the section has a runbook", () => {
    expect(readmeLines()).toContain("## Moderation");
    expect(moderationSection()).toContain("The runbook:");
    expect(moderationRunbook().trim()).not.toBe("");
  });

  test("neither constant holds a code mark or a line break, so reading the README without its code marks hides no difference", () => {
    for (const [name, sentence] of sentences) {
      expect(sentence, name).not.toContain(CODE_MARK);
      expect(sentence, name).not.toContain("\n");
      // A whole sentence: it opens with "A count of" and ends in a full stop, as the runbook's bullet writes it.
      expect(sentence.startsWith("A count of "), name).toBe(true);
      expect(sentence.endsWith("."), name).toBe(true);
    }
  });

  for (const [name, sentence] of sentences) {
    test(`the runbook holds the home screen's sentence for ${name}, word for word`, () => {
      expect(moderationRunbook()).toContain(sentence);
    });

    test(`the sentence for ${name} stands once in the README, in that runbook: no second copy can drift from it`, () => {
      expect(count(withoutCodeMarks(readmeLines().join("\n")), sentence)).toBe(1);
      expect(count(moderationRunbook(), sentence)).toBe(1);
    });
  }

  test("both sentences stand in one bullet of the runbook, the release's first, as the home screen orders its two lines", () => {
    const bullets = moderationRunbook()
      .split("\n")
      .filter((line) => line.includes(RELEASE_OVERDUE_RUNBOOK) || line.includes(ERASURE_OVERDUE_RUNBOOK));
    expect(bullets).toHaveLength(1);
    const bullet = bullets[0] ?? "";
    expect(bullet.startsWith("- ")).toBe(true);
    expect(bullet.indexOf(RELEASE_OVERDUE_RUNBOOK)).toBeGreaterThan(-1);
    expect(bullet.indexOf(ERASURE_OVERDUE_RUNBOOK)).toBeGreaterThan(bullet.indexOf(RELEASE_OVERDUE_RUNBOOK));
  });
});
