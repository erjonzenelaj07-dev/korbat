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
    "A block hides you and the other account from each other while signed in and refuses their interactions. Posts on korbat are public, so anyone who signs out can still read them. A mute only hides an account from your timelines, and they are never told.",
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
