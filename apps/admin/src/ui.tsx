import type { ReactNode } from "react";

/**
 * Small pieces every screen uses. A string a person wrote (a handle, a key's name, a browser label) is only ever a text
 * child, which React escapes, inside a <bdi>: a direction override in it then cannot reorder the text around it.
 */
export function UserText({ children }: { children: string }) {
  return <bdi>{children}</bdi>;
}

/** A list a screen reads from the API: still loading, read, or failed with the console's words. */
export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; message: string };

export function Loaded<T>({ value, render }: { value: Loadable<T>; render: (value: T) => ReactNode }) {
  if (value.state === "loading") return <p className="quiet">Loading</p>;
  if (value.state === "failed") return <p className="error">{value.message}</p>;
  return <>{render(value.value)}</>;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** A time of day in the browser's zone, as the design writes it: "21:40". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** A date and time in the browser's zone: "2026-09-30 21:40". */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${clockTime(iso)}`;
}

/** The same with seconds, for the audit log: "2026-09-30 21:40:05". */
export function dateTimeSeconds(iso: string): string {
  return `${dateTime(iso)}:${two(new Date(iso).getSeconds())}`;
}

/**
 * 3f (design, section 8.1): every time of authorities' orders is the database's instant, printed in UTC first and then in
 * the browser's own zone: "2026-10-16 02:00 UTC (04:00 your time)", the local day too when it is another.
 */
export function bothTimes(iso: string): string {
  const d = new Date(iso);
  const utcDay = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const localDay = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return `${utcDay} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC (${localDay === utcDay ? "" : `${localDay} `}${clockTime(iso)} your time)`;
}
