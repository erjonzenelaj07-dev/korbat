import type { LucideIcon } from "lucide-react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import BadgeCheck from "lucide-react/dist/esm/icons/badge-check.mjs";
import Bookmark from "lucide-react/dist/esm/icons/bookmark.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert.mjs";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check.mjs";
import CircleUser from "lucide-react/dist/esm/icons/circle-user.mjs";
import Clock from "lucide-react/dist/esm/icons/clock.mjs";
import Compass from "lucide-react/dist/esm/icons/compass.mjs";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import Flag from "lucide-react/dist/esm/icons/flag.mjs";
import Heart from "lucide-react/dist/esm/icons/heart.mjs";
import House from "lucide-react/dist/esm/icons/house.mjs";
import Import from "lucide-react/dist/esm/icons/import.mjs";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus.mjs";
import Info from "lucide-react/dist/esm/icons/info.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import Link from "lucide-react/dist/esm/icons/link.mjs";
import Lock from "lucide-react/dist/esm/icons/lock.mjs";
import LogIn from "lucide-react/dist/esm/icons/log-in.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import Palette from "lucide-react/dist/esm/icons/palette.mjs";
import Quote from "lucide-react/dist/esm/icons/quote.mjs";
import Repeat2 from "lucide-react/dist/esm/icons/repeat-2.mjs";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw.mjs";
import Scale from "lucide-react/dist/esm/icons/scale.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import SquarePen from "lucide-react/dist/esm/icons/square-pen.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import UserCog from "lucide-react/dist/esm/icons/user-cog.mjs";
import UserPen from "lucide-react/dist/esm/icons/user-pen.mjs";
import WifiOff from "lucide-react/dist/esm/icons/wifi-off.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import type { IconName, IconProps } from "@/components/icons";
import { TONE_CLASS } from "./Text";

/**
 * An icon on web (UI design, sections 4.7 and 6.3): lucide-react's plain svg, decoration only, so it is hidden from
 * assistive technology and never takes the focus; the control around it carries the name. Its colour is the tone's
 * class, which the svg's stroke follows as currentColor, so a forced Dark scope recolours it with its text.
 *
 * Each icon comes from its own module. lucide-react's main entry re-exports every icon of the set, and Metro keeps
 * whatever a module re-exports, so a named import from it put the whole set in the web bundle (about 240 KB gzip); only
 * these files are bundled now. The package ships no types for them, so lucide-icons.d.ts types each as a LucideIcon.
 */
const COMPONENTS: Record<IconName, LucideIcon> = {
  home: House,
  bookmarks: Bookmark,
  profile: CircleUser,
  settings: Settings,
  compose: SquarePen,
  reply: MessageCircle,
  repost: Repeat2,
  quote: Quote,
  like: Heart,
  more: Ellipsis,
  "who-sees": Eye,
  "copy-link": Link,
  delete: Trash2,
  report: Flag,
  close: X,
  back: ArrowLeft,
  newer: ArrowUp,
  previous: ChevronLeft,
  next: ChevronRight,
  "add-image": ImagePlus,
  error: CircleAlert,
  offline: WifiOff,
  done: CircleCheck,
  review: Clock,
  restricted: EyeOff,
  verified: BadgeCheck,
  explore: Compass,
  hidden: EyeOff,
  security: Shield,
  privacy: Lock,
  "edit-profile": UserPen,
  account: UserCog,
  cases: Scale,
  appearance: Palette,
  "sign-in": LogIn,
  passkey: KeyRound,
  external: ExternalLink,
  info: Info,
  retry: RotateCw,
  import: Import,
};

/** Lucide's 24 px drawing has a stroke of 2; korbat draws 1.75, scaled with the icon, and 2.25 when strong. */
export function Icon({ name, size = 20, tone = "high", filled = false, strong = false }: IconProps) {
  const Drawn = COMPONENTS[name];
  return (
    <Drawn
      size={size}
      strokeWidth={strong ? 2.25 : 1.75}
      fill={filled ? "currentColor" : "none"}
      className={TONE_CLASS[tone]}
      aria-hidden="true"
      focusable="false"
    />
  );
}
