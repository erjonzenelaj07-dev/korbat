import type { EngagementResponse, FollowResponse, PostCounts, PostView, ViewerPostState } from "@korbat/contracts";
import { laneKey, type EngagementKind, type Lanes } from "./social";
import { UI_WORDS, fill, type UiWord } from "./ui-words";

/**
 * What the post's actions do to the card, as pure functions (UI design, sections 6.6 and 8.4): the optimistic change of a
 * toggle, the server's answer replacing the counts, the rollback of a refusal, the names and counts the buttons show, the
 * stats line of a thread's focused post, the rollback toasts' words, and the follow button's toggle. PostCard and
 * FollowButton call them with the app's social client and lanes; the tests call them with fakes, since a static render
 * cannot press.
 */
export type ToggleKind = EngagementKind;

const FLAG: Record<ToggleKind, keyof ViewerPostState> = { like: "liked", repost: "reposted", bookmark: "bookmarked" };
/** The count a toggle moves; Save has none. */
const COUNT: Partial<Record<ToggleKind, "likes" | "reposts">> = { like: "likes", repost: "reposts" };
const NO_VIEWER: ViewerPostState = { liked: false, reposted: false, bookmarked: false };

export function isOn(post: PostView, kind: ToggleKind): boolean {
  return (post.viewer ?? NO_VIEWER)[FLAG[kind]];
}

/** The post with one toggle set to `on`, its count moved by one, never below zero; the post itself when it already is. */
export function turned(post: PostView, kind: ToggleKind, on: boolean): PostView {
  const viewer = post.viewer ?? NO_VIEWER;
  if (viewer[FLAG[kind]] === on) return post;
  const key = COUNT[kind];
  const counts = key === undefined ? post.counts : { ...post.counts, [key]: Math.max(0, post.counts[key] + (on ? 1 : -1)) };
  return { ...post, viewer: { ...viewer, [FLAG[kind]]: on }, counts };
}

/** The optimistic change of a press: the toggle the other way, at once. */
export function flipped(post: PostView, kind: ToggleKind): PostView {
  return turned(post, kind, !isOn(post, kind));
}

/**
 * The server's answer: its counts replace the card's, so they never drift, and its state of this kind is the truth. The
 * other kinds keep the card's own state, since their requests may still be out and their answers will say.
 */
export function settled(current: PostView, kind: ToggleKind, answer: EngagementResponse): PostView {
  return { ...current, counts: answer.counts, viewer: { ...(current.viewer ?? NO_VIEWER), [FLAG[kind]]: answer.viewer[FLAG[kind]] } };
}

/** A refusal: this kind's state and count as they were before the press; anything else that changed meanwhile stays. */
export function restored(current: PostView, before: PostView, kind: ToggleKind): PostView {
  const key = COUNT[kind];
  const counts = key === undefined ? current.counts : { ...current.counts, [key]: before.counts[key] };
  return { ...current, counts, viewer: { ...(current.viewer ?? NO_VIEWER), [FLAG[kind]]: isOn(before, kind) } };
}

export type ToggleResult = { status: "busy" } | { status: "answered"; on: boolean } | { status: "refused"; on: boolean; error: unknown };

/**
 * One press of Like, Repost or Save: nothing while that kind's request is still out; otherwise `onStart` (the haptic and
 * the motion, before the change, so sight and touch land together), the change at once, the request in its lane, then
 * the answer's counts, or the rollback.
 */
export async function toggleEngagement(
  client: { engage: (id: string, kind: ToggleKind, on: boolean) => Promise<EngagementResponse> },
  lanes: Lanes,
  post: PostView,
  kind: ToggleKind,
  apply: (update: (current: PostView) => PostView) => void,
  onStart?: (on: boolean) => void,
): Promise<ToggleResult> {
  const key = laneKey.post(post.id, kind);
  if (lanes.busy(key)) return { status: "busy" };
  const on = !isOn(post, kind);
  onStart?.(on);
  apply((current) => turned(current, kind, on));
  const outcome = await lanes.run(key, () => client.engage(post.id, kind, on));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "answered") {
    apply((current) => settled(current, kind, outcome.answer));
    return { status: "answered", on };
  }
  apply((current) => restored(current, post, kind));
  return { status: "refused", on, error: outcome.error };
}

export type FollowResult = { status: "busy" } | { status: "answered"; answer: FollowResponse } | { status: "refused"; on: boolean; error: unknown };

