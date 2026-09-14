import nodemailer from "nodemailer";
import type { MailMessage, Mailer } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

/** Sends through any SMTP relay given as a URL, e.g. smtps://user:pass@smtp-relay.example:465. */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(message: MailMessage) {
      const rendered = renderTemplate(message.template, message.data);
      try {
        await transport.sendMail({ from, to: message.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      } catch (err) {
        throw new MailUnavailable("mail relay rejected or unreachable", { cause: err });
      }
    },
  };
}
