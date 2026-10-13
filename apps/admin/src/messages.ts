import { REPLY_AIM_HOURS, RETENTION, STANDING_RULES, type AppealsReviewedParams, type AuthorStanding, type CaseDecision, type ItemOutcome, type ModerationErrorCode, type ReviewerState, type StaffErrorCode } from "@korbat/contracts";

/**
 * The console's own words for every code it can receive (3a design, section 10) and for every outcome it shows (3c
 * design, section 8), one table each. The server's message is never shown: the console words each code from these
 * tables, so a changed or hostile API answer cannot put its own text on the page, and no staff screen ever shows the
 * text of a passkey code, whose remedies are the app's.
 */

/** The ten staff codes, in the design's words. */
export const STAFF_MESSAGES: Record<StaffErrorCode, string> = {
  staff_session_required: "Your staff session ended. Sign in with your staff key.",
  staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
  staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
  staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
  staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
  staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
  staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
  staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
  staff_step_up_required: "Confirm this with your staff key.",
  staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
};

/**
 * 3e (design, section 8.3): the two sentences that also word a code of the moderation table, the standing measure that
 * is already in the way and a termination under R2.
 */
const STANDING_CONFLICT =
  'Not open: a suspension or termination of this account already stands and has not ended. To change it, lift it first with a correction of its decision. If it is announced and has not started, and an admin must take a measure at once, use "Withdraw it for another measure" on that decision: the person is then told that korbat withdrew it for another measure, not that their reply succeeded.';
const STANDING_TERMINATE_R2 =
  "No termination under R2: korbat's staff do not open images reported this way, so korbat has not assessed them and nothing is established. A protective suspension is the most a sealed report allows.";

/**
 * The console's sentences about an account's standing (3e design, section 8), each under the design's key. Every number
 * in one is printed from STANDING_RULES or from the answer, never typed, so that a table test can hold them.
 */
