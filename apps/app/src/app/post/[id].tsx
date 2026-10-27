import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Skeleton } from "@/components/kit/Skeleton";
import { Text } from "@/components/kit/Text";
import type { ListHandle } from "@/components/list/List";
import { HeaderSpace, ScreenHeader } from "@/components/ScreenHeader";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { ComposerCard, type ComposerCardHandle } from "@/components/social/composer/ComposerCard";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Button, TextLink } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { EXPLORE_WORDS, exploreStatusText } from "@/lib/explore";
import { IMPORT_WORDS } from "@/lib/import-words";
import { insertPosted } from "@/lib/feed-cache";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/** A link of the status line: a 44 px target, as TextLink draws one. */
const LINE_LINK = cn("min-h-[44px] justify-center rounded-control active:opacity-70", FOCUS_RING);

/**
 * A post above the focused one, in the chain it replies to (UI design, section 8.3): a compact card joined to the next
 * by the 2 px thread line through the avatars; a post that is gone keeps its sentence, in the italic text face on a
 * surface-2 block, on the same line.
 */
function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="px-4 pb-1 pt-3">
        <View className="rounded-media bg-surface-2 px-3 py-2.5">
          <Text tone="medium" italic>
            {item.deleted ? UI_WORDS["post.deleted"] : UI_WORDS["post.unavailable"]}
          </Text>
        </View>
      </View>
    );
  }
  return <PostCard post={item} joined />;
}

/**
 * 3b Task 7 (design, section 10.6): the author's line under their own imported post, which no Explore status needs to be
 * asked for: imported posts enter no feed on their own. It keeps the line's way to how Explore works.
 */
