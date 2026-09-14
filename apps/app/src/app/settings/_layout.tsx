import { Redirect, Stack } from "expo-router";
import { Loading } from "@/components/ui";
import { useSession } from "@/lib/session";

/** Settings need a finished account: signed out goes to sign-in, no handle yet goes to onboarding. */
export default function SettingsLayout() {
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-out") return <Redirect href="/" />;
  if (!state.me.user.onboarded) return <Redirect href="/handle" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