export const STANDING_WORDS = {
  /** 8.2: the line under "Restrict" of "Decide the case" on a post case. It is not a choice. */
  strike: {
    due: "This decision gives a strike: it restricts a post under a korbat rule, and the post was made after its author was told of their newest strike, or they have none. You do not choose this. It counts also when the post is already removed or deleted.",
    none: {
      interim: "No strike: a measure taken while deciding never gives one.",
      law: "No strike: a decision on the law alone never gives one.",
      r2: "No strike: a decision under R2, or one that answers a report of child sexual abuse material, never gives one.",
      already: "No strike: this post already carries a strike that stands.",
      before: "No strike: the author posted this before they were told of their newest strike, so it is no repeat after that warning.",
    },
  },
  /** 8.2: the author's standing above the evidence of a post case, in bands. */
  bands: {
    activeStrikes: { "0": "Active strikes: none", "1": "Active strikes: 1", "2": "Active strikes: 2", "3_or_more": "Active strikes: 3 or more" } satisfies Record<AuthorStanding["activeStrikes"], string>,
    suspensionsInYear: {
      "0": `Suspensions decided in the last ${STANDING_RULES.ladderMemoryDays} days: none`,
      "1": `Suspensions decided in the last ${STANDING_RULES.ladderMemoryDays} days: 1`,
      "2_or_more": `Suspensions decided in the last ${STANDING_RULES.ladderMemoryDays} days: 2 or more`,
    } satisfies Record<AuthorStanding["suspensionsInYear"], string>,
    now: {
      none: "Now: no measure",
      announced: "Now: a suspension is announced",
      suspended: "Now: suspended",
      terminated: "Now: terminated, waiting for deletion",
    } satisfies Record<AuthorStanding["now"], string>,
  },
  /** [post.standing] */
  postStanding: "Decide this post on what it says. The author's standing never makes a post a breach; it is shown so that you know what a strike here leads to.",
  /** 8.7: [review.strike], beside a review or a correction of a decision that gave a strike that stands. */
  reviewStrike: "A strike falls only with its whole finding: the console adds its overruling when you choose Reverse, and never with Reverse in part.",
  /** 8.7: [review.rests], when a suspension that stands rests on the reviewed decision's strike. */
  reviewRests: `A suspension of this account rests on this strike. If you reverse this decision and fewer than ${STANDING_RULES.ladderStrikes} of its strikes then stand, the suspension loses its basis when you confirm: one that has not started will not start, one that runs ends, and one that has already ended no longer counts toward a later suspension. This decision's statement says which. A reply to it that nobody answered is answered by your decision.`,
  /** 8.3: [conflict] */
  conflict: STANDING_CONFLICT,
  /** 8.3: [terminate.r2] */
  terminateR2: STANDING_TERMINATE_R2,
  /** 8.3: the retirement of a handle, beside its control in the composer of an account case. */
  retire: {
    /** [retire.what] */
    what: "Retiring a handle takes it from everyone for good, its holder included. Use it when the breach lies in the handle itself: impersonation, a doxxed name, a threat. The profile then shows a placeholder (retired_ and 12 characters), and its holder may choose a new handle at once, or, if the account is suspended, when that suspension ends.",
    /** [retire.first], once it is chosen. */
    first: "The retirement is this decision's first measure. A reset of the display name added to it copies the placeholder, never the retired handle.",
    /** [retire.moved], when the profile's handle now differs from the newest snapshot's. */
    moved: "The account changed its handle after this snapshot. Confirming retires the handle shown in the snapshot and leaves the new one alone. To judge the new handle, take a fresh snapshot.",
    /** [retire.none], greying the control while the profile holds a placeholder. */
    none: "Not open: this profile holds a placeholder, so there is no handle to retire.",
  },
  /** 8.7: [review.handle], beside "Give the handle back" in a correction or a review. */
  reviewHandle: "Giving the handle back clears its retirement. A profile that still holds the placeholder gets the handle again; one that chose another handle since may change back at once.",
  /** 8.3: [reports.first], greying a measure that rests on the account's record, or on a seal in another decision, while the case holds a report. */
  reportsFirst: "Not open: this case holds a report that is not answered yet. Decide the reports in this case first; the measure gets a case of its own.",
  /** 8.3: [facts], beside a standing measure's drafted facts. */
  facts: "The facts are drafted from the record as this page read it (W.5): they say when. Write the reason yourself: why this measure, and why this length.",
  /** 8.3: [preview.times], under the preview of a standing measure. */
  previewTimes: "The exact start and end are fixed by the database after you confirm; the person's screen shows them.",
  /** 8.3: a suspension at once, its four grounds, and why the control is greyed. Task 3 builds these. */
  atOnce: {
    /** The control's name. */
    label: "Suspend at once",
    /** [atOnce.what] */
    what: "A suspension at once restricts the account when you confirm. Only an admin takes one, and only on a ground the database checks. The statement goes at once; the account may reply and appeal from the first minute, and a reply does not pause it.",
    /** [atOnce.threat] */
    threat: `Direct threat (R5): a final decision under R5 that restricts a post of this account stands and is at most ${STANDING_RULES.basisAgeDays} days old. Up to ${STANDING_RULES.threatDays} days. It ends by itself if that decision is reversed.`,
    /** [atOnce.terrorist] */
    terrorist: `Terrorist content: a final decision on the law, marked terrorist content, that restricts a post of this account stands and is at most ${STANDING_RULES.basisAgeDays} days old. Up to ${STANDING_RULES.terroristDays} days. It ends by itself if that decision is reversed.`,
    /** [atOnce.flood], with standing.flood's count and interval. */
    flood: (posts: number, from: string, to: string) =>
      `Spam flood (R6): the account made ${posts} posts between ${from} and ${to}; the ground needs at least ${STANDING_RULES.floodPosts} in ${STANDING_RULES.floodMinutes} minutes. Up to ${STANDING_RULES.floodDays} days. The count alone is no flood: say in the facts what made the posts repetitive and unsolicited.`,
    /** [atOnce.protective], with the day of the seal for good it would rest on (standing.seal.decidedOn), when there is one. */
    protective: (sealedOn: string) =>
      `Protective: an admin sealed images of this account for good on ${sealedOn}, at most ${STANDING_RULES.basisAgeDays} days ago, and no protective suspension has rested on that seal. Up to ${STANDING_RULES.protectiveDays} days, once for that seal. Seal first, in the case the report is in; then suspend here, in a decision of its own. korbat's staff do not open images reported this way, so the facts and the reason never say or imply that the account posted such material, and they promise no later look by staff. It is no finding, gives no strike, is no step of the ladder and supports no termination. It ends on its date, or earlier if the seal is lifted. Its appeal is reviewed at once by an admin who took no part; only the seal's own appeal waits for the authorities.`,
    /** [atOnce.noSeal], the protective ground when it is not met. */
    noSeal: `Not met now: a protective suspension rests on a seal for good of images of this account or of one of its posts, decided at most ${STANDING_RULES.basisAgeDays} days ago, on which no protective suspension has rested yet. A report alone, or a seal taken while deciding, is not enough.`,
    /** [atOnce.admin] */
    admin: "Only an admin suspends at once. You can withhold the content while deciding; the account measure waits for an admin.",
    /** [atOnce.other], for a rule that allows none (R1, R3 or R4). */
    other: "This rule allows no suspension at once: announce it.",
    /** Beside each ground: whether the database would accept it now. [atOnce.unmet] */
    met: "Met now",
    unmet: "Not met now",
    /** How many days, at most the ground's own number. */
    days: (max: number) => `Days (1 to ${max})`,
  },
  /** 8.7: [review.basis], when a suspension or termination taken at once rests on the reviewed decision. */
  reviewBasis: "A suspension (or termination) of this account rests on this decision. If you reverse it, or lift the seal, that measure ends when you confirm, and this decision's statement says so.",
  /** 8.7: [review.protective], beside the review or correction of a protective suspension. */
  reviewProtective: "A protective suspension is reviewed at once, on what korbat knows: the review does not wait for the authorities, and it may lift the suspension while the seal stays. Only the appeal of the seal's own decision waits.",
  // ---------------------------------------------------------------- 3e Task 4 (design, sections 8.3 and 8.5 to 8.8)
  /** 8.3: an announced suspension. */
  suspend: {
    /** The control's name. */
    label: "Announce a suspension",
    /** [suspend.what] */
    what: (days: number) =>
      `This announces a suspension of ${days} ${days === 1 ? "day" : "days"}. Nothing is restricted when you confirm. The account is mailed at once and may reply. With no reply the suspension starts by itself, ${STANDING_RULES.replyWindowHours} hours after korbat sent the mail, on your signature: nobody acts at the start. korbat cannot see whether the mail reached the person; the app always shows the notice.`,
    /** [suspend.days], with the rung the database would accept now and the step it would be. */
    days: (maxDays: number, n: number) =>
      `At most ${maxDays} days: this would be the account's suspension number ${n} in ${STANDING_RULES.ladderMemoryDays} days, and the steps are ${STANDING_RULES.ladderDays.join(", ")} days. Shorter is allowed, down to 1 day; a shorter suspension still uses its step.`,
    /** [suspend.rule] */
    rule: (ladderRule: string) =>
      `The decision cites ${ladderRule}, the rule of the newest strike; the composer sets it. The statement names korbat's terms as its ground, that rule as the rule of the newest strike, and every strike it rests on.`,
    /** [suspend.short] */
    short: (activeStrikes: number) => `Not open: an announced suspension needs ${STANDING_RULES.ladderStrikes} active strikes. This account has ${activeStrikes}.`,
    /** [suspend.stale] */
    stale: "Not open: no strike is newer than the account's last suspension under the ladder. A next step needs at least one new strike.",
    /** How many days, at most the rung. */
    daysLabel: (max: number) => `Days (1 to ${max})`,
  },
  /** 8.3: a termination, announced or at once. */
  terminate: {
    announceLabel: "Announce a termination",
    atOnceLabel: "Terminate at once",
    /** [terminate.what] */
    what: "A termination is a suspension without end. Until the decision is final for the account (six months unused, or its appeal answered and kept) the account is only suspended: it signs in, replies, appeals, exports and may delete itself, and its posts stay visible. Nothing is deleted while its appeal or its reply, on time or late, is unanswered. Then korbat deletes it, and keeps nothing to recognise a new account of the person by; images that korbat sealed stay for the authorities.",
    /** [terminate.notYet] */
    notYet: `Not open: an announced termination needs ${STANDING_RULES.ladderDays.length} suspensions under the ladder decided in the last ${STANDING_RULES.ladderMemoryDays} days, whatever their length, and ${STANDING_RULES.ladderStrikes} active strikes of which one is newer than the last of them.`,
    /** [terminate.noRepeat] */
    noRepeat: `Not open: a termination at once needs a second direct threat after a suspension for the first. That is: a suspension at once for a direct threat, decided in the last ${STANDING_RULES.ladderMemoryDays} days, that still stands with the decision it rests on; and a final R5 decision at most ${STANDING_RULES.basisAgeDays} days old about a post the account made after it was told of that suspension. A second post from before the suspension, or a first threat that was overruled, is no ground.`,
    /** Only an admin terminates. */
    admin: "Only an admin terminates an account.",
  },
  /** 8.5: the queue's first section, and the block "Reply" under the decision that holds the measure. */
  reply: {
    title: "Replies to answer",
    none: "No reply waits.",
    /** Where a reply stands, in a queue row. */
    before: "before the start: the suspension is held",
    after: (endsAt: string) => `after the start: it runs until ${endsAt}`,
    afterEnded: (endsAt: string) => `after the start: it ended on ${endsAt}`,
    suspension: (days: number) => `Suspension, ${days} ${days === 1 ? "day" : "days"}`,
    termination: "Termination: nothing is deleted before the reply is answered",
    /** A row that has waited longer than korbat's aim. */
    overAim: `waiting more than ${REPLY_AIM_HOURS} hours`,
    blockTitle: "Reply",
    writtenBy: "Written by the account's holder",
    /** [reply.empty] */
    empty: "The reply has no text: the person asks for a second look.",
    /** [reply.onTime] */
    onTime: "Filed before the start: the suspension has not started and does not start until someone answers, however long that takes.",
    /** [reply.late] */
    late: "Filed after the start: the suspension goes on while you read.",
    /** [reply.lateEnded] */
    lateEnded: (endedAt: string) => `Filed after the start: the suspension ended on ${endedAt}. The reply is still answered.`,
    /** [reply.basisGone] */
    basisGone: "The decision that reversed what this suspension rested on answered this reply: the suspension does not start, or ended with that decision. Nothing is left to keep.",
    answered: (at: string) => `Answered on ${at}.`,
    answerLabel: "Answer this reply",
    /** [reply.reason] */
    reason: "Write the reason for the person: say what you weighed in their reply. They receive it by email, and can still appeal the decision.",
    /** [reply.same] */
    same: "You may answer a reply to your own decision: the reply is the hearing, not the appeal. An appeal goes to another staff member.",
    /** [reply.admin] */
    admin: "A reply to a suspension taken at once, or to a termination, is answered by an admin.",
    keepLabel: "Keep",
    reverseLabel: "Reverse",
  },
  /** 8.5: what each answer does, by when the reply came. */
  keep: {
    /** [keep.onTime] */
    onTime: (earliestStart: string, days: number | null) =>
      `It starts when you confirm, or on ${earliestStart} if that is later: never before the time the person was given. ${days === null ? "It has no end" : `It runs ${days} ${days === 1 ? "day" : "days"} from then`}, and the person's six months to appeal count again from your answer.`,
    /** [keep.late] */
    late: (endsAt: string) => `Nothing changes; it runs until ${endsAt}.`,
    /** [keep.lateEnded] */
    lateEnded: (endedAt: string) => `Nothing changes; it ended on ${endedAt}, as decided.`,
  },
  reverse: {
    /** [reverse.onTime] */
    onTime: "It never starts.",
    /** [reverse.late] */
    late: "It ends when you confirm.",
    /** [reverse.lateEnded] */
    lateEnded: (endedAt: string) => `It ended on ${endedAt}. Reversing it takes it off the record: it no longer counts toward a later suspension.`,
  },
  /** 8.7: "Withdraw it for another measure". */
  replace: {
    label: "Withdraw it for another measure",
    /** [replace.what] */
    what: "Use this only to make room for a measure at once: after you confirm, take that measure in the account's case. The person is told that korbat withdrew the announced suspension because it is taking another measure, and that this is no decision on their reply. A withdrawn suspension was never a step of the ladder.",
    /** [replace.reply] */
    reply: "The person's reply is closed by this withdrawal without an answer on its merits. Say in the reason that their reply was read, if it was, and that they can reply to the new measure.",
  },
  /** 8.7: [review.reply] */
  reviewReply:
    "This review also answers the person's reply. Keep, and Reverse in part when the suspension stays, answer it as a kept answer does: a suspension held by the reply then starts when you confirm, or at its announced time if that is later. Read the reply before you decide; its text is kept until it is answered.",
  /** 8.7: [review.admin] */
  reviewAdmin: "A decision that holds a termination, or a measure taken at once, is reviewed and corrected by an admin.",
  /** 8.6: the Standing screen. */
  lists: {
    title: "Standing",
    strikesTitle: `Accounts at ${STANDING_RULES.ladderStrikes} strikes`,
    /** A row of the accounts at the ladder's strikes. */
    strikesRow: (handle: string, activeStrikes: number, rule: string, day: string, maxDays: number | null, mayTerminate: boolean) =>
      `@${handle}: ${activeStrikes} active strikes, the newest under ${rule} on ${day}. ${mayTerminate ? "A termination can be announced." : `A suspension of at most ${maxDays ?? 0} days can be announced.`}`,
    /** [lists.strikes] */
    strikes: `An account appears here while it has ${STANDING_RULES.ladderStrikes} active strikes, one of them newer than its last suspension under the ladder, and no suspension or termination that stands and has not ended. Nothing happens by itself: a moderator opens a case, reads the strikes' decisions and decides.`,
    /** [lists.finding] */
    finding: "Opening the case is a finding of your own, so you cannot review an appeal in it.",
    openCase: "Open a case on this account",
    reportingTitle: "Reporting records",
    reportingRow: (handle: string, unfounded: number, reports: number) => `@${handle}: ${unfounded} of the ${reports} rule reports sent in the last ${STANDING_RULES.reportFrameDays} days hold a mark manifestly unfounded.`,
    /** Task 5: after a reporting record's row, whether the account is at the warning's threshold or was warned. */
    reportingThreshold: "At the warning threshold.",
    reportingWarned: (warnedOn: string, marksSince: number) => `Warned on ${warnedOn}; ${marksSince} of the reports sent since then are marked.`,
    noticesTitle: "Notices not sent",
    noticesRow: (handle: string, decidedOn: string, startsAt: string) =>
      `@${handle}: korbat's mail service could not send the notice of ${decidedOn}: it refused the address, or the mail was given up after ${RETENTION.mailGiveUpDays} days. Only the app carries the notice, so it starts on ${startsAt}, ${STANDING_RULES.undeliveredHours} hours after the decision.`,
    terminationsTitle: "Terminations waiting",
    terminatedOn: (handle: string, decidedOn: string) => `@${handle}: terminated on ${decidedOn}.`,
    finalOn: (finalOn: string) => `Final on ${finalOn}; the account is deleted in the first round after that.`,
    appealHolds: "An appeal is pending: nothing is deleted before it is answered.",
    replyHoldsStart: "A reply is unanswered: it has not started.",
    replyHolds: "A reply is unanswered: nothing is deleted before it is answered.",
    empty: "None.",
    more: (total: number, shown: number) => `${total - shown} more not listed here.`,
  },
  /** 8.8: the home screen's two lines. */
  home: {
    replies: (n: number, age: string) =>
      `Replies waiting: ${n}, the oldest for ${age}. A held suspension does not start until its reply is answered, and a terminated account is not deleted before its reply is.`,
    strikes: (n: number) => `Accounts at ${STANDING_RULES.ladderStrikes} strikes: ${n}.`,
  },
  // ---------------------------------------------------------------- 3e Task 5 (design, sections 8.3, 8.4 and 8.7)
  /** 8.3: the warning about reporting and the restriction of it. Both cite R6; the composer sets it. */
  reporting: {
    warnLabel: "Warn about reporting",
    restrictLabel: "Restrict reporting",
    /** Beside both controls. */
    rule: "Both measures cite R6; the composer sets it.",
    /** [warn.what], with the account's counts as this page read them. */
    warnWhat: (unfounded: number, reports: number) =>
      `A warning restricts nothing. It tells the account that ${unfounded} of the ${reports} reports it sent under the rules in the last ${STANDING_RULES.reportFrameDays} days were marked manifestly unfounded, lists them, and says that ${STANDING_RULES.reportRestrictMarks} marked reports among those it sends after the warning may lead to a restriction. A report counts once, however many of its items were marked, and by the day it was sent. A notice of illegal content is never counted.`,
    /** [warn.short] */
    warnShort: (unfounded: number, reports: number) =>
      `Not open: a warning needs at least ${STANDING_RULES.reportWarnMarks} marked reports among those the account sent in the last ${STANDING_RULES.reportFrameDays} days, and they must be at least half of its rule reports sent in that time. This account has ${unfounded} of ${reports}. One report never reaches the number alone.`,
    /** [warn.standing] */
    warnStanding: (warnedOn: string) => `Not open: the warning of ${warnedOn} still counts.`,
    /** [restrict.what], with the days chosen. */
    restrictWhat: (days: number) =>
      `This stops the account's reports under korbat's rules for ${days} ${days === 1 ? "day" : "days"}, from the moment you confirm; the warning was its notice, and the restriction ends with it if the warning is lifted. At most ${STANDING_RULES.reportRestrictDays} days. Notices of illegal content, reports of child sexual abuse material and requests for re-examination stay open to it.`,
    /** [restrict.noWarning] */
    restrictNoWarning: "Not open: the account has no warning that still counts. Warn first.",
    /** [restrict.short] */
    restrictShort: (marksSince: number, warnedOn: string) => `Not open: ${marksSince} of the reports the account sent since the warning of ${warnedOn} were marked; a restriction needs ${STANDING_RULES.reportRestrictMarks}.`,
    /** [restrict.running] */
    restrictRunning: (restrictedUntil: string) => `Not open: a restriction runs until ${restrictedUntil}.`,
    /** How many days, at most the restriction's own number. */
    daysLabel: `Days (1 to ${STANDING_RULES.reportRestrictDays})`,
    /** 8.7: the reversal of each reporting measure, named by what it lifts. */
    liftWarning: "Lift the warning about reporting",
    liftRestriction: "Lift the restriction of reporting",
  },
  /** 8.4: the mark "manifestly unfounded" beside the items a "No breach" decision answers, and its withdrawal. */
  mark: {
    /** [mark.label] */
    label: "Manifestly unfounded",
    /** [mark.rule] */
    rule: `Tick only a report that anyone could see was unfounded without weighing it: it names nothing the rule could cover. A report you had to think about is not manifestly unfounded, also when you found no breach. Your key signs the mark. What counts toward a warning about reporting is the report, once, for ${STANDING_RULES.reportFrameDays} days from the day it was sent, however many of its items are ticked. The person who sent it sees the mark on their own list of reports once this answer is released to them, and can ask for a re-examination.`,
    /** [mark.never], once, when an item the decision answers cannot be marked. */
    never: "Only a signed-in person's report under a rule can be marked: never a notice of illegal content, a report on the path for child sexual abuse material, or a report sent without an account.",
    /** [mark.undone] */
    undone: "A mark stops counting when a re-examination of its report ends in a restriction, and when a correction of the decision that set it withdraws it.",
    /** [mark.withdraw]: the control, and what it does. */
    withdrawLabel: "Withdraw this decision's marks",
    withdrawWhat:
      "Use this when the reports were arguable after all: it was wrong to call them manifestly unfounded, also if no rule was broken. All marks this decision set are withdrawn together. The outcome of each report stays. The marks stop counting when you confirm, so a warning lifted because its marks were wrong cannot be given again on them.",
    /** On the case page, beside an item whose mark stands and one whose mark was withdrawn (CaseItem.markWithdrawn). */
    marked: "Marked manifestly unfounded",
    withdrawn: "Mark withdrawn",
    /** In place of the preview: the withdrawal sends the author nothing. */
    noStatement: "No statement is sent: withdrawing marks changes nothing for the author of what was reported, and the people who reported see it on their own lists.",
    /** The fieldset's legend. */
    legend: "Reports this decision answers",
  },
  /** 8.7: [review.warning], when a restriction of reporting rests on the reviewed decision's warning. */
  reviewWarning: "A restriction of this account's reports rests on this warning. If you lift the warning, the restriction ends when you confirm, and this decision's statement says so.",
  /** 8.5: [appeals.order] */
  appealsOrder: "Appeals of a running suspension or of a termination come first.",
  /** 8.5: the mark of an appeal listed first. */
  appealsFirst: "a running suspension or a termination",
} as const;

