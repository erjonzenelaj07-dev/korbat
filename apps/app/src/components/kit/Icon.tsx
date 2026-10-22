import type { LucideIcon } from "lucide-react-native";
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
} from "lucide-react-native";
import type { IconName, IconProps } from "@/components/icons";
import { useTheme } from "@/theme/ThemeProvider";
import { TONE_TOKEN } from "./Text";

/**
 * An icon on iOS and Android (UI design, sections 4.7 and 6.3): lucide-react-native over react-native-svg, the same
 * names and version as the web's, hidden from accessibility services; the control around it carries the name. Its
 * colour is the tone's token in the reader's theme.
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
  const { colors } = useTheme();
  const Drawn = COMPONENTS[name];
  const color = colors[TONE_TOKEN[tone]];
  return <Drawn size={size} color={color} strokeWidth={strong ? 2.25 : 1.75} fill={filled ? color : "none"} accessible={false} />;
}
