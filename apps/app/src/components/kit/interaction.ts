import { Platform } from "react-native";

/**
 * What every pressable of the kit shares (UI design, sections 5.2 and 6.1), written once so the classes stay whole
 * strings Tailwind finds in the source.
 *
 * The focus ring: 2 px in the focus colour at a 2 px offset, drawn as an outline that follows the control's radius.
 * Never Tailwind's ring, a box-shadow that forced-colours mode removes; the browser itself recolours an outline there.
 * On native the system draws keyboard focus.
 */
export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * The same ring drawn 2 px inside, for full-width rows: a list scrolls inside its column, whose edges would clip a ring
 * drawn outside the row.
 */
export const FOCUS_RING_INSET = "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

/**
 * The hover of rows, icon buttons and nav items: surface-2 under a fine pointer only (tailwind.config.js's
 * hoverOnlyWhenSupported puts every hover style under `(hover: hover) and (pointer: fine)`), 120 ms ease. The web: prefix
 * keeps it out of the native styles, where there is no hover.
 */
export const HOVER_WASH = "web:hover:bg-surface-2 web:transition-colors web:duration-[120ms] web:ease-[ease]";

/**
 * How long a press waits before it shows (section 5.1): controls at once; surfaces a scroll starts on (rows, a card's
 * open area) after 80 ms, so a scroll never flashes them. react-native-web calls the prop delayPressIn and waits 50 ms
 * unless told; React Native calls it unstable_pressDelay and does not wait. Spread the result on the Pressable.
 */
export function pressDelay(ms: number): object {
  return Platform.OS === "web" ? { delayPressIn: ms } : { unstable_pressDelay: ms };
}

/**
 * Whether the reader's last input on the web was a key rather than a pointer. Keyboard actions do not animate their
 * content (section 5.1): a sheet, a dialog or a menu opened from the keyboard takes its reduced form, and a toggle pressed
 * with Enter or Space cross-fades instead of popping. The listeners are installed once, when the kit loads, in the
 * capture phase, so they hear a key before any handler acts on it; native has no such modality and answers false.
 */
const modality = { keyboard: false };

if (Platform.OS === "web" && typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    // A modifier alone (Alt+Tab away, Shift held) says nothing about how the next action is made.
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) modality.keyboard = true;
  }, true);
  document.addEventListener("pointerdown", () => {
    modality.keyboard = false;
  }, true);
}

export function lastInputWasKeyboard(): boolean {
  return modality.keyboard;
}

/**
 * A data attribute on the web (react-native-web's dataSet), which the browser check and the render tests find an element
 * by: `data-scrim`, `data-handle`, `data-menu`. React Native's own types have no dataSet, so it goes through one cast here.
 */
export function dataAttribute(name: string, value = ""): object {
  return { dataSet: { [name]: value } };
}
