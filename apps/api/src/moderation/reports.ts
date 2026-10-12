import { sql } from "drizzle-orm";
import { REPORTS_PAGE_SIZE, itemOutcomeWords, type ExportFormat, type NoticeItemStatus, type ReportRow, type ReportsPage, type RuleId, type TdbCategory } from "@korbat/contracts";
import { decodeListCursor, encodeListCursor } from "./author";
import type { ModerationDeps } from "./context";
import { itemStatus, listedItems } from "./intake";
import { noticeItemsOf, noticeRecords, reporterNotices, type ReportsCursor } from "./repo";

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

// ---------------------------------------------------------------- the export's reports

/** A report or a notice as its sender's export lists it. */
export type ExportedReport = ExportFormat["moderation"]["reports"][number];

/** How many reports the export reads at a time, each page with its items and its records in a statement each. */
const EXPORT_PAGE_SIZE = 100;

/**
 * One item of a report as the export writes it (3c design, section 7.11), from the item exactly as the list and the
 * status page give it: its place, its link, and whether it is a re-examination. Its outcome, the outcome's words as the
 * list reads them and whether a re-examination is open are written only once the daily release has shown the outcome;
 * until then all three are null, so an export tells no more, and no sooner, than the list and the mail do.
 */
export function exportedItem(status: NoticeItemStatus): ExportedReport["items"][number] {
  const released = status.outcome !== null;
  return {
    position: status.position,
    link: status.link,
    reexamines: status.reexamines,
    outcome: status.outcome,
    outcomeText: itemOutcomeWords(status),
    // Open while the one request can still be made; false for an outcome that cannot be examined again at all.
    reexaminationOpen: released ? (status.reexamination?.open ?? false) : null,
  };
}

/**
 * The export's `reports` (ModerationForAccount.exportFor): the reports and notices the account sent, while korbat keeps
 * their records, newest first as its list shows them. The notices and their items come from the list's own reads and each
 * item from the status page's own function, so the export, the list, the page and the mail tell the same; the ground, the
 * category and the sender's own explanation come from the record's read. A report on the path for child sexual abuse
 * material is stored without its sender and is in nobody's export, and a record that was erased names no sender any more.
 */
export async function exportedReports(deps: Pick<ModerationDeps, "apiDb" | "social" | "config">, accountId: string): Promise<ExportedReport[]> {
  const exported: ExportedReport[] = [];
  let after: ReportsCursor | null = null;
  for (;;) {
    const page: Awaited<ReturnType<typeof reporterNotices>> = await reporterNotices(deps.apiDb, accountId, after, EXPORT_PAGE_SIZE);
    const ids = page.map((notice) => notice.id);
    const items = await noticeItemsOf(deps.apiDb, ids);
    // What each of them said, by its id; asked again for the same sender, so a record erased since the list was read is left out.
    const found = ids.length === 0 ? [] : await noticeRecords(deps.apiDb, sql`n.id = any(${`{${ids.join(",")}}`}::uuid[]) and n.reporter_id = ${accountId}::uuid`);
    const records = new Map(found.map((record) => [record.id, record]));
    for (const notice of page) {
      const record = records.get(notice.id);
      if (!record) continue;
      const rows: ExportedReport["items"] = [];
      for (const item of listedItems(items.get(notice.id) ?? [])) rows.push(exportedItem(await itemStatus(deps, item)));
      exported.push({
        ref: notice.ref,
        receivedAt: notice.receivedAt,
        // A sender's own report is never on the path for child sexual abuse material, which records none.
        ground: record.allegesIllegal ? "illegal" : "rule",
        ruleId: record.ruleId as RuleId | null,
        category: record.category as TdbCategory,
        explanation: record.explanation,
        items: rows,
      });
    }
    const last = page.at(-1);
    // A page that is not full is the last one.
    if (page.length < EXPORT_PAGE_SIZE || !last) return exported;
    after = { at: last.sortAt, id: last.id };
  }
}

/**
 * POST /api/moderation/report-mail/resume: lifts a stop of korbat's report mails to the account's address. The session
 * proves the address, which the account's sign-in code confirmed. It answers the same whether or not there was a stop.
 */
export async function resumeReportMail(deps: Pick<ModerationDeps, "auth">, viewer: string): Promise<void> {
  await deps.auth.resumeAccountReportMail(viewer);
}