/**
 * The moderation codes the console can meet (3c design, sections 8 and 10): those of the case routes, of a decision, of
 * a review, of a finding's link and of a reveal. The codes of the app's own report form, appeal and re-examination never
 * reach the console.
 */
export const CONSOLE_MODERATION_CODES = [
  "notice_link_invalid",
  "notice_link_offsite",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
  "reviewer_conflict",
  "decision_cap",
  "profile_changed",
  "snapshot_mismatch",
  "snapshot_erased",
  "text_invalid",
  "text_quotes_user",
  "text_not_found",
  "invalid_decision",
  "image_refused",
  "reveal_refused",
  // 3e (design, section 8.9): the first three are the ones the composer meets; the other two cannot reach the console
  // today and are worded so that the table has an entry for each code of the type.
  "strike_mismatch",
  "standing_conflict",
  "ground_not_established",
  "reply_not_open",
  "reporting_restricted",
] as const satisfies readonly ModerationErrorCode[];
export type ConsoleModerationCode = (typeof CONSOLE_MODERATION_CODES)[number];

/** The console's words for each of them. A recusal reads the same whether the conflict concerns the author or a reporter. */
export const MODERATION_MESSAGES: Record<ConsoleModerationCode, string> = {
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "That link leads to another site. A case is opened only on a post or a profile of this korbat.",
  case_changed: "The case changed since this page read it. Read it again, check it and decide again.",
  case_closed: "The case changed at that moment. Try again.",
  staff_recused:
    "You cannot open or decide this case: an account linked to you takes part in it, or follows, blocks, mutes or replied to someone who does, or the post replies to or quotes a post of an account linked to you. Another staff member must handle it.",
  staff_target: "A final decision cannot restrict a staff account: staff are disciplined by demotion. A measure taken while deciding can.",
  admin_required: "Only an admin can take this decision.",
  reviewer_conflict: "You cannot review this appeal: you made a decision in its case, or opened a finding in it. Another staff member must review it.",
  decision_cap: "You have reached the limit on decisions one staff account may confirm for now. Try again later.",
  profile_changed: "The profile changed since the snapshot was taken. Take a fresh snapshot and decide again.",
  snapshot_mismatch: "The snapshot is not the one this case holds. Read the case again.",
  snapshot_erased: "That snapshot was erased under korbat's retention rules. Take a fresh snapshot and decide again.",
  text_invalid: "This text cannot be saved as it is: it is longer than 5000 characters, or holds a control character or an invisible direction or spacing character.",
  text_quotes_user: "This text quotes what someone wrote about this case. Describe it in your own words, never copy it.",
  text_not_found: "A text of this action is not saved any more, or was used already. Save it again.",
  invalid_decision: "This decision cannot stand as it is.",
  image_refused: "That image is not shown.",
  reveal_refused: "Nobody can be revealed for this item: it names no sender, or its sender's name is no longer kept.",
  strike_mismatch: "The strike rule changed for this post since this page read it. Read the case again and decide again.",
  standing_conflict: STANDING_CONFLICT,
  ground_not_established: STANDING_TERMINATE_R2,
  reply_not_open: "This measure takes no reply: it has ended or was lifted.",
  reporting_restricted: "That account's reports under the rules are restricted.",
};

