import { describe, expect, test } from "vitest";
import { verificationProviderFrom } from "../../src/auth";
import { DEV_CODE } from "../../src/auth/verify/dev";
import { loadConfig } from "../../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  COUNTS_URL: "redis://localhost:56380",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  NOTIFIER_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("the verification provider VERIFY_PROVIDER names", () => {
  test("off, the default, is no provider, so the badge routes answer badge_unavailable", () => {
    expect(verificationProviderFrom(loadConfig(good))).toBeNull();
    expect(verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "off" }))).toBeNull();
  });

  test("dev is the fixed-code provider", async () => {
    const provider = verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }))!;
    const { reference } = await provider.start("+447911123456");
    expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await provider.check(reference, DEV_CODE)).toBe("verified");
    expect(await provider.check(reference, "123456")).toBe("invalid_code");
  });

  test("vonage needs both credentials, in development too, and sends them with the brand", async () => {
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    expect(() => verificationProviderFrom(loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" }))).toThrow(/VONAGE_API_KEY and VONAGE_API_SECRET/);
    const calls: { url: string; authorization: string | null; body: string }[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      return Response.json({ request_id: "ref-1" }, { status: 201 });
    }) as typeof fetch;
    const config = loadConfig({ ...good, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret", VERIFY_BRAND: "My korbat" });
    const provider = verificationProviderFrom(config, fetchFn)!;
    expect(await provider.start("+447911123456")).toEqual({ reference: "ref-1" });
    expect(calls).toEqual([
      {
        url: "https://api.nexmo.com/v2/verify",
        authorization: `Basic ${Buffer.from("abcd1234:s3cret").toString("base64")}`,
        body: JSON.stringify({ brand: "My korbat", workflow: [{ channel: "sms", to: "+447911123456" }], code_length: 6 }),
      },
    ]);
  });
});
