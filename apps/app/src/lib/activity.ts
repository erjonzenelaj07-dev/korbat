import {
  ACTIVITY_KEEP_DAYS,
  ACTIVITY_NEWER_CAP,
  ACTIVITY_TABS,
  ActivityNewerResponse,
  ActivityPage,
  ActivitySettings,
  MENTION_TOKEN,
  type ActivityEntry,
  type ActivityTab,
} from "@korbat/contracts";
import { IMAGE_LOST_NOTICE } from "@korbat/rules";
import { ACTIVITY_WORDS } from "./activity-words";
import { api } from "./api";
import { RELEASE_TEXTS, UPLOAD_TEXTS } from "./moderation-words";
import { createNewPosts, type NewPostsClock } from "./new-posts";
import { localDay, postedWhen, timeAgo } from "./time";
import { fill } from "./ui-words";

/**
 * Activity in the app (2d design, sections 5.5.3, 5.7, 5.8, 9.2 and 10.2): the five calls of the activity module, and what
 * the screen does with their answers as pure functions, so the tests can drive them: the tab in the address, the rows
 * with their two headings, the marker of the visit, the newer count's pill, the poll's schedule, the focus after a
 * reload or Load more, and the settings' save once a choice settles. Every time of Activity is the API's string with six
 * fractional digits (ActivityTime): it is kept as it came and compared as a string, never passed through Date, which
 * would cut it to the millisecond and leave the marker short of an entry written later in the same millisecond.
 */

