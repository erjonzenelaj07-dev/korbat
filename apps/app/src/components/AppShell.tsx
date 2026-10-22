import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link, usePathname } from "expo-router";
import { openNewPost } from "@/lib/composing";
import { useSession } from "@/lib/session";
import { ShellScrollProvider, softReset, useShellScroll } from "@/lib/shell-scroll";
import { setComposeButtonShown } from "@/lib/toast-rules";
import { UI_WORDS } from "@/lib/ui-words";
import { cn } from "@/theme/cn";
import { COLUMNS, useLayout, type LayoutKind } from "@/theme/layout";
import { AboutCard } from "./AboutCard";
import { HandleBox } from "./HandleBox";
import type { IconName } from "./icons";
import { Icon } from "./kit/Icon";
import { FOCUS_RING, FOCUS_RING_INSET, HOVER_WASH } from "./kit/interaction";
import { Text } from "./kit/Text";
import { VISUALLY_HIDDEN } from "./kit/VisuallyHidden";
import { ComposeButton, NewPostButton } from "./social/ComposeButton";
import { StandingBanner } from "./StandingBanner";

/**
 * The shell around every screen of the app (UI design, section 7): the navigation, the main column the screen draws in,
 * and from 1024 px the context column. useLayout() picks one of four layouts by the window's width:
 *
 * - phone (below 768 px): a bottom tab bar, icons over 12 px labels, and on Home, a profile and Bookmarks (the screens
 *   that pass `compose`) the floating compose button;
 * - tablet (768 to 1023 px): a rail 80 px wide at the left, with the "k" monogram, and the 600 px column centred in the rest;
 * - desktop (1024 to 1279 px): the rail, the column and the 320 px context column, together and centred;
 * - wide (1280 px and up): the full nav, 240 px with the wordmark and labels beside the icons, the column and the context.
 *
 * Signed in, the rail and the full nav end with New post on every screen (Task 6): the compose button in the rail, a
 * full-width button in the full nav. It opens the app's one New post sheet (lib/composing.ts, mounted in the root layout
 * as components/social/ComposeHost.tsx), a 640 px dialog at these widths, unless the screen gives `onNewPost`: Home
 * gives the one that opens and focuses its own card in the list.
 *
 * The nav is a landmark named "Main" with the same items and hrefs at every width (Home, Bookmarks, Profile, Settings for
 * an account; Home, Sign in and Appearance signed out, UI Task 8, since Appearance is the one settings page open to
 * everyone). The current item keeps aria-current="page" on its anchor and is marked by
 * more than colour: an accent-wash pill, a 3 px accent bar (above the icon in the tab bar, at the item's start in the
 * rail and full nav) and its icon at the strong stroke. Focus order on the web is the skip link (shown while focused),
 * the nav, the main column, the context column. The page's body never scrolls; each screen's list scrolls in the main
 * column, which tells the shell through lib/shell-scroll.tsx, so the phone's header can hide and the current Home item
 * can bring the feed back to its newest post. Nothing here counts or badges anything (section 1.7).
 */
type Status = "loading" | "signed-out" | "signed-in";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Marks the item current on every page under this prefix, when that is wider than the href. */
  match?: string;
}

const HOME: NavItem = { label: UI_WORDS["nav.home"], href: "/", icon: "home" };

/**
 * The nav's items. While the session loads only Home shows, the one item both sets share: the rest join once /me answers,
 * so a signed-in reader never sees Sign in flash, nor a signed-out one Bookmarks.
 */
function navItems(status: Status, handle: string | undefined): NavItem[] {
  if (status === "loading") return [HOME];
  if (status === "signed-out") {
    return [HOME, { label: UI_WORDS["nav.signin"], href: "/signin", icon: "sign-in" }, { label: UI_WORDS["appearance.nav"], href: "/settings/appearance", icon: "appearance" }];
  }
  return [
    HOME,
    { label: UI_WORDS["nav.bookmarks"], href: "/bookmarks", icon: "bookmarks" },
    { label: UI_WORDS["nav.profile"], href: handle ? `/u/${handle}` : "/handle", icon: "profile" },
    // Settings opens the Settings index (UI Task 8, the owner's ruling 10) and stays current on every page below it.
    { label: UI_WORDS["nav.settings"], href: "/settings", icon: "settings", match: "/settings" },
  ];
}

