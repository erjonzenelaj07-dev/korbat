import { z } from "zod";
import { MEASURE_KINDS, RULE_IDS } from "./moderation";
import { ANNEX3_GROUNDS, ORDER_GROUNDS } from "./orders";

// The public figures (3d design, sections 2 rows 1 to 3 and 8, 6.4, 7.5, 7.6, 10.1 and 10.6; Task 4). This module
// imports moderation.ts and orders.ts for closed lists alone, and nothing imports it but the index, so it loads last.

// ---------------------------------------------------------------- the numbers

/**
 * The mirror of the SQL function transparency_rules(), which a database test holds member for column: the floor under
 * which a count prints as "1 to 9" and a row is folded into "other", the rounding of every other count, the day on which
 * a year's edition is due (1 March of the next year, in UTC) and the method's version. Each is the owner's to change
 * (section 2, rows 2 and 3), in that function and here.
 */
export const TRANSPARENCY_RULES = {
  floor: 10,
  roundTo: 10,
  dueMonth: 3,
  dueDay: 1,
  method: 1,
} as const;

/**
 * A count as the public reads it, exactly as the SQL function band() prints it (a table test holds the two equal over 0
 * to 200): 0 for zero, "1 to 9" under the floor, otherwise "about" and the count rounded to the nearest ten, halves
 * upward. It is the only place a count becomes public text.
 */
export function band(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`band takes a count, not ${n}`);
  if (n === 0) return "0";
  if (n < TRANSPARENCY_RULES.floor) return "1 to 9";
  const step = TRANSPARENCY_RULES.roundTo;
  return `about ${Math.floor((n + step / 2) / step) * step}`;
}

/**
 * The recipients' count (7.5), method 1: a month's sketch of signed-in accounts and a day's sketch of signed-out readers,
 * the day's salt living `saltHours`, every sketch dying `sketchDays` after its first write if the month's close never
 * took it, the user agent cut at `userAgentBytes` before it is digested, and the figure the average of `months` full
 * months. A crawler is left out only by its own words: one pattern on the agent, nothing guessed about a reader.
 */
export const RECIPIENT_RULES = {
  method: 1,
  months: 6,
  saltHours: 26,
  sketchDays: 70,
  userAgentBytes: 256,
  crawler: /bot|crawl|spider|slurp/i,
} as const;

/**
 * The seven routes of the social module that answer without a session (7.5): a post, its thread, the two public
 * timelines, a profile, its posts and its replies. A signed-out GET of one of them feeds the day's sketch. The image
 * route and the page status are not counted. A route-table test fails when the social module gains a signed-out read
 * that is neither here nor refused by name in that test.
 */
export const RECIPIENT_READ_ROUTES = [
  "GET /api/posts/:id",
  "GET /api/posts/:id/thread",
  "GET /api/timeline/latest",
  "GET /api/timeline/explore",
  "GET /api/profiles/:handle",
  "GET /api/profiles/:handle/posts",
  "GET /api/profiles/:handle/replies",
] as const;

/** Why a version of a year's edition was stored (the CHECK of transparency_editions.reason): version 1 alone is `first`. */
export const EDITION_REASONS = ["first", "hold_ended", "correction"] as const;
export type EditionReason = (typeof EDITION_REASONS)[number];

// ---------------------------------------------------------------- the public answers

/** A banded count, as band() prints it: never a number under ten, never an exact one. */
const Band = z.string().regex(/^(0|1 to 9|about [1-9][0-9]*0)$/);
/** A day, as the public pages print one: 2026-03-01. */
const Day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

/** One row of a table split by a label from a closed list: what is folded under the floor is the row `other`. */
const rows = <const L extends readonly [string, ...string[]]>(labels: L) => z.array(z.strictObject({ label: z.enum([...labels, "other"]), count: Band }));

/**
 * The labels of each table (6.4): a rule's id or `law` for the ground; a measure's kind; an intake's kind, a user's
 * report under the rules and a notice of illegality apart; an appeal's result; a re-examination's answer; one of 3e's six
 * account measures; an upload's end (from Task 7).
 */
export const FIGURE_LABELS = {
  grounds: [...RULE_IDS, "law"],
  measures: MEASURE_KINDS,
  intakes: ["rules", "illegal", "finding", "automated"],
  appeals: ["kept", "partly_reversed", "reversed"],
  reexaminations: ["action", "no_action"],
  accountMeasures: ["strike", "suspend", "terminate", "retire_handle", "warn_reporting", "restrict_reporting"],
} as const;

/**
 * The order section (6.4 step 5): the figures F 7.18 lists for tco-counts, as numbers and without the issuing state,
 * since the Regulation asks for numbers (section 2, row 4). A figure the rows can no longer give is null, which the page
 * prints as "not recorded", as tco-counts does, and never as 0.
 */
