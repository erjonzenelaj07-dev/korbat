import { Platform, type View } from "react-native";

/** A box in the window's coordinates, in px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an element is in the window (UI design, sections 5.2 and 6.9): a menu's trigger, which its popover sits under,
 * and an image's cell, which the lightbox grows from and returns into. The DOM's own box on the web, measureInWindow on
 * iOS and Android. Nothing is measured for an element that is gone.
 */
export function measureNode(node: View | null | undefined, done: (rect: Rect) => void): void {
  if (!node) return;
  const element = node as unknown as { getBoundingClientRect?: () => DOMRect };
  if (Platform.OS === "web" && typeof element.getBoundingClientRect === "function") {
    const box = element.getBoundingClientRect();
    done({ x: box.left, y: box.top, width: box.width, height: box.height });
    return;
  }
  node.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
}
