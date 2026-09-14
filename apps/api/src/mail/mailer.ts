export type TemplateName = "sign_in_code" | "sign_up_code" | "reauth_code" | "new_device" | "account_locked";

export interface MailMessage {
  to: string;
  template: TemplateName;
  data: Record<string, string>;
}

export interface Mailer {
  /** Throws MailUnavailable when the message could not be handed to the relay. */
  send(message: MailMessage): Promise<void>;
}

export class MailUnavailable extends Error {}
