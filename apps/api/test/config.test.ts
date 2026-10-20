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
  NOTIFIER_ENC_KEY: `v1:${key}`,
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
  test("the notifier key must be versioned and exactly 32 bytes, as the TOTP key is", () => {
    expect(loadConfig(good).NOTIFIER_ENC_KEY).toBe(`v1:${key}`);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: key })).toThrow(/NOTIFIER_ENC_KEY/);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: `v1:${Buffer.alloc(33).toString("base64")}` })).toThrow(/NOTIFIER_ENC_KEY/);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEY: "" })).toThrow(/NOTIFIER_ENC_KEY/);
  });
  test("previous notifier keys are optional, comma-separated and each versioned", () => {
    expect(loadConfig(good).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: "" }).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([]);
    expect(loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: `v0:${key}, v1:${key}` }).NOTIFIER_ENC_KEYS_PREVIOUS).toEqual([`v0:${key}`, `v1:${key}`]);
    expect(() => loadConfig({ ...good, NOTIFIER_ENC_KEYS_PREVIOUS: key })).toThrow(/NOTIFIER_ENC_KEYS_PREVIOUS/);
  });
  test("the auth configuration holds the notifier key and the keys it replaced, parsed", () => {
    const older = Buffer.alloc(32, 9).toString("base64");
    const auth = authConfigFrom(loadConfig({ ...good, NOTIFIER_ENC_KEY: `v2:${key}`, NOTIFIER_ENC_KEYS_PREVIOUS: `v1:${older}` }));
    expect(auth.notifierKey).toEqual({ version: "v2", key: Buffer.alloc(32, 7) });
    expect(auth.notifierPreviousKeys).toEqual([{ version: "v1", key: Buffer.alloc(32, 9) }]);
    expect(authConfigFrom(loadConfig(good)).notifierPreviousKeys).toEqual([]);
  });
  describe("the moderation settings", () => {
    test("MODERATION_DISPATCH_HOUR is an hour of the UTC day, 7 unless set; a blank value is the default", () => {
      expect(loadConfig(good).MODERATION_DISPATCH_HOUR).toBe(7);
      for (const blank of ["", "   "]) expect(loadConfig({ ...good, MODERATION_DISPATCH_HOUR: blank }).MODERATION_DISPATCH_HOUR, JSON.stringify(blank)).toBe(7);
      for (const [written, hour] of [["0", 0], ["7", 7], ["23", 23], [" 12 ", 12]] as const) {
        expect(loadConfig({ ...good, MODERATION_DISPATCH_HOUR: written }).MODERATION_DISPATCH_HOUR, written).toBe(hour);
      }
      for (const refused of ["24", "-1", "7.5", "yes"]) {
        expect(() => loadConfig({ ...good, MODERATION_DISPATCH_HOUR: refused }), refused).toThrow(/MODERATION_DISPATCH_HOUR/);
      }
    });
    test("MODERATION_RETENTION is on unless set to off; a blank value is on and nothing else is taken", () => {
      expect(loadConfig(good).MODERATION_RETENTION).toBe("on");
      // Compose passes an empty line of infra/.env as an empty value: a blank must never read as "off", which stops every erasure.
      for (const blank of ["", " ", "   "]) expect(loadConfig({ ...good, MODERATION_RETENTION: blank }).MODERATION_RETENTION, JSON.stringify(blank)).toBe("on");
      expect(loadConfig({ ...good, MODERATION_RETENTION: "on" }).MODERATION_RETENTION).toBe("on");
      expect(loadConfig({ ...good, MODERATION_RETENTION: "off" }).MODERATION_RETENTION).toBe("off");
      for (const refused of ["yes", "no", "true", "false", "1", "0", "ON", "Off", "paused"]) {
        expect(() => loadConfig({ ...good, MODERATION_RETENTION: refused }), refused).toThrow(/MODERATION_RETENTION/);
      }
    });

    test("3f: HOME_STATE is a state korbat has facts for, CONTACT_POINT an address; both unset by default, and the home state required once the contact point is set", () => {
      expect(loadConfig(good).HOME_STATE).toBeUndefined();
      expect(loadConfig(good).CONTACT_POINT).toBeUndefined();
      expect(loadConfig({ ...good, HOME_STATE: " " }).HOME_STATE).toBeUndefined();
      expect(loadConfig({ ...good, HOME_STATE: "DE" }).HOME_STATE).toBe("DE");
      // A member state whose facts are not filled in, a code that is no member state, and a lower-case one are refused.
      for (const refused of ["AT", "US", "de"]) expect(() => loadConfig({ ...good, HOME_STATE: refused }), refused).toThrow(/HOME_STATE/);
      expect(loadConfig({ ...good, HOME_STATE: "DE", CONTACT_POINT: "orders@korbat.example" }).CONTACT_POINT).toBe("orders@korbat.example");
      expect(() => loadConfig({ ...good, CONTACT_POINT: "orders@korbat.example" })).toThrow(/HOME_STATE/);
      expect(() => loadConfig({ ...good, HOME_STATE: "DE", CONTACT_POINT: "not an address" })).toThrow(/CONTACT_POINT/);
    });

    test("3f: NOTIFY is off by default outside production and on in production; a blank value is the default, and nothing but on and off is taken", () => {
      expect(loadConfig(good).NOTIFY).toBe("off");
      expect(loadConfig({ ...good, NOTIFY: " " }).NOTIFY).toBe("off");
      expect(loadConfig({ ...good, NOTIFY: "on" }).NOTIFY).toBe("on");
      expect(loadConfig({ ...good, NODE_ENV: "test" }).NOTIFY).toBe("off");
      for (const refused of ["yes", "1", "ON", "Off"]) expect(() => loadConfig({ ...good, NOTIFY: refused }), refused).toThrow(/NOTIFY/);
    });
    test("3f Task 5: REPORT_HOLD is on unless set to off; a blank value is the default, and nothing but on and off is taken", () => {
      expect(loadConfig(good).REPORT_HOLD).toBe("on");
      expect(loadConfig({ ...good, REPORT_HOLD: " " }).REPORT_HOLD).toBe("on");
      expect(loadConfig({ ...good, REPORT_HOLD: "off" }).REPORT_HOLD).toBe("off");
      for (const refused of ["no", "0", "OFF"]) expect(() => loadConfig({ ...good, REPORT_HOLD: refused }), refused).toThrow(/REPORT_HOLD/);
    });

    test("MODERATION_DEFER_UNPROVEN is off unless set to on; a blank value is the default and nothing else is taken", () => {
      expect(loadConfig(good).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "" }).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: " " }).MODERATION_DEFER_UNPROVEN).toBe("off");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "on" }).MODERATION_DEFER_UNPROVEN).toBe("on");
      expect(loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: "off" }).MODERATION_DEFER_UNPROVEN).toBe("off");
      for (const refused of ["yes", "true", "1", "ON"]) {
        expect(() => loadConfig({ ...good, MODERATION_DEFER_UNPROVEN: refused }), refused).toThrow(/MODERATION_DEFER_UNPROVEN/);
      }
    });
  });
  test("SMTP_URL must be smtp or smtps", () => {
    expect(() => loadConfig({ ...good, SMTP_URL: "http://relay.example" })).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...good, SMTP_URL: "smtps://user:pass@relay.example:465" }).SMTP_URL).toMatch(/^smtps:/);
  });
  test("every auth variable is required", () => {
    for (const name of ["APP_ORIGIN", "AUTH_HMAC_KEY", "IP_HASH_KEY", "TOTP_ENC_KEY", "NOTIFIER_ENC_KEY", "TURNSTILE_SECRET_KEY", "SMTP_URL", "MAIL_FROM", "TERMS_VERSION"]) {
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
      // 3f: production judges the alert channel's health unless the operator switches it off.
      expect(loadConfig(prod).NOTIFY).toBe("on");
      expect(loadConfig({ ...prod, NOTIFY: "" }).NOTIFY).toBe("on");
      expect(loadConfig({ ...prod, NOTIFY: "off" }).NOTIFY).toBe("off");
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
  test("3d Task 4: RECIPIENTS_SIGNED_OUT is on unless set to off; a blank value is on, and nothing but on and off is taken", () => {
    expect(loadConfig(good).RECIPIENTS_SIGNED_OUT).toBe("on");
    expect(loadConfig({ ...good, RECIPIENTS_SIGNED_OUT: "" }).RECIPIENTS_SIGNED_OUT).toBe("on");
    expect(loadConfig({ ...good, RECIPIENTS_SIGNED_OUT: "off" }).RECIPIENTS_SIGNED_OUT).toBe("off");
    for (const refused of ["no", "OFF", "0"]) expect(() => loadConfig({ ...good, RECIPIENTS_SIGNED_OUT: refused }), refused).toThrow(/RECIPIENTS_SIGNED_OUT/);
  });
  describe("3d Task 3: the app's site and the edge's purge adapter (design, sections 5 and 10.8; 12.1 row 27)", () => {
    const zone = "0123456789abcdef0123456789abcdef";
    const token = "edge_token_that_must_never_be_seen_0123";
    const cloudflare = { ...good, EDGE_PURGE: "cloudflare", EDGE_ZONE_ID: zone, EDGE_API_TOKEN: token, EDGE_HOST: "korbat.example" };
    test("APP_SITE is open unless set to closed; a blank value is the default, and nothing but open and closed is taken", () => {
      expect(loadConfig(good).APP_SITE).toBe("open");
      expect(loadConfig({ ...good, APP_SITE: " " }).APP_SITE).toBe("open");
      expect(loadConfig({ ...good, APP_SITE: "closed" }).APP_SITE).toBe("closed");
      for (const refused of ["shut", "CLOSED", "0"]) expect(() => loadConfig({ ...good, APP_SITE: refused }), refused).toThrow(/APP_SITE/);
    });
    test("EDGE_PURGE is off unless set; a blank value is off, and nothing but off, test and cloudflare is taken", () => {
      const c = loadConfig(good);
      expect([c.EDGE_PURGE, c.EDGE_ZONE_ID, c.EDGE_API_TOKEN, c.EDGE_HOST]).toEqual(["off", undefined, undefined, undefined]);
      expect(loadConfig({ ...good, EDGE_PURGE: "", EDGE_ZONE_ID: "", EDGE_API_TOKEN: "", EDGE_HOST: "" }).EDGE_PURGE).toBe("off");
      expect(() => loadConfig({ ...good, EDGE_PURGE: "fastly" })).toThrow(/EDGE_PURGE/);
    });
    test("the test adapter is refused while the app's site is open, in every environment, and taken on a site that is closed", () => {
      expect(() => loadConfig({ ...good, EDGE_PURGE: "test" })).toThrow(/EDGE_PURGE=test is refused while APP_SITE is open/);
      expect(() => loadConfig({ ...good, EDGE_PURGE: "test", APP_SITE: "" })).toThrow(/EDGE_PURGE=test/);
      expect(loadConfig({ ...good, EDGE_PURGE: "test", APP_SITE: "closed" }).EDGE_PURGE).toBe("test");
    });
    test("cloudflare is refused without its zone, its token or its host, each named; with the three it is taken, the site open", () => {
      for (const missing of ["EDGE_ZONE_ID", "EDGE_API_TOKEN", "EDGE_HOST"]) {
        expect(() => loadConfig({ ...cloudflare, [missing]: "" }), missing).toThrow(new RegExp(`${missing}[^]*is required when EDGE_PURGE is cloudflare`));
      }
      expect(loadConfig(cloudflare)).toMatchObject({ EDGE_PURGE: "cloudflare", EDGE_ZONE_ID: zone, EDGE_API_TOKEN: token, EDGE_HOST: "korbat.example", APP_SITE: "open" });
    });
    test("the zone is an id of 32 hexadecimal characters, the host a bare domain name, and the token one word of the provider's characters", () => {
      expect(() => loadConfig({ ...cloudflare, EDGE_ZONE_ID: "my-zone" })).toThrow(/EDGE_ZONE_ID/);
      for (const host of ["https://korbat.example", "korbat.example/", "korbat.example:443"]) expect(() => loadConfig({ ...cloudflare, EDGE_HOST: host }), host).toThrow(/EDGE_HOST/);
      expect(loadConfig({ ...cloudflare, EDGE_HOST: "Korbat.Example" }).EDGE_HOST).toBe("korbat.example");
      // A line break would let the token's value carry a header of its own: built from its code, as no file holds one.
      for (const bad of ["short", `${token} more`, `${token}${String.fromCharCode(10)}Injected: 1`]) expect(() => loadConfig({ ...cloudflare, EDGE_API_TOKEN: bad }), bad).toThrow(/EDGE_API_TOKEN/);
    });
    test("a refusal never prints the token", () => {
      for (const env of [{ ...cloudflare, EDGE_ZONE_ID: "" }, { ...cloudflare, EDGE_API_TOKEN: `${token} more` }, { ...cloudflare, EDGE_HOST: "" }]) {
        let message = "";
        try {
          loadConfig(env);
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message).not.toBe("");
        expect(message).not.toContain(token);
      }
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
  describe("the staff console (3a design, section 8)", () => {
    const consoleOrigin = "http://localhost:8090";
    test("is off unless CONSOLE_ORIGIN is set; a blank value, as compose passes it, counts as unset", () => {
      for (const blank of [undefined, "", "   "]) {
        const c = loadConfig({ ...good, CONSOLE_ORIGIN: blank, CONSOLE_RP_ID: blank });
        expect(c.CONSOLE_ORIGIN, JSON.stringify(blank)).toBeUndefined();
        expect(c.CONSOLE_RP_ID, JSON.stringify(blank)).toBeUndefined();
      }
    });
    test("takes the console's origin, and its relying party ID defaults to the console's hostname", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "localhost" });
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: " http://console.localhost:8090 ", CONSOLE_RP_ID: "" })).toMatchObject({
        CONSOLE_ORIGIN: "http://console.localhost:8090",
        CONSOLE_RP_ID: "console.localhost",
      });
      // The app's relying party is untouched by the console's.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090" }).WEBAUTHN_RP_ID).toBe("localhost");
    });
    test("takes an explicit relying party ID in lowercase, and only a bare domain name", () => {
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://console.localhost:8090", CONSOLE_RP_ID: "Console.Localhost" }).CONSOLE_RP_ID).toBe("console.localhost");
      for (const rpId of ["http://console.localhost", "console.localhost:8090", "console.localhost/", "-console.localhost", "console..localhost"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID/);
      }
    });
    test("must be an origin exactly as a browser sends it: http or https, a host, a port only when it is not the default", () => {
      // The staff gate compares the Origin header with this value as a string.
      for (const origin of ["localhost:8090", "ftp://localhost:8090", "http://localhost:8090/", "http://localhost:8090/console", "http://localhost:8090?x=1", "http://user@localhost:8090", "https://console.example:443", "http://Console.Localhost:8090"]) {
        expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_ORIGIN/);
      }
    });
    test("is refused in every environment when it is the app's origin or one of the trusted origins", () => {
      expect(() => loadConfig({ ...good, CONSOLE_ORIGIN: good.APP_ORIGIN })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      // The same origin written with a final slash is still the same origin.
      expect(() => loadConfig({ ...good, APP_ORIGIN: "http://localhost:8090/", CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `http://localhost:19006, ${consoleOrigin}`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(() => loadConfig({ ...good, TRUSTED_ORIGINS: `${consoleOrigin}/`, CONSOLE_ORIGIN: consoleOrigin })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      expect(loadConfig({ ...good, TRUSTED_ORIGINS: "http://localhost:19006", CONSOLE_ORIGIN: consoleOrigin }).CONSOLE_ORIGIN).toBe(consoleOrigin);
    });
    describe("in production", () => {
      const prod = {
        ...good,
        NODE_ENV: "production",
        APP_ORIGIN: "https://korbat.example",
        TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-widget-secret",
        CONSOLE_ORIGIN: "https://staff-korbat.example",
      };
      test("accepts a console on a domain of its own or on a subdomain of the app's, with its hostname as the relying party ID", () => {
        expect(loadConfig(prod)).toMatchObject({ CONSOLE_ORIGIN: "https://staff-korbat.example", CONSOLE_RP_ID: "staff-korbat.example", WEBAUTHN_RP_ID: "korbat.example" });
        expect(loadConfig({ ...prod, CONSOLE_ORIGIN: "https://console.korbat.example", CONSOLE_RP_ID: "console.korbat.example" }).CONSOLE_RP_ID).toBe("console.korbat.example");
        // A name that merely ends like the app's is not a parent of it.
        expect(loadConfig({ ...prod, APP_ORIGIN: "https://mykorbat.example", CONSOLE_ORIGIN: "https://korbat.example" }).CONSOLE_RP_ID).toBe("korbat.example");
      });
      test("the console is still off when CONSOLE_ORIGIN is unset", () => {
        const c = loadConfig({ ...prod, CONSOLE_ORIGIN: "" });
        expect(c.CONSOLE_ORIGIN).toBeUndefined();
        expect(c.CONSOLE_RP_ID).toBeUndefined();
      });
      test("requires https", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "http://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must be an https origin in production/);
      });
      test("refuses the app's origin and the trusted origins, as everywhere", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be APP_ORIGIN/);
        expect(() => loadConfig({ ...prod, TRUSTED_ORIGINS: "https://staff-korbat.example" })).toThrow(/CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS/);
      });
      test("refuses the app's hostname with another port, since ports separate neither sites nor cookies", () => {
        expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: "https://korbat.example:8443" })).toThrow(/CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN/);
      });
      test("refuses a console on a parent domain of the app's hostname", () => {
        const app = { ...prod, APP_ORIGIN: "https://app.korbat.example" };
        expect(() => loadConfig({ ...app, CONSOLE_ORIGIN: "https://korbat.example" })).toThrow(/APP_ORIGIN's hostname must not be a subdomain of the console's/);
        expect(() => loadConfig({ ...prod, APP_ORIGIN: "https://a.b.korbat.example", CONSOLE_ORIGIN: "https://b.korbat.example" })).toThrow(/must not be a subdomain of the console's/);
      });
      test("the relying party ID must be the console's hostname, never a parent domain of it", () => {
        const sub = { ...prod, CONSOLE_ORIGIN: "https://console.korbat-staff.example" };
        expect(loadConfig({ ...sub, CONSOLE_RP_ID: "console.korbat-staff.example" }).CONSOLE_RP_ID).toBe("console.korbat-staff.example");
        for (const rpId of ["korbat-staff.example", "other.example", "sub.console.korbat-staff.example"]) {
          expect(() => loadConfig({ ...sub, CONSOLE_RP_ID: rpId }), rpId).toThrow(/CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN/);
        }
      });
      test("the relying party ID must differ from the app's", () => {
        // The app's passkeys on the parent domain korbat.example, the console on that domain itself: both rules refuse it.
        const shared = { ...prod, APP_ORIGIN: "https://app.korbat.example", WEBAUTHN_RP_ID: "korbat.example", CONSOLE_ORIGIN: "https://korbat.example" };
        expect(() => loadConfig(shared)).toThrow(/CONSOLE_RP_ID must differ from the app's relying party ID \(korbat\.example\)/);
      });
      test("never an IP address or localhost", () => {
        for (const origin of ["https://203.0.113.9", "https://[2001:db8::2]", "https://localhost:8090", "https://console.localhost"]) {
          expect(() => loadConfig({ ...prod, CONSOLE_ORIGIN: origin }), origin).toThrow(/CONSOLE_RP_ID cannot be an IP address or localhost in production/);
        }
      });
    });
    test("development accepts what only production refuses: http, the app's hostname, a shared or foreign relying party ID", () => {
      // Both relying party IDs are localhost in development; only the tables keep staff keys and passkeys apart there.
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin })).toMatchObject({ CONSOLE_RP_ID: "localhost", WEBAUTHN_RP_ID: "localhost" });
      expect(loadConfig({ ...good, APP_ORIGIN: "http://app.localhost:8081", CONSOLE_ORIGIN: "http://localhost:8090" }).CONSOLE_RP_ID).toBe("localhost");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: consoleOrigin, CONSOLE_RP_ID: "other.example" }).CONSOLE_RP_ID).toBe("other.example");
      expect(loadConfig({ ...good, CONSOLE_ORIGIN: "http://127.0.0.1:8090" }).CONSOLE_RP_ID).toBe("127.0.0.1");
    });
  });
});
