import type { ReactNode } from "react";
import { Text } from "react-native";

/**
 * Words for assistive technology only (UI design, section 6.16): a post link's spoken time, the composer's count, a
 * list's loading status. The box is 1 px, clipped and taken out of the layout, so nothing on screen moves, and the text
 * keeps to one line, so a screen reader does not read a wrapped word at a time. The style is inline, which every
 * platform honours; a control that shows itself on focus (the skip link) renders visibly while focused instead.
 * `nativeID` lets a field name it in aria-describedby; `role` makes it a polite status.
 */
const HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", margin: -1, padding: 0, borderWidth: 0 } as const;

export function VisuallyHidden({ children, nativeID, role }: { children: ReactNode; nativeID?: string; role?: "status" }) {
  return (
    <Text nativeID={nativeID} role={role} aria-live={role === "status" ? "polite" : undefined} numberOfLines={1} style={HIDDEN}>
      {children}
    </Text>
  );
}
