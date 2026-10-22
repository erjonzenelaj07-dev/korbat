/**
 * The motion values every animation takes (UI design, section 5.1), as plain data so this file loads anywhere: no
 * Reanimated here. useMotion() in lib/motion.ts (Task 2) turns them into Reanimated springs and timings and swaps in
 * the reduced form when the system or the reader's "Reduce motion" asks for it. Easing curves are cubic-bezier
 * control points; durations are in ms.
 */
export const MOTION = {
  /** Entering, pressing, menus, the new-posts pill. */
  easeOut: { type: "timing", easing: [0.23, 1, 0.32, 1] },
  /** On-screen movement without a gesture: the tab underline, a scroll to the oldest unread new post. */
  easeInOut: { type: "timing", easing: [0.77, 0, 0.175, 1] },
  /** The default spring, with no overshoot: sheets opening, the lightbox growing, the tab underline. */
  springSnap: { type: "spring", dampingRatio: 1, duration: 300 },
  /** After a drag or flick is released, started with the gesture's velocity (sheets, lightbox). */
  springRelease: { type: "spring", dampingRatio: 0.85, duration: 350 },
  /** The pressed scale: in on pointer-down, out on release. */
  press: { type: "timing", in: 100, out: 160, easing: [0.23, 1, 0.32, 1] },
  /** The reduced forms, and the blurhash cross-fade. */
  fade: { type: "timing", duration: 150, easing: [0.23, 1, 0.32, 1] },
} as const;

export type MotionName = keyof typeof MOTION;
