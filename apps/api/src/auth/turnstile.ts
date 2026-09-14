export interface TurnstileVerifier {
  /** Resolves true only when Cloudflare confirms the token. Every failure resolves false (fail closed). */
  verify(token: string): Promise<boolean>;
}

/** Server-side Turnstile check. Sends the secret and the token only, never the user's IP. */
export function cloudflareTurnstile(secret: string, fetchFn: typeof fetch = fetch, timeoutMs = 5000): TurnstileVerifier {
  return {
    async verify(token) {
      try {
        const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret, response: token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { success?: unknown };
        return body.success === true;
      } catch {
        return false;
      }
    },
  };
}
