import type { CaseDecision, ItemOutcome, ModerationErrorCode, StaffErrorCode } from "@korbat/contracts";

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
 * The moderation codes the console can meet (3c design, sections 8 and 10): those of the case routes, of a decision, of
 * a finding's link and of a reveal. The codes of the app's own report form never reach the console.
 */
export const CONSOLE_MODERATION_CODES = [
  "notice_link_invalid",
  "notice_link_offsite",
  "case_changed",
  "case_closed",
  "staff_recused",
  "staff_target",
  "admin_required",
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
