import { STANDING_RULES, type AuthorCaseRow, type DecisionStrike } from "@korbat/contracts";

/**
 * The app's sentences about an account's standing (3e design, section 9), one table with the design's keys in brackets.
 * Every number in a sentence is printed from STANDING_RULES, never typed. Task 1 of 3e builds the strike's: the block
 * "Your standing" on Cases, the strike on its decision's screen, a case row's words for a strike and its overruling, and
 * the chip of a removed post whose strike counts. The other measures' sentences come with the tasks that build them.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const two = (n: number): string => String(n).padStart(2, "0");

/** A day on the device's own calendar: "16 Oct 2026". */
export function standingDay(at: string): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * A time as the app prints a measure's (section 9): the device's local date and time, then the UTC time in brackets, so
 * that the screen and korbat's mails name the same minute: "16 Oct 2026, 16:05 (14:05 UTC)".
 */
export function standingTime(at: string): string {
  const d = new Date(at);
  return `${standingDay(at)}, ${two(d.getHours())}:${two(d.getMinutes())} (${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC)`;
}

export const STANDING_TEXTS = {
  /** 9.4: the block above "About you". */
  cases: {
    title: "Your standing",
    /** [cases.strikes] */
    strikes: (n: number) =>
      `Active strikes: ${n} of ${STANDING_RULES.ladderStrikes}. At ${STANDING_RULES.ladderStrikes}, a moderator may announce a suspension; you would be told first and could reply.`,
    /** [cases.none] */
    none: "You have no active strikes.",
  },
  /** 9.2: a strike, on its post decision's screen. */
  strike: {
    /** [strike.counts] */
    counts: (endsAt: string) => `Strike: counts until ${standingTime(endsAt)}.`,
    /** [strike.expired] */
    expired: (endsAt: string) => `Strike: no longer counts since ${standingTime(endsAt)}.`,
    /** [strike.overruled] */
    overruled: (at: string) => `Strike: overruled on ${standingDay(at)}.`,
  },
  /** 9.4: the chip of a removed post while its strike stands and counts: "Removed: R3, strike until 10 Jan 2027". */
  chip: (chip: string, strikeUntil: string) => `${chip}, strike until ${standingDay(strikeUntil)}`,
} as const;

/** 9.4: what a row of "About you" says of a strike and of its overruling (CASE_ROW_WORDS). */
export const CASE_ROW_WORDS = {
  strike: "a strike",
  counts: (endsAt: string) => `counts until ${standingDay(endsAt)}`,
  expired: "no longer counts",
  overruled: "overruled",
  overrule: "strike overruled",
} as const;

/** The sentence of a decision's strike on its screen. */
export function strikeLine(strike: DecisionStrike): string {
  if (strike.state === "overruled") return STANDING_TEXTS.strike.overruled(strike.overruledAt ?? strike.countsUntil);
  return strike.state === "expired" ? STANDING_TEXTS.strike.expired(strike.countsUntil) : STANDING_TEXTS.strike.counts(strike.countsUntil);
}

/** What a row says of the strike its decision gave, after the post measure: "a strike (counts until 10 Jan 2027)". */
export function rowStrike(strike: NonNullable<AuthorCaseRow["strike"]>, now: Date): string {
  const where = strike.overruledAt !== null ? CASE_ROW_WORDS.overruled : Date.parse(strike.countsUntil) <= now.getTime() ? CASE_ROW_WORDS.expired : CASE_ROW_WORDS.counts(strike.countsUntil);
  return `${CASE_ROW_WORDS.strike} (${where})`;
}
