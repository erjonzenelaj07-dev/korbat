import type { ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { useSession } from "@/lib/session";
import { HandleBox } from "./HandleBox";

interface NavItem {
  label: string;
  href: string;
}

const WIDE = 1024;
const MEDIUM = 768;

/**
 * The layout from the design brief: navigation, timeline and context columns on wide screens, the
 * context column dropped on tablets, and a single column with a bottom tab bar on phones. Screens
 * render their own scrolling content inside it.
 */
export function AppShell({ children, floating }: { children: ReactNode; floating?: ReactNode }) {
  const { width } = useWindowDimensions();
  const { state } = useSession();
  const pathname = usePathname();
  const signedIn = state.status === "signed-in";
  const handle = signedIn ? state.me.profile?.handle : undefined;

  const items: NavItem[] = signedIn
    ? [
        { label: "Home", href: "/" },
        { label: "Bookmarks", href: "/bookmarks" },
        { label: "Profile", href: handle ? `/u/${handle}` : "/handle" },
        { label: "Settings", href: "/settings/security" },
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Sign in", href: "/signin" },
      ];
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  if (width >= MEDIUM) {
    return (
      <View className="flex-1 flex-row justify-center bg-zinc-950">
        <View className="w-56 border-r border-zinc-800 px-4 py-6">
          <Text className="mb-6 text-2xl font-bold tracking-tight text-zinc-50">korbat</Text>
          {items.map((item) => (
            <Pressable key={item.href} accessibilityRole="link" aria-current={active(item.href) ? "page" : undefined} onPress={() => router.push(item.href)} className="rounded-lg px-3 py-2">
              <Text className={`text-base ${active(item.href) ? "font-semibold text-zinc-50" : "text-zinc-300"}`}>{item.label}</Text>
            </Pressable>
          ))}
          {floating ? <View className="mt-6">{floating}</View> : null}
        </View>
        <View className="w-full max-w-2xl border-r border-zinc-800">{children}</View>
        {width >= WIDE ? (
          <View className="w-72 px-4 py-6">
            <HandleBox />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-1">{children}</View>
      {floating ? <View className="absolute bottom-16 right-4">{floating}</View> : null}
      <View className="flex-row border-t border-zinc-800 bg-zinc-950">
        {items.map((item) => (
          <Pressable key={item.href} accessibilityRole="link" aria-current={active(item.href) ? "page" : undefined} onPress={() => router.push(item.href)} className="flex-1 items-center py-3">
            <Text className={`text-sm ${active(item.href) ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
