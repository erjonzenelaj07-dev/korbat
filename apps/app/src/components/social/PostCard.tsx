import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, Text as Inline, View } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { toast } from "@/components/toast";
import { ErrorText, VerifiedChip } from "@/components/ui";
import { Avatar } from "@/components/kit/Avatar";
import { Icon } from "@/components/kit/Icon";
import { IconButton, type IconButtonFeedback } from "@/components/kit/IconButton";
import { FOCUS_RING, dataAttribute, pressDelay } from "@/components/kit/interaction";
import { Menu, type MenuItem } from "@/components/kit/Menu";
import { StatusChip, type StatusTone } from "@/components/kit/StatusChip";
import { Text } from "@/components/kit/Text";
import { VISUALLY_HIDDEN, VisuallyHidden } from "@/components/kit/VisuallyHidden";
import { errorMessage } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { useHaptics } from "@/lib/haptics";
import { chipText } from "@/lib/moderation";
import { CHIP_WORDS } from "@/lib/moderation-words";
import { useMotion } from "@/lib/motion";
import { countLabel, deleteWithLeave, failedWords, shownCount, threadStats, toggleEngagement, type ToggleKind } from "@/lib/post-actions";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { lanes, laneKey, social } from "@/lib/social";
import { fullDate, postedWhen, timeAgo } from "@/lib/time";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { ImagePriority, MediaGrid } from "./MediaGrid";
import { PostMenu } from "./PostMenu";
import { RichText } from "./RichText";

/**
 * A link inside a line of text (the author line, the repost line, the reply context): inline, so a phone holds it to
 * WCAG 2.5.8's 24 px rather than a control's 44, and padded to reach it, which does not move the line.
 */
const INLINE_LINK = cn("rounded-sm py-1.5 web:hover:underline", FOCUS_RING);

/**
 * Who wrote the post and when (UI design, section 6.6): the display name in body-strong as the link to the profile, the
 * verified chip, the handle in the mono face, and the time as the post's one link. The time shows its short form ("3h"),
 * hidden from the link's name, which says it inside postedWhen's words ("3h ago, open the post"), so the name contains
 * the visible label. The thread's focused post shows the full date instead. The card's own line marks its time link as
 * the article's open link (`open`), which a feed's Page Down and Page Up move the focus to; a quote's line does not.
 */
function AuthorLine({ author, createdAt, postId, large = false, open = false }: { author: Author; createdAt: string; postId: string; large?: boolean; open?: boolean }) {
  const shown = large ? fullDate(createdAt) : timeAgo(createdAt);
  const when = large ? fill(UI_WORDS["time.posted.on"], { date: shown }) : postedWhen(createdAt);
  return (
    <View className="flex-row flex-wrap items-center gap-x-1.5">
      <Text variant="body-strong">
        <Link href={`/u/${author.handle}`} asChild>
          <Inline className={INLINE_LINK}>{author.displayName}</Inline>
        </Link>
      </Text>
      {author.verified ? <VerifiedChip /> : null}
      <Text variant="mono" tone="low">
        @{author.handle}
      </Text>
      <Text variant="meta" tone="low">
        <Link href={`/post/${postId}`} asChild>
          <Inline {...(open ? dataAttribute("open") : {})} className={cn(INLINE_LINK, "px-1.5")}>
            <Inline aria-hidden>{shown}</Inline>
            <VisuallyHidden>{fill(UI_WORDS["post.open"], { when })}</VisuallyHidden>
          </Inline>
        </Link>
      </Text>
    </View>
  );
}

/** The repost line above a reposted post: the repost icon, and "Ben reposted" with Ben's name a link to his profile. */
function RepostLine({ by }: { by: Author }) {
  const [before, after] = UI_WORDS["post.reposted"].split("{displayName}");
  return (
    <View className="mb-1 flex-row items-center gap-2 pl-6">
      <Icon name="repost" size={16} tone="low" />
      <Text variant="meta" tone="low" className="shrink">
        {before}
        <Link href={`/u/${by.handle}`} asChild>
          <Inline className={cn(INLINE_LINK, "text-ink-medium")}>{by.displayName}</Inline>
        </Link>
        {after}
      </Text>
    </View>
  );
}

/** A quoted post that is gone: its sentence in the text face's italic, on surface-2 (section 8.3). */
function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-media bg-surface-2 px-3 py-2.5">
      <Text tone="medium" italic>
        {tombstone.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
      </Text>
    </View>
  );
}