/**
 * Where one code means more on a screen than the shared words say, that screen's words for it, one table for each place
 * (describeError takes the table): which daily limit was reached, or what a link that names nothing means on the form it
 * was typed into. They stand here with every other word for a refusal, so that no screen keeps a table of its own.
 */

/** The case page's own read: the day's limit on different cases, and an address that names no case. */
export const CASE_WORDS = {
  rate_limited: "You have opened as many different cases as one staff account may in a day. You can open others after midnight UTC; every staff account has been told.",
  not_found: "No case has this address.",
};

/** The reveal, once the key confirmed it: the day's limit on reveals. */
export const REVEAL_WORDS = { rate_limited: "You have revealed as many sources as one staff account may in a day. You can reveal others after midnight UTC." };

/** Saving a text, a note or a reveal's reason alike: the limit of saves a minute. */
export const NOTE_WORDS = { rate_limited: "Too many texts were saved in a minute. Wait a moment and save again." };

/** "Open a case" on the queue screen: a link that names nothing live, the day's limit on findings, and a link that is none. */
export const FINDING_WORDS = {
  not_found: "That link names nothing live on korbat: the post or the account does not exist or was deleted.",
  rate_limited: "You have opened as many findings as one staff account may in a day. You can open others after midnight UTC.",
  invalid_request: "Give a link to a post or a profile on korbat.",
};

