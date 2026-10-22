import { POST_MAX_LENGTH, normalizePostBody, postLength } from "@korbat/contracts";
import type { DraftContext } from "@/lib/drafts";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { describeState, type ComposerImage } from "../useImageUploads";

/**
 * The composer's state (UI design, section 6.15, after Bluesky's composerReducer): one pure reducer holds what the
 * reader is writing (the text), the images and where each upload stands (useImageUploads.ts follows the uploads and
 * hands each change here), whether the post is being sent, the server's refusal, and the draft's key; composerView()
 * says what follows from them. The counts use the server's own normalisation (normalizePostBody, postLength), so what
 * the composer allows is exactly what the API accepts. The parts (ComposerField, ProgressRing, SendBar, the image tray)
 * draw from it and keep no state of their own.
 */

export type ComposerKind = "post" | "reply" | "quote";

export const kindOf = (context: DraftContext): ComposerKind => (context === "post" ? "post" : context.startsWith("reply:") ? "reply" : "quote");

export interface ComposerState {
  /** The draft's key: a new post, a reply to a post, a quote of a post. */
  context: DraftContext;
  text: string;
  images: ComposerImage[];
  /** The post is on its way to the server. */
  busy: boolean;
  /** The server's refusal of the last send, in the app's words. */
  error: string | null;
}

export type ComposerAction =
  | { type: "type"; text: string }
  | { type: "images"; images: ComposerImage[] }
  | { type: "send" }
  | { type: "sent" }
  | { type: "failed"; error: string }
  | { type: "discard" };

/** A composer as it opens: empty, or with the draft kept for its context. */
export function initialComposer(context: DraftContext, text = ""): ComposerState {
  return { context, text, images: [], busy: false, error: null };
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case "type":
      return { ...state, text: action.text };
    case "images":
      return { ...state, images: action.images };
    case "send":
      // Only a post that may go is sent, once: a second press while it is out changes nothing.
      return composerView(state).ready ? { ...state, busy: true, error: null } : state;
    case "sent":
      return initialComposer(state.context);
    case "failed":
      return { ...state, busy: false, error: action.error };
    case "discard":
      return initialComposer(state.context);
  }
}

/** From this many characters the ring turns review-ink; past POST_MAX_LENGTH, danger-ink. */
export const COUNT_NEAR = 900;
/** The ring shows the number left once this many or fewer remain. */
export const RING_NUMBER_AT = 100;

export type RingTone = "accent" | "review-ink" | "danger";

/** The ring (6.15): how full it is, its colour, and the number beside it ("12", then "-3" over the limit). */
export interface Ring {
  progress: number;
  tone: RingTone;
  number: string | null;
}

export function ring(length: number): Ring {
  const left = POST_MAX_LENGTH - length;
  return {
    progress: Math.min(1, Math.max(0, length / POST_MAX_LENGTH)),
    tone: length > POST_MAX_LENGTH ? "danger" : length >= COUNT_NEAR ? "review-ink" : "accent",
    number: left <= RING_NUMBER_AT ? String(left) : null,
  };
}

/**
 * Whether a change of the count crosses 900 or 1000, either way: the only changes the field's count is announced on, so
 * a screen reader hears that the end is near or passed without hearing every keystroke.
 */
export function crossed(before: number, after: number): boolean {
  return before < COUNT_NEAR !== after < COUNT_NEAR || before > POST_MAX_LENGTH !== after > POST_MAX_LENGTH;
}

export interface ComposerView {
  kind: ComposerKind;
  length: number;
  /** Text or an image: closing then asks first. */
  hasContent: boolean;
  /** The Post button can send now. */
  ready: boolean;
  /** What the images still need, in the words the button then shows; null when they need nothing. */
  missing: string | null;
  /** The Post button's words: Posting... while it sends, else what is missing, else Post, Reply or Quote. */
  button: string;
  /** "{n} of 1000 characters", the field's description. */
  count: string;
  ring: Ring;
}

const ACTION: Record<ComposerKind, string> = { post: UI_WORDS["composer.action.post"], reply: UI_WORDS["composer.action.reply"], quote: UI_WORDS["composer.action.quote"] };

export function composerView(state: ComposerState): ComposerView {
  const kind = kindOf(state.context);
  const length = postLength(normalizePostBody(state.text));
  const { waiting, failed, undescribed } = describeState(state.images);
  const hasContent = length >= 1 || state.images.length >= 1;
  // While images hold the post back, the button says what is missing, what the reader can act on first; its accessible
  // name is then that sentence, so a screen reader hears the reason too.
  const missing = failed ? UI_WORDS["composer.missing.failed"] : undescribed ? UI_WORDS["composer.missing.undescribed"] : waiting ? UI_WORDS["composer.missing.waiting"] : null;
  const ready = hasContent && length <= POST_MAX_LENGTH && missing === null && !state.busy;
  return {
    kind,
    length,
    hasContent,
    ready,
    missing,
    button: state.busy ? UI_WORDS["composer.posting"] : (missing ?? ACTION[kind]),
    count: fill(UI_WORDS["composer.count"], { n: length }),
    ring: ring(length),
  };
}
