/**
 * The lockdown's words (1c design, sections 7.5 and 7.6; UI design, sections 1.5 and 8.10), word for word as the three
 * token pages and the Security screen's "This wasn't me" dialog had them, in one module: each says what confirming will
 * do and what it did, and names the lockdown's reach as it is, everything set up since the day before its anchor (which
 * can be a week earlier), the person's own later additions included. passkeys.test.tsx reads each block here.
 */

/** What the three pages share: a link that lost part of its token, the way back, and the way in again. */
export const LINK_WORDS = {
  incomplete: "This link is incomplete. Open it again from the email.",
  itWasMe: "It was me, go back",
  signIn: "Sign in",
} as const;

/** /email-revert/[token], from the "email address changed" notice sent to the old address. */
export const EMAIL_REVERT_WORDS = {
  title: "Undo the email change",
  body: "If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before the change.",
  confirm: "Move my account back to this address",
  doneTitle: "Your account is back at this address",
  doneBody:
    "Every session is signed out, including any in this browser. Sign in again with a code sent to this address. Your password was removed, and so were any passkeys and two-factor authentication set up since the day before the change; set them up again from Security.",
};

/** /not-me/[token], from the new-device email. */
export const NOT_ME_WORDS = {
  title: "This wasn't me",
  body: "If you didn't just sign in to korbat on a new device, confirm below. We'll sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before that sign-in, so only someone with your email can get back in.",
  confirm: "Sign out everywhere and lock down my account",
  doneTitle: "Your account is locked down",
  doneBody:
    "Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before that sign-in are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.",
};

/** /passkey-remove/[token], from the "passkey added" notice; it works for 7 days, and still once the passkey is gone. */
export const PASSKEY_REMOVE_WORDS = {
  title: "Remove this passkey",
  body: "If you did not add this passkey to your korbat account, confirm below. We'll remove it, sign out every session, including this browser, remove your password, and remove any passkeys and two-factor authentication set up since the day before it was added, so only someone with your email can get back in.",
  confirm: "Remove the passkey and lock down my account",
  doneTitle: "Your account is locked down",
  doneBody:
    "The passkey is removed. Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up since the day before it was added are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.",
};

/** The Security screen's question behind "This wasn't me" on a new passkey, whose passkey can be a week old by then. */
export const NOT_MINE_WORDS = {
  title: "Lock down your account?",
  body: (name: string) =>
    `If you did not add the passkey named ${name}, confirm below. Every session is signed out, including this browser, your password is removed, and every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it, so only someone with your email can get back in.`,
};
