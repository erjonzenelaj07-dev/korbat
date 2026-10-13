import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { AccountStanding } from "@korbat/contracts";
import { runningMeasure, STANDING_TEXTS } from "@/lib/standing";

/** One of the banner's buttons: a link to the screen where the person acts. */
function BannerLink({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className="mr-2 mt-3 rounded-lg border border-zinc-500 px-3 py-2">
        <Text className="text-sm font-semibold text-zinc-50">{label}</Text>
      </Pressable>
    </Link>
  );
}

/**
 * The banner above every signed-in screen while /me's standing holds a measure (3e design, section 9.1). It cannot be
 * dismissed, so a deadline is never out of sight. It is a region labelled "Your account's standing" whose first sentence
 * is a level-2 header; its colour repeats what the words say and is never the only signal. Task 3 builds a running
 * suspension; the other states (a start not fixed, announced, held by a reply) and a termination come with Task 4, and
 * until then no banner is shown for them. Its buttons, each while it applies: Read the decision, Appeal (on the
 * decision's screen, while the appeal is open), Export my data and Delete account. "Reply" comes with the reply's screen.
 */
export function StandingBanner({ standing }: { standing: AccountStanding | null }) {
  const running = runningMeasure(standing);
  if (running === null || running.kind !== "suspend" || running.endsAt === null) return null;
  const decision = `/settings/cases/${running.decisionId}`;
  return (
    <View role="region" aria-label={STANDING_TEXTS.banner.label} className="border-b border-red-800 bg-red-950 px-4 py-3">
      <Text accessibilityRole="header" aria-level={2} className="text-base leading-6 text-zinc-50">
        {STANDING_TEXTS.banner.running(running.endsAt)}
      </Text>
      <View className="flex-row flex-wrap">
        <BannerLink label={STANDING_TEXTS.banner.read} href={decision} />
        {running.appealUntil !== null ? <BannerLink label={STANDING_TEXTS.banner.appeal} href={decision} /> : null}
        <BannerLink label={STANDING_TEXTS.banner.export} href="/settings/account" />
        <BannerLink label={STANDING_TEXTS.banner.delete} href="/settings/account" />
      </View>
    </View>
  );
}
