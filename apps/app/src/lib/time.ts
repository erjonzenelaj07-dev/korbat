import { UI_WORDS, fill } from "./ui-words";

/**
 * Times as korbat prints them (UI design, section 8.1), every one through Intl in this one place, so a later
 * translation changes one file. timeAgo moved here from lib/social.ts with its output unchanged, and social.ts
 * re-exports it for its callers. The forms with a clock time take the time zone as a parameter (the reader's own when
 * it is left out), and timeAgo and postedWhen take the present moment, so a test passes both.
 */

/** "just now", "5m", "3h", "2d", or a date for anything older than a week. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The spoken form of timeAgo's short time, which a post's link adds to its name (6.6): "posted just now", "3h ago",
 * "on 12/10/2026". It always contains the short time, so the link's name contains its visible label (WCAG 2.5.3).
 */
export function postedWhen(iso: string, now: number = Date.now()): string {
  const short = timeAgo(iso, now);
  if (short === "just now") return UI_WORDS["time.posted.now"];
  if (/^\d+[mhd]$/.test(short)) return fill(UI_WORDS["time.posted.ago"], { short });
  return fill(UI_WORDS["time.posted.on"], { date: short });
}

/** The named parts of one instant in one zone, on a 24-hour clock. British English gives day before month. */
function parts(iso: string, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const format = new Intl.DateTimeFormat("en-GB", { ...options, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
}

/** The weekday and the minute: "Tue 18:40". */
export function dayTime(iso: string, timeZone?: string): string {
  const at = parts(iso, timeZone, { weekday: "short" });
  return `${at.weekday} ${at.hour}:${at.minute}`;
}

/** The date and the minute, for a thread's focused post: "21 Oct 2026, 18:40". */
export function fullDate(iso: string, timeZone?: string): string {
  const at = parts(iso, timeZone, { day: "numeric", month: "short", year: "numeric" });
  return `${at.day} ${at.month} ${at.year}, ${at.hour}:${at.minute}`;
}

/**
 * 3b (design, sections 8.4 and 10.6): the archive's day of an imported post, which readers get as a day and never as a
 * second, printed in UTC whatever the reader's zone: "3 Mar 2019", or written out, "3 March 2019", for a spoken name and
 * the provenance paragraph. The short month is the long one's first three letters, since en-GB writes September "Sept".
 */
export function utcDay(day: string, form: "short" | "long" = "short"): string {
  const at = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(at);
  return `${at.getUTCDate()} ${form === "long" ? month : month.slice(0, 3)} ${at.getUTCFullYear()}`;
}

/** 3b: the day of an instant in the reader's zone (or `timeZone`), as the short form of utcDay prints one: "21 Oct 2026". */
export function localDay(iso: string, timeZone?: string): string {
  const named = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${named.day} ${String(named.month).slice(0, 3)} ${named.year}`;
}

/** 3b (10.4): a month of the archive's month table, YYYY-MM, written out in UTC: "March 2019". */
export function monthWords(month: string): string {
  const at = new Date(`${month.slice(0, 7)}-15T12:00:00Z`);
  return `${new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(at)} ${at.getUTCFullYear()}`;
}
