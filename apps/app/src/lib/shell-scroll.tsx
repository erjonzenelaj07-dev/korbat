import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useMotion } from "./motion";

/**
 * What a screen's list and the shell tell each other while the list scrolls (UI design, sections 5.2, 7.1 and 7.2;
 * review ruling 8). AppShell provides it, one per screen. On a phone the screen's header slides up out of view as the
 * list scrolls down past it and comes back on any scroll up, or when the focus enters it (header-hide: 200 ms ease-out,
 * reversing from where it is; under reduced motion it stays). From 768 px the header stays and draws a line-low rule
 * once the list has scrolled. Pressing the current Home item again brings the list to its newest post (the soft reset,
 * smooth, or at once under reduced motion), without reloading it. Task 5 moves the list's side of this onto List.
 */

/**
 * Where the header should be, as a translateY in px (0 shown, minus its height hidden), after the list moved from
 * `previousY` to `y`: scrolling down past the header's height hides it, any scroll up shows it, the top of the list (or
 * an overscroll above it) always shows it, and anything else keeps `offset`, where it is now.
 */
export function headerOffset({ previousY, y, height, offset }: { previousY: number; y: number; height: number; offset: number }): number {
  if (height <= 0 || y <= 0) return 0;
  if (y < previousY) return 0;
  if (y > previousY && y > height) return -height;
  return offset;
}

/** A list the shell can bring to its top. */
export interface ScrollTarget {
  toTop(animated: boolean): void;
}

/** What the store asks of the screen: move the header to an offset, and say whether the list has left its top. */
export interface ShellScrollHooks {
  moveHeader(offset: number): void;
  markScrolled(scrolled: boolean): void;
}

/**
 * The shell's scroll state for one screen, apart from React so it can be driven in a test: the header's offset, the
 * list's last position and the one list registered for the soft reset. `settings` is the shell's current layout and
 * motion: `hides` on a phone without reduced motion.
 */
export function createShellScroll(hooks: ShellScrollHooks) {
  let target: ScrollTarget | null = null;
  let previousY = 0;
  let offset = 0;
  let height = 0;
  let scrolled = false;
  const store = {
    settings: { hides: false, reduced: false },
    setHeight(next: number): void {
      height = next;
    },
    onScroll(y: number): void {
      const next = store.settings.hides ? headerOffset({ previousY, y, height, offset }) : 0;
      previousY = y;
      if (next !== offset) {
        offset = next;
        hooks.moveHeader(next);
      }
      if (y > 0 !== scrolled) {
        scrolled = y > 0;
        hooks.markScrolled(scrolled);
      }
    },
    /** Brings the header back, wherever the list is: the focus entered it, or the list goes to its top. */
    show(): void {
      if (offset === 0) return;
      offset = 0;
      hooks.moveHeader(0);
    },
    /** The list that the soft reset scrolls; the function returned forgets it, if it is still the one. */
    register(list: ScrollTarget): () => void {
      target = list;
      return () => {
        if (target === list) target = null;
      };
    },
    /** Scrolls the registered list to its top, smooth unless motion is reduced; false when no list is registered. */
    toTop(): boolean {
      if (target === null) return false;
      store.show();
      target.toTop(!store.settings.reduced);
      return true;
    },
  };
  return store;
}

export type ShellScrollStore = ReturnType<typeof createShellScroll>;

/**
 * The current Home item pressed again: the feed goes to its newest post, and the link does not navigate, so the tab, the
 * reader's marker and the new-posts pill stay as they are (section 7.1).
 */
export function softReset(event: { preventDefault(): void }, scroll: Pick<ShellScrollStore, "toTop">): void {
  event.preventDefault();
  scroll.toTop();
}

export interface ShellScroll {
  /** The list's onScroll. */
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
  /** Registers the list for the soft reset; returns the function that forgets it (an effect's cleanup). */
  register(list: ScrollTarget): () => void;
  toTop(): boolean;
  /** The focus entered the header: show it. */
  showHeader(): void;
  setHeaderHeight(height: number): void;
  /** On a phone the header floats over the list, which starts this far down so its first row is not under it. */
  headerSpace: number;
  /** The header's translateY, which ScreenHeader animates on a phone. */
  headerY: SharedValue<number>;
  /** The list has left its top: from 768 px the header draws its rule. */
  scrolled: boolean;
  phone: boolean;
}

const noop = () => undefined;

/** Outside a shell nothing scrolls the header: a list rendered on its own keeps working. */
const OUTSIDE: ShellScroll = {
  onScroll: noop,
  register: () => noop,
  toTop: () => false,
  showHeader: noop,
  setHeaderHeight: noop,
  headerSpace: 0,
  headerY: { value: 0 } as SharedValue<number>,
  scrolled: false,
  phone: false,
};

const ShellScrollContext = createContext<ShellScroll>(OUTSIDE);

export function useShellScroll(): ShellScroll {
  return useContext(ShellScrollContext);
}

/** The header-hide's movement: 200 ms on ease-out, from wherever the header is (section 5.2). */
const HIDE_MS = 200;

export function ShellScrollProvider({ phone, children }: { phone: boolean; children: ReactNode }) {
  const motion = useMotion();
  const headerY = useSharedValue(0);
  const [scrolled, setScrolled] = useState(false);
  const [height, setHeight] = useState(0);
  // The latest motion, read when the store moves the header, which it does from a scroll event and not a render.
  const latest = useRef(motion);
  latest.current = motion;
  const [store] = useState(() =>
    createShellScroll({
      moveHeader: (offset) => {
        headerY.value = latest.current.reduced ? offset : withTiming(offset, latest.current.timing("easeOut", HIDE_MS));
      },
      markScrolled: setScrolled,
    }),
  );
  store.settings = { hides: phone && !motion.reduced, reduced: motion.reduced };
  // A header hidden on a phone comes back when the window widens or motion becomes reduced.
  useEffect(() => {
    if (!phone || motion.reduced) store.show();
  }, [phone, motion.reduced, store]);

  const value = useMemo<ShellScroll>(
    () => ({
      onScroll: (event) => store.onScroll(event.nativeEvent.contentOffset.y),
      register: store.register,
      toTop: store.toTop,
      showHeader: store.show,
      setHeaderHeight: (next) => {
        store.setHeight(next);
        setHeight(next);
      },
      headerSpace: phone ? height : 0,
      headerY,
      scrolled,
      phone,
    }),
    [store, phone, height, headerY, scrolled],
  );
  return <ShellScrollContext.Provider value={value}>{children}</ShellScrollContext.Provider>;
}
