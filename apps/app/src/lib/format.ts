/**
 * A count as it shows beside an icon (UI design, section 6.3): 1, 999, 1.2K, 12K, 1.2M. It truncates rather than
 * rounds, so it never shows more than the count: 1,999 likes are "1.9K", not "2K". One decimal is kept below ten of a
 * unit and dropped when it is zero; a count that is not a whole number is cut to one, and nothing below zero is shown.
 */
const UNITS = [
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000, suffix: "K" },
] as const;

export function compactCount(count: number): string {
  const whole = Math.max(0, Math.floor(count));
  for (const { size, suffix } of UNITS) {
    if (whole < size) continue;
    // Whole tenths of the unit, in integers, so no binary fraction rounds 1.2 up or down.
    const tenths = Math.floor(whole / (size / 10));
    if (tenths >= 100 || tenths % 10 === 0) return `${Math.floor(tenths / 10)}${suffix}`;
    return `${Math.floor(tenths / 10)}.${tenths % 10}${suffix}`;
  }
  return String(whole);
}
