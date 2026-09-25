import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgPolicy, pgSchema, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authRole, emptyTextArray, fullAccess, ts } from "./helpers";

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
  },
  (t) => [
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    /** One phone number per account, as a database fact; accounts without a number stay out of the index. */
    uniqueIndex("users_phone_hash_idx").on(t.phoneHash).where(sql`phone_hash is not null`),
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
    /** Last time the user proved possession of a credential on this session. */
    reauthAt: ts("reauth_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), fullAccess("sessions_auth_all", authRole)],
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
    createdAt: ts("created_at").notNull().defaultNow(),
    lastUsedAt: ts("last_used_at"),
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
