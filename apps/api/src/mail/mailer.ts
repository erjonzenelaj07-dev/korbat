export type TemplateName =
  | "sign_in_code"
  | "sign_up_code"
  | "reauth_code"
  | "new_device"
  | "account_locked"
  | "mfa_enabled"
  | "mfa_disabled"
  | "password_changed"
  | "recovery_codes_regenerated"
  | "sessions_revoked_all"
  | "email_change_code"
  | "email_changed"
  | "email_change_reverted"
  | "badge_verified"
  | "badge_removed"
  | "delete_account_code"
  | "account_deleted"
  | "passkey_added"
  | "passkey_removed"
  | "passkey_suspect"
  | "recovery_code_used"
  // The staff console's mails (3a design, section 7): to the staff account's own address, and never with a link.
  | "staff_key_added"
  | "staff_session_started"
  | "staff_key_suspect"
  | "staff_keys_revoked"
  // Moderation (3c design, section 7.15). To the people concerned: the receipt of a report or a notice, the daily update
  // of decisions on a person's reports, and the statement of reasons to the author of what a decision restricts. To
  // every staff account: the urgent lane's alert, the cases that wait longer than their response time, a burst of
  // decisions by one staff account, a staff account that reached its daily case limit, every reveal of who sent a
  // report, and every decision that lifted the protection of images reported as child sexual abuse material.
  | "notice_received"
  | "notice_update"
  | "moderation_decision"
  | "moderation_urgent"
  | "moderation_waiting"
  | "moderation_burst"
  | "moderation_reads"
  | "moderation_reveal"
  | "moderation_csam_lifted"
  // Account sanctions (3e design, sections 7.15 and 18, W.6): a decision's statement under a subject and a lead of its
  // own, for a suspension or termination taken at once and for the lift or end of one.
  | "suspension_started_at_once"
  | "suspension_lifted";

/** Every template but the one whose data is a structure: its data are flat strings. */
export type FlatTemplateName = Exclude<TemplateName, "notice_update">;

/**
 * One line of the daily update: the outcome of one item of a report (3c design, section 5). The moderation module sets
 * every field, from what korbat generated; none holds a report's words. The template chooses each of its sentences from
 * these fields alone.
 */
export interface NoticeUpdateLine {
  /** The notice's public reference. */
  ref: string;
  /** The item's position in its notice. */
  item: number;
  /** The item's korbat address, an account's under the handle as the notice named it. */
  link: string;
  /** The outcome's words, as the contracts' outcomeWords composes them, ending in a full stop. */
  outcome: string;
  /** The line answers a re-examination. */
  reexamination: boolean;
  /** The line gives the new outcome of an item that a review or a correction changed. */
  changed: boolean;
  /** A moderator's decision to take no action that can still be re-examined. */
  reexaminable: boolean;
  /** The line reads UNSEEN_NO_ACTION: such an answer is never final within korbat. */
  unseen: boolean;
  /** A link that named nothing, answered without a moderator. */
  automatic: boolean;
}

/**
 * The daily update's data. The moderation module gives the lines; the auth module adds whether the reader is signed in,
 * the receipts the 24-hour cap folded with their page links, the page link of each other notice the update has a line
 * for, and the terms' address. A signed-in update carries neither receipts nor pages.
 */
export interface NoticeUpdateData {
  signedIn: boolean;
  lines: NoticeUpdateLine[];
  receipts: { ref: string; time: string; items: string; pageUrl: string }[];
  pages: { ref: string; pageUrl: string }[];
  termsUrl?: string;
}

/** The daily update, whose data is a structure. */
export interface NoticeUpdateMessage {
  to: string;
  template: "notice_update";
  data: NoticeUpdateData;
}

/** A message of any other template: flat strings. */
export interface FlatMailMessage {
  to: string;
  template: FlatTemplateName;
  data: Record<string, string>;
}

/** A message is one of two shapes, told apart by its template. */
export type MailMessage = NoticeUpdateMessage | FlatMailMessage;

export interface Mailer {
  /**
   * Throws MailUnavailable when the message could not be handed to the relay, and its subclass MailRefused when the
   * relay answered that the recipient's address itself is bad, which no later try changes.
   */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}

/**
 * The relay refused the recipient for good: no such mailbox or destination, a malformed address, a mailbox that moved or
 * a domain that takes no mail. A subclass of MailUnavailable, so a caller that does not tell the two apart behaves as
 * before; one that does records the mail as failed instead of trying again (3c design, section 5).
 */
export class MailRefused extends MailUnavailable {}
