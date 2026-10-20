import {
  ORDER_RULES,
  QUARANTINE_RULES,
  REPLY_AIM_HOURS,
  RETENTION,
  STANDING_RULES,
  type AppealsReviewedParams,
  type AuthorStanding,
  type CaseDecision,
  type ContactDisposition,
  type ItemOutcome,
  type ModerationErrorCode,
  type ReviewerState,
  type StaffErrorCode,
} from "@korbat/contracts";

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
    /** A late reply to a termination, which has no end to name (3e's review, people9). */
    afterTermination: "after the start: the termination runs",
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
  // 3f (design, section 8.9): a message at the contact point that someone else closed meanwhile; and the refusals of
  // Task 2's order routes.
  "message_handled",
  "order_needs_message",
  "order_exists",
  "order_closed",
  "order_event_refused",
  "already_released",
  // 3f Task 3 (design, sections 8.5 and 8.9): the refusals of giving effect to an order.
  "order_changed",
  "order_not_verified",
  "order_cap",
  // 3f Task 6 (design, sections 8.7 to 8.9): a gap that is closed or that a decision does not fit, and a copy mark the
  // database did not take.
  "gap_mismatch",
  "copy_mismatch",
] as const satisfies readonly ModerationErrorCode[];
export type ConsoleModerationCode = (typeof CONSOLE_MODERATION_CODES)[number];

/** 3f Task 6 [copy.broken] (8.7): a download that broke off, whose mark the database refused or the console never sent. */
const COPY_BROKEN = "The download broke off, or its lines do not continue each other. Nothing was recorded as copied: press again.";

/** 3f [open.duplicate]: an order of this state, authority and reference is recorded already (order_exists). */
const OPEN_DUPLICATE =
  "An order of this authority with this reference is already recorded. If that record is wrong, correct it on its screen; if it is closed, an admin reopens it there. Do not open the order a second time under a changed reference.";

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
  message_handled: "That message was already handled. Read Contact point again.",
  order_needs_message: 'Pick the message this came in and try again. For a new order whose message is not in the list, choose "The message is not listed".',
  order_exists: OPEN_DUPLICATE,
  order_closed: "This order is closed. Nothing more is recorded on it from here; an admin can reopen it.",
  order_event_refused:
    "That cannot be recorded now: the order is not in the state this page showed (for example, a second extension, or the grounds ceasing while no Annex III stands). Read the order again.",
  already_released: "The author's notice of this order was already released, or its hold was ended: an extension can no longer be recorded. Tell the operator at once.",
  // [effect.gone] is one of its cases: a post of the order purged between the read and the key.
  order_changed: "The database refused this: the order, its items or their posts are no longer what this page showed. Read the order again.",
  order_not_verified:
    "This order is not verified yet: whoever has the server checks it against the order in the mailbox (staff.js order-verify). If the order itself sets a time that cannot wait, an admin gives it effect as urgent.",
  // [effect.cap] (8.5 block 4).
  order_cap: `You have given effect to ${ORDER_RULES.decisionsPerDay} order items in 24 hours, the most one staff account may. Another staff member goes on; tell the operator at once.`,
  gap_mismatch: "That gap is closed already, or this decision does not take again what it lost. Read After a restore again.",
  // [copy.broken] (8.7).
  copy_mismatch: COPY_BROKEN,
};

/** A small number as a word, as the design's sentences write it; a larger one in digits. */
const inWords = (n: number): string => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] ?? String(n);

/** A removal order's hour (ORDER_RULES.hourMinutes) in the words the console's sentences use. */
const HOUR_WORDS = ORDER_RULES.hourMinutes === 60 ? "one hour" : `${ORDER_RULES.hourMinutes} minutes`;
/** The last choice of the form "Open an order" (Task 2), which every sentence that sends a person there names. */
const NOT_LISTED = '"The message is not listed"';

/**
 * 3f (design, sections 8.2, 8.3 and 18): the console's sentences of authorities' orders, each under the design's key
 * (`home.contact` is [home.contact]). Every number in one is printed from the answer or from ORDER_RULES, never typed, and
 * every time is the database's instant, printed by bothTimes. Later tasks of 3f add their keys here.
 */
