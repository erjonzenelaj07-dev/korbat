import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { Text } from "@/components/kit/Text";
import { ScreenHeader, ScreenScroll } from "@/components/ScreenHeader";
import { MfaSection } from "@/components/security/MfaSection";
import { PasskeysSection } from "@/components/security/PasskeysSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { SettingsNav } from "@/components/SettingsNav";
import { Button, Loading, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { usePageTitle } from "@/lib/page-title";
import { useSession } from "@/lib/session";
import { UI_WORDS } from "@/lib/ui-words";

/**
 * Settings, Security (1b and 1c designs; UI design, section 8.8): two-factor authentication, the password, the passkeys,
 * where the account is signed in, and Sign out. UI Task 8 restyles it and keeps its sections, words and flows: the title
 * and the settings row in ScreenHeader, the account's handle (in the mono face) and address at the top of the column,
 * each section a card of fields and rows on ScreenScroll.
 */
export default function SecuritySettings() {
  const { state, refresh } = useSession();
  // reenroll=1 after a recovery code was used; add=1 from the home screen's passkey card, which opens the Add dialog at once.
  const { reenroll, add } = useLocalSearchParams<{ reenroll?: string; add?: string }>();
  const reauth = useReauth();
  const title = usePageTitle("title.settingsSecurity");

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  async function signOut() {
    await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/");
  }

  return (
    <AppShell>
      {title}
      <ScreenHeader title={UI_WORDS["settings.security"]}>
        <SettingsNav current="security" />
      </ScreenHeader>
      <ScreenScroll screen="security">
        {/* Whose security this is: the handle in the mono face, so look-alike handles differ, and the address. */}
        <View className="mt-2 flex-row flex-wrap items-baseline gap-x-3 gap-y-1">
          <Text variant="mono" tone="medium">{`@${me.profile?.handle ?? ""}`}</Text>
          <Text tone="medium" className="min-w-0 shrink web:break-words">
            {me.user.email}
          </Text>
        </View>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Two-factor authentication">
          <MfaSection me={me} run={reauth.run} refresh={refresh} reenroll={reenroll === "1"} />
        </Section>
        <Section title="Password">
          <PasswordSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        <Section title="Passkeys">
          <PasskeysSection me={me} run={reauth.run} refresh={refresh} openAdd={add === "1"} />
        </Section>
        <Section title="Where you're signed in">
          <SessionsSection run={reauth.run} refresh={refresh} />
        </Section>

        <Button label="Sign out" onPress={() => void signOut()} tone="secondary" />
      </ScreenScroll>
    </AppShell>
  );
}
