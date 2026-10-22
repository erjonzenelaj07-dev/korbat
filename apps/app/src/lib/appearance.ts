import { useSyncExternalStore } from "react";
import type { ThemeName } from "@/theme/tokens";

/**
 * The reader's appearance and reading choices (UI design, section 8.8), applied at once with no Save button and kept on
 * this device: in localStorage under korbat.appearance on web, which public/theme-boot.js reads before the first paint,
 * and in memory on native until sub-project 5 brings storage there. This is the only module in src that touches that
 * key; ThemeProvider, Text and the Appearance page read and write through it, and the session's end clears it through
 * clearAppearance().
 */
export interface Appearance {
  /** System follows the operating system: Light, or the dark style when the system is dark. */
  theme: "system" | "light" | "dim" | "dark";
  darkStyle: "dim" | "dark";
  /** Multiplies every text size and line height (kit/Text.tsx). */
  textStep: "smaller" | "default" | "larger" | "largest";
  font: "korbat" | "system";
  /** Always reduces motion whatever the system says; "system" follows the operating system's setting. */
  reduceMotion: "system" | "always";
  haptics: boolean;
  autoLoad: boolean;
  openNewest: boolean;
  hideCounts: boolean;
}

export const APPEARANCE_KEY = "korbat.appearance";

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  theme: "system",
  darkStyle: "dark",
  textStep: "default",
  font: "korbat",
  reduceMotion: "system",
  haptics: true,
  autoLoad: false,
  openNewest: false,
  hideCounts: false,
});

/** The values each choice may take; anything else in a stored record falls back to that field's default. */
const CHOICES: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  theme: ["system", "light", "dim", "dark"],
  darkStyle: ["dim", "dark"],
  textStep: ["smaller", "default", "larger", "largest"],
  font: ["korbat", "system"],
  reduceMotion: ["system", "always"],
  haptics: [true, false],
  autoLoad: [true, false],
  openNewest: [true, false],
  hideCounts: [true, false],
};

/** Each field taken from `value` when it is one of the field's choices, else the default: an older or damaged record still gives every choice. */
function normalise(value: Record<string, unknown>): Appearance {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CHOICES) as (keyof Appearance)[]) {
    const choices = CHOICES[key] as readonly unknown[];
    out[key] = choices.includes(value[key]) ? value[key] : DEFAULT_APPEARANCE[key];
  }
  return out as unknown as Appearance;
}

/** A stored record as the choices it holds; anything that is not a JSON object gives the defaults. */
export function parseAppearance(raw: string | null): Appearance {
  if (raw === null || raw === "") return DEFAULT_APPEARANCE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_APPEARANCE;
    return normalise(value as Record<string, unknown>);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Which theme the screen shows: the chosen one, or under System the reader's dark style on a dark system and Light otherwise. */
export function resolveTheme(appearance: Pick<Appearance, "theme" | "darkStyle">, system: string | null | undefined): ThemeName {
  if (appearance.theme !== "system") return appearance.theme;
  return system === "dark" ? appearance.darkStyle : "light";
}

/** Browser storage, typed locally as lib/api.ts types it; every access is guarded, since a private window or blocked storage throws. */
const web = globalThis as unknown as {
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
};

/** The browser's storage, or null where there is none (native) or the browser refuses it. */
function storage() {
  if (broken) return null;
  try {
    return web.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The choices where storage is missing or refused: on native always, on web once a read or write has thrown. */
let memory: Appearance = DEFAULT_APPEARANCE;
/** Set once storage throws, so the choices made after it are read back from memory rather than lost. */
let broken = false;
/** The last stored text and what it parsed to, so an unchanged record reads as the same object. */
let lastRaw: string | null = null;
let lastParsed: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** The reader's current choices. */
export function readAppearance(): Appearance {
  const store = storage();
  if (!store) return memory;
  let raw: string | null;
  try {
    raw = store.getItem(APPEARANCE_KEY);
  } catch {
    broken = true;
    return memory;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastParsed = parseAppearance(raw);
  }
  return lastParsed;
}

/** Changes some choices at once and tells every screen that shows them. */
export function setAppearance(change: Partial<Appearance>): Appearance {
  const next = normalise({ ...readAppearance(), ...change });
  memory = next;
  const store = storage();
  try {
    store?.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    broken = true;
  }
  announce();
  return next;
}

/**
 * Forgets every choice on this device, so the theme returns to System. The session's end calls it (Task 5), and so
 * does the Appearance page's "Clear what this device keeps" (Task 8).
 */
export function clearAppearance(): void {
  memory = DEFAULT_APPEARANCE;
  const store = storage();
  try {
    store?.removeItem(APPEARANCE_KEY);
  } catch {
    broken = true;
  }
  announce();
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The reader's choices in a component, which renders again when one changes. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, readAppearance, readAppearance);
}
