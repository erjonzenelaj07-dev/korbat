import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  authEventType,
  authEvents,
  devices,
  emailCodePurpose,
  emailCodes,
  notifierConfirmations,
  notifierContacts,
  notifierSuppressions,
  passkeys,
  sessions,
  staffEnrollments,
  staffKeys,
  staffSessions,
  userRole,
  users,
  type Db,
} from "@korbat/db";
import { boundLockWaits, isLockNotAvailable } from "../lib/lock-bounds";
import { SYSTEM_ACTOR_ID } from "./admin";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** What a signed-out notifier gave, as stored: every `Enc` column a ciphertext under the notifier key. */
export type NotifierContactRow = typeof notifierContacts.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

/** A staff enrolment found by its token, with what the enrolment flow checks of its account (3a design, section 7). */
export interface StaffEnrollmentRow {
  id: string;
  userId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  onboardedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What the enrolment flow stores of a verified staff key; auth.add_staff_key copies the origin and relying party ID from the enrolment. */
export interface NewStaffKey {
  userId: string;
  enrollmentId: string;
  /** The link's token itself: the function hashes it, so a hash read from the table spends nothing. */
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string;
  requestId: string;
}

/** What addStaffKey answers: the new key's id, or which of auth.add_staff_key's re-checks refused it. */
export type AddStaffKeyOutcome = { ok: true; keyId: string } | { ok: false; reason: "enrollment_invalid" | "limit" };

/** A staff key as the console's sign-in finds it by its credential id, with what the flow checks of its account. */
export interface StaffKeyForSignIn {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What a staff sign-in's transaction writes (3a design, section 7, Sign-in): the key's use, the session, its event and its audit row. */
export interface NewStaffSession {
  /** sha256 of the token; the token itself is never stored. */
  id: string;
  userId: string;
  keyId: string;
  /** The counter the verified assertion reported, which the key's row takes only if it moved forward. */
  newCounter: number;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
  ipHash: string | null;
  requestId: string;
}

/** A live staff session as requireStaff reads it, with its account's role, in one statement joined to its key and its account. */
export interface StaffSessionRow {
  id: string;
  handle: string;
  userId: string;
  keyId: string;
  role: UserRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
}

/**
 * A revocation of staff keys in one auth transaction (3a design, section 7): `staff.js revoke` with one key or `all`, and the
 * counter rule's revocation of the key that went backwards, which also marks it suspect and records its own event. The
 * account is named by its id (the counter rule knows it) or by its address (the command line).
 */
export interface StaffKeyRevocation {
  account: { id: string } | { email: string };
  key: string | "all";
  suspect: boolean;
  /**
   * Where it came from, as the events and audit rows record it: the command line, or the counter rule at a sign-in or a
   * step-up. The command line also waits at most 10 seconds for a lock.
   */
  via: "cli" | "sign_in" | "step_up";
  actorId: string;
  now: Date;
  requestId?: string | null;
}

/** What a revocation did, for the command line's report and the mail; or why it found nothing to act on. */
export type StaffKeysRevoked =
  | {
      ok: true;
      userId: string;
      /** The account's address as stored, which the mail goes to. */
      email: string;
      /** The keys revoked now, oldest first, each with how many of its staff sessions were revoked now. */
      keys: { id: string; name: string; sessionsRevoked: number }[];
      staffSessionsRevoked: number;
      enrollmentsCancelled: number;
      /** For one key named by the command line: when it was revoked before, in which case nothing changed. */
      alreadyRevokedAt: Date | null;
    }
  | { ok: false; reason: "no_account" | "no_key" };

/** The staff key a staff session was opened with, as its step-up reads it: the credential to verify against and its name for a suspect key's mail. */
export interface StaffKeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
}

/**
 * A staff session's revocation confirmed by a step-up (3a design, section 7, Sessions and keys): who confirms it (the
 * account, its session and the key that signed) and what the audit row stores of the confirmation.
 */
export interface ConfirmedStaffSessionRevocation {
  userId: string;
  /** The confirming session's handle, which the step-up's challenge was bound to. */
  staffSession: string;
  keyId: string;
  /** The handle of the session to revoke. */
  handle: string;
  actionHash: string;
  params: Record<string, unknown>;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string };
  /** The step-up challenge's expiry: the audit row must join the chain before it, by the database's clock. */
  expiresAt: Date;
  now: Date;
  ipHash: string | null;
  requestId: string;
}

