import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { EDGE_CACHE, EDGE_WORDS, RECIPIENT_RULES, TRANSPARENCY_RULES, type PublicFacts, type PublicTransparency, type TransparencyFigures } from "@korbat/contracts";
import { RULES, RULES_CHANGES, RULES_VERSION } from "@korbat/rules";

vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  Redirect: () => null,
  router: { push: () => undefined, replace: () => undefined },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/rules",
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ state: { status: "signed-out" }, refresh: async () => undefined }) }));
vi.mock("react-native-reanimated", () => ({ useReducedMotion: () => false }));

import { RulesView } from "../src/app/rules";
import { TransparencyView } from "../src/app/transparency";
import { PAGE_DOWN, RULES_PAGE, TOOL_TEXTS, TRANSPARENCY_PAGE, toolBlocks, type AutomationLimits } from "../src/lib/public-pages";
import { MEASURES_PARAGRAPH, TERMS_SECTIONS, termsParagraphs } from "../src/lib/terms";

/**
 * The two public pages (3d design, sections 9.1 to 9.3, 10.8 and 12.2; W.1 and W.2; Task 4): server-rendered checks of
 * both pages with every tool off, with the route down and with stored editions; TOOL_TEXTS in every state a tool can be
 * in; the rules page and the terms printing their numbered sentences with the same builders; every number of the words
 * held to its constant; and the smoke test's two lead sentences held to the pages' own.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
/** The markup's text as a reader sees it: tags dropped, the entities React writes decoded, spaces collapsed. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
    .replace(/ +/g, " ");

const OFF: PublicFacts = {
  r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
  match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
  edge: { on: false, test: false },
  witness: { on: false, test: false },
  recipientsSignedOut: true,
};
const LIMITS: AutomationLimits = { decisionsPerHour: 20, decisionsPerDay: 100, r2DecisionsPerHour: 21, r2DecisionsPerDay: 101, unansweredMax: 22, unansweredHours: 72, refusalsPerHour: 23, objectionTargetHours: 24 };

describe("the rules page (3d Task 4)", () => {
  test("every rule with its text and its lists, the law, the measures and the numbered sections, every tool off, and the change log newest first", () => {
    const markup = html(<RulesView facts={OFF} />);
    const text = textOf(markup);
    expect(text).toContain(RULES_PAGE.lead);
    for (const rule of RULES) {
      expect(text).toContain(`${rule.id}: ${rule.title}`);
      expect(text).toContain(rule.text);
      for (const item of [...rule.allowed, ...rule.notAllowed]) expect(text).toContain(item);
    }
    expect(text).toContain(RULES_PAGE.law);
    expect(text).toContain(MEASURES_PARAGRAPH);
    for (const tool of [TOOL_TEXTS.r1.off, TOOL_TEXTS.match.off, TOOL_TEXTS.edge.off, TOOL_TEXTS.witness.off, RULES_PAGE.autoNone]) expect(text).toContain(tool);
    expect(text).not.toContain(PAGE_DOWN);
    expect(text).toContain(RULES_PAGE.version(RULES_VERSION));
    const changes = [...RULES_CHANGES].reverse().map((change) => text.indexOf(RULES_PAGE.change(change)));
    expect(changes.every((at) => at > -1)).toBe(true);
    expect([...changes].sort((a, b) => a - b)).toEqual(changes);
    // The headings, each a header of its level, and the links to the other page and to How Explore works.
    for (const heading of [RULES_PAGE.rulesHeading, RULES_PAGE.measuresHeading, RULES_PAGE.automationHeading, RULES_PAGE.versionHeading]) expect(markup).toContain(`aria-level="2"`);
    expect(markup).toContain('href="/transparency"');
    expect(markup).toContain('href="/explore/about"');
  });

  test("the numbered sentences are the terms' own: the same builders print Strikes, Suspension, Reporting in bad faith and Terrorist content in both", () => {
    const text = textOf(html(<RulesView facts={OFF} />));
    for (const title of ["Strikes", "Suspension and termination", "Reporting in bad faith", "Terrorist content"]) {
      const section = TERMS_SECTIONS.find((candidate) => candidate.title === title);
      expect(section, title).toBeDefined();
      for (const paragraph of termsParagraphs(section!.body)) expect(text).toContain(paragraph);
    }
    const decide = TERMS_SECTIONS.find((section) => section.title === "How moderators decide")!;
    expect(termsParagraphs(decide.body)).toContain(MEASURES_PARAGRAPH);
  });

  test("while the facts are read the automation section holds its lead alone; when the route does not answer it reads [page.down] and prints no tool as off or on", () => {
    for (const [facts, down] of [["loading", false], ["down", true]] as const) {
      const text = textOf(html(<RulesView facts={facts} />));
      expect(text).toContain(RULES_PAGE.autoLead);
      expect(text.includes(PAGE_DOWN)).toBe(down);
      for (const tool of [TOOL_TEXTS.r1.off, TOOL_TEXTS.match.off, TOOL_TEXTS.edge.off, TOOL_TEXTS.witness.off, RULES_PAGE.autoNone]) expect(text).not.toContain(tool);
      expect(text).toContain(RULES_PAGE.lead);
    }
  });

  test("with a tool that rates or compares images on, the caps and the target from the limits, and no [rules.auto.none]", () => {
    const on = { ...OFF, match: { state: "alerts", test: true, source: "test", dpia: "2026-10-01", dpiaActs: null } } as PublicFacts;
    const text = textOf(html(<RulesView facts={on} limits={LIMITS} />));
    expect(text).toContain(RULES_PAGE.autoCap(LIMITS));
    expect(text).toContain(RULES_PAGE.autoTarget(LIMITS.objectionTargetHours));
    expect(text).not.toContain(RULES_PAGE.autoNone);
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("at most 20 measures an hour and 100 a day under rule R1, and at most 21 an hour and 101 a day under rule R2");
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("while 22 of its measures");
    expect(RULES_PAGE.autoCap(LIMITS)).toContain("refuses at most 23 uploads an hour");
  });
});

describe("TOOL_TEXTS in each state (3d Task 4, W.1)", () => {
  const blockOf = (facts: PublicFacts, tool: string) => toolBlocks(facts).find((block) => block.tool === tool)!;

  test("every tool off, as the facts route answers until the tasks that build them: each block its off text alone", () => {
    expect(toolBlocks(OFF).map((block) => [block.tool, block.on, block.paragraphs])).toEqual([
      ["r1", false, [TOOL_TEXTS.r1.off]],
      ["match", false, [TOOL_TEXTS.match.off]],
      ["edge", false, [TOOL_TEXTS.edge.off]],
      ["witness", false, [TOOL_TEXTS.witness.off]],
    ]);
  });

  test("the R1 check flagging, withholding and on a test adapter; its model's facts; its own dates, the measure's only while it acts", () => {
    const model = { model: "Marqo/nsfw-image-detection-384", digest: "ab".repeat(32), threshold: 0.9, thresholdVersion: 2, publisherClaim: "a claim" };
    const flags = blockOf({ ...OFF, r1: { ...OFF.r1, ...model, state: "flags", dpia: "2026-10-01", dpiaActs: "2026-10-02" } }, "r1");
    expect(flags.paragraphs).toEqual([TOOL_TEXTS.r1.flags, TOOL_TEXTS.r1.facts(model), RULES_PAGE.dpia("2026-10-01")]);
    const withholds = blockOf({ ...OFF, r1: { ...OFF.r1, ...model, state: "withholds", dpia: "2026-10-01", dpiaActs: "2026-10-02" } }, "r1");
    expect(withholds.paragraphs).toEqual([TOOL_TEXTS.r1.withholds, TOOL_TEXTS.r1.facts(model), RULES_PAGE.dpia("2026-10-01"), RULES_PAGE.dpiaActs("2026-10-02")]);
    const test = blockOf({ ...OFF, r1: { ...OFF.r1, state: "flags", test: true } }, "r1");
    expect(test.paragraphs).toEqual([TOOL_TEXTS.r1.flags.replace(": on.", ": on (test adapter).")]);
    expect(TOOL_TEXTS.r1.facts(model)).toContain('Its publisher states: "a claim".');
    // A date set for one tool never stands over another.
    expect(blockOf({ ...OFF, r1: { ...OFF.r1, state: "flags", dpia: "2026-10-01" } }, "match").paragraphs).toEqual([TOOL_TEXTS.match.off]);
  });

  test("the comparison with known material alerting and sealing, with its source's name, on a test adapter, and with its dates", () => {
    const alerts = blockOf({ ...OFF, match: { state: "alerts", test: false, source: "Source A", dpia: "2026-10-03", dpiaActs: "2026-10-04" } }, "match");
    expect(alerts.paragraphs).toEqual([TOOL_TEXTS.match.alerts("Source A"), RULES_PAGE.dpia("2026-10-03")]);
    const seals = blockOf({ ...OFF, match: { state: "seals", test: true, source: "test", dpia: "2026-10-03", dpiaActs: "2026-10-04" } }, "match");
    expect(seals.paragraphs).toEqual([TOOL_TEXTS.match.seals("test").replace(": on,", ": on (test adapter),"), RULES_PAGE.dpia("2026-10-03"), RULES_PAGE.dpiaActs("2026-10-04")]);
    // match.seals is match.alerts up to "what happens to the file." and its own words after it.
    const cut = "what happens to the file.";
    expect(TOOL_TEXTS.match.seals("S").slice(0, TOOL_TEXTS.match.seals("S").indexOf(cut))).toBe(TOOL_TEXTS.match.alerts("S").slice(0, TOOL_TEXTS.match.alerts("S").indexOf(cut)));
  });

  test("the edge and the witness, off, on and on a test adapter; the edge's minutes are the header's", () => {
    expect(blockOf({ ...OFF, edge: { on: true, test: false } }, "edge").paragraphs).toEqual([TOOL_TEXTS.edge.on]);
    expect(blockOf({ ...OFF, edge: { on: true, test: true } }, "edge").paragraphs).toEqual([TOOL_TEXTS.edge.on.replace(": on.", ": on (test adapter).")]);
    expect(blockOf({ ...OFF, witness: { on: true, test: false } }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.on]);
    expect(blockOf({ ...OFF, witness: { on: true, test: true } }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.on.replace(": on.", ": on (test adapter).")]);
    expect(TOOL_TEXTS.edge.off).toContain(`for up to ${EDGE_WORDS.edgeMinutes} minutes, and a copy in a browser for up to ${EDGE_CACHE.browserSeconds / 60} minute.`);
    expect(TOOL_TEXTS.edge.on).toContain(`up to ${EDGE_WORDS.edgeMinutes} minutes at the provider, up to ${EDGE_CACHE.browserSeconds / 60} minute in a browser.`);
  });

  test("no text says more than is known: never that an image is such material, that korbat confirmed it, or the same fingerprint of a picture's look", () => {
    const texts = [
      TOOL_TEXTS.r1.off,
      TOOL_TEXTS.r1.flags,
      TOOL_TEXTS.r1.withholds,
      TOOL_TEXTS.r1.facts({ model: "m", digest: "d", threshold: 0.5, thresholdVersion: 0, publisherClaim: "c" }),
      TOOL_TEXTS.match.off,
      TOOL_TEXTS.match.alerts("S"),
      TOOL_TEXTS.match.seals("S"),
      TOOL_TEXTS.edge.off,
      TOOL_TEXTS.edge.on,
      TOOL_TEXTS.witness.off,
      TOOL_TEXTS.witness.on,
      RULES_PAGE.autoLead,
    ];
    for (const text of texts) {
      for (const phrase of ["is child sexual abuse material", "confirmed", "posted such", "the same fingerprint", "does nothing to your account", "Whatever it does", "no longer holds", "@"]) expect([phrase, text.includes(phrase)]).toEqual([phrase, false]);
    }
  });
});

describe("the transparency page (3d Task 4)", () => {
  const empty: TransparencyFigures = {
    restrictions: { byGround: [], byMeasure: [], total: "0" },
    noBreach: "0",
    intakes: [],
    appeals: [],
    reexaminations: [],
    accountMeasures: [],
    automated: { findings: [], measures: [] },
    recipients: "not recorded",
  };
  const full: TransparencyFigures = {
    restrictions: {
      byGround: [
        { label: "R1", count: "about 60" },
        { label: "law", count: "about 10" },
        { label: "other", count: "about 10" },
      ],
      byMeasure: [
        { label: "remove", count: "about 70" },
        { label: "other", count: "1 to 9" },
      ],
      total: "about 80",
    },
    noBreach: "about 140",
    intakes: [
      { label: "rules", count: "about 30" },
      { label: "illegal", count: "about 10" },
    ],
    appeals: [{ label: "kept", count: "about 10" }],
    reexaminations: [{ label: "no_action", count: "about 20" }],
    accountMeasures: [{ label: "strike", count: "about 10" }],
    automated: { findings: [], measures: [] },
    orders: {
      received: { total: 2, crossBorder: 1 },
      itemsDisabled: 3,
      minutes: { list: [10, 125], outside: 1, withoutReceipt: 0, open: 0 },
      annex3: { force_majeure: 0, manifest_error: 0, insufficient_information: 1 },
      scrutiny: { requested: 1, annulled: 0, upheld: 1 },
      reinstated: { withdrawn: 0, annulled: 1, scrutiny: 0, not_authentic: 0, wrong_item: 0 },
      authorityAccess: null,
      terroristWithoutOrder: 1,
      referralsClosed: 0,
    },
    recipients: { low: "about 120", high: "about 340" },
  };
  const answer: PublicTransparency = {
    editions: [
      { year: 2025, version: 2, publishedOn: "2026-05-02", method: 1, reason: "hold_ended", figures: full, older: [{ version: 1, publishedOn: "2026-03-01", replacedOn: "2026-05-02", reason: "first", figures: empty }] },
      { year: 2024, version: 1, publishedOn: "2025-03-01", method: 1, reason: "first", figures: { ...empty, recipients: { low: "1 to 9" } }, older: [] },
    ],
  };

  test("each year newest first with its edition line, the reason of its newest version, its tables, its older versions and its recipients; the method once", () => {
    const markup = html(<TransparencyView answer={answer} />);
    const text = textOf(markup);
    for (const fixed of [TRANSPARENCY_PAGE.lead, TRANSPARENCY_PAGE.read, TRANSPARENCY_PAGE.tdb]) expect(text).toContain(fixed);
    expect(text.indexOf(TRANSPARENCY_PAGE.edition(2025, 2, "2026-05-02", 1))).toBeLessThan(text.indexOf(TRANSPARENCY_PAGE.edition(2024, 1, "2025-03-01", 1)));
    expect(text).toContain(TRANSPARENCY_PAGE.reason.hold_ended);
    expect(text).toContain(`${TRANSPARENCY_PAGE.labels.ground("R1")}: about 60`);
    expect(TRANSPARENCY_PAGE.labels.ground("R1")).toBe(`Rule R1: ${RULES[0]!.title}`);
    for (const line of ["The law: about 10", "Other grounds: about 10", "All restrictions: about 80", "Remove: about 70", "Other measures: 1 to 9", "Decisions that found no breach: about 140"]) expect(text).toContain(line);
    for (const line of ["Reports under korbat's rules: about 30", "Notices of illegal content (Article 16 of the Digital Services Act): about 10", "Decision kept: about 10", "No action again: about 20", "Strike: about 10"]) expect(text).toContain(line);
    // A table with no row reads its "none" sentence.
    expect(text).toContain(`${TRANSPARENCY_PAGE.tables.automated} ${TRANSPARENCY_PAGE.tableNone}`);
    // The order section's numbers, small ones too, and a figure the rows cannot give as not recorded.
    for (const line of [
      TRANSPARENCY_PAGE.orders,
      TRANSPARENCY_PAGE.orderLines.received("2", "1"),
      TRANSPARENCY_PAGE.orderLines.itemsDisabled("3"),
      TRANSPARENCY_PAGE.orderLines.minutes("10, 125"),
      TRANSPARENCY_PAGE.orderLines.outside("1"),
      TRANSPARENCY_PAGE.orderLines.annex3("force majeure 0, manifest error 0, insufficient information 1"),
      TRANSPARENCY_PAGE.orderLines.scrutiny("1", "0", "1"),
      TRANSPARENCY_PAGE.orderLines.access("not recorded"),
      TRANSPARENCY_PAGE.orderLines.terrorist("1"),
    ]) {
      expect(text).toContain(line);
    }
    // The standing sentence under every year, whether or not it has the section.
    expect(text.split(TRANSPARENCY_PAGE.ordersHeld).length - 1).toBe(2);
    expect(text).toContain(TRANSPARENCY_PAGE.recipients("2026-02", "about 120", "about 340"));
    expect(text).toContain(TRANSPARENCY_PAGE.recipientsOff("2025-02", "1 to 9"));
    expect(text).toContain(TRANSPARENCY_PAGE.versions);
    expect(text).toContain(TRANSPARENCY_PAGE.versionLine(1, "2026-03-01", "2026-05-02"));
    expect(text.split(TRANSPARENCY_PAGE.method(1)).length - 1).toBe(1);
    expect(markup).toContain('href="/rules"');
    expect(markup).toContain('href="/explore/about"');
    // A public page points at no person: no handle, no id.
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("a correction says so with its day; no edition yet reads [tr.none]; a route that does not answer reads [page.down] beside the fixed texts", () => {
    const corrected: PublicTransparency = { editions: [{ ...answer.editions[1]!, version: 2, reason: "correction", publishedOn: "2025-06-01", older: [] }] };
    expect(textOf(html(<TransparencyView answer={corrected} />))).toContain(TRANSPARENCY_PAGE.reason.correction("2025-06-01"));
    const none = textOf(html(<TransparencyView answer={{ editions: [] }} />));
    expect(none).toContain(TRANSPARENCY_PAGE.none);
    expect(none).not.toContain(TRANSPARENCY_PAGE.ordersHeld);
    const down = textOf(html(<TransparencyView answer="down" />));
    expect(down).toContain(PAGE_DOWN);
    expect(down).toContain(TRANSPARENCY_PAGE.lead);
    expect(down).toContain(TRANSPARENCY_PAGE.tdb);
    expect(textOf(html(<TransparencyView answer="loading" />))).not.toContain(PAGE_DOWN);
  });

  test("every number of the page's words is its constant's: the due day, the floor, the rounding, the salt's hours; the recipients' last month is the one before the due day", () => {
    expect(TRANSPARENCY_PAGE.read).toContain(`on or after ${TRANSPARENCY_RULES.dueDay} March of the next year`);
    expect(TRANSPARENCY_PAGE.read).toContain(`korbat prints 0, "1 to ${TRANSPARENCY_RULES.floor - 1}"`);
    expect(TRANSPARENCY_PAGE.read).toContain("rounded to the nearest ten");
    expect(TRANSPARENCY_PAGE.read).toContain("fewer than ten");
    expect(TRANSPARENCY_PAGE.none).toContain(`${TRANSPARENCY_RULES.dueDay} March`);
    expect(TRANSPARENCY_PAGE.method(1)).toContain(`exists for ${RECIPIENT_RULES.saltHours} hours`);
    expect(TRANSPARENCY_PAGE.read).not.toContain("1 June");
  });
});

describe("the smoke test looks for the pages' own lead sentences in the bundle (3d Task 4, 12.2)", () => {
  test("scripts/smoke-auth-stack.mjs holds RULES_PAGE.lead and TRANSPARENCY_PAGE.lead word for word", () => {
    const smoke = readFileSync(path.resolve(import.meta.dirname, "../../../scripts/smoke-auth-stack.mjs"), "utf8");
    expect(smoke).toContain(RULES_PAGE.lead);
    expect(smoke).toContain(TRANSPARENCY_PAGE.lead);
  });
});