export const ORDER_WORDS = {
  home: {
    title: "Authorities",
    /** [home.contact], in three parts: the words before the link to Contact point, the link's own words, and the rest. */
    contact: (oldestAt: string, open: number) => ({
      before: `Mail at the authorities' contact point since ${oldestAt}: ${open} ${open === 1 ? "message" : "messages"} nobody has handled. Read it in the mail host's app, then open `,
      link: "Contact point",
      after: `. A removal order is due ${HOUR_WORDS} after it arrived.`,
    }),
    channel: (since: string) =>
      `Phone alerts are down since ${since}. Alerts arrive by mail only: keep the mail host's app open on the contact-point mailbox until this line is gone. An order you find there that Contact point does not list is opened under Orders, with ${NOT_LISTED}.`,
    mailbox: (since: string) => `korbat has not been able to read the contact-point mailbox since ${since}. Check it in the mail host's app until this line is gone. An order you find there is opened under Orders, with ${NOT_LISTED}.`,
    off: "Phone alerts and the contact point's watcher are switched off on this server. Nothing watches the contact-point mailbox: the operator switches them on.",
  },
  contact: {
    title: "Contact point",
    what: `korbat records that a message arrived and when. It never reads who sent it or what it says: read the message in the mail host's app. Every message here may be a removal order until a person has read it. The junk folder is watched too: an order filed as junk has still arrived. While one message's alarm is less than ${ORDER_RULES.quietMinutes} minutes old, further mail is listed here and raises no new alarm of its own: read every message listed, not only the first. A message that is in the mailbox and not listed here (the watcher was down, or the mail host filed it in another folder) is opened as an order all the same: Orders, "Open an order", ${NOT_LISTED}.`,
    reply: "Never answer an authority from korbat, and never open an attachment on a device that holds a staff key before you have checked the sender against the register.",
    received: (at: string) => `Received ${at}`,
    folders: { inbox: "Inbox", junk: "Junk folder" } as Record<"inbox" | "junk", string>,
    stale: `korbat first saw this message more than ${ORDER_RULES.staleHours} hours after it arrived (after an outage or a restore). It raised no phone alert.`,
    notHandled: "Not handled",
    /** "Handled as {disposition} by @{handle} on {handledAt}", around the handle, which the screen shows as text. */
    handledBefore: (label: string) => `Handled as ${label} by @`,
    handledAfter: (at: string) => ` on ${at}`,
    /** The same when no staff member set it (an order opened from the command line). */
    handledBySystem: (label: string, at: string) => `Handled as ${label} on ${at}`,
    handledOrder: "Handled as an order",
    closeAs: "Close as",
    closeButton: "Close",
    close: "Closing ends this message's alerts and cannot be changed. Close it only after you have read it in the mail host's app.",
    closed: (label: string) => `Closed as ${label}.`,
    staleTogether: (n: number) => `Close the ${n} stale messages as`,
    staleButton: "Close them",
    staleAll: (n: number) =>
      `These ${n} messages reached korbat's record more than ${ORDER_RULES.staleHours} hours after they arrived and raised no alert. Look at each in the mail host's app before you close them: one of them may be an order, and it is then opened, not closed. Closing cannot be changed.`,
    staleClosed: (n: number) => `${n} stale messages closed.`,
    loadOlder: "Load older",
    empty: "No message has arrived at the contact point.",
    /** The hint under each choice of "Close as" (8.3's table). */
    hints: {
      referral: "An authority points to content and orders nothing. Open a case of your own on it (Queue, Open a case) and decide it under korbat's rules or the law.",
      first_order_notice: "An authority tells korbat about its procedures and deadlines at least 12 hours before its first removal order (Article 3(2)). Keep the mail and tell the operator: an order from that authority may follow.",
      preservation_request: `An authority or a court asks korbat to keep disabled content beyond ${inWords(ORDER_RULES.preserveMonths)} months. Whoever has the server records it with staff.js order-preserve-extend.`,
      scrutiny_decision: "The home authority's decision on a removal order from another Member State (Article 4). An admin acts on it on the order: reinstates, or leaves the order in force.",
      clarification: `A clarification after an Annex III, a withdrawal, an annulment, or an extension or end of a non-disclosure period. A clarification that restarts the clock is recorded on the order itself ("Clarification received"), and an extension of a removal order's non-disclosure period by an admin on the order itself ("Extension received"), at once: the database releases the author's notice by itself at the old end. Either closes this message. Close it here only for the others, and tell the operator the same day; for a later end that an authority gives for a DSA order's silence, only whoever has the server can record it (staff.js order-hold-until), so call them.`,
      not_an_order: "Anything else: a question, an advertisement, a user's mail sent to the wrong address.",
    } as Record<Exclude<ContactDisposition, "order">, string>,
  },
  // Task 2 (design, sections 8.4 and 8.5): the list, the form and an order's screen.
  orders: {
    title: "Orders",
    open: "Open an order",
    closedTitle: "Closed in the last 30 days",
    empty: "No order is recorded.",
    frame: "As written in the order",
    state: (memberState: string) => `Issuing state: ${memberState}`,
    openLink: "Open this order",
    deadlineUnknown: "Deadline unknown: act now. Whoever has the server records the time of receipt with staff.js order-received.",
    scrutinyUntil: (until: string) => `An order from another Member State: korbat may ask for its scrutiny until ${until} (Article 4(4) of Regulation (EU) 2021/784). Tell the operator today.`,
  },
  /** The clock lines (8.4's table). */
  clock: {
    running: (deadline: string, minutes: number, target: string) =>
      `Due ${deadline}: ${minutes} minutes left. Target ${target}: an image may stay in an edge cache for up to 5 minutes after the disabling.`,
    overdue: (deadline: string, itemsOpen: number, items: number) => `Overdue since ${deadline}: ${itemsOpen} of ${items} items are neither disabled nor closed. Act now.`,
    stopped: (stoppedAt: string, ground: string) =>
      `Clock stopped at ${stoppedAt}: Annex III sent (${ground}). No deadline runs. A fresh ${ORDER_RULES.hourMinutes} minutes start when the grounds cease or the clarification arrives, never the rest of the old hour.`,
    partial: (done: number, items: number, firstEffectAt: string, itemsOpen: number, deadline: string) =>
      `${done} of ${items} items disabled, the first at ${firstEffectAt}. ${itemsOpen} are still open: the deadline ${deadline} still runs for them.`,
    effect: (lastEffectAt: string, elapsed: number, inside: boolean | null, whileStopped: boolean) =>
      `Given effect: the last post was disabled at ${lastEffectAt}, ${elapsed} minutes after the clock started: ${whileStopped ? "while the clock was stopped: inside the hour." : inside ? "inside the hour." : "outside the hour."}`,
    dsaDue: (dueAt: string) => `Due ${dueAt}, as the order states.`,
    dsaNone: "No deadline recorded: act without undue delay.",
    closedGround: (closedAt: string, ground: string) => `Closed on ${closedAt} without effect: ${ground}.`,
    closed: (closedAt: string) => `Closed on ${closedAt}.`,
  },
  /** The form "Open an order" (8.4's table). */
  form: {
    title: "Open an order",
    message: "Message",
    openMessage:
      `Pick the message the order came in. Its delivery time at the mail host becomes the time of receipt: the console takes no typed time. If the order is in the mailbox and not in this list (the watcher was down, or the mail host filed it in another folder), or it reached korbat another way, choose "The message is not listed". Never pick another message in its place: its time would become the order's.`,
    notListed: "The message is not listed",
    noMessage:
      "The order is opened without a time of receipt, so korbat cannot show its deadline. Act now, as if the hour were almost over. Whoever has the server records the time afterwards (staff.js order-received).",
    channel: "How it arrived",
    channelHint: "Choose how the order reached korbat. It is recorded with the order. A wrong choice can be corrected on the order's screen.",
    kind: "Kind",
    kindHint: "A message that orders nothing is closed on Contact point, not opened here.",
    state: "Issuing state",
    authority: "Authority",
    otherAuthority: "Another authority",
    authorityHint: "Choose the authority as your copy of the Commission's register lists it. If it is not listed, type its name as the order writes it and check it before you act.",
    reference: "Reference",
    referenceHint: "The order's reference, exactly as written.",
    links: "Links",
    linksHint: `The korbat addresses the order names, one a line, at most ${ORDER_RULES.itemsPerAction} now; more are added on the order's screen. korbat resolves each to a post and fetches nothing. The address of an image is taken as the address of the post it belongs to, and kept as the order names it. A link that names an account, another site or no post is recorded as named, and the order's screen says what to do about it.`,
    sectionC: "Must the author not be told?",
    sectionCChoices: {
      tco: ["Section C is ticked: the author must not be told", "Section C is not ticked", "I cannot tell"],
      dsa: ["The order says the author must not be told", "It does not say so", "I cannot tell"],
    },
    sectionCHint: `Choose what the order shows. If you cannot tell, the notice is held as if Section C were ticked, and whoever has the server settles it. A held notice is released by the database alone, ${ORDER_RULES.holdDays} days after the day of the order, counted so that it is never early, and ${ORDER_RULES.holdExtensionDays} days later when the authority extends the period once.`,
    sectionCDsa:
      "Choose what the order says. If you cannot tell, the notice is held. For this kind of order no law fixes the period: the notice is held until the time the authority states, which whoever has the server records (staff.js order-hold-until), and while none is recorded it is released at no time.",
    sectionCFix: "A wrong choice can be corrected on the order's screen: towards silence by anyone at once, away from it only by an admin.",
    emergency: "The order says it is an emergency, so no notice came 12 hours before it.",
    withhold: "Withheld from the author",
    withholdHint: "Tick it only if the order's text says the content must be kept from its author too. Without it the post is removed as under a korbat rule: its author still sees it and is told at once.",
    withholdLocked:
      "An author who must not be told cannot be shown their post marked as removed. So the post is kept from its author too, and it stays so for as long as the order's measure stands.",
    button: "Open the order",
    untouched: "Choose whether the author must not be told: no choice is made for you.",
    done:
      'Order opened. Nothing is restricted yet and nobody was told. Every staff account is alerted that an order was opened. Read what you entered against the order once more: a mistake is corrected here, under "Correct what the order shows", before you disable anything.',
    unsure: "You could not tell whether the author may be told. The notice is held. Tell the operator now: the order must be read again.",
    limit: `You have opened ${ORDER_RULES.recordsPerDay} orders in 24 hours, the most one staff account may. Another staff member opens the next; tell the operator.`,
    duplicate: OPEN_DUPLICATE,
    duplicateLink: "Open the order that is recorded",
  },
  /** An order's screen (8.5): its blocks, in order. */
  order: {
    /** [order.register], around the authority's name, which the screen draws as an outsider's words. */
    register: (state: string) => ({
      before: "Before you act, check the order against your offline copy of the Commission's register: is ",
      after: ` listed for ${state}, and does the address in the order's Section F belong to that entry? A signature is neither needed nor proof.`,
    }),
    doubt: "If you are in doubt and the hour is running, give effect: the measure is reversible and keeps everything. Whoever has the server records the check by the next working day.",
    registerDsa:
      "No register lists who may issue such an order. Ask korbat's Digital Services Coordinator whether it holds a copy of it (Article 9(4) of the Digital Services Act), or call the authority on a number you looked up yourself, never one the message gives.",
    verifyFirst:
      "No hour runs for this kind of order, so nothing is done in doubt: it is given effect only after the check is recorded. Whoever has the server records it (staff.js order-verify), and counsel reads the order first.",
    stateUnknown: "not filled in: see the README, Before going public",
    entry: (name: string, entry: string) => `${name}: ${entry}`,
    itemsTitle: "Items",
    item: (n: number) => `Item ${n}`,
    /** "@{handle}, post of {createdAt}, {images} images", around the handle. */
    resolved: (createdAt: string, images: number) => ({ before: "@", after: `, post of ${createdAt}, ${images} images` }),
    image: "The order names an image. korbat takes it as the post the image belongs to: disabling the post stops every image of it.",
    account:
      "This link names an account, not a post. korbat cannot disable an account for an order from this screen. Add the address of each post the order means. For the display name or the bio, and when the order means the whole account, call the operator now. Do not send Annex III for it: the order is not unclear. Then close this item without effect, as a link that names nothing korbat can disable for an order: until a person has, it counts as open and the order's reminders go on.",
    missing:
      `This link names nothing that korbat serves. Compare it with the order, letter by letter: a mistyped link is closed here as korbat's mistake, and the right one added under "Add links". Only if the order itself gives this address, and korbat cannot find the content from it, does the order lack information (Annex III). Either way this item counts as open until a person closes it without effect.`,
    deleted: (deletedOn: string) => `Its author deleted this post on ${deletedOn}. Giving effect records the order and changes nothing anyone sees.`,
    notDisabled: "Not disabled",
    disabledAt: (at: string) => `Disabled at ${at}`,
    closedItem: (at: string, reason: string) => `Closed without effect at ${at}: ${reason}`,
    unchecked: (addedAt: string) => `Added at ${addedAt}, after the order was checked: not compared with the order by whoever has the server yet.`,
    closeItem: "Close this item without effect",
    closeItemHint:
      "Use this for a link that names nothing korbat can disable for an order, once you have done what its line above says, or for a link that korbat entered by mistake and the order does not name, or for an item the authority withdrew before korbat acted on it. Until every item is disabled or closed, the order is not given effect in full: its deadline and its reminders go on.",
    withdrawnHint:
      'The authority withdrew this item before korbat acted on it, and other items of the order stand. Check the withdrawal as you check an order before you close the item. If the authority withdrew the whole order, an admin closes the order instead ("Close without effect").',
    addLinks: "Add links",
    added:
      "A link added after the order was checked makes the order unverified again: every staff account is alerted daily until whoever has the server has compared the new link with the order and recorded the check again.",
    eventsTitle: "Recording what was sent and received",
    confirmKey: "Confirm with your staff key",
    annex3: "Annex III sent",
    annex3What: "Record this after you sent Annex III. The clock stops. korbat records the time and does not judge the form.",
    ceased: "The grounds have ceased",
    ceasedWhat: `Record this the moment korbat can carry out the order again. A fresh ${ORDER_RULES.hourMinutes} minutes start now.`,
    clarified: "Clarification received",
    clarifiedWhat: `Pick the message the clarification came in. A fresh ${ORDER_RULES.hourMinutes} minutes start at its delivery time, or at the time Annex III was recorded when that is later, so the deadline may already be near.`,
    annex2: "Annex II sent",
    annex2What: "Record this after you sent Annex II to the address in the order's Section F and the copy below.",
    informed: "Authority informed",
    informedWhat:
      "Record this after you told the authority, from the mailbox, that korbat received the order and what effect it gave and when (Articles 9(1) and 10(1) of the Digital Services Act).",
    close: "Close without effect",
    closeWhat:
      "Closing ends the order's alerts and its clock. An order with a disabled item is not closed: reinstate the item on its case first. A record that was only entered wrongly is not closed either: correct it below.",
    reopen: "Reopen the order",
    reopenWhat:
      "Use this when the order was closed by mistake, or when a court has restored an order that was closed as withdrawn or annulled. The order is then as it was before it was closed and can be given effect. Its times are unchanged, so a deadline that passed meanwhile shows as overdue.",
    formsTitle: "The forms' values",
    annex3Text: (reference: string, authority: string, state: string, receivedAt: string, ground: string) => [
      `Reference of the removal order: ${reference}`,
      `Issuing authority: ${authority}, ${state}`,
      `Time and date of receipt of removal order: ${receivedAt}`,
      `Reason: ${ground}`,
      "Describe in the form what is impossible, wrong or missing: korbat does not write that part.",
    ],
    contactLine: (contactPoint: string) => `Contact point: ${contactPoint}`,
    sendTo: (annexCopy: string) => `Send to: the address in the order's Section F. Copy to: ${annexCopy}`,
    owesTitle: "What the command line still owes",
    owesVerify: "The check is not recorded (staff.js order-verify).",
    owesVerifyAgain: (n: number) => `${n} links were added after the order was checked: they are not compared with the order yet (staff.js order-verify, again).`,
    owesIssued: "The order's own date and time are not recorded (staff.js order-issued). Until they are, the non-disclosure period is counted from the receipt, which is never earlier.",
    owesHoldUntil:
      "The time until which the authority wants the author not told is not recorded (staff.js order-hold-until). Until it is, the notice is released at no time, and every staff account is reminded daily.",
    owesTexts:
      "The authority's reasons and remedies are not recorded (staff.js order-texts). The author's notice says that they follow; when they are recorded, the author is sent an email and the notice shows since when it holds them.",
    owesTextsDsa:
      "Record the authority's reasons, its remedies and the order's territorial scope before you give effect (staff.js order-texts, three times): the author is owed them with the notice (Article 9(5) of the Digital Services Act). Only an order marked urgent goes first.",
    owesTellRule: "Whether and when the person may be told of this order is not recorded (staff.js order-tell-rule). Nothing is produced before it is.",
    owesDocument: "The document's digest is not recorded (staff.js order-document).",
    noticeTitle: "The author's notice",
    toldAt: (at: string) => `Told at ${at}.`,
    holdUntil: (until: string, from: "receipt" | "order", extended: boolean) =>
      `Held until ${until}: the end the database computes from the Regulation's six weeks, counted from ${from === "receipt" ? "the receipt" : "the order's own date"}${extended ? ", extended once" : ""}.`,
    holdAuthority: (until: string) => `Held until ${until}: the time the issuing authority stated. No law caps it; whoever has the server records a later time when the authority gives one.`,
    holdOpen: "Held with no end: the authority has named no time, or none is recorded. Nothing is released until whoever has the server records one (staff.js order-hold-until).",
    released: (at: string) => `Released at ${at}.`,
    ended: (at: string, reason: string) => `Hold ended at ${at}: ${reason}.`,
    eventsList: "Events",
    byConsole: (handle: string) => `@${handle}, console`,
    byCli: "command line",
    bySystem: "korbat",
    correctTitle: "Correct what the order shows",
    correctWhat: "Change only what was entered wrongly, so that the record says what the order says. Every change is recorded under your name.",
    correctSilence:
      "This holds every notice of the order and keeps its posts from their authors. A notice that has already gone out is withdrawn until the hold ends: it leaves the author's screens, an email not yet sent is not sent, and korbat tells the author again at the release. What an author has already read cannot be taken back: if a notice had gone out, tell the operator at once.",
    correctUnsilence:
      `Only when the order has no non-disclosure decision and korbat's record said so by mistake. The hold ends with the reason "not ordered", each author is told with the next dispatch round, and the notice says that the delay was korbat's mistake.`,
    correctButton: "Correct",
    corrected: "Corrected. Every staff account is alerted that the record changed.",
    changed: "The database refused this: the order, its items or their posts are no longer what this page showed. Read the order again.",
    // Task 3 (design, section 8.5): block 4, "Extension received", the hold's warning and an item's preservation.
    extended: "Extension received",
    extendedWhat: (holdUntil: string) =>
      `Record this the moment the authority's decision to extend the non-disclosure period arrives: without it the database releases the author's notice by itself on ${holdUntil}. The notice is then held ${ORDER_RULES.holdExtensionDays} days longer, once. Whoever has the server checks the decision afterwards and either confirms it or ends the hold (staff.js order-hold-end).`,
    holdWarn: (holdUntil: string) =>
      `The author's notice is released on ${holdUntil}. If the authority has extended or prolonged the silence, record it before then: every staff account is alerted daily until that day.`,
    preservedUntil: (at: string) => `Preserved until ${at}`,
    // Task 4 (8.5, [item.erased]): the preservation ended while the measure stood, and erased the post's content.
    erased: (day: string) => `Preservation ended on ${day}: the content was erased.`,
    reinstatedAt: (at: string, ground: string) => `Reinstated at ${at}: ${ground}`,
    effectTitle: "Disable for an order",
    effectWhat: "This disables the ticked posts for everyone, their authors included: each then answers like a post that does not exist, and its images are not served. korbat does not assess them. Nothing is deleted.",
    effectPreserve: `Each post, its images and a copy of its text are preserved for ${inWords(ORDER_RULES.preserveMonths)} months from now, and erased then unless an authority or a court asks for longer.`,
    effectRemoved: "This removes the ticked posts for everyone but their authors, who still see them, as after a removal under a korbat rule. korbat does not assess them.",
    effectTold: "Each author is told at once: a notice in the app, and an email that says only that there is one.",
    effectHeld: (holdUntil: string) =>
      `Section C is ticked: the authors are told nothing, and see what everyone sees, until ${holdUntil}. The database releases the notice then by itself; every staff account is alerted ${ORDER_RULES.holdWarningDays} days before.`,
    effectHeldNoReceipt: `Section C is ticked: the authors are told nothing, and see what everyone sees, until six weeks after the receipt, whose time is not recorded yet (staff.js order-received). The database releases the notice then by itself; every staff account is alerted ${ORDER_RULES.holdWarningDays} days before.`,
    effectHeldDsa: (holdUntil: string) => `The order says the author must not be told: the authors are told nothing, and see what everyone sees, until the time the authority stated (${holdUntil}).`,
    effectHeldOpen:
      "The order says the author must not be told: the authors are told nothing, and see what everyone sees, and no end is recorded: nothing is released until whoever has the server records the authority's time (staff.js order-hold-until). Every staff account is reminded daily that it is missing.",
    effectUrgent: "Urgent: give effect before the check",
    effectUrgentWhat: "Tick this only when the order itself sets a time that cannot wait for the check. It is signed with your key and every staff account is told that an unverified order was given effect as urgent.",
    effectAnyone: "Any staff member on duty does this, also for a post of someone they know or of a staff member: an order leaves no choice. Every staff account is alerted.",
    effectMax: `At most ${ORDER_RULES.itemsPerAction} items at a time: confirm these, then the rest.`,
    effectButton: (n: number) => `Disable ${n} ${n === 1 ? "post" : "posts"}: confirm with your staff key`,
    effectTick: "Disable this post",
    checkOutside: (at: string, n: number) =>
      `Disabled at ${at}: ${n} ${n === 1 ? "post" : "posts"}. Now check from outside: open each address below in a private window. It must say that the post does not exist (HTTP 404). An image may still load from an edge cache for up to 5 minutes. Then send Annex II from the mailbox and record it here.`,
    effectRest: (itemsOpen: number, deadline: string | null) =>
      `${itemsOpen} items of this order are still open. The order is not given effect in full yet: its deadline ${deadline === null ? "" : `${deadline} `}runs for them, and the reminders go on. Tick them and confirm again, or have an admin close an item that names nothing korbat can disable, that the order does not name or that the authority withdrew.`,
    alreadyNow: "already disabled or removed by another decision: recorded, changed nothing now",
    deletedNow: "deleted by its author: recorded, changed nothing",
  },
  /** Task 3: Home's [home.unverified] (8.2), before the orders' links. */
  homeUnverified: (n: number) =>
    `Orders given effect and not verified, or with a post added after the check: ${n}. Whoever has the server compares each with the order in the mailbox and records the check with staff.js order-verify; every staff account is alerted daily until then.`,
  /**
   * Task 5: Home's [home.owed] (8.2), one line a case, each a link to it: since when a report to the authorities is owed,
   * and after ORDER_RULES.reportAlertHours the daily alert. The console sees of a notification only that one is owed, for
   * which case and since when; who was reported to whom is the command line's.
   */
  homeOwed: (since: string, late: boolean) =>
    `A report to the authorities is owed since ${since}.${late ? ` More than ${ORDER_RULES.reportAlertHours} hours: every staff account is alerted daily until whoever has the server records it as sent or declined.` : ""}`,
  /** Task 5: the case page's line (8.6, CaseView.reportOwed), in [home.owed]'s words: the design gives the page none of its own. */
  caseOwed: (since: string) =>
    `A report to the authorities is owed for this case since ${since}. Whoever has the server records it as sent or declined; nothing more of it is shown here.`,
  /** Task 3: a case that holds an order's measure (8.6). */
  caseOrder: {
    source: "An authority's order",
    preserved: "This post is preserved under an order. Its text and images are shown to no staff member here; they are opened only from the command line, for a recorded purpose (staff.js order-access).",
    own: "The order is not korbat's judgement. Reports about this post under korbat's rules are decided on their own: a removal under a rule is a second decision with its own statement and appeal, and it stays if the order's measure is lifted.",
    heldToo: (until: string | null) =>
      `The author of this post must not be told of an authority's order yet. So this decision is recorded now and told to the author only when that notice is released: ${until === null ? "at a time that is not recorded yet" : `on ${until}, as things stand`}. Whoever reported the post is answered now, as always. Do not tell the author anything yourself.`,
    inForce: "in force",
    withheld: "withheld from its author",
    shown: "shown to its author",
    reinstate: "Reinstate",
    reinstateWhat:
      "Reinstating ends the order's measure on this post and its preservation. korbat never lifts an order's measure on its own view of the content: choose what happened, after you checked the message it came in as you check an order. If another decision still restricts the post, it stays restricted. Should the order be restored later and the post be disabled again, its six months count anew from that disabling.",
    reinstateTold: "If the author was told of the disabling, they are told at once why it ended. If the notice is still held, nothing is told until the hold ends, and then both are told together.",
    reinstateFake: "Tell whoever has the server to end the hold first (staff.js order-hold-end), so that the author learns at once what happened and for how long.",
    // Task 4 (8.6, [reinstate.erased]): the preservation's end erased the post before the reinstatement.
    reinstateErased: (day: string) => `The content was erased on ${day} when its preservation ended. Reinstating lifts the measure; it restores nothing.`,
    reinstateButton: "Reinstate: confirm with your staff key",
  },
  /** Home's two lines of a deadline (8.2). */
  homeClock: (dueAt: string, minutes: number) => `The nearest deadline is ${dueAt}: ${minutes} minutes left.`,
  homeOverdue: (dueAt: string) =>
    `A deadline passed at ${dueAt} and not everything is done: a message is unread, or an order has an item that is neither disabled nor closed. Open Orders and act now, then tell the operator.`,
  /** Contact point's button (8.3). */
  openFromMessage: "Open an order from this message",
} as const;

