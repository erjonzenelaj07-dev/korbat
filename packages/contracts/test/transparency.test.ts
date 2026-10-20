import { describe, expect, test } from "vitest";
import type { z } from "zod";
import {
  ANNEX3_GROUNDS,
  EDITION_REASONS,
  MEASURE_KINDS,
  ORDER_GROUNDS,
  PublicFacts,
  PublicTransparency,
  RECIPIENT_READ_ROUTES,
  RECIPIENT_RULES,
  TRANSPARENCY_RULES,
  TransparencyFigures,
  band,
} from "../src/index";

/**
 * 3d Task 4, the public figures (design, sections 2 rows 1 to 3 and 8, 6.4, 7.5, 7.6, 10.1 and 10.6): the mirror of
 * transparency_rules() and its band, which a database test holds to the SQL band over 0 to 200; the recipients' rules and
 * the seven signed-out reads they count; and the two public answers, whose schema holds that nothing in them can carry
 * an id, a handle, a day of a decision or a number under ten outside the order section.
 */
describe("the public figures' contracts (3d Task 4)", () => {
  test("TRANSPARENCY_RULES holds transparency_rules()'s five numbers: the floor and the rounding of ten, the due day 1 March, method 1", () => {
    expect({ ...TRANSPARENCY_RULES }).toEqual({ floor: 10, roundTo: 10, dueMonth: 3, dueDay: 1, method: 1 });
  });

  test("band prints 0, 1 to 9, or the count rounded to the nearest ten with halves upward, over 0 to 200", () => {
    for (let n = 0; n <= 200; n++) {
      const expected = n === 0 ? "0" : n < 10 ? "1 to 9" : `about ${Math.floor((n + 5) / 10) * 10}`;
      expect([n, band(n)]).toEqual([n, expected]);
    }
    // LAB E's own rows: 216 is about 220, 14 about 10, 61 about 60, 94 about 90, 35 about 40, 12 about 10.
    expect([216, 14, 61, 94, 35, 12].map(band)).toEqual(["about 220", "about 10", "about 60", "about 90", "about 40", "about 10"]);
    expect([15, 25, 1005].map(band)).toEqual(["about 20", "about 30", "about 1010"]);
    expect(() => band(-1)).toThrow();
    expect(() => band(2.5)).toThrow();
  });

  test("RECIPIENT_RULES: method 1, six months, a salt of 26 hours, sketches of 70 days, the agent cut at 256 bytes", () => {
    const { crawler, ...numbers } = RECIPIENT_RULES;
    expect(numbers).toEqual({ method: 1, months: 6, saltHours: 26, sketchDays: 70, userAgentBytes: 256 });
    // A crawler is left out only by its own words.
    for (const agent of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "Slurp", "SomeCrawler/1.0", "Baiduspider"]) {
      expect([agent, crawler.test(agent)]).toEqual([agent, true]);
    }
    for (const agent of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0", "korbat/1 CFNetwork/1568 Darwin/24.0.0", ""]) {
      expect([agent, crawler.test(agent)]).toEqual([agent, false]);
    }
  });

  test("RECIPIENT_READ_ROUTES are the seven signed-out reads of the social module", () => {
    expect([...RECIPIENT_READ_ROUTES]).toEqual([
      "GET /api/posts/:id",
      "GET /api/posts/:id/thread",
      "GET /api/timeline/latest",
      "GET /api/timeline/explore",
      "GET /api/profiles/:handle",
      "GET /api/profiles/:handle/posts",
      "GET /api/profiles/:handle/replies",
    ]);
  });

  test("EDITION_REASONS are the three reasons of a version", () => {
    expect([...EDITION_REASONS]).toEqual(["first", "hold_ended", "correction"]);
  });

  const off = {
    r1: { state: "off", test: false, model: null, digest: null, threshold: null, thresholdVersion: null, publisherClaim: null, dpia: null, dpiaActs: null },
    match: { state: "off", test: false, source: null, dpia: null, dpiaActs: null },
    edge: { on: false, test: false },
    witness: { on: false, test: false },
    recipientsSignedOut: true,
  };

  test("PublicFacts reads every tool off, and refuses a member it does not name", () => {
    expect(PublicFacts.parse(off)).toEqual(off);
    expect(PublicFacts.safeParse({ ...off, edge: { on: true, test: true, host: "korbat.example" } }).success).toBe(false);
    expect(PublicFacts.safeParse({ ...off, token: "x" }).success).toBe(false);
    expect(PublicFacts.safeParse({ ...off, r1: { ...off.r1, dpia: "2026-10-01" } }).success).toBe(true);
    expect(PublicFacts.safeParse({ ...off, r1: { ...off.r1, dpia: "1 October" } }).success).toBe(false);
  });

  const figures = {
    restrictions: {
      byGround: [
        { label: "R1", count: "about 60" },
        { label: "R3", count: "about 90" },
        { label: "other", count: "about 10" },
      ],
      byMeasure: [{ label: "withhold", count: "about 220" }],
      total: "about 220",
    },
    noBreach: "about 140",
    intakes: [{ label: "rules", count: "about 30" }],
    appeals: [],
    reexaminations: [],
    accountMeasures: [],
    automated: { findings: [], measures: [] },
    recipients: "not recorded",
  };
  const answer = {
    editions: [{ year: 2025, version: 2, publishedOn: "2026-05-02", method: 1, reason: "hold_ended", figures, older: [{ version: 1, publishedOn: "2026-03-01", replacedOn: "2026-05-02", reason: "first", figures }] }],
  };

  test("PublicTransparency reads an edition with its older versions; a count is banded, a label is one of a closed list", () => {
    expect(PublicTransparency.parse(answer)).toEqual(answer);
    const withCount = (count: string) => ({ ...figures, noBreach: count });
    for (const count of ["0", "1 to 9", "about 10", "about 1230"]) expect([count, TransparencyFigures.safeParse(withCount(count)).success]).toEqual([count, true]);
    for (const count of ["5", "12", "about 15", "about 5", "about 0", "1 to 10", ""]) expect([count, TransparencyFigures.safeParse(withCount(count)).success]).toEqual([count, false]);
    const withLabel = (label: string) => ({ ...figures, intakes: [{ label, count: "about 10" }] });
    for (const label of ["rules", "illegal", "finding", "automated", "other"]) expect(TransparencyFigures.safeParse(withLabel(label)).success).toBe(true);
    for (const label of ["3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a", "@someone", "2025-06-01"]) expect([label, TransparencyFigures.safeParse(withLabel(label)).success]).toEqual([label, false]);
    // Every measure of the ledger is a label of the table by measure.
    for (const kind of MEASURE_KINDS) expect(TransparencyFigures.safeParse({ ...figures, restrictions: { ...figures.restrictions, byMeasure: [{ label: kind, count: "1 to 9" }] } }).success).toBe(true);
  });

  test("the recipients are two bounds, one, or not recorded; the uploads table is optional, since an edition stored before Task 7 never gains it", () => {
    for (const recipients of [{ low: "about 120", high: "about 340" }, { low: "about 120" }, "not recorded"]) {
      expect(TransparencyFigures.safeParse({ ...figures, recipients }).success).toBe(true);
    }
    for (const recipients of [{ low: "123" }, { low: "about 120", high: 340 }, "unknown", 0]) {
      expect(TransparencyFigures.safeParse({ ...figures, recipients }).success).toBe(false);
    }
    expect(TransparencyFigures.safeParse({ ...figures, uploads: [{ label: "other", count: "1 to 9" }] }).success).toBe(true);
  });

  test("the order section holds numbers, small ones too, and null for a figure the rows can no longer give", () => {
    const orders = {
      received: { total: 1, crossBorder: 0 },
      itemsDisabled: 2,
      minutes: { list: [10, null], outside: 0, withoutReceipt: 1, open: 0 },
      annex3: Object.fromEntries(ANNEX3_GROUNDS.map((ground) => [ground, 0])),
      scrutiny: { requested: 0, annulled: 0, upheld: 0 },
      reinstated: Object.fromEntries(ORDER_GROUNDS.map((ground) => [ground, 0])),
      authorityAccess: 0,
      terroristWithoutOrder: 1,
      referralsClosed: 0,
    };
    expect(TransparencyFigures.safeParse({ ...figures, orders }).success).toBe(true);
    const erased = { ...orders, received: null, itemsDisabled: null, minutes: null, annex3: null, scrutiny: null, reinstated: null, authorityAccess: null };
    expect(TransparencyFigures.safeParse({ ...figures, orders: erased }).success).toBe(true);
    // No issuing state: the page prints none (section 2, row 4).
    expect(TransparencyFigures.safeParse({ ...figures, orders: { ...orders, received: { total: 1, crossBorder: 0, byState: [["DE", 1]] } } }).success).toBe(false);
  });

  /**
   * The schema test of 10.6: walks both answers' schemas and holds that no member could carry an id of a post, a case, a
   * decision or an account, a handle, a day of a decision, a place in the chain, a hash or a score, and that every number
   * and every free string outside the order section is one the design names: a year, a version, a method, an edition's
   * day, an impact assessment's day, or the facts' model, digest and claim.
   */
  test("no public answer has a member that could hold an id, a handle, a decision's day or a number under ten outside the order section", () => {
    const leaves: { path: string; type: string }[] = [];
    walk(PublicFacts, "facts", leaves);
    walk(PublicTransparency, "transparency", leaves);
    const forbidden = /(^|[.])(id|[a-z]*Id|handle|decidedAt|day|chainSeq|seq|place|hash|score|sha256|pdq|file|post|case|decision|account)$/;
    for (const leaf of leaves) expect([leaf.path, forbidden.test(leaf.path.replaceAll("[]", ""))]).toEqual([leaf.path, false]);
    const outsideOrders = leaves.filter((leaf) => !leaf.path.includes(".orders"));
    const numbers = outsideOrders.filter((leaf) => leaf.type === "number").map((leaf) => leaf.path);
    expect(numbers.sort()).toEqual(
      [
        "facts.r1.threshold",
        "facts.r1.thresholdVersion",
        "transparency.editions[].method",
        "transparency.editions[].older[].version",
        "transparency.editions[].version",
        "transparency.editions[].year",
      ].sort(),
    );
    const strings = outsideOrders.filter((leaf) => leaf.type === "string").map((leaf) => leaf.path);
    expect(strings.sort()).toEqual(
      [
        "facts.match.dpia",
        "facts.match.dpiaActs",
        "facts.match.source",
        "facts.r1.digest",
        "facts.r1.dpia",
        "facts.r1.dpiaActs",
        "facts.r1.model",
        "facts.r1.publisherClaim",
        "transparency.editions[].older[].publishedOn",
        "transparency.editions[].older[].replacedOn",
        "transparency.editions[].publishedOn",
      ].sort(),
    );
    // Every other string leaf is a band, a closed list or a literal.
    expect(outsideOrders.filter((leaf) => leaf.type === "band").length).toBeGreaterThan(10);
  });
});

