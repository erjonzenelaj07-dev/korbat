import { RETIRED_HANDLE_PREFIX } from "@korbat/contracts";

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "korbat",
  "support",
  "help",
  "moderator",
  "mod",
  "staff",
  "security",
  "root",
  "system",
  "official",
  "api",
  "www",
  "about",
  "rules",
  "transparency",
  "settings",
]);

export type HandleError = "handle_invalid" | "handle_reserved";

/**
 * Handles are 3-20 of a-z, 0-9 and underscore, and not reserved. Input is expected already lowercased. The whole prefix of
 * a retired handle's placeholder is reserved (3e design, section 7.10 item 4), not only its exact form, so no handle
 * anyone chooses can pass for an account whose handle korbat retired.
 */
export function checkHandle(handle: string): HandleError | null {
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return "handle_invalid";
  if (RESERVED_HANDLES.has(handle) || handle.startsWith(RETIRED_HANDLE_PREFIX)) return "handle_reserved";
  return null;
}
