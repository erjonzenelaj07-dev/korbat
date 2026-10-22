import { useEffect, useRef, type ReactNode } from "react";
import { Platform, ScrollView, View, type ViewProps } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useShellScroll } from "@/lib/shell-scroll";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { dataAttribute } from "./kit/interaction";
import { IconButton } from "./kit/IconButton";
import { Text } from "./kit/Text";

/**
 * The bar at the top of a screen inside the shell (UI design, sections 7.2 and 7.3): Back when the screen sits below a
 * tab (an IconButton named "Back"), the screen's title in display-2 as its one level-1 heading, and the screen's own
 * controls under it. On a phone it floats over the list on the page's surface with a line-low rule, slides up out of
 * view as the list scrolls down past it and returns on any scroll up or when the focus enters it (lib/shell-scroll.tsx;
 * under reduced motion it stays); the list starts below it (HeaderSpace, and the list's own top padding). From 768 px it
 * sits above the list and stays, with the rule drawn once the list has scrolled.
 */
export function ScreenHeader({ title, back, children }: { title: string; back?: Href; children?: ReactNode }) {
  const scroll = useShellScroll();
  const insets = useSafeAreaInsets();
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: scroll.headerY.value }] }));
  // Back goes where the reader came from, or, opened from an address, to the screen above this one.
  const goBack = () => {
    if (back === undefined) return;
    if (router.canGoBack()) router.back();
    else router.replace(back);
  };
  // react-native-web hands focus events to a View, and they bubble from the controls inside it; the types of React
  // Native's View do not list them.
  const focusable = { onFocus: scroll.showHeader } as ViewProps;
  const bar = (
    <View
      {...focusable}
      className={cn(
        "gap-1 border-b bg-surface px-4 pb-3 pt-3 web:transition-colors web:duration-150",
        scroll.phone || scroll.scrolled ? "border-line-low" : "border-transparent",
      )}
      // The status bar's height on native; the web's insets are the browser's own.
      style={Platform.OS === "web" ? undefined : { paddingTop: insets.top + 12 }}
    >
      <View className="min-h-[44px] flex-row items-center gap-1">
        {back !== undefined ? (
          <View className="-ml-3">
            <IconButton icon="back" label={UI_WORDS["shell.back"]} onPress={goBack} tone="high" />
          </View>
        ) : null}
        {/* The title wraps, and at the largest text a long word breaks, rather than pushing the page sideways. */}
        <Text as="h1" variant="display-2" className="min-w-0 flex-1 web:hyphens-auto web:break-words">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
  if (!scroll.phone) return bar;
  return (
    <Animated.View
      nativeID="screen-header"
      onLayout={(event) => scroll.setHeaderHeight(event.nativeEvent.layout.height)}
      style={[{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }, slide]}
    >
      {bar}
    </Animated.View>
  );
}

/** The room the floating phone header takes above content that is not a list (skeleton rows while a screen loads). */
export function HeaderSpace() {
  const scroll = useShellScroll();
  return scroll.headerSpace > 0 ? <View style={{ height: scroll.headerSpace }} /> : null;
}

/**
 * A screen that is not a list, under its ScreenHeader (UI Task 7: the moderation screens and the public pages): a scroll
 * view that tells the shell how it scrolls, as List does, so the phone's header hides and returns and the soft reset
 * brings it to its top; it starts below the floating header. Its column is a readable 640 px at most (8.9), its
 * gutter the header's 16 px, so the title and the text start on one line, and it carries `data-screen`, which the
 * browser check holds to the kit's rules. A `flush` column has no gutter, for rows that carry their own (ListRow's).
 */
export function ScreenScroll({ screen, flush = false, children }: { screen: string; flush?: boolean; children: ReactNode }) {
  const scroll = useShellScroll();
  const view = useRef<ScrollView>(null);
  useEffect(() => scroll.register({ toTop: (animated) => view.current?.scrollTo({ y: 0, animated }) }), [scroll.register]);
  return (
    <ScrollView ref={view} onScroll={scroll.onScroll} scrollEventThrottle={16} contentContainerStyle={scroll.headerSpace > 0 ? { paddingTop: scroll.headerSpace } : undefined}>
      <View {...dataAttribute("screen", screen)} className={cn("w-full max-w-[640px] pb-16 pt-2", flush ? undefined : "px-4")}>
        {children}
      </View>
    </ScrollView>
  );
}
