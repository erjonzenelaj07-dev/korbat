import { Modal, Pressable, Text, View } from "react-native";
import type { PostView } from "@korbat/contracts";
import { Composer } from "./Composer";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/** The composer as a sheet over the current screen, for narrow layouts and for quoting from a thread. */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close the composer" onPress={onClose} className="flex-1 justify-end bg-black/60">
        <Pressable onPress={() => undefined} className="rounded-t-2xl border-t border-zinc-800 bg-zinc-950 pb-6 pt-2">
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-zinc-700" />
          </View>
          <Text accessibilityRole="header" className="px-4 text-base font-semibold text-zinc-50">
            {replyTo ? "Reply" : quoteOf ? "Quote" : "New post"}
          </Text>
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            autoFocus
            onCancel={onClose}
            onPosted={(post) => {
              onPosted(post);
              onClose();
            }}
          />
        </Pressable>
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
