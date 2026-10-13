import type { ExportFormat, RuleId, StandingBasis } from "@korbat/contracts";
import { exportedDecisions } from "./author";
import type { ModerationDeps } from "./context";
import { exportedReports } from "./reports";
import { exportedReplies, exportedReporting, exportedStanding, exportedStrikes } from "./standing-repo";

/**
 * The moderation member of an account's data export (3c design, section 7.11), which the account module writes last in
 * export.json: the decisions about the account that its Cases screen lists, and the reports and notices it sent itself.
 *
 * This file only joins them. The decisions are built in the author's file from the list's query and the statement's
 * data, neither of which can reach a report; the reports in the reporter's file from the list of the account's own
 * reports. So the member holds what those screens show and nothing they do not: never another person's report, who
 * reported, a notifier, a count of reports about the account, or a staff member.
 */
export type ModerationExport = ExportFormat["moderation"];

/**
 * ModerationForAccount.exportFor: the lists for one account, read before the archive's first byte. 3e (W.8) adds, from the
 * ledger and the tables of account sanctions, the strikes the account was given, its suspensions, terminations and
 * reporting measures, its replies to them, and its own reporting counts: each the account's own data, a mark by the
 * reference and position of the account's own report, and nothing that names a reporter, an author it reported or a
 * staff member.
 */
export async function exportFor(deps: Pick<ModerationDeps, "apiDb" | "social" | "config">, userId: string): Promise<ModerationExport> {
  const strikes = (await exportedStrikes(deps.apiDb, userId)).map((strike) => ({ ...strike, ruleId: strike.ruleId as RuleId }));
  // The database checks the basis against the same list the contracts hold (STANDING_BASES), so the cast names no new value.
  const standing = (await exportedStanding(deps.apiDb, userId)).map((entry) => ({ ...entry, basis: entry.basis as StandingBasis }));
  const replies = await exportedReplies(deps.apiDb, userId);
  const reporting = await exportedReporting(deps.apiDb, userId);
  const [decisions, reports] = await Promise.all([exportedDecisions(deps, userId), exportedReports(deps, userId)]);
  return { decisions, reports, strikes, standing, replies, reporting };
}
