import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { MODERATION_REFUSAL_STATUS, REFUSAL_STATUS } from "./browser/fixture-api";

/**
 * The browser check's fixtures answer each staff refusal with the status the API answers it with (3a design, section 12:
 * the fixtures answer as the API behind Caddy's console site would), so the console meets in the check what it meets in
 * production, and the check's watcher allows exactly the statuses the API sends. The API's statuses are read from its own
 * source, where every staff refusal is an AuthError with its code and status.
 */
const STAFF_FLOWS = path.resolve(import.meta.dirname, "../../api/src/auth/staff");

/** Every (code, status) pair the staff flows raise, from `new AuthError("staff_...", NNN)`. */
function apiStatuses(): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  for (const file of readdirSync(STAFF_FLOWS).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(STAFF_FLOWS, file), "utf8");
    for (const match of source.matchAll(/new AuthError\("(staff_[a-z_]+)", (\d{3})\)/g)) {
      const statuses = found.get(match[1]!) ?? new Set<number>();
      statuses.add(Number(match[2]));
      found.set(match[1]!, statuses);
    }
  }
  return found;
}

/** The status of every code of the moderation module's table, from the lines of its STATUS record. */
function moderationStatuses(): Map<string, number> {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../api/src/moderation/context.ts"), "utf8");
  const table = source.slice(source.indexOf("const STATUS"), source.indexOf("};", source.indexOf("const STATUS")));
  return new Map([...table.matchAll(/^ {2}([a-z_]+): ([0-9]{3}),$/gm)].map((found) => [found[1]!, Number(found[2])]));
}

describe("the browser check's refusals carry the API's statuses", () => {
  test("every moderation refusal the fixtures answer has the status the moderation module answers it with", () => {
    const api = moderationStatuses();
    // The table was found and read: it holds the codes of the notice routes as well as the console's.
    expect(api.size).toBeGreaterThan(20);
    for (const [code, status] of Object.entries(MODERATION_REFUSAL_STATUS)) expect(api.get(code), code).toBe(status);
  });

  test("every staff code the API raises has one status, and the fixtures answer it with that status", () => {
    const api = apiStatuses();
    // Every code the staff flows raise, so a scan that found nothing cannot pass.
    expect([...api.keys()].sort()).toEqual([...StaffErrorCode.options].sort());
    for (const [code, statuses] of api) {
      expect([...statuses], code).toHaveLength(1);
      expect(REFUSAL_STATUS[code as StaffErrorCode], code).toBe([...statuses][0]);
    }
  });
});
