import nodemailer from "nodemailer";
import type { MailMessage, Mailer } from "./mailer";
import { MailRefused, MailUnavailable } from "./mailer";
import { renderMail } from "./templates";

export interface SmtpOptions {
  /** Refuse to send unless a plain smtp:// relay upgrades the connection with STARTTLS. Production sets it. */
  requireTls?: boolean;
}

/**
 * nodemailer's settings for a relay URL such as smtps://user:pass@smtp-relay.example:465. The four time limits are
 * explicit because nodemailer's own are 2 minutes to connect, 30 seconds for the greeting, 10 minutes of silence on the
 * socket and 30 seconds for the name lookup: with these, a relay that does not answer, or answers and then stalls, fails
 * a send within about 50 seconds, so a sign-in code answers mail_unavailable within a minute and no job waits ten. A
 * message the relay took but acknowledged after 30 seconds is sent again by whoever retries, and may arrive twice.
 */
export function smtpTransportOptions(smtpUrl: string, options: SmtpOptions = {}) {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && options.requireTls === true,
    ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    dnsTimeout: 10_000,
  };
}

/**
 * A reply that begins with an RFC 3463 enhanced status saying that the recipient's address itself is bad: 5.1.1 (no such
 * mailbox), 5.1.2 (no such destination system), 5.1.3 (a malformed address), 5.1.6 (the mailbox has moved) or 5.1.10
 * (the domain accepts no mail, RFC 7505). The first line of a reply of several lines has a hyphen after its number.
 */
const BAD_RECIPIENT = /^5[0-9][0-9][ -]5[.]1[.](1|2|3|6|10)(?![0-9])/;

/**
 * Whether nodemailer's error says that the relay refused the recipient for good: an envelope error at RCPT TO with a 5yz
 * reply whose enhanced status names the address. Everything else can change with another try or with a fixed relay: a
 * connection or TLS error, failed credentials, a refused sender or message, any 4yz reply, and every other 5yz reply to
 * RCPT TO. Postfix checks its client and sender restrictions at RCPT TO too, so a relay that refuses korbat itself
 * (relaying denied, a sender it does not take, a quota) answers 5yz there for every recipient; those are not about the
 * recipient, and their mails wait until the relay or its settings are fixed.
 */
function recipientRefused(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, command, responseCode, response } = err as { code?: unknown; command?: unknown; responseCode?: unknown; response?: unknown };
  return code === "EENVELOPE" && command === "RCPT TO" && typeof responseCode === "number" && responseCode >= 500 && responseCode <= 599 && typeof response === "string" && BAD_RECIPIENT.test(response);
}

/** Sends through any SMTP relay given as a URL. */
export function smtpMailer(smtpUrl: string, from: string, options: SmtpOptions = {}): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(smtpUrl, options));
  return {
    async send(message: MailMessage) {
      const rendered = renderMail(message);
      try {
        await transport.sendMail({ from, to: message.to, subject: rendered.subject, text: rendered.text, html: rendered.html });
      } catch (err) {
        if (recipientRefused(err)) throw new MailRefused("mail relay refused the recipient's address", { cause: err });
        throw new MailUnavailable("mail relay rejected or unreachable", { cause: err });
      }
    },
  };
}
