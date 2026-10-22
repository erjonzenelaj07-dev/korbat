import { useSyncExternalStore } from "react";
import type { LayoutKind } from "@/theme/layout";

/**
 * What the two toast files share (UI design, sections 5.4 and 6.16): components/toast.web.tsx draws toasts with sonner and
 * components/toast.tsx with sonner-native, behind one API, `toast.show({ message, action?, tone? })`. A toast confirms;
 * it never carries the only copy of something the reader must act on.
 */
export type ToastTone = "done" | "rollback";

export interface ToastAction {
  /** The action's word, named as its button names it everywhere ("View"). */
  label: string;
  onPress: () => void;
}

export interface ToastInput {
  /** The sentence, naming the action as its button did ("Your reply was sent"). */
  message: string;
  action?: ToastAction;
  /** done (the default) shows the done icon; rollback, an optimistic action the server refused, the error icon. */
  tone?: ToastTone;
}

/** At most three on screen; newer ones stack above older ones. */
export const TOAST_LIMIT = 3;

/** How long a toast stays, in ms: long enough to reach its action, and a rollback a little longer than a plain one. */
export const TOAST_DURATION = { plain: 4000, action: 8000, rollback: 6000 } as const;

export function toastDuration(input: ToastInput): number {
  if (input.action !== undefined) return TOAST_DURATION.action;
  return input.tone === "rollback" ? TOAST_DURATION.rollback : TOAST_DURATION.plain;
}

/**
 * How far above the window's bottom edge toasts sit, in px. On phones they clear the 56 px tab bar and the bottom safe
 * area (72 px plus the inset), and on a screen with the compose button they clear it too (140 px plus the inset), so a
 * toast's "View" is never under the button. Wider up they sit at the bottom centre of the window.
 */
export function toastOffset({ layout, bottomInset, composeButton }: { layout: LayoutKind; bottomInset: number; composeButton: boolean }): number {
  if (layout !== "phone") return 24;
  return (composeButton ? 140 : 72) + bottomInset;
}

/**
 * Whether a phone screen shows the floating compose button now. AppShell, which draws the button, says so; the one
 * Toaster, mounted in the root layout outside every screen, reads it to place toasts above it.
 */
let composeShown = false;
const listeners = new Set<() => void>();

export function setComposeButtonShown(shown: boolean): void {
  if (shown === composeShown) return;
  composeShown = shown;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = () => composeShown;

export function useComposeButtonShown(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
