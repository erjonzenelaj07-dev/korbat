import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { REPLY_AIM_HOURS, STANDING_RULES } from "@korbat/contracts";
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

/**
 * The README's account sanctions (3e design, section 13, Task 7) and the constants they print. The section Moderation
 * describes 3e in a paragraph that opens with ACCOUNT_SANCTIONS_LEAD and a bullet for each title below, and its runbook
 * gains the bullets of section 13's (a) to (h). Every number in that text is a number of STANDING_RULES or
 * REPLY_AIM_HOURS: a table holds each in its sentence, and every other run of digits is refused, so the README cannot
 * keep a number the constants changed. A bullet added to 3e's text joins its list here.
 */
const ACCOUNT_SANCTIONS_LEAD = "Account sanctions (sub-project 3e;";
const STANDING_TITLES = [
  "Strikes.",
  "The ladder.",
  "Announced suspensions and the reply.",
  "Suspensions at once.",
  "While suspended.",
  "Termination.",
  "The restriction of reporting.",
  "Handle retirement.",
  "What is kept of them.",
  "The Standing screen.",
  // The runbook's bullets (a) to (h).
  "Account sanctions each working day.",
  "Answering a reply.",
  "A protective suspension.",
  "A breach that lies only in a handle",
  "A notice a person did not get by mail.",
  "A measure at once while an announced suspension waits.",
  "A mark that was wrong.",
  "Reports before an account measure.",
] as const;

/** The lines of 3e's text in Moderation, without code marks: the lead paragraph and each bullet by its bold title. */
function standingLines(): { lead: string | undefined; bullets: Map<string, string[]> } {
  const section = moderationSection().map(withoutCodeMarks);
  const bullets = new Map(STANDING_TITLES.map((title) => [title as string, section.filter((line) => line.startsWith(`- **${title}`))]));
  return { lead: section.find((line) => line.startsWith(ACCOUNT_SANCTIONS_LEAD)), bullets };
}
const standingText = (): string => {
  const { lead, bullets } = standingLines();
  return [lead ?? "", ...[...bullets.values()].flat()].join("\n");
};

/** A number in a sentence as the README writes it, and the constant it is. */
const S = STANDING_RULES;
const STANDING_NUMBERS: { constant: string; phrase: string }[] = [
  { constant: "strikeDays", phrase: `which counts for ${S.strikeDays} days` },
  { constant: "ladderStrikes", phrase: `With ${S.ladderStrikes} active strikes` },
  { constant: "ladderDays", phrase: `a suspension of at most ${S.ladderDays[0]} days, then ${S.ladderDays[1]}, then ${S.ladderDays[2]}` },
  { constant: "ladderMemoryDays", phrase: `the ladder suspensions decided in the last ${S.ladderMemoryDays} days` },
  { constant: "replyWindowHours", phrase: `The suspension starts ${S.replyWindowHours} hours after korbat's relay accepted the notice mail` },
  { constant: "undeliveredHours", phrase: `or ${S.undeliveredHours} hours after the decision` },
  { constant: "threatDays", phrase: `(up to ${S.threatDays} days), terrorist content` },
  { constant: "terroristDays", phrase: `likewise (up to ${S.terroristDays} days)` },
  { constant: "floodPosts", phrase: `at least ${S.floodPosts} posts in the last` },
  { constant: "floodMinutes", phrase: `posts in the last ${S.floodMinutes} minutes` },
  { constant: "floodDays", phrase: `minutes (up to ${S.floodDays} days)` },
  { constant: "basisAgeDays", phrase: `at most ${S.basisAgeDays} days old` },
  { constant: "protectiveDays", phrase: `once for that seal (up to ${S.protectiveDays} days)` },
  { constant: "protectiveDays", phrase: `for at most ${S.protectiveDays} days, never worded as a finding` },
  { constant: "reportWarnMarks", phrase: `At least ${S.reportWarnMarks} marked reports in ${S.reportFrameDays} days` },
  { constant: "reportRestrictMarks", phrase: `${S.reportRestrictMarks} marked reports sent after it, while it counts (${S.reportFrameDays} days)` },
  { constant: "reportRestrictDays", phrase: `open a restriction of at most ${S.reportRestrictDays} days` },
  { constant: "reportFrameDays", phrase: `the marks and the daily tallies ${S.reportFrameDays} days after their report's UTC day` },
  { constant: "REPLY_AIM_HOURS", phrase: `korbat aims to answer a reply to one within ${REPLY_AIM_HOURS} hours` },
  { constant: "REPLY_AIM_HOURS", phrase: `answer within ${REPLY_AIM_HOURS} hours` },
];

describe("the README's account sanctions say what the constants say (3e design, section 13, Task 7)", () => {
  test("Moderation opens 3e's part with its paragraph, and each of its bullets stands there once", () => {
    const { lead, bullets } = standingLines();
    expect(lead).toBeDefined();
    for (const [title, lines] of bullets) expect(lines, title).toHaveLength(1);
  });

  test("the runbook holds the bullets of section 13's (a) to (h), after The runbook: and before the records kept off the server", () => {
    const runbook = moderationRunbook().split("\n");
    for (const title of STANDING_TITLES.slice(STANDING_TITLES.indexOf("Account sanctions each working day."))) expect(runbook.some((line) => line.startsWith(`- **${title}`)), title).toBe(true);
  });

  test("every number of 3e's text stands in its sentence with the constant's value", () => {
    const text = standingText();
    for (const row of STANDING_NUMBERS) expect(text, `${row.constant}: ${row.phrase}`).toContain(row.phrase);
    // The table names every member of STANDING_RULES but the share, which the text writes as a word.
    expect([...new Set(STANDING_NUMBERS.map((row) => row.constant))].sort()).toEqual([...Object.keys(S).filter((key) => key !== "reportWarnShare"), "REPLY_AIM_HOURS"].sort());
    expect(S.reportWarnShare).toBe(0.5);
    expect(text).toContain("being at least half of the person's rule reports then");
  });

  test("and no other number: every run of digits in it is a constant's, outside the names of sub-projects, rules, articles and the design's file", () => {
    const values = new Set<string>([...Object.values(S).flat(), REPLY_AIM_HOURS].map(String));
    const outside = standingText()
      .replace(/docs\/superpowers\/specs\/[0-9a-z-]+\.md/g, " ")
      .replace(/\b[0-9][a-f]\b/g, " ")
      .replace(/\bR[1-6]\b/g, " ")
      .replace(/Art\. [0-9]+(\([0-9]+\))?(\([a-z]\))?/g, " ");
    expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual([]);
  });

  test("the lines 3e made false are gone: the handle left open for 3e, formula version 1 and the mails that name 3e", () => {
    const all = readmeLines().join("\n");
    expect(all).not.toContain("the case stays open for sub-project 3e's handle retirement");
    expect(all).not.toContain("Until sub-project 3e's formula version 2");
    expect(all).not.toContain("EXPLORE_V1");
    expect(all).not.toContain("still names sub-project 3e");
    // The hard gate names 3f's order path and 3d's handling of sealed images, as it did since 3e's design.
    expect(all).toContain("until sub-project 3f's order path and sub-project 3d's handling of sealed images have both shipped");
  });
});