/**
 * 3d (design, sections 8.1, 8.2 and 8.4): the words of sealed files and their custody, the quarantine, the release and
 * held uploads, each under its key. Every number is printed from the answer or from a constant (QUARANTINE_RULES), never
 * typed; every time is the database's instant, printed by the screen with bothTimes. Task 1 has the quarantine's.
 */
export const CUSTODY_WORDS = {
  /** The home screen's block below "Authorities", each line only while it applies. */
  homeTitle: "Sealed files and programs",
  /** [home.quarantine], while a move into the quarantine or back is due. */
  homeQuarantine: (dueIn: number, dueOut: number, oldest: string) =>
    `Files to move or return: ${dueIn} images to move into the quarantine, ${dueOut} to return to the image store, the oldest due since ${oldest}. Whoever has the server runs the README's steps under Quarantine (staff.js quarantine-list). Until then a sealed image's files are still in the image store, and an image whose seal was lifted is not shown.`,
  /** Its addition once the oldest due move is older than the alert's threshold. */
  homeQuarantineLate: `More than ${QUARANTINE_RULES.dueHours} hours: every staff account is alerted daily until the move is recorded.`,
  /** [case.custody.in], on a seal for good in force. */
  custodyIn: (moved: number, files: number, movedAt: string | null) => (moved > 0 && movedAt !== null ? `Files: ${moved} of ${files} are in the quarantine, since ${movedAt}.` : "Files: not moved to the quarantine yet."),
  custodyInRest: "The others are still in the image store until whoever has the server moves them (the README, Quarantine).",
  /** [case.custody.return], while files of a lifted seal are still in the quarantine. */
  custodyReturn: (toReturn: number) =>
    `Files to return: the seal was lifted and ${toReturn} files of its images are still in the quarantine. The images are shown again once whoever has the server has returned them (the README, Quarantine).`,
  /** [case.custody.lost], under a seal for good in force, and after a lifted seal. */
  custodyLost: (lost: number, inForce: boolean) =>
    inForce
      ? `Files lost: ${lost}. They were found in neither the image store nor the quarantine and are recorded as lost; there is nothing to move, hand over or destroy for them.`
      : `Files lost: ${lost}. Their images cannot be shown again; their author was told so.`,
} as const;

