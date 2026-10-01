import { isIP } from "node:net";
import { z } from "zod";
import { parseFormats } from "@korbat/media-protocol";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A base64 secret that decodes to at least 32 bytes. */
const base64Key = z
  .string()
  .regex(BASE64, "must be base64")
  .refine((s) => Buffer.from(s, "base64").length >= 32, "must decode to at least 32 bytes");

/** `v<N>:<base64>` decoding to exactly 32 bytes (AES-256). The version lets keys rotate. */
const versionedKey = z
  .string()
  .regex(/^v\d+:[A-Za-z0-9+/]+={0,2}$/, "must look like v1:<base64>")
  .refine((s) => Buffer.from(s.slice(s.indexOf(":") + 1), "base64").length === 32, "must decode to exactly 32 bytes");

/** Cloudflare's documented Turnstile test secrets: always pass, always fail, token spent. */
const TURNSTILE_TEST_SECRET = /^[123]x0+AA$/;

/** A secret that may be absent. Compose passes a blank line of infra/.env as an empty string, which counts as absent too. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** A setting whose blank value means "use the default": compose passes a variable infra/.env leaves empty as an empty string. */
const blankAsUnset = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/**
 * A domain name as WebAuthn takes an RP ID: dot-separated labels of letters, digits and hyphens, each at most 63
 * characters and neither starting nor ending with a hyphen; no scheme, port, path or final dot.
 */
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Printable text: no control, format, private-use or unassigned characters, and no line or paragraph separators. */
const PRINTABLE = /^[^\p{C}\p{Zl}\p{Zp}]+$/u;

/** The host of an origin as an RP ID would name it: lowercase, without the port or the brackets of an IPv6 address. */
function hostOf(origin: string): string {
  return new URL(origin).hostname.replace(/^\[(.*)\]$/, "$1");
}

/** localhost and its subdomains (RFC 6761): names that only ever mean this machine. */
function isLocalhost(name: string): boolean {
  return name === "localhost" || name.endsWith(".localhost");
}

/** Whether two values name the same origin, so `http://a.test/` and `http://a.test` count as one. An unparsable value is compared as written. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

/**
 * The staff console's origin (3a design, section 8), written exactly as a browser sends it in the Origin header: http or
 * https, a host and a port only when it is not the default, lowercase, with no path, not even a final slash. The staff gate
 * compares the Origin header with it as a string, so any other spelling would refuse every write the console makes.
 */
const consoleOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => URL.canParse(value) && new URL(value).origin === value, "must be an origin as browsers send it, such as https://console.example: scheme, lowercase host and port only, with no path or final slash");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_AUTH: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  KORBAT_VERSION: z.string().default("0.0.0-dev"),
  /**
   * Which header names the client: `cloudflare` behind the tunnel (cf-connecting-ip), `caddy` behind Caddy
   * alone (the first X-Forwarded-For entry, which Caddy sets itself), `none` for the socket address only.
   * A header the mode does not trust is ignored, so a client cannot choose its own rate-limit bucket.
   */
  TRUST_PROXY: z.enum(["cloudflare", "caddy", "none"]).default("none"),
  /** Origin of the web app; state-changing cookie requests must come from here (or TRUSTED_ORIGINS). */
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  /** Keys email codes, recovery codes, device ids and email rate-limit buckets. */
  AUTH_HMAC_KEY: base64Key,
  /** Keys IP addresses before they are stored or used as rate-limit buckets. */
  IP_HASH_KEY: base64Key,
  /** Encrypts TOTP secrets at rest. */
  TOTP_ENC_KEY: versionedKey,
  /** Earlier TOTP keys, comma-separated, still accepted for decryption; a secret read with one is re-encrypted with TOTP_ENC_KEY. */
  TOTP_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3),
  TERMS_VERSION: z.string().min(1).max(64),
  /** The uploads volume, which the API writes and the image worker only reads. The default suits `pnpm dev` from apps/api. */
  MEDIA_UPLOADS_DIR: z.string().min(1).default("../../.data/media/uploads"),
  /** The store volume, which the image worker writes and the API only reads. */
  MEDIA_STORE_DIR: z.string().min(1).default("../../.data/media/store"),
  /** A comma-separated subset of jpeg, png, webp, gif, avif; unset enables all. The worker reads the same variable. */
  MEDIA_FORMATS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseFormats(value);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: (err as Error).message });
        return z.NEVER;
      }
    }),
  /** Uploads are refused while either media volume has less free space than this. The volumes share a disk with Postgres. */
  MEDIA_MIN_FREE_BYTES: z.coerce.number().int().nonnegative().default(2 * 1024 ** 3),
  /**
   * The sweeper's reconcile pass deletes images that have no row. `on` refuses when there are many of them
   * (a database restored from an older snapshot looks like that); `force` deletes anyway; `off` skips the pass,
   * for the restore window.
   */
  MEDIA_RECONCILE: z.enum(["on", "off", "force"]).default("on"),
  /**
   * Who checks the phone number behind the verified badge: `off` hides the badge, `dev` accepts the code
   * 000000 and nothing else (development only), `vonage` texts a real code through Vonage Verify with the
   * two credentials below.
   */
  VERIFY_PROVIDER: z.enum(["off", "dev", "vonage"]).default("off"),
  VONAGE_API_KEY: optionalSecret,
  VONAGE_API_SECRET: optionalSecret,
  /** The sender name in the verification text. Vonage allows 1 to 18 characters and none of / { } : $. */
  VERIFY_BRAND: z.string().min(1).max(18).regex(/^[^\/{}:$]*$/, "must not contain / { } : or $").default("korbat"),
  /**
   * The relying party ID every passkey is bound to (1c design, section 11): the host of APP_ORIGIN when unset, or a
   * parent domain of it, which subdomains can then share. Changing it later strands every passkey already added.
   */
  WEBAUTHN_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as korbat.example: no scheme, port or path").optional()),
  /** The site name password managers show next to a korbat passkey. */
  WEBAUTHN_RP_NAME: blankAsUnset.pipe(z.string().max(64).regex(PRINTABLE, "must be printable: no control or invisible characters").default("korbat")),
  /**
   * The staff console's own origin (3a design, section 8). Unset, the console is off: no staff route is mounted and the
   * command line issues no enrolment. A blank value, as compose passes it, counts as unset.
   */
  CONSOLE_ORIGIN: blankAsUnset.pipe(consoleOrigin.optional()),
  /**
   * The relying party ID staff keys are bound to: the console's hostname when unset. Production requires exactly that
   * hostname, so staff keys work on the console and nowhere else; a parent domain was declined (3a design, section 2).
   */
  CONSOLE_RP_ID: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as console.example: no scheme, port or path").optional()),
}).superRefine((c, ctx) => {
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  // In every environment: an origin the app trusts is an allowed Origin for the app's cookie writes, a credentialed CORS
  // origin of the app's API and, outside production, an accepted origin for personal passkeys (3a design, section 8).
  if (c.CONSOLE_ORIGIN !== undefined) {
    if (sameOrigin(c.CONSOLE_ORIGIN, c.APP_ORIGIN)) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be APP_ORIGIN: the staff console needs an origin of its own");
    if (c.TRUSTED_ORIGINS.some((origin) => sameOrigin(origin, c.CONSOLE_ORIGIN!))) {
      refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must not be listed in TRUSTED_ORIGINS: the app would accept the console's requests as its own");
    }
  }
  if (c.NODE_ENV !== "production") return;
  if (TURNSTILE_TEST_SECRET.test(c.TURNSTILE_SECRET_KEY)) refuse("TURNSTILE_SECRET_KEY", "is a Turnstile test secret; production needs the secret of your own widget");
  if (!c.APP_ORIGIN.startsWith("https://")) refuse("APP_ORIGIN", "must be an https origin in production");
  for (const origin of c.TRUSTED_ORIGINS) if (!origin.startsWith("https://")) refuse("TRUSTED_ORIGINS", `${origin} is not an https origin`);
  // The development provider would hand the badge to anyone who types 000000.
  if (c.VERIFY_PROVIDER === "dev") refuse("VERIFY_PROVIDER", "VERIFY_PROVIDER=dev is for development only");
  if (c.VERIFY_PROVIDER === "vonage") {
    if (!c.VONAGE_API_KEY) refuse("VONAGE_API_KEY", "is required when VERIFY_PROVIDER is vonage");
    if (!c.VONAGE_API_SECRET) refuse("VONAGE_API_SECRET", "is required when VERIFY_PROVIDER is vonage");
  }
  // Browsers accept an RP ID only on its own host or a subdomain of it, and never an address; localhost would
  // bind every passkey to one machine. The dot keeps a bare top-level name out (browsers refuse public suffixes
  // such as co.uk themselves).
  const host = hostOf(c.APP_ORIGIN);
  const rpId = c.WEBAUTHN_RP_ID ?? host;
  if (isIP(rpId) || isIP(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be an IP address, nor can APP_ORIGIN name one: WebAuthn refuses them, so production needs a domain name");
  } else if (isLocalhost(rpId) || isLocalhost(host)) {
    refuse("WEBAUTHN_RP_ID", "WEBAUTHN_RP_ID cannot be localhost in production, nor can APP_ORIGIN name it");
  } else if (rpId !== host && !(host.endsWith(`.${rpId}`) && rpId.includes("."))) {
    refuse("WEBAUTHN_RP_ID", `WEBAUTHN_RP_ID must be the host of APP_ORIGIN (${host}) or a parent domain of it that has a dot`);
  }
  if (c.CONSOLE_ORIGIN === undefined) return;
  if (!c.CONSOLE_ORIGIN.startsWith("https://")) refuse("CONSOLE_ORIGIN", "CONSOLE_ORIGIN must be an https origin in production");
  const consoleHost = hostOf(c.CONSOLE_ORIGIN);
  // Ports separate neither sites nor cookies, so the console needs a hostname of its own. On a parent domain of the app's
  // hostname, the app's pages could ask for staff keys, whose relying party ID would then cover the app.
  if (consoleHost === host) refuse("CONSOLE_ORIGIN", `CONSOLE_ORIGIN must not be on the hostname of APP_ORIGIN (${host}), whatever its port`);
  if (host.endsWith(`.${consoleHost}`)) refuse("CONSOLE_ORIGIN", `APP_ORIGIN's hostname must not be a subdomain of the console's (${consoleHost})`);
  // The relying-party rules, like the app's above, bind staff keys to the console alone.
  const consoleRpId = c.CONSOLE_RP_ID ?? consoleHost;
  if (isIP(consoleHost) || isLocalhost(consoleHost)) {
    refuse("CONSOLE_RP_ID", "CONSOLE_RP_ID cannot be an IP address or localhost in production, nor can CONSOLE_ORIGIN name one: production needs a domain name");
  } else if (consoleRpId !== consoleHost) {
    refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must be the hostname of CONSOLE_ORIGIN (${consoleHost}) in production`);
  }
  if (consoleRpId === rpId) refuse("CONSOLE_RP_ID", `CONSOLE_RP_ID must differ from the app's relying party ID (${rpId}), so staff keys never work in the app`);
}).transform((c) => ({
  ...c,
  WEBAUTHN_RP_ID: c.WEBAUTHN_RP_ID ?? hostOf(c.APP_ORIGIN),
  CONSOLE_RP_ID: c.CONSOLE_RP_ID ?? (c.CONSOLE_ORIGIN === undefined ? undefined : hostOf(c.CONSOLE_ORIGIN)),
}));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
