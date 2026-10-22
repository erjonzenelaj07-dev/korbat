import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Link, type Href } from "expo-router";
import type { IconName } from "@/components/icons";
import { useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { Icon } from "./Icon";
import { IconButton, type IconButtonProps } from "./IconButton";
import { FOCUS_RING_INSET, HOVER_WASH, dataAttribute, lastInputWasKeyboard, pressDelay } from "./interaction";
import { measureNode, type Rect } from "./measure";
import { Sheet, SheetFrame, type SheetLayout } from "./Sheet";
import { Text } from "./Text";

/**
 * A menu (UI design, section 6.9): a disclosure, not an ARIA menu. Its trigger is an IconButton that says it opens a menu
 * and whether it is open; its content is a list of buttons and real links, so a link stays an anchor and Tab moves
 * through them, and on the web the arrow keys move between them too. Below 768 px the content is a Sheet titled by the
 * trigger's label; from 768 px a popover of surface-1 under its trigger, flipped to stay inside the window, growing from
 * the trigger's corner (scale 0.97 to 1 and opacity, 160 ms in, 120 ms out; reduced or opened from the keyboard, opacity
 * only). Escape and a press outside close it, and the focus goes back to the trigger. An item's action runs once the menu
 * has closed and given the focus back, so an item that opens a sheet or asks a question takes the focus from there.
 */
export type MenuItem = {
  /** The item's name and its visible words. */
  label: string;
  icon: IconName;
  /** danger for Delete. */
  tone?: "danger";
  /** One line under the label (Who sees this). */
  description?: string;
} & ({ onSelect: () => void; href?: undefined } | { href: Href; onSelect?: undefined });

/**
 * Where the arrow keys move the focus among `count` items from `current` (-1 when none holds it): down and up wrap, Home
 * and End jump; any other key moves nothing (null).
 */
export function menuIndex(current: number, key: string, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export interface Placement {
  left: number;
  top: number;
  /** The corner it grows from, as a CSS transform-origin: the trigger's side of it. */
  origin: "top right" | "top left" | "bottom right" | "bottom left";
}

/** The space kept between the popover and its trigger, and between it and the window's edges, in px. */
const GAP = 4;
const MARGIN = 8;

/**
 * Where the popover goes: under its trigger with its right edge at the trigger's (the post's More sits at the end of its
 * row); from the trigger's left edge when that would leave the window; above the trigger when there is no room under it;
 * and never past the window's edges.
 */
export function placeMenu(trigger: Rect, panel: { width: number; height: number }, window: { width: number; height: number }): Placement {
  let left = trigger.x + trigger.width - panel.width;
  let horizontal: "left" | "right" = "right";
  if (left < MARGIN) {
    left = trigger.x;
    horizontal = "left";
  }
  left = Math.max(MARGIN, Math.min(left, window.width - MARGIN - panel.width));
  let top = trigger.y + trigger.height + GAP;
  let vertical: "top" | "bottom" = "top";
  if (top + panel.height > window.height - MARGIN) {
    const above = trigger.y - GAP - panel.height;
    if (above >= MARGIN) {
      top = above;
      vertical = "bottom";
    }
  }
  top = Math.max(MARGIN, Math.min(top, window.height - MARGIN - panel.height));
  return { left, top, origin: `${vertical} ${horizontal}` };
}

/** One item: a button, or a real link for an item with an href; 48 px tall at least, the hover and pressed wash, the ring inside. */
function MenuRow({ item, onPick, popover }: { item: MenuItem; onPick: (item: MenuItem) => void; popover: boolean }) {
  const danger = item.tone === "danger";
  const row = cn("min-h-[48px] flex-row items-center gap-3 px-4 py-2.5 active:bg-surface-2", popover ? "rounded-control" : "", HOVER_WASH, FOCUS_RING_INSET);
  const body = (
    <>
      <Icon name={item.icon} size={20} tone={danger ? "danger" : "medium"} />
      <View className="min-w-0 flex-1">
        <Text variant="body-strong" tone={danger ? "danger" : "high"}>
          {item.label}
        </Text>
        {item.description ? (
          <Text variant="meta" tone="low">
            {item.description}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (item.href !== undefined) {
    return (
      <Link href={item.href} onPress={() => onPick(item)} asChild>
        <Pressable {...dataAttribute("menuItem")} {...pressDelay(0)} className={row}>
          {body}
        </Pressable>
      </Link>
    );
  }
  return (
    <Pressable accessibilityRole="button" {...dataAttribute("menuItem")} {...pressDelay(0)} onPress={() => onPick(item)} className={row}>
      {body}
    </Pressable>
  );
}

/** The items in order, with the arrow keys on the web. */
function MenuList({ items, onPick, popover }: { items: readonly MenuItem[]; onPick: (item: MenuItem) => void; popover: boolean }) {
  const list = useRef<View>(null);
  const keys = (event: KeyboardEvent) => {
    const node = list.current as unknown as HTMLElement | null;
    if (!node) return;
    const rows = [...node.querySelectorAll<HTMLElement>("[data-menu-item]")];
    const next = menuIndex(rows.indexOf(document.activeElement as HTMLElement), event.key, rows.length);
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  };
  return (
    <View ref={list} {...(Platform.OS === "web" ? ({ onKeyDown: keys } as object) : {})} className={popover ? "gap-0.5" : ""}>
      {items.map((item) => (
        <MenuRow key={item.label} item={item} onPick={onPick} popover={popover} />
      ))}
    </View>
  );
}

/**
 * The menu drawn open, as the render tests draw it: on a phone the sheet's frame titled by the trigger's label, wider the
 * popover's panel named by it.
 */
export function MenuPanel({ label, items, layout, onPick }: { label: string; items: readonly MenuItem[]; layout: SheetLayout; onPick: (item: MenuItem) => void }) {
  if (layout === "phone") {
    return (
      <SheetFrame titleId="menu-title" title={label} layout="phone" onClose={() => undefined}>
        <MenuList items={items} onPick={onPick} popover={false} />
      </SheetFrame>
    );
  }
  return <PopoverPanel label={label} items={items} onPick={onPick} />;
}

function PopoverPanel({ label, items, onPick }: { label: string; items: readonly MenuItem[]; onPick: (item: MenuItem) => void }) {
  return (
    <View {...dataAttribute("menu")} role="group" aria-label={label} className="w-[280px] rounded-card border border-line-high bg-surface-1 p-1.5 web:forced-colors:border-[color:CanvasText]">
      <MenuList items={items} onPick={onPick} popover />
    </View>
  );
}

/** The popover from 768 px: in a Modal, above everything, with a layer under it that closes it on a press outside. */
function Popover({ open, close, closed, trigger, label, items, onPick }: { open: boolean; close: () => void; closed: () => void; trigger: RefObject<View | null>; label: string; items: readonly MenuItem[]; onPick: (item: MenuItem) => void }) {
  const motion = useMotion();
  const screen = useWindowDimensions();
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const [place, setPlace] = useState<Placement | null>(null);
  const rect = useRef<Rect | null>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const panel = useRef<View>(null);
  const fade = useSharedValue(0);
  const scale = useSharedValue(0.97);
  const still = useSharedValue(0);

  const hide = () => {
    // The panel leaves with the Modal, so its size is measured again on the next opening.
    size.current = null;
    setShown(false);
  };
  const position = () => {
    if (rect.current && size.current) setPlace(placeMenu(rect.current, size.current, screen));
  };

  useEffect(() => {
    if (open) {
      still.value = motion.reduced || lastInputWasKeyboard() ? 1 : 0;
      fade.value = 0;
      scale.value = still.value === 1 ? 1 : 0.97;
      setPlace(null);
      measureNode(trigger.current, (found) => {
        rect.current = found;
        position();
      });
    } else if (shown) {
      // It shrinks back into the trigger it grew from, along the same path.
      const done = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(hide)();
      };
      if (still.value === 0) scale.value = withTiming(0.97, motion.timing("easeOut", 120));
      fade.value = withTiming(0, motion.timing("easeOut", 120), done);
    }
  }, [open]);

  // Placed: it grows in, and the first item takes the focus.
  useEffect(() => {
    if (!open || place === null) return;
    fade.value = withTiming(1, motion.timing("easeOut", 160));
    if (still.value === 0) scale.value = withTiming(1, motion.timing("easeOut", 160));
    if (Platform.OS !== "web") return;
    const frame = requestAnimationFrame(() => (panel.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>("[data-menu-item]")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [place]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    size.current = { width, height };
    position();
  };
  const style = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ scale: scale.value }] }));

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={close} onDismiss={closed} aria-label={label}>
      <View style={StyleSheet.absoluteFill}>
        {Platform.OS === "web" ? (
          <View aria-hidden {...({ onClick: close } as object)} style={StyleSheet.absoluteFill} />
        ) : (
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={close} style={StyleSheet.absoluteFill} />
        )}
        {/* Unplaced, it is laid out where it cannot be seen, so its size is known before it shows. */}
        <Animated.View style={[{ position: "absolute", left: place?.left ?? 0, top: place?.top ?? -10000, transformOrigin: place?.origin ?? "top right" }, style]}>
          <View ref={panel} onLayout={onLayout}>
            <PopoverPanel label={label} items={items} onPick={onPick} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface MenuProps {
  /** The trigger's name, and the sheet's title on a phone unless `title` says otherwise. */
  label: string;
  icon: IconName;
  items: readonly MenuItem[];
  title?: string;
  /** The trigger's other looks and states (a count, pressed, the reposted disc, its feedback). */
  trigger?: Omit<IconButtonProps, "icon" | "label" | "onPress" | "hasPopup" | "expanded" | "ref">;
  /** The trigger's ref, for an owner that moves the focus to it (the post's delete question gives it back to More). */
  triggerRef?: RefObject<View | null>;
  /** Called as the menu opens; answer false to open nothing (a reader sent to sign in instead). */
  onOpen?: () => boolean | void;
}

export function Menu({ label, icon, items, title, trigger: triggerLook, triggerRef, onOpen }: MenuProps) {
  const layout: SheetLayout = useLayout() === "phone" ? "phone" : "wide";
  const own = useRef<View>(null);
  const trigger = triggerRef ?? own;
  const [open, setOpen] = useState(false);
  // Mounted from the press until it has closed: react-native-web's Modal adds an element to the page as it mounts, so a
  // list of cards keeps none for the menus nobody opened.
  const [mounted, setMounted] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const close = () => setOpen(false);
  const pick = (item: MenuItem) => {
    pending.current = item.onSelect ?? null;
    setOpen(false);
  };
  // Closed: the focus goes back to the trigger, then the chosen item acts, and may take the focus from there.
  const closed = () => {
    setMounted(false);
    trigger.current?.focus();
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const press = () => {
    if (onOpen?.() === false) return;
    setMounted(true);
    setOpen(true);
  };

  let content: ReactNode = null;
  if (mounted && layout === "phone") {
    content = (
      <Sheet open={open} onClose={close} onClosed={closed} title={title ?? label} initialFocus="first">
        <MenuList items={items} onPick={pick} popover={false} />
      </Sheet>
    );
  } else if (mounted) {
    content = <Popover open={open} close={close} closed={closed} trigger={trigger} label={title ?? label} items={items} onPick={pick} />;
  }
  return (
    <>
      <IconButton {...triggerLook} ref={trigger} icon={icon} label={label} hasPopup="menu" expanded={open} onPress={press} />
      {content}
    </>
  );
}
