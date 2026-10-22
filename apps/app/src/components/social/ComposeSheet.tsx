import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import type { PostView } from "@korbat/contracts";
import { Sheet } from "@/components/kit/Sheet";
import { Text } from "@/components/kit/Text";
import { useSession } from "@/lib/session";
import { refusalSentence, runningMeasure, STANDING_TEXTS } from "@/lib/standing";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { Composer } from "./Composer";
import type { ComposerKind } from "./composer/state";

interface ComposeSheetProps {
  open: boolean;
  onClose: () => void;
  onPosted?: (post: PostView) => void;
  replyTo?: PostView;
  quoteOf?: PostView;
}

/** The sheet's titles (8.6), as the composer's sheet always had them; they name the dialog. */
export const COMPOSE_TITLE: Record<ComposerKind, string> = { post: UI_WORDS["composer.title.post"], reply: UI_WORDS["composer.title.reply"], quote: UI_WORDS["composer.title.quote"] };

/**
 * What a request to close does (sections 6.8 and 8.6): an empty composer closes at once; one with content asks first;
 * and a request while the question shows (Escape again) withdraws the question and goes back to writing.
 */
export function closeStep(dirty: boolean, asking: boolean): "close" | "ask" | "keep" {
  if (asking) return "keep";
  return dirty ? "ask" : "close";
}

/**
 * The composer as a sheet (UI design, sections 6.8 and 8.6): kit/Sheet's bottom sheet with its handle below 768 px and a
 * 640 px dialog wider up, titled "New post", "Reply" or "Quote", with the focus in the field as it opens and back on the
 * opener as it closes. Every way to close it (Cancel, Escape, the scrim, a drag) comes through the Sheet's onClose, which
 * asks the discard question when the draft has content and closes at once when it is empty; the scrim stays no tab
 * stop and hidden from assistive technology, as Task 4's Sheet draws it. Sending closes it at once (the composer shows
 * the toast). While /me shows a running suspension or termination (3e, 9.4), the refusal replaces the fields.
 */
export function ComposeSheet({ open, onClose, onPosted, replyTo, quoteOf }: ComposeSheetProps) {
  const { state } = useSession();
  const standing = state.status === "signed-in" ? state.me.standing : null;
  const refused = runningMeasure(standing) !== null;
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  // A sheet opened again starts with no question.
  useEffect(() => {
    if (!open) {
      setAsking(false);
      setDirty(false);
    }
  }, [open]);
  const kind: ComposerKind = replyTo ? "reply" : quoteOf ? "quote" : "post";
  const requestClose = () => {
    const step = closeStep(dirty && !refused, asking);
    if (step === "close") onClose();
    else setAsking(step === "ask");
  };
  return (
    <Sheet open={open} onClose={requestClose} title={COMPOSE_TITLE[kind]} width={640} size="tall" initialFocus="first">
      <View className="px-5 pb-2 pt-1">
        {refused ? (
          <View className="gap-2">
            <Text accessibilityRole="alert">{refusalSentence(standing)}</Text>
            <Text variant="meta" tone="medium">
              {fill(UI_WORDS["composer.refused.where"], { read: STANDING_TEXTS.refused.read })}
            </Text>
          </View>
        ) : (
          <Composer
            replyTo={replyTo}
            quoteOf={quoteOf}
            // On the web the Sheet moves the focus into the field once it is open (initialFocus "first"), after the
            // Modal has noted the opener it gives the focus back to; a field focused as it mounts would be noted instead.
            autoFocus={Platform.OS !== "web"}
            onDirtyChange={setDirty}
            onCancel={requestClose}
            asking={asking}
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              setDirty(false);
              onClose();
            }}
            onPosted={(post) => {
              setDirty(false);
              onPosted?.(post);
              onClose();
            }}
          />
        )}
      </View>
    </Sheet>
  );
}
