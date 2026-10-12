import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgSchema, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, bytea, emptyTextArray, fullAccess, ts } from "./helpers";

export const auth = pgSchema("auth");

export const emailCodePurpose = auth.enum("email_code_purpose", ["signup", "login", "change_email", "recovery", "reauth", "delete_account"]);

export const userRole = auth.enum("user_role", ["user", "moderator", "admin"]);

export const authEventType = auth.enum("auth_event_type", [
  "signup",
  "signin_success",
  "signin_failure",
  "mfa_enabled",
  "mfa_disabled",
  "recovery_code_used",
  "recovery_codes_regenerated",
  "password_set",
  "password_changed",
  "session_revoked",
  "sessions_revoked_all",
  "account_locked",
  "new_device",
  "not_me",
  "profile_updated",
  "handle_changed",
  "email_changed",
  "badge_verified",
  "badge_removed",
  "export_created",
  "account_deleted",
  "passkey_added",
  "passkey_removed",
  "passkey_counter_regression",
  // The staff console (3a design, section 6).
  "staff_enrollment_issued",
  "staff_key_added",
  "staff_key_revoked",
  "staff_key_counter_regression",
  "staff_sign_in",
  "staff_signed_out",
  "staff_session_revoked",
]);

export const users = auth.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    /** Salted hash; the raw phone number is discarded after OTP verification. */
    phoneHash: text("phone_hash"),
    /** argon2id encoded string, null for passkey-only accounts. */
    passwordHash: text("password_hash"),
    /** Encrypted with the server-side key; never stored in clear. */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabledAt: ts("totp_enabled_at"),
    recoveryCodesHash: text("recovery_codes_hash").array().notNull().default(emptyTextArray),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    role: userRole("role").notNull().default("user"),
    /** When the 16+ check passed. Date of birth itself is never stored. */
    ageConfirmedAt: ts("age_confirmed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: ts("terms_accepted_at"),
    /** Set once the public profile (handle) exists. */
    onboardedAt: ts("onboarded_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Last accepted TOTP time step; a code for this step or earlier is rejected (replay protection). */
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    /**
     * When the purge after deletion finished anonymising this row. deleted_at means the owner confirmed
     * deletion and the account is gone for every purpose; purged_at null with deleted_at set means the purge
     * job still has work to do.
     */
    purgedAt: ts("purged_at"),
    /**
     * The WebAuthn user handle: 32 random bytes that every passkey of the account carries and a discoverable passkey
     * returns at sign-in. Never the account id, so a password manager's records say nothing about the account. Null
     * until the first passkey is added; the passkey flows set it once with a compare-and-set, and the account's
     * deletion clears it (1c design, sections 6 and 7.7).
     */
    webauthnUserId: bytea("webauthn_user_id"),
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    /** One phone number per account, as a database fact; accounts without a number stay out of the index. */
    uniqueIndex("users_phone_hash_idx").on(t.phoneHash).where(sql`phone_hash is not null`),
    /** A user handle names one account; accounts without passkeys stay out of the index. */
    uniqueIndex("users_webauthn_user_id_idx").on(t.webauthnUserId).where(sql`webauthn_user_id is not null`),
    fullAccess("users_auth_all", authRole),
  ],
).enableRLS();

export const devices = auth.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    label: text("label"),
    /** 'web' | 'ios' | 'android' */
    platform: text("platform").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Salted hash; purged by the 30-day job. Raw IPs are never stored. */
    ipHash: text("ip_hash"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId), index("devices_ip_hash_idx").on(t.ipHash), fullAccess("devices_auth_all", authRole)],
).enableRLS();

export const sessions = auth.table(
  "sessions",
  {
    /** sha256 hex of the opaque token handed to the client. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Sliding expiry, extended on use. */
    expiresAt: ts("expires_at").notNull(),
    /** Hard cap, never extended. */
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    /** Last time the user proved possession of a credential on this session: the latest of `factors`. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
    /**
     * A random id the session keeps for its whole life, while the token and with it `id` rotate. The re-authentication
     * limits and the passkey challenges are keyed by it, so a rotation cannot reset them and no other session can
     * spend them.
     */
    handle: uuid("handle").notNull().defaultRandom(),
    /**
     * The factors this session has proven and when: kind (email, password, totp, recovery, passkey, passkey_uv) to
     * epoch milliseconds. Sessions from before migration 0010 have none and re-authenticate before a sensitive action.
     */
    factors: jsonb("factors").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** The passkey that started this session, for the lockdown and the Security list; it outlives the passkey. */
    passkeyId: uuid("passkey_id").references(() => passkeys.id, { onDelete: "set null" }),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_handle_idx").on(t.handle), fullAccess("sessions_auth_all", authRole)],
).enableRLS();

export const emailCodes = auth.table(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: emailCodePurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** Random id returned to the client; a code can only complete the flow that requested it. */
    flowId: text("flow_id").notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("email_codes_email_idx").on(t.email),
    uniqueIndex("email_codes_flow_idx").on(t.flowId),
    fullAccess("email_codes_auth_all", authRole),
  ],
).enableRLS();

