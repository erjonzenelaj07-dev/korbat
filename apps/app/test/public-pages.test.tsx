import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AUTOMATION_RULES, EDGE_CACHE, EDGE_WORDS, RECIPIENT_RULES, TRANSPARENCY_RULES, type PublicFacts, type PublicHead, type PublicTransparency, type TransparencyFigures } from "@korbat/contracts";
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
  // 3d review M13: a keeper's address is set, as on a server ready to go public; the test of the keeper says otherwise.
  keeper: true,
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

  test("3d Task 6: the page passes the contracts' AUTOMATION_RULES as its limits, so the caps it prints are the database's", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/rules.tsx"), "utf8");
    expect(source).toContain("<RulesView facts={facts} limits={AUTOMATION_RULES} />");
    const on = { ...OFF, r1: { ...OFF.r1, state: "withholds", test: true } } as PublicFacts;
    const text = textOf(html(<RulesView facts={on} limits={AUTOMATION_RULES} />));
    expect(text).toContain(RULES_PAGE.autoCap(AUTOMATION_RULES));
    expect(text).toContain(RULES_PAGE.autoTarget(AUTOMATION_RULES.objectionTargetHours));
    expect(RULES_PAGE.autoCap(AUTOMATION_RULES)).toContain(`at most ${AUTOMATION_RULES.decisionsPerHour} measures an hour and ${AUTOMATION_RULES.decisionsPerDay} a day under rule R1`);
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

  test("review M13: with no keeper's address the witness's block off says the value stands on the Transparency page alone, and names no person", () => {
    expect(blockOf({ ...OFF, keeper: false }, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.offAlone]);
    expect(TOOL_TEXTS.witness.offAlone).toBe("Outside timestamp for the audit log's daily value: off. The value stands on korbat's Transparency page alone.");
    expect(TOOL_TEXTS.witness.offAlone).not.toMatch(/person|mail/);
    expect(blockOf(OFF, "witness").paragraphs).toEqual([TOOL_TEXTS.witness.off]);
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

  test("3d Task 8 (12.2): the R1 check and the comparison in the four states a tool can be in: off from the start, on, on with its measure, and off again after it ran, which reads as off from the start; each off text says that korbat keeps nothing of the tool, which the retention job's step tools_off makes true (automation-retention.test.ts holds the database to it)", () => {
    const r1 = (state: PublicFacts["r1"]["state"]) => blockOf({ ...OFF, r1: { ...OFF.r1, state } }, "r1").paragraphs[0];
    const match = (state: PublicFacts["match"]["state"]) => blockOf({ ...OFF, match: { ...OFF.match, state, source: state === "off" ? null : "Source A" } }, "match").paragraphs[0];
    expect([r1("off"), r1("flags"), r1("withholds"), r1("off")]).toEqual([TOOL_TEXTS.r1.off, TOOL_TEXTS.r1.flags, TOOL_TEXTS.r1.withholds, TOOL_TEXTS.r1.off]);
    expect([match("off"), match("alerts"), match("seals"), match("off")]).toEqual([TOOL_TEXTS.match.off, TOOL_TEXTS.match.alerts("Source A"), TOOL_TEXTS.match.seals("Source A"), TOOL_TEXTS.match.off]);
    // While on, the rating and the fingerprints are kept with the image; once off, none from the time it was on.
    expect(TOOL_TEXTS.r1.flags).toContain("korbat keeps the rating with the image");
    expect(TOOL_TEXTS.r1.withholds).toContain("korbat keeps the rating with the image");
    expect(TOOL_TEXTS.r1.off).toContain("korbat keeps no rating from a time when one did");
    expect(TOOL_TEXTS.match.alerts("S")).toContain("keeps them with the image");
    expect(TOOL_TEXTS.match.off).toContain("keeps no fingerprint from a time when it did, except the one in the record of a match");
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

describe("the transparency page's daily value (3d Task 5, 9.3 item 6, W.2)", () => {
  const value = (c: string) => c.repeat(64);
  const head: PublicHead = {
    days: [
      { day: "2026-10-19", kind: "head", value: value("a"), witness: "rfc3161", token: "MAMCAQA=", retiredOn: null, lastDay: null },
      { day: "2026-10-18", kind: "restore", value: value("b"), witness: "none", token: null, retiredOn: null, lastDay: "2026-10-15" },
      { day: "2026-10-17", kind: "head", value: value("c"), witness: "none", token: null, retiredOn: "2026-10-18", lastDay: null },
      { day: "2026-10-15", kind: "head", value: value("d"), witness: "none", token: null, retiredOn: null, lastDay: null },
    ],
  };
  const T = TRANSPARENCY_PAGE;

  test("its section stands after the editions and before the Transparency Database: [tr.head], a row a day newest first with its value and its witness, [tr.restore], [tr.retired] and [tr.headMissing] in their places", () => {
    const text = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} />));
    const at = (part: string) => {
      expect(text, part).toContain(part);
      return text.indexOf(part);
    };
    const order = [
      at(T.none),
      at(T.headHeading),
      at(T.head),
      at(T.headRow("2026-10-19", value("a"), "rfc3161")),
      at(T.restore("2026-10-18", "2026-10-15")),
      at(T.headMissingRow("2026-10-18")),
      at(`${T.headRow("2026-10-17", value("c"), "none")} ${T.retired("2026-10-18")}`),
      at(T.headMissingRow("2026-10-16")),
      at(T.headRow("2026-10-15", value("d"), "none")),
      at(T.tdbHeading),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // A restore that found nothing that still fits says so; a day after the newest row is not shown as missing.
    expect(T.restore("2026-10-18", null)).toBe("2026-10-18: korbat restored its database from a backup. No value above still fits the restored log.");
    expect(text).not.toContain(T.headMissingRow("2026-10-20"));
    expect(text).not.toContain(T.headMissingRow("2026-10-14"));
    // A public page points at no person, and the head's place is in no row.
    expect(text).not.toMatch(/@|chainSeq|chain_seq|Place:/);
  });

  test("while a shown row has a proof: [tr.verify] as the lab ran it, with that day's value and file, and the proof to download as <day>.tsr; without one, neither", () => {
    const markup = html(<TransparencyView answer={{ editions: [] }} head={head} />);
    const text = textOf(markup);
    expect(text).toContain(T.verify(value("a"), "2026-10-19"));
    expect(T.verify(value("a"), "2026-10-19")).toBe(
      `To check a day: download its proof, get the timestamp authority's certificates from the authority itself, and run: openssl ts -verify -digest ${value("a")} -in 2026-10-19.tsr -CAfile <certificates>. It answers "Verification: OK" when that authority signed this value at the time the proof states.`,
    );
    expect(text).toContain(T.download("2026-10-19"));
    // One row has a proof, so one download: the words before the day are the same for every row.
    expect(text.split(T.download("DAY").split("DAY")[0]!).length - 1).toBe(1);
    const unwitnessed: PublicHead = { days: head.days.map((row) => ({ ...row, witness: "none", token: null })) };
    const plain = textOf(html(<TransparencyView answer={{ editions: [] }} head={unwitnessed} />));
    expect(plain).not.toContain("openssl");
    expect(plain).not.toContain(T.download("2026-10-19"));
    expect(plain).toContain(T.headRow("2026-10-19", value("a"), "none"));
  });

  test("[page.down] for this part alone; no value yet reads its sentence; while it loads, the section holds [tr.head] alone", () => {
    const down = textOf(html(<TransparencyView answer={{ editions: [] }} head="down" />));
    expect(down).toContain(T.none);
    expect(down.split(PAGE_DOWN).length - 1).toBe(1);
    expect(down.indexOf(PAGE_DOWN)).toBeGreaterThan(down.indexOf(T.head));
    const both = textOf(html(<TransparencyView answer="down" head="down" />));
    expect(both.split(PAGE_DOWN).length - 1).toBe(2);
    expect(textOf(html(<TransparencyView answer={{ editions: [] }} head={{ days: [] }} />))).toContain(T.headNone);
    const loading = textOf(html(<TransparencyView answer={{ editions: [] }} head="loading" />));
    expect(loading).toContain(T.head);
    expect(loading).not.toContain(PAGE_DOWN);
    expect(loading).not.toContain(T.headNone);
  });

  test("review M13: the keeper's sentence follows [tr.head] only while a keeper's address is set; without one the page names no person; until the facts answer, neither", () => {
    const withKeeper = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} keeper={true} />));
    expect(withKeeper).toContain(`${T.head} ${T.headKeeper}`);
    const without = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} keeper={false} />));
    expect(without).toContain(`${T.head} ${T.headNoKeeper}`);
    expect(without).not.toContain("a person who does not run the server");
    const unknown = textOf(html(<TransparencyView answer={{ editions: [] }} head={head} />));
    expect(unknown).not.toContain(T.headKeeper);
    expect(unknown).not.toContain(T.headNoKeeper);
    // The page asks the facts route too, for the keeper's member alone.
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/app/transparency.tsx"), "utf8");
    expect(source).toContain('api("/api/public/facts", { schema: PublicFacts })');
  });

  test("its words are W.2's: [tr.head], [tr.headMissing], [tr.restore] and [tr.retired]", () => {
    expect(T.head).toBe(
      "Each day korbat publishes one value computed from the day and the newest entry of its staff audit log, the record of everything korbat's staff confirm with their keys. If an earlier entry were changed or removed later, the log would no longer lead to the values published since. A value shows neither how many entries the log has nor any entry, and it differs from one day to the next also when nothing was added to the log. A value on korbat's own page proves nothing against korbat's operator, who could change this page too.",
    );
    // 3d review M13: the sentence that names the keeper, and the one printed in its place while no address is set.
    expect(T.headKeeper).toBe("So the same value goes each day to a person who does not run the server, and, when the outside timestamp is on, to a timestamp authority.");
    expect(T.headNoKeeper).toBe("When the outside timestamp is on, the same value goes each day to a timestamp authority.");
    expect(T.headMissingRow("2026-10-16")).toBe("2026-10-16: no value was published");
    expect(T.restore("2026-10-18", "2026-10-15")).toBe("2026-10-18: korbat restored its database from a backup. The newest value above that still fits the restored log is of 2026-10-15.");
    expect(T.retired("2026-10-18")).toBe("retired by the restore of 2026-10-18: true when published, and fits no log now");
  });
});

describe("the smoke test looks for the pages' own lead sentences in the bundle (3d Task 4, 12.2)", () => {
  test("scripts/smoke-auth-stack.mjs holds RULES_PAGE.lead and TRANSPARENCY_PAGE.lead word for word", () => {
    const smoke = readFileSync(path.resolve(import.meta.dirname, "../../../scripts/smoke-auth-stack.mjs"), "utf8");
    expect(smoke).toContain(RULES_PAGE.lead);
    expect(smoke).toContain(TRANSPARENCY_PAGE.lead);
  });
});
