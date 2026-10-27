import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "@/components/GestureRoot";
import { useHaptics } from "@/lib/haptics";
import { releaseCloses, rubberBand, useMotion } from "@/lib/motion";
import { cn } from "@/theme/cn";
import { useLayout } from "@/theme/layout";
import { FIXED_COLOURS } from "@/theme/tokens";
import { DragArea, type DragHandlers } from "./DragArea";
import { FOCUS_RING, dataAttribute, lastInputWasKeyboard } from "./interaction";
import { Text } from "./Text";

/**
 * A sheet (UI design, sections 5.2 and 6.8): below 768 px a bottom sheet with a grab handle, which comes up from the
 * bottom, follows the finger down and rubber-bands up, and closes on a release whose momentum carries it past half its
 * height; from 768 px the same content as a centred dialog, 560 px wide, that grows from 0.96. Under reduced motion, and
 * when opened from the keyboard, it fades in 150 ms and moves not at all. The first users are the post's menus and Who
 * sees this; the composer (Task 6) is the first to pass its own width (640) and to ask its own question before closing.
 *
 * React Native's Modal holds it. On the web react-native-web draws the Modal's content as the dialog itself (role
 * "dialog", aria-modal), traps the focus inside, closes on Escape through onRequestClose and gives the focus back to the
 * element that had it when the Modal opened; the Sheet hands it the title's id for its name, moves the focus to the
 * title (or a menu's first item) once it is open, and puts a scrim behind it that closes it on a press but is no tab stop.
 * The Modal renders nothing on a server, so SheetFrame, what it holds, is exported for the render tests to draw open.
 */
export type SheetLayout = "phone" | "wide";

/** A fixed colour of tokens.ts as CSS, for the scrim and the lightbox's stage, which every theme shares. */
export function fixedColour(name: keyof typeof FIXED_COLOURS): string {
  const [r, g, b, a] = FIXED_COLOURS[name];
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Where a sheet waits before its height is known: below any screen. */
const OFFSCREEN = 4000;

export interface SheetFrameProps {
  titleId: string;
  title: string;
  description?: string;
  layout: SheetLayout;
  /** tall takes up to 90 percent of the window's height on a phone; auto, what its content needs, up to 85. */
  size?: "auto" | "tall";
  /** The dialog's width from 768 px (560; the composer, 640). */
  width?: number;
  /** A press on the scrim. */
  onClose: () => void;
  children: ReactNode;
  /** The motion and the drag, which Sheet gives; a render test draws the frame without them, open and still. */
  panelStyle?: object;
  scrimStyle?: object;
  drag?: DragHandlers;
  titleRef?: RefObject<View | null>;
  panelRef?: RefObject<View | null>;
  onPanelLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * What the Modal holds: the panel first, then the scrim, which sits behind it. The order matters on the web, where
 * react-native-web's focus trap gives the focus to the first element in it that takes one; the scrim takes none.
 */
export function SheetFrame({ titleId, title, description, layout, size = "auto", width = 560, onClose, children, panelStyle, scrimStyle, drag, titleRef, panelRef, onPanelLayout }: SheetFrameProps) {
  const phone = layout === "phone";
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const share = phone && size === "tall" ? 0.9 : 0.85;
  // On the web the share of the visual viewport (dvh), so a sheet shrinks above the on-screen keyboard (section 7.4).
  const maxHeight = Platform.OS === "web" ? (`${Math.round(share * 100)}dvh` as unknown as number) : screen.height > 0 ? Math.round(screen.height * share) : undefined;
  const header = (
    // A phone's sheet has its handle above the title; a dialog's title keeps clear of its 24 px corners instead.
    <View className={phone ? "px-5 pb-3 pt-2" : "px-5 pb-3 pt-5"}>
      {phone ? <View {...dataAttribute("handle")} aria-hidden className="mb-3 h-1 w-9 self-center rounded-full bg-line-high" /> : null}
      {/* The title takes the focus when the sheet opens, so a screen reader starts at its name; it is no tab stop. */}
      <View ref={titleRef} tabIndex={-1} className={cn("self-start rounded-control", FOCUS_RING)}>
        <Text as="h2" variant="title" nativeID={titleId}>
          {title}
        </Text>
      </View>
      {description ? (
        <Text tone="medium" className="mt-1">
          {description}
        </Text>
      ) : null}
    </View>
  );
  return (
    <View style={StyleSheet.absoluteFill} className={phone ? "justify-end" : "items-center justify-center px-4"}>
      <Animated.View style={[{ zIndex: 1, width: phone ? "100%" : Math.min(width, Math.max(0, screen.width - 32) || width) }, panelStyle]}>
        <View
          ref={panelRef}
          onLayout={onPanelLayout}
          className={cn("overflow-hidden border border-line-high bg-surface-1 web:forced-colors:border-[color:CanvasText]", phone ? "rounded-t-sheet border-b-0" : "rounded-sheet")}
          style={{ maxHeight, paddingBottom: phone ? 12 + insets.bottom : 12 }}
        >
          {phone && drag ? <DragArea {...drag}>{header}</DragArea> : header}
          <ScrollView bounces={false}>{children}</ScrollView>
        </View>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 0, backgroundColor: fixedColour("scrim") }, scrimStyle]}>
        {Platform.OS === "web" ? (
          // A plain element with a click: no role, no tab stop, hidden, so neither the keyboard nor a screen reader meets it.
          <View {...dataAttribute("scrim")} aria-hidden {...({ onClick: onClose } as object)} style={StyleSheet.absoluteFill} />
        ) : (
          <Pressable accessible={false} importantForAccessibility="no-hide-descendants" onPress={onClose} style={StyleSheet.absoluteFill} />
        )}
      </Animated.View>
    </View>
  );
}

