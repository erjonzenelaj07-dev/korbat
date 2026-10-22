import { useMemo, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

/**
 * A drag on iOS and Android (UI design, sections 5.1 and 5.2): gesture-handler's Pan, which needs a
 * GestureHandlerRootView above it (the root layout's, and a Sheet's own inside its Modal). It starts after 10 px, takes
 * the axis it started along, and ends with gesture-handler's release velocity in px per second. Its callbacks run on the
 * JS thread (runOnJS), so the owner moves its shared values from plain functions, as the web's pointer events do in
 * DragArea.web.tsx; the drags it serves (a sheet's handle, the lightbox's image) move one view each.
 */
export type DragAxis = "x" | "y";

export interface DragHandlers {
  /** Off while the owner cannot be dragged. */
  enabled?: boolean;
  /** The drag has started along `axis`; `touch` is false for a mouse. Answer false to let this drag go. */
  onStart?: (axis: DragAxis, touch: boolean) => boolean | void;
  /** The distance from where the drag began, in px. */
  onMove: (dx: number, dy: number) => void;
  /** The release, with its velocity in px per second. */
  onEnd: (dx: number, dy: number, vx: number, vy: number) => void;
}

export function DragArea({ children, style, enabled = true, onStart, onMove, onEnd }: DragHandlers & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const handlers = useRef({ onStart, onMove, onEnd });
  handlers.current = { onStart, onMove, onEnd };
  const accepted = useRef(false);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(enabled)
        .minDistance(10)
        .onStart((event) => {
          const axis: DragAxis = Math.abs(event.translationX) > Math.abs(event.translationY) ? "x" : "y";
          accepted.current = handlers.current.onStart?.(axis, true) !== false;
        })
        .onUpdate((event) => {
          if (accepted.current) handlers.current.onMove(event.translationX, event.translationY);
        })
        .onEnd((event) => {
          if (accepted.current) handlers.current.onEnd(event.translationX, event.translationY, event.velocityX, event.velocityY);
          accepted.current = false;
        }),
    [enabled],
  );
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
