import { Pressable, Text, View } from "react-native";
import { Link } from "expo-router";
import type { AccountStanding } from "@korbat/contracts";
import { bannerSentences, STANDING_TEXTS } from "@/lib/standing";

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
 * is a level-2 header; amber (a start not fixed, announced, held by a reply) and red (running) repeat what the words say
 * and are never the only signal. Its buttons, each while it applies: Read the decision, Reply (while no reply was sent),
 * Appeal (on the decision's screen, while the appeal is open), Export my data and Delete account.
 */
export function StandingBanner({ standing }: { standing: AccountStanding | null }) {
  const measure = standing?.measure ?? null;
  const sentences = bannerSentences(standing);
  if (measure === null || sentences === null) return null;
  const [first, ...rest] = sentences;
  const decision = `/settings/cases/${measure.decisionId}`;
  const tone = measure.state === "running" ? "border-red-800 bg-red-950" : "border-amber-700 bg-amber-950";
  return (
    <View role="region" aria-label={STANDING_TEXTS.banner.label} className={`border-b px-4 py-3 ${tone}`}>
      <Text accessibilityRole="header" aria-level={2} className="text-base leading-6 text-zinc-50">
        {first}
      </Text>
      {rest.map((sentence) => (
        <Text key={sentence} className="mt-2 text-base leading-6 text-zinc-50">
          {sentence}
        </Text>
      ))}
      <View className="flex-row flex-wrap">
        <BannerLink label={STANDING_TEXTS.banner.read} href={decision} />
        {measure.replyOpen ? <BannerLink label={STANDING_TEXTS.banner.reply} href={`${decision}/reply`} /> : null}
        {measure.appealUntil !== null && !measure.appealPending ? <BannerLink label={STANDING_TEXTS.banner.appeal} href={decision} /> : null}
        <BannerLink label={STANDING_TEXTS.banner.export} href="/settings/account" />
        <BannerLink label={STANDING_TEXTS.banner.delete} href="/settings/account" />
      </View>
    </View>
  );
}
