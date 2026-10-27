import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { ExploreStatusKind, MeResponse, PostView } from "@korbat/contracts";
import { FOCUS_RING, dataAttribute } from "@/components/kit/interaction";
import { Sheet } from "@/components/kit/Sheet";
import { Text } from "@/components/kit/Text";
import { reach } from "@/lib/reach";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";

/**
 * Who sees this (UI design, section 6.14): the sheet a post's More menu opens, for every post, with reach()'s sentences
 * and their links. The first sentence says who can read the post, in ink-high; the rest say how, in ink-medium.
 */
export function WhoSeesThisBody({ post, me, explore }: { post: PostView; me: MeResponse | null; explore: ExploreStatusKind | null }) {
  const found = reach(post, me, explore);
  return (
    <View className="gap-3 px-5 pb-3">
      {found.lines.map((line, index) => (
        <View key={line.text} className="gap-0.5">
          {/* 3b: an imported post's provenance paragraph is where the label's press opens the sheet; it can take the focus. */}
          {line.mark === "provenance" ? (
            <Text {...dataAttribute("sheet-focus")} {...({ tabIndex: -1 } as object)} tone="medium" className={cn("rounded-sm", FOCUS_RING)}>
              {line.text}
            </Text>
          ) : (
            <Text tone={index === 0 ? "high" : "medium"}>{line.text}</Text>
          )}
          {line.link ? (
            <Link href={line.link.href} asChild>
              <Pressable className={cn("min-h-[44px] justify-center self-start rounded-control", FOCUS_RING)}>
                <Text tone="accent" className="underline decoration-1 underline-offset-2">
                  {line.link.label}
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The sheet itself. For the reader's own visible top-level post, when neither the post nor /me already decides its
 * Explore line, it asks GET /api/posts/:id/explore each time it opens and words the answer as the status line under the
 * post does (2c design, section 8). The answer stays in this component's state, as 2c's rule wants every answer about
 * Explore kept: never stored, never cached.
 */
export function WhoSeesThis({ post, open, onClose, onClosed, at }: { post: PostView; open: boolean; onClose: () => void; onClosed?: () => void; at?: "provenance" }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const asks = reach(post, me).asksExplore;
  const [answer, setAnswer] = useState<{ id: string; status: ExploreStatusKind | null } | null>(null);

  useEffect(() => {
    if (!open || !asks) return;
    let current = true;
    social.exploreStatus(post.id).then(
      (found) => {
        if (current) setAnswer({ id: post.id, status: found.status });
      },
      // Unanswered, the sheet leaves the Explore line out rather than guess it.
      () => {
        if (current) setAnswer({ id: post.id, status: null });
      },
    );
    return () => {
      current = false;
    };
  }, [open, asks, post.id]);

  return (
    // 3b Task 7: opened from an imported post's label (`at`), the focus goes to the provenance paragraph (10.6).
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title={UI_WORDS["post.whoSees"]} initialFocus={at === "provenance" ? "marked" : "title"}>
      <WhoSeesThisBody post={post} me={me} explore={answer?.id === post.id ? answer.status : null} />
    </Sheet>
  );
}
