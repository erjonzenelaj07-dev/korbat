import type { TemplateName } from "../../mail/mailer";
import type { AuthDeps } from "../context";

/** A notice about a security-relevant change. Best effort: a failed send is logged and never undoes the change. */
export async function notifyAccount(deps: AuthDeps, to: string, template: TemplateName, data: Record<string, string> = {}): Promise<void> {
  try {
    await deps.mailer.send({ to, template, data });
  } catch (err) {
    deps.log.error({ err, template }, "security notice email failed");
  }
}

/**
 * A time as the notices print it: the date and the minute in UTC, since the reader's zone is unknown. The staff mails use
 * it (3a design, section 7), printing times as 1c's passkey notices do.
 */
export function noticeTime(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
