import type { ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Link, usePathname } from "expo-router";
import { useSession } from "@/lib/session";
import { HandleBox } from "./HandleBox";
import { StandingBanner } from "./StandingBanner";
import { PopularNow } from "./PopularNow";

interface NavItem {
  label: string;
  href: string;
  /** Marks the item current on every page under this prefix, when that is wider than the href. */
  match?: string;
}

const WIDE = 1024;
const MEDIUM = 768;

/**
 * The layout from the design brief: navigation, timeline and context columns on wide screens, the
 * context column dropped on tablets, and a single column with a bottom tab bar on phones. Screens
 * render their own scrolling content inside it. The context column holds Explore's Popular now above
 * the handle box (2c design, section 11).
 */
export function AppShell({ children, floating }: { children: ReactNode; floating?: ReactNode }) {
  const { width } = useWindowDimensions();
  const { state } = useSession();
  const pathname = usePathname();
  const signedIn = state.status === "signed-in";
  const handle = signedIn ? state.me.profile?.handle : undefined;
  // 3e (design, section 9.1): above every signed-in screen while /me's standing holds a measure.
  const banner = signedIn ? <StandingBanner standing={state.me.standing} /> : null;

  const items: NavItem[] = signedIn
    ? [
        { label: "Home", href: "/" },
        { label: "Bookmarks", href: "/bookmarks" },
        { label: "Profile", href: handle ? `/u/${handle}` : "/handle" },
        { label: "Settings", href: "/settings/security", match: "/settings" },
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Sign in", href: "/signin" },
      ];
  const active = (item: NavItem) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.match ?? item.href));

  if (width >= MEDIUM) {
    return (
      <View className="flex-1 flex-row justify-center bg-zinc-950">
        <View className="w-56 border-r border-zinc-800 px-4 py-6">
          <Text className="mb-6 text-2xl font-bold tracking-tight text-zinc-50">korbat</Text>
          {items.map((item) => (
            <Link key={item.href} href={item.href} asChild>
              <Pressable aria-current={active(item) ? "page" : undefined} className="rounded-lg px-3 py-2">
                <Text className={`text-base ${active(item) ? "font-semibold text-zinc-50" : "text-zinc-300"}`}>{item.label}</Text>
              </Pressable>
            </Link>
          ))}
          {floating ? <View className="mt-6">{floating}</View> : null}
        </View>
        <View className="w-full max-w-2xl border-r border-zinc-800">
          {banner}
          {children}
        </View>
        {width >= WIDE ? (
          <View className="w-72 px-4 py-6">
            <PopularNow />
            <HandleBox />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-1">
        {banner}
        {children}
      </View>
      {floating ? <View className="absolute bottom-16 right-4">{floating}</View> : null}
      <View className="flex-row border-t border-zinc-800 bg-zinc-950">
        {items.map((item) => (
          <Link key={item.href} href={item.href} asChild>
            <Pressable aria-current={active(item) ? "page" : undefined} className="flex-1 items-center py-3">
              <Text className={`text-sm ${active(item) ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{item.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}