/** A role change as it committed: what it revoked and deleted, for the cache tombstones, the command's report and the mail. */
export interface RoleChange {
  userId: string;
  /** The account's address as stored, which the staff_keys_revoked mail goes to. */
  email: string;
  previousRole: UserRole;
  /** The revoked app sessions' ids, for the cache tombstones. */
  sessionIds: string[];
  staffSessionsRevoked: number;
  enrollmentsDeleted: number;
  /** The staff keys revoked by a change to user, oldest first. */
  keysRevoked: { id: string; name: string }[];
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /**
     * A role change (3a design, section 7) in one transaction: the account's row is locked first, FOR NO KEY UPDATE (the
     * lock the role's update would take, and the one every writer of staff rows takes first, so none of them can wait on
     * another in a circle); the role is set, every session and every staff session revoked and every unused enrolment link
     * deleted, so the new role applies at once and no link issued before enrols anything. A change to user also revokes
     * every staff key, with a staff_key_revoked event each: a person made staff again enrols new keys. Last, through
     * auth.append_audit, each revocation's audit row and then the role_granted row, which hold the audit chain's head until
     * the commit, so the change and its record commit together or not at all. Only the command line calls this, and it
     * waits at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one
     * that times out has changed nothing. The cache tombstones and the mail are not the database's to write, so the caller
     * does them after the commit with what this answers; undefined when no live account has the address.
     *
     * 3e (design, section 7.16): no suspended account becomes staff. For a promotion, auth.account_standing is asked in a
     * statement of its own after the row's lock: a deciding transaction reads the same row FOR SHARE, so it either waited
     * for this one and then meets staff_target, or committed first and is read here. When the account holds a standing
     * suspension, termination or restriction of reporting nothing is changed and the answer is "standing".
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<RoleChange | "standing" | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return undefined;
        if (role !== "user") {
          const [standing] = await tx.execute<{ held: boolean }>(sql`select auth.account_standing(${account.id}::uuid) as held`);
          // Nothing was written: the transaction ends with the row's lock and no audit row.
          if (standing!.held) return "standing";
        }
        await tx.update(users).set({ role }).where(eq(users.id, account.id));
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: audit.now })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        const staff = await revokeStaffAccess(tx, account.id, audit.now, { keys: role === "user", enrollments: "unused", via: "role_change" });
        await appendKeyRevocations(tx, audit.actorId, staff, "role_change");
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          // A role change deletes open links only, so every link it deleted was one it cancelled.
          metadata: { from: account.role, to: role, via: "cli", staffSessionsRevoked: staff.staffSessionsRevoked, enrollmentsDeleted: staff.enrollmentsCancelled },
        });
        return {
          userId: account.id,
          email: account.email,
          previousRole: account.role,
          sessionIds: revoked.map((row) => row.id),
          staffSessionsRevoked: staff.staffSessionsRevoked,
          enrollmentsDeleted: staff.enrollmentsCancelled,
          keysRevoked: staff.keys.map(({ id, name }) => ({ id, name })),
        };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, the account's staff
     * keys and staff sessions revoked, its enrolment links deleted and its keys blanked (3a design, section 7), and the
     * account_deleted event appended; last, the audit rows of the staff side, with the account as their actor, since its
     * owner asked for the deletion. Either all of it lands or none of it does, so a failure leaves a live account with its
     * sessions, never a deleted one with sessions, devices, passkeys or staff keys that nothing would remove. Answers the
     * ids of the sessions it revoked, for the cache tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const taken = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        await appendTakeDownAudit(tx, userId, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, the WebAuthn user handle and the staff rows), for
     * a row marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The account_deleted event is not appended
     * again: the confirmation that recorded it is the only one there was. The staff side's audit rows are written, last,
     * for what this run revoked, with the server as their actor: the purge job finishes the take-down, no person.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        // The account's row first, as every writer of staff rows takes it (3a design, section 7).
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)))
          .for("no key update");
        if (!row) return [];
        const taken = await takeDownRows(tx, userId, now);
        await appendTakeDownAudit(tx, SYSTEM_ACTOR_ID, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          handle: sessions.handle,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    // ------------------------------------------------------------ staff keys and enrolments (3a design, section 7)

    /**
     * The enrolment whose token hashes to `tokenHash`, used or not, expired or not, with what the enrolment flow checks of
     * its account: whether it is live, staff and has a handle, and its WebAuthn user handle. Undefined for an unknown
     * token. The flow decides; auth.add_staff_key decides again under the account's lock.
     */
    async findStaffEnrollment(tokenHash: string): Promise<StaffEnrollmentRow | undefined> {
      const [row] = await db
        .select({
          id: staffEnrollments.id,
          userId: staffEnrollments.userId,
          origin: staffEnrollments.origin,
          rpId: staffEnrollments.rpId,
          expiresAt: staffEnrollments.expiresAt,
          usedAt: staffEnrollments.usedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          onboardedAt: users.onboardedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffEnrollments)
        .innerJoin(users, eq(users.id, staffEnrollments.userId))
        .where(eq(staffEnrollments.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    /**
     * The account's live staff keys as an options list excludes them: an authenticator keeps one discoverable credential
     * per relying party and user handle, so a revoked key is left out and the same security key can be enrolled again.
     */
    async listLiveStaffKeys(userId: string): Promise<{ credentialId: string; transports: string[] }[]> {
      return db
        .select({ credentialId: staffKeys.credentialId, transports: staffKeys.transports })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(staffKeys.createdAt, staffKeys.id);
    },

    /** One staff key as the console shows it: never its public key, credential id or AAGUID. */
    async findStaffKey(id: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null } | undefined> {
      const [row] = await db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The enrolment's write, in one transaction on the auth role (3a design, section 7): the account's row locked first,
     * FOR NO KEY UPDATE, so a role change or take-down that holds it either committed before (and deleted the link, which
     * the function then does not find) or waits until this commits; the staff_key_added event; and last
     * auth.add_staff_key, which re-checks under that lock that the link is unused and unexpired and the account live,
     * staff, with a handle and fewer than five live keys, then spends the link, stores the key with the origin and relying
     * party ID the link recorded and writes its audit row, which holds the chain's head until the commit. A refusal by the
     * function rolls the event back with it. A credential id already held raises the driver's unique violation, which the
     * flow reports.
     */
    async addStaffKey(input: NewStaffKey): Promise<AddStaffKeyOutcome> {
      try {
        return await db.transaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("no key update");
          await tx.insert(authEvents).values({ userId: input.userId, type: "staff_key_added", metadata: { enrollmentId: input.enrollmentId } });
          // Each transport as its own parameter: an empty list is an empty array.
          const transports = sql`array[${sql.join(input.transports.map((t) => sql`${t}`), sql`, `)}]::text[]`;
          const [row] = await tx.execute<{ id: string }>(
            sql`select auth.add_staff_key(${input.token}::text, ${input.credentialId}::text, ${input.publicKey}::text, ${input.counter}::bigint,
              ${transports}, ${input.name}::text, ${input.aaguid}::uuid, ${input.requestId}::text) as id`,
          );
          return { ok: true as const, keyId: row!.id };
        });
      } catch (err) {
        // The function raises its refusal's staff code as the message.
        const refusal = raisedMessage(err);
        if (refusal === "staff_enrollment_invalid") return { ok: false, reason: "enrollment_invalid" };
        if (refusal === "staff_key_limit") return { ok: false, reason: "limit" };
        throw err;
      }
    },

    // ------------------------------------------------------------ staff sessions

    /** A staff key by its credential id, revoked or not, with its account's address, role, deletion and user handle; the sign-in decides. */
    async findStaffKeyForSignIn(credentialId: string): Promise<StaffKeyForSignIn | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffKeys)
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(eq(staffKeys.credentialId, credentialId))
        .limit(1);
      return row;
    },

    /**
     * A staff sign-in's write, in one transaction (3a design, section 7): first 1c's counter rule as one conditional update
     * of the key, which records its use only while it is live and its counter moved forward (two zeros pass, as some
     * authenticators always report 0); then the session, its staff_sign_in event and last its audit row, which holds the
     * chain's head until the commit. Null when the update matched no row: a counter that went backwards, or a key revoked
     * since the flow read it, which the caller tells apart. The update holds the key's row until the commit, so a
     * revocation waiting for it then also finds the session this opened.
     */
    async openStaffSession(input: NewStaffSession): Promise<{ handle: string } | null> {
      return db.transaction(async (tx) => {
        if (!(await recordStaffKeyUse(tx, input))) return null;
        const [session] = await tx
          .insert(staffSessions)
          .values({
            id: input.id,
            userId: input.userId,
            keyId: input.keyId,
            createdAt: input.now,
            lastUsedAt: input.now,
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            browser: input.browser,
          })
          .returning({ handle: staffSessions.handle });
        const handle = session!.handle;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_sign_in", ipHash: input.ipHash, metadata: { keyId: input.keyId, handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_sign_in",
          targetType: "staff_session",
          targetId: handle,
          staffSession: handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return { handle };
      });
    },

    /**
     * A staff session by its token's hash, read from the database on every request, never cached (3a design, section 7):
     * one indexed read joined to its key and its account. It counts only while it is unrevoked, has started (a created_at
     * later than now is a row written behind the flows' back) and is before both its ends, its key unrevoked and its account
     * live and still staff, so a revocation, a demotion, a deletion or a suspect key ends it at its next request with no
     * tombstone. With `slideTo` (a request its person's action started) the same statement moves last_used_at to now and the
     * idle end to `slideTo`, never past the absolute end; without, nothing moves.
     */
    async resolveStaffSession(id: string, now: Date, slideTo: Date | null): Promise<StaffSessionRow | undefined> {
      const live = and(
        eq(staffSessions.id, id),
        isNull(staffSessions.revokedAt),
        lte(staffSessions.createdAt, now),
        gt(staffSessions.idleExpiresAt, now),
        gt(staffSessions.absoluteExpiresAt, now),
        isNull(staffKeys.revokedAt),
        isNull(users.deletedAt),
        ne(users.role, "user"),
      );
      const columns = {
        id: staffSessions.id,
        handle: staffSessions.handle,
        userId: staffSessions.userId,
        keyId: staffSessions.keyId,
        role: users.role,
        createdAt: staffSessions.createdAt,
        lastUsedAt: staffSessions.lastUsedAt,
        idleExpiresAt: staffSessions.idleExpiresAt,
        absoluteExpiresAt: staffSessions.absoluteExpiresAt,
        browser: staffSessions.browser,
      };
      if (slideTo === null) {
        const [row] = await db
          .select(columns)
          .from(staffSessions)
          .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
          .innerJoin(users, eq(users.id, staffSessions.userId))
          .where(live)
          .limit(1);
        return row;
      }
      const [row] = await db
        .update(staffSessions)
        // least() on the row's own absolute end, so the idle end never passes it, as the table's check also requires.
        .set({ lastUsedAt: now, idleExpiresAt: sql`least(${slideTo.toISOString()}::timestamptz, ${staffSessions.absoluteExpiresAt})` })
        .from(staffKeys)
        // A join in UPDATE ... FROM cannot name the updated table, so the account is reached through the key, whose owner
        // the sessions' foreign key on (key_id, user_id) makes the session's account.
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(and(eq(staffKeys.id, staffSessions.keyId), live))
        .returning(columns);
      return row;
    },

    /** The account's live staff sessions, the same tests as resolveStaffSession's, most recently used first. */
    async listStaffSessions(userId: string, now: Date): Promise<{ handle: string; browser: string; createdAt: Date; lastUsedAt: Date }[]> {
      return db
        .select({ handle: staffSessions.handle, browser: staffSessions.browser, createdAt: staffSessions.createdAt, lastUsedAt: staffSessions.lastUsedAt })
        .from(staffSessions)
        .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
        .where(
          and(
            eq(staffSessions.userId, userId),
            isNull(staffSessions.revokedAt),
            lte(staffSessions.createdAt, now),
            gt(staffSessions.idleExpiresAt, now),
            gt(staffSessions.absoluteExpiresAt, now),
            isNull(staffKeys.revokedAt),
          ),
        )
        .orderBy(desc(staffSessions.lastUsedAt), desc(staffSessions.createdAt));
    },

    /** The account's live staff keys as the console lists them, oldest first: never a public key, a credential id or an AAGUID. */
    async listStaffKeyViews(userId: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]> {
      return db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    },

    /**
     * A sign-out (3a design, section 7) in one transaction: the session revoked, if it still is live, then its
     * staff_signed_out event and last its audit row. False when another request ended it first, which writes nothing.
     */
    async endStaffSession(input: { id: string; userId: string; keyId: string; now: Date; ipHash: string | null; requestId: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(staffSessions.id, input.id), eq(staffSessions.userId, input.userId), isNull(staffSessions.revokedAt)))
          .returning({ handle: staffSessions.handle });
        if (!ended) return false;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_signed_out", ipHash: input.ipHash, metadata: { handle: ended.handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_signed_out",
          targetType: "staff_session",
          targetId: ended.handle,
          staffSession: ended.handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return true;
      });
    },

    /** The staff key a step-up confirms with, revoked or not, by its id; the step-up decides. */
    async findStaffKeyCredential(id: string): Promise<StaffKeyCredential | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
        })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The counter rule at a step-up (3a design, section 7), as at sign-in: the key's use is recorded only while it is live
     * and its counter moved forward. False when the update matched no row: a counter that went backwards, or a key
     * revoked since the step-up read it, which the caller hands to the counter rule's revocation.
     */
    async recordStaffKeyUse(input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
      return recordStaffKeyUse(db, input);
    },

    /**
     * Revokes one of the account's own live staff sessions, confirmed by a step-up, in one transaction on the auth role
     * (3a design, section 7). The account's row is locked first, FOR NO KEY UPDATE, as every revocation takes it, so a
     * revocation of the confirming key, a demotion or a take-down either committed before (and this refuses: the session
     * that confirmed has ended) or waits until this commits. Then the session, only where revoked_at is still null and
     * before both its ends, and only if it is the account's own; its staff_session_revoked event; and last its audit row,
     * through auth.append_audit, with the action's hash, its params in the metadata, the key and the assertion, which
     * audit-verify checks. "ended" when the confirming key or account no longer opens anything, "not_found" when the
     * handle names no live session of the account; neither writes anything.
     *
     * audit-verify refuses for good a row stamped at or after its challenge's expiry, and the trigger stamps the row only
     * once it holds the audit head, so a head held open would otherwise let a genuine confirmation become such a row. Every
     * lock wait here is therefore bounded by a third of the challenge's life left by the database's clock (at most 15
     * seconds), and the statement that writes the row also checks the database's clock against the expiry: "late" when a
     * wait gave up or the expiry came first, which rolls everything back and writes nothing.
     */
    async revokeConfirmedStaffSession(input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found" | "late"> {
      try {
        return await db.transaction(async (tx) => {
          // Three waits: the account's row, the session's row and the audit head.
          if (!(await boundLockWaits(tx, input.expiresAt, 3))) return "late";
          return revokeConfirmedIn(tx, input);
        });
      } catch (err) {
        if (err instanceof LateConfirmation || isLockNotAvailable(err)) return "late";
        throw err;
      }
    },

    /**
     * Revokes staff keys in one transaction on the auth role (3a design, section 7): `staff.js revoke <email> <key id>` and
     * `revoke <email> all`, and the counter rule's revocation, which is the same routine with suspect_at set as well and the
     * regression's own event. The account's row is locked first, FOR NO KEY UPDATE, as every writer of staff rows takes it.
     * Then the keys (one, or every live one), each only where revoked_at is still null, since a set one is never changed;
     * then every staff session they opened (for `all`, every staff session of the account), after the keys, so a session a
     * sign-in opened while this waited for a key's row is found too; for `all`, the unused enrolment links; an event per key;
     * and last the audit rows, a key's revocation each and, when a link went, one staff_enrollments_cancelled row, so it
     * never changes the database without a row. The command line waits at most 10 seconds for a lock.
     */
    async revokeStaffKeys(input: StaffKeyRevocation): Promise<StaffKeysRevoked> {
      return db.transaction(async (tx): Promise<StaffKeysRevoked> => {
        if (input.via === "cli") await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and("id" in input.account ? eq(users.id, input.account.id) : sql`lower(${users.email}) = lower(${input.account.email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return { ok: false, reason: "no_account" };
        let alreadyRevokedAt: Date | null = null;
        if (input.key !== "all") {
          // Another account's key and an unknown one are alike: neither is this account's to revoke.
          const [key] = await tx
            .select({ revokedAt: staffKeys.revokedAt })
            .from(staffKeys)
            .where(and(eq(staffKeys.id, input.key), eq(staffKeys.userId, account.id)));
          if (!key) return { ok: false, reason: "no_key" };
          alreadyRevokedAt = key.revokedAt;
        }
        const revoked = await tx
          .update(staffKeys)
          .set(input.suspect ? { revokedAt: input.now, suspectAt: input.now } : { revokedAt: input.now })
          .where(and(eq(staffKeys.userId, account.id), input.key === "all" ? undefined : eq(staffKeys.id, input.key), isNull(staffKeys.revokedAt)))
          .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
        // An update answers in no set order; the events, rows and mail list the keys oldest first.
        revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        const keyIds = revoked.map((key) => key.id);
        const sessionsOf = input.key === "all" ? eq(staffSessions.userId, account.id) : keyIds.length > 0 ? inArray(staffSessions.keyId, keyIds) : null;
        const ended =
          sessionsOf === null
            ? []
            : await tx
                .update(staffSessions)
                .set({ revokedAt: input.now })
                .where(and(sessionsOf, isNull(staffSessions.revokedAt)))
                .returning({ keyId: staffSessions.keyId });
        const enrollmentsCancelled =
          input.key === "all"
            ? (
                await tx
                  .delete(staffEnrollments)
                  .where(and(eq(staffEnrollments.userId, account.id), isNull(staffEnrollments.usedAt)))
                  .returning({ id: staffEnrollments.id })
              ).length
            : 0;
        const action = input.suspect ? "staff_key_counter_regression" : "staff_key_revoked";
        const keys = revoked.map((key) => ({ id: key.id, name: key.name, sessionsRevoked: ended.filter((session) => session.keyId === key.id).length }));
        for (const key of keys) {
          // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
          await tx.insert(authEvents).values({ userId: account.id, type: action, metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via } });
        }
        for (const key of keys) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action,
            targetType: "staff_key",
            targetId: key.id,
            metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        if (enrollmentsCancelled > 0) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action: "staff_enrollments_cancelled",
            targetType: "user",
            targetId: account.id,
            metadata: { count: enrollmentsCancelled, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        return { ok: true, userId: account.id, email: account.email, keys, staffSessionsRevoked: ended.length, enrollmentsCancelled, alreadyRevokedAt };
      });
    },

    // ------------------------------------------------------------ notifiers (3c design, section 6.1)

    /**
     * Stores what a signed-out notifier gave to be told about their notice, already encrypted, under the id the
     * moderation module chose and wrote on the notice. The role may never update any of it but the day it is forgotten.
     */
    async createNotifierContact(input: { id: string; nameEnc: string | null; emailEnc: string | null; emailHash: string | null; mailTokenEnc: string | null; forgetAfter: Date }): Promise<void> {
      await db.insert(notifierContacts).values(input);
    },

    async findNotifierContact(id: string): Promise<NotifierContactRow | undefined> {
      const [row] = await db.select().from(notifierContacts).where(eq(notifierContacts.id, id)).limit(1);
      return row;
    },

    /** What is known of these contacts without opening a ciphertext: whether a name and an address were given, and the address's hash. */
    async notifierContactFacts(ids: readonly string[]): Promise<{ id: string; named: boolean; contactGiven: boolean; emailHash: string | null }[]> {
      if (ids.length === 0) return [];
      return db
        .select({ id: notifierContacts.id, named: sql<boolean>`${notifierContacts.nameEnc} is not null`, contactGiven: sql<boolean>`${notifierContacts.emailEnc} is not null`, emailHash: notifierContacts.emailHash })
        .from(notifierContacts)
        .where(inArray(notifierContacts.id, [...ids]));
    },

    /** The contacts that gave this address, oldest first: the command line's read for an access request. */
    async notifierContactsByEmailHash(emailHash: string): Promise<NotifierContactRow[]> {
      return db.select().from(notifierContacts).where(eq(notifierContacts.emailHash, emailHash)).orderBy(asc(notifierContacts.createdAt), asc(notifierContacts.id));
    },

    /** Which of these address hashes hold a confirmation that has not run out. */
    async confirmedNotifierHashes(hashes: readonly string[], now: Date): Promise<Set<string>> {
      if (hashes.length === 0) return new Set();
      const rows = await db
        .select({ emailHash: notifierConfirmations.emailHash })
        .from(notifierConfirmations)
        .where(and(inArray(notifierConfirmations.emailHash, [...hashes]), gt(notifierConfirmations.expiresAt, now)));
      return new Set(rows.map((row) => row.emailHash));
    },

    /** Which of these address hashes asked korbat to stop its report mails. */
    async suppressedNotifierHashes(hashes: readonly string[]): Promise<Set<string>> {
      if (hashes.length === 0) return new Set();
      const rows = await db.select({ emailHash: notifierSuppressions.emailHash }).from(notifierSuppressions).where(inArray(notifierSuppressions.emailHash, [...hashes]));
      return new Set(rows.map((row) => row.emailHash));
    },

    /**
     * Records an address as confirmed until `expiresAt` and lifts any stop of it, in one transaction: whoever holds a
     * mail korbat sent there said "I sent this", which also means they want its mails.
     */
    async confirmNotifierAddress(emailHash: string, now: Date, expiresAt: Date): Promise<void> {
      await db.transaction(async (tx) => {
        await tx
          .insert(notifierConfirmations)
          .values({ emailHash, confirmedAt: now, expiresAt })
          .onConflictDoUpdate({ target: notifierConfirmations.emailHash, set: { confirmedAt: now, expiresAt } });
        await tx.delete(notifierSuppressions).where(eq(notifierSuppressions.emailHash, emailHash));
      });
    },

    /** Records that an address asked korbat to stop its report mails; a second stop changes nothing. The role cannot update the row. */
    async suppressNotifierAddress(emailHash: string): Promise<void> {
      await db.insert(notifierSuppressions).values({ emailHash }).onConflictDoNothing();
    },

    /** Lifts a stop; true when there was one. */
    async liftNotifierSuppression(emailHash: string): Promise<boolean> {
      const rows = await db.delete(notifierSuppressions).where(eq(notifierSuppressions.emailHash, emailHash)).returning({ emailHash: notifierSuppressions.emailHash });
      return rows.length > 0;
    },

    /** Moves the day these contacts are forgotten: the one column of a contact the role may update. */
    async setNotifierForgetAfter(ids: readonly string[], at: Date): Promise<void> {
      if (ids.length === 0) return;
      await db.update(notifierContacts).set({ forgetAfter: at }).where(inArray(notifierContacts.id, [...ids]));
    },

    /** How many contacts were to be forgotten, and confirmations had run out, before `before`: what a janitor that ran would have removed. */
    async countNotifierRowsDue(before: Date): Promise<number> {
      const [row] = (await db.execute(
        sql`select (select count(*) from auth.notifier_contacts where forget_after < ${before.toISOString()}::timestamptz)
                 + (select count(*) from auth.notifier_confirmations where expires_at < ${before.toISOString()}::timestamptz) as due`,
      )) as unknown as { due: string | number }[];
      return Number(row?.due ?? 0);
    },

    /** The address of every live staff account: not deleted, and a moderator or an admin. */
    async liveStaffAddresses(): Promise<string[]> {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(and(isNull(users.deletedAt), ne(users.role, "user")))
        .orderBy(asc(users.createdAt), asc(users.id));
      return rows.map((row) => row.email);
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /**
     * Staff sessions revoked or expired before `before` (3a design, section 7). A live one is never touched: both its ends
     * lie ahead. The audit rows that name a session keep its handle, which needs no row.
     */
    async purgeStaffSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(staffSessions)
        .where(
          or(
            and(isNotNull(staffSessions.revokedAt), lt(staffSessions.revokedAt, before)),
            lt(staffSessions.idleExpiresAt, before),
            lt(staffSessions.absoluteExpiresAt, before),
          ),
        )
        .returning({ id: staffSessions.id });
      return rows.length;
    },

    /** Enrolment links used or expired before `before`, which can enrol nothing more; one that still can is cancelled only by name. */
    async purgeStaffEnrollments(before: Date): Promise<number> {
      const rows = await db
        .delete(staffEnrollments)
        .where(or(and(isNotNull(staffEnrollments.usedAt), lt(staffEnrollments.usedAt, before)), lt(staffEnrollments.expiresAt, before)))
        .returning({ id: staffEnrollments.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /** Notifier contacts whose day to be forgotten lies before `before` (3c design, section 6.1): the name, the address and the mail token go with the row. */
    async purgeNotifierContacts(before: Date): Promise<number> {
      const rows = await db.delete(notifierContacts).where(lt(notifierContacts.forgetAfter, before)).returning({ id: notifierContacts.id });
      return rows.length;
    },

    /** Confirmations of a notifier's address that ran out before `before`: an address is confirmed for 30 days. */
    async purgeNotifierConfirmations(before: Date): Promise<number> {
      const rows = await db.delete(notifierConfirmations).where(lt(notifierConfirmations.expiresAt, before)).returning({ emailHash: notifierConfirmations.emailHash });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/** The auth side's actions in the audit log: the only ones auth.append_audit writes (migration 0012). */
type AuthAuditAction =
  | "staff_key_revoked"
  | "staff_key_counter_regression"
  | "staff_sign_in"
  | "staff_signed_out"
  | "staff_session_revoked"
  | "staff_enrollments_cancelled"
  | "role_granted";

/** One auth-side row of the audit log. The trigger sets its id, time, place and hashes. */
interface AuthAuditRow {
  actorId: string;
  action: AuthAuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  staffSession?: string | null;
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  requestId?: string | null;
}

/**
 * Writes an auth-side row of the audit log in the caller's transaction, through auth.append_audit: the auth role holds
 * nothing in the public schema, and the function, which the migrator owns, writes only the auth side's actions (3a design,
 * section 6). It must be the transaction's last statement: the row holds the chain's head until the commit, so nothing that
 * can wait may run after it. Answers the row's place in the chain.
 */
async function appendAudit(tx: Tx, row: AuthAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so postgres.js sends them exactly as serialised here.
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  const [written] = await tx.execute<{ place: string }>(
    sql`select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
      ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
      ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text)::text as place`,
  );
  return Number(written!.place);
}

/**
 * A confirmed action whose row could not join the chain before its step-up challenge expired; nothing was written.
 * Exported for the step-up suite, which runs revokeConfirmedIn past its challenge's expiry and expects this.
 */
export class LateConfirmation extends Error {
  constructor() {
    super("the confirmation's row could not join the chain before its challenge expired");
    this.name = "LateConfirmation";
  }
}

/**
 * appendAudit for a row a step-up confirmed, in one statement that also reads the database's clock once the row is in the
 * chain: the trigger stamped the row no later than that, so a clock still before the challenge's expiry means the row is
 * too, as audit-verify requires. The audit row stays the last statement of its transaction. False when the expiry came
 * first: the caller then rolls the transaction back.
 */
async function appendAuditBefore(tx: Tx, expiresAt: Date, row: AuthAuditRow): Promise<boolean> {
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  // A volatile function in a CTE is evaluated once, before the outer query reads its row, so the clock is read after it.
  const [written] = await tx.execute<{ inTime: boolean }>(
    sql`with written as (
      select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
        ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
        ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text) as place
    )
    select extract(epoch from clock_timestamp()) * 1000 < ${expiresAt.getTime()}::numeric as "inTime" from written`,
  );
  return written!.inTime === true;
}

/**
 * revokeConfirmedStaffSession's statements, in its transaction: the account's row first, then the key, the session, the
 * event, and last the audit row, written only while the challenge has not expired by the database's clock.
 *
 * Exported for the step-up suite alone, which runs it without boundLockWaits on a challenge already expired, as if the
 * waits had together outlasted it: that is the only way to reach the row's own clock check on cue, since the bound ends
 * any one wait the suite could hold before then. Everything else calls revokeConfirmedStaffSession.
 */
export async function revokeConfirmedIn(tx: Tx, input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found"> {
  const [account] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt), ne(users.role, "user")))
    .limit(1)
    .for("no key update");
  if (!account) return "ended";
  const [key] = await tx
    .select({ id: staffKeys.id })
    .from(staffKeys)
    .where(and(eq(staffKeys.id, input.keyId), eq(staffKeys.userId, input.userId), isNull(staffKeys.revokedAt)));
  if (!key) return "ended";
  const [revoked] = await tx
    .update(staffSessions)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(staffSessions.handle, input.handle),
        eq(staffSessions.userId, input.userId),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.idleExpiresAt, input.now),
        gt(staffSessions.absoluteExpiresAt, input.now),
      ),
    )
    .returning({ handle: staffSessions.handle });
  if (!revoked) return "not_found";
  // The account's own log names the session that ended and the one that ended it.
  await tx.insert(authEvents).values({ userId: input.userId, type: "staff_session_revoked", ipHash: input.ipHash, metadata: { handle: revoked.handle, by: input.staffSession } });
  const inTime = await appendAuditBefore(tx, input.expiresAt, {
    actorId: input.userId,
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: revoked.handle,
    staffSession: input.staffSession,
    keyId: input.keyId,
    actionHash: input.actionHash,
    stepUp: input.stepUp,
    metadata: { params: input.params },
    requestId: input.requestId,
  });
  // Thrown, so the transaction rolls back: the session stays live and no row is written.
  if (!inTime) throw new LateConfirmation();
  return "revoked";
}

/**
 * 1c's counter rule as one conditional update of a staff key (3a design, section 7), at a sign-in in the session's
 * transaction and at a step-up on its own: the key's use and counter are recorded only while it is the account's, live, and
 * its counter moved forward (two zeros pass, as some authenticators always report 0). False when no row matched. The
 * update holds the key's row until the commit, so a revocation waiting for it then also finds what this transaction did.
 */
async function recordStaffKeyUse(q: Pick<Db, "update">, input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
  const claimed = await q
    .update(staffKeys)
    .set({ counter: input.newCounter, lastUsedAt: input.now })
    .where(
      and(
        eq(staffKeys.id, input.keyId),
        eq(staffKeys.userId, input.userId),
        isNull(staffKeys.revokedAt),
        sql`((${input.newCounter} = 0 and ${staffKeys.counter} = 0) or ${input.newCounter} > ${staffKeys.counter})`,
      ),
    )
    .returning({ id: staffKeys.id });
  return claimed.length > 0;
}

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/** The message of an exception a PL/pgSQL function raised (SQLSTATE P0001), however deeply the driver wrapped it; null for anything else. */
function raisedMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What revoking an account's staff access did, for the auth events already written, the audit rows and the mail. */
interface StaffRevocation {
  /** Each key revoked now, oldest first, with how many of its staff sessions were revoked now. */
  keys: { id: string; name: string; sessionsRevoked: number }[];
  staffSessionsRevoked: number;
  /**
   * The open enrolment links (never used) deleted now: the deletions that end something, and the count the record carries.
   * A spent link deleted with them at a take-down is not counted, since it could enrol nothing more and nothing was cancelled.
   */
  enrollmentsCancelled: number;
}

/**
 * Ends an account's staff access inside the caller's transaction, which has locked the account's row first (3a design,
 * section 7): when `keys` is set every live staff key is revoked, then every staff session not yet revoked, the
 * enrolment links deleted (the unused ones, or every one at a take-down), and a staff_key_revoked event for each key. The
 * keys go before the sessions, as in revokeStaffKeys: a sign-in holds its key's row from the moment it records the key's
 * use until it commits the session it opens, and the session's insert does not wait for the account's lock, so a session
 * opened while this waited for a key's row is committed by the time the sessions are revoked, and is found and counted.
 * A revocation sets revoked_at only where it is still null, since a set one is never changed. Writes no audit row: the
 * caller writes those last, after its own statements.
 */
async function revokeStaffAccess(
  tx: Tx,
  userId: string,
  now: Date,
  options: { keys: boolean; enrollments: "unused" | "all"; via: "role_change" | "take_down" },
): Promise<StaffRevocation> {
  const revoked = options.keys
    ? await tx
        .update(staffKeys)
        .set({ revokedAt: now })
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt })
    : [];
  const ended = await tx
    .update(staffSessions)
    .set({ revokedAt: now })
    .where(and(eq(staffSessions.userId, userId), isNull(staffSessions.revokedAt)))
    .returning({ keyId: staffSessions.keyId });
  const deleted = await tx
    .delete(staffEnrollments)
    .where(and(eq(staffEnrollments.userId, userId), options.enrollments === "unused" ? isNull(staffEnrollments.usedAt) : undefined))
    .returning({ usedAt: staffEnrollments.usedAt });
  const keys: StaffRevocation["keys"] = [];
  if (options.keys) {
    // An update answers in no set order; the events, rows and mail list the keys oldest first.
    revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const key of revoked) {
      const sessionsRevoked = ended.filter((session) => session.keyId === key.id).length;
      keys.push({ id: key.id, name: key.name, sessionsRevoked });
      // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
      await tx.insert(authEvents).values({ userId, type: "staff_key_revoked", metadata: { keyId: key.id, sessionsRevoked, via: options.via } });
    }
  }
  return { keys, staffSessionsRevoked: ended.length, enrollmentsCancelled: deleted.filter((link) => link.usedAt === null).length };
}

/** The audit row of each staff key a revocation revoked, in the order of its events; among the caller's last statements. */
async function appendKeyRevocations(tx: Tx, actorId: string, revocation: StaffRevocation, via: "role_change" | "take_down"): Promise<void> {
  for (const key of revocation.keys) {
    await appendAudit(tx, {
      actorId,
      action: "staff_key_revoked",
      targetType: "staff_key",
      targetId: key.id,
      metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via },
    });
  }
}

/**
 * A take-down's audit rows, its transaction's last statements (3a design, section 7): each staff key's revocation and,
 * when an open enrolment link went, one staff_enrollments_cancelled row with their count, so the take-down never ends
 * any staff access without a row on the record. The spent links it deletes too are no cancellation, and like the
 * janitor's deletions of them they get no row. Nothing when the account had no staff access left to take.
 */
async function appendTakeDownAudit(tx: Tx, actorId: string, userId: string, revocation: StaffRevocation): Promise<void> {
  await appendKeyRevocations(tx, actorId, revocation, "take_down");
  if (revocation.enrollmentsCancelled > 0) {
    await appendAudit(tx, {
      actorId,
      action: "staff_enrollments_cancelled",
      targetType: "user",
      targetId: userId,
      metadata: { count: revocation.enrollmentsCancelled, via: "take_down" },
    });
  }
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Its staff access ends too (3a design,
 * section 7): its live staff keys and staff sessions are revoked, with a staff_key_revoked event per key, and its
 * enrolment links deleted. The keys themselves are never deleted, since audit-verify checks old confirmations against
 * them, so auth.forget_staff_keys blanks their names, AAGUIDs and transports and keeps what audit-verify needs. It writes
 * no audit row: the caller writes those last, from what this answers. Run again by finishTakeDown, each statement finds
 * nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<{ sessionIds: string[]; staff: StaffRevocation }> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys and staff keys; cleared here rather than by finishPurge, so the
  // take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  const staff = await revokeStaffAccess(tx, userId, now, { keys: true, enrollments: "all", via: "take_down" });
  // The account is marked deleted by now, which the function checks: for a live account it would change nothing.
  await tx.execute(sql`select auth.forget_staff_keys(${userId}::uuid)`);
  return { sessionIds: revoked.map((row) => row.id), staff };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
