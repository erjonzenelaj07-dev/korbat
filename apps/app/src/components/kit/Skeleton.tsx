import type { ReactNode } from "react";
import { View, type DimensionValue } from "react-native";
import Animated from "react-native-reanimated";
import { usePulse } from "@/lib/motion";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { VARIANTS } from "./Text";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * The shapes a list shows while its first page loads (UI design, sections 5.2 and 6.12), so loading keeps the layout and
 * never leaves the shell: surface-2 shapes that pulse between opacity 1 and 0.6, 1.6 s a cycle, until the content
 * arrives; under reduced motion they stand still at 0.8. Every part is hidden from assistive technology; a list of them
 * (Skeleton.List) says what is loading once, in a polite status. A composed row pulses as one, so a screen of rows runs
 * one animation a row rather than one a shape.
 */

/** A shape's grey; the parts are drawn still, and pulse inside a Pulse. */
const SHAPE = "bg-surface-2";

/** Its children pulse together. */
function Pulse({ children }: { children: ReactNode }) {
  const style = usePulse();
  return (
    <Animated.View aria-hidden style={style}>
      {children}
    </Animated.View>
  );
}

/** A bar of one line of text: the line's height, with the bar at 60 percent of it, as letters fill a line. */
function TextBar({ width = "100%", variant = "body" }: { width?: DimensionValue; variant?: "post" | "body" | "meta" }) {
  const line = VARIANTS[variant].line;
  return (
    <View className="justify-center" style={{ width, height: line }}>
      <View className={cn(SHAPE, "rounded-full")} style={{ height: Math.round(line * 0.6) }} />
    </View>
  );
}

function CircleShape({ size = 40 }: { size?: number }) {
  return <View className={cn(SHAPE, "rounded-full")} style={{ width: size, height: size }} />;
}

function BlockShape({ height, width = "100%" }: { height: number; width?: DimensionValue }) {
  return <View className={cn(SHAPE, "rounded-media")} style={{ width, height }} />;
}

/** A post: the avatar column, two lines, a media block on every third row (index 2, 5, 8...), and the action row. */
function PostShape({ index = 0 }: { index?: number }) {
  return (
    <View className="flex-row gap-3 border-b border-line-low px-4 py-3">
      <CircleShape size={40} />
      <View className="flex-1 gap-2">
        <TextBar width="45%" variant="meta" />
        <TextBar width="90%" variant="post" />
        <TextBar width="70%" variant="post" />
        {index % 3 === 2 ? <BlockShape height={180} /> : null}
        <View className="flex-row gap-8 pt-1">
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
          <TextBar width={28} variant="meta" />
        </View>
      </View>
    </View>
  );
}

/** A row of an account or settings list, as ListRow lays one out. */
function RowShape() {
  return (
    <View className="min-h-[52px] flex-row items-center gap-3 border-b border-line-low px-4 py-3">
      <CircleShape size={40} />
      <View className="flex-1 gap-1">
        <TextBar width="40%" />
        <TextBar width="25%" variant="meta" />
      </View>
    </View>
  );
}

export const Skeleton = {
  Text: (props: { width?: DimensionValue; variant?: "post" | "body" | "meta" }) => (
    <Pulse>
      <TextBar {...props} />
    </Pulse>
  ),
  Circle: (props: { size?: number }) => (
    <Pulse>
      <CircleShape {...props} />
    </Pulse>
  ),
  Block: (props: { height: number; width?: DimensionValue }) => (
    <Pulse>
      <BlockShape {...props} />
    </Pulse>
  ),
  Post: (props: { index?: number }) => (
    <Pulse>
      <PostShape {...props} />
    </Pulse>
  ),
  Row: () => (
    <Pulse>
      <RowShape />
    </Pulse>
  ),
  /**
   * A screen that is not a list, while it loads (a form, a notice's status): a heading's bar and lines of text in a
   * readable column, with the polite status "Loading", which a screen reader hears instead of the shapes.
   */
  Page: () => (
    <View className="gap-3 px-4 pt-6">
      <VisuallyHidden role="status">{UI_WORDS["spinner.label"]}</VisuallyHidden>
      <Pulse>
        <View className="w-full max-w-[576px] gap-3">
          <TextBar width="55%" variant="post" />
          <TextBar width="100%" />
          <TextBar width="92%" />
          <TextBar width="70%" />
          <BlockShape height={44} />
        </View>
      </Pulse>
    </View>
  ),
  /**
   * A list's first page while it loads: `count` rows of posts or accounts, and once the polite status "Loading posts"
   * or "Loading accounts", which a screen reader hears instead of the shapes.
   */
  List: ({ kind, count = 6 }: { kind: "posts" | "accounts"; count?: number }) => (
    <View>
      <VisuallyHidden role="status">{kind === "posts" ? UI_WORDS["feed.loading"] : UI_WORDS["accounts.loading"]}</VisuallyHidden>
      {Array.from({ length: count }, (_, index) =>
        kind === "posts" ? (
          <Pulse key={index}>
            <PostShape index={index} />
          </Pulse>
        ) : (
          <Pulse key={index}>
            <RowShape />
          </Pulse>
        ),
      )}
    </View>
  ),
};