export const passkeys = auth.table(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name").notNull(),
    /** Written from the flows' clock, like password_changed_at, because the lockdown compares it with flow times. */
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** The authenticator model the registration reported (all zeros for most synced passkeys); null when none was given. */
    aaguid: uuid("aaguid"),
    /** The BE flag at registration: the key may be synced to other devices. backed_up is the BS flag, which can change. */
    backupEligible: boolean("backup_eligible").notNull().default(false),
    /** The registration verified the user (UV flag); only then does a verified sign-in with it count as two factors. */
    uvInitialized: boolean("uv_initialized").notNull().default(false),
    /** The device whose session added it, for the Security list; it outlives the device. */
    createdDeviceId: uuid("created_device_id").references(() => devices.id, { onDelete: "set null" }),
    /** When a sign-in showed a signature counter that went backwards (a copy of the key may exist); refused from then on. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [uniqueIndex("passkeys_credential_idx").on(t.credentialId), index("passkeys_user_idx").on(t.userId), fullAccess("passkeys_auth_all", authRole)],
).enableRLS();

/** Append-only security log. UPDATE, DELETE and TRUNCATE are also revoked at the grant level (migration 0003). */
export const authEvents = auth.table(
  "auth_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: authEventType("type").notNull(),
    deviceId: uuid("device_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("auth_events_user_created_idx").on(t.userId, t.createdAt),
    pgPolicy("auth_events_auth_insert", { for: "insert", to: authRole, withCheck: sql`true` }),
    pgPolicy("auth_events_auth_select", { for: "select", to: authRole, using: sql`true` }),
  ],
).enableRLS();

/**
 * Staff keys (3a design, section 6): WebAuthn credentials on the staff console's relying party, which alone open it. Only
 * keys whose registration reported user verification and no backup eligibility exist. They are added only by the
 * migrator-owned function auth.add_staff_key, which spends an enrolment the command line issued; migration 0012 leaves the
 * auth role SELECT and UPDATE of counter, last_used_at, revoked_at and suspect_at, and a trigger refuses to clear or change a
 * set revoked_at or suspect_at. A row is never deleted: audit-verify checks old confirmations against its public key,
 * owner, origin and relying party ID, so revocation and an account's take-down only set revoked_at.
 */
export const staffKeys = auth.table(
  "staff_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** On delete restrict: the development cleaner, which deletes accounts, must never take a key with them. */
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array().notNull().default(emptyTextArray),
    /** What the key's holder called it at enrolment; blanked with the AAGUID and transports when the account is deleted. */
    name: text("name").notNull(),
    /** The authenticator model the registration reported; null when none was given, and after the account's deletion. */
    aaguid: uuid("aaguid"),
    /** The console's origin and relying party ID when the key was enrolled, copied from its enrolment. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
    /** Set once and never cleared: the key opens and confirms nothing more. A key is live while this is null. */
    revokedAt: ts("revoked_at"),
    /** Set together with revoked_at when a signature counter went backwards: a revoked key whose record says why. */
    suspectAt: ts("suspect_at"),
  },
  (t) => [
    uniqueIndex("staff_keys_credential_idx").on(t.credentialId),
    index("staff_keys_user_idx").on(t.userId),
    // The pair the staff sessions' foreign key names, so a session's key always belongs to its account.
    unique("staff_keys_id_user_id_unique").on(t.id, t.userId),
    check("staff_keys_suspect_is_revoked", sql`${t.suspectAt} is null or ${t.revokedAt} is not null`),
    fullAccess("staff_keys_auth_all", authRole),
  ],
).enableRLS();

/**
 * One-time enrolment links (3a design, section 6), issued only by `staff.js enroll` as the migrator and spent only by
 * auth.add_staff_key. Only the sha256 of the link's token is kept. The auth role may read them and delete them (cancelling an
 * open one, or the janitor removing a spent one), nothing else; a set used_at is never cleared.
 */