/** Whether a path is the prefix's page or below it: /u/ada/followers is under /u/ada, /u/adam is not. */
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const isCurrent = (item: NavItem, pathname: string) => (item.href === "/" ? pathname === "/" : under(pathname, item.match ?? item.href));

/** The layout's name on the root element, which the browser check reads (data-layout). */
const layoutData = (kind: LayoutKind) => ({ dataSet: { layout: kind } }) as object;

/** Whether the browser says it is offline. Node and native have no navigator.onLine, and count as online. */
const browserOnline = () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false;

interface OnlineEvents {
  addEventListener?: (type: "online" | "offline", listener: () => void) => void;
  removeEventListener?: (type: "online" | "offline", listener: () => void) => void;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(browserOnline);
  useEffect(() => {
    const target = globalThis as unknown as OnlineEvents;
    if (typeof target.addEventListener !== "function") return;
    const update = () => setOnline(browserOnline());
    target.addEventListener("online", update);
    target.addEventListener("offline", update);
    return () => {
      target.removeEventListener?.("online", update);
      target.removeEventListener?.("offline", update);
    };
  }, []);
  return online;
}

/**
 * The polite status at the top of the main column (section 8.11): "You're offline" while the browser says so, nothing
 * once it is back. The live region is always there, so its words are announced when they appear.
 */
function OfflineBanner() {
  const online = useOnline();
  return (
    <View role="status" aria-live="polite">
      {online ? null : (
        <View className="flex-row items-center gap-2 border-b border-line-low bg-surface-1 px-4 py-2.5">
          <Icon name="offline" size={16} tone="medium" />
          <Text variant="body-strong" tone="medium">
            {UI_WORDS["offline.title"]}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * "Skip to the main content": the first stop of the Tab key, kept off screen (as VisuallyHidden keeps text) until it has
 * the focus, then drawn at the top left over the page. It is a real link to #main; pressed, it moves the focus to the
 * main column itself instead of changing the address.
 */
function SkipLink({ onSkip }: { onSkip: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...({ href: "#main" } as object)}
      onPress={(event: GestureResponderEvent) => {
        event.preventDefault();
        onSkip();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn("min-h-[44px] justify-center rounded-control border border-line-high bg-surface-1 px-4 web:forced-colors:border-[color:CanvasText]", FOCUS_RING)}
      // Hidden, its least size is undone too, and it sits at the corner rather than where the row would centre it.
      style={focused ? { position: "absolute", top: 8, left: 8, zIndex: 50 } : { ...VISUALLY_HIDDEN, top: 0, left: 0, minWidth: 0, minHeight: 0 }}
    >
      <Text variant="body-strong">{UI_WORDS["shell.skip"]}</Text>
    </Pressable>
  );
}

interface NavProps {
  items: NavItem[];
  pathname: string;
  /** The current Home item pressed again: the soft reset. A press or, on the web, the anchor's click. */
  onHomeAgain: (event: { preventDefault(): void }) => void;
}

/** One item's link: the current Home item scrolls the feed instead of navigating. */
function ItemLink({ item, current, onHomeAgain, children }: { item: NavItem; current: boolean; onHomeAgain: NavProps["onHomeAgain"]; children: ReactNode }) {
  const again = current && item.href === "/" ? onHomeAgain : undefined;
  return (
    <Link href={item.href} onPress={again} asChild>
      {children}
    </Link>
  );
}

/** The item's icon: the strong stroke when current, and filled where its shape is closed (Bookmark). */
function ItemIcon({ item, current }: { item: NavItem; current: boolean }) {
  return <Icon name={item.icon} size={24} tone={current ? "high" : "low"} strong={current} filled={current && item.icon === "bookmarks"} />;
}

/**
 * The phone's bottom tab bar: 56 px plus the bottom safe area, each item a 3 by 20 px bar, the icon in its pill, the label.
 * The bar's and the pill's sizes are px, as the icons' are, so a larger root font size grows the labels and not the
 * shapes past their quarter of the bar.
 */
function TabBar({ items, pathname, onHomeAgain }: NavProps) {
  const insets = useSafeAreaInsets();
  return (
    <View role="navigation" aria-label={UI_WORDS["nav.label"]} className="flex-row border-t border-line-low bg-surface" style={{ paddingBottom: insets.bottom }}>
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <ItemLink key={item.href} item={item} current={current} onHomeAgain={onHomeAgain}>
            <Pressable aria-current={current ? "page" : undefined} className={cn("min-h-[56px] min-w-0 flex-1 items-center pb-1 active:bg-surface-2", HOVER_WASH, FOCUS_RING_INSET)}>
              <View className={cn("h-[3px] w-[20px] rounded-b-full", current ? "bg-accent" : "bg-transparent")} />
              <View className={cn("mt-[3px] h-[28px] w-[56px] max-w-full items-center justify-center rounded-full", current ? "bg-accent-wash" : undefined)}>
                <ItemIcon item={item} current={current} />
              </View>
              {/* A label never clips: at the largest text it breaks, hyphenated, onto another line inside its quarter of the bar. */}
              <Text variant="chip" tone={current ? "high" : "low"} className="mt-0.5 self-stretch px-0.5 text-center web:hyphens-auto web:break-words">
                {item.label}
              </Text>
            </Pressable>
          </ItemLink>
        );
      })}
    </View>
  );
}

