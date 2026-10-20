import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ALERT_RULES, ORDER_RULES, REPLY_AIM_HOURS, RETENTION, STANDING_RULES } from "@korbat/contracts";
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
    // 3d Task 2 (W.11): the gate's first line reads 3d's quarantine and release.
    expect(all).toContain("until sub-project 3f's order path and sub-project 3d's quarantine and release have shipped and the list below is done");
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
    expect(text).toContain("beginning with step 6 (the inventory)");
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