/** An item's outcome, as the case page words it once the item is answered. */
export const OUTCOME_WORDS: Record<ItemOutcome, string> = {
  restricted_rule: "restricted under a rule",
  restricted_legal: "restricted as illegal",
  no_violation: "no breach found",
  not_evident: "illegality not evident",
  not_available: "nothing live at the link",
  partly_reversed: "restriction reversed in part",
  reversed: "restriction reversed",
};

/** The four kinds of decision, as the case page and its history name them. */
export const DECISION_KINDS: Record<CaseDecision["kind"], string> = {
  interim: "While deciding",
  final: "Final decision",
  review: "Review of an appeal",
  correction: "Correction",
};

/** A decision's outcome, as the case page and its history word it. */
export const DECISION_OUTCOMES: Record<CaseDecision["outcome"], string> = {
  restricted: "restricted",
  no_violation: "no breach",
  not_evident: "illegality not evident",
  kept: "decision kept",
  partly_reversed: "reversed in part",
  reversed: "reversed",
};

/** The three answers a review gives, as the review composer names them. */
export const REVIEW_OUTCOMES: Record<AppealsReviewedParams["outcome"], string> = {
  kept: "Keep",
  partly_reversed: "Reverse in part",
  reversed: "Reverse",
};

/**
 * The words beside an appeal, on the appeals screen and on the case page (3c design, section 7.7): whether the reading
 * person may review it, whether its review is an admin's, and whether anyone at korbat may review it now. None of them
 * says who took part in the case or who reported in it.
 */
