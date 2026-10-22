import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Link, type Href } from "expo-router";
import { FOCUS_RING } from "@/components/kit/interaction";
import { Text } from "@/components/kit/Text";
import { cn } from "@/theme/cn";

/**
 * The few shapes the moderation screens share on the tokens (UI design, sections 4.3, 4.4 and 8.7; UI Task 7): a line of
 * a statement or a notice in the body size, a quieter note beside it, and a link that stands on a line of its own. Every
 * sentence they show comes from a words module or the rulebook; these only draw it.
 */

/** A line of a statement or a notice: body text, ink-high; `strong` for the line that says where something stands. */
export function Line({ children, strong = false, className }: { children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <Text variant={strong ? "body-strong" : "body"} className={cn("mt-3", className)}>
      {children}
    </Text>
  );
}

/** A sentence that explains rather than states: body text in ink-medium, which reads at 8.2:1 or more on every surface. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text tone="medium" className={cn("mt-3", className)}>
      {children}
    </Text>
  );
}

/**
 * A press on a link inside an open sheet (StatusSheet): the sheet closes first and the route changes once it has gone,
 * since while it is on screen its focus trap would take the focus back from the next screen. Without `onLeave` the link
 * works as a plain link.
 */
export const leaveBy = (href: string, onLeave?: (href: string) => void) => (event: { preventDefault(): void }) => {
  if (onLeave === undefined) return;
  event.preventDefault();
  onLeave(href);
};

/**
 * A link on a line of its own (another decision, the rules page, a notice): a real anchor, accent-ink words underlined,
 * a 44 px target that starts the line, dimmed while pressed, its underline thicker under a fine pointer.
 */
export function CaseLink({ href, label, onLeave, className }: { href: string; label: string; onLeave?: (href: string) => void; className?: string }) {
  return (
    <Link href={href as Href} onPress={leaveBy(href, onLeave)} asChild>
      <Pressable className={cn("group mt-1 min-h-[44px] justify-center self-start rounded-control active:opacity-70", FOCUS_RING, className)}>
        <Text tone="accent" className="underline decoration-1 underline-offset-2 web:group-hover:decoration-2">
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}
