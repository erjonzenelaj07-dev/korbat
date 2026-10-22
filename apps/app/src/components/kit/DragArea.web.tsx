import { useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import type { DragAxis, DragHandlers } from "./DragArea";

/**
 * A drag on the web (UI design, sections 5.1 and 5.2), on the browser's own pointer events. react-native-gesture-handler
 * draws its gestures on the web through the package's index, which would put the whole package into the web bundle (about
 * 55 KB gzip, more than the budget has left; GestureRoot.web.tsx says the same of its root view), so the web does this
 * small part of it itself: a drag starts after 10 px of movement, takes the axis it started along, captures the pointer
 * so it keeps following outside the element, and ends with the release velocity measured over the last 80 ms, in px per
 * second. DragArea.tsx is gesture-handler's Pan on iOS and Android, with the same handlers.
 */
interface Sample {
  t: number;
  x: number;
  y: number;
}

interface Drag {
  id: number;
  x0: number;
  y0: number;
  touch: boolean;
  axis: DragAxis | null;
  samples: Sample[];
}

/** The pointer event as react-native-web hands it on: the DOM's own. */
type Pointer = PointerEvent & { currentTarget: Element };

/** The distance a pointer moves before it is a drag, so a tap or a small tremor never starts one. */
const SLOP = 10;
/** How far back the release velocity looks. */
const WINDOW_MS = 80;

/** The release velocity in px per second, from the samples within the last WINDOW_MS. */
export function releaseVelocity(samples: readonly Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  const first = samples.find((sample) => last.t - sample.t <= WINDOW_MS) ?? last;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export function DragArea({ children, style, enabled = true, onStart, onMove, onEnd }: DragHandlers & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const drag = useRef<Drag | null>(null);
  const handlers = useRef({ onStart, onMove, onEnd });
  handlers.current = { onStart, onMove, onEnd };

  const down = (event: Pointer) => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, touch: event.pointerType !== "mouse", axis: null, samples: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }] };
  };
  const move = (event: Pointer) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const dx = event.clientX - current.x0;
    const dy = event.clientY - current.y0;
    if (current.axis === null) {
      if (Math.hypot(dx, dy) < SLOP) return;
      const axis: DragAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      // The owner may decline an axis (a sheet drags only down and up; the lightbox pages only on touch).
      if (handlers.current.onStart?.(axis, current.touch) === false) {
        drag.current = null;
        return;
      }
      current.axis = axis;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that has already gone cannot be captured; the drag still ends on its pointerup.
      }
    }
    current.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (current.samples.length > 12) current.samples.shift();
    event.preventDefault();
    handlers.current.onMove(dx, dy);
  };
  const up = (event: Pointer) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    drag.current = null;
    if (current.axis === null) return;
    current.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    const { vx, vy } = event.type === "pointercancel" ? { vx: 0, vy: 0 } : releaseVelocity(current.samples);
    handlers.current.onEnd(event.clientX - current.x0, event.clientY - current.y0, vx, vy);
  };

  // react-native-web hands these DOM props to the element as they are; React Native's types do not list them. The
  // browser's own panning is off inside, so a touch drag moves the element and not the page.
  const pointer = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up } as object;
  return (
    <View {...pointer} style={[style, { touchAction: "none" } as unknown as ViewStyle]}>
      {children}
    </View>
  );
}