export const APPEAL_WORDS = {
  mayReview: "You may review it.",
  mayNotReview: "You may not review it: a reviewer made none of the case's decisions, opened no finding in it, and is not close to anyone in it.",
  needsAdmin: "Its review is an admin's.",
  reviewer: {
    available: "A reviewer is available.",
    none_single_staff: "It has no possible reviewer now: korbat has one staff account that could review it, and that one took part in the case.",
    none_eligible: "It has no possible reviewer now: every staff account that could review it took part in the case or is close to someone in it.",
  } satisfies Record<ReviewerState, string>,
  statementOnCase: "What the appellant wrote is read on the case's page.",
  reviewerRule: "Appeals need a reviewer who made none of the case's decisions and opened no finding in it.",
  reviewLabel: "Review this appeal",
  notYours: "This appeal is answered, or is not yours to review.",
} as const;

/** What a decision that lifted the protection of reported images did, as the home screen's list words it. */
export const PROTECTION_LIFTED_WORDS: Record<"unsealed" | "dismissed", string> = {
  unsealed: "Lifted a seal",
  dismissed: "Answered a report of child sexual abuse material without a seal",
};

/** The two kinds of decision the composer offers, as it names them. */
export const COMPOSER_KINDS: Record<"interim" | "final", string> = {
  interim: "While deciding",
  final: "Decide the case",
};