/**
 * 3f Task 6 (design, sections 8.2, 8.5, 8.7 and 8.8): the console's sentences of recovery, each under the design's key
 * (`restore.what` is [restore.what]). Every number is printed from the answer or from the contracts, never typed, and
 * every time is the database's instant, printed by the screen with bothTimes.
 */
export const RECOVERY_WORDS = {
  // The audit log's download (8.7).
  downloadTitle: "Download since my last copy",
  download: (lastPlace: number, max: number) =>
    `Downloads the rows after place ${lastPlace}, the newest you downloaded, as one file of JSON lines, at most ${max} rows at a time. Keep the file off the server with the head you note. After a restore it is what names the lost orders and decisions.`,
  downloadFirst: (max: number) => `You have downloaded nothing yet: this downloads the first ${max} rows. Press again until nothing is newer.`,
  key: "The file holds more than this page: confirm with your staff key.",
  downloadButton: "Download since my last copy",
  done: (from: number, to: number, rows: number) => `Downloaded places ${from} to ${to}: ${rows} rows. The copy is recorded.`,
  none: (lastPlace: number) => `Nothing is newer than place ${lastPlace}.`,
  broken: COPY_BROKEN,
  // "What one key confirmed" (8.7).
  keyTitle: "What one key confirmed",
  keyWhat:
    "Use this when a key may have been in someone else's hands. Each decision listed is undone by an admin's correction on its case; there is no batch. An order's disabling is reinstated only on one of its grounds: a stolen key is not one, so check the order itself.",
  keyField: "Staff key's id",
  keyFrom: "From (UTC, for example 2026-10-10T01:00:00Z)",
  keyTo: "To (UTC)",
  keyShow: "Show what it confirmed",
  keyAll: "All rows",
  keyRule: "Enter a key's id as staff.js keys prints it, and each time as 2026-10-10T01:00:00Z, or leave a time empty.",
  thisKey: "This key",
  keyShown: (keyId: string) => `Rows a step-up of the key ${keyId} confirmed, newest first.`,
  // Home (8.2).
  homeCopy: (days: number) => `The copy is ${days} ${days === 1 ? "day" : "days"} old. The keeper downloads the audit log's tail on the daily visit: Audit log, "Download since my last copy".`,
  /** [home.copy] before any copy was taken: the design's sentence has no age to print then. */
  homeCopyNone: `No copy of the audit log's tail has been taken yet. The keeper downloads it on the daily visit: Audit log, "Download since my last copy".`,
  homeRestore: (open: number, measures: number) =>
    `After a restore: ${open} ${open === 1 ? "gap is" : "gaps are"} open, ${measures} of them measures to take again. Keep the app's site closed (APP_SITE=closed, Caddy recreated) until every order disabling and seal among them is back.`,
  // After a restore (8.8).
  title: "After a restore",
  what: "The database was restored from a backup, and the keeper's copy names what the backup lacks. Nothing below is in force until a person takes it again under a key: korbat imports no measure. Work from the top.",
  // 3f's review (operations1): the operator's step closes the site, which korbat cannot see; the screen says what to keep.
  site: "Keep the app's site closed (APP_SITE=closed, Caddy recreated) until no order disabling and no seal is open here.",
  siteOpen: "No order disabling and no seal is open. The operator may open the app's site (APP_SITE=open, Caddy recreated).",
  retention: "No measure is open. The operator may switch retention and the image sweep back on.",
  lost: "What no import brings back: the texts of the lost decisions, everything after the keeper's last download, and anything the keeper's files do not hold (the import printed every place it found missing in them). For those, the contact-point mailbox and the operator's notes are the record.",
  holds:
    "Before you disable anything again for an order: whoever has the server compares each held notice below with the contact-point mailbox since the keeper's last download. An extension or a later time that was recorded after that download is lost, and a disabling taken again under the old end would tell the author early.",
  holdUntil: (until: string | null) => (until === null ? "Held with no end recorded" : `Held until ${until}`),
  importedAt: (at: string) => `The newest import ran at ${at}.`,
  nothingOpen: "Every gap is closed.",
  classes: {
    order_effect: { heading: "Orders: disable again", line: (n: number, actedAt: string) => `Lost: the disabling of ${n} ${n === 1 ? "post" : "posts"} for an order, first done at ${actedAt}.` },
    seal_final: { heading: "Seals for good", line: (actedAt: string) => `Lost: a seal for good, decided at ${actedAt}.` },
    seal_interim: { heading: "Seals taken while deciding", line: (actedAt: string) => `Lost: a seal taken while deciding, decided at ${actedAt}.` },
    standing: { heading: "Suspensions and terminations", line: (measure: string, actedAt: string) => `Lost: ${measure}, decided at ${actedAt}.` },
    restriction: { heading: "Other restrictions", line: (measure: string, actedAt: string) => `Lost: ${measure}, decided at ${actedAt}.` },
    reversal: { heading: "Reversals", line: (actedAt: string) => `Lost: a reversal, decided at ${actedAt}.` },
    no_measure: { heading: "Decisions without a measure", line: (actedAt: string) => `Lost: a decision without a measure, of ${actedAt}. Listed for reference.` },
    record: {
      heading: "Records to enter again",
      line: (actedAt: string, what: string) =>
        `Lost: a record of ${actedAt} that the copy names and cannot write again (${what}). Whoever has the server enters it again from the authority's letters and their own notes, with the command that wrote it, naming this gap (--gap).`,
    },
  },
  /** {what} of a gap of the class record: the words of its lost row's action. */
  recordWhat: (action: string) =>
    action === "notification_recorded"
      ? "a step of a notification to an authority"
      : action === "production_recorded"
        ? "a production to an authority"
        : action === "preserved_accessed"
          ? "an access to preserved content for an authority"
          : "a record",
  orderLine: "Open the order, then Disable for an order: the preservation's end, the hold and the clock keep their imported values. Read the held notices above first.",
  openOrder: "Open the order",
  openCase: "Open the case",
  noTarget: "The restored database no longer holds what this names.",
  notNeeded: "Not needed",
  notNeededWhat: "Use this when the measure had ended, or was reversed, before the restore, or when the target no longer exists. It is recorded with your key and cannot be undone here.",
  notNeededDone: "Closed as not needed.",
  closed: (disposition: "reapplied" | "not_needed" | "imported", at: string) =>
    `${disposition === "reapplied" ? "Taken again" : disposition === "not_needed" ? "Not needed" : "Entered again"} at ${at}.`,
  /** [restore.again] (8.8): the composer's line when a decision takes a lost one again. */
  again: (actedAt: string) => `This takes again a decision of ${actedAt} that was lost with a restore. Its statement says so. Write the facts and the reason again: the lost texts are gone.`,
  /** [effect.preserve] for a disabling taken again after a restore (8.5): the end it had stays. */
  effectPreserveAgain: (preserveUntil: string) => `Each post, its images and a copy of its text are preserved until ${preserveUntil}, as before the restore.`,
} as const;

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
  // 3f (design, section 8.6).
  order: "Order",
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
