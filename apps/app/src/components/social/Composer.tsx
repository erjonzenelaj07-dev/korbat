import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { POST_MAX_LENGTH, normalizePostBody, postLength, type PostView } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { social } from "@/lib/social";
import { QuoteEmbed } from "./PostCard";

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * One composer for posts, replies and quotes. The counter uses the same normalization the server
 * applies, so what it allows is exactly what the API accepts.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = postLength(normalizePostBody(text));
  const ready = length >= 1 && length <= POST_MAX_LENGTH && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost({ body: text, ...(replyTo ? { replyToId: replyTo.id } : {}), ...(quoteOf ? { quoteOfId: quoteOf.id } : {}) });
      setText("");
      onPosted?.(post);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="px-4 py-3">
      {replyTo ? <Text className="mb-2 text-xs text-zinc-500">Replying to @{replyTo.author.handle}</Text> : null}
      <TextInput
        accessibilityLabel={replyTo ? "Your reply" : quoteOf ? "Your comment on the quoted post" : "What's on your mind?"}
        placeholder={replyTo ? "Write your reply" : quoteOf ? "Add your comment" : "What's on your mind?"}
        placeholderTextColor="#71717a"
        multiline
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        className="min-h-[88px] rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base leading-6 text-zinc-50"
      />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} /> : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center justify-end gap-3">
        <Text className={`text-xs ${length > POST_MAX_LENGTH ? "text-red-400" : "text-zinc-500"}`}>
          {length}/{POST_MAX_LENGTH}
        </Text>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={() => void submit()} className={`rounded-lg px-4 py-2 ${ready ? "bg-zinc-50" : "bg-zinc-800"}`}>
          <Text className={`text-sm font-semibold ${ready ? "text-zinc-950" : "text-zinc-500"}`}>{busy ? "Posting…" : replyTo ? "Reply" : quoteOf ? "Quote" : "Post"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
