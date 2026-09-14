import { describe, expect, test } from "vitest";
import { cloudflareTurnstile } from "../../src/auth/turnstile";

function fake(outcome: Response | Error) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as typeof fetch;
  return { fn, calls };
}

describe("turnstile", () => {
  test("posts the secret and token only, and accepts success: true", async () => {
    const f = fake(Response.json({ success: true }));
    expect(await cloudflareTurnstile("secret-key", f.fn).verify("widget-token")).toBe(true);
    expect(f.calls[0]!.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(f.calls[0]!.body).toEqual({ secret: "secret-key", response: "widget-token" });
  });
  test("success: false is rejected", async () => {
    expect(await cloudflareTurnstile("s", fake(Response.json({ success: false, "error-codes": ["invalid-input-response"] })).fn).verify("t")).toBe(false);
  });
  test("non-200 responses fail closed", async () => {
    expect(await cloudflareTurnstile("s", fake(new Response("", { status: 500 })).fn).verify("t")).toBe(false);
  });
  test("network errors fail closed", async () => {
    expect(await cloudflareTurnstile("s", fake(new Error("offline")).fn).verify("t")).toBe(false);
  });
});