/** The three outcomes the composer offers, as it names them. */
export const COMPOSER_OUTCOMES: Record<"restricted" | "no_violation" | "not_evident", string> = {
  restricted: "Restrict",
  no_violation: "No breach",
  not_evident: "Illegality not evident",
};

/**
 * The composer's sentences beside its texts and its preview. The rule on personal data is the design's sentence in three
 * parts, so that each part is written once: the rule itself, and where the text goes, which differs for a decision
 * without a measure: its author never receives its texts, whether the decision is told to them (it ended what korbat did
 * while deciding) or to nobody. The other three say what the preview cannot show yet, or will not.
 */
export const COMPOSER_WORDS = {
  personalDataRule: 'Write only about the author\'s content and conduct. Never copy another person\'s name, handle, address or other personal data here: describe it (for example "the home address of another person").',
  toAuthor: "The author receives this text by email and keeps it while their account exists.",
  staysInRecord: "The author never receives this text: a decision without a measure tells them at most that what korbat did while deciding has ended. It stays in the case's record, for staff.",
  noStatement: "No statement is sent: this decision restricts nothing and ends nothing that was done while deciding.",
  previewAfterSnapshot: "The preview follows the fresh snapshot: the case's newest snapshot cannot be shown, so Confirm takes a fresh one, shows it, and asks you to confirm again.",
  sealSettled: "The numbers, the sentence about posts their author had deleted, and whether the seal changes anything are settled when the seal is recorded: the statement its author gets holds them as they are then.",
} as const;

