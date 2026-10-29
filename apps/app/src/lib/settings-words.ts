/**
 * The words of Settings' Security, Privacy, Profile and Account pages and of components/security (UI design, sections
 * 1.5 and 8.8), word for word as their markup had them, so the screens hold no bare sentence. The labels of fields and
 * buttons, and the notes an action leaves behind, stay on the screens, where tests read them in the source. The
 * lockdown's sentences live in lib/lockdown-words.ts, the sign-in flow's in lib/auth-words.ts. What is new in UI Task 8:
 * the facts of a passkey and of a session are joined by commas instead of middle dots (section 4.1 has no middle-dot
 * meta strings), and the Blocked and Muted tabs' list has a name.
 */

/** U+2026, built in code so this file stays plain ASCII, as the sessions list wrote its loading line. */
const ELLIPSIS = String.fromCharCode(0x2026);

export const SECURITY_WORDS = {
  mfaSetup: "Scan this QR code with an authenticator app, then enter the 6-digit code it shows.",
  mfaKey: "Can't scan it? Enter this key:",
  mfaCodes: "Save these recovery codes somewhere safe. Each works once, and they are the only way back into your account if you lose your authenticator. They won't be shown again.",
  mfaDisable: "Two-factor authentication will be turned off, and your recovery codes stop working. You will be asked to confirm it's you first.",
  passkeysBody: "A passkey signs you in with your fingerprint, face, PIN or a security key, and cannot be phished. You can have up to 10.",
  passkeysLoading: "Loading passkeys...",
  passkeysNone: "You have no passkeys yet.",
  passkeysUnsupported: "This browser cannot add a passkey. Use a recent browser on a device with a screen lock, or a password manager that stores passkeys.",
  passkeyAdded: (date: string) => `added ${date}`,
  passkeyLastUsed: (when: string) => `last used ${when}`,
  passkeyNeverUsed: "never used",
  passkeyAddedOn: (device: string) => `added on ${device}`,
  addTitle: "Add a passkey",
  addBody: "Your browser or password manager will ask you to confirm with your fingerprint, face, PIN or security key.",
  addNameHint: "Optional: what korbat calls this passkey in the list.",
  addLabelHint: "Your password manager shows this name to anyone who can see this device.",
  sessionsLoading: `Loading sessions${ELLIPSIS}`,
  thisDevice: "this device",
  sessionFacts: (platform: string, signedIn: string, lastActive: string) => `${platform}, signed in ${signedIn}, last active ${lastActive}`,
  sessionSignOut: "Sign out",
  platform: { web: "Web", ios: "iPhone or iPad", android: "Android" },
  reauthTitle: "Confirm it's you",
  reauthTwo: "This change needs two factors because two-factor authentication is on. ",
  reauthFresh: "This change needs a fresh confirmation. ",
  reauthSecond: "You confirmed a first factor; add a second one: an authenticator code, a recovery code, or a passkey that checks your fingerprint, face or PIN. ",
  reauthFirst: "You confirmed a second factor; add a first one: your password, an email code or a passkey. ",
  reauthValid: "It stays valid for 5 minutes.",
  reauthPasskey: "Confirm with a passkey of this account. The browser will ask for it.",
} as const;

export const PRIVACY_WORDS = {
  explore: "Explore",
  explain:
    "A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can still read them. A mute hides an account from your timelines and your Activity, and they are never told.",
  /** 2d (decision 21, 10.8): the Link previews card, off until the person turns it on, and the note on search engines. */
  previews: "Link previews",
  previewsSwitch: "Show a preview when someone shares a link to my posts or profile",
  previewsExplain:
    "When this is on, a link to your post or profile shared on another site shows your display name, your handle, the post's text or your bio and its first image or your profile picture, as anyone signed out sees them, and that site may keep its copy after you delete the post, where korbat cannot remove it.",
  search: "korbat asks search engines not to list your posts and your profile, and turns away every crawler but the link-preview fetchers.",
  /** The name of the Blocked and Muted tab list (6.10 requires one). */
  tabs: "Blocked and muted accounts",
  blocked: "Blocked",
  muted: "Muted",
  emptyBlocked: "You have not blocked anyone.",
  emptyMuted: "You have not muted anyone.",
  unblock: "Unblock",
  unmute: "Unmute",
} as const;

