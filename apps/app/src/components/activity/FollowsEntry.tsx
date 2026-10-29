import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { ActivityEntry } from "@korbat/contracts";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { ACTIVITY_WORDS } from "@/lib/activity-words";
import { cn } from "@/theme/cn";
import { EntryArticle, EntryLine } from "./PostEntry";

type FollowsItem = Extract<ActivityEntry, { type: "follows" }>;

/**
 * The follows of one UTC day (2d design, decision 6, sections 5.5.3 and 10.2): up to three 32 px avatars side by side,
 * the line ("Ada and 4 others followed you") and the time of the newest follow, never the day itself. The row is not
 * pressable: each account shown is its own link to its profile, its avatar in a 44 px target named by its display name
 * (the line names one or two of them, so the avatars are where all three are), and a group of more than three ends with
 * "See your followers", the account's own Followers list.
 */
export function FollowsEntry({ entry, handle }: { entry: FollowsItem; handle: string }) {
  return (
    <EntryArticle entry={entry} className="gap-1 border-b border-line-low px-4 py-3">
      <View className="-ml-1.5 flex-row">
        {entry.actors.map((actor) => (
          <Link key={actor.id} href={`/u/${actor.handle}`} asChild>
            <Pressable aria-label={actor.displayName} className={cn("h-11 w-11 items-center justify-center rounded-full", FOCUS_RING)}>
              <Avatar account={actor} size={32} src={actor.avatar} />
            </Pressable>
          </Link>
        ))}
      </View>
      <EntryLine entry={entry} />
      {entry.count > 3 ? (
        <Link href={`/u/${handle}/followers`} asChild>
          <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {ACTIVITY_WORDS["activity.follow.all"]}
            </Text>
          </Pressable>
        </Link>
      ) : null}
    </EntryArticle>
  );
}
