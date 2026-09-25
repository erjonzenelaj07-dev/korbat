import { randomToken } from "../crypto";
import type { VerificationProvider } from "./provider";

/** The one code the development provider accepts. */
export const DEV_CODE = "000000";

/**
 * The provider behind VERIFY_PROVIDER=dev: no text is sent, the reference is random, exactly the code
 * 000000 verifies, anything else is a wrong code, and a reference never expires. Because it would hand
 * the badge to anyone who types 000000, the config guard refuses it when NODE_ENV is production
 * (config.ts), like the Turnstile test secret.
 */
export function devProvider(): VerificationProvider {
  return {
    async start() {
      return { reference: randomToken() };
    },
    async check(_reference, code) {
      return code === DEV_CODE ? "verified" : "invalid_code";
    },
  };
}
