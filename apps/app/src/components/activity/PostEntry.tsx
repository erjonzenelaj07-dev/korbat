import type { ReactNode } from "react";
import { View } from "react-native";
import type { ActivityEntry } from "@korbat/contracts";
import { Text } from "@/components/kit/Text";
import { PostCard } from "@/components/social/PostCard";
import { activityWhen, entryLine, entryName } from "@/lib/activity";
import { ACTIVITY_WORDS } from "@/lib/activity-words";
import { fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { FOCUS_RING_INSET } from "@/components/kit/interaction";

type PostItem = Extract<ActivityEntry, { type: "post" }>;

/**
 * Every row of Activity is an article named by its line and its time, "New, " first while it is new (10.2), so a screen
 * reader moving by item hears what each is and which are new. It takes the focus by script only (after the pill, a
 * refresh or Load more), with the ring drawn inside, as a row's.
 */
export function EntryArticle({ entry, children, className }: { entry: ActivityEntry; children: ReactNode; className?: string }) {
  return (
    <View role="article" aria-label={entryName(entry)} tabIndex={-1} className={cn(FOCUS_RING_INSET, className)}>
      {children}
    </View>
  );
}

/** The line and the time as the row shows them, in meta, ink-medium; the article's name says the same, so it is hidden. */
export function EntryLine({ entry, children }: { entry: ActivityEntry; children?: ReactNode }) {
  return (
    <Text aria-hidden variant="meta" tone="medium">
      {children ?? fill(ACTIVITY_WORDS["activity.entry.name"], { line: entryLine(entry), time: activityWhen(entry.at) })}
    </Text>
  );
}

/**
 * A reply, a mention or a quote (2d design, sections 5.5.3 and 10.2): the line, then the post as PostCard's quiet card,
 * with the actor's 40 px avatar, its links, its images, its body opening the post, and one action, Reply, which opens the
 * thread with the reply card open, as the feed's Reply does, since each entry is a conversation to answer. No Like or
 * Repost keeps the row quiet; nothing is highlighted by colour.
 */
export function PostEntry({ entry }: { entry: PostItem }) {
  return (
    <EntryArticle entry={entry} className="border-b border-line-low pt-3">
      <View className="pl-[68px] pr-4">
        <EntryLine entry={entry} />
      </View>
      <PostCard post={entry.post} quiet />
    </EntryArticle>
  );
}