export interface SheetProps {
  open: boolean;
  /** The reader asks to close: the scrim, Escape, a drag past the threshold. */
  onClose: () => void;
  /** The sheet has left the screen and the focus is back with its opener: a menu runs the item chosen from it now. */
  onClosed?: () => void;
  title: string;
  description?: string;
  /** false keeps it open on the scrim, Escape and a drag (a sheet with its own question first). */
  dismissible?: boolean;
  size?: "auto" | "tall";
  width?: number;
  /**
   * What takes the focus on opening: the title (default), or the first control, as a menu's first item; 3b Task 7: or
   * "marked", the element inside marked data-sheet-focus (Who sees this opened at its provenance paragraph, 10.6).
   */
  initialFocus?: "title" | "first" | "marked";
  children: ReactNode;
}

/**
 * Room for the on-screen keyboard (section 7.4): natively React Native's KeyboardAvoidingView, until sub-project 5 brings
 * react-native-keyboard-controller; on the web nothing, since the sheet's height follows the visual viewport (dvh).
 */
function KeyboardRoom({ children }: { children: ReactNode }) {
  if (Platform.OS === "web") return <>{children}</>;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      {children}
    </KeyboardAvoidingView>
  );
}

/** The focusable elements of a menu or a form, in order, for the "first" focus. */
const FOCUSABLE = '[data-menu-item], a[href], button, input, textarea, [tabindex="0"]';

