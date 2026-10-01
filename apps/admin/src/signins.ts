import type { AuditEntry, AuditPage, StaffMe } from "@korbat/contracts";
import type { StaffApi } from "./api";

/**
 * The home screen's list of every staff account's sign-ins in the last 7 days (3a design, section 9): the audit reader's
 * staff_sign_in filter, read page by page, newest first, until a sign-in older than 7 days.
 */
export const SIGN_IN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The server's time when it answered /me: the session's absolute end less the seconds it said were left. The console
 * keeps no clock of its own, so a browser whose clock is wrong still lists the right week.
 */
export function serverNow(me: StaffMe): number {
  return Date.parse(me.absoluteExpiresAt) - me.absoluteSecondsLeft * 1000;
}

/**
 * Reads pages through `readPage` (the cursor of the page before, or undefined for the newest) until one holds a sign-in
 * older than `since`, or there is no older page. A cursor that does not move back ends the reading, so an answer that
 * repeats itself cannot keep the page asking.
 */
export async function readRecentSignIns(readPage: (cursor: number | undefined) => Promise<AuditPage>, since: number): Promise<AuditEntry[]> {
  const list: AuditEntry[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = await readPage(cursor);
    for (const entry of page.entries) {
      if (Date.parse(entry.createdAt) < since) return list;
      if (entry.action === "staff_sign_in") list.push(entry);
    }
    if (page.nextCursor === null || (cursor !== undefined && page.nextCursor >= cursor)) return list;
    cursor = page.nextCursor;
  }
}

/**
 * The list as the home screen reads it when it opens: first the server's time, from a GET /api/staff/me of its own, then
 * the pages back to 7 days before that time. The session the page already holds will not do: it was read at sign-in, at
 * the page's opening or by the idle timer, whose read a person who keeps acting pushes away for hours. Every request is
 * marked, since opening the screen is its person's action.
 */
export async function readSignInsAtOpening(api: Pick<StaffApi, "me" | "audit">): Promise<AuditEntry[]> {
  const now = serverNow(await api.me({ activity: true }));
  return readRecentSignIns((cursor) => api.audit({ action: "staff_sign_in", cursor }, { activity: true }), now - SIGN_IN_WINDOW_MS);
}