export const OrderFigures = z.strictObject({
  received: z.strictObject({ total: z.number().int().min(0), crossBorder: z.number().int().min(0) }).nullable(),
  itemsDisabled: z.number().int().min(0).nullable(),
  minutes: z
    .strictObject({
      list: z.array(z.number().int().nullable()),
      outside: z.number().int().min(0),
      withoutReceipt: z.number().int().min(0),
      open: z.number().int().min(0),
    })
    .nullable(),
  annex3: z.strictObject(Object.fromEntries(ANNEX3_GROUNDS.map((ground) => [ground, z.number().int().min(0)])) as Record<(typeof ANNEX3_GROUNDS)[number], z.ZodNumber>).nullable(),
  scrutiny: z.strictObject({ requested: z.number().int().min(0), annulled: z.number().int().min(0), upheld: z.number().int().min(0) }).nullable(),
  reinstated: z.strictObject(Object.fromEntries(ORDER_GROUNDS.map((ground) => [ground, z.number().int().min(0)])) as Record<(typeof ORDER_GROUNDS)[number], z.ZodNumber>).nullable(),
  authorityAccess: z.number().int().min(0).nullable(),
  terroristWithoutOrder: z.number().int().min(0),
  referralsClosed: z.number().int().min(0),
});
export type OrderFigures = z.infer<typeof OrderFigures>;

/**
 * A stored edition's figures, as transparency_figures() computes them (6.4): banded strings only, but the order section's
 * numbers. `uploads` comes with Task 7 and stays optional for good: an edition stored before it never changes, so it
 * never gains the member. `orders` is absent when no countable order exists, and nothing says whether one was left out.
 * `recipients` is two bounds, one while signed-out readers are not counted, or "not recorded" before six months are.
 */
export const TransparencyFigures = z.strictObject({
  restrictions: z.strictObject({ byGround: rows(FIGURE_LABELS.grounds), byMeasure: rows(FIGURE_LABELS.measures), total: Band }),
  noBreach: Band,
  intakes: rows(FIGURE_LABELS.intakes),
  appeals: rows(FIGURE_LABELS.appeals),
  reexaminations: rows(FIGURE_LABELS.reexaminations),
  accountMeasures: rows(FIGURE_LABELS.accountMeasures),
  automated: z.strictObject({
    findings: rows(RULE_IDS),
    measures: rows(RULE_IDS),
    /** Of the findings under R1, how many a person's final decision had restricted by the due day: only on a base of ten or more. */
    r1: z.strictObject({ base: Band, restricted: Band }).optional(),
  }),
  uploads: rows(["refused", "report", "no_report", "open"]).optional(),
  orders: OrderFigures.optional(),
  recipients: z.union([z.literal("not recorded"), z.strictObject({ low: Band, high: Band.optional() })]),
});
export type TransparencyFigures = z.infer<typeof TransparencyFigures>;

/** One stored version of a year's edition, as GET /api/public/transparency answers it. */
const EditionVersion = z.strictObject({
  version: z.number().int().min(1),
  publishedOn: Day,
  /** The day the next version was published, which replaced this one. */
  replacedOn: Day,
  reason: z.enum(EDITION_REASONS),
  figures: TransparencyFigures,
});

/**
 * GET /api/public/transparency (10.6): every year's newest version, newest year first, with its older versions. It reads
 * transparency_editions alone (the recipients' bounds are inside the figures) and nothing of a person.
 */
export const PublicTransparency = z.strictObject({
  editions: z.array(
    z.strictObject({
      year: z.number().int(),
      version: z.number().int().min(1),
      publishedOn: Day,
      method: z.number().int(),
      reason: z.enum(EDITION_REASONS),
      figures: TransparencyFigures,
      older: z.array(EditionVersion),
    }),
  ),
});
export type PublicTransparency = z.infer<typeof PublicTransparency>;

/**
 * GET /api/public/facts (10.6): what is switched on now, read from the API's settings: booleans, names, days and numbers,
 * never a token, a zone, a host or an address. Until the tasks that build them, the R1 check, the comparison with known
 * material and the head's witness print off; the edge prints its adapter (Task 3). `dpia` and `dpiaActs` are each a
 * tool's own impact assessment and the one that covers its measure, so no date of one tool stands over another.
 */
export const PublicFacts = z.strictObject({
  r1: z.strictObject({
    state: z.enum(["off", "flags", "withholds"]),
    test: z.boolean(),
    model: z.string().nullable(),
    digest: z.string().nullable(),
    threshold: z.number().nullable(),
    thresholdVersion: z.number().int().nullable(),
    publisherClaim: z.string().nullable(),
    dpia: Day.nullable(),
    dpiaActs: Day.nullable(),
  }),
  match: z.strictObject({
    state: z.enum(["off", "alerts", "seals"]),
    test: z.boolean(),
    source: z.string().nullable(),
    dpia: Day.nullable(),
    dpiaActs: Day.nullable(),
  }),
  edge: z.strictObject({ on: z.boolean(), test: z.boolean() }),
  witness: z.strictObject({ on: z.boolean(), test: z.boolean() }),
  /** Whether signed-out readers are counted (RECIPIENTS_SIGNED_OUT). */
  recipientsSignedOut: z.boolean(),
});
export type PublicFacts = z.infer<typeof PublicFacts>;
