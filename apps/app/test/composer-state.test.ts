import { describe, expect, test } from "vitest";
import { POST_MAX_LENGTH } from "@korbat/contracts";
import { composerReducer, composerView, crossed, initialComposer, kindOf, ring, type ComposerState } from "../src/components/social/composer/state";
import type { ComposerImage } from "../src/components/social/useImageUploads";
import { UI_WORDS } from "../src/lib/ui-words";

/**
 * The composer's state (UI design, section 6.15, Task 6): one pure reducer holds the text, the images and where each
 * stands, whether the post is being sent, the server's refusal and the draft's key, and composerView() says what follows
 * from them: the length by the server's own normalisation, whether the post may go, the Post button's words (what is
 * missing first), the count's words and the ring. Every transition is here, so the parts that draw it need no state of
 * their own.
 */

const ELLIPSIS = String.fromCharCode(0x2026);
const POST = "00000000-0000-4000-8000-000000000101";

const image = (key: string, change: Partial<ComposerImage> = {}): ComposerImage => ({ key, previewUrl: `blob:${key}`, alt: "A heron on the canal", status: "ready", id: `00000000-0000-4000-8000-00000000070${key.length}`, error: null, ...change });

const typed = (text: string, state: ComposerState = initialComposer("post")) => composerReducer(state, { type: "type", text });

describe("the reducer", () => {
  test("starts from the draft's key and its kept text, empty and idle", () => {
    expect(initialComposer("post")).toEqual({ context: "post", text: "", images: [], busy: false, error: null });
    expect(initialComposer(`reply:${POST}`, "kept words")).toEqual({ context: `reply:${POST}`, text: "kept words", images: [], busy: false, error: null });
    expect(kindOf("post")).toBe("post");
    expect(kindOf(`reply:${POST}`)).toBe("reply");
    expect(kindOf(`quote:${POST}`)).toBe("quote");
  });

  test("type sets the text, and images replaces the images with where each stands", () => {
    const state = typed("Morning light");
    expect(state.text).toBe("Morning light");
    const withImages = composerReducer(state, { type: "images", images: [image("a")] });
    expect(withImages.images).toHaveLength(1);
    expect(withImages.text).toBe("Morning light");
    // Neither touches the draft's key.
    expect(withImages.context).toBe("post");
  });

  test("send starts sending only a post that may go, and clears the last refusal", () => {
    const ready = composerReducer(typed("Morning light"), { type: "failed", error: "korbat is busy." });
    const sending = composerReducer(ready, { type: "send" });
    expect(sending.busy).toBe(true);
    expect(sending.error).toBeNull();
    // A second press while it is out sends nothing more.
    expect(composerReducer(sending, { type: "send" })).toBe(sending);
    // Nothing to send, or too long: send changes nothing.
    const empty = initialComposer("post");
    expect(composerReducer(empty, { type: "send" })).toBe(empty);
    const long = typed("x".repeat(POST_MAX_LENGTH + 1));
    expect(composerReducer(long, { type: "send" })).toBe(long);
  });

  test("sent empties the composer and keeps its key; failed keeps the words and says why", () => {
    const sending = composerReducer(composerReducer(typed("Morning light"), { type: "images", images: [image("a")] }), { type: "send" });
    expect(composerReducer(sending, { type: "sent" })).toEqual({ context: "post", text: "", images: [], busy: false, error: null });
    const refused = composerReducer(sending, { type: "failed", error: "korbat is busy." });
    expect(refused).toMatchObject({ text: "Morning light", busy: false, error: "korbat is busy." });
    expect(refused.images).toHaveLength(1);
  });

  test("discard empties the composer at once, whatever it held", () => {
    const full = composerReducer(composerReducer(typed("Morning light"), { type: "images", images: [image("a")] }), { type: "failed", error: "no" });
    expect(composerReducer(full, { type: "discard" })).toEqual(initialComposer("post"));
  });
});