export const PROFILE_WORDS = {
  loading: "Loading your profile...",
  formBody: "Your display name is shown next to your posts. The bio is one line on your profile.",
  nextChange: (date: string) => `Your next change is allowed on ${date}.`,
} as const;

export const ACCOUNT_WORDS = {
  emailBody: (email: string) => `Your address is ${email}. Sign-in codes and security messages go there, and nobody else sees it.`,
  emailSent: (email: string) => `We sent a code to ${email}. Enter it to move your account to that address. Every session stays signed in.`,
  badgeBody:
    "The Verified badge means you hold a phone number that no other account uses. To check it, the number is handed to the verification provider for one text message; korbat keeps it only as a keyed hash, never the number itself.",
  badgeHeld: "Your account holds the badge.",
  badgeSent: (phone: string) => `We texted a code to ${phone}.`,
  phoneHint: "International format: a plus sign, the country code and the number, without the leading zero.",
  exportBody:
    "The archive is a ZIP with export.json (your account, profile, posts, likes, reposts, bookmarks, follows, blocks, mutes, sessions, devices and security events) and every image you uploaded. It holds your email address, so keep it somewhere private. You can export once a day.",
  exportNative: "Export your data from the web app.",
  deleteMore: "Your likes, reposts, bookmarks, follows, blocks and mutes are removed too. Your handle stays reserved, so nobody can take it. This cannot be undone.",
  deleteSent: (email: string) => `We emailed a code to ${email}.`,
} as const;

/** 2d (decisions 7 and 8, 10.8): Settings, Activity, and its row in the Settings index. */
export const ACTIVITY_SETTINGS_WORDS = {
  nav: "Activity",
  hint: "Who can reach you in Activity",
  intro:
    "Choose what shows in your Activity. korbat never tells you about replies, mentions, quotes or follows anywhere else: no email, no push and no badge. Decisions about your posts and account also come by email.",
  replies: "Replies to your posts",
  mentions: "Mentions of you",
  quotes: "Quotes of your posts",
  follows: "New followers",
  everyone: "Everyone",
  older: "Accounts older than 2 days",
  following: "Accounts you follow",
  off: "Off",
  on: "On",
  muted: "Accounts you mute or block never show in your Activity.",
  fromNow: "A change applies from now on. It does not bring back what was not shown.",
  saved: "Saved",
  failed: "Your choice could not be saved. Try again.",
} as const;

/**
 * 2d (decision 14, 7.7 and 10.5): the profile picture's card on Settings, Profile. `previewPart` names the preview by the
 * part kept; `resetRecently` is the API's avatar_reset sentence word for word (apps/api/src/media/context.ts).
 */
export const AVATAR_WORDS = {
  section: "Profile picture",
  explain:
    "Your picture is public: anyone can see it, signed in or not, and link previews show it on other sites if you turn them on in Privacy. A picture of you can identify you. korbat keeps only the square you choose and removes the photo's location and camera details.",
  choose: "Choose a picture",
  change: "Choose another picture",
  remove: "Remove picture",
  keep: "Which part to keep",
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
  preview: "Preview of your profile picture",
  previewPart: "Preview of your profile picture, {part} part kept",
  use: "Use this picture",
  cancel: "Cancel",
  uploading: "Uploading your picture...",
  processing: "Preparing your picture...",
  updated: "Profile picture updated",
  removed: "Profile picture removed",
  failed: "This picture could not be used. Try another one.",
  resetRecently: "A moderator removed this picture from your profile less than 30 days ago, so it cannot be your profile picture again yet.",
  confirmTitle: "Remove your profile picture?",
  confirmBody: "korbat deletes it. You can choose a picture again at any time.",
  confirm: "Remove",
} as const;
