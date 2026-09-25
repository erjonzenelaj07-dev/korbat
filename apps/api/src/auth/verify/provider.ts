/** What a check of the code the provider texted came to. */
export type VerificationOutcome = "verified" | "invalid_code" | "code_expired";

/**
 * Proof of holding a phone number, behind the verified badge (1b design, section 7.4). `start` has the
 * provider text a code to the number and returns the provider's reference for it; `check` hands the code
 * the user typed back for that reference. Both throw VerifyUnavailable when the provider could not be
 * asked at all, which the flow answers with verify_unavailable (503) so the user tries again later. The
 * number passes through here and is never kept, logged or put in an error message.
 */
export interface VerificationProvider {
  start(phone: string): Promise<{ reference: string }>;
  check(reference: string, code: string): Promise<VerificationOutcome>;
}

/** The provider could not be reached or did not answer as documented; the cause, when there is one, is attached. */
export class VerifyUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VerifyUnavailable";
  }
}
