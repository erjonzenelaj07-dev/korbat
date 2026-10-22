import { Platform } from "react-native";
import type { Page } from "./social";

/**
 * New posts above a feed (UI design, decision 7, section 8.2). Following and Latest ask for their first page of 50
 * thirty seconds after they open and every sixty seconds after, only while Home is focused, an account is signed in, the
 * feed is the tab chosen and the page is visible; nothing is asked while korbat is in the background, and the only sign
 * of what arrives is the pill inside the feed (no dot on the tab, no count in the title). What an answer adds is the
 * posts above the first one already listed; when all fifty are new, a gap row follows them and reads on from the page's
 * cursor until it meets the posts already listed. The schedule is a clock that stops while the feed is not active and
 * goes on from where it was.
 */

export const FIRST_ASK_MS = 30_000;
export const ASK_EVERY_MS = 60_000;
/** The page a poll reads: the most Pagination allows (packages/contracts, 1 to 50). */
export const NEW_LIMIT = 50;

/** Whether the feed may ask now: Home in focus, an account, its tab chosen, the page visible. */
export function pollActive(state: { focused: boolean; signedIn: boolean; selected: boolean; visible: boolean }): boolean {
  return state.focused && state.signedIn && state.selected && state.visible;
}

/** Whether the page is visible: document.visibilityState on the web; native asks AppState, which the feed follows. */
export function pageVisible(): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/** The items of `page` before the first one already listed; with none listed and a full page, the gap's cursor too. */
export function newRows<T>(page: Page<T>, keyOf: (item: T) => string, known: ReadonlySet<string>): { added: T[]; gapCursor: string | null } {
  const at = page.items.findIndex((item) => known.has(keyOf(item)));
  if (at >= 0) return { added: page.items.slice(0, at), gapCursor: null };
  // All new. A full page may be followed by more new posts, not yet read: the gap row reads them on demand.
  return { added: [...page.items], gapCursor: page.items.length >= NEW_LIMIT ? page.nextCursor : null };
}

/** A gap's next page: its items until the first one already listed, and the cursor to read on when none was met. */
export function gapRows<T>(page: Page<T>, keyOf: (item: T) => string, known: ReadonlySet<string>): { added: T[]; gapCursor: string | null } {
  const at = page.items.findIndex((item) => known.has(keyOf(item)));
  if (at >= 0) return { added: page.items.slice(0, at), gapCursor: null };
  return { added: [...page.items], gapCursor: page.nextCursor };
}

export interface NewPostsClock {
  setActive(active: boolean): void;
  dispose(): void;
}

/**
 * The schedule: `ask` 30 s of active time after the feed opens and 60 s after each answer. An ask still out is never
 * doubled, a failed one is quiet (the next ask tries again), and inactive time does not count.
 */
export function createNewPosts(ask: () => Promise<unknown>): NewPostsClock {
  let active = false;
  let disposed = false;
  let asking = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueIn = FIRST_ASK_MS;
  let armedAt = 0;

  const arm = () => {
    if (disposed || !active || asking || timer !== null) return;
    armedAt = Date.now();
    timer = setTimeout(fire, dueIn);
  };
  const fire = () => {
    timer = null;
    asking = true;
    dueIn = ASK_EVERY_MS;
    let answer: Promise<unknown>;
    try {
      answer = ask();
    } catch {
      answer = Promise.resolve();
    }
    void answer
      .catch(() => undefined)
      .finally(() => {
        asking = false;
        arm();
      });
  };

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) {
        arm();
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        dueIn = Math.max(0, dueIn - (Date.now() - armedAt));
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
