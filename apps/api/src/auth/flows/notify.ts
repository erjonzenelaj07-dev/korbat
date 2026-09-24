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
