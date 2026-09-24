import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { PostView } from "@korbat/contracts";
import { Composer } from "./Composer";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/**
 * The composer as a sheet over the current screen, for narrow layouts and for quoting from a thread.
 * The backdrop closes it but is no tab stop, so the keyboard lands on the text; a draft with content
 * is not thrown away by a stray tap: closing then asks first. The slide is skipped under reduced motion.
 */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  const still = useReducedMotion();
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  const discard = () => {
    setConfirming(false);
    setDirty(false);
    onClose();
  };
  return (
    <Modal visible={open} transparent animationType={still ? "none" : "slide"} onRequestClose={close}>
      <Pressable accessibilityLabel="Close the composer" tabIndex={-1} onPress={close} className="flex-1 justify-end bg-black/60">
        <View onStartShouldSetResponder={() => true} className="rounded-t-2xl border-t border-zinc-800 bg-zinc-950 pb-6 pt-2">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-zinc-700" />
          </View>
          <Text accessibilityRole="header" aria-level={2} className="px-4 text-base font-semibold text-zinc-50">
            {replyTo ? "Reply" : quoteOf ? "Quote" : "New post"}
          </Text>
          {confirming ? (
            <View role="dialog" aria-labelledby="discard-title" className="mx-4 mt-2 flex-row flex-wrap items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2">
              <Text nativeID="discard-title" className="text-sm text-zinc-200">
                Discard this draft?
              </Text>
              <Pressable accessibilityRole="button" onPress={discard} className="rounded-lg bg-red-600 px-3 py-1.5">
                <Text className="text-sm font-semibold text-zinc-50">Discard</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} className="rounded-lg border border-zinc-600 px-3 py-1.5">
                <Text className="text-sm text-zinc-200">Keep writing</Text>
              </Pressable>
            </View>
          ) : null}
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            autoFocus
            onDirtyChange={setDirty}
            onCancel={close}
            onPosted={(post) => {
              setDirty(false);
              onPosted(post);
              onClose();
            }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

/** The floating action button that opens the sheet on phones. */
export function ComposeButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="New post" onPress={onPress} className="h-14 w-14 items-center justify-center rounded-full bg-zinc-50 shadow-lg">
      <Text className="text-3xl leading-8 text-zinc-950">+</Text>
    </Pressable>
  );
}
