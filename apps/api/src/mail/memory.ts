import type { MailMessage, Mailer } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

/** Records messages instead of sending them. Used by unit tests and flow tests. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failing = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failing) throw new MailUnavailable("memory mailer set to fail");
    renderTemplate(message.template, message.data);
    this.sent.push(message);
  }

  /** The `code` from the most recent message to this address, if any. */
  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.data.code)?.data.code;
  }
}
