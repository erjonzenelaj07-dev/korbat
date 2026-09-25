import { describe, expect, test } from "vitest";
import { VerifyUnavailable } from "../../src/auth/verify/provider";
import { vonageProvider } from "../../src/auth/verify/vonage";

const PHONE = "+447911123456";
const CODE = "123456";
const REFERENCE = "c11d2e44-1f55-4e0e-9a3c-2b1f7d8e9a01";
const CREDENTIALS = { apiKey: "abcd1234", apiSecret: "s3cret-value", brand: "korbat" };
const BASIC = `Basic ${Buffer.from("abcd1234:s3cret-value").toString("base64")}`;

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | null | undefined;
}

/** A fetch that records every request and answers from the queue in order; an Error in the queue is thrown instead. */
function fake(...outcomes: (Response | Error)[]) {
  const calls: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal,
    });
    const outcome = outcomes.shift();
    if (outcome === undefined) throw new Error("the fake fetch has no answer left");
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return { fn, calls };
}

/** A fetch that never answers: it rejects with the signal's reason once the adapter's timeout aborts it. */
const waiting = ((_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)))) as typeof fetch;

const provider = (fetchFn: typeof fetch, timeoutMs?: number) => vonageProvider({ ...CREDENTIALS, fetch: fetchFn, timeoutMs });
const json = (status: number, body: unknown) => Response.json(body, { status });

/** The VerifyUnavailable a call rejects with; anything else fails the test. */
async function unavailable(promise: Promise<unknown>): Promise<VerifyUnavailable> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof VerifyUnavailable) return err;
    throw err;
  }
  throw new Error("expected VerifyUnavailable");
}

describe("vonage verify: starting a verification", () => {
  test("posts the brand, one SMS workflow to the number and a six-digit code with Basic authentication, and takes the request id as the reference", async () => {
    const f = fake(json(201, { request_id: REFERENCE }));
    expect(await provider(f.fn).start(PHONE)).toEqual({ reference: REFERENCE });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.nexmo.com/v2/verify");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(BASIC);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(call.body!) as { workflow: unknown[] };
    expect(body).toEqual({ brand: "korbat", workflow: [{ channel: "sms", to: PHONE }], code_length: 6 });
    // The number travels in the workflow's `to` field and nowhere else: not the URL, not a header, not another field.
    const { workflow, ...rest } = body;
    expect(JSON.stringify({ url: call.url, headers: call.headers, rest })).not.toContain(PHONE);
    expect(JSON.stringify(workflow).split(PHONE)).toHaveLength(2);
  });

  test("every other answer is VerifyUnavailable: another status, a missing or non-string request id, a body that is not JSON", async () => {
    const answers: [string, Response][] = [
      ["200 instead of 201", json(200, { request_id: REFERENCE })],
      ["422 for a number Vonage refuses", json(422, { title: "Invalid Request", detail: "The number is not valid", instance: "bf0ca0bf" })],
      ["409 for a verification already in progress", json(409, { title: "Conflict", detail: "Concurrent verifications to the same number are not allowed" })],
      ["500", new Response("", { status: 500 })],
      ["201 without a request id", json(201, {})],
      ["201 with a numeric request id", json(201, { request_id: 12345 })],
      ["201 with a body that is not JSON", new Response("<html>gateway</html>", { status: 201, headers: { "content-type": "text/html" } })],
    ];
    for (const [name, res] of answers) {
      const err = await unavailable(provider(fake(res).fn).start(PHONE));
      expect(err.message, name).not.toContain(PHONE);
    }
  });

  test("a fetch that rejects, and one that never answers within the timeout, are VerifyUnavailable with the cause attached", async () => {
    const offline = new TypeError("fetch failed");
    const rejected = await unavailable(provider(fake(offline).fn).start(PHONE));
    expect(rejected.cause).toBe(offline);
    const timedOut = await unavailable(provider(waiting, 20).start(PHONE));
    expect(timedOut.cause).toMatchObject({ name: "TimeoutError" });
    expect(`${rejected.message} ${timedOut.message}`).not.toContain(PHONE);
  });
});

describe("vonage verify: checking a code", () => {
  test("posts the code to the request's own URL with the same authentication, and reads a completed request as verified", async () => {
    const f = fake(json(200, { request_id: REFERENCE, status: "completed" }));
    expect(await provider(f.fn).check(REFERENCE, CODE)).toBe("verified");
    const call = f.calls[0]!;
    expect(call.url).toBe(`https://api.nexmo.com/v2/verify/${REFERENCE}`);
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe(BASIC);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(call.body!)).toEqual({ code: CODE });
  });

  test("400 is a wrong code and 410 an expired one, whatever the body says", async () => {
    const wrong = json(400, { title: "Invalid Code", detail: "The code you provided does not match the expected value." });
    expect(await provider(fake(wrong).fn).check(REFERENCE, CODE)).toBe("invalid_code");
    expect(await provider(fake(new Response("", { status: 400 })).fn).check(REFERENCE, CODE)).toBe("invalid_code");
    const expired = json(410, { title: "Invalid Code", detail: "An incorrect code has been provided too many times. Workflow terminated." });
    expect(await provider(fake(expired).fn).check(REFERENCE, CODE)).toBe("code_expired");
    expect(await provider(fake(new Response("", { status: 410 })).fn).check(REFERENCE, CODE)).toBe("code_expired");
  });

  test("every other answer is VerifyUnavailable, and no message holds the code", async () => {
    const answers: [string, Response | Error][] = [
      ["404 for a request that is gone", json(404, { title: "Not Found", detail: "Request was not found or it has been verified already." })],
      ["429", json(429, { title: "Rate Limit Hit" })],
      ["503", new Response("", { status: 503 })],
      ["200 that is not completed", json(200, { request_id: REFERENCE, status: "failed" })],
      ["200 with a body that is not JSON", new Response("<html>gateway</html>", { status: 200 })],
      ["a fetch that rejects", new TypeError("fetch failed")],
    ];
    for (const [name, answer] of answers) {
      const err = await unavailable(provider(fake(answer).fn).check(REFERENCE, CODE));
      expect(err.message, name).not.toContain(CODE);
    }
    const timedOut = await unavailable(provider(waiting, 20).check(REFERENCE, CODE));
    expect(timedOut.cause).toMatchObject({ name: "TimeoutError" });
    expect(timedOut.message).not.toContain(CODE);
  });

  test("the reference is escaped in the URL", async () => {
    const f = fake(json(200, { status: "completed" }));
    await provider(f.fn).check("odd/ref?x", CODE);
    expect(f.calls[0]!.url).toBe("https://api.nexmo.com/v2/verify/odd%2Fref%3Fx");
  });
});
