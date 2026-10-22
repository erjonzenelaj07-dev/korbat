import type { MeResponse, ProfileView } from "@korbat/contracts";
import { Menu, MenuPanel, type MenuItem } from "@/components/kit/Menu";
import { reportHref } from "@/lib/moderation";
import { REPORT_WORDS } from "@/lib/moderation-words";
import { useSession } from "@/lib/session";
import { UI_WORDS, fill } from "@/lib/ui-words";
import { useLayout } from "@/theme/layout";

/**
 * A profile's More menu (UI design, section 8.4, decision 12), for anyone but the profile's owner: Mute or Unmute and
 * Block or Unblock for a signed-in reader, then Report, signed in or out, as a link to the report form (3c design,
 * section 9). Report left the profile's row of controls for this menu, as it left the post's. Null for the owner, who
 * gets no menu at all.
 */
export function profileMenuItems(profile: ProfileView, me: MeResponse | null, handlers: { onMute: () => void; onBlock: () => void }): MenuItem[] | null {
  if (me !== null && profile.id === me.user.id) return null;
  const items: MenuItem[] = [];
  const viewer = profile.viewer;
  if (me && viewer) {
    items.push({ label: viewer.muted ? UI_WORDS["profile.unmute"] : UI_WORDS["profile.mute"], icon: "hidden", onSelect: handlers.onMute });
    items.push({ label: viewer.blocked ? UI_WORDS["profile.unblock"] : UI_WORDS["profile.block"], icon: "privacy", onSelect: handlers.onBlock });
  }
  items.push({ label: REPORT_WORDS.control, icon: "report", href: reportHref({ account: profile.handle }) });
  return items;
}

/** The menu drawn open, for the render tests: the items a reader gets on this profile, or nothing on their own. */
export function ProfileMenuPanel({ profile }: { profile: ProfileView }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const layout = useLayout() === "phone" ? "phone" : "wide";
  const items = profileMenuItems(profile, me, { onMute: () => undefined, onBlock: () => undefined });
  if (!items) return null;
  return <MenuPanel label={fill(UI_WORDS["profile.more"], { handle: profile.handle })} items={items} layout={layout} onPick={() => undefined} />;
}

/** The More button and its menu, beside Follow. */
export function ProfileMenu({ profile, onMute, onBlock }: { profile: ProfileView; onMute: () => void; onBlock: () => void }) {
  const { state } = useSession();
  const me = state.status === "signed-in" ? state.me : null;
  const items = profileMenuItems(profile, me, { onMute, onBlock });
  if (!items) return null;
  return <Menu label={fill(UI_WORDS["profile.more"], { handle: profile.handle })} icon="more" items={items} />;
}
