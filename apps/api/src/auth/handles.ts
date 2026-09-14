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

/** Handles are 3-20 of a-z, 0-9 and underscore, and not reserved. Input is expected already lowercased. */
export function checkHandle(handle: string): HandleError | null {
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return "handle_invalid";
  if (RESERVED_HANDLES.has(handle)) return "handle_reserved";
  return null;
}
