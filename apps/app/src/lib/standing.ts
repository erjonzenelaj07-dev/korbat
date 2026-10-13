import { STANDING_RULES, type AccountStanding, type AuthorCaseRow, type DecisionStrike } from "@korbat/contracts";

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
  /** 9.5: Settings, Profile, the handle. */
  handle: {
    /**
     * [handle.retired], while the profile holds a placeholder. Task 3 adds [handle.retired.suspended] and the refusals that
     * replace the form, which read /me's standing.
     */
    retired: "korbat retired your handle; the decision is under Settings, Cases. Choose a new one: the 30-day wait does not apply this time.",
    /** The standing sentence above the form. */
    standing: (current: string) => `Your handle is @${current}. You can change it once every 30 days. Handles you used before stay yours, except one that korbat retired.`,
    /** [handle.retired.suspended] (Task 3), while /me carries a running suspension: the form waits for its end. */
    retiredSuspended: "korbat retired your handle; the decision is under Settings, Cases. You can choose a new one when your suspension ends: the 30-day wait will not apply.",
  },
  /** 9.1: the banner above every signed-in screen while /me carries a standing measure. Task 3 builds its running suspension. */
  banner: {
    /** The region's label. */
    label: "Your account's standing",
    /** [banner.running] */
    running: (endsAt: string) =>
      `Your account is suspended until ${standingTime(endsAt)}. You can read, reply to korbat, appeal, export your data and delete your account. You cannot post, like, repost, bookmark, follow, edit your profile, upload images or report under korbat's rules.`,
    read: "Read the decision",
    appeal: "Appeal",
    export: "Export my data",
    delete: "Delete account",
  },
  /** 9.4: a write refused account_suspended, worded from /me's standing read after the refusal. */
  refused: {
    /** [refused.suspended] */
    suspended: (endsAt: string) => `Your account is suspended until ${standingTime(endsAt)}, so you cannot do this now.`,
    /** [refused.terminated] */
    terminated: "korbat has terminated your account, so you cannot do this.",
    /** [refused.over], when /me then shows no running measure. */
    over: "The suspension has just ended. Try again.",
    /** The link beside the sentence. */
    read: "Read the decision",
  },
  /** 9.6: the report form while the account is suspended: the rule choice is disabled. */
  report: {
    /** [report.suspended] */
    suspended: (endsAt: string) =>
      `Your account is suspended until ${standingTime(endsAt)}, so it cannot report under korbat's rules. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
  },
} as const;

/** The measure of /me's standing that runs now (a suspension or a termination), or null: what the banner, the refusals and the forms read. */
export function runningMeasure(standing: AccountStanding | null | undefined): NonNullable<AccountStanding["measure"]> | null {
  const measure = standing?.measure ?? null;
  return measure !== null && measure.state === "running" ? measure : null;
}

/**
 * The sentence a refused write shows (9.4), from /me's standing read after the refusal: a running suspension's end, a
 * termination, or, when /me then shows nothing running, that the suspension has just ended.
 */
export function refusalSentence(standing: AccountStanding | null | undefined): string {
  const running = runningMeasure(standing);
  if (running === null) return STANDING_TEXTS.refused.over;
  if (running.kind === "terminate" || running.endsAt === null) return STANDING_TEXTS.refused.terminated;
  return STANDING_TEXTS.refused.suspended(running.endsAt);
}

/** 9.4: what a row of "About you" says of a strike and of its overruling (CASE_ROW_WORDS). */
export const CASE_ROW_WORDS = {
  strike: "a strike",
  counts: (endsAt: string) => `counts until ${standingDay(endsAt)}`,
  expired: "no longer counts",
  overruled: "overruled",
  overrule: "strike overruled",
  /** A decision that retired the account's handle, and one that gave it back. */
  retired: "your handle retired",
  unretired: "handle given back",
  /** Task 3: a suspension (its days and whether it was announced come with Task 4's row members), and its lift. */
  suspended: "a suspension",
  lifted: "suspension lifted",
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