describe("what follows from it", () => {
  test("the length is the server's: normalised, so spaces at the ends do not count", () => {
    expect(composerView(typed("  hello  ")).length).toBe(5);
    expect(composerView(typed("")).hasContent).toBe(false);
    expect(composerView(typed("   ")).hasContent).toBe(false);
    expect(composerView(composerReducer(initialComposer("post"), { type: "images", images: [image("a")] })).hasContent).toBe(true);
  });

  test("the Post button says what the reader can act on first, and Posting... while it sends", () => {
    const view = (state: ComposerState) => composerView(state);
    expect(view(typed("hello")).button).toBe(UI_WORDS["composer.action.post"]);
    expect(view(typed("hello")).ready).toBe(true);
    expect(view(typed("hello", initialComposer(`reply:${POST}`))).button).toBe(UI_WORDS["composer.action.reply"]);
    expect(view(typed("hello", initialComposer(`quote:${POST}`))).button).toBe(UI_WORDS["composer.action.quote"]);
    const failed = composerReducer(typed("hello"), { type: "images", images: [image("a", { status: "failed" }), image("b", { alt: "" }), image("c", { status: "uploading" })] });
    expect(view(failed)).toMatchObject({ button: UI_WORDS["composer.missing.failed"], missing: UI_WORDS["composer.missing.failed"], ready: false });
    const refused = composerReducer(typed("hello"), { type: "images", images: [image("a", { status: "refused" })] });
    expect(view(refused).button).toBe(UI_WORDS["composer.missing.failed"]);
    const undescribed = composerReducer(typed("hello"), { type: "images", images: [image("b", { alt: "" }), image("c", { status: "processing" })] });
    expect(view(undescribed).button).toBe(UI_WORDS["composer.missing.undescribed"]);
    const waiting = composerReducer(typed("hello"), { type: "images", images: [image("c", { status: "uploading" })] });
    expect(view(waiting)).toMatchObject({ button: UI_WORDS["composer.missing.waiting"], ready: false });
    expect(view(composerReducer(typed("hello"), { type: "send" }))).toMatchObject({ button: UI_WORDS["composer.posting"], ready: false });
    // Too long: the button keeps its word and cannot be used; the ring says why.
    expect(view(typed("x".repeat(POST_MAX_LENGTH + 1)))).toMatchObject({ button: UI_WORDS["composer.action.post"], ready: false, missing: null });
    expect(view(typed(""))).toMatchObject({ ready: false, missing: null });
  });

  test("the words are the composer's own, word for word, with the real ellipsis", () => {
    expect(UI_WORDS["composer.missing.failed"]).toBe("Remove the failed image");
    expect(UI_WORDS["composer.missing.undescribed"]).toBe("Describe every image");
    expect(UI_WORDS["composer.missing.waiting"]).toBe(`Waiting for images${ELLIPSIS}`);
    expect(UI_WORDS["composer.posting"]).toBe(`Posting${ELLIPSIS}`);
    expect([UI_WORDS["composer.action.post"], UI_WORDS["composer.action.reply"], UI_WORDS["composer.action.quote"]]).toEqual(["Post", "Reply", "Quote"]);
    expect(UI_WORDS["composer.count"]).toBe("{n} of 1000 characters");
  });

  test("the count's words replace n/1000: {n} of 1000 characters", () => {
    expect(composerView(typed("hello")).count).toBe("5 of 1000 characters");
    expect(composerView(typed("")).count).toBe("0 of 1000 characters");
    expect(composerView(typed("x".repeat(1003))).count).toBe("1003 of 1000 characters");
  });

  test("the ring fills with the count, in the accent, review-ink from 900 and danger-ink past 1000, with the number when 100 or fewer remain", () => {
    expect(ring(0)).toEqual({ progress: 0, tone: "accent", number: null });
    expect(ring(500)).toEqual({ progress: 0.5, tone: "accent", number: null });
    expect(ring(899)).toMatchObject({ tone: "accent", number: null });
    expect(ring(900)).toEqual({ progress: 0.9, tone: "review-ink", number: "100" });
    expect(ring(988)).toMatchObject({ tone: "review-ink", number: "12" });
    expect(ring(1000)).toEqual({ progress: 1, tone: "review-ink", number: "0" });
    expect(ring(1003)).toEqual({ progress: 1, tone: "danger", number: "-3" });
    expect(composerView(typed("x".repeat(950))).ring).toEqual(ring(950));
  });

  test("the count is announced only when it crosses 900 or 1000, either way", () => {
    expect(crossed(899, 900)).toBe(true);
    expect(crossed(900, 899)).toBe(true);
    expect(crossed(1000, 1001)).toBe(true);
    expect(crossed(1001, 1000)).toBe(true);
    expect(crossed(850, 1100)).toBe(true);
    expect(crossed(10, 11)).toBe(false);
    expect(crossed(900, 950)).toBe(false);
    expect(crossed(1001, 1200)).toBe(false);
    expect(crossed(500, 500)).toBe(false);
  });
});
