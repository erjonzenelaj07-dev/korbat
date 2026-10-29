import { useEffect, useImperativeHandle, useReducer, useRef, useState, type Ref } from "react";
import { Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import { MEDIA_MAX_PER_POST, type PostView } from "@korbat/contracts";
import { ListRow, switchColours } from "@/components/kit/ListRow";
import { Text } from "@/components/kit/Text";
import { toast } from "@/components/toast";
import { hasMention } from "@/lib/activity";
import { ACTIVITY_WORDS } from "@/lib/activity-words";
import { errorMessage } from "@/lib/api";
import { createDraftKeeper, draftContext, readDraft } from "@/lib/drafts";
import { useHaptics } from "@/lib/haptics";
import { canPickImages, pickImages } from "@/lib/pick-images";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";
import { UI_WORDS } from "@/lib/ui-words";
import { useTheme } from "@/theme/ThemeProvider";
import { ComposerField } from "./composer/ComposerField";
import { DiscardDialog } from "./composer/DiscardDialog";
import { SendBar } from "./composer/SendBar";
import { composerReducer, composerView, initialComposer, type ComposerKind } from "./composer/state";
import { ComposerImages } from "./ComposerImages";
import { QuoteEmbed } from "./PostCard";
import { useImageUploads } from "./useImageUploads";

/** What sending says, by what was sent (section 5.4): the same name as the button had. */
const SENT: Record<ComposerKind, string> = { post: UI_WORDS["toast.sent.post"], reply: UI_WORDS["toast.sent.reply"], quote: UI_WORDS["toast.sent.quote"] };

/**
 * The toast after sending (UI design, sections 5.4 and 6.15): the sentence names what was sent, and its View opens the
 * new post. It is announced politely; the post's own place is in the sentence, so View is a convenience, not the only way.
 */
export function announceSent(kind: ComposerKind, post: PostView): void {
  toast.show({ message: SENT[kind], action: { label: UI_WORDS["toast.view"], onPress: () => router.push(`/post/${post.id}`) } });
}

/** What a card does with its composer: put the focus back in the field. */
export interface ComposerHandle {
  focus(): void;
}

interface ComposerProps {
  replyTo?: PostView;
  quoteOf?: PostView;
  onPosted?: (post: PostView) => void;
  /** Cancel in the send bar, which a sheet gives: it closes, asking first when there is content. */
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Told whenever the draft gains or loses content, so a sheet can ask before discarding it. */
  onDirtyChange?: (dirty: boolean) => void;
  /** The discard question shows in place of the send bar (ComposeSheet asks it). */
  asking?: boolean;
  onKeep?: () => void;
  onDiscard?: () => void;
  /** The field lost the focus (a card closes itself when it is then empty). */
  onFieldBlur?: () => void;
  handle?: Ref<ComposerHandle>;
}

/**
 * One composer for posts, replies and quotes, with up to four images (UI design, section 6.15), on its parts: the field,
 * the image tray, the quoted post's preview (no live link in it), and the send bar with the ring and the Post button, or,
 * while a sheet asks, the discard question. composer/state.ts holds what is being written and says what follows; the
 * text is kept on the device per context (lib/drafts.ts) from the first keystroke, 500 ms after typing stops, and the
 * draft is removed when the post is sent or discarded. Sending fires the success haptic and the toast with View, and
 * hands the post on; the field keeps or gets back the focus as its container decides. States reach assistive
 * technology through aria-* props: react-native-web 0.21 ignores accessibilityState.
 *
 * 2d (4.5, 10.3, 10.6): while the text names a handle (MENTION_TOKEN), a line under the field says that up to 10 named
 * accounts are told, their settings permitting; no account is looked up while typing (decision 13). One option sits above
 * the send bar, "Hide like and repost counts", off for every new post, sent as hideCounts.
 */
export function Composer({ replyTo, quoteOf, onPosted, onCancel, autoFocus, onDirtyChange, asking = false, onKeep, onDiscard, onFieldBlur, handle }: ComposerProps) {
  const { state: session } = useSession();
  const account = session.status === "signed-in" ? session.me.user.id : null;
  const context = draftContext(replyTo?.id, quoteOf?.id);
  const [state, dispatch] = useReducer(composerReducer, context, (opening) => initialComposer(opening, account ? readDraft(account, opening) : ""));
  const uploads = useImageUploads((images) => dispatch({ type: "images", images }));
  const view = composerView(state);
  const haptic = useHaptics();
  const field = useRef<TextInput>(null);
  const { colors } = useTheme();
  const [hideCounts, setHideCounts] = useState(false);

  // One keeper per account and context; leaving writes what is still waiting.
  const keeper = useRef(createDraftKeeper(account, context));
  useEffect(() => {
    const own = createDraftKeeper(account, context);
    keeper.current = own;
    return () => own.dispose();
  }, [account, context]);

  useEffect(() => {
    onDirtyChange?.(view.hasContent);
  }, [view.hasContent, onDirtyChange]);
  useImperativeHandle(handle, () => ({ focus: () => field.current?.focus() }), []);

  // When the question is withdrawn (Keep writing, or Escape while it asks), the focus goes back to the words.
  const wasAsking = useRef(asking);
  useEffect(() => {
    if (wasAsking.current && !asking) field.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const type = (text: string) => {
    dispatch({ type: "type", text });
    keeper.current.typed(text);
  };

  async function submit() {
    if (!view.ready) return;
    dispatch({ type: "send" });
    try {
      const post = await social.createPost({
        body: state.text,
        media: state.images.map((image) => ({ id: image.id!, alt: image.alt })),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(quoteOf ? { quoteOfId: quoteOf.id } : {}),
        hideCounts,
      });
      // Touch and sight on the same frame: the haptic before the composer empties.
      haptic("success");
      keeper.current.sent();
      uploads.clear();
      dispatch({ type: "sent" });
      setHideCounts(false);
      announceSent(view.kind, post);
      onPosted?.(post);
    } catch (err) {
      dispatch({ type: "failed", error: errorMessage(err) });
    }
  }

  const discard = () => {
    keeper.current.discarded();
    dispatch({ type: "discard" });
    onDiscard?.();
  };

  const addImage = canPickImages && state.images.length < MEDIA_MAX_PER_POST ? () => void pickImages().then(uploads.add) : undefined;

  return (
    <View>
      <ComposerField fieldRef={field} kind={view.kind} value={state.text} onChangeText={type} length={view.length} autoFocus={autoFocus} onBlur={onFieldBlur} />
      {hasMention(state.text) ? (
        <Text variant="meta" tone="medium" className="mt-1">
          {ACTIVITY_WORDS["activity.composer.mentions"]}
        </Text>
      ) : null}
      <ComposerImages images={state.images} onAlt={uploads.setAlt} onRemove={uploads.remove} />
      {quoteOf ? <QuoteEmbed quote={{ ...quoteOf, quoteOf: null }} preview /> : null}
      {uploads.notice ? (
        <Text accessibilityRole="alert" variant="meta" tone="danger" className="mt-2">
          {uploads.notice}
        </Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" tone="danger" className="mt-2">
          {state.error}
        </Text>
      ) : null}
      {asking ? null : (
        // The kit's switch row: the switch is the one control, and the row around it, 52 px tall, is its pointer target.
        <View className="mt-2 border-t border-line-low">
          <ListRow
            label={UI_WORDS["post.hideCounts.option"]}
            control={{
              kind: "switch",
              value: hideCounts,
              onValueChange: setHideCounts,
              element: <Switch accessibilityLabel={UI_WORDS["post.hideCounts.option"]} value={hideCounts} onValueChange={setHideCounts} {...switchColours(colors)} />,
            }}
          />
        </View>
      )}
      {asking ? (
        <DiscardDialog onDiscard={discard} onKeep={() => onKeep?.()} />
      ) : (
        <SendBar onAddImage={addImage} length={view.length} onCancel={onCancel} label={view.button} ready={view.ready} busy={state.busy} onPost={() => void submit()} />
      )}
    </View>
  );
}