/** What a press on a card's empty space must leave alone: its links and controls, which act for themselves. */
const CONTROL = "a, button, input, textarea, select, [role=button], [role=link], [role=dialog], [role=switch]";

/**
 * The open target of a card's body for pointers on the web (section 6.6): a click on the card that is not on one of its
 * links or controls, and that does not end a text selection, opens `href`. A click from a menu or sheet the card opened
 * reaches this handler through React's portal, but is not inside the card's own element, so it is left alone.
 */
function opensOnClick(open: () => void) {
  return (event: MouseEvent & { currentTarget: Element; target: Element }) => {
    const root = event.currentTarget;
    if (!root.contains(event.target)) return;
    const control = event.target.closest?.(CONTROL);
    if (control && root.contains(control)) return;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return;
    event.stopPropagation();
    open();
  };
}

/**
 * A quoted post (section 6.6): a bordered region with its own author line, whose time is the link to the quoted post,
 * so the quote has one open target too; its words are plain text, and its images open nothing, since they belong to the
 * quoted post, where the grid and the viewer are. A press on its empty space opens the quoted post.
 */
export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  const open = () => router.push(`/post/${quote.id}`);
  const content = (
    <>
      <AuthorLine author={quote.author} createdAt={quote.createdAt} postId={quote.id} />
      {quote.body ? <Text className="mt-0.5">{quote.body}</Text> : null}
      <MediaGrid media={quote.media} compact postId={quote.id} />
    </>
  );
  if (Platform.OS !== "web") {
    return (
      <Pressable accessible={false} {...pressDelay(80)} onPress={open} className="mt-2 rounded-media border border-line-low px-3 py-2.5 active:bg-surface-2">
        {content}
      </Pressable>
    );
  }
  return (
    <View {...({ onClick: opensOnClick(open) } as object)} className="mt-2 rounded-media border border-line-low px-3 py-2.5 web:cursor-pointer web:hover:bg-surface-2 web:transition-colors web:duration-[120ms]">
      {content}
    </View>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9; UI design, section 4.8). With the decision
 * behind the state it names the rule or says "illegal content", in the review tone while korbat decides and the
 * restricted tone once removed, and links to the decision's statement under Settings, Cases; Task 7 turns the link into
 * the button that opens the details sheet. A view without the decision's facts still says the state, and links nowhere.
 */
function StateChip({ post }: { post: PostView }) {
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const tone: StatusTone = (decision ? decision.interim : post.state === "withheld") ? "review" : "restricted";
  const words = decision ? chipText(decision) : tone === "review" ? CHIP_WORDS.underReview : CHIP_WORDS.removed;
  return <StatusChip tone={tone} label={words} href={decision ? `/settings/cases/${decision.decisionId}` : undefined} />;
}

/**
 * The delete question's two controls, as the card's actions were before the icons: a word in a 44 px target, Delete in
 * the danger fill, Keep plain. While the request is out both are busy.
 */
function Action({ label, tone = "plain", busy, onPress, ref }: { label: string; tone?: "danger" | "plain"; busy?: boolean; onPress: () => void; ref?: Ref<View> }) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      {...pressDelay(0)}
      className={cn(
        "min-h-[44px] items-center justify-center rounded-control border px-4",
        tone === "danger" ? "border-danger bg-danger web:hover:bg-danger/90" : "border-line-high bg-surface-1 web:hover:bg-surface-2",
        FOCUS_RING,
      )}
    >
      <Text variant="body-strong" tone={tone === "danger" ? "on-danger" : "high"}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Delete this post?" in place of the action row (section 6.6), with Delete and Keep. Keep, the safe answer, takes the
 * focus when the question shows; the card gives it back to More when the question is withdrawn.
 */
