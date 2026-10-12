import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import { isHiddenMedia, type MediaView, type PostView } from "@korbat/contracts";
import { social } from "@/lib/social";

/**
 * What a link says for a post: its text up to 100 characters, or, for a post of images only, the description of the
 * first image this reader is shown. An image moderation hid has no description and is skipped; a post of hidden images
 * alone is listed by its author's name only.
 */
function snippet(post: PostView): string {
  const text = post.body.replace(/\s+/g, " ").trim();
  if (!text) {
    const shown = post.media.find((item): item is MediaView => !isHiddenMedia(item));
    return shown ? `Image: ${shown.alt}` : "";
  }
  const characters = Array.from(text);
  return characters.length > 100 ? `${characters.slice(0, 100).join("")}...` : text;
}

/** Popular now's posts, each a link to its thread, then a link to the rest of Explore. */
export function PopularPosts({ posts }: { posts: PostView[] }) {
  return (
    <View className="mb-8">
      <Text accessibilityRole="header" aria-level={2} className="text-sm font-medium text-zinc-300">
        Popular now
      </Text>
      {posts.map((post) => (
        <Link key={post.id} href={`/post/${post.id}`} asChild>
          <Pressable className="mt-3">
            <Text className="text-sm font-semibold text-zinc-50" numberOfLines={1}>
              {post.author.displayName}
            </Text>
            <Text className="mt-0.5 text-sm leading-5 text-zinc-300" numberOfLines={2}>
              {snippet(post)}
            </Text>
          </Pressable>
        </Link>
      ))}
      <Link href="/?tab=explore" asChild>
        <Pressable className="mt-3">
          <Text className="text-sm text-zinc-400 underline">More in Explore</Text>
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * The context column's Popular now (2c design, section 11): the first three posts of Explore, above the handle box. It
 * asks on every mount and keeps the answer in its own state only, and shows nothing while Explore is empty or cannot be
 * reached: the column is extra, and the Explore tab says why a list is empty.
 */
export function PopularNow() {
  const [posts, setPosts] = useState<PostView[]>([]);
  useEffect(() => {
    let cancelled = false;
    social
      .popular()
      .then((page) => {
        if (!cancelled) setPosts(page.items.slice(0, 3).map((item) => item.post));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return posts.length > 0 ? <PopularPosts posts={posts} /> : null;
}
