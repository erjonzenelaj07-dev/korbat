import type { LucideIcon } from "lucide-react-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import BadgeCheck from "lucide-react-native/icons/badge-check";
import Bookmark from "lucide-react-native/icons/bookmark";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleUser from "lucide-react-native/icons/circle-user";
import Clock from "lucide-react-native/icons/clock";
import Compass from "lucide-react-native/icons/compass";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import ExternalLink from "lucide-react-native/icons/external-link";
import Eye from "lucide-react-native/icons/eye";
import EyeOff from "lucide-react-native/icons/eye-off";
import Flag from "lucide-react-native/icons/flag";
import Heart from "lucide-react-native/icons/heart";
import House from "lucide-react-native/icons/house";
import ImagePlus from "lucide-react-native/icons/image-plus";
import Info from "lucide-react-native/icons/info";
import KeyRound from "lucide-react-native/icons/key-round";
import Link from "lucide-react-native/icons/link";
import Lock from "lucide-react-native/icons/lock";
import LogIn from "lucide-react-native/icons/log-in";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Palette from "lucide-react-native/icons/palette";
import Quote from "lucide-react-native/icons/quote";
import Repeat2 from "lucide-react-native/icons/repeat-2";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import Scale from "lucide-react-native/icons/scale";
import Settings from "lucide-react-native/icons/settings";
import Shield from "lucide-react-native/icons/shield";
import SquarePen from "lucide-react-native/icons/square-pen";
import Trash2 from "lucide-react-native/icons/trash";
import UserCog from "lucide-react-native/icons/user-cog";
import UserPen from "lucide-react-native/icons/user-pen";
import WifiOff from "lucide-react-native/icons/wifi-off";
import X from "lucide-react-native/icons/x";
import type { IconName, IconProps } from "@/components/icons";
import { useTheme } from "@/theme/ThemeProvider";
import { TONE_TOKEN } from "./Text";

/**
 * An icon on iOS and Android (UI design, sections 4.7 and 6.3): lucide-react-native over react-native-svg, the same
 * names and version as the web's, hidden from accessibility services; the control around it carries the name. Its
 * colour is the tone's token in the reader's theme.
 *
 * Each icon comes from its own module (the package's `icons/*` export), so the bundle carries these icons and not the
 * whole set its main entry re-exports. 1.55.0 has no module of its own for the alias Trash2, which is Trash.
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