/**
 * The shared codes a staff route may also answer, and the console's own: a network failure, an answer its schemas refuse,
 * a browser prompt that did not finish, step-up options that bind something other than the action the person chose, and
 * sign-in or enrolment options whose challenge is not one of that ceremony's.
 */
const OTHER_MESSAGES: Record<string, string> = {
  challenge_expired: "That took too long. Try again.",
  rate_limited: "Too many attempts. Wait a while, then try again.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  service_unavailable: "That could not be done right now. Try again in a moment.",
  internal: "Something went wrong on the server. Try again.",
  network: "The staff console's server cannot be reached. Check your connection and try again.",
  invalid_answer: "The server's answer could not be read. Reload the page and try again.",
  ceremony_cancelled: "Nothing was signed: the browser's prompt was closed or timed out. Try again.",
  key_already_registered: "This key is already registered for your staff account. Use another key.",
  ceremony_refused: "The browser refused to use a key here. Open the console at exactly the address in CONSOLE_ORIGIN, never at 127.0.0.1, and try again.",
  step_up_mismatch:
    "The confirmation could not be checked: the server asked your key to sign something other than this action, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
  signin_mismatch:
    "The sign-in could not be checked: the server asked your key to sign something other than a sign-in, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
  enroll_mismatch:
    "The registration could not be checked: the server asked your key for something other than a staff key's registration, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
};

const FALLBACK = "Something went wrong. Try again.";

/** The console's words for a code; a code it does not know, a passkey code included, gets the plain fallback. */
export function messageFor(code: string): string {
  if (Object.hasOwn(STAFF_MESSAGES, code)) return STAFF_MESSAGES[code as StaffErrorCode];
  if (Object.hasOwn(MODERATION_MESSAGES, code)) return MODERATION_MESSAGES[code as ConsoleModerationCode];
  if (Object.hasOwn(OTHER_MESSAGES, code)) return OTHER_MESSAGES[code]!;
  return FALLBACK;
}

/** The code of anything a screen's action threw, or null: the console's errors carry one. */
export function codeOf(err: unknown): string | null {
  return err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : null;
}

/**
 * The words for anything a screen's action threw: the console's errors carry a code, anything else is the fallback.
 * `words` gives a screen's own words for a code where the shared ones would say too little: which daily limit was
 * reached, or what a link that names nothing means on the form it was typed into.
 */
export function describeError(err: unknown, words: Record<string, string> = {}): string {
  const code = codeOf(err);
  if (code === null) return FALLBACK;
  return Object.hasOwn(words, code) ? words[code]! : messageFor(code);
}
