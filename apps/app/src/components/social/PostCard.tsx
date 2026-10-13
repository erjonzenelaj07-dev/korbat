import { useEffect, useRef, useState, type Ref } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import type { Author, PostView, QuotedPost, Tombstone } from "@korbat/contracts";
import { VerifiedChip } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { chipText, reportHref } from "@/lib/moderation";
import { CHIP_WORDS, REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { isSuspendedRefusal } from "@/lib/standing";
import { RefusedNotice } from "@/components/moderation/RefusedNotice";
import { social, timeAgo, type EngagementKind } from "@/lib/social";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

function AuthorLine({ author, createdAt }: { author: Author; createdAt: string }) {
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-2">
      <Link href={`/u/${author.handle}`} asChild>
        <Pressable>
          <Text className="text-base font-semibold text-zinc-50">{author.displayName}</Text>
        </Pressable>
      </Link>
      {author.verified ? <VerifiedChip /> : null}
      <Text className="text-sm text-zinc-400">
        @{author.handle} · {timeAgo(createdAt)}
      </Text>
    </View>
  );
}

function TombstoneBox({ tombstone }: { tombstone: Tombstone }) {
  return (
    <View className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
      <Text className="text-sm italic text-zinc-400">{tombstone.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
    </View>
  );
}

export function QuoteEmbed({ quote }: { quote: QuotedPost | Tombstone }) {
  if (!("author" in quote)) return <TombstoneBox tombstone={quote} />;
  return (
    <Link href={`/post/${quote.id}`} asChild>
      <Pressable className="mt-2 rounded-lg border border-zinc-800 px-3 py-2">
        <AuthorLine author={quote.author} createdAt={quote.createdAt} />
        {quote.body ? <RichText body={quote.body} className="mt-1 text-sm leading-5 text-zinc-300" /> : null}
        <MediaGrid media={quote.media} compact postId={quote.id} />
      </Pressable>
    </Link>
  );
}

/**
 * The chip on the author's own withheld or removed post (3c design, section 9). With the decision behind the state it
 * names the rule or says "illegal content", amber while korbat decides and red once removed, and links to the decision's
 * statement under Settings, Cases. A view without the decision's facts still says the state, and links nowhere.
 */
function StateChip({ post }: { post: PostView }) {
  if (post.state === "visible") return null;
  const decision = post.moderation;
  const amber = decision ? decision.interim : post.state === "withheld";
  const surface = `self-start rounded-full px-2 py-0.5 ${amber ? "bg-amber-500/15" : "bg-red-500/15"}`;
  const words = <Text className={`text-xs font-medium ${amber ? "text-amber-300" : "text-red-300"}`}>{decision ? chipText(decision) : amber ? CHIP_WORDS.underReview : CHIP_WORDS.removed}</Text>;
  if (!decision) return <View className={surface}>{words}</View>;
  return (
    <Link href={`/settings/cases/${decision.decisionId}`} asChild>
      <Pressable className={surface}>{words}</Pressable>
    </Link>
  );
}

/**
 * The author's own post while it is in the current Explore ranking (2c design, section 8): a link to the post, whose
 * status line under it says more and leads to the switch.
 */
function ExploreChip({ id }: { id: string }) {
  return (
    <Link href={`/post/${id}`} asChild>
      <Pressable className="self-start rounded-full bg-emerald-500/15 px-2 py-0.5">
        <Text className="text-xs font-medium text-emerald-300">In Explore</Text>
      </Pressable>
    </Link>
  );
}

/**
 * `active` colours the action. `pressed` tells a screen reader that a toggle is on, and is for
 * toggles whose label stays the same (Like, Repost); Save changes its label instead, which
 * already says so. While one action's request is in flight, every action waits.
 */
function Action({
  label,
  count,
  active,
  pressed,
  busy,
  activeClass,
  onPress,
  ref,
}: {
  label: string;
  count?: number;
  active?: boolean;
  pressed?: boolean;
  busy?: boolean;
  activeClass?: string;
  onPress: () => void;
  ref?: Ref<View>;
}) {
  return (
    <Pressable ref={ref} accessibilityRole="button" aria-pressed={pressed} aria-busy={busy} disabled={busy} onPress={onPress} className="flex-row items-center gap-1 py-1 pr-4">
      <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{label}</Text>
      {count !== undefined && count > 0 ? <Text className={`text-sm ${active ? activeClass : "text-zinc-400"}`}>{count}</Text> : null}
    </Pressable>
  );
}

/**
 * One post in any list. Actions update the card from the server's answer, so counts never drift
 * from the truth. A signed-out reader is sent to sign in on the first action.
 */
export function PostCard({ post: initial, repostedBy, onDeleted }: { post: PostView; repostedBy?: Author; onDeleted?: (id: string) => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me.user.id : null;
  const [post, setPost] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // 3e (design, section 9.4): an action refused account_suspended shows the refusal's sentence from /me, read again after it.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setPost(initial), [initial]);
  const deleteRef = useRef<View>(null);
  const keepRef = useRef<View>(null);
  const wasConfirming = useRef(false);
  // The Delete control leaves the tree while the question shows, so a keyboard user would drop to the page
  // body: the safe answer takes the focus, and Delete takes it back when the question is withdrawn.
  useEffect(() => {
    if (confirmingDelete) keepRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirmingDelete;
  }, [confirmingDelete]);

  /** Runs one request at a time: a second tap while one is in flight does nothing, so a double tap cannot undo itself. */
  async function request(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setError(null);
      setRefused(false);
    } catch (err) {
      setRefused(isSuspendedRefusal(err));
      setError(isSuspendedRefusal(err) ? null : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(kind: EngagementKind) {
    if (!me) {
      router.push("/signin");
      return;
    }
    const current = post.viewer ?? { liked: false, reposted: false, bookmarked: false };
    const on = kind === "like" ? !current.liked : kind === "repost" ? !current.reposted : !current.bookmarked;
    void request(async () => {
      const result = await social.engage(post.id, kind, on);
      setPost((current) => ({ ...current, counts: result.counts, viewer: result.viewer }));
    });
  }

  function remove() {
    void request(async () => {
      await social.deletePost(post.id);
      setConfirmingDelete(false);
      onDeleted?.(post.id);
    });
  }

  return (
    <View className="border-b border-zinc-800 px-4 py-3">
      {repostedBy ? <Text className="mb-1 text-xs text-zinc-400">↻ {repostedBy.displayName} reposted</Text> : null}
      <AuthorLine author={post.author} createdAt={post.createdAt} />
      {post.author.id === me ? <StateChip post={post} /> : null}
      {/* The API sets inExplore only on the viewer's own posts; the check keeps the chip on them whatever a view carries. */}
      {post.author.id === me && post.inExplore ? <ExploreChip id={post.id} /> : null}
      {post.replyTo ? (
        <Text className="text-xs text-zinc-400">
          {post.replyTo.authorHandle ? "Replying to " : "Replying to a post you can't see"}
          {post.replyTo.authorHandle ? (
            <Link href={`/u/${post.replyTo.authorHandle}`} asChild>
              <Text className="text-sky-400">@{post.replyTo.authorHandle}</Text>
            </Link>
          ) : null}
        </Text>
      ) : null}
      {/* A post may consist of images only, and then there is no text to link. */}
      {post.body ? (
        <Link href={`/post/${post.id}`} asChild>
          <Pressable className="mt-1">
            <RichText body={post.body} />
          </Pressable>
        </Link>
      ) : null}
      <MediaGrid media={post.media} postId={post.id} own={post.author.id === me} />
      {post.quoteOf ? <QuoteEmbed quote={post.quoteOf} /> : null}
      <View className="mt-2 flex-row flex-wrap items-center">
        <Action label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <Action label="Repost" count={post.counts.reposts} active={post.viewer?.reposted} pressed={post.viewer?.reposted} busy={busy} activeClass="text-emerald-400" onPress={() => toggle("repost")} />
        <Action label="Quote" count={post.counts.quotes} onPress={() => (me ? router.push(`/post/${post.id}?quote=1`) : router.push("/signin"))} />
        <Action label="Like" count={post.counts.likes} active={post.viewer?.liked} pressed={post.viewer?.liked} busy={busy} activeClass="text-rose-400" onPress={() => toggle("like")} />
        <Action label={post.viewer?.bookmarked ? "Saved" : "Save"} active={post.viewer?.bookmarked} busy={busy} activeClass="text-sky-400" onPress={() => toggle("bookmark")} />
        {post.author.id === me && !confirmingDelete ? <Action ref={deleteRef} label="Delete" busy={busy} onPress={() => setConfirmingDelete(true)} /> : null}
        {/* Anyone but the author may report the post, signed in or out; the form is a page of its own, so this is a link. */}
        {post.author.id !== me ? (
          <Link href={reportHref({ post: post.id })} asChild>
            <Pressable className="flex-row items-center gap-1 py-1 pr-4">
              <Text className="text-sm text-zinc-400">{REPORT_WORDS.control}</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
      {confirmingDelete ? (
        <View role="dialog" aria-labelledby={`delete-${post.id}`} className="mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
          <Text nativeID={`delete-${post.id}`} className="text-sm text-zinc-200">
            Delete this post?
          </Text>
          <Action label="Delete" busy={busy} activeClass="text-red-400" active onPress={remove} />
          <Action ref={keepRef} label="Keep" busy={busy} onPress={() => setConfirmingDelete(false)} />
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-1 text-xs text-red-400">
          {error}
        </Text>
      ) : null}
      {refused ? <RefusedNotice standing={state.status === "signed-in" ? state.me.standing : null} /> : null}
    </View>
  );
}
