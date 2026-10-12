import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { MEASURES, type AuthorCaseRow, type ReportItem, type ReportsPage } from "@korbat/contracts";
import { Button, ErrorText } from "@/components/ui";
import { utcMinute } from "@/lib/moderation";
import { CASES_WORDS } from "@/lib/moderation-words";
import { ItemLines } from "./ItemLines";

/** What a decision did, in the measures' own labels; a decision without a measure ended what was done while deciding, or took no action. */
function done(row: AuthorCaseRow): string {
  const labels: string[] = row.actions.map((kind) => MEASURES[kind].label);
  if (row.endedInterim) labels.push(CASES_WORDS.ended);
  return labels.length > 0 ? labels.join(", ") : CASES_WORDS.noAction;
}

/** Which kind of decision it is, where that is not plain from what it did. */
function kindWords(row: AuthorCaseRow): string | null {
  if (row.kind === "interim") return CASES_WORDS.whileDeciding;
  if (row.kind === "review") return CASES_WORDS.review;
  if (row.kind === "correction") return CASES_WORDS.correction;
  return null;
}

/**
 * "About you" (3c design, section 9): the decisions about the account that its holder was told of, newest first. Each
 * row is a link to the decision's screen and says what it is about (the post, by its creation time, or the profile), the
 * decision's day, what was done, the rule or the law, and where its appeal stands.
 */
export function DecisionsList({ decisions }: { decisions: readonly AuthorCaseRow[] }) {
  if (decisions.length === 0) return <Text className="px-4 py-8 text-base text-zinc-400">{CASES_WORDS.noDecisions}</Text>;
  return (
    <View>
      {decisions.map((row) => {
        const kind = kindWords(row);
        return (
          <Link key={row.id} href={`/settings/cases/${row.id}`} asChild>
            <Pressable className="border-b border-zinc-800 px-4 py-3">
              <Text className="text-base font-semibold text-zinc-50">{row.post ? CASES_WORDS.post(utcMinute(row.post.createdAt)) : CASES_WORDS.profile}</Text>
              <Text className="mt-1 text-sm text-zinc-400">
                {CASES_WORDS.decidedOn(row.decidedOn)}
                {kind ? ` (${kind})` : ""}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-zinc-200">{done(row)}</Text>
              {row.ruleId || row.legal ? <Text className="mt-1 text-sm text-zinc-300">{row.ruleId ? CASES_WORDS.rule(row.ruleId) : CASES_WORDS.law}</Text> : null}
              {row.appealUntil ? <Text className="mt-1 text-sm text-zinc-300">{CASES_WORDS.appealOpen(utcMinute(row.appealUntil))}</Text> : null}
              {row.appeal ? <Text className="mt-1 text-sm text-zinc-300">{CASES_WORDS.appealState[row.appeal]}</Text> : null}
              {row.reversedOn ? <Text className="mt-1 text-sm text-zinc-300">{CASES_WORDS.reversed(row.reversedOn)}</Text> : null}
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

/**
 * "Your reports" (3c design, section 9): the account's reports with each item as the status page words it. When the
 * account's address stopped korbat's report mails (someone who holds it asked for that on a status page), the tab says so
 * above the list, with the button that resumes them: the outcomes are listed here either way. With `onReexamine` each
 * item whose answer can still be examined again carries "Ask for a re-examination", asked by the item's id.
 */
export function ReportsList({
  page,
  onResume,
  onReexamine,
  busy = false,
  error = null,
}: {
  page: Pick<ReportsPage, "reports" | "reportMailStopped">;
  onResume?: () => void;
  onReexamine?: (item: ReportItem, statement: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <View>
      {page.reportMailStopped ? (
        <View className="border-b border-zinc-800 px-4 pb-4 pt-3">
          <Text className="text-sm leading-5 text-zinc-200">{CASES_WORDS.mailStopped}</Text>
          <Button label={CASES_WORDS.resume} onPress={() => onResume?.()} busy={busy} tone="secondary" />
          <Text className="mt-2 text-sm leading-5 text-zinc-400">{CASES_WORDS.resumeHint}</Text>
          <ErrorText message={error} />
        </View>
      ) : null}
      {page.reports.length === 0 ? <Text className="px-4 py-8 text-base text-zinc-400">{CASES_WORDS.noReports}</Text> : null}
      {page.reports.map((report) => (
        <View key={report.ref} className="border-b border-zinc-800 px-4 pb-4 pt-3">
          <Text className="text-base font-semibold text-zinc-50">{CASES_WORDS.report(report.ref, utcMinute(report.receivedAt))}</Text>
          <ItemLines items={report.items} onReexamine={onReexamine} />
        </View>
      ))}
    </View>
  );
}
