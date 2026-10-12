import type { SourceSummary } from "@korbat/contracts";

/**
 * The console's own words for what its screens count and name (3c design, section 8): lanes, waiting times, categories
 * and the bands of a source's summary. No screen prints a value an answer carried in a place where the console speaks
 * for itself: an enum is worded here, and a string a person wrote is shown as text in a frame.
 */

/** The queue's three lanes, as the home screen and the queue name them. */
export const LANE_NAMES = { 0: "Urgent", 1: "Lane 1", 2: "Lane 2" } as const;

/** "1 case", "2 cases". */
export const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** How long something has waited, coarsely: minutes under an hour, hours under two days, days after that. */
export function waited(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return counted(minutes, "minute", "minutes");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return counted(hours, "hour", "hours");
  return counted(Math.floor(hours / 24), "day", "days");
}

/** A Transparency Database category as a few plain words: "protection of minors" for STATEMENT_CATEGORY_PROTECTION_OF_MINORS. */
export function categoryLabel(category: string): string {
  const words = category.replace(/^STATEMENT_CATEGORY_/, "").toLowerCase().split("_").join(" ");
  return words === "other violation tc" ? "other breach of the rules" : words;
}

/** The two rules whose texts open collapsed: what they are about, for the button that shows the text. */
export const COLLAPSED_RULES: Record<string, string> = { R3: "hatred or harassment", R5: "direct threats" };

const AGE: Record<NonNullable<SourceSummary["accountAge"]>, string> = { under_1_month: "under 1 month old", "1_to_12_months": "1 to 12 months old", over_12_months: "over 12 months old" };
const FILED: Record<NonNullable<SourceSummary["itemsFiled"]>, string> = { "1": "this is its only report", "2_to_9": "2 to 9 reports filed", "10_or_more": "10 or more reports filed" };
const ACTED: Record<NonNullable<SourceSummary["actedOn"]>, string> = {
  none_decided: "none decided yet",
  none: "none of the decided ones acted on",
  under_half: "under half of the decided ones acted on",
  half_or_more: "half or more of the decided ones acted on",
};
const UNSEEN: Record<NonNullable<SourceSummary["answeredUnseen"]>, string> = { none: "", "1": "1 answered without the images", "2_to_9": "2 to 9 answered without the images", "10_or_more": "10 or more answered without the images" };

/**
 * A source's summary in words, after its label: bands for a signed-in reporter, never a count; for a notifier what was
 * given and whether it is confirmed or stopped, never what; nothing more for an anonymous notice or a finding.
 */
export function sourceWords(source: SourceSummary): string {
  if (source.kind === "reporter") {
    const parts = [source.accountAge === null ? "" : `account ${AGE[source.accountAge]}`, source.itemsFiled === null ? "" : FILED[source.itemsFiled], source.actedOn === null ? "" : ACTED[source.actedOn]];
    if (source.answeredUnseen !== null) parts.push(UNSEEN[source.answeredUnseen]);
    return parts.filter((part) => part !== "").join("; ");
  }
  if (source.kind === "notifier") {
    if (source.contactLost) return "signed out; contact lost or forgotten";
    const parts = ["signed out", source.named ? "gave a name" : "gave no name", source.contactGiven ? "gave an address" : "gave no address"];
    if (source.contactGiven) parts.push(source.confirmed ? "address confirmed" : "address not confirmed");
    if (source.suppressed) parts.push("asked korbat to stop its emails");
    return parts.join("; ");
  }
  if (source.kind === "anonymous") return "a notice of child sexual abuse material records no sender";
  if (source.kind === "unlinked") return "the link to the account is no longer kept";
  return "";
}

/** Who a frame says wrote an item's words. */
export function writtenBy(source: SourceSummary): string {
  if (source.kind === "reporter") return `Written by ${source.label}`;
  if (source.kind === "unlinked") return "Written by a reporter no longer linked";
  return "Written by a notifier";
}

/** Whether "Reveal who sent this" is offered: only when the summary names someone, a linked reporter or a notifier who gave a name. */
export const revealable = (source: SourceSummary): boolean => source.kind === "reporter" || (source.kind === "notifier" && source.named === true && !source.contactLost);