const query = (parts: Record<string, string | undefined>) =>
  Object.entries(parts)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value!)}`)
    .join("&");

/** GET /api/activity and /newer, POST /seen, GET and PUT /settings (9.2). Nothing else asks for Activity, anywhere. */
export const activityApi = {
  page: (tab: ActivityTab, cursor?: string) => api(`/api/activity?${query({ tab, cursor })}`, { schema: ActivityPage }),
  newer: (tab: ActivityTab, since?: string) => api(`/api/activity/newer?${query({ tab, since })}`, { schema: ActivityNewerResponse }),
  seen: (at: string) => api("/api/activity/seen", { json: { at } }),
  settings: () => api("/api/activity/settings", { schema: ActivitySettings }),
  saveSettings: (settings: ActivitySettings) => api("/api/activity/settings", { method: "PUT", json: settings, schema: ActivitySettings }),
};

/** The tab the address names (`/activity?tab=conversations`), so a reload keeps it; anything else is All. */
export function activityTab(param: string | string[] | undefined): ActivityTab {
  const named = Array.isArray(param) ? param[0] : param;
  return ACTIVITY_TABS.find((tab) => tab === named) ?? "all";
}

/** The pill's words: "1 new", "{n} new", and "20+ new" from the count's cap. */
export function activityPill(count: number): string {
  if (count >= ACTIVITY_NEWER_CAP) return ACTIVITY_WORDS["activity.pill.many"];
  return count === 1 ? ACTIVITY_WORDS["activity.pill.one"] : fill(ACTIVITY_WORDS["activity.pill"], { n: count });
}

/**
 * Entries marked new against the visit's marker: the first page's `seenAt`, which the screen keeps while it is open, since
 * the marker it sends after that page would make every later page's entries old. Null, before the first visit, is new.
 */
export function markForVisit(items: ActivityEntry[], seenAt: string | null): ActivityEntry[] {
  return items.map((entry) => ({ ...entry, new: seenAt === null || entry.at > seenAt }));
}

/** The seen marker to send after the first page: its newest entry's time, and only when something on it was new (5.7). */
export function seenToSend(page: ActivityPage): string | null {
  return page.items.some((entry) => entry.new) ? page.items[0]!.at : null;
}

export type ActivityRow =
  | { kind: "entry"; key: string; entry: ActivityEntry }
  | { kind: "heading"; key: string; heading: "new" | "earlier" }
  | { kind: "skeleton"; key: string; index: number }
  | { kind: "empty"; key: "empty" }
  | { kind: "error"; key: "error"; message: string }
  | { kind: "loadMore"; key: "loadMore"; busy: boolean }
  | { kind: "loadMoreError"; key: "loadMoreError"; message: string }
  | { kind: "end"; key: "end" };

export interface ActivityRowsInput {
  items: ActivityEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  cursor: string | null;
  loadingMore: boolean;
  moreError: string | null;
}

/**
 * The list's rows (10.2): skeletons, the error or the empty state; else the entries, the h2 "New since you last looked"
 * above the first new one and "Earlier" above the first older one, both only when something is new; then Load more, a
 * failed page's sentence, or the end, which names the days korbat keeps.
 */
export function activityRows(input: ActivityRowsInput): ActivityRow[] {
  if (input.status === "loading") return [0, 1, 2, 3, 4].map((index) => ({ kind: "skeleton", key: `skeleton-${index}`, index }));
  if (input.status === "error") return [{ kind: "error", key: "error", message: input.error ?? "" }];
  if (input.items.length === 0) return [{ kind: "empty", key: "empty" }];
  const rows: ActivityRow[] = [];
  const anyNew = input.items.some((entry) => entry.new);
  let earlier = false;
  input.items.forEach((entry, index) => {
    if (anyNew && index === 0 && entry.new) rows.push({ kind: "heading", key: "heading-new", heading: "new" });
    if (anyNew && !entry.new && !earlier) {
      earlier = true;
      rows.push({ kind: "heading", key: "heading-earlier", heading: "earlier" });
    }
    rows.push({ kind: "entry", key: entry.key, entry });
  });
  if (input.moreError) rows.push({ kind: "loadMoreError", key: "loadMoreError", message: input.moreError });
  else if (input.cursor !== null) rows.push({ kind: "loadMore", key: "loadMore", busy: input.loadingMore });
  else rows.push({ kind: "end", key: "end" });
  return rows;
}

/** Where the focus goes after the pill or a refresh: the list's first entry. */
export function firstEntryKey(rows: ActivityRow[]): string | null {
  return rows.find((row) => row.kind === "entry")?.key ?? null;
}

/** Where the focus goes after Load more: the first entry the page brought, the one after the `before` already shown. */
export function firstLoadedKey(before: number, items: ActivityEntry[]): string | null {
  return items[before]?.key ?? null;
}

/**
 * A focus that waits for its row (10.2): `attempt` is tried at once and every 50 ms until it says the focus landed, for
 * at most 5 s. The list draws its rows in batches, so on a slow device the entry the pill or Load more names may not be
 * drawn yet when the page arrives; trying once would leave a keyboard user on the control they pressed. The answer
 * cancels the tries, for a newer focus request or a list that goes.
 */
export function retryFocus(attempt: () => boolean, everyMs = 50, withinMs = 5000): () => void {
  const deadline = Date.now() + withinMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = () => {
    timer = null;
    if (attempt() || Date.now() >= deadline) return;
    timer = setTimeout(next, everyMs);
  };
  timer = setTimeout(next, 0);
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

/** An entry's line (10.10): who did what, the follows of a day by up to two names and the count, and the notices' words. */
export function entryLine(entry: ActivityEntry): string {
  if (entry.type === "post") return fill(ACTIVITY_WORDS[`activity.${entry.kind}`], { name: entry.post.author.displayName });
  if (entry.type === "follows") {
    const [first, second] = entry.actors;
    if (entry.count === 1) return fill(ACTIVITY_WORDS["activity.follow.one"], { name: first!.displayName });
    if (entry.count === 2 && second) return fill(ACTIVITY_WORDS["activity.follow.two"], { name: first!.displayName, other: second.displayName });
    return fill(ACTIVITY_WORDS["activity.follow.many"], { name: first!.displayName, n: entry.count - 1 });
  }
  const day = entry.postCreatedAt === null ? "" : localDay(entry.postCreatedAt);
  if (entry.kind === "release") return RELEASE_TEXTS.entry;
  if (entry.kind === "upload") return UPLOAD_TEXTS.entry;
  if (entry.kind === "lost") return IMAGE_LOST_NOTICE.mail(day);
  return entry.target === "post" ? fill(ACTIVITY_WORDS["activity.decision.post"], { date: day }) : ACTIVITY_WORDS[`activity.decision.${entry.target}`];
}

/** When, as the entry's name says it: "3h ago", "just now", "on 12/10/2026". */
export function activityWhen(at: string): string {
  return timeAgo(at) === "just now" ? timeAgo(at) : postedWhen(at);
}

/** An entry's accessible name (10.2): its line and its time, with "New, " first while it is new. */
export function entryName(entry: ActivityEntry): string {
  return fill(ACTIVITY_WORDS[entry.new ? "activity.entry.newName" : "activity.entry.name"], { line: entryLine(entry), time: activityWhen(entry.at) });
}

/** The end of the list, which names the days an entry is kept. */
export const activityEnd = (): string => fill(ACTIVITY_WORDS["activity.end"], { days: ACTIVITY_KEEP_DAYS });

/** Whether the composer's text names a handle (4.5, 10.3): a fresh copy of the global token, so no place is shared. */
export function hasMention(text: string): boolean {
  return new RegExp(MENTION_TOKEN.source).test(text);
}

/** Whether the screen may ask for newer entries: on screen, the page visible, and its first page in (5.8). */
export function activityPollActive(state: { focused: boolean; visible: boolean; ready: boolean }): boolean {
  return state.focused && state.visible && state.ready;
}

/** The feed's schedule (lib/new-posts.ts): 30 s of active time after the screen opens, then 60 s after each answer. */
export function createActivityPoll(ask: () => Promise<unknown>): NewPostsClock {
  return createNewPosts(ask);
}

const same = (a: ActivitySettings, b: ActivitySettings) => a.replies === b.replies && a.mentions === b.mentions && a.quotes === b.quotes && a.follows === b.follows;

/**
 * Settings, Activity's save (10.8): a choice is sent once it has been still for 800 ms, or at once when the focus leaves
 * its group, so arrowing across a group sends one request and shows one toast; a choice back at the saved value sends
 * nothing; a refused save hands the saved value back for the rollback. Saves go one after another, never side by side.
 */
export function createSettingsSaver(options: {
  initial: ActivitySettings;
  save: (next: ActivitySettings) => Promise<ActivitySettings>;
  onSaved: (saved: ActivitySettings) => void;
  onFailed: (saved: ActivitySettings) => void;
  delayMs?: number;
}) {
  let saved = options.initial;
  let pending: ActivitySettings | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const next = pending;
    pending = null;
    if (next === null) return;
    chain = chain.then(async () => {
      if (same(next, saved)) return;
      try {
        saved = await options.save(next);
        options.onSaved(saved);
      } catch {
        options.onFailed(saved);
      }
    });
  };
  return {
    choose(next: ActivitySettings) {
      pending = next;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, options.delayMs ?? 800);
    },
    leave: flush,
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