/**
 * The nav from 768 px: the rail (80 px, the "k" monogram, icons over 12 px labels) or, from 1280 px, the full nav (240 px,
 * the wordmark, labels beside the icons). Under them, signed in, New post: a button and no link, so the nav's links stay
 * the four of section 7.1. A rail item spans the rail, as a tab bar item spans its quarter, with its ring drawn inside:
 * Bookmarks and Appearance need all of the 80 px at the Default and Larger text, and a 64 px item broke them in the word.
 */
function SideNav({ items, pathname, onHomeAgain, full, newPost }: NavProps & { full: boolean; newPost?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      role="navigation"
      aria-label={UI_WORDS["nav.label"]}
      className={cn("shrink-0 gap-1", full ? "px-3" : "items-center")}
      style={{ width: full ? COLUMNS.nav : COLUMNS.rail, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
    >
      {/* The mark only: the page's title and the Home item already name korbat, so a screen reader passes over it. */}
      <Text aria-hidden variant={full ? "display-1" : "display-2"} className={full ? "mb-4 px-4" : "mb-4"}>
        {full ? UI_WORDS["frame.wordmark"] : UI_WORDS["nav.monogram"]}
      </Text>
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <ItemLink key={item.href} item={item} current={current} onHomeAgain={onHomeAgain}>
            {full ? (
              <Pressable
                aria-current={current ? "page" : undefined}
                className={cn("min-h-[48px] flex-row items-center gap-4 rounded-full px-4 active:bg-surface-2", current ? "bg-accent-wash" : HOVER_WASH, FOCUS_RING)}
              >
                <View className={cn("absolute bottom-3 left-[-12px] top-3 w-[3px] rounded-r-full", current ? "bg-accent" : "bg-transparent")} />
                <ItemIcon item={item} current={current} />
                <Text variant={current ? "body-strong" : "body"} tone={current ? "high" : "low"} className="shrink web:hyphens-auto web:break-words">
                  {item.label}
                </Text>
              </Pressable>
            ) : (
              <Pressable aria-current={current ? "page" : undefined} className={cn("min-h-[60px] w-[80px] items-center justify-center gap-1 rounded-card py-1.5 active:bg-surface-2", HOVER_WASH, FOCUS_RING_INSET)}>
                <View className={cn("absolute bottom-4 left-0 top-4 w-[3px] rounded-r-full", current ? "bg-accent" : "bg-transparent")} />
                <View className={cn("h-[32px] w-[48px] max-w-full items-center justify-center rounded-full", current ? "bg-accent-wash" : undefined)}>
                  <ItemIcon item={item} current={current} />
                </View>
                <Text variant="chip" tone={current ? "high" : "low"} className="self-stretch text-center web:hyphens-auto web:break-words">
                  {item.label}
                </Text>
              </Pressable>
            )}
          </ItemLink>
        );
      })}
      {newPost ? <View className={cn("mt-4", full ? "self-stretch" : "items-center")}>{full ? <NewPostButton onPress={newPost} /> : <ComposeButton onPress={newPost} />}</View> : null}
    </View>
  );
}

/** The context column (section 7.3, decision 14): the handle box, then How korbat works. Popular now has left it. */
function ContextColumn() {
  const insets = useSafeAreaInsets();
  return (
    <View role="complementary" aria-label={UI_WORDS["shell.about"]} className="shrink-0" style={{ width: COLUMNS.context }}>
      <ScrollView contentContainerClassName="gap-6 pb-6" contentContainerStyle={{ paddingTop: insets.top + 24 }}>
        <HandleBox />
        <AboutCard />
      </ScrollView>
    </View>
  );
}

