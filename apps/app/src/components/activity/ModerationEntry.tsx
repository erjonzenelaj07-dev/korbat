import type { ActivityEntry } from "@korbat/contracts";
import { ListRow } from "@/components/kit/ListRow";
import { activityWhen, entryLine } from "@/lib/activity";
import { ACTIVITY_WORDS } from "@/lib/activity-words";
import { EntryArticle } from "./PostEntry";

type ModerationItem = Extract<ActivityEntry, { type: "moderation" }>;

/** Where a notice opens (5.5.3): its screen under Settings, Cases, or the post for a lost image. */
export function moderationHref(entry: ModerationItem): string {
  if (entry.kind === "release") return `/settings/cases/releases/${entry.id}`;
  if (entry.kind === "upload") return `/settings/cases/uploads/${entry.id}`;
  if (entry.kind === "lost") return `/post/${entry.postId}`;
  return `/settings/cases/${entry.id}`;
}

/**
 * A notice korbat told the person about their own content or account (2d design, sections 5.5.2, 5.5.3 and 10.2): a link
 * row with the scales the Cases screen uses, the line, the time the person was told, and "Open in Cases" where it opens
 * under Cases; a lost image opens its post, so its row says nothing of Cases.
 */
export function ModerationEntry({ entry }: { entry: ModerationItem }) {
  return (
    <EntryArticle entry={entry}>
      <ListRow label={entryLine(entry)} description={activityWhen(entry.at)} icon="cases" href={moderationHref(entry)} value={entry.kind === "lost" ? undefined : ACTIVITY_WORDS["activity.moderation.open"]} />
    </EntryArticle>
  );
}
