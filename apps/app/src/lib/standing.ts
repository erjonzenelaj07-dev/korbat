import { REPLY_TEXT_MAX, RETENTION, STANDING_RULES, type AccountStanding, type AuthorCaseRow, type DecisionStrike, type DecisionView } from "@korbat/contracts";
import { ApiError } from "./api";

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

/** "3 days", "1 day". */
const daysOf = (days: number): string => `${days} ${days === 1 ? "day" : "days"}`;

/** What korbat decided, as the banner and the reply screen say it: "suspend your account for 3 days", or "terminate your account". */
const decidedTo = (kind: "suspend" | "terminate", days: number | null): string => (kind === "terminate" ? "terminate your account" : `suspend your account for ${daysOf(days ?? 1)}`);

/** The measure's noun, by its kind: "suspension" or "termination". */
export const measureNoun = (kind: "suspend" | "terminate"): "suspension" | "termination" => (kind === "terminate" ? "termination" : "suspension");

export const STANDING_TEXTS = {
  /** 9.4: the block above "About you". */
  cases: {
    title: "Your standing",
    /** [cases.strikes] */
    strikes: (n: number) =>
      `Active strikes: ${n} of ${STANDING_RULES.ladderStrikes}. At ${STANDING_RULES.ladderStrikes}, a moderator may announce a suspension; you would be told first and could reply.`,
    /** [cases.none] */
    none: "You have no active strikes.",
    /** [cases.reporting] (Task 5): a restriction of the account's reports that runs, else a warning that counts. */
    restricted: (until: string) => `Your reports under korbat's rules are restricted until ${standingTime(until)}.`,
    warned: (countsUntil: string) => `A warning about your reports counts until ${standingTime(countsUntil)}.`,
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
    /** [banner.unfixed], for a suspension or, with "terminate your account", a termination. */
    unfixed: (kind: "suspend" | "terminate", days: number | null, earliestStart: string) =>
      `korbat has decided to ${decidedTo(kind, days)}. Nothing is restricted yet. It will not start before ${standingTime(earliestStart)}; the exact time appears here within ${RETENTION.mailGiveUpDays} days, once korbat knows whether its email to you could be sent.`,
    /**
     * [banner.announced]. Its last sentence only while a reply is open (3e's review, people2): after korbat answered the
     * person's reply, a second one is refused and holds nothing.
     */
    announced: (kind: "suspend" | "terminate", days: number | null, startsAt: string, replyOpen = true) =>
      `korbat will ${decidedTo(kind, days)} from ${standingTime(startsAt)}. Nothing is restricted until then.${replyOpen ? " If you reply before it starts, it waits for korbat's answer." : ""}`,
    /** [banner.held], reading "The termination" for a termination. */
    held: (kind: "suspend" | "terminate", repliedAt: string, earliestStart: string) =>
      `You replied on ${standingDay(repliedAt)}. The ${measureNoun(kind)} does not start while your reply is unanswered. korbat answers you here and by email. If korbat keeps its decision, the ${measureNoun(kind)} starts with that answer, and never before ${standingTime(earliestStart)}.`,
    /** [banner.terminated]: its first two sentences, then the rest. */
    terminatedFirst: "korbat has terminated your account. You cannot post or interact; your posts stay visible for now.",
    terminated: (appealUntil: string) =>
      `korbat has terminated your account. You cannot post or interact; your posts stay visible for now. korbat deletes the account once the decision is final: on ${standingTime(appealUntil)} if you do not appeal, or when your appeal is answered and the decision kept. Until then you can reply, appeal, export your data, or delete the account yourself.`,
    /** [banner.appealed], after the first two sentences of [banner.terminated]. */
    appealed: "Your appeal is waiting for a reviewer. Nothing is deleted before it is answered.",
    /** [banner.replied], after [banner.terminated] or [banner.appealed]. */
    replied: "Your reply is waiting for an answer. Nothing is deleted before it is answered.",
    read: "Read the decision",
    reply: "Reply",
    appeal: "Appeal",
    export: "Export my data",
    delete: "Delete account",
  },
  /** 9.2: the block "Where it stands now" under a decision that holds a suspension or a termination, read fresh. */
  now: {
    title: "Where it stands now",
    /** [now.unfixed] */
    unfixed: (earliestStart: string) => `Start: not fixed yet, and not before ${standingTime(earliestStart)}.`,
    /** [now.announced]; a termination has no end to name. */
    announced: (startsAt: string, endsAt: string | null) => (endsAt === null ? `Starts on ${standingTime(startsAt)}.` : `Starts on ${standingTime(startsAt)}. Ends on ${standingTime(endsAt)}.`),
    /** [now.held] */
    held: (repliedAt: string) => `Held by your reply of ${standingDay(repliedAt)}: it has not started.`,
    /** [now.running] */
    running: (startsAt: string, endsAt: string) => `Started on ${standingTime(startsAt)}. Ends on ${standingTime(endsAt)}.`,
    /** [now.ended] */
    ended: (startsAt: string, endsAt: string) => `Ran from ${standingTime(startsAt)} to ${standingTime(endsAt)}.`,
    /** [now.never] */
    never: (liftedAt: string) => `Never started: korbat reversed it on ${standingDay(liftedAt)}.`,
    /** [now.withdrawn] */
    withdrawn: (liftedAt: string) => `Never started: korbat withdrew it on ${standingDay(liftedAt)} because it took another measure on your account.`,
    /** [now.lifted] */
    lifted: (liftedAt: string) => `Lifted on ${standingDay(liftedAt)}.`,
    /** [now.liftedEnded] */
    liftedEnded: (startsAt: string, endsAt: string, liftedAt: string) =>
      `Ran from ${standingTime(startsAt)} to ${standingTime(endsAt)}. korbat lifted it on ${standingDay(liftedAt)}: it no longer counts toward a later suspension.`,
    /** [now.basis.before], [now.basis.running] and [now.basis.after]; a protective suspension's read "korbat lifted the seal it rested on". */
    basis: {
      before: (endedAt: string, protective: boolean) =>
        protective ? `It will not start: korbat lifted the seal it rested on, on ${standingDay(endedAt)}.` : `It will not start: korbat reversed a decision it rested on, on ${standingDay(endedAt)}.`,
      running: (endedAt: string, protective: boolean) =>
        protective ? `Ended on ${standingDay(endedAt)}, because korbat lifted the seal it rested on.` : `Ended on ${standingDay(endedAt)}, because a decision it rested on was reversed.`,
      after: (startsAt: string, endsAt: string, endedAt: string, protective: boolean) =>
        `Ran from ${standingTime(startsAt)} to ${standingTime(endsAt)}. On ${standingDay(endedAt)} ${protective ? "korbat lifted the seal it rested on" : "korbat reversed a decision it rested on"}, so it no longer counts toward a later suspension.`,
    },
    /** [now.terminated] */
    terminated: (startsAt: string, appealUntil: string | null) =>
      `Started on ${standingTime(startsAt)}. It has no end date. The account is deleted once this decision is final${appealUntil === null ? "" : `: on ${standingTime(appealUntil)} if you do not appeal`}. Nothing is deleted while your appeal or your reply is unanswered.`,
    /** The link to the decision that lifted the measure, withdrew it, or broke its basis. */
    endedBy: "Read the decision that did this",
  },
  /** 9.2: what the measure rests on, each row a link to that decision's screen. */
  rests: {
    strike: (decidedAt: string, ruleId: string | null, where: string) => `Strike of ${standingDay(decidedAt)} under ${ruleId ?? "a rule"}: ${where}`,
    counts: (endsAt: string) => `counts until ${standingTime(endsAt)}`,
    expired: "no longer counts",
    overruled: (at: string) => `overruled on ${standingDay(at)}`,
    /** [rests.hint] */
    hint: `Each strike is appealed on its own decision's screen. If one is overruled and fewer than ${STANDING_RULES.ladderStrikes} of these still stand, this suspension ends at once.`,
    decision: (decidedAt: string) => `It rests on korbat's decision of ${standingDay(decidedAt)}.`,
    seal: (decidedAt: string) => `It rests on the decision of ${standingDay(decidedAt)} that keeps images of your account sealed.`,
    /** [rests.basis], and what it adds for a protective suspension. */
    basis: "That decision is appealed on its own screen. If it is reversed, this measure ends at once.",
    basisProtective: "You can appeal this suspension here without waiting for that.",
  },
  /** 9.2 and 9.3: the reply, on the decision's screen and on its own. */
  reply: {
    /** The decision's screen. */
    button: "Reply",
    replied: (filedAt: string) => `You replied on ${standingDay(filedAt)}.`,
    erased: (erasedAt: string) => `korbat erased the text on ${standingDay(erasedAt)}.`,
    waiting: "korbat has not answered yet.",
    answered: (answeredAt: string) => `korbat answered on ${standingDay(answeredAt)}.`,
    answer: "Read the answer",
    /** [reply.closed.withdrawn] */
    closedWithdrawn: (answeredAt: string) => `korbat withdrew this suspension on ${standingDay(answeredAt)} for another measure. That was no decision on your reply.`,
    /** [reply.closed.basis] */
    closedBasis: (answeredAt: string) => `korbat reversed a decision this suspension rested on, on ${standingDay(answeredAt)}, so your reply needs no answer.`,
    /** The reply screen (9.3). */
    title: "Reply to korbat",
    /** [reply.before] */
    before: (kind: "suspend" | "terminate", startsAt: string) => {
      const noun = measureNoun(kind);
      return `korbat has decided to ${kind === "terminate" ? "terminate" : "suspend"} your account from ${standingTime(startsAt)}. If you reply before then, the ${noun} does not start until a moderator has read your reply and answered you. The answer reverses the ${noun}, or keeps it; a kept ${noun} starts with the answer, and never before ${standingTime(startsAt)}, so replying early costs you nothing.`;
    },
    /** [reply.unfixed] */
    unfixed: (kind: "suspend" | "terminate", earliestStart: string) => {
      const noun = measureNoun(kind);
      return `korbat has decided to ${kind === "terminate" ? "terminate" : "suspend"} your account not before ${standingTime(earliestStart)}. If you reply before it starts, the ${noun} does not start until a moderator has read your reply and answered you. The answer reverses the ${noun}, or keeps it; a kept ${noun} starts with the answer, and never before ${standingTime(earliestStart)}, so replying early costs you nothing.`;
    },
    /** [reply.running] */
    running: (kind: "suspend" | "terminate", endsAt: string | null) =>
      kind === "terminate" || endsAt === null
        ? "Your account is terminated. A moderator reads your reply and answers you, and can end the termination at once. Nothing is deleted before your reply is answered."
        : `Your account is suspended until ${standingTime(endsAt)}. A moderator reads your reply and answers you, and can end the suspension at once. The suspension goes on meanwhile.`,
    field: "Your reply (optional)",
    count: (n: number) => `${n} of ${REPLY_TEXT_MAX} characters`,
    /** [reply.hint] */
    hint: "Say anything you want the moderator to weigh: what happened, what the decision gets wrong, what you will do differently. You do not need to cite rules. You can send it empty: that still asks for a second look.",
    /** [reply.once] */
    once: "You can reply once to this decision. Replying does not use up your appeal.",
    /** [reply.kept] */
    kept: "A moderator reads your reply. korbat keeps its text until it has answered you and this decision can no longer be appealed, then erases it.",
    send: "Send reply",
    /** [reply.sent.onTime] */
    sentOnTime: (kind: "suspend" | "terminate", filedAt: string) => `korbat received your reply on ${standingTime(filedAt)}, before the start. The ${measureNoun(kind)} is held until korbat answers.`,
    /** [reply.sent.late] */
    sentLate: (kind: "suspend" | "terminate", filedAt: string) =>
      kind === "terminate"
        ? `korbat received your reply on ${standingTime(filedAt)}. The termination stays until korbat answers, and nothing is deleted before that.`
        : `korbat received your reply on ${standingTime(filedAt)}. The suspension goes on until korbat answers.`,
    /** When the decision takes no reply now: the API's own sentence for reply_not_open. */
    closed: "You cannot reply to this decision: you already replied, or it has ended or was lifted.",
    back: "Back to the decision",
  },
  /** 9.2: above the appeal of an announced measure, and after a kept answer to a reply sent before the start. */
  appeal: {
    /** [appeal.early] */
    early: "You can appeal now; you do not have to wait for the start. An appeal does not hold the start: only a reply sent before the start does.",
    /** [appeal.again] */
    again: (answeredAt: string, appealUntil: string) =>
      `korbat kept this decision after your reply, on ${standingDay(answeredAt)}. You can appeal until ${standingTime(appealUntil)}: the six months count again from that answer.`,
  },
  /** [terminate.delete]: beside a termination's appeal, and in Settings, Account above "Delete account" while /me carries a termination. */
  terminateDelete: "If you delete your account now, your appeal ends with it: nothing is left to restore.",
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
  /** 9.6: the report form while the account is suspended, or (Task 5) while its reports are restricted: the rule choice is disabled. */
  report: {
    /** [report.suspended] */
    suspended: (endsAt: string) =>
      `Your account is suspended until ${standingTime(endsAt)}, so it cannot report under korbat's rules. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
    /** [report.restricted] */
    restricted: (until: string) =>
      `korbat has restricted your reports under its rules until ${standingTime(until)}, after a warning, because several of them were plainly unfounded. The decision is under Settings, Cases, where you can appeal it. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.`,
  },
  /** 9.2 (Task 5): where a decision's restriction of reporting stands now, from DecisionView.reportingStanding. */
  reporting: {
    title: "Where it stands now",
    running: (until: string) => `Runs until ${standingTime(until)}.`,
    ended: (endedAt: string) => `Ended on ${standingDay(endedAt)}.`,
    lifted: (liftedAt: string) => `Lifted on ${standingDay(liftedAt)}.`,
    /** [now.warningGone] */
    warningGone: (endedAt: string) => `Ended on ${standingDay(endedAt)} with the warning it rested on, which korbat lifted.`,
  },
  /** 9.4 (Task 5): on the line of an item a moderator marked, once its outcome is released. */
  reports: {
    /** [reports.marked], while a re-examination of the item is open. */
    marked: "A moderator marked this report as manifestly unfounded (Terms, Reporting in bad faith). You can ask for a re-examination.",
    /** Its first sentence alone, once no re-examination is open (asked for, answered, or past its window; 3e's review, people8). */
    markedClosed: "A moderator marked this report as manifestly unfounded (Terms, Reporting in bad faith).",
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

/**
 * Whether a write was refused for a running suspension or termination (403 account_suspended, 9.4): the screen then shows
 * refusalSentence from /me, which the session reads again after such a refusal, in place of the server's sentence.
 */
export function isSuspendedRefusal(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === "account_suspended";
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
  /**
   * 3e's review (people7; design, section 9.4): a suspension with its days and whether it was announced, a termination,
   * a withdrawal for another measure, the lift of a termination (a lift of a suspension reads "suspension lifted"), and a
   * suspension or termination that rested on a decision this one reversed.
   */
  suspendedFor: (days: number, announced: boolean) => `a suspension of ${days} ${days === 1 ? "day" : "days"}, ${announced ? "announced" : "at once"}`,
  terminated: "a termination",
  withdrawn: "suspension withdrawn for another measure",
  terminationLifted: "termination lifted",
  standingEnded: { suspend: "a suspension that rested on it ended", terminate: "a termination that rested on it ended" },
  /** Task 5: a warning about the account's reports, a restriction of them with its days, and the lift of either. */
  warned: "a warning about your reports",
  restricted: (days: number) => `your reports under the rules restricted for ${days} ${days === 1 ? "day" : "days"}`,
  reportingLifted: "warning or restriction lifted",
  /** Task 5: on a decision whose reversal ended a restriction of reporting that rested on it. */
  restrictionEnded: "a restriction of your reports that rested on it ended",
} as const;

/** 9.4 (Task 5): the Cases block's reporting line, from /me's standing: the restriction that runs, else the warning that counts, else none. */
export function reportingLine(standing: AccountStanding | null | undefined): string | null {
  const reporting = standing?.reporting ?? null;
  if (reporting === null) return null;
  if (reporting.restriction !== null) return STANDING_TEXTS.cases.restricted(reporting.restriction.until);
  return reporting.warning === null ? null : STANDING_TEXTS.cases.warned(reporting.warning.countsUntil);
}

/** 9.6 (Task 5): the end of the restriction of /me's reports while it runs, or null. */
export const reportsRestrictedUntil = (standing: AccountStanding | null | undefined): string | null => standing?.reporting?.restriction?.until ?? null;

/**
 * 9.2 (Task 5): the sentence of "Where it stands now" for a decision's restriction of reporting, and the decision to link
 * to when it was lifted or ended with its warning.
 */
export function reportingNowLine(standing: NonNullable<DecisionView["reportingStanding"]>): { text: string; link: string | null } {
  switch (standing.state) {
    case "running":
      return { text: STANDING_TEXTS.reporting.running(standing.until), link: null };
    case "ended":
      return { text: STANDING_TEXTS.reporting.ended(standing.until), link: null };
    case "lifted":
      return { text: STANDING_TEXTS.reporting.lifted(standing.endedAt ?? standing.until), link: standing.endedBy };
    case "basis_ended":
      return { text: STANDING_TEXTS.reporting.warningGone(standing.endedAt ?? standing.until), link: standing.endedBy };
  }
}

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

/**
 * The banner's sentences for /me's measure (9.1), in order, or null when it shows nothing: a suspension or a termination
 * whose start is not fixed, announced or held by a reply; a running suspension; a running termination, with [banner.appealed]
 * in place of its last sentences while its appeal is pending and [banner.replied] after while its reply is unanswered.
 */
export function bannerSentences(standing: AccountStanding | null | undefined): string[] | null {
  const measure = standing?.measure ?? null;
  if (measure === null) return null;
  const { kind, days } = measure;
  if (measure.state === "unfixed") return [STANDING_TEXTS.banner.unfixed(kind, days, measure.earliestStart)];
  if (measure.state === "announced") return measure.startsAt === null ? [STANDING_TEXTS.banner.unfixed(kind, days, measure.earliestStart)] : [STANDING_TEXTS.banner.announced(kind, days, measure.startsAt, measure.replyOpen)];
  if (measure.state === "held") return [STANDING_TEXTS.banner.held(kind, measure.reply?.filedAt ?? measure.earliestStart, measure.earliestStart)];
  if (kind === "suspend") return measure.endsAt === null ? null : [STANDING_TEXTS.banner.running(measure.endsAt)];
  const first = measure.appealPending || measure.appealUntil === null ? [STANDING_TEXTS.banner.terminatedFirst, ...(measure.appealPending ? [STANDING_TEXTS.banner.appealed] : [])] : [STANDING_TEXTS.banner.terminated(measure.appealUntil)];
  const replied = measure.reply !== null && measure.reply.answeredAt === null ? [STANDING_TEXTS.banner.replied] : [];
  return [...first, ...replied];
}

/** The measure a decision holds, from its statement: a suspension's or a termination's kind and days. */
export function standingMeasureOf(view: Pick<DecisionView, "measures">): { kind: "suspend" | "terminate"; days: number | null; basis: string | null } | null {
  const measure = view.measures.find((entry) => entry.kind === "suspend" || entry.kind === "terminate");
  if (!measure || (measure.kind !== "suspend" && measure.kind !== "terminate")) return null;
  return { kind: measure.kind, days: measure.days ?? null, basis: measure.basis ?? null };
}

/**
 * The sentence of "Where it stands now" (9.2) for a decision's measure, from DecisionView.standing: by its state, and for
 * one that ended before its time, by where it was when it ended (its start and end against the moment it ended). The API
 * sends the period's end cut to a lift or to the break of its basis, so an end at that very moment means the measure was
 * running then, and only an end before it means it had run out (3e's review, people5).
 */
export function nowSentence(standing: NonNullable<DecisionView["standing"]>, kind: "suspend" | "terminate", protective: boolean, appealUntil: string | null = null): string {
  const { startsAt, endsAt, endedAt } = standing;
  const ended = endedAt ?? standing.earliestStart;
  switch (standing.state) {
    case "unfixed":
      return STANDING_TEXTS.now.unfixed(standing.earliestStart);
    case "announced":
      return startsAt === null ? STANDING_TEXTS.now.unfixed(standing.earliestStart) : STANDING_TEXTS.now.announced(startsAt, kind === "terminate" ? null : endsAt);
    case "held":
      return STANDING_TEXTS.now.held(standing.reply?.filedAt ?? standing.earliestStart);
    case "running":
      if (kind === "terminate" || endsAt === null) return STANDING_TEXTS.now.terminated(startsAt ?? standing.earliestStart, appealUntil);
      return STANDING_TEXTS.now.running(startsAt ?? standing.earliestStart, endsAt);
    case "ended":
      return STANDING_TEXTS.now.ended(startsAt ?? standing.earliestStart, endsAt ?? ended);
    case "never":
      return standing.replaced ? STANDING_TEXTS.now.withdrawn(ended) : STANDING_TEXTS.now.never(ended);
    case "lifted":
      return startsAt !== null && endsAt !== null && Date.parse(endsAt) < Date.parse(ended) ? STANDING_TEXTS.now.liftedEnded(startsAt, endsAt, ended) : STANDING_TEXTS.now.lifted(ended);
    case "basis_ended":
      if (startsAt === null || Date.parse(startsAt) > Date.parse(ended)) return STANDING_TEXTS.now.basis.before(ended, protective);
      if (endsAt === null || Date.parse(endsAt) >= Date.parse(ended)) return STANDING_TEXTS.now.basis.running(ended, protective);
      return STANDING_TEXTS.now.basis.after(startsAt, endsAt, ended, protective);
  }
}

/** A strike the measure rests on, as its row says it: "Strike of 4 Oct 2026 under R1: counts until ...". */
export function restsOnLine(entry: NonNullable<DecisionView["standing"]>["restsOn"][number]): string {
  const where =
    entry.state === "overruled" ? STANDING_TEXTS.rests.overruled(entry.overruledAt ?? entry.decidedAt) : entry.state === "expired" || entry.countsUntil === null ? STANDING_TEXTS.rests.expired : STANDING_TEXTS.rests.counts(entry.countsUntil);
  return STANDING_TEXTS.rests.strike(entry.decidedAt, entry.ruleId, where);
}

/**
 * Where the person's reply stands (9.2), after "You replied on": not answered yet; answered, with the answer's screen;
 * or closed without an answer on its merits, by a withdrawal for another measure or by the reversal its basis rested on.
 */
export function replyStandsLine(standing: NonNullable<DecisionView["standing"]>): { text: string; link: string | null } | null {
  const reply = standing.reply;
  if (reply === null) return null;
  if (reply.answeredAt === null) return { text: STANDING_TEXTS.reply.waiting, link: null };
  if (standing.state === "never" && standing.replaced) return { text: STANDING_TEXTS.reply.closedWithdrawn(reply.answeredAt), link: reply.answeredBy };
  if (standing.state === "basis_ended" && reply.answeredBy !== null && reply.answeredBy === standing.endedBy) return { text: STANDING_TEXTS.reply.closedBasis(reply.answeredAt), link: reply.answeredBy };
  return { text: STANDING_TEXTS.reply.answered(reply.answeredAt), link: reply.answeredBy };
}
