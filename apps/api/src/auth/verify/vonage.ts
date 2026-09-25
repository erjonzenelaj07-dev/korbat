import { VerifyUnavailable, type VerificationOutcome, type VerificationProvider } from "./provider";

/** Vonage Verify v2 (developer.vonage.com/en/api/verify.v2). A check goes to this URL with the request id appended. */
const VERIFY_URL = "https://api.nexmo.com/v2/verify";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface VonageOptions {
  apiKey: string;
  apiSecret: string;
  /** The sender name in the text, 1 to 18 characters (VERIFY_BRAND). */
  brand: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The production adapter: one request starts a verification (Vonage texts a six-digit code and answers
 * 201 with a request id, the reference) and one checks the code against it. Written from the API
 * reference and unit-tested against its recorded shapes; the runbook (1b design, section 13) proves it
 * against the live API with real credentials. Every answer outside the documented ones, a network
 * error, a timeout and a malformed body are VerifyUnavailable. The phone number and the code appear in
 * no error message, so nothing here can log them; scripts/verify-badge.mjs repeats these two requests.
 */
export function vonageProvider({ apiKey, apiSecret, brand, fetch: fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: VonageOptions): VerificationProvider {
  const headers = {
    authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
    "content-type": "application/json",
  };

  /** One POST under the timeout, as the Turnstile client sends its own; a fetch that rejects (network, abort) is VerifyUnavailable with the cause. */
  async function post(url: string, body: unknown, what: string): Promise<Response> {
    try {
      return await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new VerifyUnavailable(`vonage ${what}: no answer`, { cause: err });
    }
  }

  /** The body as a JSON object, or null when it is anything else. */
  async function json(res: Response): Promise<Record<string, unknown> | null> {
    try {
      const body: unknown = await res.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return {
    async start(phone) {
      const res = await post(VERIFY_URL, { brand, workflow: [{ channel: "sms", to: phone }], code_length: 6 }, "start");
      if (res.status !== 201) throw new VerifyUnavailable(`vonage start answered ${res.status}`);
      const reference = (await json(res))?.request_id;
      if (typeof reference !== "string" || reference === "") throw new VerifyUnavailable("vonage start answered 201 without a request id");
      return { reference };
    },
    async check(reference, code) {
      const res = await post(`${VERIFY_URL}/${encodeURIComponent(reference)}`, { code }, "check");
      // 400 is a wrong code and 410 an expired request (Vonage also ends one after too many wrong codes).
      // A 404 means the request is gone, which the flow cannot tell from a provider fault, so it is not mapped.
      const outcomes: Record<number, VerificationOutcome> = { 400: "invalid_code", 410: "code_expired" };
      const known = outcomes[res.status];
      if (known) return known;
      if (res.status !== 200) throw new VerifyUnavailable(`vonage check answered ${res.status}`);
      if ((await json(res))?.status !== "completed") throw new VerifyUnavailable("vonage check answered 200 without a completed status");
      return "verified";
    },
  };
}