function ImportedExploreLine() {
  return (
    <View className="px-4 pb-2">
      <Text variant="meta" tone="medium">
        {IMPORT_WORDS["import.explore"]}
      </Text>
      <Link href="/explore/about" asChild>
        <Pressable className={cn(LINE_LINK, "self-start")}>
          <Text tone="accent" className="underline web:underline-offset-2">
            {EXPLORE_WORDS.about}
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The author's line under their own post (2c design, section 11): whether it is in Explore and, if not, which rule keeps
 * it out, in the formula's words and without any count, with the way to the rules and to the switch. Until the answer
 * comes, and if it fails, there is no line: the post is the screen, and the line only explains. It is asked again every
 * time the screen gains focus: the web keeps this screen mounted under the ones it links to, and Back shows it again as
 * it was, so after the switch is turned through the line's own link the line would otherwise still give the old reason.
 */
function ExploreStatusLine({ id }: { id: string }) {
  // The line with the post it was read for: the same post's line stays while it is asked again, and another post's never shows.
  const [line, setLine] = useState<{ id: string; text: string | null } | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      social
        .exploreStatus(id)
        .then((answer) => {
          if (!cancelled) setLine({ id, text: exploreStatusText(answer.status) });
        })
        .catch(() => {
          if (!cancelled) setLine(null);
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const text = line?.id === id ? line.text : null;
  if (!text) return null;
  return (
    <View className="px-4 pb-2">
      <Text variant="meta" tone="medium">
        {text}
      </Text>
      <View className="flex-row flex-wrap gap-x-4">
        <Link href="/explore/about" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {EXPLORE_WORDS.about}
            </Text>
          </Pressable>
        </Link>
        <Link href="/settings/privacy" asChild>
          <Pressable className={LINE_LINK}>
            <Text tone="accent" className="underline web:underline-offset-2">
              {UI_WORDS["thread.exploreSetting"]}
            </Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

/**
 * A post with the chain it replies to above it and its direct replies below, oldest first. Under the focused post, the
 * reply card (Task 6) at every width: "Write your reply", opening in place on focus; `?reply=1`, which a card's Reply
 * gives, opens it at once with the focus in it, and the focused post's own Reply opens it too. A reply sent reads the
 * replies again (and the composer's toast says it was sent). `?quote=1` opens the quote sheet, whose post goes on top of
 * Home's feeds; its toast's View opens it, where today's code went to it at once.
 */
export default function Thread() {
  const { id, quote, reply } = useLocalSearchParams<{ id: string; quote?: string; reply?: string }>();
  const { state } = useSession();
  const viewer = state.status === "signed-in" && state.me.user.onboarded ? state.me.user.id : null;
  const signedIn = viewer !== null;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");
  const replyCard = useRef<ComposerCardHandle>(null);
  const title = usePageTitle("title.post");
  const missingTitle = usePageTitle("title.postMissing");

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setError(null);
    // The id comes from the address bar; anything but a post id is refused before a request is built from it.
    if (!PostId.safeParse(id).success) {
      setError("That address is not a post.");
      return;
    }
    social
      .thread(id)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The screen stays mounted under the ones it links to, and Back shows it again as it was: on every focus after the
  // first, the post is read again into the thread on screen, without clearing it, so its card (the In Explore chip
  // included) follows a change made there. An id's first focus comes with the read above.
  const focusedFor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (focusedFor.current !== id) {
        focusedFor.current = id;
        return undefined;
      }
      // An address that is not a post has its error on screen already, and no request may be built from it.
      if (!PostId.safeParse(id).success) return undefined;
      let cancelled = false;
      social
        .getPost(id)
        .then((post) => {
          if (!cancelled) setThread((current) => (current && current.post.id === post.id ? { ...current, post } : current));
        })
        // What is on screen stays: the next focus asks again.
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  // A new `version` (a reply sent here) is a new source, which the list reads again from its first page; the list and its
  // header, where the reply card holds the focus, stay mounted.
  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id, version]);

  // The page opens with the focused post at the top of the view and its ancestors above it, kept there by the list's
  // anchor while they and the replies are drawn (section 7.5); a reply written here reads the replies again, not the post.
  const list = useRef<ListHandle>(null);
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!thread || opened.current === thread.post.id || thread.ancestors.length === 0) return;
    opened.current = thread.post.id;
    list.current?.hold("focused");
  }, [thread]);

  if (error) {
    return (
      <AppShell>
        {missingTitle}
        <ScreenHeader title={UI_WORDS["thread.missing"]} back="/" />
        <HeaderSpace />
        <View className="items-start gap-2 px-4 py-6">
          <Text tone="medium">{error}</Text>
          <TextLink label={UI_WORDS["thread.back"]} href="/" replace />
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        {title}
        <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
        <HeaderSpace />
        <Skeleton.List kind="posts" count={1} />
      </AppShell>
    );
  }

  const mine = viewer !== null && thread.post.author.id === viewer;
  const header = (
    <View>
      <View {...dataAttribute("thread")}>
        {thread.ancestors.map((item) => (
          <AncestorRow key={item.id} item={item} />
        ))}
        {/* The focused post, which the list holds at the top when the page opens. */}
        <View {...dataAttribute("row", "focused")} className="border-b border-line-low">
          <PostCard post={thread.post} large onDeleted={() => router.replace("/")} onReply={signedIn ? () => replyCard.current?.open() : undefined} />
          {/* Replies and quotes never enter Explore, so they get no line and no request. */}
          {mine && thread.post.replyTo === null && thread.post.quoteOf === null && thread.post.imported === null ? <ExploreStatusLine id={thread.post.id} /> : null}
          {/* 3b (10.6): the author's own imported post is never in Explore, which is known without asking /explore. */}
          {mine && thread.post.imported !== null ? <ImportedExploreLine /> : null}
          {signedIn ? (
            <View className="flex-row justify-end px-4 pb-3">
              <View className="-mt-6">
                <Button label={UI_WORDS["thread.quote"]} tone="secondary" full={false} onPress={() => setQuoting(true)} />
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {signedIn ? (
        <View className="border-b border-line-low px-4 py-3">
          <ComposerCard
            key={thread.post.id}
            handle={replyCard}
            replyTo={thread.post}
            startOpen={reply === "1"}
            onPosted={() => {
              // The replies are read again; the focused post counts the new one at once, without reading the thread.
              setThread((current) => (current ? { ...current, post: { ...current.post, counts: { ...current.post.counts, replies: current.post.counts.replies + 1 } } } : current));
              setVersion((v) => v + 1);
            }}
          />
        </View>
      ) : (
        <View className="border-b border-line-low px-4 py-1">
          <TextLink label={UI_WORDS["thread.signIn"]} href="/signin" />
        </View>
      )}
    </View>
  );

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["thread.title"]} back="/" />
      <PostList handle={list} fetchPage={fetchReplies} empty={UI_WORDS["thread.empty"]} header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => insertPosted(viewer, post)} />
    </AppShell>
  );
}
