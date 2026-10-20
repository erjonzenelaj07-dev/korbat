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
  // own, for a suspension or termination announced or taken at once, for the answer to the person's reply, and for the
  // lift, the withdrawal or the end of one. And the auth module's own flat template, which no decision sends: the last
  // mail of a terminated account, after its take-down. And (Task 5) the statement of a warning about the account's
  // reports and of a restriction of them.
  | "suspension_announced"
  | "suspension_started_at_once"
  | "reply_answered"
  | "suspension_lifted"
  | "termination_final"
  | "reporting_warned"
  | "reporting_restricted"
  // Authorities' orders and the alert channel (3f design, sections 7.19 and 18, W.4): the staff alerts whose mail is their
  // push's sentence, each a kind of alert_outbox's: mail at the contact point, nobody answering it, its deadline
  // approaching, a mailbox korbat cannot read, and the phone alerts being down. Counts and UTC times only.
  | "contact_mail"
  | "contact_mail_escalated"
  | "order_due"
  | "mailbox_unreachable"
  | "alert_channel_down"
  // Task 2: an order opened, an order's record corrected, and the daily count of what orders given effect still miss.
  | "order_opened"
  | "order_corrected"
  | "order_unverified"
  // Task 3: an order given effect, an order's measure lifted, a held notice about to be released; and the three mails to
  // a person about an order's notice (W.5), each saying only that a notice is on the Cases screen or that it has grown.
  | "order_effected"
  | "order_reinstated"
  | "hold_ending"
  // Task 6: the copy of the audit log's tail overdue, and taken by an account that did not take the last copy.
  | "copy_overdue"
  | "copy_taken"
  // Task 5's two daily kinds, joined in 3f's review: their mail is their push's sentence.
  | "report_owed"
  | "handover_undestroyed"
  | "order_notice"
  | "order_reinstated_notice"
  | "order_notice_added"
  // Transparency and automation (3d design, sections 7.15 and 18, W.7 and W.8). Task 1: a move of sealed files into the
  // quarantine or back that is due, and files the quarantine's record says are lost, each a staff alert whose mail is
  // its push's sentence; and the one mail to an author whose image's files korbat lost while they were kept apart.
  | "quarantine_due"
  | "quarantine_lost"
  | "image_lost"
  // Task 2: a released file still in the quarantine and an admin's release, each a staff alert whose mail is its push's
  // sentence; and the author's notice of a release of sealed images of their posts.
  | "release_undestroyed"
  | "seal_released"
  | "release_notice"
  // Task 7: the uploader's notices of a refused upload, and the two staff alerts whose mail is their push's sentence.
  | "upload_refused"
  | "upload_hold_lifted"
  | "matcher_down"
  | "hold_ended_unreported"
  // Task 3: the edge's job gave up on purges at the network provider, a staff alert whose mail is its push's sentence.
  | "edge_purge_failed"
  // Task 5: the transparency job's two alerts, each a staff alert whose mail is its push's sentence (a day's value without
  // an outside timestamp, a day without a published value); and the keeper's daily mail of the audit head, to the one
  // address HEAD_KEEPER_MAIL.
  | "head_unwitnessed"
  | "head_missed"
  | "head_published"
  // Task 6: the automated decision's three alerts, each a staff alert whose mail is its push's sentence: an author asked
  // for a person, a cap or a limit refused a program's measure, a request for a person waited longer than its target.
  | "automated_objection"
  | "automation_capped"
  | "automated_waiting";

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
  /** 3d Task 7: the answering decision is recorded as partly automated (W.3, update.automated.partly). */
  partly?: boolean;
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
