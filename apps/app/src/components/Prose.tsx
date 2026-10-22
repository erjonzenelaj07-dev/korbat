import type { ReactNode } from "react";
import { View } from "react-native";
import { useLayout } from "@/theme/layout";
import { Text } from "./kit/Text";

/**
 * The reading layout of the public pages (UI design, section 8.9; UI Task 7): /rules, /transparency, /explore/about and
 * /terms. Section headings in Fraunces (display-3) at level 2, a table's or a subsection's title at level 3, prose in the
 * text face at the post's size, which keeps a line under 70 characters in the 600 to 640 px column; lists drawn with a
 * quiet marker, change logs as dated lists, and tables as label and value rows. The screen's title, the one level-1
 * heading, is its ScreenHeader's or its frame's. Every sentence comes from the page's words module.
 */

/** A heading of the page: level 2 a section, in the display face; level 3 inside a section, in the title face. */
export function Heading({ level, children }: { level: 2 | 3; children: string }) {
  return level === 2 ? (
    <Text as="h2" variant="display-3" className="mt-10">
      {children}
    </Text>
  ) : (
    <Text as="h3" variant="title" className="mt-6">
      {children}
    </Text>
  );
}

/** A paragraph of prose, at the post's size. */
export function Paragraph({ children, tone = "medium" }: { children: ReactNode; tone?: "high" | "medium" }) {
  return (
    <Text variant="post" tone={tone} className="mt-3">
      {children}
    </Text>
  );
}

/** One list, its items read one by one; each marked by a small dot that assistive technology does not hear. */
export function ProseList({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <View role="list" aria-label={label} className="mt-2 gap-1.5">
      {items.map((item) => (
        <View key={item} role="listitem" className="flex-row gap-3 pl-1">
          <View aria-hidden className="mt-[11px] h-1.5 w-1.5 rounded-full bg-ink-low" />
          <Text variant="post" tone="medium" className="min-w-0 flex-1">
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A change log as a dated list: each entry on a rule down its start, newest first as the page orders them, its sentence
 * whole ("Version 2, 2026-10-12: ...") so it reads the same aloud and in a test.
 */
export function DatedList({ label, entries }: { label: string; entries: readonly { key: string; text: string }[] }) {
  return (
    <View role="list" aria-label={label} className="mt-4 border-l-2 border-line-low">
      {entries.map((entry) => (
        <View key={entry.key} role="listitem" className="flex-row gap-3 pb-3">
          <View aria-hidden className="-ml-[5px] mt-[9px] h-2 w-2 rounded-full bg-ink-low" />
          <Text tone="medium" className="min-w-0 flex-1">
            {entry.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A table of figures as label and value rows (3d design, :2745): from 768 px the value stands at the row's end; below it
 * under its label. The label carries its colon, so the row reads "label: value" aloud and in a test, whatever the layout.
 */
export function FigureRows({ label, rows }: { label: string; rows: readonly { label: string; count: string }[] }) {
  const phone = useLayout() === "phone";
  return (
    <View role="list" aria-label={label} className="mt-2 border-t border-line-low">
      {rows.map((row) => (
        <View key={row.label} role="listitem" className={phone ? "gap-0.5 border-b border-line-low py-2.5" : "flex-row items-baseline justify-between gap-6 border-b border-line-low py-2.5"}>
          <Text tone="medium" className={phone ? undefined : "min-w-0 flex-1"}>{`${row.label}:`}</Text>
          <Text variant="body-strong" className="web:tabular-nums">
            {row.count}
          </Text>
        </View>
      ))}
    </View>
  );
}
