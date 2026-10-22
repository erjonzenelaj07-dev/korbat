import { View } from "react-native";
import { MEASURES, type AccountStanding, type AuthorCaseRow, type AuthorNoticesPage, type ReportItem, type ReportsPage } from "@korbat/contracts";
import { ListRow } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { Button, ErrorText } from "@/components/ui";
import { utcMinute } from "@/lib/moderation";
import { AUTO_WORDS, CASES_WORDS, RELEASE_TEXTS, UPLOAD_TEXTS } from "@/lib/moderation-words";
import { ORDER_TEXTS } from "@/lib/orders";
import { CASE_ROW_WORDS, bannerSentences, reportingLine, rowStrike, STANDING_TEXTS } from "@/lib/standing";
import { ItemLines } from "./ItemLines";

/** 3e: the kinds whose words in a row are the row's own (9.4), not the measure's label. */
const ROW_KINDS: Partial<Record<AuthorCaseRow["actions"][number], string>> = {
  overrule: CASE_ROW_WORDS.overrule,
  retire_handle: CASE_ROW_WORDS.retired,
  unretire_handle: CASE_ROW_WORDS.unretired,
  suspend: CASE_ROW_WORDS.suspended,
  lift_suspension: CASE_ROW_WORDS.lifted,
  // Task 5: a warning about the account's reports, and the lift of either reporting measure.
  warn_reporting: CASE_ROW_WORDS.warned,
  lift_reporting: CASE_ROW_WORDS.reportingLifted,
};

/**
 * 3e's review (people7; design, section 9.4): a suspension's or a termination's row and a lift's, in the row's own words
 * when the row says what they were: a suspension with its days and kind, a termination, a withdrawal for another measure,
 * the lift of a termination.
 */
function standingWords(row: AuthorCaseRow, kind: AuthorCaseRow["actions"][number]): string | null {
  const measure = row.standingMeasure;
  if ((kind === "suspend" || kind === "terminate") && measure !== undefined) {
    return measure.kind === "terminate" || measure.days === null ? CASE_ROW_WORDS.terminated : CASE_ROW_WORDS.suspendedFor(measure.days, measure.announced);
  }
  const lifted = row.liftedStanding;
  if (kind === "lift_suspension" && lifted !== undefined) return lifted.replaced ? CASE_ROW_WORDS.withdrawn : lifted.kind === "terminate" ? CASE_ROW_WORDS.terminationLifted : CASE_ROW_WORDS.lifted;
  return null;
}

/**
 * What a decision did, in the measures' own labels; a decision without a measure ended what was done while deciding, or
 * took no action. A review that kept the decision is worded by its outcome first: it lifts nothing, and the restriction
 * it answered stands; and so is a kept correction (3e's review, people3), korbat's answer to a reply that kept the
 * suspension or termination, which holds no row of its own.
 */
