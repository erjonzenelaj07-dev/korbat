import type { Tone } from "./kit/Text";

/**
 * The closed list of icons korbat draws (UI design, section 4.7), each mapped to its Lucide 1.55.0 export name. The
 * names are strings, so this file imports neither icon package: kit/Icon.web.tsx imports the components from
 * lucide-react and kit/Icon.tsx from lucide-react-native, each as a Record<IconName, ...>, so tsc refuses a name that
 * either side lacks, only listed icons are bundled, and the web export and the unit tests never load the native set.
 * restricted and hidden share EyeOff: not shown to others, as on a hidden image (Lucide's Ban, a prohibition sign, is
 * not used). Trash2 is Lucide's own name, which 1.55.0 exports as an alias of Trash.
 */
export const ICONS = {
  home: "House",
  bookmarks: "Bookmark",
  profile: "CircleUser",
  settings: "Settings",
  compose: "SquarePen",
  reply: "MessageCircle",
  repost: "Repeat2",
  quote: "Quote",
  like: "Heart",
  more: "Ellipsis",
  "who-sees": "Eye",
  "copy-link": "Link",
  delete: "Trash2",
  report: "Flag",
  close: "X",
  back: "ArrowLeft",
  newer: "ArrowUp",
  previous: "ChevronLeft",
  next: "ChevronRight",
  "add-image": "ImagePlus",
  error: "CircleAlert",
  offline: "WifiOff",
  done: "CircleCheck",
  review: "Clock",
  restricted: "EyeOff",
  verified: "BadgeCheck",
  explore: "Compass",
  hidden: "EyeOff",
  security: "Shield",
  privacy: "Lock",
  "edit-profile": "UserPen",
  account: "UserCog",
  cases: "Scale",
  appearance: "Palette",
  "sign-in": "LogIn",
  passkey: "KeyRound",
  external: "ExternalLink",
  info: "Info",
  retry: "RotateCw",
} as const;

export type IconName = keyof typeof ICONS;

/** The sizes an icon is drawn at: 24 in the nav and tab bar, 20 in post actions, buttons and rows, 16 inline with meta text, 14 in chips. */
export type IconSize = 14 | 16 | 20 | 24;

/** What Icon takes, the same on web and native (kit/Icon.web.tsx and kit/Icon.tsx). */
export interface IconProps {
  name: IconName;
  /** Defaults to 20, the size of post actions, buttons and rows. */
  size?: IconSize;
  /** The colour, as Text's tones; ink-high by default. */
  tone?: Tone;
  /** Filled with its own colour: Heart and Bookmark when on. */
  filled?: boolean;
  /** Stroke 2.25 instead of 1.75: the current nav item, a reposted Repeat2. */
  strong?: boolean;
}
