import { AuditPageQuery, type AuditPage } from "@korbat/contracts";
import type { StaffApi } from "./api";

/**
 * The audit log's reading (3a design, sections 2 and 9): newest first, "Load older" from a page's cursor, and "Go to
 * place", which opens the page whose newest row is at a place the keeper kept. Each read is a person's action.
 */

/**
 * A place as the keeper typed or pasted it, checked by the reader's own query schema (a positive whole number of at most
 * 15 digits), or null, which asks nothing of the API.
 */
export function parsePlace(text: string): number | null {
  const parsed = AuditPageQuery.safeParse({ at: text.trim() });
  return parsed.success && parsed.data.at !== undefined ? parsed.data.at : null;
}

export function createAuditReader(api: StaffApi) {
  return {
    newest: (): Promise<AuditPage> => api.audit({}, { activity: true }),
    older: (cursor: number): Promise<AuditPage> => api.audit({ cursor }, { activity: true }),
    at: (place: number): Promise<AuditPage> => api.audit({ at: place }, { activity: true }),
  };
}