interface AppShellProps {
  children: ReactNode;
  /** A control floating over a phone's column, bottom right. */
  floating?: ReactNode;
  /** The phone's compose button on this screen (7.2: Home, a profile and Bookmarks), for a signed-in reader. */
  compose?: boolean;
  /** What New post does here instead of opening the sheet: Home opens and focuses its own card from 768 px. */
  onNewPost?: () => void;
}

export function AppShell({ children, floating, compose = false, onNewPost }: AppShellProps) {
  const kind = useLayout();
  return (
    <ShellScrollProvider phone={kind === "phone"}>
      <Shell kind={kind} floating={floating} compose={compose} onNewPost={onNewPost}>
        {children}
      </Shell>
    </ShellScrollProvider>
  );
}

function Shell({ kind, children, floating, compose, onNewPost }: { kind: LayoutKind } & AppShellProps) {
  const { state } = useSession();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const scroll = useShellScroll();
  const main = useRef<View>(null);
  const signedIn = state.status === "signed-in";
  const handle = signedIn ? state.me.profile?.handle : undefined;
  // 3e (design, section 9.1): above every signed-in screen while /me's standing holds a measure.
  const banner = signedIn ? <StandingBanner standing={state.me.standing} /> : null;
  const items = navItems(state.status, handle);
  const phone = kind === "phone";
  const newPost = signedIn ? (onNewPost ?? openNewPost) : undefined;
  // The phone's floating control: the screen's own, or the compose button where the screen asks for it.
  const shownFloating = floating ?? (compose && newPost ? <ComposeButton onPress={newPost} /> : null);
  const hasFloating = shownFloating !== undefined && shownFloating !== null && shownFloating !== false;

  // Toasts on a phone screen with the compose button sit above it (section 5.4); the Toaster lives outside the screen.
  useEffect(() => {
    if (!phone || !hasFloating) return;
    setComposeButtonShown(true);
    return () => setComposeButtonShown(false);
  }, [phone, hasFloating]);

  // The skip link's target: the main column itself takes the focus, so the next Tab starts inside it.
  const focusMain = () => (main.current as unknown as { focus?: () => void } | null)?.focus?.();
  const nav: NavProps = { items, pathname, onHomeAgain: (event) => softReset(event, scroll) };

  const column = (
    <View ref={main} role="main" nativeID="main" tabIndex={-1} className={cn("flex-1", FOCUS_RING_INSET)}>
      <OfflineBanner />
      {banner}
      <View className="flex-1">{children}</View>
    </View>
  );

  if (phone) {
    return (
      <View {...layoutData(kind)} className="flex-1 bg-surface">
        <SkipLink onSkip={focusMain} />
        {/* The tab bar comes before the column in the page, after the skip link, and is drawn below it. */}
        <View className="flex-1 flex-col-reverse">
          <TabBar {...nav} />
          {column}
        </View>
        {hasFloating ? (
          // 16 px from the right, and 16 px above the tab bar and the bottom safe area (section 7.2).
          <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: 56 + insets.bottom + 16 }}>
            {shownFloating}
          </View>
        ) : null}
      </View>
    );
  }

  const context = kind === "desktop" || kind === "wide";
  const navWidth = kind === "wide" ? COLUMNS.nav : COLUMNS.rail;
  // The columns sit together, 24 px apart with a line-low rule on each side of the main column: 1,208 px at wide.
  const together = navWidth + COLUMNS.gap + COLUMNS.timeline + 2 + COLUMNS.gap + COLUMNS.context;
  const timeline = (
    <View className="min-w-0 flex-1 border-x border-line-low" style={{ maxWidth: COLUMNS.timeline + 2 }}>
      {column}
    </View>
  );
  return (
    <View {...layoutData(kind)} className="flex-1 flex-row justify-center bg-surface">
      <SkipLink onSkip={focusMain} />
      {context ? (
        <View className="w-full flex-row" style={{ maxWidth: together, gap: COLUMNS.gap }}>
          <SideNav {...nav} full={kind === "wide"} newPost={newPost} />
          {timeline}
          <ContextColumn />
        </View>
      ) : (
        // A tablet: the rail at the left edge and the column centred in the rest.
        <View className="w-full flex-row">
          <SideNav {...nav} full={false} newPost={newPost} />
          <View className="min-w-0 flex-1 flex-row justify-center">
            {timeline}
          </View>
        </View>
      )}
    </View>
  );
}
