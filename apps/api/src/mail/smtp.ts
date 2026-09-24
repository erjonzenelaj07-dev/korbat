import nodemailer from "nodemailer";
import type { MailMessage, Mailer } from "./mailer";
import { MailUnavailable } from "./mailer";
import { renderTemplate } from "./templates";

export interface SmtpOptions {
  /** Refuse to send unless a plain smtp:// relay upgrades the connection with STARTTLS. Production sets it. */
  requireTls?: boolean;
}

/** nodemailer's settings for a relay URL such as smtps://user:pass@smtp-relay.example:465. */
export function smtpTransportOptions(smtpUrl: string, options: SmtpOptions = {}) {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && options.requireTls === true,
    ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
  };
}

/** Sends through any SMTP relay given as a URL. */
export function smtpMailer(smtpUrl: string, from: string, options: SmtpOptions = {}): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(smtpUrl, options));
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
