import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** argon2id (the library default) with 64 MiB, 3 passes, 1 lane, 32-byte output. */
export const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 } as const;

export type PasswordLengthError = "password_too_short" | "password_too_long";

/** Length counted in Unicode code points, not UTF-16 units. */
export function checkPasswordLength(password: string): PasswordLengthError | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "password_too_short";
  if (length > PASSWORD_MAX) return "password_too_long";
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Always runs a full argon2id verification. When the account has no password (or does not exist)
 * it verifies against a fixed dummy hash, so response timing does not reveal which case applies.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  dummyHash ??= hash("korbat-timing-equaliser-not-a-password", ARGON2_OPTIONS);
  const target = stored ?? (await dummyHash);
  const ok = await verify(target, password);
  return stored !== null && ok;
}

/** True when a stored hash was made with weaker parameters than ARGON2_OPTIONS. */
export function needsRehash(stored: string): boolean {
  const { memoryCost, timeCost, parallelism } = ARGON2_OPTIONS;
  return !stored.startsWith(`$argon2id$v=19$m=${memoryCost},t=${timeCost},p=${parallelism}$`);
}

export class BreachCheckUnavailable extends Error {}

export interface BreachChecker {
  /** Resolves true when the password appears in a known breach. Throws BreachCheckUnavailable when the check cannot run. */
  isBreached(password: string): Promise<boolean>;
}

/**
 * Have I Been Pwned range API (k-anonymity): only the first 5 hex characters of the SHA-1 leave
 * the server, and padding hides the real number of matches.
 */
export function hibpChecker(fetchFn: typeof fetch = fetch, timeoutMs = 3000): BreachChecker {
  return {
    async isBreached(password) {
      const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);
      let res: Response;
      try {
        res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { "Add-Padding": "true", "User-Agent": "korbat-auth" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new BreachCheckUnavailable("breach check request failed", { cause: err });
      }
      if (!res.ok) throw new BreachCheckUnavailable(`breach check returned ${res.status}`);
      for (const line of (await res.text()).split(/\r?\n/)) {
        const [candidate, count] = line.split(":");
        if (candidate === suffix && Number(count) > 0) return true;
      }
      return false;
    },
  };
}
