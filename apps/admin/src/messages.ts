import { STANDING_RULES, type AppealsReviewedParams, type AuthorStanding, type CaseDecision, type ItemOutcome, type ModerationErrorCode, type ReviewerState, type StaffErrorCode } from "@korbat/contracts";

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
