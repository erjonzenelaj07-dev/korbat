/**
 * The sign-in flow's words (UI design, sections 1.5 and 8.10), word for word as the six screens of app/(auth) had them
 * in their markup; the fields' and buttons' labels stay on the screens, where tests read them. New in UI Task 8: the
 * sign-in screen's heading names the screen, as its tab's title does, since the frame's wordmark already says korbat
 * above it, and the handle step's preview.
 */
export const AUTH_WORDS = {
  signinTitle: "Sign in",
  signinBody: "Enter your email. We'll send a code that signs you in, or creates your account if you don't have one yet.",
  codeTitle: "Check your email",
  codeBody: (email: string) => `We sent a 6-digit code to ${email}. It expires in 10 minutes.`,
  codeWait: (seconds: number) => `You can ask for a new code in ${seconds} s.`,
  passwordTitle: "Sign in",
  passwordBody: "Use the password you set in your security settings.",
  mfaTitle: "Two-factor authentication",
  mfaRecovery: "Enter one of your recovery codes. Each code works once; afterwards you'll be asked to set up two-factor again.",
  mfaCode: "Enter the 6-digit code from your authenticator app.",
  ageTitle: "Almost there",
  ageBody: "Your date of birth is checked once and never stored.",
  ageAccept: (version: string) => `I accept the korbat terms (${version}).`,
  refusedTitle: "Sorry",
  refusedBody: "You must be at least 16 to use korbat. No account was created.",
  handleTitle: "Choose your handle",
  handleBody: "Your handle is how people find you: 3 to 20 lowercase letters, numbers or underscores. You can use a pseudonym.",
  /** Above the live preview of the handle in the mono face (8.10), shown once something is typed. */
  handlePreview: "How it will look",
} as const;
