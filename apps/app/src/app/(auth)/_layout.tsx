import { Redirect, Stack, usePathname } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Screens for people who are not fully signed in. A signed-in account that still needs a handle is
 * sent to /handle; a finished account goes to its feed.
 */
export default function AuthLayout() {
  const { state } = useSession();
  const pathname = usePathname();

  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-in") {
    if (state.me.user.onboarded) return <Redirect href="/" />;
    if (pathname !== "/handle") return <Redirect href="/handle" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