/** Collects the leaves of a zod schema with their paths: a band (a string under the band's pattern), an enum, a literal, a string, a number or a boolean. */
function walk(schema: z.ZodType, path: string, out: { path: string; type: string }[]): void {
  const def = (schema as unknown as { def: { type: string } & Record<string, unknown> }).def;
  switch (def.type) {
    case "object":
      for (const [key, value] of Object.entries(def.shape as Record<string, z.ZodType>)) walk(value, `${path}.${key}`, out);
      return;
    case "array":
      walk(def.element as z.ZodType, `${path}[]`, out);
      return;
    case "union":
      for (const option of def.options as z.ZodType[]) walk(option, path, out);
      return;
    case "optional":
    case "nullable":
      walk(def.innerType as z.ZodType, path, out);
      return;
    case "record":
      walk(def.valueType as z.ZodType, `${path}.*`, out);
      return;
    case "string": {
      const checks = (def.checks as { _zod: { def: { check: string; pattern?: RegExp } } }[] | undefined) ?? [];
      const banded = checks.some((check) => check._zod.def.pattern?.source === BAND_SOURCE);
      out.push({ path, type: banded ? "band" : "string" });
      return;
    }
    default:
      out.push({ path, type: def.type });
  }
}

/** The pattern a banded string is held to. */
const BAND_SOURCE = "^(0|1 to 9|about [1-9][0-9]*0)$";
