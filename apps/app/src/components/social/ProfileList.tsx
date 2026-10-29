import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { ProfileListItem } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { LABEL_TONE, VerifiedChip, buttonFace } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { dataAttribute, pressDelay } from "@/components/kit/interaction";
import { ListRow } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { useHaptics } from "@/lib/haptics";
import { useMotion, usePressScale } from "@/lib/motion";
import { followFailedWords, toggleFollow } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social, type Page } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { PagedList } from "./PagedList";

/**
 * One account in a list of followers or followings (UI design, sections 6.5, 6.11 and 8.4), as a ListRow: the monogram
 * in the icon's place, the display name with the verified chip, the handle in the mono face and the bio, together one
 * link to the profile, and FollowButton as the row's control, beside the link and outside it.
 */
export function ProfileRow({ item, action }: { item: ProfileListItem; action?: ReactElement }) {
  return (
    <ListRow
      label={item.displayName}
      href={`/u/${item.handle}`}
      leading={<Avatar account={item} size={40} src={item.avatar} />}
      badge={item.verified ? <VerifiedChip /> : undefined}
      detail={
        <>
          <Text variant="mono" tone="low">
            @{item.handle}
          </Text>
          {item.bio ? (
            <Text tone="medium" numberOfLines={2} className="mt-0.5">
              {item.bio}
            </Text>
          ) : null}
        </>
      }
      control={action ? { kind: "button", element: action } : undefined}
    />
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
      kind="accounts"
      render={(item, remove) => <ProfileRow item={item} action={action?.(item, () => remove(item.id))} />}
    />
  );
}
