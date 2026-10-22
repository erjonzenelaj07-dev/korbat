/**
 * Prepending without a jump, on the web (UI design, section 7.5). The page's body does not scroll: each list scrolls in
 * its own node, so the browser's scroll restoration does not apply and korbat keeps the place itself. The list records
 * the row at the top of its view and where that row's top is in the list's content. When the content changes above it
 * (new posts put above, rows above drawn at their real height instead of FlatList's estimate, a header growing), the
 * keeper moves the scroll position by exactly the change before the frame is painted, so the row stays where the reader
 * sees it. It watches the scroll node's children with a MutationObserver (rows added or removed, a spacer resized) and
 * the content's size with a ResizeObserver (an image or a font arriving), and turns off the browser's own anchoring
 * (overflow-anchor), so the two never correct twice. At the very top of the list nothing is corrected, as the browser
 * does too, so a header or the reader's own new post can push the rows down, unless the caller asks to keep the row for
 * the next change (new posts from a poll, which never move what the reader reads). The arithmetic is pure and tested
 * (test/anchor.test.ts); native leaves all of it to FlatList (anchor.ts).
 *
 * The keeper also does the feed pattern's keys (section 10): Page Down and Page Up move the focus to the next or the
 * previous article's open link; and when a row that held the focus is removed (a deleted post), the focus goes to the
 * next row's open link, or to the screen's title when none is left, instead of falling to the page.
 */

/** A row of the list in the list's content: its key, its top and its height, in px. */
export interface RowBox {
  key: string;
  top: number;
  height: number;
}

/** A row and how far its top is below the view's top line (negative once it has started to scroll out). */
export interface ViewAnchor {
  key: string;
  offset: number;
}

/** The first row with at least one pixel below the view's top line `line` (the scroll position plus a floating header's room). */
export function rowAtTop(rows: readonly RowBox[], line: number): RowBox | null {
  return rows.find((row) => row.top + row.height - line >= 1) ?? null;
}

/** Where a row sits in the view, for keeping it when the list comes back. */
export function viewAnchor(row: RowBox, scrollTop: number, inset: number): ViewAnchor {
  return { key: row.key, offset: row.top - (scrollTop + inset) };
}

/** The scroll position that keeps a row on screen after its top in the content moved from `before` to `after`. */
export function anchoredScroll(scrollTop: number, before: number, after: number): number {
  return Math.max(0, scrollTop + after - before);
}

/** The scroll position that shows a row `offset` below the view's top line, within what the list can scroll. */
export function scrollToShow(rowTop: number, inset: number, offset = 0, max = Number.POSITIVE_INFINITY): number {
  return Math.min(Math.max(0, rowTop - inset - offset), Math.max(0, max));
}

/** What the keeper needs from the list. */
export interface AnchorTarget {
  /** The list's scroll node (FlatList's getScrollableNode() on the web), or null before it mounts. */
  node(): unknown;
  /** The room at the top of the view under a floating header (the list's paddingTop on a phone). */
  inset(): number;
  /** A row's index in the list's data, or -1. */
  indexOf(key: string): number;
  /** FlatList's scrollToIndex, which draws a row that is not drawn yet. */
  scrollToIndex(index: number, viewOffset: number, animated: boolean): void;
  /** The row at the top changed (the reading place's top, the pill's count). */
  onTop?(key: string | null): void;
  /** Page Down and Page Up move between articles (a feed). */
  feed?: boolean;
}

export interface AnchorKeeper {
  /** Finds the list's scroll node and starts watching it, once it is mounted. */
  attach(): void;
  /** After a scroll: the row now at the top is the anchor. */
  record(): void;
  /** Shows a row at the top, `offset` below the view's top line, and keeps it there as rows around it are drawn. */
  hold(key: string, offset?: number): void;
  /** The next change keeps the row at the top where it is, even at the very top of the list. */
  keepNext(): void;
  /** The next change is not corrected: the reader's own new post pushes the rows down. */
  releaseNext(): void;
  /** Scrolls until a row's top is at the view's top line: smooth, or at once. */
  jumpTo(key: string, animated: boolean): void;
  /** Scrolls to the first row (the soft reset); false where the keeper has no node to scroll (native). */
  toTop(animated: boolean): boolean;
  /**
   * Whether a scroll event at `y` is the keeper's own (a held row placed, a correction): the shell then neither hides nor
   * shows the phone's header, which follows the reader's scrolling only.
   */
  ownScroll(y: number): boolean;
  /**
   * The row at the top and its offset when the reader last scrolled (or a held row was placed), for the feed cache. It is
   * kept rather than measured, so it still holds while the list draws what replaces its rows (a tab change).
   */
  view(): ViewAnchor | null;
  dispose(): void;
}

/** Native's FlatList prop; the web needs none, the keeper does it. */
export const ANCHOR_PROPS = {};

