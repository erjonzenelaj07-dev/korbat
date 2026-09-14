import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MfaSection } from "@/components/security/MfaSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { Button, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-8 rounded-xl border border-zinc-800 p-5">
      <Text accessibilityRole="header" className="text-lg font-semibold text-zinc-50">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function SecuritySettings() {
  const { state, refresh } = useSession();
  const { reenroll } = useLocalSearchParams<{ reenroll?: string }>();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  async function signOut() {
    await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/");
  }

  return (
    <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="items-center px-6 py-10">
      <View className="w-full max-w-xl">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Security
        </Text>
        <Text className="mt-2 text-base text-zinc-400">
          @{me.profile?.handle} · {me.user.email}
        </Text>

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Two-factor authentication">
          <MfaSection me={me} run={reauth.run} refresh={refresh} reenroll={reenroll === "1"} />
        </Section>
        <Section title="Password">
          <PasswordSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        <Section title="Where you're signed in">
          <SessionsSection run={reauth.run} refresh={refresh} />
        </Section>

        <Button label="Sign out" onPress={() => void signOut()} tone="secondary" />
      </View>
    </ScrollView>
  );
}
