import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { ProfileListItem } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social, type Page } from "@/lib/social";
import { PagedList } from "./PagedList";

export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <View className="flex-row items-center border-b border-zinc-800 px-4 py-3">
      <Pressable accessibilityRole="link" onPress={() => router.push(`/u/${item.handle}`)} className="flex-1 pr-3">
        <Text className="text-base font-semibold text-zinc-50">
          {item.displayName}
          {item.verified ? <Text className="text-sky-400"> ✓</Text> : null}
        </Text>
        <Text className="text-sm text-zinc-500">@{item.handle}</Text>
        {item.bio ? (
          <Text className="mt-1 text-sm text-zinc-300" numberOfLines={2}>
            {item.bio}
          </Text>
        ) : null}
      </Pressable>
      {action}
    </View>
  );
}

/** Follow or unfollow one account; the label follows the server's answer. */
export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const result = await social.setFollow(handle, !following);
      setFollowing(result.following);
      onChange?.(result.following, result.followerCount);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="items-end">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: following, busy }}
        disabled={busy}
        onPress={() => void toggle()}
        className={`rounded-full px-4 py-1.5 ${following ? "border border-zinc-600" : "bg-zinc-50"}`}
      >
        <Text className={`text-sm font-semibold ${following ? "text-zinc-200" : "text-zinc-950"}`}>{following ? "Following" : "Follow"}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ProfileList({
  fetchPage,
  empty,
  header,
  action,
}: {
  fetchPage: (cursor?: string) => Promise<Page<ProfileListItem>>;
  empty: string;
  header?: ReactElement;
  action?: (item: ProfileListItem, remove: () => void) => ReactElement | undefined;
}) {
  return (
    <PagedList
      fetchPage={fetchPage}
      keyOf={(item) => item.id}
      empty={empty}
      header={header}
      render={(item, remove) => <ProfileRow item={item} action={action?.(item, () => remove(item.id))} />}
    />
  );
}
