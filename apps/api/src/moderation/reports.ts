import { REPORTS_PAGE_SIZE, type ReportRow, type ReportsPage } from "@korbat/contracts";
import { decodeListCursor, encodeListCursor } from "./author";
import type { ModerationDeps } from "./context";
import { itemStatus, listedItems } from "./intake";
import { noticeItemsOf, reporterNotices } from "./repo";

/**
 * The reporter's list (3c design, section 7.6): the reports and notices an account sent, while korbat keeps their
 * records, each item exactly as the status page gives it (the same function builds both) and with its id, so the list,
 * the page and the mail tell the same at the same time and in the same words. A report on the path for child sexual abuse material is
 * stored without its sender and is therefore in nobody's list: whoever sent it follows it with the link they were shown.
 */

/** GET /api/moderation/reports: the viewer's own reports and notices, newest first, 20 a page, with whether korbat's report mails to the account are stopped. */
export async function reporterList(deps: Pick<ModerationDeps, "apiDb" | "auth" | "social" | "config">, viewer: string, cursor?: string): Promise<ReportsPage> {
  const after = cursor === undefined ? null : decodeListCursor(cursor);
  const found = await reporterNotices(deps.apiDb, viewer, after, REPORTS_PAGE_SIZE + 1);
  const page = found.slice(0, REPORTS_PAGE_SIZE);
  const items = await noticeItemsOf(deps.apiDb, page.map((notice) => notice.id));
  const reports: ReportRow[] = [];
  for (const notice of page) {
    const rows: ReportRow["items"] = [];
    // Each item as the status page gives it, and its id, by which its sender asks for a re-examination.
    for (const item of listedItems(items.get(notice.id) ?? [])) rows.push({ ...(await itemStatus(deps, item)), id: item.id });
    reports.push({ ref: notice.ref, receivedAt: notice.receivedAt, items: rows });
  }
  const last = page.at(-1);
  return {
    reports,
    // One row more than the page was read: only then is there a next page.
    nextCursor: found.length > REPORTS_PAGE_SIZE && last ? encodeListCursor({ at: last.sortAt, id: last.id }) : null,
    // The account's address is the auth module's alone: it answers whether that address stopped korbat's report mails.
    reportMailStopped: await deps.auth.accountReportMailStopped(viewer),
  };
}

/**
 * POST /api/moderation/report-mail/resume: lifts a stop of korbat's report mails to the account's address. The session
 * proves the address, which the account's sign-in code confirmed. It answers the same whether or not there was a stop.
 */
export async function resumeReportMail(deps: Pick<ModerationDeps, "auth">, viewer: string): Promise<void> {
  await deps.auth.resumeAccountReportMail(viewer);
}