function done(row: AuthorCaseRow, now: Date): string {
  // 3f (design, section 9.3): an order's notice and the reinstatement after one, in the row's own words.
  if (row.order !== undefined) return ORDER_TEXTS.row[row.order];
  if ((row.kind === "review" || row.kind === "correction") && row.outcome === "kept") return CASES_WORDS.keptDecision;
  // 3e (design, section 9.4): a strike is named with where it stands, its overruling, a retirement and its reversal in
  // the row's own words.
  const labels: string[] = row.actions.map((kind) =>
    kind === "strike" && row.strike
      ? rowStrike(row.strike, now)
      : kind === "restrict_reporting" && row.reportingDays !== undefined
        ? CASE_ROW_WORDS.restricted(row.reportingDays)
        : (standingWords(row, kind) ?? ROW_KINDS[kind] ?? MEASURES[kind].label),
  );
  // Task 5: a reversal that ended a restriction of reporting resting on the decision it reversed says so; and (3e's
  // review, people7) one that ended a suspension or a termination.
  for (const ended of ["suspend", "terminate"] as const) if ((row.endedStanding ?? []).includes(ended)) labels.push(CASE_ROW_WORDS.standingEnded[ended]);
  if ((row.endedStanding ?? []).includes("restrict_reporting")) labels.push(CASE_ROW_WORDS.restrictionEnded);
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
 * decision's day, what was done, the rule or the law, and where its appeal stands. UI Task 7 (section 8.7): a vertical
 * list of ListRow links, dated, each its title in body-strong over its lines, with the row's chevron.
 */
export function DecisionsList({ decisions, now = new Date() }: { decisions: readonly AuthorCaseRow[]; now?: Date }) {
  if (decisions.length === 0) {
    return (
      <Text tone="medium" className="px-4 py-8">
        {CASES_WORDS.noDecisions}
      </Text>
    );
  }
  return (
    <View role="list">
      {decisions.map((row) => {
        const kind = kindWords(row);
        const lines = [
          // 3d Task 6 (section 9.6): a decision a program took says so; a person's later decision is its own row.
          row.byProgram === true ? AUTO_WORDS.row(done(row, now)) : done(row, now),
          // 3f: an order's row names no rule and no law of korbat's judgement.
          row.order === undefined && (row.ruleId || row.legal) ? (row.ruleId ? CASES_WORDS.rule(row.ruleId) : CASES_WORDS.law) : null,
          row.appealUntil ? CASES_WORDS.appealOpen(utcMinute(row.appealUntil)) : null,
          row.appeal ? CASES_WORDS.appealState[row.appeal] : null,
          row.reversedOn ? CASES_WORDS.reversed(row.reversedOn) : null,
        ];
        return (
          <View key={row.id} role="listitem">
            <ListRow
              label={row.post ? CASES_WORDS.post(utcMinute(row.post.createdAt)) : CASES_WORDS.profile}
              href={`/settings/cases/${row.id}`}
              detail={
                <View className="gap-0.5">
                  <Text variant="meta" tone="low">
                    {/* 3f's review (people9): an order's row shows the day its author was told, which the list sorts it by. */}
                    {row.toldOn !== undefined ? ORDER_TEXTS.row.toldOn(row.toldOn) : CASES_WORDS.decidedOn(row.decidedOn)}
                    {kind ? ` (${kind})` : ""}
                  </Text>
                  {lines.map((line, index) =>
                    line === null ? null : (
                      <Text key={index} variant="meta" tone={index === 0 ? "high" : "medium"}>
                        {line}
                      </Text>
                    ),
                  )}
                </View>
              }
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * 3d Task 2 (design, section 9.6): the notices about the account's posts that are not decisions, in "About you" above
 * its decisions, newest first: "Sealed images released", each with its day and a link to its notice; 3d Task 7: "An
 * upload was not accepted" for a refused upload. A release whose
 * notice may not be told yet is in no answer, so it is in no list. Nothing is shown while there is none.
 */
export function NoticesList({ notices }: { notices: AuthorNoticesPage["notices"] }) {
  if (notices.length === 0) return null;
  return (
    <View className="pt-4">
      <Text as="h2" variant="title" className="px-4 pb-1">
        {RELEASE_TEXTS.noticesTitle}
      </Text>
      {notices.map((notice) =>
        // 3d Task 7 (9.6): a refused upload's entry leads to its notice, a release's to its own.
        notice.kind === "upload_refused" ? (
          <ListRow key={notice.id} label={UPLOAD_TEXTS.entry} description={UPLOAD_TEXTS.entryOn(notice.at.slice(0, 10))} href={`/settings/cases/uploads/${notice.id}`} />
        ) : (
          <ListRow key={notice.id} label={RELEASE_TEXTS.entry} description={RELEASE_TEXTS.entryOn(notice.at.slice(0, 10))} href={`/settings/cases/releases/${notice.id}`} />
        ),
      )}
    </View>
  );
}

/**
 * "Your standing" (3e design, section 9.4), above "About you": how many of the account's strikes count now, and what that
 * many leads to; then the line of a suspension or a termination that /me carries, not fixed yet, announced, held by a
 * reply or running, in the banner's words (3e's review, people7); and (Task 5) [cases.reporting]: a restriction of the
 * account's reports that runs, or a warning about them that counts.
 */
export function StandingBlock({ activeStrikes, standing = null }: { activeStrikes: number; standing?: AccountStanding | null }) {
  const measure = bannerSentences(standing);
  const reporting = reportingLine(standing);
  // A card of surface-1 above the list: it says where the account stands, in words; no status colour (section 4.8).
  return (
    <View className="mx-4 mt-4 gap-1 rounded-card border border-line-low bg-surface-1 px-4 py-3">
      <Text as="h2" variant="title">
        {STANDING_TEXTS.cases.title}
      </Text>
      <Text tone="medium">{activeStrikes > 0 ? STANDING_TEXTS.cases.strikes(activeStrikes) : STANDING_TEXTS.cases.none}</Text>
      {measure !== null ? <Text tone="medium">{measure.join(" ")}</Text> : null}
      {reporting !== null ? <Text tone="medium">{reporting}</Text> : null}
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
        <View className="mx-4 mt-4 rounded-card border border-line-low bg-surface-1 px-4 pb-4 pt-3">
          <Text>{CASES_WORDS.mailStopped}</Text>
          <Button label={CASES_WORDS.resume} onPress={() => onResume?.()} busy={busy} tone="secondary" />
          <Text variant="meta" tone="medium" className="mt-2">
            {CASES_WORDS.resumeHint}
          </Text>
          <ErrorText message={error} />
        </View>
      ) : null}
      {page.reports.length === 0 ? (
        <Text tone="medium" className="px-4 py-8">
          {CASES_WORDS.noReports}
        </Text>
      ) : null}
      {page.reports.map((report) => (
        <View key={report.ref} className="border-b border-line-low px-4 pb-4 pt-4">
          <Text as="h2" variant="body-strong">
            {CASES_WORDS.report(report.ref, utcMinute(report.receivedAt))}
          </Text>
          <ItemLines items={report.items} onReexamine={onReexamine} />
        </View>
      ))}
    </View>
  );
}
