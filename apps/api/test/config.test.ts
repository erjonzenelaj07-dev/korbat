import { describe, expect, test } from "vitest";
import { authConfigFrom } from "../src/auth/context";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");

const good = {
  DATABASE_URL_API: "postgres://korbat_api:x@localhost:5432/korbat",
  DATABASE_URL_AUTH: "postgres://korbat_auth:x@localhost:5432/korbat",
  REDIS_URL: "redis://localhost:6379",
  APP_ORIGIN: "http://localhost:8081",
  AUTH_HMAC_KEY: key,
  IP_HASH_KEY: key,
  TOTP_ENC_KEY: `v1:${key}`,
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "korbat <no-reply@korbat.local>",
  TERMS_VERSION: "draft-2026-09",
};

describe("loadConfig", () => {
  test("applies defaults", () => {
    const c = loadConfig(good);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.TRUSTED_ORIGINS).toEqual([]);
  });
  test("parses trusted origins list", () => {
    expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://a.test, http://b.test" }).TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
  test("fails loudly on a missing database url", () => {
    expect(() => loadConfig({ REDIS_URL: good.REDIS_URL })).toThrow(/DATABASE_URL_API/);
  });
  test("rejects keys shorter than 32 bytes", () => {
    expect(() => loadConfig({ ...good, AUTH_HMAC_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/AUTH_HMAC_KEY/);
  });
  test("TOTP key must be versioned and exactly 32 bytes", () => {
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: key })).toThrow(/TOTP_ENC_KEY/);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/TOTP_ENC_KEY/);
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
      const env: Record<string, string | undefined> = { ...good };
      delete env[name];
      expect(() => loadConfig(env), name).toThrow(new RegExp(name));
    }
  });
  test("TRUST_PROXY defaults to none and accepts the three modes", () => {
    expect(loadConfig(good).TRUST_PROXY).toBe("none");
    for (const mode of ["cloudflare", "caddy", "none"]) expect(loadConfig({ ...good, TRUST_PROXY: mode }).TRUST_PROXY).toBe(mode);
    expect(() => loadConfig({ ...good, TRUST_PROXY: "nginx" })).toThrow(/TRUST_PROXY/);
  });
  describe("production refuses development values", () => {
    const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
    test("accepts a production configuration", () => {
      expect(loadConfig(prod).NODE_ENV).toBe("production");
    });
    test("refuses Cloudflare's test secrets", () => {
      for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
        expect(() => loadConfig({ ...prod, TURNSTILE_SECRET_KEY: secret }), secret).toThrow(/TURNSTILE_SECRET_KEY/);
      }
    });
    test("requires https for the app origin and every trusted origin", () => {
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://korbat.example" })).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://a.example, http://b.example" })).toThrow(/TRUSTED_ORIGINS/);
    });
    test("development keeps accepting them", () => {
      expect(loadConfig(good).TURNSTILE_SECRET_KEY).toBe("1x0000000000000000000000000000000AA");
    });
  });
  test("previous TOTP keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).TOTP_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).TOTP_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, TOTP_ENC_KEYS_PREVIOUS: key })).toThrow(/TOTP_ENC_KEYS_PREVIOUS/);
  });
  test("media settings default to the development directories, every format and a 2 GiB free-space floor", () => {
    const c = loadConfig(good);
    expect(c.MEDIA_UPLOADS_DIR).toBe("../../.data/media/uploads");
    expect(c.MEDIA_STORE_DIR).toBe("../../.data/media/store");
    expect(c.MEDIA_FORMATS).toEqual(["jpeg", "png", "webp", "gif", "avif"]);
    expect(c.MEDIA_MIN_FREE_BYTES).toBe(2_147_483_648);
  });
  test("MEDIA_RECONCILE is on by default and takes off or force", () => {
    expect(loadConfig(good).MEDIA_RECONCILE).toBe("on");
    expect(loadConfig({ ...good, MEDIA_RECONCILE: "force" }).MEDIA_RECONCILE).toBe("force");
    expect(() => loadConfig({ ...good, MEDIA_RECONCILE: "maybe" })).toThrow(/MEDIA_RECONCILE/);
  });
  test("MEDIA_FORMATS enables a subset, and a typo stops the process instead of changing what is accepted", () => {
    expect(loadConfig({ ...good, MEDIA_FORMATS: "png, jpeg" }).MEDIA_FORMATS).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...good, MEDIA_FORMATS: "jpeg,tiff" })).toThrow(/unknown formats: tiff/);
    expect(loadConfig({ ...good, MEDIA_MIN_FREE_BYTES: "0", MEDIA_STORE_DIR: "/media/store" })).toMatchObject({ MEDIA_MIN_FREE_BYTES: 0, MEDIA_STORE_DIR: "/media/store" });
  });
  describe("the verification provider behind the badge", () => {
    test("is off by default, with the brand korbat and no Vonage credentials", () => {
      const c = loadConfig(good);
      expect(c.VERIFY_PROVIDER).toBe("off");
      expect(c.VERIFY_BRAND).toBe("korbat");
      expect(c.VONAGE_API_KEY).toBeUndefined();
      expect(c.VONAGE_API_SECRET).toBeUndefined();
    });
    test("is off, dev or vonage", () => {
      for (const provider of ["off", "dev", "vonage"]) expect(loadConfig({ ...good, VERIFY_PROVIDER: provider }).VERIFY_PROVIDER).toBe(provider);
      expect(() => loadConfig({ ...good, VERIFY_PROVIDER: "twilio" })).toThrow(/VERIFY_PROVIDER/);
      expect(loadConfig({ ...good, VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" })).toMatchObject({ VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" });
    });
    test("the brand is 1 to 18 characters without the characters Vonage refuses", () => {
      expect(loadConfig({ ...good, VERIFY_BRAND: "x".repeat(18) }).VERIFY_BRAND).toBe("x".repeat(18));
      expect(loadConfig({ ...good, VERIFY_BRAND: "My korbat 1" }).VERIFY_BRAND).toBe("My korbat 1");
      for (const brand of ["", "x".repeat(19), "kor/bat", "{korbat}", "kor:bat", "$korbat"]) {
        expect(() => loadConfig({ ...good, VERIFY_BRAND: brand }), JSON.stringify(brand)).toThrow(/VERIFY_BRAND/);
      }
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the development provider is refused, like the Turnstile test secret", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "dev" })).toThrow(/VERIFY_PROVIDER=dev is for development only/);
        expect(loadConfig({ ...good, VERIFY_PROVIDER: "dev" }).VERIFY_PROVIDER).toBe("dev");
      });
      test("vonage needs both the key and the secret; off needs nothing", () => {
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage" })).toThrow(/VONAGE_API_KEY/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234" })).toThrow(/VONAGE_API_SECRET/);
        expect(() => loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_SECRET: "s3cret" })).toThrow(/VONAGE_API_KEY/);
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "vonage", VONAGE_API_KEY: "abcd1234", VONAGE_API_SECRET: "s3cret" }).VERIFY_PROVIDER).toBe("vonage");
        expect(loadConfig({ ...prod, VERIFY_PROVIDER: "off" }).VERIFY_PROVIDER).toBe("off");
      });
    });
  });
  describe("the WebAuthn relying party", () => {
    test("defaults to the host of APP_ORIGIN and the name korbat; an empty value, as compose passes it, counts as unset", () => {
      expect(loadConfig(good)).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "", WEBAUTHN_RP_NAME: "" })).toMatchObject({ WEBAUTHN_RP_ID: "localhost", WEBAUTHN_RP_NAME: "korbat" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://127.0.0.1:8380" }).WEBAUTHN_RP_ID).toBe("127.0.0.1");
    });
    test("takes an explicit RP ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "Korbat.Example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      expect(loadConfig({ ...good, WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
      for (const rpId of ["https://korbat.example", "korbat.example:443", "korbat.example/path", "-korbat.example", "korbat..example", "korbat.example.", "kor bat.example", `${"a".repeat(64)}.example`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID/);
      }
    });
    test("the name is 1 to 64 printable characters", () => {
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" }).WEBAUTHN_RP_NAME).toBe("My korbat");
      expect(loadConfig({ ...good, WEBAUTHN_RP_NAME: "x".repeat(64) }).WEBAUTHN_RP_NAME).toBe("x".repeat(64));
      // A control character, a tab, and U+202E (the invisible right-to-left override).
      for (const name of ["x".repeat(65), `kor${String.fromCharCode(7)}bat`, `kor${String.fromCharCode(9)}bat`, `kor${String.fromCharCode(0x202e)}bat`]) {
        expect(() => loadConfig({ ...good, WEBAUTHN_RP_NAME: name }), JSON.stringify(name)).toThrow(/WEBAUTHN_RP_NAME/);
      }
    });
    test("the auth configuration exposes it, with APP_ORIGIN and TRUSTED_ORIGINS as the expected origins outside production", () => {
      expect(authConfigFrom(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006" })).webauthn).toEqual({
        rpId: "localhost",
        rpName: "korbat",
        origins: ["http://localhost:8081", "http://localhost:19006"],
      });
      expect(authConfigFrom(loadConfig({ ...good, WEBAUTHN_RP_NAME: "My korbat" })).webauthn).toEqual({ rpId: "localhost", rpName: "My korbat", origins: ["http://localhost:8081"] });
    });
    describe("in production", () => {
      const prod = { ...good, NODE_ENV: "production", APP_ORIGIN: "https://korbat.example", TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret" };
      test("the expected origin is APP_ORIGIN alone", () => {
        expect(authConfigFrom(loadConfig({ ...prod, TRUSTED_ORIGINS: "https://admin.korbat.example" })).webauthn).toEqual({
          rpId: "korbat.example",
          rpName: "korbat",
          origins: ["https://korbat.example"],
        });
      });
      test("the RP ID may be the host of APP_ORIGIN", () => {
        expect(loadConfig(prod).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
      });
      test("or a parent domain of that host, when it has a dot", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(loadConfig({ ...app, WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", WEBAUTHN_RP_ID: "korbat.example" }).WEBAUTHN_RP_ID).toBe("korbat.example");
        expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: "example" })).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
      });
      test("any other domain is refused: another site, a child of the host, or a suffix that is not a parent", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        for (const rpId of ["other.example", "sub.app.korbat.example", "pp.korbat.example", "korbat.example.net"]) {
          expect(() => loadConfig({ ...app, WEBAUTHN_RP_ID: rpId }), rpId).toThrow(/WEBAUTHN_RP_ID must be the host of APP_ORIGIN/);
        }
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.7", "https://[2001:db8::1]", "https://localhost", "https://app.localhost"]) {
          expect(() => loadConfig({ ...prod, APP_ORIGIN: origin }), origin).toThrow(/WEBAUTHN_RP_ID/);
        }
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://203.0.113.7", WEBAUTHN_RP_ID: "203.0.113.7" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        // A parent of an address is no domain either.
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://10.0.0.1", WEBAUTHN_RP_ID: "0.0.1" })).toThrow(/WEBAUTHN_RP_ID cannot be an IP address/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://app.localhost", WEBAUTHN_RP_ID: "localhost" })).toThrow(/WEBAUTHN_RP_ID cannot be localhost/);
      });
      test("development accepts all of them, since browsers treat localhost as secure", () => {
        expect(loadConfig({ ...good, APP_ORIGIN: "http://localhost:8081", WEBAUTHN_RP_ID: "localhost" }).WEBAUTHN_RP_ID).toBe("localhost");
        expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", WEBAUTHN_RP_ID: "other.example" }).WEBAUTHN_RP_ID).toBe("other.example");
      });
    });
  });
});
