import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MEDIA_MAX_PER_POST, POST_MAX_LENGTH, normalizePostBody, postLength, type PostView } from "@korbat/contracts";
import { errorMessage } from "@/lib/api";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { social } from "@/lib/social";
import { ComposerImages } from "./ComposerImages";
import { QuoteEmbed } from "./PostCard";
import { describeState, useImageUploads } from "./useImageUploads";

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Told whenever the draft gains or loses content, so a sheet can ask before discarding it. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * One composer for posts, replies and quotes, with up to four images. The counters use the same
 * normalization the server applies, so what they allow is exactly what the API accepts. A post
 * needs text or an image, and every image needs to be processed and described before it can go.
 * States reach assistive technology through `aria-*` props: react-native-web 0.21 ignores
 * `accessibilityState`, and `disabled` already sets `aria-disabled`.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus, onDirtyChange }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploads = useImageUploads();

  const length = postLength(normalizePostBody(text));
  const { waiting, failed, undescribed } = describeState(uploads.images);
  const hasContent = length >= 1 || uploads.images.length >= 1;
  useEffect(() => onDirtyChange?.(hasContent), [hasContent, onDirtyChange]);
  const ready = hasContent && length <= POST_MAX_LENGTH && !waiting && !failed && !undescribed && !busy;
  // While images hold the post back, the button itself says what is missing, what the user can act
  // on first. Its accessible name is then that sentence, so a screen reader hears the reason too.
  const missing = failed ? "Remove the failed image" : undescribed ? "Describe every image" : waiting ? "Waiting for images…" : null;
  const action = replyTo ? "Reply" : quoteOf ? "Quote" : "Post";

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const post = await social.createPost({
        body: text,
        media: uploads.images.map((image) => ({ id: image.id!, alt: image.alt })),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
      });
      setText("");
      uploads.clear();
      onPosted?.(post);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addImages() {
    uploads.add(await pickImages());
  }

  return (
    <View className="px-4 py-3">
      {replyTo ? <Text className="mb-2 text-xs text-zinc-400">Replying to @{replyTo.author.handle}</Text> : null}
      <TextInput
        accessibilityLabel={replyTo ? "Your reply" : quoteOf ? "Your comment on the quoted post" : "What's on your mind?"}
        placeholder={replyTo ? "Write your reply" : quoteOf ? "Add your comment" : "What's on your mind?"}
        placeholderTextColor="#a1a1aa"
        multiline
        autoFocus={autoFocus}
        value={text}
        onChangeText={setText}
        className="min-h-[88px] rounded-lg border border-zinc-500 bg-zinc-900 px-4 py-3 text-base leading-6 text-zinc-50"
      />
      <ComposerImages images={uploads.images} onAlt={uploads.setAlt} onRemove={uploads.remove} />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} /> : null}
      {uploads.notice ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-amber-300">
          {uploads.notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="mt-2 text-sm text-red-400">
          {error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row items-center gap-3">
        {canPickImages && uploads.images.length < MEDIA_MAX_PER_POST ? (
          <Pressable accessibilityRole="button" onPress={() => void addImages()} className="rounded-lg border border-zinc-700 px-3 py-2">
            <Text className="text-sm text-zinc-200">Add image</Text>
          </Pressable>
        ) : null}
        <View className="flex-1" />
        <Text className={`text-xs ${length > POST_MAX_LENGTH ? "text-red-400" : "text-zinc-400"}`}>
          {length}/{POST_MAX_LENGTH}
        </Text>
        {onCancel ? (
          <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg border border-zinc-700 px-4 py-2">
            <Text className="text-sm text-zinc-200">Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" aria-busy={busy} disabled={!ready} onPress={() => void submit()} className={`rounded-lg px-4 py-2 ${ready ? "bg-zinc-50" : "bg-zinc-800"}`}>
          <Text className={`text-sm font-semibold ${ready ? "text-zinc-950" : "text-zinc-500"}`}>{busy ? "Posting…" : (missing ?? action)}</Text>
        </Pressable>
      </View>
    </View>
  );
}
