import { isIP } from "node:net";
import { z } from "zod";
import { IMPORT_RULES, IMPORT_SOURCE_KINDS, STATE_FACTS } from "@korbat/contracts";
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

/** A PostgreSQL connection URL. The staff command line reads the database URLs it needs with the same rule (cli/staff.ts). */
export const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** The mail relay and the sender, which the command line's mailer reads with the same rules (cli/mail.ts). */
export const smtpUrl = z.url({ protocol: /^smtps?$/ });
export const mailFrom = z.string().min(3);

/**
 * CONSOLE_ORIGIN and CONSOLE_RP_ID as `staff.js enroll` reads them, by the API's own rules for each value (cli/staff.ts),
 * so a link is issued only for a console the API would run.
 */
export const consoleOriginSetting = blankAsUnset.pipe(consoleOrigin.optional());
export const consoleRpIdSetting = blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as console.example: no scheme, port or path").optional());

/** The console's hostname, which CONSOLE_RP_ID defaults to. */
export const consoleHostOf = (origin: string): string => hostOf(origin);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL_API: databaseUrl,
  DATABASE_URL_AUTH: databaseUrl,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /**
   * 3d review H3: the counts store, a Valkey of its own that writes nothing to disk (Compose's `counts`), which holds the
   * recipients' count alone: the day's salt and the month's and the days' sketches. Never the shared Valkey of REDIS_URL,
   * whose append-only file keeps every write.
   */
  COUNTS_URL: z.url({ protocol: /^rediss?$/ }),
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
  /**
   * Encrypts what a signed-out notifier gave to be told about their notice: a name, an address and the token of the
   * mails' link (3c design, section 6.1). Back it up as TOTP_ENC_KEY is: without it korbat can neither mail a notifier
   * nor answer who sent a notice.
   */
  NOTIFIER_ENC_KEY: versionedKey,
  /**
   * Earlier notifier keys, comma-separated, still accepted for decryption. A contact is never re-encrypted, so a key
   * stays here for as long as a contact it encrypted is kept.
   */
  NOTIFIER_ENC_KEYS_PREVIOUS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(versionedKey)),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  SMTP_URL: smtpUrl,
  MAIL_FROM: mailFrom,
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
  CONSOLE_ORIGIN: consoleOriginSetting,
  /**
   * The relying party ID staff keys are bound to: the console's hostname when unset. Production requires exactly that
   * hostname, so staff keys work on the console and nowhere else; a parent domain was declined (3a design, section 2).
   */
  CONSOLE_RP_ID: consoleRpIdSetting,
  /**
   * The hour of the UTC day (0 to 23) at which the day's decisions on reports and notices are released to those who sent
   * them, in one batch (3c design, section 7.8): the batch hides the minute a decision landed. A blank value, as compose
   * passes it, is the default.
   */
  MODERATION_DISPATCH_HOUR: blankAsUnset.pipe(z.coerce.number<string>().int().min(0).max(23).default(7)),
  /**
   * The published emergency switch of the queue (3c design, section 2): `on` sorts cases whose open items all come from
   * unproven sources after the others of their lane, never below a less severe lane. `off` is the default.
   */
  MODERATION_DEFER_UNPROVEN: blankAsUnset.pipe(z.enum(["on", "off"]).default("off")),
  /**
   * The retention job's switch (3c design, section 7.9), on unless set to off. Off only for a restore window: a restored
   * database no longer holds the cases, freezes and seals made after its backup, so the job would erase evidence and delete
   * images they protected; the README's restore steps turn it off before the API starts and on again once the seals stand.
   * While it is off nothing is erased or deleted, the API logs a warning at every start, and the console counts what is late.
   */
  MODERATION_RETENTION: blankAsUnset.pipe(z.enum(["on", "off"]).default("on")),
  /**
   * 3f (design, sections 5 and 10.7): whether the alert tick judges the alert channel's health, its third step: `off`
   * skips that step alone, and the tick still writes and mails every alert; the console's home then says that phone
   * alerts are switched off on this server. Until the contact point's mailbox exists the operator sets it off; otherwise a
   * stack without a watcher would mail "Phone alerts are down" daily. Blank means the default: off outside production,
   * on in production.
   */
  NOTIFY: blankAsUnset.pipe(z.enum(["on", "off"]).optional()),
  /**
   * 3f (design, sections 2 row 35, 7.15 and 10.7): whether a deletion keeps an account's address while a report of its
   * sealed images to the authorities is owed, for at most ORDER_RULES.reportHoldDays: everything else of the account goes
   * at once. On unless set to off; off restores 1b's purge, which overwrites the address at once.
   */
  REPORT_HOLD: blankAsUnset.pipe(z.enum(["on", "off"]).default("on")),
  /**
   * 3f (design, sections 2 row 41 and 10.7): the operator's Member State, a key of the contracts' STATE_FACTS (a state whose
   * facts are filled in), from which an order is judged cross-border and the console reads the register's entries and
   * Annex II's copy address. Unset until the owner names it; required once CONTACT_POINT is set.
   */
  HOME_STATE: blankAsUnset.pipe(
    z
      .string()
      .refine((code) => Object.hasOwn(STATE_FACTS, code), { message: "must be a state whose facts the contracts' STATE_FACTS holds (Germany's, DE, is filled in)" })
      .optional(),
  ),
  /** 3f: the published contact point for authorities, an address; empty until the owner's list is done. */
  CONTACT_POINT: blankAsUnset.pipe(z.email().optional()),
  /**
   * 3d (design, sections 2 row 49, 5 and 10.8): Caddy's switch of the app's site (3f), which Compose hands the API too: the
   * API reads it only to refuse a `test` adapter while the site is `open`, so a stand-in never answers for a third party
   * on a site people can reach. Blank means the default.
   */
  APP_SITE: blankAsUnset.pipe(z.enum(["open", "closed"]).default("open")),
  /**
   * 3d Task 3 (design, sections 5 "The adapters" and 7.4): who drops an image's copies at the edge once it stops being
   * public. `off` (the default) closes every outbox row as off and the header is the only bound; `test` keeps the
   * prefixes in memory (refused while APP_SITE is open); `cloudflare` sends one purge by prefix with the three settings
   * below, which it requires.
   */
  EDGE_PURGE: blankAsUnset.pipe(z.enum(["off", "test", "cloudflare"]).default("off")),
  /** The zone's id, as the provider shows it: 32 hexadecimal characters. */
  EDGE_ZONE_ID: blankAsUnset.pipe(z.string().regex(/^[0-9a-f]{32}$/, "must be the zone's id: 32 hexadecimal characters").optional()),
  /**
   * The provider's API token with the one permission Zone, Cache Purge: a secret, in no log line, audit row or answer.
   * One word of the provider's characters, so its value can never carry a line of its own into the request's headers.
   */
  EDGE_API_TOKEN: optionalSecret.pipe(z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, "must be the provider's API token: one word of letters, digits, dashes and underscores").optional()),
  /** The public hostname images are served under at the edge, bare: a prefix is <EDGE_HOST>/api/media/<id>/. */
  EDGE_HOST: blankAsUnset.pipe(z.string().toLowerCase().regex(RP_ID, "must be a bare domain name such as korbat.example: no scheme, port or path").optional()),
  /**
   * 3d Task 4 (design, sections 2 row 8, 7.5 and 10.8): whether readers without an account are counted among the
   * recipients, each day's by a keyed digest of the network and the browser's name under a salt that lives 26 hours. On
   * unless set to off, the owner's to decide; off leaves the second figure out, and the pages say "at least".
   */
  RECIPIENTS_SIGNED_OUT: blankAsUnset.pipe(z.enum(["on", "off"]).default("on")),
  /**
   * 3d Task 5 (design, sections 2 row 9, 5 "The adapters", 7.7 and 10.8): who witnesses the audit head's daily value.
   * `off` (the default): the value stands on the transparency page and in the keeper's mail only; `test` answers a fixed
   * token (refused while APP_SITE is open); `rfc3161` asks the timestamp authority at HEAD_WITNESS_URL, which it requires.
   */
  HEAD_WITNESS: blankAsUnset.pipe(z.enum(["off", "test", "rfc3161"]).default("off")),
  /** The timestamp authority's address, https: the API posts one RFC 3161 request a day there, the value and nothing else. */
  HEAD_WITNESS_URL: blankAsUnset.pipe(z.url({ protocol: /^https$/ }).optional()),
  /**
   * The keeper's address (design, sections 7.7 and 10.8): the one address the head's daily mail goes to, with the day, the
   * value, the place and the hash. Empty, no such mail is sent. No account and no staff list receives that mail.
   */
  HEAD_KEEPER_MAIL: blankAsUnset.pipe(z.email().optional()),
  /**
   * 3d Task 6 (design, sections 2 rows 19, 23 and 49, 5 "The adapters" and 10.8): the R1 scorer, which the worker reads
   * too and which the API reads for the threshold a score is compared with. `off` (the default): no score, and R1 stays
   * report-driven; `test`: the test scorer's own threshold 0.5 under version 0 (refused while APP_SITE is open); `onnx`:
   * the real classifier, which this build does not carry, so it stops the process at start.
   */
  R1_CLASSIFIER: blankAsUnset.pipe(z.enum(["off", "test", "onnx"]).default("off")),
  /** Whether a score at or over the threshold also withholds its image until a moderator decides (row 19); off by default. */
  AUTOMATION_R1_ACTS: blankAsUnset.pipe(z.enum(["on", "off"]).default("off")),
  /**
   * The day of the owner's impact assessment for the R1 check, and the day on which it covered the check's measure (row
   * 49), each a date or empty. A real classifier needs the first, and with AUTOMATION_R1_ACTS=on the second; the facts
   * route prints both in the R1 block, and neither stands over the other tool.
   */
  AUTOMATION_DPIA_R1: blankAsUnset.pipe(z.iso.date().optional()),
  AUTOMATION_DPIA_R1_ACTS: blankAsUnset.pipe(z.iso.date().optional()),
  /**
   * 3d Task 7 (design, sections 2 rows 27 to 35 and 49, 5 "The adapters" and 10.8): the comparison of uploads with known
   * material, unprefixed since the worker reads it too. `off` (the default): no hash is computed and nothing is compared;
   * `test`: the test matcher on the repository's two byte-constant files (refused while APP_SITE is open); a source's name:
   * no such adapter in this build, so it stops the process at start until the owner's later task adds one.
   */
  MEDIA_MATCH: blankAsUnset.pipe(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, "must be off, test or a source's name: lower-case letters, digits, dashes and underscores").default("off")),
  /** Whether an acting match on a post also seals the post's images until an admin answers (row 27); on by default. */
  AUTOMATION_R2_ACTS: blankAsUnset.pipe(z.enum(["on", "off"]).default("on")),
  /**
   * The day of the owner's impact assessment for the comparison, and the day on which it covered the comparison's measure
   * (row 49), each a date or empty. A real source needs the first, and with AUTOMATION_R2_ACTS=on the second; the facts
   * route prints both in the comparison's block, and neither stands over the R1 check.
   */
  AUTOMATION_DPIA_MATCH: blankAsUnset.pipe(z.iso.date().optional()),
  AUTOMATION_DPIA_MATCH_ACTS: blankAsUnset.pipe(z.iso.date().optional()),
  /**
   * 3b (design, section 7.7): import from other platforms. `off` refuses every new import (imports_unavailable); running
   * imports finish. On unless set to off; a blank value is the default.
   */
  IMPORTS: blankAsUnset.pipe(z.enum(["on", "off"]).default("on")),
  /**
   * Whether a new import brings images (decision 15): off unless on, and refused below while MEDIA_MATCH is off, since an
   * imported image is published only once the comparison with known material has answered for it.
   */
  IMPORT_IMAGES: blankAsUnset.pipe(z.enum(["on", "off"]).default("off")),
  /**
   * The sources a new import may name, comma-separated (decision 16): x and mastodon unless set; bluesky joins only by the
   * owner's choice, which the README explains. An unknown source stops the process at start.
   */
  IMPORT_SOURCES: blankAsUnset.pipe(
    z
      .string()
      .default("x,mastodon")
      .transform((value) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))])
      .pipe(z.array(z.enum(IMPORT_SOURCE_KINDS, { message: `must name sources among ${IMPORT_SOURCE_KINDS.join(", ")}` })).min(1)),
  ),
  /** Imports in uploading or scanning on the site at once (4.2 step 3). */
  IMPORT_MAX_ACTIVE: blankAsUnset.pipe(z.coerce.number<string>().int().min(1).max(100).default(IMPORT_RULES.maxActiveDefault)),
  /** The feeder's site-wide pace of imported images an hour (7.4): 0 to 600, and it may only be lowered. */
  IMPORT_IMAGES_PER_HOUR: blankAsUnset.pipe(z.coerce.number<string>().int().min(0).max(IMPORT_RULES.imagesPerHourMax).default(IMPORT_RULES.imagesPerHourDefault)),
  /** Free space kept on import-archives beyond a new import's declared size and the 4 GiB its scan may write (7.7). */
  IMPORT_MIN_FREE_BYTES: blankAsUnset.pipe(z.coerce.number<string>().int().nonnegative().default(IMPORT_RULES.minFreeBytesDefault)),
  /** The two import volumes (7.1): the API writes the first and only reads the second. The defaults suit `pnpm dev` from apps/api. */
  IMPORT_ARCHIVES_DIR: z.string().min(1).default("../../.data/import/archives"),
  IMPORT_WORK_DIR: z.string().min(1).default("../../.data/import/work"),
}).superRefine((c, ctx) => {
  const refuse = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  // 3d (design, section 5, review ruling 11): in every environment, a test adapter never runs on a site people can reach.
  if (c.EDGE_PURGE === "test" && c.APP_SITE === "open") refuse("EDGE_PURGE", "EDGE_PURGE=test is refused while APP_SITE is open: a test adapter answers only on a site that is closed");
  if (c.HEAD_WITNESS === "test" && c.APP_SITE === "open") refuse("HEAD_WITNESS", "HEAD_WITNESS=test is refused while APP_SITE is open: a test adapter answers only on a site that is closed");
  if (c.R1_CLASSIFIER === "test" && c.APP_SITE === "open") refuse("R1_CLASSIFIER", "R1_CLASSIFIER=test is refused while APP_SITE is open: a test adapter answers only on a site that is closed");
  // 3d Task 6 (row 49): no classifier is built in, so onnx stops the process; and the guards a real one meets once the
  // owner's task adds it, one tool's date never passing the other or the step from flagging to acting.
  if (c.R1_CLASSIFIER === "onnx") refuse("R1_CLASSIFIER", "R1_CLASSIFIER=onnx: no such adapter in this build");
  if (c.R1_CLASSIFIER !== "off" && c.R1_CLASSIFIER !== "test" && c.AUTOMATION_DPIA_R1 === undefined) {
    refuse("AUTOMATION_DPIA_R1", "AUTOMATION_DPIA_R1 is required when R1_CLASSIFIER names a classifier: the day of the impact assessment for the R1 check");
  }
  if (c.R1_CLASSIFIER !== "off" && c.R1_CLASSIFIER !== "test" && c.AUTOMATION_R1_ACTS === "on" && c.AUTOMATION_DPIA_R1_ACTS === undefined) {
    refuse("AUTOMATION_DPIA_R1_ACTS", "AUTOMATION_DPIA_R1_ACTS is required when a classifier withholds (AUTOMATION_R1_ACTS=on): the day the assessment covered the measure");
  }
  // 3d Task 7 (rows 27 and 49): no source's adapter is built in, so a source's name stops the process; and the guards a real
  // source meets once the owner's task adds one, one tool's date never passing the other or the step from alerting to sealing.
  if (c.MEDIA_MATCH === "test" && c.APP_SITE === "open") refuse("MEDIA_MATCH", "MEDIA_MATCH=test is refused while APP_SITE is open: a test adapter answers only on a site that is closed");
  if (c.MEDIA_MATCH !== "off" && c.MEDIA_MATCH !== "test") refuse("MEDIA_MATCH", `MEDIA_MATCH=${c.MEDIA_MATCH}: no such adapter in this build`);
  if (c.MEDIA_MATCH !== "off" && c.MEDIA_MATCH !== "test" && c.AUTOMATION_DPIA_MATCH === undefined) {
    refuse("AUTOMATION_DPIA_MATCH", "AUTOMATION_DPIA_MATCH is required when MEDIA_MATCH names a source: the day of the impact assessment for the comparison");
  }
  if (c.MEDIA_MATCH !== "off" && c.MEDIA_MATCH !== "test" && c.AUTOMATION_R2_ACTS === "on" && c.AUTOMATION_DPIA_MATCH_ACTS === undefined) {
    refuse("AUTOMATION_DPIA_MATCH_ACTS", "AUTOMATION_DPIA_MATCH_ACTS is required when a source's match seals (AUTOMATION_R2_ACTS=on): the day the assessment covered the measure");
  }
  // 3b (decision 15): imported images are published only once the comparison with known material answered for each, so
  // they are refused while it is off; in every environment.
  if (c.IMPORT_IMAGES === "on" && c.MEDIA_MATCH === "off") refuse("IMPORT_IMAGES", "IMPORT_IMAGES=on is refused while MEDIA_MATCH is off: imported images are imported only while a matcher checks them");
  // An adapter named without its settings stops the process at start, as every missing setting does.
  if (c.EDGE_PURGE === "cloudflare") {
    for (const name of ["EDGE_ZONE_ID", "EDGE_API_TOKEN", "EDGE_HOST"] as const) if (c[name] === undefined) refuse(name, `${name} is required when EDGE_PURGE is cloudflare`);
  }
  if (c.HEAD_WITNESS === "rfc3161" && c.HEAD_WITNESS_URL === undefined) refuse("HEAD_WITNESS_URL", "HEAD_WITNESS_URL is required when HEAD_WITNESS is rfc3161");
  // 3f: a contact point is published for one Member State, whose facts the console then reads.
  if (c.CONTACT_POINT !== undefined && c.HOME_STATE === undefined) refuse("HOME_STATE", "HOME_STATE is required once CONTACT_POINT is set");
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
  NOTIFY: c.NOTIFY ?? (c.NODE_ENV === "production" ? "on" : "off"),
}));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
