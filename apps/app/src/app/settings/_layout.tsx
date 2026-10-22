import { Redirect, Stack, usePathname } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Settings need a finished account: signed out goes to sign-in, no handle yet goes to onboarding. The one exception is
 * Appearance and accessibility (UI design, section 8.8), whose choices belong to this device and not to an account, so
 * a signed-out reader opens it too, from the nav's Appearance item; the Settings index still sends them to sign-in.
 */
export default function SettingsLayout() {
  const { state } = useSession();
  const pathname = usePathname();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return pathname === "/settings/appearance" ? <Stack screenOptions={{ headerShown: false }} /> : <Redirect href="/signin" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
