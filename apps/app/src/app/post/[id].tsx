import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";
import { PostId, type PostView, type ThreadResponse, type Tombstone } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { PostList } from "@/components/social/PagedList";
import { PostCard } from "@/components/social/PostCard";
import { Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

function AncestorRow({ item }: { item: PostView | Tombstone }) {
  if (!("author" in item)) {
    return (
      <View className="border-b border-zinc-800 px-4 py-3">
        <Text className="text-sm italic text-zinc-400">{item.deleted ? "This post was deleted by its author." : "This post is unavailable."}</Text>
      </View>
    );
  }
  return <PostCard post={item} />;
}

/** A post with the chain it replies to above it and its direct replies below, oldest first. */
export default function Thread() {
  const { id, quote } = useLocalSearchParams<{ id: string; quote?: string }>();
  const { state } = useSession();
  const signedIn = state.status === "signed-in" && state.me.user.onboarded;
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [quoting, setQuoting] = useState(quote === "1");

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
  }, [id, version]);

  const fetchReplies = useCallback((cursor?: string) => social.thread(id, cursor).then((t) => t.replies), [id]);

  if (error) {
    return (
      <AppShell>
        <View className="px-4 py-10">
          <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
            This post is not available
          </Text>
          <Text className="mt-2 text-base text-zinc-400">{error}</Text>
          <Link href="/" replace asChild>
            <Pressable className="mt-6">
              <Text className="text-sm text-zinc-400 underline">Back to the timeline</Text>
            </Pressable>
          </Link>
        </View>
      </AppShell>
    );
  }
  if (!thread) {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  const header = (
    <View>
      {thread.ancestors.map((item) => (
        <AncestorRow key={item.id} item={item} />
      ))}
      <View className="border-b-2 border-zinc-700">
        <PostCard post={thread.post} onDeleted={() => router.replace("/")} />
        {signedIn ? (
          <View className="flex-row justify-end px-4 pb-2">
            <Pressable accessibilityRole="button" onPress={() => setQuoting(true)}>
              <Text className="text-sm text-zinc-400 underline">Quote this post</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {signedIn ? <Composer replyTo={thread.post} onPosted={() => setVersion((v) => v + 1)} /> : null}
    </View>
  );

  return (
    <AppShell>
      <PostList key={version} fetchPage={fetchReplies} empty="No replies yet." header={header} />
      <ComposeSheet open={quoting} quoteOf={thread.post} onClose={() => setQuoting(false)} onPosted={(post) => router.push(`/post/${post.id}`)} />
    </AppShell>
  );
}
