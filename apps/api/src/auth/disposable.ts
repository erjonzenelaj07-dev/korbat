import { DISPOSABLE_DOMAINS } from "./data/disposable-domains";

const blocked: ReadonlySet<string> = new Set(DISPOSABLE_DOMAINS);

/** True when the email's domain, or any parent domain of it, is on the disposable list. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
