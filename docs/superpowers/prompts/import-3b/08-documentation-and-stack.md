# korbat import from other platforms (3b) — Task 8 of 8: Documentation and the stack: the README's Importing posts with 3b's lines in Upgrading, Backups, Counsel's list and The interface, the main design's section 6a marked delivered with its section 9 entry of 2026-10-27, and the smoke test's whole import through the real importer: confirmed, read on the Imported tab and removed.

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-10-22 to 2026-10-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Task 8 is the last task of sub-project 3b (import from other platforms), a batch end of its own and a stack task: it writes the record of docs/superpowers/specs/2026-10-22-import-3b-design.md as section 13's Task 8 lists it, following section 2 (the decisions for counsel and decision 28's list), 6.7, 7.7 (the settings), 11.1 and 11.3 (what is stored, the import key, the licence), 12.5 and 12.6 (the labs and the smoke test) and section 14 (left for later), on the code of Tasks 1 to 7. It adds no migration and changes no application code: the README, the main design's sections 6, 6a and 9, the smoke test's whole import, one comment in contracts and the README's test.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- The ignored env files must hold every setting of the example files before the stack is rebuilt: `node scripts/gen-dev-env.mjs` appends any that is missing and generates the keys an example marks, and it prints no value. The dry run used ports 8380, 8390 and, for the push site, 8391 in its scratch clone. If another program listens on port 8080 on every interface, `localhost:8080` reaches it over IPv6 and the smoke test answers 404 on every path of the site of the app: free the port, or run the smoke step with `NODE_OPTIONS=--dns-result-order=ipv4first` (an earlier replay met this).
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(app,admin): the screens and the console: /settings/import starts an import (the sources the site has on, how to get each archive, what korbat reads and never reads, the transit, the file checked by size and first bytes before anything is sent) and /settings/import/<id> draws one by its state, read every 3 s while it moves; lib/imports.ts uploads 8 MiB chunks hashed with crypto.subtle, resends a mismatch three times and resumes from the stored bytes; the preview counts the choice as the API does, with the list of posts, Leave this one out, descriptions, the statement and Publish; progress, result, Stop and Remove asked once; every sentence in lib/import-words.ts; kit Checkbox, ProgressBar and MonthPicker; PostCard's provenance label opens Who sees this at its paragraph, mentions of imported posts never link and post links are nofollow ugc noreferrer; the Imported tab; Import posts in Settings; the terms' Importing posts and one licence; the rules' Automation sentence; the console's import lines and an admin's End this import with its step-up; browser steps 41 to 51, the JS cap at the baseline plus 120 KB`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/08-documentation-and-stack.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Replace `apps/admin/test/readme.test.ts` (whole file)

````ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ALERT_RULES, ALERT_TEXTS, AUTOMATION_RULES, EDGE_CACHE, EDGE_RULES, HEAD_RULES, IMPORT_RULES, ORDER_RULES, RECIPIENT_RULES, REPLY_AIM_HOURS, RETENTION, SIGNAL_RULES, STANDING_RULES, TRANSPARENCY_RULES } from "@korbat/contracts";
import { AUTOMATION_WORDS } from "../src/messages";
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
    // The hard gate names 3f's order path and 3d's handling of sealed images, as it did since 3e's design; since 3d Task 2
    // in W.11's words, its quarantine and release.
    expect(all).toContain("until sub-project 3f's order path and sub-project 3d's quarantine and release have shipped");
  });
});

/**
 * The README's authorities' orders (3f design, section 13, Task 7; W.9 and W.10) and the constants they print. 3f's text
 * is the section "Authorities' orders", Upgrading from its 3f paragraph on (Task 1), Restoring's block "Restoring with
 * the keeper's copy" (Task 6) and Before going public's owner's list. Every number in it is a number of ORDER_RULES or
 * ALERT_RULES: a table holds each in its sentence, and every other run of digits is refused but for what names a
 * reference (an article, a research finding, a row of the design's section 2, a check P1 to P8, a list's numbering, a
 * path, a date), so the README cannot keep a number the constants changed. A setting is written as the operator sets it
 * in infra/.env, an API setting with the prefix Compose maps. A section added to 3f's text joins its list here.
 */
const FENCE = "```";

/** The lines of a "## " section of the README, from its heading to the next heading of the same level. */
function sectionLines(heading: string): string[] {
  const lines = readmeLines();
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}
/** A section's lines from the first that begins with these words to the section's end, or to the first that begins with `until`. */
function linesFrom(lines: string[], lead: string, until?: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(lead));
  if (start === -1) return [];
  const rest = lines.slice(start);
  const end = until === undefined ? -1 : rest.findIndex((line) => line.startsWith(until));
  return end === -1 ? rest : rest.slice(0, end);
}
/** Lines without their fenced code: a command's own numbers and words are not the runbook's. */
function withoutFences(lines: string[]): string[] {
  let inside = false;
  return lines.filter((line) => {
    if (line.startsWith(FENCE)) {
      inside = !inside;
      return false;
    }
    return !inside;
  });
}

const ORDERS_HEADING = "## Authorities' orders";
const ORDERS_TITLES = [
  "The contact point.",
  "On call.",
  "A removal order, step by step",
  "Other messages and orders.",
  "When nobody can act within the hour.",
  "Notifications and hand-overs.",
  "A person asks about a missing post.",
  "An author writes about an order's notice.",
  "The daily copy.",
  "A key in someone else's hands.",
  "The yearly counts.",
] as const;
const OWNERS_LEAD = "**The owner's list (sub-project 3f).**";
const OWNERS_TITLES = [
  "The Member State.",
  "The mailbox.",
  "The people's own access to the mailbox.",
  "Registering.",
  "The push hostname and ntfy's users.",
  "The phones.",
  "The keys.",
  "The papers, and counsel.",
  "The contact address.",
  "The page for the yearly report.",
  "The keeper, and the two places files rest.",
  "Decide",
  "Counsel",
] as const;

/** 3f's text, part by part, without code marks and fenced code. */
function ordersParts(): Record<"orders" | "upgrading" | "restoring" | "owners", string> {
  const read = (lines: string[]) => withoutCodeMarks(withoutFences(lines).join("\n"));
  return {
    orders: read(sectionLines(ORDERS_HEADING)),
    upgrading: read(linesFrom(sectionLines("## Upgrading"), "Authorities' orders and the alert channel (sub-project 3f)")),
    restoring: read(linesFrom(sectionLines("## Restoring"), "**Restoring with the keeper's copy**")),
    owners: read(linesFrom(sectionLines("## Before going public"), OWNERS_LEAD, "Set these in")),
  };
}
const ordersText = (): string => Object.values(ordersParts()).join("\n");

/** A number in a sentence as the README writes it, and the constant it is. */
const O = ORDER_RULES;
const A = ALERT_RULES;
const ORDER_NUMBERS: { constant: string; part: keyof ReturnType<typeof ordersParts>; phrase: string }[] = [
  { constant: "ALERT_RULES.pollSeconds", part: "orders", phrase: `reads the inbox and the junk folder every ${A.pollSeconds} seconds` },
  { constant: "ORDER_RULES.escalateMinutes", part: "orders", phrase: `it rings every staff phone ${O.escalateMinutes} minutes after its arrival` },
  { constant: "ORDER_RULES.itemsPerAction", part: "orders", phrase: `one key touch for up to ${O.itemsPerAction} posts` },
  { constant: "ORDER_RULES.holdWarningDays", part: "orders", phrase: `alerted daily in the last ${O.holdWarningDays} days before any release` },
  { constant: "ORDER_RULES.reportHoldDays", part: "orders", phrase: `the address is kept for at most ${O.reportHoldDays} days` },
  { constant: "ORDER_RULES.reportHoldDays", part: "upgrading", phrase: `keeps its address, and nothing else, for at most ${O.reportHoldDays} days` },
  { constant: "ORDER_RULES.copyOverdueHours", part: "orders", phrase: `once the newest copy is more than ${O.copyOverdueHours} hours old` },
  { constant: "ORDER_RULES.quietMinutes", part: "owners", phrase: `bounded only by the quiet period of ${O.quietMinutes} minutes` },
];

/** What names a reference and is no number of the runbook's, taken out before the digits are counted; only the second keeps a group, the character before the name. */
const REFERENCES: RegExp[] = [
  // A path, a file or a regulation's number: whatever holds a slash.
  /[A-Za-z0-9_.()-]*[/][A-Za-z0-9_./-]+/g,
  // A sub-project's name (3f, 3d, 1b) and a phone check (P1 to P8).
  /(^|[^0-9A-Za-z])([0-9][a-f]|P[1-8])(?=[^0-9A-Za-z]|$)/gm,
  // A list's numbering.
  /^[0-9]+[.] /gm,
  // An article of an act, with its paragraphs.
  /Art(?:icle|[.]) [0-9]+(?:[(][0-9a-z]+[)])*/g,
  // A finding of the research, with its questions; a row of the design's section 2, and the section itself.
  /(?:OL|AU) E[0-9]+[.][0-9]+(?: questions [0-9]+ to [0-9]+)?/g,
  /[(]rows? [0-9]+(?: and [0-9]+)?[)]/g,
  /section [0-9]+/g,
  // A step of a list named in a sentence.
  /steps? [0-9]+/g,
  // An instant as an example of the form, a date of the year, the hand-over's user, a hash's name, a status's code.
  /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z/g,
  /[0-9]+ March/g,
  /uid [0-9]+/g,
  /sha256/g,
  /answers 503/g,
];

describe("the README's authorities' orders say what the constants say (3f design, section 13, Task 7; W.9 and W.10)", () => {
  test("the README has the section Authorities' orders after Moderation, and each of its parts stands there once, in W.9's order", () => {
    const lines = readmeLines();
    expect(lines.indexOf(ORDERS_HEADING)).toBeGreaterThan(lines.indexOf("## Moderation"));
    const section = sectionLines(ORDERS_HEADING).map(withoutCodeMarks);
    const at = ORDERS_TITLES.map((title) => section.findIndex((line) => line.startsWith(`**${title}`)));
    for (const title of ORDERS_TITLES) expect(section.filter((line) => line.startsWith(`**${title}`)), title).toHaveLength(1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("Before going public holds the owner's list of thirteen, each line by its title, in W.10's order", () => {
    const owners = linesFrom(sectionLines("## Before going public"), OWNERS_LEAD, "Set these in").filter((line) => /^[0-9]+[.] /.test(line));
    expect(owners.map((line) => line.slice(0, line.indexOf(" ")))).toEqual(OWNERS_TITLES.map((_, n) => `${n + 1}.`));
    for (const [n, title] of OWNERS_TITLES.entries()) expect(owners[n]!.startsWith(`${n + 1}. **${title}`), title).toBe(true);
  });

  test("every number of 3f's text stands in its sentence with the constant's value", () => {
    const parts = ordersParts();
    for (const row of ORDER_NUMBERS) expect(parts[row.part], `${row.constant}: ${row.phrase}`).toContain(row.phrase);
  });

  test("and no other number: every run of digits in it is a constant's, outside what names a reference", () => {
    const values = new Set<string>([...Object.values(O), ...Object.values(A)].filter((value) => typeof value === "number").map(String));
    const outside = REFERENCES.reduce((text, pattern) => text.replace(pattern, (_match: string, lead: unknown) => (typeof lead === "string" ? `${lead} ` : " ")), ordersText());
    expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual([]);
  });

  test("a setting is written as the operator sets it in infra/.env: an API setting with its prefix", () => {
    const withMarks = [sectionLines(ORDERS_HEADING), linesFrom(sectionLines("## Upgrading"), "Authorities' orders and the alert channel"), linesFrom(sectionLines("## Restoring"), "**Restoring with the keeper's copy**")]
      .flatMap((lines) => withoutFences(lines))
      .join("\n");
    for (const name of ["NOTIFY", "REPORT_HOLD", "MODERATION_RETENTION", "HOME_STATE", "CONTACT_POINT", "PUSH_ORIGIN", "APP_ORIGIN"]) {
      expect(withMarks.includes(`${CODE_MARK}${name}`), name).toBe(false);
    }
    for (const name of ["API_CONTACT_POINT", "API_HOME_STATE", "API_REPORT_HOLD", "API_MODERATION_RETENTION", "APP_SITE", "COMPOSE_PROFILES", "WEB_CONTACT_POINT", "WEB_HOME_STATE"]) {
      expect(withMarks.includes(name) || ordersText().includes(name), name).toBe(true);
    }
  });

  test("the hand-over's and the yearly counts' commands stand in the runbook as the operator types them", () => {
    const orders = ordersParts().orders;
    for (const words of [
      "docker compose --profile handover run --rm -T -v <directory>:/handover handover < list > digests",
      "handover-list",
      "handover-record",
      "handover-destroyed",
      "staff.js tco-counts <last year>",
      "docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js address-check --handle <handle> < address",
    ]) {
      expect(orders, words).toContain(words);
    }
    expect(readmeLines().join("\n")).toContain("docker compose -f infra/compose.yml run --rm migrate node dist/staff.js tco-counts <year>");
  });

  test("3f's review: a sentence of Restoring or of the orders' runbook that sets APP_SITE recreates Caddy alone, and one that sets an API switch names the start that reads it", () => {
    // Caddy reads APP_SITE only when its container is created, and the API reads its switches only at its start: a
    // setting in infra/.env alone changes nothing. Without --no-deps Compose would start the API with Caddy.
    const sentences = [...sectionLines("## Restoring"), ...sectionLines(ORDERS_HEADING)].flatMap((line) => line.split(/(?<=[.;])\s+(?=[A-Z`(])/));
    const site = sentences.filter((sentence) => sentence.includes("`APP_SITE="));
    const api = sentences.filter((sentence) => /`API_[A-Z_]+=/.test(sentence));
    expect(site.length).toBeGreaterThanOrEqual(4);
    expect(api.length).toBeGreaterThanOrEqual(4);
    for (const sentence of site) expect(sentence, sentence).toContain("up -d --no-deps caddy");
    for (const sentence of api) expect(sentence, sentence).toContain("up -d api");
    // operations5: a message moved between the two folders is a second row; the runbook says not to, and what then.
    expect(ordersParts().orders).toContain("Never move a message between the inbox and the junk folder");
    expect(ordersParts().orders).toContain("close the second row on Contact point with the first row's word");
  });

  test("the lines 3f made false are gone, and the hard gate reads as W.10 words it", () => {
    const all = readmeLines().join("\n");
    expect(all).not.toContain("Until sub-project 3f's off-server copy of decisions");
    expect(all).not.toContain("take the app's public hostname off the tunnel and leave the console's on");
    expect(all).not.toContain("staff.js account-facts");
    expect(all).not.toContain("account-facts <handle>");
    expect(all).not.toContain("Authorities' orders before 3f.");
    expect(all).not.toContain("in their own records until sub-project 3f");
    expect(all).not.toContain("With sub-project 3f the authorities' contact address is published as well");
    // 3d Task 2 (W.11): the gate's first line reads 3d's quarantine and release; 3d Task 8: and the lists, now that 3d's
    // owner's list stands beside 3f's.
    expect(all).toContain("until sub-project 3f's order path and sub-project 3d's quarantine and release have shipped and the lists below are done");
  });
});

/**
 * 3d Task 1 (design, W.11): the README's sections Quarantine and Backups. Quarantine stands after Authorities' orders
 * with its six steps in W.11's order, each command as the operator types it; Backups before Restoring, with the days of
 * RETENTION.backupDays and the quarantine that is never backed up.
 */
describe("the README's Quarantine and Backups (3d design, W.11)", () => {
  const QUARANTINE_STEPS = [
    "docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-list > list",
    "docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt",
    "docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-record < receipt",
    "Nobody opens a file of the quarantine",
    "**A file in neither place**",
    "**A file without a record**",
  ];

  test("Quarantine stands after Authorities' orders, with its six steps in their order, each command as the operator types it", () => {
    const lines = readmeLines();
    expect(lines.indexOf("## Quarantine")).toBeGreaterThan(lines.indexOf("## Authorities' orders"));
    const steps = sectionLines("## Quarantine").filter((line) => /^[0-9][.] /.test(line));
    expect(steps.map((line) => line.slice(0, 2))).toEqual(["1.", "2.", "3.", "4.", "5.", "6."]);
    for (const [n, lead] of QUARANTINE_STEPS.entries()) expect(withoutCodeMarks(steps[n]!).includes(withoutCodeMarks(lead)), lead).toBe(true);
    const text = sectionLines("## Quarantine").join(" ");
    expect(text).toContain("--inventory > have");
    expect(text).toContain("with `--lost` appended");
    expect(text).toContain("(uid 1000, mode 0700)");
  });

  test("Backups stands before Restoring and says the backup's days from RETENTION.backupDays and that the quarantine is never backed up", () => {
    const lines = readmeLines();
    expect(lines.indexOf("## Backups")).toBeLessThan(lines.indexOf("## Restoring"));
    const text = sectionLines("## Backups").join(" ");
    expect(text).toContain(`is deleted ${RETENTION.backupDays} days after it was taken`);
    expect(text).toContain("`media-quarantine` is never backed up");
  });
});

/**
 * 3d Task 2 (design, sections 7.2, 7.3 and W.11): the release's runbook, "A release" under Quarantine, and the steps of
 * Restoring that replay releases. An assessment releases nothing; the leave is recorded with release-leave, withdrawn
 * at once when it was a mistake; release-show prints the record; the backups' day comes from RETENTION.backupDays. After
 * a restore, release-replay, the inventory, the lost leave and the lost withdrawal, and the site that opens only when no
 * gap is left. No line of the README says the software cannot release, and the R2 bullet no longer destroys by hand.
 */
describe("the README's release (3d design, W.11)", () => {
  test("A release stands under Quarantine: an assessment releases nothing, the leave is a fact of its own, a mistaken one is withdrawn, release-show prints the record", () => {
    const lines = readmeLines();
    const at = lines.indexOf("### A release");
    expect(at).toBeGreaterThan(lines.indexOf("## Quarantine"));
    const text = sectionLines("## Quarantine").slice(sectionLines("## Quarantine").indexOf("### A release")).join(" ");
    expect(text).toContain("An authority's assessment is not leave to destroy.");
    expect(text).toContain("staff.js release-leave <seal> --by <authority|court> --reference <text> --day <yyyy-mm-dd> --operator <name>");
    expect(text).toContain("`release-leave --end-untold <leave>`");
    expect(text).toContain("`release-leave --withdraw <leave> --operator <name>`");
    expect(text).toContain("a leave that a release already rests on cannot be withdrawn");
    expect(text).toContain("staff.js release-show <release>");
    expect(text).toContain("korbat promises nobody a destruction");
  });

  test("Restoring replays the releases: release-replay, the inventory first, the lost leave and withdrawal, and the site opens only with no gap left", () => {
    const text = sectionLines("## Restoring").join(" ");
    expect(text).toContain("**Restoring the releases** (sub-project 3d)");
    expect(text).toContain("cat <the keeper's files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-replay");
    // 3d review M9: the Quarantine steps 1 to 3 come first and again after the inventory (the README after the review).
    expect(text).toContain("the Quarantine steps 1 to 3 (list, move, record), then step 6 (the inventory)");
    expect(text).toContain("`release-leave <seal> ... --gap <gap>`");
    expect(text).toContain("`release-leave --withdraw <leave> --operator <name> --gap <gap>`");
    expect(text).toContain('the class "Releases and held uploads to replay" included');
  });

  test("the lines 3d's release made false are gone", () => {
    const all = readmeLines().join(" ");
    expect(all).not.toContain("but nothing releases or erases them before 3d");
    expect(all).not.toContain("its software has no function yet to hand them over or to erase them");
    expect(all).not.toContain("before sub-project 3d, the operator copies out or destroys the files");
  });
});

/**
 * 3d Task 3 (design, sections 7.4 and W.11): the README's section The edge, after Images. It states the header as the API
 * builds it from EDGE_CACHE, the outbox and its job with EDGE_RULES' numbers, the settings as the operator sets them in
 * infra/.env (with the API's prefix), the zone's settings and the check of W.11, whose line is the console's own words.
 * Every number in it is a constant's or an HTTP status.
 */
describe("the README's edge (3d design, W.11)", () => {
  test("The edge stands after Images and before Explore, and Images no longer promises a five-minute public cache", () => {
    const lines = readmeLines();
    expect(lines.indexOf("## The edge")).toBeGreaterThan(lines.indexOf("## Images"));
    expect(lines.indexOf("## The edge")).toBeLessThan(lines.indexOf("## Explore"));
    expect(readmeLines().join(" ")).not.toContain("with a public five-minute cache");
    expect(sectionLines("## Images").join(" ")).toContain("set the zone as The edge says");
  });

  test("the header, the job and its numbers, each from its constant, and the alert by its title", () => {
    const text = sectionLines("## The edge").join(" ");
    expect(text).toContain(`public, max-age=${EDGE_CACHE.browserSeconds}, s-maxage=${EDGE_CACHE.edgeSeconds}, must-revalidate, stale-if-error=0`);
    expect(text).toContain(`a browser keeps a copy for at most ${EDGE_CACHE.browserSeconds} seconds and an edge for at most ${EDGE_CACHE.edgeSeconds}`);
    expect(text).toContain(`up to ${EDGE_RULES.prefixes} images a request and one request a round, ${EDGE_RULES.roundSeconds} seconds after the last round ended`);
    expect(text).toContain(`after ${EDGE_RULES.giveUpHours} hours it is recorded as failed`);
    expect(text).toContain(`("${ALERT_TEXTS.edge_purge_failed.title}")`);
    expect(text).toContain("`edge_purges`");
    expect(text).toContain("`edge-purge`");
    // The header's own stale-if-error=0, held above as the whole header, and the three statuses the section names.
    const values = new Set([EDGE_CACHE.browserSeconds, EDGE_CACHE.edgeSeconds, EDGE_RULES.prefixes, EDGE_RULES.roundSeconds, EDGE_RULES.giveUpHours, 0, 200, 304, 404].map(String));
    expect((text.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual([]);
  });

  test("the settings as the operator sets them in infra/.env, the start that reads them, and the two refusals", () => {
    const text = sectionLines("## The edge").join(" ");
    for (const words of ["`API_EDGE_PURGE=off`", "`API_EDGE_PURGE=cloudflare`", "`API_EDGE_ZONE_ID`", "`API_EDGE_API_TOKEN`", "`API_EDGE_HOST`", "docker compose -f infra/compose.yml up -d api"]) {
      expect(text, words).toContain(words);
    }
    expect(text).toContain("The API refuses to start with `cloudflare` and one of the three missing, and with `test` while `APP_SITE` is open.");
  });

  test("the zone's settings and the check of W.11, whose line is the console's own", () => {
    const text = sectionLines("## The edge").join(" ");
    for (const words of [
      'Browser Cache TTL "Respect Existing Headers"',
      "no Edge Cache TTL rule on `/api/media`",
      "Always Online off",
      "a token with the one permission Zone, Cache Purge",
      "read the image through the public hostname until its header shows a cache hit",
      "Note the seconds.",
    ]) {
      expect(text, words).toContain(words);
    }
    expect(text).toContain(`read the case's line "Edge copy: purge accepted"`);
    expect(AUTOMATION_WORDS.purge("accepted", "a time").startsWith("Edge copy: purge accepted")).toBe(true);
  });
});

/**
 * 3d Task 4 (design, sections 7.5, 7.6, 8.10 and 15; W.11's paragraph on the yearly edition, without the daily value,
 * which is Task 5's): the README's section The yearly edition, after Quarantine, with the commands as the operator types
 * them; and the manual yearly report of 3f, which the edition replaces, gone from the runbook and the owner's list, while
 * tco-counts stays for the authority.
 */
describe("the README's yearly edition (3d design, W.11)", () => {
  test("The yearly edition stands after Quarantine and before Profile and account, with its commands as the operator types them", () => {
    const lines = readmeLines();
    expect(lines.indexOf("## The yearly edition")).toBeGreaterThan(lines.indexOf("## Quarantine"));
    expect(lines.indexOf("## The yearly edition")).toBeLessThan(lines.indexOf("## Profile and account"));
    const all = sectionLines("## The yearly edition").join("\n");
    for (const words of [
      "docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year>",
      "docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year> --correct",
      "docker compose -f infra/compose.yml run --rm migrate node dist/staff.js recipients",
      "`tco-counts` stays for the authority too",
      "`--correct` computes every table again and stores the result as a corrected version beside it, which its line on the page says",
      "`API_RECIPIENTS_SIGNED_OUT`",
      "docker compose -f infra/compose.yml up -d api",
    ]) {
      expect(all, words).toContain(words);
    }
  });

  test("its numbers are the constants': the due day, the floor and the six months", () => {
    const text = withoutCodeMarks(sectionLines("## The yearly edition").join(" "));
    expect(text).toContain(`on or after ${TRANSPARENCY_RULES.dueDay} March`);
    expect(TRANSPARENCY_RULES.dueMonth).toBe(3);
    expect(text).toContain(`"1 to ${TRANSPARENCY_RULES.floor - 1}"`);
    expect(text).toContain(`the average of the six full months before today`);
    expect(RECIPIENT_RULES.months).toBe(6);
  });

  test("the manual yearly report is gone, and tco-counts stays for an authority that asks", () => {
    const all = readmeLines().join("\n");
    expect(all).not.toContain("publish before 1 March, on the page the terms link");
    expect(all).not.toContain("Until sub-project 3d's transparency page exists");
    expect(all).not.toContain("create it before the first January");
    expect(all).not.toContain("the section Authorities' orders says what to publish, and when");
    const orders = ordersParts().orders;
    expect(orders).toContain("staff.js tco-counts <last year> in the migrate service stays for an authority that asks");
    expect(orders).toContain("the yearly edition on /transparency");
    expect(ordersParts().owners).toContain("the yearly report is the edition on /transparency, which korbat publishes itself on or after 1 March");
  });
});

/**
 * 3d Task 5 (design, sections 7.3 step 4, 7.7, 8.10 and 15; W.11's Restoring step 4 and "The yearly edition, the monthly
 * count and the daily value"): the head's daily value replaces both of the README's "Until sub-project 3d publishes the
 * head"; the paragraph "Who can rewrite the audit log" ends as W.11 words it; the yearly edition's section gains the daily
 * value, its three settings and the keeper's notes; and Restoring gains head-restore-mark. The keeper's daily visit stays.
 */
describe("the README's daily value of the head (3d design, W.11)", () => {
  test("no line still waits for 3d to publish the head, and the paragraph on who can rewrite the audit log ends as W.11 says", () => {
    const all = readmeLines().join(" ");
    expect(all).not.toContain("Until sub-project 3d publishes the head");
    expect(all).not.toContain("nothing detects the operator's own changes until 3d");
    const rewrite = readmeLines().find((line) => line.startsWith("Who can rewrite the audit log:"))!;
    expect(rewrite.endsWith("The head's daily value is public and goes to the keeper each day; the keeper's daily visit stays.")).toBe(true);
    const kept = readmeLines().find((line) => line.startsWith("- **The kept head.**"))!;
    expect(kept).toContain("The keeper's daily visit stays");
    expect(kept).toContain("`API_HEAD_KEEPER_MAIL`");
  });

  test("The yearly edition gains the daily value: the job, the keeper's mail and notes, the outside timestamp's settings and the alerts' titles", () => {
    const text = sectionLines("## The yearly edition").join(" ");
    expect(text).toContain("**The yearly edition, the monthly count and the daily value.**");
    for (const words of [
      "`API_HEAD_KEEPER_MAIL`",
      "`API_HEAD_WITNESS`",
      "`API_HEAD_WITNESS_URL`",
      "The keeper keeps each day's mail with the value, the place and the hash",
      `"${ALERT_TEXTS.head_missed.title}" is noted by the keeper`,
      `("${ALERT_TEXTS.head_unwitnessed.title}")`,
      "openssl ts -verify -digest <value> -in <day>.tsr -CAfile <certificates>",
      "docker compose -f infra/compose.yml up -d api",
    ]) {
      expect(text, words).toContain(words);
    }
    expect(withoutCodeMarks(text)).toContain(`the last ${HEAD_RULES.shownDays} days`);
  });

  test("Restoring gains head-restore-mark with the keeper's values for the days after the backup, before the site opens", () => {
    const lines = sectionLines("## Restoring");
    const text = lines.join(" ");
    expect(text).toContain("docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js head-restore-mark <day>:<value> ...");
    expect(text).toContain("with the values of the keeper's mails for the days after the backup");
    const mark = lines.findIndex((line) => line.includes("head-restore-mark"));
    const opens = lines.findIndex((line) => line.includes('the class "Releases and held uploads to replay" included'));
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThanOrEqual(opens);
  });
});

/**
 * 3d Task 8 (design, sections 7.3, 7.13, 7.14, 17 and W.11): the README whole. The section Automated tools, after
 * Quarantine, with W.11's parts in their order and every number from its constant; the line the owner fills with
 * counsel's advice on a held upload, word for word; Restoring with the held uploads' replay, the three actions an operator
 * line can name, what no command closes, and the public figures a restore loses; Images' two sentences; the flag in the
 * Moderation runbook; The edge's lab on the owner's zone; and Before going public with the 3d owner's parts A and B.
 */
describe("the README whole (3d design, W.11; Task 8)", () => {
  const AUTOMATION_HEADING = "## Automated tools";
  const AUTOMATION_PARTS = ["**A measure a program took, and a request for a person.**", "**A held upload.**", "**Switching a tool on.**", "**Cloudflare's scanning tool**"] as const;
  const T = AUTOMATION_RULES;

  test("Automated tools stands after Quarantine and before The yearly edition, with W.11's parts each once and in their order", () => {
    const lines = readmeLines();
    expect(lines.indexOf(AUTOMATION_HEADING)).toBeGreaterThan(lines.indexOf("## Quarantine"));
    expect(lines.indexOf(AUTOMATION_HEADING)).toBeLessThan(lines.indexOf("## The yearly edition"));
    const section = sectionLines(AUTOMATION_HEADING);
    const at = AUTOMATION_PARTS.map((part) => section.findIndex((line) => line.startsWith(part)));
    for (const part of AUTOMATION_PARTS) expect(section.filter((line) => line.startsWith(part)), part).toHaveLength(1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("its numbers are the constants': the target, the two limits on unanswered measures, the delay after No report, the address's days and a match record's days; and no other", () => {
    const text = withoutCodeMarks(sectionLines(AUTOMATION_HEADING).join(" "));
    for (const phrase of [
      `within ${T.objectionTargetHours} hours of a request`,
      `while ${T.unansweredMax} of its measures under that rule wait for a person`,
      `while a request is older than ${T.unansweredHours} hours`,
      `The upload is deleted ${T.noReportHours} hours after "No report"`,
      `(${RETENTION.reportHoldDays} days from the refusal)`,
      `A match record keeps its hash for ${T.matchKeepDays} days`,
    ]) {
      expect(text, phrase).toContain(phrase);
    }
    expect(RETENTION.reportHoldDays).toBe(ORDER_RULES.reportHoldDays);
    const values = new Set([T.objectionTargetHours, T.unansweredMax, T.unansweredHours, T.noReportHours, T.matchKeepDays, RETENTION.reportHoldDays].map(String));
    const outside = REFERENCES.reduce((rest, pattern) => rest.replace(pattern, (_match: string, lead: unknown) => (typeof lead === "string" ? `${lead} ` : " ")), text).replace(/R[12]/g, " ");
    expect((outside.match(/[0-9]+/g) ?? []).filter((digits) => !values.has(digits))).toEqual([]);
  });

  test("A held upload holds the line the owner fills with counsel's advice, word for word, and tells an admin neither end", () => {
    const text = sectionLines(AUTOMATION_HEADING).join(" ");
    expect(text).toContain(`"Counsel's advice of <day> on whether a match obliges korbat to report an upload that was never posted: <not yet given>."`);
    expect(text).toContain("The console does not say which way, and it preselects neither");
    expect(text).toContain("staff.js upload-report <refusal> --duty <duty>");
    for (const words of ["Report when", 'Choose "No report" only']) expect(text.includes(words), words).toBe(false);
    // The switches as the operator sets them, and the start that reads them.
    for (const words of ["`API_AUTOMATION_R1_ACTS=off`", "`API_AUTOMATION_R2_ACTS=off`", "`API_AUTOMATION_DPIA_R1`", "`API_AUTOMATION_DPIA_MATCH_ACTS`", "docker compose -f infra/compose.yml up -d api", "staff.js automation-status"]) {
      expect(text, words).toContain(words);
    }
  });

  test("Restoring replays held uploads too, an operator line names the three actions, a person closes what no command can, and the public figures a restore loses are said with what to do", () => {
    const text = sectionLines("## Restoring").join(" ");
    for (const words of [
      "for sealed posts and for held uploads",
      "a held upload whose refusal the backup does not hold is kept from every post",
      "(`upload_hold_ended`, `upload_released`, `seal_released`)",
      "If it is held for a report, it stays where it is, and the operator's R2 records say so.",
      "do not run `upload-report` a second time before the keeper's files have been checked for the record of the report",
      "a measure a program had taken is taken again by a person",
      "**The public figures after a restore** (sub-project 3d)",
      '("edition <year> version <n>, published <time>, is not in the restored database")',
      "`recipient_months`",
      'it reads "not recorded" in `staff.js recipients`',
      "`staff.js edition <year> --correct`",
    ]) {
      expect(text, words).toContain(words);
    }
    // While the switch is off, the one step that still runs is said.
    expect(text).toContain("nothing is erased or deleted but the fingerprints and ratings of an automated tool that is off");
    expect(text).not.toContain("While the switch is off nothing is erased or deleted, and");
  });

  test("Images gains its two sentences, the hashes' days from matchKeepDays; the Moderation runbook names the flag with SIGNAL_RULES' numbers and the closed door on a matched image; The edge the owner's lab", () => {
    const images = sectionLines("## Images").join(" ");
    expect(images).toContain(`three hashes of the file as received, deleted with the image or when the check is switched off; a match record keeps one of them for ${T.matchKeepDays} days`);
    expect(images).toContain("while the R1 check is switched on it also rates the decoded pixels, still without a network");
    const moderation = sectionLines("## Moderation").join(" ");
    expect(moderation).toContain(`at least ${SIGNAL_RULES.minItems} from ${SIGNAL_RULES.minReporters} signed-in accounts within ${SIGNAL_RULES.windowMinutes} minutes, at least half of them`);
    expect(SIGNAL_RULES.linkedShare).toBe(0.5);
    expect(moderation).toContain(`"${AUTOMATION_WORDS.queueFlag}"`);
    expect(moderation).toContain("An image that a match of the known material check names is opened by nobody at korbat at any time");
    expect(sectionLines("## The edge").join(" ")).toContain("the owner runs the lab on the zone");
  });

  test("Before going public holds the 3d owner's parts A and B, each line by its label and in order, after the settings; and Counsel's list points to part E", () => {
    const section = sectionLines("## Before going public");
    const lead = section.findIndex((line) => line.startsWith("**The owner's list (sub-project 3d).**"));
    expect(lead).toBeGreaterThan(section.findIndex((line) => line.startsWith("Set these in")));
    const labels = section.slice(lead).flatMap((line) => /^- [*][*]([AB][0-9])[.]/.exec(line)?.[1] ?? []);
    expect(labels).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "B1", "B2", "B3", "B4", "B5", "B6", "B7"]);
    const text = section.join(" ");
    expect(text).toContain("Counsel's advice on a held upload");
    expect(text).toContain(`must equal the ${RETENTION.backupDays} days of Backups`);
    expect(text).toContain("A4 of the 3d owner's list above, and the questions of part E of section 17");
  });
});

/**
 * The README after the one adversarial review of 3d as built (Task 9): the counts' Valkey and what its loss costs (H3);
 * opening the app's site recreates the API and the worker with Caddy, since only they read APP_SITE's refusal of a test
 * adapter (M8); Restoring keeps the pre-restore media-store and runs the Quarantine steps 1 to 3 before the inventory and
 * after it (M9); the command forms of automation-status, an empty inventory's receipt and release-show after a replay
 * (M16); and head-restore-mark before the API starts again (L2).
 */
describe("the README after the review of 3d (Task 9)", () => {
  /** The README's sentences, split where a sentence ends and the next begins with a capital, a code mark or a bracket. */
  const sentences = () => readmeLines().flatMap((line) => line.split(/(?<=[.;]) +(?=[A-Z`(])/));

  test("review H3: the recipients' count lives in the counts service, which writes nothing to disk; a lost counts store loses the running month, which reads not recorded", () => {
    const text = readmeLines().join(" ");
    expect(text).toContain(
      "The recipients' count (the day's key and the counting sketches of the transparency page) lives in a Valkey of its own, the service `counts`, which writes nothing to disk: no append-only file, no snapshot, no volume.",
    );
    expect(text).toContain("A restart of `counts` loses the running month's count, which then reads " + '"not recorded"' + "; nothing else is kept there.");
    expect(sectionLines("## Restoring").join(" ")).toContain("`counts` holds nothing to restore");
    expect(text).toContain("up -d postgres redis counts mailpit");
  });

  test("review M8: every sentence that opens the app's site recreates Caddy, the API and the worker; closing it may recreate Caddy alone", () => {
    const open = sentences().filter((sentence) => sentence.includes("APP_SITE=open"));
    expect(open.length).toBeGreaterThanOrEqual(3);
    for (const sentence of open) expect(sentence, sentence).toContain("up -d --no-deps caddy api worker");
    const closed = sentences().filter((sentence) => sentence.includes("APP_SITE=closed"));
    expect(closed.length).toBeGreaterThanOrEqual(2);
    for (const sentence of closed) expect(sentence, sentence).toContain("up -d --no-deps caddy");
  });

  test("review M9: Restoring keeps the pre-restore media-store until the Quarantine steps have run, and runs steps 1 to 3 before the inventory and again after it", () => {
    const text = sectionLines("## Restoring").join(" ");
    expect(text).toContain("Keep the `media-store` volume as it was before the restore");
    const first = text.indexOf("the Quarantine steps 1 to 3 (list, move, record)");
    const inventory = text.indexOf("then step 6 (the inventory)", first);
    const again = text.indexOf("then steps 1 to 3 again", inventory);
    expect([first > 0, inventory > first, again > inventory]).toEqual([true, true, true]);
    expect(text).not.toContain("beginning with step 6 (the inventory)");
  });

  test("review M16: automation-status runs in the api service, an empty inventory's receipt is not recorded, and release-show takes a replay's own id", () => {
    const all = readmeLines().join(" ");
    expect(all).toContain("docker compose -f infra/compose.yml run --rm api node dist/staff.js automation-status");
    expect(sectionLines("## Automated tools").join(" ")).not.toMatch(/read `staff[.]js automation-status`/);
    const restoring = sectionLines("## Restoring").join(" ");
    expect(restoring).toContain("When the inventory's receipt is empty, skip its step 3");
    expect(restoring).toContain("`release-show` takes the replay's own id, which `release-replay` prints");
    expect(restoring).toContain("prints a note and exits 1 only for what is still owed");
  });

  test("review L2: head-restore-mark runs before the API starts again, in the keeper's-copy steps", () => {
    const lines = sectionLines("## Restoring");
    const mark = lines.findIndex((line) => line.includes("dist/staff.js head-restore-mark <day>:<value> ..."));
    const start = lines.findIndex((line) => line.startsWith("5. Start the API with `docker compose -f infra/compose.yml up -d api`"));
    expect(mark).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(start);
  });
});

/**
 * 3b Task 8 (design, section 13): the README's record of import from other platforms. "Importing posts" stands after The
 * interface and before Before going public, and every number of IMPORT_RULES it prints stands in its sentence with the
 * constant's value; each import setting is named as infra/.env names it, with the default compose.yml gives it, and
 * compose's numbers are IMPORT_RULES' own. Upgrading names 3b's migrations above 3f's paragraph (whose digits are 3f's
 * alone), Backups names the two import volumes beside its two pinned sentences, Counsel's list gains decision 28's points,
 * and The interface's budget is the baseline of the app's browser check plus 120 KB, with its last step's number.
 */
describe("the README's record of importing posts (3b design, section 13, Task 8)", () => {
  const IMPORTING_HEADING = "## Importing posts";
  const R = IMPORT_RULES;
  const GIB = 1024 ** 3;
  /** A number as the README writes it: with a comma between thousands. */
  const n = (value: number): string => value.toLocaleString("en-US");
  const importing = () => sectionLines(IMPORTING_HEADING).join(" ");
  const repository = (...parts: string[]) => readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", ...parts), "utf8");

  test("Importing posts stands after The interface and before Before going public, and names the design", () => {
    const lines = readmeLines();
    const at = ["## The interface", IMPORTING_HEADING, "## Before going public"].map((heading) => lines.indexOf(heading));
    expect(at[0]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(importing()).toContain("`docs/superpowers/specs/2026-10-22-import-3b-design.md`");
  });

  test("every number of IMPORT_RULES it prints stands in its sentence with the constant's value", () => {
    const phrases = [
      `the file's size (at most ${R.maxBytes / GIB} GiB)`,
      `in chunks of ${R.chunkBytes / 1024 ** 2} MiB, each sent with its SHA-256`,
      `must finish within ${R.archiveHours} hours of its start`,
      `posts over ${n(R.shortenTo)} characters`,
      `a preview not confirmed within ${R.previewHours} hours of the reading expires`,
      `and at the latest ${R.archiveHours} hours after the import was created`,
      `and at the latest ${R.workHours} hours after the scan`,
      `at least ${R.recordDays} days after its end`,
      `while the importer's heartbeat is more than ${R.heartbeatStaleMs / 1000} seconds old`,
      `once it is at least ${R.minAccountAgeDays} days old`,
      `an account younger than ${R.newAccountDays} days publishes at most ${n(R.newAccountMaxPosts)} posts an import`,
      `${R.importsPerWeek} published imports an account in seven days`,
      `${R.importsPerAddressDay} imports started from one address in a day`,
      `at most ${n(R.maxPosts)} posts and ${n(R.maxImages)} images kept an import`,
      `at most ${R.imagesInFlight} at a time`,
      `the ${R.scanWriteBytes / GIB} GiB its scan may write`,
    ];
    const text = importing();
    for (const phrase of phrases) expect(text, phrase).toContain(phrase);
  });

  test("each import setting of compose's api service is named as infra/.env names it, with compose's default, and compose's numbers are IMPORT_RULES'", () => {
    const defaults = Object.fromEntries([...repository("infra", "compose.yml").matchAll(/[$][{](API_IMPORT[A-Z_]*):-([^}]*)[}]/g)].map((match) => [match[1]!, match[2]!]));
    expect(Object.keys(defaults).sort()).toEqual(["API_IMPORTS", "API_IMPORT_IMAGES", "API_IMPORT_IMAGES_PER_HOUR", "API_IMPORT_MAX_ACTIVE", "API_IMPORT_MIN_FREE_BYTES", "API_IMPORT_SOURCES"]);
    const lines = sectionLines(IMPORTING_HEADING);
    for (const [name, value] of Object.entries(defaults)) {
      expect(lines.filter((line) => line.startsWith(`- ${CODE_MARK}${name}${CODE_MARK} (default ${CODE_MARK}${value}${CODE_MARK}`)), name).toHaveLength(1);
    }
    expect([defaults.API_IMPORT_MAX_ACTIVE, defaults.API_IMPORT_IMAGES_PER_HOUR, defaults.API_IMPORT_MIN_FREE_BYTES]).toEqual([R.maxActiveDefault, R.imagesPerHourDefault, R.minFreeBytesDefault].map(String));
    expect(importing()).toContain(`from 0 to ${R.imagesPerHourMax}, so it can only be lowered`);
    expect(importing()).toContain(`${CODE_MARK}MEDIA_MATCH${CODE_MARK} keeps its own name`);
    // A setting is never written without its prefix: the operator would not find it in infra/.env.
    expect(importing()).not.toMatch(/`IMPORT[A-Z_]*`/);
  });

  test("it says why images stay off, what turning Bluesky on accepts, what the import key still allows, the screens, the console's end and the labs", () => {
    const text = importing();
    for (const words of [
      "stops the API at its start while `MEDIA_MATCH` is `off`, in every environment",
      "so no build imports images today",
      "a Bluesky archive proves nothing about who uploads it",
      "Bluesky imports are text only",
      "whoever holds the database or a backup of it",
      "Import posts in Settings",
      "`/settings/import`",
      "resumes from the bytes the server holds",
      "**The profile's Imported tab.**",
      "the audit action `import_ended_by_staff`",
      "an open gap of the class `restriction`",
      "?gap=",
      "pnpm --filter @korbat/importer test:lab",
      "test/lab/imports-intake.lab.ts",
      "about 25 minutes at half a processor",
    ]) {
      expect(text, words).toContain(words);
    }
    expect(text).not.toContain("APP_SITE=");
  });

  test("Upgrading names 3b's migrations, the slow one and the importer above 3f's paragraph", () => {
    const upgrading = sectionLines("## Upgrading");
    const orders = upgrading.findIndex((line) => line.startsWith("Authorities' orders and the alert channel (sub-project 3f)"));
    const ours = upgrading.findIndex((line) => line.startsWith("Import from other platforms (sub-project 3b)"));
    expect(ours).toBeGreaterThan(-1);
    expect(ours).toBeLessThan(orders);
    const paragraph = upgrading[ours]!;
    for (const words of ["the migrations 0043 to 0048", "`0045_import_readers` is the slow one", "`posts_latest_idx`", "the service `importer`", "`import-archives`", "`import-work`", "No setting is needed"]) {
      expect(paragraph, words).toContain(words);
    }
  });

  test("Backups names the two import volumes as never backed up, and keeps its two sentences", () => {
    const text = sectionLines("## Backups").join(" ");
    expect(text).toContain("`import-archives` and `import-work` are never backed up");
    expect(text).toContain(`is deleted ${RETENTION.backupDays} days after it was taken`);
    expect(text).toContain("`media-quarantine` is never backed up");
  });

  test("Counsel's list gains decision 28's points from importing posts, in its order, with the licence", () => {
    const counsel = sectionLines("## Before going public").find((line) => line.startsWith("Counsel's list,")) ?? "";
    const from = counsel.indexOf("From importing posts:");
    expect(from).toBeGreaterThan(counsel.indexOf("From transparency and automation:"));
    const points = counsel.slice(from);
    const decisions = [...points.matchAll(/[(]decisions? ([0-9]+(?:(?:, | and )[0-9]+)*)[)]/g)].flatMap((match) => match[1]!.split(/, | and /).map(Number));
    expect(decisions).toEqual([4, 14, 16, 15, 18, 25, 28]);
    for (const words of ["impact assessment", "the licence", "section 11.3", "`docs/superpowers/specs/2026-10-22-import-3b-design.md`"]) expect(points, words).toContain(words);
  });

  test("The interface's JavaScript cap is the browser check's baseline plus 120 KB, and its steps run to the last numbered one", () => {
    const baseline = JSON.parse(repository("apps", "app", "test", "browser", "baseline.json")) as { commit: string; js: { gzipBytes: number } };
    const text = sectionLines("## The interface").join(" ");
    expect(text).toContain(`JavaScript at most ${n(baseline.js.gzipBytes + 120 * 1024)} bytes gzip, which is the export of ${baseline.commit} (${n(baseline.js.gzipBytes)} bytes`);
    const steps = Math.max(...[...repository("apps", "app", "test", "browser", "app.browser.ts").matchAll(/test[(]"([0-9]+)[.] /g)].map((match) => Number(match[1])));
    expect(text).toContain(`(${steps} steps,`);
  });
});
````

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/db test:       Tests  112 passed (112)
packages/contracts test:       Tests  501 passed (501)
packages/rules test:       Tests  134 passed (134)
packages/media-protocol test:       Tests  26 passed (26)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/import-3b/write_blocks.py docs/superpowers/prompts/import-3b/08-documentation-and-stack.md 3
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Posting and feed (sub-project 2a): `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env, apps/app/.env, apps/worker/.env and apps/importer/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis counts mailpit   # dev host ports 55432, 56379, 56380, 51025, 58025 (movable: DEV_*_PORT in infra/.env)
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/importer dev          # the importer of archives (3b); reads apps/importer/.env and works on .data/import, which the API's IMPORT_*_DIR name too
pnpm --filter @korbat/app web               # http://localhost:8081
pnpm --filter @korbat/admin dev             # the staff console at http://localhost:8090 (never 127.0.0.1); forwards /api/staff/* to the API above
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

The data services are PostgreSQL 18 and Valkey (the BSD-licensed fork of Redis, still under the service name `redis`, on its own volume `valkeydata`: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into the old `redisdata` volume, which held only transient state and can be removed with `docker volume rm`). Valkey needs the password from `infra/.env`; `gen-dev-env` writes it into the API's `REDIS_URL` too, so an older `.env` is fixed by running it again. The recipients' count (the day's key and the counting sketches of the transparency page) lives in a Valkey of its own, the service `counts`, which writes nothing to disk: no append-only file, no snapshot, no volume. A restart of `counts` loses the running month's count, which then reads "not recorded"; nothing else is kept there. It takes the same password, and the API reads it as `COUNTS_URL`, which Compose sets.

korbat once ran MinIO and never used it. Images live on two Docker volumes instead, `media-uploads` and `media-store`. If an old stack left a `korbat_miniodata` volume behind, `docker volume rm korbat_miniodata` removes it.

## Tests
```bash
pnpm test                                     # unit tests of every package
node scripts/test-db.mjs                      # creates or migrates the korbat_test database; run it again after adding a migration
pnpm --filter @korbat/api test:integration    # needs postgres, redis and mailpit up
```

Integration tests have their own database, `korbat_test`, and their own Redis database, 15. Both are named in `apps/api/.env.test`, which `node scripts/gen-dev-env.mjs` derives from `apps/api/.env`. Every run starts by emptying them, and refuses to start if a URL points anywhere else, so tests never touch development data.

Before they had their own database, the integration suites left accounts, profiles and posts in the development database, and the smoke test still leaves its first account per run, by then a moderator, with one open moderation case on that account's post. To see and remove them:

```bash
node scripts/clean-dev-fixtures.mjs          # lists test accounts and profiles without an account; deletes nothing
node scripts/clean-dev-fixtures.mjs --yes    # deletes them with everything they made
```

It only matches emails of the tests' shape, `<word>-<uuid>@korbat.local`, recomputes the counters of kept profiles and posts they touched, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin. It keeps an account that holds a staff key or that the moderation record names (one that decided anything, one on either side of a staff link, the subject of a case that a decision or a reveal names), and counts it as kept; every other case about a deleted account or one of its posts is deleted with it, the smoke test's open case included.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080, and the staff console at http://localhost:8090
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test first checks the staff console's site: its page carries the console's own policy and is never stored, and the staff API answers there (401 without a session) and nowhere else (Caddy's own 404 on the app's site); the console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and the console's site refuses the app's own moderation routes with a 404 of its own. It then signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline. It uploads a JPEG carrying a GPS position, posts it, and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404, and that deleting the post removes the image from disk. It checks the worker's isolation, then imports a Mastodon archive the script builds: sent in chunks through Caddy, read by the real importer in its isolation, confirmed, its four posts read on the profile's Imported tab and in no feed, and removed again with Remove imported posts. Then it grants the account a staff role with the CLI and checks that its session was revoked. A second throwaway account edits its bio, changes its handle, reports the first account's post under a rule, finds that report undecided in its own list and in its export's member `moderation`, followed by its imports (none), and deletes itself. Last, signed out, a notice that the same post is illegal is taken with the human check: it answers a reference and a token, the status page opens with that token, the receipt arrives in Mailpit, and the token in the receipt's link opens the same page. Nothing in it decides the case, since a decision needs a staff key: every run leaves one open case in lane 2 on the first account's post. One network can run it five times an hour and five times a day, since its two sign-ups count against the hourly sign-up limit, its signed-out notice against the limits of reports sent without an account, and its import against the imports started from one address in a day.

After every sharp upgrade, add `--worst-case`: it also uploads flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF), expects each to be ready without the worker being OOM-killed or restarted, and prints the worker's memory peak.

Caddy listens on 8080 inside its container as its own user, proxies `/api` to the API and serves the web app with the page's security headers; `index.html` is revalidated on every load and the hashed bundles are cached for a year. On 8090 it serves the staff console under the console's own policy and proxies only `/api/staff/*`, which the app's site refuses. On 8091 it serves the phones' push site: only the two alert topics' subscriptions reach ntfy, and every other path is Caddy's own 404. The compose file keeps cloudflared, Caddy, the API and the data services on separate networks, so cloudflared reaches only Caddy and Caddy only the API and ntfy. Under the Compose profile `notify`, the contact point's watcher (`notify`) and the push server (ntfy) join two networks of their own: `push`, which has no route out and whose clients the app's and the console's sites refuse with 403, and `watch`, which holds the watcher and PostgreSQL and nothing else. With the profile on, add `--push http://localhost:8091` to the smoke test: it checks that the push site answers ntfy's own API with 404 and hands a subscription to ntfy, and that from the push network the app's and the console's sites answer 403.

## Upgrading PostgreSQL

The stack runs PostgreSQL 18 on the `pgdata18` volume. A database from the earlier PostgreSQL 16 volume (`pgdata`) is moved by:

```bash
node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

It dumps the old cluster with the old image in a throwaway container, starts the new server, restores the dump with every owner kept, and compares the row counts. The old volume stays until you remove it; the test database is created again by `node scripts/test-db.mjs`. Run `staff.js audit-verify` with every kept place before and after a major upgrade; Before going public says why.

## Upgrading

Import from other platforms (sub-project 3b) adds the migrations 0043 to 0048, the service `importer` and its two volumes, `import-archives` and `import-work`, which the next `up` builds and creates; neither volume is backed up (Backups). No setting is needed: imports start on, for X and Mastodon, text only (Importing posts). `0045_import_readers` is the slow one: on `posts` it drops `posts_latest_idx` and builds it again with a new predicate, and builds `posts_imported_idx` and `posts_author_native_idx`, so on a large `posts` table the migrate service runs for a while and the API, which starts only once it has finished, starts late; leave the upgrade's window room for it.

Authorities' orders and the alert channel (sub-project 3f) add a database role for the contact point's watcher, two services under a Compose profile, the hand-over's service under another, the report hold, and two arguments of the web build.

- On a database that exists, give the role its password and create it, with its USAGE on the schema `public`, once, as the superuser and against korbat's own database, before the first 3f migration: set `KORBAT_NOTIFY_DB_PASSWORD` in `infra/.env` (`node scripts/gen-dev-env.mjs` does in development), run `docker compose -f infra/compose.yml up -d postgres`, which passes it to the database's container, then the command below. Run twice, it changes nothing. The grant cannot be made by the migration: the migrator does not own the schema, and its grant would be a warning and nothing more. The migration checks both and stops with "create the role korbat_notify first" when either is missing, so a half-done upgrade stops there and not at a watcher that cannot read a row. A new data directory gets both from `infra/postgres/init/01-roles.sh`.

```bash
docker compose -f infra/compose.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$KORBAT_NOTIFY_DB_PASSWORD"' <<'SQL'
SET korbat.notify_pw = :'pw';
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'korbat_notify') THEN
  IF current_setting('korbat.notify_pw') = '' THEN RAISE EXCEPTION 'KORBAT_NOTIFY_DB_PASSWORD is empty in the postgres container: set it in infra/.env, then up -d postgres'; END IF;
  EXECUTE format('CREATE ROLE korbat_notify LOGIN PASSWORD %L', current_setting('korbat.notify_pw'));
END IF; END $$;
GRANT USAGE ON SCHEMA public TO korbat_notify;
SQL
```

- `notify` and ntfy run under the Compose profile `notify`. Switch it on in one place, `COMPOSE_PROFILES=notify` in `infra/.env`, which Compose reads for every command: the README's commands stay as they are, and an upgrade then recreates the two services with the rest. Without that line they are never started, or keep running an old image against a migrated database.
- Until the contact-point mailbox exists, leave the profile off and set `API_NOTIFY=off`: korbat then says on the console's home screen that phone alerts are switched off on this server, and mails no "Phone alerts are down". No setting of `notify`, ntfy or the hand-over is needed for the stack to start.
- The quarantine's service (`quarantine`, sub-project 3d) runs under the Compose profile `quarantine`, which stays off: the operator starts it by hand with the steps under Quarantine. Its volume `media-quarantine` is created by its first run, owned by the API image's user; the hand-over's service now mounts it too, read-only. It needs no setting, and nothing of it is backed up.
- The hand-over's service (`handover`) runs under the Compose profile `handover`, which stays off: the operator starts it by hand for one hand-over, with the directory on its command line (Authorities' orders, Notifications and hand-overs). It needs no setting.
- The report hold is on from the upgrade: while a report of sealed images to the authorities is owed, the deletion of the account keeps its address, and nothing else, for at most 7 days. `API_REPORT_HOLD=off` in `infra/.env` ends the practice for everyone and deletes as before; set it only on counsel's advice.
- The web build takes `WEB_CONTACT_POINT` and `WEB_HOME_STATE` from `infra/.env` for the terms (the contact point for authorities and korbat's Member State). Neither is required, and both stay empty, or the state alone set, until the last step of Before going public; `node scripts/gen-dev-env.mjs` adds the two lines to an existing file without changing a value. Rebuild the caddy image after a change of either.

## Backups

The backup of `media-store` is deleted 30 days after it was taken (`RETENTION.backupDays`, which the terms publish), without exception but an authority's written demand. `media-quarantine` is never backed up (Quarantine, step 4). `import-archives` and `import-work` are never backed up either, by design: an archive holds the person's messages and other people's data, and lives at most 24 hours, and the importer's output at most 72 hours after its scan (Importing posts).

## Restoring

Restore the database and the `media-store` volume from the same moment. Keep the `media-store` volume as it was before the restore (copy it aside) until the Quarantine steps of Restoring the releases below have run: a file that a lifted seal returned from the quarantine after the backup is in that copy and in neither restored place. `counts` holds nothing to restore: its running month reads "not recorded". The API's sweeper deletes images that have no row: after a database restored from an older snapshot it would delete every image posted since. It refuses when there are many such images, but for a restore window set `MEDIA_RECONCILE=off` in `infra/.env` before starting the API, and put it back to `on` once the store matches the database. `force` makes one pass delete them anyway, for when they really are orphans.

Keep no backup of the database or of `media-store` more than 30 days after it was taken (`RETENTION.backupDays`, which the terms publish), and delete older ones, except a backup that korbat must keep for the authorities (step 5), which you keep until they have answered. A backup holds what korbat erased after it was taken, among it content erased under rule R4.

The staff steps run with the api service stopped (`docker compose -f infra/compose.yml stop api`), before it starts again, with the commands under Staff console and Moderation; step 5 says which of its parts wait until the API runs again:

1. Run `staff.js audit-head` on the restored database. Its place and hash go to the keeper with the restore's date: new rows will take the places lost with the backup's later rows, with other hashes, so every place kept after the backup would fail as a rewrite does. The keeper retires those places with that note, `audit-verify` runs from then on with the places at or before the restored one, and a failing place that no announced restore explains is a rewrite.
2. Run `staff.js revoke <email> all` for every account `staff.js keys` lists, since the restore brings back every staff key, staff session and enrolment link revoked or cancelled after the backup, and the auth events and audit rows that recorded those revocations are gone with it.
3. Run grant-role for every staff account with the role on your own list, and `user` for any other account `staff.js keys` lists, as after an API incident: it sets back any role changed after the backup and ends every session and staff session of the account, app sessions revoked after the backup included. Then compare the accounts `staff.js keys` lists with that list.
4. Each person enrols again, two keys each.
5. Moderation. Every decision, review and seal confirmed after the backup is gone with its audit rows, and what it restricted is back: sealed images are served again, and a removed post is public again. Reports, notices and re-examinations received after the backup are gone too, and so is everything `staff.js` wrote since: links and unlinks and limits. So are the stops that people pressed on a report's page after the backup, and the report mail that accounts resumed in Settings since; korbat may mail such an address about reports again, though its holder asked it to stop, until they press stop again, and an account that resumed its report mail gets none until it resumes again. Nothing on the server or in your records names them, so none can be applied again. Nothing on the restored server names the lost decisions either: the keeper's daily copy names them, and the orders and records to authorities, up to the keeper's last download, and Restoring with the keeper's copy below takes each lost measure again from it. So before the api service starts again after step 3, set `APP_SITE=closed` in `infra/.env` and recreate Caddy alone with `docker compose -f infra/compose.yml up -d --no-deps caddy` (Caddy reads the setting only when it is created, and without `--no-deps` Compose would start the API with it), which closes the app's site and leaves the console's open, as that block's first step says; check from outside that the app's hostname answers 503. Before it starts, also delete the moderation dispatch's daily markers, which live in Valkey and are not restored with the database: `docker compose -f infra/compose.yml exec -T redis sh -c 'export VALKEYCLI_AUTH="$REDIS_PASSWORD"; valkey-cli --scan --pattern "*moderation-dispatched:*" | while read -r k; do valkey-cli del "$k"; done'`. The dispatch's first round then releases again every outcome and changed outcome that was answered before the day's dispatch hour and not yet released at the backup, so the status pages, the re-examination windows and the mails agree again; a person whose outcome mail or statement went out after the backup's time gets it a second time. Before it starts, also set `API_MODERATION_RETENTION=off` in `infra/.env`, which the API reads when `docker compose -f infra/compose.yml up -d api` starts it. The restored database no longer holds the cases, freezes and seals made after the backup. From its first round, 10 minutes after the start, the retention job would make R4 redactions final, erase case evidence and delete the images that these cases, freezes and seals no longer protect. That includes images sealed and reported to the police since the backup, long before an admin has enrolled and sealed them again. While the switch is off nothing is erased or deleted but the fingerprints and ratings of an automated tool that is off (Automated tools), and the console's count of late erasures rises. Before anyone decides anything, run `staff.js link` and `staff.js unlink` until the links match your records, and check that the count `staff.js keys` prints for each staff account equals your records'; then run `staff.js limits` with the numbers you last set. Once the staff have enrolled again, an admin first opens a finding citing R2 on every post or account that your R2 records show was sealed after the backup's time, unless its case is open in the restored database, and seals its images again. Only then, once every such seal has been applied again, set `API_MODERATION_RETENTION=on` in `infra/.env` and run `docker compose -f infra/compose.yml up -d api`, which recreates the API with it, and open the app's site again when the console's After a restore screen says so (`APP_SITE=open`, then `docker compose -f infra/compose.yml up -d --no-deps caddy api worker`: the API and the worker read the setting only when they start, and refuse a `test` adapter on an open site). Its next rounds make up the erasures that fell due meanwhile. Then tell the authority each of these was reported to what was lost and when it was sealed again, and keep the backup you restored from until that authority has answered, also past the 30 days. Sub-project 3d adds the release of sealed images and its replay after a restore. Then the cases that were open at the backup are open again in the queue: decide them again at once, lane 0 first. Each moderator also opens a finding on any other target they remember restricting since the backup's time.

**Restoring with the keeper's copy** (sub-project 3f). The keeper's daily copy of the audit log's tail (Staff console, the audit log's "Download since my last copy") names the orders, the records to authorities and the decisions the backup lacks, up to the keeper's last download. These steps come after the staff steps above; where they and step 5 differ, these hold.

1. Before the API starts: `API_MODERATION_RETENTION=off`, `MEDIA_RECONCILE=off` and `APP_SITE=closed` in `infra/.env`, which the API reads when `docker compose -f infra/compose.yml up -d api` starts it in step 5; then recreate Caddy alone with `docker compose -f infra/compose.yml up -d --no-deps caddy`, since Caddy reads `APP_SITE` only when it is created, and check from outside that the app's hostname answers 503 to every path (`curl -s -o /dev/null -w '%{http_code}' https://<app hostname>/`); the console's site is unchanged.
2. Feed the import every keeper's file from the one that holds the restored head's place onward, oldest first, concatenated on standard input: `cat <files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js restore-import <kept places>` (`-T`: without it Compose attaches a terminal and the redirect fails). The files need not start at the head: the import checks the earlier lines and skips them. A changed file is refused whole and nothing is written; a hole between two files is printed, and what lies behind it is not imported. Read what it prints, a hole among it.
3. Compare the contact-point mailbox since the keeper's last download with the orders it lists; open what is missing with `order-open --received`. An imported item whose link named no post shows `sha256:` and a digest in place of the link, since the copy holds no link's text: read the address from the order in the mailbox. Enter the records of class "record" again from the authority's letters, each with its command and `--gap <gap>`, which closes that gap. Until the last of them is entered, answer no data request: `access-request` cannot print an authority's "not to the person" mark for a record that is still lost.
4. Still before the API starts, record the restore of the audit log's daily value: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js head-restore-mark <day>:<value> ...`, with the values of the keeper's mails for the days after the backup, each a day and its value as the mail gives them. Each is shown on `/transparency` as retired, every published value that the restored log no longer gives is retired too, none is deleted, and today's row says that korbat restored its database from a backup and which value is the last that still fits. Run it before the API starts: the API's first round after the dispatch hour would otherwise alert that the day before has no value and publish today's from the restored chain, which the keeper's mail of today no longer matches. Before any order's disabling is taken again: compare each held notice the import lists with the mailbox since the keeper's last download. An extension or a later time that was recorded after that download is lost with the restore; record it again first (`order-hold-extend`, `order-hold-until`), or the disabling taken again would tell the author at the old end.
5. Start the API with `docker compose -f infra/compose.yml up -d api`; everyone enrols new keys.
6. On the console's After a restore screen, take every measure again, from the top. An order's disabling first: its hour, its preservation and its hold are the old ones. A gap that needs nothing is closed by an admin as "Not needed", with the key.
7. When the screen says so, set `APP_SITE=open` and recreate Caddy, the API and the worker with `docker compose -f infra/compose.yml up -d --no-deps caddy api worker` (the API and the worker read it only when they start, and refuse a `test` adapter on an open site), then check from outside that the app's hostname no longer answers 503; when it says so, switch retention and the sweep back on (`API_MODERATION_RETENTION=on`, `MEDIA_RECONCILE=on`) and run `docker compose -f infra/compose.yml up -d api`, since the API reads both only when it starts.

The keeper's file holds no post and no statement, but it names authorities and references, held orders' among them, and a reference may itself name a person: keep it like the head, not like a log.

**Restoring the releases** (sub-project 3d). While the app's site stays closed (step 1 above), after `restore-import` (step 2 above), which writes a gap of the class "Releases and held uploads to replay" for every release, every leave recorded and every leave withdrawn that the backup lacks:

1. `cat <the keeper's files> | docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-replay`. Every release recorded after the backup is marked again, for sealed posts and for held uploads: its posts are released and their image rows erased, a seal for good taken again afterwards freezes nothing, and a held upload whose refusal the backup does not hold is kept from every post. A replay whose author must not be told yet, or whose leave the restore lost, waits until it may be told. It passes over every line the restored database holds, takes the lines above it in their order, and prints a note and exits 1 only for what is still owed: a line no gap names, or a lost end of a hold whose refusal is there and whose gap is open, which an admin ends again (step 3). Each replay is a release of its own id: `release-show` takes the replay's own id, which `release-replay` prints, and answers no release for the original's.
2. Run the Quarantine steps 1 to 3 (list, move, record), then step 6 (the inventory), then steps 1 to 3 again. The first run moves into the quarantine what the restored store holds again of images sealed for good; the inventory gives a file the quarantine holds without a record its row, and its record reports each file recorded in the quarantine that it did not list: look for that file in the `media-store` kept from before the restore and put it back in the quarantine under its name before anything else, and record it lost (step 5) only when it is in neither. When the inventory's receipt is empty, skip its step 3: `quarantine-record` refuses an empty receipt. The second run's destroy lines name every released file that the restored store or the quarantine holds again. An `operator` line is a file the quarantine holds for an image the restored database does not know: never destroy it on that line alone; find the row of the keeper's files that names the image (`upload_hold_ended`, `upload_released`, `seal_released`). If it is held for a report, it stays where it is, and the operator's R2 records say so. If it was released, no list will ever print a `destroy` line for it, since the database cannot tie the file to its release: write that one line by hand (the `operator` line with `destroy` as its direction), run steps 2 and 3 with it, and note it.
3. On After a restore, a person closes what no command can: a lost end of a hold whose refusal is there is ended again by an admin, the same way (do not run `upload-report` a second time before the keeper's files have been checked for the record of the report); a measure a program had taken is taken again by a person, as 3f's classes say. A lost leave is recorded again from what korbat holds in writing, with `release-leave <seal> ... --gap <gap>`, which records it under the id the gap names and closes the gap. A lost withdrawal of a leave comes before anything else on its case: the restored database shows the mistaken leave as standing, so withdraw it again with `release-leave --withdraw <leave> --operator <name> --gap <gap>` before an admin reads the case.
The site opens only when After a restore shows no gap, the class "Releases and held uploads to replay" included, and `head-restore-mark` has run (step 4 of Restoring with the keeper's copy).

**The public figures after a restore** (sub-project 3d). A backup holds the yearly editions published and the months of the readers' count closed until it was taken, and nothing after. `restore-import` prints one line for each published version of an edition that the restored database lacks ("edition <year> version <n>, published <time>, is not in the restored database"), and writes nothing for it: `/transparency` no longer shows that version. The job publishes a year's first version again in its next daily round, computed from the restored database as of the same 1 March, which lacks what the backup lacked, and a version for an order whose hold ended again when it finds that order; a lost correction comes back only with `staff.js edition <year> --correct`. Note in the operator's notes each lost version, its day and, if you kept the page, how the new one differs, and say so to anyone who asks about it. A month closed after the backup is lost the same way, its two numbers with it (`recipient_months`), and no line or audit row records that it was: it reads "not recorded" in `staff.js recipients` and in the recipients' line of the next edition. Note the months between the backup and the restore.

A suspect or revoked staff key is never cleared or revived.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines only.
- **Liker lists are never exposed.** Counts are public; likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing. A post that a report or a moderator's finding named before it was deleted keeps a copy with its case, read by staff only, for as long as the case needs it (Moderation, Evidence and retention).
- **Moderation states.** A post is `visible`, `withheld` (while a case about it is being decided) or `removed`, as the database derives it from the measures that moderators' decisions recorded; nothing else writes the state, and the API's role cannot. A withheld or removed post is shown to its author alone, with a chip ("Under review" in amber, "Removed" in red) that names the rule or says "illegal content" and links to the decision's statement under Settings, Cases; everyone else finds it in no list and gets `not_found` for it.

## Images
Posts, replies and quotes can carry up to four images, and every image needs a description of up to 1000 characters. The web composer takes JPEG, PNG, WebP, AVIF and still GIF files up to 20 MB, and refuses HEIC with advice to export a JPEG.

- **Nothing of the original is kept**, but, while the known material check is switched on, three hashes of the file as received, deleted with the image or when the check is switched off; a match record keeps one of them for 180 days (Automated tools). The upload goes to the `media-uploads` volume, a separate worker container decodes it and writes fresh WebP files in two sizes (1024 and 2048 pixels on the long side) without any metadata to `media-store`, and the original is deleted once the image is ready.
- **The worker is boxed in**, and while the R1 check is switched on it also rates the decoded pixels, still without a network; this build computes no perceptual fingerprint. It has no network, no credentials and no capabilities, runs as a non-root user on a read-only file system within 768 MiB, one CPU and 64 processes, and only reads `media-uploads`. Decoders outside the allowlist are blocked, and the pixel count is checked from the header before decoding: 50 MP, 16 MP for AVIF, 16383 pixels on a side.
- **Formats can be switched off** without a deploy, for example while a codec advisory is open: remove it from `MEDIA_FORMATS` in `infra/.env` and restart `api` and `worker`.
- **Who sees an image** follows its post and, since moderation cases, its own state: anyone when the post and the image are both visible, cached publicly for at most a minute in a browser and five minutes at the edge (The edge); only the author when either is withheld or removed, never cached, while everyone else reads "Image hidden by korbat moderation" in its place on a visible post; nobody when the image is sealed (reported as child sexual abuse material, Moderation), its author included, who reads "Sealed: not shown to anyone, you included" in its place; nobody once its content or its post's was erased or the post is deleted. A deleted post's files leave the disk at once, except images that a moderation case holds as evidence or that an unanswered report of child sexual abuse material or a seal freezes: their rows and files are kept, served and listed to nobody and exported to nobody, and the retention job deletes them once nothing retains them.
- **Behind Cloudflare**, set the zone as The edge says, or browsers keep images for four hours whatever the server says.

## The edge

A public image is served with `Cache-Control: public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`, on the 200 and on the 304: a browser keeps a copy for at most 60 seconds and an edge for at most 300, and neither serves a stale one. Every other answer of the API is `no-store`, the 404 of an image included, and an author's own hidden image is `private, no-store`. When an image stops being public (a measure, an authority's order, the author's deletion, the account's purge, an erasure, a release), the database writes a row of `edge_purges` in the same transaction, whoever wrote the change, and the API's job `edge-purge` drains the rows after the commit. With `API_EDGE_PURGE=off`, the default, each row closes as off and the header is the only bound. With `API_EDGE_PURGE=cloudflare` the job asks the provider to drop the image's copies by prefix (`<host>/api/media/<id>/`, both sizes and every query string), up to 30 images a request and one request a round, 15 seconds after the last round ended; a purge that is not taken is sent again later, the wait doubling up to an hour, and after 24 hours it is recorded as failed and every staff account is alerted ("A cached copy could not be dropped"). A purge never delays or undoes a measure, and an accepted one is no proof that every edge node dropped its copy: the header stays the bound. A case prints the outcome beside each of its images, and an order's screen beside each disabled item.

Before it is switched on, the owner runs the lab on the zone and notes what it shows: what the edge does with `max-age=0` beside `s-maxage`, and a purge sent while the edge answers `MISS`. Switching it on: set `API_EDGE_PURGE=cloudflare`, `API_EDGE_ZONE_ID` (the zone's id), `API_EDGE_API_TOKEN` (a token with the one permission Zone, Cache Purge: a secret, which no log line, audit row or answer holds) and `API_EDGE_HOST` (the public hostname of the images, without a scheme) in `infra/.env`, then `docker compose -f infra/compose.yml up -d api`. The API refuses to start with `cloudflare` and one of the three missing, and with `test` while `APP_SITE` is open.

In the zone: Browser Cache TTL "Respect Existing Headers"; no Edge Cache TTL rule on `/api/media`; Always Online off; a token with the one permission Zone, Cache Purge. The check, once, with a test post: read the image through the public hostname until its header shows a cache hit; hide the image in the console; read the case's line "Edge copy: purge accepted"; read the image again and see that the copy is gone. Note the seconds.

## Explore
A ranked list of recent original posts, the third tab of Home (`/?tab=explore`). Its whole formula is published at `/explore/about`, printed from `EXPLORE_V2` in `packages/contracts/src/explore.ts`, the constant the ranking itself uses (formula version 2, since account sanctions); changing any number means a new formula version with a dated entry in its change log.
- **What is ranked.** Visible top-level posts that are not quotes, from the last 48 hours, by live accounts that are not suspended at the round's time and have not switched Explore off. A post that a decision hid and a later decision restored gets back the hours it was hidden: its window and its age count from `explore_from`, its creation time moved on by those hours, which only the database's writer of a post's level sets. Replies belong to their threads, and quotes stay out so that a mocking quote cannot put its target's post on a public page.
- **What counts.** Approving accounts: the distinct accounts other than the author that liked or reposted the post, each at least 48 hours old when it did, still live and not suspended at the round's time, the like or repost at least 10 minutes old. The score is approving accounts / (hours since posting + 2)^1.8; a post needs at least 3; one account has at most 2 posts in a ranking of 300. Replies, quotes, followers, the badge and reports are never read.
- **The refresh.** The API's `explore-refresh` job ranks at start and every five minutes under the shared job lock, and a round within 4.5 minutes of the last writes nothing, however many instances run. Each ranking is a numbered generation in `explore_runs` and `explore_items`; the two newest are kept so a reader can finish paging, and a round logs only its generation, its counts and its milliseconds.
- **Reading.** `GET /api/timeline/explore` shows only the order, never a score, count or position. Its cursor names the ranking and the last post read; a pruned ranking answers 409 `explore_refreshed`, and the app goes on from the newest ranking without repeating a post. Moderation states, the author's switch or deletion, blocks in both directions and mutes apply at every read. Signed out: the first 20 posts and no cursor. Every answer is `no-store`.
- **Authors.** Settings > Privacy has "Show my posts in Explore" (`POST` and `DELETE /api/me/explore`, on by default): off takes the posts out at the next read, on brings them back at the next refresh. `GET /api/posts/:id/explore` tells the author alone whether a post is in Explore and which rule keeps it out, never with a count, and the author's listed posts show "In Explore".
- **Tests.** A ranking is a function of the time it is computed at, so the integration suites rank in past epochs of their own (2020 to 2023), each test in its own span after emptying `explore_runs`.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account, staff sessions included, is revoked and the change is written to the audit log. Since account sanctions, grant-role refuses to make staff an account that holds a suspension, a termination or a restriction of reporting that stands and has not ended: it says so, changes nothing and exits 1, and an admin lifts a wrong measure with a correction first. Moderators and admins act only on the staff console, with a staff key; two-factor authentication in the app opens nothing there, though a staff account cannot turn it off once it is on.

## Staff console
The staff console (`apps/admin`; design `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`) is a page on an origin of its own, `API_CONSOLE_ORIGIN` in `infra/.env`, served by Caddy's second site (port 8090 in its container), which proxies only `/api/staff/*` to the API. Empty, the console is off: every `/api/staff` path answers 404, and the page says that the console is not available at this address. Only a staff key opens it. It holds sign-in, enrolment, a home screen (every staff account's sign-ins of the last 7 days, your staff sessions, your keys), the audit log and, since sub-project 3c, the moderation cases: the queue, the case page with its decision composer, and the appeals (Moderation, below, with the commands 3c added). Keys are enrolled, listed and revoked, and the record is checked, on the server:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>        # a one-time link that registers one staff key
docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]             # an account's staff keys, or every staff account with its keys
docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>    # that key and every staff session it opened
docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> all         # every key, staff session and unused enrolment link of the account
docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head                 # the audit log's newest place, hash and time
docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]   # the whole chain, against the places kept
```
Each command waits at most 10 seconds for a lock. One that gives up has changed nothing and says so: an open transaction holds the audit head or the account's row, so stop the api service (`docker compose -f infra/compose.yml stop api`) before running it again.

- **Staff keys.** A staff key is a WebAuthn credential registered on the console's relying party ID (`API_CONSOLE_RP_ID`; empty means the console's hostname) whose authenticator reported user verification and no backup eligibility when it was registered, and reports user verification without the backup flags at every use. A personal passkey never opens the console and a staff key never signs in to the app; passwords, email codes, two-factor and recovery codes never give staff powers. Keys are added only through enrolment links the command line issues as the migrator, which the database enforces, and an account holds at most 5 live keys. No console route adds or revokes one: `staff.js revoke` revokes keys, grant-role revokes them on a change to `user`, an account's deletion revokes them, and a key whose signature counter goes backwards is switched off together with every staff session it opened. A key's row is never deleted, because `audit-verify` checks old confirmations against its public key; a deleted account's keys keep no name, AAGUID or transports.
- **Enrolment.** `staff.js enroll` runs in the migrate service, as the migrator, the one role the running API never holds. It prints a link to `<API_CONSOLE_ORIGIN>/enroll/<token>`, valid 30 minutes and once, for a live account that is staff, has a handle and holds fewer than 5 live keys, and refuses while the console is off. Whoever holds the link can register a key for that account, so hand it over by a channel you trust. The person opens it on the device that holds the key, names the key (the key and the console show the name, so not an email address or a real name), and chooses "Register a security key" or "Use Windows Hello on this computer"; a refused key leaves the link working until it expires. The owner is mailed every key added. A link issued before a `revoke ... all`, a role change, a deletion or a move of the console enrols nothing.
- **Sessions and confirmations.** A staff session lasts at most 12 hours and ends after 15 minutes without an action by its person (a click, a submitted form, a screen opened); the console warns two minutes before the idle end with "Stay signed in", and nothing moves the 12-hour end. It is read from the database at every request, so a revocation, a demotion, a deletion or a switched-off key ends it at its next request. Every new staff session is mailed to its owner, and every staff member's home screen lists every staff account's sign-ins of the last 7 days: a sign-in nobody recognises means someone else holds a staff key. An action that changes something asks for the session's own key again, for that action, its target and its parameters only ("Sign out that session", every decision on a case, every review of an appeal and every reveal of who sent a report), and its row in the audit log keeps the key's signature. Three things a moderator does on a case ask for no key, since none of them restricts or releases anything: saving a text (it enters the record only when a confirmed decision or reveal names its digest), taking a fresh snapshot, and opening a case on their own finding (limited per day, and counted on the home screen).
- **The audit log and its head.** The audit log is the record of every staff action: enrolment links issued and cancelled, keys added and revoked, sign-ins, sign-outs, session revocations and role changes, each written in the same transaction as its change, and since 3c every decision, every review of an appeal and every reveal, each link, unlink and change of the limits the command line makes, each read of an account's facts and each drafted access request, and each erasure of the retention job. A moderation row holds ids, kinds, times and salted digests only, never a text anyone typed. It is a hash chain: the database gives every row its place (`chain_seq`) and a hash over the previous row's hash and the row's content, so a row changed later changes every hash after it. The console's audit page lists the rows newest first with their place and hash, with "Load older" and "Go to place". `audit-head` prints the newest row's place, hash and time (`<chain_seq>:<hash> <time>`); a kept place is its first word. `audit-verify` recomputes every hash in its own code, never asking the database for one, checks every stored confirmation against the public key, origin and relying party ID of the key it names, and checks every kept place given to it; it exits 1 naming the first rows at fault, and says how many rows follow the newest kept place. It needs no secret and runs the same with the console off or moved.
- **Making staff.** The person creates a korbat account of its own for staff work, at an address of its own (an alias of their mailbox will do, so the staff mails reach them), and chooses a handle unrelated to their posting handle; that account is used only for the console. It has a public profile under that handle, empty but visible in the app. The operator runs grant-role with `moderator` or `admin`, then `staff.js enroll` once per key, for two keys. The first admin is the operator, made the same way on an account apart from their posting account.
- **Offboarding.** `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> user` revokes the account's staff keys, staff sessions and unused enrolment links, and mails it the keys' names; a person made staff again enrols new keys. A change between `moderator` and `admin` ends the staff sessions and unused links and keeps the keys. A lost key is revoked with `staff.js revoke <email> <key id>` and replaced through a new enrolment; there is no self-service recovery.
- **Which keys work.** Out of the box only Windows offers a device-bound platform key (Windows Hello). On macOS, iOS, iPadOS, Android, ChromeOS and Linux the platform's own passkeys are synced, so a staff key there must be a FIDO2 security key with a PIN. On Windows a browser's password manager may offer itself before Windows Hello, and its passkeys are refused. A phone's own passkeys cannot serve, though a phone's browser can use a security key. The approved authenticators are a FIDO2 security key with a PIN and Windows Hello on a computer with a TPM, and each person holds two: two security keys, or Windows Hello on one computer and a security key. A new security key needs a PIN; when the browser does not offer to set one, set it in Chrome or Edge under Settings, Privacy and security, Security, Manage security keys, on Windows under Settings, Accounts, Sign-in options, Security key, or with the app of the key's maker.
- **Reading `staff.js keys`.** With an address it lists that account's keys; without one, every live account whose role is not `user`. Each account's line gives its role, address, handle and id; each key's line gives its id (what `revoke` takes), its name as a quoted string, its AAGUID, when it was created and last used, and whether it is live, revoked, or revoked and suspect (its counter went backwards). After an account's keys comes the line `linked personal accounts: <n>`: how many personal accounts `staff.js link` recorded for it, never which (Moderation, The limits on staff). The AAGUID is the make and model the authenticator reported about itself, unsigned, since no attestation is asked: all zeros when the browser or the authenticator withheld it, `none` once the account's deletion blanked it. It shows what kind of authenticator registered the key without proving it, and a key whose AAGUID names a password manager is revoked.
- **A refused passkey.** When enrolment refuses a synced passkey or one that asked for no PIN, the password manager has already saved it. Where the browser can (Chrome and Edge 132 and later, Safari 26) and the console's relying party ID is not the app's, the page asks the browser to drop it. Otherwise the page says so, and the person deletes the entry for the console's hostname from the password manager's list of passkeys by hand. In development both relying party IDs are `localhost`: pick the entry by the key's name, so the app's own passkeys stay.
- **Staff mails.** None carries a link, and each ends with the sentence "korbat never puts a link in a staff email", so a staff mail with a link is a fake. "A staff key was added to your korbat staff account" is expected after your own enrolment; otherwise tell the operator at once, who revokes that key. "A staff session started on the korbat console" is expected after your own sign-in; otherwise someone holds that key: tell the operator at once, who revokes it with `staff.js revoke <email> <key id>`, which ends every session it opened. "A staff key on your korbat staff account was switched off" means a use of the key looked like a copy of it: ask the operator for a new enrolment link, and say whether you used the key just then, since if you did not, someone else holds a copy. "Staff keys revoked on your korbat staff account" follows an offboarding, a demotion, a revocation by the operator or a restore; if you did not expect it, ask the operator why. Signing out, or signing out one of your own sessions, sends no mail.

The runbook:

- **After each enrolment** the person presses "Sign in with this key" on the enrolment page, which signs in with the new key and no other. A key that does not open the console is revoked (`staff.js revoke <email> <key id>`) and the operator told: an API under someone else's control could have stored a key of its own in its place, under the person's name, and `staff.js keys` would not show the difference.
- **After any API incident** (the API's code, image or host was, or may have been, under someone else's control), stop the api service first: `docker compose -f infra/compose.yml stop api`. Run grant-role for every staff account with the role on your own list of staff: it sets back any role the API changed and ends every session and staff session, keeping the keys. Compare the accounts and addresses `staff.js keys` lists with that list; an account or an address that is not on it is made `user` with grant-role until it is explained. Once the API runs again from a clean image, run `audit-verify` with every kept place, and read the record's key and enrolment rows (`staff_enrollment_issued`, `staff_key_added`, `staff_key_revoked`, `staff_enrollments_cancelled`) on the console's audit page. Then each person signs in once with every key listed for them, and any key that does not open the console is revoked: `staff.js keys <email>` shows which listed key no sign-in used.
- **The kept head.** Each day after the dispatch hour the API publishes the head's daily value on `/transparency` and mails it, with its place and hash, to the keeper at `API_HEAD_KEEPER_MAIL` (sub-project 3d; The yearly edition). The keeper's daily visit stays, since only the keeper holds the place: each day the keeper, the staff member who does not run the server, copies the newest place and hash from the console's audit page and, on the same visit, opens the place kept on the previous visit with "Go to place" and checks that it still shows the kept hash. A change that recomputes the chain changes the hash at every later place, so the newest kept place covers every row before it. After each deploy and each week the operator runs `audit-verify` with every place the keeper has kept. Since sub-project 3f the keeper also presses "Download since my last copy" on the same visit (Authorities' orders, The daily copy).
- **Moving the console** means enrolling every staff key again. Keys are bound to the console's hostname, and each records the origin and relying party ID it was enrolled for, which the API holds it to. After the move (a new `API_CONSOLE_ORIGIN`, the tunnel's console hostname, then `docker compose -f infra/compose.yml up -d api`, which recreates the API with it), run `staff.js revoke <email> all` for every staff account, since the old keys open nothing but still count towards the five, then `staff.js enroll` for each key again; links issued before the move are refused. `audit-verify` goes on checking old confirmations against the values recorded on each key.

## Moderation
Moderation cases (sub-project 3c; design `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md`) take reports and notices from anyone, signed in or not, put each named target into exactly one open case, and let staff decide the case on the console. A decision is its own statement of reasons. Every restriction of a post, an image or a profile field is derived by the database from the measures that decisions recorded, each decision confirmed with the deciding person's staff key in the same transaction; the API's role can write no moderation state. Six commands of `staff.js` belong to it:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js link <staff email> <personal handle>      # record that the personal account is this staff member's own, for the recusal check
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js unlink <staff email> <personal handle>    # take that record back
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js limits <decisions per hour> <decisions per day> <case opens per day> <findings per day> <reveals per day>   # set the limits on staff
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js notification-facts <record>                # the handle, address and creation time of the account a report to the authorities concerns
docker compose -f infra/compose.yml run --rm api node dist/staff.js text-verify                                   # what the record names against what korbat holds
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js access-request <@handle>                   # the moderation part of an answer to a GDPR access request, as JSON
docker compose -f infra/compose.yml run --rm api node dist/staff.js access-request <email>                        # the same for a notifier's address
```
`link`, `unlink`, `limits`, `notification-facts` and `access-request` for a handle run in the migrate service, as the migrator, as `enroll` does: only the migrator reads whether an authority asked that a person is not told; `text-verify` and `access-request` for an address run in the api service, whose keys open a notifier's contact. Each waits at most 10 seconds for a lock, each but `text-verify`, which only reads, writes its audit row in the transaction of what it did, and each exits 1 with a message when it changed nothing it was asked to.

- **Reports and notices.** Anyone can report a post, one image of a post or a profile, from "Report" on it or with its link on the app's `/report` page, signed in or not (`POST /api/notices`). The form has three grounds of equal weight: "It breaks a korbat rule" (R1 and R3 to R6), "It is illegal" (a notice under Article 16 of the Digital Services Act, with a category, an explanation, an optional law or country and the good-faith statement), and a third for the sexual abuse or exploitation of a child, child sexual abuse material or grooming, which is anonymous: korbat records neither the account nor a contact for it. A signed-out sender passes the human check and, with a notice of illegality, may leave a name and an email, which the auth module keeps encrypted under `API_NOTIFIER_ENC_KEY`; no staff screen shows the address, and the name only after a reveal. One report names up to 10 links (on the third ground at most one profile); one network may send 5 an hour and 20 a day without an account, one account 10 an hour and 50 a day, and a request counts also when korbat then refuses it (a link that is none of korbat's, a target the account already reported). Every report gets a reference (`N-` and ten characters). An account follows its reports under Settings, Cases, Your reports; a signed-out sender gets a link to the status page, `/notice/<reference>`, whose token stands after the `#`, where no server log sees it: one link on the success screen, shown only then, and, when an email was given, another in the receipt (`notice_received`). Each named target becomes an item in the one open case of its post or account; a link that names nothing live is answered automatically. Outcomes are released once a day, at `API_MODERATION_DISPATCH_HOUR` (UTC), so that nobody can tell from a mail's minute when a decision was made, and each address or account gets at most one update a day (`notice_update`). A moderator who finds something themselves opens the case with "Open a case" on the queue screen: a finding cites a rule, never the law, and sends no receipt.
- **The queue and its lanes.** Open cases are ordered by lane and then by the age of their oldest unanswered item, and by nothing else: no count of reports and no standing of a reporter weighs. Lane 0, "Urgent": the third ground, rules R2 and R5, and notices of illegality in the categories violence, risk for public security and self-harm. Lane 1: rules R3 and R4, and notices in the categories data protection and privacy violations, cyber violence, cyber violence against women, illegal or harmful speech, protection of minors, and "I am not sure". Lane 2: everything else. A case takes the most severe lane of its unanswered items; on a rule report or a finding the rule alone decides the lane. The response times are 24 hours in lanes 0 and 1 and seven days in lane 2, counted from the case's oldest unanswered item. They are targets for a team of one or two, not promises. Every staff account gets the queue-age mail (`moderation_waiting`), at most once in 24 hours, when a case passes them or when a measure taken while deciding is older than 24 hours, whatever its lane, since its author cannot appeal it until the case is decided. A row of the queue is marked "notice under Art. 16", "CSAM: no images", "re-examination" or "deferred" where that applies, and the page reads the queue again every 60 seconds without keeping the staff session alive.
- **Possible coordinated reporting.** A case whose unanswered reports include at least 5 from 5 signed-in accounts within 60 minutes, at least half of them following or followed by another of them, shows the chip "Possible coordinated reporting" in the queue and a line under its header with the two counts, never who reported. It is a hint and nothing more: it is computed at each read and stored nowhere, it orders nothing, no decision reads it, and it goes dark once retention forgets the reporters. An item also says how many other open items its signed-in reporter has elsewhere, as a count. Decide the content as always; 3e's mark "manifestly unfounded" answers one reporter's many reports.
- **Deciding and the preview.** The case page shows the case's copy of the target (a snapshot: text by copy, images by reference, each image drawn only after "Show image"), its items with what each sender wrote in a frame, a summary of each source in bands (never a name, an address or a count), the earlier decisions and the notes. Every read of a case, every image viewed and every reveal is written to an access log that the home screen sums up for all staff. The composer lists the outcomes the person may choose, "Restrict", "No breach" or "Illegality not evident"; a restriction is taken "While deciding" (a measure that lasts until the case's final decision, cannot be appealed and is told to its author at once) or with "Decide the case". The measures are "Withhold the post", "Withhold one image", "Seal the images this case reaches", "Reset display name" and "Reset bio" while deciding, and "Remove", "Remove one image", the seal and the two resets when the case is decided; a decision under a rule names the rule, one on the law the legal reference. The facts, the reason and the legal reference are saved as drafts when their field loses focus and enter the record only when the key confirms a decision that names their digests; they never hold personal data of anyone but the author. Under them stands "Preview: the statement as its author will receive it", rendered by the code that renders the mail and the author's screen, from the rulebook version the decision records. "Confirm with your staff key" records the decision with its audit row or not at all; a case that changed behind the page (`case_changed`) is read again and confirmed again. The author gets the statement by mail at once (`moderation_decision`) and reads it under Settings, Cases, About you. A final decision on a case that holds a report or finding of child sexual abuse material or an item citing R5, or that cites R2 or R5, whatever its outcome, is an admin's, and so are every lifting of a seal and every correction of such a decision; any moderator may withhold such content, or seal reported images, while deciding. A final restriction of a staff account is refused (`staff_target`), and a person is refused a case (`staff_recused`) when their own account or one linked to them takes part in it or is close to someone who does; the runbook has a bullet for each.
- **Measures on content that is already not shown.** A decision can restrict what nobody sees any more: a post another case already removed, or one its author deleted. The composer says so ("This changes nothing anyone sees now"). The measure is recorded as a measure of its own, its author is told (not for a measure taken while deciding on a deleted post), and it is in force should the other restriction be reversed; the statement says that it changed nothing anyone sees.
- **The limits on staff.** One staff account confirms at most 60 decisions an hour and 300 a day, which the database counts and refuses beyond (`decision_cap`), opens at most 400 different cases a day, opens at most 50 findings a day and makes at most 10 reveals a day; a day is the UTC day, and those are the numbers of a new database. All five are set with `staff.js limits`, in that order, each a whole number from 1: `staff.js limits 60 300 600 50 10` prints `limits: set to 60 decisions an hour, 300 decisions a day, 600 case opens a day, 50 findings a day, 10 reveals a day. Keep these numbers in your own records: a restore brings back the ones of its backup.`, and exits 1 with `the limits already are ...; nothing changed` when all five were already set. Every staff account is mailed when one account confirms 20 decisions within 15 minutes (`moderation_burst`, at most once an hour for one account) and when one reaches the day's limit on cases (`moderation_reads`). Every reveal (`moderation_reveal`), and every decision that lifts the protection of reported images (`moderation_csam_lifted`: a lifted seal, or an admin's answer to a report or finding of child sexual abuse material without a seal), is mailed to every staff account, without a throttle, and listed on every staff member's home screen for 30 days. A staff account's own personal accounts are recorded with `staff.js link <staff email> <personal handle>` and taken back with `unlink`; the database then refuses that person every case in which a linked account takes part or is close to someone who does. Only the count of an account's links is ever printed (`staff.js keys`), and the audit row of a link names the staff account and nothing of the link.
- **Reveals.** Staff see a source as a summary, never as a person. "Reveal who sent this" on an item shows the reporter's handle or the name a signed-out notifier gave, never an address, after the person chose why ("A claim of impersonation", "Abuse of reporting", "A legal requirement" or another reason), wrote the reason in their own words and confirmed with their staff key. A reveal cannot be undone. Nobody can be revealed for a report on the path for child sexual abuse material, which records no sender, for a finding, or for a sender whose name is no longer kept (`reveal_refused`).
- **Appeals and the one-moderator rule.** The person a final restriction is about can appeal it once, under Settings, Cases, for six months after being told and while any of it is in force; what korbat did while deciding cannot be appealed and ends with the case's final decision. The console's Appeals screen lists the appeals that wait. A reviewer made none of the case's decisions, opened no finding in it and is not close to anyone in it, which the database enforces (`reviewer_conflict`); the review of a decision that cites R2 or sealed images is an admin's. The review answers "Keep", "Reverse in part" or "Reverse", with a reason, and its statement goes to the author. With one staff account that could review it, an appeal waits, without a time limit: the home screen counts the appeals that have no possible reviewer now, the appellant reads "korbat has one moderator at the moment", and the operator makes another person staff. With one admin and one moderator, every R2 or R5 case that the moderator withheld or sealed while deciding, or opened as a finding, and the admin then decided leaves its appeal without a reviewer in the same way.
- **Re-examination.** Whoever reported can ask once for each item, within six months of being told, for a re-examination of a decision to take no action ("no breach found" or "illegality not evident"): on the status page their receipt links to, or under Settings, Cases, Your reports. It is decided again as a new report: a new item in the queue, marked "re-examination". The database does not keep the person who decided the first time from deciding again, so when the item re-examines your own decision (the case page says "You decided the item this re-examines. Leave it to another staff member when there is one.") and another staff member exists, leave it to them. An answer given while nobody could open the post's images does not spend the request. A decision given on re-examination is final within korbat.
- **Evidence and retention.** A case keeps its own copy of what was reported: the text by copy and the images by a hold on their rows, so that neither the author's deletion, the account's deletion nor the sweeper takes them while the case needs them. Each kind of data is then erased on its own schedule, by the `moderation-retention` job (every 10 minutes while `API_MODERATION_RETENTION` is `on`) and, for notifiers' contacts, by the auth janitor; the periods are the contracts' `RETENTION`, which the terms publish. A case's copies (snapshots, notes, the appellant's statements, the holds) go once the case is closed and every restriction of it is final for its author (the appeal answered, or six months passed), and not before 24 hours after the case's newest copy or draft; the old value of a reset field stays readable 30 days after the reset stopped being in force. The record of a report (its explanation, the cited law, who sent it) goes 30 days after everything korbat owed it was done, and who sent it also when the reporter's account is deleted. Content restricted under R4 is erased once the restriction is final, the chip and the reason kept. Statements stay while the account exists and 12 months after its deletion. A draft that no decision confirmed is deleted after 24 hours; the access log and the reasons of reveals after 12 months. A notifier's name and address go six months after the last day korbat owed the notice a decision, a mail or a changed outcome, 13 months after the notice at most when nothing moved it; a confirmation of an address after 30 days. A mail still unsent five days after it was due is given up. Decisions, measures, items and appeals stay as rows for good, like the audit log, with ids, handles, kinds, times and salted digests only. While a report or finding of child sexual abuse material about a post or its author's account is unanswered, and for as long as a seal stands, no image and no snapshot of that post is deleted or erased by anything; sealed images are released only by sub-project 3d.
- **The emergency switch.** When a flood of reports from unproven sources fills the queue, set `API_MODERATION_DEFER_UNPROVEN=on` in `infra/.env`, then run `docker compose -f infra/compose.yml up -d api`, which recreates the API with it, since the API reads it at start; `off` and the same command end it. While it is on, a case whose unanswered items all come from unproven sources is listed after the others of its lane, never below a less severe lane: in lanes 1 and 2 a report sent without an account or by an account under 48 hours old, in lane 0 only one sent without an account. The terms publish the switch, the home screen says whether it is on, and the queue marks such a case "deferred".
- **The mails.** People who report get `notice_received` ("korbat received your report <reference>") and at most one `notice_update` a day ("Decisions on your reports to korbat"); authors get `moderation_decision`, the statement itself, under a subject of its kind ("A post of yours is under review on korbat", "korbat restricted a post of yours", "korbat sealed images of yours while it decides", "korbat answered your appeal" and five more). Each ends with "korbat staff never ask for your password or a code, and korbat does not read replies to this email.", and no mail to an author carries a reporter, a report's words or a count. The staff mails go to every staff account, carry no link and no content, and end like 3a's. The urgent-lane alert (`moderation_urgent`, "korbat: a case is waiting in the urgent lane") goes when an item enters lane 0 and repeats about every 20 minutes until a decision answers the item or withholds the post in the interim; on a post already withheld, removed or deleted by its author, and on an account case, it stops once someone saves a note on the case after the item arrived, normally the Art. 18 check, and the case then waits for its final decision, an admin's for a report or finding of child sexual abuse material and for an item citing R5, under the queue-age mail. On a report or finding of child sexual abuse material whose case reaches an image that is still served it repeats until the images are sealed, someone records that they do not seal, or an admin answers, and starts again when an image is posted afterwards that the case reaches; where its case reaches no served image, a note or a decision taken while deciding ends it too. `moderation_waiting` ("korbat: cases are waiting longer than their response time") is the queue-age mail. Since sub-project 3f each also goes to the phones as a push that names nobody, the urgent lane's to the phone on call and the queue-age reminder to every staff phone, and their own last sentence says so; a mail by itself wakes nobody. The other four staff mails are those of The limits on staff.
- **`staff.js text-verify`** proves that what the record names is what korbat holds, as `audit-verify` proves that the record was not rewritten. It reads only, in one transaction: every digest in a confirmed row (a decision, a review, a reveal) must name a text or a snapshot that korbat still holds and that recomputes to it, or an erased one; every decision must be named by exactly one such row, with the same actor, target, params and measures; and every post's level and every image's state must be what the ledger of measures gives, with every post a seal in force lists still holding the image rows the seal recorded. It prints `text-verify: what the record names is what korbat holds: <n> confirmed rows, <n> decisions, <n> posts, <n> images and <n> seals in force`, or `text-verify: FAILED` with the number of problems and the first 20, and then exits 1. A failure means a change made around the triggers, by the migrator or by hand, or rows lost in a restore. It is run with `audit-verify` after each deploy and each week (the runbook's last bullet).
- **`staff.js notification-facts <record>`** (since sub-project 3f, in place of `account-facts`) prints `handle:`, `email:` and `created_at:` for the account a record of a report to the authorities concerns, and the ids and times of the record's posts, then the sentence of what korbat does not hold, and records the reading as a production. It takes only a record that is owed, which `staff.js records` lists: one a seal for good opened, or one `notification-open` opened for an Art. 18 check. No console screen shows an address: this command is how the operator reads one, while the report hold keeps it (Authorities' orders, Notifications and hand-overs).
- **`staff.js access-request <@handle | email>`** drafts the moderation part of an answer to a GDPR access request and prints it as JSON, for the operator alone; its audit row (`access_request_drafted`) carries counts only. For a handle: every case about the account or its posts, with its items' source kinds, grounds, rules and categories, the snapshots while held, every decision with its statement, the account's appeals, and the account's own reports as in its export. For an email: the notices filed with that address as contact. It never prints who reported: each reporter's and notifier's identity is listed as withheld, each report's explanation is marked to be sent only after a person has weighed the writer's rights, and every case that holds an urgent-lane item is marked for a check of the R2, Art. 18 and order records first. The runbook says how the answer is made.

Account sanctions (sub-project 3e; design `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md`) act on an account, and never by themselves: each is a measure of a final decision that a staff key confirmed, and the database decides whether it can stand, when it starts and ends, and what it means; no job and no clock adds one. Their numbers are `STANDING_RULES` in `packages/contracts/src/moderation.ts`, equal to the database's `standing_rules()` (a test compares them), and the terms publish them in the sections Strikes, Suspension and termination, Reporting in bad faith and Handles.

- **Strikes.** A final decision that a post breaks a korbat rule gives its author the strike the database computes, which counts for 90 days from the decision: none for a decision on the law alone, under R2, about a profile field or taken while deciding, at most one a post, and none for a post made before its author was told of their newest strike. The composer signs it, and the database refuses a decision whose strike is missing or not due (`strike_mismatch`). It falls only with its whole finding: a review or a correction that reverses the decision overrules it.
- **The ladder.** With 3 active strikes, at least one of them newer than the account's last suspension under the ladder, a moderator may announce a suspension of at most 3 days, then 7, then 30, by the number of the ladder suspensions decided in the last 365 days; after the third, an admin may announce a termination. After a suspension one further strike opens the next step. The moderator opens a finding on the account and decides on its case. A ladder suspension ends at once when an overruling leaves fewer than three of its strikes standing.
- **Announced suspensions and the reply.** A suspension or a termination of the ladder is announced: its statement is the notice, shown in the app at once and mailed. The suspension starts 168 hours after korbat's relay accepted the notice mail, or 336 hours after the decision when the relay refused the address or the mail was given up, and never earlier; while the mail's outcome is unknown it has no start. The person may reply once, from the decision's screen (`POST /api/moderation/decisions/:id/reply`). A reply sent before the start holds it until staff answer: "Keep" (a correction that keeps the decision) starts it at the later of the answer and the announced start, and the six months to appeal then count from that answer; "Reverse" lifts it. A reply sent later is answered the same way and holds nothing. One suspension or termination stands at a time (`standing_conflict`).
- **Suspensions at once.** Only an admin takes one, on an account case, and only on four grounds the database checks: a final R5 decision restricting a post of the account, at most 30 days old (up to 30 days), terrorist content likewise (up to 30 days), a flood under R6 that the admin finds, its floor at least 20 posts in the last 60 minutes (up to 7 days), and a protective suspension on a seal for good of the account's images at most 30 days old, once for that seal (up to 14 days), which is no finding and gives no strike. A termination at once is open only for a second threat, posted after the person was told of a suspension for the first. korbat aims to answer a reply to one within 24 hours, and the queue-age mail counts the replies that wait longer.
- **While suspended.** Every write of the account as an author or an engager is refused with `account_suspended`: posts, replies, quotes, likes, reposts, bookmarks, follows, profile edits, the handle change, uploads, the badge and reports under the rules. Signing in, reading, its cases, the reply, appeals, re-examinations, the export, deleting its posts or the account, undoing likes, reposts, bookmarks and follows, blocks, mutes and notices of illegal content stay open. Its profile and posts stay visible without any mark, others may still engage with them, and Explore leaves its posts and approvals out. The app shows a banner on every screen, and `/api/me` carries the account's standing.
- **Termination.** Until the decision is final for the person (the six months to appeal unused, or the appeal answered and the decision kept), and while any reply to it is unanswered, a terminated account is suspended and nothing else. Then the `account-purge` job takes it down as a deletion and mails `termination_final` in place of `account_deleted`. A take-down that fails is logged and counted, and never holds an ordinary deletion. A person's own deletion is never refused or delayed by a suspension, a termination or a seal.
- **The restriction of reporting.** Deciding "No breach", a moderator may mark a signed-in person's report under a rule "manifestly unfounded", and the key signs the marks. At least 5 marked reports in 90 days, being at least half of the person's rule reports then, open a warning (R6, on a finding about the account, never as the answer to a report); 3 marked reports sent after it, while it counts (90 days), open a restriction of at most 30 days, which refuses rule reports only and ends with its warning. Both sides count reports, never items, so no single report reaches a number. A mark counts, and the console lists it, only once its outcome has gone to the person in the daily release, when they can read it and ask for a re-examination: a warning or a restriction on a mark set today waits for the next release.
- **Handle retirement.** "Retire the handle", in a final decision on an account case, takes the handle from everyone, its holder included: the profile gets a placeholder that begins with `retired_`, which nobody can choose, and the holder may pick a new handle without the usual wait. "Give the handle back" lifts it.
- **What is kept of them.** The ledger's rows of strikes, suspensions, terminations, warnings and retirements stay as rows for good; their use ends with the numbers above. The `moderation-retention` job erases a reply's text once the reply is answered and its decision is final for the person (its step `reply_statements`), never an unanswered one, and deletes the marks and the daily tallies 90 days after their report's UTC day (its step `report_counts`); both go at once with an account's deletion. The export lists the account's strikes, standing measures, replies and reporting counts.
- **The Standing screen.** `/standing` on the console (`GET /api/staff/standing`) lists the accounts at 3 strikes, the reporting records, the notices korbat's mail service could not send and the terminations waiting for their take-down; the replies to answer stand first on the queue screen.

The runbook:

- **Linking.** Each staff member's personal accounts are linked with `staff.js link` at onboarding and whenever they say they opened another.
- **Reports and findings of child sexual abuse material (R2).** Nobody opens the images such a report concerns, in the console or in the app, before or after a seal, until an admin has answered without one. An image that a match of the known material check names is opened by nobody at korbat at any time, also after an answer without a seal: the console refuses it (Automated tools). After a seal for good, whoever has the server runs `staff.js records` and `staff.js notification-facts` for the record the seal opened, and reports and records it as Authorities' orders, Notifications and hand-overs says; while that report is owed, a deletion of the account keeps its address and nothing else, and the seal never waits for the report. Whoever is on duty opens the case and seals what it reaches with "Seal the images this case reaches", under rule R2, with the composer's drafts, and never writes that the images are such material. They seal unless the report is plainly unfounded, and then record why with "Do not seal now": an earlier answer without a seal was as unseen as this one will be, so it is a reason not to seal only when the report's words add nothing and the case reaches no image posted since that answer (the day of the last earlier answer against the day of the newest post the case reaches, both on the case page) and staff have opened the images since the last answer (the case page shows the day for a post; for an account, a note or the colleague says so); a case that reaches no image cannot be sealed. A report about a post that quotes another has a second case, on the quoted post, linked from the first and sealed the same way. Nobody opens a post's page in the app while a report of this kind about the post is unanswered or its images are sealed: it shows the post it replies to and its replies with their images, which the case does not reach. Nobody opens an account's profile in the app while a report of this kind about the account is unanswered or its images are sealed: it shows posts of other accounts that it reposted or quoted, which the case does not reach, and images posted since the seal; when the page shows images that are not sealed, whoever is on duty seals again. When the post's text links to or offers such material, the post is withheld as well. When the words of a report on another ground describe such images, whoever reads it opens a finding citing R2 on the post before opening any image. While such a report is unanswered, every other procedure about the same images (a report on another ground, a correction, the review of an appeal) is decided on text alone or waits for the admin's answer. A report about a post that is answered without action meanwhile, or while the post's images are sealed, is answered unseen, as the composer says there: its sender is told so and may ask again. An admin answers every such case, all its reports and findings of this kind at once, without seeing the images: seal for good, and report, when the report's words, the post's text or alt texts, or the account's conduct give a concrete reason to believe the report; answer without a seal when they give none; say which it was in the decision's facts; in doubt, ask the operator before answering; never open the images to settle it. On a post's case the admin's answer also answers the reports on other grounds that arrived before the newest report of this kind, unseen; their senders are told so and may ask again (on an account's case such reports concern the display name and bio, which the admin reads). After an answer without a seal the case's images may be opened: whoever is on duty opens the case's target the same day (a post's images in the console, on its case; an account's in the app, which is then the only place they are shown) and, where an image breaks a rule or the law, opens a finding on the post and decides it (if it is what the report said, a finding citing R2, which freezes again). For an account, and whenever a look found nothing, whoever looked writes a note on the case ("Images opened on <date> after the answer of <date>: nothing that breaks a rule"): the case page shows only the day a post's image was last opened in the console, nothing else on the server records a look at an account's images in the app, and the note goes with its case's evidence. When a new report of this kind arrives before that decision is made, the admin's next answer carries the measure for what staff saw, and its facts say when the images were seen. An admin's answer never restricts under another rule on a report's words alone about an image nobody at korbat has opened: that report is answered unseen, and its sender may ask again. An admin who can tell from an account report's words which post is meant opens a finding citing R2 on that post, seals there, and answers the account's item without a seal. An admin seals for good only what korbat then reports: on every seal for good the operator reports at once to the national police or the authority the Member State names, never to a hotline, with, for a post, its address, its times, the author's handle, the account facts and the text and alt texts of its snapshot, and, for an account, the handle, the account facts and the address, time and number of images of each post whose images are sealed, as the case page lists them (never an image). The operator records their reference with the address, the case and the seal's time, off the server, and tells them that korbat keeps the images sealed and destroys them only on their or a court's leave or instruction to destroy, recorded with its reference (Quarantine, A release). A copy for an authority is a hand-over (Authorities' orders, Notifications and hand-overs); a leave or an instruction to destroy is recorded and the images released as Quarantine, A release says, and nothing in the database is changed by hand. An admin lifts a seal for good only on the authority's answer that the images are not child sexual abuse material, and says in the reason that the authority has answered and the date of its answer, never its reference or anything that names a person (the reference stays in the operator's R2 records, off the server); a seal taken while deciding ends with the admin's answer, and before it an admin lifts it, by a correction, only when it was taken in error (on the wrong case, or on a report that the standard above gives no reason to believe). Every staff account is mailed `moderation_csam_lifted` after a lifted seal and after an admin's answer without a seal; the operator checks each against their R2 records and, when one was not expected, follows the mail's steps. A post already removed or deleted has its images sealed all the same (a seal of its own).
- **A seal that lists more posts than the case page shows.** The case page lists at most 500 posts of a seal and then says "use the runbook's query for a seal's posts". The read-only query `select s.post_id, p.created_at, s.images from seal_posts s join posts p on p.id = s.post_id where s.action_id = '<the seal's action id>' order by p.created_at, s.post_id` gives every post the seal lists, with its creation time and its number of images, for the report.
- **A post already removed or deleted.** A notice of illegality or any report about a post that another decision already removed, or that its author deleted after it was reported, is decided on its merits: a finding of a breach is recorded as a measure of its own. A report that arrives after the author's deletion names nothing live and is answered automatically, except a report of child sexual abuse material, which waits for an admin whatever is left of its target.
- **Account sanctions each working day.** Read the lists in this order: the replies to answer first (on the queue screen), then on the Standing screen the accounts at 3 strikes, the notices not sent, the reporting records and the terminations waiting.
- **Answering a reply.** Read the reply on its case and answer within 24 hours, with "Keep" or "Reverse" in a correction of the decision, writing in the reason what was weighed. A reply sent before the start holds the suspension until it is answered, a kept one never starts before its announced time, and a terminated account is not deleted while any reply to its termination is unanswered.
- **A protective suspension.** Only after an admin has sealed images of the account for good, in the case the report is in; then on the account's case, in a decision of its own, only by an admin, once for that seal, for at most 14 days, never worded as a finding and with no promise of a later look. Its appeal is reviewed at once, by an admin who took no part, and does not wait for the authorities; only the seal's own appeal waits. The report to the authorities follows the seal for good with `staff.js notification-facts`, and while it is owed a deletion of the account keeps its address and nothing else (Authorities' orders, Notifications and hand-overs).
- **A breach that lies only in a handle** (impersonation, a doxxed name, a threat) is decided with "Retire the handle" and no longer left open; the display name is still reset when it carries the content. Its Art. 18 note ends the urgent-lane mails.
- **A notice a person did not get by mail.** A person who writes to the contact address about a notice they did not get by mail is pointed to the app, where the notice is always shown and the reply is open; korbat cannot see whether a mail it sent arrived.
- **A measure at once while an announced suspension waits.** To take a measure at once on an account whose announced suspension has not started, use "Withdraw it for another measure" on the announcing decision, then take the measure at once; never "Reverse", which would tell the person that their reply succeeded.
- **A mark that was wrong.** A mark "manifestly unfounded" that was wrong is withdrawn with "Correct this decision" on the decision that set it, which withdraws all of that decision's marks together. Lifting a warning withdraws no mark, so whoever lifts one because its marks were wrong corrects those decisions as well.
- **Reports before an account measure.** Before a suspension or a termination of the ladder, a protective suspension, a warning or a restriction of reporting, decide the reports in the account's open case first: none of these measures ever answers a report.
- **Art. 18 and TCO Art. 14(5).** Whoever on staff first reads a lane-0 case, or any case whose content suggests a threat to someone's life or safety, decides at once whether it gives rise to a suspicion of a criminal offence involving a threat to the life or safety of a person (DSA Art. 18(1); a suicide threat is not such an offence). If yes, or unsure, and they are not the operator, they wake the operator at once, at any hour. They record the check in a note on the case ("Art. 18 check: no suspicion" or "Art. 18 check: operator told at <time>"), and nobody gives such a case its final decision before that note exists; the case page of every urgent-lane case says so above its evidence. If yes, the operator informs promptly, at any hour, (i) the police of the Member State concerned (where the offence is suspected, or where the suspect or the victim lives or is), (ii) when that state cannot be identified with reasonable certainty, the police of korbat's own state, Europol, or both, through the channel obtained beforehand from the national police or the Digital Services Coordinator, and (iii) for terrorist content with an imminent threat to life, the authorities of the states concerned, or else the home state's TCO Art. 12(2) contact point and Europol (TCO Art. 14(5)). The operator sends the content as the case page shows it, its publication time with the time zone, why it is suspected, the account's handle and what `staff.js notification-facts` prints for the case's record (opened with `staff.js notification-open --case <id> --duty <duty>`), and says what korbat does not keep (raw IP addresses, location). Images reported as child sexual abuse material are never sent this way, and are reported as the R2 bullet says. The operator records the authority, the channel, the basis for the state, the time, what was sent and the reference received on the server, with `staff.js notification-sent` and later `notification-answer` (Authorities' orders, Notifications and hand-overs); a check that ends in no is recorded with `notification-declined`.
- **Authorities' orders.** Since sub-project 3f an order reaches korbat at the contact point for authorities, wakes the person on call and is recorded, given effect and reinstated on the console, and every report to an authority and everything handed to one is recorded on the server. The section Authorities' orders is their runbook. An order handled by hand before 3f is entered with `staff.js order-open --received`, as one whose receipt the console cannot take.
- **The yearly count.** korbat publishes its yearly figures itself, on `/transparency`, on or after 1 March (The yearly edition), the orders' figures among them as numbers; `staff.js tco-counts <last year>` still prints, from rows, the figures of the calendar year before, korbat's own decisions on terrorist content and the orders alike, for an authority that asks.
- **The users' contact mailbox** (`WEB_CONTACT_EMAIL`). The operator reads it at least each working day, in a mail client set to load no remote content and to show no inline image or attachment preview. Attachments are never opened, previewed, downloaded or forwarded, and no link in a mail is followed: a korbat link is copied into the report form, never opened. Every report or notice found there is entered through the report form, signed out in a private window, from the mail's text alone, with the sender's links, ground, rule or category, explanation and cited law, and, for a notice that is not on the path for child sexual abuse material, the sender's name and email; the good-faith box is ticked only when the mail states the sender's good-faith belief that it is accurate and complete. It is stored as any report sent without an account, so the sender gets `notice_received` with the status link, the daily `notice_update` and re-examination. A mail that says it concerns the sexual abuse or exploitation of a child, child sexual abuse material or the grooming of a child is entered on the third ground of the form, with the choice its words name ("Sexual images or videos of a child" when they name none) and without the sender's name or email. When the entered report carries no contact (a rule-only report, for which the form asks no name or email, or the third ground), the sender gets the fixed reply with the reference and the status page's link from the success screen. The mail is then deleted with its attachments and removed from the trash the same day; the fixed reply that carries a reference of the third ground is deleted from the sent folder, and from the trash, once sent. A finding is never used for a mailed report or notice: it would say "found by a moderator" and send no receipt or decision. A mail from an authority is handled as the bullet on authorities' orders says, its attachment opened only after step 1 has verified the sender. No report or notice is answered by hand except with the three fixed replies below; the only other mails sent from this address are the GDPR answers (below) and the answers to an authority's order; at most 20 reports can be entered a day from one network (5 an hour), and while Turnstile is down they wait. The fixed replies:
  - asking for the good-faith sentence, or for the form: "korbat received your email. To handle it as a notice that something on korbat is illegal, korbat needs your statement that you believe in good faith that the information in it is accurate and complete. Reply with that sentence, or send your report through the form at <the app's address>/report, which asks for it. korbat's emails never discuss a case."
  - giving the reference and the status link: "korbat entered your report. Its reference is <reference>. To see where it stands, or to ask for a re-examination of a decision, open this page: <the link from the success screen>. Keep the link: korbat cannot show it again. korbat has deleted your email, and deletes this reply."
  - to a mail about a decision: "korbat answers a decision only through its own procedures: the person a decision restricts can appeal it in korbat under Settings, Cases, and a person who reported can ask for a re-examination of a decision to take no action on the page their receipt links to, or under Settings, Cases, Your reports, within six months of being told. korbat's emails never discuss a case."
- **"Illegal on the face of it" and "not evident".** A notice gives korbat knowledge only if it lets a diligent host see the illegality without a detailed legal examination (DSA Art. 16(3), recital 22), and each restriction must be diligent, objective and proportionate, with due regard to freedom of expression (Art. 14(4)). So a notice of illegality has three answers. Illegal on the face of it: restrict without delay on the legal ground, and the statement cites the law. Not illegal: "No breach". Not evident without a detailed legal examination: "Illegality not evident", a lawful answer that leaves the content up until a court or an authority orders otherwise; its sender is told, and can ask once for a re-examination, go to court or complain to the Digital Services Coordinator. It is a liability decision made case by case: should a court later find the content illegal and find that korbat knew, the hosting exemption of Art. 6 is gone for that item, so a moderator in doubt asks the operator before answering. A removal on the law names the law, never a rule, and is counted apart from removals under the rules.
- **The statement's texts** (facts, reason, legal reference, review reason) never hold personal data of anyone but the author: describe it ("the home address of another person"), never copy it, since they are mailed, exported and kept while the account exists, also after an R4 redaction has erased the content. A saved draft that copies it is not confirmed: save a corrected one. The API refuses a text that quotes what a reporter or notifier wrote on the case (`text_quotes_user`).
- **Tools.** Machine translation stays local. The console runs in a browser profile of its own with no extensions, and nothing from it is pasted into third-party tools. The daily limits on cases and reveals are raised with `staff.js limits` when honest work reaches them, and the new numbers go into the operator's records.
- **A `staff_recused` refusal** may mean one of the case's reporters is close to your own account: do not try to learn which, and leave the case to another staff member. When no other staff member can take it (with one staff member, always), the case waits in the queue and its lane-0 and queue-age mails keep coming, and the operator makes another person staff (grant-role and enrolment) to decide it. Nobody unlinks an account, or unfollows, unmutes or unblocks one, to get round a refusal.
- **A case about a staff account's content or profile fields.** Every final restrictive measure on a staff account is refused (`staff_target`): staff are disciplined by demotion. Whoever is on duty withholds the post or image, seals reported images, or resets the field, while deciding, as for any account, and tells the operator, who makes the account a user with `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> user` (which ends its staff keys and sessions), after which a moderator who is not a party decides the case.
- **Mails that wait or were given up.** A count of waiting mails that stays above zero means the relay cannot take mail: check the API log for `MailUnavailable`; if it shows none, the dispatch fails before the send (its daily step, or a contact it cannot read): read the API log for `moderation-dispatch` and fix it the same day. A count of mails given up means the relay answered that an address does not exist (RFC 3463 5.1.1, 5.1.2, 5.1.3, 5.1.6 or 5.1.10), or a mail stayed unsent for five days; korbat does not try it again, the person still sees the outcome on the status page or in the app, and the API log names each one (`moderation: mail given up`). A relay that refuses korbat itself (relaying denied, missing credentials, a sender it refuses, a quota) raises the count of waiting mails instead, with `MailUnavailable` in the log: fix `API_SMTP_URL` or the relay within five days and nothing is lost.
- **Decisions not released, and late erasures.** The home screen shows either count only when it is above zero, with the sentence that stands here. A count of decisions not released means the daily release keeps failing: notifiers are not told and re-examination windows do not open, so read the API log for `moderation-dispatch` and fix it the same day. A count of late erasures names the due rule whose step keeps failing, so evidence, an intake record or a notifier's name and address outlives its published period: read the API log for `moderation-retention` and for `auth janitor: purge failed`, and check that `API_MODERATION_RETENTION` was not left `off` after a restore (the API logs it at every start).
- **A GDPR access request at the contact address.** Confirm that the requester holds the account (a mail from its address) or the email (the answer goes only to that address); run `staff.js access-request`; for every case it marks for the authorities' check, look in your R2, Art. 18 and order records. A case still open with a lane-0 item first goes through its R2 or Art. 18 step. For a case reported to an authority, or one an order concerns, ask that authority whether telling the person now would harm its work, and hold that case's part of the answer until it answers or counsel advises (GDPR Art. 23(1)(d) and the national law that applies; DSA Art. 9(5), 10(5)), within the periods of Art. 12(3); a person decides each item marked for weighing and records why; reply within one month (GDPR Art. 12(3)), saying what was withheld and why; keep the draft with the reply for the period counsel sets, since a withheld item may have to go before the supervisory authority or a court (C-203/22). Any other request under GDPR Articles 16 to 22 at the contact address: confirm the requester as for an access request; answer within one month (Art. 12(3)), saying what korbat did or, when it does nothing, why, and that the person may complain to a supervisory authority or go to court (Art. 12(4)); evidence that a case still needs is kept (GDPR Art. 17(3)(b) and (e), 21(1)). No answer names a reporter or notifier, quotes a report or a notice, or says whether a given person reported.
- **After each deploy and each week** the operator runs `staff.js text-verify` with `audit-verify`.

Records the operator keeps off the server, beside 3a's list of staff: each staff member's linked personal handles, updated at every `staff.js link` and `unlink`; every R2 report with the post's or the account's address, the case, the seal's time and the authority's reference; every act done by hand on sealed files on an authority's written instruction (what, when, on which instruction) that `handover-list` and `handover-record` did not record; and the numbers last set with `staff.js limits`. Since sub-project 3f the reports to authorities with their references, the notifications under Art. 18 and TCO Art. 14(5), the orders received, their verification, the answers sent and what was done are recorded on the server, with the commands of Authorities' orders, and the keeper's daily copy holds them off the server as well.

## Authorities' orders
Authorities' orders, the alert channel, records to authorities and recovery (sub-project 3f; design `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md`) give korbat a contact point for authorities that wakes the person on call, a record of every order with the one-hour clock of a removal order, the measure "Disable for an order" with the author's notice and its hold, the preservation of what was disabled, a record of every report to an authority and of everything handed to one, the keeper's daily copy with which a restore names what it lost, and the yearly counts. The console's screens are Contact point, Orders, an order's page, a case that holds an order's measure and After a restore; what the console cannot do is the server's, with `staff.js` in the migrate service, as the migrator:
```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js order-open --kind <kind> --state <CC> --authority <text> --reference <text> --channel <portal|post|other|mailbox> --link <url> ...   # an order whose receipt the console cannot take
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js order-verify <order> --how <text>       # the check against the register
docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js order-texts <order> --reasons < reasons.txt   # the authority's words (also --redress and --scope)
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js records                                 # the notifications owed and the archives not destroyed
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js notification-facts <record>             # what korbat holds of the account, for the report
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js tco-counts <year>                       # the yearly counts
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js                                         # every command, with its first line
```
Every command waits at most 10 seconds for a lock and says "nothing changed" when it changed nothing; every line it prints starts with its name, but for the JSON that `audit-export` and `access-request` print; an instant is written with its offset (`2026-10-10T01:00:12Z`). A command that reads standard input (`order-texts`, `order-document`, `address-check`, `handover-record`, `restore-import`) needs `-T` after `--rm`, or Compose attaches a terminal and the redirected file fails. `order-open` needs `API_HOME_STATE` and `API_APP_ORIGIN` in `infra/.env`, which the migrate service reads. No command opens an image or sends anything to an authority: the operator sends, the command records. After a restore, every command that writes a record takes `--gap <gap>`, the gap the After a restore screen lists.

**The contact point.**

- The contact point for authorities is a mailbox at an EU mail host, set as `API_CONTACT_POINT`. korbat watches it and reads nothing of a message but that it arrived and when; a person reads every message in the mail host's own app. Remote content is switched off in that app, and no attachment is opened on a device that holds a staff key before the sender is checked against the register.
- The watcher (`notify`) reads the inbox and the junk folder every 20 seconds. A new message rings the on-call phone; when nobody has signed in to the console, or acted in it, since the message arrived, it rings every staff phone 15 minutes after its arrival.
- Every message there may be a removal order until someone has read it. Junk is watched too: look into the junk folder whenever an alert came and the inbox shows nothing new. The mail host must file nothing anywhere else: no rule, filter or quarantine of the host may move or delete mail before it reaches one of the two folders, and whoever is on call looks through every folder of the mailbox once a day, because a folder korbat does not watch is an order nobody sees.
- Never move a message between the inbox and the junk folder, by "Not spam", "Move" or a drag: the mail host gives the moved copy a new number, and korbat counts it as a second message, which rings again and runs its own hour. If it happened, close the second row on Contact point with the first row's word.
- Two credentials open the mailbox and they are not the same. `notify` has an application password that can only read. Each person on call has the mailbox's own sign-in, with its second factor, in the mail host's app on the on-call phone: it is the one credential that can answer an authority in korbat's name. The operator keeps a list of who holds it and on which devices, and changes the password the day a person leaves.
- Never answer an authority from another address, and never from korbat.
- korbat never deletes the record of a message that nobody handled. After an outage, a restore or a change at the mail host, Contact point may therefore list old messages as stale: look at them in the mail host's app, then close them together on that screen, so that the home screen's count is true again.
- The address is published (the terms, the app's Contact section) only once `API_CONTACT_POINT` and `API_HOME_STATE` are set and the web build has its two arguments, `WEB_CONTACT_POINT` and `WEB_HOME_STATE`, which is the last step of Before going public.

**On call.**

- Who is on call is whoever's phone is subscribed to the topic `korbat-oncall`; every staff phone is subscribed to `korbat-all`. Handing over means: the next person subscribes, the operator publishes a test to the phone on call with `docker compose -f infra/compose.yml run --rm migrate node dist/staff.js alert-test --on-call` (nobody on call can publish: the phones only subscribe), the next person hears it ring, and only then the last person unsubscribes. Both note the time.
- The phone is an Android phone with ntfy from F-Droid. Before a phone goes on call, and after every system update, its owner runs the checks P1 to P8 and notes each result: the build and its version; a message through the public hostname on mobile data; battery optimisation off for ntfy; exact alarms allowed; the highest-priority channel overriding every Do Not Disturb mode the person uses at night, ringing until dismissed; a ring after two hours unplugged and still; a ring after ntfy, Caddy and the tunnel were each restarted; "Connection lost" within ten minutes of ntfy stopping. (The research's ninth check is an iPhone's and does not apply: korbat's phones are Android.)
- **The second leg, check M.** korbat's own alarm has one blind spot: when the watcher or the database itself stops at night, nothing reads the mailbox, so nothing rings; korbat only mails "Phone alerts are down", and a mail wakes nobody. For that night the on-call phone has the mail host's own app, signed in to the contact-point mailbox, with its notification channel set to ring through every Do Not Disturb mode the person uses at night. It is checked like P1 to P8, before a phone goes on call and after every system update, and noted: the operator stops `notify`, sends a test mail to the contact point, and the phone rings from the mail app alone. Its push runs through Google, which is why it is the second leg and not the first.
- The on-call phone carries a staff key the person has used on that phone, over NFC or USB, for a sign-in and two confirmations in a row. A computer with the second key is the fallback. No weaker way in exists for the night.
- Each morning the person on call looks for the daily test. A day without it is a fault: check the console's home screen and tell the operator.
- Once a quarter, at night and unannounced to the person on call, the operator sends a mail to the contact point and times the push, the sign-in and an order opened and closed without effect on a test post. The times go into the operator's notes.
- A phone's ntfy user is a line of `infra/ntfy/server.yml`, which ntfy reads as a mounted file; the operator makes its password hash and token with `docker compose --profile notify run --rm ntfy user hash` and `ntfy token generate`. The publisher's token stands in two places, that file and `NTFY_PUBLISH_TOKEN` for `notify`. A lost or replaced phone: the operator removes its line and restarts ntfy; the other phones reconnect by themselves, and an alert that arrives during the restart is published once ntfy is back, for as long as its hour runs. The same file exempts the watcher's own address on the push network from ntfy's request limit (`visitor-request-limit-exempt-hosts`; Compose gives `notify` that fixed address, as `infra/.env.example` says), so that a flood of alerts is published at once and not a few a minute; with another `PUSH_SUBNET`, change the address in both places, and restart ntfy after any change to the file.
- Upgrading ntfy: once a month, and at once on a security release, move the pin in `infra/compose.yml` to the newest release that is at least 7 days old, restart ntfy, publish a test to every staff phone with `staff.js alert-test` in the migrate service and hear it ring. Its maintainer supports only the newest release.
- What each alert means and what to do is its own second line. An alert never says who or what: open the console. What ends a message's alarms is handling it on Contact point, not the sign-in alone.

**A removal order, step by step** (the hour runs from the mail host's delivery time, not from when you woke).

1. Read the mail in the mail host's app. Note the authority, the reference, the addresses named, whether Section C is ticked, whether it says emergency.
2. Sign in to the console with your key. Contact point: "Open an order from this message". If Contact point does not list the message (the watcher was down, or the mail host filed it in another folder), open it all the same: Orders, "Open an order", "The message is not listed". The deadline then shows as unknown: act at once, and tell the operator, who records the time of receipt afterwards (`order-received`). Never pick another message in its place. Fill the form exactly as the order reads; if you cannot tell whether Section C is ticked, choose "I cannot tell", which holds the notice.
3. Read the record against the order once. A mistake is corrected on the order's screen, under "Correct what the order shows", before you disable anything; a missed Section C can be set by anyone at any time, also afterwards. Never open the order a second time under a changed reference.
4. Check the authority against your offline copy of the Commission's register. If you cannot finish the check and the hour is running, go on: the measure is reversible and keeps everything.
5. If the order has a manifest error or lacks what you need to find the content, send Annex III from the mailbox to the address in the order's Section F, with a copy to the address the console shows, and record "Annex III sent". The clock stops. When the clarification arrives, record it: a fresh hour starts at its delivery time. A link that names an account, or an image, is not unclear: an image's address is taken as its post; for an account, add the address of each post the order means, call the operator for the rest, and then close that link's item without effect ("The link names nothing korbat can disable for an order"). Annex III is no way to stop an alarm.
6. "Disable for an order", one key touch for up to 10 posts, and again for the rest: the order is given effect in full only when every post it names is disabled and every other link is closed with its reason, and its reminders run until then (before the first disabling anyone closes a link; afterwards an admin). Check each address from outside, in a private window: it must say that the post does not exist.
7. Send Annex II from the mailbox with the values the console shows, a line for each address; record "Annex II sent". If a member of korbat's staff wrote a post the order names, say so to the authority in the form: that person reads the contact-point mailbox like everyone on call.
8. By the next working day, on the server: `order-verify`, `order-issued`, `order-texts` (the reasons, then the remedies: each author who was already told gets an email that the notice has grown), `order-document`. For an order from another Member State decide with counsel, inside 48 hours of receipt, whether to ask for scrutiny, and record it with `order-scrutiny`. A link added to the order later makes it unverified again until `order-verify` is run once more.
9. Never tell the author anything yourself: not of the order, and, while its notice is held, not of any decision of korbat's own about the same post. korbat tells them, at once or when the non-disclosure period ends.

**Other messages and orders.**

- **An order to act against content under another law (DSA Article 9).** No hour runs for it, so nothing is done in doubt, and the console gives no effect to it before it is verified. In this order: open it; counsel reads it; whoever has the server verifies it and records `order-verify` (no register lists who may issue such an order: ask korbat's Digital Services Coordinator whether it holds a copy, which it does of a genuine one, or call the authority on a number you looked up yourself); then records the authority's reasons, its remedies and the order's territorial scope with `order-texts`, three times, because the author is owed all three with the notice; and, when the order says the author must not be told, the time until which, with `order-hold-until` (`none` when it names no time: the notice is then released at no time until one is recorded, and every staff account is reminded daily). Then "Disable for an order". Choose "must not be told" as the order says; the post is then kept from its author too. Tick "withheld from the author" otherwise only if the order's text says so. Afterwards tell the authority from the mailbox what was done and when, and record "Authority informed". Only when the order itself sets a time that cannot wait for all this does an admin give effect first, marking it urgent; the check and the texts then follow the same day, and each author gets an email when the texts arrive.
- **An order to provide information (DSA Article 10).** Open it; counsel reads it. Whoever has the server records with `order-tell-rule` whether and when the person may be told, and on which provision or sentence of the order that rests; the home state's default is in `STATE_FACTS`, and the cautious choice for an order nobody has classified is "never" until counsel has read it. Then `production-account`, with `--asked` for what the order asked for: it prints the handle, the address and the creation day and records the production; the operator sends that from the mailbox and records "Authority informed". When the rule is "at effect", or its time has come, the operator tells the person from the contact address, to the account's address and to no other, with the authority's reasons and the ways to challenge the order, and records it with `order-told`. korbat produces nothing else without counsel: it also holds the times and device types of an account's sign-ins, and whether an order reaches those is counsel's to say, order by order.
- **An order that names an account, not a post.** korbat cannot disable an account for an order from the console. Add the address of each post the order means and disable those, and close the account's link without effect ("The link names nothing korbat can disable for an order"). For the display name or the bio, and when the order means the whole account, call the operator at once: the hour for such an order depends on the operator, who decides with counsel what korbat does (a suspension is korbat's own measure and tells its subject, so it is no way to carry out an order that forbids telling). Do not answer such an order with Annex III: it is not unclear.
- A European Production or Preservation Order (e-Evidence): korbat has designated no establishment, since it serves its home state only. Do not act on it; send it to counsel the same day.
- A referral, a first-order notice, a request to preserve longer, a scrutiny decision: close the message with its word; the screen says what follows. A request to preserve longer is recorded with `order-preserve-extend`, which never shortens a preservation.
- A withdrawal or an annulment: check it as you check an order; an admin reinstates each item on its case and, once no measure of the order stands, closes the order ("Close without effect", with the ground), which also ends the reminders for an item that was not disabled yet. When the authority withdraws one item that korbat has not disabled and other items of the order stand, that item alone is closed on the order's screen ("Close this item without effect", "The authority withdrew this item"): by whoever is on call before the order's first effect, by an admin with the key after it. A reinstatement while the order's notice is still held tells nobody and leaves the hold as it is: whether the author may now be told is the authority's to say, and the operator ends the hold with `order-hold-end` (`annulled` or `released_by_authority`) when it says so. A forged order found later: `order-hold-end` with `not_authentic` first, then the reinstatement with the same ground, so that the author is told at once. An order that a court restores after it was lifted: an admin reopens it if it was closed, and the post is disabled again; its preservation counts from the new disabling.
- **An extension of a non-disclosure period, or a later time.** The database releases a held notice by itself at its end, and nobody is asked. So: every staff account is alerted daily in the last 7 days before any release, and whoever has the server then looks through the contact-point mailbox for an extension. When an extension of a removal order's period arrives, an admin records it on the order at once ("Extension received"), also at night and before the operator has read it; the operator checks it afterwards and confirms it with `order-hold-extend`, or, if it was not the authority's, ends the hold once the first period is over. A later time that the authority gives for a DSA order is recorded with `order-hold-until`, which only the operator can do: the person who reads such a mail calls the operator the same day.
- **A record entered wrongly.** Correct it on the order's screen; never close a true order or open it twice. Before any post is disabled anyone corrects anything. Afterwards anyone can still set "the author must not be told", and an admin corrects the rest, the closing of a link among it. Setting it after a notice went out withdraws that notice until the hold ends; what the author already read cannot be taken back, so tell the operator at once. Every correction alerts every staff account. If korbat's record said that the author must not be told and the order did not, an admin unsets it (or the operator ends the hold with `order-hold-end --reason not_ordered`): the author is told at once, and the notice says that the delay was korbat's mistake.
- **Reading a preserved post.** `order-access <item> --purpose <review|complaint|authority>` prints its text between two marker lines and its images' facts, never an image, and records the access; for an authority it also takes `--authority` and `--reference` and records a production.

**When nobody can act within the hour.** Act the moment someone can. Never record a time other than the true one, and send Annex II with the true times. "Nobody woke up" is not force majeure: Annex III is for its three grounds only. If korbat's watcher is down or cannot read the mailbox, the console still works: the order is opened with "The message is not listed" and given effect, and the hour does not wait for anyone with the server; its time of receipt is recorded afterwards. If the console itself cannot be reached, the operator takes the app's site off the network (`APP_SITE=closed` in `infra/.env`, then `docker compose -f infra/compose.yml up -d --no-deps caddy`, and a check from outside that the app's hostname answers 503, as Restoring says) until the order is given effect, and writes down when; then opens it again (`APP_SITE=open`, then `docker compose -f infra/compose.yml up -d --no-deps caddy api worker`). Tell counsel the same day; the quarterly drill exists so that this does not happen twice.

**Notifications and hand-overs.**

- When images of an account are sealed, the home screen says that a report is owed. The admin answers the case. After a seal for good, whoever has the server runs `records`, then `notification-facts`, reports through the home state's intake for notifications (its entry of `STATE_FACTS` names it), and records it with `notification-sent`; later `notification-answer` with the authority's reference and answer. A check that ends in "no" is recorded with `notification-declined` and its reason. A seal that a correction or a review lifts closes its record by itself, and the address is no longer held. A notification under DSA Art. 18 or TCO Art. 14(5) that no seal opened is opened with `notification-open --case <id> --duty <duty>` and then recorded the same way.
- Whether the sealed files go with the report: "only on the authority's demand" until counsel has answered the first question of Before going public; then this line reads what counsel said.
- A hand-over goes to an authority, never to a hotline, a lawyer or a company, by the channel the authority names in writing: `handover-list`, then the `handover` service with the directory given on its command line (`docker compose --profile handover run --rm -T -v <directory>:/handover handover < list > digests`), `handover-record`, and after the authority's receipt delete every copy and run `handover-destroyed`. The directory is on an encrypted volume and owned by uid 1000, the user the service runs as; no setting names it, so a stack on which no hand-over was ever made needs none. Nobody opens the archive. With a seizure, record what was taken (`handover-record --taken`).
- A person who deletes their account while a report is owed is told in the deletion's mail that the address is kept for at most 7 days, in words that say no more than the seal's own statement told them. `API_REPORT_HOLD=off` ends the practice for everyone once `docker compose -f infra/compose.yml up -d api` has started the API with it; set it only on counsel's advice.
- `records --verify` recomputes each record's digest against its audit row; run it with `text-verify` after each deploy and each week.

**A person asks about a missing post.** Whoever answers the contact address gives every such question the same answer, whatever the reason the post is gone: "korbat can tell you about your posts only what the app shows you: your posts are on your profile, and every decision about them that korbat can tell you of is under Settings, Cases. If something is not there, korbat has nothing it can add by email." Never look the post up first: an answer that differs by what you found would tell. This stays the answer to every mail that does not meet the next entry's test.

**An author writes about an order's notice.** The notice sends its author to the contact address for three things: a copy of the order, korbat's own mistake ("the order does not name this post"), and the preserved text for their challenge. A person reads that mailbox every working day and answers within two working days.

- Look the order up only when the mail names a notice the app has shown: it quotes the reference, or the day, that the notice prints. A held notice shows neither, so nobody can pass this test for one, and the fixed answer above stays for everything else.
- Check that the writer is the author before anything is sent: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js address-check --handle <handle> < address`, with the mail's sender on standard input. It answers yes or no, prints no address and writes one audit row. On "no", answer with the fixed sentence above and ask the person to write from the address of their korbat account.
- A copy of the order, or the preserved text of `order-access --purpose complaint`, goes to that address and to no other. The copy is the document in the authorities' mailbox; korbat holds no other.
- "The order does not name this post": an admin compares the item's link with the order in the authorities' mailbox and, within two working days of the mail, reinstates with `wrong_item` or answers why not.

**The daily copy.** On the daily visit the keeper notes the head as before and then presses "Download since my last copy", confirms it with the staff key, waits for the line "The copy is recorded", and keeps the file with the head, off the server, on an encrypted device. A download that broke off records nothing: press again. The file holds no post and no statement, but it names authorities and references, held orders' among them, and a reference may itself name a person (a court's file can carry a party's name): it is kept like the head, not like a log. Every staff account is told when someone who did not take the last copy takes one, and is alerted once the newest copy is more than 48 hours old. On the server, `staff.js audit-export` in the api service writes the same lines and records its own copy.

**A key in someone else's hands.** Revoke it (`staff.js revoke`). On the Audit log, "What one key confirmed" lists what it did in the period. An admin corrects each decision on its case, under the caps; there is no batch. An order's disabling confirmed with a stolen key is checked against the mailbox: a true order stays in force.

**The yearly counts.** korbat publishes them itself (sub-project 3d): the yearly edition on `/transparency`, which appears on or after 1 March (The yearly edition), carries in a year with a removal order the figures of TCO Art. 7(3) and Art. 21(1) as numbers, under the report's headings and without the issuing state, and an order whose disclosure an authority's decision forbids is added by a marked second version once that decision ends. `staff.js tco-counts <last year>` in the migrate service stays for an authority that asks: it prints, from rows and for the calendar year in UTC, a line a figure: removal orders received by issuing state and from another Member State; items disabled; the minutes from each order's clock to its last disabling, how many outside the hour and how many with an item still open; Annex III by ground; scrutiny; reinstatements by ground; authorities' accesses to preserved content; what korbat itself restricted as terrorist content; referrals closed. It reads only and writes no audit row. A figure it can no longer give, because the retention job erased the rows it rests on or nobody recorded a receipt, prints "not recorded", never a zero, and the edition prints it the same way. The one heading of the report the server cannot count, complaints and court proceedings, stays the operator's, from their own notes, for the authority that asks. Then the state's own filing, where `STATE_FACTS` names one.

## Quarantine

The files of images sealed for good leave the image store: the one-shot service `quarantine` moves them into the volume `media-quarantine`, which neither the API nor the image worker mounts, and back when a seal for good is lifted (sub-project 3d). A seal taken while deciding leaves its files in the store. Nothing moves a file by itself: the home screen's line "Files to move or return" and the daily alert "Sealed files are waiting to be moved" say when the steps below are due, after every seal for good, after every lifted seal for good, and after every release.

1. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-list > list`. Read the line it prints beside it: how many files move in, return, are destroyed, are for the operator. A post it leaves out is named there; the other posts' lines stand.
2. `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine < list > receipt`. It copies, compares digests, renames and only then removes; a `destroy` line takes the digest first and removes the file in the quarantine and, where the store holds one of the same name, there too. One bad line never stops it: it prints the line, goes on, and exits 1 at the end. If it is cut short, run steps 1 and 2 again: a file is never in neither place.
3. `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js quarantine-record < receipt`, then delete `list` and `receipt`: they name files. The record takes each line by itself and never refuses the others. A line that no longer fits the plan (a seal was lifted, or taken again, between the list and the move) is recorded where the file now is and printed, and the next list moves it back: run steps 1 to 3 again.
4. Nobody opens a file of the quarantine, on the server or off it. The volume is on the encrypted disk and is in no backup: a lost disk loses the sealed files, and no backup can bring a destroyed file back. Its owner and mode (uid 1000, mode 0700) come from the path `/media/quarantine` that the API's image creates; check them once after the first run, from inside the service: `docker compose -f infra/compose.yml --profile quarantine run --rm --entrypoint stat quarantine -c '%u %a' /media/quarantine` prints `1000 700`.
5. **A file in neither place** (`missing` on the receipt). Nothing is recorded for it yet, and the daily alert goes on. Look for it first: the disk, a run that was cut short, another volume. Only if it is gone, run step 2 again with `--lost` appended, then step 3: the file is recorded as lost and every staff account is alerted. An image whose seal was lifted then reads "korbat lost this image" for its author, who is mailed once. If the file was kept for an authority, tell the authority, and note it.
6. **A file without a record** (a receipt that was lost before step 3, or a restore). `docker compose -f infra/compose.yml --profile quarantine run --rm -T quarantine --inventory > have`, then step 3 with `have`: every file the quarantine holds has its record again, and the next list returns it, destroys it, or prints it for the operator.

### A release

An authority's assessment is not leave to destroy. Record it as Authorities' orders says (`notification-answer --answer illegal`): it releases nothing, and it is a reason the authority may want the files kept. If the authority asks for the files, hand them over (Notifications and hand-overs) and wait for its word. A release is possible only after the report is recorded (`notification-sent`), the files are in the quarantine, and an authority or a court has given korbat leave or an instruction to destroy them, in writing, with a reference. Record that as a fact of its own, with the day the leave bears and your name: `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-leave <seal> --by <authority|court> --reference <text> --day <yyyy-mm-dd> --operator <name>`, where `<seal>` is the seal's ledger row as its case shows it. If the authority asked that the person is not told, record that before any release: with the leave (`--untold`, with `--until <instant>` or without an end; `release-leave --end-untold <leave>` ends an open one later), or, when the request came apart from the leave, on the report's record as Authorities' orders says (`notification-event`, with its end or without one). The author's notice then waits for the end of every such mark. A recorded leave is never rewritten or deleted: check the seal and the reference before you record it. A leave that you recorded by mistake all the same is withdrawn, `release-leave --withdraw <leave> --operator <name>`: it then supports no release, and the right leave, if there is one, is recorded as a new one. Withdraw it at once: a leave that a release already rests on cannot be withdrawn, and nothing takes a release back.

Then an admin confirms the release on the case ("Release and destroy", with the key), and every staff account is mailed that it happened. Then run the Quarantine steps above, whose list prints the released files as `destroy` lines, and `docker compose -f infra/compose.yml run --rm -T migrate node dist/staff.js release-show <release>`: it prints each destroyed file's digest and the day after which no backup that is deleted on time holds the files. On an instruction to destroy at once, destroy the backups of the image store taken before the move too, and note it; a backup kept for an authority is destroyed by hand when that authority releases it. An answer "not illegal" is no release: an admin lifts the seal and the Quarantine steps return the files. Silence ends nothing, and korbat promises nobody a destruction.

## Automated tools

Two programs may help moderators (sub-project 3d; design `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`), each off until the owner switches it on after section 17 of that design: the R1 check (`R1_CLASSIFIER`) rates an uploaded image and puts one rated over the threshold before a moderator, and withholds it until then only with `API_AUTOMATION_R1_ACTS=on`; the known material check (`MEDIA_MATCH`) compares an upload's hashes with a source's list, refuses and holds an upload that the source reports as an exact match of its class for child sexual abuse material, and on a post opens a finding under R2 that an admin answers for a match of that class, exact or not, sealing the post's images until then only for an exact one and only with `API_AUTOMATION_R2_ACTS=on`. A match of another class is a flag for a person. `/rules` says what is on today. While a tool is off the retention job deletes what it stored: every hash, and every rating but one a waiting signal names; it does so also while `API_MODERATION_RETENTION=off`. A match record keeps its hash for 180 days after its case closed, its hold ended or its images were released, and then names nobody.

**A measure a program took, and a request for a person.** The home screen lists both. A moderator lifts the measure or decides the case, within 24 hours of a request; the statement says that the moderator looked at the image only if they opened it on the case first. Sealed images are an admin's and are opened by nobody, and an image that a match names is opened by nobody at korbat at any time, also after an answer without a seal: the console refuses it. A program stops taking measures by itself under a rule while 20 of its measures under that rule wait for a person, and under either rule while a request is older than 72 hours; if the only person who can answer will be away longer than the published target, switch the measures off before leaving (`API_AUTOMATION_R1_ACTS=off`, `API_AUTOMATION_R2_ACTS=off`, then `docker compose -f infra/compose.yml up -d api`): a program then only reports. "A program stopped taking measures" with nothing to explain it means the check or the API is faulty or in someone else's hands: set the same two settings, restart the API with `docker compose -f infra/compose.yml up -d api`, and read `docker compose -f infra/compose.yml run --rm api node dist/staff.js automation-status`.

**A held upload.** An admin ends the hold on Held uploads, unseen. The console does not say which way, and it preselects neither: what counsel has advised korbat is written here, by the owner, in the place of this line: "Counsel's advice of <day> on whether a match obliges korbat to report an upload that was never posted: <not yet given>." While it reads "not yet given", no admin ends a hold alone: decide with whoever has the server, and write the ground into the operator's notes the same day. "Report": the Quarantine steps, then `staff.js upload-report <refusal> --duty <duty>`, the report itself through the intake of the runbook of Authorities' orders, `notification-sent`, later `notification-answer`; the end is a release on a recorded leave to destroy (A release), never on an assessment. "No report" needs one of its three reasons; "another reason" is written into the operator's notes the same day. The upload is deleted 24 hours after "No report"; every staff account is mailed at once, and until the upload is deleted another admin can end the hold as "Report" instead. When the uploader's account is gone, `upload-report` says so: the report then carries the file's facts and times, and the address only while 3f still holds it (7 days from the refusal).

**Switching a tool on.** Each needs the lines of Before going public done first, the 3d owner's part B before the tool's own: the tool's own impact assessment and its date (`API_AUTOMATION_DPIA_R1` for the R1 check, `API_AUTOMATION_DPIA_MATCH` for the comparison), and, before a tool's measure is switched on, the date of the assessment that covers the measure (`API_AUTOMATION_DPIA_R1_ACTS`, `API_AUTOMATION_DPIA_MATCH_ACTS`) and, for the automatic seal, counsel's word on GDPR Art. 22. The API refuses to start with a tool or a measure on and its date unset. Then set the tool's settings in `infra/.env` (`R1_CLASSIFIER` and `MEDIA_MATCH` without a prefix, since the worker reads them too; the others with the API's prefix), run `docker compose -f infra/compose.yml up -d api worker`, and read `/rules`, which asks the server afresh: it must print the tool as on, with its own date, and `staff.js automation-status` must agree. Switching off is the same in reverse. The retention job then deletes, within its next rounds, every stored fingerprint but the one a match record holds and every stored rating; what a program found before is still put before a person; nothing else already recorded is deleted.

**Cloudflare's scanning tool** stays off. Switching it on makes Cloudflare file its own reports with NCMEC about content on korbat, which korbat itself does not make; a match would arrive as a path in a daily mail, which a person would turn into a finding citing R2 by hand. Decide it only with counsel.

## The yearly edition

The public figures (sub-project 3d; design `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`): `/rules` prints every rule, what korbat can do and when, what each automated tool does today as the running server reports it, and the rulebook's change log; `/transparency` prints one edition a calendar year, in counts that point at nobody: 0, "1 to 9", or rounded to ten, and a line under ten folded into "other", but for the authorities' orders, which the law asks for as numbers.

**The yearly edition, the monthly count and the daily value.** The edition publishes itself on or after 1 March: once a day after `API_MODERATION_DISPATCH_HOUR`, the API's job `transparency` asks for the last closed year's edition, and for every earlier year that has one, which gains a marked version only when an order whose hold has ended can now be counted; no figure of the running year exists anywhere. `staff.js edition <year>` prints the newest stored version, and `--correct` computes every table again and stores the result as a corrected version beside it, which its line on the page says; no version is ever changed or deleted. Each month the job stores two numbers of the month before, the accounts seen signed in and the sum of each day's readers without an account, and the counting sketches in Valkey go; `staff.js recipients` prints the exact figure, the average of the six full months before today, for an authority that asks (DSA Art. 24(3)); `tco-counts` stays for the authority too. Whether readers without an account are counted is `API_RECIPIENTS_SIGNED_OUT` in `infra/.env` (on unless set to off; then the pages say "at least"), which the API reads at its start: set it, then `docker compose -f infra/compose.yml up -d api`. Once a day after the same hour the job also publishes the audit log's daily value: the SHA-256 of `korbat.head.v2`, the day, the head's place and its hash, each on a line of its own, which shows neither the place nor the hash and differs every day; `/transparency` shows the last 30 days, a day without a value as such, and writes no audit row for it. The keeper's mail goes once a day to `API_HEAD_KEEPER_MAIL` alone, with the day, the value, the place and the hash; while it is empty no mail is sent. The keeper keeps each day's mail with the value, the place and the hash; "No daily value was published" is noted by the keeper, and every staff account gets that alert too. With `API_HEAD_WITNESS` set to `rfc3161` and a timestamp authority's https address in `API_HEAD_WITNESS_URL`, each day's value is first sent to that authority, the value and nothing else, and its proof is stored and offered on the page as `<day>.tsr`, which anyone checks with the authority's own certificates: `openssl ts -verify -digest <value> -in <day>.tsr -CAfile <certificates>`. An authority that does not answer leaves the day's value published without a proof; it is asked again in the day's later rounds, and every staff account is alerted ("A daily value has no outside timestamp"). The API reads these three settings at its start as well.

```bash
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year>             # the newest stored version, a line a figure
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js edition <year> --correct   # every table counted again, as a new version
docker compose -f infra/compose.yml run --rm migrate node dist/staff.js recipients                 # the six full months before today, exactly
```

## Profile and account
Signed-in accounts manage themselves under Settings; every route below needs the session and, where it says fresh, a re-authentication within five minutes (the app opens its panel when the API answers `reauth_required`).
- **Profile.** `PATCH /api/me/profile` sets the display name (up to 50 characters) and the bio (one line, up to 160). `POST /api/me/handle` (fresh) changes the handle once every 30 days; every handle an account ever had stays reserved for it in `handle_history`, so nobody else can take an old handle and the account can go back to it, except a handle korbat retired, which is nobody's, its former holder's included; a retirement lifts the 30-day wait (Moderation, Handle retirement). There is no redirect from an old handle.
- **Email.** `POST /api/auth/email/change/start` (fresh) sends a code to the new address; `POST /api/auth/email/change/verify` moves the account there and tells the old address, whose notice carries a link (`/email-revert/<token>`, `POST /api/auth/email/revert`, valid 24 hours, once) that moves the account back and runs the lockdown described under Passkeys and fresh authentication (every session and device signed out, the password removed, passkeys and two-factor authentication set up since the day before the change removed). Sessions stay signed in after a change.
- **Verified badge.** Proof of holding a phone number, kept only as a keyed hash; one number per account. `VERIFY_PROVIDER` picks who sends the text: `off` (default; the badge is hidden), `dev` (the code is always `000000`; refused in production) or `vonage` (Vonage Verify v2 with `VONAGE_API_KEY`, `VONAGE_API_SECRET` and `VERIFY_BRAND`; the runbook is section 13 of `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, and `node scripts/verify-badge.mjs +4479xxxxxxxx` checks live credentials without touching an account). Routes: `POST /api/auth/badge/start`, `POST /api/auth/badge/verify`, `DELETE /api/auth/badge` (all fresh); starts are limited per account, per number, per IP and instance-wide (200 texts a day), and a flow takes at most five codes. The web build shows the badge section only with `WEB_BADGE=on` in `infra/.env` (the default is off, matching `API_VERIFY_PROVIDER=off`); set both together.
- **Data export.** `POST /api/account/export` (fresh, once a day) streams a ZIP with `export.json` (the account with its passkeys' names and dates, profile, posts, likes, reposts, bookmarks, following, blocks, mutes, sessions, devices and security events, then the member `moderation`: the decisions about the account as its Cases screen lists them, with their statements while korbat holds them, and the reports the account sent, with their outcomes once released; since account sanctions also its strikes, suspensions, terminations and reporting measures, its replies to them and its own reporting counts, and in the profile the handles korbat retired; and last, since sub-project 3b, the member `imports`, the account's imports newest first with their source, state, times, choice and counts, while each post imported carries its source and the archive's date) and every image the account uploaded under `media/`, except sealed images, images of posts it deleted and images whose content was erased, which are in neither the list nor the files. It never holds another person's report, a reporter, a notifier or a staff handle. Nothing is kept on the server: the archive is written entry by entry (ZIP64 when it passes 4 GiB or 65,535 entries), `export.json` is read in pages and streamed last, image files go through the media module's checked open, a request that fails before the first byte gives the day's export back, and one that fails midway breaks the download instead of saving a truncated archive.
- **Deletion.** `POST /api/account/delete/start` (fresh) mails a code; `POST /api/account/delete/confirm` with the code and the handle typed by the owner deletes the account at once: every session is revoked, posts become tombstones with their images and any pending uploads deleted from disk, likes, reposts, bookmarks, follows, blocks and mutes go with their counters, the profile is anonymised and keeps its handle, and the auth row is anonymised. The `account-purge` job (every five minutes) finishes any deletion the process did not, and takes down a terminated account once its decision is final for the person (Moderation, Termination). Nothing can be undone. A suspension, a termination or a seal never refuses or delays a person's own deletion. Moderation outlives a deletion: images that a case holds as evidence, or that an unanswered report of child sexual abuse material or a seal freezes, keep their rows and files, served to nobody, until nothing retains them; open cases about the account or its posts go on and are decided on their snapshots; the reports the account sent are still decided, with nothing left that says who sent them; and the statements of decisions about the account are erased 12 months after the deletion (Moderation, Evidence and retention).
## Passkeys and fresh authentication
An account can sign in and confirm sensitive changes with a passkey (WebAuthn), beside the emailed code, the password and two-factor codes. The API verifies through `@simplewebauthn/server`, which only `apps/api/src/auth/passkeys/webauthn.ts` imports; that module pins korbat's settings and adds its own checks.
- **Settings.** `API_WEBAUTHN_RP_ID` is the domain passkeys are bound to (default: the host of `API_APP_ORIGIN`) and `API_WEBAUTHN_RP_NAME` the name a browser shows (default `korbat`). Production refuses `localhost`, an IP address and anything that is not the origin's host or a parent domain of it. Browsers offer passkeys only on `https` or on `http://localhost`, never on an IP address.
- **Adding.** `POST /api/auth/passkeys/register/options` and `/verify`. Up to 10 passkeys, 5 added a day. User verification (fingerprint, face or PIN) is asked for and never required; only the attestation formats `none` and self-attested `packed` are accepted, so nothing is fetched from an authenticator's maker. The owner is mailed a link (`/passkey-remove/<token>`, valid 7 days, once) that removes the passkey and locks the account down.
- **Managing.** `GET /api/auth/passkeys` lists them (name, dates, synced, the device that added it, new, suspended); `PATCH /api/auth/passkeys/:id` renames and `DELETE` removes, the last one too. "This wasn't me" on a passkey of the last 7 days (`POST /api/auth/passkeys/:id/not-mine`) runs the lockdown.
- **Signing in.** `POST /api/auth/passkey/signin/options` and `/verify` need no email: the browser offers the passkeys it holds for the domain, from the button or from the email field's autofill. A sign-in whose passkey verified the user counts as two factors; one that did not is followed by the two-factor code on an account that has two-factor authentication, and staff who have it always give the code. A signature counter that goes backwards switches the passkey off, mails the owner and refuses the sign-in.
- **Fresh authentication has two levels.** A session records what it proved and when. Level 1 is any factor in the last five minutes; level 2 is a user-verified passkey, or a two-factor or recovery code beside an email code, a password or a passkey. An account with two-factor authentication needs level 2 to add or remove a passkey, change its password or email, set up, turn off or re-issue two-factor codes, and delete itself; every other account needs level 1. A refusal is `reauth_required` with `details: { level, have }`, and `POST /api/auth/reauth` (password, emailed code, two-factor code, recovery code or passkey) answers the level reached and rotates the session's token in place, so a copy of the old token stops working. Sessions are listed and revoked by an id that survives the rotation.
- **Lockdown.** Every "this wasn't me" runs one routine: the new-device alert's link, the passkey mail's remove link, the button on a new passkey, and the email change's undo. It signs out every session and device, removes the password, and removes the passkeys and two-factor authentication set up since the day before the event, in one transaction; the owner gets back in with a code sent to their email. A mailed link is tied to the address it went to: it does nothing while the account is at another address and works again once the address is restored.
- **What is kept.** The public key, the credential's id, its counter, whether it is synced and was registered with user verification, its name, and the device that added it; nothing about a fingerprint or a face ever leaves the person's device. The export lists names and dates only, and deleting the account deletes the passkeys.
- **After restoring a backup** the counters in the database are older than the authenticators': run `update auth.passkeys set counter = 0, suspect_at = null where suspect_at is null or suspect_at > '<restore time>';` so no passkey is refused as a copy (section 11 of `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`).
- **Tests.** A software authenticator (`apps/api/test/auth/soft-authenticator.ts`) runs whole ceremonies in the unit and integration suites. The API prints two `ExperimentalWarning`s at start, from the library's probe of Node 24's ML-DSA support; they are expected.
## The interface
The app's look and feel come from the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): one design system of colour tokens, bundled fonts, Lucide icons and korbat's own components (`apps/app/src/components/kit`), with every visible sentence in a words module (`apps/app/src/lib/ui-words.ts` and its area's), so a later translation changes no screen.
- **Themes.** Light, Dim and Dark: ink and paper with one violet accent for actions, every pair of text and ground at WCAG AA in each (`apps/app/src/theme/tokens.ts`, which `apps/app/test/contrast.test.ts` checks). The default is System, which follows the operating system: Light, or the reader's dark style (Dark unless they choose Dim) when the system is dark. Settings, Appearance and accessibility (`/settings/appearance`, the one settings page a signed-out reader can open) also holds the dark style, the text size (Smaller, Default, Larger and Largest, which multiply every size and line height and on the web follow the browser's own text size too), the font (korbat fonts or System font), Reduce motion (Follow the system, or Always) and three Reading switches (Load older posts automatically, Open feeds at the newest post, Hide like, repost and follower counts). Each choice applies at once, with no Save button; a change of theme cross-fades the colours over 200 ms (150 ms with motion reduced), never on the first paint. The page's policy allows no inline script, so `apps/app/public/theme-boot.js`, served as `/theme-boot.js` without caching like the page itself and loaded first in its head, reads the stored choices and paints the page in the reader's theme before the bundle arrives.
- **What the browser keeps.** Three kinds of key in the browser's `localStorage`, each written by one module only (`apps/app/test/explore.test.tsx` holds the app's stores to that list): `korbat.appearance` (`apps/app/src/lib/appearance.ts`), the Appearance choices, written when one changes; `korbat.place.<account id>` (`lib/reading-place.ts`), where the account stopped reading in Following and Latest, written a second after scrolling stops and when the page is hidden; and `korbat.drafts.<account id>` (`lib/drafts.ts`), the text, never the images, of a post, reply or quote not yet sent, written half a second after typing stops and when the composer leaves the screen, and removed when it is sent or discarded. All three are cleared, whatever the account, when the session ends as `apps/app/src/lib/session-end.ts` decides it: when the app moves from signed in to signed out (a sign-out here or everywhere, a lockdown page, any 401 the API answers), and when its first `/api/me` answers signed out while a reading place or a draft is still stored (a session revoked, expired or signed out elsewhere while the app was closed). Appearance's "Clear what this device keeps" clears the same three at once and says "Cleared"; the theme returns to System. The feeds Home keeps in memory for the session (`lib/feed-cache.ts`) go with them each time. Two keys stay, because they belong to the browser and not to an account: `korbat.deviceId`, a random id that tells a new device from a known one at sign-in, and `korbat.passkeySuggestion.dismissedAt`, the passkey card's Not now. On iOS and Android the appearance and drafts are kept in memory only, and the reading place not at all, until sub-project 5 brings storage there.
- **Haptics.** On iOS and Android only, through expo-haptics 57.0.3, by seven intents (`HAPTIC_INTENTS` in `apps/app/src/lib/haptics.ts`): a toggle turned on, a toggle turned off, a selection, a drag crossing its close threshold, a success, a warning and an error, each fired with the visual change it goes with. Ordinary taps, scrolling and navigation have none, and the web has none. Appearance's Haptics switch, shown on iOS and Android only, turns them all off; reduced motion does not.
- **Fonts.** Fraunces for display, Atkinson Hyperlegible Next for text and Atkinson Hyperlegible Mono for handles, codes and ids, so look-alike handles differ at a glance, from the `@fontsource-variable` packages at 5.3.0. The web export bundles their woff2 files under `/assets/`, which Caddy serves as immutable and the page's policy allows as `font-src 'self'`; no font comes from a CDN, and a latin-ext file loads only when a page needs one of its characters. All three are under the SIL Open Font License 1.1, their licence files in `apps/app/assets/fonts/LICENSES/` (Third-party notices, below). iOS and Android draw the system's font until sub-project 5 embeds the files.
- **Budgets.** The app's browser check holds every web export to the design's section 11.3: JavaScript at most 832,257 bytes gzip, which is the export of 1222b87 (709,377 bytes, recorded in `apps/app/test/browser/baseline.json`) plus 120 KB, since that baseline is above 400 KB (plus 80 KB until sub-project 3b's import screens, for which the owner raised it); CSS at most 40 KB gzip; the latin font files at most 320 KB; at most 3 API requests before the first content of Home, a post, a profile and `/rules`; and Home's first post drawn within 2.5 s at 1280 px. At the sub-project's end the export measured 789,381 bytes of JavaScript and 5,464 of CSS gzip, and 210,408 bytes of latin fonts in four files; after sub-project 3b's screens, 812,307 bytes of JavaScript gzip.
- **The app's browser check.** `pnpm --filter @korbat/app test:browser` (51 steps, about twelve minutes) builds the web export with `EXPO_NO_DOTENV=1` and an environment of its own (an empty API base, so every call goes to the check's server, and Cloudflare's Turnstile test key), so `apps/app/.env` is never read; serves it from a small Node server with the headers of the Caddyfile's app site and a fixture API beside it; and walks it in Chromium through playwright-core 1.63.0: the layout at 360, 768 and 1280 px, the keyboard, contrast as drawn in Light, Dim and Dark, the largest text at 320 px, motion with and without reduced motion, and the screens of the design, since sub-project 3b the import screens, the provenance label and the Imported tab among them. It needs no stack and no internet, answers Turnstile's script with a stub, and never downloads a browser: it drives the Chromium build playwright-core names, which must already be installed (never `playwright install`), or the installed Chrome with `KORBAT_BROWSER_CHANNEL` set to `chrome`. With `KORBAT_SHOTS` set to a folder it keeps its screenshots there (otherwise in a new temporary folder, which it prints), and with `KORBAT_APP_EXPORT` set to a folder it reuses an export built with the same environment instead of building one. Any policy report, console error or warning, page error, dialog or request the fixtures do not answer fails it.
- **The staff console** keeps a look of its own within its strict policy (`apps/admin/README.md`, The look): the app's colour roles at their Light and Dark values, chosen by the operating system's setting alone, with no switch and no dim style (the UI design's decision 21); red as its mark beside a blue focus ring; and the system's fonts, since its policy loads no font file (decision 2).
## Importing posts
A person brings their own public posts from an X or a Mastodon archive, and from a Bluesky repository once the owner turns Bluesky on (sub-project 3b; design `docs/superpowers/specs/2026-10-22-import-3b-design.md`). korbat accepts only the official export file the person downloaded themselves, never a password or a handle, and fetches nothing from the other platform. Imported posts are korbat posts, under the rules like any other, on their author's profile only.
- **Import posts in Settings** (`/settings/import`, on the website; iOS and Android wait for sub-project 5). The person picks a source the site has on and reads how to get its archive, what korbat reads and never reads from it, and that the whole archive passes through korbat's server and its network provider; the app checks the file's size (at most 2 GiB) and first bytes before anything is sent. The upload runs in the tab, in chunks of 8 MiB, each sent with its SHA-256, and must finish within 24 hours of its start; after a lost connection or a reload the person chooses the same file again, and the upload resumes from the bytes the server holds. The importer reads the archive, and the person sees the preview: what was found, and what will be left out and why. They choose a range of months; whether to bring replies to other people, posts with a content warning and X posts from protected periods (each off by default); whether to leave out or shorten posts over 1,000 characters; they may leave any post out one by one, tick the statement "These are my own posts, and they were public where I posted them.", and confirm. Nothing is published before that, and a preview not confirmed within 24 hours of the reading expires.
- **The profile's Imported tab.** Published posts go on the author's profile under Imported, newest first by the archive's date, each under the label "Imported from X, dated 3 Mar 2019", which opens Who sees this at its paragraph on imported posts. They never enter Following, Latest, Explore or the Posts and Replies tabs; anyone may still like, reply to, repost or quote one, one deliberate act at a time. The import's screen shows its progress. Stop import ends an import that is still preparing or publishing, and Remove imported posts deletes every post of an import in one action, through the author's own deletion path, so freezes, holds and evidence stay as every deletion leaves them. A later import skips every post an earlier import of the account published that still exists.
- **What an import reads, and what it never reads.** Only its source's allowlisted files: X's `data/manifest.js`, its tweets files, `note-tweet.js`, `twitter-circle-tweet.js` and the timestamps of `protected-history.js`; Mastodon's `outbox.json`; a Bluesky repository's commit, its tree and its post records; and, only while images are imported, the image files of the posts kept. Every other file, X's messages, IP logs, contacts, ad data, likes, follows and deleted posts among them, is skipped by its name and never opened. Mastodon's direct and followers-only posts share `outbox.json` with the public ones: each is skipped by its addressing before any other field of it is read, and is never kept or logged. Of what it reads the importer keeps only the person's own public posts and their threads; reposts, polls, Circle tweets and posts labelled as adult content are left out and counted by reason in the preview. korbat stores, shows and logs no handle, display name, account id, instance, DID, link to the original or source post id of the other platform, and never links an imported mention to a korbat account. On each imported post it keeps the source, the date the archive gives it (readers see the day only), whether it was shortened, and a keyed hash (below).
- **The two volumes, in no backup.** The API writes each archive into the volume `import-archives`; the importer, a service with no network, no capabilities, a read-only root and no credentials, reads it from there and writes the person's kept posts and their images into `import-work`, which the API only reads. The archive is deleted as soon as its scan is read, and at the latest 24 hours after the import was created; the work output when the import ends, and at the latest 72 hours after the scan. Neither volume is in any backup, by design: an archive holds the person's messages and other people's data, and nothing in either is meant to outlive its import. The API takes no new import while the importer's heartbeat is more than 60 seconds old; `docker compose ps` shows the service's health. The import's record (its source, state, times, choice, the time of the statement and counts, never a file name or a handle) stays in the database while any post of it exists and at least 30 days after its end, and goes with the account.
- **Limits.** An account imports once it is at least 7 days old, and an account younger than 30 days publishes at most 1,000 posts an import. One active import an account; 3 published imports an account in seven days (a failed, cancelled, expired or refused one costs nothing) and 5 imports started from one address in a day; at most 50,000 posts and 5,000 images kept an import. Imports never count against the post, reply or upload limits.
- **The per-account import key.** So that a later import can skip what an earlier one published, each imported post keeps a hash of its source post's id, keyed by a random key of the account's own (`import_keys`), never the id itself. The hash is still a pseudonymous id: source post ids of public accounts are public, so whoever holds the database or a backup of it, with the account's key beside it there, can test whether this korbat account imported a named account's public posts. No key of the server's alone does this, since the keys are per account; the account's purge erases its key, and a backup keeps it until that backup is deleted (Backups).
- **The console.** Staff see an imported post's label wherever the console shows the post, and on its case the import's size. An admin can end a whole import: End this import, under the label on a case about one of its posts once the case holds a final decision restricting it, confirmed with the staff key (a step-up, the audit action `import_ended_by_staff`), stops the import if it still runs, removes every post it published through the person's own undo path, and mails the person the rule and the decision, which they can appeal as any. Moderators are not offered it. After a restore, a lost end is an open gap of the class `restriction` on After a restore, naming the import: the API closes it when the import is ended again with the gap named (`POST /api/staff/imports/<import>/end?gap=<gap>`). The console's End this import names no gap yet, and the gap links no case, so for now an admin finds a case about one of the import's posts, ends the import again from it, and then closes the gap as Not needed with the key.

**Settings**, in `infra/.env`. Compose passes each to the API without its prefix (the names of the design's section 7.7), and the API reads them only at its start: run `docker compose -f infra/compose.yml up -d api` after a change. A blank value is the default.

- `API_IMPORTS` (default `on`): `off` refuses every new import with "Imports are paused for now. Try again later."; imports already running finish.
- `API_IMPORT_SOURCES` (default `x,mastodon`): the sources a new import may name, comma-separated, of `x`, `mastodon` and `bluesky`. A repeat is dropped; a list that names no source, or an unknown one, stops the API at its start.
- `API_IMPORT_IMAGES` (default `off`): `on` imports images, and is refused while `MEDIA_MATCH` is `off` (below).
- `API_IMPORT_MAX_ACTIVE` (default `2`, from 1 to 100): imports being uploaded or scanned on the site at once; past it a new import is refused as paused. The importer scans one archive at a time.
- `API_IMPORT_IMAGES_PER_HOUR` (default `600`, from 0 to 600, so it can only be lowered): imported images the API hands the image worker an hour on the whole site, at most 2 at a time and only while no person's own upload waits for the worker.
- `API_IMPORT_MIN_FREE_BYTES` (default `2147483648`, 2 GiB): free space kept on `import-archives` beyond a new archive's declared size and the 4 GiB its scan may write; short of it a new import is refused as paused.
- `MEDIA_MATCH` keeps its own name, since the worker reads it too (Automated tools).

**Images stay off.** `API_IMPORT_IMAGES` set to `on` stops the API at its start while `MEDIA_MATCH` is `off`, in every environment (decision 15): an imported image is published only once the comparison with known material has answered for it, since a bulk path for thousands of foreign images is not where korbat accepts what no tool has looked at. This build has no adapter for a real source, and 3d refuses the stand-in, `test`, while `APP_SITE` is open, so no build imports images today: imports are text only until the owner connects a real matcher source (Automated tools, Switching a tool on), and the preview counts the images left behind with the reason. With images on, the person still chooses Bring images (off by default), an image comes only with a description, its source's or one the person writes, and the first image the matcher refuses stops the whole import before anything is published.

**Bluesky.** Add `bluesky` to `API_IMPORT_SOURCES` only by your own choice, after reading this (decision 16). Anyone can download anyone's Bluesky repository without signing in, so a Bluesky archive proves nothing about who uploads it. Turning it on accepts that a person can publish someone else's public Bluesky history on their korbat profile, met only by the statement, reports under R6, the label's plain words and an admin's end of a whole import, and that the person copied may never learn of it, since imported posts reach no feed. Bluesky imports are text only: the export holds no image files, and korbat never fetches them from a PDS.

**The labs** (design, section 12.5) measure the importer against archives they build themselves, and run in no gate: the zip bombs, the JSON bombs, path traversal and large archives (`apps/importer/test/lab/README.md`), and the API's intake of a large archive (`apps/api/test/lab/README.md`, The intake of a large archive). Run the importer's in its Dockerfile's build stage with its own limits, about 25 minutes at half a processor (in Git Bash on Windows, put `MSYS_NO_PATHCONV=1` before `docker run`), and the API's from `apps/api`, about a minute, writing 1 GB to `.data` while it runs:

```bash
docker build -f apps/importer/Dockerfile --target build -t korbat2b-importer-build .
docker run --rm --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m -v korbat2b-importer-lab:/lab -e LAB_DIR=/lab korbat2b-importer-build pnpm --filter @korbat/importer test:lab
docker volume rm korbat2b-importer-lab
cd apps/api && node ../../node_modules/vitest/vitest.mjs run --config vitest.lab.config.ts test/lab/imports-intake.lab.ts
```

On 2026-10-26 all sixteen of the importer's cases passed in 22.7 minutes (every bomb refused within 5 seconds and under 64 MB, every large archive scanned within the 30-minute watchdog with its peak under 400 MB), and the intake of 50,000 lines took 52.1 s with a peak of 252 MiB, within the API's 512m; each README holds its table.

## Before going public
**The hard gate.** korbat is not opened to the public and sign-up is not opened to people the operator does not know until sub-project 3f's order path and sub-project 3d's quarantine and release have shipped and the lists below are done, and no authorities' contact point is published before then. The TCO Regulation (Regulation (EU) 2021/784) applies to a host insofar as it disseminates information to the public (Art. 1(2)) and its removal orders must be executed within one hour (Art. 3); DSA Art. 9 and 10 orders presuppose a service offered in the Union. Sub-project 3f receives both, carries them out from a phone at night, records every report to an authority and everything handed to one, and takes what korbat did again after a restore. 3c can seal images reported as child sexual abuse material, 3f hands them over to an authority, and 3d moves them out of the image store and releases them, only on an authority's or a court's leave or instruction to destroy (Quarantine, A release). Moving sub-project 4 before 3f or before 3d reopens this. The designs are `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md` (the order path, the alert channel, the records of reports to authorities and the recovery after a restore) and `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md` (strikes, suspensions and handle retirement); the order of work is 3c, 3e, 3f, 3d.

**The owner's list (sub-project 3f).** korbat is not opened, and `API_CONTACT_POINT` stays empty, until every line is done. It holds everything the 3f design assumes the owner has done: a line that is missing here is a thing nobody does.

1. **The Member State.** Set `API_HOME_STATE` and the web build's `WEB_HOME_STATE`; fill the state's entry of `STATE_FACTS` (`packages/contracts/src/orders.ts`: the authorities and their register entries, the address for the copies of Annex II and III, the intake for notifications, the contact point's languages, the yearly filing, and the state's rule for telling a person of an order to provide information). Germany's entry is the worked example; any member the console prints as "not filled in" is yours.
2. **The mailbox.** A mailbox at an EU mail host that offers IMAP over TLS with an application password that can only read mail, tells you the junk folder's name, stores mail in the EU and forces no other sign-in for IMAP. Two more requirements, each checked with the host and with a test mail: no rule, filter or quarantine of the host moves or deletes mail before it reaches the inbox or the junk folder (a folder korbat does not watch is an order nobody sees), and the date the host stamps on a message is the time of its final delivery. Switch off remote content. Put the four `NOTIFY_IMAP_*` values, `KORBAT_NOTIFY_DB_PASSWORD` and `NTFY_PUBLISH_TOKEN` in `infra/.env`, switch the services on with `COMPOSE_PROFILES=notify`, and set `API_NOTIFY=on`.
3. **The people's own access to the mailbox.** Every person on call reads orders in the mail host's own app and sends Annex II and III from the mailbox, so each needs the mailbox's own sign-in, which is not `notify`'s read-only password: decide who holds it, with which second factor, on which devices; write the list down; and change the password the day a person leaves. It is the one credential that can answer an authority in korbat's name.
4. **Registering.** Register the contact point with the competent authority and ask the eight questions of the research (OL E9.4): the channel and sender, whether other states use the same address, which time counts as receipt, how Annex II and III go back, whether a small host needs a portal account, how removal is checked and whether a "not found" page is read correctly, a test transmission, and whether referrals come to the same address. Register with the national intake for notifications and ask how files are delivered.
5. **The push hostname and ntfy's users.** The tunnel itself, which is still the Foundation's open task. A third public hostname on it for the push site, set as `API_PUSH_ORIGIN`. `infra/ntfy/server.yml`, made from its example: the publisher's token (the same value as `NTFY_PUBLISH_TOKEN`) and one user a phone, each with a password hash and a token made with ntfy's own commands; no example value left in it.
6. **The phones.** One Android phone a person on call, ntfy from F-Droid, the checks P1 to P8 each noted, and check M: the mail host's app signed in to the contact-point mailbox, ringing through Do Not Disturb, tried with a test mail while `notify` is stopped. The hand-over between people on call practised; the daily test looked at for a week; one night drill.
7. **The keys.** A security key with a PIN that works on each on-call phone, over NFC and over USB: sign in and confirm twice at night speed, and note the phone models that work.
8. **The papers, and counsel.** An offline copy of the Commission's register of competent authorities, refreshed each month; the texts of Annex II and III; this runbook, printed. Counsel who has agreed to answer inside two days, and the same day for a removal order from another Member State (the 48 hours for scrutiny), who reads every DSA Article 9 and Article 10 order before korbat acts on it; counsel's number, and a second one for the nights the first does not answer.
9. **The contact address.** The notice, the terms and the deletion mail send people to the address under Contact for a copy of an order, for korbat's own mistake and about a held address. Decide who reads that mailbox every working day and answers within two working days, from the runbook's two entries ("A person asks about a missing post", "An author writes about an order's notice").
10. **The page for the yearly report.** Nothing to create: since sub-project 3d the yearly report is the edition on `/transparency`, which korbat publishes itself on or after 1 March and the terms page links. Read it once after the first 1 March after korbat opened, and decide `API_RECIPIENTS_SIGNED_OUT` (The yearly edition) before then.
11. **The keeper, and the two places files rest.** The daily copy kept off the server with the head, on an encrypted device, since it names every order, held ones included; one restore drill with it, from `restore-import` to the app's site open again. And the directory a hand-over's archive is written into: on an encrypted volume of the server, owned by uid 1000, emptied after every hand-over.
12. **Decide**, each with its cost in section 2 of the 3f design: korbat serves its home state only (row 6); a page that is not public answers "not found" (row 17); Android only, no voice call (rows 19 and 20); every message at the public contact address rings the on-call phone, so anyone who knows the address can cost a night, bounded only by the quiet period of 15 minutes, which is one constant and can be zero (row 20); a watcher or a database that stops at night wakes nobody, and the hour then depends on the mail host's app (row 22); a console tick holds the notice with no shorter cap (row 25); a DSA order's silence lasts as long as its authority states, with no end while it names none (rows 24 and 46); the author's view during a hold, and that korbat's own decisions and appeal answers about the post wait with it (rows 26 and 47); account data is not held for an order (row 30); an order against an account as such is not built, and its hour depends on the operator (row 43); the hand-over's way and the address hold (rows 34 and 35); when the yearly report is published (row 40); the periods, and that a message nobody handled is never deleted (row 42); the known limits (row 45).
13. **Counsel**, with the questions as the research words them: OL E9.4 (receipt under national law; an order in a language not declared), OL E12.4 questions 1 to 7, OL E15.4, OL E20.4 and OL E21.4; AU E16.4 questions 1 to 7, AU E17.4 and AU E22.4 questions 1 to 6. The first to answer: whether sealed files go with a notification. And six that the design's review added: a DSA Article 9 order whose silence has no end ("until further notice"); whether a statement of korbat's own about the same post, sent during a hold, would itself be "information on the removal"; whether an earlier decision's copy of a post's text may still be shown to its author while Article 6 preserves the post; when and how a person is told of an order to provide information (DSA Art. 10(5)) and what the home state's law says instead; whether sign-in times are produced for such an order; and the words of the deletion mail while nobody has judged the report, with whether GDPR Art. 21 gives a right to object there.

Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `API_WEBAUTHN_RP_ID` before the first passkey is registered, when it should differ from the host of `API_APP_ORIGIN`; changing it afterwards strands every passkey. The staff console does not use it: staff keys are bound to the console's own relying party ID.
- `API_CONSOLE_ORIGIN` to the staff console's public origin, for example `https://korbat-staff.example`, preferably on a registrable domain of its own so browsers treat the app and the console as different sites (a subdomain of the app's domain works too), and `API_CONSOLE_RP_ID` left empty, so staff keys are bound to that hostname. Production refuses a plain-http console, an IP address or `localhost`, the app's hostname on any port, a console on a parent domain of the app's hostname, and a relying party ID other than the console's hostname or equal to the app's; no environment accepts the console's origin in `API_TRUSTED_ORIGINS`. Empty, the console is off. From sub-project 3c only the console decides reports and notices; with it off they are taken and wait, and staff are alerted to them.
- `WEB_CONTACT_EMAIL` to the users' contact address, which the report form names when the human check fails or the limits are reached and which the terms page shows; the web image refuses to build without one, and a production build refuses a placeholder (a domain ending in `.local`, `.localhost`, `.test`, `.invalid` or `.example`, or `example.com`, `example.org` or `example.net`). Its mailbox is set to load no remote content, and to keep deleted mail no longer than its host's shortest setting; a person reads it every working day (Moderation, the runbook's bullet on the users' contact mailbox). Since sub-project 3f the authorities' contact address is published as well, as `API_CONTACT_POINT` for the API and `WEB_CONTACT_POINT` for the web build, with korbat's state as `API_HOME_STATE` and `WEB_HOME_STATE`, the last step of the owner's list below: with the languages it may be addressed in, among them an official language of korbat's home state (DSA Art. 11(3), TCO Art. 15(2)), and notified to the national authorities where the home state requires it.
- `API_MODERATION_DISPATCH_HOUR` to the hour of the UTC day, 0 to 23, at which the day's decisions on reports and notices are released to those who sent them, in one batch, so that nobody can tell from a mail's minute when a decision was made; empty means 7.
- `API_NOTIFIER_ENC_KEY` generated (`node scripts/gen-dev-env.mjs` fills a placeholder), backed up off the server and rotated as the paragraph below says; `API_MODERATION_DEFER_UNPROVEN=off` and `API_MODERATION_RETENTION=on`, their defaults (Moderation says when each is changed).
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the app's public hostname points at `http://caddy:8080`, and the console's at `http://caddy:8090`, below); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY`, `API_TOTP_ENC_KEY` and `API_NOTIFIER_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used. Without `API_NOTIFIER_ENC_KEY` korbat can neither mail a signed-out notifier nor say who sent a notice. To rotate `API_NOTIFIER_ENC_KEY`, put the old key in `API_NOTIFIER_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_NOTIFIER_ENC_KEY`. Contacts are never re-encrypted, so the old key stays listed until no contact made under it remains, that is until `select count(*) from auth.notifier_contacts where name_enc like 'v1:%' or email_enc like 'v1:%'` answers 0. A contact can outlive 13 months while its notice is still owed a decision or a mail. Keep the old key off the server for as long as any backup holds such a contact.

Before the first report can concern a threat to someone's life or safety, obtain and record the channels for a notification under DSA Art. 18: the national police's, and Europol's for when the Member State concerned cannot be identified, each asked for beforehand from the national police or the Digital Services Coordinator (Moderation, the runbook's bullet on Art. 18).

A post that a decision withholds or removes leaves Explore at the next read, as it leaves every list; nothing acts on Explore alone. Since formula version 2 (account sanctions) a post that a later decision restores gets back the hours it was hidden, and a suspended account's posts and approvals leave the round while the suspension runs. Explore's cold start lasts about two days: only accounts at least 48 hours old count, so on a new instance Explore stays empty until the first accounts are that old.

The staff console's final hostname is chosen before the first enrolment. Staff keys are bound to it, since `API_CONSOLE_RP_ID` equals it, so moving the console later strands every staff key and means a new enrolment for every person; this includes a move to a domain of its own or behind a gate at another hostname. The tunnel gets a second public hostname, the console's, pointing at `http://caddy:8090`, with its HTTP Host Header setting left empty, so the API sees the console's hostname. Cloudflare Access in front keeps the hostname and the keys. A WireGuard or Tailscale gate keeps them only if it serves the same hostname over https with a certificate of its own, because Caddy runs with `auto_https off` while TLS ends at Cloudflare. Rocket Loader, Zaraz and Web Analytics stay off for the console's hostname, through a configuration rule for that hostname: the console's policy would block every script they add. Each staff member enrols two keys.

**The owner's list (sub-project 3d).** Section 17 of `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md` is the one list of what the 3d design assumes the owner has done; its parts A and B stand here. With every line of its part C undone korbat runs as it ships: nothing is scored, hashed, matched, purged or witnessed, and the public pages say so.

Part A, before going public (none needs an adapter):

- **A1. The quarantine's disk.** The volume `media-quarantine` on the server's encrypted disk and in no backup. Its owner and mode (uid 1000, mode 0700) come from the API's image; read them once from inside the service (Quarantine, step 4). Accept the price in writing: a lost disk loses the sealed files, and an image lost that way is told to its author as lost.
- **A2. How backups are made.** Name the backup of `media-store` and its lifetime, which must equal the 30 days of Backups, since a release prints the day after which no backup that is deleted on time holds a released file. Decide who destroys backups at once when an authority instructs it, and how a backup that is kept for an authority is marked and later destroyed by hand.
- **A3. One drill**, with harmless files: a seal for good on a test post, the move, the report and an assessment `illegal` recorded, the release refused for want of a leave, a leave recorded with `release-leave` under a test reference, the release, the destruction, `release-show`; then a restore from a backup taken before the release, `restore-import`, `release-replay`, the inventory, the files destroyed again, the site opened only then.
- **A4. Counsel, first question:** the period and the legal basis for keeping sealed images, who may destroy them and on whose word, and whether backups must be destroyed at a release. Whatever the answer, nothing is released on an assessment: only on a recorded leave or instruction to destroy, from an authority or a court, with its reference. Until counsel answers, the release by time stays unset, nothing is released by time, and the terms promise no destruction and no period.
- **A5. The national intake, when korbat registers with it.** Ask the authority korbat will report to, and note the answers in the R2 records: does it answer a report with an assessment; does it say when it has the evidence it needs; does it instruct hosts to delete, in what form and under what reference; does it ask hosts not to tell the person, and for how long. Name who records a leave: the command writes down what that person holds in writing and cannot check it, so a wrong leave and an admin's key together destroy. A recorded leave is never rewritten or deleted, so the target and the reference are checked before it is recorded; a leave recorded by mistake all the same is withdrawn (`release-leave --withdraw`) before any release rests on it; and when the authority asks that the person is not told, that is recorded with the leave (`--untold`) or on the report's record before any release.
- **A6. A second person at a destruction.** Decide whether a second person witnesses each release and each destruction. Every staff account is mailed at a release and at a hold ended without a report, and Home lists both for 30 days; with one person these are one, and the keeper is then the only other reader.
- **A7. The pages.** Read `/rules` and `/transparency` as they will be public: yearly banded counts and no rows, the recipients' method, the head's place, and the main design's amended promises. Each is yours to overturn before the first edition; after it, an edition is never changed.
- **A8. The keeper** receives the head's daily mail at an address the operator does not control (`API_HEAD_KEEPER_MAIL`), and keeps it.

Part B, before any tool is switched on:

- **B1. The impact assessment** (GDPR Art. 35), for each tool by itself and again before its measure is switched on, with the balancing test for the legitimate interest and the terms' section Automated tools read against it. Four dates, four settings: `API_AUTOMATION_DPIA_R1` and `API_AUTOMATION_DPIA_MATCH` for the two tools, `API_AUTOMATION_DPIA_R1_ACTS` and `API_AUTOMATION_DPIA_MATCH_ACTS` for the withhold and for the automatic seal. The API refuses to start with a tool or a measure on and its own date unset, and `/rules` prints each date in its own tool's block.
- **B2. The automatic seal needs more than a date.** It is read as a decision based solely on automated processing with a significant effect on the person, so GDPR Art. 22(1) applies and an exception of Art. 22(2) is needed. `API_AUTOMATION_R2_ACTS` is on only with the owner's impact assessment that covers the seal and with counsel's word. Its other value is the fallback: a match only raises an urgent item for an admin, and needs neither.
- **B3. The Member State and the operator's facts**: the legal form, staff and turnover. Every "does not bind" of the 3d design rests on a micro or small enterprise (DSA Art. 19(1)).
- **B4.** `APP_SITE` open means no `test` adapter: the API refuses the combination.
- **B5. Who answers within the published 24 hours.** From the day a measure is switched on, 24 hours is a public commitment, and only an admin answers a seal. Name who answers a request for a person when the one admin is away. If nobody can, the measures stay off. A program also stops by itself under a rule while 20 of its measures under that rule wait for a person or a request is 72 hours old, which is a floor and not a plan.
- **B6. Who answers an objection to the processing** (GDPR Art. 21), which the terms offer at the address under Contact: name the person and what they do with one.
- **B7. Counsel's advice on a held upload**, written by the owner into the line under A held upload (Automated tools) before `MEDIA_MATCH` is on. The console tells an admin neither to report nor not to; that line is the only place where korbat's rule for it stands.

Who can rewrite the audit log: the PostgreSQL superuser, the owner `korbat_migrate` (its password is in `infra/.env`, and the migrate service uses it at every start), and anyone with Docker access on the host (psql inside the postgres container is the superuser without a password). Any of them can change a row, recompute every later hash and move the head, and a plain `audit-verify` then passes; only a place kept before the change, by someone other than the person who made it, shows the change. That is the kept-head practice of the runbook under Staff console: each day the keeper, the staff member who does not run the server, copies the newest place and hash from the console's audit page and opens the place kept on the previous visit with "Go to place" to check its hash, and after each deploy and each week the operator runs `audit-verify` with every place the keeper has kept. In 3a the keeper's check is the only one independent of the operator, and it still reads through the operator's API, so it detects a change made in the database, not one that also changes the API's code to show the kept hashes. Since sub-project 3d a change is also held against the values published before it: each day's value is in the keeper's mail and, with `API_HEAD_WITNESS` on, in a timestamp authority's proof, neither of which the operator can change after that day (korbat's own page the operator could change too); with one person, they are all that the operator's own changes are held against. Run `audit-verify` before and after every PostgreSQL major upgrade: the chain's text embeds PostgreSQL's print of the stored JSON, and a version that printed it differently would fail every row with metadata, never pass a forged one. The head's daily value is public and goes to the keeper each day; the keeper's daily visit stays.

Counsel's list, to be answered before the gate above opens. From moderation cases: the period for which the draft of an access request's answer is kept; whether a removal of terrorist content on a notice makes korbat a provider that has taken action under TCO Art. 7(2); whether a final decision on content its author already deleted is mailed; whether, and under which national law, an access request may be restricted or deferred for a case korbat reported to an authority under DSA Art. 18 or for images it sealed for good, or that an authority's order concerns (GDPR Art. 23(1)(d)), what the answer and any extension under Art. 12(3) then say, and whether it names those authorities as recipients (Art. 15(1)(c)); whether 30 days suits the content backups hold; and every question that section 2 of `docs/superpowers/specs/2026-10-02-moderation-cases-3c-design.md` flags for counsel on the path for child sexual abuse material (its rows Suspected child sexual abuse material, Evidence, What the author sees of removed content, and Case targets and measures). From account sanctions: every question that section 2 of `docs/superpowers/specs/2026-10-09-account-sanctions-3e-design.md` flags for counsel, among them the reply window and what counts as sent, the protective suspension on images nobody assessed, termination, the restriction of reporting and its counts, how long the ledger's rows are kept, the handle retired under R4, and that korbat holds no account against its deletion. From authorities' orders: item 13 of the owner's list above, and every question that section 2 of `docs/superpowers/specs/2026-10-09-authorities-orders-3f-design.md` flags for counsel, among them what the author is told and when, the address kept while a report is owed, and the yearly report. From transparency and automation: A4 of the 3d owner's list above, and the questions of part E of section 17 of `docs/superpowers/specs/2026-10-09-transparency-automation-3d-design.md`, in its order. From importing posts: every question that section 2 of `docs/superpowers/specs/2026-10-22-import-3b-design.md` flags for counsel, in decision 28's list: holding an archive that carries other people's messages for up to 24 hours, and its transit through korbat's network provider (decision 4); the person's statement as the only proof that the posts are their own and were public, above all for Bluesky, whose repositories anyone can download (decisions 14 and 16); images imported only behind a real matcher (decision 15); not publishing an imported image whose match does not act, and holding the refused image and the address (decision 18); third parties' personal data in imported posts, their handles, replies and photos, for the impact assessment; the import's record kept 30 days after its end (decision 25); what the import screen says first and again beside the statement (decision 28); and the licence the terms take in imported posts and images, the same as for native ones, which the person must be able to grant (section 11.3 of that design).

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.

## Third-party notices

The app ships these files and libraries of others, each at the exact version `apps/app/package.json` pins, under the licence its own licence file states; that file is in the package under `node_modules` once installed.

- **Fraunces, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono**, from `@fontsource-variable/fraunces`, `@fontsource-variable/atkinson-hyperlegible-next` and `@fontsource-variable/atkinson-hyperlegible-mono` 5.3.0: the SIL Open Font License, Version 1.1. Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces); Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (github.com/googlefonts/atkinson-hyperlegible-next); Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (github.com/googlefonts/atkinson-hyperlegible-next-mono). Each package's licence is copied, whole, into `apps/app/assets/fonts/LICENSES/` (`fraunces-OFL.txt`, `atkinson-hyperlegible-next-OFL.txt`, `atkinson-hyperlegible-mono-OFL.txt`). korbat serves the packages' files as they are and neither subsets nor renames one, so no Reserved Font Name is touched.
- **Lucide**, from `lucide-react` (the web) and `lucide-react-native` (iOS and Android) 1.55.0: the ISC License, Copyright (c) 2026 Lucide Icons and Contributors. The icons Lucide derived from the Feather project, among them several korbat draws (x, info, link, clock, compass, lock, log-in, external-link and trash-2), are under the MIT License, Copyright (c) 2013-present Cole Bemis. Both notices stand in each package's `LICENSE`.
- **class-variance-authority** 0.7.1: the Apache License, Version 2.0, Copyright 2022 Joe Bell (its `LICENSE`; the package carries no NOTICE file), used unmodified. Its one dependency, **clsx** 2.1.1, is under the MIT License, Copyright (c) Luke Edwards (its `license`).
- **sonner** 2.0.8, the toasts on the web: the MIT License, Copyright (c) 2023 Emil Kowalski (its `LICENSE.md`).
- **sonner-native** 0.27.0, the toasts on iOS and Android: the MIT License, Copyright (c) 2025 Gunnar Torfi Steinarsson (its `LICENSE`).
````

### Replace `docs/superpowers/specs/2026-09-03-korbat-design.md` (whole file)

````markdown
# korbat — Design Spec

## Context

A pseudonymous social network where people can post opinions without a platform quietly removing them. Content limits are narrow and public: no sexual content (+18), no CSAM, no targeted racial hatred or harassment, no doxxing, no direct threats, no spam. Everything else stays up. Opinions are never a removal reason.

The credibility of the product rests on two things, which is why they get half the effort each:

- **Security.** Users who post unpopular opinions are targets. Account takeover, deanonymization, brigading, and admin compromise all have to be designed against from day one.
- **Transparent moderation.** Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human. There is no silent reach reduction and the feed is chronological, so "shadowban" is not something the system can do.

Decisions made during brainstorming:

| Decision | Choice |
|---|---|
| Platform | Expo (React Native) codebase, web target first, iOS/Android via EAS later |
| Identity | Pseudonymous handles, email required at sign-up, optional verified badge |
| Content v1 | Text + images (video is v2) |
| Moderation | Public rulebook, human review with written reasons, appeals; automation only for +18 and CSAM detection |
| Scale | Solo/small team, first few thousand users |
| Backend | Fully self-owned: custom TypeScript API, own Postgres, own auth, own object storage. No managed backend vendor. Client never touches the database. |
| Auth | Hand-rolled flows and sessions in the API, built on audited primitives (argon2id, SimpleWebAuthn, otplib). No auth SaaS or auth framework. |
| Hosting | Docker Compose stack, runs on a cloud VPS now and moves to the user's local server later. Cloudflare Tunnel in front, so no inbound ports are ever opened. |
| Feed | Chronological following feed + explore tab |
| Threat priorities | All four: account takeover, deanonymization/leaks, bots/brigading/ban evasion, platform integrity |

The app is called **korbat**. The folder `C:\Users\Lenovo\Desktop\cool` currently holds two unrelated OSINT projects; korbat gets its own folder, `C:\Users\Lenovo\Desktop\cool\korbat`, as a fresh git repo.

---

## 1. Architecture

```
Browser / Expo app
        │  HTTPS (cookie session on web, bearer token on native)
        ▼
Cloudflare (DNS, WAF, DDoS, edge rate limits, CSAM scanning, Turnstile)
        │  Cloudflare Tunnel (outbound-only connection from the server; no open inbound ports)
        ▼
┌─ Docker Compose host (VPS now, local server later) ───────────────────────┐
│  cloudflared  ── tunnel client                                            │
│  caddy        ── internal reverse proxy, TLS termination inside the box   │
│  api          ── Hono on Node 22, TypeScript, Drizzle ORM                 │
│     ├── owns auth: sign-up, OTP, passwords, TOTP, passkeys, sessions      │
│     ├── enforces authz + rate limits, all reads/writes to Postgres        │
│     └── serves media by signed path from object storage                   │
│  worker       ── image pipeline: re-encode, strip EXIF, blurhash, NSFW   │
│  admin        ── moderation console, separate container + hostname       │
│  postgres 16  ── single source of truth, RLS on as defense in depth       │
│  redis        ── rate-limit counters, OTP/challenge state, job queue      │
│  minio        ── S3-compatible object storage for images (private bucket)│
│  mailer       ── outbound only (SMTP relay: Postmark/SES/self-hosted)     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Monorepo** (pnpm workspaces):

```
apps/
  app/        Expo + expo-router, NativeWind, Reanimated. Web first.
  api/        Hono API, auth module, Drizzle schema + migrations, tests
  worker/     Image pipeline + scheduled jobs (IP-hash purge, explore refresh), consumes Redis queue
  admin/      Moderation console (Expo web or plain React). Separate deploy + hostname.
packages/
  contracts/  Zod schemas shared by app, admin, and api. Single source of truth for every request/response.
  rules/      The public rulebook as data (id, title, text, examples). Rendered in app and cited by moderation.
  db/         Drizzle schema + migrations, shared by api and worker.
infra/
  compose.yml, compose.prod.yml, Caddyfile, cloudflared config, backup script
```

**Why these pieces**

- **Hono**: tiny, TypeScript-native, middleware model makes security headers, auth, and rate limits composable. Runs anywhere Node runs, which is all a home server needs.
- **Drizzle**: typed schema and SQL migrations checked into git. No query builder magic that hides SQL, which matters for security review.
- **Own auth module** (section 3a): the user wants to own the backend end to end. We write the flows and session logic; cryptographic primitives come from audited libraries (`@node-rs/argon2` for argon2id, `@simplewebauthn/server` for passkeys, `otplib` for TOTP, Node `crypto` for random tokens and constant-time compares). Nothing else touches credentials.
- **Web sessions are httpOnly cookies set by the API**, never tokens in localStorage. This removes the most common XSS-to-account-takeover path on web. Native clients use bearer tokens in SecureStore.
- **MinIO** gives an S3-compatible API so image code is identical on a VPS, on a home server, and on real S3 if that's ever wanted. Bucket is private; the API issues short-lived signed GET URLs.
- **Cloudflare Tunnel** means the server makes an outbound connection and Cloudflare routes traffic in. No router port-forwarding, the home IP is never public, and WAF, DDoS absorption, Turnstile, and the free CSAM scanning tool still apply. Cloudflare Access can additionally gate the admin hostname behind its own login.
- **Same compose file everywhere**: develop on a laptop, run on a cheap VPS at launch, then `docker compose up` on the local server with a restored Postgres backup. Migration is a data move, not a re-architecture.

---

## 2. Data model (Postgres, Drizzle)

Only tables that v1 needs. PII (email, phone) lives in a separate `auth` schema that the public API role can only reach through a few security-definer functions, and is never joined into public responses.

**Auth schema (`auth.*`, owned by the auth module only)**
- `auth.users` — `id`, `email` (unique, citext), `email_verified_at`, `phone_hash` (for the verified badge; raw phone discarded after OTP), `password_hash` (argon2id, nullable when passkey-only), `totp_secret_enc` (encrypted at rest with a server key), `totp_enabled_at`, `recovery_codes_hash[]`, `failed_logins`, `locked_until`, `created_at`, `deleted_at`
- `auth.sessions` — `id` (random 256-bit, stored hashed), `user_id`, `device_id`, `created_at`, `expires_at` (30 days sliding, 12 months absolute), `last_used_at`, `revoked_at`, `reauth_at` (last fresh authentication, for sensitive actions)
- `auth.devices` — `user_id`, `device_hash`, `label`, `platform`, `first_seen_at`, `last_seen_at`, `ip_hash` (salted, 30-day purge), `revoked_at`
- `auth.email_codes` — `user_id` / `email`, `code_hash`, `purpose` (`signup`, `login`, `change_email`, `recovery`), `expires_at` (10 min), `attempts`, `consumed_at`
- `auth.passkeys` (auth phase 2) — `user_id`, `credential_id`, `public_key`, `counter`, `transports`, `backed_up`, `name`, `created_at`, `last_used_at`
- `auth.webauthn_challenges` — short-lived, in Redis rather than Postgres

**Identity (public schema)**
- `profiles` — `id` (= auth.users.id), `handle` (unique, immutable after 30 days), `display_name`, `bio`, `avatar_path`, `verified_at`, `reputation` (int), `created_at`, `deleted_at`

**Content**
- `posts` — `id`, `author_id`, `body` (≤ 1000 chars), `reply_to_id`, `quote_of_id`, `state` enum (`visible`, `withheld`, `removed`, `deleted_by_author`), `created_at`
- `post_media` — `post_id`, `path`, `width`, `height`, `blurhash`, `alt_text`, `nsfw_score`
- `follows`, `likes`, `reposts`, `bookmarks` — join tables with composite PKs
- `blocks`, `mutes` — user-level. Blocks are enforced in every read query, not just the UI.

**Trust & safety**
- `reports` — `reporter_id`, `target_type`, `target_id`, `rule_id` (from `packages/rules`), `details`, `weight` (from reporter reputation), `status`
- `cases` — one per moderation decision: `target`, `rule_id`, `action` enum (`none`, `withhold`, `remove`, `strike`, `suspend`), `public_reason` (shown to author), `moderator_id`, `created_at`
- `appeals` — `case_id`, `statement`, `status`, `reviewer_id` (must differ from original moderator), `decision_reason`
- `strikes` — `user_id`, `case_id`, `expires_at`
- `transparency_log` — anonymized public copy of every case: rule, action, date, whether appealed and outcome. Powers a public /transparency page.
- `audit_log` — append-only (no UPDATE/DELETE grants) record of every admin and moderator action.

**Feed queries**: following feed is `posts WHERE author_id IN (my follows) AND state = 'visible' AND author NOT IN (my blocks / blockers)`, keyset-paginated on `(created_at, id)`. Explore is a materialized view refreshed every few minutes ranking recent posts by engagement, same block filtering at read time.

---

## 3. Security design (threat by threat)

### 3a. Account takeover (own auth module, `apps/api/src/auth`)

The auth module is the single most reviewed code in the repo. It is one folder with one public interface, has no dependencies on the rest of the API, and every function in it has tests.

- **Sign-up**: email + 6-digit code (`auth.email_codes`, 10-minute expiry, 5 attempts, hashed at rest). Turnstile token verified server-side. Password optional at sign-up; if set, ≥ 12 chars and checked against the Have I Been Pwned range API (k-anonymity, only a 5-char SHA-1 prefix leaves the server). Hashed with argon2id (memory 64 MiB, iterations 3, parallelism 1; parameters stored alongside the hash for future upgrades).
- **Sign-in**: email code, or password. Constant-time comparison; identical response timing and message whether the email exists or not. After 5 failures the account locks for 15 minutes and the user gets an email.
- **MFA**: TOTP in v1 (`otplib`, secret encrypted with a server-side key from the secret store, 10 one-time recovery codes hashed). Passkeys in auth phase 2 with `@simplewebauthn/server`, then promoted as the default sign-in with password as fallback.
- **Sessions**: opaque 256-bit random ID; only its SHA-256 lives in `auth.sessions`. Web: httpOnly, Secure, SameSite=Lax cookie scoped to the API host, with a CSRF double-submit token for state-changing requests. Native: bearer token in SecureStore. Sliding 30-day expiry, 12-month absolute cap. Session ID is rotated on privilege changes (login, MFA enrol, password change).
- **Devices**: every session belongs to an `auth.devices` row. Users see their devices with platform, first/last seen, and can revoke one or all. First login from a new device sends an email alert with a one-click "this wasn't me" link that revokes it and forces a password reset.
- **Re-authentication**: handle change, email change, MFA removal, passkey removal, and account deletion require `reauth_at` within the last 5 minutes.
- **Rate limits**: per account, per email, and per IP/ASN sliding windows in Redis, with Cloudflare edge rules as the first layer on `/auth/*`.
- **Recovery**: email code to the verified address; if MFA is enabled, a recovery code is also required. No security questions, no SMS recovery (SIM-swap risk).
- **Explicit non-goals for v1**: OAuth social login (adds third-party trust and account-linking bugs), SMS login.

### 3b. Deanonymization and data leaks
- **PII minimization**: email and hashed phone exist only in `auth.users`. No API response type includes them except `/me`. Contracts in `packages/contracts` make this a compile-time property. The public API Postgres role has no SELECT on `auth.*`; the auth module uses its own role.
- **Images**: every upload is re-encoded with `sharp` (strips EXIF/GPS, defeats polyglot files), capped in pixel dimensions before decode (decompression-bomb guard), stored under a random ID, never the original filename. Uploads go through API-issued signed URLs with content-type and size constraints.
- **IP handling**: raw IPs never stored. Salted hash in `devices.ip_hash` for abuse correlation, purged by a 30-day job. Logs scrub tokens, emails, and IPs at the logger level.
- **No third-party trackers** in the client. Self-hosted, cookie-less analytics at most.
- **Defense in depth**: RLS enabled on every table even though only the API connects, so a SQL-injection or logic bug in one route cannot read another user's private rows. Three Postgres roles: `korbat_auth` (auth schema only), `korbat_api` (public schema, no DDL), `korbat_migrate` (DDL, used only by the migration job). MinIO bucket is private; media served through Cloudflare's CDN via short-lived signed URLs.
- **Encryption at rest**: Postgres and MinIO volumes on an encrypted disk (LUKS on the local server, provider-encrypted volume on the VPS). TOTP secrets additionally encrypted at the application layer. Backups encrypted with `age` before leaving the box.
- **User rights**: self-service data export (JSON) and account deletion (hard delete of profile/content, auth row anonymized) from v1.
- **Web hardening**: strict CSP with nonces, HSTS, `frame-ancestors 'none'`, CORS allowlist, `Referrer-Policy: no-referrer`.

### 3c. Bots, spam, brigading, ban evasion
- Sign-up friction: email verification, Cloudflare Turnstile, disposable-email domain blocklist, per-IP/ASN sign-up limits.
- New accounts: for the first 24 hours, max 5 posts/hour and 20 replies/hour; no reposts or quotes for 48 hours. Limits relax as `reputation` grows (established accounts: 30 posts/hour).
- Reputation: a simple score (account age, verified badge, upheld reports, strikes). Used to weight reports and to size rate limits. Never used to rank or hide content.
- Report weighting: reports from low-reputation or brand-new accounts count less. A spike of reports on one target from accounts that follow each other is flagged as **brigading** and protects the target (case goes to a senior queue) rather than triggering action.
- Ban evasion: hashed device fingerprint + email-domain heuristics at sign-up; matches surface to moderators as a signal, not an auto-ban.
- Every write endpoint has a per-user and per-IP rate limit declared next to the route.

### 3d. Platform integrity
- Cloudflare WAF managed rules, DDoS protection, and edge rate limits before traffic reaches the API.
- Every request body validated with the shared Zod contract before any handler runs. Drizzle parameterizes all SQL.
- Admin console on its own hostname and deploy. Admin/moderator accounts require TOTP (passkey once available). Every action lands in the append-only `audit_log`.
- Secrets in Docker secrets / a root-only `.env` on the host, never in the repo. `.env.example` only. Containers run as non-root with read-only root filesystems where possible; only Postgres, MinIO, and Redis get writable volumes.
- **Backups**: nightly `pg_dump` + MinIO mirror, encrypted with `age`, pushed off-box (cheap object storage or a second machine). Restore is rehearsed in sub-project 4 and is also the migration path from VPS to the local server.
- **Home-server specifics**: Cloudflare Tunnel is the only ingress; SSH only over Tailscale or the LAN; automatic OS security updates; UPS or at least a clean-shutdown script so Postgres never sees power loss mid-write.
- CI: typecheck, vitest, semgrep (OWASP ruleset), `pnpm audit`, Renovate for dependency updates, OWASP ZAP baseline scan against a preview deploy.
- Image processing runs in a separate worker process with memory and time limits so a malicious file can't take down the API.
- Structured logging with request IDs; alerts on auth-failure spikes, 5xx rate, and moderation queue age.

---

## 4. Content rules and moderation flow

### The rulebook (`packages/rules`)
Six rules, each with an ID, one-paragraph text, and two or three examples of what is and is not covered. Rendered in-app at `/rules` and cited by ID in every case.

| ID | Rule | Enforcement |
|---|---|---|
| R1 | No sexual or pornographic content | Automated image score → **withheld** pending human review. Human decides. |
| R2 | No child sexual abuse material | Cloudflare CSAM hash match → auto-remove, account suspended, NCMEC report. Only fully automated removal in the system. |
| R3 | No targeted hatred or harassment based on race, ethnicity, religion, or similar protected traits | Report-driven, human decision. Criticism of ideas, policies, groups' actions, or public figures is explicitly allowed. |
| R4 | No doxxing (publishing private info) | Report-driven, human. Withhold first when the report is credible, decide within SLA. |
| R5 | No direct threats of violence | Report-driven, human, senior queue. |
| R6 | No spam, scams, or impersonation | Report-driven, human. Reputation signals help triage. |

### What automation may and may not do
- **May**: score images for R1 and mark them `withheld`; hash-match for R2; raise priority on reports (e.g. many high-reputation reporters); flag brigading patterns.
- **May not**: remove text for any rule, reduce reach, hide from explore, or suspend an account (except R2).

### Case lifecycle
1. **Report** — reporter picks a rule, optionally adds context. Duplicate reports on the same target merge into one open case. Weight accumulates from reporter reputation.
2. **Queue** — moderators see cases sorted by weight and age. R2/R5 go to a senior queue. Brigading-flagged cases go to the senior queue with the target protected (no withholding on report volume alone).
3. **Decision** — moderator picks an action (`none`, `withhold`, `remove`, `strike`, `suspend`) and must write a `public_reason` citing the rule. The author sees the exact content that was actioned, the rule, the reason, and an **Appeal** button. Strikes expire after 90 days; suspension requires 3 active strikes or an R2/R5 case.
4. **Appeal** — one appeal per case, free-text statement. Reviewed by a different moderator. Outcome and reason are shown to the author. Upheld appeals reverse the action and remove the strike.
5. **Transparency** — every closed case is copied to `transparency_log` without user identifiers. Public `/transparency` page shows monthly counts per rule, per action, appeal rate, and reversal rate.

### What the author experiences
- A withheld post shows to the author as "Under review for R1, usually within 24h" with the content still visible to them. Nobody else sees it.
- A removed post stays in the author's view with a red status chip and the reason. It is never silently gone.
- Suspension shows the case list and a link to appeal each one.

---

## 5. UI direction
Delivered by the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): see section 9, 2026-10-21.

The security and transparency story must be *visible* in the UI, not buried in settings. The frontend-design skill will be used at implementation time; this is the brief it gets.

- **Stack**: Expo + expo-router (file routes work on web and native), NativeWind for styling, Reanimated for motion, `expo-image` with blurhash placeholders.
- **Layout**: desktop web is three columns (nav / timeline / context panel with explore and transparency stats). Tablet collapses the context panel. Phone is a single column with a bottom tab bar and a floating compose button. Same components across breakpoints.
- **Look**: dark-first with a light theme, high-contrast editorial type (one display face for handles and headings, one text face), generous line height, restrained color. One accent for actions, and a fixed semantic set for status chips: under review (amber), removed (red), verified (blue). Avoid generic AI-looking gradients and glassmorphism.
- **Composer**: bottom sheet on phone, inline card on desktop. Character counter, image picker with alt-text prompt, live warning if the image scores near the R1 threshold *before* posting.
- **Transparency surfaces**: status chips on posts; "Your cases" screen; public `/rules` and `/transparency`; security screen listing devices, MFA state, and recent sign-ins with a one-tap "revoke all".
- **Accessibility**: WCAG AA contrast, reduced-motion respected, all images require or auto-suggest alt text, full keyboard navigation on web.
- **Motion**: small and purposeful. Sheet spring, like/repost micro-feedback, timeline insert of new posts. Nothing decorative.

---

## 6. Decomposition and build order

Each sub-project gets its own spec → plan → implementation cycle. Order chosen so every step ships something testable and the security floor exists before user content does.

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| 0 | **Foundation** | Monorepo scaffold, `packages/contracts`, `packages/rules`, `packages/db` with Drizzle schema + migrations + the three Postgres roles, `infra/` Docker Compose (postgres, redis, minio, caddy, api, worker, cloudflared), Hono skeleton with security headers, CI (typecheck, vitest, semgrep, audit), hello-world reachable through a Cloudflare Tunnel | — |
| 1 | **Identity & auth** | Split into 1a core accounts and sessions (sign-up with email code and 16+ age check, optional password + HIBP, argon2id, lockout, TOTP MFA + recovery codes, cookie + CSRF / bearer sessions, devices, "wasn't me" link, re-auth, staff MFA; spec `2026-09-14-identity-auth-1a-design.md`), 1b account lifecycle (profile + handle changes, verified badge, data export, account deletion), 1c passkeys. | 0 |
| 2 | **Posting & feed** | Split into 2a text posting and feed (posts, replies, quotes, likes, reposts, bookmarks, follows, blocks/mutes, Following and Latest timelines, threads, profile pages, write limits, web screens; spec `2026-09-17-posting-feed-2a-design.md`), 2b images (upload, worker re-encode, EXIF strip, blurhash, alt text, media in composer and lists; spec `2026-09-18-images-2b-design.md`), 2c explore (ranked view, refresh job, tab), and 2d engagement, which has its own row below because it is built after 3 and 3b. | 1a |
| 3 | **Trust & safety** | Split into 3a the staff console foundation (staff keys, staff sessions, per-action step-up, the audit log as a hash chain, the console app; spec `2026-09-28-staff-console-3a-design.md`), 3c moderation cases (report flow and notices, case queue, decisions with public reasons, strikes, suspensions, appeals, author-facing case screens), and 3d transparency and automation (transparency log + page, rules page, brigading detection, CSAM scanning hookup, NSFW image scoring with automatic withholding for R1, moved here from 2b on 2026-09-18 so that no post is withheld before a human can review it). See section 9, 2026-10-01. | 2 |
| UI | **Interface and experience** (added 2026-10-12) | korbat's look and feel raised to the level of the best social apps while it keeps its values: section 5 made real (dark-first with a light theme, editorial type, three columns on desktop, purposeful motion that respects reduced motion, WCAG AA), a design system of owned components on proven open-source libraries (each checked in its brainstorm for version, licence, upkeep and fit on Expo web and native, under the 7-day release-age floor and with no AGPL), delight without dark patterns (the reader's place kept, a feed that ends, moderation status shown on the post, haptics by intent with an off switch), and the console restyled within its strict content security policy. Its brainstorm starts from a study of Bluesky's open-source app. Delivered by the UI sub-project (`docs/superpowers/specs/2026-10-21-interface-experience-ui-design.md`): see section 9, 2026-10-21. | 2, 3 |
| 3b | **Import from other platforms** | Archive upload for X, Mastodon, Bluesky; quarantine bucket; sandboxed streaming parser; preview and select; imported posts on profile only; same image pipeline and CSAM scan as native posts; one-click undo. See section 6a. Delivered by sub-project 3b (`docs/superpowers/specs/2026-10-22-import-3b-design.md`): see section 9, 2026-10-27. | 2, 3 |
| 2d | **Engagement** (added 2026-09-30) | In-app notifications (replies, mentions, quotes, follows), mentions stored as data, avatars through the 2b pipeline, share cards for public posts and profiles (per-page titles and Open Graph/Twitter meta served by korbat itself), and help on a new account's first visit. A proposed scope that its brainstorm confirms; see section 9, 2026-09-30. | 2, 3 |
| 4 | **Hardening & launch** | Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test checklist walked | 3, 3b, 2d |
| 5 | **Native builds** | EAS builds for iOS/Android, SecureStore sessions, push notifications, store listings | 4 |

Sub-project 0 is small and will be planned immediately after this design is approved. Each later one starts with a short brainstorm to confirm details that this document leaves at the level of intent.

---

## 6a. Importing posts from other platforms (added 2026-09-14)
Delivered by sub-project 3b (`docs/superpowers/specs/2026-10-22-import-3b-design.md`): see section 9, 2026-10-27.

Users can bring their post history with them. The feature is opt-in, owner-driven, and treated as untrusted bulk input.

**How a user imports**
1. The user downloads their own official data export from the other platform: X "Download an archive of your data", a Mastodon account archive, or a Bluesky repository export (`.car`). Meta (Threads/Instagram/Facebook) and Reddit exports come later as extra adapters.
2. They upload that file on korbat's import screen. korbat never asks for another platform's password, never scrapes, and does not fetch posts by handle. Fetching by handle would let anyone import someone else's posts, which is impersonation.
3. korbat parses the archive in the worker and shows a preview: post count, date range, image count, and what will be skipped. The user picks everything, a date range, and whether to include replies.
4. Nothing is published until the user confirms. The import can be undone later in one action, which deletes every post from that import.

**Security controls**
- **Quarantine**: archives upload through a short-lived signed URL into a separate private `korbat-imports` bucket, never the media bucket. Size cap 2 GB. The archive is deleted as soon as parsing finishes, or after 24 hours if the user abandons the preview.
- **Sandboxed parsing** in the worker with its own memory and time limits: streaming unzip, reject path traversal, absolute paths and symlinks, cap entry count and total uncompressed size (zip-bomb guard), and read only an allowlist of known file paths per source. X's `tweets.js` is stripped of its `window.YTD...=` prefix and parsed as JSON, never evaluated.
- **Data minimisation**: archives contain DMs, IP logs, phone numbers, contacts and ad data. Only the allowlisted post and media files are opened. Nothing else is read, stored or logged.
- **Same rules as native posts**: every imported image goes through the normal pipeline (re-encode, EXIF strip, NSFW score, CSAM hash). An R1 score withholds that post for human review. A CSAM match aborts the whole import and follows the R2 process. Text is never auto-removed; it can be reported like any post.
- **Anti-abuse**: email-verified accounts only, one active import per user, at most 50,000 posts per import, worker concurrency capped so imports cannot starve normal traffic.
- **Provenance label**: every imported post shows "Imported from X · original date". An optional ownership check (put a one-time korbat code in the source profile's bio) adds a "verified import" mark, which helps against people importing archives that are not theirs.

**Product behaviour**
- Imported posts appear on the author's profile in original date order. They do not enter followers' chronological feeds or explore, so a 10,000-post import cannot flood anyone's timeline.
- @mentions and links stay as plain text. korbat does not map other platforms' users to korbat accounts, so it never implies someone is on korbat.
- Reposts of other people's content are skipped. Threads of the user's own posts are kept as threads.

**Designed for expansion**
- Each source is an adapter with two functions: `detect(entries)` recognises the archive, and `readPosts(stream)` yields a normalised `ImportedPost` defined in `packages/contracts`. Adding Threads or Reddit is a new adapter; the pipeline, preview and moderation path do not change.
- Schema is added by migration in this sub-project: an `import_jobs` table (owner, source, status, stats, timestamps) and nullable columns on `posts` (`import_job_id`, `source`, `original_created_at`, `original_url`). These are additive, so the Foundation schema does not need to anticipate them.

---

## 7. Testing and verification

- **Unit** (vitest, `apps/api`): contracts, rate-limit logic, reputation and report weighting, feed query builders, image pipeline (assert EXIF gone, dimensions capped, output is a fresh encode).
- **Auth module tests** (highest coverage bar in the repo): every flow in section 3a, including negative cases: expired codes, attempt exhaustion, lockout timing, session hash never equals the raw ID, CSRF token rejection, re-auth window expiry, recovery with and without MFA, constant-time behavior for unknown vs. known emails (timing assertion with tolerance).
- **Integration**: API against the Docker Compose stack (`docker compose -f infra/compose.yml up -d postgres redis minio`). Covers session cookie behavior, block enforcement in feed queries, case lifecycle including appeal-by-different-moderator rule, audit-log immutability (UPDATE/DELETE must fail), signed media URL expiry.
- **RLS and role tests**: run each table's policies as `korbat_api` and confirm it cannot SELECT from `auth.*`, cannot run DDL, and cannot bypass block filtering.
- **E2E** (Playwright on the Expo web build): sign-up → MFA → post with image → report → moderator decision → author sees reason → appeal → reversal.
- **Security checks in CI**: semgrep OWASP ruleset, `pnpm audit` at high severity, ZAP baseline scan against the preview URL, CSP header assertion test, rate-limit smoke test (burst must 429).
- **Manual pre-launch**: OWASP ASVS level 2 checklist walk-through, sensitive-action re-auth spot checks, "revoke all devices" actually invalidates sessions, deleted account leaves no public trace.

Every sub-project's plan will include its own slice of this list as acceptance criteria.

---

## 8. Immediate next steps on approval

1. Save this design as the spec at `C:\Users\Lenovo\Desktop\cool\korbat\docs\superpowers\specs\2026-09-03-korbat-design.md` in the new repo and commit it.
2. Run the writing-plans skill to produce the detailed implementation plan for **sub-project 0 (Foundation)**. Its scope:
   - `pnpm` monorepo at `C:\Users\Lenovo\Desktop\cool\korbat` with `apps/app` (Expo, expo-router, NativeWind, web target), `apps/api` (Hono, vitest), `apps/worker` (queue consumer skeleton), `apps/admin` (placeholder), `packages/contracts` (Zod), `packages/rules` (the six rules as data), `packages/db` (Drizzle schema + migrations).
   - `infra/compose.yml`: postgres 16, redis, minio, caddy, api, worker, cloudflared, all non-root; `infra/compose.dev.yml` override that skips cloudflared and exposes localhost ports. Init SQL that creates the `auth` schema and the three roles (`korbat_auth`, `korbat_api`, `korbat_migrate`).
   - Drizzle schema for every table in section 2, initial migration run by a one-shot `migrate` service using `korbat_migrate`, RLS enabled on all public tables.
   - Hono skeleton: security-headers middleware (CSP, HSTS, frame-ancestors, referrer policy), request-ID logging with PII scrubbing, Zod validation middleware, Redis rate-limit middleware, health endpoint, and a stub session middleware that sub-project 1 replaces with the real auth module.
   - CI (GitHub Actions): typecheck, vitest, semgrep OWASP ruleset, `pnpm audit --audit-level high`, `docker compose config` validation, Renovate config.
   - `.env.example` for every app and for `infra/`; secrets never committed.
   - Done when `docker compose up` on a laptop serves the health endpoint and the Expo web shell, and the same stack is reachable through a Cloudflare Tunnel on a throwaway subdomain.
3. Sub-projects 1 to 5 each get a short brainstorm to confirm details, then their own plan, in the order in section 6.

## 9. Amendments

### 2026-09-18, from the 2b images design (`2026-09-18-images-2b-design.md`)

- **Object storage.** MinIO's community edition was archived upstream in 2026 and gets no security fixes. korbat keeps images in two Docker volumes behind a small file protocol between the API and the worker. Wherever this document says MinIO, bucket or signed URL, read: volumes, and uploads and downloads streamed through the API. The storage interface leaves room for an S3 adapter.
- **The worker** only processes images. It has no network, no database or Redis credentials and no capabilities. Scheduled database jobs named in this document (the IP-hash purge, the explore refresh) run in the API under a Redis lock.
- **NSFW scoring** and the automatic withholding for R1 move from row 2 to row 3 of the build order, together with the composer warning in section 5.
- **`post_media`** has the shape of section 3 of the 2b design: an owner, a status, optional post and position until the image is attached, and no `path` column.
- **Media serving.** Images of visible posts are public and cacheable for five minutes at URLs ending in `.webp`, which is what Cloudflare's cache and its CSAM scanning tool need. Images of withheld and removed posts reach only their author and are never cached. The Cloudflare zone must use Browser Cache TTL "Respect Existing Headers".
- **Backups** (section 3d) cover the `media-store` volume instead of a MinIO mirror.
- **Imports (section 6a).** The quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, so imports need chunked uploads.

### 2026-09-23, from the audit (`2026-09-23-audit-fixes-design.md`)

Four read-only reviews (auth, image pipeline and deployment, social module, web client) and a dependency check were run on the repository at `f0c9799` before work continued. The audit design records every finding and its fix. What changes in this document's terms:

- **Technologies (section 1).** TypeScript 7 (the native compiler) for the API, worker and packages, TypeScript 6.0 for the Expo app; esbuild called directly instead of tsup; ioredis 6; **Valkey 9.1 (BSD-3) instead of Redis** (the service keeps the name `redis`, on a new volume `valkeydata`, because Valkey 9 cannot read Redis 7.4's RDB format 12 and the old volume held only transient state); **PostgreSQL 18** on a new volume, with `scripts/pg-major-upgrade.mjs` moving a database from the 16 volume; Caddy as its own user on port 8080; cloudflared, Caddy, the API and the data services on separate networks; every image pinned by digest, pnpm installed through corepack from its hash.
- **Retention (section 3b).** The IP-hash purge and the retention of codes, sessions and security events run in the API every ten minutes (audit design, section 5).
- **Method (section 6).** Sub-projects are still dry-run task by task in a scratch clone with a gated runner and turned into verified prompts; from this batch on the prompts are replayed into the repository by a deterministic script (`replay.py` in the scratch tooling) instead of a fresh model session per prompt. The proof is unchanged: every gate passes in the repository, every written file is byte-identical to the dry run, and `verify_prompts.py` reproduces the repository. The scratch clone lives at `C:/Users/Lenovo/Desktop/cool/korbat-scratch/` (throwaway), outside the temp folder Windows Storage Sense prunes.
- **Status and order (section 6).** Done: 0 (except Task 16, the tunnel), 1a, 2a, 2b, the screen-reader fix, this audit batch. Next, in order: 1b account lifecycle (profile and handle changes, verified badge behind a provider interface, data export, account deletion), 1c passkeys, 2c explore, 3 trust and safety (with NSFW scoring), 3b import, 4 hardening (owner-scoped RLS, backups and alerting, ZAP, policy texts), 5 native builds. The steps that need the user's own accounts come last and are written up as runbooks: the Cloudflare Tunnel, WAF and CSAM tool (Foundation Task 16 and sub-project 4), the EU mail relay, a verification provider for the badge, and the Expo, Apple and Google accounts for sub-project 5.

### 2026-09-24, sub-project 1b (`2026-09-24-account-lifecycle-1b-design.md`)

- **Delivered (section 6, row 1).** Profile editing, handle changes (once every 30 days, old handles reserved for ever: a change from section 2's "immutable after 30 days"), email change, the verified badge as a phone proof behind a `VerificationProvider` (development provider and a Vonage Verify adapter; the production credentials are the user's, runbook in the 1b design's section 13), a streamed ZIP export, and account deletion (fresh authentication, emailed code, typed handle; tombstoned posts, anonymised rows, a resumable purge job). Avatars stay deferred.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 2a, 2b, the screen-reader fix, the audit batch. Next, in order: 1c passkeys, 2c explore, 3 trust and safety, 3b import, 4 hardening, 5 native builds; the account-dependent steps stay runbooks (the tunnel and WAF, the mail relay, the verification provider, the store accounts).

### 2026-09-27, sub-project 1c (`2026-09-25-passkeys-1c-design.md`)

- **Delivered (section 3a and section 6, row 1, phase 2).** Passkeys for sign-in and re-authentication through `@simplewebauthn/server` 14 behind one wrapper with korbat's own checks; WebAuthn challenges are stateless and sealed rather than kept in Redis (a change from section 2's `auth.webauthn_challenges` note), so unauthenticated requests store nothing. Session factors with two levels of fresh authentication, in-place token rotation, and one lockdown routine behind every "this wasn't me". Passkeys are not yet promoted to the default sign-in: the email code stays the recovery root.
- **Left to later sub-projects.** Staff sign-in with a passkey as the required second factor (sub-project 3, with the admin console), bearer sessions and native passkeys in the apps (sub-project 5), and the production domain that fixes the relying party (Foundation Task 16, the user's).
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, the screen-reader fix, the audit batch. Next, in order: 2c explore, 3 trust and safety, 3b import, 4 hardening, 5 native builds.

### 2026-09-28, sub-project 2c (`2026-09-28-explore-2c-design.md`)

- **Delivered (section 2's feed queries and section 6, row 2).** Explore: a ranked list of recent original posts, refreshed every five minutes by a job in the API into numbered rankings (`explore_runs`, `explore_items`) rather than a materialized view. On PostgreSQL 18 a materialized view has no row level security, is not listed in `pg_tables`, and `korbat_api` could refresh it only with a new `GRANT MAINTAIN`; a table also takes the time as a parameter and keeps the previous ranking for readers paging through it. One input, the number of distinct eligible approving accounts; the whole formula published at `/explore/about` with a version and a change log; an author switch and an author-only status. Search and hashtags, which the 2a design placed in 2c, are not part of it: each is a sub-project of its own if wanted.
- **Reputation (section 3c).** Explore reads account age as a rule about which engagement is valid (the engaging account must have been at least 48 hours old), never as a weight. Reputation still never ranks or hides content, and no ranking reads the badge, followers or reports.
- **Automation (section 4).** No lever acts on Explore alone. A post leaves it only through its moderation state, which applies to every list at once, its author's switch or deletion, and the reader's blocks and mutes; that is the only form an Explore exclusion may take, for moderators as for automation.
- **Left to later sub-projects.** Sub-project 3: a restored time for posts restored after review, which restarts the window and the age; whether a suspended account's likes and reposts count and whether its posts are candidates, each a formula change with a new version; rule R6 naming coordinated engagement. Sub-project 3b: the import marker in the one candidate predicate (`exploreRules` in `apps/api/src/social/repo.ts`). Sub-project 4: per-IP engagement limits; the like counts a blocker can compare after a block, since 2a's block deletes the pair's likes; the reviewed terms with the Explore sentence, and whether Article 27 of the Digital Services Act applies. Sub-project 5: the web polish the audit parked at "2c or 5" (the light theme, per-screen titles, a branded error boundary, reanimated on the web), and rows a list appends that a headless Chromium draws only at the next scroll.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, the screen-reader fix, the audit batch. Next, in order: 3 trust and safety, 3b import, 4 hardening, 5 native builds.

### 2026-09-30, the engagement slice (roadmap)

- **Why (section 6, row 2d).** A review of the repository at `21e0ef9` found that the build order led to a launch with nothing that brings a person back or brings new people in. There are no notifications, mentions are links made in the client only (2a design, section 1), avatars were deferred by 1b, a link preview of a public post or profile shows the bare web shell under one title, and a new account gets no help on its first visit. Sub-project 4 hardens and launches what exists, so a slice for these comes before it.
- **Proposed scope, confirmed in its brainstorm.**
  - In-app notifications for replies, mentions, quotes and follows. Whether likes and reposts notify, and how they are grouped, is for the brainstorm. Web push is weighed there too; native push stays in sub-project 5.
  - Mentions as data: a handle in a post links to the account it named when the post was written, and blocks hold both ways, as in every 2a read and write.
  - Avatars through the 2b pipeline and sub-project 3's image scanning. This reverses 1b's deferral; the brainstorm decides how the text-first layouts of section 5 change.
  - Share cards: per-page titles and Open Graph and Twitter meta for public posts and profiles, generated by korbat's own server. Two routes exist: a Hono route behind Caddy that fills the web shell, or expo-router's server output once Expo SDK 58 is stable and past the release-age floor. A card never shows more than a signed-out reader sees, so withheld, removed and deleted posts get none. Whether pseudonymous profiles are indexed and unfurled by default is decided there. Titles for these pages move here from the web polish parked for sub-project 5 (2c amendment); the rest of that list stays in 5.
  - Help on a new account's first visit. If it suggests accounts, it does so by a published rule, never by reputation (section 3c).
- **Why after 3 and 3b.** Avatars and card images must pass sub-project 3's scanning like every other image, and cards must follow its moderation states. Imported posts (section 6a) exist by then; their @mentions stay plain text and never notify.
- **Unchanged.** Keyword search and hashtags stay out: the 2a and 2c designs keep them out because keyword search is a ready tool for finding a target's posts, and exact handle lookup remains. The feed stays chronological, and Explore's formula is untouched.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, the screen-reader fix, the audit batch. Next, in order: 3 trust and safety, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-01, sub-project 3a (`2026-09-28-staff-console-3a-design.md`)

- **Delivered (section 3d and section 6, row 3).** The staff console foundation, meaning staff keys, staff sessions, per-action step-up, the audit log as a hash chain and the console app. Staff keys are WebAuthn credentials on the console's own relying party whose authenticator reported user verification and no backup eligibility, enrolled only through one-time links that `staff.js enroll` issues as the migrator, which the database enforces, and revoked from the command line, by a demotion, by an account's deletion or by a counter that goes backwards. Staff sessions last 12 hours at most and 15 minutes without an action by their person, are read from the database at every request and live only on the console's origin, behind a staff gate. The step-up confirms each action that changes something with the session's own key, bound to the action, its target and its parameters, and the record stores the assertion. The audit log is chained in an order and at times the database alone sets, every auth-side fact written in the same transaction as its change, and `staff.js audit-verify` recomputes it in its own code against heads kept off the server.
- **The console (sections 1 and 3d).** Wherever this document says the admin console is a container, deploy or hostname of its own with TOTP (lines 48, 63 and 154), read: `apps/admin`, a plain React page built into Caddy's image and served by a second Caddy site on its own hostname, which proxies only `/api/staff/*`. Staff powers need a staff key; TOTP, passwords, email codes and passkeys never give them. Cloudflare Access in front of the console stays an optional extra. This replaces the 1c amendment's staff sign-in with a passkey as the required second factor.
- **Sub-project 3 is split (section 6, row 3)** into three parts, each dry-run, reviewed and replayed on its own. 3a, the staff console foundation, is the part above. 3c, moderation cases: notices and reports, Article 16 notices of the Digital Services Act included, which anyone may send, signed in or not, about content they consider illegal under EU or national law; cases and their events, decisions with statements of reasons, evidence, strikes, suspensions, appeals, the author's case screens and mails, Explore's formula version 2, the export and the terms; and a path of its own for authorities' orders, among them removal orders for terrorist content under Regulation (EU) 2021/784. 3d, transparency and automation: the public transparency and rules pages, R1 scoring in a no-network worker, the R2 quarantine and the Cloudflare runbook, PDQ and SHA-256 hashes of every upload kept with the image, the purge of Cloudflare's cache when a post is withheld or removed, brigading signals, and the publication of the audit head. Import keeps its name, 3b, and needs 3d's R2 hookup.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, the screen-reader fix, the audit batch. Next, in order: 3c moderation cases, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-09, sub-project 3c (`2026-10-02-moderation-cases-3c-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Moderation cases: reports and Article 16 notices that anyone can send, signed in or not, on a rule or on the law, each named target in exactly one open case; decisions that are the statement of reasons, with several measures in a ledger from which the database, by one writer, derives every restriction of a post, an image or a profile field, each decision confirmed by the deciding person's staff key in the same transaction; evidence copied as text and images held by reference; the author's appeal and the reporter's re-examination; the console's queue, case page, composer with its preview, and appeals; the app's report form, status page and case screens; the export's `moderation` member, the terms' moderation sections and rulebook version 2; retention by consumer; migrations 0014 to 0018. A report or finding of child sexual abuse material freezes what its case reaches, nobody at korbat opens the images, a person seals them for everyone while an admin decides, and the release of sealed images waits for 3d.
- **Context (line 5, "Everything else stays up") and the rulebook as the complete list of reasons (section 4).** Read: everything else stays up unless it is illegal under EU or national law and korbat is told so in a notice (an authority's order joins with 3f). Article 16 notices on a legal ground bind korbat, and keeping evidently illegal content up after a notice costs the hosting exemption. Removals for law name the law, never a rule, and are counted apart.
- **Context, line 10 ("Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human").** A removal on a legal ground cites the law. Images reported as child sexual abuse material can be sealed without anyone at korbat having opened them, and are then shown to nobody, their author included, while the post's text stays; an R4 body is blanked once the removal is final. What korbat does while it decides cannot be appealed and ends with the case's final decision, which can be (a seal taken while deciding ends with the admin's answer to the case's reports of that kind). People who reported get a re-examination of "no action" instead of an appeal.
- **The trust and safety tables (section 2).** `reports`, `cases` with one `action`, `appeals` one per case, `strikes` and `transparency_log` are replaced by intakes, items, cases, decisions with several measures in a ledger, the author's appeals per decision, re-examination items, and evidence (3c design, section 6). Strikes are 3e's; `transparency_log` becomes 3d's to define in the shape of the Commission's Transparency Database. None of the old tables could hold a notice from someone without an account, a decision with several measures, or a statement's elements, and nothing had ever written them: migration 0014 drops them.
- **Reputation, report weighting and automation raising priority (section 3c, and section 4's automation list and case lifecycle step 1).** Reports are not weighted, reputation is not computed and its column is dropped, and the queue orders by severity (three lanes) and age; automation in 3d may flag, never weight. Weighting slows the legal path for strangers by design, rewards aged brigades, and turns strikes into hidden penalties. Write limits stay on account age, as 2a and 2b built them.
- **The senior queue (section 4, case lifecycle step 2).** A team of one or two has no separate senior moderators. Every final decision that answers a report or finding of child sexual abuse material or an R5 item, or that cites R2 or R5, whatever its outcome, every lifting of a seal, and every correction of such a decision, is an admin's, and so is the review of a decision that cites R2 or sealed images; a review of an R5 restriction is any eligible moderator's. Any moderator may withhold such content, or seal reported images, while deciding, and such cases sit in lane 0. Brigading-flagged cases are 3d's.
- **Decision (step 3).** A decision takes several measures, carries a statement of reasons whose every element is data, and names a snapshot of what it was made on. The promise about strikes and suspension moves wholly to 3e. "The author sees the exact content that was actioned" holds while korbat keeps the case's copies (until every restriction of the case is final for its author, about six months after they were told when they do not appeal), except for sealed images (the author sees the decision and the post's text, and each sealed image as a placeholder) and R4 once final (the body blanked, the chip and reason kept). Afterwards the decision screen says on which day korbat's copy was erased, and a removed post or image itself stays in its author's own view while they keep it.
- **Appeal (step 4).** One appeal per final restriction, by its author, for six months, while any of it is in force; the database enforces the different reviewer, who also opened no finding in the case; with one moderator, appeals wait. Measures taken while deciding are not appealable. While a report of child sexual abuse material about a post is unanswered or its images are sealed, a review or a correction that turns on one of its images is decided on text alone or waits for the admin's answer. Notifiers and reporters may ask once for a re-examination of "no action", and an answer given while nobody could open the post's images does not spend that request.
- **What the author experiences: a withheld post (line 190).** It shows the rule of the decision taken while deciding that withheld it, not "usually within 24h": the README publishes response-time targets per lane (24 hours in lanes 0 and 1, seven days in lane 2), every staff account is alerted when a case passes them, and they are targets, not promises. Its content stays visible to its author, except images sealed while deciding on a report or finding of child sexual abuse material, which nobody is shown, their author included, from the first seal: serving a file reported as such material back to its uploader is making it available (Directive 2011/93/EU Art. 5(5)). Flagged for the owner in the 3c design's section 2.
- **What the author experiences: a removed post (line 191).** Holds, except R4 (redacted when final). A post whose images are sealed stays in its author's views and export with its text; only the sealed images are shown to nobody, the author included, since the seal is a state of images and text is never sealed.
- **Suspension (line 192, and step 3's "suspension requires 3 active strikes or an R2/R5 case").** 3e's.
- **R4 (section 4, "Withhold first when the report is credible").** A moderator's decision taken while deciding, never report volume.
- **R2 (section 4, "Cloudflare CSAM hash match -> auto-remove, account suspended, NCMEC report").** Until 3d, whoever is on duty seals reported images by hand without opening them, an admin seals them for good or answers without a seal, and the operator reports every seal for good to the national police or the authority its Member State names (never a hotline), not NCMEC. Suspension is 3e's; the record of each report to an authority and the hand-over of sealed files are 3f's; the hash match, the automatic seal, the quarantine and the release are 3d's.
- **R6 (section 4, "Reputation signals help triage").** Reputation no longer exists; R6 cases are ordered like every other case, by lane and age. Rulebook version 2 names coordinated manipulation in R6 ("No spam, scams, impersonation or coordinated manipulation"), which the 2c amendment left to sub-project 3.
- **The audit log (section 3d, "Every action lands in the append-only audit_log").** Holds: decisions, reviews and reveals are step-up rows naming their decision, and the chain holds only ids, enums, times and salted digests, never a text anyone typed.
- **Sub-project 3 as it now stands (section 6, row 3, and the 2026-10-01 amendment).** Five parts, each dry-run and replayed on its own. 3a, the staff console foundation, and 3c, moderation cases, are delivered. What the 2026-10-01 amendment listed under 3c beyond them (strikes, suspensions, Explore's formula version 2, the path for authorities' orders) left 3c when its design was written, and that second half has since been split into two designs, both committed. **3e, account sanctions** (`2026-10-09-account-sanctions-3e-design.md`): strikes that count for 90 days and a ladder at three active strikes, suspensions as measures of the ledger, termination, the restriction of reporting, handle retirement, and Explore's formula version 2. **3f, authorities' orders, the alert channel, records to authorities and recovery** (`2026-10-09-authorities-orders-3f-design.md`): the contact point and its watcher, alerts to the on-call phones, order records with the one-hour clock of a removal order under Regulation (EU) 2021/784, the one confirmed action that disables content under an order, preservation, the record of every notification to an authority and every production with the hand-over of sealed image files, the off-server copy of decisions and the restore that takes each lost measure again. **3d, transparency and automation**, as the 2026-10-01 amendment has it, with the handling of sealed images: the automatic seal on a hash match, the quarantine and the release. Import keeps its name, 3b.
- **The gate (section 6).** korbat is not opened to the public, nor sign-up to people the operator does not know, before 3f's order path and 3d's handling of sealed images have both shipped, and no authorities' contact point is published before 3f's order path ships. The README states it first under Before going public. Any reordering that puts sub-project 4 before 3f or before 3d reopens it.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, the screen-reader fix, the audit batch. Next, in order: 3e account sanctions, 3f authorities' orders, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-12, sub-project 3e (`2026-10-09-account-sanctions-3e-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Account sanctions, on 3c's ledger and nothing beside it: strikes that the database, not a moderator, finds due for a final decision that a post breaks a korbat rule, counting 90 days; a ladder at three active strikes that lets a moderator announce a suspension of at most 3, 7 and 30 days, and an admin a termination after three; suspensions at once, an admin's only, on a closed list (a threat, terrorist content, a flood, and a protective suspension on a seal for good); a reply that holds an announced start; termination, purged only once final for the person; the restriction of reporting after a warning, on marks "manifestly unfounded" that persons set and sign; handle retirement with a placeholder; Explore's formula version 2. Every number is a constant of `standing_rules()` in SQL, mirrored in `STANDING_RULES`; every restriction is derived by one writer from the ledger; one predicate judges every write of the acting account. Migrations `0020` to `0024` (the design's 0019 to 0023, one higher since 3c's review added `0019_redaction_scope.sql`).
- **R2 (section 4, line 172, "account suspended").** A report of child sexual abuse material alone supports no measure on the account. An admin's seal for good of images of the account (3c) supports at most one protective suspension, which an admin takes for up to 14 days in a decision of its own, which is no finding, and which is appealed and reviewed at once. No suspension is automatic: 3d's hash match may ask for one, and a person confirms it. Reason: korbat's staff do not open images reported this way, so korbat has assessed nothing.
- **Automation (section 4, line 180, "May not ... suspend an account (except R2)").** The exception is dropped. Reason: GDPR Art. 22 and the bullet above.
- **Decision (step 3, line 185: the action `strike`; "suspension requires 3 active strikes or an R2/R5 case").** A strike is not a choice of the moderator but the database's consequence of a final rule decision on a post, for 90 days. Three active strikes let a moderator announce a suspension of at most 3, 7 and 30 days, with 168 hours to reply; after a suspension one further strike opens the next step while three still count, and after three such suspensions decided in 365 days, whatever their length, an admin may announce a termination. A suspension at once is an admin's, on the closed list of 3e's section 2; no announced suspension takes one of its grounds. Reason: equal treatment that an auditor can recompute, and recital 64's prior warning.
- **Appeal (step 4, line 186, "Upheld appeals reverse the action and remove the strike").** Holds, and goes further: a suspension that rested on the strike loses its basis in the same transaction when fewer than three of its strikes still stand. One that has not started does not start, one that runs ends, and one that had already ended no longer counts toward a later suspension.
- **What the author experiences: suspension (line 192, "Suspension shows the case list and a link to appeal each one").** The banner on every screen, and the suspension's own decision screen with the strikes it rests on, each linking to its decision and that decision's appeal.
- **The trust and safety tables (section 2, line 109, `strikes`).** A strike is a ledger measure, not a table; so are suspensions, terminations, retirements and the reporting measures, with their times and basis in seven columns of `decision_actions`. The tables `suspension_replies`, `unfounded_marks` and `report_tallies` hold the replies and the reporting counts.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c and 3e are delivered. Next, in order: 3f authorities' orders (the order path, the alert channel, the records of reports to authorities and the recovery after a restore), then 3d transparency and automation. korbat is not opened to the public before 3f's order path and 3d's handling of sealed images have both shipped.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, the screen-reader fix, the audit batch. Next, in order: 3f authorities' orders, 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-17, sub-project 3f (`2026-10-09-authorities-orders-3f-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Authorities' orders, the alert channel, records to authorities and recovery, on 3c's ledger and 3e's and nothing beside them: a contact point for authorities watched by `notify`, which reads two numbers a message and nothing else; a self-hosted ntfy that rings the on-call phone, with the staff mails as the second leg; order records with the one-hour clock of a removal order; "Disable for an order", the post level `disabled` and its reversal; the author's notice, held while a non-disclosure decision runs and released by the database; six months and a day of preservation; a record of every report to an authority and of everything handed to one, with the address of a deleted account held while a report is owed; the keeper's daily copy of the audit log's tail and the import that names what a restore lost; the yearly counts (`staff.js tco-counts`). Migrations 0026 to 0031.
- **Line 10** ("Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human"): an authority's order is the exception to all three, and the terms say so beforehand. It cites the order, not a rule; its author is told at once unless the order forbids it, and then when the law, or for an order without a period of the law's the issuing authority, allows; korbat's appeal does not apply, and the notice names the authority's remedies. Reason: TCO Art. 3, 9 and 11; DSA Art. 9 and 17(5).
- **Line 191** ("A removed post stays in the author's view ... never silently gone"): holds for every decision of korbat's own. A post disabled under a removal order, or under any order that says its author must not be told, is shown to nobody while it is disabled. It is silently gone only while a non-disclosure decision runs: under a removal order for six weeks, for twelve at most, and up to a day and a few hours more, because korbat counts the end so that it is never early; under another order for as long as its issuing authority states. Then the author is told what happened and since when. During that time a decision of korbat's own about the same post, and the answer to an appeal about it, are told late too, with the notice. Reason: TCO Art. 6(3) and 11(3); DSA Art. 9(5). Flagged for the owner and counsel (3f's section 2, rows 16, 24, 26, 46 and 47).
- **Line 293** (images of withheld and removed posts reach only their author): images of a disabled post reach nobody.
- **Lines 23 and 38 to 42** (the stack and the tunnel): the stack gains the services `notify` and `ntfy`, under a Compose profile that `COMPOSE_PROFILES` in `infra/.env` switches on, and, on demand, `handover`; Caddy gains a third site for the push hostname and the tunnel a third public hostname; the network `push` has no route to the internet and Caddy's two other sites refuse a client from it; PostgreSQL and `notify` meet on a network of their own, `watch`, so the stack's rule that the API alone reaches the data services gains exactly one named exception. The app's site answers 404 with the shell for a post's page that is not public, and 503 to everything while `APP_SITE=closed`.
- **Line 156** (backups): beside the backups, the keeper downloads the audit log's tail each day, under a staff key, and holds it off the server; after a restore it names what was lost, and a person takes each measure again.
- **Line 160** (alerts on moderation queue age): staff alerts reach phones through korbat's own ntfy and stay mails as well; a push carries counts and times only, and so does every mail of 3f's own.
- **Context and section 6, row 3:** korbat is offered in its home state only (3f's section 2, row 6). The order of sub-project 3 is 3c, 3e, 3f, 3d; korbat is not opened to the public before 3f's order path and 3d's handling of sealed images have shipped and the owner's list of the README's Before going public (3f's W.10) is done.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c, 3e and 3f are delivered. Next: 3d transparency and automation. korbat is not opened to the public before 3d's handling of sealed images has shipped and the owner's list is done.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, the screen-reader fix, the audit batch. Next, in order: 3d transparency and automation, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-19, sub-project 3d (`2026-10-09-transparency-automation-3d-design.md`)

- **Delivered (sections 2 and 4, and section 6, row 3).** Transparency and automation, on 3c's ledger, 3e's and 3f's, with every adapter off by default: the quarantine of sealed image files and its one-shot mover; the release of sealed images on a recorded leave or instruction to destroy, with its proof and its replay after a restore; an outbox row for every image that stops being public, drained to an edge adapter, and cache headers that bound a copy without it; the public pages `/rules` and `/transparency` with yearly banded editions, the recipients' figure and the audit head's daily value; the automated decision, always interim and open to "Ask for a person"; the mechanisms of the R1 check and of the comparison with known material behind their test adapters; and the flag "possible coordinated reporting". Migrations 0033 to 0040.
- **Lines 110 and 187** (a public copy of every case; monthly counts, appeal and reversal rates): withdrawn. No table `transparency_log` and no public row of a decision exist. `/transparency` shows yearly editions of banded counts, by ground and by kind of measure and never their cross, published on or after 1 March and never changed; a rate appears only as two counts on a base of ten or more. Reason: on a service of some hundreds of accounts a dated row, or a small cell, is a statement about a known person (section 2, rows 1 to 3). Flagged for the owner.
- **Line 147** (reports weighted by reputation; brigading sends the case to a senior queue): one flag on a case, shown to staff, which orders nothing and protects by saying "this is not a finding". Reports are never weighted, as 3c decided.
- **Line 148** (ban-evasion signals): not built.
- **Line 167:** `/rules` exists, with a change log and the section "Automation".
- **Line 171** (R1: a score withholds): a score opens a finding for a moderator. It withholds that one image, never the post, only where the owner has set `AUTOMATION_R1_ACTS=on`; the default is off.
- **Line 172** (R2: Cloudflare's match removes, suspends, reports to NCMEC; the only automated removal): a match is korbat's own comparison of hashes with a source the owner has an agreement with. Only a match that the source reports as exact, with an entry it classifies as child sexual abuse material, lets a program act: on an upload it refuses and holds, and on a post, where the owner has switched that on, it seals the post's images until an admin answers. A match with such an entry, exact or not, on a post opens a finding under R2, which freezes the post and alerts an admin, as a moderator's own finding would. A match with an entry of another class is a flag for a person: it cites no rule, freezes nothing and alerts nobody. Nobody at korbat opens an image that a match names, whatever is answered. Nothing is removed by a program, no account is suspended by one, korbat makes no report to NCMEC, and no sealed image is destroyed without an authority's or a court's leave. There is no automated removal in korbat; there are two automated interim measures.
- **Lines 179, 180 and 184** (what automation may do): it may open a finding; where set, withhold one image under R1 or seal one post's images under R2, until a person decides; and flag. It may not raise a priority, remove anything, hide text, reduce reach, or suspend, restrict or end an account, R2 included. (A program's seal starts 3f's record of a report and its hold of the account's address, as every seal does; the texts say so.) A flagged case stays in its lane.
- **Line 190** ("usually within 24h"): 24 hours is the published target for a person's answer after the author asked for one.
- **Lines 201 and 204:** the pages exist as section 9 has them; no panel shows live transparency figures.
- **Line 203 and line 291** (the composer's warning near the threshold): not built. A score before posting would tell a poster how to get past the check.
- **Line 156** (backups): the volume `media-quarantine` is in no backup, and the price is stated.
- **Line 293** (media serving): public images carry `public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0`. Cloudflare's scanning tool is not switched on (section 2, row 31).
- **Lines 23 and 38 to 42** (the stack): one more volume and one more one-shot service behind a profile; the API's outbound hosts grow only while an adapter is on.
- **Line 342 and section 6, row 3:** sub-project 3 is complete with 3d, and the gate is section 14's. Of line 342's list: hashes are computed only while a matcher is on and are deleted with their image; the Cloudflare runbook says what its tool would do and leaves it off; the brigading signal is one flag.
- **Sub-project 3 as it now stands (section 6, row 3).** 3a, 3c, 3e, 3f and 3d are delivered: sub-project 3 is complete. korbat is not opened to the public before the owner's lists of the README's Before going public are done, 3d's parts A and B among them.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, the screen-reader fix, the audit batch. Next, in order: 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-20, the UI sub-project (approved by the owner on 2026-10-12)

- **Added (section 6).** A sub-project for the interface and the experience, after sub-project 3 and before 3b. The owner asked for an interface that rivals Instagram in polish and delight while staying intuitive, built on proven open-source work. It keeps korbat's values: a chronological feed, no silent reach reduction, visible moderation, pseudonymity and no engagement dark patterns.
- **Section 5** stays the UI sub-project's brief; its brainstorm confirms the libraries and the screens.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, the screen-reader fix, the audit batch. Next, in order: the UI sub-project, 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-21, the UI sub-project (`2026-10-21-interface-experience-ui-design.md`)

- **Delivered (section 5, and section 6, row UI).** The interface and the experience, in ten tasks, with no new route and no migration: the design language as code (colour tokens in Light, Dim and Dark, ink and paper with one violet accent for actions and every text pair at WCAG AA; Fraunces, Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono bundled under the OFL 1.1; Lucide's icons) and korbat's own components, each with a required accessible name; the shell (a phone's tab bar, a tablet's rail, the full nav from 1280 px and the context column from 1024 px), a skip link, toasts, a title on every screen, a missing page and an error boundary; the post as an article whose actions answer at once and roll back with a sentence when refused, with menus holding Who sees this, Copy link, Delete and Report, and a lightbox; feeds that keep the reader's place on the device, count new posts in a pill and end with "You're all caught up"; the composer as a sheet on phones and a card on wider screens, with required descriptions, a progress ring and drafts kept on the device; moderation status on the author's own post, whose chip opens a sheet with the decision's rule, measure, scope, who decided in role terms, statement and appeal; a Settings index with Appearance and accessibility first, and the sign-in flow and the token pages in a public frame; motion with a reduced form for each, and haptics by intent with an off switch; the staff console restyled within its policy; and an automated check of the app in Chromium at 360, 768 and 1280 px in the three themes. Every visible sentence lives in a words module, so a later translation changes no screen. The README's The interface says what the browser keeps and when it is cleared, and its Third-party notices names the fonts' and libraries' licences.
- **Line 202** ("context panel with explore and transparency stats"): the context column holds the handle box and How korbat works (a chronological feed, no silent reach reduction, the rules and the transparency page). Popular now left it, since suggestions appear only where the reader goes looking, and Explore stays Home's third tab (decision 14); this amends the 2c design's section 11 too, in its section 20. No panel shows live transparency figures, as 2026-10-19 decided.
- **Line 203** ("one display face for handles and headings"): headings are in the display face, Fraunces; handles are in a mono face of their own, Atkinson Hyperlegible Mono, so look-alike handles differ at a glance (decision 4).
- **Line 203** ("dark-first with a light theme"): three themes, Light, Dim and Dark, and the default is System, which follows the operating system: Light, or Dark (Dim if the reader chooses it) when the system is dark (decision 5).
- **Line 204** ("Character counter"): the counter is a progress ring, which shows the number of characters left near the end.
- **Line 205** ("recent sign-ins"): Settings, Security lists the devices and sessions, two-factor authentication and "sign out everywhere"; a list of recent sign-ins needs an account-side route and is left for later (UI design, section 14).
- **Line 207** ("timeline insert of new posts"): nothing is inserted above the reader while they read. Following and Latest ask for new posts while they are on screen, and new posts wait behind the "N new posts above" pill, which brings the reader to them (decision 7).
- **The owner's decisions (UI design, section 2).** Twenty-two decisions are built as written and flagged for the owner, each with what its alternative costs: English only, with every sentence in a words module and a scan against bare strings (1); the console's system fonts (2); the violet accent (3); the faces, with handles in the mono face (4); the themes, System by default (5); Load more by default (6); new posts shown by the pill alone (7); the reading place kept on the device (8); feeds that open where the reader left off (9); no reader-side cover over a restricted post (10); the chip's words, with the deadline in the sheet (11); the post's controls, Report under More (12); a like in the accent, with no red heart (13); Popular now gone from the context column (14); hiding like, repost and follower counts (15); a title on every screen that never names an account (16); no autoplay setting (17); drafts kept on the device until sent, discarded or the session ends (18); the desktop composer as a one-line card (19); the app's browser check (20); the console's theme by the system alone (21); and monogram avatars until 2d (22). The UI design's section 15 holds the amendments of its dry run.
- **Left for later (UI design, section 14).** Sub-project 5: the keyboard controller and form sheets on iOS and Android, the fonts embedded natively, storage on native for the appearance, the reading place and drafts (a defect to fix, not polish), haptics, the lightbox's pinch and zoom and the toasts' reduced motion checked on devices, state across an Android configuration change, icons and the splash screen, and keyboard shortcuts on the web with their off switch. Sub-project 2d: notifications, uploaded avatars in the monogram's place, mentions as data, share cards with titles and meta served by korbat, help on a first visit, and the author's per-post "hide counts". Elsewhere: a "Restored after appeal" chip and the deadline on the chip (PostModeration grows), reply order and a threaded view, the list of recent sign-ins, a web manifest with a service worker and an offline page (sub-project 4), and translations, before korbat is offered in a home state whose language is not English.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, UI, the screen-reader fix, the audit batch. Next, in order: 3b import, 2d engagement, 4 hardening, 5 native builds.

### 2026-10-27, sub-project 3b (`2026-10-22-import-3b-design.md`)

- **Delivered (section 6a, and section 6, row 3b).** Import from other platforms, in eight tasks: a person brings their own public posts from an X or a Mastodon archive, and from a Bluesky repository only when the owner switches Bluesky on, text only. The archive goes from Settings, Import posts, in resumable chunks of 8 MiB through Caddy and the API into the volume `import-archives`, which no backup reads and which loses the archive once its scan is read, within 24 hours at the latest. A new service, `importer`, with no network, no capabilities, a read-only root and no credentials but each job's per-account key, opens only each source's allowlisted files with korbat's own zip reader and streaming JSON and CAR readers, keeps only the person's own public posts, converted to korbat's plain text, and writes them into a second volume, `import-work`, kept at most 72 hours after the scan. The preview counts what was found and what is left out and why; the person chooses months, replies, long posts and post by post, states that the posts are their own and were public, and confirms. The posts are published in batches through the social module's writers under 3e's predicate, on the profile's Imported tab with a provenance label, never in a feed, and one action removes them again through the author's own deletion path. The account's deletion, purge and export cover imports, the terms gain "Importing posts" and one licence for every post, and staff see the label and the import's size on a case, where an admin can end a whole import with the staff key. Imported images pass 2b's pipeline and 3d's checks behind the owner's switch `IMPORT_IMAGES`, which the API refuses while no matcher is on, so no build imports images today. Migrations 0043 to 0048. The README's Importing posts holds the settings, the volumes, what the import key still allows and the labs.
- **Line 239** ("korbat parses the archive in the worker"): the archive is parsed in a service of its own, `importer`, with the image worker's profile and its own memory, CPU and time limits, so archive work never enters the one queue every upload waits in and no zip, JSON or CBOR parser runs in the process that decodes images (decision 1). Line 243's bucket is the volume `import-archives`, and its signed URL korbat's own chunked upload, as 2026-09-18 foresaw.
- **Line 246** ("Same rules as native posts"): as 3d amended it (2026-10-19, lines 171 and 172: an R1 score opens a finding and withholds one image only where the owner sets it; an R2 match refuses and holds the one upload, and no program removes, suspends or reports), with the stop of decision 18 for imports: the first imported image the matcher refuses stops the whole import before any of its posts is published; the refused upload is held and told as 3d holds and tells any, the other prepared images and the work output are deleted unopened, and no measure touches the account. An imported image whose match does not act is not published at all, one whose check is not answered within 24 hours is left out (decision 19), and images are imported only while a real matcher is on (decision 15). Text is never removed by a program.
- **Line 248** (the "verified import" mark): not built (decision 7). Checking a code in the other profile's bio is a fetch by handle, an outbound request to any instance or host, and a public, verified link between a pseudonymous account and a named one. Imports of someone else's archive are met by the person's statement, reports under R6, the label's plain words and an admin's end of a whole import. The label reads "Imported from X, dated 3 Mar 2019", and the paragraph it opens says that korbat did not check who wrote the post or when (decision 6).
- **Line 251** ("Imported posts appear on the author's profile in original date order"): on the profile in a tab of their own, Imported, after Posts and Replies, newest first by the archive's date, and never in Following, Latest, Explore or the Posts and Replies tabs (decision 8). A post's `created_at` stays korbat's time of publication, and the archive's date is a column of its own (decision 9). Anyone may repost or quote an imported post, one deliberate act at a time (decision 23).
- **Line 257** (`original_url` among the new columns of `posts`): not stored (decision 5). On each imported post korbat keeps its source, the archive's date, whether it was shortened, the import it came from and, for finding repeats, a hash of the source post's id keyed by a random key of the account's own, erased with the account; never a handle, account id, instance, DID, link or source post id. The hash is still a pseudonymous id to whoever holds the database or a backup of it, which the README says.
- **The owner's decisions (3b design, section 2).** Thirty decisions are built as written and flagged for the owner, each with what its alternative costs, and seven of them for counsel too, which the README's Counsel's list holds: the importer as a service of its own (1); korbat's own zip reader (2) and chunked upload (3); the two volumes in no backup and how long anything lives (4, counsel); what korbat keeps of the source (5); the provenance label (6); no verified import mark (7); the Imported tab (8); `created_at` as the time of publication (9); which posts can be imported (10); the images of sensitive posts left out (11); posts with a content warning left out unless chosen (12); long posts left out or shortened (13); the person's statement (14, counsel); images only behind a real matcher (15, counsel); a switch for each source, Bluesky off (16, counsel); the worker unchanged and fed two imported images at a time (17); a refused image stops the import (18, counsel); unanswered checks wait 24 hours (19); images only with a description (20); the limits of an import (21); undo through the author's deletion path (22); counts and reposts (23); repeats skipped by a per-account key (24); the import's record (25, counsel); the archives refused today (26); the parsing libraries (27); what the import screen says first (28, counsel); no new public figure (29); and an admin's end of a whole import (30).
- **The dry run's flags for the owner.** Migration `0048_import_staff_end.sql`, which the design did not name: `import_jobs.staff_case_id` and `staff_decision_id`, and `import_ended_by_staff` among the actions `append_confirmed_audit` confirms, with `gap_close` closing a lost end's gap after a restore; the app's JavaScript cap raised from the 1222b87 baseline plus 80 KB to plus 120 KB (832,257 bytes gzip) for the import screens; and `scannedAt` on the import's view, left open, so the preview prints a lower bound of the time it is kept until. The 3b design's section 15 holds the amendments of its dry run.
- **Left for later (3b design, section 14).** More sources (Threads, Instagram, Facebook and Reddit) as adapters; Bluesky's images from a second archive of blobs, each checked against a kept post's CID; Mastodon's `.tar.gz` archives and X archives in parts; the allowlisted zip built in the browser, so that X's messages never leave the device; an edit of image descriptions after posting; self-quotes as korbat quotes; the native file picker and background upload (sub-project 5); a second worker or lane for imported images if the host's measurements ask for it; 2d's mention parser skipping imported posts and its share cards showing the label; and sub-project 4's section on imports in the privacy policy, the impact assessment, per-address limits tuned with Cloudflare's rules, and the restore drill confirming that the two import volumes are absent from backups.
- **Status and order (section 6).** Done: 0 (except Task 16), 1a, 1b, 1c, 2a, 2b, 2c, 3a, 3c, 3e, 3f, 3d, UI, 3b, the screen-reader fix, the audit batch. Next, in order: 2d engagement, 4 hardening, 5 native builds.
````

### Replace `docs/superpowers/specs/2026-10-22-import-3b-design.md` (whole file)

````markdown
# korbat import from other platforms (sub-project 3b): design

Status: approved for the dry run under the owner's standing instruction to finish the app (2026-10-20); decisions marked (owner) in section 2 were made by the orchestrator and can be changed by the owner, and those marked (counsel) need a lawyer's confirmation before korbat is opened to the public. Inputs: the main design's section 6a and its later amendments, the code at the time of writing, the three source formats from their official documentation, and a check of every library against the 7-day release-age floor. One review round (build fit and security; people and values) shaped this text.

Inputs, as cited: korbat-scratch/research-3b/inputs.md ("inputs N"), the main design
docs/superpowers/specs/2026-09-03-korbat-design.md ("main design"), and the designs of 2b, 3c, 3d, 3e, 3f and the UI
sub-project in the same folder. Paths are relative to the repository root C:/Users/Lenovo/Desktop/cool/korbat unless
they start with korbat-scratch. Written against main at 6babae1; committed before Task 1 as
docs/superpowers/specs/2026-10-21-import-3b-design.md (section 13).

## 1. Context and scope

### 1.1 What the owner asked

On 2026-09-14 the owner asked that people can bring their posts from other social media to korbat if they choose.
The main design's section 6a is the brief, and the roadmap row 3b names what it delivers: archive upload for X,
Mastodon and Bluesky, a quarantine, a sandboxed streaming parser, a preview and a choice, imported posts on the
author's profile only, the same image pipeline and checks as native posts, and a one-click undo. On 2026-10-20 the
owner said "finish the app". The UI sub-project runs before 3b (main design, 2026-10-20 amendment), so every screen
of this design is drawn with that sub-project's tokens, components and words modules.

### 1.2 The idea in one paragraph

A person who leaves another platform takes their own words with them, and nothing else. korbat accepts the official
export file the person downloaded themselves, never a password or a handle. The file goes into a quarantine volume
that no backup reads, and a service with no network, no database and no server secret opens only the few files that hold
the person's own public posts. It writes those posts, already converted to korbat's plain text, and their images
into a work folder. The person sees what was found and what will be left out and why, chooses a date range and
whether to bring replies, and confirms. Images then pass through the same pipeline and the same checks as any
upload, at a pace that keeps anyone's own upload ahead of them, and only then are the posts published, on the author's
profile only, under an "Imported" tab, each with a label that says where it came from and what date the archive
gave it. One action removes them all again. korbat keeps no handle, no link and no id from the other platform.

### 1.3 In scope

- Archive upload in chunks of 8 MiB through Caddy and the API into a new volume, `import-archives`, which no backup
  reads, with resume after a lost connection.
- A new service, `importer` (apps/importer), with no network, no capabilities and a read-only root, which reads the
  archive with korbat's own zip reader and streaming JSON and CAR readers and writes normalised posts and allowlisted
  images into a second volume, `import-work`.
- Three adapters: X (a zip), Mastodon (a zip, from 4.2 on) and Bluesky (a `.car`, text only, off by default).
- The contracts in packages/contracts, and the file protocol in a new package, packages/import-protocol.
- The preview, the choice (a date range, replies, long posts, and every post listed with its own "Leave this one
  out"), the confirmation with the person's statement, the progress, the result and the undo.
- Imported images through 2b's pipeline and 3d's checks, fed to the unchanged worker in a lower-priority lane,
  behind an owner's switch that is off by default.
- Imported posts in a profile tab of their own, out of Following, Latest and Explore, with a provenance label on
  every one.
- Migrations 0043 to 0045: the import tables, the new columns of `posts` and `post_media`, their guards, grants and
  row-level security, and the readers' indexes.
- The account's deletion and purge, the data export and the terms extended to imports.
- The staff console shows the provenance label wherever it shows a post, an import's size on a case, and an admin's
  step-up action that ends a whole import.
- Tests built from fixtures that code writes (never a real archive), the zip-bomb, traversal and large-archive labs,
  and the app's browser check extended to the new screens.

### 1.4 Out of scope, and where it goes

- **Meta (Threads, Instagram, Facebook) and Reddit.** Later adapters (section 14). The adapter contract of section
  5.2 is written so that each is one new folder in apps/importer/src/adapters and one new value of the enum
  `import_source`; the pipeline, the preview, the publisher and the moderation path do not change.
- **Bluesky images.** The repository export holds no image files (inputs 3.3). A second, optional archive of blobs
  checked against the CIDs the posts name is a later extension (section 14). korbat never fetches blobs from a PDS.
- **Mastodon archives in `.tar.gz`** (instances older than 4.2) and **X archives split into parts** are refused with
  a sentence that names the reason (section 5).
- **Video, animated GIFs and polls.** korbat has no video and refuses animated images (2b); polls have no korbat
  form. Each is left out and counted in the preview.
- **A "verified import" mark** (main design 6a, line 246). Not built: checking a code in the other profile's bio is a
  fetch by handle, an outbound request to arbitrary hosts and a public link between a pseudonymous account and a
  named one (decision 7).
- **Links to the original post and the other platform's handle** (main design 6a, line 255, `original_url`). Not
  stored (decision 5).
- **Editing an image's description after posting.** korbat has none for native posts either; an imported image is
  attached only with a description, its source's or one the person writes in the preview (decision 20). An edit for
  every image waits for a later sub-project (section 14).
- **Browser-side trimming of the archive.** The whole archive passes through korbat's server, and the start screen
  says so (decision 28); building a smaller zip in the browser waits for room in the web bundle (section 14).
- **Mapping other platforms' accounts to korbat accounts.** Never: mentions stay plain text, are never linked and
  never notify (main design, line 250 and the 2026-09-30 amendment), and links to the source platform become fixed
  words (section 5.3).
- **Self-quotes as korbat quotes.** A quote's text is kept; a quote of the person's own imported post is not turned
  into a korbat quote in 3b (section 14).
- **Native file picking and background upload on iOS and Android.** The web app is the first target; sub-project 5
  brings the same protocol to the native apps.

### 1.5 Rules this design keeps

- **Pseudonymity.** korbat stores no handle, display name, account id, instance, DID or URL of the other platform,
  shows none, and never links an imported mention to a korbat account. It cannot hide that an imported post's words
  are public elsewhere, so anyone who searches them may find the original and the account that wrote it: the person
  is told so before uploading and beside the statement (decision 28).
- **No impersonation.** Only a file the person uploads; no password of another platform; no fetch by handle, DID or
  URL; no scraping. The person states before publishing that the posts are their own and were public, and the label
  never claims more than korbat knows.
- **Data minimisation.** Only allowlisted post and media files are opened; within them, only the person's own public
  originals are kept, decided from the visibility fields before any other field is read. X's direct messages, IP
  logs, contacts, ad data, likes, follows and deleted posts are in files never opened; Mastodon's direct and
  followers-only posts share `outbox.json` with the public ones, so they pass the parser and are skipped by their
  addressing before their content is used. None is ever stored or logged, not even one by one as a skip (7.1).
- **Moderation visible on the post.** Imported posts follow korbat's rules like any post, can be reported, and show
  their moderation status as any post does.
- **Self-owned.** No third-party service. The only outside parts are 3d's adapters, which stay off by default.
- **A chronological feed that imports never flood.** Imported posts enter no feed on their own and no Explore
  ranking; a person may still repost or quote one, one deliberate act at a time (decision 23).
- **Same rules as native posts.** Every imported image goes through 2b's pipeline and 3d's checks; every write of an
  import is judged by 3e's predicate in the statement that locks the author's profile.
- **Supply chain.** Only the libraries inputs.md section 4 verified, exact pins past the 7-day floor, no AGPL.
- **Migrations.** Hand-written SQL where needed, row-level security and grants as every earlier sub-project; no
  existing migration is edited.

## 2. Decisions flagged for the owner

Each decision is made and built as written. The owner can change any of them; the alternative says what changing it
costs. All are marked (owner); those a lawyer should confirm are marked (counsel) as well.

1. **Where the archive is parsed (owner).** Chosen: a new service, `importer` (apps/importer), with the image worker's
   profile: `network_mode: none`, `cap_drop: [ALL]`, a read-only root, no database or Valkey credentials, no secret
   but the per-account key of section 5.4, its own memory, CPU and time limits, the archive volume read-only and a
   work volume it writes (section 7.1). Alternative: parse in the image worker, as 6a's line 237 says; that puts
   archive work into the one FIFO queue every upload waits in and puts a zip, JSON and CBOR parser in the process
   that runs the image decoder, which 2b made images-only (main design, line 291).
2. **The zip reader (owner).** Chosen: korbat's own reader of the central directory, in apps/importer/src/zip/,
   about the size of the writer korbat already owns (apps/api/src/account/zip.ts, 304 lines), inflating with
   `node:zlib` `createInflateRaw` and checking `zlib.crc32`, with every limit of section 7.2 (overlap, ratio, size,
   count, names, symlinks, encryption, ZIP64) written and tested by korbat. Alternative: yauzl 3.4.0 (MIT) under
   the same limits, which leaves the overlap and ratio checks to the caller (inputs 4.1).
3. **The upload protocol (owner).** Chosen: korbat's own chunked protocol: chunks of exactly 8 MiB (the last one
   shorter), each a `PUT` at a stated offset that must equal the bytes already stored, with a per-chunk SHA-256, and a
   `GET` that answers the stored offset so the app resumes after a lost connection (section 7.3). Alternative: tus
   (@tus/server 2.4.5, @tus/file-store 2.1.1), with ready clients, but a new server dependency tree whose extensions
   korbat would switch off one by one, and hooks that repeat korbat's session, CSRF and limit checks.
4. **The quarantine and how long anything lives (owner, counsel).** Chosen: two new volumes in no backup:
   `import-archives` (the API writes, the importer reads) and `import-work` (the importer writes, the API reads). The
   archive is deleted as soon as its scan ends, and at the latest 24 hours after the import was created. The work
   output (the person's own public posts and their images, already selected) is deleted when the import is published,
   stopped, cancelled or undone, 24 hours after the preview is ready if the person never confirms, and at the latest
   72 hours after the scan ended whatever happens. The whole archive, other people's messages in it included, passes
   through korbat's server and its network provider (Cloudflare ends TLS before the tunnel) on its way in: no
   browser-side trimming in 3b (the web bundle has 1.9 KB left under its budget after the UI sub-project), so the
   start screen says so plainly and tells the person they may delete the folders and files korbat never reads, named
   per source, from the archive before uploading; the allowlist does not change. Alternative: a folder of
   `media-uploads`, which backups already skip, but the archives would share the images' free-space floor and the
   worker could read them; for the transit, a smaller zip of the allowlisted entries built in the browser (section 14).
5. **What korbat keeps of the source (owner).** Chosen: on each imported post only the source (`x`, `mastodon` or
   `bluesky`), the date the archive gives it and the import it came from; for finding repeats, a hash of each source
   post's id keyed by a random key of the account's own, erased with the account (sections 5.4 and 6.2). No handle,
   display name, account id, instance, DID, link to the original or source post id is stored, shown or logged. The
   hash is still a pseudonymous id: whoever holds the database or a backup of it can test whether this account
   imported a named public post (section 11.1). This changes 6a's line 255, which listed `original_url`: for X and
   Mastodon that URL holds the person's handle elsewhere, shown beside a pseudonymous korbat account. Alternative:
   store the link and show it to the author only, or to everyone.
6. **The provenance label (owner).** Chosen: every imported post shows "Imported from X, dated 3 Mar 2019" under its
   author line, a pressable line that opens its "Who sees this" sheet at the provenance paragraph, which begins with
   the fact that anyone who searches the post's words may find the original and the account that wrote it, then
   "This account imported it from X on 21 Oct 2026. The archive dates it 3 March 2019 (UTC). korbat did not check who
   wrote it or when." (section 10.6). Readers get the day, never the archive's second, which with the text would
   fingerprint the original. Alternative: 6a's shorter "Imported from X, original date", which claims an original
   date korbat cannot know: X and Mastodon archives can be edited and a Bluesky date is set by the client.
7. **No "verified import" mark (owner).** Chosen: not built (6a, line 246). Checking a code in the other profile's
   bio is a fetch by handle (forbidden by 6a's line 236), an outbound request to any Mastodon instance or did:web
   host, and a public, verified link between a pseudonymous account and a named one. Imports of someone else's
   archive are met by the person's statement (decision 14), reports under R6, the label's plain words one press away
   (decision 6), staff's whole-import end (decision 30), and Bluesky off by default, where copying is easiest
   (decision 16). Alternative: build the check behind an adapter that is off by default, as 3d does for outside parts.
8. **Where imported posts appear (owner).** Chosen: on the author's profile in a tab of their own, "Imported", after
   Posts and Replies, newest first by the archive's date; never in Following, Latest, Explore, the Posts tab or the
   Replies tab; a self-thread shows in full on the post's page. Alternative: mixed into the Posts tab by the
   archive's date, which reads as if the person posted on korbat in 2019 and makes the Posts tab's cursor read an
   expression instead of `created_at`.
9. **Which time a post carries (owner).** Chosen: `created_at` is korbat's time of publication, as for every post,
   because every clock in korbat reads it (write limits, Explore's window, moderation's deadlines, retention,
   cursors); the archive's date is a column of its own, `original_created_at`, which the Imported tab sorts by and the
   label shows. Since every import is then written at once, 3e's flood count, the floor under an admin's finding of a
   spam flood, leaves imported posts out (section 8.5). Alternative: `created_at` set to the archive's date, which
   would put an imported post into every window and deadline as if it were years old.
10. **Which posts can be imported (owner).** Chosen: the account's own original posts and its threads of its own
    replies; replies to other people only when the person turns them on (off by default), then as posts of their own
    without the link to what they answered and without the handle of the person answered (X's and Mastodon's
    leading mentions are removed); X posts dated inside a period `protected-history.js` marks as protected only when
    the person chooses them; reposts, boosts, retweets and likes never; on Mastodon only public and unlisted posts,
    decided from the addressing before any other field is read; on X no Circle tweet and no deleted tweet; polls left
    out (korbat has none); on Bluesky every post self-labelled `porn`, `sexual` or `nudity` left
    out, since R1 forbids sexual content. Every left-out post is counted by reason in the preview. Alternative:
    replies to others on by default, or never offered.
11. **Images marked sensitive (owner).** Chosen: the images of a post its author marked sensitive (Mastodon
    `sensitive`, X `possibly_sensitive`) are left out and counted; the post's text is kept. Bulk input of images the
    author flagged is where R1 material would most likely come from, and korbat has no blur to put them behind.
    Alternative: import them and rely on the R1 check, which is off in every build today (inputs 2.3).
12. **Content warnings (owner).** Chosen: korbat cannot hide a post behind a warning, so a Mastodon post with a
    content warning (`summary`) is left out unless the person turns on "Include posts with a content warning" in the
    preview (off by default); an included one begins with the line "Content warning: <summary>" (the words in a shared
    constant), then an empty line, so readers see it is a warning, read before the content. Alternative: always
    include them with the marked line, or drop the warning, which shows the content without the warning its author
    chose.
13. **Long posts (owner).** Chosen: posts over korbat's 1,000 characters are left out by default; the person may
    choose "Shorten them to 1,000 characters", which cuts at the last space within the first 999 characters (or at
    999 when there is none), adds an ellipsis and marks the post ", shortened on import" in its label. Posts over 30,000
    characters (beyond any source's own limit) are left out as unreadable. Alternative: split a long post into a
    thread of korbat posts, which makes posts its author never wrote as such.
14. **The person's statement (owner, counsel).** Chosen: the confirm step requires a checkbox, "These are my own
    posts, and they were public where I posted them.", with under it "If they are not, korbat can remove them, and it
    can count against your account." Its time is recorded on the import. It answers two facts no archive proves: who
    wrote the posts (inputs 3.4) and whether they were public; for X, posts from protected periods are left out unless
    the person chooses them beside a sentence saying they were not public then (section 5.5). Alternative: no
    statement, relying on reports alone.
15. **Imported images, and while no matcher is on (owner, counsel).** Chosen: images are imported only while the
    owner's switch `IMPORT_IMAGES` is `on`, and the API refuses to start with it `on` while `MEDIA_MATCH` is `off`
    (on an open site `MEDIA_MATCH=test` is refused already, by 3d). So no build imports images today: imports are text
    only until the owner connects a real matcher source, and the preview counts the images left behind with the
    reason. While images are on, the person still chooses whether to bring them ("Bring images", off by default:
    photos can be found by image search and can show other people). Alternative: import images as native uploads
    are, unchecked; a bulk path for thousands of foreign images is not the place to accept what no tool has looked at.
16. **Which sources are on, and Bluesky (owner, counsel).** Chosen: each source has an owner's switch, the list
    `IMPORT_SOURCES` (default `x,mastodon`). Bluesky is off by default: anyone can download anyone's repository
    without signing in (inputs 3.3), so a Bluesky archive proves nothing about who uploads it, and a copied history
    reaches no feed where the person copied would see it. The README says what turning it on accepts. When on,
    Bluesky imports are text only: the export holds no image files and korbat never fetches them from a PDS by DID.
    Alternative: Bluesky on by default, resting on the statement and reports alone; later, an optional second archive
    of blobs, each file accepted only when its SHA-256 equals the digest of a CID a kept post names (section 14).
17. **The worker's lane for imported images (owner).** Chosen: the worker is not changed. The API's import feeder
    puts an imported image into the worker's `incoming/` only when no other upload waits there for the worker, with
    at most two imported images in flight and at most `IMPORT_IMAGES_PER_HOUR` (600 by default) on the site, so a
    person's own upload waits behind at most two imported images (section 7.4). Alternative: a second queue directory
    the worker drains only when `incoming/` is empty (a protocol change in packages/media-protocol and apps/worker),
    or a second worker container if the host has the CPU.
18. **A refused image stops the import (owner, counsel).** Chosen: an import prepares every chosen image before it
    publishes any post. If 3d's matcher refuses one of them, the import stops before anything is published: the
    refused upload is held and told exactly as 3d holds and tells any refused upload, the person reads 3d's notice and
    one sentence that the import stopped, naming the post the image came from by its date and first words (never the
    image) and offering to import the text only, the other prepared images and the work output are deleted unopened,
    and no measure touches the account (main design, lines 370, 371 and 401). One archive therefore spends at most two
    of the site's 20 refusals an hour (the images in flight when the first was refused). An image whose match does not
    act is not published at all (section 8.1): an importer did not choose it image by image. Alternative: skip that
    post and continue, which goes on processing an archive known to hold such material; publish a non-acting match as
    for a native post.
19. **Images whose check is not answered (owner).** Chosen: while a matcher is on, an imported image whose check is
    `unchecked` or `capped` waits for 3d's `match-retry` for up to 24 hours from its upload; an image still not
    `clear` then is left out of its post and counted. Alternative: treat imports as native uploads, which may be
    posted with an unanswered check (3d design, 7.8 step 6).
20. **Images without a description (owner).** Chosen: korbat has no way to edit an image's description after
    posting, for native posts either, so an imported image is attached only with a description: the one its source
    gave (cleaned, at most 1,000 characters) or one the person writes for it in the preview's list of posts; an image
    with neither (every X image, many Mastodon ones, unless described) is left out and counted `no_description`, and
    2b's rule that every attached image has a description holds unchanged. Alternative: attach such images without
    one under a relaxed CHECK, which leaves screen-reader users "No description was given" with no way for the author
    to fix it; or an edit of descriptions for every image first (section 14).
21. **The limits of an import (owner).** Chosen: an archive is a file its uploader writes, so a made-up one is a bulk
    write path. An account may import only once it is at least 7 days old (`IMPORT_MIN_ACCOUNT_AGE_DAYS`) and its
    email is verified (`import_too_soon` otherwise); an account younger than 30 days publishes at most 1,000 posts per
    import (`IMPORT_MAX_POSTS_NEW`), the rest counted `new_account_cap`. One active import per account; three
    published imports per account in seven days (a failed, wrong, cancelled, expired or refused one costs nothing),
    and five imports started per client address in a day, with a sentence of its own; at most 2 GiB uploaded, 50,000
    posts kept and 5,000 images kept per import; at most two archives being uploaded or scanned on the site at once
    (`IMPORT_MAX_ACTIVE`, 2, under a lock). Imports never count against 2a's post limits, 2b's upload limits or 3e's
    flood count (section 8.5), since they reach no feed and never use the upload route; against the bulk path staff
    see an import's size on a case and an admin can end a whole import (section 8.7), and RichText marks every link
    `rel="nofollow ugc noopener"`. Alternative: count imports in the existing buckets, which makes an archive of 3,000
    images six days of a person's daily upload cap; or no age floor, which lets a fresh account publish 50,000 posts.
22. **Undo (owner).** Chosen: one action, "Remove imported posts", tombstones every post of the import through the
    author's own deletion path, in batches of 200 under a job, with its progress on the import screen; it keeps the
    freeze, the holds, evidence and every counter right, as every deletion does. The API role still cannot delete a
    post (migration 0015). Alternative: a migrator-owned hard delete, which would bypass the freeze and the holds.
23. **Counts and reposts (owner).** Chosen: imported posts count in the profile's post count, as every post does, so
    a deletion or an undo needs no branch; anyone may like, reply to, quote or repost an imported post, and a repost
    reaches the reposter's followers as any repost does, one deliberate act at a time under 2a's repost limit; the
    words say so (section 10.9). Alternative: leave imported posts out of the count and out of reposts.
24. **Importing the same archive twice (owner).** Chosen: a later import by the same account skips every post an
    earlier import of the account published and that still exists, and the preview counts them as "already
    imported"; the key is per account, so two accounts importing the same archive are not linked by it. Alternative:
    no check, which doubles a profile with one click.
25. **The import's record (owner, counsel).** Chosen: the `import_jobs` row holds the source, the state, the times, the
    person's choice and counts only, never a file name or a source handle, and no text but the first words of a post
    whose image was refused (at most 80 characters, shown to the person alone, section 8.2); the counts of `not_public`
    skips and the month table leave `scan` when the import leaves `ready`, so nothing derived from private posts is
    kept. It stays while any post of it exists and at least 30 days after its end, and goes with the account's purge.
    Alternative: delete it as soon as the import ends, which takes the undo with it.
26. **Archives korbat refuses (owner).** Chosen: Mastodon archives in `.tar.gz` (instances older than 4.2) and X
    archives split into parts (`isPartialArchive`) are refused with a sentence naming the reason and what can be done;
    for a split X archive, which long-standing accounts most likely have, it says the posts are safe in the archive and
    to try again after korbat's next update, since no source this design used says which part holds
    `data/manifest.js` and the tweets (section 14 holds that research and a text-only read of that part).
    Alternative: add `tar-stream` 3.2.2 for the first and a multi-file upload for the second.
27. **The parsing libraries (owner).** Chosen: `stream-json` 3.7.0 for X's and Mastodon's JSON, and `@ipld/car`
    5.4.7 with `@ipld/dag-cbor` 10.0.2, `cborg` 6.1.3 and `multiformats` 14.0.5 for Bluesky's CAR (the versions of
    2026-10-21; Task 3 pins what is at least 7 days old on its day, and the lockfile-age gate decides), each pinned
    exactly in apps/importer/package.json, every block's CID checked by korbat with `node:crypto` (inputs 4.2, 4.3). Not
    `@atproto/repo` (zod 3 beside korbat's zod 4, a large tree), not `@zip.js/zip.js`, `unzipper` or tus.
    Alternative: korbat's own bounded decoder of the atproto subset of DAG-CBOR, a few hundred lines.
28. **What the import screen says first (owner, counsel).** Chosen: before the upload starts the screen says, one
    sentence each: what an import reads, and that the rest is never opened (for Mastodon, that direct and
    followers-only posts share the posts' file and are skipped by their addressing, never kept or logged); that the
    whole archive passes through korbat's server and its network provider and is deleted when the scan ends, at the
    latest within 24 hours, and which folders and files the person may delete from it first; that anyone who searches
    the words of an imported post can find the original and the account that wrote it; and that korbat did not check
    who wrote the archive. The last two are said again beside the statement. The terms gain a section "Importing
    posts" that says the same, with the licence korbat takes in imported posts and images (the same as for native
    ones), and the data export lists imports (section 11). For counsel, in one list (section 13, Task 8's README):
    holding an archive with other people's messages for up to 24 hours and its transit through the network provider
    (decision 4); the statement as the only proof of authorship and of a post having been public (decisions 14, 16);
    images only behind a real matcher (decision 15); not publishing a non-acting match, holding the refused image and
    the address (decision 18); third parties' personal data in imported posts (handles, replies, photos: the impact
    assessment); the record's 30 days after its end (decision 25); the licence in the terms (section 11.3).
    Alternative: say only what is read and deleted.
29. **No new public figure (owner).** Chosen: `/transparency` gains no count of imports; refused imported uploads are
    counted where 3d already counts refused uploads, and decisions about imported posts where every decision is
    counted. Alternative: a yearly count of imports, which on a small service is a statement about a few known people.
30. **The console (owner).** Chosen: staff see an imported post's label wherever the console shows a post (the case
    page, its snapshot, the composer's preview), and on a case the import's size ("One of 1,240 posts imported
    together"); an admin can end a whole import from a case with the step-up action `import_ended_by_staff`, which
    writes its audit row, mails the person and runs the person's own undo path (section 8.7). There is no console page
    listing imports, archives or staged posts, since nothing in them is a moderation matter until it is published.
    Alternative: an operator's list of active imports, which shows who is moving from where; or no bulk remedy, which
    leaves staff one post at a time against 50,000.

## 3. What exists

A short summary of korbat-scratch/research-3b/inputs.md (sections 1 and 2); its text holds the line numbers. No file
in apps/ or packages/ names an import yet.

### 3.1 The brief and what changed it

- Main design section 6a (lines 230 to 255) is the brief. Later amendments change it: the quarantine bucket is a
  volume and uploads stream through the API (2b, lines 290 and 296); the worker is images-only with no network, no
  credentials and no capabilities (line 291); an R1 score opens a finding and withholds one image only where
  `AUTOMATION_R1_ACTS=on` (3d, line 399); an R2 match refuses and holds the one upload, never aborts anything else,
  suspends nobody and reports to nobody abroad (3d, line 400; 3e, lines 370 and 371); imported @mentions never notify
  (2d, line 335); the UI sub-project runs before 3b (line 414).
- 3d's design (`2026-10-09-transparency-automation-3d-design.md`, lines 4170 to 4175) leaves three questions to 3b:
  what an import does when one of its images is refused (decision 18), whether it waits while checks are unchecked
  (decision 19), and the volume a burst of imports puts against the program's caps (section 8.1). 3d makes no
  backfill, and 3b inherits that.
- 3d's `media-quarantine` volume (infra/compose.yml:468) holds sealed files only: it is not the import quarantine.

### 3.2 Posts

- `posts` (packages/db/src/schema/content.ts:22 to :67): `body` at most 1000 code points (CHECK `posts_body_len`),
  `reply_to_id` and `quote_of_id` (set null on delete), `state`, four counters, `created_at`, `deleted_at`,
  `moderation_level`, `erased_at`, Explore's three columns; indexes `posts_author_created_idx`,
  `posts_created_id_idx`, `posts_reply_to_created_idx`, the partial `posts_latest_idx`; row-level security with one
  policy for the API role.
- The API role may UPDATE only `body`, `state`, `deleted_at` and the four counters, and may DELETE no post or profile
  (packages/db/migrations/0015_greedy_zuras.sql:423, :426). `posts_guard` (last replaced in
  0028_orders_ledger.sql:125) forces an insert's state and level to visible.
- `createSocialRepo().createPost` (apps/api/src/social/repo.ts:535 to :565) writes one post per transaction:
  `guardPair`, `lockActing` (3e's predicate on the locked author row), `lockLive`, the insert, the counters,
  `within` (images attach here), `judgeActing`. `deletePost` (:579) tombstones (`deleted_by_author`, `body = ''`) and
  fixes counters; the flow (apps/api/src/social/flows/posts.ts:90) detaches images and keeps every image a case
  holds or a frozen post owns. `purgeProfile` (:1361) tombstones every post of a deleted account.
- The body rules (packages/contracts/src/social.ts:26 to :59): `POST_MAX_LENGTH` 1000, `normalizePostBody`,
  `PostText` refusing control characters and `FORBIDDEN_FORMAT`.
- Readers: `followingTimeline` (repo.ts:838), `latestTimeline` (:861), `profilePosts` (:873), `profileReplies`
  (:888), and Explore's one candidate predicate in `exploreRules` (:458 to :478), whose comment says "Later rules
  about imports belong here". 3f's rule: every new reader answers a `disabled` post as missing, through `postAccess`
  and `isShown` (apps/api/src/social/visibility.ts).

### 3.3 Images

- The upload (apps/api/src/media/flows/upload.ts:44): declared type, `MEDIA_MAX_BYTES` 20 MiB, the account,
  `enforceUploadLimit`, `MAX_PENDING_UPLOADS` 20, the free-space floor `MEDIA_MIN_FREE_BYTES` (2 GiB), then the
  streamed body, sniffed on its first bytes; with the matcher on, `files.receiveHashed` takes SHA-256, SHA-1 and MD5;
  `repo.insertProcessing` (media/repo.ts:155, with `liveNotSuspended`) and `files.commit` hand it to the worker.
- The file protocol (packages/media-protocol/src/layout.ts): `media-uploads` with `tmp/`, `incoming/`, `delete/`,
  `delete-owed/` (the API writes, the worker reads); `media-store` with `files/`, `results/`, `attempts/`, `tmp/`,
  `heartbeat` (the worker writes, the API reads). Ids are lowercase UUIDs the API makes.
- The worker (apps/worker/src/loop.ts): deletions, then at most one upload from `incoming/`, oldest first, then
  result cleanup; 120-second watchdog; three attempts. It has no network, no capabilities, 768m and one CPU
  (infra/compose.yml:239 to :266).
- `post_media` (content.ts:122 to :160): CHECK `post_media_attached_is_complete` requires a description on an
  attached image; `AltText` requires a visible character (packages/contracts/src/media.ts:51).
- The sweeper (apps/api/src/media/sweeper.ts): `PROCESSING_TIMEOUT_MS` 5 minutes, `UNATTACHED_TTL_MS` 24 hours,
  `ORPHAN_AGE_MS` 1 hour.
- 3d's checks: the worker's `Scorer` (apps/worker/src/score.ts; `R1_CLASSIFIER` is `off` or `test` in every build);
  the matcher seam (apps/api/src/media/match-adapter.ts: `off` or `test`); `finalize` (media/flows/status.ts:18) makes
  an image ready only once its check was answered or timed out, and leaves a capped one processing; tables
  `media_hashes` (`check_state` pending, clear, matched, unchecked, capped), `media_matches`, `upload_refusals`
  (packages/db/src/schema/moderation.ts:1298, :1335, :1383); the automated step `imagesPublished`
  (apps/api/src/moderation/automated.ts:351) after a post's commit; 20 refusals an hour, 20 automated decisions an
  hour and 100 a day (0038_automated_decisions.sql:82). The freeze: `post_frozen` and `frozen_for`
  (0015_greedy_zuras.sql:714 to :723).

### 3.4 Accounts, export, limits and jobs

- Standing (apps/api/src/lib/standing.ts): `liveNotSuspended`, `WRITE_CLOCK` and the four rules; the architecture
  test pins every file that names them (apps/api/test/architecture.test.ts:310 to :323).
- Every account is email-verified at creation (apps/api/src/auth/repo.ts:298).
- Deletion and purge: `confirmDeletion` and `purge` (apps/api/src/account/flows/deletion.ts:28, :52), the job
  `account-purge` every five minutes (apps/api/src/account/purge.ts:59).
- The export (apps/api/src/account/flows/export.ts, the `posts` member at :190; `ExportFormat` in
  packages/contracts/src/account.ts:224, `korbat-export-1`, whose member order is part of the bytes).
- Write limits (apps/api/src/social/tiers.ts `limitsFor`): posts 5 or 30 an hour, uploads 20 or 120 an hour and 60 or
  500 a day; the global 300 requests a minute per address (apps/api/src/app.ts:72); `enforceAccountLimit` fails
  closed.
- Body limits: Hono's 64 KiB JSON limit exempts only `POST /api/media` (app.ts:64 to :67); Caddy allows 25MB for
  `/api/media` and 64KB elsewhere (infra/caddy/Caddyfile:55 to :66).
- Jobs run in the API under a Valkey lock (apps/api/src/lib/jobs.ts `createJob`); the API has 512m
  (infra/compose.yml:124).
- Modules are entered through their index only; the architecture test lists seven
  (apps/api/test/architecture.test.ts:28): auth, social, media, account, staff, moderation, transparency.

### 3.5 The app and the console after the UI sub-project

- The UI design (`2026-10-21-interface-experience-ui-design.md`) runs before 3b; 3b builds on what its ten tasks
  leave: the kit in apps/app/src/components/kit/ (Text, Icon, IconButton, Sheet, Menu, Tabs, ListRow, Skeleton,
  EmptyState, ErrorState, StatusChip, VisuallyHidden, PublicFrame; section 10.1 adds three parts), the toasts, the
  Settings index and SettingsNav, the profile's Tabs, PostCard with "Who sees this" (apps/app/src/lib/reach.ts), the
  words modules, the bare-string scan of apps/app/test/a11y.test.tsx, and the app's browser check
  (apps/app/test/browser/app.browser.ts with fixture-api.ts, at 360, 768 and 1280 px in Light, Dim and Dark).
- The profile is apps/app/src/app/u/[handle]/index.tsx; a post is apps/app/src/app/post/[id].tsx. The console
  (apps/admin) shows posts in a case page and its snapshot, under a strict content security policy.

### 3.6 The source formats and the libraries

The formats are inputs 3.1 to 3.3, as section 5 uses them. X's file names are known mostly from open-source parsers,
so the X adapter is tested against fixtures, not trusted as a contract; Mastodon's `outbox.json` holds every status,
direct messages included; anyone can download anyone's Bluesky repository without signing in. The libraries are
inputs 4's, checked against the 7-day floor, none AGPL (decision 27). Cloudflare's request body limit is 100 MB on
Free and Pro and its proxy read timeout 125 seconds (inputs 5.1), so an archive of up to 2 GiB needs chunks.

## 4. The import flow end to end

An import is one row of `import_jobs` (section 6.1) moving through twelve states. The API writes every state; the
importer service (section 7.1) only reads an archive and writes a work folder. Every timed step runs in one API job,
`import-drive`, every five seconds under a Valkey lock (section 7.5).

### 4.1 The states

| State | Meaning | Next |
|---|---|---|
| `uploading` | The archive's chunks are arriving | `scanning`, `failed` (the first chunk is not an archive), `cancelled`, `expired` |
| `scanning` | The archive is complete and waits for, or is in, the importer | `ready`, `failed`, `cancelled` |
| `ready` | The preview is shown; nothing is published | `preparing`, `publishing`, `cancelled`, `expired` |
| `preparing` | Confirmed; the chosen images pass the image pipeline and the checks | `publishing`, `stopped` |
| `publishing` | Posts are written in batches, oldest first by the archive's date | `done`, `stopped` |
| `done` | Every chosen post that could be published was published | `undoing` |
| `stopped` | Ended early: a refused image, the person's Stop, an admin's end (8.7), or time ran out | `undoing` (when posts were published) |
| `undoing` | "Remove imported posts" is tombstoning the import's posts | `undone` |
| `undone` | Every post of the import is deleted | none |
| `failed` | The archive was refused or could not be read | none |
| `cancelled` | The person cancelled before confirming | none |
| `expired` | The upload or the preview was left for 24 hours | none |

The first five states are active: an account has at most one active import, which a unique index enforces (section
6.1). `undoing` is not active, so a person can remove one import's posts while another import runs.

### 4.2 Choosing the source and uploading

1. The person opens Settings, Import posts (/settings/import) and picks a source the site has on (X and Mastodon;
   Bluesky only when the owner turns it on, decision 16). The screen says, for
   that source, how to download the official archive and what korbat reads from it and never reads (section 10.2).
2. They pick the file. The app checks its size against 2 GiB and its first bytes (a zip's `PK\x03\x04`, a CAR's
   varint and CBOR header, or gzip's `\x1f\x8b`, which gets the `.tar.gz` sentence at once) before anything is sent.
3. `POST /api/imports` with `{ source, bytes }` creates the row in `uploading` after these checks, cheapest first:
   imports switched on (`IMPORTS`) and the source among `IMPORT_SOURCES` (decision 16), the account live and not
   suspended (3e's predicate in the statement that locks the profile row), at least 7 days old with its email verified
   (`import_too_soon`, 403; `users.email_verified_at`, set at creation today, 3.4, read through the auth index), no
   active import of the account, the weekly limit (imports of the account with `confirmed_at` in the last 7 days and
   `posts_published` above 0, counted in the create statement) and the per-address limit, fewer than `IMPORT_MAX_ACTIVE`
   imports in `uploading` or `scanning` on the site (counted in the create's transaction under `pg_advisory_xact_lock`
   on a fixed key, as social/repo.ts's `pairLock` takes its own), the importer's heartbeat younger than 60 seconds, and
   free space on `import-archives` of at least the declared size, plus 4 GiB (the most a scan may write to
   `import-work`, section 7.2), plus `IMPORT_MIN_FREE_BYTES`. A refusal for site reasons answers 503
   `imports_unavailable` ("Imports are paused for now. Try again later."), never a partial file.
4. The app sends the file in chunks of exactly 8 MiB (the last one shorter), one at a time, each a `PUT` with its
   offset and its SHA-256 (section 7.3). After a lost connection or a reload the app reads the stored offset and goes
   on from there; the person sees a progress bar and may cancel.
5. The chunk that completes the declared size closes the file with `fsync`, renames it from `archive.part` to
   `archive`, writes the importer's job file and its queue marker, and moves the row to `scanning` in the same request.
   An upload not complete 24 hours after its creation is `expired` and its part deleted by `import-drive`.

### 4.3 Scanning

1. The importer takes the oldest queue marker, reads the job file (source, per-account key, whether images are on)
   and opens the archive read-only. It refuses at once what is not the declared source's archive, an
   X archive in parts, an encrypted zip, or a zip over any limit of section 7.2, and writes a summary with the failure
   code.
2. Otherwise it reads only the source's allowlisted entries (section 5), keeps only the person's own public posts,
   converts each to korbat's plain text, sorts them by the archive's date, and writes `posts.jsonl` (one
   `ImportedPost` a line), the allowlisted images of kept posts when images are on, and last `summary.json`, the
   commit point, with its counts by reason. It never writes a text, a name or an id from the archive to its log.
3. `import-drive` sees the summary, deletes the archive at once, and runs the intake (section 7.5): it reads every line
   of `posts.jsonl` with the contract's parser and caps, finds the posts this account already imported, builds the month
   table the preview needs, notes where the three newest lines start (the preview's samples), and writes the scan's
   counts to the row, which moves to `ready`, or to `failed` with the failure code. A scan not done 45 minutes after the
   upload ended, or 24 hours after the import was created if that comes first, is `failed` with `scan_timed_out`, and
   its archive and work folder go.

### 4.4 The preview and the choice

The preview (section 10.4) shows what was found: the number of posts and the first and last month, the number of
images and how many will be imported, and every count of what will be left out, each with its reason in plain words.
The person chooses:

- everything, or a range of months (from and to, inclusive);
- whether to include replies to other people (off by default, decision 10);
- what to do with posts over 1,000 characters: leave them out (default) or shorten them (decision 13);
- when the archive has them: posts with a content warning (off, decision 12) and X posts from protected periods (off,
  5.5); while images are imported, whether to bring images at all (off, decision 15);
- post by post: "See every post" lists, 50 a page, every post of the archive as it will read (those the choice
  leaves out dimmed), each with a checkbox "Leave this one out" and, while images are brought, its images with a
  description field for each image its source gave none (decision 20). Each change is saved at once in
  `import_picks` (6.1).

The counts under the choice change as it changes, computed by the app from the month table's groups and the picks,
so the button says exactly what will happen: "Publish 1,240 posts". The person ticks the statement "These are my own
posts, and they were public where I posted them." (decision 14), and confirms. A preview not confirmed within 24
hours of the scan is `expired`, and its work folder is deleted.

### 4.5 Confirming, preparing and publishing

1. `POST /api/imports/:id/confirm` with the choice and the statement stores both, makes the row's random seed
   (section 6.1), and moves it to `preparing` when the choice holds images, else straight to `publishing`.
2. **Preparing** (only with images). The feeder of `import-drive` copies each chosen image from the work folder into the
   media pipeline as an upload of the person's (section 7.4): a fresh `post_media` row marked imported, hashed when the
   matcher is on, sniffed and capped exactly as an upload. It feeds them two at a time, only while no person's own
   upload waits for the worker, and at most `IMPORT_IMAGES_PER_HOUR` on the site. Each image settles as kept (ready,
   with a clear check), left out (failed, refused by the pipeline's rules, a match that does not act, not answered by
   the matcher within 24 hours), or refused by the matcher. Only images that will be attached are fed: those of kept
   posts, with a description (decision 20), when the person chose to bring images. The first refusal stops the import
   (section 8.2). When every image has settled, the row moves to `publishing`.
3. **Publishing.** `import-drive` writes the chosen posts in batches of 200, oldest first by the archive's date, each
   batch one transaction of the social module's batch writer (section 6.5), judged by 3e's predicate. After each commit
   the moderation module's `imagesPublished` runs for every new post with images, as for a native post. A suspension
   that starts makes the next batch wait; the import goes on when the suspension ends, or stops when time runs out
   (4.8).
4. When the cursor reaches the end, the row is `done`; the work folder is deleted. The person sees the result
   (section 10.5) and their profile's Imported tab.

### 4.6 Stopping and undoing

- **Stop.** While `preparing` or `publishing`, "Stop import" moves the row to `stopped` (`by_author`) at once;
  published posts stay, unpublished ones and prepared images go with the work folder.
- **Undo.** On a `done` import, or a `stopped` one with published posts, "Remove imported posts" asks once (a Sheet,
  section 10.5), then moves the row to `undoing`. `import-drive` tombstones the import's posts in batches of 200
  through the author's deletion path (section 6.5): body blanked, state `deleted_by_author`, import columns cleared,
  counters fixed, images detached unless a case or a freeze keeps them, their files asked for after the commit. A post
  the person already deleted is passed over; a post disabled under an authority's order is left as it is, as the
  author's own deletion leaves it, and keeps its import columns (it is answered as missing anyway) until the purge
  clears them. When no post of the import is left that is neither deleted nor disabled, the row is `undone`.
- **Single posts.** Any imported post can be deleted on its own from its More menu, as any post.

### 4.7 Deletion with the account

The account's purge (`purge` in apps/api/src/account/flows/deletion.ts) needs no new state. `purgeProfile`
anonymises the profile, tombstones every post of the account, imported ones included, and clears their import
columns in the same statement; the media purge removes every image row, imported ones included, except those 3c and
3d keep; and the same transaction, through the imports module's `purgeOwner`, deletes every `import_jobs` row of the
account, whatever its state, and its `import_keys` row, which `import_jobs_delete` and `import_keys_delete` allow once
the profile is deleted. After the commit the purge asks for the deletion of every archive and work folder those rows
named. A batch of an import that waits at the
profile's lock meanwhile finds the account deleted and its job gone, and writes nothing. A crash between the commit and
the file requests is caught by the orphan pass of `import-drive` (section 7.5), which deletes every archive and work
folder that names no import row. A termination (3e) purges as a deletion does.

### 4.8 Abandonment and time limits

| What | Bound | Then |
|---|---|---|
| An upload not complete | 24 hours after the import was created | `expired`; the part is deleted |
| A scan not done | 45 minutes after the upload ended, or 24 hours after the import was created if that is sooner | `failed` (`scan_timed_out`); archive and work folder deleted |
| A preview not confirmed | 24 hours after the scan ended | `expired`; the work folder is deleted |
| An image whose check is not answered | 24 hours after its upload | left out of its post, counted |
| An import that cannot finish | 72 hours after the scan ended | `stopped` (`time_ran_out`); published posts stay |
| A finished import's record | 30 days after its end, once no post names it | the row is deleted |

The 72-hour bound covers a suspension that outlasts it and a feeder starved by a busy worker. The work folder never
outlives it.

## 5. Formats and adapters

### 5.1 The contract: `ImportedPost`

packages/contracts/src/imports.ts holds the normalised post every adapter's output becomes, shared by the importer,
which writes it, and the API, which reads it back as untrusted input:

```ts
export const IMPORT_SOURCE_KINDS = ["x", "mastodon", "bluesky"] as const;
export const ImportSource = z.enum(IMPORT_SOURCE_KINDS);

/** One kept post, one line of posts.jsonl. The importer writes it; the API parses every line with this schema. */
export const ImportedPost = z.strictObject({
  /** Its line in posts.jsonl, from 0; lines are in ascending order of `at`. */
  ref: z.number().int().min(0).max(IMPORT_MAX_POSTS - 1),
  /** HMAC-SHA256 of the source and the source post's id under the account's import key, as 64 lowercase hex. */
  key: z.string().regex(/^[0-9a-f]{64}$/),
  /** The date the archive gives the post, UTC, whole seconds. */
  at: z.iso.datetime({ offset: false, precision: 0 }),
  /** post: the account's own top-level post; thread: a reply to its own post; reply: a reply to someone else. */
  kind: z.enum(["post", "thread", "reply"]),
  /** The ref of the post a `thread` item answers, always lower than its own ref; null otherwise. */
  parent: z.number().int().min(0).nullable(),
  /** korbat's plain text: converted, cleaned and normalised (5.3); up to IMPORT_TEXT_MAX code points. */
  text: ImportedText,
  /** Images in the work folder, in order; `alt` is the source's description, normalised, or null. */
  media: z.array(z.strictObject({ file: ImportMediaFile, alt: AltText.nullable() })).max(MEDIA_MAX_PER_POST),
  /** X only: dated inside a period protected-history.js marks as protected (5.5); left out unless chosen. */
  protected: z.boolean(),
  /** Mastodon only: the text begins with a content warning's line (decision 12); left out unless chosen. */
  warning: z.boolean(),
});
```

`ImportedText` is `PostText`'s rule with `IMPORT_TEXT_MAX` (30,000) in place of `POST_MAX_LENGTH`.
`ImportMediaFile` is `<ref>-<position>.<jpg|png|webp>`, the only names the work folder's `media/` may hold. A line
whose `kind` is `thread` must have a `parent`, and only then; a line with neither visible text nor an image is never
written. The contract file also holds `ImportSummary` (the importer's summary, section 7.1), `ImportScanFacts` (the
intake's numbers, 6.1), `ImportChoice`, the views and error codes of section 9, and every number of this design as
a constant (`IMPORT_RULES`), as 3d's `AUTOMATION_RULES` does.

### 5.2 The adapter contract

Each source is a folder in apps/importer/src/adapters/ (x/, mastodon/, bluesky/) exporting one `SourceAdapter`:

```ts
export interface SourceAdapter {
  source: ImportSource;
  /** Entry names this adapter may open: exact names, or one anchored pattern per rule (^...$), never a bare prefix. */
  allowlist: readonly EntryRule[];
  /** From the allowlisted entries' names and sizes only: null when the archive is this source's, else why not. */
  detect(entries: readonly ArchiveEntry[]): ImportFailure | null;
  /** Every item the allowlisted files hold, each kept as a DraftPost or skipped with its reason; never throws on one item. */
  readPosts(archive: AllowedArchive, context: ReadContext): AsyncIterable<AdapterItem>;
}
```

- The zip reader (section 7.2) filters the central directory through `allowlist` before `detect` sees any name, so an
  adapter never learns that `direct-messages.js` exists. For a CAR, the archive is one pseudo-entry whose reader
  yields post records only (5.7).
- `AllowedArchive.open(name)` streams one allowlisted entry, inflated and capped; any other name throws.
- `DraftPost` carries the source post id and its parent's id (held in the importer's memory only), the date, the
  kind, the converted text, the flags (`sensitive`, `long`, `protected`, `warning`) and the media's entry names and
  descriptions.
- `AdapterItem` is `{ kept: DraftPost }` or `{ skipped: SkipReason }`; the core counts every skip by reason.
- The importer's core does the rest the same way for every source: the key (5.4), the thread links, the date checks,
  the sort, the image extraction and the writing. An adapter never writes a file.

So 6a's line 254 holds: each source is its `detect` and its `readPosts`; a later source (Threads,
Reddit) is a new folder, a new value in `IMPORT_SOURCE_KINDS` and `import_source`, and its fixtures.

### 5.3 Text conversion, common to all sources

In apps/importer/src/text.ts, in this order:

1. **HTML to text** (Mastodon only): a tokenizer of korbat's own, never a DOM and never rendering: `<p>` and `</p>`
   become paragraph breaks, `<br>` a line break, an `<a>` its text (Mastodon's link text with the invisible spans it
   adds for long URLs is joined back into the href's full text when the text is a shortened form of it), every other
   tag is dropped with its attributes, and the five named entities and numeric entities are decoded.
2. **Unescape** (X only): `&amp;`, `&lt;` and `&gt;` in `full_text`.
3. **Links**: every t.co link is replaced by the `expanded_url` its `entities.urls` gives, since t.co is a click
   tracker; a t.co link with no entity, and a media link (`entities.media[].url`), is removed.
3b. **Links to the source platform** (all sources): their paths hold the person's handle there, or someone else's,
   so each is replaced by fixed words: on X, a link whose host is `twitter.com`, `x.com` or a subdomain of either
   becomes "(a post on X)" when its path is `/<name>/status/<id>`, else "(a profile on X)"; on Mastodon, a link on the
   host of the Note's own `attributedTo` becomes "(a post on Mastodon)" (`/@<name>/<id>`, `/users/<name>/statuses/<id>`)
   or "(a profile on Mastodon)", and a quote's fallback paragraph (class `quote-inline`, "RE: <link>") is dropped in
   step 1; on Bluesky, a `bsky.app` link or an `at://` URI becomes "(a post on Bluesky)" or "(a profile on Bluesky)".
   Each is counted (`sourceLinks`) and the preview says so. Other links stay as text.
4. **Leading mentions**: on X the automatic `@name` run before `display_text_range[0]` is removed, as X itself hides
   it; on Mastodon the run of mention links (`<a class="u-url mention">` in `h-card` spans) at the very start of an
   item with `inReplyTo` is removed in step 1, so a reply keeps no handle of the person it answered. Mentions inside
   the text stay as typed, and are never linked (the last paragraph).
5. **Cleaning**: every control character but tab and line feed, and every `FORBIDDEN_FORMAT` character (invisible
   direction and spacing characters), is removed; each removal is counted (`cleaned`) and the preview says so.
6. **Normalising**: `normalizePostBody` (NFC, line breaks, at most two in a row, trimmed). Steps 5 and 6 run on image
   descriptions too; a description then over 1,000 code points (Mastodon allows 1,500) or with no visible character
   becomes null (counted `cleaned`), so it always meets `AltText` and never fails the line.
7. **Length**: more than 30,000 code points is skipped (`too_long_to_read`); more than 1,000 is kept with the flag
   `long`, for the person's choice (decision 13); the cut itself is the API's, at publication. A line of
   `posts.jsonl` may be up to 256 KiB (30,000 code points of 4 bytes, plus the JSON and the media names), the one
   cap the intake applies (7.5).

Mentions, hashtags and links stay plain text. An imported `@name`, `@name@instance` or X `@name` names someone on
another platform, never the korbat account of that handle, so RichText never links it: it gains a prop `mentions`
(default true), and PostCard, the post page and QuoteEmbed pass `mentions={post.imported === null}`, so an imported
body links URLs only (a test renders "@ada" in an imported post while an account @ada exists, and finds no `/u/`
link). Emoji shortcodes (`:blobcat:`) stay as typed, since custom emoji images are not imported.

### 5.4 Keys, refs and dates, common to all sources

- **The key.** `key = HMAC-SHA256(accountKey, source + ":" + sourcePostId)`, where `accountKey` is 32 random bytes
  made at the account's first import and kept in `import_keys` (6.1) until the account's purge erases it; the API
  writes it into the job file. There is no server-wide import key, so no key of the server alone links a korbat
  account to a source account, and an account's key links nothing between two accounts (decision 24). The
  source post id is the tweet's `id_str`, the Note's `id` URI, or the record's `at://` URI; it never leaves the
  importer's memory.
- **Refs.** After reading, the core sorts the kept posts by date (ties by key) and numbers them from 0; `parent` is
  the ref of a kept post whose source id the item named. A `thread` item whose parent is not kept, or whose
  parent's date is later than its own, becomes a `post`.
- **Dates.** A date before 2006-03-21 (the first tweet) or more than one day after the import was created is skipped
  (`date_out_of_range`); every date is converted to UTC and cut to whole seconds.
- **Limits.** At most 1,000,000 items are read (`IMPORT_MAX_ITEMS`); beyond it the scan stops and the preview says
  the archive was read in part (`over_item_cap`). At most 50,000 posts are kept (`IMPORT_MAX_POSTS`): the core keeps
  the newest 50,000 by date, because a person moving platforms most likely wants their recent posts, and counts the
  rest as `over_post_cap`. For this it keeps in memory, in a heap of at most 50,000 entries, only each candidate's
  date, key, source id, parent's source id and offset (about 10 MB at the cap); the converted text and the media
  names wait in a scratch file on the work volume, which is deleted when the scan ends (section 7.1).
- **Images.** Only while the job file says images are on. At most 5,000 are kept (`IMPORT_MAX_IMAGES`), those of the
  newest posts first, the rest counted `over_image_cap`; each is copied from its allowlisted entry to
  `media/<ref>-<position>.<ext>` after the sort, so only images of kept posts are ever inflated. A named file missing
  from the archive is counted `missing_file`, one over 20 MiB `too_large`, any other type `unsupported`.

### 5.5 X

**Allowlist.** `data/manifest.js`; `data/tweets.js`, `data/tweets-part<N>.js` (N from 1 to 99) and the older
`data/tweet.js`; `data/note-tweet.js`; `data/twitter-circle-tweet.js`; `data/protected-history.js` (for the
protected periods below, its timestamps and actions only); and, only when images are on, files matching
`^data/tweets?_media/[0-9]{1,20}-[A-Za-z0-9_-]{1,64}[.](jpg|jpeg|png|webp)$`. Every other entry, `account.js`,
`direct-messages*.js`, `ip-audit.js`, `deleted-tweets.js`, `like.js`, `follower.js` and the rest of inputs 3.1's list
included, is skipped by name from the central directory and never inflated.

**Detect.** `data/manifest.js` is present and at most 1 MiB; otherwise `not_this_source`. Its prefix must match
`^window\.__THAR_CONFIG = ` exactly and the rest parse as JSON (never evaluated); `archiveInfo.isPartialArchive`
true is `partial_archive` (decision 26). From it the adapter reads `userInfo.accountId` and the file names under
`dataTypes.tweets.files`, `dataTypes.noteTweet.files` and `dataTypes.twitterCircleTweet.files`, each of which must
also be on the allowlist; `userName` and `displayName` are never read into a variable. Without a manifest's file list
the three fixed names are tried.

**Read.** Each data file's prefix must match `^window\.YTD\.[a-z_]+\.part[0-9]+ = ` exactly and is dropped; the rest
streams through stream-json's parser with `packValues: false` (strings, keys and numbers arrive as chunks), under
korbat's own small assembler (apps/importer/src/json.ts) that builds one element at a time, counting its bytes and
depth, and throws `item_too_large` past 1 MiB or a depth of 64 before more is held; stream-json's own Assembler and
array streamer are not used, since they hold an element whole before its size can be read. Elements are
`{ "tweet": {...} }` or, in 2019 archives, the bare object. For each:

| Field or case | Rule |
|---|---|
| `full_text` starts with `RT @` | skipped, `repost` |
| `id_str` in `twitter-circle-tweet.js` | skipped, `not_public` (the Circle file is read first, ids only, into a set) |
| `edit_info` names later versions | only the highest id of `editTweetIds` is kept; the others are skipped, `older_version` |
| `in_reply_to_status_id_str` set, `in_reply_to_user_id_str` equals the manifest's `accountId` | `thread`, parent by that id |
| `in_reply_to_status_id_str` set, any other user | `reply` (kept only if the person includes replies) |
| no reply field | `post` |
| quote (a trailing status link of twitter.com or x.com) | kept as text; the link becomes "(a post on X)" (5.3 step 3b) |
| `created_at` (`Wed Oct 10 20:19:24 +0000 2018`) | the date, parsed by a strict pattern, UTC |
| truncated post whose `note-tweet.js` entry has the same second and a text that starts with the tweet's visible text before its ellipsis | the note's `core.text` replaces the text; unmatched notes are ignored |
| `possibly_sensitive` true | images left out, `sensitive`; text kept |
| `extended_entities.media` (else `entities.media`) of `type` `photo` | an image: the file `<id_str>-<basename of media_url_https>` in the media folder, no description |
| media `video` or `animated_gif` | not imported, counted `video` |

Protected accounts have no per-tweet mark, but `data/protected-history.js` records when protection was turned on and
off: only its timestamps and actions are read, and a tweet dated inside a protected period is marked `protected`. Such
posts are left out unless the person chooses them in the preview, beside the sentence "If your account on X was
protected, its posts were not public then. Do not import them unless you mean to make them public." (decision 14).
`deleted-tweets.js` is outside the allowlist, so deleted posts are never read.

### 5.6 Mastodon

**Allowlist.** `outbox.json` at the archive's root; and, only when images are on, files matching
`^media_attachments/files/([0-9]{3}/){1,8}original/[0-9a-f]{16}[.](jpg|jpeg|png|webp)$` which a kept Note names. A
deeper path or one with `..` matches neither source's pattern (x.test.ts, mastodon.test.ts).
`actor.json`, `likes.json`, `bookmarks.json`, `avatar.*` and `header.*` are never opened.

**Detect.** `outbox.json` present at the root and at most 1 GiB uncompressed, and `actor.json` present (its name is
read from the central directory; the file is not opened); else `not_this_source`. A gzip archive is refused before the
importer by its first bytes (`tar_gz`).

**Read.** stream-json's parser and korbat's assembler (5.5) stream `orderedItems` one item at a time, each at most
1 MiB and 64 levels deep. The order of the checks is the data-minimisation rule: for each item the adapter reads
`type` first, then the Note's `to` and `cc`, and only for a kept Note any other field.

| Field or case | Rule |
|---|---|
| `type` `Announce` | skipped, `repost`; its embedded object is never read |
| `type` `Create`, Note addressing: `to` holds `https://www.w3.org/ns/activitystreams#Public` | public: kept |
| `to` holds the followers collection and `cc` holds as:Public | unlisted: kept (it reaches the profile only, as on korbat) |
| no as:Public in `to` or `cc` | private, direct or limited: skipped, `not_public`, before any other field is read |
| object `type` `Question` | skipped, `poll` |
| `inReplyTo` names a status of the Note's own actor (its `attributedTo` followed by `/statuses/`) | `thread`, parent by that URI (the core keeps the link only when that parent is kept) |
| `inReplyTo` anything else | `reply` |
| `quote`, `quoteUri` or `_misskey_quote` | kept as text; the quoted post's URI is not added |
| `summary` not empty | the text begins "Content warning: <summary>", then an empty line; marked `warning`, left out unless chosen (decision 12); counted in `warnings` |
| `published` (ISO 8601) | the date |
| `updated` | ignored: only the current version is in the archive |
| `content` | HTML to text (5.3); `contentMap` is not read |
| `sensitive` true | images left out, `sensitive`; text kept |
| `attachment` of `mediaType` image/jpeg, image/png or image/webp | an image: the path from `url`, normalised (a leading slash and anything up to `media_attachments/` dropped) and matched to an allowlisted entry by that exact remaining path; `name` is the description |
| other attachments (video, audio, gifv, a Link card) | not imported, counted `video` or ignored for a card |
| `tag` (mentions, hashtags, emoji) | not read: the text already holds what was typed |

A Note's `attributedTo` is read only to tell a self-reply from a reply, never kept, and is not compared with
`actor.json` (which is never opened): the outbox holds only the account's own statuses (inputs 3.2).

### 5.7 Bluesky

**Allowlist.** The CAR's header, its commit block, the MST nodes reached from the commit's `data`, and the record
blocks whose MST key starts `app.bsky.feed.post/`. No other record is decoded, no blob is read (there are none), and
a `chat.jsonl` or anything else that is not a CAR is refused by its first bytes at upload (`not_an_archive`).

**Detect.** The first bytes are a varint and a DAG-CBOR map `{ version: 1, roots: [cid] }` with exactly one root;
the root's block is a commit `{ did, version: 3, data, rev, prev, sig }`. The DID is used only to recognise the
account's own `at://` URIs in replies; it is never stored, logged or written to the work folder.

**Read.** Two passes over the file (inputs 4.3), since a CAR's blocks come in any order: pass 1 with `@ipld/car`'s
`CarIndexer` records each block's CID, offset and length without decoding, refusing a block over 1,000,000 bytes and
more than 2,000,000 blocks; then the commit is decoded and the MST walked from `data` (at most 48 levels, at most
4,096 entries a node, every node visited once), collecting the record CIDs of the keys `app.bsky.feed.post/<rkey>`;
pass 2 reads and decodes only those records with `@ipld/dag-cbor`. Every block decoded is first hashed with
`node:crypto` and compared with its CID's SHA-256 digest; a mismatch is `unreadable`.

| Field or case | Rule |
|---|---|
| a record under any collection but `app.bsky.feed.post` (reposts, likes, follows, lists, profile, gates) | never decoded |
| `reply.parent.uri` is `at://<the commit's did>/app.bsky.feed.post/<rkey>` | `thread`, parent by that URI |
| `reply` to any other URI | `reply` |
| `embed` `app.bsky.embed.record` or `recordWithMedia` (a quote) | kept as text; the quoted URI is not added |
| `embed` `app.bsky.embed.images`, `gallery` or `video` | not imported: the export has no files; counted `bluesky_no_files` |
| `embed` `app.bsky.embed.external` (a link card) | the card is dropped; the text keeps the link as typed |
| `labels` self-labels `porn`, `sexual` or `nudity` | skipped, `adult_label` (decision 10) |
| `labels` `graphic-media` | kept; it is not sexual content, and readers may report it under the rules |
| `createdAt` (RFC 3339, set by the client) | the date, converted to UTC |
| `text` | taken as is (it holds no HTML); `facets` are not read: links stay as typed, but for 5.3 step 3b |
| `langs`, `tags` | not read |

### 5.8 The rules side by side

| | X | Mastodon | Bluesky |
|---|---|---|---|
| Self-thread | reply to the manifest's account id | `inReplyTo` a Note of the outbox | `reply.parent` under the account's DID |
| Quote | text kept, link replaced by fixed words | text kept, fallback paragraph dropped | text kept |
| Links to the source | fixed words | fixed words (the instance's host) | fixed words (`bsky.app`, `at://`) |
| Not public | Circle tweets skipped; protected periods left out unless chosen | private, direct, limited skipped first | everything is public |
| Images | `photo`, downscaled copies, no description | `original` files, `name` as description | none in the export |
| Sensitive | `possibly_sensitive`: images left out | `sensitive`: images left out; `summary` kept as a marked first line, posts left out unless chosen | adult self-labels: post left out |
| Text | unescape, t.co expanded, leading mentions removed | HTML to text, a reply's leading mentions removed | as is |
| Long posts | `note-tweet.js`, up to 25,000 | instance limit | 300 graphemes, never long |

## 6. The database

Three migrations, 0043 to 0045, each a drizzle-generated part for the tables, columns and indexes the schema files
declare, followed by hand-written SQL for the triggers, grants and checks, as 0016 to 0042 are written: every
function owned by the migrator, `SET search_path = public, pg_temp`, every object schema-qualified, EXECUTE taken from
PUBLIC, errors raised with their code as the message under SQLSTATE P0001 (or 42501 for a forbidden column), enum
values compared as text. No existing migration is edited. The schema gains packages/db/src/schema/imports.ts and
changes packages/db/src/schema/content.ts.

### 6.1 `import_jobs`, `import_picks` and `import_keys`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid primary key | made by the API (`randomUUID`); it names the import's folders |
| `owner_id` | uuid not null, references `profiles` | no on delete clause: no profile row is ever deleted |
| `source` | `import_source` (`x`, `mastodon`, `bluesky`) | |
| `status` | `import_status` (the twelve states of 4.1) | forced to `uploading` at insert |
| `declared_bytes` | bigint not null | CHECK between 1 and 2147483648 (`IMPORT_MAX_BYTES`) |
| `received_bytes` | bigint not null default 0 | CHECK between 0 and `declared_bytes`; only grows |
| `created_at` | timestamptz not null | forced to `clock_timestamp()` at insert |
| `uploaded_at`, `scanned_at`, `confirmed_at`, `ended_at` | timestamptz | each set once, by the move that names it |
| `failure` | text | CHECK in the closed list `IMPORT_FAILURES` (section 9.3); set exactly when `status` is `failed` |
| `stop_reason` | text | CHECK in `refused_image`, `by_author`, `by_staff`, `time_ran_out`; set exactly when the import was stopped (it stays through `undoing` and `undone`) |
| `staff_ended_at`, `staff_rule_id` | timestamptz; text | set together, once, by the admin's `import_ended_by_staff` (8.7), in the move into `stopped` or `undoing` |
| `refused_at_original`, `refused_words` | date; text | the archive's date and the first words (at most 80 code points, CHECK) of the post whose image was refused (8.2), set together, shown to the person alone |
| `scan` | jsonb | the intake's numbers (`ImportScanFacts`): counts by reason, the month table, the sample refs and offsets, the pages; never a text; CHECK an object of at most 262,144 bytes |
| `choice` | jsonb | `ImportChoice` (months from and to, replies, long posts, warnings, protected, images); CHECK an object of at most 1,024 bytes |
| `stated_at` | timestamptz | the person's statement; set with `choice`, never without it |
| `seed` | bytea | 32 random bytes made at confirmation, from which the import's post and image ids are derived (6.5); cleared when the import ends (`done` or `stopped`) |
| `post_cursor` | integer not null default 0 | lines of `posts.jsonl` handled; only grows |
| `image_cursor` | integer not null default 0 | images handed to the feeder; only grows |
| `posts_published`, `images_kept`, `images_left_out`, `posts_removed` | integer not null default 0 | progress counts; only grow |

Indexes: `import_jobs_one_active` unique on `owner_id` where `status` in (`uploading`, `scanning`, `ready`,
`preparing`, `publishing`), which is the one-active rule; `import_jobs_status_idx` on (`status`, `created_at`) for
`import-drive`; `import_jobs_owner_idx` on (`owner_id`, `created_at`) for the account's list.

Two triggers, plain (not security definer), skipped for the migrator as every guard is:

- `import_jobs_insert`, before insert: forces `status` `uploading`, `created_at`, `received_bytes` 0, the four
  progress counts and both cursors 0, and every other column but `id`, `owner_id`, `source` and `declared_bytes` to
  null; it refuses an owner whose profile is deleted (`not_found`). The live and suspension check is the API's
  statement's, under 3e's predicate (section 8.5), not the trigger's.
- `import_jobs_guard`, before update: `id`, `owner_id`, `source`, `declared_bytes` and `created_at` never change;
  `status` moves only along the arrows of 4.1, and into `undoing` only from `done`, or from `stopped` with
  `posts_published` above 0; `ended_at` is set by the move into `done`, `stopped`, `undone`, `failed`, `cancelled` or
  `expired` and at no other time; `choice`, `stated_at`, `seed` and `confirmed_at` are set together, once, by the move
  out of `ready`; `seed` may then only become null; `uploaded_at` is set by the move into `scanning` with
  `received_bytes` equal to `declared_bytes`; `scanned_at` by the move out of `scanning`; `scan` by the move into
  `ready`, and once more by the move out of it, which drops its `not_public` count, its month table and its samples,
  keeping `fromRef` and the counts the result screen shows; `staff_ended_at` and `refused_at_original` are set once, by
  the moves that name them (8.7, 8.2); counts and cursors never go down. Every refusal raises `import_column` under
  42501.

A third, `import_jobs_delete`, before delete, refuses deleting a row in an active state or in `undoing` unless its
owner's profile is deleted (the purge's own transaction anonymises the profile before it deletes the rows, 4.7).
Deleting a row that a post still names fails on the foreign key (6.2).

`import_picks` (`import_job_id` uuid references `import_jobs` on delete cascade; `ref` integer; `left_out` boolean not
null default false; `alts` jsonb, an array of at most four `AltText` or null, CHECK at most 8,192 bytes; primary key
(`import_job_id`, `ref`)) holds the person's choices post by post (4.4). `import_picks_guard`, before insert or update,
refuses unless the job is `ready`; `import-drive` deletes a job's picks when it ends, and the cascade in any case.

`import_keys` (`owner_id` uuid primary key, references `profiles`; `key` bytea, CHECK 32 bytes; `created_at`) holds
each importing account's random key of 5.4, inserted at its first import (`on conflict do nothing`). It is never
updated; `import_keys_delete`, before delete, refuses unless the owner's profile is deleted, so only the purge
erases it.

### 6.2 New columns of `posts`

| Column | Type | Rule |
|---|---|---|
| `import_job_id` | uuid, references `import_jobs` | no on delete clause: a job row cannot go while a post names it |
| `import_source` | `import_source` | the source, for the label |
| `original_created_at` | timestamptz | the archive's date, for the Imported tab and the label |
| `import_shortened` | boolean | the post was cut to 1,000 characters on import |
| `import_key` | bytea | the key of 5.4, 32 bytes |

CHECK `posts_import_columns`: the five are all null (a native post, or a tombstone) or all set. Every native post is
untouched: the columns are null and nothing that writes them today changes.

Indexes:
- `posts_import_key_idx`, unique, on (`author_id`, `import_key`) where `import_key` is not null: a post is imported
  once per account while it exists (decision 24).
- `posts_imported_idx` on (`author_id`, `original_created_at`, `id`) where `import_job_id` is not null and
  `reply_to_id` is null: the Imported tab.
- `posts_import_job_idx` on (`import_job_id`, `id`) where `import_job_id` is not null: the undo, the foreign key's
  checks and the job's count of posts.
- `posts_author_native_idx` on (`author_id`, `created_at`, `id`) where `import_job_id` is null: Following's own
  branch and the Posts and Replies tabs, so a followed account's 50,000 imported posts are never scanned there.
- `posts_latest_idx` is replaced by the same index with `and import_job_id is null` added to its predicate.

`posts_import_guard`, before insert or update, plain, skipped for the migrator:

- An insert with `import_job_id` set must name a job whose `owner_id` is the post's `author_id`, whose `status` is
  `publishing` and whose `source` is `import_source`; its `original_created_at` must lie between 2006-03-21 and one
  day after the job's `created_at`; its `quote_of_id` must be null; and its `reply_to_id`, when set, must name a post
  of the same job. So an import can write only its own author's posts, only while it publishes, and never a reply to
  or a quote of anyone.
- An update may change the five columns only to null, all at once, and only in the statement that makes the post's
  state `deleted_by_author` or on a row already in that state (the author's deletion, the undo, the purge); no update
  ever sets them. Refusals raise `import_column` under 42501.

Grants: the API role gains UPDATE on the five columns (posts' column grants of 0015 name seven; the guard decides what
an update may do). It still has no DELETE on `posts`.

### 6.3 New columns of `post_media`

| Column | Type | Rule |
|---|---|---|
| `imported` | boolean not null default false | the image came from an import; it never changes |
| `import_job_id` | uuid, references `import_jobs` on delete set null | the running import that owns the upload; it lets the sweeper leave it alone and the import clean it up |

CHECK `post_media_attached_is_complete` does not change: an imported image is attached only with a description
(decision 20). CHECK `post_media_import_link`: `import_job_id is null or imported`.

`post_media_import_insert`, before insert, plain, skipped for the migrator: an insert with `imported` true must name an
`import_job_id` whose job has the row's `owner_id` and status `preparing`; one with `imported` false must name none.
The API role gets no UPDATE on either column, so neither changes after the insert; `on delete set null` runs as the
table's owner. `post_media_import_attach`, before update of `post_id`: an imported image is attached only to a post
whose `import_job_id` is its own `import_job_id`.

### 6.4 Row-level security and grants

| Table | RLS | API role |
|---|---|---|
| `import_jobs` | enabled, one policy for the API role (`import_jobs_api_all`), as every table | SELECT, INSERT, DELETE (under `import_jobs_delete`), UPDATE of every column but `id`, `owner_id`, `source`, `declared_bytes` and `created_at`, all under `import_jobs_guard` |
| `import_picks` | enabled, one policy for the API role | SELECT, INSERT, UPDATE of `left_out` and `alts`, DELETE, under `import_picks_guard` |
| `import_keys` | enabled, one policy for the API role | SELECT, INSERT, DELETE (under `import_keys_delete`); no UPDATE |
| `posts` | unchanged | UPDATE of the five new columns under `posts_import_guard`; INSERT as before, under `posts_guard` and `posts_import_guard` |
| `post_media` | unchanged | INSERT of the two new columns under `post_media_import_insert`; no UPDATE of them |

`korbat_auth` gets nothing on any of them; `korbat_notify` nothing. The import module names 3e's predicate in one
statement only, the one that creates an import (section 8.5); every other write of an import is judged inside the
social and media repositories, which already name it.

### 6.5 The writers

Every write of a post or an image row stays in the module that owns the table; the new `imports` module
(apps/api/src/imports/) calls them through the social and media modules' indexes.

- **Derived ids.** A post's id is `uuidFrom(SHA-256(seed || "post:" || ref))` and an image's
  `uuidFrom(SHA-256(seed || "image:" || ref || ":" || position))`, where `uuidFrom` takes the first 16 bytes, sets
  the version-4 and variant bits and writes lowercase hex, so `isMediaId` accepts every image id. A parent's id is
  computed, not looked up, and a repeated batch inserts nothing twice (`on conflict do nothing`). Outsiders cannot
  predict an id without the seed, which is cleared when the import ends.
- **`social.publishImportedBatch(job, lines, now)`** (apps/api/src/social/repo.ts), one transaction per batch of at most
  200 lines: `lockActing` on the author's row `for no key update` (3e's predicate, by `WRITE_CLOCK`); then the job row
  `for update`, which must still be `publishing` at the cursor the caller read; every parent the batch's counter
  statement will write (the parents of its `thread` lines already in `posts`) taken with `lockPostsInOrder`
  (social/repo.ts:1455, in id order, as `createPost` and `deletePost` take theirs); one insert of every post of the
  batch the choice keeps (a line is kept when its ref is at least `scan.fromRef`, its marks pass the choice and its pick
  does not leave it out; a `thread` line whose parent is left out is written as a top-level post), with `created_at` the
  transaction's `now` plus the line's place in the batch in microseconds, so a thread's replies keep their order in
  `replies`, which sorts by `created_at`; the parents' reply counts and the author's post count in one statement each,
  as `purgeProfile` writes them; the batch's settled images attached through `media.attach` (6.3's rules) with the
  source's description or the person's from the pick; the cursor and the counts; and `judgeActing`. The body is the
  line's text, cut for a shortened post (decision 13); a line whose cut text and kept images leave nothing visible is
  skipped. After the commit, `moderation.imagesPublished` runs for each new post with images. A refusal of the predicate
  rolls the batch back and the import waits (4.5).
- **`social.removeImportedBatch(job, now)`**, one transaction per batch of at most 200 posts: the author's row
  `for no key update`; the batch, selected by id from
  `import_job_id = $1 and state <> 'deleted_by_author' and moderation_level <> 'disabled'` (an empty batch is the
  caller's sign to move to `undone`), and every post they reply to, taken with `lockPostsInOrder` (`for no key update`,
  in id order, the order 3c's reports take posts in); the tombstones (`deleted_by_author`, `deleted_at`, `body = ''`,
  the five import columns null); the counters in one statement each; `media.detachAll` for each tombstoned post, inside
  the transaction, whose keep trigger leaves every image a case holds or a frozen post owns; `posts_removed`. The files
  of the rows that went are asked for after the commit, as the deletion flow asks for them
  (apps/api/src/social/flows/posts.ts:90).
- **`deletePost`** and **`purgeProfile`** set the five import columns to null in the statement that tombstones, so a
  deleted imported post keeps nothing of its source.
- **`media.insertProcessing`** (apps/api/src/media/repo.ts:155) takes an optional `{ importJobId }`: with it, the
  upload's row is written with `imported` true and the job's id in the same statement (the owner's row `for key share`
  with 3e's predicate, the hashes when the matcher is on, the closing judgment), so media/repo.ts names
  `liveNotSuspended` and `closingJudgment` no more often than today.
- **`media.deleteImportLeftovers(tx, jobId)`** (media/repo.ts): deletes the job's rows with `post_id` null, in id order,
  under the keep trigger, `returning id`; their files are asked for through the media index, so the imports module
  never names `post_media` or `requestDeletion`.
- **`media.attach`** attaches imported images unchanged: every imported image has a description (decision 20); the
  trigger `post_media_refused` still refuses a refused or held upload.

### 6.6 Retention, and what the purge erases

| What | Kept | Erased by |
|---|---|---|
| The archive (`import-archives/jobs/<id>/`) | until its summary is read; never beyond 24 hours after the import was created | `import-drive`; the purge's request; the orphan pass |
| The work folder (`import-work/jobs/<id>/`) | until the import is `done`, `stopped`, `cancelled`, `expired`, `failed` or `undone`; never beyond 72 hours after the scan | the importer, on the API's request |
| Prepared images not published | until the import leaves `preparing` or `publishing` | `import-drive`, through the media module's deletion (rows held by a refusal stay, as 3d keeps them) |
| `import_jobs` row | while a post names it, and at least 30 days after its end | `import-drive`'s retention step; the account's purge |
| Imported posts | as any post, until the author, the undo or the purge deletes them | the deletion paths of 6.5 |
| Import columns of a deleted post | never: cleared in the tombstoning statement; a disabled post keeps them until the purge | `deletePost`, `removeImportedBatch`, `purgeProfile` |
| `post_media.import_job_id` | until its job row goes | the foreign key's `set null` |
| The seed | from confirmation until the import ends | the move into `done` or `stopped` |
| The account's import key (`import_keys`) | from the first import until the account goes | the account's purge |

The purge (4.7) leaves what 3c, 3d and 3f keep for every account: a case's copy, a sealed or held image, a preserved
post.

### 6.7 The migrations

- **0043_imports.sql.** The enums `import_source` and `import_status`; the tables `import_jobs`, `import_picks` and
  `import_keys` with their checks and indexes; RLS and the policies; the grants; the triggers `import_jobs_insert`,
  `import_jobs_guard`, `import_jobs_delete`, `import_picks_guard` and `import_keys_delete`. Hand-written after the
  drizzle part: the triggers, the column grants, and a comment that names each CHECK's constant in
  packages/contracts/src/imports.ts, which a database test holds equal.
- **0044_imported_posts.sql.** The five columns of `posts` and the two of `post_media`; the CHECKs
  `posts_import_columns` and `post_media_import_link`; `posts_import_key_idx` and `posts_import_job_idx`; the
  triggers `posts_import_guard`, `post_media_import_insert` and `post_media_import_attach`; the grants of 6.4; and
  `decision_actions_check` replaced with 0032's body and one change, `and p.import_job_id is null` in the flood count
  (8.5).
- **0045_import_readers.sql.** The readers' indexes: `posts_imported_idx`, `posts_author_native_idx`, and
  `posts_latest_idx` dropped and created again with its new predicate. Kept apart from 0044 so that the index builds
  on a large `posts` table run in a migration of their own, which the README's upgrade notes name as the slow one.

Each migration's drizzle snapshot is regenerated in packages/db/migrations/meta, as every earlier sub-project's.

## 7. The services

### 7.1 The importer

**The app.** apps/importer, a TypeScript app built like apps/worker: `package.json` (`@korbat/importer`, type module,
the scripts `build`, `typecheck`, `test` and `test:lab`), `build.mjs` (esbuild, one bundle, no native module),
`Dockerfile` on the worker's base image (`node:24.21.0-alpine` at the worker's digest), the runtime stage copying only
`dist/`, creating `/import/archives` and `/import/work` owned by `node`, `USER node`. Dependencies, exact pins:
`@korbat/contracts` and `@korbat/import-protocol` (workspace), `stream-json` 3.7.0, `@ipld/car` 5.4.7,
`@ipld/dag-cbor` 10.0.2, `cborg` 6.1.3, `multiformats` 14.0.5, `pino` 10.3.1 and `zod` 4.6.5 (the versions the
workspace already pins). These are the versions of 2026-10-21; on the day Task 3 runs it pins the four IPLD packages
(`@ipld/car`, `@ipld/dag-cbor`, `cborg`, `multiformats`) to the versions the lockfile then resolves that are at least
7 days old, so one copy of each is installed (`cborg` 6.1.4, published 2026-10-19, passes the floor on 2026-10-26 and
would otherwise resolve beside a direct 6.1.3). Transitive dependencies (`stream-chain`, `varint`) resolve under
pnpm-workspace.yaml's release-age floor; Task 3 records every resolved version, and scripts/check-lockfile-age.mjs
decides.

**The Compose service**, in infra/compose.yml beside `worker`:

```yaml
  importer:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/importer/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 512m
    memswap_limit: 512m
    cpus: 0.5
    pids_limit: 32
    tmpfs: ["/tmp:size=16m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      IMPORT_ARCHIVES_DIR: /import/archives
      IMPORT_WORK_DIR: /import/work
    volumes:
      - import-archives:/import/archives:ro
      - import-work:/import/work
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/import/work/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4
```

The two volumes join the `volumes:` list with a comment each: `import-archives` ("Archives waiting for the importer,
deleted when read and within 24 hours. In no backup, by decision: an archive holds the person's messages and other
people's data.") and `import-work` ("The importer's output, deleted within 72 hours. In no backup."). The API mounts
`import-archives` read-write at `/import/archives` and `import-work` read-only at `/import/work`. Neither the worker
nor any other service mounts them.

**The file protocol**, in a new package packages/import-protocol (`layout.ts`, `limits.ts`, `summary.ts`, `lines.ts`,
`open.ts`), shared by the API and the importer as packages/media-protocol is shared by the API and the worker:

```
import-archives (the API writes, the importer reads)
  jobs/<id>/archive.part   the archive while chunks arrive
  jobs/<id>/archive        the complete archive
  jobs/<id>/job.json       { v: 1, id, source, accountKey, images, createdAt }
  queue/<id>               the API's marker: this archive waits for a scan (oldest mtime first)
  delete/<id>              the API's request: delete the work folder of <id>, and stop scanning it
import-work (the importer writes, the API reads)
  jobs/<id>/scratch        the scan's scratch file (5.4), deleted when the scan ends
  jobs/<id>/posts.jsonl    one ImportedPost a line, in date order
  jobs/<id>/media/<ref>-<n>.<ext>   allowlisted images of kept posts, as found in the archive
  jobs/<id>/summary.json   the commit point, written last (ImportSummary)
  attempts/<id>            how often a scan of <id> started
  tmp/                     files being written; renamed into place
  heartbeat                rewritten every ten seconds
```

Ids are lowercase UUIDs made by the API; `isImportId` refuses anything else before a path is built, as `isMediaId`
does. Every file is written under `tmp/`, flushed and renamed, so the API never sees half a file.

**The API's one opener.** The importer parses hostile input, so the API trusts nothing it wrote, not even a path:
every file of `import-work` the API reads (`summary.json`, `posts.jsonl`, the samples and the preview's pages, each
image the feeder streams or the preview shows) is opened by `openWorkFile` of packages/import-protocol, which
`lstat`s the path and requires a regular file whose `st_dev` is the `import-work` mount root's (a symlink, or a
symlinked folder anywhere on the path, leads elsewhere and is refused), opens it with `O_RDONLY | O_NOFOLLOW` where
the platform has it, `fstat`s the descriptor and requires the same device and inode, and reads only through that
descriptor. A refused file counts as `missing_file`, and the API logs the job id and the code. So an importer taken
over by a crafted archive cannot make the API copy a file of `media-store` into an import.

**The loop** (apps/importer/src/loop.ts), after the worker's: each tick handles deletion requests (removing the work
folder; a request for the archive being scanned aborts that scan), then at most one archive from `queue/` whose job
has no summary and no deletion request, oldest first, then sleeps 1 second when idle. A scan:

1. counts the attempt first (`attempts/<id>`); at a third start it writes the summary `failed: interrupted` without
   opening the archive, so a file that kills the process cannot loop;
2. reads `job.json` (at most 4 KiB, parsed with its schema), clears any earlier output of the job, and opens the
   archive by file descriptor (never following a symlink: `O_NOFOLLOW`, a regular file, at most `IMPORT_MAX_BYTES`);
3. runs the zip reader or the CAR reader, the adapter, the core (section 5), writing `posts.jsonl` and the images;
4. writes `summary.json`: `{ v: 1, id, status: "scanned", posts, images, skipped: { reason: count }, imagesSkipped:
   { reason: count }, cleaned, warnings, sourceLinks, protectedPosts, readInPart }` or `{ v: 1, id, status: "failed",
   failure }`, counts only.

A watchdog of 30 minutes per scan (`IMPORTER_WATCHDOG_MS`) ends the process, as the worker's does; Docker restarts it
and the attempt counter does the rest. The scratch file and the work folder's `tmp/` count against the volume, not
the 16 MB tmpfs. The process holds at most one item, one heap of keys and one image stream at a time.

**What it logs.** The job id, the phase, timings, the failure code, and the counts by reason once, at the end; a line
per item only for `unreadable` and `item_too_large` (its reason and its index in the stream), never for a skip, so the
logs hold no trace of each private post the scan passed over. Never a text, a description, a file name from the archive,
an entry name, a source id, a handle or a DID. A source-scan test (apps/importer/test/log.test.ts) refuses a log call
whose fields name anything but these.

### 7.2 The zip reader and its limits

apps/importer/src/zip/ (`central.ts`, `entry.ts`, `limits.ts`), korbat's own (decision 2):

1. Find the end of central directory record in the file's last 65,557 bytes; follow the ZIP64 locator and record when
   present. A file under 22 bytes, without the record, with a comment that runs past the end, or with more than one
   disk, is `not_an_archive`.
2. Read the central directory, at most `ZIP_MAX_ENTRIES` (200,000) entries and at most 64 MiB of directory, and for
   each entry check, before any name reaches an adapter: the name is at most 512 bytes of valid UTF-8 (or CP437 when
   bit 11 is clear, decoded to ASCII only); no NUL, no backslash, no drive letter, no leading slash, no `.` or `..`
   segment, no empty segment. An entry whose name fails any of these can match no allowlist rule: it is never opened,
   only counted. A directory (trailing slash) or a symlink (`externalFileAttributes >>> 16` with type `0o120000`) is
   ignored and never opened.
3. Filter the names through the adapter's allowlist. Only allowlisted entries are checked further and opened. Two
   central entries with one allowlisted name refuse the archive (`bad_entry_name`), since a reader that takes either
   could be steered.
4. For each allowlisted entry: encryption (flag bit 0) is `encrypted`; a method other than 0 (stored) or 8 (deflate)
   is `unreadable`; its uncompressed size is at most 1 GiB for a data file and 20 MiB (`MEDIA_MAX_BYTES`) for an
   image; its compression ratio (uncompressed over compressed) is at most 100; its data range lies inside the file
   and does not overlap any other allowlisted entry's range (the overlapping-files bomb); the sum of the allowlisted
   entries' uncompressed sizes is at most 4 GiB (`too_large_uncompressed`). The entry and data-file limits are
   above inputs 4.1's 100,000 and 512 MiB: a long-standing X account's archive holds tens of thousands of media files
   beside its data, and a generated `tweets.js` of 60,000 tweets is 400 MB (12.5), which leaves 512 MiB too little room.
5. Opening an entry reads its local header and refuses one whose name, method or flag bit 0 differs from the central
   entry, and, when flag bit 3 is clear, one whose CRC or sizes differ. When bit 3 is set (an entry streamed by its
   writer, as Java's `ZipOutputStream` writes every deflated one), the local CRC and sizes may be zero (or 0xFFFFFFFF
   with a ZIP64 extra) and the central entry's are used. The data range starts after the local header's own name and
   extra lengths (which may differ from the central entry's), and the overlap check of step 4 includes the data
   descriptor (12, 16 or 24 bytes). It inflates with `node:zlib` `createInflateRaw`, counting bytes and stopping one
   byte over the central size (`unreadable`), and checks the CRC-32 with `zlib.crc32` at the end. Nothing is ever
   extracted to a path built from an entry name: a data file streams straight into the adapter's parser, and an image
   streams into `jobs/<id>/media/<ref>-<n>.<ext>`, a name the core makes.

### 7.3 The chunked upload in Caddy and the API

| Number | Value | Why |
|---|---|---|
| `IMPORT_CHUNK_BYTES` | 8 MiB (8,388,608 bytes), fixed in the contracts | under Cloudflare's 100 MB; at 1 Mbit/s one chunk takes about 67 seconds, inside the 125-second proxy read timeout |
| `IMPORT_MAX_BYTES` | 2 GiB (2,147,483,648 bytes) | 6a's cap; 256 chunks, under the global 300 requests a minute |
| Caddy's body limit for a chunk | 9MB | the chunk plus slack, behind the API's own count |
| Chunks per account | 600 an hour (`import-chunk`) | a 2 GiB archive with retries; the global limit still applies |

- Caddy (infra/caddy/Caddyfile, the API's `handle /api/*`): a matcher `@import_chunk` for `PUT` on
  `path_regexp ^/api/imports/[0-9a-f-]{36}/archive$` with `request_body @import_chunk { max_size 9MB }`, and the
  `@json` matcher gains `not @import_chunk`'s path and method, so every other route keeps 64KB.
- Hono (apps/api/src/app.ts): the JSON body limit's exemption grows from exactly `POST /api/media` to that and exactly
  `PUT /api/imports/:id/archive` (the same id pattern).
- The route reads three headers: `Import-Offset` (decimal, the byte at which the chunk starts), `Content-Length`
  (required; at most 8 MiB; exactly 8 MiB unless the chunk ends the archive) and `Import-Chunk-Sha256` (64 lowercase
  hex). It refuses, in this order: an import that is not the caller's or not `uploading` (`not_found`, `wrong_state`);
  an offset that is not the stored size (`wrong_offset`, 409, with the stored size, so a retry learns where to go on);
  a length that breaks the rules above or runs past the declared size (`chunk_too_large`, 413); free space under
  `IMPORT_MIN_FREE_BYTES` (`imports_unavailable`, 503). It then streams the body onto the end of `archive.part`
  (opened with `O_APPEND`, never following a symlink), counting bytes and hashing as they arrive, and stops one byte
  over the length. A short body, a hash that differs, or a lost connection truncates the file back to the stored size
  (`chunk_mismatch`, 400), so the file only ever holds whole chunks that passed. The first chunk's first bytes must be a
  zip's local header or a CAR's header for the declared source, checked before they are kept; otherwise the import
  moves to `failed` (`tar_gz` for gzip's first bytes, else `not_an_archive`) and the route answers `not_an_archive`.
- After a chunk the row's `received_bytes` is updated in one statement that also requires the old value, so two
  requests racing for one offset cannot both win; the file's own size is the truth the route reads first, and a
  row behind its file (a crash between the write and the update) is set to the file's size on the next request.
- The last chunk `fsync`s, renames `archive.part` to `archive`, writes `job.json` and `queue/<id>`, and moves the row to
  `scanning` with `uploaded_at`.
- `GET /api/imports/:id` answers `receivedBytes` for the app's resume. The app sends one chunk at a time, waits for its
  answer, and on a network error reads the import again before it sends anything.

### 7.4 The worker's lower-priority lane for imported images

The worker is not changed (decision 17). The lane is the feeder in apps/api/src/imports/feeder.ts, a step of
`import-drive`, for the one import in `preparing` that has waited longest (one import is fed at a time):

1. It feeds only when no other upload waits for the worker: no file in `media-uploads/incoming/` without a result in
   `media-store/results/` that is not an imported image's. A person's own upload therefore waits behind at most the
   imported images already in flight.
2. At most `IMPORT_IMAGES_IN_FLIGHT` (2) imported images are in `processing` without a result on the site at once.
3. At most `IMPORT_IMAGES_PER_HOUR` (600 by default, an owner's setting that may be lowered) imported images are fed
   on the site in any hour, counted in the limit store (`import-images-site`).
4. To feed one image it computes the derived media id (6.5), streams the work folder's file into
   `media-uploads/tmp/<id>.part` through the media module's own receive path (the 20 MiB cap, the first-bytes sniff
   that refuses animated and unsupported images, the three hashes while the matcher is on), writes the row with
   `media.insertProcessing` and the job's id (6.5), and commits the file to `incoming/<id>`. A file the sniff refuses
   is left out (`unsupported`), never retried. The job's `image_cursor` moves in the same transaction as the row; that
   transaction takes the job row `for no key update` after the owner's row and before the insert, and writes nothing
   unless the job is still `preparing`, so a Stop that commits first leaves no new row.
5. Each round it finalizes its in-flight images through the media module's `finalize` (the sweeper would too, every
   30 seconds) and settles each. Images are on only while a matcher is (decision 15), so every imported image has a
   check: `ready` with a check of `clear` is kept; `ready` with a check of `matched` (a match that does not act: not
   exact, or of another class) is left out of its post as `flagged` and never published (section 8.1); `failed` is
   left out; an image still `unchecked` or `capped` 24 hours after its row was written is left out (decision 19); an
   upload refusal stops the import (section 8.2).

The sweeper (apps/api/src/media/sweeper.ts) leaves imported rows of a running import alone: `failStale` and
`deleteUnattachedBefore` gain `and import_job_id is null`, and `pendingCount` gains `and not imported`, so a person's
own limit of 20 pending uploads never counts imported images. For every import that has left `preparing` or
`publishing` and still has unattached rows, each round (not once, on the move), `import-drive` calls
`media.deleteImportLeftovers` (6.5), which deletes them and asks the worker for their files, as the sweeper asks.

At 600 images an hour, the cap of 5,000 images per import takes a little over eight hours; the 72-hour bound of 4.8
leaves room for a busy worker.

### 7.5 The job `import-drive`

apps/api/src/imports/drive.ts, `createJob({ name: "import-drive", intervalMs: 5_000, lockTtlMs: 60_000 })`, each round
a plain function of the clock that tests call with any time, each step safe to repeat:

1. **Scans done.** For each import in `scanning` with a `summary.json`: delete the archive folder and the queue marker;
   read the summary (at most 64 KiB, `ImportSummary`); on `failed`, move to `failed` and ask for the work folder's
   deletion; on `scanned`, run the intake and move to `ready`.
2. **The intake.** Read `posts.jsonl` line by line, each line at most 256 KiB (5.3 step 7) and parsed with
   `ImportedPost`; refs must run 0, 1, 2 in order and every image file named must exist and be at most 20 MiB. A line
   that fails is counted `unreadable` and dropped from the month table. For an account younger than 30 days, every
   readable line but the newest 1,000 is counted `new_account_cap` and left out of the month table, and `scan.fromRef`
   names the lowest ref that may be published (decision 21). In batches of 1,000 keys, ask which keys the account
   already has on posts (`posts_import_key_idx`) and count them `already_imported`. Build the month table (per month and
   group of marks: posts, images, and images without a source's description), note every 50th line's byte offset (the
   preview's pages) and pick the three newest lines as samples (ref and byte offset). Write it all to `scan` in the move
   to `ready`. Bounded at 50,000 lines and 1 GiB.
3. **Time limits.** The bounds of 4.8, each one statement.
4. **Feeding.** The feeder of 7.4 for the import in `preparing` that has waited longest; an import whose images have
   all settled moves to `publishing`.
5. **Publishing.** For each import in `publishing`, up to ten batches of 200 lines a round (about 2,000 posts every 5
   seconds), through `social.publishImportedBatch`; at the end of `posts.jsonl`, move to `done` and ask for the work
   folder's deletion.
6. **Undoing.** For each import in `undoing`, up to five batches of 200 a round through `social.removeImportedBatch`;
   when its batch is empty (no post of the import is left that is neither deleted nor disabled), move to `undone`.
7. **Retention.** Delete the picks of every import that has ended, and the rows of imports that ended more than 30
   days ago and that no post names.
8. **Orphans** (every tenth round). Delete every folder in `import-archives/jobs/` and every queue marker, and ask
   for every work folder, whose id names no row, once older than one hour (`ORPHAN_AGE_MS`); withdraw deletion
   requests the importer has carried out.

A suspended author's batch is refused by 3e's predicate and the round passes on to the next import; the job never
holds a lock across rounds.

### 7.6 Rate limits

| Bucket | Limit | Key | Where |
|---|---|---|---|
| `import-week` | 3 published imports in 7 days (`confirmed_at` in the window, `posts_published` above 0) | account | counted from `import_jobs` in the create statement (4.2 step 3), not in the limit store |
| `import-address-day` | 5 imports created in a day | client address (`clientIpKey`) | the imports route |
| `import-chunk` | 600 chunks an hour | account | `limitsFor("import-chunk")` |
| `import-act` | 20 confirms, cancels, stops and undos an hour | account | `limitsFor("import-act")` |
| `import-pick` | 3,000 picks an hour | account | `limitsFor("import-pick")` |
| `import-images-site` | `IMPORT_IMAGES_PER_HOUR` (600) | the site | the feeder |
| global | 300 requests a minute | client address | unchanged (apps/api/src/app.ts:72) |

Every limit fails closed (503) when the store cannot count, as `enforceAccountLimit` does. Imports never count in
the `post`, `reply` or `upload` buckets (decision 21).

### 7.7 Settings

In apps/api/src/config.ts and infra/compose.yml's `api` environment, with infra/.env.example (no new secret: the
keys of 5.4 are per account, in the database):

| Setting | Default | Meaning |
|---|---|---|
| `IMPORTS` | `on` | `off` refuses every new import with `imports_unavailable`; running imports finish |
| `IMPORT_IMAGES` | `off` | `on` imports images; the API refuses to start with `on` while `MEDIA_MATCH` is `off` (decision 15) |
| `IMPORT_SOURCES` | `x,mastodon` | the sources a new import may name (decision 16); `bluesky` joins only by the owner's choice, which the README explains |
| `IMPORT_MAX_ACTIVE` | 2 | imports in `uploading` or `scanning` on the site at once |
| `IMPORT_IMAGES_PER_HOUR` | 600 | the feeder's site-wide pace; 0 to 600 |
| `IMPORT_MIN_FREE_BYTES` | 2 GiB | free space kept on `import-archives`, beyond a new import's declared size and the 4 GiB a scan may write |
| `IMPORT_ARCHIVES_DIR`, `IMPORT_WORK_DIR` | `/import/archives`, `/import/work` | the mounts |

## 8. Moderation and safety

### 8.1 R1 and the matcher on imported images

An imported image enters through the media module's own receive path, so through the scorer's and the matcher's
seams, the attach block and the outbox, as 3d's section 16 expects, with no check of its own:

- **The matcher.** While `MEDIA_MATCH` is on, the feeder hashes the file as an upload is hashed and `finalize` asks the
  source before the image is ready (3d design, 7.8 step 3). An acting match refuses and holds the upload (8.2). An
  image whose match does not act is not published: 3d publishes such a native upload and puts it before a person
  afterwards, since its uploader chose it, but an importer chose none of thousands image by image, so korbat does not
  publish first and ask later. It is left out of its post (`flagged`,
  "Images korbat could not accept"), an admin is alerted through moderation's `staffAlert`, its match record is kept
  as 3d keeps the record of an upload with a match that never reached a post, and its file goes with the import's
  leftovers. Nothing publishes it later; the author may post it as any upload, which meets 3d's native rule.
- **The scorer.** As for a native image: scored while `R1_CLASSIFIER` runs a model, and at publication
  `imagesPublished` opens a finding and, only where `AUTOMATION_R1_ACTS=on`, withholds that one image (main design,
  line 399). No build has a model today (inputs 2.3).
- **While the matcher is off.** No image is imported (decision 15), and the preview counts the images left behind.
  3d makes no backfill, and nor does 3b: an import confirmed while images were off stays text only.
- **The caps.** An import meets 3d's caps as native uploads do: 20 refusals an hour, 20 automated decisions an hour and
  100 a day for R1 and for R2 (0038_automated_decisions.sql:82). Three things keep a burst of imports from spending
  them: the feeder's site-wide pace (600 images an hour), at most two imported images in flight, and the stop at the
  first refusal, so one archive spends at most two refusals (both in flight when the first was found). Beyond the
  refusals' cap an upload stays `processing` with its check `capped`, as 3d leaves any; for an imported image that
  wait counts against the 24 hours of decision 19. Beyond a cap on decisions, which an import meets only after its
  posts are published, the automated step writes `capped` and alerts `automation_capped`, as for native posts.
- **Sensitive and adult-labelled content.** The adapters leave out the images of posts their authors marked sensitive
  and every Bluesky post self-labelled `porn`, `sexual` or `nudity` (decisions 10 and 11), before any check runs.

### 8.2 What a refusal does to the import

When the feeder finds that `finalize` stored an upload refusal for one of the import's images:

1. In one transaction: the import moves to `stopped` with `stop_reason` `refused_image`; its unattached rows other than
   the refused one are deleted through `media.deleteImportLeftovers` (the refused row is held for good by 3d's
   `upload_refusals_hold` and the keep trigger leaves it); the seed is cleared.
2. After the commit: the deleted rows' files are asked for; the work folder's deletion is asked for, so the archive's
   other images are deleted without anyone opening them; nothing of the import was published, since images are
   prepared before any post (decision 18).
3. The person is told by 3d's own notice of the refused upload (3d design, 7.12, the screen
   /settings/cases/uploads/[id]), mailed as 3d mails it, and the import screen names the post the image came from,
   never the image (`import.stopped.refused_image`: its date and first words, read from the work line before the
   work folder goes and kept on the row as `refused_at_original` and `refused_words`), links to that notice, and
   offers "Import the text only" (a new upload with images left out).
4. Nothing else happens to the account: no suspension, no restriction, no strike (main design, lines 370, 371 and 401).
   The refusal holds the account's address for a report as every refusal does (3d, 3f). The person may start another
   import later, within the weekly limit; its images go through the same checks.

### 8.3 Text and reports

- Text is never removed or withheld by a program (main design, line 401). An imported post can be reported, by anyone,
  signed in or not, under a rule or the law, exactly as any post: the report form, the notice path, the case, the
  decision, the appeal and the author's case screens do not change.
- Imported posts follow the rules like any post, and a final decision that one breaks a rule counts a strike (3e) as
  for any post. The preview says so before anything is published (`import.rules`, with a link to /rules).
- **Impersonation.** An import of someone else's archive is met by the person's statement (decision 14), by reports
  under R6 ("No spam, scams, impersonation or coordinated manipulation"), and by a label that never claims who wrote
  the post. A decision under R6 may remove the imported posts it names, as any decision may, and an admin may end the
  whole import (8.7).
- Imported @mentions never notify (main design, line 335) and are never linked to a korbat account (5.3): korbat has
  no notifications yet, and when 2d brings them, an imported post's text is never read for mentions.

### 8.4 The provenance label

Every imported post carries its label wherever a card shows it (decision 6, section 10.6). The label is made from
the post's own columns and nothing else, so it can never name the other platform's account.

### 8.5 Suspensions and standing

- An import starts only for a live account that is not suspended: `POST /api/imports` inserts the row in a statement
  that locks the profile row `for key share` with 3e's predicate and ends with the closing judgment, as
  `insertProcessing` does. That statement is in apps/api/src/imports/repo.ts, so the architecture test's
  `STANDING_PREDICATE` pins gain that file for `liveNotSuspended` and `closingJudgment`, once each; no other file of the
  module names them.
- Every batch of writes, the feeder's image rows and the publisher's posts alike, is judged by 3e's predicate in the
  statement that locks the profile row, by `WRITE_CLOCK`, and ends with the closing judgment (lib/standing.ts's four
  rules). A suspension that starts mid-import stops the next batch: the import waits, its screen says
  `import.paused`, and it goes on when the suspension ends, or stops at the 72-hour bound.
- A deletion or a termination purges the import with the account (4.7).
- The undo is the author's own deletion, which a suspended author may still make, as `deletePost` allows today.
- The write routes for a suspended account, each listed in `SUSPENDED_WRITES` of
  apps/api/test/integration/standing-route-walk.test.ts, whose app is built with the imports module: `POST
  /api/imports` refused; `PUT .../archive` allowed (it only completes an upload that ends within 24 hours, and its
  scan publishes nothing); `POST .../confirm` refused (it starts writes); `.../cancel`, `.../stop`, `.../undo` and
  `PUT .../lines/:ref` (9.2) allowed (they only end, delete or choose).
- 3e's flood count, the floor under an admin's finding of a spam flood (`decision_actions_check`, last replaced in
  0032_orders_review.sql:316, and `standing.flood` in apps/api/src/moderation/standing-repo.ts:120), counts only posts
  with `import_job_id` null: an import is published at once by design and is no flood. Migration 0044 replaces the
  function with that one change.

### 8.6 Moderation states on imported posts

An imported post is a post: its `state` and `moderation_level` are the ledger's (3c), it is withheld, removed or
disabled like any post, its images can be sealed, a frozen post keeps its rows through the undo, and every reader
answers a `disabled` post as missing through `postAccess` and `isShown` (3f design, line 237). The new reader of 9.2
(the Imported tab) goes through `visibleTo` and the block rules, as `profilePosts` does, and is listed with the
readers that the 3f rule's test walks.

### 8.7 The staff console's view of imports

- The case page's target (`CaseTarget`'s post member in packages/contracts/src/moderation.ts) gains, last, `imported:
  { source, at, importId, importSize, importedAt } | null`, read from the post's own columns and its job row while they
  hold it (`importSize` is the job's `posts_published`); the console (apps/admin/src/screens/Case.tsx, words in
  apps/admin/src/words.ts) prints "Imported from X, dated 3 Mar 2019" under the post's link and "One of 1,240 posts
  imported together on 21 Oct 2026". The case's evidence copy (3c) does not change.
- **Ending a whole import.** An admin may end the import a case's post came from with a new step-up action,
  `import_ended_by_staff` (`STAFF_STEP_UP_ACTIONS` in packages/contracts/src/staff.ts: target type `import`, the job's
  id; params `{ caseId, ruleId }`), through `POST /api/staff/imports/:import/end` under the admin role. In one
  transaction it writes its audit row (apps/api/src/staff/audit.ts), sets `staff_ended_at` and `staff_rule_id`, moves an
  import in `preparing` or `publishing` to `stopped` (`by_staff`), and then, from `stopped` or `done`, to `undoing` when
  it published posts; `import-drive` removes them through `removeImportedBatch`, the person's own undo path, so freezes,
  holds and evidence stay right. The person is mailed through the auth module's `mailAccount` (template
  `import_ended_by_staff`: the rule, and the case's decision, which can be appealed as any), and the import's screen
  says `import.endedByStaff`.
- There is no console page, route or `staff.js` command that lists imports, archives or staged posts (decision 30).
  An operator reads the import service's health from `docker compose ps` and the API's log lines for `import-drive`,
  which carry counts and codes only.

## 9. The API

### 9.1 The imports module

apps/api/src/imports/ is the eighth module (`MODULES` in apps/api/test/architecture.test.ts gains `imports`): `index.ts`
(`createImports(deps)` returning `routes`, `startJobs(lock)`, `purgeOwner` and `endByStaff`), `context.ts`
(`ImportDeps`, `ImportError`), `routes.ts`, `repo.ts` (which names `import_jobs`; outside the module only the social
batch writers lock its row), `files.ts` (the two volumes, through packages/import-protocol's layout), `feeder.ts`,
`intake.ts`, `drive.ts`, and `flows/` (`create.ts`, `chunk.ts`, `picks.ts`, `confirm.ts`, `end.ts`). It reaches posts
and images only through the social and media modules' indexes (`publishImportedBatch`, `removeImportedBatch`,
`insertProcessing` with `importJobId`, `deleteImportLeftovers`, `attach`, `finalize`, the receive path) and the
moderation module's `imagesPublished`; it names neither `post_media` nor `requestDeletion`
(apps/api/test/architecture.test.ts:113 and :207). apps/api/src/app.ts mounts its routes after the session's resolution,
behind `requireSession` and the CSRF check, like the social routes; `AppDeps` gains `imports?: Imports` and `onError`
(app.ts:99 to :127) an `ImportError` branch, with `Retry-After` for `rate_limited` and the `details` member carrying
`receivedBytes` for `wrong_offset`, so no refusal of 9.4 reaches the client as 500.

### 9.2 Routes

| Method and path | Body | Answer | Notes |
|---|---|---|---|
| `POST /api/imports` | `CreateImportRequest` `{ source, bytes }` | 201 `ImportView` | 4.2 step 3's checks; `import-week`, `import-address-day` |
| `GET /api/imports` | none | `{ imports: ImportView[], sources }` | the account's imports, newest first, at most 20, and the sources `IMPORT_SOURCES` turns on |
| `GET /api/imports/:id` | none | `ImportView` | the owner's only; anyone else gets `not_found` |
| `PUT /api/imports/:id/archive` | the chunk, raw | `{ receivedBytes }` | 7.3; `import-chunk` |
| `GET /api/imports/:id/lines?page=<n>` | none | `{ lines: ImportLineView[], pages }` | `ready` only; lines 50n to 50n+49 with their marks and picks, read through `openWorkFile` from the page's offset (the intake keeps every 50th line's offset in `scan` while `ready`, at most 1,000) |
| `PUT /api/imports/:id/lines/:ref` | `ImportPickRequest` `{ leftOut, alts }` | `ImportPickView` | `ready` only; writes `import_picks`; `import-pick` |
| `GET /api/imports/:id/media/:file` | none | the image's bytes | `ready` only, images on; the owner's only; through `openWorkFile`, sniffed as JPEG, PNG or WebP (else `not_found`), with that type, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` |
| `POST /api/imports/:id/confirm` | `ConfirmImportRequest` `{ choice, statement: true }` | `ImportView` | `ready` only; `import-act` |
| `POST /api/imports/:id/cancel` | none | `ImportView` | `uploading`, `scanning` or `ready`; asks for the files' deletion |
| `POST /api/imports/:id/stop` | none | `ImportView` | `preparing` or `publishing`; `stop_reason` `by_author` |
| `POST /api/imports/:id/undo` | none | `ImportView` | `done`, or `stopped` with posts; moves to `undoing` |
| `GET /api/profiles/:handle/imported` | `Pagination` query | the timeline page of `PostView`s | the Imported tab; public, as `/posts` is |

`GET /api/imports/:id` and the list are read often by the app's progress screen; they go under the global limit and
read one row each, never the work folder, except the preview's three samples (read once per request from their byte
offsets, at most 256 KiB each, only in `ready`). The lines and media routes go under the global limit; `import-pick`
allows 3,000 picks an hour per account.

### 9.3 Contracts

In packages/contracts/src/imports.ts, exported from the package's index:

- `ImportSource`, `ImportStatus` (the twelve states), `IMPORT_ACTIVE_STATES`, `IMPORT_FAILURES` (`not_this_source`,
  `not_an_archive`, `tar_gz`, `partial_archive`, `encrypted`, `too_many_entries`, `too_large_uncompressed`,
  `bad_entry_name`, `unreadable`, `nothing_to_import`, `scan_timed_out`, `interrupted`), `IMPORT_STOP_REASONS`
  (`refused_image`, `by_author`, `by_staff`, `time_ran_out`), `IMPORT_SKIP_REASONS` (`repost`; `reply`, `too_long`,
  `warning`, `protected` and `left_out` (counted by the app from the month table and the picks when the choice leaves
  them out); `not_public`, `older_version`, `poll`, `adult_label`, `too_long_to_read`, `date_out_of_range`,
  `item_too_large`, `unreadable`, `empty`, `already_imported`, `over_post_cap`, `over_item_cap`, `new_account_cap`),
  `IMPORT_IMAGE_SKIPS` (`video`, `sensitive`, `unsupported`, `too_large`, `missing_file`, `bluesky_no_files`,
  `images_off`, `not_chosen`, `no_description`, `over_image_cap`, `failed`, `not_checked`, `flagged`).
- `ImportedPost` and `ImportedText` (5.1); `ImportSummary` (the importer's `summary.json`), `ImportScanFacts` (what the
  intake stores in `scan`: the counts, `sourceLinks`, `months: { month, groups: [marks, posts, images,
  imagesUndescribed][] }[]` where `marks` is the set of a line's marks (reply, long, warning, protected) as bits,
  `first`, `last`, `fromRef`, `samples: { ref, offset }[]`, `pages: offset[]`), `ImportChoice` (`from` and `to` as
  `YYYY-MM` or null for all, `replies`, `warnings`, `protected` and `images` booleans, `long: "leave" | "shorten"`),
  `ImportLineView` (`ref`, `at` as a day, `kind`, `marks`, `text`, `media: { file, alt }[]`, the pick's `leftOut`
  and `alts`), `ImportPickRequest` (`leftOut`, `alts`: at most four `AltText` or null), `ImportPickView` (the pick and
  the picks' counts by month and marks, so the app's totals stay exact), `CreateImportRequest` (`source`, `bytes`
  from 1 to `IMPORT_MAX_BYTES`), `ConfirmImportRequest` (`choice`, `statement: z.literal(true)`).
- `ImportView`: `id`, `source`, `status`, `createdAt`, `endedAt`, `declaredBytes`, `receivedBytes`, `chunkBytes`,
  `failure`, `stopReason`, `endedByStaff` (the rule's id, when an admin ended it), `scan` (the facts, without
  offsets) and `samples` (three texts, only in `ready`), `choice`, `picks` (their counts), `progress` (`imagesTotal`,
  `imagesSettled`, `postsTotal`, `postsPublished`, `postsRemoved`, `postsLeft`), `paused` (true while the author is
  suspended), `refusalId`, `refusedAt` and `refusedWords` (for `refused_image`), and `undoable`. No text but the
  samples and the refused post's first words, no file name, no source id.
- `IMPORT_RULES`: every number of this design (chunk bytes, the caps, the hours, the batch sizes, the zip limits),
  mirrored by the CHECK constants of 0043 and 0044 and held equal by a database test.
- `ImportErrorCode`: `imports_unavailable`, `import_active`, `rate_limited` (shared), `archive_too_large`,
  `wrong_state`, `wrong_offset`, `chunk_too_large`, `chunk_mismatch`, `not_an_archive`, `statement_required`,
  `nothing_chosen`, `import_too_soon`, `account_suspended` (shared), `not_found` (shared).
- In packages/contracts/src/social.ts: `PostView` gains, last, `imported: { source, at, shortened } | null` (`at` the
  archive's day, `YYYY-MM-DD`: readers never get the second, which with the text would fingerprint the original);
  `ProfileView` gains `hasImported` (a visible imported top-level post exists); the Explore status's reasons gain
  `imported`.
- In packages/contracts/src/staff.ts: `STAFF_STEP_UP_ACTIONS` gains `import_ended_by_staff` (8.7); in
  moderation.ts, `CaseTarget`'s post member gains `imported` (8.7).
- In packages/contracts/src/account.ts: `ExportedPost` gains, last, `imported: { source, originalCreatedAt, shortened }
  | null`, and `ExportFormat` gains a last member, `imports` (section 11.2), each "added to korbat-export-1 without a
  new format name", as earlier members were.
- packages/contracts/src/media.ts does not change: every attached imported image has a description (decision 20),
  `post_media.alt_text` keeps its rule, and every view and the export keep reading it as today.

### 9.4 Errors

| Code | Status | Sentence, or its key in 10.9 (the app's words module holds each) | When |
|---|---|---|---|
| `imports_unavailable` | 503 | `import.unavailable` | `IMPORTS=off`, the site's active cap, the importer's heartbeat, free space, the limit store |
| `import_active` | 409 | `import.active` | a second active import |
| `rate_limited` | 429 | `import.limit` (`import-week`), `import.limit.network` (`import-address-day`) | the two buckets; the shared text for the others |
| `import_too_soon` | 403 | `import.tooSoon` | an account younger than 7 days, or an email not verified |
| `archive_too_large` | 413 | `import.tooLarge` | `bytes` over the cap |
| `wrong_state` | 409 | This import has moved on. Reload to see where it is. | an action the state does not allow |
| `wrong_offset` | 409 | (not shown; the app resumes from `receivedBytes`) | a chunk at the wrong place |
| `chunk_too_large` | 413 | (not shown; the app's own error) | a chunk over 8 MiB or past the declared size |
| `chunk_mismatch` | 400 | (not shown; the app sends the chunk again, at most three times) | a short body or a hash that differs |
| `not_an_archive` | 400 | `import.notArchive` | the first bytes |
| `statement_required` | 400 | Confirm that these are your own posts. | a confirm without the statement |
| `nothing_chosen` | 400 | `import.publish.nothing` | a choice whose month table counts zero |
| `account_suspended` | 403 | the 3e sentence | 3e's predicate |
| `not_found` | 404 | the shared sentence | someone else's import, or none |

### 9.5 Limits

The rate limits are section 7.6's; the bounds of 9.2 and 9.4 hold; `confirm` refuses `from` and `to` outside the
scan's months and an empty choice; every JSON body stays under the 64 KiB limit. The cut of decision 13 runs in
`publishImportedBatch` with `PostText`'s rule.

## 10. The screens

Every screen is built from the UI sub-project's kit (apps/app/src/components/kit/), its tokens and its motion rules,
inside AppShell, with skeleton rows while loading, ErrorState on failure, one level-1 heading, a document title from
lib/page-title.tsx, and every sentence in a new words module, apps/app/src/lib/import-words.ts (keys below). The API
calls and the chunked uploader live in apps/app/src/lib/imports.ts. Nothing is kept on the device: no draft of the
choice, no file handle, no progress.

### 10.1 Where import lives

- Two routes: apps/app/src/app/settings/import/index.tsx (/settings/import: start an import, and the account's
  imports) and apps/app/src/app/settings/import/[id].tsx (/settings/import/<id>: one import, drawn by its state).
- The Settings index (apps/app/src/app/settings/index.tsx) gains a ListRow "Import posts" after Account, with the
  value "Ready to review" while an import is `ready`, and the icon `import`, a new name in the closed list of
  apps/app/src/components/icons.ts mapped to Lucide's `Import` in Icon.tsx and Icon.web.tsx; SettingsNav gains
  "Import" after Account, with `current="import"` on both screens.
- Every state's view starts with a level-2 heading. When the state changes while the screen is open, it announces one
  polite sentence (`import.now.*`) and, when the focused element no longer exists, moves focus to that heading
  (tabIndex -1), so a screen-reader user hears that the preview is ready or the scan failed (WCAG 2.2 4.1.3, 2.4.3).
- New kit parts, each with kit.test.tsx cases, 44 px targets, the focus token and a name for the a11y scan:
  kit/Checkbox.tsx (`role="checkbox"`, `aria-checked`, its label as its name; ReportForm's statement checkbox,
  apps/app/src/components/moderation/ReportForm.tsx:67, moves onto it), kit/ProgressBar.tsx (the four aria values
  and a value text, a static bar under reduced motion), and kit/MonthPicker.tsx (a Button that opens a Sheet holding a
  ListRow radio group of the scan's months; no native select, which React Native lacks on its three platforms).
- The web is the only platform in 3b: on iOS and Android the start screen says the import is on the web for now
  (`import.webOnly`); sub-project 5 brings the file picker and the uploader there.

### 10.2 Start

1. Heading "Import posts", `import.intro`, then the two sentences of decision 28, `import.found` and
   `import.unchecked`.
2. "Where from?": a radio group of ListRows, one per source the site has on (`sources` of `GET /api/imports`;
   Bluesky only when the owner turned it on, decision 16), each with a one-line description.
3. Once a source is chosen: "How to get your archive" as numbered steps for that source; "What korbat reads" and
   "What korbat never reads" as two short lists (from `import.reads.*` and `import.never.<source>`); then
   `import.transit` and `import.trim.<source>` (decision 4).
4. "Choose your archive": a Button that opens the browser's file picker (`accept` `.zip` for X and Mastodon, `.car`
   for Bluesky). The app checks the size (at most 2 GB) and the first bytes (section 4.2, step 2) and names any problem
   at once, under the button, as `role="alert"` text.
5. With a good file: the file's size and the Button "Upload and read" (primary). It creates the import and starts
   the upload; the screen moves to /settings/import/<id>.

Below, "Your imports" lists the account's imports as ListRows (source, state in words, date), each a link to its
screen; empty: no list.

### 10.3 Uploading, and reading the archive

- **Uploading.** A ProgressBar (`role="progressbar"`, `aria-valuemin` 0, `aria-valuemax` 100, `aria-valuenow`, and
  `aria-valuetext` "120 MB of 840 MB"), `import.uploading`, and a secondary Button "Cancel import" (with a Sheet
  asking once). Announced politely at each tenth.
- **Resuming.** When the screen opens on an `uploading` import with no file in hand (after a reload, on another tab),
  it says `import.resume` with the file Button; the app
  checks the chosen file's size against the declared one, then sends from `receivedBytes`.
- **Reading.** In `scanning`: an indeterminate spinner (reduced motion: a static icon), `import.reading` (up to 45
  minutes; the preview waits under Settings for 24 hours after reading), and "Cancel import". The app polls
  `GET /api/imports/:id` every 3 seconds while the page is visible.
- **Failed.** ErrorState with the failure's sentence (`import.failure.*`) and a link "Start again".

### 10.4 Preview and choose

In `ready`, one column of four Sections:

1. **What we found.** `import.found.posts`, `import.found.images` (or `import.found.imagesOff`), the three newest posts
   as PostCard previews in a static variant (no actions, no links, mentions unlinked), each with the label of 10.6, and
   the Button "See every post", which opens the list below.
2. **What will be left out.** One ListRow per non-zero reason (title the count and the reason's words, description
   one line of why), for posts and then for images; `import.cleaned` and `import.sourceLinks` when their counts are not
   zero.
3. **Choose.** A radio group "Everything" / "A range of months", the latter showing two MonthPickers, "From" and "To";
   a Switch "Include replies to other people" (off) with its description; a radio group "Posts over 1,000
   characters": "Leave them out" (default) / "Shorten them to 1,000 characters"; when the archive has them, the
   Switches `import.choose.warnings` (with `import.warnings`) and, for X, `import.choose.protected` (with its
   description), both off; while images are imported, the Switch `import.choose.images` (off) with its description
   and, when on, `import.choose.images.noAlt`. Under the choice, live, `import.choose.result`, computed from the month
   table's groups and the picks, announced politely after the person stops changing the choice for 500 ms.
4. **Confirm.** `import.rules` with the link "Read the rules"; `import.found` and `import.unchecked` again; the
   statement Checkbox (decision 14) with `import.statement.after` under it; the primary Button "Publish 1,240 posts",
   which stays focusable with `aria-disabled` until the statement is ticked and while the choice leaves nothing, its
   reason shown as text under it (ink-medium, tied by `aria-describedby`), and which then moves focus to the Checkbox
   when pressed; and the secondary "Cancel import". Above the Section, `import.keptUntil`, from the scan's time plus
   24 hours.

**The list of posts.** "See every post" shows the lines in the archive's order, 50 a page (`GET .../lines`), each a
static PostCard with a Checkbox "Leave this one out"; a post the current choice leaves out is shown dimmed with its
reason. While images are brought, each image is shown (`GET .../media/:file`) and one without its source's
description has a description Field (at most 1,000 characters): written, the image is imported; empty, it is left out
(decision 20). Each change is saved at once (`PUT .../lines/:ref`), so a reload loses nothing.

### 10.5 Progress, result and undo

- **Preparing and publishing.** A progress bar per phase ("Preparing images: 340 of 1,200", "Publishing posts: 800 of
  1,240"), `import.leave`, and a secondary danger Button "Stop import", which asks once in a Sheet
  (`import.stop.ask`, "Stop import" / "Keep going"). While the author is suspended: a Notice `import.paused` and no
  progress motion.
- **Done.** A success Notice `import.done` with the counts left out during publication (images not checked in time or
  not accepted, posts left empty by a cut), a primary link "See your Imported tab" (to `/u/<handle>?tab=imported`)
  and, below a divider, the danger secondary Button "Remove imported posts".
- **Stopped.** The reason's sentence (`import.stopped.*`); for `refused_image`, the post's date and first words, the
  link "Read the notice" to /settings/cases/uploads/<refusalId> and the link "Import the text only" (a new import of the
  same source with images left out); for `by_staff`, `import.stopped.by_staff`; the published count and, when it is not
  zero and staff did not end it, "Remove imported posts".
- **Remove.** The Sheet asks `import.remove.ask` with "Remove posts" (danger) and "Keep them"; then a ProgressBar
  "Removing posts: 400 of 1,240", and at the end `import.removed`. The haptic `warning` fires on the Sheet, `success`
  at the end.
- **Cancelled, expired, undone.** One sentence each, and the link "Start a new import". While `endedByStaff` is set,
  the undoing and undone screens say `import.endedByStaff` instead, with the link to the case's decision.
- A toast "Import started" after the confirm, with no action, since the person is already on the import's screen
  (the UI design's 5.4: toasts announce, never decide).

### 10.6 The label and the Imported tab

- **PostCard** (apps/app/src/components/social/PostCard.tsx), for a post whose `imported` is set: a line under the
  author line, in the `meta` text variant, ink-medium, with the `import` icon (aria-hidden): "Imported from X, dated 3
  Mar 2019", and ", shortened on import" appended for a shortened post. The line is a pressable (role button, 44 px)
  that opens "Who sees this" at its provenance paragraph, with the accessible name "Imported from X, dated 3 March
  2019. About imported posts". The date is the view's day, in UTC. QuoteEmbed shows the short form "Imported from X".
  The focused post of a thread shows the same line. The body is rendered with RichText's `mentions` false (5.3), and
  RichText marks every link `rel="nofollow ugc noopener"` (decision 21).
- **Who sees this** (apps/app/src/lib/reach.ts and WhoSeesThis.tsx): for an imported post, `import.reach` replaces
  the Latest-and-Following line and the Explore line, and the provenance paragraph `import.provenance` follows, its
  first sentence the fact of decision 28. reach.test.ts gains the imported branches and the check that no sentence
  names an account elsewhere.
- **The profile** (apps/app/src/app/u/[handle]/index.tsx): the Tabs gain "Imported" after Replies when
  `hasImported` is true (for every reader), reading `GET /api/profiles/:handle/imported`; its rows are PostCards in
  the order of the archive's dates, newest first; its empty state (when the last one was removed meanwhile) says "No
  imported posts." The tab's key is `imported`, and `?tab=imported` opens it.
- **Explore status.** The author's own imported post's "Who sees this" never calls `/explore` (the status is known);
  lib/explore.ts gains the reason `imported` for completeness: "Not in Explore: imported posts enter no feed on their
  own."

### 10.7 The console

apps/admin/src/screens/Case.tsx prints, under a post target's link, "Imported from X, dated 3 Mar 2019" and "One of
1,240 posts imported together on 21 Oct 2026." when the target's `imported` is set, with the words in
apps/admin/src/words.ts (`importedLine`, `importedSize`). For an admin it adds the danger Button "End this import",
which asks for the rule and the step-up of `import_ended_by_staff` (8.7) as the console's other step-up actions do,
and says what follows: "Every post of this import is removed, as if the person removed them, and the person is told."
The console's content security policy is unchanged (no new asset). apps/admin/test/cases.test.tsx gains the lines and
the action, refused for a moderator.

### 10.8 The browser check

apps/app/test/browser/app.browser.ts gains, with answers in fixture-api.ts (an import in each state, a scan with every
reason, a page of the list of posts, a profile with `hasImported`, an imported post with and without a shortened mark
and with "@ada" in its text): the start screen, a source chosen, the preview with a range chosen, a post left out in
the list and the statement ticked, the progress, the result and the Remove sheet at 360, 768 and 1280 px in Dark; the
preview, the Remove sheet and the profile's Imported tab in Light, Dim and Dark for contrast; the preview and the
Remove sheet at 320 by 640 px with the Largest text size; the reading screen under reduced motion (the static icon
drawn); keyboard only, every control in order with visible focus, the publish Button reached while `aria-disabled`;
one state change (scanning to ready) with focus on the new heading and its sentence announced; the ProgressBar's
value text; the label's press opening the sheet; no `/u/ada` link; at 360 px no horizontal scroll and no clipped
label. The upload runs against the fixture server, which takes chunks and answers offsets, with a generated file of
20 MB (three chunks), one refused chunk and a resume.

### 10.9 Words

apps/app/src/lib/import-words.ts. `{n}` and the other braces are filled by the screen; numbers go through
`Intl.NumberFormat`, months through lib/time.ts.

| Key | Sentence |
|---|---|
| import.title | Import posts |
| import.nav | Import |
| import.intro | Bring your own posts from another platform. They go on your profile's Imported tab, not into anyone's feed, and nothing is published until you confirm. People can still repost or quote them, as any post. |
| import.found | Anyone who searches the words of an imported post can find the original, and your account there. If korbat is where you stay anonymous, import only what you would post here today. |
| import.unchecked | korbat does not check who wrote an archive: import only your own. |
| import.webOnly | Importing works on korbat's website for now. |
| import.whereFrom | Where from? |
| import.source.x | X (Twitter) |
| import.source.mastodon | Mastodon |
| import.source.bluesky | Bluesky |
| import.source.x.desc | The archive from Settings, Your account, Download an archive of your data. |
| import.source.mastodon.desc | The archive from Preferences, Import and export, Request your archive. |
| import.source.bluesky.desc | The file from Settings, Account, Export my data. Text only: it holds no images. |
| import.how.title | How to get your archive |
| import.how.x | 1. On X, open Settings, Your account, Download an archive of your data. 2. Confirm your password there, on X. 3. X emails you when the archive is ready, which can take a few days. 4. Download the .zip file. |
| import.how.mastodon | 1. On your Mastodon server, open Preferences, Import and export, Data export. 2. Choose Request your archive. 3. When it is ready, download the .zip file. Servers older than version 4.2 give a .tar.gz file, which korbat cannot read. |
| import.how.bluesky | 1. In Bluesky, open Settings, Account, Export my data. 2. Choose Download profile data. 3. Keep the .car file it saves. |
| import.reads.title | What korbat reads |
| import.reads.body | Only the files that hold your posts and their images. Of those, only your own public posts: not reposts, not posts for followers only, not direct messages. |
| import.never.title | What korbat never reads |
| import.never.x | Your messages, contacts, followers, likes, login history, ad data and deleted posts. These files stay unopened. |
| import.never.mastodon | Your direct messages and posts for followers only are in the same file as your public posts. korbat skips them by who they were addressed to, and keeps and logs nothing of them. Your likes, bookmarks, followers and profile files stay unopened. |
| import.never.bluesky | Your likes, follows, lists and profile. The file holds no messages. |
| import.transit | Your whole archive passes through korbat's server and its network provider on the way in. korbat deletes it when it has been read, at the latest within 24 hours. |
| import.trim.x | Before uploading you may delete from the archive everything except, in its data folder, manifest.js, the tweets files (tweets.js, the tweets-part files or tweet.js), note-tweet.js, twitter-circle-tweet.js, protected-history.js and the tweets_media folder. korbat never reads the rest. |
| import.trim.mastodon | Before uploading you may delete from the archive everything except outbox.json, actor.json and the media_attachments folder. korbat never reads the rest. |
| import.trim.bluesky | The .car file holds only your repository; there is nothing to delete. |
| import.choose | Choose your archive |
| import.chosen | {name}, {size} |
| import.start | Upload and read |
| import.tooLarge | Archives can be at most 2 GB. |
| import.notArchive | This file is not a {source} archive. |
| import.tarGz | This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read the .zip archives of newer servers. |
| import.yours | Your imports |
| import.uploading | Keep this page open while your archive uploads. It must finish within 24 hours of starting. |
| import.uploaded | {done} of {total} |
| import.resume | Your upload stopped at {done} of {total}. Choose the same file to go on. |
| import.wrongFile | This file is not the same size as the one you started with. |
| import.reading | Reading your archive. This can take up to 45 minutes. You can leave this page: your preview waits under Settings, Import posts, for 24 hours after reading. |
| import.settings.ready | Ready to review |
| import.now.ready | Your archive was read. Choose what to publish. |
| import.now.failed | Your archive could not be read. |
| import.now.done | Your posts were published. |
| import.cancel | Cancel import |
| import.cancel.ask | Cancel this import? korbat deletes the archive and everything read from it. |
| import.cancel.keep | Keep it |
| import.found.posts | {n} posts from {first} to {last} |
| import.found.images | {n} images, {kept} of them can be imported |
| import.found.imagesOff | Images are not imported on this site yet. Your posts come without them. |
| import.samples | Your newest posts, as they will look |
| import.seeAll | See every post |
| import.list.leaveOut | Leave this one out |
| import.list.describe | Describe this image (it is left out without a description) |
| import.list.dimmed | Left out by your choice: {reason} |
| import.left.title | What will be left out |
| import.skip.repost | Reposts of other people's posts |
| import.skip.reply | Replies to other people (you can include them below) |
| import.skip.not_public | Posts that were not public |
| import.skip.older_version | Earlier versions of posts you edited |
| import.skip.poll | Polls, which korbat does not have |
| import.skip.adult_label | Posts you labelled as adult content, which korbat's rules do not allow |
| import.skip.too_long_to_read | Posts too long to read |
| import.skip.too_long | Posts over 1,000 characters (you can shorten them below) |
| import.skip.date_out_of_range | Posts with a date that cannot be right |
| import.skip.item_too_large | Entries too large to read |
| import.skip.unreadable | Entries korbat could not read |
| import.skip.empty | Posts with nothing korbat can show |
| import.skip.already_imported | Posts you already imported |
| import.skip.over_post_cap | Older posts beyond the limit of 50,000 |
| import.skip.over_item_cap | The archive was read in part: it holds more than korbat reads in one import |
| import.skip.new_account_cap | Older posts beyond 1,000, the limit until your account is 30 days old |
| import.skip.warning | Posts with a content warning (you can include them below) |
| import.skip.protected | Posts from when your account was protected (you can include them below) |
| import.skip.left_out | Posts you chose to leave out |
| import.image.video | Videos and animated images, which korbat does not have |
| import.image.sensitive | Images of posts you marked as sensitive |
| import.image.unsupported | Images in a format korbat does not take |
| import.image.too_large | Images over 20 MB |
| import.image.missing_file | Images missing from the archive |
| import.image.bluesky_no_files | Images, which Bluesky's export does not contain |
| import.image.images_off | Images, which this site does not import yet |
| import.image.over_image_cap | Images beyond the limit of 5,000 |
| import.image.failed | Images korbat could not process |
| import.image.not_checked | Images that could not be checked in time |
| import.image.not_chosen | Images, which you chose not to bring |
| import.image.no_description | Images without a description |
| import.image.flagged | Images korbat could not accept |
| import.cleaned | Characters korbat cannot show were removed from {n} posts. |
| import.sourceLinks | Links to posts and profiles on {source} were replaced by words, because they show account names there. |
| import.warnings | {n} posts have a content warning. korbat cannot hide them behind it. |
| import.choose.title | Choose |
| import.choose.all | Everything |
| import.choose.range | A range of months |
| import.choose.from | From |
| import.choose.to | To |
| import.choose.replies | Include replies to other people |
| import.choose.replies.desc | They are published as posts of their own, without what they answered. |
| import.choose.long | Posts over 1,000 characters |
| import.choose.long.leave | Leave them out |
| import.choose.long.shorten | Shorten them to 1,000 characters |
| import.choose.warnings | Include posts with a content warning |
| import.choose.protected | Include posts from when your account was protected |
| import.choose.protected.desc | If your account on X was protected, its posts were not public then. Do not import them unless you mean to make them public. |
| import.choose.images | Bring images |
| import.choose.images.desc | Photos can be found by image search and can show other people. |
| import.choose.images.noAlt | {n} images have no description. Write one for each in the list of posts, or it is left out. |
| import.choose.result | This publishes {posts} posts and {images} images to your Imported tab. |
| import.rules | Imported posts follow korbat's rules like any post. One that breaks them can be removed and count against your account. |
| import.rules.link | Read the rules |
| import.statement | These are my own posts, and they were public where I posted them. |
| import.statement.after | If they are not, korbat can remove them, and it can count against your account. |
| import.publish | Publish {n} posts |
| import.publish.needStatement | Tick the statement to go on. |
| import.publish.nothing | Your choice leaves no posts to publish. |
| import.keptUntil | This preview is kept until {time}. Then the import is cancelled. |
| import.started | Import started |
| import.preparing | Preparing images: {done} of {total} |
| import.publishing | Publishing posts: {done} of {total} |
| import.leave | You can leave this page. The import goes on, and your posts appear on your Imported tab when they are ready. |
| import.paused | Your import is paused while your account is suspended. |
| import.stop | Stop import |
| import.stop.ask | Stop this import? Posts already published stay; you can remove them afterwards. |
| import.stop.keep | Keep going |
| import.done | {n} posts were published on your Imported tab. |
| import.done.view | See your Imported tab |
| import.stopped.refused_image | This import stopped because korbat refused one image, in your post dated {date} that begins "{words}". Nothing from it was published. |
| import.stopped.notice | Read the notice |
| import.stopped.textOnly | Import the text only |
| import.stopped.by_staff | korbat's staff ended this import under {rule}. {n} posts were published before it stopped and are being removed. |
| import.endedByStaff | korbat's staff removed the posts of this import under {rule}. You can appeal the decision on its case. |
| import.stopped.by_author | You stopped this import. {n} posts were published before it stopped. |
| import.stopped.time_ran_out | This import ran out of time. {n} posts were published before it stopped. |
| import.remove | Remove imported posts |
| import.remove.ask | Remove all {n} posts from this import? This deletes them for everyone. It cannot be undone. |
| import.remove.confirm | Remove posts |
| import.remove.keep | Keep them |
| import.removing | Removing posts: {done} of {total} |
| import.removed | The posts from this import were removed. |
| import.cancelled | You cancelled this import. Its archive was deleted. |
| import.expired | This import was not finished within 24 hours, so korbat deleted it. |
| import.again | Start a new import |
| import.failure.not_this_source | This file is not a {source} archive. |
| import.failure.not_an_archive | This file is not an archive korbat can read. |
| import.failure.tar_gz | This is a .tar.gz archive from a Mastodon server older than version 4.2. korbat can only read .zip archives. |
| import.failure.partial_archive | This is one part of an X archive split into several, which korbat cannot read yet. Your posts are safe in your archive; try again after korbat's next update. |
| import.failure.encrypted | This archive is protected by a password, which korbat cannot read. |
| import.failure.too_many_entries | This archive holds more files than korbat reads. |
| import.failure.too_large_uncompressed | This archive unpacks to more than korbat reads. |
| import.failure.bad_entry_name | This archive has file names korbat does not accept. |
| import.failure.unreadable | Part of this archive could not be read. It may be damaged; download it again. |
| import.failure.nothing_to_import | korbat found no public posts of your own in this archive. |
| import.failure.scan_timed_out | Reading this archive took too long. |
| import.failure.interrupted | Reading this archive failed twice. |
| import.active | You already have an import in progress. |
| import.unavailable | Imports are paused for now. Try again later. |
| import.limit | You have published three imports this week. Try again later. |
| import.limit.network | Many imports were started from your network today. Try again tomorrow. |
| import.tooSoon | You can import posts once your account is 7 days old. |
| import.label | Imported from {source}, dated {date} |
| import.label.shortened | , shortened on import |
| import.label.short | Imported from {source} |
| import.label.a11y | Imported from {source}, dated {date}. About imported posts |
| import.reach | Imported posts are not in Latest, Following or Explore. They show on their author's profile, under Imported, and wherever someone reposts or quotes them. |
| import.provenance | Anyone who searches the words of an imported post may find the original and the account that wrote it. This account imported it from {source} on {imported}. The archive dates it {date} (UTC). korbat did not check who wrote it or when. |
| import.tab | Imported |
| import.tab.empty | No imported posts. |
| import.explore | Not in Explore: imported posts enter no feed on their own. |
| title.import | Import - Settings - korbat |

## 11. Privacy and transparency

### 11.1 What is stored, and for how long

| Data | Where | How long |
|---|---|---|
| The archive, unopened beyond its allowlisted files | `import-archives`, in no backup | until its scan ends; never beyond 24 hours after the import was created |
| The person's own public posts, converted, and their images | `import-work`, in no backup | until the import ends; never beyond 72 hours after the scan |
| The import's record: source, state, times, choice, statement time, counts | `import_jobs` | while any post of it exists, and at least 30 days after its end; deleted with the account |
| On each imported post: source, the archive's date, shortened or not, the key | `posts` | while the post exists; cleared when it is deleted |
| The account's random import key | `import_keys` | until the account is purged |
| The person's picks: posts left out, descriptions written | `import_picks` | until the import ends |
| Imported images | `media-store`, as any image, in the backup | while their post exists |

Never stored, logged or shown: the other platform's handle, display name, account id, instance, DID, post ids, links to
the originals, the archive's file name, any file outside the allowlist, any post that is not the person's own and
public. The importer's and the API's logs carry ids, codes, counts and timings only (7.1).

The key on each post is not nothing: source post ids of public accounts are public, so whoever holds the database
or a backup of it, with the account's key beside it, can test whether this korbat account imported a named account's
public posts. No key of the server's alone does this (the keys are per account, 5.4), and the purge erases the key
with the account; the README says so.

### 11.2 The data export

apps/api/src/account/flows/export.ts: each post of the `posts` member gains, last, `imported: { source,
originalCreatedAt, shortened }` or null; the document gains a last member, `imports`, the account's imports newest
first, each `{ id, source, status, createdAt, endedAt, statedAt, choice, counts: { postsPublished, postsRemoved,
imagesKept, imagesLeftOut } }`. Both are "added to korbat-export-1 without a new format name". The archive itself and
the work folder are never exported: they are deleted long before an export could be asked for, and they hold the
other platform's data, not korbat's.

### 11.3 The terms and the privacy text

apps/app/src/lib/terms.ts gains a section "Importing posts", joining the draft without a new `TERMS_VERSION`, as
earlier sub-projects' sentences joined it: what an import reads and never reads; that the whole archive passes
through korbat's server and its network provider, and korbat deletes it within 24 hours of the start and its other
files within three days; that imported posts are korbat posts, under the rules, on the profile's Imported tab and in
no feed on their own; that anyone who searches their words may find the originals; that korbat keeps on each post
only the source, the day the archive gives and a keyed hash, never the other account; that the person states the
posts are their own and were public; that the person grants korbat for imported posts and images the same licence
as for native ones, and must be able to grant it (old posts often hold other people's photos and screenshots); that
a false statement can lead to removal under R6 and count against the account; that other people named or pictured
in imported posts can ask for removal like anyone named in a post; that images go through the same checks as
uploads; and that one action removes them. The terms hold no licence sentence for native posts at 6babae1, so "What
you can post" gains one for every post and image, native or imported (korbat may store, show and send what you post
as the service needs, until you delete it, except what the rules' records keep), and "Importing posts" points to it.
"Your data" gains the import's record and its retention. terms.test.tsx holds these sentences to the numbers in
`IMPORT_RULES`, and holds that both sections name that one licence. The privacy policy and the impact assessment are
sub-project 4's, with the counsel list of decision 28 there.

### 11.4 Transparency

`/transparency` gains no figure (decision 29). A refused imported upload is one more refused upload in 3d's table of
uploads refused; a decision about an imported post is one more decision by ground and kind of measure; an R1
finding on an imported image is counted where 3d counts findings (an imported image with an R2 match is never
published, 8.1). The rules page's section "Automation" gains one
sentence: "Imported images pass the same checks as uploaded ones, and korbat imports images only while it can check
them."

## 12. Testing

No test opens a real archive. Every archive is built by code from fixtures that name no real person, and every
fixture plants canary strings (`CANARY-DM`, `CANARY-IP`, `CANARY-LIKE`, `CANARY-PRIVATE`, `CANARY-DELETED`) in the
places korbat must never read, and the person's own names elsewhere (`CANARY-HANDLE` as X's `userName`, the Mastodon
actor's path and a Bluesky handle; `CANARY-NAME` as `displayName`; a fixture DID) in the manifest, `attributedTo`,
the commit and self-quote and self-link URLs inside post texts, so a test can prove none reached an output, a row or
a log line (after 5.3 step 3b's replacement).

### 12.1 Fixtures built by code

- apps/importer/test/fixtures/zip.ts: a small zip writer for tests (stored and deflate through `node:zlib`, ZIP64 on
  demand) with switches for every crafted case: overlapping data ranges, a ratio over 100, a size that lies, a bad
  CRC, the encryption bit, method 12, a symlink entry, names with `..`, a leading slash, a drive letter, a backslash, a
  NUL, 513 bytes, and two central entries with one name; and `dataDescriptor` (flag bit 3, zero local sizes, the
  descriptor after the data) and `zip64Local` (0xFFFFFFFF local sizes with a ZIP64 extra) for good archives.
- x.ts: `manifest.js`, `tweets.js` in the current and the 2019 element shape, `tweet.js` (2018), `tweets-part1.js`,
  `note-tweet.js`, `twitter-circle-tweet.js`, `protected-history.js` with one protected period, media files, and the
  canaries in `direct-messages.js`, `ip-audit.js`, `like.js` and `deleted-tweets.js`; posts covering every row of
  5.5's table, a self-quote, a link to the person's own profile and a tweet inside the protected period.
- mastodon.ts: `outbox.json` with public, unlisted, private, direct and limited Notes, an Announce embedding a Note, a
  Question, a quote with its `quote-inline` paragraph, a content warning, `sensitive` media, a thread, a reply to
  another server beginning with two mention links, a link to one of the person's own statuses, and media paths with
  and without a leading slash; the canaries in the private and direct Notes, in `likes.json` and in `actor.json`.
- bluesky.ts: a CAR written with `@ipld/car`'s writer and `@ipld/dag-cbor`, a commit, a two-level MST, posts covering
  5.7's table and a post linking `bsky.app/profile/<the fixture's handle>`, `app.bsky.feed.like` and
  `app.bsky.graph.follow` records holding canaries, blocks in a shuffled order, an extra block outside the tree, and
  switches for a block whose bytes do not match its CID and for 1,000,001-byte blocks.
- packages/import-protocol/src/fixtures.ts: `writeScanOutput(dir, posts, summary, images)`, which the API's tests
  use to stand in for the importer, as packages/media-protocol/src/fixtures.ts stands in for the worker.

### 12.2 Unit tests

- packages/contracts/test/imports.test.ts: `ImportedPost` (refs, kinds and parents, text limits, media names),
  `ImportChoice`, `IMPORT_RULES` against the values this design states.
- packages/import-protocol/test/: layout ids refuse anything but a lowercase UUID; the summary and line readers' caps;
  `openWorkFile` refuses a symlink, a symlinked folder, a file on another device and anything but a regular file.
- apps/importer/test/: `zip.test.ts` (every limit of 7.2 refuses with its code; a good ZIP64 archive, a good archive
  with data descriptors and one with ZIP64 local sizes read);
  `text.test.ts` (5.3, each step, with right-to-left text and direction marks, step 3b's fixed words for each source,
  a Mastodon reply's leading mentions removed, a description over 1,000 characters becoming null); `x.test.ts`,
  `mastodon.test.ts`, `bluesky.test.ts` (every row of 5.5 to 5.7, detect for each failure, a tweet inside a protected
  period marked `protected`, a content warning marked `warning`, the media patterns refusing deeper and `..` paths);
  `json.test.ts` (the assembler's 1 MiB and depth caps); `core.test.ts` (keys stable per account and
  different between accounts, refs in date order, a thread whose parent is left out or later becomes a post, the
  newest 50,000 kept, dates out of range); `loop.test.ts` (attempts, the third start fails `interrupted`, a deletion
  request aborts a scan, the summary written last); `log.test.ts` (the source scan of 7.1; no log line per skipped
  item); `minimisation.test.ts` (no canary, handle, name or DID in `posts.jsonl`, `summary.json`, the media folder,
  the scratch file or the captured log, for each source).
- apps/api/test/: `imports-chunk.test.ts` (offsets, lengths, the hash, truncation back to whole chunks, the first-bytes
  check, a row behind its file), `imports-intake.test.ts` (line caps, a 75 KB CJK note kept, refs in order, unreadable
  lines, the month table, samples, a symlinked `posts.jsonl` refused), `config.test.ts` (`IMPORT_IMAGES=on` with
  `MEDIA_MATCH=off` refuses to start; `IMPORT_SOURCES` defaults to `x,mastodon` and refuses an unknown source),
  `architecture.test.ts`, re-pinned in two tasks: Task 4 (`imports` among `MODULES`; the standing pins gain
  imports/repo.ts, 8.5) and Task 5 (the `REQUEST_DELETION` counts of the media files that ask for imported images'
  files, 6.5), tiers.

### 12.3 Integration tests (apps/api/test/integration/)

- `import-schema.test.ts`: every trigger of 6.1 to 6.3 for the API role (forced columns, each allowed and refused
  move of 4.1, one active import, deletes, the five post columns set only at insert by a publishing job of the author
  and cleared only by a tombstone, a reply only within the job, no quote, an imported image only on its import's post
  and never without a description, picks written only while `ready`, an import key deleted only with its profile);
  the grants; RLS on; each CHECK's literal equal to `IMPORT_RULES`; 0044's `decision_actions_check` passes over
  imported posts in its flood count and is otherwise 0032's.
- `http-imports.test.ts`: create (each refusal of 4.2 step 3, in order: a source switched off, an account 6 days old
  `import_too_soon`, three published imports in 7 days while failed and cancelled ones cost nothing; two concurrent
  creates by two accounts against `IMPORT_MAX_ACTIVE` 1, one refused), chunks over HTTP through the app (sizes, a
  resume after a refused chunk, the 64 KiB limit untouched elsewhere), cancel, the list, someone else's import, each
  `ImportError` answered with its status (never 500).
- `imports-scan.test.ts`: `import-drive` with `writeScanOutput` standing in for the importer: archive deleted on the
  summary, intake, `ready`, `failed`, the 45-minute and 24-hour bounds, expiry of a preview, orphans.
- `imports-publish.test.ts`: confirm; batches of 200 with derived ids; a repeated round writes nothing twice; thread
  order in `replies`; counters; a batch beside a report holding one of its parents ends without a deadlock; a choice's
  range, replies, long posts (the cut at a space, the mark), warnings and protected posts; left-out picks skipped; an
  account younger than 30 days publishing at most 1,000; keys already imported skipped; a suspension mid-import makes
  the batch wait and the import go on after it; the 72-hour stop; imported posts absent from Following, Latest,
  Explore's candidates, the Posts tab and the Replies tab, present in the Imported tab in the archive's date order with
  `imported.at` a day, and answered as missing when disabled; an import of 1,000 posts leaves 3e's `atOnce.flood`
  false.
- `imports-picks.test.ts`: the lines' pages and their offsets, a pick saved and read back, `alts` checked as
  `AltText`, the media route only for the owner, only in `ready`, only a sniffed image, through `openWorkFile`.
- `staff-import-end.test.ts`: `import_ended_by_staff` by an admin with step-up (a moderator refused), its audit row,
  the move to `undoing` from `publishing` and from `done`, the posts removed through the undo path, the person's mail,
  and `CaseTarget.imported` with the import's size.
- `imports-media.test.ts`: the feeder feeds only while no other upload waits, at most two in flight, at the site's
  pace; the sweeper and `pendingCount` leave imported rows alone; with the `test` matcher a clear image is attached,
  an unchecked one is left out after 24 hours, a non-acting match is left out (`flagged`), never attached, and an
  admin alerted, and an acting match stops the import before any post with 3d's notice and hold, the row's date and
  first words of its post, the other rows and the work folder deleted; a symlinked image file and a symlinked
  `media/` folder, each pointing at a file of the store, are refused (`missing_file`) and nothing of the store is
  copied.
- `imports-undo.test.ts`: the undo tombstones every post in batches, clears the columns, fixes every counter, keeps
  the images of a frozen post and of a case, leaves a disabled post as it is with its columns and still ends `undone`
  (also with 200 or more disabled posts in one import); a single imported post deleted from its menu clears its
  columns.
- `account-deletion.test.ts` and `account-export.test.ts` gain the purge's import steps (rows and the import key
  gone, columns cleared, a disabled post's too, files asked for, a waiting batch writing nothing) and the export's two
  additions.

### 12.4 The browser check

Section 10.8's steps in apps/app/test/browser/app.browser.ts; the console's case lines and action in its unit test.

### 12.5 Labs

apps/importer/test/lab/, run in the importer Dockerfile's build stage (the runtime stage holds only `dist/`):
`docker build --target build`, then
`docker run --network none --memory 512m --memory-swap 512m --cpus 0.5 --read-only --tmpfs /tmp:size=16m` with
`pnpm --filter @korbat/importer test:lab`; not in every gate. apps/importer/test/lab/README.md (as
apps/api/test/lab/README.md) gives the command and where each lab writes its measurements:

- `zip-bomb.lab.ts`: the overlapping-files bomb (a 10 MB file declaring terabytes), a ratio bomb within one entry, a
  central directory of 1,000,000 entries, ZIP64 records that lie about sizes and offsets; each is refused within 5
  seconds and under 64 MB of memory.
- `json-bomb.lab.ts`: one 900 MB string, a depth of 1,000,000 brackets and a key of 500 MB in a data file; each is
  refused `item_too_large` within 5 seconds and under 64 MB of memory.
- `traversal.lab.ts`: every crafted name of 12.1 and a symlink to `/etc/passwd`; each is refused or ignored, and
  nothing is written outside `jobs/<id>/`.
- `large-archive.lab.ts`: a generated X archive of 1.9 GiB (60,000 tweets, a `tweets.js` of 400 MB, 5,000 images), a
  Mastodon outbox of 50,000 Notes and a CAR of 2,000,000 blocks: each scans within the 30-minute watchdog, the peak
  memory stays under 400 MB, and the API's intake of 50,000 lines runs within its 512m.

### 12.6 Gates

- Every task: typecheck and unit tests of each package it changes (`pnpm --filter <package> typecheck` and `test`).
- Batch ends: the runner's whole integration suite, as every sub-project's batches; from Task 7 on, also
  `pnpm --filter @korbat/app test:browser`.
- Stack tasks: the stack rebuilt and scripts/smoke-auth-stack.mjs run, which gains an import of a generated Mastodon
  archive through the real importer (Task 4: to `ready`; Task 8: confirmed, read on the Imported tab, removed).

## 13. Tasks

Eight tasks in build order, in five batches: Tasks 1 and 2, 3 and 4, 5 and 6, Task 7 alone (with the app's browser
check), and Task 8 alone. Each runs the gates of 12.6.

**Task 1. Contracts and the file protocol.** Goal: the shapes every later task builds on. Creates
packages/contracts/src/imports.ts (5.1, 9.3, `IMPORT_RULES`), packages/import-protocol/ (package.json,
tsconfig.json, src/index.ts, layout.ts, limits.ts, summary.ts, lines.ts, open.ts, fixtures.ts). Changes
packages/contracts/src/index.ts, pnpm-lock.yaml. Tests: packages/contracts/test/imports.test.ts,
packages/import-protocol/test/layout.test.ts, readers.test.ts and open.test.ts (`openWorkFile` against a planted
symlink, a symlinked folder and a file on another device). Not a batch end; no stack rebuild.

**Task 2. The database.** Goal: section 6. Creates packages/db/migrations/0043_imports.sql,
0044_imported_posts.sql, 0045_import_readers.sql with their meta snapshots, packages/db/src/schema/imports.ts
(`import_jobs`, `import_picks`, `import_keys`). Changes packages/db/src/schema/content.ts (the seven columns, the
CHECKs, the indexes) and schema/index.ts. Tests: packages/db/test/schema.test.ts (its table count, 69 at 6babae1,
becomes 72; `post_media_import_link` joins post_media's checks; posts' new check and indexes),
enum-literals.test.ts (one case: 0043 to 0045 add no value to an existing enum; their two enums are created whole),
apps/api/test/integration/import-schema.test.ts (with 0044's `decision_actions_check`). Batch end (Tasks 1 and 2); no
stack rebuild.

**Task 3. The importer.** Goal: sections 5, 7.1 and 7.2. Creates apps/importer/ (package.json with the exact pins of
7.1 as resolved on the day, tsconfig.json, build.mjs, vitest.config.ts, Dockerfile, src/index.ts, config.ts, loop.ts,
scan.ts, core.ts, text.ts, html.ts, json.ts, zip/central.ts, zip/entry.ts, zip/limits.ts, car/reader.ts, car/mst.ts,
adapters/types.ts, adapters/x/index.ts, adapters/mastodon/index.ts, adapters/bluesky/index.ts), its fixtures and unit
tests (12.1, 12.2), its labs and test/lab/README.md (12.5). Changes pnpm-lock.yaml. Checks:
scripts/check-lockfile-age.mjs; the labs run once in the build stage and their measurements are recorded. Not a
batch end; no stack rebuild.

**Task 4. Upload, scan, the preview and the service.** Goal: 4.2, 4.3, 4.4's routes, 7.3, 7.5 steps 1 to 3, 7 and 8,
7.6, 7.7, 8.5's create. Creates apps/api/src/imports/ (index.ts, context.ts, routes.ts, repo.ts, files.ts,
intake.ts, drive.ts, flows/create.ts, flows/chunk.ts, flows/picks.ts, flows/end.ts with the cancel). Changes
apps/api/src/app.ts (the routes, the body limit's exemption, `AppDeps.imports`, the `ImportError` branch of
`onError`), apps/api/src/config.ts, apps/api/src/index.ts (the module and its job), apps/api/src/social/tiers.ts
(the import buckets), apps/api/Dockerfile (the two mount points owned by `node`), apps/api/test/architecture.test.ts
(`MODULES` and the standing pins), apps/api/test/integration/standing-route-walk.test.ts (the imports module in the
walk's app: create refused; chunk, picks and cancel allowed), infra/compose.yml (`importer`, the two volumes, the
API's mounts and settings), infra/caddy/Caddyfile (`@import_chunk`), infra/.env.example,
scripts/smoke-auth-stack.mjs (an import to `ready`). Tests: imports-chunk.test.ts, imports-intake.test.ts,
config.test.ts, http-imports.test.ts, imports-scan.test.ts, imports-picks.test.ts. Batch end (Tasks 3 and 4); stack
task: the stack rebuilt with the importer, `docker compose ps` shows it healthy with no network, and the smoke test
runs.

**Task 5. Imported images.** Goal: 4.5 steps 1 and 2, 6.5's media writers, 7.4, 7.5 step 4, 8.1 and 8.2. Creates
apps/api/src/imports/feeder.ts, flows/confirm.ts. Changes apps/api/src/imports/drive.ts (feeding; the leftovers each
round), routes.ts and flows/end.ts (the stop); apps/api/src/media/repo.ts (`insertProcessing` with `importJobId`,
`deleteImportLeftovers`, `pendingCount`, `failStale`, `deleteUnattachedBefore`), media/files.ts (receiving from a
work file through `openWorkFile`), media/index.ts, media/sweeper.ts; apps/api/test/architecture.test.ts (the
`REQUEST_DELETION` counts); standing-route-walk.test.ts (confirm refused, stop allowed). Tests:
imports-media.test.ts. Not a batch end; no stack rebuild.

**Task 6. Publishing, readers, undo and the account.** Goal: 4.5 steps 3 and 4, 4.6, 4.7, 6.5's social writers, 7.5
steps 5 and 6, 8.3 to 8.7 and the API half of 9.3. Changes apps/api/src/imports/drive.ts, routes.ts, index.ts
(`purgeOwner`, `endByStaff`) and flows/end.ts (the undo); apps/api/src/social/repo.ts (`publishImportedBatch`,
`removeImportedBatch`, the readers' filters, `profileImported`, `exploreRules`' marker, `deletePost` and
`purgeProfile` clearing the columns), social/routes.ts (`/profiles/:handle/imported`), social/views.ts (the day),
social/index.ts; apps/api/src/moderation/standing-repo.ts (the flood count); apps/api/src/account/flows/deletion.ts
and export.ts; apps/api/src/staff/routes.ts and the case view's target (`import_ended_by_staff`,
`CaseTarget.imported`), the auth module's mail template `import_ended_by_staff`; packages/contracts/src/social.ts,
account.ts, moderation.ts and staff.ts (9.3), with the app's and the console's test fixtures that build a `PostView`
or a `CaseTarget`; standing-route-walk.test.ts (undo allowed). Tests: imports-publish.test.ts, imports-undo.test.ts,
staff-import-end.test.ts, the account tests' additions, http-social's Imported tab and the 3f readers' walk,
explore's candidates. Batch end (Tasks 5 and 6); no stack rebuild.

**Task 7. The screens and the console.** Goal: section 10 and 11.3. Creates apps/app/src/app/settings/import/
index.tsx and [id].tsx, apps/app/src/lib/imports.ts (the API and the chunked uploader with `crypto.subtle.digest`),
apps/app/src/lib/import-words.ts (every key of 10.9), apps/app/src/components/import/ (SourcePicker.tsx,
UploadProgress.tsx, Preview.tsx, PostList.tsx, ImportProgress.tsx, ImportResult.tsx), and kit/Checkbox.tsx,
kit/ProgressBar.tsx, kit/MonthPicker.tsx. Changes components/icons.ts, Icon.tsx and Icon.web.tsx (`import`),
components/moderation/ReportForm.tsx (onto Checkbox), components/social/RichText.tsx (`mentions`, `rel`),
components/social/PostCard.tsx (the pressable label, `mentions`), app/post/[id].tsx, lib/reach.ts and
components/social/WhoSeesThis.tsx, app/u/[handle]/index.tsx (the tab), lib/social.ts, lib/explore.ts,
app/settings/index.tsx, components/SettingsNav.tsx, lib/terms.ts (the section and the licence), the words of /rules'
"Automation" section, apps/admin/src/screens/Case.tsx and src/words.ts (the two lines and "End this import"),
test/browser/app.browser.ts and fixture-api.ts. Tests: import-screens.test.tsx (each state's screen, its words, its
controls' names, the heading and the announcement on a change), imports-uploader.test.ts (chunks, hashes, resume,
retries with a fake fetch), kit.test.tsx (Checkbox, ProgressBar, MonthPicker), rich-text.test.tsx ("@ada" in an
imported post is no link while an account @ada exists; every link's `rel`), reach.test.ts's imported branches,
post-card.test.tsx's label, terms.test.tsx, lifecycle.test.tsx (SettingsNav's pages gain `import`),
apps/admin/test/cases.test.tsx. Batch end (Task 7 alone), with the app's browser check; no stack rebuild.

**Task 8. Documentation and the stack.** Goal: the record. The design (parts 1 to 5 joined as
docs/superpowers/specs/2026-10-21-import-3b-design.md) is committed before Task 1, as every sub-project's is; this task
fills its section 15 from the dry run. README.md gains "Importing posts" (what it reads and never reads, the two
volumes and why they are in no backup, the settings of 7.7, `IMPORT_IMAGES`' precondition, `IMPORT_SOURCES` and what
turning Bluesky on accepts, what the per-account import key still lets whoever holds the database do (11.1), the labs
and how to run them, migration 0045 as the slow one in Upgrading), the Backups section names `import-archives` and
`import-work` as excluded, and Before going public names every point of section 2 for counsel (decision 28's list:
decisions 4, 14, 15, 16, 18, 25 and 28 and the licence of 11.3); the main design's section 6a is marked delivered and
section 9 gains the dated amendment "sub-project 3b" (delivered; line 246's mark not built; line 255's `original_url`
not stored; line 237's parse in a service of its own; line 244 as 3d amended it, with the stop of decision 18; line 249
as a profile tab; the decisions of section 2; status and order: next 2d engagement, 4 hardening, 5 native builds).
scripts/smoke-auth-stack.mjs runs the whole import: confirm, the post on the Imported tab, undo. Batch end (the whole
integration suite); stack task: the stack rebuilt from clean and the smoke test run.

## 14. What is left for later

- **More sources.** Threads, Instagram, Facebook and Reddit as adapters: a folder, an enum value (a migration adding
  the value to `import_source`), fixtures and words; nothing else changes.
- **Bluesky images.** An optional second archive of blobs (`goat blob export`, zipped), each file accepted only when
  its SHA-256 equals the digest of a CID a kept post names (decision 16).
- **Archives refused today.** Mastodon `.tar.gz` (`tar-stream` 3.2.2 or a later version past the floor) and X archives
  in parts: first, from the open-source parsers inputs 3.1 cites, which part holds `data/manifest.js` and the tweets;
  if one part does, accept that part text only, counting the other parts' images `missing_file` (decision 26).
- **The archive in the browser.** When the web bundle has room: build, in the browser, a zip of the allowlisted
  entries only (copying local headers and compressed bytes, no inflating) and upload that, so X's messages, contacts
  and IP logs never leave the device (decision 4); and read the zip's central directory there to tell an X archive
  from a Mastodon one before uploading. The server keeps every check of 7.2.
- **Editing descriptions.** An "Add a description" for any image after posting, native or imported, which needs a
  route, a column grant and a guard (decision 20).
- **Self-quotes.** A quote of the person's own imported post as a korbat quote.
- **Native apps.** The file picker and a background upload of the same protocol in sub-project 5.
- **Capacity.** A second worker for imported images, or the worker's own import lane, if the host's measurements ask
  for it (decision 17).
- **2d.** Imported posts' @mentions never notify and are never stored as mentions; 2d's mention parser skips posts
  whose `import_job_id` is set, and its share cards show the provenance label.
- **Sub-project 4.** The privacy policy's section on imports and the impact assessment (decision 28); per-address
  limits tuned with Cloudflare's rules; the restore drill confirming that the two import volumes are absent from
  backups by design.

## 15. Amendments from the dry run

The dry run of 2026-10-22 to 2026-10-27 built the eight tasks in a scratch clone, one commit each, through the gated runner. Where the code differs from the text above, the code is right and the point is recorded here, in the order of the tasks that settled it (Tasks 1 to 8).

- **The body rules live in text.ts (3.2, 5.1).** postLength, normalizePostBody and the control pattern (now exported as FORBIDDEN_CONTROL) move byte for byte from packages/contracts/src/social.ts to text.ts; social.ts imports them back and the index still exports them, so every caller is unchanged. imports.ts imports only zod, ./media and ./text: social.ts reads moderation.ts's RULE_IDS at load, so an imports.ts that imported social.ts would throw at load once Task 6 makes moderation.ts, staff.ts and account.ts read ImportSource.
- **import_picks.alts holds up to 16,384 bytes, not 8,192 (6.1).** Four AltText descriptions of 1,000 code points (decision 20) take up to 16,016 bytes as JSON text (four bytes a code point outside the basic plane; four descriptions of 1,000 Chinese characters are already 12,000 bytes), so a CHECK of 8,192 would refuse a pick ImportPickRequest accepts, as an error no schema foresees. IMPORT_RULES.altsMaxBytes is 16,384, which every valid pick fits (a unit test holds the arithmetic); Task 2's CHECK mirrors it.
- **The design's constants are members of IMPORT_RULES (5.1, 5.4, 7.1 to 7.4, 9.3).** IMPORT_CHUNK_BYTES, IMPORT_MAX_BYTES, IMPORT_TEXT_MAX, IMPORT_MAX_POSTS, IMPORT_MAX_ITEMS, IMPORT_MAX_IMAGES, IMPORT_MAX_POSTS_NEW, IMPORT_MIN_ACCOUNT_AGE_DAYS, IMPORT_IMAGES_IN_FLIGHT, ZIP_MAX_ENTRIES and IMPORTER_WATCHDOG_MS are IMPORT_RULES.chunkBytes, maxBytes, textMax, maxPosts, maxItems, maxImages, newAccountMaxPosts, minAccountAgeDays, imagesInFlight, zipMaxEntries and watchdogMs (5.1's `IMPORT_MAX_POSTS - 1` reads `IMPORT_RULES.maxPosts - 1`), so each number has one name in one place. The owner's settings keep their names for Task 4 (IMPORT_MAX_ACTIVE, IMPORT_IMAGES_PER_HOUR, IMPORT_MIN_FREE_BYTES); their defaults are maxActiveDefault, imagesPerHourDefault (with imagesPerHourMax, the 600 it may not exceed) and minFreeBytesDefault.
- **openWorkFile walks every component (7.1).** The design lstats the path and relies on the device to catch a symlinked folder; one that stays on the volume would pass that check. The code lstats every component from the mount root down and refuses a symbolic link (a junction on Windows reports as one) anywhere on the path, a folder that is not a folder, and any component on another device, then opens the walked, normalised path with O_RDONLY, O_NOFOLLOW and O_NONBLOCK where the platform has them, and requires the descriptor to be a regular file with the device and inode the lstat saw (compared as bigints, as Windows' 64-bit file ids need) and within the cap. A refusal is a code (outside, missing, symlink, not_a_file, other_device, too_large, changed, error), never a throw.
- **An image's position counts from 0 (5.1).** ImportMediaFile is `<ref>-<position>.<jpg|png|webp>` with the ref written without leading zeros and below maxPosts, and the position from 0, as refs count, so a line's images are `<ref>-0` to `<ref>-3`; a line's positions are distinct but need not be consecutive.
- **ImportChoice's months may each be open (9.3).** `from` and `to` are each a YYYY-MM or null: both null is everything, and one null leaves that end open (from the first month, or to the last); never `from` after `to`.
- **The view's samples carry their day (9.3).** ImportView.samples are `{ at, text }` (at most three, only in ready), not bare texts: the preview shows each sample with the label of 10.6, which names the archive's day.
- **IMPORT_MARKS (9.3).** The order of a line's marks is exported as IMPORT_MARKS = [reply, long, warning, protected], the bit 1 << i standing for IMPORT_MARKS[i], so the intake, the publisher and the app read one order; long means a text over IMPORT_RULES.shortenTo (1,000) code points.
- **The heartbeat's schema and reader (7.1).** packages/import-protocol/src/summary.ts also holds ImporterHeartbeat (`{ v: 1, at }`, the shape the Compose healthcheck reads) and readHeartbeat, under the job file's 4 KiB cap, for 4.2 step 3's check that the importer's heartbeat is younger than 60 seconds.
- **The importer's stand-in (12.1).** writeScanOutput is in packages/import-protocol/src/fixtures.ts as 12.1 says; the API's stand-in for the worker it is modelled on is fakeWorker in apps/api/test/integration/media-harness.ts, not packages/media-protocol/src/fixtures.ts, which holds R1_MARKER and MATCH_FIXTURES.
- **An index on post_media.import_job_id (6.3).** 0044_imported_posts creates post_media_import_job_idx on (import_job_id, id) where import_job_id is not null, which 6.3 does not name (the orchestrator's ruling): deleting an import's job row sets that column null through its foreign key, and Task 5's media.deleteImportLeftovers reads and deletes an import's unattached rows by it in id order, so without the index both would scan post_media. packages/db/test/schema.test.ts's pin of post_media's indexes gains it.
- **posts_import_guard fires on an insert, or on an update of the five columns (6.2).** 6.2 says before insert or update; the trigger is BEFORE INSERT OR UPDATE OF import_job_id, import_source, original_created_at, import_shortened, import_key, so a counter's update (every like, repost and reply on any post) never runs it. An update that names none of the five cannot change them, so nothing the guard decides is lost.
- **The delete rules skip the migrator too (6.1).** 6.1 says the two guards are skipped for the migrator and says nothing of import_jobs_delete and import_keys_delete; every trigger of 0043 and 0044 skips korbat_migrate, the two delete rules included, so the tests and the command line clean up as the migrator, as they do every other table. The purge runs as the API role, meets them, and passes once it has marked the profile deleted.
- **ended_at is set again by the move into undone (6.1).** The table says each time is set once, and the guard's sentence names undone among the moves that set ended_at. Every way into undone passes through done or stopped, which set it, so import_jobs_guard lets ended_at change only in a move into done, stopped, undone, failed, cancelled or expired, requires it set after that move, and lets the move into undone set it again (the undo's end): it is set once on every other path.
- **The seed is null after the moves into done and stopped (6.1, 6.6).** The guard's sentence says only that the seed may become null once set; the table and 6.6 say it is erased by the move into done or stopped. import_jobs_guard refuses a move into done or stopped that leaves the seed set, so the publisher, the stop and the staff end clear it in the statement that moves the row.
- **A size is the bytes of the jsonb's text form (6.1).** The CHECKs of scan (262,144 bytes), choice (1,024) and import_picks.alts (16,384) measure octet_length(column::text), the canonical text PostgreSQL writes for a jsonb (a space after each colon and comma, keys in jsonb's order), so a writer that checks a size first measures that form, which is longer than JSON.stringify's.
- **The one-active index names its states as labels (6, 6.1).** Section 6 says enum values are compared as text, and every function of 0043 to 0045 compares them so. The predicate of import_jobs_one_active names the five labels instead (as posts_latest_idx names 'visible'), since an index predicate takes only immutable expressions and the cast of an enum to text (enum_out) is only stable; the type is created in the same migration, so its labels are usable at once, on a fresh database and an upgrade alike.
- **Images off (5.4, decision 15).** With images off a line carries no media and every photo of a post that is written counts images_off; a video, a sensitive post's images, an unsupported type and bluesky_no_files keep their own reasons, and a post whose only content was its images is skipped as empty. Image reasons are counted only for posts that are written, so a skipped post's images are not counted beside it.
- **Nothing kept (7.1 step 4).** A scan that writes no line writes the summary failed: nothing_to_import (and no posts.jsonl) instead of a scanned summary with posts 0.
- **First bytes (4.2, 7.1).** gzip's 1f 8b is tar_gz whatever the source; a zip given as Bluesky, or a CAR given as X or Mastodon, is not_this_source; anything else is not_an_archive. A zip starts PK 3 4 (or PK 5 6, empty); a CAR's first bytes are a varint within the 1,000,000-byte block cap and then a CBOR map.
- **attempts/<id> (7.1).** The attempt counter is removed at the end of a tick once import-archives' jobs/<id>/ is gone, so it lives exactly as long as the archive the API keeps.
- **over_item_cap (5.4).** Every element an adapter reads counts one item (X's Circle ids, notes and protected periods, read first, included; each post record of a CAR). When the 1,000,001st would be read the adapter stops: the summary counts over_item_cap 1 (the read stopped there; how many items were left is not known) with readInPart true, and what was read is written.
- **An element over the cap ends its file (5.5, 5.6).** An element past 1 MiB or 64 levels is counted item_too_large once, with its index in the log, and the rest of that data file is not read: the assembler cannot find the next element without parsing the refused one, which may be 900 MB. X goes on with its next file; Mastodon's outbox ends there. A data file that is not JSON, or whose prefix differs, fails the scan unreadable.
- **X notes wait in the scratch file (5.4, 5.5).** The core lends the adapter stash and recall on the scan's scratch file: a note's text, converted through steps 3 and 3b so it holds no handle, waits there with only its second and offset in memory, so the process holds no note texts. A truncated post is matched by comparing its converted text before the ellipsis with the start of a converted note of the same second.
- **actor.json is listed, never opened (5.6, 7.2 step 3).** Detect sees only allowlisted names, so Mastodon's allowlist names actor.json in a list-only rule: its name and size reach detect, it is not checked further, and open refuses it.
- **The CAR walk decodes each post when it reaches its key (5.7).** Pass 2 is interleaved with the MST walk instead of following a list of collected CIDs, so no list of up to 2,000,000 CIDs is held; only post records are decoded either way. The pass-1 index is keyed by the first 8 bytes of each block's SHA-256 digest in typed arrays (16 bytes a slot); a block whose 8 bytes collide fails its hash check (unreadable). Blocks are read synchronously from the open descriptor as the walk needs them.
- **Failure codes of the limits (7.2, 5.7).** A ratio over 100, a data file over 1 GiB and the 4 GiB sum are too_large_uncompressed; more than 200,000 entries or a directory over 64 MiB is too_many_entries; an overlap, a data range outside the file, a method other than 0 or 8, a local header that differs, a size that lies and a bad CRC are unreadable. A CAR of more than 2,000,000 blocks is too_many_entries, a block over 1,000,000 bytes or a commit that fails its hash unreadable, a CAR without exactly one root or with a commit that is not version 3 not_this_source. An image entry is not held to the data file's 1 GiB: the core counts one over 20 MiB too_large and never opens it. Detect runs after steps 1 to 3 and before step 4's checks, so the wrong source is named before a limit is.
- **cleaned counts posts (5.3 step 5, 9.3).** The summary's cleaned is the number of written posts whose text lost a character to step 5, or one of whose written images' descriptions lost one or became null, because import.cleaned reads 'removed from {n} posts'. The comment on cleaned in packages/contracts/src/imports.ts ('Characters removed by 5.3 step 5...') should say posts (Task 8).
- **Images are named by their bytes (5.4).** The first bytes decide jpg, png or webp (a .jpeg entry is written .jpg; a .jpg entry holding a GIF is unsupported). Positions run 0, 1, ... over the images written. Image slots go to the newest posts first and only to images that exist within 20 MiB; at most four a post (MEDIA_MAX_PER_POST), and an image beyond four or beyond 5,000 counts over_image_cap.
- **Repeated source ids (5.4).** Two items with one source id (so one key) are written once; the second counts unreadable.
- **Dates (5.4, 5.5).** A missing or malformed date is unreadable; date_out_of_range is kept for a parsed date before 2006-03-21 or more than a day after the import's creation. X's created_at is read by its strict pattern with its offset; Mastodon's, Bluesky's and X notes' dates as RFC 3339 with a zone; fractions of a second are cut.
- **Carriage returns in step 5 (5.3).** CR LF and a lone CR become LF before cleaning and are not counted as removals, as normalizePostBody would make them line breaks.
- **Where the fixed words live (5.3 step 3b, decision 12).** SOURCE_WORDS and CONTENT_WARNING_LABEL ('Content warning: ') are constants of apps/importer/src/text.ts, not packages/contracts: only the importer writes them into lines. A warning's own words pass step 3b too.
- **Without a manifest's file list (5.5).** The fixed names are data/tweets.js, data/tweet.js and every data/tweets-part<N>.js present, data/note-tweet.js and data/twitter-circle-tweet.js; a file the manifest lists but the archive lacks is passed over. A trailing semicolon and white space after the manifest's JSON or a data file's are taken off; other bytes after the array are not JSON when they arrive in the same read.
- **Other media types (5.5, 5.6).** An X media of a type other than photo, video or animated_gif, and a Mastodon image/gif or other image type, count unsupported; Mastodon audio counts video; a link card is ignored.
- **Strings the scan keeps are copied (5.4).** detach() copies every source id the heap keeps (and X's Circle ids): a string the tokenizer made can be a slice of the whole 64 KB chunk it came from, and 50,000 of them pinned about 450 MB in the large X lab before the copy (the 512m container's heap ran out).
- **Files section 13 does not name (13, 12.1, 12.5).** vitest.lab.config.ts (as the API's), test/fixtures/canaries.ts and harness.ts, and test/lab/tool.ts, support.ts and zip-writer.ts. The labs mount a named volume korbat2b-importer-lab at /lab for the generated archives, the scans' volumes, Vite's cache and the record (12.5 names none: the read-only root leaves 16 MB of /tmp), and test:lab loads its configuration with --configLoader runner, which writes no bundled copy of it on the read-only root.
- **How the labs measure (12.5).** Each scan runs in a process of its own (the labs' tool, bundled into the volume): its memory is process.resourceUsage().maxRSS after the scan minus process.memoryUsage().rss before it (after a forced collection), its time performance.now() around scanJob. The large CAR is about 900,000 posts beside 970,000 likes under the MST (2,000,000 blocks); a second CAR of 1,100,000 posts shows the 1,000,000-item cap. The X archive is about 1.86 GiB (tweets.js 369 MiB deflated), since it must also be at most IMPORT_RULES.maxBytes (2 GiB).
- **The adapter contract's shapes (5.2).** DraftPost carries the source id and parent's id, the kind, the date in epoch milliseconds, the text after steps 1 to 6, the count of step 5's removals and of replaced links, protected, warning, its images (entry or null, cleaned description) and imageSkips; it has no sensitive or long flag, since the adapter turns sensitive into image skips and long is a mark the intake reads from the text's length. AdapterItem's skipped form carries the item's index for unreadable and item_too_large. ReadContext lends takeItem (the item budget), stash and recall (the scratch file) and checkAborted. A refusal of the whole archive is a thrown ScanFailure with its code.
- **Test seams (12.2).** scanJob takes hooks: scratch (read the scratch file before it is deleted), placed (the order of the renames) and attempted (a throw stands in for a crash); the core and the zip and CAR readers take smaller limits in tests only, and LoopDeps takes a stand-in scan.
- **Migration 0046_import_pick_facts (6.1, 6.7, 9.2).** 6.7 names three migrations, 0043 to 0045, and 6.1 gives import_picks only the job, the ref, left_out and alts. Per the orchestrator's ruling of 2026-10-26 a fourth migration, the next free number, adds import_jobs.images (boolean, default false: whether the import brings images, set by the creating statement from IMPORT_IMAGES and written into job.json) and import_picks.month (YYYY-MM, CHECK import_picks_month) and marks (smallint 0 to 15, CHECK import_picks_marks), so ImportView.picks and the media route read no work file beyond the samples. It also adds import_picks.described (smallint 0 to 4, default 0, CHECK import_picks_described): the picks' counts of Task 1 are [marks, posts left out, source-described images in left-out posts, images given a description], and the third needs each picked line's described images, which month and marks do not carry. No grant changes: 0043's table-level SELECT and INSERT cover the new columns and its column-level UPDATE leaves them unchangeable; import_jobs_insert forces only the columns it names, so the insert's images stands. packages/db/test/schema.test.ts and import-schema.test.ts move their pins (columns, CHECKs, the picks' inserts, the insert's row with images).
- **The weekly limit has its own code (7.6, 9.4).** 9.4 answers import-week with rate_limited and the words import.limit. Per the orchestrator's ruling the create answers import_weekly_limit (429, added to ImportErrorCode in contracts), with Retry-After until the oldest of the three published imports leaves the seven days, so the app can tell it from the per-address limit, which keeps rate_limited (import.limit.network).
- **The create's statement and the order of its answers (4.2 step 3, 8.5).** 8.5 says the create inserts in one statement that locks the profile and ends with the closing judgment. The code's transaction takes pg_advisory_xact_lock on a fixed key, then one statement locks the profile FOR KEY SHARE, judges it by 3e's predicate, reads its age, its active import, its published imports of the week and the site's uploads and scans, and inserts only when all allow it; then, in the same transaction, the flow answers in 4.2's order (suspended, too soon, active, weekly, the address's five a day, the site's cap, the heartbeat, the free space), any refusal rolling the insert back; then the account's key (on conflict do nothing) and the closing judgment. The address's verification is read through the auth module before the transaction and judged at its place in the order. The address's count is taken only when the account passed the weekly limit and is given back for every creation that was not committed, so only created imports count.
- **A source switched off is imports_unavailable (4.2 step 3, 9.4).** 9.4 lists IMPORTS=off, the active cap, the heartbeat, free space and the limit store under imports_unavailable but not a source outside IMPORT_SOURCES; the code answers both switches with imports_unavailable (503), before the account is read, and GET /api/imports answers no sources while IMPORTS is off.
- **The standing pins count two in imports/repo.ts (8.5, architecture test).** The brief's pin was imports/repo.ts at 1; the test counts every mention, so the file's import of liveNotSuspended and closingJudgment and their one use each count two, as media/repo.ts's upload row does. No other file of the module names either, nor suspendedAt or reportsRestrictedAt.
- **A chunk's malformed headers and its limit (7.3, 7.6).** 7.3 lists the refusals from not_found on. A missing or malformed Import-Offset or Import-Chunk-Sha256 is invalid_request (400) before anything else; a missing Content-Length is chunk_too_large. The import-chunk count is taken after the headers and before the row is read, so a chunk of nobody's import counts too; a store that cannot count answers imports_unavailable (9.4's limit store), as the act and pick limits do.
- **One chunk of an import at a time (7.3).** 7.3 relies on the statement that requires the old received_bytes. Two requests appending to one archive.part at once would interleave their bytes, so the module also keeps, in the process, the uploads that have a chunk on its way in: a second chunk of the same import is answered wrong_offset with the stored size at once. The API runs as one instance; the old-value statement stays the guard between instances.
- **A row behind its file takes only whole chunks, never the last (7.3).** 7.3 says such a row is set to the file's size on the next request. The code takes the file's size only up to the last whole chunk, and never the archive's last chunk, whose request also renames the archive, writes job.json and the marker and moves the import: the file is cut back to what the row then holds, the request is answered wrong_offset with it, and the app sends the rest again. A file shorter than its row (bytes lost from the volume) cannot go on: imports_unavailable, and the upload expires at 24 hours.
- **The first bytes (7.3).** The API reads up to 16 first bytes before any is kept: a zip's local header (PK 3 4) for X and Mastodon, a CAR's varint header length within carBlockMaxBytes followed by a CBOR map for Bluesky (the importer's own reading, written again since an app imports no other app), gzip's two bytes for any source (tar_gz); anything else, an empty zip's end record included, is not_an_archive. The import moves to failed with ended_at and its folder is deleted at once.
- **The last chunk against a cancel (7.3).** 7.3 orders the last chunk's work as fsync, rename, job.json and the queue marker, then the move to scanning. When that move loses to a cancel that committed first, the chunk deletes the archive folder and the marker again and writes delete/<id>, and answers wrong_state, so the importer scans nothing nobody waits for. Every chunk is flushed with fsync before its row moves, so a row never counts bytes that are not on disk; on Windows the cut back goes through a descriptor of its own, since one opened for appending cannot truncate there.
- **The intake's rules (7.5 step 2).** 7.5 says a line that fails, every image file named included, is unreadable. The code counts an image file that openWorkFile refuses (missing, a link, another device, over 20 MiB) as missing_file and leaves it out of its line (7.1: a refused file counts as missing_file), the line staying readable. A line dated before 2006-03-21 or more than a day after the import's creation is unreadable too (5.4's range, which the importer applies), so a hostile file cannot grow the month table past the scan's CHECK. The counts come in this order: unreadable, already_imported (asked of the social module a thousand keys at a time), then new_account_cap among the lines left (a young account's newest 1,000 offered lines), so fromRef is the oldest of those. Images beyond 5,000 are counted over_image_cap from the newest posts back; a line naming images while the import brings none counts them images_off. The samples and the pages are the offered lines' (the pages every fiftieth offered line's offset). An import with no offered line still moves to ready, its counts shown.
- **A summary or posts.jsonl the API cannot take (7.5 step 1).** 7.5 says what follows a failed or scanned summary. A summary refused by openWorkFile or by its schema, one naming another import, and a scanned summary whose posts.jsonl is refused all move the import to failed as unreadable; every summary read deletes the archive folder and marker first, and every failure asks for the work folder.
- **The preview's lines and picks (9.2).** 9.2 says lines 50n to 50n+49. The code reads page n from pages[n] up to pages[n+1] and shows a line only by the intake's own rule (readable at its place, at or after fromRef, not already imported, asked again of the social module), so a page holds 50 offered lines and a page past the end is empty; a malformed page is invalid_request. A pick finds its line by a binary search over the pages' first lines, then reads to it; a line that is not offered is not_found. A description is taken only for an image the line has, that opens, and that its source left without one, and none while the import brings no images (invalid_request otherwise); a pick without a description stores alts null. The picks' counts leave out groups whose numbers are all zero.
- **The media route and the lines route outside ready (9.2).** 9.2 says ready only; an import in another state answers wrong_state (409); an import that brings no images, a name the work folder may not hold, a file openWorkFile refuses and one that does not sniff as JPEG, PNG or WebP answer not_found; the type is the sniffed one, never the name's.
- **ImportView before Tasks 5 and 6 (9.3).** progress.imagesTotal, postsTotal and postsLeft are 0 and imagesSettled is images_kept plus images_left_out until Tasks 5 and 6 count a confirmed choice; paused is false (Task 6 owns it, per the ruling); refusalId is null (Task 5). The picks' counts are read while the import is ready, preparing or publishing, and are empty otherwise.
- **Retention and orphans (7.5 steps 7 and 8).** Step 7 deletes the picks of imports in done, stopped, undoing, undone, failed, cancelled and expired, and the rows ended more than 30 days ago in an end state other than undoing that no post names; that one read of posts (a not exists on posts.import_job_id) is in imports/repo.ts, beside the foreign key it mirrors. Step 8 runs in a job's first round and every tenth: it deletes an archive folder or queue marker older than an hour whose import is not uploading or scanning (not only those naming no row, since a cancel racing a last chunk can leave one), asks for a work folder older than an hour whose import does not need it (not scanning, ready, preparing or publishing), and withdraws a deletion request once the work folder is gone and the request is older than an hour. Every time a round writes (scanned_at, ended_at) is the round's own clock.
- **Files section 13 does not name (9.1, 12.3, 12.5).** apps/api/src/imports/view.ts builds ImportView and the picks' counts; apps/api/test/integration/imports-harness.ts is the integration files' app (auth, social and imports wired as the server wires them, the two volumes in a temporary folder, writeScanOutput for the importer); apps/api/test/lab/imports-intake.lab.ts and imports-intake.child.ts are the API's half of the large-archive lab; apps/importer/.env.example serves the host-run importer.
- **The seams (9.1).** apps/api depends on @korbat/import-protocol (workspace). The auth module's index gains AuthForImports.emailVerified (users.email_verified_at through its repository) as auth.forImports; the social module's index gains SocialForImports.importedKeys (social/repo.ts importedKeys, by posts_import_key_idx, posts not deleted by their author) as social.forImports, and exports limitsFor with the ImportAction type, so the imports module counts its chunks, acts and picks in tiers.ts's table (import-chunk 600, import-act 20, import-pick 3,000 an hour, from IMPORT_RULES). The architecture test's rule against auth-schema imports covers the imports module too. moderation-fixtures.ts's removeFixtures deletes the accounts' import_jobs and import_keys as the migrator after their posts and images and before their profiles.
- **A host-run importer for development (the ruling; 7.1).** apps/importer gains the script dev (tsx watch --env-file=.env src/index.ts, tsx 4.23.13 as the workspace already pins it), apps/importer/.env.example (IMPORT_ARCHIVES_DIR and IMPORT_WORK_DIR under ../../.data/import, the folders apps/api/.env names), scripts/gen-dev-env.mjs completes apps/importer/.env, and README.md's quick start gains its line.
- **The settings' bounds (7.7).** 7.7 gives defaults only for some. IMPORT_MAX_ACTIVE is 1 to 100; IMPORT_SOURCES drops repeats and refuses an empty list as well as an unknown source; IMPORT_MIN_FREE_BYTES is 0 or more; a blank value is each setting's default, as Compose passes an empty variable; IMPORT_ARCHIVES_DIR and IMPORT_WORK_DIR default to the host folders under .data/import, and Compose sets /import/archives and /import/work. IMPORT_IMAGES=on is refused while MEDIA_MATCH is off in every environment.
- **Caddy's JSON matcher (7.3).** 7.3 says @json gains not @import_chunk's path and method; Caddy's matcher takes it as a not block holding method PUT and the same path_regexp, beside not path /api/media.
- **Migration 0047 (6.7, 8.1; the orchestrator's rulings).** 6.7 names 0043 to 0045 and the brief none for Task 5. The rulings take the next free number, 0047_import_images: alert_outbox_kind is replaced with 0041's list and import_image_flagged last; import_jobs gains images_left_out_by (jsonb, default '{}', CHECK import_jobs_left_out_by: an object of IMPORT_IMAGE_SKIPS' names within 1,024 bytes) with the API role's UPDATE of it; import_jobs_insert is replaced to force it to '{}', and import_jobs_guard to hold each count to a whole number that only grows and their sum to images_left_out on every update (asked only of an object, so the CHECK refuses anything else). It also adds post_media_import_unattached_idx (import_job_id where import_job_id is not null and post_id is null), which no ruling names: import-drive asks every round which ended imports still have rows on no post, and without it that question would scan every imported image ever attached.
- **The admin's alert for a non-acting match (8.1).** 8.1 says an admin is alerted through moderation's staffAlert. The ruling makes it a real kind, import_image_flagged (ALERT_KIND_LIST last; priority 3, every staff account, push and mail, the mail its push's sentence, mailed again by the tick), whose facts are the time and the count alone, never an image, an id or an import. ModerationForImports.imagesFlagged sends it after the commit that settled the images, at most once an hour an import (the throttle's key names the import; the row does not).
- **The chosen totals (9.3; the ruling).** The confirmation counts the posts and images the choice holds from the month table and the picks, as the app counts them (months and marks the choice keeps; picks leaving a line out subtract the post and its described images; descriptions a pick gives add), before the move out of ready cuts the table, and keeps them as the scan's member `chosen`, which ImportScanFacts gains as optional. The view's progress.imagesTotal and postsTotal read it already (the carry gave the totals to Task 6; they exist at confirmation, so they are filled here); postsLeft stays Task 6's.
- **Images left out by reason (9.3; the ruling).** ImportView.progress gains imagesLeftOut, the job's images_left_out_by as a partial record of IMPORT_IMAGE_SKIPS, whose counts sum to the settled images not kept, for the result's notice.
- **The confirmation's checks and their order (4.5, 8.5, 9.5).** A body that would parse but for its statement is statement_required, any other bad body invalid_request; then import-act, then not_found, then account_suspended read through the profile store's plain `suspended` (no new site of 3e's fragments; the writes the confirmation starts are judged where they are written), then wrong_state, then a from or to outside the scan's first and last month invalid_request (9.4 names no code for it), then nothing_chosen. The import prepares when it and the choice bring images and the chosen images are above 0, and publishes at once otherwise. apps/api/src/index.ts builds one profile store, which the auth module and the imports module share.
- **The feeder's lock order (6.5, 7.4).** 7.4 says the transaction takes the job row FOR NO KEY UPDATE after the owner's row and before the insert, and 6.5 that insertProcessing writes `imported` and the job in its statement. insertProcessing takes `importJob: { id, claim }`: inside its transaction the imports module's claim (imports/repo.ts claimImage) first locks the owner's profile row FOR KEY SHARE (a plain lock, without 3e's predicate), then moves image_cursor by an UPDATE of the job row, only while the import is preparing at the cursor the feeder read; a false claim rolls back as ImportMovedOn (answered `stopped`). Then the unchanged one statement judges the owner by the predicate and inserts with imported true and the job's id, the hashes follow and the closing judgment ends it. So the cursor moves before the row in the same transaction, media/repo.ts names liveNotSuspended and closingJudgment twice each as before, and the media module never names import_jobs.
- **Rows left out are deleted as they settle (7.4, 8.1, 6.6).** 8.1 says a flagged image's file goes with the import's leftovers. Every row the feeder leaves out (flagged, failed, not_checked) is deleted through media.deleteImportLeftovers in the transaction that counts it (the job row FOR NO KEY UPDATE first, while it is still preparing), and its files are asked for after the commit, so a settled image can never change its count (an unchecked row could otherwise turn clear under match-retry). A flagged row's match record stays, as media_matches has no foreign key to post_media. Kept rows (ready, clear) stay for Task 6's attach.
- **The plan (7.4).** The preview's pages are cut at the confirmation, so the feeder builds a plan once a process for the import it feeds: posts.jsonl read once through openWorkFile by the intake's rule, the keys of its lines with images asked again, the cap of IMPORT_RULES.maxImages applied newest first over the offered lines as the intake applied it (opening only as many files as the cap leaves room for), then the kept-line rule and a description from the source or the pick; images in ref and position order, at most 5,000 entries, kept in ImportDeps.plans until the import leaves preparing. A plan that a later process builds differently (a key imported or removed meanwhile) can meet an id already written: the receipt `already` moves the cursor without a count, and the row settles as any.
- **Unanswered images (decision 19; ruling 5).** Every row that is neither ready and clear, ready and matched, nor failed (its check pending, unchecked or capped, or its file never reached the worker) waits; IMPORT_RULES.checkHours after its row's created_at (the feeder's round clock) it is left out as not_checked. failStale leaves such a row alone (import_job_id is null added), so a row the worker never answers occupies one of the two places in flight until then.
- **Without a matcher (decision 15).** The design says images are imported only while a matcher is on. If the comparison is off while an import prepares (the owner switched both settings off after a confirmation), the feeder feeds nothing and leaves every image not yet fed out as not_checked in one statement, so the import goes on to publish its text and the images kept before.
- **The feeder's other conditions (7.4).** Besides the three of 7.4, the feeder feeds nothing while the media volumes are under MEDIA_MIN_FREE_BYTES, as an upload is refused. The site's pace is counted once a work file has opened, so a refused file costs none of it. A suspended owner's image is refused by the insert's predicate: nothing is written, the cursor stays and the import waits. A sniff refusal is unsupported and a body over MEDIA_MAX_BYTES too_large, each never retried.
- **The Stop's images (4.6, 7.4).** The Stop is one UPDATE (stopped, by_author, seed null, ended_at) and asks for the work folder at once; the prepared images on no post go in import-drive's next round, whose leftovers step deletes, every round, the rows on no post of every import that has left preparing and publishing (a refused row stays while its hold does, and is not asked about).
- **A refusal's words (8.2).** refused_words is the post's text with its runs of spaces and line breaks read as one space, at most IMPORT_RULES.refusedWordsMax code points, cut at the last space within them; refused_at_original is the line's day. A line that cannot be read again leaves both null. ImportView.refusalId is the earliest refusal of the import's images, read through media.forImports.refusalOf.
- **The media module's interface for imports (6.5, 9.1).** MediaForImports holds matching, ownUploadWaiting, importedInFlight, hasRoom, receive (media/flows/upload.ts receiveImported, over media/files.ts receiveWorkFile and discardPart), settleRows (finalize of the import's processing rows that are not capped, then importRows), importRows, deleteImportLeftovers (owing the rows' deletions inside the caller's transaction, as the purge does), releaseFiles, importsWithLeftovers and refusalOf. The repository gains deleteImportLeftovers (with optional ids), importRows, importsWithLeftovers, importedProcessing, importedAmong and importRefusal. REQUEST_DELETION's pin of media/index.ts moves from 5 to 6.
- **Files section 13 does not name.** apps/api/src/imports/plan.ts (uuidFrom, the derived ids, the kept-line rule, the chosen totals, the plan, the first words), apps/api/src/media/flows/upload.ts, apps/api/src/moderation/index.ts (forImports), moderation/alerts.ts, auth/flows/notifiers.ts, mail/mailer.ts and mail/templates.ts (the alert kind), apps/api/src/index.ts, packages/contracts/src/orders.ts and imports.ts, packages/db/src/schema/imports.ts, content.ts and safety.ts; tests: apps/api/test/imports-plan.test.ts, app.test.ts, imports-chunk.test.ts, mail/moderation-templates.test.ts, integration/imports-harness.ts, import-schema.test.ts, packages/contracts/test (orders, head, automation, known-material, imports) and packages/db/test/schema.test.ts.
- **Migration 0048_import_staff_end, flagged (owner) (6.1, 6.7, 8.7; the orchestrator's rulings).** The design names no migration for Task 6; the brief asked for 0039's append_confirmed_audit with the action added last and nothing else, and the rulings added the case and the decision. 0048 is a drizzle-generated part, import_jobs.staff_case_id and staff_decision_id (uuid, no foreign key: the moderation module's retention erases on its own clock) and import_jobs_staff now holding the staff end's four columns set together or not at all, then hand-written SQL in 0043's conventions: the API role's UPDATE of the two columns; import_jobs_insert replaced (0047's text, the two forced to null); import_jobs_guard replaced (0047's text, its staff rule over the four columns, set only in the move into stopped or undoing that sets them first); append_confirmed_audit replaced (0039's text, import_ended_by_staff added last); and gap_close replaced (0034's text, one arm before the decision branch: a gap whose action is import_ended_by_staff is closed, with a decision, only by a live admin in the transaction that ends that import again, when the import the gap names now holds staff_decision_id = that decision and staff_ended_at = now(); no decision of the case closes it, and it still closes as not needed). A second generate prints No schema changes.
- **What an admin's end rests on (8.7, 9.3; the ruling that an admin ends an import only from a case about a post of that import, by a recorded decision).** The design's params are { caseId, ruleId }; the code's are { caseId, decisionId, ruleId } (ImportEndedByStaffParams, lower-case ids, a rule of RULE_IDS). The end is no new measure of 3c's ledger (no action_kind, no decision_actions row, which would change the statements, the appeals and the counts): it rests on a decision already recorded on the case, which must be final and restricting, under the rule the end names, on a case about a post; and that post must still name the import (a post its author deleted has its columns cleared and is no basis). The end itself is recorded by its confirmed audit row and on the import's row (staff_ended_at, staff_rule_id, staff_case_id, staff_decision_id); the mail tells the person the decision can be appealed on its case. A basis that does not fit is invalid_request (400), no such import not_found (404), an import ended by staff already or with nothing to end (undoing, undone, stopped before any post) wrong_state (409).
- **Where the staff end runs (8.7, 9.1).** The design writes the audit row through apps/api/src/staff/audit.ts and names endByStaff in imports/index.ts. The staff module holds the transaction (staff/imports.ts, as exportAudit holds its own): the moderation module's importEndBasis (a new member of ModerationForStaff) reads the case and the decision first; then one transaction with the bounded lock waits, the imports module's forStaff.endByStaff (the moves of 8.7 in imports/repo.ts, the job row FOR UPDATE, the case's post held to the import), gap_close when ?gap= names a restore's gap, and append_confirmed_audit last with { params } as metadata; once more after a deadlock while the challenge has a minute, ended and late answered as a decision's. After the commit forStaff.endedByStaff asks for a running import's work folder and mails the person through AuthForImports.mailAccount (template import_ended_by_staff: the rule's id and title, and that the decision can be appealed under Settings, Cases; no post, source, staff member or link). A moderator is refused 403 admin_required by the route before the step-up is read, so no confirmation of theirs is used; the database's function checks no role. The route answers 201 with the case as it now stands (moderation.decidedCase), whose target shows the import. createStaff's imports and now are optional, and the route is mounted only with them.
- **ImportView.staffDecisionId (9.3; the ruling).** ImportView gains staffDecisionId (a uuid or null) after endedByStaff, from import_jobs.staff_decision_id, so the screens link to the decision under the person's Cases.
- **A lost end after a restore (the ruling; 3f's 6.6).** apps/api/src/cli/restore.ts writes a lost import_ended_by_staff line as one open gap of the class restriction (IMPORT_END_GAP_CLASS, exported) on the import, as a lost decision is written: a measure that keeps retention off while open, not a site class. An admin closes it by ending the import again with ?gap= (0048's gap_close arm), or as not needed when the restored database has nothing left to end.
- **Thread order in milliseconds, not microseconds (6.5).** The design says created_at is the transaction's now plus the line's place in the batch in microseconds. Every timestamp of the social module is of millisecond precision, and the replies reader's keyset cursor is too: microsecond offsets within one millisecond would repeat or skip replies across pages. So a post's created_at is the batch's time plus its place in milliseconds, and each batch of a round starts batchPosts milliseconds after the one before (the round's time plus the batch's number times batchPosts), so a round's at most 2,000 posts span two seconds and a thread keeps its order.
- **Who builds a batch's posts (6.5).** The design gives social.publishImportedBatch(job, lines, now) the choice's rule. The imports module (publisher.ts) reads the lines, keeps those plan.ts's keptLine keeps (with the account's keys asked again for each batch), cuts a shortened one (plan.ts's shortenText), derives each post's and parent's id and its kept images with their descriptions, and skips a line left with nothing visible; the social module's publishImportedBatch(job, { lines, posts }, now, attach) writes them in 6.5's order. Inside its transaction, after the author's lock, it also passes over posts already there by id or by key, so a parent that a conflict would skip cannot make its reply's insert fail posts_import_guard; on conflict do nothing stays, and only the rows RETURNING gave are counted. A thread line whose parent is neither earlier in the batch nor a post of this import (left out, skipped, or deleted meanwhile with its columns cleared) is written as a post of its own. The cursor moves past every line read, kept or not.
- **Publishing starts the round after an import reaches publishing (7.5 step 5).** A round takes the imports that publish as it begins (after the time limits) and publishes them after the feeding and the leftovers; an import whose images settled in this round's feeding publishes from the next round, five seconds on, so the round that settles its images leaves them on no post, as Task 5's tests read them.
- **The undo's batch (6.5, 7.5 step 6).** removeImportedBatch(job, now, limit) takes the author's row, then the job's row FOR NO KEY UPDATE while it is undoing (the publisher's order: profile, job, posts), then the batch and its parents with lockPostsInOrder; it lowers the parents' reply counts, the author's post count for the top-level posts and, as deletePost does, the quoted posts' counts (an import never quotes). The files of the detached rows are asked for after each commit by social/flows/imports.ts, the one new requestDeletion site (architecture.test.ts's REQUEST_DELETION gains it).
- **The purge also clears a tombstone that still carries the columns (4.7, 6.6).** purgeProfile's tombstoning statement clears the five import columns of every post it tombstones, a disabled one's too, and of any tombstone that still carries them (keeping its deletion time), so no post can name an import when the jobs are deleted. The jobs and the key are deleted inside the purge's transaction through imports.forAccount.purgeOwner before the media rows (which stay the last statement); the delete's on delete set null on post_media.import_job_id therefore touches the account's imported image rows just before media's purgeOwner deletes them. AccountDeps.imports is optional, as moderation is: without it the purge deletes no import row and the export's member is empty.
- **The Imported tab's page and its count (9.2; 3d's transparency count).** GET /api/profiles/:handle/imported answers a PostPage (items PostView), as the Replies tab does, its cursor the archive's date and the id; signed out too. It is counted as a signed-out read: RECIPIENT_READ_ROUTES in packages/contracts/src/transparency.ts gains it (eight routes), which the route-table test requires of every signed-out read of the social module.
- **The moderation module's interface to imports (8.7; the ruling).** The ruling names an imports.forModeration interface. The moderation module is built before the imports module (which sends it alerts), so the interface is a factory of its own, importsForModeration(apiDb), as socialForModeration is: one read, importSize(importId). ModerationDeps.imports is optional; a module built without it shows no import on a case.
- **CaseTarget.imported (8.7, 9.3).** The post's member gains, last, imported: { source, at, importId, importSize, importedAt } (CaseImported), read by livePost from the post's own columns while they hold it (null once a tombstone cleared them), importSize the job's posts_published through the interface above, importedAt the UTC day of the post's created_at (its publication, which is the day it was imported).
- **The contracts' places (9.3).** PostView.imported (ImportedLabel: source, the archive's UTC day, shortened) is last; QuotedPost gains it last too (the ruling); ProfileView.hasImported (a visible imported top-level post exists, the same for every reader) follows counts; ExploreStatusKind gains imported after quote, and the status route answers it after reply and quote; the app's exploreStatusText words it with 10.6's sentence. ExportedPost.imported is { source, originalCreatedAt, shortened } (the full date: it is the author's own export), and ExportFormat.imports lists { id, source, status, createdAt, endedAt, statedAt, choice, counts }, choice null before a confirmation.
- **Decision 13's cut (9.5).** plan.ts's shortenText cuts at the last space or line break within the first shortenTo - 1 code points (at shortenTo - 1 when there is none), drops the trailing space and adds the ellipsis, so a shortened body is at most shortenTo code points, as posts_body_len counts them.
- **paused and postsLeft (9.3; the rulings).** paused is true while the import prepares or publishes and the profile store's suspended read says its author's suspension runs. postsLeft is the chosen posts (scan.chosen.posts) less posts_published while the import publishes, 0 in every other state; a line the batch finds already imported, or left with nothing visible, is published by no one, so a done import may have published fewer than it chose.
- **Every outside link of a post sends no referrer (decision 21, 10.6).** The design writes RichText's links as rel='nofollow ugc noopener'. RichText marks every outside link of every post, native or imported, with POST_LINK_REL in apps/app/src/lib/links.ts, 'nofollow ugc noopener noreferrer', so the page a post links to does not learn which korbat page it was read on; externalLink() takes the relation as an argument and keeps 'noopener noreferrer' for its other callers (ItemLines.tsx). A mention is korbat's own profile page and carries no rel; in an imported post it is no link at all (RichText's `mentions` false).
- **Words the table leaves out (10.9, 9.4, 10.1).** apps/app/src/lib/import-words.ts holds the table's 167 keys word for word and, after them, the sentences the screens need that it lacks: import.wrongState and import.statementRequired (9.4's own sentences), import.sourceName.x, .mastodon and .bluesky (the short names inside the label and the sentences), import.state.<status> for the twelve states (each view's level-2 heading and its row under Your imports, with import.row, '{state}, started {date}'), import.found.title and import.confirm.title (the preview's first and last cards), import.now.scanning, .publishing, .stopped and .undone (the other changes of state), import.bar.upload (the upload bar's name), import.startAgain (the failed view's link), import.dimmed.month, .reply, .long, .warning and .protected (import.list.dimmed's reasons), import.list.imageNoAlt, import.list.more, import.list.range and import.month.done. title.import is 'Import - Settings - korbat' in TITLE_WORDS.
- **The preview's kept-until time is a lower bound (10.4).** The design prints import.keptUntil from the scan's time plus 24 hours. ImportView carries no scan time and Task 7 changes no API code, so the preview prints the import's createdAt plus IMPORT_RULES.previewHours, a time never later than the real one, since a scan ends after its import was created; adding scannedAt to ImportView (the row has scanned_at) makes it exact (flagged for the owner).
- **The app's JavaScript cap is the baseline plus 120 KB (UI design 11.3; owner).** The import's screens, words, uploader and kit parts add about 20.6 KB gzip: the web export measures 812,307 bytes of JavaScript gzip (791,669 before Task 7, already 372 over), past the cap of the baseline plus 80 KB (791,297). app.browser.ts's step 1 now holds the bundle to the baseline plus 120 KB, 832,257 bytes, with its pin; icons stay imported one module at a time. README.md's budget line is Task 8's.
- **The label opens its own Who sees this (10.6).** The provenance line is ImportedLine in PostCard.tsx, a 44 px button named with the day written out and aria-haspopup dialog, which mounts a WhoSeesThis of its own with at='provenance' (PostMenu's is left as it was); kit/Sheet.tsx's initialFocus gains 'marked', which focuses the element marked data-sheet-focus once the sheet is laid out, and Who sees this marks the provenance paragraph so (tabIndex -1, the kit's ring). Escape gives the focus back to the label.
- **Who sees this for an imported post (10.6, UI design 6.14).** reach() gives every reader the public line, then import.reach and the provenance paragraph, then how korbat treats reach; the author's own visible imported post adds what a block does after the public line and asks /explore for nothing, whatever answer it holds; an imported reply of the author's own thread reads as its top-level posts do, since imported posts are on no Replies tab; the author's withheld or removed imported post keeps the private branch's lines with the provenance before the last line. The provenance's {imported} is the post's publication day (its createdAt, the day it was imported) in the reader's zone, its {date} the archive's day in UTC.
- **What will be left out, row by row (10.4).** The design gives each reason a row whose title is the count and the reason's words and whose description is a line of why. Each row is an information ListRow whose label is the reason's words (which say why: 'Polls, which korbat does not have') and whose value is the count; posts first in IMPORT_SKIP_REASONS' order, then images in IMPORT_IMAGE_SKIPS'. The app adds its own counts: reply, too_long, warning and protected (a line once, by the first mark the choice refuses) and left_out (the picks) within the months kept, and for images not_chosen (the chosen posts' images while Bring images is off) and no_description (those still without one while it is on).
- **No secondary danger face (10.5).** The design asks for a secondary danger Button for Stop import and Remove imported posts. The kit's Button has primary, secondary and danger faces only: Stop import, Remove imported posts and Cancel import are secondary Buttons that open their question, and the question's own Sheet carries the danger answer (Stop import, Remove posts, Cancel import) beside the secondary way back.
- **Publish's aria-disabled is written on the element (10.4).** The design keeps Publish focusable with aria-disabled until the statement is ticked and while the choice leaves nothing. react-native-web draws a role=button as a native button and turns any disabled state given to it (disabled, aria-disabled, accessibilityDisabled) into the native disabled attribute, which takes the button out of the tab order; so Preview.tsx gives the Pressable no disabled state and writes aria-disabled on its element in an effect on the web (React leaves an attribute it does not render alone), with tabIndex 0 and the reason tied by aria-describedby. Pressed while blocked, it moves the focus to the statement, or does nothing when the choice leaves no post. The browser check's step 47 holds the stop and the Enter.
- **The failed view draws its own error (10.3).** The design names ErrorState with the failure's sentence and a link Start again. ErrorState offers only Try again, a retry, which a failed scan has none of, so the failed view draws the error icon, the failure's sentence (import.failure.*, {source} the short name) as an alert, and the link Start again (import.startAgain) to /settings/import.
- **Import the text only (10.5).** A new import needs the archive chosen again, which the tab no longer holds, so the link opens /settings/import?source=<source> with that source chosen; the preview's Bring images starts off, so the new import is text only unless the person turns it on.
- **MonthPicker closes with Done (10.1).** Its Sheet holds the radio group of the scan's months and a Done button (import.month.done): a choice is taken at once, so the arrows can walk the months, and Done, Escape or the scrim close it; the focus returns to the picker's button, which reads its label and the chosen month ('From March 2019').
- **Static cards for samples and lines (10.4).** Samples and lines are not PostViews: components/import/PostList.tsx's StaticCard draws the person's own avatar, name and handle, the label as text (with ', shortened on import' when the choice shortens a long line, whose words are then cut as plan.ts cuts them), and the words as plain text with no link at all; a line the choice leaves out is drawn in ink-low with its reason (never by opacity, so its contrast holds) and tied to its checkbox by aria-describedby. A description is saved when its field loses focus, and a checkbox at once.
- **The upload runs in the tab (10.3).** The design has the uploader in lib/imports.ts. Its runs live in a registry in the tab's memory (startUpload, stopUpload, useUploadRun), so an upload goes on while the person moves between screens and ends with the tab; a reload asks for the same file again (import.resume, its size checked first). Besides 7.3's rules, wrong_offset at the uploader's own place (a chunk of the import still in flight) is tried again a second later, ten times at most, and network errors are tried five times in a row, each after a read of the import.
- **The browser check's lost connection (10.8).** The fixture loses the second chunk's answer (the chunk is kept) and every further try at that offset until the app reads the import, because Chromium itself sends a PUT again once when a reused connection closes without an answer; the step counts tries lost in a row once and holds that a GET of the import came between the lost chunk and the next one. The steps are 41 to 51 (Light, Dim and Dark's contrast as 42 to 44), and the walk has 51 runs.
- **Announcements (10.1).** A change of state the screen sees says one polite sentence, import.now.* and the new keys above, through announcement() in lib/imports.ts; a change the person's own press made (their confirm, cancel or remove, and an admin's end, whose view states its rule) says nothing more, since the press is answered where it was made. The focus goes to the new view's level-2 heading only when the element that held it left the page (isConnected false) or none holds it; the removal's end also plays the success haptic.
- **The post's page knows an imported post's Explore line (10.6, 2c).** post/[id].tsx draws, under the author's own imported post, import.explore with the link How Explore works, and asks /explore for nothing; ExploreStatusLine's condition gains thread.post.imported === null, and explore.test.tsx's pin of that line moves with it.
- **Settings' row and index (10.1).** SETTINGS_PAGES gains page import with the row's label Import and `row` Import posts, which the Settings index shows; the index reads GET /api/imports as it opens and shows Ready to review while an import is ready, and nothing more when the read fails.
- **Where the terms' new sentences stand (11.3).** Importing posts follows Explore; What you can post gains its licence as a second paragraph; Your data's paragraph on the import's record comes after the export's paragraph, since 3f's test holds that paragraph right after the paragraphs on authorities. The hours and days are IMPORT_RULES' (archiveHours, workHours / 24 as a word, recordDays), and terms.test.tsx's table tests collect IMPORT_RULES.recordDays among the constants a number may come from.
- **The console's import lines and End this import (10.7, decision 30).** apps/admin's Case.tsx prints importedLine and importedSize (words.ts; an import of one post reads 'The only post of its import, imported on ...') under the post's address only: the snapshot holds no import fields (8.7 leaves the evidence copy as it was) and the composer's preview shows the statement, not the post. End this import is drawn with the console's red confirming class (primary), since app.css has no danger class and the policy adds no asset; its words and its four refusals are messages.ts's IMPORT_END_WORDS, where source.test.ts wants every refusal table. CaseImported says nothing of the import's state, so the block still shows after an end, and a second press is refused wrong_state in its own words; api.endImport sends no restore gap.
- **The design's own path (header; section 13, Task 8).** The header and Task 8's entry name this design docs/superpowers/specs/2026-10-21-import-3b-design.md. It was committed before Task 1 as docs/superpowers/specs/2026-10-22-import-3b-design.md, the name that every task's code comments, the README's Importing posts and Counsel's list, the main design's row 3b, its section 6a and its section 9 entry of 2026-10-27 cite.
- **The main design's line numbers (throughout; section 13, Task 8).** Every line this design cites in the main design (docs/superpowers/specs/2026-09-03-korbat-design.md) counts from 6babae1. The UI sub-project then added a line under section 5's heading, and Task 8 one under section 6a's ('Delivered by sub-project 3b'), so from section 5 on each cited line is one later and from 6a's heading on two later: 6a's lines 237 (the parse in the worker), 244 (Same rules as native posts), 246 (the verified import mark), 249 (the profile) and 255 (original_url) are 239, 246, 248, 251 and 257, which section 9's entry of 2026-10-27 quotes; 3e's lines 370 and 371 are 372 and 373; and 3d's lines 399 and 400 are 401 and 402.
- **A lost staff end after a restore, from the console (8.7; 3f's restore).** The API closes the open gap of the class restriction that restore-import writes for a lost import_ended_by_staff when the import is ended again with the gap named, POST /api/staff/imports/<import>/end?gap=<gap> (0048's gap_close). The console cannot send it yet: End this import (apps/admin/src/screens/Case.tsx, step-up.ts and api.ts) names no gap, and After a restore links no case for a gap whose target is an import, since apps/api/src/moderation/gaps.ts reads a gap's case only for a case, a decision or a seal. So an admin finds a case about one of the import's posts, ends the import again from it, and then closes the gap as Not needed with the key; the README's Importing posts says so. Naming the gap from the console (the case the lost row's parameters name, and End this import with ?gap=) is left for a later change.
- **The smoke test (12.6, 7.6, 11.2).** Step 21 now runs the whole import: confirmed with every choice off or open, long posts left out and the statement; published by import-drive until done with four posts; the Imported tab holding them newest first by the archive's day, each labelled as imported from Mastodon on its day; hasImported true, the profile's post count four higher and Latest holding none; then undone until undone, the tab empty, hasImported false and the count as before. Each run creates one import from the same address, so with import-address-day (five imports started from one address in a day) one network can run the smoke test five times a day, not twenty; the script's header and the README's Full stack say so. Step 14's export check follows 11.2: export.json ends with moderation and then imports (none for that account), where it had held moderation to be the last member since 3c.
````

### Replace `packages/contracts/src/imports.ts` (whole file)

```ts
import { z } from "zod";
import { AltText, MEDIA_MAX_PER_POST } from "./media";
import { FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizePostBody, postLength, visibleLength } from "./text";

/**
 * Import from other platforms (3b design, docs/superpowers/specs/2026-10-22-import-3b-design.md, sections 5.1 and 9.3;
 * Task 1): the line the importer writes and the API reads back as hostile input, the importer's summary, the intake's
 * numbers, the person's choice, the views, the closed lists and every number of the design. It imports only zod,
 * ./media and ./text, so social.ts, moderation.ts, staff.ts and account.ts can read ImportSource while they load.
 */

const rules = {
  /** 7.3: a chunk is exactly this long but the last; under Cloudflare's 100 MB and inside its 125-second read timeout. */
  chunkBytes: 8_388_608,
  /** 7.3: the largest archive, 256 chunks; the CHECK of import_jobs.declared_bytes (6.1). */
  maxBytes: 2_147_483_648,
  /** 7.3: Caddy's body limit for a chunk, its "9MB", which Caddy reads as decimal megabytes. */
  chunkBodyBytes: 9_000_000,
  /** 9.4: the app sends a chunk whose hash differed again at most this often. */
  chunkRetries: 3,
  /** 4.2 step 3, decision 21: an account imports once it is this old (import_too_soon). */
  minAccountAgeDays: 7,
  /** Decision 21: an account younger than this publishes at most newAccountMaxPosts posts per import. */
  newAccountDays: 30,
  newAccountMaxPosts: 1_000,
  /** 7.6: the limits. Published imports per account in seven days, imports created per address in a day, and per hour per account. */
  importsPerWeek: 3,
  importsPerAddressDay: 5,
  chunksPerHour: 600,
  actsPerHour: 20,
  picksPerHour: 3_000,
  /** 7.7: the default of IMPORT_MAX_ACTIVE, imports in uploading or scanning on the site at once. */
  maxActiveDefault: 2,
  /** 7.4, 7.7: IMPORT_IMAGES_PER_HOUR's default, and the most it may be set to (it may only be lowered). */
  imagesPerHourDefault: 600,
  imagesPerHourMax: 600,
  /** 7.7: the default of IMPORT_MIN_FREE_BYTES, kept free on import-archives beyond a new import's size and scanWriteBytes. */
  minFreeBytesDefault: 2_147_483_648,
  /** 4.2 step 3, 7.2: the most a scan may write to import-work. */
  scanWriteBytes: 4_294_967_296,
  /** 7.1: the importer rewrites its heartbeat this often; the API takes no new import once it is older than the second. */
  heartbeatMs: 10_000,
  heartbeatStaleMs: 60_000,
  /** 4.8, decision 4: an archive lives at most this long after its import was created (an upload not complete then expires, a scan not done fails). */
  archiveHours: 24,
  /** 4.8: a scan not done this long after the upload ended fails (scan_timed_out). */
  scanMinutes: 45,
  /** 4.8: a preview not confirmed this long after the scan ended expires. */
  previewHours: 24,
  /** 4.8, decision 19: an imported image whose check is not answered this long after its upload is left out. */
  checkHours: 24,
  /** 4.8: an import not finished this long after its scan ended is stopped; the work folder never outlives it (the terms' three days). */
  workHours: 72,
  /** 4.8, decision 25: a finished import's record stays at least this long after its end. */
  recordDays: 30,
  /** 5.3 step 7, decision 13: a longer text is skipped (too_long_to_read). */
  textMax: 30_000,
  /** Decision 13: a post over this many code points is long; shortened, it is cut to this many with its ellipsis. */
  shortenTo: 1_000,
  /** 5.4: items read, posts kept and images kept by one scan. */
  maxItems: 1_000_000,
  maxPosts: 50_000,
  maxImages: 5_000,
  /** 5.4: a date before the first tweet, or more than futureDays after the import was created, is skipped (date_out_of_range). */
  earliestDate: "2006-03-21",
  futureDays: 1,
  /** 5.5, 5.6: one JSON element of a data file, in bytes and levels (item_too_large). */
  itemMaxBytes: 1_048_576,
  itemMaxDepth: 64,
  /** 5.5: X's data/manifest.js, and the highest N of data/tweets-part<N>.js. */
  manifestMaxBytes: 1_048_576,
  tweetsPartsMax: 99,
  /** 5.7: a CAR's blocks, and its MST's levels and entries a node. */
  carBlockMaxBytes: 1_000_000,
  carMaxBlocks: 2_000_000,
  mstMaxDepth: 48,
  mstMaxEntries: 4_096,
  /** 7.2: the zip reader's limits: entries, central directory, a name, a data file, the ratio, the allowlisted entries' sum. */
  zipMaxEntries: 200_000,
  zipDirectoryMaxBytes: 67_108_864,
  zipNameMaxBytes: 512,
  zipDataMaxBytes: 1_073_741_824,
  zipMaxRatio: 100,
  zipTotalMaxBytes: 4_294_967_296,
  /** 7.1, 7.5: the file protocol's caps: job.json, summary.json, a line of posts.jsonl, and posts.jsonl (whose lines are at most maxPosts). */
  jobFileMaxBytes: 4_096,
  summaryMaxBytes: 65_536,
  lineMaxBytes: 262_144,
  postsFileMaxBytes: 1_073_741_824,
  /** 7.1: the third start of a scan fails it (interrupted); the watchdog ends a scan; the loop sleeps this long when idle. */
  maxAttempts: 3,
  watchdogMs: 1_800_000,
  idleMs: 1_000,
  /** 6.1: the CHECKs of import_jobs (refused_words in code points, scan and choice in bytes), import_picks.alts, import_keys.key and the seed. */
  refusedWordsMax: 80,
  scanMaxBytes: 262_144,
  choiceMaxBytes: 1_024,
  altsMaxBytes: 16_384,
  keyBytes: 32,
  seedBytes: 32,
  /** 7.4: imported images in processing on the site at once. */
  imagesInFlight: 2,
  /** 7.5: import-drive's interval and lock, the intake's batch of keys, a batch of posts, batches a round, the orphan pass. */
  driveIntervalMs: 5_000,
  driveLockMs: 60_000,
  keyBatch: 1_000,
  batchPosts: 200,
  publishBatchesPerRound: 10,
  undoBatchesPerRound: 5,
  orphanEveryRounds: 10,
  orphanAgeMs: 3_600_000,
  /** 9.2: lines a page of the preview, pages kept, samples and a sample's bytes, imports listed. */
  pageLines: 50,
  maxPages: 1_000,
  samples: 3,
  sampleMaxBytes: 262_144,
  listMax: 20,
};

/**
 * Every number of the design (section 9.3), as 3d's AUTOMATION_RULES holds its own: the CHECK constants of Task 2's
 * migrations mirror the ones of 6.1, a database test holds them equal, and the terms print their hours and days from
 * here (11.3). Settings that the owner may change are named for their defaults.
 */
export const IMPORT_RULES: Readonly<typeof rules> = rules;

export const IMPORT_SOURCE_KINDS = ["x", "mastodon", "bluesky"] as const;
export const ImportSource = z.enum(IMPORT_SOURCE_KINDS);
export type ImportSource = z.infer<typeof ImportSource>;

/** The twelve states of section 4.1. */
export const ImportStatus = z.enum(["uploading", "scanning", "ready", "preparing", "publishing", "done", "stopped", "undoing", "undone", "failed", "cancelled", "expired"]);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** The active states: an account has at most one import in them (import_jobs_one_active). undoing is not one. */
export const IMPORT_ACTIVE_STATES = ["uploading", "scanning", "ready", "preparing", "publishing"] as const satisfies readonly ImportStatus[];

/** Why a scan failed: import_jobs.failure's CHECK, and a failed summary's member. */
export const IMPORT_FAILURES = [
  "not_this_source",
  "not_an_archive",
  "tar_gz",
  "partial_archive",
  "encrypted",
  "too_many_entries",
  "too_large_uncompressed",
  "bad_entry_name",
  "unreadable",
  "nothing_to_import",
  "scan_timed_out",
  "interrupted",
] as const;
export const ImportFailure = z.enum(IMPORT_FAILURES);
export type ImportFailure = z.infer<typeof ImportFailure>;

/** Why an import was stopped: import_jobs.stop_reason's CHECK. */
export const IMPORT_STOP_REASONS = ["refused_image", "by_author", "by_staff", "time_ran_out"] as const;
export type ImportStopReason = (typeof IMPORT_STOP_REASONS)[number];

/**
 * Why a post is not published. reply, too_long, warning, protected and left_out are counted by the app from the month
 * table and the picks when the choice leaves them out; already_imported and new_account_cap by the intake; the rest by
 * the importer.
 */
export const IMPORT_SKIP_REASONS = [
  "repost",
  "reply",
  "too_long",
  "warning",
  "protected",
  "left_out",
  "not_public",
  "older_version",
  "poll",
  "adult_label",
  "too_long_to_read",
  "date_out_of_range",
  "item_too_large",
  "unreadable",
  "empty",
  "already_imported",
  "over_post_cap",
  "over_item_cap",
  "new_account_cap",
] as const;
export type ImportSkipReason = (typeof IMPORT_SKIP_REASONS)[number];

/** Why an image is not imported. */
export const IMPORT_IMAGE_SKIPS = ["video", "sensitive", "unsupported", "too_large", "missing_file", "bluesky_no_files", "images_off", "not_chosen", "no_description", "over_image_cap", "failed", "not_checked", "flagged"] as const;
export type ImportImageSkip = (typeof IMPORT_IMAGE_SKIPS)[number];

/**
 * A line's marks, the facts a choice decides on, as bits: IMPORT_MARKS[i] is the bit 1 << i. reply: its kind is reply;
 * long: its text is over shortenTo code points; warning and protected: the line's members of those names.
 */
export const IMPORT_MARKS = ["reply", "long", "warning", "protected"] as const;

const Count = z.int().min(0);
const Ref = z.int().min(0).max(IMPORT_RULES.maxPosts - 1);
/** A byte offset into posts.jsonl. */
const Offset = z.int().min(0).max(IMPORT_RULES.postsFileMaxBytes);
const Marks = z.int().min(0).max(2 ** IMPORT_MARKS.length - 1);
const Month = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
/** The archive's day, never its second, which with the text would fingerprint the original. */
const Day = z.iso.date();
const Kind = z.enum(["post", "thread", "reply"]);

/**
 * PostText's rule with textMax in place of POST_MAX_LENGTH, and its raw cap scaled the same way (four UTF-16 units a code
 * point). This module's refinements carry no message of their own: no person reads them (the API answers invalid_request
 * and the intake counts a line unreadable), and every byte here is in the app's web bundle.
 */
export const ImportedText = z
  .string()
  .max(IMPORT_RULES.textMax * 4)
  .transform(normalizePostBody)
  .refine((text) => !FORBIDDEN_CONTROL.test(text))
  .refine((text) => !FORBIDDEN_FORMAT.test(text))
  .refine((text) => postLength(text) <= IMPORT_RULES.textMax);
export type ImportedText = z.infer<typeof ImportedText>;

/**
 * The only names the work folder's media/ may hold: <ref>-<position>.<jpg|png|webp>, the ref without leading zeros and
 * below maxPosts, the position from 0, as refs count, and below MEDIA_MAX_PER_POST (so 0 to 3).
 */
export const ImportMediaFile = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,4})-[0-3][.](jpg|png|webp)$/)
  .refine((file) => Number.parseInt(file, 10) < IMPORT_RULES.maxPosts);
export type ImportMediaFile = z.infer<typeof ImportMediaFile>;

/** One kept post, one line of posts.jsonl (5.1). The importer writes it; the API parses every line with this schema. */
export const ImportedPost = z
  .strictObject({
    /** Its line in posts.jsonl, from 0; lines are in ascending order of `at`. */
    ref: Ref,
    /** HMAC-SHA256 of the source and the source post's id under the account's import key, as 64 lowercase hex. */
    key: z.string().regex(/^[0-9a-f]{64}$/),
    /** The date the archive gives the post, UTC, whole seconds. */
    at: z.iso.datetime({ offset: false, precision: 0 }),
    /** post: the account's own top-level post; thread: a reply to its own post; reply: a reply to someone else. */
    kind: Kind,
    /** The ref of the post a `thread` item answers, always lower than its own ref; null otherwise. */
    parent: z.int().min(0).nullable(),
    /** korbat's plain text: converted, cleaned and normalised (5.3); up to textMax code points. */
    text: ImportedText,
    /** Images in the work folder, in order; `alt` is the source's description, normalised, or null. */
    media: z.array(z.strictObject({ file: ImportMediaFile, alt: AltText.nullable() })).max(MEDIA_MAX_PER_POST),
    /** X only: dated inside a period protected-history.js marks as protected (5.5); left out unless chosen. */
    protected: z.boolean(),
    /** Mastodon only: the text begins with a content warning's line (decision 12); left out unless chosen. */
    warning: z.boolean(),
  })
  .refine((post) => (post.kind === "thread") === (post.parent !== null) && (post.parent === null || post.parent < post.ref), { path: ["parent"] })
  .refine((post) => visibleLength(post.text) >= 1 || post.media.length >= 1, { path: ["text"] })
  .refine(
    (post) => {
      const names = post.media.map(({ file }) => file.split(/[-.]/));
      return names.every(([ref]) => Number(ref) === post.ref) && new Set(names.map(([, position]) => position)).size === names.length;
    },
    { path: ["media"] },
  );
export type ImportedPost = z.infer<typeof ImportedPost>;

/** The counts a scan reports and the intake keeps: counts only, every reason from the closed lists. */
const scanCounts = {
  /** Lines written (the summary), or lines the preview offers (the intake: readable, not already imported, not over the new account's cap). */
  posts: Count.max(IMPORT_RULES.maxPosts),
  images: Count.max(IMPORT_RULES.maxImages),
  skipped: z.partialRecord(z.enum(IMPORT_SKIP_REASONS), Count),
  imagesSkipped: z.partialRecord(z.enum(IMPORT_IMAGE_SKIPS), Count),
  /**
   * Posts written whose text lost characters to 5.3 step 5, or one of whose written images' descriptions lost some or
   * became null: a post, not a character, is counted, once however much it lost (apps/importer/src/core.ts).
   */
  cleaned: Count,
  /** Posts that begin with a content warning's line (Mastodon), and links to the source platform replaced by words (5.3 step 3b). */
  warnings: Count,
  sourceLinks: Count,
  /** X posts dated inside a protected period. */
  protectedPosts: Count,
  /** The scan stopped at maxItems (over_item_cap). */
  readInPart: z.boolean(),
};

/** summary.json, the importer's last write for a scan and its commit point (7.1 step 4). The API parses it as hostile input. */
export const ImportSummary = z.discriminatedUnion("status", [
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("scanned"), ...scanCounts }),
  z.strictObject({ v: z.literal(1), id: z.uuid(), status: z.literal("failed"), failure: ImportFailure }),
]);
export type ImportSummary = z.infer<typeof ImportSummary>;

/**
 * A month table: per month, one group per set of marks that occurs, as [marks, posts, images, imagesUndescribed]. In the
 * scan: the lines the preview offers, their images, and those of their images without a source's description. In the
 * picks' counts: [marks, posts left out, images with a source's description in posts left out, images given a
 * description by a pick in posts not left out], so the app's totals stay exact.
 */
const MonthTable = z.array(z.object({ month: Month, groups: z.array(z.tuple([Marks, Count, Count, Count])).max(2 ** IMPORT_MARKS.length) }));

/**
 * What the intake stores in import_jobs.scan (6.1, 7.5 step 2). `fromRef` is the lowest ref that may be published (a
 * new account's newest lines only); `samples` the three newest lines' refs and byte offsets; `pages` every pageLines-th
 * line's byte offset. The move out of ready keeps the counts and fromRef and empties the rest. 3b Task 5 (the
 * orchestrator's ruling): the confirmation adds `chosen`, the posts and images the person's choice holds, counted from
 * the month table and the picks as the app counts them before the table is cut; the progress's totals read it.
 */
export const ImportScanFacts = z.object({
  ...scanCounts,
  months: MonthTable,
  first: Month.nullable(),
  last: Month.nullable(),
  fromRef: Ref,
  samples: z.array(z.object({ ref: Ref, offset: Offset })).max(IMPORT_RULES.samples),
  pages: z.array(Offset).max(IMPORT_RULES.maxPages),
  chosen: z.object({ posts: Count.max(IMPORT_RULES.maxPosts), images: Count.max(IMPORT_RULES.maxImages) }).optional(),
});
export type ImportScanFacts = z.infer<typeof ImportScanFacts>;

/** The person's choice (4.4): a range of months, inclusive, either end open when null; never `from` after `to`. */
export const ImportChoice = z
  .strictObject({
    from: Month.nullable(),
    to: Month.nullable(),
    replies: z.boolean(),
    warnings: z.boolean(),
    protected: z.boolean(),
    images: z.boolean(),
    long: z.enum(["leave", "shorten"]),
  })
  .refine((choice) => choice.from === null || choice.to === null || choice.from <= choice.to, { path: ["to"] });
export type ImportChoice = z.infer<typeof ImportChoice>;

/** One line of the preview's list (9.2), with the person's pick: `alts[i]` is the description written for media[i]. */
export const ImportLineView = z.object({
  ref: Ref,
  at: Day,
  kind: Kind,
  marks: Marks,
  text: z.string(),
  media: z.array(z.object({ file: ImportMediaFile, alt: z.string().nullable() })),
  leftOut: z.boolean(),
  alts: z.array(z.string().nullable()),
});
export type ImportLineView = z.infer<typeof ImportLineView>;

/** A pick (4.4): leave the line out or not, and a description for each image its source gave none, by position in media. */
export const ImportPickRequest = z.strictObject({ leftOut: z.boolean(), alts: z.array(AltText.nullable()).max(MEDIA_MAX_PER_POST) });
export type ImportPickRequest = z.infer<typeof ImportPickRequest>;

/** The pick as saved, and the picks' counts by month and marks. */
export const ImportPickView = z.object({ ref: Ref, leftOut: z.boolean(), alts: z.array(z.string().nullable()), picks: MonthTable });
export type ImportPickView = z.infer<typeof ImportPickView>;

export const CreateImportRequest = z.strictObject({ source: ImportSource, bytes: z.int().min(1).max(IMPORT_RULES.maxBytes) });
export type CreateImportRequest = z.infer<typeof CreateImportRequest>;

/** The statement (decision 14) is part of the request: without it there is nothing to confirm. */
export const ConfirmImportRequest = z.strictObject({ choice: ImportChoice, statement: z.literal(true) });
export type ConfirmImportRequest = z.infer<typeof ConfirmImportRequest>;

/**
 * An import as its owner sees it (9.3). No text but the samples (only in ready) and the refused post's first words, no
 * file name, no source id. `scan` holds the facts without their offsets; `endedByStaff` is the rule's id when an admin
 * ended it; `refusedAt` is the archive's day of the post whose image was refused. 3b Task 6: `postsLeft` counts the chosen
 * posts not yet handled while the import publishes, 0 in every other state, and `paused` is true while the author is
 * suspended and the import prepares or publishes.
 */
export const ImportView = z.object({
  id: z.uuid(),
  source: ImportSource,
  status: ImportStatus,
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  declaredBytes: z.int().min(1).max(IMPORT_RULES.maxBytes),
  receivedBytes: Count.max(IMPORT_RULES.maxBytes),
  chunkBytes: z.int().min(1),
  failure: ImportFailure.nullable(),
  stopReason: z.enum(IMPORT_STOP_REASONS).nullable(),
  endedByStaff: z.string().nullable(),
  /**
   * 3b Task 6 (the orchestrator's ruling): the decision an admin's end of the import rests on, set exactly with
   * `endedByStaff`, so the import's screen links to it under the person's Cases (10.5).
   */
  staffDecisionId: z.uuid().nullable(),
  scan: ImportScanFacts.omit({ samples: true, pages: true }).nullable(),
  samples: z.array(z.object({ at: Day, text: z.string() })).max(IMPORT_RULES.samples),
  choice: ImportChoice.nullable(),
  picks: MonthTable,
  /**
   * 3b Task 5 (the orchestrator's ruling): `imagesLeftOut` holds the images the preparation left out, by reason (the job's
   * images_left_out_by), whose counts sum to the settled images that were not kept, for the result's notice.
   */
  progress: z.object({
    imagesTotal: Count,
    imagesSettled: Count,
    postsTotal: Count,
    postsPublished: Count,
    postsRemoved: Count,
    postsLeft: Count,
    imagesLeftOut: z.partialRecord(z.enum(IMPORT_IMAGE_SKIPS), Count),
  }),
  paused: z.boolean(),
  refusalId: z.uuid().nullable(),
  refusedAt: Day.nullable(),
  refusedWords: z.string().nullable(),
  undoable: z.boolean(),
});
export type ImportView = z.infer<typeof ImportView>;

/**
 * Every code the imports endpoints add to ErrorEnvelope.error.code; rate_limited, account_suspended and not_found are shared.
 * import_weekly_limit is the account's three published imports in seven days (import-week), a code of its own so the app
 * says that and not the per-address limit's words, which rate_limited carries (the orchestrator's ruling for Task 4).
 */
export const ImportErrorCode = z.enum([
  "imports_unavailable",
  "import_active",
  "rate_limited",
  "import_weekly_limit",
  "archive_too_large",
  "wrong_state",
  "wrong_offset",
  "chunk_too_large",
  "chunk_mismatch",
  "not_an_archive",
  "statement_required",
  "nothing_chosen",
  "import_too_soon",
  "account_suspended",
  "not_found",
]);
export type ImportErrorCode = z.infer<typeof ImportErrorCode>;
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 *    The console's case routes (the overview, the queue, a case, the appeals) answer the same two ways, and
 *    the console's site answers the app's own moderation routes with 404 itself.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, no fingerprint of it is stored while MEDIA_MATCH is off (3d Task 7), and large.webp is
 *    served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, reports the first account's post under a rule
 *     (its own list of reports shows the report undecided, and no decision is about it), downloads its
 *     export as a ZIP whose export.json ends with the moderation member holding that report and, since 3b, the
 *     account's imports (none), posts, and deletes itself with a code read from Mailpit and its handle typed;
 *     afterwards its profile is not found, its session is gone, and its post has left the Latest timeline.
 * 15. Signed out, a notice that the first account's post is illegal is taken through the app's site with the
 *     human check: it answers a reference and a token. The status page opens with that token and shows the
 *     post's link, undecided, and the contact as given; another token finds no notice. The receipt arrives in
 *     Mailpit under the reference, and the token in its link opens the same page with the address not yet
 *     confirmed. Nothing here decides the case: a decision needs a staff key.
 * 16. With --push (3f, the stack under the Compose profile notify): the phones' push site answers 404 itself to ntfy's
 *     /v1/config, /v1/stats and /v1/account and to a publish, and hands a topic's subscription to ntfy, which refuses
 *     it without a user (403); from inside the ntfy container, on the push network, the app's and the console's sites
 *     answer 403. The contact point's routes (/api/staff/contact) stand behind the console's two doors like the case
 *     routes, in step 2.
 * 17. 3f: a post's page (/post/<id>) answers the app's shell with 200 while the post is public and the same bytes, with
 *     the same security headers, with 404 once its author deleted it, and 404 for a post that does not exist or a
 *     malformed id: Caddy asks the API's status route, GET /api/posts/<id>/status, which answers 204 or 404 with no body.
 * 18. With --closed (3f, the stack started with APP_SITE=closed, as for a restore): every path of the app's site, the
 *     API's included, answers 503 with Caddy's one sentence, the console's site still serves its page, and nothing else
 *     runs, since nothing else can be reached through the app's site.
 * 19. 3d Task 4: GET /api/public/facts answers no-cache and names every tool off (the R1 check, the comparison with
 *     known material, the edge and the head's witness). A status code proves nothing about the two public pages, since
 *     the web export is one page and Caddy answers every unknown path with its shell: so the lead sentences of the rules
 *     page and of the transparency page are looked for in the bundle Caddy serves under /_expo/, which proves they were
 *     built in (the app's render tests prove the pages). An app test holds the two sentences here to the pages' own.
 * 20. UI Task 3: the app's page and the files it loads first, as Caddy serves them: / answers 200 with no-cache;
 *     /theme-boot.js, the script that paints the reader's theme before the bundle, answers 200 with no-cache like the
 *     page; the first font file the entry bundle names (a hashed /assets/__node_modules/@fontsource-variable/... woff2)
 *     answers 200 with public, max-age=31536000, immutable; and a post's page answers 200 while the post is public and
 *     404 for a post that does not exist (step 17 checks the rest of the post's page).
 * 21. 3b Tasks 4 and 8: the whole import, before the grant-role step while the first account's session works: the account
 *     aged past seven days through psql in the postgres container, a Mastodon archive built here with fflate's zipSync
 *     (four public posts, a followers-only one and a boost beside a 9 MiB file korbat never opens), created and sent in
 *     chunks of 8 MiB with their SHA-256 through Caddy, the real importer's scan read by import-drive until the import is
 *     ready with its counts and its three samples, the archive gone once read; the importer healthy with only a loopback
 *     interface and 512 MiB. Then confirmed (POST /api/imports/:id/confirm) with every choice off or open, long posts left
 *     out and the statement; images are off in the stack, so it publishes at once, and import-drive's rounds every five
 *     seconds publish the four posts until it is done. The profile's Imported tab (GET /api/profiles/<handle>/imported)
 *     holds them, newest first by the archive's day, each labelled as imported from Mastodon with its day; the profile
 *     shows the tab (hasImported) and counts four more posts, and Latest holds none of them. Last, Remove imported posts
 *     (POST /api/imports/:id/undo) runs until the import is undone: the tab is empty, the profile no longer shows it and
 *     counts as before. The stack needs the archive's size, 4 GiB and IMPORT_MIN_FREE_BYTES free on Docker's disk.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Every run leaves its first account, by then a moderator, and one open case on that account's post, in the lane
 * that is read last, with a report and a notice that no run can decide. One network may run it five times an hour
 * and five times a day: its two sign-ups count against the hourly sign-up limit, its signed-out notice against the
 * limits of reports sent without an account, and its import against the five imports started from one address in a
 * day (3b's import-address-day).
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
// 3f: the phones' push site (Caddy's third site), only while the stack runs with the Compose profile notify.
const pushBase = option("push");
// 3f: the app's site closed by APP_SITE=closed (step 18).
const closed = options.includes("--closed");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] [--push <url>] [--closed] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");
/** The fflate the API depends on: the export's archive is opened with the library the API's own tests open it with. */
const { strFromU8, strToU8, unzipSync, zipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/** What a failed human check answers: the sign-in routes' code, and the code of a report sent signed out. */
const HUMAN_CHECK_REFUSALS = ["turnstile_failed", "human_check_failed"];

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (HUMAN_CHECK_REFUSALS.includes(result.body?.error?.code) && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type, ifNoneMatch } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** The headers a page's security rests on, which Caddy sets the same on every answer of the app's page. */
const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cache-control"];

/**
 * 3f (design, section 7.12): a post's page as a browser or a checker asks for it, through Caddy: its status, its media
 * type, its bytes and the security headers.
 */
async function postPage(postId) {
  const res = await fetch(`${base}/post/${postId}`, { headers: { accept: "text/html" } });
  const security = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, res.headers.get(name) ?? undefined]));
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()), security };
}

/**
 * 3f (step 18): the app's site closed by APP_SITE=closed answers every path, the API's included, with 503 and Caddy's
 * one sentence; the console's site is not touched.
 */
async function closedSite() {
  for (const path of ["/", `/post/${randomUUID()}`, "/api/health", "/api/me", "/api/staff/me", "/assets/none.js"]) {
    const res = await send(path);
    check(`3f: with APP_SITE=closed, ${path} answers 503 with the fixed sentence`, res.status === 503 && res.bytes.toString("utf8") === "korbat is closed for maintenance. Please come back later.", `HTTP ${res.status}`);
  }
  const page = await fetch(`${consoleBase}/`);
  await page.arrayBuffer();
  check("3f: the console's site still serves its page", page.status === 200, `HTTP ${page.status}`);
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

/**
 * 3d Task 3 (design, sections 2 row 12 and 7.4): the header of a public image, which the API builds from the contracts'
 * EDGE_CACHE: a browser's minute, an edge's five minutes, revalidated and never stale.
 */
const PUBLIC_IMAGE_CACHE = "public, max-age=60, s-maxage=300, must-revalidate, stale-if-error=0";

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");
  // 3d Task 7 (design, section 7.8; row 10): with every adapter off (MEDIA_MATCH=off) nothing is hashed: no row of
  // media_hashes exists for the upload. Read as the database's owner inside its own container, which the id alone reaches.
  const hashed = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from public.media_hashes where media_id = '${id}'"`);
  check("3d: with MEDIA_MATCH off no media_hashes row exists for it", hashed === "0", hashed);

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, served);
  // 3d Task 3 (design, section 7.4): the 304 of a public image carries the same header through Caddy.
  const revalidated = await send(large, { ifNoneMatch: file.headers.get("etag") ?? "" });
  check("3d: its 304 carries the same header", revalidated.status === 304 && revalidated.headers.get("cache-control") === PUBLIC_IMAGE_CACHE, `HTTP ${revalidated.status}, ${revalidated.headers.get("cache-control")}`);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const shown = await postPage(created.body.id);
  check("3f: the post's page answers the app's shell with 200 while the post is public", shown.status === 200 && shown.type === "text/html; charset=utf-8", `HTTP ${shown.status}, ${shown.type}`);
  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const gone = await postPage(created.body.id);
  check("3f: once deleted, its page answers the same shell with 404, never 451", gone.status === 404 && gone.bytes.equals(shown.bytes), `HTTP ${gone.status}`);
  check("3f: the same security headers on both answers", isDeepStrictEqual(gone.security, shown.security) && shown.security["content-security-policy"] !== undefined, JSON.stringify(gone.security));
  const missing = await postPage(randomUUID());
  const malformed = await postPage("not-a-post");
  check("3f: a post that does not exist and a malformed id answer 404 with the shell", missing.status === 404 && malformed.status === 404 && missing.bytes.equals(shown.bytes), `HTTP ${missing.status}, ${malformed.status}`);
  const status = await send(`/api/posts/${created.body.id}/status`);
  check("3f: the API's status route answers 404 with no body for the deleted post", status.status === 404 && status.bytes.length === 0, `HTTP ${status.status}, ${status.bytes.length} bytes`);
  const after = await send(large);
  check("its image is no longer served, and its 404 may be cached by nobody", after.status === 404 && after.headers.get("cache-control") === "no-store", `HTTP ${after.status}, ${after.headers.get("cache-control")}`);
  const unknown = await send(`/api/media/${randomUUID()}/large.webp`);
  check("3d: an image that does not exist answers 404 with no-store", unknown.status === 404 && unknown.headers.get("cache-control") === "no-store", `HTTP ${unknown.status}, ${unknown.headers.get("cache-control")}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);

  // The console's case routes (3c design, section 12) stand behind the same two doors: the overview, the queue, a case
  // and the appeals, and since account sanctions (3e design, section 12.2) the Standing screen's lists. The staff session
  // is asked for before anything of the request is read, so a case that does not exist answers like the others.
  // 3f: the contact point's list too.
  const caseRoutes = ["/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${randomUUID()}`, "/api/staff/appeals", "/api/staff/standing", "/api/staff/contact"];
  const answers = (list) => list.map((answer, index) => `${caseRoutes[index]}: ${answer.summary}`).join("; ");
  const casesOnApp = await Promise.all(caseRoutes.map((path) => getJson(`${base}${path}`)));
  check(
    "the app's site refuses the console's case routes itself, with 404",
    casesOnApp.every((answer) => answer.status === 404 && answer.body?.error?.code === "not_found" && answer.body.error.requestId === undefined),
    answers(casesOnApp),
  );
  const casesOnConsole = await Promise.all(caseRoutes.map((path) => getJson(`${consoleBase}${path}`)));
  check(
    "signed out, the console's site answers its case routes with 401 staff_session_required",
    casesOnConsole.every((answer) => answer.status === 401 && answer.body?.error?.code === "staff_session_required"),
    answers(casesOnConsole),
  );
  // And the other way round: the console's site proxies the staff API and nothing else, so the app's own moderation
  // routes are answered there by Caddy, never by the API.
  const appRoute = await getJson(`${consoleBase}/api/moderation/cases`);
  check("the console's site refuses the app's moderation routes itself, with 404", appRoute.status === 404 && appRoute.body?.error?.code === "not_found" && appRoute.body.error.requestId === undefined, appRoute.summary);
}

/**
 * The phones' push site (3f design, sections 5 and 12.2, with --push). Caddy hands ntfy only the two topics'
 * subscriptions: every path of ntfy's own API answers Caddy's 404 (ntfy's /v1/config and /v1/stats answer any caller
 * otherwise), and so does a publish; a subscription without a user reaches ntfy, whose deny-all answers 403. And from
 * inside the ntfy container, on the push network, the app's and the console's sites refuse the request with 403: until the
 * push site, only cloudflared could reach Caddy.
 */
async function pushSite() {
  for (const path of ["/v1/config", "/v1/stats", "/v1/account", "/v1/health", "/", "/korbat-all"]) {
    const res = await fetch(`${pushBase}${path}`);
    check(`the push site answers ${path} with 404 itself`, res.status === 404 && res.headers.get("server") === null, `HTTP ${res.status}`);
  }
  const publish = await fetch(`${pushBase}/korbat-all`, { method: "POST", body: "a publish from outside" });
  check("the push site refuses a publish with 404", publish.status === 404, `HTTP ${publish.status}`);
  const subscribe = await fetch(`${pushBase}/korbat-oncall,korbat-all/json?poll=1`);
  const refusal = await subscribe.json().catch(() => null);
  check("a subscription without a user reaches ntfy, which refuses it", subscribe.status === 403 && refusal?.code === 40301, `HTTP ${subscribe.status} ${JSON.stringify(refusal)}`);
  for (const [site, port] of [["app's", 8080], ["console's", 8090]]) {
    const answer = inside("ntfy", `wget -q -S -O /dev/null http://caddy:${port}/ 2>&1; true`);
    check(`from the push network the ${site} site answers 403`, / 403 /.test(answer), answer.split(String.fromCharCode(10))[0]);
  }
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
/** The lead sentences of /rules and /transparency (RULES_PAGE.lead and TRANSPARENCY_PAGE.lead), held to them by an app test. */
const RULES_LEAD =
  "These are all of korbat's rules. korbat restricts content when it breaks one of them, or when it is illegal under EU law or the law of an EU country and korbat is told about it in a notice. Opinions are never a reason. Every decision names one of these rules or the law, and its statement shows the rule as it read on the day of the decision.";
const TRANSPARENCY_LEAD =
  "What korbat's moderators, its programs and authorities' orders did, in numbers. korbat publishes counts and never a decision: on a service this small, a list of decisions would point at people. Whoever a decision concerns gets its full reasons from korbat directly.";

/** Step 19 (3d Task 4): the facts of a stack with every adapter off, and the two pages' lead sentences in the bundle. */
async function publicPages() {
  const res = await fetch(`${base}/api/public/facts`);
  const facts = await res.json().catch(() => null);
  check("3d: GET /api/public/facts answers no-cache", res.status === 200 && res.headers.get("cache-control") === "no-cache", `HTTP ${res.status}, ${res.headers.get("cache-control")}`);
  check(
    "3d: the facts name every tool off: the R1 check, the comparison with known material, the edge and the witness",
    facts?.r1?.state === "off" && facts?.match?.state === "off" && facts?.edge?.on === false && facts?.witness?.on === false,
    JSON.stringify(facts),
  );
  const shell = await (await fetch(`${base}/`)).text();
  const scripts = [...shell.matchAll(/<script[^>]* src="([^"]+)"/g)].map((match) => match[1]).filter((src) => src.startsWith("/_expo/"));
  if (!check("3d: the app's shell loads its bundle from /_expo/", scripts.length > 0, `${scripts.length} scripts`)) return;
  // A minifier may write an apostrophe inside a string escaped; the sentence is looked for with it read back.
  const escapedQuote = `${String.fromCharCode(92)}'`;
  let bundle = "";
  for (const src of scripts) bundle += (await (await fetch(`${base}${src}`)).text()).replaceAll(escapedQuote, "'");
  check("3d: the rules page's lead sentence is in the bundle Caddy serves", bundle.includes(RULES_LEAD));
  check("3d: the transparency page's lead sentence is in the bundle Caddy serves", bundle.includes(TRANSPARENCY_LEAD));
}

/**
 * Step 20 (UI Task 3): the app's page, theme-boot.js, the first font the entry bundle names and a post's page, each with
 * its status and caching. `postId` is a public post's.
 */
async function appShell(postId) {
  const page = await send("/");
  check("UI: / answers the app's page with no-cache", page.status === 200 && page.headers.get("cache-control") === "no-cache", `HTTP ${page.status}, ${page.headers.get("cache-control")}`);
  const boot = await send("/theme-boot.js");
  check("UI: /theme-boot.js answers 200 with no-cache, like the page", boot.status === 200 && boot.headers.get("cache-control") === "no-cache", `HTTP ${boot.status}, ${boot.headers.get("cache-control")}`);
  const entry = /<script[^>]* src="(\/_expo\/static\/js\/web\/[^"]+\.js)"/.exec(page.bytes.toString("utf8"))?.[1];
  if (!check("UI: the page names its entry bundle", entry !== undefined)) return;
  const bundle = (await send(entry)).bytes.toString("utf8");
  // On web Metro's require of a font yields its hashed address as a string, which the bundle carries (Task 1).
  const font = /\/assets\/__node_modules\/@fontsource-variable\/[a-z-]+\/files\/[a-z0-9-]+\.[0-9a-f]+\.woff2/.exec(bundle)?.[0];
  const file = font === undefined ? null : await send(font);
  check(
    "UI: the first font the bundle names answers 200, public, max-age=31536000, immutable",
    file?.status === 200 && file.headers.get("cache-control") === "public, max-age=31536000, immutable",
    font === undefined ? "no font in the bundle" : `${font}: HTTP ${file?.status}, ${file?.headers.get("cache-control")}`,
  );
  const shown = await postPage(postId);
  const missing = await postPage(randomUUID());
  check("UI: a public post's page answers 200 and a missing post's 404", shown.status === 200 && missing.status === 404, `HTTP ${shown.status}, ${missing.status}`);
}

async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/** A notice's public reference: N- and ten base32 characters. */
const NOTICE_REF = /^N-[A-Z2-7]{10}$/;

/** One line about a report's items as a status answer or a list gives them: how many, and each one's link and outcome. */
const itemsSummary = (items) => (Array.isArray(items) ? `${items.length} item(s): ${items.map((item) => `${item?.link} -> ${item?.outcome}`).join(", ")}` : "no items");
/** Whether these are exactly one item, about this post by its korbat link, with no outcome shown yet. */
const onePostUndecided = (items, postId) => Array.isArray(items) && items.length === 1 && typeof items[0]?.link === "string" && items[0].link.endsWith(`/post/${postId}`) && items[0].outcome === null;

/**
 * A report under a rule from a signed-in account (3c design, sections 7.1, 7.6 and 12), about another account's post:
 * it needs no human check and answers a reference without a token, since the account's own list follows it. That list
 * then shows the report with its one item undecided, and the account's list of decisions is empty. Answers the
 * reference, or null when the report was not taken.
 */
async function signedInReport(postId, token) {
  const reported = await api("/api/notices", { json: { ground: "rule", ruleId: "R6", targets: [{ kind: "post", id: postId }], explanation: "Sent by the smoke test." }, token });
  const ref = reported.body?.ref;
  if (!check("a signed-in report under a rule is taken: a reference and no token", reported.status === 201 && NOTICE_REF.test(ref ?? "") && reported.body.token === undefined, reported.summary)) return null;
  const reports = await api("/api/moderation/reports", { token });
  const mine = reports.body?.reports?.[0];
  check("the account's list of reports shows it, undecided", reports.status === 200 && mine?.ref === ref && onePostUndecided(mine.items, postId), `${reports.summary}, ${itemsSummary(mine?.items)}`);
  const cases = await api("/api/moderation/cases", { token });
  check("no decision is about the account", cases.status === 200 && Array.isArray(cases.body?.decisions) && cases.body.decisions.length === 0 && cases.body.nextCursor === null, cases.summary);
  return ref;
}

/**
 * The export's moderation member (3c design, section 7.11), read from the archive itself: export.json's member before
 * the last, with no decision about this account and the one report it sent, under its reference and its ground, its item
 * undecided. Since 3b Task 6 the last member is `imports` (3b design, section 11.2), empty for this account, which
 * imported nothing.
 */
function exportedModeration(archive, reportRef, postId) {
  let document = null;
  try {
    document = JSON.parse(strFromU8(unzipSync(new Uint8Array(archive))["export.json"]));
  } catch {
    document = null;
  }
  const moderation = document?.moderation;
  const last = document === null ? "export.json could not be read" : `last members ${Object.keys(document).slice(-2).join(", ")}`;
  const ends = document !== null && isDeepStrictEqual(Object.keys(document).slice(-2), ["moderation", "imports"]) && isDeepStrictEqual(document.imports, []);
  if (!check("export.json ends with the moderation member, its decisions and its reports, then the account's imports, none", ends && Array.isArray(moderation?.decisions) && Array.isArray(moderation?.reports), last)) return;
  const own = moderation.reports[0];
  check(
    "the export holds no decision and the account's one report, undecided",
    reportRef !== null && moderation.decisions.length === 0 && moderation.reports.length === 1 && own?.ref === reportRef && own.ground === "rule" && own.ruleId === "R6" && onePostUndecided(own.items, postId) && own.items[0].reexaminationOpen === null,
    `${moderation.decisions.length} decision(s), ${moderation.reports.length} report(s), ${itemsSummary(own?.items)}`,
  );
}

/** The newest message to `to` in Mailpit whose subject is `subject`, read whole; null when none arrives within half a minute. */
async function mailTo(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const found = list.messages?.find((message) => message.Subject === subject);
    if (found) return (await fetch(`${mailpit}/api/v1/message/${found.ID}`)).json();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * A notice sent signed out, through the app's site (3c design, sections 7.1, 7.2 and 12): an Article 16 notice that the
 * first account's post is illegal, in a category of the lane that is read last, so that no urgent alert goes out, with a
 * name and an address. The human check is Turnstile's, with the test secret that passes any token. It answers a
 * reference and the notice's own token, which opens the status page; the receipt goes to the address at once, and the
 * token in its link opens the same page and shows what korbat knows of the address. A token travels in a POST's body,
 * never in an address.
 */
async function signedOutNotice(postId) {
  const notifier = `notifier-${randomUUID()}@korbat.local`;
  const notice = {
    ground: "illegal",
    category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
    explanation: "Sent by the smoke test: nothing is wrong with this post.",
    bonaFide: true,
    name: "Smoke Test",
    email: notifier,
    targets: [{ kind: "post", id: postId }],
    turnstileToken: TURNSTILE_TOKEN,
  };
  const sent = await withTurnstile("/api/notices", notice);
  const ref = sent.body?.ref;
  const token = sent.body?.token;
  if (!check("signed out, a notice of illegality is taken through the app's site: a reference and a token", sent.status === 201 && NOTICE_REF.test(ref ?? "") && typeof token === "string" && token.length === 43, sent.summary)) return;

  const status = await api("/api/notices/status", { json: { ref, token } });
  check("its status page opens with the token and shows the post's link, undecided", status.status === 200 && status.body?.ref === ref && onePostUndecided(status.body.items, postId), `${status.summary}, ${itemsSummary(status.body?.items)}`);
  // Opened with the notice's own token, the page says that a contact was given and nothing of what korbat knows about the address.
  const contact = status.body?.contact;
  check("the page says that a contact was given, and no more", contact?.given === true && contact.confirmed === null && contact.stopped === null, JSON.stringify(contact ?? null));
  const other = await api("/api/notices/status", { json: { ref, token: randomBytes(32).toString("base64url") } });
  check("another token finds no notice", other.status === 404 && other.body?.error?.code === "notice_not_found", other.summary);

  const receipt = await mailTo(notifier, `korbat received your report ${ref}`);
  if (!check("the receipt arrives in Mailpit under the notice's reference", receipt !== null && typeof receipt.Text === "string" && receipt.Text.includes(ref), receipt === null ? "no receipt within 30 s" : "a receipt without the reference")) return;
  // The mail's link carries the contact's mail token in its fragment, which no server log sees.
  const mailToken = /[/]notice[/]N-[A-Z2-7]{10}#t=([A-Za-z0-9_-]{43})/.exec(receipt.Text)?.[1];
  if (!check("the receipt links to the notice's page with a token of its own", typeof mailToken === "string" && mailToken !== token)) return;
  const byMail = await api("/api/notices/status", { json: { ref, token: mailToken } });
  const known = byMail.body?.contact;
  check(
    "the mail's token opens the same page, with the address not yet confirmed and not stopped",
    byMail.status === 200 && byMail.body?.ref === ref && onePostUndecided(byMail.body.items, postId) && known?.given === true && known.confirmed === false && known.stopped === false,
    `${byMail.summary}, ${JSON.stringify(known ?? null)}`,
  );
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session. On its
 * way it reports the first account's post, and its export shows that report.
 */
async function accountLifecycle(reportedPostId) {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const reportRef = await signedInReport(reportedPostId, token);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  if (zip) exportedModeration(exported.bytes, reportRef, reportedPostId);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

/** 3b (design, section 7.3): IMPORT_RULES.chunkBytes, the size of every chunk but an archive's last. */
const IMPORT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Step 21's archive: what the Mastodon adapter reads (outbox.json, and the name of actor.json) and a file of 9 MiB it
 * never opens, so the upload takes two chunks. Four public Notes, one followers-only Note and one boost; the newest three
 * public ones are the samples. Nothing of it is a real person's: every name is the script's own.
 */
function mastodonArchive() {
  const actor = "https://smoke.korbat.test/users/smoke";
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
  const note = (n, to, published) => ({
    type: "Create",
    object: { type: "Note", id: `${actor}/statuses/${n}`, attributedTo: actor, published, to, cc: [], content: `<p>Smoke test post ${n}</p>` },
  });
  const outbox = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "OrderedCollection",
    orderedItems: [
      note(1, [PUBLIC], "2019-03-01T10:00:00Z"),
      note(2, [PUBLIC], "2019-03-02T10:00:00Z"),
      note(3, [`${actor}/followers`], "2019-03-03T10:00:00Z"),
      note(4, [PUBLIC], "2019-04-04T10:00:00Z"),
      { type: "Announce", object: `${actor}/statuses/1` },
      note(5, [PUBLIC], "2019-05-05T10:00:00Z"),
    ],
  };
  return zipSync(
    {
      "outbox.json": strToU8(JSON.stringify(outbox)),
      "actor.json": strToU8(JSON.stringify({ type: "Person", id: actor })),
      // Random bytes do not compress: stored, they make the archive larger than one chunk.
      "filler.bin": [new Uint8Array(randomBytes(9 * 1024 * 1024)), { level: 0 }],
    },
    { level: 6 },
  );
}

/** The importer's container: its memory limit, its restarts and its health. */
function importerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "importer"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.Health.Status}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), health: fields[2] };
}

/**
 * Reads an import every second while its state is one of `moving`, for at most two minutes, the scan's bound: import-drive
 * runs a round every five seconds, and the smoke archive's four posts are one batch. Answers the last view read.
 */
async function waitImport(id, token, moving) {
  let view = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    view = (await api(`/api/imports/${id}`, { token })).body;
    if (!moving.includes(view?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return view;
}

/** The posts of a profile's Imported tab, as [text, label] in the tab's order; null when the tab does not answer a page. */
async function importedTab(handle) {
  const tab = await api(`/api/profiles/${handle}/imported`);
  return Array.isArray(tab.body?.items) ? tab.body.items.map((post) => [post.body, post.imported]) : null;
}

/**
 * Step 21 (3b Tasks 4 and 8): an archive uploaded in chunks through Caddy and scanned by the real importer; the import
 * confirmed and published on the profile's Imported tab, then removed again with the person's own undo.
 */
async function importArchive(token) {
  const aged = inside("postgres", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "update public.profiles set created_at = now() - interval '8 days' where handle = '${handle}' returning 1"`);
  if (!check("3b: the account is aged past the import's seven days", aged.split(String.fromCharCode(10))[0] === "1", aged)) return;
  const archive = mastodonArchive();
  const created = await api("/api/imports", { json: { source: "mastodon", bytes: archive.length }, token });
  if (!check("3b: an import is created, uploading", created.status === 201 && created.body?.status === "uploading" && created.body?.chunkBytes === IMPORT_CHUNK_BYTES, created.summary)) return;
  const id = created.body.id;
  let received = 0;
  for (let at = 0; at < archive.length; at += IMPORT_CHUNK_BYTES) {
    const chunk = archive.subarray(at, Math.min(archive.length, at + IMPORT_CHUNK_BYTES));
    const res = await fetch(`${base}/api/imports/${id}/archive`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "import-offset": String(at), "import-chunk-sha256": createHash("sha256").update(chunk).digest("hex") },
      body: chunk,
    });
    const answer = await res.json().catch(() => null);
    if (!check(`3b: a chunk of ${chunk.length} bytes at ${at} is taken through Caddy`, res.status === 200 && answer?.receivedBytes === at + chunk.length, `HTTP ${res.status}${answer?.error?.code ? ` ${answer.error.code}` : ""}`)) return;
    received = answer.receivedBytes;
  }
  check("3b: the whole archive arrived, in more than one chunk", received === archive.length && archive.length > IMPORT_CHUNK_BYTES, `${received} of ${archive.length} bytes`);
  const view = await waitImport(id, token, ["uploading", "scanning"]);
  if (!check("3b: the importer's scan is read and the import is ready", view?.status === "ready", `${view?.status ?? "no answer"}${view?.failure ? ` ${view.failure}` : ""}`)) return;
  const scan = view.scan;
  check(
    "3b: its counts: four posts from March to May 2019, the followers-only post and the boost skipped",
    scan?.posts === 4 && scan.skipped?.not_public === 1 && scan.skipped?.repost === 1 && scan.first === "2019-03" && scan.last === "2019-05",
    JSON.stringify(scan),
  );
  check(
    "3b: its three samples, newest first, by day",
    isDeepStrictEqual(view.samples, [
      { at: "2019-05-05", text: "Smoke test post 5" },
      { at: "2019-04-04", text: "Smoke test post 4" },
      { at: "2019-03-02", text: "Smoke test post 2" },
    ]),
    JSON.stringify(view.samples),
  );
  check("3b: the archive was deleted once its scan was read", inside("api", `test -e /import/archives/jobs/${id} && echo present || echo gone`) === "gone");
  const importer = importerState();
  check("3b: the importer is healthy and has never restarted", importer.health === "healthy" && importer.restarts === 0, `${importer.health}, restarts ${importer.restarts}`);
  const interfaces = inside("importer", "ls -x /sys/class/net");
  check("3b: the importer has only a loopback interface", interfaces === "lo", interfaces);
  check("3b: the importer's memory limit is 512 MiB", importer.memory === 512 * 1024 * 1024, `${importer.memory} bytes`);

  // Task 8: the rest of the import. The profile's post count before it, which the four posts raise and the undo lowers again.
  const before = (await api(`/api/profiles/${handle}`)).body;
  check("3b: before the import the profile shows no Imported tab", before?.hasImported === false, JSON.stringify(before?.hasImported));
  // Every choice off or open, long posts left out (none is long), and the statement, without which nothing is confirmed.
  // Images are off in the stack (IMPORT_IMAGES needs a matcher), so the confirmation goes straight to publishing.
  const choice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };
  const confirmed = await api(`/api/imports/${id}/confirm`, { json: { choice, statement: true }, token });
  if (!check("3b: the import is confirmed with the statement and publishes", confirmed.status === 200 && ["publishing", "done"].includes(confirmed.body?.status), `${confirmed.summary} ${confirmed.body?.status ?? ""}`)) return;
  const done = await waitImport(id, token, ["publishing"]);
  if (!check("3b: import-drive publishes the four posts and the import is done", done?.status === "done" && done.progress?.postsPublished === 4, `${done?.status ?? "no answer"}, ${done?.progress?.postsPublished ?? "?"} published`)) return;
  const label = (at) => ({ source: "mastodon", at, shortened: false });
  const published = [
    ["Smoke test post 5", label("2019-05-05")],
    ["Smoke test post 4", label("2019-04-04")],
    ["Smoke test post 2", label("2019-03-02")],
    ["Smoke test post 1", label("2019-03-01")],
  ];
  const tab = await importedTab(handle);
  check("3b: the Imported tab holds the four posts, newest first by the archive's day, each imported from Mastodon on its day", isDeepStrictEqual(tab, published), JSON.stringify(tab));
  const shown = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile shows its Imported tab and counts four more posts", shown?.hasImported === true && shown.counts?.posts === before?.counts?.posts + 4, `hasImported ${shown?.hasImported}, ${before?.counts?.posts} then ${shown?.counts?.posts} posts`);
  const latest = await api("/api/timeline/latest");
  const leaked = Array.isArray(latest.body?.items) ? latest.body.items.filter((item) => item.post?.imported != null || published.some(([text]) => item.post?.body === text)).length : -1;
  check("3b: Latest holds none of the imported posts", leaked === 0, `${latest.summary}, ${leaked} imported`);

  const undo = await api(`/api/imports/${id}/undo`, { method: "POST", token });
  if (!check("3b: Remove imported posts is taken", undo.status === 200 && ["undoing", "undone"].includes(undo.body?.status), `${undo.summary} ${undo.body?.status ?? ""}`)) return;
  const undone = await waitImport(id, token, ["undoing"]);
  check("3b: import-drive removes the four posts and the import is undone", undone?.status === "undone" && undone.progress?.postsRemoved === 4, `${undone?.status ?? "no answer"}, ${undone?.progress?.postsRemoved ?? "?"} removed`);
  const emptied = await importedTab(handle);
  check("3b: the Imported tab is empty again", Array.isArray(emptied) && emptied.length === 0, JSON.stringify(emptied));
  const after = (await api(`/api/profiles/${handle}`)).body;
  check("3b: the profile no longer shows the tab and counts its posts as before", after?.hasImported === false && after.counts?.posts === before?.counts?.posts, `hasImported ${after?.hasImported}, ${after?.counts?.posts} posts`);
}

async function main() {
  if (closed) return closedSite();
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  if (pushBase) await pushSite();
  await explore();
  await publicPages();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);
  // Account sanctions (3e design, section 12.2): an onboarded account's standing, read fresh, holds no strike, no
  // measure, no restriction of reporting and no retired handle. A suspension needs a staff key: the walk-through's.
  const noStanding = { activeStrikes: 0, measure: null, reporting: null, handleRetired: false };
  check("/api/me carries the new account's standing: no strike, no measure, no restriction", isDeepStrictEqual(me.body?.standing, noStanding), JSON.stringify(me.body?.standing));

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);
  await appShell(created.body?.id);

  await images(token);
  if (worstCase) await worstCaseImages(token);
  await importArchive(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);

  // The post both the signed-in report and the signed-out notice name: the first account's, which is still there.
  const reportedPostId = created.body?.id;
  if (!check("the first account's post can be reported", typeof reportedPostId === "string")) return;
  await accountLifecycle(reportedPostId);
  await signedOutNotice(reportedPostId);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
// With --closed the run is a few requests long, and Node on Windows aborts (a libuv assertion, exit 127) when the process
// is ended while fetch's idle connections are still closing. So that run sets its code and ends when they have closed,
// a few seconds later; the full run, which holds other handles open, ends here as before.
if (closed) process.exitCode = failures === 0 ? 0 : 1;
else process.exit(failures === 0 ? 0 : 1);
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm -r --if-present run test --testTimeout=60000
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/db test:       Tests  112 passed (112)
packages/contracts test:       Tests  501 passed (501)
packages/media-protocol test:       Tests  26 passed (26)
packages/rules test:       Tests  134 passed (134)
packages/import-protocol test:       Tests  35 passed | 2 skipped (37)
apps/admin test:       Tests  610 passed (610)
apps/worker test:       Tests  52 passed (52)
apps/app test:       Tests  712 passed (712)
apps/importer test:       Tests  143 passed (143)
apps/api test:       Tests  981 passed | 1861 skipped (2842)
```

## Step 6: verify: admin-build

```bash
pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}[.]/-HASH./'
```

Expected output contains:

- `Build success`
- `index.html`
- `main-HASH.js`
- `main-HASH.css`

Observed on the dry run:

```text
Build success
index.html
main-HASH.js
main-HASH.css
```

## Step 7: verify: test-database-fresh

```bash
node scripts/test-db.mjs --fresh -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `test database ready: korbat_test`

Observed on the dry run:

```text
test database ready: korbat_test
```

## Step 8: verify: integration-fresh

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1855 passed | 4 skipped (1859)
```

## Step 9: verify: test-database-upgrade

```bash
node scripts/test-db.mjs --upgrade-from 42 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations up to 0042_review_words applied and committed`
- `later migrations applied as one batch`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations up to 0042_review_words applied and committed
later migrations applied as one batch
test database ready: korbat_test
```

## Step 10: verify: integration-upgraded

```bash
cd apps/api && set -a && . ./.env && set +a && node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --retry=2 --testTimeout=20000 -t '^(?!.*(differ by less than 50 ms|sign-in timing does not reveal)).*$'
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  1855 passed | 4 skipped (1859)
```

## Step 11: verify: timing

```bash
cd apps/api && set -a && . ./.env && set +a && ok=0; for i in 1 2 3 4 5 6 7 8 9 10; do node ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/http-timing.test.ts test/integration/auth-flows-mfa.test.ts -t '(differ by less than 50 ms|sign-in timing does not reveal)' > ../../.data/timing-gate.log 2>&1 && { ok=1; break; }; sleep 45; done; tail -6 ../../.data/timing-gate.log; echo timing-ok=$ok attempts=$i
```

Expected output contains:

- `timing-ok=1`

Observed on the dry run:

```text
timing-ok=1 attempts=1
```

## Step 12: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && node --check apps/api/dist/staff.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 13: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 14: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 15: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 16: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 17: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 18: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker importer cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 19: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `README.md`
- `apps/admin/test/readme.test.ts`
- `docs/superpowers/specs/2026-09-03-korbat-design.md`
- `docs/superpowers/specs/2026-10-22-import-3b-design.md`
- `packages/contracts/src/imports.ts`
- `scripts/smoke-auth-stack.mjs`

## Step 20: commit

```bash
git add -A
git commit -q -m "docs(readme,design,contracts,scripts,admin): the import's record and the stack: README.md gains Importing posts (Import posts in Settings, an upload that resumes from the bytes the server holds, the Imported tab, what an import reads and never reads, the two volumes in no backup, the limits, the per-account key, the console's End this import and a lost end after a restore, the settings as infra/.env names them, why images stay off, what turning Bluesky on accepts, the labs); Upgrading gains 3b's migrations with 0045 as the slow one; Backups names import-archives and import-work; Counsel's list gains decision 28's points and the licence; The interface's cap is 832,257 bytes with 51 steps; the main design's 6a and row 3b are marked delivered and section 9 gains 2026-10-27, sub-project 3b; smoke step 21 confirms, reads the Imported tab and undoes, and step 14 reads the export's imports; readme.test.ts holds the numbers to IMPORT_RULES; the design's section 15 gains the dry run's amendments" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `docs(readme,design,contracts,scripts,admin): the import's record and the stack: README.md gains Importing posts (Import posts in Settings, an upload that resumes from the bytes the server holds, the Imported tab, what an import reads and never reads, the two volumes in no backup, the limits, the per-account key, the console's End this import and a lost end after a restore, the settings as infra/.env names them, why images stay off, what turning Bluesky on accepts, the labs); Upgrading gains 3b's migrations with 0045 as the slow one; Backups names import-archives and import-work; Counsel's list gains decision 28's points and the licence; The interface's cap is 832,257 bytes with 51 steps; the main design's 6a and row 3b are marked delivered and section 9 gains 2026-10-27, sub-project 3b; smoke step 21 confirms, reads the Imported tab and undoes, and step 14 reads the export's imports; readme.test.ts holds the numbers to IMPORT_RULES; the design's section 15 gains the dry run's amendments`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-build": <paste the expected lines as printed>
Verify "test-database-fresh": <paste the expected lines as printed>
Verify "integration-fresh": <paste the expected lines as printed>
Verify "test-database-upgrade": <paste the expected lines as printed>
Verify "integration-upgraded": <paste the expected lines as printed>
Verify "timing": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
