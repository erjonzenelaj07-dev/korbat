import { ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { ReportForm } from "@/components/moderation/ReportForm";
import { Loading } from "@/components/ui";
import { givenTarget } from "@/lib/moderation";
import { useSession } from "@/lib/session";

/**
 * The report form's page (3c design, section 9): opened from "Report" on a post, an image or a profile, whose address
 * names the item, or on its own, from the terms page, where it asks for a link. It stands outside the settings, whose
 * layout sends a signed-out reader to sign in: anyone may report, signed in or not. An account that has not chosen a
 * handle yet finishes that first, as the API asks of every signed-in request.
 */
export default function Report() {
  const params = useLocalSearchParams<{ post?: string; media?: string; account?: string }>();
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;
  const given = givenTarget(params);
  return (
    <AppShell>
      <ScrollView contentContainerClassName="px-4 pb-16 pt-6">
        <View className="w-full max-w-xl">
          {/* A form opened on another item starts empty: its key is the item. */}
          <ReportForm key={given ? JSON.stringify(given) : "link"} signedIn={state.status === "signed-in"} given={given} standing={state.status === "signed-in" ? state.me.standing : null} />
        </View>
      </ScrollView>
    </AppShell>
  );
}
