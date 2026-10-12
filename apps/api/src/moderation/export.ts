import type { ExportFormat, RuleId } from "@korbat/contracts";
import { exportedDecisions } from "./author";
import type { ModerationDeps } from "./context";
import { exportedReports } from "./reports";
import { exportedStrikes } from "./standing-repo";

/**
 * The moderation member of an account's data export (3c design, section 7.11), which the account module writes last in
 * export.json: the decisions about the account that its Cases screen lists, and the reports and notices it sent itself.
 *
 * This file only joins the two. The decisions are built in the author's file from the list's query and the statement's
 * data, neither of which can reach a report; the reports in the reporter's file from the list of the account's own
 * reports. So the member holds what those screens show and nothing they do not: never another person's report, who
 * reported, a notifier, a count of reports, or a staff member.
 */
export type ModerationExport = ExportFormat["moderation"];

/** ModerationForAccount.exportFor: both lists for one account, read before the archive's first byte. */
export async function exportFor(deps: Pick<ModerationDeps, "apiDb" | "social" | "config">, userId: string): Promise<ModerationExport> {
  // 3e: the strikes the account was given, from the ledger (W.8).
  const strikes = (await exportedStrikes(deps.apiDb, userId)).map((strike) => ({ ...strike, ruleId: strike.ruleId as RuleId }));
  const [decisions, reports] = await Promise.all([exportedDecisions(deps, userId), exportedReports(deps, userId)]);
  return { decisions, reports, strikes };
}
