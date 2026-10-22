import { Pressable, View } from "react-native";
import { Link } from "expo-router";
import type { AccountStanding } from "@korbat/contracts";
import { bannerSentences, STANDING_TEXTS } from "@/lib/standing";
import { cn } from "@/theme/cn";
import { Icon } from "./kit/Icon";
import { FOCUS_RING } from "./kit/interaction";
import { Text, type Tone } from "./kit/Text";

/** One of the banner's buttons: a link to the screen where the person acts, outlined in the banner's own ink. */
function BannerLink({ label, href, tone, border }: { label: string; href: string; tone: Tone; border: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className={cn("min-h-[44px] justify-center rounded-control border px-3 active:opacity-70", border, FOCUS_RING)}>
        <Text variant="body-strong" tone={tone}>
          {label}
        </Text>
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
 *
 * On the tokens (UI design, section 4.8): the review wash before the start and the restricted wash while it runs, with
 * the status's icon (Clock, or EyeOff) at the start of the heading, so the state reads without its colour too.
 */
export function StandingBanner({ standing }: { standing: AccountStanding | null }) {
  const measure = standing?.measure ?? null;
  const sentences = bannerSentences(standing);
  if (measure === null || sentences === null) return null;
  const [first, ...rest] = sentences;
  const decision = `/settings/cases/${measure.decisionId}`;
  const running = measure.state === "running";
  const tone = measure.state === "running" ? "border-restricted-ink/40 bg-restricted-wash" : "border-review-ink/40 bg-review-wash";
  const ink: Tone = running ? "restricted-on-wash" : "review-on-wash";
  // The buttons' outline is the banner's own ink, a control's boundary at well over 3:1 on the wash (section 4.2), and
  // CanvasText under forced colours.
  const border = cn(running ? "border-restricted-on-wash" : "border-review-on-wash", "web:forced-colors:border-[color:CanvasText]");
  return (
    <View role="region" aria-label={STANDING_TEXTS.banner.label} className={cn("gap-2 border-b px-4 py-3 web:forced-colors:border-[color:CanvasText]", tone)}>
      <View className="flex-row items-start gap-2">
        <View className="pt-[3px]">
          <Icon name={running ? "restricted" : "review"} size={16} tone={ink} />
        </View>
        <Text as="h2" variant="body-strong" tone={ink} className="shrink">
          {first}
        </Text>
      </View>
      {rest.map((sentence) => (
        <Text key={sentence} tone={ink}>
          {sentence}
        </Text>
      ))}
      <View className="mt-1 flex-row flex-wrap gap-2">
        <BannerLink label={STANDING_TEXTS.banner.read} href={decision} tone={ink} border={border} />
        {measure.replyOpen ? <BannerLink label={STANDING_TEXTS.banner.reply} href={`${decision}/reply`} tone={ink} border={border} /> : null}
        {measure.appealUntil !== null && !measure.appealPending ? <BannerLink label={STANDING_TEXTS.banner.appeal} href={decision} tone={ink} border={border} /> : null}
        <BannerLink label={STANDING_TEXTS.banner.export} href="/settings/account" tone={ink} border={border} />
        <BannerLink label={STANDING_TEXTS.banner.delete} href="/settings/account" tone={ink} border={border} />
      </View>
    </View>
  );
}
