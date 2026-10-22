import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link } from "expo-router";
import type { ProfileListItem } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { LABEL_TONE, VerifiedChip, buttonFace } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { useHaptics } from "@/lib/haptics";
import { useMotion, usePressScale } from "@/lib/motion";
import { followFailedWords, toggleFollow } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { PagedList } from "./PagedList";

/**
 * One account in a list of followers or followings (UI design, sections 6.5, 6.11 and 8.4): the monogram, the display
 * name with the verified chip, the handle in the mono face and the bio, together one link to the profile, and the row's
 * action (FollowButton) beside it. Task 5 moves it onto ListRow.
 */
export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-line-low px-4 py-3">
      <Link href={`/u/${item.handle}`} asChild>
        <Pressable className={cn("min-h-[44px] flex-1 flex-row items-center gap-3 rounded-control web:hover:bg-surface-2", FOCUS_RING)}>
          <Avatar account={item} size={40} />
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-x-1.5">
              <Text variant="body-strong" className="shrink">
                {item.displayName}
              </Text>
              {item.verified ? <VerifiedChip /> : null}
            </View>
            <Text variant="mono" tone="low">
              @{item.handle}
            </Text>
            {item.bio ? (
              <Text tone="medium" numberOfLines={2} className="mt-0.5">
                {item.bio}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Link>
      {action}
    </View>
  );
}

/**
 * Follow or unfollow one account (section 8.4), with its words and states as they were: "Follow" as a primary button
 * while the reader does not follow, "Following" as a secondary one while they do. It is optimistic as the post's actions
 * are: the label changes at once with its haptic, the new label fading in over 160 ms (reduced, at once), and the
 * request goes out in the account's own lane, so a second tap meanwhile is not sent; the answer's state and follower
 * count are handed to `onChange`, and a refusal puts the old label back with the error haptic and a toast, or, for a
 * suspension, the standing's sentence under the button (3e, 9.4).
 */
export function FollowButton({ handle, initial, onChange }: { handle: string; initial: boolean; onChange?: (following: boolean, followerCount: number) => void }) {
  const { state } = useSession();
  const motion = useMotion();
  const haptic = useHaptics();
  const press = usePressScale(0.97);
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const label = useSharedValue(1);
  const shownAt = useRef(following);
  useEffect(() => {
    if (shownAt.current === following) return;
    shownAt.current = following;
    if (motion.reduced) return;
    label.value = 0;
    label.value = withTiming(1, motion.timing("easeOut", 160));
  }, [following]);
  const labelStyle = useAnimatedStyle(() => ({ opacity: label.value }));

  function toggle() {
    if (lanes.busy(laneKey.follow(handle))) return;
    haptic(following ? "toggleOff" : "toggleOn");
    const timer = setTimeout(() => setBusy(true), 400);
    void toggleFollow(social, lanes, handle, following, setFollowing).then((result) => {
      clearTimeout(timer);
      setBusy(false);
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        onChange?.(result.answer.following, result.answer.followerCount);
        return;
      }
      const err = result.error;
      haptic("error");
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: followFailedWords(handle, result.on), tone: "rollback" });
    });
  }

  const face = following ? "secondary" : "primary";
  return (
    <View {...dataAttribute("follow")} className="items-end">
      <Animated.View style={press.style}>
        <Pressable accessibilityRole="button" aria-busy={busy} onPress={toggle} {...press.handlers} {...pressDelay(0)} className={buttonFace({ face, size: "md" })}>
          <Animated.View style={labelStyle}>
            <Text variant="body-strong" tone={LABEL_TONE[face]}>
              {following ? UI_WORDS["follow.following"] : UI_WORDS["follow.follow"]}
            </Text>
          </Animated.View>
        </Pressable>
      </Animated.View>
      {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
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
