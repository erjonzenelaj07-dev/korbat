import type { FlatMailMessage, MailMessage, Mailer, NoticeUpdateMessage } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderMail } from "./templates";

/**
 * Records messages instead of sending them. Used by unit tests and flow tests. The flat messages and the structured
 * daily updates are kept apart, each list in the order sent, so a reader of one kind never meets the other's data.
 */
export class MemoryMailer implements Mailer {
  readonly sent: FlatMailMessage[] = [];
  readonly updates: NoticeUpdateMessage[] = [];
  failing = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failing) throw new MailUnavailable("memory mailer set to fail");
    // As the real mailer does first: a message whose data its template lacks is a programming error.
    renderMail(message);
    if (message.template === "notice_update") this.updates.push(message);
    else this.sent.push(message);
  }

  /** The `code` from the most recent message to this address, if any: only a flat message carries one. */
  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.data.code)?.data.code;
  }
}
