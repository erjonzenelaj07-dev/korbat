import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleUser,
  Clock,
  Compass,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Heart,
  House,
  ImagePlus,
  Info,
  KeyRound,
  Link,
  Lock,
  LogIn,
  MessageCircle,
  Palette,
  Quote,
  Repeat2,
  RotateCw,
  Scale,
  Settings,
  Shield,
  SquarePen,
  Trash2,
  UserCog,
  UserPen,
  WifiOff,
  X,
} from "lucide-react";
import type { IconName, IconProps } from "@/components/icons";
import { TONE_CLASS } from "./Text";

/**
 * An icon on web (UI design, sections 4.7 and 6.3): lucide-react's plain svg, decoration only, so it is hidden from
 * assistive technology and never takes the focus; the control around it carries the name. Its colour is the tone's
 * class, which the svg's stroke follows as currentColor, so a forced Dark scope recolours it with its text.
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