export function Sheet({ open, onClose, onClosed, title, description, dismissible = true, size = "auto", width = 560, initialFocus = "title", children }: SheetProps) {
  const layout: SheetLayout = useLayout() === "phone" ? "phone" : "wide";
  const motion = useMotion();
  const haptic = useHaptics();
  const titleId = useId();
  const [shown, setShown] = useState(open);
  // Opening shows the Modal in the same render; closing waits for the motion to end.
  if (open && !shown) setShown(true);

  const titleRef = useRef<View>(null);
  const panelRef = useRef<View>(null);
  const height = useRef(0);
  const laidOut = useRef(false);
  const releaseVelocity = useRef(0);
  const openNow = useRef(open);
  openNow.current = open;
  const closedHandler = useRef(onClosed);
  closedHandler.current = onClosed;

  const y = useSharedValue(0);
  const fade = useSharedValue(0);
  const scale = useSharedValue(1);
  // 1 when this opening takes the reduced form (a fade): read inside the animated style, where a ref cannot be.
  const still = useSharedValue(0);
  const phone = layout === "phone";

  const hide = () => {
    laidOut.current = false;
    setShown(false);
  };

  const enter = () => {
    if (still.value === 1) {
      y.value = 0;
      scale.value = 1;
      fade.value = withTiming(1, motion.timing("fade"));
      return;
    }
    fade.value = withTiming(1, motion.timing("easeOut", 200));
    if (phone) y.value = withSpring(0, motion.spring("springSnap"));
    else scale.value = withTiming(1, motion.timing("easeOut", 200));
  };

  const leave = () => {
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(hide)();
    };
    if (still.value === 1) {
      fade.value = withTiming(0, motion.timing("fade"), done);
    } else if (phone) {
      // Down and out along the path it came, carrying a released drag's velocity.
      fade.value = withTiming(0, motion.timing("easeOut", 150));
      y.value = withSpring(height.current || OFFSCREEN, motion.spring("springRelease", releaseVelocity.current), done);
    } else {
      scale.value = withTiming(0.96, motion.timing("easeOut", 150));
      fade.value = withTiming(0, motion.timing("easeOut", 150), done);
    }
    releaseVelocity.current = 0;
  };

  // Each opening decides its form once: under reduced motion, or opened from the keyboard, it fades; otherwise it moves.
  // Opened again while it is still leaving, it turns back from where it is.
  useEffect(() => {
    if (open) {
      still.value = motion.reduced || lastInputWasKeyboard() ? 1 : 0;
      if (laidOut.current) {
        enter();
        return;
      }
      fade.value = 0;
      scale.value = still.value === 1 ? 1 : 0.96;
      y.value = still.value === 1 || !phone ? 0 : OFFSCREEN;
    } else if (laidOut.current) {
      leave();
    } else if (shown) {
      hide();
    }
    // The motion's inputs are read when the reader opens or closes, not followed while it is open.
  }, [open]);

  // iOS and Android: the Modal's onDismiss is iOS's alone, so the closed callback follows the Modal's hiding here.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (Platform.OS !== "web" && wasShown.current && !shown) closedHandler.current?.();
    wasShown.current = shown;
  }, [shown]);

  const focusTitle = () => {
    if (Platform.OS !== "web") return;
    const panel = panelRef.current as unknown as HTMLElement | null;
    const first = initialFocus === "first" ? panel?.querySelector<HTMLElement>(FOCUSABLE) : initialFocus === "marked" ? panel?.querySelector<HTMLElement>("[data-sheet-focus]") : null;
    (first ?? (titleRef.current as unknown as HTMLElement | null))?.focus();
  };

  const onPanelLayout = (event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    if (laidOut.current) return;
    laidOut.current = true;
    if (!openNow.current) return;
    if (phone && still.value === 0) y.value = height.current;
    enter();
    // After react-native-web's focus trap has taken the focus into the Modal, the title (or the first item) takes it.
    if (Platform.OS === "web") requestAnimationFrame(focusTitle);
  };

  const dismiss = () => {
    if (dismissible) onClose();
  };

  const base = useRef(0);
  const past = useRef(false);
  const settle = (velocity: number) => {
    y.value = still.value === 1 ? withTiming(0, motion.timing("fade")) : withSpring(0, motion.spring("springRelease", velocity));
  };
  const drag: DragHandlers = {
    enabled: dismissible,
    onStart: (axis) => {
      if (axis !== "y") return false;
      // Grabbing it mid-flight takes it from where it is.
      cancelAnimation(y);
      base.current = y.value;
      past.current = false;
      return true;
    },
    onMove: (_dx, dy) => {
      const size = height.current || 1;
      const next = base.current + dy;
      // Down it follows the finger 1:1; up it resists more the further it is pulled.
      y.value = next < 0 ? -rubberBand(-next, size) : next;
      const over = next > size / 2;
      if (over !== past.current) {
        past.current = over;
        if (over) haptic("threshold");
      }
    },
    onEnd: (_dx, _dy, _vx, vy) => {
      if (releaseCloses(y.value, vy, height.current)) {
        releaseVelocity.current = vy;
        dismiss();
        // An owner that keeps it open (it asks a question first) gets it back in place.
        requestAnimationFrame(() => {
          if (openNow.current) settle(0);
        });
      } else {
        settle(vy);
      }
    },
  };

  const panelStyle = useAnimatedStyle(() =>
    phone ? { transform: [{ translateY: y.value }], opacity: still.value === 1 ? fade.value : 1 } : { transform: [{ scale: scale.value }], opacity: fade.value },
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  // On the web the Modal calls onDismiss once its content has left and its focus trap has handed the focus back.
  const closed = () => closedHandler.current?.();

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={dismiss} onDismiss={closed} aria-labelledby={titleId}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardRoom>
          <SheetFrame
            titleId={titleId}
            title={title}
            description={description}
            layout={layout}
            size={size}
            width={width}
            onClose={dismiss}
            panelStyle={panelStyle}
            scrimStyle={scrimStyle}
            drag={dismissible ? drag : undefined}
            titleRef={titleRef}
            panelRef={panelRef}
            onPanelLayout={onPanelLayout}
          >
            {children}
          </SheetFrame>
        </KeyboardRoom>
      </GestureHandlerRootView>
    </Modal>
  );
}
