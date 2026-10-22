import { useWindowDimensions } from "react-native";

/**
 * The four layouts the shell switches between by the window's width (UI design, section 7.1), and the spacing that
 * screens share (section 4.4). The 768 and 1024 px edges are AppShell's today; 1280 px brings the full nav.
 */
export type LayoutKind = "phone" | "tablet" | "desktop" | "wide";

/** The first width, in px, of each layout above the phone. */
export const BREAKPOINTS = { tablet: 768, desktop: 1024, wide: 1280 } as const;

/** The layout a window of this width gets. */
export function layoutKind(width: number): LayoutKind {
  if (width >= BREAKPOINTS.wide) return "wide";
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "phone";
}

/** The current layout, which changes as the window is resized or the phone is turned. */
export function useLayout(): LayoutKind {
  return layoutKind(useWindowDimensions().width);
}

/** The space between the screen's edge and its content: 16 px on phones, 20 px from 768 px on. */
export const GUTTER = { phone: 16, wider: 20 } as const;

/** A post's padding and the gaps inside it, in px: across, down, author line to body, body to media, above the actions. */
export const POST_SPACING = { across: 16, down: 12, authorToBody: 12, bodyToMedia: 8, aboveActions: 4 } as const;

/** Between the sections of a screen, and between a heading and its content, in px. */
export const SECTION_GAP = 24;
export const HEADING_GAP = 8;

/** The least size of a standalone control on every platform, and of a link inside running text (WCAG 2.5.8), in px. */
export const TARGET = { control: 44, inline: 24 } as const;

/** The widths of the shell's columns at 768 px and wider, in px, and the space between them. */
export const COLUMNS = { timeline: 600, context: 320, rail: 80, nav: 240, gap: 24 } as const;
