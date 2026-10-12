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
  // Moderation (3c design, section 7.15): the receipt of a report or a notice, and the staff alert for the urgent lane.
  | "notice_received"
  | "moderation_urgent";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

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