/** Follow or unfollow, the same way: the label at once, the answer's state after, the old state back on a refusal. */
export async function toggleFollow(
  client: { setFollow: (handle: string, on: boolean) => Promise<FollowResponse> },
  lanes: Lanes,
  handle: string,
  following: boolean,
  apply: (following: boolean) => void,
): Promise<FollowResult> {
  const key = laneKey.follow(handle);
  if (lanes.busy(key)) return { status: "busy" };
  const on = !following;
  apply(on);
  const outcome = await lanes.run(key, () => client.setFollow(handle, on));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "answered") {
    apply(outcome.answer.following);
    return outcome;
  }
  apply(following);
  return { status: "refused", on, error: outcome.error };
}

export type DeleteResult = { status: "busy" } | { status: "deleted" } | { status: "refused"; error: unknown };

/**
 * Delete: the request in the post's delete lane; once the server has answered, the card leaves (`leave`, the
 * post-removed fade), and only then is the post deleted for its list. A refusal leaves the card where it is.
 */
export async function deleteWithLeave(client: { deletePost: (id: string) => Promise<unknown> }, lanes: Lanes, id: string, leave: () => Promise<void>): Promise<DeleteResult> {
  const outcome = await lanes.run(laneKey.post(id, "delete"), () => client.deletePost(id));
  if (outcome.status === "busy") return outcome;
  if (outcome.status === "refused") return { status: "refused", error: outcome.error };
  await leave();
  return { status: "deleted" };
}

type Counted = "reply" | "like" | "repost";

const COUNT_WORDS: Record<Counted, { many: UiWord; one: UiWord; none: UiWord }> = {
  reply: { many: "post.reply", one: "post.reply.one", none: "post.reply.none" },
  like: { many: "post.like", one: "post.like.one", none: "post.like.none" },
  repost: { many: "post.reposts", one: "post.reposts.one", none: "post.reposts.none" },
};

/** Whether the reader's setting hides this kind's count (decision 15: likes and reposts; replies lead to conversation). */
const hides = (kind: Counted, hideCounts: boolean): boolean => hideCounts && kind !== "reply";

/** A button's name with its count: "Like, 12 likes", "Like, 1 like", and "Like" at zero or when the count is hidden. */
export function countLabel(kind: Counted, count: number, hideCounts: boolean): string {
  const words = COUNT_WORDS[kind];
  if (count <= 0 || hides(kind, hideCounts)) return UI_WORDS[words.none];
  if (count === 1) return UI_WORDS[words.one];
  return fill(UI_WORDS[words.many], { n: count });
}

/** The number a button shows beside its icon, or nothing at zero or when the count is hidden. */
export function shownCount(kind: Counted, count: number, hideCounts: boolean): number | undefined {
  return count > 0 && !hides(kind, hideCounts) ? count : undefined;
}

/** The thread's stats line (8.3): "12 reposts, 4 quotes, 30 likes", each part left out at zero or when hidden. */
export function threadStats(counts: PostCounts, hideCounts: boolean): string {
  const parts: [number, UiWord, UiWord, boolean][] = [
    [counts.reposts, "thread.stats.reposts", "thread.stats.reposts.one", hideCounts],
    [counts.quotes, "thread.stats.quotes", "thread.stats.quotes.one", false],
    [counts.likes, "thread.stats.likes", "thread.stats.likes.one", hideCounts],
  ];
  return parts
    .filter(([n, , , hidden]) => n > 0 && !hidden)
    .map(([n, many, one]) => (n === 1 ? UI_WORDS[one] : fill(UI_WORDS[many], { n })))
    .join(", ");
}

const FAILED: Record<ToggleKind, { on: UiWord; off: UiWord }> = {
  like: { on: "toast.failed.like", off: "toast.failed.unlike" },
  repost: { on: "toast.failed.repost", off: "toast.failed.unrepost" },
  bookmark: { on: "toast.failed.save", off: "toast.failed.unsave" },
};

/** The rollback toast's sentence (5.4, 8.6), naming the action the reader took. */
export function failedWords(kind: ToggleKind, on: boolean): string {
  return UI_WORDS[FAILED[kind][on ? "on" : "off"]];
}

export function followFailedWords(handle: string, on: boolean): string {
  return fill(UI_WORDS[on ? "toast.failed.follow" : "toast.failed.unfollow"], { handle });
}
