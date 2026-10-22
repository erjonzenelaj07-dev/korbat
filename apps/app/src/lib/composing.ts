import { useSyncExternalStore } from "react";

/**
 * Whether the app's one New post sheet is open (UI design, sections 7.2 and 7.3). The nav's New post (rail and full nav)
 * and the phone's compose button open it from any screen; the sheet itself is mounted once, in the root layout
 * (components/social/ComposeHost.tsx), so the shell need not load the composer to offer it. On Home from 768 px the
 * nav's button opens Home's own card instead (AppShell's onNewPost).
 */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export const openNewPost = (): void => set(true);
export const closeNewPost = (): void => set(false);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const current = () => open;

export function useNewPostOpen(): boolean {
  return useSyncExternalStore(subscribe, current, current);
}