export function DeleteQuestion({ postId, busy, onDelete, onKeep, keepRef }: { postId: string; busy: boolean; onDelete: () => void; onKeep: () => void; keepRef?: Ref<View> }) {
  return (
    <View role="dialog" aria-labelledby={`delete-${postId}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-card border border-line-high bg-surface-1 px-3 py-2 web:forced-colors:border-[color:CanvasText]">
      <Text nativeID={`delete-${postId}`} variant="body-strong" className="mr-auto">
        {UI_WORDS["post.deleteQuestion"]}
      </Text>
      <Action label={UI_WORDS["post.delete"]} tone="danger" busy={busy} onPress={onDelete} />
      <Action ref={keepRef} label="Keep" busy={busy} onPress={onKeep} />
    </View>
  );
}

/**
 * The Repost menu's items (decision 12): Repost, or Undo repost once reposted, and Quote, a real link to the post's
 * quote composer as today (`?quote=1`), or to sign in for a reader who is signed out.
 */
export function repostMenuItems(post: PostView, signedIn: boolean, onRepost: () => void): MenuItem[] {
  return [
    { label: post.viewer?.reposted ? UI_WORDS["post.unrepost"] : UI_WORDS["post.repost"], icon: "repost", onSelect: onRepost },
    { label: UI_WORDS["post.quote"], icon: "quote", href: signedIn ? `/post/${post.id}?quote=1` : "/signin" },
  ];
}

const NO_VIEWER = { liked: false, reposted: false, bookmarked: false };

/** How long an action's request may be out before its control says it is busy (section 5.2, pending). */
const PENDING_MS = 400;

/**
 * One post in any list (UI design, section 6.6): an article named by its author line, with one explicit link to the post
 * in its time, and for pointers the whole card body as the open target. Reply, Repost (a menu: Repost or Undo repost, and
 * Quote), Like and Save act at once: the state, the icon and the count change on the press, with its haptic and its
 * motion, the request goes out in its kind's lane, and the server's answer replaces the counts, so they never drift; a
 * refusal puts the old state back, nudges the control and says so in a toast, and a write refused for a suspension shows
 * the standing's sentence under the card (3e, 9.4). A signed-out reader is sent to sign in on the first action. More
 * holds Who sees this, Copy link, Delete for the author and Report for everyone else.
 *
 * Below 768 px the images and the quoted post span the card's inner width, from the avatar's edge to the gutter; wider
 * they keep the content column's indent. `large` is the thread's focused post: its words at 19 / 28, the full date and
 * time, and the stats line above the actions (post/[id].tsx passes it in Task 5).
 *
 * In a feed (section 10) the article says its place, `position` from 1 and `setSize` (-1 while more can load); a list's
 * first two rows pass `priority`, so their images load first (11.2); and a thread's ancestors are `joined`: compact,
 * without a divider, and linked to the post below by a 2 px line-low thread line through their avatars (8.3).
 */
export function PostCard({
  post: initial,
  repostedBy,
  onDeleted,
  large = false,
  position,
  setSize,
  priority = false,
  joined = false,
}: {
  post: PostView;
  repostedBy?: Author;
  onDeleted?: (id: string) => void;
  large?: boolean;
  position?: number;
  setSize?: number;
  priority?: boolean;
  joined?: boolean;
}) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const { hideCounts } = useAppearance();
  const phone = useLayout() === "phone";
  const motion = useMotion();
  const haptic = useHaptics();
  const labelId = useId();
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // 3e (design, section 9.4): an action refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<ToggleKind | "delete", boolean>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<ToggleKind, IconButtonFeedback>>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [washed, setWashed] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const moreRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The action row, More with it, leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and More takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) moreRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  const own = post.author.id === me;
  const viewer = post.viewer ?? NO_VIEWER;
  const openPost = () => router.push(`/post/${post.id}`);

  /** Marks a kind busy if its request is still out after 400 ms, and returns the function that ends it. */
  const pending = (kind: ToggleKind | "delete") => {
    const timer = setTimeout(() => setBusy((current) => ({ ...current, [kind]: true })), PENDING_MS);
    return () => {
      clearTimeout(timer);
      setBusy((current) => ({ ...current, [kind]: false }));
    };
  };
  const play = (kind: ToggleKind, next: Omit<IconButtonFeedback, "at">) => setFeedback((current) => ({ ...current, [kind]: { ...next, at: (current[kind]?.at ?? 0) + 1 } }));

  function toggle(kind: ToggleKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    // A second tap while this kind's request is out is not sent (lib/social.ts, lanes), and changes nothing on screen.
    if (lanes.busy(laneKey.post(post.id, kind))) return;
    const moves = kind !== "bookmark";
    const done = pending(kind);
    void toggleEngagement(social, lanes, post, kind, setPost, (on) => {
      // Touch and sight on the same frame: the haptic before the state changes, the motion with it.
      haptic(on ? "toggleOn" : "toggleOff");
      play(kind, { turn: on ? "on" : "off", pop: kind === "like" ? "springLike" : "springToggle", count: moves ? (on ? 1 : -1) : 0 });
    }).then((result) => {
      done();
      if (result.status === "busy") return;
      if (result.status === "answered") {
        setRefused(false);
        // Saved: a polite toast says it worked, with the way to the saved posts; unsaving says nothing.
        if (kind === "bookmark" && result.on) toast.show({ message: UI_WORDS["toast.saved"], action: { label: UI_WORDS["toast.view"], onPress: () => router.push("/bookmarks") } });
        return;
      }
      const err = result.error;
      haptic("error");
      play(kind, { turn: "back", count: moves ? (result.on ? -1 : 1) : 0 });
      // A suspension is said under the card in the standing's words; trying again would not help, so no toast says to.
      if (isSuspendedRefusal(err)) setRefused(true);
      else toast.show({ message: failedWords(kind, result.on), tone: "rollback" });
    });
  }

  // The card fades (post-removed, 150 ms; at once under reduced motion) before its list lets it go.
  const opacity = useSharedValue(1);
  const leave = () =>
    new Promise<void>((resolve) => {
      if (motion.reduced) {
        resolve();
        return;
      }
      opacity.value = withTiming(0, motion.timing("easeOut", 150), (finished) => {
        "worklet";
        if (finished) runOnJS(resolve)();
      });
    });
  const removedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  function remove() {
    const done = pending("delete");
    void deleteWithLeave(social, lanes, post.id, leave).then((result) => {
      done();
      if (result.status === "deleted") {
        onDeleted?.(post.id);
        return;
      }
      if (result.status === "refused") {
        const err = result.error;
        setRefused(isSuspendedRefusal(err));
        setError(isSuspendedRefusal(err) ? null : errorMessage(err));
      }
    });
  }

  // The press wash of the card's body (section 5.1): after 80 ms, gone again on 10 px of movement, so a scroll never flashes it.
  const wash = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const unwash = () => {
    if (wash.current) clearTimeout(wash.current.timer);
    wash.current = null;
    setWashed(false);
  };
  const webPress =
    Platform.OS === "web"
      ? {
          onClick: opensOnClick(openPost),
          onPointerDown: (event: PointerEvent & { target: Element; currentTarget: Element }) => {
            const control = event.target.closest?.(CONTROL);
            if (control && event.currentTarget.contains(control)) return;
            unwash();
            wash.current = { timer: setTimeout(() => setWashed(true), 80), x: event.clientX, y: event.clientY };
          },
          onPointerMove: (event: PointerEvent) => {
            if (wash.current && Math.hypot(event.clientX - wash.current.x, event.clientY - wash.current.y) > 10) unwash();
          },
          onPointerUp: unwash,
          onPointerCancel: unwash,
          onPointerLeave: unwash,
        }
      : {};

  const media = <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />;
  const quote = post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null;
  const stats = large ? threadStats(post.counts, hideCounts) : "";
  const when = postedWhen(post.createdAt);

  const actions = (
    // It wraps rather than cutting More off at the largest text on the narrowest phone.
    <View className="-ml-2.5 mt-1 flex-row flex-wrap items-center">
      <IconButton icon="reply" label={countLabel("reply", post.counts.replies, hideCounts)} count={shownCount("reply", post.counts.replies, hideCounts)} onPress={openPost} />
      <Menu
        label={countLabel("repost", post.counts.reposts, hideCounts)}
        title={UI_WORDS["post.repost"]}
        icon="repost"
        items={repostMenuItems(post, me !== null, () => toggle("repost"))}
        trigger={{ pressed: viewer.reposted, disc: viewer.reposted, tone: viewer.reposted ? "accent" : "low", count: shownCount("repost", post.counts.reposts, hideCounts), busy: busy.repost === true, feedback: feedback.repost }}
      />
      <IconButton
        icon="like"
        label={countLabel("like", post.counts.likes, hideCounts)}
        count={shownCount("like", post.counts.likes, hideCounts)}
        pressed={viewer.liked}
        filled={viewer.liked}
        busy={busy.like === true}
        feedback={feedback.like}
        onPress={() => toggle("like")}
      />
      <IconButton
        icon="bookmarks"
        label={viewer.bookmarked ? UI_WORDS["post.saved"] : UI_WORDS["post.save"]}
        tone={viewer.bookmarked ? "accent" : "low"}
        filled={viewer.bookmarked}
        busy={busy.bookmark === true}
        feedback={feedback.bookmark}
        onPress={() => toggle("bookmark")}
      />
      <View className="flex-1" />
      <PostMenu post={post} onDelete={() => setConfirmingDelete(true)} triggerRef={moreRef} />
    </View>
  );

  const content: ReactNode = (
    <>
      {repostedBy ? <RepostLine by={repostedBy} /> : null}
      <View className="flex-row gap-2">
        {/* The avatar opens the profile too, but the name is the one keyboard and screen-reader target. */}
        <Link href={`/u/${post.author.handle}`} asChild>
          <Pressable tabIndex={-1} aria-hidden className="h-11 w-11 items-center justify-center rounded-full">
            <Avatar account={post.author} size={40} />
          </Pressable>
        </Link>
        <View className="min-w-0 flex-1">
          <AuthorLine author={post.author} createdAt={post.createdAt} postId={post.id} large={large} open />
          {own && (post.state !== "visible" || post.inExplore) ? (
            <View className="flex-row flex-wrap gap-x-2">
              <StateChip post={post} />
              {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
              {post.inExplore ? <StatusChip tone="explore" label={UI_WORDS["post.inExplore"]} href={`/post/${post.id}`} /> : null}
            </View>
          ) : null}
          {post.replyTo ? (
            <Text variant="meta" tone="low">
              {post.replyTo.authorHandle ? UI_WORDS["post.replyingTo"] : UI_WORDS["post.replyingHidden"]}
              {post.replyTo.authorHandle ? (
                <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
                  <Inline className={cn(INLINE_LINK, "text-accent-ink")}>@{post.replyTo.authorHandle}</Inline>
                </Link>
              ) : null}
            </Text>
          ) : null}
          {/* A post may consist of images only, and then there is no text. */}
          {post.body ? (
            <View className="mt-1.5">
              <RichText body={post.body} variant={large ? "post-large" : "post"} />
            </View>
          ) : null}
          {phone ? null : media}
          {phone ? null : quote}
        </View>
      </View>
      {phone ? media : null}
      {phone ? quote : null}
      {/* The stats, the actions and what they answer keep the content column's indent at every width. */}
      <View className="pl-[52px]">
        {stats ? (
          <Text variant="meta" tone="medium" className="mt-3">
            {stats}
          </Text>
        ) : null}
        {confirmingDelete ? (
          <DeleteQuestion postId={post.id} busy={busy.delete === true} onDelete={remove} onKeep={() => setConfirmingDelete(false)} keepRef={keepRef} />
        ) : (
          actions
        )}
        <ErrorText message={error} />
        {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
      </View>
    </>
  );

  return (
    <Animated.View style={removedStyle}>
      <View
        role="article"
        aria-labelledby={labelId}
        aria-posinset={position}
        aria-setsize={position === undefined ? undefined : setSize}
        {...(webPress as object)}
        // A thread's focused post draws no divider of its own: the thread's block under it does, after Quote this post.
        className={cn(joined ? "px-4 pb-1 pt-3" : large ? "px-4 py-3" : "border-b border-line-low px-4 py-3", "web:transition-colors web:duration-[120ms]", washed ? "bg-surface-2" : "")}
      >
        {/* The thread line, from under the avatar to the next post's avatar: 2 px, line-low, through the avatars' centre. */}
        {joined ? <View pointerEvents="none" aria-hidden className="absolute bottom-0 left-[37px] top-[60px] w-0.5 bg-line-low" /> : null}
        {/* The article's name, the author line as a screen reader should hear it; hidden, and named only through aria-labelledby. */}
        <Text nativeID={labelId} aria-hidden style={VISUALLY_HIDDEN}>
          {fill(UI_WORDS["post.label"], { name: post.author.displayName, handle: post.author.handle, when })}
        </Text>
        {/* The first rows of a list load their images first (11.2): the grid reads it, through the quote's too. */}
        <ImagePriority.Provider value={priority}>
          {Platform.OS === "web" ? (
            content
          ) : (
            // On native the body is one Pressable that the accessibility tree does not see: the time's link does its job there.
            <Pressable accessible={false} {...pressDelay(80)} onPress={openPost} className="-mx-4 -my-3 px-4 py-3 active:bg-surface-2">
              {content}
            </Pressable>
          )}
        </ImagePriority.Provider>
      </View>
    </Animated.View>
  );
}