export const staffEnrollments = auth.table(
  "staff_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** CONSOLE_ORIGIN and the console's relying party ID when the link was issued; a link for a moved console enrols nothing. */
    origin: text("origin").notNull(),
    rpId: text("rp_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [
    uniqueIndex("staff_enrollments_token_hash_idx").on(t.tokenHash),
    index("staff_enrollments_user_idx").on(t.userId),
    fullAccess("staff_enrollments_auth_all", authRole),
  ],
).enableRLS();

/**
 * Staff sessions (3a design, section 6), apart from the app's sessions: 12 hours absolute and 15 minutes idle, read from the
 * database on every request. The database keeps a row within 12 hours of its creation whoever writes it.
 */
export const staffSessions = auth.table(
  "staff_sessions",
  {
    /** sha256 hex of the opaque token in the staff cookie. The token itself is never stored. */
    id: text("id").primaryKey(),
    /** A random id for the session's whole life: the console lists and revokes sessions by it, and step-up binds to it. */
    handle: uuid("handle").notNull().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The staff key that opened the session; its foreign key below also names the account. */
    keyId: uuid("key_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** The person's last action in the console, never a request the page sent by itself. */
    lastUsedAt: ts("last_used_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    absoluteExpiresAt: ts("absolute_expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    /** The coarse label deviceLabel gives ("Firefox on Linux"); never the user agent itself, never an address. */
    browser: text("browser").notNull(),
  },
  (t) => [
    uniqueIndex("staff_sessions_handle_idx").on(t.handle),
    index("staff_sessions_user_idx").on(t.userId),
    foreignKey({ name: "staff_sessions_key_user_fk", columns: [t.keyId, t.userId], foreignColumns: [staffKeys.id, staffKeys.userId] }).onDelete("cascade"),
    check(
      "staff_sessions_lifetime",
      sql`${t.absoluteExpiresAt} <= ${t.createdAt} + interval '12 hours' and ${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`,
    ),
    fullAccess("staff_sessions_auth_all", authRole),
  ],
).enableRLS();

/**
 * What a signed-out notifier gave to be told about their notice (3c design, section 6.1): a name and an address, each
 * encrypted under NOTIFIER_ENC_KEY, a keyed hash of the address for the caps and for suppression, and the contact's mail
 * token. The public intake row holds only this row's id, which the moderation module chose, and the API role reaches none
 * of this. Migration 0015 leaves the auth role SELECT, INSERT, DELETE and UPDATE of forget_after only, so a contact is
 * never re-encrypted.
 */
export const notifierContacts = auth.table(
  "notifier_contacts",
  {
    /** Chosen by the moderation module: the intake row names it before the contact is stored. */
    id: uuid("id").primaryKey(),
    nameEnc: text("name_enc"),
    emailEnc: text("email_enc"),
    emailHash: text("email_hash"),
    /** The contact's mail token, which alone confirms or stops the address; null without an address. */
    mailTokenEnc: text("mail_token_enc"),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** When the janitor deletes the row: 13 months after creation unless the notice is still owed something. */
    forgetAfter: ts("forget_after").notNull(),
  },
  () => [fullAccess("notifier_contacts_auth_all", authRole)],
).enableRLS();

/** An address a notifier confirmed, by its keyed hash, for 30 days. */
export const notifierConfirmations = auth.table(
  "notifier_confirmations",
  {
    emailHash: text("email_hash").primaryKey(),
    confirmedAt: ts("confirmed_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  () => [fullAccess("notifier_confirmations_auth_all", authRole)],
).enableRLS();

/** An address that asked korbat to stop its report mails, by its keyed hash. Its notices are still processed. */
export const notifierSuppressions = auth.table(
  "notifier_suppressions",
  {
    emailHash: text("email_hash").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  () => [fullAccess("notifier_suppressions_auth_all", authRole)],
).enableRLS();

/**
 * The personal accounts the operator linked to a staff account, so that a staff member never decides where an account of
 * their own is a party. Only `staff.js link` and `unlink` write it, as the migrator, and only migrator-owned definer
 * functions read it: migration 0015 revokes everything from the auth role, and the one policy, which the rule that every
 * table has one asks for, lets that role see no row. On delete restrict: the development cleaner must not take a link
 * with an account.
 */
export const staffPersonalAccounts = auth.table(
  "staff_personal_accounts",
  {
    staffUserId: uuid("staff_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    personalUserId: uuid("personal_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    linkedAt: ts("linked_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.staffUserId, t.personalUserId] }),
    check("staff_personal_accounts_differ", sql`${t.staffUserId} <> ${t.personalUserId}`),
    pgPolicy("staff_personal_accounts_auth_none", { for: "select", to: authRole, using: sql`false` }),
  ],
).enableRLS();
