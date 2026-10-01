/**
 * The command line's mailer (3a design, section 7): grant-role's demotion and the staff command line's revocations mail
 * the key's owner. It is built as the API builds its mailer, from SMTP_URL and MAIL_FROM alone, so a command that mails
 * needs nothing else of the API's configuration. This file has no entry point of its own, so both bundles can include
 * it (build.mjs says why that matters).
 */
import { z } from "zod";
import { mailFrom, smtpUrl } from "../config";
import type { Mailer } from "../mail/mailer";
import { smtpMailer } from "../mail/smtp";

const MAIL_ENV = z.object({ SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface CommandLineMailSettings {
  smtpUrl: string;
  mailFrom: string;
  /** Production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
  requireTls: boolean;
}

/** The mail settings a command that mails reads, naming the one that is missing or wrong and nothing else. */
export function commandLineMailSettings(env: Record<string, string | undefined>): CommandLineMailSettings {
  const result = MAIL_ENV.safeParse(env);
  if (!result.success) throw new Error(`Invalid mail settings:\n${z.prettifyError(result.error)}`);
  return { smtpUrl: result.data.SMTP_URL, mailFrom: result.data.MAIL_FROM, requireTls: result.data.NODE_ENV === "production" };
}

/** The mailer itself. A send that fails throws MailUnavailable; the commands report it as a warning that undoes nothing. */
export function commandLineMailer(env: Record<string, string | undefined>): Mailer {
  return mailerFor(commandLineMailSettings(env));
}

/** The same mailer from settings a command read with its own schema, as staff.js revoke reads them beside its database URL. */
export function mailerFor(settings: CommandLineMailSettings): Mailer {
  return smtpMailer(settings.smtpUrl, settings.mailFrom, { requireTls: settings.requireTls });
}