/** How many times a held row that is not drawn yet is asked for before the hold gives up. */
const HOLD_TRIES = 30;

/** A row key inside an attribute selector: CSS.escape, or, without it, the key with anything but word characters, : and - left out (row keys are ids). */
const escape = (key: string): string => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/[^\w:-]/g, ""));

/** The screen's level-1 heading, made focusable for this once (section 10: focus after a delete with nothing left). */
function focusTitle(): void {
  const title = document.querySelector<HTMLElement>("main h1");
  if (!title) return;
  if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
  title.focus();
}

export function keepAnchor(target: AnchorTarget): AnchorKeeper {
  let node: HTMLElement | null = null;
  /** The anchor row and its top in the content when last seen. */
  let anchor: { key: string; top: number } | null = null;
  let hold: { key: string; offset: number; tries: number } | null = null;
  let next: "normal" | "keep" | "release" = "normal";
  let nextUntil = 0;
  let jumping: ReturnType<typeof setTimeout> | null = null;
  let topKey: string | null = null;
  let last: ViewAnchor | null = null;
  /** Where the keeper last set the scroll position itself, until the scroll event that reports it. */
  let ownAt: number | null = null;
  /** The element that last took the focus inside the list, to see that a removed row held it. */
  let focused: Element | null = null;
  let observers: { disconnect(): void }[] = [];
  const stopHold = () => {
    hold = null;
  };

  const rowTop = (element: Element): number => element.getBoundingClientRect().top - node!.getBoundingClientRect().top + node!.scrollTop;
  const find = (key: string): HTMLElement | null => node!.querySelector<HTMLElement>(`[data-row="${escape(key)}"]`);
  const maxScroll = () => node!.scrollHeight - node!.clientHeight;

  function rows(): RowBox[] {
    const base = node!.getBoundingClientRect().top - node!.scrollTop;
    return [...node!.querySelectorAll<HTMLElement>("[data-row]")].map((element) => {
      const box = element.getBoundingClientRect();
      return { key: element.getAttribute("data-row") ?? "", top: box.top - base, height: box.height };
    });
  }

  function attach(): HTMLElement | null {
    const found = (target.node() as HTMLElement | null) ?? null;
    if (found === node) return node;
    detach();
    node = found;
    if (!node) return null;
    node.style.overflowAnchor = "none";
    const content = (node.firstElementChild as HTMLElement | null) ?? node;
    const mutations = new MutationObserver((records) => {
      refocus(records);
      settle();
    });
    mutations.observe(content, { childList: true, attributes: true, attributeFilter: ["style"] });
    const sizes = new ResizeObserver(settle);
    sizes.observe(content);
    sizes.observe(node);
    observers = [mutations, sizes];
    // The reader's own scroll ends a hold or a jump: what they do wins.
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) node.addEventListener(name, stopHold, { passive: true });
    if (target.feed) node.addEventListener("keydown", pageKeys);
    node.addEventListener("focusin", noteFocus);
    return node;
  }

  function noteFocus(event: FocusEvent): void {
    focused = event.target as Element | null;
  }

  /**
   * A removed row that held the focus (a deleted post, removed after its fade): the focus goes to the open link of the
   * next row that has one, else to the screen's title, rather than falling to the page's body.
   */
  function refocus(records: MutationRecord[]): void {
    const active = document.activeElement;
    if (!focused || (active !== null && active !== document.body)) return;
    for (const record of records) {
      if (![...record.removedNodes].some((removed) => removed === focused || removed.contains(focused))) continue;
      focused = null;
      for (let sibling = record.nextSibling; sibling; sibling = sibling.nextSibling) {
        const link = sibling instanceof HTMLElement ? sibling.querySelector<HTMLElement>("[data-open]") : null;
        if (link) {
          link.focus();
          return;
        }
      }
      focusTitle();
      return;
    }
  }

  function detach(): void {
    for (const observer of observers) observer.disconnect();
    observers = [];
    if (!node) return;
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"]) node.removeEventListener(name, stopHold);
    node.removeEventListener("keydown", pageKeys);
    node.removeEventListener("focusin", noteFocus);
  }

  function record(): void {
    // While a row is held, the hold says where the anchor is; the top is reported once it is in place.
    if (!attach() || hold) return;
    const row = rowAtTop(rows(), node!.scrollTop + target.inset());
    anchor = row ? { key: row.key, top: row.top } : null;
    last = row ? viewAnchor(row, node!.scrollTop, target.inset()) : null;
    const key = row?.key ?? null;
    if (key !== topKey) {
      topKey = key;
      target.onTop?.(key);
    }
  }

  /** Sets the scroll position, marking the scroll event it causes as the keeper's own. */
  function setScroll(y: number): void {
    node!.scrollTop = y;
    ownAt = node!.scrollTop;
  }

  function endHold(): void {
    hold = null;
    record();
  }

  function settle(): void {
    if (!node) return;
    if (hold) {
      const element = find(hold.key);
      if (!element) {
        // Not drawn yet: FlatList draws it when asked to scroll to it, from its estimate; the next change measures it.
        const index = target.indexOf(hold.key);
        if (index < 0 || hold.tries++ >= HOLD_TRIES) endHold();
        else target.scrollToIndex(index, target.inset() + hold.offset, false);
        return;
      }
      const wanted = scrollToShow(rowTop(element), target.inset(), hold.offset, maxScroll());
      if (Math.abs(node.scrollTop - wanted) >= 0.5) setScroll(wanted);
      anchor = { key: hold.key, top: rowTop(element) };
      // Held until it sits where it should, or it cannot (the list is too short to scroll that far yet, a few tries).
      const exact = Math.abs(rowTop(element) - target.inset() - hold.offset - node.scrollTop) < 1;
      if (exact || hold.tries++ >= HOLD_TRIES) endHold();
      return;
    }
    if (jumping) return;
    if (!anchor) {
      record();
      return;
    }
    const element = find(anchor.key);
    if (!element) {
      // Its row was removed, or scrolled out of what FlatList draws: the row now at the top is the anchor.
      record();
      return;
    }
    const top = rowTop(element);
    const moved = Math.abs(top - anchor.top) >= 0.5;
    // A keep or a release lasts until the change it was asked for moves the row (another change may come first, such as
    // FlatList drawing a batch), or a second has gone by.
    const mode = next !== "normal" && Date.now() < nextUntil ? next : "normal";
    if (moved && mode !== "normal") next = "normal";
    // At the very top nothing is corrected, so what is put above shows, unless the caller keeps the row for this change.
    const correct = mode === "keep" || (mode === "normal" && node.scrollTop > 0);
    if (correct && moved) setScroll(anchoredScroll(node.scrollTop, anchor.top, top));
    anchor = { key: anchor.key, top: rowTop(element) };
  }

  /** Scrolls to `y`: at once, or smoothly, and while a smooth scroll runs nothing is corrected, which would stop it halfway. */
  function scrollTo(y: number, animated: boolean): void {
    if (!animated) {
      node!.scrollTop = y;
      return;
    }
    const done = () => {
      if (jumping) clearTimeout(jumping);
      jumping = null;
      record();
    };
    if (jumping) clearTimeout(jumping);
    // It ends with scrollend, or a second goes by.
    jumping = setTimeout(done, 1000);
    node!.addEventListener("scrollend", done, { once: true });
    // The element's own scroll(): react-native-web gives a list's node a scrollTo() of its own, which reads { x, y }.
    node!.scroll({ top: y, behavior: "smooth" });
  }

  /** Page Down and Page Up: the next or previous article's open link takes the focus; elsewhere the keys scroll. */
  function pageKeys(event: KeyboardEvent): void {
    if (event.key !== "PageDown" && event.key !== "PageUp") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const articles = [...node!.querySelectorAll<HTMLElement>('[role="article"]')].filter((article) => article.querySelector("[data-open]"));
    if (articles.length === 0) return;
    const current = (document.activeElement as HTMLElement | null)?.closest?.('[role="article"]') ?? null;
    let at = current ? articles.indexOf(current as HTMLElement) : -1;
    if (at < 0) {
      // From outside an article: the first one whose bottom is in view.
      const line = node!.getBoundingClientRect().top + target.inset();
      at = articles.findIndex((article) => article.getBoundingClientRect().bottom > line + 1);
      if (at < 0) return;
      if (event.key === "PageDown") at -= 1;
      else at += 1;
    }
    const goal = articles[event.key === "PageDown" ? at + 1 : at - 1];
    if (!goal) return;
    event.preventDefault();
    goal.querySelector<HTMLElement>("[data-open]")?.focus();
  }

  return {
    attach: () => void attach(),
    record,
    hold(key, offset = 0) {
      hold = { key, offset, tries: 0 };
      if (attach()) settle();
    },
    keepNext() {
      next = "keep";
      nextUntil = Date.now() + 1000;
      record();
    },
    releaseNext() {
      next = "release";
      nextUntil = Date.now() + 1000;
      record();
    },
    jumpTo(key, animated) {
      if (!attach()) return;
      hold = null;
      const element = find(key);
      if (!element) {
        const index = target.indexOf(key);
        if (index >= 0) target.scrollToIndex(index, target.inset(), animated);
        return;
      }
      scrollTo(scrollToShow(rowTop(element), target.inset(), 0, maxScroll()), animated);
    },
    toTop(animated) {
      if (!attach()) return false;
      hold = null;
      scrollTo(0, animated);
      return true;
    },
    view: () => last,
    ownScroll(y) {
      const own = ownAt !== null && Math.abs(y - ownAt) < 1;
      ownAt = null;
      return own;
    },
    dispose() {
      if (jumping) clearTimeout(jumping);
      detach();
      node = null;
    },
  };
}
